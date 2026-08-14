import { test } from "node:test";
import assert from "node:assert/strict";
import { rate } from "../src/rate.ts";

test("값과 분모를 함께 돌려준다", () => {
  assert.deepEqual(rate(3, 10), { value: 0.3, denominator: 10 });
});

test("⚠분모가 0이면 value는 null — 0이 아니다 (M11)", () => {
  assert.deepEqual(rate(0, 0), { value: null, denominator: 0 });
  assert.deepEqual(rate(5, 0), { value: null, denominator: 0 });
});

test("분자가 0인 것과 분모가 0인 것은 다르다", () => {
  assert.equal(rate(0, 10).value, 0, "10타수 0안타는 타율 0이다");
  assert.equal(rate(0, 0).value, null, "0타수는 타율이 없다");
});

test("음수 분모는 프로그래밍 오류다", () => {
  assert.throws(() => rate(1, -1), RangeError);
});
