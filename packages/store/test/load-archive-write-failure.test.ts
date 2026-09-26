/**
 * 한 경기의 **쓰기 예외**가 그 경기만 되돌리고 적재 전체를 멈추지 않는가를 실물 두 경기로 잰다(감사 N1 · 2026-09-27).
 * 설계: `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §6 · §9-2(1-1~1-3).
 *
 * ⚠**반증자 재현 그대로다** — 실물 `2026/0815/b-f-20` 의 박스에서 寺西(`61465150`) 링크만 못 읽게 하면 박스 쪽은 격리
 *   (`unlinkedPlayer` · 감사 C9)만 남고 선수 행이 안 생기는데, 경과의 링크는 살아 있어 그 투수의 타석이 `pa_event.pitcher_id`
 *   (외래키)로 간다. 예전에는 외래키 오류가 **프로세스를 죽였다** — 스택 · 종료 1 · 표준출력 빈 문자열 ·
 *   **뒤 정상 경기(`2026/0816/b-f-21`)도 · 명단 보충도 · 시즌 표시명 쓰기도 안 돌았다.**
 * ⚠**try/catch 만으로는 새 결함이 생긴다**(설계 §1-2) — 콜백 안에서 바꾸던 전역 상태(`seenPlayers` · 시즌 표시명 · 쓰기 예산)가
 *   되돌린 경기의 흔적을 남겨 ⑴ 겹치는 선수가 나오는 뒤 경기가 외래키로 실패하고 ⑵ 마지막 표시명 쓰기가 잡히지 않는 외래키로 죽는다.
 *   이 두 경기는 박스 링크 선수 **겹침 24명 · 첫 경기에만 11명**(설계 실측)이라 두 연쇄를 모두 밟는다.
 * ⚠**합성 box 를 쓰지 않는다** — `load-archive-unlinked.test.ts` 와 같은 이유 · 같은 변이 방식(본문 sha256 을 사이드카에 맞춘다).
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseBoxScore } from "@bb-app/parser";
import { openDb } from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCORES = join(ROOT, "data", "archive", "npb", "scores");
const TOOL = fileURLToPath(new URL("../tools/load-archive.ts", import.meta.url));
/** 링크를 못 읽게 만들 경기 — `load-archive-guard.test.ts`·`load-archive-unlinked.test.ts` 와 같은 경기 */
const FAILING = "2026/0815/b-f-20";
/** 바로 다음 날의 정상 경기 — 같은 두 구단이라 선수가 겹친다 */
const NEXT = "2026/0816/b-f-21";
/** 寺西 — 그날 선발이고 경과에는 링크가 있다 */
const TERANISHI = "61465150";
const NOW = "2026-09-27T00:00:00.000Z";

const HAS = [FAILING, NEXT].every((g) => existsSync(join(SCORES, g, "box.html.gz")) && existsSync(join(SCORES, g, "playbyplay.html.gz")));
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${SCORES} 에 픽스처 경기(${FAILING} · ${NEXT})가 없다`);
}
const skip = HAS ? false : "data/archive 의 픽스처 경기 없음";

interface Env { dir: string; archive: string; dbPath: string }

/** 두 경기를 임시 아카이브로 복사하고, FAILING 의 박스에서 寺西 링크만 못 읽게 한다(본문 sha256 을 사이드카에 맞춘다) */
async function setup(): Promise<Env> {
  const dir = await mkdtemp(join(tmpdir(), "bb-writefail-"));
  const archive = join(dir, "archive");
  for (const g of [FAILING, NEXT]) await cp(join(SCORES, g), join(archive, "npb", "scores", g), { recursive: true });
  const gameDir = join(archive, "npb", "scores", FAILING);
  const html = gunzipSync(await readFile(join(gameDir, "box.html.gz"))).toString("utf8");
  const link = `/bis/players/${TERANISHI}.html`;
  assert.equal(html.split(link).length - 1, 1, `寺西(${TERANISHI}) 의 링크가 박스에 정확히 한 번이 아니다 — 픽스처 전제가 깨졌다`);
  const next = html.replace(link, `/bis/players/${TERANISHI}`);
  await writeFile(join(gameDir, "box.html.gz"), gzipSync(Buffer.from(next, "utf8")));
  const metaPath = join(gameDir, "box.meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
  meta["sha256"] = createHash("sha256").update(Buffer.from(next, "utf8")).digest("hex");
  await writeFile(metaPath, JSON.stringify(meta));
  // 경과에는 寺西 링크가 그대로 있어야 이 경로가 열린다
  const pbp = gunzipSync(await readFile(join(gameDir, "playbyplay.html.gz"))).toString("utf8");
  assert.ok(pbp.includes(link), "경과에 寺西 링크가 없다 — 픽스처 전제가 깨졌다");
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  return { dir, archive, dbPath };
}

function load(env: Env): { code: number; out: string; err: string } {
  // ⚠`--skip-events` **없이** 돈다 — 외래키 경로는 경과 타석을 쓸 때 열린다
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function n(env: Env, sql: string, ...args: (string | number)[]): number {
  const db = openDb(env.dbPath, NOW);
  try {
    return (db.raw.prepare(sql).get(...args) as { n: number }).n;
  } finally {
    db.close();
  }
}

/** 원본 박스에서 링크를 읽은 선수(합계 행 제외) */
function linkedPlayers(game: string): Set<string> {
  const box = parseBoxScore(gunzipSync(readFileSync(join(SCORES, game, "box.html.gz"))).toString("utf8"));
  if (box.status !== "played") throw new Error(`${game} 이 성립 경기가 아니다 — 픽스처 전제가 깨졌다`);
  return new Set(
    [box.away, box.home].flatMap((t) => [...t.batters, ...t.pitchers])
      .filter((r) => !r.isTeamTotal && r.playerId !== null)
      .map((r) => r.playerId!),
  );
}

test("⚠N1 1-1 · 경과가 선수 표에 없는 투수를 가리키면 그 경기만 되돌린다 — 뒤 경기 · 명단 보충 · 시즌 표시명 쓰기는 돈다", { skip }, async () => {
  const first = linkedPlayers(FAILING);
  const second = linkedPlayers(NEXT);
  const onlyFirst = [...first].filter((id) => !second.has(id));
  const both = [...first].filter((id) => second.has(id));
  // ⚠두 연쇄(겹치는 선수 · 첫 경기에만 나온 선수)를 둘 다 밟는지 먼저 본다 — 한쪽이 0 이면 이 시험은 그 연쇄를 안 잰다
  assert.ok(first.has(TERANISHI) && !second.has(TERANISHI), "寺西가 첫 경기에만 있어야 한다 — 픽스처 전제가 깨졌다");
  assert.ok(both.length > 0, "두 경기에 겹치는 선수가 없다 — 「뒤 경기가 외래키로 실패하는」 연쇄를 안 잰다");
  assert.ok(onlyFirst.length > 1, "첫 경기에만 나온 선수가 寺西뿐이다 — 「마지막 표시명 쓰기가 죽는」 연쇄를 안 잰다");

  const env = await setup();
  try {
    const r = load(env);
    const all = r.out + r.err;
    assert.equal(r.code, 1, `쓰기 실패가 있었는데 종료 ${r.code} 다\n${all}`);
    // 원인을 말한다 — 경기 · 단계 · 선수 ID · 역할 · 그 경기에서 모은(되돌려진) 격리
    assert.match(r.err, /WRITE ERROR 2026\/0815\/b-f-20 — 실시 쓰기: /, all);
    assert.match(r.err, new RegExp(`投手 ${TERANISHI}\\(타석 \\d+\\)`), all);
    assert.match(r.err, /unlinkedPlayer/, "되돌려진 격리(unlinkedPlayer)를 말하지 않는다 — 그 경기의 C9 격리는 롤백으로 저장되지 않는다");
    assert.doesNotMatch(all, /FOREIGN KEY constraint failed/, "외래키 오류가 났다 — 사전 점검이 원인 선수를 먼저 말하지 않았다");
    // 요약이 끝까지 찍힌다(예전에는 스택만 남기고 죽었다)
    assert.match(r.out, /쓰기 실패 1건/);
    assert.match(r.out, /⚠쓰기에서 실패한 경기 1건 — 그 경기만 되돌렸다/);
    assert.match(r.out, /=== 격리/);

    // 실패한 경기는 흔적이 없다 — 경기 행 · 타석 · 박스 행 · 격리
    for (const table of ["game", "pa_event", "batting_line", "pitching_line", "quarantine"]) {
      assert.equal(n(env, `SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`, FAILING), 0, `되돌린 경기의 ${table} 행이 남았다`);
    }
    // 뒤 경기는 들어왔다 — 겹치는 선수가 있는데도(되돌린 경기가 `seenPlayers` 에 흔적을 남기면 여기서 외래키로 실패한다)
    assert.equal(n(env, "SELECT COUNT(*) AS n FROM game WHERE game_id = ?", NEXT), 1, "뒤 정상 경기가 안 들어왔다");
    assert.ok(n(env, "SELECT COUNT(*) AS n FROM pa_event WHERE game_id = ?", NEXT) > 0, "뒤 경기의 타석이 안 들어왔다");
    for (const id of both) {
      assert.equal(n(env, "SELECT COUNT(*) AS n FROM player WHERE player_id = ?", id), 1, `겹치는 선수 ${id} 의 선수 행이 없다`);
    }
    // 첫 경기에만 나온 선수는 선수 행도 시즌 표시명도 없다(되돌린 경기의 표시명이 전역에 남으면 마지막 쓰기가 외래키로 죽는다)
    for (const id of onlyFirst) {
      assert.equal(n(env, "SELECT COUNT(*) AS n FROM player WHERE player_id = ?", id), 0, `되돌린 경기에만 나온 ${id} 의 선수 행이 남았다`);
      assert.equal(n(env, "SELECT COUNT(*) AS n FROM player_season_name WHERE player_id = ?", id), 0, `되돌린 경기에만 나온 ${id} 의 표시명이 남았다`);
    }
    // 시즌 표시명 쓰기 · 명단 보충이 돌았다 — 선수 페이지를 안 넣었으므로 포지션은 명단에서만 온다
    assert.ok(n(env, "SELECT COUNT(*) AS n FROM player_season_name") > 0, "시즌 표시명 쓰기가 안 돌았다");
    assert.ok(n(env, "SELECT COUNT(*) AS n FROM player WHERE position IS NOT NULL") > 0, "명단 보충이 안 돌았다");
    console.log(`  · 겹치는 선수 ${both.length}명 · 첫 경기에만 ${onlyFirst.length}명(寺西 포함)`);
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});
