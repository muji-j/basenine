/**
 * 시즌 순위표를 출력한다.
 *
 *   node packages/aggregate/tools/leaderboard.ts data/bb.sqlite 2026
 *
 * ⚠**분모를 항상 함께 낸다.** 「.400」만 보여주는 출력은 만들지 않는다(M2).
 */
import { openDb } from "@bb-app/store";
import { aggregateSeason, battingEntries, buildLeagues, pitchingEntries, rankBatters, rankPitchers } from "../src/index.ts";
import type { BattingEntry, PitchingEntry } from "../src/index.ts";
import type { Rate } from "@bb-app/metrics";
import { qualifiedBatterPa, qualifiedPitcherOuts } from "@bb-app/metrics";

const [dbPath, seasonArg] = process.argv.slice(2);
if (!dbPath || !seasonArg) {
  console.error("usage: node tools/leaderboard.ts <db-path> <season>");
  process.exit(2);
}

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");
const agg = aggregateSeason(db, Number(seasonArg));
const leagues = buildLeagues(agg);

const fmt = (r: Rate, digits = 3, stripZero = false): string => {
  if (r.value === null) return "—";
  const s = r.value.toFixed(digits);
  return stripZero && s.startsWith("0.") ? s.slice(1) : s;
};

console.log(`${agg.season} 시즌 · 타자 ${agg.batting.length}명 · 투수 ${agg.pitching.length}명`);
console.log(`스캔 행 ${agg.readRows} = D1 일일 읽기 한도(5,000,000)의 ${((agg.readRows / 5_000_000) * 100).toFixed(2)}%`);

for (const bundle of leagues) {
  const needPa = qualifiedBatterPa(bundle.teamGames);
  const needOuts = qualifiedPitcherOuts(bundle.teamGames);
  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `${bundle.league}  팀 최다 ${bundle.teamGames}경기 · 규정타석 ${needPa} · 규정투구 ${needOuts / 3}이닝`,
  );
  console.log(
    `리그 평균 wOBA ${bundle.constants.averageWoba.toFixed(4)} · cFIP ${bundle.constants.cFip.toFixed(3)} · 득점/타석 ${bundle.constants.runsPerPa.toFixed(4)}`,
  );

  const bat = battingEntries(bundle);
  for (const [label, pick, digits, strip] of [
    ["타율", (e: BattingEntry) => e.avg, 3, true],
    ["OPS", (e: BattingEntry) => e.ops, 3, false],
    ["wRC+", (e: BattingEntry) => e.wrcPlus, 1, false],
  ] as const) {
    console.log(`\n  [${label}] 상위 5명 (분모 병기)`);
    const ranked = rankBatters(bundle, bat, pick).filter((r) => r.rank !== null).slice(0, 5);
    for (const r of ranked) {
      const p = r.item.player;
      console.log(
        `   ${String(r.rank).padStart(2)}위  ${p.displayName.padEnd(8)} ${p.teamCode.padEnd(3)} ` +
          `${fmt(pick(r.item), digits, strip).padStart(7)}  (${p.line.pa}타석 ${p.line.ab}타수 ${p.games}경기)`,
      );
    }
  }

  const pit = pitchingEntries(bundle);
  for (const [label, pick] of [
    ["방어율", (e: PitchingEntry) => e.era],
    ["FIP", (e: PitchingEntry) => e.fip],
  ] as const) {
    console.log(`\n  [${label}] 상위 5명 (분모 병기)`);
    const ranked = rankPitchers(bundle, pit, pick).filter((r) => r.rank !== null).slice(0, 5);
    for (const r of ranked) {
      const p = r.item.player;
      console.log(
        `   ${String(r.rank).padStart(2)}위  ${p.displayName.padEnd(8)} ${p.teamCode.padEnd(3)} ` +
          `${fmt(pick(r.item), 2).padStart(7)}  (${(p.line.outs / 3).toFixed(1)}이닝 ${p.games}등판)`,
      );
    }
  }
}

db.close();
