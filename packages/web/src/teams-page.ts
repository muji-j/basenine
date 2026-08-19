/**
 * 구단 목록.
 *
 * ⚠**이 화면이 없어서 내비에 구단이 없었다.** 구단 페이지는 순위표에서 팀명을 눌러야만 닿았고,
 * 팬이 가장 자주 볼 화면으로 가는 길이 가장 멀었다.
 * ⚠**JS 가 없어도 여기서 구단으로 간다**(§0-1). 최애 지정만 스크립트의 일이다.
 * ⚠**로고·엠블럼을 쓰지 않는다**(§6) — 구단 색 마크만 쓴다.
 *
 * ⚠**격자로 만들지 않는다**(§6 「AI틱함」 금지 목록의 「균질한 카드 그리드」).
 * 이 화면이 나르는 것은 12개의 동등한 타일이 아니라 **두 리그 × 순위 순서**다 —
 * 격자는 그 순서를 지운다. 그래서 리그마다 `<ol>` 한 줄기로 세우고,
 * 순위·승패·다음 경기가 **왼쪽에서 오른쪽으로 한 줄**에 흐른다.
 * 순서는 마크업에도 남는다(`ol` · `data-rank`) — 낭독기에도 「몇 위인가」가 먼저 들린다.
 *
 * ⚠**여기서 지표를 계산하지 않는다**(M1). 순위·승률·게임차·최근10 은 전부
 * `teamStandings`(aggregate)가 만든 값이고, 다음 경기 문장과 게임차 문장은
 * 구단 페이지와 **같은 함수**에서 나온다(`team-page.ts`).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, fullDate } from "./format.ts";
// ⚠**동률 규칙 문장은 순위표와 공유한다**(M1) — 두 화면이 같은 사실을 다르게 말하지 않게
import { TIE_RULE, note, valueWithDen } from "./parts.ts";
// ⚠**분모 단위의 정본**(M1) — 화면이 문자열을 직접 적지 않는다
import { denUnit } from "./glossary.ts";
import { page } from "./layout.ts";
import type { RenderContext } from "./layout.ts";
// ⚠**경로는 `layout.ts` 한 곳에서 나온다**(M1) — 내비도 같은 값을 쓴다
import { ROSTER_PATH, TEAMS_PATH } from "./layout.ts";
import { gamesBehindText, nextGameText, teamPath } from "./team-page.ts";
import type { TeamNextGame } from "./team-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";

/**
 * 한 구단의 칸.
 *
 * ⚠**전부 이미 계산이 끝난 값이다**(M1). 이 화면은 지표를 만들지 않는다 —
 * 순위표(`StandingRow`)와 구단 페이지(`TeamPageData`)가 쓰는 것과 같은 한 벌에서 온다.
 */
export interface TeamsCard {
  teamCode: string;
  /** 정식 표기(「阪神タイガース」). 카드에는 이쪽을 낸다 — 여기는 넓다 */
  name: string;
  /**
   * 짧은 표기(「阪神」).
   * ⚠**최애 버튼이 이 값을 들고 나간다**(`data-favname`). 클라이언트는 구단 마스터를
   * 모르므로, 없으면 내비 라벨이 **`T` 처럼 코드 대문자**로 떨어진다 — 조용한 열화다.
   */
  shortName: string;
  color: TeamColor;
  /** 순위. ⚠**경기가 없으면 `null` 이다** — 0位라고 쓰지 않는다(M11) */
  rank: number | null;
  /** 동률이면 화면이 「同」이라고 말한다(M3) */
  tiedRank: boolean;
  games: number;
  w: number;
  l: number;
  t: number;
  /** 勝率. ⚠**분모는 `勝+敗`**(무승부 제외 · NPB 규정). 결판난 경기가 없으면 `null` */
  pct: number | null;
  /** 1위와의 게임 차. 1위는 0 */
  gamesBehind: number;
  last10: { w: number; l: number; t: number };
  /** 다음 경기. 없으면 `null`(시즌 종료 · 일정 미취득) */
  next: TeamNextGame | null;
  /**
   * 이 시즌이 끝났는가.
   * ⚠**`next === null` 의 이유를 가르는 유일한 값이다**(M12) —
   * 「끝났다」와 「아직 안 받았다」가 같은 화면이면 그것 자체가 결함이다.
   */
  seasonOver: boolean;
}

/** 한 리그. ⚠**순위 순서 그대로 들어온다** — 이 화면이 다시 정렬하지 않는다(M1) */
export interface TeamsLeague {
  id: string;
  name: string;
  teams: TeamsCard[];
}

export interface TeamsPageData {
  season: number;
  asOf: string | null;
  /** 센트럴 → 퍼시픽. 경기가 없는 시즌이면 빈 배열이고, 화면이 그렇게 말한다(M12) */
  leagues: TeamsLeague[];
}

/** 승패분 표기 `58-46-1`. 무승부가 0이어도 자리를 비우지 않는다 — 열이 흔들린다 */
function wlt(x: { w: number; l: number; t: number }): string {
  return `${x.w}-${x.l}-${x.t}`;
}

/**
 * 한 구단의 줄.
 *
 * ⚠**주석을 `<!-- -->` 로 쓰지 않는다.** 이 함수는 페이지마다 12번 도는데,
 * HTML 주석은 산출물에 12번 다 실린다 — 실측으로 26.5KB 중 약 6KB(23%)가 그것이었고
 * 9시즌이면 그냥 낭비다. **왜는 여기(소스)에 남기고, 나가는 것은 마크업만 남긴다.**
 *
 * ⚠**카드 전체를 `<a>` 로 감싸지 않는다.** 안에 최애 버튼이 있어서 —
 * `<a>` 안의 `<button>` 은 유효하지 않은 HTML 이고, 실제로도 버튼을 누를 때마다
 * 링크가 함께 발화한다. **구단 페이지로 가는 길은 이름 링크**이고, 버튼은 그 옆이다.
 * ⚠**순위를 구단 색으로 칠하지 않는다**(구단 페이지가 실측으로 이미 밟은 자리) —
 * 글자색에는 `--team-ink` 같은 짝이 없어 어느 구단이든 한쪽 테마에서 무너진다.
 * 색은 이름 옆의 사각 마크에만 쓰고, 그 마크에는 테두리를 준다(색이 안 보여도 형태는 남는다).
 *
 * 줄에 들어가는 것:
 * - **순위** — ⚠경기가 없으면 `0位` 가 아니라 「모름」이다(M11).
 * - **승패분 · 승률 · 게임차 · 최근10** — ⚠승률에는 분모(`勝+敗`)가 값에 붙어 나간다(M2).
 * - **다음 경기** — ⚠없어도 줄을 지우지 않는다(M12). 문장은 구단 페이지와 같은 한 벌이다(M1).
 * - **최애 버튼** — ⚠`data-favname` 을 반드시 붙인다. 클라이언트는 구단 마스터를 모르고,
 *   없으면 내비 라벨이 코드 대문자(「T」)로 떨어진다 — 화면은 멀쩡해서 눈으로는 안 잡힌다.
 *   ⚠**`data-favpath` 도 같이 붙인다**(2026-08-19 T9). 경로는 `teamPath()` 한 곳에서만 나오는데
 *   (M1 · 「갈리면 어딘가는 404다」) **번들은 그 함수 밖에 있다.** 클라이언트가 코드로 경로를
 *   이어 붙이면 경로 규칙이 바뀌는 날 내비만 조용히 404 가 된다 — 서버가 만든 값을 실어 보낸다.
 *   ⚠**`hidden` 으로 두지 않는다.** 선수 페이지의 즐겨찾기 버튼은 스크립트가 켜 주지만
 *   이쪽은 켜 주는 코드가 없다 — 숨기면 기능이 통째로 죽은 채 조용히 남는다.
 *   그 대신 **각주가 「이 브라우저에만 남는다 · JS 가 필요하다」고 말한다.**
 *   ⚠**이름에 구단을 넣는다.** 한 화면에 같은 이름의 버튼이 12개면 낭독기에서
 *   구별할 방법이 사라진다 — 「ひいき球団」만 열두 번 들린다.
 *   ⚠**`aria-label` 을 쓰지 않는다.** 보이는 글자가 이름 안에 있어야 하고(WCAG 2.5.3),
 *   무엇보다 **클라이언트가 라벨을 갱신하지 않는다**(T9) — 「…にする」 같은 동작형 라벨을
 *   넣으면 눌린 뒤에 거짓말이 된다. 숨은 글자를 덧붙이면 두 상태에서 모두 참이다.
 */
function teamRow(c: TeamsCard, base: string): RawHtml {
  return html`<li class="tcard"${
    // ⚠**순위를 마크업에도 남긴다.** 1위 강조가 `:first-child` 로는 틀린다 — 동률 1위가 둘일 수 있다.
    //   ⚠`class` 에 붙이지 않는다: 이 줄을 세는 시험이 `class="tcard"` 를 본다.
    //   ⚠**속성을 raw() 안에서 문자열로 짓지 않는다**(2026-08-18 감사 P3 · layout.ts 가 같은 말을 적어 뒀다).
    //   그 안의 값은 이스케이프를 거치지 않는다 — 따옴표 하나로 속성이 끊긴다.
    //   지금은 `rank: number | null` 이라 타입이 막지만, **다음 사람이 문자열 필드를 얹으면 뚫린다.**
    //   조각째 `html` 에 넘기면 그 자리가 영구히 이스케이프를 거친다.
    c.rank === null ? raw("") : html` data-rank="${c.rank}"`
  } style="--chip:${c.color.base}">
  <p class="tcr">${c.rank === null
    ? html`<b>${NO_VALUE}</b>`
    : html`<b>${c.rank}</b><s>位${c.tiedRank ? "（同）" : ""}</s>`}</p>
  <p class="tcn"><a href="${base}${teamPath(c.teamCode)}"><i></i>${c.name}</a></p>
  <p class="tcs">
    <span class="tcv"><s>勝敗分</s><b>${wlt(c)}</b></span>
    <!-- ⚠**「試合」이 아니다** — 분모는 勝+敗 다(무승부 제외). 단위의 정본은 glossary.ts 다(M1) -->
    <span class="tcv"><s>勝率</s><b>${valueWithDen({ value: c.pct, denominator: c.w + c.l }, denUnit("winPct"), 3)}</b></span>
    <span class="tcv"><s>ゲーム差</s><b>${gamesBehindText(c.rank, c.gamesBehind)}</b></span>
    <span class="tcv"><s>直近10試合</s><b>${wlt(c.last10)}</b></span>
  </p>
  <p class="tcx"><s>次の試合</s><b>${nextGameText(c.next, c.seasonOver)}</b></p>
  <p class="tcf"><button class="favt" type="button"
    data-favteam="${c.teamCode}" data-favname="${c.shortName}" data-favpath="${teamPath(c.teamCode)}"
    aria-pressed="false">ひいき球団<span class="vh"> ${c.shortName}</span></button></p>
</li>`;
}

export function renderTeamsPage(d: TeamsPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths(TEAMS_PATH);
  const count = d.leagues.reduce((n, l) => n + l.teams.length, 0);

  const body = html`<header class="idline">
  <div class="idtext">
    <!-- ⚠**고르는 화면이라고 말한다.** 날짜 일람(「日付をえらぶ」)과 같은 어법이다 —
         내비 라벨은 「球団」이지만, 이 화면에서 할 일은 **하나를 고르는 것**이다 -->
    <h1 class="nm">球団をえらぶ</h1>
    <span class="sub">${d.season}年${count === 0 ? "" : ` · ${count}球団 · 順位順`}</span>
    <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
  </div>
</header>

${d.leagues.length === 0
    ? html`<section class="block"><p class="empty">このシーズンの順位はまだ計算できていません。</p></section>`
    : html`${d.leagues.map(
      // ⚠**순서가 뜻인 목록은 `ol` 이다** — 낭독기에도 「몇 번째인가」가 남는다
      (lg) => html`<section class="block" id="b-lg-${lg.id}">
  <h2>${lg.name}<span class="qt">${lg.teams.length}球団 · 順位順</span></h2>
  <ol class="tlist">${lg.teams.map((c) => teamRow(c, base))}</ol>
</section>`,
    )}`}

${note(
    // ⚠**규칙이 코드에만 있으면 아무도 검증할 수 없다**(M3). 무엇으로 줄을 세웠는지,
    //   승률이 무엇을 세고 무엇을 안 세는지, 그리고 최애가 어디에 남는지를 화면이 말한다
    // ⚠**동률 규칙은 순위표와 같은 한 벌을 쓴다**(M1 · 2026-08-19 T7 검토 ⓓ).
    //   여기에 다시 쓰면 두 화면이 같은 사실을 다르게 공시한다 — 실제로 그랬다
    //   (이 화면만 「前年度順位는 판정하지 않는다」를 빠뜨리고 있었다).
    "並びは**順位順**です。順位は**勝率**（勝÷（勝＋敗）・引き分けは分母に入れません・NPBの規定）で決まります。" +
      TIE_RULE +
      "この画面では同順位に「（同）」を付けています。" +
      "数字は**レギュラーシーズン**のものです。" +
      // ⚠**해제 방법을 말한다**(2026-08-19 T9 검토 ①). 지정하면 내비 첫 항목이 구단 상세로 바뀌므로
      //   이 화면(= 해제 버튼이 있는 유일한 화면)으로 오는 길이 사용자 눈에서 사라진다.
      //   구단 상세에 「球団一覧を見る」를 넣어 길은 이었지만, **끄는 방법 자체를 안 쓰면
      //   기능은 여전히 「한 번 누르면 끝」로 보인다.**
      "「ひいき球団」を選ぶと**上のメニューの一番左**がその球団になります — " +
      "**もう一度押すと解除**され、ほかの球団を押すと**そちらに切り替わり**ます" +
      "（解除はこの画面のボタンからです。球団ページの「**球団一覧を見る**」でここに戻れます）。" +
      "この設定は**このブラウザにだけ**残り、サーバーには送られません（JavaScript が必要です）。",
  )}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}today.html">試合</a>
</nav>`;

  return page({
    title: `球団をえらぶ — ${d.season}年`,
    base,
    root,
    seasons,
    // ⚠**한 구단의 화면이 아니다** — 여기서 어느 구단 색을 쓰면 그 구단을 편든다
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    /**
     * ⚠**이 화면이 `球団` 항목의 바로 그 문서다** — 그래서 `navExact` 를 두지 않는다
     * (기본값이 `aria-current="page"`).
     *
     * T7 은 내비에 항목이 없던 동안 `nav: "ranking"`(navExact:false)으로 임시로 두고 있었다.
     * 그대로 두면 「지금 여기」가 **順位** 를 가리켜, 이 화면에 있는 사람에게 틀린 자리를 알려준다.
     */
    nav: "team",
    body,
  });
}
