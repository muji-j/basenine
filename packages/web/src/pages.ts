/**
 * 색인(검색)과 리그 순위표.
 *
 * ⚠**「첫 방문 → 원하는 선수 성적까지 3클릭 이내」가 제약이다**(CLAUDE.md §0-1).
 * 그래서 첫 화면의 주역은 소개문이 아니라 **검색창**이다.
 */
import { html } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, fullDate } from "./format.ts";
import { block, denText, note, rankValue, scroller } from "./parts.ts";
import { page } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import type { RankingPanel } from "./player-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";

export interface RenderContext {
  site: SiteMeta;
  freshness: Freshness;
}

export interface LeagueSection {
  id: string;
  name: string;
  panels: RankingPanel[];
}

export interface IndexPageData {
  season: number;
  /** 색인에 실린 선수 수. **표본이 아니라 규모의 표시** */
  playerCount: number;
  gameCount: number;
  asOf: string | null;
  /** 각 리그의 대표 지표 1개씩만. 전체는 순위표 페이지로 */
  highlights: LeagueSection[];
}

function panelTable(p: RankingPanel, base: string, limit: number): RawHtml {
  const rows = p.rows.slice(0, limit);
  if (rows.length === 0) return html`<p class="empty">順位を計算できていません。</p>`;
  return html`${scroller(html`<table>
    <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${p.label}</th><th>母数</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr>
        <td>${r.rank === null ? NO_VALUE : r.rank}</td>
        <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
        <td class="l">${r.teamCode.toUpperCase()}</td>
        <td>${rankValue(r.value.value, p.digits)}</td>
        <td>${denText(r.value.denominator, p.unit, p.denAsInnings)}</td>
      </tr>`,
    )}</tbody>
  </table>`)}
  ${note(p.qualifier)}`;
}

export function renderIndexPage(d: IndexPageData, ctx: RenderContext): string {
  const base = "";
  const body = html`<header class="idline">
  <span class="nm">${ctx.site.name}</span>
  <span class="sub">${d.season}年 · 選手 ${d.playerCount}人 · 試合 ${d.gameCount}</span>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="find">
  <label for="find">選手を探す</label>
  <input id="find" type="search" autocomplete="off" placeholder="選手名または球団名（例：佐藤／阪神）">
  <ul class="hits" id="hits"><li>選手一覧を読み込んでいます…</li></ul>
</section>

${d.highlights.map(
    (s) => block({
      id: `hi-${s.id}`,
      title: s.name,
      body: html`${s.panels.map(
        (p) => html`<h5 class="subhead">${p.label}</h5>${panelTable(p, base, 5)}`,
      )}
      <p class="note"><a href="${base}ranking.html">${s.name}の順位表をすべて見る</a></p>`,
    }),
  )}`;

  return page({
    title: `${ctx.site.name} — ${d.season}年 NPB 成績`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    body,
    interactive: true,
  });
}

export interface RankingPageData {
  season: number;
  asOf: string | null;
  leagues: LeagueSection[];
}

export function renderRankingPage(d: RankingPageData, ctx: RenderContext): string {
  const base = "";
  const body = html`<header class="idline">
  <span class="nm">リーグ順位</span>
  <span class="sub">${d.season}年</span>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>
${d.leagues.map(
    (s) => html`${s.panels.map(
      (p) => block({ id: `${s.id}-${p.id}`, title: `${s.name} ${p.label}`, body: panelTable(p, base, 30) }),
    )}`,
  )}
<nav class="find" aria-label="ほかのページ"><a href="${base}index.html">選手を探す</a></nav>`;

  return page({
    title: `リーグ順位 — ${d.season}年`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    body,
  });
}

/** 검색 색인. **선수 수만큼 커지므로 필드 이름을 1글자로 줄인다** — 900명이면 이 차이가 실측된다. */
export interface SearchEntry {
  /** id */
  i: string;
  /** name */
  n: string;
  /** team */
  t: string;
}

export function searchIndexJson(entries: readonly SearchEntry[]): string {
  return JSON.stringify(entries);
}
