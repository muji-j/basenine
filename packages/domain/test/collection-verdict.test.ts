/**
 * 수집 판정(순수) — 「최신 경기가 며칠 전인가」가 아니라 「NPB 가 치렀다고 표시한 경기를 못 받았나」.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D1 · D2 · D4 · D11 · T1)
 * ⚠**시계도 DB 도 없다**(M6) — 증거는 `packages/store/src/collection-evidence.ts` 가 모으고 여기서는 판정만 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKSTOP_IN_SEASON_DAYS,
  BACKSTOP_OFFSEASON_DAYS,
  LOOKBACK_DAYS,
  STALE_REASON_KEYS,
  backstopDays,
  collectionVerdict,
} from "../src/collection-verdict.ts";
import type { CollectionEvidence } from "../src/collection-verdict.ts";

const TODAY = "2026-10-20";
/** `TODAY` 에서 n 일 전(음수면 뒤)의 날짜 */
const ago = (n: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** 아무 문제 없는 시즌 중 하루(어제 경기를 받았다) */
function evidence(over: Partial<CollectionEvidence> = {}): CollectionEvidence {
  return {
    today: TODAY,
    latestPlayed: ago(1),
    latestSeasonOver: false,
    playedWithoutGame: [],
    announcedWithoutGame: [],
    startersLatest: ago(0),
    startersPulseDate: ago(0),
    nextGameDay: ago(0),
    nextGameRestDeclared: false,
    nextGameSeasonOver: false,
    careerPlayers: 800,
    careerStalestPlayed: null,
    latestGameRowDate: ago(1),
    latestPlayedMarkDate: ago(1),
    nextAnnouncementDate: ago(0),
    ...over,
  };
}
const MONITOR = { grace: 2, backstopMargin: 0 } as const;
const BANNER = { grace: 3, backstopMargin: 1 } as const;

test("정상인 날은 사유가 없다", () => {
  assert.deepEqual(collectionVerdict(evidence(), MONITOR).reasons, []);
});

test("⚠휴식 — 치러짐 표시도 예고도 없으면 최신 경기가 며칠 전이든 사유가 없다", () => {
  const v = collectionVerdict(evidence({
    latestPlayed: ago(6), latestGameRowDate: ago(6), latestPlayedMarkDate: ago(6),
    startersLatest: ago(6), nextGameDay: ago(-2), nextAnnouncementDate: null,
  }), MONITOR);
  assert.deepEqual(v.reasons, [], "CS→일본시리즈 사이 6일째에 경보를 냈다 — 옛 규칙과 같은 헛경보다");
  assert.equal(v.period, "rest");
});

test("⚠A(치러짐 표시인데 경기 행 없음) — 유예 2일째부터 30일째까지 운다", () => {
  const at = (n: number) => collectionVerdict(evidence({ playedWithoutGame: [{ date: ago(n), homeCode: "g", awayCode: "t", seq: 0 }] }), MONITOR);
  assert.deepEqual(at(1).reasons, [], "유예 안(어제)인데 울었다");
  assert.deepEqual(at(2).reasons, ["game-missed"]);
  assert.deepEqual(at(LOOKBACK_DAYS).reasons, ["game-missed"], "30일째에 조용해졌다");
  assert.deepEqual(at(LOOKBACK_DAYS + 1).reasons, [], "31일째에도 울었다");
  assert.equal(at(2).missedPlayed.length, 1);
});

test("⚠B(예고인데 경기 행 없음 · 사본 낡음) — A 와 같은 창으로 운다 · 단위를 섞지 않는다", () => {
  const v = collectionVerdict(evidence({
    playedWithoutGame: [{ date: ago(4), homeCode: "g", awayCode: "t", seq: 0 }],
    announcedWithoutGame: [{ date: ago(3), teamCode: "s" }, { date: ago(3), teamCode: "db" }],
  }), MONITOR);
  assert.deepEqual(v.reasons, ["game-missed"]);
  assert.equal(v.missedPlayed.length, 1);
  assert.equal(v.missedAnnounced.length, 2);
  assert.equal(v.missedEarliest, ago(4), "가장 이른 누락일이 아니다");
});

test("⚠화면은 유예 3일 — 감시가 먼저 운다", () => {
  const e = evidence({ playedWithoutGame: [{ date: ago(2), homeCode: "g", awayCode: "t", seq: 0 }] });
  assert.deepEqual(collectionVerdict(e, MONITOR).reasons, ["game-missed"]);
  assert.deepEqual(collectionVerdict(e, BANNER).reasons, [], "화면이 감시와 같은 날 울었다 — 유예가 같다");
});

test("⚠백스톱 — 시즌 중 45 · 오프시즌 200 · 화면은 +1", () => {
  assert.equal(backstopDays(false), BACKSTOP_IN_SEASON_DAYS);
  assert.equal(backstopDays(true), BACKSTOP_OFFSEASON_DAYS);
  assert.equal(BACKSTOP_IN_SEASON_DAYS, 45);
  assert.equal(BACKSTOP_OFFSEASON_DAYS, 200);
  const lag = (age: number, over: boolean, o: { grace: number; backstopMargin: number }) =>
    collectionVerdict(evidence({ latestPlayed: ago(age), latestSeasonOver: over, latestGameRowDate: ago(age), latestPlayedMarkDate: ago(age) }), o)
      .reasons.includes("game-lag");
  assert.deepEqual([lag(44, false, MONITOR), lag(45, false, MONITOR), lag(46, false, MONITOR)], [false, false, true]);
  assert.deepEqual([lag(199, true, MONITOR), lag(200, true, MONITOR), lag(201, true, MONITOR)], [false, false, true]);
  assert.deepEqual([lag(45, false, BANNER), lag(46, false, BANNER), lag(47, false, BANNER)], [false, false, true]);
  assert.deepEqual([lag(200, true, BANNER), lag(201, true, BANNER), lag(202, true, BANNER)], [false, false, true]);
});

test("경기가 하나도 없으면 no-games 이고 period 는 unknown 이다", () => {
  const v = collectionVerdict(evidence({ latestPlayed: null, latestGameRowDate: null, latestPlayedMarkDate: null }), MONITOR);
  assert.ok(v.reasons.includes("no-games"));
  assert.ok(!v.reasons.includes("game-lag"), "경기가 없는데 나이를 쟀다");
  assert.equal(v.period, "unknown");
});

test("⚠starters-behind — NPB 가 그날 휴식을 공표했거나 그 시즌이 끝났으면 쉰다", () => {
  const behind = (over: Partial<CollectionEvidence>) =>
    collectionVerdict(evidence({ nextGameDay: ago(0), startersLatest: ago(1), ...over }), MONITOR).reasons.includes("starters-behind");
  assert.equal(behind({}), true, "다음 경기일이 오늘인데 예고가 어제까지다");
  assert.equal(behind({ nextGameRestDeclared: true }), false, "휴식 공표가 있는데 울었다(예비 경기 날)");
  assert.equal(behind({ nextGameSeasonOver: true }), false, "다음 경기일의 시즌이 끝났는데 울었다(일본시리즈 예비일)");
  assert.equal(behind({ nextGameDay: ago(-1) }), false, "다음 경기일이 내일인데 울었다");
});

test("⚠개막일 — 전년도 시즌이 끝났어도 다음 경기일의 시즌이 새 시즌이면 운다", () => {
  const v = collectionVerdict(evidence({
    latestSeasonOver: true, nextGameDay: ago(0), nextGameSeasonOver: false, startersLatest: ago(150),
    startersPulseDate: ago(0), latestPlayed: ago(150), latestGameRowDate: ago(150), latestPlayedMarkDate: ago(150),
  }), MONITOR);
  assert.ok(v.reasons.includes("starters-behind"), "개막일 예고 누락이 전년도 종료에 가려졌다");
});

test("⚠starters-lag — 맥박(받은 날)으로 잰다 · 기록이 하나도 없으면 안 잰다", () => {
  const lag = (over: Partial<CollectionEvidence>) =>
    collectionVerdict(evidence(over), MONITOR).reasons.includes("starters-lag");
  assert.equal(lag({ startersPulseDate: ago(2) }), false);
  assert.equal(lag({ startersPulseDate: ago(3) }), true);
  assert.equal(lag({ startersPulseDate: null }), true, "예고 기록은 있는데 맥박을 모르면 운다(M11)");
  assert.equal(lag({ startersPulseDate: null, startersLatest: null }), false, "기록이 하나도 없는데 울었다");
});

test("career-lag — 기존 규칙 그대로(유예 + 2일) · 대상 0명이면 안 잰다", () => {
  const lag = (over: Partial<CollectionEvidence>) =>
    collectionVerdict(evidence(over), MONITOR).reasons.includes("career-lag");
  assert.equal(lag({ careerStalestPlayed: ago(4) }), false);
  assert.equal(lag({ careerStalestPlayed: ago(5) }), true);
  assert.equal(lag({ careerStalestPlayed: ago(30), careerPlayers: 0 }), false);
});

test("⚠period 결정표 — 사례마다 정확히 한 값", () => {
  const p = (over: Partial<CollectionEvidence>) => collectionVerdict(evidence(over), MONITOR).period;
  // 일본시리즈 최종전 다음 날
  assert.equal(p({ latestSeasonOver: true, latestGameRowDate: ago(1), latestPlayedMarkDate: ago(1), nextAnnouncementDate: null }), "games");
  // 그다음 날(예비 경기 행만 남음)
  assert.equal(p({ latestSeasonOver: true, latestPlayed: ago(2), latestGameRowDate: ago(2), latestPlayedMarkDate: ago(2), nextAnnouncementDate: null }), "offseason");
  // 시즌 중 월요일(어제 경기 있음)
  assert.equal(p({ nextAnnouncementDate: null }), "games");
  // 시즌 중 화요일 아침(어제 휴일 · 오늘 예고)
  assert.equal(p({ latestGameRowDate: ago(2), latestPlayedMarkDate: ago(2), nextAnnouncementDate: ago(0) }), "games");
  // CS→일본시리즈 사이 3일째
  assert.equal(p({ latestGameRowDate: ago(3), latestPlayedMarkDate: ago(3), nextAnnouncementDate: null }), "rest");
  // DB 가 빔
  assert.equal(p({ latestPlayed: null, latestGameRowDate: null, latestPlayedMarkDate: null, nextAnnouncementDate: null }), "unknown");
});

test("⚠판정이 내는 사유는 전부 STALE_REASON_KEYS 에 있다 — 화면 문구표가 이 목록을 따른다", () => {
  const all = collectionVerdict(evidence({
    playedWithoutGame: [{ date: ago(3), homeCode: "g", awayCode: "t", seq: 0 }],
    latestPlayed: ago(300), latestGameRowDate: ago(300), latestPlayedMarkDate: ago(300),
    nextGameDay: ago(0), startersLatest: ago(10), startersPulseDate: ago(10), careerStalestPlayed: ago(30),
  }), MONITOR).reasons;
  for (const r of all) assert.ok((STALE_REASON_KEYS as readonly string[]).includes(r), `목록에 없는 사유 ${r}`);
  assert.deepEqual(new Set(all), new Set(["game-missed", "game-lag", "career-lag", "starters-behind", "starters-lag"]));
  assert.deepEqual([...STALE_REASON_KEYS], ["no-games", "game-missed", "game-lag", "career-lag", "starters-behind", "starters-lag"]);
});
