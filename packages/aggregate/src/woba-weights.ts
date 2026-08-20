/**
 * **wOBA 선형가중치를 우리 아카이브에서 유도한다.**
 *
 * 선형가중치는 득점기대치(RE)에서 나온다 — 어떤 사건의 가치는
 * **그 사건이 일으킨 RE 변화 + 그 타석에서 들어온 점**의 평균이다.
 * 그리고 **RE 행렬은 이미 리그·시즌마다 만들고 있다**(`run-expectancy.ts`) —
 * SRC·SRP·번트가 그 위에 서 있다. 그래서 **남의 계수를 베낄 이유가 애초에 없다.**
 *
 * ```
 * RV(사건) = mean( RE(타석 후) − RE(타석 전) + 그 타석의 득점 )
 * 선형가중치(사건) = RV(사건) − RV(원점)
 * ```
 *
 * ## ⚠원점을 무엇으로 잡는가 — **그 선택이 곧 정의다**
 *
 * wOBA 는 분모(`打数 + 四球 − 敬遠 + 死球 + 犠飛`) 안의 사건을 두 갈래로 나눈다:
 * **계수가 붙는 것**(사사구·실책출루·안타)과 **0점을 받는 것**(삼진·범타·병살·야수선택·희생플라이…).
 * 뒤쪽에 0을 준다는 것은 「그 사건들의 평균 득점가치를 원점으로 삼는다」는 뜻이다.
 *
 * → 그래서 원점을 **「0점을 받는 사건 전체의 타석가중 평균 득점가치」**로 잡는다.
 *   이렇게 잡아야 항등식이 성립한다:
 *   **리그 전체에서 (그 타석의 득점가치 − 원점)을 다 더한 값 = wOBA 분자의 합.**
 *   원점을 다른 것(예: 삼진만 · 범타만)으로 잡으면 그 등식이 깨지고,
 *   깨진 만큼이 **아무 데도 안 적힌 채 계수 전체에 실린다.**
 *
 * ⚠**「아웃」이라고 부르지 않는 이유**: 0점을 받는 사건에는 **아웃이 아닌 것도 있다**
 * (`fieldersChoice`·`strikeoutReached` — 타자는 살아 있다). 그것들도 wOBA 가 0으로 세므로
 * 원점 계산에 들어가야 한다. 「아웃의 평균」이라고 적으면 그 순간 문장이 거짓이 된다.
 *
 * ## ⚠무엇이 이 값에 섞여 있는가 — 각주가 아니라 정의의 일부다
 *
 * `runs_scored` 와 RE 변화에는 **그 타석 중에 일어난 주루**(도루·폭투·보크)가 들어간다.
 * 우리 소스에는 주루 사건이 타석과 별도 행으로 없어서 **원리적으로 뺄 수 없다**
 * (같은 이유로 SRC 도 그것을 안고 있다 — `docs/metrics/README.md` §3.5).
 * → 즉 `bb` 계수에는 「볼넷 뒤 그 타석 안에서 주자가 뛴 몫」이 조금 섞인다.
 * ⚠**이 사실을 숨기지 않는다.** 규모는 정의서에 적었다.
 */
import type { Db } from "@bb-app/store";
import { isOutcome } from "@bb-app/parser";
import type { Outcome } from "@bb-app/parser";
import type { WobaWeights } from "@bb-app/metrics";
import { afterStateOf, paValue, withLeagueTeams } from "./run-expectancy.ts";
import type { RunExpectancy } from "./run-expectancy.ts";

/** wOBA 계수가 붙는 사건. `WobaWeights` 의 키와 같아야 한다 */
export type WobaEvent = keyof WobaWeights;

/**
 * 이 결과가 wOBA 안에서 어디에 서는가.
 *
 * - `weighted` … 계수가 붙는다(분모에도 들어간다)
 * - `zero` … 분모에는 들어가는데 계수가 0이다 → **원점을 만드는 쪽**
 * - `outside` … 분모 밖이다(敬遠·犠打·打妨出·走妨出·미상) → 유도에 안 쓴다
 *
 * ⚠**분모의 정의와 한 글자도 어긋나면 안 된다** — 정본은 `wobaDenominator()`(metrics/woba.ts)이고,
 * 「타수인가」는 `countsAsAtBat()`(parser/tokens.ts)이 판정한다. 시험이 셋의 일치를 못 박는다.
 * ⚠**새 `Outcome` 을 만들면 컴파일이 여기서 멈춘다** — 조용히 원점 쪽으로 떨어지면
 * 그 사건이 「0점짜리 아웃」으로 세어지고 아무도 모른다.
 */
export function wobaSlotOf(
  outcome: Outcome,
): { kind: "weighted"; event: WobaEvent } | { kind: "zero" } | { kind: "outside" } {
  switch (outcome) {
    // ⚠**`walk` 는 이미 고의사구를 뺀 값이다** — 파서가 `敬遠四` 를 따로 분류한다.
    case "walk": return { kind: "weighted", event: "bb" };
    case "hitByPitch": return { kind: "weighted", event: "hbp" };
    case "reachedOnError": return { kind: "weighted", event: "roe" };
    case "single": return { kind: "weighted", event: "single" };
    case "double": return { kind: "weighted", event: "double" };
    case "triple": return { kind: "weighted", event: "triple" };
    case "homerun": return { kind: "weighted", event: "hr" };

    // 분모에 있는데 계수가 0인 것들. **원점은 이 집합의 평균이다**
    case "strikeout":
    case "strikeoutReached":
    case "fieldedOut":
    case "groundedIntoDoublePlay":
    case "fieldersChoice":
    case "interferenceOut":
    case "ruleViolationOut":
    // ⚠**희생플라이는 분모에 들어간다**(`+ 犠飛`). 점이 들어오는 「이득 나는 아웃」이라
    //   원점을 끌어올리는 쪽인데, 그것이 정확히 wOBA 가 하는 근사다 — 빼면 항등식이 깨진다
    case "sacFly":
    case "sacFlyError":
      return { kind: "zero" };

    // 분모 밖 — 敬遠(빼진다) · 犠打 계열 · 방해 출루 · 미상
    case "intentionalWalk":
    case "sacBunt":
    case "sacBuntFieldersChoice":
    case "sacBuntError":
    case "interference":
    case "obstruction":
    case "unknown":
      return { kind: "outside" };
    default:
      return assertHandled(outcome);
  }
}

function assertHandled(outcome: never): never {
  throw new RangeError(`wobaSlotOf: 다루지 않은 결과 분류 ${JSON.stringify(outcome)}`);
}

export const WOBA_EVENTS: readonly WobaEvent[] = [
  "bb", "hbp", "roe", "single", "double", "triple", "hr",
];

/** 결과 분류 하나의 관측. **감사용** — 계수가 이상해 보일 때 여기부터 본다 */
export interface OutcomeRunValue {
  outcome: Outcome;
  slot: "weighted" | "zero" | "outside";
  /** 관측 수. **분모다**(M2) */
  n: number;
  /** 평균 득점가치(원점 이동 전) */
  mean: number;
}

export interface DerivedRunValues {
  season: number;
  league: string;
  /** 아웃 원점 이동 **후**의 득점가치. 이것을 `wobaWeightsFrom` 에 넣는다 */
  runValues: WobaWeights;
  /** 원점 이동 **전**의 평균 득점가치. 감사용 */
  meanValues: WobaWeights;
  /** 계수별 관측 수. **분모다**(M2) */
  samples: Record<WobaEvent, number>;
  /** 원점 — 「0점을 받는 사건」의 평균 득점가치 */
  origin: number;
  /** 원점의 표본 수 */
  originSamples: number;
  /** 이 유도가 쓴 타석 수(분모 안 + 분모 밖 전부, 값이 계산된 것만) */
  usedPa: number;
  /** 값을 계산하지 못한 타석. **숨기지 않는다**(M11) */
  skipped: number;
  /** DB 에 우리가 모르는 결과 문자열이 있었던 수. 0 이 아니면 어휘가 낡았다(M7) */
  unrecognized: number;
  /** RE 행렬이 본 타석 수. 유도 표본의 상한 */
  totalPa: number;
  /**
   * **결과 분류 전량**의 관측(계수가 안 붙는 것 포함). 많이 난 순.
   * ⚠계수가 이상해 보일 때 원점이 어디서 왔는지 여기서만 볼 수 있다.
   */
  byOutcome: OutcomeRunValue[];
}

const SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs, e.outcome AS outcome
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND e.status = 'final'
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
-- ⚠**RE 행렬을 만든 SQL 과 같은 행 집합·같은 정렬이어야 한다.** 어긋나면 「다음 행」이
-- 시간상 다음 타석이 아니게 되고, 그 순간 계수가 두 타석분의 변화를 한 사건에 싣는다.
ORDER BY e.game_id, e.seq
`;

/**
 * 리그 1개·시즌 1개의 선형가중치를 유도한다.
 *
 * @param re **같은 리그·시즌·같은 기준일**로 만든 RE 행렬. 다른 것을 넣지 마라
 *
 * @throws {RangeError} 원점이나 어느 계수의 표본이 0일 때.
 *   ⚠0으로 나눈 계수를 조용히 돌려주면 그 리그·시즌의 **전 타격 지표가 조용히 틀린다.**
 */
export function deriveRunValues(
  db: Db,
  re: RunExpectancy,
  teamCodes: readonly string[],
  competition = "regular",
  through = "9999-12-31",
  /**
   * ⚠**실책 출루(失策出塁)를 계수가 붙는 쪽으로 셀 것인가.**
   *
   * 기본은 `weighted` — 타자가 아웃이 아니고 득점기대치가 실제로 움직였으며,
   * 우리는 그 값을 **추측하지 않고 잰다**. `zero` 로 두면 「실책 출루는 아웃과 같은 값이다」를
   * 주장하는 셈인데 우리 실측이 그것을 부정한다(정의서 §3.1 「실책 출루」 참조).
   * 이 스위치는 **그 판단이 화면을 얼마나 움직이는지 재기 위한 것**이고
   * (`scripts/woba-weights-derive.ts --drop-roe`), 화면 경로는 기본값을 쓴다.
   */
  roe: "weighted" | "zero" = "weighted",
): DerivedRunValues {
  const rows = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(SQL).all(re.season, competition, through),
  ) as unknown as {
    gameId: string; inning: number; half: string; seq: number;
    bases: string; outs: number; runs: number; outcome: string;
  }[];

  const sum = new Map<string, number>();
  const n = new Map<string, number>();
  /** 결과 분류별 관측. **계수가 안 붙는 것도 전부 센다** — 원점의 출처를 볼 수 있게 */
  const perOutcome = new Map<Outcome, { n: number; sum: number }>();
  let originSum = 0;
  let originN = 0;
  let usedPa = 0;
  let skipped = 0;
  let unrecognized = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    // ⚠**중간 타석이 걸러졌으면 계산하지 않는다** — SRC·번트와 같은 커널이다(M1)
    const after = afterStateOf(cur, next);
    const v = after === null
      ? null
      : paValue(
        re,
        { bases: cur.bases, outs: cur.outs },
        after.use === "next" ? { bases: next!.bases, outs: next!.outs } : null,
        cur.runs,
      );
    if (v === null) { skipped += 1; continue; }
    usedPa += 1;

    // ⚠**모르는 문자열을 「아웃」으로 흘리지 않는다**(M11). 세어서 보고한다
    if (!isOutcome(cur.outcome)) { unrecognized += 1; continue; }
    const seen = perOutcome.get(cur.outcome) ?? { n: 0, sum: 0 };
    seen.n += 1;
    seen.sum += v;
    perOutcome.set(cur.outcome, seen);

    const raw = wobaSlotOf(cur.outcome);
    // ⚠**실책 출루를 원점 쪽으로 옮기는 것은 「아웃과 같은 값이다」라는 주장이다** — 스위치로만 한다
    const slot: typeof raw =
      raw.kind === "weighted" && raw.event === "roe" && roe === "zero" ? { kind: "zero" } : raw;
    if (slot.kind === "outside") continue;
    if (slot.kind === "zero") { originSum += v; originN += 1; continue; }
    sum.set(slot.event, (sum.get(slot.event) ?? 0) + v);
    n.set(slot.event, (n.get(slot.event) ?? 0) + 1);
  }

  const where = `(${re.season} ${re.league})`;
  if (originN === 0) throw new RangeError(`원점의 표본이 0이다 — 계수를 만들 수 없다 ${where}`);
  const origin = originSum / originN;

  const meanValues = {} as Record<WobaEvent, number>;
  const runValues = {} as Record<WobaEvent, number>;
  const samples = {} as Record<WobaEvent, number>;
  for (const e of WOBA_EVENTS) {
    // ⚠**실책 출루를 원점으로 옮겼으면 표본이 0인 것이 정상이다.** 계수는 0 — 아웃과 같은 값이라는 뜻
    if (e === "roe" && roe === "zero") {
      samples[e] = 0;
      meanValues[e] = origin;
      runValues[e] = 0;
      continue;
    }
    const count = n.get(e) ?? 0;
    if (count === 0) throw new RangeError(`${e} 의 표본이 0이다 — 계수를 만들 수 없다 ${where}`);
    samples[e] = count;
    meanValues[e] = sum.get(e)! / count;
    runValues[e] = meanValues[e] - origin;
  }

  const byOutcome: OutcomeRunValue[] = [...perOutcome.entries()]
    .map(([outcome, v]) => ({ outcome, slot: wobaSlotOf(outcome).kind, n: v.n, mean: v.sum / v.n }))
    .sort((a, b) => b.n - a.n);

  return {
    season: re.season,
    league: re.league,
    runValues,
    meanValues,
    samples,
    origin,
    originSamples: originN,
    usedPa,
    skipped,
    unrecognized,
    totalPa: re.totalPa,
    byOutcome,
  };
}
