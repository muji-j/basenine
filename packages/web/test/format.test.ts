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
