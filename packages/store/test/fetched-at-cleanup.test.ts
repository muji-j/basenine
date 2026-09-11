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
  try {
    let db = openDb(path, NOW);
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
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠⚠**모양만 맞는 무효 시각도 스스로 안 고쳐진다**(2026-09-11 · 3중 검토 3차 P2 · 실행 재현).
 * `2026-99-99T00:00:00.000Z` 는 앞모양 GLOB 을 통과하지만 날짜가 아니고, 문자 비교로 `2026-09-…` 보다 커서
 * **정상 upsert 가 영영 못 덮는다.** `meta.ts` 는 이미 `Date.parse` 로 거르는데 정리 마이그레이션은 모양만 봤다 —
 * **「유효한 취득 시각」의 정의가 두 벌로 갈려 있었다.** 이제 둘 다 ⑴앞모양 ⑵해석 가능 ⑶시간대 표기를 요구한다.
 * ⚠SQLite `datetime()` 과 JS `Date.parse` 의 유효성 판정은 9개 값에서 일치했다(2026-09-11 실측 · `02-30` 은 둘 다 `03-02` 로 넘긴다).
 */
test("⚠⚠모양만 맞는 무효 시각 · 시간대 없는 시각도 NULL 이 되고, 정상 값은 남는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-fetched-cleanup-shape-"));
  const path = join(dir, "t.sqlite");
  const values = {
    "2026-09-01": "2026-99-99T00:00:00.000Z",
    "2026-09-02": "2026-09-10T99:99:00.000Z",
    "2026-09-03": "2026-09-10T05:00:00",
    "2026-09-04": "2026-09-10T05:00:00.000Zjunk",
    "2026-09-05": "2026-09-10T05:00:00.000Z",
    "2026-09-06": "2026-09-10T14:00:00+09:00",
  } as const;
  const valid = new Set(["2026-09-05", "2026-09-06"]);
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb(path, NOW);
    upsertProbablePitcher(db, probable("2026-99-99T00:00:00.000Z"));
    const ins = db.raw.prepare(
      "INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2026, ?, 'g', 'db', 0, '', NULL, 'x', ?)",
    );
    for (const [date, v] of Object.entries(values)) ins.run(date, v);
    db.raw.prepare("DELETE FROM schema_migration WHERE name = ?").run(CLEANUP);
    db.close();
    db = openDb(path, NOW);
    const rows = db.raw.prepare("SELECT game_date d, fetched_at f FROM upcoming_game ORDER BY game_date").all() as { d: keyof typeof values; f: string | null }[];
    for (const r of rows) {
      if (valid.has(r.d)) assert.equal(r.f, values[r.d], `정상 취득 시각 ${values[r.d]} 을 지웠다`);
      else assert.equal(r.f, null, `무효 취득 시각 ${values[r.d]} 을 그대로 뒀다`);
    }
    upsertProbablePitcher(db, probable("2026-09-10T05:00:00.000Z"));
    const healed = db.raw.prepare("SELECT fetched_at f FROM probable_pitcher").get() as { f: string | null };
    assert.equal(healed.f, "2026-09-10T05:00:00.000Z", "모양만 맞는 무효 시각이 남아 정상 시각이 안 들어간다");
  } finally {
    // ⚠단언이 실패해도 닫는다 — 열린 채 지우면 Windows 가 EBUSY 로 원래 실패 메시지를 가린다
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
