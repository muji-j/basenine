import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NON_TEAM_CODES,
  TEAM_CODE_ALIASES,
  TEAMS,
  canonicalTeamCode,
  colorOf,
  competitionOf,
  leagueOf,
  shortNameOf,
  teamOf,
} from "../src/index.ts";

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

/**
 * ⚠**npb.jp 의 URL 슬러그는 불변이 아니다**(2026-08-18 · 2018 백필에서 실측으로 알았다).
 *
 * 오릭스는 **2018 시즌까지 `bs`, 2019 시즌부터 `b`** 다.
 * 모른 채 백필했더니 **148경기가 「모르는 팀 코드」로 실패**했다 —
 * 그대로 뒀으면 2018 오릭스의 성적이 화면에서 사라진 채
 * **「그 시즌은 원래 그렇다」로 읽혔을 것**이다.
 * ⚠**조용히 넘기지 않는 설계가 이걸 잡았다**(M7) — 0으로 흘렸으면 못 봤다.
 */
test("⚠옛 슬러그(오릭스 bs)를 지금 구단으로 읽는다 — 한 시즌이 통째로 사라지지 않게", () => {
  assert.equal(canonicalTeamCode("bs"), "b");
  assert.equal(teamOf("bs").name, "オリックス・バファローズ");
  assert.equal(leagueOf("bs"), "pacific");
  // ⚠**색도 따라와야 한다** — 아니면 2018 화면에서 그 구단만 회색이 된다
  assert.deepEqual(colorOf("bs"), colorOf("b"));
  assert.equal(shortNameOf("bs"), shortNameOf("b"));
  // ⚠**구분 판정도 통과해야 한다** — 여기서 던지면 그 경기가 통째로 적재에서 빠진다
  assert.equal(competitionOf("bs", "m"), "regular");
});

/**
 * ⚠**별칭은 「우리가 확인한 것」만 넣는다.** 폭넓은 규칙을 넣는 순간
 * 다음 슬러그 변경이 조용히 흡수되어, 그때는 아무도 모른다.
 */
test("⚠모르는 코드는 여전히 예외다 — 별칭이 문을 열어 두지 않는다", () => {
  assert.equal(canonicalTeamCode("zz"), "zz", "모르는 코드를 임의로 바꿨다");
  assert.throws(() => teamOf("zz"), RangeError);
  assert.throws(() => competitionOf("zz", "t"), RangeError);
  assert.deepEqual(Object.keys(TEAM_CODE_ALIASES), ["bs"], "별칭이 늘었다 — 근거를 주석에 남겼는가");
});
