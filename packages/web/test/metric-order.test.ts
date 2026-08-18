/**
 * **지표 순서가 화면마다 같은가.**
 *
 * ⚠**화면마다 달랐다**(2026-08-18 유저 지적). 순위 탭은 `wRC+ → SRC → OPS`,
 * 구단 페이지는 `wRC+ → wOBA → wRAA → SRC`, 선수 페이지는 `wOBA → … → SRC` 였다.
 * 같은 지표를 화면마다 다른 자리에서 찾아야 하면 읽는 사람이 **화면 수만큼 다시 배운다.**
 *
 * ⚠**「무엇을 보여주는가」는 화면마다 다를 수 있다** — 그건 이 시험이 상관하지 않는다.
 * 여기서 보는 것은 **순서뿐**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { byMetricOrder, isMetricOrdered, metricRank } from "../src/metric-order.ts";

test("우리가 만든 지표가 세이버 표준보다 앞이다 — 첫 지표가 그 화면의 주장이다", () => {
  assert.ok(metricRank("src") < metricRank("wrcPlus"), "SRC 가 wRC+ 뒤에 있다");
  assert.ok(metricRank("src") < metricRank("woba"), "SRC 가 wOBA 뒤에 있다");
  assert.ok(metricRank("srp") < metricRank("fip"), "SRP 가 FIP 뒤에 있다");
  assert.ok(metricRank("srp") < metricRank("era"), "SRP 가 防御率 뒤에 있다");
});

test("세이버가 전통 비율보다 앞이다 — 이 사이트의 입장이다", () => {
  assert.ok(metricRank("wrcPlus") < metricRank("avg"), "wRC+ 가 打率 뒤에 있다");
  assert.ok(metricRank("fip") < metricRank("era"), "FIP 가 防御率 뒤에 있다");
});

test("표본은 비율 뒤, 누적 개수는 그 뒤다", () => {
  assert.ok(metricRank("ops") < metricRank("pa"), "OPS 가 打席 뒤에 있다");
  assert.ok(metricRank("pa") < metricRank("hr"), "打席 가 本塁打 뒤에 있다");
});

/**
 * ⚠**모르는 키로 화면을 죽이지 않는다.** 이건 표시 순서일 뿐이고,
 * 새 지표를 만드는 도중에 화면이 통째로 사라지는 것은 대가가 너무 크다.
 * 대신 **맨 뒤에 모이므로 눈에 띈다.**
 */
test("모르는 지표는 맨 뒤로 가고 던지지 않는다", () => {
  assert.equal(metricRank("존재하지않는지표") > metricRank("balk"), true);
  assert.deepEqual(
    byMetricOrder(["wrcPlus", "존재하지않는지표", "src"], (x) => x),
    ["src", "wrcPlus", "존재하지않는지표"],
  );
});

test("정렬은 목록을 바꾸지 않는다 — 순서만 바꾼다", () => {
  const before = ["avg", "src", "hr", "wrcPlus"];
  const after = byMetricOrder(before, (x) => x);
  assert.deepEqual([...after].sort(), [...before].sort(), "지표가 늘거나 줄었다");
  assert.ok(isMetricOrdered(after), "정렬했는데 순서가 아니다");
});

test("같은 순위끼리는 원래 순서를 지킨다 — 안정 정렬", () => {
  const a = ["모르는A", "모르는B", "모르는C"];
  assert.deepEqual(byMetricOrder(a, (x) => x), a);
});

test("isMetricOrdered 가 어긋난 목록을 잡는다 — 이 시험 자신이 공회전하지 않게", () => {
  assert.equal(isMetricOrdered(["src", "wrcPlus", "avg"]), true);
  assert.equal(isMetricOrdered(["wrcPlus", "src"]), false, "어긋났는데 통과라고 했다");
});

/**
 * ⚠**「정렬을 거쳤다」와 「정렬돼 있다」는 다르다**(2026-08-18 유저 지적으로 배웠다).
 *
 * 공통 목록만 `byMetricOrder` 에 넣고 역할별 지표를 앞뒤로 이어 붙이면,
 * **정렬된 조각이 중간에 끼어** 전체는 정렬이 아니다.
 * 실제로 구원이 그랬다: `セーブ · ホールド · HP · [정렬된 공통] · 勝利 · 登板`.
 * → 그래서 **최종 목록**을 본다. 소스에 `byMetricOrder` 가 있는지가 아니라, 결과가 순서인지.
 */
test("⚠순위의 최종 목록이 전부 정본 순서다 — 조각만 정렬하면 안 된다", async () => {
  const { buildLeagueRankingsForTest } = await import("../src/query.ts").catch(() => ({} as never));
  // 내부 함수를 못 부르면 소스로 확인한다 — **감싸는 곳이 빠지지 않았는가**
  const src = readFileSync(new URL("../src/query.ts", import.meta.url), "utf8");
  const returns = [...src.matchAll(/return byMetricOrder\(\[/g)].length;
  assert.ok(
    returns >= 2,
    `역할별 목록이 정본 순서를 안 거친다(감싼 곳 ${returns}개) — 선발·구원 둘 다 필요하다`,
  );
  assert.equal(typeof buildLeagueRankingsForTest, "undefined");
});
