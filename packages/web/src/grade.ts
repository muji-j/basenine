/**
 * 수치의 등급 — 5단계.
 *
 * ⚠**등급은 「이 리그에서 어느 정도인가」이지 절대적 좋고 나쁨이 아니다.**
 * 그래서 임계값을 **실데이터에서 뽑았고**, 어느 모집단에서 뽑았는지 함께 적는다.
 *
 * ## 기준 모집단 (2026 시즌 · 2026-08-15 산출)
 *
 * | 그룹 | 인원 | 이유 |
 * |---|---|---|
 * | 타자 | **100타석 이상 157명** | 규정 도달자(40명)만 쓰면 **전부 상위권**이라, 평범한 선수가 「매우 나쁨」이 된다 |
 * | 선발 | **30이닝 이상 85명** | 동상 |
 * | 구원 | **20이닝 이상 90명** | 30이닝으로 자르면 53명까지 줄어 선발 쪽과 두께가 맞지 않는다 |
 *
 * 각 지표의 20/40/60/80 백분위를 임계값으로 삼고 **깔끔한 수로 반올림**했다.
 * wRC+의 5분위가 75 / 95 / 110 / 133으로 **100을 중심에 두고** 나온 것이 이 모집단 선택의 근거다.
 *
 * ## ⚠선발과 구원을 하나의 잣대로 재지 않는다
 *
 * 2026 시즌 실측 방어율 5분위:
 *
 * ```
 * 선발  2.58 / 2.86 / 3.50 / 4.63
 * 구원  1.83 / 2.30 / 2.73 / 3.89
 * ```
 *
 * **방어율 3.20은 선발에게 중위권이고 구원에게는 하위권이다.** 하나의 임계값으로 칠하면
 * 값은 맞는데 화면이 틀린 말을 한다 — 가장 나쁜 종류의 오류다.
 * 구원 투수가 짧은 이닝을 전력으로 던지고, 주자를 남기고 내려가면 실점이 앞 투수에게 붙는
 * 구조 때문이며, 이것은 편차가 아니라 **역할의 성질**이다.
 *
 * ⚠**리그 백분위를 매일 다시 계산하지 않는다.** 그러면 성적이 그대로인데 색이 바뀌는 날이 생기고,
 * 「어제는 좋음이었는데」가 된다. 고정값을 쓰고 시즌이 끝나면 다시 뽑는다.
 *
 * ## 색을 칠하지 않는 것들
 *
 * - **BABIP** — 운의 영향이 커서 좋고 나쁨을 말할 수 없다
 * - **SRC** — 우리 자체 지표다. 남의 분포와 비교할 근거가 아직 없다
 * - **개수 지표**(안타·홈런·승리·세이브 등) — 출장 기회에 비례하므로 등급이 뜻을 갖지 않는다
 */

export type Grade = "veryBad" | "bad" | "average" | "good" | "veryGood";

/**
 * 어느 잣대로 잴 것인가. **타자·선발·구원은 서로 다른 분포를 갖는다.**
 * 같은 `era` 키라도 그룹이 다르면 임계값이 다르다.
 */
export type GradeGroup = "batter" | "starter" | "reliever";

export interface GradeScale {
  /** 20/40/60/80 백분위. **오름차순** */
  thresholds: readonly [number, number, number, number];
  /** 방어율처럼 낮을수록 좋으면 false */
  higherIsBetter: boolean;
  /** 이보다 표본이 적으면 **등급을 매기지 않는다**(M2) */
  minSample: number;
}

/** 타자 표본은 타석·타수, 투수 표본은 **아웃 카운트**다 */
export const BATTER_MIN = 50;
/** 30이닝 */
const STARTER_MIN = 90;
/** 20이닝. 구원 투수에게 30이닝을 요구하면 대부분이 색을 잃는다 */
export const RELIEVER_MIN = 60;

/**
 * ⚠**투수 지표는 대부분 「낮을수록 좋다」.** 이걸 놓치면 좋은 투수가 나쁜 색으로 칠해진다 —
 * 값은 맞는데 화면이 정반대를 말하는, 가장 나쁜 종류의 오류다.
 */
export const SCALES: Readonly<Record<GradeGroup, Readonly<Record<string, GradeScale>>>> = {
  // ── 타자 (100타석 이상 157명 기준) ──
  batter: {
    avg: { thresholds: [0.225, 0.24, 0.255, 0.275], higherIsBetter: true, minSample: BATTER_MIN },
    obp: { thresholds: [0.28, 0.3, 0.32, 0.345], higherIsBetter: true, minSample: BATTER_MIN },
    slg: { thresholds: [0.3, 0.345, 0.39, 0.43], higherIsBetter: true, minSample: BATTER_MIN },
    ops: { thresholds: [0.59, 0.65, 0.7, 0.76], higherIsBetter: true, minSample: BATTER_MIN },
    woba: { thresholds: [0.275, 0.3, 0.315, 0.34], higherIsBetter: true, minSample: BATTER_MIN },
    wrcPlus: { thresholds: [75, 95, 110, 133], higherIsBetter: true, minSample: BATTER_MIN },
    iso: { thresholds: [0.065, 0.1, 0.135, 0.175], higherIsBetter: true, minSample: BATTER_MIN },
    bbRate: { thresholds: [0.045, 0.065, 0.08, 0.1], higherIsBetter: true, minSample: BATTER_MIN },
    // ⚠삼진은 적을수록 좋다
    kRate: { thresholds: [0.15, 0.18, 0.215, 0.258], higherIsBetter: false, minSample: BATTER_MIN },
  },

  // ── 선발 (30이닝 이상 85명 기준). 분모는 아웃 카운트다 ──
  starter: {
    era: { thresholds: [2.6, 2.9, 3.5, 4.6], higherIsBetter: false, minSample: STARTER_MIN },
    whip: { thresholds: [1.05, 1.18, 1.27, 1.44], higherIsBetter: false, minSample: STARTER_MIN },
    fip: { thresholds: [2.9, 3.18, 3.45, 4.1], higherIsBetter: false, minSample: STARTER_MIN },
    k9: { thresholds: [6.4, 7.35, 8.4, 9.3], higherIsBetter: true, minSample: STARTER_MIN },
    bb9: { thresholds: [1.8, 2.25, 2.8, 3.4], higherIsBetter: false, minSample: STARTER_MIN },
    hr9: { thresholds: [0.65, 0.8, 0.93, 1.15], higherIsBetter: false, minSample: STARTER_MIN },
    // ⚠적을수록 좋다. 다만 삼진형 투수는 球数가 늘기 마련이라 「효율=좋은 투수」가 아니다
    pitchesPerOut: { thresholds: [5.2, 5.4, 5.6, 5.85], higherIsBetter: false, minSample: STARTER_MIN },
  },

  // ── 구원 (20이닝 이상 90명 기준) ──
  reliever: {
    era: { thresholds: [1.85, 2.3, 2.75, 3.9], higherIsBetter: false, minSample: RELIEVER_MIN },
    whip: { thresholds: [0.97, 1.09, 1.2, 1.36], higherIsBetter: false, minSample: RELIEVER_MIN },
    fip: { thresholds: [2.3, 2.88, 3.38, 4.05], higherIsBetter: false, minSample: RELIEVER_MIN },
    k9: { thresholds: [6.65, 8.1, 9.1, 10.15], higherIsBetter: true, minSample: RELIEVER_MIN },
    bb9: { thresholds: [2.15, 2.85, 3.45, 4.2], higherIsBetter: false, minSample: RELIEVER_MIN },
    hr9: { thresholds: [0.32, 0.53, 0.66, 1.12], higherIsBetter: false, minSample: RELIEVER_MIN },
    pitchesPerOut: { thresholds: [5.05, 5.25, 5.5, 5.75], higherIsBetter: false, minSample: RELIEVER_MIN },
  },
};

/**
 * 그룹별 기준 모집단 설명. **화면이 「무엇과 비교한 색인가」에 답해야 한다**
 *
 * ⚠**기준일이 빠져 있었다**(2026-08-20). 「100打席以上の打者157人の分布」이라고만 적으면
 * **현재형 진술**로 읽히는데, 위 표대로 이 수는 **2026-08-15 에 뽑은 고정 산출물**이다.
 * 시즌이 굴러가면 100타석을 넘는 선수가 계속 늘어 그 진술이 조용히 거짓이 된다 —
 * 실제로 08-16 스냅샷에서 이미 **158명**이었다(실측 2026-08-20 · 정규시즌).
 *
 * ⚠**여기서 「그러면 매일 다시 세자」로 가면 안 된다.** 위 표제부가 적은 대로
 * 임계값을 매일 다시 뽑으면 **성적이 그대로인데 색이 바뀌는 날**이 생긴다.
 * 고정이 의도이므로 고칠 것은 수가 아니라 **문장**이다 — 언제 뽑았는지를 적으면 참이 된다.
 * ⚠**시즌이 끝나 임계값을 다시 뽑을 때 이 날짜도 같이 고쳐라.**
 */
export const GROUP_BASIS: Readonly<Record<GradeGroup, string>> = {
  batter: "2026年8月15日時点で100打席以上の打者157人の分布",
  starter: "2026年8月15日時点で30回以上の先発投手85人の分布",
  reliever: "2026年8月15日時点で20回以上の救援投手90人の分布",
};

export const GROUP_LABEL: Readonly<Record<GradeGroup, string>> = {
  batter: "打者",
  starter: "先発",
  reliever: "救援",
};

const ORDER: readonly Grade[] = ["veryBad", "bad", "average", "good", "veryGood"];

/**
 * 등급을 매긴다.
 *
 * @param group 어느 분포와 비교할 것인가. ⚠**투수는 반드시 역할을 넘겨야 한다** —
 *   기본값(`batter`)에는 투수 지표가 없어 조용히 `null`이 나온다(= 색이 사라진다).
 * @returns 등급, 또는 **매기지 않을 때 null**.
 *   ⚠null은 「보통」이 아니다 — 표본이 모자라거나 등급 대상이 아닌 지표다.
 *   호출하는 쪽이 이 둘을 같게 다루면 M2가 무너진다.
 */
export function gradeOf(
  metric: string,
  value: number | null,
  sample: number,
  group: GradeGroup = "batter",
): Grade | null {
  const scale = SCALES[group][metric];
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
export function isGraded(metric: string, group: GradeGroup = "batter"): boolean {
  return SCALES[group][metric] !== undefined;
}

/** 정의된 그룹 전부. 문서 대조 테스트가 쓴다 */
export function gradeGroups(): readonly GradeGroup[] {
  return ["batter", "starter", "reliever"];
}
