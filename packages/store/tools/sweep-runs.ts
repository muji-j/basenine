/**
 * 타석별 득점 유도의 자기 검증.
 *
 * 유도한 이닝별 득점의 합이 **라인스코어와 일치해야 한다.** 라인스코어는 우리가 만들지 않은
 * 외부 정답이므로, 이 대조는 우리 계산으로 우리 계산을 검증하는 게 아니다.
 *
 *   node packages/store/tools/sweep-runs.ts data/archive
 */
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseLineScore, parsePlayByPlay } from "@bb-app/parser";
import { deriveRuns } from "../src/runs.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: node tools/sweep-runs.ts <archive-root>");
  process.exit(2);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "playbyplay.html.gz") yield p;
  }
}

let games = 0;
let halves = 0;
let totalRuns = 0;
let errors = 0;
let scoreboardTotal = 0;
const mismatches: string[] = [];
const gameTotalMismatch: string[] = [];

for await (const file of walk(root)) {
  const html = gunzipSync(await readFile(file)).toString("utf8");
  let pbp;
  let ls;
  try {
    pbp = parsePlayByPlay(html);
    if (pbp.status !== "played") continue;
    ls = parseLineScore(html);
  } catch (err) {
    errors += 1;
    console.error(`ERROR ${file} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  games += 1;
  const completed = pbp.events.filter((e) => e.completed);
  const short = file.slice(root.length + 1);
  const r = deriveRuns(short, completed, ls);
  const derivedTotal = r.runsPerEvent.reduce((a, b) => a + b, 0);
  totalRuns += derivedTotal;
  scoreboardTotal += ls.awayTotal + ls.homeTotal;
  halves += new Set(completed.map((e) => `${e.inning}|${e.half}`)).size;
  // ⚠경기 총점 대조. 마지막 타석을 라인스코어로 닫으므로 이닝별 대조는 자명해지지만,
  // **총점이 맞는지는 여전히 독립적인 확인**이다(치지 않은 이닝·끝내기가 여기서 드러난다).
  if (derivedTotal !== ls.awayTotal + ls.homeTotal) {
    gameTotalMismatch.push(`${short} 라인스코어 ${ls.awayTotal + ls.homeTotal} · 유도 ${derivedTotal}`);
  }
  for (const q of r.quarantine) mismatches.push(`${q.gameId} ${q.raw} · ${q.detail}`);
}

console.log(
  `경기 ${games}건 · 하프이닝 ${halves}개 · 오류 ${errors}건\n` +
    `유도 총 득점 ${totalRuns} · 라인스코어 총점 ${scoreboardTotal}`,
);
console.log(`\n=== 경기 총점 불일치 (${gameTotalMismatch.length}건 / ${games}경기) ===`);
for (const m of gameTotalMismatch.slice(0, 15)) console.log(`  ${m}`);
if (gameTotalMismatch.length > 15) console.log(`  ... 외 ${gameTotalMismatch.length - 15}건`);
console.log(`\n=== 라인스코어와 불일치 (${mismatches.length}건 / 하프이닝 ${halves}개) ===`);
for (const m of mismatches.slice(0, 25)) console.log(`  ${m}`);
if (mismatches.length > 25) console.log(`  ... 외 ${mismatches.length - 25}건`);

process.exitCode = errors > 0 || mismatches.length > 0 ? 1 : 0;
