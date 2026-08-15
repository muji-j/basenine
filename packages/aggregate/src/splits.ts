/**
 * 스플릿 집계 — 타석 이벤트를 조건별로 나눈다.
 *
 * ⚠**스플릿은 표본이 작다. 그게 이 도메인의 1급 함정이다**(M2).
 * 10타석 .400을 「좌투 상대 1위」로 보여주는 순간 이 서비스는 거짓말을 한다.
 * 그래서 모든 스플릿 결과가 **타석 수를 함께** 나른다.
 *
 * ⚠**투타 미상 선수는 좌우 스플릿에서 제외한다**(M11). 임의로 「우투우타」로 채우면
 * 스플릿이 조용히 틀린다 — 제외하고 몇 명인지 보고한다.
 */
import type { Db } from "@bb-app/store";
import { foldOutcomes } from "@bb-app/store";
import type { BattingLine } from "@bb-app/metrics";

/** 나눌 축. */
export type SplitDimension = "opponentHand" | "homeAway" | "baseState" | "month";

export interface SplitLine {
  /** 축 안의 구분값. `left`/`right` · `home`/`away` · `empty`/`onBase`/`scoring` · `2026-04` */
  key: string;
  line: BattingLine;
  rbi: number;
}

export interface PlayerSplits {
  playerId: string;
  displayName: string;
  splits: SplitLine[];
  /** 이 축으로 나눌 수 없었던 타석 수. **숨기지 않고 보고한다** */
  unclassified: number;
}

/**
 * 축별 SQL 식.
 *
 * ⚠`baseState`의 「득점권」은 **2루 또는 3루에 주자**가 있는 상태다. 정의를 코드에만 두지 않고
 * 여기 적어둔다 — 사이트마다 다르게 세는 값이라 대조할 때 반드시 문제가 된다.
 */
const KEY_EXPR: Readonly<Record<SplitDimension, string>> = {
  // 타자 기준 상대 투수의 던지는 손. 투타 미상이면 NULL이 되어 unclassified로 빠진다
  opponentHand: `pit.throws`,
  // 표(top)에서 치는 쪽이 원정이다
  homeAway: `CASE e.half WHEN 'top' THEN 'away' ELSE 'home' END`,
  baseState: `CASE
      WHEN e.bases = '' THEN 'empty'
      WHEN e.bases LIKE '%2%' OR e.bases LIKE '%3%' THEN 'scoring'
      ELSE 'onBase' END`,
  month: `substr(g.game_date, 1, 7)`,
};

const SQL = (dimension: SplitDimension): string => `
SELECT e.batter_id AS playerId,
       b.display_name AS displayName,
       ${KEY_EXPR[dimension]} AS splitKey,
       e.outcome AS outcome,
       COUNT(*) AS n,
       SUM(e.rbi) AS rbi
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
LEFT JOIN player pit ON pit.player_id = e.pitcher_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ? AND e.status = 'final'
GROUP BY e.batter_id, splitKey, e.outcome
`;

/**
 * 타자별 스플릿을 만든다.
 *
 * 읽기 비용: `pa_event`를 축마다 1회 스캔한다. 시즌 4.7만 행 × 4축 ≈ 19만 행 —
 * D1 일일 읽기 한도 500만의 3.8%다.
 */
export function battingSplits(
  db: Db,
  dimension: SplitDimension,
  season: number,
  competition = "regular",
  through = "9999-12-31",
): PlayerSplits[] {
  const rows = db.raw.prepare(SQL(dimension)).all(season, competition, through) as {
    playerId: string;
    displayName: string;
    splitKey: string | null;
    outcome: string;
    n: number;
    rbi: number;
  }[];

  const byPlayer = new Map<string, PlayerSplits>();
  const tallies = new Map<string, Map<string, { outcome: string; count: number; rbi: number }[]>>();

  for (const r of rows) {
    let player = byPlayer.get(r.playerId);
    if (player === undefined) {
      player = { playerId: r.playerId, displayName: r.displayName, splits: [], unclassified: 0 };
      byPlayer.set(r.playerId, player);
      tallies.set(r.playerId, new Map());
    }
    // ⚠분류할 수 없는 타석(상대 투수 투타 미상 등)은 **버리지 않고 센다.**
    if (r.splitKey === null) {
      player.unclassified += r.n;
      continue;
    }
    const perKey = tallies.get(r.playerId)!;
    const list = perKey.get(r.splitKey);
    if (list === undefined) perKey.set(r.splitKey, [{ outcome: r.outcome, count: r.n, rbi: r.rbi }]);
    else list.push({ outcome: r.outcome, count: r.n, rbi: r.rbi });
  }

  for (const [playerId, perKey] of tallies) {
    const player = byPlayer.get(playerId)!;
    for (const [key, list] of perKey) {
      const { line, rbi } = foldOutcomes(list);
      player.splits.push({ key, line, rbi });
    }
    player.splits.sort((a, b) => a.key.localeCompare(b.key));
  }

  return [...byPlayer.values()];
}

export interface Matchup {
  pitcherId: string;
  pitcherName: string;
  batterId: string;
  batterName: string;
  line: BattingLine;
  rbi: number;
}

/**
 * 투수 × 타자 상대전적.
 *
 * ⚠**표본이 대부분 10타석 미만이다.** 그래도 보여주되 **타석 수를 함께** 낸다 —
 * 이 지표는 분모 없이는 오독이 기본값이다.
 */
export function matchups(
  db: Db,
  season: number,
  minPa = 1,
  competition = "regular",
  through = "9999-12-31",
): Matchup[] {
  const rows = db.raw
    .prepare(`
      SELECT e.pitcher_id AS pitcherId, pp.display_name AS pitcherName,
             e.batter_id AS batterId, pb.display_name AS batterName,
             e.outcome AS outcome, COUNT(*) AS n, SUM(e.rbi) AS rbi
      FROM pa_event e
      JOIN game g ON g.game_id = e.game_id
      JOIN player pp ON pp.player_id = e.pitcher_id
      JOIN player pb ON pb.player_id = e.batter_id
      WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
        AND g.game_date <= ? AND e.status = 'final' AND e.pitcher_id IS NOT NULL
      GROUP BY e.pitcher_id, e.batter_id, e.outcome
    `)
    .all(season, competition, through) as {
    pitcherId: string;
    pitcherName: string;
    batterId: string;
    batterName: string;
    outcome: string;
    n: number;
    rbi: number;
  }[];

  const acc = new Map<string, { meta: Omit<Matchup, "line" | "rbi">; list: { outcome: string; count: number; rbi: number }[] }>();
  for (const r of rows) {
    const k = `${r.pitcherId}|${r.batterId}`;
    const cur = acc.get(k);
    const entry = { outcome: r.outcome, count: r.n, rbi: r.rbi };
    if (cur === undefined) {
      acc.set(k, {
        meta: {
          pitcherId: r.pitcherId, pitcherName: r.pitcherName,
          batterId: r.batterId, batterName: r.batterName,
        },
        list: [entry],
      });
    } else {
      cur.list.push(entry);
    }
  }

  const out: Matchup[] = [];
  for (const { meta, list } of acc.values()) {
    const { line, rbi } = foldOutcomes(list);
    if (line.pa < minPa) continue;
    out.push({ ...meta, line, rbi });
  }
  return out;
}
