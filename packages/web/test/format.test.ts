import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_VALUE,
  avg3,
  dec1,
  dec2,
  denominator,
  fullDate,
  gameDate,
  innings,
  int,
  pct1,
  rateParts,
  signed1,
  throwsBats,
} from "../src/format.ts";

test("타율은 선행 0을 버린다 — 야구 관례", () => {
  assert.equal(avg3(0.3167), ".317");
  assert.equal(avg3(1.0236), "1.024");
  assert.equal(avg3(0), ".000");
});

test("음수 비율도 선행 0을 버린다", () => {
  assert.equal(avg3(-0.05), "-.050");
});

test("방어율은 선행 0을 남긴다", () => {
  assert.equal(dec2(0.98), "0.98");
  assert.equal(dec2(2.7), "2.70");
});

test("0이 기준인 값은 부호를 항상 붙인다", () => {
  assert.equal(signed1(44.2), "+44.2");
  assert.equal(signed1(-3.06), "-3.1");
  assert.equal(signed1(0), "+0.0");
});

test("값 없음은 0과 다르게 보인다(M11)", () => {
  assert.equal(avg3(null), NO_VALUE);
  assert.equal(dec2(null), NO_VALUE);
  assert.equal(dec1(null), NO_VALUE);
  assert.equal(int(null), NO_VALUE);
  assert.equal(innings(null), NO_VALUE);
  assert.equal(pct1(null), NO_VALUE);
  assert.notEqual(avg3(0), avg3(null));
  assert.notEqual(int(0), int(null));
});

test("NaN·Infinity도 값 없음으로 다룬다 — 화면에 NaN을 내보내지 않는다", () => {
  assert.equal(avg3(Number.NaN), NO_VALUE);
  assert.equal(dec2(Number.POSITIVE_INFINITY), NO_VALUE);
});

test("아웃 카운트는 야구 이닝 표기가 된다", () => {
  assert.equal(innings(20), "6.2");
  assert.equal(innings(21), "7");
  assert.equal(innings(0), "0");
});

test("분모 표기는 단위를 붙인다", () => {
  assert.equal(denominator(442), "442打席");
  assert.equal(denominator(382, "打数"), "382打数");
});

test("rateParts는 값과 분모를 항상 함께 낸다(M2)", () => {
  const parts = rateParts({ value: 0.3167, denominator: 382 }, "打数");
  assert.deepEqual(parts, { value: ".317", den: "382打数" });
});

test("분모 0이면 값이 없고 분모는 0으로 남는다 — 「0타수 .000」을 만들지 않는다", () => {
  const parts = rateParts({ value: null, denominator: 0 }, "打数");
  assert.equal(parts.value, NO_VALUE);
  assert.equal(parts.den, "0打数");
});

test("날짜 표기", () => {
  assert.equal(gameDate("2026-08-14"), "8月14日");
  assert.equal(fullDate("2026-08-14"), "2026年8月14日");
  assert.equal(gameDate("なにか"), "なにか");
});

test("투타 표기 — 미상은 값 없음", () => {
  assert.equal(throwsBats("right", "left"), "右投左打");
  assert.equal(throwsBats("both", "both"), "両投両打");
  assert.equal(throwsBats(null, "left"), NO_VALUE);
});

// ── 반올림 ──────────────────────────────────────────────────────────────

/**
 * ⚠**`toFixed`는 야구 관례대로 반올림하지 않는다.** 이진 부동소수 때문에 정확히 반이 되는
 * 값이 내림된다. 실측(2026-08-16 외부 대조): 中込의 방어율 `11×27÷40 = 7.425`를
 * `toFixed(2)`가 **7.42**로 냈고, npb.jp를 포함한 모든 공표는 **7.43**이었다.
 *
 * 0.01 차이는 작지만 **다른 사이트와 다른 숫자를 내는 것 자체가 신뢰 문제**다.
 */
test("⚠정확히 반인 값을 올린다 — toFixed는 내린다", () => {
  assert.equal(dec2(7.425), "7.43", `toFixed는 ${(7.425).toFixed(2)}를 낸다`);
  assert.equal(dec2(2.675), "2.68", `toFixed는 ${(2.675).toFixed(2)}를 낸다`);
  assert.equal(dec2(1.005), "1.01", `toFixed는 ${(1.005).toFixed(2)}를 낸다`);
});

test("음수도 절댓값 기준으로 올린다", () => {
  assert.equal(dec2(-7.425), "-7.43");
  assert.equal(signed1(-1.25), "-1.3");
});

test("반이 아닌 값은 그대로 반올림한다 — 보정이 값을 밀지 않는다", () => {
  assert.equal(dec2(2.93), "2.93");
  assert.equal(dec2(2.934), "2.93");
  assert.equal(dec2(2.936), "2.94");
  assert.equal(avg3(0.3167), ".317");
  assert.equal(avg3(0.3164), ".316");
});

test("큰 값에서도 보정이 통한다 — EPSILON은 1.0 근처의 절대 오차다", () => {
  assert.equal(dec1(227.05), "227.1");
  assert.equal(dec1(1234.55), "1234.6");
});

test("0과 아주 작은 값", () => {
  assert.equal(dec2(0), "0.00");
  assert.equal(avg3(0), ".000");
  assert.equal(signed1(0), "+0.0");
});
