import { test } from "node:test";
import assert from "node:assert/strict";
import { NEUTRAL_COLOR, TEAMS, colorOf, coloredTeamCodes } from "../src/index.ts";

test("색표와 구단 마스터가 어긋나지 않는다 — 하나 빠지면 그 팀만 회색이 된다", () => {
  assert.deepEqual(coloredTeamCodes().sort(), TEAMS.map((t) => t.code).sort());
});

test("12구단 전부에 색이 있다", () => {
  assert.equal(coloredTeamCodes().length, 12);
  for (const t of TEAMS) {
    assert.notDeepEqual(colorOf(t.code), NEUTRAL_COLOR, `${t.code}에 색이 없다`);
  }
});

test("구단이 아닌 코드는 중립색이 된다 — 던지지 않는다(올스타 화면이 죽으면 안 된다)", () => {
  assert.deepEqual(colorOf("cl"), NEUTRAL_COLOR);
  assert.deepEqual(colorOf("なにか"), NEUTRAL_COLOR);
});

test("색은 전부 6자리 hex다 — CSS 변수에 그대로 들어간다", () => {
  for (const code of [...coloredTeamCodes(), "unknown"]) {
    const c = colorOf(code);
    assert.match(c.base, /^#[0-9a-f]{6}$/, `${code}의 바탕색이 hex가 아니다`);
    assert.match(c.ink, /^#[0-9a-f]{6}$/, `${code}의 글자색이 hex가 아니다`);
  }
});

/**
 * WCAG 상대 휘도. 글자색과 바탕색의 대비를 재는 데 쓴다.
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * ⚠**구단 색 위의 글자를 눈대중하지 마라.** 阪神의 노랑처럼 밝은 색에는 어두운 글자가,
 * 中日의 감색에는 밝은 글자가 필요하다. 순위 배지의 「1位」는 작은 글자라 4.5:1을 건다.
 */
test("구단 색 위의 글자가 WCAG AA(4.5:1)를 넘는다", () => {
  const failures: string[] = [];
  for (const code of [...coloredTeamCodes(), "unknown"]) {
    const c = colorOf(code);
    const ratio = contrast(c.base, c.ink);
    if (ratio < 4.5) failures.push(`${code} ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `대비 미달: ${failures.join(" / ")}`);
});
