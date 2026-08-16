/**
 * ポストシーズン — **정규시즌과 섞지 않고, 보이지 않게 두지도 않는다.**
 *
 * ⚠**여기가 이 화면의 존재 이유다.** 지금까지 모든 화면이 `competition = 'regular'`로 걸러
 * 클라이맥스시리즈 13경기·일본시리즈 5경기(타석 로그 1,351개)를 **통째로 안 보여줬다.**
 * 데이터는 처음부터 있었다 — 보여줄 자리가 없었을 뿐이다.
 *
 * ⚠**그렇다고 정규시즌에 더하지 않는다**(§2-1). NPB의 타이틀·순위는 정규시즌 성적으로만 겨루고,
 * CS 13경기를 더하는 순간 그 수는 어느 규칙에도 속하지 않는 수가 된다.
 *
 * ⚠**순위를 매기지 않는다.** 표본이 13경기·5경기다. 여기에 「1위」를 붙이면
 * 5타수 3안타가 타율 1위가 된다 — M2·M3가 정확히 막으라고 하는 것이다.
 * 그래서 이 화면은 **출장 순으로 늘어놓기만** 하고, 그 사실을 화면에 적는다.
 *
 * ⚠**리그 상수를 쓰는 지표를 내지 않는다.** wRC+·FIP는 리그 평균이 기준선인데
 * 포스트시즌에는 그 리그가 없다(양 리그가 맞붙는다). 계산이 되더라도 뜻이 없는 수다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { avg3, dec2, fullDate, innings } from "./format.ts";
import { note, scroller, term } from "./parts.ts";
import { page } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";

/** 한 경기 — 날짜·구장·점수. 상세 페이지가 있으면 그리로 간다 */
export interface PostGame {
  gameId: string;
  /** 경기 페이지가 실제로 만들어졌는가. ⚠없는 페이지로 링크하면 404다 */
  hasPage: boolean;
  date: string;
  venue: string | null;
  away: { shortName: string; color: TeamColor; runs: number | null };
  home: { shortName: string; color: TeamColor; runs: number | null };
  /** 이긴 쪽. 무승부는 null */
  winner: "away" | "home" | null;
  /** 「第3戦」처럼 몇 번째 경기인가 */
  gameNo: number;
}

/** 포스트시즌 한 선수의 성적 한 줄. ⚠**분모를 들고 다닌다**(M2) */
export interface PostBatter {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  games: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  /** 타율. 타수가 0이면 null — 「.000」이 아니다(M11) */
  avg: number | null;
}

export interface PostPitcher {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  games: number;
  /** 아웃 카운트. 화면에는 이닝으로 낸다 */
  outs: number;
  h: number;
  hr: number;
  bb: number;
  so: number;
  er: number;
  w: number;
  l: number;
  sv: number;
  /** 방어율. 아웃이 0이면 null */
  era: number | null;
}

/** 한 대회분 */
export interface PostCompetition {
  /** `climaxSeries` 등. 앵커와 탭 키로도 쓴다 */
  id: string;
  /** 화면에 내는 이름 */
  name: string;
  /** 이 대회가 무엇인지 한 줄. ⚠**규칙을 화면에 적는다**(M3의 정신) */
  detail: string;
  games: PostGame[];
  batters: PostBatter[];
  pitchers: PostPitcher[];
}

export interface PostseasonPageData {
  season: number;
  /** 그 시즌에 기록이 있는 대회. 없으면 빈 배열 */
  competitions: PostCompetition[];
}

/** 한 선수의 포스트시즌 요약 — 선수 페이지가 쓴다 */
export interface PostseasonBrief {
  competitionId: string;
  competitionName: string;
  games: number;
  /** 타자면 「12打席」, 투수면 「5.1回」 */
  sampleText: string;
  /** 「.333（9打数3安打）」처럼 값과 분모를 한 덩어리로 */
  line: string;
}

function score(side: PostGame["away"], won: boolean): RawHtml {
  return html`<div class="gside${won ? " w" : ""}" style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <span class="gt"><i></i>${side.shortName}</span>
  <span class="gr">${side.runs === null ? "—" : side.runs}</span>
</div>`;
}

function gameCard(g: PostGame, base: string): RawHtml {
  const body = html`<h5 class="gvenue">第${g.gameNo}戦<span class="gtie">${fullDate(g.date)}</span></h5>
  <div class="gscore">
    ${score(g.away, g.winner === "away")}
    ${score(g.home, g.winner === "home")}
  </div>
  <p class="gnone">${g.venue ?? ""}${g.winner === null ? "　引き分け" : ""}</p>`;
  // ⚠상세 페이지가 없으면 카드를 누를 수 있게 만들지 않는다 — 눌러도 안 가는 카드는 결함이다
  return g.hasPage
    ? html`<article class="gcard tapcard">${body}
  <p class="gmore"><a class="cardlink" href="${base}games/${g.gameId}.html">この試合の詳細<span
    class="vh">（第${g.gameNo}戦 ${g.away.shortName} 対 ${g.home.shortName}）</span></a></p>
</article>`
    : html`<article class="gcard">${body}</article>`;
}

function batterTable(rows: PostBatter[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">打者の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th>試合</th><th>${term("打席")}</th>
      <th>打数</th><th>安打</th><th>本塁打</th><th>打点</th><th>四球</th><th>三振</th><th>${term("打率")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr style="--chip:${r.color.base}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td class="l tm"><i></i>${r.shortName}</td>
      <td>${r.games}</td><td class="b">${r.pa}</td><td>${r.ab}</td><td>${r.h}</td>
      <td>${r.hr}</td><td>${r.rbi}</td><td>${r.bb}</td><td>${r.so}</td>
      <td class="wd">${r.avg === null ? "—" : avg3(r.avg)}<span class="den">${r.ab}打数</span></td>
    </tr>`,
    )}</tbody>
  </table>`);
}

function pitcherTable(rows: PostPitcher[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">投手の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th>登板</th><th>投球回</th>
      <th>勝</th><th>敗</th><th>S</th><th>被安打</th><th>被本塁打</th><th>与四球</th><th>奪三振</th>
      <th>自責</th><th>${term("防御率")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr style="--chip:${r.color.base}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td class="l tm"><i></i>${r.shortName}</td>
      <td>${r.games}</td><td class="b">${innings(r.outs)}</td>
      <td>${r.w}</td><td>${r.l}</td><td>${r.sv}</td>
      <td>${r.h}</td><td>${r.hr}</td><td>${r.bb}</td><td>${r.so}</td><td>${r.er}</td>
      <td class="wd">${r.era === null ? "—" : dec2(r.era)}<span class="den">${innings(r.outs)}回</span></td>
    </tr>`,
    )}</tbody>
  </table>`);
}

export function renderPostseasonPage(d: PostseasonPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("postseason.html");

  const body = html`<header class="idline">
  <div class="idtext">
    <!-- ⚠**있는 것만 이름으로 부른다.** 2026년은 올스타뿐인데 「ポストシーズン」이라고 하면
         화면이 거짓말을 한다 — 올스타는 시즌 중 경기이고 포스트시즌이 아니다 -->
    <span class="nm">${d.competitions.some((c) => c.id !== "allStar")
      ? "ポストシーズン"
      : "レギュラーシーズン外の試合"}</span>
    <span class="sub">${d.season}年 · ${d.competitions.length === 0
      ? "記録がありません"
      : d.competitions.map((c) => `${c.name}${c.games.length}試合`).join(" · ")}</span>
  </div>
</header>

${d.competitions.length === 0
    ? html`<section class="block"><p class="empty">このシーズンのポストシーズンはまだ記録していません。</p></section>`
    : html`${d.competitions.map(
      (c) => html`<section class="block" id="pc-${c.id}">
  <h4>${c.name}<span class="qt">${c.games.length}試合</span></h4>
  ${note(c.detail)}
  <div class="gcards">${c.games.map((g) => gameCard(g, base))}</div>

  ${c.batters.length === 0 && c.pitchers.length === 0
    ? note(
      // ⚠**없는 이유를 말한다.** 빈 자리만 두면 「수집이 실패했나」로 읽힌다(M12의 정신)
      "この大会は選手成績を集計していません — 出場は「セ・リーグ」「パ・リーグ」の選抜としてで、" +
        "球団に紐づく成績にならないためです。試合結果のみ残しています。",
    )
    : html`<h5 class="standname">打者</h5>
  ${batterTable(c.batters, base)}
  <h5 class="standname">投手</h5>
  ${pitcherTable(c.pitchers, base)}
  ${note(
    // ⚠**순위가 아니라는 것을 화면이 말한다**(M2·M3). 13경기·5경기짜리 표본이다
    "出場の多い順に並べています。**順位ではありません** — " +
      "ポストシーズンは試合数が少なく、少ない打席の高い率が上に来てしまうためです。" +
      "レギュラーシーズンの成績には加えていません（NPBのタイトルはレギュラーシーズンで争います）。" +
      "リーグ平均を基準にする指標（wRC+・FIP）は出していません — ポストシーズンには「そのリーグ」がありません。",
  )}`}
</section>`,
    )}`}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}today.html">試合</a> · <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}index.html">選手一覧</a>
</nav>`;

  return page({
    title: `${d.competitions.some((c) => c.id !== "allStar") ? "ポストシーズン" : "レギュラーシーズン外の試合"} — ${d.season}年`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason === true,
    nav: "postseason",
    body,
  });
}

/**
 * 선수 페이지에 붙는 포스트시즌 한 덩어리.
 *
 * ⚠**정규시즌 성적 블록과 섞이지 않게 따로 그린다.** 같은 표에 넣으면 위에서 아래로 읽는 사람이
 * 두 수를 더한 것으로 읽는다.
 */
export function postseasonBrief(rows: readonly PostseasonBrief[], base: string): RawHtml {
  if (rows.length === 0) return raw("");
  return html`<section class="block" id="postbrief">
  <h4>ポストシーズン<span class="qt">レギュラーシーズンとは別です</span></h4>
  <dl class="postrow">${rows.map(
    (r) => html`<div>
    <dt>${r.competitionName}</dt>
    <dd>${r.line}<span class="den">${r.games}試合 ${r.sampleText}</span></dd>
  </div>`,
  )}</dl>
  <p class="note">この数字は<b>上の成績に含まれていません</b>。NPBのタイトル・順位はレギュラーシーズンで争うためです。
    <a href="${base}postseason.html">ポストシーズンの全成績</a></p>
</section>`;
}
