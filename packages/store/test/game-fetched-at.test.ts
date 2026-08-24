/**
 * **`game.fetched_at` 은 「언제 받았는가」다 — 「언제 적재했는가」가 아니다**(M4).
 *
 * ⚠**7,805/7,805 전건이 적재 시각이었다**(2026-08-21 감사 [1] · 2026-08-24 수정).
 * 적재는 매일 돌고 아카이브 **전체**를 다시 훑으므로, 8월 15일에 받은 페이지가
 * **매일 「오늘 받은 것」**이 됐다. 그러면 「이 수치는 언제 것인가」에 답할 수 없다(M4).
 *
 * ⚠**014·017 이 통산 기록과 予告先発 에 한 것을 경기에는 안 했다** — 같은 병이 세 번째로 나왔다.
 *
 * ## 이 시험이 재는 것 — ⚠**「값이 있다」가 아니라 「값이 서로 다르다」**
 *
 * 적재 시각을 넣으면 **한 번의 적재에서 들어온 경기가 전부 같은 값**을 갖는다.
 * 취득 시각을 넣으면 **경기마다 다르다**(수집이 1req/2~5초라 초 단위로 갈린다).
 * 그래서 **서로 다른 값의 수**를 본다 — 「NULL 이 아니다」로는 이 결함을 못 잡는다.
 *
 * 실측(2026-08-24): 3일치 18경기를 다시 적재하니 **서로 다른 값 18개**가 됐고,
 * 안 건드린 옛 경기는 **전부 하나의 값**(`2026-08-21T13:44:50.740Z`)이었다 — 같은 DB 안에서 갈렸다.
 *
 * ⚠**임계 0.5 는 근거가 있다**: 사이드카를 직접 세니 **7,805/7,805 가 전부 다른 시각(100%)**이다
 * (수집이 1req/2~5초라 초 단위로 갈린다). 즉 온전히 고쳐진 DB 는 **100%** 여야 하고,
 * 0.5 는 **2배 여유**다. 부분 수정 상태(0.2%)와도 멀리 떨어져 있다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 * ⚠**CI 에서는 적재가 시험보다 먼저 돈다** — 그래서 CI 의 DB 는 이미 고쳐진 상태다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "../src/db.ts";
import { fetchedAtOf } from "../src/meta.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = join(ROOT, "data", "bb.sqlite");
const HAS_DB = existsSync(DB);

if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

const NOW = "2026-08-24T00:00:00.000Z";
const skip = HAS_DB ? false : "data/bb.sqlite 없음";

test("⚠취득 시각이 경기마다 다르다 — 적재 시각이면 전부 같은 값이 된다", { skip }, () => {
  const db = openDb(DB, NOW);
  try {
    const r = db.raw
      .prepare("SELECT COUNT(*) AS games, COUNT(DISTINCT fetched_at) AS distinct_at FROM game")
      .get() as unknown as { games: number; distinct_at: number };
    assert.ok(r.games > 1_000, `경기가 ${r.games}건뿐이다 — 이 시험이 공회전한다`);
    const ratio = r.distinct_at / r.games;
    assert.ok(
      ratio > 0.5,
      `서로 다른 취득 시각이 ${r.distinct_at} / 경기 ${r.games} (${(ratio * 100).toFixed(1)}%) 뿐이다.\n` +
        "⚠**적재 시각이 들어갔을 가능성이 크다** — 한 번의 적재에서 들어온 경기는 전부 같은 값이 된다.\n" +
        "⚠**코드만 고치고 적재를 안 돌렸으면 옛 값이 남아 있다** — load-archive.ts 를 다시 돌려라.",
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**한 값이 몰려 있으면 그것이 적재 시각이다.** 위의 비율만 보면
 * **일부만 고쳐진 중간 상태**를 놓친다 — 실제로 그 상태를 한 번 만들어 봤다(3일치만 재적재).
 */
test("⚠한 취득 시각에 경기가 몰려 있지 않다 — 일부만 고쳐진 상태를 잡는다", { skip }, () => {
  const db = openDb(DB, NOW);
  try {
    const top = db.raw
      .prepare("SELECT fetched_at AS at, COUNT(*) AS n FROM game GROUP BY fetched_at ORDER BY n DESC LIMIT 1")
      .get() as unknown as { at: string; n: number };
    const games = (db.raw.prepare("SELECT COUNT(*) AS n FROM game").get() as unknown as { n: number }).n;
    assert.ok(
      top.n < games * 0.05,
      `취득 시각 ${top.at} 하나에 경기 ${top.n}/${games} 건이 몰려 있다 — 그건 적재 시각이다.`,
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**경기보다 먼저 받을 수는 없다.** 값이 뒤집혀 있으면 엉뚱한 열을 넣은 것이다.
 * ⚠`fetched_at` 은 UTC ISO 이고 `game_date` 는 JST 날짜라 **날짜만 비교**한다 —
 * 시각까지 비교하면 시차 9시간 때문에 정상인 것이 걸린다.
 */
test("⚠취득 시각이 경기일보다 앞서지 않는다", { skip }, () => {
  const db = openDb(DB, NOW);
  try {
    const bad = db.raw
      .prepare("SELECT COUNT(*) AS n FROM game WHERE SUBSTR(fetched_at, 1, 10) < game_date")
      .get() as unknown as { n: number };
    assert.equal(bad.n, 0, `경기일보다 먼저 받은 것으로 적힌 경기가 ${bad.n}건이다`);
  } finally {
    db.close();
  }
});

/**
 * ⚠**이것이 본체다. 위의 「서로 다른 값의 수」는 필요조건일 뿐이다**(감사가 미리 경고한 지름길).
 *
 * DB 의 `fetched_at` 을 **사이드카와 1:1 로 대조**한다. distinct 만 보면
 * 「경기마다 다른 엉뚱한 값」이 통과한다 — 예컨대 파일 수정 시각을 넣어도 distinct 는 높다.
 *
 * ⚠**아카이브가 없으면 건너뛴다** — 아카이브는 로컬에 없을 수 있다(DB 는 있어도).
 * ⚠**분모를 낸다** — 대조한 건수가 0이면 통과가 아니라 시험이 안 돈 것이다(작업규칙 7·8).
 */
test("⚠DB 의 취득 시각이 사이드카와 1:1 로 같다", { skip }, async () => {
  const { existsSync: ex } = await import("node:fs");
  const archive = join(ROOT, "data", "archive", "npb", "scores");
  if (!ex(archive)) {
    if (process.env["BB_REQUIRE_DB"] === "1") throw new Error(`BB_REQUIRE_DB=1 인데 ${archive} 가 없다`);
    return;
  }
  const db = openDb(DB, NOW);
  try {
    const rows = db.raw
      .prepare("SELECT game_id AS id, fetched_at AS at FROM game")
      .all() as unknown as { id: string; at: string }[];
    let checked = 0;
    let missing = 0;
    const bad: string[] = [];
    for (const r of rows) {
      // game_id = `${season}/${mmdd}/${slug}` — 아카이브 경로와 같은 모양이다
      const [season, mmdd, slug] = r.id.split("/");
      if (season === undefined || mmdd === undefined || slug === undefined) continue;
      const meta = join(archive, season, mmdd, slug, "box.meta.json");
      const want = fetchedAtOf(meta);
      if (want === null) {
        missing += 1;
        continue;
      }
      checked += 1;
      if (want !== r.at && bad.length < 10) bad.push(`${r.id}: DB=${r.at} 사이드카=${want}`);
    }
    assert.ok(checked > 1_000, `대조한 경기가 ${checked}건뿐이다 — 아카이브 경로가 안 맞는다`);
    assert.equal(missing, 0, `사이드카를 못 읽은 경기가 ${missing}건이다`);
    assert.deepEqual(
      bad,
      [],
      `DB 의 취득 시각이 사이드카와 다르다(앞 10건 · 대조 ${checked}건)\n${bad.join("\n")}\n` +
        "⚠**코드만 고치고 적재를 안 돌렸으면 옛 값이 남아 있다** — load-archive.ts 를 다시 돌려라.",
    );
    console.log(`  · 취득 시각 대조 ${checked}건 / 어긋남 0건`);
  } finally {
    db.close();
  }
});
