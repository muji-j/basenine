/**
 * 선수 프로필의 **판 판정**(감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5 · 시험 3-1~3-3 · 3-20).
 *
 * ⚠**판은 본문 sha256 이다**(019 드래프트와 같은 정의) — 사이드카의 `revision` 은 아카이브 안의 카운터라 세대를 복원하면
 *   다른 본문에 같은 번호가 붙는다. **본문이 같으면 판이 같고**(시각을 안 본다), 본문이 다를 때만 **내용 시각**으로 순서를 가른다.
 * ⚠**첫 실행이 기존 DB 값을 거짓 옛 판으로 막지 않는다**(G4) — C7 이전 DB 는 `profile_fetched_at` 이 적재 시각이라
 *   사이드카보다 **언제나** 늦다(실측 1,644/1,644 · 980/980). 시각만 보면 전원이 영구히 옛 판이다. 적용 판 NULL 은 「처음」이다.
 * ⚠메모리 DB 에 마이그레이션을 적용해 잰다(3-20 만 파일 DB — 022 까지 적용한 뒤 023 을 적용해야 하므로).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { applyPendingMigrations, listMigrations, openDb } from "../src/db.ts";
import type { Db } from "../src/db.ts";
import { upsertPlayer } from "../src/load.ts";
import { classifyForRefetch, isOlder, judgePlayerVersion, playerArchiveOf } from "../src/player-version.ts";
import type { MetaSnapshot, PlayerArchive } from "../src/player-version.ts";

const NOW = "2026-09-27T00:00:00.000Z";
const ID = "01005134";
const T_EARLY = "2026-08-01T00:00:00.000Z";
const T_DB = "2026-09-01T00:00:00.000Z";
const T_LATE = "2026-09-10T00:00:00.000Z";
/** DB 가 가진 판(Y) — 아카이브 본문과 다르다 */
const REV_Y = "b".repeat(64);

const BODY = new TextEncoder().encode("<html>선수 페이지 본문</html>");
const BODY_SHA = createHash("sha256").update(BODY).digest("hex");

function withDb(fn: (db: Db) => void): void {
  const db = openDb(":memory:", NOW);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

/**
 * 선수 행을 만들고 적용 판 · 표시 시각(`profile_fetched_at`) · 순서 기준선(`profile_content_at`)을 심는다. `row === null` 이면 행을 안 만든다.
 * ⚠`contentAt` 을 안 주면 표시 시각과 같게 둔다 — 대부분의 시험에서 두 값은 같고, **갈라야 하는 시험만** 따로 준다.
 */
type Row = { revision: string | null; time: string | null; contentAt?: string | null };
function seed(db: Db, row: Row | null): void {
  if (row === null) return;
  upsertPlayer(db, ID, "시험", NOW);
  db.raw
    .prepare("UPDATE player SET profile_revision = ?, profile_fetched_at = ?, profile_content_at = ? WHERE player_id = ?")
    .run(row.revision, row.time, row.contentAt === undefined ? row.time : row.contentAt, ID);
}

/** 판정은 쓰기 트랜잭션 안에서만 부른다(3-2) */
function judge(row: Row | null, archive: PlayerArchive) {
  let out: ReturnType<typeof judgePlayerVersion> | undefined;
  withDb((db) => {
    seed(db, row);
    db.transaction(() => {
      out = judgePlayerVersion(db, ID, archive);
    });
  });
  return out!;
}

const ok = (value: unknown): MetaSnapshot => ({ state: "ok", value });
/** 본문을 말하는 사이드카(sha 가 본문과 같다) */
const describing = (times: Record<string, unknown>): MetaSnapshot => ok({ url: "https://npb.jp/bis/players/01005134.html", sha256: BODY_SHA, revision: 3, ...times });
const archiveOf = (times: Record<string, unknown>): PlayerArchive => playerArchiveOf(describing(times), BODY);
/** 달력으로는 무효지만 모양(24자 ISO)은 맞는 값 — `profile_content_at` 의 CHECK 를 지나 적재기의 `normalizeFetchedAt` 에서 걸린다 */
const SHAPE_ONLY = "2026-19-39T29:59:59.999Z";
const T_MID = "2026-09-05T00:00:00.000Z";

// ─── 3-1 · §5-2 판정 표(위에서부터 처음 맞는 줄) · 순서 기준선 = profile_content_at(3중 검토 3차 P2) ──────────

test("N3 3-1 ① DB 에 선수 행이 없으면 no-row — 지금처럼 쓴다(본 시각 · 내용 시각)", () => {
  assert.deepEqual(judge(null, archiveOf({ fetchedAt: T_EARLY })), { kind: "no-row", time: T_EARLY, contentAt: T_EARLY });
});

test("⚠N3 3-1 ② 적용 판이 NULL 이면 first — 시각을 비교하지 않는다(첫 실행 · G4) · 모르면 둘 다 NULL(C7)", () => {
  // DB 시각이 사이드카보다 늦어도(C7 이전 모양) 옛 판이 아니다
  assert.deepEqual(judge({ revision: null, time: T_LATE }, archiveOf({ fetchedAt: T_EARLY })), { kind: "first", time: T_EARLY, contentAt: T_EARLY });
  assert.deepEqual(judge({ revision: null, time: T_LATE }, playerArchiveOf({ state: "missing" }, BODY)), { kind: "first", time: null, contentAt: null });
});

test("⚠N3 3-1 ③ 적용 판 = 본문 sha 면 same — 두 칸 다 늦은 쪽 · 한쪽이 null/무효면 다른 쪽 · 둘 다 없으면 NULL", () => {
  const same = (row: Omit<Row, "revision">, a: PlayerArchive) => judge({ revision: BODY_SHA, ...row }, a);
  // 이른 확인(세대 복원) — DB 값을 지킨다. 거짓 옛 판이 아니다
  assert.deepEqual(same({ time: T_LATE, contentAt: T_DB }, archiveOf({ fetchedAt: T_EARLY })), { kind: "same", time: T_LATE, contentAt: T_DB });
  assert.deepEqual(same({ time: T_EARLY }, archiveOf({ fetchedAt: T_EARLY, checkedAt: T_LATE })), { kind: "same", time: T_LATE, contentAt: T_LATE });
  // 사이드카를 못 읽어도 그 DB 값은 **바로 이 본문**에 대한 것이다 — 지우지 않는다(C7 과의 조정)
  assert.deepEqual(same({ time: T_DB }, playerArchiveOf({ state: "missing" }, BODY)), { kind: "same", time: T_DB, contentAt: T_DB });
  // DB 표시 시각이 무효면 본 시각으로 대체한다(표시 칸에는 CHECK 가 없다)
  assert.deepEqual(same({ time: "not-a-date", contentAt: T_EARLY }, archiveOf({ fetchedAt: T_EARLY })), { kind: "same", time: T_EARLY, contentAt: T_EARLY });
  assert.deepEqual(same({ time: null }, playerArchiveOf({ state: "missing" }, BODY)), { kind: "same", time: null, contentAt: null });
});

/**
 * ⚠⚠**같은 본문의 404 는 순서 기준선을 올리지 않는다**(3중 검토 3차 P2). 표시 칸은 지금처럼 늦은 쪽(404 확인 시각)이 되지만,
 * 부재 중 사이드카의 내용 시각은 받은 시각이라 순서 칸은 그대로다 — 그래야 그 사이에 받은 더 새 본문이 옛 판으로 안 버려진다.
 */
test("⚠3중 검토 3차 · same — 404 확인은 profile_fetched_at 만 올리고 profile_content_at 은 안 올린다", () => {
  assert.deepEqual(
    judge({ revision: BODY_SHA, time: T_DB, contentAt: T_DB }, archiveOf({ fetchedAt: T_DB, checkedAt: T_LATE, absentAt: T_LATE })),
    { kind: "same", time: T_LATE, contentAt: T_DB },
  );
});

test("⚠N3 3-1 ④ 본문이 다른데 내용 시각을 모르면 unknown — 순서를 몰라 건너뛴다(종료 1)", () => {
  const v = judge({ revision: REV_Y, time: T_DB }, playerArchiveOf({ state: "missing" }, BODY));
  assert.equal(v.kind, "unknown");
  if (v.kind === "unknown") assert.match(v.reason, /사이드카 없음/);
});

/**
 * ⚠**DB 에 순서 기준선이 없으면 새 판으로 받는다 — 판 모름으로 막지 않는다**(설계 §5-2 5번 · 3중 검토 반영 때 정했다).
 * 이 상태는 사이드카가 본문을 말하지 않던 첫 적재 뒤에만 생기고, DB 쪽 순서는 다시 받아도 안 되살아난다 — 막으면 영구 봉쇄다.
 * ⚠`noBaseline` 표시로 적재기가 따로 찍는다(조용히 넘기지 않는다). 표시 시각이 있어도 순서에 안 쓴다.
 */
test("N3 3-1 ⑤ DB 의 profile_content_at 이 NULL 이면 newer(noBaseline) — 표시 시각은 순서에 안 쓴다", () => {
  assert.deepEqual(judge({ revision: REV_Y, time: T_LATE, contentAt: null }, archiveOf({ fetchedAt: T_EARLY })), {
    kind: "newer", time: T_EARLY, contentAt: T_EARLY, noBaseline: true,
  });
});

test("⚠N3 3-1 ⑥ DB 의 profile_content_at 이 무효면 invalid-db — fail-closed · 표시 시각이 무효인 것은 막지 않는다", () => {
  assert.deepEqual(judge({ revision: REV_Y, time: T_DB, contentAt: SHAPE_ONLY }, archiveOf({ fetchedAt: T_LATE })), { kind: "invalid-db", value: SHAPE_ONLY });
  // 표시 칸만 무효 — 순서는 순서 칸으로 가른다(이제 표시 칸은 순서에 안 쓴다)
  assert.deepEqual(judge({ revision: REV_Y, time: "not-a-date", contentAt: T_DB }, archiveOf({ fetchedAt: T_LATE })), {
    kind: "newer", time: T_LATE, contentAt: T_LATE, noBaseline: false,
  });
});

test("⚠N3 3-1 ⑦ 내용 시각이 DB 순서 기준선보다 1ms 라도 이르면 stale — 부재 중이면 표시한다", () => {
  const early = "2026-08-31T23:59:59.999Z";
  assert.deepEqual(judge({ revision: REV_Y, time: T_DB }, archiveOf({ fetchedAt: early })), {
    kind: "stale", absentNow: false, archiveTime: early, dbContentAt: T_DB,
  });
  // 부재 중 — 본 시각(checkedAt=absentAt)은 DB 보다 늦지만 순서는 받은 시각으로 가른다(404 가 올린 시각이 순서에 안 들어간다)
  assert.deepEqual(judge({ revision: REV_Y, time: T_DB }, archiveOf({ fetchedAt: T_EARLY, checkedAt: T_LATE, absentAt: T_LATE })), {
    kind: "stale", absentNow: true, archiveTime: T_EARLY, dbContentAt: T_DB,
  });
});

/**
 * ⚠⚠**3차 검토 재현의 단위판** — DB 표시 시각(404 확인으로 오른 T_LATE)보다는 이르지만 순서 기준선(T_DB)보다는 늦은 본문은 **새 판**이다.
 * 표시 칸으로 가르면 `stale`(버림)이다 — 변이 「순서에 profile_fetched_at」이 이 시험을 붉게 만든다.
 */
test("⚠N3 3-1 ⑧ 같은 시각·늦은 시각은 newer — 표시 시각이 더 늦어도 순서 기준선보다 새것이면 newer(3중 검토 3차 P2)", () => {
  assert.deepEqual(judge({ revision: REV_Y, time: T_DB }, archiveOf({ fetchedAt: T_DB })), { kind: "newer", time: T_DB, contentAt: T_DB, noBaseline: false });
  assert.deepEqual(judge({ revision: REV_Y, time: T_DB }, archiveOf({ fetchedAt: T_EARLY, checkedAt: T_LATE })), {
    kind: "newer", time: T_LATE, contentAt: T_LATE, noBaseline: false,
  });
  assert.deepEqual(judge({ revision: REV_Y, time: T_LATE, contentAt: T_DB }, archiveOf({ fetchedAt: T_MID })), {
    kind: "newer", time: T_MID, contentAt: T_MID, noBaseline: false,
  });
});

// ─── 3-2 · 판정은 쓰기 트랜잭션 안에서만 ─────────────────────────────────────────────────

/**
 * ⚠판정 SELECT 와 쓰기 사이에 다른 연결이 그 행을 커밋할 수 없어야 한다(설계 §5-3) — 트랜잭션의 첫 읽기가 SHARED 잠금을
 *   커밋까지 쥔다. 밖에서 부르는 호출자 결함을 **던져서** 드러낸다. 변이 「단언 삭제」가 이 시험을 붉게 만든다.
 */
test("⚠N3 3-2 · 트랜잭션 밖에서 부르면 TypeError", () => {
  withDb((db) => {
    seed(db, { revision: null, time: null });
    assert.throws(() => judgePlayerVersion(db, ID, archiveOf({ fetchedAt: T_EARLY })), TypeError);
  });
});

// ─── 3-3 · playerArchiveOf ────────────────────────────────────────────────────────────────

test("⚠N3 3-3 · playerArchiveOf — 사이드카가 본문을 말하지 않으면 시각을 모른다(본문 sha 는 늘 안다)", () => {
  const cases: [string, MetaSnapshot, RegExp][] = [
    ["사이드카 없음", { state: "missing" }, /사이드카 없음/],
    ["JSON 깨짐", { state: "broken", error: "Unexpected token" }, /JSON.*Unexpected token/],
    ["배열", ok([]), /객체가 아니다/],
    ["null", ok(null), /객체가 아니다/],
    ["sha256 없음", ok({ fetchedAt: T_EARLY }), /sha256 이 없다/],
    ["sha256 빈 값", ok({ fetchedAt: T_EARLY, sha256: "" }), /sha256 이 없다/],
    ["sha256 불일치", ok({ fetchedAt: T_EARLY, sha256: REV_Y }), /sha256 이 사이드카와 다르다/],
  ];
  for (const [label, meta, reason] of cases) {
    const a = playerArchiveOf(meta, BODY);
    assert.equal(a.bodySha256, BODY_SHA, `${label}: 본문 sha`);
    assert.equal(a.seenAt, null, `${label}: 본 시각`);
    assert.equal(a.contentTime, null, `${label}: 내용 시각`);
    assert.equal(a.absentNow, false, `${label}: 부재`);
    assert.match(a.unknownReason ?? "", reason, `${label}: 모름 사유`);
  }
});

test("⚠N3 3-3 · playerArchiveOf — 본문을 말하는 사이드카의 본 시각 · 내용 시각 · 부재", () => {
  const cases: [string, Record<string, unknown>, Omit<PlayerArchive, "bodySha256">][] = [
    ["정상", { fetchedAt: T_EARLY, checkedAt: T_DB }, { seenAt: T_DB, contentTime: T_DB, absentNow: false, unknownReason: null }],
    ["checkedAt 없는 옛 모양", { fetchedAt: T_EARLY }, { seenAt: T_EARLY, contentTime: T_EARLY, absentNow: false, unknownReason: null }],
    ["부재 중(absentAt = checkedAt)", { fetchedAt: T_EARLY, checkedAt: T_DB, absentAt: T_DB },
      { seenAt: T_DB, contentTime: T_EARLY, absentNow: true, unknownReason: null }],
    ["부재 뒤 재확인(absentAt < checkedAt)", { fetchedAt: T_EARLY, checkedAt: T_LATE, absentAt: T_DB },
      { seenAt: T_LATE, contentTime: T_LATE, absentNow: false, unknownReason: null }],
    // ⚠본 시각이 유효해도 순서는 모른다(콜드 리뷰 P2)
    ["부재 표시 무효", { fetchedAt: T_EARLY, checkedAt: T_LATE, absentAt: "not-a-date" },
      { seenAt: T_LATE, contentTime: null, absentNow: false, unknownReason: "absentAt 무효" }],
    ["두 시각 다 무효", { fetchedAt: "", checkedAt: "x" }, { seenAt: null, contentTime: null, absentNow: false, unknownReason: "취득 시각 무효" }],
  ];
  for (const [label, times, want] of cases) {
    assert.deepEqual(archiveOf(times), { bodySha256: BODY_SHA, ...want }, label);
  }
});

// ─── isOlder · classifyForRefetch ─────────────────────────────────────────────────────────

test("N3 · isOlder 는 밀리초로 비교하고 정규화되지 않은 값에 던진다(judgeVersion 의 호출자 계약과 같다)", () => {
  assert.equal(isOlder("2026-08-31T23:59:59.999Z", T_DB), true);
  assert.equal(isOlder(T_DB, T_DB), false);
  assert.equal(isOlder(T_LATE, T_DB), false);
  for (const bad of ["2026-09-01T09:00:00+09:00", "not-a-date", "2026-09-01T00:00:00"]) {
    assert.throws(() => isOlder(bad, T_DB), TypeError, bad);
    assert.throws(() => isOlder(T_DB, bad), TypeError, bad);
  }
});

test("⚠N3 · classifyForRefetch — 선정기가 사이드카만 보고 가른다 · 순서 기준선은 적재기와 같은 profile_content_at", () => {
  const db = { revision: REV_Y, contentAt: T_DB };
  const meta = (m: Record<string, unknown>) => ({ sha256: BODY_SHA, ...m });
  const cases: [string, unknown, { revision: string | null; contentAt: string | null }, string][] = [
    ["적용 판 NULL(첫 실행·신규) — 판단 안 함", meta({ fetchedAt: T_EARLY }), { revision: null, contentAt: T_DB }, "no-identity"],
    ["사이드카 없음·못 읽음", undefined, db, "unreadable"],
    ["사이드카가 배열", [], db, "unreadable"],
    ["sha256 없음", { fetchedAt: T_EARLY }, db, "unreadable"],
    ["같은 본문", { sha256: REV_Y, fetchedAt: T_EARLY }, db, "same"],
    ["다른 본문 · 이른 내용 시각", meta({ fetchedAt: T_EARLY }), db, "stale"],
    ["다른 본문 · 부재 중", meta({ fetchedAt: T_EARLY, checkedAt: T_LATE, absentAt: T_LATE }), db, "stale-absent"],
    ["다른 본문 · 부재 표시 무효", meta({ fetchedAt: T_EARLY, absentAt: "not-a-date" }), db, "unknown"],
    ["다른 본문 · DB 기준선 무효", meta({ fetchedAt: T_EARLY }), { revision: REV_Y, contentAt: SHAPE_ONLY }, "unknown"],
    ["다른 본문 · DB 기준선 NULL(적재기가 새 판으로 받는다 · §5-2 5번)", meta({ fetchedAt: T_EARLY }), { revision: REV_Y, contentAt: null }, "newer"],
    // ⚠3차 P2 — 404 로 오른 표시 시각이 아니라 순서 기준선과 맞댄다: 기준선(T_DB)보다 늦은 본문은 새 판이다
    ["다른 본문 · 기준선보다 늦은 내용 시각(표시 시각은 무관)", meta({ fetchedAt: T_MID }), db, "newer"],
    ["다른 본문 · 늦은 내용 시각", meta({ fetchedAt: T_LATE }), db, "newer"],
  ];
  for (const [label, m, d, want] of cases) assert.equal(classifyForRefetch(m, d), want, label);
});

// ─── 3-20 · 마이그레이션 023 ───────────────────────────────────────────────────────────────

const MIGRATION = "023-player-profile-revision.sql";

/**
 * ⚠**022 까지 적용된 DB 를 만든다** — `applyPendingMigrations` 에 「023 이후는 적용됨」을 넘기면 그것들만 건너뛴다.
 * `schema_migration` 표의 DDL 은 `db.ts` 의 BOOTSTRAP 과 같다(그 상수는 내보내지 않는다 — 시험만을 위해 넓히지 않았다).
 */
test("⚠N3 3-20 · 023 은 022 까지 적용된 DB 에 두 칸(판 · 순서 기준선)을 더하고 기존 행은 NULL · 다시 열어도 그대로 · CHECK 가 모양 밖을 거부 · 되돌릴 수 있다", async () => {
  assert.ok(listMigrations().includes(MIGRATION), `${MIGRATION} 이 없다`);
  const dir = await mkdtemp(join(tmpdir(), "bb-profile-rev-"));
  const path = join(dir, "t.sqlite");
  let db: Db | undefined;
  try {
    const raw = new DatabaseSync(path);
    try {
      raw.exec("CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      applyPendingMigrations(raw, NOW, new Set(listMigrations().filter((m) => m >= MIGRATION)));
      const cols = (raw.prepare("PRAGMA table_info(player)").all() as { name: string }[]).map((c) => c.name);
      assert.ok(!cols.includes("profile_revision") && !cols.includes("profile_content_at"), "022 까지인데 칸이 이미 있다 — 이 시험의 전제가 틀렸다");
      raw.prepare("INSERT INTO player (player_id, display_name, first_seen_at, last_seen_at, profile_fetched_at, uniform_number) VALUES (?, ?, ?, ?, ?, ?)")
        .run(ID, "高橋昂也", NOW, NOW, T_DB, "34");
    } finally {
      raw.close();
    }

    for (const round of [1, 2]) {
      db = openDb(path, NOW);
      const row = db.raw.prepare("SELECT profile_revision AS r, profile_content_at AS c, profile_fetched_at AS t, uniform_number AS u FROM player WHERE player_id = ?").get(ID) as
        { r: string | null; c: string | null; t: string | null; u: string | null };
      assert.deepEqual({ ...row }, { r: null, c: null, t: T_DB, u: "34" }, `${round}회째 — 기존 행의 새 칸 둘은 NULL 이고 다른 칸은 안 바뀐다`);
      const applied = (db.raw.prepare("SELECT COUNT(*) AS n FROM schema_migration WHERE name = ?").get(MIGRATION) as { n: number }).n;
      assert.equal(applied, 1, `${round}회째 — 023 이 ${applied}번 기록됐다`);
      db.close();
      db = undefined;
    }

    db = openDb(path, NOW);
    const set = db.raw.prepare("UPDATE player SET profile_revision = ? WHERE player_id = ?");
    set.run(BODY_SHA, ID);
    for (const bad of ["xyz", BODY_SHA.toUpperCase(), "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      assert.throws(() => set.run(bad, ID), /CHECK constraint failed/, `${bad.slice(0, 10)}… 를 받았다`);
    }
    assert.throws(() => set.run(12, ID), /CHECK constraint failed|cannot store/, "정수를 받았다");
    // 순서 기준선 — `normalizeFetchedAt` 의 출력 모양(`toISOString` 24자)만 받는다(3중 검토 3차 반영)
    const setAt = db.raw.prepare("UPDATE player SET profile_content_at = ? WHERE player_id = ?");
    setAt.run(T_DB, ID);
    setAt.run(null, ID);
    for (const bad of ["not-a-date", "", "2026-09-01T00:00:00Z", "2026-09-01T09:00:00.000+09:00", "2026-09-01 00:00:00.000Z", `${T_DB} `]) {
      assert.throws(() => setAt.run(bad, ID), /CHECK constraint failed/, `${JSON.stringify(bad)} 를 받았다`);
    }
    assert.throws(() => setAt.run(20260901, ID), /CHECK constraint failed|cannot store/, "정수를 받았다");
    // ⚠모양만 본다 — 달력상 무효는 통과한다(적재기가 `normalizeFetchedAt` 로 다시 보고 invalid-db 로 건너뛴다 · 3-1 ⑥)
    assert.doesNotThrow(() => setAt.run(SHAPE_ONLY, ID));
    // ⚠**되돌릴 수 있다**(가산 마이그레이션) — 칸 CHECK 는 그 칸의 것이라 DROP COLUMN 을 막지 않는다
    db.raw.exec("ALTER TABLE player DROP COLUMN profile_content_at");
    db.raw.exec("ALTER TABLE player DROP COLUMN profile_revision");
    const after = (db.raw.prepare("PRAGMA table_info(player)").all() as { name: string }[]).map((c) => c.name);
    assert.ok(!after.includes("profile_revision") && !after.includes("profile_content_at"), "DROP COLUMN 뒤에도 칸이 있다");
  } finally {
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
