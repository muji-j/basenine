/**
 * 선수 링크를 못 읽은 박스 행이 **격리에 남는가**를 실물 경기로 잰다(2026-09-26 · 감사 C9).
 *
 * 예전에는 `deriveBatting`/`derivePitching` 이 `null` 을 돌려 적재기가 격리 **전에** `continue` 했다 —
 * 이름은 있는데 그 행이 통째로 사라지고, 격리도 로그도 종료 코드도 아무 말을 안 했다.
 * ⚠특히 **투수 줄**은 교차 확인이 없어 빠지면 팀 투구회·방어율이 조용히 줄 뿐이다.
 *
 * ⚠**합성 box 를 쓰지 않는다** — `load-archive-guard.test.ts` 와 같은 이유(파서가 엄격해 만든 문자열은 실물과 갈린다).
 *   실물 경기 폴더를 임시로 복사해 **그 행의 링크만** 못 읽게 바꾸고, 본문 sha256 을 사이드카에 맞춘 뒤 적재한다.
 * ⚠`--skip-events` 로 돈다 — 경과(playbyplay)는 박스와 따로 그 선수의 ID 를 갖고 있어서, 링크를 못 읽은 투수가
 *   선수 표에 없으면 `pa_event.pitcher_id`(외래키)에서 적재가 멈춘다. **그 경로는 이 시험의 대상이 아니다** —
 *   격리를 남기는 곳은 박스 행 도출(`derive.ts`)이고, 그것은 경과 유무와 무관하다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseBoxScore } from "@bb-app/parser";
import type { BoxScore } from "@bb-app/parser";
import { openDb } from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCORES = join(ROOT, "data", "archive", "npb", "scores");
const TOOL = fileURLToPath(new URL("../tools/load-archive.ts", import.meta.url));
/** `load-archive-guard.test.ts` 와 같은 경기 — CI 가 `BB_REQUIRE_DB=1` 로 존재를 강제한다 */
const GAME = "2026/0815/b-f-20";
const NOW = "2026-09-26T00:00:00.000Z";

const HAS = existsSync(join(SCORES, GAME, "box.html.gz"));
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${SCORES} 에 픽스처 경기(${GAME})가 없다`);
}
const skip = HAS ? false : "data/archive 의 픽스처 경기 없음";

interface Env { dir: string; archive: string; dbPath: string }

async function setup(): Promise<Env> {
  const dir = await mkdtemp(join(tmpdir(), "bb-unlinked-"));
  const archive = join(dir, "archive");
  await cp(join(SCORES, GAME), join(archive, "npb", "scores", GAME), { recursive: true });
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  return { dir, archive, dbPath };
}

function load(env: Env): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath, "--skip-events"], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
}

function all<T>(env: Env, sql: string, ...args: (string | number)[]): T[] {
  const db = openDb(env.dbPath, NOW);
  try {
    return db.raw.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
}

/**
 * 박스에서 한 행을 골라 **그 행의 선수 링크만** 못 읽게 바꾼다(`/bis/players/{id}.html` → `/bis/players/{id}`).
 * ⚠실물 박스에서 선수 링크는 **선수마다 정확히 한 번**이다 — 두 번 이상이면 다른 행까지 건드리므로 멈춘다.
 * ⚠본문을 바꾸면 사이드카의 sha256 도 맞춘다 — 안 맞추면 무결성 대조(설계 D3)가 경기를 통째로 건너뛴다.
 */
async function unlinkRow(env: Env, pick: (box: Extract<BoxScore, { status: "played" }>) => { id: string; name: string }): Promise<{ id: string; name: string }> {
  const dir = join(env.archive, "npb", "scores", GAME);
  const html = gunzipSync(await readFile(join(dir, "box.html.gz"))).toString("utf8");
  const box = parseBoxScore(html);
  assert.equal(box.status, "played", "픽스처 경기가 성립 경기가 아니다");
  if (box.status !== "played") throw new Error("unreachable");
  const target = pick(box);
  const link = `/bis/players/${target.id}.html`;
  assert.equal(html.split(link).length - 1, 1, `${target.name}(${target.id}) 의 링크가 박스에 정확히 한 번이 아니다`);
  const next = html.replace(link, `/bis/players/${target.id}`);
  await writeFile(join(dir, "box.html.gz"), gzipSync(Buffer.from(next, "utf8")));
  const metaPath = join(dir, "box.meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
  meta["sha256"] = createHash("sha256").update(Buffer.from(next, "utf8")).digest("hex");
  await writeFile(metaPath, JSON.stringify(meta));
  return target;
}

interface QRow { kind: string; game_id: string | null; player_id: string | null; raw: string; detail: string | null }

test("C9 · 링크를 못 읽은 투수 행이 격리에 남는다 — 그 등판은 적재하지 않는다(M10)", { skip }, async () => {
  const env = await setup();
  try {
    const t = await unlinkRow(env, (box) => {
      const p = box.home.pitchers.find((x) => !x.isTeamTotal && x.playerId !== null)!;
      return { id: p.playerId!, name: p.name };
    });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const rows = all<QRow>(env, "SELECT kind, game_id, player_id, raw, detail FROM quarantine WHERE kind = 'unlinkedPlayer'");
    assert.equal(rows.length, 1, `링크를 못 읽은 투수 행이 격리 없이 사라졌다 — 격리 ${rows.length}건`);
    const q = rows[0]!;
    assert.equal(q.game_id, GAME);
    assert.equal(q.player_id, null);
    assert.equal(q.raw, t.name, "원문 이름을 안 남겼다");
    assert.match(q.detail ?? "", /後攻/);
    assert.match(q.detail ?? "", /投手/);
    // ⚠이름으로 조인하지 않는다 — 그 등판은 들어가지 않는다
    assert.equal(all<{ n: number }>(env, "SELECT COUNT(*) AS n FROM pitching_line WHERE game_id = ? AND player_id = ?", GAME, t.id)[0]!.n, 0);
    // ⚠요약이 종류를 말한다 — 収集ログ가 이 수를 보고 「판단 요청」을 띄운다
    assert.match(r.out, /unlinkedPlayer/);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

test("C9 · 링크를 못 읽은 타자 행도 격리에 남는다", { skip }, async () => {
  const env = await setup();
  try {
    const t = await unlinkRow(env, (box) => {
      const b = box.away.batters.find((x) => !x.isTeamTotal && x.playerId !== null)!;
      return { id: b.playerId!, name: b.name };
    });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const rows = all<QRow>(env, "SELECT kind, game_id, player_id, raw, detail FROM quarantine WHERE kind = 'unlinkedPlayer'");
    assert.equal(rows.length, 1, `링크를 못 읽은 타자 행이 격리 없이 사라졌다 — 격리 ${rows.length}건`);
    assert.equal(rows[0]!.raw, t.name);
    assert.match(rows[0]!.detail ?? "", /先攻/);
    assert.match(rows[0]!.detail ?? "", /打者/);
    assert.equal(all<{ n: number }>(env, "SELECT COUNT(*) AS n FROM batting_line WHERE game_id = ? AND player_id = ?", GAME, t.id)[0]!.n, 0);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

/** ⚠**동작 변화가 없어야 한다** — 링크를 안 건드린 실물 경기에서 이 격리는 0건이다(보유 박스 전량도 0건 · 보고서) */
test("C9 · 링크를 안 건드린 실물 경기에서는 이 격리가 0건이다", { skip }, async () => {
  const env = await setup();
  try {
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(all<{ n: number }>(env, "SELECT COUNT(*) AS n FROM quarantine WHERE kind = 'unlinkedPlayer'")[0]!.n, 0);
    assert.ok(all<{ n: number }>(env, "SELECT COUNT(*) AS n FROM pitching_line WHERE game_id = ?", GAME)[0]!.n > 0, "투수 줄이 하나도 없다 — 이 시험이 아무것도 안 잰다");
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});
