/**
 * `starters-behind` 의 술어 한 벌 — 감시(`collectionVerdict`)와 화면(試合의 「次の予告先発」 ⑤)이 같이 쓴다.
 *
 * 설계: `docs/superpowers/specs/2026-10-24-postseason-display-design.md` D5 · §9
 * ⚠**화면만 「예고 기록이 한 건도 없음」도 못 받은 것으로 친다**(콜드 리뷰 지적 4) — **감시의 측정 범위는 안 바꾼다.**
 *   그 경우 감시가 우는 것으로 바꾸면 일일 잡이 붉어질 수 있다(별건).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionVerdict, startersBehind } from "../src/collection-verdict.ts";
import type { CollectionEvidence } from "../src/collection-verdict.ts";

const TODAY = "2026-10-24";

function evidence(over: Partial<CollectionEvidence> = {}): CollectionEvidence {
  return {
    today: TODAY,
    latestPlayed: "2026-10-17",
    latestSeasonOver: false,
    playedWithoutGame: [],
    announcedWithoutGame: [],
    startersLatest: "2026-10-18",
    startersPulseDate: TODAY,
    nextGameDay: TODAY,
    nextGameRestDeclared: false,
    nextGameSeasonOver: false,
    careerPlayers: 0,
    careerStalestPlayed: null,
    latestGameRowDate: "2026-10-17",
    latestPlayedMarkDate: "2026-10-17",
    nextAnnouncementDate: null,
    ...over,
  };
}
const MONITOR = { grace: 2, backstopMargin: 0 } as const;
const monitor = (e: CollectionEvidence): boolean => collectionVerdict(e, MONITOR).reasons.includes("starters-behind");

test("⚠日本S 1차전 당일인데 예고가 10/18 에서 멈췄다 — 화면도 감시도 운다(같은 술어)", () => {
  const e = evidence();
  assert.equal(startersBehind(e), true);
  assert.equal(monitor(e), true);
});

test("⚠예고 기록이 한 건도 없으면 화면은 운다 · 감시는 재지 않는다(측정 범위 그대로)", () => {
  const e = evidence({ startersLatest: null });
  assert.equal(startersBehind(e), true, "화면이 「예고 기록이 없음」을 정상으로 덮었다");
  assert.equal(monitor(e), false, "감시의 측정 범위가 바뀌었다 — 이 PR 의 범위 밖이다(설계 §9)");
});

test("가드는 감시와 같다 — 휴식 공표 · 다음 경기일 시즌 종료 · 다음 경기일이 내일 · 다음 경기일 모름 · 예고가 그날까지 왔다", () => {
  for (const [name, over] of [
    ["휴식 공표", { nextGameRestDeclared: true }],
    ["그 시즌 종료", { nextGameSeasonOver: true }],
    ["다음 경기일이 내일", { nextGameDay: "2026-10-25" }],
    ["다음 경기일 모름", { nextGameDay: null }],
    ["예고가 그날까지", { startersLatest: TODAY }],
  ] as const) {
    const e = evidence(over);
    assert.equal(startersBehind(e), false, `${name}인데 화면이 울었다`);
    assert.equal(monitor(e), false, `${name}인데 감시가 울었다`);
  }
});
