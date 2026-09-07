/**
 * **투수 연속 무실점 블록** — 화면이 지켜야 하는 것들.
 *
 * 정본은 `docs/metrics/2026-09-07-streak-metrics.md`(§1-5 상태 · §1-6 표시 · §2 PSA · §3 PSI).
 * ⚠**여기서 산식을 재지 않는다** — 계산은 `packages/aggregate/test/pitching-streaks.test.ts` 가 본다.
 * 이 파일이 보는 것은 **「같은 사실이 화면에서 다른 것으로 읽히지 않는가」**다.
 *
 * ## 이 화면에서 조용히 틀릴 수 있는 것 넷
 *
 * ⑴ **`0登板` 과 「데이터 없음」이 같아 보이는 것**(M11·M12). 정의서 §3 은 이닝을 **登板 마루에
 *    붙여** 정의하므로 **마지막 등판에서 실점한 투수의 「지금」은 정의상 0**이다 — 결함이 아니다.
 * ⑵ **두 「以上」이 같은 말을 하는 것**. `exact=false`(그 등판의 실점 시점을 못 짚는다)와
 *    `atRangeStart`(그 앞을 안 봤다)는 **다른 사실**이다.
 * ⑶ **어느 범위를 보고 있는지 안 말하는 것**. 山﨑伊織의 2025 개막 마루는 시즌 범위면 **36.0回 확정**,
 *    통산 범위면 **36.0回以上(최대 42.1回)** 다 — 같은 기록이 범위에 따라 다른 수가 된다.
 * ⑷ **「継続中」이 임의 상수에 기대는 것**(사용자 결정 ⑹). 상수를 두지 않고
 *    **「그 뒤 팀이 몇 경기를 치렀는가」라는 사실**을 늘 같이 낸다 — 이 지표의 **두 번째 분모**다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import { freshness } from "../src/layout.ts";
import { termOf } from "../src/glossary.ts";
import {
  context,
  pitcherMark,
  pitchingBlock,
  pitchingMaru,
  pitchingScope,
  pitchingStreakData,
  playerPage,
} from "./fixtures.ts";
import type { PitchingStreakBlockData } from "../src/player-page.ts";

/** `heldTo` 만 다른 문맥 — **이 값이 「이 시즌이 끝났는가」의 유일한 근거다** */
function heldContext(heldTo: number) {
  return context({ freshness: freshness("2026-08-14", "2026-08-15", "2026-08-14", { from: 2018, to: heldTo }) });
}

function pitcherPage(streaks: PitchingStreakBlockData | null, over: Record<string, unknown> = {}) {
  return playerPage({
    role: "pitcher",
    batting: null,
    pitching: pitchingBlock(),
    mark: pitcherMark(),
    streaks: null,
    pitchingStreaks: streaks,
    ...over,
  });
}

/**
 * **連続記録 구획만** 잘라 낸다.
 * ⚠**페이지 전체에서 찾으면 다른 블록에 걸린다** — 火消し 도 「登板」을 쓰고 通算成績 도 연도를 쓴다.
 */
function streakBlockOf(out: string): string {
  const from = out.indexOf('id="b-streak"');
  assert.notEqual(from, -1, "連続記録 구획이 없다");
  const to = out.indexOf("</section>", from);
  assert.notEqual(to, -1, "連続記録 구획이 닫히지 않았다");
  return out.slice(from, to);
}

const render = (s: PitchingStreakBlockData | null, heldTo = 2026): string =>
  streakBlockOf(renderPlayerPage(pitcherPage(s), heldContext(heldTo)));

// ── ⑴ 「0」과 「없음」 ─────────────────────────────────────────────────────────

/**
 * ⚠**이것이 이 화면에서 가장 조용한 결함이다.** 마지막 등판에서 실점하면
 * `current` 가 `null` 이 되고, 그걸 「데이터 없음」으로 그리면 **정의대로 계산된 0이
 * 결함처럼 보인다.** 반대로 「0」과 「없음」을 같게 그리면 **없는 것이 0으로 보인다.**
 */
test("⚠마지막 등판에서 실점하면 「0登板」이고, 그것은 「기록이 없다」가 아니다", () => {
  const blk = render(
    pitchingStreakData({
      season: pitchingScope({ current: null }),
    }),
  );
  assert.match(blk, />0登板<span class="den">途切れた</, "끊긴 기록을 0으로 안 그렸다");
  // ⚠**이닝 쪽도 0이다** — 정의서 §3 은 이닝을 登板 마루에 붙여 정의한다
  assert.match(blk, />0回<span class="den">途切れた</, "이닝 쪽이 0이 아니다");
  // ⚠**형식을 새로 만들지 않는다**(M1) — 정수 이닝은 `0回` 이고 `0.0回` 가 아니다
  assert.ok(!blk.includes("0.0回"), "이닝 표기 형식이 두 벌이 됐다");
  assert.match(blk, /途切れた/, "끊긴 것을 말하지 않았다");
  assert.match(blk, /記録がないという意味ではありません/, "0과 「없음」을 구별하지 않았다");
  assert.ok(!blk.includes("登板がありません"), "0을 「등판이 없다」로 그렸다");
});

test("⚠등판 자체가 없으면 다른 화면이다 — 0이 아니라 「없다」", () => {
  const blk = render(null);
  assert.match(blk, /レギュラーシーズンの登板がありません/);
  assert.ok(!blk.includes("0登板"), "없는 것을 0으로 그렸다");
  // ⚠**타자용 문장을 쓰지 않는다** — 투수에게 「打席がありません」은 거짓이다(M12)
  assert.ok(!blk.includes("打席がありません"), "투수에게 타자용 빈 상태 문장을 냈다");
});

// ── ⑵ 두 「以上」 ────────────────────────────────────────────────────────────

/**
 * ⚠**사유가 다르면 말이 달라야 한다**(정의서 §1-6). 섞어 쓰면 다음 사람이 잘못된 것을 고친다.
 * `exact=false` 는 **경계 등판의 실점 시점**을 못 짚는 것이고, 상한도 함께 낸다
 * (**하한도 상한도 「반드시 참」이다** — 점추정으로 뭉개지 않는다).
 */
test("⚠「以上」の사유 ① — 경계 등판을 못 짚으면 상한을 함께 낸다", () => {
  const blk = render(
    pitchingStreakData({
      season: pitchingScope({
        current: pitchingMaru({ appearances: 6, lowerOuts: 69, upperOuts: 76, exact: false }),
        bestInnings: pitchingMaru({ lowerOuts: 69, upperOuts: 76, exact: false }),
      }),
    }),
  );
  // ⚠**정수 이닝은 `23回` 다**(`inningsFromOuts` · npb.jp 박스와 같은 표기)
  assert.match(blk, /23回以上/, "하한에 「以上」이 안 붙었다");
  assert.match(blk, /最大25\.1回/, "상한을 안 냈다 — 「어차피 비슷하니 점추정」으로 갔다");
  assert.match(blk, /どのイニングで失点したかを特定できない/, "①의 사유를 말하지 않았다");
  // ⚠**등판 수에는 이 문제가 없다**(항상 확정) — 여기에 「以上」이 붙으면 사유가 섞인 것이다
  assert.ok(!/\d+登板以上/.test(blk), "등판 마루에 경계 사유의 「以上」이 붙었다");
  // ⚠**사유가 하나뿐이면 「最大」는 단정이다** — 아래 시험의 한정어를 여기까지 번지게 하지 않는다
  assert.ok(!blk.includes("保有範囲内では"), "확정할 수 있는 상한에까지 한정어를 붙였다");
  assert.match(blk, /どちらの数字も必ず成り立ちます/, "상한이 반드시 참이라는 말이 사라졌다");
});

/**
 * ⚠**두 사유가 같은 마루에 겹치면 「最大」를 단정할 수 없다.**
 *
 * `atRangeStart` 는 「그 앞을 우리가 안 봤다」이므로 각주가
 * **「実際にはもっと長い可能性があります」**라고 말한다. 그런데 같은 칸이 **「最大8.2回」**라고
 * 단정하면 **두 문장은 동시에 참일 수 없다.**
 *
 * ⚠**추측이 아니라 배포물에서 확인했다**(2026-09-07): `dist/2025/players/91495153.html` 의
 * 通算 패널이 **`6.2回以上` + `最大8.2回` + 그 각주**를 같이 싣고 있었다.
 * 실측 분모: 통산 패널 460개(9시즌 · 그 시즌 등판 투수 중 시즌 넘김 마루 보유자) ·
 * 마루 슬롯 1,134개 중 **4슬롯**(고유 마루 1개 · `91495153`).
 * ⚠**드물다고 놔두면 안 되는 종류다** — 화면이 스스로와 모순되는 것은 빈도의 문제가 아니다.
 *
 * ⚠**숨기지 않고 한정한다.** 상한은 **보유 범위 안에서는 참**이므로, 지우면 참인 정보를 버린다.
 */
test("⚠「以上」の사유가 겹치면 「最大」를 단정하지 않는다 — 각주와 모순되지 않게", () => {
  const maru = pitchingMaru({
    appearances: 6,
    lowerOuts: 20,
    upperOuts: 26,
    exact: false,
    atRangeStart: true,
    from: "2021-06-18",
    to: "2022-04-05",
    seasons: [2021, 2022],
  });
  const blk = render(
    pitchingStreakData({
      career: pitchingScope({
        current: null,
        best: maru,
        bestInnings: maru,
        fromSeason: 2018,
        toSeason: 2026,
      }),
    }),
  );
  assert.match(blk, /6\.2回以上/, "하한을 안 냈다 — 20아웃은 6回2/3다");
  assert.match(blk, /保有範囲内では最大8\.2回/, "상한을 한정 없이 냈다");
  // ⚠**이것이 결함의 모양이다** — `class="den">最大…` 가 단정형이다
  assert.ok(!blk.includes('class="den">最大'), "단정형 「最大」가 그대로 남아 있다");
  // ⚠**각주도 같이 고쳐야 한다** — 「最大までのどこかで必ず成り立つ」는 이 마루에 거짓이다
  assert.ok(
    !blk.includes("どちらの数字も必ず成り立ちます"),
    "보유 범위 밖으로 더 이어질 수 있는 마루에 「반드시 성립한다」고 썼다",
  );
  assert.match(blk, /当サイトが持っている範囲のなかでの上限/, "상한이 무엇의 상한인지 말하지 않았다");
  // ⚠**두 사유는 여전히 각각 말해야 한다**(정의서 §1-6) — 한쪽을 지우는 것으로 때우지 않는다
  assert.match(blk, /どのイニングで失点したかを特定できない/, "사유 ①이 사라졌다");
  assert.match(blk, /2017年以前は未参照/, "사유 ②가 사라졌다");
});

/**
 * ⚠**「2017」을 어디에도 박지 않는다**(사용자 결정 ⑵) — `fromSeason − 1` 에서 유도한다.
 * 그래서 하한이 바뀌면 문구가 따라가야 한다. **그것을 여기서 잰다.**
 */
test("⚠「以上」の사유 ② — 통산 범위의 시작에 닿으면 「(하한−1)年以前は未参照」", () => {
  const s = pitchingStreakData({
    career: pitchingScope({
      current: pitchingMaru({ appearances: 27, lowerOuts: 78, upperOuts: 78, atRangeStart: true, from: "2019-08-01", to: "2022-08-24", seasons: [2019, 2022] }),
      best: pitchingMaru({ appearances: 27, lowerOuts: 78, upperOuts: 78, atRangeStart: true, from: "2019-08-01", to: "2022-08-24", seasons: [2019, 2022] }),
      bestInnings: pitchingMaru({ appearances: 27, lowerOuts: 78, upperOuts: 78, atRangeStart: true, from: "2019-08-01", to: "2022-08-24", seasons: [2019, 2022] }),
      fromSeason: 2018,
      toSeason: 2026,
    }),
  });
  const blk = render(s);
  assert.match(blk, /27登板以上/, "등판 쪽에 범위 사유의 「以上」이 안 붙었다");
  assert.match(blk, /2017年以前は未参照/, "하한 − 1 을 말하지 않았다");
  // ⚠**사유 ①의 문장이 섞이면 안 된다** — 이 마루는 경계가 확정이다
  assert.ok(!blk.includes("最大"), "확정인 마루에 상한을 붙였다");

  // ⚠**하한이 바뀌면 문구가 따라간다** — 숫자를 박았으면 여기서 떨어진다
  const older = render({ ...s, career: { ...s.career!, fromSeason: 2005 } });
  assert.match(older, /2004年以前は未参照/, "「2017」이 어딘가에 박혀 있다");
});

// ── ⑶ 범위 · 토글 ────────────────────────────────────────────────────────────

/**
 * ⚠**같은 기록이 범위에 따라 다른 수가 된다**(정의서 §3-2 · 계획서 §0).
 * 山﨑伊織의 2025 개막 마루는 시즌 범위면 **108아웃 = 36.0回 확정**인데
 * 통산 범위면 2024 마지막 등판이 시작 경계가 되어 **「以上」**이 된다.
 * → **시즌 모드에서 `atRangeStart` 는 「以上」이 아니다**(화면이 이미 「今季」라고 말한다).
 */
test("⚠시즌 범위에서는 「범위의 시작」이 「以上」이 아니다 — 山﨑 케이스", () => {
  const blk = render(
    pitchingStreakData({
      season: pitchingScope({
        current: pitchingMaru({ appearances: 7, lowerOuts: 108, upperOuts: 108, atRangeStart: true }),
        best: pitchingMaru({ appearances: 7, lowerOuts: 108, upperOuts: 108, atRangeStart: true }),
        bestInnings: pitchingMaru({ appearances: 7, lowerOuts: 108, upperOuts: 108, atRangeStart: true }),
      }),
    }),
  );
  assert.match(blk, /36回/, "108아웃을 36回로 안 그렸다");
  assert.ok(!blk.includes("36回以上"), "시즌 시작을 「以上」으로 그렸다 — 화면이 이미 「今季」라고 말한다");
  assert.ok(!blk.includes("年以前は未参照"), "시즌 모드에서 미참조 각주를 냈다");
});

test("⚠어느 범위를 보고 있는지 반드시 말한다 — 대회와 시즌 둘 다", () => {
  const blk = render(pitchingStreakData());
  assert.match(blk, /2026年のレギュラーシーズンのみ/, "집계 범위를 말하지 않았다");
  assert.match(blk, /登板は48試合です/, "훑은 등판 수(첫째 분모)를 말하지 않았다");
  // ⚠**포스트시즌을 넣으면 답이 뒤집히는 선수가 실재한다**(石井大智 · 정의서 §1-1)
  assert.match(blk, /日本シリーズ/, "무엇을 뺐는지 말하지 않았다");
});

/**
 * ⚠**「토글이 없다」가 「기록이 없다」로 읽히면 안 된다**(정의서 §1-6).
 * 고른 답은 「**각주가 그 사실을 말한다**」이고, **전 화면에서 같은 문장을 쓴다.**
 */
test("⚠시즌 넘김 기록이 없으면 탭을 안 만들고, 왜 없는지 말한다", () => {
  const blk = render(pitchingStreakData());
  assert.ok(!blk.includes('data-tabgroup="streak"'), "시즌 넘김 기록이 없는데 탭을 만들었다");
  assert.match(blk, /シーズンをまたぐ連続記録はないため、範囲の切り替えは出していません/);
  // 탭이 없을 때만 머리에 분모를 적는다 — 패널이 하나라 머리가 거짓이 될 수 없다
  assert.match(blk, /登板した48試合/);
});

/**
 * ⚠**보유 하한 시즌에서는 「시즌을 넘는 기록이 없다」를 주장할 수 없다**(M11) —
 * 그 앞을 안 봤기 때문이다. **같은 「토글 없음」이지만 사유가 다르고 말이 달라야 한다.**
 * ⚠**연도를 박지 않는다**(사용자 결정 ⑵) — 보고 있는 시즌에서 유도한다.
 */
test("⚠보유 하한 시즌에서는 「없다」가 아니라 「안 봤다」고 말한다", () => {
  const blk = streakBlockOf(
    renderPlayerPage(
      pitcherPage(pitchingStreakData({ careerFrom: 2018, season: pitchingScope({ fromSeason: 2018, toSeason: 2018 }) }), {
        season: 2018,
        asOf: "2018-10-13",
      }),
      heldContext(2026),
    ),
  );
  assert.match(blk, /2018年より前は当サイトが持っていないため、シーズンをまたぐ記録は出していません/);
  assert.ok(
    !blk.includes("シーズンをまたぐ連続記録はないため"),
    "그 앞을 안 봤는데 「없다」고 단정했다",
  );
});

test("⚠시즌 넘김 기록이 있으면 탭이 둘이고, 머리에 분모를 안 적는다", () => {
  const blk = render(
    pitchingStreakData({
      career: pitchingScope({ appearances: 201, fromSeason: 2018, toSeason: 2026 }),
    }),
  );
  assert.match(blk, /data-tabgroup="streak"/, "탭이 없다");
  assert.match(blk, />今季</);
  assert.match(blk, />通算</);
  /**
   * ⚠**머리는 하나인데 패널은 둘이다** — 「登板した48試合」을 머리에 적어 두면
   * 通算 탭으로 바꿔도 머리가 안 따라가 **화면이 두 개의 분모를 동시에 주장한다**(M2).
   */
  assert.ok(!blk.includes('class="qt">2026年 · 登板した48試合'), "탭이 있는데 머리에 분모를 적었다");
  assert.match(blk, /2018〜2026年のレギュラーシーズンのみ/, "통산 패널이 범위를 말하지 않았다");
  assert.match(blk, /登板は201試合です/, "통산 패널의 분모가 시즌 것으로 남았다");
});

// ── ⑷ 세 상태와 두 번째 분모 ─────────────────────────────────────────────────

test("⚠세 상태가 서로 다른 말이다 — 색이 아니라 글자로 구별한다", () => {
  const going = render(pitchingStreakData());
  assert.match(going, /継続中/);

  const over = render(pitchingStreakData(), 2027);
  assert.match(over, /途切れていない/, "끝난 시즌에 「継続中」이라고 했다");
  assert.ok(!over.includes("継続中"), "끝난 시즌이 현재형으로 말했다");

  const broken = render(pitchingStreakData({ season: pitchingScope({ current: null }) }));
  assert.match(broken, /途切れた/);
});

/**
 * ⚠**이것이 이 지표의 두 번째 분모다**(M2 · 정의서 §1-5). 안 내면 島本의 27등판이
 * 「지금도 무실점 중」으로 읽힌다 — 실제로는 그 사이 시즌 두 개가 통째로 비어 있다.
 * ⚠**임의 상수를 두지 않았다**(사용자 결정 ⑹) — 「며칠 이상이면 끝」이 아니라 **사실을 늘 낸다.**
 */
test("⚠「그 뒤 팀이 몇 경기」를 늘 낸다 — 구단 이름과 함께", () => {
  const blk = render(pitchingStreakData({ since: { teamName: "阪神タイガース", games: 68 } }));
  // ⚠**강조는 별표 두 개로 쓰고 `note()` 가 `<b>` 로 바꾼다**(`emphasis.ts` 가 정본 · M1) —
  //   화면에 `**` 가 글자로 찍히면 여기서 떨어진다(실측 3,459장이 그 상태였던 적이 있다)
  assert.match(blk, /阪神タイガースは<b>68試合<\/b>を戦っていて/, "그 뒤 팀 경기 수를 안 냈다");
  assert.match(blk, /その間の登板はありません/);
  assert.ok(!blk.includes("**68試合**"), "별표가 글자로 찍혔다");
});

test("최신 경기에 등판했으면 그렇게 말한다 — 0을 「0試合」으로 적지 않는다", () => {
  const blk = render(pitchingStreakData());
  assert.match(blk, /それが、そのチームの最新の試合です/);
  assert.ok(!blk.includes("0試合"), "0을 수로 적어 「0경기 남았다」처럼 읽히게 했다");
});

/**
 * ⚠**소속이 바뀌면 그 구단의 경기 수는 「그가 던질 수 있었던 경기 수」가 아니다**(M11).
 * 모르는 것을 다른 것으로 때우지 않고 **경과 일수**를 낸다.
 */
test("⚠소속이 바뀐 투수에게는 경기 수 대신 일수를 낸다", () => {
  const blk = render(pitchingStreakData({ since: null, sinceDays: 41 }));
  assert.match(blk, /<b>41日<\/b>が経っています/);
  assert.match(blk, /所属が変わっている/, "왜 경기 수가 아닌지 말하지 않았다");
});

// ── 표시 규칙 ────────────────────────────────────────────────────────────────

/**
 * ⚠**시즌을 넘으면 연도를 붙인다.** 안 붙이면 `9月13日〜7月19日` 이 되어 **거꾸로 읽힌다.**
 * ⚠**건너뛴 시즌을 말한다**(정의서 §1-6) — 島本은 2019 →(2020·2021 등판 없음)→ 2022 다.
 */
test("⚠시즌 넘김 마루는 연도를 붙이고 건너뛴 시즌을 말한다", () => {
  const maru = pitchingMaru({
    appearances: 27,
    lowerOuts: 78,
    upperOuts: 78,
    from: "2019-08-01",
    to: "2022-08-24",
    seasons: [2019, 2022],
  });
  const blk = render(
    pitchingStreakData({
      career: pitchingScope({ current: maru, best: maru, bestInnings: maru, appearances: 201, fromSeason: 2018, toSeason: 2026 }),
    }),
  );
  assert.match(blk, /2019年8月1日〜2022年8月24日/, "연도가 없어 거꾸로 읽힌다");
  assert.match(blk, /2020・2021年は登板なし/, "건너뛴 시즌이 안 보인다");
});

/**
 * ⚠**イニング 축의 기간은 登板 축의 기간이 아니다**(2026-09-07 이중 검토 P2 · 정의서 §3-3-B).
 *
 * 규칙 R 에서 **경계 등판의 아웃이 값에 들어가는데**, 그 등판은 **登板 마루에는 안 들어간다.**
 * 그래서 두 축의 기간을 한 필드로 쓰면 **값의 근거가 된 경기가 기간에서 빠진다.**
 * 실측 사례가 山﨑(2025 · `36回` = 4/2~4/30 의 105아웃 + **5/7 의 3아웃**)이다.
 */
test("⚠イニング 최장의 기간은 경계 등판까지 · 登板 최장의 기간은 그대로다", () => {
  const blk = render(
    pitchingStreakData({
      season: pitchingScope({
        best: pitchingMaru({ appearances: 9, from: "2026-06-01", to: "2026-07-20" }),
        bestInnings: pitchingMaru({
          appearances: 5,
          lowerOuts: 108,
          upperOuts: 108,
          from: "2026-04-02",
          to: "2026-04-30",
          // 경계 등판(5/7)의 3아웃이 값에 들어갔다
          inningsTo: "2026-05-07",
        }),
      }),
    }),
  );
  assert.match(blk, /4月2日〜5月7日/, "이닝 최장의 기간이 경계 등판을 안 담았다");
  assert.ok(!blk.includes("4月2日〜4月30日"), "이닝 최장이 등판 축의 기간을 그렸다");
  assert.match(blk, /6月1日〜7月20日/, "등판 최장의 기간이 흔들렸다");
});

/**
 * ⚠**미확정 경계는 기간까지 흔든다**(M11). 좁은 쪽을 단정해 두고 아무 말도 안 하면
 * 그 기간이 거짓이 된다 — **「以上」의 사유만 말하고 끝내지 않는다.**
 */
test("⚠기간이 확정이 아니면 그 사실을 말한다 — 확정이면 안 말한다", () => {
  const uncertain = render(
    pitchingStreakData({
      season: pitchingScope({
        bestInnings: pitchingMaru({ lowerOuts: 69, upperOuts: 76, exact: false, inningsSpanExact: false }),
      }),
    }),
  );
  assert.match(uncertain, /イニングの「期間」もそこまで広がることがあります/);

  const certain = render(
    pitchingStreakData({
      season: pitchingScope({
        bestInnings: pitchingMaru({ lowerOuts: 69, upperOuts: 76, exact: false, inningsSpanExact: true }),
      }),
    }),
  );
  assert.ok(
    !certain.includes("イニングの「期間」もそこまで広がることがあります"),
    "기간이 확정인데 유보를 적었다 — 없는 유보도 거짓이다",
  );
});

test("시즌 안에서 끝난 마루에는 연도를 안 붙인다 — 같은 해가 두 번 나오면 잡음이다", () => {
  const blk = render(pitchingStreakData());
  assert.match(blk, /6月1日〜7月20日/);
  assert.ok(!blk.includes("2026年6月1日"), "한 시즌 안의 기간에 연도를 붙였다");
});

/**
 * ⚠**이 각주가 없으면 값 자체가 오독된다** — 이 지표는 값이 곧 이닝이고,
 * `33.1` 은 33과 1/3이지 33.1이 아니다(정의서 §1-2). 집계 사이트도 「64.1回」로 쓴다.
 */
test("⚠1/3 이닝 표기의 각주를 낸다 — 오독이 곧 오보가 되는 자리다", () => {
  const blk = render(pitchingStreakData());
  assert.match(blk, /33と1\/3回/);
});

test("⚠자책점이 아니라 실점으로 센다고 화면이 말한다", () => {
  assert.match(render(pitchingStreakData()), /自責点ではなく/);
});

/**
 * ⚠**라벨을 직접 쓰면 툴팁이 조용히 죽는다** — `term()` 은 **라벨 → 키 역인덱스**로
 * 툴팁을 붙이고, 그 역인덱스는 **모르는 라벨에 `undefined` 를 돌려주고 던지지 않는다.**
 * → 화면이 **키**를 넘기고 `termLabel()`(모르는 키에 던진다)이 라벨을 꺼낸다.
 */
test("⚠투수 연속기록 라벨은 용어집에서 나오고 툴팁이 붙는다", () => {
  const blk = render(pitchingStreakData());
  for (const key of ["scorelessAppearanceStreak", "scorelessInningStreak"]) {
    assert.ok(blk.includes(`data-term="${key}"`), `${key} 의 툴팁이 없다 — 라벨이 용어집과 갈렸다`);
    assert.ok(blk.includes(termOf(key)!.label), `${key} 의 라벨이 용어집과 다르다`);
  }
});

/**
 * ⚠**등판 수로 가장 긴 마루와 이닝으로 가장 긴 마루는 다른 마루일 수 있다.**
 * 안 말하면 「기간이 왜 다르지?」가 되고, 그건 값이 틀렸다는 인상으로 이어진다.
 */
test("⚠두 축의 최장이 다른 기간일 수 있다고 말한다", () => {
  const blk = render(pitchingStreakData());
  assert.match(blk, /別の期間になることがあります/);
});

/**
 * ⚠**「以上」의 각주는 그 사유가 실재할 때만 낸다.** 늘 서 있으면 아무도 안 읽고,
 * 어느 날 실제로 붙어도 눈에 안 띈다(`カウント不明` 줄과 같은 규칙).
 */
test("확정뿐인 화면에는 「以上」의 각주가 없다", () => {
  const blk = render(pitchingStreakData());
  assert.ok(!blk.includes("特定できない"), "확정인데 미확정 각주를 냈다");
  assert.ok(!blk.includes("年以前は未参照"), "범위 시작이 아닌데 미참조 각주를 냈다");
});
