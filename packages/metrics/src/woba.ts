import type { Rate } from "./rate.ts";
import { singles } from "./lines.ts";
import type { BattingLine } from "./lines.ts";

/**
 * wOBA 계수 (NPB판).
 *
 * 출처: 1.02 Essence of Baseball Glossary
 * https://1point02.jp/op/gnav/glossary/gls_explanation.aspx?eid=20040
 *
 * 원식:
 *   wOBA = {0.692×(四球−故意四球) + 0.73×死球 + 0.966×失策出塁 + 0.865×単打
 *           + 1.334×二塁打 + 1.725×三塁打 + 2.065×本塁打}
 *          ÷ (打数 + 四球 − 故意四球 + 死球 + 犠飛)
 *
 * ⚠**`roe`(失策出塁) 항은 계산에서 생략한다.** 선수별 실책출루를 공개하는 소스가 없다
 * (소스 조사 보고서 §3-5). 계수는 출처 대조를 위해 남겨두되 쓰지 않으며,
 * 이 생략은 지표 라벨에 각주로 표시한다.
 *
 * ⚠**계수는 시즌마다 다르다**(1.02가 명시). 공개된 것은 이 1세트뿐이므로
 * wOBA 절대치가 아니라 **리그평균 대비 상대치(wRAA·wRC+)로 제시**한다.
 */
export const WOBA_WEIGHTS = {
  bb: 0.692,
  hbp: 0.73,
  roe: 0.966,
  single: 0.865,
  double: 1.334,
  triple: 1.725,
  hr: 2.065,
} as const;

/** wOBA를 득점 단위로 되돌리기 위한 제수(wOBAscale). 출처: 1.02 wRAA 항목. */
export const WOBA_SCALE = 1.24;

function wobaDenominator(line: BattingLine): number {
  return line.ab + (line.bb - line.ibb) + line.hbp + line.sf;
}

/**
 * 분모가 0이면 null.
 * 리그 상수 산출(`league.ts`)이 `Rate` 껍데기 없이 쓰기 위해 원시값을 노출한다.
 */
export function wobaRaw(line: BattingLine): number | null {
  const denominator = wobaDenominator(line);
  if (denominator === 0) return null;
  const w = WOBA_WEIGHTS;
  const numerator =
    w.bb * (line.bb - line.ibb) +
    w.hbp * line.hbp +
    w.single * singles(line) +
    w.double * line.double +
    w.triple * line.triple +
    w.hr * line.hr;
  return numerator / denominator;
}

export function woba(line: BattingLine): Rate {
  return { value: wobaRaw(line), denominator: wobaDenominator(line) };
}
