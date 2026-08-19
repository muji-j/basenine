/**
 * **비율 옆의 분모가 그 지표의 정의 분모인가** — 배포물을 직접 읽어서 확인한다.
 *
 * ⚠**「분모가 없다」보다 「틀린 분모가 인접해 있다」가 나쁘다.**
 * 2026-08-19 감사가 `dist/starters.html` 에서 잡은 것이 그것이다:
 * 열이 `…の打者 | 打席 | 安打 | 本塁打 | 三振 | 打率` 인데 `打率` 에 분모가 없어서,
 * 옆의 두 수로 검산하면 값이 안 맞았다 — `万波 9打席 2安打 .250`(= 2/8) ·
 * `郡司 8打席 3安打 .429`(= 3/7). 그 화면 전체에서 「打数」가 **0회**였다.
 * 나머지 화면(順位表 · 구단 · 선수)은 전부 맞았으므로, **한 화면만 규칙 밖에 있는 상태**를
 * 다음에도 잡으려면 화면 하나가 아니라 **전 화면을 같은 표로 재야 한다.**
 *
 * ⚠**단위 검사만으로는 모자란다.** `出塁率` 의 분모는 `打数+四球+死球+犠飛` 라
 * **옆의 `打席` 열과 다르다**(실측 2026-08-19 `dist/teams/b.html` 西川: 打席 열 465 · 出塁率 분모 464).
 * 그래서 「인접 열이 분모를 말한다」를 인정하는 지표와 인정하지 않는 지표를 아래 표가 나눈다.
 *
 * ⚠**타입도 린트도 이걸 못 잡는다** — 숫자는 전부 정상적으로 나오기 때문이다.
 * `tag-integrity.test.ts` 와 같은 이유로 **산출물을 직접 보는 수밖에 없다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/** 표본 수만 말하는 일반 열. 머리에 지표 이름이 없으므로 **칸의 단위까지** 봐야 한다 */
const SAMPLE_COLUMN = "母数";

interface RateSpec {
  /** 값에 붙는 분모의 꼬리(`format.ts` 의 `denominator()` 가 내는 단위) */
  unit: string;
  /**
   * 같은 행에서 분모를 **대신 말할 수 있는** 열 머리.
   * ⚠**「비슷한 수가 있는 열」이 아니다.** 그 열의 값이 곧 정의 분모여야 한다.
   */
  neighbors: readonly string[];
  /** 정의(docs/metrics) — 왜 그것이 분모인가 */
  why: string;
}

/**
 * ⚠**이 표가 정본이다.** 화면이 늘어도 여기 없는 비율은 아래 검사가 거부한다 —
 * 「새 지표를 넣었는데 분모를 안 정했다」가 조용히 지나가지 않게 하기 위해서다.
 */
const RATES: Readonly<Record<string, RateSpec>> = {
  打率: { unit: "打数", neighbors: ["打数"], why: "安打 ÷ 打数" },
  長打率: { unit: "打数", neighbors: ["打数"], why: "塁打 ÷ 打数" },
  // ⚠**打席 열을 분모로 인정하지 않는다** — 犠打만큼 어긋난다(실측 465 vs 464)
  出塁率: { unit: "打席", neighbors: [], why: "(安打+四球+死球) ÷ (打数+四球+死球+犠飛)" },
  OPS: { unit: "打席", neighbors: [], why: "出塁率 + 長打率 — 표본은 出塁率 쪽 분모로 말한다" },
  // ⚠**投球回 열은 분모를 「回」 없이 숫자로만 낸다.** 값에 붙이거나 母数 열이 말해야 한다
  防御率: { unit: "回", neighbors: [], why: "自責点 × 9 ÷ 投球回" },
  WHIP: { unit: "回", neighbors: [], why: "(被安打 + 与四球) ÷ 投球回" },
  // 勝敗分 칸이 `67勝39敗1分` 이라 분모(勝 + 敗)가 그 칸에서 그대로 읽힌다
  勝率: { unit: "試合", neighbors: ["勝敗分"], why: "勝 ÷ (勝 + 敗)" },
  /**
   * 남은 경기를 전부 이겼을 때와 전부 졌을 때의 **가정 승률**.
   * 분모는 `勝 + 敗 + 残り` 이고, `勝敗分` 과 `残り` 두 열이 같은 행에 있다.
   */
  "全勝〜全敗の勝率": { unit: "試合", neighbors: ["勝敗分", "残り"], why: "(勝 + 残り) ÷ (勝 + 敗 + 残り) 〜 勝 ÷ (勝 + 敗 + 残り)" },
};

/** 머리가 비율처럼 보이는데 위 표에 없으면 거부한다 */
function looksLikeRate(head: string): boolean {
  return head.endsWith("率") || head === "OPS" || head === "WHIP";
}

function textOf(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, "").trim();
}

/**
 * 화면 표본. ⚠**렌더러는 한 벌이므로 화면 종류를 덮으면 된다**(M1) —
 * 같은 표가 9시즌 × 수천 장으로 복제될 뿐이다. 대신 **종류를 빠뜨리면 못 본다**:
 * `tag-integrity.test.ts` 가 최상위 화면만 골랐다가 선수 페이지의 결함을 놓친 전례가 있다.
 */
function samplePages(): string[] {
  if (!existsSync(DIST)) return [];
  const top = [
    "index.html", "ranking.html", "teams.html", "starters.html", "postseason.html",
    "today.html", "compare.html", "matchup.html", "log.html", "days.html",
  ];
  const dirs: [string, number][] = [
    ["players", 5], ["teams", 5], ["games", 3], ["days", 2], ["starters", 2],
  ];
  const nested: string[] = [];
  for (const [d, n] of dirs) {
    const p = join(DIST, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).filter((x) => x.endsWith(".html")).slice(0, n)) nested.push(join(d, f));
  }
  return [...top, ...nested].filter((f) => existsSync(join(DIST, f)));
}

interface Table {
  page: string;
  heads: string[];
  /** 행마다 칸의 **원문 HTML**. `.den` 을 봐야 하므로 태그를 지우지 않는다 */
  rows: string[][];
}

function tablesOf(page: string, html: string): Table[] {
  const out: Table[] = [];
  for (const t of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/g) ?? []) {
    const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(t);
    if (head === null) continue;
    const headRows = head[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const last = headRows.at(-1);
    if (last === undefined) continue;
    const heads = (last.match(/<th\b[^>]*>[\s\S]*?<\/th>/g) ?? []).map(textOf);
    if (heads.length === 0) continue;
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(t);
    const rows: string[][] = [];
    for (const r of body?.[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
      // 칸 수가 안 맞는 행(colspan · 소계)은 열을 짚을 수 없으므로 세지 않는다
      if (cells.length === heads.length) rows.push(cells);
    }
    out.push({ page, heads, rows });
  }
  return out;
}

const PAGES = samplePages();

test("⚠비율 옆의 분모가 그 지표의 정의 분모다 — 화면마다 다르면 어느 쪽이 거짓말인지 알 수 없다", {
  skip: PAGES.length === 0 ? "dist 없음" : false,
}, () => {
  assert.ok(PAGES.includes("starters.html"), "予告先発 화면이 표본에 없다 — 이 시험이 원래 잡은 결함을 못 본다");

  const problems: string[] = [];
  let checked = 0;
  let byValue = 0;
  let byNeighbor = 0;
  const seen = new Map<string, number>();

  for (const page of PAGES) {
    for (const t of tablesOf(page, readFileSync(join(DIST, page), "utf8"))) {
      for (const [i, head] of t.heads.entries()) {
        if (!looksLikeRate(head)) continue;
        const spec = RATES[head];
        if (spec === undefined) {
          problems.push(`${page}: 「${head}」의 분모 정의가 이 시험의 표에 없다 — 새 비율 지표를 넣었으면 표에 추가해라`);
          continue;
        }
        // 데이터가 한 행도 없는 표는 아무것도 증명하지 못한다 — 세지 않는다
        if (t.rows.length === 0) continue;
        checked += 1;
        seen.set(head, (seen.get(head) ?? 0) + 1);

        const den = new RegExp(`<span class="den">[^<]*${spec.unit}</span>`);
        const attached = t.rows.every((cells) => den.test(cells[i] ?? ""));
        const neighbor = t.heads.some((h, j) => j !== i && spec.neighbors.includes(h));
        const sampleAt = t.heads.indexOf(SAMPLE_COLUMN);
        const sample = sampleAt >= 0 && sampleAt !== i
          && t.rows.every((cells) => textOf(cells[sampleAt] ?? "").endsWith(spec.unit));

        if (attached) byValue += 1;
        else if (neighbor || sample) byNeighbor += 1;
        else {
          problems.push(
            `${page}: 「${head}」(${spec.why})의 분모가 그 행에 없다 — ` +
              `값에 「${spec.unit}」를 붙이거나 ${[...spec.neighbors, SAMPLE_COLUMN].join("·")} 열을 둬라. ` +
              `열: ${t.heads.join(" | ")} / 첫 행: ${(t.rows[0] ?? []).map(textOf).join(" / ")}`,
          );
        }
      }
    }
  }

  /**
   * ⚠**공회전 방지.** 표본이 줄거나 마크업이 바뀌어 표를 하나도 못 읽으면
   * 이 시험은 「전부 통과」로 보이면서 아무것도 재지 않는다(작업규칙 8·9).
   * 기준선은 2026-08-19 실측이다 — 화면이 늘면 이 값도 올라간다.
   */
  assert.ok(checked >= 40, `비율 열을 ${checked}개밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.ok(byValue >= 20, `값에 분모가 붙은 열이 ${byValue}개뿐이다 — 「값에 붙인다」 쪽이 사라졌다`);
  assert.ok(byNeighbor >= 1, `인접 열이 분모인 경우를 ${byNeighbor}개 봤다 — 그 갈래가 사라졌다`);
  // 지표 종류가 줄면 표본이 한쪽으로 쏠린 것이다
  assert.ok(seen.size >= 5, `본 비율 지표가 ${seen.size}종뿐이다 — ${[...seen.keys()].join("·")}`);

  assert.deepEqual(problems, [], `분모가 어긋난 비율 ${problems.length}건 / 검사한 비율 열 ${checked}개`);
});
