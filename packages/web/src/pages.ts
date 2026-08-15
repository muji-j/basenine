/**
 * 색인(선수 일람)과 리그 순위표.
 *
 * ⚠**「첫 방문 → 원하는 선수 성적까지 3클릭 이내」가 제약이다**(CLAUDE.md §0-1).
 * 그래서 첫 화면의 주역은 소개문이 아니라 **선수 목록**이고, 목록은 **서버가 그린다** —
 * 스크립트가 죽어도 전 선수에게 도달할 수 있어야 한다. JS는 좁히기만 한다.
 *
 * ⚠**순위표를 위아래로 늘어놓지 않는다.** 지표 15종 × 리그 2개를 쌓으면 30개 표가 되고,
 * 그건 목록이지 순위표가 아니다. 리그와 지표를 **골라서** 본다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, fullDate } from "./format.ts";
import { block, denText, note, panel, rankValue, scroller, tablist } from "./parts.ts";
import { page } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import type { RankingPanel } from "./player-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";

export interface RenderContext {
  site: SiteMeta;
  freshness: Freshness;
}

export interface LeagueSection {
  id: string;
  name: string;
  panels: RankingPanel[];
}

export interface RosterEntry {
  playerId: string;
  name: string;
  /** 「投」「捕」 등 한 글자. 미상이면 빈 문자열 */
  mark: string;
}

export interface TeamRoster {
  code: string;
  name: string;
  /** 목록에 붙는 짧은 이름 (阪神 등) */
  shortName: string;
  color: TeamColor;
  players: RosterEntry[];
}

export interface IndexPageData {
  season: number;
  playerCount: number;
  gameCount: number;
  asOf: string | null;
  teams: TeamRoster[];
  /** 리그별 대표 지표. 전체는 순위표 페이지로 */
  highlights: LeagueSection[];
}

function panelTable(p: RankingPanel, base: string, limit: number): RawHtml {
  const rows = p.rows.slice(0, limit);
  if (rows.length === 0) return html`<p class="empty">順位を計算できていません。</p>`;
  const truncated = p.rows.length > limit;
  return html`${scroller(html`<table>
    <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${p.label}</th><th>母数</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.isMe ? "me" : ""}">
        <td>${r.rank === null ? NO_VALUE : r.rank}</td>
        <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
        <td class="l">${r.teamCode.toUpperCase()}</td>
        <td>${rankValue(r.value.value, p.digits)}</td>
        <td>${denText(r.value.denominator, p.unit, p.denAsInnings)}</td>
      </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    // ⚠**자른 것을 말한다.** 상위 N만 보여주면서 「전부」처럼 보이면 그것도 거짓말이다
    truncated ? `${p.qualifier} 上位${limit}人のみ表示（該当 ${p.rows.length}人）。` : p.qualifier,
  )}`;
}

export function renderIndexPage(d: IndexPageData, ctx: RenderContext): string {
  const base = "";
  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">選手一覧</span>
    <span class="sub">${d.season}年 · ${d.playerCount}人 · ${d.gameCount}試合</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="find">
  <label for="rosterFilter">名前でしぼる</label>
  <input id="rosterFilter" type="search" autocomplete="off" placeholder="例：佐藤">
  <div class="chips" role="group" aria-label="球団でしぼる">
    ${d.teams.map(
      (t) => html`<button class="chip" type="button" data-team="${t.code}" aria-pressed="false"
        style="--chip:${t.color.base};--chip-ink:${t.color.ink}">${t.shortName}</button>`,
    )}
  </div>
  <p class="count"><span id="rosterCount">${d.playerCount}人</span>を表示中</p>
</section>

${d.teams.map(
    (t) => html`<section class="teamgroup" style="--chip:${t.color.base};--chip-ink:${t.color.ink}">
  <h4><i></i>${t.name}<span class="qt">${t.players.length}人</span></h4>
  <ul class="roster">${t.players.map(
      (p) => html`<li data-team="${t.code}" data-name="${p.name}">
      <a href="${base}players/${p.playerId}.html"><span class="hn">${p.name}</span><span class="hp">${p.mark}</span></a>
    </li>`,
    )}</ul>
</section>`,
  )}

${d.highlights.map((s) =>
    block({
      id: `hi-${s.id}`,
      title: s.name,
      body: html`${s.panels.map(
        (p) => html`<h5 class="subhead">${p.label}</h5>${panelTable(p, base, 5)}`,
      )}
      <p class="note"><a href="${base}ranking.html">${s.name}の順位表をすべて見る</a></p>`,
    }),
  )}`;

  return page({
    title: `選手一覧 — ${ctx.site.name} ${d.season}年`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "index",
    body,
  });
}

export interface RankingPageData {
  season: number;
  asOf: string | null;
  leagues: LeagueSection[];
}

/**
 * 순위표 — 리그 탭 × 지표 탭.
 *
 * 지표 탭은 **리그별로 그리되 같은 그룹 이름을 쓴다.** 리그를 바꿔도 보고 있던 지표가 유지된다.
 */
export function renderRankingPage(d: RankingPageData, ctx: RenderContext): string {
  const base = "";
  const leagueTabs = d.leagues.map((l) => ({ id: l.id, label: l.name.replace("・リーグ", "") }));

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">リーグ順位</span>
    <span class="sub">${d.season}年 · 規定到達者に順位がつきます</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>
<nav class="rail" aria-label="リーグ">${tablist("rankleague", leagueTabs)}</nav>
${d.leagues.map((league, li) =>
    panel(
      "rankleague",
      league.id,
      li === 0,
      html`<section class="block">
      <h4>${league.name}<span class="sw">${tablist(
        "rankmetric",
        league.panels.map((p) => ({ id: p.id, label: p.label })),
        true,
      )}</span></h4>
      ${league.panels.map((p, pi) => panel("rankmetric", p.id, pi === 0, panelTable(p, base, 30)))}
    </section>`,
    ),
  )}`;

  return page({
    title: `リーグ順位 — ${d.season}年`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "ranking",
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
