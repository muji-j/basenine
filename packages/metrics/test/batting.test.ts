import { test } from "node:test";
import assert from "node:assert/strict";
import {
  babip, battingAverage, iso, onBasePercentage, ops, sluggingPercentage, strikeoutRate, walkRate,
} from "../src/batting.ts";
import type { BattingLine } from "../src/lines.ts";

/** 검증용. 소수가 딱 떨어지도록 고른 값이다. */
const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100, roe: 0,
};

const EMPTY: BattingLine = {
  pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0,
  bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
};

test("타율 = 안타 / 타수", () => {
  assert.equal(battingAverage(LINE).value, 0.3);
  assert.equal(battingAverage(LINE).denominator, 500);
});

test("출루율 = (안타+볼넷+사구) / (타수+볼넷+사구+희생플라이)", () => {
  assert.equal(onBasePercentage(LINE).value, 230 / 600);
  assert.equal(onBasePercentage(LINE).denominator, 600);
});

test("장타율 = 루타 / 타수", () => {
  // 단타 98 + 2×30 + 3×2 + 4×20 = 244
  assert.equal(sluggingPercentage(LINE).value, 244 / 500);
});

test("OPS = 출루율 + 장타율", () => {
  assert.equal(ops(LINE).value, 230 / 600 + 244 / 500);
});

test("ISO = 장타율 − 타율", () => {
  assert.equal(iso(LINE).value, 244 / 500 - 150 / 500);
});

test("BABIP = (안타−홈런) / (타수−삼진−홈런+희생플라이)", () => {
  assert.equal(babip(LINE).value, 130 / 400);
  assert.equal(babip(LINE).denominator, 400);
});

test("K%·BB%의 분모는 타석이며 BB%는 고의사구를 포함한다", () => {
  assert.equal(strikeoutRate(LINE).value, 100 / 600);
  assert.equal(walkRate(LINE).value, 70 / 600);
});

test("⚠전 지표가 분모를 함께 낸다 (M2)", () => {
  const all = [battingAverage, onBasePercentage, sluggingPercentage, ops, iso, babip, strikeoutRate, walkRate];
  for (const f of all) assert.equal(typeof f(LINE).denominator, "number");
});

test("⚠빈 성적은 0이 아니라 null이다 (M11)", () => {
  assert.equal(battingAverage(EMPTY).value, null);
  assert.equal(onBasePercentage(EMPTY).value, null);
  assert.equal(ops(EMPTY).value, null);
  assert.equal(iso(EMPTY).value, null);
  assert.equal(babip(EMPTY).value, null);
  assert.equal(strikeoutRate(EMPTY).value, null);
});

test("무안타와 미출장은 다르다", () => {
  const hitless: BattingLine = { ...EMPTY, pa: 10, ab: 10, so: 4 };
  assert.equal(battingAverage(hitless).value, 0, "10타수 무안타는 타율 0이다");
  assert.equal(battingAverage(EMPTY).value, null, "0타수는 타율이 없다");
});

test("성적을 전부 2배로 해도 비율은 변하지 않는다", () => {
  const doubled = Object.fromEntries(
    Object.entries(LINE).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  assert.equal(battingAverage(doubled).value, battingAverage(LINE).value);
  assert.equal(onBasePercentage(doubled).value, onBasePercentage(LINE).value);
  assert.equal(babip(doubled).value, babip(LINE).value);
  assert.equal(ops(doubled).value, ops(LINE).value);
});
