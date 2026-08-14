import type { Rate } from "./rate.ts";
import type { PitchingLine } from "./lines.ts";

/**
 * 아웃 카운트 기준의 「9이닝당」 환산.
 * 9이닝 = 27아웃이므로 `× 27 / outs`. 이닝을 부동소수로 만들지 않는다.
 */
function per9(count: number, outs: number): Rate {
  return { value: outs === 0 ? null : (count * 27) / outs, denominator: outs };
}

/** 방어율 防御率 — npb.jp 공표값과 대조 가능(T1). */
export function earnedRunAverage(line: PitchingLine): Rate {
  return per9(line.er, line.outs);
}

/** WHIP — 이닝당 출루 허용. **사구를 포함하지 않는 것이 관례다.** */
export function whip(line: PitchingLine): Rate {
  return {
    value: line.outs === 0 ? null : ((line.h + line.bb) * 3) / line.outs,
    denominator: line.outs,
  };
}

export function strikeoutsPer9(line: PitchingLine): Rate {
  return per9(line.so, line.outs);
}

export function walksPer9(line: PitchingLine): Rate {
  return per9(line.bb, line.outs);
}

export function homeRunsPer9(line: PitchingLine): Rate {
  return per9(line.hr, line.outs);
}
