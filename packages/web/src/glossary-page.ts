/**
 * 用語集 — **지표 설명이 모여 있는 한 장**.
 *
 * ## 왜 페이지가 필요한가
 *
 * ⚠**설명으로 가는 길이 툴팁 하나뿐이었다**(2026-08-21 다방면 감사). `dist` 루트 11장 어디에도
 * 용어를 읽을 수 있는 화면이 없었고, `glossary.ts` 는 632줄짜리 정의를 갖고 있으면서
 * 그것을 **떠 있는 상자로만** 냈다.
 *
 * 그런데 툴팁은 그 그릇이 못 된다 — `火消し率` 은 caveat 만 4문장이고 렌더 높이 **555px** 인데
 * 320×568 화면의 가용 높이는 **480px** 다. **원리적으로 안 들어간다.** 지금은 툴팁 안에서
 * 굴리게 해 두었지만, 「굴릴 수 있다」는 표시는 잘린 글자 반토막뿐이다.
 *
 * → **읽을 자리를 따로 만든다.** 툴팁은 요약을 맡고, 여기가 전문을 맡는다.
 *
 * ## 이 화면이 지키는 것
 *
 * - ⚠**정의는 `glossary.ts` 한 벌뿐이다**(M1). 여기서 다시 쓰지 않는다 — 두 벌이 되는 순간
 *   툴팁과 이 화면이 같은 지표를 다르게 설명하고, 통계 서비스에서 그건 값이 틀린 것과 같다.
 * - ⚠**순서는 `metric-order.ts` 가 정한다**(M1). 이 화면이 자기 순서를 만들면
 *   순위표·선수 페이지와 지표의 자리가 달라져 읽는 사람이 화면 수만큼 다시 배운다.
 * - ⚠**시즌마다 만들지 않는다.** 용어는 시즌에 매이지 않는다 — `log.html` 과 같은 이유로
 *   **루트 한 장**이고 링크는 `root` 로 간다. `base` 로 두면 과거 시즌 화면 전부가 404 가 된다
 *   (실측 전례: 2025 화면 2,307장).
 * - ⚠**계수를 적지 않는다**(CLAUDE.md §2-2). wOBA 계수는 리그·시즌마다 다르므로
 *   화면에 박는 순간 다른 시즌에서 거짓이 된다. `glossary.ts` 가 이미 그 규칙을 지키고 있고,
 *   여기는 그것을 **그대로** 낸다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { GLOSSARY, TERM_ANCHOR } from "./glossary.ts";
import type { Term } from "./glossary.ts";
import { block, note } from "./parts.ts";
import { page, ROSTER_PATH } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { metricRank } from "./metric-order.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";

/** 이 화면의 파일 경로. **한 곳에서만 만든다**(M1) — 갈리면 어딘가는 404다 */
export const GLOSSARY_PATH = "glossary.html";

/**
 * 정본 순서로 늘어놓는다.
 *
 * ⚠**`metric-order.ts` 에 없는 용어가 있다** — 그건 결함이 아니다. 그 파일은 「값으로 줄 세우는
 * 지표」의 순서이고, 여기에는 `打席`·`盗塁刺` 처럼 줄 세우지 않는 말도 들어온다.
 * 그런 것들은 **뒤로 보내되 자기들끼리는 원래 정의 순서**를 지킨다 — 그게 `glossary.ts` 의
 * 편집 순서이고, 사람이 읽으라고 만든 배열이다.
 */
export function glossaryOrder(): { key: string; term: Term }[] {
  const entries = Object.entries(GLOSSARY).map(([key, term], i) => ({ key, term, i }));
  return entries
    .sort((a, b) => {
      const ra = metricRank(a.key);
      const rb = metricRank(b.key);
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map(({ key, term }) => ({ key, term }));
}

function entry(key: string, t: Term): RawHtml {
  return html`<div class="gl" id="${TERM_ANCHOR(key)}">
  <h3 class="gln">${t.label}</h3>
  <p class="gls">${t.short}</p>
  ${t.how === undefined
    ? raw("")
    : html`<p class="glh"><b>計算</b>${t.how}${t.den === undefined ? raw("") : html`<s>分母は${t.den}</s>`}</p>`}
  ${t.caveat === undefined ? raw("") : html`<p class="glc">${t.caveat}</p>`}
</div>`;
}

export function renderGlossaryPage(ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths(GLOSSARY_PATH);
  const terms = glossaryOrder();

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">用語集</h1>
    <span class="sub">${terms.length}項目 · このサイトが出す数字の意味と、その数字が<b>測っていないもの</b></span>
  </div>
</header>

${block({
    id: "gl-all",
    title: "指標",
    qualifier: `${terms.length}項目`,
    body: html`<div class="glist">${terms.map((x) => entry(x.key, x.term))}</div>`,
  })}

<section class="block">
  <h2>この用語集の読み方</h2>
  ${note(
      "**並び順は画面と同じです** — 順位表や選手ページで指標が並ぶ順と同じ順に置いています。" +
        "**⚠印は「その数字が測っていないもの」**です。指標の誤読はたいてい「これはそれも測っていると思った」から起きます。" +
        "**計算式の「分母」**は、その割合が何を何で割ったものかを示します — 割合だけを見て標本の大きさを見ないと、" +
        "10打席の.400が「リーグ1位」に見えます。" +
        "⚠**係数はここに書きません** — wOBA のような指標の係数はリーグ・シーズンごとに違うので、" +
        "画面に固定して書くと別のシーズンで嘘になります。",
    )}
  <p class="note">
    ⚠数値はすべて<b>当サイトが公表記録から独自に再計算</b>したものです。元の表を再現するものではありません。
    出典：日本野球機構（NPB）公式サイト <a href="https://npb.jp/" rel="noreferrer noopener">npb.jp</a>。
  </p>
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位</a>
</nav>`;

  return page({
    title: `用語集 — ${ctx.site.name}`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "glossary",
    body,
  });
}
