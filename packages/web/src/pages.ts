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
import { NO_VALUE, avg3, fullDate, innings } from "./format.ts";
import {
  block,
  denText,
  note,
  panel,
  rankValue,
  scroller,
  statCount,
  statRateOuts,
  statText,
  tablist,
} from "./parts.ts";
import { page } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import type { MatchupRow, RankingPanel } from "./player-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import { isEmptyProfile, markLetter, markProfile } from "./marks.ts";
import type { MarkPlayer, ProfileAxis } from "./marks.ts";

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
  /** 성적 문양의 축. 비어 있으면 문양 대신 포지션 글자를 쓴다 */
  axes: ProfileAxis[];
  /** 이미 사람이 읽는 형태의 분모(`442打席`) */
  sampleText: string;
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
  <ul class="roster">${t.players.map((p) => {
      const who: MarkPlayer = {
        playerId: p.playerId,
        name: p.name,
        teamName: t.name,
        color: t.color,
        positionMark: p.mark,
      };
      return html`<li data-team="${t.code}" data-name="${p.name}">
      <a href="${base}players/${p.playerId}.html">
        <span class="mkline">${isEmptyProfile(p.axes)
          ? markLetter(who, p.mark === "" ? "—" : p.mark, 18)
          : markProfile(who, p.axes, p.sampleText, 18)}</span>
        <span class="hn">${p.name}</span><span class="hp">${p.mark}</span>
      </a>
    </li>`;
    })}</ul>
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

export interface StarterSummary {
  games: number;
  outs: number;
  era: Rate;
  whip: Rate;
  fip: Rate;
  so: number;
}

export interface ProbableSide {
  teamCode: string;
  teamName: string;
  shortName: string;
  color: TeamColor;
  /** 미발표면 null. **「投手なし」가 아니라 「まだ発表されていない」다**(M11) */
  playerId: string | null;
  name: string | null;
  summary: StarterSummary | null;
  /** 이 투수가 상대한 **상대 팀** 타자들. 타석수 순 */
  opponents: MatchupRow[];
}

export interface ProbableGame {
  venue: string | null;
  startTime: string | null;
  league: string;
  sides: [ProbableSide, ProbableSide];
}

export interface StartersPageData {
  /** 예고가 나와 있는 경기일. 없으면 null */
  gameDate: string | null;
  /** 사이트를 만든 날. 「本日」인지 판정하는 데 쓴다 */
  builtOn: string;
  games: ProbableGame[];
}

/**
 * 予告先発 — 경기 **전에** 공표되는 유일한 라인업 정보.
 *
 * ⚠**「오늘」이라고 단정하지 않는다.** 이 페이지는 「다음에 발표된 하루」를 보여주고,
 * 그게 내일인 경우가 실제로 많다(2026-08-15에 8/16분이 게시돼 있었다).
 * 날짜를 그대로 쓰고, 생성일과 같을 때만 「本日」를 붙인다.
 * ⚠**라인업은 모른다.** 그래서 「이 투수와 대전한 적이 있는 상대 팀 타자」를 타석수 순으로 낸다 —
 * 오늘 나올 타자를 아는 척하지 않는다.
 */
/**
 * 경기 하나를 가리키는 탭 키.
 *
 * ⚠**구장이나 순번이 아니라 대전 카드로 만든다.** 구장은 더블헤더에서 겹치고,
 * 순번은 다음날 다른 경기를 가리킨다 — 저장된 선택이 엉뚱한 경기로 되살아난다.
 */
function gameKey(g: ProbableGame): string {
  return [g.sides[0].teamCode, g.sides[1].teamCode].join("-");
}

export function renderStartersPage(d: StartersPageData, ctx: RenderContext): string {
  const base = "";
  const isToday = d.gameDate !== null && d.gameDate === d.builtOn;

  const sideBlock = (side: ProbableSide, opponent: ProbableSide): RawHtml => html`<div class="sside"
  style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <h5 class="sname"><i></i>${side.shortName}</h5>
  ${side.playerId === null || side.name === null
    ? html`<p class="empty">先発はまだ発表されていません。</p>`
    : html`<p class="spitcher"><a href="${base}players/${side.playerId}.html">${side.name}</a></p>
      ${side.summary === null
        ? html`<p class="empty">今季の登板記録がありません。</p>`
        : html`<dl class="srow">
            ${statRateOuts("防御率", side.summary.era, 2)}
            ${statRateOuts("WHIP", side.summary.whip, 2)}
            ${statRateOuts("FIP", side.summary.fip, 2)}
            ${statText("投球回", innings(side.summary.outs))}
            ${statCount("登板", side.summary.games)}
            ${statCount("奪三振", side.summary.so)}
          </dl>`}
      ${side.opponents.length === 0
        ? html`<p class="empty">${opponent.shortName}の打者との対戦記録はまだありません。</p>`
        : html`${scroller(html`<table>
            <thead><tr><th class="l">${opponent.shortName}の打者</th><th>打席</th><th>安打</th><th>本塁打</th><th>三振</th><th>打率</th></tr></thead>
            <tbody>${side.opponents.map(
              (m) => html`<tr class="${m.line.pa < 10 ? "thin" : ""}">
                <td class="l"><a href="${base}players/${m.opponentId}.html?vs=${encodeURIComponent(side.name ?? "")}#b-matchup">${m.opponentName}</a></td>
                <td>${m.line.pa}</td><td>${m.line.h}</td><td>${m.line.hr}</td><td>${m.line.so}</td>
                <td>${avg3(m.avg.value)}</td>
              </tr>`,
            )}</tbody>
          </table>`)}`}`}
</div>`;

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">予告先発</span>
    <span class="sub">${d.gameDate === null ? "発表待ち" : `${fullDate(d.gameDate)}${isToday ? "（本日）" : ""}の試合`}</span>
  </div>
  <span class="asof">成績は${fullDate(d.builtOn)}生成時点</span>
</header>

${d.gameDate === null || d.games.length === 0
    ? html`<section class="block"><p class="empty">予告先発はまだ発表されていません。発表は前日〜当日です。</p></section>`
    : html`<nav class="cards" role="tablist" data-tabgroup="starters" aria-label="試合">
    ${d.games.map(
      (g, i) => html`<button class="card" type="button" role="tab" data-tab="${gameKey(g)}"
        aria-selected="${i === 0 ? "true" : "false"}">
      <span class="cbar"><i style="background:${g.sides[0].color.base}"></i><i style="background:${g.sides[1].color.base}"></i></span>
      <span class="ctxt"><b>${g.sides[0].shortName} − ${g.sides[1].shortName}</b>
        <s>${g.startTime ?? ""}${g.venue === null ? "" : ` ${g.venue}`}</s></span>
    </button>`,
    )}
    <button class="card all" type="button" role="tab" data-tab="all" aria-selected="false">
      <span class="ctxt"><b>すべて</b><s>${d.games.length}試合</s></span>
    </button>
  </nav>
${d.games.map((g, i) =>
      panel(
        "starters",
        gameKey(g),
        i === 0,
        html`<section class="block">
      <h4>${g.sides[0].shortName} 対 ${g.sides[1].shortName}<span class="qt">${g.venue ?? ""}${g.startTime === null ? "" : ` ${g.startTime}`}</span></h4>
      <div class="starters">
        ${sideBlock(g.sides[0], g.sides[1])}
        ${sideBlock(g.sides[1], g.sides[0])}
      </div>
    </section>`,
      ),
    )}`}

<section class="block">
  <h4>この画面について</h4>
  ${note(
    "予告先発は試合の前日〜当日に公表される情報です。当サイトは1日1回の取得でこれを反映しており、" +
      "試合中の情報は取得していません。打順は試合前には分からないため、" +
      "「その投手と対戦したことがある相手球団の打者」を打席数の多い順に並べています。" +
      "10打席未満は薄く表示しています。選手名を押すと、その投手との対戦成績を開いた状態でページが開きます。",
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}matchup.html">対戦を選ぶ</a> · <a href="${base}index.html">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `予告先発${d.gameDate === null ? "" : ` — ${fullDate(d.gameDate)}`}`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "starters",
    body,
  });
}

export interface MatchupPageData {
  season: number;
  asOf: string | null;
}

/**
 * 「対戦を選ぶ」 — 경기를 보면서 쓰는 화면.
 *
 * ⚠**라이브 데이터를 취득하지 않는다.** 경기를 보는 사람은 지금 누가 던지고 누가 치는지
 * 이미 알고 있다. 그 사실을 우리가 가져오면 데이터 권리 3층(정보의 신선도 이용)과
 * 4층(규정)에 걸리고, 필요한 폴링은 L1을 100배 벗어난다.
 * 근거: `docs/decisions/2026-08-15-live-matchup-feasibility.md`
 */
export function renderMatchupPage(d: MatchupPageData, ctx: RenderContext): string {
  const base = "";
  const side = (id: string, label: string, placeholder: string): RawHtml =>
    html`<div class="pickside">
    <label for="pick${id}">${label}</label>
    <div class="qbox">
      <input id="pick${id}" type="search" autocomplete="off" placeholder="${placeholder}"
        role="combobox" aria-expanded="false" aria-controls="pick${id}Hits" aria-autocomplete="list">
      <ul class="qhits" id="pick${id}Hits" role="listbox" aria-label="${label}の候補" hidden></ul>
    </div>
    <p class="chosen">選択中：<b id="pick-${id.toLowerCase()}-chosen">未選択</b></p>
  </div>`;

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">対戦を選ぶ</span>
    <span class="sub">${d.season}年 · 投手と打者を選ぶと、これまでの対戦成績が出ます</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="block" id="pickForm">
  <h4>投手と打者</h4>
  <div class="picker">
    ${side("Pitcher", "投手", "例：山本")}
    ${side("Batter", "打者", "例：佐藤")}
  </div>
  <p><button class="go" type="button" id="pickGo" disabled>対戦成績を見る</button></p>
  ${note(
    "試合を見ながら使う画面です。いま投げている投手と打っている打者を選ぶと、" +
      "その二人のこれまでの対戦成績（と打者のスプリット）が開きます。",
  )}
</section>

<section class="block">
  <h4>この画面が試合中の情報を取りに行かない理由</h4>
  <p class="note" style="max-width:64ch">
    進行中の試合の情報を自動で取得して表示することは、技術的にはできます。ただし
    <b>公表記録の「新しさ」を利用する形</b>になり、取得のために必要な連続アクセスも、
    当サイトが自分に課している取得ルール（1日1回のバッチ）を大きく外れます。<br>
    試合を見ている人は、いま誰が投げて誰が打っているかを<b>すでに知っています</b>。
    だから当サイトはそれを取りに行かず、<b>選んでもらう</b>ことにしました。
    表示する数字は前日までの確定記録です。
  </p>
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}index.html">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `対戦を選ぶ — ${d.season}年`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "matchup",
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
