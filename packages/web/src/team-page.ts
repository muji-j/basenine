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
import { NO_VALUE, avg3, fullDate, innings } from "./format.ts";
import { buttonGroup, columns, note, panel, scroller, tablist, term, valueWithDen } from "./parts.ts";
import { sortAttr, stableTable } from "./table.ts";
import type { SortColumn } from "./table.ts";
import { page, ROSTER_PATH } from "./layout.ts";
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
  /**
   * 세이버 지표 — **순위 화면이 내는 것과 같은 값**(M1).
   * 여기서 다시 계산하지 않고 `battingEntryOf` 한 입구를 그대로 쓴다.
   * ⚠SRC 만 별도 산출이라 없을 수 있다(그 선수의 타석 로그가 없으면 null).
   */
  woba: Rate;
  wrcPlus: Rate;
  wraa: Rate;
  src: Rate;
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
  /**
   * 세이버 지표 — 순위 화면과 같은 값(M1).
   * ⚠**투구수는 없을 수 있다**(M11) — 박스스코어에 실리지 않은 경기가 있다.
   * 0으로 메우면 「적게 던졌다」가 되므로 `null` 그대로 들고 다닌다.
   */
  fip: Rate;
  k9: Rate;
  bb9: Rate;
  srp: Rate;
  qs: number;
  pitches: number | null;
  /** 아웃 하나당 투구수. **낮을수록 좋다** — 다른 개수 지표와 방향이 반대다 */
  pitchesPerOut: Rate;
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

import { calendarBlock } from "./calendar.ts";
import type { CalendarData } from "./calendar.ts";

export interface TeamPageData {
  season: number;
  teamCode: string;
  name: string;
  shortName: string;
  color: TeamColor;
  leagueName: string;
  asOf: string | null;
  /**
   * 일정 캘린더 — **지난 경기와 앞으로의 경기를 한 장에**.
   * ⚠지난 것은 우리가 수집한 확정, 앞으로의 것은 NPB 공표 예정이다. 화면이 그 차이를 말한다.
   */
  calendar: CalendarData;
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
   * 「規定到達のみ」가 무엇을 자르는지 적는 글(M3).
   * ⚠**여기서 만들지 않고 받는다** — 순위 화면의 기준과 같은 함수에서 나와야 한다(M1).
   */
  batQualifier: string;
  pitQualifier: string;
  /**
   * 최근 경기(새 것이 앞). 날짜 화면으로 보낸다.
   * ⚠**주소를 데이터에 담지 않는다.** 이 화면은 `teams/` 아래(깊이 1)에 있는데
   * 데이터를 만드는 쪽은 자기가 어느 깊이에서 읽힐지 모른다 — 루트 기준으로 적으면
   * **240개가 통째로 404가 된다**(2026-08-16 실측). 깊이를 아는 것은 렌더러다.
   */
  recent: { date: string; opponent: string; home: boolean; result: string }[];
  /**
   * 상대 구단별 전적. **자기 자신은 들어 있지 않다.**
   *
   * ⚠**정규시즌만이다**(§2-1). 포스트시즌을 섞으면 어느 규칙에도 속하지 않는 수가 된다.
   * ⚠**무승부는 승률의 분모에서 빠진다**(NPB 규정) — 그래서 경기 수를 따로 들고 다닌다(M2).
   */
  vs: { code: string; shortName: string; color: TeamColor; w: number; l: number; t: number }[];
  /** 최신 경기일. `dayHref`가 그 날만 `today.html`로 보낸다 */
  latestDate: string | null;
  /** 이 시즌에 ポストシーズン 기록이 있는가 */
  hasPostseason: boolean;
}

/** 팀 페이지의 파일 경로. **한 곳에서만 만든다**(M1) — 갈리면 어딘가는 404다 */
export function teamPath(code: string): string {
  return `teams/${code}.html`;
}

/**
 * 탭 그룹 이름.
 *
 * ⚠**「화면마다 다른 이름」이 아니다.** 처음 그렇게 적었는데 `parts.ts`의 `tablist`가
 * 정반대를 기능으로 문서화하고 있다 — **같은 그룹을 쓰는 탭줄은 함께 움직인다**.
 * 순위표가 두 리그 구획에서 같은 그룹을 공유하는 것이 그 예다.
 * 진짜 규칙은 **뜻이 다른 탭줄에 같은 이름을 주지 마라**이다(2026-08-17 이중 검토).
 *
 * ⚠**선택은 그룹 이름 하나로 localStorage에 남는다**(`state.tabs[group]`).
 * 즉 이 이름이 **12구단 × 전 시즌의 구단 페이지 전부에서 공유**된다 —
 * 阪神에서 「投手」를 고르면 巨人 페이지도 「投手」로 열린다. **의도한 동작이다**:
 * 구단을 옮겨 다니며 같은 항목을 비교하는 것이 이 화면의 주 용법이다.
 *
 * 충돌 검사(2026-08-17 실측): 쓰이는 그룹 이름은
 * cmptoday · picktoday · starters · splits · pranking · rankleague · rankcat ·
 * ranktype · rankmetric · hicat-* · himetric-* · matchupMin · post · team — 겹침 0건.
 * (`ranktype`의 **패널 키**가 `"team"`이지만 키는 그룹 안으로만 스코프된다.)
 */
const TEAM_TABS = "team";

function wlt(x: { w: number; l: number; t: number }): string {
  return `${x.w}-${x.l}-${x.t}`;
}

/**
 * 값과 분모를 한 덩어리로.
 * ⚠**여기서 다시 만들지 않는다** — `valueWithDen`이 그 한 벌이다(M2의 구조적 강제).
 * 전에는 이 파일에 같은 일을 하는 함수가 따로 있어 **M2를 지키는 함수 자체가 세 벌**이 됐다.
 */
const rate = valueWithDen;

/**
 * 지표를 두 벌로 나눈다 — **한 표에 다 넣으면 打者 15열 · 投手 18열**이 된다.
 *
 * ⚠**「기본」이 먼저 열린다.** 이 화면에 오는 사람의 대부분은 안타·홈런·방어율을 보러 오고,
 * 세이버 지표는 **찾아서 보는 것**이다. 순서를 뒤집으면 이 화면이 전문가용이 된다.
 * ⚠**두 표는 같은 선수 집합이다** — 한쪽에만 있는 선수를 만들지 않는다.
 *   그렇지 않으면 「기본에는 있는데 세이버에는 없다」가 「기록이 없다」로 읽힌다(M11).
 */
const BAT_TABS = "teambat";
const PIT_TABS = "teampit";

/** 규정 도달 여부를 행에 싣는다 — 좁히기와 「薄く」가 **같은 근거**를 쓰게 한다 */
const qualAttr = (q: boolean): RawHtml => raw(q ? ' data-qualified="1"' : ' data-qualified="0"');

/**
 * 타자 표 한 벌.
 *
 * ⚠**정렬용 `data-*` 와 화면의 `<td>` 는 다른 값이다.** 화면은 `.286` 이고 정렬은 `0.2860` 이며,
 * 「기록 없음」은 화면에 `—` 이지만 정렬에는 **속성 자체가 없어야** 한다(M11).
 * `sortAttr` 한 벌이 그 규칙을 지킨다.
 */
function batterTable(rows: TeamBatter[], base: string, saber: boolean, qualifier: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">打者の記録がありません。</p>`;
  const cols: SortColumn[] = saber
    ? [
      { key: "name", label: "選手", left: true, text: true },
      { key: "pa", label: "打席" },
      // ⚠**SRC 가 세이버의 맨 앞이다**(2026-08-18 유저 요청: 「SRP·SRC 는 세이버 중에선 항상 최우선」).
      //   이 사이트가 직접 만든 지표이고, wRC+·wOBA 는 어디서나 볼 수 있다.
      //   ⚠분모(打席)를 바로 왼쪽에 둔 채로 옮긴다 — 값과 분모는 떨어지면 안 된다(M2).
      { key: "src", label: "SRC", rate: true },
      { key: "wrcplus", label: "wRC+", rate: true },
      { key: "woba", label: "wOBA", rate: true },
      { key: "wraa", label: "wRAA", rate: true },
      { key: "ops", label: "OPS", rate: true },
    ]
    : [
      { key: "name", label: "選手", left: true, text: true },
      { key: "games", label: "試合" },
      { key: "pa", label: "打席" },
      { key: "h", label: "安打" },
      { key: "hr", label: "本塁打" },
      { key: "rbi", label: "打点" },
      { key: "sb", label: "盗塁" },
      { key: "avg", label: "打率", rate: true },
      { key: "obp", label: "出塁率", rate: true },
      { key: "slg", label: "長打率", rate: true },
      { key: "ops", label: "OPS", rate: true },
    ];

  const body = (r: TeamBatter): RawHtml =>
    saber
      // ⚠**머리와 칸 수가 같아야 한다.** 여기 `打席` 칸이 빠져 있었고(머리는 있었다),
      // 그 결과 **모든 값이 한 칸씩 왼쪽으로 밀려** wOBA 자리에 wRAA 가 그려졌다.
      // 값이 틀린 것이 아니라 **머리가 거짓말을 하는** 상태라 눈으로는 잡히지 않는다 —
      // 순위 화면과 표시값을 대조해서야 나왔다(2026-08-17).
      ? html`<td class="b">${r.pa}</td>
      <td class="wd">${rate(r.wrcPlus, "打席", 1)}</td>
      <td class="wd">${rate(r.woba, "打席", 3)}</td>
      <td class="wd">${rate(r.wraa, "打席", 1)}</td>
      <td class="wd">${rate(r.src, "打席", 1)}</td>
      <td class="wd">${rate(r.ops, "打席", 3)}</td>`
      : html`<td>${r.games}</td><td class="b">${r.pa}</td><td>${r.h}</td><td>${r.hr}</td>
      <td>${r.rbi}</td><td>${r.sb}</td>
      <td class="wd">${rate(r.avg, "打数", 3)}</td>
      <td class="wd">${rate(r.obp, "打席", 3)}</td>
      <td class="wd">${rate(r.slg, "打数", 3)}</td>
      <td class="wd">${rate(r.ops, "打席", 3)}</td>`;

  return stableTable({
    id: saber ? "teambatsaber" : "teambat",
    columns: cols,
    sortKey: "pa",
    findLabel: "名前でしぼる",
    findPlaceholder: "例：佐藤",
    onlyQualified: { label: "規定到達のみ", qualifier },
    total: rows.length,
    unit: "人",
    emptyText: "この条件の打者はいません。",
    rows: html`${rows.map(
      (r) => html`<tr class="${r.qualified ? "" : "thin"}" data-name="${r.name}"${qualAttr(r.qualified)}
      ${raw(sortAttr("games", r.games))}${raw(sortAttr("pa", r.pa))}${raw(sortAttr("h", r.h))}${raw(sortAttr("hr", r.hr))}
      ${raw(sortAttr("rbi", r.rbi))}${raw(sortAttr("sb", r.sb))}
      ${raw(sortAttr("avg", r.avg.value, 4))}${raw(sortAttr("obp", r.obp.value, 4))}
      ${raw(sortAttr("slg", r.slg.value, 4))}${raw(sortAttr("ops", r.ops.value, 4))}
      ${raw(sortAttr("woba", r.woba.value, 4))}${raw(sortAttr("wrcplus", r.wrcPlus.value, 1))}
      ${raw(sortAttr("wraa", r.wraa.value, 2))}${raw(sortAttr("src", r.src.value, 2))}>
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      ${body(r)}
    </tr>`,
    )}`,
  });
}

function pitcherTable(rows: TeamPitcher[], base: string, saber: boolean, qualifier: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">投手の記録がありません。</p>`;
  const cols: SortColumn[] = saber
    ? [
      { key: "name", label: "選手", left: true, text: true },
      { key: "outs", label: "投球回" },
      // ⚠**SRP 가 세이버의 맨 앞이다**(위 타자 표와 같은 이유 · 2026-08-18)
      { key: "srp", label: "SRP", rate: true },
      { key: "fip", label: "FIP", rate: true },
      { key: "k9", label: "K/9", rate: true },
      { key: "bb9", label: "BB/9", rate: true },
      { key: "qs", label: "QS" },
      { key: "ppo", label: "球数/アウト", rate: true },
    ]
    : [
      { key: "name", label: "選手", left: true, text: true },
      { key: "role", label: "役割", left: true, text: true },
      { key: "games", label: "登板" },
      { key: "outs", label: "投球回" },
      { key: "w", label: "勝" },
      { key: "l", label: "敗" },
      { key: "sv", label: "S" },
      { key: "hld", label: "H" },
      { key: "so", label: "奪三振" },
      { key: "era", label: "防御率", rate: true },
      { key: "whip", label: "WHIP", rate: true },
    ];

  const body = (r: TeamPitcher): RawHtml =>
    saber
      ? html`<td class="b">${innings(r.outs)}</td>
      <td class="wd">${rate(r.fip, "回", 2)}</td>
      <td class="wd">${rate(r.k9, "回", 2)}</td>
      <td class="wd">${rate(r.bb9, "回", 2)}</td>
      ${/* ⚠**자릿수도 순위 화면과 맞춘다.** 여기만 1자리로 냈더니 같은 SRP 가
           순위에서 5.83, 구단에서 5.8 로 보였다 — 같은 값이 화면에 따라 달라 보이면
           어느 쪽이 맞는지 묻게 된다(2026-08-17 대조에서 발견) */ null}
      <td class="wd">${rate(r.srp, "打者", 2)}</td>
      <td>${r.qs}</td>
      <td class="wd">${rate(r.pitchesPerOut, "アウト", 2)}</td>`
      : html`<td class="l">${r.role === "starter" ? "先発" : "救援"}</td>
      <td>${r.games}</td><td class="b">${innings(r.outs)}</td>
      <td>${r.w}</td><td>${r.l}</td><td>${r.sv}</td><td>${r.hld}</td><td>${r.so}</td>
      <td class="wd">${rate(r.era, "回", 2)}</td>
      <td class="wd">${rate(r.whip, "回", 2)}</td>`;

  return stableTable({
    id: saber ? "teampitsaber" : "teampit",
    columns: cols,
    sortKey: "outs",
    findLabel: "名前でしぼる",
    findPlaceholder: "例：山本",
    onlyQualified: { label: "規定到達のみ", qualifier },
    total: rows.length,
    unit: "人",
    emptyText: "この条件の投手はいません。",
    rows: html`${rows.map(
      (r) => html`<tr class="${r.qualified ? "" : "thin"}" data-name="${r.name}"${qualAttr(r.qualified)}
      data-role="${r.role === "starter" ? "先発" : "救援"}"
      ${raw(sortAttr("games", r.games))}${raw(sortAttr("outs", r.outs))}${raw(sortAttr("w", r.w))}${raw(sortAttr("l", r.l))}
      ${raw(sortAttr("sv", r.sv))}${raw(sortAttr("hld", r.hld))}${raw(sortAttr("so", r.so))}${raw(sortAttr("qs", r.qs))}
      ${raw(sortAttr("era", r.era.value, 3))}${raw(sortAttr("whip", r.whip.value, 3))}${raw(sortAttr("fip", r.fip.value, 3))}
      ${raw(sortAttr("k9", r.k9.value, 3))}${raw(sortAttr("bb9", r.bb9.value, 3))}${raw(sortAttr("srp", r.srp.value, 2))}
      ${raw(sortAttr("ppo", r.pitchesPerOut.value, 3))}>
      <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
      ${body(r)}
    </tr>`,
    )}`,
  });
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
    path: ROSTER_PATH,
    label: "選手一覧",
  });

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${d.name}</h1>
    <span class="sub">${d.season}年 · ${d.leagueName}${d.rank === null
      ? ""
      : ` · ${d.rank}位${d.tiedRank ? "（同）" : ""}`} · ${wlt(d)}</span>
    <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
  </div>
</header>

<!-- ⚠**세로로 너무 길었다**(2026-08-17 유저 지적). 6구획이 한 줄로 이어져 있었고
     打者 46행 + 投手 30행이 대부분이었다 — 팀 성적을 보러 온 사람이 선수 76행을 지나야
     直近の試合에 닿았다. 세부 탭으로 나눈다.
     ⚠**탭 줄은 구단·시즌에 상관없이 늘 네 개다.** 있다 없다 하면 같은 자리를 눌러도
     다른 것이 열려 손이 기억한 자리가 깨진다.
     ⚠**그 대신 「탭은 있는데 안이 비었다」가 생긴다** — 눌렀는데 아무 말도 없는 화면은
     고장으로 읽힌다. 그래서 対戦은 비면 「対戦成績がありません」이라고 **말한다**(M12).
     탭 안에 든 구획(月別·直近)은 예전처럼 자리를 비우는 쪽이 맞다 — 옆에 チーム成績이
     남아 있어 화면이 통째로 비지 않기 때문이다. -->
<nav class="rail" aria-label="表示の切り替え">${tablist(
    TEAM_TABS,
    [
      { id: "sum", label: "成績" },
      { id: "cal", label: "日程" },
      { id: "bat", label: "打者" },
      { id: "pit", label: "投手" },
      { id: "vs", label: "対戦" },
    ],
    true,
    "球団ページの表示",
  )}</nav>

${panel(TEAM_TABS, "sum", true, html`<section class="block" id="b-teamsum">
  <h2>チーム成績<span class="qt">${d.games}試合</span></h2>
  ${columns(
    html`<dt>${term("勝率")}</dt><dd>${d.pct === null ? NO_VALUE : avg3(d.pct)}<span class="den">${d.w + d.l}試合</span></dd>
      <dt>ゲーム差</dt><dd>${d.gamesBehind === 0 ? NO_VALUE : d.gamesBehind.toFixed(1).replace(/\.0$/, "")}</dd>`,
    html`<dt>得点</dt><dd>${d.rf}<span class="den">${d.games}試合</span></dd>
      <dt>失点</dt><dd>${d.ra}<span class="den">${d.games}試合</span></dd>
      <dt>得失点差</dt><dd>${d.rf - d.ra >= 0 ? "+" : ""}${d.rf - d.ra}</dd>`,
    html`<dt>${term("打率")}</dt><dd>${rate(d.avg, "打数", 3)}</dd>
      <dt>${term("防御率")}</dt><dd>${rate(d.era, "回", 2)}</dd>`,
    // ⚠**승패 문자열은 수치와 다른 종류다.** 한 줄에 섞으면 자릿수가 안 맞아 표가 흔들린다 —
    // 그래서 같은 종류끼리 한 단으로 모은다
    html`<dt>ホーム</dt><dd>${wlt(d.home)}</dd>
      <dt>ビジター</dt><dd>${wlt(d.away)}</dd>
      <dt>直近10試合</dt><dd>${wlt(d.last10)}</dd>`,
  )}
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
  <h2>月別<span class="qt">勝-敗-分</span></h2>
  ${monthBars(d.months)}
</section>`}

${d.recent.length === 0
    ? raw("")
    : html`<section class="block" id="b-teamgames">
  <h2>直近の試合</h2>
  <ul class="trecent">${d.recent.map(
      (g) => html`<li class="${g.result === "○" ? "w" : g.result === "●" ? "l" : ""}">
    <a href="${dayHref(base, g.date, d.latestDate)}"><b>${g.result}</b><span>${fullDate(g.date)}</span>
    <s>${g.home ? "対" : "＠"}${g.opponent}</s></a>
  </li>`,
    )}</ul>
</section>`}`)}

${panel(TEAM_TABS, "cal", false, html`<section class="block" id="b-teamcal">
  <h2>日程<span class="qt">${d.calendar.months.length}か月</span></h2>
  ${calendarBlock(d.calendar, base)}
</section>`)}

${panel(TEAM_TABS, "bat", false, html`<section class="block" id="b-teambat">
  <h2>打者<span class="qt">${d.batters.length}人</span><span class="sw">${buttonGroup(
    BAT_TABS,
    [{ id: "basic", label: "基本" }, { id: "saber", label: "セイバー" }],
    "打者の指標",
    true,
  )}</span></h2>
  ${panel(BAT_TABS, "basic", true, batterTable(d.batters, base, false, d.batQualifier))}
  ${panel(BAT_TABS, "saber", false, batterTable(d.batters, base, true, d.batQualifier))}
  ${note(
    // ⚠**이 표는 「현재 로스터」가 아니다.** `battingByTeam`은 **그 구단에서 낸 몫**이라
    // 시즌 도중 떠난 선수도 남는다(실측 2026-08-16: 2026년 3구단·2025년 4구단).
    // 一覧 화면의 구단 묶음은 최신 소속 기준이라, 말하지 않으면 두 화면이 같은 로스터를
    // 다르게 말하게 된다 — 숫자가 아니라 **무엇을 세었는지**를 적어서 맞춘다
    "この球団で出場した記録です — シーズン途中に移籍した選手も、この球団での分だけ含みます。" +
      "見出しを押すと並べ替わります（もう一度押すと逆順）。" +
      `${d.batQualifier}に届いていない選手は薄く表示しています — 値は小さな標本のものです。`,
  )}
</section>`)}

${panel(TEAM_TABS, "pit", false, html`<section class="block" id="b-teampit">
  <h2>投手<span class="qt">${d.pitchers.length}人</span><span class="sw">${buttonGroup(
    PIT_TABS,
    [{ id: "basic", label: "基本" }, { id: "saber", label: "セイバー" }],
    "投手の指標",
    true,
  )}</span></h2>
  ${panel(PIT_TABS, "basic", true, pitcherTable(d.pitchers, base, false, d.pitQualifier))}
  ${panel(PIT_TABS, "saber", false, pitcherTable(d.pitchers, base, true, d.pitQualifier))}
  ${note(
    "この球団で登板した記録です — シーズン途中に移籍した投手も、この球団での分だけ含みます。" +
      "見出しを押すと並べ替わります（もう一度押すと逆順）。" +
      `${d.pitQualifier}。届いていない投手は薄く表示しています。`,
  )}
</section>`)}

${panel(TEAM_TABS, "vs", false, d.vs.length === 0
    // ⚠**제목을 붙인다.** 이것만 h2 가 없어서 「제목 없는 괘선 상자에 회색 한 줄」이었다 —
    // 打者·投手의 빈 상태는 제목이 무엇이 비었는지 말해 주는데 여기만 말하지 않았다.
    // noscript 로 넷이 다 펼쳐질 때는 直近の試合 과 打者 사이에 정체불명의 한 줄이 낀다.
    // ⚠id 는 붙이지 않는다 — `b-vs` 는 「표가 있다」는 뜻으로 쓰이고 있다(빈 표 금지 시험)
    ? html`<section class="block">
  <h2>対戦成績<span class="qt">レギュラーシーズン</span></h2>
  <p class="empty">対戦成績がありません。</p>
</section>`
    : html`<section class="block" id="b-vs">
  <h2>対戦成績<span class="qt">レギュラーシーズン</span></h2>
  <div class="scroller"><table class="vs">
    <thead><tr><th class="l">相手</th><th>勝</th><th>敗</th><th>分</th><th>試合</th><th class="l">勝敗</th></tr></thead>
    <tbody>${d.vs.map((v) => {
      const n = v.w + v.l + v.t;
      return html`<tr style="--chip:${v.color.base}">
      <td class="l tm"><i></i><a href="${v.code}.html">${v.shortName}</a></td>
      <td class="b">${v.w}</td><td>${v.l}</td><td>${v.t}</td>
      <td>${n}</td>
      <td class="l"><span class="vsbar" style="--w:${n === 0 ? 0 : Math.round((v.w / n) * 100)}"><i></i></span></td>
    </tr>`;
    })}</tbody>
  </table></div>
  ${note(
    "レギュラーシーズンのみです。**引き分けは勝率の分母に入りません**（NPBの規定）。" +
      "バーは勝った試合の割合で、目盛りはありません — 正確な数は左の勝・敗・分にあります。",
  )}
</section>`)}

<nav class="find" aria-label="ほかのページ">
  <a href="${base}ranking.html">リーグ順位表</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}today.html">試合</a>
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
