/**
 * playbyplay 파서의 자기 검증.
 *
 * 핵심 착안: **같은 경기의 타석 수를 박스스코어와 playbyplay가 각자 말한다.**
 * 타자별 타석 수가 어긋나면 둘 중 하나가 틀린 것이다 — 서로가 서로의 정답이 된다.
 *
 *   node packages/parser/tools/sweep-playbyplay.ts data/archive
 */
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { parseBoxScore } from "../src/box.ts";
import { parsePlayByPlay } from "../src/playbyplay.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: node tools/sweep-playbyplay.ts <archive-root>");
  process.exit(2);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "playbyplay.html.gz") yield p;
  }
}

const read = async (p: string): Promise<string> => gunzipSync(await readFile(p)).toString("utf8");

let played = 0;
let notPlayed = 0;
let errors = 0;
let events = 0;
let noPitcher = 0;
let incomplete = 0;
const paMismatch: string[] = [];
const baseStates = new Map<string, number>();
let batterChecked = 0;

for await (const file of walk(root)) {
  let pbp;
  try {
    pbp = parsePlayByPlay(await read(file));
  } catch (err) {
    errors += 1;
    console.error(`PBP ERROR ${file} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (pbp.status === "notPlayed") {
    notPlayed += 1;
    continue;
  }
  played += 1;
  events += pbp.events.length;

  const byBatter = new Map<string, number>();
  for (const e of pbp.events) {
    // 도중 종료는 타석이 아니다 — 박스스코어도 세지 않는다.
    if (!e.completed) {
      incomplete += 1;
      continue;
    }
    byBatter.set(e.batterId, (byBatter.get(e.batterId) ?? 0) + 1);
    baseStates.set(`${e.outsBefore}|${e.bases}`, (baseStates.get(`${e.outsBefore}|${e.bases}`) ?? 0) + 1);
    if (e.pitcherId === null) noPitcher += 1;
  }

  // 같은 경기의 박스스코어와 대조한다.
  const boxFile = join(dirname(file), "box.html.gz");
  let box;
  try {
    box = parseBoxScore(await read(boxFile));
  } catch {
    continue;
  }
  if (box.status !== "played") continue;

  const short = file.slice(root.length + 1);
  for (const team of [box.away, box.home]) {
    for (const b of team.batters) {
      if (b.isTeamTotal || b.playerId === null) continue;
      batterChecked += 1;
      const fromPbp = byBatter.get(b.playerId) ?? 0;
      if (fromPbp !== b.plateAppearances.length) {
        paMismatch.push(
          `${short} ${b.name} 박스 ${b.plateAppearances.length} · 경과 ${fromPbp}`,
        );
      }
    }
  }
}

console.log(`성립 ${played}건 · 미성립 ${notPlayed}건 · 오류 ${errors}건 · 타석 이벤트 ${events}건`);
console.log(`투수 미상 이벤트 ${noPitcher}건 · 도중 종료(타석 아님) ${incomplete}건`);
console.log(`\n=== 베이스-아웃 상태 (고유 ${baseStates.size} / 이론상 24) ===`);
for (const [k, n] of [...baseStates].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(7)}  아웃${k.split("|")[0]} 주자[${k.split("|")[1] || "없음"}]`);
}
console.log(`\n=== 박스 대조: 타자별 타석 수 불일치 (${paMismatch.length}건 / ${batterChecked}행) ===`);
for (const m of paMismatch.slice(0, 20)) console.log(`  ${m}`);
if (paMismatch.length > 20) console.log(`  ... 외 ${paMismatch.length - 20}건`);

process.exitCode = errors > 0 || paMismatch.length > 0 ? 1 : 0;
