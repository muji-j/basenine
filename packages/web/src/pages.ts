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

/**
 * ⚠**순위 화면이 무겁다 — 알고 남겨 둔다**(2026-08-18 다방면 감사 P2 · 보류).
 *
 * 실측(2026-08-18): `ranking.html` 이 **822KB · DOM 25,851요소**이고 그 대부분이
 * **첫 화면에 안 보이는 패널**이다(지표마다 표를 미리 다 그려 두고 탭으로 여닫는다).
 *
 * ⚠**전송량은 문제가 아니었다.** 감사는 비압축 822KB 로 셌지만 Cloudflare 는 브로틀리로 보낸다 —
 * **실측 gzip 53KB · brotli 32KB** 다. 같은 이유로 比較 샤드도 208KB 가 아니라 **brotli 17KB** 다.
 * 남는 진짜 비용은 **DOM 요소 수**(파싱·레이아웃·메모리)이고 그건 압축으로 줄지 않는다.
 *
 * ⚠**그래도 지금 고치지 않는다.** 고치려면 「숨은 패널을 지연 생성」으로 구조를 바꿔야 하는데,
 * 그러면 **§0-1(스크립트 없이도 동작한다)**과 정면으로 부딪힌다 — 지금은 JS 가 죽어도
 * 모든 지표가 문서 안에 있다. 그 교환을 배포 직전에 급히 결정할 일이 아니다.
 * → **다음 단계의 과제로 남긴다.** 손대려면 §0-1 을 어떻게 지킬지부터 정하라
 *   (예: `hidden until-found` 를 유지한 채 상위 N명만 그리고 나머지는 「もっと見る」로).
 */

import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, avg3, dec2, fullDate, innings } from "./format.ts";
import { block, denText, follower, note, panel, panelId, rankValue, runCell, scopedGroup, scroller, statCount, statRateOuts, statSigned, statText, subGroup, tabId, tablist, term, THIN_MARK, thinMark, valueWithDen, widestRunDiff, wlCell } from "./parts.ts";
import type { TabGroupRef } from "./parts.ts";
import { denUnit, termLabel } from "./glossary.ts";
import { page, pastSeasonOf, ROSTER_PATH } from "./layout.ts";
import { teamPath } from "./team-page.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import type { MatchupRow, RankingPanel, RankingRow } from "./player-page.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
// ⚠**「直近10」을 화면에 손으로 적지 않는다.** 상수를 8로 바꾸면 화면만 거짓말한다
import { RECENT_GAMES } from "@bb-app/aggregate";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import { isEmptyProfile, markLetter, markProfile } from "./marks.ts";
import type { MarkPlayer, ProfileAxis } from "./marks.ts";
import { streakDen, streakSpan } from "./streak-view.ts";
// ⚠**「続いている記録」이라는 이름을 여기서 다시 적지 않는다**(M1) — 이 표의 각주가
//   「그건 저쪽 화면이다」라고 말할 때 쓰는 그 이름이다. 한쪽만 고쳐지면 안내가 거짓이 된다
import { streakSectionTitle } from "./home-page.ts";

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
  /**
   * **연속 기록 부문**. 순위표 부문(`categories`)과 **나란히 서지만 표가 다르다**(설계 §2).
   *
   * ⚠**`categories` 에 못 넣는다** — `RankingPanel` 은 `rank === null` 을 「규정 미달」로 다루고
   * 기본으로 **숨긴다.** 연속 기록에서 그건 「비교가 성립하지 않는다」이고 **반드시 보여야 한다.**
   * ⚠**선택 필드다** — 일람의 하이라이트(`IndexPageData.highlights`)에는 이 부문이 없다.
   */
  streaks?: StreakCategory;
}

/**
 * **연속 기록 순위표에 싣는 확정 순위의 상한.** ⚠**화면에도 적는다**(M3의 정신) —
 * 기준이 코드에만 있으면 「왜 이 선수가 없지?」에 답할 수 없다.
 *
 * ⚠**`RANKING_PAGE_ROWS`(50)를 쓰지 않는다 — 근거가 다르다.**
 * 저쪽은 「規定到達のみ / 全員」 전환과 「もっと見る」가 붙는 표이고, 이쪽은 **자를수록
 * 각주가 말해야 할 것이 늘어나는 표**다. 실측(2026-09-07 · `scripts/streak-ranking-measure.ts` ·
 * 완결 8시즌 · 축×리그 64칸)에서 **10위의 값**은 連続無失点登板 **11~17登板** ·
 * 連続試合安打 **11~14試合** · 連続試合出塁 **16~26試合** · 連続無失点イニング **45~68아웃**이라,
 * 정의서 §1-7 이 歴代 목록에 제안한 하한(10등판)보다 **오히려 높다** — **별도 하한이 필요 없다.**
 * ⚠**하한을 또 두면 화면이 어느 쪽이 잘랐는지 말할 수 없게 된다**(작업규칙 7).
 */
export const STREAK_RANK_ROWS = 10;

/**
 * 연속 기록 순위표의 한 행.
 *
 * ⚠**분모를 타입이 강제한다**(M2 · 정의서 §1-6). `scanned`(훑은 사건 수)와 `from`/`to`(마루의 기간)가
 * **옵셔널이 아니다** — 분모 없는 행을 **만들 수 없다.** 셋째 분모(집계 범위)는 각주가 낸다.
 *
 * ⚠**값은 서버가 이미 다듬은 글자다**(`RankRestRow` 와 같은 규약 · M1). 렌더러가 다시 포맷하면
 * 이닝 표기(`33.1回` = 33과 1/3回)와 「以上」의 규칙이 **두 벌**이 된다.
 */
export interface StreakRankRow {
  playerId: string;
  name: string;
  /** 구단 코드. ⚠**마루의 마지막 경기의 구단이다** — 시즌 집계의 구단이 아니다(query.ts) */
  teamCode: string;
  /**
   * 순위. ⚠**`null` 은 「자격 미달」이 아니라 「비교가 성립하지 않는다」**다(정의서 §1-7) —
   * `23回以上` 과 `23回` 는 비교할 수 없다. **그래서 이 행은 반드시 보인다.**
   * ⚠**기존 순위표의 `rank === null`(규정 미달 · 기본으로 숨김)과 뜻이 정반대다** —
   * 그래서 이 표는 `RankingPanel` 을 재사용하지 않는다.
   */
  rank: number | null;
  /** 이미 다듬은 값 — `50` / `23.1回以上` */
  value: string;
  /** **분모 ⑴** — 훑은 사건 수. `57登板` / `104試合` */
  scanned: string;
  /** 이닝 축의 상한(`最大25.1回`). 확정이면 빈 문자열 */
  max: string;
  /** **분모 ⑵** — 마루의 첫·마지막 경기일 */
  from: string;
  to: string;
}

/** 연속 기록 순위표의 한 패널(= 축 하나) */
export interface StreakRankPanel {
  /** 탭 키. **용어집 키를 그대로 쓴다** — 두 이름을 두면 어긋난다 */
  id: string;
  /** ⚠**라벨을 여기 담지 않는다**(M1) — `termLabel(id)` 가 용어집에서 꺼낸다 */
  rows: StreakRankRow[];
  /**
   * **그 축에 기록이 있는 선수 수 — 자른 것을 말하기 위한 분모**(작업규칙 7).
   *
   * ⚠**지금의 컷에서 빈 패널은 언제나 `candidates === 0` 이다**(`streakPanelOf` 주석).
   * 그래도 빈 화면이 이 수를 함께 내는 이유는, 나중에 **표시 하한을 더하면 그 순간
   * 「선수가 없다」와 「상위에 못 든다」가 갈리기** 때문이다(M11) — 그때 문장을 안 고쳐도 된다.
   */
  candidates: number;
  /** 분모 ⑴ 의 단위. ⚠**타자와 투수가 다르다** — 같은 말로 적으면 다른 것을 센 것처럼 읽힌다 */
  scannedUnit: "試合" | "登板";
  /** 값이 이닝인가. 각주의 「33.1回 は 33と1/3回」를 켠다 */
  isInnings: boolean;
  /**
   * **실린 행 중에 「期間」이 확정이 아닌 것이 있는가**(이닝 축에서만 `true` 가 될 수 있다).
   *
   * ⚠**각주가 「期間」을 「記録に数えた最後の試合まで」라고 약속한다.** 경계 등판의 실점 시점을
   * 못 짚으면 **그 등판을 셀지 말지가 안 정해지고**, 그러면 기간의 끝(또는 시작)도 안 정해진다.
   * 그때는 **모른다는 것을 화면이 말해야 한다**(M11) — 조용히 좁은 기간을 단정하면 그것이 거짓이다.
   * ⚠**`rank === null` 과 같은 값이 아니다** — 경계 등판의 아웃이 0 이면 미확정이어도 기간은 확정이다.
   */
  spanUncertain: boolean;
}

/**
 * 연속 기록 부문 — **`RankingCategory` 와 나란히 서지만 표가 다르다**(설계 §2).
 *
 * ⚠**`RankingPanel`/`panelTable` 을 재사용하지 않는 이유**: 그 표는 `rank === null` 을
 * **「규정 미달 → 기본으로 숨김」**으로 다루는데, 연속 기록의 `rank === null` 은
 * **「비교가 성립하지 않는다 → 반드시 보여야 한다」**로 **정반대**다. 게다가
 * 「規定到達のみ」·「最少母数」·「もっと見る」는 전부 **비율 지표의 장치**이고,
 * 연속 기록에는 정의서 §1-7 이 자격 기준을 **적용하지 말라**고 못 박았다.
 */
export interface StreakCategory {
  id: string;
  label: string;
  panels: StreakRankPanel[];
}

/**
 * 순위 없는 행의 `順位` 칸.
 *
 * ⚠**색이나 흐림으로 말하지 않는다**(루트 §7 · `thinMark` 가 같은 이유로 글자를 쓴다).
 * ⚠**보이지 않는 설명을 함께 둔다** — 낭독기에는 `—` 가 「대시」나 침묵으로 나온다.
 */
function streakRankCell(rank: number | null): RawHtml {
  return rank === null
    ? html`${NO_VALUE}<span class="vh">順位なし（「以上」の記録のため）</span>`
    : html`${rank}`;
}

function streakRankTable(p: StreakRankPanel, base: string): RawHtml {
  const label = termLabel(p.id);
  return scroller(html`<table aria-label="${label}のリーグ順位">
    <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${term(label)}</th><th class="l">期間</th></tr></thead>
    <tbody>${p.rows.map(
      // ⚠**값 옆에 분모를 붙인다**(M2 · 정의서 §1-6 ⑴). 이닝 축은 **상한도 함께** —
      //   「23.1回以上」만 두면 상한이 참이라는 사실이 화면에서 사라진다(정의서 §3-3).
      // ⚠**주석을 템플릿 안에 두지 않는다** — `${…}` 안이어도 앞뒤의 줄바꿈과 들여쓰기가
      //   **행마다** 산출물로 나간다(`parts.ts` 가 707장이 달라졌다고 적어 둔 그 자리와 같은 성질).
      (r) => html`<tr>
        <td><b>${streakRankCell(r.rank)}</b></td>
        <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
        <td class="l">${r.teamCode.toUpperCase()}</td>
        <td class="b">${r.value}${streakDen(r.max, r.scanned)}</td>
        <td class="l">${streakSpan(r.from, r.to)}</td>
      </tr>`,
    )}</tbody>
  </table>`);
}

/**
 * 한 축의 표와 각주.
 *
 * ⚠**각주가 M2 의 셋째 분모를 낸다**(집계 범위) — 표가 좁아 열로 못 넣는다.
 * 홈 표(`streakTableNote`)와 같은 규칙이다.
 */
function streakPanelBody(
  p: StreakRankPanel,
  season: number,
  /**
   * ⚠**시즌이 끝났는지를 받아야 한다** — 각주가 **다른 화면의 구획 이름**을 부르는데
   * 그 이름이 시제로 갈린다(`streakSectionTitle`). 값을 안 받으면 **없는 구획을 가리키게 된다.**
   */
  seasonOver: boolean,
  base: string,
): RawHtml {
  const label = termLabel(p.id);
  if (p.rows.length === 0) {
    /**
     * ⚠**빈 화면에 후보 수를 함께 낸다**(M11·M12). 「선수가 0명」과 「기록이 0건」은 다른 상태이고,
     * **수 하나가 그것을 가른다** — 문장을 둘로 나누지 않아도 읽는 사람이 구별할 수 있다.
     *
     * ⚠**「まだ」를 쓰지 않는다** — 이 화면은 **끝난 시즌에도 그려진다.** 2018년 화면이
     * 「まだありません」이라고 말하면 거짓이다(`streakSectionTitle` 이 같은 이유로 시제를 가른다).
     * 여기서는 **시제가 없는 문장**을 써서 시즌 상태를 안 받아도 늘 참이게 한다.
     */
    return html`<p class="empty">${season}年のレギュラーシーズンには、この記録がある選手がいません（対象 ${p.candidates}人）。</p>`;
  }
  const hasUnranked = p.rows.some((r) => r.rank === null);
  return html`${streakRankTable(p, base)}
  ${note(
    // ⚠**M2 의 셋째 분모** — 石井大智는 정규만이면 이어지고 **일본시리즈를 넣으면 끊긴다**(정의서 §1-1).
    //   ⚠**연도를 박지 않는다**(사용자 결정 ⑵) — 보고 있는 시즌에서 유도한다.
    `この表は**${season}年のレギュラーシーズンのみ**で数えた、**そのシーズンでいちばん長かった記録**です — ` +
      "日本シリーズ・クライマックスシリーズ・オープン戦は入れていません。" +
      // ⚠**이 표가 답하는 질문을 말한다** — 「지금 이어지고 있는가」는 다른 화면의 일이다(설계 §6-4).
      //   ⚠**시제를 박지 마라** — 끝난 시즌의 그 구획은 「続いて**いた**記録」이고,
      //   `false` 를 박았더니 **그 시즌 화면에 없는 이름**을 가리켰다(2026-09-07 P1).
      `⚠**${seasonOver ? "シーズン終了時に続いていた記録ではありません" : "いま続いている記録ではありません"}** — ` +
      `それはトップページと球団ページの「${streakSectionTitle(seasonOver)}」にあります。` +
      // ⚠**분모 ⑴ 의 단위가 타자와 투수에서 다르다**
      `値の横の小さい数字は、**この範囲で数えた${p.scannedUnit}**の数です。` +
      "「期間」は**記録が始まった試合から、記録に数えた最後の試合まで**です。" +
      /**
       * ⚠**그 약속을 지킬 수 없는 행이 있으면 그 사실을 말한다**(M11 · 2026-09-07 P2).
       * 이닝 축은 **경계 등판의 아웃이 값에 들어가므로** 기간이 그 등판일까지 늘어나는데,
       * 실점 시점을 못 짚는 경계는 **셀지 말지 자체가 안 정해진다.** 그때 좁은 기간을
       * 단정하면 각주가 스스로 거짓이 된다.
       */
      (p.spanUncertain
        ? "⚠**「以上」の行では、この「期間」がさらに広がることがあります** — " +
          "記録の切れ目になった登板を数に入れるかどうかが決まらないためで、" +
          "併記した「最大」はその登板まで数えた値です。"
        : "") +
      // ⚠**값 자체가 이닝인 축에만 붙인다** — 이 각주가 없으면 값이 오독된다(정의서 §1-2)
      (p.isInnings ? "⚠**「33.1回」は33と1/3回**という意味です（33.1回ではありません）。" : "") +
      (hasUnranked
        ? "⚠**「以上」の記録には順位を付けていません** — 記録の切れ目になった登板の" +
          "どのイニングで失点したかを特定できないためで、**「23回以上」と「23回」は比べられません**。" +
          "併記した「最大」までのどこかで、どちらの数字も必ず成り立ちます。" +
          "上位に入る可能性があるものだけを順位なしで載せているので、**この表は完全な順位表ではありません**。"
        : "") +
      // ⚠**자른 것을 말한다**(작업규칙 7)
      `${label}の記録がある${p.candidates}人のうち、**${p.rows.length}人**を表示しています` +
      `（**${STREAK_RANK_ROWS}位まで**・同じ順位は全員）。`,
  )}`;
}

/**
 * 부문 하나 — 축마다 탭.
 *
 * ⚠**자리를 나누지 않는다.** 홈의 「続いている記録」은 **한 표**에 타자와 투수를 섞으므로
 * `shareStreakRows` 가 필요했다(2026 홈이 10행 중 7행 투수가 됐던 그 결함). 여기는
 * **축마다 패널이 따로**라 한쪽이 다른 쪽을 밀어내지 않는다.
 */
function streakCategoryPanels(
  c: StreakCategory,
  base: string,
  /**
   * 축 탭의 그룹. ⚠**`subGroup` 을 한 단계 더 두지 않는다** — 연속 기록 부문은 **하나뿐**이고
   * 그 아래가 바로 축이다. 한 단계를 더 두면 그룹 이름이 `rankstreak-streak` 가 되어
   * **이름이 자기를 두 번 말한다.** 지표 탭(`rankmetric`)이 `subGroup` 을 쓰는 것은
   * 부문이 셋(打者·先発·救援)이라 **부문마다 갈라야 하기 때문**이다.
   */
  prefix: TabGroupRef,
  season: number,
  seasonOver: boolean,
): RawHtml {
  if (c.panels.length === 0) return html`<p class="empty">この部門の記録を計算できていません。</p>`;
  return html`${tablist(
    prefix,
    c.panels.map((p) => ({ id: p.id, label: termLabel(p.id) })),
    true,
  )}
  ${c.panels.map((p, pi) => panel(prefix, p.id, pi === 0, streakPanelBody(p, season, seasonOver, base)))}`;
}

/**
 * 「もっと見る」가 받아 갈 **경계 아래 순위** — 리그·부문마다 한 파일.
 *
 * ⚠**표에 안 그린다.** 리그당 수백 행이라 HTML 로 넣으면 이 화면이 몇 배가 된다.
 * 기본 화면은 상위 50위(연속)까지이고, 그 아래는 **누를 때** 받는다.
 *
 * ⚠**서식을 서버가 만들어 보낸다**(`v`·`d` 는 이미 다듬은 글자다). 클라이언트가 다시
 * 포맷하면 **같은 규칙이 두 벌**이 되고(M1), 자릿수·이닝 표기가 어느 날 갈린다.
 * ⚠**클라이언트는 `textContent` 로만 넣는다** — 이름은 외부에서 온 글자다(§2-5 · XSS).
 *
 * ⚠**한 파일에 그 부문의 패널을 다 담는다.** 지표마다 파일을 두면 배포 파일 수가
 * 87 × 9시즌 늘어나는데, Pages 는 **배포당 20,000개** 상한이 있다(지금 9,473).
 * 한 번 받으면 그 탭의 다른 지표도 공짜다.
 */
export interface RankRestRow {
  /** 전원 순위 */
  r: number;
  playerId: string;
  name: string;
  /** 구단 코드(대문자) */
  t: string;
  /** 이미 다듬은 값 */
  v: string;
  /** 이미 다듬은 분모 */
  d: string;
  /** 분모의 **원시 수** — 최소 표본으로 거를 때 쓴다(표의 `data-den` 과 같은 값) */
  den: number;
  /** 규정 도달자인가 — 그 모드로 되돌아갈 때 필요하다 */
  q: boolean;
}

export function rankingRestJson(cat: RankingCategory): string {
  const out: Record<string, RankRestRow[]> = {};
  for (const p of cat.panels) {
    if (p.rest.length === 0) continue;
    out[p.id] = p.rest.map((r) => ({
      r: r.rankAll ?? 0,
      playerId: r.playerId,
      name: r.name,
      t: r.teamCode.toUpperCase(),
      v: rankValue(r.value.value, p.digits, p.valueAsInnings === true).toString(),
      d: denText(r.value.denominator, p.unit, p.denAsInnings).toString(),
      den: r.value.denominator,
      q: r.rank !== null,
    }));
  }
  return JSON.stringify(out);
}

/** 그 화면이 내보낼 「もっと見る」 파일들. ⚠**경로 규칙은 여기 한 벌이다**(M1) */
export function rankRestPath(leagueId: string, categoryId: string): string {
  return `rank/${leagueId}-${categoryId}.json`;
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
  /**
   * 한 줄 성적(`打率 .260（104打数）`). 값이 없으면 null.
   *
   * ⚠**분모가 문자열 안에 이미 들어 있다**(M2). 값만 떼어 쓰지 마라.
   * ⚠**여기서 다시 만들지 않는다**(M1) — 헤더 검색이 쓰는 것과 **같은 문자열**이다.
   *   같은 값을 두 곳에서 만들면 어느 날 한쪽만 고쳐진다.
   */
  summary: string | null;
  /**
   * 읽는 법 **원문**. ⚠**색인(`SearchEntry.k`)과 같은 값이다**(M1) —
   * 여기서 다르게 만들면 「같은 이름을 쳤는데 화면에 따라 나오고 안 나오는」 상태가 된다.
   */
  kana: string | null;
  /** 등번호. ⚠null은 「0번」이 아니라 「지금 등록이 없다」(M11) */
  uniformNumber: string | null;
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

/**
 * 한 부문의 지표 탭줄과 표들.
 *
 * ⚠**지표 탭 그룹을 부문마다 나눈다.** 하나로 묶으면 「打者」에서 고른 `wRC+`가
 * 「先発」로 옮겼을 때 사라져, 아무 표도 안 열린 화면이 된다.
 */
function categoryPanels(
  c: RankingCategory,
  base: string,
  prefix: TabGroupRef,
  /**
   * 「もっと見る」가 받아 갈 파일의 주소. ⚠**없으면 버튼도 없다** —
   * 일람의 하이라이트(5행짜리)에는 그런 약속이 없다.
   */
  restUrl?: string,
): RawHtml {
  if (c.panels.length === 0) return html`<p class="empty">この部門の順位を計算できていません。</p>`;
  // ⚠페이지마다 접두사를 다르게 준다 — 저장된 탭 상태를 공유하면 5행짜리 일람과
  // 30행짜리 순위표가 서로의 선택을 덮어쓴다
  // ⚠**그룹 이름과 id 이름공간을 함께 늘린다**(`subGroup`) — 한쪽만 늘리면 id 가 다시 겹친다
  const group = subGroup(prefix, c.id);
  return html`${tablist(
    group,
    c.panels.map((p) => ({ id: p.id, label: p.label })),
    true,
  )}
  ${c.panels.map((p, pi) => panel(group, p.id, pi === 0, panelTable(p, base, restUrl)))}`;
}

function panelTable(p: RankingPanel, base: string, restUrl?: string): RawHtml {
  const rows = p.rows;
  if (rows.length === 0) return html`<p class="empty">順位を計算できていません。</p>`;
  const qualifiedCount = p.qualifiedCount;
  /**
   * **「規定到達のみ」에서 실제로 보이는 행 수.**
   *
   * ⚠**`limit` 로 갈음하지 마라**(2026-08-20). 최소 표본이 걸리는 패널에는
   * 「어느 하한에서도 상위 N」을 위해 규정 상위 `limit` 밖의 **자격자**가 들어오는 일이 있다
   * (실측: 9시즌 756 패널-리그-시즌 중 **8건**). 그때 「上位30人のみ表示」는 거짓이 된다.
   */
  const shownQualified = rows.filter((r) => r.rank !== null).length;
  const truncated = qualifiedCount > shownQualified;
  /**
   * 자격 기준이 실제로 누군가를 자르고 있는가 — **서버가 이미 판정해서 보낸다**(M1).
   * ⚠**개수 지표(홈런·탈삼진)에는 자격 기준이 없다** — 거기에 전환 버튼을 두면
   * 눌러도 아무것도 사라지지 않아 「고장난 버튼」이 된다.
   * ⚠**여기서 다시 세지 않는 이유**: 고른 뒤의 행으로 판정하면 「고르기가 무엇을 남겼는가」에
   * 따라 조작이 붙었다 안 붙었다 한다. 판정의 정본은 `minTopFor`(query.ts) 한 곳이다.
   */
  const hasQualifier = p.minTop !== null;
  /**
   * 「全員」에서 쓰는 **최소 표본**의 단위.
   *
   * ⚠**그 패널이 이미 쓰는 분모를 그대로 쓴다**(M2 · `denText` 와 같은 값). 打席으로 자르고
   * 打数를 보여주면 화면이 자기 자신과 모순된다 — 이 표에서 出塁率의 분모는 打席이 아니고
   * (`出塁機会`) wOBA는 또 다르다(`wOBA機会`). 여기서 단위를 새로 짓지 않는 이유가 그것이다.
   * ⚠**단위 문자열의 정본은 `glossary.ts` 의 `den`** 이고 `p.unit` 이 그것을 받아 온 값이다.
   */
  const minUnit = p.unit;
  /**
   * 못 읽은 입력에 대고 할 말. **서버가 미리 적는다** — 클라이언트가 문장을 조립하면
   * 문구가 두 벌이 되고(M1), 이닝 표기의 규칙을 클라이언트가 다시 설명하게 된다.
   * ⚠**조용히 0으로 만들지 않는다**(침묵 오류). 값이 안 먹었으면 그것이 보여야 한다.
   */
  const badHint = p.denAsInnings
    ? `最少${minUnit}は 50 や 138.1 のように入れてください（小数は 0・1・2 だけです）。`
    : `最少${minUnit}は数字で入れてください。`;
  return html`${hasQualifier
    ? html`<div class="mfind rankonly">
    <button class="tab" type="button" data-rankonly="${p.id}" aria-pressed="true"
      title="${p.qualifier}">規定到達のみ</button>
    ${
      // ⚠**서버는 숨겨서 낸다**(§0-1). 스크립트가 없으면 이 칸은 아무 일도 못 하고,
      //   눌러도 아무것도 안 일어나는 조작을 남기지 않는 것이 이 패널의 규칙이다
      //   (바로 위 `hasQualifier` 가 같은 이유로 버튼 자체를 없앤다).
      // ⚠**`type="number"` 를 쓰지 않는다** — 브라우저가 못 읽은 값을 **빈 문자열로 바꿔 버려서**
      //   「무엇을 쳤는지」가 사라진다. 우리가 읽고 우리가 말해야 한다.
      // ⚠**id 를 붙이지 않는다** — 같은 `p.id` 가 セ·パ 두 벌로 그려지므로 id 가 겹친다
      //   (2026-08-19 감사가 잡은 중복 id 86종과 같은 모양). 그래서 `label` 로 감싼다.
      html`<label class="rankmin" hidden>最少${minUnit}<input type="text" inputmode="numeric"
      autocomplete="off" size="5" value="0" data-rankmin="${p.id}"${raw(p.denAsInnings ? " data-rankouts" : "")}></label>`
    }
    <span class="count"><span data-rankcount="${p.id}">${shownQualified}人</span> / 全${rows.length}人</span>
  </div>
  <p class="empty" data-rankbad="${p.id}" hidden role="status">${badHint}</p>`
    : null}
  ${scroller(html`<table aria-label="${p.label}のリーグ順位">
    <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${term(p.label)}</th><th>${term("母数")}</th></tr></thead>
    <tbody>${rows.map(
      // ⚠**기본은 「규정 도달자만」이므로 미달 행은 처음부터 숨어 있다.**
      // 스크립트가 없으면 그대로 숨은 채인데, 그것이 **지금까지와 같은 화면**이다 —
      // 전환은 더해지는 기능이고, 없다고 잃는 것은 없다(§0-1).
      // ⚠**`data-den` 은 「최소 표본」이 있는 패널에만 싣는다.** 母数 칸은 `138.1回` 같은
      //   **글자**라 수로 비교할 수 없어서 이 속성이 필요한데, 거를 일이 없는 개수 지표
      //   (홈런·탈삼진)에까지 실으면 안 쓰는 바이트를 전 페이지가 나른다.
      // ⚠**여기 담기는 것은 원시 분모다** — 아웃 카운트인 패널은 아웃 그대로이고,
      //   이닝 표기(`138.1`)로의 환산은 클라이언트가 입력 쪽에서 한다.
      // ⚠**「全員」 기본 화면은 연속이어야 한다**(2026-08-31 · 사용자 지적).
      //   rows 는 세 벌의 합집합이라 규정 도달자인데 전원 순위가 한참 아래인 행이 섞인다 —
      //   그대로 그리면 **31 → 36 → 152 → 181 → 244** 로 뛴다.
      //   그런 행은 data-beyond 로 표시해 두고, 「全員」에서는 **펼쳐야** 나온다.
      // ⚠**규정 모드에서는 그대로 보인다** — 거기서는 규정 순위로 연속이다.
      // ⚠**경계는 서버가 정한다**(topAllCut) — 동률이 순위를 건너뛰므로 50 이하로는 못 가른다.
      (r) => html`<tr class="${r.isMe ? "me" : ""}" data-qualified="${r.rank === null ? "0" : "1"}"${
        p.topAllCut !== null && r.rankAll !== null && r.rankAll > p.topAllCut
          ? html` data-beyond="1"`
          : raw("")
      }${
        hasQualifier ? html` data-den="${r.value.denominator}"` : raw("")
      }
        ${raw(r.rank === null ? "hidden" : "")}>
        <td><b data-rankq>${r.rank === null ? NO_VALUE : r.rank}</b><b data-ranka hidden>${
        r.rankAll === null ? NO_VALUE : r.rankAll
      }</b></td>
        <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
        <td class="l">${r.teamCode.toUpperCase()}</td>
        <td>${rankValue(r.value.value, p.digits, p.valueAsInnings === true)}</td>
        <td>${denText(r.value.denominator, p.unit, p.denAsInnings)}</td>
      </tr>`,
    )}</tbody>
  </table>`)}
  ${
    // ⚠**0건을 빈 표로 두지 않는다**(M12 · `table.ts` 의 `data-stable-empty` 와 같은 이유).
    //   최소 표본을 크게 잡으면 한 사람도 안 남을 수 있는데, 머리줄만 있는 표는
    //   「아무도 없다」와 「고장났다」가 같은 화면이 된다.
    hasQualifier
      ? html`<p class="empty" data-rankempty="${p.id}" hidden role="status">指定した最少${minUnit}を満たす選手は、この表にはいません。</p>`
      : null
  }
  ${/* ⚠**펼치기는 「全員」의 연속을 지키기 위한 것이다**(2026-08-31).
         기본 화면은 전원 순위가 이어지는 데까지만 그리고, 그 아래(규정 도달자인데
         전원 순위가 한참 아래인 선수)는 여기서 펼친다.
         ⚠**서버는 언제나 그린다** — 숨길지는 클라이언트가 정한다(숨긴 행이 없으면 버튼도 없다).
         ⚠**스크립트가 없으면 안 보인다**(hidden) — 그때 화면은 **연속인 상위만** 보이고,
         그건 지금까지와 다르지 않다(§0-1: 더해지는 기능이고 없다고 잃는 것이 없다). */ ""}
  ${restUrl === undefined || p.rest.length === 0
    ? raw("")
    : html`<p class="more"><button type="button" class="go alt" data-rankmore="${p.id}"
    data-rankrest="${restUrl}" aria-expanded="false" hidden>順位をもっと見る</button></p>`}
  ${note(
    // ⚠**자른 것을 말한다.** 상위 N만 보여주면서 「전부」처럼 보이면 그것도 거짓말이다
    // ⚠**「上位N人」이라고 안 쓴다** — 최소 표본이 걸리는 패널에는 규정 상위 N 밖의 자격자가
    //   섞이는 일이 있어(위 `shownQualified`) 그때 「上位」가 참이 아니게 된다
    truncated ? `${p.qualifier} 該当 ${qualifiedCount}人のうち ${shownQualified}人を表示。` : p.qualifier,
  )}
  ${
    // ⚠**행이 늘면 이 문장도 같이 바뀌어야 한다**(2026-08-20). 예전에는 여기가
    //   「絞り込みが効くのは、この表に載っているN人の中だけです」 하나였는데,
    //   그건 **하한을 올려도 답이 안 나오는 상태**를 그대로 설명한 문장이었다.
    //   지금은 「어느 하한에서도 상위 minTop 은 반드시 있다」가 참이므로 **그것을 말한다** —
    //   한계가 남은 자리(minTop 아래)도 같은 문장이 계속 말한다.
    hasQualifier
      ? note(
        "「規定到達のみ」を外すと、規定に届いていない選手も同じ指標で並べた順位で表示します — " +
          "母数の小さい選手が上位に来ます。母数は右端の列にあります。" +
          // ⚠**번호가 띄엄띄엄해지는 이유를 화면이 말한다.** 거르기만 하고 다시 매기지 않는 것은
          //   동률 규칙을 두 벌로 만들지 않기 위해서인데(M1·M3), 그 사정을 안 적으면
          //   「順位が飛んでいる = 고장」으로 읽힌다.
          `「全員」の間は**最少${minUnit}**を指定できます（0なら絞りません）。` +
          "⚠**順位はリーグ全体のもので、絞り込んでも振り直しません** — 番号が飛び飛びになるのはそのためです。" +
          // ⚠**한계가 사라진 패널에 「일부만 걸러집니다」를 남기지 않는다** — 그게 거짓말이다.
          //   기록이 있는 선수를 전부 싣고 있으면 좁히기에 사각지대가 없다
          (rows.length >= p.allCount
            ? `この指標で記録がある選手 ${p.allCount}人は、全員この表に載っています。`
            : `どの最少${minUnit}を指定しても**上位${p.minTop}人は必ずこの表にいます**。` +
              `それより下の順位は、この表に載っている${rows.length}人（記録がある選手 ${p.allCount}人のうち）の範囲です。`),
      )
      : null
  }`;
}

export function renderIndexPage(d: IndexPageData, ctx: RenderContext): string {
  const { base, root, seasons, navTo } = ctx.paths(ROSTER_PATH);
  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">選手一覧</h1>
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
    // ⚠**구단 페이지에서 이 구획으로 바로 오는 앵커**(hi = highlight). id 를 별도로 검사하지 않는다 —
    // `t.code`는 `TEAMS`(domain/teams.ts)의 닫힌 12개 코드 중 하나이고, 같은 줄의 `teamPath(t.code)`도
    // 이미 검사 없이 그대로 쓰인다. 게다가 `html` 태그드 템플릿이 값을 자동 이스케이프하므로
    // 속성 밖으로 빠져나가는 문자도 만들 수 없다(html.ts).
    (t) => html`<section class="teamgroup" id="hi-${t.code}" style="--chip:${t.color.base};--chip-ink:${t.color.ink}">
  <h2><i></i><a href="${base}${teamPath(t.code)}">${t.name}</a><span class="qt">${t.players.length}人</span></h2>
  <ul class="roster">${t.players.map((p) => {
      const who: MarkPlayer = {
        playerId: p.playerId,
        name: p.name,
        teamName: t.name,
        color: t.color,
        positionMark: p.mark,
      };
      /**
       * ⚠**첫 화면의 좁히기도 헤더 검색과 같은 것을 찾아야 한다.**
       * 예전에는 이 목록이 `data-name` 부분일치만 봐서, 「やまもと」나 「18」을 치면
       * **첫 화면에서만 0건**이 됐다 — 「등번호로 찾을 수 있다」가 화면에 따라 참·거짓이 갈렸다.
       * ⚠접기는 클라이언트 `fold()` 한 벌이 한다(M1). 여기는 **원문만** 싣는다.
       */
      return html`<li data-team="${t.code}" data-name="${p.name}" data-id="${p.playerId}"${
        p.kana === null ? raw("") : html` data-kana="${p.kana}"`
      }${p.uniformNumber === null ? raw("") : html` data-uniform="${p.uniformNumber}"`}>
      <a href="${base}players/${p.playerId}.html">
        <span class="mkline">${isEmptyProfile(p.axes)
          ? markLetter(who, p.mark === "" ? "—" : p.mark, 18)
          : markProfile(who, p.axes, p.sampleText, 18)}</span>
        <span class="hn">${p.name}</span><span class="hp">${p.mark}</span>
        ${p.summary === null ? raw("") : html`<span class="hs">${p.summary}</span>`}
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
        panel(`hicat-${s.id}`, c.id, ci === 0, categoryPanels(c, base, `himetric-${s.id}`)),
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
    navTo,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
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

/**
 * 引き分けの解剖 한 줄.
 *
 * ⚠**이 표의 값은 「그 해의 연장 규정」이 데이터에 남긴 자국이다** — 구단의 성질이 아니다.
 * ⚠**수를 화면에 하드코딩하지 않는다.** 직전 라운드가 리그 실측치를 1,808장에 박았고,
 *   **DB 에서 다시 세어 대조하는 시험**으로 고쳤다. 여기도 전부 데이터에서 온다.
 */
export interface DrawSeasonRow {
  season: number;
  /** 보고 있는 시즌인가. 화면이 그 줄을 강조한다 */
  current: boolean;
  games: number;
  draws: number;
  drawRate: Rate;
  /** 연장(10회 이상)에 들어간 경기 */
  extra: number;
  extraDrawn: number;
  /** 연장에 들어가 결착이 난 비율. ⚠**연장이 0인 해는 값이 없다**(M11) */
  extraDecided: Rate;
  /** 9회 이내에 끝난 무승부. ⚠**연장이 있는 해에 0이 아니면 콜드 게임이다** */
  regulationDrawn: number;
  /** 그 해에 실제로 도달한 최대 이닝 */
  maxInning: number | null;
  /** 이닝을 모르는 경기. ⚠**9회로 때우지 않는다**(M11) */
  inningUnknown: number;
}

export interface RankingPageData {
  season: number;
  asOf: string | null;
  /**
   * **이 시즌이 이미 끝났는가.** 판정은 `query.ts` 의 `seasonIsOver` 한 벌이다(M1) —
   * 홈·구단 페이지가 쓰는 것과 **같은 값**이다.
   *
   * ⚠**이 필드가 없어서 각주가 거짓말을 했다**(2026-09-07 이중 검토 P1). 連続記録 의 각주가
   * 「トップページと球団ページの『続いている記録』」이라고 **`streakSectionTitle(false)` 를 박아서**
   * 냈는데, 완결 시즌의 그 구획 이름은 **「続いて**いた**記録」**이다 — 실측으로
   * `dist/2025/ranking.html` 16건 대 `dist/2025/index.html` 3건이 서로 다른 시제였다.
   * **넘길 방법이 없었던 것이 원인이다. 값이 아니라 배선이 빠져 있었다.**
   */
  seasonOver: boolean;
  /** 팀 순위표. **개인 순위보다 먼저 온다** — 「順位」를 누른 사람이 먼저 찾는 것이다 */
  standings: StandingsSection[];
  /** 동률 처리 규칙. ⚠**화면에 적는다**(M3) */
  tieRule: string;
  /**
   * 引き分けの解剖. **보유 첫 시즌 ~ 보고 있는 시즌**.
   * ⚠**미래 시즌을 과거 화면에 싣지 않는다** — 통산 대전과 같은 규약이다.
   * 비어 있으면 구획을 그리지 않는다.
   */
  draws: DrawSeasonRow[];
  leagues: LeagueSection[];
}

/**
 * 引き分けの解剖.
 *
 * ⚠**なぜここか** — 順位表の`引分`列を見た人が次に持つ疑問がこれだからだ。
 *   勝率の分母から引き分けを抜くという NPB の規定も、この表の隣にあってはじめて意味を持つ。
 * ⚠**球団別に出さない。** 引き分けは2球団に同時に付く事象で、それを球団の性質として読ませると
 *   根拠のない話になる（`draw.ts` の「무엇을 재지 않는가」）。
 */
function drawsTable(rows: readonly DrawSeasonRow[]): RawHtml {
  return scroller(html`<table aria-label="シーズンごとの引き分け">
  <thead><tr>
    <th class="l">シーズン</th><th>試合</th><th>引き分け</th><th>${term("引分率")}</th>
    <th>延長</th><th>延長引分</th><th>${term("延長決着率")}</th><th>9回引分</th><th>最長イニング</th>
  </tr></thead>
  <tbody>${rows.map(
    (r) => html`<tr class="${r.current ? "me" : ""}">
    <td class="l">${r.season}年</td>
    <td class="b">${r.games}</td>
    <td>${r.draws}</td>
    <!-- ⚠**분모를 값에 붙인다**(M2) — 시즌마다 경기 수가 다르다(2020년은 120試合制) -->
    <td class="wd">${valueWithDen(r.drawRate, denUnit("drawRate"), 3)}</td>
    <td>${r.extra}</td>
    <td>${r.extraDrawn}</td>
    <td class="wd">${valueWithDen(r.extraDecided, denUnit("extraDecided"), 3)}</td>
    <td>${r.regulationDrawn}</td>
    <td>${r.maxInning === null ? NO_VALUE : `${r.maxInning}回`}</td>
  </tr>`,
  )}</tbody>
</table>`);
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
  const maxAbs = widestRunDiff(s.rows);
  /**
   * ⚠**홈의 순위표와 같은 어법으로 그린다**(2026-08-18 유저 요청:
   * 「홈 쪽에 있는 순위 표에 맞춰서 · 항상 같은 디자인일 수 있게 디자인 요소 통합」).
   * 표 클래스에 `hstand` 를 함께 준다 — 고정 열·구단 색 막대·1위 강조가 그쪽 한 벌에서 온다.
   * 승패분과 득실점은 **같은 부품**(`wlCell`·`runCell`)을 쓴다(M1).
   *
   * ⚠**열을 줄였다.** 勝/敗/分 세 열과 得点/失点/得失差 세 열이 각각 한 칸으로 합쳐졌다 —
   * 같은 사실을 홈은 한 칸, 여기는 세 칸으로 말하고 있었고 그 차이에 뜻이 없었다.
   * 잃은 정보는 없다: 승·패·분은 칸 안에 그대로 있고, 得/失 도 分母와 함께 그대로 있다.
   */
  return scroller(html`<table class="stand hstand" aria-label="順位表">
    <thead><tr>
      <th>順位</th><th class="l">球団</th><th>試合</th>
      <!-- ⚠**勝率도 용어집에 있다**(2026-08-20 winPct 등록). 여기만 맨 문자열이면
           같은 순위표인데 홈 화면(term 을 쓴다)에는 설명이 뜨고 이쪽에는 안 뜬다.
           ⚠주석 안에 백틱을 쓰지 마라 — 이 자리는 템플릿 리터럴이라 문자열이 그 자리에서 끊긴다 -->
      <th class="l">勝敗分</th><th>${term("勝率")}</th><th>差</th><th class="l">得失点</th>
      <th>${term("打率")}</th><th>${term("防御率")}</th>
      <th>ホーム</th><th>ビジター</th><th>直近${RECENT_GAMES}</th>
    </tr></thead>
    <tbody>${s.rows.map(
      // ⚠**구단 페이지에서 이 행으로 바로 오는 앵커**(stand = standings). 위 teamgroup 의 `hi-` 와
      // 같은 이유로 별도 검사를 두지 않는다 — `r.teamCode` 도 닫힌 12개 구단 코드 중 하나다.
      (r) => html`<tr id="stand-${r.teamCode}" style="--chip:${r.color.base}" class="${r.rank === 1 ? "lead" : ""}">
        <td class="hrank">${r.rank}${r.tiedRank ? html`<s>同</s>` : null}</td>
        <!-- ⚠**팀명을 누르면 그 팀 화면으로 간다.** 지금까지 목적지가 없어서
             팀을 보려면 이 한 줄과 선수 일람의 한 덩어리를 머리에서 합쳐야 했다 -->
        <td class="l"><a class="hteam" href="${base}${teamPath(r.teamCode)}"
          style="--chip:${r.color.base};--chip-ink:${r.color.ink}"><i></i>${r.shortName}</a></td>
        <td>${r.games}</td>
        <td class="l wl3">${wlCell(r)}</td>
        <td class="b">${avg3(r.pct)}</td>
        <td>${r.gamesBehind === 0 ? "—" : r.gamesBehind.toFixed(1).replace(/\.0$/, "")}</td>
        <td class="l wd">${runCell(r, maxAbs, r.games)}</td>
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
  const { base, root, seasons, navTo } = ctx.paths("ranking.html");
  const leagueTabs = d.leagues.map((l) => ({ id: l.id, label: l.name.replace("・リーグ", "") }));
  const hasTeam = d.standings.length > 0;
  const hasPersonal = d.leagues.length > 0;
  // ⚠**한쪽이 없으면 갈래를 만들지 않는다.** 눌러도 아무것도 없는 탭은 고장으로 읽힌다
  const split = hasTeam && hasPersonal;

  // ⚠**탭 이름과 제목이 겹치는 것을 남겨둔다.** 우리 패널에는 `aria-labelledby`가 없어서
  // 이 제목이 「지금 열린 것이 무엇인가」를 말하는 유일한 수단이다
  const teamBody = html`<section class="block" id="b-standings">
  <h2>チーム順位</h2>
  ${d.standings.map(
    (s) => html`<div class="standwrap">
    <h3 class="standname">${s.name}</h3>
    ${standingsTable(s, base)}
  </div>`,
  )}
  ${note(
    // ⚠**勝率의 정의와 동률 규칙을 화면에 적는다**(M2·M3). 규칙이 코드에만 있으면 아무도 검증할 수 없다
    `勝率は 勝 ÷（勝＋敗）で、引き分けは分母に入れません（NPBの規定）。` +
      `交流戦の試合もリーグ順位に含めています。${d.tieRule}` +
      `得点・失点は公表記録、打率と防御率は当サイトの再計算です。`,
  )}
</section>
${d.draws.length === 0
    ? raw("")
    : html`<section class="block" id="b-draws">
  <h2>引き分けの解剖<span class="qt">${d.draws[0]!.season}〜${d.draws[d.draws.length - 1]!.season}年</span></h2>
  ${drawsTable(d.draws)}
  ${note(
      "上の順位表で勝率の分母から抜いている**引き分け**が、どういう試合だったのかを分解しています。" +
        "**「延長」は10回以降に入った試合**、「9回引分」は9回までで引き分けになった試合です — " +
        "延長のある年に9回引分があれば、それは雨などのコールドゲームです。" +
        "⚠**引き分けの多さは球団の性質ではなく、その年の延長規定でほぼ決まります。** " +
        "当サイトが保有するシーズンでも規定は何度も変わっていて、それがこの表にそのまま残っています。" +
        "⚠**球団別には出していません** — 引き分けは2球団に同時に付く事象なので、" +
        "それを球団の強さとして読むと根拠のない話になります。" +
        "⚠**「引き分けが順位にどれだけ影響したか」も測っていません**（NPBの勝率は引き分けを分母から抜くだけで、" +
        "当サイトはそれ以上の換算をしません）。" +
        (d.draws.some((r) => r.inningUnknown > 0)
          ? `⚠イニングが分からない試合が${d.draws.reduce((a, r) => a + r.inningUnknown, 0)}試合あり、` +
            "「延長」にも「9回引分」にも数えていません。"
          : ""),
    )}
</section>`}`;

  /**
   * ⚠**부문·지표 탭은 리그마다 한 벌씩 그려진다 — 그룹은 공유, id 는 나눈다.**
   *
   * 예전에는 그룹 이름으로 id 까지 지어서 **セ 사본과 パ 사본의 id 가 같았다.**
   * 실측(2026-08-19 감사): `dist` 15,340장 중 `ranking.html` **9장**(시즌별 8 + 현행 1)에
   * 중복 id **86종 / 172노드**. `ranking.html#pn-rankmetric-starter-era` 로 들어가면
   * `getElementById` 가 セ 사본을 반환해 `revealHash()` 가 그쪽 조상만 폈고,
   * 열린 리그 패널이 **`['central']`** — **パ의 어떤 개인 지표도 URL 로 가리킬 수 없었다.**
   * 낭독기에는 「パ의 打者 탭이 セ의 패널을 조작한다」고 들렸다(ARIA 참조 20/20이 セ 쪽).
   *
   * ⚠**그룹까지 나누면 안 된다** — 「리그를 바꿔도 보고 있던 지표가 남는다」가 사라진다.
   */
  const personalBody = html`${d.leagues.map((league, li) => {
    const catGroup = scopedGroup("rankcat", league.id);
    const metricGroup = scopedGroup("rankmetric", league.id);
    /**
     * ⚠**연속 기록의 축 탭은 지표 탭과 **다른 그룹**이다.**
     * 같은 그룹이면 「打者」에서 고른 `wRC+` 가 「連続記録」으로 옮겼을 때 사라져
     * **아무 표도 안 열린 화면**이 된다 — `categoryPanels` 머리주석의 그 결함이다.
     * ⚠**id 는 리그마다 갈린다**(`scopedGroup`) — 안 그러면 2026-08-19 P1(중복 id 86종)이 재발한다.
     */
    const streakGroup = scopedGroup("rankstreak", league.id);
    return panel(
      "rankleague",
      league.id,
      li === 0,
      html`<section class="block" id="lg-${league.id}">
      ${/* ⚠**연속 기록 부문은 마지막이다.** 첫 자리는 「이 화면의 주장」이고(순위표의 기본 지표가
             승수가 아닌 것과 같은 이유), 이 화면의 주장은 여전히 打者·先発·救援 의 시즌 성적이다.
             ⚠**부문 탭 한 줄에 두 종류가 섞인다** — 앞 셋은 「누구의 순위인가」, 넷째는
             「어떤 종류의 기록인가」다. 그래도 한 줄에 두는 이유는 이 줄이 **지표 버튼 줄을
             짧게 유지하는 장치**이기 때문이다(`RankingCategory` 주석) — 연속 기록도 축이 4개다. */ ""}
      <h2>${league.name}<span class="sw">${tablist(
        catGroup,
        [
          ...league.categories.map((c) => ({ id: c.id, label: c.label })),
          ...(league.streaks === undefined ? [] : [{ id: league.streaks.id, label: league.streaks.label }]),
        ],
        false,
        `${league.name}の部門`,
      )}</span></h2>
      ${league.categories.map((c, ci) =>
        panel(catGroup, c.id, ci === 0, categoryPanels(c, base, metricGroup, `${base}${rankRestPath(league.id, c.id)}`)),
      )}
      ${league.streaks === undefined
        ? raw("")
        : panel(
          catGroup,
          league.streaks.id,
          // ⚠**첫 패널이 아니다** — 부문이 하나도 없으면 이 줄이 첫 패널이 되어야 하는데,
          //   `categories` 가 빈 리그는 `buildLeagues` 가 통째로 건너뛰므로 그런 리그는 오지 않는다
          league.categories.length === 0,
          streakCategoryPanels(league.streaks, base, streakGroup, d.season, d.seasonOver),
        )}
    </section>`,
    );
  })}`;

  // 갈래가 없으면 구분선도 없다 — 앞이 비어 있는 구분선은 그냥 흠집이다
  const leagueRail = hasPersonal
    ? html`${split ? html`<span class="div"></span>` : raw("")}${tablist("rankleague", leagueTabs, false, "リーグ")}`
    : raw("");

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">リーグ順位</h1>
    <span class="sub">${d.season}年</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

${!hasTeam && !hasPersonal
    ? html`<p class="empty">このシーズンの順位はまだ計算できていません。</p>`
    : html`${!split && !hasPersonal
      ? raw("")
      : html`<div class="rail">
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
</div>`}

${hasTeam ? (split ? panel("ranktype", "team", true, teamBody) : teamBody) : raw("")}
${hasPersonal ? (split ? panel("ranktype", "personal", false, personalBody) : personalBody) : raw("")}`}`;

  return page({
    title: `リーグ順位 — ${d.season}年`,
    base,
    root,
    seasons,
    navTo,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
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
  /**
   * **SRP(状況失点抑制)** — 이 사이트가 직접 만든 지표.
   *
   * ⚠**선수 성적을 내는 자리에는 반드시 넣는다**(2026-08-18 유저 요청).
   * 이 화면은 「내일 누가 던지는가」를 보러 오는 자리인데, 정작 이 사이트가
   * 가장 앞세우는 지표가 빠져 있었다 — 방어율·WHIP·FIP 는 어디에나 있는 값이다.
   * ⚠**분모(상대한 타자 수)를 함께 든다**(M2). 없으면 렌더링하지 않는다.
   */
  srp: Rate | null;
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
  /**
   * 같은 것의 **통산**(보유 첫 시즌 ~ 보고 있는 시즌).
   *
   * ⚠**현역 한정이 이미 걸려 있다**(2026-08-18 유저 요청). 상대 팀 소속으로 거르는데
   * 그 소속은 **그 시즌의 것**이라, 은퇴·이적한 선수는 저절로 빠진다.
   * ⚠**시즌을 넘겨 더하지만 대회는 안 섞는다**(§2-1) — 정규시즌끼리만 더한다.
   */
  opponentsCareer: MatchupRow[];
}

export interface ProbableGame {
  venue: string | null;
  startTime: string | null;
  league: string;
  sides: [ProbableSide, ProbableSide];
}

export interface StartersPageData {
  /**
   * **우리가 실제로 보유한 첫 시즌.**
   *
   * ⚠**「通算」이라고 쓰면 거짓말이 된다**(2026-08-18 유저 지적으로 정정).
   * 이 화면의 넓은 쪽 집계는 **우리가 가진 시즌의 합계**이지 그 선수의 통산이 아니다.
   * CLAUDE.md 가 「우리 보유분을 합산해 통산이라고 부르는 것은 금지」라고 적어 뒀는데
   * 내가 그걸 어겼다 — 라벨을 **실제 범위**로 바꾸고, 그 범위를 데이터에서 받는다.
   * ⚠**하드코딩하지 않는다** — 백필하면 저절로 맞는다.
   */
  heldFrom: number;
  /** 예고가 나와 있는 경기일. 없으면 null */
  gameDate: string | null;
  /**
   * **앞뒤 날짜.** 없으면 null(그 방향 끝이다).
   *
   * ⚠**하루치만 보여주고 있었다**(2026-08-18 유저 지적). `loadProbables` 가
   * `MAX(game_date)` 한 줄만 읽어서, 새 예고가 들어오는 순간 **어제 것을 볼 방법이 사라졌다** —
   * 「이전」을 눌러도 그 화면에는 예고가 아예 없었다.
   * 예고는 **경기 전에만 존재하는 유일한 정보**라 지나가면 다시 못 받는다(그래서 매일 받는다).
   * 받아 놓고 못 보게 두는 것은 그 수집을 헛되게 하는 것이다.
   */
  prev: string | null;
  next: string | null;
  /** 우리가 예고를 가진 날 수. 「며칠분이 있는가」를 화면이 말한다 */
  dayCount: number;
  /** 기본으로 열리는 날(= `starters.html` 이 그리는 날). 링크가 어느 주소로 갈지 정한다 */
  defaultDate: string | null;
  /**
   * 이 데이터가 **날짜별 화면**(`starters/YYYY-MM-DD.html`)의 것인가.
   *
   * ⚠**깊이가 다르면 상대 링크가 전부 어긋난다.** 화면이 자기 경로를 스스로 말해야
   * `ctx.paths` 가 올바른 base 를 계산한다 — 안 그러면 링크 361개가 한 번에 깨진다(실측).
   */
  isDayPage?: boolean;
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

/**
 * 予告先発의 날짜 이동.
 *
 * ⚠**`days/` 의 어법을 그대로 쓴다**(2026-08-18) — 같은 「앞뒤로 넘긴다」인데 모양이 다르면
 * 사용자가 두 번 배워야 한다. 화살표는 형태로 방향을 말하므로 인쇄·색각에서도 남는다.
 * ⚠**끝에서는 누를 수 없게 두되 자리는 남긴다** — 사라지면 줄이 흔들린다.
 */
function startersBar(base: string, d: StartersPageData): RawHtml {
  const step = (date: string | null, label: string, cls: string): RawHtml => {
    const arrow = cls === "p" ? "←" : "→";
    const body = cls === "p"
      ? html`<span class="dayrow"><i aria-hidden="true">${arrow}</i>${label}</span>`
      : html`<span class="dayrow">${label}<i aria-hidden="true">${arrow}</i></span>`;
    /**
     * ⚠**기본 날짜는 `starters.html` 이지 `starters/그날.html` 이 아니다**(2026-08-18).
     * 기본 날짜의 페이지는 두 주소에 같은 화면이 생기지 않게 **만들지 않는다** —
     * 그래서 그쪽으로 가는 링크는 최상위를 가리켜야 한다. 빌드가 깨진 링크 1개로 잡았다.
     */
    const href = date === d.defaultDate ? `${base}starters.html` : `${base}starters/${date}.html`;
    return date === null
      ? html`<span class="daystep ${cls} off">${body}</span>`
      : html`<a class="daystep ${cls}" href="${href}">${body}<s>${fullDate(date)}</s></a>`;
  };
  return html`<nav class="daybar" aria-label="予告先発の日付">
  ${step(d.prev, "前の予告", "p")}
  <span class="daypick off">${d.dayCount}日分</span>
  ${step(d.next, "次の予告", "n")}
</nav>`;
}

export function renderStartersPage(d: StartersPageData, ctx: RenderContext): string {
  /**
   * ⚠**자기 경로를 스스로 말한다**(2026-08-18). 날짜별 화면은 `starters/YYYY-MM-DD.html` 로
   * **한 단계 깊은 곳**에 있는데 여기서 "starters.html" 로 고정하고 있었다 —
   * 그러면 상대 링크가 전부 `starters/players/…` 로 해석된다.
   * 빌드의 링크 검사가 **361건**을 잡았다(2026-08-18 실측). 잡아 준 덕에 배포 전에 알았다.
   */
  const self = d.isDayPage && d.gameDate !== null ? `starters/${d.gameDate}.html` : "starters.html";
  const { base, root, seasons, navTo } = ctx.paths(self);
  const isToday = d.gameDate !== null && d.gameDate === d.builtOn;
  // ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다.** 기다리는 것이 아니라 끝난 것이다
  const past = pastSeasonOf(seasons);

  const sideBlock = (side: ProbableSide, opponent: ProbableSide): RawHtml => html`<div class="sside"
  style="--chip:${side.color.base};--chip-ink:${side.color.ink}">
  <h3 class="sname"><i></i>${side.shortName}</h3>
  ${side.playerId === null || side.name === null
    ? html`<p class="empty">先発はまだ発表されていません。</p>`
    : html`<p class="spitcher"><a href="${base}players/${side.playerId}.html">${side.name}</a></p>
      ${side.summary === null
        ? html`<p class="empty">今季の登板記録がありません。</p>`
        : html`<dl class="srow">
            <!-- ⚠**SRP 가 맨 앞이다**(2026-08-18 유저 요청: 「SRP·SRC 는 세이버 중에선 항상 최우선」).
                 이 사이트가 직접 만든 지표이고, 방어율·WHIP·FIP 는 어디서나 볼 수 있다. -->
            ${side.summary.srp === null
              ? statText("SRP", NO_VALUE)
              : statSigned("SRP", side.summary.srp.value, side.summary.srp.denominator, denUnit("srp"))}
            ${statRateOuts("防御率", side.summary.era, 2)}
            ${statRateOuts("WHIP", side.summary.whip, 2)}
            ${statRateOuts("FIP", side.summary.fip, 2)}
            ${statText("投球回", innings(side.summary.outs))}
            ${statCount("登板", side.summary.games)}
            ${statCount("奪三振", side.summary.so)}
          </dl>`}
      ${matchupSection(side, opponent)}`}
</div>`;

  /**
   * 상대 타자 표 한 벌.
   *
   * ⚠**같은 표를 두 번 쓰지 않는다**(M1) — 今季와 通算이 모양이 같으므로 부품 하나로 그린다.
   * 두 벌로 두면 언젠가 한쪽만 고쳐진다.
   *
   * ⚠**打率에는 분모(打数)를 붙인다**(M2 · 2026-08-19 감사 P1 · 배포물 실측).
   * 예전에는 `avg3(m.avg.value)` 만 찍어서 `dist/starters.html` 전체에 「打数」가 **0회**였다.
   * 그런데 이 표에는 `打席`과 `安打`가 나란히 있어서, 읽는 사람이 그 둘을 나누면 표시값과
   * 어긋난다 — 실측 `万波 9打席 2安打 .250`(= 2/8) · `郡司 8打席 3安打 .429`(= 3/7).
   * **「분모 없음」이 아니라 「틀린 분모가 인접」한 상태**라 더 나쁘다.
   * ⚠**「打数」 열을 더하는 것이 아니라 값에 붙인다** — `assets.ts` 가 順位表에서 같은 판단을
   * 적어 뒀다(「인접」으로는 지켜지지 않으므로 값에 붙인다). 이 표는 좁은 화면에서 옆으로
   * 굴러가는 표라 열을 늘리면 打率 자체가 화면 밖으로 밀린다.
   * (선수 페이지의 対戦成績은 반대로 「打数」 열을 갖는다 — 거기는 정렬·좁히기가 되는 넓은 표라
   *  열이 하나 더 들어가고, 그래서 `den-units.test.ts` 가 두 갈래를 모두 인정한다.)
   * ⚠**분모는 `m.avg.denominator`(= `line.ab`)다.** `line.pa` 를 쓰면 값은 그대로인 채
   * 분모만 틀려서, 지금보다 **더 그럴듯한 거짓말**이 된다(`den-units.test.ts` 가 잡는다).
   */
  const matchupRows = (list: readonly MatchupRow[], side: ProbableSide, opponent: ProbableSide): RawHtml =>
    scroller(html`<table aria-label="${opponent.shortName}の打者一覧">
    <thead><tr><th class="l">${opponent.shortName}の打者</th><th>打席</th><th>安打</th><th>本塁打</th><th>三振</th><th>打率</th></tr></thead>
    <tbody>${list.map(
      (m) => html`<tr class="${m.line.pa < 10 ? "thin" : ""}">
        ${/* ⚠**「薄く」를 글자로도 말한다**(2026-08-20 감사 ③) — 색·그림자는 forced-colors 에서 사라진다 */ ""}
        <td class="l"><a href="${base}players/${m.opponentId}.html?vs=${encodeURIComponent(side.playerId ?? "")}#b-matchup">${m.opponentName}</a>${thinMark(m.line.pa < 10, "10打席未満")}</td>
        <td>${m.line.pa}</td><td>${m.line.h}</td><td>${m.line.hr}</td><td>${m.line.so}</td>
        <td class="wd">${valueWithDen(m.avg, "打数", 3)}</td>
      </tr>`,
    )}</tbody>
  </table>`);

  /**
   * **今季 ↔ 通算** 전환.
   *
   * ⚠**표시하는 선수는 현역으로 한정된다**(2026-08-18 유저 요청). 상대 팀 소속으로 거르는데
   * 그 소속은 **그 시즌의 것**이라, 은퇴·이적한 선수는 목록에 들어오지 못한다 —
   * 통산 쪽에도 같은 필터가 걸려 있다(`query.ts` 의 `opponentsCareer`).
   * ⚠**「通算」이 아니다.** 우리가 가진 시즌(`heldFrom`~)의 합계일 뿐이고,
   *   그 이전의 대전은 들어 있지 않다 — 그래서 라벨이 「2019年〜」처럼 **범위를 말한다**.
   *   CLAUDE.md 가 금지하는 「우리 보유분을 통산이라고 부르기」를 처음에 그대로 했다가 고쳤다.
   * ⚠**끝은 「보고 있는 시즌까지」다.** 2022년 화면이 2026년 기록을 더하면 미래를 말하게 된다.
   * ⚠**대회는 안 섞는다**(§2-1) — 정규시즌끼리만 더한다.
   * ⚠**둘 다 비면 토글을 만들지 않는다**(M12) — 누를 것이 없는 조작은 고장으로 읽힌다.
   */
  const matchupSection = (side: ProbableSide, opponent: ProbableSide): RawHtml => {
    if (side.opponents.length === 0 && side.opponentsCareer.length === 0) {
      return html`<p class="empty">${opponent.shortName}の打者との対戦記録はまだありません。</p>`;
    }
    const group = `mu-${side.teamCode}-${opponent.teamCode}`;
    return html`<div class="muwrap">
      <div class="muswitch">${tablist(
      group,
      [
        { id: "season", label: "今季" },
        // ⚠**「通算」이라고 쓰지 않는다** — 우리가 가진 시즌의 합계일 뿐이다
        { id: "career", label: `${d.heldFrom}年〜` },
      ],
      false,
      "集計する範囲",
    )}</div>
      ${panel(group, "season", true, side.opponents.length === 0
      ? html`<p class="empty">今季の対戦はまだありません。</p>`
      : matchupRows(side.opponents, side, opponent))}
      ${panel(group, "career", false, side.opponentsCareer.length === 0
      ? html`<p class="empty">${d.heldFrom}年以降の対戦記録がありません。</p>`
      : matchupRows(side.opponentsCareer, side, opponent))}
    </div>`;
  };

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">予告先発</h1>
    <span class="sub">${d.gameDate === null
      ? past ? "終了したシーズンです" : "発表待ち"
      : `${fullDate(d.gameDate)}${isToday ? "（本日）" : ""}の試合`}</span>
  </div>
  <span class="asof">成績は${fullDate(d.builtOn)}生成時点</span>
</header>

${d.dayCount <= 1 ? raw("") : startersBar(base, d)}

${d.gameDate === null || d.games.length === 0
    ? html`<section class="block"><p class="empty">${past
      ? "このシーズンの予告先発は記録していません。予告先発の保存を始めたのが今シーズンからです。"
      : "予告先発はまだ発表されていません。発表は前日〜当日です。"}</p></section>`
    : html`<div class="cards" role="tablist" data-tabgroup="starters" aria-label="試合">
    ${d.games.map(
      /**
       * ⚠**id 와 aria-controls 를 여기서 빠뜨렸었다**(2026-08-18 감사 P2).
       * 짝이 되는 패널은 `panel()` 이 만들고 그것은 무조건 `aria-labelledby` 를 붙이므로,
       * 여기에 `id` 가 없으면 **패널이 존재하지 않는 id 를 가리킨다** — 실측 6/6 전부 깨져 있었다.
       * ⚠**깨진 ARIA 참조는 없는 것보다 나쁘다**(parts.ts 가 같은 사고를 이미 적어 뒀다).
       * ⚠**id 를 여기서 새로 만들지 않는다**(M1) — `tabId`/`panelId` 한 벌만 쓴다.
       */
      (g, i) => html`<button class="card" type="button" role="tab" data-tab="${gameKey(g)}"
        id="${tabId("starters", gameKey(g))}" aria-controls="${panelId("starters", gameKey(g))}"
        aria-selected="${i === 0 ? "true" : "false"}">
      <span class="cbar"><i style="background:${g.sides[0].color.base}"></i><i style="background:${g.sides[1].color.base}"></i></span>
      <span class="ctxt"><b>${g.sides[0].shortName} − ${g.sides[1].shortName}</b>
        <s>${g.startTime ?? ""}${g.venue === null ? "" : ` ${g.venue}`}</s></span>
    </button>`,
    )}
    ${/* ⚠**「すべて」는 패널이 하나가 아니다** — `aria-controls` 는 공백 구분 id 목록을 받는다 */ ""}
    <button class="card all" type="button" role="tab" data-tab="all" aria-selected="false"
      id="${tabId("starters", "all")}"
      aria-controls="${d.games.map((g) => panelId("starters", gameKey(g))).join(" ")}">
      <span class="ctxt"><b>すべて</b><s>${d.games.length}試合</s></span>
    </button>
  </div>
${d.games.map((g, i) =>
      panel(
        "starters",
        gameKey(g),
        i === 0,
        html`<section class="block" id="${startersAnchor(gameKey(g))}">
      <h2>${g.sides[0].shortName} 対 ${g.sides[1].shortName}<span class="qt">${g.venue ?? ""}${g.startTime === null ? "" : ` ${g.startTime}`}</span></h2>
      <div class="starters">
        ${sideBlock(g.sides[0], g.sides[1])}
        ${sideBlock(g.sides[1], g.sides[0])}
      </div>
    </section>`,
      ),
    )}`}

<section class="block">
  <h2>この画面について</h2>
  ${note(
    "予告先発は試合の前日〜当日に公表される情報です。当サイトは1日1回の取得でこれを反映しており、" +
      "試合中の情報は取得していません。打順は試合前には分からないため、" +
      "「その投手と対戦したことがある相手球団の打者」を打席数の多い順に並べています。" +
      `10打席未満は名前に**${THIN_MARK}**を付け、薄く表示しています。選手名を押すと、その投手との対戦成績を開いた状態でページが開きます。`,
  )}
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}matchup.html">対戦を選ぶ</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `予告先発${d.gameDate === null ? "" : ` — ${fullDate(d.gameDate)}`}`,
    base,
    root,
    seasons,
    navTo,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
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

/**
 * 빠른 선택에 쓰는 **하루**.
 *
 * ⚠**두 날을 나란히 둔다**(2026-08-17 유저 요청: 「오늘, 내일을 토글」).
 * 予告先発 페이지는 **한 날짜만** 보여주므로(실측: 아침엔 오늘, 저녁엔 내일),
 * 예고가 붙는 날은 하나뿐이다. 나머지 날은 **일정에서 두 팀만** 안다 —
 * 그 차이를 화면이 말해야 한다(M11: 「예고가 없다」와 「경기가 없다」는 다르다).
 */
/**
 * 그 날에 무엇을 아는가. ⚠**넷을 구별한다**(M12 · 2026-08-17 유저 지적).
 * · `games`     — 경기가 있다(예고는 있을 수도 없을 수도)
 * · `played`    — 그 날 경기는 이미 끝났다
 * · `noGames`   — 일정을 받았고, 그 날은 **정말로** 경기가 없다(월요일 등)
 * · `unknown`   — 그 날 일정을 **아직 안 받았다**. 「없다」가 아니다
 */
export type MatchupDayState = "games" | "played" | "noGames" | "unknown" | "seasonOver";

export interface MatchupDay {
  /** `YYYY-MM-DD` */
  date: string;
  state: MatchupDayState;
  /** 이 날에 予告先発이 붙어 있는가. 없으면 팀 목록에서 고른다 */
  hasProbable: boolean;
  games: MatchupGame[];
}

export interface MatchupPageData {
  season: number;
  asOf: string | null;
  /** 사이트 생성일. 「本日」·「明日」를 판정한다 */
  builtOn: string;
  /**
   * **오늘과 내일. 늘 두 칸이다.**
   *
   * ⚠**데이터에 따라 칸이 바뀌지 않는다**(2026-08-17 유저 지적:
   * 「경기가 있든지 없든지 날짜 기준으로 오늘과 내일을 토글할 수 있게 하면 되지 않아?」).
   * 예전에는 「예고가 가리키는 날 + 다음 경기일」이라 **탭의 뜻이 데이터에 따라 움직였다** —
   * 월요일에는 어제 날짜가 나오고, 어떤 날은 토글이 아예 사라졌다.
   * 자리를 고정하고 **각 칸이 자기 상태를 말하게** 하는 편이 예측 가능하다.
   */
  days: [MatchupDay, MatchupDay];
}

/**
 * 「対戦を選ぶ」 — 경기를 보면서 쓰는 화면.
 *
 * ⚠**라이브 데이터를 취득하지 않는다.** 경기를 보는 사람은 지금 누가 던지고 누가 치는지
 * 이미 알고 있다. 그 사실을 우리가 가져오면 데이터 권리 3층(정보의 신선도 이용)과
 * 4층(규정)에 걸리고, 필요한 폴링은 L1을 100배 벗어난다.
 * 근거: `docs/decisions/2026-08-15-live-matchup-feasibility.md`
 */
/**
 * 그 날에 대해 **아는 것**을 말한다.
 *
 * ⚠**「경기가 없다」와 「모른다」를 섞지 않는다**(M12 · 2026-08-17 유저 지적).
 * 월요일처럼 정말 비어 있는 날과, 그 달 일정을 아직 안 받은 경우는 다른 말이다 —
 * 화면에서는 둘 다 「빈 칸」으로 보이므로 **글자로 갈라야** 한다.
 */
export function dayStateNote(day: MatchupDay): string {
  switch (day.state) {
    case "games":
      return day.hasProbable ? "" : "※この日の予告先発はまだ発表されていません";
    case "played":
      return "この日の試合は終わっています。結果は「試合」の画面にあります。";
    case "noGames":
      return "この日は試合がありません。";
    case "unknown":
      return "⚠この日の日程はまだ取り込んでいません — 「試合が無い」という意味ではありません。";
    case "seasonOver":
      /**
       * ⚠**끝난 시즌에 「아직 안 받았다」라고 쓰면 거짓말이다**(2026-08-18 감사 P1).
       * 2022 시즌 화면이 2026년 날짜를 고르라고 내밀고 있었다 —
       * 같은 페이지의 머리띠는 「終了したシーズンです」라고 말하는데.
       */
      return "このシーズンは終了しています。上のシーズン切り替えで今季に移れます。";
  }
}

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
  /**
   * ⚠**기본은 접힘이다**(2026-08-17 유저 지적).
   * 한 경기를 고르면 **구단 2개 × 投手/打者 = 네 목록**이 한꺼번에 펼쳐진다 —
   * 고르러 온 사람이 먼저 벽을 만난다.
   * 접어 두면 화면에는 「어느 구단의 무엇이 몇 명」만 남고, 필요한 하나만 연다.
   *
   * ⚠**분모를 정확히 적는다**(작업규칙 7). 처음 여기에 「한 화면에 815개」라고 썼는데
   * **815는 문서 전체(경기 6개분)의 수**다. 경기 패널은 첫 경기만 열려 있으므로
   * 실제로 한 번에 보이는 것은 **한 경기분**이다 — 2026-08-16 자 실측으로
   * 対戦·比較 각각 **문서 815개 / 화면 129개 · 접히는 목록 4개**였다.
   * 815든 129든 접을 이유는 그대로지만, 틀린 수를 근거로 남기면 다음 사람이 그걸 믿는다.
   *
   * ⚠**`details` 를 쓴다 — 스크립트가 죽어도 열린다**(§0-1).
   * JS 로 접으면 스크립트가 없는 브라우저에서 **영영 닫힌 채**가 되어 이 화면이 통째로 죽는다.
   * ⚠**사람 수를 요약에 남긴다.** 접힌 채로도 「28人」이 보여야 열지 말지 판단할 수 있다.
   */
  const list = (label: string, role: "pitcher" | "batter", picks: MatchupPick[]): RawHtml =>
    picks.length === 0
      ? html`<p class="picklab">${label}</p><p class="empty">今季の記録がありません。</p>`
      : html`<details class="pickfold">
        <summary class="picklab">${label}<s>${picks.length}人</s></summary>
        <div class="picklist" role="toolbar" aria-orientation="horizontal"
          aria-label="${t.shortName}の${label}（左右キーで移動）">${picks.map((p) => pickButton(p, role, t))}</div>
      </details>`;
  return html`<div class="pickteam" style="--chip:${t.color.base};--chip-ink:${t.color.ink}">
  <h3 class="picktm"><i></i>${t.shortName}</h3>
  ${list("投手", "pitcher", t.pitchers)}
  ${list("打者", "batter", t.batters)}
</div>`;
}

export function renderMatchupPage(d: MatchupPageData, ctx: RenderContext): string {
  const { base, root, seasons, navTo } = ctx.paths("matchup.html");
  // ⚠**listbox/combobox 를 쓰지 않는 이유는 `layout.ts` 의 검색 상자에 적혀 있다**(한 벌만 적는다).
  //   여기·`compare.ts`·`layout.ts` 세 곳이 같은 구조이고, `layout.test.ts` 가 소스 전체를 센다.
  const side = (id: string, label: string, placeholder: string): RawHtml =>
    html`<div class="pickside">
    <label for="pick${id}">${label}</label>
    <div class="qbox">
      <input id="pick${id}" type="search" autocomplete="off" placeholder="${placeholder}">
      <ul class="qhits" id="pick${id}Hits" role="list" aria-label="${label}の候補" hidden></ul>
      <p class="vh" data-hitstatus role="status"></p>
    </div>
  </div>`;

  // ⚠끝난 시즌에서 「いま投げている投手を選ぶと」는 거짓말이다. 그 시즌에 진행 중인 경기는 없다
  const past = pastSeasonOf(seasons);
  /**
   * 그 날을 사람 말로.
   * ⚠**「本日」·「明日」는 생성일 기준이다**(M6 — 주입된 `builtOn`). 보는 시각이 아니라
   * **화면을 만든 날**이라, 그 사실을 날짜와 함께 낸다. 날짜가 없으면 어제 만든 화면을
   * 오늘 보는 사람이 「明日」를 오늘로 읽는다.
   */
  const dayLabel = (date: string): string => {
    const t = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${d.builtOn}T00:00:00Z`);
    const days = Math.round(t / 86_400_000);
    const rel = days === 0 ? "本日" : days === 1 ? "明日" : null;
    return rel === null ? fullDate(date) : `${rel}（${fullDate(date)}）`;
  };
  /** 어느 날에든 고를 경기가 있는가. **날 자체는 늘 둘이다** */
  const hasDays = d.days.some((x) => x.games.length > 0);

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">対戦を選ぶ</h1>
    <span class="sub">${d.season}年 · 投手と打者を選ぶと、これまでの対戦成績が出ます</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="block" id="pickForm">
  <h2>投手と打者</h2>
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

  <!-- ⚠**경기가 없어도 이 블록을 그린다**(2026-08-17 유저 지적).
       예전에는 고를 경기가 하나도 없으면 블록째 사라졌고, 그러면
       **「없다」는 말까지 함께 사라졌다** — 요청은 정확히 그 반대였다.
       날짜 두 칸은 늘 있고, 각 칸이 자기 상태를 말한다(M12). -->
  ${html`<div id="pickToday">
    <!-- ⚠**날짜 토글**(2026-08-17 유저 요청). 予告先発 페이지는 한 날짜만 보여주므로
         예고가 붙는 날은 하나뿐이고, 다른 날은 **두 팀만** 안다 — 화면이 그 차이를 말한다. -->
    <!-- ⚠**자리는 늘 오늘·내일 두 칸이다.** 데이터에 따라 칸이 바뀌면
         같은 자리를 눌러도 다른 것이 열려 손이 기억한 자리가 깨진다. -->
    <!-- ⚠**이름을 여기 두지 않는다**(2026-08-18 감사 P3). 안쪽 tablist 가 같은 이름을 갖고 있어서
         낭독기가 「日にち ナビゲーション · 日にち タブリスト」처럼 두 번 말했다.
         이름은 **위젯 쪽**에 남긴다 — 조작하는 것이 그쪽이다. -->
    <div class="pickday">${tablist(
      "pickday",
      d.days.map((x) => ({ id: x.date, label: dayLabel(x.date) })),
      true,
      "日にち",
    )}</div>
    ${d.days.map((day, di) =>
      panel(
        "pickday",
        day.date,
        di === 0,
        html`<p class="picknote${day.state === "games" ? "" : " pmiss"}">${
          day.games.length === 0 ? "" : `${fullDate(day.date)}の対戦から選ぶ　`
        }${dayStateNote(day)}</p>
    <!-- ⚠**여기에 sticky를 걸지 않는다.** 바로 위의 pickbar가 이미 sticky라
         둘 다 붙으면 같은 자리를 두고 겹친다. 경기 고르기는 한 번 하고 끝나는 조작이다 -->
    <div class="pickgames">${tablist(
          `pickgame-${day.date}`,
          day.games.map((g) => ({ id: g.key, label: `${g.sides[0].shortName} − ${g.sides[1].shortName}` })),
          true,
          "試合",
        )}</div>
    ${day.games.map((g, i) =>
          panel(
            `pickgame-${day.date}`,
            g.key,
            i === 0,
            html`<div class="pickteams">${pickTeam(g.sides[0])}${pickTeam(g.sides[1])}</div>`,
          ),
        )}`,
      ),
    )}
  </div>`}

  ${note(
    (past
      ? `${d.season}年は終了したシーズンです。投手と打者を選ぶと、そのシーズンの対戦成績（と打者のスプリット）が開きます。`
      : "試合を見ながら使う画面です。いま投げている投手と打っている打者を選ぶと、" +
        "その二人のこれまでの対戦成績（と打者のスプリット）が開きます。") +
      (!hasDays
        ? past
          ? "このシーズンの予告先発は記録していないため、名前でさがす形だけになっています。"
          : "本日・明日とも取り込めている試合がないため、名前でさがす形だけになっています。"
        : "ボタンに出しているのは今季その球団で記録のある選手です。並びは出場の多い順で、数字は打席数・投球回です。" +
          "そこにいない選手は上の「名前でさがす」から選べます。" +
          "日にちを切り替えると、その日に対戦する球団に変わります。" +
          // ⚠**「1일분이 있다」고 단정하지 않는다**(2026-08-18 감사 P3).
          //   날짜 패널 둘 다 「まだ発表されていません」인데 이 문장만 「1日分だけです」라고 말했다 —
          //   0일분인데 1일분이라고 쓰는 셈이다. **소스의 상한**을 말하는 문장으로 고친다.
          "予告先発は**多くても1日分**です — NPBの発表ページが1日分しか載せないためです。"),
  )}
</section>

<section class="block">
  <h2>この画面が試合中の情報を取りに行かない理由</h2>
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
  <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `対戦を選ぶ — ${d.season}年`,
    base,
    root,
    seasons,
    navTo,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
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
  /**
   * kana — 읽는 법 **원문**.
   *
   * ⚠**여기서 정규화하지 않는다.** 접기(대소문자·카타카나→히라가나)는 **클라이언트 한 벌**로 둔다 —
   * 질의어도 같은 함수로 접어야 맞는데, 빌드와 클라에 두 벌을 두면 어느 날 한쪽만 고쳐지고
   * **검색이 조용히 안 맞는다**(M1). 색인은 원문을 싣고 접기는 읽는 쪽이 한다.
   * ⚠**「히라가나」가 아니다** — 실측 858명 중 121명은 외국인 선수라 `ルーク・ボイト (LUKE VOIT)` 꼴이다.
   */
  k?: string;
  /**
   * uniform — 등번호. **문자열이다**(`00`이 실재한다).
   * ⚠**없으면 필드를 만들지 않는다**(M11). 없음은 「0번」이 아니라 **「지금 등록이 없다」**로,
   * **분모는 화면마다 다르다**(실측 2026-08-17): 화면에 실리는 색인은
   * 2026년 698명 중 **0명**, 2025년 721명 중 **76명**, 2024년 702명 중 **177명**이 없음이다.
   * (`player` 표 전체로는 980명 중 198명 — 그 수를 화면 근거로 쓰면 분모가 틀린다.)
   */
  u?: string;
}

export function searchIndexJson(entries: readonly SearchEntry[]): string {
  return JSON.stringify(entries);
}
