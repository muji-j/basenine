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
  /** 끝내기 하프이닝을 어떻게 다뤘는가. **행렬의 뜻이 이 값에 달려 있다** */
  walkoff: WalkoffMode;
  /**
   * 끝내기로 판정된 하프이닝 수.
   * ⚠**`include` 일 때도 센다** — 「몇 개가 섞여 있는가」를 모르면 판단할 수 없다(작업규칙 7).
   */
  walkoffHalves: number;
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

/**
 * **끝내기 하프이닝을 셀 것인가.**
 *
 * ⚠**끝내기는 규칙으로 끝난다** — 3아웃까지 가지 않는다. 그래서 그 하프이닝의 「남은 득점」은
 * **잘린 값**이고, 정상 이닝과 같이 세면 행렬이 치우친다. 그런데 치우침의 방향이 **하나가 아니다**:
 *   · **선택 효과(대부분)** — 끝내기 이닝은 「홈이 득점한 이닝」만 골라 담는다 → RE 를 **올린다**
 *   · **절단 효과(만루 계열)** — 이길 점수가 나는 순간 멈춘다 → RE 를 **내린다**
 *
 * 실측(2026-08-25 · 완결 8시즌 × 2리그 · 끝내기 **834개**):
 * 제외하면 상태-리그-시즌 **384개 중 내림 287 · 오름 70**. 최대 변화는 **2024 퍼시픽 `123|0` +0.0687**,
 * 2025 센트럴 `123|0` 은 **+0.0257** 이다.
 * ⚠**감사가 적은 것은 그 「오름」 쪽 하나뿐이라 방향이 반대로 읽힌다**(감사 P3 #7).
 *
 * ⚠**기본은 `exclude` 다**(사용자 결정 2026-08-25). 잘린 값과 골라 담긴 값을 섞지 않는다.
 * 바꾸기 전(`include`)과의 차이는 실측했다 — 완결 8시즌 · 16 리그-시즌 · 자격 타자 **418명**:
 * `|Δ wOBA|` 중앙 **0.0001** 최대 **0.0014** · `|Δ wRC+|` 중앙 **0.11** 최대 **0.69** ·
 * **1위가 바뀐 리그-시즌 0/16**. (비교: 1.02 의존을 끊었을 때는 중앙 **1.01** 최대 **10.00**)
 * ⚠**`include` 로 되돌리는 스위치는 남긴다** — `roe: "weighted" | "zero"` 와 같은 모양이고,
 * 「그 판단이 화면을 얼마나 움직이는지」를 **의견이 아니라 수로** 다시 답할 수 있어야 한다.
 *
 * ⚠**RE 행렬과 계수 유도는 반드시 같은 값을 써야 한다.** 한쪽만 제외하면
 * 잘린 타석이 잘리지 않은 행렬로 평가되어 계수가 조용히 어긋난다.
 */
export type WalkoffMode = "include" | "exclude";

/** 하프이닝 하나를 가리키는 키 */
export function halfKey(r: { gameId: string; inning: number; half: string }): string {
  return `${r.gameId}|${r.inning}|${r.half}`;
}

/** 끝내기 판정에 필요한 최소 필드. **두 곳이 같은 판정을 쓰게 하려고 여기 둔다**(M1) */
export interface HalfInningRow {
  gameId: string;
  inning: number;
  half: string;
  seq: number;
  homeRuns: number | null;
  awayRuns: number | null;
}

/**
 * **끝내기로 잘린 하프이닝**의 키 집합.
 *
 * 판정: 그 경기의 **마지막 하프이닝** · `half === "bottom"` · **홈 승리**.
 * ⚠**무승부는 끝내기가 아니다** — 동점으로 끝난 말 공격은 3아웃까지 갔다.
 * ⚠**득점을 모르면(NULL) 끝내기로 치지 않는다**(M11) — 「모른다」를 「그렇다」로 바꾸지 않는다.
 * ⚠**행은 `game_id, seq` 순으로 들어와야 한다** — 마지막 하프이닝을 seq 로 판정한다.
 */
export function walkoffHalves(rows: readonly HalfInningRow[]): ReadonlySet<string> {
  const lastSeq = new Map<string, number>();
  for (const r of rows) {
    const prev = lastSeq.get(r.gameId);
    if (prev === undefined || r.seq > prev) lastSeq.set(r.gameId, r.seq);
  }
  const out = new Set<string>();
  let i = 0;
  while (i < rows.length) {
    let j = i;
    const head = rows[i]!;
    while (
      j < rows.length && rows[j]!.gameId === head.gameId
      && rows[j]!.inning === head.inning && rows[j]!.half === head.half
    ) j += 1;
    if (
      head.half === "bottom" && rows[j - 1]!.seq === lastSeq.get(head.gameId)
      && head.homeRuns !== null && head.awayRuns !== null && head.homeRuns > head.awayRuns
    ) out.add(halfKey(head));
    i = j;
  }
  return out;
}

/**
 * 끝내기 하프이닝의 행을 걷어 낸다.
 *
 * ⚠**루프 앞에서 걸러야 한다.** 끝내기는 언제나 그 경기의 **마지막** 하프이닝이므로
 * 걸러도 남는 것은 「그 경기의 앞부분」이고, 바로 앞 타석의 「다음 행」은 **다음 경기의 첫 행**이 된다 —
 * `afterStateOf` 가 `gameId` 가 다르면 `zero`(이닝 끝)로 판정하므로 그대로 맞다.
 */
export function dropWalkoffHalves<T extends HalfInningRow>(rows: readonly T[]): T[] {
  const skip = walkoffHalves(rows);
  return rows.filter((r) => !skip.has(halfKey(r)));
}

const SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,
       g.home_runs AS homeRuns, g.away_runs AS awayRuns
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND e.status = 'final'
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
-- ⚠**시간 순은 seq 다.** half 열로 정렬하면 문자열이라 **bottom 이 top 보다 먼저** 온다 —
-- 한 이닝 안에서 말이 먼저 오는 순서가 되고, 「다음 행」이 시간상 다음 타석이 아니게 된다.
-- (하프 경계를 넘는 값을 쓰지는 않았으므로 지금까지 값은 맞았지만, seq 연속성으로 판정하려면
--  정렬 자체가 시간 순이어야 한다 — 2026-08-18)
ORDER BY e.game_id, e.seq
`;

/**
 * 리그 소속 판정을 SQL에 넣기 위한 임시 표. 구단 마스터는 코드에 있고 DB에는 없으므로
 * 조회할 때마다 만들어 붙인다 — **구단 목록이 두 곳에 생기지 않게 하려는 것**이다.
 */
export function withLeagueTeams<T>(db: Db, codes: readonly string[], fn: () => T): T {
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
  /** ⚠**계수 유도(`deriveRunValues`)는 이 값을 행렬에서 읽는다** — 인자로 따로 넘기지 않는다 */
  walkoff: WalkoffMode = "exclude",
): RunExpectancy {
  const all = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(SQL).all(season, competition, through),
  ) as {
    gameId: string;
    inning: number;
    half: string;
    seq: number;
    bases: string;
    outs: number;
    runs: number;
    homeRuns: number | null;
    awayRuns: number | null;
  }[];
  // ⚠**`include` 일 때도 센다** — 몇 개가 섞여 있는지 모르면 판단할 수 없다(작업규칙 7)
  const walkoffKeys = walkoffHalves(all);
  const rows = walkoff === "exclude" ? all.filter((r) => !walkoffKeys.has(halfKey(r))) : all;

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
    walkoff,
    walkoffHalves: walkoffKeys.size,
  };
}

/** 타석 하나를 가리키는 최소 정보. **인접 판정에만 쓴다** */
export interface PaCursor {
  gameId: string;
  inning: number;
  half: string;
  seq: number;
}

export interface AfterState {
  /** `next` 면 다음 행의 상태를, `zero` 면 0(이닝 종료)을 쓴다 */
  use: "next" | "zero";
}

/**
 * 다음 행을 **이 타석의 「이후 상태」로 써도 되는가**.
 *
 * - `{use:"next"}` … 바로 다음 타석의 상태를 쓴다
 * - `{use:"zero"}` … 하프이닝(또는 경기)이 끝났다 — 기대치 0
 * - `null` … **모른다.** 중간 타석이 걸러졌으므로 계산하지 않는다
 *
 * ⚠**같은 하프이닝인 것만으로는 부족하다**(2026-08-18 감사 P2).
 * 이후 상태를 `rows[i + 1]` 에서 읽는데, 그 SQL 들은 행을 **걸러낸 뒤** 정렬한다
 * (`pitcher_id IS NOT NULL` · `status='final'` · 선수 이너조인).
 * 중간 타석 하나가 걸러지면 `rows[i + 1]` 은 **그 다음다음 타석**이 되고,
 * `paValue` 가 **두 타석분의 RE 변화를 한 타석의 값으로** 계산한다.
 *
 * ⚠**값이 빠지는 게 아니라 남은 값이 틀린다** — 그래서 분모(타석 수)로도, 결측 카운터로도 안 드러난다.
 * 화면에는 그럴듯한 수가 나가고, RE 행렬이 오염되면 SRC·SRP·번트·경기 하이라이트가 **전부** 그 위에 얹힌다.
 *
 * ⚠**지금은 잠복 상태다**: 보유 시즌의 `pa_event` 496,481행에서 `pitcher_id IS NULL` **0건**이라
 * 아직 밟히지 않는다. 그러나 소급 시즌은 투수 귀속이 얇을 수 있고
 * (CLAUDE.md §2-2: 2016년 표본에서 34/88 = 39%), 백필이 그 창을 연다.
 *
 * ⚠**「하프이닝이 끝났다」와 「다음 타석이 걸러졌다」를 같게 다루면 안 된다.**
 * 전자의 이후 상태는 0 이고, 후자는 **알 수 없다.** 후자를 0 으로 두면
 * 그 타석이 조용히 큰 마이너스가 된다.
 *
 * ⚠**이 판정은 「호출부가 시간 순으로 읽는다」를 전제한다.** 그래서 SQL 들의 정렬을
 * `game_id, seq` 로 바로잡았다 — `half` 로 정렬하면 문자열이라 **bottom 이 top 보다 먼저** 온다.
 * ⚠**연속성은 「같은 하프이닝 안」에서만 묻는다**(2026-08-18 · 좁히기 전에 회귀를 만들었다).
 *   처음에는 하프가 바뀌는 자리에서도 seq 를 물었는데, **교류전에서 통째로 무너졌다**:
 *   리그별 조회는 상대 리그 팀이 공격한 하프이닝을 **통째로** 걸러내므로 seq 가 크게 튄다.
 *   그건 정상적인 이닝 종료인데 「중간이 걸러졌다」로 읽혀 **한 리그에서만 877타석이 미계산**이 됐다.
 *   → 하프가 바뀌면 그대로 「끝났다」로 본다. 위험한 것은 **하프 안의 구멍**이고 그건 그대로 잡는다.
 * ⚠**남는 위험을 적어 둔다**: 어느 하프의 **마지막 타석이** 걸러지면 그 앞 타석이
 *   「이닝이 끝났다」로 읽힌다. 그건 이 판정을 넣기 전과 같은 취급이고, 하프당 최대 1타석이다.
 *   완전히 막으려면 하프이닝의 실제 길이를 별도로 세야 하는데 그 비용이 이득보다 크다.
 *
 * `seq` 는 경기마다 1..N 으로 빈틈이 없다(실측 6,639경기 · 구멍 0건)이므로
 * **연속성 자체를 판정 근거로 쓸 수 있다.**
 */
export function afterStateOf(cur: PaCursor, next: PaCursor | undefined): AfterState | null {
  if (next === undefined || next.gameId !== cur.gameId) return { use: "zero" };
  const sameHalf = next.inning === cur.inning && next.half === cur.half;
  if (!sameHalf) return { use: "zero" };
  return next.seq === cur.seq + 1 ? { use: "next" } : null;
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
