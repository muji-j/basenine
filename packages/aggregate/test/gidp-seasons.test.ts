/**
 * **併殺打를 NPB 공표치와 맞대 본다** — 픽스처가 아니라 실DB로.
 *
 * ⚠**픽스처는 내가 만든 세계라 내 오해가 그대로 통과한다**(`race-seasons.test.ts` 와 같은 이유).
 * `gidp.test.ts` 의 `遊併失` 한 줄은 **내가 옳다고 믿는 것**을 적은 것이고, 그것이 옳다는 증거는
 * 여기에만 있다: `career_batting.gidp` 는 **선수 페이지에서 받아 온 NPB 공표치**이고
 * 우리 `pa_event` 와 **출처가 다르다**(M4).
 *
 * ⚠**출하 코드를 부른다 — 판정식을 베끼지 않는다**(2026-08-20 이중 검토 P2에서 고쳤다).
 * 처음에는 `gidp.ts` 의 SQL 을 문자열로 복사해 갖고 있었다. 그래서 **`gidp.ts` 에서 `併失` 분기를
 * 지워도 이 파일은 두 시험 다 초록**이었다 — 즉 정의서가 이 지표에 붙인 **T1 등급의 근거가 되는
 * 시험이 출하 코드를 한 번도 실행하지 않았다.** `competition`·`status='played'`·`e.status='final'`
 * 같은 경계가 어긋나도 마찬가지였다.
 * → 우리 값은 **`groundedIntoDoublePlays()` 에서 받고**, 복사한 SQL 은 아래 두 번째 시험
 *   (「`併失` 을 빼면 어긋나는가」)에만 남긴다. 거기서는 **일부러 다른 판정**을 써야 하기 때문이다.
 *
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7·8).
 *
 * ⚠**`career_batting` 은 현재 등록 선수만 담는다.** 그래서 이 대조는 리그 전량이 아니다 —
 * 9시즌 **정규시즌** 併殺打 **9,887건** 중 대조된 몫은 **8,066건**(선수-시즌 3,177건)이다.
 * ⚠전 대회 합계 10,068 과 섞어 적지 마라(§2-1) — 이 시험은 `competition='regular'` 만 본다.
 * 은퇴·이적으로 NPB 를 떠난 선수는 공표치 쪽 행이 아예 없어서 여기서 빠진다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { groundedIntoDoublePlays } from "../src/gidp.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** ⚠**`through` 를 열어 둔다** — 이 시험은 시즌 전량을 본다 */
const THROUGH = "9999-12-31";

function seasonsOf(db: Db): number[] {
  return (
    db.raw
      .prepare(
        `SELECT DISTINCT season FROM game
         WHERE status = 'played' AND competition = 'regular' ORDER BY season`,
      )
      .all() as { season: number }[]
  ).map((r) => r.season);
}

/**
 * **출하 코드가 내는 값**. 선수 × 구단으로 나오므로 선수로 접는다 —
 * 공표치가 연도로 묶여 있기 때문이다(시즌 도중 이적하면 여러 줄).
 */
function shipped(db: Db, seasons: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const season of seasons) {
    for (const r of groundedIntoDoublePlays(db, season, "regular", THROUGH)) {
      const k = `${season}|${r.playerId}`;
      out.set(k, (out.get(k) ?? 0) + r.gidp);
    }
  }
  return out;
}

/**
 * ⚠**`併失` 을 뺀 판정.** 아래 두 번째 시험에서만 쓴다 — 거기서는 **출하 코드와 다른 판정**을
 * 일부러 써야 하므로 SQL 을 직접 쓴다. 위 시험은 이것을 쓰지 않는다.
 */
const WITHOUT_ERROR_DP = `
SELECT g.season AS season, e.batter_id AS pid,
       SUM(CASE WHEN e.outcome = 'groundedIntoDoublePlay' THEN 1 ELSE 0 END) AS gidp
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final'
GROUP BY g.season, e.batter_id
`;

function withoutErrorDp(db: Db): Map<string, number> {
  const rows = db.raw.prepare(WITHOUT_ERROR_DP).all() as unknown as
    { season: number; pid: string; gidp: number }[];
  return new Map(rows.map((r) => [`${r.season}|${r.pid}`, Number(r.gidp)]));
}

const OFFICIAL = `SELECT year, player_id AS pid, SUM(gidp) AS gidp FROM career_batting GROUP BY year, player_id`;

interface Compared {
  compared: number;
  mismatches: string[];
  bySeason: Map<number, number>;
}

function compare(db: Db, mine: ReadonlyMap<string, number>): Compared {
  const official = db.raw.prepare(OFFICIAL).all() as unknown as
    { year: number; pid: string; gidp: number }[];

  const out: Compared = { compared: 0, mismatches: [], bySeason: new Map() };
  for (const r of official) {
    const got = mine.get(`${r.year}|${r.pid}`);
    // 우리 아카이브에 그 시즌의 타석 로그가 없는 선수(=보유 시즌 밖)는 대조 대상이 아니다
    if (got === undefined) continue;
    out.compared += 1;
    out.bySeason.set(r.year, (out.bySeason.get(r.year) ?? 0) + 1);
    if (got !== Number(r.gidp)) {
      out.mismatches.push(`${r.year} ${r.pid}: 公表 ${r.gidp} · 当サイト ${got}`);
    }
  }
  return out;
}

test("⚠併殺打가 NPB 공표치와 일치한다 — 출처가 다른 두 값을 맞댄다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const seasons = seasonsOf(db);
    assert.ok(seasons.length >= 9, `정규시즌이 ${seasons.length}개뿐이다 — 이 시험이 공회전한다`);
    const got = compare(db, shipped(db, seasons));

    /**
     * ⚠**공회전 방지.** 대조 대상이 0명이면 `mismatches` 도 0이라 이 시험은
     * 「전부 통과」로 보이면서 아무것도 재지 않는다(작업규칙 8·9).
     * 기준선은 2026-08-20 실측 3,177건이다 — 시즌이 늘면 이 값도 올라간다.
     */
    assert.ok(got.compared >= 3000, `대조한 선수-시즌이 ${got.compared}건뿐이다 — 이 시험이 공회전한다`);
    // 한 시즌에 쏠려 있으면 「9시즌을 쟀다」가 거짓이 된다
    assert.ok(got.bySeason.size >= 9, `대조한 시즌이 ${got.bySeason.size}개뿐이다 — ${[...got.bySeason.keys()].join(" ")}`);

    assert.deepEqual(
      got.mismatches.slice(0, 10),
      [],
      `공표치와 어긋난 선수-시즌 ${got.mismatches.length}건 / 대조 ${got.compared}건`,
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**이 시험이 그 함정을 실제로 재고 있는가**(작업규칙 9의 정신).
 *
 * 위 시험은 `併失` 을 빼도 통과할 수 있다 — 해당 타석이 아카이브에 없으면 그렇다.
 * 그러면 위 시험은 초록인데 **함정은 안 재고 있는** 상태가 된다.
 * 여기서 「빼면 어긋난다」를 직접 확인해 그 상태를 막는다.
 * 실측(2026-08-20): 어긋나는 선수-시즌 **14건**(2022:3 · 2023:6 · 2024:3 · 2025:1 · 2026:1).
 */
test("⚠`併失` 을 빼면 공표치와 어긋난다 — 위 시험이 이 함정을 재고 있다는 증거", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const without = compare(db, withoutErrorDp(db));
    assert.ok(without.compared >= 3000, `대조한 선수-시즌이 ${without.compared}건뿐이다 — 이 시험이 공회전한다`);
    assert.ok(
      without.mismatches.length > 0,
      "`併失` 을 빼도 공표치와 전부 맞는다 — 아카이브에서 그 타석이 사라졌거나 판정이 이미 다른 곳에서 보정되고 있다",
    );
  } finally {
    db.close();
  }
});
