import { test } from "node:test";
import assert from "node:assert/strict";
import { NON_TEAM_CODES, TEAMS, competitionOf, leagueOf, teamOf } from "../src/index.ts";

/**
 * ⚠**건수를 테스트가 고정한다.** 한 팀이 빠지면 그 팀 선수 전원이 리그 집계에서
 * 조용히 사라진다 — 숫자로만 드러나므로 알아채기 어렵다.
 */
test("구단은 12개, 리그별 6개씩이다", () => {
  assert.equal(TEAMS.length, 12);
  assert.equal(TEAMS.filter((t) => t.league === "central").length, 6);
  assert.equal(TEAMS.filter((t) => t.league === "pacific").length, 6);
});

test("구단 코드는 중복되지 않는다", () => {
  assert.equal(new Set(TEAMS.map((t) => t.code)).size, 12);
});

test("코드로 구단과 리그를 찾는다", () => {
  assert.equal(teamOf("t").name, "阪神タイガース");
  assert.equal(leagueOf("t"), "central");
  assert.equal(leagueOf("h"), "pacific");
});

test("⚠모르는 코드는 조용히 넘기지 않고 던진다", () => {
  assert.throws(() => teamOf("xx"), RangeError);
});

test("정규시즌 판정", () => {
  assert.equal(competitionOf("t", "g"), "regular");
  assert.equal(competitionOf("db", "s"), "regular");
});

test("⚠올스타전은 정규시즌이 아니다 — 섞으면 성적이 부풀어 오른다", () => {
  // 실제로 佐藤(阪神)의 시즌 홈런이 2개 많았고, 그 차이가 올스타 2경기였다.
  assert.equal(competitionOf("cl", "pl"), "allStar");
  assert.equal(competitionOf("pl", "cl"), "allStar");
  assert.deepEqual(Object.keys(NON_TEAM_CODES).sort(), ["cl", "pl"]);
});

test("⚠모르는 코드 조합은 regular로 흘리지 않는다", () => {
  assert.throws(() => competitionOf("t", "zz"), RangeError);
  assert.throws(() => competitionOf("zz", "t"), RangeError);
});

test("⚠구단과 올스타 코드가 섞인 조합은 판정 불가로 던진다", () => {
  assert.throws(() => competitionOf("t", "cl"), RangeError);
});
