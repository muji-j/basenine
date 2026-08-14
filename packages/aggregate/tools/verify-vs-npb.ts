/**
 * T1 검증 — 우리가 도출한 시즌 성적을 **npb.jp 공표값과 대조**한다.
 *
 *   node packages/aggregate/tools/verify-vs-npb.ts data/bb.sqlite
 *
 * 지표 정의서(`docs/metrics/README.md`)가 T1으로 분류한 항목은 npb.jp가 값을 공표하므로
 * **외부 정답과 직접 맞춰볼 수 있다.** 우리 산식으로 우리 산식을 검증하는 게 아니다.
 *
 * ⚠기대값은 npb.jp 공표 페이지에서 손으로 옮겨 적은 것이며 **기준일이 명시돼 있다.**
 * 우리 집계도 같은 날짜로 잘라서 비교한다 — 하루만 어긋나도 「불일치」로 보인다.
 */
import { openDb } from "@bb-app/store";
import { battingAverage, onBasePercentage, sluggingPercentage } from "@bb-app/metrics";
import { aggregateSeason } from "../src/season.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node tools/verify-vs-npb.ts <db-path>");
  process.exit(2);
}

/**
 * npb.jp `/bis/2026/stats/idb1_t.html` 에서 옮긴 기대값.
 * 취득일 2026-08-15 · 페이지 기준일 **2026-08-13**.
 */
const EXPECTED = {
  source: "https://npb.jp/bis/2026/stats/idb1_t.html",
  through: "2026-08-13",
  season: 2026,
  name: "佐藤",
  teamCode: "t",
  games: 103,
  pa: 438,
  ab: 378,
  runs: 76,
  h: 120,
  double: 28,
  triple: 3,
  hr: 27,
  rbi: 76,
  sf: 3,
  bb: 56,
  ibb: 6,
  hbp: 1,
  so: 116,
  avg: 0.317,
  slg: 0.622,
  obp: 0.404,
} as const;

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

// ⚠npb.jp의 「◯月◯日現在」가 **어느 날 경기까지**인지는 명시돼 있지 않다.
// 후보 날짜를 훑어 일치 항목이 가장 많은 날을 찾는다 — 이것 자체가 실측이다.
if (process.argv[3] === "--scan") {
  for (const d of ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"]) {
    const a = aggregateSeason(db, EXPECTED.season, "regular", d);
    const p = a.batting.find((b) => b.displayName === EXPECTED.name && b.teamCode === EXPECTED.teamCode);
    console.log(`${d}  경기 ${p?.games ?? "—"} 타석 ${p?.line.pa ?? "—"} 타수 ${p?.line.ab ?? "—"} 안타 ${p?.line.h ?? "—"} 본루타 ${p?.line.hr ?? "—"}`);
  }
  db.close();
  process.exit(0);
}

const agg = aggregateSeason(db, EXPECTED.season, "regular", process.argv[3] ?? EXPECTED.through);

const player = agg.batting.find((b) => b.displayName === EXPECTED.name && b.teamCode === EXPECTED.teamCode);
if (!player) {
  console.error(`대상 선수를 찾지 못했다: ${EXPECTED.name} (${EXPECTED.teamCode})`);
  db.close();
  process.exit(1);
}

const l = player.line;
const rows: [string, number, number, number][] = [
  ["試合 games", EXPECTED.games, player.games, 0],
  ["打席 PA", EXPECTED.pa, l.pa, 0],
  ["打数 AB", EXPECTED.ab, l.ab, 0],
  ["得点 R", EXPECTED.runs, player.runs, 0],
  ["安打 H", EXPECTED.h, l.h, 0],
  ["二塁打 2B", EXPECTED.double, l.double, 0],
  ["三塁打 3B", EXPECTED.triple, l.triple, 0],
  ["本塁打 HR", EXPECTED.hr, l.hr, 0],
  ["打点 RBI", EXPECTED.rbi, player.rbi, 0],
  ["犠飛 SF", EXPECTED.sf, l.sf, 0],
  ["四球 BB", EXPECTED.bb, l.bb, 0],
  ["敬遠 IBB", EXPECTED.ibb, l.ibb, 0],
  ["死球 HBP", EXPECTED.hbp, l.hbp, 0],
  ["三振 SO", EXPECTED.so, l.so, 0],
  ["打率 AVG", EXPECTED.avg, battingAverage(l).value ?? Number.NaN, 3],
  ["長打率 SLG", EXPECTED.slg, sluggingPercentage(l).value ?? Number.NaN, 3],
  ["出塁率 OBP", EXPECTED.obp, onBasePercentage(l).value ?? Number.NaN, 3],
];

console.log(`T1 검증 · ${EXPECTED.name}(${EXPECTED.teamCode}) · 기준일 ${EXPECTED.through}`);
console.log(`출처 ${EXPECTED.source}\n`);
console.log("항목".padEnd(14) + "npb.jp".padStart(9) + "우리".padStart(9) + "  판정");

let mismatched = 0;
for (const [label, expected, actual, digits] of rows) {
  const a = digits === 0 ? actual : Number(actual.toFixed(digits));
  const ok = a === expected;
  if (!ok) mismatched += 1;
  console.log(
    label.padEnd(14) +
      String(expected).padStart(9) +
      String(a).padStart(9) +
      (ok ? "  ✓" : "  ✗ 불일치"),
  );
}

console.log(`\n${rows.length - mismatched} / ${rows.length} 항목 일치`);
db.close();
process.exitCode = mismatched > 0 ? 1 : 0;
