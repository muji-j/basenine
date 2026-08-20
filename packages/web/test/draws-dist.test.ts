/**
 * 引き分けの解剖 — **배포물의 수를 DB 에서 다시 세어 대조한다.**
 *
 * ⚠**직전 라운드가 리그 실측치를 1,808장에 하드코딩했고**, 그것을 고친 방법이 바로 이것이다.
 * 이번 표는 **9시즌 전체를 화면에 늘어놓으므로** 낡을 여지가 그때보다 크다 —
 * 백필하거나 수집이 하루 밀리면 그 순간 화면의 수가 DB 와 갈린다.
 *
 * ⚠**여기서 기대값을 손으로 적지 않는다.** 적으면 「화면과 시험이 같이 낡는」 상태가 되고,
 * 그건 검사가 아니라 복사다. **DB 에서 세고, 화면에서 읽고, 맞대 본다.**
 *
 * ⚠**시즌 화면마다 보이는 범위가 다르다** — 2018년 화면은 2018년만, 2026년(현행) 화면은
 * 보유 전 시즌을 싣는다(미래 시즌을 과거 화면에 싣지 않는다는 규약).
 * 그것까지 여기서 확인한다 — 규약이 깨지면 과거 화면이 미래를 말하게 된다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { seasonDraws } from "@bb-app/aggregate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST = join(ROOT, "dist");
const DB = join(ROOT, "data", "bb.sqlite");

const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}
if (process.env["BB_REQUIRE_DB"] === "1" && !existsSync(DB)) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const READY = existsSync(DIST) && existsSync(DB);

/** `dist` 안의 順位表 전부. `ranking.html`(현행) + `{연도}/ranking.html` */
function rankingPages(): { page: string; season: number | null }[] {
  const out: { page: string; season: number | null }[] = [];
  if (existsSync(join(DIST, "ranking.html"))) out.push({ page: "ranking.html", season: null });
  for (const d of readdirSync(DIST, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^\d{4}$/.test(d.name)) continue;
    const p = join(d.name, "ranking.html");
    if (existsSync(join(DIST, p))) out.push({ page: p, season: Number(d.name) });
  }
  return out;
}

interface Row {
  season: number;
  games: number;
  draws: number;
  extra: number;
  extraDrawn: number;
  regulationDrawn: number;
  maxInning: number | null;
}

function textOf(cell: string): string {
  return cell.replace(/<[^>]*>/g, "").trim();
}

/** 화면의 引き分けの解剖 표를 읽는다. ⚠**구획이 없으면 `null`** — 「없다」와 「0행」을 가른다 */
function parseDraws(html: string): Row[] | null {
  const sec = /<section class="block" id="b-draws"[\s\S]*?\n<\/section>/.exec(html);
  if (sec === null) return null;
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(sec[0]);
  assert.notEqual(body, null, "引き分け 표에 tbody 가 없다");
  const out: Row[] = [];
  for (const tr of body![1]!.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/g) ?? []).map(textOf);
    assert.equal(cells.length, 9, `열 수가 9가 아니다: ${cells.join(" | ")}`);
    // 값 칸은 `.019858試合` 처럼 분모가 붙어 있으므로 **수만 쓰는 칸만** 읽는다
    const inning = /^(\d+)回$/.exec(cells[8]!);
    out.push({
      season: Number(/^(\d{4})年$/.exec(cells[0]!)![1]),
      games: Number(cells[1]),
      draws: Number(cells[2]),
      extra: Number(cells[4]),
      extraDrawn: Number(cells[5]),
      regulationDrawn: Number(cells[7]),
      maxInning: inning === null ? null : Number(inning[1]),
    });
  }
  return out;
}

test(
  "⚠화면의 引き分けの解剖가 DB 를 다시 센 값과 같다 — 하드코딩하면 여기서 떨어진다",
  { skip: READY ? false : "dist 또는 DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    let expected: Map<number, Row>;
    try {
      expected = new Map(
        seasonDraws(db, "regular", "9999-12-31", 0, 9999).map((r) => [
          r.season,
          {
            season: r.season, games: r.games, draws: r.draws, extra: r.extra,
            extraDrawn: r.extraDrawn, regulationDrawn: r.regulationDrawn, maxInning: r.maxInning,
          },
        ]),
      );
    } finally {
      db.close();
    }

    const pages = rankingPages();
    // ⚠**공회전 방지**: 순위표를 하나도 못 찾으면 아래가 전부 조용히 통과한다
    assert.ok(pages.length >= 2, `순위표를 ${pages.length}장밖에 못 찾았다 — 이 시험이 공회전한다`);
    assert.ok(expected.size >= 2, `DB 에서 ${expected.size}시즌밖에 못 읽었다 — 이 시험이 공회전한다`);

    const problems: string[] = [];
    let checkedRows = 0;
    for (const { page, season } of pages) {
      const rows = parseDraws(readFileSync(join(DIST, page), "utf8"));
      if (rows === null) {
        problems.push(`${page}: 引き分けの解剖 구획이 없다`);
        continue;
      }
      assert.ok(rows.length > 0, `${page}: 표가 비어 있다`);
      for (const got of rows) {
        checkedRows += 1;
        const want = expected.get(got.season);
        if (want === undefined) {
          problems.push(`${page}: DB 에 없는 ${got.season}년이 화면에 있다`);
          continue;
        }
        for (const k of ["games", "draws", "extra", "extraDrawn", "regulationDrawn", "maxInning"] as const) {
          if (got[k] !== want[k]) {
            problems.push(`${page} ${got.season}년 ${k}: 화면 ${got[k]} · DB ${want[k]}`);
          }
        }
      }
      /**
       * ⚠**과거 화면이 미래를 말하지 않는다.** `ranking.html`(현행)은 최신 시즌 화면이므로
       * 상한을 걸 수 없지만, `{연도}/ranking.html` 은 그 연도까지여야 한다.
       */
      if (season !== null) {
        const beyond = rows.filter((r) => r.season > season).map((r) => r.season);
        if (beyond.length > 0) {
          problems.push(`${page}: ${season}년 화면에 미래 시즌 ${beyond.join("·")} 이 실렸다`);
        }
      }
    }
    assert.ok(checkedRows >= 10, `대조한 행이 ${checkedRows}개뿐이다 — 이 시험이 공회전한다`);
    assert.deepEqual(problems, [], `화면과 DB 가 어긋난 곳 ${problems.length}건 / 대조 ${checkedRows}행`);
  },
);
