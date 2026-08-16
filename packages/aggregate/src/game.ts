/**
 * 경기 한 판 — 「무슨 일이 있었나」를 우리 손으로 재구성한다.
 *
 * ## ⚠이 화면이 원본을 베끼지 않는 방법 (L2·L3·L6)
 *
 * 경기 페이지는 이 서비스에서 **원본에 가장 가까워지기 쉬운 화면**이다. 그래서 세 가지를 지킨다.
 *
 * 1. **이닝별 득점을 대조한다.** ⚠**「옮기지 않는다」고 쓰지 않는다** — 계산 구조상
 *    이 값은 라인스코어와 **항상 같은 수**가 된다(반이닝의 마지막 타석을 라인스코어로 닫으므로).
 *    우리가 실제로 하는 일은 **박스 페이지의 합계와 플레이 로그의 이닝별 값을 맞춰 보는 것**이고,
 *    어긋나면 화면이 그 사실을 먼저 말한다.
 *    (실측 2026-08-16: 1,487경기 전부 일치. 일치가 기본이지 보장은 아니다.)
 *    ⚠검증되지 않은 안전 주장을 문서에 두지 마라 — 나중에 그 문장을 근거로 판단하면 판단이 틀린다.
 * 2. **전 타석 중계 문장을 옮기지 않는다.** 그건 원본의 표현물이다. 우리는
 *    **득점이 난 타석**과 **경기를 움직인 타석**만 고르고, 고르는 기준은 우리가 정한다.
 * 3. **원본으로 가는 링크를 둔다**(L3). 대체하는 것이 아니라 가리킨다.
 *
 * ## ⚠0과 「치지 않았다」를 구별한다 (M11)
 *
 * 홈 팀이 앞서면 9회말을 치지 않는다. 실측(2026-08-16): **1,487경기 중 674경기**가 그렇다.
 * 거기에 `0`을 찍으면 야구를 아는 사람에게 **절반의 페이지가 고장으로 보인다.**
 * 그래서 `batted` 플래그를 들고 다니고, 화면은 그것을 `x`로 그린다.
 */
import type { Db } from "@bb-app/store";
import { paValue } from "./run-expectancy.ts";
import type { RunExpectancy } from "./run-expectancy.ts";

export interface HalfInning {
  inning: number;
  half: "top" | "bottom";
  /** 그 반이닝의 득점 */
  runs: number;
  /** ⚠**공격을 했는가.** false면 `0`이 아니라 `x`다(M11) */
  batted: boolean;
}

/** 한 타석. **화면에 낼 만큼만** 든다 */
export interface GamePlay {
  seq: number;
  inning: number;
  half: "top" | "bottom";
  outsBefore: number;
  /** `""` · `"1"` · `"12"` · `"123"` … */
  bases: string;
  batterId: string;
  pitcherId: string | null;
  /**
   * 박스스코어 표기(`左中２①`). ⚠**중계 문장(`左中間タイムリーツーベース`)은 쓰지 않는다** —
   * 그건 원본의 표현물이고, 기호 표기는 기록의 표준 표기다.
   */
  rawBox: string | null;
  rbi: number;
  runsScored: number;
  /**
   * 이 타석이 득점 기대치를 얼마나 움직였는가(RE24 계열).
   * ⚠**RE 행렬이 없거나 미관측 상태면 null**이다 — 0으로 때우지 않는다.
   * ⚠**선수의 실력이 아니라 그 타석의 상황 가치**다. SRC와 같은 주의가 붙는다.
   */
  swing: number | null;
  /** 이 타석이 끝난 시점의 점수 */
  awayScore: number;
  homeScore: number;
}

export interface GameDetail {
  gameId: string;
  gameDate: string;
  venue: string | null;
  /** 대회 표기 원문 */
  series: string | null;
  competition: string;
  awayCode: string;
  homeCode: string;
  awayRuns: number;
  homeRuns: number;
  awayHits: number | null;
  homeHits: number | null;
  awayErrors: number | null;
  homeErrors: number | null;
  /** 이닝 순. 연장이면 9를 넘는다 */
  innings: HalfInning[];
  /** 복원한 이닝별 득점의 합이 공표 득점과 맞는가. ⚠**어긋나면 화면이 말한다** */
  reconciles: boolean;
  /** 득점이 난 타석. 시간 순 */
  scoringPlays: GamePlay[];
  /** 득점 기대치를 크게 움직인 타석. **부호와 무관하게 절댓값 순** */
  keyPlays: GamePlay[];
  /** 승·패·세이브 투수 ID */
  winPitcher: string | null;
  losePitcher: string | null;
  savePitcher: string | null;
}

/** 「경기를 움직인 타석」으로 몇 개를 낼 것인가. **화면에도 이 수를 적는다** */
export const KEY_PLAY_LIMIT = 5;

const GAME_SQL = `
SELECT game_id AS gameId, game_date AS gameDate, venue, series, competition,
       away_code AS awayCode, home_code AS homeCode,
       away_runs AS awayRuns, home_runs AS homeRuns,
       away_hits AS awayHits, home_hits AS homeHits,
       away_errors AS awayErrors, home_errors AS homeErrors
FROM game
WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
  AND away_runs IS NOT NULL AND home_runs IS NOT NULL
ORDER BY game_id
`;

/** ⚠**seq 순으로 읽는다.** 순서가 흐트러지면 다음 타석의 상태를 「이후 상태」로 쓸 수 없다 */
const PA_SQL = `
SELECT e.game_id AS gameId, e.seq, e.inning, e.half, e.outs_before AS outsBefore,
       e.bases, e.batter_id AS batterId, e.pitcher_id AS pitcherId,
       e.raw_box AS rawBox, e.rbi, e.runs_scored AS runsScored
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.season = ? AND g.competition = ? AND g.status = 'played' AND g.game_date <= ?
  AND e.status = 'final'
ORDER BY e.game_id, e.seq
`;

const DECISION_SQL = `
SELECT pl.game_id AS gameId, pl.player_id AS playerId, pl.decision
FROM pitching_line pl
JOIN game g ON g.game_id = pl.game_id
WHERE g.season = ? AND g.competition = ? AND g.status = 'played' AND g.game_date <= ?
  AND pl.decision IS NOT NULL
`;

interface PaRow {
  gameId: string;
  seq: number;
  inning: number;
  half: "top" | "bottom";
  outsBefore: number;
  bases: string;
  batterId: string;
  pitcherId: string | null;
  rawBox: string | null;
  rbi: number;
  runsScored: number;
}

/**
 * 시즌 전 경기의 상세.
 *
 * ⚠**경기마다 질의하지 않는다.** 1,500경기 × 3질의면 왕복이 4,500회다.
 * 한 번에 읽어 코드에서 나눈다 — 타석 로그가 11만 행이라 메모리에 충분히 들어간다.
 *
 * @param reByLeague 리그별 득점기대치 행렬. 없는 리그는 `swing`이 전부 null이 된다
 * @param leagueOf 홈 팀 코드 → 리그. **어느 리그의 득점 환경으로 잴 것인가**를 정한다
 */
export function gameDetails(
  db: Db,
  season: number,
  reByLeague: ReadonlyMap<string, RunExpectancy>,
  leagueOf: (teamCode: string) => string,
  competition = "regular",
  through = "9999-12-31",
): Map<string, GameDetail> {
  const games = db.raw.prepare(GAME_SQL).all(season, competition, through) as unknown as {
    gameId: string;
    gameDate: string;
    venue: string | null;
    series: string | null;
    competition: string;
    awayCode: string;
    homeCode: string;
    awayRuns: number;
    homeRuns: number;
    awayHits: number | null;
    homeHits: number | null;
    awayErrors: number | null;
    homeErrors: number | null;
  }[];
  if (games.length === 0) return new Map();

  const pas = db.raw.prepare(PA_SQL).all(season, competition, through) as unknown as PaRow[];
  const decisions = db.raw.prepare(DECISION_SQL).all(season, competition, through) as unknown as {
    gameId: string;
    playerId: string;
    decision: string;
  }[];

  const byGame = new Map<string, PaRow[]>();
  for (const p of pas) {
    const list = byGame.get(p.gameId);
    if (list === undefined) byGame.set(p.gameId, [p]);
    else list.push(p);
  }

  const decisionOf = new Map<string, Map<string, string>>();
  for (const d of decisions) {
    let m = decisionOf.get(d.gameId);
    if (m === undefined) {
      m = new Map();
      decisionOf.set(d.gameId, m);
    }
    m.set(d.decision, d.playerId);
  }

  const out = new Map<string, GameDetail>();
  for (const g of games) {
    const rows = byGame.get(g.gameId) ?? [];
    // ⚠**홈 팀의 리그로 잰다.** 교류전에서 두 리그가 만나므로 하나를 정해야 하고,
    // 그 경기가 열린 구장의 리그(=홈 팀)가 득점 환경에 가깝다
    const re = reByLeague.get(leagueOf(g.homeCode));

    const plays: GamePlay[] = [];
    let awayScore = 0;
    let homeScore = 0;
    const runsOf = new Map<string, number>();

    for (let i = 0; i < rows.length; i += 1) {
      const cur = rows[i]!;
      const next = rows[i + 1];
      const sameHalf = next !== undefined && next.inning === cur.inning && next.half === cur.half;
      // ⚠**같은 커널을 쓴다**(M1). 여기서 식을 새로 쓰면 SRC와 값이 어긋난다
      const swing =
        re === undefined
          ? null
          : paValue(
              re,
              { bases: cur.bases, outs: cur.outsBefore },
              sameHalf ? { bases: next.bases, outs: next.outsBefore } : null,
              cur.runsScored,
            );

      if (cur.half === "top") awayScore += cur.runsScored;
      else homeScore += cur.runsScored;

      const key = `${cur.inning}|${cur.half}`;
      runsOf.set(key, (runsOf.get(key) ?? 0) + cur.runsScored);

      plays.push({
        seq: cur.seq,
        inning: cur.inning,
        half: cur.half,
        outsBefore: cur.outsBefore,
        bases: cur.bases,
        batterId: cur.batterId,
        pitcherId: cur.pitcherId,
        rawBox: cur.rawBox,
        rbi: cur.rbi,
        runsScored: cur.runsScored,
        swing,
        awayScore,
        homeScore,
      });
    }

    const lastInning = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.inning));
    const innings: HalfInning[] = [];
    for (let i = 1; i <= lastInning; i += 1) {
      for (const half of ["top", "bottom"] as const) {
        const key = `${i}|${half}`;
        innings.push({
          inning: i,
          half,
          runs: runsOf.get(key) ?? 0,
          // ⚠**타석이 하나도 없으면 「치지 않았다」다.** 0점과 다르다 —
          // 홈 팀이 앞선 채 9회를 맞으면 말 그대로 공격이 없다
          batted: runsOf.has(key),
        });
      }
    }

    const dm = decisionOf.get(g.gameId);
    out.set(g.gameId, {
      ...g,
      innings,
      // ⚠복원한 합계와 공표 득점을 매번 대조한다. 조용히 어긋나게 두지 않는다
      reconciles: awayScore === g.awayRuns && homeScore === g.homeRuns,
      scoringPlays: plays.filter((p) => p.runsScored > 0),
      keyPlays: plays
        .filter((p) => p.swing !== null)
        .sort((a, b) => Math.abs(b.swing!) - Math.abs(a.swing!))
        .slice(0, KEY_PLAY_LIMIT),
      winPitcher: dm?.get("○") ?? null,
      losePitcher: dm?.get("●") ?? null,
      savePitcher: dm?.get("S") ?? null,
    });
  }
  return out;
}
