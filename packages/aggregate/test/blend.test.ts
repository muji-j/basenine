/**
 * 리그를 넘어 이적한 선수의 **시즌 합계를 재는 상수**.
 *
 * ⚠**이것이 날조인지 아닌지가 이 파일의 주제다.**
 * wOBA는 타석 가중 평균이므로 `wOBA(합계)×PA(합계) = Σ wOBA(리그i)×PA(리그i)` 가 항등식이다.
 * 따라서 평균 wOBA를 **타석으로 가중**하면 `wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ)` 가
 * **정확히** 성립한다 — 근사가 아니다. 그 사실을 여기서 수로 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendConstants } from "../src/leaderboard.ts";
import { sumBatting, wraa } from "@bb-app/metrics";
import type { BattingLine, LeagueConstants } from "@bb-app/metrics";

const CL: LeagueConstants = { season: 2026, league: "central", averageWoba: 0.31, cFip: 2.9, runsPerPa: 0.108 };
const PL: LeagueConstants = { season: 2026, league: "pacific", averageWoba: 0.33, cFip: 3.3, runsPerPa: 0.121 };

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
test("wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ) — 근사가 아니라 항등식이다", () => {
  const cl = line(105, 30, 5);
  const pl = line(97, 21, 2);
  const parts = wraa(cl, CL).value! + wraa(pl, PL).value!;
  const lc = blendConstants([{ constants: CL, weight: cl.pa }, { constants: PL, weight: pl.pa }]);
  const total = wraa(sumBatting([cl, pl]), lc).value!;
  assert.ok(Math.abs(total - parts) < 1e-9, `합계 ${total} 과 리그별 합 ${parts} 이 다르다`);
});
