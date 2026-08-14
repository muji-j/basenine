import type { Rate } from "./rate.ts";

/**
 * 규정타석 — NPB는 **팀 시합수 × 3.1**.
 *
 * ⚠자격 기준은 「표시 규칙」이 아니라 **값의 일부**다(M3).
 * 기준을 바꾸면 순위가 바뀐다. 그래서 코드에만 두지 않고 테스트로 고정한다.
 */
export function qualifiedBatterPa(teamGames: number): number {
  return Math.ceil(teamGames * 3.1);
}

/** 규정투구회 — NPB는 **팀 시합수 × 1이닝**. 아웃 카운트로 돌려준다. */
export function qualifiedPitcherOuts(teamGames: number): number {
  return teamGames * 3;
}

export interface Ranked<T> {
  item: T;
  /** 자격 미달이거나 값이 없으면 null. **목록에서 빼지 않는다** */
  rank: number | null;
  rate: Rate;
}

export interface RankOptions {
  /** 이 분모 미만은 순위를 매기지 않는다 */
  minDenominator: number;
  /** 타율처럼 높을수록 좋으면 true, 방어율처럼 낮을수록 좋으면 false */
  higherIsBetter: boolean;
}

/**
 * 순위를 매긴다.
 *
 * ⚠**동률은 같은 순위를 받고 다음 순위를 건너뛴다**(공동 2위가 둘이면 다음은 4위).
 * ⚠**자격 미달자를 목록에서 빼지 않는다.** 성적은 있는데 순위만 없는 것이지,
 * 존재하지 않는 것이 아니다 — 빼면 「데이터 없음」과 구별할 수 없어진다(M11).
 */
export function rankBy<T>(
  items: readonly T[],
  getRate: (item: T) => Rate,
  opts: RankOptions,
): Ranked<T>[] {
  const rows = items.map((item) => ({ item, rate: getRate(item) }));
  const eligible = rows.filter(
    (r) => r.rate.value !== null && r.rate.denominator >= opts.minDenominator,
  );

  const sorted = [...eligible].sort((a, b) =>
    opts.higherIsBetter ? b.rate.value! - a.rate.value! : a.rate.value! - b.rate.value!,
  );

  const ranked: Ranked<T>[] = [];
  let previousValue: number | null = null;
  let previousRank = 0;

  sorted.forEach((row, index) => {
    const rank = previousValue !== null && row.rate.value === previousValue ? previousRank : index + 1;
    previousValue = row.rate.value;
    previousRank = rank;
    ranked.push({ item: row.item, rank, rate: row.rate });
  });

  const rankedItems = new Set(sorted.map((r) => r.item));
  for (const row of rows) {
    if (!rankedItems.has(row.item)) ranked.push({ item: row.item, rank: null, rate: row.rate });
  }
  return ranked;
}
