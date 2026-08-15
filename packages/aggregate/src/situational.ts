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

/**
 * **SRP — 状況失点抑制 (Situational Run Prevention)** · 투수판 자체 지표
 *
 * 던진 타석마다 상대의 **득점기대치를 얼마나 억눌렀는가**를 재서 합산한다.
 * 타자의 SRC와 **정확히 같은 커널**을 쓰고 부호만 뒤집는다 —
 * 한 타석에서 타자가 얻은 것이 곧 투수가 내준 것이기 때문이다(M1).
 *
 * ```
 * SRP = −Σ (RE(타석 후) − RE(타석 전) + 그 타석의 실점)
 * ```
 *
 * 양수면 평균적인 상황 대비 **실점을 줄였다**는 뜻이고, 0이 평균이다.
 *
 * ## 무엇을 재고 무엇을 안 재는가 — **각주가 아니라 정의의 일부다**
 *
 * | 잰다 | 안 잰다 |
 * |---|---|
 * | 투구가 만든 득점기대치 변화 | **수비** — 타구 좌표가 공개되지 않아 입력이 없다. 실책성 안타도 투수에게 붙는다 |
 * | 상황(주자·아웃)의 가중 | **구종·구속** — 무료·약관 클린 소스가 없다 |
 * | | **포지션 보정·대체수준** — 그래서 WAR이 아니다 |
 *
 * ⚠**자책점과 「물려받은 주자」의 취급이 다르다.** 이 지표는 각 타석의 변화를
 * **그 타석을 던진 투수**에게만 붙인다. 주자를 남기고 내려간 투수는 「남겼다」는 상태까지만
 * 책임지고, 그 주자가 생환해도 그 실점은 **다음 투수의 기록**이 된다.
 * 자책점은 반대로 앞 투수에게 붙는다 — 어느 쪽이 옳다기보다 **다른 질문**이고,
 * 그래서 두 값이 어긋나는 것은 버그가 아니다.
 *
 * ⚠**RE 행렬은 리그·시즌마다 다르다.** 다른 리그의 행렬을 넣지 마라.
 */
export interface SrpEntry {
  playerId: string;
  displayName: string;
  /** 상황실점억제 합계. 평균 대비 **막아낸** 득점 */
  srp: number;
  /** 계산에 쓰인 상대 타자 수. **분모다**(M2) */
  bf: number;
  /** RE에 없는 상태라 계산하지 못한 타석 수. **숨기지 않는다** */
  skipped: number;
  /** 이 투수가 잡은 아웃 카운트. 9이닝 환산의 분모 */
  outs: number;
  /** 9이닝 환산. 아웃이 0이면 null */
  srpPer9: number | null;
}

const SRP_SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,
       e.pitcher_id AS pitcherId, p.display_name AS pitcherName
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = e.pitcher_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND e.status = 'final' AND e.pitcher_id IS NOT NULL
  AND (CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END) IN (SELECT code FROM league_team)
ORDER BY e.game_id, e.inning, e.half, e.seq
`;

/** 9이닝 환산에 쓸 아웃 수. **타석 로그에서 세지 않는다** — 투수표가 이미 정확히 갖고 있다 */
const SRP_OUTS_SQL = `
SELECT t.player_id AS pitcherId, SUM(t.outs) AS outs
FROM pitching_line t
JOIN game g ON g.game_id = t.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND (CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
GROUP BY t.player_id
`;

/**
 * 리그 1개의 투수별 SRP를 계산한다.
 *
 * ⚠**투수의 소속은 타격 쪽과 반대다.** `half='top'`은 원정팀이 치는 이닝이므로
 * 그때 던지는 투수는 **홈팀** 소속이다. 타자 SQL을 그대로 베끼면 리그가 뒤집힌다.
 */
export function computeSrp(
  db: Db,
  re: RunExpectancy,
  teamCodes: readonly string[],
  competition = "regular",
): SrpEntry[] {
  const { rows, outsRows } = withLeagueTeams(db, teamCodes, () => ({
    rows: db.raw.prepare(SRP_SQL).all(re.season, competition) as {
      gameId: string;
      inning: number;
      half: string;
      seq: number;
      bases: string;
      outs: number;
      runs: number;
      pitcherId: string;
      pitcherName: string;
    }[],
    outsRows: db.raw.prepare(SRP_OUTS_SQL).all(re.season, competition) as {
      pitcherId: string;
      outs: number;
    }[],
  }));

  const outsBy = new Map(outsRows.map((r) => [r.pitcherId, r.outs]));
  const acc = new Map<string, SrpEntry>();

  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    const sameHalf =
      next !== undefined &&
      next.gameId === cur.gameId &&
      next.inning === cur.inning &&
      next.half === cur.half;

    // ⚠**타자와 같은 커널을 쓴다.** 여기서 식을 새로 쓰면 두 지표가 서로 어긋난다(M1)
    const value = paValue(
      re,
      { bases: cur.bases, outs: cur.outs },
      sameHalf ? { bases: next.bases, outs: next.outs } : null,
      cur.runs,
    );

    let entry = acc.get(cur.pitcherId);
    if (entry === undefined) {
      entry = {
        playerId: cur.pitcherId,
        displayName: cur.pitcherName,
        srp: 0,
        bf: 0,
        skipped: 0,
        outs: outsBy.get(cur.pitcherId) ?? 0,
        srpPer9: null,
      };
      acc.set(cur.pitcherId, entry);
    }

    if (value === null) {
      // RE에 없는 상태. **0으로 때우지 않는다** — 때우면 그 타석이 조용히 플러스가 된다
      entry.skipped += 1;
      continue;
    }
    // ⚠부호를 뒤집는다. 타자가 얻은 것이 투수가 내준 것이다
    entry.srp -= value;
    entry.bf += 1;
  }

  for (const e of acc.values()) {
    e.srpPer9 = e.outs === 0 ? null : (e.srp * 27) / e.outs;
  }
  return [...acc.values()];
}

/** RE 행렬에 없는 상태를 미리 세어본다. 계산 전 건전성 확인용. */
export function missingStates(re: RunExpectancy, states: Iterable<{ bases: string; outs: number }>): number {
  let n = 0;
  for (const s of states) if (!re.matrix.has(stateKey(s.bases, s.outs))) n += 1;
  return n;
}
