/**
 * 予告先発 적재 — **받은 날마다 맥박을 남긴다**(설계 D3).
 *
 * ⚠**옛 맥박은 경기가 없으면 멈췄다.** 신선도의 「予告先発 수집이 멈췄다」(`starters-lag`)는 `probable_pitcher` 의
 * `MAX(fetched_at)` 을 보는데, 「試合が予定されていません」 페이지는 **행을 안 남기므로** 3일 넘는 휴식(해마다 10월 CS 전후)과
 * 오프시즌 내내 「멈췄다」가 됐다 — 페이지는 매일 받고 있었는데도.
 * → 파서가 성공한 파일마다 `starters_fetch` 에 한 행을 남긴다. **휴식 공표 페이지 포함.**
 *
 * ⚠**도구를 프로세스로 띄워서 잰다**(`upcoming-load.test.ts` 와 같은 이유 — SQL 을 복사하면 시험이 아니라 사본이다).
 * 페이지 모양은 파서 시험(`packages/parser/test/starter.test.ts`)의 실물 발췌에서 한 경기만 잘랐다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/index.ts";

const TOOL = fileURLToPath(new URL("../tools/load-starters.ts", import.meta.url));
const NOW = "2026-08-17T00:00:00.000Z";
const STARTERS_URL = "https://npb.jp/announcement/starter/";

/** 한 경기(선발 미정)짜리 予告先発 페이지 */
const GAME_DAY = (md: string): string => `<h3><span>予告先発投手</span></h3>
<div class="contents"><div class="wrap">
<h4>${md}の予告先発投手</h4>
<div class="unit_starter_position"><div class="starting_pit_wrapper_top">
<section class="starting_wrap_cl">
  <div class="unit cl_1">
    <div class="team_left">
    <img src="/img/common/logo/2026/logo_s_m.gif" alt="東京ヤクルトスワローズ" title="東京ヤクルトスワローズ" />
      </div>
    <div class="team_right">
    <img src="/img/common/logo/2026/logo_db_m.gif" alt="横浜DeNAベイスターズ" title="横浜DeNAベイスターズ" />
      </div>
  <div class="info">
        （神　宮）18:00          </div>
</div>
</section>
</div></div></div></div>`;

/** 경기가 없는 날 — NPB 가 날짜를 붙여 「試合が予定されていません」이라고 적는다(실측 2026-08-17 월요일) */
const REST_DAY = (md: string): string => `<h3><span>予告先発投手</span></h3>
<div class="contents">
<div class="wrap">
<h4>${md}の予告先発投手</h4>
試合が予定されていません。
</div>
</div>`;

interface FileSpec { html: string; checkedAt?: string | null }

async function withStarters(
  files: Record<string, FileSpec>,
  fn: (ctx: { run: () => { code: number; out: string; err: string }; db: () => ReturnType<typeof openDb> }) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-starters-"));
  const starters = join(dir, "archive", "npb", "starters");
  await mkdir(starters, { recursive: true });
  for (const [date, f] of Object.entries(files)) {
    await writeFile(join(starters, `${date}.html.gz`), gzipSync(f.html));
    if (f.checkedAt !== null) {
      await writeFile(join(starters, `${date}.meta.json`), JSON.stringify({ checkedAt: f.checkedAt ?? `${date}T05:00:00.000Z` }));
    }
  }
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  try {
    fn({
      run: () => {
        const r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath], { encoding: "utf8" });
        return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
      },
      db: () => openDb(dbPath, NOW),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type FetchRow = { fetched_date: string; game_date: string | null; no_games: number; source_url: string; fetched_at: string | null };
const fetchRows = (db: ReturnType<typeof openDb>): FetchRow[] =>
  (db.raw.prepare("SELECT fetched_date, game_date, no_games, source_url, fetched_at FROM starters_fetch ORDER BY fetched_date").all() as unknown as FetchRow[])
    .map((r) => ({ ...r }));

test("⚠휴식 공표 페이지도 맥박을 남긴다 — 경기가 없어도 「받았다」는 사실은 있다", async () => {
  await withStarters({ "2026-08-16": { html: REST_DAY("8月17日"), checkedAt: "2026-08-16T05:00:00.000Z" } }, ({ run, db }) => {
    const r = run();
    assert.equal(r.code, 0, `휴식일을 실패로 봤다: ${r.err}`);
    const d = db();
    try {
      assert.deepEqual(fetchRows(d), [{
        fetched_date: "2026-08-16", game_date: "2026-08-17", no_games: 1, source_url: STARTERS_URL, fetched_at: "2026-08-16T05:00:00.000Z",
      }], "휴식 공표 페이지가 맥박을 남기지 않았다 — 경기가 없으면 「予告先発 수집이 멈췄다」가 된다");
      assert.equal((d.raw.prepare("SELECT COUNT(*) n FROM probable_pitcher").get() as unknown as { n: number }).n, 0);
    } finally {
      d.close();
    }
  });
});

test("예고가 있는 날은 no_games 0 으로 남기고 예고도 적재한다", async () => {
  await withStarters({ "2026-08-15": { html: GAME_DAY("8月16日") } }, ({ run, db }) => {
    const r = run();
    assert.equal(r.code, 0, `적재가 실패했다: ${r.err}`);
    const d = db();
    try {
      assert.deepEqual(fetchRows(d).map((x) => [x.fetched_date, x.game_date, x.no_games]), [["2026-08-15", "2026-08-16", 0]]);
      assert.equal((d.raw.prepare("SELECT COUNT(*) n FROM probable_pitcher WHERE game_date = '2026-08-16'").get() as unknown as { n: number }).n, 2);
    } finally {
      d.close();
    }
  });
});

test("⚠사이드카가 없으면 행은 남기되 취득 시각은 NULL 이다 — 적재 시각으로 메우지 않는다(M11)", async () => {
  await withStarters({ "2026-08-16": { html: REST_DAY("8月17日"), checkedAt: null } }, ({ run, db }) => {
    assert.equal(run().code, 0);
    const d = db();
    try {
      const rows = fetchRows(d);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.fetched_at, null, "모르는 취득 시각을 무엇으로 메웠다");
    } finally {
      d.close();
    }
  });
});

test("⚠파서가 실패한 파일은 맥박을 남기지 않는다 — 다른 파일은 적재하고 종료 코드는 1", async () => {
  const drifted = REST_DAY("8月17日").replace("試合が予定されていません。", "");
  await withStarters(
    { "2026-08-15": { html: GAME_DAY("8月16日") }, "2026-08-16": { html: drifted } },
    ({ run, db }) => {
      const r = run();
      assert.equal(r.code, 1, "못 읽은 파일이 있는데 성공으로 끝냈다");
      const d = db();
      try {
        assert.deepEqual(fetchRows(d).map((x) => x.fetched_date), ["2026-08-15"], "못 읽은 날에 「받았다」를 남겼거나 읽은 날을 빠뜨렸다");
      } finally {
        d.close();
      }
    },
  );
});

test("⚠두 번 적재해도 같다(M5)", async () => {
  await withStarters(
    { "2026-08-15": { html: GAME_DAY("8月16日") }, "2026-08-16": { html: REST_DAY("8月17日") } },
    ({ run, db }) => {
      assert.equal(run().code, 0);
      const d1 = db();
      const once = JSON.stringify(fetchRows(d1));
      d1.close();
      assert.equal(run().code, 0);
      const d2 = db();
      try {
        assert.equal(JSON.stringify(fetchRows(d2)), once);
      } finally {
        d2.close();
      }
    },
  );
});
