/**
 * **표제 옆 월별 추이(스파크라인)** — 감사 N7(P0 · M2) · N14(CSS 없이도 선이 남는다).
 *
 * ⚠**`aria-label` 도 렌더링이다.** 접근성 트리에 나가는 글자는 화면에 찍힌 글자와 같은 무게로
 * 사용자에게 도착한다 — 그래서 분모 없는 비율 금지(M2)가 그대로 걸린다.
 * 옛 판은 이름에 월별 값을 `toFixed(3)` 로만 실었다(「月別防御率：3月 27.000、…」) —
 * **분모가 없고 방어율까지 3자리**였다. 실측(반증자 · DB 읽기 전용): 투수 월 13,895건 중
 * 1~8아웃 2,639건 · 정확히 1아웃 161건(방어율 189.000 실재) · 값이 있는 타자 월 18,463건 중
 * 1~29타석 11,954건. **극소 표본이 선의 모양까지 정했다** — 최소·최대 정규화에 그대로 들어갔다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { PaEventRow } from "@bb-app/store";
import { earnedRunAverage, ops } from "@bb-app/metrics";
import type { BattingLine, PitchingLine } from "@bb-app/metrics";
import { renderPlayerPage, sparkline, SPARK_MIN_SOLID_MONTHS, THIN_SPLIT_OUTS } from "../src/player-page.ts";
import { toString } from "../src/html.ts";
import type { PitchingSplitCell, PlayerPageData, SplitAxisData, SplitRow } from "../src/player-page.ts";
import { loadSite, THIN_SPLIT_PA } from "../src/query.ts";
import { innings } from "../src/format.ts";
import { termLabel, termOf } from "../src/glossary.ts";
import { CSS } from "../src/assets.ts";
import { computed, parseRules } from "./css-cascade.ts";
import type { El } from "./css-cascade.ts";
import { context, pitcherMark, pitchingBlock, playerPage, reliefBlock } from "./fixtures.ts";

/** 한 달 — 값과 **분모**(타자 打席 · 투수 アウト) */
interface Month {
  label: string;
  value: number | null;
  den: number;
}

/**
 * 꺾은선 데이터. **문턱은 月別 표와 같은 상수**를 싣는다 — 쿼리가 실제로 그렇게 싣는지는
 * 아래 합성 DB 시험이 따로 잰다.
 * ⚠**RED 는 옛 계약(`spark: {label, value}[]` + `sparkLabel`)으로 이 함수만 바꿔서 돌렸다** —
 * 단언은 그대로였고 7본 전부가 분모·자릿수·얇음·정규화 이유로 떨어졌다(형 오류 0건).
 */
function sparkOf(metric: "ops" | "era", months: readonly Month[]): Partial<PlayerPageData> {
  return {
    spark: {
      metric,
      thinBelow: metric === "era" ? THIN_SPLIT_OUTS : THIN_SPLIT_PA,
      points: months.map((m) => ({ label: m.label, rate: { value: m.value, denominator: m.den } })),
    },
  };
}

function render(metric: "ops" | "era", months: readonly Month[], over: Partial<PlayerPageData> = {}): string {
  const role: Partial<PlayerPageData> =
    metric === "era"
      ? { role: "pitcher", pitching: pitchingBlock(), mark: pitcherMark(), relief: reliefBlock() }
      : {};
  return renderPlayerPage(playerPage({ ...role, ...sparkOf(metric, months), ...over }), context());
}

/** 꺾은선 상자. 그리지 않았으면 null */
function sparkBox(out: string): string | null {
  return /<div class="spark">[\s\S]*?<\/div>/.exec(out)?.[0] ?? null;
}

/** 접근 가능한 이름을 `이름：달, 달…` 로 쪼갠다 */
function nameOf(box: string): { head: string; months: string[] } {
  const m = /<svg[^>]*\baria-label="([^"]*)"/.exec(box);
  assert.ok(m !== null, `꺾은선에 aria-label 이 없다: ${box.slice(0, 200)}`);
  const [head, body] = m[1]!.split("：");
  assert.ok(head !== undefined && body !== undefined, `이름이 「이름：달、달」 모양이 아니다: ${m[1]}`);
  return { head, months: body.split("、") };
}

type Pt = { x: number; y: number };

function linePoints(box: string): Pt[] {
  const m = /<polyline points="([^"]*)"/.exec(box);
  assert.ok(m !== null, "꺾은선(polyline)이 없다");
  return m[1]!.trim().split(/\s+/).map((p) => {
    const [x, y] = p.split(",").map(Number);
    return { x: x!, y: y! };
  });
}

/** 속 빈 점(얇은 달) */
function rings(box: string): Pt[] {
  return [...box.matchAll(/<circle class="thin" cx="([-\d.]+)" cy="([-\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

/** 채운 점(끝점) — 속 빈 점이 아닌 원 */
function dots(box: string): Pt[] {
  return [...box.matchAll(/<circle(?![^>]*class="thin")[^>]*\bcx="([-\d.]+)" cy="([-\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

test("⚠N7 1아웃 달의 방어율이 분모 없이 이름에 실리지 않는다 — 189.000 이 아니라 189.00（0.1回…）", () => {
  const box = sparkBox(
    render("era", [
      { label: "4月", value: 3.0, den: 90 },
      // ⚠**1아웃에 7자책 — 방어율 189.00 은 실재하는 값이다**(반증자 실측 161건)
      { label: "5月", value: 189.0, den: 1 },
      { label: "6月", value: 2.25, den: 60 },
    ]),
  );
  assert.ok(box !== null, "꺾은선이 없다 — 이 시험이 잴 것이 없다");
  const { head, months } = nameOf(box);
  assert.equal(head, "月別防御率");
  assert.ok(!months.join("、").includes("189.000"), `분모 없는 3자리 방어율이 이름에 있다: ${months.join("、")}`);
  assert.ok(months.includes("5月 189.00（0.1回・3回未満）"), `1아웃 달이 분모·얇음 없이 읽힌다: ${months.join("、")}`);
  for (const m of months) {
    assert.match(m, /^\d+月 (?:なし|[\d.]+)（[^）]+）$/, `이 달에 분모가 없다(M2): ${m}`);
  }
});

test("⚠N7 이름의 자릿수와 분모가 화면의 다른 자리와 같다 — OPS 3자리+打席 · 방어율 2자리+回(M1)", () => {
  const bat = nameOf(sparkBox(render("ops", [
    { label: "4月", value: 0.812, den: 98 },
    { label: "5月", value: 1.104, den: 102 },
  ]))!);
  assert.equal(bat.head, "月別OPS");
  assert.deepEqual(bat.months, ["4月 .812（98打席）", "5月 1.104（102打席）"]);

  const pit = nameOf(sparkBox(render("era", [
    { label: "4月", value: 3.0, den: 90 },
    { label: "5月", value: 2.25, den: 60 },
  ]))!);
  assert.deepEqual(pit.months, ["4月 3.00（30回）", "5月 2.25（20回）"]);
});

test("⚠N7 얇은 달은 이름에서 그렇다고 말한다 — 월 스플릿 표와 같은 문턱(30打席 · 3回)", () => {
  const bat = nameOf(sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: THIN_SPLIT_PA - 1 },
    { label: "5月", value: 0.8, den: THIN_SPLIT_PA },
    { label: "6月", value: 0.9, den: 100 },
  ]))!);
  assert.deepEqual(bat.months, [
    `4月 .700（${THIN_SPLIT_PA - 1}打席・${THIN_SPLIT_PA}打席未満）`,
    `5月 .800（${THIN_SPLIT_PA}打席）`,
    "6月 .900（100打席）",
  ]);

  // ⚠**투수는 아웃이 잣대다**(3回 = 9アウト). 8아웃은 얇고 9아웃은 아니다
  const pit = nameOf(sparkBox(render("era", [
    { label: "4月", value: 27 / 8, den: 8 },
    { label: "5月", value: 3.0, den: 9 },
    { label: "6月", value: 3.0, den: 90 },
  ]))!);
  assert.deepEqual(pit.months, ["4月 3.38（2.2回・3回未満）", "5月 3.00（3回）", "6月 3.00（30回）"]);
});

test("⚠N7 얇은 달이 선의 모양을 정하지 않는다 — 최소·최대 정규화에서 빠진다", () => {
  const box = sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    { label: "5月", value: 0.9, den: 100 },
    // ⚠**3타석 OPS 5.000** — 옛 판에서는 이 한 달이 눈금 전체를 먹었다
    { label: "6月", value: 5.0, den: 3 },
  ]))!;
  assert.deepEqual(
    linePoints(box),
    [{ x: 0, y: 26 }, { x: 54, y: 0 }],
    "선이 믿을 수 있는 달만 잇고, 그 두 달이 높이 전체를 써야 한다",
  );
  // 얇은 달은 선 밖의 속 빈 점으로 남되 **상자 밖으로 나가지 않는다**(눈금 밖은 가장자리에 붙인다)
  assert.deepEqual(rings(box), [{ x: 108, y: 0 }]);
});

test("⚠N7 얇은 달과 없는 달을 다르게 그린다 — 얇으면 속 빈 점, 없으면 아무것도 없다(M11)", () => {
  const out = render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    // ⚠**값이 없는 달**(희생번트 1타석이면 OPS 는 정의되지 않는다) — 0 이 아니다
    { label: "5月", value: null, den: 1 },
    { label: "6月", value: 0.8, den: 8 },
    { label: "7月", value: 0.9, den: 100 },
  ]);
  const box = sparkBox(out)!;
  assert.deepEqual(rings(box), [{ x: 72, y: 13 }], "얇은 달(6月)만 속 빈 점이어야 한다 — 없는 달(5月)에는 표식이 없다");
  assert.deepEqual(linePoints(box).map((p) => p.x), [0, 108], "선은 믿을 수 있는 달(4月·7月)만 잇는다");
  assert.deepEqual(dots(box), [{ x: 108, y: 0 }], "채운 끝점은 마지막 믿을 수 있는 달 하나다");
  const { months } = nameOf(box);
  assert.ok(months.includes("5月 なし（1打席）"), `없는 달이 분모와 함께 「なし」로 읽히지 않는다: ${months.join("、")}`);
  assert.ok(months.includes(`6月 .800（8打席・${THIN_SPLIT_PA}打席未満）`), `얇은 달의 이름이 다르다: ${months.join("、")}`);
});

test("⚠N7 채운 끝점은 마지막 「믿을 수 있는」 달이다 — 얇은 이번 달이 「지금」을 대신하지 않는다", () => {
  const box = sparkBox(render("ops", [
    { label: "7月", value: 0.7, den: 100 },
    { label: "8月", value: 0.9, den: 100 },
    // 달이 막 바뀌어 5타석뿐인 이번 달 — 매달 초에 반드시 생기는 모양이다
    { label: "9月", value: 0.8, den: 5 },
  ]))!;
  assert.deepEqual(dots(box), [{ x: 54, y: 0 }]);
  assert.deepEqual(rings(box), [{ x: 108, y: 13 }]);
});

test("⚠N7 얇은 달뿐이면 그리지 않는다 — 선이 없는 그림을 만들지 않는다", () => {
  assert.equal(
    sparkBox(render("ops", [
      { label: "4月", value: 0.8, den: 10 },
      { label: "5月", value: 0.9, den: 12 },
      { label: "6月", value: 0.85, den: 100 },
    ])),
    null,
    "믿을 수 있는 달이 하나뿐인데 꺾은선을 그렸다",
  );
  assert.equal(
    sparkBox(render("era", [
      { label: "4月", value: 81.0, den: 1 },
      { label: "5月", value: 0.0, den: 3 },
    ])),
    null,
    "얇은 달만 있는데 꺾은선을 그렸다",
  );
});

/**
 * ⚠**CSS 가 없어도 선이 남는다**(2026-09-27 · 감사 N14 · 개연).
 * 선과 점의 색이 CSS 에만 있어서, 스타일시트가 안 오면 `polyline` 은 SVG 초기값 `stroke:none` 으로
 * **사라지고** 끝점만 초기값 검정으로 남았다. → 마크업에 **`currentColor` 기본값**을 둔다(글자색을 따른다).
 * 정상 모드의 색은 지금처럼 CSS 토큰이 덮는다 — CSS 가 표현 속성을 이긴다(css-contrast 의 TEAM_MARKS 가 계속 잰다).
 * ⚠**구단 색을 속성으로 되살리지 마라** — 그건 W2 가 걷어낸 결함이다(속성은 CSS 대비 검사가 못 본다).
 */
test("⚠N14 꺾은선의 선·점이 CSS 없이도 그려진다 — 기본 색 속성이 currentColor 다", () => {
  const box = sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    { label: "5月", value: 0.8, den: 8 },
    { label: "6月", value: 0.9, den: 100 },
  ]))!;
  const polyline = /<polyline\b[^>]*>/.exec(box)?.[0] ?? "";
  assert.match(polyline, /\bstroke="currentColor"/, `선에 기본 색이 없다 — CSS 가 없으면 stroke:none 으로 사라진다: ${polyline}`);
  assert.match(polyline, /\bfill="none"/, "선 아래가 채워진다");
  const circles = [...box.matchAll(/<circle\b[^>]*>/g)].map((m) => m[0]);
  const end = circles.filter((c) => !c.includes('class="thin"'));
  const thin = circles.filter((c) => c.includes('class="thin"'));
  assert.equal(end.length, 1, "채운 끝점이 하나가 아니다 — 이 시험이 잴 것이 없다");
  assert.equal(thin.length, 1, "속 빈 점이 하나가 아니다 — 이 시험이 잴 것이 없다");
  assert.match(end[0]!, /\bfill="currentColor"/, `끝점에 기본 색이 없다 — CSS 가 없으면 검정으로 떨어진다: ${end[0]}`);
  assert.match(thin[0]!, /\bstroke="currentColor"/, `속 빈 점에 기본 선 색이 없다 — CSS 가 없으면 테두리가 사라진다: ${thin[0]}`);
  assert.match(thin[0]!, /\bfill="none"/, `속 빈 점이 채워진다 — CSS 가 없으면 끝점과 구별이 안 된다: ${thin[0]}`);
  // ⚠**색 값은 currentColor 만** — 구단 색 변수·보간이 속성으로 돌아오면 CSS 대비 검사가 못 본다(W2)
  for (const tag of [polyline, ...circles]) {
    for (const m of tag.matchAll(/\b(?:stroke|fill)="([^"]*)"/g)) {
      assert.ok(m[1] === "currentColor" || m[1] === "none", `꺾은선의 색 속성이 currentColor/none 밖이다: ${m[0]}`);
    }
  }
  /**
   * ⚠**속 빈 점의 테두리는 선과 같은 굵기다**(2026-09-27 · PR-D 디자인 감사 제안).
   * 1.2 였을 때 선(1.6)보다 얇아 점이 흐리게 읽혔다 — 채움이 없으니 테두리가 곧 그 점의 전부다.
   */
  const width = (tag: string): string | undefined => /\bstroke-width="([^"]*)"/.exec(tag)?.[1];
  assert.equal(width(thin[0]!), width(polyline), "속 빈 점의 테두리가 선보다 얇다");
});

/** 꺾은선 밑 캡션(`.sl`) — 원문과, 태그를 걷은 글자 */
function captionOf(box: string): { html: string; text: string } {
  const at = box.indexOf('<span class="sl">');
  assert.ok(at !== -1, "캡션(.sl)이 없다 — 이 시험이 잴 것이 없다");
  const html = box.slice(at + '<span class="sl">'.length, box.lastIndexOf("</span>"));
  return { html, text: html.replace(/<[^>]+>/g, "") };
}

/**
 * ⚠**속 빈 점의 뜻이 화면에 없었다**(2026-09-27 · PR-D 디자인 감사 P2).
 * 얇은 달은 표본이 작아 값이 극단이라 **점이 상자 모서리를 차지**하는데(얇은 점의 약 73% 가 눈금 밖),
 * 그 뜻은 접근 가능한 이름에만 있었다. → **얇은 달이 있을 때만** 캡션 끝에 범례를 단다.
 * ⚠**글자는 이름의 얇음 문구와 한 벌이다**(M1) — 따로 쓰면 문턱을 바꾼 날 둘이 갈린다.
 */
test("⚠속 빈 점의 뜻을 캡션이 말한다 — 얇은 달이 있을 때만 「○＝문턱」, 글자는 이름의 얇음 문구와 같다", () => {
  const bat = sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    { label: "5月", value: 0.8, den: 8 },
    { label: "6月", value: 0.9, den: 100 },
  ]))!;
  const phrase = /・([^）]+)）$/.exec(nameOf(bat).months.find((m) => m.startsWith("5月"))!)?.[1];
  assert.equal(phrase, `${THIN_SPLIT_PA}打席未満`, "이름의 얇음 문구를 못 읽었다 — 이 시험이 잴 것이 없다");
  const cap = captionOf(bat);
  assert.ok(cap.text.endsWith(`○＝${phrase}`), `얇은 달이 있는데 캡션에 범례가 없다: ${cap.text}`);
  // ⚠**범례는 그림의 부호를 푸는 글자라 낭독에서 뺀다** — 같은 뜻을 이름이 달마다 이미 말한다
  assert.match(cap.html, /<span aria-hidden="true">○＝/, `범례가 낭독에 한 번 더 들어간다: ${cap.html}`);

  const pit = captionOf(sparkBox(render("era", [
    { label: "4月", value: 3.0, den: 90 },
    { label: "5月", value: 27 / 8, den: THIN_SPLIT_OUTS - 1 },
    { label: "6月", value: 2.25, den: 60 },
  ]))!);
  assert.ok(pit.text.endsWith(`○＝${innings(THIN_SPLIT_OUTS)}回未満`), `투수 캡션의 범례가 문턱 상수와 다르다: ${pit.text}`);

  const none = captionOf(sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    { label: "5月", value: 0.9, den: 100 },
  ]))!);
  assert.ok(!none.text.includes("○"), `얇은 달이 없는데 범례가 있다: ${none.text}`);
});

/**
 * ⚠**투수 꺾은선은 위로 갈수록 나쁘다 — 그걸 화면이 말해야 한다**(2026-09-27 · PR-D 디자인 감사 P3).
 * 타자(OPS)는 위가 좋고 투수(방어율)는 위가 나쁜데, 캡션·그림 어디에도 말이 없었다.
 * 같은 페이지의 月別 표는 「棒は防御率（**短いほど良い**）」라고 적는다 — 같은 모양(이름 뒤 괄호)으로 적는다.
 * ⚠**축을 뒤집지 않는다** — 표도 막대를 안 뒤집고 방향을 글로 말한다(`splitsBlock` 각주 · 같은 페이지의 규칙).
 * ⚠**말은 용어집의 방어율 설명과 같다**(「低いほど良い指標です」 · M1).
 */
test("⚠투수 꺾은선의 캡션이 방향을 말한다 — 「月別防御率（低いほど良い）」, 타자는 말하지 않는다", () => {
  const pit = captionOf(sparkBox(render("era", [
    { label: "4月", value: 3.0, den: 90 },
    { label: "5月", value: 2.25, den: 60 },
  ]))!);
  assert.ok(pit.text.startsWith("月別防御率（低いほど良い）　"), `투수 캡션에 방향이 없다: ${pit.text}`);
  assert.ok(termOf("era")!.short.includes("低いほど良い"), "용어집의 방어율 설명과 말이 갈렸다 — 둘 중 하나를 고쳐라(M1)");
  const bat = captionOf(sparkBox(render("ops", [
    { label: "4月", value: 0.7, den: 100 },
    { label: "5月", value: 0.9, den: 100 },
  ]))!);
  assert.ok(!bat.text.includes("ほど良い"), `타자 캡션에 방향이 붙었다 — OPS 는 위가 좋다는 것이 기본 읽기다: ${bat.text}`);
});

/** 투수 月別 표의 한 행 — 표는 경기 단위 투구 성적(`pitching`)을 그리고, 이 줄은 키·라벨만 쓴다 */
function monthRow(key: string, label: string): SplitRow {
  const line = { pa: 40, ab: 36, h: 9, double: 2, triple: 0, hr: 1, bb: 3, ibb: 0, hbp: 1, sf: 0, sh: 0, so: 8, roe: 0 };
  return {
    key, label, line, rbi: 0,
    avg: { value: 9 / 36, denominator: 36 },
    obp: { value: 13 / 40, denominator: 40 },
    slg: { value: 14 / 36, denominator: 36 },
    ops: { value: 13 / 40 + 14 / 36, denominator: 40 },
  };
}

test("⚠N7 투수의 月別 표와 꺾은선이 같은 달을 얇다고 한다 — 문턱 상수는 하나(THIN_SPLIT_OUTS)", () => {
  const below = THIN_SPLIT_OUTS - 1;
  const cell = (outs: number): PitchingSplitCell => ({ games: 2, outs, er: 1, h: 3, hr: 0, bb: 1, so: 2 });
  const month: SplitAxisData = {
    id: "month",
    label: "月別",
    allowed: true,
    rows: [monthRow("2026-04", "4月"), monthRow("2026-05", "5月"), monthRow("2026-06", "6月")],
    unclassified: 0,
    thinBelow: THIN_SPLIT_PA,
    span: null,
    pitching: new Map([["2026-04", cell(below)], ["2026-05", cell(THIN_SPLIT_OUTS)], ["2026-06", cell(90)]]),
  };
  const out = render(
    "era",
    [
      { label: "4月", value: 27 / below, den: below },
      { label: "5月", value: 27 / THIN_SPLIT_OUTS, den: THIN_SPLIT_OUTS },
      { label: "6月", value: 0.3, den: 90 },
    ],
    { splits: [month] },
  );
  const splits = /id="b-splits"[\s\S]*?<\/table>/.exec(out)?.[0] ?? "";
  const thinRows = [...splits.matchAll(/<tr class="thin">\s*<td class="l">([^<]+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(thinRows, ["4月"], "月別 표가 얇다고 하는 달이 문턱 상수와 다르다");
  assert.deepEqual(rings(sparkBox(out)!).map((p) => p.x), [0], "꺾은선이 얇다고 하는 달(속 빈 점)이 표와 다르다");
  // ⚠**각주의 수도 상수에서 나온다** — 문장에 「3回」를 박아 두면 상수를 바꾼 날 각주만 거짓이 된다
  assert.ok(out.includes(`${innings(THIN_SPLIT_OUTS)}回未満は薄く表示しています`), "각주가 문턱 상수와 다른 수를 말한다");
});

/**
 * ⚠**쿼리가 실제로 분모와 문턱을 싣는가** — 렌더 시험만으로는 「데이터가 분모를 버린다」를 못 본다.
 * 옛 판의 결함은 렌더러가 아니라 **쿼리 → 화면 경계**(`loadMonthlyEra` 가 값만 돌려줌)에 있었다.
 */
const NOW = "2026-06-01T00:00:00.000Z";

async function withSite(fn: (site: ReturnType<typeof loadSite>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-spark-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    for (const [id, name] of [["P1", "投手一"], ["B1", "打者一"], ["B2", "打者二"]] as const) upsertPlayer(db, id, name, NOW);
    const game = (gameId: string, date: string): void => {
      upsertGame(db, {
        gameId, season: 2026, gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
        status: "played", notPlayedReason: null, competition: "regular",
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
      });
    };
    const pitch = (gameId: string, outs: number, er: number): void => {
      upsertPitching(db, {
        gameId, playerId: "P1", side: "home", decision: null, outs, bf: null, pitches: null,
        h: 0, hr: 0, bb: 0, hbp: 0, so: 0, runs: er, er, wp: null, balk: null,
      });
    };
    /**
     * 한 경기의 타석 로그. 한 타석 = `[타자, 결과, 타석 뒤 주자, 그 타석의 득점]`(아웃이면 주자는 그대로라 생략).
     *
     * ⚠**반이닝은 3아웃으로 끝나야 하고, wOBA 의 가중 사건 7종이 리그에 한 번씩은 있어야 한다** —
     * 타석 로그가 있는 리그는 계수를 득점기대값 행렬에서 **유도**하고(폴백 없음),
     * 쓸 행이나 사건 표본이 없으면 **던진다**(M7 · `deriveRunValues`). 이 시험이 재는 것은 꺾은선이지만
     * `loadSite` 를 통째로 지나가야 하므로 그 문을 통과할 만큼만 현실적으로 만든다.
     */
    type Pa = readonly ["B1" | "B2", "fieldedOut" | "single" | "double" | "triple" | "homerun" | "walk" | "hitByPitch" | "reachedOnError", string?, number?];
    const pas = (gameId: string, innings: readonly (readonly Pa[])[]): void => {
      const rows: PaEventRow[] = [];
      const count = new Map<string, { pa: number; h: number }>();
      let seq = 0;
      innings.forEach((half, i) => {
        let outs = 0;
        let bases = "";
        for (const [batterId, outcome, after, runs] of half) {
          const hit = ["single", "double", "triple", "homerun"].includes(outcome);
          seq += 1;
          rows.push({
            gameId, seq, inning: i + 1, half: "top", outsBefore: outs, bases, batterId, pitcherId: "P1",
            outcome, rbi: 0, rawBox: "", rawPbp: "", ballCount: null, status: "final", runsScored: runs ?? 0,
          });
          const c = count.get(batterId) ?? { pa: 0, h: 0 };
          count.set(batterId, { pa: c.pa + 1, h: c.h + (hit ? 1 : 0) });
          if (outcome === "fieldedOut") outs += 1;
          else bases = after ?? bases;
        }
        assert.equal(outs, 3, "합성 반이닝이 3아웃으로 끝나지 않는다 — 시험 데이터가 틀렸다");
      });
      replacePaEvents(db, gameId, rows);
      for (const [playerId, c] of count) {
        upsertBatting(db, {
          gameId, playerId, side: "away", battingOrder: playerId === "B1" ? "1" : "2", position: "(遊)",
          pa: c.pa, ab: c.pa, h: c.h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
          runs: 0, rbi: 0, sb: 0,
        });
      }
    };
    /** B2 가 가중 사건 7종을 한 번씩 치는 반이닝 — 계수 유도의 문을 여는 용도다 */
    const allEvents: readonly Pa[] = [
      ["B2", "walk", "1"], ["B2", "hitByPitch", "12"], ["B2", "reachedOnError", "123"],
      ["B2", "double", "23", 2], ["B2", "triple", "3", 2], ["B2", "homerun", "", 2], ["B2", "single", "1"],
      ["B2", "fieldedOut"], ["B2", "fieldedOut"], ["B2", "fieldedOut"],
    ];
    // 4월 — P1 이 27아웃씩 3경기(81아웃 · 자책 9 → 방어율 3.00). B1 은 경기마다 4타석
    for (const [id, date] of [["g1", "2026-04-03"], ["g2", "2026-04-10"], ["g3", "2026-04-17"]] as const) {
      game(id, date);
      pitch(id, 27, 3);
      pas(id, [
        [["B1", "single", "1"], ["B2", "fieldedOut"], ["B1", "fieldedOut"], ["B2", "fieldedOut"]],
        [["B1", "fieldedOut"], ["B2", "fieldedOut"], ["B1", "fieldedOut"]],
        allEvents,
      ]);
    }
    // 5월 — P1 이 **1아웃에 7자책**(방어율 189.00). B1 은 3타석
    game("g4", "2026-05-08");
    pitch("g4", 1, 7);
    pas("g4", [[["B1", "single", "1"], ["B1", "single", "12"], ["B2", "fieldedOut"], ["B1", "fieldedOut"], ["B2", "fieldedOut"]]]);
    fn(loadSite(db, { season: 2026, builtOn: "2026-06-01" }));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠N7 쿼리가 분모와 문턱을 싣는다 — 투수는 アウト·THIN_SPLIT_OUTS, 타자는 打席·月別 축의 문턱", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === "P1");
    assert.ok(p !== undefined, "투수 페이지가 없다 — 이 시험이 잴 것이 없다");
    assert.equal(p.role, "pitcher");
    assert.equal(p.spark.metric, "era");
    assert.equal(p.spark.thinBelow, THIN_SPLIT_OUTS, "투수 꺾은선의 문턱이 경기 단위 투구 표의 상수가 아니다");
    assert.deepEqual(
      p.spark.points.map((x) => [x.label, x.rate.denominator]),
      [["4月", 81], ["5月", 1]],
      "월별 방어율이 분모(아웃)를 버렸다",
    );
    assert.equal(p.spark.points[1]!.rate.value, 189, "1아웃 7자책의 방어율은 189.00 이다");

    const b = site.players.find((x) => x.playerId === "B1");
    assert.ok(b !== undefined, "타자 페이지가 없다 — 이 시험이 잴 것이 없다");
    const axis = b.splits.find((a) => a.id === "month");
    assert.ok(axis !== undefined && axis.rows.length === 2, "月別 축이 없다 — 이 시험이 잴 것이 없다");
    assert.equal(b.spark.metric, "ops");
    assert.equal(b.spark.thinBelow, axis.thinBelow, "타자 꺾은선의 문턱이 月別 축 자신의 문턱이 아니다");
    assert.deepEqual(
      b.spark.points.map((x) => x.rate.denominator),
      axis.rows.map((r) => r.line.pa),
      "타자 꺾은선의 분모가 月別 표의 打席과 다르다",
    );
    assert.deepEqual(b.spark.points.map((x) => x.rate.denominator), [12, 3]);
  });
});

/*
 * ## 그리지 않는 자리의 안내 — 감사 N18(사용자 결정 2026-09-28)
 *
 * ⚠**그 자리가 말없이 비었다.** N7 부터 믿을 수 있는 달이 `SPARK_MIN_SOLID_MONTHS` 미만이면 꺾은선을 그리지 않는다
 * (M2 — 얇은 표본이 모양을 정하지 않게 · 이것 자체는 두 검토가 맞다고 판정했다). 그런데 개막월(3月)이 구조적으로 얇아
 * **개막부터 5월 초까지 약 6주 동안 타자 꺾은선이 전부 없다**(2025 실측: 4/30 기준 153장 → 0장 · 5/31 232 → 100).
 * 말없이 비면 「기능이 사라졌다」로 읽힌다 → **그 자리에 안내 한 줄**: 무엇의 추이인지 + 언제 그리는지.
 * ⚠**수는 전부 꺾은선이 쓰는 그 출처에서 온다**(M1) — 얇음의 문턱(`thinBelow`)과 최소 달 수(`SPARK_MIN_SOLID_MONTHS`).
 * ⚠**「모자라서 안 그림」과 「그릴 것이 없음」은 다른 상태다**(M12) — 그 시즌에 나온 달이 없으면 안내도 없다.
 */

/** 꺾은선 자리의 안내(`p.sparknote`) — 원문과, 태그를 걷은 글자. 없으면 null */
function noteOf(out: string): { html: string; text: string } | null {
  const all = [...out.matchAll(/<p class="sparknote"[^>]*>([\s\S]*?)<\/p>/g)];
  assert.ok(all.length <= 1, `안내가 ${all.length}개다 — 한 줄이어야 한다`);
  const m = all[0];
  return m === undefined ? null : { html: m[0], text: m[1]!.replace(/<[^>]+>/g, "") };
}

/**
 * 안내가 말해야 하는 글자. **수는 꺾은선이 쓰는 출처에서** 만든다 — 얇음의 문턱과 최소 달 수.
 * ⚠**단위 표기는 구현과 다른 길로 만든다**(구현은 `denominator` · 여기는 `innings` 와 리터럴 단위) —
 *   같은 함수로 기대값을 만들면 그 함수가 틀려도 시험이 따라 틀린다.
 * ⚠**최소 달 수는 인자로 받는다** — 상수(2)로만 재면 구현이 리터럴 `2` 를 써도 못 잡는다(아래 주입 시험).
 * 지금 값으로 읽으면 「月別OPS　30打席以上の月が2つあれば表示」 · 「月別防御率　3回以上の月が2つあれば表示」.
 */
function expectedNote(metric: "ops" | "era", thinBelow: number, minSolid: number = SPARK_MIN_SOLID_MONTHS): string {
  const bar = metric === "era" ? `${innings(thinBelow)}回` : `${thinBelow}打席`;
  return `月別${termLabel(metric)}　${bar}以上の月が${minSolid}つあれば表示`;
}

/**
 * **둘째 문구** — 분모가 문턱 이상인 달은 `minSolid` 개를 채웠는데 **값이 나오는 달**이 모자랄 때.
 * 그때 첫째 문구(「…以上の月が2つあれば表示」)는 **이미 채운 조건**을 말해 거짓이다(N18 교차 검토 P2).
 * 지금 값으로 읽으면 「月別OPS　30打席以上で計算できる月が2つ未満」.
 */
function expectedUncomputableNote(metric: "ops" | "era", thinBelow: number, minSolid: number = SPARK_MIN_SOLID_MONTHS): string {
  const bar = metric === "era" ? `${innings(thinBelow)}回` : `${thinBelow}打席`;
  return `月別${termLabel(metric)}　${bar}以上で計算できる月が${minSolid}つ未満`;
}

test("⚠N18 믿을 달이 모자라 그리지 않으면 그 자리에 안내 한 줄 — 타자: 月別OPS + 月別 축의 문턱 + 최소 달 수", () => {
  const out = render("ops", [
    // ⚠**개막월이 얇은 전형** — 4월·5월 초의 타자 페이지가 이 모양이다
    { label: "3月", value: 0.8, den: 10 },
    { label: "4月", value: 0.9, den: 12 },
    { label: "5月", value: 0.85, den: 100 },
  ]);
  assert.equal(sparkBox(out), null, "믿을 수 있는 달이 하나뿐인데 꺾은선을 그렸다 — 이 시험의 전제가 틀렸다");
  const note = noteOf(out);
  assert.ok(note !== null, "꺾은선을 안 그렸는데 그 자리가 말없이 비었다(N18)");
  assert.equal(note.text, expectedNote("ops", THIN_SPLIT_PA));
  // ⚠**자리는 꺾은선이 있던 그곳**이다 — 표제(header.idline)의 마지막 자식, 글자 묶음(.idtext) 뒤
  assert.match(
    out,
    /<header class="idline">[\s\S]*?<div class="idtext">[\s\S]*<\/div>\s*<p class="sparknote">[^<]*<\/p>\s*<\/header>/,
    "안내가 표제 줄의 꺾은선 자리(마지막 자식)에 있지 않다",
  );
});

test("⚠N18 투수도 같다 — 얇은 달뿐이면 「月別防御率　3回以上…」, 문턱은 THIN_SPLIT_OUTS 에서", () => {
  const out = render("era", [
    { label: "4月", value: 81.0, den: 1 },
    { label: "5月", value: 0.0, den: 3 },
  ]);
  assert.equal(sparkBox(out), null, "얇은 달만 있는데 꺾은선을 그렸다 — 이 시험의 전제가 틀렸다");
  // ⚠**방향(「低いほど良い」)은 말하지 않는다** — 그건 그림을 읽는 법이고, 여기엔 그림이 없다(완전 일치가 그것을 막는다)
  assert.equal(noteOf(out)?.text, expectedNote("era", THIN_SPLIT_OUTS));
});

test("⚠N18 안내의 수를 손으로 적지 않는다 — 데이터의 문턱(thinBelow)을 바꾸면 문구가 따라온다(M1)", () => {
  const pt = (label: string, value: number, den: number): { label: string; rate: { value: number; denominator: number } } => ({
    label,
    rate: { value, denominator: den },
  });
  // 타자 — 月別 축의 문턱이 25 인 픽스처면 「25打席以上」이어야 한다
  const bat = noteOf(render("ops", [], { spark: { metric: "ops", thinBelow: 25, points: [pt("4月", 0.8, 24), pt("5月", 0.9, 25)] } }));
  assert.ok(bat !== null, "문턱 25 인 타자에게 안내가 없다");
  assert.equal(bat.text, expectedNote("ops", 25), "타자 안내가 데이터의 문턱을 안 따라간다");
  assert.ok(!bat.text.includes(`${THIN_SPLIT_PA}打席`), `문턱을 바꿨는데 옛 수가 남았다: ${bat.text}`);
  // 투수 — 12アウト면 「4回以上」이어야 한다(아웃 → 이닝 환산도 꺾은선의 얇음 문구와 같은 길)
  const pit = noteOf(render("era", [], { spark: { metric: "era", thinBelow: 12, points: [pt("4月", 3.0, 11), pt("5月", 2.25, 12)] } }));
  assert.ok(pit !== null, "문턱 12アウト인 투수에게 안내가 없다");
  assert.equal(pit.text, expectedNote("era", 12), "투수 안내가 데이터의 문턱을 안 따라간다");
  assert.ok(pit.text.includes("4回以上"), `12アウト가 4回로 읽히지 않는다: ${pit.text}`);
  /**
   * ⚠**둘째 문구도 같은 문턱을 따른다** — 문턱 이상인데 값이 없는 달 2개(N18 교차 검토 P2 의 둘째 문구).
   * 전수 시험은 문턱 30 으로만 재므로 둘째 문구의 「30打席」 하드코딩을 못 잡는다 — 여기서 문턱을 바꿔 잡는다.
   * ⚠투수 쪽은 **합성**이다 — 실제 데이터에서는 구조적으로 안 나오지만(아래 시험), 렌더러는 지표를 가리지 않는다.
   */
  const none = (label: string, den: number): { label: string; rate: { value: null; denominator: number } } => ({
    label,
    rate: { value: null, denominator: den },
  });
  const bat2 = noteOf(render("ops", [], { spark: { metric: "ops", thinBelow: 25, points: [none("4月", 25), none("5月", 26)] } }));
  assert.equal(bat2?.text, expectedUncomputableNote("ops", 25), "타자 둘째 문구가 데이터의 문턱을 안 따라간다");
  const pit2 = noteOf(render("era", [], { spark: { metric: "era", thinBelow: 12, points: [none("4月", 12), none("5月", 13)] } }));
  assert.equal(pit2?.text, expectedUncomputableNote("era", 12), "투수 둘째 문구가 데이터의 문턱을 안 따라간다");
});

test("⚠N18 꺾은선을 그리면 안내는 없다 — 경계가 꺾은선과 같은 상수(SPARK_MIN_SOLID_MONTHS)다", () => {
  for (const metric of ["ops", "era"] as const) {
    const thinBelow = metric === "era" ? THIN_SPLIT_OUTS : THIN_SPLIT_PA;
    const value = metric === "era" ? 3.0 : 0.8;
    /** 믿을 수 있는 달 n 개 + 얇은 달 하나(얇은 달은 몇 개든 선을 만들지 않는다) */
    const months = (n: number): Month[] => [
      ...Array.from({ length: n }, (_, i) => ({ label: `${4 + i}月`, value, den: thinBelow * 3 })),
      { label: `${4 + n}月`, value, den: 1 },
    ];
    const below = render(metric, months(SPARK_MIN_SOLID_MONTHS - 1));
    assert.equal(sparkBox(below), null, `${metric}: 믿을 달이 ${SPARK_MIN_SOLID_MONTHS - 1}개인데 꺾은선을 그렸다`);
    assert.equal(noteOf(below)?.text, expectedNote(metric, thinBelow), `${metric}: 경계 바로 아래에 안내가 없다`);
    const drawn = render(metric, months(SPARK_MIN_SOLID_MONTHS));
    assert.ok(sparkBox(drawn) !== null, `${metric}: 믿을 달이 ${SPARK_MIN_SOLID_MONTHS}개인데 꺾은선이 없다 — 이 시험이 잴 것이 없다`);
    assert.equal(noteOf(drawn), null, `${metric}: 꺾은선을 그렸는데 안내도 붙었다 — 둘은 한 자리를 나눠 쓰지 않는다`);
  }
  // ⚠**기본 픽스처는 꺾은선을 그리는 타자다** — 다른 시험 전부가 보는 화면에 안내가 끼면 안 된다
  const plain = renderPlayerPage(playerPage(), context());
  assert.ok(sparkBox(plain) !== null, "기본 픽스처에 꺾은선이 없다 — 이 단언이 잴 것이 없다");
  assert.equal(noteOf(plain), null, "기본 픽스처(꺾은선 있음)에 안내가 붙었다");
});

/**
 * ⚠**최소 달 수를 2 가 아닌 수로 재야 한다**(2026-09-28 · N18 교차 검토 P2).
 * 구현과 기대값이 같은 상수(`SPARK_MIN_SOLID_MONTHS` = 2)를 읽으니, 구현의 보간을 리터럴 `2` 로 바꿔도
 * 시험이 전부 초록이었다(검토자 실측 21/21). → 최소 달 수를 **주입**할 수 있게 하고 **3** 으로 잰다.
 * 그리기 판정과 안내가 **같은 주입값**을 쓰는지를 한 번에 본다. 화면은 언제나 기본값(상수)으로 그린다.
 */
test("⚠N18 최소 달 수는 주입된 수를 쓴다 — 3 이면 믿을 달 2개로는 안 그리고 안내가 「3つ」를 말한다(리터럴 2 를 잡는다)", () => {
  // ⚠**상수와 다른 수여야 한다** — 같으면 리터럴을 못 잡는다. 박지 않고 상수에서 유도해, 상수가 바뀐 날에도 목적이 남게 한다
  const MIN = SPARK_MIN_SOLID_MONTHS + 1;
  for (const metric of ["ops", "era"] as const) {
    const thinBelow = metric === "era" ? THIN_SPLIT_OUTS : THIN_SPLIT_PA;
    const value = metric === "era" ? 3.0 : 0.8;
    /** 믿을 수 있는 달 n 개 + 얇은 달 하나 */
    const spark = (n: number) =>
      sparkOf(metric, [
        ...Array.from({ length: n }, (_, i) => ({ label: `${4 + i}月`, value, den: thinBelow * 3 })),
        { label: `${4 + n}月`, value, den: 1 },
      ]).spark!;
    // 전제: 기본값(상수 2)이면 믿을 달 2개로 그린다
    assert.ok(sparkBox(toString(sparkline(spark(MIN - 1)))) !== null, `${metric}: 기본값으로 믿을 달 ${MIN - 1}개를 안 그린다 — 이 시험의 전제가 틀렸다`);
    const below = toString(sparkline(spark(MIN - 1), MIN));
    assert.equal(sparkBox(below), null, `${metric}: 최소 달 수 ${MIN} 인데 믿을 달 ${MIN - 1}개로 그렸다 — 그리기 판정이 주입된 수를 안 쓴다`);
    assert.equal(noteOf(below)?.text, expectedNote(metric, thinBelow, MIN), `${metric}: 안내가 주입된 최소 달 수를 말하지 않는다`);
    const drawn = toString(sparkline(spark(MIN), MIN));
    assert.ok(sparkBox(drawn) !== null, `${metric}: 믿을 달 ${MIN}개인데 최소 ${MIN} 에서 안 그렸다`);
    assert.equal(noteOf(drawn), null, `${metric}: 그렸는데 안내도 붙었다`);
  }
});

test("⚠N18 최소 달 수는 2〜9 의 정수만 받는다 — 점 하나는 선이 아니고, 안내는 「つ」로 센다(1〜9 에서만 자연스럽다)", () => {
  const s = sparkOf("ops", [{ label: "4月", value: 0.8, den: 100 }]).spark!;
  for (const bad of [0, 1, 10, 2.5, Number.NaN]) {
    assert.throws(() => sparkline(s, bad), RangeError, `최소 달 수 ${bad} 를 조용히 받았다`);
  }
  for (const ok of [2, 9]) assert.doesNotThrow(() => sparkline(s, ok), `최소 달 수 ${ok} 를 거절했다`);
});

test("⚠N18 그 시즌에 나온 달이 없으면 안내도 없다 — 「모자라서 안 그림」과 「그릴 것이 없음」은 다른 상태(M12)", () => {
  for (const metric of ["ops", "era"] as const) {
    const out = render(metric, []);
    assert.equal(sparkBox(out), null, `${metric}: 월별 값이 없는데 꺾은선을 그렸다`);
    assert.equal(noteOf(out), null, `${metric}: 그 시즌에 나오지 않은 선수에게 「…あれば表示」를 말한다 — 모자란 게 아니라 없는 것이다`);
  }
});

/**
 * ⚠**「월별 값이 있다」는 「그 달에 나왔다」다**(요구의 괄호 「출장한 달이 있다」).
 * 값이 정의되지 않는 달(희생번트 1타석뿐 · 0아웃 등판)도 **나온 달**이다 — 0 이 아니라 「정의 안 됨」이고(M11),
 * 안내를 비우는 것은 **나온 달이 0개**일 때뿐이다(M12 — 조용히 비지 않는다).
 * ⚠**여기 두 달은 분모가 문턱 미만**이라 첫째 문구가 참이다. 분모가 문턱 이상인데 값이 없는 달은 **둘째 문구**다(아래).
 */
test("⚠N18 값이 정의되지 않는 달뿐이어도 나온 달이 있으면 안내 — 비우는 것은 「나온 달 0개」뿐이다", () => {
  const bat = render("ops", [{ label: "4月", value: null, den: 1 }]);
  assert.equal(sparkBox(bat), null);
  assert.equal(noteOf(bat)?.text, expectedNote("ops", THIN_SPLIT_PA), "희생번트 1타석뿐인 달의 타자에게 안내가 없다");
  const pit = render("era", [{ label: "4月", value: null, den: 0 }]);
  assert.equal(sparkBox(pit), null);
  assert.equal(noteOf(pit)?.text, expectedNote("era", THIN_SPLIT_OUTS), "0아웃 등판뿐인 투수에게 안내가 없다");
});

/**
 * ⚠**안내는 보일 때 언제나 참이어야 한다**(2026-09-28 · N18 교차 검토 P2).
 * 분모가 문턱 이상인데 **값이 정의되지 않는 달**이 있다 — 타자는 30打席 이상이어도 타수가 0 이면(전부 볼넷 등)
 * 장타율이 없어 OPS 가 없다(`ops()` · M11). 그런 달로 「문턱 이상인 달」을 채우면 꺾은선은 없는데 첫째 문구는
 * 「30打席以上の月が2つあれば表示」 — **이미 채운 조건**을 말한다. → 그때는 **둘째 문구**: 값이 나오는 달이 모자라다.
 * ⚠**둘째 문구도 시제가 없다** — 지금 데이터에 대한 사실이라 끝난 시즌에도 참이다.
 */
test("⚠N18 문턱 이상인데 값이 없는 달로 조건을 채우면 둘째 문구 — 「…あれば表示」는 이미 채운 조건이라 거짓이다", () => {
  // 문턱 이상 null 2개 — ⚠하나는 **정확히 문턱**이다(「이상」의 경계를 같이 잰다)
  const twoNull = render("ops", [
    { label: "4月", value: null, den: THIN_SPLIT_PA },
    { label: "5月", value: null, den: THIN_SPLIT_PA + 5 },
  ]);
  assert.equal(sparkBox(twoNull), null, "값이 나오는 달이 없는데 꺾은선을 그렸다 — 이 시험의 전제가 틀렸다");
  assert.equal(noteOf(twoNull)?.text, expectedUncomputableNote("ops", THIN_SPLIT_PA), "문턱 이상 null 2개에 첫째 문구(이미 채운 조건)를 말한다");
  // 문턱 이상 null 1 + 문턱 이상 정상 1 — 분모는 2개를 채웠고 값이 나오는 달은 1개
  const mixed = render("ops", [
    { label: "4月", value: null, den: THIN_SPLIT_PA },
    { label: "5月", value: 0.8, den: 100 },
  ]);
  assert.equal(sparkBox(mixed), null, "믿을 달이 1개인데 꺾은선을 그렸다 — 이 시험의 전제가 틀렸다");
  assert.equal(noteOf(mixed)?.text, expectedUncomputableNote("ops", THIN_SPLIT_PA), "문턱 이상 null 1 + 정상 1 에 첫째 문구를 말한다");
});

test("⚠N18 문턱 미만인 달만 여럿이면 첫째 문구 — 나온 달 수가 아니라 「분모가 문턱 이상인 달」 수로 가른다", () => {
  const out = render("ops", [
    { label: "3月", value: 0.8, den: 10 },
    { label: "4月", value: 0.9, den: 12 },
    { label: "5月", value: null, den: 1 },
    // ⚠**문턱 바로 아래** — 이것을 「문턱 이상」으로 세면 둘째 문구로 새어 나간다
    { label: "6月", value: 0.7, den: THIN_SPLIT_PA - 1 },
  ]);
  assert.equal(sparkBox(out), null);
  assert.equal(noteOf(out)?.text, expectedNote("ops", THIN_SPLIT_PA), "문턱 미만 달뿐인데 첫째 문구가 아니다");
});

/**
 * ⚠**안내 조건과 그리기 판정을 전수로 맞댄다**(N18 교차 검토 P2 · 조정자 방침).
 * 달의 네 부류(값·분모): 믿을 달(있음·문턱 이상) · 얇은 달(있음·미만) · 값 없는 문턱 이상 달 · 값 없는 미만 달.
 * 부류마다 개수를 바꿔 가며, 최소 달 수는 **기본값과 3** 둘로 — 구현을 부르지 않는 **오라클**로 기대를 센다:
 * 나온 달 0 → 아무것도 없음 · 믿을 달 ≥ 최소 → 꺾은선 · (믿을 달 + 값 없는 문턱 이상 달) < 최소 → 첫째 문구 · 나머지 → 둘째 문구.
 * ⚠**M12 의 불변식**: 꺾은선도 안내도 없는 것은 **나온 달이 0개**일 때뿐이고, 둘이 함께 나오는 일은 없다.
 */
test("⚠N18 안내 조건과 그리기 판정이 동치다 — 나온 달이 있고 안 그릴 때만, 언제나 참인 한 문구(전수 · 최소 달 수 2·3)", () => {
  const seen: Record<string, number> = { none: 0, chart: 0, first: 0, second: 0 };
  let cases = 0;
  // ⚠**기본값과 그것과 다른 수** — 박은 「3」이면 상수가 3 이 된 날 같은 수를 두 번 잰다
  for (const minSolid of [SPARK_MIN_SOLID_MONTHS, SPARK_MIN_SOLID_MONTHS + 1]) {
    for (let solid = 0; solid <= 3; solid += 1) {
      for (let thin = 0; thin <= 2; thin += 1) {
        for (let nullEnough = 0; nullEnough <= 3; nullEnough += 1) {
          for (let nullThin = 0; nullThin <= 2; nullThin += 1) {
            const months: Month[] = [];
            const add = (n: number, value: number | null, den: (i: number) => number): void => {
              for (let i = 0; i < n; i += 1) months.push({ label: `${months.length + 1}月`, value, den: den(i) });
            };
            add(solid, 0.8, (i) => THIN_SPLIT_PA + i * 7);
            add(thin, 0.7, (i) => THIN_SPLIT_PA - 1 - i * 9);
            add(nullEnough, null, (i) => THIN_SPLIT_PA + i * 3);
            add(nullThin, null, () => 1);
            const expected =
              months.length === 0 ? "none" : solid >= minSolid ? "chart" : solid + nullEnough < minSolid ? "first" : "second";
            const out = toString(sparkline(sparkOf("ops", months).spark!, minSolid));
            const chart = sparkBox(out) !== null;
            const note = noteOf(out)?.text ?? null;
            const got = chart
              ? note === null ? "chart" : `꺾은선과 안내가 함께 — ${note}`
              : note === null ? "none"
              : note === expectedNote("ops", THIN_SPLIT_PA, minSolid) ? "first"
              : note === expectedUncomputableNote("ops", THIN_SPLIT_PA, minSolid) ? "second"
              : `모르는 문구 — ${note}`;
            assert.equal(got, expected, `믿을 ${solid} · 얇은 ${thin} · 값 없는 문턱 이상 ${nullEnough} · 값 없는 미만 ${nullThin} · 최소 ${minSolid}`);
            seen[got] = (seen[got] ?? 0) + 1;
            cases += 1;
          }
        }
      }
    }
  }
  // ⚠**공회전 방지** — 네 결과가 전부 나와야 이 전수가 뜻이 있다
  for (const k of ["none", "chart", "first", "second"]) assert.ok((seen[k] ?? 0) > 0, `「${k}」가 한 번도 안 나왔다 — 전수가 헛돈다: ${JSON.stringify(seen)}`);
  console.log(`  · ${cases}경우 — ${JSON.stringify(seen)}`);
});

/**
 * ⚠**둘째 문구는 투수에게 구조적으로 안 나온다**(조정자 방침 — 그 사실을 시험으로 둔다).
 * 방어율은 `earnedRunAverage` 가 **0아웃에서만** 정의하지 않고, 0 은 문턱(`THIN_SPLIT_OUTS` = 9アウト) 미만이다 —
 * 즉 문턱 이상인 달은 언제나 값이 있다. 타자는 다르다: 30打席이 전부 볼넷이면 타수 0 → 장타율 없음 → OPS 없음.
 * ⚠**렌더러는 지표를 가리지 않는다** — 투수 쪽에 둘째 문구가 없는 것은 렌더러의 분기가 아니라 **데이터의 성질**이다.
 */
test("⚠N18 둘째 문구는 투수에게 구조적으로 안 나온다 — 문턱(9アウト) 이상이면 방어율은 늘 정의된다 · 타자는 나올 수 있다", () => {
  const pitch = (outs: number, er: number): PitchingLine => ({ outs, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er, r: er });
  let checked = 0;
  for (let outs = THIN_SPLIT_OUTS; outs <= THIN_SPLIT_OUTS * 40; outs += 1) {
    for (const er of [0, 1, 9, 40]) {
      assert.notEqual(earnedRunAverage(pitch(outs, er)).value, null, `${outs}アウト ${er}자책의 방어율이 정의되지 않는다`);
      checked += 1;
    }
  }
  assert.ok(checked > 1000, `잰 경우가 ${checked} 뿐이다 — 이 시험이 헛돈다`);
  // 정의되지 않는 것은 0아웃뿐이고, 0 은 문턱 미만이라 그런 달은 첫째 문구 쪽이다
  assert.equal(earnedRunAverage(pitch(0, 3)).value, null);
  assert.ok(0 < THIN_SPLIT_OUTS, "문턱이 0 이하다 — 0아웃 달이 문턱 이상으로 세어진다");
  // 타자는 문턱 이상이어도 값이 없을 수 있다 — 둘째 문구가 필요한 이유
  const walks: BattingLine = {
    pa: THIN_SPLIT_PA, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: THIN_SPLIT_PA, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
  };
  assert.equal(ops(walks).value, null, "타수 0 인 달의 OPS 가 정의된다 — 둘째 문구의 전제가 바뀌었다");
  assert.ok(ops(walks).denominator >= THIN_SPLIT_PA, "OPS 의 분모(타석)가 문턱 미만이다 — 이 시험의 전제가 틀렸다");
});

test("⚠N18 안내는 그림이 아니라 글자다 — 낭독되고(aria-hidden 없음), 그림 요소가 없다", () => {
  const out = render("ops", [
    { label: "4月", value: 0.8, den: 10 },
    { label: "5月", value: 0.9, den: 100 },
  ]);
  const note = noteOf(out);
  assert.ok(note !== null, "안내가 없다 — 이 시험이 잴 것이 없다");
  // ⚠**낭독에서 빼지 않는다** — 캡션 끝의 범례(○＝…)는 그림의 부호를 푸는 글자라 뺐지만, 이건 그림 대신 말하는 글자다
  assert.doesNotMatch(note.html, /\baria-|\brole=|<svg|<img|<canvas/, `안내가 평범한 글자가 아니다: ${note.html}`);
  const head = /<header class="idline"[^>]*>/.exec(out)?.[0];
  assert.ok(head !== undefined && !head.includes("aria-hidden"), `표제가 낭독을 끈다: ${head}`);
});

/** WCAG 2.x 대비 — 이 저장소는 시험 파일마다 한 벌씩 둔다(css-contrast · css-tables 와 같은 식) */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** 표제 줄의 요소들 — 캐스케이드 계산기(`css-cascade.ts`)에 넘긴다 */
const IDLINE: Omit<El, "ancestors"> = { tag: "header", classes: ["idline"] };
const NOTE_EL: El = { tag: "p", classes: ["sparknote"], ancestors: [IDLINE] };
const SPARK_EL: El = { tag: "div", classes: ["spark"], ancestors: [IDLINE] };
const CAPTION_EL: El = { tag: "span", classes: ["sl"], ancestors: [IDLINE, { tag: "div", classes: ["spark"] }] };

test("⚠N18 안내는 캡션(.spark .sl)과 같은 층의 조용한 글자다 — 글꼴·크기·색·자간이 같고, 세 테마 길에서 4.5:1 이상", () => {
  const rules = parseRules(CSS);
  // ⚠**새 층을 만들지 않는다** — 캡션과 한 벌이어야 캡션을 고친 날 안내도 같이 바뀐다
  for (const prop of ["font-family", "font-size", "color", "letter-spacing", "line-height", "font-weight"]) {
    assert.equal(computed(rules, NOTE_EL, prop), computed(rules, CAPTION_EL, prop), `안내의 ${prop} 가 캡션과 다르다`);
  }
  assert.ok(computed(rules, CAPTION_EL, "color") !== undefined, "캡션의 글자색을 못 읽었다 — 이 시험이 공회전한다");
  const color = computed(rules, NOTE_EL, "color");
  const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(color ?? "")?.[1];
  assert.ok(token !== undefined, `안내의 글자색이 토큰이 아니다: ${color}`);
  // ⚠**대비는 계산한다**(눈대중 금지) — 라이트 · 다크(토글) · 다크(OS 설정) 세 길 전부. 바탕은 --page(표제는 배경을 안 깐다)
  const root: El = { tag: "html", classes: [], root: true };
  const themes: readonly [string, El, (q: string) => boolean][] = [
    ["라이트", root, () => false],
    ["다크(토글)", { ...root, attrs: { "data-theme": "dark" } }, () => false],
    ["다크(OS)", root, (q) => /prefers-color-scheme:\s*dark/.test(q)],
  ];
  for (const [name, el, mediaOk] of themes) {
    const ink = computed(rules, el, token, mediaOk);
    const page = computed(rules, el, "--page", mediaOk);
    assert.ok(ink !== undefined && page !== undefined, `${name}: ${token} 또는 --page 를 못 읽었다`);
    const r = contrastRatio(ink, page);
    assert.ok(r >= 4.5, `${name}: 안내 ${ink} / 바탕 ${page} = ${r.toFixed(3)}:1 — 본문 4.5:1 미달`);
  }
  // ⚠**흐리게 하지 않는다** — opacity 를 얹으면 위 계산이 거짓이 된다
  assert.equal(computed(rules, NOTE_EL, "opacity"), undefined, "안내에 opacity 를 얹었다");
});

/**
 * ⚠**꺾은선이 차지하던 자리보다 커지지 않는다 — 폭 세 구간에서.**
 * 실측(2026-09-28 · Consolas→Yu Gothic · palt · 9.5px · 브라우저 아님, harfbuzz 로 글꼴을 직접 셈):
 * 한 줄 안내는 타자 **194.6px** · 투수 **191.5px** 이고, 꺾은선 상자는 타자 108(범례 없음)~159px · 투수 166~226px,
 * 높이는 꺾은선 **42.7px** 대 안내 **14.7px** 이다. 한 줄 폭으로 줄바꿈을 판정하면 꺾은선이 들어갈 자리에서
 * 안내가 먼저 다음 줄로 밀린다 → **판정에는 최소 폭**(라벨 / 조건 두 줄 · 타자 147.6 · 투수 131.8px)을 쓰고,
 * 자리가 있으면 한 줄까지만 넓힌다(`flex-basis:0` + `max-width:max-content`).
 * ⚠**이 시험이 재는 것은 CSS 계약(캐스케이드 계산값)이다 — 실제 박스 폭·높이·줄 수는 안 잰다**(브라우저 없음 ·
 *   N18 교차 검토 P3). 위 폭 수치는 글꼴 파일만 센 것이고, 화면 실측은 빌드 때 따로 한다.
 * ⚠**줄은 라벨과 조건 사이(「　」)에서만 바꾼다**(`word-break:keep-all`) — 이 선언을 빼도 예전 시험은 초록이었다
 *   (검토자 실측 21/21). 빼면 좁은 폭에서 「2」와 「つ」가 갈릴 수 있다.
 */
test("⚠N18 안내 자리의 CSS 계약 — 빈 틀 없이, 넓은 폭은 오른쪽 끝 · 680px 이하는 제 줄의 왼쪽 · 줄은 「　」에서만 바꾼다", () => {
  const rules = parseRules(CSS);
  /** 폭 한 점에서 켜지는 `@media` — 이 스타일시트의 폭 조건은 max-width 뿐이다. 인쇄·강제 색·다크·모션 감소는 끈다 */
  const at =
    (width: number, coarse: boolean) =>
    (q: string): boolean =>
      q.split(/\s+and\s+/).every((c) => {
        const w = /^\(max-width:\s*(\d+)px\)$/.exec(c.trim());
        if (w !== null) return width <= Number(w[1]);
        if (/^\(pointer:\s*coarse\)$/.test(c.trim())) return coarse;
        if (/^\(hover:\s*hover\)$/.test(c.trim())) return !coarse;
        return false;
      });
  const scenes = [
    ["넓은 폭(1280 · 마우스)", at(1280, false), "row"],
    ["680px 이하(600 · 마우스)", at(600, false), "own"],
    ["좁은 폭(360 · 손가락)", at(360, true), "own"],
  ] as const;
  for (const [name, mediaOk, where] of scenes) {
    // ⚠**빈 상자·회색 막대·점선 틀을 만들지 않는다**(「AI틱함」 · 빈 틀은 데이터가 있는 것처럼 보인다)
    for (const prop of ["background", "background-color", "border", "border-top", "border-bottom", "border-left", "border-right",
      "border-style", "box-shadow", "outline", "padding", "min-height", "height", "min-width"]) {
      assert.equal(computed(rules, NOTE_EL, prop, mediaOk), undefined, `${name}: 안내에 ${prop} 가 있다 — 그림처럼 보이는 틀이다`);
    }
    assert.equal(computed(rules, NOTE_EL, "word-break", mediaOk), "keep-all", `${name}: 안내가 아무 글자 사이에서나 줄을 바꾼다 — 「2」와 「つ」가 갈린다`);
    if (where === "row") {
      assert.equal(computed(rules, SPARK_EL, "margin-left", mediaOk), "auto", "꺾은선이 오른쪽 끝이 아니다 — 이 시험의 전제가 바뀌었다");
      assert.equal(computed(rules, NOTE_EL, "margin-left", mediaOk), "auto", `${name}: 안내가 꺾은선 자리(오른쪽 끝)에 있지 않다`);
      assert.equal(computed(rules, NOTE_EL, "flex-basis", mediaOk), "0", `${name}: 줄바꿈 판정에 한 줄 폭을 쓴다 — 꺾은선보다 먼저 밀린다`);
      assert.equal(computed(rules, NOTE_EL, "max-width", mediaOk), "max-content", `${name}: 자리가 남으면 한 줄보다 넓어진다`);
    } else {
      assert.equal(computed(rules, SPARK_EL, "width", mediaOk), "100%", "꺾은선이 제 줄을 안 쓴다 — 이 시험의 전제가 바뀌었다");
      assert.equal(computed(rules, NOTE_EL, "flex-basis", mediaOk), "100%", `${name}: 안내가 꺾은선처럼 제 줄을 쓰지 않는다`);
      assert.equal(computed(rules, NOTE_EL, "max-width", mediaOk), "none", `${name}: 제 줄에서 폭이 한 줄로 묶였다`);
      assert.equal(computed(rules, NOTE_EL, "margin-left", mediaOk), "0", `${name}: 안내가 왼쪽에서 시작하지 않는다(꺾은선과 다른 자리)`);
    }
  }
});
