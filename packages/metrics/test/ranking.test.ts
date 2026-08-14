import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifiedBatterPa, qualifiedPitcherOuts, rankBy } from "../src/ranking.ts";
import { rate } from "../src/rate.ts";

test("규정타석 = 팀 경기수 × 3.1 (NPB)", () => {
  assert.equal(qualifiedBatterPa(143), Math.ceil(143 * 3.1));
  assert.equal(qualifiedBatterPa(0), 0);
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
