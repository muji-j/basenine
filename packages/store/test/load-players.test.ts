/**
 * 선수 페이지 적재기(`load-players.ts`)를 **실물 선수 페이지**로 잰다 — 감사 C7(취득 시각) · C8(통산 표 소실).
 *
 * ⚠**합성 페이지를 쓰지 않는다** — 파서가 실물 마크업(탭 `#pc_stats_nav` · 구획 `stats_*` · 중첩 投球回 표)에
 *   기대므로 만든 문자열은 실물과 갈리고, 그러면 「아무것도 안 재는 초록」이 된다(`packages/parser/test/fixtures/README.md`).
 *   로컬·CI 의 `data/archive` 에서 선수 페이지를 **임시 폴더로 복사**해 쓴다.
 * ⚠사이드카(`*.meta.json`)는 실물을 읽어 **시각만 바꿔** 쓴다 — 시각 규칙은 `meta.ts` 한 벌이다(`seenAtOf` · `contentTimeOf`).
 * ⚠**본문을 바꾸면 사이드카 `sha256` 도 맞춘다**(감사 N3) — 판은 본문 sha 이고, 사이드카가 본문을 말하지 않으면 시각을 모른다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertGame, upsertPitching, upsertPlayer } from "../src/index.ts";
import { LocalSink, PoliteFetcher, archivePlayer } from "@bb-app/archiver";

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
 *   ⚠실물 사이드카를 읽어 `fetchedAt`·`checkedAt` 만 갈아 끼운다 — 나머지(sha256·revision)는 실물 그대로다.
 *   ⚠~~sha256 은 적재기가 안 본다~~ 는 2026-09-27 부로 낡았다(감사 N3) — 판 가드가 본다. 실물 sha 는 실물 본문과 같다(설계 §4-2 실측).
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

/**
 * ⚠**픽스처의 전제를 먼저 잰다** — 아래 시험들은 「투수 페이지는 두 표 · 야수 페이지는 타격 표만」에 기댄다.
 * CI 아카이브의 페이지는 다시 받히므로(재취득) 그 선수가 야수 등판이라도 하면 전제가 바뀐다.
 * 그날 다른 시험이 엉뚱한 이유로 붉어지지 않게, **전제가 깨졌다고 여기서 말한다.**
 */
test("픽스처 전제 — 투수 페이지는 두 표(탭·구획·표) · 야수 페이지는 타격 표만", { skip }, async () => {
  const shape = async (id: string) => {
    const html = gunzipSync(await readFile(join(PLAYERS, `${id}.html.gz`))).toString("utf8");
    return {
      b: html.includes('<table id="tablefix_b">') && html.includes('id="nav_b"') && html.includes('id="stats_b"'),
      p: html.includes('<table id="tablefix_p">') || html.includes('id="nav_p"') || html.includes('id="stats_p"'),
    };
  };
  assert.deepEqual(await shape(PITCHER), { b: true, p: true }, `${PITCHER} 가 더는 「두 표」 투수 페이지가 아니다 — 픽스처를 바꿔라`);
  assert.deepEqual(await shape(BATTER), { b: true, p: false }, `${BATTER} 가 더는 「타격 표만」인 야수 페이지가 아니다 — 픽스처를 바꿔라`);
});

/**
 * 적재기를 프로세스로 돌린다. `extra` 는 뒤에 붙는 인자(`--run-started-at <ISO>` — 이번 실행의 시작 시각 · 반영분 재검토 P2).
 * ⚠안 주면 **단독 실행**이다 — 기준선 없는 행에 대한 「이번 실행 증명」이 없다.
 */
function load(env: Env, extra: string[] = []): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath, ...extra], { encoding: "utf8" });
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

/** 이전 판의 취득 시각. 적재 시각(지금)과 다르고, 사이드카 시각과도 다르다 */
const OLD_SEEN = "2026-06-01T00:00:00.000Z";

/**
 * ⚠**모르면 모른다(NULL)** — 이전 판의 시각을 남기지도, 적재 시각으로 메우지도 않는다(M4·M11 · 3중 검토 2차 반영).
 *
 * 처음에는 `COALESCE(?, profile_fetched_at)` 로 **이전 시각을 남겼다.** 그런데 같은 UPDATE 가 프로필 값
 * (투타·읽는 법·배번)은 **이번 페이지로** 덮어쓰므로 「값은 새 판 · 시각은 옛 판」이 됐다 —
 * 그 시각은 그 값의 출처를 거짓으로 말한다. 같은 페이지의 통산 행은 그때 **NULL** 이다(한 벌로 맞춘다).
 */
test("C7 · 사이드카를 못 읽으면 profile_fetched_at 은 NULL 이다 — 이전 시각도 적재 시각도 넣지 않는다(M11) · 결손은 센다", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    exec(env, "UPDATE player SET profile_fetched_at = ? WHERE player_id = ?", OLD_SEEN, PITCHER);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const got = q<{ p: string | null }>(env, "SELECT profile_fetched_at AS p FROM player WHERE player_id = ?", PITCHER).p;
    assert.equal(got, null, `모르는 취득 시각에 ${got} 이 들어갔다 — 이전 판의 시각이면 「값은 새 판 · 시각은 옛 판」이다`);
    // ⚠같은 페이지의 통산 행과 **같은 답**이어야 한다 — 그쪽도 NULL 이다
    const cb = q<{ n: number; known: number }>(
      env,
      "SELECT COUNT(*) AS n, COUNT(fetched_at) AS known FROM career_batting WHERE player_id = ?",
      PITCHER,
    );
    assert.ok(cb.n > 0, "통산 타격 행이 없다 — 이 시험이 비교할 상대가 없다");
    assert.equal(cb.known, 0, "통산 행에는 시각이 들어갔다 — 프로필과 통산이 갈렸다");
    // ⚠투구 통산도 같다(집중 재검토 P3) — 두 INSERT 가 지금은 같은 변수를 쓰지만, 갈라지면 이 줄이 잡는다
    const cp = q<{ n: number; known: number }>(
      env,
      "SELECT COUNT(*) AS n, COUNT(fetched_at) AS known FROM career_pitching WHERE player_id = ?",
      PITCHER,
    );
    assert.ok(cp.n > 0, "통산 투구 행이 없다 — 투수 픽스처가 아니다");
    assert.equal(cp.known, 0, "통산 투구 행에는 시각이 들어갔다 — 프로필·타격 통산과 갈렸다");
    // ⚠「모른다」는 조용히 넘기지 않는다 — 요약에 NULL 로 쓴 선수 수가 찍혀야 한다(2026-09-27 이름을 고쳤다 · ~~취득시각 결손~~)
    assert.match(r.err, /취득시각 모름\(NULL\)으로 쓴 선수 1명/);
  } finally {
    await cleanup(env);
  }
});

// ─── C8 · 통산 표를 못 찾아도 기존 통산 행이 조용히 사라지지 않는다(M7·M11) ─────────────────────

function counts(env: Env, id: string): { b: number; p: number } {
  return {
    b: q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM career_batting WHERE player_id = ?", id).n,
    p: q<{ n: number }>(env, "SELECT COUNT(*) AS n FROM career_pitching WHERE player_id = ?", id).n,
  };
}

const pagePath = (env: Env, id: string): string => join(env.archive, "npb", "players", `${id}.html.gz`);
const metaPath = (env: Env, id: string): string => join(env.archive, "npb", "players", `${id}.meta.json`);
const shaOf = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

/**
 * 임시 아카이브의 선수 페이지를 고친다. ⚠**안 바뀌면 던진다** — 변이가 헛돌면 이 시험은 아무것도 안 잰다.
 * ⚠**사이드카가 있으면 `sha256` 을 바꾼 본문에 맞춘다**(감사 N3 · 설계 §9-1) — 아카이버가 새 본문을 받으면 새 sha 를 적는다.
 *   안 맞추면 「사이드카가 본문을 말하지 않는다 → 시각 모름」이 되어, 판 가드가 이 시험들이 재려는 것(통산 표 구조 변경)
 *   **전에** 그 선수를 `VERSION UNKNOWN` 으로 건너뛴다. 시각은 건드리지 않는다.
 */
async function mutatePage(env: Env, id: string, fn: (html: string) => string): Promise<void> {
  const p = pagePath(env, id);
  const html = gunzipSync(await readFile(p)).toString("utf8");
  const next = fn(html);
  assert.notEqual(next, html, "변이가 페이지를 바꾸지 않았다");
  await writeFile(p, gzipSync(Buffer.from(next, "utf8")));
  if (existsSync(metaPath(env, id))) await editSidecar(env, id, { sha256: shaOf(Buffer.from(next, "utf8")) });
}

/** 원본 페이지로 되돌린다 — 본문과 **사이드카 sha** 를 함께(사이드카의 시각은 그대로) */
async function restorePage(env: Env, id: string): Promise<void> {
  await copyFile(join(PLAYERS, `${id}.html.gz`), pagePath(env, id));
  await editSidecar(env, id, { sha256: shaOf(gunzipSync(await readFile(pagePath(env, id)))) });
}

/** 임시 아카이브의 사이드카를 고친다. 값이 `undefined` 인 키는 지운다 */
async function editSidecar(env: Env, id: string, patch: Record<string, unknown>): Promise<void> {
  const m = JSON.parse(await readFile(metaPath(env, id), "utf8")) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete m[k];
    else m[k] = v;
  }
  await writeFile(metaPath(env, id), JSON.stringify(m));
}

/**
 * ⚠**감사 C8 의 재현 그대로다** — 표 id 하나가 바뀐 페이지를 적재하면, 예전에는 그 선수의
 * 통산 투구 행이 **지워지고 아무것도 안 들어간 채 종료 0** 이었다. 화면은 그 투수를 「기록 없음」으로 그린다.
 */
test("C8 · 투수 표 id 가 바뀐 페이지 → 기존 통산 행을 지키고 실패로 끝난다(종료 1 · CAREER ERROR)", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_PITCHER } });
  try {
    const first = load(env);
    assert.equal(first.code, 0, first.out + first.err);
    const before = counts(env, PITCHER);
    assert.ok(before.b > 0 && before.p > 0, `픽스처 투수에게 통산 행이 없다 — ${JSON.stringify(before)}`);

    await mutatePage(env, PITCHER, (h) => h.replace('<table id="tablefix_p">', '<table id="tablefix_pitching">'));
    const r = load(env);
    assert.equal(r.code, 1, `통산 표를 잃었는데 종료 ${r.code} 다 — 크론이 「성공」으로 보고한다\n${r.err}`);
    assert.match(r.err, new RegExp(`CAREER ERROR ${PITCHER}`));
    assert.match(r.err, /실패 1명/);
    assert.deepEqual(counts(env, PITCHER), before, "기존 통산 행이 사라졌다 — 파싱 실패가 DELETE 를 커밋했다");
  } finally {
    await cleanup(env);
  }
});

/** 탭(`nav_p`)·구획(`stats_p`)·표(`tablefix_p`)의 id 를 **한꺼번에** 바꾼다 — 파서의 「탭·구획이 말하는가」 신호를 피해 간다 */
const renameAllPitching = (h: string): string =>
  h.replace('id="nav_p"', 'id="nav_x"').replace('id="stats_p"', 'id="stats_x"').replace('<table id="tablefix_p">', '<table id="tablefix_x">');

/**
 * ⚠**3중 검토 3차 P2 의 재현 그대로다**(실물 `01005134` · 2026-09-26).
 * **신규 투수**(있던 통산 행 0)에게 위 변이를 주면, 예전에는 파서가 투수 표를 「원래 없음」으로 읽어 빈 배열을 냈고
 * 적재기의 「있던 표가 0행이면 실패」도 `had.pitching === 0` 이라 안 걸려 **투구 통산 0행 · 실패 0 · 종료 0** 이었다.
 * 모든 표가 한꺼번에 바뀌면 기존 선수들에서 시끄럽게 잡히지만, **투수 표만** 바뀌면 그 뒤 신규 투수만 조용히 빈다.
 * 이제 파서가 통계 구획의 **모르는 표**(`tablefix_x`)로 던진다. 원본으로 되돌려 다시 적재하면 정상으로 돌아온다.
 */
test("C8 · 신규 투수의 투수 표 탭·구획·표 id 가 한꺼번에 바뀌면 종료 1 · CAREER ERROR — 원본을 되돌려 재적재하면 종료 0", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_PITCHER } });
  try {
    // ⚠**적재 전에** 바꾼다 — 있던 통산 행이 없는 신규 선수의 모양이다
    await mutatePage(env, PITCHER, renameAllPitching);
    const r = load(env);
    assert.equal(r.code, 1, `신규 투수의 투구 통산이 조용히 비었는데 종료 ${r.code} 다\n${r.err}`);
    assert.match(r.err, new RegExp(`CAREER ERROR ${PITCHER} — .*모르는 표가 있다`));
    assert.deepEqual(counts(env, PITCHER), { b: 0, p: 0 }, "실패한 선수의 통산이 반쪽만 들어갔다");

    // 원본으로 되돌리면 다음 적재가 정상으로 끝난다 — 막힌 것은 그 페이지뿐이다
    // ⚠본문과 **사이드카 sha** 를 함께 되돌린다(아카이버가 원본을 다시 받은 모양 · 감사 N3 — 본문만 되돌리면 판을 모른다)
    await restorePage(env, PITCHER);
    const again = load(env);
    assert.equal(again.code, 0, again.out + again.err);
    const c = counts(env, PITCHER);
    assert.ok(c.b > 0 && c.p > 0, `원본을 재적재했는데 통산이 없다 — ${JSON.stringify(c)}`);
  } finally {
    await cleanup(env);
  }
});

/** 같은 변이를 **기존 통산이 있는** DB 에 준다 — 기존 행은 그대로 남고 실패로 끝난다(이제 파서가 먼저 잡는다) */
test("C8 · 기존 통산이 있는 투수의 투수 표 탭·구획·표 id 가 한꺼번에 바뀌어도 기존 행을 지키고 종료 1", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_PITCHER } });
  try {
    assert.equal(load(env).code, 0);
    const before = counts(env, PITCHER);
    assert.ok(before.p > 0);

    await mutatePage(env, PITCHER, renameAllPitching);
    const r = load(env);
    assert.equal(r.code, 1, `있던 투구 행을 잃을 뻔했는데 종료 ${r.code} 다\n${r.err}`);
    assert.match(r.err, new RegExp(`CAREER ERROR ${PITCHER} — .*모르는 표가 있다`));
    assert.deepEqual(counts(env, PITCHER), before, "기존 통산 행이 사라졌다");
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**파서가 원리적으로 못 가르는 변이**다 — 투수 표의 탭·구획·표를 **통째로 지우면** 그 페이지는
 * 「투수 표가 원래 없는 야수 페이지」와 바이트 모양이 같다(모르는 표도 없다). 파서의 빈 배열은 그 판단으로는 옳다.
 * 그래도 **있던 통산 행이 0행이 되는 것**은 원래 없음이 아니다 — 1군 기록은 사라지지 않는다. 적재기가 결과 쪽에서 막는다.
 * 실측(선수 페이지 스냅숏 8벌 · 1,644명 · 서로 다른 판 3,291개 사이의 전이 1,647개): 표가 있다가 없어진 전이 **0건**.
 */
test("C8 · 투수 표가 페이지에서 통째로 사라져도(야수 페이지와 같은 모양) 있던 투구 행은 지킨다 — 있던 표가 0행이면 실패", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_PITCHER } });
  try {
    assert.equal(load(env).code, 0);
    const before = counts(env, PITCHER);
    assert.ok(before.p > 0);

    await mutatePage(env, PITCHER, (h) =>
      h.replace(/<li id="nav_p"[^>]*>[^<]*<\/li>/, "")
        .replace(/<div class="stats_table tab_unit" id="stats_p">[\s\S]*?<\/table>\s*<\/div>/, ""));
    const r = load(env);
    assert.equal(r.code, 1, `있던 투구 행을 잃었는데 종료 ${r.code} 다\n${r.err}`);
    assert.match(r.err, new RegExp(`CAREER ERROR ${PITCHER} — 있던 통산 표가 0행이 됐다`));
    assert.deepEqual(counts(env, PITCHER), before, "기존 통산 행이 사라졌다");
  } finally {
    await cleanup(env);
  }
});

/** ⚠**헛실패 쪽을 막는다** — 야수 페이지에는 투수 표가 원래 없다. 두 번 적재해도(두 번째는 「있던 행」을 본다) 실패가 아니다 */
test("C8 · 투수 표가 원래 없는 야수 페이지는 실패가 아니다 — 두 번 적재해도 종료 0", { skip }, async () => {
  const env = await setup({ [BATTER]: { fetchedAt: T_PITCHER } });
  try {
    for (const round of [1, 2]) {
      const r = load(env);
      assert.equal(r.code, 0, `${round}회째 종료 ${r.code}\n${r.err}`);
      assert.match(r.err, /실패 0명/);
    }
    const c = counts(env, BATTER);
    assert.ok(c.b > 0, "야수의 통산 타격 행이 없다");
    assert.equal(c.p, 0);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**표가 하나도 없는 페이지**(1군 기록이 아직 없는 선수 — 실물 미관측)는 실패로 세지 않지만 **조용히 넘기지도 않는다.**
 * 요약에 장수를 찍는다 — 「0건」과 「안 쟀음」을 가른다. 마크업이 통째로 바뀐 날에는 있던 선수 전원이
 * 위의 「있던 표가 0행」으로 실패하므로 거기서 운다.
 */
test("C8 · 통산 표가 하나도 없는 새 선수 페이지는 실패가 아니되 요약에 장수가 찍힌다", { skip }, async () => {
  const env = await setup({ [BATTER]: { fetchedAt: T_PITCHER } });
  try {
    await mutatePage(env, BATTER, (h) =>
      h.replace(/<li id="nav_b"[^>]*>[^<]*<\/li>/, "")
        .replace(/<div class="stats_table tab_unit" id="stats_b">[\s\S]*?<\/table>\s*<\/div>/, ""));
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(counts(env, BATTER), { b: 0, p: 0 });
    assert.match(r.err, /통산 표가 하나도 없는 페이지 1장/);
  } finally {
    await cleanup(env);
  }
});

// ─── N3 · 옛 판 선수 페이지가 더 새 프로필·통산을 덮지 못한다(감사 N3 · 설계 docs/superpowers/specs/2026-09-27-profile-version-guard-design.md §5 · §9-1) ───
//
// ⚠**운영에서 일어나는 길**(설계 §1-1): 「보관소에 올림」이 오늘 세대를 지운 뒤 실패하면 다음 실행이 **어제 세대 + 더 새 DB** 를
//   복원하고, 덧붙임 `archive-*.tar` 는 최신 세대 **위에** 풀린다. 경기 가드는 경기 폴더만 지킨다 — 선수 페이지는 판을 안 보고 덮었다.

const T_OLD = "2026-01-01T00:00:00.000Z";
const T_NEW = "2026-09-01T00:00:00.000Z";
const T_MID = "2026-08-20T00:00:00.000Z";
const T_LATER = "2026-09-10T00:00:00.000Z";
/** DB 가 가진 「더 새 판」의 표지 — 아카이브 본문과 다른 sha(소문자 hex 64자) */
const REV_Y = "b".repeat(64);

/** 선수 행 전체와 그 선수의 통산 행 전부 — 「DB 불변」을 이것으로 잰다 */
function snapshot(env: Env, id: string): { player: Record<string, unknown>; bat: unknown[]; pit: unknown[] } {
  const db = openDb(env.dbPath, NOW);
  try {
    return {
      player: { ...(db.raw.prepare("SELECT * FROM player WHERE player_id = ?").get(id) as Record<string, unknown>) },
      bat: (db.raw.prepare("SELECT * FROM career_batting WHERE player_id = ? ORDER BY seq").all(id) as Record<string, unknown>[]).map((r) => ({ ...r })),
      pit: (db.raw.prepare("SELECT * FROM career_pitching WHERE player_id = ? ORDER BY seq").all(id) as Record<string, unknown>[]).map((r) => ({ ...r })),
    };
  } finally {
    db.close();
  }
}

const realSha = async (id: string): Promise<string> => shaOf(gunzipSync(await readFile(join(PLAYERS, `${id}.html.gz`))));

/** 옛 판으로 바꾸는 변이 — 배번만 바꾼다(반증자 재현과 같다) */
const oldUniform = (h: string): string => h.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">OLD-NO</li>');

/**
 * ⚠**반증자 재현 그대로다**(2026-09-27 · 실물 `01005134`). 새 판(rev 2 · 2026-09-01)을 적재한 뒤 배번만 바꾼 옛 판
 * (rev 1 · 2026-01-01)을 적재하면 예전에는 **프로필 값 · `profile_fetched_at` · 통산 4행 `fetched_at` 이 전부 과거로** 갔고 종료 0 이었다.
 * ⚠옛 판의 사이드카 sha 는 옛 본문에 맞춘다 — 안 맞추면 `stale` 이 아니라 `unknown`(종료 1)으로 떨어진다(설계 §9-1).
 */
test("⚠N3 3-5 · 새 판 뒤에 배번만 바꾼 옛 판을 적재해도 프로필·판·통산이 안 되돌아간다 — 종료 0 · 목록 · ::warning::", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_NEW } });
  try {
    // 재취득 선정의 창 안에 둔다(출장 기록) — 없으면 「선정 밖이라 못 고침」이다(3중 검토 2차 m1 · 아래 따로 잰다)
    appear(env, PITCHER, "2026-08-16");
    await editSidecar(env, PITCHER, { revision: 2 });
    assert.equal(load(env).code, 0);
    const before = snapshot(env, PITCHER);
    assert.equal(before.player["uniform_number"], "34");
    assert.ok(before.bat.length > 0 && before.pit.length > 0, "통산 행이 없다 — 이 시험이 비교할 상대가 없다");

    await mutatePage(env, PITCHER, oldUniform);
    await editSidecar(env, PITCHER, { revision: 1, fetchedAt: T_OLD, checkedAt: undefined });
    const r = load(env);
    assert.equal(r.code, 0, `옛 판은 DB 를 지켰으니 종료 0 이다(설계 §5-5)\n${r.out}${r.err}`);
    assert.deepEqual(snapshot(env, PITCHER), before, "옛 판이 프로필·판·통산을 되돌렸다");
    assert.equal(before.player["profile_revision"], await realSha(PITCHER), "첫 적재가 적용 판을 안 채웠다");
    assert.match(r.out, /판 가드 — 처음 0 · 같은 본문 0 · 새 판 0 · 옛 판 건너뜀 1\(재취득 대상 1 · 부재라 못 고침 0 · 선정 밖이라 못 고침 0\) · 판 모름 건너뜀 0 · DB 시각 무효 0 · DB 에 없는 선수 0/);
    assert.match(r.out, /⚠아카이브가 DB 보다 옛 판인 선수 1명 — 적재하지 않았다\(DB 를 지켰다\)/);
    assert.match(r.out, new RegExp(`^ +${PITCHER}$`, "m"), "옛 판 선수 ID 를 찍지 않았다");
    assert.match(r.out, /^::warning::선수 페이지 1장이 DB 보다 옛 판이라 적재하지 않았다 — 재취득 대상 1 · 부재라 못 고침 0 · 선정 밖이라 못 고침 0 · 절차 docs\/operations\/deploy\.md §7-G$/m);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**같은 본문 · 이른 확인은 옛 판이 아니다** — 세대 복원이 같은 본문의 이른 사이드카를 되살린 모양이다. 시각만 비교하면
 * 거짓 옛 판(헛경보 · 헛재취득)이다. 시각은 **늦은 쪽**(DB)을 지킨다. 변이 「같은 sha 에서도 시각을 비교」가 이 시험을 붉게 만든다.
 */
test("⚠N3 3-6 · 같은 본문에 더 이른 확인 시각 — 종료 0 · 경고 없음 · profile_fetched_at 은 늦은 쪽 그대로", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_OLD, checkedAt: T_NEW } });
  try {
    assert.equal(load(env).code, 0);
    await editSidecar(env, PITCHER, { checkedAt: T_MID });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /::warning::/);
    assert.match(r.out, /같은 본문 1 · 새 판 0 · 옛 판 건너뜀 0/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["profile_fetched_at"], T_NEW, "같은 본문의 이른 확인이 시각을 되돌렸다");
    assert.ok(s.bat.every((row) => (row as { fetched_at: unknown }).fetched_at === T_NEW), "통산 행의 시각이 프로필과 갈렸다");
  } finally {
    await cleanup(env);
  }
});

test("N3 3-7 · 새 본문(다른 sha · 늦은 시각)은 적용된다 — 값 · 판 · 시각", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_MID } });
  try {
    assert.equal(load(env).code, 0);
    await mutatePage(env, PITCHER, (h) => h.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>'));
    await editSidecar(env, PITCHER, { fetchedAt: T_NEW });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /처음 0 · 같은 본문 0 · 새 판 1 · 옛 판 건너뜀 0/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99");
    assert.equal(s.player["profile_revision"], shaOf(gunzipSync(await readFile(pagePath(env, PITCHER)))));
    assert.equal(s.player["profile_fetched_at"], T_NEW);
    assert.ok(s.bat.every((row) => (row as { fetched_at: unknown }).fetched_at === T_NEW));
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**첫 실행이 기존 DB 값을 거짓 옛 판으로 막지 않는다**(G4). C7 이전 DB 는 `profile_fetched_at` 이 **적재 실행 시각**이라
 * 사이드카보다 언제나 늦다(실측 1,644/1,644 · 980/980). 적용 판이 NULL 이면 「처음」으로 보고 시각을 비교하지 않는다.
 * 변이 「first 에서도 시각 비교」가 이 시험을 붉게 만든다(전원 옛 판 · 그리고 건너뛰면 DB 가 안 바뀌어 **영구히** 그렇다).
 */
test("⚠N3 3-8 · 첫 실행 — DB 시각이 사이드카보다 늦어도(C7 이전 모양) 적용 판 NULL 이면 건너뛰지 않고 판을 채운다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_MID } });
  try {
    exec(env, "UPDATE player SET profile_fetched_at = ? WHERE player_id = ?", T_LATER, PITCHER);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /판 가드 — 처음 1 · 같은 본문 0 · 새 판 0 · 옛 판 건너뜀 0/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["profile_fetched_at"], T_MID, "시각이 사이드카 시각으로 바뀌지 않았다");
    assert.equal(s.player["profile_revision"], await realSha(PITCHER), "적용 판이 안 채워졌다");
  } finally {
    await cleanup(env);
  }
});

/**
 * DB 가 더 새 판(Y · T_NEW)을 가진 상태를 만든다 — 첫 적재로 값을 채운 뒤 판·시각을 **DB 쪽에서** 심는다(HTML 은 안 고친다).
 * 배번에 표지(`NEW-NO`)를 심어 「덮였는가」를 한 칸으로도 읽을 수 있게 한다.
 */
async function dbHasNewer(env: Env, id: string): Promise<void> {
  assert.equal(load(env).code, 0);
  // ⚠순서 기준선(`profile_content_at`)도 심는다 — 판정은 그것과 가른다(3중 검토 3차 P2)
  exec(env, "UPDATE player SET profile_revision = ?, profile_fetched_at = ?, profile_content_at = ?, uniform_number = 'NEW-NO' WHERE player_id = ?", REV_Y, T_NEW, T_NEW, id);
  exec(env, "UPDATE career_batting SET fetched_at = ? WHERE player_id = ?", T_NEW, id);
  exec(env, "UPDATE career_pitching SET fetched_at = ? WHERE player_id = ?", T_NEW, id);
}

const SELECTOR = fileURLToPath(new URL("../tools/emit-stale-player-ids.ts", import.meta.url));

/**
 * 그 선수가 **출장 기록**을 갖게 한다 — 치러진 경기 하나와 등판 한 줄. 재취득 선정의 창(`src/refetch-window.ts`)은 출장 기록이 있고
 * 마지막 출장일이 (가진 마지막 경기일 − 400일) 이후인 선수다 — 적재기는 그 창으로 옛 판을 「재취득 대상」과 「선정 밖이라 못 고침」으로
 * 가른다(3중 검토 2차 m1). ⚠경기 id 는 날짜·선수로 만든다 — 같은 날 두 선수를 두면 경기가 둘이다(창은 날짜만 본다).
 */
function appear(env: Env, id: string, date: string): void {
  const db = openDb(env.dbPath, NOW);
  try {
    const gameId = `e1-${date}-${id}`;
    upsertGame(db, {
      gameId, season: Number(date.slice(0, 4)), gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
    });
    upsertPitching(db, {
      gameId, playerId: id, side: "away", decision: null,
      outs: 3, bf: 4, pitches: 15, h: 1, hr: 0, bb: 0, hbp: 0, so: 1, runs: 0, er: 0, wp: 0, balk: 0,
    });
  } finally {
    db.close();
  }
}

/**
 * ⚠⚠**부재 구멍**(설계 §1-1 사실 3). 404 경로는 옛 본문을 그대로 두고 `checkedAt`·`absentAt` 을 「지금」으로 쓴다 —
 * 본 시각(`seenAtOf`)으로 순서를 가르면 **없어진 페이지의 옛 본문이 가장 새 판처럼 보여** DB 를 덮는다. 옛 사본을 다시 받게 하는
 * 재취득이 바로 그 시각을 올린다. 순서는 받은 시각(`fetchedAt`)으로 가른다. 변이 「순서에 seenAtOf」가 이 시험을 붉게 만든다.
 */
test("⚠⚠N3 3-9 · 부재(404) 사이드카의 옛 본문은 확인 시각이 늦어도 옛 판이다 — DB 불변 · (부재) · 부재라 못 고침", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_OLD } });
  try {
    await dbHasNewer(env, PITCHER);
    const before = snapshot(env, PITCHER);
    await editSidecar(env, PITCHER, { fetchedAt: T_OLD, checkedAt: T_LATER, absentAt: T_LATER, status: 404 });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(snapshot(env, PITCHER), before, "404 가 올린 시각으로 옛 본문이 새 판을 덮었다");
    // ⚠출장 기록이 없어도(선정 밖) 부재가 먼저다 — 다시 받아도 404 라는 것이 더 근본적인 이유다
    assert.match(r.out, /옛 판 건너뜀 1\(재취득 대상 0 · 부재라 못 고침 1 · 선정 밖이라 못 고침 0\)/);
    assert.match(r.out, new RegExp(`^ +${PITCHER}\\(부재\\)$`, "m"));
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠⚠**선정 밖이라 못 고침**(2026-09-27 · 3중 검토 2차 m1). 재취득 선정은 창(출장 기록이 있고 마지막 출장일이 가진 마지막 경기일 − 400일
 * 이후) 밖의 선수를 **어떤 사유로도** 안 뽑는다 — 그 선수의 옛 판은 저절로 안 풀리고 경고가 매 실행 남는다. 예전에는 그것을 「재취득 대상
 * (할 일 없음)」에 섞어 사람이 결함으로 못 읽었다. → 따로 센다. 창은 선정기와 **한 벌**이다(`src/refetch-window.ts` · M1) — 이 시험이
 * 선정기도 같이 돌려 두 쪽이 같은 선수를 같은 갈래로 보는지 잰다. 변이 「창을 안 본다」가 이 시험을 붉게 만든다.
 */
test("⚠⚠3중 검토 2차 m1 · 창 밖(출장 기록 없음 · 400일 밖) 옛 판은 「선정 밖이라 못 고침」 — 재취득 대상에 안 섞는다 · 선정기와 같은 창", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_NEW }, [BATTER]: { fetchedAt: T_NEW } });
  try {
    assert.equal(load(env).code, 0);
    // 창을 세우는 다른 선수의 최근 경기(가진 마지막 경기일 2026-08-16 → 선은 2025-07-12)
    const db = openDb(env.dbPath, NOW);
    try {
      upsertPlayer(db, "OTHER", "OTHER", NOW);
    } finally {
      db.close();
    }
    appear(env, "OTHER", "2026-08-16");
    appear(env, BATTER, "2024-05-01"); // 400일 밖 · PITCHER 는 출장 기록이 아예 없다
    const oldPage = (h: string): string => h.replace("</body>", "<!-- 옛 판 --></body>");
    for (const id of [PITCHER, BATTER]) {
      await mutatePage(env, id, oldPage);
      await editSidecar(env, id, { fetchedAt: T_OLD, checkedAt: undefined });
    }
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /옛 판 건너뜀 2\(재취득 대상 0 · 부재라 못 고침 0 · 선정 밖이라 못 고침 2\)/, r.out);
    assert.match(r.out, new RegExp(`^ +${BATTER}\\(선정 밖\\), ${PITCHER}\\(선정 밖\\)$`, "m"), r.out);
    assert.match(r.out, /^::warning::선수 페이지 2장이 DB 보다 옛 판이라 적재하지 않았다 — 재취득 대상 0 · 부재라 못 고침 0 · 선정 밖이라 못 고침 2 · /m);

    // 대조군 — BATTER 가 창 안에서 한 번 더 뛰면 재취득 대상이다(창을 보고 가른다는 증거). PITCHER 는 그대로 선정 밖
    appear(env, BATTER, "2026-08-15");
    const again = load(env);
    assert.equal(again.code, 0, again.out + again.err);
    assert.match(again.out, /옛 판 건너뜀 2\(재취득 대상 1 · 부재라 못 고침 0 · 선정 밖이라 못 고침 1\)/, again.out);
    assert.match(again.out, new RegExp(`^ +${BATTER}, ${PITCHER}\\(선정 밖\\)$`, "m"), again.out);
    // 선정기도 같은 창이다 — 재취득 대상(BATTER)은 뽑고 선정 밖(PITCHER)은 안 뽑고 센다
    const sel = select(env);
    assert.equal(sel.code, 0, sel.err);
    assert.ok(sel.ids.includes(BATTER), `적재기가 재취득 대상이라 부른 선수를 선정기가 안 뽑았다\n${sel.err}`);
    assert.ok(!sel.ids.includes(PITCHER), `선정 밖 선수를 뽑았다\n${sel.err}`);
    assert.match(sel.err, /아카이브 옛 판 1명\(부재라 제외 0 · 사이드카 못 읽음 0 · 선정 밖 1 · /, sel.err);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**무효 부재 표시는 「부재 아님」이 아니다**(2026-09-27 콜드 리뷰 P2). 「부재 아님」으로 읽으면 늦은 `checkedAt` 으로 순서가
 * 매겨져 옛 본문이 새 판을 덮는다 — 순서를 **모른다**(unknown · 종료 1 · fail-closed). 같은 본문이면 순서가 필요 없어 쓴다.
 * 변이 「무효를 부재 아님으로」가 이 시험을 붉게 만든다.
 */
test("⚠N3 3-9b · 부재 표시(absentAt)가 무효면 다른 본문은 판 모름(종료 1 · VERSION UNKNOWN · 불변) · 같은 본문은 쓴다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_OLD } });
  try {
    await dbHasNewer(env, PITCHER);
    const before = snapshot(env, PITCHER);
    await editSidecar(env, PITCHER, { fetchedAt: T_OLD, checkedAt: T_LATER, absentAt: "not-a-date" });
    const r = load(env);
    assert.equal(r.code, 1, `순서를 모르는데 종료 ${r.code} 다\n${r.out}${r.err}`);
    assert.match(r.err, new RegExp(`VERSION UNKNOWN ${PITCHER} — absentAt 무효`));
    assert.match(r.out, /판 모름 건너뜀 1/);
    assert.deepEqual(snapshot(env, PITCHER), before, "무효 부재 표시에서 DB 를 덮었다");

    // 같은 본문(sha = 적용 판)이면 순서가 필요 없다 — 3번 same 으로 쓴다
    exec(env, "UPDATE player SET profile_revision = ? WHERE player_id = ?", await realSha(PITCHER), PITCHER);
    const same = load(env);
    assert.equal(same.code, 0, same.out + same.err);
    assert.match(same.out, /같은 본문 1/);
    assert.equal(snapshot(env, PITCHER).player["uniform_number"], "34", "같은 본문을 지금 파서로 다시 읽지 않았다");
  } finally {
    await cleanup(env);
  }
});

/** 부재여도 **같은 본문**이면 판이 같다 — 확인을 받은 뒤 페이지가 사라진 모양(내용 그대로). 시각은 늦은 쪽(지금 동작과 같은 값) */
test("N3 3-10 · 부재 · 같은 본문 — same · 경고 없음 · 시각은 늦은 쪽", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_OLD } });
  try {
    assert.equal(load(env).code, 0);
    await editSidecar(env, PITCHER, { fetchedAt: T_OLD, checkedAt: T_LATER, absentAt: T_LATER, status: 404 });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /::warning::/);
    assert.match(r.out, /같은 본문 1 · 새 판 0 · 옛 판 건너뜀 0/);
    assert.equal(snapshot(env, PITCHER).player["profile_fetched_at"], T_LATER);
  } finally {
    await cleanup(env);
  }
});

/** 사이드카가 없어 **다른 본문**의 시각을 모른다 — 순서를 몰라 건너뛴다(종료 1). 다음 실행의 신규 선수 단계가 사이드카를 새로 쓴다 */
test("⚠N3 3-11 · 판 모름 — DB 판 Y · 아카이브는 다른 본문 + 사이드카 없음 → 종료 1 · VERSION UNKNOWN · DB 불변", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_OLD } });
  try {
    await dbHasNewer(env, PITCHER);
    const before = snapshot(env, PITCHER);
    await rm(metaPath(env, PITCHER));
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, new RegExp(`VERSION UNKNOWN ${PITCHER} — 사이드카 없음`));
    assert.deepEqual(snapshot(env, PITCHER), before);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**읽는 법 커버리지의 분모에서 건너뛴 선수를 뺀다** — 안 빼면 옛 판을 많이 건너뛴 날 분자만 줄어 **거짓 커버리지 실패**(종료 1)가 난다.
 * 여기서는 2장 중 1장(옛 판)을 건너뛰어, 뺐으면 1/1 = 100% · 안 뺐으면 1/2 = 50% < 90% 다.
 * 변이 「분모를 files.length 로 되돌림」이 이 시험을 붉게 만든다.
 */
test("⚠N3 3-13 · 옛 판 1명 + 정상 1명 — 커버리지 경고 없음 · 종료 0", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_NEW }, [BATTER]: { fetchedAt: T_NEW } });
  try {
    assert.equal(load(env).code, 0);
    await mutatePage(env, PITCHER, oldUniform);
    await editSidecar(env, PITCHER, { fetchedAt: T_OLD });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /옛 판 건너뜀 1/);
    assert.doesNotMatch(r.err, /읽는 법 커버리지/);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠DB 의 순서 기준선이 무효면 판을 비교할 수 없다 — 건너뛰고 실패(fail-closed · 경기 가드와 같다).
 * ⚠칸에 모양 CHECK 가 있어 `not-a-date` 는 못 들어간다 — **모양만 맞고 달력상 무효**인 값을 심는다(3중 검토 3차 반영).
 */
test("⚠N3 3-14 · DB 순서 기준선(profile_content_at) 무효 · 다른 본문 — 종료 1 · DB VERSION INVALID · 불변", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_MID } });
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE player SET profile_content_at = '2026-19-39T29:59:59.999Z' WHERE player_id = ?", PITCHER);
    const before = snapshot(env, PITCHER);
    await mutatePage(env, PITCHER, oldUniform);
    const r = load(env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.ok(r.err.includes(`DB VERSION INVALID ${PITCHER} — 2026-19-39T29:59:59.999Z`), r.err);
    assert.match(r.out, /DB 시각 무효 1/);
    assert.deepEqual(snapshot(env, PITCHER), before);
  } finally {
    await cleanup(env);
  }
});

/** ⚠**표시 시각(`profile_fetched_at`)이 무효여도 막지 않는다** — 순서는 순서 칸으로 가른다(3중 검토 3차 반영 · 표시 칸에는 CHECK 가 없다) */
test("N3 3-14′ · 표시 시각만 무효 · 더 새 본문 — 새 판으로 받고 표시 시각을 본 시각으로 덮는다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_MID } });
  try {
    assert.equal(load(env).code, 0);
    exec(env, "UPDATE player SET profile_fetched_at = 'not-a-date' WHERE player_id = ?", PITCHER);
    await mutatePage(env, PITCHER, (h) => h.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>'));
    await editSidecar(env, PITCHER, { fetchedAt: T_NEW });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /새 판 1 · 옛 판 건너뜀 0/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99");
    assert.equal(s.player["profile_fetched_at"], T_NEW);
    assert.equal(s.player["profile_content_at"], T_NEW);
  } finally {
    await cleanup(env);
  }
});

// ─── 3중 검토 3차 P2 · 404 확인 시각이 순서 기준선을 끌어올리지 않는다(2026-09-27) ───
//
// ⚠**`same` 이 쓰는 표시 시각(`profile_fetched_at` = 늦은 쪽)을 다른 본문의 순서 기준선으로 다시 쓰고 있었다.** 404 는 옛 본문을
//   그대로 두고 `checkedAt` 을 「지금」으로 올리므로, 같은 본문의 404 를 한 번 적재하면 표시 시각이 404 확인 시각이 되고 —
//   그 뒤 **실제로 더 새** 본문(그 사이에 받은 것)이 복원돼도 「DB 보다 이르다」로 버려졌다(종료 0 · 옛 값 남음).
//   → 순서 전용 칸 `profile_content_at`(내용 시각)을 두고 그것과만 가른다. 404 는 `contentTime`=받은 시각이라 올리지 않는다.

const T1 = "2026-09-01T00:00:00.000Z"; // A 를 받은 시각
const T2 = "2026-09-02T00:00:00.000Z"; // B(더 새 본문)를 받은 시각
const T3 = "2026-09-03T00:00:00.000Z"; // A 가 404 로 확인된 시각
const T4 = "2026-09-04T00:00:00.000Z"; // B 가 404 로 확인된 시각

/**
 * **실제 `archivePlayer` 의 404 경로**로 사이드카를 쓴다(3차 검토의 재현과 같은 모양 · 외부 요청 0 — 가짜 응답이다).
 * ⚠손으로 사이드카를 지어내지 않는다 — 404 경로가 무엇을 남기는지(옛 sha·fetchedAt 유지 · checkedAt=absentAt=지금)가 곧 이 결함의 원인이다.
 */
async function recordAbsent(env: Env, id: string, at: string): Promise<void> {
  const clock = { now: () => new Date(at) };
  const fetcher = new PoliteFetcher({
    userAgent: "bb-app-test",
    clock,
    fetchImpl: async () => ({ status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }),
    sleep: async () => undefined,
  });
  const r = await archivePlayer(id, { fetcher, sink: new LocalSink(env.archive), clock });
  assert.equal(r.outcome, "absent", `404 경로를 안 탔다: ${JSON.stringify(r)}`);
}

/** 지금 임시 아카이브의 본문·사이드카 한 벌 */
async function pair(env: Env, id: string): Promise<{ body: Buffer; meta: string }> {
  return { body: await readFile(pagePath(env, id)), meta: await readFile(metaPath(env, id), "utf8") };
}
async function putPair(env: Env, id: string, p: { body: Buffer; meta: string }): Promise<void> {
  await writeFile(pagePath(env, id), p.body);
  await writeFile(metaPath(env, id), p.meta);
}

/** A(34 · t1) 를 적재하고, 더 새 B(99 · t2)를 따로 보관한 뒤 아카이브를 A 로 돌려 둔다 */
async function loadAKeepB(env: Env): Promise<{ a: { body: Buffer; meta: string }; b: { body: Buffer; meta: string } }> {
  assert.equal(load(env).code, 0);
  const a = await pair(env, PITCHER);
  await mutatePage(env, PITCHER, (h) => h.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>'));
  await editSidecar(env, PITCHER, { fetchedAt: T2, checkedAt: T2, revision: 2 });
  const b = await pair(env, PITCHER);
  await putPair(env, PITCHER, a);
  return { a, b };
}

test("⚠3중 검토 3차 P2 · A(t1) → A 의 404(t3) → 더 새 B(t2) 복원 — B 가 적용되고 재적재는 같은 본문 · 전 행 불변 · 404 는 순서 기준선을 안 올린다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T1 } });
  try {
    const { b } = await loadAKeepB(env);
    await recordAbsent(env, PITCHER, T3);
    const absent = load(env);
    assert.equal(absent.code, 0, absent.out + absent.err);
    assert.match(absent.out, /같은 본문 1/);

    await putPair(env, PITCHER, b);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99", `더 새 B 가 옛 판으로 버려졌다 — 404 확인 시각(t3)이 순서 기준선이 됐다\n${r.out}`);
    assert.match(r.out, /새 판 1 · 옛 판 건너뜀 0/);
    assert.equal(s.player["profile_revision"], shaOf(gunzipSync(b.body)));
    assert.equal(s.player["profile_fetched_at"], T2);
    assert.equal(s.player["profile_content_at"], T2);
    assert.ok(s.bat.every((row) => (row as { fetched_at: unknown }).fetched_at === T2), "통산 행이 B 의 시각이 아니다");

    const again = load(env);
    assert.equal(again.code, 0, again.out + again.err);
    assert.match(again.out, /같은 본문 1/);
    assert.deepEqual(snapshot(env, PITCHER), s, "같은 본문을 다시 적재했더니 행이 바뀌었다");
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**404 로 `same` 을 적재해도 순서 기준선은 그대로다** — 표시 시각(`profile_fetched_at`)은 지금처럼 늦은 쪽(404 확인 시각)이다
 * (쓰는 규칙은 바꾸지 않았다 · `career-lag` · 화면의 取得 날짜 · 설계 §5-7). 변이 「순서에 profile_fetched_at」이 위 시험을 붉게 만든다.
 */
test("⚠3중 검토 3차 · 같은 본문의 404 적재 — profile_fetched_at 은 404 확인 시각 · profile_content_at 은 받은 시각 그대로", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T1 } });
  try {
    assert.equal(load(env).code, 0);
    await recordAbsent(env, PITCHER, T3);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /같은 본문 1/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["profile_fetched_at"], T3, "표시 시각의 쓰는 규칙이 바뀌었다(늦은 쪽이어야 한다)");
    assert.equal(s.player["profile_content_at"], T1, "404 확인이 순서 기준선을 올렸다");
  } finally {
    await cleanup(env);
  }
});

/** B 도 그 뒤 404 로 확인된 변형(3차 검토 요청) — B 의 순서 시각은 받은 시각(t2)이라 t1 보다 새것이다 */
test("⚠3중 검토 3차 · B 의 사이드카에도 뒤에 404(t4)가 기록된 변형 — 그래도 B 가 적용된다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T1 } });
  try {
    const { b } = await loadAKeepB(env);
    await recordAbsent(env, PITCHER, T3);
    assert.equal(load(env).code, 0);
    await putPair(env, PITCHER, b);
    await recordAbsent(env, PITCHER, T4);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99", `B(부재 중 · 받은 시각 t2)가 옛 판으로 버려졌다\n${r.out}`);
    assert.equal(s.player["profile_content_at"], T2, "순서 기준선이 B 의 받은 시각이 아니다");
    assert.equal(s.player["profile_fetched_at"], T4, "표시 시각은 본 시각(404 확인)이다 — 쓰는 규칙 그대로");
  } finally {
    await cleanup(env);
  }
});

// ─── 반영분 재검토 P2 · 기준선 없는 행 — 기본은 판 모름 · 이번 실행 200 증명 · 같은 sha 복구(2026-09-27) ───
//
// ⚠**기준선 NULL 을 무조건 새 판으로 받던 것을 버렸다.** 복원된 옛 사본도 「다른 본문」이라 그대로 받아 DB 를 되돌렸고, 출장 기록이 없는
//   선수는 선정도 못 뽑아 경고조차 한 번뿐이었다(재검토자 재현). 기본은 **판 모름(종료 1 · 전 행 불변)** 이고, 풀리는 길은 둘이다:
//   ⑴ 같은 sha 정상 사본 → 3번 `same` 이 기준선을 채운다 · ⑵ **이번 실행에서 받은 200**(사이드카가 부재가 아니고 본 시각 ≥ 실행 시작)
//   → 상류의 지금 내용이라 새 판으로 받는다. 실행 시작은 `update.ts` 가 `--run-started-at` 으로 넘긴다(주입된 시계 · 단독 실행이면 증명 없음).

/** 이번 실행의 시작 — 그 앞은 「복원된 사본」, 그 뒤는 「이번 실행에 받은 것」 */
const RUN_START = "2026-09-27T01:00:00.000Z";
const RUN_BEFORE = "2026-09-27T00:59:59.999Z";
const RUN_AFTER = "2026-09-27T01:03:00.000Z";

/** 사이드카 없이 처음 적재해 **기준선 없는 행**을 만든다(판은 실물 본문 · 두 시각 NULL — C7) */
async function noBaselineRow(env: Env): Promise<ReturnType<typeof snapshot>> {
  const first = load(env, ["--run-started-at", RUN_START]);
  assert.equal(first.code, 0, first.out + first.err);
  const s = snapshot(env, PITCHER);
  assert.equal(s.player["profile_revision"], await realSha(PITCHER), "첫 적재가 판을 안 채웠다");
  assert.equal(s.player["profile_content_at"], null, "모르는 내용 시각을 채웠다(M11)");
  assert.equal(s.player["profile_fetched_at"], null);
  return s;
}

/** 아카이브에 `html` 본문과 그 본문을 말하는 사이드카(실물 사이드카에서 시각만 바꿈)를 둔다 */
async function putDescribed(env: Env, html: string, times: Record<string, unknown>): Promise<void> {
  const bytes = Buffer.from(html, "utf8");
  await writeFile(pagePath(env, PITCHER), gzipSync(bytes));
  await copyFile(join(PLAYERS, `${PITCHER}.meta.json`), metaPath(env, PITCHER));
  await editSidecar(env, PITCHER, { sha256: shaOf(bytes), checkedAt: undefined, absentAt: undefined, ...times });
}

const originalHtml = async (): Promise<string> => gunzipSync(await readFile(join(PLAYERS, `${PITCHER}.html.gz`))).toString("utf8");

/**
 * ⚠⚠**재검토자 재현 그대로다** — B(배번 99)를 사이드카 없이 처음 적재(판 B · 두 시각 NULL) · 출장 기록 없는 선수 · 옛 A/A(34 · 과거 시각) 복원.
 * 예전에는 선정 0명 · 적재가 A 를 새 판으로 받아 99 → 34 · 다음 실행은 같은 본문이라 경고도 없었다.
 * 이제 판 모름 · 종료 1 · 프로필·통산·판 **전건 불변** — 반복해도 그대로다. 선정은 「기준선 없음 · 선정 밖」으로 센다.
 * 변이 「기준선 NULL 을 무조건 newer」가 이 시험을 붉게 만든다.
 */
test("⚠⚠반영분 재검토 P2 · 재검토자 재현 — 기준선 없는 B 위에 옛 A/A 복원 → 판 모름 · 종료 1 · 전 행 불변(반복해도) · 선정은 선정 밖", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    const a = await originalHtml();
    await writeFile(pagePath(env, PITCHER), gzipSync(Buffer.from(a.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>'), "utf8")));
    const first = load(env, ["--run-started-at", RUN_START]);
    assert.equal(first.code, 0, first.out + first.err);
    const withB = snapshot(env, PITCHER);
    assert.equal(withB.player["uniform_number"], "99");
    assert.equal(withB.player["profile_content_at"], null);

    await putDescribed(env, a, { fetchedAt: T_OLD });
    for (const round of [1, 2]) {
      const r = load(env, ["--run-started-at", RUN_START]);
      assert.deepEqual(snapshot(env, PITCHER), withB, `${round}회째 — 옛 A 가 기준선 없는 B 를 되돌렸다\n${r.out}`);
      assert.equal(r.code, 1, `${round}회째 — 순서를 모르는데 종료 ${r.code} 다\n${r.out}${r.err}`);
      assert.match(r.err, new RegExp(`VERSION UNKNOWN ${PITCHER} — 순서 기준선\\(profile_content_at\\)이 없다`));
      assert.match(r.out, /판 모름 건너뜀 1/);
    }
    // 선정기 — 출장 기록이 없어 뽑을 수 없다(선정 밖) · 조용히 넘기지 않고 센다
    const sel = select(env);
    assert.equal(sel.code, 0, sel.err);
    assert.ok(!sel.ids.includes(PITCHER));
    assert.match(sel.err, /기준선 없음 0명\(부재라 제외 0 · 선정 밖 1 · 출력분 중 0\)/, sel.err);
  } finally {
    await cleanup(env);
  }
});

/** 복구 경로 ⑴ — 같은 sha 정상 사본이 오면 3번 `same` 이 기준선을 채운다(증명 없이도 · 단독 실행이어도). 그 뒤 옛 판은 옛 판으로 막힌다 */
test("반영분 재검토 P2 · 복구 ⑴ — 기준선 없는 행에 같은 sha 정상 사본 → same · 기준선이 채워진다 · 그 뒤 옛 판은 옛 판", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    await noBaselineRow(env);
    await putDescribed(env, await originalHtml(), { fetchedAt: T_MID });
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /같은 본문 1/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["profile_content_at"], T_MID, "같은 본문이 기준선을 안 채웠다");
    // 기준선이 섰으니 옛 판은 이제 옛 판이다(DB 를 지킨다 · 종료 0)
    await putDescribed(env, oldUniform(await originalHtml()), { fetchedAt: T_OLD });
    const old = load(env);
    assert.equal(old.code, 0, old.out + old.err);
    assert.match(old.out, /옛 판 건너뜀 1/);
    assert.deepEqual(snapshot(env, PITCHER), s);
  } finally {
    await cleanup(env);
  }
});

/**
 * 복구 경로 ⑵ — **이번 실행에서 받은 200**(본 시각 ≥ 실행 시작)이면 기준선 없는 행도 새 판으로 받고 따로 찍는다(종료 0 · 기준선이 선다).
 * 실행 시작보다 이르면(복원된 사본) 판 모름 · 단독 실행(인자 없음)이면 증명이 없어 판 모름이다.
 */
test("⚠반영분 재검토 P2 · 복구 ⑵ — 이번 실행 200(본 시각 ≥ 실행 시작)은 새 판 · 이전 시각·단독 실행은 판 모름", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    const s0 = await noBaselineRow(env);
    const b = (await originalHtml()).replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>');
    // 실행 시작보다 1ms 이르다 — 증명이 아니다
    await putDescribed(env, b, { fetchedAt: RUN_BEFORE });
    const before = load(env, ["--run-started-at", RUN_START]);
    assert.equal(before.code, 1, before.out + before.err);
    assert.deepEqual(snapshot(env, PITCHER), s0);
    // 이번 실행에 받았지만 실행 시작을 모른다(단독 실행) — 증명이 아니다
    await putDescribed(env, b, { fetchedAt: RUN_AFTER });
    const alone = load(env);
    assert.equal(alone.code, 1, alone.out + alone.err);
    assert.match(alone.err, /--run-started-at/);
    assert.deepEqual(snapshot(env, PITCHER), s0);
    // 이번 실행에 받았다 — 새 판 · 따로 찍는다 · 기준선이 선다
    const r = load(env, ["--run-started-at", RUN_START]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /새 판 1 · 옛 판 건너뜀 0/);
    assert.match(r.out, new RegExp(`⚠순서 기준선\\(profile_content_at\\)이 없었는데 이번 실행에서 받은 판이라 새 판으로 받은 선수 1명 — ${PITCHER}`));
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99");
    assert.equal(s.player["profile_content_at"], RUN_AFTER, "새 판의 내용 시각이 기준선이 되지 않았다");
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠복구 경로 ⑵ **종단** — 창 안의 기준선 없는 행에 옛 사본이 복원돼 판 모름(종료 1)이 된 뒤, **같은 실행**의 선정이 「기준선 없음」으로 뽑고 →
 * 실제 `archivePlayer` 가 상류(= DB 가 가진 판)를 **이번 실행에** 받아 저장 → 적재는 같은 본문 · 기준선이 선다(종료 0). 외부 요청 0(가짜 응답).
 * ⚠이 모양(사이드카 없는 첫 적재)은 통산 `fetched_at` 도 NULL 이라 **「취득기록 없음」으로도 뽑힌다**(C7 · M11) — 선정 사유 「기준선 없음」 자체는
 *   `stale-players.test.ts` 가 따로 잰다(통산 시각이 있어 평소 사유로는 안 뽑히는 행 · 변이 「후보 목록에서 뺌」이 거기서 붉어진다).
 */
test("⚠반영분 재검토 P2 · 복구 ⑵ 종단 — 선정이 기준선 없는 행을 뽑고 이번 실행에 다시 받으면 같은 실행에서 풀린다", { skip }, async () => {
  const env = await setup({ [PITCHER]: null });
  try {
    await noBaselineRow(env);
    const year = q<{ y: number | null }>(env, "SELECT MAX(year) AS y FROM career_pitching WHERE player_id = ? AND games > 0", PITCHER).y;
    assert.ok(year !== null, "픽스처 투수에게 등판 기록이 있는 해가 없다");
    appear(env, PITCHER, `${year}-08-16`);
    await putDescribed(env, oldUniform(await originalHtml()), { fetchedAt: T_OLD });
    const blocked = load(env, ["--run-started-at", RUN_START]);
    assert.equal(blocked.code, 1, blocked.out + blocked.err);

    const sel = select(env);
    assert.equal(sel.code, 0, sel.err);
    assert.ok(sel.ids.includes(PITCHER), `기준선 없는 행을 안 뽑았다 — 같은 실행에서 안 풀린다\n${sel.err}`);
    assert.match(sel.err, /기준선 없음 1명\(부재라 제외 0 · 선정 밖 0 · 출력분 중 1\)/, sel.err);

    const r = await refetch(env, PITCHER, gunzipSync(await readFile(join(PLAYERS, `${PITCHER}.html.gz`))), RUN_AFTER);
    assert.equal(r.outcome, "stored", JSON.stringify(r));
    const healed = load(env, ["--run-started-at", RUN_START]);
    assert.equal(healed.code, 0, healed.out + healed.err);
    assert.match(healed.out, /같은 본문 1/);
    assert.equal(snapshot(env, PITCHER).player["profile_content_at"], RUN_AFTER, "같은 본문이 기준선을 안 채웠다");
    assert.equal(snapshot(env, PITCHER).player["uniform_number"], "34");
  } finally {
    await cleanup(env);
  }
});

/** 인자가 틀리면 아무것도 안 하고 종료 2 — 모르는 실행 시작으로 증명을 만들지 않는다 */
test("반영분 재검토 P2 · --run-started-at 이 없거나 시각이 아니면 종료 2 · DB 불변", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_MID } });
  try {
    assert.equal(load(env).code, 0);
    const before = snapshot(env, PITCHER);
    for (const bad of [["--run-started-at"], ["--run-started-at", "not-a-date"], ["--run-started-at", "2026-09-27T01:00:00"], ["--run-started-at", "--x"]]) {
      const r = load(env, bad);
      assert.equal(r.code, 2, `${bad.join(" ")} → 종료 ${r.code}\n${r.out}${r.err}`);
      assert.match(r.err, /--run-started-at/);
    }
    assert.deepEqual(snapshot(env, PITCHER), before);
  } finally {
    await cleanup(env);
  }
});

/** 대조군 — 404 단계 없이 A(t1) → B(t2) 면 예나 지금이나 B 가 새 판이다(3차 검토의 대조군) */
test("3중 검토 3차 · 대조군 — 404 없이 A(t1) → B(t2) 는 새 판으로 적용된다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T1 } });
  try {
    const { b } = await loadAKeepB(env);
    await putPair(env, PITCHER, b);
    const r = load(env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /새 판 1/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "99");
    assert.equal(s.player["profile_fetched_at"], T2);
  } finally {
    await cleanup(env);
  }
});

// ─── 3중 검토 2차 F1 · 짝 불일치(본문만 새것 · 사이드카는 옛것)가 같은 실행에서 풀린다(2026-09-27) ───
//
// ⚠**2차 검토 E1 의 재현 그대로다** — 적용한 페이지의 **본문만** 바꾸고(배번 34 → 99) 사이드카는 그대로 두면, 적재기는 그 본문의
//   시각을 몰라 **판 모름(종료 1)** 으로 건너뛴다. 그런데 옛 판 선정은 사이드카만 봐서 「같은 판」으로 읽고 안 뽑았고, 뽑혀도 아카이버는
//   상류가 사이드카와 같으면 「봤다」만 남겼다 — **본문이 영영 안 고쳐져 매 실행 배포가 막혔다.**
//   → 선정기가 짝을 보고 뽑는다(`localBodyIntact`) → 아카이버가 받은 바이트로 본문을 되살린다(revision 불변) → 적재기는 같은 본문이다.

function select(env: Env): { code: number; ids: string[]; err: string } {
  const r = spawnSync(process.execPath, [SELECTOR, env.dbPath, "--limit", "400", "--archive", env.archive], { encoding: "utf8" });
  return { code: r.status ?? 1, ids: r.stdout.split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== ""), err: r.stderr };
}

/** 상류가 `bytes` 를 준다고 치고 **실제 `archivePlayer`** 로 받는다(외부 요청 0 — 가짜 응답이다 · 검증자 없음은 상류 실측과 같다) */
async function refetch(env: Env, id: string, bytes: Uint8Array, at: string) {
  const clock = { now: () => new Date(at) };
  const fetcher = new PoliteFetcher({
    userAgent: "bb-app-test",
    clock,
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    }),
    sleep: async () => undefined,
  });
  return archivePlayer(id, { fetcher, sink: new LocalSink(env.archive), clock });
}

test("⚠⚠3중 검토 2차 F1 · E1(본문만 바뀜 · 사이드카 그대로)이 같은 실행에서 풀린다 — 선정기가 뽑고 · 아카이버가 되살리고 · 적재기는 같은 본문 · 종료 0", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T1 } });
  try {
    assert.equal(load(env).code, 0);
    const applied = snapshot(env, PITCHER);
    // 통산이 실린 해에 한 경기를 둬 선정의 창 안에 둔다 — 그 해 공표 등판이 우리(1경기)보다 많아 「출장량 부족」으로는 안 뽑힌다
    const year = q<{ y: number | null }>(env, "SELECT MAX(year) AS y FROM career_pitching WHERE player_id = ? AND games > 0", PITCHER).y;
    assert.ok(year !== null, "픽스처 투수에게 등판 기록이 있는 해가 없다 — 이 시험이 설 자리가 없다");
    appear(env, PITCHER, `${year}-08-16`);
    // 대조군 — 짝이 맞으면 어떤 사유로도 안 뽑힌다(아래에서 뽑히면 이유는 짝 불일치뿐이다)
    const before = select(env);
    assert.equal(before.code, 0, before.err);
    assert.ok(!before.ids.includes(PITCHER), `짝이 맞는데 뽑혔다 — 이 시험이 짝 불일치를 재지 못한다\n${before.err}`);

    // E1 — 본문만 바꾼다(사이드카는 그대로 · `mutatePage` 는 sha 를 맞추므로 쓰지 않는다)
    const original = gunzipSync(await readFile(pagePath(env, PITCHER)));
    const next = original.toString("utf8").replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>');
    assert.notEqual(next, original.toString("utf8"), "변이가 페이지를 바꾸지 않았다");
    await writeFile(pagePath(env, PITCHER), gzipSync(Buffer.from(next, "utf8")));
    const blocked = load(env);
    assert.equal(blocked.code, 1, `E1 이 재현되지 않았다\n${blocked.out}${blocked.err}`);
    assert.match(blocked.err, new RegExp(`VERSION UNKNOWN ${PITCHER} — 본문 sha256 이 사이드카와 다르다`));

    // ① 선정기가 뽑는다(같은 실행 · 적재 전)
    const sel = select(env);
    assert.equal(sel.code, 0, sel.err);
    assert.ok(sel.ids.includes(PITCHER), `짝 불일치를 안 뽑았다 — 다시 받을 길이 없어 영구히 막힌다\n${sel.err}`);
    assert.match(sel.err, /짝 불일치 1명\(부재라 제외 0 · 선정 밖 0 · 출력분 중 1\)/);

    // ② 아카이버 — 상류는 사이드카가 말하는 그 바이트다(내용이 안 바뀌었다) · 본문을 되살리고 revision 은 그대로
    const sidecarBefore = JSON.parse(await readFile(metaPath(env, PITCHER), "utf8")) as { revision: number; fetchedAt: string };
    const HEAL_AT = "2026-09-27T03:00:00.000Z";
    const r = await refetch(env, PITCHER, original, HEAL_AT);
    assert.equal(r.outcome, "unchanged", JSON.stringify(r));
    assert.equal(r.repair, "rewritten", `본문을 되살리지 않았다\n${JSON.stringify(r)}`);
    assert.deepEqual(gunzipSync(await readFile(pagePath(env, PITCHER))), original, "로컬 본문이 사이드카가 말하는 바이트가 아니다");
    const sidecarAfter = JSON.parse(await readFile(metaPath(env, PITCHER), "utf8")) as { revision: number; fetchedAt: string };
    assert.equal(sidecarAfter.revision, sidecarBefore.revision, "내용이 안 바뀌었는데 revision 을 올렸다(M5)");
    assert.equal(sidecarAfter.fetchedAt, sidecarBefore.fetchedAt);

    // ③ 적재기 — 같은 본문 · 종료 0 · 값은 적용한 그대로(배번 34)
    const healed = load(env);
    assert.equal(healed.code, 0, `같은 실행에서 안 풀렸다\n${healed.out}${healed.err}`);
    assert.match(healed.out, /같은 본문 1 · 새 판 0 · 옛 판 건너뜀 0/);
    assert.match(healed.out, /판 모름 건너뜀 0/);
    const s = snapshot(env, PITCHER);
    assert.equal(s.player["uniform_number"], "34");
    assert.equal(s.player["profile_revision"], applied.player["profile_revision"]);
    // ⚠두 시각이 확인 시각(HEAL_AT)으로 오르는 것은 되살리기 때문이 아니라 **「봤다」** 때문이다 — 같은 본문을 200 으로 다시 확인했으니
    //   그 내용은 그때까지 최신이었다(`contentTimeOf` = 본 시각 · 부재 아님). 되살리지 않는 보통의 「변경없음」도 같은 값을 낸다
    assert.equal(s.player["profile_fetched_at"], HEAL_AT);
    assert.equal(s.player["profile_content_at"], HEAL_AT);
    // 다음 선정에서는 안 뽑힌다(매일 헛요청이 되지 않는다 · L1)
    const after = select(env);
    assert.ok(!after.ids.includes(PITCHER), `되살린 뒤에도 뽑혔다\n${after.err}`);
  } finally {
    await cleanup(env);
  }
});

// ─── 반영분 재검토 P2 · 겹친 작성자 — 되살리기가 새 판을 덮어도 적재는 옛 판으로 막는다(2026-09-27) ───

const RACE_T0 = "2026-09-20T00:00:00.000Z"; // A 를 처음 받은 시각
const RACE_T1 = "2026-09-27T03:00:00.000Z"; // 첫 수집기가 A 를 다시 받은 시각
const RACE_T2 = "2026-09-27T03:00:05.000Z"; // 겹친 작성자가 새 판 B 를 받은 시각(DB 에도 B)
const RACE_T3 = "2026-09-27T03:00:09.000Z"; // 첫 수집기가 기록하는 시각(늦다)

/**
 * ⚠⚠**재확인과 쓰기 사이의 좁은 창**(아카이버의 비교-후-쓰기가 못 닫는 창 · 설계 §12)에서 겹친 작성자가 새 판 B(t2)를 쓰고 첫 수집기가
 * 옛 A 로 덮는다. 그래도 A 의 시각은 **받은 시각 t1** 이라 DB 의 B(t2)보다 이르다 → 적재는 **옛 판**으로 건너뛰어 DB 를 지킨다.
 * 예전에는 기록할 때 읽은 t3 이 붙어 A 가 **새 판**으로 적용됐다(조용한 되돌림 · 재검토자 재현).
 * 실제 `archivePlayer` · 실제 `LocalSink` · 실제 적재기다(외부 요청 0 — 가짜 응답). 변이 「되살리기가 시계를 뒤에서 읽음」이 이 시험을 붉게 만든다.
 */
test("⚠⚠반영분 재검토 P2 · 되살리기가 겹친 작성자의 새 판 B 를 덮어도 A 의 시각은 받은 시각 — 적재는 옛 판 · DB 는 B 그대로", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: RACE_T0 } });
  try {
    const aBytes = gunzipSync(await readFile(pagePath(env, PITCHER)));
    const aMeta = await readFile(metaPath(env, PITCHER), "utf8");
    // ① DB 에 새 판 B(배번 99 · t2)를 적용해 둔다
    await mutatePage(env, PITCHER, (h) => h.replace('<li id="pc_v_no">34</li>', '<li id="pc_v_no">99</li>'));
    await editSidecar(env, PITCHER, { fetchedAt: RACE_T2, checkedAt: RACE_T2, revision: 2 });
    const b = await pair(env, PITCHER);
    assert.equal(load(env).code, 0);
    const withB = snapshot(env, PITCHER);
    assert.equal(withB.player["uniform_number"], "99");
    // ② 아카이브를 짝 불일치(깨진 본문 · 사이드카 A)로 둔다 — 첫 수집기는 상류 A 를 받아 본문을 되살리려 한다
    await writeFile(pagePath(env, PITCHER), gzipSync(Buffer.from("<html>깨진 사본</html>", "utf8")));
    await writeFile(metaPath(env, PITCHER), aMeta);
    // ③ 첫 수집기 — 상류는 A 를 t1 에 줬다. 로컬 본문 읽기가 늦어(시계가 t3 으로 간다) · **본문 쓰기 직전**(재확인 뒤)에
    //   겹친 작성자가 B/B 를 쓴다. 기록할 때 시계를 다시 읽으면 여기서 t3 이 붙는다
    let now = RACE_T1;
    const clock = { now: () => new Date(now) };
    const inner = new LocalSink(env.archive);
    let raced = false;
    const sink = {
      readMeta: (k: string) => inner.readMeta(k),
      readBody: async (k: string) => {
        now = RACE_T3;
        return inner.readBody(k);
      },
      writeMeta: (k: string, m: Parameters<LocalSink["writeMeta"]>[1]) => inner.writeMeta(k, m),
      write: async (k: string, body: Uint8Array, m: Parameters<LocalSink["write"]>[2]) => {
        if (!raced) {
          raced = true;
          await putPair(env, PITCHER, b);
        }
        return inner.write(k, body, m);
      },
    };
    const fetcher = new PoliteFetcher({
      userAgent: "bb-app-test",
      clock,
      fetchImpl: async () => ({
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => aBytes.buffer.slice(aBytes.byteOffset, aBytes.byteOffset + aBytes.byteLength) as ArrayBuffer,
      }),
      sleep: async () => undefined,
    });
    const r = await archivePlayer(PITCHER, { fetcher, sink, clock });
    assert.ok(raced, "겹친 작성자가 끼어들지 않았다 — 이 시험이 그 창을 재지 못한다");
    const written = JSON.parse(await readFile(metaPath(env, PITCHER), "utf8")) as { checkedAt: string; sha256: string };
    assert.equal(written.sha256, shaOf(aBytes), "옛 A 가 덮지 않았다 — 이 시험의 전제(좁힌 창)가 성립하지 않는다");
    // ④ 적재 — A 는 t1 이라 DB 의 B(t2)보다 이르다 → 옛 판 · DB 는 B 그대로
    const after = load(env);
    assert.deepEqual(snapshot(env, PITCHER), withB, `겹친 작성자의 새 판을 옛 A 가 되돌렸다(조용한 되돌림)\n${after.out}`);
    assert.equal(after.code, 0, after.out + after.err);
    assert.match(after.out, /옛 판 건너뜀 1/, `A 를 옛 판으로 막지 않았다\n${after.out}`);
    assert.equal(written.checkedAt, RACE_T1, "덮은 A 에 늦은 기록 시각이 붙었다");
    assert.equal(r.repair, "rewritten", JSON.stringify(r));
  } finally {
    await cleanup(env);
  }
});

// ─── 3중 검토 2차 m4 · 요약의 수가 뜻대로 센다(2026-09-27) ───
//
// ⚠**종료 코드는 안 바꾼다** — 바뀌는 것은 사람이 읽는 수뿐이다.

/**
 * ⚠**판정별 수(처음·같은 본문·새 판)는 실제로 쓴 선수만 센다.** 예전에는 판정 직후 · 파싱 **전에** 세서, 프로필 파싱에 실패한 선수가
 * 「처음」에도 「파싱 실패」에도 들어갔다 — 요약의 수를 더하면 페이지 수보다 컸다. 변이 「파싱 전에 센다」가 이 시험을 붉게 만든다.
 */
test("⚠3중 검토 2차 m4 · 프로필 파싱에 실패한 선수는 판정별 수에 안 센다 — 파싱 실패로만 센다(더하면 페이지 수)", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_NEW }, [BATTER]: { fetchedAt: T_NEW } });
  try {
    await mutatePage(env, PITCHER, (h) => h.replace('<section id="pc_bio">', '<section id="pc_bio_gone">'));
    const r = load(env);
    // 파싱 실패 · 커버리지 미달(1/2) — 종료 1 은 예나 지금이나 같다
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, new RegExp(`PARSE ERROR ${PITCHER} — `));
    assert.match(r.out, /선수 페이지 2장 · 갱신 1 · DB에 없는 선수 0 · 파싱 실패 1/);
    assert.match(r.out, /판 가드 — 처음 1 · 같은 본문 0 · 새 판 0 · /, `파싱에 실패한 선수를 판정별 수에 셌다\n${r.out}`);
  } finally {
    await cleanup(env);
  }
});

/**
 * ⚠**「취득시각 모름(NULL)으로 쓴 선수」는 NULL 로 쓴 선수만 센다**(~~취득시각 결손~~ 이었다). 예전에는 사이드카가 본문을 말하지 않는
 * 페이지를 **전부** 셌다 — 건너뛴 선수(판 모름 · 아무것도 안 썼다)와 같은 본문이라 DB 시각을 지킨 선수(NULL 이 아니다)까지.
 * 변이 「사이드카를 못 읽으면 센다」가 이 시험을 붉게 만든다.
 */
test("⚠3중 검토 2차 m4 · 취득시각 모름으로 쓴 수 — 건너뛴 선수 · DB 시각을 지킨 같은 본문은 안 센다", { skip }, async () => {
  const env = await setup({ [PITCHER]: { fetchedAt: T_NEW }, [BATTER]: { fetchedAt: T_NEW } });
  try {
    assert.equal(load(env).code, 0);
    // PITCHER — 같은 본문 · 사이드카 없음 → 적용 판과 같아 DB 시각을 지킨다(NULL 로 안 쓴다)
    await rm(metaPath(env, PITCHER));
    // BATTER — DB 가 다른 판(Y) · 사이드카 없음 → 판 모름으로 건너뛴다(아무것도 안 쓴다)
    exec(env, "UPDATE player SET profile_revision = ?, profile_content_at = ? WHERE player_id = ?", REV_Y, T_NEW, BATTER);
    await rm(metaPath(env, BATTER));
    const r = load(env);
    assert.equal(r.code, 1, `판 모름이 있는데 종료 ${r.code} 다\n${r.out}${r.err}`);
    assert.match(r.out, /같은 본문 1 · 새 판 0 · 옛 판 건너뜀 0\(.*?\) · 판 모름 건너뜀 1/);
    assert.equal(snapshot(env, PITCHER).player["profile_fetched_at"], T_NEW, "같은 본문인데 DB 시각을 안 지켰다");
    assert.match(r.err, /취득시각 모름\(NULL\)으로 쓴 선수 0명/, `NULL 로 쓰지 않은 선수를 셌다\n${r.err}`);
  } finally {
    await cleanup(env);
  }
});
