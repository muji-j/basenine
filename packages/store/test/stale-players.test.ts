/**
 * **다시 받아야 할 선수**를 고르는 SQL.
 *
 * ⚠**이 SQL 하나가 통산 기록의 신선도를 지키는 유일한 장치다.** 그런데 처음 넣었을 때
 * 시험이 0본이었고, 이중 검토가 **그 상태에서 결함 셋을 찾아냈다**(2026-08-17):
 * · UTC 절단과 JST 경기일을 비교하고 있었다 — 크론 시각의 우연으로만 맞았다
 * · 「취득 시각을 모르는 선수」 분기가 **죽어 있었다**(적재가 `?? nowIso` 로 메워서)
 * · 「받을 수 없는 선수」(이탈자)가 매일 몫의 앞자리를 먹고 있었다
 * 셋 다 「읽으면 맞아 보이는」 종류라, 시험이 없으면 다음에도 못 잡는다.
 *
 * ⚠**도구를 프로세스로 띄워서 잰다.** SQL 을 시험 안에 복사하면 도구가 바뀌어도 시험은 초록이다 —
 * 그건 시험이 아니라 사본이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "../src/index.ts";
import type { Db } from "../src/index.ts";

const NOW = "2026-08-20T00:00:00.000Z";
const TOOL = fileURLToPath(new URL("../tools/emit-stale-player-ids.ts", import.meta.url));

let seq = 0;
function play(db: Db, playerId: string, date: string): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId, side: "home", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: "PIT", side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

/** `career_batting` 에 취득 시각만 있는 한 줄을 넣는다. `fetchedAt === null` 이면 「모른다」 */
function career(db: Db, playerId: string, fetchedAt: string | null): void {
  db.raw
    .prepare(
      `INSERT INTO career_batting
         (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
          sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
       VALUES (?, 2026, '阪 神', 1, 4, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'npb', ?, 0)`,
    )
    .run(playerId, fetchedAt);
}

async function withDb(fn: (dbPath: string, db: Db) => void): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "bb-stale-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath, NOW);
  try {
    fn(dbPath, db);
  } finally {
    db.close();
  }
  const r = spawnSync(process.execPath, [TOOL, dbPath, "--limit", "400"], { encoding: "utf8" });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, `도구가 실패했다: ${r.stderr}`);
  return r.stdout.split("\n").map((x) => x.trim()).filter((x) => x !== "");
}

test("⚠취득 시각을 모르는 선수는 반드시 대상이다 — 「모른다」를 「최신」으로 읽지 않는다(M11)", async () => {
  const ids = await withDb((_p, db) => {
    upsertPlayer(db, "UNKNOWN", "取得不明", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "UNKNOWN", "2026-08-16");
    career(db, "UNKNOWN", null);
  });
  assert.ok(ids.includes("UNKNOWN"), "취득 시각을 모르는 선수를 빠뜨렸다");
});

test("페이지를 출장 이후에 받았으면 대상이 아니다 — 헛되이 다시 치지 않는다(L1)", async () => {
  const ids = await withDb((_p, db) => {
    upsertPlayer(db, "FRESH", "最新", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "FRESH", "2026-08-16");
    // JST 8/17 08:00 에 받았다 — 8/16 경기가 들어 있다
    career(db, "FRESH", "2026-08-16T23:00:00.000Z");
  });
  assert.ok(!ids.includes("FRESH"), "이미 최신인 선수를 다시 받으려 한다");
});

/**
 * ⚠**타임존이 이 판정을 뒤집는다.**
 * `2026-08-16T20:00:00Z` 는 **JST 8/17 05:00** 이다. UTC 로 자르면 `08-16` 이 되어
 * 「경기 당일에 받았다 → 다시 받아야 한다」로 잘못 읽는다. JST 로 자르면 `08-17` 이라 대상이 아니다.
 * ⚠**이 시험이 없으면 UTC/JST 혼용이 조용히 산다** — 지금 크론(02:00 JST)에서는 우연히 맞기 때문이다.
 */
test("⚠날짜는 JST 로 센다 — UTC 로 자르면 하루 어긋나 헛되이 다시 친다(§2-1)", async () => {
  const ids = await withDb((_p, db) => {
    upsertPlayer(db, "TZ", "時差", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "TZ", "2026-08-16");
    career(db, "TZ", "2026-08-16T20:00:00.000Z"); // JST 2026-08-17 05:00
  });
  assert.ok(!ids.includes("TZ"), "UTC 로 잘라서 하루 이르게 봤다");
});

/**
 * ⚠**경기 당일 낮에 받은 페이지에는 그날 경기가 없다.**
 * 실측(2026-08-17): 취득 시각 기준 **전날까지**가 예외 없이 들어 있었다(698/698).
 * 그러므로 「받은 날 == 마지막 출장일」이면 **아직 그 경기가 안 들어온 것**이라 다시 받아야 한다.
 */
test("⚠받은 날과 마지막 출장일이 같으면 대상이다 — 그 페이지엔 그날 경기가 없다", async () => {
  const ids = await withDb((_p, db) => {
    upsertPlayer(db, "SAMEDAY", "当日", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "SAMEDAY", "2026-08-16");
    career(db, "SAMEDAY", "2026-08-16T03:00:00.000Z"); // JST 8/16 12:00 — 그날 경기 전
  });
  assert.ok(ids.includes("SAMEDAY"), "경기 당일 낮에 받은 페이지를 최신으로 봤다");
});

/**
 * ⚠**받을 수 없는 선수가 매일 몫을 먹으면 진짜 대상이 굶는다.**
 * 실측: 취득 기록이 없는 113명은 전원 **마지막 출장이 2023년**인 NPB 이탈 선수였다.
 * 선수 페이지는 현재 등록 선수만 받을 수 있어 이들은 받아도 안 온다 —
 * 소급 시즌을 넣을수록 이 무리가 시즌당 100명 넘게 늘어 상한을 통째로 잠식한다.
 */
test("⚠오래 안 뛴 선수는 제외한다 — 그건 백필의 일이지 신선도 유지의 일이 아니다", async () => {
  const ids = await withDb((_p, db) => {
    upsertPlayer(db, "GONE", "離脱", NOW);
    upsertPlayer(db, "ACTIVE", "現役", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "GONE", "2023-05-01");
    play(db, "ACTIVE", "2026-08-16");
    career(db, "ACTIVE", null);
    // GONE 은 통산 행 자체가 없다 — 옛 코드라면 「취득기록 없음」으로 맨 앞에 뽑혔다
  });
  assert.ok(!ids.includes("GONE"), "3년 전에 떠난 선수를 매일 다시 받으려 한다");
  assert.ok(ids.includes("ACTIVE"), "현역 선수를 빠뜨렸다");
});
