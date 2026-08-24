/**
 * **球数/アウト 가 `Infinity` 가 되지 않는다** — 분모가 아웃 카운트인데 `0` 이 실재한다.
 *
 * ⚠**같은 계산이 세 벌이었고 하나만 안전하지 않았다**(2026-08-24 · 감사 P3 #29).
 * `query.ts` 안에 이 식이 세 자리에 있는데 둘은 `outs === 0` 을 막고 **한 곳만 그냥 나눴다** —
 * `pitches / 0 = Infinity`. M1 이 막으려는 병(같은 식이 여러 벌)의 교과서적인 결과다.
 *
 * ⚠**실재하는 입력이다**: `pitching_line` **63,315행 중 773행**이 `outs=0 & pitches>0` 이다
 * (아웃을 못 잡고 강판된 등판 · 실측 2026-08-24).
 *
 * ⚠**「0」이 아니라 「모른다」다**(M11). 아웃이 0이면 효율을 **말할 수 없다** —
 * 0 으로 때우면 그 투수가 **효율 1위**가 되고, `Infinity` 로 두면 화면이 하류 포맷터의
 * 부수효과에 목숨을 걸게 된다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rate } from "@bb-app/metrics";

/**
 * ⚠**정본은 `rate()` 하나다.** 이 시험은 그 성질을 못 박아, 누가 다시 손으로 나누면
 * **여기가 아니라 그 자리에서** 이유를 알 수 있게 한다.
 */
test("⚠아웃이 0이면 값이 null 이다 — Infinity 도 0 도 아니다", () => {
  const r = rate(21, 0);
  assert.equal(r.value, null, "아웃 0 인데 값을 냈다");
  assert.equal(r.denominator, 0, "분모를 안 들고 있다(M2)");
});

test("⚠직접 나누면 Infinity 가 된다 — 이것이 고친 대상이다", () => {
  assert.equal(21 / 0, Infinity);
  assert.notEqual(rate(21, 0).value, Infinity, "rate() 가 Infinity 를 흘렸다");
});

test("아웃이 있으면 평소대로 나눈다", () => {
  const r = rate(90, 21);
  assert.ok(r.value !== null);
  assert.ok(Math.abs(r.value! - 90 / 21) < 1e-12);
  assert.equal(r.denominator, 21);
});

/** ⚠**분모가 음수면 던진다** — 조용히 이상한 값을 내지 않는다 */
test("⚠분모가 음수면 던진다", () => {
  assert.throws(() => rate(1, -1), RangeError);
});
