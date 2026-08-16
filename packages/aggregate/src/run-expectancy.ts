/**
 * 득점기대치(RE) 행렬 — **우리 아카이브에서 직접 산출한다.**
 *
 * 24개 베이스-아웃 상태 각각에 대해, **그 상태에서 이닝이 끝날 때까지 평균 몇 점이 나는가**를 잰다.
 * 남의 리그(MLB) 값을 빌려오지 않는다 — NPB의 득점 환경은 다르고, 빌려온 값은 왜 그 값인지
 * 우리가 설명할 수 없다.
 *
 * ⚠**리그·시즌마다 따로 만든다.** 센트럴과 퍼시픽은 DH 유무만으로도 득점 환경이 다르다.
 */
import type { Db } from "@bb-app/store";

/** 베이스-아웃 상태 24종의 키. `bases|outs` */
export type StateKey = string;

export interface RunExpectancy {
  season: number;
  league: string;
  /** `bases|outs` → 평균 잔여 득점 */
  matrix: Map<StateKey, number>;
  /** 상태별 표본 수. **분모 없이는 이 행렬을 신뢰할 수 없다**(M2) */
  samples: Map<StateKey, number>;
  /** 관측된 상태 수. 24 미만이면 표본이 부족한 상태가 있다는 뜻이다 */
  observedStates: number;
  totalPa: number;
}

export function stateKey(bases: string, outs: number): StateKey {
  return `${bases === "" ? "-" : bases}|${outs}`;
}

/** 이론상 존재하는 24개 상태. 실제 관측과 대조하는 데 쓴다. */
export const ALL_STATES: readonly StateKey[] = (() => {
  const bases = ["-", "1", "2", "3", "12", "13", "23", "123"];
  const out: StateKey[] = [];
  for (const b of bases) for (const o of [0, 1, 2]) out.push(`${b}|${o}`);
  return out;
})();

const SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND e.status = 'final'
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
ORDER BY e.game_id, e.inning, e.half, e.seq
`;

/**
 * 리그 소속 판정을 SQL에 넣기 위한 임시 표. 구단 마스터는 코드에 있고 DB에는 없으므로
 * 조회할 때마다 만들어 붙인다 — **구단 목록이 두 곳에 생기지 않게 하려는 것**이다.
 */
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
 * 리그 1개의 RE 행렬을 만든다.
 *
 * @param teamCodes 이 리그의 구단 코드. 공격 팀이 이 목록에 있는 타석만 센다
 */
export function buildRunExpectancy(
  db: Db,
  season: number,
  league: string,
  teamCodes: readonly string[],
  competition = "regular",
  /**
   * ⚠**여기까지의 경기로만 만든다.** 안 거르면 「7월 말 기준」으로 만든 사이트의
   * 득점기대치만 8월 데이터로 계산되어, 같은 화면 안에서 기준일이 갈린다.
   */
  through = "9999-12-31",
): RunExpectancy {
  const rows = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(SQL).all(season, competition, through),
  ) as {
    gameId: string;
    inning: number;
    half: string;
    seq: number;
    bases: string;
    outs: number;
    runs: number;
  }[];

  const sum = new Map<StateKey, number>();
  const n = new Map<StateKey, number>();

  // 하프이닝 안에서 **뒤에서부터** 누적하면 「이 타석 이후 남은 득점」이 된다.
  let i = 0;
  while (i < rows.length) {
    let j = i;
    const head = rows[i]!;
    while (
      j < rows.length &&
      rows[j]!.gameId === head.gameId &&
      rows[j]!.inning === head.inning &&
      rows[j]!.half === head.half
    ) {
      j += 1;
    }

    let remaining = 0;
    for (let k = j - 1; k >= i; k -= 1) {
      const r = rows[k]!;
      remaining += r.runs;
      const key = stateKey(r.bases, r.outs);
      sum.set(key, (sum.get(key) ?? 0) + remaining);
      n.set(key, (n.get(key) ?? 0) + 1);
    }
    i = j;
  }

  const matrix = new Map<StateKey, number>();
  for (const [key, count] of n) matrix.set(key, sum.get(key)! / count);

  return {
    season,
    league,
    matrix,
    samples: n,
    observedStates: n.size,
    totalPa: rows.length,
  };
}

/**
 * 한 타석의 상황 가치 변화(RE24 계열).
 *
 * `Δ = RE(이후 상태) − RE(이전 상태) + 이 타석에서 난 득점`
 *
 * 이닝이 끝나면 이후 상태의 기대치는 0이다.
 * ⚠**RE에 없는 상태는 계산하지 않는다.** 임의로 0을 넣으면 그 타석이 조용히 큰 마이너스가 된다.
 */
export function paValue(
  re: RunExpectancy,
  before: { bases: string; outs: number },
  after: { bases: string; outs: number } | null,
  runsScored: number,
): number | null {
  const beforeRe = re.matrix.get(stateKey(before.bases, before.outs));
  if (beforeRe === undefined) return null;
  const afterRe = after === null ? 0 : re.matrix.get(stateKey(after.bases, after.outs));
  if (afterRe === undefined) return null;
  return afterRe - beforeRe + runsScored;
}
