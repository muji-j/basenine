/**
 * 引き分けの解剖 — **실DB의 내부 정합성**.
 *
 * ⚠**여기서 시즌별 기대값을 손으로 적지 않는다.** 적으면 화면과 시험이 **같이 낡는** 상태가 되고,
 * 그건 검사가 아니라 복사다(직전 라운드가 그 실수를 했다). 배포물 대조는
 * `packages/web/test/draws-dist.test.ts` 가 하고, 여기서는 **집계 자체가 앞뒤가 맞는가**를 본다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "@bb-app/store";
import { REGULATION_INNINGS, seasonDraws } from "../src/draw.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

test("⚠무승부의 내역이 총계와 맞는다 — 9회분 + 연장분 + 이닝 미상분", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const rows = seasonDraws(db, "regular", "9999-12-31", 0, 9999);
    assert.ok(rows.length >= 5, `시즌을 ${rows.length}개밖에 못 읽었다 — 이 시험이 공회전한다`);
    let totalDraws = 0;
    for (const r of rows) {
      totalDraws += r.draws;
      assert.ok(r.games > 0, `${r.season}년 경기가 0이다`);
      assert.ok(r.draws <= r.games, `${r.season}년 무승부(${r.draws})가 경기(${r.games})보다 많다`);
      assert.ok(r.extraDrawn <= r.extra, `${r.season}년 연장무승부가 연장 경기보다 많다`);
      /**
       * ⚠**무승부는 「9회로 끝났다」·「연장에 갔다」·「이닝을 모른다」 셋 중 하나다.**
       * 셋의 합이 총계를 넘거나, 미상분을 빼고도 모자라면 어느 하나가 잘못 세어진 것이다.
       */
      assert.ok(
        r.regulationDrawn + r.extraDrawn <= r.draws,
        `${r.season}년 내역(${r.regulationDrawn}+${r.extraDrawn})이 무승부 총계(${r.draws})를 넘었다`,
      );
      assert.ok(
        r.regulationDrawn + r.extraDrawn >= r.draws - r.inningUnknown,
        `${r.season}년 무승부 ${r.draws} 중 ${r.draws - r.regulationDrawn - r.extraDrawn}건이 ` +
          `어디에도 안 들어갔다(이닝 미상은 ${r.inningUnknown}건)`,
      );
      // ⚠**연장이 있었다면 최대 이닝은 정규 이닝보다 크다** — 둘이 어긋나면 한쪽 판정이 틀린 것이다
      if (r.extra > 0) {
        assert.ok(
          r.maxInning !== null && r.maxInning > REGULATION_INNINGS,
          `${r.season}년: 연장 ${r.extra}경기인데 최대 이닝이 ${r.maxInning}이다`,
        );
      } else {
        assert.ok(
          r.maxInning === null || r.maxInning <= REGULATION_INNINGS,
          `${r.season}년: 연장 0경기인데 최대 이닝이 ${r.maxInning}이다`,
        );
      }
    }
    assert.ok(totalDraws > 100, `무승부를 ${totalDraws}건밖에 못 읽었다 — 이 시험이 공회전한다`);
  } finally {
    db.close();
  }
});

/**
 * ⚠**이 시험이 실제로 무엇을 가르는지 확인했다**(2026-08-20 · 뮤테이션 검사 · 작업규칙 9).
 * `LEFT JOIN` → `JOIN` 뮤테이션은 **여기서 안 떨어진다** — 지금 아카이브는 성립 경기 전부에
 * 타석 로그가 있어서(이닝 미상 0건) 두 조인이 같은 답을 낸다. 그쪽은
 * `draw.test.ts` 의 「타석 로그가 없는 경기」 시험이 임시 DB 로 가른다.
 * **여기가 가르는 것은 경기 집합의 조건**이다 — `status='played'` 를 빼면 떨어진다(실측 확인).
 */
test(
  "⚠경기 수가 `game` 표를 그대로 센 값과 같다 — 경기 집합의 조건이 어긋나면 분모가 조용히 바뀐다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const raw = new DatabaseSync(DB, { readOnly: true });
    let bySeason: Map<number, number>;
    try {
      const rows = raw
        .prepare(
          `SELECT season, COUNT(*) AS n FROM game
           WHERE status = 'played' AND competition = 'regular' GROUP BY season`,
        )
        .all() as unknown as { season: number; n: number }[];
      bySeason = new Map(rows.map((r) => [Number(r.season), Number(r.n)]));
    } finally {
      raw.close();
    }
    assert.ok(bySeason.size >= 5, `시즌을 ${bySeason.size}개밖에 못 읽었다 — 이 시험이 공회전한다`);

    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const got = new Map(seasonDraws(db, "regular", "9999-12-31", 0, 9999).map((r) => [r.season, r.games]));
      assert.deepEqual(
        [...got.entries()].sort((a, b) => a[0] - b[0]),
        [...bySeason.entries()].sort((a, b) => a[0] - b[0]),
        "경기 수가 어긋난다 — 미성립 경기·대회 구분·조인 방식 중 하나가 바뀌었다(무승부율의 분모가 달라진다)",
      );
    } finally {
      db.close();
    }
  },
);
