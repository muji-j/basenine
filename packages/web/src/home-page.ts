/**
 * ホーム — 「今このリーグで何が起きているか」に一枚で答える。
 *
 * ⚠**이 화면은 「무엇을 아직 모르는지」도 말한다.** 우리가 보유한 것은 4시즌(2023~2026)뿐이라
 * **통산 기록은 다루지 않는다** — 「통산 2000안타까지 3개」 같은 말은 우리가 할 수 없는 말이다.
 * 시즌 안에서 닫히는 것(시즌 홈런·시즌 도루·연속 경기)만 낸다.
 *
 * ⚠**マジックナンバーを出さない**(2026-08-17 확정). NPB는 승률(무승부 제외)로 순위를 매기고
 * 잔여 맞대결 일정을 우리는 받지 않는다 — 표준 공식이 그대로 맞지 않아 매체마다 값이 갈린다.
 * **이름이 같은데 값이 다르면 그건 거짓말이 된다.** 대신 **정확히 계산되는 것**만 낸다:
 * 잔여 경기(143 − 소화)와, 전승·전패했을 때의 승률 범위.
 *
 * ⚠**143은 가정이 아니라 실측이다**(2026-08-17). 2023·2025 두 시즌 모두 12구단 전원이
 * 정확히 143경기를 소화했다. 다만 **`status='played'` 만 세야 한다** — 우천 중지 행이 따로 남고
 * 재편성 경기가 또 한 행이라, 행 수로 세면 팀당 144~153이 되어 잔여가 음수가 된다.
 *
 * ⚠**「지금 이어지는 중」은 마지막 출장일과 함께 말한다.** 5월 22일 이후 결장한 선수의
 * 연속 기록을 「継続中」이라고 쓰면 화면이 거짓말을 한다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, avg3, fullDate } from "./format.ts";
import { ROSTER_PATH, page } from "./layout.ts";
import type { RenderContext } from "./layout.ts";
import { note, scroller, term } from "./parts.ts";
import { teamPath } from "./team-page.ts";
import { dayHref } from "./today-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";

/** NPB 정규시즌은 팀당 143경기. **실측으로 확인한 값이고 가정이 아니다**(파일 머리말) */
export const REGULAR_SEASON_GAMES = 143;

/**
 * 순위 다툼 한 줄.
 *
 * ⚠**전승·전패 승률은 「가능성」이지 예측이 아니다.** 화면이 그 말을 그대로 쓴다.
 */
export interface HomeStanding {
  teamCode: string;
  shortName: string;
  color: TeamColor;
  rank: number | null;
  tiedRank: boolean;
  w: number;
  l: number;
  t: number;
  pct: number | null;
  gamesBehind: number;
  /** 소화 경기(`status='played'` 기준) */
  played: number;
  /** 남은 경기. **음수가 되면 표시하지 않는다** — 143을 넘긴 시즌은 우리가 모르는 시즌이다 */
  remaining: number;
  /** 남은 경기를 전부 이겼을 때의 승률. 남은 경기가 0이면 현재 승률과 같다 */
  bestPct: number | null;
  /** 남은 경기를 전부 졌을 때의 승률 */
  worstPct: number | null;
  /** 연승(양수)·연패(음수)·직전 무승부(0). **직전 경기부터 이어진 것만** */
  streak: number;
  last10: { w: number; l: number; t: number };
}

export interface HomeLeague {
  id: string;
  name: string;
  rows: HomeStanding[];
}

/** 「이 페이스라면」 — **예측이 아니라 환산**이다. 화면이 그 말을 쓴다 */
export interface HomePace {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  /** `本塁打` 등 */
  label: string;
  /** 지금까지의 개수 */
  count: number;
  /** 팀 소화 경기. **분모다**(M2) */
  teamGames: number;
  /** 143경기 환산. ⚠**정수로 내림한다** — 「43.7본」은 존재하지 않는 수다 */
  pace: number;
  /** 다음 마디까지 남은 개수. 마디가 없으면 null */
  toNext: number | null;
  /** 그 마디 값 */
  next: number | null;
}

/** 이어지고 있는 기록 */
export interface HomeStreak {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  kind: "hitting" | "onBase";
  games: number;
  /** 마지막 출장일. **「継続中」이라고 쓸 수 있는지 판단하는 근거** */
  lastGameDate: string | null;
}

/**
 * 지난주의 한 사람.
 *
 * ⚠**순위의 근거는 「런」이다.** 한 주의 표본은 20~30타석이라 율로 줄 세우면
 * 「7타수 4안타」가 1위가 된다 — 이 도메인의 1급 함정(M2)을 주간 단위가 그대로 재현한다.
 * 그래서 **SRC/SRP**(상황을 감안한 득점 기여, 단위가 런이고 더할 수 있는 값)로 세운다.
 * ⚠**그래도 표본은 늘 함께 낸다** — 「몇 타석에서 낸 것인가」가 빠지면 같은 잘못이다.
 * ⚠**우리가 만든 지표라는 것을 화면이 말한다.** WAR 처럼 남이 쓰는 이름을 빌리지 않는다.
 */
export interface HomeWeekPlayer {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  /** 순위의 근거. 타자는 SRC, 투수는 SRP — 둘 다 **런** 단위다 */
  runs: number;
  /** 표본(타자는 타석, 투수는 상대 타자). **분모다**(M2) */
  faced: number;
  /** 그 주의 성적을 사람이 읽는 한 줄로. 이미 분모를 품고 있다 */
  line: string;
}

/**
 * 지난주의 한 구단.
 *
 * ⚠**주간 승률을 내지 않는다.** 한 주는 5~6경기라 「.833」 같은 수가 나오고,
 * 그 자릿수는 시즌 승률과 같은 무게로 읽힌다 — 승·패·분 그대로가 정직하다(M2).
 */
export interface HomeWeekTeam {
  teamCode: string;
  shortName: string;
  color: TeamColor;
  w: number;
  l: number;
  t: number;
  /** 득점·실점. **차이만 내지 않는다** — 「+12」가 8-(-4)인지 20-8인지 다르다 */
  rf: number;
  ra: number;
}

export interface HomeWeek {
  /** 월요일 */
  from: string;
  /** 일요일 */
  to: string;
  /** 그 주에 실제로 열린 경기일 수. **0이면 그 주를 내지 않는다** */
  gameDays: number;
  batters: HomeWeekPlayer[];
  pitchers: HomeWeekPlayer[];
  /** 그 주의 구단 성적. 이긴 수가 많은 쪽부터 */
  teams: HomeWeekTeam[];
}

export interface HomePageData {
  season: number;
  asOf: string | null;
  latestDate: string | null;
  /** 최신 경기일의 결과 요약 */
  latest: {
    date: string;
    games: { away: string; home: string; awayCode: string; homeCode: string; awayRuns: number | null; homeRuns: number | null }[];
  } | null;
  leagues: HomeLeague[];
  /** 지난주(월~일)의 베스트. 완결된 주가 없으면 null */
  week: HomeWeek | null;
  paces: HomePace[];
  streaks: HomeStreak[];
  /** 이 시즌에 ポストシーズン 기록이 있는가 */
  hasPostseason: boolean;
}

const pctText = (v: number | null): string => (v === null ? NO_VALUE : avg3(v));

/** `2026-08-10` → `8/10`. ⚠**연도를 떼는 것은 같은 줄에 두 날짜가 나올 때만** */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 지난주 상위 몇 사람.
 *
 * ⚠**순위 숫자를 크게 쓰지 않는다.** 한 주짜리 순위는 시즌 순위와 무게가 다르고,
 * 같은 모양으로 그리면 그렇게 읽힌다.
 */
function weekList(label: string, xs: readonly HomeWeekPlayer[], metric: string, base: string): RawHtml {
  if (xs.length === 0) return html`<div><dt>${label}</dt><dd class="empty">記録がありません。</dd></div>`;
  return html`<div class="wkcol">
  <p class="wklab">${label}<s>${metric}順</s></p>
  <ol class="wklist">${xs.map(
    (x) => html`<li>
    <a href="${base}players/${x.playerId}.html">${x.name}</a>
    ${teamChip(x.teamCode, x.shortName, x.color, base)}
    <b>${x.runs >= 0 ? "+" : ""}${x.runs.toFixed(1)}</b><s>${metric}</s>
    <em>${x.line}</em>
  </li>`,
  )}</ol>
</div>`;
}

/** 구단 색 칩 + 짧은 이름. **로고를 쓰지 않는다**(§6) */
function teamChip(code: string, shortName: string, color: TeamColor, base: string): RawHtml {
  return html`<a class="hteam" href="${base}${teamPath(code)}"
    style="--chip:${color.base};--chip-ink:${color.ink}"><i></i>${shortName}</a>`;
}

/** 연승·연패를 글자로. ⚠**색만으로 전하지 않는다** */
function streakText(n: number): string {
  if (n === 0) return NO_VALUE;
  return n > 0 ? `${n}連勝` : `${-n}連敗`;
}

function standingsTable(l: HomeLeague, base: string): RawHtml {
  return scroller(html`<table class="hstand">
  <thead><tr>
    <th>順位</th>
    <th class="l">球団</th><th>勝</th><th>敗</th><th>分</th><th>${term("勝率")}</th><th>ゲーム差</th>
    <th>直近10</th><th>連続</th><th>残り</th><th class="l">全勝〜全敗の勝率</th>
  </tr></thead>
  <tbody>${l.rows.map(
    (r) => html`<tr style="--chip:${r.color.base}" class="${r.rank === 1 ? "lead" : ""}">
    <td class="hrank">${r.rank === null ? NO_VALUE : r.rank}${r.tiedRank ? html`<s>同</s>` : null}</td>
    <td class="l">${teamChip(r.teamCode, r.shortName, r.color, base)}</td>
    <td>${r.w}</td><td>${r.l}</td><td>${r.t}</td>
    <td class="b">${pctText(r.pct)}</td>
    <td>${r.gamesBehind === 0 ? NO_VALUE : r.gamesBehind.toFixed(1).replace(/\.0$/, "")}</td>
    <td>${r.last10.w}-${r.last10.l}-${r.last10.t}</td>
    <td>${streakText(r.streak)}</td>
    <td>${r.remaining < 0 ? NO_VALUE : r.remaining}</td>
    <td class="l wd">${r.remaining <= 0
      ? NO_VALUE
      : html`${pctText(r.bestPct)}<span class="den">〜${pctText(r.worstPct)}</span>`}</td>
  </tr>`,
  )}</tbody>
</table>`);
}

export function renderHomePage(d: HomePageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("index.html");

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${d.season}年 ${ctx.site.name}</h1>
    <span class="sub">リーグの今を一枚で</span>
    <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
  </div>
</header>

<!-- ⚠**첫 화면에서 갈 곳을 먼저 보여준다**(2026-08-17 유저 요청).
     맨 아래 링크 줄만 있으면 스크롤 끝까지 가야 알 수 있다.
     ⚠**시즌에 따라 있고 없고 하는 화면은 넣지 않는다** — 포스트시즌은 기록이 있을 때만
     상단 내비가 내므로, 여기서 또 내면 「눌러도 빈 화면」이 생긴다(M12). -->
<nav class="hnav" aria-label="主なページ">
  <a href="${base}ranking.html">リーグ順位表<s>全指標</s></a>
  <a href="${base}${ROSTER_PATH}">選手一覧<s>球団別</s></a>
  <a href="${base}today.html">試合<s>結果と予告</s></a>
  <a href="${base}matchup.html">対戦<s>投手×打者</s></a>
  <a href="${base}compare.html">くらべる<s>2人</s></a>
  <a href="${base}days.html">日付から<s>過去の試合</s></a>
</nav>

${d.latest === null
    ? raw("")
    : html`<section class="block" id="b-hlatest">
  <h2>${fullDate(d.latest.date)}の結果<span class="qt">${d.latest.games.length}試合</span></h2>
  <ul class="hgames">${d.latest.games.map(
      (g) => html`<li>
    <span class="hg-t">${g.away}</span>
    <b>${g.awayRuns === null ? NO_VALUE : g.awayRuns}</b>
    <s>-</s>
    <b>${g.homeRuns === null ? NO_VALUE : g.homeRuns}</b>
    <span class="hg-t">${g.home}</span>
  </li>`,
    )}</ul>
  <p class="more"><a href="${dayHref(base, d.latest.date, d.latestDate)}">この日の詳細</a></p>
</section>`}

${d.leagues.map(
    (l) => html`<section class="block" id="b-hstand-${l.id}">
  <h2>${l.name}</h2>
  ${standingsTable(l, base)}
</section>`,
  )}
${note(
    `残り試合は ${REGULAR_SEASON_GAMES}試合 から消化済み（中止を除く）を引いた数です。` +
      "「全勝〜全敗の勝率」は残りを全部勝った場合と全部負けた場合の勝率で、**予想ではなく計算できる範囲**です。" +
      "順位が並んだ球団には「同」を付けています — 当該球団間の対戦成績で決めた上で、それでも並ぶ場合です。" +
      "引き分けは勝率の分母に入りません（NPBの規定）。" +
      "マジックナンバーは出していません — NPBは勝率で順位を決め、残りの対戦相手も当サイトは持っていないため、" +
      "同じ名前で違う数字を出すことになるからです。",
  )}

${d.week === null
    ? raw("")
    : html`<section class="block" id="b-hweek">
  <h2>先週の顔<span class="qt">${monthDay(d.week.from)}〜${monthDay(d.week.to)} · ${d.week.gameDays}日</span></h2>
  <div class="cols">
    ${weekList("打者", d.week.batters, "SRC", base)}
    ${weekList("投手", d.week.pitchers, "SRP", base)}
  </div>
  ${d.week.teams.length === 0 ? null : html`<p class="wklab">球団<s>勝-敗-分 · 得点/失点</s></p>
  <ul class="wkteams">${d.week.teams.map(
      (t) => html`<li>
    ${teamChip(t.teamCode, t.shortName, t.color, base)}
    <b>${t.w}-${t.l}-${t.t}</b>
    <em>${t.rf}/${t.ra}<s>${t.rf - t.ra >= 0 ? "+" : ""}${t.rf - t.ra}</s></em>
  </li>`,
    )}</ul>`}
  ${note(
      "**月曜から日曜まで**を1週間として、**終わった週だけ**を出します — 途中の週を出すと、" +
        "試合数の違う選手が同じ表に並びます。" +
        "並べ方は当サイトの**SRC・SRP**（その場面でどれだけ得点を動かしたか。単位は「点」）です。" +
        "1週間は20〜30打席しかないので、**率で並べると「7打数4安打」が1位になります** — " +
        "だから点で並べ、打席数も必ず併記しています。",
    )}
</section>`}

${d.paces.length === 0
    ? raw("")
    : html`<section class="block" id="b-hpace">
  <h2>今シーズンのペース<span class="qt">${REGULAR_SEASON_GAMES}試合換算</span></h2>
  ${scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th class="l">項目</th>
      <th>現在</th><th>${REGULAR_SEASON_GAMES}試合換算</th><th class="l">次の節目</th>
    </tr></thead>
    <tbody>${d.paces.map(
      (x) => html`<tr>
      <td class="l"><a href="${base}players/${x.playerId}.html">${x.name}</a></td>
      <td class="l">${teamChip(x.teamCode, x.shortName, x.color, base)}</td>
      <td class="l">${x.label}</td>
      <td class="b">${x.count}<span class="den">${x.teamGames}試合</span></td>
      <td>${x.pace}</td>
      <td class="l">${x.next === null || x.toNext === null
        ? NO_VALUE
        : html`${x.next}まであと<b>${x.toNext}</b>`}</td>
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    "**各部門の上位3人**です — 部門ごとに分けて選んでいます。" +
      "まとめて選ぶと数の大きい部門（打点・奪三振）が全部を占めて、盗塁が消えるからです。" +
      "換算は「今の割合がシーズン終了まで続いたら」という**計算**で、予想ではありません。" +
      "分母はその球団の消化試合数です — 消化が少ない球団の選手ほど換算値は動きやすくなります。" +
      "当サイトは2023年からの記録しか持たないため、**通算記録は扱いません**。",
  )}
</section>`}

${d.streaks.length === 0
    ? raw("")
    : html`<section class="block" id="b-hstreak">
  <h2>続いている記録</h2>
  ${scroller(html`<table>
    <thead><tr><th class="l">選手</th><th class="l">球団</th><th class="l">記録</th><th>試合</th><th class="l">最後の出場</th></tr></thead>
    <tbody>${d.streaks.map(
      (x) => html`<tr>
      <td class="l"><a href="${base}players/${x.playerId}.html">${x.name}</a></td>
      <td class="l">${teamChip(x.teamCode, x.shortName, x.color, base)}</td>
      <td class="l">${x.kind === "hitting" ? "連続安打" : "連続出塁"}</td>
      <td class="b">${x.games}</td>
      <td class="l">${x.lastGameDate === null ? NO_VALUE : fullDate(x.lastGameDate)}</td>
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    "**最後の出場日を必ず併記しています** — その日より後に試合があれば、記録はもう途切れているか、" +
      "本人が出ていないかのどちらかです。連続記録は「試合」単位で数えます（NPB・MLBの慣例）。" +
      "代走だけで出た試合は数えません。",
  )}
</section>`}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a> ·
  <a href="${base}today.html">試合</a> · <a href="${base}compare.html">選手をくらべる</a>
</nav>`;

  return page({
    title: `${d.season}年 ${ctx.site.name}`,
    base,
    root,
    seasons,
    // ⚠**홈은 특정 구단의 화면이 아니다.** 구단 색을 쓰면 그 팀 화면처럼 보인다
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "home",
    body,
  });
}
