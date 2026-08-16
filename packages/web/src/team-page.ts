/**
 * 球団ページ — 「이 팀은 올해 어땠나」 하나에 답한다.
 *
 * ⚠**순위표에서 팀명을 누른 사람이 오는 자리다.** 지금까지 그 목적지가 없어서
 * 팀을 보려면 순위표의 한 줄과 선수 일람의 한 덩어리를 머리에서 합쳐야 했다.
 *
 * ⚠**분모 없는 비율을 내지 않는다**(M2). 팀 타율에는 타수를, 팀 방어율에는 이닝을 붙인다.
 * ⚠**로고·엠블럼을 쓰지 않는다**(§6). 팀을 구별하는 것은 **구단 색과 이름**이고,
 * 색은 우리가 고른 값이다.
 * ⚠**순위는 정규시즌만이다**(§2-1). 포스트시즌 성적은 여기 없고, 그 사실을 화면이 말한다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { avg3, fullDate, innings } from "./format.ts";
import { note, scroller, term, valueWithDen } from "./parts.ts";
import { page } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { dayHref } from "./today-page.ts";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";

/** 그 팀 소속 한 선수의 한 줄. ⚠**비율에는 분모가 붙는다**(M2) */
export interface TeamBatter {
  playerId: string;
  name: string;
  games: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  sb: number;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  /** 규정타석에 닿았는가. **닿지 않아도 목록에는 남는다**(M11) */
  qualified: boolean;
}

export interface TeamPitcher {
  playerId: string;
  name: string;
  /** `starter` | `reliever` */
  role: string;
  games: number;
  outs: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  so: number;
  era: Rate;
  whip: Rate;
  qualified: boolean;
}

/** 월별 승패 — 팀이 언제 좋았는가 */
export interface TeamMonth {
  /** `2026-04` */
  month: string;
  w: number;
  l: number;
  t: number;
}

export interface TeamPageData {
  season: number;
  teamCode: string;
  name: string;
  shortName: string;
  color: TeamColor;
  leagueName: string;
  asOf: string | null;
  /** 순위. 경기가 없으면 null */
  rank: number | null;
  tiedRank: boolean;
  games: number;
  w: number;
  l: number;
  t: number;
  pct: number | null;
  gamesBehind: number;
  rf: number;
  ra: number;
  /** 팀 타율·팀 방어율. 분모를 들고 다닌다 */
  avg: Rate;
  era: Rate;
  home: { w: number; l: number; t: number };
  away: { w: number; l: number; t: number };
  last10: { w: number; l: number; t: number };
  months: TeamMonth[];
  batters: TeamBatter[];
  pitchers: TeamPitcher[];
  /**
   * 최근 경기(새 것이 앞). 날짜 화면으로 보낸다.
   * ⚠**주소를 데이터에 담지 않는다.** 이 화면은 `teams/` 아래(깊이 1)에 있는데
   * 데이터를 만드는 쪽은 자기가 어느 깊이에서 읽힐지 모른다 — 루트 기준으로 적으면
   * **240개가 통째로 404가 된다**(2026-08-16 실측). 깊이를 아는 것은 렌더러다.
   */
  recent: { date: string; opponent: string; home: boolean; result: string }[];
  /** 최신 경기일. `dayHref`가 그 날만 `today.html`로 보낸다 */
  latestDate: string | null;
  /** 이 시즌에 ポストシーズン 기록이 있는가 */
  hasPostseason: boolean;
}

/** 팀 페이지의 파일 경로. **한 곳에서만 만든다**(M1) — 갈리면 어딘가는 404다 */
export function teamPath(code: string): string {
  return `teams/${code}.html`;
}

function wlt(x: { w: number; l: number; t: number }): string {
  return `${x.w}-${x.l}-${x.t}`;
}

/**
 * 값과 분모를 한 덩어리로.
 * ⚠**여기서 다시 만들지 않는다** — `valueWithDen`이 그 한 벌이다(M2의 구조적 강제).
 * 전에는 이 파일에 같은 일을 하는 함수가 따로 있어 **M2를 지키는 함수 자체가 세 벌**이 됐다.
 */
const rate = valueWithDen;

function batterTable(rows: TeamBatter[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">打者の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th>試合</th><th>${term("打席")}</th><th>安打</th><th>本塁打</th>
      <th>打点</th><th>盗塁</th><th>${term("打率")}</th><th>${term("出塁率")}</th><th>${term("長打率")}</th><th>${term("OPS")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.qualified ? "" : "thin"}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td>${r.games}</td><td class="b">${r.pa}</td><td>${r.h}</td><td>${r.hr}</td>
      <td>${r.rbi}</td><td>${r.sb}</td>
      <td class="wd">${rate(r.avg, "打数", 3)}</td>
      <td class="wd">${rate(r.obp, "打席", 3)}</td>
      <td class="wd">${rate(r.slg, "打数", 3)}</td>
      <td class="wd">${rate(r.ops, "打席", 3)}</td>
    </tr>`,
    )}</tbody>
  </table>`);
}

function pitcherTable(rows: TeamPitcher[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">投手の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th>役割</th><th>登板</th><th>投球回</th>
      <th>勝</th><th>敗</th><th>S</th><th>H</th><th>奪三振</th><th>${term("防御率")}</th><th>${term("WHIP")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.qualified ? "" : "thin"}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td>${r.role === "starter" ? "先発" : "救援"}</td>
      <td>${r.games}</td><td class="b">${innings(r.outs)}</td>
      <td>${r.w}</td><td>${r.l}</td><td>${r.sv}</td><td>${r.hld}</td><td>${r.so}</td>
      <td class="wd">${rate(r.era, "回", 2)}</td>
      <td class="wd">${rate(r.whip, "回", 2)}</td>
    </tr>`,
    )}</tbody>
  </table>`);
}

/**
 * 월별 승패 막대.
 *
 * ⚠**우리가 만든 그림이다**(§6 — 로고를 못 쓰는 자리에서 팀을 구별하는 수단이기도 하다).
 * ⚠**분모를 함께 낸다** — 「4월 12승」만으로는 몇 경기 중인지 모른다.
 */
function monthBars(months: TeamMonth[]): RawHtml {
  if (months.length === 0) return raw("");
  const most = Math.max(1, ...months.map((m) => m.w + m.l + m.t));
  return html`<div class="tmonths">${months.map((m) => {
    const n = m.w + m.l + m.t;
    return html`<div class="tmonth" style="--w:${((m.w / most) * 100).toFixed(1)};--l:${((m.l / most) * 100).toFixed(1)}">
    <b>${Number(m.month.slice(5))}月</b>
    <div class="tbar"><i class="w"></i><i class="l"></i></div>
    <s>${wlt(m)}<em>${n}試合</em></s>
  </div>`;
  })}</div>`;
}

export function renderTeamPage(d: TeamPageData, ctx: RenderContext): string {
  // ⚠시즌을 바꿀 때 選手一覧이 아니라 **그 시즌의 같은 팀**으로 간다 — 팀은 시즌을 넘어 존재한다
  const { base, root, seasons } = ctx.paths(teamPath(d.teamCode), {
    path: "index.html",
    label: "選手一覧",
  });

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">${d.name}</span>
    <span class="sub">${d.season}年 · ${d.leagueName}${d.rank === null
      ? ""
      : ` · ${d.rank}位${d.tiedRank ? "（同）" : ""}`} · ${wlt(d)}</span>
    <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
  </div>
</header>

<section class="block" id="b-teamsum">
  <h4>チーム成績<span class="qt">${d.games}試合</span></h4>
  <dl class="row">
    <div><dt>${term("勝率")}</dt><dd>${d.pct === null ? "—" : avg3(d.pct)}<span class="den">${d.w + d.l}試合</span></dd></div>
    <div><dt>ゲーム差</dt><dd>${d.gamesBehind === 0 ? "—" : d.gamesBehind.toFixed(1).replace(/\.0$/, "")}</dd></div>
    <div><dt>得点</dt><dd>${d.rf}<span class="den">${d.games}試合</span></dd></div>
    <div><dt>失点</dt><dd>${d.ra}<span class="den">${d.games}試合</span></dd></div>
    <div><dt>得失点差</dt><dd>${d.rf - d.ra >= 0 ? "+" : ""}${d.rf - d.ra}</dd></div>
    <div><dt>${term("打率")}</dt><dd>${rate(d.avg, "打数", 3)}</dd></div>
    <div><dt>${term("防御率")}</dt><dd>${rate(d.era, "回", 2)}</dd></div>
    <div><dt>ホーム</dt><dd>${wlt(d.home)}</dd></div>
    <div><dt>ビジター</dt><dd>${wlt(d.away)}</dd></div>
    <div><dt>直近10試合</dt><dd>${wlt(d.last10)}</dd></div>
  </dl>
  ${note(
    // ⚠**무엇을 세고 무엇을 안 세는지 적는다**(M3의 정신)
    `勝率は 勝 ÷（勝＋敗）で、引き分けは分母に入れません（NPBの規定）。` +
      `この画面の数字はすべて**レギュラーシーズン**のものです` +
      (d.hasPostseason ? "（ポストシーズンは別の画面にあります）。" : "。") +
      `得点・失点は公表記録、打率と防御率は当サイトの再計算です。`,
  )}
</section>

${d.months.length === 0
    ? raw("")
    : html`<section class="block" id="b-teammonth">
  <h4>月別<span class="qt">勝-敗-分</span></h4>
  ${monthBars(d.months)}
</section>`}

<section class="block" id="b-teambat">
  <h4>打者<span class="qt">${d.batters.length}人</span></h4>
  ${batterTable(d.batters, base)}
  ${note(
    // ⚠**이 표는 「현재 로스터」가 아니다.** `battingByTeam`은 **그 구단에서 낸 몫**이라
    // 시즌 도중 떠난 선수도 남는다(실측 2026-08-16: 2026년 3구단·2025년 4구단).
    // 一覧 화면의 구단 묶음은 최신 소속 기준이라, 말하지 않으면 두 화면이 같은 로스터를
    // 다르게 말하게 된다 — 숫자가 아니라 **무엇을 세었는지**를 적어서 맞춘다
    "この球団で出場した記録です — シーズン途中に移籍した選手も、この球団での分だけ含みます。" +
      "打席の多い順で、規定打席に届いていない選手は薄く表示しています — 値は小さな標本のものです。",
  )}
</section>

<section class="block" id="b-teampit">
  <h4>投手<span class="qt">${d.pitchers.length}人</span></h4>
  ${pitcherTable(d.pitchers, base)}
  ${note(
    "この球団で登板した記録です — シーズン途中に移籍した投手も、この球団での分だけ含みます。" +
      "投球回の多い順で、規定投球回に届いていない投手は薄く表示しています。",
  )}
</section>

${d.recent.length === 0
    ? raw("")
    : html`<section class="block" id="b-teamgames">
  <h4>直近の試合</h4>
  <ul class="trecent">${d.recent.map(
    (g) => html`<li class="${g.result === "○" ? "w" : g.result === "●" ? "l" : ""}">
    <a href="${dayHref(base, g.date, d.latestDate)}"><b>${g.result}</b><span>${fullDate(g.date)}</span>
    <s>${g.home ? "対" : "＠"}${g.opponent}</s></a>
  </li>`,
  )}</ul>
</section>`}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}index.html">選手一覧</a> · <a href="${base}today.html">試合</a>
</nav>`;

  return page({
    title: `${d.name} — ${d.season}年`,
    base,
    root,
    seasons,
    color: d.color,
    spine: d.name,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "team",
    body,
  });
}
