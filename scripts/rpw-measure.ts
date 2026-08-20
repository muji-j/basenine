#!/usr/bin/env node
/**
 * **RPW(1승의 값)를 리그·시즌마다 잰다** — `packages/metrics/src/park.ts` 의 근거.
 *
 * `RPW = 10 × √((양팀 합계 득점 ÷ 경기) ÷ 9)`
 *
 * 쓰는 법:  node scripts/rpw-measure.ts data/bb.sqlite
 *
 * ⚠**「리그내 경기만」이 조건이다.** 교류전을 넣으면 두 리그가 서로를 오염시켜
 *   「그 리그의 득점 환경」이라는 말이 성립하지 않는다. 이 스크립트는 **양쪽 다** 내서
 *   차이를 눈에 보이게 한다 — 「교류전을 뺐다」가 얼마짜리 선택인지 수로 말할 수 있어야 한다.
 * ⚠**대회 경계**: `competition='regular' AND status='played'`(§2-1).
 * ⚠**한 경기는 한 번만 센다.** 홈·원정 양쪽에서 세면 경기 수가 두 배가 되고 RPW 가 √2 배 작아진다.
 * ⚠**득점이 NULL 인 경기는 분모에서도 뺀다**(M11) — 0점으로 때우면 그 리그가 투수 친화로 보인다.
 * ⚠**진행 중 시즌은 별표로 낸다** — 경기가 들어올 때마다 값이 움직인다.
 */
import { DatabaseSync } from "node:sqlite";
import { leagueOf, regularSeasonGames } from "@bb-app/domain";
import { runsPerWin, sumRunEnvironments } from "@bb-app/metrics";
import type { RunEnvironment } from "@bb-app/metrics";

const dbPath = process.argv[2];
if (dbPath === undefined) {
  console.error("usage: node scripts/rpw-measure.ts <db-path>");
  process.exit(2);
}

/**
 * ⚠**읽기 전용으로 연다.** `openDb` 는 **미적용 마이그레이션을 적용한다** — 즉 쓴다.
 * 계측이 DB 를 바꾸면 「잰 것」과 「있던 것」이 갈리고, 이 워크트리는 여러 에이전트가 함께 쓴다.
 */
const db = new DatabaseSync(dbPath, { readOnly: true });

interface GameRow {
  season: number;
  awayCode: string;
  homeCode: string;
  runs: number | null;
}

const games = (
  db
    .prepare(
      `SELECT season, away_code AS awayCode, home_code AS homeCode,
              CASE WHEN away_runs IS NULL OR home_runs IS NULL THEN NULL
                   ELSE away_runs + home_runs END AS runs
         FROM game
        WHERE competition = 'regular' AND status = 'played'`,
    )
    .all() as unknown as GameRow[]
).map((r) => ({ ...r, season: Number(r.season) }));

/** 완결 시즌 — 12구단 전부가 `regularSeasonGames(시즌)` 을 치렀는가. ⚠**2020 은 120경기다** */
const played = new Map<number, Map<string, number>>();
for (const g of games) {
  const m = played.get(g.season) ?? new Map<string, number>();
  for (const c of [g.awayCode, g.homeCode]) m.set(c, (m.get(c) ?? 0) + 1);
  played.set(g.season, m);
}
const settled = new Set(
  [...played]
    .filter(([s, m]) => m.size === 12 && Math.min(...m.values()) >= regularSeasonGames(s))
    .map(([s]) => s),
);

type Scope = "리그내" | "교류전 포함";
const buckets = new Map<string, RunEnvironment>();
let runsUnknown = 0;
const add = (key: string, runs: number): void => {
  const cur = buckets.get(key) ?? { runs: 0, games: 0 };
  buckets.set(key, { runs: cur.runs + runs, games: cur.games + 1 });
};

for (const g of games) {
  if (g.runs === null) {
    runsUnknown += 1;
    continue;
  }
  const away = leagueOf(g.awayCode);
  const home = leagueOf(g.homeCode);
  if (away === home) add(`${g.season}\t${home}\t리그내`, g.runs);
  // 교류전은 **양 리그 모두**의 득점 환경에 들어간다(그래서 두 번 센다 — 다른 분모다)
  add(`${g.season}\t${home}\t교류전 포함`, g.runs);
  if (away !== home) add(`${g.season}\t${away}\t교류전 포함`, g.runs);
}

const seasons = [...new Set(games.map((g) => g.season))].sort((a, b) => a - b);
const LEAGUES = ["central", "pacific"] as const;

console.log(`# RPW — 정규 · 실시 · ${seasons.length}시즌 · 득점 미상 ${runsUnknown}경기(분모에서 뺐다)`);
console.log(`완결 시즌: ${[...settled].sort().join(" ")} · 진행 중: ${seasons.filter((s) => !settled.has(s)).join(" ") || "없음"}`);
console.log("");
console.log("season\tleague\t리그내경기\t득점\t경기당\tRPW\t|\t교류전포함경기\tRPW");
for (const s of seasons) {
  for (const l of LEAGUES) {
    const inner = buckets.get(`${s}\t${l}\t리그내`) ?? { runs: 0, games: 0 };
    const all = buckets.get(`${s}\t${l}\t교류전 포함`) ?? { runs: 0, games: 0 };
    const a = runsPerWin(inner);
    const b = runsPerWin(all);
    const mark = settled.has(s) ? "" : "*";
    console.log(
      `${s}${mark}\t${l}\t${inner.games}\t${inner.runs}\t${a.runsPerGame?.toFixed(3) ?? "-"}\t` +
        `${a.value?.toFixed(3) ?? "-"}\t|\t${all.games}\t${b.value?.toFixed(3) ?? "-"}`,
    );
  }
}

console.log("");
console.log("## 완결 시즌 합계 — **시즌을 뭉치면 다른 수다.** 비교용으로만 본다");
for (const l of LEAGUES) {
  const parts = [...settled].map((s) => buckets.get(`${s}\t${l}\t리그내`) ?? { runs: 0, games: 0 });
  const r = runsPerWin(sumRunEnvironments(parts));
  console.log(`${l}\t${r.games}경기\t경기당 ${r.runsPerGame?.toFixed(3) ?? "-"}\tRPW ${r.value?.toFixed(3) ?? "-"}`);
}

/**
 * ⚠**「교류전을 뺐다」가 얼마짜리 선택인가** — 수로 말할 수 있어야 기각도 채택도 근거가 된다.
 *
 * ⚠**완결 시즌과 전체를 따로 낸다.** 진행 중 시즌이 섞인 수를 문서·시험에 옮기면
 * 경기가 들어올 때마다 낡는다 — 실제로 이 수를 그대로 옮겼다가
 * `packages/metrics/test/park-db.test.ts` 가 잡았다(전체 0.216 은 2026 것이다).
 */
console.log("");
for (const [label, only] of [
  ["완결 시즌만", settled],
  ["전 시즌(진행 중 포함)", new Set(seasons)],
] as const) {
  const diffs: number[] = [];
  for (const s of seasons) {
    if (!only.has(s)) continue;
    for (const l of LEAGUES) {
      const a = runsPerWin(buckets.get(`${s}\t${l}\t리그내`) ?? { runs: 0, games: 0 }).value;
      const b = runsPerWin(buckets.get(`${s}\t${l}\t교류전 포함`) ?? { runs: 0, games: 0 }).value;
      if (a !== null && b !== null) diffs.push(Math.abs(a - b));
    }
  }
  diffs.sort((x, y) => x - y);
  console.log(
    `## 리그내 대 교류전 포함의 차 (${label}) — ${diffs.length}건 · 최소 ${diffs[0]?.toFixed(3)} · ` +
      `중앙값 ${diffs[Math.floor(diffs.length / 2)]?.toFixed(3)} · 최대 ${diffs.at(-1)?.toFixed(3)}`,
  );
}

db.close();
