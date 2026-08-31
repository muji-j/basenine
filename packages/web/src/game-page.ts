/**
 * 경기 한 판.
 *
 * ## ⚠이 화면이 원본을 대체하지 않는 방법 (L2·L3·L6)
 *
 * 경기 페이지는 이 서비스에서 **원본에 가장 가까워지기 쉬운 화면**이다. 세 가지로 선을 긋는다.
 *
 * 1. **이닝별 득점을 대조한다.** ⚠**「옮기지 않는다」고 쓰지 않는다** — 계산 구조상
 *    이 값은 라인스코어와 **항상 같은 수**가 된다. 우리가 하는 일은 대조이고,
 *    **어긋나면 화면이 그 사실을 먼저 말한다.**
 * 2. **전 타석 중계를 옮기지 않는다.** 그건 원본의 표현물이다. 우리는 **득점 장면**과
 *    **경기를 움직인 타석**만 고르고, 고르는 기준(득점기대치)은 우리 것이다.
 *    타석 표기는 기록의 표준 기호(`右越本④`)를 쓴다 — 중계 문장이 아니다.
 * 3. **원본으로 가는 링크를 둔다**(L3). 가리키는 것이지 대체하는 것이 아니다.
 *
 * ## ⚠0과 「치지 않았다」를 구별한다 (M11)
 *
 * 홈 팀이 앞서면 9회말을 치지 않는다 — 실측 1,487경기 중 **674경기**가 그렇다.
 * 거기에 `0`을 찍으면 **절반의 페이지가 야구를 아는 사람에게 고장으로 보인다.** `x`로 그린다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, fullDate, signed1 } from "./format.ts";
import { note, scroller, term } from "./parts.ts";
import { page, ROSTER_PATH } from "./layout.ts";
// ⚠**구단 페이지가 없는 코드(올스타 cl/pl)에는 링크를 만들지 않는다** — teamLink 가 그 판정을 쥔다(M1)
import { teamLink } from "./team-page.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";
import type { HalfInning } from "@bb-app/aggregate";

export interface GameSide {
  teamCode: string;
  name: string;
  shortName: string;
  color: TeamColor;
  runs: number;
  hits: number | null;
  errors: number | null;
}

export interface PlayerRef {
  playerId: string;
  name: string;
}

export interface GamePlayView {
  inning: number;
  half: "top" | "bottom";
  outsBefore: number;
  bases: string;
  batter: PlayerRef | null;
  pitcher: PlayerRef | null;
  /** 기록의 표준 기호 표기(`右越本④`) */
  rawBox: string | null;
  rbi: number;
  runsScored: number;
  /** 득점기대치의 변화. 없으면 null(**0이 아니다**) */
  swing: number | null;
  awayScore: number;
  homeScore: number;
}

export interface GamePageData {
  gameId: string;
  gameDate: string;
  venue: string | null;
  /** 대회 표기 원문(`JERA セ・リーグ公式戦`) */
  series: string | null;
  away: GameSide;
  home: GameSide;
  innings: HalfInning[];
  /** ⚠복원 합계와 공표 득점이 맞는가. false면 화면이 먼저 말한다 */
  reconciles: boolean;
  scoringPlays: GamePlayView[];
  keyPlays: GamePlayView[];
  /** 「경기를 움직인 타석」을 몇 개까지 내는가. **화면에 적는다** */
  keyPlayLimit: number;
  win: PlayerRef | null;
  lose: PlayerRef | null;
  save: PlayerRef | null;
  /** 원본 페이지(L3) */
  sourceUrl: string;
}

/**
 * 경기 ID → 파일 이름.
 *
 * ⚠**규칙을 한 곳에만 둔다**(M1의 정신). 링크를 만드는 쪽과 파일을 쓰는 쪽이 따로 계산하면
 * 언젠가 어긋나고, 그때 생기는 것은 오류가 아니라 **404**다 — 조용하고 발견이 늦다.
 */
export function gameSlug(gameId: string): string {
  return gameId.replace(/\//g, "-");
}

/** 경기일 하나의 상세 페이지 경로 */
export function gameDayPath(date: string): string {
  return `games/${date}.html`;
}

/** 한 경기의 앵커 id. **파일 안의 이름도 한 벌에서 나온다** */
export function gameAnchor(gameId: string): string {
  return `g-${gameSlug(gameId)}`;
}

/**
 * 경기 → **링크 경로**(`base` 뒤에 붙인다).
 *
 * ⚠**경기 하나에 파일 하나였던 것을 경기일 하나에 파일 하나로 바꿨다**(2026-08-26 · 감사 P3 #41).
 * Cloudflare Pages 의 배포당 파일 상한(20,000)에 여유가 **2.61시즌**밖에 없었고,
 * 경기 페이지가 배포물의 **48.6%(7,502장)** 였다. 지금은 **1,531장**이 된다.
 * 설계와 기각한 안은 `docs/superpowers/specs/2026-08-26-game-pages-by-date-design.md`.
 *
 * ⚠**날짜를 슬러그에서 유도하지 않는다.** 한때 그렇게 만들었다가 되돌렸다 —
 * 유도는 ⑴ **npb.jp 의 ID 형식이 영원하다고 가정**하고, ⑵ 형식이 다르면 **그리는 중에 던져서**
 * 그 화면이 통째로 안 나온다. `gameDate` 는 실재하는 필드다.
 *
 * ⚠**그래서 「링크와 파일이 갈릴 수 있다」가 남는다.** 그것을 막는 것은 **링크 검사**다 —
 * 빌드가 만들어진 파일에 대해 **앵커까지 포함해** 전 링크를 확인하고, 어긋나면 멈춘다.
 * 날짜를 잘못 넘기면 죽은 링크가 되고 **빌드가 거기서 선다.**
 *
 * ⚠**이미 슬러그가 된 값을 넣어도 안전하다** — 슬러그에는 `/` 가 없으므로 두 번 걸어도 같다.
 */
export function gamePath(gameDate: string, gameId: string): string {
  return `${gameDayPath(gameDate)}#${gameAnchor(gameId)}`;
}

/** 주자 상황의 일본어 표기. **화면과 스크린리더가 같은 말을 쓴다** */
export const BASE_LABEL: Readonly<Record<string, string>> = {
  "": "走者なし",
  "1": "一塁",
  "2": "二塁",
  "3": "三塁",
  "12": "一二塁",
  "13": "一三塁",
  "23": "二三塁",
  "123": "満塁",
};

export function baseLabel(bases: string): string {
  return BASE_LABEL[bases] ?? bases;
}

/** `2死 満塁` */
export function situationLabel(outs: number, bases: string): string {
  return `${outs}死 ${baseLabel(bases)}`;
}

/**
 * 주자 상황의 다이아몬드.
 *
 * ⚠**이 그림이 이 화면의 축이다.** 「2死 満塁」를 글자로만 두면 훑을 때 눈에 안 들어오고,
 * 야구를 보는 사람의 머릿속에 있는 모양과도 다르다. 우리 데이터로 그린 우리 그림이라
 * 로고·사진 금지(§6)에도 걸리지 않는다.
 *
 * ⚠**색으로만 구별하지 않는다.** 채워진 베이스는 칠하고, 빈 베이스는 테두리만 둔다.
 * 아웃 카운트는 아래에 점으로 센다.
 * ⚠**여기 「명도 차이로도 읽힌다」고 적혀 있었는데 실측이 반박했다**(2026-08-19 감사 · 2026-08-20).
 * 그때는 채운 베이스의 **테두리까지 구단 색**이라, 구단 색과 배경의 명도가 가까우면
 * 면과 선이 **동시에** 사라져 「주자 있음」이 「베이스가 아예 없음」으로 보였다 —
 * WCAG 1.4.11(3:1) 기준 **12구단 전부가 한쪽 테마에서 미달**(다크 オリックス 1.08 · ロッテ 1.10,
 * 라이트 阪神 1.61 · ソフトバンク 1.64). 명도 차이는 **구단 색에 달려 있어서 보장되지 않는다.**
 * → 지금은 CSS 쪽(.dia .db.on)에서 **면만 구단 색, 윤곽은 --tx · 굵기 2.0** 으로 나눴다.
 * 읽히는 근거는 색이 아니라 **선의 굵기와 대비**다.
 * ⚠**`aria-label`로 같은 말을 낸다.** 그림만 있으면 읽어 주는 화면에서 상황이 사라진다.
 */
export function basesMark(bases: string, outs: number, size = 34): RawHtml {
  const on = (b: string): boolean => bases.includes(b);
  // 다이아몬드: 2루가 위, 1루가 오른쪽, 3루가 왼쪽. 본루는 그리지 않는다(타자가 서 있는 자리다)
  const s = size;
  const half = s / 2;
  const r = s * 0.15;
  const spots: [string, number, number][] = [
    ["2", half, s * 0.2],
    ["1", s * 0.78, half * 0.95],
    ["3", s * 0.22, half * 0.95],
  ];
  return html`<svg class="dia" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img"
  aria-label="${situationLabel(outs, bases)}">
  ${spots.map(
    ([b, x, y]) => html`<rect class="db ${on(b) ? "on" : ""}" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}"
      width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}"
      transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"></rect>`,
  )}
  ${[0, 1, 2].map(
    (i) => html`<circle class="do ${i < outs ? "on" : ""}" cx="${(half + (i - 1) * s * 0.16).toFixed(1)}"
      cy="${(s * 0.88).toFixed(1)}" r="${(s * 0.048).toFixed(1)}"></circle>`,
  )}
</svg>`;
}

/** `6回裏` */
export function inningLabel(inning: number, half: "top" | "bottom"): string {
  return `${inning}回${half === "top" ? "表" : "裏"}`;
}

/**
 * 이닝별 득점표.
 *
 * ⚠**`0`과 `x`를 구별한다**(M11). `x`는 「공격이 없었다」이지 「0점」이 아니다.
 * ⚠**득점이 난 칸을 강조한다.** 이 표에서 눈이 찾는 것은 숫자가 아니라 **어디서 점수가 났는가**다.
 */
function inningTable(d: GamePageData, base: string): RawHtml {
  const innings = [...new Set(d.innings.map((i) => i.inning))].sort((a, b) => a - b);
  const cell = (inning: number, half: "top" | "bottom"): RawHtml => {
    const h = d.innings.find((x) => x.inning === inning && x.half === half);
    if (h === undefined || !h.batted) {
      // ⚠공격이 없던 이닝. 「0」이 아니다
      return html`<td class="x" aria-label="攻撃なし">x</td>`;
    }
    return html`<td class="${h.runs > 0 ? "sc" : ""}">${h.runs}</td>`;
  };
  const row = (side: GameSide, half: "top" | "bottom"): RawHtml => html`<tr style="--chip:${side.color.base}">
    <th class="l tm" scope="row"><i></i>${teamLink(base, side.teamCode, side.shortName)}</th>
    ${innings.map((i) => cell(i, half))}
    <td class="tot">${side.runs}</td>
    <td>${side.hits ?? NO_VALUE}</td>
    <td>${side.errors ?? NO_VALUE}</td>
  </tr>`;

  return scroller(html`<table class="iscore" aria-label="イニングスコア">
    <thead><tr><th class="l">球団</th>${innings.map((i) => html`<th>${i}</th>`)}<th class="tot">計</th><th>H</th><th>E</th></tr></thead>
    <tbody>${row(d.away, "top")}${row(d.home, "bottom")}</tbody>
  </table>`);
}

function playRow(p: GamePlayView, d: GamePageData, base: string, widest: number): RawHtml {
  const side = p.half === "top" ? d.away : d.home;
  return html`<li class="play" style="--chip:${side.color.base}">
  <span class="pin">${inningLabel(p.inning, p.half)}</span>
  <span class="pdia">${basesMark(p.bases, p.outsBefore)}</span>
  <span class="pwho">${p.batter === null
    ? html`<b>${NO_VALUE}</b>`
    : html`<a href="${base}players/${p.batter.playerId}.html">${p.batter.name}</a>`}
    ${p.pitcher === null
      ? null
      : html`<s>対 <a href="${base}players/${p.pitcher.playerId}.html">${p.pitcher.name}</a></s>`}</span>
  <span class="pres">${p.rawBox ?? NO_VALUE}${p.runsScored > 0
    ? html`<em class="${p.rbi === 0 ? "norbi" : ""}">${p.runsScored}点${p.rbi === 0 ? html`<s>打点なし</s>` : null}</em>`
    : null}</span>
  <span class="psc">${p.awayScore}-${p.homeScore}</span>
  ${p.swing === null
    ? html`<span class="pswing none">${NO_VALUE}</span>`
    : html`<span class="pswing"><b>${signed1(p.swing)}</b><i class="${p.swing >= 0 ? "p" : "n"}"
        style="--w:${((Math.abs(p.swing) / widest) * 100).toFixed(1)}"></i></span>`}
</li>`;
}

/**
 * **경기 한 판의 본문.** 한 문서에 여럿이 들어간다(경기일 하나에 파일 하나 · 감사 P3 #41).
 *
 * ⚠**`h1` 이 아니라 `h2` 로 시작한다** — 문서의 `h1` 은 그 날짜이고, 경기는 그 아래다.
 * ⚠**구획 id 를 경기마다 다르게 준다.** 예전에는 `b-score`·`b-key`·`b-scoring` 고정이었는데,
 * 한 문서에 경기가 여섯이면 **같은 id 가 여섯 번** 나온다. 참조하는 곳은 0건이었지만
 * 중복 id 는 그 자체로 깨진 문서다.
 * ⚠**원본 링크(L3)는 경기마다 남긴다** — 가리키는 대상이 경기별로 다르다.
 */
export function gameSection(d: GamePageData, base: string): RawHtml {
  const anchor = gameAnchor(d.gameId);
  const winner = d.away.runs === d.home.runs ? null : d.away.runs > d.home.runs ? "away" : "home";
  const widest = Math.max(0.5, ...d.keyPlays.map((p) => Math.abs(p.swing ?? 0)));

  const scoreSide = (side: GameSide, won: boolean): RawHtml => html`<div class="gbside${won ? " w" : ""}"
  style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <span class="gbt"><i></i>${teamLink(base, side.teamCode, side.name)}</span>
  <span class="gbr">${side.runs}</span>
</div>`;

  const decision = (label: string, p: PlayerRef | null): RawHtml =>
    p === null
      ? raw("")
      : html`<span class="gd"><b>${label}</b><a href="${base}players/${p.playerId}.html">${p.name}</a></span>`;

  return html`<article class="gamedetail" id="${anchor}">
<header class="idline">
  <div class="idtext">
    <h2 class="nm">${d.away.shortName} ${d.away.runs}-${d.home.runs} ${d.home.shortName}</h2>
    <span class="sub">${d.venue ?? ""}${d.series === null ? "" : ` · ${d.series}`}</span>
  </div>
</header>

<section class="block" id="${anchor}-score">
  <div class="gbig">
    ${scoreSide(d.away, winner === "away")}
    ${scoreSide(d.home, winner === "home")}
  </div>
  ${winner === null ? html`<p class="gtie2">引き分け</p>` : raw("")}
  ${d.win === null && d.lose === null && d.save === null
    ? raw("")
    : html`<p class="gdec">${decision("勝", d.win)}${decision("負", d.lose)}${decision("S", d.save)}</p>`}

  ${d.reconciles
    ? raw("")
    : html`<p class="cmpwarn" role="status">この試合のイニング別得点は、当サイトの打席ログから組み直した数字と
      公表されている合計が一致していません。下の表は参考値として扱ってください。</p>`}

  ${inningTable(d, base)}
  ${note(
    // ⚠**어디서 온 숫자인지 말한다**(M4·L2). 원본 표를 옮긴 것이 아니라 우리가 조립한 것이다
    // ⚠**「원본을 옮긴 것이 아니다」라고 쓰지 않는다.** 이닝별 득점은 계산 구조상
    // 라인스코어와 **항상 같은 수**가 된다(반이닝 마지막 타석을 라인스코어로 닫으므로).
    // 검증되지 않은 안전 주장을 화면에 두면, 나중에 그 문장을 근거로 판단할 때 판단이 틀린다.
    // 대신 **실제로 하는 일**을 적는다 — 대조한다는 것.
    "イニング別の得点は公表されている記録の値で、当サイトは打席ごとのログから組み直した合計と" +
      "一致するかを毎回つき合わせています（下に不一致の表示が出ていなければ一致しています）。" +
      "「x」はその回に攻撃がなかったことを表します — 0点とは違います。安打・失策は公表記録です。",
  )}
</section>

${d.keyPlays.length === 0
    ? raw("")
    : html`<section class="block" id="${anchor}-key">
  <h2>試合を動かした打席<span class="qt">上位${d.keyPlayLimit}打席</span></h2>
  <ul class="plays">${d.keyPlays.map((p) => playRow(p, d, base, widest))}</ul>
  ${note(
    "右の数字は、その打席で「これから入りそうな点」がどれだけ動いたかです（" +
      "当サイトのアーカイブから計算した得点期待値の変化）。" +
      "⚠打席の状況の重さを表す数字で、選手の実力を表すものではありません。守備の貢献は含みません。" +
      // ⚠**분리할 수 없다는 사실을 숨기지 않는다.** 원천 기록에 주루가 별도 행으로 없다
      "また、その打席の**間に**起きた走塁（暴投・盗塁など）で入った点も同じ欄に入ります — " +
      "元の記録が打席単位でしか公表されておらず、打撃と走塁を分けられないためです。" +
      "「打点なし」と書かれた得点がそれにあたります。",
  )}
</section>`}

${d.scoringPlays.length === 0
    ? html`<section class="block"><h2>得点した場面</h2><p class="empty">この試合に得点はありませんでした。</p></section>`
    : html`<section class="block" id="${anchor}-scoring">
  <h2>得点した場面<span class="qt">${d.scoringPlays.length}回</span></h2>
  <ul class="plays">${d.scoringPlays.map((p) => playRow(p, d, base, widest))}</ul>
</section>`}

<p class="note"><a href="${d.sourceUrl}" rel="noreferrer noopener">この試合の記録を NPB 公式サイトで見る</a></p>
</article>`;
}

/**
 * **경기일 하나의 상세 페이지.** 그 날 경기가 전부 이 한 장에 들어간다.
 *
 * ⚠**경기 하나에 파일 하나였다**(2026-08-26 · 감사 P3 #41). Cloudflare Pages 의 배포당
 * 파일 상한(20,000)에 여유가 **2.61시즌**밖에 없었고 경기 페이지가 배포물의 **48.6%(7,502장)** 였다.
 * 묶으면 **1,531장**이 되고 여유가 **약 6.0시즌**이 된다.
 * ⚠**담는 내용은 늘지 않는다 — 묶는 단위만 바뀐다**(L2 경계 그대로).
 *
 * ⚠**「記録について」 각주는 한 장에 한 번**만 낸다. 경기마다 내면 같은 문장이 여섯 번 나오고,
 * 그건 읽는 사람에게도 배포물 크기에도 손해다. **원본 링크는 경기마다** 남는다(L3).
 * ⚠**색은 중립이다** — 한 장에 경기가 여럿이라 승자 구단색을 하나 고를 수 없다.
 */
export function renderGameDayPage(
  date: string,
  games: readonly GamePageData[],
  ctx: RenderContext,
): string {
  const { base, root, seasons } = ctx.paths(gameDayPath(date));

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${fullDate(date)}の試合詳細</h1>
    <span class="sub">${games.length}試合</span>
  </div>
</header>

${games.map((g) => gameSection(g, base))}

<section class="block">
  <h2>この記録について</h2>
  ${note(
    "当サイトは試合の全経過を転載していません。得点の場面と、得点期待値を大きく動かした打席だけを選んで載せています。" +
      "打席の表記（右越本④ など）は記録の標準的な書き方です。" +
      // ⚠**타자가 낸 점이 아닌 것을 타자가 낸 것처럼 보이게 두지 않는다**
      "⚠「打点なし」と付いた得点は、その打席の結果で入った点ではありません — " +
      "打席の間の走塁や失策で入った点で、記録上その打席の欄に置かれます。",
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}today.html">試合</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `${fullDate(date)}の試合詳細`,
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
