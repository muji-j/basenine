/**
 * 감시 스크립트가 **증거 → 판정 한 벌에 실제로 이어져 있는가** — 프로세스로 띄워서 잰다.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D10 · D11)
 * ⚠판정 규칙 자체는 `packages/domain/test/collection-verdict.test.ts`·`packages/store/test/collection-evidence.test.ts` 가 잰다.
 * 여기는 **연결**만 본다 — 종료 코드 · 새 표가 없는 DB · JSONL 의 새 필드 · 연례 갱신 알림(비차단). 오늘 날짜에 기대지 않는 입력만 쓴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    const insFetch = db.raw.prepare(
      "INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at) VALUES (?, ?, 0, 'x', NULL)",
    );
    insFetch.run(shift(d, -1), d);
    // ⚠판정 창(30일) 밖의 오래된 「모름」은 세지 않는다 — 한 장이라도 남으면 매일 경고가 찍혀 무시된다(수정분 재검토 2차 Minor)
    insFetch.run(shift(today, -60), shift(today, -60));
  } finally {
    db.close();
  }
  const r = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.match(r.stderr, /예고됐는데 받지 못했다/, `B 가 안 울렸다 — 전제가 틀렸다: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, new RegExp(`${d.slice(0, 7)} 사본 취득 시각 모름`), "B 에 걸린 달의 사본 취득 시각(모름)을 안 적었다");
  assert.match(`${r.stdout}${r.stderr}`, /予告先発 취득 시각 모름 1장/, "予告先発 취득 시각 모름 행 수를 안 적었다");
}));

/**
 * ⚠⚠**올스타 날 — 감시가 「予告先発이 뒤처졌다」로 울지 않는다**(2026-10-25 · PR-3 검토 GPT P2 · 판정 규칙은 `collection-evidence.test.ts`).
 * 여기는 **연결**만 본다 — 스크립트가 같은 증거 질의(`nextGameDayOf`)를 거쳐 사유 파일에 `starters-behind` 를 안 쓰는가.
 * 대조로 같은 모양의 정규 날은 지금처럼 운다(그 밖은 불변). ⚠시험이 시계를 읽지 않는다 — 스크립트가 찍는 「오늘(JST)」을 먼저 읽는다.
 */
test("⚠⚠올스타 날 — 감시가 starters-behind 로 안 운다 · 정규 날이면 지금처럼 운다", () => withDir(async (dir) => {
  const probe = join(dir, "probe.sqlite");
  openDb(probe, "2026-09-11T00:00:00.000Z").close();
  const today = /오늘\(JST\) (\d{4}-\d{2}-\d{2})/.exec(spawnSync(process.execPath, [SCRIPT, probe, "2"], { encoding: "utf8" }).stdout)?.[1];
  assert.ok(today !== undefined, "스크립트가 오늘(JST)을 안 찍는다 — 이 시험이 공회전한다");
  const shift = (d: string, days: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const season = Number(today.slice(0, 4));

  for (const [name, home, away, competition, behind] of [["allstar", "cl", "pl", "allStar", false], ["regular", "t", "g", "regular", true]] as const) {
    const path = join(dir, `${name}.sqlite`);
    const db: Db = openDb(path, "2026-09-11T00:00:00.000Z");
    try {
      for (const [me, you] of [["g", "t"], ["t", "g"]] as const) {
        upsertProbablePitcher(db, {
          gameDate: shift(today, -2), teamCode: me, opponentCode: you, playerId: null, sourceName: null, venue: null, startTime: "18:00",
          league: "cl", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt: `${shift(today, -3)}T09:00:00.000Z`,
        });
      }
      upsertGame(db, {
        gameId: `as-${name}`, season, gameDate: today, awayCode: away, homeCode: home, gameNo: 1,
        status: "played", notPlayedReason: null, competition, sourceUrl: "https://npb.jp/x",
        fetchedAt: "2026-09-11T00:00:00.000Z", awayRuns: 1, homeRuns: 2,
      });
      db.raw.prepare(
        "INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (?, ?, 'g', 't', 0, '', '18:00', 'x', NULL)",
      ).run(season, shift(today, 3));
    } finally {
      db.close();
    }
    const out = join(dir, `${name}.reasons.json`);
    const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--reasons-out", out], { encoding: "utf8" });
    assert.notEqual(r.status, 2, `${name}: 판정이 돌지 않았다: ${r.stdout}${r.stderr}`);
    const reasons = (JSON.parse(await readFile(out, "utf8")) as { reasons: string[] }).reasons;
    assert.equal(reasons.includes("starters-behind"), behind, `${name}: starters-behind 가 ${behind ? "안 울었다" : "울었다"} — ${reasons.join(",")}`);
  }
}));

test("⚠--json 뒤에 경로가 없으면 종료 코드 2 가 남는다(예전엔 마지막 줄이 1/0 으로 덮었다)", () => withDir(async (dir) => {
  const path = join(dir, "empty.sqlite");
  openDb(path, "2026-09-11T00:00:00.000Z").close();
  const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 2, "인자 오류를 사유 판정으로 덮었다");
}));

/**
 * ⚠⚠**연례 갱신 알림 — 끝난 시즌이 문서 고정 범위(`DOC_SEASONS`) 밖이면 `::warning::` 한 줄 · 배포는 막지 않는다**(2026-10-24).
 *
 * 고정 수치 시험 13본이 「완결 시즌」을 데이터로 재다가 **정규시즌이 끝난 날 2026 을 넣어** 붉어졌고 배포가 막혔다(2026-10-08).
 * 범위를 손으로 고정하면 그 일은 안 나지만 **잊으면 영원히 낡는다** — 원저자 경고(「최근 시즌을 뺀다로 쓰지 마라」)가 그것이다.
 * → 끝난 시즌이 범위 밖이면 **수집 로그가 매 실행 알린다.** ⚠**종료 코드와 사유에는 아무것도 더하지 않는다** — 더하면 그날의 사고가 되돌아온다.
 * ⚠**「끝났다」는 `seasonIsOver`(일본시리즈 결착 · 더 나중 시즌의 경기)다** — 고정 수치 일부가 전 대회 수라 포스트시즌 동안 자란다.
 * ⚠**시계에 기대지 않는다** — 비교할 두 DB 의 최신 경기를 2099 로 두어 오늘이 언제든 백스톱이 안 운다(둘의 종료 코드가 0 이어야 비차단이 잰다).
 */
const DOC_WARN = /^::warning::끝난 시즌 (\S+) 이 문서 고정 범위/m;
const FIXED_AT = "2026-09-11T00:00:00.000Z";

/** 치러진 경기 한 줄. `competition` 이 일본시리즈면 승패가 시즌 종료를 정한다(`japanSeriesDecided`) */
function addGame(db: Db, gameId: string, date: string, home: string, away: string, o: { competition?: string; homeRuns?: number; awayRuns?: number } = {}): void {
  upsertGame(db, {
    gameId, season: Number(date.slice(0, 4)), gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: o.competition ?? "regular", sourceUrl: "https://npb.jp/x",
    fetchedAt: FIXED_AT, awayRuns: o.awayRuns ?? 1, homeRuns: o.homeRuns ?? 2,
  });
}

test("⚠⚠끝난 시즌이 문서 고정 범위 밖이면 알린다 — 종료 코드·사유는 그대로다(비차단 · 백필도 같은 사건이다)", () => withDir(async (dir) => {
  const build = (name: string, withBackfill: boolean): string => {
    const path = join(dir, name);
    const db: Db = openDb(path, FIXED_AT);
    try {
      addGame(db, "a2025", "2025-06-01", "t", "g"); // 범위 안 — 더 나중 시즌(2099)의 경기가 있어 끝났다
      addGame(db, "a2099", "2099-04-01", "t", "g"); // 진행 중 — 이 DB 의 최신 경기(백스톱이 오늘에 기대지 않게)
      if (withBackfill) addGame(db, "a2017", "2017-06-01", "t", "g"); // 범위 밖 · 끝났다 = 백필
    } finally {
      db.close();
    }
    return path;
  };
  const run = (path: string, log: string) => spawnSync(process.execPath, [SCRIPT, path, "2", "--json", log], { encoding: "utf8" });
  const a = run(build("in-range.sqlite", false), join(dir, "a.jsonl"));
  const b = run(build("backfill.sqlite", true), join(dir, "b.jsonl"));

  assert.doesNotMatch(a.stdout, DOC_WARN, `범위 안 시즌만 끝났는데 알렸다: ${a.stdout}`);
  assert.equal(DOC_WARN.exec(b.stdout)?.[1], "2017", `범위 밖의 끝난 시즌(2017)을 안 알렸다: ${b.stdout}`);
  // ⚠비차단 — 알림이 있든 없든 종료 코드와 사유가 같다. 둘 다 0 이어야 「알림이 실패를 만들지 않는다」를 잰다
  assert.equal(a.status, 0, `전제가 틀렸다 — 알림 없는 DB 가 이미 실패한다: ${a.stdout}${a.stderr}`);
  assert.equal(b.status, 0, `알림이 종료 코드를 바꿨다 — 배포가 막힌다: ${b.stdout}${b.stderr}`);
  const record = async (log: string): Promise<Record<string, unknown>> =>
    JSON.parse((await readFile(join(dir, log), "utf8")).trim()) as Record<string, unknown>;
  const ra = await record("a.jsonl");
  const rb = await record("b.jsonl");
  assert.deepEqual(rb.staleReasons, ra.staleReasons, "알림이 사유를 바꿨다");
  assert.equal(rb.stale, ra.stale, "알림이 stale 을 바꿨다");
  /**
   * ⚠**판정 기록에도 남긴다**(이중 검토 P3 · 2026-10-24) — `::warning::` 은 그 실행의 화면에만 남아 지나가면 찾기 어렵다.
   * JSONL(`ops/collection-log.jsonl`)에 **배열로** 적는다: 없으면 `[]`(「끝났는데 범위 밖인 시즌이 없다」) — 필드가 아예 없는 줄은
   * 「기록하지 않던 시절」이다(M11 · `staleReasons` 와 같은 구별).
   */
  assert.deepEqual(ra.docSeasonsToAdd, [], "알림이 없을 때 JSONL 에 빈 배열을 안 남겼다 — 「없음」과 「안 적음」이 섞인다");
  assert.deepEqual(rb.docSeasonsToAdd, [2017], "알림을 JSONL 에 안 남겼다 — 초록 실행의 경고는 지나가면 안 보인다");
}));

test("⚠⚠「끝났다」는 일본시리즈 결착이다 — 정규시즌 143경기와 CS 가 끝나도 안 알린다", () => withDir(async (dir) => {
  const path = join(dir, "season.sqlite");
  const db: Db = openDb(path, FIXED_AT);
  try {
    db.raw.exec("BEGIN");
    // 2026 정규시즌을 전부 치렀다 — 12구단 × 143경기(하루 6경기 × 143일). 옛 「완결」 판정이면 여기서 이미 완결이다
    const teams = ["g", "t", "s", "c", "db", "d", "h", "l", "f", "m", "e", "b"];
    for (let k = 0; k < 143; k += 1) {
      const date = new Date(Date.parse("2026-04-01T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10);
      for (let i = 0; i < teams.length; i += 2) addGame(db, `r${k}-${i}`, date, teams[i]!, teams[i + 1]!);
    }
    addGame(db, "cs1", "2026-10-15", "h", "f", { competition: "climaxSeries" });
    // 일본시리즈 3승 — 아직 결착이 아니다
    for (const [i, d] of ["2026-10-24", "2026-10-25", "2026-10-27"].entries()) {
      addGame(db, `js${i}`, d, "h", "t", { competition: "nipponSeries", homeRuns: 3, awayRuns: 1 });
    }
    db.raw.exec("COMMIT");
  } finally {
    db.close();
  }
  const before = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.match(before.stdout, /최신 경기일 2026-10-27/, `전제가 틀렸다 — 경기가 안 들어갔다: ${before.stdout}`);
  assert.doesNotMatch(before.stdout, DOC_WARN, "정규시즌·CS 가 끝났을 뿐인데 알렸다 — 전 대회 수치가 아직 자란다");

  const db2: Db = openDb(path, FIXED_AT);
  try {
    addGame(db2, "js3", "2026-10-28", "h", "t", { competition: "nipponSeries", homeRuns: 3, awayRuns: 1 }); // 4승 — 결착
  } finally {
    db2.close();
  }
  const after = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.equal(DOC_WARN.exec(after.stdout)?.[1], "2026", `일본시리즈가 결착했는데 안 알렸다: ${after.stdout}`);
}));

/**
 * ⚠⚠**사유 파일 — 쓰는 쪽**(2026-10-24 · 설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D5 · 4차-3 · 시험 T7).
 * `update.ts` 는 이 파일로 「어느 감시가 울었는가」를 받아 상류 장애로 설명되는지 가른다(`run-verdict.ts`). 읽는 쪽 계약은
 * `run-verdict.test.ts` · `update-steps.test.ts` 가 잰다 — 여기는 **원자적으로 · 정상일 때도 · 종료 2 면 안 쓴다 · 못 쓰면 2** 를 잰다.
 */
test("⚠⚠사유 파일 — 정상(exit 0)도 빈 reasons 로 쓴다 · 사유가 울리면 그 키를 쓴다 · 임시 파일을 남기지 않는다", () => withDir(async (dir) => {
  const quiet = join(dir, "quiet.sqlite");
  const db: Db = openDb(quiet, FIXED_AT);
  try {
    addGame(db, "a2099", "2099-04-01", "t", "g"); // 오늘이 언제든 백스톱이 안 운다(위 연례 알림 시험과 같은 방법)
  } finally {
    db.close();
  }
  const out0 = join(dir, "r0.json");
  const r0 = spawnSync(process.execPath, [SCRIPT, quiet, "2", "--reasons-out", out0], { encoding: "utf8" });
  assert.equal(r0.status, 0, `${r0.stdout}${r0.stderr}`);
  assert.deepEqual(JSON.parse(await readFile(out0, "utf8")), { schema: 1, exit: 0, reasons: [] });

  const empty = join(dir, "empty.sqlite");
  openDb(empty, FIXED_AT).close();
  const out1 = join(dir, "r1.json");
  const r1 = spawnSync(process.execPath, [SCRIPT, empty, "2", "--reasons-out", out1], { encoding: "utf8" });
  assert.equal(r1.status, 1);
  assert.deepEqual(JSON.parse(await readFile(out1, "utf8")), { schema: 1, exit: 1, reasons: ["no-games"] });
  assert.deepEqual((await readdir(dir)).filter((f) => f.includes(".tmp-")), [], "임시 파일(.tmp-<pid>)이 남았다 — rename 이 아니다");
}));

test("⚠사유 파일 — 종료 2(새 표 없는 DB)면 쓰지 않는다 · 경로가 없으면 2 · 못 쓰면 표준오류 한 줄 + 2", () => withDir(async (dir) => {
  const old = join(dir, "old.sqlite");
  const raw = new DatabaseSync(old);
  raw.exec("CREATE TABLE game (game_id TEXT, game_date TEXT, status TEXT)");
  raw.close();
  const out = join(dir, "r.json");
  const r = spawnSync(process.execPath, [SCRIPT, old, "2", "--reasons-out", out], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.equal((await readdir(dir)).includes("r.json"), false, "종료 2 인데 사유 파일을 썼다");

  const empty = join(dir, "empty.sqlite");
  openDb(empty, FIXED_AT).close();
  assert.equal(spawnSync(process.execPath, [SCRIPT, empty, "2", "--reasons-out"], { encoding: "utf8" }).status, 2, "경로 없는 --reasons-out 을 받았다");
  // 판정은 끝까지 돌았는데 다른 인자 오류(--json 뒤 경로 없음)로 종료 2 — 그때도 안 쓴다(스키마의 exit 는 0|1 뿐이다)
  const late = join(dir, "late.json");
  const r2 = spawnSync(process.execPath, [SCRIPT, empty, "2", "--reasons-out", late, "--json"], { encoding: "utf8" });
  assert.equal(r2.status, 2, `${r2.stdout}${r2.stderr}`);
  assert.equal((await readdir(dir)).includes("late.json"), false, "종료 2 인데 사유 파일을 썼다(--json 인자 오류)");
  const bad = spawnSync(process.execPath, [SCRIPT, empty, "2", "--reasons-out", join(dir, "no-such-dir", "r.json")], { encoding: "utf8" });
  assert.equal(bad.status, 2, "못 썼는데 1 로 끝났다 — 쓰는 쪽 고장과 사유가 같은 코드가 된다");
  assert.match(bad.stderr, /사유 파일을 못 썼다/);
}));
