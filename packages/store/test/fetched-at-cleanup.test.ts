/**
 * ⚠**이미 DB 에 들어간 무효 취득 시각은 스스로 안 고쳐진다**(2026-09-11 · 콜드 리뷰 지적 · 설계 D3 ⑹).
 *
 * `upsertProbablePitcher` 는 **새 시각이 기존보다 클 때만** 덮는다(`load.ts` · 문자열 비교). 그래서 기존 값이
 * `'not-a-date'` 면 문자 `n` 이 숫자보다 커서 **정상 시각으로 영영 못 바꾼다** — 사이드카를 되살리고 다시 적재해도 그대로다.
 * `fetchedAtOf` 가 이제 무효 값을 안 내놓으므로(커밋 25878c9) 새로 들어올 길은 막혔고, 남은 것은 **이미 들어간 값**이다.
 * → 마이그레이션 022 가 NULL 로 바꾼다. CI DB 실측으로 **대상 0행**이라 보험이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, listMigrations } from "../src/db.ts";
import { upsertProbablePitcher } from "../src/load.ts";
import { normalizeFetchedAt } from "../src/meta.ts";

const NOW = "2026-09-11T00:00:00.000Z";
const CLEANUP = "022-invalid-fetched-at.sql";

function probable(fetchedAt: string | null) {
  return {
    gameDate: "2026-09-10", teamCode: "g", opponentCode: "db", playerId: null, sourceName: null,
    venue: null, startTime: "18:00", league: "cl", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt,
  };
}

test("정리 마이그레이션이 목록에 있다", () => {
  assert.ok(listMigrations().includes(CLEANUP), `${CLEANUP} 이 없다`);
});

test("⚠무효 취득 시각은 NULL 이 되고, 그 뒤 정상 시각이 upsert 로 들어간다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-fetched-cleanup-"));
  const path = join(dir, "t.sqlite");
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb(path, NOW);
    upsertProbablePitcher(db, probable("not-a-date"));
    // 정리 전 — 정상 시각이 못 들어간다(이것이 지적된 결함이다)
    upsertProbablePitcher(db, probable("2026-09-10T05:00:00.000Z"));
    const stuck = db.raw.prepare("SELECT fetched_at f FROM probable_pitcher").get() as { f: string | null };
    assert.equal(stuck.f, "not-a-date", "전제가 틀렸다 — upsert 가 무효 값을 이미 덮는다");
    // 정리 마이그레이션을 다시 적용한다
    db.raw.prepare("DELETE FROM schema_migration WHERE name = ?").run(CLEANUP);
    db.raw.exec("INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2026, '2026-09-12', 'g', 'db', 0, '', NULL, 'x', '2026-09-10T05:00:00.000Z')");
    db.close();
    db = openDb(path, NOW);
    const after = db.raw.prepare("SELECT fetched_at f FROM probable_pitcher").get() as { f: string | null };
    assert.equal(after.f, null, "무효 취득 시각을 그대로 뒀다");
    const kept = db.raw.prepare("SELECT fetched_at f FROM upcoming_game").get() as { f: string | null };
    assert.equal(kept.f, "2026-09-10T05:00:00.000Z", "정상 취득 시각까지 지웠다");
    upsertProbablePitcher(db, probable("2026-09-10T05:00:00.000Z"));
    const healed = db.raw.prepare("SELECT fetched_at f FROM probable_pitcher").get() as { f: string | null };
    assert.equal(healed.f, "2026-09-10T05:00:00.000Z", "정리 뒤에도 정상 시각이 안 들어간다");
  } finally {
    // ⚠단언이 실패해도 닫는다 — 열린 채 지우면 Windows 가 EBUSY 로 원래 실패 메시지를 가린다(뮤테이션에서 실제로 가렸다)
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠⚠**「유효한 취득 시각」은 JS 한 벌이다 — 정리 마이그레이션도 같은 함수를 부른다**(2026-09-11 · 3중 검토 3차 P2 → 수정분 재검토 3차 P2).
 *
 * 1회: 022 가 앞모양 GLOB 만 봐서 `2026-99-99T00:00:00.000Z` 가 남았다(문자 비교로 정상 시각보다 커 **영영 못 덮는다**).
 * 2회: 조건을 SQL 로 흉내 냈더니 **또 갈렸다** — SQLite `datetime()` 은 `24:01`·`T24:30`·`" Z"`·`" +09:00"` 을 받고 `+15:00` 을 거부하는데
 *   JS 는 반대다(경계값 19개 중 5개 · 2차 실측 · 3차가 `24:01` 로 upsert 까지 막히는 것을 재현).
 * → **`openDb` 가 `meta.ts` 의 `normalizeFetchedAt` 를 SQLite 함수로 등록하고 022 가 그것을 부른다.** 정의가 구조적으로 하나다.
 *   유효하지만 정규형이 아닌 값(`+09:00`)도 `Z` 한 모양으로 맞춘다 — 문자열 비교가 틀리지 않게(2차 Minor).
 * ⚠그래서 이 시험은 기대값을 손으로 적지 않는다 — **같은 입력표를 JS 로 판정한 값**과 DB 결과가 같아야 한다.
 */
test("⚠⚠정리 마이그레이션의 결과가 입력표 전부에서 JS 판정(normalizeFetchedAt)과 같다 — 경계값에서 갈리지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-fetched-cleanup-shape-"));
  const path = join(dir, "t.sqlite");
  const inputs = [
    "2026-99-99T00:00:00.000Z", "2026-09-10T99:99:00.000Z", "2026-09-10T05:00:00", "2026-09-10T05:00:00.000Zjunk",
    "2026-09-10T05:00:00.000Z", "2026-09-10T14:00:00+09:00", "2026-09-10T24:01:00.000Z", "2026-09-10T24:00:00.000Z",
    "2026-09-10T24:30:00Z", "2026-09-10T05:00:00 Z", "2026-09-10T05:00:00 +09:00", "2026-09-10T05:00:00.000+15:00",
    "2026-09-10T05:00:00.000+23:59", "2026-02-30T00:00:00.000Z", "not-a-date", "2026-09-10T05:00Z",
    "0000-01-01T00:00:00.000+00:01",
  ];
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb(path, NOW);
    upsertProbablePitcher(db, probable("2026-09-10T24:01:00.000Z"));
    const ins = db.raw.prepare(
      "INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2026, ?, 'g', 'db', ?, '', NULL, 'x', ?)",
    );
    inputs.forEach((v, i) => ins.run("2026-09-12", i, v));
    db.raw.prepare("DELETE FROM schema_migration WHERE name = ?").run(CLEANUP);
    db.close();
    db = openDb(path, NOW);
    const rows = db.raw.prepare("SELECT seq, fetched_at f FROM upcoming_game ORDER BY seq").all() as { seq: number; f: string | null }[];
    assert.equal(rows.length, inputs.length);
    for (const r of rows) {
      const want = normalizeFetchedAt(inputs[r.seq]);
      assert.equal(r.f, want, `입력 ${JSON.stringify(inputs[r.seq])}: 마이그레이션 ${JSON.stringify(r.f)} ≠ JS 판정 ${JSON.stringify(want)}`);
    }
    assert.ok(rows.some((r) => r.f === null) && rows.some((r) => r.f !== null), "입력표가 한쪽으로만 치우쳤다 — 이 시험이 공회전한다");
    upsertProbablePitcher(db, probable("2026-09-10T05:00:00.000Z"));
    const healed = db.raw.prepare("SELECT fetched_at f FROM probable_pitcher").get() as { f: string | null };
    assert.equal(healed.f, "2026-09-10T05:00:00.000Z", "JS 가 거부하는 24:01 이 남아 정상 시각이 안 들어간다");
  } finally {
    // ⚠단언이 실패해도 닫는다 — 열린 채 지우면 Windows 가 EBUSY 로 원래 실패 메시지를 가린다
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
