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
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(BOOTSTRAP);

  const applied = new Set(
    (raw.prepare("SELECT name FROM schema_migration").all() as { name: string }[]).map((r) => r.name),
  );

  for (const name of listMigrations()) {
    if (applied.has(name)) continue;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
    raw.prepare("INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)").run(name, nowIso);
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
