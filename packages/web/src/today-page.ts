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
import { page, pastSeasonOf, ROSTER_PATH } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR, shortNameOf } from "@bb-app/domain";
import { gamePath, gameSlug } from "./game-page.ts";
// ⚠`team-page.ts` 도 여기서 `dayHref` 를 가져간다(순환). 둘 다 **함수 선언**이라 호이스팅되고,
// `home-page.ts` ↔ `team-page.ts` 가 이미 같은 모양으로 돌고 있다 — 새로 만드는 형태가 아니다.
import { teamLink } from "./team-page.ts";
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
  /** 予告先発 페이지의 그 경기 구획을 가리키는 앵커. **키는 한 곳에서만 만든다**(M1) */
  anchor: string;
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
  /** 하나 앞의 **경기일**. 달력의 어제가 아니다 — 월요일은 대개 경기가 없다 */
  prev: string | null;
  /** 이 시즌의 경기일 수. 날짜 일람 링크에 붙인다 */
  dayCount: number;
}

/** 지난 날짜 화면. `today.html`과 **같은 카드**를 쓴다(M1) */
export interface DayPageData {
  date: string;
  builtOn: string;
  games: TodayGame[];
  starRule: string;
  starLimit: number;
  prev: string | null;
  next: string | null;
  /** 최신 경기일. **그 날만 `today.html`이 맡는다** */
  latestDate: string | null;
  dayCount: number;
}

/** 그 시즌의 경기일 일람 */
export interface DayIndexData {
  season: number;
  latestDate: string | null;
  days: { date: string; scheduled: number; played: number }[];
}

/**
 * 날짜 하나가 어느 주소인가.
 *
 * ⚠**최신 경기일만 `today.html`이다.** 같은 내용을 두 주소에 두면 「어느 쪽이 진짜인가」가 생기므로
 * 그 날의 `days/` 페이지는 아예 만들지 않는다. 그러니 **링크를 만드는 곳이 한 군데여야** 한다 —
 * 여기서 갈리지 않으면 어딘가는 반드시 404가 된다.
 */
export function dayHref(base: string, date: string, latestDate: string | null): string {
  return date === latestDate ? `${base}today.html` : `${base}days/${date}.html`;
}

/**
 * 앞뒤 경기일과 일람으로 가는 띠.
 *
 * ⚠**없는 방향은 링크가 아니라 지워진 글자로 둔다.** `href` 없는 `<a>`는 초점도 안 받고
 * 눌러도 아무 일이 없어서, 「끝에 왔다」를 조용히 거짓말하지 않는다.
 */
function dayBar(
  base: string,
  o: { prev: string | null; next: string | null; latestDate: string | null; dayCount: number },
): RawHtml {
  // ⚠**방향을 애니메이션이 아니라 형태로 낸다.** 앞뒤 이동은 문서가 바뀌는 이동이라
  // 화면 전환으로 방향을 말하려면 브라우저를 가린다. 화살표는 어디서나 보이고 인쇄에도 남는다
  const step = (date: string | null, label: string, cls: string): RawHtml => {
    const arrow = cls === "p" ? "←" : "→";
    // ⚠**화살표와 라벨을 한 줄로 묶는다.** daystep 은 세로 flex라 묶지 않으면
    // 화살표가 라벨 위 줄로 올라간다(2026-08-16 실물에서 확인)
    const body =
      cls === "p"
        ? html`<span class="dayrow"><i aria-hidden="true">${arrow}</i>${label}</span>`
        : html`<span class="dayrow">${label}<i aria-hidden="true">${arrow}</i></span>`;
    return date === null
      ? html`<span class="daystep ${cls} off">${body}</span>`
      : html`<a class="daystep ${cls}" href="${dayHref(base, date, o.latestDate)}"
          >${body}<s>${fullDate(date)}</s></a>`;
  };
  return html`<nav class="daybar" aria-label="日付">
  ${step(o.prev, "前の試合日", "p")}
  <a class="daypick" href="${base}days.html">日付をえらぶ<s>${o.dayCount}日</s></a>
  ${step(o.next, "次の試合日", "n")}
</nav>`;
}

/**
 * 점수 한 줄.
 *
 * ⚠**어느 쪽이 홈인지가 화면 어디에도 없었다**(2026-08-20 감사 ②). 구장 이름으로 추측하는
 * 수밖에 없었는데, 지방 개최가 있는 이 리그에서 그 추측은 틀린다.
 * ⚠**표식은 구단 페이지·홈 화면과 같은 어법이다**(M1) — 「＠팀」 = 그 팀의 본거지.
 * ⚠**글자만으로 자리를 밀지 않는다.** ＠ 를 이름 앞에 그냥 붙이면 두 줄의 팀명 시작선이
 * 어긋난다 — 자리는 두 줄 다 비워 두고(::before), 글자는 홈에만 넣는다.
 * ⚠**생성 콘텐츠는 낭독되지 않을 수 있다** — 그래서 보이지 않는 글자를 함께 둔다.
 */
function scoreLine(side: TodaySide, won: boolean, home: boolean, base: string): RawHtml {
  return html`<div class="gside${won ? " w" : ""}${home ? " h" : ""}" style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <span class="gt"><i></i>${teamLink(base, side.teamCode, side.shortName)}<span class="vh">（${home ? "ホーム" : "ビジター"}）</span></span>
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

/**
 * ⚠**날짜는 인자로 받는다** — `TodayGame` 에는 날짜가 없고, 이 카드는 today 화면과
 * 날짜 화면이 함께 쓴다. 경기 상세는 **경기일 하나에 파일 하나**라 링크에 날짜가 필요하다.
 *
 * ⚠**날짜를 모르면 링크를 만들지 않는다.** 빈 문자열로 때우면 `games/.html` 이라는
 * 없는 곳을 가리킨다 — 이 파일이 `hasPage` 에서 이미 쓰는 규칙과 같다(M12).
 */
function gameCard(g: TodayGame, base: string, date: string | null): RawHtml {
  if (g.status !== "played") {
    return html`<article class="gcard off">
  <h3 class="gvenue">${g.venue ?? ""}</h3>
  <div class="gscore">
    <div class="gside" style="--chip:${g.away.color.base}"><span class="gt"><i></i>${teamLink(base, g.away.teamCode, g.away.shortName)}<span class="vh">（ビジター）</span></span></div>
    <div class="gside h" style="--chip:${g.home.color.base}"><span class="gt"><i></i>${teamLink(base, g.home.teamCode, g.home.shortName)}<span class="vh">（ホーム）</span></span></div>
  </div>
  <p class="gnone">${g.notPlayedReason ?? "試合なし"}</p>
</article>`;
  }

  const ambiguous = ambiguousNames(g);
  const hits = g.away.hits === null || g.home.hits === null ? null : `${g.away.hits}-${g.home.hits}`;
  const errs =
    g.away.errors === null || g.home.errors === null ? null : `${g.away.errors}-${g.home.errors}`;

  // ⚠**카드 전체를 누를 수 있게 하는 것은 `.gmore`의 링크를 넓히는 것이지 링크를 하나 더 두는 것이 아니다.**
  // 겹쳐 놓으면 스크린리더의 링크 목록에 같은 곳이 두 번 나오고, 탭 이동도 두 번 걸린다.
  // 상세 페이지가 없는 경기는 `link`를 붙이지 않는다 — 눌러도 안 가는데 눌릴 것처럼 보이면 그것이 결함이다
  return html`<article class="gcard${g.hasPage ? " tapcard" : ""}">
  <h3 class="gvenue">${g.venue ?? ""}${g.winner === null ? html`<span class="gtie">引き分け</span>` : null}</h3>
  <div class="gscore">
    ${scoreLine(g.away, g.winner === "away", false, base)}
    ${scoreLine(g.home, g.winner === "home", true, base)}
  </div>
  ${hits === null && errs === null
    ? raw("")
    : html`<p class="ghe">${hits === null ? null : html`<span>安打 <b>${hits}</b></span>`}${errs === null ? null : html`<span>失策 <b>${errs}</b></span>`}</p>`}
  ${decisions(g, base, ambiguous)}
  ${g.stars.length === 0
    ? raw("")
    : html`<ul class="gstars">${g.stars.map(
        (s) => html`<li style="--chip:${g.away.teamCode === s.teamCode ? g.away.color.base : g.home.color.base}">
      <!-- ⚠**막대가 유일한 구단 표시였다**(2026-08-21 감사 P1) — 낭독 화면엔 아무것도 안 들렸다.
           색 밖의 채널을 하나 더 둔다. 보이는 글자로 두면 이 조밀한 줄이 길어지므로,
           보이는 쪽은 CSS 윤곽(assets.ts .gstars li i)이 맡고 여기는 낭독을 맡는다. -->
      <i><span class="vh">${shortNameOf(s.teamCode)}</span></i><a href="${base}players/${s.playerId}.html">${who(s.name, s.teamCode, ambiguous)}</a>
      <span class="gsl">${starText(s)}</span>
      ${s.decision === null ? null : html`<em class="gsd">${DECISION_LABEL[s.decision] ?? s.decision}</em>`}
    </li>`,
      )}</ul>`}
  ${g.hasPage && date !== null
    ? html`<p class="gmore"><a class="cardlink" href="${base}${gamePath(date, g.gameId)}">この試合の詳細<span
      class="vh">（${g.away.shortName} 対 ${g.home.shortName}）</span></a></p>`
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
  return html`<article class="pbcard tapcard">
  <h3 class="gvenue">${p.venue ?? ""}${p.startTime === null ? "" : ` ${p.startTime}`}</h3>
  ${side(p.sides[0])}${side(p.sides[1])}
  <p class="gmore"><a class="cardlink" href="${base}starters.html#${p.anchor}">対戦する打者まで見る<span
    class="vh">（${p.sides[0].shortName} 対 ${p.sides[1].shortName}）</span></a></p>
</article>`;
}

export function renderTodayPage(d: TodayPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("today.html");
  const isToday = d.gameDate !== null && d.gameDate === d.builtOn;
  // ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다.** 기다리는 것이 아니라 끝난 것이다
  const past = pastSeasonOf(seasons);
  const played = d.games.filter((g) => g.status === "played").length;
  const off = d.games.length - played;

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">試合</h1>
    <span class="sub">${d.gameDate === null
      ? "試合の記録がまだありません"
      : `${fullDate(d.gameDate)}${isToday ? "（本日）" : ""}の結果 · ${played}試合${off > 0 ? ` · 中止${off}試合` : ""}`}</span>
  </div>
  <span class="asof">${fullDate(d.builtOn)}生成</span>
</header>

${dayBar(base, { prev: d.prev, next: null, latestDate: d.gameDate, dayCount: d.dayCount })}

<!-- ⚠**구획을 통째로 지우지 않는다**(M12). 예전에는 예고가 없으면 이 구획이 사라져서,
     읽는 사람이 「아직 발표 전」인지 「화면이 고장났는지」를 구별할 수 없었다.
     ⚠그리고 이 구획이 사라지면 **予告先発 화면으로 가는 유일한 길이 함께 사라진다** —
     내비에 항목이 없어서, 예고가 없는 날에는 그 화면에 닿을 방법이 아예 없었다. -->
<section class="block" id="b-probable">
  <h2>次の予告先発<span class="qt">${d.probableDate === null ? "" : fullDate(d.probableDate)}</span></h2>
  ${d.probables.length === 0
    ? html`<p class="empty">${past
      ? "このシーズンの予告先発は記録していません。予告先発の保存を始めたのが今シーズンからです。"
      : "予告先発はまだ発表されていません。発表は前日〜当日です。"}</p>`
    : html`<div class="pbcards">${d.probables.map((p) => probableCard(p, base))}</div>`}
  <p class="note"><a href="${base}starters.html">${d.probables.length === 0
    ? "予告先発のページを見る"
    : "対戦する打者の成績まで見る"}</a></p>
</section>

<section class="block" id="b-results">
  <h2>${d.gameDate === null ? "試合結果" : `${fullDate(d.gameDate)}の結果`}</h2>
  ${/* ⚠**가리킬 「이 날」이 없는데 「이 날」이라고 쓰지 않는다**(M12 · 2026-08-18 감사 P3).
       경기가 하나도 없는 시즌에서는 `gameDate` 자체가 null 이라 「この日」가 가리킬 곳이 없다 —
       그때 「まだ取り込んでいません」이라고 쓰면 **「데이터 없음」과 「수집 실패」가 한 문장에 뭉친다.** */ ""}
  ${d.games.length === 0
    ? html`<p class="empty">${d.gameDate === null
      ? "このシーズンの試合はまだ取り込んでいません。"
      : "この日の試合はまだ取り込んでいません。"}</p>`
    : html`<div class="gcards">${d.games.map((g) => gameCard(g, base, d.gameDate))}</div>`}
  ${note(
    // ⚠**기준을 화면에 적는다.** 「왜 이 선수가 없지?」에 답할 수 없으면 목록이 아니라 인상이다
    `各試合の下に出るのは「${d.starRule}」に当てはまった記録です。多いときは1試合${d.starLimit}人までにしています。` +
      "得点・安打・失策はその試合の公表記録、投手成績は当サイトの再計算です。",
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}compare.html">選手をくらべる</a>
</nav>`;

  return page({
    title: `試合${d.gameDate === null ? "" : ` — ${fullDate(d.gameDate)}`}`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "today",
    body,
  });
}

/**
 * 지난 경기일 화면.
 *
 * ⚠**카드도 「눈에 띈 기록」의 기준도 `today.html`과 같은 것을 쓴다**(M1).
 * 두 벌이 되면 어느 날 한쪽만 고쳐져서 「같은 경기인데 날짜 페이지와 오늘 페이지가 다르다」가 된다.
 * ⚠**予告先発는 싣지 않는다.** 지난 날짜에 「次の予告先発」를 붙이면 그 날의 예고처럼 읽힌다.
 */
export function renderDayPage(d: DayPageData, ctx: RenderContext): string {
  // ⚠**시즌을 바꿀 때 選手一覧으로 보내지 않는다.** 2026-08-13은 2025년에 없지만
  // 「그 시즌의 날짜 일람」은 있다 — 가장 가까운 곳으로 보내는 편이 덜 놀랍다
  const { base, root, seasons } = ctx.paths(`days/${d.date}.html`, {
    path: "days.html",
    label: "日付一覧",
  });
  const played = d.games.filter((g) => g.status === "played").length;
  const off = d.games.length - played;

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${fullDate(d.date)}の試合</h1>
    <span class="sub">${d.games.length === 0
      ? "この日の記録がありません"
      : `${played}試合${off > 0 ? ` · 中止${off}試合` : ""}`}</span>
  </div>
  <span class="asof">${fullDate(d.builtOn)}生成</span>
</header>

${dayBar(base, d)}

<section class="block" id="b-results">
  <h2>${fullDate(d.date)}の結果</h2>
  ${d.games.length === 0
    ? html`<p class="empty">この日の試合は取り込んでいません。</p>`
    : html`<div class="gcards">${d.games.map((g) => gameCard(g, base, d.date))}</div>`}
  ${note(
    `各試合の下に出るのは「${d.starRule}」に当てはまった記録です。多いときは1試合${d.starLimit}人までにしています。` +
      "得点・安打・失策はその試合の公表記録、投手成績は当サイトの再計算です。",
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}today.html">最新の試合</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `${fullDate(d.date)}の試合`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "today",
    // 試合 구획에 있지만 이 문서는 today.html 이 아니다
    navExact: false,
    body,
  });
}

/**
 * 경기일 일람 — 「날짜를 지정해서 본다」의 착지점.
 *
 * ⚠**중지만 있었던 날도 남긴다**(M11). 빼면 그 날이 없었던 것이 되고,
 * 「그날 왜 경기가 없었지?」에 답할 수 없다. 편성과 실시가 다르면 그 사실을 적는다.
 * ⚠**JS에 기대지 않는다.** 여기가 링크 목록인 이유가 그것이다 —
 * 날짜 입력칸으로 만들면 스크립트가 막힌 환경에서 날짜를 지정할 길이 사라진다.
 */
export function renderDayIndexPage(d: DayIndexData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("days.html");
  // 최근이 위로 온다 — 찾는 날은 대개 최근이다
  const desc = [...d.days].reverse();
  const months = new Map<string, typeof desc>();
  for (const day of desc) {
    const key = day.date.slice(0, 7);
    const list = months.get(key);
    if (list === undefined) months.set(key, [day]);
    else list.push(day);
  }
  const played = d.days.reduce((n, x) => n + x.played, 0);
  const off = d.days.reduce((n, x) => n + x.scheduled - x.played, 0);

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">日付をえらぶ</h1>
    <span class="sub">${d.season}年 · ${d.days.length}日 · ${played}試合${off > 0 ? ` · 中止${off}試合` : ""}</span>
  </div>
</header>

${d.days.length === 0
    ? html`<section class="block"><p class="empty">このシーズンの試合はまだありません。</p></section>`
    : html`${[...months].map(
      ([month, list]) => html`<section class="block">
  <h2>${Number(month.slice(5))}月<span class="qt">${list.length}日</span></h2>
  <div class="daygrid">${list.map(
        (day) => html`<a class="dayc${day.date === d.latestDate ? " now" : ""}"
      href="${dayHref(base, day.date, d.latestDate)}">
      <b>${Number(day.date.slice(8))}</b>
      <s>${day.played}試合${day.scheduled > day.played ? html`<em>中止${day.scheduled - day.played}</em>` : null}</s>
    </a>`,
      )}</div>
</section>`,
    )}`}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}today.html">最新の試合</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a>
</nav>`;

  return page({
    title: `日付をえらぶ — ${d.season}年`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "today",
    navExact: false,
    body,
  });
}
