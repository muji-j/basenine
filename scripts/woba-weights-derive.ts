#!/usr/bin/env node
/**
 * **wOBA 선형가중치를 우리 아카이브에서 유도하고, 바꾸면 화면의 수가 얼마나 움직이는지 잰다.**
 *
 * ⚠**이 파일이 존재하는 이유**: 계수 교체는 **화면의 모든 타격 지표를 움직이는 변경**이다.
 * 「크게 안 움직이더라」로 뭉개면 안 되고(작업규칙 7), 다음 사람이 같은 수를 다시 낼 수 있어야 한다.
 * 인라인 프로브로 재면 워킹트리를 되돌리는 순간 재현 절차가 사라진다
 * (`scripts/ranking-cut-measure.ts` · `scripts/asrc-asrp-measure.ts` 와 같은 규약).
 *
 * ## 무엇을 재는가
 *
 * 1. **유도** — 리그 × 시즌마다 선형가중치와 wOBAscale 을 낸다(`deriveRunValues` → `wobaWeightsFrom`)
 * 2. **대조** — 그 계수로 계산한 화면 값과, **지금 코드의 폴백 계수**로 계산한 값의 차
 * 3. **판정 재료** — 자격자의 `|Δ wOBA|` · `|Δ wRC+|` 의 중앙값/최대, **1위가 바뀐 리그-시즌 수**
 *
 * ⚠**대조 상대는 「지금 코드에 들어 있는 계수」다.** 외부 사이트의 표를 이 저장소에 옮겨 적지 않는다.
 * 폴백을 유도값으로 갈아 끼우면 이 대조는 저절로 「폴백 대 리그별」의 비교가 된다.
 *
 * 쓰는 법:
 *   node scripts/woba-weights-derive.ts data/bb.sqlite              # 유도 + 대조
 *   node scripts/woba-weights-derive.ts data/bb.sqlite --pooled     # 폴백용 1세트
 *   node scripts/woba-weights-derive.ts data/bb.sqlite --json out.json
 *   node scripts/woba-weights-derive.ts data/bb.sqlite --season 2025
 *
 * ⚠**대회 경계**: `regular` 만(CLAUDE.md §2-1). 올스타·CS·일본시리즈를 섞으면 계수가 틀린다.
 * ⚠**2026 은 진행 중 시즌**이라 별표로 낸다 — 값이 매일 움직인다.
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { openDb } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import {
  WOBA_EVENTS,
  aggregateSeason,
  battingEntries,
  buildLeagues,
  buildRunExpectancy,
  deriveRunValues,
  isQualifiedBatter,
  rankBatters,
} from "@bb-app/aggregate";
import type { BattingEntry, LeagueBundle } from "@bb-app/aggregate";
import {
  WOBA_SCALE,
  WOBA_WEIGHTS,
  onBasePercentage,
  sumBatting,
  wobaRawWith,
  wobaWeightsFrom,
} from "@bb-app/metrics";
import type { BattingLine, WobaWeights } from "@bb-app/metrics";

/** 보유 시즌. ⚠**늘어나면 여기만 고친다** */
const SEASONS: readonly number[] = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const IN_PROGRESS: ReadonlySet<number> = new Set([2026]);
const LEAGUES: readonly League[] = ["central", "pacific"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    pooled: { type: "boolean", default: false },
    /** 결과 분류 전량의 평균 득점가치. **원점이 어디서 왔는지** 볼 때 */
    events: { type: "boolean", default: false },
    /**
     * 실책 출루를 계수 없는 쪽(= 아웃과 같은 값)으로 옮겨 유도한다.
     * ⚠**「roe 를 어떻게 다룰지」를 의견이 아니라 수로 답하기 위한 스위치다.**
     */
    "drop-roe": { type: "boolean", default: false },
    /**
     * 끝내기(경기를 끝낸 말 공격) 하프이닝을 빼고 유도한다.
     * ⚠**`--drop-roe` 와 같은 목적의 스위치다** — 「끝내기를 어떻게 다룰지」를
     * 의견이 아니라 **수로** 답하기 위한 것이고, 화면 경로는 기본값(포함)을 쓴다.
     * ⚠**행렬과 계수 유도에 함께 적용된다**(`deriveRunValues` 가 행렬의 값을 따른다) —
     * 한쪽만 빼면 잘린 타석이 잘리지 않은 행렬로 평가되어 계수가 조용히 어긋난다.
     */
    "drop-walkoff": { type: "boolean", default: false },
    json: { type: "string" },
    season: { type: "string" },
  },
});
const dbPath = positionals[0];
if (dbPath === undefined) {
  console.error("usage: node scripts/woba-weights-derive.ts <db-path> [--pooled] [--json out] [--season Y]");
  process.exit(2);
}
const seasons = values.season === undefined ? SEASONS : [Number(values.season)];

// ⚠**시계를 직접 읽지 않는다**(M6). 이 도구는 시각을 쓰지 않으므로 고정값을 넣는다
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

const codesOf = (league: League): string[] =>
  TEAMS.filter((t) => t.league === league).map((t) => t.code);

const f3 = (n: number): string => n.toFixed(3);
const f4 = (n: number): string => n.toFixed(4);

/** 중앙값. ⚠**빈 배열이면 null** — 0 으로 때우면 「차이가 없다」는 거짓말이 된다 */
function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 그 지표의 1위 선수 ID 집합(동률이면 여럿). 자격자만 순위를 받는다(M3) */
function leadersOf(bundle: LeagueBundle, entries: BattingEntry[], pick: (e: BattingEntry) => { value: number | null }): Set<string> {
  const out = new Set<string>();
  for (const r of rankBatters(bundle, entries, (e) => pick(e) as never)) {
    if (r.rank === 1) out.add(r.item.player.playerId);
  }
  return out;
}

interface Row {
  season: number;
  league: League;
  derived: { runValues: WobaWeights; weights: WobaWeights; scale: number };
  samples: Record<string, number>;
  origin: number;
  originSamples: number;
  usedPa: number;
  skipped: number;
  unrecognized: number;
  /** 리그 합계 라인. 스케일의 재료 */
  leagueLine: BattingLine;
  /** 지금 폴백 계수로 계산한 리그 wOBA(= 리그 출루율과 얼마나 어긋났나) */
  fallbackLeagueWoba: number;
  leagueObp: number;
  qualified: number;
  batters: number;
  dWoba: number[];
  dWrcPlus: number[];
  wobaLeaderChanged: boolean;
  wrcLeaderChanged: boolean;
}

const rows: Row[] = [];
/**
 * 유도가 빌드에 얹는 비용. ⚠**추정으로 적지 마라** — 사이트 빌드는 리그-시즌마다
 * `deriveRunValues` 를 한 번씩 더 돌린다(`packages/web/src/query.ts`).
 */
let deriveMs = 0;
/** `--pooled` 를 위한 누적. sum 이 아니라 (평균 × 표본)으로 되돌려 더한다 */
const pool = {
  eventSum: new Map<string, number>(),
  eventN: new Map<string, number>(),
  originSum: 0,
  originN: 0,
  lines: [] as BattingLine[],
};

for (const season of seasons) {
  const agg = aggregateSeason(db, season, "regular");
  if (agg.batting.length === 0) {
    console.log(`\n${season}: 타석 기록이 없다 — 건너뛴다`);
    continue;
  }

  const runValuesByLeague = new Map<League, WobaWeights>();
  const derivedByLeague = new Map<League, ReturnType<typeof deriveRunValues>>();
  for (const league of LEAGUES) {
    const codes = codesOf(league);
    const re = buildRunExpectancy(
      db, season, league, codes, "regular", "9999-12-31",
      values["drop-walkoff"] ? "exclude" : "include",
    );
    if (re.totalPa === 0) continue;
    // ⚠**포함일 때도 몇 개가 섞였는지 말한다**(작업규칙 7) — 모르면 판단할 수 없다
    console.log(
      `  ${season} ${league}: 끝내기 하프이닝 ${re.walkoffHalves}개 · ` +
        (re.walkoff === "exclude" ? "**제외하고** 유도" : "포함해서 유도(기본)"),
    );
    // ⚠**시계를 쓰지 않는다**(M6) — `performance.now()` 는 벽시계가 아니라 단조 카운터라
    //   날짜 판정에 못 쓰이고, 그래서 M6 가 막으려는 사고(자정 경계)를 만들지 않는다
    const t0 = performance.now();
    const d = deriveRunValues(db, re, codes, "regular", "9999-12-31", values["drop-roe"] ? "zero" : "weighted");
    deriveMs += performance.now() - t0;
    derivedByLeague.set(league, d);
    runValuesByLeague.set(league, d.runValues);

    if (values.events) {
      console.log(`\n--- ${season} ${league} · 결과 분류별 평균 득점가치 (원점 이동 전) ---`);
      console.log(`    원점 ${f3(d.origin)} (표본 ${d.originSamples.toLocaleString()}) · 미계산 ${d.skipped}`);
      const total = d.byOutcome.reduce((n, o) => n + o.n, 0);
      const grand = d.byOutcome.reduce((n, o) => n + o.mean * o.n, 0);
      for (const o of d.byOutcome) {
        console.log(
          `    ${o.outcome.padEnd(24)} ${o.slot.padEnd(9)} ${String(o.n).padStart(7)}  ${f3(o.mean).padStart(7)}`,
        );
      }
      // ⚠**전 타석의 합은 0 근처여야 한다** — 하프이닝 안에서 망원경처럼 접히기 때문이다.
      //   크게 벗어나면 RE 행렬과 이 스캔이 서로 다른 것을 보고 있다는 뜻이다
      console.log(`    합계 ${total.toLocaleString()}타석 · Σ값 ${grand.toFixed(1)} (0 근처여야 한다)`);
    }
  }

  // ⚠**같은 집계에서 두 벌의 번들을 만든다** — 차이가 계수에서만 오게 하려는 것이다
  const baseBundles = buildLeagues(agg);
  const newBundles = buildLeagues(agg, (lg) => runValuesByLeague.get(lg));

  for (const league of LEAGUES) {
    const base = baseBundles.find((b) => b.league === league);
    const next = newBundles.find((b) => b.league === league);
    const d = derivedByLeague.get(league);
    if (base === undefined || next === undefined || d === undefined) continue;

    const leagueLine = sumBatting(base.batting.map((b) => b.line));
    const { scale, weights } = wobaWeightsFrom(d.runValues, leagueLine, `(${season} ${league})`);

    const baseEntries = battingEntries(base);
    const nextEntries = battingEntries(next);
    const nextById = new Map(nextEntries.map((e) => [e.player.playerId, e]));

    const dWoba: number[] = [];
    const dWrcPlus: number[] = [];
    let qualified = 0;
    for (const b of baseEntries) {
      if (!isQualifiedBatter(base, b)) continue;
      qualified += 1;
      const n = nextById.get(b.player.playerId);
      if (n === undefined) throw new Error(`${season} ${league}: 두 번들의 선수 집합이 다르다`);
      if (b.woba.value !== null && n.woba.value !== null) dWoba.push(n.woba.value - b.woba.value);
      if (b.wrcPlus.value !== null && n.wrcPlus.value !== null) {
        dWrcPlus.push(n.wrcPlus.value - b.wrcPlus.value);
      }
    }

    const wobaBefore = leadersOf(base, baseEntries, (e) => e.woba);
    const wobaAfter = leadersOf(next, nextEntries, (e) => e.woba);
    const wrcBefore = leadersOf(base, baseEntries, (e) => e.wrcPlus);
    const wrcAfter = leadersOf(next, nextEntries, (e) => e.wrcPlus);
    const same = (a: Set<string>, b: Set<string>): boolean =>
      a.size === b.size && [...a].every((x) => b.has(x));

    rows.push({
      season,
      league,
      derived: { runValues: d.runValues, weights, scale },
      samples: { ...d.samples, origin: d.originSamples },
      origin: d.origin,
      originSamples: d.originSamples,
      usedPa: d.usedPa,
      skipped: d.skipped,
      unrecognized: d.unrecognized,
      leagueLine,
      fallbackLeagueWoba: wobaRawWith(leagueLine, WOBA_WEIGHTS)!,
      leagueObp: onBasePercentage(leagueLine).value!,
      qualified,
      batters: baseEntries.length,
      dWoba,
      dWrcPlus,
      wobaLeaderChanged: !same(wobaBefore, wobaAfter),
      wrcLeaderChanged: !same(wrcBefore, wrcAfter),
    });

    for (const e of WOBA_EVENTS) {
      pool.eventSum.set(e, (pool.eventSum.get(e) ?? 0) + d.meanValues[e] * d.samples[e]);
      pool.eventN.set(e, (pool.eventN.get(e) ?? 0) + d.samples[e]);
    }
    pool.originSum += d.origin * d.originSamples;
    pool.originN += d.originSamples;
    pool.lines.push(leagueLine);
  }
}

// ─── 출력 ────────────────────────────────────────────────────────────────

console.log("\n=== 유도한 계수 (리그 × 시즌 · 정규시즌만) ===");
console.log("⚠계수는 **스케일 적용 후**(출루율 눈금). 괄호는 그 사건의 표본 수");
console.log(
  "\n시즌   리그      " +
    ["bb", "hbp", "roe", "1B", "2B", "3B", "HR"].map((s) => s.padStart(7)).join("") +
    "   scale   원점    미계산",
);
for (const r of rows) {
  const star = IN_PROGRESS.has(r.season) ? "*" : " ";
  const w = r.derived.weights;
  console.log(
    `${r.season}${star} ${r.league.padEnd(8)} ` +
      [w.bb, w.hbp, w.roe, w.single, w.double, w.triple, w.hr].map((v) => f3(v).padStart(7)).join("") +
      `  ${f3(r.derived.scale)}  ${f3(r.origin).padStart(6)}  ${r.skipped}`,
  );
}

console.log("\n=== 계수의 리그-시즌별 폭 (최소 ~ 최대) ===");
for (const key of ["bb", "hbp", "roe", "single", "double", "triple", "hr"] as const) {
  const vs = rows.map((r) => r.derived.weights[key]);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  console.log(
    `  ${key.padEnd(7)} ${f3(lo)} ~ ${f3(hi)}  (폭 ${f3(hi - lo)})  · 지금 폴백 ${f3(WOBA_WEIGHTS[key])}` +
      `  · 차 ${f3(Math.min(...vs.map((v) => v - WOBA_WEIGHTS[key])))} ~ ${f3(Math.max(...vs.map((v) => v - WOBA_WEIGHTS[key])))}`,
  );
}
{
  const vs = rows.map((r) => r.derived.scale);
  console.log(
    `  ${"scale".padEnd(7)} ${f3(Math.min(...vs))} ~ ${f3(Math.max(...vs))}` +
      `  (폭 ${f3(Math.max(...vs) - Math.min(...vs))})  · 지금 폴백 ${f3(WOBA_SCALE)}`,
  );
}

console.log("\n=== 지금 폴백 계수는 리그 출루율과 얼마나 어긋나 있었나 ===");
console.log("⚠유도값은 정의상 **리그 wOBA = 리그 출루율**이다. 아래는 그 눈금이 얼마나 밀려 있었는지");
{
  const gaps = rows.map((r) => r.fallbackLeagueWoba - r.leagueObp);
  console.log(
    `  리그-시즌 ${rows.length}개 · 어긋남 ${f4(Math.min(...gaps))} ~ ${f4(Math.max(...gaps))}` +
      ` · 중앙 ${f4(median(gaps.map(Math.abs))!)}`,
  );
}

console.log("\n=== 화면이 얼마나 움직이는가 (자격 도달 타자만) ===");
console.log("⚠**부호 있는 중앙값**을 함께 낸다 — 전원이 같은 방향으로 밀리는 것(눈금 이동)과");
console.log("  서로 자리를 바꾸는 것(재배열)은 다른 사건이고, |Δ| 만 보면 둘이 구별되지 않는다");
console.log("시즌   리그      자격  |Δ wOBA| 중앙   최대   |Δ wRC+| 중앙   최대   Δ wRC+ 부호중앙  1위(wOBA/wRC+)");
for (const r of rows) {
  const star = IN_PROGRESS.has(r.season) ? "*" : " ";
  const aw = r.dWoba.map(Math.abs);
  const ar = r.dWrcPlus.map(Math.abs);
  console.log(
    `${r.season}${star} ${r.league.padEnd(8)} ${String(r.qualified).padStart(4)}  ` +
      `${f4(median(aw) ?? NaN).padStart(9)} ${f4(Math.max(...aw)).padStart(7)}  ` +
      `${(median(ar) ?? NaN).toFixed(2).padStart(11)} ${Math.max(...ar).toFixed(2).padStart(7)}   ` +
      `${(median(r.dWrcPlus) ?? NaN).toFixed(2).padStart(13)}  ` +
      `${r.wobaLeaderChanged ? "바뀜" : "그대로"} / ${r.wrcLeaderChanged ? "바뀜" : "그대로"}`,
  );
}

{
  const allW = rows.flatMap((r) => r.dWoba.map(Math.abs));
  const allR = rows.flatMap((r) => r.dWrcPlus.map(Math.abs));
  const wobaChanged = rows.filter((r) => r.wobaLeaderChanged).length;
  const wrcChanged = rows.filter((r) => r.wrcLeaderChanged).length;
  console.log("\n=== 판정 ===");
  console.log(`  리그-시즌 ${rows.length}개 · 자격자 합계 ${allR.length}명`);
  console.log(`  |Δ wOBA|  중앙 ${f4(median(allW) ?? NaN)} · 최대 ${f4(Math.max(...allW))}`);
  console.log(`  |Δ wRC+|  중앙 ${(median(allR) ?? NaN).toFixed(2)} · 최대 ${Math.max(...allR).toFixed(2)}`);
  const signed = rows.flatMap((r) => r.dWrcPlus);
  console.log(
    `  Δ wRC+ 부호  중앙 ${(median(signed) ?? NaN).toFixed(2)} · 오른 사람 ` +
      `${signed.filter((x) => x > 0).length}/${signed.length}`,
  );
  console.log(`  1위가 바뀐 리그-시즌: wOBA ${wobaChanged}/${rows.length} · wRC+ ${wrcChanged}/${rows.length}`);
  const skipped = rows.reduce((n, r) => n + r.skipped, 0);
  const unknown = rows.reduce((n, r) => n + r.unrecognized, 0);
  console.log(`  ⚠유도에서 미계산 타석 ${skipped} · 모르는 결과 문자열 ${unknown}`);
  console.log(
    `  유도에 든 시간 ${deriveMs.toFixed(0)}ms (${rows.length}회 · 평균 ${(deriveMs / rows.length).toFixed(0)}ms)` +
      ` — 사이트 빌드가 리그-시즌마다 한 번씩 더 얹는 비용이다`,
  );
  const gate =
    wobaChanged === 0 && wrcChanged === 0 && (median(allR) ?? Infinity) <= 2
      ? "기준 통과 — 적용"
      : "기준 초과 — 적용하지 말고 수치만 보고";
  console.log(`  → ${gate}`);
}

// ─── 폴백 1세트 ──────────────────────────────────────────────────────────

if (values.pooled) {
  console.log("\n=== 폴백용 1세트 (전 리그-시즌을 하나로 접음) ===");
  console.log("⚠**리그 문맥이 없는 자리에서만 쓴다.** 화면은 리그×시즌 계수를 쓴다");
  const origin = pool.originSum / pool.originN;
  // ⚠**표본이 0인 사건은 계수 0이다**(`--drop-roe` 가 그 상태를 만든다).
  //   0으로 나눠 NaN 을 만들면 그게 그대로 상수가 되어 화면 전체가 조용히 비어 버린다
  const runValues = Object.fromEntries(
    WOBA_EVENTS.map((e) => {
      const n = pool.eventN.get(e) ?? 0;
      return [e, n === 0 ? 0 : pool.eventSum.get(e)! / n - origin];
    }),
  ) as unknown as WobaWeights;
  const line = sumBatting(pool.lines);
  const { scale, weights } = wobaWeightsFrom(runValues, line, "(pooled)");
  console.log(`  원점 ${f3(origin)} (표본 ${pool.originN.toLocaleString()})`);
  for (const e of WOBA_EVENTS) {
    console.log(`  ${e.padEnd(7)} ${f3(weights[e])}   (표본 ${pool.eventN.get(e)!.toLocaleString()})`);
  }
  console.log(`  scale   ${f3(scale)}`);
  console.log("\n  붙여넣을 형태:");
  console.log(
    `  bb: ${f3(weights.bb)}, hbp: ${f3(weights.hbp)}, roe: ${f3(weights.roe)}, ` +
      `single: ${f3(weights.single)}, double: ${f3(weights.double)}, ` +
      `triple: ${f3(weights.triple)}, hr: ${f3(weights.hr)}`,
  );
  console.log(`  WOBA_SCALE = ${f3(scale)}`);
}

if (values.json !== undefined) {
  writeFileSync(
    values.json,
    `${JSON.stringify(
      rows.map((r) => ({
        season: r.season,
        league: r.league,
        weights: r.derived.weights,
        runValues: r.derived.runValues,
        scale: r.derived.scale,
        origin: r.origin,
        samples: r.samples,
        usedPa: r.usedPa,
        skipped: r.skipped,
        qualified: r.qualified,
        medianAbsDWoba: median(r.dWoba.map(Math.abs)),
        maxAbsDWoba: Math.max(...r.dWoba.map(Math.abs)),
        medianAbsDWrcPlus: median(r.dWrcPlus.map(Math.abs)),
        maxAbsDWrcPlus: Math.max(...r.dWrcPlus.map(Math.abs)),
        wobaLeaderChanged: r.wobaLeaderChanged,
        wrcLeaderChanged: r.wrcLeaderChanged,
      })),
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nJSON: ${values.json}`);
}

db.close();
