import type { Rate } from "./rate.ts";
import type { BattingLine, PitchingLine } from "./lines.ts";
import type { LeagueConstants } from "./league.ts";
import { WOBA_SCALE, wobaRaw } from "./woba.ts";

/**
 * wRAA = (wOBA − 리그평균wOBA) ÷ wOBAscale × 타석.
 *
 * 출처: 1.02 Glossary
 * https://1point02.jp/op/gnav/glossary/gls_explanation.aspx?ecd=204&eid=20041
 */
export function wraa(line: BattingLine, lc: LeagueConstants): Rate {
  const w = wobaRaw(line);
  const value = w === null ? null : ((w - lc.averageWoba) / WOBA_SCALE) * line.pa;
  return { value, denominator: line.pa };
}

/**
 * wRC+ — 리그 평균을 100으로 지수화한 타격 생산성.
 *
 * ⚠**파크팩터를 적용하지 않는다.** 신뢰할 만한 PF를 만들려면 3~5시즌이 필요한데
 * 원시 로그가 2025년분부터만 존재한다(설계 스펙 §6.2). **이 사실을 지표 라벨에 쓴다** —
 * 적용하지 않은 것과 적용했는데 1.0인 것은 다르다.
 */
export function wrcPlus(line: BattingLine, lc: LeagueConstants): Rate {
  const raa = wraa(line, lc);
  if (raa.value === null || line.pa === 0 || lc.runsPerPa === 0) {
    return { value: null, denominator: line.pa };
  }
  return { value: ((raa.value / line.pa + lc.runsPerPa) / lc.runsPerPa) * 100, denominator: line.pa };
}

/**
 * FIP — 수비와 무관한 결과(홈런·사사구·삼진)만으로 본 투수 성적.
 * 상수 `cFip`는 리그 전체 FIP가 리그 ERA와 같아지도록 `league.ts`가 산출한다.
 */
export function fip(line: PitchingLine, lc: LeagueConstants): Rate {
  if (line.outs === 0) return { value: null, denominator: 0 };
  const raw = ((13 * line.hr + 3 * (line.bb + line.hbp) - 2 * line.so) * 3) / line.outs;
  return { value: raw + lc.cFip, denominator: line.outs };
}
