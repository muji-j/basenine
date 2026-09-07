/**
 * ホーム — 「今このリーグで何が起きているか」に一枚で答える。
 *
 * ⚠**이 화면은 「무엇을 아직 모르는지」도 말한다.** 우리가 경기에서 쌓은 것은 보유 시즌분뿐이라
 * **우리 수치를 합산해 「통산」이라고 부르지 않는다.**
 * 시즌 안에서 닫히는 것(시즌 홈런·시즌 도루·연속 경기)만 우리 수치로 낸다.
 *
 * ⚠**이 순위표는 マジックナンバー를 싣지 않는다.** 여기서 내는 것은 **정확히 계산되는 것**뿐이다 —
 * 잔여 경기(규정 경기수 − 소화)와, 전승·전패했을 때의 승률 범위.
 *
 * ⚠**「우리는 매직을 내지 않는다」는 낡은 서술이었다**(2026-08-17 확정 → 2026-08-19 정정).
 * 그때의 근거는 둘이었는데 **하나는 무효가 됐다**:
 * ⑴ ~~「잔여 맞대결 일정을 우리는 받지 않는다」~~ → **틀렸다.** 예정 일정이 아니라 **규칙**에서 낸다 —
 *    `deriveSeriesLengths`(aggregate/race.ts)가 대전표에서 규정 대전수를 유도하고,
 *    「규정 − 이미 치른 수」가 직접대결 잔여다. 실측으로 완결 7시즌 전 쌍이 예외 0건이었다.
 * ⑵ 「승률 순위 × 승수식 매직이라 매체마다 값이 갈린다」 → **여전히 참이다.**
 *    그래서 값을 감추는 대신 **화면이 「승수식임」을 말한다**(M3). `0` 은 증명된 우승 확정에만 쓴다.
 * → **구단 페이지(`team-page.ts` 의 `raceVerdict`)가 판정을 낸다.**
 *    여기에 **값을** 새로 넣지는 않았다 — 그건 별도의 표시 결정이다.
 *    ⚠**다만 「出していません」이라고 쓰지도 않는다.** 저장소가 두 곳에서 반대말을 하면 안 된다.
 *    ⚠**그리고 어디 있는지는 가리킨다**(2026-08-19 검토 m3). 지우기만 했더니 홈에
 *    매직을 가리키는 줄이 하나도 없어서, 여기서 우승 경쟁을 보던 사람이 「매직은?」이라고
 *    물으면 답이 없는 화면이 됐다. **포인터 한 줄은 값이 아니다.**
 *
 * ⚠**143은 가정이 아니라 실측이다**(2026-08-17). 2023·2025 두 시즌 모두 12구단 전원이
 * 정확히 143경기를 소화했다. 다만 **`status='played'` 만 세야 한다** — 우천 중지 행이 따로 남고
 * 재편성 경기가 또 한 행이라, 행 수로 세면 팀당 144~153이 되어 잔여가 음수가 된다.
 *
 * ⚠**「통산 기록은 다루지 않는다」는 낡은 서술이었다**(2026-08-18 감사 P3에서 정정).
 * 같은 파일 아래의 `記録まであと` 블록이 **정확히 통산 절목을 다룬다** — 다룰 수 있게 됐기 때문이다.
 * 근거는 **선수 페이지의 `通算成績`(출처 NPB)**이고, 우리가 보유 시즌을 더해 만든 값이 아니다.
 * 그래서 「우리가 할 수 없는 말」이 아니다. ⚠단 **출처가 NPB 통산인 값에만** 쓴다 —
 * 우리 보유분을 합산해 「통산」이라고 부르는 것은 여전히 금지다.
 *
 * ⚠**「지금 이어지는 중」은 마지막 출장일과 함께 말한다.** 5월 22일 이후 결장한 선수의
 * 연속 기록을 「継続中」이라고 쓰면 화면이 거짓말을 한다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, avg3, fullDate, gameDate } from "./format.ts";
import { streakSpan } from "./streak-view.ts";
import { ROSTER_PATH, page } from "./layout.ts";
import type { RenderContext } from "./layout.ts";
import { note, runCell, scroller, term, widestRunDiff, wlCell } from "./parts.ts";
import { termLabel } from "./glossary.ts";
import { teamPath } from "./team-page.ts";
import { dayHref } from "./today-page.ts";
import { NEUTRAL_COLOR, REGULAR_SEASON_GAMES, regularSeasonGames } from "@bb-app/domain";
import type { TeamColor } from "@bb-app/domain";

/**
 * NPB 정규시즌은 팀당 143경기.
 *
 * ⚠**값은 `@bb-app/domain` 한 벌뿐이다**(M1). 여기에 따로 `= 143` 을 쓰고 있었는데,
 * 캘린더가 같은 사실을 다시 필요로 하면서 **두 벌이 될 뻔했다**(2026-08-18).
 * 여기서는 화면이 쓰기 편하도록 다시 내보내기만 한다 — 숫자는 옮겨 적지 않는다.
 */
export { REGULAR_SEASON_GAMES, regularSeasonGames };

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
  /**
   * 득점·실점과 **그 분모**(읽을 수 있었던 경기 수).
   * ⚠득점을 못 읽은 경기는 빠져 있으므로 `played` 와 다를 수 있다 — 그래서 분모를 따로 든다(M2).
   */
  rf: number;
  ra: number;
  runGames: number;
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
  /**
   * ⚠**投手も入る**(2026-09-07). `scorelessAppearances` は **連続無失点登板**で、
   * 打者の2種とは**続きやすさが違う** — 表は長さで並べるが、それは「どれがすごいか」の順ではない。
   * 각주가 그 사실을 말한다.
   * ⚠**連続無失点イニングは入れない**(정의서 §1-7) — 「N回以上」은 「N回」와 비교가
   * 성립하지 않아 **순위를 붙일 수 없다.** 이 표는 길이로 줄 세우는 표다.
   */
  kind: "hitting" | "onBase" | "scorelessAppearances";
  /** 記録の長さ。打者は試合、投手は登板（どちらも単位は「試合」だ） */
  games: number;
  /**
   * **훑은 사건 수 — M2 의 첫째 분모**(정의서 §1-6 ⑴).
   * 타자는 **타석이 있던 경기 수**, 투수는 **등판 수**다.
   * ⚠**`games`(마루의 길이)와 섞지 마라** — 하나는 값이고 하나는 분모다.
   */
  scanned: number;
  /** 훑은 사건의 단위. 화면이 분모에 붙일 말이고, **타자와 투수가 다르다** */
  scannedUnit: "試合" | "登板";
  /**
   * **마루의 시작·끝 경기일 — M2 의 둘째 분모**(정의서 §1-6 ⑵).
   *
   * ⚠**`to` 는 `lastGameDate` 와 같은 값이 아니다.** 타자는 9.23(b) 본문으로 건너뛴 경기가
   * 마지막이면 마루의 끝이 그 앞 경기가 된다 — **다른 사실이라 둘 다 낸다**(M11).
   * 실측(2026-09-07 · 로컬 DB 9시즌 · 홈 표에 실릴 조건의 타자 행 58건): **어긋남 0건**.
   * ⚠**「0건」은 「일어나지 않는다」가 아니다** — 구조적으로 일어날 수 있어서 나눠 둔다.
   */
  from: string | null;
  to: string | null;
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

/**
 * 통산 마디에 다가선 선수.
 *
 * ⚠**이 구획만 출처가 다르다**(M4). 통산은 **NPB 가 선수 페이지에 공표한 연도별 합계**이고,
 * 이 사이트의 다른 수치는 우리가 경기에서 쌓은 것이다. 화면이 그렇게 적는다.
 * ⚠**NPB 기록만이다.** 해외 리그 기간은 그 표에 없다 — 「통산 안타」가 세간의 수와 다를 수 있고,
 * 그 이유를 화면이 말해야 한다.
 * ⚠**지금 등록된 선수만 볼 수 있다.** 선수 페이지를 받을 수 있는 것이 현역뿐이라,
 * 은퇴 선수는 여기 없다 — 「전체 순위」가 아니다.
 */
export interface HomeMilestone {
  playerId: string;
  name: string;
  teamCode: string;
  shortName: string;
  color: TeamColor;
  /** `通算安打` 등 */
  label: string;
  /** 지금까지의 통산 */
  count: number;
  /** 다음 마디 */
  next: number;
  /** 남은 수 */
  toNext: number;
  /** 이 시즌에 그 항목으로 낸 수. **올해 페이스로 닿는가**를 읽는 근거다 */
  thisSeason: number;
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
  /** 통산 마디에 다가선 선수들 */
  milestones: HomeMilestone[];
  streaks: HomeStreak[];
  /** 이 시즌에 ポストシーズン 기록이 있는가 */
  hasPostseason: boolean;
  /**
   * **이 시즌이 이미 끝났는가**(`query.ts` 의 `seasonIsOver` 와 같은 근거 · M1).
   *
   * ⚠**끝난 시즌의 홈에 현재형을 쓰면 거짓말이 된다** — 「続いている記録」는
   * 2018년 화면에서 「지금 이어지고 있다」로 읽힌다. 구단 페이지(`team-page.ts`)가
   * `calendar.seasonOver`로 이미 이 판정을 하고 있고, 여기서는 **같은 판정**을
   * 다른 값으로 받는다(2026-08-20 team-page.ts 수정에서 홈이 안 갈렸다고 신고됨).
   */
  seasonOver: boolean;
}

/**
 * 「続いている記録」구획 제목 — 시즌이 끝났으면 과거형(M1).
 *
 * ⚠**홈·구단 페이지가 같은 함수로 같은 문장을 낸다.** 각자 손으로 적으면
 * 화면마다 다르게 말하는 균열이 또 난다(팀 페이지만 먼저 과거형으로 고쳐졌던 사고 · 2026-08-20).
 */
export function streakSectionTitle(seasonOver: boolean): string {
  return seasonOver ? "続いていた記録" : "続いている記録";
}

/** 「記録に近づいている」구획 제목 — 같은 규칙(M1). `streakSectionTitle` 과 짝이다. */
export function milestoneSectionTitle(seasonOver: boolean): string {
  return seasonOver ? "記録に近づいていた" : "記録に近づいている";
}

/**
 * 연속 기록 종류 → **용어집 키**. ⚠**한 곳에서만 만든다**(M1) —
 * 홈과 구단 페이지가 같은 표를 그리는데, 각자 삼항식으로 적으면 한쪽만 고쳐진다.
 * 실제로 `連続安打` 가 네 곳에 문자열로 박혀 있었고 그것이 **9.23(a) 의 다른 기록 이름**이었다.
 */
export const STREAK_TERM_KEY: Readonly<Record<HomeStreak["kind"], string>> = {
  hitting: "hitStreak",
  onBase: "onBaseStreak",
  scorelessAppearances: "scorelessAppearanceStreak",
};

/**
 * 「続いている記録」表の**共通の見出しと行** — ⚠**홈과 구단이 같은 표를 그린다**(M1).
 *
 * 지금까지 두 파일이 **같은 `<td>` 를 따로 적고 있었고**, 그래서 라벨이 평문(`termLabel`)인
 * 결함도 **두 곳에 똑같이** 있었다. 한 벌로 모아 둔다 — 구단 페이지는 `球団` 열만 없다.
 *
 * ⚠**라벨은 `term()` 을 통과해야 한다**(루트 §7). 평문으로 그리면 **키보드·터치에서 설명을 열 방법이 없다** —
 * 선수 페이지는 버튼인데 이 두 표만 아니어서, **같은 화면 안에서 접근성이 갈렸다.**
 * ⚠**`term()` 은 「라벨 → 키」 역인덱스로 찾는다** — 그래서 `termLabel(키)` 로 라벨을 꺼내
 * 다시 넣는다. 문자열을 직접 쓰면 용어집을 고친 날 **툴팁만 조용히 사라진다.**
 */
export const STREAK_TABLE_HEAD =
  html`<th class="l">記録</th><th>試合</th><th class="l">期間</th><th class="l">最後の出場</th>`;

/**
 * 마루의 기간 — **M2 의 둘째 분모**(정의서 §1-6 ⑵).
 * ⚠**끝은 「마지막 출장」이 아니라 「기록에 센 마지막 경기」다**(`HomeStreak.to` 주석).
 */
export function streakSpanText(x: HomeStreak): string {
  // ⚠**서식은 `streak-view.ts` 한 벌이다**(M1) — 순위 화면의 연속 기록 표가 같은 기간을 그린다
  return streakSpan(x.from, x.to);
}

/** 위 견출에 맞는 한 행의 칸들(선수·구단 칸을 뺀 나머지). **한 벌만 둔다**(M1) */
export function streakCells(x: HomeStreak): RawHtml {
  return html`<td class="l">${term(termLabel(STREAK_TERM_KEY[x.kind]))}</td>
      ${/* ⚠**값 옆에 분모를 붙인다**(M2 · 정의서 §1-6 ⑴) — 「50登板」이 몇 등판 중의 50인지가
             없으면 그 수가 무엇인지 말할 수 없다. 타자는 試合, 투수는 登板이다. */ ""}
      <td class="b">${x.games}<span class="den">${x.scanned}${x.scannedUnit}</span></td>
      <td class="l">${streakSpanText(x)}</td>
      <td class="l">${x.lastGameDate === null ? NO_VALUE : fullDate(x.lastGameDate)}</td>`;
}

/**
 * 「続いている記録」表の各注 — **홈과 구단이 같은 문장을 쓴다**(M1).
 *
 * ⚠**옛 문장은 투수가 들어온 순간 거짓이 됐다**: 「その日より後に試合があれば、記録はもう
 * 途切れているか、本人が出ていないかのどちらかです」 — 투수는 **등판하지 않으면 안 끊긴다.**
 * 「출장하지 않았다」와 「기록이 끊겼다」가 타자에서는 배타적이지만 투수에서는 아니다.
 * ⚠**길이로 줄 세우지만 종류가 다르면 비교가 성립하지 않는다** — 그 사실도 적는다.
 */
export function streakTableNote(season: number): string {
  return (
    "**最後の出場日を必ず併記しています。** 打者の記録は、その日より後に試合があれば" +
    "もう途切れているか本人が出ていないかのどちらかです。" +
    "⚠**投手の連続無失点は、登板しなければ途切れません** — そのぶん日付が古いまま残ることがあります。" +
    "連続記録は「試合」単位で数えます（NPB・MLBの慣例）。代走だけで出た試合は数えません。" +
    // ⚠**M2 의 셋째 분모 — 「어느 범위에서 센 수인가」**(정의서 §1-6 ⑶).
    //   石井大智는 **정규만이면 이어지고 일본시리즈를 넣으면 끊긴다** — 같은 선수·같은 날에 답이 뒤집힌다.
    //   ⚠**연도를 박지 않는다**(사용자 결정 ⑵) — 보고 있는 시즌에서 유도한다.
    `この表は**${season}年のレギュラーシーズンのみ**で数えた記録です — ` +
    "日本シリーズ・クライマックスシリーズ・オープン戦は入れていません。" +
    // ⚠**분모 셋 중 첫째** — 「몇 경기(登板)를 훑어서 나온 수인가」
    "「試合」欄の小さい数字は、**この範囲で数えた出場試合（投手は登板）**の数です。" +
    // ⚠**「期間」의 오른쪽 끝은 마지막 출장이 아니라 記録の最後の試合**이다 — 드물게 갈린다
    "「期間」は**記録が始まった試合から、記録に数えた最後の試合まで**です。" +
    "⚠**種類の違う記録を長さで並べています** — 続きやすさが違うので、並び順は「どれがすごいか」の順ではありません。"
  );
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

/**
 * ⚠**승패 띠·득실 칸을 여기서 그리지 않는다**(M1 · 2026-08-18 유저 요청으로 통합).
 * 順位 탭과 **같은 부품**(parts.ts 의 wlCell·runCell)을 쓴다 —
 * 예전에는 두 화면이 각자 그렸고, 그래서 홈에만 띠가 있고 順位 탭에는 없었다.
 * 같은 사실을 두 어법으로 말하면 읽는 사람이 매번 다시 배워야 한다.
 */
function standingsTable(l: HomeLeague, base: string): RawHtml {
  /** 득실차 띠의 자 — **그 리그 안에서** 가장 큰 폭에 맞춘다 */
  const maxAbs = widestRunDiff(l.rows.filter((x) => x.runGames > 0));
  return scroller(html`<table class="hstand" aria-label="順位表">
  <thead><tr>
    <th>順位</th>
    <th class="l">球団</th>
    <th class="l">勝敗分</th>
    <th>${term("勝率")}</th><th>ゲーム差</th>
    <th class="l">得失点</th>
    <th>直近10</th><th>連続</th><th>残り</th><th class="l">全勝〜全敗の勝率</th>
  </tr></thead>
  <tbody>${l.rows.map(
    (r) => html`<tr style="--chip:${r.color.base}" class="${r.rank === 1 ? "lead" : ""}">
    <td class="hrank">${r.rank === null ? NO_VALUE : r.rank}${r.tiedRank ? html`<s>同</s>` : null}</td>
    <td class="l">${teamChip(r.teamCode, r.shortName, r.color, base)}</td>
    <!-- ⚠**수와 띠를 같이 낸다.** 띠만으로는 정확한 수를 못 읽고, 수만으로는 비교가 안 된다 -->
    <td class="l wl3">${wlCell(r)}</td>
    <td class="b">${pctText(r.pct)}</td>
    <td>${r.gamesBehind === 0 ? NO_VALUE : r.gamesBehind.toFixed(1).replace(/\.0$/, "")}</td>
    <!-- ⚠**득실차를 주역으로, 득점·실점을 분모처럼 뒤에 붙인다** — 「어느 쪽이 얼마나」가 한 눈에.
         ⚠**주역이 무엇인지 라벨로 말한다**(点差) — 열 이름만으로는 어긋난다 -->
    <td class="l wd">${runCell(r, maxAbs, r.runGames)}</td>
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

/**
 * 이 화면 안의 구획으로 뛰는 내비.
 *
 * ⚠**존재하는 구획만 낸다.** 대시보드는 데이터에 따라 구획이 통째로 빠진다(M12) —
 * 없는 곳으로 보내는 링크는 고장으로 읽힌다.
 * ⚠**`id` 를 이 함수와 마크업 두 곳에 손으로 적지 않는다** — 한 벌로 만들고 둘 다 여기서 쓴다(M1).
 */
function jumpNav(d: HomePageData): RawHtml {
  const items: { id: string; label: string }[] = [];
  if (d.latest !== null) items.push({ id: "b-hlatest", label: "直近の結果" });
  for (const l of d.leagues) items.push({ id: `b-hstand-${l.id}`, label: l.name.replace(/・リーグ$/, "") });
  if (d.week !== null) items.push({ id: "b-hweek", label: "先週の顔" });
  if (d.paces.length > 0) items.push({ id: "b-hpace", label: "ペース" });
  if (d.milestones.length > 0) items.push({ id: "b-hmile", label: milestoneSectionTitle(d.seasonOver) });
  if (d.streaks.length > 0) items.push({ id: "b-hstreak", label: streakSectionTitle(d.seasonOver) });
  // ⚠**하나뿐이면 그리지 않는다** — 뛸 곳이 하나면 내비가 아니라 장식이다
  if (items.length < 2) return raw("");
  return html`<nav class="hjump" aria-label="このページの中の移動">
  ${items.map((x) => html`<a href="#${x.id}">${x.label}</a>`)}
</nav>`;
}

export function renderHomePage(d: HomePageData, ctx: RenderContext): string {
  const { base, root, seasons, navTo } = ctx.paths("index.html");

  const body = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${d.season}年 ${ctx.site.name}</h1>
    <span class="sub">リーグの今を一枚で</span>
    <span class="asof">${d.asOf === null ? "" : `${fullDate(d.asOf)}まで`}</span>
  </div>
</header>

<!-- ⚠**이 줄은 「이 화면 안의 어디로」다**(2026-08-17 유저 요청으로 바뀜).
     예전에는 다른 화면으로 가는 링크였는데, **그건 상단 탭에 이미 있다** —
     같은 것을 두 번 두면 자리만 먹고 진짜 필요한 것(세로로 긴 대시보드 안의 이동)이 없어진다.
     ⚠**없는 구획은 링크하지 않는다**(M12) — 「눌러도 아무 데도 안 가는」 항목을 만들지 않는다.
     ⚠**앵커는 실제 id 와 같아야 한다.** 어긋나면 조용히 아무 일도 안 일어난다 —
     링크 검사가 앵커까지 보므로 빌드가 잡는다. -->
${jumpNav(d)}

${d.latest === null
    ? raw("")
    : html`<section class="block" id="b-hlatest">
  <h2>${fullDate(d.latest.date)}の結果<span class="qt">${d.latest.games.length}試合 · ＠がホーム</span></h2>
  ${/* ⚠**홈·원정이 화면 어디에도 없었다**(2026-08-20 감사 ②). 팀 이름 둘과 점수만 있어서
       구장 이름으로 추측하는 수밖에 없었다.
       ⚠**표식은 구단 페이지와 같은 어법을 쓴다**(M1) — 「＠팀」은 그 팀의 본거지에서 했다는 뜻이고,
       `.trecent` 가 이미 같은 글자를 쓴다. 새 어휘를 만들면 두 화면이 다른 말을 하게 된다.
       ⚠**한 줄에 세 칸이다.** 예전에는 다섯 요소를 flex 로 늘어놓고 팀명에 flex:1 1 0 을 줘서
       팀명이 셀 **바깥쪽**으로 밀려 있었다 — 실측 1280px 잉크 기준으로 경기 **내부**가 최대 71px,
       경기 **사이**가 18px 이라 **간격이 뜻과 반대로 묶였다.** 점수에 이름을 붙인다. */ ""}
  <ul class="hgames">${d.latest.games.map(
      (g) => html`<li>
    <span class="hg-t">${g.away}</span>
    <b class="hg-s">${g.awayRuns === null ? NO_VALUE : g.awayRuns}<s>-</s>${g.homeRuns === null ? NO_VALUE : g.homeRuns}</b>
    <span class="hg-t">＠${g.home}</span>
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
    `残り試合は ${regularSeasonGames(d.season)}試合 から消化済み（中止を除く）を引いた数です。` +
      "「全勝〜全敗の勝率」は残りを全部勝った場合と全部負けた場合の勝率で、**予想ではなく計算できる範囲**です。" +
      "順位が並んだ球団には「同」を付けています — 当該球団間の対戦成績で決めた上で、それでも並ぶ場合です。" +
      // ⚠**「マジックナンバーは出していません」를 지웠다**(2026-08-19). 구단 페이지가 내기 시작했으므로
      //   그 문장은 **곧 거짓이 된다** — 저장소가 두 곳에서 반대말을 하면 어느 쪽도 믿을 수 없다.
      //   ⚠홈 순위표에 값을 **새로 넣지는 않았다.** 그건 별도의 표시 결정이다.
      //   ⚠**대신 어디 있는지는 가리킨다**(2026-08-19 검토 m3). 지우기만 했더니 홈에서
      //   우승 경쟁을 보던 사람이 「매직은?」이라고 물을 때 **답이 하나도 없는 화면**이 됐다 —
      //   예전에는 (틀린 답이었지만) 있었다. **값이 아니라 포인터**다.
      //   ⚠**점등 조건을 문구에 넣는다**(2026-08-19 Minor). 「球団ページに出しています」는
      //   무조건 있는 것처럼 읽히지만 실측(dist)으로는 **108장 중 매직이 실제로 나오는 것은
      //   1장뿐**(2026 `h`「優勝マジック 28」) — 완결 시즌 96장은 `優勝が決まりました`/
      //   `なくなりました` 뿐이다. 조건 없이 「出しています」라고 하면 나머지 107장에서는
      //   가 보면 없는 포인터가 된다.
      "マジックナンバーは、点灯していれば**球団ページ**に出します。" +
        "引き分けは勝率の分母に入りません（NPBの規定）。",
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
    <!-- ⚠**순위표와 같은 어법으로 말한다**(2026-08-18 유저 지적).
         예전에는 득실차를 <s> 로만 감싸 뒀는데 이 목록에 CSS 가 없어
         **브라우저 기본 취소선**이 그어졌다 — +19 에 줄이 가서 「무효」로 보였다. -->
    <em>${t.rf}<i>得</i> ${t.ra}<i>失</i><s class="${t.rf - t.ra > 0 ? "up" : t.rf - t.ra < 0 ? "dn" : ""}">${
      t.rf - t.ra > 0 ? "+" : t.rf - t.ra < 0 ? "−" : "±"}${Math.abs(t.rf - t.ra)}</s><i>点差</i></em>
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
  <h2>今シーズンのペース<span class="qt">${regularSeasonGames(d.season)}試合換算</span></h2>
  ${/* ⚠**첫 판에 엉뚱한 이름을 붙였다** — 여기는 「ペース」 구획이지 「記録に近づいている」가 아니다 */ ""}
  ${scroller(html`<table aria-label="今シーズンのペース">
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th class="l">項目</th>
      <th>現在</th><th>${regularSeasonGames(d.season)}試合換算</th><th class="l">次の節目</th>
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
      // ⚠**「통산을 다루지 않는다」고 쓰면 안 된다** — 바로 아래 구획이 통산이다.
      //   화면이 자기 자신과 모순됐다(2026-08-17 검토 지적). 이 표가 무엇인지만 말한다
      // ⚠**구획 이름을 손으로 적지 마라**(2026-08-20). 아래 구획의 제목은 시즌이 끝나면
      //   「記録に近づいて**いた**」로 갈리는데 여기만 현재형으로 굳어 있어, 완결 시즌 8장에서
      //   각주가 존재하지 않는 이름을 가리켰다. **같은 함수를 쓴다**(M1).
      `**この表はシーズン記録だけ**です — 通算は下の「${milestoneSectionTitle(d.seasonOver)}」にあります。`,
  )}
</section>`}

${d.milestones.length === 0
    ? raw("")
    : html`<section class="block" id="b-hmile">
  <h2>${milestoneSectionTitle(d.seasonOver)}<span class="qt">通算</span></h2>
  ${scroller(html`<table aria-label="先週の顔">
    <thead><tr>
      <th class="l">選手</th><th class="l">球団</th><th class="l">記録</th>
      <th>通算</th><th class="l">節目まで</th><th>今季</th>
    </tr></thead>
    <tbody>${d.milestones.map(
      (x) => html`<tr>
      <td class="l"><a href="${base}players/${x.playerId}.html">${x.name}</a></td>
      <td class="l">${teamChip(x.teamCode, x.shortName, x.color, base)}</td>
      <td class="l">${x.label}</td>
      <td class="b">${x.count}</td>
      <td class="l">${x.next}まであと<b>${x.toNext}</b></td>
      <td>${x.thisSeason}</td>
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
      "⚠**この表だけ出典が違います** — 通算は選手ページの**年度別成績（NPBの公表値）**を当サイトが足したものです（NPBが載せている合計行と毎回突き合わせています）。" +
        "ほかの数字は当サイトが試合記録から積み上げた値で、混ぜていません。" +
        "**NPBの記録だけ**です — 海外リーグの期間はこの表に入りません。" +
        "**今、選手ページがある選手だけ**が対象です（引退した選手は含みません）ので、通算の順位ではありません。" +
        "**節目までの残りが少ない順**に8人までです。" +
        // ⚠**「今季」도 같은 표에서 가져온다.** 우리 경기 데이터와 섞으면 기준일이 달라
        //   한 줄 안에서 뺄셈이 안 맞는다(실측: 통산 90 · 今季 13 인데 작년까지가 78이었다).
        //   2026-08-17에 실제로 섞었다가 되돌렸다 — 자세한 사유는 `query.ts` 의 `milestonesOf`
        "**通算も今季も同じ年度別成績から取っています** — 出典が違う数字を並べると、" +
        "引き算が合わなくなるからです。当サイトが試合から積み上げた数字とは**日付の基準が違うことがあります**。" +
        "今季まだ0の項目は出していません。",
    )}
</section>`}

${d.streaks.length === 0
    ? raw("")
    : html`<section class="block" id="b-hstreak">
  <h2>${streakSectionTitle(d.seasonOver)}</h2>
  ${/* ⚠**시제를 손으로 적지 마라**(M1) — 끝난 시즌에는 제목이 과거형이 되고,
         이름만 현재형으로 남으면 **낭독 경로가 화면과 다른 말을 한다.**
         실제로 첫 판에서 그렇게 적었다가 시험이 잡았다. */ ""}
  ${scroller(html`<table aria-label="${streakSectionTitle(d.seasonOver)}">
    <thead><tr><th class="l">選手</th><th class="l">球団</th>${STREAK_TABLE_HEAD}</tr></thead>
    <tbody>${d.streaks.map(
      (x) => html`<tr>
      <td class="l"><a href="${base}players/${x.playerId}.html">${x.name}</a></td>
      <td class="l">${teamChip(x.teamCode, x.shortName, x.color, base)}</td>
      ${streakCells(x)}
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    streakTableNote(d.season),
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
    navTo,
    // ⚠**홈은 특정 구단의 화면이 아니다.** 구단 색을 쓰면 그 팀 화면처럼 보인다
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    // ⚠**이걸 안 넘겨서 홈만 탭이 하나 모자랐다**(2026-08-17 유저 지적).
    //   타입이 선택값(`hasPostseason?`)이라 빠뜨려도 컴파일된다 — 시험이 잡는다
    hasPostseason: ctx.hasPostseason,
    nav: "home",
    body,
  });
}
