#!/usr/bin/env node
/**
 * **구장 문자열을 DB 에서 다시 센다 — `packages/domain/src/venues.ts` 의 근거.**
 *
 * ⚠**인라인 프로브로 재고 지우지 않는다**(이 저장소가 그것 때문에 재현 불가를 겪었다).
 * 정본 표를 손보는 사람은 **이 스크립트를 다시 돌려서** 근거를 갱신한다.
 *
 * 쓰는 법:
 *   node scripts/venue-measure.ts data/bb.sqlite            # 문자열 수 · 표 대조 · 홈 귀속
 *   node scripts/venue-measure.ts data/bb.sqlite --raw      # 구장 × 시즌 × 홈팀 전수 덤프(표를 만드는 입력)
 *   node scripts/venue-measure.ts data/bb.sqlite --pf       # 파크팩터: 건물 단위 vs 팀 단위
 *
 * ⚠**대회 경계**: `competition='regular' AND status='played'` 만(CLAUDE.md §2-1).
 *   올스타·CS·일본시리즈를 섞으면 구장 집합도 득점 환경도 다른 수가 된다.
 * ⚠**파크팩터는 완결 시즌만.** 진행 중 시즌을 넣으면 경기가 들어올 때마다 값이 움직여
 *   문서에 적을 수 없는 수가 된다(`scripts/test/doc-figures.test.ts` 가 같은 규약).
 */
import { parseArgs } from "node:util";
import { openDb } from "@bb-app/store";
import { regularSeasonGames } from "@bb-app/domain";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    raw: { type: "boolean", default: false },
    pf: { type: "boolean", default: false },
  },
});

const dbPath = positionals[0];
if (dbPath === undefined) {
  console.error("usage: node scripts/venue-measure.ts <db-path> [--raw] [--pf]");
  process.exit(2);
}

/** ⚠시계를 직접 읽지 않는다(M6). 마이그레이션 기록용이고 이 스크립트는 쓰기를 하지 않는다 */
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

const WHERE = `competition = 'regular' AND status = 'played'`;

/**
 * 홈구장이 아닌데 이만큼 열렸으면 **사람이 분류해야 한다**는 하한.
 *
 * ⚠**이건 판정 규칙이 아니라 「눈에 띄게 하는」 값이다.** 판정은 정본 표가 손으로 한다 —
 * 여기서 자동 분류를 시작하면 2021년 올림픽 대체(東京ドーム db 6 · s 6)가
 * DeNA·ヤクルト의 홈구장이 되어 버린다.
 * 실측으로 3 이면 짝 4개만 남는다(`db@tokyo-dome` · `s@tokyo-dome` · `db@jingu` · `l@omiya`).
 */
const NOTABLE_NEUTRAL = 3;

interface Row {
  venue: string;
  season: number;
  homeCode: string;
  games: number;
  /** 양팀 합계 득점. ⚠**득점이 NULL 인 경기는 여기 안 들어온다**(아래 `runsUnknown`) */
  runs: number;
  /** 득점을 모르는 경기 수. **0 으로 때우지 않는다**(M11) */
  runsUnknown: number;
}

const rows = db.raw
  .prepare(
    `SELECT venue, season, home_code AS homeCode, COUNT(*) AS games,
            SUM(CASE WHEN away_runs IS NULL OR home_runs IS NULL THEN 0
                     ELSE away_runs + home_runs END) AS runs,
            SUM(CASE WHEN away_runs IS NULL OR home_runs IS NULL THEN 1 ELSE 0 END) AS runsUnknown
       FROM game
      WHERE ${WHERE} AND venue IS NOT NULL
      GROUP BY venue, season, home_code
      ORDER BY venue, season, home_code`,
  )
  .all() as unknown as Row[];

const nullVenue = (
  db.raw.prepare(`SELECT COUNT(*) AS n FROM game WHERE ${WHERE} AND venue IS NULL`).get() as {
    n: number;
  }
).n;

const totalGames = rows.reduce((a, r) => a + r.games, 0);
const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
const names = [...new Set(rows.map((r) => r.venue))].sort();

if (values.raw) {
  console.log("venue\tseason\thome\tgames\truns\trunsUnknown");
  for (const r of rows) {
    console.log(`${r.venue}\t${r.season}\t${r.homeCode}\t${r.games}\t${r.runs}\t${r.runsUnknown}`);
  }
  db.close();
  process.exit(0);
}

/**
 * ⚠**정본 표는 `--raw` 뒤에 읽는다.** 이 덤프가 **표를 만드는 입력**이라,
 * 표가 없거나 틀린 상태에서도 돌아야 한다. 정적 import 로 두면 그 순서가 막힌다.
 */
const { VENUES, homeVenueKind, isHomeVenue, knownVenueNames, primaryVenue, venueOf } = await import(
  "../packages/domain/src/venues.ts"
);

/* ── ① 구장 문자열 수 ─────────────────────────────────────────────────── */

console.log("## ① 구장 문자열");
console.log(`시즌: ${seasons.join(" ")} (${seasons.length}시즌)`);
console.log(
  `정규 · played 경기: ${totalGames.toLocaleString("en-US")} · venue IS NULL: ${nullVenue} · ` +
    `득점 미상: ${rows.reduce((a, r) => a + r.runsUnknown, 0)}`,
);
console.log(`구장 문자열(정규 · played): **${names.length}종**`);

/** ⚠**분모를 바꾸면 답이 바뀐다**(작업규칙 7). 「58종」이라는 옛 수치가 어느 분모인지 여기서 갈린다 */
for (const [label, where] of [
  ["정규 · played", WHERE],
  ["정규 · 전 상태(중지 포함)", `competition = 'regular'`],
  ["전 대회 · played", `status = 'played'`],
  ["전 대회 · 전 상태", `1 = 1`],
] as const) {
  const n = (
    db.raw
      .prepare(`SELECT COUNT(DISTINCT venue) AS n FROM game WHERE ${where} AND venue IS NOT NULL`)
      .get() as { n: number }
  ).n;
  console.log(`  ${label}: ${n}종`);
}

/* ── ② 정본 표 대조 — **여기서 어긋나면 표가 낡은 것이다** ────────────── */

/**
 * ⚠**표가 맞춰야 하는 것은 「정규·실시」가 아니라 `game.venue` 전부다.**
 * `venueOf` 는 상태도 대회도 안 가리고 불린다 — 실제로 `函館` 은 **중지 경기에만** 있어서
 * 정규·실시 57종에 안 들어가고, 표에서 빠지면 그 경기를 그리는 순간 던진다.
 */
const allNames = (
  db.raw.prepare(`SELECT DISTINCT venue FROM game WHERE venue IS NOT NULL`).all() as unknown as {
    venue: string;
  }[]
).map((r) => r.venue);

const known = knownVenueNames();
const unknown = allNames.filter((n) => !known.has(n));
const unused = [...known].filter((n) => !allNames.includes(n));
console.log("");
console.log("## ② 정본 표 대조");
console.log(`표가 아는 문자열: ${known.size}종 · 건물: ${VENUES.length}개`);
console.log(`DB 전체(전 대회·전 상태) 구장 문자열: ${allNames.length}종`);
console.log(`DB 에 있는데 표에 없는 문자열: ${unknown.length}종 ${unknown.join(" · ")}`);
console.log(`표에 있는데 DB 에 없는 문자열: ${unused.length}종 ${unused.join(" · ")}`);

/* ── ③ 건물별 집계 ────────────────────────────────────────────────────── */

interface Agg {
  games: number;
  runs: number;
  names: Set<string>;
  seasons: Set<number>;
  homes: Map<string, number>;
}
const byBuilding = new Map<string, Agg>();
for (const r of rows) {
  const id = venueOf(r.venue).id;
  let a = byBuilding.get(id);
  if (a === undefined) {
    a = { games: 0, runs: 0, names: new Set(), seasons: new Set(), homes: new Map() };
    byBuilding.set(id, a);
  }
  a.games += r.games;
  a.runs += r.runs;
  a.names.add(r.venue);
  a.seasons.add(r.season);
  a.homes.set(r.homeCode, (a.homes.get(r.homeCode) ?? 0) + r.games);
}

console.log("");
console.log(`## ③ 건물별 (정규 · played · ${seasons.length}시즌) — ${byBuilding.size}개 건물`);
console.log("building\tgames\tseasons\tnames\thomeTeams");
for (const [id, a] of [...byBuilding].sort((x, y) => y[1].games - x[1].games)) {
  const homes = [...a.homes]
    .sort((x, y) => y[1] - x[1])
    .map(([c, n]) => `${c}:${n}`)
    .join(",");
  console.log(
    `${id}\t${a.games}\t${Math.min(...a.seasons)}-${Math.max(...a.seasons)}\t${[...a.names].join("|")}\t${homes}`,
  );
}

/* ── ④ 홈 귀속: 표가 말하는 것 대 데이터 ──────────────────────────────── */

console.log("");
console.log("## ④ 홈 귀속 대조");
console.log("⚠**「경기 수」로 자르지 않는다** — 표가 팀별로 명시한 것을 쓰고, 데이터로 대조만 한다");

/** (시즌, 팀) → 건물 → 홈경기 수 */
const bySeasonTeam = new Map<string, Map<string, number>>();
for (const r of rows) {
  const key = `${r.season}\t${r.homeCode}`;
  let m = bySeasonTeam.get(key);
  if (m === undefined) {
    m = new Map();
    bySeasonTeam.set(key, m);
  }
  const id = venueOf(r.venue).id;
  m.set(id, (m.get(id) ?? 0) + r.games);
}

/**
 * ⚠**「본거지가 실측 최다 건물인가」가 이 표의 안전장치다.**
 * 구단이 구장을 옮겼는데 표를 안 고치면 그 팀 홈경기가 전부 `neutral` 이 되어
 * **파크팩터에서 통째로 사라진다** — 그때 조용하지 않으려면 여기서 걸려야 한다.
 */
let primaryBad = 0;
let minShare = 1;
const notableNeutral: { season: number; team: string; id: string; games: number }[] = [];
console.log("season\tteam\tprimary(실측최다)\tshare\tsecondary\tneutral");
for (const [key, m] of [...bySeasonTeam].sort()) {
  const [seasonStr, team] = key.split("\t") as [string, string];
  const season = Number(seasonStr);
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const sorted = [...m].sort((x, y) => y[1] - x[1]);
  const observedTop = sorted[0]!;
  const declared = primaryVenue(team, season);
  const share = (m.get(declared.id) ?? 0) / total;
  if (observedTop[0] !== declared.id) primaryBad += 1;
  minShare = Math.min(minShare, share);

  const buckets: Record<string, string[]> = { primary: [], secondary: [], neutral: [] };
  for (const [id, n] of sorted) {
    // ⚠kind 는 **문자열**로 묻는다(표의 키가 문자열이므로) — 건물의 첫 표기를 대표로 쓴다
    const anyName = VENUES.find((v) => v.id === id)!.names[0]!.name;
    const kind = homeVenueKind(anyName, team, season);
    buckets[kind]!.push(`${id}:${n}`);
    if (kind === "neutral" && n >= NOTABLE_NEUTRAL) notableNeutral.push({ season, team, id, games: n });
  }
  console.log(
    `${season}\t${team}\t${declared.id}${observedTop[0] === declared.id ? "" : `⚠실측최다=${observedTop[0]}`}\t` +
      `${(share * 100).toFixed(0)}%\t${buckets["secondary"]!.join(",") || "-"}\t${buckets["neutral"]!.join(",") || "-"}`,
  );
}
console.log(`본거지가 실측 최다와 어긋난 (팀, 시즌): ${primaryBad}건 / ${bySeasonTeam.size}건`);
console.log(`본거지 점유율 최저: ${(minShare * 100).toFixed(1)}%`);
console.log("");
console.log(`## ④-b 홈구장이 아닌데 ${NOTABLE_NEUTRAL}경기 이상 — **분류를 요구하는 것들**`);
console.log("⚠**전부 사유가 있어야 한다.** 새 짝이 나오면 표를 고칠지 판단하라");
for (const n of notableNeutral) console.log(`${n.season}\t${n.team}\t${n.id}\t${n.games}`);
console.log(`(팀, 건물) 짝: ${[...new Set(notableNeutral.map((n) => `${n.team}@${n.id}`))].sort().join(" · ")}`);

/* ── ⑤ 파크팩터 ───────────────────────────────────────────────────────── */

if (values.pf) {
  /**
   * **완결 시즌** = 12구단 전부가 `regularSeasonGames(시즌)` 을 치른 시즌.
   * ⚠**「최근 시즌을 뺀다」로 쓰지 마라** — 2026 이 끝난 뒤에도 영원히 빠진다(doc-figures 와 같은 규약).
   * ⚠**2020 은 120경기다.**
   */
  const counted = new Map<number, Map<string, number>>();
  for (const r of db.raw
    .prepare(
      `SELECT season, code, COUNT(*) AS n FROM (
         SELECT season, home_code AS code FROM game WHERE ${WHERE}
         UNION ALL
         SELECT season, away_code AS code FROM game WHERE ${WHERE}
       ) GROUP BY season, code`,
    )
    .all() as unknown as { season: number; code: string; n: number }[]) {
    const m = counted.get(r.season) ?? new Map<string, number>();
    m.set(r.code, r.n);
    counted.set(r.season, m);
  }
  const done = new Set(
    [...counted]
      .filter(([s, m]) => m.size === 12 && Math.min(...m.values()) >= regularSeasonGames(s))
      .map(([s]) => s),
  );

  /**
   * 「홈팀의 홈구장」 = 정본 표가 primary 또는 secondary 라고 말하는 것.
   * ⚠**경기 수로 자르지 않는다** — 阪神 京セラ(연 3~9) · オリックス ほっと神戸(연 3~11) 가 잘려 나간다.
   */
  const homeRows = rows.filter(
    (r) => done.has(r.season) && r.runsUnknown === 0 && isHomeVenue(r.venue, r.homeCode, r.season),
  );
  const baseGames = homeRows.reduce((a, r) => a + r.games, 0);
  const baseRuns = homeRows.reduce((a, r) => a + r.runs, 0);
  const baseline = baseRuns / baseGames;

  console.log("");
  console.log(`## ⑤ 파크팩터 — 완결 ${done.size}시즌(${[...done].sort().join("·")}) · 경기당 양팀 합계 득점`);
  console.log(`기준 표본: **${baseGames.toLocaleString("en-US")}경기** · 기준 **${baseline.toFixed(3)}점/경기**`);
  console.log("⚠기준 표본을 조금만 다르게 자르면 전 구장이 같은 방향으로 움직인다 — **값과 기준을 같이 인용하라**");

  const fold = (sel: (r: Row) => string): Map<string, { games: number; runs: number }> => {
    const m = new Map<string, { games: number; runs: number }>();
    for (const r of homeRows) {
      const k = sel(r);
      const a = m.get(k) ?? { games: 0, runs: 0 };
      a.games += r.games;
      a.runs += r.runs;
      m.set(k, a);
    }
    return m;
  };
  const pf = (a: { games: number; runs: number }): number => a.runs / a.games / baseline;

  const byB = fold((r) => venueOf(r.venue).id);
  const byTeam = fold((r) => r.homeCode);
  const byPair = fold((r) => `${r.homeCode}\t${venueOf(r.venue).id}`);

  console.log("");
  console.log("### 건물 단위 — **이쪽이 「구장의 성질」이다**");
  console.log("building\tgames\truns/g\tPF");
  for (const [id, a] of [...byB].sort((x, y) => pf(y[1]) - pf(x[1]))) {
    console.log(`${id}\t${a.games}\t${(a.runs / a.games).toFixed(3)}\t${pf(a).toFixed(3)}`);
  }

  console.log("");
  console.log("### 팀 단위 — **같은 표본을 홈팀으로 묶는다.** 홈구장이 둘인 팀은 여기서 뭉개진다");
  console.log("team\tgames\truns/g\tPF\t건물 내역(건물:경기:PF)");
  for (const [team, a] of [...byTeam].sort((x, y) => pf(y[1]) - pf(x[1]))) {
    const parts = [...byPair]
      .filter(([k]) => k.startsWith(`${team}\t`))
      .sort((x, y) => y[1].games - x[1].games)
      .map(([k, v]) => `${k.split("\t")[1]}:${v.games}:${pf(v).toFixed(3)}`);
    console.log(
      `${team}\t${a.games}\t${(a.runs / a.games).toFixed(3)}\t${pf(a).toFixed(3)}\t${parts.join(" ")}`,
    );
  }

  console.log("");
  console.log("### 팀 단위가 건물 단위와 얼마나 다른가 — **홈구장이 둘인 팀만**");
  for (const [team, a] of [...byTeam].sort()) {
    const parts = [...byPair].filter(([k]) => k.startsWith(`${team}\t`));
    if (parts.length < 2) continue;
    const spread = Math.max(...parts.map(([, v]) => pf(v))) - Math.min(...parts.map(([, v]) => pf(v)));
    console.log(
      `${team}: 팀 PF ${pf(a).toFixed(3)} ← ${parts
        .map(([k, v]) => `${k.split("\t")[1]} ${pf(v).toFixed(3)}(${v.games})`)
        .join(" / ")} · 건물 간 폭 ${spread.toFixed(3)}`,
    );
  }
}

db.close();
