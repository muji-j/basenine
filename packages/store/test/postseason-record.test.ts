/**
 * 포스트시즌 화면(PR-3)이 저장소에서 꺼내 쓰는 **한 벌**의 함수들 — 日本シリーズ 성적 · 예고 철회 3값 · 휴식 공표 · 다음 경기일.
 *
 * 설계: `docs/superpowers/specs/2026-10-24-postseason-display-design.md` D4 · D5
 * ⚠**감시와 화면이 같이 쓴다**(M1) — 여기 정의가 바뀌면 감시(`collectionEvidence`)와 화면이 함께 바뀐다.
 * ⚠행으로 재현한다 — 마이그레이션을 적용한 임시 DB 에 넣고 잰다. 외부 요청 0 · 시계 0(M6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  japanSeriesDecided,
  nextGameDayOf,
  nipponSeriesRecord,
  openDb,
  probableWithdrawal,
  restDeclarations,
  upsertGame,
} from "../src/index.ts";
import type { Db } from "../src/index.ts";

const NOW = "2026-11-02T00:00:00.000Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-post-record-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let gid = 0;
function js(db: Db, date: string, home: string, away: string, homeRuns: number | null, awayRuns: number | null, status: "played" | "notPlayed" = "played"): void {
  gid += 1;
  upsertGame(db, {
    gameId: `js${gid}`, season: Number(date.slice(0, 4)), gameDate: date, awayCode: away, homeCode: home, gameNo: gid,
    status, notPlayedReason: status === "played" ? null : "中止", competition: "nipponSeries", series: "SMBC日本シリーズ",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    homeRuns: status === "played" ? homeRuns : null, awayRuns: status === "played" ? awayRuns : null,
  });
}

/* ── D4 日本シリーズ 성적 ─────────────────────────────────────────────── */

test("⚠日本シリーズ 성적 — 무승부는 양쪽 分 · 중지는 어디에도 안 든다 · 득점 NULL 은 모름으로만 센다", () => withDb((db) => {
  js(db, "2026-10-24", "db", "h", 2, 2);            // 무승부
  js(db, "2026-10-25", "db", "h", 5, 1);            // db 승
  js(db, "2026-10-27", "h", "db", null, null, "notPlayed"); // 중지 — 성적에도 모름에도 안 든다
  js(db, "2026-10-28", "h", "db", 9, 8);            // h 승
  js(db, "2026-10-29", "h", "db", null, null);      // 치렀는데 득점 모름
  const r = nipponSeriesRecord(db, 2026);
  assert.deepEqual(Object.fromEntries(r.byTeam), { db: { w: 1, l: 1, t: 1 }, h: { w: 1, l: 1, t: 1 } });
  assert.equal(r.unknownGames, 1, "중지를 모름으로 셌거나 득점 NULL 을 안 셌다");
}));

test("⚠through 는 그날을 포함한다 — 「그 경기까지」의 성적", () => withDb((db) => {
  js(db, "2026-10-24", "db", "h", 1, 3);
  js(db, "2026-10-25", "db", "h", 2, 6);
  js(db, "2026-10-27", "h", "db", 1, 4);
  assert.deepEqual(nipponSeriesRecord(db, 2026, "2026-10-24").byTeam.get("h"), { w: 1, l: 0, t: 0 });
  assert.deepEqual(nipponSeriesRecord(db, 2026, "2026-10-25").byTeam.get("h"), { w: 2, l: 0, t: 0 });
  assert.deepEqual(nipponSeriesRecord(db, 2026, "2026-10-27").byTeam.get("h"), { w: 2, l: 1, t: 0 });
  assert.equal(nipponSeriesRecord(db, 2026, "2026-10-23").byTeam.size, 0, "그날 전에 성적이 있다");
}));

test("⚠결착은 「알려진 4승」이다 — 득점 모름이 있어도 이미 이긴 4승은 결착이다(지금과 같은 뜻)", () => withDb((db) => {
  js(db, "2026-10-24", "db", "h", 1, 3);
  js(db, "2026-10-25", "db", "h", 2, 6);
  js(db, "2026-10-27", "h", "db", 4, 1);
  assert.equal(japanSeriesDecided(db, 2026), false, "3승에서 결착이라 했다");
  js(db, "2026-10-28", "h", "db", null, null);
  assert.equal(japanSeriesDecided(db, 2026), false, "모르는 경기를 승으로 셌다");
  js(db, "2026-10-29", "h", "db", 5, 0);
  assert.equal(japanSeriesDecided(db, 2026), true, "알려진 4승인데 결착이 안 섰다");
  assert.equal(nipponSeriesRecord(db, 2026).unknownGames, 1);
}));

test("⚠2018 모양 — 6경기 4勝1敗1分 은 결착이다(「4경기」가 아니라 「4승」)", () => withDb((db) => {
  js(db, "2018-10-27", "c", "h", 2, 2);
  js(db, "2018-10-28", "c", "h", 5, 1);
  js(db, "2018-10-30", "h", "c", 9, 8);
  js(db, "2018-10-31", "h", "c", 4, 1);
  js(db, "2018-11-01", "h", "c", 5, 4);
  assert.equal(japanSeriesDecided(db, 2018), false, "3勝1敗1分 에서 결착이라 했다");
  js(db, "2018-11-03", "c", "h", 0, 2);
  assert.equal(japanSeriesDecided(db, 2018), true);
  assert.deepEqual(nipponSeriesRecord(db, 2018).byTeam.get("h"), { w: 4, l: 1, t: 1 });
}));

/* ── D5 예고 철회 3값 ──────────────────────────────────────────────────── */

test("⚠철회 3값 — 늦은 공표만 withdrawn · 시각을 모르면 unknown · 이른 공표·공표 없음은 notWithdrawn", () => {
  const P = "2026-10-17T09:05:25.199Z";
  assert.equal(probableWithdrawal(P, ["2026-10-17T11:05:08.179Z"]), "withdrawn", "① 늦은 공표");
  assert.equal(probableWithdrawal(P, ["2026-10-17T07:00:00.000Z"]), "notWithdrawn", "② 이른 공표 — 먼저 난 공표가 뒤의 예고를 지웠다");
  assert.equal(probableWithdrawal(P, [null]), "unknown", "③ 공표 시각 모름");
  assert.equal(probableWithdrawal(null, ["2026-10-17T11:05:08.179Z"]), "unknown", "③ 예고 시각 모름");
  assert.equal(probableWithdrawal(P, []), "notWithdrawn", "④ 공표 없음");
  assert.equal(probableWithdrawal(null, []), "notWithdrawn", "공표가 없으면 예고 시각을 몰라도 철회가 아니다");
  assert.equal(probableWithdrawal(P, [P]), "notWithdrawn", "같은 시각은 「늦다」가 아니다(옛 SQL 의 `>` 와 같다)");
  // 공표가 여럿 — 알려진 늦은 것이 하나라도 있으면 철회다(나머지가 모름이어도)
  assert.equal(probableWithdrawal(P, ["2026-10-17T07:00:00.000Z", "2026-10-17T18:24:37.964Z"]), "withdrawn");
  assert.equal(probableWithdrawal(P, [null, "2026-10-17T18:24:37.964Z"]), "withdrawn");
  assert.equal(probableWithdrawal(P, ["2026-10-17T07:00:00.000Z", null]), "unknown", "모르는 공표가 늦은 것일 수 있다");
});

test("⚠휴식 공표는 제목의 날짜로 묶는다 — 날짜를 모르는 행은 어느 날과도 안 짝지어진다", () => withDb((db) => {
  const ins = db.raw.prepare("INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at) VALUES (?, ?, ?, 'x', ?)");
  ins.run("2026-10-17", "2026-10-18", 1, "2026-10-17T11:05:08.179Z");
  ins.run("2026-10-18", "2026-10-18", 1, "2026-10-17T18:24:37.964Z");
  ins.run("2026-10-19", null, 1, "2026-10-19T00:00:00.000Z");
  ins.run("2026-10-20", "2026-10-21", 0, "2026-10-20T09:00:00.000Z"); // 경기 있는 날의 맥박 — 휴식 공표가 아니다
  ins.run("2026-10-21", "2026-10-21", 1, null);
  const m = restDeclarations(db, "2026-10-01", "2026-10-31");
  assert.deepEqual(Object.fromEntries(m), {
    "2026-10-18": ["2026-10-17T11:05:08.179Z", "2026-10-17T18:24:37.964Z"],
    "2026-10-21": [null],
  });
  assert.equal(restDeclarations(db, "2026-10-19", "2026-10-20").size, 0);
}));

/* ── 다음 경기일 ─────────────────────────────────────────────────────── */

test("다음 경기일 — 경기 행과 앞으로의 경기 중 가장 이른 날과 그 행의 시즌(감시와 같은 질의)", () => withDb((db) => {
  js(db, "2026-10-24", "db", "h", 1, 3);
  db.raw.prepare("INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2026, '2026-10-27', 'h', 'db', 0, '', '18:00', 'x', ?)").run(NOW);
  assert.deepEqual(nextGameDayOf(db, "2026-10-24"), { date: "2026-10-24", season: 2026 });
  assert.deepEqual(nextGameDayOf(db, "2026-10-25"), { date: "2026-10-27", season: 2026 });
  assert.equal(nextGameDayOf(db, "2026-10-28"), null);
}));
