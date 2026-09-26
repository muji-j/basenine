/**
 * 선수 페이지 적재기(`load-players.ts`)를 **실물 선수 페이지**로 잰다 — 감사 C7(취득 시각) · C8(통산 표 소실).
 *
 * ⚠**합성 페이지를 쓰지 않는다** — 파서가 실물 마크업(탭 `#pc_stats_nav` · 구획 `stats_*` · 중첩 投球回 표)에
 *   기대므로 만든 문자열은 실물과 갈리고, 그러면 「아무것도 안 재는 초록」이 된다(`packages/parser/test/fixtures/README.md`).
 *   로컬·CI 의 `data/archive` 에서 선수 페이지를 **임시 폴더로 복사**해 쓴다.
 * ⚠사이드카(`*.meta.json`)는 실물을 읽어 **시각만 바꿔** 쓴다 — 적재기가 읽는 것은 `fetchedAtOf` 한 벌이다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertPlayer } from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLAYERS = join(ROOT, "data", "archive", "npb", "players");
const TOOL = fileURLToPath(new URL("../tools/load-players.ts", import.meta.url));
/** 투수 — 打撃成績·投手成績 **두 표가 다 있다**(탭 `nav_p`·`nav_b`) */
const PITCHER = "01005134";
/** 야수 — 打撃成績 **하나뿐이다.** 투수 표는 **원래 없다**(탭도 구획도 없다) */
const BATTER = "01005113";
const NOW = "2026-09-26T00:00:00.000Z";

const HAS = [PITCHER, BATTER].every((id) => existsSync(join(PLAYERS, `${id}.html.gz`)) && existsSync(join(PLAYERS, `${id}.meta.json`)));
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${PLAYERS} 에 픽스처 선수 페이지(${PITCHER} · ${BATTER})가 없다`);
}
const skip = HAS ? false : "data/archive 의 픽스처 선수 페이지 없음";

interface Env { dir: string; archive: string; dbPath: string }

/**
 * @param sidecars 선수 ID → 사이드카에 쓸 시각. `null` 이면 **사이드카를 두지 않는다**(「모른다」의 재현).
 *   ⚠실물 사이드카를 읽어 `fetchedAt`·`checkedAt` 만 갈아 끼운다 — 나머지(sha256·revision)는 적재기가 안 본다.
 */
async function setup(sidecars: Record<string, { fetchedAt: string; checkedAt?: string } | null>): Promise<Env> {
  const dir = await mkdtemp(join(tmpdir(), "bb-players-"));
  const archive = join(dir, "archive");
  const players = join(archive, "npb", "players");
  await mkdir(players, { recursive: true });
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath, NOW);
  try {
    for (const [id, times] of Object.entries(sidecars)) {
      await copyFile(join(PLAYERS, `${id}.html.gz`), join(players, `${id}.html.gz`));
      if (times !== null) {
        const meta = JSON.parse(await readFile(join(PLAYERS, `${id}.meta.json`), "utf8")) as Record<string, unknown>;
        meta["fetchedAt"] = times.fetchedAt;
        if (times.checkedAt === undefined) delete meta["checkedAt"];
        else meta["checkedAt"] = times.checkedAt;
        await writeFile(join(players, `${id}.meta.json`), JSON.stringify(meta));
      }
      // ⚠적재기는 `UPDATE player` 만 한다 — 선수 행이 먼저 있어야 프로필이 들어간다(경기 적재가 만드는 행)
      upsertPlayer(db, id, `시험${id}`, NOW);
    }
  } finally {
    db.close();
  }
  return { dir, archive, dbPath };
}

function load(env: Env): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
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

async function cleanup(env: Env): Promise<void> {
  await rm(env.dir, { recursive: true, force: true });
}

// ─── C7 · profile_fetched_at 은 「언제 받았나」다 — 「언제 적재했나」가 아니다(M4) ───────────────

/** 서로 다른 두 시각. **적재를 도는 지금과도 다르다**(과거) — 적재 시각이 들어가면 반드시 갈린다 */
const T_PITCHER = "2026-07-01T01:02:03.000Z";
/** ⚠`checkedAt` 이 있으면 그것이 「마지막으로 본 시각」이다(`seenAtOf`) — 통산 행과 **같은 규칙 한 벌**이어야 한다 */
const T_BATTER_FETCHED = "2026-07-10T00:00:00.000Z";
const T_BATTER_CHECKED = "2026-07-15T10:20:30.000Z";

test("C7 · profile_fetched_at 은 적재 시각이 아니라 **각자의 사이드카 시각**이다 — 통산 행과 같은 값", { skip }, async () => {
  const env = await setup({
    [PITCHER]: { fetchedAt: T_PITCHER },
    [BATTER]: { fetchedAt: T_BATTER_FETCHED, checkedAt: T_BATTER_CHECKED },
  });
  try {
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    for (const [id, want] of [[PITCHER, T_PITCHER], [BATTER, T_BATTER_CHECKED]] as const) {
      const got = q<{ p: string | null }>(env, "SELECT profile_fetched_at AS p FROM player WHERE player_id = ?", id).p;
      assert.equal(got, want, `${id} 의 profile_fetched_at 이 사이드카 시각이 아니다 — 적재 실행 시각이 들어갔나`);
      // ⚠같은 페이지·같은 사이드카에서 온 통산 행과 **같은 값**이어야 한다 — 한 함수 안에서 두 방식이 갈리던 것이 결함이었다
      const cb = q<{ lo: string | null; hi: string | null; n: number }>(
        env,
        "SELECT MIN(fetched_at) AS lo, MAX(fetched_at) AS hi, COUNT(*) AS n FROM career_batting WHERE player_id = ?",
        id,
      );
      assert.ok(cb.n > 0, `${id} 의 통산 타격 행이 0 이다 — 이 시험이 비교할 상대가 없다`);
      assert.equal(cb.lo, want);
      assert.equal(cb.hi, want);
    }
  } finally {
    await cleanup(env);
  }
});

/** 사이드카가 없던 판의 값. 적재 시각(지금)과 다르고, 사이드카 시각과도 다르다 */
const KEPT = "2026-06-01T00:00:00.000Z";

test("C7 · 사이드카를 못 읽으면 기존 profile_fetched_at 을 「지금」으로 덮지 않는다(M11) · 결손은 센다", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    exec(env, "UPDATE player SET profile_fetched_at = ? WHERE player_id = ?", KEPT, PITCHER);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const got = q<{ p: string | null }>(env, "SELECT profile_fetched_at AS p FROM player WHERE player_id = ?", PITCHER).p;
    assert.equal(got, KEPT, "모르는 취득 시각을 적재 시각으로 메웠다 — 재취득 선정이 그 선수를 「가장 신선함」으로 읽는다");
    // ⚠「모른다」는 조용히 넘기지 않는다 — 요약에 결손 수가 찍혀야 한다
    assert.match(r.err, /취득시각 결손 1명/);
  } finally {
    await cleanup(env);
  }
});
