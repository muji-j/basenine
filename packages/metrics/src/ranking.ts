import type { Rate } from "./rate.ts";

/**
 * 규정타석 — NPB는 **팀 시합수 × 3.1**, 그리고 **끝수는 四捨五入**이다.
 *
 * 공표 각주(`https://npb.jp/bis/2023/stats/bat_c.html`):
 *   「規定打席 ：チーム試合数×3.1 （端数は四捨五入）」
 *
 * ⚠**여기는 `Math.ceil` 이었다 — 기준이 항상 1 높았다**(2026-08-20 P0 · 감사가 원문으로 잡았다).
 * 143 × 3.1 = 443.3 인데 切り上げ는 444 를 낸다. 정답은 **443**이다.
 * 실측 피해(DB 5,474 선수-팀-시즌 전수): 정확히 443타석에 멈춘 **4건**이
 * **8개 비율 순위 전부**(打率·出塁率·長打率·OPS·wOBA·wRC+·wRAA·SRC)에서 빠지고 그 아래가 한 칸씩 올라갔다 —
 * `2021 楽天 辰己(.225)` · `2023 広島 西川(.305)` · `2024 広島 野間(.271)` · `2025 SB 牧原(.304)`.
 * 2025 퍼시픽 打率는 공식 1위 牧原 .304 가 사라진 채 **柳町 .292 를 1위로 내보내고 있었다.**
 * ⚠**143경기에서만 나는 결함이 아니었다** — 팀 소화 경기수 `mod 10 ∈ {1,2,3,4}` 인
 * 모든 날에 기준이 1 높았다(0~143 중 **59개 값**). 진행 중 시즌에도 매일 살아 있었다.
 *
 * ⚠**정수 곱을 먼저 하고 나눈다**(`× 31 ÷ 10`). 끝수가 정확히 .5 인 자리
 * (팀 경기수가 5·15·…·135)에서 **몫이 이진 부동소수로 정확히 표현되는 형태**가 되어,
 * 올림·내림이 부동소수 오차가 아니라 규칙으로 정해진다.
 * (실측 2026-08-20: 정수 입력 0~200,000 범위에서 `Math.round(g * 3.1)` 도 같은 값을 내므로
 *  **오늘 두 식이 갈리는 실제 입력은 없다.** 그래도 이 형태를 쓰는 것은 정확성이
 *  「3.1 의 이진 표현이 마침 유리한 쪽으로 떨어진다」는 우연에 기대지 않게 하기 위함이다.)
 *
 * ⚠자격 기준은 「표시 규칙」이 아니라 **값의 일부**다(M3).
 * 기준을 바꾸면 순위가 바뀐다. 그래서 코드에만 두지 않고 테스트로 고정한다 —
 * ⚠**단, 기댓값에 이 식을 다시 쓰면 안 된다.** 예전 시험이 `Math.ceil(143 * 3.1)` 을
 * 기댓값으로 써서 **구현이 무엇이든 통과했고**, 그래서 1,087본이 이 결함을 놓쳤다.
 * 기댓값은 npb.jp 가 공표한 수(443)여야 한다.
 */
export function qualifiedBatterPa(teamGames: number): number {
  return Math.round((teamGames * 31) / 10);
}

/**
 * 규정투구회 — NPB는 **팀 시합수 × 1이닝**. 아웃 카운트로 돌려준다(1이닝 = 3아웃).
 *
 * ⚠**이쪽은 끝수가 없다** — 곱하는 수가 정수라 四捨五入·切り上げ가 갈릴 자리가 없다.
 * 규정타석의 P0 를 고치면서 함께 확인했고(2026-08-20), npb.jp 리더보드와 일치한다:
 * `dist/2019` 퍼시픽 선발 방어율 6행 × 3항목 전부 일치 · 143.0회에 정확히 도달한 山本가 1위로 들어간다.
 * **바꾸지 마라.**
 */
export function qualifiedPitcherOuts(teamGames: number): number {
  return teamGames * 3;
}

/**
 * 구원 투수의 자격선 — **규정투구회의 3분의 1**(팀 시합수 × 1/3이닝). 아웃 카운트로 돌려준다.
 *
 * ⚠**이것은 NPB 공식 기준이 아니라 우리가 정한 기준이다.** 그 사실을 화면에도 쓴다.
 * NPB의 구원 부문 타이틀(最多セーブ·最優秀中継ぎ)은 **개수**라서 자격선 자체가 없고,
 * 방어율·WHIP 같은 비율을 구원 투수끼리 줄 세우려면 우리가 선을 그을 수밖에 없다.
 *
 * 왜 1/3인가 — 규정투구회를 그대로 걸면 구원 투수는 **한 명도 자격을 얻지 못한다.**
 * 실측(2026-08-15 · 팀 최다 109경기): 이 기준으로 구원형 23명이 자격을 얻어
 * 선발 부문의 자격자 16명과 비슷한 크기가 된다. 두 순위표의 두께를 맞추는 것이 목적이다.
 *
 * ⚠아웃이 아니라 등판 수로 재고 싶은 유혹이 있지만, 재는 대상이 **비율 지표**다.
 * 40등판 × 0.5이닝은 여전히 얇은 표본이고, 얇은 표본에 순위를 붙이는 것이 M2가 막는 일이다.
 */
export function qualifiedRelieverOuts(teamGames: number): number {
  return teamGames;
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
