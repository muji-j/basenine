/**
 * DB → 화면 데이터.
 *
 * ⚠**여기가 유일한 DB 접점이다.** 렌더러는 DB를 모른다 — 그래야 픽스처만으로 화면을 테스트한다.
 * ⚠**지표를 여기서 다시 계산하지 않는다**(M1). `@bb-app/metrics` · `@bb-app/aggregate`가
 * 만든 값을 옮겨 담기만 한다. 여기에 산식이 생기는 순간 값이 두 벌이 된다.
 */
import type { Db } from "@bb-app/store";
import {
  attempts,
  battedBalls,
  bestPct,
  buntValues,
  headToHead,
  // ⚠**각주가 말하는 리그 전체 수치는 여기서 나온다**(2026-08-20). 화면이 수를 문자열로
  //   들고 있으면 경기가 하나 늘 때마다 사람이 고쳐야 하고, 안 고치면 그대로 거짓이 된다
  leagueStealTotals,
  pairKey,
  seasonRace,
  STEAL_BASES,
  steals,
  groundedIntoDoublePlays,
  successRate,
  timesThroughOrder,
  // ⚠**勝率 산식은 한 벌이다**(M1). 구단 순위와 투수 개인 순위가 같은 함수를 쓴다 —
  //   `勝 ÷ (勝 + 敗)` 를 여기서 다시 쓰면 무승부·노디시전 처리가 언젠가 갈린다
  winPct,
  worstPct,
} from "@bb-app/aggregate";
// ⚠**통산 합계·시즌 수는 파서 쪽 한 벌을 쓴다**(M1) — 여기에 다시 쓰면 시험이 붙은 쪽이 죽는다
import { careerTotal, seasonsPlayed } from "@bb-app/parser";
import type {
  CountLine,
  HeadToHead,
  PlayerStreaks,
  ReliefLine,
  ReliefScan,
  SeasonDrawLine,
  StealBase,
  StealLine,
  TeamRace,
  TeamRaceInput,
} from "@bb-app/aggregate";
import { regularSeasonGames } from "./home-page.ts";
import { byMetricOrder } from "./metric-order.ts";
import type {
  HomeLeague,
  HomePace,
  HomePageData,
  HomeStreak,
  HomeWeek,
  HomeWeekPlayer,
  HomeWeekTeam,
  HomeMilestone,
} from "./home-page.ts";
import type {
  BattedBallData,
  BuntCell,
  CareerData,
  CareerRow,
  CountBlockData,
  CountSplitRow,
  CountUnreadable,
  ReliefBlockData,
  ReliefTotals,
  StealBaseRow,
} from "./player-page.ts";
import type { BattingLine, LeagueConstants, PitchingLine, Rate, WobaWeights } from "@bb-app/metrics";
import {
  babip,
  battingAverage,
  earnedRunAverage,
  homeRunsPer9,
  iso,
  onBasePercentage,
  ops,
  rankBy,
  rate,
  sluggingPercentage,
  strikeoutRate,
  strikeoutsPer9,
  sumBatting,
  walkRate,
  walksPer9,
  whip,
} from "@bb-app/metrics";
import {
  ALL_STATES,
  MIN_INHERITED_FOR_RATE,
  STAR_ER,
  STAR_HITS,
  STAR_LIMIT,
  STAR_OUTS,
  STAR_RBI,
  STAR_SO,
  aggregateSeason,
  battingEntries,
  battingEntryOf,
  blendConstants,
  battingSplits,
  battingStreaks,
  pitchingSplits,
  buildLeagues,
  buildRunExpectancy,
  deriveRunValues,
  computeSrc,
  computeSrp,
  addSrc,
  addSrp,
  srcPer600Of,
  srpPer9Of,
  dayResults,
  gameDates,
  gameDetails,
  latestGameDate,
  entriesOfRole,
  matchups,
  neededOuts,
  neededOutsRange,
  neededPa,
  neededPaRange,
  pitchingEntries,
  pitchingEntryOf,
  rankBatters,
  rankPitchers,
  rankPitchersInRole,
  stateKey,
  teamGamesOf,
  teamStandings,
  // ⚠**カウント別**(2026-08-20) — `pa_event.ball_count` 는 채워진 채 읽는 코드가 0곳이었다
  addCount,
  countLines,
  firstPitchRate,
  fullCountRate,
  threeBallRate,
  twoStrikeRate,
  // ⚠**火消し**(2026-08-20) — 용어집에 `inheritedRunner` 가 있는데 재는 지표가 없었다
  averageEnteringRe,
  dousedRate,
  foldRelief,
  midInningEntries,
  // ⚠**引き分けの解剖**(2026-08-20) — NPB 특유의 축
  drawRate,
  extraDecidedRate,
  seasonDraws,
} from "@bb-app/aggregate";
import type {
  BattingEntry,
  DayGame,
  GameDay,
  GamePlay,
  LeagueBundle,
  PitcherRole,
  PitchingEntry,
  RunExpectancy,
  SeasonAggregate,
  SplitDimension,
  SrcEntry,
  SrcTotals,
  SrpEntry,
  SrpTotals,
} from "@bb-app/aggregate";
import { regularSeasonUpcoming } from "./calendar.ts";
import type { CalendarData, CalendarGame, CalendarMonth } from "./calendar.ts";
import { NEUTRAL_COLOR, NON_TEAM_CODES, TEAMS, colorOf, leagueOf, shortNameOf, teamOf } from "@bb-app/domain";
import type { Competition, League, TeamColor } from "@bb-app/domain";
import { countsAsHit } from "@bb-app/parser";
import type { Outcome } from "@bb-app/parser";
import { positionMark } from "./player-page.ts";
import type { PlayerStint } from "./player-page.ts";
import { battingProfile, pitchingProfile } from "./marks.ts";
import type {
  BattingBlockData,
  MatchupRow,
  PitchingBlockData,
  PlayerPageData,
  RankingPanel,
  RankingRow,
  Ranks,
  RoleLine,
  ScorebookRow,
  SituationCell,
  SparkPoint,
  SplitAxisData,
  SplitAxisId,
  SplitRow,
} from "./player-page.ts";
import type {
  DrawSeasonRow,
  IndexPageData,
  LeagueSection,
  MatchupDay,
  MatchupGame,
  MatchupPageData,
  MatchupPick,
  MatchupTeam,
  ProbableGame,
  ProbableSide,
  RankingCategory,
  RankingPageData,
  RosterEntry,
  SearchEntry,
  StartersPageData,
  TeamRoster,
} from "./pages.ts";
import type { StandingRow, StandingsSection } from "./pages.ts";
// 予告先発 화면의 앵커. **試合 카드가 그리로 가므로 키를 두 벌 만들지 않는다**(M1)
import { batterPick, gameKey, pitcherPick, startersAnchor, unseenPitcherPick } from "./pages.ts";
import type { RankDigits } from "./parts.ts";
// ⚠**동률 규칙 문장은 구단 목록과 공유한다**(M1) — 두 화면이 같은 사실을 다르게 공시하고 있었다
import { TIE_RULE } from "./parts.ts";
import { NO_VALUE, avg3, dec2, denominator, innings } from "./format.ts";
// ⚠**분모 단위의 정본**(M1) — 화면이 문자열을 직접 적지 않는다
import { denUnit } from "./glossary.ts";
import { readFileSync } from "node:fs";
// ⚠**한도는 화면 파일에 산다** — 각주가 그 수를 그대로 쓰기 때문이다(M3의 정신).
//   여기 두면 상수와 화면 문장이 조용히 갈린다
import { TEAM_MILESTONE_ROWS, TEAM_STREAK_ROWS } from "./team-page.ts";
import type {
  TeamBatter,
  TeamMonth,
  TeamNextGame,
  TeamNow,
  TeamPageData,
  TeamPitcher,
} from "./team-page.ts";
import type { TeamsCard, TeamsPageData } from "./teams-page.ts";
import type {
  PostBatter,
  PostCompetition,
  PostGame,
  PostPitcher,
  PostseasonBrief,
  PostseasonPageData,
} from "./postseason-page.ts";
import type {
  DayIndexData,
  DayPageData,
  PlayerRef,
  TodayGame,
  TodayPageData,
  TodayProbable,
  TodaySide,
} from "./today-page.ts";
import { KEY_PLAY_LIMIT } from "@bb-app/aggregate";
import { gameSlug } from "./game-page.ts";
import type { GamePageData, GamePlayView, GameSide } from "./game-page.ts";
import type { PlayerRef as GamePlayerRef } from "./game-page.ts";
import { POLITENESS } from "./log-page.ts";
import type { CoverageDay, LogPageData, QuarantineKind, RunRecord } from "./log-page.ts";

/**
 * 스플릿에서 「표본이 얇다」고 볼 타석 수.
 *
 * ⚠**잠정값이다**(스펙 §7-2 미결). 축마다 다르게 잡아야 할 가능성이 크지만,
 * 근거 없이 축마다 다른 수를 넣는 것보다 **하나를 정하고 여기 적어두는 편이 낫다.**
 */
export const THIN_SPLIT_PA = 30;

/** `earnedRunAverage`가 요구하는 나머지 필드. 월별 방어율은 아웃과 자책점만 있으면 된다 */
const EMPTY_PITCHING: PitchingLine = {
  outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0,
};

/** 打席記録에 싣는 최근 타석 수 */
const SCOREBOOK_LIMIT = 40;
/** 선수 페이지 안의 순위표에 싣는 상위 인원 */
const RANKING_ROWS = 10;
/**
 * 순위표 페이지에 싣는 **각 세계의** 상위 인원(규정 상위 N · 전원 상위 N).
 * ⚠**내보내는 이유는 시험 때문이다** — 「어느 하한에서도 상위 N」을 재려면 시험이
 * 화면과 **같은 수**로 골라 봐야 한다. 시험이 30을 손으로 적으면 여기를 바꿔도 초록으로 남는다.
 */
export const RANKING_PAGE_ROWS = 30;
/** 収集ログ에 싣는 경기일 수. 한 달이면 구멍이 보인다 */
const COVERAGE_DAYS = 30;
/** 収集ログ에 싣는 실행 기록 수 */
const RUN_LOG_ROWS = 20;
/** 격리 종류마다 보여줄 원문 표본 수. **판단하려면 원문이 필요하다** */
const QUARANTINE_SAMPLES = 5;

const LEAGUE_NAME: Readonly<Record<League, string>> = {
  central: "セントラル・リーグ",
  pacific: "パシフィック・リーグ",
};

const SPLIT_AXES: readonly { id: SplitAxisId; dimension: SplitDimension; label: string }[] = [
  { id: "hand", dimension: "opponentHand", label: "対左右" },
  { id: "base", dimension: "baseState", label: "走者状況" },
  { id: "homeAway", dimension: "homeAway", label: "本拠地" },
  { id: "month", dimension: "month", label: "月別" },
  // ⚠투수 쪽의 뜻이 다르다 — 자기 타순이 아니라 **상대 타자가 몇 번이었는가**다
  { id: "order", dimension: "battingOrder", label: "打順" },
  { id: "venue", dimension: "venue", label: "球場別" },
];

/**
 * 구장별 스플릿에서 **한 줄로 남길 최소 타석 수**.
 *
 * ⚠**접는 것이지 숨기는 것이 아니다.** 구장은 시즌에 30곳 넘게 나오고(2025~2026 실측 37곳),
 * 그중 지방 개최는 한 선수에게 3~4타석뿐이다. 전부 늘어놓으면 1~2타석짜리 줄이 표의 절반을
 * 채우고, 그건 정보가 아니라 잡음이다.
 * ⚠**접은 것은 「その他の球場」 한 줄로 합치고, 몇 곳을 합쳤는지 화면이 말한다.**
 * 조용히 버리면 합계가 안 맞고, 그때 어디로 갔는지 아무도 답할 수 없다.
 */
export const VENUE_MIN_PA = 10;

const SPLIT_KEY_LABEL: Readonly<Record<string, string>> = {
  left: "対左投手",
  right: "対右投手",
  both: "対両投手",
  empty: "走者なし",
  onBase: "走者あり",
  scoring: "得点圏",
  home: "本拠地",
  away: "ビジター",
};

/**
 * 투수 쪽 라벨.
 *
 * ⚠**좌우가 「상대 투수」가 아니라 「상대 타자」다.** 타자 쪽 표를 그대로 쓰면
 * 투수 페이지에 「対左投手」가 나오고, 값은 맞는데 뜻이 틀린 화면이 된다.
 */
const PITCHER_SPLIT_KEY_LABEL: Readonly<Record<string, string>> = {
  left: "対左打者",
  right: "対右打者",
  both: "対両打者",
  empty: "走者なし",
  onBase: "走者あり",
  scoring: "得点圏",
  home: "本拠地",
  away: "ビジター",
};

/** `2026-04` → `4月` */
function monthLabel(key: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(key);
  return m === null ? key : `${Number(m[1])}月`;
}

function splitLabel(axis: SplitAxisId, key: string, allowed: boolean): string {
  if (axis === "month") return monthLabel(key);
  // 구장명은 이미 사람이 읽는 이름이다(파서가 다듬었다) — 표를 다시 만들지 않는다
  if (axis === "venue") return key;
  // 타순은 그대로 수다 — 「3」을 「3番」으로 읽히게만 한다
  if (axis === "order") return `${key}番`;
  const table = allowed ? PITCHER_SPLIT_KEY_LABEL : SPLIT_KEY_LABEL;
  return table[key] ?? key;
}

/** 라인에서 파생 비율 4종. **산식은 metrics 것을 쓴다** */
function derived(line: BattingLine): { avg: Rate; obp: Rate; slg: Rate; ops: Rate } {
  return {
    avg: battingAverage(line),
    obp: onBasePercentage(line),
    slg: sluggingPercentage(line),
    ops: ops(line),
  };
}

// ─── 순위 ────────────────────────────────────────────────────────────────

interface MetricRanking {
  id: string;
  label: string;
  digits: RankDigits;
  unit: string;
  /** 분모가 아웃 카운트인가. 투수 지표는 전부 그렇다 */
  denAsInnings: boolean;
  /** **값**이 아웃 카운트인가(最多投球回만 해당) */
  valueAsInnings: boolean;
  qualifier: string;
  /** 순위순. 자격 미달·값 없음은 뒤에 붙는다 */
  rows: RankingRow[];
  /** 선수별 순위 조회 */
  rankOf: Map<string, number | null>;
}

interface RankedLike {
  rank: number | null;
  rate: Rate;
  playerId: string;
  name: string;
  teamCode: string;
}

function toMetricRanking(
  id: string,
  label: string,
  digits: RankDigits,
  unit: string,
  qualifier: string,
  ranked: readonly RankedLike[],
  denAsInnings = false,
  valueAsInnings = false,
  /** 높을수록 좋은 지표인가. **전원 순위를 매기는 방향**이다 */
  higherIsBetter = true,
): MetricRanking {
  /**
   * 전원 기준 순위.
   *
   * ⚠**여기서 직접 매기지 않고 `rankBy` 한 벌을 부른다**(M1/M3).
   * 동률은 같은 순위를 받고 다음을 건너뛰는데, 그 규칙을 두 곳에 쓰면 어느 날 갈린다.
   * ⚠**값이 없는 선수는 여기서도 순위가 없다** — `rankBy` 가 그렇게 한다(M11).
   * ⚠`minDenominator: 0` 이므로 **1타석 1안타가 打率 1위로 올라온다.**
   *   그것이 「全員」이 뜻하는 바이고, 그래서 화면이 **母数를 늘 함께** 낸다(M2).
   */
  const allRank = new Map<string, number | null>();
  for (const r of rankBy(ranked, (x) => x.rate, { minDenominator: 0, higherIsBetter })) {
    allRank.set(r.item.playerId, r.rank);
  }

  const rows: RankingRow[] = ranked
    .map((r) => ({
      rank: r.rank,
      rankAll: allRank.get(r.playerId) ?? null,
      playerId: r.playerId,
      name: r.name,
      teamCode: r.teamCode,
      value: r.rate,
      isMe: false,
    }))
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return b.value.denominator - a.value.denominator;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });
  return {
    id,
    label,
    digits,
    unit,
    denAsInnings,
    valueAsInnings,
    qualifier,
    rows,
    rankOf: new Map(rows.map((r) => [r.playerId, r.rank])),
  };
}

/**
 * 개수 지표(홈런·탈삼진 등)의 순위.
 *
 * ⚠**개수에는 자격 기준이 없다.** 홈런왕에 규정타석은 걸리지 않는다 —
 * 비율 지표의 규칙을 그대로 옮기면 조용히 틀린다.
 */
function countRanking(
  id: string,
  label: string,
  unit: string,
  items: readonly { playerId: string; name: string; teamCode: string; count: number; sample: number }[],
  denAsInnings = false,
  valueAsInnings = false,
): MetricRanking {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const ranked: RankedLike[] = [];
  let prevValue: number | null = null;
  let prevRank = 0;
  sorted.forEach((r, i) => {
    const rank = prevValue !== null && r.count === prevValue ? prevRank : i + 1;
    prevValue = r.count;
    prevRank = rank;
    ranked.push({
      rank,
      rate: { value: r.count, denominator: r.sample },
      playerId: r.playerId,
      name: r.name,
      teamCode: r.teamCode,
    });
  });
  return toMetricRanking(
    id,
    label,
    0,
    unit,
    "累計順です。規定打席・規定投球回はかかりません。",
    ranked,
    denAsInnings,
    valueAsInnings,
  );
}

/**
 * 역할별 성적 한 벌. **등판이 없으면 null**이다.
 *
 * ⚠**0등판을 「방어율 0.00」으로 그리지 않는다**(M11). 「없음」과 「0」은 다르고,
 * 구원 등판이 없는 선발 투수에게 「救援 0.00」은 완벽한 구원 성적처럼 보인다.
 */
function roleLine(line: PitchingLine, games: number): RoleLine | null {
  if (games === 0) return null;
  return {
    games,
    line,
    era: earnedRunAverage(line),
    whip: whip(line),
    k9: strikeoutsPer9(line),
  };
}

/**
 * ⚠**하나의 수로 말하면 그 문장이 거짓이 된다**(2026-08-18 감사 P1 · 내가 만든 결함).
 * 「規定打席 345」라고 적어 놓고 **333타석 선수에게 순위를 붙이고 있었다** —
 * 기준은 소속 구단의 소화 경기수로 정해지는데 문구만 리그 최다를 대표로 썼기 때문이다.
 * → 구단마다 다르다는 사실 자체를 문장이 말한다. 같으면 범위가 아니라 한 수로 나온다.
 */
function batterQualifier(bundle: LeagueBundle): string {
  const { min, max } = neededPaRange(bundle);
  const need = min === max ? `${min}` : `${min}〜${max}`;
  return `規定打席 ${need}（所属球団の試合数 × 3.1、端数は四捨五入）に達した選手だけに順位がつきます。球団ごとに消化試合数が違うため基準も異なります。同率は同じ順位で、次の順位を飛ばします。`;
}

/**
 * 역할별 자격 문구.
 *
 * ⚠**선발은 NPB 공식 기준, 구원은 우리 기준**이다. 같은 문장으로 쓰면
 * 자체 기준이 공식 기준으로 읽힌다 — 그건 출처를 속이는 것과 같다(§0-10 출처 추적성).
 */
function pitcherQualifier(bundle: LeagueBundle, role: PitcherRole): string {
  const { min, max } = neededOutsRange(bundle, role);
  const one = (outs: number): number => Math.round((outs / 3) * 10) / 10;
  const need = min === max ? `${one(min)}回` : `${one(min)}〜${one(max)}回`;
  if (role === "starter") {
    return `規定投球回 ${need}（所属球団の試合数 × 1回・NPB公式）に達した先発投手だけに順位がつきます。球団ごとに消化試合数が違うため基準も異なります。同率は同じ順位で、次の順位を飛ばします。`;
  }
  return `救援投手には公式の規定投球回がないため、当サイトは規定投球回の3分の1（${need}）を基準にしています。これはNPBの基準ではありません。同率は同じ順位で、次の順位を飛ばします。`;
}

/**
 * 구단 페이지의 자격 문구 — **짧은 판**.
 *
 * ⚠**순위 화면의 문구와 뜻이 갈리면 안 된다**(M3). 그래서 **같은 함수에서 값을 얻고**
 * 문장만 짧게 만든다. 값을 여기서 다시 계산하면 어느 날 한쪽만 고쳐진다.
 * ⚠**「規定到達のみ」 버튼이 무엇을 자르는지 말하는 글**이므로, 기준을 숨기면
 * 「왜 이 선수가 사라졌지?」에 답할 수 없다.
 */
function batterQualifierShort(bundle: LeagueBundle, teamCode: string): string {
  const games = teamGamesOf(bundle, teamCode);
  return `規定打席 ${neededPa(bundle, teamCode)}（この球団の${games}試合 × 3.1、端数は四捨五入）`;
}

/**
 * ⚠**한 표에 선발과 구원이 함께 있다.** 기준이 역할마다 다르므로 **둘 다 적는다** —
 * 하나만 적으면 나머지 절반의 「規定到達」이 근거 없는 표시가 된다.
 * ⚠**구원 기준은 NPB의 것이 아니다.** 같은 문장으로 쓰면 자체 기준이 공식으로 읽힌다.
 */
function pitcherQualifierShort(bundle: LeagueBundle, teamCode: string): string {
  const st = Math.round((neededOuts(bundle, teamCode, "starter") / 3) * 10) / 10;
  const rl = Math.round((neededOuts(bundle, teamCode, "reliever") / 3) * 10) / 10;
  return `先発は規定投球回 ${st}回（この球団の試合数 × 1回・NPB公式）、救援はその3分の1 ${rl}回（当サイトの基準でNPBのものではありません）`;
}

interface LeagueRankings {
  league: League;
  batting: MetricRanking[];
  /** 선발 부문 */
  starter: MetricRanking[];
  /** 구원 부문 */
  reliever: MetricRanking[];
}

function buildLeagueRankings(
  bundle: LeagueBundle,
  bat: readonly BattingEntry[],
  pit: readonly PitchingEntry[],
  /**
   * `선수ID|리그` 키의 SRC/SRP. ⚠**시즌 합계를 넘기지 마라.**
   *
   * 이 표의 다른 지표는 전부 `agg.battingByLeague`/`pitchingByLeague`(리그별)에서 나온다
   * (`leaderboard.ts` 의 `buildLeagues` — NPB 의 개인 타이틀은 소속 리그 성적만 센다).
   * SRC/SRP 만 시즌 합계면 **같은 표 안에서 분모가 두 종류**가 된다.
   * 실측(2026-08-20 · 고치기 전 `dist`): 山本(23125136)의 퍼시픽 SRC 행이
   * **13.3 / 206打席**(시즌 합계)인데 같은 표의 다른 행은 전부 `101打席 / 90打数`였고,
   * 소프트뱅크 구단 페이지는 같은 선수를 **13.5** 로 쓰고 있었다.
   */
  srcByLeague: ReadonlyMap<string, { src: number; pa: number }>,
  srpByLeague: ReadonlyMap<string, { srp: number; bf: number }>,
): LeagueRankings {
  const bq = batterQualifier(bundle);

  const asRanked = <T>(
    ranked: readonly { item: T; rank: number | null; rate: Rate }[],
    id: (t: T) => { playerId: string; name: string; teamCode: string },
  ): RankedLike[] => ranked.map((r) => ({ rank: r.rank, rate: r.rate, ...id(r.item) }));

  const bid = (e: BattingEntry) => ({
    playerId: e.player.playerId,
    name: e.player.displayName,
    teamCode: e.player.teamCode,
  });
  const pid = (e: PitchingEntry) => ({
    playerId: e.player.playerId,
    name: e.player.displayName,
    teamCode: e.player.teamCode,
  });

  // SRC는 별도 계산이라 BattingEntry에 없다. 자격 기준은 타자와 같게 건다.
  const srcRanked = rankBatters(
    bundle,
    bat,
    (e) => {
      const s = srcByLeague.get(`${e.player.playerId}|${bundle.league}`);
      return s === undefined ? rate(0, 0) : { value: s.src, denominator: s.pa };
    },
    true,
  );

  /**
   * ⚠**순서는 여기서 정하지 않는다**(M1 · 2026-08-18 유저 요청).
   * 목록은 자유롭게 쓰고, 마지막에 `byMetricOrder` 로 **정본 순서**에 맞춘다 —
   * 화면마다 순서가 달라서 같은 지표를 매번 다른 자리에서 찾아야 했다.
   * 무엇을 보여줄지는 여기가, 어느 순서로 놓을지는 `metric-order.ts` 가 정한다.
   */
  const batting: MetricRanking[] = byMetricOrder([
    /**
     * ⚠**분모의 단위를 여기서 적지 않는다**(M1 · 2026-08-20) — `glossary.ts` 의 `den` 이 정본이다.
     * 화면마다 적었더니 出塁率·wOBA 가 `打席` 로 나갔는데 **둘 다 打席이 아니다**
     * (出塁率 = 打席 − 犠打 · wOBA = 거기서 敬遠까지 뺀 수). 그래서 같은 표에서
     * `打席` 열과 「出塁率의 分母」가 서로 다른 수를 가리키고 있었다.
     */
    toMetricRanking("src", "SRC", 1, denUnit("src"), bq, asRanked(srcRanked, bid)),
    toMetricRanking("wrcPlus", "wRC+", 1, denUnit("wrcPlus"), bq, asRanked(rankBatters(bundle, bat, (e) => e.wrcPlus), bid)),
    toMetricRanking("ops", "OPS", 3, denUnit("ops"), bq, asRanked(rankBatters(bundle, bat, (e) => e.ops), bid)),
    toMetricRanking("avg", "打率", 3, denUnit("avg"), bq, asRanked(rankBatters(bundle, bat, (e) => e.avg), bid)),
    toMetricRanking("obp", "出塁率", 3, denUnit("obp"), bq, asRanked(rankBatters(bundle, bat, (e) => e.obp), bid)),
    toMetricRanking("slg", "長打率", 3, denUnit("slg"), bq, asRanked(rankBatters(bundle, bat, (e) => e.slg), bid)),
    toMetricRanking("woba", "wOBA", 3, denUnit("woba"), bq, asRanked(rankBatters(bundle, bat, (e) => e.woba), bid)),
    toMetricRanking("wraa", "wRAA", 1, denUnit("wraa"), bq, asRanked(rankBatters(bundle, bat, (e) => e.wraa), bid)),
    /**
     * **最多安打** — NPB 공식 타이틀 6개 중 **유일하게 빠져 있던 것**이다
     * (2026-08-20 실측: `dist/ranking.html` 에서 「安打」 출현 0회).
     * 값은 `BattingEntry.player.line.h` 로 이미 계산돼 있었고 부르는 곳만 없었다.
     *
     * ⚠**개수라 자격 기준이 없다**(NPB 공식도 없다) — `countRanking` 이 그 문장을 낸다.
     */
    countRanking(
      "h",
      "安打",
      "打席",
      bat.map((e) => ({ ...bid(e), count: e.player.line.h, sample: e.player.line.pa })),
    ),
    countRanking(
      "hr",
      "本塁打",
      "打席",
      bat.map((e) => ({ ...bid(e), count: e.player.line.hr, sample: e.player.line.pa })),
    ),
    countRanking(
      "rbi",
      "打点",
      "打席",
      bat.map((e) => ({ ...bid(e), count: e.player.rbi, sample: e.player.line.pa })),
    ),
    countRanking(
      "sb",
      "盗塁",
      "打席",
      bat.map((e) => ({ ...bid(e), count: e.player.sb, sample: e.player.line.pa })),
    ),
  ], (x) => x.id);

  return {
    league: bundle.league,
    batting,
    starter: pitcherRankings(bundle, pit, "starter", pid, srpByLeague),
    reliever: pitcherRankings(bundle, pit, "reliever", pid, srpByLeague),
  };
}

/**
 * 한 역할의 투수 순위 한 벌.
 *
 * ⚠**개수 지표에도 역할 필터를 건다.** 세이브 순위에 선발 투수를 섞으면 전원 0이 되고,
 * 승리 순위에 마무리를 섞으면 「7승 선발」과 「7승 구원」이 같은 줄에 선다 —
 * 두 7승은 같은 뜻이 아니다.
 * ⚠**개수 지표에는 자격 기준이 없다.** 최다세이브에 이닝 하한은 걸리지 않는다.
 */
function pitcherRankings(
  bundle: LeagueBundle,
  pit: readonly PitchingEntry[],
  role: PitcherRole,
  pid: (e: PitchingEntry) => { playerId: string; name: string; teamCode: string },
  srpByLeague: ReadonlyMap<string, { srp: number; bf: number }>,
): MetricRanking[] {
  const pq = pitcherQualifier(bundle, role);
  const mine = entriesOfRole(pit, role);
  const asRanked = (ranked: readonly { item: PitchingEntry; rank: number | null; rate: Rate }[]): RankedLike[] =>
    ranked.map((r) => ({ rank: r.rank, rate: r.rate, ...pid(r.item) }));
  const rate = (
    id: string,
    label: string,
    pick: (e: PitchingEntry) => Rate,
    higherIsBetter = false,
    /**
     * 분모가 **무엇을 센 것인가.** 기본은 아웃 카운트이고 화면에는 이닝으로 나간다.
     *
     * ⚠**기본값을 그대로 쓰면 안 되는 지표가 있다** — SRP 의 분모는 아웃이 아니라
     * **상대 타자 수**다. 그런데도 기본값을 받아 `bf/3` 을 「投球回」로 그리고 있었다
     * (2026-08-20 실측 · `dist/ranking.html` 의 SRP 행 **123건 중 123건**이 어긋났다):
     * 村上(13315153) 화면 **179.2回** 대 실제 **138.1回**(415아웃 · BF 539) ·
     * 達(01205155) **122.2回** 대 **89.2回** · 大津(01305157) **147.2回** 대 **112.1回**.
     * (⚠감사 보고의 「414아웃」은 반올림이 어긋난 값이다 — 138.1回 = **415아웃**이고,
     *  고치기 전 코드에 되돌려 실측한 결과도 415였다.)
     * 선수 페이지는 같은 값을 **539対戦打者**로 쓰고 있었으므로, 한 페이지 안에서
     * 같은 분모가 두 얼굴을 하고 있었다 — `parts.ts` 의 `statRateOuts` 가 적어 둔 그대로,
     * 분모를 붙이는 것만으로는 M2 를 지킨 것이 아니고 **맞는 분모**여야 한다.
     */
    den: { unit: string; asInnings: boolean } = { unit: "投球回", asInnings: true },
    /**
     * 소수 자릿수. 투수 비율은 대개 2자리(`3.20`)지만 **勝率은 3자리**(`.625`)다 —
     * 야구 관례이고, 2자리로 내면 동률이 없는데 있는 것처럼 보인다.
     */
    digits: RankDigits = 2,
  ): MetricRanking =>
    // ⚠**방향을 끝까지 넘긴다.** 「전원 순위」도 같은 방향으로 매겨야 한다 —
    // 안 넘기면 방어율 전원 순위가 **나쁜 순**이 되어 1위가 최악의 투수가 된다
    toMetricRanking(
      id, label, digits, den.unit, pq,
      asRanked(rankPitchersInRole(bundle, pit, role, pick, higherIsBetter)),
      den.asInnings, false, higherIsBetter,
    );
  const count = (id: string, label: string, of: (e: PitchingEntry) => number): MetricRanking =>
    countRanking(
      id, label, "投球回",
      mine.map((e) => ({ ...pid(e), count: of(e), sample: e.player.line.outs })),
      true,
    );

  /**
   * 投球回 순위만 모양이 다르다.
   *
   * ⚠**값이 아웃 카운트**라 그대로 정수로 내면 415아웃이 「415」가 된다 — 이닝으로 바꾼다.
   * ⚠그리고 **분모를 투구회로 두면 같은 수가 두 번 나온다**(`138.1回 / 138.1回`).
   * 여기서 알고 싶은 것은 「몇 경기로 그 이닝을 던졌는가」이므로 분모는 등판 수다.
   */
  const inningsRanking = (): MetricRanking =>
    countRanking(
      "outs", "投球回", "試合",
      mine.map((e) => ({ ...pid(e), count: e.player.line.outs, sample: e.player.games })),
      false,
      true,
    );

  /** ⚠**순서는 `metric-order.ts` 가 정한다**(위 타자 목록과 같은 이유) */
  const common: MetricRanking[] = byMetricOrder([
    // ⚠SRP는 **높을수록 좋다.** 다른 투수 비율과 방향이 반대다
    // ⚠**분모는 상대 타자 수다**(아웃이 아니다). 단위를 선수 페이지(`対戦打者`)와 맞춘다 —
    //   두 화면이 같은 이름으로 다른 것을 가리키면 그 자체가 거짓말이 된다(M1·M2)
    rate("srp", "SRP", (e) => {
      const v = srpByLeague.get(`${e.player.playerId}|${bundle.league}`);
      return v === undefined ? { value: null, denominator: 0 } : { value: v.srp, denominator: v.bf };
    }, true, { unit: denUnit("srp"), asInnings: false }),
    rate("era", "防御率", (e) => e.era),
    rate("fip", "FIP", (e) => e.fip),
    rate("whip", "WHIP", (e) => e.whip),
    rate("k9", "K/9", (e) => strikeoutsPer9(e.player.line), true),
    rate("bb9", "BB/9", (e) => walksPer9(e.player.line)),
    count("so", "奪三振", (e) => e.player.line.so),
    // ⚠球数/アウト는 **낮을수록 좋다.** 다른 투수 개수 지표와 성격이 다르다
    rate("pitchesPerOut", "球数/アウト", (e) =>
      e.player.pitches === null
        ? { value: null, denominator: e.player.line.outs }
        : { value: e.player.pitches / e.player.line.outs, denominator: e.player.line.outs },
    ),
    count("pitches", "投球数", (e) => e.player.pitches ?? 0),
    inningsRanking(),
  ], (x) => x.id);

  /**
   * ⚠**최종 목록을 정렬한다 — `common` 만 정렬해서는 안 된다**(2026-08-18 유저 지적).
   * 역할별 지표를 앞뒤로 이어 붙이면 **정렬된 `common` 이 중간에 끼어** 전체 순서가 깨진다.
   * 실제로 구원이 그랬다: `セーブ · ホールド · HP · [정렬된 공통] · 勝利 · 登板` —
   * 그래서 **SRP 가 세 번째 뒤로 밀려** 있었다. 한 화면만 순서가 다르면 그 화면부터 의심받는다.
   *
   * ⚠**첫 지표가 그 화면의 주장이다.** 선발의 첫 지표는 한때 「勝利」였다 —
   * FIP·WHIP·SRP를 자체 산출하는 사이트가 승수를 앞세우는 것은 자기모순이고,
   * 승수는 타선과 구원진이 절반을 정한다. **투수 자신을 재는 값**이 먼저다.
   * 그 판단은 이제 `metric-order.ts` 가 한 벌로 들고 있다.
   */
  if (role === "starter") {
    return byMetricOrder([
      ...common,
      count("w", "勝利", (e) => e.player.decisions.w),
      count("l", "敗戦", (e) => e.player.decisions.l),
      count("starts", "先発", (e) => e.player.starts),
      count("qs", "QS", (e) => e.player.quality.qs),
      /**
       * **最高勝率** — NPB 공식 타이틀인데 개인 순위가 없었다
       * (2026-08-20 실측: `dist/ranking.html` 의 「勝率」 4회는 전부 **팀 순위표의 각주**다).
       *
       * ⚠**분모는 決着数(勝 + 敗)다** — 무승부도 노디시전도 들어가지 않는다(NPB 규칙).
       *   투구회가 아니므로 `asInnings` 를 끈다. 켜 두면 `12決着` 이 `4回` 로 나간다
       *   (SRP 가 정확히 그 함정을 밟아 123행 전부가 어긋나 있었다).
       * ⚠**선발 목록에만 둔다.** 最高勝率의 자격은 **NPB 규정투구회**인데,
       *   구원 쪽 목록의 자격선은 그 3분의 1인 **우리 기준**이라 NPB 것이 아니다.
       *   같은 타이틀 이름에 다른 자격을 붙이면 자체 기준이 공식으로 읽힌다(§0-10).
       * ⚠**목록의 맨 뒤다** — 자리는 `metric-order.ts` 가 정한다. 승패는 타선과 구원진이
       *   절반을 정하므로, 그 값들을 자체 산출하는 사이트가 앞세울 값이 아니다.
       */
      rate(
        "winPct",
        "勝率",
        (e) => {
          const d = e.player.decisions;
          return { value: winPct(d.w, d.l), denominator: d.w + d.l };
        },
        true,
        { unit: denUnit("winPct"), asInnings: false },
        3,
      ),
    ], (x) => x.id);
  }
  return byMetricOrder([
    count("sv", "セーブ", (e) => e.player.decisions.sv),
    count("hld", "ホールド", (e) => e.player.decisions.hld),
    // HP(홀드포인트) = 홀드 + 구원승. NPB 最優秀中継ぎ의 정의다
    count("hp", "HP", (e) => e.player.decisions.hld + e.player.decisions.reliefW),
    ...common,
    count("w", "勝利", (e) => e.player.decisions.w),
    count("games", "登板", (e) => e.player.games),
  ], (x) => x.id);
}

/**
 * 선수 페이지에 실을 순위표 — 상위 N + **본인 행은 순위 밖이어도 반드시 넣는다**.
 *
 * ⚠**본인이 없는 순위표는 순위표가 아니다.** 「내가 몇 위인가」가 이 블록의 존재 이유이고,
 * 상위 10명만 자르면 그 답이 사라진다.
 */
export function panelsForPlayer(
  // ⚠**총수 두 개는 여기서 만든다.** 부르는 쪽(MetricRanking)은 그 값을 갖고 있지 않고,
  // 선수 페이지의 순위 블록에는 「規定到達のみ」 전환이 없어서 화면에도 안 쓰인다
  rankings: readonly Omit<RankingPanel, "qualifiedCount" | "allCount" | "minTop">[],
  playerId: string,
  limit = RANKING_ROWS,
): RankingPanel[] {
  return rankings.map((m) => {
    const top = m.rows.slice(0, limit).map((r) => ({ ...r, isMe: r.playerId === playerId }));
    if (!top.some((r) => r.isMe)) {
      const mine = m.rows.find((r) => r.playerId === playerId);
      if (mine !== undefined) top.push({ ...mine, isMe: true });
    }
    return {
      id: m.id,
      label: m.label,
      digits: m.digits,
      unit: m.unit,
      denAsInnings: m.denAsInnings,
      valueAsInnings: m.valueAsInnings === true,
      rows: top,
      qualifiedCount: m.rows.filter((r) => r.rank !== null).length,
      allCount: m.rows.filter((r) => r.rankAll !== null).length,
      /**
       * ⚠**선수 페이지의 순위 블록에는 「規定到達のみ」 전환도 최소 표본 입력도 없다.**
       * 그래서 **약속 자체가 없다** — null 이다(M11: 「0명 보장」이 아니라 「그런 기능이 없다」).
       * ⚠여기에 수를 넣으면 **지키지 못할 약속**이 된다: 이 블록은 상위 10 + 본인만 싣고
       * `rankingRowsFor` 를 거치지 않는다. 언젠가 이 블록에 입력을 붙인다면 **그때 같이 고쳐라.**
       */
      minTop: null,
      qualifier: m.qualifier,
    };
  });
}

/**
 * 화면에 실을 행을 고른다 — **세 벌의 합집합**이다.
 * ⑴ 규정 도달자 상위 N · ⑵ 전원 상위 N · ⑶ **어느 하한에서도 상위 `RANKING_MIN_TOP` 에 들 수 있는 행**(`everTop`).
 * ⑶ 은 최소 표본 입력이 붙는 패널에만 붙는다.
 *
 * ⚠**자르기 전에 골라야 한다.** 처음에는 `rows.slice(0, limit)` 로 **먼저 자른 뒤**
 * 그 안에서 「전원 상위 N」을 뽑았다. 그러면 전원 순위 1~10위가 애초에 잘려 나가서,
 * 「全員」으로 바꿔도 **정작 1위가 화면에 없다**(2026-08-17 실측: 打率 패널의 전원 순위가
 * 11위부터 시작했다). 골라 담는 순서가 뒤바뀌면 기능이 통째로 헛돈다.
 *
 * ⚠**최종 정렬은 「전원 순위」다.** 규정 도달자를 앞에 몰고 미달자를 뒤에 붙이면,
 * 「全員」으로 바꿨을 때 표가 11, 18, 19, … 87, 12, 13 순으로 읽힌다 — **순위표가
 * 순위 순이 아니게 된다.** 전원 순위로 정렬해 두면 두 모드 다 오름차순이 된다:
 * 규정 도달자만 남겨도 그 부분집합의 상대 순서는 그대로이기 때문이다
 * (두 순위가 **같은 값**을 같은 규칙으로 줄 세운 것이라 순서가 어긋날 수 없다).
 */
export function rankingRowsFor(rows: readonly RankingRow[], limit: number): RankingRow[] {
  const withValue = rows.filter((r) => r.rankAll !== null);
  // 값이 하나도 없는 지표는 예전대로 앞에서부터 자른다 — 「없음」 행이라도 보여야 한다(M11)
  if (withValue.length === 0) return rows.slice(0, limit);

  /**
   * ⚠**들어온 순서에 기대지 않는다.** 예전에는 `m.rows` 가 규정 순위순으로 정렬돼 있다는
   * 사실에 기대 그냥 앞에서 잘랐다. 그러면 **같은 입력을 다시 넣으면 답이 달라질 수 있고**
   * (계측·시험이 정확히 그렇게 부른다), 그건 「고르는 규칙」이 함수 밖에 반쯤 있는 것이다.
   */
  const head = rows
    .filter((r) => r.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .slice(0, limit);
  const picked = new Map(head.map((r) => [r.playerId, r]));
  const byAll = [...withValue].sort((a, b) => (a.rankAll ?? 0) - (b.rankAll ?? 0)).slice(0, limit);
  for (const r of byAll) if (!picked.has(r.playerId)) picked.set(r.playerId, r);
  /**
   * ⚠**여기가 「최소 표본」을 실제로 성립시키는 자리다**(2026-08-20).
   * 위 두 벌만으로는 이런 선수가 **두 화면 어디에도 없다**: 규정에 못 미쳐 규정 상위 N 밖이고,
   * 표본이 작은 선수들에게 밀려 전원 상위 N 에도 못 든다. 하한은 **실린 행 안에서만** 거르므로
   * 그 선수는 하한을 아무리 올려도 안 나온다 — **하한 기능이 노리던 바로 그 선수다.**
   * 실측(2026-08-20 · 9시즌 18 리그-시즌 · 하한을 실재 분모 전량으로 훑음):
   * 입력이 붙는 23개 지표가 **전부** 걸렸고, 최대 **상위 10 중 6명**이 화면에 없었다.
   */
  const k = minTopFor(rows, limit);
  if (k !== null) {
    for (const r of everTop(withValue, k)) {
      if (!picked.has(r.playerId)) picked.set(r.playerId, r);
    }
  }
  return [...picked.values()].sort((a, b) => (a.rankAll ?? 0) - (b.rankAll ?? 0));
}

/**
 * **어느 최소 표본을 넣어도 상위 몇 명까지는 표 안에 있는가.** 입력칸이 안 붙는 패널이면 null.
 *
 * ⚠**정본은 여기다**(M1). 화면은 `RankingPanel.minTop` 를 그대로 읽는다 —
 * 예전에는 렌더러가 **고른 뒤의 행**으로 「입력칸을 붙일까」를 다시 판정했고,
 * 그러면 「고르기가 무엇을 남겼는가」에 따라 조작이 붙었다 안 붙었다 할 수 있었다.
 * ⚠**개수 지표(홈런·세이브·도루…)에는 자격 기준이 없어 null 이다.** 그 패널에는
 * 입력칸 자체가 안 그려지므로 **행을 넓혀도 아무 조작으로 닿을 수 없다** — 그래서 안 넓힌다.
 * ⚠**표보다 큰 약속을 하지 않는다** — 5행짜리 일람의 하이라이트에서 그보다 큰 수를 보장하면
 * 그 표가 10행 넘게 부푼다. 약속은 **그 표의 크기까지**다.
 */
export function minTopFor(rows: readonly RankingRow[], limit: number): number | null {
  if (!rows.some((r) => r.rank === null && r.rankAll !== null)) return null;
  return Math.min(RANKING_MIN_TOP, limit);
}

/**
 * **어느 최소 표본을 넣어도 상위 몇 명까지 보장하는가**(순위표 페이지 기준).
 *
 * ⚠**이 수를 올리는 것은 공짜가 아니다 — 재고 올려라.** 실측(2026-08-20 · 9시즌 전 패널 ·
 * `scripts/ranking-cut-measure.ts --ksweep`):
 * ```
 *  k    평균행  최대행   밴드 없는 상태 대비 행
 *  0    34.3    52    —            ← 밴드 없음(= 고치기 전)
 * 10    34.6    52    +1.0%         ← 지금
 * 15    35.7    53    +4.3%
 * 20    37.6    60    +9.7%
 * 30    42.8    72   +25.0%
 * ```
 * **30 은 실제로 빌드해서 바이트를 재 보았다**: `ranking.html` 이 지금보다
 * **시즌별 +16.0 ~ +22.6 %p**(2024: 981,449 → 1,202,787바이트). 상한을 넘어 보류했다.
 *
 * ⚠**올리면 시험이 먼저 떨어진다**(`ranking-min-sample.test.ts` 의 행 천장) —
 * 그것은 고장이 아니라 **비용을 다시 재라는 물음**이다. 재고 천장을 같이 고쳐라.
 */
export const RANKING_MIN_TOP = 10;

/**
 * **어느 하한에서도 상위 k 에 들 수 있는 행 전부** — 그 이상도 이하도 아니다.
 *
 * 행 r 이 어떤 하한에서 상위 k 에 들려면 **가장 너그러운 하한(T = r 자신의 분모)** 에서
 * 들어야 한다. T 를 더 내리면 경쟁자만 늘고, 더 올리면 r 자신이 빠지기 때문이다.
 * 그 하한에서 r 보다 앞서는 것은 **「분모가 r 이상이면서 전원 순위가 더 좋은」 행**뿐이므로,
 * → **그런 행이 k 개 미만인 행 전부**가 답이고, k 개 이상인 행은 **어느 하한에서도 못 든다.**
 *
 * ⚠**새 순위를 만드는 것이 아니다**(M1/M3). 쓰는 것은 행이 이미 들고 있는 두 값
 * (전원 순위 · 분모)뿐이고, 정렬도 동률 규칙도 서버가 매긴 그대로다. **싣는 행만 넓힌다.**
 *
 * 분모 큰 쪽부터 훑으면서 「지금까지 본 전원 순위 중 가장 좋은 k 개」만 들고 다닌다 —
 * 그 k 번째가 나보다 좋으면 나를 밀어낸 것이 이미 k 개라는 뜻이다. O(n·k).
 * ⚠**같은 분모끼리도 서로를 밀어낸다**(조건이 「분모 ≥」이므로). 그래서 분모가 같으면
 * 전원 순위가 좋은 쪽을 먼저 놓아, 그 행이 뒤 행의 계산에 이미 들어가 있게 한다.
 */
function everTop(rows: readonly RankingRow[], k: number): RankingRow[] {
  const byDen = rows
    .filter((r) => r.rankAll !== null)
    .sort((a, b) => b.value.denominator - a.value.denominator || (a.rankAll ?? 0) - (b.rankAll ?? 0));
  const out: RankingRow[] = [];
  /** 지금까지 본 행의 전원 순위 중 **가장 좋은 k 개**. 오름차순 */
  const best: number[] = [];
  for (const r of byDen) {
    const mine = r.rankAll ?? 0;
    // ⚠**같은 순위는 밀어내지 못한다**(동률은 같은 하한에서 함께 산다) — 그래서 `>=` 다
    if (best.length < k || best[k - 1]! >= mine) out.push(r);
    let p = best.length;
    best.push(mine);
    while (p > 0 && best[p - 1]! > mine) {
      best[p] = best[p - 1]!;
      p -= 1;
    }
    best[p] = mine;
    if (best.length > k) best.length = k;
  }
  return out;
}

function panelsForPage(rankings: readonly MetricRanking[], limit: number): RankingPanel[] {
  return rankings.map((m) => ({
    id: m.id,
    label: m.label,
    digits: m.digits,
    unit: m.unit,
    denAsInnings: m.denAsInnings,
    valueAsInnings: m.valueAsInnings === true,
    rows: rankingRowsFor(m.rows, limit),
    // ⚠**자르기 전 수를 센다** — 「該当 N人」이 자른 뒤의 수면 그것도 거짓말이다
    qualifiedCount: m.rows.filter((r) => r.rank !== null).length,
    allCount: m.rows.filter((r) => r.rankAll !== null).length,
    minTop: minTopFor(m.rows, limit),
    qualifier: m.qualifier,
  }));
}

function ranksFor(rankings: readonly MetricRanking[], playerId: string): Ranks {
  const out: Record<string, number | null> = {};
  for (const m of rankings) out[m.id] = m.rankOf.get(playerId) ?? null;
  return out;
}

// ─── DB 조회 ─────────────────────────────────────────────────────────────

interface ProfileRow {
  playerId: string;
  position: string | null;
  throws: string | null;
  bats: string | null;
  /**
   * 태어난 **해**. ⚠**월·일은 보관하지 않는다**(L5 · 2026-08-18 감사 P3) —
   * 화면이 쓰는 것이 연도뿐이었는데 DB 에는 980명분 일 단위 값이 있었다.
   */
  birthYear: number | null;
  physique: string | null;
  draft: string | null;
  /** 읽는 법 **원문**. 외국인 선수는 `ルーク・ボイト (LUKE VOIT)` 꼴이다 — 정규화는 검색이 한다 */
  kana: string | null;
  /** 등번호. ⚠**null은 「0번」이 아니라 「지금 등록이 없다」**(M11) — 은퇴·이적 선수다 */
  uniformNumber: string | null;
}

function loadProfiles(db: Db): Map<string, ProfileRow> {
  const rows = db.raw
    .prepare(
      `SELECT player_id AS playerId, position, throws, bats,
              birth_year AS birthYear, physique, draft,
              kana, uniform_number AS uniformNumber
       FROM player`,
    )
    .all() as unknown as ProfileRow[];
  return new Map(rows.map((r) => [r.playerId, r]));
}

function loadScorebook(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, ScorebookRow[]> {
  const rows = db.raw
    .prepare(
      `SELECT e.batter_id AS playerId, e.game_id AS gameId,
              g.game_date AS date, g.away_code AS away, g.home_code AS home,
              e.half AS half, e.inning AS inning, e.outs_before AS outs, e.bases AS bases,
              e.outcome AS outcome, e.rbi AS rbi, e.raw_box AS rawBox
       FROM pa_event e
       JOIN game g ON g.game_id = e.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
         AND g.game_date <= ? AND e.status = 'final'
       ORDER BY g.game_date DESC, e.game_id DESC, e.seq DESC`,
    )
    .all(season, competition, through) as {
    playerId: string;
    gameId: string;
    date: string;
    away: string;
    home: string;
    half: string;
    inning: number;
    outs: number;
    bases: string;
    outcome: string;
    rbi: number;
    rawBox: string;
  }[];

  const out = new Map<string, ScorebookRow[]>();
  for (const r of rows) {
    const list = out.get(r.playerId);
    if (list !== undefined && list.length >= SCOREBOOK_LIMIT) continue;
    // 표(top)에서 치는 쪽이 원정이므로 상대는 홈 팀이다.
    const opponentCode = r.half === "top" ? r.home : r.away;
    const team = TEAMS.find((t) => t.code === opponentCode);
    const row: ScorebookRow = {
      date: r.date,
      // ⚠**슬러그로 바꿔서 넘긴다.** 화면이 `/` 를 파일명에 쓸 수 없다 —
      // 렌더러가 다시 변환하게 두면 그 규칙이 두 벌이 된다(M1)
      gameSlug: gameSlug(r.gameId),
      opponent: team?.name ?? opponentCode.toUpperCase(),
      inning: r.inning,
      half: r.half === "top" ? "top" : "bottom",
      outs: r.outs,
      bases: r.bases,
      outcome: r.rawBox,
      rbi: r.rbi,
      hit: countsAsHit(r.outcome as Outcome),
    };
    if (list === undefined) out.set(r.playerId, [row]);
    else list.push(row);
  }
  return out;
}

function loadStatePa(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, Map<string, number>> {
  const rows = db.raw
    .prepare(
      `SELECT e.batter_id AS playerId, e.bases AS bases, e.outs_before AS outs, COUNT(*) AS n
       FROM pa_event e
       JOIN game g ON g.game_id = e.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
         AND g.game_date <= ? AND e.status = 'final'
       GROUP BY e.batter_id, e.bases, e.outs_before`,
    )
    .all(season, competition, through) as {
    playerId: string;
    bases: string;
    outs: number;
    n: number;
  }[];

  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = out.get(r.playerId);
    if (m === undefined) {
      m = new Map();
      out.set(r.playerId, m);
    }
    m.set(stateKey(r.bases, r.outs), r.n);
  }
  return out;
}

/**
 * 얇은 구장을 한 줄로 접는다.
 *
 * ⚠**버리지 않고 합친다.** 합계가 맞아야 「그 선수의 전 타석이 어딘가에 있다」고 말할 수 있다.
 * 몇 곳을 합쳤는지 라벨에 적어, 「왜 어제 갔던 지방구장이 안 보이지?」에 답할 수 있게 한다.
 *
 * ⚠**한 곳만 얇으면 접지 않는다.** 「その他の球場（1球場）」은 이름을 감추기만 하고
 * 줄 수는 그대로다 — 아무것도 얻지 못하고 정보만 사라진다.
 */
export function foldThinVenues(rows: readonly SplitRow[]): SplitRow[] {
  const thin = rows.filter((r) => r.line.pa < VENUE_MIN_PA);
  if (thin.length <= 1) return [...rows];

  const line = sumBatting(thin.map((r) => r.line));
  return [
    ...rows.filter((r) => r.line.pa >= VENUE_MIN_PA),
    {
      key: "__other__",
      label: `その他の球場（${thin.length}球場）`,
      line,
      rbi: thin.reduce((n, r) => n + r.rbi, 0),
      ...derived(line),
    },
  ];
}

/**
 * @param allowed true면 투수 스플릿(피성적)을 만든다.
 *   ⚠**같은 함수로 만든다**(M1) — 축 목록·정렬·얇은 표본 규칙이 두 벌이 되면 어긋난다.
 */
function loadSplits(
  db: Db,
  season: number,
  competition: string,
  through: string,
  allowed = false,
): Map<string, SplitAxisData[]> {
  const out = new Map<string, SplitAxisData[]>();
  const query = allowed ? pitchingSplits : battingSplits;

  for (const axis of SPLIT_AXES) {
    for (const p of query(db, axis.dimension, season, competition, through)) {
      const rows: SplitRow[] = p.splits.map((s) => ({
        key: s.key,
        label: splitLabel(axis.id, s.key, allowed),
        line: s.line,
        rbi: s.rbi,
        ...derived(s.line),
      }));
      // ⚠**월별은 라벨이 아니라 키로 정렬한다.** 「10月」은 문자열 비교에서 「4月」보다 앞에 온다.
      rows.sort((a, b) => (axis.id === "month" ? a.key.localeCompare(b.key) : b.line.pa - a.line.pa));
      const entry: SplitAxisData = {
        id: axis.id,
        label: axis.label,
        allowed,
        rows: axis.id === "venue" ? foldThinVenues(rows) : rows,
        unclassified: p.unclassified,
        thinBelow: THIN_SPLIT_PA,
      };
      const list = out.get(p.playerId);
      if (list === undefined) out.set(p.playerId, [entry]);
      else list.push(entry);
    }
  }

  // 축 순서를 카탈로그 순서로 되돌린다(수집 순서에 의존하지 않게).
  const order = new Map(SPLIT_AXES.map((a, i) => [a.id, i]));
  for (const list of out.values()) list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return out;
}

/**
 * 상대전적을 **양방향으로** 만든다 — 타자에게는 상대 투수 목록, 투수에게는 상대 타자 목록.
 *
 * ⚠**자르지 않는다.** 2026 시즌 실측으로 조합은 19,769쌍, 한 선수 최대 156명이라
 * 전량을 실어도 페이지가 감당한다. 잘라 놓고 검색하게 하면 「없는 상대」가 생긴다.
 */
function loadMatchups(
  db: Db,
  season: number,
  competition: string,
  through: string,
  teamOf: Map<string, string>,
  /**
   * 어느 시즌부터 셀 것인가. 기본은 그 시즌만.
   *
   * ⚠**통산은 「보고 있는 시즌까지」다** — 과거 시즌 화면이 미래를 말하지 않게 한다.
   */
  fromSeason = season,
): { byBatter: Map<string, MatchupRow[]>; byPitcher: Map<string, MatchupRow[]> } {
  const byBatter = new Map<string, MatchupRow[]>();
  const byPitcher = new Map<string, MatchupRow[]>();

  const push = (map: Map<string, MatchupRow[]>, key: string, row: MatchupRow): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [row]);
    else list.push(row);
  };

  for (const m of matchups(db, season, 1, competition, through, fromSeason)) {
    const avg = battingAverage(m.line);
    push(byBatter, m.batterId, {
      opponentId: m.pitcherId,
      opponentName: m.pitcherName,
      opponentTeam: teamOf.get(m.pitcherId) ?? "",
      line: m.line,
      rbi: m.rbi,
      avg,
    });
    push(byPitcher, m.pitcherId, {
      opponentId: m.batterId,
      opponentName: m.batterName,
      opponentTeam: teamOf.get(m.batterId) ?? "",
      line: m.line,
      rbi: m.rbi,
      avg,
    });
  }

  for (const map of [byBatter, byPitcher]) {
    for (const list of map.values()) list.sort((a, b) => b.line.pa - a.line.pa || b.line.h - a.line.h);
  }
  return { byBatter, byPitcher };
}

/** 투수의 월별 방어율. 표제 옆 꺾은선의 입력이 된다 */
function loadMonthlyEra(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, { month: string; era: number | null }[]> {
  const rows = db.raw
    .prepare(
      `SELECT t.player_id AS playerId, substr(g.game_date, 1, 7) AS month,
              SUM(t.outs) AS outs, SUM(t.er) AS er
       FROM pitching_line t
       JOIN game g ON g.game_id = t.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
       GROUP BY t.player_id, month
       ORDER BY t.player_id, month`,
    )
    .all(season, competition, through) as {
    playerId: string;
    month: string;
    outs: number;
    er: number;
  }[];

  const out = new Map<string, { month: string; era: number | null }[]>();
  for (const r of rows) {
    const era = earnedRunAverage({ ...EMPTY_PITCHING, outs: r.outs, er: r.er }).value;
    const list = out.get(r.playerId);
    const entry = { month: r.month, era };
    if (list === undefined) out.set(r.playerId, [entry]);
    else list.push(entry);
  }
  return out;
}

/**
 * 구단별 선수 목록. **색인 화면은 서버가 그린다** —
 * 스크립트가 죽어도 전 선수에게 도달할 수 있어야 하고, 그게 §0-1(3클릭)의 최저선이다.
 */
function rosters(
  players: readonly PlayerPageData[],
  /** 읽는 법은 화면 데이터에 없다 — **명부의 좁히기만 쓰는 값**이라 여기서만 꺼낸다 */
  profiles: ReadonlyMap<string, ProfileRow>,
): TeamRoster[] {
  const byTeam = new Map<string, RosterEntry[]>();
  for (const p of players) {
    const list = byTeam.get(p.teamCode);
    // 마크는 선수 페이지와 **같은 것**을 작게 쓴다 — 목록과 상세가 다른 그림이면 표시로서 쓸모가 없다
    const entry: RosterEntry = {
      playerId: p.playerId,
      name: p.name,
      mark: positionMark(p.position),
      axes: p.mark.axes,
      sampleText: p.mark.sampleText,
      // ⚠**검색 드롭다운이 쓰는 것과 같은 문자열이다**(M1). 명부에만 없어서 첫 화면에
      // 숫자가 한 개도 없었다 — 값은 계속 있었고 실리는 자리가 없었을 뿐이다
      summary: p.summary,
      // ⚠**색인(`SearchEntry.k`)과 같은 원문이다**(M1). 접기는 클라이언트 한 벌이 한다
      kana: profiles.get(p.playerId)?.kana ?? null,
      uniformNumber: p.uniformNumber,
    };
    if (list === undefined) byTeam.set(p.teamCode, [entry]);
    else list.push(entry);
  }

  // 구단 순서는 마스터 순서를 따른다 — 선수 수로 정렬하면 매일 순서가 바뀐다
  return TEAMS.filter((t) => byTeam.has(t.code)).map((t) => ({
    code: t.code,
    name: t.name,
    shortName: shortNameOf(t.code),
    color: colorOf(t.code),
    players: (byTeam.get(t.code) ?? []).sort((a, b) => a.name.localeCompare(b.name, "ja")),
  }));
}

interface ProbableRow {
  gameDate: string;
  teamCode: string;
  opponentCode: string;
  playerId: string | null;
  venue: string | null;
  startTime: string | null;
  league: string;
}

/**
 * 예고 선발을 읽는다. **가장 최근에 예고된 하루**만 본다 —
 * 지난 예고는 이미 경기가 끝나 확정 기록으로 대체됐다.
 *
 * ⚠**미래 날짜를 고르지 않는다.** 페이지가 내일분을 게시하므로 `MAX(game_date)`가
 * 곧 「다음 경기일」이고, 그게 이 화면의 대상이다.
 */
function loadProbables(db: Db, season: number, date?: string): ProbableRow[] {
  /**
   * ⚠**시즌으로 거른다.** 예고선발은 「다음 경기」의 정보라 언제나 현재 시즌 것이다.
   * 안 거르면 **2025년 화면에 2026년의 예고선발이 뜬다** — 실제로 그렇게 나왔다(2026-08-16).
   * 게다가 방어율까지 2026년 값이라, 지난 시즌을 보는 사람에게 통째로 거짓말이 된다.
   */
  const dates = probableDates(db, season);
  if (dates.length === 0) return [];
  const pick = date ?? dates[dates.length - 1]!;
  return db.raw
    .prepare(
      `SELECT game_date AS gameDate, team_code AS teamCode, opponent_code AS opponentCode,
              player_id AS playerId, venue, start_time AS startTime, league
       FROM probable_pitcher WHERE game_date = ?`,
    )
    .all(pick) as unknown as ProbableRow[];
}

/**
 * 우리가 **예고를 가진 모든 날**. 오래된 것부터.
 *
 * ⚠**하루치만 읽고 있었다**(2026-08-18 유저 지적). `MAX(game_date)` 한 줄만 봐서,
 * 새 예고가 들어오는 순간 어제 것을 볼 방법이 사라졌다 — 「이전」을 눌러도 그 화면에는
 * 예고가 아예 없었다. 예고는 **경기 전에만 존재하는 정보**라 지나가면 다시 못 받는다.
 * 그래서 매일 받아 두는데, 받아 놓고 못 보게 두면 그 수집이 헛된 것이 된다.
 */
export function probableDates(db: Db, season: number): string[] {
  return (db.raw
    .prepare(
      "SELECT DISTINCT game_date AS d FROM probable_pitcher WHERE game_date LIKE ? ORDER BY d",
    )
    .all(`${season}-%`) as unknown as { d: string }[]).map((r) => r.d);
}

/**
 * 기본으로 열 날짜.
 *
 * ⚠**「당일」이 기본이다**(2026-08-18 유저 요청: 「당일의 시합 결과가 모두 들어오기 전까지
 * 해당 탭의 디폴트는 당일 예고 선발로」). 예고는 전날 저녁에 다음날 것이 붙으므로,
 * 아무 생각 없이 `MAX` 를 쓰면 **오늘 경기를 보러 온 사람에게 내일 것을 내민다.**
 * ⚠**오늘 것이 없으면 가장 최근으로 떨어진다** — 없는 날을 가리키지 않는다(M12).
 */
export function defaultProbableDate(dates: readonly string[], builtOn: string): string | null {
  if (dates.length === 0) return null;
  return dates.includes(builtOn) ? builtOn : dates[dates.length - 1]!;
}

/**
 * 그 예고일을 **「次の」라고 불러도 되는가**.
 *
 * ⚠**끝난 날을 「次の」라고 부르지 않는다**(2026-08-18 감사 P1).
 * 배포물이 위 구획에서 「次の予告先発 8月16日」이라 쓰고 아래 구획에서
 * 「8月16日の結果」라고 썼다 — **한 페이지가 같은 날을 예정이자 종료로 동시에 선언**했다.
 * 양쪽 다 그럴듯해서 오류로 보이지 않고, 읽는 사람은 **끝난 경기의 선발을 예습한다.**
 * 원인은 당일 예고를 못 받은 날에 **무조건 마지막 예고일로 떨어지는** 기본값이고,
 * 그 마지막 예고일이 이미 치러진 날이었다.
 *
 * ⚠**해결을 새 상태로 만들지 않는다**(M12). 「예고일이 과거다」를 5번째 상태로 두는 대신
 * **없는 것으로 떨어뜨려** 기존 「まだ発表されていません」 분기로 흘린다 — 사실 그대로다.
 * ⚠**지난 예고 자체를 지우는 것이 아니다.** 그건 날짜별 예고 화면(아카이브)의 일이고,
 *   여기는 「다음」 구획이다.
 * ⚠**같은 날이면 「다음」이 아니다.** 그날 경기는 이미 우리 기록에 들어와 있다.
 */
export function isNextProbable(probableDate: string | null, latestGameDate: string | null): boolean {
  if (probableDate === null) return false;
  return latestGameDate === null || probableDate > latestGameDate;
}

/**
 * 예고 선발 화면 데이터.
 *
 * ⚠**같은 경기의 두 행을 팀 코드로 짝짓는다**(`team_code`/`opponent_code`).
 * 순서나 구장으로 짝지으면 더블헤더에서 어긋난다.
 */
function startersPage(
  rows: readonly ProbableRow[],
  builtOn: string,
  pitchingByPlayer: Map<string, PitchingEntry>,
  matchupsByPitcher: Map<string, MatchupRow[]>,
  /** ⚠**시즌 집계와 같은 한 벌을 쓴다**(M1) — 여기서 SRP 를 다시 계산하지 않는다 */
  srpByPlayer: ReadonlyMap<string, { srp: number; bf: number }>,
  /** 통산 대전. **같은 모양의 지도**라 화면이 두 벌을 같은 부품으로 그린다 */
  careerByPitcher: ReadonlyMap<string, MatchupRow[]>,
  /** 우리가 예고를 가진 모든 날(오래된 것부터). 앞뒤 이동의 근거다 */
  allDates: readonly string[],
  /** 기본으로 열리는 날 — 그 날로 가는 링크만 `starters.html` 을 가리킨다 */
  defaultDate: string | null,
  /** 우리가 보유한 첫 시즌. ⚠**화면이 「通算」이라고 말하지 않게 하는 근거다** */
  heldFrom: number,
): StartersPageData {
  if (rows.length === 0) return { heldFrom, gameDate: null, defaultDate: null, prev: null, next: null, dayCount: 0, builtOn, games: [] };

  const at = allDates.indexOf(rows[0]!.gameDate);
  const prev = at > 0 ? allDates[at - 1]! : null;
  const next = at >= 0 && at < allDates.length - 1 ? allDates[at + 1]! : null;
  const dayCount = allDates.length;

  const byTeam = new Map(rows.map((r) => [r.teamCode, r]));
  const seen = new Set<string>();
  const games: ProbableGame[] = [];

  const toSide = (r: ProbableRow, opponentCode: string): ProbableSide => {
    const team = teamOf(r.teamCode);
    const entry = r.playerId === null ? undefined : pitchingByPlayer.get(r.playerId);
    const all = r.playerId === null ? [] : (matchupsByPitcher.get(r.playerId) ?? []);
    return {
      teamCode: r.teamCode,
      teamName: team.name,
      shortName: shortNameOf(r.teamCode),
      color: colorOf(r.teamCode),
      playerId: r.playerId,
      name: r.playerId === null ? null : (entry?.player.displayName ?? null),
      summary:
        entry === undefined
          ? null
          : {
              games: entry.player.games,
              outs: entry.player.line.outs,
              era: entry.era,
              whip: entry.whip,
              fip: entry.fip,
              so: entry.player.line.so,
              /** ⚠**분모가 0이면 값을 내지 않는다**(M2·M11) — 「0.0」과 「아직 없음」은 다르다 */
              srp: ((): { value: number; denominator: number } | null => {
                const v = r.playerId === null ? undefined : srpByPlayer.get(r.playerId);
                return v === undefined || v.bf === 0 ? null : { value: v.srp, denominator: v.bf };
              })(),
            },
      // 상대 팀 타자만 남긴다 — 다른 팀 상대 기록은 오늘의 경기와 무관하다
      opponents: all.filter((m) => m.opponentTeam === opponentCode),
      /**
       * ⚠**같은 필터를 통산에도 그대로 건다.** 그래서 「지금 그 팀에 있는 선수」만 남는다 —
       * 유저가 요청한 「현재 활동 중인 선수로 한정」이 이 한 줄로 성립한다(2026-08-18).
       */
      opponentsCareer: (r.playerId === null ? [] : (careerByPitcher.get(r.playerId) ?? []))
        .filter((m) => m.opponentTeam === opponentCode),
    };
  };

  for (const r of rows) {
    const key = [r.teamCode, r.opponentCode].sort().join("|");
    if (seen.has(key)) continue;
    const other = byTeam.get(r.opponentCode);
    if (other === undefined) continue;
    seen.add(key);
    games.push({
      venue: r.venue,
      startTime: r.startTime,
      league: r.league,
      sides: [toSide(r, r.opponentCode), toSide(other, r.teamCode)],
    });
  }

  games.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.league.localeCompare(b.league));
  return { heldFrom, gameDate: rows[0]!.gameDate, defaultDate, prev, next, dayCount, builtOn, games };
}

/**
 * 경기 페이지 데이터.
 *
 * ⚠**선수 이름은 ID로 찾는다**(M10). 이름 문자열로 조인하면 동명이인이 섞인다 —
 * 실제로 2026-08-14 西武−ロッテ 전에 「小島」가 둘 있었다.
 * ⚠**이름을 모르면 그 자리를 비운다.** 숫자 ID를 화면에 내지 않는다.
 */
/**
 * @param competition 어느 대회의 경기 페이지를 만들 것인가.
 *   ⚠**포스트시즌도 만든다.** 경기 페이지는 그 경기 하나만 말하므로 대회를 섞을 위험이 없다 —
 *   섞이면 안 되는 것은 **집계**다(§2-1).
 */
function gamePages(
  db: Db,
  o: LoadOptions,
  reFull: ReadonlyMap<string, RunExpectancy>,
  nameOf: (playerId: string) => string | null,
  competition = o.competition ?? "regular",
): GamePageData[] {
  const details = gameDetails(
    db,
    o.season,
    reFull,
    leagueOf,
    competition,
    o.through ?? "9999-12-31",
  );

  const ref = (playerId: string | null): GamePlayerRef | null => {
    if (playerId === null) return null;
    const name = nameOf(playerId);
    return name === null ? null : { playerId, name };
  };
  const side = (code: string, runs: number, hits: number | null, errors: number | null): GameSide => ({
    teamCode: code,
    name: teamOf(code).name,
    shortName: shortNameOf(code),
    color: colorOf(code),
    runs,
    hits,
    errors,
  });
  const play = (p: GamePlay): GamePlayView => ({
    inning: p.inning,
    half: p.half,
    outsBefore: p.outsBefore,
    bases: p.bases,
    batter: ref(p.batterId),
    pitcher: ref(p.pitcherId),
    rawBox: p.rawBox,
    rbi: p.rbi,
    runsScored: p.runsScored,
    swing: p.swing,
    awayScore: p.awayScore,
    homeScore: p.homeScore,
  });

  return [...details.values()].map((g) => {
    // `2026/0814/s-db-17` → `https://npb.jp/scores/2026/0814/s-db-17/box.html`
    const [year, day, slug] = g.gameId.split("/");
    return {
      gameId: g.gameId,
      gameDate: g.gameDate,
      venue: g.venue,
      series: g.series,
      away: side(g.awayCode, g.awayRuns, g.awayHits, g.awayErrors),
      home: side(g.homeCode, g.homeRuns, g.homeHits, g.homeErrors),
      innings: g.innings,
      reconciles: g.reconciles,
      scoringPlays: g.scoringPlays.map(play),
      keyPlays: g.keyPlays.map(play),
      keyPlayLimit: KEY_PLAY_LIMIT,
      win: ref(g.winPitcher),
      lose: ref(g.losePitcher),
      save: ref(g.savePitcher),
      // ⚠**원본으로 가는 링크는 지우지 마라**(L3). 대체하는 것이 아니라 가리킨다
      sourceUrl: `https://npb.jp/scores/${year}/${day}/${slug}/box.html`,
    };
  });
}

/**
 * 「눈에 띈 기록」의 기준을 사람이 읽는 한 문장으로.
 *
 * ⚠**코드의 상수에서 만든다.** 문장을 손으로 적으면 임계값을 바꿨을 때 화면만 옛날 말을 한다 —
 * 순위의 자격 기준을 숨기는 것과 같은 종류의 잘못이다(M3의 정신).
 */
function starRuleText(): string {
  return (
    `打者は${STAR_HITS}安打以上・本塁打・${STAR_RBI}打点以上、` +
    `投手は${innings(STAR_OUTS)}回以上を自責${STAR_ER}以内、または${STAR_SO}奪三振以上`
  );
}

/**
 * 「試合」 화면 데이터 — 직전 경기일의 결과 + 다음 예고선발 요약.
 *
 * ⚠**예고선발의 짝짓기를 다시 구현하지 않는다**(M1). 予告先発 페이지가 이미 만든
 * `StartersPageData`에서 뽑아 줄인다 — 두 벌로 만들면 더블헤더에서 한쪽만 어긋난다.
 */
/**
 * 「対戦を選ぶ」의 빠른 선택 — **오늘 대전하는 두 팀의 선수만** 버튼으로 낸다.
 *
 * ⚠**라이브를 취득하는 것이 아니다.** 「누가 대전하는가」는 予告先発로 공표된 사실이고,
 * 「지금 누가 던지고 있는가」는 여전히 화면을 보는 사람이 고른다(§6 · 라이브 취득 금지).
 *
 * ⚠**목록을 자르지 않는다.** 대타·중간계투가 잘리면 「내가 찾는 사람이 없다」가 되고
 * 그 순간 이 기능은 없는 것과 같다. 정렬만 출장 순으로 해서 주전이 먼저 오게 한다.
 * ⚠**소속은 시즌 집계의 소속(=가장 최근에 뛴 팀)을 따른다.** 이적 선수가 옛 팀 목록에
 * 남아 있으면 오늘 나오지 않는 사람을 고르게 된다.
 */
function matchupPage(
  db: Db,
  o: LoadOptions,
  asOf: string | null,
  starters: StartersPageData,
  battingByPlayer: ReadonlyMap<string, BattingEntry>,
  pitchingByPlayer: ReadonlyMap<string, PitchingEntry>,
): MatchupPageData {
  /** ⚠**정렬 키는 표시 문자열에서 되읽지 않는다.** 「7.1回」를 파싱하면 7.1과 7.2가 같아진다 */
  interface Sortable {
    pick: MatchupPick;
    usage: number;
  }
  const byTeamBat = new Map<string, Sortable[]>();
  const byTeamPit = new Map<string, Sortable[]>();
  const push = (m: Map<string, Sortable[]>, code: string, s: Sortable): void => {
    const list = m.get(code);
    if (list === undefined) m.set(code, [s]);
    else list.push(s);
  };
  for (const e of battingByPlayer.values()) {
    if (e.player.line.pa === 0) continue;
    push(byTeamBat, e.player.teamCode, {
      usage: e.player.line.pa,
      // ⚠**표시 문자열을 여기서 만들지 않는다.** 입구를 하나로 두면 비율이 들어갈 자리가 없다(M2)
      pick: batterPick(e.player.playerId, e.player.displayName, e.player.line.pa),
    });
  }
  for (const e of pitchingByPlayer.values()) {
    if (e.player.line.outs === 0) continue;
    push(byTeamPit, e.player.teamCode, {
      usage: e.player.line.outs,
      pick: pitcherPick(e.player.playerId, e.player.displayName, e.player.line.outs),
    });
  }
  // 출장이 많은 순. 같으면 이름 순으로 고정한다 — 빌드마다 순서가 흔들리면 diff가 못 쓰게 된다
  const sorted = (list: readonly Sortable[]): MatchupPick[] =>
    [...list]
      .sort((a, b) => b.usage - a.usage || a.pick.name.localeCompare(b.pick.name, "ja"))
      .map((s) => s.pick);

  const games: MatchupGame[] = starters.games.map((g) => {
    const team = (s: ProbableSide): MatchupTeam => {
      // 予告先発는 맨 앞에 두고 표식을 붙인다 — 이 화면에서 가장 눌릴 확률이 높은 버튼이다
      const pitchers = sorted(byTeamPit.get(s.teamCode) ?? []).map((p) =>
        p.playerId === s.playerId ? { ...p, probable: true } : p,
      );
      // ⚠**올 시즌 등판이 없는 예고선발이 실재한다**(1군 승격·이적 직후).
      // 목록에서 빼면 **이 화면에서 가장 눌릴 사람이 없는** 상태가 되므로 넣되,
      // 「기록 0」이 아니라 「기록이 없다」고 쓴다(M11)
      if (s.playerId !== null && s.name !== null && !pitchers.some((p) => p.playerId === s.playerId)) {
        pitchers.unshift(unseenPitcherPick(s.playerId, s.name));
      }
      pitchers.sort((a, b) => Number(b.probable) - Number(a.probable));
      return {
        teamCode: s.teamCode,
        shortName: s.shortName,
        name: s.teamName,
        color: s.color,
        pitchers,
        batters: sorted(byTeamBat.get(s.teamCode) ?? []),
      };
    };
    return {
      key: gameKey(g),
      venue: g.venue,
      startTime: g.startTime,
      sides: [team(g.sides[0]), team(g.sides[1])],
    };
  });

  /**
   * **오늘과 내일. 늘 두 칸이다.**
   *
   * ⚠**자리를 데이터에 맡기지 않는다**(2026-08-17 유저 지적). 예전에는
   * 「예고가 가리키는 날 + 다음 경기일」이라 **탭의 뜻이 데이터에 따라 움직였다** —
   * 월요일에는 어제가 나오고, 어떤 날은 토글이 통째로 사라졌다.
   * 자리를 고정하고 **각 칸이 자기 상태를 말하게** 한다.
   */
  const nextDay = (iso: string): string => {
    /** ⚠순수 계산이다. 로컬 타임존에 기대지 않는다(§2-1) */
    const t = new Date(`${iso}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };

  const teamOfCode = (code: string): MatchupTeam => ({
    teamCode: code,
    shortName: shortNameOf(code),
    name: teamOf(code).name,
    color: colorOf(code),
    pitchers: sorted(byTeamPit.get(code) ?? []),
    batters: sorted(byTeamBat.get(code) ?? []),
  });

  const upcomingRows = db.raw
    .prepare(
      `SELECT game_date AS date, home_code AS home, away_code AS away, venue, start_time AS startTime
         FROM upcoming_game WHERE season = ? AND game_date IN (?, ?)
        ORDER BY game_date, start_time`,
    )
    .all(o.season, o.builtOn, nextDay(o.builtOn)) as unknown as {
      date: string; home: string; away: string; venue: string; startTime: string | null;
    }[];

  /**
   * 우리가 가진 일정이 **이 날 이후까지 이어지는가.**
   *
   * ⚠**「그 날 경기가 없다」고 말하려면 그 날 일정을 안다는 근거가 있어야 한다**(M12).
   * 그 날보다 **뒤의** 경기를 알고 있다면 그 달 일정을 받은 것이고, 그러면
   * 「이 날은 비었다」가 사실이다. 아무것도 모르면 「없다」가 아니라 **「모른다」**다.
   */
  const knowsBeyond = (date: string): boolean =>
    ((db.raw
      .prepare("SELECT COUNT(*) AS n FROM upcoming_game WHERE season = ? AND game_date > ?")
      .get(o.season, date)) as unknown as { n: number }).n > 0;

  const competition = o.competition ?? "regular";

  /**
   * 그 날 경기가 이미 치러졌는가.
   *
   * ⚠**`status` 를 봐야 한다**(2026-08-18 감사 P3). 예전에는 그 날짜에 행이 있기만 하면
   * 「終わっています」라고 말했는데, **전 경기가 우천 중지된 날**에는 그것이 거짓말이 된다 —
   * 그날은 「끝난」 것이 아니라 **한 경기도 안 열린** 날이다(M11: 0 과 결측과 취소는 다르다).
   * 실측(2026-08-18): 보유 5시즌 정규시즌에 **그 날 경기가 전부 중지된 날이 2일**
   * — 2024-10-07 · 2026-06-08(둘 다 그날 편성이 1경기뿐이었고 그 1경기가 중지됐다).
   */
  const alreadyPlayed = (date: string): boolean =>
    ((db.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition = ? AND game_date = ? AND status = 'played'",
      )
      .get(o.season, competition, date)) as unknown as { n: number }).n > 0;

  /**
   * ⚠**끝난 시즌에는 오늘·내일을 고르라고 내밀지 않는다**(2026-08-18 감사 P1).
   * 2022 시즌 화면이 2026년 날짜를 내밀고 「日程はまだ取り込んでいません」이라고 말했다 —
   * 같은 페이지의 머리띠는 「終了したシーズンです」라고 하는데.
   */
  const over = seasonIsOver(db, o.season);

  const dayOf = (date: string): MatchupDay => {
    if (over) return { date, state: "seasonOver", hasProbable: false, games: [] };
    // 예고가 이 날을 가리키면 그쪽을 쓴다 — 투수 표식이 붙어 있다
    if (starters.gameDate === date && games.length > 0) {
      return { date, state: "games", hasProbable: true, games };
    }
    const rows = upcomingRows.filter((r) => r.date === date);
    if (rows.length > 0) {
      return {
        date,
        state: "games",
        hasProbable: false,
        games: rows.map((g) => ({
          // ⚠키가 겹치면 탭이 서로를 연다 — 날짜를 넣어 가른다
          key: `u-${g.date}-${g.home}-${g.away}`,
          venue: g.venue,
          startTime: g.startTime,
          sides: [teamOfCode(g.home), teamOfCode(g.away)] as [MatchupTeam, MatchupTeam],
        })),
      };
    }
    if (alreadyPlayed(date)) return { date, state: "played", hasProbable: false, games: [] };
    return { date, state: knowsBeyond(date) ? "noGames" : "unknown", hasProbable: false, games: [] };
  };

  const days: [MatchupDay, MatchupDay] = [dayOf(o.builtOn), dayOf(nextDay(o.builtOn))];

  return {
    season: o.season,
    asOf,
    builtOn: o.builtOn,
    days,
  };
}

/**
 * 하루치 경기 카드.
 *
 * ⚠**「오늘」 화면과 과거 날짜 화면이 같은 함수를 쓴다**(M1). 두 벌이 되면 어느 날 한쪽만
 * 고쳐져서 「같은 경기인데 어제 페이지와 오늘 페이지의 내용이 다르다」가 된다.
 */
function dayGames(
  db: Db,
  o: LoadOptions,
  date: string,
  nameOf: (playerId: string) => string | null,
  /** 실제로 만들어진 경기 페이지의 ID. ⚠**없는 페이지로 링크하면 404다** */
  gamePageIds: ReadonlySet<string>,
): TodayGame[] {
  const competition = o.competition ?? "regular";
  const ref = (p: { playerId: string; teamCode: string } | null): PlayerRef | null => {
    if (p === null) return null;
    const name = nameOf(p.playerId);
    // ⚠이름을 모르면 ID를 내지 않는다 — 숫자만 있는 링크는 정보가 아니라 잡음이다
    return name === null ? null : { playerId: p.playerId, name, teamCode: p.teamCode };
  };
  const side = (s: DayGame["away"]): TodaySide => ({
    teamCode: s.teamCode,
    shortName: shortNameOf(s.teamCode),
    name: teamOf(s.teamCode).name,
    color: colorOf(s.teamCode),
    runs: s.runs,
    hits: s.hits,
    errors: s.errors,
  });

  return (
    dayResults(db, o.season, date)
      // 다른 대회(오픈전·교류전 표기 등)를 섞지 않는다(§2-1)
      .filter((g) => g.competition === competition)
      .map((g) => ({
        gameId: g.gameId,
        venue: g.venue,
        status: g.status,
        notPlayedReason: g.notPlayedReason,
        away: side(g.away),
        home: side(g.home),
        winner: g.winner,
        win: ref(g.winPitcher),
        lose: ref(g.losePitcher),
        save: ref(g.savePitcher),
        stars: g.stars.flatMap((s) => {
          const name = nameOf(s.playerId);
          if (name === null) return [];
          return [{ ...s, name }];
        }),
        hasPage: gamePageIds.has(g.gameId),
      }))
  );
}

/**
 * 날짜별 화면.
 *
 * ⚠**최신 경기일의 페이지는 만들지 않는다.** 그 날은 `today.html`이 이미 보여주고 있어서,
 * 같은 내용이 두 주소에 생기면 「어느 쪽이 진짜인가」가 생긴다.
 * 대신 링크가 그 날만 `today.html`을 가리킨다(`dayHref`).
 *
 * ⚠**여기의 `filter`는 안전장치가 아니라 헛일을 줄이는 것이다.** 실제로 파일이 나가는 것을 막는 것은
 * `site.ts`의 `pastDays`이고, 그쪽이 시즌 경로 목록과 **같은 규칙**을 본다 —
 * 두 목록이 어긋나면 시즌 전환이 404로 간다.
 */
function dayPages(
  db: Db,
  o: LoadOptions,
  days: readonly GameDay[],
  latestDate: string | null,
  nameOf: (playerId: string) => string | null,
  gamePageIds: ReadonlySet<string>,
): DayPageData[] {
  return days
    .filter((d) => d.date !== latestDate)
    .map((d, i, list) => ({
      date: d.date,
      builtOn: o.builtOn,
      games: dayGames(db, o, d.date, nameOf, gamePageIds),
      starRule: starRuleText(),
      starLimit: STAR_LIMIT,
      // ⚠앞뒤는 **달력의 하루 전후가 아니라 경기가 있었던 날**이다. 월요일은 대개 경기가 없다
      prev: i === 0 ? null : list[i - 1]!.date,
      next: i === list.length - 1 ? (latestDate ?? null) : list[i + 1]!.date,
      latestDate,
      dayCount: days.length,
    }));
}

/**
 * ポストシーズンの대회 목록. **정규시즌은 여기 없다** — 섞지 않기 위한 경계다(§2-1).
 * ⚠순서가 화면 순서다. 시간 순(CS → 일본시리즈)으로 두고, 올스타는 성격이 달라 맨 뒤에 둔다.
 */
const POSTSEASON: readonly Exclude<Competition, "regular">[] = [
  "climaxSeries",
  "nipponSeries",
  "allStar",
];

/**
 * 그중 **경기 상세 페이지를 만드는** 대회.
 *
 * ⚠**올스타는 뺀다.** 경기 페이지의 알맹이는 득점기대치(RE)로 잰 「경기를 움직인 타석」인데,
 * RE는 **그 리그의 득점 환경**이고 올스타에는 그 리그가 없다(양 리그 선발이 맞붙는다).
 * 게다가 팀 코드가 `cl`/`pl`이라 리그를 고를 수도 없다 — 억지로 하나를 고르면
 * 그 화면의 모든 수가 근거 없는 기준으로 매겨진다. **못 만드는 것이 아니라 만들면 안 되는 것이다.**
 */
const POSTSEASON_PAGES: readonly Exclude<Competition, "regular" | "allStar">[] = [
  "climaxSeries",
  "nipponSeries",
];

/**
 * ⚠**모르는 대회가 DB에 있으면 던진다**(M7).
 *
 * 이 커밋이 고치고 있는 결함이 정확히 그 모양이었다 — 데이터는 있었는데 어느 목록에도 없어서
 * **사이트 전체에서 조용히 사라졌다.** 대회가 하나 늘면(オープン戦·이스턴/웨스턴 등)
 * `regular` 필터에도 안 걸리고 `POSTSEASON`에도 없어서 같은 일이 반복된다.
 * 그래서 **빌드가 멈춘다.** 조용히 사라지는 것보다 낫다.
 */
function assertKnownCompetitions(db: Db, season: number): void {
  const known = new Set<string>(["regular", ...POSTSEASON]);
  const rows = db.raw
    .prepare("SELECT DISTINCT competition AS c FROM game WHERE season = ?")
    .all(season) as unknown as { c: string }[];
  const unknown = rows.map((r) => r.c).filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw new RangeError(
      `모르는 대회가 ${season}년 데이터에 있다: ${unknown.join(", ")}. ` +
        "어느 화면에도 안 나오므로 조용히 사라진다 — POSTSEASON 목록을 갱신하라",
    );
  }
}

const POSTSEASON_NAME: Readonly<Record<string, string>> = {
  climaxSeries: "クライマックスシリーズ",
  nipponSeries: "日本シリーズ",
  allStar: "オールスターゲーム",
};

/**
 * ⚠**규칙을 화면에 적는다**(M3의 정신). 무엇을 세고 무엇을 안 세는지 말하지 않으면
 * 「왜 이 선수가 없지?」에 답할 수 없다.
 */
/**
 * ⚠**올스타의 팀 코드는 실제 구단이 아니다** — `cl`/`pl`(리그 선발)이다.
 *
 * ⚠**앞서 여기 적혀 있던 설명은 틀렸다**(2026-08-16 이중 검토에서 지적).
 * 「`shortNameOf`·`colorOf`가 예외를 던진다」고 썼는데 **둘 다 던지지 않는다** —
 * 표시용 함수라 `code.toUpperCase()`와 중립색으로 조용히 떨어진다.
 * 실제 안전장치는 `aggregateSeason` 안의 `leagueOf()`이고, 그건 올스타를 집계하지 않는 것으로 피한다.
 *
 * ⚠**모르는 비구단 코드는 던진다.** 도메인의 `NON_TEAM_CODES`에 코드가 하나 늘고 여기 안 늘면
 * 「XX」라는 정체불명의 이름이 조용히 화면에 나간다 — 그게 M7이 막으라는 것이다.
 */
const SQUAD: Readonly<Record<string, string>> = { cl: "セ・リーグ", pl: "パ・リーグ" };
function squadName(code: string): string {
  if (NON_TEAM_CODES[code] === undefined) return shortNameOf(code);
  const name = SQUAD[code];
  if (name === undefined) {
    throw new RangeError(`구단이 아닌 코드 ${code}의 표기를 모른다 — SQUAD를 갱신하라`);
  }
  return name;
}
const squadColor = (code: string): TeamColor =>
  NON_TEAM_CODES[code] === undefined ? colorOf(code) : NEUTRAL_COLOR;

const POSTSEASON_DETAIL: Readonly<Record<string, string>> = {
  climaxSeries:
    "各リーグの上位3球団が日本シリーズ進出を争うトーナメントです。" +
    "試合はステージごとに分けて並べていますが、**成績はステージをまとめて集計しています** — " +
    "1ステージあたり最大3〜6試合しかなく、分けるとどの数字も読めない標本になるためです。",
  nipponSeries: "両リーグの優勝球団が対戦する日本一決定戦です。",
  allStar:
    "⚠**これはポストシーズンではありません** — シーズン中に行われる両リーグ選抜の親善試合です。" +
    "球団ではなく「セ・リーグ」「パ・リーグ」として出場するため、所属もその表記になっています。" +
    "成績としての意味は薄く、記録として残しているだけです — " +
    "レギュラーシーズンにもポストシーズンの成績にも加えていません。",
};

/**
 * ポストシーズン — **대회마다 독립 집계**.
 *
 * ⚠**절대 합치지 않는다.** 클라이맥스시리즈와 일본시리즈는 다른 대회이고,
 * 정규시즌과는 더더욱 다르다. 합치는 순간 그 수는 어느 규칙에도 속하지 않는다(§2-1).
 * ⚠**순위를 매기지 않는다.** 13경기·5경기짜리 표본이라 「1위」를 붙이면 5타수 3안타가 타율 1위가 된다.
 * 출장 순으로 늘어놓고, 그 사실을 화면이 말한다.
 */
/**
 * 만들어진 경기 페이지를 알게 된 **뒤에** 링크 가능 여부를 채운다.
 *
 * ⚠**집계와 링크를 한 함수에서 하지 않는다.** 집계는 선수 페이지가 이른 시점에 필요로 하고,
 * 링크는 경기 페이지 목록이 정해진 늦은 시점에야 알 수 있다 — 한 덩어리로 두면
 * 「선언 전에 쓴다」가 되어 순서가 코드를 지배하게 된다.
 */
function withGamePages(d: PostseasonPageData, gamePageIds: ReadonlySet<string>): PostseasonPageData {
  return {
    ...d,
    competitions: d.competitions.map((c) => ({
      ...c,
      games: c.games.map((g) => ({ ...g, hasPage: gamePageIds.has(g.rawGameId) })),
    })),
  };
}

function postseasonPage(db: Db, o: LoadOptions): PostseasonPageData {
  const through = o.through ?? "9999-12-31";
  // ⚠**모르는 대회를 조용히 흘리지 않는다**(M7). 이 화면이 고치고 있는 결함이 그 모양이었다
  assertKnownCompetitions(db, o.season);
  const competitions: PostCompetition[] = [];

  for (const id of POSTSEASON) {
    const raw = dayResultsRange(db, o.season, id, through);
    if (raw.length === 0) continue;

    /**
     * ⚠**「第N戦」을 우리가 세지 않는다.** 한때 대회 전체 배열의 인덱스를 썼는데,
     * 클라이맥스시리즈는 **セ/パ × ファースト/ファイナル = 4개의 독립 시리즈**라
     * 최대 6경기짜리 파이널에 **「第13戦」**이 붙었다(2026-08-16 실측).
     * 정답은 **처음부터 데이터에 있었다** — npb.jp 슬러그 끝에서 파싱한 `game.game_no`와
     * 스테이지 표기 `game.series`다. 우리가 세는 순간 존재하지 않는 숫자가 된다.
     */
    /**
     * 스테이지 라벨과 그 순서.
     *
     * ⚠**CS는 `series` 하나로 나뉘지 않는다.** npb.jp의 표기가 セ/パ를 구분하지 않아
     * 「CS ファーストステージ」 한 제목 아래에 두 리그의 독립 시리즈가 섞이고
     * 「第1戦」이 연속 두 번 나온다(2026-08-16 실측). 리그는 **팀 코드에서 나온다** —
     * CS는 두 팀이 같은 리그라 새 데이터가 필요 없다.
     * ⚠**日本シリーズ에는 하지 않는다** — 양 리그가 맞붙어 「어느 리그의 시리즈」가 성립하지 않는다.
     * ⚠**올스타에도 하지 않는다** — 팀 코드가 `cl`/`pl`이라 `leagueOf`가 던진다.
     */
    const splitsByLeague = id === "climaxSeries";
    const stageOrder = new Map<string, number>();
    for (const g of raw) {
      const key = g.series ?? "";
      if (!stageOrder.has(key)) stageOrder.set(key, stageOrder.size);
    }
    const leagueTag = (homeCode: string): string => squadName(leagueOf(homeCode) === "central" ? "cl" : "pl");
    const stageOf = (g: { series: string | null; homeCode: string }): string | null =>
      g.series === null ? null : splitsByLeague ? `${leagueTag(g.homeCode)} ${g.series}` : g.series;
    /** 스테이지 첫 등장 순 × 2 + (セ=0 / パ=1) — 세·파가 번갈지 않고 스테이지끼리 붙는다 */
    const stageRank = (g: { series: string | null; homeCode: string }): number =>
      (stageOrder.get(g.series ?? "") ?? 0) * 2 +
      (splitsByLeague && leagueOf(g.homeCode) === "pacific" ? 1 : 0);

    const games: PostGame[] = raw.map((g) => ({
      gameId: gameSlug(g.gameId),
      rawGameId: g.gameId,
      // 경기 페이지 목록은 아직 모른다 — `withGamePages`가 나중에 채운다
      hasPage: false,
      date: g.gameDate,
      venue: g.venue,
      series: g.series,
      stage: stageOf(g),
      gameNo: g.gameNo,
      away: { shortName: squadName(g.awayCode), color: squadColor(g.awayCode), runs: g.awayRuns },
      home: { shortName: squadName(g.homeCode), color: squadColor(g.homeCode), runs: g.homeRuns },
      // ⚠**무승부와 「득점을 못 읽음」은 다르다**(M11). 접으면 결측이 무승부로 보인다
      winner:
        g.awayRuns === null || g.homeRuns === null
          ? null
          : g.awayRuns === g.homeRuns
            ? "tie"
            : g.awayRuns > g.homeRuns
              ? "away"
              : "home",
    }));
    /**
     * ⚠**화면의 순서는 우리가 정한다.** SQL의 `ORDER BY game_date, game_id`에 기대면
     * 스테이지가 붙어 들어오는 것을 아무도 보장하지 않는다 — 겹치는 날 제목이 두 번 나온다.
     */
    const rankById = new Map(raw.map((g) => [g.gameId, stageRank(g)]));
    games.sort((a, b) =>
      (rankById.get(a.rawGameId) ?? 0) - (rankById.get(b.rawGameId) ?? 0) ||
      a.date.localeCompare(b.date) || a.gameNo - b.gameNo);

    /**
     * ⚠**올스타는 선수 성적을 집계하지 않는다.**
     * 집계는 선수를 **구단**에 붙이는데, 올스타의 소속은 `cl`/`pl`(리그 선발)이라 구단이 아니다.
     * 억지로 구단 마스터에 끼워 넣으면 「모르는 코드는 예외」라는 안전장치(M7)를 우리 손으로 무너뜨리게 되고,
     * 그 장치는 2025년 CS·일본시리즈 18경기가 정규시즌에 섞여 있던 것을 잡아낸 바로 그 장치다.
     * 경기와 점수는 싣고, **왜 선수표가 없는지는 화면이 말한다.**
     */
    if (id === "allStar") {
      competitions.push({
        id,
        name: POSTSEASON_NAME[id] ?? id,
        detail: POSTSEASON_DETAIL[id] ?? "",
        games,
        batters: [],
        pitchers: [],
      });
      continue;
    }

    // ⚠**그 대회만으로 집계한다.** aggregateSeason 이 competition 을 받으므로 경계가 여기서 지켜진다
    const agg = aggregateSeason(db, o.season, id, through);
    const batters: PostBatter[] = agg.batting
      .filter((b) => b.line.pa > 0)
      .map((b) => ({
        playerId: b.playerId,
        name: b.displayName,
        teamCode: b.teamCode,
        shortName: squadName(b.teamCode),
        color: squadColor(b.teamCode),
        games: b.games,
        pa: b.line.pa,
        ab: b.line.ab,
        h: b.line.h,
        hr: b.line.hr,
        rbi: b.rbi,
        bb: b.line.bb,
        so: b.line.so,
        // ⚠**여기서 식을 새로 쓰지 않는다**(M1). `battingAverage`가 그 식이고 `Rate`를 돌려주므로
        // 값과 분모가 떨어지지 않는다(M2의 구조적 강제) — 타수 0이면 value 가 null 이다(M11)
        avg: battingAverage(b.line),
      }))
      // 출장 순. 같으면 이름으로 고정한다 — 빌드마다 순서가 흔들리면 diff 가 못 쓰게 된다
      // 출장 순. 이름까지 같으면 **선수 ID**로 고정한다 — 동명이인이 실재한다(M10)
      .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name, "ja") || a.playerId.localeCompare(b.playerId));

    const pitchers: PostPitcher[] = agg.pitching
      .filter((p) => p.games > 0)
      .map((p) => ({
        playerId: p.playerId,
        name: p.displayName,
        teamCode: p.teamCode,
        shortName: squadName(p.teamCode),
        color: squadColor(p.teamCode),
        games: p.games,
        outs: p.line.outs,
        h: p.line.h,
        hr: p.line.hr,
        bb: p.line.bb,
        so: p.line.so,
        er: p.line.er,
        w: p.decisions.w,
        l: p.decisions.l,
        sv: p.decisions.sv,
        era: earnedRunAverage(p.line),
      }))
      .sort((a, b) => b.outs - a.outs || a.name.localeCompare(b.name, "ja") || a.playerId.localeCompare(b.playerId));

    competitions.push({
      id,
      name: POSTSEASON_NAME[id] ?? id,
      detail: POSTSEASON_DETAIL[id] ?? "",
      games,
      batters,
      pitchers,
    });
  }

  return { season: o.season, competitions };
}

/** 그 대회의 경기를 날짜 순으로. 점수까지만 — 상세는 경기 페이지가 낸다 */
function dayResultsRange(
  db: Db,
  season: number,
  competition: string,
  through: string,
): {
  gameId: string;
  gameDate: string;
  venue: string | null;
  series: string | null;
  gameNo: number;
  awayCode: string;
  homeCode: string;
  awayRuns: number | null;
  homeRuns: number | null;
}[] {
  const rows = db.raw
    .prepare(
      `SELECT game_id AS gameId, game_date AS gameDate, venue, series,
              game_no AS gameNo,
              away_code AS awayCode, home_code AS homeCode,
              away_runs AS awayRuns, home_runs AS homeRuns
       FROM game
       WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
       ORDER BY game_date, game_id`,
    )
    .all(season, competition, through) as unknown as {
    gameId: string;
    gameDate: string;
    venue: string | null;
    series: string | null;
    gameNo: number;
    awayCode: string;
    homeCode: string;
    awayRuns: number | null;
    homeRuns: number | null;
  }[];
  // ⚠node:sqlite 는 프로토타입 없는 객체를 준다 — 그대로 흘리면 전개·비교에서 조용히 어긋난다
  return rows.map((r) => ({
    gameId: r.gameId,
    gameDate: r.gameDate,
    venue: r.venue,
    series: r.series,
    gameNo: r.gameNo,
    awayCode: r.awayCode,
    homeCode: r.homeCode,
    awayRuns: r.awayRuns,
    homeRuns: r.homeRuns,
  }));
}

/**
 * 球団ページ — 순위표의 한 줄과 그 팀 선수들을 한 화면에 모은다.
 *
 * ⚠**새로 계산하지 않는다**(M1). 순위는 `standingsSections`가, 선수 성적은 리그 번들이 이미 만든 것이다.
 * 여기서 다시 세면 「순위표의 팀 타율」과 「팀 페이지의 팀 타율」이 언젠가 갈린다.
 * ⚠**정규시즌만이다**(§2-1). 포스트시즌은 별도 화면이고, 그 사실을 화면이 말한다.
 */
/**
 * 팀 대 팀 전적 — **정규시즌만**(§2-1).
 * ⚠한 경기가 두 줄이 된다(양 팀 관점). 각 줄이 「그 팀에서 본 전적」이다.
 */
function h2hOf(db: Db, o: LoadOptions): HeadToHead[] {
  return headToHead(db, o.season, o.competition ?? "regular", o.through ?? "9999-12-31");
}

/**
 * SRC 를 `Rate` 로. ⚠**없으면 `null`**(M11) — 타석 로그가 없는 선수를 「기여 0」으로 만들지 않는다.
 * ⚠분모는 **타석**이다. 값만 내면 「몇 타석에서 낸 것인가」가 사라진다(M2).
 */
function srcOf(m: ReadonlyMap<string, { src: number; pa: number }>, id: string): Rate {
  const s = m.get(id);
  return s === undefined ? { value: null, denominator: 0 } : { value: s.src, denominator: s.pa };
}

/** SRP 를 `Rate` 로. 분모는 **상대 타자 수**다 */
function srpOf(m: ReadonlyMap<string, { srp: number; bf: number }>, id: string): Rate {
  const s = m.get(id);
  return s === undefined ? { value: null, denominator: 0 } : { value: s.srp, denominator: s.bf };
}

/**
 * 리그별로 잰 SRC/SRP 를 **세 단위로 묶은 것.**
 *
 * ⚠**세 단위는 서로 대신할 수 없다.** 어느 화면이 어느 단위를 쓰는지가 곧 그 지표의 정의다.
 */
export interface SituationalFold<T> {
  /** 시즌 합계. **선수 페이지 · 비교 · 予告先発**이 쓴다 — 리그를 넘어도 한 줄이다 */
  byPlayer: Map<string, T>;
  /**
   * `선수ID|리그`. **순위가 쓴다.**
   *
   * ⚠**타이틀은 소속 리그에서 낸 성적으로만 겨룬다** — 순위표의 다른 지표가 전부
   * `battingByLeague`/`pitchingByLeague` 에서 나오는 것과 같은 규칙이다.
   */
  byLeague: Map<string, T>;
  /** `선수ID|구단코드`. 구단 페이지가 쓴다 — 「이 구단에서 낸 몫」만 싣는다 */
  byTeam: Map<string, T>;
}

/**
 * ⚠**리그를 다 돈 뒤에 접는다 — 이 함수가 존재하는 이유가 그것이다**(2026-08-20 P1).
 *
 * 예전에는 리그 루프 **안에서** 지도를 쌓으면서 **같은 루프 안에서 순위까지 만들었다.**
 * 그래서 먼저 도는 센트럴은 리그별 값을, 나중 도는 퍼시픽은 두 리그 합계를 받았다 —
 * **두 리그가 다른 정의를 쓴 것**이고, 번들 순서를 바꾸면 조용히 뒤집혔다.
 * 실측(고치기 전 `dist`): 尾形(61365136)의 센트럴 SRP 분모 214(=리그별)와
 * 山本(23125136)의 퍼시픽 SRC 분모 206(=시즌 합계)이 **같은 사이트에 공존**했다.
 *
 * ⚠**입력 순서에 결과가 기대지 않는다** — 리그마다 자기 키를 쓰고, 합은 교환법칙을 따른다.
 * ⚠**합치는 규칙은 `addSrc` 한 벌이다**(M1). 여기서 `+` 를 다시 쓰면 어느 날 한쪽만 고쳐진다.
 */
export function foldSrc(
  perLeague: readonly { league: League; entries: readonly SrcEntry[] }[],
): SituationalFold<SrcTotals> {
  const byPlayer = new Map<string, SrcTotals>();
  const byLeague = new Map<string, SrcTotals>();
  const byTeam = new Map<string, SrcTotals>();
  for (const { league, entries } of perLeague) {
    for (const s of entries) {
      byPlayer.set(s.playerId, addSrc(byPlayer.get(s.playerId), s));
      const lk = `${s.playerId}|${league}`;
      byLeague.set(lk, addSrc(byLeague.get(lk), s));
      const tk = `${s.playerId}|${s.teamCode}`;
      byTeam.set(tk, addSrc(byTeam.get(tk), s));
    }
  }
  return { byPlayer, byLeague, byTeam };
}

/** 투수 쪽. **타자와 같은 모양으로 접는다** — 갈래가 다르면 한쪽만 고쳐진다(`foldSrc` 참조) */
export function foldSrp(
  perLeague: readonly { league: League; entries: readonly SrpEntry[] }[],
): SituationalFold<SrpTotals> {
  const byPlayer = new Map<string, SrpTotals>();
  const byLeague = new Map<string, SrpTotals>();
  const byTeam = new Map<string, SrpTotals>();
  for (const { league, entries } of perLeague) {
    for (const s of entries) {
      byPlayer.set(s.playerId, addSrp(byPlayer.get(s.playerId), s));
      const lk = `${s.playerId}|${league}`;
      byLeague.set(lk, addSrp(byLeague.get(lk), s));
      const tk = `${s.playerId}|${s.teamCode}`;
      byTeam.set(tk, addSrp(byTeam.get(tk), s));
    }
  }
  return { byPlayer, byLeague, byTeam };
}

/**
 * 마디(節目) 값 — **화면에 그대로 적는 기준**(M3의 정신).
 *
 * ⚠**「기록에 도전 중」의 기준이 코드에만 있으면 「왜 이 선수가 없지?」에 답할 수 없다.**
 * 여기 적힌 수가 곧 화면의 규칙이다.
 * ⚠**통산이 아니라 시즌 기준이다.** 우리는 2023년부터의 기록만 가지고 있어서
 * 통산 마디(2000안타 등)는 애초에 말할 수 없다.
 */
const MILESTONES: Readonly<Record<string, readonly number[]>> = {
  本塁打: [10, 20, 30, 40, 50],
  打点: [50, 80, 100, 120],
  安打: [100, 150, 180, 200],
  盗塁: [10, 20, 30, 40, 50],
  奪三振: [100, 150, 200, 250],
  勝利: [10, 15, 20],
  セーブ: [20, 30, 40],
  ホールド: [20, 30, 40],
};

/** 다음 마디. 이미 최고 마디를 넘었으면 null */
function nextMilestone(label: string, count: number): { next: number; toNext: number } | null {
  const xs = MILESTONES[label];
  if (xs === undefined) return null;
  for (const x of xs) {
    if (count < x) return { next: x, toNext: x - count };
  }
  return null;
}

/**
 * 143경기 환산.
 *
 * ⚠**예측이 아니라 환산이다.** 「지금 비율이 끝까지 이어지면」이라는 계산이고,
 * 화면이 그 말을 그대로 쓴다.
 * ⚠**정수로 내림한다** — 홈런 「43.7본」은 존재하지 않는 수다.
 * ⚠**분모는 그 팀의 소화 경기**다. 선수 출장 수로 나누면 결장이 많은 선수의 환산이 폭주한다
 *   (10경기 5홈런 → 71본). 팀 경기로 나누면 「팀이 143경기 할 때 이 선수가 몇 개」가 된다.
 */
function paceOf(count: number, teamGames: number, season: number): number {
  if (teamGames <= 0) return 0;
  /**
   * ⚠**시즌마다 기준이 다르다**(2026-08-18). 2020년은 120경기였다 —
   * 143으로 환산하면 그 시즌 화면이 **존재하지 않는 기준**으로 말하게 된다.
   */
  return Math.floor((count / teamGames) * regularSeasonGames(season));
}

/**
 * 팀별 소화 경기(`status='played'`).
 *
 * ⚠**행 수로 세면 안 된다.** 우천 중지는 `notPlayed` 행으로 남고 재편성 경기가 또 한 행이라,
 * 행 수는 팀당 144~153이 된다(2023·2025 실측). 그대로 143에서 빼면 잔여가 음수가 된다.
 */
function playedByTeam(db: Db, season: number, competition: string, through: string): Map<string, number> {
  const rows = db.raw
    .prepare(
      `SELECT code, SUM(n) AS played FROM (
         SELECT away_code AS code, COUNT(*) AS n FROM game
          WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
          GROUP BY away_code
         UNION ALL
         SELECT home_code AS code, COUNT(*) AS n FROM game
          WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
          GROUP BY home_code
       ) GROUP BY code`,
    )
    .all(season, competition, through, season, competition, through) as unknown as {
      code: string;
      played: number;
    }[];
  return new Map(rows.map((r) => [r.code, r.played]));
}

/**
 * 팀별 득점·실점.
 *
 * ⚠**우리가 가진 것은 경기 최종 스코어뿐이다** — 이닝별 득점(스코어보드)은 재현하지 않는다(L2).
 * ⚠**득점을 못 읽은 경기는 빼고 센다**(M11). `runs IS NULL` 을 0으로 때우면
 *   그 경기가 「0점 경기」가 되어 실점이 과소, 득점이 과소로 동시에 틀어진다.
 * ⚠**분모를 같이 낸다** — 몇 경기분의 득실인지 모르면 팀 간 비교가 성립하지 않는다(M2).
 */
function runsByTeam(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, { rf: number; ra: number; games: number }> {
  const rows = db.raw
    .prepare(
      `SELECT code, SUM(rf) AS rf, SUM(ra) AS ra, SUM(n) AS games FROM (
         SELECT away_code AS code, SUM(away_runs) AS rf, SUM(home_runs) AS ra, COUNT(*) AS n
           FROM game
          WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
            AND away_runs IS NOT NULL AND home_runs IS NOT NULL
          GROUP BY away_code
         UNION ALL
         SELECT home_code AS code, SUM(home_runs) AS rf, SUM(away_runs) AS ra, COUNT(*) AS n
           FROM game
          WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
            AND away_runs IS NOT NULL AND home_runs IS NOT NULL
          GROUP BY home_code
       ) GROUP BY code`,
    )
    .all(season, competition, through, season, competition, through) as unknown as {
      code: string; rf: number; ra: number; games: number;
    }[];
  return new Map(rows.map((r) => [r.code, { rf: r.rf, ra: r.ra, games: r.games }]));
}

/**
 * 팀의 연승·연패 — **직전 경기부터 이어진 것만**.
 *
 * ⚠**무승부에서 끊는다**(NPB 관례). 「3連勝」이라고 쓰는데 사이에 무승부가 있으면
 * 사람들이 아는 그 수가 아니게 된다.
 * ⚠**득점을 못 읽은 경기는 세지 않는다**(M11) — 0대0으로 때우면 무승부가 늘어난다.
 */
function streakByTeam(db: Db, season: number, competition: string, through: string): Map<string, number> {
  const rows = db.raw
    .prepare(
      `SELECT game_date, away_code, home_code, away_runs, home_runs FROM game
        WHERE season = ? AND competition = ? AND status = 'played'
          AND game_date <= ? AND away_runs IS NOT NULL AND home_runs IS NOT NULL
        ORDER BY game_date DESC, game_id DESC`,
    )
    .all(season, competition, through) as unknown as {
      game_date: string;
      away_code: string;
      home_code: string;
      away_runs: number;
      home_runs: number;
    }[];
  const out = new Map<string, number>();
  const done = new Set<string>();
  for (const g of rows) {
    for (const side of ["away", "home"] as const) {
      const code = side === "away" ? g.away_code : g.home_code;
      if (done.has(code)) continue;
      const mine = side === "away" ? g.away_runs : g.home_runs;
      const theirs = side === "away" ? g.home_runs : g.away_runs;
      const cur = out.get(code) ?? 0;
      if (mine === theirs) {
        // 무승부에서 끊는다 — 여기까지가 그 팀의 연속이다
        done.add(code);
        continue;
      }
      const won = mine > theirs;
      if (cur === 0) out.set(code, won ? 1 : -1);
      else if (won && cur > 0) out.set(code, cur + 1);
      else if (!won && cur < 0) out.set(code, cur - 1);
      else done.add(code);
    }
    if (done.size >= TEAMS.length) break;
  }
  return out;
}

/**
 * 날짜 문자열 산술 — **시계를 읽지 않는다**(M6).
 *
 * ⚠`new Date()` 는 금지지만, **주어진 날짜 문자열을 계산하는 것**은 시계를 읽는 것이 아니다.
 * 그래도 `Date` 를 아예 쓰지 않는 편이 안전하다 — 타임존이 끼어들 자리를 없앤다.
 * 아래는 그레고리력의 순수 산술이고 JST/UTC 어느 쪽에서도 같은 값을 낸다.
 */
export function toDayNumber(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  // Howard Hinnant 의 days-from-civil. 1970-01-01 = 0
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n: number): string {
  let z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const yy = m <= 2 ? y + 1 : y;
  const pad = (x: number): string => String(x).padStart(2, "0");
  return `${yy}-${pad(m)}-${pad(d)}`;
}

/** 0=일 … 6=토. 1970-01-01 은 목요일(4) */
export function dayOfWeek(iso: string): number {
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7;
}

export function addDays(iso: string, n: number): string {
  return fromDayNumber(toDayNumber(iso) + n);
}

/**
 * **끝난 주**(월~일)를 고른다.
 *
 * ⚠**진행 중인 주를 「지난주」라고 부르지 않는다.** 수요일까지밖에 없는 주를 내면
 * 3경기 나온 선수와 6경기 나온 선수가 같은 표에 선다 — 그 표는 아무것도 말하지 않는다.
 * ⚠**최신 경기일이 일요일이면 그 주가 끝난 주다.** 그 하루 때문에 한 주를 통째로
 *   묵히면 일요일 밤에 화면이 일주일 낡아 보인다.
 * ⚠NPB 는 월요일에 대개 경기가 없다(실측: 최근 경기일 24일 중 월요일 2일).
 *   그래서 「월~일」의 실체는 대개 화~일이고, 화면은 **그 주에 열린 경기일 수**를 함께 낸다.
 */
export function lastCompleteWeek(latest: string | null): { from: string; to: string } | null {
  if (latest === null) return null;
  const dow = dayOfWeek(latest);
  // 일요일(0)이면 그 날이 주말, 아니면 직전 일요일
  const to = dow === 0 ? latest : addDays(latest, -dow);
  return { from: addDays(to, -6), to };
}

/**
 * 통산 마디.
 *
 * ⚠**화면에 그대로 적는 기준이다**(M3의 정신). 2000안타·200승·250세이브는
 * 名球会 의 기준이라 이 도메인에서 특별한 수다 — 그래서 목록에 넣는다.
 * ⚠**우리가 정한 수라는 것을 숨기지 않는다.** NPB 가 「마디」를 공표하는 것이 아니다.
 */
const CAREER_MILESTONES: Readonly<Record<string, readonly number[]>> = {
  通算安打: [500, 1000, 1500, 2000],
  通算本塁打: [100, 200, 300, 400, 500],
  通算盗塁: [100, 200, 300, 400],
  通算勝利: [50, 100, 150, 200],
  通算奪三振: [500, 1000, 1500, 2000, 2500],
  通算セーブ: [50, 100, 200, 250, 300],
};

/**
 * 통산 마디에 다가선 선수. **남은 수가 적은 순** — 이 구획의 뜻이 곧 근접이다.
 *
 * ⚠**한 줄은 한 출처여야 한다.** 처음에는 「통산」을 NPB 공표치에서, 「今季」를 우리
 * 경기 데이터에서 가져왔다. 두 출처의 **기준일이 다르다** — 실측(2026-08-17 이중 검토):
 * ⚠**아래 서술은 낡았다.** 「선수 페이지가 8/14까지만 반영한다」고 읽혔던 것은 npb.jp 의 성질이 아니라
 * **우리가 그날 경기 전에 받기 때문**이다(자세히는 이 함수 아래 주석). 그래도 결론은 같다 — 우리 경기
 * 데이터는 **8/16까지**다. 그래서 화면에 `통산 90 · 今季 13` 이 나란히 서고
 * **90 − 13 = 77** 인데 그 선수의 작년까지 통산은 78이었다 — **한 줄 안에서 뺄셈이
 * 성립하지 않았다.** 마디까지 남은 수도 하루치만큼 틀렸다.
 * → 今季도 **같은 표(年度別)의 그 해 행**에서 가져온다. 그러면 줄 안이 자기 자신과 맞는다.
 *
 * ⚠**과거 시즌 화면에는 그 시즌까지의 통산을 낸다.** 연도 조건이 없으면 2023년 화면에도
 * **오늘의 통산**이 실린다 — 빌드는 시즌마다 돌기 때문이다(2026-08-17 지적).
 */
function milestonesOf(
  db: Db,
  season: number,
  chip: (code: string) => { teamCode: string; shortName: string; color: TeamColor },
  teamOf: (id: string) => string,
): HomeMilestone[] {
  /**
   * **통산도 今季도 같은 표(年度別成績)에서 가져온다.**
   *
   * ⚠**한 줄은 한 출처여야 한다.** 통산을 NPB, 今季를 우리 경기 데이터로 하면 기준일이 달라
   * **한 줄 안에서 뺄셈이 안 맞는다**(실측: 통산 90 · 今季 13 인데 작년까지가 78이었다).
   *
   * ⚠**한때 「今季만 우리 집계로」 이어 붙였다가 되돌렸다**(2026-08-17). 근거였던
   * 「NPB 가 우리보다 늦다」가 오진이었다 — 늦은 것은 **우리 아카이브**였다.
   * 실측: 아카이브의 2026 행을 「취득 JST 날짜 −1일까지의 우리 집계」와 맞추니
   * **698/698(100.0%) 완전 일치**했다. 늦은 것은 npb.jp 가 아니라 우리다.
   * 처방은 이어 붙이기가 아니라 **다시 받는 것**이다.
   *
   * ⚠**`year <= ?` 다.** 아카이브 시즌 화면(`/2024/` 등)이 오늘의 통산을 실으면 안 된다.
   */
  const rows = db.raw
    .prepare(
      `SELECT c.player_id AS playerId, p.display_name AS name,
              SUM(c.h) AS h, SUM(c.hr) AS hr, SUM(c.sb) AS sb,
              SUM(CASE WHEN c.year = ? THEN c.h ELSE 0 END) AS yh,
              SUM(CASE WHEN c.year = ? THEN c.hr ELSE 0 END) AS yhr,
              SUM(CASE WHEN c.year = ? THEN c.sb ELSE 0 END) AS ysb
         FROM career_batting c JOIN player p ON p.player_id = c.player_id
        WHERE c.year <= ?
        GROUP BY c.player_id`,
    )
    .all(season, season, season, season) as unknown as {
      playerId: string; name: string; h: number; hr: number; sb: number;
      yh: number; yhr: number; ysb: number;
    }[];
  const prows = db.raw
    .prepare(
      `SELECT c.player_id AS playerId, p.display_name AS name,
              SUM(c.w) AS w, SUM(c.so) AS so, SUM(c.sv) AS sv,
              SUM(CASE WHEN c.year = ? THEN c.w ELSE 0 END) AS yw,
              SUM(CASE WHEN c.year = ? THEN c.so ELSE 0 END) AS yso,
              SUM(CASE WHEN c.year = ? THEN c.sv ELSE 0 END) AS ysv
         FROM career_pitching c JOIN player p ON p.player_id = c.player_id
        WHERE c.year <= ?
        GROUP BY c.player_id`,
    )
    .all(season, season, season, season) as unknown as {
      playerId: string; name: string; w: number; so: number; sv: number;
      yw: number; yso: number; ysv: number;
    }[];

  const out: HomeMilestone[] = [];
  const add = (id: string, name: string, label: string, count: number, thisSeason: number): void => {
    const xs = CAREER_MILESTONES[label];
    if (xs === undefined || count <= 0) return;
    const next = xs.find((x) => count < x);
    if (next === undefined) return;
    const code = teamOf(id);
    if (code === "") return;
    out.push({ playerId: id, name, ...chip(code), label, count, next, toNext: next - count, thisSeason });
  };
  for (const r of rows) {
    add(r.playerId, r.name, "通算安打", r.h, r.yh);
    add(r.playerId, r.name, "通算本塁打", r.hr, r.yhr);
    add(r.playerId, r.name, "通算盗塁", r.sb, r.ysb);
  }
  for (const r of prows) {
    add(r.playerId, r.name, "通算勝利", r.w, r.yw);
    add(r.playerId, r.name, "通算奪三振", r.so, r.yso);
    add(r.playerId, r.name, "通算セーブ", r.sv, r.ysv);
  }

  /**
   * ⚠**근접이 이 구획의 정의다 — 그러니 근접으로만 고른다.**
   * 처음에 「남은 수 ≤ 올해 쌓은 수 × 2」를 걸었다가 **西川(350도루까지 6개)** 처럼
   * 올해가 더딘 선수가 잘려 나갔다.
   * ⚠**그 시즌에 한 번도 안 나온 항목은 뺀다** — 「다가서는 중」이 아니라 멈춰 있는 것이다.
   *
   * ⚠**여기서 자르지 않는다 — 자르는 것은 호출자의 몫이다**(2026-08-19 Task 6 수정).
   * 예전에는 여기서 `slice(0, HOME_MILESTONE_ROWS)` 했고, 구단 페이지가 **그 잘린 배열**을
   * 팀으로 거르기만 했다. 결과가 실측으로 이랬다 —
   * `b 1 · c 0 · d 0 · db 0 · e 2 · f 0 · g 0 · h 3 · l 2 · m 0 · s 1 · t 1`
   * → **12팀 중 6팀이 0건 · 합계 10건(= 홈 상위 10명 전부)**. 화면은 「ありません」이라고
   * 썼지만 실제로는 있었다 — **M11이 금지하는 「없음」과 「안 쟀음」의 혼동**이다.
   * → 전체를 정렬해서 돌려주고, **홈은 홈의 한도로 · 구단 페이지는 구단의 한도로** 자른다.
   *   계산은 여전히 한 벌이다(M1) — 자르는 위치만 옮겼다.
   */
  return out
    .filter((x) => x.thisSeason > 0)
    .sort((a, b) => a.toNext - b.toNext || b.count - a.count || a.playerId.localeCompare(b.playerId));
}


/**
 * 대시보드 데이터.
 *
 * ⚠**여기서 지표를 새로 계산하지 않는다**(M1) — 순위·연속기록·시즌 합계는 이미 만들어 둔 것을
 * 옮겨 담는다. 새로 세는 것은 **소화 경기·연승연패·환산값**뿐이고, 셋 다 이 파일 위쪽의
 * 도우미 한 벌이 한다.
 */
function homePage(
  db: Db,
  o: LoadOptions,
  standings: readonly StandingsSection[],
  agg: SeasonAggregate,
  streaksByPlayer: ReadonlyMap<string, PlayerStreaks>,
  /** 리그별 RE 행렬 — 주간 SRC/SRP 를 **시즌과 같은 커널**로 재기 위해 받는다(M1) */
  reByLeague: ReadonlyMap<string, RunExpectancy>,
  asOf: string | null,
  latestDate: string | null,
  latestGames: HomePageData["latest"],
  hasPostseason: boolean,
): HomePageResult {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";
  const played = playedByTeam(db, o.season, competition, through);
  const streak = streakByTeam(db, o.season, competition, through);
  const runs = runsByTeam(db, o.season, competition, through);

  const leagues: HomeLeague[] = standings.map((sec) => ({
    id: sec.id,
    name: sec.name,
    rows: sec.rows.map((r) => {
      const p = played.get(r.teamCode) ?? 0;
      // ⚠**시즌마다 기준이 다르다** — 143 고정이면 2020년(120경기)에서 잔여가 음수로 나온다
      const remaining = regularSeasonGames(o.season) - p;
      // ⚠**전승·전패 승률의 분모도 `勝+敗`다.** 무승부는 여기서도 빠진다.
      // ⚠**여기서 다시 쓰지 않는다**(M1) — 우승 경쟁 판정(`race.ts`)이 같은 함수를 쓴다.
      // 사본이던 시절 두 벌의 거동이 달랐다(이쪽만 잔여 음수 가드가 있었다).
      const best = bestPct(r.w, r.l, remaining);
      const worst = worstPct(r.w, r.l, remaining);
      return {
        teamCode: r.teamCode,
        shortName: r.shortName,
        color: r.color,
        rank: r.rank,
        tiedRank: r.tiedRank,
        w: r.w,
        l: r.l,
        t: r.t,
        pct: r.pct,
        gamesBehind: r.gamesBehind,
        // ⚠**득실은 「읽을 수 있었던 경기」의 합이다** — 분모를 같이 들고 다닌다(M2)
        rf: runs.get(r.teamCode)?.rf ?? 0,
        ra: runs.get(r.teamCode)?.ra ?? 0,
        runGames: runs.get(r.teamCode)?.games ?? 0,
        played: p,
        remaining,
        bestPct: best,
        worstPct: worst,
        streak: streak.get(r.teamCode) ?? 0,
        last10: r.last10,
      };
    }),
  }));

  /** 팀 소화 경기 — 환산의 분모다 */
  const teamGamesOf = (code: string): number => played.get(code) ?? 0;
  /**
   * 이름·구단은 **시즌 집계가 이미 들고 있다**(M10: ID로 찾아 이름을 붙인다).
   * ⚠**이름 문자열로 조인하지 않는다** — 동명이인이 실재한다(「小島」 2명).
   */
  const nameOf = (id: string): string =>
    agg.batting.find((b) => b.playerId === id)?.displayName ??
      agg.pitching.find((x) => x.playerId === id)?.displayName ?? id;
  const teamCodeOf = (id: string): string =>
    agg.batting.find((b) => b.playerId === id)?.teamCode ??
      agg.pitching.find((x) => x.playerId === id)?.teamCode ?? "";
  const chip = (code: string) => ({
    teamCode: code,
    shortName: shortNameOf(code),
    color: colorOf(code),
  });

  /**
   * 「이 페이스라면」에 실을 항목.
   *
   * ⚠**개수 지표만 넣는다.** 율은 환산이라는 말 자체가 성립하지 않는다 —
   * 타율을 143경기로 환산할 수는 없다.
   * ⚠**마디에 가까운 순으로 낸다.** 「1위부터」로 내면 이미 마디를 넘긴 사람이 위를 채워
   * 「도전 중」이라는 제목과 화면이 어긋난다.
   */
  const paceRows: HomePace[] = [];
  const addPace = (
    label: string,
    items: readonly { playerId: string; teamCode: string; count: number }[],
  ): void => {
    for (const it of items) {
      if (it.count <= 0) continue;
      const tg = teamGamesOf(it.teamCode);
      if (tg <= 0) continue;
      const m = nextMilestone(label, it.count);
      paceRows.push({
        playerId: it.playerId,
        name: nameOf(it.playerId),
        ...chip(it.teamCode),
        label,
        count: it.count,
        teamGames: tg,
        pace: paceOf(it.count, tg, o.season),
        toNext: m === null ? null : m.toNext,
        next: m === null ? null : m.next,
      });
    }
  };

  addPace(
    "本塁打",
    agg.batting.map((b) => ({ playerId: b.playerId, teamCode: b.teamCode, count: b.line.hr })),
  );
  addPace(
    "盗塁",
    agg.batting.map((b) => ({ playerId: b.playerId, teamCode: b.teamCode, count: b.sb })),
  );
  addPace(
    "打点",
    agg.batting.map((b) => ({ playerId: b.playerId, teamCode: b.teamCode, count: b.rbi })),
  );
  addPace(
    "奪三振",
    agg.pitching.map((x) => ({ playerId: x.playerId, teamCode: x.teamCode, count: x.line.so })),
  );

  /**
   * **부문마다 상위 몇 명씩.**
   *
   * ⚠**처음에는 「마디까지 5개 이내」로 걸렀다가 화면이 통째로 헛돌았다**(2026-08-17 유저 지적).
   * 실측: 도루 1위 浦田(31)·홈런 1위 栗原(32)·타점 1위 近藤(87)·탈삼진 1위 才木(150)이
   * **한 명도 화면에 없었고**, 대신 **홈런 9개인 선수 7명**이 자리를 채웠다 —
   * 9는 다음 마디(10)까지 1개라 통과하고, 31은 다음 마디(40)까지 9개라 잘렸기 때문이다.
   * **제목이 「今シーズンのペース」인데 페이스가 좋은 사람이 없는 화면**이었다.
   *
   * → 부문별로 **개수 상위**를 뽑는다. 마디까지 남은 수는 **거르는 조건이 아니라 덧붙이는 정보**다.
   * ⚠**부문을 섞어서 자르지 않는다.** 한 덩어리로 자르면 수가 큰 부문(打点·奪三振)이
   *   전부를 차지하고 도루가 사라진다 — 「盗塁 31」이 「打点 40」보다 작은 수이기 때문이다.
   */
  const paces: HomePace[] = [];
  for (const label of PACE_LABELS) {
    const mine = paceRows
      .filter((x) => x.label === label)
      .sort((a, b) => b.count - a.count || b.pace - a.pace || a.playerId.localeCompare(b.playerId))
      .slice(0, HOME_PACE_PER_LABEL);
    paces.push(...mine);
  }

  /**
   * 이어지고 있는 기록.
   *
   * ⚠**마지막 출장일을 반드시 함께 낸다.** 최신 경기일보다 오래됐으면 「継続中」이 아니다 —
   * 화면이 그 판단을 할 수 있도록 날짜를 그대로 넘긴다.
   * ⚠**최신 경기일에 출장한 선수만 싣는다.** 그렇지 않으면 5월에 끊긴 기록이
   * 「지금 이어지는 중」으로 8월 화면에 남는다.
   */
  const streaks: HomeStreak[] = [];
  for (const [playerId, st] of streaksByPlayer) {
    if (latestDate !== null && st.lastGameDate !== latestDate) continue;
    const code = teamCodeOf(playerId);
    if (code === "") continue;
    if (st.hitting.current >= HOME_STREAK_MIN) {
      streaks.push({
        playerId, name: nameOf(playerId), ...chip(code),
        kind: "hitting", games: st.hitting.current, lastGameDate: st.lastGameDate,
      });
    } else if (st.onBase.current >= HOME_STREAK_MIN) {
      streaks.push({
        playerId, name: nameOf(playerId), ...chip(code),
        kind: "onBase", games: st.onBase.current, lastGameDate: st.lastGameDate,
      });
    }
  }
  streaks.sort((a, b) => b.games - a.games || a.playerId.localeCompare(b.playerId));

  /**
   * 지난주(월~일)의 베스트.
   *
   * ⚠**끝난 주만 낸다.** 진행 중인 주를 내면 3경기 나온 선수와 6경기 나온 선수가
   * 같은 표에 선다.
   * ⚠**율이 아니라 런으로 세운다.** 한 주는 20~30타석이라 율로 줄 세우면
   * 「7타수 4안타」가 1위가 된다 — M2 가 막는 바로 그것이 주간 단위에서 되살아난다.
   * ⚠**시즌과 같은 RE 행렬을 쓴다**(M1). 주간만 따로 행렬을 만들면 한 주의 득점환경으로
   *   재게 되어 같은 타석이 시즌 화면과 다른 값을 갖는다.
   */
  const span = lastCompleteWeek(latestDate);
  let week: HomeWeek | null = null;
  if (span !== null) {
    const wk = aggregateSeason(db, o.season, competition, span.to, span.from);
    const gameDays = (db.raw
      .prepare(
        `SELECT COUNT(DISTINCT game_date) AS n FROM game
          WHERE season = ? AND competition = ? AND status = 'played'
            AND game_date BETWEEN ? AND ?`,
      )
      .get(o.season, competition, span.from, span.to) as unknown as { n: number } | undefined)?.n ?? 0;

    const wkSrc = new Map<string, { runs: number; faced: number }>();
    const wkSrp = new Map<string, { runs: number; faced: number }>();
    for (const [league, re] of reByLeague) {
      // ⚠**리그별로 그 리그 팀만 넣는다** — 섞으면 다른 리그의 득점환경으로 재게 된다
      const codes = TEAMS.filter((t) => String(t.league) === league).map((t) => t.code);
      for (const x of computeSrc(db, re, codes, competition, span.to, span.from)) {
        const cur = wkSrc.get(x.playerId) ?? { runs: 0, faced: 0 };
        wkSrc.set(x.playerId, { runs: cur.runs + x.src, faced: cur.faced + x.pa });
      }
      for (const x of computeSrp(db, re, codes, competition, span.to, span.from)) {
        const cur = wkSrp.get(x.playerId) ?? { runs: 0, faced: 0 };
        wkSrp.set(x.playerId, { runs: cur.runs + x.srp, faced: cur.faced + x.bf });
      }
    }

    const batLine = new Map(wk.batting.map((b) => [b.playerId, b]));
    const pitLine = new Map(wk.pitching.map((x) => [x.playerId, x]));

    const pick = (
      m: ReadonlyMap<string, { runs: number; faced: number }>,
      minFaced: number,
      line: (id: string) => string | null,
    ): HomeWeekPlayer[] =>
      [...m.entries()]
        .filter(([, v]) => v.faced >= minFaced)
        .map(([id, v]) => ({ id, v, text: line(id) }))
        .filter((x) => x.text !== null)
        .sort((a, b) => b.v.runs - a.v.runs || b.v.faced - a.v.faced || a.id.localeCompare(b.id))
        .slice(0, HOME_WEEK_ROWS)
        .map((x) => ({
          playerId: x.id,
          name: nameOf(x.id),
          ...chip(teamCodeOf(x.id)),
          runs: x.v.runs,
          faced: x.v.faced,
          line: x.text ?? "",
        }));

    const batters = pick(wkSrc, HOME_WEEK_MIN_PA, (id) => {
      const b = batLine.get(id);
      if (b === undefined || b.line.pa === 0) return null;
      // ⚠**분모를 문자열 안에 넣는다**(M2) — 값만 떼어 쓸 수 없게
      return `${b.line.pa}打席 ${b.line.h}安打 ${b.line.hr}本 ${b.rbi}打点`;
    });
    const pitchers = pick(wkSrp, HOME_WEEK_MIN_BF, (id) => {
      const x = pitLine.get(id);
      if (x === undefined || x.line.outs === 0) return null;
      const ip = `${Math.floor(x.line.outs / 3)}${x.line.outs % 3 === 0 ? "" : `.${x.line.outs % 3}`}`;
      return `${ip}回 ${x.line.so}奪三振 自責${x.line.er}`;
    });

    /**
     * 그 주의 구단 성적.
     * ⚠**득점을 못 읽은 경기는 세지 않는다**(M11) — 0대0으로 때우면 무승부가 늘어난다.
     * ⚠**주간 승률을 만들지 않는다** — 5~6경기의 「.833」은 시즌 승률과 같은 무게로 읽힌다.
     */
    const wkTeam = new Map<string, HomeWeekTeam>();
    const wkGames = db.raw
      .prepare(
        `SELECT away_code, home_code, away_runs, home_runs FROM game
          WHERE season = ? AND competition = ? AND status = 'played'
            AND game_date BETWEEN ? AND ?
            AND away_runs IS NOT NULL AND home_runs IS NOT NULL`,
      )
      .all(o.season, competition, span.from, span.to) as unknown as {
        away_code: string;
        home_code: string;
        away_runs: number;
        home_runs: number;
      }[];
    for (const g of wkGames) {
      for (const side of ["away", "home"] as const) {
        const code = side === "away" ? g.away_code : g.home_code;
        const mine = side === "away" ? g.away_runs : g.home_runs;
        const theirs = side === "away" ? g.home_runs : g.away_runs;
        const cur = wkTeam.get(code) ?? { ...chip(code), w: 0, l: 0, t: 0, rf: 0, ra: 0 };
        cur.rf += mine;
        cur.ra += theirs;
        if (mine > theirs) cur.w += 1;
        else if (mine < theirs) cur.l += 1;
        else cur.t += 1;
        wkTeam.set(code, cur);
      }
    }
    const teams = [...wkTeam.values()].sort(
      (a, b) => b.w - a.w || a.l - b.l || (b.rf - b.ra) - (a.rf - a.ra) || a.teamCode.localeCompare(b.teamCode),
    );

    // ⚠**경기가 없던 주는 내지 않는다** — 빈 표가 「기록이 없다」로 읽힌다(M12)
    if (gameDays > 0 && (batters.length > 0 || pitchers.length > 0)) {
      week = { from: span.from, to: span.to, gameDays, batters, pitchers, teams };
    }
  }

  /**
   * ⚠**구단은 이미 있는 teamCodeOf 를 쓴다**(M1). 따로 만든 질의가 ORDER BY 없이
   * LIMIT 1 이라 **이적 선수 282명 중 9명에게 옛 구단**이 붙었다(2026-08-17 실측).
   * ⚠**여기 있는 것이 「자르기 전 전부」다** — 구단 페이지가 이걸 받아 팀별로 다시 자른다.
   */
  const milestones = milestonesOf(db, o.season, chip, teamCodeOf);

  return {
    page: {
      season: o.season,
      asOf,
      latestDate,
      latest: latestGames,
      leagues,
      week,
      milestones: milestones.slice(0, HOME_MILESTONE_ROWS),
      paces,
      streaks: streaks.slice(0, HOME_STREAK_ROWS),
      hasPostseason,
      // ⚠**구단 페이지와 같은 판정을 쓴다**(M1) — `calendarOf` 가 쓰는 것과 같은 함수다.
      // 「続いている記録」가 끝난 시즌에서 현재형으로 거짓말하는 것을 막는다(2026-08-20).
      seasonOver: seasonIsOver(db, o.season),
    },
    allStreaks: streaks,
    allMilestones: milestones,
  };
}

/**
 * 대시보드 데이터 **+ 자르기 전 전체 배열**.
 *
 * ⚠**왜 전체를 같이 들고 나오는가**(2026-08-19 Task 6 수정). 구단 페이지의 「続いている記録」·
 * 「記録に近づいている」는 **같은 계산을 재사용해야 하는데**(M1), 홈이 상위 N으로 자른 뒤의
 * 배열을 팀으로 거르면 **리그 상위 N에 못 든 구단이 통째로 0건**이 된다.
 * 실측(2026-08-19 배포물): `b 1 · c 0 · d 0 · db 0 · e 2 · f 0 · g 0 · h 3 · l 2 · m 0 · s 1 · t 1`
 * → **12팀 중 6팀이 0건 · 최대 3건 · 합계 10건**. 「ありません」이 거짓말이었다(M11).
 * → **계산은 한 벌 · 자르기는 화면마다.** 이 구조가 그것을 강제한다 —
 *   자르기 전 배열이 여기 말고는 없으므로, 구단 페이지가 다시 계산할 길이 없다.
 * ⚠**`page.streaks`/`page.milestones` 는 이미 잘린 것이다.** 팀별 자르기에 그걸 쓰면
 *   고치기 전과 똑같아진다 — 반드시 `allStreaks`/`allMilestones` 를 넘겨라.
 */
interface HomePageResult {
  page: HomePageData;
  /** 홈의 상위 N으로 **자르기 전** 전체(정렬은 끝난 상태) */
  allStreaks: readonly HomeStreak[];
  allMilestones: readonly HomeMilestone[];
}

/**
 * 대시보드의 자르는 기준. ⚠**화면에도 적는다** — 기준이 코드에만 있으면
 * 「왜 이 선수가 없지?」에 답할 수 없다(M3의 정신).
 */
/**
 * 페이스 구획에 내는 부문과 인원.
 *
 * ⚠**부문마다 따로 자른다** — 한 덩어리로 자르면 수가 큰 부문이 전부를 차지한다.
 * ⚠**화면에도 적는다**(M3의 정신) — 「각 부문 상위 3명」이라고 쓰지 않으면
 * 「왜 4위가 없지?」에 답할 수 없다.
 */
const PACE_LABELS = ["本塁打", "打点", "盗塁", "奪三振"] as const;
const HOME_PACE_PER_LABEL = 3;
/**
 * 주간 베스트의 최소 표본. ⚠**화면에도 적는다**(M3의 정신).
 * 대타 한 타석으로 SRC 가 튀어 1위가 되는 것을 막되, 너무 높이면 그 주에 쉬었다 나온
 * 선수가 통째로 빠진다 — 6경기 주의 절반쯤을 나온 사람이 남는 선이다.
 */
const HOME_WEEK_MIN_PA = 10;
const HOME_WEEK_MIN_BF = 12;
const HOME_WEEK_ROWS = 5;
const HOME_STREAK_MIN = 5;
const HOME_STREAK_ROWS = 10;
/** 통산 마디 구획의 행 수 */
const HOME_MILESTONE_ROWS = 8;

/**
 * 年度別成績을 화면 모양으로.
 *
 * ⚠**비율은 여기서 낸다**(M1) — DB 에 담지 않고 개수에서 다시 만든다.
 * 그래야 사이트 안에서 打率 을 내는 곳이 한 벌이다.
 * ⚠**분모를 문자열 안에 넣는다**(M2) — 값만 떼어 쓸 수 없게.
 */
/**
 * `careerOf` 의 준비된 문장 두 벌.
 *
 * ⚠**선수마다 `prepare()` 를 새로 부르고 있었다**(2026-08-18 감사 P3). 5시즌 빌드에서
 * `prepare()` 호출 10,817회 중 **7,020회(65%)가 이 두 문장**이었다 — 같은 SQL 을
 * 선수 수만큼 다시 컴파일한 것이다.
 * ⚠**`Db` 별로 캐시한다** — 빌드가 여러 DB 를 열 수 있고, 문장은 그것을 만든 연결에 묶인다.
 * `WeakMap` 이라 DB 가 닫히면 같이 사라진다.
 */
const CAREER_STMTS = new WeakMap<object, { bat: unknown; pit: unknown }>();

function careerStmts(db: Db): { bat: ReturnType<Db["raw"]["prepare"]>; pit: ReturnType<Db["raw"]["prepare"]> } {
  const hit = CAREER_STMTS.get(db.raw as unknown as object);
  if (hit !== undefined) return hit as never;
  const made = {
    bat: db.raw.prepare(
      `SELECT year, team, games, pa, ab, h, hr, rbi, sb, cs, bb, so, source,
              -- JST 로 낸다(§2-1). fetched_at 은 ISO UTC 라 그냥 자르면 하루 어긋난다
              SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10) AS fetchedAt
         FROM career_batting WHERE player_id = ? AND year <= ? ORDER BY year, seq`,
    ),
    pit: db.raw.prepare(
      `SELECT year, team, games, w, l, sv, hld, bf, outs, so, er, bb, source, SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10) AS fetchedAt
         FROM career_pitching WHERE player_id = ? AND year <= ? ORDER BY year, seq`,
    ),
  };
  CAREER_STMTS.set(db.raw as unknown as object, made);
  return made as never;
}

function careerOf(
  db: Db,
  playerId: string,
  /**
   * **이 화면이 서 있는 시즌.** 그 해까지만 싣는다.
   *
   * ⚠**뒤 연도를 실으면 안 된다.** 배포는 `2026,2025,2024,2023` **네 시즌을 같은 코드로** 돌린다 —
   * 조건이 없으면 2023년 화면이 2026년 행까지 싣는다(예전에는 연도 조건이 아예 없었다).
   *
   * ⚠**한때 「올해만 우리 집계로 갈아끼우는」 코드가 여기 있었다. 되돌렸다**(2026-08-17).
   * 근거로 삼았던 「NPB 선수 페이지가 우리보다 며칠 늦다」가 **틀린 진단**이었다 —
   * 늦은 것은 npb.jp 가 아니라 **우리 아카이브**였다(선수 페이지를 한 번 받고 다시 안 받았다).
   * ⚠**처음 낸 수치(76.3%)는 틀렸다** — 비교 기준일을 하루 잘못 잡았다. 다시 재면 이렇다.
   * 실측(외부 요청 0회): 아카이브의 2026 행을 **「취득 JST 날짜 −1일」까지의 우리 집계**와 맞추니
   * **698/698(100.0%) 완전 일치**, 어긋남 0. 같은 날짜까지로 맞추면 79.9%, 이틀 전까지면 82.1%다.
   * ⚠**「npb.jp 가 당일치까지 싣는다」는 뜻이 아니다.** 우리가 **그날 경기가 시작되기 전**
   * (08~13시 JST)에 받기 때문에 전날까지가 들어오는 것이다. 이 인과를 잘못 잡으면
   * 재취득 조건도 하루씩 어긋난다.
   * → 처방은 이어 붙이기가 아니라 **다시 받는 것**이다(`scripts/update.ts` 의 선수 프로필 갱신).
   */
  season: number,
): CareerData | null {
  const stmts = careerStmts(db);
  const bat = stmts.bat
    .all(playerId, season) as unknown as {
      year: number; team: string; games: number; pa: number; ab: number; h: number;
      hr: number; rbi: number; sb: number; cs: number; bb: number; so: number;
      source: string; fetchedAt: string | null;
    }[];
  const pit = stmts.pit
    .all(playerId, season) as unknown as {
      year: number; team: string; games: number; w: number; l: number; sv: number; hld: number;
      bf: number; outs: number; so: number; er: number; bb: number;
      source: string; fetchedAt: string | null;
    }[];
  /**
   * ⚠**여기서 올해 행을 우리 집계로 갈아끼우지 않는다**(2026-08-17 이중 검토에서 되돌렸다).
   * 갈아끼웠더니 한 라운드에 거짓말이 셋 나왔다:
   * · **`試合` 은 정의가 다르다** — 우리 `games` 는 「타석이 있던 경기」, NPB 는 「출장 경기」다.
   *   끝난 시즌 1,777쌍에서 **569쌍(32.0%)이 어긋났고 전부 NPB 가 컸다**(합계 8,009경기).
   *   대수비·대주자 전문 선수가 `65試合` → `4試合` 이 됐다.
   * · **盗塁刺가 사라졌다** — 「박스스코어에 없으니 우리에겐 없다」고 썼는데 **틀렸다.**
   *   주자 행에서 뽑고 있고(`runner_event`) 같은 페이지 위쪽이 이미 표시한다.
   * · **작년까지의 통산 행이 없는 선수**에게
   *   「それ以前は当サイト集計の公表値です」라는 말이 안 되는 문장이 나갔다.
   *   ⚠처음에 이것을 「올해 데뷔 113명」이라고 적었는데 **틀린 서술이었다** —
   *   그 113명은 **마지막 출장이 2023년인 이탈 선수**이고, 2026 출장자 중 통산 행이 없는 사람은 0명이다.
   * → 한 출처로 둔다. **신선도는 다시 받아서 지킨다**(이어 붙여서가 아니라).
   */
  if (bat.length === 0 && pit.length === 0) return null;

  /**
   * ⚠**여기서 산식을 다시 쓰지 않는다**(M1 · 2026-08-18 감사 P3에서 정정).
   * 예전에는 打率·防御率·이닝 표기를 **이 함수 안에 다시 구현**하고 있었다 —
   * 값은 `@bb-app/metrics` 와 일치했지만 **두 벌이었고**, 이 리포는 이미
   * 「파서가 3중 구현이었고 서로 값이 달랐다」는 사고를 겪었다(CLAUDE.md M1).
   * ⚠통산 표는 **연도별 부분 라인**(안타·타수 / 자책·아웃)만 갖고 있으므로
   * 완성된 `BattingLine`/`PitchingLine` 을 만들 수 없다 — 그래서 그 아래층인
   * `rate`(분자/분모)를 쓴다. `battingAverage` 도 `earnedRunAverage` 도 결국 이것이다.
   */
  const avg = (h: number, ab: number): string => avg3(rate(h, ab).value);
  const era = (er: number, outs: number): string => dec2(rate(er * 27, outs).value);
  /** ⚠이닝 표기는 `format.ts` 한 벌을 쓴다 — 여기에 또 쓰면 `6.2` 규칙이 두 곳이 된다 */
  const ip = (outs: number): string => innings(outs);

  const batting: CareerRow[] = bat.map((r) => ({
    year: r.year,
    team: r.team,
    games: r.games,
    faced: r.pa,
    line: `${avg(r.h, r.ab)}（${r.ab}打数）· ${r.h}安打 ${r.hr}本 ${r.rbi}打点 ` +
      `${r.sb}盗塁${r.cs}刺`,
    sort: { games: r.games, pa: r.pa, h: r.h, hr: r.hr, rbi: r.rbi, sb: r.sb },
  }));
  const pitching: CareerRow[] = pit.map((r) => ({
    year: r.year,
    team: r.team,
    games: r.games,
    faced: r.bf,
    line: `${era(r.er, r.outs)}（${ip(r.outs)}回）· ${r.w}勝${r.l}敗 ${r.sv}S ${r.hld}H ${r.so}奪三振`,
    sort: { games: r.games, outs: r.outs, w: r.w, so: r.so },
  }));

  /**
   * ⚠**합계는 파서 쪽 한 벌을 쓴다**(M1). 여기에 reduce 를 또 쓰고 있었고,
   * 시험이 붙은 쪽(`careerTotal`)은 **아무도 안 부르는 죽은 코드**였다 —
   * 즉 배포되는 계산에는 시험이 없고, 시험이 있는 계산은 배포되지 않았다
   * (2026-08-17 이중 검토 지적).
   */
  const sum = <T,>(rows: readonly T[], key: keyof T): number =>
    Number(careerTotal(rows, [key])[String(key)] ?? 0);

  /**
   * ⚠**합계는 우리가 더한다** — 남의 계산값을 빌려오지 않는다(CLAUDE.md §2-2).
   * ⚠**NPB 도 합계 행을 싣는다**(`<tfoot>` 의 `通　算`, 980/980). 우리는 그것을 **표시에 쓰지 않고
   * 대조에만 쓴다**(`parser/career.ts`) — 어긋나면 그 선수의 취입을 멈춘다.
   * (예전 주석은 「NPB 는 합계 행을 싣지 않는다」였는데 **틀린 판정이었다**.)
   */
  const bTotal = bat.length === 0
    ? null
    : `${sum(bat, "games")}試合 ${sum(bat, "pa")}打席 · ` +
      `${avg(sum(bat, "h"), sum(bat, "ab"))}（${sum(bat, "ab")}打数）· ` +
      `${sum(bat, "h")}安打 ${sum(bat, "hr")}本 ${sum(bat, "rbi")}打点 ` +
      `${sum(bat, "sb")}盗塁${sum(bat, "cs")}刺`;
  const pTotal = pit.length === 0
    ? null
    : `${sum(pit, "games")}登板 ${ip(sum(pit, "outs"))}回 · ` +
      `${era(sum(pit, "er"), sum(pit, "outs"))} · ` +
      `${sum(pit, "w")}勝${sum(pit, "l")}敗 ${sum(pit, "sv")}S ` +
      `${sum(pit, "hld")}H ${sum(pit, "so")}奪三振`;

  const years = [...bat.map((x) => x.year), ...pit.map((x) => x.year)];
  return {
    batting,
    pitching,
    // ⚠**행 수가 아니라 연도 수다** — 이적하면 한 해에 여러 줄이다
    // ⚠**행 수가 아니라 연도 수다**(이적하면 한 해에 여러 줄). 파서 쪽 한 벌을 쓴다(M1)
    battingSeasons: seasonsPlayed(bat),
    pitchingSeasons: seasonsPlayed(pit),
    battingTotal: bTotal,
    pitchingTotal: pTotal,
    from: years.length === 0 ? null : Math.min(...years),
    to: years.length === 0 ? null : Math.max(...years),
    source: bat[0]?.source ?? pit[0]?.source ?? "選手ページ",
    /**
     * **이 표가 언제 받아온 것인가**(M4). ⚠**화면에 반드시 낸다.**
     *
     * 이 값이 없어서 사고가 났다: 선수 페이지를 8/15 에 받고 다시 안 받았는데,
     * 화면에는 그 사실이 어디에도 없어서 **「NPB 가 늦다」고 오진**했다.
     * 날짜가 보이면 낡은 것이 낡은 채로 조용히 있지 못한다.
     */
    asOf: bat[0]?.fetchedAt ?? pit[0]?.fetchedAt ?? null,
  };
}

/**
 * 구단 캘린더 — **지난 경기 + 앞으로의 경기**.
 *
 * ⚠**두 출처를 합치지만 뜻을 섞지 않는다.** 지난 것은 `game`(우리가 수집한 확정),
 * 앞으로의 것은 `upcoming_game`(NPB 공표 예정)이다 — 예정은 바뀐다(M9의 정신).
 * ⚠**중지 경기(`notPlayed`)를 빼지 않는다.** 「그 날 경기가 있었는데 안 열렸다」는
 * 캘린더에서 말해야 하는 사실이다 — 빼면 빈 칸이 되어 「원래 없던 날」과 구별되지 않는다(M11).
 * ⚠**요일은 순수 계산으로 낸다**(M6) — 시계를 읽지 않는다.
 */
/**
 * **이 시즌이 이미 끝났는가.**
 *
 * ⚠**「끝났다」와 「아직 안 받았다」는 다른 말이다**(M12). 둘 다 화면에서는
 * 「앞으로의 경기가 0건」으로 보이므로, 구별하지 않으면 4년 전 시즌에 대고
 * 「まだ取り込んでいません」이라고 말하게 된다 — 실측 48/48장이 그랬다(2026-08-18 감사 P1).
 *
 * ⚠**배선을 늘리지 않고 데이터로 답한다**: **더 나중 시즌의 경기가 있으면** 그 시즌은 끝났다.
 * 정의상 참이고 인자를 하나도 더 받지 않는다.
 * ⚠**오프시즌의 현재 시즌은 「끝났다」로 잡히지 않는다** — 그때는 「다음 시즌 일정을 아직 안 받았다」가
 *   사실이므로 그 문구가 맞다.
 */
function seasonIsOver(db: Db, season: number): boolean {
  return ((db.raw
    .prepare("SELECT COUNT(*) AS n FROM game WHERE season > ?")
    .get(season)) as unknown as { n: number }).n > 0;
}

function calendarOf(
  db: Db,
  season: number,
  competition: string,
  teamCode: string,
  today: string,
  chip: (code: string) => { shortName: string; color: TeamColor },
  /**
   * **실제로 만들어지는 경기 페이지의 slug 집합.**
   *
   * ⚠**조건을 여기서 다시 쓰지 않는다**(M1). 경기 페이지는 「치러졌고 **득점을 읽은**」 경기에만
   * 만들어지는데(`GAME_SQL`), 그 조건을 캘린더에 베끼면 한쪽이 바뀔 때 조용히 갈린다 —
   * 실제로 처음에 베끼지 않고 「지난 경기면 링크」로 했다가 **284개 링크가 깨졌다**(빌드가 잡았다).
   * 그래서 **만들어진 목록 자체**를 받는다.
   */
  builtGameIds: ReadonlySet<string>,
  /**
   * **이 날짜까지만 센다**(재현 가능한 빌드의 기준선).
   *
   * ⚠**여기만 이 인자를 안 받고 있었다**(2026-08-18 감사 P3). 같은 화면의 형제 도우미
   * (`playedByTeam` · `runsByTeam` · `streakByTeam` · `monthRows`)는 전부 거는데
   * 캘린더만 안 걸어서, `--through` 로 자른 빌드에서 **표는 8월 10일까지인데
   * 캘린더에는 8월 16일 경기가 승패까지 그려진다** — 같은 페이지가 두 시점을 말한다.
   */
  through: string,
): CalendarData {
  const past = db.raw
    .prepare(
      `SELECT game_id AS gameId, game_date AS date, home_code AS home, away_code AS away,
              status, away_runs AS ar, home_runs AS hr
         FROM game
        WHERE season = ? AND competition = ? AND (home_code = ? OR away_code = ?)
          AND game_date <= ?
        ORDER BY game_date`,
    )
    .all(season, competition, teamCode, teamCode, through) as unknown as {
      gameId: string; date: string; home: string; away: string;
      status: string; ar: number | null; hr: number | null;
    }[];

  /**
   * **앞으로의 경기 — 단, 정규시즌 달력에만.**
   *
   * ⚠**`upcoming_game` 에는 대회 구분이 없다.** 있을 수가 없다 — 우리는 대회를
   * **박스스코어의 `【…】` 표기**로 판정하는데(`competitionFromLabel`), 아직 안 치른 경기에는
   * 박스스코어가 없다. 월간 일정 페이지는 표가 **하나뿐이고** CS·일본시리즈 행이
   * 정규시즌 행과 **HTML 상 완전히 같은 모양**이다(2025-10 실측: 표 1개 · 대회 표시 0개).
   *
   * ⚠**그래서 10월이 되면 조용히 섞인다**(§2-1). 2025-10 페이지를 파싱하면 31경기 중
   * **클라이맥스 13 · 일본시리즈 5**가 정규시즌 「予定」으로 들어온다(실측 2026-08-18).
   * 열리지도 않은 경기가 정규시즌 달력에 그려지는 것이다.
   *
   * ⚠**막는 근거는 「팀당 143경기」다.** 실측으로 고정돼 있다 —
   * **2022·2023·2024·2025 4시즌 × 12팀 = 48개 전부 정확히 143**이었다.
   * 그래서 `143 − 이미 치른 수` 를 넘는 예정은 정규시즌일 수 없다.
   * 팀별로 세는 것이 중요하다: 순위가 일찍 확정된 팀은 남들보다 먼저 143에 닿고,
   * CS는 **그 팀부터** 일정에 붙기 때문이다.
   *
   * 규칙 자체와 실측 근거는 `regularSeasonUpcoming` 에 있다 — 2025년으로 되돌려 돌리면
   * **포스트시즌 40슬롯 전부 잘리고 정규시즌은 0건 잘린다**.
   */
  const upcoming = competition !== "regular"
    ? []
    : regularSeasonUpcoming(db.raw
      .prepare(
        `SELECT game_date AS date, home_code AS home, away_code AS away, venue,
              start_time AS startTime,
              SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10) AS asOf
         FROM upcoming_game
        WHERE season = ? AND (home_code = ? OR away_code = ?) AND game_date >= ?
        ORDER BY game_date`,
      )
      .all(season, teamCode, teamCode, today) as unknown as {
        date: string; home: string; away: string; venue: string;
        startTime: string | null; asOf: string | null;
      }[],
      past.filter((g) => g.status === "played").length,
      regularSeasonGames(season),
    );

  const games: CalendarGame[] = [];
  for (const g of past) {
    const isHome = g.home === teamCode;
    const rf = isHome ? g.hr : g.ar;
    const ra = isHome ? g.ar : g.hr;
    /**
     * ⚠**득점을 못 읽었으면 승패도 모른다**(M11). 0대0으로 때우면 무승부가 늘어난다 —
     * 이 리포가 `streakByTeam` 에서 이미 세워 둔 규칙이다.
     */
    const result: CalendarGame["result"] = g.status !== "played"
      ? "notPlayed"
      : rf === null || ra === null
        ? null
        : rf > ra ? "win" : rf < ra ? "loss" : "draw";
    /**
     * ⚠**페이지가 없는 경기에는 링크를 걸지 않는다**(M12). 중지 경기와
     * 득점을 못 읽은 경기가 그렇다 — 걸면 404 가 되고 그건 고장으로 읽힌다.
     */
    games.push({
      date: g.date,
      slug: builtGameIds.has(g.gameId) ? gameSlug(g.gameId) : null,
      opponent: chip(isHome ? g.away : g.home).shortName,
      opponentCode: isHome ? g.away : g.home,
      home: isHome,
      result,
      runsFor: rf,
      runsAgainst: ra,
      startTime: null,
      venue: "",
      upcoming: false,
    });
  }
  for (const u of upcoming) {
    const isHome = u.home === teamCode;
    games.push({
      date: u.date,
      slug: null,
      opponent: chip(isHome ? u.away : u.home).shortName,
      opponentCode: isHome ? u.away : u.home,
      home: isHome,
      result: null,
      runsFor: null,
      runsAgainst: null,
      startTime: u.startTime,
      venue: u.venue,
      upcoming: true,
    });
  }

  /** 달별로 모은다. ⚠**경기가 하나도 없는 달은 만들지 않는다** — 빈 격자는 화면만 늘린다 */
  const byMonth = new Map<string, Map<number, CalendarGame[]>>();
  for (const g of games) {
    const key = g.date.slice(0, 7);
    const day = Number(g.date.slice(8, 10));
    const m = byMonth.get(key) ?? new Map<number, CalendarGame[]>();
    byMonth.set(key, m);
    m.set(day, [...(m.get(day) ?? []), g]);
  }

  const months: CalendarMonth[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, byDay]) => {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(5, 7));
      return {
        key,
        year,
        month,
        firstWeekday: dayOfWeekOfDate(`${key}-01`),
        days: daysInMonth(year, month),
        byDay,
      };
    });

  const c = chip(teamCode);
  return {
    teamCode,
    shortName: c.shortName,
    color: c.color,
    months,
    today,
    upcoming: upcoming.length,
    upcomingAsOf: upcoming[0]?.asOf ?? null,
    seasonOver: seasonIsOver(db, season),
  };
}

/**
 * 그 달의 날 수. ⚠**윤년을 손으로 쓰지 않는다** — 다음 달 0일이 이번 달 마지막 날이다.
 * ⚠`Date` 를 만들지만 **시계를 읽지 않는다**(M6은 「지금」을 읽는 것을 막는 것이다).
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY-MM-DD` 의 요일(0=일). ⚠순수 계산이다 — 로컬 타임존에 기대지 않는다(§2-1) */
function dayOfWeekOfDate(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function teamPages(
  db: Db,
  o: LoadOptions,
  standings: readonly StandingsSection[],
  agg: SeasonAggregate,
  leagueBatting: ReadonlyMap<string, BattingEntry>,
  leaguePitching: ReadonlyMap<string, PitchingEntry>,
  bundleByLeague: ReadonlyMap<League, LeagueBundle>,
  /**
   * SRC·SRP. ⚠**여기서 다시 계산하지 않는다**(M1) — 순위 화면이 쓰는 것과 **같은 지도**를
   * 그대로 받는다. 팀 페이지에서 따로 산출하면 같은 선수의 SRC가 두 화면에서 갈린다.
   */
  /**
   * **선수 × 구단** 키(`선수ID|구단코드`)의 SRC/SRP.
   * ⚠**시즌 합계가 아니다** — 이 표는 「이 구단에서 낸 몫」만 싣는다.
   */
  srcByTeam: ReadonlyMap<string, { src: number; pa: number }>,
  srpByTeam: ReadonlyMap<string, { srp: number; bf: number }>,
  /**
   * 併殺打도 **선수 × 구단** 키다(위와 같은 이유). ⚠**여기서 다시 세지 않는다**(M1) —
   * 선수 페이지가 쓰는 것과 같은 한 벌에서 나온다.
   */
  gidpByTeam: ReadonlyMap<string, number>,
  asOf: string | null,
  hasPostseason: boolean,
  latestDate: string | null,
  /** 실제로 만들어지는 경기 페이지의 gameId. 캘린더가 「누를 수 있는 날」을 이걸로 정한다 */
  builtGameIds: ReadonlySet<string>,
  /**
   * 予告先発. ⚠**여기서 다시 조회하지 않는다**(M1) — 試合 화면·予告先発 화면과 같은 한 벌을 받는다.
   * 따로 읽으면 「구단 페이지만 다른 날의 예고를 말한다」가 언젠가 난다.
   */
  starters: StartersPageData,
  /**
   * 연속 기록·기록 근접 — **홈 화면이 만든 것과 같은 한 벌**(M1). 여기서 다시 계산하지 않는다.
   *
   * ⚠**「자르기 전」 배열이어야 한다.** 홈이 상위 N으로 자른 뒤의 배열을 받으면
   * 구단 페이지가 리그 상위 N의 부분집합이 되어 **대부분의 구단이 0건**이 된다
   * (실측은 `HomePageResult` 주석 참고). 그래서 `homeData.page.streaks` 가 아니라
   * `homeData.allStreaks` 를 받는다.
   */
  allStreaks: readonly HomeStreak[],
  allMilestones: readonly HomeMilestone[],
): TeamPagesResult {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";
  const h2h = h2hOf(db, o);

  /**
   * **우승 경쟁 판정 — 시즌에 한 번만 부른다**(M1). 리그별이 아니라 시즌 단위다.
   *
   * ⚠**`games` 와 `playedPairs` 는 같은 모집단이어야 한다**(`seasonRace` 의 입력 계약).
   * 어긋나면 Σ 검사가 **전 시즌을 `unknown`** 으로 떨어뜨려 12구단 페이지의 판정이 통째로 사라진다.
   * 여기서는 둘 다 **같은 WHERE** 에서 나온다 — 순위표의 소화 경기 수는 `standings.ts` 의
   * `SIDES_SQL`, 대전표는 `head-to-head.ts` 의 SQL 인데
   * (`season` · `competition` · `status='played'` · `game_date <=` · 양 득점 `IS NOT NULL`)
   * 다섯 조건이 글자까지 같다(2026-08-19 대조).
   * ⚠**「같아 보이는 것」과 「같은 것」은 다르다** — 한쪽만 바뀌면 아래 경고가 빌드 로그에 뜬다.
   */
  const playedPairs = new Map<string, number>();
  for (const x of h2h) {
    /**
     * 한 경기는 `h2h` 에서 **두 줄**이다(양 팀 관점).
     *
     * ⚠**주석 정정(2026-08-20 최종 검토 ④ · 여기 「한 방향만 세지 않으면 대전 수가 두 배가 된다」고
     * 적혀 있었는데 거짓이었다).** `pairKey` 가 순서를 정규화하므로 두 줄이 **같은 키**로 모이고,
     * `Map.set` 은 누적이 아니라 **덮어쓰기**다. 그리고 두 방향의 `w + l + t` 는 정의상 같은 수다
     * (`headToHead` 가 경기마다 양쪽을 한 번씩 `bump` 한다).
     * 실측(2026-08-20 · `data/bb.sqlite` 전 9시즌 전수): 확정 경기 **7,518** → 방향별 줄 **1,206** →
     * 쌍 키 **603**. **두 방향의 `w+l+t` 가 다른 줄 0/1,206** · 가드를 지웠을 때
     * **값이 달라지는 쌍 0/603**. 즉 이 가드는 값을 지키지 않는다.
     *
     * → **그러면 왜 남기는가**: 순회의 절반(1,206 중 **603줄**)에서 `set` 을 아낀다.
     * 그리고 언젠가 이 줄이 `set(k, (get(k) ?? 0) + n)` 같은 **누적**으로 바뀌면
     * 그때는 없으면 안 되는 가드가 된다 — 지금은 그게 아니다.
     * ⚠**「이 가드가 정확성을 지킨다」고 읽지 마라.** 정확성을 지키는 것은 `pairKey` 의 정규화다.
     */
    if (x.teamCode >= x.opponentCode) continue;
    playedPairs.set(pairKey(x.teamCode, x.opponentCode), x.w + x.l + x.t);
  }
  const raceInputs: TeamRaceInput[] = standings.flatMap((s) =>
    s.rows.map((r) => ({ teamCode: r.teamCode, w: r.w, l: r.l, t: r.t, games: r.games })),
  );
  const race = seasonRace({ season: o.season, teams: raceInputs, leagueOf, playedPairs });
  /**
   * ⚠**M7 의 나머지 절반 — 알아챌 수 있게 한다.**
   *
   * `basis: "unknown"` 은 ⒜교류전 미완(정상)과 ⒝성적과 대전표가 어긋남(버그) 둘 다인데,
   * 반환값만 보면 두 가지가 거의 같은 모양이다. 가르는 것이 `disagreed` 다 —
   * **비어 있지 않으면 파이프라인 문제**이고, 그때 화면은 조용히 판정을 감춘다.
   * ⚠**화면에는 이유를 쓰지 않는다.** 방문자가 알아야 할 것이 아니라 운영자가 알아야 할 것이다.
   */
  if (race.disagreed.length > 0) {
    console.warn(
      `⚠ ${o.season}: 成績と対戦表が食い違う — 優勝争いの判定を出しません（${race.disagreed.length}球団: ` +
        `${race.disagreed.join(" ")}）· 規定対戦数=${race.series === null
          ? "導出できず"
          : `リーグ内${race.series.intra}/交流戦${race.series.inter}`}`,
    );
  }

  /** 월별 승패. ⚠**분모(경기 수)를 함께 낸다** — 「4월 12승」만으로는 몇 경기 중인지 모른다 */
  const monthRows = db.raw
    .prepare(
      `SELECT substr(g.game_date, 1, 7) AS month,
              CASE WHEN g.away_code = ? THEN 'away' ELSE 'home' END AS side,
              g.away_runs AS awayRuns, g.home_runs AS homeRuns
       FROM game g
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
         AND (g.away_code = ? OR g.home_code = ?)
       ORDER BY g.game_date`,
    );

  /** 최근 경기. 날짜 화면으로 보낸다 — 경기 페이지가 없는 경기가 있기 때문이다 */
  const recentRows = db.raw
    .prepare(
      `SELECT g.game_date AS date, g.away_code AS awayCode, g.home_code AS homeCode,
              g.away_runs AS awayRuns, g.home_runs AS homeRuns
       FROM game g
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
         AND (g.away_code = ? OR g.home_code = ?)
       ORDER BY g.game_date DESC, g.game_id DESC LIMIT 10`,
    );

  const out: TeamPageData[] = [];
  for (const section of standings) {
    for (const r of section.rows) {
      const code = r.teamCode;
      const league = leagueOf(code) as League;
      const bundle = bundleByLeague.get(league);
      // ⚠**리그 번들이 없으면 지표를 계산할 기준이 없다.** 그 리그에 선수가 하나도 없는 경우인데,
      // 억지로 다른 리그의 상수를 쓰면 근거 없는 수가 된다 — 표를 비우고 화면이 그렇게 말한다
      if (bundle === undefined) continue;

      /**
       * ⚠**「이 팀에서 낸 것」만 싣는다.** 합계를 쓰면 이적 선수의 옛 팀 몫이 여기 실리고,
       * 같은 화면 머리의 팀 打率 분모(그 팀만의 打数)와 어긋난다 —
       * 실측(2026): 山本가 ソフトバンク 표에 202타석으로 실리고 DeNA 표에는 없었다.
       * ⚠**지표는 여기서 새로 계산하지 않는다**(M1). 같은 입구(`battingEntryOf`)를 쓰고
       * 리그 상수만 그 팀의 리그 것을 준다.
       * ⚠**자격 판정은 소속 리그 몫으로 한다** — 팀 몫이 아니다. 타이틀은 리그에서 겨루고,
       * 같은 리그 안에서 이적한 선수의 규정타석은 두 팀분을 합쳐 센다.
       */
      /**
       * ⚠**오늘을 주입한다**(M6). `builtOn` 은 사이트를 만든 날이고, 캘린더의 「오늘」이 그것이다 —
       * 여기서 시계를 읽으면 빌드마다 다른 화면이 나오고 재현이 안 된다.
       */
      const calendar = calendarOf(db, o.season, competition, code, o.builtOn, (c) => ({
        shortName: shortNameOf(c),
        color: colorOf(c),
      }), builtGameIds, through);

      /**
       * **다음 경기 — 캘린더가 이미 들고 있는 것을 읽는다.**
       *
       * ⚠**새로 조회하지 않는다**(§2-2-1 「받고 있는데 안 읽던 것」 · M1). 여기서 따로 질의하면
       * 캘린더가 그리는 「次」와 이 띠가 말하는 「次」가 언젠가 갈린다.
       * ⚠**대회를 섞지 않는다**(§2-1) — 캘린더의 예정은 `regularSeasonUpcoming` 이 이미
       * 포스트시즌 슬롯을 잘라 낸 뒤의 것이라 CS·일본시리즈가 들어오지 않는다.
       * ⚠`upcoming` 은 `game_date >= today` 로 이미 걸러져 있다 — 지난 경기가 「다음」이 될 수 없다.
       */
      const upcomingGames = calendar.months
        .flatMap((m) => [...m.byDay.values()].flat())
        .filter((g) => g.upcoming)
        // 같은 날 두 경기(더블헤더)면 순서가 흔들리지 않게 상대 코드까지 본다
        .sort((a, b) => a.date.localeCompare(b.date) || a.opponentCode.localeCompare(b.opponentCode));
      const first = upcomingGames[0];
      const next: TeamNextGame | null = first === undefined
        ? null
        : {
          date: first.date,
          opponentCode: first.opponentCode,
          opponentName: first.opponent,
          home: first.home,
          // ⚠**빈 문자열은 「없음」이지 구장 이름이 아니다**(M11)
          venue: first.venue === "" ? null : first.venue,
          startTime: first.startTime,
        };
      const now: TeamNow = {
        // ⚠**없을 수 없지만 없을 때 거짓말하지 않는다**(M11). 순위표와 같은 입력에서 만들었으므로
        //   지금은 반드시 있지만, 입력이 갈리는 날에 「모른다」가 아니라 예외로 죽는 편이 낫지도
        //   않고 0 으로 메우는 것은 더 나쁘다 — 판정을 내지 않는 값을 준다
        race: race.teams.get(code) ?? unknownRace(code),
        next,
        probable: next === null ? null : probableOf(starters, code, next),
      };

      const batters: TeamBatter[] = agg.battingByTeam
        .filter((r) => r.teamCode === code && r.line.pa > 0)
        .map((r) => {
          const e = battingEntryOf(r, bundle.constants);
          const part = leagueBatting.get(`${r.playerId}|${league}`);
          return {
            playerId: r.playerId,
            name: r.displayName,
            games: r.games,
            pa: r.line.pa,
            ab: r.line.ab,
            h: r.line.h,
            hr: r.line.hr,
            rbi: r.rbi,
            sb: r.sb,
            // ⚠**키가 「선수|구단」이다** — 선수 ID 하나로 찾으면 이적 선수의 시즌 합계가 실린다
            //   (바로 아래 SRC 가 같은 함정을 밟았던 자리다).
            // ⚠**선수 페이지와 같은 판정 함수를 쓴다**(M1) — 두 화면이 같은 선수에게
            //   한쪽은 `0`, 한쪽은 `—` 를 내면 그 자체가 결함이다
            gidp: gidpOrUnknown(gidpByTeam.get(`${r.playerId}|${code}`), r.line.pa),
            avg: e.avg,
            obp: e.obp,
            slg: e.slg,
            ops: e.ops,
            woba: e.woba,
            wrcPlus: e.wrcPlus,
            wraa: e.wraa,
            // ⚠**타석 로그가 없는 선수는 `null` 이다**(M11) — 0으로 메우면 「기여 0」이 된다
            // ⚠**키가 「선수|구단」이다** — 선수 ID 하나로 찾으면 시즌 합계가 실린다
            src: srcOf(srcByTeam, `${r.playerId}|${code}`),
            // ⚠**순위를 매긴 함수와 같은 기준을 쓴다**(M1 · 2026-08-18 감사 P1).
            //   리그 최다 팀을 분모로 쓰던 탓에 순위표와 이 뱃지가 서로를 부정했다
            qualified: (part?.player.line.pa ?? 0) >= neededPa(bundle, code),
          };
        })
        // ⚠**마지막 갈래는 선수 ID다.** 동명이인이 실재하므로(「小島」 2명) 이름으로 끝내면
        // 순서가 SQL 그룹 산출 순서에 기대게 된다 — 이 프로젝트가 이미 한 번 밟은 함정이다
        .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name, "ja") || a.playerId.localeCompare(b.playerId));

      const pitchers: TeamPitcher[] = agg.pitchingByTeam
        .filter((r) => r.teamCode === code && r.games > 0)
        .map((r) => {
          const e = pitchingEntryOf(r, bundle.constants);
          const part = leaguePitching.get(`${r.playerId}|${league}`);
          return {
            playerId: r.playerId,
            name: r.displayName,
            role: r.role,
            games: r.games,
            outs: r.line.outs,
            w: r.decisions.w,
            l: r.decisions.l,
            sv: r.decisions.sv,
            hld: r.decisions.hld,
            so: r.line.so,
            era: e.era,
            whip: e.whip,
            fip: e.fip,
            k9: strikeoutsPer9(r.line),
            bb9: walksPer9(r.line),
            srp: srpOf(srpByTeam, `${r.playerId}|${code}`),
            qs: r.quality.qs,
            pitches: r.pitches,
            // ⚠**투구수를 못 읽은 경기가 있으면 `null` 이다**(M11). 0으로 메우면 효율이 최고가 된다
            pitchesPerOut:
              r.pitches === null || r.line.outs === 0
                ? { value: null, denominator: r.line.outs }
                : { value: r.pitches / r.line.outs, denominator: r.line.outs },
            qualified: (part?.player.line.outs ?? 0) >= neededOuts(bundle, code, r.role),
          };
        })
        .sort((a, b) => b.outs - a.outs || a.name.localeCompare(b.name, "ja") || a.playerId.localeCompare(b.playerId));

      const batQualifier = batterQualifierShort(bundle, code);
      const pitQualifier = pitcherQualifierShort(bundle, code);

      const byMonth = new Map<string, TeamMonth>();
      for (const m of monthRows.all(code, o.season, competition, through, code, code) as unknown as {
        month: string;
        side: string;
        awayRuns: number | null;
        homeRuns: number | null;
      }[]) {
        const cur = byMonth.get(m.month) ?? { month: m.month, w: 0, l: 0, t: 0 };
        // ⚠**득점을 못 읽은 경기는 세지 않는다**(M11) — 0대0으로 때우면 무승부가 늘어난다
        if (m.awayRuns !== null && m.homeRuns !== null) {
          const mine = m.side === "away" ? m.awayRuns : m.homeRuns;
          const theirs = m.side === "away" ? m.homeRuns : m.awayRuns;
          if (mine > theirs) cur.w += 1;
          else if (mine < theirs) cur.l += 1;
          else cur.t += 1;
        }
        byMonth.set(m.month, cur);
      }

      const recent = (
        recentRows.all(o.season, competition, through, code, code) as unknown as {
          date: string;
          awayCode: string;
          homeCode: string;
          awayRuns: number | null;
          homeRuns: number | null;
        }[]
      ).map((g) => {
        const isHome = g.homeCode === code;
        const mine = isHome ? g.homeRuns : g.awayRuns;
        const theirs = isHome ? g.awayRuns : g.homeRuns;
        return {
          date: g.date,
          opponent: shortNameOf(isHome ? g.awayCode : g.homeCode),
          home: isHome,
          result:
            mine === null || theirs === null ? "—" : mine > theirs ? "○" : mine < theirs ? "●" : "△",
        };
      });

      out.push({
        season: o.season,
        teamCode: code,
        name: r.name,
        shortName: r.shortName,
        color: r.color,
        leagueName: section.name,
        asOf,
        calendar,
        rank: r.rank,
        tiedRank: r.tiedRank,
        games: r.games,
        w: r.w,
        l: r.l,
        t: r.t,
        pct: r.pct,
        gamesBehind: r.gamesBehind,
        rf: r.rf,
        ra: r.ra,
        avg: r.avg,
        era: r.era,
        home: r.home,
        away: r.away,
        last10: r.last10,
        months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
        batters,
        pitchers,
        batQualifier,
        pitQualifier,
        recent,
        /**
         * 상대 구단별 전적. ⚠**자기 자신은 뺀다** — 「阪神 대 阪神」은 없는 경기다.
         * ⚠**정규시즌만**이다(§2-1). 순서는 이긴 수가 많은 쪽부터.
         */
        vs: h2h
          .filter((x) => x.teamCode === code && x.opponentCode !== code)
          .map((x) => ({
            code: x.opponentCode,
            shortName: shortNameOf(x.opponentCode),
            color: colorOf(x.opponentCode),
            w: x.w, l: x.l, t: x.t,
          }))
          .sort((a, b) => b.w - a.w || a.l - b.l || a.code.localeCompare(b.code)),
        latestDate,
        hasPostseason,
        now,
        /**
         * ⚠**여기서 다시 계산하지 않는다**(M1) — 홈 화면과 같은 배열을 `teamCode`로 거른다.
         * 따로 계산하면 홈의 「続いている記録」와 이 화면의 값이 갈릴 수 있다.
         *
         * ⚠**자르는 것은 「거른 뒤」다**(2026-08-19 수정). 반대로 하면 — 즉 홈이 이미
         * 상위 N으로 자른 배열을 거르면 — **12팀 중 6팀이 0건**이 된다(실측:
         * `b 1 · c 0 · d 0 · db 0 · e 2 · f 0 · g 0 · h 3 · l 2 · m 0 · s 1 · t 1` · 합계 10건).
         * ⚠**정렬은 홈과 같은 것을 그대로 쓴다**(M1) — 받은 배열이 이미 정렬돼 있고
         * `filter` 는 순서를 보존하므로, 여기서 다시 `sort` 하지 않는다.
         *   다시 정렬하는 순간 두 화면의 「상위」가 다른 뜻이 된다.
         */
        streaks: allStreaks.filter((s) => s.teamCode === code).slice(0, TEAM_STREAK_ROWS),
        milestones: allMilestones.filter((m) => m.teamCode === code).slice(0, TEAM_MILESTONE_ROWS),
      });
    }
  }

  /**
   * ⚠**M7 의 나머지 절반 — 여기서도 알아챌 수 있게 한다**(2026-08-19 검토 Important).
   *
   * 화면은 予告先発이 없으면 「発表待ち」라고 쓴다. 그런데 그 문장은 **두 가지**를 뜻한다:
   * ⒜아직 발표되지 않았다(정상) ⒝우리가 받지 못했다(수집 결함).
   * 실측(2026-08-19 검토): `dist/starters.html` 의 대상일이 **2026-08-16** 인데 빌드일은
   * **2026-08-19** 였고, 12구단 전부의 다음 경기가 8/19 라 **12/12 가 「発表待ち」**였다.
   * NPB 予告先発은 **전날** 발표되므로 그 예고는 현실에 존재했다 — 화면이 말한 이유가
   * 사실이 아니었고, 진짜 이유(**우리 데이터가 3일 낡았다**)는 아무 데도 안 나왔다.
   * ⚠**화면 문구는 바꾸지 않는다.** 방문자가 알아야 할 것이 아니라 운영자가 알아야 할 것이다 —
   * 위의 `disagreed` 경고와 같은 자리·같은 형식으로 빌드 로그에 낸다.
   *
   * ⚠**「발표 전(정상)」에는 울리지 않는다.** 기준일보다 **이전**일 때만이다 —
   * 기준일 당일의 예고를 갖고 있는데 다음 날 것이 아직 없는 것은 정상이고, 그때는
   * 화면의 「発表待ち」가 사실이다.
   * ⚠**가리킬 경기가 없으면 울리지 않는다.** 소급 시즌(2018~2025)은 `probable_pitcher` 에
   * 행이 아예 없어(실측 2026-08-19: **2026-08-16 하루치 12행**이 전부) 늘 `null` 인데,
   * 다음 경기도 없으므로 화면은 「発表待ち」라고 말하지 않는다 — 거짓말이 성립하지 않는다.
   * 9시즌 빌드에서 8시즌이 매번 울리면 **진짜 신호가 소음에 묻힌다**(daily.yml 이 이미 적어 둔 함정).
   *
   * ⚠**「가장 최근 예고일 < 빌드일」은 휴식일에 오탐한다**(2026-08-19 재검토).
   * DB 실측(2026-07-01~08-19 · 50일): **10일이 경기 없는 날**(월요일 4 · 7/28~30 올스타
   * 브레이크 3 · 8/17~19 3). 월요일 07:00 빌드라면 `gameDate = 일요일 < 월요일` 이고
   * 각 팀의 `next` 가 화요일(≠null)이라 무조건 발화하는데, **화요일 예고는 월요일 13시경에
   * 나온다** — 그 시점(월요일 07:00)의 「発表待ち」는 정상이고 사실이다.
   * ⚠**「예고가 있어야 할 창」으로 좁힌다** — 팀마다 `starters.gameDate < 그 팀의 next.date`
   * (그 경기의 예고를 아직 못 받았다) **이면서** `그 팀의 next.date <= o.builtOn`
   * (그 경기는 오늘이거나 이미 지나서 예고가 나왔어야 할 시점이다)일 때만 잡는다.
   * ⚠**`starters.gameDate === null`(예고를 한 번도 못 받음)은 이 창을 적용하지 않는다** —
   * 그건 날짜 어긋남이 아니라 **수집 자체가 없었다**는 뜻이라 무조건 경고한다
   * (`build-gates.test.ts` 의 「予告先発을 하나도 못 받았는데」가 이 분기를 고정한다).
   */
  const staleTeams = out.filter((t) => {
    if (t.now.next === null || t.now.probable !== null) return false;
    if (starters.gameDate === null) return true;
    return starters.gameDate < t.now.next.date && t.now.next.date <= o.builtOn;
  });
  if (staleTeams.length > 0) {
    console.warn(
      `⚠ ${o.season}: 予告先発が古い — 画面は「発表待ち」と書きますが、実際には` +
        `**取り込めていない**可能性があります（${staleTeams.length}/${out.length}球団 · ` +
        `予告の対象日=${starters.gameDate ?? "1日も持っていない"} · 生成日=${o.builtOn}）`,
    );
  }

  return { pages: out, disagreed: race.disagreed };
}

/**
 * `teamPages` 의 산출.
 *
 * ⚠**판정이 사라진 사실을 화면 밖으로 들고 나온다**(2026-08-19 검토 m2).
 * `disagreed` 가 비지 않으면 12구단의 우승 판정이 통째로 없어지는데 **화면 문구는 정직하다**
 * (「まだ判定できません」) — 그래서 눈으로는 발견되지 않고, `console.warn` 은 아무도 안 읽는다.
 * 배포를 세우는 판단은 `tools/build.ts` 가 한다(`emptySeasons`·`stale` 과 같은 형식).
 */
interface TeamPagesResult {
  pages: TeamPageData[];
  /** 성적과 대전표가 어긋난 구단 코드. **비어 있지 않으면 파이프라인 결함이다** */
  disagreed: readonly string[];
}

/**
 * 판정을 내지 않는 `TeamRace`.
 *
 * ⚠**0 으로 메우지 않는다**(M11). 잔여 `0` 은 「시즌이 끝났다」는 단정이고,
 * `eliminated: false` 는 「아직 가능성이 있다」로 읽힌다 — 둘 다 모르는 것을 아는 척하는 것이다.
 * 화면은 이 값을 받으면 「まだ判定できません」이라고 쓴다.
 */
function unknownRace(teamCode: string): TeamRace {
  return {
    teamCode,
    remaining: null,
    h2hLeft: new Map(),
    selfPossible: null,
    magic: null,
    eliminated: null,
  };
}

/**
 * 그 팀의 **다음 경기**에 대한 予告先発.
 *
 * ⚠**다음 경기의 것일 때만 붙인다.** 예고일이 다음 경기일과 다르면 그것은 다른 경기의 예고이고,
 * 그걸 「次の」라고 부르는 것이 이 리포가 이미 밟은 결함이다(`isNextProbable` 의 주석 —
 * 한 페이지가 같은 날을 예정이자 종료로 동시에 선언했다).
 * ⚠**상대 팀까지 맞춘다** — 더블헤더·재편성에서 같은 날 다른 경기를 집을 수 있다.
 * ⚠**못 찾으면 `null`**(= 発表待ち)이다. 「投手なし」가 아니다(M11).
 *
 * ⚠**export 는 시험을 위해서다**(`isNextProbable`·`foldThinVenues` 와 같은 이유).
 * 이 함수가 조용히 늘 `null` 을 내면 12구단 페이지가 **영원히 「発表待ち」**가 되는데,
 * 그건 화면상 정상으로 보이는 침묵 실패다 — 실데이터로는 오늘 확인할 수 없다
 * (2026-08-19 실측: DB 의 예고일이 `2026-08-16` 하나뿐이고 그 날은 이미 치러졌다).
 */
export function probableOf(
  starters: StartersPageData,
  code: string,
  next: TeamNextGame,
): { mine: string | null; theirs: string | null } | null {
  if (starters.gameDate !== next.date) return null;
  for (const g of starters.games) {
    const [a, b] = g.sides;
    if (a.teamCode === code && b.teamCode === next.opponentCode) return { mine: a.name, theirs: b.name };
    if (b.teamCode === code && a.teamCode === next.opponentCode) return { mine: b.name, theirs: a.name };
  }
  return null;
}

function todayPage(
  db: Db,
  o: LoadOptions,
  starters: StartersPageData,
  nameOf: (playerId: string) => string | null,
  gamePageIds: ReadonlySet<string>,
  days: readonly GameDay[],
): TodayPageData {
  /**
   * ⚠**이 화면의 대상일은 「최신 실시 경기일」이 아니라 「최신 경기일」이다.**
   *
   * 전 경기가 우천 중지된 날이 최신이면, 실시 기준으로 고르면 그 전날을 보여주고
   * **중지를 한 마디도 하지 않는다** — 「그날이 없었던 것」이 된다.
   * 신선도 띠(`asOf`)는 실시 기준 그대로다. 「데이터가 언제까지 들어왔나」와
   * 「어제 무슨 일이 있었나」는 다른 질문이다.
   * (2026-08-16 이중 검토에서 두 정의가 어긋나 있다는 지적을 받았다.)
   */
  const latestDate = latestGameDate(db, o.season, o.through ?? "9999-12-31", o.competition ?? "regular");
  const games: TodayGame[] =
    latestDate === null ? [] : dayGames(db, o, latestDate, nameOf, gamePageIds);
  const at = days.findIndex((d) => d.date === latestDate);

  const probables: TodayProbable[] = starters.games.map((g) => ({
    venue: g.venue,
    startTime: g.startTime,
    anchor: startersAnchor(gameKey(g)),
    sides: [0, 1].map((i) => {
      const s = g.sides[i]!;
      return {
        shortName: s.shortName,
        color: s.color,
        playerId: s.playerId,
        name: s.name,
        era: s.summary === null ? null : s.summary.era,
      };
    }) as [TodayProbable["sides"][0], TodayProbable["sides"][1]],
  }));

  const probableIsNext = isNextProbable(starters.gameDate, latestDate);

  return {
    gameDate: latestDate,
    builtOn: o.builtOn,
    games,
    probableDate: probableIsNext ? starters.gameDate : null,
    probables: probableIsNext ? probables : [],
    starRule: starRuleText(),
    starLimit: STAR_LIMIT,
    // 최신 경기일이 목록의 끝이므로 「다음 날」은 없다
    prev: at > 0 ? days[at - 1]!.date : null,
    dayCount: days.length,
  };
}

function standingsSections(db: Db, o: LoadOptions): StandingsSection[] {
  const rows = teamStandings(db, o.season, leagueOf, o.competition ?? "regular", o.through ?? "9999-12-31");
  if (rows.length === 0) return [];
  const toRow = (r: (typeof rows)[number]): StandingRow => {
    const team = teamOf(r.teamCode);
    return {
      teamCode: r.teamCode,
      name: team.name,
      shortName: shortNameOf(r.teamCode),
      color: colorOf(r.teamCode),
      rank: r.rank,
      tiedRank: r.tiedRank,
      games: r.games,
      w: r.w,
      l: r.l,
      t: r.t,
      pct: r.pct,
      gamesBehind: r.gamesBehind,
      rf: r.rf,
      ra: r.ra,
      // ⚠**지표를 여기서 새로 쓰지 않는다**(M1). 선수 화면과 같은 함수로 만든다
      avg: battingAverage(r.batting),
      era: earnedRunAverage(r.pitching),
      home: r.home,
      away: r.away,
      last10: r.last10,
    };
  };
  return (["central", "pacific"] as const)
    .map((league) => ({
      id: league,
      name: LEAGUE_NAME[league],
      rows: rows.filter((r) => r.league === league).map(toRow),
    }))
    .filter((s) => s.rows.length > 0);
}

/**
 * 球団一覧 화면.
 *
 * ⚠**여기서 아무것도 다시 계산하지 않는다**(M1). 순위·승패·승률·게임차·최근10 은
 * 순위표(`standingsSections`)가 만든 값이고, 다음 경기와 시즌 종료 여부는 구단 페이지
 * (`teamPages`)가 만든 값이다 — **둘을 구단 코드로 잇기만 한다**(M10: 이름이 아니라 코드다).
 * ⚠**리그 구분과 순위 순서도 순위표에서 온다.** 여기서 다시 정렬하면 두 화면의 순서가
 * 언젠가 갈리고, 그때 어느 쪽이 맞는지 말할 수 없다.
 */
function teamsPage(
  season: number,
  asOf: string | null,
  standings: readonly StandingsSection[],
  pages: readonly TeamPageData[],
): TeamsPageData {
  const byCode = new Map(pages.map((p) => [p.teamCode, p]));
  /**
   * ⚠**빠진 구단이 있으면 알아챌 수 있게 한다**(M7). `teamPages` 는 이 순위표를 그대로
   * 훑으므로 정상적으로는 0건이다 — 0건이 아니라는 것은 한쪽이 바뀌었다는 뜻이고,
   * 그때 화면은 **12구단 전부가 「予定はありません」**이 되어 수집 실패처럼 보인다.
   */
  const missing = standings.flatMap((s) => s.rows.filter((r) => !byCode.has(r.teamCode)).map((r) => r.teamCode));
  if (missing.length > 0) {
    console.warn(
      `⚠ ${season}: 球団一覧が球団ページと噛み合っていない — 次の試合を出せない球団 ${missing.length}件（${missing.join(" ")}）`,
    );
  }
  const toCard = (r: StandingRow): TeamsCard => {
    const p = byCode.get(r.teamCode);
    return {
      teamCode: r.teamCode,
      name: r.name,
      shortName: r.shortName,
      color: r.color,
      rank: r.rank,
      tiedRank: r.tiedRank,
      games: r.games,
      w: r.w,
      l: r.l,
      t: r.t,
      pct: r.pct,
      gamesBehind: r.gamesBehind,
      last10: r.last10,
      // ⚠**없으면 `null` 이다**(M11) — 0 이나 빈 문자열로 메우면 「예정 없음」과 구별되지 않는다
      next: p?.now.next ?? null,
      // ⚠**모르면 「끝났다」고 하지 않는다.** 끝났다고 단정하는 쪽이 되돌리기 어려운 거짓말이다
      seasonOver: p?.calendar.seasonOver ?? false,
    };
  };
  return {
    season,
    asOf,
    leagues: standings.map((s) => ({ id: s.id, name: s.name, teams: s.rows.map(toCard) })),
  };
}

// ─── 조립 ────────────────────────────────────────────────────────────────

/**
 * 여러 시즌을 한 번에 만들 때 **시즌마다 다시 계산할 이유가 없는 것**.
 *
 * ⚠**여기 있는 둘은 시즌 수의 제곱으로 늘어난다**(2026-08-20 실측 · 9시즌):
 * 火消し 의 이닝 도중 등판 조회가 시즌마다 **보유 첫 시즌부터 다시** 훑어 누계 **26.3초**,
 * 등판 시점 RE 행렬이 (시즌 × 리그) 조합마다 만들어져 **90회 · 14.8초**.
 * 한 번만 만들어 넘기면 각각 **2.5초 · 18회**다.
 * ⚠**CLAUDE.md 가 이미 백필의 벽을 두 번 적었다**(빌드 메모리 · Pages 파일 수).
 * 시즌 수의 제곱은 그 다음 벽이 되기 딱 좋은 모양이라 지금 없앤다.
 *
 * ⚠**모듈 전역에 두지 않는다**(CLAUDE.md §6) — 호출자가 만들어 넘긴다.
 * ⚠**안 넘겨도 된다.** 그때는 `loadSite` 가 스스로 만든다 — **느릴 뿐 답은 같다.**
 *   그 「답이 같다」를 `relief-seasons.test.ts` 가 실DB로 고정한다.
 */
export interface CareerContext {
  /**
   * ⚠**어떤 조건으로 만들었는가.** 이걸 안 들고 다니면 **다른 대회·다른 기준일로 만든 것을
   * 조용히 쓰게 된다** — 값이 그럴듯하게 틀리는 모양이라 분모로도 결측으로도 안 드러난다.
   * `loadSite` 가 어긋나면 **던진다**(M7).
   */
  competition: string;
  through: string;
  /** ⚠**보유 전 시즌 몫**이다. 시즌마다 `season <= o.season` 으로 걸러 쓴다 */
  reliefScan: ReliefScan;
  /** `${시즌}|${리그}` → RE 행렬 */
  runExpectancy: ReadonlyMap<string, RunExpectancy>;
}

export interface CareerContextOptions {
  competition?: string;
  through?: string;
  from: number;
  to: number;
}

/**
 * 시즌을 넘는 계산을 한 번에 만든다.
 *
 * ⚠**`buildSite` 가 아니라 호출자(`tools/build.ts`)가 부른다** — 시즌 목록을 아는 것이 거기다.
 * ⚠**`loadSite` 가 스스로 만드는 것과 같은 인자로 만든다** — 다르면 같은 화면 안에서 값이 갈린다.
 */
export function buildCareerContext(db: Db, o: CareerContextOptions): CareerContext {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";
  const re = new Map<string, RunExpectancy>();
  for (let season = o.from; season <= o.to; season += 1) {
    for (const league of ["central", "pacific"] as const) {
      const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
      re.set(`${season}|${league}`, buildRunExpectancy(db, season, league, codes, competition, through));
    }
  }
  return {
    competition,
    through,
    reliefScan: midInningEntries(db, competition, through, o.from, o.to),
    runExpectancy: re,
  };
}

export interface LoadOptions {
  season: number;
  competition?: string;
  through?: string;
  /** 사이트를 만든 날 `YYYY-MM-DD`(JST). **주입한다**(M6) */
  builtOn: string;
  /**
   * 시즌을 넘는 계산을 미리 만들어 둔 것. ⚠**없어도 된다** — 그때는 여기서 만든다(느릴 뿐 답은 같다).
   */
  career?: CareerContext;
  /**
   * 순위표 패널에 싣는 행 수의 상한.
   *
   * ⚠**화면은 이 값을 주지 않는다** — 기본값(`RANKING_PAGE_ROWS`)이 정본이다.
   * 이 구멍은 **계측·시험이 「고르기 전 전량」을 받기 위한 것**이고, 그러라고 있다:
   * 「어느 최소 표본에서도 상위 N 이 화면에 있는가」는 **고른 뒤의 표만 봐서는 답할 수 없다**
   * — 없는 선수가 왜 없는지 표 안에는 안 적혀 있기 때문이다.
   * `Number.POSITIVE_INFINITY` 를 주면 값이 있는 행이 전부 온다.
   */
  rankingRows?: number;
}

export interface SiteData {
  season: number;
  asOf: string | null;
  gameCount: number;
  players: PlayerPageData[];
  /** 사이트 루트(대시보드). ⚠**`index` 는 선수 일람이다** — 이름이 헷갈리는 자리다 */
  home: HomePageData;
  index: IndexPageData;
  ranking: RankingPageData;
  starters: StartersPageData;
  /**
   * **기본 날짜가 아닌 나머지 예고일.** 날짜별 페이지가 여기서 나온다.
   *
   * ⚠**앞뒤 링크를 만들었으면 그 대상도 만들어야 한다**(2026-08-18).
   * 링크만 넣고 페이지를 안 만들면 빌드의 링크 검사가 멈춘다 — 그건 다행이지만,
   * **CI 에서만 터진다**(로컬은 예고가 하루치뿐이라 줄 자체가 안 그려진다).
   * 로컬에서 못 보는 결함을 만들지 않는다.
   */
  starterDays: StartersPageData[];
  matchup: MatchupPageData;
  today: TodayPageData;
  /** 지난 경기일 화면. **최신 경기일은 빠져 있다** — 그 날은 `today.html`이 맡는다 */
  days: DayPageData[];
  dayIndex: DayIndexData;
  /**
   * 대회를 가리지 않은 가장 최근 경기일. **신선도 판정만 이것을 본다.**
   * ⚠정규시즌만 보면 포스트시즌 기간에 사이트 전체가 「취득 실패」라고 거짓말한다.
   */
  latestAnyGameDate: string | null;
  /**
   * **우리가 실제로 보유한 시즌 범위.**
   * ⚠화면이 이것을 하드코딩하면 백필할 때마다 사람이 고쳐야 하고, 그래서 안 고쳐진다 —
   * 실측 1,864장이 「2025年から」라는 낡은 거짓말을 싣고 있었다(2026-08-18 감사 P2).
   */
  heldSeasons: { from: number; to: number };
  /** ポストシーズン. ⚠**정규시즌 집계와 섞지 않는다**(§2-1) */
  postseason: PostseasonPageData;
  /** 球団ページ. 순위표에서 팀명을 누르면 여기로 온다 */
  teams: TeamPageData[];
  /**
   * 球団一覧. **구단으로 가는 길이 여기다** — 지금까지는 순위표를 거쳐야만 닿았다.
   * ⚠**`teams` 와 같은 한 벌에서 나온다**(M1) — 여기서 다시 조회하지 않는다.
   */
  teamsPage: TeamsPageData;
  /**
   * 성적(`w/l/t/games`)과 대전표가 어긋난 구단 코드. **비어 있는 것이 정상이다.**
   *
   * ⚠**비어 있지 않으면 배포하지 않는다**(2026-08-19 검토 m2 · `tools/build.ts`).
   * 그때 12구단의 우승 판정이 통째로 사라지는데 **화면 문구는 정직하다**
   * (「優勝争いはまだ判定できません」) — 눈으로는 발견되지 않는다. M7 의 「실패로」에
   * `console.warn` 만으로는 반쯤밖에 못 닿는다(CI 가 stderr 를 읽지 않으면 아무도 모른다).
   *
   * ⚠**`basis: "unknown"` 전체가 아니라 이것만이 결함이다.** 교류전이 안 끝난 4~5월에는
   * 규정 대전수를 유도할 수 없어 `unknown` 이 **정상 상태**다(실측: 2026 타임라인에서
   * 06-01 부터 `confirmed`). 둘을 가르는 것이 이 배열이다 — `race.ts` 의 조합표를 보라.
   */
  raceDisagreed: readonly string[];
  /** 경기 페이지. **빌드 대상 시즌만** — 2025년은 아카이브에 있지만 화면은 아직 한 시즌이다 */
  games: GamePageData[];
  search: SearchEntry[];
}

/**
 * 경기일별 취득 상황.
 *
 * ⚠**「치러졌는데 타석 로그가 없는 날」이 이 표의 존재 이유다.** 경기 수만 세면
 * 로그가 통째로 빠진 날을 정상으로 본다 — 그러면 스플릿과 SRC가 조용히 얇아진다.
 */
/**
 * 취득이 멈춘 뒤에도 표가 며칠까지 행을 만드는가.
 *
 * ⚠**무한히 늘리지 않는다.** 시즌이 끝난 뒤에 사이트를 만들면 `builtOn` 과 마지막 경기일이
 * 몇 달 벌어져 「試合なし」만 수백 줄이 된다. 14일로 자르는 근거: 1일 1회 수집에서
 * NPB 정규시즌의 정상 공백 중 가장 긴 것이 올스타 브레이크(약 4일)이고,
 * 2주가 비었다면 그건 이 표가 아니라 **실행 기록 표**가 말해야 하는 종류의 사고다.
 */
const COVERAGE_EXTEND_DAYS = 14;

function loadCoverage(
  db: Db,
  season: number,
  competition: string,
  limit: number,
  builtOn: string,
): CoverageDay[] {
  const rows = db.raw
    .prepare(
      `SELECT g.game_date AS date,
              COUNT(*) AS scheduled,
              SUM(CASE WHEN g.status = 'played' THEN 1 ELSE 0 END) AS played,
              SUM(CASE WHEN g.status = 'played' THEN 0 ELSE 1 END) AS notPlayed,
              SUM(CASE WHEN g.status = 'played'
                        AND EXISTS (SELECT 1 FROM pa_event e WHERE e.game_id = g.game_id)
                       THEN 1 ELSE 0 END) AS withPa
       FROM game g
       WHERE g.season = ? AND g.competition = ?
       GROUP BY g.game_date
       ORDER BY g.game_date DESC
       LIMIT ?`,
    )
    .all(season, competition, limit) as unknown as Omit<CoverageDay, "upcoming">[];

  if (rows.length === 0) return [];

  /**
   * **일정표에는 있는데 결과가 안 들어온 경기.** 이것이 「試合なし」와 「未取得」을 가른다.
   *
   * ⚠**이미 적재된 경기를 두 번 세지 않는다.** `upcoming_game` 은 월간 일정 페이지에서
   * 매번 다시 만드는 파생 표라 보통은 적재와 동시에 빠지지만, 일정 페이지 스냅숏이
   * 결과보다 오래됐으면 같은 경기가 양쪽에 남는다 — 그러면 「予定 7 · 実施 6」처럼
   * **없는 경기를 하나 지어낸다.** 카드(날짜·홈·원정)로 맞춰 빼고 센다.
   * ⚠`upcoming_game` 에는 대회 구분이 없다 — 월간 일정 페이지가 정규시즌 표이기 때문이다.
   */
  const upcomingRows = db.raw
    .prepare(
      `SELECT u.game_date AS date, COUNT(*) AS n
       FROM upcoming_game u
       WHERE u.season = ?
         AND NOT EXISTS (
           SELECT 1 FROM game g
           WHERE g.season = u.season AND g.competition = ?
             AND g.game_date = u.game_date
             AND g.home_code = u.home_code AND g.away_code = u.away_code
         )
       GROUP BY u.game_date`,
    )
    .all(season, competition) as unknown as { date: string; n: number }[];
  const upcomingBy = new Map(upcomingRows.map((r) => [r.date, r.n]));

  /**
   * ⚠**행이 없는 날짜를 표에서 지우면 구멍이 안 보인다.**
   *
   * 이 표의 존재 이유가 「빠진 날 찾기」인데, DB에 행이 없는 날은 `GROUP BY`가
   * 애초에 만들지 않는다. 그러면 8/11 다음이 8/9로 이어져 **8/10이 조용히 사라진다** —
   * 월요일 휴장인지 수집 누락인지 화면이 답하지 못하게 된다.
   * 달력의 모든 날을 채워 넣고, 일정이 0건이면 0건이라고 말한다.
   *
   * ⚠**시작점은 마지막 경기일이 아니라 생성일이다**(2026-08-20 감사 ①).
   * 마지막 경기일에서 시작하면 **취득이 멈춘 뒤의 날은 행이 아예 안 생긴다** —
   * 실측으로 최신 행 8/16 · 생성일 8/20 이라 8/17~8/19 가 표에서 사라져 있었다.
   * ⚠**`builtOn` 은 주입된 값이다**(M6). 여기서 시계를 읽지 마라.
   */
  const newest = rows[0]!.date;
  const oldest = rows[rows.length - 1]!.date;
  const newestT = Date.parse(`${newest}T00:00:00Z`);
  const endT = Math.min(
    Math.max(newestT, Date.parse(`${builtOn}T00:00:00Z`)),
    newestT + COVERAGE_EXTEND_DAYS * 86_400_000,
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: CoverageDay[] = [];
  for (let t = endT; t >= Date.parse(`${oldest}T00:00:00Z`); t -= 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const day = byDate.get(date) ?? { date, scheduled: 0, played: 0, notPlayed: 0, withPa: 0 };
    out.push({ ...day, upcoming: upcomingBy.get(date) ?? 0 });
  }
  return out;
}

/**
 * 배치 실행 기록을 읽는다.
 *
 * ⚠**파일이 없어도 던지지 않는다** — 아직 한 번도 안 돌았을 수 있고, 그건 결함이 아니다.
 * ⚠**깨진 줄은 건너뛰되 세지 않는다.** 여기서 조용히 0을 만들면 「돌았는데 0건」으로 보인다.
 */
export function readRunLog(path: string, limit: number): RunRecord[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: RunRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as RunRecord;
      if (typeof r.ranAt === "string" && typeof r.games === "number") out.push(r);
    } catch {
      // 깨진 줄. 기록 자체가 없는 것과 다르므로 버리기만 한다
    }
  }
  return out.reverse().slice(0, limit);
}

export interface LogOptions {
  /** 실행 기록 JSONL 경로. 없으면 「기록 없음」으로 그린다 */
  runLogPath?: string;
  /** 원시 아카이브 매니페스트 경로 */
  manifestPath?: string;
}

/** 収集ログ 페이지의 데이터. **DB와 운영 파일 양쪽에서 온다** */
export function loadLog(db: Db, o: LoadOptions & LogOptions): LogPageData {
  const competition = o.competition ?? "regular";
  // ⚠**실행 기록과 같은 방식으로 센다**(`scripts/freshness.ts`). 시즌·대회로 거르면
  // 같은 화면에 「試合 630」과 「632」가 나란히 서고, 그건 어느 쪽이 맞는지 알 수 없는 화면이 된다
  const totals = db.raw
    .prepare(
      `SELECT (SELECT COUNT(*) FROM game WHERE status='played') AS games,
              (SELECT COUNT(*) FROM pa_event) AS pa,
              (SELECT COUNT(*) FROM player) AS players,
              (SELECT COUNT(*) FROM quarantine) AS quarantine`,
    )
    .get() as {
    games: number;
    pa: number;
    players: number;
    quarantine: number;
  };

  let archive: LogPageData["archive"] = null;
  if (o.manifestPath !== undefined) {
    try {
      const m = JSON.parse(readFileSync(o.manifestPath, "utf8")) as {
        files: number;
        bytes: number;
        updatedAt: string;
      };
      if (typeof m.files === "number") archive = m;
    } catch {
      // 매니페스트가 없으면 「—」로 그린다. 0으로 그리지 않는다(M11)
    }
  }

  /**
   * 격리를 종류별로 묶고 원문 표본을 몇 개 붙인다.
   *
   * ⚠**원문이 없으면 판단할 수 없다.** 「unknownToken 3건」만으로는 무엇을 정해야 할지 모른다.
   */
  const quarantine: QuarantineKind[] = (
    db.raw
      .prepare("SELECT kind, COUNT(*) AS count FROM quarantine GROUP BY kind ORDER BY count DESC")
      .all() as unknown as { kind: string; count: number }[]
  ).map((k) => ({
    kind: k.kind,
    count: k.count,
    samples: db.raw
      .prepare("SELECT raw, detail, game_id AS gameId FROM quarantine WHERE kind = ? LIMIT ?")
      .all(k.kind, QUARANTINE_SAMPLES) as unknown as QuarantineKind["samples"],
  }));

  return {
    season: o.season,
    coverage: loadCoverage(db, o.season, competition, COVERAGE_DAYS, o.builtOn),
    quarantine,
    runs: o.runLogPath === undefined ? [] : readRunLog(o.runLogPath, RUN_LOG_ROWS),
    archive,
    totals,
    politeness: POLITENESS,
  };
}

/** 타구 로그가 없는 선수. ⚠**0이 아니라 「그릴 것이 없음」이다** — 화면이 그 줄을 뺀다 */
const EMPTY_BATTED: BattedBallData = {
  groundOuts: 0, airOuts: 0, left: 0, center: 0, right: 0,
  infield: 0, infieldHits: 0, swinging: 0, looking: 0,
};

/**
 * 도루 합계 — 루별 내역까지.
 *
 * ⚠**이적해도 선수 페이지는 시즌 합계다**(`addBatted` 와 같은 이유). 루별 표도 함께 더하지 않으면
 * 총계와 내역이 어긋나고, 화면은 그것을 「그 루는 0」이라고 말한다.
 */
type StealTotals = Pick<
  StealLine,
  "sb" | "cs" | "pickoff" | "sbByBase" | "csByBase" | "pickoffByBase" | "doubleSteal"
>;

function addByBase(
  a: Readonly<Record<StealBase, number>> | undefined,
  b: Readonly<Record<StealBase, number>>,
): Record<StealBase, number> {
  const out = {} as Record<StealBase, number>;
  for (const base of STEAL_BASES) out[base] = (a?.[base] ?? 0) + b[base];
  return out;
}

function addSteal(a: StealTotals | undefined, b: StealLine): StealTotals {
  return {
    sb: (a?.sb ?? 0) + b.sb,
    cs: (a?.cs ?? 0) + b.cs,
    pickoff: (a?.pickoff ?? 0) + b.pickoff,
    sbByBase: addByBase(a?.sbByBase, b.sbByBase),
    csByBase: addByBase(a?.csByBase, b.csByBase),
    pickoffByBase: addByBase(a?.pickoffByBase, b.pickoffByBase),
    doubleSteal: (a?.doubleSteal ?? 0) + b.doubleSteal,
  };
}

/**
 * 루 이름 — **표마다 다르다.**
 *
 * ⚠도루의 `base` 는 **노린 루**라 「二盗」로 읽고, 견제사의 `base` 는 **있던 루**라
 * 「二塁」로 읽는다(마이그레이션 010). 하나의 표로 쓰면 1루 견제사가
 * 「1루를 훔치려다 잡혔다」로 읽히는데, 그런 일은 일어나지 않는다.
 * ⚠`一盗` 는 실측 0건이지만 표에서 지우지 않는다 — 나오면 **보여야** 이상한 줄 안다(M7의 정신).
 */
const STEAL_BASE_LABEL: Readonly<Record<StealBase, string>> = {
  "1b": "一盗", "2b": "二盗", "3b": "三盗", home: "本盗",
};
const PICKOFF_BASE_LABEL: Readonly<Record<StealBase, string>> = {
  "1b": "一塁", "2b": "二塁", "3b": "三塁", home: "本塁",
};

/** 같은 선수가 두 구단에서 낸 타구를 합친다 — 이적해도 선수 페이지는 시즌 합계다 */
function addBatted(a: BattedBallData, b: BattedBallData): BattedBallData {
  return {
    groundOuts: a.groundOuts + b.groundOuts, airOuts: a.airOuts + b.airOuts,
    left: a.left + b.left, center: a.center + b.center, right: a.right + b.right,
    infield: a.infield + b.infield, infieldHits: a.infieldHits + b.infieldHits,
    swinging: a.swinging + b.swinging, looking: a.looking + b.looking,
  };
}

/**
 * 목록·검색에 쓰는 한 줄 성적.
 *
 * ⚠**한 곳에서만 만든다**(M1). 헤더 검색과 선수 명부가 **같은 문자열**을 써야
 * 「같은 선수인데 두 화면에서 다른 수」가 안 난다.
 * ⚠**분모를 문자열 안에 넣는다**(M2) — 값만 떼어 쓸 수 없게 한다.
 */
function summaryOf(
  role: "batter" | "pitcher",
  bat: { avg: Rate } | undefined,
  pit: { era: Rate } | undefined,
): string | null {
  if (role === "pitcher") {
    return pit === undefined || pit.era.value === null
      ? null
      : `防御率 ${dec2(pit.era.value)}（${innings(pit.era.denominator)}回）`;
  }
  return bat === undefined || bat.avg.value === null
    ? null
    : `打率 ${avg3(bat.avg.value)}（${bat.avg.denominator}打数）`;
}

/**
 * 併殺打의 **「0 인가 모름인가」**.
 *
 * ⚠**두 화면이 같은 판정을 써야 한다**(M1). 선수 페이지(시즌 합계)와 구단 표(그 구단 몫)가
 * 같은 식을 **각자 인라인으로** 적고 있었다 — 한쪽만 고치면 같은 선수에게 한 화면은 `0`,
 * 다른 화면은 `—` 가 나간다.
 *
 * ⚠**「0打席이라 정의상 0」과 「세지 못했다」를 가른다**(M11 · 2026-08-20 이중 검토 지적).
 * 처음에는 행이 없으면 무조건 `null` 이었는데, 실측으로 **`pa_event` 에 행이 없는 타자는
 * 9시즌 전 시즌에서 예외 없이 `打席 0` 이었다**(1,257명 중 打席>0 인 사람 **0명**).
 * 즉 그 `null` 은 결측이 아니라 **알 수 있는 0** 이었고, 같은 블록이 그 선수에게
 * `打席 0`·`安打 0`·`本塁打 0` 은 숫자로 내면서 併殺打만 `—` 를 내고 있었다
 * (선수 페이지 3,998장 중 **535장**).
 * ⚠**M11 은 「모르면 —」이 아니라 「0과 결측을 구별하라」다.** 알 수 있는 0을 결측으로
 * 강등하면, 진짜 결측(타석 로그 파싱 실패)이 났을 때 **같은 화면이라 구별할 수 없다.**
 * → 打席가 0이면 **0**, 打席가 있는데 행이 없으면 그때가 진짜 `null` 이다.
 *
 * ⚠**이 규칙을 지키는 시험이 0본이었다**(2026-08-20 최종 검토 ②). `?? null` 로 되돌리는
 * 뮤테이션이 `packages/web/test` **920본을 전부 통과**했고, 그러면 그 535장이 다시 `—` 가 된다.
 * 지금은 `gidp-by-team.test.ts` 가 두 방향을 실DB 로 고정한다.
 *
 * @param counted `pa_event` 에서 실제로 센 수. **행이 없으면 `undefined`**(0 이 아니다)
 * @param pa 같은 범위의 打席 수
 */
export function gidpOrUnknown(counted: number | undefined, pa: number): number | null {
  if (counted !== undefined) return counted;
  return pa === 0 ? 0 : null;
}

/**
 * カウント별 블록 데이터.
 *
 * ⚠**비율 산식을 여기서 쓰지 않는다**(M1) — `@bb-app/aggregate` 의 함수가 낸 `Rate` 를 옮겨 담는다.
 * ⚠**타석 로그가 없으면 `null`** — 「0」이 아니라 「그릴 근거가 없다」다(M11·M12).
 * ⚠**격리분만 있고 읽은 타석이 0인 경우는 `null` 이 아니다**(M7 · 2026-08-20 최종 검토 ④).
 *   예전에는 같은 `null` 이라 화면이 「打席の記録がありません。」이라고 적었는데,
 *   그때 그 문장은 **거짓**이고(타석은 있다) 격리한 수가 화면에 아예 안 나갔다 —
 *   **파서가 조용히 0을 흘리는 것과 구별할 수 없는 모양**이다.
 * ⚠**내보내는 이유는 시험 때문이다.** 이 상태는 오늘 실데이터에 0건이라 `loadSite` 를 통해서는
 *   재현할 수 없다 — 규칙을 값으로 재려면 함수를 직접 불러야 한다(작업규칙 9).
 */
export function countBlockOf(c: CountLine | undefined): CountBlockData | CountUnreadable | null {
  if (c === undefined) return null;
  if (c.pa === 0) return c.quarantined > 0 ? { quarantinedOnly: c.quarantined } : null;
  const row = (label: string, line: BattingLine): CountSplitRow => ({
    label,
    line,
    avg: battingAverage(line),
    ops: ops(line),
  });
  return {
    pa: c.pa,
    quarantined: c.quarantined,
    twoStrike: twoStrikeRate(c),
    firstPitch: firstPitchRate(c),
    fullCount: fullCountRate(c),
    threeBall: threeBallRate(c),
    rows: [
      row("2ストライク前", c.beforeTwoStrikeLine),
      row("2ストライク後", c.twoStrikeLine),
    ],
  };
}

/** 火消し의 개수 부분. ⚠**통산과 시즌이 같은 모양을 쓴다** — 두 벌로 적으면 어긋난다 */
function reliefTotalsOf(l: ReliefLine | undefined): ReliefTotals {
  return {
    midInning: l?.midInning ?? 0,
    inherited: l?.inherited ?? 0,
    inheritedRunners: l?.inheritedRunners ?? 0,
    doused: l?.doused ?? 0,
  };
}

/**
 * 火消し 블록 데이터.
 *
 * ⚠**이닝 도중 등판이 한 번도 없으면 `null`** — 「0회」를 늘어놓는 블록은 정보가 아니다(M12).
 * ⚠**자격선 미만이면 비율을 `null` 로 낸다**(M3) — 화면이 「N登板未満」이라고 적는다.
 *   `.000` 이나 `—` 로 내면 「실패했다」와 구별되지 않는다(M11).
 */
function reliefBlockOf(
  career: ReliefLine | undefined,
  season: ReliefLine | undefined,
  from: number,
  to: number,
): ReliefBlockData | null {
  if (career === undefined || career.midInning === 0) return null;
  const totals = reliefTotalsOf(career);
  return {
    from,
    to,
    career: totals,
    season: reliefTotalsOf(season),
    dousedRate:
      totals.inherited >= MIN_INHERITED_FOR_RATE ? dousedRate(career) : null,
    enteringRe: averageEnteringRe(career),
    reMissing: career.reMissing,
    minForRate: MIN_INHERITED_FOR_RATE,
  };
}

/**
 * 우리가 실제로 보유한 시즌 범위.
 * ⚠**하나도 없으면 0/0 이다** — 「0년부터」라고 쓰지 않게 화면이 그것을 「모른다」로 읽는다(M11).
 */
function heldSeasonsOf(db: Db): { from: number; to: number } {
  const r = db.raw
    .prepare("SELECT MIN(season) AS lo, MAX(season) AS hi FROM game")
    .get() as unknown as { lo: number | null; hi: number | null };
  return { from: r.lo ?? 0, to: r.hi ?? 0 };
}

export function loadSite(db: Db, o: LoadOptions): SiteData {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";

  /**
   * ⚠**조건이 어긋나면 던진다**(M7) — **아무것도 읽기 전에.**
   * 다른 대회로 만든 `CareerContext` 를 조용히 쓰면 **올스타 등판이 정규시즌 火消し 에 섞이는**
   * 식으로 틀리는데, 그건 화면 어디에도 드러나지 않는다.
   */
  if (o.career !== undefined && (o.career.competition !== competition || o.career.through !== through)) {
    throw new Error(
      `CareerContext 의 조건이 다르다: ${o.career.competition}/${o.career.through} vs ${competition}/${through} — ` +
        "같은 조건으로 만든 것만 넘겨라",
    );
  }

  const meta = db.raw
    .prepare(
      `SELECT COUNT(*) AS games, MAX(game_date) AS latest FROM game
       WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?`,
    )
    .get(o.season, competition, through) as { games: number; latest: string | null };

  const agg = aggregateSeason(db, o.season, competition, through);

  /**
   * **득점기대치(RE) 행렬을 리그 상수보다 먼저 만든다**(2026-08-20).
   *
   * ⚠**순서가 뒤집힌 이유**: wOBA 계수를 이제 **RE 에서 유도**한다. 예전에는 계수가 모듈 상수
   * 1세트(남의 공개값)라 순서가 상관없었지만, 지금은 **RE 없이는 리그 상수를 만들 수 없다.**
   * ⚠**같은 `through` 로 만든다** — 어긋나면 계수의 기준일과 화면의 기준일이 갈린다.
   * ⚠**여기서 만든 행렬을 아래 루프가 다시 쓴다.** 두 번 만들면 시즌을 두 번 훑는 것도,
   * 값이 갈라지는 것도 일어난다(M1).
   */
  const reMade = new Map<League, RunExpectancy>();
  const runValuesByLeague = new Map<League, WobaWeights>();
  for (const league of ["central", "pacific"] as const) {
    const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
    const re = buildRunExpectancy(db, o.season, league, codes, competition, through);
    // ⚠**행렬은 비어 있어도 넣는다.** 아래 루프가 SRC·SRP·번트에 그대로 쓰고,
    //   그것들은 「비면 비는」 것이 원래 거동이다 — 여기서 던지면 거동이 바뀐다
    reMade.set(league, re);
    /**
     * ⚠**타석 로그가 없으면 계수를 지어내지 않는다.** 그 리그는 폴백 계수로 떨어지고,
     * 폴백은 리그·시즌을 모르는 값이라 **출루율 눈금이 밀린다**(중앙 약 1 wRC+).
     * 조용히 넘기지 않는다 — 박스스코어는 있는데 타석 로그가 통째로 없다는 뜻이고,
     * 그때는 SRC·SRP·번트·카운트가 **다 같이** 비어 있을 것이다.
     */
    if (re.totalPa === 0) {
      if (agg.battingByLeague.some((b) => b.league === league)) {
        console.warn(
          `⚠${o.season} ${league}: 타석 로그가 0건이라 wOBA 계수를 유도하지 못했다 — 폴백 계수를 쓴다`,
        );
      }
      continue;
    }
    runValuesByLeague.set(league, deriveRunValues(db, re, codes, competition, through).runValues);
  }

  const bundles = buildLeagues(agg, (lg) => runValuesByLeague.get(lg));

  const profiles = loadProfiles(db);
  const splitsByPlayer = loadSplits(db, o.season, competition, through);
  // 투수 스플릿은 축 식이 다르다(좌우가 상대 타자, 홈/원정이 반대). 같은 함수로 만든다
  const pitcherSplitsByPlayer = loadSplits(db, o.season, competition, through, true);
  const scorebookByPlayer = loadScorebook(db, o.season, competition, through);
  const statePaByPlayer = loadStatePa(db, o.season, competition, through);
  const monthlyEra = loadMonthlyEra(db, o.season, competition, through);
  // ⚠연속 기록은 경기 단위다. 타석이 없는 경기(대주자·수비 교대)는 세지 않는다
  const streaksByPlayer = battingStreaks(db, o.season, competition, through);

  // 상대 선수의 소속 구단은 시즌 집계에서 온다 — 이름 문자열로 조인하지 않는다(M10)
  const teamOfPlayer = new Map<string, string>();
  for (const b of agg.batting) teamOfPlayer.set(b.playerId, b.teamCode);
  for (const p of agg.pitching) if (!teamOfPlayer.has(p.playerId)) teamOfPlayer.set(p.playerId, p.teamCode);
  const matchupsByPlayer = loadMatchups(db, o.season, competition, through, teamOfPlayer);
  /**
   * **통산 대전**(보유 첫 시즌 ~ 보고 있는 시즌).
   *
   * ⚠**현역 한정은 여기서 따로 걸지 않는다** — `teamOf` 가 **그 시즌의 소속**만 담고 있어서,
   * 은퇴·이적으로 지금 그 팀에 없는 선수는 `opponentTeam` 이 빈 문자열이 되어
   * 상대 팀 필터(`m.opponentTeam === opponentCode`)에서 저절로 빠진다.
   * 실측으로 확인한다 — 이 사실이 깨지면 통산 표에 은퇴 선수가 섞인다.
   */
  const careerMatchups = loadMatchups(
    db,
    o.season,
    competition,
    through,
    teamOfPlayer,
    heldSeasonsOf(db).from || o.season,
  );

  const rankingsByLeague = new Map<League, LeagueRankings>();
  const reByLeague = new Map<League, Map<string, number>>();
  // ⚠경기 페이지는 **행렬만이 아니라 `RunExpectancy` 자체**가 필요하다(`paValue`가 그걸 받는다).
  // 여기서 다시 만들지 않는다 — 같은 시즌을 두 번 훑는 것도, 값이 갈라지는 것도 피한다(M1)
  const reFull = new Map<string, RunExpectancy>();
  /**
   * 타구 성향 — **타석 로그 원문에서 읽는다.**
   * ⚠**선수당 한 벌씩만 만든다**(리그를 나눠 두 번 부르면 이적 선수가 반씩 나뉜다).
   * ⚠모르는 표기가 있으면 집계가 던진다(M7) — 조용히 흘리면 타구 성향이 서서히 틀려진다.
   */
  const bbBatter = new Map<string, BattedBallData>();
  for (const b of battedBalls(db, o.season, competition, through)) {
    const cur = bbBatter.get(b.playerId);
    bbBatter.set(b.playerId, cur === undefined ? b : addBatted(cur, b));
  }
  /**
   * 도루 성적. ⚠**선수당 한 벌씩만 만든다**(리그를 나눠 두 번 부르면 이적 선수가 반씩 나뉜다).
   * ⚠대회를 섞지 않는다(§2-1) — 올스타를 넣으면 2026 도루가 611이 아니라 620이 된다.
   */
  const stealByPlayer = new Map<string, StealTotals>();
  for (const st of steals(db, o.season, competition, through)) {
    const cur = stealByPlayer.get(st.playerId);
    stealByPlayer.set(st.playerId, addSteal(cur, st));
  }
  /**
   * **각주가 말하는 리그 전체의 本盗**.
   *
   * ⚠**화면이 수를 문자열로 들고 있었다**(2026-08-20). 「9シーズンで成功47・盗塁刺146」이
   * `player-page.ts` 에 박혀 배포물 **175장**에 복제됐고(실측), **경기가 하나 늘 때마다 사람이 고쳐야**
   * 했다 — 08-19 경기가 들어오자 곧바로 시험이 붉어졌다. 시즌 중에는 매일 그렇게 된다.
   * → **DB 에서 읽는다.** 사람이 안 고쳐도 화면이 늘 참이다.
   *
   * ⚠**시즌마다 만드는 값이 아니라 「우리가 가진 전 시즌」의 값이다** — 각주의 주장이
   * 「本盗는 드물다」라서 표본이 클수록 성립한다. 그래서 **시즌으로 자르지 않는다.**
   * ⚠**대신 그 범위를 화면에 적는다**(M2) — 분모를 말하지 않는 수는 쓰지 않는다.
   * ⚠**`through` 는 지킨다** — 사이트가 기준일로 자를 때 각주만 앞서가면 안 된다.
   */
  const heldForSteal = heldSeasonsOf(db);
  const leagueSteal = leagueStealTotals(db, competition, through, heldForSteal.from, heldForSteal.to);
  const leagueHomeSteal =
    leagueSteal.seasons.length === 0
      ? null
      : {
          from: leagueSteal.seasons[0]!,
          to: leagueSteal.seasons[leagueSteal.seasons.length - 1]!,
          sb: leagueSteal.sbByBase.home,
          cs: leagueSteal.csByBase.home,
          doubleSteal: leagueSteal.doubleStealByBase.home,
        };

  /**
   * 併殺打. ⚠**선수당 한 벌과 「선수|구단」 두 벌을 같이 만든다** —
   * 선수 페이지는 시즌 합계를, 구단 표는 **그 구단에서 낸 것만**을 쓴다.
   * 합계를 구단 표에 실으면 이적 선수의 옛 팀 몫이 새 팀 표에 실리고, 같은 화면의
   * 打席 열(그 팀만의 打席)과 어긋난다.
   * ⚠대회를 섞지 않는다(§2-1).
   */
  const gidpByPlayer = new Map<string, number>();
  const gidpByTeam = new Map<string, number>();
  for (const r of groundedIntoDoublePlays(db, o.season, competition, through)) {
    gidpByPlayer.set(r.playerId, (gidpByPlayer.get(r.playerId) ?? 0) + r.gidp);
    gidpByTeam.set(`${r.playerId}|${r.teamCode}`, (gidpByTeam.get(`${r.playerId}|${r.teamCode}`) ?? 0) + r.gidp);
  }

  /**
   * カウント別成績. ⚠**선수당 한 벌씩만 만든다**(리그를 나눠 두 번 부르면 이적 선수가 반씩 나뉜다).
   * ⚠대회를 섞지 않는다(§2-1).
   */
  const countByBatter = new Map<string, CountLine>();
  for (const c of countLines(db, o.season, competition, through)) {
    countByBatter.set(c.playerId, addCount(countByBatter.get(c.playerId), c));
  }
  const countByPitcher = new Map<string, CountLine>();
  for (const c of countLines(db, o.season, competition, through, true)) {
    countByPitcher.set(c.playerId, addCount(countByPitcher.get(c.playerId), c));
  }

  const bbPitcher = new Map<string, BattedBallData>();
  for (const b of battedBalls(db, o.season, competition, through, true)) {
    const cur = bbPitcher.get(b.playerId);
    bbPitcher.set(b.playerId, cur === undefined ? b : addBatted(cur, b));
  }

  /**
   * 타순 순회. **NPB 전체의 값**이라 리그로 나누지 않는다 —
   * 리그로 나누면 3순회 이후의 표본이 절반이 되고, 그건 값이 아니라 소음이다.
   * ⚠**생존자 편향**은 화면이 말한다(`timesThroughBlock`).
   */
  const timesThrough = timesThroughOrder(db, o.season, competition, through);

  /** 리그별 번트의 득점기대값 변화. **선수의 기록이 아니라 리그 전체의 값**이다 */
  const buntByLeague = new Map<League, BuntCell[]>();
  /**
   * 리그별로 잰 SRC/SRP 의 **원재료.** ⚠**여기서 묶지 않는다** — 묶는 것은 `foldSrc`/`foldSrp` 가
   * 리그를 다 돈 뒤에 한 번에 한다. 루프 안에서 묶으면서 같은 루프에서 순위까지 만들면
   * 먼저 도는 리그와 나중 도는 리그가 **다른 정의**를 쓰게 된다(2026-08-20 P1).
   */
  const srcPerLeague: { league: League; entries: readonly SrcEntry[] }[] = [];
  const srpPerLeague: { league: League; entries: readonly SrpEntry[] }[] = [];

  const battingByPlayer = new Map<string, BattingEntry>();
  const pitchingByPlayer = new Map<string, PitchingEntry>();
  // ⚠**자격 판정(규정타석)에 쓰는 리그별 몫.** 타이틀은 소속 리그에서 낸 성적으로만 겨룬다 —
  // 합계 타석을 한쪽 리그 기준에 대면 자격이 없는 사람이 자격자가 된다. 키는 `선수|리그`
  const leagueBatting = new Map<string, BattingEntry>();
  const leaguePitching = new Map<string, PitchingEntry>();
  const bundleByLeague = new Map<League, LeagueBundle>();
  /**
   * 순위를 만들 재료. ⚠**루프 안에서 순위를 만들지 않는다** — SRC/SRP 의 정의는
   * 리그를 다 돌고 접은 뒤에야 정해진다(`foldSrc`).
   */
  const rankingInput: { bundle: LeagueBundle; bat: BattingEntry[]; pit: PitchingEntry[] }[] = [];

  for (const bundle of bundles) {
    bundleByLeague.set(bundle.league, bundle);
    const codes = TEAMS.filter((t) => t.league === bundle.league).map((t) => t.code);
    /**
     * ⚠**위에서 이미 만들었다.** RE 행렬이 wOBA 계수의 재료가 되면서 리그 상수보다 먼저
     * 만들어야 했다 — 여기서 다시 만들면 같은 시즌을 두 번 훑고, 두 벌이 갈릴 여지가 생긴다(M1).
     * ⚠**없으면 던진다.** 번들이 있는데 행렬이 없다는 것은 위 루프와 조건이 어긋났다는 뜻이고,
     * 조용히 넘기면 그 리그의 SRC·SRP·번트가 통째로 사라진다.
     */
    const re = reMade.get(bundle.league);
    if (re === undefined) {
      throw new Error(`${o.season} ${bundle.league}: 리그 번들은 있는데 RE 행렬이 없다`);
    }
    reByLeague.set(bundle.league, re.matrix);
    reFull.set(bundle.league, re);
    // ⚠**리그별로 낸다.** 득점환경이 다르므로 두 리그를 섞은 하나의 번트 가치는 뜻이 흐려진다
    buntByLeague.set(bundle.league, buntValues(db, o.season, competition, through, re, codes));

    // ⚠**더하고 덮어쓰지 않는다.** SRC는 그 리그의 득점기대 행렬로 잰 **런 수**라 리그를 넘어도
    // 더하는 것이 맞다. 덮어쓰면 리그를 넘은 선수의 절반이 사라진다(2026-08-16 이중 검토 P0)
    // ⚠**다만 더하는 것은 나중이다** — 접기는 리그를 다 돈 뒤에 한다(`foldSrc`)
    srcPerLeague.push({ league: bundle.league, entries: computeSrc(db, re, codes, competition, through) });
    // ⚠투수는 같은 커널의 부호 반대다. 같은 리그 RE 행렬을 쓴다
    srpPerLeague.push({ league: bundle.league, entries: computeSrp(db, re, codes, competition, through) });

    const bat = battingEntries(bundle);
    const pit = pitchingEntries(bundle);
    // ⚠**리그별 항목은 리그별 지도에 넣는다.** 예전에는 `playerId` 하나를 키로 덮어써서,
    // 리그를 넘어 이적한 선수는 **나중에 도는 리그가 이겼다** — 파→세 이적이면
    // 지금 뛰지 않는 옛 팀이 소속으로 나오고 현재 팀 로스터에서 사라졌다
    for (const e of bat) leagueBatting.set(`${e.player.playerId}|${bundle.league}`, e);
    for (const e of pit) leaguePitching.set(`${e.player.playerId}|${bundle.league}`, e);
    rankingInput.push({ bundle, bat, pit });
  }

  const srcFold = foldSrc(srcPerLeague);
  const srpFold = foldSrp(srpPerLeague);
  /**
   * **선수 × 구단**의 SRC/SRP. 구단 페이지가 쓴다.
   *
   * ⚠**시즌 합계를 구단 표에 실으면 안 된다.** 이적 선수의 SRC 가 두 구단 페이지에
   * 그대로 실려, 같은 행 안에서 打席 는 팀 몫이고 SRC 는 시즌 합계가 된다 —
   * **분모가 두 종류**가 되는 것이다(2026-08-17 2차 검토 · 실측 2명).
   */
  const srcByTeam = srcFold.byTeam;
  const srpByTeam = srpFold.byTeam;

  // ⚠**비율은 합계가 정해진 뒤에 낸다.** 리그별로 낸 환산값을 더하면 분모가 두 번 세어진다.
  // 환산식은 집계 패키지 한 벌을 쓴다(M1) — 여기서 다시 쓰면 언젠가 한쪽만 고쳐진다
  /** 화면이 쓰는 **시즌 합계**. 리그를 넘어도 한 줄이다 */
  const srcByPlayer = new Map<string, { src: number; pa: number; skipped: number; srcPer600: number | null }>();
  for (const [id, s] of srcFold.byPlayer) srcByPlayer.set(id, { ...s, srcPer600: srcPer600Of(s.src, s.pa) });
  // ⚠9이닝 환산의 분모는 **아웃**이다. 상대 타자 수(bf)는 표본 표기용이라 둘 다 들고 있어야 한다
  const srpByPlayer = new Map<string, { srp: number; bf: number; skipped: number; outs: number; srpPer9: number | null }>();
  for (const [id, s] of srpFold.byPlayer) srpByPlayer.set(id, { ...s, srpPer9: srpPer9Of(s.srp, s.outs) });

  /**
   * 火消し(継投引き継ぎ) — **통산이다.**
   *
   * ⚠**보고 있는 시즌까지로 자른다.** 2018 년 화면에 2026 년 등판을 실으면 그건 시간 여행이다 —
   * 통산 대전(`careerMatchups`)이 이미 같은 규약을 쓴다.
   * ⚠**한 시즌 표본으로는 순위가 성립하지 않는다**(M3 · 실측 1인당 4.17회) —
   * 시즌 쪽은 **개수만** 낸다.
   */
  const heldFrom = heldSeasonsOf(db).from || o.season;
  /**
   * ⚠**미리 만들어 둔 것이 있으면 시즌으로 걸러 쓴다.** 조회는 시즌 범위로 자르나
   * 전 범위를 뽑아 거르나 **같은 답이다** — 하프이닝 안의 인접만 보고, 경기는 시즌을 넘지 않는다.
   * 실측(2026-08-20)으로 2018·2021·2024·2026 네 지점에서 **전건 일치**를 확인했고,
   * `relief-seasons.test.ts` 가 그것을 고정한다.
   */
  const reliefScan: ReliefScan =
    o.career === undefined
      ? midInningEntries(db, competition, through, heldFrom, o.season)
      : {
          entries: o.career.reliefScan.entries.filter((e) => e.season <= o.season),
          unknownPitcher: o.career.reliefScan.unknownPitcher,
        };
  /**
   * 등판 시점 RE. ⚠**행렬은 `buildRunExpectancy` 한 벌뿐이다**(M1) — 여기서 다시 만들지 않고
   * **시즌·리그마다 한 번씩만** 부른다(실측 1회 76ms).
   * ⚠**현재 시즌 몫은 위에서 이미 만든 것을 그대로 쓴다** — 두 번 만들면 같은 화면 안에서
   * 값이 갈릴 수 있다.
   */
  const reCache = new Map<string, RunExpectancy | undefined>();
  if (o.career !== undefined) for (const [k, re] of o.career.runExpectancy) reCache.set(k, re);
  // ⚠**현재 시즌은 위에서 이미 만든 것이 이긴다** — 같은 인자로 만든 같은 값이지만,
  //   같은 화면 안에서 두 벌을 쓰지 않는다는 것이 M1 이다
  for (const [league, re] of reFull) reCache.set(`${o.season}|${league}`, re);
  const reForEntry = (e: { season: number; offenseCode: string }): RunExpectancy | undefined => {
    /**
     * ⚠**RE 의 리그를 정하는 것은 공격 측이다**(`run-expectancy.ts` 가 그렇게 만든다).
     * ⚠**올스타는 구단 코드가 `cl`/`pl` 이라 리그가 없다** — `leagueOf` 가 던지므로 먼저 거른다.
     *   여기서 `undefined` 를 내면 `foldRelief` 가 그 등판을 `reMissing` 으로 세고
     *   **화면이 그 수를 말한다**(M11) — 0 으로 때우지 않는다.
     */
    if (NON_TEAM_CODES[e.offenseCode] !== undefined) return undefined;
    const league = leagueOf(e.offenseCode);
    const key = `${e.season}|${league}`;
    if (!reCache.has(key)) {
      const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
      reCache.set(key, buildRunExpectancy(db, e.season, league, codes, competition, through));
    }
    return reCache.get(key);
  };
  /**
   * 引き分けの解剖. ⚠**보고 있는 시즌까지로 자른다**(통산 대전과 같은 규약) —
   * 2018 년 화면에 2021 년 무승부를 실으면 그건 시간 여행이다.
   * ⚠**수를 화면에 하드코딩하지 않는다** — 직전 라운드가 리그 실측치를 1,808장에 박았다.
   */
  const drawRows: DrawSeasonRow[] = seasonDraws(db, competition, through, heldFrom, o.season).map((r) => ({
    season: r.season,
    current: r.season === o.season,
    games: r.games,
    draws: r.draws,
    drawRate: drawRate(r),
    extra: r.extra,
    extraDrawn: r.extraDrawn,
    extraDecided: extraDecidedRate(r),
    regulationDrawn: r.regulationDrawn,
    maxInning: r.maxInning,
    inningUnknown: r.inningUnknown,
  }));

  const reliefCareer = new Map<string, ReliefLine>();
  for (const l of foldRelief(reliefScan.entries, reForEntry)) reliefCareer.set(l.pitcherId, l);
  // ⚠**시즌 몫은 같은 목록을 걸러 만든다** — 다시 조회하면 두 수가 갈릴 수 있다(M1)
  const reliefSeason = new Map<string, ReliefLine>();
  for (const l of foldRelief(reliefScan.entries.filter((e) => e.season === o.season), reForEntry)) {
    reliefSeason.set(l.pitcherId, l);
  }

  /**
   * ⚠**순위는 접기가 끝난 뒤에 만든다.** 리그 루프 안에서 만들면 먼저 도는 리그는 리그별 값을,
   * 나중 도는 리그는 시즌 합계를 받는다 — 같은 순위표가 리그마다 다른 정의를 쓰게 된다.
   */
  for (const w of rankingInput) {
    rankingsByLeague.set(
      w.bundle.league,
      buildLeagueRankings(w.bundle, w.bat, w.pit, srcFold.byLeague, srpFold.byLeague),
    );
  }

  /**
   * 화면이 쓰는 **시즌 합계**.
   *
   * ⚠**리그 상수를 표본으로 가중해 합계 라인에 적용한다**(`blendConstants`).
   * wOBA가 타석 가중 평균이라 `wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ)`가 정확히 성립한다 —
   * 날조가 아니라 증명 가능한 일반화다. 리그를 넘지 않은 선수에게는 아무 일도 하지 않는다.
   */
  const constantsFor = (playerId: string, weightOf: (lg: League) => number): LeagueConstants =>
    blendConstants(bundles.map((b) => ({ constants: b.constants, weight: weightOf(b.league) })));

  for (const player of agg.batting) {
    const lc = constantsFor(
      player.playerId,
      (lg) => leagueBatting.get(`${player.playerId}|${lg}`)?.player.line.pa ?? 0,
    );
    battingByPlayer.set(player.playerId, battingEntryOf(player, lc));
  }
  for (const player of agg.pitching) {
    const lc = constantsFor(
      player.playerId,
      (lg) => leaguePitching.get(`${player.playerId}|${lg}`)?.player.line.outs ?? 0,
    );
    pitchingByPlayer.set(player.playerId, pitchingEntryOf(player, lc));
  }

  /**
   * 시즌 중 소속 이력.
   *
   * ⚠**리그별로 나눈 집계에서 만든다.** 같은 리그 안의 이적은 합쳐지므로 여기서도 한 줄이고,
   * 리그를 넘은 이적만 두 줄이 된다 — 그게 순위표가 나누는 기준과 같아야
   * 「합계는 202타석인데 순위는 105타석」이 화면에서 설명된다.
   */
  const stintsOf = (playerId: string, role: "batter" | "pitcher"): PlayerStint[] => {
    const rows =
      role === "pitcher"
        ? agg.pitchingByLeague.filter((p) => p.playerId === playerId)
        : agg.battingByLeague.filter((b) => b.playerId === playerId);
    if (rows.length < 2) return [];
    return rows
      .map((r) => {
        // ⚠타자의 표본은 타석, 투수는 아웃 카운트다. 하나로 뭉뚱그리면 단위가 섞인다
        const isBat = "pa" in r.line;
        const sample = isBat ? (r.line as BattingLine).pa : (r.line as PitchingLine).outs;
        return {
          teamCode: r.teamCode,
          teamName: teamOf(r.teamCode).name,
          leagueName: LEAGUE_NAME[r.league],
          games: r.games,
          sample,
          sampleText: isBat ? `${sample}打席` : `${innings(sample)}回`,
          lastDate: r.lastDate,
        };
      })
      // ⚠**시간 순으로 둔다.** 화면이 「DeNA → ソフトバンク」처럼 화살표로 잇는데,
      // 출장 수로 정렬하면 화살표가 시간을 거스른다
      .sort((a, b) => a.lastDate.localeCompare(b.lastDate));
  };

  const players: PlayerPageData[] = [];
  const search: SearchEntry[] = [];
  // ⚠**집계만 먼저 만든다.** 경기 페이지 목록은 아직 모르므로 링크는 나중에 채운다
  const postseasonStats = postseasonPage(db, o);
  /**
   * 선수별 포스트시즌 요약 — **선수 페이지가 쓴다.**
   *
   * ⚠**정규시즌 성적 블록과 섞지 않는다**(§2-1). 같은 표에 넣으면 위에서 아래로 읽는 사람이
   * 두 수를 더한 것으로 읽는다. 그래서 별도 구획이고, 화면이 「위 성적에 포함되지 않는다」고 적는다.
   * ⚠**올스타는 넣지 않는다** — 소속이 구단이 아니라 선수 성적을 집계하지 않는다.
   */
  const briefByPlayer = new Map<string, PostseasonBrief[]>();
  for (const c of postseasonStats.competitions) {
    for (const b of c.batters) {
      const list = briefByPlayer.get(b.playerId) ?? [];
      list.push({
        competitionId: c.id,
        competitionName: c.name,
        games: b.games,
        sampleText: `${b.pa}打席`,
        line: `${b.h}安打${b.hr > 0 ? ` ${b.hr}本塁打` : ""}${b.rbi > 0 ? ` ${b.rbi}打点` : ""}`,
      });
      briefByPlayer.set(b.playerId, list);
    }
    for (const t of c.pitchers) {
      const list = briefByPlayer.get(t.playerId) ?? [];
      list.push({
        competitionId: c.id,
        competitionName: `${c.name}（投）`,
        games: t.games,
        sampleText: `${innings(t.outs)}回`,
        line: `${t.w}勝${t.l}敗${t.sv > 0 ? ` ${t.sv}S` : ""} 自責${t.er}`,
      });
      briefByPlayer.set(t.playerId, list);
    }
  }

  const ids = new Set<string>([...battingByPlayer.keys(), ...pitchingByPlayer.keys()]);

  for (const playerId of ids) {
    const bat = battingByPlayer.get(playerId);
    const pit = pitchingByPlayer.get(playerId);
    const base = bat?.player ?? pit?.player;
    if (base === undefined) continue;

    const bundle = bundleByLeague.get(base.league);
    if (bundle === undefined) continue;
    const rankings = rankingsByLeague.get(base.league)!;
    /**
     * ⚠**자격 판정은 소속 리그에서 낸 몫으로 한다.**
     * 타이틀은 그 리그의 성적으로만 겨루므로, 리그를 넘은 선수의 **합계 타석**을 한쪽 리그의
     * 규정타석에 대면 자격이 없는 사람이 자격자로 나온다. 리그를 넘지 않은 선수는 합계와 같다.
     */
    const batPart = leagueBatting.get(`${playerId}|${base.league}`);
    const pitPart = leaguePitching.get(`${playerId}|${base.league}`);
    /**
     * 자격선의 분모가 되는 구단.
     * ⚠**순위를 매긴 쪽이 본 것과 같은 값이어야 한다** — `rankBatters` 는 리그 몫 엔트리의
     * `player.teamCode` 를 쓴다. 여기서 다른 것을 보면 두 화면이 다시 갈린다(M1).
     */
    const batTeam = batPart?.player.teamCode ?? bat?.player.teamCode ?? base.teamCode;
    const pitTeam = pitPart?.player.teamCode ?? pit?.player.teamCode ?? base.teamCode;
    const profile = profiles.get(playerId);
    const team = teamOf(base.teamCode);

    const role: "batter" | "pitcher" =
      profile?.position === "投手" || (bat === undefined && pit !== undefined) ? "pitcher" : "batter";

    const battingData: BattingBlockData | null =
      bat === undefined
        ? null
        : {
            games: bat.player.games,
            runs: bat.player.runs,
            rbi: bat.player.rbi,
            sb: bat.player.sb,
            /**
             * 走塁. ⚠**분모는 기도(성공+도루자)이고 견제사는 들어가지 않는다** —
             * NPB 기록에서 牽制死 는 盗塁刺 가 아니다. 넣으면 전 선수의 성공률이 낮아진다.
             * ⚠기도 0이면 값은 null 이다(M11) — 「안 뛴 사람」과 「다 실패한 사람」은 다르다.
             */
            steal: (() => {
              const st = stealByPlayer.get(playerId);
              /**
               * ⚠**「도루자 0」과 「도루자를 세지 못했다」를 구별한다**(M11).
               * 타석 로그의 도루 수가 박스의 `盗塁` 와 어긋나면 못 읽은 경기가 있다는 뜻이고,
               * 그때 `cs` 를 0으로 때우면 성공률이 **1.000** 이 된다 —
               * **분모까지 붙은 그럴듯한 거짓말**이라 분모 없는 값보다 나쁘다.
               * 방아쇠는 이론이 아니다: `--skip-events` 는 문서화된 플래그이고 종료 코드 0이다.
               */
              const boxSb = bat.player.sb;
              if ((st?.sb ?? 0) !== boxSb) return null;
              const cs = st?.cs ?? 0;
              /**
               * 루별 내역. ⚠**기도가 있는 루만 담는다** — 전부 0인 줄은 정보가 아니라 잡음이다
               * (`battedBallRow` 가 표본 얇은 축을 빼는 것과 같은 판단).
               * ⚠**여기 분자는 타석 로그 쪽 수다.** 총계는 박스의 `盗塁` 를 쓰는데,
               * 위 가드가 **두 수가 같을 때만** 여기까지 오게 하므로 합이 어긋나지 않는다.
               * ⚠**견제사는 이 표에 없다** — 기도의 분모가 아니고 루의 뜻도 다르다.
               */
              const byBase: StealBaseRow[] = [];
              for (const base of STEAL_BASES) {
                const one = { sb: st?.sbByBase[base] ?? 0, cs: st?.csByBase[base] ?? 0 };
                if (attempts(one) === 0) continue;
                byBase.push({
                  label: STEAL_BASE_LABEL[base],
                  // ⚠**화면이 라벨 문자열로 루를 판정하지 않게 한다** — 각주의 本盗 분기가 이걸 본다
                  base,
                  sb: one.sb,
                  cs: one.cs,
                  rate: { value: successRate(one), denominator: attempts(one) },
                });
              }
              const pickoffByBase = STEAL_BASES
                .map((base) => ({ label: PICKOFF_BASE_LABEL[base], n: st?.pickoffByBase[base] ?? 0 }))
                .filter((x) => x.n > 0);
              /**
               * ⚠**총계의 분자는 화면에 보이는 `盗塁` 그 값이다**(박스스코어). 타석 로그 쪽 수로
               * 갈아타면 같은 블록에 **「盗塁 30」과 「28을 함축하는 성공률」**이 나란히 뜬다 —
               * 값이 조금 틀린 것보다 나쁜 자기모순이다.
               * ⚠**여기서 폴백으로 덮지 않는다.** 두 출처가 어긋나는 것은 적재가
               * `stealMismatch` 로 격리하고 収集ログ가 말한다 — 화면이 조용히 봉합하면
               * 어긋난 사실 자체가 사라진다(M7).
               */
              return {
                cs,
                pickoff: st?.pickoff ?? 0,
                rate: { value: successRate({ sb: boxSb, cs }), denominator: attempts({ sb: boxSb, cs }) },
                byBase,
                pickoffByBase,
                doubleSteal: st?.doubleSteal ?? 0,
                // ⚠**각주가 쓰는 리그 전체 수치.** 선수마다 같은 값이라 한 번 만든 것을 그대로 가리킨다
                leagueHome: leagueHomeSteal,
              };
            })(),
            // 併殺打(시즌 합계). ⚠판정 규칙은 `gidpOrUnknown` 한 벌이다(M1) — 근거는 그 함수의 주석에
            gidp: gidpOrUnknown(gidpByPlayer.get(playerId), bat.player.line.pa),
            line: bat.player.line,
            avg: bat.avg,
            obp: bat.obp,
            slg: bat.slg,
            ops: bat.ops,
            woba: bat.woba,
            wrcPlus: bat.wrcPlus,
            wraa: bat.wraa,
            iso: iso(bat.player.line),
            babip: babip(bat.player.line),
            kRate: strikeoutRate(bat.player.line),
            bbRate: walkRate(bat.player.line),
            src: srcByPlayer.get(playerId) ?? null,
            ranks: ranksFor(rankings.batting, playerId),
            /**
             * ⚠**순위를 매긴 함수와 같은 기준을 쓴다**(M1 · 2026-08-18 감사 P1).
             * 여기가 리그 최다 팀 기준이던 탓에, 순위표가 「打率21位」라고 쓴 선수의
             * **이 페이지가 같은 시각에 「順位がつきません」**이라고 썼다(浅村 · 333/345).
             * 한 사람에 대해 두 화면이 정반대를 말하면 어느 쪽도 믿을 수 없게 된다.
             */
            qualified: (batPart?.player.line.pa ?? 0) >= neededPa(bundle, batTeam),
            needPa: neededPa(bundle, batTeam),
            batted: bbBatter.get(playerId) ?? EMPTY_BATTED,
          };

    const pitchingData: PitchingBlockData | null =
      pit === undefined
        ? null
        : {
            games: pit.player.games,
            line: pit.player.line,
            // ⚠집계가 세어 둔 것을 그대로 쓴다 — 여기서 다시 세면 두 벌이 된다(M1)
            decisions: pit.player.decisions,
            quality: pit.player.quality,
            batted: bbPitcher.get(playerId) ?? EMPTY_BATTED,
            era: pit.era,
            whip: pit.whip,
            fip: pit.fip,
            k9: strikeoutsPer9(pit.player.line),
            bb9: walksPer9(pit.player.line),
            hr9: homeRunsPer9(pit.player.line),
            // ⚠**자기 역할의 순위표에서 순위를 읽는다.** 선발 순위표에서 마무리의 등수를
            // 찾으면 언제나 없다 — 애초에 그 표에 실려 있지 않기 때문이다
            ranks: ranksFor(
              pit.player.role === "reliever" ? rankings.reliever : rankings.starter,
              playerId,
            ),
            qualified: (pitPart?.player.line.outs ?? 0) >= neededOuts(bundle, pitTeam, pit.player.role),
            needOuts: neededOuts(bundle, pitTeam, pit.player.role),
            role: pit.player.role,
            starts: pit.player.starts,
            pitches: pit.player.pitches,
            wp: pit.player.wp,
            balk: pit.player.balk,
            // ⚠분모는 **아웃 카운트**다. 이닝으로 나누면 3배 작아진 수가 나온다.
            // ⚠투구수가 없으면 `rate(0, …)`로 때우지 않는다 — 「0구」가 되어 효율 1위가 된다
            pitchesPerOut:
              pit.player.pitches === null
                ? { value: null, denominator: pit.player.line.outs }
                : rate(pit.player.pitches, pit.player.line.outs),
            srp: srpByPlayer.get(playerId) ?? null,
            asStarter: roleLine(pit.player.asStarter, pit.player.starts),
            asReliever: roleLine(pit.player.asReliever, pit.player.games - pit.player.starts),
          };

    const reMatrix = reByLeague.get(base.league);
    const statePa = statePaByPlayer.get(playerId);
    const bunts = buntByLeague.get(base.league) ?? [];
    const situation: SituationCell[] =
      reMatrix === undefined || role === "pitcher"
        ? []
        : ALL_STATES.map((key) => {
            const [b = "-", o2 = "0"] = key.split("|");
            return {
              bases: b === "-" ? "" : b,
              outs: Number(o2),
              re: reMatrix.get(key) ?? null,
              pa: statePa?.get(key) ?? 0,
            };
          });

    const splits =
      role === "pitcher"
        ? (pitcherSplitsByPlayer.get(playerId) ?? [])
        : (splitsByPlayer.get(playerId) ?? []);
    const opponents =
      role === "pitcher"
        ? (matchupsByPlayer.byPitcher.get(playerId) ?? [])
        : (matchupsByPlayer.byBatter.get(playerId) ?? []);

    // 식별 마크(B안 成績の紋) — 축이 타자·투수로 다르다.
    // ⚠**투수 축은 네 개가 「낮을수록 좋다」라 뒤집혀 있다**(marks.ts). 같은 화면에 나란히
    // 놓이므로 뒤집지 않으면 좋은 투수가 작은 도형이 되어 뜻이 정반대가 된다.
    const mark =
      role === "pitcher" && pitchingData !== null
        ? {
            // ⚠**값이 아니라 `Rate`를 통째로 넘긴다.** 축마다 분모가 다르고,
            // 값만 넘기면 축이 자기 분모를 잃는다 — 그러면 M2를 지킬 방법이 없다
            axes: pitchingProfile({
              k9: pitchingData.k9,
              bb9: pitchingData.bb9,
              hr9: pitchingData.hr9,
              whip: pitchingData.whip,
              era: pitchingData.era,
            }),
            // ⚠아웃 카운트가 아니라 이닝으로 쓴다 — 사이트의 다른 분모와 같은 단위여야 한다
            sampleText: `${innings(pitchingData.line.outs)}回`,
          }
        : {
            axes:
              battingData === null
                ? []
                : battingProfile({
                    avg: battingData.avg,
                    obp: battingData.obp,
                    iso: battingData.iso,
                    bbRate: battingData.bbRate,
                    kRate: battingData.kRate,
                  }),
            sampleText: denominator(battingData?.line.pa ?? 0),
          };

    // 표제 옆 꺾은선 — 타자는 월별 OPS, 투수는 월별 방어율. **사진 대신 쓰는 표시**다
    const spark: SparkPoint[] =
      role === "pitcher"
        ? (monthlyEra.get(playerId) ?? []).map((m) => ({ label: monthLabel(m.month), value: m.era }))
        : ((splitsByPlayer.get(playerId) ?? []).find((a) => a.id === "month")?.rows ?? []).map((r) => ({
            label: r.label,
            value: r.ops.value,
          }));

    players.push({
      playerId,
      name: base.displayName,
      // 명부와 검색이 같은 문자열을 쓴다(M1)
      summary: summaryOf(role, battingData ?? undefined, pitchingData ?? undefined),
      season: o.season,
      teamCode: base.teamCode,
      teamName: team.name,
      league: base.league,
      leagueName: LEAGUE_NAME[base.league],
      color: colorOf(base.teamCode),
      position: profile?.position ?? null,
      throws: profile?.throws ?? null,
      bats: profile?.bats ?? null,
      birthYear: profile?.birthYear ?? null,
      physique: profile?.physique ?? null,
      draft: profile?.draft ?? null,
      career: careerOf(db, playerId, o.season),
      uniformNumber: profile?.uniformNumber ?? null,
      role,
      batting: battingData,
      pitching: pitchingData,
      splits,
      scorebook: scorebookByPlayer.get(playerId) ?? [],
      scorebookTotal: bat?.player.line.pa ?? 0,
      situation,
      matchups: opponents,
      matchupTotal: opponents.length,
      ranking: panelsForPlayer(
        role === "pitcher"
          ? (pit?.player.role === "reliever" ? rankings.reliever : rankings.starter)
          : rankings.batting,
        playerId,
      ),
      mark,
      spark,
      streaks: streaksByPlayer.get(playerId) ?? null,
      /**
       * カウント別. ⚠**투수 페이지는 투수 쪽 집계를 본다** — 투수도 타석에 서지만
       * 이 블록의 주역은 「이 사람이 던진 타석」이다.
       */
      count: countBlockOf(role === "pitcher" ? countByPitcher.get(playerId) : countByBatter.get(playerId)),
      /** 火消し. ⚠**투수 페이지에만** — 타자에게는 뜻이 없다(`blocks.ts` 가 그것을 강제한다) */
      relief:
        role === "pitcher"
          ? reliefBlockOf(reliefCareer.get(playerId), reliefSeason.get(playerId), heldFrom, o.season)
          : null,
      sparkLabel: role === "pitcher" ? "月別防御率" : "月別OPS",
      asOf: meta.latest,
      stints: stintsOf(playerId, role),
      bunts,
      timesThrough,
      postseason: briefByPlayer.get(playerId) ?? [],
    });

    /**
     * 검색 결과의 성적 한 줄.
     * ⚠**서식은 화면과 같은 함수로 만든다**(M1) — 여기서 손으로 반올림하면 값이 두 벌이 된다.
     * ⚠타자는 타율, 투수는 방어율. 역할 판정은 위에서 이미 한 것을 그대로 쓴다.
     */
    const summary = summaryOf(role, bat, pit);
    search.push({
      i: playerId,
      n: base.displayName,
      t: team.name,
      ...(summary === null ? {} : { s: summary }),
      // ⚠**없으면 필드를 만들지 않는다**(M11). 빈 문자열을 넣으면 색인이 980행만큼 커지고,
      // 검색 쪽에서 「읽는 법이 빈 사람」과 「읽는 법을 모르는 사람」이 같아진다
      ...(profile?.kana == null ? {} : { k: profile.kana }),
      ...(profile?.uniformNumber == null ? {} : { u: profile.uniformNumber }),
    });
  }

  players.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  search.sort((a, b) => a.n.localeCompare(b.n, "ja"));

  const categoriesOf = (r: LeagueRankings, limit: number): RankingCategory[] => [
    { id: "batter", label: "打者", panels: panelsForPage(r.batting, limit) },
    { id: "starter", label: "先発", panels: panelsForPage(r.starter, limit) },
    { id: "reliever", label: "救援", panels: panelsForPage(r.reliever, limit) },
  ];

  const sections: LeagueSection[] = bundles.map((bundle) => ({
    id: bundle.league,
    name: LEAGUE_NAME[bundle.league],
    categories: categoriesOf(rankingsByLeague.get(bundle.league)!, o.rankingRows ?? RANKING_PAGE_ROWS),
  }));

  // 일람의 하이라이트는 **부문마다 대표 지표 몇 개씩**만 낸다.
  // ⚠전 지표를 실으면 첫 화면이 순위표 페이지의 복사본이 되고, 「일람」이라는 이름이 거짓이 된다
  const HIGHLIGHT: Readonly<Record<string, readonly string[]>> = {
    batter: ["wrcPlus", "ops", "hr"],
    starter: ["era", "w", "so"],
    reliever: ["sv", "hld", "era"],
  };
  const highlights: LeagueSection[] = bundles.map((bundle) => {
    const r = rankingsByLeague.get(bundle.league)!;
    return {
      id: bundle.league,
      name: LEAGUE_NAME[bundle.league],
      categories: categoriesOf(r, 5).map((c) => ({
        ...c,
        // ⚠`HIGHLIGHT`에 적은 순서대로 낸다 — `filter`로 뽑으면 원본 순서가 남아
        // 「승리를 먼저 보여준다」는 의도가 조용히 사라진다
        panels: (HIGHLIGHT[c.id] ?? [])
          .map((id) => c.panels.find((p) => p.id === id))
          .filter((p): p is RankingPanel => p !== undefined),
      })),
    };
  });

  /**
   * ⚠**「당일」을 기본으로 연다**(2026-08-18 유저 요청). 예고는 전날 저녁에 다음날 것이 붙어서,
   * MAX 를 그냥 쓰면 오늘 경기를 보러 온 사람에게 **내일 것을 내민다.**
   */
  const probDates = probableDates(db, o.season);
  /**
   * 날짜별 予告先発.
   *
   * ⚠**기본 날짜는 여기서 뺀다** — `starters.html` 이 이미 그 날을 그린다.
   *   두 주소에 같은 화면이 생기면 「어느 쪽이 진짜인가」가 생긴다(날짜 화면과 같은 규칙).
   */
  const startersFor = (date: string): StartersPageData =>
    startersPage(
      loadProbables(db, o.season, date),
      o.builtOn,
      pitchingByPlayer,
      matchupsByPlayer.byPitcher,
      srpByPlayer,
      careerMatchups.byPitcher,
      probableDates(db, o.season),
      defaultProbableDate(probableDates(db, o.season), o.builtOn),
      heldSeasonsOf(db).from || o.season,
    );

  const startersData = startersPage(
    loadProbables(db, o.season, defaultProbableDate(probDates, o.builtOn) ?? undefined),
    o.builtOn,
    pitchingByPlayer,
    matchupsByPlayer.byPitcher,
    srpByPlayer,
    careerMatchups.byPitcher,
    probDates,
    defaultProbableDate(probDates, o.builtOn),
    heldSeasonsOf(db).from || o.season,
  );
  const starterDays = probDates
    .filter((d) => d !== startersData.gameDate)
    .map((d) => ({ ...startersFor(d), isDayPage: true }));

  // 선수명은 시즌 집계에서 온다 — **이름 문자열로 조인하지 않는다**(M10). ID로 찾아 이름을 붙인다
  const nameOf = (playerId: string): string | null =>
    battingByPlayer.get(playerId)?.player.displayName ??
    pitchingByPlayer.get(playerId)?.player.displayName ??
    null;

  // ⚠**만들어진 경기 페이지를 먼저 안다.** 試合 화면이 없는 페이지로 링크하면 404가 된다
  const gameList = gamePages(db, o, reFull, nameOf);
  /**
   * 포스트시즌의 경기 페이지도 만든다.
   *
   * ⚠**경기 페이지는 대회를 섞을 위험이 없다** — 그 경기 하나만 말하기 때문이다.
   * 섞이면 안 되는 것은 집계이고, 그건 아래 `postseasonPage`가 대회별로 따로 만든다(§2-1).
   * ⚠**RE 행렬은 정규시즌 것을 쓴다.** 포스트시즌만으로 득점기대치를 만들면 18경기짜리 표본이 되고,
   * 그건 어느 쪽이 나은지 말할 수 없는 수다. 같은 시즌의 리그 환경을 기준으로 읽는 편이 정직하다.
   */
  const postGameList = POSTSEASON_PAGES.flatMap((c) => gamePages(db, o, reFull, nameOf, c));
  // 순위표는 팀 페이지도 쓴다 — **한 번만 만든다**(M1). 두 번 만들면 언젠가 값이 갈린다
  const standings = standingsSections(db, o);
  const gamePageIds = new Set([...gameList, ...postGameList].map((g) => g.gameId));
  // ⚠**경기일 목록도 먼저 만든다.** 「앞뒤 경기일」이 이 목록에서 나오므로,
  // 날짜 화면과 오늘 화면이 서로 다른 목록을 보면 링크가 끊긴다
  const days = gameDates(db, o.season, through, competition);
  const latestDay = latestGameDate(db, o.season, through, competition);
  const postseasonData = withGamePages(postseasonStats, gamePageIds);
  /**
   * 신선도가 보는 「가장 최근 경기일」 — **대회를 가리지 않는다.**
   *
   * ⚠**정규시즌만 보면 10월에 사이트 전체가 거짓말을 한다.** 정규시즌 최종일(≈10/5)에서
   * 사흘이 지나면 신선도 띠가 「更新が止まっています … 取得に失敗している可能性があります」로 바뀌는데,
   * **같은 빌드의 포스트시즌 화면은 어제 경기를 보여주고 있다.**
   * 게다가 빌드가 종료 코드 1을 내므로 **일일 배치가 매일 실패로 보고된다.**
   * (2026-08-16 이중 검토에서 지적. 날짜가 정해진 결함이라 그때 반드시 터진다.)
   */
  const latestAnyDate = (db.raw
    .prepare(
      `SELECT MAX(game_date) AS d FROM game
       WHERE season = ? AND status = 'played' AND game_date <= ?`,
    )
    .get(o.season, through) as unknown as { d: string | null } | undefined)?.d ?? null;

  /**
   * 試合 화면. ⚠**대시보드도 이것을 그대로 쓴다**(M1) — 따로 조회하면
   * 「홈과 試合가 다른 경기를 보여준다」가 언젠가 난다.
   */
  const todayData = todayPage(db, o, startersData, nameOf, gamePageIds, days);

  /**
   * 대시보드.
   *
   * ⚠**여기서 먼저 부른다**(2026-08-19 Task 6). 팀 페이지의 「続いている記録」·「記録に近づいている」가
   * 이 결과(**자르기 전 배열**)를 `teamCode`로 거르므로(M1), `teamPages`보다 먼저 있어야 한다.
   * ⚠**최신 경기 요약을 새로 조회하지 않는다**(M1) — `todayPage`가 이미 만든 것을 옮긴다.
   *   따로 조회하면 「試合 화면과 홈이 다른 경기를 보여준다」가 언젠가 난다.
   */
  const homeData = homePage(
    db,
    o,
    standings,
    agg,
    streaksByPlayer,
    reFull,
    meta.latest,
    latestDay,
    todayData.gameDate === null
      ? null
      : {
        date: todayData.gameDate,
        games: todayData.games.map((g) => ({
          away: g.away.shortName,
          home: g.home.shortName,
          awayCode: g.away.teamCode,
          homeCode: g.home.teamCode,
          awayRuns: g.away.runs,
          homeRuns: g.home.runs,
        })),
      },
    postseasonData.competitions.some((c) => c.id !== "allStar"),
  );

  /**
   * ⚠**여기서 한 번만 부른다.** 우승 판정이 어긋났다는 사실(`disagreed`)을 화면과 함께
   * 들고 나와야 배포를 세울 수 있다(M7 · 검토 m2). 반환 객체 안에서 부르면 그 값을 못 받는다.
   */
  const teamData = teamPages(
    db,
    o,
    standings,
    agg,
    leagueBatting,
    leaguePitching,
    bundleByLeague,
    srcByTeam,
    srpByTeam,
    gidpByTeam,
    meta.latest,
    // ⚠**「기록이 있다」와 「포스트시즌이 있다」는 다른 말이다.** 올스타뿐인 시즌(2026)에
    // 「ポストシーズンは別の画面にあります」라고 쓰면 없는 것을 있다고 안내하는 것이 된다.
    // 내비 항목은 기록이 있으면 내지만, 이 문구는 진짜 포스트시즌일 때만이다
    postseasonData.competitions.some((c) => c.id !== "allStar"),
    latestDay,
    // ⚠**만들어진 목록 자체를 넘긴다**(M1) — 「어느 경기에 페이지가 있는가」의 조건을
    //   캘린더에 베끼면 한쪽이 바뀔 때 조용히 갈린다
    gamePageIds,
    // ⚠**予告先発도 같은 한 벌이다**(M1) — 試合 화면·予告先発 화면이 쓰는 것을 그대로 넘긴다
    startersData,
    /**
     * ⚠**연속 기록·기록 근접도 같은 한 벌이다**(M1 · Task 6) — 여기서 다시 계산하지 않는다.
     * ⚠**`homeData.page.streaks` 가 아니라 `allStreaks` 다**(2026-08-19 수정). 홈이 상위 N으로
     * 자른 뒤의 배열을 넘기면 구단 페이지가 **12팀 중 6팀 0건**이 된다 —
     * 이 파일의 `HomePageResult` 주석에 실측이 있다.
     */
    homeData.allStreaks,
    homeData.allMilestones,
  );

  return {
    season: o.season,
    asOf: meta.latest,
    // ⚠**신선도는 대회를 가리지 않는다.** 표시용 기준일(`asOf`)은 정규시즌 그대로다 —
    // 「데이터가 언제까지 들어왔나」와 「이 화면이 무엇을 보여주나」는 다른 질문이다
    latestAnyGameDate: latestAnyDate,
    heldSeasons: heldSeasonsOf(db),
    gameCount: meta.games,
    players,
    search,
    index: {
      season: o.season,
      playerCount: players.length,
      gameCount: meta.games,
      asOf: meta.latest,
      teams: rosters(players, profiles),
      highlights,
    },
    ranking: {
      season: o.season,
      asOf: meta.latest,
      standings,
      tieRule: TIE_RULE,
      draws: drawRows,
      leagues: sections,
    },
    // ⚠**위에서 이미 만들었다** — `teamPages`가 같은 한 벌을 쓰므로 여기서 다시 부르면 두 벌이 된다(M1)
    home: homeData.page,
    starters: startersData,
    starterDays,
    matchup: matchupPage(db, o, meta.latest, startersData, battingByPlayer, pitchingByPlayer),
    today: todayData,
    days: dayPages(db, o, days, latestDay, nameOf, gamePageIds),
    dayIndex: { season: o.season, latestDate: latestDay, days: [...days] },
    postseason: postseasonData,
    teams: teamData.pages,
    // ⚠**순위표와 구단 페이지를 잇기만 한다**(M1) — 여기서 다시 조회하면 두 화면이 갈린다
    teamsPage: teamsPage(o.season, meta.latest, standings, teamData.pages),
    raceDisagreed: teamData.disagreed,
    games: [...gameList, ...postGameList],
  };
}
