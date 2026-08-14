import { test } from "node:test";
import assert from "node:assert/strict";
import { WOBA_SCALE, WOBA_WEIGHTS, woba, wobaRaw } from "../src/woba.ts";
import type { BattingLine } from "../src/lines.ts";

const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100,
};

test("wOBA 계수는 1.02 공개값과 일치한다", () => {
  assert.deepEqual({ ...WOBA_WEIGHTS }, {
    bb: 0.692, hbp: 0.73, roe: 0.966, single: 0.865, double: 1.334, triple: 1.725, hr: 2.065,
  });
  assert.equal(WOBA_SCALE, 1.24);
});

test("⚠wOBA는 볼넷에서 고의사구를 뺀다", () => {
  const w = WOBA_WEIGHTS;
  const single = 150 - 30 - 2 - 20; // 98
  // 失策出塁 항은 공개 소스가 없어 생략한다(정의서에 명시).
  const numerator =
    w.bb * (70 - 5) + w.hbp * 10 + w.single * single + w.double * 30 + w.triple * 2 + w.hr * 20;
  const denominator = 500 + (70 - 5) + 10 + 20;
  assert.ok(Math.abs(woba(LINE).value! - numerator / denominator) < 1e-12);
  assert.equal(woba(LINE).denominator, denominator);
});

test("고의사구가 늘면 wOBA 분모와 분자가 함께 줄어든다", () => {
  const moreIbb: BattingLine = { ...LINE, ibb: 20 };
  assert.notEqual(woba(moreIbb).value, woba(LINE).value);
  assert.equal(woba(moreIbb).denominator, 500 + (70 - 20) + 10 + 20);
});

test("wOBA는 홈런이 늘면 증가한다", () => {
  const more: BattingLine = { ...LINE, h: 151, hr: 21, ab: 501 };
  assert.ok(woba(more).value! > woba(LINE).value!);
});

test("wOBA는 단타보다 장타에 큰 가중을 준다", () => {
  const w = WOBA_WEIGHTS;
  assert.ok(w.single < w.double);
  assert.ok(w.double < w.triple);
  assert.ok(w.triple < w.hr);
  assert.ok(w.bb < w.single, "볼넷은 단타보다 가치가 낮다");
});

test("⚠타석이 없으면 null이다", () => {
  const empty: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0,
  };
  assert.equal(woba(empty).value, null);
  assert.equal(wobaRaw(empty), null);
});

test("성적을 전부 2배로 해도 wOBA는 변하지 않는다", () => {
  const doubled = Object.fromEntries(
    Object.entries(LINE).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  assert.ok(Math.abs(woba(doubled).value! - woba(LINE).value!) < 1e-12);
});
