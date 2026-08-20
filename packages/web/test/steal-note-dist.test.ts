/**
 * 走塁 각주의 **리그 전체 本盗 수치** — 배포물의 수를 DB 에서 다시 세어 대조한다.
 *
 * ⚠**이 시험이 있는 이유**(2026-08-20): 그 수가 `player-page.ts` 에 **문자열로 박혀** 있었다.
 * 「当サイトの9シーズンで成功47・盗塁刺146…40はダブルスチール」. 그러면 경기가 하나 늘 때마다
 * 사람이 고쳐야 하고, 안 고치면 **배포물 175장이 한꺼번에 거짓 숫자를 말한다**(실측).
 * 실제로 08-19 경기가 들어오자 `steal-seasons.test.ts` 가 붉어졌다 —
 * 그 시험은 「소스 문자열 대 DB」를 봤으므로 **시즌 중에는 매일 붉어지는** 구조였다.
 *
 * → 화면이 **DB 에서 읽게** 고쳤고, 여기서 **배포물 대 DB** 로 대조한다.
 *   `draws-dist.test.ts` 가 같은 이유로 먼저 만든 방식이고, 이 파일은 그 선례를 따른다.
 *
 * ⚠**기대값을 손으로 적지 않는다.** 적으면 「화면과 시험이 같이 낡는」 상태가 되고,
 * 그건 검사가 아니라 복사다. **DB 에서 세고, 화면에서 읽고, 맞대 본다.**
 *
 * ⚠**과거 시즌 화면도 같은 수를 말한다** — 각주의 주장이 「本盗는 드물다」라서 표본이 클수록
 * 성립하고, 그래서 **보유 전 시즌**을 분모로 쓴다(시즌으로 자르지 않는다).
 * 그 대신 **몇 년부터 몇 년까지인지 화면에 적는다**(M2) — 여기서 그것까지 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { leagueStealTotals } from "@bb-app/aggregate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST = join(ROOT, "dist");
const DB = join(ROOT, "data", "bb.sqlite");

if (process.env["BB_REQUIRE_DIST"] === "1" && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}
if (process.env["BB_REQUIRE_DB"] === "1" && !existsSync(DB)) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const READY = existsSync(DIST) && existsSync(DB);

/**
 * ⚠**기본은 표본, CI 는 전수**(`topbar-consistency.test.ts` 와 같은 규약).
 * 각주의 수는 **시즌 빌드마다 한 번** 만들어져 그 시즌 전 페이지에 같은 값이 들어가므로
 * 디렉터리마다 몇 장씩만 봐도 조합은 다 밟힌다 — 그래도 **표본은 표본이다.**
 */
const PER_DIR = 12;
const FULL = process.env["BB_FULL_SCAN"] === "1";

/** 선수 페이지 디렉터리 전부 — `players/`(현행) + `{연도}/players/` */
function playerDirs(): string[] {
  const out: string[] = [];
  if (existsSync(join(DIST, "players"))) out.push("players");
  for (const d of readdirSync(DIST, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^\d{4}$/.test(d.name)) continue;
    if (existsSync(join(DIST, d.name, "players"))) out.push(join(d.name, "players"));
  }
  return out;
}

function sample(files: readonly string[]): string[] {
  if (FULL || files.length <= PER_DIR) return [...files];
  const half = PER_DIR / 2;
  return [...files.slice(0, half), ...files.slice(-half)];
}

/** 각주 한 줄에서 읽어 내는 값. **없으면 `null`** — 「본루 행이 없는 페이지」다 */
interface Note {
  from: number;
  to: number;
  sb: number;
  cs: number;
  ratio: string;
  doubleSteal: number;
}

/**
 * ⚠**`**…**` 는 화면에서 `<b>` 가 되어 있다**(`note()` → `emphasize()`).
 * 별표로 찾으면 **한 장도 안 걸리는데 「어긋남 0건」**이 되므로,
 * 아래 공회전 방지(`withNote > 0`)가 그 상태를 실패로 만든다 — 실제로 한 번 밟았다(2026-08-20).
 */
const NOTE =
  /当サイトが持つ(\d{4})〜(\d{4})年のレギュラーシーズンで成功(\d+)・盗塁刺(\d+)と、<b>失敗のほうが([\d.]+)倍多い<\/b>プレーです。1回の成否から傾向は読めません。また成功\d+のうち(\d+)はダブルスチール/;

function parseNote(html: string): Note | null {
  const m = NOTE.exec(html);
  if (m === null) return null;
  return {
    from: Number(m[1]),
    to: Number(m[2]),
    sb: Number(m[3]),
    cs: Number(m[4]),
    ratio: m[5]!,
    doubleSteal: Number(m[6]),
  };
}

test("⚠배포물의 本盗 각주가 DB 와 같다 — 사람이 안 고쳐도 참이어야 한다", { skip: READY ? false : "dist 또는 DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  let totals;
  try {
    const held = db.raw.prepare("SELECT MIN(season) AS lo, MAX(season) AS hi FROM game").get() as unknown as
      { lo: number | null; hi: number | null };
    assert.notEqual(held.lo, null, "DB 에 경기가 없다 — 이 시험이 공회전한다");
    // ⚠**빌드와 같은 인자로 센다**(M1). `build.ts` 는 `through` 를 주지 않는다
    totals = leagueStealTotals(db, "regular", "9999-12-31", held.lo!, held.hi!);
  } finally {
    db.close();
  }
  assert.ok(totals.seasons.length > 0, "주자 사건이 있는 시즌이 없다 — 이 시험이 공회전한다");

  const want: Note = {
    from: totals.seasons[0]!,
    to: totals.seasons[totals.seasons.length - 1]!,
    sb: totals.sbByBase.home,
    cs: totals.csByBase.home,
    ratio: (totals.csByBase.home / totals.sbByBase.home).toFixed(1),
    doubleSteal: totals.doubleStealByBase.home,
  };
  assert.ok(totals.sbByBase.home > 0, "本盗 성공이 0이라 배율을 만들 수 없다 — 각주 분기를 다시 봐라");

  let scanned = 0;
  let withNote = 0;
  const wrong: string[] = [];
  for (const dir of playerDirs()) {
    const files = readdirSync(join(DIST, dir)).filter((f) => f.endsWith(".html")).sort();
    for (const f of sample(files)) {
      scanned += 1;
      const got = parseNote(readFileSync(join(DIST, dir, f), "utf8"));
      if (got === null) continue;
      withNote += 1;
      if (
        got.from !== want.from || got.to !== want.to || got.sb !== want.sb ||
        got.cs !== want.cs || got.ratio !== want.ratio || got.doubleSteal !== want.doubleSteal
      ) {
        wrong.push(`${dir}/${f}: 화면 ${JSON.stringify(got)} · DB ${JSON.stringify(want)}`);
      }
    }
  }

  /**
   * ⚠**공회전 방지**(작업규칙 8). 각주가 실린 페이지가 하나도 없으면 위 루프가 전부 `continue` 라
   * 「어긋남 0건」이 되면서 아무것도 안 잰다. 실측(2026-08-20 · 전수): 선수 페이지 **6,207장 중 175장**에 실린다
   * （走塁 각주 자체는 1,808장에 있지만, 本盗 행이 있는 페이지에만 이 문장이 붙는다）.
   */
  assert.ok(withNote > 0, `각주가 실린 페이지가 없다(${scanned}장 확인 · ${FULL ? "전수" : "표본"}) — 이 시험이 공회전한다`);
  assert.deepEqual(
    wrong.slice(0, 5),
    [],
    `배포물의 本盗 각주가 DB 와 다른 화면 ${wrong.length}장 / 각주가 실린 ${withNote}장(확인 ${scanned}장 · ${FULL ? "전수" : "표본"})`,
  );
});
