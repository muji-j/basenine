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
import { buildCareerContext, loadSite, sliceRelief } from "../src/query.ts";
import type { CareerContext } from "../src/query.ts";
import type { ReliefEntry } from "@bb-app/aggregate";

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
    // ⚠**시즌별 지도다**(검토 ③). 빈 지도 = 「이 범위 안에 미상 0건」이지 「안 쟀음」이 아니다
    assert.deepEqual([...c.reliefScan.unknownPitcher], []);
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
      reliefScan: { entries: [], unknownPitcher: new Map() },
      runExpectancy: new Map(),
    };
    assert.throws(
      () => loadSite(db, { season: 2026, builtOn: "2026-08-20", career: fake }),
      /2020-01-01/,
    );
  });
});

/**
 * ⚠**통산 스캔을 시즌 화면용으로 자를 때 두 필드를 같은 칼로 자른다**(2026-08-21 검토 ③).
 *
 * 예전에는 `entries` 만 `season <=` 로 자르고 **`unknownPitcher` 는 전 범위 값을 그대로 복사**했다 —
 * 같은 객체 안에서 두 필드가 다른 범위를 뜻했다는 뜻이다.
 * ⚠**실데이터가 0이라 무해했을 뿐이다**(실측 2026-08-21: 정규시즌 `status='final'`
 * **552,563행 중 `pitcher_id IS NULL` 0행**). **「실데이터 0」과 「안전」은 다르다.**
 * ⚠**화면으로는 못 잡는다** — 이 값은 `SiteData` 에 안 나간다. 그래서 함수를 직접 태운다.
 */
test("⚠통산 스캔을 자를 때 투수 미상 수도 같이 잘린다 — 한쪽만 자르면 두 뜻이 된다", () => {
  const entry = (season: number): ReliefEntry => ({
    pitcherId: `P${season}`, displayName: `P${season}`, teamCode: "t", season,
    offenseCode: "g", bases: "1", outs: 1, restRuns: 0,
  });
  const full = {
    entries: [entry(2024), entry(2025), entry(2026)],
    unknownPitcher: new Map([[2024, 3], [2025, 5], [2026, 7]]),
  };
  const cut = sliceRelief(full, 2025);
  assert.deepEqual(cut.entries.map((e) => e.season), [2024, 2025], "등판 목록이 시즌으로 안 잘렸다");
  assert.deepEqual(
    [...cut.unknownPitcher],
    [[2024, 3], [2025, 5]],
    "등판은 잘랐는데 투수 미상 수는 전 범위 값이 남았다 — 같은 필드가 두 뜻이 된다",
  );
  // ⚠**원본을 건드리지 않는다** — 시즌마다 같은 `CareerContext` 를 다시 자른다
  assert.deepEqual([...full.unknownPitcher], [[2024, 3], [2025, 5], [2026, 7]], "원본을 깎았다");
  assert.equal(full.entries.length, 3, "원본 등판 목록을 깎았다");
});
