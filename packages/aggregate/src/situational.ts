/**
 * **SRC — 状況得点貢献 (Situational Run Contribution)**
 *
 * 타석마다 그 팀의 **득점기대치를 얼마나 바꿨는가**를 재서 합산한다.
 * 단위는 **평균 대비 득점**이며, 승리(wins)로 환산하지 않는다.
 *
 * ```
 * SRC = Σ (RE(타석 후 상태) − RE(타석 전 상태) + 그 타석에서 난 득점)
 * ```
 *
 * ## 무엇을 재고 무엇을 안 재는가 — **각주가 아니라 정의의 일부다**
 *
 * | 잰다 | 안 잰다 |
 * |---|---|
 * | 타격이 만든 득점기대치 변화 | **수비** — 타구 좌표·존·타구속도가 공개되지 않아 입력 자체가 없다 |
 * | 상황(주자·아웃)의 가중 | **주루** — 도루·진루의 기여는 별도 지표로 다룬다 |
 * | | **포지션 보정·대체수준** — 그래서 WAR이 아니다 |
 *
 * ⚠**WAR이 아니며 WAR과 비교할 수 없다.** 이름을 다르게 쓰는 이유가 그것이다 —
 * 같은 이름에 다른 값이면 그건 거짓말이 된다.
 *
 * ⚠**RE 행렬은 리그·시즌마다 다르다.** 센트럴 타자의 SRC를 퍼시픽 RE로 계산하지 마라.
 */
import type { Db } from "@bb-app/store";
import type { RunExpectancy } from "./run-expectancy.ts";
import { paValue, stateKey } from "./run-expectancy.ts";

export interface SrcEntry {
  playerId: string;
  displayName: string;
  /** 상황득점공헌 합계. 평균 대비 득점 */
  src: number;
  /** 계산에 쓰인 타석 수. **분모다**(M2) */
  pa: number;
  /** RE에 없는 상태라 계산하지 못한 타석 수. **숨기지 않는다** */
  skipped: number;
  /** 600타석 환산. 표본이 다른 선수를 나란히 볼 때 쓴다 */
  srcPer600: number | null;
}

const SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,
       e.batter_id AS batterId, b.display_name AS batterName
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND e.status = 'final'
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
ORDER BY e.game_id, e.inning, e.half, e.seq
`;

function withLeagueTeams<T>(db: Db, codes: readonly string[], fn: () => T): T {
  db.raw.exec("CREATE TEMP TABLE IF NOT EXISTS league_team (code TEXT PRIMARY KEY)");
  db.raw.exec("DELETE FROM league_team");
  const stmt = db.raw.prepare("INSERT INTO league_team (code) VALUES (?)");
  for (const c of codes) stmt.run(c);
  try {
    return fn();
  } finally {
    db.raw.exec("DELETE FROM league_team");
  }
}

/**
 * 리그 1개의 타자별 SRC를 계산한다.
 *
 * @param re 같은 리그·시즌의 RE 행렬. **다른 리그의 행렬을 넣지 마라**
 */
export function computeSrc(
  db: Db,
  re: RunExpectancy,
  teamCodes: readonly string[],
  competition = "regular",
): SrcEntry[] {
  const rows = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(SQL).all(re.season, competition),
  ) as {
    gameId: string;
    inning: number;
    half: string;
    seq: number;
    bases: string;
    outs: number;
    runs: number;
    batterId: string;
    batterName: string;
  }[];

  const acc = new Map<string, SrcEntry>();

  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    const sameHalf =
      next !== undefined &&
      next.gameId === cur.gameId &&
      next.inning === cur.inning &&
      next.half === cur.half;

    const value = paValue(
      re,
      { bases: cur.bases, outs: cur.outs },
      sameHalf ? { bases: next.bases, outs: next.outs } : null,
      cur.runs,
    );

    let entry = acc.get(cur.batterId);
    if (entry === undefined) {
      entry = {
        playerId: cur.batterId,
        displayName: cur.batterName,
        src: 0,
        pa: 0,
        skipped: 0,
        srcPer600: null,
      };
      acc.set(cur.batterId, entry);
    }

    if (value === null) {
      // RE에 없는 상태. **0으로 때우지 않는다** — 때우면 그 타석이 조용히 마이너스가 된다.
      entry.skipped += 1;
      continue;
    }
    entry.src += value;
    entry.pa += 1;
  }

  for (const e of acc.values()) {
    e.srcPer600 = e.pa === 0 ? null : (e.src / e.pa) * 600;
  }
  return [...acc.values()];
}

/** RE 행렬에 없는 상태를 미리 세어본다. 계산 전 건전성 확인용. */
export function missingStates(re: RunExpectancy, states: Iterable<{ bases: string; outs: number }>): number {
  let n = 0;
  for (const s of states) if (!re.matrix.has(stateKey(s.bases, s.outs))) n += 1;
  return n;
}
