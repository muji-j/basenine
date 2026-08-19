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
import { byMetricOrder } from "./metric-order.ts";
// ⚠**분모 단위의 정본**(M1) — 화면이 문자열을 직접 적지 않는다
import { denUnit } from "./glossary.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, avg3, fullDate, innings } from "./format.ts";
import { block, buttonGroup, columns, note, panel, scroller, tablist, term, valueWithDen } from "./parts.ts";
import { sortAttr, stableTable } from "./table.ts";
import type { SortColumn } from "./table.ts";
import { page, ROSTER_PATH, TEAMS_PATH } from "./layout.ts";
import type { RenderContext } from "./pages.ts";
import { dayHref } from "./today-page.ts";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import type { TeamRace } from "@bb-app/aggregate";
// ⚠**여기서 다시 계산하지 않는다**(M1) — 홈 화면과 같은 한 벌을 팀으로 거른다(query.ts)
import type { HomeMilestone, HomeStreak } from "./home-page.ts";
// ⚠**제목 문자열도 홈 화면과 한 벌을 쓴다**(M1) — 손으로 복사하면 한쪽만 고쳐지는 사고가 난다
// (2026-08-20에 이 파일만 과거형으로 고쳐지고 홈이 안 갈린 사고가 실제로 났다)
import { milestoneSectionTitle, streakSectionTitle } from "./home-page.ts";

/**
 * 구단 페이지의 「続いている記録」·「記録に近づいている」에 싣는 행 수 — **홈의 한도와 별개다.**
 *
 * ⚠**같은 상수를 쓰면 안 되는 이유가 실측으로 났다**(2026-08-19). 처음 구현은 홈이
 * **전 리그 통합 상위 N**으로 자른 배열(연속 10명 · 근접 8명)을 `teamCode`로 거르기만 했다.
 * 배포물을 세어 보니 —
 * `b 1 · c 0 · d 0 · db 0 · e 2 · f 0 · g 0 · h 3 · l 2 · m 0 · s 1 · t 1`
 * → **12팀 중 6팀이 0건 · 최대 3건 · 합계 10건(= 홈 상위 10명 전부)**.
 * 구획 제목이 「続いている記録」인데 「ありません」이라고 쓰면 그 팀 팬은 **「우리 팀엔 없다」**로
 * 읽는다. 실제로는 있었고 리그 상위 10명에 못 든 것뿐이다 —
 * **M11이 금지하는 「없음」과 「안 쟀음」의 혼동**이고, 이 구획의 목적(「이 구단만의 정보」)을
 * 정면으로 깬다. → 홈은 홈대로, 구단은 **그 구단 안에서의 상위 N**으로 자른다.
 *
 * ⚠**값이 홈의 한도(연속 10 · 근접 8)보다 작으면 안 된다 — 그게 하한이다.** 작게 잡으면
 * **홈에는 보이는데 구단 페이지에는 없는 선수**가 생긴다 — 방향만 반대인 같은 거짓말이다.
 * 홈의 상위 N이 한 구단에 몰릴 수 있으므로, 하한은 **홈의 한도 그 자체**다.
 * ⚠**시험이 이 하한(10)을 못 박는다고 적었던 것은 틀렸다**(2026-08-19 검토에서 뮤테이션으로
 * 정정). `team-streaks-milestones.test.ts` 의 「구단 페이지 행 수 ≥ 홈이 그 팀에 대해 낸 행 수」는
 * **연속 픽스처를 g 10명·t 8명 비대칭으로 고친 뒤**(playerId 오름차순 타이브레이크로 홈 상위 10을
 * g 혼자 전부 차지하게 만든다) — `TEAM_STREAK_ROWS` 를 10→9 로 낮추면 실제로 떨어진다
 * (실측: `g: 구단 페이지의 연속 기록 9행 < 홈이 그 팀에 대해 낸 10행`). 처음 픽스처(t·g 각 8명
 * 균등 배분)는 홈 상위 10이 8/2 로 쪼개져 10→8 로 낮춰도 관련 시험 51본이 통과했다 — 그 낡은
 * 서술이 이 자리에 있었다.
 *
 * 그 위로 더 키우지 않는 근거는 **실측이다**(2026-08-19 · `data/bb.sqlite` · 2026 시즌
 * 2026-08-16 기준). 둘의 성질이 정반대다:
 * - **연속**: 팀별 후보가 `t2 g2 s2 db1 d0 c1 h4 l3 f2 b3 m2 e2` — **최대 4명**이라
 *   10 은 **지금 어느 팀도 건드리지 않는다**(= 전부 보여준다). 한도는 어느 팀에 몰렸을 때
 *   표가 길어지는 것만 막는 안전선이다. 고치기 전과 비교: 합계 **10 → 24건** · 0건 팀 **6 → 1**
 *   (남은 1팀 `d` 는 후보가 정말 0명이라 「ありません」이 참이다).
 * - **근접**: 팀별 후보가 **96~120명**이다(전 구단). 여기선 8 이 **실제로 자른다** —
 *   안 자르면 구단 페이지에 100행짜리 표가 선다.
 *   ⚠**대신 8번째 줄은 「あと50」쯤까지 멀어진다**(2026 실측 상위8의 꼬리 23~40 · 2018 은 50).
 *   홈의 8명(あと1~7)과 같은 「가까움」이 아니다. 화면이 남은 수를 매 줄에 그대로 적고
 *   각주가 「이 구단 안에서 남은 수가 적은 순」이라고 말하는 것이 그 대응이다(M2·M3의 정신).
 * ⚠**값을 바꾸면 아래 각주 문장도 같이 바뀐다** — 그래서 상수를 이 파일에 둔다(M3의 정신).
 */
export const TEAM_STREAK_ROWS = 10;
export const TEAM_MILESTONE_ROWS = 8;

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

/** 다음 경기 한 건. 없으면 `TeamNow.next` 가 `null` 이다 */
export interface TeamNextGame {
  /** `YYYY-MM-DD`(JST) */
  date: string;
  opponentCode: string;
  /** 짧은 표기(「広島」). 좁은 줄에 들어간다 */
  opponentName: string;
  /** 이 팀이 홈인가 */
  home: boolean;
  /** ⚠**빈 문자열은 「없음」이지 구장 이름이 아니다**(M11) — 없으면 `null` */
  venue: string | null;
  /** 미정이면 `null`(M11) */
  startTime: string | null;
}

/**
 * 「지금 이 팀」 — 구단 페이지 맨 위의 요약 띠가 쓰는 것.
 *
 * ⚠**`race` 의 각 필드는 뜻이 미묘하다.** `@bb-app/aggregate` 의 `TeamRace` JSDoc 이 정본이고,
 * 이 파일의 `raceVerdict` 가 그 뜻을 화면 문장으로 옮기는 **유일한 자리**다(M1).
 */
export interface TeamNow {
  race: TeamRace;
  /** 다음 경기. 없으면 `null`(시즌 종료 · 일정 미취득) */
  next: TeamNextGame | null;
  /**
   * 그 경기의 予告先発. 아직 없으면 `null` — **「投手なし」가 아니라 「発表待ち」다**(M11).
   * ⚠**`next` 의 경기에 대한 것만 들어온다.** 다른 날의 예고를 여기 넣으면
   * 화면이 끝난 경기의 선발을 「次の」라고 부르게 된다(`isNextProbable` 이 막던 결함).
   */
  probable: { mine: string | null; theirs: string | null } | null;
}

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
  /** 맨 위 요약 띠. **이 화면에 오는 사람이 가장 먼저 묻는 것** */
  now: TeamNow;
  /**
   * 이 팀의 연속 기록.
   *
   * ⚠**여기서 다시 계산하지 않는다**(M1) — 홈 화면(`home-page.ts`)과 **같은 한 벌**을
   * `teamCode`로 거르고 `TEAM_STREAK_ROWS` 로 자른 것이다(query.ts).
   * ⚠**홈이 자른 뒤의 배열이 아니다.** 그렇게 만들면 리그 상위 N에 못 든 구단이 통째로
   * 0건이 된다 — 실측과 사유는 `TEAM_STREAK_ROWS` 주석에 있다.
   * ⚠**0건이어도 구획을 지우지 않는다**(M12) — 「없다」와 「고장」이 같은 화면이면 결함이다.
   */
  streaks: HomeStreak[];
  /**
   * 이 팀의 기록 근접(통산 마디).
   *
   * ⚠**같은 이유로 여기서 다시 만들지 않는다**(M1) — 홈 화면과 같은 한 벌을 `teamCode`로
   * 거르고 `TEAM_MILESTONE_ROWS` 로 자른 것이다.
   */
  milestones: HomeMilestone[];
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

/**
 * 열 하나 = **머리와 칸을 같이** 들고 있는 것.
 *
 * ⚠**이 타입이 있는 이유가 사고 하나다**(2026-08-18 감사 P0 · 내가 만든 결함).
 * 열 순서를 `metric-order.ts` 로 옮기면서 `orderCols` 가 **머리만** 재정렬했고,
 * `<td>` 는 그 옆에 손으로 적힌 **옛 순서** 그대로였다. 칸 수는 같으니 표는 안 깨지고
 * **라벨만 거짓말을 했다** — 「打率 104」·「打席 0」처럼. 구단 4개 표 전부, 모든 시즌에서.
 * → 순서를 정하는 곳과 칸을 그리는 곳을 **하나로 묶는다**. 이제 따로 놀 자리가 없다.
 */
type Cell<T> = SortColumn & { cell: (r: T) => RawHtml };

/**
 * 열을 **정본 순서**로 세운다.
 *
 * ⚠**순서를 화면마다 손으로 적지 않는다**(M1 · 2026-08-18 유저 요청).
 * 같은 지표가 순위 탭과 구단 페이지에서 다른 자리에 있으면 읽는 사람이 두 번 배운다.
 * ⚠**이름표 열은 지표가 아니다** — `name`·`role` 은 정렬에서 빼고 원래 자리를 지킨다.
 *   그것들까지 정렬에 넣으면 「選手」가 표 한가운데로 간다.
 */
function orderCols<C extends SortColumn>(cols: readonly C[]): C[] {
  const LABELS = new Set(["name", "role"]);
  const head = cols.filter((c) => LABELS.has(c.key));
  const rest = byMetricOrder(cols.filter((c) => !LABELS.has(c.key)), (c) => c.key);
  return [...head, ...rest];
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
  /**
   * ⚠**순서는 metric-order.ts 한 벌이 정한다**(M1 · 2026-08-18 유저 요청).
   * 화면마다 순서가 달라서 같은 지표를 매번 다른 자리에서 찾아야 했다.
   * ⚠**첫 열(選手)은 지표가 아니라 이름표다** — 정렬에서 빼고 늘 맨 앞에 둔다.
   */
  const name = (r: TeamBatter): RawHtml =>
    html`<td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>`;

  const cols: Cell<TeamBatter>[] = orderCols(
    saber
    ? [
      { key: "name", label: "選手", left: true, text: true, cell: name },
      { key: "pa", label: "打席", cell: (r) => html`<td class="b">${r.pa}</td>` },
      // ⚠**SRC 가 세이버의 맨 앞이다**(2026-08-18 유저 요청: 「SRP·SRC 는 세이버 중에선 항상 최우선」).
      //   이 사이트가 직접 만든 지표이고, wRC+·wOBA 는 어디서나 볼 수 있다.
      // ⚠**분모 단위는 `glossary.ts` 의 `den` 이 정본이다**(M1 · 2026-08-20) — 여기서 적지 않는다.
      //   `打席` 라고 적어 두었던 wOBA 의 실제 분모는 `打数+四球−敬遠+死球+犠飛` 였고,
      //   같은 표의 `打席` 열과 다른 수인데 이름이 같았다.
      { key: "src", label: "SRC", rate: true, cell: (r) => html`<td class="wd">${rate(r.src, denUnit("src"), 1)}</td>` },
      { key: "wrcplus", label: "wRC+", rate: true, cell: (r) => html`<td class="wd">${rate(r.wrcPlus, denUnit("wrcPlus"), 1)}</td>` },
      { key: "woba", label: "wOBA", rate: true, cell: (r) => html`<td class="wd">${rate(r.woba, denUnit("woba"), 3)}</td>` },
      { key: "wraa", label: "wRAA", rate: true, cell: (r) => html`<td class="wd">${rate(r.wraa, denUnit("wraa"), 1)}</td>` },
      { key: "ops", label: "OPS", rate: true, cell: (r) => html`<td class="wd">${rate(r.ops, denUnit("ops"), 3)}</td>` },
    ]
    : [
      { key: "name", label: "選手", left: true, text: true, cell: name },
      { key: "games", label: "試合", cell: (r) => html`<td>${r.games}</td>` },
      { key: "pa", label: "打席", cell: (r) => html`<td class="b">${r.pa}</td>` },
      { key: "h", label: "安打", cell: (r) => html`<td>${r.h}</td>` },
      { key: "hr", label: "本塁打", cell: (r) => html`<td>${r.hr}</td>` },
      { key: "rbi", label: "打点", cell: (r) => html`<td>${r.rbi}</td>` },
      { key: "sb", label: "盗塁", cell: (r) => html`<td>${r.sb}</td>` },
      { key: "avg", label: "打率", rate: true, cell: (r) => html`<td class="wd">${rate(r.avg, denUnit("avg"), 3)}</td>` },
      { key: "obp", label: "出塁率", rate: true, cell: (r) => html`<td class="wd">${rate(r.obp, denUnit("obp"), 3)}</td>` },
      { key: "slg", label: "長打率", rate: true, cell: (r) => html`<td class="wd">${rate(r.slg, denUnit("slg"), 3)}</td>` },
      { key: "ops", label: "OPS", rate: true, cell: (r) => html`<td class="wd">${rate(r.ops, denUnit("ops"), 3)}</td>` },
    ]
  );

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
      ${cols.map((c) => c.cell(r))}
    </tr>`,
    )}`,
  });
}

function pitcherTable(rows: TeamPitcher[], base: string, saber: boolean, qualifier: string): RawHtml {
  if (rows.length === 0) return html`<p class="empty">投手の記録がありません。</p>`;
  const name = (r: TeamPitcher): RawHtml =>
    html`<td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>`;

  /**
   * ⚠**자릿수도 순위 화면과 맞춘다.** 여기만 1자리로 냈더니 같은 SRP 가
   * 순위에서 5.83, 구단에서 5.8 로 보였다 — 같은 값이 화면에 따라 달라 보이면
   * 어느 쪽이 맞는지 묻게 된다(2026-08-17 대조에서 발견).
   */
  const cols: Cell<TeamPitcher>[] = orderCols(
    saber
    ? [
      { key: "name", label: "選手", left: true, text: true, cell: name },
      { key: "outs", label: "投球回", cell: (r) => html`<td class="b">${innings(r.outs)}</td>` },
      // ⚠**SRP 가 세이버의 맨 앞이다**(위 타자 표와 같은 이유 · 2026-08-18)
      // ⚠**SRP 의 분모는 `打者` 가 아니라 `対戦打者` 다**(M1 · 2026-08-20) — 선수 페이지가
      //   `対戦打者` 라고 쓰는데 여기와 `compare/*.json` 은 `打者` 라 **356명**이 어긋나 있었다.
      { key: "srp", label: "SRP", rate: true, cell: (r) => html`<td class="wd">${rate(r.srp, denUnit("srp"), 2)}</td>` },
      { key: "fip", label: "FIP", rate: true, cell: (r) => html`<td class="wd">${rate(r.fip, denUnit("fip"), 2)}</td>` },
      { key: "k9", label: "K/9", rate: true, cell: (r) => html`<td class="wd">${rate(r.k9, denUnit("k9"), 2)}</td>` },
      { key: "bb9", label: "BB/9", rate: true, cell: (r) => html`<td class="wd">${rate(r.bb9, denUnit("bb9"), 2)}</td>` },
      { key: "qs", label: "QS", cell: (r) => html`<td>${r.qs}</td>` },
      /**
       * ⚠**球数/アウト만 용어집을 거치지 않는다** — 여기는 `415アウト`, 선수·比較 화면은
       * `138.1回` 로 갈려 있는데 **둘 다 참인 같은 수**다. 「사실과 다른 라벨」이 아니라
       * 어느 쪽을 정본으로 할지의 표시 판단이라, 이번 수정에서 혼자 정하지 않고 그대로 뒀다.
       * 정하면 `glossary.ts` 의 `den` 에 적고 여기도 `denUnit("pitchesPerOut")` 으로 바꿔라.
       */
      { key: "ppo", label: "球数/アウト", rate: true, cell: (r) => html`<td class="wd">${rate(r.pitchesPerOut, "アウト", 2)}</td>` },
    ]
    : [
      { key: "name", label: "選手", left: true, text: true, cell: name },
      { key: "role", label: "役割", left: true, text: true, cell: (r) => html`<td class="l">${r.role === "starter" ? "先発" : "救援"}</td>` },
      { key: "games", label: "登板", cell: (r) => html`<td>${r.games}</td>` },
      { key: "outs", label: "投球回", cell: (r) => html`<td class="b">${innings(r.outs)}</td>` },
      { key: "w", label: "勝", cell: (r) => html`<td>${r.w}</td>` },
      { key: "l", label: "敗", cell: (r) => html`<td>${r.l}</td>` },
      { key: "sv", label: "S", cell: (r) => html`<td>${r.sv}</td>` },
      { key: "hld", label: "H", cell: (r) => html`<td>${r.hld}</td>` },
      { key: "so", label: "奪三振", cell: (r) => html`<td>${r.so}</td>` },
      { key: "era", label: "防御率", rate: true, cell: (r) => html`<td class="wd">${rate(r.era, "回", 2)}</td>` },
      { key: "whip", label: "WHIP", rate: true, cell: (r) => html`<td class="wd">${rate(r.whip, "回", 2)}</td>` },
    ]
  );

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
      ${cols.map((c) => c.cell(r))}
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

/**
 * 우승 경쟁 한 줄 — **`TeamRace` 의 뜻을 화면 문장으로 옮기는 유일한 자리**(M1).
 *
 * ⚠**단정할 수 있는 것만 단정한다.** 값의 뜻은 `packages/aggregate/src/race.ts` 가
 * **증명해서** 정한 것이고, 그 증명보다 넓게 말하면 화면이 거짓말을 한다.
 *
 * - **`magic === 0` 은 「매직 0」이 아니라 「우승 확정」이다.** 같은 리그의 타팀이 전원 소멸이면
 *   「내 최악 > 전원의 최선」이 따라 나온다(race.ts 의 증명). 그대로 숫자로 흘리면
 *   **이미 우승한 팀 옆에 「マジック 0」**이 붙는다.
 * - **`magic === null` 의 뜻은 둘이다** — ⑴점등 조건 미충족(같은 리그에 자력이 살아 있는 팀이 있다)
 *   ⑵점등은 했는데 **승수식으로는 표현할 수 없다**(무승부가 많아 승수식과 승률식이 갈릴 때).
 *   ⚠**`null` 을 「점등 안 됨」으로만 읽지 마라.** 화면은 둘을 구별하지 않는다 —
 *   어느 쪽이든 「매직을 낼 수 없다」이고, 그때 말할 수 있는 것은 아래 자력·소멸 쪽이다.
 * - **`eliminated === false` 는 「가능성 있음」이 아니다.** 판정이 **쌍별(pairwise)**이라
 *   「쌍별로는 소멸이 증명되지 않았다」는 뜻이다 — 라이벌끼리도 맞붙기 때문에
 *   「누구도 혼자서는 나를 못 넘지만 그들 중 누군가는 반드시 이겨서 결국 넘는」 상태가 실재한다.
 *   정확한 판정에는 **최대유량**이 필요하다. → **「消滅」쪽만 단정하고 반대편은 단정하지 않는다.**
 * - **`selfPossible === true` 는 단정해도 된다.** `Σ h2hLeft = remaining` 이므로
 *   잔여를 전승하면 적어도 1위와 나란히 선다 — 이건 증명된다.
 * - ⚠**잔여가 0 이면 「自力優勝の可能性があります」라고 쓰지 않는다**(2026-08-19 전 시즌 빌드에서 발견).
 *   실측: **2022 퍼시픽의 `h`·`b` 가 76-65-2 로 완전히 같아** 둘 다 `selfPossible true · magic null ·
 *   eliminated false` 로 끝났고, 화면이 「シーズンの結果」라는 제목 아래 **현재형으로**
 *   「自力優勝の可能性があります」라고 말했다 — 이 리포가 予告先発·対戦 화면에서 이미 두 번 밟은 결함이다.
 *   잔여 0 에서 그 상태가 뜻하는 것은 **「어떤 팀도 승률로 나를 넘을 수 없다」**이다(증명:
 *   내 잔여가 0 이면 `Σ h2hLeft = 0` 이라 각 h2h 도 0 이고, 그러면 `selfPossible` 판정에 쓰인
 *   상대의 최선이 곧 **상대의 진짜 최선**이다 — 그게 내 승률을 넘은 적이 없다는 뜻).
 *   ⚠**그렇다고 「우승」이라고는 못 한다** — `magic === null` 이므로 동률이 남아 있고,
 *   NPB 는 그때 **당사자 간 대전 성적**으로 가른다(이 계산은 `standings.ts` 가 하고 여기는 안 한다).
 *   그래서 **시제가 없는 사실**만 쓴다.
 *   ⚠**이 문장은 `selfPossible === true` 일 때만 참이다**(2026-08-19 검토 Critical).
 *   위 증명의 마지막 절(「상대의 진짜 최선이 내 승률을 넘은 적이 없다」)이 **곧 `selfPossible === true`** 다.
 *   `false` 는 정확히 그 반대 — **「어떤 상대의 최선이 내 승률을 넘는다」**는 뜻이므로,
 *   그 상태에서 이 문장을 내면 **자기 증명의 전제가 깨진 채 결론만 출력**하는 것이 된다.
 *   재현(검토자 프로브 · 2026 · 12팀 6:6 · 교류전 3 완료 · `c2:c3` 만 22/25):
 *   ```
 *   c1 80-63-0 g=143 pct=.559 → rem 0 · self false · magic null · elim false
 *   c2 79-61-0 g=140 pct=.564 → rem 3 · self true  · magic 2
 *   ```
 *   `c1` 페이지가 「勝率で上回る球団はありません」을 냈는데 **`c2` 가 이미 `.564` 로 위에 있었고**
 *   같은 페이지 머리는 「2位」라고 썼다 — 한 구획 안에서 자기모순이다.
 *   ⚠**이건 NPB 시즌 최종주의 정상 상태다**(내 143경기는 끝났고 라이벌은 우천 재편성으로 남았다).
 *   완결 시즌에서 안 보인 이유는 전 팀이 143이라 `eliminated === true` 가 먼저 잡았기 때문일 뿐이다.
 *   ⚠**이 결함은 바로 위의 「2022 퍼시픽」 수정이 만들었다** — 작업규칙 10이 잡았어야 할 자리다.
 * - **잔여 0 · 자력 불가 · 미소멸**은 「自力優勝は消滅しました」로 떨어져도 **사실이지만 뜻이 흐리다.**
 *   잔여가 0 이면 「자력으로는 못 뒤집는다」가 아니라 **내가 할 수 있는 일이 남아 있지 않다**는 뜻이다 —
 *   그래서 별도 문구를 준다. ⚠**소멸은 여전히 단정하지 않는다**(쌍별 판정 · race.ts).
 * - **`selfPossible === null` 이면 판정 자체가 안 섰다.** ⚠**이유는 화면이 말하지 않는다** —
 *   「아직 유도 못 함(정상)」과 「입력이 어긋남(버그)」이 같은 신호라, 단정하면 틀린 이유를 말하게 된다.
 *   후자는 **빌드 로그**로 보낸다(`query.ts` 의 `disagreed` 경고 · M7의 나머지 절반).
 */
function raceVerdict(r: TeamRace): string {
  if (r.selfPossible === null) return "優勝争いはまだ判定できません";
  if (r.magic === 0) return "優勝が決まりました";
  if (r.magic !== null) return `優勝マジック ${r.magic}`;
  if (r.eliminated === true) return "優勝の可能性がなくなりました";
  // ⚠**잔여 0 에서는 「가능성」이라는 말을 쓰지 않는다**(위 JSDoc의 2022 퍼시픽 동률).
  //   `remaining === null` 이면 `selfPossible` 도 `null` 이라 이 줄에 오지 않는다(race.ts).
  // ⚠**`selfPossible` 을 반드시 같이 본다**(2026-08-19 검토 Critical). 이 문장의 증명이
  //   `selfPossible === true` 를 전제로 하기 때문이다 — 프로브 재현: `c1 80-63-0 g=143 .559`
  //   (rem 0 · self false)가 이 줄을 탔는데 같은 리그 `c2 79-61-0 g=140 .564`가 이미 위에 있었다.
  if (r.remaining === 0 && r.selfPossible) {
    // ⚠**「リーグに」를 넣는다**(2026-08-19 재검토 — 22d2470 이 놓친 것을 1차 검토도 놓쳤다).
    //   `race.ts` 의 비교는 **리그 내부에서만** 이뤄진다(`leagueOf(other) !== leagueOf(me)` 는 스킵).
    //   리그 한정이 없으면 문장이 「球団」을 전 리그로 읽어 실측으로 거짓이 된다:
    //   2022 `dist/teams/b.html`(오릭스 `.539`, 이 문장을 냄) ↔ 같은 저장소 `dist/2022/index.html`
    //   순위표의 **ヤクルト `.576`**(다른 리그) — 홈 → 구단 페이지 2클릭이면 두 문장이 부딪힌다.
    return "リーグに勝率で上回る球団はありません — 同率のときは当該球団間の対戦成績で順位が決まります";
  }
  if (r.selfPossible) return "自力優勝の可能性があります";
  // ⚠**잔여 0 · 자력 불가 · 미소멸** — 「自力優勝は消滅しました」라고 쓰면 사실이긴 해도
  //   「자력으로는」이라는 말이 **아직 할 일이 남은 것처럼** 읽힌다. 남은 경기가 0 이면
  //   내 손에 남은 것이 없고, 결과는 다른 구단의 경기로만 정해진다.
  if (r.remaining === 0) return "残り試合はありません — 他球団の結果次第です";
  return "自力優勝は消滅しました";
}

/**
 * 게임차 한 마디.
 *
 * ⚠**1위에게 「0.0ゲーム差」라고 쓰지 않는다.** 동률 2위도 0.0 이 나오므로 둘을 가른다.
 * ⚠**두 화면이 쓴다**(M1 · 구단 페이지 · 구단 목록). 같은 사실을 두 어법으로 말하면
 * 읽는 사람이 매번 다시 배운다 — 그래서 문장을 만드는 자리를 하나로 둔다.
 */
export function gamesBehindText(rank: number | null, gamesBehind: number): string {
  if (rank === null) return NO_VALUE;
  if (rank === 1) return "首位";
  return gamesBehind === 0 ? "首位とゲーム差なし" : `首位と${gamesBehind.toFixed(1)}ゲーム差`;
}

/**
 * 다음 경기 한 마디.
 *
 * ⚠**없어도 줄을 지우지 않는다**(M12).
 * ⚠**「아직 안 받았다」와 「끝났다」는 다른 말이다** — 캘린더가 이미 세워 둔 규칙을 따른다
 * (calendar.ts: 실측 48/48장이 끝난 시즌에 「まだ取り込んでいません」이라고 말하던 결함).
 * ⚠**두 화면이 쓴다**(M1 · 구단 페이지 · 구단 목록). 한쪽만 고치면 같은 경기가
 * 두 화면에서 다른 문장이 된다.
 */
export function nextGameText(next: TeamNextGame | null, seasonOver: boolean): string {
  if (next === null) {
    return seasonOver
      ? "このシーズンは終了しています"
      : "予定はありません（日程をまだ取り込んでいない場合もあります）";
  }
  return (
    `${fullDate(next.date)}${next.startTime === null ? "" : ` ${next.startTime}`}` +
    ` ${next.home ? "対" : "＠"}${next.opponentName}${next.venue === null ? "" : `（${next.venue}）`}`
  );
}

/**
 * 「지금 이 팀」.
 *
 * ⚠**이 화면에 오는 사람이 가장 먼저 묻는 것**이 여기 있어야 한다 —
 * 지금 몇 위인가, 얼마나 남았는가, 다음은 누구인가.
 * ⚠**모든 비율에 분모를 붙인다**(M2) — 승률의 분모는 `勝+敗`(무승부는 빠진다).
 * ⚠**탭 밖에 둔다.** 안에 넣으면 다른 탭을 골라 둔 사람에게는 이 띠가 안 보인다 —
 * 요약이 조건부로 사라지면 요약이 아니다.
 */
function nowBlock(d: TeamPageData, base: string): RawHtml {
  const n = d.now;

  const gbText = gamesBehindText(d.rank, d.gamesBehind);

  /**
   * 잔여 경기. ⚠**`null` 은 「모른다」이지 빈칸이 아니다**(M11·M12).
   * 그대로 템플릿에 넣으면 `html` 이 빈 문자열로 렌더해 **「残り 試合」**이 나간다 —
   * 그건 「모른다」가 아니라 **아무 말도 안 한 것**이다.
   */
  const remainingText = n.race.remaining === null
    ? "残りの試合数はわかりません"
    : `残り ${n.race.remaining}試合`;

  /** 다음 경기. **문장을 만드는 자리는 위의 `nextGameText` 하나다**(M1) */
  const nextText = nextGameText(n.next, d.calendar.seasonOver);

  /**
   * 予告先発. ⚠**「投手なし」가 아니라 「発表待ち」다**(M11).
   * ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다** — 기다리는 것이 아니라 끝난 것이다
   * (予告先発·対戦 화면이 이미 밟은 결함 · 2026-08-16 이중 검토 P2).
   * **다음 경기가 없으면 가리킬 경기 자체가 없으므로** 「기다린다」고 말할 자리가 아니다.
   */
  const probableText = n.next === null
    ? NO_VALUE
    : n.probable === null || (n.probable.mine === null && n.probable.theirs === null)
      ? "発表待ち"
      : `${n.probable.mine ?? "発表待ち"} ─ ${n.probable.theirs ?? "発表待ち"}`;

  return block({
    // ⚠끝난 시즌에 「いまの状況」이라고 쓰지 않는다 — 이 화면은 2018년도 그린다
    id: "tnow",
    title: d.calendar.seasonOver ? "シーズンの結果" : "いまの状況",
    body: html`<p class="tnow head">
    <b>${d.rank === null ? NO_VALUE : `${d.rank}位${d.tiedRank ? "（同）" : ""}`}</b>
    <span>${wlt(d)}</span>
    <span>勝率 ${valueWithDen({ value: d.pct, denominator: d.w + d.l }, "試合", 3)}</span>
    <span>${gbText}</span>
    <span>${remainingText}</span>
  </p>
  <p class="tnow"><s>直近10試合</s><b>${wlt(d.last10)}</b></p>
  <p class="tnow"><s>次の試合</s><b>${nextText}</b></p>
  <p class="tnow"><s>予告先発</s><b>${probableText}</b></p>
  <p class="tnow race">${raceVerdict(n.race)}</p>
  ${note(
      // ⚠**규칙이 코드에만 있으면 아무도 검증할 수 없다**(M3). 승률식(순위)과 승수식(매직)이
      // 갈린다는 것, 그리고 우리가 **무엇을 단정하지 않는지**를 화면이 말한다
      "順位は**勝率**（勝÷（勝＋敗）・引き分けは分母に入りません）で決まります。" +
        "マジックナンバーだけは慣例に従って**勝数**で数えるので、勝率の順位とずれることがあります。" +
        "「優勝が決まりました」は、残りを全部落としても順位が動かないことを計算で確かめた場合だけ出します。" +
        "「自力優勝」は残りを全部勝てば1位に並べるという意味です。" +
        "消滅していない場合でも、当サイトは**優勝の可能性があるとは言いません** — " +
        "相手どうしの対戦まで数え切る計算をしていないためです。",
    )}
  <p class="tgo">
    <a href="${base}ranking.html#stand-${d.teamCode}">順位表で見る</a>
    <a href="#b-teamcal">日程を見る</a>
    <a href="${base}${ROSTER_PATH}#hi-${d.teamCode}">選手一覧で見る</a>
    <a href="${base}starters.html">予告先発を見る</a>
    ${/* ⚠**최애를 해제할 수 있는 유일한 화면으로 돌아가는 길이다**(2026-08-19 T9 검토 ①).
          실측으로 `teams.html` 로 가는 링크는 **사이트 전체에서 내비 항목 하나뿐**이었다
          (앞 4,000장 전수 · 45개 디렉터리 표본 1장씩 · 전부 참조 1회). 그런데 최애를 지정하면
          **바로 그 하나가 구단 상세로 바뀐다** — 해제 버튼이 있는 화면에 갈 방법이 사라졌다.
          세션 안에서는 뒤로가기가 있지만 다음 방문에는 그것도 없다.
          ⚠**refreshFavTeam(낡은 사본 자기정정)도 같이 무력화되고 있었다** — 그건 구단 목록에
          서 있을 때만 도는데, 최애를 지정한 사용자는 그 화면에 다시 가지 못했다.
          경로 규칙이 바뀌는 날 고칠 기회가 오지 않는다.
          ⚠**HTML 주석으로 쓰지 않는다** — 구단 상세 108장에 매번 실린다(layout.ts 와 같은 규칙).
          ⚠**「もどる」라고 쓰지 않는다.** 여기 오는 길은 순위표·선수 페이지에도 있어서
          목록에서 온 사람이 아닐 수 있다 — 옆의 네 개와 같은 「〜を見る」로 맞춘다. */ ""}
    <a href="${base}${TEAMS_PATH}">球団一覧を見る</a>
  </p>`,
  });
}

/**
 * 이 팀의 연속 기록.
 *
 * ⚠**홈 화면과 같은 부품을 쓰지 않는다** — `teamChip`이 `home-page.ts`에서 내보내지 않아서다.
 * 이 화면은 이미 「이 팀」이므로 구단 칩이 필요 없다(다른 표들도 마찬가지다).
 * ⚠**0건이어도 구획을 지우지 않는다**(M12). 「이 팀은 없다」와 「고장」을 구별해야 한다.
 * ⚠**「継続中」이라는 말을 쓰지 않는다**(M1 · 홈 화면과 같은 규칙). 마지막 출장일만 그대로
 * 보여주고, 그 판단은 독자에게 맡긴다 — 화면이 대신 「継続中」이라 말하면 끊긴 기록이
 * 이어지는 것처럼 보일 수 있다.
 *
 * ⚠**끝난 시즌에 현재형으로 말하지 않는다**(2026-08-20 최종 검토 ③ · `nowBlock` 과 같은 규칙).
 * 바로 위 요약 띠는 `seasonOver` 로 「シーズンの結果」와 「いまの状況」을 갈랐는데
 * **그 옆줄인 이 구획은 안 갈렸다** — 작업규칙 10(자기 수정을 다시 읽는다)이 잡았어야 할 자리다.
 * 실측(2026-08-20 · `dist` 전수): 구단 페이지 **108장 중 96장이 끝난 시즌**인데
 * 제목은 **108/108 이 현재형**이었고, 그중 **77장**이 「この球団の続いている記録はありません」이라고
 * 썼다. 2018 화면이 **「지금 이어지고 있는 기록은 없습니다」**라고 말한 것이다.
 * ⚠**각주는 손대지 않는다** — 「最後の出場日を必ず併記しています」는 시제와 무관하게 참이다.
 */
function streakBlock(rows: readonly HomeStreak[], seasonOver: boolean): RawHtml {
  return block({
    id: "tstreak",
    title: streakSectionTitle(seasonOver),
    body: rows.length === 0
      ? seasonOver
        ? html`<p class="empty">この球団に、シーズン終了時点で続いていた記録はありません。</p>`
        : html`<p class="empty">この球団の続いている記録はありません。</p>`
      : html`${scroller(html`<table>
    <thead><tr><th class="l">選手</th><th class="l">記録</th><th>試合</th><th class="l">最後の出場</th></tr></thead>
    <tbody>${rows.map(
        (x) => html`<tr>
      <td class="l">${x.name}</td>
      <td class="l">${x.kind === "hitting" ? "連続安打" : "連続出塁"}</td>
      <td class="b">${x.games}</td>
      <td class="l">${x.lastGameDate === null ? NO_VALUE : fullDate(x.lastGameDate)}</td>
    </tr>`,
      )}</tbody>
  </table>`)}
  ${note(
        "**最後の出場日を必ず併記しています** — その日より後に試合があれば、記録はもう途切れているか、" +
          "本人が出ていないかのどちらかです。連続記録は「試合」単位で数えます（NPB・MLBの慣例）。" +
          "代走だけで出た試合は数えません。" +
          // ⚠**자르는 기준을 화면에 적는다**(M3의 정신) — 「왜 이 선수가 없지?」에 답할 수 있게
          `**この球団の中で試合数が多い順に${TEAM_STREAK_ROWS}人まで**です（リーグ全体の上位ではありません）。`,
      )}`,
  });
}

/**
 * 이 팀의 기록 근접(통산 마디).
 *
 * ⚠**출처가 다른 표다**(M4·홈 화면과 같은 주석) — 통산은 선수 페이지의 年度別成績(NPB 공표치)를
 * 당사이트가 더한 것이고, 이 화면의 다른 수는 우리 경기 기록에서 쌓은 값이다. 섞지 않는다.
 *
 * ⚠**여기도 끝난 시즌에 현재형으로 말하지 않는다**(2026-08-20 최종 검토 ③ · `streakBlock` 과 같은 규칙).
 * 실측으로 이 제목은 `dist` **108/108 이 현재형**이었다(끝난 시즌 96장 포함).
 * ⚠**과거형이 사실인 근거는 데이터 쪽에 있다** — `milestonesOf` 의 SQL 이 `WHERE c.year <= ?` 라
 * 이 값은 **그 시즌 종료 시점의 통산**이지 오늘의 통산이 아니다(query.ts). 「오늘 다가서 있다」가
 * 아니라 **「그때 다가서 있었다」**가 맞는 말이다.
 * ⚠**각주는 손대지 않는다** — 「今、選手ページがある選手だけ」는 대상 선정 규칙이라 시제와 무관하다.
 */
function milestoneBlock(rows: readonly HomeMilestone[], seasonOver: boolean): RawHtml {
  return block({
    id: "tmile",
    title: milestoneSectionTitle(seasonOver),
    qualifier: "通算",
    body: rows.length === 0
      ? seasonOver
        ? html`<p class="empty">この球団に、シーズン終了時点で記録に近づいていた選手はありません。</p>`
        : html`<p class="empty">この球団に記録に近づいている選手はありません。</p>`
      : html`${scroller(html`<table>
    <thead><tr><th class="l">選手</th><th class="l">記録</th><th>通算</th><th class="l">節目まで</th><th>今季</th></tr></thead>
    <tbody>${rows.map(
        (x) => html`<tr>
      <td class="l">${x.name}</td>
      <td class="l">${x.label}</td>
      <td class="b">${x.count}</td>
      <td class="l">${x.next}まであと<b>${x.toNext}</b></td>
      <td>${x.thisSeason}</td>
    </tr>`,
      )}</tbody>
  </table>`)}
  ${note(
        "⚠**この表だけ出典が違います** — 通算は選手ページの**年度別成績（NPBの公表値）**を当サイトが足したものです。" +
          "ほかの数字は当サイトが試合記録から積み上げた値で、混ぜていません。" +
          "**NPBの記録だけ**です — 海外リーグの期間はこの表に入りません。" +
          "**今、選手ページがある選手だけ**が対象です（引退した選手は含みません）。" +
          "**通算も今季も同じ年度別成績から取っています** — 出典が違う数字を並べると、引き算が合わなくなるからです。" +
          // ⚠**자르는 기준을 화면에 적는다**(M3의 정신)
          `**この球団の中で節目までの残りが少ない順に${TEAM_MILESTONE_ROWS}人まで**です（リーグ全体の上位ではありません）。` +
          "今季まだ0の項目は出していません。",
      )}`,
  });
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

<!-- ⚠**요약 띠는 탭 밖에 둔다.** 안에 넣으면 지난번에 「打者」를 골라 둔 사람에게는
     이 띠가 안 보인다 — 조건부로 사라지는 요약은 요약이 아니다.
     ⚠**여기서 우승 경쟁 판정이 처음으로 화면에 나온다.** 값의 뜻은 race.ts 가 증명해서
     정했고, 그 뜻을 문장으로 옮기는 자리는 raceVerdict 한 곳뿐이다(M1). -->
${nowBlock(d, base)}

<!-- ⚠**연속 기록·기록 근접도 탭 밖에 둔다** — 요약 띠와 같은 이유다. 홈 화면이 만든 배열을
     팀으로 거른 것뿐이고(M1 · query.ts), 여기서 다시 계산하지 않는다.
     ⚠**0건이어도 지우지 않는다**(M12) — 두 함수가 그 규칙을 지킨다.
     ⚠**seasonOver 를 넘긴다** — 위 요약 띠와 같은 근거를 쓴다(M1). 끝난 시즌에
     「続いている」·「近づいている」이라고 쓰면 2018 화면이 현재형으로 거짓을 말한다. -->
${streakBlock(d.streaks, d.calendar.seasonOver)}
${milestoneBlock(d.milestones, d.calendar.seasonOver)}

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
    html`<dt>${term("打率")}</dt><dd>${rate(d.avg, denUnit("avg"), 3)}</dd>
      <dt>${term("防御率")}</dt><dd>${rate(d.era, denUnit("era"), 2)}</dd>`,
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
    /**
     * ⚠**이 화면은 `球団` 구획 안에 있지만 그 링크가 가리키는 문서가 아니다.**
     * 기본값(`aria-current="page"`)으로 두면 **다른 문서(구단 목록)를 「지금 여기」라고
     * 말하는 것**이 된다 — 경기 상세가 `試合` 에서 이미 밟은 자리와 같은 결함이다.
     * (내비에 `球団` 항목이 생긴 2026-08-19 부터 실제로 나던 증상이다.)
     */
    navExact: false,
    /**
     * ⚠**이 화면이 어느 구단의 상세인가를 내비에 실어 보낸다**(2026-08-19 T9 검토 ④).
     * 최애를 지정하면 클라이언트가 그 링크의 목적지를 `teams/{최애}.html` 로 바꾸는데,
     * **바뀐 목적지가 이 문서인지**는 이 값 없이는 판정할 수 없다 —
     * 없으면 巨人 화면에서 「阪神」이라고 적힌 링크가 `aria-current="true"` 를 단 채 남는다.
     */
    navTeam: d.teamCode,
    body,
  });
}
