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
import { renderPlayerPage, THIN_SPLIT_OUTS } from "../src/player-page.ts";
import type { PitchingSplitCell, PlayerPageData, SplitAxisData, SplitRow } from "../src/player-page.ts";
import { loadSite, THIN_SPLIT_PA } from "../src/query.ts";
import { innings } from "../src/format.ts";
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
