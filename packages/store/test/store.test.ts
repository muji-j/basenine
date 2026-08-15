import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePaCell } from "@bb-app/parser";
import type { BatterRow, PitcherRow } from "@bb-app/parser";
import { listMigrations, openDb } from "../src/db.ts";
import { deriveBatting, derivePitching } from "../src/derive.ts";
import { replaceQuarantine, upsertBatting, upsertGame, upsertPlayer } from "../src/load.ts";
import type { GameRow } from "../src/load.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function batter(cells: string[], overrides: Partial<BatterRow> = {}): BatterRow {
  const pas = cells.map(parsePaCell).filter((p) => p !== null);
  return {
    order: "1",
    position: "(遊)",
    name: "テスト",
    playerId: "12345678",
    isTeamTotal: false,
    ab: 0,
    runs: 0,
    hits: 0,
    rbi: 0,
    steals: 0,
    plateAppearances: pas,
    ...overrides,
  };
}

const GAME: GameRow = {
  gameId: "2026/0814/s-db-17",
  season: 2026,
  gameDate: "2026-08-14",
  awayCode: "s",
  homeCode: "db",
  gameNo: 17,
  status: "played",
  notPlayedReason: null,
  competition: "regular",
  sourceUrl: "https://npb.jp/scores/2026/0814/s-db-17/box.html",
  fetchedAt: NOW,
};

async function withDb(fn: (db: ReturnType<typeof openDb>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-store-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- 마이그레이션 --------------------------------------------------------

test("마이그레이션은 재실행해도 안전하다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-store-"));
  const path = join(dir, "t.sqlite");
  try {
    openDb(path, NOW).close();
    const db = openDb(path, NOW);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM schema_migration").get() as { n: number };
    // 마이그레이션이 늘어도 이 테스트가 계속 의미를 갖도록 개수를 고정하지 않는다.
    assert.equal(n.n, listMigrations().length, "같은 마이그레이션이 두 번 기록되면 안 된다");
    assert.ok(n.n >= 1, "마이그레이션이 하나도 없으면 이 테스트는 아무것도 재지 않는다");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- 도출 ---------------------------------------------------------------

test("타석 셀에서 볼넷·삼진·장타를 센다", () => {
  const d = deriveBatting("g", "away", batter(["左越本②", "四 球", "三 振", "左線２"], { ab: 3, hits: 2, rbi: 2 }));
  assert.ok(d);
  assert.equal(d.row.pa, 4);
  assert.equal(d.row.ab, 3);
  assert.equal(d.row.h, 2);
  assert.equal(d.row.hr, 1);
  assert.equal(d.row.d2, 1);
  assert.equal(d.row.bb, 1);
  assert.equal(d.row.so, 1);
  assert.equal(d.row.rbi, 2);
  assert.equal(d.quarantine.length, 0);
});

test("⚠희생번트 3종이 전부 sh로 모인다", () => {
  const d = deriveBatting("g", "away", batter(["投犠打", "投犠野", "投犠失"], { ab: 0 }));
  assert.ok(d);
  assert.equal(d.row.sh, 3);
  assert.equal(d.row.ab, 0, "희생타는 타수가 아니다");
});

test("⚠고의사구는 bb에도 ibb에도 들어간다", () => {
  const d = deriveBatting("g", "away", batter(["敬遠四", "四 球"], { ab: 0 }));
  assert.ok(d);
  assert.equal(d.row.bb, 2, "BB는 고의사구를 포함한다");
  assert.equal(d.row.ibb, 1, "wOBA는 BB−IBB를 쓴다");
});

test("⚠낫아웃 출루는 삼진으로 세되 타수에도 들어간다", () => {
  const d = deriveBatting("g", "away", batter(["振逃"], { ab: 1 }));
  assert.ok(d);
  assert.equal(d.row.so, 1);
  assert.equal(d.row.ab, 1);
  assert.equal(d.row.h, 0);
});

test("⚠실책 출루를 센다 — wOBA 공식 산식이 요구한다", () => {
  const d = deriveBatting("g", "away", batter(["三ゴ失", "遊ゴ失①"], { ab: 2, rbi: 1 }));
  assert.ok(d);
  assert.equal(d.row.roe, 2);
  assert.equal(d.row.ab, 2, "실책 출루는 타수다");
  assert.equal(d.row.h, 0, "실책 출루는 안타가 아니다");
});

test("팀 합계 행과 ID 없는 행은 적재 대상이 아니다", () => {
  assert.equal(deriveBatting("g", "away", batter([], { isTeamTotal: true })), null);
  assert.equal(deriveBatting("g", "away", batter([], { playerId: null })), null);
});

test("⚠npb.jp 합계와 어긋나면 격리한다 — 조용히 넘기지 않는다", () => {
  const d = deriveBatting("g", "away", batter(["三 振"], { ab: 5, hits: 3 }));
  assert.ok(d);
  const kinds = d.quarantine.map((q) => q.kind);
  assert.ok(kinds.includes("abMismatch"));
  assert.ok(kinds.includes("hitMismatch"));
});

test("⚠모르는 토큰은 격리되고 원문이 보존된다", () => {
  const d = deriveBatting("g", "away", batter(["珍プレー"], { ab: 0 }));
  assert.ok(d);
  const q = d.quarantine.find((x) => x.kind === "unknownToken");
  assert.ok(q);
  assert.equal(q.raw, "珍プレー");
});

const PITCHER: PitcherRow = {
  decision: "○",
  name: "テスト投手",
  playerId: "87654321",
  isTeamTotal: false,
  pitches: 105,
  battersFaced: 28,
  outs: 20,
  hits: 5,
  homeRuns: 1,
  walks: 2,
  hitByPitch: 1,
  strikeouts: 7,
  runs: 3,
  earnedRuns: 2,
};

test("⚠투수 팀 합계 행은 적재 대상이 아니다", () => {
  assert.equal(derivePitching("g", "away", { ...PITCHER, isTeamTotal: true }), null);
  assert.ok(derivePitching("g", "away", PITCHER));
});

test("투수 행을 아웃 카운트로 적재한다", () => {
  const r = derivePitching("g", "away", PITCHER);
  assert.ok(r);
  assert.equal(r.outs, 20);
  assert.equal(r.er, 2);
  assert.equal(r.decision, "○");
});

// ---- 적재 ---------------------------------------------------------------

test("⚠M5 멱등: 같은 경기를 두 번 적재해도 행이 늘지 않는다", async () => {
  await withDb((db) => {
    upsertGame(db, GAME);
    upsertGame(db, GAME);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM game").get() as { n: number };
    assert.equal(n.n, 1);
  });
});

test("⚠재적재만으로는 revision이 오르지 않는다", async () => {
  await withDb((db) => {
    upsertGame(db, GAME);
    upsertGame(db, { ...GAME, fetchedAt: "2026-08-16T00:00:00.000Z" });
    const r = db.raw.prepare("SELECT revision FROM game").get() as { revision: number };
    assert.equal(r.revision, 1, "내용이 같으면 개정이 아니다");
  });
});

test("상태가 바뀌면 revision이 오른다", async () => {
  await withDb((db) => {
    upsertGame(db, GAME);
    upsertGame(db, { ...GAME, status: "notPlayed", notPlayedReason: "中止" });
    const r = db.raw.prepare("SELECT revision FROM game").get() as { revision: number };
    assert.equal(r.revision, 2);
  });
});

test("선수 표기는 갱신되지만 ID는 그대로다 — 등록명 변경은 정상이다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "12345678", "旧名", NOW);
    upsertPlayer(db, "12345678", "新名", "2026-09-01T00:00:00.000Z");
    const r = db.raw.prepare("SELECT player_id, display_name FROM player").all() as {
      player_id: string;
      display_name: string;
    }[];
    assert.equal(r.length, 1);
    assert.equal(r[0]?.display_name, "新名");
    assert.equal(r[0]?.player_id, "12345678");
  });
});

test("타격 행 재적재는 갱신이지 추가가 아니다", async () => {
  await withDb((db) => {
    upsertGame(db, GAME);
    upsertPlayer(db, "12345678", "テスト", NOW);
    const d = deriveBatting(GAME.gameId, "away", batter(["三 振"], { ab: 1 }))!;
    upsertBatting(db, d.row);
    upsertBatting(db, { ...d.row, h: 1 });
    const rows = db.raw.prepare("SELECT h FROM batting_line").all() as { h: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.h, 1, "마지막 값으로 갱신된다");
  });
});

test("⚠격리는 경기 단위로 교체된다 — 재적재해도 쌓이지 않는다", async () => {
  await withDb((db) => {
    upsertGame(db, GAME);
    const rows = [
      { kind: "unknownToken" as const, gameId: GAME.gameId, playerId: "1", raw: "珍", detail: null },
    ];
    replaceQuarantine(db, GAME.gameId, rows, NOW);
    replaceQuarantine(db, GAME.gameId, rows, NOW);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM quarantine").get() as { n: number };
    assert.equal(n.n, 1);
  });
});

test("⚠존재하지 않는 경기의 타격 행은 외래키가 막는다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "12345678", "テスト", NOW);
    const d = deriveBatting("없는경기", "away", batter(["三 振"], { ab: 1 }))!;
    assert.throws(() => upsertBatting(db, d.row), /FOREIGN KEY|constraint/i);
  });
});
