/**
 * 시즌별 정규시즌 경기 수.
 *
 * ⚠**143 고정은 2020년에서 깨진다** — 코로나로 120경기였다.
 * 이 시험은 「시즌을 받는 함수가 있다」와 「모르는 해는 143이다」를 못 박는다.
 * ⚠**2020 의 120 은 실측이다**(2026-08-18 백필 후 · 12팀 전부 120).
 * 「알려진 사실」을 먼저 적어 두지 않았다 — 그러면 그것이 판정 기준이 되어 버리고,
 * 이 리포는 이미 그런 사고를 겪었다(CLAUDE.md 소급 범위).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGULAR_SEASON_GAMES, regularSeasonGames } from "../src/index.ts";

test("보유 시즌은 전부 143이다 — 실측으로 확인한 값", () => {
  for (const s of [2021, 2022, 2023, 2024, 2025, 2026]) {
    assert.equal(regularSeasonGames(s), 143, `${s}년이 143이 아니다`);
  }
});

test("⚠2020 은 120 이다 — 코로나로 단축된 해", () => {
  assert.equal(regularSeasonGames(2020), 120, "2020 이 143 이면 잔여가 음수가 되고 환산 기준이 틀린다");
});

test("모르는 해는 기본값으로 떨어진다 — 조용히 0이 되지 않는다", () => {
  assert.equal(regularSeasonGames(1999), REGULAR_SEASON_GAMES);
  assert.equal(REGULAR_SEASON_GAMES, 143);
});
