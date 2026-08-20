import type { BattingLine, PitchingLine } from "./lines.ts";
import { WOBA_SCALE, WOBA_WEIGHTS, wobaRawWith, wobaWeightsFrom } from "./woba.ts";
import type { WobaWeights } from "./woba.ts";

/**
 * 리그 상수.
 *
 * ⚠**남의 값을 베끼지 않는다.** 계수는 리그·시즌마다 다르고, 우리 아카이브에서 산출하는 편이
 * 정확할 뿐 아니라 「원본의 재배열이 아니라 우리 산출물」이라는 위치(설계 스펙 §7 L2)에도 부합한다.
 * ⚠**wOBA 계수도 여기 들어온다**(2026-08-20). 예전에는 그것만 예외로 모듈 상수 1세트였다 —
 * 남의 공개값 한 벌을 9시즌에 돌려쓰고 있었다는 뜻이다.
 *
 * ⚠센트럴과 퍼시픽을 섞어 집계하지 마라. DH 유무만으로도 득점 환경이 다르다.
 */
export interface LeagueConstants {
  season: number;
  /** `central` | `pacific` */
  league: string;
  /** 리그 평균 wOBA. wRAA의 기준선 */
  averageWoba: number;
  /** FIP 상수. 리그 전체 FIP가 리그 ERA와 같아지게 만드는 값 */
  cFip: number;
  /** 리그 득점 / 타석. wRC+의 기준선 */
  runsPerPa: number;
  /**
   * 이 리그·시즌의 wOBA 계수. **화면에 나가는 wOBA 는 전부 이것으로 계산한다.**
   * `runValues` 를 안 주면 폴백(`WOBA_WEIGHTS`)이 그대로 들어온다.
   */
  wobaWeights: WobaWeights;
  /** 이 리그·시즌의 wOBAscale. wRAA 가 wOBA 차이를 득점으로 되돌릴 때 나눈다 */
  wobaScale: number;
}

const BATTING_KEYS = [
  "pa", "ab", "h", "double", "triple", "hr", "bb", "ibb", "hbp", "sf", "sh", "so", "roe",
] as const;

const PITCHING_KEYS = [
  "outs", "bf", "h", "hr", "bb", "ibb", "hbp", "so", "er", "r",
] as const;

/**
 * ⚠**키 목록이 타입과 어긋나면 여기서 컴파일이 멈춘다**(2026-08-18 감사 P3).
 *
 * 아래 두 함수는 `as unknown as` 로 타입 검사를 꺼 두었다. 그래서 `BattingLine` 에
 * 필드를 하나 더하고 이 목록에 안 적으면, 리그 합계에 그 필드가 **`undefined`** 로 들어가고
 * 거기에 수를 더하면 **`NaN`** 이 된다 — 그리고 아무것도 말하지 않는다.
 * 리그 상수는 wOBA·wRC+·FIP 의 기준선이라 그 하나가 **전 지표를 조용히 무너뜨린다.**
 *
 * ⚠**런타임 비용 0이다.** 타입만 계산한다 — 빠진 키가 있으면 `Exclude` 가 never 가 아니게 되어
 * 이 별칭 자체가 오류가 된다.
 */
type AssertNoMissing<T extends never> = T;
type _NoMissingBatting = AssertNoMissing<Exclude<keyof BattingLine, (typeof BATTING_KEYS)[number]>>;
type _NoMissingPitching = AssertNoMissing<Exclude<keyof PitchingLine, (typeof PITCHING_KEYS)[number]>>;

export function sumBatting(lines: readonly BattingLine[]): BattingLine {
  const out = Object.fromEntries(BATTING_KEYS.map((k) => [k, 0])) as unknown as BattingLine;
  for (const line of lines) for (const k of BATTING_KEYS) out[k] += line[k];
  return out;
}

export function sumPitching(lines: readonly PitchingLine[]): PitchingLine {
  const out = Object.fromEntries(PITCHING_KEYS.map((k) => [k, 0])) as unknown as PitchingLine;
  for (const line of lines) for (const k of PITCHING_KEYS) out[k] += line[k];
  return out;
}

/**
 * @throws {RangeError} 표본이 비어 상수를 만들 수 없을 때.
 * ⚠0으로 나눈 상수를 조용히 돌려주면 **그 시즌의 전 지표가 조용히 틀린다.**
 * 여기서 던지는 것이 침묵 오류보다 낫다.
 */
export function leagueConstants(args: {
  season: number;
  league: string;
  batting: BattingLine;
  pitching: PitchingLine;
  runs: number;
  /**
   * **득점 단위의 선형가중치**(아웃을 0으로 옮긴 뒤). 이 리그·시즌의 타석 로그에서 유도한다 —
   * `@bb-app/aggregate` 의 `deriveRunValues`.
   *
   * ⚠**안 주면 폴백 계수(`WOBA_WEIGHTS`)로 떨어진다.** 폴백은 리그·시즌을 모르는 값이라
   * 이 자리에서 조용히 쓰이면 화면이 「우리가 유도한 계수」라고 말하면서 아닌 값을 보이게 된다.
   * 그래서 **화면 경로는 반드시 준다**(`buildLeagues`). 안 주는 자리는 도구·단위 시험뿐이다.
   */
  runValues?: WobaWeights | undefined;
}): LeagueConstants {
  const { season, league, batting, pitching, runs, runValues } = args;
  if (batting.pa === 0) throw new RangeError(`리그 타석이 0이다 — 상수를 만들 수 없다 (${season} ${league})`);
  if (pitching.outs === 0) throw new RangeError(`리그 아웃이 0이다 — 상수를 만들 수 없다 (${season} ${league})`);

  const { weights, scale } =
    runValues === undefined
      ? { weights: WOBA_WEIGHTS as WobaWeights, scale: WOBA_SCALE }
      : wobaWeightsFrom(runValues, batting, `(${season} ${league})`);

  const averageWoba = wobaRawWith(batting, weights);
  if (averageWoba === null) throw new RangeError(`리그 wOBA 분모가 0이다 (${season} ${league})`);

  const leagueEra = (pitching.er * 27) / pitching.outs;
  const fipRaw =
    ((13 * pitching.hr + 3 * (pitching.bb + pitching.hbp) - 2 * pitching.so) * 3) / pitching.outs;

  return {
    season,
    league,
    averageWoba,
    cFip: leagueEra - fipRaw,
    runsPerPa: runs / batting.pa,
    wobaWeights: weights,
    wobaScale: scale,
  };
}
