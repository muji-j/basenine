/**
 * **併殺打를 NPB 공표치와 맞대 본다** — 픽스처가 아니라 실DB로.
 *
 * ⚠**픽스처는 내가 만든 세계라 내 오해가 그대로 통과한다**(`race-seasons.test.ts` 와 같은 이유).
 * `gidp.test.ts` 의 `遊併失` 한 줄은 **내가 옳다고 믿는 것**을 적은 것이고, 그것이 옳다는 증거는
 * 여기에만 있다: `career_batting.gidp` 는 **선수 페이지에서 받아 온 NPB 공표치**이고
 * 우리 `pa_event` 와 **출처가 다르다**(M4).
 *
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7·8).
 *
 * ⚠**`career_batting` 은 현재 등록 선수만 담는다.** 그래서 이 대조는 리그 전량이 아니다 —
 * 9시즌 併殺打 10,068건 중 대조 가능한 것은 선수-시즌 3,177건이다(2026-08-20 실측).
 * 은퇴·이적으로 NPB 를 떠난 선수는 공표치 쪽 행이 아예 없어서 여기서 빠진다.
 * **그 사실을 적어 두지 않으면 「전 시즌 전량 대조」로 읽힌다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * 우리 값. **`gidp.ts` 의 판정식과 같은 것을 쓴다** — 여기서 다른 식을 쓰면
 * 「두 개의 내 계산이 서로 같다」밖에 증명하지 못한다.
 */
const OURS = `
SELECT g.season AS season, e.batter_id AS pid,
       SUM(CASE WHEN e.outcome = 'groundedIntoDoublePlay' OR e.raw_box LIKE '%併失%' THEN 1 ELSE 0 END) AS gidp
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final'
GROUP BY g.season, e.batter_id
`;

/** 併失 을 뺀 판정. **이 시험이 실제로 그 함정을 재고 있는지**를 확인하는 데만 쓴다 */
const WITHOUT_ERROR_DP = OURS.replace(" OR e.raw_box LIKE '%併失%'", "");

/**
 * NPB 공표치. ⚠**연도로 묶는다** — 시즌 도중 이적하면 `(선수, 연도, 구단)` 으로 여러 줄이다.
 * ⚠**포스트시즌을 담지 않는다**(선수 페이지의 年度別成績은 정규시즌이다) — 그래서 우리 쪽도
 * `competition = 'regular'` 로 자른다. 섞으면 CS·일본시리즈 몫만큼 우리가 많아진다.
 */
const OFFICIAL = `SELECT year, player_id AS pid, SUM(gidp) AS gidp FROM career_batting GROUP BY year, player_id`;

interface Compared {
  compared: number;
  mismatches: string[];
  bySeason: Map<number, number>;
}

function compare(db: DatabaseSync, sql: string): Compared {
  const ours = db.prepare(sql).all() as unknown as { season: number; pid: string; gidp: number }[];
  const official = db.prepare(OFFICIAL).all() as unknown as { year: number; pid: string; gidp: number }[];
  const mine = new Map(ours.map((r) => [`${r.season}|${r.pid}`, Number(r.gidp)]));

  const out: Compared = { compared: 0, mismatches: [], bySeason: new Map() };
  for (const r of official) {
    const key = `${r.year}|${r.pid}`;
    const got = mine.get(key);
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
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const got = compare(db, OURS);

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
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const without = compare(db, WITHOUT_ERROR_DP);
    assert.ok(without.compared >= 3000, `대조한 선수-시즌이 ${without.compared}건뿐이다 — 이 시험이 공회전한다`);
    assert.ok(
      without.mismatches.length > 0,
      "`併失` 을 빼도 공표치와 전부 맞는다 — 아카이브에서 그 타석이 사라졌거나 판정이 이미 다른 곳에서 보정되고 있다",
    );
  } finally {
    db.close();
  }
});
