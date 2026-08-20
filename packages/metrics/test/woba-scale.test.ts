/**
 * **wOBAscale 의 정의를 못 박는다.**
 *
 * 계수는 이제 리그·시즌마다 유도한다(`@bb-app/aggregate` 의 `deriveRunValues`).
 * 그 유도의 마지막 한 걸음이 **「득점 단위 → 출루율 눈금」** 변환이고,
 * 그것을 정하는 성질이 딱 하나다:
 *
 *   **그 리그의 wOBA 는 그 리그의 출루율과 정확히 같다.**
 *
 * ⚠**이 성질이 깨지면 화면의 wOBA 가 출루율과 다른 눈금이 된다** — 용어집이
 * 「出塁率と同じ目盛りで読めます」라고 쓰고 있으므로 그 순간 화면이 거짓말을 한다.
 * 그리고 그 거짓말은 **값이 그럴듯해서** 눈으로는 안 잡힌다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WOBA_WEIGHTS,
  leagueConstants,
  onBasePercentage,
  wobaNumerator,
  wobaRawWith,
  wobaWeightsFrom,
} from "../src/index.ts";
import type { BattingLine, PitchingLine, WobaWeights } from "../src/index.ts";

/** 리그 1개분에 가까운 크기의 집계. 실제 비율에 맞춰 만든다 */
const LEAGUE: BattingLine = {
  pa: 32_000, ab: 28_500, h: 6_900, double: 1_200, triple: 120, hr: 540,
  bb: 2_200, ibb: 190, hbp: 290, sf: 180, sh: 620, so: 6_200, roe: 250,
};

const PITCHING: PitchingLine = {
  outs: 25_700, bf: 32_000, h: 6_900, hr: 540, bb: 2_200, ibb: 190, hbp: 290,
  so: 6_200, er: 3_100, r: 3_300,
};

/** 득점 단위의 선형가중치. 우리 아카이브 유도값의 자릿수를 흉내 낸 것이다 */
const RUN_VALUES: WobaWeights = {
  bb: 0.44, hbp: 0.46, roe: 0.60, single: 0.57, double: 0.94, triple: 1.27, hr: 1.62,
};

test("⚠유도한 계수로 재면 리그 wOBA 는 리그 출루율과 **정확히** 같다 — 이것이 wOBAscale 의 정의다", () => {
  const { weights } = wobaWeightsFrom(RUN_VALUES, LEAGUE);
  const obp = onBasePercentage(LEAGUE).value!;
  const woba = wobaRawWith(LEAGUE, weights)!;
  assert.ok(
    Math.abs(woba - obp) < 1e-12,
    `리그 wOBA ${woba} 와 리그 출루율 ${obp} 가 다르다 — 스케일이 정의를 안 지킨다`,
  );
});

test("scale 은 계수를 통째로 곱한 배수다 — 사건 사이의 상대 크기는 안 건드린다", () => {
  const { weights, scale } = wobaWeightsFrom(RUN_VALUES, LEAGUE);
  for (const key of ["bb", "hbp", "roe", "single", "double", "triple", "hr"] as const) {
    assert.ok(
      Math.abs(weights[key] - RUN_VALUES[key] * scale) < 1e-12,
      `${key}: ${weights[key]} ≠ ${RUN_VALUES[key]} × ${scale}`,
    );
  }
});

test("⚠득점 단위로 되돌리면 원래의 선형가중치가 나온다 — wRAA 의 단위가 득점인 근거다", () => {
  const { weights, scale } = wobaWeightsFrom(RUN_VALUES, LEAGUE);
  // wOBA 차이를 scale 로 나눈 것이 **득점 차이**다. 계수 하나짜리 극단 케이스로 확인한다
  const oneHr: BattingLine = { ...LEAGUE, h: LEAGUE.h + 1, hr: LEAGUE.hr + 1, ab: LEAGUE.ab + 1 };
  const gain = (wobaRawWith(oneHr, weights)! * (LEAGUE.ab + 1 + (LEAGUE.bb - LEAGUE.ibb) + LEAGUE.hbp + LEAGUE.sf)
    - wobaNumerator(LEAGUE, weights)) / scale;
  assert.ok(
    Math.abs(gain - RUN_VALUES.hr) < 1e-9,
    `홈런 1개가 늘린 득점이 ${gain} 이다 — 선형가중치 ${RUN_VALUES.hr} 와 같아야 한다`,
  );
});

test("⚠리그 상수가 계수와 scale 을 함께 들고 나온다 — 짝이 갈리면 wRAA 의 단위가 어긋난다", () => {
  const lc = leagueConstants({
    season: 2025, league: "central", batting: LEAGUE, pitching: PITCHING,
    runs: 3_300, runValues: RUN_VALUES,
  });
  const obp = onBasePercentage(LEAGUE).value!;
  assert.ok(
    Math.abs(lc.averageWoba - obp) < 1e-12,
    `리그 상수의 평균 wOBA ${lc.averageWoba} 가 리그 출루율 ${obp} 와 다르다`,
  );
  assert.ok(Math.abs(lc.wobaWeights.hr - RUN_VALUES.hr * lc.wobaScale) < 1e-12);
});

test("⚠선형가중치를 안 주면 폴백으로 떨어진다 — 그리고 그때는 출루율과 안 맞는다", () => {
  const lc = leagueConstants({
    season: 2025, league: "central", batting: LEAGUE, pitching: PITCHING, runs: 3_300,
  });
  assert.deepEqual({ ...lc.wobaWeights }, { ...WOBA_WEIGHTS });
  // ⚠**이 본이 「폴백은 이 리그의 값이 아니다」를 못 박는다.** 화면 경로가 폴백으로 떨어지면
  //   출루율 눈금이 밀리는데, 그 밀림은 눈으로 안 보인다
  const obp = onBasePercentage(LEAGUE).value!;
  assert.ok(
    Math.abs(lc.averageWoba - obp) > 1e-6,
    "폴백 계수인데 리그 출루율과 정확히 맞았다 — 이 표본이 우연히 폴백에 맞춰져 있다(표본을 바꿔라)",
  );
});

test("⚠표본이 비면 계수를 지어내지 않고 던진다 — 0으로 나눈 상수는 전 지표를 조용히 무너뜨린다", () => {
  const empty: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
  };
  assert.throws(() => wobaWeightsFrom(RUN_VALUES, empty), /wOBA 분모가 0이다/);
  // 분모는 있는데 사건이 하나도 없는 경우(전원 삼진)도 막는다
  const allOuts: BattingLine = { ...empty, pa: 100, ab: 100, so: 100 };
  assert.throws(() => wobaWeightsFrom(RUN_VALUES, allOuts), /선형가중치의 리그 합이/);
});
