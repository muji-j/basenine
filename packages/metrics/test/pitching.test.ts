import { test } from "node:test";
import assert from "node:assert/strict";
import { earnedRunAverage, homeRunsPer9, strikeoutsPer9, walksPer9, whip } from "../src/pitching.ts";
import type { PitchingLine } from "../src/lines.ts";

/** 아웃 486 = 정확히 162이닝. 자책 54 → ERA 3.00 */
const LINE: PitchingLine = {
  outs: 486, bf: 660, h: 150, hr: 18, bb: 45, ibb: 3, hbp: 9, so: 180, er: 54, r: 60,
};

const NONE: PitchingLine = {
  outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0,
};

test("방어율 = 자책점 × 9 / 이닝", () => {
  assert.equal(earnedRunAverage(LINE).value, 3);
  assert.equal(earnedRunAverage(LINE).denominator, 486, "분모는 아웃 카운트");
});

test("WHIP = (피안타 + 볼넷) / 이닝 — 사구는 넣지 않는다", () => {
  assert.equal(whip(LINE).value, (150 + 45) / 162);
});

test("K/9 · BB/9 · HR/9", () => {
  assert.equal(strikeoutsPer9(LINE).value, 10);
  assert.equal(walksPer9(LINE).value, (45 * 9) / 162);
  assert.equal(homeRunsPer9(LINE).value, 1);
});

test("⚠이닝을 부동소수로 다루지 않는다 — 1과 3분의 1이닝", () => {
  const short: PitchingLine = { ...LINE, outs: 4, er: 1 };
  assert.equal(earnedRunAverage(short).value, 6.75);
});

test("⚠등판하지 않은 투수는 0이 아니라 null이다 (M11)", () => {
  assert.equal(earnedRunAverage(NONE).value, null, "0.00은 무실점으로 오독된다");
  assert.equal(whip(NONE).value, null);
  assert.equal(strikeoutsPer9(NONE).value, null);
});

test("무자책 완투와 미등판은 다르다", () => {
  const shutout: PitchingLine = { ...LINE, outs: 27, er: 0 };
  assert.equal(earnedRunAverage(shutout).value, 0, "9이닝 무자책은 ERA 0이다");
});

test("전 지표가 분모를 함께 낸다 (M2)", () => {
  for (const f of [earnedRunAverage, whip, strikeoutsPer9, walksPer9, homeRunsPer9]) {
    assert.equal(f(LINE).denominator, 486);
  }
});
