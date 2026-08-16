/**
 * 구장별 스플릿의 「접기」.
 *
 * ⚠**접는 것과 버리는 것은 다르다.** 접으면 합계가 남고, 버리면 사라진다.
 * 사라지면 「이 선수의 전 타석이 어딘가에 있다」고 말할 수 없게 되고,
 * 그때는 표가 틀린 게 아니라 **답할 수 없는** 상태가 된다 — 이 프로젝트에서 가장 피해야 할 것이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUE_MIN_PA, foldThinVenues } from "../src/query.ts";
import type { SplitRow } from "../src/player-page.ts";
import { battingAverage, onBasePercentage, ops, sluggingPercentage } from "@bb-app/metrics";
import type { BattingLine } from "@bb-app/metrics";

function line(pa: number, h = 0): BattingLine {
  return { pa, ab: pa, h, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0 };
}

function row(key: string, pa: number, h = 0, rbi = 0): SplitRow {
  const l = line(pa, h);
  return {
    key,
    label: key,
    line: l,
    rbi,
    avg: battingAverage(l),
    obp: onBasePercentage(l),
    slg: sluggingPercentage(l),
    ops: ops(l),
  };
}

test("두꺼운 구장은 그대로 남는다", () => {
  const out = foldThinVenues([row("甲子園", 177, 50), row("東京ドーム", 54, 18)]);
  assert.deepEqual(out.map((r) => r.key), ["甲子園", "東京ドーム"]);
});

test(`${VENUE_MIN_PA}타석 미만이 둘 이상이면 한 줄로 접는다`, () => {
  const out = foldThinVenues([row("甲子園", 100, 30), row("那覇", 4, 1), row("弘前", 3, 2)]);
  assert.deepEqual(out.map((r) => r.key), ["甲子園", "__other__"]);
  assert.match(out[1]!.label, /2球場/, "몇 곳을 합쳤는지 말하지 않았다");
});

test("⚠접어도 합계가 남는다 — 버리면 「전 타석이 어딘가에 있다」고 말할 수 없다", () => {
  const rows = [row("甲子園", 100, 30, 20), row("那覇", 4, 1, 1), row("弘前", 3, 2, 2), row("岐阜", 2, 0, 0)];
  const before = rows.reduce((n, r) => n + r.line.pa, 0);
  const out = foldThinVenues(rows);
  assert.equal(out.reduce((n, r) => n + r.line.pa, 0), before, "타석 합계가 달라졌다");
  assert.equal(out.reduce((n, r) => n + r.line.h, 0), 33, "안타 합계가 달라졌다");
  assert.equal(out.reduce((n, r) => n + r.rbi, 0), 23, "타점 합계가 달라졌다");
});

test("⚠접은 줄의 비율은 합친 라인에서 새로 계산한다 — 평균의 평균을 내지 않는다", () => {
  // 4타수 1안타 + 6타수 3안타 = 10타수 4안타 = .400
  // (비율을 평균하면 (.250 + .500) / 2 = .375로 틀린다)
  const out = foldThinVenues([row("A", 4, 1), row("B", 6, 3)]);
  const other = out.find((r) => r.key === "__other__")!;
  assert.equal(other.line.ab, 10);
  assert.equal(other.line.h, 4);
  assert.equal(other.avg.value, 0.4);
  assert.equal(other.avg.denominator, 10, "분모가 합쳐지지 않았다(M2)");
});

test("⚠얇은 곳이 하나뿐이면 접지 않는다 — 이름만 감추고 줄 수는 그대로다", () => {
  const out = foldThinVenues([row("甲子園", 100, 30), row("那覇", 4, 1)]);
  assert.deepEqual(out.map((r) => r.key), ["甲子園", "那覇"], "한 곳을 「その他」로 감췄다");
});

test("전부 얇아도 합계는 남는다", () => {
  const out = foldThinVenues([row("那覇", 4, 1), row("弘前", 3, 2), row("岐阜", 2, 0)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.line.pa, 9);
  assert.match(out[0]!.label, /3球場/);
});

test("빈 목록은 빈 목록이다 — 「その他 0球場」을 만들지 않는다", () => {
  assert.deepEqual(foldThinVenues([]), []);
});

test(`경계값 ${VENUE_MIN_PA}타석은 남는다 — 미만만 접는다`, () => {
  const out = foldThinVenues([row("A", VENUE_MIN_PA, 3), row("B", VENUE_MIN_PA - 1, 2), row("C", 1, 0)]);
  assert.ok(
    out.some((r) => r.key === "A"),
    "경계값이 접혔다",
  );
  assert.match(out.find((r) => r.key === "__other__")!.label, /2球場/);
});
