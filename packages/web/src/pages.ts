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
import { NO_VALUE, avg3, dec2, fullDate, innings } from "./format.ts";
import {
  block,
  denText,
  follower,
  note,
  panel,
  rankValue,
  scroller,
  statCount,
  statRateOuts,
  statText,
  tablist,
  term,
} from "./parts.ts";
import { page, pastSeasonOf } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import type { MatchupRow, RankingPanel } from "./player-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
// ⚠**「直近10」을 화면에 손으로 적지 않는다.** 상수를 8로 바꾸면 화면만 거짓말한다
import { RECENT_GAMES } from "@bb-app/aggregate";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import { isEmptyProfile, markLetter, markProfile } from "./marks.ts";
import type { MarkPlayer, ProfileAxis } from "./marks.ts";

// ⚠**타입은 `layout.ts` 한 벌만 둔다.** 세 곳에 두면 필드를 늘릴 때마다 세 곳을 고친다
export type { RenderContext } from "./layout.ts";
import type { RenderContext } from "./layout.ts";

/**
 * 순위의 부문 — 打者 · 先発 · 救援.
 *
 * ⚠**투수를 한 덩어리로 두지 않는다.** 선발과 구원은 방어율 분포가 다르고, 세이브·홀드는
 * 선발에게 뜻이 없다. 한 표에 섞으면 「전원 0세이브」 같은 줄이 절반을 채운다.
 * ⚠부문을 나누는 것은 **버튼 줄을 짧게 유지하는 장치이기도 하다.** 지표를 한 줄에 다 늘어놓으면
 * 좁은 화면에서 20개가 넘는 버튼을 옆으로 밀어야 한다.
 */
export interface RankingCategory {
  /** 탭 키. 리그를 바꿔도 유지되도록 리그마다 같은 값을 쓴다 */
  id: string;
  label: string;
  panels: RankingPanel[];
}

export interface LeagueSection {
  id: string;
  name: string;
  categories: RankingCategory[];
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

/** 순위표 페이지에 싣는 상위 인원 */
const RANKING_PAGE_ROWS = 30;

/**
 * 한 부문의 지표 탭줄과 표들.
 *
 * ⚠**지표 탭 그룹을 부문마다 나눈다.** 하나로 묶으면 「打者」에서 고른 `wRC+`가
 * 「先発」로 옮겼을 때 사라져, 아무 표도 안 열린 화면이 된다.
 */
function categoryPanels(c: RankingCategory, base: string, limit: number, prefix: string): RawHtml {
  if (c.panels.length === 0) return html`<p class="empty">この部門の順位を計算できていません。</p>`;
  // ⚠페이지마다 접두사를 다르게 준다 — 저장된 탭 상태를 공유하면 5행짜리 일람과
  // 30행짜리 순위표가 서로의 선택을 덮어쓴다
  const group = `${prefix}-${c.id}`;
  return html`${tablist(
    group,
    c.panels.map((p) => ({ id: p.id, label: p.label })),
    true,
  )}
  ${c.panels.map((p, pi) => panel(group, p.id, pi === 0, panelTable(p, base, limit)))}`;
}

function panelTable(p: RankingPanel, base: string, limit: number): RawHtml {
  const rows = p.rows.slice(0, limit);
  if (rows.length === 0) return html`<p class="empty">順位を計算できていません。</p>`;
  const truncated = p.rows.length > limit;
  return html`${scroller(html`<table>
    <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${term(p.label)}</th><th>${term("母数")}</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.isMe ? "me" : ""}">
        <td>${r.rank === null ? NO_VALUE : r.rank}</td>
        <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
        <td class="l">${r.teamCode.toUpperCase()}</td>
        <td>${rankValue(r.value.value, p.digits, p.valueAsInnings === true)}</td>
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
  const { base, root, seasons } = ctx.paths("index.html");
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
  <!-- ⚠**계정 없이 되는 것만 만든다**(§0-1). 이 표시는 이 브라우저에만 남고 서버로 가지 않는다.
       ⚠**서버는 즐겨찾기를 모른다.** 그래서 이 버튼은 스크립트가 있을 때만 뜻이 있고,
       스크립트가 없으면 목록은 전 선수 그대로다 — 좁히기가 사라질 뿐 잃는 것이 없다 -->
  <div class="chips" role="group" aria-label="お気に入りでしぼる">
    <button class="chip fav" type="button" id="favOnly" aria-pressed="false" hidden>
      <i aria-hidden="true">★</i>お気に入り<s id="favCount"></s></button>
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
      return html`<li data-team="${t.code}" data-name="${p.name}" data-id="${p.playerId}">
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
      // ⚠**세로로 쌓지 않는다.** 부문이 늘어날수록 이 화면이 한없이 길어지고,
      // 모바일에서는 아래쪽 지표에 아무도 닿지 않는다. 순위표 페이지와 같은 조작으로 통일한다
      controls: tablist(
        `hicat-${s.id}`,
        s.categories.map((c) => ({ id: c.id, label: c.label })),
      ),
      body: html`${s.categories.map((c, ci) =>
        panel(`hicat-${s.id}`, c.id, ci === 0, categoryPanels(c, base, 5, `himetric-${s.id}`)),
      )}
      <!-- ⚠**개인 순위는 순위표의 「個人」 갈래 안에 있다.** 그냥 ranking.html 로 보내면
           지난번에 팀 순위를 보고 있던 사람은 개인 순위가 어디 갔는지 알 수 없다 -->
      <p class="note"><a href="${base}ranking.html#lg-${s.id}">${s.name}の順位表をすべて見る</a></p>`,
    }),
  )}`;

  return page({
    title: `選手一覧 — ${ctx.site.name} ${d.season}年`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "index",
    body,
  });
}

/**
 * 팀 순위표 한 줄. **값은 이미 계산이 끝나 있다** — 렌더러는 지표를 만들지 않는다(M1).
 */
export interface StandingRow {
  teamCode: string;
  name: string;
  shortName: string;
  color: TeamColor;
  rank: number;
  /** 동률이면 화면이 「同」이라고 말한다 */
  tiedRank: boolean;
  games: number;
  w: number;
  l: number;
  t: number;
  /** 勝率. ⚠**분모는 `勝+敗`**(무승부 제외 · NPB 규칙). 결판난 경기가 없으면 null */
  pct: number | null;
  /** 1위와의 게임 차. 1위는 0 */
  gamesBehind: number;
  rf: number;
  ra: number;
  /** 팀 타율·팀 방어율 — 분모를 들고 다닌다 */
  avg: Rate;
  era: Rate;
  home: { w: number; l: number; t: number };
  away: { w: number; l: number; t: number };
  last10: { w: number; l: number; t: number };
}

export interface StandingsSection {
  id: string;
  name: string;
  rows: StandingRow[];
}

export interface RankingPageData {
  season: number;
  asOf: string | null;
  /** 팀 순위표. **개인 순위보다 먼저 온다** — 「順位」를 누른 사람이 먼저 찾는 것이다 */
  standings: StandingsSection[];
  /** 동률 처리 규칙. ⚠**화면에 적는다**(M3) */
  tieRule: string;
  leagues: LeagueSection[];
}

/** 승패무 표기 `25-24-1`. 무승부가 0이어도 자리를 비우지 않는다 — 열이 흔들린다 */
function wlt(x: { w: number; l: number; t: number }): string {
  return `${x.w}-${x.l}-${x.t}`;
}

/** 得失点差. **부호를 항상 붙인다** — 0을 기준으로 읽는 값이다 */
function diff(rf: number, ra: number): string {
  const d = rf - ra;
  return (d >= 0 ? "+" : "") + String(d);
}

/**
 * 팀 순위표.
 *
 * ⚠**勝率의 분모를 옆에 둔다**(M2). 여기서 분모는 `勝`과 `敗` 열 자체이므로
 * 별도 표기 대신 **인접**으로 지킨다 — 그 사실을 주석에 남기지 않으면 나중에 열이 흩어진다.
 * ⚠**得失点差 막대는 우리가 만든 그림**이다. 로고를 쓸 수 없는 자리에서 구단을 구별하는 수단이기도 하다.
 */
function standingsTable(s: StandingsSection, base: string): RawHtml {
  if (s.rows.length === 0) return html`<p class="empty">まだ順位を計算できていません。</p>`;
  const widest = Math.max(1, ...s.rows.map((r) => Math.abs(r.rf - r.ra)));
  return scroller(html`<table class="stand">
    <thead><tr>
      <th>順位</th><th class="l">球団</th><th>試合</th><th>勝</th><th>敗</th><th>分</th>
      <th>勝率</th><th>差</th><th>得点</th><th>失点</th><th>得失差</th>
      <th>${term("打率")}</th><th>${term("防御率")}</th>
      <th>ホーム</th><th>ビジター</th><th>直近${RECENT_GAMES}</th>
    </tr></thead>
    <tbody>${s.rows.map(
      (r) => html`<tr style="--chip:${r.color.base}">
        <td class="rk">${r.rank}${r.tiedRank ? html`<em>同</em>` : null}</td>
        <td class="l tm"><i></i>${r.shortName}</td>
        <td>${r.games}</td><td class="b">${r.w}</td><td>${r.l}</td><td>${r.t}</td>
        <td class="b">${avg3(r.pct)}</td>
        <td>${r.gamesBehind === 0 ? "—" : r.gamesBehind.toFixed(1).replace(/\.0$/, "")}</td>
        <td>${r.rf}</td><td>${r.ra}</td>
        <td class="dif"><b>${diff(r.rf, r.ra)}</b><i class="${r.rf >= r.ra ? "p" : "n"}"
          style="--w:${((Math.abs(r.rf - r.ra) / widest) * 100).toFixed(1)}"></i></td>
        <td class="wd">${avg3(r.avg.value)}<span class="den">${r.avg.denominator}打数</span></td>
        <td class="wd">${dec2(r.era.value)}<span class="den">${innings(r.era.denominator)}回</span></td>
        <td>${wlt(r.home)}</td><td>${wlt(r.away)}</td><td>${wlt(r.last10)}</td>
      </tr>`,
    )}</tbody>
  </table>`);
}

/**
 * 순위표 — **チーム / 個人** 두 갈래, 그 아래 리그 탭 × 지표 탭.
 *
 * ⚠**한 화면에 두 종류의 순위가 있다.** 팀 순위와 개인 타이틀은 읽는 목적이 다른데
 * 세로로 이어 붙이면 개인 순위가 화면 밖에 있다는 사실 자체가 안 보인다.
 * 갈래를 나누되 **레일 한 줄에 둔다** — 레일이 두 줄이면 둘 다 sticky라 서로를 가린다.
 *
 * 리그 탭은 **個人에만 붙는다.** 팀 순위는 두 리그를 함께 보는 것이 자연스럽고,
 * 리그 탭을 공용으로 만들면 「팀에서 セ를 골랐더니 개인도 セ」가 되어 되돌리기 어렵다.
 * 지표 탭은 **리그별로 그리되 같은 그룹 이름을 쓴다.** 리그를 바꿔도 보고 있던 지표가 유지된다.
 */
export function renderRankingPage(d: RankingPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("ranking.html");
  const leagueTabs = d.leagues.map((l) => ({ id: l.id, label: l.name.replace("・リーグ", "") }));
  const hasTeam = d.standings.length > 0;
  const hasPersonal = d.leagues.length > 0;
  // ⚠**한쪽이 없으면 갈래를 만들지 않는다.** 눌러도 아무것도 없는 탭은 고장으로 읽힌다
  const split = hasTeam && hasPersonal;

  // ⚠**탭 이름과 제목이 겹치는 것을 남겨둔다.** 우리 패널에는 `aria-labelledby`가 없어서
  // 이 제목이 「지금 열린 것이 무엇인가」를 말하는 유일한 수단이다
  const teamBody = html`<section class="block" id="b-standings">
  <h4>チーム順位</h4>
  ${d.standings.map(
    (s) => html`<div class="standwrap">
    <h5 class="standname">${s.name}</h5>
    ${standingsTable(s, base)}
  </div>`,
  )}
  ${note(
    // ⚠**勝率의 정의와 동률 규칙을 화면에 적는다**(M2·M3). 규칙이 코드에만 있으면 아무도 검증할 수 없다
    `勝率は 勝 ÷（勝＋敗）で、引き分けは分母に入れません（NPBの規定）。` +
      `交流戦の試合もリーグ順位に含めています。${d.tieRule}` +
      `得点・失点は公表記録、打率と防御率は当サイトの再計算です。`,
  )}
</section>`;

  const personalBody = html`${d.leagues.map((league, li) =>
    panel(
      "rankleague",
      league.id,
      li === 0,
      html`<section class="block" id="lg-${league.id}">
      <h4>${league.name}<span class="sw">${tablist(
        "rankcat",
        league.categories.map((c) => ({ id: c.id, label: c.label })),
        false,
        `${league.name}の部門`,
      )}</span></h4>
      ${league.categories.map((c, ci) =>
        panel("rankcat", c.id, ci === 0, categoryPanels(c, base, RANKING_PAGE_ROWS, "rankmetric")),
      )}
    </section>`,
    ),
  )}`;

  // 갈래가 없으면 구분선도 없다 — 앞이 비어 있는 구분선은 그냥 흠집이다
  const leagueRail = hasPersonal
    ? html`${split ? html`<span class="div"></span>` : raw("")}${tablist("rankleague", leagueTabs, false, "リーグ")}`
    : raw("");

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">リーグ順位</span>
    <span class="sub">${d.season}年</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

${!hasTeam && !hasPersonal
    ? html`<p class="empty">このシーズンの順位はまだ計算できていません。</p>`
    : html`${!split && !hasPersonal
      ? raw("")
      : html`<nav class="rail" aria-label="順位の表示">
  ${split
        ? tablist(
          "ranktype",
          [{ id: "team", label: "チーム" }, { id: "personal", label: "個人" }],
          false,
          "順位の種類",
          true,
        )
        : raw("")}
  ${split ? follower("ranktype", "personal", false, leagueRail) : leagueRail}
</nav>`}

${hasTeam ? (split ? panel("ranktype", "team", true, teamBody) : teamBody) : raw("")}
${hasPersonal ? (split ? panel("ranktype", "personal", false, personalBody) : personalBody) : raw("")}`}`;

  return page({
    title: `リーグ順位 — ${d.season}年`,
    base,
    root,
    seasons,
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
export function gameKey(g: ProbableGame): string {
  return [g.sides[0].teamCode, g.sides[1].teamCode].join("-");
}

/**
 * 予告先発 페이지에서 그 경기 구획의 id.
 * ⚠**試合 화면의 카드가 여기로 온다.** 키를 두 곳에서 만들면 언제고 어긋나므로 `gameKey` 한 벌만 쓴다(M1).
 */
export function startersAnchor(key: string): string {
  return `sg-${key}`;
}

export function renderStartersPage(d: StartersPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("starters.html");
  const isToday = d.gameDate !== null && d.gameDate === d.builtOn;
  // ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다.** 기다리는 것이 아니라 끝난 것이다
  const past = pastSeasonOf(seasons);

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
    <span class="sub">${d.gameDate === null
      ? past ? "終了したシーズンです" : "発表待ち"
      : `${fullDate(d.gameDate)}${isToday ? "（本日）" : ""}の試合`}</span>
  </div>
  <span class="asof">成績は${fullDate(d.builtOn)}生成時点</span>
</header>

${d.gameDate === null || d.games.length === 0
    ? html`<section class="block"><p class="empty">${past
      ? "このシーズンの予告先発は記録していません。予告先発の保存を始めたのが今シーズンからです。"
      : "予告先発はまだ発表されていません。発表は前日〜当日です。"}</p></section>`
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
        html`<section class="block" id="${startersAnchor(gameKey(g))}">
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
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    // ⚠予告先発은 「試合」의 자식 화면이다. 부모 항목을 켜 두지 않으면
    // 내비게이션이 「아무 데도 아님」을 가리킨다
    nav: "today",
    // 予告先発는 試合 구획이지만 today.html 은 아니다
    navExact: false,
    body,
  });
}

/**
 * 대전 화면의 빠른 선택 버튼 하나.
 *
 * ⚠**비율을 싣지 않는다.** 버튼마다 타율을 적으면 분모까지 적어야 하고(M2), 그러면
 * 버튼이 문장이 되어 「고르는 화면」이 「읽는 화면」으로 바뀐다.
 * 대신 **세는 값**(打席·投球回)만 쓴다 — 분모 문제가 없고, 누가 주전인지도 그 값이 말한다.
 */
export interface MatchupPick {
  playerId: string;
  name: string;
  /** 「412打席」 · 「118回」 — 얼마나 나왔는가 */
  usage: string;
  /** 予告先発로 발표된 투수 */
  probable: boolean;
}

/**
 * 빠른 선택 버튼을 만드는 **유일한 입구**.
 *
 * ⚠**세는 값만 받는다.** 타율·방어율을 넣을 수 있게 열어 두면 언젠가 들어가고,
 * 그러면 분모 없는 비율이 화면에 뜬다(M2). 형태로 막는 편이 시험으로 막는 것보다 오래 간다.
 */
export function batterPick(playerId: string, name: string, pa: number): MatchupPick {
  return { playerId, name, usage: `${pa}打席`, probable: false };
}

export function pitcherPick(playerId: string, name: string, outs: number): MatchupPick {
  return { playerId, name, usage: `${innings(outs)}回`, probable: false };
}

/** 올 시즌 등판이 없는 예고선발. ⚠**「0回」가 아니라 「기록이 없다」다**(M11) */
export function unseenPitcherPick(playerId: string, name: string): MatchupPick {
  return { playerId, name, usage: "今季登板なし", probable: true };
}

export interface MatchupTeam {
  teamCode: string;
  shortName: string;
  /** 검색 색인과 같은 표기 — 선택 라벨이 「奥川（東京ヤクルトスワローズ）」로 이어진다 */
  name: string;
  color: TeamColor;
  pitchers: MatchupPick[];
  batters: MatchupPick[];
}

export interface MatchupGame {
  /** 탭 키. **`gameKey`와 같은 규칙**을 쓴다 — 구장·순번은 더블헤더에서 겹친다 */
  key: string;
  venue: string | null;
  startTime: string | null;
  sides: [MatchupTeam, MatchupTeam];
}

export interface MatchupPageData {
  season: number;
  asOf: string | null;
  /** 빠른 선택에 쓰는 경기일. 예고가 없으면 null */
  pickDate: string | null;
  /** 사이트 생성일. 「本日」인지 판정한다 */
  builtOn: string;
  games: MatchupGame[];
}

/**
 * 「対戦を選ぶ」 — 경기를 보면서 쓰는 화면.
 *
 * ⚠**라이브 데이터를 취득하지 않는다.** 경기를 보는 사람은 지금 누가 던지고 누가 치는지
 * 이미 알고 있다. 그 사실을 우리가 가져오면 데이터 권리 3층(정보의 신선도 이용)과
 * 4층(규정)에 걸리고, 필요한 폴링은 L1을 100배 벗어난다.
 * 근거: `docs/decisions/2026-08-15-live-matchup-feasibility.md`
 */
/** 빠른 선택 버튼 한 줄. `data-*`는 검색 색인과 **같은 모양**이라 이후 처리가 하나로 이어진다 */
export function pickButton(p: MatchupPick, role: "pitcher" | "batter", team: MatchupTeam): RawHtml {
  return html`<button class="pk" type="button" aria-pressed="false"
    data-pick="${role}" data-i="${p.playerId}" data-n="${p.name}" data-t="${team.name}">${p.name}<s>${p.usage}</s>${
    p.probable ? html`<em>予告</em>` : null
  }</button>`;
}

/**
 * 한 팀의 빠른 선택 묶음.
 *
 * ⚠**양 팀 모두에 投手와 打者를 둔다.** 「어느 쪽이 공격 중인가」를 먼저 묻는 화면으로 만들면
 * 조작이 한 단계 늘고, 그 답은 화면을 보는 사람이 이미 알고 있다.
 * ⚠**자른 목록을 만들지 않는다.** 대타·중간계투가 잘려 나가면 「내가 찾는 사람이 없다」가 되고,
 * 그 순간 이 기능은 없는 것과 같아진다. 대신 상자 안에서 스크롤한다.
 */
export function pickTeam(t: MatchupTeam): RawHtml {
  const list = (label: string, role: "pitcher" | "batter", picks: MatchupPick[]): RawHtml =>
    picks.length === 0
      ? html`<p class="picklab">${label}</p><p class="empty">今季の記録がありません。</p>`
      : html`<p class="picklab">${label}<s>${picks.length}人</s></p>
        <div class="picklist" role="toolbar" aria-orientation="horizontal"
          aria-label="${t.shortName}の${label}（左右キーで移動）">${picks.map((p) => pickButton(p, role, t))}</div>`;
  return html`<div class="pickteam" style="--chip:${t.color.base};--chip-ink:${t.color.ink}">
  <h5 class="picktm"><i></i>${t.shortName}</h5>
  ${list("投手", "pitcher", t.pitchers)}
  ${list("打者", "batter", t.batters)}
</div>`;
}

export function renderMatchupPage(d: MatchupPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("matchup.html");
  const side = (id: string, label: string, placeholder: string): RawHtml =>
    html`<div class="pickside">
    <label for="pick${id}">${label}</label>
    <div class="qbox">
      <input id="pick${id}" type="search" autocomplete="off" placeholder="${placeholder}"
        role="combobox" aria-expanded="false" aria-controls="pick${id}Hits" aria-autocomplete="list">
      <ul class="qhits" id="pick${id}Hits" role="listbox" aria-label="${label}の候補" hidden></ul>
    </div>
  </div>`;

  const isToday = d.pickDate !== null && d.pickDate === d.builtOn;
  // ⚠끝난 시즌에서 「いま投げている投手を選ぶと」는 거짓말이다. 그 시즌에 진행 중인 경기는 없다
  const past = pastSeasonOf(seasons);
  const gameTabs = d.games.map((g) => ({
    id: g.key,
    label: `${g.sides[0].shortName} − ${g.sides[1].shortName}`,
  }));

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">対戦を選ぶ</span>
    <span class="sub">${d.season}年 · 投手と打者を選ぶと、これまでの対戦成績が出ます</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="block" id="pickForm">
  <h4>投手と打者</h4>
  <!-- ⚠**고른 것과 실행 버튼을 붙어 있게 두고 화면에 남긴다.** 선수 목록은 길어서
       아래로 내려가면 「골랐는데 어떻게 보지?」가 된다. 레일과 같은 sticky를 쓴다 -->
  <div class="pickbar">
    <p class="chosen"><span>投手</span><b id="pick-pitcher-chosen">未選択</b></p>
    <p class="chosen"><span>打者</span><b id="pick-batter-chosen">未選択</b></p>
    <button class="go" type="button" id="pickGo" disabled>対戦成績を見る</button>
  </div>

  <!-- ⚠**이름 검색을 접지 않는다.** 한때 details 로 접었다가 되돌렸다 —
       버튼은 「오늘 대전하는 두 팀」만 담으므로, 그 밖의 선수를 찾는 길이 **접힌 채로 있으면
       없는 것과 같다.** 두 길을 나란히 두고, 둘 다 같은 선택 상태(위의 띠)로 모인다. -->
  <div class="pickfind">
    <p class="picklab">名前でさがす<s>どの選手でも</s></p>
    <div class="picker">
      ${side("Pitcher", "投手", "例：山本")}
      ${side("Batter", "打者", "例：佐藤")}
    </div>
  </div>

  ${d.games.length === 0
    ? raw("")
    : html`<div id="pickToday">
    <p class="picknote">${d.pickDate === null ? "" : `${fullDate(d.pickDate)}${isToday ? "（本日）" : ""}の対戦から選ぶ`}</p>
    <!-- ⚠**여기에 sticky를 걸지 않는다.** 바로 위의 pickbar가 이미 sticky라
         둘 다 붙으면 같은 자리를 두고 겹친다. 경기 고르기는 한 번 하고 끝나는 조작이다 -->
    <nav class="pickgames" aria-label="試合">${tablist("picktoday", gameTabs, true, "試合")}</nav>
    ${d.games.map((g, i) =>
      panel(
        "picktoday",
        g.key,
        i === 0,
        html`<div class="pickteams">${pickTeam(g.sides[0])}${pickTeam(g.sides[1])}</div>`,
      ),
    )}
  </div>`}

  ${note(
    (past
      ? `${d.season}年は終了したシーズンです。投手と打者を選ぶと、そのシーズンの対戦成績（と打者のスプリット）が開きます。`
      : "試合を見ながら使う画面です。いま投げている投手と打っている打者を選ぶと、" +
        "その二人のこれまでの対戦成績（と打者のスプリット）が開きます。") +
      (d.games.length === 0
        ? past
          ? "このシーズンの予告先発は記録していないため、名前でさがす形だけになっています。"
          : "予告先発がまだ発表されていないため、名前でさがす形だけになっています。"
        : "ボタンに出しているのは今季その球団で記録のある選手です。並びは出場の多い順で、数字は打席数・投球回です。" +
          "そこにいない選手は上の「名前でさがす」から選べます。"),
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
    root,
    seasons,
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
  /**
   * summary — 대표 성적 한 줄.
   *
   * ⚠**분모를 반드시 붙인다**(M2). 검색창에서 「이 사람이 맞나」를 판단하려고 보는 값인데,
   * 10타석 .400과 400타석 .400을 구별하지 못하면 판단을 돕는 대신 오해를 만든다.
   * 성적이 없으면 넣지 않는다 — 「0」이 아니라 「없다」이므로 필드 자체를 뺀다(M11).
   */
  s?: string;
}

export function searchIndexJson(entries: readonly SearchEntry[]): string {
  return JSON.stringify(entries);
}
