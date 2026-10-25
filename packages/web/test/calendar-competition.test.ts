/**
 * **포스트시즌이 정규시즌 「予定」으로 새지 않는가**(§2-1).
 *
 * ⚠**이 시험이 지키는 사실은 실측이다**(2026-08-18):
 * - 2025-10 일정 페이지를 파싱하면 31경기가 나오는데 그중 **클라이맥스 13 · 일본시리즈 5**다.
 * - 일정 페이지에는 대회 표시가 **없다** — `<table>` 이 1개뿐이고 CS 행이 정규 행과 모양이 같다.
 * - 그래서 가를 근거는 「팀당 143경기」뿐이고, 그 143은 **2022~2025 × 12팀 = 48개가 전부 143**이었다.
 * ⚠~~`regularSeasonUpcoming`~~ 을 재던 시험이다 — 그 껍데기를 지우고(2026-10-25 · PR-3 검토 RS P3) **제품 코드가 부르는 `splitUpcoming` 의
 *   `regular`** 를 직접 잰다. 같은 컷 규칙의 입구가 둘이면 시험이 재는 것과 화면이 쓰는 것이 갈릴 수 있다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadedKey, splitUpcoming, withoutLoaded } from "../src/calendar.ts";
import { REGULAR_SEASON_GAMES } from "@bb-app/domain";

const regularOf = <T>(up: readonly T[], played: number): readonly T[] => splitUpcoming(up, played, REGULAR_SEASON_GAMES).regular;

test("143에 닿은 팀에는 앞으로의 정규시즌 경기가 없다 — CS가 여기로 샌다", () => {
  const cs = ["10/11 CS1", "10/12 CS2", "10/13 CS3"];
  assert.deepEqual(
    regularOf(cs, REGULAR_SEASON_GAMES),
    [],
    "143경기를 다 치른 팀에 「予定」이 남으면 그건 포스트시즌이다",
  );
});

test("143을 넘겨 치른 시즌에도 음수로 뒤집히지 않는다", () => {
  assert.deepEqual(regularOf(["a", "b"], 150), []);
});

test("남은 만큼만 남기고 뒤에서 자른다", () => {
  const up = ["9/28", "9/30", "10/1", "10/11 CS", "10/12 CS"];
  assert.deepEqual(
    regularOf(up, REGULAR_SEASON_GAMES - 3),
    ["9/28", "9/30", "10/1"],
    "3경기 남은 팀에는 앞의 3개만 남아야 한다",
  );
});

test("시즌 중반에는 아무것도 자르지 않는다 — 지금 화면이 얇아지면 안 된다", () => {
  const up = Array.from({ length: 37 }, (_, i) => `g${i}`);
  assert.equal(
    regularOf(up, 100).length,
    37,
    "100경기 치른 팀은 43경기가 남으므로 37건이 그대로 보여야 한다",
  );
});

test("143은 도메인 한 벌에서 온다(M1)", () => {
  assert.equal(REGULAR_SEASON_GAMES, 143);
});

/**
 * ⚠**이미 적재된 경기를 예정에서 뺀다 — 다중집합으로**(2026-10-25 · PR-3 검토 GPT P2).
 * 낡은 사본에 남은 끝난 경기는 빠지고, **진짜 더블헤더에서 1경기만 적재됐으면 남은 경기는 남는다**(앞의 것부터 뺀다).
 * 다른 카드·다른 날은 건드리지 않는다.
 */
test("⚠적재된 경기만큼만 뺀다 — 진짜 더블헤더의 남은 경기는 남긴다(앞의 것부터)", () => {
  const up = [
    { date: "2026-08-10", home: "t", away: "g", tag: "8/10 1경기" },
    { date: "2026-08-10", home: "t", away: "g", tag: "8/10 2경기" },
    { date: "2026-08-10", home: "s", away: "d", tag: "8/10 다른 카드" },
    { date: "2026-08-11", home: "t", away: "g", tag: "8/11" },
  ];
  const loaded = new Map([[loadedKey("2026-08-10", "t", "g"), 1]]);
  assert.deepEqual(withoutLoaded(up, loaded).map((u) => u.tag), ["8/10 2경기", "8/10 다른 카드", "8/11"]);
  // 두 경기 다 적재됐으면 둘 다 빠진다 · 홈·원정이 뒤집힌 카드는 다른 경기다
  const both = new Map([[loadedKey("2026-08-10", "t", "g"), 2], [loadedKey("2026-08-11", "g", "t"), 1]]);
  assert.deepEqual(withoutLoaded(up, both).map((u) => u.tag), ["8/10 다른 카드", "8/11"]);
  // 입력을 바꾸지 않는다
  assert.equal(loaded.get(loadedKey("2026-08-10", "t", "g")), 1, "받은 지도를 고쳤다 — 다른 구단의 계산이 틀어진다");
});
