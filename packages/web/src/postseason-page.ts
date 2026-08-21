/**
 * ポストシーズン — **정규시즌과 섞지 않고, 보이지 않게 두지도 않는다.**
 *
 * ⚠**여기가 이 화면의 존재 이유다.** 지금까지 모든 화면이 `competition = 'regular'`로 걸러
 * 클라이맥스시리즈 13경기·일본시리즈 5경기(타석 로그 1,351개)를 **통째로 안 보여줬다.**
 * 데이터는 처음부터 있었다 — 보여줄 자리가 없었을 뿐이다.
 *
 * ⚠**그렇다고 정규시즌에 더하지 않는다**(§2-1). NPB의 타이틀·순위는 정규시즌 성적으로만 겨루고,
 * CS 13경기를 더하는 순간 그 수는 어느 규칙에도 속하지 않는 수가 된다.
 *
 * ⚠**순위를 매기지 않는다.** 표본이 13경기·5경기다. 여기에 「1위」를 붙이면
 * 5타수 3안타가 타율 1위가 된다 — M2·M3가 정확히 막으라고 하는 것이다.
 * 그래서 이 화면은 **출장 순으로 늘어놓기만** 하고, 그 사실을 화면에 적는다.
 *
 * ⚠**리그 상수를 쓰는 지표를 내지 않는다.** wRC+·FIP는 리그 평균이 기준선인데
 * 포스트시즌에는 그 리그가 없다(양 리그가 맞붙는다). 계산이 되더라도 뜻이 없는 수다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { fullDate, innings } from "./format.ts";
import { note, panel, scroller, tablist, term, valueWithDen } from "./parts.ts";
import { page, ROSTER_PATH } from "./layout.ts";
import { teamLink } from "./team-page.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";

/**
 * 대회 전환 탭의 그룹 이름.
 * ⚠**한 곳에서만 만든다** — 탭줄과 패널이 같은 문자열을 써야 짝이 맞는다. 갈리면 아무것도 안 열린다.
 */
const TAB_GROUP = "post";

/**
 * 대회가 둘 이상일 때만 패널로 감싼다.
 * ⚠**하나뿐이면 감싸지 않는다** — 열고 닫을 것이 없는데 `hidden`을 붙이면,
 * 스크립트가 없는 환경에서 그 하나가 통째로 안 보일 위험만 남는다.
 */
function wrap(many: boolean, key: string, first: boolean, body: RawHtml): RawHtml {
  return many ? panel(TAB_GROUP, key, first, body) : body;
}

/** 한 경기 — 날짜·구장·점수. 상세 페이지가 있으면 그리로 간다 */
export interface PostGame {
  /** 화면 링크에 쓰는 파일명 슬러그 */
  gameId: string;
  /**
   * DB의 원래 경기 ID. **경기 페이지가 만들어졌는지 대조할 때만 쓴다.**
   * ⚠슬러그로 대조하면 안 된다 — 슬래시를 바꾼 뒤라 원본과 다른 문자열이다.
   */
  rawGameId: string;
  /** 경기 페이지가 실제로 만들어졌는가. ⚠없는 페이지로 링크하면 404다 */
  hasPage: boolean;
  date: string;
  venue: string | null;
  // ⚠**코드를 함께 둔다** — 이 화면은 올스타(`cl`/`pl`)도 그린다. 그 둘은 구단이 아니라
  // 구단 페이지가 **없다** — `teamLink` 가 그 판정을 쥐고, 코드가 없으면 판정 자체를 못 한다.
  away: { teamCode: string; shortName: string; color: TeamColor; runs: number | null };
  home: { teamCode: string; shortName: string; color: TeamColor; runs: number | null };
  /**
   * 이긴 쪽.
   * ⚠**「무승부」와 「득점을 못 읽음」을 같은 값으로 접지 않는다**(M11).
   * 접으면 결측 경기가 「— : — 引き分け」로 나온다 — 있지도 않은 무승부를 만든다.
   */
  winner: "away" | "home" | "tie" | null;
  /**
   * 「第3戦」의 N. ⚠**우리가 세지 않는다** — npb.jp 슬러그에서 파싱해 저장한 `game.game_no`다.
   * 우리가 세면 4개의 독립 시리즈가 한 줄로 이어져 최대 6경기짜리 파이널에 「第13戦」이 붙는다.
   */
  gameNo: number;
  /** 「CS ファーストステージ」 등. **소스 원문 그대로**(M4). 없으면 null */
  series: string | null;
  /**
   * 화면에서 스테이지를 나눌 때 쓰는 라벨. `series`와 다를 수 있다.
   *
   * ⚠**CS는 `series` 하나로 나뉘지 않는다.** npb.jp의 표기가 セ/パ를 구분하지 않아
   * 「CS ファーストステージ」 한 제목 아래에 **두 리그의 독립 시리즈가 섞이고**
   * 「第1戦」이 연속으로 두 번 나온다(2026-08-16 실측: 巨人-DeNA와 オリックス-日本ハム).
   * 리그는 **팀 코드에서 나온다** — CS는 두 팀이 같은 리그라 새 데이터가 필요 없다.
   * ⚠**日本シリーズには 하면 안 된다** — 양 리그가 맞붙으므로 「어느 리그의 시리즈」가 성립하지 않는다.
   */
  stage: string | null;
}

/** 포스트시즌 한 선수의 성적 한 줄. ⚠**분모를 들고 다닌다**(M2) */
export interface PostBatter {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  games: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  /** 타율. ⚠**값과 분모를 한 덩어리로 든다**(M2) — 타수 0이면 value 가 null 이다(M11) */
  avg: Rate;
}

export interface PostPitcher {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  games: number;
  /** 아웃 카운트. 화면에는 이닝으로 낸다 */
  outs: number;
  h: number;
  hr: number;
  bb: number;
  so: number;
  er: number;
  w: number;
  l: number;
  sv: number;
  /** 방어율. 분모는 아웃 카운트다 */
  era: Rate;
}

/** 한 대회분 */
export interface PostCompetition {
  /** `climaxSeries` 등. 앵커와 탭 키로도 쓴다 */
  id: string;
  /** 화면에 내는 이름 */
  name: string;
  /** 이 대회가 무엇인지 한 줄. ⚠**규칙을 화면에 적는다**(M3의 정신) */
  detail: string;
  games: PostGame[];
  batters: PostBatter[];
  pitchers: PostPitcher[];
}

export interface PostseasonPageData {
  season: number;
  /** 그 시즌에 기록이 있는 대회. 없으면 빈 배열 */
  competitions: PostCompetition[];
}

/** 한 선수의 포스트시즌 요약 — 선수 페이지가 쓴다 */
export interface PostseasonBrief {
  competitionId: string;
  competitionName: string;
  games: number;
  /** 타자면 「12打席」, 투수면 「5.1回」 */
  sampleText: string;
  /** 「.333（9打数3安打）」처럼 값과 분모를 한 덩어리로 */
  line: string;
}

/**
 * 스테이지별로 나눈다.
 *
 * ⚠**클라이맥스시리즈는 하나의 시리즈가 아니다** — セ/パ × ファースト/ファイナル이다.
 * 한 줄로 이으면 「第N戦」이 어느 시리즈의 N인지 알 수 없게 된다.
 *
 * ⚠**인접을 가정하지 않는다.** 전에는 「앞 항목과 라벨이 같으면 같은 그룹」이었는데,
 * SQL의 `ORDER BY game_date, game_id`는 **같은 스테이지가 붙어 들어오는 것을 보장하지 않는다.**
 * 우천으로 한 리그의 스테이지가 밀려 다른 스테이지와 겹치는 날, 같은 제목이 두 번 나온다.
 * 라벨로 모으면 그 가정 자체가 사라진다 — 그룹의 순서는 **첫 등장 순**이다.
 */
function stageGroups(games: readonly PostGame[]): [string, PostGame[]][] {
  const m = new Map<string, PostGame[]>();
  for (const g of games) {
    const label = g.stage ?? "";
    const list = m.get(label);
    if (list === undefined) m.set(label, [g]);
    else list.push(g);
  }
  // 라벨이 하나뿐이면 제목을 붙이지 않는다 — 나눌 것이 없는데 나눈 척하지 않는다
  return m.size <= 1 ? [["", games.slice()]] : [...m];
}

function score(side: PostGame["away"], won: boolean, base: string): RawHtml {
  return html`<div class="gside${won ? " w" : ""}" style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <span class="gt"><i></i>${teamLink(base, side.teamCode, side.shortName)}</span>
  <span class="gr">${side.runs === null ? "—" : side.runs}</span>
</div>`;
}

function gameCard(g: PostGame, base: string): RawHtml {
  const body = html`<h3 class="gvenue">第${g.gameNo}戦<span class="gtie">${fullDate(g.date)}</span></h3>
  <div class="gscore">
    ${score(g.away, g.winner === "away", base)}
    ${score(g.home, g.winner === "home", base)}
  </div>
  <p class="gnone">${g.venue ?? ""}${g.winner === "tie" ? "　引き分け" : ""}</p>`;
  // ⚠상세 페이지가 없으면 카드를 누를 수 있게 만들지 않는다 — 눌러도 안 가는 카드는 결함이다
  return g.hasPage
    ? html`<article class="gcard tapcard">${body}
  <p class="gmore"><a class="cardlink" href="${base}games/${g.gameId}.html">この試合の詳細<span
    class="vh">（第${g.gameNo}戦 ${g.away.shortName} 対 ${g.home.shortName}）</span></a></p>
</article>`
    : html`<article class="gcard">${body}</article>`;
}

function batterTable(rows: PostBatter[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">打者の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th>試合</th><th>${term("打席")}</th>
      <th>打数</th><th>安打</th><th>本塁打</th><th>打点</th><th>四球</th><th>三振</th><th>${term("打率")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr style="--chip:${r.color.base}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td class="l tm"><i></i>${r.shortName}</td>
      <td>${r.games}</td><td class="b">${r.pa}</td><td>${r.ab}</td><td>${r.h}</td>
      <td>${r.hr}</td><td>${r.rbi}</td><td>${r.bb}</td><td>${r.so}</td>
      <td class="wd">${valueWithDen(r.avg, "打数", 3)}</td>
    </tr>`,
    )}</tbody>
  </table>`);
}

function pitcherTable(rows: PostPitcher[], base: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">投手の記録がありません。</p>`;
  return scroller(html`<table>
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th>登板</th><th>投球回</th>
      <th>勝</th><th>敗</th><th>S</th><th>被安打</th><th>被本塁打</th><th>与四球</th><th>奪三振</th>
      <th>自責</th><th>${term("防御率")}</th>
    </tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr style="--chip:${r.color.base}">
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      <td class="l tm"><i></i>${r.shortName}</td>
      <td>${r.games}</td><td class="b">${innings(r.outs)}</td>
      <td>${r.w}</td><td>${r.l}</td><td>${r.sv}</td>
      <td>${r.h}</td><td>${r.hr}</td><td>${r.bb}</td><td>${r.so}</td><td>${r.er}</td>
      <td class="wd">${valueWithDen(r.era, "回", 2)}</td>
    </tr>`,
    )}</tbody>
  </table>`);
}

export function renderPostseasonPage(d: PostseasonPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("postseason.html");
  /**
   * ⚠**대회가 하나뿐이면 탭을 만들지 않는다.**
   * 2026년 8월은 올스타 2경기뿐이다. 거기에 탭줄을 그리면 「고르라」고 해 놓고 고를 것이 없다 —
   * 형태가 내용에 대해 거짓말을 하는 것이고, 스크린리더에는 선택지 1개짜리 탭목록이 읽힌다.
   */
  const many = d.competitions.length > 1;

  const body = html`<header class="idline">
  <div class="idtext">
    <!-- ⚠**있는 것만 이름으로 부른다.** 2026년은 올스타뿐인데 「ポストシーズン」이라고 하면
         화면이 거짓말을 한다 — 올스타는 시즌 중 경기이고 포스트시즌이 아니다 -->
    <h1 class="nm">${d.competitions.some((c) => c.id !== "allStar")
      ? "ポストシーズン"
      : "レギュラーシーズン外の試合"}</h1>
    <span class="sub">${d.season}年 · ${d.competitions.length === 0
      ? "記録がありません"
      : d.competitions.map((c) => `${c.name}${c.games.length}試合`).join(" · ")}</span>
  </div>
</header>

${many
    /**
     * ⚠**탭줄은 `.rail` 안에 둔다** — 이 사이트의 탭줄 5곳이 전부 그렇다.
     * 밖에 두면 좌우 패딩이 0이라 본문만 들여쓰기된 채 탭만 화면 왼쪽 끝에 붙고,
     * **`position:sticky` 도 안 걸린다.** CS 패널은 표가 165행이라, 스티키가 없으면
     * 투수표를 읽다가 日本シリーズ로 바꾸려고 맨 위까지 되돌아가야 한다 —
     * 이 화면을 탭으로 나눈 이유를 반만 이루게 된다.
     * ⚠`scroll` 은 끄고 `.rail` 의 가로 스크롤에 맡긴다 — 둘 다 켜면 스크롤 상자가 이중이 된다.
     */
    ? html`<div class="rail">
  ${tablist(TAB_GROUP, d.competitions.map((c) => ({ id: c.id, label: c.name })), false, "大会の切り替え")}
</div>`
    : raw("")}

${d.competitions.length === 0
    ? html`<section class="block"><p class="empty">このシーズンのポストシーズンはまだ記録していません。</p></section>`
    : html`${d.competitions.map(
      (c, i) => wrap(many, c.id, i === 0, html`<section class="block" id="pc-${c.id}">
  <h2>${c.name}<span class="qt">${c.games.length}試合</span></h2>
  ${note(c.detail)}
  ${stageGroups(c.games).map(
    ([label, games]) => html`${label === "" ? raw("") : html`<h3 class="standname">${label}</h3>`}
  <div class="gcards">${games.map((g) => gameCard(g, base))}</div>`,
  )}

  ${c.batters.length === 0 && c.pitchers.length === 0
    ? note(
      // ⚠**없는 이유를 말한다.** 빈 자리만 두면 「수집이 실패했나」로 읽힌다(M12의 정신)
      "この大会は選手成績を集計していません — 出場は「セ・リーグ」「パ・リーグ」の選抜としてで、" +
        "球団に紐づく成績にならないためです。試合結果のみ残しています。",
    )
    : html`<h3 class="standname">打者</h3>
  ${batterTable(c.batters, base)}
  <h3 class="standname">投手</h3>
  ${pitcherTable(c.pitchers, base)}
  ${note(
    // ⚠**순위가 아니라는 것을 화면이 말한다**(M2·M3). 13경기·5경기짜리 표본이다
    "出場の多い順に並べています。**順位ではありません** — " +
      "ポストシーズンは試合数が少なく、少ない打席の高い率が上に来てしまうためです。" +
      "レギュラーシーズンの成績には加えていません（NPBのタイトルはレギュラーシーズンで争います）。" +
      "リーグ平均を基準にする指標（wRC+・FIP）は出していません — ポストシーズンには「そのリーグ」がありません。",
  )}`}
</section>`),
    )}`}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}today.html">試合</a> · <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a>
</nav>`;

  return page({
    title: `${d.competitions.some((c) => c.id !== "allStar") ? "ポストシーズン" : "レギュラーシーズン外の試合"} — ${d.season}年`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "postseason",
    body,
  });
}

/**
 * 선수 페이지에 붙는 포스트시즌 한 덩어리.
 *
 * ⚠**정규시즌 성적 블록과 섞이지 않게 따로 그린다.** 같은 표에 넣으면 위에서 아래로 읽는 사람이
 * 두 수를 더한 것으로 읽는다.
 */
export function postseasonBrief(rows: readonly PostseasonBrief[], base: string): RawHtml {
  if (rows.length === 0) return raw("");
  return html`<section class="block" id="postbrief">
  <h2>ポストシーズン<span class="qt">レギュラーシーズンとは別です</span></h2>
  <dl class="postrow">${rows.map(
    /**
     * ⚠**대회 이름이 그 대회의 탭으로 간다.**
     * 저쪽 화면은 이제 대회별 탭이라 첫 대회만 열려 있다 — 그냥 `postseason.html`로 보내면
     * 日本シリーズ만 나온 선수의 링크가 **탭을 넣기 전보다 나빠진다.**
     * 앵커가 닫힌 탭 안을 가리켜도 `revealHash`가 조상 패널을 열어 준다.
     */
    (r) => html`<div>
    <dt><a href="${base}postseason.html#pc-${r.competitionId}">${r.competitionName}</a></dt>
    <dd>${r.line}<span class="den">${r.games}試合 ${r.sampleText}</span></dd>
  </div>`,
  )}</dl>
  <p class="note">この数字は<b>上の成績に含まれていません</b>。NPBのタイトル・順位はレギュラーシーズンで争うためです。
    <a href="${base}postseason.html">ポストシーズンの全成績</a></p>
</section>`;
}
