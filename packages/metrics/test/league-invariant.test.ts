/**
 * 리그 상수의 불변식.
 *
 * ⚠**이 파일은 「고치면 안 되는 것」을 지킨다.**
 * 2026 시즌 실데이터에서 `wRAA`의 리그 합계가 0이 아니라는 것을 발견했다
 * (센트럴 −21.6 · 퍼시픽 −8.1). 언뜻 상수가 틀린 것처럼 보이지만 **틀리지 않았다** —
 * 분해해 보니 잔차 전부가 **犠打·敬遠**이었다.
 *
 * ```
 * 센트럴  wOBA분모로 가중한 편차 합  0.00   ← 상수는 정확하다
 *         PA로 가중한 합(=wRAA 합)  −21.57
 *         犠打+敬遠 항              −21.58  ← 잔차 전부가 이것이다
 * ```
 *
 * 이유: `wRAA = (wOBA − lgwOBA) / wOBAscale × PA`는 **PA**를 곱하는데,
 * wOBA의 분모는 `AB + BB − IBB + SF + HBP`라 **犠打와 敬遠이 빠져 있다.**
 * 그 차이가 그대로 남는다. 표준식이 그렇게 생겼으므로 **우리 구현이 맞다.**
 *
 * 센트럴이 더 큰 것도 설명된다 — **DH가 없어 투수가 번트를 많이 댄다**(犠打 343 vs 302).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leagueConstants, sumBatting, woba, wobaRawWith } from "../src/index.ts";
import type { BattingLine, PitchingLine } from "../src/index.ts";

function line(over: Partial<BattingLine> = {}): BattingLine {
  return {
    pa: 100, ab: 90, h: 25, double: 5, triple: 0, hr: 3,
    bb: 8, ibb: 0, hbp: 1, sf: 1, sh: 0, so: 20, roe: 1,
    ...over,
  };
}

const PITCHING: PitchingLine = {
  outs: 1200, bf: 1800, h: 400, hr: 40, bb: 130, ibb: 5, hbp: 15, so: 350, er: 170, r: 185,
};

/** wOBA 분모 — `woba.ts`와 같은 정의여야 한다 */
function wobaDenominator(l: BattingLine): number {
  return l.ab + l.bb - l.ibb + l.sf + l.hbp;
}

function deviationSum(lines: readonly BattingLine[], weight: (l: BattingLine) => number): number {
  const lc = leagueConstants({
    season: 2026,
    league: "test",
    batting: sumBatting(lines),
    pitching: PITCHING,
    runs: 500,
  });
  let sum = 0;
  for (const l of lines) {
    /**
     * ⚠**상수가 들고 있는 계수·스케일을 쓴다**(2026-08-20). 예전에는 여기서
     * 모듈 상수 `WOBA_SCALE` 을 직접 읽었는데, 계수가 리그·시즌마다 달라진 지금
     * 그건 **`wraa()` 가 쓰는 것과 다른 수가 될 수 있는 자리**다 —
     * 그러면 이 불변식 시험이 구현이 아니라 자기 자신을 검사하게 된다(M1).
     */
    const w = wobaRawWith(l, lc.wobaWeights);
    if (w === null) continue;
    sum += ((w - lc.averageWoba) / lc.wobaScale) * weight(l);
  }
  return sum;
}

const LEAGUE: BattingLine[] = [
  line({ pa: 600, ab: 520, h: 170, double: 35, hr: 25, bb: 70, ibb: 8, hbp: 5, sf: 4, sh: 1, so: 90 }),
  line({ pa: 550, ab: 500, h: 120, double: 18, hr: 8, bb: 40, ibb: 1, hbp: 3, sf: 3, sh: 4, so: 110 }),
  line({ pa: 400, ab: 360, h: 85, double: 12, hr: 4, bb: 28, ibb: 0, hbp: 2, sf: 2, sh: 8, so: 85 }),
  // ⚠희생번트가 많은 약타자 — 잔차를 만드는 쪽이다
  line({ pa: 120, ab: 95, h: 15, double: 2, hr: 0, bb: 6, ibb: 0, hbp: 0, sf: 1, sh: 18, so: 45 }),
];

test("⚠wOBA 분모로 가중한 편차의 합은 0이다 — **이것이 상수가 정확하다는 뜻이다**", () => {
  const sum = deviationSum(LEAGUE, wobaDenominator);
  assert.ok(Math.abs(sum) < 1e-9, `0이어야 한다: ${sum}`);
});

test("⚠PA로 가중하면 0이 아니다 — 犠打·敬遠이 wOBA 분모에 없기 때문이다. **버그가 아니다**", () => {
  const byPa = deviationSum(LEAGUE, (l) => l.pa);
  assert.ok(Math.abs(byPa) > 1e-6, "잔차가 0이면 이 픽스처가 현실을 못 담고 있다");

  // 잔차는 정확히 「PA에는 있고 wOBA 분모에는 없는 타석」이다
  const bySh = deviationSum(LEAGUE, (l) => l.pa - wobaDenominator(l));
  assert.ok(
    Math.abs(byPa - bySh) < 1e-9,
    `잔차가 犠打+敬遠 항으로 설명되지 않는다: ${byPa} vs ${bySh}`,
  );
});

test("희생번트가 많은 약타자가 잔차를 음수로 만든다 — 실데이터의 부호와 같다", () => {
  const withBunter = deviationSum(LEAGUE, (l) => l.pa);
  assert.ok(withBunter < 0, `실데이터에서도 음수였다: ${withBunter}`);

  // 번트를 빼면 잔차가 줄어든다
  const noBunts = LEAGUE.map((l) => ({ ...l, sh: 0, pa: l.pa - l.sh }));
  const without = deviationSum(noBunts, (l) => l.pa);
  assert.ok(
    Math.abs(without) < Math.abs(withBunter),
    `번트를 빼면 잔차가 줄어야 한다: ${without} vs ${withBunter}`,
  );
});

test("리그 평균 wOBA는 합산 라인의 wOBA와 같다 — 선수별 평균이 아니다", () => {
  const lc = leagueConstants({
    season: 2026,
    league: "test",
    batting: sumBatting(LEAGUE),
    pitching: PITCHING,
    runs: 500,
  });
  assert.equal(lc.averageWoba, woba(sumBatting(LEAGUE)).value);

  // ⚠선수별 단순 평균과는 다르다. 이걸 헷갈리면 상수가 조용히 어긋난다
  const naive = LEAGUE.reduce((n, l) => n + (woba(l).value ?? 0), 0) / LEAGUE.length;
  assert.notEqual(lc.averageWoba, naive);
});

test("리그 방어율과 FIP 상수가 서로를 상쇄한다 — 리그 FIP = 리그 ERA", () => {
  const lc = leagueConstants({
    season: 2026,
    league: "test",
    batting: sumBatting(LEAGUE),
    pitching: PITCHING,
    runs: 500,
  });
  const leagueEra = (PITCHING.er * 27) / PITCHING.outs;
  const raw =
    ((13 * PITCHING.hr + 3 * (PITCHING.bb + PITCHING.hbp) - 2 * PITCHING.so) * 3) / PITCHING.outs;
  assert.ok(Math.abs(raw + lc.cFip - leagueEra) < 1e-9);
});
