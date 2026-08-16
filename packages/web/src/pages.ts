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
      // ⚠**세로로 쌓지 않는다.** 부문이 늘어날수록 이 화면이 한없이 길어지고,
      // 모바일에서는 아래쪽 지표에 아무도 닿지 않는다. 순위표 페이지와 같은 조작으로 통일한다
      controls: tablist(
        `hicat-${s.id}`,
        s.categories.map((c) => ({ id: c.id, label: c.label })),
      ),
      body: html`${s.categories.map((c, ci) =>
        panel(`hicat-${s.id}`, c.id, ci === 0, categoryPanels(c, base, 5, `himetric-${s.id}`)),
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
      <th>ホーム</th><th>ビジター</th><th>直近${10}</th>
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
        <td>${avg3(r.avg.value)}</td><td>${dec2(r.era.value)}</td>
        <td>${wlt(r.home)}</td><td>${wlt(r.away)}</td><td>${wlt(r.last10)}</td>
      </tr>`,
    )}</tbody>
  </table>`);
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

${d.standings.length === 0
    ? raw("")
    : html`<section class="block" id="b-standings">
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
</section>`}

<nav class="rail" aria-label="リーグ">${tablist("rankleague", leagueTabs)}</nav>
${d.leagues.map((league, li) =>
    panel(
      "rankleague",
      league.id,
      li === 0,
      html`<section class="block">
      <h4>${league.name}<span class="sw">${tablist(
        "rankcat",
        league.categories.map((c) => ({ id: c.id, label: c.label })),
      )}</span></h4>
      ${league.categories.map((c, ci) =>
        panel("rankcat", c.id, ci === 0, categoryPanels(c, base, RANKING_PAGE_ROWS, "rankmetric")),
      )}
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
    // ⚠予告先発은 「試合」의 자식 화면이다. 부모 항목을 켜 두지 않으면
    // 내비게이션이 「아무 데도 아님」을 가리킨다
    nav: "today",
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
