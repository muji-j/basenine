# 옛 판 가드 · 경기 페이지 세트 기록 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 적재기가 DB 보다 옛 판인 경기를 되돌리지 못하게 하고(C5), 아카이버가 경기 페이지 4장을 한 세트로만 기록하게 하며(C6), 사람이 그 날짜를 CI 에서 다시 받을 수 있게 한다.

**Architecture:** 판정은 `packages/store/src/version-guard.ts`(판 비교 · 트랜잭션 안 재판정)와 `packages/store/src/page-integrity.ts`(본문 sha · 세트 표식 대조) 두 순수 모듈에 두고, `packages/store/tools/load-archive.ts` 가 경기마다 그 순서로 부른다. 아카이버는 `archiveUrl` 을 `prepareUrl`/`commitPrepared` 로 나눠 `archiveGame` 이 「전부 받은 뒤 기록」을 하고 사이드카에 `set` 을 남긴다. 재수집은 `workflow_dispatch` 입력 → 환경변수 → `scripts/date-window.ts` 의 검증 함수.

**Tech Stack:** Node ≥24 · TypeScript(타입 제거 실행) · `node:test` · `node:sqlite`(`DatabaseSync`) · GitHub Actions.

**설계 정본:** `docs/superpowers/specs/2026-09-25-archive-load-version-guard-design.md`(커밋 `fd9f52d` · 승인). 이 계획과 어긋나면 설계서가 이긴다.

## Global Constraints

- 시계는 주입한다 — 라이브러리(`packages/*/src`)에서 인자 없는 `new Date()`·`Date.now()` 금지(`scripts/test/clock-injection.test.ts` 가 강제). `new Date(문자열·숫자)` 는 허용.
- 무효 시각은 fail-closed — 시각 해석은 **`normalizeFetchedAt`·`fetchedAtOf`(`packages/store/src/meta.ts`) 한 벌**만 쓴다. `Date.parse` 를 날것으로 판정에 쓰지 않는다.
- 외부 요청 수·순서·간격을 바꾸지 않는다(L1). 개발 루프에서 npb.jp 를 치지 않는다.
- 새 시험은 **고치기 전 코드에서 먼저 실패하는지** 확인한 뒤 채택한다(각 태스크의 「실패 확인」 단계).
- 저장소 파일에 개발자 절대경로를 쓰지 않는다. 스크래치는 `$CLAUDE_JOB_DIR/tmp`.
- 시험은 단일 러너로 돌린다: 개별은 `node --test <파일>`, 전체는 `npm test`. 결과는 분모와 함께 적고 FAIL 과 ERROR 를 나눠 센다.
- 실물 아카이브를 쓰는 시험은 `data/archive` 가 없으면 건너뛰되 **`BB_REQUIRE_DB=1` 이면 던진다**(기존 관례 · `packages/aggregate/test/count-seasons.test.ts:43`).
- 커밋 신원은 이 저장소 설정(`muji-j`) 그대로. 커밋 메시지 끝에 세션 지시의 두 줄을 붙인다.

## 파일 지도

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/store/src/version-guard.ts` (새) | `judgeVersion` · `writeGameGuarded` | 1 |
| `packages/store/test/version-guard.test.ts` (새) | 7a · 7a′ · 7b | 1 |
| `packages/store/src/page-integrity.ts` (새) | `readGamePages` · `checkIntegrity` · `checkSet` | 2 |
| `packages/store/test/page-integrity.test.ts` (새) | 4조합 × 페이지 · 세트 규칙 | 2 |
| `packages/store/tools/load-archive.ts` | 경기별 순서 배선 · 명단 지연 합류 · 요약 · 종료 코드 | 3 |
| `packages/store/test/load-archive-guard.test.ts` (새) | 실물 경기로 적재기 통합(1·2·4·5·5a·6·6a·7·7c) | 3 |
| `packages/archiver/src/sink.ts` | `BlobMeta.set` · `BlobExtra` 이동 없음(아래) | 4 |
| `packages/archiver/src/archive.ts` | `prepareUrl` · `commitPrepared` · `held` · `archiveGame` 세트 기록 · `gameSetId` | 4 · 5 |
| `packages/archiver/src/cli.ts` | 요약에 `보류` | 4 |
| `packages/archiver/test/game-set.test.ts` (새) | 8 · 9 · 9a · 10 · 11a · 12a · 12b · 12c | 4 · 5 |
| `scripts/date-window.ts` | `parseRefetchDates` · `MAX_REFETCH_DATES` | 6 |
| `scripts/test/date-window.test.ts` | 13 | 6 |
| `scripts/update.ts` | `BB_REFETCH_DATES` 배선 | 6 |
| `.github/workflows/daily.yml` | `refetch_dates` 입력 · 수집 단계 `env` | 6 |
| `scripts/test/refetch-wiring.test.ts` (새) | 14 | 6 |
| `docs/operations/deploy.md` | §7-E 런북 | 7 |

---

### Task 1: 판정 함수 — `version-guard.ts`

**Files:**
- Create: `packages/store/src/version-guard.ts`
- Create: `packages/store/test/version-guard.test.ts`
- Modify: `packages/store/src/index.ts`(끝에 내보내기 한 줄)

**Interfaces:**
- Consumes: `Db`(`packages/store/src/db.ts` · `raw: DatabaseSync` · `transaction<T>(fn: () => T): T`) · `normalizeFetchedAt(v: unknown): string | null`(`meta.ts`)
- Produces:
  - `type VersionJudgement = "new" | "same-or-newer" | "stale" | "invalid-db"`
  - `judgeVersion(db: Db, gameId: string, boxSeenAt: string): VersionJudgement` — `boxSeenAt` 은 `fetchedAtOf` 가 돌려준 값(정규화됨). 정규화되지 않은 값이면 `TypeError` 를 던진다(호출자 결함).
  - `type GuardedWrite<T> = { outcome: "written"; value: T } | { outcome: "stale" } | { outcome: "invalid-db" }`
  - `writeGameGuarded<T>(db: Db, gameId: string, boxSeenAt: string, write: () => T): GuardedWrite<T>`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/store/test/version-guard.test.ts`:

```ts
/**
 * 옛 판 가드의 판정 함수(설계 D1 · 시험 7a · 7a′ · 7b).
 * ⚠7a 가 이 파일의 핵심이다 — 판정 SELECT 가 **쓰기 트랜잭션 안**에서 돈다는 것을 잰다.
 *   SELECT 를 트랜잭션 밖으로 옮긴 판은 이 시험이 반드시 붉어야 한다(뮤테이션 확인).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "../src/index.ts";
import { judgeVersion, writeGameGuarded } from "../src/version-guard.ts";

const NOW = "2026-09-25T00:00:00.000Z";
const GAME = "2026/0815/b-f-20";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-vguard-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function putGame(db: ReturnType<typeof openDb>, fetchedAt: string, homeRuns = 4): void {
  upsertGame(db, {
    gameId: GAME, season: 2026, gameDate: "2026-08-15", awayCode: "f", homeCode: "b", gameNo: 20,
    status: "played", notPlayedReason: null, competition: "regular", series: null,
    sourceUrl: "https://npb.jp/scores/2026/0815/b-f-20/box.html", fetchedAt,
    awayRuns: 12, homeRuns, awayHits: null, homeHits: null, awayErrors: null, homeErrors: null, venue: null,
  });
}

test("7b 행이 없으면 new", async () => {
  await withDb((db) => {
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.000Z"), "new");
  });
});

test("7b 같은 밀리초는 소수 자릿수가 달라도 same-or-newer — 같은 시각은 진행한다(별칭 재정규화)", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.5Z");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.500Z"), "same-or-newer");
  });
});

test("7b 1ms 이르면 stale · 늦으면 same-or-newer", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T11:59:59.999Z"), "stale");
    assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.001Z"), "same-or-newer");
  });
});

test("7b DB 의 fetched_at 이 무효면 invalid-db(fail-closed)", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    for (const bad of ["not-a-date", "2026-08-16T12:00:00"]) {
      db.raw.prepare("UPDATE game SET fetched_at = ? WHERE game_id = ?").run(bad, GAME);
      assert.equal(judgeVersion(db, GAME, "2026-08-16T12:00:00.000Z"), "invalid-db", bad);
    }
  });
});

test("7b 정규화되지 않은 boxSeenAt 은 호출자 결함이다 — 던진다", async () => {
  await withDb((db) => {
    assert.throws(() => judgeVersion(db, GAME, "2026-08-16T12:00:00"), TypeError);
  });
});

test("⚠7a 판정 SELECT 는 쓰기 트랜잭션 안에서 돈다", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    const inTx: boolean[] = [];
    const original = db.raw.prepare.bind(db.raw);
    db.raw.prepare = ((sql: string) => {
      if (/SELECT\s+fetched_at\s+FROM\s+game/i.test(sql)) inTx.push(db.raw.isTransaction);
      return original(sql);
    }) as typeof db.raw.prepare;
    const r = writeGameGuarded(db, GAME, "2026-08-16T12:00:00.000Z", () => 1);
    assert.equal(r.outcome, "written");
    assert.deepEqual(inTx, [true], "판정 SELECT 가 정확히 한 번 · 트랜잭션 안에서 돌아야 한다");
  });
});

test("⚠7a′ 사전 판정 뒤에 더 새 판이 커밋되면 쓰지 않고 stale", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z", 4);
    const box = "2026-08-16T12:00:00.000Z";
    assert.equal(judgeVersion(db, GAME, box), "same-or-newer", "사전 판정은 통과한다");
    // 다른 적재기가 그 사이에 더 새 판을 넣었다
    putGame(db, "2026-08-17T00:00:00.000Z", 9);
    let called = 0;
    const r = writeGameGuarded(db, GAME, box, () => {
      called += 1;
      return 1;
    });
    assert.equal(r.outcome, "stale");
    assert.equal(called, 0, "옛 판의 쓰기 콜백이 불리면 안 된다");
    const row = db.raw.prepare("SELECT home_runs AS h FROM game WHERE game_id = ?").get(GAME) as { h: number };
    assert.equal(row.h, 9);
  });
});

test("writeGameGuarded 는 invalid-db 면 쓰지 않는다", async () => {
  await withDb((db) => {
    putGame(db, "2026-08-16T12:00:00.000Z");
    db.raw.prepare("UPDATE game SET fetched_at = 'x' WHERE game_id = ?").run(GAME);
    let called = 0;
    const r = writeGameGuarded(db, GAME, "2026-08-16T12:00:00.000Z", () => (called += 1));
    assert.equal(r.outcome, "invalid-db");
    assert.equal(called, 0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/version-guard.test.ts`
Expected: 모듈을 못 찾아 **ERROR**(`Cannot find module '../src/version-guard.ts'`). ⚠FAIL 이 아니라 ERROR 다 — 구현 뒤에 모든 본이 실제로 도는지 분모로 확인한다.

- [ ] **Step 3: 구현한다**

`packages/store/src/version-guard.ts`:

```ts
/**
 * **옛 판이 새 판을 덮지 못하게 한다**(설계 `docs/superpowers/specs/2026-09-25-archive-load-version-guard-design.md` D1).
 *
 * ⚠**비교하는 값은 둘 다 「마지막으로 확인한 시각」이다.** 아카이브 쪽은 `fetchedAtOf`(사이드카의 `checkedAt ?? fetchedAt`),
 * DB 쪽 `game.fetched_at` 에는 적재기가 **바로 그 값**을 넣는다(`load-archive.ts` · `game-fetched-at.test.ts`).
 * ⚠**같은 시각은 진행한다** — 팀 코드 별칭 재정규화(`load.ts` 223-227행)는 같은 판을 다시 적재해 기존 행을 고치는 데 의존한다.
 * ⚠**판정은 쓰기 트랜잭션 안에서 다시 한다**(`writeGameGuarded`) — 사전 판정과 쓰기 사이에 다른 적재기가
 *   더 새 판을 넣어도 옛 판이 이기지 못한다. 시험 `version-guard.test.ts` 의 7a 가 그 위치를 고정한다.
 */
import type { Db } from "./db.ts";
import { normalizeFetchedAt } from "./meta.ts";

export type VersionJudgement = "new" | "same-or-newer" | "stale" | "invalid-db";

export type GuardedWrite<T> =
  | { outcome: "written"; value: T }
  | { outcome: "stale" }
  | { outcome: "invalid-db" };

export function judgeVersion(db: Db, gameId: string, boxSeenAt: string): VersionJudgement {
  const box = normalizeFetchedAt(boxSeenAt);
  // ⚠호출자는 `fetchedAtOf` 의 결과(이미 정규화·검증됨)만 넘긴다. 아니면 호출자 결함이다
  if (box === null || box !== boxSeenAt) {
    throw new TypeError(`정규화되지 않은 취득 시각이다: ${JSON.stringify(boxSeenAt)} — fetchedAtOf 의 결과를 넘겨라`);
  }
  const row = db.raw.prepare("SELECT fetched_at AS f FROM game WHERE game_id = ?").get(gameId) as
    | { f: unknown }
    | undefined;
  // ⚠`fetched_at` 은 NOT NULL 이라 SQL NULL 은 실제로 오지 않는다 — 방어 분기다(시험 불가)
  if (row === undefined || row.f === null) return "new";
  const dbSeen = normalizeFetchedAt(row.f);
  if (dbSeen === null) return "invalid-db";
  return Date.parse(box) < Date.parse(dbSeen) ? "stale" : "same-or-newer";
}

export function writeGameGuarded<T>(db: Db, gameId: string, boxSeenAt: string, write: () => T): GuardedWrite<T> {
  return db.transaction((): GuardedWrite<T> => {
    const v = judgeVersion(db, gameId, boxSeenAt);
    if (v === "stale") return { outcome: "stale" };
    if (v === "invalid-db") return { outcome: "invalid-db" };
    return { outcome: "written", value: write() };
  });
}
```

`packages/store/src/index.ts` 끝에 한 줄:

```ts
export { judgeVersion, writeGameGuarded } from "./version-guard.ts";
export type { GuardedWrite, VersionJudgement } from "./version-guard.ts";
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test packages/store/test/version-guard.test.ts`
Expected: `# tests 8` · `# pass 8` · `# fail 0`.

- [ ] **Step 5: 뮤테이션 — 7a 가 실제로 무는지 확인한다**

`writeGameGuarded` 를 임시로 이렇게 바꾼다(판정을 트랜잭션 **앞**으로):

```ts
export function writeGameGuarded<T>(db: Db, gameId: string, boxSeenAt: string, write: () => T): GuardedWrite<T> {
  const v = judgeVersion(db, gameId, boxSeenAt);
  if (v === "stale") return { outcome: "stale" };
  if (v === "invalid-db") return { outcome: "invalid-db" };
  return db.transaction(() => ({ outcome: "written" as const, value: write() }));
}
```

Run: `node --test packages/store/test/version-guard.test.ts`
Expected: `⚠7a 판정 SELECT 는 쓰기 트랜잭션 안에서 돈다` 가 **FAIL**(`[false]` ≠ `[true]`). 확인 뒤 **원래 코드로 되돌리고** 다시 돌려 8/8 통과를 확인한다.

- [ ] **Step 6: 타입체크**

Run: `npm run typecheck`
Expected: 오류 0.

- [ ] **Step 7: 커밋**

```bash
git add packages/store/src/version-guard.ts packages/store/src/index.ts packages/store/test/version-guard.test.ts
git commit -m "feat(store): 옛 판 판정 함수 — 판정을 쓰기 트랜잭션 안에서 다시 한다"
```

---

### Task 2: 본문 무결성과 세트 대조 — `page-integrity.ts`

**Files:**
- Create: `packages/store/src/page-integrity.ts`
- Create: `packages/store/test/page-integrity.test.ts`
- Modify: `packages/store/src/index.ts`(내보내기)

**Interfaces:**
- Produces:
  - `const GAME_PAGE_LEAVES = ["index", "playbyplay", "box", "roster"] as const` · `type GamePageLeaf`
  - `interface PageFile { bodyPresent: boolean; metaPresent: boolean; body: Buffer | null; bodyError: string | null; meta: Record<string, unknown> | null; metaError: string | null }`
  - `type GamePages = Record<GamePageLeaf, PageFile>`
  - `readGamePages(dir: string): Promise<GamePages>` — `dir` 은 경기 폴더(`.../scores/2026/0815/b-f-20`). `body` 는 **gunzip 한** 바이트.
  - `type PageCheck = { ok: true } | { ok: false; reason: string }`
  - `checkIntegrity(pages: GamePages): PageCheck`
  - `checkSet(pages: GamePages): { ok: true; set: string | null } | { ok: false; reason: string }`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/store/test/page-integrity.test.ts`:

```ts
/**
 * 경기 폴더의 본문·사이드카 정합(설계 D3 · 시험 6·6a 의 단위판).
 * ⚠사이드카의 `sha256` 은 **gzip 전 본문**의 것이다(아카이버 `sha256(res.body)` · 실측 31,220/31,220 일치).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { GAME_PAGE_LEAVES, checkIntegrity, checkSet, readGamePages } from "../src/page-integrity.ts";

const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

async function gameDir(set?: Partial<Record<string, string | undefined>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-pages-"));
  for (const leaf of GAME_PAGE_LEAVES) {
    const body = `<html>${leaf}</html>`;
    await writeFile(join(dir, `${leaf}.html.gz`), gzipSync(Buffer.from(body, "utf8")));
    const meta: Record<string, unknown> = { url: `https://npb.jp/x/${leaf}`, fetchedAt: "2026-08-16T12:00:00.000Z", sha256: sha(body), revision: 1 };
    const s = set?.[leaf];
    if (s !== undefined) meta["set"] = s;
    await writeFile(join(dir, `${leaf}.meta.json`), JSON.stringify(meta));
  }
  return dir;
}

test("네 페이지가 온전하면 통과", async () => {
  const dir = await gameDir();
  try {
    assert.deepEqual(checkIntegrity(await readGamePages(dir)), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const leaf of GAME_PAGE_LEAVES) {
  test(`6a ${leaf}: 본문 한 바이트가 다르면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await writeFile(join(dir, `${leaf}.html.gz`), gzipSync(Buffer.from(`<html>${leaf}!</html>`, "utf8")));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, new RegExp(`${leaf}: 본문 sha256`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 본문만 없으면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.html.gz`));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /사이드카만 있고 본문이 없다/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 사이드카만 없으면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.meta.json`));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /본문만 있고 사이드카가 없다/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 둘 다 없으면 무결성은 통과(없는 페이지)`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.html.gz`));
      await unlink(join(dir, `${leaf}.meta.json`));
      const pages = await readGamePages(dir);
      assert.deepEqual(checkIntegrity(pages), { ok: true });
      assert.equal(pages[leaf].body, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("깨진 사이드카 JSON 은 불일치", async () => {
  const dir = await gameDir();
  try {
    await writeFile(join(dir, "roster.meta.json"), "{not json");
    const r = checkIntegrity(await readGamePages(dir));
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /roster: 사이드카 JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("6 세트: 아무 데도 없으면 통과(기존 기록) · 모두 같으면 통과", async () => {
  const a = await gameDir();
  const b = await gameDir({ index: "S1", playbyplay: "S1", box: "S1", roster: "S1" });
  try {
    assert.deepEqual(checkSet(await readGamePages(a)), { ok: true, set: null });
    assert.deepEqual(checkSet(await readGamePages(b)), { ok: true, set: "S1" });
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("6 세트: 값이 갈리거나 일부만 있으면 불일치", async () => {
  const a = await gameDir({ index: "S1", playbyplay: "S1", box: "S2", roster: "S1" });
  const b = await gameDir({ index: "S1", playbyplay: "S1", box: undefined, roster: "S1" });
  try {
    assert.equal(checkSet(await readGamePages(a)).ok, false);
    assert.equal(checkSet(await readGamePages(b)).ok, false);
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("6 세트: 없는 페이지(둘 다 없음)는 세트 대조에서 빠진다", async () => {
  const dir = await gameDir({ index: "S1", playbyplay: "S1", box: "S1", roster: "S1" });
  try {
    await unlink(join(dir, "roster.html.gz"));
    await unlink(join(dir, "roster.meta.json"));
    assert.deepEqual(checkSet(await readGamePages(dir)), { ok: true, set: "S1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/page-integrity.test.ts`
Expected: 모듈 없음으로 **ERROR**.

- [ ] **Step 3: 구현한다**

`packages/store/src/page-integrity.ts`:

```ts
/**
 * 경기 폴더의 **본문·사이드카 정합**과 **세트 표식** 대조(설계 D3).
 *
 * ⚠순서가 뜻을 갖는다: 무결성(`checkIntegrity`)을 **먼저** 본다 — 본문이 사이드카와 안 맞으면 그 사이드카의 `set` 은 믿을 근거가 없다.
 * ⚠아카이버는 본문 `rename` 다음 사이드카 `rename` 을 한다(`packages/archiver/src/sink.ts`). 그 사이에서 죽으면
 *   **본문은 새 판 · 사이드카는 옛 판**이 되고, `set` 비교로는 못 잡는다 — 그래서 sha 를 대조한다.
 * ⚠`set` 이 아무 데도 없는 경기는 **이 기능 이전의 기록**으로 보고 통과시킨다(실측 근거의 수용 위험 · 설계 §6).
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const GAME_PAGE_LEAVES = ["index", "playbyplay", "box", "roster"] as const;
export type GamePageLeaf = (typeof GAME_PAGE_LEAVES)[number];

export interface PageFile {
  bodyPresent: boolean;
  metaPresent: boolean;
  /** gunzip 한 본문. 파일이 없거나 풀지 못했으면 null */
  body: Buffer | null;
  bodyError: string | null;
  /** 사이드카 JSON. 파일이 없거나 못 읽었으면 null */
  meta: Record<string, unknown> | null;
  metaError: string | null;
}

export type GamePages = Record<GamePageLeaf, PageFile>;

export type PageCheck = { ok: true } | { ok: false; reason: string };

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function readGamePages(dir: string): Promise<GamePages> {
  const out = {} as GamePages;
  for (const leaf of GAME_PAGE_LEAVES) {
    const gz = await readOptional(join(dir, `${leaf}.html.gz`));
    let body: Buffer | null = null;
    let bodyError: string | null = null;
    if (gz !== null) {
      try {
        body = gunzipSync(gz);
      } catch (err) {
        bodyError = message(err);
      }
    }
    const raw = await readOptional(join(dir, `${leaf}.meta.json`));
    let meta: Record<string, unknown> | null = null;
    let metaError: string | null = null;
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) metaError = "사이드카가 객체가 아니다";
        else meta = parsed as Record<string, unknown>;
      } catch (err) {
        metaError = `사이드카 JSON 을 못 읽었다 — ${message(err)}`;
      }
    }
    out[leaf] = { bodyPresent: gz !== null, metaPresent: raw !== null, body, bodyError, meta, metaError };
  }
  return out;
}

export function checkIntegrity(pages: GamePages): PageCheck {
  for (const leaf of GAME_PAGE_LEAVES) {
    const p = pages[leaf];
    if (!p.bodyPresent && !p.metaPresent) continue; // 없는 페이지 — 불일치가 아니다
    if (p.bodyPresent && !p.metaPresent) return { ok: false, reason: `${leaf}: 본문만 있고 사이드카가 없다` };
    if (!p.bodyPresent && p.metaPresent) return { ok: false, reason: `${leaf}: 사이드카만 있고 본문이 없다` };
    if (p.bodyError !== null) return { ok: false, reason: `${leaf}: 본문을 못 풀었다 — ${p.bodyError}` };
    if (p.metaError !== null) return { ok: false, reason: `${leaf}: ${p.metaError}` };
    const want = p.meta?.["sha256"];
    if (typeof want !== "string") return { ok: false, reason: `${leaf}: 사이드카에 sha256 이 없다` };
    const got = createHash("sha256").update(p.body!).digest("hex");
    if (got !== want) return { ok: false, reason: `${leaf}: 본문 sha256 이 사이드카와 다르다` };
  }
  return { ok: true };
}

export function checkSet(pages: GamePages): { ok: true; set: string | null } | { ok: false; reason: string } {
  const leaves = GAME_PAGE_LEAVES.filter((l) => pages[l].meta !== null);
  const sets = leaves.map((l) => {
    const s = pages[l].meta?.["set"];
    return typeof s === "string" ? s : null;
  });
  if (sets.every((s) => s === null)) return { ok: true, set: null };
  if (new Set(sets).size === 1) return { ok: true, set: sets[0]! };
  return {
    ok: false,
    reason: `세트 표식이 갈린다: ${leaves.map((l, i) => `${l}=${sets[i] ?? "없음"}`).join(" · ")}`,
  };
}
```

`packages/store/src/index.ts` 끝에:

```ts
export { GAME_PAGE_LEAVES, checkIntegrity, checkSet, readGamePages } from "./page-integrity.ts";
export type { GamePageLeaf, GamePages, PageCheck, PageFile } from "./page-integrity.ts";
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test packages/store/test/page-integrity.test.ts`
Expected: `# tests 21` · `# pass 21` · `# fail 0`(페이지 4 × 4조합 16 + 5).

- [ ] **Step 5: 뮤테이션**

`checkIntegrity` 의 `if (got !== want)` 줄을 지우고 돌린다 → 「본문 한 바이트가 다르면 불일치」 4본이 **FAIL**. 되돌리고 21/21 확인.

- [ ] **Step 6: 타입체크 · 커밋**

Run: `npm run typecheck` → 오류 0.

```bash
git add packages/store/src/page-integrity.ts packages/store/src/index.ts packages/store/test/page-integrity.test.ts
git commit -m "feat(store): 경기 폴더의 본문 sha·세트 표식 대조"
```

---

### Task 3: 적재기 배선 — `load-archive.ts`

**Files:**
- Modify: `packages/store/tools/load-archive.ts`(가져오기 · 카운터 · 경기 루프 218~623행 · 요약 699~747행)
- Create: `packages/store/test/load-archive-guard.test.ts`

**Interfaces:**
- Consumes: Task 1 `judgeVersion`·`writeGameGuarded` · Task 2 `readGamePages`·`checkIntegrity`·`checkSet`
- Produces(출력 문구 — 시험과 런북이 읽는다):
  - 요약 줄 `옛 판 건너뜀 N건 · 세트 불일치 N건 · 본문 불일치 N건`(0 이어도)
  - 옛 판이 있으면 `⚠아카이브가 DB 보다 옛 판인 경기 N건` 과 경기 ID
  - 재수집 안내 줄 `복구: 수동 실행 입력 refetch_dates=YYYY-MM-DD,...`

- [ ] **Step 1: 실패하는 통합 시험을 쓴다**

`packages/store/test/load-archive-guard.test.ts`:

```ts
/**
 * 적재기의 옛 판 가드 · 세트 · 본문 대조를 **실물 경기**로 잰다(설계 §7 시험 1·2·4·5·5a·6·6a·7·7c).
 *
 * ⚠**합성 box 를 쓰지 않는다** — 파서가 엄격해서 만든 문자열은 실물과 갈리고, 그러면 「아무것도 안 재는 초록」이 된다
 *   (`packages/parser/test/fixtures/README.md`). 로컬·CI 의 `data/archive` 에서 경기 폴더를 **임시 폴더로 복사**해 쓴다.
 * ⚠「DB 가 더 새 판」은 HTML 을 고치지 않고 **DB 쪽 `fetched_at` 을 늦추고 표지 값을 심어** 만든다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertPlayer } from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCORES = join(ROOT, "data", "archive", "npb", "scores");
const TOOL = fileURLToPath(new URL("../tools/load-archive.ts", import.meta.url));
const PLAYED = "2026/0815/b-f-20";
const NOT_PLAYED = "2026/0813/s-c-19";
const NOW = "2026-09-25T00:00:00.000Z";
const LATER = "2030-01-01T00:00:00.000Z";

const HAS = existsSync(join(SCORES, PLAYED, "box.html.gz")) && existsSync(join(SCORES, NOT_PLAYED, "box.html.gz"));
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${SCORES} 에 픽스처 경기(${PLAYED} · ${NOT_PLAYED})가 없다`);
}
const skip = HAS ? false : "data/archive 의 픽스처 경기 없음";

interface Env { dir: string; archive: string; dbPath: string }

async function setup(games: string[]): Promise<Env> {
  const dir = await mkdtemp(join(tmpdir(), "bb-guard-"));
  const archive = join(dir, "archive");
  for (const g of games) await cp(join(SCORES, g), join(archive, "npb", "scores", g), { recursive: true });
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  return { dir, archive, dbPath };
}

function load(env: Env): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
}

const pagePath = (env: Env, g: string, leaf: string, ext: string) => join(env.archive, "npb", "scores", g, `${leaf}.${ext}`);

async function editMeta(env: Env, g: string, leaf: string, fn: (m: Record<string, unknown>) => void): Promise<void> {
  const p = pagePath(env, g, leaf, "meta.json");
  const m = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  fn(m);
  await writeFile(p, JSON.stringify(m));
}

function q<T>(env: Env, sql: string, ...args: (string | number)[]): T {
  const db = openDb(env.dbPath, NOW);
  try {
    return db.raw.prepare(sql).get(...args) as T;
  } finally {
    db.close();
  }
}

function exec(env: Env, sql: string, ...args: (string | number)[]): void {
  const db = openDb(env.dbPath, NOW);
  try {
    db.raw.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

const gameId = (g: string) => g;

test("7 · 2 기준: 실물 경기 적재는 종료 0 · 요약에 세 건수가 0 으로 찍힌다 · 두 번 적재해도 revision 불변", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    const a = load(env);
    assert.equal(a.code, 0, a.out + a.err);
    assert.match(a.out, /옛 판 건너뜀 0건 · 세트 불일치 0건 · 본문 불일치 0건/);
    const b = load(env);
    assert.equal(b.code, 0, b.out + b.err);
    assert.equal(q<{ r: number }>(env, "SELECT revision AS r FROM game WHERE game_id = ?", gameId(PLAYED)).r, 1);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("⚠1 DB 가 더 새 판이면 경기 행·자식 행을 건드리지 않고 종료 1 · 경기 ID 와 복구 입력을 찍는다", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE game SET fetched_at = ?, home_runs = 99 WHERE game_id = ?", LATER, gameId(PLAYED));
    exec(env, "UPDATE batting_line SET h = 777 WHERE game_id = ? AND rowid = (SELECT MIN(rowid) FROM batting_line WHERE game_id = ?)", gameId(PLAYED), gameId(PLAYED));
    const before = q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM pa_event WHERE game_id = ?", gameId(PLAYED)).n;
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /옛 판 건너뜀 1건/);
    assert.ok(r.out.includes(gameId(PLAYED)), "경기 ID 를 찍어야 한다");
    assert.match(r.out, /refetch_dates=2026-08-15/);
    assert.equal(q<{ h: number }>(env, "SELECT home_runs AS h FROM game WHERE game_id = ?", gameId(PLAYED)).h, 99);
    assert.equal(q<{ r: number }>(env, "SELECT revision AS r FROM game WHERE game_id = ?", gameId(PLAYED)).r, 1);
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM batting_line WHERE game_id = ? AND h = 777", gameId(PLAYED)).n, 1, "자식 행도 그대로여야 한다");
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM pa_event WHERE game_id = ?", gameId(PLAYED)).n, before);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("4 box 의 checkedAt 이 DB 보다 늦으면 진행한다(재수집해서 내용이 같았던 경우)", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE game SET fetched_at = ?, home_runs = 99 WHERE game_id = ?", "2029-01-01T00:00:00.000Z", gameId(PLAYED));
    await editMeta(env, PLAYED, "box", (m) => { m["checkedAt"] = LATER; });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.notEqual(q<{ h: number }>(env, "SELECT home_runs AS h FROM game WHERE game_id = ?", gameId(PLAYED)).h, 99);
    assert.equal(q<{ f: string }>(env, "SELECT fetched_at AS f FROM game WHERE game_id = ?", gameId(PLAYED)).f, LATER);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("5 옛 미성립 box 가 실시 기록을 지우지 않는다", { skip }, async () => {
  const env = await setup([NOT_PLAYED]);
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE game SET status = 'played', not_played_reason = NULL, home_runs = 3, fetched_at = ? WHERE game_id = ?", LATER, gameId(NOT_PLAYED));
    // ⚠외래키가 켜져 있다(`db.ts` · `PRAGMA foreign_keys = ON`) — 선수 행을 먼저 만든다
    {
      const db = openDb(env.dbPath, NOW);
      try {
        upsertPlayer(db, "P1", "시험선수", NOW);
      } finally {
        db.close();
      }
    }
    exec(env, "INSERT INTO batting_line (game_id, player_id, side, batting_order, position, pa, ab, h, d2, d3, hr, bb, ibb, hbp, sf, sh, so, roe, runs, rbi, sb) VALUES (?, 'P1', 'home', 1, '中', 4, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)", gameId(NOT_PLAYED));
    const r = load(env);
    assert.equal(r.code, 1);
    assert.equal(q<{ s: string }>(env, "SELECT status AS s FROM game WHERE game_id = ?", gameId(NOT_PLAYED)).s, "played");
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM batting_line WHERE game_id = ?", gameId(NOT_PLAYED)).n, 1);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("5 옛 inProgress box 도 옛 판으로 걸린다(사전 판정이 모든 분기보다 앞)", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE game SET fetched_at = ? WHERE game_id = ?", LATER, gameId(PLAYED));
    // 파서는 `試合時間` 이 없으면 끝나지 않은 경기로 본다(`packages/parser/src/box.ts` isFinished)
    const gz = pagePath(env, PLAYED, "box", "html.gz");
    const html = gunzipSync(await readFile(gz)).toString("utf8").replaceAll("試合時間", "試合");
    await writeFile(gz, gzipSync(Buffer.from(html, "utf8")));
    await editMeta(env, PLAYED, "box", (m) => { m["sha256"] = createHash("sha256").update(Buffer.from(html, "utf8")).digest("hex"); });
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /옛 판 건너뜀 1건/);
    assert.doesNotMatch(r.out, /아직 진행 중/);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("5a 옛 판 경기의 명단은 선수 표를 채우지 않는다", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    assert.equal(load(env).code, 0);
    const p = q<{ id: string }>(env, "SELECT player_id AS id FROM batting_line WHERE game_id = ? LIMIT 1", gameId(PLAYED)).id;
    exec(env, "UPDATE player SET throws = NULL, bats = NULL, uniform_number = NULL, position = NULL WHERE player_id = ?", p);
    exec(env, "UPDATE game SET fetched_at = ? WHERE game_id = ?", LATER, gameId(PLAYED));
    assert.equal(load(env).code, 1);
    const row = q<{ t: string | null; pos: string | null }>(env, "SELECT throws AS t, position AS pos FROM player WHERE player_id = ?", p);
    assert.equal(row.t, null, "옛 판의 명단이 투타를 채우면 안 된다");
    assert.equal(row.pos, null);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("6 세트 표식이 갈리면 건너뛰고 종료 1", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    for (const leaf of ["index", "playbyplay", "roster"]) await editMeta(env, PLAYED, leaf, (m) => { m["set"] = "S1"; });
    await editMeta(env, PLAYED, "box", (m) => { m["set"] = "S2"; });
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /세트 불일치 1건/);
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM game").n, 0, "아무것도 쓰지 않아야 한다");
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("6a index 본문이 사이드카와 다르면 건너뛴다 · 7c DB 가 비어 있어도 걸린다", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    const gz = pagePath(env, PLAYED, "index", "html.gz");
    const html = gunzipSync(await readFile(gz)).toString("utf8") + " ";
    await writeFile(gz, gzipSync(Buffer.from(html, "utf8")));
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /본문 불일치 1건/);
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM game").n, 0);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("6a playbyplay 가 둘 다 없으면 지금 동작 그대로 — PBP 실패로 세고 경기는 타석 없이 적재", { skip }, async () => {
  const env = await setup([PLAYED]);
  try {
    await unlink(pagePath(env, PLAYED, "playbyplay", "html.gz"));
    await unlink(pagePath(env, PLAYED, "playbyplay", "meta.json"));
    const r = load(env);
    assert.equal(r.code, 1);
    assert.match(r.err, /PBP ERROR/);
    assert.match(r.out, /본문 불일치 0건/);
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM game").n, 1);
    assert.equal(q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM pa_event").n, 0);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/load-archive-guard.test.ts`
Expected(고치기 전): 기준 시험은 요약 문구가 없어 **FAIL** · 시험 1 은 종료 0·득점 덮임으로 **FAIL** · 5·5a·6·6a(본문) **FAIL** · 「playbyplay 둘 다 없음」은 요약 문구 때문에 **FAIL** · 시험 4 는 통과할 수 있다(지금 코드는 판을 안 보므로 진행). ⚠**`skip` 으로 끝나면 안 쟀다** — `data/archive` 가 있는지 먼저 확인한다(`ls data/archive/npb/scores/2026/0815/b-f-20`).

- [ ] **Step 3: 가져오기와 카운터를 더한다**

`packages/store/tools/load-archive.ts` 의 가져오기 끝(40행 `} from "../src/load.ts";` 다음)에:

```ts
import { judgeVersion, writeGameGuarded } from "../src/version-guard.ts";
import { checkIntegrity, checkSet, readGamePages } from "../src/page-integrity.ts";
```

`const quarantineKinds = new Map<string, number>();`(177행) 다음에:

```ts
/**
 * ⚠**적재하지 않은 경기 셋**(설계 D1·D3 · 2026-09-25). 셋 다 **종료 코드 1** 이다 — 사용자 결정:
 * 옛 판을 만나면 실패로 끝내 배포를 막는다. 옛 판이 된 원인(보관소 업로드 부분 실패 · 백필 덧붙임)은
 * **아카이브 자산 손실**이라 사람이 봐야 한다. 처치는 그 날짜 재수집이다(`docs/operations/deploy.md` §7-E).
 */
const staleArchive: { gameId: string; date: string }[] = [];
const setMismatch: { gameId: string; date: string; reason: string }[] = [];
const integrityMismatch: { gameId: string; date: string; reason: string }[] = [];
```

`let rosterFailed = 0;`(206행) 다음에:

```ts
type RosterEntry = { date: string; throws: string; bats: string; uniformNumber: string | null; position: string };
/**
 * ⚠**경기의 쓰기가 실제로 된 뒤에만 합친다**(설계 D1-6). 전에는 파싱하자마자 전역 표에 넣어서,
 * 그 경기가 뒤에서 건너뛰어져도 명단은 선수 표(투타·배번·포지션 보충)로 흘러갔다.
 */
function mergeRoster(entries: readonly (readonly [string, RosterEntry])[]): void {
  for (const [playerId, v] of entries) {
    const prev = rosterLatest.get(playerId);
    if (prev === undefined || prev.date <= v.date) rosterLatest.set(playerId, v);
  }
}
```

- [ ] **Step 4: 경기 루프의 앞부분을 바꾼다**

238~279행(`let box;` 부터 `boxFetchedAt === null` 블록 끝 `}` 까지)을 통째로 아래로 바꾼다. **249~261행의 「언제 받았는가」 주석은 그대로 옮기고**, 262~270행의 「일부러 안 한다」 주석은 아래 새 주석으로 **대체**한다:

```ts
  // ⚠네 페이지를 **먼저 한 번** 읽는다 — 무결성 대조와 파싱이 같은 바이트를 본다(설계 D3)
  const pages = await readGamePages(dirname(file));

  /**
   * **언제 받았는가**(M4). ⚠**적재 시각이 아니다.**
   * (… 기존 249~261행 주석 본문을 그대로 둔다 …)
   */
  const boxFetchedAt = fetchedAtOf(join(dirname(file), "box.meta.json"));
  if (boxFetchedAt === null) {
    failed += 1;
    console.error(
      `취득 시각을 못 읽었다 ${meta.gameId} — ${join(dirname(file), "box.meta.json")}. ` +
        "적재 시각으로 메우지 않는다(M11). 사이드카를 확인하라.",
    );
    continue;
  }

  /**
   * ⚠**옛 판이 새 판을 덮지 못하게 한다**(M5 · 2026-09-25 감사 C5 · 설계 D1).
   *
   * 예전 결정은 「경기는 `box.html.gz` 가 하나라 경합이 없고, 옛 아카이브 복원은 `archive-guard` 가 막는다」였다.
   * ⚠**뒤의 전제가 거짓이었다** — `archive-guard` 는 파일 수 감소와 0.5% 넘는 바이트 감소만 본다.
   * 보관소 업로드가 오늘 세대를 지운 뒤 실패하면 다음 실행이 **어제 세대 + 더 새 DB** 를 복원하고,
   * 정정만 있던 날은 파일 수가 같아 통과한다. 백필 덧붙임이 옛 페이지를 덮어도 같다.
   * 그러면 점수·안타가 과거로 돌아가고 `revision` 은 오른다 — 수집 창 밖이면 영영 안 돌아온다.
   * → **모든 분기(대회·끝나지 않은 경기·미성립·명단)보다 앞에서** 판정하고, 쓰기 트랜잭션 안에서 **한 번 더** 한다.
   * ⚠`upsertGame` 의 SQL 에 `WHERE` 를 다는 것으로는 안 된다 — 자식 행을 같은 트랜잭션에서 갈아 넣으므로 자식만 옛 판이 된다.
   */
  const pre = judgeVersion(db, meta.gameId, boxFetchedAt);
  if (pre === "invalid-db") {
    failed += 1;
    console.error(`DB 의 취득 시각이 무효다 ${meta.gameId} — 판을 비교할 수 없어 건너뛴다(fail-closed)`);
    continue;
  }
  if (pre === "stale") {
    staleArchive.push({ gameId: meta.gameId, date: meta.gameDate });
    continue;
  }

  // ⚠본문 무결성을 세트보다 **먼저** 본다 — 본문이 사이드카와 안 맞으면 그 사이드카의 `set` 은 믿을 근거가 없다(설계 D3)
  const integrity = checkIntegrity(pages);
  if (!integrity.ok) {
    integrityMismatch.push({ gameId: meta.gameId, date: meta.gameDate, reason: integrity.reason });
    continue;
  }
  const setCheck = checkSet(pages);
  if (!setCheck.ok) {
    setMismatch.push({ gameId: meta.gameId, date: meta.gameDate, reason: setCheck.reason });
    continue;
  }

  let box;
  // 무결성을 통과했으므로 box 본문이 있다(순회가 `box.html.gz` 로 찾았고 사이드카와 sha 가 맞았다)
  const boxHtml = pages.box.body!.toString("utf8");
  try {
    box = parseBoxScore(boxHtml);
  } catch (err) {
    failed += 1;
    console.error(`PARSE ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
```

- [ ] **Step 5: 미성립 분기를 감싼다**

327~356행(`if (box.status === "notPlayed") {` 블록)을 아래로 바꾼다(주석은 그대로 옮긴다):

```ts
  if (box.status === "notPlayed") {
    const w = writeGameGuarded(db, meta.gameId, boxFetchedAt, () => {
      const n = upsertGame(db, {
        ...meta,
        status: "notPlayed",
        notPlayedReason: box.reason,
        competition,
        series,
        sourceUrl,
        fetchedAt: boxFetchedAt,
        // ⚠중지 경기에 결과는 없다. **0-0이 아니라 「없음」**이다(M11)
        venue,
      });
      /* (기존 341~348행의 「성립하지 않은 경기의 기록을 지운다」 주석을 그대로 둔다) */
      db.raw.prepare("DELETE FROM pa_event WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM batting_line WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM pitching_line WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM quarantine WHERE game_id = ?").run(meta.gameId);
      return n;
    });
    if (w.outcome === "stale") {
      staleArchive.push({ gameId: meta.gameId, date: meta.gameDate });
      continue;
    }
    if (w.outcome === "invalid-db") {
      failed += 1;
      console.error(`DB 의 취득 시각이 무효다 ${meta.gameId} — 판을 비교할 수 없어 건너뛴다(fail-closed)`);
      continue;
    }
    notPlayed += 1;
    budget.games += w.value;
    continue;
  }
```

- [ ] **Step 6: 라인스코어·PBP·명단이 버퍼를 쓰게 한다**

374행:

```ts
    const ls = parseLineScore(gunzipSync(await readFile(file)).toString("utf8"));
```
→
```ts
    const ls = parseLineScore(boxHtml);
```

399행:

```ts
      const pbpHtml = gunzipSync(await readFile(pbpFile)).toString("utf8");
```
→
```ts
      const pbpBody = pages.playbyplay.body;
      // ⚠없으면 지금처럼 PBP 실패다(아래 catch · failed) — 경기는 타석 없이 적재된다
      if (pbpBody === null) throw new Error(`playbyplay 가 없다: ${pbpFile}`);
      const pbpHtml = pbpBody.toString("utf8");
```

433~453행(명단 블록)을 아래로 바꾼다:

```ts
  /** 명단. ⚠**여기서는 모으기만 한다** — 쓰기가 실제로 된 뒤에 `mergeRoster` 로 합친다(설계 D1-6) */
  const localRoster: (readonly [string, RosterEntry])[] = [];
  {
    const rosterFile = file.replace(/box\.html\.gz$/, "roster.html.gz");
    try {
      const body = pages.roster.body;
      if (body === null) throw new Error(`roster 가 없다: ${rosterFile}`);
      const html = body.toString("utf8");
      rosterFiles += 1;
      for (const e of parseGameRoster(html)) {
        localRoster.push([e.playerId, {
          date: meta.gameDate, throws: e.throws, bats: e.bats, uniformNumber: e.uniformNumber, position: e.position,
        }]);
      }
    } catch (err) {
      rosterFailed += 1;
      if (rosterFailed <= 3) {
        console.error(`ROSTER ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
```

- [ ] **Step 7: 실시 분기의 쓰기를 감싼다**

455~460행:

```ts
  played += 1;
  const quarantine: QuarantineRow[] = [];

  // ⚠경기 1건의 쓰기를 한 트랜잭션으로 묶는다. 개별 커밋은 느릴 뿐 아니라
  // 도중에 죽으면 **절반만 적재된 경기**를 남긴다.
  db.transaction(() => {
```
→
```ts
  const quarantine: QuarantineRow[] = [];

  // ⚠경기 1건의 쓰기를 한 트랜잭션으로 묶는다. 개별 커밋은 느릴 뿐 아니라
  // 도중에 죽으면 **절반만 적재된 경기**를 남긴다.
  // ⚠판정을 그 트랜잭션 **안에서 다시** 한다(`writeGameGuarded` · 설계 D1)
  const written = writeGameGuarded(db, meta.gameId, boxFetchedAt, () => {
```

619~623행:

```ts
  budget.quarantine += replaceQuarantine(db, meta.gameId, quarantine, nowIso);
  });

  for (const q of quarantine) quarantineKinds.set(q.kind, (quarantineKinds.get(q.kind) ?? 0) + 1);
}
```
→
```ts
  budget.quarantine += replaceQuarantine(db, meta.gameId, quarantine, nowIso);
  });
  if (written.outcome === "stale") {
    staleArchive.push({ gameId: meta.gameId, date: meta.gameDate });
    continue;
  }
  if (written.outcome === "invalid-db") {
    failed += 1;
    console.error(`DB 의 취득 시각이 무효다 ${meta.gameId} — 판을 비교할 수 없어 건너뛴다(fail-closed)`);
    continue;
  }
  played += 1;
  mergeRoster(localRoster);
  for (const q of quarantine) quarantineKinds.set(q.kind, (quarantineKinds.get(q.kind) ?? 0) + 1);
}
```

⚠`seenPlayers`·`noteSeasonName`·`upsertPlayer` 는 콜백 **안**에 있으므로 판정이 `stale` 이면 함께 안 불린다 — 따로 손대지 않는다.

- [ ] **Step 8: 요약과 종료 코드**

699~703행 `console.log(\`성립 ...\`)` 바로 다음에:

```ts
// ⚠**0 이어도 찍는다** — 「0건」과 「안 쟀음」을 가른다(설계 D1-8)
console.log(
  `옛 판 건너뜀 ${staleArchive.length}건 · 세트 불일치 ${setMismatch.length}건 · 본문 불일치 ${integrityMismatch.length}건`,
);
if (staleArchive.length > 0) {
  console.log(`⚠아카이브가 DB 보다 옛 판인 경기 ${staleArchive.length}건 — 적재하지 않았다(DB 를 지켰다)`);
  for (const s of staleArchive.slice(0, 50)) console.log(`   ${s.gameId}`);
}
for (const [label, list] of [["세트 표식이 갈린 경기", setMismatch], ["본문이 사이드카와 안 맞는 경기", integrityMismatch]] as const) {
  if (list.length === 0) continue;
  console.log(`⚠${label} ${list.length}건 — 적재하지 않았다`);
  for (const s of list.slice(0, 50)) console.log(`   ${s.gameId} — ${s.reason}`);
}
{
  const dates = [...new Set([...staleArchive, ...setMismatch, ...integrityMismatch].map((s) => s.date))].sort();
  if (dates.length > 0) {
    console.log(
      `   복구: 수동 실행 입력 refetch_dates=${dates.slice(0, 7).join(",")}` +
        (dates.length > 7 ? ` (7일씩 나눠서 · 전체 ${dates.length}일)` : "") +
        " — docs/operations/deploy.md §7-E",
    );
  }
}
```

747행:

```ts
process.exitCode = failed > 0 || lineScoreFailed > 0 || stoppedAt !== null ? 1 : 0;
```
→
```ts
process.exitCode =
  failed > 0 || lineScoreFailed > 0 || stoppedAt !== null ||
  staleArchive.length > 0 || setMismatch.length > 0 || integrityMismatch.length > 0
    ? 1
    : 0;
```

`gunzipSync`·`readFile` 가져오기가 아직 쓰이는지 확인한다(`walkSchedules` 루프가 둘 다 쓴다 — 남긴다).

- [ ] **Step 9: 통과를 확인한다**

Run: `node --test packages/store/test/load-archive-guard.test.ts`
Expected: `# tests 9` · `# pass 9` · `# skipped 0` · `# fail 0`.

Run(기존 적재 관련 시험 회귀): `node --test packages/store/test/game-upsert.test.ts packages/store/test/game-fetched-at.test.ts packages/store/test/upcoming-load.test.ts packages/store/test/starters-load.test.ts scripts/test/clock-injection.test.ts`
Expected: FAIL 0 · ERROR 0(분모를 적는다).

- [ ] **Step 10: 뮤테이션 두 개**

① 사전 판정 블록의 `if (pre === "stale") {…}` 를 지우고 시험 파일을 돌린다 → 「5 옛 inProgress」가 **FAIL**(분기 앞 판정이 없으면 `inProgress` 로 빠진다). 되돌린다.
② `mergeRoster(localRoster);` 를 명단 블록 끝(쓰기 전)으로 옮긴다 → 「5a」 가 **FAIL**. 되돌린다.
두 번 다 되돌린 뒤 9/9 를 다시 확인한다.

- [ ] **Step 11: 로컬 실DB 로 한 번 돌린다(읽기 전용 사본)**

실DB 를 바꾸지 않도록 사본으로 돌린다:

```bash
cp data/bb.sqlite "$CLAUDE_JOB_DIR/tmp/guard-check.sqlite"
node packages/store/tools/load-archive.ts data/archive "$CLAUDE_JOB_DIR/tmp/guard-check.sqlite" --max-writes 5000000 > "$CLAUDE_JOB_DIR/tmp/guard-check.log" 2>&1; echo "rc=$?"
grep -E "옛 판 건너뜀|성립 " "$CLAUDE_JOB_DIR/tmp/guard-check.log"
```
Expected: `옛 판 건너뜀 0건 · 세트 불일치 0건 · 본문 불일치 0건` · `성립 …건` 이 변경 전과 같은 수. ⚠rc 가 1 이면 원인 줄을 읽는다 — 기존에도 1 이었는지(`git stash` 가 아니라 **변경 전 커밋의 워크트리 사본**으로) 비교한다.

- [ ] **Step 12: 타입체크 · 커밋**

Run: `npm run typecheck` → 오류 0.

```bash
git add packages/store/tools/load-archive.ts packages/store/test/load-archive-guard.test.ts
git commit -m "fix(store): 옛 판·세트·본문 불일치 경기는 적재하지 않고 실패로 끝낸다 — 감사 C5"
```

---

### Task 4: 아카이버 받기·기록 분리 — `prepareUrl` · `commitPrepared` · `held`

**Files:**
- Modify: `packages/archiver/src/sink.ts:16-60`(`BlobMeta` 에 `set?`)
- Modify: `packages/archiver/src/archive.ts:8-16`(`PageOutcome`) · `136-195`(`BlobExtra` · `archiveUrl`) · `274-287`(`summarize`)
- Modify: `packages/archiver/src/cli.ts:77`·`127`(요약 문구)
- Create: `packages/archiver/test/game-set.test.ts`(이 태스크는 11a 만)

**Interfaces:**
- Produces:
  - `type PageOutcome = "stored" | "unchanged" | "absent" | "failed" | "held"`
  - `interface BlobExtra { readonly license?: string; readonly set?: string }`
  - `type Prepared = { key: string; url: string; prev: BlobMeta | null } & ({ kind: "changed"; status: number; body: Uint8Array; meta: BlobMeta } | { kind: "unchanged"; status: number } | { kind: "absent"; status: number } | { kind: "failed"; status: number | null; error: string })`
  - `prepareUrl(key: string, url: string, deps: ArchiveDeps): Promise<Prepared>` — 던지지 않는다
  - `commitPrepared(p: Prepared, deps: ArchiveDeps, extra?: BlobExtra): Promise<PageResult>` — 던지지 않는다
  - `heldResult(p: Prepared): PageResult`

- [ ] **Step 1: 실패하는 시험(11a)을 쓴다**

`packages/archiver/test/game-set.test.ts`:

```ts
/**
 * 경기 페이지 세트 기록(설계 D2 · 시험 8 · 9 · 9a · 10 · 11a · 12a · 12b · 12c).
 * ⚠가짜 fetcher 는 `get` 만 가진 객체다 — 재시도·지연 없이 호출 순서를 그대로 기록한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import type { FetchResponse, PoliteFetcher } from "../src/fetcher.ts";
import { archiveDate, archiveGame, archivePage } from "../src/archive.ts";

const REF = { season: 2026, date: "2026-08-14", slug: "s-db-17", path: "/scores/2026/0814/s-db-17/", venue: null };
const KEY = (leaf: string) => `npb/scores/2026/0814/s-db-17/${leaf}`;
const URL_OF = { index: "https://npb.jp/scores/2026/0814/s-db-17/", playbyplay: "https://npb.jp/scores/2026/0814/s-db-17/playbyplay.html", box: "https://npb.jp/scores/2026/0814/s-db-17/box.html", roster: "https://npb.jp/scores/2026/0814/s-db-17/roster.html" } as const;
const LEAF_OF_URL = new Map(Object.entries(URL_OF).map(([k, v]) => [v, k]));
const clock = { now: () => new Date("2026-09-25T00:00:00.000Z") };

const enc = (s: string) => new TextEncoder().encode(s);
const ok = (s: string): FetchResponse => ({ status: 200, body: enc(s), etag: null, lastModified: null });
const notFound: FetchResponse = { status: 404, body: null, etag: null, lastModified: null };

function stubFetcher(route: (leaf: string, url: string) => FetchResponse | Error) {
  const calls: string[] = [];
  const fetcher = {
    async get(url: string): Promise<FetchResponse> {
      calls.push(url);
      const r = route(LEAF_OF_URL.get(url) ?? "?", url);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as PoliteFetcher;
  return { fetcher, calls };
}

async function seed(sink: MemorySink, leaf: string, body: string, extra: Partial<BlobMeta> = {}): Promise<void> {
  await sink.write(KEY(leaf), enc(body), {
    url: `x/${leaf}`, fetchedAt: "2026-08-15T00:00:00.000Z", lastModified: null, etag: null, status: 200,
    sha256: sha256(enc(body)), byteLength: body.length, revision: 1, ...extra,
  });
}

async function seedAll(sink: MemorySink, extra: Partial<BlobMeta> = {}): Promise<void> {
  for (const leaf of ["index", "playbyplay", "box", "roster"]) await seed(sink, leaf, `${leaf}0`, extra);
}

class ThrowingMetaSink extends MemorySink {
  constructor(private readonly badLeaf: string) {
    super();
  }
  override async readMeta(key: string): Promise<BlobMeta | null> {
    if (key === KEY(this.badLeaf)) throw new SyntaxError("Unexpected token in JSON");
    return super.readMeta(key);
  }
}

for (const bad of ["index", "playbyplay", "roster"]) {
  test(`11a 깨진 사이드카(${bad})는 던지지 않고 그 페이지 failed — archivePage · archiveDate`, async () => {
    const sink = new ThrowingMetaSink(bad);
    const { fetcher } = stubFetcher((leaf) => ok(`${leaf}1`));
    const page = await archivePage(REF, bad === "index" ? "" : (`${bad}.html` as "playbyplay.html" | "roster.html"), { fetcher, sink, clock });
    assert.equal(page.outcome, "failed");
    assert.match(page.error ?? "", /사이드카를 못 읽었다/);

    const monthly = `<a href="/scores/2026/0814/s-db-17/">g</a>`;
    const day = await archiveDate("2026-08-14", {
      fetcher: stubFetcher((_leaf, url) => (url.includes("schedule") ? ok(monthly) : ok("x"))).fetcher,
      sink,
      clock,
    });
    assert.ok(!("error" in day), "날짜 단위 오류가 아니라 페이지 failed 여야 한다");
    assert.ok(day.pages.some((p) => p.outcome === "failed" && /사이드카를 못 읽었다/.test(p.error ?? "")));
  });
}
```

⚠`archiveDate` 의 월간 일정 URL 이 `schedule` 을 포함하는지 먼저 확인한다: `grep -n "export function monthlyScheduleUrl" -A3 packages/archiver/src/discover.ts`. 포함하지 않으면 위 `url.includes("schedule")` 조건을 그 함수가 만드는 모양으로 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/archiver/test/game-set.test.ts`
Expected: 3본 **FAIL** — 지금은 `readMeta` 가 `try` 밖이라 `archivePage` 가 **던진다**(`SyntaxError`).

- [ ] **Step 3: 타입과 `archiveUrl` 분리를 구현한다**

`packages/archiver/src/sink.ts` — `BlobMeta` 의 `license?: string;` 다음에:

```ts
  /**
   * **세트 표식**(설계 `2026-09-25-archive-load-version-guard-design.md` D2). 경기 페이지 4장을 **한 번에** 기록할 때 같은 값을 적는다.
   * ⚠없는 사이드카(기능 이전 기록 전부)는 깨진 것이 아니다 — 적재기가 「기존 기록」으로 통과시킨다.
   */
  set?: string;
```

`packages/archiver/src/archive.ts` 8행:

```ts
export type PageOutcome = "stored" | "unchanged" | "absent" | "failed";
```
→
```ts
/**
 * ⚠`held`(보류) — 받았고 바뀌었지만 같은 경기의 다른 페이지가 실패해서 **기록하지 않은** 페이지(설계 D2).
 * 실패가 아니다: 그 경기에 이미 `failed` 가 있으므로 CLI 종료 코드는 그걸로 1 이 된다.
 */
export type PageOutcome = "stored" | "unchanged" | "absent" | "failed" | "held";
```

`BlobExtra`(136~138행):

```ts
export interface BlobExtra {
  readonly license?: string;
  /** 경기 페이지 세트 id — `archiveGame` 만 넘긴다(설계 D2) */
  readonly set?: string;
}
```

`archiveUrl`(148~195행)을 아래 넷으로 바꾼다(141~147행의 두 주석 블록은 `prepareUrl` 위로 옮긴다):

```ts
export type Prepared = { key: string; url: string; prev: BlobMeta | null } & (
  | { kind: "changed"; status: number; body: Uint8Array; meta: BlobMeta }
  | { kind: "unchanged"; status: number }
  | { kind: "absent"; status: number }
  | { kind: "failed"; status: number | null; error: string }
);

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * URL 하나를 **받고 판정까지만** 한다. **기록하지 않는다 · 던지지 않는다.**
 * ⚠`readMeta` 예외도 `failed` 로 흡수한다(2026-09-25 · 설계 D2). 예전에는 `try` 밖이라 깨진 사이드카 하나가
 *   `archiveGame` → `archiveDate` 를 거쳐 **그날 전체를 날짜 단위 오류**로 만들었다. 단독 호출자에게도 같은 변화다(의도).
 */
export async function prepareUrl(key: string, url: string, deps: ArchiveDeps): Promise<Prepared> {
  let prev: BlobMeta | null;
  try {
    prev = await deps.sink.readMeta(key);
  } catch (err) {
    return { key, url, prev: null, kind: "failed", status: null, error: `사이드카를 못 읽었다: ${errorText(err)}` };
  }
  try {
    const res = await deps.fetcher.get(url, prev ?? undefined);
    if (res.status === 304) return { key, url, prev, kind: "unchanged", status: 304 };
    // 사실이다 — 이 경기에 이 페이지는 존재하지 않는다. 실패가 아니다.
    if (res.status === 404 || res.status === 410) return { key, url, prev, kind: "absent", status: res.status };
    if (res.body === null) return { key, url, prev, kind: "failed", status: res.status, error: `본문 없는 ${res.status} 응답` };
    const digest = sha256(res.body);
    // 서버가 조건부 요청을 지원하지 않아 200을 줬지만 내용은 같다 → 본문은 안 쓴다(멱등)
    if (prev && prev.sha256 === digest) return { key, url, prev, kind: "unchanged", status: res.status };
    const meta: BlobMeta = {
      url,
      fetchedAt: deps.clock.now().toISOString(),
      lastModified: res.lastModified,
      etag: res.etag,
      status: res.status,
      sha256: digest,
      byteLength: res.body.byteLength,
      revision: (prev?.revision ?? 0) + 1,
    };
    return { key, url, prev, kind: "changed", status: res.status, body: res.body, meta };
  } catch (err) {
    return { key, url, prev, kind: "failed", status: null, error: errorText(err) };
  }
}

/**
 * 판정 결과를 기록한다. ⚠**던지지 않는다** — `sink` 가 던지면 `failed` 로 돌려준다(예전 `archiveUrl` 과 같은 결과).
 * ⚠「받았는데 안 바뀌었다」도 「봤다」로 남긴다(`markSeen`) — 안 남기면 취득일이 실제보다 낡게 나가고 재취득이 오판한다.
 */
export async function commitPrepared(p: Prepared, deps: ArchiveDeps, extra?: BlobExtra): Promise<PageResult> {
  const base = { key: p.key, url: p.url };
  try {
    switch (p.kind) {
      case "changed":
        await deps.sink.write(p.key, p.body, { ...p.meta, ...(extra ?? {}) });
        return { ...base, outcome: "stored", status: p.status, error: null };
      case "unchanged":
        await markSeen(deps.sink, deps.clock, p.key, p.prev, extra);
        return { ...base, outcome: "unchanged", status: p.status, error: null };
      case "absent":
        return { ...base, outcome: "absent", status: p.status, error: null };
      case "failed":
        return { ...base, outcome: "failed", status: p.status, error: p.error };
    }
  } catch (err) {
    return { ...base, outcome: "failed", status: null, error: errorText(err) };
  }
}

/** 기록하지 않은 바뀐 페이지(설계 D2) */
export function heldResult(p: Prepared): PageResult {
  return { key: p.key, url: p.url, outcome: "held", status: p.status, error: null };
}

/**
 * URL 하나를 예의 있게 받아 보존한다.
 * ⚠**멱등·revision 규칙은 `prepareUrl`·`commitPrepared` 한 벌이다**(M5 · M1). 경기 페이지도 공표 성적표도 이 둘을 지난다.
 */
export async function archiveUrl(key: string, url: string, deps: ArchiveDeps, extra?: BlobExtra): Promise<PageResult> {
  return commitPrepared(await prepareUrl(key, url, deps), deps, extra);
}
```

`summarize`(274~287행)의 `acc` 초기값에 `held: 0,` 을 `failed: 0,` 다음에 더한다.

`packages/archiver/src/cli.ts` 77행과 127행의 `실패 ${s.failed})` / `실패 ${total.failed})` 를 각각 `실패 ${s.failed} / 보류 ${s.held})` / `실패 ${total.failed} / 보류 ${total.held})` 로 바꾼다.

- [ ] **Step 4: 통과·회귀를 확인한다**

Run: `node --test packages/archiver/test/game-set.test.ts`
Expected: 3/3 통과.

Run: `node --test packages/archiver/test/fetcher-archive.test.ts packages/archiver/test/mark-seen.test.ts packages/archiver/test/clock-sink.test.ts packages/archiver/test/draft-collect.test.ts packages/archiver/test/draft-wiki-collect.test.ts`
Expected: FAIL 0 · ERROR 0(시험 11 — 기존 호출자 동작 불변).

- [ ] **Step 5: 뮤테이션 · 타입체크 · 커밋**

`prepareUrl` 의 첫 `try … catch`(readMeta)를 지워 `const prev = await deps.sink.readMeta(key);` 로 되돌리고 돌린다 → 11a 3본 **FAIL**. 되돌린다.

Run: `npm run typecheck` → 오류 0.

```bash
git add packages/archiver/src/sink.ts packages/archiver/src/archive.ts packages/archiver/src/cli.ts packages/archiver/test/game-set.test.ts
git commit -m "refactor(archiver): archiveUrl 을 받기·기록 둘로 나눈다 — 깨진 사이드카는 날짜 전체가 아니라 그 페이지 실패"
```

---

### Task 5: 경기 세트 기록 — `archiveGame` · `gameSetId`

**Files:**
- Modify: `packages/archiver/src/archive.ts:202-209`(`archiveGame`)
- Modify: `packages/archiver/test/game-set.test.ts`(시험 8 · 9 · 9a · 10 · 12a · 12b · 12c 추가)

**Interfaces:**
- Consumes: Task 4 `prepareUrl`·`commitPrepared`·`heldResult`·`Prepared`
- Produces: `gameSetId(prepared: readonly Prepared[], clock: Clock): string` — `<ISO>-<sha256 앞 16자>`

- [ ] **Step 1: 실패하는 시험을 더한다**

`packages/archiver/test/game-set.test.ts` 끝에:

```ts
const outcomes = (rs: { outcome: string }[]) => rs.map((r) => r.outcome);

test("8 받기 단계에서 playbyplay 가 실패하면 바뀐 box 는 held · 아무 본문도 안 쓰고 set 도 안 바뀐다", async () => {
  const sink = new MemorySink();
  await seedAll(sink);
  const writes = sink.writeCount;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? new Error("ECONNRESET") : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.equal(sink.writeCount, writes, "새 본문 쓰기 0회");
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("box"))), "box0");
  assert.equal((await sink.readMeta(KEY("box")))?.revision, 1);
  for (const leaf of ["index", "roster"]) {
    const m = await sink.readMeta(KEY(leaf));
    assert.equal(m?.checkedAt, "2026-09-25T00:00:00.000Z", `${leaf} 는 봤다고 남긴다`);
    assert.equal(m?.set, undefined, `${leaf} 의 set 은 바뀌지 않는다`);
  }
});

test("9 전부 성공이면 네 사이드카의 set 이 모두 같다 · 바뀐 페이지만 revision 이 오른다", async () => {
  const sink = new MemorySink();
  await seedAll(sink);
  const { fetcher } = stubFetcher((leaf) => (leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "unchanged", "stored", "unchanged"]);
  const sets = await Promise.all(["index", "playbyplay", "box", "roster"].map(async (l) => (await sink.readMeta(KEY(l)))?.set));
  assert.ok(typeof sets[0] === "string" && sets[0].startsWith("2026-09-25T00:00:00.000Z-"));
  assert.equal(new Set(sets).size, 1);
  assert.equal((await sink.readMeta(KEY("box")))?.revision, 2);
  assert.equal((await sink.readMeta(KEY("index")))?.revision, 1);
});

test("9a 세트 id: 같은 시각이라도 내용이 다르면 다르고 · 같으면 같다", async () => {
  const run = async (box: string) => {
    const sink = new MemorySink();
    await seedAll(sink);
    await archiveGame(REF, { fetcher: stubFetcher((leaf) => (leaf === "box" ? ok(box) : ok(`${leaf}0`))).fetcher, sink, clock });
    return (await sink.readMeta(KEY("box")))?.set;
  };
  const a = await run("boxA");
  const b = await run("boxB");
  const a2 = await run("boxA");
  assert.notEqual(a, b);
  assert.equal(a, a2);
});

test("10 요청 수·순서는 지금과 같다 — index · playbyplay · box · roster 한 번씩", async () => {
  const sink = new MemorySink();
  const { fetcher, calls } = stubFetcher((leaf) => ok(`${leaf}0`));
  await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(calls, [URL_OF.index, URL_OF.playbyplay, URL_OF.box, URL_OF.roster]);
});

class FailingWriteSink extends MemorySink {
  /** ⚠사전 적재(`seedAll`)가 끝난 뒤에 켠다 — 안 그러면 준비 단계에서 먼저 죽는다 */
  armed = false;
  constructor(private readonly badLeaf: string, private readonly halfWrite: boolean) {
    super();
  }
  override async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    if (this.armed && key === KEY(this.badLeaf)) {
      // halfWrite: 본문 rename 은 됐고 사이드카 rename 에서 죽은 모양(12b)
      if (this.halfWrite) this.bodies.set(key, body);
      throw new Error("디스크 오류");
    }
    return super.write(key, body, meta);
  }
}

test("12a 기록 단계에서 playbyplay 쓰기가 실패하면 거기서 멈춘다 · 앞 index 만 새 set · 뒤는 held/무기록", async () => {
  const sink = new FailingWriteSink("playbyplay", false);
  await seedAll(sink);
  sink.armed = true;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? ok("playbyplay1") : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.ok((await sink.readMeta(KEY("index")))?.set, "index 는 새 set 을 받았다");
  const roster = await sink.readMeta(KEY("roster"));
  assert.equal(roster?.checkedAt, undefined, "멈춘 뒤의 roster 는 markSeen 도 안 한다");
  assert.equal(roster?.set, undefined);
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("box"))), "box0");
});

test("12b 본문만 바뀌고 사이드카에서 죽으면 failed · 본문과 사이드카 sha 가 어긋난 채 남는다(적재기가 본문 불일치로 잡는다)", async () => {
  const sink = new FailingWriteSink("playbyplay", true);
  await seedAll(sink);
  sink.armed = true;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? ok("playbyplay1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.equal(rs[1]!.outcome, "failed");
  const body = sink.bodies.get(KEY("playbyplay"))!;
  assert.notEqual(sha256(body), (await sink.readMeta(KEY("playbyplay")))?.sha256);
});

test("12c 있던 playbyplay 가 404 면 실패 · 본문·사이드카 보존 · 바뀐 box 는 held", async () => {
  const sink = new MemorySink();
  await seedAll(sink);
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? notFound : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.match(rs[1]!.error ?? "", /있던 페이지가 사라졌다/);
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("playbyplay"))), "playbyplay0");
});

test("12c 처음부터 없던 roster 의 404 는 absent 이고 세트가 기록된다", async () => {
  const sink = new MemorySink();
  for (const leaf of ["index", "playbyplay", "box"]) await seed(sink, leaf, `${leaf}0`);
  const { fetcher } = stubFetcher((leaf) => (leaf === "roster" ? notFound : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "unchanged", "stored", "absent"]);
  assert.equal(await sink.readMeta(KEY("roster")), null);
  assert.ok((await sink.readMeta(KEY("box")))?.set);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/archiver/test/game-set.test.ts`
Expected: 8 · 9 · 9a · 12a · 12c(두 본) **FAIL**(지금 `archiveGame` 은 받자마자 기록하고 `set` 이 없다). 10 은 통과할 수 있다(순서는 원래 같다). 12b 는 통과할 수 있다.

- [ ] **Step 3: 구현한다**

`packages/archiver/src/archive.ts` 의 `archiveGame`(202~209행)을 바꾼다:

```ts
/**
 * 세트 id — `<기록 시각>-<페이지 키와 새 sha 의 digest 앞 16자>`(설계 D2-4).
 * ⚠**내용이 다르면 같은 밀리초라도 다르다** — 수동 백필과 CI 가 같은 경기를 겹쳐 받는 경우(`sink.ts` 임시 파일 주석이 그 겹침을 인정한다).
 * ⚠무작위를 쓰지 않는다 — 시각·난수는 주입해 결정론화한다(루트 §6).
 */
export function gameSetId(prepared: readonly Prepared[], clock: Clock): string {
  const lines = prepared.map((p) => {
    const sha = p.kind === "changed" ? p.meta.sha256 : p.kind === "unchanged" ? (p.prev?.sha256 ?? "-") : "-";
    return `${p.key}\t${sha}`;
  });
  return `${clock.now().toISOString()}-${sha256(new TextEncoder().encode(lines.join("\n"))).slice(0, 16)}`;
}

/**
 * 경기 1건의 전 하위 페이지를 **한 세트로** 보존한다(M5 · 2026-09-25 감사 C6 · 설계 D2).
 *
 * ⚠예전에는 페이지마다 받자마자 기록했다 — `playbyplay` 만 실패하고 `box` 가 바뀌면 **box 새 판 · 타석 로그 옛 판**이 섞였다.
 * → ① 4장을 **모두** 받는다(요청 수·순서는 그대로 · L1) ② 하나라도 실패하면 바뀐 페이지는 `held`(기록 안 함)
 *   ③ 실패가 없으면 같은 `set` 을 적으며 기록한다 ④ 기록 도중 실패하면 **거기서 멈춘다** — 앞 페이지는 되돌리지 않고
 *   적재기가 세트 불일치로 잡는다(`packages/store/src/page-integrity.ts`).
 * ⚠**있던 페이지의 404 는 실패다** — 옛 사이드카가 옛 `set` 을 든 채 남으면 세트가 영원히 어긋난다. 본문은 지우지 않는다.
 */
export async function archiveGame(ref: GameRef, deps: ArchiveDeps): Promise<PageResult[]> {
  const prepared: Prepared[] = [];
  for (const page of GAME_PAGES) {
    const p = await prepareUrl(pageKey(ref, page), pageUrl(ref, page), deps);
    prepared.push(
      p.kind === "absent" && p.prev !== null
        ? { key: p.key, url: p.url, prev: p.prev, kind: "failed", status: p.status, error: "있던 페이지가 사라졌다" }
        : p,
    );
  }

  if (prepared.some((p) => p.kind === "failed")) {
    const out: PageResult[] = [];
    for (const p of prepared) {
      // ⚠`set` 을 넘기지 않는다 — 안 바뀐 페이지의 「봤다」만 남기고 기존 `set` 은 그대로 둔다
      out.push(p.kind === "changed" ? heldResult(p) : await commitPrepared(p, deps));
    }
    return out;
  }

  const set = gameSetId(prepared, deps.clock);
  const out: PageResult[] = [];
  let stopped = false;
  for (const p of prepared) {
    if (stopped) {
      out.push(p.kind === "changed" ? heldResult(p) : { key: p.key, url: p.url, outcome: p.kind === "absent" ? "absent" : "unchanged", status: p.status, error: null });
      continue;
    }
    const r = await commitPrepared(p, deps, { set });
    out.push(r);
    if (r.outcome === "failed") stopped = true;
  }
  return out;
}
```

`archivePage`(198~200행)는 그대로 둔다(`archiveUrl` 을 부른다). `Clock` 가져오기는 이미 있다(1행).

- [ ] **Step 4: 통과·회귀**

Run: `node --test packages/archiver/test/game-set.test.ts`
Expected: `# tests 11` · `# pass 11` · `# fail 0`.

Run: `node --test packages/archiver/test/fetcher-archive.test.ts packages/archiver/test/mark-seen.test.ts packages/archiver/test/discover.test.ts`
Expected: FAIL 0 · ERROR 0.

- [ ] **Step 5: 뮤테이션**

① `if (prepared.some((p) => p.kind === "failed")) {…}` 블록을 지운다 → 8 **FAIL**. ② `archiveGame` 의 404 변환(`p.kind === "absent" && p.prev !== null ? … : p`)을 `p` 로 바꾼다 → 12c(있던 페이지) **FAIL**. ③ `if (r.outcome === "failed") stopped = true;` 를 지운다 → 12a **FAIL**. 셋 다 되돌리고 11/11 을 다시 확인한다.

- [ ] **Step 6: 타입체크 · 커밋**

Run: `npm run typecheck` → 오류 0.

```bash
git add packages/archiver/src/archive.ts packages/archiver/test/game-set.test.ts
git commit -m "fix(archiver): 경기 페이지 4장을 다 받았을 때만 한 세트로 기록한다 — 감사 C6"
```

---

### Task 6: 재수집 입력 — `refetch_dates`

**Files:**
- Modify: `scripts/date-window.ts`(끝에 함수 추가)
- Modify: `scripts/test/date-window.test.ts`(끝에 시험 추가)
- Modify: `scripts/update.ts:143-156`
- Modify: `.github/workflows/daily.yml:94`(`workflow_dispatch`) · 「수집·적재」 단계 `env`
- Create: `scripts/test/refetch-wiring.test.ts`

**Interfaces:**
- Produces:
  - `const MAX_REFETCH_DATES = 7`
  - `parseRefetchDates(raw: string | undefined): { ok: true; dates: string[] | null } | { ok: false; error: string }` — 비어 있으면 `dates: null`(= 평소 창)

- [ ] **Step 1: 실패하는 시험을 쓴다**

`scripts/test/date-window.test.ts` 끝에(가져오기 줄에 `parseRefetchDates` 를 더한다):

```ts
test("13 재수집 날짜: 비면 평소 창 · 정상 3일은 그 3일", () => {
  assert.deepEqual(parseRefetchDates(undefined), { ok: true, dates: null });
  assert.deepEqual(parseRefetchDates("  "), { ok: true, dates: null });
  assert.deepEqual(parseRefetchDates("2026-08-01, 2026-08-02,2026-08-03"), { ok: true, dates: ["2026-08-01", "2026-08-02", "2026-08-03"] });
});

test("13 재수집 날짜: 8개 · 없는 날짜 · 셸 문자 · 중복 · 자릿수 틀림은 거부", () => {
  const eight = Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1}`).join(",");
  for (const bad of [eight, "2026-02-30", "2026-08-01;rm -rf /", "2026-08-01,2026-08-01", "2026-8-1", "2026-08-01,"]) {
    const r = parseRefetchDates(bad);
    assert.equal(r.ok, false, bad);
  }
});
```

`scripts/test/refetch-wiring.test.ts`:

```ts
/**
 * 재수집 입력의 배선(설계 D4 · 시험 14).
 * ⚠`run:` 안에 `${{ inputs.refetch_dates }}` 를 직접 쓰면 입력이 셸 코드로 끼어든다(스크립트 인젝션). **환경변수로만** 넘긴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const YML = readFileSync(fileURLToPath(new URL("../../.github/workflows/daily.yml", import.meta.url)), "utf8");

test("14 수동 실행에 refetch_dates 입력이 있다", () => {
  assert.match(YML, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+refetch_dates:/);
});

test("⚠14 입력은 수집 단계의 env 로만 쓰인다 — run: 에 직접 나오지 않는다", () => {
  const uses = [...YML.matchAll(/inputs\.refetch_dates/g)].length;
  assert.equal(uses, 1, "정확히 한 곳(env)에서만 읽어야 한다");
  assert.match(YML, /\n\s+BB_REFETCH_DATES: \$\{\{ inputs\.refetch_dates \}\}\n/);
  const step = YML.slice(YML.indexOf("- name: 수집·적재"), YML.indexOf("- name: 드래프트 적재"));
  assert.ok(step.includes("BB_REFETCH_DATES:"), "수집·적재 단계의 env 에 있어야 한다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test scripts/test/date-window.test.ts scripts/test/refetch-wiring.test.ts`
Expected: `date-window.test.ts` 는 가져오기 실패로 **ERROR** · `refetch-wiring` 2본 **FAIL**.

- [ ] **Step 3: 검증 함수를 구현한다**

`scripts/date-window.ts` 끝에:

```ts
/**
 * 재수집 날짜의 상한. **L1 근거**다 — 하루 최대 6경기 × 4장 × 7일 = 168요청 ≈ 3초 간격 8.4분.
 */
export const MAX_REFETCH_DATES = 7;

/**
 * `BB_REFETCH_DATES`(수동 실행 입력 `refetch_dates`)를 검증한다(설계 D4).
 * ⚠**틀리면 아무것도 받지 않는다** — 반쯤 맞는 입력을 고쳐 읽지 않는다.
 * ⚠셸로 넘어온 값이라 형식을 **정규식으로 먼저** 막는다(`;`·공백 명령 등).
 */
export function parseRefetchDates(raw: string | undefined): { ok: true; dates: string[] | null } | { ok: false; error: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, dates: null };
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length > MAX_REFETCH_DATES) {
    return { ok: false, error: `재수집 날짜는 ${MAX_REFETCH_DATES}개까지다(${parts.length}개) — L1` };
  }
  const seen = new Set<string>();
  for (const p of parts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p)) return { ok: false, error: `YYYY-MM-DD 가 아니다: ${JSON.stringify(p)}` };
    const [y, m, d] = p.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
      return { ok: false, error: `없는 날짜다: ${p}` };
    }
    if (seen.has(p)) return { ok: false, error: `같은 날짜가 두 번 있다: ${p}` };
    seen.add(p);
  }
  return { ok: true, dates: parts };
}
```

- [ ] **Step 4: `update.ts` 배선**

가져오기(23행)를:

```ts
import { JST_TODAY_FROM_HOUR, parseRefetchDates, targetDates } from "./date-window.ts";
```

143~156행(`const since = …` 부터 첫 `console.log(…)` 끝까지)을:

```ts
/**
 * ⚠**재수집 입력**(수동 실행 `refetch_dates` → `BB_REFETCH_DATES` · 설계 D4). 옛 판·세트·본문 불일치로 적재가
 * 실패했을 때 **그 날짜만** 다시 받는다. 틀리면 아무것도 받지 않고 멈춘다(종료 2).
 */
const refetch = parseRefetchDates(process.env["BB_REFETCH_DATES"]);
if (!refetch.ok) {
  console.error(`BB_REFETCH_DATES 가 틀렸다 — ${refetch.error}. 아무것도 받지 않는다`);
  process.exit(2);
}
if (refetch.dates !== null && values.date !== undefined) {
  console.error("--date 와 BB_REFETCH_DATES 를 같이 줄 수 없다 — 하나만 줘라");
  process.exit(2);
}

const since = values.date === undefined && refetch.dates === null ? collectedThrough() : undefined;
const dates = refetch.dates ?? targetDates(new Date(), {
  ...(values.date === undefined ? {} : { date: values.date }),
  ...(values.today === true ? { forceToday: true } : {}),
  ...(since === undefined ? {} : { collectedThrough: since }),
});
console.log(
  `대상 경기일 ${dates.join(" · ")}` +
    (refetch.dates !== null
      ? " (재수집 · BB_REFETCH_DATES)"
      : values.date !== undefined
        ? ""
        : dates.length > 1
          ? " (어제와 오늘 JST · 끝나지 않은 경기는 저장하지 않는다)"
          : ` (어제 JST · 오늘 것은 ${JST_TODAY_FROM_HOUR}시 이후 실행에서 받는다)`),
);
```

⚠`new Date()` 는 이 진입점에서 원래 쓰던 것이다(`clock-injection.test.ts` 의 진입점 예외 목록) — 새로 늘리지 않는다.

- [ ] **Step 5: 워크플로 배선**

`.github/workflows/daily.yml` 94행:

```yaml
  workflow_dispatch:
```
→
```yaml
  workflow_dispatch:
    inputs:
      refetch_dates:
        # ⚠적재가 「옛 판 · 세트 불일치 · 본문 불일치」로 실패했을 때만 쓴다(docs/operations/deploy.md §7-E).
        #   비워 두면 평소 수집과 같다. 값은 **환경변수로만** 넘긴다 — `run:` 에 직접 쓰면 셸 코드로 끼어든다.
        description: "다시 받을 경기일 YYYY-MM-DD (쉼표 구분 · 최대 7개). 평소에는 비워 둔다"
        required: false
        default: ""
        type: string
```

「수집·적재」 단계의 `env:` 를:

```yaml
        env:
          BB_ARCHIVER_CONTACT: ${{ secrets.BB_ARCHIVER_CONTACT }}
          BB_REFETCH_DATES: ${{ inputs.refetch_dates }}
```

- [ ] **Step 6: 통과·회귀**

Run: `node --test scripts/test/date-window.test.ts scripts/test/refetch-wiring.test.ts scripts/test/workflow-permissions.test.ts scripts/test/workflow-runnable.test.ts scripts/test/clock-injection.test.ts scripts/test/retry-slot.test.ts`
Expected: FAIL 0 · ERROR 0(분모를 적는다).

- [ ] **Step 7: 뮤테이션 · 커밋**

`parseRefetchDates` 의 정규식 검사 줄을 지운다 → 「셸 문자」·「자릿수 틀림」 사례가 **FAIL**. 되돌린다.

Run: `npm run typecheck` → 오류 0.

```bash
git add scripts/date-window.ts scripts/test/date-window.test.ts scripts/update.ts .github/workflows/daily.yml scripts/test/refetch-wiring.test.ts
git commit -m "feat(ops): 수동 실행 refetch_dates — 옛 판으로 막힌 날짜만 다시 받는다"
```

---

### Task 7: 런북 · 전체 검증

**Files:**
- Modify: `docs/operations/deploy.md`(§7-D 끝 · §7-A 앞에 §7-E)

- [ ] **Step 1: 런북 절을 쓴다**

`docs/operations/deploy.md` 의 `## 7-A.` 제목 바로 앞에:

```markdown
## 7-E. ⚠적재가 「옛 판 · 세트 불일치 · 본문 불일치」로 실패했을 때 (2026-09-25)

**무엇이 일어났나**: 적재기가 경기를 **쓰지 않고** 건너뛰었다 — DB 는 지켰고, 그날 잡은 실패로 끝나 배포가 막힌다(의도).
설계: `docs/superpowers/specs/2026-09-25-archive-load-version-guard-design.md`.

| 로그 | 뜻 | 흔한 원인 |
|---|---|---|
| `⚠아카이브가 DB 보다 옛 판인 경기 N건` | 아카이브의 box 를 마지막으로 확인한 시각이 DB 의 것보다 이르다 | 「보관소에 올림」이 오늘 세대를 지운 뒤 실패해 다음 실행이 **어제 세대**를 복원했다 · 백필 덧붙임(`archive-*.tar`)이 이번 시즌의 옛 페이지를 덮었다 |
| `⚠세트 표식이 갈린 경기` | 한 경기의 페이지들이 서로 다른 수집에서 왔다 | 아카이버가 기록 도중 죽었다 |
| `⚠본문이 사이드카와 안 맞는 경기` | 본문 sha256 ≠ 사이드카 | 한 파일의 본문과 사이드카 쓰기 사이에서 죽었다 · 누가 파일을 손으로 바꿨다 |

**처치 — 그 날짜만 다시 받는다**
1. 실패한 실행의 「수집·적재」 로그에서 `복구: 수동 실행 입력 refetch_dates=…` 줄을 찾는다.
2. Actions → `daily` → **Run workflow** → `refetch_dates` 에 그 값을 그대로 넣는다(최대 7일 · 넘으면 로그가 나눠서 준다).
3. 그 실행의 요약 줄이 `옛 판 건너뜀 0건 · 세트 불일치 0건 · 본문 불일치 0건` 이면 끝이다.
⚠수동 실행도 npb.jp 를 친다 — **하루에 여러 번 누르지 마라**(L1 · §6).

**다시 받아도 안 풀리면**
- 같은 실행에 `있던 페이지가 사라졌다` 실패가 같이 찍히면 **상류가 그 페이지를 지웠다.** 기존 본문은 보존돼 있다 — 사람이 판단한다(보관소의 이전 세대 `store-*.tar` 를 확인할 것).
- `BB_REFETCH_DATES 가 틀렸다` 로 멈췄으면 입력 형식을 고친다(`YYYY-MM-DD` · 쉼표 · 실재 날짜 · 중복 없음).
```

- [ ] **Step 2: 전체 검증**

Run: `npm run typecheck` → 오류 0.
Run: `npm test > "$CLAUDE_JOB_DIR/tmp/c5c6-npmtest.txt" 2>&1; echo "RC=$?"` 후 `tail -12 "$CLAUDE_JOB_DIR/tmp/c5c6-npmtest.txt"`
Expected: `# fail 0` · `# cancelled 0` · rc=0. 분모(`# tests`)를 기준선 2,801 과 비교해 **새 시험 수만큼 늘었는지** 적는다(Task 1: 8 · Task 2: 21 · Task 3: 9 · Task 4·5: 11 · Task 6: date-window 2 + wiring 2 = 53본 증가 예상). `# skipped` 가 기준선(1)보다 늘었으면 어느 파일인지 적는다 — 특히 `load-archive-guard` 가 건너뛰어졌으면 **안 쟀다.**

- [ ] **Step 3: 커밋**

```bash
git add docs/operations/deploy.md
git commit -m "docs(ops): 런북 §7-E — 옛 판·세트·본문 불일치로 적재가 실패했을 때"
```

- [ ] **Step 4: 배포 전 게이트(이 계획 밖 · 사용자 승인 필요)**

`shiro-core:triple-review` 로 범위 `audit-2026-09-25..HEAD` 를 3중 검토한다(루트 §4 — 동시성·멱등성·데이터 계약). 반영 뒤 push·PR 은 **사용자 승인 뒤**(`gh auth switch --user muji-j` 먼저). 배포 보고에 「첫 실행이 빨개질 수 있다 — CI 아카이브의 기존 상태는 안 쟀다」를 미리 적는다(설계 §6).
