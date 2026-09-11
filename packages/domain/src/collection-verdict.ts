/**
 * **수집 판정** — 「최신 경기가 며칠 전인가」가 아니라 「NPB 가 치렀다고 표시한 경기를 우리가 못 받았나」.
 *
 * 설계: `docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md` (D1 · D2 · D4 · D11)
 *
 * ⚠**옛 규칙(「최신 경기가 2일보다 오래됐다」)은 휴식마다 수집 잡을 실패시켰다.** 보유 완결 8시즌에 시즌 도중 3일 넘게 빈
 * 구간이 23개였고(해마다 10월 CS 전후 두 번), 오프시즌은 118~240일이다. 실패하면 배포가 막히고 하트비트가 6시간마다 메일을 보낸다.
 * 휴식이면 「치렀다」는 표시가 없으므로 **날짜를 박지 않고도** 조용해진다.
 *
 * ⚠**이 파일은 판정만 한다 — 시계도 DB 도 없다**(M6). 증거는 `@bb-app/store` 의 `collectionEvidence` 가 모은다.
 * ⚠**감시(`scripts/freshness.ts`)와 화면 띠(`packages/web`)가 이 함수 한 벌을 쓴다**(M1) — 유예와 백스톱 여유만 다르다.
 */

/** 감시가 내는 사유의 전부. ⚠**화면 문구표(`web/src/log-page.ts`)가 이 목록을 따른다** — 늘리면 거기도 늘려라(시험이 지킨다) */
export const STALE_REASON_KEYS = [
  "no-games",
  "game-missed",
  "game-lag",
  "career-lag",
  "starters-behind",
  "starters-lag",
] as const;
export type StaleReason = (typeof STALE_REASON_KEYS)[number];

/**
 * 누락을 몇 날 전까지 되돌아보는가.
 * ⚠**따라잡기 상한(`MAX_CATCHUP_DAYS` 7)보다 길다** — 7일을 넘긴 누락은 자동으로 메워지지 않으므로 영구 결손이 된 뒤에도
 * 한 달은 울려야 사람이 안다. 무한이 아닌 이유는 같은 행이 영원히 울리면 아무도 안 보기 때문이다.
 */
export const LOOKBACK_DAYS = 30;

/**
 * **백스톱** — 증거가 전부 조용해진 경우(일정 파서·수집·予告先発이 동시에 고장)를 늦게라도 잡는다.
 * 45 = 시즌 중 최장 실측 휴식 27일(2021 올림픽) + 여유 · 200 = 오프시즌 실측 118~151일(2020 제외) + 여유.
 * ⚠**2020 형 해(개막 6월 · 오프시즌 240일)에는 약 40일 운다** — 안전한 쪽의 틀림이다.
 * ⚠**인자로 바꾸지 않는다.** 감시·빌드가 다른 프로세스라 인자는 한쪽만 바뀐다 — 바꿀 때는 이 상수를 커밋으로 바꾼다.
 */
export const BACKSTOP_IN_SEASON_DAYS = 45;
export const BACKSTOP_OFFSEASON_DAYS = 200;

export function backstopDays(seasonOver: boolean): number {
  return seasonOver ? BACKSTOP_OFFSEASON_DAYS : BACKSTOP_IN_SEASON_DAYS;
}

/** A — 월간 일정이 「치렀다」(점수 링크)고 표시했는데 경기 행이 없는 경기. **경기 단위**(같은 카드는 seq) */
export interface MissedPlayed {
  date: string;
  homeCode: string;
  awayCode: string;
  seq: number;
}

/** B — 예고됐는데 그날 경기 행이 없고 그 달 일정 사본이 낡은 구단. **구단 단위** */
export interface MissedAnnounced {
  date: string;
  teamCode: string;
}

/**
 * 판정의 입력. **SQL 이 모은 사실**이고 창(유예)은 아직 안 적용됐다 — 유예는 판정이 적용한다(감시 2 · 화면 3).
 * ⚠날짜는 전부 JST `YYYY-MM-DD` 다.
 */
export interface CollectionEvidence {
  /** 판정일(감시 = 실행 시각의 JST 날짜 · 화면 = `builtOn`) */
  today: string;
  /** `MAX(game_date) WHERE status='played'`. null 이면 경기가 하나도 없다 */
  latestPlayed: string | null;
  /** **최신 시즌**(played 경기의 `MAX(season)`)이 끝났는가 — 백스톱이 쓴다 */
  latestSeasonOver: boolean;
  /** A 후보 — `[today − LOOKBACK_DAYS, today]` 안의 것 */
  playedWithoutGame: readonly MissedPlayed[];
  /** B 후보 — 같은 창 · 「그날 경기 행 0 · 사본 낡음 · 더 늦은 휴식 공표 없음」은 SQL 이 이미 걸렀다 */
  announcedWithoutGame: readonly MissedAnnounced[];
  /** `MAX(probable_pitcher.game_date)` */
  startersLatest: string | null;
  /** 予告先発 맥박 — `MAX(starters_fetch.fetched_at)` 의 JST 날짜 */
  startersPulseDate: string | null;
  /** 오늘 이후 가장 가까운 경기일(`game` ∪ `upcoming_game`) */
  nextGameDay: string | null;
  /** NPB 가 `nextGameDay` 에 「試合が予定されていません」이라고 공표했는가 */
  nextGameRestDeclared: boolean;
  /** **`nextGameDay` 가 속한 시즌**이 끝났는가 — ⚠「최신 시즌」이 아니다(새 시즌 개막일이 가려진다) */
  nextGameSeasonOver: boolean;
  /** 통산 감시 대상(최근 출장자) 수 — 0 이면 통산을 안 잰다 */
  careerPlayers: number;
  /** 아직 못 받은 선수의 마지막 출장일(기존 규칙 그대로) */
  careerStalestPlayed: string | null;
  /** `period` 재료 — 오늘 이전 가장 최근의 경기 행 날짜(상태 무관) */
  latestGameRowDate: string | null;
  /** `period` 재료 — 오늘 이전 가장 최근의 치러짐 표시 날짜 */
  latestPlayedMarkDate: string | null;
  /** `period` 재료 — 오늘 이후 가장 가까운 예고 날짜 */
  nextAnnouncementDate: string | null;
}

export interface VerdictOptions {
  /** 누락 유예(일). 감시 2 · 화면 3 — ⚠화면이 크다(감시가 먼저 운다) */
  grace: number;
  /** 백스톱 여유. 감시 0 · 화면 1 — 감시와 빌드가 다른 시각에 날짜를 읽어 자정을 넘기는 한 번을 흡수한다 */
  backstopMargin: number;
}

/** 통과한 이유 — 종료 코드에 쓰지 않는다(정보) */
export type CollectionPeriod = "unknown" | "games" | "offseason" | "rest";

export interface CollectionVerdict {
  reasons: StaleReason[];
  missedPlayed: MissedPlayed[];
  missedAnnounced: MissedAnnounced[];
  /** A·B 중 가장 이른 누락일 */
  missedEarliest: string | null;
  /** 최신 played 경기의 나이(일) */
  ageDays: number | null;
  /** 이번 판정의 백스톱(여유 포함) */
  backstop: number;
  startersPulseAge: number | null;
  careerAge: number | null;
  period: CollectionPeriod;
}

/** JST 달력일 차. ⚠시계를 읽지 않는다 — 주어진 두 문자열만 본다 */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function collectionVerdict(e: CollectionEvidence, o: VerdictOptions): CollectionVerdict {
  const reasons: StaleReason[] = [];
  const inWindow = (date: string): boolean => {
    const age = daysBetween(date, e.today);
    return age >= o.grace && age <= LOOKBACK_DAYS;
  };

  if (e.latestPlayed === null) reasons.push("no-games");

  // D1 — 받았어야 할 경기를 못 받았다
  const missedPlayed = e.playedWithoutGame.filter((m) => inWindow(m.date));
  const missedAnnounced = e.announcedWithoutGame.filter((m) => inWindow(m.date));
  if (missedPlayed.length + missedAnnounced.length > 0) reasons.push("game-missed");
  const dates = [...missedPlayed.map((m) => m.date), ...missedAnnounced.map((m) => m.date)].sort();
  const missedEarliest = dates[0] ?? null;

  // D2 — 백스톱
  const backstop = backstopDays(e.latestSeasonOver) + o.backstopMargin;
  const ageDays = e.latestPlayed === null ? null : daysBetween(e.latestPlayed, e.today);
  if (ageDays !== null && ageDays > backstop) reasons.push("game-lag");

  // 통산 — ⚠기존 규칙 그대로(유예 + 2일). 선수 페이지는 하루 상한으로 나눠 받으므로 경기보다 넉넉하다
  const careerAge = e.careerStalestPlayed === null ? (e.careerPlayers > 0 ? 0 : null) : daysBetween(e.careerStalestPlayed, e.today);
  if (e.careerPlayers > 0 && careerAge !== null && careerAge > o.grace + 2) reasons.push("career-lag");

  // D4 · D3 — 予告先発. ⚠기록이 하나도 없으면 안 잰다(기존 규칙)
  let startersPulseAge: number | null = null;
  if (e.startersLatest !== null || e.startersPulseDate !== null) {
    // ⚠기존 조건(다음 경기일이 오늘인데 예고가 거기 못 미친다)에 **가드 둘만** 더했다 — 휴식 공표 · 다음 경기일 시즌의 종료
    const behind = e.nextGameDay !== null && e.startersLatest !== null
      && e.nextGameDay <= e.today && e.startersLatest < e.nextGameDay
      && !e.nextGameRestDeclared && !e.nextGameSeasonOver;
    if (behind) reasons.push("starters-behind");
    startersPulseAge = e.startersPulseDate === null ? null : daysBetween(e.startersPulseDate, e.today);
    if (startersPulseAge === null || startersPulseAge > o.grace) reasons.push("starters-lag");
  }

  // D11 — 통과한 이유(위에서부터 처음 참인 줄)
  const near = (d: string | null, maxBack: number, maxAhead: number): boolean => {
    if (d === null) return false;
    const diff = daysBetween(d, e.today); // 양수 = 과거
    return diff <= maxBack && -diff <= maxAhead;
  };
  let period: CollectionPeriod;
  if (e.latestPlayed === null) period = "unknown";
  else if (near(e.latestGameRowDate, 1, 0) || near(e.latestPlayedMarkDate, 1, 0) || near(e.nextAnnouncementDate, 0, 1)) period = "games";
  else if (e.latestSeasonOver) period = "offseason";
  else period = "rest";

  return { reasons, missedPlayed, missedAnnounced, missedEarliest, ageDays, backstop, startersPulseAge, careerAge, period };
}
