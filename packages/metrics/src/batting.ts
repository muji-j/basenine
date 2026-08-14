import { rate } from "./rate.ts";
import type { Rate } from "./rate.ts";
import { singles, totalBases } from "./lines.ts";
import type { BattingLine } from "./lines.ts";

/** 타율 打率 — npb.jp 공표값과 대조 가능(T1). */
export function battingAverage(line: BattingLine): Rate {
  return rate(line.h, line.ab);
}

/** 출루율 出塁率 — npb.jp 공표값과 대조 가능(T1). */
export function onBasePercentage(line: BattingLine): Rate {
  return rate(line.h + line.bb + line.hbp, line.ab + line.bb + line.hbp + line.sf);
}

/** 장타율 長打率 — npb.jp 공표값과 대조 가능(T1). */
export function sluggingPercentage(line: BattingLine): Rate {
  return rate(totalBases(line), line.ab);
}

/**
 * OPS = 출루율 + 장타율.
 * ⚠분모가 둘(출루 분모·타수)이라 하나로 줄일 수 없다. 표본 크기로는 **타석**을 싣는다.
 */
export function ops(line: BattingLine): Rate {
  const obp = onBasePercentage(line);
  const slg = sluggingPercentage(line);
  const value = obp.value === null || slg.value === null ? null : obp.value + slg.value;
  return { value, denominator: line.pa };
}

/** ISO = 장타율 − 타율. 순수 장타력. */
export function iso(line: BattingLine): Rate {
  const slg = sluggingPercentage(line);
  const avg = battingAverage(line);
  const value = slg.value === null || avg.value === null ? null : slg.value - avg.value;
  return { value, denominator: line.ab };
}

/** BABIP — 인플레이 타구의 안타 비율. */
export function babip(line: BattingLine): Rate {
  return rate(line.h - line.hr, line.ab - line.so - line.hr + line.sf);
}

/** 삼진 비율. 분모는 타석. */
export function strikeoutRate(line: BattingLine): Rate {
  return rate(line.so, line.pa);
}

/**
 * 볼넷 비율. **고의사구를 포함한다.**
 * ⚠wOBA는 고의사구를 빼므로 여기와 다르다. 관례가 다른 것이지 어느 한쪽이 틀린 게 아니다.
 */
export function walkRate(line: BattingLine): Rate {
  return rate(line.bb, line.pa);
}

export { singles, totalBases };
