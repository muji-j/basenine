/**
 * 선수 비교 — 두 선수를 나란히 놓는다.
 *
 * ## ⚠이 화면이 만드는 새로운 거짓말의 위험
 *
 * 비교는 **없던 결론을 만들어낸다.** 선수 페이지는 「이 선수는 .312다」라고 말할 뿐이지만,
 * 비교 화면은 「A가 B보다 낫다」라고 말한다. 그래서 지켜야 할 것이 세 개 더 늘어난다.
 *
 * 1. ⚠**표본이 얇으면 우열을 말하지 않는다.** 20타석 .400과 500타석 .300을 나란히 놓고
 *    앞쪽에 승자 표시를 붙이면, 그건 M2를 화면 하나에서 통째로 어기는 것이다.
 *    등급을 매길 수 있는 표본(`grade.ts`의 `minSample`)에 **양쪽 다** 닿을 때만 우열을 표시한다.
 * 2. ⚠**잣대가 다른 둘을 겹치지 않는다.** 선발과 구원은 방어율 분포가 다르다(`grade.ts` §).
 *    비교 자체는 막지 않지만 **화면이 먼저 그 사실을 말한다.**
 * 3. ⚠**타자와 투수는 비교하지 않는다.** 공통 지표가 없다 — 억지로 늘어놓으면 전부 「—」인
 *    표가 나오고, 그건 답이 아니라 고장으로 보인다.
 *
 * ## 왜 값을 서버가 계산해 내보내는가
 *
 * 정적 사이트라 비교는 브라우저에서 조립된다. 그렇다고 **클라이언트가 지표를 계산하면
 * 산식이 두 벌이 된다**(M1). 구 PPS에서 파서가 3중 구현이었고 서로 값이 달랐던 그 실패다.
 * 그래서 여기서 만드는 것은 **이미 계산이 끝난 표시용 문자열**이고,
 * 브라우저는 배치만 한다. 계산도, 반올림도, 등급 판정도 하지 않는다.
 */
import { html } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, avg3, dec1, dec2, fullDate, innings, signed1 } from "./format.ts";
import { note } from "./parts.ts";
import { page } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { NEUTRAL_COLOR, shortNameOf } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import { SCALES, gradeOf } from "./grade.ts";
import type { Grade, GradeGroup } from "./grade.ts";
import { MARK_FIGURE_SIZE, isEmptyProfile, profileGeometry } from "./marks.ts";
import type { ProfileAxis } from "./marks.ts";
import type { PlayerPageData } from "./player-page.ts";

/**
 * 비교 한 줄.
 *
 * ⚠**필드 이름이 한 글자인 것은 선수마다 파일이 하나씩 나가기 때문**이다(695개).
 * 사람이 읽는 것은 이 파일이 아니라 화면이다.
 */
export interface CompareStat {
  /** 용어집 키. 툴팁이 여기에 붙는다(M1 — 설명을 여기서 새로 쓰지 않는다) */
  k: string;
  /** 화면 라벨 */
  l: string;
  /** 표시용 값. **이미 반올림이 끝났다.** 값이 없으면 `null`(M11 — 0과 다르다) */
  v: string | null;
  /** 분모 표기(`442打席`). 개수 지표는 `null` */
  d: string | null;
  /** 등급. 없으면 `null` — ⚠「보통」이 아니라 「매기지 않았다」 */
  g: Grade | null;
  /**
   * 어느 쪽이 좋은가. `1` 크면 좋다 · `-1` 작으면 좋다 · `0` **좋고 나쁨을 말하지 않는다**.
   * ⚠BABIP·개수 지표가 `0`이다. 여기에 승자 표시를 붙이면 화면이 근거 없는 말을 한다.
   */
  dir: 1 | -1 | 0;
  /** 우열 판정에 쓰는 원시 값. 없으면 `null` */
  n: number | null;
  /** 이 값의 표본. **등급 최소 표본에 닿는지 판정한다** */
  s: number;
  /** 등급을 매길 수 있는 최소 표본. 닿지 않으면 우열을 표시하지 않는다 */
  min: number | null;
}

/** 비교용 선수 카드 — `compare/{id}.json`의 내용 */
export interface CompareCard {
  id: string;
  name: string;
  team: string;
  teamName: string;
  color: { base: string; ink: string };
  league: string;
  position: string | null;
  season: number;
  /** 타자인가 투수인가. **다르면 비교하지 않는다** */
  role: "batter" | "pitcher";
  /** 어느 분포로 잰 등급인가. 투수는 선발/구원이 갈린다 */
  group: GradeGroup;
  /** 이 선수의 대표 표본(`442打席` / `100.1回`) */
  sample: string;
  /** 紋. 축이 3개 미만이면 null */
  mark: { outline: string; shape: string; size: number; labels: MarkLabel[] } | null;
  stats: CompareStat[];
}

export interface MarkLabel {
  x: number;
  y: number;
  anchor: string;
  text: string;
  /** 축의 값과 분모 — 도형 밑에 글자로도 낸다(M2) */
  value: string;
  sample: string;
}

function minSampleOf(metric: string, group: GradeGroup): number | null {
  return SCALES[group][metric]?.minSample ?? null;
}

function dirOf(metric: string, group: GradeGroup): 1 | -1 | 0 {
  const scale = SCALES[group][metric];
  // ⚠등급이 없는 지표는 방향도 없다. BABIP·SRC·개수 지표가 여기로 온다
  if (scale === undefined) return 0;
  return scale.higherIsBetter ? 1 : -1;
}

/** 비율 한 줄. `unit`은 분모의 단위 */
function rateStat(
  key: string,
  label: string,
  r: Rate,
  unit: string,
  digits: 2 | 3 | 1,
  group: GradeGroup,
  asInnings = false,
): CompareStat {
  return {
    k: key,
    l: label,
    v: r.value === null ? null : digits === 3 ? avg3(r.value) : digits === 2 ? dec2(r.value) : dec1(r.value),
    d: asInnings ? `${innings(r.denominator)}回` : `${r.denominator}${unit}`,
    g: gradeOf(key, r.value, r.denominator, group),
    dir: dirOf(key, group),
    n: r.value,
    s: r.denominator,
    min: minSampleOf(key, group),
  };
}

/**
 * 개수 한 줄.
 *
 * ⚠**개수에는 등급도 방향도 주지 않는다.** 안타 150개가 120개보다 「좋다」고 말하려면
 * 출장 기회가 같아야 하는데 같지 않다. 화면은 두 값을 나란히 보여주기만 한다.
 */
function countStat(key: string, label: string, n: number | null): CompareStat {
  return { k: key, l: label, v: n === null ? null : String(n), d: null, g: null, dir: 0, n, s: 0, min: null };
}

/** 0이 기준인 값(SRC·SRP). 부호를 붙이고 **등급은 주지 않는다** — 분포 근거가 아직 없다 */
function signedStat(key: string, label: string, n: number | null, sample: number, unit: string): CompareStat {
  return {
    k: key,
    l: label,
    v: n === null ? null : signed1(n),
    d: `${sample}${unit}`,
    g: null,
    // ⚠자체 지표라 남의 분포와 견줄 근거가 없다. 그래도 **큰 쪽이 좋다는 것은 정의상 참**이다
    dir: 1,
    n,
    s: sample,
    // 등급 척도가 없으므로 최소 표본도 없다 → 우열 표시가 붙지 않는다
    min: null,
  };
}

function markOf(axes: readonly ProfileAxis[]): CompareCard["mark"] {
  if (isEmptyProfile(axes) || axes.length < 3) return null;
  const g = profileGeometry(axes, MARK_FIGURE_SIZE);
  return {
    size: g.size,
    outline: g.outline,
    shape: g.shape,
    labels: axes.map((a, i) => {
      const q = g.axes[i]!;
      return {
        x: Number(q.label.x.toFixed(1)),
        y: Number(q.label.y.toFixed(1)),
        anchor: q.label.anchor,
        text: a.label,
        value: a.text,
        sample: a.sample,
      };
    }),
  };
}

/**
 * 선수 페이지 데이터에서 비교 카드를 뽑는다.
 *
 * ⚠**여기서 값을 새로 계산하지 않는다**(M1). 선수 페이지가 쓰는 것과 **같은 객체**를 받아
 * 표기만 바꾼다. 그래서 「선수 페이지의 .312와 비교 화면의 .311이 다르다」가 원리적으로 안 생긴다.
 */
export function compareCard(p: PlayerPageData): CompareCard {
  const group: GradeGroup = p.role === "pitcher" ? (p.pitching?.role ?? "starter") : "batter";
  const stats: CompareStat[] = [];

  if (p.role === "batter" && p.batting !== null) {
    const b = p.batting;
    stats.push(
      countStat("games", "試合", b.games),
      countStat("pa", "打席", b.line.pa),
      rateStat("avg", "打率", b.avg, "打数", 3, group),
      rateStat("obp", "出塁率", b.obp, "打席", 3, group),
      rateStat("slg", "長打率", b.slg, "打数", 3, group),
      rateStat("ops", "OPS", b.ops, "打席", 3, group),
      rateStat("woba", "wOBA", b.woba, "打席", 3, group),
      rateStat("wrcPlus", "wRC+", b.wrcPlus, "打席", 1, group),
      rateStat("iso", "ISO", b.iso, "打数", 3, group),
      rateStat("babip", "BABIP", b.babip, "打数", 3, group),
      rateStat("bbRate", "BB%", { value: b.bbRate.value, denominator: b.bbRate.denominator }, "打席", 3, group),
      rateStat("kRate", "K%", { value: b.kRate.value, denominator: b.kRate.denominator }, "打席", 3, group),
      countStat("h", "安打", b.line.h),
      countStat("hr", "本塁打", b.line.hr),
      countStat("rbi", "打点", b.rbi),
      countStat("sb", "盗塁", b.sb),
      signedStat("src", "SRC", b.src?.src ?? null, b.line.pa, "打席"),
    );
  } else if (p.role === "pitcher" && p.pitching !== null) {
    const q = p.pitching;
    stats.push(
      countStat("games", "登板", q.games),
      countStat("starts", "先発", q.starts),
      { ...countStat("innings", "投球回", q.line.outs), v: innings(q.line.outs) },
      rateStat("era", "防御率", q.era, "", 2, group, true),
      rateStat("whip", "WHIP", q.whip, "", 2, group, true),
      rateStat("fip", "FIP", q.fip, "", 2, group, true),
      rateStat("k9", "K/9", q.k9, "", 2, group, true),
      rateStat("bb9", "BB/9", q.bb9, "", 2, group, true),
      rateStat("hr9", "HR/9", q.hr9, "", 2, group, true),
      rateStat("pitchesPerOut", "球数/アウト", q.pitchesPerOut, "", 2, group, true),
      countStat("w", "勝利", q.decisions.w),
      countStat("l", "敗戦", q.decisions.l),
      countStat("sv", "セーブ", q.decisions.sv),
      countStat("hld", "ホールド", q.decisions.hld),
      countStat("so", "奪三振", q.line.so),
      countStat("pitches", "投球数", q.pitches),
      signedStat("srp", "SRP", q.srp?.srp ?? null, q.line.bf, "打者"),
    );
  }

  return {
    id: p.playerId,
    name: p.name,
    team: shortNameOf(p.teamCode),
    teamName: p.teamName,
    color: { base: p.color.base, ink: p.color.ink },
    league: p.leagueName,
    position: p.position,
    season: p.season,
    role: p.role,
    group,
    sample: p.mark.sampleText,
    mark: markOf(p.mark.axes),
    stats,
  };
}

export function compareCardJson(card: CompareCard): string {
  return JSON.stringify(card);
}

/**
 * 어느 쪽이 좋은가 — **또는 「말하지 않는다」**.
 *
 * ⚠**이 함수의 값어치는 `null`을 돌려주는 쪽에 있다.** 큰 값에 표시를 붙이는 것은 한 줄이면
 * 되지만, 붙이면 안 되는 자리에 붙이는 것이 이 화면의 유일한 큰 위험이다.
 *
 * 표시하지 않는 경우:
 * - `dir === 0` — 좋고 나쁨의 방향이 없는 지표(BABIP·안타 수·홈런 수 …)
 * - `min === null` — 등급 척도가 없는 지표(SRC·SRP). 분포 근거가 없으면 우열도 없다
 * - 어느 한쪽이라도 값이 없다
 * - **어느 한쪽이라도 표본이 최소치에 못 미친다** — 20타석 .400을 이기게 하지 않는다(M2)
 * - 값이 완전히 같다
 *
 * ⚠**동작이 클라이언트에도 있다**(`assets.ts`). 근거는 전부 서버가 실어 보낸 데이터
 * (`dir`·`min`·`s`·`n`)이므로 판정 기준 자체는 한 곳(`grade.ts`)에서 나온다.
 *
 * @returns `"a"` · `"b"` · `null`(우열을 말하지 않음)
 */
export function betterSide(a: CompareStat, b: CompareStat): "a" | "b" | null {
  if (a.dir === 0 || a.min === null) return null;
  if (a.n === null || b.n === null) return null;
  // ⚠**각자 자기 기준으로 잰다.** `b`에게 `a`의 최소 표본을 적용하면
  // 선발(90아웃)과 구원(60아웃)을 비교할 때 **入れかえ 버튼 하나로 판정이 뒤집힌다** —
  // 23이닝 선발이 21이닝 구원에게 「졌다」고 나오는데 정작 자기 등급 색은 없다.
  // (2026-08-16 이중 검토에서 지적. 서버·클라 대조 테스트가 **양쪽이 같은 방식으로 틀려서** 못 잡았다.)
  if (b.min === null) return null;
  if (a.s < a.min || b.s < b.min) return null;
  if (a.n === b.n) return null;
  const aWins = a.dir === 1 ? a.n > b.n : a.n < b.n;
  return aWins ? "a" : "b";
}

export interface ComparePageData {
  season: number;
  asOf: string | null;
}

/**
 * 「選手をくらべる」 화면.
 *
 * ⚠**서버가 그릴 수 있는 것이 없다** — 누구를 비교할지는 방문자가 정한다. 그래서 이 페이지의
 * 본문은 비어 있고, 대신 **비어 있는 이유와 조작 방법**이 서버 HTML로 들어간다.
 * 스크립트가 죽어도 「고장난 빈 페이지」가 아니라 「고를 것이 있는 페이지」로 보여야 한다(M12).
 */
export function renderComparePage(d: ComparePageData, ctx: RenderContext): string {
  const base = "";
  const side = (id: string, label: string, placeholder: string): RawHtml =>
    html`<div class="pickside">
    <label for="cmp${id}">${label}</label>
    <div class="qbox">
      <input id="cmp${id}" type="search" autocomplete="off" placeholder="${placeholder}"
        role="combobox" aria-expanded="false" aria-controls="cmp${id}Hits" aria-autocomplete="list">
      <ul class="qhits" id="cmp${id}Hits" role="listbox" aria-label="${label}の候補" hidden></ul>
    </div>
    <p class="chosen">選択中：<b id="cmp-${id.toLowerCase()}-chosen">未選択</b></p>
  </div>`;

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">選手をくらべる</span>
    <span class="sub">${d.season}年 · 二人を選ぶと成績を並べます</span>
  </div>
  <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
</header>

<section class="block" id="cmpForm">
  <h4>くらべる二人</h4>
  <div class="picker">
    ${side("A", "選手A", "例：佐藤")}
    ${side("B", "選手B", "例：村上")}
  </div>
  <p><button class="go" type="button" id="cmpGo" disabled>成績をくらべる</button>
  <button class="go alt" type="button" id="cmpSwap" disabled>入れかえ</button></p>
  ${note(
    "打者どうし・投手どうしで並べられます。打者と投手は共通の指標がないため並べません。" +
      "URLをそのまま共有すると、同じ二人を開いた状態になります。",
  )}
</section>

<div id="cmpOut" aria-live="polite"></div>

<section class="block">
  <h4>この画面が「勝ち負け」を出さないことがある理由</h4>
  <p class="note" style="max-width:64ch">
    数字が大きいほうに印をつけるのは簡単ですが、<b>母数が足りない側にそれをやると嘘になります</b>。
    20打席の .400 は 500打席の .300 より優れた打者だという意味ではありません。<br>
    そこで当サイトは、<b>両方が色づけの最低母数に届いたときだけ</b>どちらが上かを示します。
    届かないときは二つの数字を並べるだけにして、判断は見る人にお返しします。
    安打数や本塁打数のような「積み上がる数」にも印はつけません — 出場機会が違うからです。
  </p>
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}index.html">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}matchup.html">対戦を選ぶ</a>
</nav>`;

  return page({
    title: `選手をくらべる — ${d.season}年`,
    base,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "compare",
    body,
  });
}

/** 값이 없을 때 화면에 나가는 글자. 클라이언트와 **같은 문자**를 쓴다 */
export const COMPARE_NO_VALUE = NO_VALUE;
