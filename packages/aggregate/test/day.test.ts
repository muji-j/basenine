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
import { STAR_LIMIT, dayResults, gameDates, latestGameDate } from "../src/day.ts";

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

/**
 * ⚠**상한을 상수로만 재면 아무 값이나 통과한다.** 예전 이 시험은 `STAR_LIMIT + 4`명을 넣고
 * `STAR_LIMIT`을 기대해서, 상한을 99로 바꿔도 통과했다(2026-08-16 변이 검사에서 생존).
 * **실제 수를 못 박는다.**
 */
test("한 경기 6명까지만 낸다 — 자른 사실은 화면이 말한다", async () => {
  await withDb((db) => {
    assert.equal(STAR_LIMIT, 6, "상한이 바뀌었다 — 화면 문구와 이 시험을 함께 고쳐라");
    game(db);
    for (let i = 0; i < 12; i += 1) bat(db, `B${i}`, { h: 3 });
    assert.equal(dayResults(db, 2026, DATE)[0]!.stars.length, 6);
  });
});

/**
 * ⚠**「눈에 띈 기록」의 기준을 실제 수로 못 박는다.** 상수만 참조하면 임계값을 바꿔도
 * 시험이 통과해서, 화면 문구와 코드가 조용히 갈라진다(2026-08-16 변이 검사에서 생존).
 */
test("호투 기준은 6이닝·자책2다 — 5.2이닝은 들어가지 않는다", async () => {
  await withDb((db) => {
    game(db);
    pit(db, "SIX", { outs: 18, er: 2, so: 3 });
    // 5와 3분의 2이닝(17아웃) — 한 아웃 모자라다
    pit(db, "FIVE_TWO", { outs: 17, er: 0, so: 3 });
    const ids = dayResults(db, 2026, DATE)[0]!.stars.map((s) => s.playerId);
    assert.deepEqual(ids, ["SIX"], "6이닝 기준이 흔들렸다");
  });
});

test("탈삼진 기준은 10이다 — 9탈삼진은 들어가지 않는다", async () => {
  await withDb((db) => {
    game(db);
    pit(db, "K10", { outs: 6, er: 5, so: 10 });
    pit(db, "K9", { outs: 6, er: 5, so: 9 });
    const ids = dayResults(db, 2026, DATE)[0]!.stars.map((s) => s.playerId);
    assert.deepEqual(ids, ["K10"], "탈삼진 기준이 흔들렸다");
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

/**
 * ⚠**「신선도의 기준일」과 「試合 화면의 대상일」은 다른 값이다**(2026-08-16 이중 검토).
 * 신선도는 「데이터가 언제까지 들어왔나」라 실시 기준이 맞고,
 * 이 함수는 「어제 무슨 일이 있었나」라 중지도 포함해야 한다.
 * 둘을 같은 값으로 쓰면 전 경기 우천 중지인 날이 화면에서 통째로 사라진다.
 */
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

test("⚠최신 경기일에 포스트시즌을 섞지 않는다 — CS가 있으면 정규시즌 화면이 10월을 가리킨다", async () => {
  await withDb((db) => {
    game(db);
    upsertGame(db, {
      gameId: "cs1", season: 2026, gameDate: "2026-10-11",
      awayCode: "g", homeCode: "db", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "climaxSeries",
      sourceUrl: "https://npb.jp/z", fetchedAt: NOW,
    });
    assert.equal(latestGameDate(db, 2026), DATE, "CS 경기일이 정규시즌의 최신일로 나왔다");
  });
});

/**
 * ⚠**경기일 목록에서 중지된 날을 빼지 않는다.** 빼면 그 날이 없었던 것이 되고,
 * 날짜를 짚어 온 사람에게 404가 된다. 편성과 실시를 **따로 센다**(M11).
 */
test("경기일 목록은 전 경기 중지된 날도 센다 — 편성과 실시를 따로 센다", async () => {
  await withDb((db) => {
    game(db);
    upsertGame(db, {
      gameId: "off1", season: 2026, gameDate: "2026-08-15",
      awayCode: "g", homeCode: "db", gameNo: 1,
      status: "notPlayed", notPlayedReason: "雨天中止", competition: "regular",
      sourceUrl: "https://npb.jp/y", fetchedAt: NOW,
    });
    assert.deepEqual(gameDates(db, 2026), [
      { date: DATE, scheduled: 1, played: 1 },
      { date: "2026-08-15", scheduled: 1, played: 0 },
    ]);
  });
});

test("⚠경기일 목록에도 포스트시즌을 섞지 않는다 — 정규시즌 화면이 10월로 이어진다", async () => {
  await withDb((db) => {
    game(db);
    upsertGame(db, {
      gameId: "cs2", season: 2026, gameDate: "2026-10-11",
      awayCode: "g", homeCode: "db", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "climaxSeries",
      sourceUrl: "https://npb.jp/z", fetchedAt: NOW,
    });
    assert.deepEqual(gameDates(db, 2026).map((d) => d.date), [DATE]);
  });
});

test("through 를 넘긴 날은 목록에 없다 — 「7월 말 기준」 빌드가 8월을 가리키면 안 된다", async () => {
  await withDb((db) => {
    game(db);
    assert.deepEqual(gameDates(db, 2026, "2026-08-13"), []);
  });
});

/**
 * ⚠**`latestGameDate`와 `gameDates`는 같은 계약이어야 한다.**
 * 한쪽만 대회를 고정해 두면, 대회를 바꿔 빌드했을 때 「최신 경기일」이 날짜 목록에 없는 날이 되어
 * 앞뒤 이동이 통째로 사라지고 그 화면이 빈 채로 나간다(2026-08-16 이중 검토 P2).
 */
test("최신 경기일도 대회를 인자로 받는다 — 날짜 목록과 규칙이 어긋나지 않는다", async () => {
  await withDb((db) => {
    game(db);
    upsertGame(db, {
      gameId: "cs3", season: 2026, gameDate: "2026-10-11",
      awayCode: "g", homeCode: "db", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "climaxSeries",
      sourceUrl: "https://npb.jp/z", fetchedAt: NOW,
    });
    assert.equal(latestGameDate(db, 2026, "9999-12-31", "climaxSeries"), "2026-10-11");
    // 그 대회의 날짜 목록에 반드시 들어 있어야 한다 — 없으면 앞뒤 이동이 끊긴다
    const days = gameDates(db, 2026, "9999-12-31", "climaxSeries").map((d) => d.date);
    assert.ok(days.includes(latestGameDate(db, 2026, "9999-12-31", "climaxSeries")!));
  });
});
