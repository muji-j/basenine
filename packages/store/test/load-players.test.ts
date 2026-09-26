/**
 * 선수 페이지 적재기(`load-players.ts`)를 **실물 선수 페이지**로 잰다 — 감사 C7(취득 시각) · C8(통산 표 소실).
 *
 * ⚠**합성 페이지를 쓰지 않는다** — 파서가 실물 마크업(탭 `#pc_stats_nav` · 구획 `stats_*` · 중첩 投球回 표)에
 *   기대므로 만든 문자열은 실물과 갈리고, 그러면 「아무것도 안 재는 초록」이 된다(`packages/parser/test/fixtures/README.md`).
 *   로컬·CI 의 `data/archive` 에서 선수 페이지를 **임시 폴더로 복사**해 쓴다.
 * ⚠사이드카(`*.meta.json`)는 실물을 읽어 **시각만 바꿔** 쓴다 — 적재기가 읽는 것은 `fetchedAtOf` 한 벌이다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertPlayer } from "../src/index.ts";

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
 *   ⚠실물 사이드카를 읽어 `fetchedAt`·`checkedAt` 만 갈아 끼운다 — 나머지(sha256·revision)는 적재기가 안 본다.
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

function load(env: Env): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [TOOL, env.archive, env.dbPath], { encoding: "utf8" });
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
    // ⚠「모른다」는 조용히 넘기지 않는다 — 요약에 결손 수가 찍혀야 한다
    assert.match(r.err, /취득시각 결손 1명/);
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

/** 임시 아카이브의 선수 페이지를 고친다. ⚠**안 바뀌면 던진다** — 변이가 헛돌면 이 시험은 아무것도 안 잰다 */
async function mutatePage(env: Env, id: string, fn: (html: string) => string): Promise<void> {
  const p = join(env.archive, "npb", "players", `${id}.html.gz`);
  const html = gunzipSync(await readFile(p)).toString("utf8");
  const next = fn(html);
  assert.notEqual(next, html, "변이가 페이지를 바꾸지 않았다");
  await writeFile(p, gzipSync(Buffer.from(next, "utf8")));
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
    await copyFile(join(PLAYERS, `${PITCHER}.html.gz`), join(env.archive, "npb", "players", `${PITCHER}.html.gz`));
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
