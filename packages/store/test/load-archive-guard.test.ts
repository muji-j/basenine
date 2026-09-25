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
