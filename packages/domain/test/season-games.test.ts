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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { REGULAR_SEASON_GAMES, regularSeasonGames } from "../src/index.ts";

test("보유 시즌은 전부 143이다 — 실측으로 확인한 값", () => {
  for (const s of [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]) {
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

/**
 * ⚠**주석이 아니라 시험이 이 사실을 지키게 한다**(2026-08-18 감사 P3).
 *
 * 위 시험들은 시즌 목록을 **손으로 적어** 두었다. 그래서 백필로 시즌이 늘어도
 * **새 시즌은 아무도 안 본다** — 실제로 `REGULAR_SEASON_GAMES` 의 근거 주석이
 * 「2022~2025 4시즌」에 멈춰 있는 동안 DB 는 이미 2019~2026 이었다.
 *
 * → **DB 가 실제로 보유한 전 시즌**을 훑는다. 백필로 시즌이 늘면 여기서 먼저 깨진다.
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). 다만 CI 에서는
 *   `BB_REQUIRE_DB=1` 로 **건너뛰기 자체를 막을** 수 있다 — 「0건 통과」와 「안 쟀음」을 가른다.
 */
const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const REQUIRE_DB = process.env["BB_REQUIRE_DB"] === "1";
if (REQUIRE_DB && !existsSync(DB)) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

test("⚠보유한 모든 시즌에서 12팀의 소화 경기수가 이 표와 맞는다", {
  skip: existsSync(DB) ? false : "data/bb.sqlite 없음",
}, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT season, code, COUNT(*) n FROM (
           SELECT season, away_code AS code FROM game
             WHERE status='played' AND competition='regular'
           UNION ALL
           SELECT season, home_code FROM game
             WHERE status='played' AND competition='regular'
         ) GROUP BY season, code`,
      )
      .all() as { season: number; code: string; n: number }[];
    assert.ok(rows.length > 0, "경기가 하나도 없다 — 이 시험이 아무것도 안 재고 있다");

    const bySeason = new Map<number, { code: string; n: number }[]>();
    for (const r of rows) bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);

    /**
     * ⚠**진행 중인 시즌은 아직 143 이 아니다.** 「지금까지 치른 수」와 「최종 경기수」는 다르다 —
     * 그래서 **완결된 시즌만** 본다(12팀이 전부 같은 수이고 그 수가 표의 값과 같은가).
     * 진행 중인 시즌에는 대신 **표의 값을 넘지 않는가**만 본다.
     */
    let finished = 0;
    for (const [season, teams] of [...bySeason].sort((a, b) => a[0] - b[0])) {
      assert.equal(teams.length, 12, `${season}: 구단이 ${teams.length}개다 — 슬러그가 바뀌었을 수 있다`);
      const want = regularSeasonGames(season);
      const counts = [...new Set(teams.map((t) => t.n))];
      const max = Math.max(...counts);
      assert.ok(max <= want, `${season}: ${max}경기로 표의 ${want}를 넘었다 — 표를 고쳐라`);
      if (counts.length === 1 && counts[0] === want) finished += 1;
    }
    assert.ok(finished >= 2, `완결 시즌을 ${finished}개밖에 못 봤다 — 이 시험이 공회전한다`);
  } finally {
    db.close();
  }
});
