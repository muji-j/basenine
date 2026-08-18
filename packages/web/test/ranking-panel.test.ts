import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { panelsForPlayer } from "../src/query.ts";
import { rankingPanel } from "./fixtures.ts";

const ME = "41045153";

function withMe(rank: number | null, at: "inside" | "outside") {
  const base = rankingPanel();
  const mine = {
    rank,
    rankAll: rank,
    playerId: ME,
    name: "佐藤",
    teamCode: "t",
    value: { value: 98, denominator: 400 },
    isMe: false,
  };
  return at === "inside"
    ? rankingPanel({ rows: [mine, ...base.rows.slice(1)] })
    : rankingPanel({ rows: [...base.rows, mine] });
}

test("상위 N만 자른다", () => {
  const [panel] = panelsForPlayer([rankingPanel()], "다른선수", 5);
  assert.equal(panel!.rows.length, 5);
  assert.deepEqual(
    panel!.rows.map((r) => r.rank),
    [1, 2, 3, 4, 5],
  );
});

test("본인이 상위 밖이면 잘라낸 뒤에도 반드시 붙는다 — 「내가 몇 위인가」가 이 블록의 존재 이유다", () => {
  const [panel] = panelsForPlayer([withMe(42, "outside")], ME, 10);
  const rows = panel!.rows;
  assert.equal(rows.length, 11);
  assert.equal(rows.at(-1)!.playerId, ME);
  assert.equal(rows.at(-1)!.isMe, true);
  assert.equal(rows.at(-1)!.rank, 42);
});

test("본인이 상위 안에 있으면 중복해서 붙이지 않는다", () => {
  const [panel] = panelsForPlayer([withMe(1, "inside")], ME, 10);
  const mine = panel!.rows.filter((r) => r.playerId === ME);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.isMe, true);
  assert.equal(panel!.rows.length, 10);
});

test("자격 미달이라 순위가 없어도 본인 행은 나온다 — 「순위 없음」도 정보다(M11)", () => {
  const [panel] = panelsForPlayer([withMe(null, "outside")], ME, 10);
  const mine = panel!.rows.find((r) => r.playerId === ME);
  assert.notEqual(mine, undefined);
  assert.equal(mine!.rank, null);
});

test("순위표에 없는 선수면 아무것도 덧붙이지 않는다", () => {
  const [panel] = panelsForPlayer([rankingPanel()], "존재하지않음", 10);
  assert.equal(panel!.rows.length, 10);
  assert.ok(panel!.rows.every((r) => !r.isMe));
});

test("자격 기준 설명은 그대로 실려 나간다(M3)", () => {
  const [panel] = panelsForPlayer([rankingPanel()], ME, 3);
  assert.match(panel!.qualifier, /規定打席 332/);
});


/**
 * ⚠**첫 지표가 그 화면의 주장이다.**
 * 선발의 기본값이 「勝利」였는데, 승수는 타선과 구원진이 절반을 정한다 —
 * FIP·WHIP·SRP를 자체 산출하는 사이트가 선발을 승수로 먼저 보여주는 것은 자기모순이었다.
 */
test("⚠선발 순위의 기본 지표는 승수가 아니다 — 투수 자신을 재는 값이 먼저다", () => {
  const src = readFileSync(new URL("../src/query.ts", import.meta.url), "utf8");
  const m = /if \(role === "starter"\) \{[\s\S]*?return \[([\s\S]*?)\n    \];/.exec(src);
  assert.notEqual(m, null, "선발 순위 목록을 못 찾았다 — 이 시험이 공회전한다");
  const body = m![1] ?? "";
  const first = body.split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "")[0] ?? "";
  assert.ok(!first.includes("勝利"), `선발 첫 지표가 승수다: ${first}`);
  assert.ok(first.includes("...common"), `투수 자신을 재는 값이 먼저가 아니다: ${first}`);
  // ⚠승수를 **지운 것이 아니라 뒤로 옮긴 것**이다. 지우면 그것대로 정보 손실이다
  assert.ok(body.includes("勝利"), "승수를 통째로 없앴다");
  assert.ok(body.includes("QS"), "QS 를 순위에 안 실었다");
});

/**
 * ⚠**순서를 소스에서 읽어 못 박던 시험이었다**(첫 항목 = 防御率).
 *
 * 2026-08-18 에 순서를 **한 벌**(`metric-order.ts`)로 옮기면서 지키는 것도 옮긴다 —
 * 「첫 항목이 무엇인가」가 아니라 **「정본 순서를 거치는가」**를 본다.
 * 그래야 지표가 늘거나 순서 방침이 바뀌어도 이 시험이 계속 뜻을 갖는다.
 * ⚠**순서 자체의 옳고 그름은 `metric-order.test.ts` 가 본다** — 여기서 두 벌로 만들지 않는다.
 */
test("순위의 지표 목록이 정본 순서를 거친다 — 화면마다 다른 순서를 만들지 않는다", () => {
  const src = readFileSync(new URL("../src/query.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /const common: MetricRanking\[\] = byMetricOrder\(\[/,
    "투수 지표 목록이 정본 순서를 거치지 않는다",
  );
  assert.match(
    src,
    /const batting: MetricRanking\[\] = byMetricOrder\(\[/,
    "타자 지표 목록이 정본 순서를 거치지 않는다",
  );
});
