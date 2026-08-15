/**
 * DB → 화면 데이터.
 *
 * ⚠**여기가 유일한 DB 접점이다.** 렌더러는 DB를 모른다 — 그래야 픽스처만으로 화면을 테스트한다.
 * ⚠**지표를 여기서 다시 계산하지 않는다**(M1). `@bb-app/metrics` · `@bb-app/aggregate`가
 * 만든 값을 옮겨 담기만 한다. 여기에 산식이 생기는 순간 값이 두 벌이 된다.
 */
import type { Db } from "@bb-app/store";
import type { BattingLine, PitchingLine, Rate } from "@bb-app/metrics";
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
  walkRate,
  walksPer9,
} from "@bb-app/metrics";
import {
  ALL_STATES,
  aggregateSeason,
  battingEntries,
  battingSplits,
  buildLeagues,
  buildRunExpectancy,
  computeSrc,
  matchups,
  pitchingEntries,
  rankBatters,
  rankPitchers,
  stateKey,
} from "@bb-app/aggregate";
import type { BattingEntry, LeagueBundle, PitchingEntry, SplitDimension } from "@bb-app/aggregate";
import { TEAMS, colorOf, teamOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { countsAsHit } from "@bb-app/parser";
import type { Outcome } from "@bb-app/parser";
import { positionMark } from "./player-page.ts";
import type {
  BattingBlockData,
  MatchupRow,
  PitchingBlockData,
  PlayerPageData,
  RankingPanel,
  RankingRow,
  Ranks,
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
  ProbableGame,
  ProbableSide,
  RankingPageData,
  RosterEntry,
  SearchEntry,
  StartersPageData,
  TeamRoster,
} from "./pages.ts";
import type { RankDigits } from "./parts.ts";

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

const LEAGUE_NAME: Readonly<Record<League, string>> = {
  central: "セントラル・リーグ",
  pacific: "パシフィック・リーグ",
};

const SPLIT_AXES: readonly { id: SplitAxisId; dimension: SplitDimension; label: string }[] = [
  { id: "hand", dimension: "opponentHand", label: "対左右" },
  { id: "base", dimension: "baseState", label: "走者状況" },
  { id: "homeAway", dimension: "homeAway", label: "本拠地" },
  { id: "month", dimension: "month", label: "月別" },
];

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

/** `2026-04` → `4月` */
function monthLabel(key: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(key);
  return m === null ? key : `${Number(m[1])}月`;
}

function splitLabel(axis: SplitAxisId, key: string): string {
  return axis === "month" ? monthLabel(key) : (SPLIT_KEY_LABEL[key] ?? key);
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
  );
}

function batterQualifier(bundle: LeagueBundle): string {
  const need = qualifiedBatterPa(bundle.teamGames);
  return `規定打席 ${need}（チーム${bundle.teamGames}試合 × 3.1、小数切り上げ）に達した選手だけに順位がつきます。同率は同じ順位で、次の順位を飛ばします。`;
}

function pitcherQualifier(bundle: LeagueBundle): string {
  const need = qualifiedPitcherOuts(bundle.teamGames) / 3;
  return `規定投球回 ${need}回（チーム${bundle.teamGames}試合 × 1回）に達した投手だけに順位がつきます。同率は同じ順位で、次の順位を飛ばします。`;
}

interface LeagueRankings {
  league: League;
  batting: MetricRanking[];
  pitching: MetricRanking[];
}

function buildLeagueRankings(
  bundle: LeagueBundle,
  bat: readonly BattingEntry[],
  pit: readonly PitchingEntry[],
  srcByPlayer: Map<string, { src: number; pa: number }>,
): LeagueRankings {
  const bq = batterQualifier(bundle);
  const pq = pitcherQualifier(bundle);

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

  // ⚠투수 지표의 `Rate.denominator`는 **아웃 카운트**다. 이닝으로 바꿔 표기한다.
  const pitching: MetricRanking[] = [
    toMetricRanking("era", "防御率", 2, "投球回", pq, asRanked(rankPitchers(bundle, pit, (e) => e.era), pid), true),
    toMetricRanking("fip", "FIP", 2, "投球回", pq, asRanked(rankPitchers(bundle, pit, (e) => e.fip), pid), true),
    toMetricRanking("whip", "WHIP", 2, "投球回", pq, asRanked(rankPitchers(bundle, pit, (e) => e.whip), pid), true),
    countRanking(
      "so",
      "奪三振",
      "投球回",
      pit.map((e) => ({ ...pid(e), count: e.player.line.so, sample: e.player.line.outs })),
      true,
    ),
  ];

  return { league: bundle.league, batting, pitching };
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

function loadDecisions(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, { w: number; l: number; sv: number; hld: number }> {
  const rows = db.raw
    .prepare(
      `SELECT t.player_id AS playerId, t.decision AS decision, COUNT(*) AS n
       FROM pitching_line t
       JOIN game g ON g.game_id = t.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
         AND t.decision IS NOT NULL
       GROUP BY t.player_id, t.decision`,
    )
    .all(season, competition, through) as { playerId: string; decision: string; n: number }[];

  const out = new Map<string, { w: number; l: number; sv: number; hld: number }>();
  for (const r of rows) {
    const cur = out.get(r.playerId) ?? { w: 0, l: 0, sv: 0, hld: 0 };
    if (r.decision === "○") cur.w += r.n;
    else if (r.decision === "●") cur.l += r.n;
    else if (r.decision === "S") cur.sv += r.n;
    else if (r.decision === "H") cur.hld += r.n;
    out.set(r.playerId, cur);
  }
  return out;
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

function loadSplits(
  db: Db,
  season: number,
  competition: string,
  through: string,
): Map<string, SplitAxisData[]> {
  const out = new Map<string, SplitAxisData[]>();

  for (const axis of SPLIT_AXES) {
    for (const p of battingSplits(db, axis.dimension, season, competition, through)) {
      const rows: SplitRow[] = p.splits.map((s) => ({
        key: s.key,
        label: splitLabel(axis.id, s.key),
        line: s.line,
        rbi: s.rbi,
        ...derived(s.line),
      }));
      // ⚠**월별은 라벨이 아니라 키로 정렬한다.** 「10月」은 문자열 비교에서 「4月」보다 앞에 온다.
      rows.sort((a, b) => (axis.id === "month" ? a.key.localeCompare(b.key) : b.line.pa - a.line.pa));
      const entry: SplitAxisData = {
        id: axis.id,
        label: axis.label,
        rows,
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
      opponentTeam: (teamOf.get(m.pitcherId) ?? "").toUpperCase(),
      line: m.line,
      rbi: m.rbi,
      avg,
    });
    push(byPitcher, m.pitcherId, {
      opponentId: m.batterId,
      opponentName: m.batterName,
      opponentTeam: (teamOf.get(m.batterId) ?? "").toUpperCase(),
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

/** 명감 표기의 짧은 이름. 칩에 「福岡ソフトバンクホークス」를 넣으면 칩이 아니라 문단이 된다 */
const SHORT_NAME: Readonly<Record<string, string>> = {
  g: "巨人", t: "阪神", db: "DeNA", c: "広島", d: "中日", s: "ヤクルト",
  h: "ソフトバンク", f: "日本ハム", m: "ロッテ", l: "西武", e: "楽天", b: "オリックス",
};

/**
 * 구단별 선수 목록. **색인 화면은 서버가 그린다** —
 * 스크립트가 죽어도 전 선수에게 도달할 수 있어야 하고, 그게 §0-1(3클릭)의 최저선이다.
 */
function rosters(players: readonly PlayerPageData[]): TeamRoster[] {
  const byTeam = new Map<string, RosterEntry[]>();
  for (const p of players) {
    const mark = positionMark(p.position);
    const list = byTeam.get(p.teamCode);
    const entry: RosterEntry = { playerId: p.playerId, name: p.name, mark };
    if (list === undefined) byTeam.set(p.teamCode, [entry]);
    else list.push(entry);
  }

  // 구단 순서는 마스터 순서를 따른다 — 선수 수로 정렬하면 매일 순서가 바뀐다
  return TEAMS.filter((t) => byTeam.has(t.code)).map((t) => ({
    code: t.code,
    name: t.name,
    shortName: SHORT_NAME[t.code] ?? t.name,
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
function loadProbables(db: Db): ProbableRow[] {
  const latest = db.raw.prepare("SELECT MAX(game_date) AS d FROM probable_pitcher").get() as {
    d: string | null;
  };
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
      shortName: SHORT_NAME[r.teamCode] ?? team.name,
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
      opponents: all.filter((m) => m.opponentTeam === opponentCode.toUpperCase()),
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
  search: SearchEntry[];
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
  const decisions = loadDecisions(db, o.season, competition, through);
  const splitsByPlayer = loadSplits(db, o.season, competition, through);
  const scorebookByPlayer = loadScorebook(db, o.season, competition, through);
  const statePaByPlayer = loadStatePa(db, o.season, competition, through);
  const monthlyEra = loadMonthlyEra(db, o.season, competition, through);

  // 상대 선수의 소속 구단은 시즌 집계에서 온다 — 이름 문자열로 조인하지 않는다(M10)
  const teamOfPlayer = new Map<string, string>();
  for (const b of agg.batting) teamOfPlayer.set(b.playerId, b.teamCode);
  for (const p of agg.pitching) if (!teamOfPlayer.has(p.playerId)) teamOfPlayer.set(p.playerId, p.teamCode);
  const matchupsByPlayer = loadMatchups(db, o.season, competition, through, teamOfPlayer);

  const rankingsByLeague = new Map<League, LeagueRankings>();
  const reByLeague = new Map<League, Map<string, number>>();
  const srcByPlayer = new Map<string, { src: number; pa: number; skipped: number; srcPer600: number | null }>();
  const battingByPlayer = new Map<string, BattingEntry>();
  const pitchingByPlayer = new Map<string, PitchingEntry>();
  const bundleByLeague = new Map<League, LeagueBundle>();

  for (const bundle of bundles) {
    bundleByLeague.set(bundle.league, bundle);
    const codes = TEAMS.filter((t) => t.league === bundle.league).map((t) => t.code);
    const re = buildRunExpectancy(db, o.season, bundle.league, codes, competition);
    reByLeague.set(bundle.league, re.matrix);

    for (const s of computeSrc(db, re, codes, competition)) {
      srcByPlayer.set(s.playerId, { src: s.src, pa: s.pa, skipped: s.skipped, srcPer600: s.srcPer600 });
    }

    const bat = battingEntries(bundle);
    const pit = pitchingEntries(bundle);
    for (const e of bat) battingByPlayer.set(e.player.playerId, e);
    for (const e of pit) pitchingByPlayer.set(e.player.playerId, e);
    rankingsByLeague.set(bundle.league, buildLeagueRankings(bundle, bat, pit, srcByPlayer));
  }

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
            qualified: bat.player.line.pa >= qualifiedBatterPa(bundle.teamGames),
            needPa: qualifiedBatterPa(bundle.teamGames),
          };

    const pitchingData: PitchingBlockData | null =
      pit === undefined
        ? null
        : {
            games: pit.player.games,
            line: pit.player.line,
            decisions: decisions.get(playerId) ?? { w: 0, l: 0, sv: 0, hld: 0 },
            era: pit.era,
            whip: pit.whip,
            fip: pit.fip,
            k9: strikeoutsPer9(pit.player.line),
            bb9: walksPer9(pit.player.line),
            hr9: homeRunsPer9(pit.player.line),
            ranks: ranksFor(rankings.pitching, playerId),
            qualified: pit.player.line.outs >= qualifiedPitcherOuts(bundle.teamGames),
            needOuts: qualifiedPitcherOuts(bundle.teamGames),
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

    const splits = role === "pitcher" ? [] : (splitsByPlayer.get(playerId) ?? []);
    const opponents =
      role === "pitcher"
        ? (matchupsByPlayer.byPitcher.get(playerId) ?? [])
        : (matchupsByPlayer.byBatter.get(playerId) ?? []);

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
      ranking: panelsForPlayer(role === "pitcher" ? rankings.pitching : rankings.batting, playerId),
      spark,
      sparkLabel: role === "pitcher" ? "月別防御率" : "月別OPS",
      asOf: meta.latest,
    });

    search.push({ i: playerId, n: base.displayName, t: team.name });
  }

  players.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  search.sort((a, b) => a.n.localeCompare(b.n, "ja"));

  const sections: LeagueSection[] = bundles.map((bundle) => {
    const r = rankingsByLeague.get(bundle.league)!;
    return {
      id: bundle.league,
      name: LEAGUE_NAME[bundle.league],
      panels: [...panelsForPage(r.batting, RANKING_PAGE_ROWS), ...panelsForPage(r.pitching, RANKING_PAGE_ROWS)],
    };
  });

  const highlights: LeagueSection[] = bundles.map((bundle) => {
    const r = rankingsByLeague.get(bundle.league)!;
    const wrc = r.batting.find((m) => m.id === "wrcPlus");
    const era = r.pitching.find((m) => m.id === "era");
    return {
      id: bundle.league,
      name: LEAGUE_NAME[bundle.league],
      panels: [
        ...(wrc === undefined ? [] : panelsForPage([wrc], 5)),
        ...(era === undefined ? [] : panelsForPage([era], 5)),
      ],
    };
  });

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
    ranking: { season: o.season, asOf: meta.latest, leagues: sections },
    starters: startersPage(loadProbables(db), o.builtOn, pitchingByPlayer, matchupsByPlayer.byPitcher),
  };
}
