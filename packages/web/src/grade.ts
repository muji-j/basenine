/**
 * 수치의 등급 — 5단계.
 *
 * ⚠**등급은 「이 리그에서 어느 정도인가」이지 절대적 좋고 나쁨이 아니다.**
 * 그래서 임계값을 **실데이터에서 뽑았고**, 어느 모집단에서 뽑았는지 함께 적는다.
 *
 * ## 기준 모집단 (2026 시즌 · **2026-08-15 시점**)
 *
 * | 그룹 | 인원 | 이유 |
 * |---|---|---|
 * | 타자 | **100타석 이상 157명** | 규정 도달자(40명)만 쓰면 **전부 상위권**이라, 평범한 선수가 「매우 나쁨」이 된다 |
 * | 선발 | **30이닝 이상 85명** | 동상 |
 * | 구원 | **20이닝 이상 90명** | 30이닝으로 자르면 53명까지 줄어 선발 쪽과 두께가 맞지 않는다 |
 *
 * 각 지표의 20/40/60/80 백분위를 임계값으로 삼고 **깔끔한 수로 반올림**했다.
 * wRC+의 5분위가 100을 중심에 두고 나온 것이 이 모집단 선택의 근거다.
 *
 * ## ⚠wOBA·wRC+ 만 2026-08-21 에 다시 뽑았다 — **시간이 아니라 자가 바뀌었다**
 *
 * wOBA 계수가 **모듈 상수 1세트(1.02 공개값) → 리그×시즌 유도값**으로 바뀌었는데
 * (2026-08-20 · `docs/metrics/README.md` §4) **임계값이 그대로 남아 있었다.**
 * 즉 **재는 자의 눈금이 바뀌었는데 눈금 위의 표시는 안 옮겨졌다** —
 * 아래 「매일 다시 계산하지 않는다」가 막으려던 「성적이 그대로인데 색이 바뀌는 날」을
 * 그 변경이 정확히 만들었다(실측: 9시즌 wOBA **213/2,013** · wRC+ **90/2,059**).
 *
 * ⚠**이 재산출은 그 원칙의 예외가 아니라 그 원칙의 이행이다.** 둘을 반드시 구별해라:
 * - **시간 드리프트로 다시 뽑는 것 → 금지.** 그러면 「어제는 良い였는데」가 매일 난다
 * - **자가 바뀌어서 다시 뽑는 것 → 필수.** 안 뽑으면 옛 자의 눈금이 새 값에 붙은 채 남는다
 *
 * 그래서 **모집단의 기준일을 2026-08-15 에 고정한 채** 계수만 새것으로 바꿔 다시 쟀다
 * (같은 157명 · `scripts/grade-thresholds-measure.ts`). 바뀐 변수는 계수 하나뿐이다.
 *
 * ```
 * 새 분위수(157명)   wOBA 0.2742 0.2980 0.3182 0.3457 · wRC+ 77.3 94.8 110.3 131.5
 * 반올림 눈금        wOBA 0.005 · wRC+ 1   (최근접 반올림)
 * → 임계값           wOBA 0.275 0.300 0.320 0.345 · wRC+ 77 95 110 131
 * 옛 임계값          wOBA 0.275 0.300 0.315 0.340 · wRC+ 75 95 110 133
 * ```
 *
 * ⚠**나머지 지표는 손대지 않았다.** 계수 변경이 닿는 것은 `wobaWeights`·`wobaScale` 뿐이고
 * 그것을 쓰는 지표는 wOBA·wRAA·wRC+ 뿐이다(§4 「영향 범위」).
 * **투수 지표는 안 닿는다** — 리그 상수를 쓰는 것이 FIP 하나인데 그 `cFip` 은 투수 라인만으로
 * 만들어진다. **읽고 판단한 게 아니라 쟀다**: 9시즌 전수 · 선발/구원 두 잣대 ·
 * **FIP 등급 변화 0 / 3,477건**. 그래서 투수 임계값은 그대로 둔다.
 * 타자 쪽 나머지(打率·出塁率·長打率·OPS·ISO·BB%·K%)를 지금 다시 뽑으면
 * **계수와 무관한 DB 드리프트**(백필·파서 수정)까지 임계값에 실려
 * — 실측으로 같은 157명에서 打率 20% 분위가 문서의 .225 대 지금 .2216 이다 —
 * 위에서 금지한 그 날을 스스로 만든다.
 *
 * ## ⚠이 재산출이 「색이 덜 바뀌게」 하는 것은 아니다 — 색을 **참이게** 한다
 *
 * 실측(9시즌 · 표본 50 이상): 계수만 바뀌었을 때 wOBA 등급이 **213/2,013** 움직였고,
 * 임계값까지 고친 뒤에도 옛 화면 대비 **207/2,013** 이다(wRC+ 는 90 → 106).
 * **줄지 않는다.** 근거는 개수가 아니라 **임계값이 자기 정의를 지키는가**다:
 *
 * ```
 * 기준 모집단 157명에서 각 임계값이 실제로 자르는 백분위 (목표 20/40/60/80)
 *   wOBA 옛 .275/.300/.315/.340 → 20.4 / 41.4 / 56.7 / 76.4 %   5분할 32/33/24/31/37
 *   wOBA 새 .275/.300/.320/.345 → 20.4 / 41.4 / 61.8 / 79.6 %   5분할 32/33/32/28/32
 *   wRC+ 옛 75/95/110/133       → 19.7 / 40.1 / 59.9 / 80.9 %   5분할 31/32/31/33/30
 *   wRC+ 새 77/95/110/131       → 19.7 / 40.1 / 59.9 / 79.6 %   5분할 31/32/31/31/32
 * ```
 *
 * 옛 임계값은 **「60%」라고 부르면서 56.7% 에서 잘랐다.** 그게 고쳐야 할 것이었다.
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
 * **임계값을 뽑은 모집단의 기준일.** `GROUP_BASIS` 가 화면에 적는 날과 같아야 한다.
 * ⚠**「산출한 날」이 아니다** — 그건 아래 `THRESHOLDS_DERIVED_ON` 이다. 둘은 다르다:
 * 2026-08-21 에 다시 뽑았지만 **모집단은 2026-08-15 시점 그대로**다(자만 바꿨다).
 */
export const BASIS_AS_OF = "2026-08-15";

/**
 * **임계값을 마지막으로 뽑은 날.**
 *
 * ⚠**이 날짜는 `docs/metrics/README.md` §4 「계수를 바꾼 날」의 최신 날짜 이상이어야 한다.**
 * 계수가 바뀌면 wOBA·wRC+ 의 분포가 통째로 옮겨가므로, 옛 임계값은 **다른 자의 눈금**이 된다.
 * `packages/web/test/grade-thresholds.test.ts` 가 그것을 시험으로 못 박는다 —
 * **계수를 또 바꾸면 여기가 떨어진다.** 그때 할 일은 날짜만 고치는 것이 아니라
 * `node scripts/grade-thresholds-measure.ts data/bb.sqlite` 로 **다시 뽑는 것**이다.
 */
export const THRESHOLDS_DERIVED_ON = "2026-08-21";

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
    // ⚠아래 둘은 **계수가 바뀌어서** 2026-08-21 에 다시 뽑았다(표제부 참조).
    //   `grade-thresholds.test.ts` 가 「임계값 산출일 ≥ 계수 변경일」을 못 박는다
    woba: { thresholds: [0.275, 0.3, 0.32, 0.345], higherIsBetter: true, minSample: BATTER_MIN },
    wrcPlus: { thresholds: [77, 95, 110, 131], higherIsBetter: true, minSample: BATTER_MIN },
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
