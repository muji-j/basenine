#!/usr/bin/env node
/**
 * **연속 기록의 리그 전체 목록 — 화면을 정하기 전에 재는 것**
 *
 * ⚠**이 파일이 존재하는 이유**: 표시 하한·행 수·어느 축을 실을지를 **추론으로 정하면**
 * 「하한이 아무것도 안 거르는」 표나 「한 리그에 3행뿐인」 표가 나온다. 정의서 §1-7 이
 * 「화면 설계와 같이 정하라」고 남긴 자리이고, 그 설계에 필요한 수가 여기 있다.
 *
 * 두 모드:
 *   `--mode dist`(기본) — 축×리그×시즌마다 **하한별 후보 수** · 「以上」 수 · 리그를 넘는 마루 수 · 최댓값
 *   `--mode cut`        — **순위 K 로 자를 때** 실제로 실리는 행 수와, 그중 「以上」이 몇 행인가.
 *                          ⚠**상한이 컷에 닿는 「以上」 행을 같이 센다** — 하한으로만 자르면
 *                          **더 길 수도 있는 기록이 조용히 빠진다.**
 *
 * ⚠**대회 경계**: regular 만(CLAUDE.md §2-1). ⚠**2026 은 진행 중 시즌**이라 별표로 낸다.
 *
 * 쓰는 법:
 *   node scripts/streak-ranking-measure.ts data/bb.sqlite
 *   node scripts/streak-ranking-measure.ts data/bb.sqlite 2025 --mode cut
 */
import { parseArgs } from "node:util";
import { openDb } from "@bb-app/store";
import { battingStreaks, pitchingStreaks, rankStreaks } from "@bb-app/aggregate";
import { TEAMS } from "@bb-app/domain";
// ⚠**프로덕션이 쓰는 그 함수를 그대로 쓴다**(M1) — 같은 뜻의 SQL 을 여기서 다시 적지 않는다.
//   `ranking-cut-measure.ts` 가 `query.ts` 를 직접 import 하는 선례를 따른다
import { battingTeamOn, pitchingTeamOn } from "../packages/web/src/query.ts";

const SEASONS: readonly number[] = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const IN_PROGRESS: ReadonlySet<number> = new Set([2026]);
const COMPETITION = "regular";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { mode: { type: "string", default: "dist" } },
});
const dbPath = positionals[0] ?? "data/bb.sqlite";
const only = positionals[1] === undefined ? null : Number(positionals[1]);
const MODE = values.mode;

const LEAGUE_OF = new Map(TEAMS.map((t) => [t.code, t.league] as const));
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const rpad = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

// ⚠**시계를 안 읽는다**(M6) — 마이그레이션 기록용 문자열이라 고정값을 준다(`ranking-cut-measure.ts` 와 같다)
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

// ⚠**배정 구단은 프로덕션 함수를 그대로 쓴다**(M1 · 2026-09-07 이중 검토 P3).
//   예전에는 이 파일이 **같은 뜻의 SQL 을 자기 손으로 다시 적었고**, 타자 쪽에만
//   `AND b.pa > 0` 이 붙어 있었다 — `battingTeamOn` 에는 그 조건이 **없다.**
//   그 상태로 잰 수를 설계서 §7 이 인용했으니, **프로덕션과 다른 쿼리로 얻은 수**였다.
//   재는 도구가 재는 대상과 어긋나면 그 측정은 아무것도 말하지 않는다.
//   아래 두 조회는 **「그 기간에 구단이 몇 개였나」 전용**이고 배정에는 안 쓴다.

/** 그 기간에 이 투수가 던진 **구단 전부**(마루가 리그를 넘는지 보기 위해) */
const teamsInSpanStmt = db.raw.prepare(
  `SELECT DISTINCT CASE pl.side WHEN 'home' THEN g.home_code ELSE g.away_code END AS code
     FROM pitching_line pl JOIN game g ON g.game_id = pl.game_id
    WHERE pl.player_id = ? AND g.season = ? AND g.competition = ? AND g.status = 'played'
      AND g.game_date BETWEEN ? AND ?`,
);
/**
 * 타자가 그 기간에 선 구단 전부 — **리그를 넘었는지**를 보기 위한 것이다.
 * ⚠**배정 구단은 여기서 안 정한다** — `battingTeamOn` 이 정한다(위).
 * ⚠**`pa > 0` 을 걸지 않는다** — 프로덕션이 안 걸기 때문이다. 걸면 대수비만 나간 경기가
 *   여기서만 빠져 「구단이 둘 이상」 판정이 프로덕션보다 느슨해진다.
 */
const batTeamsStmt = db.raw.prepare(
  `SELECT DISTINCT CASE b.side WHEN 'home' THEN g.home_code ELSE g.away_code END AS code
     FROM batting_line b JOIN game g ON g.game_id = b.game_id
    WHERE b.player_id = ? AND g.season = ? AND g.competition = ? AND g.status = 'played'
      AND g.game_date BETWEEN ? AND ?`,
);

interface Row {
  playerId: string;
  league: string;
  /** 주 값. 이닝 축은 **하한 아웃 수** */
  value: number;
  /** 상한 아웃 수(이닝 축만 뜻이 있다) */
  upper: number;
  outs: number;
  to: string;
  rankable: boolean;
  crossLeague: boolean;
  /** 마루 기간에 **구단이 둘 이상**이었나 — 「그때 소속」이 한 값으로 안 정해지는 행 */
  multiTeam: boolean;
}

const THRESH = [1, 2, 3, 5, 8, 10, 12, 15, 20] as const;
const CUTS = [5, 10, 15, 20] as const;

function rowsFor(season: number): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  const scope = { fromSeason: season, toSeason: season, competition: COMPETITION };
  const psa: Row[] = [];
  const psi: Row[] = [];
  for (const [playerId, s] of pitchingStreaks(db, scope)) {
    const add = (arr: Row[], from: string, to: string, value: number, upper: number, outs: number, rankable: boolean): void => {
      const code = pitchingTeamOn(db, playerId, season, COMPETITION, to);
      const lg = code === null ? undefined : LEAGUE_OF.get(code);
      if (lg === undefined) return;
      const codes = teamsInSpanStmt.all(playerId, season, COMPETITION, from, to) as { code: string }[];
      const lgs = new Set(codes.map((c) => LEAGUE_OF.get(c.code)));
      arr.push({ playerId, league: lg, value, upper, outs, to, rankable, crossLeague: lgs.size > 1, multiTeam: codes.length > 1 });
    };
    const best = s.best;
    if (best !== null) add(psa, best.from, best.to, best.appearances, best.appearances, best.interiorOuts, true);
    const bi = s.bestInnings;
    if (bi !== null) {
      // ⚠**시즌 모드에서 `atRangeStart` 는 「以上」이 아니다**(`PitchingStreak.atRangeStart` 주석) —
      //   그건 「시즌 시작」이라는 뜻이고 화면이 이미 「今季」라고 말한다. `exact` 만이 사유다.
      // ⚠**기간은 이닝 축의 것을 쓴다**(M1 · 프로덕션과 같게) — 등판 축의 것을 쓰면
      //   구단 배정과 「리그를 넘었나」 판정이 화면과 다른 경기를 보게 된다
      add(
        psi,
        bi.innings.from,
        bi.innings.to,
        bi.innings.lowerOuts,
        bi.innings.upperOuts,
        bi.innings.lowerOuts,
        bi.innings.exact,
      );
    }
  }
  out.set("PSA-登板", psa);
  out.set("PSI-回(下限)", psi);

  const hit: Row[] = [];
  const ob: Row[] = [];
  const hitless: Row[] = [];
  for (const [, s] of battingStreaks(db, season, COMPETITION, "9999-12-31")) {
    const push = (arr: Row[], best: number, from: string | null, to: string | null): void => {
      if (best <= 0 || from === null || to === null) return;
      const codes = batTeamsStmt.all(s.playerId, season, COMPETITION, from, to) as { code: string }[];
      if (codes.length === 0) return;
      const lgs = new Set(codes.map((c) => LEAGUE_OF.get(c.code)));
      // ⚠**배정은 프로덕션과 같은 함수다**(M1) — 「마루의 마지막 경기의 구단」이지
      //   「기간 안에서 가장 늦은 경기의 구단」이 아니다
      const code = battingTeamOn(db, s.playerId, season, COMPETITION, to);
      const lg = code === null ? undefined : LEAGUE_OF.get(code);
      if (lg === undefined) return;
      arr.push({ playerId: s.playerId, league: lg, value: best, upper: best, outs: 0, to, rankable: true, crossLeague: lgs.size > 1, multiTeam: codes.length > 1 });
    };
    push(hit, s.hitting.best, s.hitting.bestFrom, s.hitting.bestTo);
    push(ob, s.onBase.best, s.onBase.bestFrom, s.onBase.bestTo);
    push(hitless, s.hitless.best, s.hitless.bestFrom, s.hitless.bestTo);
  }
  out.set("試合安打", hit);
  out.set("試合出塁", ob);
  out.set("試合無安打", hitless);
  return out;
}

for (const season of SEASONS) {
  if (only !== null && season !== only) continue;
  const mark = IN_PROGRESS.has(season) ? "*" : " ";
  console.log(`\n=== ${season}${mark} ===`);
  const byAxis = rowsFor(season);

  for (const [label, rows] of byAxis) {
    for (const lg of ["central", "pacific"] as const) {
      const mine = rows.filter((r) => r.league === lg);
      if (MODE === "dist") {
        const sorted = [...mine].sort((a, b) => b.value - a.value);
        const counts = THRESH.map((t) => sorted.filter((r) => r.value >= t).length);
        console.log(
          `  ${pad(label, 13)} ${pad(lg, 8)} ` +
            THRESH.map((t, i) => `>=${t}:${rpad(String(counts[i]), 3)}`).join(" ") +
            ` | nonrank ${rpad(String(sorted.filter((r) => !r.rankable).length), 3)}` +
            ` | crosslg ${rpad(String(sorted.filter((r) => r.crossLeague).length), 2)}` +
            ` | max ${sorted[0]?.value ?? "-"}`,
        );
      } else {
        const ranked = rankStreaks(mine.map((r) => ({ ...r, playerId: r.playerId, value: r.value, outs: r.outs, to: r.to, rankable: r.rankable })));
        const parts: string[] = [];
        for (const k of CUTS) {
          // 컷: 순위 K 이하인 확정 행 + **상한이 그 경계에 닿는 「以上」 행**
          const kept = ranked.filter((r) => r.rank !== null && r.rank <= k);
          const floor = kept.length === 0 ? Infinity : Math.min(...kept.map((r) => r.value));
          const maybe = ranked.filter((r) => r.rank === null && r.upper >= floor);
          const shown = [...kept, ...maybe];
          const mt = shown.filter((r) => r.multiTeam).length;
          parts.push(
            `K${k}:${rpad(String(shown.length), 3)}(cut ${rpad(String(floor === Infinity ? "-" : floor), 3)}` +
              ` ijou ${rpad(String(maybe.length), 2)} multiteam ${rpad(String(mt), 2)})`,
          );
        }
        console.log(`  ${pad(label, 13)} ${pad(lg, 8)} ${parts.join(" ")}`);
      }
    }
  }
}
db.close();
