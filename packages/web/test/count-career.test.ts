/**
 * **カウント別의 「今季 / 通算」 전환.**
 *
 * ⚠**왜 이 축에만 붙였는가 — 표본을 재서 골랐다**(2026-08-27).
 * 「전환할 수 있으니 전부 전환한다」는 탭만 늘리고 정보를 안 더한다.
 * 실측(2025 · 규정타석급 타자 40명 · 30타석 미만 칸의 비율 · 今季 → 通算):
 *
 * | 축 | 今季 | 通算 | 판정 |
 * |---|---|---|---|
 * | 対左右 · 走者状況 · 本拠地 | **0%** | 0% | 한 시즌으로 충분 — 붙이지 않았다 |
 * | 打順 | 53.2% | 32.2% | 개선되나 **구조적 잔여**(안 서는 타순은 영영 얇다) |
 * | 球場別 | 54.0% | **62.2%** | ⚠**통산이 더 나쁘다** — 9시즌이면 지방구장이 더 는다 |
 * | 対戦球団別 | 52.7% | **32.3%** | ✅ 통산이 고친다 → 스플릿 축으로 붙였다 |
 * | **カウント別** | **33.8%** | **14.0%** | ✅ 통산이 고친다 → 이 블록 |
 *
 * ⚠**볼카운트는 9시즌 전 시즌 100% 보유**다(482,563/482,563 실측) —
 * 통산이 **결측을 섞지 않는다**(M11). 이 확인 없이 통산을 만들면 「미수집을 0으로 메우는」 쪽이 된다.
 *
 * ⚠**「通算」이라는 말만으로는 거짓이다** — 화면이 보유 범위를 말한다(`火消し`와 같은 규칙).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import { countBlockOf } from "../src/query.ts";
import { BATTING_LINE, context, playerPage } from "./fixtures.ts";
import type { CountLine } from "@bb-app/aggregate";

function blockOf(html: string, id: string): string {
  const m = new RegExp(`<section class="block"[^>]*id="b-${id}"[\\s\\S]*?\\n</section>`).exec(html);
  assert.notEqual(m, null, `#b-${id} 구획이 없다`);
  return m![0];
}

const zero = {
  ...BATTING_LINE, pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0,
  bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
};

function countLine(over: Partial<CountLine> = {}): CountLine {
  return {
    playerId: "1", displayName: "テスト", teamCode: "t",
    pa: 0, quarantined: 0, twoStrike: 0, threeBall: 0, fullCount: 0, firstPitch: 0,
    twoStrikeLine: zero, beforeTwoStrikeLine: zero,
    ...over,
  };
}

const SEASON = countLine({
  pa: 400, twoStrike: 200, threeBall: 40, fullCount: 30, firstPitch: 50,
  twoStrikeLine: { ...zero, pa: 200, ab: 180, h: 36, so: 70 },
  beforeTwoStrikeLine: { ...zero, pa: 200, ab: 190, h: 62 },
});
const CAREER = countLine({
  pa: 3200, twoStrike: 1600, threeBall: 320, fullCount: 240, firstPitch: 400,
  twoStrikeLine: { ...zero, pa: 1600, ab: 1440, h: 300, so: 560 },
  beforeTwoStrikeLine: { ...zero, pa: 1600, ab: 1520, h: 500 },
});

test("통산이 있으면 두 범위가 각자의 분모로 나온다(M2)", () => {
  const data = countBlockOf(SEASON, { line: CAREER, span: { from: 2018, to: 2026 } });
  assert.ok(data !== null && !("quarantinedOnly" in data));
  assert.equal(data.pa, 400);
  assert.equal(data.career?.pa, 3200, "통산 분모가 시즌 것으로 덮였다");
  const b = blockOf(renderPlayerPage(playerPage({ count: data }), context()), "count");
  assert.match(b, /今季/, "今季 탭이 없다");
  assert.match(b, /通算/, "通算 탭이 없다");
  assert.match(b, /400打席/, "시즌 분모가 화면에 없다");
  assert.match(b, /3200打席/, "통산 분모가 화면에 없다");
});

/** ⚠**「통산」이라는 말만으로는 어느 범위인지 알 수 없다** — 화면이 말한다 */
test("⚠통산 패널이 보유 범위를 말한다", () => {
  const data = countBlockOf(SEASON, { line: CAREER, span: { from: 2018, to: 2026 } });
  const b = blockOf(renderPlayerPage(playerPage({ count: data }), context()), "count");
  assert.match(b, /<b>2018〜2026年<\/b>を合算/, "통산 패널에 보유 범위가 없다");
  assert.match(b, /NPBが公表する通算とは範囲が違います/, "NPB 통산과 다르다는 말이 없다");
  // ⚠**시즌 패널에는 안 붙는다** — 두 패널이 같은 각주를 쓰면 오독이 된다
  const hits = [...b.matchAll(/を合算しています/g)];
  assert.equal(hits.length, 1, `범위 표기가 ${hits.length}번 나왔다 — 통산 패널 하나에만 붙어야 한다`);
});

/**
 * ⚠**보유가 한 시즌뿐이면 탭을 만들지 않는다.**
 * 같은 표를 「今季」와 「通算」으로 두 번 보여주는 것은 정보가 아니라 잡음이다.
 */
test("⚠보유가 한 시즌뿐이면 탭이 없다", () => {
  const data = countBlockOf(SEASON, { line: CAREER, span: { from: 2026, to: 2026 } });
  assert.ok(data !== null && !("quarantinedOnly" in data));
  assert.equal(data.career, null, "한 시즌뿐인데 통산을 만들었다");
  const b = blockOf(renderPlayerPage(playerPage({ count: data }), context()), "count");
  assert.ok(!/role="tab"/.test(b), "탭이 만들어졌다");
});

/** ⚠통산 인자를 아예 안 주는 경로(기존 호출)도 그대로 돌아야 한다 */
test("통산 인자가 없으면 지금까지와 같다", () => {
  const data = countBlockOf(SEASON);
  assert.ok(data !== null && !("quarantinedOnly" in data));
  assert.equal(data.career, null);
});

/**
 * ⚠**격리 수는 범위마다 자기 것을 낸다**(M11). 시즌의 격리 수를 통산 패널에 쓰면
 * 「분모에서 몇이 빠졌는가」가 거짓이 된다.
 */
test("⚠격리 수가 범위마다 따로 나온다", () => {
  const data = countBlockOf(
    { ...SEASON, quarantined: 2 },
    { line: { ...CAREER, quarantined: 9 }, span: { from: 2018, to: 2026 } },
  );
  assert.ok(data !== null && !("quarantinedOnly" in data));
  assert.equal(data.quarantined, 2);
  assert.equal(data.career?.quarantined, 9, "통산의 격리 수가 시즌 것으로 덮였다");
  const b = blockOf(renderPlayerPage(playerPage({ count: data }), context()), "count");
  assert.match(b, /2件あり/, "시즌의 격리 수가 화면에 없다");
  assert.match(b, /9件あり/, "통산의 격리 수가 화면에 없다");
});
