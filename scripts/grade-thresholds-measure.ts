#!/usr/bin/env node
/**
 * **등급 임계값(색)을 다시 뽑고, 바꾼 결과를 실측한다.**
 *
 * ⚠**이 파일이 존재하는 이유**: `packages/web/src/grade.ts` 의 wOBA·wRC+ 임계값은
 * **2026-08-15 에 1.02 공개 계수로 잰 분포**에서 나왔다. 2026-08-20 에 wOBA 계수를
 * **리그×시즌 유도값**으로 갈았는데(`docs/metrics/README.md` §4) **임계값은 안 갈았다** —
 * 즉 **재는 자의 눈금이 바뀌었는데 눈금 위의 표시는 그대로**였다.
 * 성적이 그대로인데 색이 바뀐 선수가 실제로 나왔고, 그건 그 파일 표제부가
 * 「만들면 안 된다」고 적어 둔 바로 그 날이다.
 *
 * ⚠**그래서 다시 뽑는 이유는 「시간이 흘러서」가 아니다.** 시간 드리프트로 다시 뽑으면
 * 「어제는 良い였는데」가 매일 난다. 여기서 하는 것은 **같은 모집단을 새 자로 다시 재는 것**이고,
 * 그래서 **모집단의 기준일을 2026-08-15 에 고정한다**(`BASIS.through`).
 * 그러면 바뀌는 변수가 **계수 하나뿐**이 된다.
 *
 * ## 왜 wOBA · wRC+ 만 다시 뽑는가
 *
 * 계수 변경이 닿는 것은 `LeagueConstants.wobaWeights` · `wobaScale` 이고,
 * 그것을 쓰는 지표는 **wOBA · wRAA · wRC+** 뿐이다(§4 「영향 범위」).
 * 나머지 타자 지표(打率·出塁率·長打率·OPS·ISO·BB%·K%)와 투수 지표는 **입력이 그대로**다.
 * ⚠**그런데 그것들을 지금 다시 뽑으면 값이 움직인다** — 그동안 백필·파서 수정으로
 * DB 가 달라졌기 때문이다(실측: 같은 157명 모집단에서 打率 20% 분위가 문서의 .225 대 지금 .2216).
 * **그건 계수와 무관한 드리프트이고, 그것까지 임계값에 실으면 위에 적은 「매일 색이 바뀌는 날」을
 * 스스로 만드는 것이다.** 그래서 **건드리는 것은 wOBA·wRC+ 둘뿐**이다.
 *
 * 쓰는 법:
 *   node scripts/grade-thresholds-measure.ts data/bb.sqlite            # 분위수 + 효과 실측
 *   node scripts/grade-thresholds-measure.ts data/bb.sqlite --basis    # 분위수만(빠르다)
 */
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import {
  aggregateSeason,
  battingEntryOf,
  blendConstants,
  buildLeagues,
  buildRunExpectancy,
  deriveRunValues,
} from "@bb-app/aggregate";
import { sumBatting, wobaRawWith } from "@bb-app/metrics";
import type { LeagueConstants, WobaWeights } from "@bb-app/metrics";
import { BATTER_MIN, SCALES } from "../packages/web/src/grade.ts";

/**
 * **기준 모집단** — `grade.ts` 의 `GROUP_BASIS` 가 화면에 적는 것과 같아야 한다.
 * ⚠`through` 를 옮기지 마라. 옮기는 순간 「계수만 바뀌었다」가 거짓이 된다.
 */
export const BASIS = { season: 2026, through: "2026-08-15", minPa: 100 } as const;

/**
 * 화면 문구(`GROUP_BASIS`)가 쓰는 일본어 날짜 표기.
 * ⚠**`BASIS.through` 에서 만든다** — 두 벌로 적으면 어느 날 한쪽만 고쳐진다(M1).
 */
export const BASIS_LABEL_DATE = `${Number(BASIS.through.slice(0, 4))}年${Number(BASIS.through.slice(5, 7))}月${Number(BASIS.through.slice(8, 10))}日`;

/**
 * **1.02 공개 계수** — 2026-08-20 이전의 화면이 쓰던 값.
 * ⚠**대조에만 쓴다.** 이 값으로 무언가를 계산해 내보내지 않는다(§6-C 로 의존을 끊었다).
 */
const OLD_WEIGHTS: WobaWeights = {
  bb: 0.692, hbp: 0.73, roe: 0.966, single: 0.865, double: 1.334, triple: 1.725, hr: 2.065,
};
const OLD_SCALE = 1.24;

/** 2026-08-15 에 정한 임계값. **대조용 역사 기록**이다 — 지금 값은 `SCALES` 에서 읽는다 */
export const THRESHOLDS_2026_08_15 = {
  woba: [0.275, 0.3, 0.315, 0.34],
  wrcPlus: [75, 95, 110, 133],
} as const;

/** 임계값으로 삼는 분위. **오름차순** */
const P = [0.2, 0.4, 0.6, 0.8] as const;

/**
 * **최근접 순위법**(nearest-rank) — `p` 분위는 정렬한 표본의 `ceil(p·n)` 번째다.
 *
 * ⚠**보간하지 않는다.** 임계값은 「이 값 이상이면 한 칸 위」라는 **자르는 선**이고,
 * 자르는 선은 실재하는 관측이어야 「몇 명이 어느 쪽인가」를 셀 수 있다.
 * ⚠**2026-08-15 산출이 어느 법을 썼는지는 기록에 없다** — 그래서 여기 적어 둔다.
 */
export function quantiles(xs: readonly number[]): number[] {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) throw new RangeError("표본이 0이다 — 분위수를 만들 수 없다");
  return P.map((p) => s[Math.max(0, Math.ceil(p * s.length) - 1)]!);
}

/**
 * **읽기 쉬운 수로 반올림한다.** 2026-08-15 산출도 그렇게 했는데 **어떻게 했는지는 안 적혀 있었다.**
 * 그래서 여기서 정한다 — 그때 남은 검산(`wRC+ 74.9/95.2/109.9/133.4 → 75/95/110/133`)과 맞는 눈금이다.
 *
 * @param step 눈금. wOBA 는 `0.005` · wRC+ 는 `1`
 */
export function roundTo(x: number, step: number): number {
  // 부동소수 잔재를 남기지 않는다 — 0.315000000000000002 같은 값이 문서 대조에서 어긋난다
  return Number((Math.round(x / step) * step).toFixed(6));
}

/** wOBA 눈금 0.005 · wRC+ 눈금 1 */
export const ROUND_STEP = { woba: 0.005, wrcPlus: 1 } as const;

export interface BasisRow {
  playerId: string;
  pa: number;
  /** wOBA 값과 **그 분모**(등급의 표본 수) */
  woba: { value: number; denominator: number };
  wrcPlus: { value: number; denominator: number };
}

/**
 * 한 시즌의 타자 성적을 **화면과 같은 상수**로 계산한다.
 *
 * @param weights `undefined` 면 그 리그·시즌에서 유도한 계수(=지금 화면).
 *   주면 그 계수로 덮어쓴다(=옛 화면 재현).
 */
export function seasonRows(
  db: Db,
  season: number,
  through: string,
  weights?: { weights: WobaWeights; scale: number },
): BasisRow[] {
  const agg = aggregateSeason(db, season, "regular", through);
  const runValues = new Map<League, WobaWeights>();
  for (const league of ["central", "pacific"] as const) {
    const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
    const re = buildRunExpectancy(db, season, league, codes, "regular", through);
    if (re.totalPa === 0) continue;
    runValues.set(league, deriveRunValues(db, re, codes, "regular", through).runValues);
  }
  const bundles = buildLeagues(agg, (lg) => runValues.get(lg));

  const constants = new Map<League, LeagueConstants>();
  for (const b of bundles) {
    if (weights === undefined) {
      constants.set(b.league, b.constants);
      continue;
    }
    // ⚠**리그 평균 wOBA 도 같이 갈아야 한다** — wRC+ 의 기준선이라 한쪽만 갈면 단위가 어긋난다
    const leagueLine = sumBatting(b.batting.map((x) => x.line));
    constants.set(b.league, {
      ...b.constants,
      averageWoba: wobaRawWith(leagueLine, weights.weights)!,
      wobaWeights: weights.weights,
      wobaScale: weights.scale,
    });
  }

  // ⚠**리그를 넘은 선수는 상수를 섞는다** — `loadSite` 의 `constantsFor` 와 같은 규칙이다(M1)
  const paBy = new Map<string, number>();
  for (const b of agg.battingByLeague) paBy.set(`${b.playerId}|${b.league}`, b.line.pa);

  return agg.batting.map((p) => {
    const lc = blendConstants(
      [...constants.entries()].map(([lg, c]) => ({
        constants: c,
        weight: paBy.get(`${p.playerId}|${lg}`) ?? 0,
      })),
    );
    const e = battingEntryOf(p, lc);
    return {
      playerId: p.playerId,
      pa: p.line.pa,
      woba: { value: e.woba.value ?? Number.NaN, denominator: e.woba.denominator },
      wrcPlus: { value: e.wrcPlus.value ?? Number.NaN, denominator: e.wrcPlus.denominator },
    };
  });
}

/** 기준 모집단(2026 · `through` 고정 · 100타석 이상)의 분포 */
export function basisRows(db: Db, weights?: { weights: WobaWeights; scale: number }): BasisRow[] {
  return seasonRows(db, BASIS.season, BASIS.through, weights).filter((r) => r.pa >= BASIS.minPa);
}

/** 기준 모집단에서 다시 뽑은 임계값. **`grade.ts` 에 적히는 수가 이것이다** */
export function derivedThresholds(db: Db): {
  n: number;
  raw: { woba: number[]; wrcPlus: number[] };
  rounded: { woba: number[]; wrcPlus: number[] };
} {
  const rows = basisRows(db);
  const raw = {
    woba: quantiles(rows.map((r) => r.woba.value).filter(Number.isFinite)),
    wrcPlus: quantiles(rows.map((r) => r.wrcPlus.value).filter(Number.isFinite)),
  };
  return {
    n: rows.length,
    raw,
    rounded: {
      woba: raw.woba.map((x) => roundTo(x, ROUND_STEP.woba)),
      wrcPlus: raw.wrcPlus.map((x) => roundTo(x, ROUND_STEP.wrcPlus)),
    },
  };
}

/**
 * 등급 칸 번호(0=とても悪い … 4=とても良い). wOBA·wRC+ 는 **높을수록 좋다**.
 * ⚠`gradeOf` 와 같은 계단이어야 한다 — 시험이 둘의 일치를 못 박는다(M1).
 */
export function gradeIndex(value: number, thresholds: readonly number[], sample: number): number | null {
  if (!Number.isFinite(value) || sample < BATTER_MIN) return null;
  let step = 0;
  for (const t of thresholds) if (value >= t) step += 1;
  return step;
}

const isCli = process.argv[1] !== undefined && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? " ",
);

if (isCli) {
  const dbPath = process.argv[2] ?? "data/bb.sqlite";
  const basisOnly = process.argv.includes("--basis");
  const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");
  try {
    const fmtW = (xs: readonly number[]): string => xs.map((x) => x.toFixed(4)).join(" ");
    const fmtR = (xs: readonly number[]): string => xs.map((x) => x.toFixed(1)).join(" ");

    const oldBasis = basisRows(db, { weights: OLD_WEIGHTS, scale: OLD_SCALE });
    const d = derivedThresholds(db);
    console.log(`기준 모집단: ${BASIS.season} 정규 · ${BASIS.through} 시점 · ${BASIS.minPa}타석 이상 **${d.n}명**`);
    console.log(`  옛 계수(1.02) 분위수   wOBA ${fmtW(quantiles(oldBasis.map((r) => r.woba.value)))} · wRC+ ${fmtR(quantiles(oldBasis.map((r) => r.wrcPlus.value)))}`);
    console.log(`  새 계수(유도) 분위수   wOBA ${fmtW(d.raw.woba)} · wRC+ ${fmtR(d.raw.wrcPlus)}`);
    console.log(`  옛 임계값             wOBA ${fmtW(THRESHOLDS_2026_08_15.woba)} · wRC+ ${fmtR(THRESHOLDS_2026_08_15.wrcPlus)}`);
    console.log(`  새 임계값(반올림 후)   wOBA ${fmtW(d.rounded.woba)} · wRC+ ${fmtR(d.rounded.wrcPlus)}`);
    console.log(`  지금 grade.ts        wOBA ${fmtW(SCALES.batter["woba"]!.thresholds)} · wRC+ ${fmtR(SCALES.batter["wrcPlus"]!.thresholds)}`);

    if (!basisOnly) {
      /**
       * **화면이 실제로 색칠하는 집단**에서 등급이 몇 명 바뀌는가.
       * ⚠기준 모집단(100타석)이 아니라 **표본 하한(BATTER_MIN)** 이 화면의 조건이다.
       */
      const seasons = (
        db.raw
          .prepare("SELECT DISTINCT season AS s FROM game WHERE competition='regular' AND status='played' ORDER BY s")
          .all() as { s: number }[]
      ).map((r) => r.s);
      console.log(`\n등급이 바뀐 인원 — 전 시즌(${seasons.join("·")}) · 정규 · 표본 ${BATTER_MIN} 이상`);
      console.log("시즌     분모   ①옛계수·옛임계 → ②새계수·옛임계   ②→③새임계   ①→③(유저가 겪은 것)");
      const total = { n: 0, a: 0, b: 0, c: 0, wn: 0, wa: 0, wb: 0, wc: 0 };
      for (const season of seasons) {
        const now = seasonRows(db, season, "9999-12-31");
        const was = seasonRows(db, season, "9999-12-31", { weights: OLD_WEIGHTS, scale: OLD_SCALE });
        const byId = new Map(was.map((r) => [r.playerId, r]));
        let n = 0, a = 0, b = 0, c = 0, wn = 0, wa = 0, wb = 0, wc = 0;
        for (const r of now) {
          const o = byId.get(r.playerId);
          if (o === undefined) continue;
          for (const key of ["woba", "wrcPlus"] as const) {
            const oldT = THRESHOLDS_2026_08_15[key];
            const newT = SCALES.batter[key]!.thresholds;
            const g1 = gradeIndex(o[key].value, oldT, o[key].denominator);
            const g2 = gradeIndex(r[key].value, oldT, r[key].denominator);
            const g3 = gradeIndex(r[key].value, newT, r[key].denominator);
            if (g1 === null || g2 === null || g3 === null) continue;
            if (key === "woba") {
              wn += 1;
              if (g1 !== g2) wa += 1;
              if (g2 !== g3) wb += 1;
              if (g1 !== g3) wc += 1;
            } else {
              n += 1;
              if (g1 !== g2) a += 1;
              if (g2 !== g3) b += 1;
              if (g1 !== g3) c += 1;
            }
          }
        }
        total.n += n; total.a += a; total.b += b; total.c += c;
        total.wn += wn; total.wa += wa; total.wb += wb; total.wc += wc;
        console.log(
          `${season}  wOBA ${String(wn).padStart(4)}   ${String(wa).padStart(4)}          ${String(wb).padStart(4)}        ${String(wc).padStart(4)}`,
        );
        console.log(
          `        wRC+ ${String(n).padStart(4)}   ${String(a).padStart(4)}          ${String(b).padStart(4)}        ${String(c).padStart(4)}`,
        );
      }
      console.log(
        `합계    wOBA ${String(total.wn).padStart(4)}   ${String(total.wa).padStart(4)}          ${String(total.wb).padStart(4)}        ${String(total.wc).padStart(4)}`,
      );
      console.log(
        `        wRC+ ${String(total.n).padStart(4)}   ${String(total.a).padStart(4)}          ${String(total.b).padStart(4)}        ${String(total.c).padStart(4)}`,
      );
    }
  } finally {
    db.close();
  }
}
