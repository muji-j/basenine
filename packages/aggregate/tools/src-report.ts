/**
 * SRC(状況得点貢献) 순위표.
 *
 *   node packages/aggregate/tools/src-report.ts data/bb.sqlite 2026
 */
import { openDb } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import { qualifiedBatterPa } from "@bb-app/metrics";
import { buildRunExpectancy } from "../src/run-expectancy.ts";
import { computeSrc } from "../src/situational.ts";
import { aggregateSeason } from "../src/season.ts";

const [dbPath, seasonArg] = process.argv.slice(2);
if (!dbPath || !seasonArg) {
  console.error("usage: node tools/src-report.ts <db-path> <season>");
  process.exit(2);
}
const season = Number(seasonArg);
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");
const agg = aggregateSeason(db, season);

console.log(`SRC — 状況得点貢献 (Situational Run Contribution) · ${season}`);
console.log(`타석마다 팀의 득점기대치를 얼마나 바꿨는가. 단위는 평균 대비 득점.`);
console.log(`⚠수비·주루·포지션 보정을 포함하지 않는다. **WAR이 아니며 WAR과 비교할 수 없다.**`);

for (const league of ["central", "pacific"] as const) {
  const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
  const re = buildRunExpectancy(db, season, league, codes);
  const entries = computeSrc(db, re, codes);

  // ⚠팀 경기수는 `aggregateSeason`이 내는 값 하나만 쓴다(M1 — 위 splits-report와 같은 이유).
  const teamGames = Math.max(...codes.map((c) => agg.teamGames.get(c) ?? 0));
  const needPa = qualifiedBatterPa(teamGames);

  const qualified = entries.filter((e) => e.pa + e.skipped >= needPa).sort((a, b) => b.src - a.src);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${league} · RE 표본 ${re.totalPa.toLocaleString()}타석 · 규정타석 ${needPa}`);
  console.log(`\n  순위  선수        SRC      600타석환산   타석   (미계산)`);
  for (const [i, e] of qualified.slice(0, 8).entries()) {
    console.log(
      `  ${String(i + 1).padStart(3)}   ${e.displayName.padEnd(10)} ` +
        `${e.src >= 0 ? "+" : ""}${e.src.toFixed(1).padStart(6)}   ` +
        `${(e.srcPer600 ?? 0) >= 0 ? "+" : ""}${(e.srcPer600 ?? 0).toFixed(1).padStart(6)}    ` +
        `${String(e.pa).padStart(4)}   ${e.skipped > 0 ? `(${e.skipped})` : ""}`,
    );
  }

  const worst = qualified.at(-1);
  if (worst) {
    console.log(
      `  최하  ${worst.displayName.padEnd(10)} ${worst.src.toFixed(1).padStart(7)}   ` +
        `${(worst.srcPer600 ?? 0).toFixed(1).padStart(6)}    ${String(worst.pa).padStart(4)}`,
    );
  }

  const totalSrc = entries.reduce((n, e) => n + e.src, 0);
  const totalPa = entries.reduce((n, e) => n + e.pa, 0);
  const skipped = entries.reduce((n, e) => n + e.skipped, 0);
  console.log(
    `\n  리그 합계 SRC ${totalSrc.toFixed(1)} (타석 ${totalPa.toLocaleString()} · 미계산 ${skipped})`,
  );
  console.log(`  ⚠리그 전체의 합은 0 근처여야 한다 — 평균 대비 지표이기 때문이다.`);
}

db.close();
