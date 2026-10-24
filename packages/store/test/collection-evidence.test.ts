/**
 * 수집 판정의 **증거 SQL** — 판정(순수)은 `@bb-app/domain` 의 `collectionVerdict` 가 하고, 여기는 사실만 모은다.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D1 · D3 · D4 · D11 · T2)
 * ⚠**행으로 재현한다** — 마이그레이션을 적용한 임시 DB 에 실제로 넣고 잰다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectionVerdict } from "@bb-app/domain";
import { ensurePlayer, openDb, upsertBatting, upsertGame, upsertPitching, upsertProbablePitcher } from "../src/index.ts";
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

/**
 * ⚠⚠**통산 「받았다」 — 정규시즌 출장이 없는 선수의 페이지는 프로필 취득 시각으로 받았다**(2026-10-24 · 사용자 결정 A).
 *
 * 年度別成績 은 **정규시즌만** 싣는다. 1군 출장이 포스트시즌뿐인 선수는 페이지를 받아도 통산 행이 0 이라, 「받았다」를 통산 행의
 * `fetched_at` 으로만 재면 **영원히 못 받은 선수**다. 첫 실물: 2026 CS ファイナル 3차전(10-16)에 **대주자(走指 · 0타석)로 한 번** 나온
 * 포수 61665152 — `career-lag` 이 10-20 부터 수집 잡을 매일 실패시켜 배포가 막혔다(재취득 선정도 그를 매 실행 다시 받았다).
 * ⚠⚠**대체는 정규시즌 출장이 0 인 선수에게만이다**(이중 검토 P2) — 정규시즌에 나왔는데 통산 행이 아직 0 이면 그건 **데뷔 직후 사본이
 *   늦은 것**이다. 그 선수까지 프로필 시각으로 「받았다」고 하면 그 경기가 영영 안 실린다(통산 행이 없어 출장량 대조도 못 돈다).
 * ⚠**행으로 재현한다** — 마이그레이션을 적용한 임시 DB. 판정은 감시와 같은 함수(`collectionVerdict` · 유예 2)로 본다.
 */
const CAREER_TODAY = "2026-10-24";
const MONITOR = { grace: 2, backstopMargin: 0 };

function playedGame(db: Db, gameId: string, date: string, competition: string): void {
  upsertGame(db, {
    gameId, season: Number(date.slice(0, 4)), gameDate: date, awayCode: "f", homeCode: "h", gameNo: 1,
    status: "played", notPlayedReason: null, competition, sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
}
/** 치러진 경기에 `playerId` 가 한 번 던졌다 */
function pitchedIn(db: Db, gameId: string, date: string, playerId: string, competition: string): void {
  playedGame(db, gameId, date, competition);
  ensurePlayer(db, playerId, playerId, NOW);
  upsertPitching(db, {
    gameId, playerId, side: "away", decision: null,
    outs: 3, bf: 4, pitches: 15, h: 1, hr: 0, bb: 0, hbp: 0, so: 1, runs: 0, er: 0, wp: 0, balk: 0,
  });
}
/** 치러진 경기에 `playerId` 가 **대주자로만** 나왔다 — 타격 행 하나 · **0타석**(실물 61665152 의 모양 · `走指`) */
function ranIn(db: Db, gameId: string, date: string, playerId: string, competition: string): void {
  playedGame(db, gameId, date, competition);
  ensurePlayer(db, playerId, playerId, NOW);
  upsertBatting(db, {
    gameId, playerId, side: "away", battingOrder: "3", position: "走指",
    pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
}
/** 통산 투구 행 한 줄. `fetchedAt === null` 은 「모름」 */
function careerRow(db: Db, playerId: string, fetchedAt: string | null): void {
  db.raw.prepare(
    `INSERT INTO career_pitching (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf, outs,
       h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq)
     VALUES (?, 2026, '日本ハム', 1, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 1, 0, 0, 0, 1, 0, 0, 0, 0, 'npb', ?, 0)`,
  ).run(playerId, fetchedAt);
}
const profileAt = (db: Db, playerId: string, fetchedAt: string | null): void => {
  db.raw.prepare("UPDATE player SET profile_fetched_at = ? WHERE player_id = ?").run(fetchedAt, playerId);
};
/**
 * 공통 무대: 정규시즌 투수 `REG` 는 통산 행을 갖고 최신이다(통산 감시를 켠다 — 대상 0명이면 안 잰다).
 * `CSONLY` 는 **CS 1경기(10-16)에 대주자로만** 나왔고 통산 행이 **0** 이다(年度別成績 은 정규시즌만 싣는다 · 실물의 모양).
 */
function stage(db: Db, csProfileAt: string | null): void {
  pitchedIn(db, "c-reg", "2026-10-08", "REG", "regular");
  careerRow(db, "REG", "2026-10-21T09:00:00.000Z"); // JST 10-21 — 마지막 출장(10-08) 뒤
  profileAt(db, "REG", "2026-10-21T09:00:00.000Z");
  ranIn(db, "c-cs", "2026-10-16", "CSONLY", "climaxSeries");
  profileAt(db, "CSONLY", csProfileAt);
}

test("⚠⚠통산 행이 0 인 CS 출장자 — 프로필을 출장 뒤에 받았으면 받았다 · career-lag 이 안 운다", () => withDb((db) => {
  stage(db, "2026-10-21T09:52:27.518Z"); // JST 10-21 — CS 출장(10-16) 뒤(실물의 시각)
  const e = collectionEvidence(db, CAREER_TODAY);
  assert.equal(e.careerPlayers, 1, "전제가 틀렸다 — 통산 감시 대상이 0 이면 판정이 꺼진다");
  assert.equal(e.careerStalestPlayed, null, "통산 표가 없는 페이지를 받았는데 「아직 못 받았다」로 셌다 — 영원히 운다");
  assert.ok(!collectionVerdict(e, MONITOR).reasons.includes("career-lag"), "career-lag 이 헛되이 울었다 — 수집 잡이 매일 실패한다");
}));

test("⚠통산 행이 0 인 CS 출장자 — 프로필을 출장 전에 받았으면 아직 못 받았다 · 지금처럼 운다", () => withDb((db) => {
  stage(db, "2026-10-15T03:00:00.000Z"); // JST 10-15 — CS 출장(10-16) 전
  const e = collectionEvidence(db, CAREER_TODAY);
  assert.equal(e.careerStalestPlayed, "2026-10-16");
  assert.ok(collectionVerdict(e, MONITOR).reasons.includes("career-lag"), "출장 뒤에 안 받은 선수를 받았다고 봤다");
}));

test("⚠통산 행이 0 이고 프로필 시각도 모르면 못 받았다 — 모름을 받음으로 읽지 않는다(M11)", () => withDb((db) => {
  stage(db, null);
  assert.equal(collectionEvidence(db, CAREER_TODAY).careerStalestPlayed, "2026-10-16");
}));

/**
 * ⚠⚠**정규시즌에 나왔는데 통산 행이 아직 0 이면 못 받았다 — 프로필을 출장 뒤에 받았어도**(이중 검토 P2 · 2026-10-24).
 * npb.jp 선수 페이지는 경기 다음날에도 그 경기를 아직 안 싣는다(실측: 08-19 01:05 JST 사본이 08-18 경기를 안 담았다).
 * 데뷔전 다음날 받은 사본은 **통산 표가 아직 없다** — 그걸 「받았다」로 읽으면 그 데뷔는 영영 안 실리고 경보도 안 운다.
 * ⚠**투구 · 대주자(0타석) 두 갈래 다 잰다** — 「출장」은 타석이 아니다(선정기의 정규 경계 `ours_bat`·`ours_pit` 와 같다).
 */
test("⚠⚠정규 출장 + 통산 행 0 + 출장 뒤 프로필 — 데뷔 직후 사본이 늦은 것이다 · 지금처럼 운다(투구 · 대주자)", async () => {
  for (const [kind, appear] of [["투구", pitchedIn], ["대주자 0타석", ranIn]] as const) {
    await withDb((db) => {
      pitchedIn(db, "d-reg", "2026-10-08", "REG", "regular");
      careerRow(db, "REG", "2026-10-21T09:00:00.000Z");
      profileAt(db, "REG", "2026-10-21T09:00:00.000Z");
      appear(db, "d-debut", "2026-10-09", "DEBUT", "regular");
      profileAt(db, "DEBUT", "2026-10-10T03:00:00.000Z"); // JST 10-10 12:00 — 데뷔(10-09) 뒤에 받았지만 통산 표가 아직 없다
      const e = collectionEvidence(db, CAREER_TODAY);
      assert.equal(e.careerStalestPlayed, "2026-10-09", `${kind}: 정규시즌 데뷔의 늦은 사본을 「받았다」로 읽었다 — 그 경기가 영영 안 실린다`);
      assert.ok(collectionVerdict(e, MONITOR).reasons.includes("career-lag"), `${kind}: 늦은 사본인데 career-lag 이 꺼졌다`);
    });
  }
});

/**
 * ⚠**통산 행이 있는데 그 시각을 모르면 프로필 시각으로 메우지 않는다**(M11 · 2026-10-24).
 * 두 시각은 적재가 한 값으로 쓰므로 보통 같다(실측 CI 사본 1,651명 중 갈리는 선수 0명). 갈리는 것은 통산만 실패한(C8) 뒤뿐이고,
 * 그때 통산 행은 **옛 판**이다 — 프로필 시각을 빌리면 옛 통산을 「받았다」고 거짓말한다.
 */
test("⚠통산 행이 있는데 시각을 모르면 프로필을 받았어도 못 받았다 — 프로필 시각을 빌리지 않는다(M11)", () => withDb((db) => {
  stage(db, "2026-10-21T09:52:27.518Z");
  pitchedIn(db, "c-unk", "2026-10-09", "UNK", "regular");
  careerRow(db, "UNK", null);
  profileAt(db, "UNK", "2026-10-21T09:00:00.000Z");
  const e = collectionEvidence(db, CAREER_TODAY);
  assert.equal(e.careerUnknown, 1);
  assert.equal(e.careerStalestPlayed, "2026-10-09", "통산 행의 「모름」을 프로필 시각으로 메웠다");
}));

/**
 * ⚠**규칙은 한 벌이다**(M1) — 감시와 재취득 선정(`tools/emit-stale-player-ids.ts`)이 같은 「받았다」(`src/career-received.ts`)와
 * 같은 창(`src/refetch-window.ts`)을 쓴다. 한쪽만 고치면 「감시는 운다 · 선정은 안 뽑는다」(또는 그 반대)가 된다 —
 * 이번 결함이 바로 그 둘이 **같이** 틀린 모양이었다.
 */
test("⚠감시의 통산 SQL 이 「받았다」·창 조각을 한 벌로 쓴다 — 사본이 없다", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/collection-evidence.ts", import.meta.url)), "utf8");
  assert.match(src, /\$\{CAREER_RECEIVED_CTES\}/, "감시가 「받았다」 조각(career-received.ts)을 안 쓴다 — 규칙이 두 벌이 됐다");
  assert.match(src, /\$\{REFETCH_WINDOW_CTES\}/, "감시가 창 조각(refetch-window.ts)을 안 쓴다 — 창이 두 벌이 됐다");
  assert.doesNotMatch(src, /fetched_at\s+FROM\s+career_(batting|pitching)/, "감시에 「받았다」(통산 취득 시각) SQL 사본이 남았다");
  assert.doesNotMatch(src, /'-400 days'/, "감시에 창(400일 선) 사본이 남았다");
});
