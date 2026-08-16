/**
 * 번트의 득점기대값 · 타순 순회별 성적.
 *
 * ⚠**새 데이터가 0이다.** 득점기대값 계산기(`run-expectancy.ts`)와 타석 로그만 쓴다 —
 * 이미 있는 것을 화면으로 꺼내는 일이다.
 *
 * ⚠**「번트는 손해다」가 결론이 아니다.** 상황별로 갈리는 것이 결론이고, 화면이 그렇게 말해야 한다.
 * ⚠**득점기대값은 승리기대값이 아니다.** 동점 9회말에 1점만 필요하면 RE 손해여도 옳을 수 있다.
 *   우리는 승리기대값을 신뢰도 있게 만들 수 없으므로(상태당 중앙값 6타석) 거기까지만 말한다.
 */
import { paValue, stateKey, withLeagueTeams } from "./run-expectancy.ts";
import type { RunExpectancy } from "./run-expectancy.ts";
import type { Db } from "@bb-app/store";

export interface BuntSituation {
  /** 주자 상태(`1` `12` …)와 아웃 카운트 */
  bases: string;
  outs: number;
  /** 이 상황의 번트 수. **분모다**(M2) */
  n: number;
  /** 번트 직전의 평균 잔여 득점 */
  before: number;
  /** 득점기대값의 평균 변화. 음수면 RE 기준으로 손해다 */
  delta: number;
}

export interface TimesThrough {
  /** 1·2·3·4(4는 4순회 이상) */
  round: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  so: number;
}

/**
 * ⚠**타석 「이후」 상태는 컬럼에 없다.** 같은 하프이닝의 **다음 타석 행**에서 유도한다 —
 * SRC·SRP가 쓰는 것과 **같은 방식**이다(M1). 그래서 번트만 뽑지 않고 전 타석을 순서대로 읽는다.
 */
const BUNT_SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs, e.outcome AS outcome
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final'
  -- ⚠**공격 팀으로 거른다.** 안 거르면 리그마다 부르는 호출이 전 시즌 번트를 매번 다 세어
  -- **표본이 정확히 2배로 부풀고**, 파 리그의 번트가 센트럴 RE로 평가된다(2026-08-17 이중 검토 P0)
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
ORDER BY e.game_id, e.inning, e.half, e.seq
`;

/**
 * 상황별 번트의 득점기대값 변화.
 *
 * ⚠**RE에 없는 상태는 세지 않는다** — 임의로 0을 넣으면 그 번트가 조용히 큰 마이너스가 된다.
 * ⚠**표본이 작은 상황이 실재한다**(3루 1사 = 실측 6건). 분모를 반드시 함께 낸다.
 */
export function buntValues(
  db: Db,
  season: number,
  competition: string,
  through: string,
  re: RunExpectancy,
  /**
   * 이 리그의 구단 코드. ⚠**빠뜨리면 두 리그의 번트가 섞인다** —
   * 호출부가 리그마다 부르므로 필터가 없으면 같은 번트를 두 번 센다.
   */
  teamCodes: readonly string[],
): BuntSituation[] {
  const rows = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(BUNT_SQL).all(season, competition, through),
  ) as unknown as {
    gameId: string; inning: number; half: string; seq: number;
    bases: string; outs: number; runs: number; outcome: string;
  }[];

  const acc = new Map<string, { n: number; sum: number; bases: string; outs: number }>();
  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    if (cur.outcome !== "sacBunt") continue;
    const next = rows[i + 1];
    const sameHalf =
      next !== undefined && next.gameId === cur.gameId && next.inning === cur.inning && next.half === cur.half;
    // ⚠**SRC·SRP와 같은 커널을 쓴다**(M1). 여기서 식을 새로 쓰면 두 지표가 서로 어긋난다
    const v = paValue(
      re,
      { bases: cur.bases, outs: cur.outs },
      sameHalf ? { bases: next.bases, outs: next.outs } : null,
      cur.runs,
    );
    if (v === null) continue;
    const key = `${cur.bases}|${cur.outs}`;
    const e = acc.get(key) ?? { n: 0, sum: 0, bases: cur.bases, outs: cur.outs };
    e.n += 1;
    e.sum += v;
    acc.set(key, e);
  }

  return [...acc.values()]
    .map((e) => ({
      bases: e.bases,
      outs: e.outs,
      n: e.n,
      before: re.matrix.get(stateKey(e.bases, e.outs)) ?? 0,
      delta: e.sum / e.n,
    }))
    // 많이 대는 상황부터. 같으면 주자·아웃 순으로 고정한다(빌드마다 순서가 흔들리지 않게)
    .sort((a, b) => b.n - a.n || a.bases.localeCompare(b.bases) || a.outs - b.outs);
}

const TTO_SQL = `
SELECT e.pitcher_id AS pitcherId, e.batter_id AS batterId, e.game_id AS gameId, e.seq AS seq,
       e.outcome AS outcome
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final' AND e.pitcher_id IS NOT NULL
ORDER BY e.game_id, e.seq
`;

/**
 * 안타로 세는 결과.
 * ⚠**어휘를 추측하지 않는다.** `homerun` 은 소문자 r 이다(실측) — `homeRun` 으로 쓰면
 * 홈런이 안타에서도 타수에서도 조용히 빠진다.
 */
const HITS = new Set(["single", "double", "triple", "homerun"]);

/**
 * 타수에 들어가지 않는 결과.
 * ⚠**희생번트 계열이 셋이다**(`sacBunt` · `sacBuntError` · `sacBuntFieldersChoice`).
 * 하나만 적으면 타수가 부풀어 피타율이 낮게 나온다 — 실측으로 .216 대 .237의 차가 났다.
 */
const NOT_AB = new Set([
  // ⚠**주루방해(走妨出)는 타격방해와 다른 사건이다.** 둘 다 타수에 안 들어간다
  "walk", "intentionalWalk", "hitByPitch", "interference", "obstruction",
  "sacFly", "sacBunt", "sacBuntError", "sacBuntFieldersChoice",
]);

/**
 * 우리가 아는 결과 어휘 전부.
 * ⚠**모르는 값이 오면 멈춘다**(M7). 조용히 「타수도 안타도 아님」으로 흘리면
 * 새 어휘가 생긴 날 피타율이 서서히 틀려지고 아무도 눈치채지 못한다.
 */
const KNOWN = new Set([
  ...HITS, ...NOT_AB,
  "fieldedOut", "strikeout", "strikeoutReached", "groundedIntoDoublePlay",
  "reachedOnError", "fieldersChoice",
  // ⚠**수비방해 아웃은 `NOT_AB` 가 아니라 여기다.** 이름이 `interference` 와 비슷하지만
  // 타자가 아웃된 것이라 **타수에 들어간다**(박스 打数 실측으로 확정)
  "interferenceOut",
]);

/**
 * 타순 순회(times through the order)별 성적.
 *
 * 같은 경기에서 **같은 투수가 같은 타자를 몇 번째로 만나는가**를 센다. 추가 데이터 0.
 *
 * ⚠**생존자 편향을 함께 말해야 한다.** 3순회까지 가는 투수는 그날 잘 던진 투수라
 * 실제 패널티보다 성적이 **좋게** 나온다. 이 문장 없이 내면 오독된다.
 * ⚠**개인 순위를 매기지 않는다** — 개인의 3순회 표본은 얇다.
 */
export function timesThroughOrder(
  db: Db,
  season: number,
  competition: string,
  through: string,
): TimesThrough[] {
  const rows = db.raw.prepare(TTO_SQL).all(season, competition, through) as unknown as {
    pitcherId: string; batterId: string; gameId: string; outcome: string;
  }[];

  const seen = new Map<string, number>();
  const acc = new Map<number, TimesThrough>();
  for (const r of rows) {
    const key = `${r.gameId}|${r.pitcherId}|${r.batterId}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const round = Math.min(4, nth);
    const e = acc.get(round) ?? { round, pa: 0, ab: 0, h: 0, hr: 0, bb: 0, so: 0 };
    if (!KNOWN.has(r.outcome)) {
      throw new RangeError(`모르는 타석 결과 ${r.outcome} — 어휘가 늘었다. 타수 판정을 고쳐라`);
    }
    e.pa += 1;
    // ⚠**타석 로그의 결과로 센다.** 경기 단위 박스 합계를 쓰면 같은 값이 여러 번 더해진다
    if (!NOT_AB.has(r.outcome)) e.ab += 1;
    if (HITS.has(r.outcome)) e.h += 1;
    if (r.outcome === "homerun") e.hr += 1;
    if (r.outcome === "walk" || r.outcome === "intentionalWalk") e.bb += 1;
    if (r.outcome === "strikeout" || r.outcome === "strikeoutReached") e.so += 1;
    acc.set(round, e);
  }
  return [...acc.values()].sort((a, b) => a.round - b.round);
}
