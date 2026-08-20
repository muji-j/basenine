/**
 * `CareerContext` — **시즌을 넘는 계산을 한 번만 하는 장치**의 안전장치.
 *
 * ⚠**이 장치의 위험은 「다른 조건으로 만든 것을 조용히 쓰는 것」이다.**
 * 대회가 다르면 올스타 등판이 정규시즌 火消し 에 섞이고, 기준일이 다르면 「7월 말 기준」 화면에
 * 8월 등판이 섞인다 — 둘 다 **값이 그럴듯하게 틀리는** 모양이라 화면 어디에도 드러나지 않는다.
 * 그래서 `loadSite` 는 **아무것도 읽기 전에** 조건을 맞대 보고 어긋나면 던진다(M7).
 *
 * ⚠**답이 같다는 것**은 `packages/aggregate/test/relief-seasons.test.ts` 가 실DB로 고정한다
 * (여기서는 빈 DB 로 **가드만** 본다 — 그게 이 파일이 값싸게 지킬 수 있는 것이다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@bb-app/store";
import { buildCareerContext, loadSite } from "../src/query.ts";
import type { CareerContext } from "../src/query.ts";

const NOW = "2026-08-20T00:00:00.000Z";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-career-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("만든 조건을 함께 들고 다닌다 — 안 들고 다니면 맞대 볼 수가 없다", async () => {
  await withDb((db) => {
    const c = buildCareerContext(db, { from: 2026, to: 2026 });
    assert.equal(c.competition, "regular");
    assert.equal(c.through, "9999-12-31");
    // 시즌 1개 × 리그 2개
    assert.equal(c.runExpectancy.size, 2);
    assert.deepEqual(c.reliefScan.entries, []);
    assert.equal(c.reliefScan.unknownPitcher, 0);
  });
});

test("⚠대회가 다른 것을 넘기면 던진다 — 조용히 쓰면 올스타가 정규시즌에 섞인다", async () => {
  await withDb((db) => {
    const c = buildCareerContext(db, { from: 2026, to: 2026, competition: "allStar" });
    assert.throws(
      () => loadSite(db, { season: 2026, builtOn: "2026-08-20", career: c }),
      /CareerContext 의 조건이 다르다/,
    );
  });
});

test("⚠기준일이 다른 것을 넘기면 던진다 — 「7월 말 기준」 화면에 8월이 섞인다", async () => {
  await withDb((db) => {
    const c = buildCareerContext(db, { from: 2026, to: 2026, through: "2026-07-31" });
    assert.throws(
      () => loadSite(db, { season: 2026, builtOn: "2026-08-20", career: c }),
      /CareerContext 의 조건이 다르다/,
    );
  });
});

test("조건이 같으면 통과한다 — 가드가 정상 경로를 막지 않는다", async () => {
  await withDb((db) => {
    const c = buildCareerContext(db, { from: 2026, to: 2026, through: "2026-07-31" });
    const data = loadSite(db, {
      season: 2026,
      builtOn: "2026-08-20",
      through: "2026-07-31",
      career: c,
    });
    assert.equal(data.season, 2026);
    assert.deepEqual(data.players, []);
  });
});

test("⚠손으로 만든 객체도 같은 검사를 받는다 — 타입만으로는 조건을 못 맞춘다", async () => {
  await withDb((db) => {
    const fake: CareerContext = {
      competition: "regular",
      through: "2020-01-01",
      reliefScan: { entries: [], unknownPitcher: 0 },
      runExpectancy: new Map(),
    };
    assert.throws(
      () => loadSite(db, { season: 2026, builtOn: "2026-08-20", career: fake }),
      /2020-01-01/,
    );
  });
});
