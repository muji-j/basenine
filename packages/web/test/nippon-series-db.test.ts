/**
 * **日本シリーズ 카드의 「日本一」 ⇔ 결착 판정** — 실데이터 완결 시즌 전부로(설계 D4 · T7 의 실DB 몫).
 *
 * ⚠**두 갈래가 한 벌인지 잰다**: 카드 문구(`nipponSeriesView` → `nipponSeriesText`)와 시즌 종료 판정(`japanSeriesDecided`)이
 *   같은 「알려진 4승」을 보는가. 갈리면 홈은 「日本一」라 쓰는데 띠는 시즌 중이라 하거나, 그 반대가 된다.
 * ⚠**시즌을 데이터로 고른다** — 日本シリーズ 경기가 있는 시즌 전부(특정 연도를 박으면 그 해가 빠지는 날 공회전한다).
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { japanSeriesDecided, openDb } from "@bb-app/store";
import { nipponSeriesView } from "../src/query.ts";
import { nipponSeriesText } from "../src/today-page.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

test("⚠실DB — 日本シリーズ 마지막 경기 카드가 「日本一」라고 말하는 시즌 ⇔ japanSeriesDecided", { skip: !HAS_DB }, () => {
  const db = openDb(DB, "2026-10-24T00:00:00.000Z");
  try {
    const seasons = db.raw
      .prepare(
        `SELECT season AS s, MAX(game_date) AS last FROM game
          WHERE competition = 'nipponSeries' AND status = 'played' GROUP BY season ORDER BY season`,
      )
      .all() as unknown as { s: number; last: string }[];
    assert.ok(seasons.length >= 8, `日本シリーズ가 있는 시즌이 ${seasons.length}개뿐이다 — 이 시험이 공회전한다`);
    let decided = 0;
    for (const { s, last } of seasons) {
      const view = nipponSeriesView(db, s, last);
      assert.notEqual(view, null, `${s}: 마지막 경기 날에 시리즈 성적이 없다`);
      const says = nipponSeriesText(view!).includes("日本一");
      assert.equal(says, japanSeriesDecided(db, s), `${s}: 카드(${nipponSeriesText(view!)})와 결착 판정이 갈렸다`);
      if (says) decided += 1;
    }
    // 실측(2026-10-24 CI DB · 로컬 9/11 사본 모두): 완결 8시즌(2018~2025) 전부 결착 — 2026 은 아직 日本S 경기가 없다
    assert.ok(decided >= 8, `결착한 시즌이 ${decided}개 — 보유 완결 8시즌은 전부 정확히 4승에 닿았다(설계 §2)`);
  } finally {
    db.close();
  }
});
