/**
 * **「通算」이라고만 쓰면 거짓이다** — 우리 통산은 **보유 범위 안**의 통산이다.
 *
 * ⚠**이 저장소는 이미 그 규칙을 갖고 있었다.** `火消し` 블록이
 * `ReliefBlockData.from`/`to` 를 들고 「⚠**화면이 「2018〜2026」이라고 말한다** —
 * 「통산」이라는 말만으로는 거짓이다」라고 적어 뒀다.
 *
 * ⚠**그런데 새로 붙인 통산 축이 그 규칙을 안 지켰다**(2026-08-27 · 자기 검토에서 발견).
 * `対戦球団別（通算）` 탭이 범위를 말하지 않았다 — NPB 가 공표하는 통산(선수의 실제 전 경력)과
 * 우리 통산(보유 9시즌)은 **다른 수**인데 같은 이름으로 나갔다.
 * **규칙이 한 곳에만 있고 시험이 없으면 다음 축에서 또 빠진다.**
 *
 * 그래서 여기서 지키는 것은 값이 아니라 **규칙의 적용 범위**다:
 * 여러 시즌을 합치는 축에는 반드시 범위가 붙고, 한 시즌짜리에는 안 붙는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import type { SplitAxisData } from "../src/player-page.ts";
import { context, playerPage } from "./fixtures.ts";

function withSplits(axes: SplitAxisData[]): string {
  return renderPlayerPage(playerPage({ splits: axes }), context());
}

const ROWS: SplitAxisData["rows"] = [
  {
    key: "g",
    label: "巨人",
    line: {
      pa: 40, ab: 36, h: 12, double: 2, triple: 0, hr: 3, bb: 3, ibb: 0, hbp: 1, sf: 0, sh: 0, so: 8, roe: 0,
    },
    rbi: 9,
    avg: { value: 12 / 36, denominator: 36 },
    obp: { value: 16 / 40, denominator: 40 },
    slg: { value: 23 / 36, denominator: 36 },
    ops: { value: 12 / 36 + 23 / 36, denominator: 36 },
  },
];

const SEASON_AXIS: SplitAxisData = {
  id: "opponent", label: "対戦球団別（今季）", allowed: false, rows: ROWS, unclassified: 0,
  thinBelow: 10, span: null,
};
const CAREER_AXIS: SplitAxisData = {
  id: "opponentCareer", label: "対戦球団別（通算）", allowed: false, rows: ROWS, unclassified: 0,
  thinBelow: 30, span: { from: 2018, to: 2026 },
};

/** ⚠**보유 범위를 화면이 말한다** — 「통산」이라는 말만으로는 어느 범위인지 알 수 없다 */
test("⚠여러 시즌을 합치는 축은 화면에 그 범위를 적는다", () => {
  const html = withSplits([CAREER_AXIS]);
  assert.match(html, /2018〜2026年/, "통산 축인데 보유 범위가 화면에 없다");
  assert.match(
    html,
    /NPBが公表する通算とは範囲が違います/,
    "우리 통산과 NPB 통산이 다른 수라는 것을 화면이 말하지 않는다",
  );
});

/** ⚠**한 시즌짜리에 「2025〜2025年」을 붙이면 정보가 아니라 소음**이다 */
test("⚠한 시즌만 세는 축에는 범위를 붙이지 않는다", () => {
  const html = withSplits([SEASON_AXIS]);
  // ⚠**강조는 `<b>` 로 렌더된다** — `年を合算` 으로 재면 그 문자열이 애초에 존재하지 않아
  //   **항상 참**이 되고, 이 시험은 공회전한다(2026-08-27 · 실제로 그 상태였다).
  //   렌더 결과의 문자열로 잰다: `<b>2018〜2026年</b>を合算しています`.
  assert.ok(!/を合算しています/.test(html), "한 시즌짜리 축에 통산 범위가 붙었다");
});

/**
 * ⚠**두 축이 한 화면에 같이 있어도 각자의 말을 한다.**
 * 탭이라 한쪽만 보이지만, 붙는 각주는 패널마다 따로다 — 섞이면 오독이 된다.
 */
test("⚠같은 화면에 두 축이 있어도 범위 표기가 통산 쪽에만 붙는다", () => {
  const html = withSplits([SEASON_AXIS, CAREER_AXIS]);
  const hits = [...html.matchAll(/<b>2018〜2026年<\/b>を合算/g)];
  assert.equal(hits.length, 1, `범위 표기가 ${hits.length}번 나왔다 — 통산 축 하나에만 붙어야 한다`);
});

/**
 * ⚠**이 규칙의 정본은 `火消し` 다**(M1). 거기 주석이 사라지면 이 시험도 근거를 잃는다.
 * 그래서 **주석이 살아 있는지**를 여기서 같이 지킨다 — 「없는 장치를 있다고 적는다」의 반대편이다.
 */
test("⚠규칙의 정본(火消し의 범위 표기)이 아직 살아 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "player-page.ts"),
    "utf8",
  );
  assert.match(
    src,
    /「통산」이라는 말만으로는 거짓이다/,
    "火消し 의 규칙 주석이 사라졌다 — 이 시험이 근거 없이 남는다",
  );
});
