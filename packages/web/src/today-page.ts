/**
 * 試合 — 「직전 경기일에 무슨 일이 있었나」와 「다음에 누가 던지나」.
 *
 * ⚠**「今日」라고 쓰지 않는다.** 수집은 하루 1회이고 생성일과 경기일은 어긋난다
 * (2026-08-16 생성 시점의 최신 경기일은 8/14였다). 「今日の試合」이라고 적으면
 * 이틀 전 결과를 오늘 것으로 읽게 만든다 — 날짜를 그대로 내고, 생성일과 같을 때만 「本日」를 붙인다.
 *
 * ⚠**중지·노게임을 0대0으로 만들지 않는다**(M11). 「경기가 없었다」와 「0점이었다」는 다르다.
 * ⚠**「눈에 띈 기록」의 기준을 화면에 적는다.** 기준이 코드에만 있으면 「왜 이 선수가 없지?」에
 * 답할 수 없고, 그건 순위의 자격 기준을 숨기는 것과 같은 종류의 잘못이다(M3의 정신).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, dec2, fullDate, innings } from "./format.ts";
import { note } from "./parts.ts";
import { page } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR, shortNameOf } from "@bb-app/domain";
import { gameSlug } from "./game-page.ts";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";

export interface TodaySide {
  teamCode: string;
  shortName: string;
  name: string;
  color: TeamColor;
  /** ⚠**미수집이면 null**(M11). 0점과 「모른다」는 다르다 */
  runs: number | null;
  hits: number | null;
  errors: number | null;
}

export interface PlayerRef {
  playerId: string;
  name: string;
  /** ⚠**소속을 든다.** 같은 카드에 동명이인이 서면 이걸로 구별한다 */
  teamCode: string;
}

export interface TodayStar {
  playerId: string;
  name: string;
  teamCode: string;
  kind: "batting" | "pitching";
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  outs: number;
  er: number;
  so: number;
  /** `○`·`●`·`S`·`H`. 없으면 null */
  decision: string | null;
}

export interface TodayGame {
  gameId: string;
  venue: string | null;
  /** `played`가 아니면 결과가 없다 */
  status: string;
  notPlayedReason: string | null;
  away: TodaySide;
  home: TodaySide;
  winner: "away" | "home" | null;
  win: PlayerRef | null;
  lose: PlayerRef | null;
  save: PlayerRef | null;
  stars: TodayStar[];
  /**
   * ⚠**경기 페이지가 실제로 만들어졌는가.**
   *
   * 경기 페이지는 득점이 있는 경기만 만든다. 라인스코어만 못 읽어 득점이 null인 경기는
   * 카드에는 「—」로 나오는데 링크는 **404**가 된다 — 조용하고 발견이 늦다.
   * 만들어졌을 때만 링크를 낸다(2026-08-16 이중 검토에서 지적).
   */
  hasPage: boolean;
}

/** 다음 경기의 예고선발 — **요약만**. 상세는 予告先発 페이지가 낸다 */
export interface TodayProbable {
  venue: string | null;
  startTime: string | null;
  sides: [ProbableBrief, ProbableBrief];
}

export interface ProbableBrief {
  shortName: string;
  color: TeamColor;
  playerId: string | null;
  name: string | null;
  /** 이 투수의 시즌 방어율. 등판이 없으면 null */
  era: Rate | null;
}

export interface TodayPageData {
  /** 결과를 싣는 경기일. 경기가 하나도 없으면 null */
  gameDate: string | null;
  /** 사이트 생성일. 「本日」인지 판정한다 */
  builtOn: string;
  games: TodayGame[];
  /** 예고선발이 나와 있는 날 */
  probableDate: string | null;
  probables: TodayProbable[];
  /** 「눈에 띈 기록」의 기준. **화면에 그대로 적는다** */
  starRule: string;
  /** 한 경기에 싣는 최대 인원 */
  starLimit: number;
}

function scoreLine(side: TodaySide, won: boolean, base: string): RawHtml {
  return html`<div class="gside${won ? " w" : ""}" style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <span class="gt"><i></i>${side.shortName}</span>
  <span class="gr">${side.runs === null ? NO_VALUE : side.runs}</span>
</div>`;
}

/**
 * ⚠**한 카드 안에서 겹치는 표시명을 찾는다**(M10의 화면 쪽 대응).
 *
 * 2026-08-14 西武−ロッテ 전에 「小島」가 **두 사람** 있었다 — 로데의 패전투수와
 * 세이부의 타자다. ID는 다르고 링크도 다르지만, 이름만 나란히 서면 화면은
 * 「진 투수가 상대 팀에 홈런을 쳤다」고 말한다. **데이터가 맞아도 화면이 거짓말을 한다.**
 *
 * 그래서 겹치는 이름에만 구단을 붙인다. 전부에 붙이면 읽기만 어려워진다.
 */
export function ambiguousNames(g: TodayGame): Set<string> {
  const seen = new Map<string, Set<string>>();
  const mark = (name: string, playerId: string): void => {
    const ids = seen.get(name);
    if (ids === undefined) seen.set(name, new Set([playerId]));
    else ids.add(playerId);
  };
  for (const p of [g.win, g.lose, g.save]) if (p !== null) mark(p.name, p.playerId);
  for (const s of g.stars) mark(s.name, s.playerId);
  // ⚠**같은 사람이 두 줄에 나오는 것은 겹침이 아니다**(선발이 승리투수이면서 호투 기록에도 선다).
  // 그래서 이름이 아니라 **서로 다른 ID의 수**로 센다
  return new Set([...seen].filter(([, ids]) => ids.size > 1).map(([name]) => name));
}

/** 겹치는 이름에만 구단을 붙인다 */
function who(name: string, teamCode: string, ambiguous: ReadonlySet<string>): string {
  return ambiguous.has(name) ? `${name}（${shortNameOf(teamCode)}）` : name;
}

/**
 * 승·패·세이브.
 *
 * ⚠**「勝」과 「敗」를 색으로만 구분하지 않는다.** 색각 특성에 따라 구별되지 않고,
 * 여기는 이름 세 개가 나란히 있는 자리라 라벨이 없으면 어느 게 어느 건지 알 수 없다.
 */
function decisions(g: TodayGame, base: string, ambiguous: ReadonlySet<string>): RawHtml {
  const one = (label: string, cls: string, p: PlayerRef | null): RawHtml =>
    p === null
      ? raw("")
      : html`<span class="gd ${cls}"><b>${label}</b><a href="${base}players/${p.playerId}.html">${who(p.name, p.teamCode, ambiguous)}</a></span>`;
  if (g.win === null && g.lose === null && g.save === null) return raw("");
  return html`<p class="gdec">${one("勝", "w", g.win)}${one("負", "l", g.lose)}${one("S", "s", g.save)}</p>`;
}

/** 한 줄짜리 성적 문구. ⚠**분모(打数·投球回)를 반드시 앞에 둔다**(M2) */
function starText(s: TodayStar): string {
  if (s.kind === "batting") {
    const parts = [`${s.ab}打数${s.h}安打`];
    if (s.hr > 0) parts.push(`${s.hr}本塁打`);
    if (s.rbi > 0) parts.push(`${s.rbi}打点`);
    return parts.join("　");
  }
  const parts = [`${innings(s.outs)}回 自責${s.er}`];
  if (s.so > 0) parts.push(`${s.so}奪三振`);
  return parts.join("　");
}

const DECISION_LABEL: Readonly<Record<string, string>> = { "○": "勝", "●": "敗", S: "S", H: "H" };

function gameCard(g: TodayGame, base: string): RawHtml {
  if (g.status !== "played") {
    return html`<article class="gcard off">
  <h5 class="gvenue">${g.venue ?? ""}</h5>
  <div class="gscore">
    <div class="gside" style="--chip:${g.away.color.base}"><span class="gt"><i></i>${g.away.shortName}</span></div>
    <div class="gside" style="--chip:${g.home.color.base}"><span class="gt"><i></i>${g.home.shortName}</span></div>
  </div>
  <p class="gnone">${g.notPlayedReason ?? "試合なし"}</p>
</article>`;
  }

  const ambiguous = ambiguousNames(g);
  const hits = g.away.hits === null || g.home.hits === null ? null : `${g.away.hits}-${g.home.hits}`;
  const errs =
    g.away.errors === null || g.home.errors === null ? null : `${g.away.errors}-${g.home.errors}`;

  return html`<article class="gcard">
  <h5 class="gvenue">${g.venue ?? ""}${g.winner === null ? html`<span class="gtie">引き分け</span>` : null}</h5>
  <div class="gscore">
    ${scoreLine(g.away, g.winner === "away", base)}
    ${scoreLine(g.home, g.winner === "home", base)}
  </div>
  ${hits === null && errs === null
    ? raw("")
    : html`<p class="ghe">${hits === null ? null : html`<span>安打 <b>${hits}</b></span>`}${errs === null ? null : html`<span>失策 <b>${errs}</b></span>`}</p>`}
  ${decisions(g, base, ambiguous)}
  ${g.stars.length === 0
    ? raw("")
    : html`<ul class="gstars">${g.stars.map(
        (s) => html`<li style="--chip:${g.away.teamCode === s.teamCode ? g.away.color.base : g.home.color.base}">
      <i></i><a href="${base}players/${s.playerId}.html">${who(s.name, s.teamCode, ambiguous)}</a>
      <span class="gsl">${starText(s)}</span>
      ${s.decision === null ? null : html`<em class="gsd">${DECISION_LABEL[s.decision] ?? s.decision}</em>`}
    </li>`,
      )}</ul>`}
  ${g.hasPage
    ? html`<p class="gmore"><a href="${base}games/${gameSlug(g.gameId)}.html">この試合の詳細</a></p>`
    : raw("")}
</article>`;
}

function probableCard(p: TodayProbable, base: string): RawHtml {
  const side = (b: ProbableBrief): RawHtml => html`<div class="pbside" style="--chip:${b.color.base}">
  <span class="pbt"><i></i>${b.shortName}</span>
  ${b.playerId === null || b.name === null
    ? html`<span class="pbn empty">発表待ち</span>`
    : html`<a class="pbn" href="${base}players/${b.playerId}.html">${b.name}</a>`}
  ${b.era === null
    ? html`<span class="pbe">${NO_VALUE}</span>`
    : html`<span class="pbe">防御率 ${dec2(b.era.value)}<s>${innings(b.era.denominator)}回</s></span>`}
</div>`;
  return html`<article class="pbcard">
  <h5 class="gvenue">${p.venue ?? ""}${p.startTime === null ? "" : ` ${p.startTime}`}</h5>
  ${side(p.sides[0])}${side(p.sides[1])}
</article>`;
}

export function renderTodayPage(d: TodayPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("today.html");
  const isToday = d.gameDate !== null && d.gameDate === d.builtOn;
  const played = d.games.filter((g) => g.status === "played").length;
  const off = d.games.length - played;

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">試合</span>
    <span class="sub">${d.gameDate === null
      ? "試合の記録がまだありません"
      : `${fullDate(d.gameDate)}${isToday ? "（本日）" : ""}の結果 · ${played}試合${off > 0 ? ` · 中止${off}試合` : ""}`}</span>
  </div>
  <span class="asof">${fullDate(d.builtOn)}生成</span>
</header>

${d.probables.length === 0
    ? raw("")
    : html`<section class="block" id="b-probable">
  <h4>次の予告先発<span class="qt">${d.probableDate === null ? "" : fullDate(d.probableDate)}</span></h4>
  <div class="pbcards">${d.probables.map((p) => probableCard(p, base))}</div>
  <p class="note"><a href="${base}starters.html">対戦する打者の成績まで見る</a></p>
</section>`}

<section class="block" id="b-results">
  <h4>${d.gameDate === null ? "試合結果" : `${fullDate(d.gameDate)}の結果`}</h4>
  ${d.games.length === 0
    ? html`<p class="empty">この日の試合はまだ取り込んでいません。</p>`
    : html`<div class="gcards">${d.games.map((g) => gameCard(g, base))}</div>`}
  ${note(
    // ⚠**기준을 화면에 적는다.** 「왜 이 선수가 없지?」에 답할 수 없으면 목록이 아니라 인상이다
    `各試合の下に出るのは「${d.starRule}」に当てはまった記録です。多いときは1試合${d.starLimit}人までにしています。` +
      "得点・安打・失策はその試合の公表記録、投手成績は当サイトの再計算です。",
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}index.html">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}compare.html">選手をくらべる</a>
</nav>`;

  return page({
    title: `試合${d.gameDate === null ? "" : ` — ${fullDate(d.gameDate)}`}`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "today",
    body,
  });
}
