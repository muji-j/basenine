/**
 * **연속 기록의 리그 전체 목록** — 순위 화면의 `連続記録` 부문.
 *
 * 설계 `docs/superpowers/specs/2026-09-07-streak-ranking-design.md` ·
 * 지표 정본 `docs/metrics/2026-09-07-streak-metrics.md` §1-6 · §1-7.
 *
 * ## ⚠이 표의 `順位 없음` 은 순위표의 그것과 **정반대의 뜻**이다
 *
 * 기존 순위표에서 `rank === null` 은 **「규정 미달」**이라 기본으로 **숨는다**.
 * 연속 기록에서 `rank === null` 은 **「비교가 성립하지 않는다」**(`23回以上` 과 `23回`)라
 * **반드시 보여야 한다.** 같은 부품에 두 뜻을 넣으면 그 순간 한쪽이 조용히 틀린다 —
 * 그래서 표를 따로 만들었고, **이 파일이 그 경계를 지킨다.**
 *
 * ## ⚠컷 — 「以上」을 하한으로만 자르면 조용히 빠진다
 *
 * `23.1回以上（最大25.1回）` 인 행은 **진짜 값이 25.1 일 수 있다.** 10위가 24.0回 면
 * 그 행은 **상위 10에 들 수도 있다.** 하한으로만 자르면 사라지고, **사라졌다는 사실도 안 보인다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRankingPage, STREAK_RANK_ROWS } from "../src/pages.ts";
import type { LeagueSection, RankingPageData, StreakCategory, StreakRankPanel, StreakRankRow } from "../src/pages.ts";
import { TIE_RULE } from "../src/parts.ts";
import { termLabel } from "../src/glossary.ts";
import { cutStreakRows } from "../src/query.ts";
// ⚠**순위는 계산 계층이 소유한다**(M1) — 시험도 그 함수를 통과시킨다. 손으로 `rank` 를 적으면
//   「우리가 상상한 순위」를 고정하게 되고, 그건 화면이 받는 값이 아니다
import { rankStreaks } from "@bb-app/aggregate";
import { context } from "./fixtures.ts";

const SEASON = 2025;

function row(over: Partial<StreakRankRow> = {}): StreakRankRow {
  return {
    playerId: "41145153",
    name: "石井大智",
    teamCode: "t",
    rank: 1,
    value: "50",
    scanned: "57登板",
    max: "",
    from: "2025-04-05",
    to: "2025-09-28",
    ...over,
  };
}

function panelOf(over: Partial<StreakRankPanel> = {}): StreakRankPanel {
  return {
    id: "scorelessAppearanceStreak",
    rows: [row()],
    candidates: 162,
    scannedUnit: "登板",
    isInnings: false,
    // ⚠**기본은 확정**이다 — 유보가 붙는 쪽은 시험이 명시적으로 켠다
    spanUncertain: false,
    ...over,
  };
}

function categoryOf(panels: StreakRankPanel[]): StreakCategory {
  return { id: "streak", label: "連続記録", panels };
}

function leagueOf(panels: StreakRankPanel[]): LeagueSection {
  return {
    id: "central",
    name: "セントラル・リーグ",
    categories: [{ id: "batter", label: "打者", panels: [] }],
    streaks: categoryOf(panels),
  };
}

function pageData(leagues: LeagueSection[], seasonOver = false): RankingPageData {
  return { season: SEASON, asOf: "2025-10-02", seasonOver, standings: [], tieRule: TIE_RULE, draws: [], leagues };
}

function render(panels: StreakRankPanel[], seasonOver = false): string {
  return renderRankingPage(pageData([leagueOf(panels)], seasonOver), context());
}

/** 그 부문 패널만 잘라 본다 — 다른 부문의 글자가 섞이면 판정이 헐거워진다 */
function streakSection(html: string): string {
  const m = /<div data-panelgroup="rankcat" data-panelkey="streak"[\s\S]*$/.exec(html);
  assert.notEqual(m, null, "連続記録 부문 패널이 없다");
  return m![0];
}

// ────────────────────────────────────────────────────────────── 부문과 탭

test("⚠부문 탭에 連続記録 이 있고, 리그마다 id 가 갈린다 — 2026-08-19 의 중복 id P1 재발 방지", () => {
  const pacific: LeagueSection = { ...leagueOf([panelOf()]), id: "pacific", name: "パシフィック・リーグ" };
  const html = renderRankingPage(pageData([leagueOf([panelOf()]), pacific]), context());
  assert.match(html, /data-tab="streak"/);
  // ⚠**두 리그가 같은 id 를 쓰면 `getElementById` 가 セ 사본만 돌려준다** — パ 를 URL 로 못 가리킨다
  assert.ok(html.includes('id="tb-rankcat-central-streak"'), "セ의 부문 탭 id 가 없다");
  assert.ok(html.includes('id="tb-rankcat-pacific-streak"'), "パ의 부문 탭 id 가 없다");
  // 축 탭도 마찬가지다
  assert.ok(
    html.includes('id="pn-rankstreak-central-scorelessAppearanceStreak"'),
    "セ의 축 패널 id 가 없다",
  );
  assert.ok(
    html.includes('id="pn-rankstreak-pacific-scorelessAppearanceStreak"'),
    "パ의 축 패널 id 가 없다",
  );
});

test("⚠축 탭 그룹은 지표 탭 그룹과 다르다 — 같으면 부문을 바꿨을 때 아무 표도 안 열린다", () => {
  const html = render([panelOf()]);
  assert.ok(html.includes('data-tabgroup="rankstreak"'), "연속 기록의 탭 그룹이 rankmetric 과 섞여 있다");
});

// ────────────────────────────────────────────────────────────── 라벨(M1)

test("⚠라벨은 용어집에서 나오고 term() 버튼이다 — 키보드·터치로 설명을 열 수 있어야 한다", () => {
  const s = streakSection(render([panelOf()]));
  assert.match(s, /data-term="scorelessAppearanceStreak"/);
  assert.ok(
    s.includes(`>${termLabel("scorelessAppearanceStreak")}</button>`),
    "표 머리의 라벨이 버튼이 아니다 — 평문이면 키보드로 설명을 열 방법이 없다",
  );
});

test("⚠용어집의 라벨을 바꾸면 화면이 따라온다 — 문자열을 박아 두면 여기가 떨어진다", () => {
  const s = streakSection(render([panelOf({ id: "hitStreak", scannedUnit: "試合" })]));
  /**
   * ⚠**탭 라벨만 보면 안 잡힌다** — 뮤테이션 검사에서 표 머리의 라벨을 `連続無失点登板` 로
   * 박았는데도 탭은 `termLabel(p.id)` 를 쓰므로 시험이 통과했다.
   * **표 자신이 무엇의 표인지 말하는 두 자리**(`aria-label` 과 머리 버튼)를 본다.
   */
  assert.ok(
    s.includes(`<table aria-label="${termLabel("hitStreak")}のリーグ順位">`),
    "표의 이름이 그 축의 이름이 아니다",
  );
  assert.ok(
    s.includes(`data-term="hitStreak" aria-describedby="tip">${termLabel("hitStreak")}</button>`),
    "표 머리의 라벨이 그 축의 것이 아니다",
  );
  // 9.23(a) 의 다른 기록 이름이 새어 나오면 안 된다
  assert.ok(!/>連続安打</.test(s), "9.23(a) の別記録の名前が出ている");
});

// ────────────────────────────────────────────────────────────── 분모(M2)

test("⚠모든 행이 분모 3종을 낸다 — 값 옆의 사건 수 · 기간 · 각주의 집계 범위", () => {
  const s = streakSection(render([panelOf()]));
  assert.ok(s.includes('<span class="den">57登板</span>'), "훑은 등판 수(분모 ⑴)가 없다");
  assert.match(s, /4月5日〜9月28日/, "마루의 기간(분모 ⑵)이 없다");
  assert.match(s, /2025年のレギュラーシーズンのみ/, "집계 범위(분모 ⑶)가 없다");
});

test("⚠분모의 단위가 타자와 투수에서 다르다 — 같은 말로 적으면 다른 것을 센 것처럼 읽힌다", () => {
  const p = streakSection(render([panelOf()]));
  // ⚠**`note()` 가 `**…**` 를 `<b>` 로 바꾼다** — 원문 마크업으로 찾으면 영원히 안 맞는다
  assert.match(p, /<b>この範囲で数えた登板<\/b>の数/);
  const b = streakSection(
    render([panelOf({ id: "hitStreak", scannedUnit: "試合", rows: [row({ scanned: "104試合" })] })]),
  );
  assert.match(b, /<b>この範囲で数えた試合<\/b>の数/);
});

test("⚠포스트시즌을 섞지 않았다고 말한다 — 石井大智는 정규만이면 이어지고 일본시리즈를 넣으면 끊긴다", () => {
  const s = streakSection(render([panelOf()]));
  assert.match(s, /日本シリーズ/);
  assert.match(s, /クライマックスシリーズ/);
});

test("⚠연도를 박지 않는다 — 보고 있는 시즌에서 유도한다", () => {
  const other = renderRankingPage({ ...pageData([leagueOf([panelOf()])]), season: 2019 }, context());
  assert.match(streakSection(other), /2019年のレギュラーシーズンのみ/);
});

// ────────────────────────────────────────────────────────────── 「以上」과 순위 없음

test("⚠「以上」 행의 順位 칸은 — 이고, 보이지 않는 설명이 붙는다(색·흐림으로 말하지 않는다)", () => {
  const s = streakSection(
    render([
      panelOf({
        id: "scorelessInningStreak",
        isInnings: true,
        rows: [
          row({ rank: 1, value: "49回" }),
          row({ playerId: "03305153", name: "山﨑伊織", rank: null, value: "23.1回以上", max: "最大25.1回" }),
        ],
      }),
    ]),
  );
  assert.match(s, /<span class="vh">順位なし（「以上」の記録のため）<\/span>/);
  // 값 안에 「以上」이 **글자로** 있다 — 상태를 색으로 말하지 않는다
  assert.match(s, /23\.1回以上/);
});

test("⚠「以上」 행이 있으면 각주가 「완전한 순위표가 아니다」라고 말한다", () => {
  const s = streakSection(
    render([
      panelOf({
        id: "scorelessInningStreak",
        isInnings: true,
        rows: [row({ rank: null, value: "23.1回以上", max: "最大25.1回" })],
      }),
    ]),
  );
  assert.match(s, /完全な順位表ではありません/);
  assert.match(s, /「23回以上」と「23回」は比べられません/);
});

test("⚠확정만 있는 표에는 그 각주를 안 붙인다 — 없는 유보를 적으면 그것도 거짓이다", () => {
  const s = streakSection(render([panelOf()]));
  assert.ok(!/完全な順位表ではありません/.test(s), "「以上」이 없는데 유보 각주가 붙었다");
});

test("⚠상한을 값 옆에 함께 낸다 — 상한도 「반드시 참」이다(정의서 §3-3)", () => {
  const s = streakSection(
    render([
      panelOf({
        id: "scorelessInningStreak",
        isInnings: true,
        rows: [row({ rank: null, value: "23.1回以上", max: "最大25.1回", scanned: "47登板" })],
      }),
    ]),
  );
  assert.ok(s.includes('<span class="den">最大25.1回 · 47登板</span>'), "상한과 분모가 한 칸에 안 모였다");
});

/**
 * ⚠**각주가 「期間」을 「記録に数えた最後の試合まで」라고 약속한다**(2026-09-07 P2).
 * 경계 등판을 셀지 말지가 안 정해지면 **기간의 끝도 안 정해진다** — 그때 좁은 기간을
 * 단정해 두고 아무 말도 안 하면 그 약속이 거짓이 된다(M11).
 */
test("⚠기간이 확정이 아니면 그 사실을 말한다 — 확정인 표에는 안 말한다", () => {
  const uncertain = streakSection(
    render([
      panelOf({
        id: "scorelessInningStreak",
        isInnings: true,
        spanUncertain: true,
        rows: [row({ rank: null, value: "23.1回以上", max: "最大25.1回" })],
      }),
    ]),
  );
  assert.match(uncertain, /この「期間」がさらに広がることがあります/);

  const certain = streakSection(
    render([panelOf({ id: "scorelessInningStreak", isInnings: true, spanUncertain: false })]),
  );
  assert.ok(
    !/この「期間」がさらに広がることがあります/.test(certain),
    "확정인 표에 없는 유보를 적었다 — 그것도 거짓이다",
  );
});

test("⚠이닝 축에만 「33.1回 は 33と1/3回」를 적는다 — 값이 곧 이닝인 축이다", () => {
  const inn = streakSection(render([panelOf({ id: "scorelessInningStreak", isInnings: true })]));
  assert.match(inn, /33と1\/3回/);
  const cnt = streakSection(render([panelOf()]));
  assert.ok(!/33と1\/3回/.test(cnt), "개수 축에 이닝 각주가 붙었다");
});

// ────────────────────────────────────────────────────────────── 자른 것을 말한다

test("⚠자른 것을 말한다 — 「N人のうち M人」과 상한 순위(작업규칙 7 · M3)", () => {
  const s = streakSection(render([panelOf({ candidates: 162, rows: [row(), row({ playerId: "x", rank: 2 })] })]));
  assert.match(s, /162人のうち/);
  assert.match(s, /<b>2人<\/b>/);
  assert.match(s, new RegExp(`<b>${STREAK_RANK_ROWS}位まで</b>`));
});

// ────────────────────────────────────────────────────────────── 빈 상태(M12·M11)

test("⚠빈 패널이 후보 수를 함께 낸다 — 「선수가 0명」과 「기록이 0건」은 다른 상태다", () => {
  const none = streakSection(render([panelOf({ rows: [], candidates: 0 })]));
  assert.match(none, /対象 0人/);
  const some = streakSection(render([panelOf({ rows: [], candidates: 31 })]));
  assert.match(some, /対象 31人/);
});

test("⚠빈 패널에는 표를 그리지 않는다 — 머리줄만 있는 표는 「없다」와 「고장」이 같은 화면이다", () => {
  const s = streakSection(render([panelOf({ rows: [], candidates: 0 })]));
  assert.ok(!/<thead>/.test(s.split("</section>")[0] ?? s), "빈 패널에 표 머리가 남아 있다");
});

// ────────────────────────────────────────────────────────────── 이 표가 답하는 질문

test("⚠「지금 이어지고 있는 기록」이 아니라고 말한다 — 그건 다른 화면의 표다", () => {
  const s = streakSection(render([panelOf()]));
  assert.match(s, /いま続いている記録ではありません/);
  assert.match(s, /続いている記録/);
});

/**
 * ⚠**각주가 가리키는 구획이 그 시즌 화면에 실재해야 한다**(2026-09-07 이중 검토 P1 · M1).
 *
 * 이 각주는 **다른 화면의 구획 이름**을 부른다. 그 이름은 시즌이 끝났는지로 갈리는데
 * (`streakSectionTitle`), 여기서 **`false` 를 하드코딩**하고 있었다 — 완결 시즌의 홈·구단은
 * 「続いて**いた**記録」이므로 **없는 구획을 가리켰다.**
 * 실측(고치기 전 빌드): `dist/2025/ranking.html` 에 「続いている記録」 **16건** ·
 * 같은 시즌 `dist/2025/index.html` 에 「続いていた記録」 **3건**. 2018·2020·2024 도 같았다.
 *
 * ⚠**이전 시험은 `/続いている記録/` 만 봤고 `seasonOver=true` 픽스처를 한 번도 안 줬다** —
 * 그래서 초록인 채로 지나갔다. **여기서 두 시제를 다 준다.**
 */
test("⚠완결 시즌의 각주는 「続いていた記録」을 가리킨다 — 없는 구획 이름을 부르지 않는다", () => {
  const over = streakSection(render([panelOf()], true));
  assert.match(over, /続いていた記録/, "완결 시즌인데 과거형 구획 이름이 없다");
  assert.ok(
    !/続いている記録/.test(over),
    "완결 시즌 화면이 현재형 「続いている記録」을 가리킨다 — 그 시즌의 홈·구단에 그 구획은 없다",
  );

  const live = streakSection(render([panelOf()], false));
  assert.match(live, /いま続いている記録ではありません/);
  assert.ok(!/続いていた記録/.test(live), "진행 중 시즌인데 과거형 구획 이름을 가리킨다");
});

// ────────────────────────────────────────────────────────────── 안 싣는 축

test("⚠連続試合無安打 は載せない — 公表されている記録の区分にない(설계 §3-3)", () => {
  const s = streakSection(render([panelOf()]));
  assert.ok(!/連続試合無安打/.test(s), "리그 전체 목록에 무안타 축이 실렸다");
});

// ────────────────────────────────────────────────────────────── 순서

test("⚠받은 순서를 그대로 그린다 — 렌더러가 다시 정렬하면 rankStreaks 와 두 벌이 된다(M1)", () => {
  const s = streakSection(
    render([
      panelOf({
        // ⚠**id 의 사전 순서와 다르게 준다** — 같게 주면 렌더러가 다시 정렬해도 시험이 통과한다
        //   (뮤테이션 검사에서 실제로 그랬다: `aaa·bbb·ccc` 로는 재정렬을 못 잡았다)
        rows: [
          row({ playerId: "ccc", name: "三", rank: 1, value: "20" }),
          row({ playerId: "aaa", name: "一", rank: 2, value: "18" }),
          row({ playerId: "bbb", name: "二", rank: 2, value: "18" }),
        ],
      }),
    ]),
  );
  const order = [...s.matchAll(/players\/(\w+)\.html/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(0, 3), ["ccc", "aaa", "bbb"]);
});

// ────────────────────────────────────────────────────────────── 컷 (query.ts)

/**
 * **컷은 계산이 아니라 판단이다** — `rankStreaks` 가 준 순위 위에서 「어디까지 싣는가」를 정한다.
 *
 * ⚠**여기서 순위를 다시 매기지 않는다**(M1). 아래 픽스처는 **`rankStreaks` 를 실제로 통과시킨다** —
 * 손으로 `rank` 를 적으면 「우리가 상상한 순위」를 시험하게 되고, 그건 화면이 받는 값이 아니다.
 */
function entry(
  playerId: string,
  value: number,
  over: Partial<{ outs: number; to: string; rankable: boolean; upper: number }> = {},
) {
  return { playerId, value, outs: value, to: "2025-09-01", rankable: true, upper: value, ...over };
}

function cut(rows: readonly ReturnType<typeof entry>[]) {
  return cutStreakRows(rankStreaks(rows), STREAK_RANK_ROWS);
}

test("⚠순위 10위까지 싣고 11위는 안 싣는다", () => {
  const rows = Array.from({ length: 20 }, (_, i) => entry(`p${String(i).padStart(2, "0")}`, 100 - i));
  const kept = cut(rows);
  assert.equal(kept.length, STREAK_RANK_ROWS);
  assert.deepEqual(kept.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("⚠동률로 10위가 여럿이면 전원 싣는다 — 잘라내면 「같은 값인데 한 명만 있다」가 된다", () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => entry(`a${i}`, 100 - i)),
    entry("z1", 50),
    entry("z2", 50),
    entry("z3", 50),
    entry("w1", 40),
  ];
  const kept = cut(rows);
  assert.equal(kept.length, 12, "동률 3명이 다 실려야 한다");
  assert.ok(kept.every((r) => r.value >= 50));
  assert.deepEqual(kept.slice(9).map((r) => r.rank), [10, 10, 10]);
});

test("⚠「以上」 행은 상한이 경계에 닿으면 실린다 — 하한으로만 자르면 조용히 빠진다", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => entry(`a${i}`, 100 - i)),
    // 하한 80 은 10위(91)보다 낮지만 **상한 95 는 넘는다** — 상위 10에 들 수도 있는 기록이다
    entry("maybe", 80, { rankable: false, upper: 95 }),
  ];
  const kept = cut(rows);
  const mine = kept.find((r) => r.playerId === "maybe");
  assert.notEqual(mine, undefined, "상한이 닿는 「以上」 행이 빠졌다");
  assert.equal(mine!.rank, null, "「以上」 행에 순위가 붙었다 — 비교가 성립하지 않는다");
});

test("⚠상한도 경계에 못 닿는 「以上」 행은 안 싣는다 — 들 수 없는 기록까지 실으면 목록이 아니다", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => entry(`a${i}`, 100 - i)),
    entry("nope", 10, { rankable: false, upper: 20 }),
  ];
  assert.equal(cut(rows).some((r) => r.playerId === "nope"), false);
});

test("⚠「以上」 행이 순위를 밀어내지 않는다 — 순위는 확정 행 사이에서만 센다", () => {
  const rows = [
    entry("top", 100),
    entry("ijou", 99, { rankable: false, upper: 99 }),
    entry("second", 98),
  ];
  assert.deepEqual(cut(rows).map((r) => r.rank), [1, null, 2]);
});

test("⚠확정 행이 하나도 없어도 빈 표를 내지 않는다(M11) — 값 상위로 경계를 잡는다", () => {
  const rows = Array.from({ length: 15 }, (_, i) =>
    entry(`x${String(i).padStart(2, "0")}`, 100 - i, { rankable: false, upper: 100 - i }));
  const kept = cut(rows);
  assert.equal(kept.length, STREAK_RANK_ROWS);
  assert.ok(kept.every((r) => r.rank === null));
});

test("⚠순서는 rankStreaks 그대로다 — 값→아웃→to 늦은 것→playerId(정적 생성이라 흔들리면 diff 다)", () => {
  const rows = [
    entry("bbb", 10, { to: "2025-05-01" }),
    entry("aaa", 10, { to: "2025-05-01" }),
    entry("ccc", 10, { to: "2025-06-01" }),
  ];
  assert.deepEqual(cut(rows).map((r) => r.playerId), ["ccc", "aaa", "bbb"]);
});
