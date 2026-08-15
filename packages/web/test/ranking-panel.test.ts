import { test } from "node:test";
import assert from "node:assert/strict";
import { panelsForPlayer } from "../src/query.ts";
import { rankingPanel } from "./fixtures.ts";

const ME = "41045153";

function withMe(rank: number | null, at: "inside" | "outside") {
  const base = rankingPanel();
  const mine = {
    rank,
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
