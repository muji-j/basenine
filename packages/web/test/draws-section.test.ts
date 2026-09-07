/**
 * 引き分けの解剖 구획(順位表).
 *
 * ⚠**이 구획의 위험은 「그럴듯한 이야기」다.** 무승부가 많은 해를 보고 「그 해 팀들이 접전이었다」로
 * 읽는 것이 자연스러운데, 실제로는 **그 해의 연장 규정**이 거의 전부다. 화면이 그것을 말하지 않으면
 * 우리가 만든 표가 근거 없는 이야기의 재료가 된다.
 *
 * ⚠**수를 화면에 하드코딩하지 않는다** — 직전 라운드가 리그 실측치를 1,808장에 박았다.
 * 여기서는 렌더러가 **넘겨받은 값만** 그리는지를 본다(실DB 대조는 `draw-seasons.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRankingPage } from "../src/pages.ts";
import type { DrawSeasonRow, RankingPageData } from "../src/pages.ts";
import { TIE_RULE } from "../src/parts.ts";
// ⚠**비율은 집계 패키지의 함수로 만든다**(M1) — 손으로 `{value, denominator}` 를 적었더니
//   `r(0, 0)` 이 `.000` 을 내는 **픽스처만의 거짓 상태**를 만들어 시험이 헛돌았다(2026-08-20).
import { drawRate, extraDecidedRate } from "@bb-app/aggregate";
import { context } from "./fixtures.ts";

function row(over: Partial<DrawSeasonRow> = {}): DrawSeasonRow {
  const base = { season: 2022, games: 858, draws: 16, extra: 90, extraDrawn: 15 };
  return {
    ...base,
    current: false,
    drawRate: drawRate(base),
    extraDecided: extraDecidedRate(base),
    regulationDrawn: 1,
    maxInning: 12,
    inningUnknown: 0,
    ...over,
  };
}

/** 연장이 한 경기도 없던 해(2021). ⚠**비율은 여기서도 집계 함수가 만든다** */
function noExtraRow(): DrawSeasonRow {
  const base = { season: 2021, games: 858, draws: 102, extra: 0, extraDrawn: 0 };
  return {
    ...base,
    current: false,
    drawRate: drawRate(base),
    extraDecided: extraDecidedRate(base),
    regulationDrawn: 102,
    maxInning: 9,
    inningUnknown: 0,
  };
}

function data(draws: DrawSeasonRow[]): RankingPageData {
  return {
    season: 2026,
    asOf: "2026-08-14",
    seasonOver: false,
    standings: [{ id: "central", name: "セントラル・リーグ", rows: [] }],
    tieRule: TIE_RULE,
    draws,
    leagues: [],
  };
}

function section(html: string): string {
  const m = /<section class="block" id="b-draws"[\s\S]*?\n<\/section>/.exec(html);
  assert.notEqual(m, null, "引き分けの解剖 구획이 없다");
  return m![0];
}

test("引き分けの解剖 구획이 順位表에 나온다", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.match(s, /引き分けの解剖/);
  assert.match(s, /2022年/);
});

test("⚠비율에 분모가 붙고, 두 비율의 분모가 다르다(M2)", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.ok(s.includes('.019<span class="den">858試合</span>'), "引分率 옆에 분모가 없다");
  // ⚠**延長決着率의 분모는 試合이 아니라 延長試合이다** — 옆 열을 분모로 읽으면 틀린다
  assert.ok(s.includes('.833<span class="den">90延長試合</span>'), "延長決着率의 분모가 틀렸다");
});

test("⚠연장이 0인 해에는 延長決着率을 내지 않는다 — .000 은 정반대의 거짓말이다(M11)", () => {
  const s = section(renderRankingPage(data([noExtraRow()]), context()));
  assert.match(s, /—<span class="den">0延長試合<\/span>/, "연장 0에서 「모름」이 아니라 수를 냈다");
  assert.ok(!s.includes('.000<span class="den">0延長試合'), "연장 0인데 .000 을 냈다");
});

test("⚠「구단의 성질이 아니다」를 화면이 말한다 — 안 적으면 근거 없는 이야기의 재료가 된다", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.match(s, /球団の性質ではなく/);
  assert.match(s, /球団別には出していません/);
});

test("⚠「순위에 미친 영향은 재지 않는다」를 화면이 말한다", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.match(s, /どれだけ影響したか」も測っていません/);
});

test("⚠9회 무승부가 무엇인지 화면이 말한다 — 연장이 있는 해라면 콜드 게임이다", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.match(s, /コールドゲーム/);
});

test("보고 있는 시즌 줄을 강조한다 — 여러 해를 늘어놓으면 자기 위치를 잃는다", () => {
  const s = section(
    renderRankingPage(data([row({ season: 2025 }), row({ season: 2026, current: true })]), context()),
  );
  assert.match(s, /<tr class="me">[\s\S]*?2026年/);
});

test("⚠이닝을 모르는 경기가 있으면 그 수를 낸다(M11) — 9회로 때우지 않는다", () => {
  const s = section(renderRankingPage(data([row({ inningUnknown: 2 })]), context()));
  assert.match(s, /イニングが分からない試合が2試合/);
});

test("이닝 미상이 0이면 그 각주를 만들지 않는다", () => {
  const s = section(renderRankingPage(data([row()]), context()));
  assert.ok(!s.includes("イニングが分からない試合"), "미상 0인데 각주가 나왔다");
});

test("데이터가 없으면 구획 자체를 만들지 않는다 — 빈 표는 고장으로 읽힌다(M12)", () => {
  const out = renderRankingPage(data([]), context());
  assert.ok(!out.includes('id="b-draws"'), "빈 引き分け 구획을 그렸다");
});
