/**
 * 시즌 집계.
 *
 * ⚠**집계 테이블을 저장하지 않는다.** 전부 원시(`batting_line`/`pitching_line`)에서
 * 재계산한다 — 파서를 고치거나 새 지표를 만들 때 다시 돌리면 되기 때문이다.
 *
 * ⚠**읽기 예산**: D1 무료는 하루 500만 「행 읽기」에서 차단되고, 이는 반환 행이 아니라
 * **쿼리가 스캔한 행**이다. 그래서 여기 쿼리는 시즌 1회 스캔으로 끝나도록 짠다.
 * 스캔량을 `readRows`로 함께 돌려주므로 예산을 눈으로 볼 수 있다.
 */
import type { Db } from "@bb-app/store";
import type { BattingLine, PitchingLine } from "@bb-app/metrics";
import { leagueOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";

export interface SeasonBatting {
  playerId: string;
  displayName: string;
  teamCode: string;
  league: League;
  games: number;
  /** 득점·타점·도루는 지표 산식의 입력이 아니라 표시용이라 line 밖에 둔다 */
  runs: number;
  rbi: number;
  sb: number;
  line: BattingLine;
}

export interface SeasonPitching {
  playerId: string;
  displayName: string;
  teamCode: string;
  league: League;
  games: number;
  line: PitchingLine;
}

export interface SeasonAggregate {
  season: number;
  batting: SeasonBatting[];
  pitching: SeasonPitching[];
  /** 팀별 소화 경기수. 규정타석 계산에 쓴다 */
  teamGames: Map<string, number>;
  /** 스캔한 행 수(개산). D1 읽기 예산 감시용 */
  readRows: number;
}

/**
 * 선수의 소속 구단은 `game`의 원정/홈 코드와 `side`로 정해진다.
 * ⚠**한 시즌에 이적하면 두 팀 행이 생긴다.** 지금은 **출장이 가장 많은 팀**을 소속으로 본다 —
 * 이 규칙을 코드에만 두지 않고 여기 적어둔다.
 */
const TEAM_EXPR = `CASE b.side WHEN 'away' THEN g.away_code ELSE g.home_code END`;

const BATTING_SQL = `
SELECT b.player_id AS playerId,
       p.display_name AS displayName,
       ${TEAM_EXPR} AS teamCode,
       COUNT(*) AS games,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.h) AS h,
       SUM(b.d2) AS d2, SUM(b.d3) AS d3, SUM(b.hr) AS hr,
       SUM(b.bb) AS bb, SUM(b.ibb) AS ibb, SUM(b.hbp) AS hbp,
       SUM(b.sf) AS sf, SUM(b.sh) AS sh, SUM(b.so) AS so, SUM(b.roe) AS roe,
       SUM(b.runs) AS runs, SUM(b.rbi) AS rbi, SUM(b.sb) AS sb
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
JOIN player p ON p.player_id = b.player_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY b.player_id, teamCode
`;

const PITCHING_SQL = `
SELECT t.player_id AS playerId,
       p.display_name AS displayName,
       CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END AS teamCode,
       COUNT(*) AS games,
       SUM(t.outs) AS outs, SUM(t.bf) AS bf, SUM(t.h) AS h, SUM(t.hr) AS hr,
       SUM(t.bb) AS bb, SUM(t.hbp) AS hbp, SUM(t.so) AS so,
       SUM(t.runs) AS runs, SUM(t.er) AS er
FROM pitching_line t
JOIN game g ON g.game_id = t.game_id
JOIN player p ON p.player_id = t.player_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY t.player_id, teamCode
`;

const TEAM_GAMES_SQL = `
SELECT away_code AS code, COUNT(*) AS n FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
GROUP BY away_code
UNION ALL
SELECT home_code AS code, COUNT(*) AS n FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
GROUP BY home_code
`;

const SCANNED_SQL = `
SELECT (SELECT COUNT(*) FROM batting_line) + (SELECT COUNT(*) FROM pitching_line) AS n
`;

/** SQL이 `(player_id, teamCode)`로 묶으므로 시즌 중 이적하면 한 선수가 복수 행이 된다. */
interface Keyed {
  playerId: string;
  displayName: string;
  teamCode: string;
  games: number;
}

/**
 * 이적 선수의 성적을 합산하고 **소속은 출장이 가장 많은 팀**으로 둔다.
 *
 * ⚠규칙을 코드에만 두지 않고 여기 적어둔다 — 시즌 중 이적은 매년 있고,
 * 어느 팀으로 셀지는 정답이 없는 선택이다.
 * @param sum 숫자 필드를 어떻게 더할지는 호출자가 안다(타자·투수 필드가 다르므로)
 */
function mergeByPlayer<T extends Keyed>(rows: readonly T[], sum: (a: T, b: T) => T): T[] {
  const primary = new Map<string, T>();
  for (const r of rows) {
    const cur = primary.get(r.playerId);
    if (cur === undefined || r.games > cur.games) primary.set(r.playerId, r);
  }
  const merged = new Map<string, T>();
  for (const r of rows) {
    const acc = merged.get(r.playerId);
    merged.set(r.playerId, acc === undefined ? r : sum(acc, r));
  }
  return [...merged.values()].map((r) => ({ ...r, teamCode: primary.get(r.playerId)!.teamCode }));
}

/**
 * @param through 이 경기일까지만 집계한다(`YYYY-MM-DD`). 기본값은 시즌 끝.
 *   ⚠**외부 공표값과 대조할 때 반드시 쓴다** — 상대의 기준일과 우리 아카이브 범위가
 *   하루만 달라도 「불일치」로 보이고, 그건 버그가 아니라 시점 차이다.
 */
export function aggregateSeason(
  db: Db,
  season: number,
  competition = "regular",
  through = "9999-12-31",
): SeasonAggregate {
  const batRows = db.raw.prepare(BATTING_SQL).all(season, competition, through) as Record<string, number | string>[];
  const pitRows = db.raw.prepare(PITCHING_SQL).all(season, competition, through) as Record<string, number | string>[];
  const teamRows = db.raw
    .prepare(TEAM_GAMES_SQL)
    .all(season, competition, through, season, competition, through) as { code: string; n: number }[];
  const scanned = db.raw.prepare(SCANNED_SQL).get() as { n: number };

  const teamGames = new Map<string, number>();
  for (const r of teamRows) teamGames.set(r.code, (teamGames.get(r.code) ?? 0) + r.n);

  const batting = mergeByPlayer(
    batRows.map((r) => ({
      playerId: String(r["playerId"]),
      displayName: String(r["displayName"]),
      teamCode: String(r["teamCode"]),
      games: Number(r["games"]),
      pa: Number(r["pa"]), ab: Number(r["ab"]), h: Number(r["h"]),
      d2: Number(r["d2"]), d3: Number(r["d3"]), hr: Number(r["hr"]),
      bb: Number(r["bb"]), ibb: Number(r["ibb"]), hbp: Number(r["hbp"]),
      sf: Number(r["sf"]), sh: Number(r["sh"]), so: Number(r["so"]), roe: Number(r["roe"]),
      runs: Number(r["runs"]), rbi: Number(r["rbi"]), sb: Number(r["sb"]),
    })),
    (a, b) => ({
      ...a,
      games: a.games + b.games,
      pa: a.pa + b.pa, ab: a.ab + b.ab, h: a.h + b.h,
      d2: a.d2 + b.d2, d3: a.d3 + b.d3, hr: a.hr + b.hr,
      bb: a.bb + b.bb, ibb: a.ibb + b.ibb, hbp: a.hbp + b.hbp,
      sf: a.sf + b.sf, sh: a.sh + b.sh, so: a.so + b.so, roe: a.roe + b.roe,
      runs: a.runs + b.runs, rbi: a.rbi + b.rbi, sb: a.sb + b.sb,
    }),
  ).map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    teamCode: r.teamCode,
    league: leagueOf(r.teamCode),
    games: r.games,
    runs: r.runs,
    rbi: r.rbi,
    sb: r.sb,
    line: {
      pa: r.pa, ab: r.ab, h: r.h, double: r.d2, triple: r.d3, hr: r.hr,
      bb: r.bb, ibb: r.ibb, hbp: r.hbp, sf: r.sf, sh: r.sh, so: r.so, roe: r.roe,
    } satisfies BattingLine,
  }));

  const pitching = mergeByPlayer(
    pitRows.map((r) => ({
      playerId: String(r["playerId"]),
      displayName: String(r["displayName"]),
      teamCode: String(r["teamCode"]),
      games: Number(r["games"]),
      outs: Number(r["outs"]), bf: Number(r["bf"]), h: Number(r["h"]), hr: Number(r["hr"]),
      bb: Number(r["bb"]), hbp: Number(r["hbp"]), so: Number(r["so"]),
      runs: Number(r["runs"]), er: Number(r["er"]),
    })),
    (a, b) => ({
      ...a,
      games: a.games + b.games,
      outs: a.outs + b.outs, bf: a.bf + b.bf, h: a.h + b.h, hr: a.hr + b.hr,
      bb: a.bb + b.bb, hbp: a.hbp + b.hbp, so: a.so + b.so,
      runs: a.runs + b.runs, er: a.er + b.er,
    }),
  ).map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    teamCode: r.teamCode,
    league: leagueOf(r.teamCode),
    games: r.games,
    line: {
      outs: r.outs, bf: r.bf, h: r.h, hr: r.hr, bb: r.bb,
      // 박스스코어 투수표에는 고의사구 컬럼이 없다. 0이 아니라 「없음」이지만
      // PitchingLine이 수를 요구하므로 0으로 두고, 이 사실을 정의서에 적는다.
      ibb: 0,
      hbp: r.hbp, so: r.so, er: r.er, r: r.runs,
    } satisfies PitchingLine,
  }));

  return { season, batting, pitching, teamGames, readRows: scanned.n };
}
