/**
 * **표의 머리 칸 수와 본문 칸 수가 같은가.**
 *
 * ⚠**2026-08-31 에 사용자가 이것에 걸렸다.** スプリット 표의 머리에 `打数` 를 더하면서
 * **본문 칸을 안 더했다.** 머리 13칸 / 본문 12칸이 되어 그 뒤가 **전부 한 칸씩 왼쪽으로 밀렸고**,
 * 화면은 `打数` 칸에 타율(.285)을, `長打率` 칸에 안타 수(70)를 싣고 `三振` 칸을 비운 채로 나갔다.
 * ⚠**값은 전부 맞는 값이었다** — 틀린 것은 **어느 칸에 있는가**뿐이라
 * 수치 검증도, 링크 검사도, 대비 검사도 아무것도 안 울렸다.
 *
 * ## ⚠이 어긋남이 **분모 가드를 껐다** — 그게 이 시험이 있어야 하는 진짜 이유다
 *
 * `den-units.test.ts` 는 열을 짚으려고 **칸 수가 안 맞는 행을 버린다**(colspan·소계 때문).
 * 그런데 이 결함은 **모든 행**을 안 맞게 만들었으므로 **표 전체가 통째로 건너뛰어졌다.**
 * 즉 **M2(분모 없는 비율 금지)를 검사하는 장치가, 검사해야 할 바로 그 표에서 눈을 감았다.**
 * ⚠**「통과했다」가 「검사했다」가 아니다.** 이 시험은 그 구멍의 바닥을 막는다.
 *
 * ## ⚠`dist/` 를 요구하지 않는다
 *
 * 같은 사고의 앞 라운드에서 `den-units` 가 **로컬에 `dist` 가 없어 건너뛰어졌고**,
 * 나는 「2,056/2,056 통과」를 보고 넘겼다가 CI 에서 209건을 맞았다.
 * → 여기서는 **픽스처로 직접 렌더**한다. 로컬에서도 CI 에서도 **반드시 돈다.**
 * `dist` 가 있으면 **거기까지 덤으로** 훑는다(픽스처가 안 닿는 화면을 위해).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlayerPage } from "../src/player-page.ts";
import { context, mixedPitchingBlock, playerPage } from "./fixtures.ts";

/**
 * 한 행이 차지하는 **열 수**. ⚠**`colspan` 을 더해서 센다** —
 * 소계 행이나 「該当なし」 행은 한 칸으로 여러 열을 덮는 것이 정상이다.
 */
function colsOf(cells: readonly string[]): number {
  let n = 0;
  for (const c of cells) {
    const m = /\bcolspan\s*=\s*"?(\d+)"?/i.exec(c);
    n += m === null ? 1 : Number(m[1]);
  }
  return n;
}

interface Mismatch {
  where: string;
  heads: number;
  row: number;
  headText: string;
  rowText: string;
}

function textOf(cell: string): string {
  return cell.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** ⚠**머리는 「마지막 줄」이 잎이다** — 2단 머리에서 위 줄은 묶음이고 열을 짚는 것은 아래 줄이다 */
function checkTables(where: string, html: string): { tables: number; rows: number; bad: Mismatch[] } {
  const bad: Mismatch[] = [];
  let tables = 0;
  let rows = 0;
  for (const t of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/g) ?? []) {
    const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(t);
    if (head === null) continue;
    const headRows = head[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const last = headRows.at(-1);
    if (last === undefined) continue;
    const headCells = last.match(/<th\b[^>]*>[\s\S]*?<\/th>/g) ?? [];
    if (headCells.length === 0) continue;
    const heads = colsOf(headCells);
    tables += 1;
    // ⚠**본문과 바닥을 둘 다 본다** — 합계 줄이 어긋나도 화면은 똑같이 거짓말한다
    for (const section of ["tbody", "tfoot"] as const) {
      const re = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`);
      const body = re.exec(t);
      for (const r of body?.[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
        const cells = r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
        if (cells.length === 0) continue;
        rows += 1;
        const n = colsOf(cells);
        if (n === heads) continue;
        bad.push({
          where,
          heads,
          row: n,
          headText: headCells.map(textOf).join(" | "),
          rowText: cells.map(textOf).join(" | "),
        });
      }
    }
  }
  return { tables, rows, bad };
}

function report(bad: readonly Mismatch[]): string {
  return bad
    .slice(0, 8)
    .map(
      (b) =>
        `${b.where}: 머리 ${b.heads}칸 / 행 ${b.row}칸\n` +
        `    머리: ${b.headText}\n` +
        `    행  : ${b.rowText}`,
    )
    .join("\n");
}

/** 픽스처로 만드는 화면들. ⚠**늘리면 그만큼 이 시험이 넓어진다** */
function renderedPages(): { name: string; html: string }[] {
  return [
    { name: "선수(타자)", html: renderPlayerPage(playerPage(), context()) },
    {
      name: "선수(투타 양쪽)",
      html: renderPlayerPage(playerPage({ pitching: mixedPitchingBlock() }), context()),
    },
  ];
}

test("⚠표의 머리 칸 수와 본문 칸 수가 같다 — 어긋나면 값이 옆 칸에 실린다", () => {
  let tables = 0;
  let rows = 0;
  const bad: Mismatch[] = [];
  for (const p of renderedPages()) {
    const r = checkTables(p.name, p.html);
    tables += r.tables;
    rows += r.rows;
    bad.push(...r.bad);
  }
  /**
   * ⚠**공회전 방지.** 픽스처가 표를 하나도 안 만들면 이 시험은 언제나 초록이다 —
   * 그 상태가 정확히 「통과하는데 아무것도 안 재는」 것이다.
   */
  assert.ok(tables >= 5, `표를 ${tables}개밖에 못 읽었다 — 픽스처나 파싱이 망가졌다`);
  assert.ok(rows >= 10, `행을 ${rows}개밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.deepEqual(bad, [], `머리와 행의 칸 수가 다르다\n${report(bad)}`);
});

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

/**
 * ⚠**덤이다.** 픽스처가 닿지 않는 화면(순위표·경기·구단…)까지 훑는다.
 * ⚠**없다고 실패시키지 않는다** — 위의 시험이 이미 로컬에서 돌기 때문이다.
 */
function distSample(): string[] {
  if (!existsSync(DIST)) return [];
  const out: string[] = [];
  for (const f of readdirSync(DIST)) if (f.endsWith(".html")) out.push(f);
  for (const dir of ["players", "games", "teams", "days", "starters"]) {
    const d = join(DIST, dir);
    if (!existsSync(d)) continue;
    // ⚠**전부 읽으면 느리다.** 각 구획에서 앞 3장씩 — 렌더러는 화면당 한 벌이라 그것으로 닿는다
    for (const f of readdirSync(d).filter((x) => x.endsWith(".html")).slice(0, 3)) out.push(join(dir, f));
  }
  return out;
}

test("⚠배포물에서도 같다 — 픽스처가 닿지 않는 화면을 위해", () => {
  const pages = distSample();
  if (pages.length === 0) return; // dist 없음. 위 시험이 이미 돈다
  let tables = 0;
  const bad: Mismatch[] = [];
  for (const p of pages) {
    const r = checkTables(p, readFileSync(join(DIST, p), "utf8"));
    tables += r.tables;
    bad.push(...r.bad);
  }
  assert.ok(tables > 0, `dist 를 ${pages.length}장 읽었는데 표가 0개다 — 파싱이 망가졌다`);
  assert.deepEqual(bad, [], `머리와 행의 칸 수가 다르다\n${report(bad)}`);
});
