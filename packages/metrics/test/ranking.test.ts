import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifiedBatterPa, qualifiedPitcherOuts, rankBy } from "../src/ranking.ts";
import { rate } from "../src/rate.ts";

/**
 * **규정타석은 외부 규칙이다 — 외부 문구에 못 박는다.**
 *
 * ⚠**이 자리에 있던 시험이 결함을 통과시켰다**(2026-08-20 P0). 예전 단언은
 * `assert.equal(qualifiedBatterPa(143), Math.ceil(143 * 3.1))` 이었다 —
 * **구현과 같은 식을 기댓값으로 썼으므로** 구현이 무엇이든 통과한다.
 * 시험 1,087본 중 어느 것도 이 결함을 못 잡은 이유가 정확히 이것이다.
 * → 기댓값은 **npb.jp 가 공표한 수**여야 한다. 식을 다시 쓰지 않는다.
 *
 * 공표 각주(`https://npb.jp/bis/2023/stats/bat_c.html`):
 *   「規定打席 ：チーム試合数×3.1 （端数は四捨五入）」
 *
 * 143 × 3.1 = 443.3 → **四捨五入 443**. `Math.ceil` 은 444 를 내어 **항상 1 높았다.**
 * 실측 피해(2026-08-20 · DB 5,474 선수-팀-시즌): 경계 **4건**이 8개 비율 순위에서 통째로 빠졌다 —
 * `2021 楽天 辰己(443타석 .225)` · `2023 広島 西川(443 .305)` ·
 * `2024 広島 野間(443 .271)` · `2025 SB 牧原(443 .304)`.
 * 2025 퍼시픽 打率는 공식 1위 牧原 .304 가 사라져 **柳町 .292 가 1위로 나가고 있었다.**
 */
test("규정타석 143경기 = 443 — npb.jp 공표 각주「端数は四捨五入」", () => {
  // ⚠기댓값을 식으로 쓰지 마라. 이 443 은 npb.jp 가 공표한 수다
  assert.equal(qualifiedBatterPa(143), 443, "143 × 3.1 = 443.3 → 四捨五入 443. 444 는 切り上げ다");
  assert.equal(qualifiedBatterPa(0), 0);
});

/**
 * **2020 은 120경기 시즌이다**(코로나). 시즌마다 다른 값이 같은 규칙을 타는지 본다.
 * 120 × 3.1 = 372.0 — 끝수가 없어 어느 규칙으로도 372 다.
 * ⚠**그래서 이 수만으로는 아무것도 못 잰다.** 끝수가 있는 143 과 **함께** 둘 때만 뜻이 있다.
 */
test("2020 은 120경기 → 372", () => {
  assert.equal(qualifiedBatterPa(120), 372);
});

/**
 * **끝수 .5 는 올린다**(四捨五入). 팀 경기수가 10의 배수 + 5 인 자리가 전부 여기다.
 * ⚠`Math.floor`/`Math.trunc` 로 바꾸면 이 시험이 떨어진다.
 */
test("끝수가 정확히 .5 면 올린다 — 115경기 → 357", () => {
  assert.equal(qualifiedBatterPa(115), 357, "115 × 3.1 = 356.5 → 四捨五入 357");
  assert.equal(qualifiedBatterPa(5), 16, "5 × 3.1 = 15.5 → 16");
});

/**
 * **전 구간을 정수 산술 기준값과 맞춘다.**
 *
 * ⚠기준값은 **구현과 다른 방법**으로 만든다 — `n = g × 31` 의 **나머지가 5 이상이면 올린다**는
 * 四捨五入 정의를 그대로 쓴다. 부동소수 곱이 한 번도 안 들어가므로 구현이 부동소수에서
 * 흔들리면 여기서 갈린다.
 *
 * ⚠**시즌 진행 중에도 산다.** 이 결함은 143경기에서만 나는 것이 아니라
 * **팀 소화 경기수 mod 10 ∈ {1,2,3,4}** 인 모든 날에 기준을 1 높였다.
 * 실측(2026-08-20): 0~143 중 `Math.ceil` 과 갈리는 값이 **59개**다.
 */
test("0~143 전 구간이 四捨五入 정의와 일치한다", () => {
  const 四捨五入 = (g: number): number => {
    const n = g * 31; // 정수. 부동소수 곱을 쓰지 않는다
    const r = n % 10;
    return (n - r) / 10 + (r >= 5 ? 1 : 0);
  };
  const mismatched: string[] = [];
  for (let g = 0; g <= 143; g += 1) {
    if (qualifiedBatterPa(g) !== 四捨五入(g)) mismatched.push(`${g}→${qualifiedBatterPa(g)}(≠${四捨五入(g)})`);
  }
  assert.deepEqual(mismatched, [], `144개 중 ${mismatched.length}개가 어긋났다: ${mismatched.slice(0, 12).join(" ")}`);

  // ⚠**공회전 방지**(작업규칙 8). 위 루프가 실제로 「切り上げ와 갈리는」 자리를 지났는지 센다 —
  // 안 그러면 이 시험은 「돌긴 돌았다」만 말하고 결함을 못 잡는다
  let differsFromCeil = 0;
  for (let g = 0; g <= 143; g += 1) if (Math.ceil(g * 3.1) !== 四捨五入(g)) differsFromCeil += 1;
  assert.equal(differsFromCeil, 59, "切り上げ와 갈리는 자리가 59개가 아니다 — 이 시험이 재려던 것을 못 재고 있다");
});

test("규정투구회 = 팀 경기수 × 1이닝 → 아웃으로 환산", () => {
  assert.equal(qualifiedPitcherOuts(143), 429);
  assert.equal(qualifiedPitcherOuts(0), 0);
});

const rows = [
  { name: "A", r: rate(30, 100) }, // .300
  { name: "B", r: rate(35, 100) }, // .350
  { name: "C", r: rate(35, 100) }, // .350 동률
  { name: "D", r: rate(40, 100) }, // .400
  { name: "E", r: rate(4, 10) },   // .400 이지만 표본 미달
  { name: "F", r: rate(0, 0) },    // 값 없음
];

const ranked = () => rankBy(rows, (x) => x.r, { minDenominator: 100, higherIsBetter: true });

test("높을수록 좋은 지표는 내림차순", () => {
  assert.deepEqual(
    ranked().filter((o) => o.rank !== null).map((o) => [o.item.name, o.rank]),
    [["D", 1], ["B", 2], ["C", 2], ["A", 4]],
  );
});

test("⚠동률은 같은 순위를 받고 다음 순위를 건너뛴다", () => {
  assert.equal(ranked().find((o) => o.item.name === "A")?.rank, 4, "공동 2위가 둘이면 다음은 4위다");
});

test("⚠자격 미달은 순위가 null이며 목록에서 사라지지 않는다", () => {
  const e = ranked().find((o) => o.item.name === "E");
  assert.ok(e, "미달 선수도 결과에 남아야 한다 — 성적은 있는데 순위만 없는 것이다");
  assert.equal(e.rank, null);
  assert.equal(e.rate.value, 0.4, "성적 자체는 그대로 보인다");
});

test("⚠값이 없는 선수도 순위가 null이다", () => {
  assert.equal(ranked().find((o) => o.item.name === "F")?.rank, null);
});

test("결과에 전원이 남는다 — 분모가 보존된다", () => {
  assert.equal(ranked().length, rows.length);
});

test("낮을수록 좋은 지표는 오름차순", () => {
  const era = [
    { name: "X", r: rate(2, 1) },
    { name: "Y", r: rate(3, 1) },
    { name: "Z", r: rate(1, 1) },
  ];
  assert.deepEqual(
    rankBy(era, (x) => x.r, { minDenominator: 1, higherIsBetter: false }).map((o) => [o.item.name, o.rank]),
    [["Z", 1], ["X", 2], ["Y", 3]],
  );
});

test("전원 동률이면 전원 1위다", () => {
  const same = [
    { name: "P", r: rate(1, 2) },
    { name: "Q", r: rate(1, 2) },
    { name: "R", r: rate(1, 2) },
  ];
  const out = rankBy(same, (x) => x.r, { minDenominator: 1, higherIsBetter: true });
  assert.deepEqual(out.map((o) => o.rank), [1, 1, 1]);
});

test("빈 목록은 빈 결과다", () => {
  assert.deepEqual(rankBy([], (x: { r: ReturnType<typeof rate> }) => x.r, { minDenominator: 1, higherIsBetter: true }), []);
});
