import type { Rate } from "./rate.ts";
import { singles } from "./lines.ts";
import type { BattingLine } from "./lines.ts";
import { onBasePercentage } from "./batting.ts";

/**
 * wOBA 계수.
 *
 * ```
 * wOBA = {w_bb×(四球−故意四球) + w_hbp×死球 + w_roe×失策出塁 + w_1×単打
 *         + w_2×二塁打 + w_3×三塁打 + w_hr×本塁打}
 *        ÷ (打数 + 四球 − 故意四球 + 死球 + 犠飛)
 * ```
 *
 * ⚠**계수는 리그·시즌마다 다르다.** 정본은 `LeagueConstants.wobaWeights` 이고,
 * 그것은 **우리 아카이브의 득점기대치(RE) 행렬에서 유도한다**
 * (`@bb-app/aggregate` 의 `deriveRunValues` → `wobaWeightsFrom`).
 * 유도 방법과 원점 선택은 `docs/metrics/README.md` §3.1 에 적었다.
 */
export interface WobaWeights {
  readonly bb: number;
  readonly hbp: number;
  readonly roe: number;
  readonly single: number;
  readonly double: number;
  readonly triple: number;
  readonly hr: number;
}

/**
 * **리그 문맥이 없을 때만 쓰는 폴백 계수.**
 *
 * ⚠**화면에 나가는 값은 이것이 아니다** — 화면은 `LeagueConstants.wobaWeights`(리그×시즌 유도값)를
 * 쓴다. 이 상수는 **리그 집계가 없는 자리**(단위 시험·고정 픽스처)를 위해서만 존재한다.
 *
 * 값의 출처: **우리 아카이브 9시즌(2018~2026) · 정규시즌 · 양 리그·전 시즌을 하나로 접어**
 * 같은 절차로 유도한 것이다(기준일 2026-08-20 · 원점 표본 367,988).
 * 다시 내는 명령: `node scripts/woba-weights-derive.ts data/bb.sqlite --pooled`
 *
 * ⚠**남의 값이 아니다.** 예전에는 이 자리가 외부 사이트가 공개한 1세트였고
 * 그 의존을 **끊기로 정했다**(사용자 결정 2026-08-20 · `docs/metrics/README.md` §6-C).
 *
 * ⚠**보유 시즌이 늘면 이 수도 바뀐다.** 폴백은 「전 아카이브의 평균」이라 정의상 그렇다 —
 * 백필할 때 다시 뽑아라. 화면은 이 상수를 안 쓰므로 화면이 낡지는 않는다.
 */
export const WOBA_WEIGHTS = {
  bb: 0.694,
  hbp: 0.717,
  roe: 0.919,
  single: 0.875,
  double: 1.322,
  triple: 1.815,
  hr: 2.179,
} as const satisfies WobaWeights;

/**
 * wOBA를 득점 단위로 되돌리기 위한 제수(wOBAscale). **폴백 값**이다 —
 * 정본은 `LeagueConstants.wobaScale` 이고 리그·시즌마다 유도한다.
 * 위 계수와 **같은 유도에서 나온 짝**이다. 한쪽만 갈아 끼우면 wRAA 의 단위가 어긋난다.
 */
export const WOBA_SCALE = 1.328;

export function wobaDenominator(line: BattingLine): number {
  return line.ab + (line.bb - line.ibb) + line.hbp + line.sf;
}

/** 계수를 곱해 더한 분자. **분모로 나누기 전의 값** */
export function wobaNumerator(line: BattingLine, w: WobaWeights): number {
  return (
    w.bb * (line.bb - line.ibb) +
    w.hbp * line.hbp +
    w.roe * line.roe +
    w.single * singles(line) +
    w.double * line.double +
    w.triple * line.triple +
    w.hr * line.hr
  );
}

/**
 * 분모가 0이면 null.
 * 리그 상수 산출(`league.ts`)이 `Rate` 껍데기 없이 쓰기 위해 원시값을 노출한다.
 */
export function wobaRawWith(line: BattingLine, w: WobaWeights): number | null {
  const denominator = wobaDenominator(line);
  if (denominator === 0) return null;
  return wobaNumerator(line, w) / denominator;
}

/** ⚠**폴백 계수로 계산한다.** 리그 문맥이 있으면 `wobaRawWith(line, lc.wobaWeights)` 를 써라 */
export function wobaRaw(line: BattingLine): number | null {
  return wobaRawWith(line, WOBA_WEIGHTS);
}

export function wobaWith(line: BattingLine, w: WobaWeights): Rate {
  return { value: wobaRawWith(line, w), denominator: wobaDenominator(line) };
}

/** ⚠**폴백 계수로 계산한다.** 리그 문맥이 있으면 `wobaWith(line, lc.wobaWeights)` 를 써라 */
export function woba(line: BattingLine): Rate {
  return wobaWith(line, WOBA_WEIGHTS);
}

/**
 * **득점 단위의 선형가중치 → 출루율 눈금의 wOBA 계수.**
 *
 * `runValues` 는 「그 사건이 평균적으로 몇 점을 만들었는가(아웃을 0으로 옮긴 뒤)」이고
 * 단위가 **득점**이라, 그대로 쓰면 출루율과 같은 눈금으로 읽을 수 없다.
 * 그래서 **리그 wOBA 가 리그 출루율과 정확히 같아지는 배수**를 구해 곱한다 —
 * 그것이 wOBAscale 이다.
 *
 * ```
 * scale = 리그출루율 × wOBA분모 ÷ Σ(runValue × 사건수)
 * ```
 *
 * ⚠**이 성질이 곧 정의다**: `wobaRawWith(leagueLine, weights) === onBasePercentage(leagueLine)`.
 * 시험이 그것을 못 박는다.
 *
 * ⚠**표본이 비면 던진다.** 0으로 나눈 계수를 조용히 돌려주면 그 리그·시즌의
 * **전 타격 지표가 조용히 틀린다**(`league.ts` 와 같은 규약).
 *
 * @throws {RangeError} 분모·분자가 0이거나 출루율을 만들 수 없을 때.
 */
export function wobaWeightsFrom(
  runValues: WobaWeights,
  leagueLine: BattingLine,
  label = "",
): { scale: number; weights: WobaWeights } {
  const denominator = wobaDenominator(leagueLine);
  if (denominator === 0) throw new RangeError(`wOBA 분모가 0이다 — 계수를 만들 수 없다 ${label}`);
  const numerator = wobaNumerator(leagueLine, runValues);
  if (!(numerator > 0)) {
    throw new RangeError(`선형가중치의 리그 합이 ${numerator} 다 — 계수를 만들 수 없다 ${label}`);
  }
  const obp = onBasePercentage(leagueLine).value;
  if (obp === null) throw new RangeError(`리그 출루율을 만들 수 없다 ${label}`);
  const scale = (obp * denominator) / numerator;
  return {
    scale,
    weights: {
      bb: runValues.bb * scale,
      hbp: runValues.hbp * scale,
      roe: runValues.roe * scale,
      single: runValues.single * scale,
      double: runValues.double * scale,
      triple: runValues.triple * scale,
      hr: runValues.hr * scale,
    },
  };
}
