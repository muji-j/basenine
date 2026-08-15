/**
 * 스플릿·상대전적 보고서.
 *
 *   node packages/aggregate/tools/splits-report.ts data/bb.sqlite 2026 [선수명]
 *
 * ⚠**분모 없는 비율을 절대 출력하지 않는다**(M2). 표본이 작은 것이 이 지표의 기본값이다.
 */
import { openDb } from "@bb-app/store";
import { battingAverage, onBasePercentage, ops, qualifiedBatterPa, sluggingPercentage } from "@bb-app/metrics";
import type { BattingLine } from "@bb-app/metrics";
import { battingSplits, matchups } from "../src/splits.ts";

const [dbPath, seasonArg, targetName] = process.argv.slice(2);
if (!dbPath || !seasonArg) {
  console.error("usage: node tools/splits-report.ts <db-path> <season> [player-name]");
  process.exit(2);
}
const season = Number(seasonArg);
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

const avg = (l: BattingLine): string => {
  const r = battingAverage(l);
  return r.value === null ? "—" : r.value.toFixed(3).replace(/^0/, "");
};
const line = (l: BattingLine): string =>
  `${avg(l)}/${(onBasePercentage(l).value ?? 0).toFixed(3).replace(/^0/, "")}/${(sluggingPercentage(l).value ?? 0)
    .toFixed(3)
    .replace(/^0/, "")}`;

// ---- 투타 분포 ----------------------------------------------------------
const hands = db.raw
  .prepare("SELECT throws, bats, COUNT(*) AS n FROM player GROUP BY throws, bats ORDER BY n DESC")
  .all() as { throws: string | null; bats: string | null; n: number }[];
console.log(`${season} 시즌 · 투타 분포`);
for (const h of hands) console.log(`  ${String(h.throws ?? "미상").padEnd(6)}投 ${String(h.bats ?? "미상").padEnd(6)}打  ${h.n}명`);

// ---- 좌우 스플릿 --------------------------------------------------------
const teamGames = (
  db.raw
    .prepare(
      `SELECT MAX(n) AS n FROM (
         SELECT COUNT(*) AS n FROM game WHERE season=? AND status='played' AND competition='regular' GROUP BY home_code
         UNION ALL
         SELECT COUNT(*) AS n FROM game WHERE season=? AND status='played' AND competition='regular' GROUP BY away_code)`,
    )
    .get(season, season) as { n: number }
).n;
const needPa = qualifiedBatterPa(teamGames);

const byHand = battingSplits(db, "opponentHand", season);
const qualified = byHand.filter(
  (p) => p.splits.reduce((n, s) => n + s.line.pa, 0) + p.unclassified >= needPa,
);

/**
 * ⚠**스플릿 순위에는 스플릿 자체의 최소 표본이 필요하다.**
 *
 * 시즌 규정타석만 걸면 「좌투 상대 48타석 .364」가 3위로 올라온다. 분모를 병기해도
 * 순위표라는 형식 자체가 「이 사람이 좌투에 강하다」로 읽히므로, 표본이 얇으면 순위에서 뺀다.
 * 이 값은 임의 선택이며 **정답이 아니다** — UI 설계(증분 G)에서 다시 정해야 한다.
 */
const MIN_SPLIT_PA = 100;

console.log(
  `\n=== 좌투 상대 타율 상위 5 (규정타석 ${needPa}+ · **좌투 상대 ${MIN_SPLIT_PA}타석+** · 분모 병기) ===`,
);
const vsLeft = qualified
  .map((p) => ({ p, s: p.splits.find((x) => x.key === "left") }))
  .filter((x): x is { p: (typeof qualified)[number]; s: NonNullable<typeof x.s> } =>
    x.s !== undefined && x.s.line.pa >= MIN_SPLIT_PA,
  )
  .sort((a, b) => (battingAverage(b.s.line).value ?? 0) - (battingAverage(a.s.line).value ?? 0))
  .slice(0, 5);
for (const { p, s } of vsLeft) {
  console.log(`  ${p.displayName.padEnd(8)} ${line(s.line)}  (${s.line.pa}타석 ${s.line.ab}타수 ${s.line.h}안타 ${s.line.hr}홈런)`);
}

console.log(`\n=== 좌우 차이가 큰 타자 (양쪽 100타석 이상) ===`);
const gaps = qualified
  .map((p) => {
    const l = p.splits.find((x) => x.key === "left");
    const r = p.splits.find((x) => x.key === "right");
    if (!l || !r || l.line.pa < 100 || r.line.pa < 100) return null;
    const lo = ops(l.line).value ?? 0;
    const ro = ops(r.line).value ?? 0;
    return { p, l, r, gap: lo - ro };
  })
  .filter((x): x is NonNullable<typeof x> => x !== null)
  .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
  .slice(0, 5);
for (const g of gaps) {
  console.log(
    `  ${g.p.displayName.padEnd(8)} 좌투 ${line(g.l.line)}(${g.l.line.pa}타석) · ` +
      `우투 ${line(g.r.line)}(${g.r.line.pa}타석) · OPS차 ${g.gap >= 0 ? "+" : ""}${g.gap.toFixed(3)}`,
  );
}

// ---- 상대전적 ------------------------------------------------------------
console.log(`\n=== 상대전적: 타석 많은 매치업 상위 5 (분모 병기) ===`);
for (const m of matchups(db, season, 15).sort((a, b) => b.line.pa - a.line.pa).slice(0, 5)) {
  console.log(
    `  ${m.pitcherName.padEnd(8)} vs ${m.batterName.padEnd(8)} ${line(m.line)}  ` +
      `(${m.line.pa}타석 ${m.line.h}안타 ${m.line.hr}홈런 ${m.line.so}삼진 ${m.line.bb}볼넷)`,
  );
}

// ---- 특정 선수 -----------------------------------------------------------
if (targetName) {
  console.log(`\n=== ${targetName} 스플릿 ===`);
  for (const dim of ["opponentHand", "homeAway", "baseState", "month"] as const) {
    const p = battingSplits(db, dim, season).find((x) => x.displayName === targetName);
    if (!p) continue;
    const parts = p.splits.map((s) => `${s.key} ${line(s.line)}(${s.line.pa}타석)`).join(" · ");
    console.log(`  [${dim}] ${parts}${p.unclassified > 0 ? `  ⚠미분류 ${p.unclassified}타석` : ""}`);
  }
}

db.close();
