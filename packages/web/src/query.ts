/**
 * DB → 화면 데이터.
 *
 * ⚠**여기가 유일한 DB 접점이다.** 렌더러는 DB를 모른다 — 그래야 픽스처만으로 화면을 테스트한다.
 * ⚠**지표를 여기서 다시 계산하지 않는다**(M1). `@bb-app/metrics` · `@bb-app/aggregate`가
 * 만든 값을 옮겨 담기만 한다. 여기에 산식이 생기는 순간 값이 두 벌이 된다.
 */
import type { Db } from "@bb-app/store";
import type { BattingLine, LeagueConstants, PitchingLine, Rate } from "@bb-app/metrics";
import {
  babip,
  battingAverage,
  earnedRunAverage,
  homeRunsPer9,
  iso,
  onBasePercentage,
  ops,
  qualifiedBatterPa,
  qualifiedPitcherOuts,
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
  pitchingEntries,
  pitchingEntryOf,
  qualifyingOuts,
  rankBatters,
  rankPitchers,
  rankPitchersInRole,
  stateKey,
  teamStandings,
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
  SplitDimension,
} from "@bb-app/aggregate";
import { NEUTRAL_COLOR, TEAMS, colorOf, leagueOf, shortNameOf, teamOf } from "@bb-app/domain";
import type { League, TeamColor } from "@bb-app/domain";
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
  IndexPageData,
  LeagueSection,
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
import { avg3, dec2, denominator, innings } from "./format.ts";
import { readFileSync } from "node:fs";
import type {
  TeamBatter,
  TeamMonth,
  TeamPageData,
  TeamPitcher,
} from "./team-page.ts";
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
/** 순위표 페이지에 싣는 상위 인원 */
const RANKING_PAGE_ROWS = 30;
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
): MetricRanking {
  const rows: RankingRow[] = ranked
    .map((r) => ({
      rank: r.rank,
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

function batterQualifier(bundle: LeagueBundle): string {
  const need = qualifiedBatterPa(bundle.teamGames);
  return `規定打席 ${need}（チーム${bundle.teamGames}試合 × 3.1、小数切り上げ）に達した選手だけに順位がつきます。同率は同じ順位で、次の順位を飛ばします。`;
}

/**
 * 역할별 자격 문구.
 *
 * ⚠**선발은 NPB 공식 기준, 구원은 우리 기준**이다. 같은 문장으로 쓰면
 * 자체 기준이 공식 기준으로 읽힌다 — 그건 출처를 속이는 것과 같다(§0-10 출처 추적성).
 */
function pitcherQualifier(bundle: LeagueBundle, role: PitcherRole): string {
  const need = qualifyingOuts(bundle, role) / 3;
  const rounded = Math.round(need * 10) / 10;
  if (role === "starter") {
    return `規定投球回 ${rounded}回（チーム${bundle.teamGames}試合 × 1回・NPB公式）に達した先発投手だけに順位がつきます。同率は同じ順位で、次の順位を飛ばします。`;
  }
  return `救援投手には公式の規定投球回がないため、当サイトは規定投球回の3分の1（${rounded}回）を基準にしています。これはNPBの基準ではありません。同率は同じ順位で、次の順位を飛ばします。`;
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
  srcByPlayer: Map<string, { src: number; pa: number }>,
  srpByPlayer: Map<string, { srp: number; bf: number }>,
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
      const s = srcByPlayer.get(e.player.playerId);
      return s === undefined ? rate(0, 0) : { value: s.src, denominator: s.pa };
    },
    true,
  );

  const batting: MetricRanking[] = [
    toMetricRanking("wrcPlus", "wRC+", 1, "打席", bq, asRanked(rankBatters(bundle, bat, (e) => e.wrcPlus), bid)),
    toMetricRanking("src", "SRC", 1, "打席", bq, asRanked(srcRanked, bid)),
    toMetricRanking("ops", "OPS", 3, "打席", bq, asRanked(rankBatters(bundle, bat, (e) => e.ops), bid)),
    toMetricRanking("avg", "打率", 3, "打数", bq, asRanked(rankBatters(bundle, bat, (e) => e.avg), bid)),
    toMetricRanking("obp", "出塁率", 3, "打席", bq, asRanked(rankBatters(bundle, bat, (e) => e.obp), bid)),
    toMetricRanking("slg", "長打率", 3, "打数", bq, asRanked(rankBatters(bundle, bat, (e) => e.slg), bid)),
    toMetricRanking("woba", "wOBA", 3, "打席", bq, asRanked(rankBatters(bundle, bat, (e) => e.woba), bid)),
    toMetricRanking("wraa", "wRAA", 1, "打席", bq, asRanked(rankBatters(bundle, bat, (e) => e.wraa), bid)),
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
  ];

  return {
    league: bundle.league,
    batting,
    starter: pitcherRankings(bundle, pit, "starter", pid, srpByPlayer),
    reliever: pitcherRankings(bundle, pit, "reliever", pid, srpByPlayer),
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
  srpByPlayer: Map<string, { srp: number; bf: number }>,
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
  ): MetricRanking =>
    // ⚠투수 지표의 `Rate.denominator`는 **아웃 카운트**다. 이닝으로 바꿔 표기한다.
    toMetricRanking(
      id, label, 2, "投球回", pq,
      asRanked(rankPitchersInRole(bundle, pit, role, pick, higherIsBetter)),
      true,
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

  const common: MetricRanking[] = [
    rate("era", "防御率", (e) => e.era),
    rate("fip", "FIP", (e) => e.fip),
    rate("whip", "WHIP", (e) => e.whip),
    rate("k9", "K/9", (e) => strikeoutsPer9(e.player.line), true),
    rate("bb9", "BB/9", (e) => walksPer9(e.player.line)),
    // ⚠SRP는 **높을수록 좋다.** 다른 투수 비율과 방향이 반대다
    rate("srp", "SRP", (e) => {
      const v = srpByPlayer.get(e.player.playerId);
      return v === undefined ? { value: null, denominator: 0 } : { value: v.srp, denominator: v.bf };
    }, true),
    count("so", "奪三振", (e) => e.player.line.so),
    // ⚠球数/アウト는 **낮을수록 좋다.** 다른 투수 개수 지표와 성격이 다르다
    rate("pitchesPerOut", "球数/アウト", (e) =>
      e.player.pitches === null
        ? { value: null, denominator: e.player.line.outs }
        : { value: e.player.pitches / e.player.line.outs, denominator: e.player.line.outs },
    ),
    count("pitches", "投球数", (e) => e.player.pitches ?? 0),
    inningsRanking(),
  ];

  if (role === "starter") {
    return [
      count("w", "勝利", (e) => e.player.decisions.w),
      ...common,
      count("l", "敗戦", (e) => e.player.decisions.l),
      count("starts", "先発", (e) => e.player.starts),
    ];
  }
  return [
    count("sv", "セーブ", (e) => e.player.decisions.sv),
    count("hld", "ホールド", (e) => e.player.decisions.hld),
    // HP(홀드포인트) = 홀드 + 구원승. NPB 最優秀中継ぎ의 정의다
    count("hp", "HP", (e) => e.player.decisions.hld + e.player.decisions.reliefW),
    ...common,
    count("w", "勝利", (e) => e.player.decisions.w),
    count("games", "登板", (e) => e.player.games),
  ];
}

/**
 * 선수 페이지에 실을 순위표 — 상위 N + **본인 행은 순위 밖이어도 반드시 넣는다**.
 *
 * ⚠**본인이 없는 순위표는 순위표가 아니다.** 「내가 몇 위인가」가 이 블록의 존재 이유이고,
 * 상위 10명만 자르면 그 답이 사라진다.
 */
export function panelsForPlayer(
  rankings: readonly RankingPanel[],
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
      qualifier: m.qualifier,
    };
  });
}

function panelsForPage(rankings: readonly MetricRanking[], limit: number): RankingPanel[] {
  return rankings.map((m) => ({
    id: m.id,
    label: m.label,
    digits: m.digits,
    unit: m.unit,
    denAsInnings: m.denAsInnings,
    valueAsInnings: m.valueAsInnings === true,
    rows: m.rows.slice(0, limit),
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
  birthDate: string | null;
  physique: string | null;
}

function loadProfiles(db: Db): Map<string, ProfileRow> {
  const rows = db.raw
    .prepare(
      `SELECT player_id AS playerId, position, throws, bats,
              birth_date AS birthDate, physique
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
      `SELECT e.batter_id AS playerId, g.game_date AS date, g.away_code AS away, g.home_code AS home,
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
): { byBatter: Map<string, MatchupRow[]>; byPitcher: Map<string, MatchupRow[]> } {
  const byBatter = new Map<string, MatchupRow[]>();
  const byPitcher = new Map<string, MatchupRow[]>();

  const push = (map: Map<string, MatchupRow[]>, key: string, row: MatchupRow): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [row]);
    else list.push(row);
  };

  for (const m of matchups(db, season, 1, competition, through)) {
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
function rosters(players: readonly PlayerPageData[]): TeamRoster[] {
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
function loadProbables(db: Db, season: number): ProbableRow[] {
  /**
   * ⚠**시즌으로 거른다.** 예고선발은 「다음 경기」의 정보라 언제나 현재 시즌 것이다.
   * 안 거르면 **2025년 화면에 2026년의 예고선발이 뜬다** — 실제로 그렇게 나왔다(2026-08-16).
   * 게다가 방어율까지 2026년 값이라, 지난 시즌을 보는 사람에게 통째로 거짓말이 된다.
   */
  const latest = db.raw
    .prepare("SELECT MAX(game_date) AS d FROM probable_pitcher WHERE game_date LIKE ?")
    .get(`${season}-%`) as { d: string | null };
  if (latest.d === null) return [];
  return db.raw
    .prepare(
      `SELECT game_date AS gameDate, team_code AS teamCode, opponent_code AS opponentCode,
              player_id AS playerId, venue, start_time AS startTime, league
       FROM probable_pitcher WHERE game_date = ?`,
    )
    .all(latest.d) as unknown as ProbableRow[];
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
): StartersPageData {
  if (rows.length === 0) return { gameDate: null, builtOn, games: [] };

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
            },
      // 상대 팀 타자만 남긴다 — 다른 팀 상대 기록은 오늘의 경기와 무관하다
      opponents: all.filter((m) => m.opponentTeam === opponentCode),
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
  return { gameDate: rows[0]!.gameDate, builtOn, games };
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

  return {
    season: o.season,
    asOf,
    pickDate: starters.gameDate,
    builtOn: o.builtOn,
    games,
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
const POSTSEASON = ["climaxSeries", "nipponSeries", "allStar"] as const;

/**
 * 그중 **경기 상세 페이지를 만드는** 대회.
 *
 * ⚠**올스타는 뺀다.** 경기 페이지의 알맹이는 득점기대치(RE)로 잰 「경기를 움직인 타석」인데,
 * RE는 **그 리그의 득점 환경**이고 올스타에는 그 리그가 없다(양 리그 선발이 맞붙는다).
 * 게다가 팀 코드가 `cl`/`pl`이라 리그를 고를 수도 없다 — 억지로 하나를 고르면
 * 그 화면의 모든 수가 근거 없는 기준으로 매겨진다. **못 만드는 것이 아니라 만들면 안 되는 것이다.**
 */
const POSTSEASON_PAGES = ["climaxSeries", "nipponSeries"] as const;

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
 * 구단 마스터에 없으므로 `shortNameOf`·`colorOf`가 예외를 던진다(그게 맞는 동작이다 — M7).
 * 그래서 화면에 낼 때만 여기서 갈라 준다. **구단인 척하지 않는다.**
 */
const SQUAD: Readonly<Record<string, string>> = { cl: "セ・リーグ", pl: "パ・リーグ" };
const squadName = (code: string): string => SQUAD[code] ?? shortNameOf(code);
const squadColor = (code: string): TeamColor => (SQUAD[code] === undefined ? colorOf(code) : NEUTRAL_COLOR);

const POSTSEASON_DETAIL: Readonly<Record<string, string>> = {
  climaxSeries:
    "各リーグの上位3球団が日本シリーズ進出を争うトーナメントです。" +
    "ファーストステージとファイナルステージをまとめて集計しています（当サイトは両者を区別する表記を持っていません）。",
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
function postseasonPage(db: Db, o: LoadOptions, gamePageIds: ReadonlySet<string>): PostseasonPageData {
  const through = o.through ?? "9999-12-31";
  const competitions: PostCompetition[] = [];

  for (const id of POSTSEASON) {
    const raw = dayResultsRange(db, o.season, id, through);
    if (raw.length === 0) continue;

    // 대회 안에서만 번호를 매긴다 — 「第3戦」은 그 대회의 세 번째다
    const games: PostGame[] = raw.map((g, i) => ({
      gameId: gameSlug(g.gameId),
      hasPage: gamePageIds.has(g.gameId),
      date: g.gameDate,
      venue: g.venue,
      gameNo: i + 1,
      away: { shortName: squadName(g.awayCode), color: squadColor(g.awayCode), runs: g.awayRuns },
      home: { shortName: squadName(g.homeCode), color: squadColor(g.homeCode), runs: g.homeRuns },
      winner:
        g.awayRuns === null || g.homeRuns === null || g.awayRuns === g.homeRuns
          ? null
          : g.awayRuns > g.homeRuns
            ? "away"
            : "home",
    }));

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
        // ⚠타수가 0이면 「.000」이 아니라 「없다」다(M11)
        avg: b.line.ab === 0 ? null : b.line.h / b.line.ab,
      }))
      // 출장 순. 같으면 이름으로 고정한다 — 빌드마다 순서가 흔들리면 diff 가 못 쓰게 된다
      .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name, "ja"));

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
        era: p.line.outs === 0 ? null : (p.line.er * 27) / p.line.outs,
      }))
      .sort((a, b) => b.outs - a.outs || a.name.localeCompare(b.name, "ja"));

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
  awayCode: string;
  homeCode: string;
  awayRuns: number | null;
  homeRuns: number | null;
}[] {
  const rows = db.raw
    .prepare(
      `SELECT game_id AS gameId, game_date AS gameDate, venue,
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
function teamPages(
  db: Db,
  o: LoadOptions,
  standings: readonly StandingsSection[],
  battingByPlayer: ReadonlyMap<string, BattingEntry>,
  pitchingByPlayer: ReadonlyMap<string, PitchingEntry>,
  bundleByLeague: ReadonlyMap<League, LeagueBundle>,
  asOf: string | null,
  hasPostseason: boolean,
  latestDate: string | null,
): TeamPageData[] {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";

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

      const batters: TeamBatter[] = [...battingByPlayer.values()]
        .filter((e) => e.player.teamCode === code && e.player.line.pa > 0)
        .map((e) => ({
          playerId: e.player.playerId,
          name: e.player.displayName,
          games: e.player.games,
          pa: e.player.line.pa,
          ab: e.player.line.ab,
          h: e.player.line.h,
          hr: e.player.line.hr,
          rbi: e.player.rbi,
          sb: e.player.sb,
          avg: e.avg,
          obp: e.obp,
          slg: e.slg,
          ops: e.ops,
          qualified:
            bundle !== undefined && e.player.line.pa >= qualifiedBatterPa(bundle.teamGames),
        }))
        .sort((a, b) => b.pa - a.pa || a.name.localeCompare(b.name, "ja"));

      const pitchers: TeamPitcher[] = [...pitchingByPlayer.values()]
        .filter((e) => e.player.teamCode === code && e.player.games > 0)
        .map((e) => ({
          playerId: e.player.playerId,
          name: e.player.displayName,
          role: e.player.role,
          games: e.player.games,
          outs: e.player.line.outs,
          w: e.player.decisions.w,
          l: e.player.decisions.l,
          sv: e.player.decisions.sv,
          hld: e.player.decisions.hld,
          so: e.player.line.so,
          era: e.era,
          whip: e.whip,
          qualified:
            bundle !== undefined && e.player.line.outs >= qualifyingOuts(bundle, e.player.role),
        }))
        .sort((a, b) => b.outs - a.outs || a.name.localeCompare(b.name, "ja"));

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
        recent,
        latestDate,
        hasPostseason,
      });
    }
  }
  return out;
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

  return {
    gameDate: latestDate,
    builtOn: o.builtOn,
    games,
    probableDate: starters.gameDate,
    probables,
    starRule: starRuleText(),
    starLimit: STAR_LIMIT,
    // 최신 경기일이 목록의 끝이므로 「다음 날」은 없다
    prev: at > 0 ? days[at - 1]!.date : null,
    dayCount: days.length,
  };
}

/**
 * 동률 처리 규칙의 문장. ⚠**화면에 적는다**(M3) — 규칙이 코드에만 있으면 아무도 검증할 수 없다.
 *
 * ⚠NPB 협약의 2단계(前年度順位)를 쓰지 않는 이유까지 적는다. 「우리 규칙이 다르다」를
 * 숨기면, 다른 사이트와 순위가 어긋났을 때 버그와 구별할 수 없다.
 */
const TIE_RULE =
  "勝率が同じ場合は当該球団間の対戦成績で上位を決めます。それでも並ぶときは同順位として表示します" +
  "（NPBの規定では次に前年度順位を使いますが、当サイトは2025年からのデータしか持たないため使えません）。";

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

// ─── 조립 ────────────────────────────────────────────────────────────────

export interface LoadOptions {
  season: number;
  competition?: string;
  through?: string;
  /** 사이트를 만든 날 `YYYY-MM-DD`(JST). **주입한다**(M6) */
  builtOn: string;
}

export interface SiteData {
  season: number;
  asOf: string | null;
  gameCount: number;
  players: PlayerPageData[];
  index: IndexPageData;
  ranking: RankingPageData;
  starters: StartersPageData;
  matchup: MatchupPageData;
  today: TodayPageData;
  /** 지난 경기일 화면. **최신 경기일은 빠져 있다** — 그 날은 `today.html`이 맡는다 */
  days: DayPageData[];
  dayIndex: DayIndexData;
  /** ポストシーズン. ⚠**정규시즌 집계와 섞지 않는다**(§2-1) */
  postseason: PostseasonPageData;
  /** 球団ページ. 순위표에서 팀명을 누르면 여기로 온다 */
  teams: TeamPageData[];
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
function loadCoverage(db: Db, season: number, competition: string, limit: number): CoverageDay[] {
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
    .all(season, competition, limit) as unknown as CoverageDay[];

  if (rows.length === 0) return [];

  /**
   * ⚠**행이 없는 날짜를 표에서 지우면 구멍이 안 보인다.**
   *
   * 이 표의 존재 이유가 「빠진 날 찾기」인데, DB에 행이 없는 날은 `GROUP BY`가
   * 애초에 만들지 않는다. 그러면 8/11 다음이 8/9로 이어져 **8/10이 조용히 사라진다** —
   * 월요일 휴장인지 수집 누락인지 화면이 답하지 못하게 된다.
   * 달력의 모든 날을 채워 넣고, 일정이 0건이면 0건이라고 말한다.
   */
  const newest = rows[0]!.date;
  const oldest = rows[rows.length - 1]!.date;
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: CoverageDay[] = [];
  for (let t = Date.parse(`${newest}T00:00:00Z`); t >= Date.parse(`${oldest}T00:00:00Z`); t -= 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, scheduled: 0, played: 0, notPlayed: 0, withPa: 0 });
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
    coverage: loadCoverage(db, o.season, competition, COVERAGE_DAYS),
    quarantine,
    runs: o.runLogPath === undefined ? [] : readRunLog(o.runLogPath, RUN_LOG_ROWS),
    archive,
    totals,
    politeness: POLITENESS,
  };
}

export function loadSite(db: Db, o: LoadOptions): SiteData {
  const competition = o.competition ?? "regular";
  const through = o.through ?? "9999-12-31";

  const meta = db.raw
    .prepare(
      `SELECT COUNT(*) AS games, MAX(game_date) AS latest FROM game
       WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?`,
    )
    .get(o.season, competition, through) as { games: number; latest: string | null };

  const agg = aggregateSeason(db, o.season, competition, through);
  const bundles = buildLeagues(agg);

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

  const rankingsByLeague = new Map<League, LeagueRankings>();
  const reByLeague = new Map<League, Map<string, number>>();
  // ⚠경기 페이지는 **행렬만이 아니라 `RunExpectancy` 자체**가 필요하다(`paValue`가 그걸 받는다).
  // 여기서 다시 만들지 않는다 — 같은 시즌을 두 번 훑는 것도, 값이 갈라지는 것도 피한다(M1)
  const reFull = new Map<string, RunExpectancy>();
  const srcByPlayer = new Map<string, { src: number; pa: number; skipped: number; srcPer600: number | null }>();
  // ⚠9이닝 환산의 분모는 **아웃**이다. 상대 타자 수(bf)는 표본 표기용이라 둘 다 들고 있어야 한다
  const srpByPlayer = new Map<string, { srp: number; bf: number; skipped: number; outs: number; srpPer9: number | null }>();
  // 화면이 쓰는 **시즌 합계**. 리그를 넘어도 한 줄이다
  const battingByPlayer = new Map<string, BattingEntry>();
  const pitchingByPlayer = new Map<string, PitchingEntry>();
  // ⚠**자격 판정(규정타석)에 쓰는 리그별 몫.** 타이틀은 소속 리그에서 낸 성적으로만 겨룬다 —
  // 합계 타석을 한쪽 리그 기준에 대면 자격이 없는 사람이 자격자가 된다. 키는 `선수|리그`
  const leagueBatting = new Map<string, BattingEntry>();
  const leaguePitching = new Map<string, PitchingEntry>();
  const bundleByLeague = new Map<League, LeagueBundle>();

  for (const bundle of bundles) {
    bundleByLeague.set(bundle.league, bundle);
    const codes = TEAMS.filter((t) => t.league === bundle.league).map((t) => t.code);
    // ⚠**RE 행렬도 `through`로 거른다.** 안 거르면 「7월 말 기준」 빌드에서
    // 득점기대치만 8월 데이터로 계산되어 같은 화면의 기준일이 갈린다
    const re = buildRunExpectancy(db, o.season, bundle.league, codes, competition, through);
    reByLeague.set(bundle.league, re.matrix);
    reFull.set(bundle.league, re);

    // ⚠**더하고 덮어쓰지 않는다.** SRC는 그 리그의 득점기대 행렬로 잰 **런 수**라 리그를 넘어도
    // 더하는 것이 맞다. 덮어쓰면 리그를 넘은 선수의 절반이 사라진다(2026-08-16 이중 검토 P0)
    for (const s of computeSrc(db, re, codes, competition, through)) {
      // 환산값은 합계가 정해진 뒤에 낸다(아래)
      srcByPlayer.set(s.playerId, { ...addSrc(srcByPlayer.get(s.playerId), s), srcPer600: null });
    }
    // ⚠투수는 같은 커널의 부호 반대다. 같은 리그 RE 행렬을 쓴다
    for (const s of computeSrp(db, re, codes, competition, through)) {
      srpByPlayer.set(s.playerId, { ...addSrp(srpByPlayer.get(s.playerId), s), srpPer9: null });
    }

    const bat = battingEntries(bundle);
    const pit = pitchingEntries(bundle);
    // ⚠**리그별 항목은 리그별 지도에 넣는다.** 예전에는 `playerId` 하나를 키로 덮어써서,
    // 리그를 넘어 이적한 선수는 **나중에 도는 리그가 이겼다** — 파→세 이적이면
    // 지금 뛰지 않는 옛 팀이 소속으로 나오고 현재 팀 로스터에서 사라졌다
    for (const e of bat) leagueBatting.set(`${e.player.playerId}|${bundle.league}`, e);
    for (const e of pit) leaguePitching.set(`${e.player.playerId}|${bundle.league}`, e);
    rankingsByLeague.set(bundle.league, buildLeagueRankings(bundle, bat, pit, srcByPlayer, srpByPlayer));
  }

  // ⚠**비율은 합계가 정해진 뒤에 낸다.** 리그별로 낸 환산값을 더하면 분모가 두 번 세어진다.
  // 환산식은 집계 패키지 한 벌을 쓴다(M1) — 여기서 다시 쓰면 언젠가 한쪽만 고쳐진다
  for (const [id, s] of srcByPlayer) srcByPlayer.set(id, { ...s, srcPer600: srcPer600Of(s.src, s.pa) });
  for (const [id, s] of srpByPlayer) srpByPlayer.set(id, { ...s, srpPer9: srpPer9Of(s.srp, s.outs) });

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
            qualified: (batPart?.player.line.pa ?? 0) >= qualifiedBatterPa(bundle.teamGames),
            needPa: qualifiedBatterPa(bundle.teamGames),
          };

    const pitchingData: PitchingBlockData | null =
      pit === undefined
        ? null
        : {
            games: pit.player.games,
            line: pit.player.line,
            // ⚠집계가 세어 둔 것을 그대로 쓴다 — 여기서 다시 세면 두 벌이 된다(M1)
            decisions: pit.player.decisions,
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
            qualified: (pitPart?.player.line.outs ?? 0) >= qualifyingOuts(bundle, pit.player.role),
            needOuts: qualifyingOuts(bundle, pit.player.role),
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
      season: o.season,
      teamCode: base.teamCode,
      teamName: team.name,
      league: base.league,
      leagueName: LEAGUE_NAME[base.league],
      color: colorOf(base.teamCode),
      position: profile?.position ?? null,
      throws: profile?.throws ?? null,
      bats: profile?.bats ?? null,
      birthDate: profile?.birthDate ?? null,
      physique: profile?.physique ?? null,
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
      sparkLabel: role === "pitcher" ? "月別防御率" : "月別OPS",
      asOf: meta.latest,
      stints: stintsOf(playerId, role),
    });

    /**
     * 검색 결과의 성적 한 줄.
     * ⚠**서식은 화면과 같은 함수로 만든다**(M1) — 여기서 손으로 반올림하면 값이 두 벌이 된다.
     * ⚠타자는 타율, 투수는 방어율. 역할 판정은 위에서 이미 한 것을 그대로 쓴다.
     */
    const summary =
      role === "pitcher"
        ? pit === undefined || pit.era.value === null
          ? null
          : `防御率 ${dec2(pit.era.value)}（${innings(pit.era.denominator)}回）`
        : bat === undefined || bat.avg.value === null
          ? null
          : `打率 ${avg3(bat.avg.value)}（${bat.avg.denominator}打数）`;
    search.push({
      i: playerId,
      n: base.displayName,
      t: team.name,
      ...(summary === null ? {} : { s: summary }),
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
    categories: categoriesOf(rankingsByLeague.get(bundle.league)!, RANKING_PAGE_ROWS),
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

  const startersData = startersPage(
    loadProbables(db, o.season),
    o.builtOn,
    pitchingByPlayer,
    matchupsByPlayer.byPitcher,
  );

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
  const postseasonData = postseasonPage(db, o, gamePageIds);

  return {
    season: o.season,
    asOf: meta.latest,
    gameCount: meta.games,
    players,
    search,
    index: {
      season: o.season,
      playerCount: players.length,
      gameCount: meta.games,
      asOf: meta.latest,
      teams: rosters(players),
      highlights,
    },
    ranking: {
      season: o.season,
      asOf: meta.latest,
      standings,
      tieRule: TIE_RULE,
      leagues: sections,
    },
    starters: startersData,
    matchup: matchupPage(o, meta.latest, startersData, battingByPlayer, pitchingByPlayer),
    today: todayPage(db, o, startersData, nameOf, gamePageIds, days),
    days: dayPages(db, o, days, latestDay, nameOf, gamePageIds),
    dayIndex: { season: o.season, latestDate: latestDay, days: [...days] },
    postseason: postseasonData,
    teams: teamPages(
      db,
      o,
      standings,
      battingByPlayer,
      pitchingByPlayer,
      bundleByLeague,
      meta.latest,
      postseasonData.competitions.length > 0,
      latestDay,
    ),
    games: [...gameList, ...postGameList],
  };
}
