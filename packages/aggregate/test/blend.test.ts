/**
 * 리그를 넘어 이적한 선수의 **시즌 합계를 재는 상수**.
 *
 * ⚠**이것이 날조인지 아닌지가 이 파일의 주제다.**
 * wOBA는 타석 가중 평균이므로 `wOBA(합계)×PA(합계) = Σ wOBA(리그i)×PA(리그i)` 가 항등식이다.
 * 따라서 평균 wOBA를 **타석으로 가중**하면 `wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ)` 가
 * **정확히** 성립한다 — 근사가 아니다. 그 사실을 여기서 수로 고정한다.
 *
 * ⚠**단 그 항등식은 「양 리그의 wOBA 계수가 같을 때」의 이야기다**(2026-08-20).
 * 계수를 리그·시즌마다 유도하기 시작했으므로 **계수가 다르면 근사가 된다** —
 * 아래 마지막 두 본이 그 경계를 나눠 못 박는다. 「정확」이라는 말이 언제 참인지가 이 파일의 값이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendConstants } from "../src/leaderboard.ts";
import { WOBA_SCALE, WOBA_WEIGHTS, sumBatting, wraa } from "@bb-app/metrics";
import type { BattingLine, LeagueConstants } from "@bb-app/metrics";

const CL: LeagueConstants = {
  season: 2026, league: "central", averageWoba: 0.31, cFip: 2.9, runsPerPa: 0.108,
  wobaWeights: WOBA_WEIGHTS, wobaScale: WOBA_SCALE,
};
const PL: LeagueConstants = {
  season: 2026, league: "pacific", averageWoba: 0.33, cFip: 3.3, runsPerPa: 0.121,
  wobaWeights: WOBA_WEIGHTS, wobaScale: WOBA_SCALE,
};

function line(pa: number, h: number, hr: number): BattingLine {
  return { pa, ab: pa, h, double: 0, triple: 0, hr, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0 };
}

test("표본이 한쪽뿐이면 그 리그의 상수 그대로다 — 리그를 넘지 않은 선수에게는 아무 일도 없다", () => {
  assert.deepEqual(blendConstants([{ constants: CL, weight: 400 }, { constants: PL, weight: 0 }]), CL);
  assert.deepEqual(blendConstants([{ constants: CL, weight: 0 }, { constants: PL, weight: 250 }]), PL);
});

test("표본이 0뿐이어도 NaN을 만들지 않는다 — 나눌 것이 없으면 첫 상수를 쓴다", () => {
  const out = blendConstants([{ constants: CL, weight: 0 }, { constants: PL, weight: 0 }]);
  assert.equal(out.averageWoba, CL.averageWoba);
  assert.ok(Number.isFinite(out.runsPerPa));
});

test("가중은 표본에 비례한다 — 절반씩이면 한가운데다", () => {
  const out = blendConstants([{ constants: CL, weight: 100 }, { constants: PL, weight: 100 }]);
  assert.ok(Math.abs(out.averageWoba - 0.32) < 1e-12);
  assert.ok(Math.abs(out.cFip - 3.1) < 1e-12);
  assert.ok(Math.abs(out.runsPerPa - 0.1145) < 1e-12);
});

test("이름은 표본이 많은 쪽을 남긴다 — 「어느 리그 기준인가」에 답할 수 있어야 한다", () => {
  assert.equal(blendConstants([{ constants: CL, weight: 105 }, { constants: PL, weight: 97 }]).league, "central");
  assert.equal(blendConstants([{ constants: CL, weight: 97 }, { constants: PL, weight: 105 }]).league, "pacific");
});

/**
 * ⚠**이 한 본이 「날조가 아니다」의 증명이다.**
 * 가중 상수로 합계 라인을 재면 리그별로 잰 wRAA의 **합과 정확히 같다**.
 * 이 등식이 깨지면 화면의 wRAA·wRC+는 어느 쪽 리그에도 속하지 않는 수가 된다.
 */
test("wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ) — 계수가 같으면 근사가 아니라 항등식이다", () => {
  const cl = line(105, 30, 5);
  const pl = line(97, 21, 2);
  const parts = wraa(cl, CL).value! + wraa(pl, PL).value!;
  const lc = blendConstants([{ constants: CL, weight: cl.pa }, { constants: PL, weight: pl.pa }]);
  const total = wraa(sumBatting([cl, pl]), lc).value!;
  assert.ok(Math.abs(total - parts) < 1e-9, `합계 ${total} 과 리그별 합 ${parts} 이 다르다`);
});

/**
 * ⚠**계수가 리그마다 다르면 위 항등식은 깨진다 — 그 사실을 숨기지 않는다**(2026-08-20).
 *
 * 왜 깨지는가: 합계 라인의 wOBA 는 **혼합 계수 하나**로 계산되는데, 리그별 wOBA 는
 * **각자의 계수**로 계산된다. 계수가 다르면 「합계의 wOBA」가 「두 wOBA 의 가중평균」이 아니다.
 *
 * ⚠**얼마나 깨지는지를 수로 못 박는다.** 여기 쓰는 값은 실제 두 리그 계수의 차보다
 * **훨씬 크게 벌린 것**(홈런 2.00 대 2.20)이고, 그런데도 어긋남이 작다는 것이 요점이다.
 * ⚠**대상은 리그를 넘어 이적한 선수뿐**이고, 리그를 안 넘으면 혼합 자체가 일어나지 않는다
 * (위 「표본이 한쪽뿐이면」 본이 그것을 못 박는다).
 */
test("⚠계수가 리그마다 다르면 가법성이 근사가 된다 — 어긋남의 크기를 못 박는다", () => {
  const wide = (hr: number, single: number): LeagueConstants["wobaWeights"] => ({
    ...WOBA_WEIGHTS, hr, single,
  });
  const c: LeagueConstants = { ...CL, wobaWeights: wide(2.0, 0.84), wobaScale: 1.22 };
  const p: LeagueConstants = { ...PL, wobaWeights: wide(2.2, 0.89), wobaScale: 1.26 };
  const cl = line(105, 30, 5);
  const pl = line(97, 21, 2);
  const parts = wraa(cl, c).value! + wraa(pl, p).value!;
  const lc = blendConstants([{ constants: c, weight: cl.pa }, { constants: p, weight: pl.pa }]);
  const total = wraa(sumBatting([cl, pl]), lc).value!;
  const gap = Math.abs(total - parts);
  // **정확하지 않다** — 이 본이 실패하면 위 항등식 본과 모순이므로 둘 다 다시 봐야 한다
  assert.ok(gap > 1e-9, `계수가 다른데 정확히 같다 — 혼합이 계수를 안 섞고 있다(gap ${gap})`);
  // 그리고 **작다**. 단위는 득점이고, 202타석짜리 선수에게 0.2점 미만이다
  assert.ok(gap < 0.2, `가법성 오차가 ${gap.toFixed(4)}점이다 — 커졌으면 화면에 적어야 한다`);
});

/**
 * ⚠**상수를 무에서 만들지 않는다.**
 * 리그 번들이 0개가 되는 경우는 실재한다 — 투수 기록이 아직 하나도 없는 시즌 초가 그렇다.
 * 거기서 기본값을 지어내면 그 값으로 계산된 wRC+가 화면까지 나가고,
 * **아무도 그것이 지어낸 값인 줄 모른다.** 멈추는 쪽이 맞다(M7).
 */
test("리그 상수가 하나도 없으면 조용히 넘어가지 않고 멈춘다", () => {
  assert.throws(() => blendConstants([]), /리그 상수가 하나도 없다/);
});
