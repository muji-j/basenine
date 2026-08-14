/**
 * 아카이브 전체에 파서를 돌려 **자기 검증**한다.
 *
 * 핵심 착안: 박스스코어는 `打数`·`安打`·`打点` 를 **컬럼으로도 주고 타석 셀로도** 준다.
 * 우리가 셀에서 도출한 값이 npb.jp가 낸 합계와 어긋나면 **토큰 해석이 틀린 것**이다.
 * 이 대조는 우리 산식으로 우리 산식을 검증하는 게 아니라 **외부 정답과 맞춰보는 것**이다.
 *
 *   node packages/parser/tools/sweep-archive.ts data/archive
 */
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseBoxScore } from "../src/box.ts";
import { countsAsAtBat, countsAsHit } from "../src/tokens.ts";
import type { BatterRow } from "../src/box.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: node tools/sweep-archive.ts <archive-root>");
  process.exit(2);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "box.html.gz") yield p;
  }
}

const unknownTokens = new Map<string, number>();
const outcomeCounts = new Map<string, number>();
const mismatches: string[] = [];
let games = 0;
let batters = 0;
let parseErrors = 0;
let notPlayed = 0;

const playerIds = new Set<string>();
const missingId = new Map<string, number>();

function checkBatter(file: string, side: string, b: BatterRow): void {
  if (b.isTeamTotal) return; // 합계 행은 타석 셀이 없다. 별도 대조 대상이다.
  batters += 1;
  // M10: 이름이 아니라 공식 ID로 조인해야 한다. ID가 없는 행이 있으면 그 자체가 설계 제약이다.
  if (b.playerId === null) missingId.set(b.name, (missingId.get(b.name) ?? 0) + 1);
  else playerIds.add(b.playerId);
  let ab = 0;
  let hits = 0;
  let rbi = 0;
  for (const pa of b.plateAppearances) {
    outcomeCounts.set(pa.outcome, (outcomeCounts.get(pa.outcome) ?? 0) + 1);
    if (pa.outcome === "unknown") unknownTokens.set(pa.raw, (unknownTokens.get(pa.raw) ?? 0) + 1);
    if (countsAsAtBat(pa.outcome)) ab += 1;
    if (countsAsHit(pa.outcome)) hits += 1;
    rbi += pa.rbi;
  }
  const cells = b.plateAppearances.map((p) => `${p.raw}[${p.outcome}]`).join(" ");
  const where = `${file} ${side} ${b.name}  ${cells}`;
  if (ab !== b.ab) mismatches.push(`打数  기대 ${b.ab} 도출 ${ab}  ${where}`);
  if (hits !== b.hits) mismatches.push(`安打  기대 ${b.hits} 도출 ${hits}  ${where}`);
  if (rbi !== b.rbi) mismatches.push(`打点  기대 ${b.rbi} 도출 ${rbi}  ${where}`);
}

for await (const file of walk(root)) {
  let box;
  try {
    box = parseBoxScore(gunzipSync(await readFile(file)).toString("utf8"));
  } catch (err) {
    parseErrors += 1;
    console.error(`PARSE ERROR ${file} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (box.status === "notPlayed") {
    notPlayed += 1;
    continue;
  }
  games += 1;
  const short = file.slice(root.length + 1);
  for (const b of box.away.batters) checkBatter(short, "away", b);
  for (const b of box.home.batters) checkBatter(short, "home", b);
}

console.log(
  `성립 경기 ${games}건 · 미성립(중지 등) ${notPlayed}건 · 타자 행 ${batters}건 · 파싱 오류 ${parseErrors}건`,
);

console.log(
  `\n=== 선수 ID (M10) ===\n고유 선수 ${playerIds.size}명 · ID 없는 타자 행 ${[...missingId.values()].reduce((a, b) => a + b, 0)}건`,
);
for (const [name, n] of [...missingId].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(n).padStart(6)}  ${name}`);
}

console.log(`\n=== 결과 분류 ===`);
for (const [o, n] of [...outcomeCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${o}`);
}

console.log(`\n=== 미해석 토큰 (고유 ${unknownTokens.size}종) ===`);
for (const [t, n] of [...unknownTokens].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${t}`);
}

console.log(`\n=== npb.jp 합계와의 불일치 (${mismatches.length}건 / 타자 ${batters}행) ===`);
for (const m of mismatches.slice(0, 40)) console.log(`  ${m}`);
if (mismatches.length > 40) console.log(`  ... 외 ${mismatches.length - 40}건`);

process.exitCode = parseErrors > 0 || unknownTokens.size > 0 || mismatches.length > 0 ? 1 : 0;
