/**
 * **포스트시즌이 정규시즌 「予定」으로 새지 않는가**(§2-1).
 *
 * ⚠**이 시험이 지키는 사실은 실측이다**(2026-08-18):
 * - 2025-10 일정 페이지를 파싱하면 31경기가 나오는데 그중 **클라이맥스 13 · 일본시리즈 5**다.
 * - 일정 페이지에는 대회 표시가 **없다** — `<table>` 이 1개뿐이고 CS 행이 정규 행과 모양이 같다.
 * - 그래서 가를 근거는 「팀당 143경기」뿐이고, 그 143은 **2022~2025 × 12팀 = 48개가 전부 143**이었다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { regularSeasonUpcoming } from "../src/calendar.ts";
import { REGULAR_SEASON_GAMES } from "@bb-app/domain";

test("143에 닿은 팀에는 앞으로의 정규시즌 경기가 없다 — CS가 여기로 샌다", () => {
  const cs = ["10/11 CS1", "10/12 CS2", "10/13 CS3"];
  assert.deepEqual(
    regularSeasonUpcoming(cs, REGULAR_SEASON_GAMES, REGULAR_SEASON_GAMES),
    [],
    "143경기를 다 치른 팀에 「予定」이 남으면 그건 포스트시즌이다",
  );
});

test("143을 넘겨 치른 시즌에도 음수로 뒤집히지 않는다", () => {
  assert.deepEqual(regularSeasonUpcoming(["a", "b"], 150, REGULAR_SEASON_GAMES), []);
});

test("남은 만큼만 남기고 뒤에서 자른다", () => {
  const up = ["9/28", "9/30", "10/1", "10/11 CS", "10/12 CS"];
  assert.deepEqual(
    regularSeasonUpcoming(up, REGULAR_SEASON_GAMES - 3, REGULAR_SEASON_GAMES),
    ["9/28", "9/30", "10/1"],
    "3경기 남은 팀에는 앞의 3개만 남아야 한다",
  );
});

test("시즌 중반에는 아무것도 자르지 않는다 — 지금 화면이 얇아지면 안 된다", () => {
  const up = Array.from({ length: 37 }, (_, i) => `g${i}`);
  assert.equal(
    regularSeasonUpcoming(up, 100, REGULAR_SEASON_GAMES).length,
    37,
    "100경기 치른 팀은 43경기가 남으므로 37건이 그대로 보여야 한다",
  );
});

test("143은 도메인 한 벌에서 온다(M1)", () => {
  assert.equal(REGULAR_SEASON_GAMES, 143);
});
