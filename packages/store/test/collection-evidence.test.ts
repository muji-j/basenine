/**
 * 수집 판정의 **증거 SQL** — 판정(순수)은 `@bb-app/domain` 의 `collectionVerdict` 가 하고, 여기는 사실만 모은다.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D1 · D3 · D4 · D11 · T2)
 * ⚠**행으로 재현한다** — 마이그레이션을 적용한 임시 DB 에 실제로 넣고 잰다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertProbablePitcher } from "../src/index.ts";
import type { Db } from "../src/index.ts";
import { collectionEvidence } from "../src/collection-evidence.ts";

const NOW = "2026-10-20T00:00:00.000Z";
const TODAY = "2026-10-20";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-evidence-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let gid = 0;
function game(db: Db, date: string, home: string, away: string, o: { status?: "played" | "notPlayed"; competition?: string; homeRuns?: number; awayRuns?: number } = {}): void {
  gid += 1;
  upsertGame(db, {
    gameId: `e${gid}`, season: Number(date.slice(0, 4)), gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: o.status ?? "played", notPlayedReason: o.status === "notPlayed" ? "中止" : null,
    competition: o.competition ?? "regular", sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    awayRuns: o.status === "notPlayed" ? null : (o.awayRuns ?? 0), homeRuns: o.status === "notPlayed" ? null : (o.homeRuns ?? 1),
  });
}
const played = (db: Db, date: string, home: string, away: string, seq = 0): void => {
  db.raw.prepare("INSERT INTO schedule_played (season, game_date, home_code, away_code, seq, source, fetched_at) VALUES (?, ?, ?, ?, ?, 'x', ?)")
    .run(Number(date.slice(0, 4)), date, home, away, seq, NOW);
};
const month = (db: Db, season: number, m: number, fetchedAt: string | null): void => {
  db.raw.prepare("INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games) VALUES (?, ?, 'x', ?, 31, 1)")
    .run(season, m, fetchedAt);
};
const announce = (db: Db, date: string, team: string, opp: string, fetchedAt: string | null): void => {
  upsertProbablePitcher(db, {
    gameDate: date, teamCode: team, opponentCode: opp, playerId: null, sourceName: null, venue: null,
    startTime: "18:00", league: "cl", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt,
  });
};
const rest = (db: Db, fetchedDate: string, gameDate: string, fetchedAt: string | null): void => {
  db.raw.prepare("INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at) VALUES (?, ?, 1, 'x', ?)")
    .run(fetchedDate, gameDate, fetchedAt);
};

test("⚠A — 치러짐 표시인데 경기 행이 없는 것만 · 중지 행은 받은 것이다", () => withDb((db) => {
  played(db, "2026-10-17", "g", "t");            // 없음 → A
  played(db, "2026-10-16", "s", "d"); game(db, "2026-10-16", "s", "d");                        // 받음
  played(db, "2026-10-15", "c", "db"); game(db, "2026-10-15", "c", "db", { status: "notPlayed" }); // 중지도 받음
  const e = collectionEvidence(db, TODAY);
  assert.deepEqual(e.playedWithoutGame.map((m) => ({ ...m })), [{ date: "2026-10-17", homeCode: "g", awayCode: "t", seq: 0 }]);
}));

test("⚠A — 같은 카드 두 경기 표시에 경기 행 0·1·2 → A 2·1·0건", async () => {
  for (const [rows, expected] of [[0, 2], [1, 1], [2, 0]] as const) {
    await withDb((db) => {
      played(db, "2026-10-17", "g", "t", 0);
      played(db, "2026-10-17", "g", "t", 1);
      for (let i = 0; i < rows; i++) game(db, "2026-10-17", "g", "t");
      assert.equal(collectionEvidence(db, TODAY).playedWithoutGame.length, expected, `경기 행 ${rows}개인데 A ${expected}건이 아니다`);
    });
  }
});

test("A — 창은 [today−30, today] (유예는 판정이 적용한다)", () => withDb((db) => {
  played(db, "2026-09-19", "g", "t"); // 31일 전
  played(db, "2026-09-20", "s", "d"); // 30일 전
  played(db, "2026-10-20", "c", "db"); // 오늘
  const dates = collectionEvidence(db, TODAY).playedWithoutGame.map((m) => m.date).sort();
  assert.deepEqual(dates, ["2026-09-20", "2026-10-20"]);
}));

test("⚠B — 그날 경기 행이 없고 그 달 사본이 D 뒤에 안 받아졌을 때만", async () => {
  const D = "2026-10-17";
  const cases: [string, (db: Db) => void, number][] = [
    ["사본 없음", () => {}, 2],
    ["사본이 D 당일 취득(JST)", (db) => month(db, 2026, 10, "2026-10-17T14:30:00.000Z"), 2], // JST 10-17 23:30
    ["사본 취득 시각 모름", (db) => month(db, 2026, 10, null), 2],
    ["사본이 D 다음 날 취득(JST)", (db) => month(db, 2026, 10, "2026-10-17T15:30:00.000Z"), 0], // JST 10-18 00:30
    ["그날 다른 경기 행이 있다", (db) => game(db, D, "c", "db"), 0],
  ];
  for (const [name, setup, expected] of cases) {
    await withDb((db) => {
      announce(db, D, "s", "db", "2026-10-16T05:00:00.000Z");
      announce(db, D, "db", "s", "2026-10-16T05:00:00.000Z");
      setup(db);
      assert.equal(collectionEvidence(db, TODAY).announcedWithoutGame.length, expected, `${name}: B ${expected}건이 아니다`);
    });
  }
});

test("⚠B — 예고보다 늦은 휴식 공표면 빠진다 · 이르거나 시각을 모르면 남는다", async () => {
  const D = "2026-10-17";
  const cases: [string, string | null, string | null, number][] = [
    ["늦은 휴식 공표", "2026-10-16T05:00:00.000Z", "2026-10-16T22:00:00.000Z", 0],
    ["이른 휴식 공표", "2026-10-16T22:00:00.000Z", "2026-10-16T05:00:00.000Z", 1],
    ["휴식 공표 시각 모름", "2026-10-16T05:00:00.000Z", null, 1],
    ["예고 시각 모름", null, "2026-10-16T22:00:00.000Z", 1],
  ];
  for (const [name, announcedAt, restAt, expected] of cases) {
    await withDb((db) => {
      announce(db, D, "s", "db", announcedAt);
      rest(db, "2026-10-17", D, restAt);
      assert.equal(collectionEvidence(db, TODAY).announcedWithoutGame.length, expected, `${name}: B ${expected}건이 아니다`);
    });
  }
});

test("⚠맥박 — starters_fetch 의 마지막 취득을 JST 날짜로 · 시각 모름은 빼고", () => withDb((db) => {
  rest(db, "2026-10-18", "2026-10-19", "2026-10-18T22:00:00.000Z"); // JST 10-19 07:00
  rest(db, "2026-10-19", "2026-10-20", null);
  announce(db, "2026-10-18", "g", "t", "2026-10-17T05:00:00.000Z");
  const e = collectionEvidence(db, TODAY);
  assert.equal(e.startersPulseDate, "2026-10-19");
  assert.equal(e.startersLatest, "2026-10-18");
}));

test("⚠다음 경기일 — 그 행의 시즌이 끝났는지 · NPB 가 그날 휴식을 공표했는지", () => withDb((db) => {
  // 2025 일본시리즈: 소프트뱅크(h) 4승 → 2025 시즌 종료
  for (const d of ["2025-10-25", "2025-10-26", "2025-10-28", "2025-10-29"]) game(db, d, "h", "t", { competition: "nipponSeries", homeRuns: 3, awayRuns: 1 });
  db.raw.prepare("INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2025, '2025-11-01', 'h', 't', 0, '', '18:30', 'x', ?)").run(NOW);
  rest(db, "2025-10-31", "2025-11-01", "2025-10-31T05:00:00.000Z");
  const e = collectionEvidence(db, "2025-11-01");
  assert.equal(e.nextGameDay, "2025-11-01");
  assert.equal(e.nextGameSeasonOver, true, "예비 경기 날의 시즌이 끝났다고 못 봤다");
  assert.equal(e.nextGameRestDeclared, true);
  assert.equal(e.latestSeasonOver, true);
}));

test("⚠개막일 — 다음 경기일의 시즌은 새 시즌이다(전년도 종료에 가려지지 않는다)", () => withDb((db) => {
  for (const d of ["2026-10-25", "2026-10-26", "2026-10-28", "2026-10-29"]) game(db, d, "h", "t", { competition: "nipponSeries", homeRuns: 3, awayRuns: 1 });
  db.raw.prepare("INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2027, '2027-03-26', 'g', 't', 0, '', '18:00', 'x', ?)").run(NOW);
  const e = collectionEvidence(db, "2027-03-26");
  assert.equal(e.latestSeasonOver, true, "전년도 종료를 못 봤다");
  assert.equal(e.nextGameSeasonOver, false, "새 시즌 개막일을 끝난 시즌으로 봤다");
}));

test("period 재료 — 오늘 이전 가장 최근 경기 행·치러짐 표시 · 오늘 이후 가장 가까운 예고", () => withDb((db) => {
  game(db, "2026-10-18", "g", "t", { status: "notPlayed" });
  game(db, "2026-10-21", "s", "d"); // 오늘 뒤 — 재료가 아니다
  played(db, "2026-10-17", "g", "t");
  announce(db, "2026-10-19", "g", "t", NOW); // 오늘 전 — 재료가 아니다
  announce(db, "2026-10-21", "s", "d", NOW);
  const e = collectionEvidence(db, TODAY);
  assert.equal(e.latestGameRowDate, "2026-10-18");
  assert.equal(e.latestPlayedMarkDate, "2026-10-17");
  assert.equal(e.nextAnnouncementDate, "2026-10-21");
  assert.equal(e.latestPlayed, "2026-10-21");
}));

test("빈 DB — 경기도 기록도 없다", () => withDb((db) => {
  const e = collectionEvidence(db, TODAY);
  assert.equal(e.latestPlayed, null);
  assert.equal(e.latestSeasonOver, false);
  assert.equal(e.startersPulseDate, null);
  assert.equal(e.careerPlayers, 0);
  assert.deepEqual([e.playedWithoutGame.length, e.announcedWithoutGame.length], [0, 0]);
}));
