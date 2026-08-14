import { test } from "node:test";
import assert from "node:assert/strict";
import { fip, wraa, wrcPlus } from "../src/advanced.ts";
import { leagueConstants, sumBatting, sumPitching } from "../src/league.ts";
import { earnedRunAverage } from "../src/pitching.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100,
};

const P: PitchingLine = {
  outs: 486, bf: 660, h: 150, hr: 18, bb: 45, ibb: 3, hbp: 9, so: 180, er: 54, r: 60,
};

/** 리그 = 이 선수 한 명. 따라서 이 선수가 곧 리그 평균이다. */
const LC = leagueConstants({
  season: 2026, league: "central",
  batting: sumBatting([LINE]), pitching: sumPitching([P]), runs: 60,
});

test("⚠성질: 리그 평균과 같은 선수의 wRAA는 0이다", () => {
  assert.ok(Math.abs(wraa(LINE, LC).value!) < 1e-9);
  assert.equal(wraa(LINE, LC).denominator, 600);
});

test("⚠성질: 리그 전체의 wRC+는 100이다", () => {
  assert.ok(Math.abs(wrcPlus(LINE, LC).value! - 100) < 1e-9);
});

test("⚠성질: 리그 전체의 FIP는 리그 ERA와 같다", () => {
  const leagueEra = earnedRunAverage(P).value!;
  assert.ok(Math.abs(fip(P, LC).value! - leagueEra) < 1e-9);
});

test("리그 평균보다 나은 타자는 wRAA > 0, wRC+ > 100", () => {
  const better: BattingLine = { ...LINE, h: 170, hr: 30, double: 35 };
  assert.ok(wraa(better, LC).value! > 0);
  assert.ok(wrcPlus(better, LC).value! > 100);
});

test("리그 평균보다 못한 타자는 wRAA < 0, wRC+ < 100", () => {
  const worse: BattingLine = { ...LINE, h: 110, hr: 8, double: 15, so: 140 };
  assert.ok(wraa(worse, LC).value! < 0);
  assert.ok(wrcPlus(worse, LC).value! < 100);
});

test("wRAA는 타석 수에 비례한다 — 같은 wOBA라면 많이 나올수록 기여가 크다", () => {
  const doubled = Object.fromEntries(
    Object.entries({ ...LINE, h: 170, hr: 30, double: 35 }).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  const single: BattingLine = { ...LINE, h: 170, hr: 30, double: 35 };
  assert.ok(Math.abs(wraa(doubled, LC).value! - 2 * wraa(single, LC).value!) < 1e-9);
});

test("wRC+는 표본을 2배로 해도 변하지 않는다 — 비율 지표이기 때문", () => {
  const single: BattingLine = { ...LINE, h: 170, hr: 30, double: 35 };
  const doubled = Object.fromEntries(
    Object.entries(single).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  assert.ok(Math.abs(wrcPlus(doubled, LC).value! - wrcPlus(single, LC).value!) < 1e-9);
});

test("FIP는 삼진이 늘면 낮아지고 볼넷이 늘면 높아진다", () => {
  assert.ok(fip({ ...P, so: 200 }, LC).value! < fip(P, LC).value!);
  assert.ok(fip({ ...P, bb: 60 }, LC).value! > fip(P, LC).value!);
  assert.ok(fip({ ...P, hr: 30 }, LC).value! > fip(P, LC).value!);
});

test("⚠미출장·미등판은 null이다", () => {
  const noPa: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0,
  };
  const noOuts: PitchingLine = { outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0 };
  assert.equal(wraa(noPa, LC).value, null);
  assert.equal(wrcPlus(noPa, LC).value, null);
  assert.equal(fip(noOuts, LC).value, null);
});
