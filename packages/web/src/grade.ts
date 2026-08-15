/**
 * 수치의 등급 — 5단계.
 *
 * ⚠**등급은 「이 리그에서 어느 정도인가」이지 절대적 좋고 나쁨이 아니다.**
 * 그래서 임계값을 **실데이터에서 뽑았고**, 어느 모집단에서 뽑았는지 함께 적는다.
 *
 * ## 기준 모집단 (2026 시즌 · 2026-08-15 산출)
 *
 * | | 인원 | 이유 |
 * |---|---|---|
 * | 타자 | **100타석 이상 157명** | 규정 도달자(40명)만 쓰면 **전부 상위권**이라, 평범한 선수가 「매우 나쁨」이 된다 |
 * | 투수 | **30이닝 이상 137명** | 동상(규정 도달 15명) |
 *
 * 각 지표의 20/40/60/80 백분위를 임계값으로 삼고 **깔끔한 수로 반올림**했다.
 * wRC+의 5분위가 75 / 95 / 110 / 133으로 **100을 중심에 두고** 나온 것이 이 모집단 선택의 근거다.
 *
 * ⚠**리그 백분위를 매일 다시 계산하지 않는다.** 그러면 성적이 그대로인데 색이 바뀌는 날이 생기고,
 * 「어제는 좋음이었는데」가 된다. 고정값을 쓰고 시즌이 끝나면 다시 뽑는다.
 *
 * ## 색을 칠하지 않는 것들
 *
 * - **BABIP** — 운의 영향이 커서 좋고 나쁨을 말할 수 없다
 * - **SRC** — 우리 자체 지표다. 남의 분포와 비교할 근거가 아직 없다
 * - **개수 지표**(안타·홈런 등) — 출장 수에 비례하므로 등급이 뜻을 갖지 않는다
 */

export type Grade = "veryBad" | "bad" | "average" | "good" | "veryGood";

export interface GradeScale {
  /** 20/40/60/80 백분위. **오름차순** */
  thresholds: readonly [number, number, number, number];
  /** 방어율처럼 낮을수록 좋으면 false */
  higherIsBetter: boolean;
  /** 이보다 표본이 적으면 **등급을 매기지 않는다**(M2) */
  minSample: number;
}

/**
 * ⚠**투수 지표는 대부분 「낮을수록 좋다」.** 이걸 놓치면 좋은 투수가 빨갛게 칠해진다 —
 * 값은 맞는데 화면이 정반대를 말하는, 가장 나쁜 종류의 오류다.
 */
export const SCALES: Readonly<Record<string, GradeScale>> = {
  // ── 타자 (100타석 이상 157명 기준) ──
  avg: { thresholds: [0.225, 0.24, 0.255, 0.275], higherIsBetter: true, minSample: 50 },
  obp: { thresholds: [0.28, 0.3, 0.32, 0.345], higherIsBetter: true, minSample: 50 },
  slg: { thresholds: [0.3, 0.345, 0.39, 0.43], higherIsBetter: true, minSample: 50 },
  ops: { thresholds: [0.59, 0.65, 0.7, 0.76], higherIsBetter: true, minSample: 50 },
  woba: { thresholds: [0.275, 0.3, 0.315, 0.34], higherIsBetter: true, minSample: 50 },
  wrcPlus: { thresholds: [75, 95, 110, 133], higherIsBetter: true, minSample: 50 },
  iso: { thresholds: [0.065, 0.1, 0.135, 0.175], higherIsBetter: true, minSample: 50 },
  bbRate: { thresholds: [0.045, 0.065, 0.08, 0.1], higherIsBetter: true, minSample: 50 },
  // ⚠삼진은 적을수록 좋다
  kRate: { thresholds: [0.15, 0.18, 0.215, 0.258], higherIsBetter: false, minSample: 50 },

  // ── 투수 (30이닝 이상 137명 기준). 분모는 아웃 카운트다 ──
  era: { thresholds: [2.05, 2.65, 3.2, 4.0], higherIsBetter: false, minSample: 60 },
  whip: { thresholds: [1.02, 1.12, 1.22, 1.36], higherIsBetter: false, minSample: 60 },
  fip: { thresholds: [2.55, 3.05, 3.4, 3.9], higherIsBetter: false, minSample: 60 },
  k9: { thresholds: [6.4, 7.6, 8.5, 9.6], higherIsBetter: true, minSample: 60 },
  bb9: { thresholds: [1.9, 2.35, 3.0, 3.5], higherIsBetter: false, minSample: 60 },
  hr9: { thresholds: [0.5, 0.66, 0.86, 1.06], higherIsBetter: false, minSample: 60 },
};

const ORDER: readonly Grade[] = ["veryBad", "bad", "average", "good", "veryGood"];

/**
 * 등급을 매긴다.
 *
 * @returns 등급, 또는 **매기지 않을 때 null**.
 *   ⚠null은 「보통」이 아니다 — 표본이 모자라거나 등급 대상이 아닌 지표다.
 *   호출하는 쪽이 이 둘을 같게 다루면 M2가 무너진다.
 */
export function gradeOf(metric: string, value: number | null, sample: number): Grade | null {
  const scale = SCALES[metric];
  if (scale === undefined) return null;
  if (value === null || !Number.isFinite(value)) return null;
  if (sample < scale.minSample) return null;

  // 오름차순 임계값에서 몇 칸 위인지 센다
  let step = 0;
  for (const t of scale.thresholds) {
    if (value >= t) step += 1;
  }
  // 낮을수록 좋은 지표는 뒤집는다
  return ORDER[scale.higherIsBetter ? step : ORDER.length - 1 - step]!;
}

/** 화면에 붙일 클래스 조각. `g-veryGood` 등 */
export function gradeClass(grade: Grade | null): string {
  return grade === null ? "" : `g-${grade}`;
}

export const GRADE_LABEL: Readonly<Record<Grade, string>> = {
  veryBad: "とても悪い",
  bad: "悪い",
  average: "ふつう",
  good: "良い",
  veryGood: "とても良い",
};

/** 범례에 쓰는 순서(나쁨 → 좋음) */
export function gradeOrder(): readonly Grade[] {
  return ORDER;
}

/** 이 지표에 등급이 있는가 — 툴팁에서 「색이 없는 이유」를 말할 때 쓴다 */
export function isGraded(metric: string): boolean {
  return SCALES[metric] !== undefined;
}
