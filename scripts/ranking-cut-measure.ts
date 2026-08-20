#!/usr/bin/env node
/**
 * **순위표 절단이 「최소 표본」 기능을 무력화하는가 — 전 패널 실측**
 *
 * ⚠**이 파일이 존재하는 이유**: 유저의 실측은 `防御率` **한 패널**뿐이었다.
 * 「계수 지표는 원리적으로 안 걸린다」는 **추론이고, 이 저장소는 추론을 실측으로 갈음하지 않는다**
 * (작업규칙 7). 그래서 **전 패널 × 전 하한**을 재고, 재현 절차를 파일로 남긴다
 * (`scripts/asrc-asrp-measure.ts` 와 같은 규약 — 인라인 프로브는 워킹트리를 되돌리면 사라진다).
 *
 * ## 무엇을 재는가
 *
 * ⚠**「지금」 열은 워킹트리의 코드다.** 그래서 이 파일 하나로 고치기 전과 후를 같은 잣대로 잰다.
 * 「대조」 열은 **일부러 다른 알고리즘으로 쓴 참조본**(O(n²) 전수 비교)이고,
 * 고친 뒤에는 둘이 같은 답을 내야 한다 — 「대조본이 요구하는데 화면에 없는 행: 0」.
 *
 * 순위표는 (고치기 전에는) 패널마다 **규정 상위 N ∪ 전원 상위 N**만 싣고, 최소 표본 입력은
 * **이미 실린 행 안에서만** 거른다. 그래서 이런 선수가 두 화면 어디에도 없었다:
 *   - 규정 미달이라 「규정 상위 N」에 없다
 *   - 표본이 작은 선수들에게 밀려 「전원 상위 N」에도 없다
 * → **하한을 아무리 올려도 안 나온다.** 하한 기능이 노리던 바로 그 선수다.
 *
 * 그래서 이렇게 잰다. 하한 T 에 대해 **「그 하한에서의 참 상위 10」**은
 * `{분모 ≥ T}` 중 전원 순위가 가장 좋은 10명이다. 이들이 화면에 있는가를 본다.
 *
 * ⚠**하한을 임의의 격자(30·50·70…)로 훑지 않는다.** 답이 바뀌는 지점은
 * **패널에 실재하는 분모 값**뿐이므로 그 전부를 훑는다 — 「어느 하한에서도」가
 * 그때 비로소 참인 문장이 된다.
 *
 * ## 왜 「상위 10 이 나오는가」가 순위 정의를 새로 만들지 않는가
 *
 * 판정에 쓰는 것은 **행이 이미 들고 있는 두 값**(전원 순위 · 분모)뿐이다.
 * 새 정렬도, 새 동률 규칙도 만들지 않는다(M1/M3).
 *
 * 쓰는 법:
 *   node scripts/ranking-cut-measure.ts data/bb.sqlite            # 전 시즌
 *   node scripts/ranking-cut-measure.ts data/bb.sqlite 2024       # 한 시즌
 *   node scripts/ranking-cut-measure.ts data/bb.sqlite 2024 --k 30
 *
 * ⚠**대회 경계**: regular 만(CLAUDE.md §2-1). ⚠**2026 은 진행 중 시즌**이라 별표로 낸다.
 */
import { parseArgs } from "node:util";
import { openDb } from "@bb-app/store";
// ⚠**소스를 직접 부른다**(`asrc-asrp-measure.ts` 와 같은 규약) — `rankingRowsFor` 는
//   패키지 밖으로 내보내는 값이 아니고, 계측이 그것을 내보내게 만들 이유도 없다
import { loadSite, rankingRowsFor } from "../packages/web/src/query.ts";
import type { RankingRow } from "../packages/web/src/player-page.ts";

/** 보유 시즌. ⚠**늘어나면 여기만 고친다** */
const SEASONS: readonly number[] = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const IN_PROGRESS: ReadonlySet<number> = new Set([2026]);
/** 화면이 쓰는 상한. ⚠`query.ts` 의 `RANKING_PAGE_ROWS` 와 같은 수여야 한다 */
const PAGE_ROWS = 30;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: "10" },
    /** 대조본의 밴드 깊이 */
    band: { type: "string", default: "10" },
    /** `--case pacific/starter/era@429` — 그 하한에서 빠지는 사람을 이름으로 낸다 */
    case: { type: "string" },
    /**
     * `--ksweep 10,15,20,25,30` — **보증 수 k 마다 몇 행이 실리는가**를 한 번에 재다.
     * ⚠`loadSite` 가 시즌당 약 20초라 k 마다 다시 도는 것은 낭비다. 한 번 읽고 k 만 바꿔 센다.
     */
    ksweep: { type: "string" },
  },
});
const dbPath = positionals[0] ?? "data/bb.sqlite";
const onlySeason = positionals[1] === undefined ? null : Number(positionals[1]);
/** 「상위 몇 명이 화면에 있어야 하는가」 */
const TOP_K = Number(values.k);
/** 대조본의 스카이밴드 깊이 */
const BAND_K = Number(values.band);

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const rpad = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

/**
 * **k-스카이밴드** — 「어느 하한에서도 상위 k 에 들 수 있는 행」의 정확한 집합.
 *
 * 행 r 이 어떤 하한에서 상위 k 에 들려면 **가장 너그러운 하한 T = r.분모** 에서 들어야 한다
 * (T 를 더 내리면 경쟁자만 늘고, 더 올리면 r 자신이 빠진다). 그 하한에서 r 보다 앞서는 것은
 * **「분모 ≥ r.분모 이면서 전원 순위가 더 좋은」 행**뿐이다.
 * → **그런 행이 k 미만인 행 전부**가 답이고, 그 이상인 행은 **어느 하한에서도 상위 k 에 못 든다.**
 *
 * ⚠분모가 같은 행끼리는 서로를 밀어내지 않는다 — 같은 하한에서 둘 다 살아남기 때문이다.
 */
function skyband(rows: readonly RankingRow[], k: number): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.rankAll === null) continue;
    let better = 0;
    for (const s of rows) {
      if (s === r || s.rankAll === null) continue;
      if (s.value.denominator >= r.value.denominator && s.rankAll < r.rankAll) better += 1;
      if (better >= k) break;
    }
    if (better < k) out.add(r.playerId);
  }
  return out;
}

/** 하한 T 에서의 참 상위 k. ⚠**동률은 전원 순위가 이미 처리했다** — 여기서 다시 정하지 않는다 */
function trueTop(rows: readonly RankingRow[], min: number, k: number): RankingRow[] {
  return rows
    .filter((r) => r.rankAll !== null && r.value.denominator >= min)
    .sort((a, b) => (a.rankAll ?? 0) - (b.rankAll ?? 0))
    .slice(0, k);
}

/** `--ksweep` 이 모으는 것: k → 패널마다의 행 수 */
const KSWEEP: number[] = (values.ksweep ?? "").split(",").filter((x) => x !== "").map(Number);
const ksweepRows = new Map<number, number[]>();

interface PanelResult {
  season: number;
  league: string;
  category: string;
  panel: string;
  /** 값이 있는 행 수 */
  population: number;
  /** 지금 실리는 행 수 */
  nowRows: number;
  /** 답을 못 내는 하한이 몇 개인가 / 훑은 하한 수 */
  badThresholds: number;
  thresholds: number;
  /** 그 하한들에서 빠진 사람 수의 합 */
  missTotal: number;
  /** 가장 크게 빠진 하한에서 몇 명이 빠졌나 */
  missWorst: number;
  /** 그 하한 자체(원시 분모). ⚠**재현 좌표다** — 없으면 「실측했다」가 못 된다 */
  worstMin: number;
  /** 대조안으로 실릴 행 수 */
  bandRows: number;
  /** 대조안에서 답을 못 내는 하한 수 */
  bandBad: number;
  /** 최소 표본 입력이 붙는 패널인가 */
  filterable: boolean;
  /** 규정 상위 N 밖인데 밴드로 들어온 「자격자」 수 */
  qualifiedExtra: number;
  /** 대조본이 「있어야 한다」고 말하는데 지금 코드가 안 싣는 행 수. ⚠**0 이어야 한다** */
  bandNotShown: number;
}

function measurePanel(
  season: number,
  league: string,
  category: string,
  panelId: string,
  all: readonly RankingRow[],
): PanelResult {
  const withValue = all.filter((r) => r.rankAll !== null);
  const now = new Set(rankingRowsFor(all, PAGE_ROWS).map((r) => r.playerId));

  /**
   * ⚠**최소 표본 입력이 붙는 패널인가.** 개수 지표(홈런·세이브…)에는 자격 기준이 없어
   * 입력칸 자체가 안 그려진다 — 거기를 넓히면 **아무 조작으로도 닿을 수 없는 행**이 늘 뿐이고,
   * 「全員」 표에 이유 없이 31번째가 끼는 화면이 된다.
   */
  const filterable = all.some((r) => r.rank === null && r.rankAll !== null);
  // 대조안 = 지금 싣는 것 ∪ (입력이 붙는 패널이면) k-스카이밴드
  const band = filterable ? skyband(withValue, BAND_K) : new Set<string>();
  const cand = new Set([...now, ...band]);
  // ⚠**규정 상위 N 밖의 「자격자」가 밴드로 들어오면** 「規定到達のみ」 화면의 행 수가 늘어난다 —
  //   그러면 「上位N人のみ表示」라는 각주가 거짓이 된다. 몇 건인지 세어 둔다
  const headIds = new Set(all.filter((r) => r.rank !== null).slice(0, PAGE_ROWS).map((r) => r.playerId));
  const qualifiedExtra = [...band].filter(
    (id) => !headIds.has(id) && all.find((r) => r.playerId === id)?.rank != null,
  ).length;

  /**
   * ⚠**k 를 바꿔 가며 재는 것은 「실릴 행 수」뿐이다.** 「규정 상위 N ∪ 전원 상위 N」은 k 와
   * 무관하고, 스카이밴드는 k 에 대해 단조증가라 `now ∪ skyband(k)` 가 곯 그 k 에서의 화면이다.
   */
  /**
   * ⚠**`now` 에서 재면 안 된다** — 지금 코드가 이미 밴드를 포함하고 있어서
   * `now ∪ skyband(k)` 가 k 와 무관하게 같아진다(한 번 그렇게 재서 전부 +0.0% 가 나왔다).
   * 밴드를 **뺀** 바닥(규정 상위 N ∪ 전원 상위 N)을 여기서 다시 만들어 그 위에 올린다.
   */
  const baseHead = [...all].filter((r) => r.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, PAGE_ROWS);
  const baseAll = [...withValue].sort((a, b) => (a.rankAll ?? 0) - (b.rankAll ?? 0)).slice(0, PAGE_ROWS);
  const baseIds = new Set([...baseHead, ...baseAll].map((r) => r.playerId));
  for (const k of KSWEEP) {
    const cur = ksweepRows.get(k) ?? [];
    cur.push(filterable ? new Set([...baseIds, ...skyband(withValue, k)]).size : baseIds.size);
    ksweepRows.set(k, cur);
  }

  const mins = [...new Set(withValue.map((r) => r.value.denominator))].sort((a, b) => a - b);
  let badThresholds = 0, missTotal = 0, missWorst = 0, worstMin = 0, bandBad = 0;
  for (const t of mins) {
    const want = trueTop(withValue, t, TOP_K);
    const miss = want.filter((r) => !now.has(r.playerId)).length;
    if (miss > 0) {
      badThresholds += 1;
      missTotal += miss;
      if (miss > missWorst) { missWorst = miss; worstMin = t; }
    }
    if (want.some((r) => !cand.has(r.playerId))) bandBad += 1;
  }
  return {
    season, league, category, panel: panelId,
    bandNotShown: [...band].filter((id) => !now.has(id)).length,
    population: withValue.length,
    nowRows: now.size,
    badThresholds, thresholds: mins.length, missTotal, missWorst, worstMin,
    bandRows: cand.size,
    bandBad,
    filterable,
    qualifiedExtra,
  };
}

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");
const results: PanelResult[] = [];
try {
  for (const season of SEASONS) {
    if (onlySeason !== null && season !== onlySeason) continue;
    // ⚠**전량을 받는다** — 고른 뒤의 표만 보면 「없는 사람이 왜 없는지」를 물을 수 없다
    const site = loadSite(db, {
      season,
      builtOn: "1970-01-01",
      rankingRows: Number.POSITIVE_INFINITY,
    });
    for (const lg of site.ranking.leagues) {
      for (const cat of lg.categories) {
        for (const p of cat.panels) {
          results.push(measurePanel(season, lg.id, cat.id, p.id, p.rows));
          if (values.case !== undefined) {
            const m = /^([a-z]+)\/([a-z]+)\/([A-Za-z0-9]+)@(\d+)$/.exec(values.case);
            if (m !== null && m[1] === lg.id && m[2] === cat.id && m[3] === p.id) {
              const min = Number(m[4]);
              const now = new Set(rankingRowsFor(p.rows, PAGE_ROWS).map((r) => r.playerId));
              const band = skyband(p.rows.filter((r) => r.rankAll !== null), BAND_K);
              console.log(`\n## ${season} ${lg.id}/${cat.id}/${p.id} 최소 분모 ${min}`);
              for (const r of trueTop(p.rows, min, TOP_K)) {
                console.log(
                  `  전원${rpad(String(r.rankAll), 4)} 규정${rpad(r.rank === null ? "—" : String(r.rank), 4)}` +
                    ` ${pad(r.name, 12)} ${r.teamCode} ${rpad(r.value.value?.toFixed(2) ?? "—", 7)}` +
                    ` 분모${rpad(String(r.value.denominator), 6)} ${r.playerId}` +
                    ` ${now.has(r.playerId) ? "화면O" : "화면X"} ${band.has(r.playerId) ? "밴드O" : "밴드X"}`,
                );
              }
            }
          }
        }
      }
    }
    process.stderr.write(`. ${season}\n`);
  }
} finally {
  db.close();
}

/* ------------------------------------------------------------------ 출력 */

// 패널별로 접는다 — 18 리그-시즌을 한 줄로
const byPanel = new Map<string, PanelResult[]>();
for (const r of results) {
  const key = `${r.category}/${r.panel}`;
  const cur = byPanel.get(key) ?? [];
  cur.push(r);
  byPanel.set(key, cur);
}

console.log(
  `\n# 패널별 — 리그-시즌 ${results.length === 0 ? 0 : byPanel.values().next().value!.length}개 (regular · ${
    onlySeason === null ? `${SEASONS[0]}~${SEASONS.at(-1)}` : onlySeason
  })  상위 ${TOP_K} 기준 · 대조본 밴드 k=${BAND_K}\n`,
);
console.log(
  pad("부문/지표", 22) + rpad("입력", 5) + rpad("리그-시즌", 9) + rpad("걸린LS", 7) + rpad("나쁜하한", 9) +
    rpad("/전하한", 9) + rpad("최대빠짐", 9) + rpad("지금행", 7) + rpad("대조행", 7) + rpad("대조나쁨", 9),
);
const rows = [...byPanel.entries()].map(([key, rs]) => {
  const bad = rs.filter((r) => r.badThresholds > 0);
  const sum = (f: (r: PanelResult) => number): number => rs.reduce((a, r) => a + f(r), 0);
  return {
    key,
    filterable: rs.every((r) => r.filterable) ? "有" : rs.some((r) => r.filterable) ? "半" : "—",
    ls: rs.length,
    badLs: bad.length,
    badT: sum((r) => r.badThresholds),
    allT: sum((r) => r.thresholds),
    worst: Math.max(...rs.map((r) => r.missWorst)),
    now: sum((r) => r.nowRows) / rs.length,
    cand: sum((r) => r.bandRows) / rs.length,
    candBad: sum((r) => r.bandBad),
  };
});
rows.sort((a, b) => b.badLs - a.badLs || b.badT - a.badT);
for (const r of rows) {
  console.log(
    pad(r.key, 22) + rpad(r.filterable, 5) + rpad(String(r.ls), 9) + rpad(String(r.badLs), 7) + rpad(String(r.badT), 9) +
      rpad(String(r.allT), 9) + rpad(String(r.worst), 9) + rpad(r.now.toFixed(1), 7) +
      rpad(r.cand.toFixed(1), 7) + rpad(String(r.candBad), 9),
  );
}

console.log("\n# 가장 크게 빠지는 20건 — **재현 좌표**(--case 로 그대로 다시 칠 수 있다)");
[...results]
  .filter((r) => r.missWorst > 0)
  .sort((a, b) => b.missWorst - a.missWorst || b.badThresholds - a.badThresholds)
  .slice(0, 20)
  .forEach((r) => {
    console.log(
      `  ${r.season} --case ${r.league}/${r.category}/${r.panel}@${r.worstMin}` +
        `  → 상위${TOP_K} 중 ${r.missWorst}명이 화면에 없다(나쁜 하한 ${r.badThresholds}/${r.thresholds})`,
    );
  });

console.log("\n# 합계");
const bad = results.filter((r) => r.badThresholds > 0);
const filt = results.filter((r) => r.filterable);
console.log(`최소 표본 입력이 붙는 패널-리그-시즌: ${filt.length} / ${results.length}`);
console.log(`  그중 걸리는 것: ${filt.filter((r) => r.badThresholds > 0).length} / ${filt.length}`);
console.log(`입력이 안 붙는데 걸리는 것(= 넓혀도 닿을 수 없다): ${bad.length - filt.filter((r) => r.badThresholds > 0).length}`);
console.log(`걸리는 패널(부문/지표): ${rows.filter((r) => r.badLs > 0).length} / ${rows.length}`);
console.log(`⚠규정 상위 ${PAGE_ROWS} 밖의 자격자가 밴드로 들어오는 건수: ${results.reduce((a, r) => a + r.qualifiedExtra, 0)}`);
// ⚠**대조본과 생산 코드를 맞대 본다.** 둘은 **일부러 다른 알고리즘**이다(이쪽은 O(n²) 전수 비교 ·
//   query.ts 의 `everTop` 은 분모 내림차순 한 번 훑기). 같은 답이 나와야 한다
console.log(`대조본이 요구하는데 화면에 없는 행: ${results.reduce((a, r) => a + r.bandNotShown, 0)} (0 이어야 한다)`);
console.log(`지금 평균 행: ${(results.reduce((a, r) => a + r.nowRows, 0) / results.length).toFixed(1)}`);
console.log(`대조 평균 행: ${(results.reduce((a, r) => a + r.bandRows, 0) / results.length).toFixed(1)}`);
console.log(`대조 최대 행: ${Math.max(...results.map((r) => r.bandRows))}`);
console.log(`대조안에서 답 못 내는 하한: ${results.reduce((a, r) => a + r.bandBad, 0)}`);

if (KSWEEP.length > 0) {
  console.log("\n# 보증 수 k 마다의 행 수 — **k 를 올리면 페이지가 그만큼 커진다**");
  console.log(pad("k", 5) + rpad("평균행", 8) + rpad("최대행", 8) + rpad("합계행", 9) + rpad("첫 k 대비", 12));
  const kbase = ksweepRows.get(KSWEEP[0]!)!.reduce((a, b) => a + b, 0);
  for (const k of KSWEEP) {
    const rs = ksweepRows.get(k)!;
    const sum = rs.reduce((a, b) => a + b, 0);
    console.log(
      pad(String(k), 5) + rpad((sum / rs.length).toFixed(1), 8) + rpad(String(Math.max(...rs)), 8) +
        rpad(String(sum), 9) + rpad(`+${(((sum / kbase) - 1) * 100).toFixed(1)}%`, 12),
    );
  }
}

console.log("\n# 시즌별 행 수(패널 합계 — 페이지 크기의 대리 지표)");
for (const s of SEASONS) {
  const rs = results.filter((r) => r.season === s);
  if (rs.length === 0) continue;
  const now = rs.reduce((a, r) => a + r.nowRows, 0);
  const cand = rs.reduce((a, r) => a + r.bandRows, 0);
  console.log(
    `${s}${IN_PROGRESS.has(s) ? "*" : " "}  지금 ${rpad(String(now), 6)}  대조 ${rpad(String(cand), 6)}  +${
      ((cand / now - 1) * 100).toFixed(1)
    }%`,
  );
}
