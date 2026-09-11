/**
 * ⚠**여러 프로세스가 같은 DB 를 동시에 열어도 마이그레이션이 한 번만 적용된다**(M5 · 2026-09-11).
 *
 * `node --test` 는 시험 파일을 **여러 프로세스로 동시에** 돌린다. 새 마이그레이션(021)을 받은 로컬 DB 에서 `npm test` 를
 * 돌리자 **실DB 시험 47개가 `table starters_fetch already exists` 로 떨어졌다** — 한 프로세스가 표를 만드는 사이 다른 프로세스가
 * `schema_migration` 에서 「아직 안 적용됨」을 읽고 같은 마이그레이션을 또 적용했다. 판정 코드가 아니라 **`openDb` 의 경합**이었다.
 * ⚠CI 는 「수집·적재」가 「시험」보다 먼저 돌아 안 걸렸다 — **순서가 막아 준 것이지 코드가 막은 것이 아니다.**
 * 앞으로 모든 마이그레이션에 똑같이 걸린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { applyPendingMigrations, listMigrations, openDb } from "../src/db.ts";

const DB_TS = fileURLToPath(new URL("../src/db.ts", import.meta.url));
const NOW = "2026-09-11T00:00:00.000Z";

/** 마지막 마이그레이션 둘을 되돌려 「새 마이그레이션을 막 받은 DB」를 만든다 */
function rewindLastTwo(path: string): string[] {
  const names = listMigrations();
  const last = names.slice(-2);
  const raw = new DatabaseSync(path);
  for (const n of last) raw.prepare("DELETE FROM schema_migration WHERE name = ?").run(n);
  // 021 이 만든 표를 지운다(022 는 UPDATE 뿐이다)
  for (const t of ["starters_fetch", "schedule_played", "schedule_month"]) raw.exec(`DROP TABLE IF EXISTS ${t}`);
  raw.close();
  return last;
}

function openInChild(path: string): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const code = `import { openDb } from ${JSON.stringify(`file:///${DB_TS.replace(/\\/g, "/")}`)}; openDb(${JSON.stringify(path)}, ${JSON.stringify(NOW)}).close();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("close", (c) => resolve({ code: c, err }));
  });
}

/**
 * ⚠**경합보다 무거운 쪽은 「반쯤 적용」이다**(2026-09-11 실측). 위 47개 실패를 낸 첫 실행이 끝난 뒤 로컬 DB 에는
 * `starters_fetch`·`schedule_played` 만 있고 `schedule_month` 는 없으며 021 기록도 없었다 — 옛 코드는 마이그레이션을
 * 트랜잭션 없이 실행해 **도중에 죽으면 앞의 표가 남았고**, 021 은 `CREATE TABLE`(IF NOT EXISTS 아님)이라
 * **다음 실행마다 같은 오류로 죽는다.** 경합을 고친 뒤 재실행해도 47개가 그대로 떨어진 이유가 이것이었다.
 */
test("⚠마이그레이션이 도중에 실패하면 앞서 만든 표까지 되돌리고 「적용됨」으로 기록하지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-migrate-partial-"));
  const path = join(dir, "t.sqlite");
  try {
    openDb(path, NOW).close();
    const rewound = rewindLastTwo(path);
    // 021 의 세 번째 표와 같은 이름을 미리 만들어 둔다 → 앞의 두 표를 만든 뒤 세 번째에서 실패한다
    const pre = new DatabaseSync(path);
    pre.exec("CREATE TABLE schedule_month (x INTEGER)");
    pre.close();
    assert.throws(() => openDb(path, NOW), /schedule_month already exists/);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      for (const t of ["starters_fetch", "schedule_played"]) {
        const n = (raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(t) as { n: number }).n;
        assert.equal(n, 0, `실패한 마이그레이션이 만든 ${t} 가 남았다`);
      }
      for (const n of rewound) {
        const c = (raw.prepare("SELECT COUNT(*) AS n FROM schema_migration WHERE name = ?").get(n) as { n: number }).n;
        assert.equal(c, 0, `실패한 ${n} 이 적용됨으로 기록됐다`);
      }
    } finally {
      raw.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠⚠**경합을 결정적으로 만든다**(2026-09-11 · 3중 검토 3차 P2).
 * 아래 「프로세스 8개」 시험은 **프로세스가 뜨는 시차에 기댄다** — 첫 프로세스가 먼저 끝나면 나머지는 이미 적용된 DB 를 열어
 * 고치기 전 코드로도 통과할 수 있다. 실제로 갈렸다: 이 기계에서는 고치기 전 코드로 **3/3 실패**, 3차 검토의 사본에서는 **1/1 통과**.
 * → 경합의 핵심인 「**낡은 적용 목록을 쥔 연결**」을 한 프로세스 안에서 그대로 만든다:
 *   ⑴ 연결 A 가 적용 목록을 읽는다(021·022 없음) ⑵ 다른 연결이 그 사이 021·022 를 적용한다 ⑶ A 가 낡은 목록으로 적용을 시도한다.
 *   잠근 뒤 다시 보지 않으면 ⑶ 이 `table starters_fetch already exists` 로 죽는다.
 */
test("⚠⚠낡은 적용 목록을 쥔 연결도 이미 적용된 마이그레이션을 다시 적용하지 않는다 — 잠근 뒤 다시 본다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-migrate-stale-"));
  const path = join(dir, "t.sqlite");
  let a: DatabaseSync | undefined;
  try {
    openDb(path, NOW).close();
    const rewound = rewindLastTwo(path);
    const conn = new DatabaseSync(path);
    a = conn;
    const stale = new Set((conn.prepare("SELECT name FROM schema_migration").all() as { name: string }[]).map((r) => r.name));
    assert.ok(rewound.every((name) => !stale.has(name)), "전제가 틀렸다 — 낡은 목록에 되돌린 마이그레이션이 있다");
    openDb(path, NOW).close(); // 다른 연결이 그 사이 적용한다
    assert.doesNotThrow(() => applyPendingMigrations(conn, NOW, stale), "낡은 목록으로 같은 마이그레이션을 다시 적용하려 했다");
    for (const name of rewound) {
      const row = conn.prepare("SELECT COUNT(*) AS cnt FROM schema_migration WHERE name = ?").get(name) as { cnt: number };
      assert.equal(row.cnt, 1, `${name} 이 ${row.cnt}번 기록됐다`);
    }
  } finally {
    a?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * **통합 연기 시험** — 실제 프로세스 동시 개설에서 `busy_timeout` 과 잠금이 함께 돈다.
 * ⚠**이 시험만으로는 경합을 보장하지 못한다**(위 결정적 시험이 본체다).
 */
test("⚠프로세스 8개가 동시에 열어도 전부 성공하고 마이그레이션은 한 번씩만 기록된다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-migrate-race-"));
  const path = join(dir, "t.sqlite");
  try {
    openDb(path, NOW).close();
    const rewound = rewindLastTwo(path);
    assert.ok(rewound.includes("021-collection-evidence.sql"), `되돌린 마이그레이션이 예상과 다르다: ${rewound.join(",")}`);
    const results = await Promise.all(Array.from({ length: 8 }, () => openInChild(path)));
    const failed = results.filter((r) => r.code !== 0);
    assert.equal(failed.length, 0, `동시에 연 ${results.length}개 중 ${failed.length}개가 실패했다: ${failed[0]?.err.split("\n").find((l) => l.includes("Error")) ?? ""}`);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      for (const n of rewound) {
        const c = (raw.prepare("SELECT COUNT(*) AS n FROM schema_migration WHERE name = ?").get(n) as { n: number }).n;
        assert.equal(c, 1, `${n} 이 ${c}번 기록됐다`);
      }
      const t = (raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='starters_fetch'").get() as { n: number }).n;
      assert.equal(t, 1);
    } finally {
      raw.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
