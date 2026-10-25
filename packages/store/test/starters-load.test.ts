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

// ---- PR-4 T4 · 予告先発 연도(설계 `2026-10-24-offseason-readiness-design.md` D3) --------------------------------------

/** 한 경기 · **양쪽 선발이 발표된** 予告先発 페이지 — 맥박만인 날에 `player`·`probable_pitcher` 를 안 쓰는지 재려고 */
const ANNOUNCED_DAY = (md: string): string => GAME_DAY(md)
  .replace(
    `<img src="/img/common/logo/2026/logo_s_m.gif" alt="東京ヤクルトスワローズ" title="東京ヤクルトスワローズ" />`,
    `<img src="/img/common/logo/2026/logo_s_m.gif" alt="東京ヤクルトスワローズ" title="東京ヤクルトスワローズ" /><a href="/bis/players/91000001.html">山田　一郎</a>`,
  )
  .replace(
    `<img src="/img/common/logo/2026/logo_db_m.gif" alt="横浜DeNAベイスターズ" title="横浜DeNAベイスターズ" />`,
    `<img src="/img/common/logo/2026/logo_db_m.gif" alt="横浜DeNAベイスターズ" title="横浜DeNAベイスターズ" /><a href="/bis/players/91000002.html">佐藤　二郎</a>`,
  );

const tableCount = (db: ReturnType<typeof openDb>, table: "probable_pitcher" | "player" | "starters_fetch"): number =>
  (db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as unknown as { n: number }).n;
const probableDates = (db: ReturnType<typeof openDb>): string[] =>
  (db.raw.prepare("SELECT DISTINCT game_date d FROM probable_pitcher ORDER BY d").all() as unknown as { d: string }[]).map((r) => r.d);

/** 파일 하나를 적재하고 결과를 본다 */
async function loadOne(
  fetched: string,
  html: string,
  fn: (r: { code: number; out: string; err: string; fetch: FetchRow[]; probables: string[]; players: number }) => void,
): Promise<void> {
  await withStarters({ [fetched]: { html } }, ({ run, db }) => {
    const r = run();
    const d = db();
    try {
      fn({ ...r, fetch: fetchRows(d), probables: probableDates(d), players: tableCount(d, "player") });
    } finally {
      d.close();
    }
  });
}

test("⚠⚠PR-4 T4 1월에 받은 「11月1日」 경기 → 2026-11-01 의 맥박만 · 예고·선수 0행(옛 규칙은 2027-11-01 을 만들어 시즌 내내 starters-behind 를 껐다)", async () => {
  await loadOne("2027-01-05", ANNOUNCED_DAY("11月1日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.fetch.map((x) => [x.fetched_date, x.game_date, x.no_games]), [["2027-01-05", "2026-11-01", 0]], "맥박의 게시 날짜가 지난 해가 아니다");
    assert.deepEqual(r.probables, [], "지난 날짜 게시로 예고 행을 만들었다(2027-11-01 이면 시즌 내내 「다음 경기가 예고됐다」가 된다)");
    assert.equal(r.players, 0, "맥박만인데 선수 행을 만들었다");
    assert.match(r.out, /지난 날짜 게시 1건\(맥박만\)/);
  });
});

test("⚠PR-4 T4 1월에 받은 「11月2日」 휴식 공표 → 2026-11-02 · no_games 1 의 맥박", async () => {
  await loadOne("2027-01-05", REST_DAY("11月2日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.fetch.map((x) => [x.fetched_date, x.game_date, x.no_games]), [["2027-01-05", "2026-11-02", 1]]);
    assert.deepEqual(r.probables, []);
  });
});

test("⚠⚠PR-4 T4 1월 1일에 받은 「12月31日」 경기 → 맥박만 · 종료 0(옛 규칙은 「연도를 정할 수 없다」로 1)", async () => {
  await loadOne("2027-01-01", ANNOUNCED_DAY("12月31日"), (r) => {
    assert.equal(r.code, 0, `해 넘김 직후의 낡은 페이지로 막았다:\n${r.err}`);
    assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2026-12-31", 0]]);
    assert.deepEqual(r.probables, []);
    assert.equal(r.players, 0);
  });
});

test("⚠PR-4 T4 12월 31일에 받은 「1月1日」 → 2027-01-01 정상 적재(+1일)", async () => {
  await loadOne("2026-12-31", ANNOUNCED_DAY("1月1日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2027-01-01", 0]]);
    assert.deepEqual(r.probables, ["2027-01-01"]);
    assert.equal(r.players, 2);
  });
});

test("⚠PR-4 T4 0일·+1일(시즌 중 실측 68회 전부)은 지금과 같다 — 예고·선수까지 적재", async () => {
  for (const [fetched, md, want] of [["2026-08-16", "8月16日", "2026-08-16"], ["2026-08-15", "8月16日", "2026-08-16"]] as const) {
    await loadOne(fetched, ANNOUNCED_DAY(md), (r) => {
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [[want, 0]], fetched);
      assert.deepEqual(r.probables, [want], fetched);
      assert.equal(r.players, 2, fetched);
      assert.doesNotMatch(r.out, /지난 날짜 게시/, fetched);
    });
  }
});

/** ⚠실패한 파일은 **어느 표도 안 바꾼다**(설계 D3-2) — 맥박도 남기지 않는다(「받았다」와 「읽었다」를 섞지 않는다) */
const assertUntouched = (r: { code: number; err: string; fetch: FetchRow[]; probables: string[]; players: number }, why: RegExp): void => {
  assert.equal(r.code, 1, "정할 수 없는 연도를 실패로 세지 않았다(M7)");
  assert.match(r.err, why);
  assert.deepEqual(r.fetch, [], "실패한 파일이 맥박을 남겼다");
  assert.deepEqual(r.probables, [], "실패한 파일이 예고 행을 남겼다");
  assert.equal(r.players, 0, "실패한 파일이 선수 행을 남겼다");
};

test("⚠⚠PR-4 T4 2026-12-31 에 받은 「2月29日」 → 후보 해 0(2025·2026·2027 어느 해에도 없다) → 1 · 세 표 불변(자동 정규화 금지)", async () => {
  await loadOne("2026-12-31", ANNOUNCED_DAY("2月29日"), (r) => assertUntouched(r, /후보 해가 없다/));
});

/**
 * ⚠⚠**앞쪽(미래)은 14일까지만 받는다**(PR-4 3중 검토 1차 P3 · 설계 D3 고침). 예전 규칙(±183 대칭)은 2027-08-30 의 「2月29日」을
 * 2028-02-29(+183)의 **예고**로 적재했다 — 지금은 창 [−351, +14] 안에 2/29 가 없어 실패다(세 표 불변 · 3판에서도 그대로).
 */
test("⚠⚠PR-4 T4 「2月29日」 — 2027-08-30(+183)·2027-08-29(+184)는 창 [−351, +14] 안에 2/29 가 없어 1 · 세 표 불변", async () => {
  await loadOne("2027-08-30", ANNOUNCED_DAY("2月29日"), (r) => assertUntouched(r, /\+183일/));
  await loadOne("2027-08-29", ANNOUNCED_DAY("2月29日"), (r) => assertUntouched(r, /\+184일/));
});

/**
 * ⚠⚠**낡은 페이지가 「미래 예고」로 들어가지 않는다**(1차 P3 실측) — 예전 규칙은 2027-06-15 에 받은 「10月30日」(지난 일본시리즈)을
 * 2027-10-30(+137)의 예고로 적재해 `MAX(probable_pitcher.game_date)` 를 미래로 만들었다 → 그 시즌 내내 `starters-behind` 가 꺼진다(설계 G4 의 피해).
 * ⚠⚠**3판(2026-10-25 · 조정자 결정): 지난 해는 351일까지 맥박만이다** — 3중 검토 반영 첫 판(183일 밖이면 실패)은 개막이 늦은 해에
 * 낡은 비시즌 페이지가 184일째부터 **매 실행 적재 1(blocking · 배포 정지)**을 냈다. 지금은 −228 도 맥박만이다.
 */
test("⚠⚠PR-4 T4 낡은 「10月30日」 — 2027-06-15 는 2026-10-30 맥박만(−228 · 앞쪽 +137 은 안 감) · 2027-05-01 도 맥박만(−183)", async () => {
  for (const [fetched, why] of [["2027-06-15", "−228 을 맥박으로 받지 않았다(또는 미래 예고로 받았다)"], ["2027-05-01", "앞쪽 +182 를 미래 예고로 받았다"]] as const) {
    await loadOne(fetched, ANNOUNCED_DAY("10月30日"), (r) => {
      assert.equal(r.code, 0, `${fetched}: ${r.err}`);
      assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2026-10-30", 0]], `${fetched}: ${why}`);
      assert.deepEqual(r.probables, [], fetched);
      assert.equal(r.players, 0, fetched);
      assert.match(r.out, /지난 날짜 게시 1건\(맥박만\)/, fetched);
    });
  }
});

/**
 * ⚠⚠**2020형(늦은 개막 · 6/19) — 오프시즌이 길어도 낡은 페이지는 맥박만이고 적재를 막지 않는다**(3판 · 조정자 결정).
 * 2019 일본시리즈는 10/23 에 끝났다. 그 페이지가 지난 날짜 + 184 · 300 · 351 일째까지 멈춰 있어도 **매 파일이 맥박만 · 종료 0** 이다
 * (3중 검토 반영 첫 판은 184일째부터 받은 파일마다 1 이었다 — 적재는 아카이브 전체를 매번 다시 읽으므로 매 실행 blocking 이었다).
 * 개막 전날(6/18)의 「6月19日」은 +1 이라 그대로 예고다.
 */
test("⚠⚠PR-4 T4 2020형(늦은 개막) — 「10月23日」 이 184·231·300·351 일 낡아도 맥박만 · 종료 0 · 2020-06-18 「6月19日」 은 정상 예고(+1)", async () => {
  const stale = ["2020-04-24", "2020-06-10", "2020-08-18", "2020-10-08"];
  await withStarters(Object.fromEntries(stale.map((d) => [d, { html: ANNOUNCED_DAY("10月23日") }])), ({ run, db }) => {
    const r = run();
    assert.equal(r.code, 0, `낡은 비시즌 페이지가 적재를 막았다(매 실행 blocking):\n${r.err}`);
    assert.match(r.out, /지난 날짜 게시 4건\(맥박만\)/);
    const d = db();
    try {
      assert.deepEqual(fetchRows(d).map((x) => [x.fetched_date, x.game_date]), stale.map((f) => [f, "2019-10-23"]), "낡은 페이지를 지난 해(2019-10-23)의 맥박으로 안 받았다");
      assert.deepEqual(probableDates(d), [], "낡은 페이지로 예고 행을 만들었다");
      assert.equal(tableCount(d, "player"), 0);
    } finally {
      d.close();
    }
  });
  await loadOne("2020-06-18", ANNOUNCED_DAY("6月19日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.probables, ["2020-06-19"]);
    assert.equal(r.players, 2);
  });
});

/**
 * ⚠⚠**이중 걸림은 지난 해(맥박만)다**(PR-4 재검토 m1) — 창 [−351, +14] 은 366일이라 양 끝이 같은 `MM-DD` 이면 그 날짜가 두 번 걸린다
 * (2027-06-15 에 받은 「6月29日」: 2026-06-29(−351) · 2027-06-29(+14)). 앞쪽(예고)을 고르면 틀렸을 때 `MAX(probable_pitcher.game_date)` 가
 * 14일 앞으로 가 `starters-behind` 가 그만큼 꺼진다(설계 G4) — 지난 해를 고르면 틀려도 예고가 비어 감시가 운다(시끄러운 쪽).
 */
test("⚠⚠PR-4 T4 이중 걸림 — 2027-06-15 「6月29日」 → 2026-06-29 맥박만(−351) · 예고·선수 0행", async () => {
  await loadOne("2027-06-15", ANNOUNCED_DAY("6月29日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2026-06-29", 0]], "이중 걸림에서 지난 해를 안 골랐다");
    assert.deepEqual(r.probables, [], "이중 걸림을 예고(+14)로 적재했다");
    assert.equal(r.players, 0);
  });
});

test("⚠⚠PR-4 T4 「2月29日」 경계 — 2028-08-31 → −184 맥박만 · 2029-02-14 → −351 맥박만 · 2029-02-15 → −352(창 밖) → 1", async () => {
  for (const fetched of ["2028-08-31", "2029-02-14"]) {
    await loadOne(fetched, ANNOUNCED_DAY("2月29日"), (r) => {
      assert.equal(r.code, 0, `${fetched}: ${r.err}`);
      assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2028-02-29", 0]], `${fetched}: 지난 2/29 를 맥박으로 받지 않았다`);
      assert.deepEqual(r.probables, [], fetched);
    });
  }
  await loadOne("2029-02-15", ANNOUNCED_DAY("2月29日"), (r) => assertUntouched(r, /-352일/));
});

test("⚠⚠PR-4 T4 2027-08-31 에 받은 「3月1日」 → 앞쪽 2028-03-01(+183)은 안 받고 지난 2027-03-01(−183) 맥박만", async () => {
  await loadOne("2027-08-31", ANNOUNCED_DAY("3月1日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.fetch.map((x) => [x.game_date, x.no_games]), [["2027-03-01", 0]], "앞쪽 +183(2028-03-01)을 골랐다");
    assert.deepEqual(r.probables, []);
  });
});

test("⚠PR-4 T4 2028-02-28 에 받은 「2月29日」 → 2028-02-29(+1) 정상", async () => {
  await loadOne("2028-02-28", ANNOUNCED_DAY("2月29日"), (r) => {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.probables, ["2028-02-29"]);
    assert.equal(r.players, 2);
  });
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
