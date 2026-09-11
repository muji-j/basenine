/**
 * 감시 스크립트가 **증거 → 판정 한 벌에 실제로 이어져 있는가** — 프로세스로 띄워서 잰다.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D10 · D11)
 * ⚠판정 규칙 자체는 `packages/domain/test/collection-verdict.test.ts`·`packages/store/test/collection-evidence.test.ts` 가 잰다.
 * 여기는 **연결**만 본다 — 종료 코드 · 새 표가 없는 DB · JSONL 의 새 필드. 오늘 날짜에 기대지 않는 입력만 쓴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ensurePlayer, openDb, upsertBatting, upsertGame, upsertProbablePitcher } from "@bb-app/store";
import type { Db } from "@bb-app/store";

const SCRIPT = fileURLToPath(new URL("../freshness.ts", import.meta.url));

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-fresh-wired-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠수집 판정 증거 표가 없는 DB 면 조용히 틀리지 않고 exit 2", () => withDir(async (dir) => {
  const path = join(dir, "old.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec("CREATE TABLE game (game_id TEXT, game_date TEXT, status TEXT)");
  raw.close();
  const r = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.equal(r.status, 2, `새 표 없는 DB 를 판정했다: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /마이그레이션 021/);
}));

test("빈 DB — no-games · period unknown · exit 1 · JSONL 에 새 필드가 있다", () => withDir(async (dir) => {
  const path = join(dir, "empty.sqlite");
  openDb(path, "2026-09-11T00:00:00.000Z").close();
  const log = join(dir, "log.jsonl");
  const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--json", log], { encoding: "utf8" });
  assert.equal(r.status, 1, `빈 DB 를 정상으로 봤다: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /판정 근거: 모름/);
  const rec = JSON.parse((await readFile(log, "utf8")).trim()) as Record<string, unknown>;
  assert.deepEqual(rec.staleReasons, ["no-games"]);
  assert.equal(rec.stale, true);
  assert.equal(rec.period, "unknown");
  assert.equal(rec.missedPlayed, 0);
  assert.equal(rec.missedAnnounced, 0);
  assert.equal(rec.missedEarliest, null);
}));

/**
 * ⚠⚠**통산 요약은 「최근 출장자」 범위다 — 옛 감시와 같다**(2026-09-11 · 3중 검토 1차 F4 · 2차 N2).
 * 재배선하면서 `careerOldest`·`careerNewest`·`careerUnknown` 을 **범위 없는 별도 쿼리**로 떼어 냈고, 콘솔은 여전히
 * 「통산 기록(최근 출장자)」라고 적었다 — **JSONL 필드의 뜻이 조용히 바뀌었다.** 「취득일을 모르는 선수 N명」 경고도 빠졌다.
 * 전원을 세면 NPB 를 떠나 페이지를 받을 수 없는 선수가 영원히 「모름」으로 남는다(옛 감시 주석의 사유).
 */
test("⚠⚠통산 요약은 최근 출장자만 센다 — 떠난 선수의 「모름」을 섞지 않고, 최근 출장자의 「모름」은 경고한다", () => withDir(async (dir) => {
  const path = join(dir, "career.sqlite");
  const db: Db = openDb(path, "2026-09-11T00:00:00.000Z");
  let n = 0;
  const play = (playerId: string, date: string): void => {
    n += 1;
    upsertGame(db, {
      gameId: `g${n}`, season: Number(date.slice(0, 4)), gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular", sourceUrl: "https://npb.jp/x",
      fetchedAt: "2026-09-11T00:00:00.000Z", awayRuns: 1, homeRuns: 2,
    });
    ensurePlayer(db, playerId, playerId, "2026-09-11T00:00:00.000Z");
    upsertBatting(db, {
      gameId: `g${n}`, playerId, side: "home", battingOrder: "1", position: "(遊)",
      pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    });
  };
  const career = (playerId: string, fetchedAt: string | null): void => {
    db.raw.prepare(
      `INSERT INTO career_batting (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
         sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
       VALUES (?, 2026, '阪 神', 1, 4, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'npb', ?, 0)`,
    ).run(playerId, fetchedAt);
  };
  try {
    play("RECENT", "2026-09-09");
    career("RECENT", "2026-09-10T01:00:00.000Z");
    play("GONE", "2024-06-01"); // 최신 경기보다 400일 넘게 전 — 범위 밖
    career("GONE", null);
    play("GONE2", "2024-06-02");
    career("GONE2", "2024-06-03T01:00:00.000Z");
  } finally {
    // ⚠준비가 실패해도 닫는다 — 열린 채 지우면 Windows 가 EBUSY 로 원래 오류를 가린다
    db.close();
  }
  const log = join(dir, "log.jsonl");
  spawnSync(process.execPath, [SCRIPT, path, "2", "--json", log], { encoding: "utf8" });
  const rec = JSON.parse((await readFile(log, "utf8")).trim()) as Record<string, unknown>;
  assert.equal(rec.careerPlayers, 1);
  assert.equal(rec.careerUnknown, 0, "범위 밖(떠난 선수)의 「모름」을 셌다");
  assert.equal(rec.careerOldest, "2026-09-10", "범위 밖 선수의 취득일을 가장 오래된 날로 셌다");
  assert.equal(rec.careerNewest, "2026-09-10");

  // 최근 출장자의 「모름」은 경고한다
  const db2: Db = openDb(path, "2026-09-11T00:00:00.000Z");
  db2.raw.prepare("UPDATE career_batting SET fetched_at = NULL WHERE player_id = 'RECENT'").run();
  db2.close();
  const log2 = join(dir, "log2.jsonl");
  const r2 = spawnSync(process.execPath, [SCRIPT, path, "2", "--json", log2], { encoding: "utf8" });
  const rec2 = JSON.parse((await readFile(log2, "utf8")).trim()) as Record<string, unknown>;
  assert.equal(rec2.careerUnknown, 1);
  assert.match(r2.stderr, /취득일을 모르는 선수 1명/, "최근 출장자의 취득일 모름을 경고하지 않았다");
}));

/**
 * ⚠**원인을 가르는 출력**(설계 D1 ⑵⑷ · D3 · 2026-09-11 · 3중 검토 2차 N2). B 는 「발견 경로 고장」과 「사이드카 결손」이 **같은 모양으로 운다** —
 * 그 달 사본의 마지막 취득 시각(모르면 「취득 시각 모름」)을 적지 않으면 운영자는 사이드카가 아니라 수집 경로를 뒤집는다.
 * ⚠**시험이 시계를 읽지 않는다**(M6 · `clock-injection.test.ts` 가 시험 파일도 센다) — 스크립트가 찍는 「오늘(JST)」을 먼저 읽는다.
 */
test("⚠B 가 울리면 그 달 사본의 취득 시각을 적는다 — 모르면 「취득 시각 모름」 · 予告先発 시각 모름 행도 센다", () => withDir(async (dir) => {
  const probe = join(dir, "probe.sqlite");
  openDb(probe, "2026-09-11T00:00:00.000Z").close();
  const today = /오늘\(JST\) (\d{4}-\d{2}-\d{2})/.exec(spawnSync(process.execPath, [SCRIPT, probe, "2"], { encoding: "utf8" }).stdout)?.[1];
  assert.ok(today !== undefined, "스크립트가 오늘(JST)을 안 찍는다 — 이 시험이 공회전한다");
  const shift = (d: string, days: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const d = shift(today, -5);

  const path = join(dir, "b.sqlite");
  const db: Db = openDb(path, "2026-09-11T00:00:00.000Z");
  try {
    upsertProbablePitcher(db, {
      gameDate: d, teamCode: "g", opponentCode: "db", playerId: null, sourceName: null, venue: null, startTime: "18:00",
      league: "cl", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt: `${shift(d, -1)}T04:00:00.000Z`,
    });
    db.raw.prepare(
      "INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games) VALUES (?, ?, 'x', NULL, 30, 90)",
    ).run(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
    db.raw.prepare(
      "INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at) VALUES (?, ?, 0, 'x', NULL)",
    ).run(shift(d, -1), d);
  } finally {
    db.close();
  }
  const r = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.match(r.stderr, /예고됐는데 받지 못했다/, `B 가 안 울렸다 — 전제가 틀렸다: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, new RegExp(`${d.slice(0, 7)} 사본 취득 시각 모름`), "B 에 걸린 달의 사본 취득 시각(모름)을 안 적었다");
  assert.match(`${r.stdout}${r.stderr}`, /予告先発 취득 시각 모름 1장/, "予告先発 취득 시각 모름 행 수를 안 적었다");
}));

test("⚠--json 뒤에 경로가 없으면 종료 코드 2 가 남는다(예전엔 마지막 줄이 1/0 으로 덮었다)", () => withDir(async (dir) => {
  const path = join(dir, "empty.sqlite");
  openDb(path, "2026-09-11T00:00:00.000Z").close();
  const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 2, "인자 오류를 사유 판정으로 덮었다");
}));
