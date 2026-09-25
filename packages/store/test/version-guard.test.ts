/**
 * 옛 판 가드의 판정 함수(설계 D1 · 시험 7a · 7a′ · 7b).
 * ⚠7a 가 이 파일의 핵심이다 — 판정 SELECT 가 **쓰기 트랜잭션 안**에서 돈다는 것을 잰다.
 *   SELECT 를 트랜잭션 밖으로 옮긴 판은 이 시험이 반드시 붉어야 한다(뮤테이션 확인).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "../src/index.ts";
import { judgeVersion, writeGameGuarded } from "../src/version-guard.ts";

const NOW = "2026-09-25T00:00:00.000Z";
const GAME = "2026/0815/b-f-20";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-vguard-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function putGame(db: ReturnType<typeof openDb>, fetchedAt: string, homeRuns = 4): void {
  upsertGame(db, {
    gameId: GAME, season: 2026, gameDate: "2026-08-15", awayCode: "f", homeCode: "b", gameNo: 20,
    status: "played", notPlayedReason: null, competition: "regular", series: null,
    sourceUrl: "https://npb.jp/scores/2026/0815/b-f-20/box.html", fetchedAt,
    awayRuns: 12, homeRuns, awayHits: null, homeHits: null, awayErrors: null, homeErrors: null, venue: null,
  });
}

test("7b 행이 없으면 new", async () => {
  await withDb((db) => {
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.000Z"), "new");
  });
});

test("7b 같은 밀리초는 소수 자릿수가 달라도 same-or-newer — 같은 시각은 진행한다(별칭 재정규화)", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.5Z");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.500Z"), "same-or-newer");
  });
});

test("7b 1ms 이르면 stale · 늦으면 same-or-newer", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T11:59:59.999Z"), "stale");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.001Z"), "same-or-newer");
  });
});

test("7b DB 의 fetched_at 이 무효면 invalid-db(fail-closed)", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    for (const bad of ["not-a-date", "2026-08-16T12:00:00"]) {
      db.raw.prepare("UPDATE game SET fetched_at = ? WHERE game_id = ?").run(bad, GAME);
      assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.000Z"), "invalid-db", bad);
    }
  });
});

test("7b 정규화되지 않은 boxSeenAt 은 호출자 결함이다 — 던진다", async () => {
  await withDb((db) => {
    assert.throws(() => judgeVersion(db, GAME, "2026-08-16T12:00:00"), TypeError);
  });
});

test("⚠7a 판정 SELECT 는 쓰기 트랜잭션 안에서 돈다", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    const inTx: boolean[] = [];
    const original = db.raw.prepare.bind(db.raw);
    db.raw.prepare = ((sql: string) => {
      if (/SELECT\s+fetched_at\s+FROM\s+game/i.test(sql)) inTx.push(db.raw.isTransaction);
      return original(sql);
    }) as typeof db.raw.prepare;
    const r = writeGameGuarded(db, GAME, "2026-08-16T12:00:00.000Z", () => 1);
    assert.equal(r.outcome, "written");
    assert.deepEqual(inTx, [true], "판정 SELECT 가 정확히 한 번 · 트랜잭션 안에서 돌아야 한다");
  });
});

test("⚠7a′ 사전 판정 뒤에 더 새 판이 커밋되면 쓰지 않고 stale", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z", 4);
    const box = "2026-08-16T12:00:00.000Z";
    assert.equal(judgeVersion(db, GAME, box), "same-or-newer", "사전 판정은 통과한다");
    // 다른 적재기가 그 사이에 더 새 판을 넣었다
    putGame(db, "2026-08-17T00:00:00.000Z", 9);
    let called = 0;
    const r = writeGameGuarded(db, GAME, box, () => {
      called += 1;
      return 1;
    });
    assert.equal(r.outcome, "stale");
    assert.equal(called, 0, "옛 판의 쓰기 콜백이 불리면 안 된다");
    const row = db.raw.prepare("SELECT home_runs AS h FROM game WHERE game_id = ?").get(GAME) as { h: number };
    assert.equal(row.h, 9);
  });
});

test("writeGameGuarded 는 invalid-db 면 쓰지 않는다", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    db.raw.prepare("UPDATE game SET fetched_at = 'x' WHERE game_id = ?").run(GAME);
    let called = 0;
    const r = writeGameGuarded(db, GAME, "2026-08-16T12:00:00.000Z", () => (called += 1));
    assert.equal(r.outcome, "invalid-db");
    assert.equal(called, 0);
  });
});
