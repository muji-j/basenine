/**
 * 데이터베이스 개설과 마이그레이션.
 *
 * 로컬 개발은 `node:sqlite`로, 배포는 Cloudflare D1로 한다. **둘 다 SQLite이므로
 * SQL은 한 벌이면 된다** — 방언을 쓰지 않는 것이 그 전제다.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFetchedAt } from "./meta.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface Db {
  readonly raw: DatabaseSync;
  /**
   * 여러 쓰기를 한 트랜잭션으로 묶는다.
   *
   * ⚠**묶지 않으면 INSERT 하나마다 커밋(=디스크 동기화)이 일어난다.** 타석 4만 건을
   * 개별 커밋했더니 적재가 10분을 넘겼다. 매일 도는 작업에는 쓸 수 없는 속도다.
   * 예외가 나면 롤백하므로 **부분 적재된 경기가 남지 않는다**(부분 실패 대응).
   */
  transaction<T>(fn: () => T): T;
  /** 중첩 가능한 부분 롤백. ⚠예외를 되돌린 뒤 **그대로 던진다** */
  savepoint<T>(name: string, fn: () => T): T;
  close(): void;
}

/** 적용된 마이그레이션 목록을 기록하는 표. 마이그레이션 자체보다 먼저 만든다. */
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migration (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
`;

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * 데이터베이스를 열고 미적용 마이그레이션을 적용한다.
 * 이미 적용된 것은 건너뛴다 — 재실행이 안전해야 한다.
 *
 * @param nowIso 적용 시각. **주입한다**(M6 — 시계를 직접 읽지 않는다)
 */
export function openDb(path: string, nowIso: string): Db {
  const raw = new DatabaseSync(path);
  try {
    migrate(raw, nowIso);
  } catch (err) {
    // ⚠열린 채 던지면 파일 핸들이 남는다 — Windows 에서는 그 파일을 지우지도 못한다(시험 정리가 EBUSY 로 실측 · 2026-09-11)
    raw.close();
    throw err;
  }

  return {
    raw,
    transaction<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const out = fn();
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    /**
     * **중첩 가능한 부분 롤백**(SQLite SAVEPOINT).
     *
     * ⚠**「한 건이 실패해도 나머지는 살린다」를 실제로 하려면 이것이 필요하다.**
     * 예외를 잡아 세기만 하면 **그 건이 도중까지 쓴 것이 그대로 커밋된다** —
     * 실제로 선수 통산이 `DELETE` 만 되고 `INSERT` 가 끊긴 채 커밋되는 경로가 있었다
     * (2026-08-18 다방면 감사 P1: 「통산이 조용히 잘린다」).
     * ⚠**이름이 겹치면 안 된다** — 중첩될 수 있으므로 호출자가 고유한 이름을 준다.
     * ⚠**예외를 삼키지 않는다.** 되돌린 뒤 그대로 던진다 — 셀지 말지는 호출자가 정한다.
     */
    savepoint<T>(name: string, fn: () => T): T {
      const sp = `sp_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
      raw.exec(`SAVEPOINT ${sp}`);
      try {
        const out = fn();
        raw.exec(`RELEASE ${sp}`);
        return out;
      } catch (err) {
        raw.exec(`ROLLBACK TO ${sp}`);
        raw.exec(`RELEASE ${sp}`);
        throw err;
      }
    },
    close: () => raw.close(),
  };
}

function migrate(raw: DatabaseSync, nowIso: string): void {
  /**
   * ⚠**여러 프로세스가 같은 파일을 동시에 연다** — `node --test` 가 시험 파일을 병렬 프로세스로 돌린다.
   * 잠금을 곧바로 실패로 받지 않고 기다린다(아래 마이그레이션 잠금과 짝이다).
   */
  raw.exec("PRAGMA busy_timeout = 15000");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(BOOTSTRAP);

  const applied = new Set(
    (raw.prepare("SELECT name FROM schema_migration").all() as { name: string }[]).map((r) => r.name),
  );
  applyPendingMigrations(raw, nowIso, applied);
}

/**
 * `applied`(**미리 읽어 둔** 적용 목록)에 없는 마이그레이션을 차례로 적용한다.
 *
 * ⚠**목록을 인자로 받는 것은 시험 이음새다**(2026-09-11 · 3중 검토 3차 P2) — 「낡은 목록을 쥔 연결」을 프로세스 시차 없이
 * **결정적으로** 재현하려고 뗐다(`migration-concurrency.test.ts`). 운영 경로는 `openDb` 가 방금 읽은 목록을 넘긴다.
 * ⚠**목록이 낡았어도 안전해야 한다** — 그래서 아래에서 잠근 뒤 다시 본다.
 */
export function applyPendingMigrations(raw: DatabaseSync, nowIso: string, applied: ReadonlySet<string>): void {
  /**
   * ⚠⚠**「유효한 취득 시각」의 정의는 JS 한 벌이고, SQL 마이그레이션도 그것을 부른다**(2026-09-11 · 수정분 재검토 3차 P2).
   * 조건을 SQL 로 흉내 내자 SQLite `datetime()` 과 JS `Date.parse` 가 경계값에서 갈렸다(`24:01` 은 SQL 만 받고 `+15:00` 은 JS 만 받는다) —
   * 그러면 JS 가 거부한 값을 022 가 남기고, 그 값이 문자열 비교로 정상 시각보다 커 **upsert 가 영영 못 덮는다.**
   * → `meta.ts` 의 `normalizeFetchedAt` 를 SQL 함수 `bb_fetched_at` 으로 등록한다. 마이그레이션을 적용하는 길은 여기 하나다.
   */
  raw.function("bb_fetched_at", { deterministic: true }, (v) => normalizeFetchedAt(v));
  /**
   * ⚠**마이그레이션 하나 = 쓰기 잠금 트랜잭션 하나 · 잠근 뒤에 「이미 적용됐나」를 다시 본다**(M5 · 2026-09-11).
   * 예전에는 위에서 한 번 읽은 목록만 믿고 적용했다 — 새 마이그레이션(021)을 받은 로컬 DB 에서 `npm test` 를 돌리자
   * 병렬 프로세스들이 **같은 마이그레이션을 동시에 적용하려다** 실DB 시험 **47개**가 `table starters_fetch already exists` ·
   * `database is locked` 로 떨어졌다. CI 는 「수집·적재」가 「시험」보다 먼저 돌아 안 걸렸을 뿐이다.
   * ⚠`BEGIN IMMEDIATE` 는 쓰기 잠금을 **먼저** 잡는다 — 그냥 `BEGIN` 이면 두 프로세스가 둘 다 읽고 나서 쓰기에서 부딪친다.
   * ⚠마이그레이션 파일에 자체 `BEGIN`·`COMMIT`·`PRAGMA` 가 없어야 한다(2026-09-11 전수 확인 0건) — 있으면 여기와 겹친다.
   * ⚠**실패하면 되돌리고 던진다 — 경합보다 이쪽이 무겁다.** 옛 코드는 트랜잭션이 없어 도중에 죽으면 **앞의 표만 남았다**:
   * 위 47개 실패 뒤 로컬 DB 에 021 의 표 둘만 있고 기록은 없었고, `CREATE TABLE` 이라 **다음 실행마다 같은 오류로 죽었다.**
   * SQLite 의 DDL 은 트랜잭션 안에서 되돌려진다 — 그래서 반쯤 적용된 상태가 남지 않는다.
   * ⚠**이미 반쯤 적용된 DB 는 이것으로 안 풀린다**(3중 검토 2차 N7) — 새로 생기는 것만 막는다. 그 DB 는 기록 없이 남은 표가
   *   **비었는지 확인하고** 지운 뒤 다시 연다(2026-09-11 로컬 DB 에서 021 의 표 둘이 0행임을 확인하고 그렇게 했다).
   */
  for (const name of listMigrations()) {
    if (applied.has(name)) continue;
    raw.exec("BEGIN IMMEDIATE");
    try {
      const done = raw.prepare("SELECT 1 AS x FROM schema_migration WHERE name = ?").get(name) !== undefined;
      if (!done) {
        raw.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
        raw.prepare("INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)").run(name, nowIso);
      }
      raw.exec("COMMIT");
    } catch (err) {
      try {
        raw.exec("ROLLBACK");
      } catch {
        // 트랜잭션이 이미 끝났다 — 원래 오류가 중요하다
      }
      throw err;
    }
  }
}
