/**
 * 하루치 경기.
 *
 * ⚠**여기서 잡는 것은 「무엇을 경기로 세는가」와 「누구를 눈에 띈 것으로 세는가」다.**
 * 중지 경기를 0대0으로 세면 조용히 팀 성적이 틀리고, 선정 기준이 흔들리면
 * 화면이 매일 다른 말을 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { BattingRow, Db, PitchingRow } from "@bb-app/store";
import { STAR_LIMIT, dayResults, latestGameDate } from "../src/day.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const DATE = "2026-08-14";
const GAME = "g1";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-day-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function game(db: Db, over: Partial<Parameters<typeof upsertGame>[1]> = {}): void {
  upsertGame(db, {
    gameId: GAME,
    season: 2026,
    gameDate: DATE,
    awayCode: "m",
    homeCode: "l",
    gameNo: 1,
    status: "played",
    notPlayedReason: null,
    competition: "regular",
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
    awayRuns: 0,
    homeRuns: 7,
    awayHits: 5,
    homeHits: 12,
    awayErrors: 1,
    homeErrors: 0,
    venue: "ベルーナドーム",
    ...over,
  });
}

function bat(db: Db, playerId: string, over: Partial<BattingRow> = {}): void {
  upsertPlayer(db, playerId, playerId, NOW);
  upsertBatting(db, {
    gameId: GAME, playerId, side: "home", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 0, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    ...over,
  });
}

function pit(db: Db, playerId: string, over: Partial<PitchingRow> = {}): void {
  upsertPlayer(db, playerId, playerId, NOW);
  upsertPitching(db, {
    gameId: GAME, playerId, side: "away", decision: null,
    outs: 3, bf: 12, pitches: 40, h: 2, hr: 0, bb: 1, hbp: 0, so: 2,
    runs: 1, er: 1, wp: 0, balk: 0,
    ...over,
  });
}

test("득점·안타·실책과 승자를 낸다", async () => {
  await withDb((db) => {
    game(db);
    const g = dayResults(db, 2026, DATE)[0]!;
    assert.equal(g.away.runs, 0);
    assert.equal(g.home.runs, 7);
    assert.equal(g.away.hits, 5);
    assert.equal(g.home.errors, 0);
    assert.equal(g.winner, "home");
    assert.equal(g.venue, "ベルーナドーム");
  });
});

test("⚠중지 경기를 0대0으로 만들지 않는다 — 「경기가 없었다」와 「0점」은 다르다(M11)", async () => {
  await withDb((db) => {
    game(db, {
      status: "notPlayed",
      notPlayedReason: "雨天中止",
      awayRuns: null, homeRuns: null, awayHits: null, homeHits: null,
      awayErrors: null, homeErrors: null,
    });
    const g = dayResults(db, 2026, DATE)[0]!;
    assert.equal(g.status, "notPlayed");
    assert.equal(g.away.runs, null, "중지 경기에 0점이 들어갔다");
    assert.equal(g.winner, null, "치르지도 않은 경기에 승자가 붙었다");
    assert.equal(g.notPlayedReason, "雨天中止");
  });
});

test("⚠득점이 남아 있어도 치르지 않은 경기면 승자가 없다 — 재분류된 ノーゲーム에서 실제로 생긴다", async () => {
  await withDb((db) => {
    // 한 번 played로 적재됐다가 ノーゲーム으로 다시 분류된 경기.
    // 득점 열이 남아 있으므로 **상태를 보지 않으면 승자가 붙는다**
    game(db, { status: "notPlayed", notPlayedReason: "ノーゲーム", awayRuns: 2, homeRuns: 5 });
    const g = dayResults(db, 2026, DATE)[0]!;
    assert.equal(g.status, "notPlayed");
    assert.equal(g.winner, null, "치르지 않은 경기에 승자가 붙었다");
  });
});

test("동점이면 승자가 없다 — 무승부를 이긴 것으로 만들지 않는다", async () => {
  await withDb((db) => {
    game(db, { awayRuns: 3, homeRuns: 3 });
    assert.equal(dayResults(db, 2026, DATE)[0]!.winner, null);
  });
});

test("득점을 모르면 승자도 없다 — 없는 값으로 판정하지 않는다", async () => {
  await withDb((db) => {
    game(db, { awayRuns: null, homeRuns: null });
    assert.equal(dayResults(db, 2026, DATE)[0]!.winner, null);
  });
});

test("⚠결정 투수에 소속이 붙는다 — 같은 카드의 동명이인을 구별할 수 있어야 한다(M10)", async () => {
  await withDb((db) => {
    game(db);
    pit(db, "P_LOSE", { side: "away", decision: "●", outs: 18, er: 2 });
    pit(db, "P_WIN", { side: "home", decision: "○" });
    pit(db, "P_SAVE", { side: "home", decision: "S" });
    const g = dayResults(db, 2026, DATE)[0]!;
    // away = ロッテ(m) · home = 西武(l)
    assert.deepEqual(g.losePitcher, { playerId: "P_LOSE", teamCode: "m" });
    assert.deepEqual(g.winPitcher, { playerId: "P_WIN", teamCode: "l" });
    assert.deepEqual(g.savePitcher, { playerId: "P_SAVE", teamCode: "l" });
  });
});

test("눈에 띈 타자 — 3안타·홈런·4타점 중 하나면 실린다", async () => {
  await withDb((db) => {
    game(db);
    bat(db, "H3", { h: 3 });
    bat(db, "HR1", { h: 1, hr: 1 });
    bat(db, "RBI4", { h: 1, rbi: 4 });
    bat(db, "PLAIN", { h: 2, rbi: 3 });
    const ids = dayResults(db, 2026, DATE)[0]!.stars.map((s) => s.playerId);
    assert.deepEqual(ids.sort(), ["H3", "HR1", "RBI4"]);
  });
});

test("눈에 띈 투수 — 6이닝 자책2 이하, 또는 10탈삼진", async () => {
  await withDb((db) => {
    game(db);
    pit(db, "QS", { outs: 18, er: 2 });
    pit(db, "K10", { outs: 9, er: 5, so: 10 });
    // 6이닝을 던졌지만 자책 3 — 기준 밖이다
    pit(db, "MEH", { outs: 18, er: 3, so: 4 });
    const ids = dayResults(db, 2026, DATE)[0]!.stars.map((s) => s.playerId);
    assert.deepEqual(ids.sort(), ["K10", "QS"]);
  });
});

test("투수를 먼저 세운다 — 호투는 그 경기의 뼈대다", async () => {
  await withDb((db) => {
    game(db);
    bat(db, "B", { h: 3 });
    pit(db, "P", { outs: 18, er: 1 });
    const stars = dayResults(db, 2026, DATE)[0]!.stars;
    assert.equal(stars[0]!.kind, "pitching");
    assert.equal(stars[1]!.kind, "batting");
  });
});

test(`한 경기 ${STAR_LIMIT}명까지만 낸다 — 자른 사실은 화면이 말한다`, async () => {
  await withDb((db) => {
    game(db);
    for (let i = 0; i < STAR_LIMIT + 4; i += 1) bat(db, `B${i}`, { h: 3 });
    assert.equal(dayResults(db, 2026, DATE)[0]!.stars.length, STAR_LIMIT);
  });
});

test("스타의 소속은 출전한 쪽이다 — 원정/홈을 뒤집으면 남의 팀 선수가 된다", async () => {
  await withDb((db) => {
    game(db);
    bat(db, "AWAY", { side: "away", h: 3 });
    bat(db, "HOME", { side: "home", h: 3 });
    const byId = new Map(dayResults(db, 2026, DATE)[0]!.stars.map((s) => [s.playerId, s.teamCode]));
    assert.equal(byId.get("AWAY"), "m");
    assert.equal(byId.get("HOME"), "l");
  });
});

test("⚠중지 경기의 선수 기록은 스타로 세지 않는다 — 애초에 경기가 없었다", async () => {
  await withDb((db) => {
    game(db, { status: "notPlayed", notPlayedReason: "雨天中止" });
    bat(db, "B", { h: 3 });
    assert.deepEqual(dayResults(db, 2026, DATE)[0]!.stars, []);
  });
});

test("⚠최신 경기일은 전 경기가 중지된 날도 센다 — 그날이 없었던 것으로 만들지 않는다", async () => {
  await withDb((db) => {
    game(db);
    upsertGame(db, {
      gameId: "g2", season: 2026, gameDate: "2026-08-15",
      awayCode: "m", homeCode: "l", gameNo: 1,
      status: "notPlayed", notPlayedReason: "雨天中止", competition: "regular",
      sourceUrl: "https://npb.jp/y", fetchedAt: NOW,
    });
    assert.equal(latestGameDate(db, 2026), "2026-08-15");
  });
});

test("그날 경기가 없으면 빈 배열이다 — 던지지 않는다", async () => {
  await withDb((db) => {
    game(db);
    assert.deepEqual(dayResults(db, 2026, "2026-08-13"), []);
  });
});
