/**
 * **파크팩터·RPW 실측을 못 박는다** — 실DB로.
 *
 * ⚠**여기 적힌 수는 「완결 시즌」의 것이다.** 진행 중 시즌을 넣으면 **경기가 하나 들어올 때마다**
 * 이 파일이 낡고, 시즌 중에는 **매일** 붉어진다. 이 저장소는 그 병을 이미 앓았다
 * (`steal-seasons.test.ts` 머리말 · 2026-08-20). 완결 시즌은 더 늘 것이 없으므로
 * 이 시험이 붉어지는 것은 **백필했거나 시즌이 끝났을 때**뿐이다 — 둘 다 사람이 볼 만한 사건이다.
 *
 * ⚠**「완결」을 벽시계로 판정하지 않는다**(M6) — 12팀이 그 시즌의 경기 수를 채웠는가로 본다.
 * ⚠**2020 은 120경기다**(`regularSeasonGames`).
 * ⚠**대회 경계**: `competition='regular' AND status='played'`(§2-1).
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 * 근거 재현: `node scripts/rpw-measure.ts data/bb.sqlite` ·
 *            `node scripts/venue-measure.ts data/bb.sqlite --pf`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isHomeVenue, leagueOf, regularSeasonGames, venueOf } from "@bb-app/domain";
import { parkFactor, runsPerWin, sumRunEnvironments } from "../src/park.ts";
import type { RunEnvironment } from "../src/park.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const SKIP = HAS_DB ? false : "DB 없음";

interface GameRow {
  season: number;
  awayCode: string;
  homeCode: string;
  venue: string | null;
  runs: number | null;
}

let cache: { games: GameRow[]; settled: Set<number> } | null = null;

function load(): { games: GameRow[]; settled: Set<number> } {
  if (cache !== null) return cache;
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const games = (
      db
        .prepare(
          `SELECT season, away_code AS awayCode, home_code AS homeCode, venue,
                  CASE WHEN away_runs IS NULL OR home_runs IS NULL THEN NULL
                       ELSE away_runs + home_runs END AS runs
             FROM game
            WHERE competition = 'regular' AND status = 'played'`,
        )
        .all() as unknown as GameRow[]
    ).map((r) => ({ ...r, season: Number(r.season) }));
    assert.ok(games.length > 6_000, `경기가 ${games.length}건뿐이다 — 이 시험이 공회전한다`);

    const per = new Map<number, Map<string, number>>();
    for (const g of games) {
      const m = per.get(g.season) ?? new Map<string, number>();
      for (const c of [g.awayCode, g.homeCode]) m.set(c, (m.get(c) ?? 0) + 1);
      per.set(g.season, m);
    }
    const settled = new Set(
      [...per]
        .filter(([s, m]) => m.size === 12 && Math.min(...m.values()) >= regularSeasonGames(s))
        .map(([s]) => s),
    );
    assert.ok(settled.size >= 8, `완결 시즌이 ${settled.size}개뿐이다 — 이 시험이 공회전한다`);
    cache = { games, settled };
    return cache;
  } finally {
    db.close();
  }
}

/* ── RPW ──────────────────────────────────────────────────────────────── */

/**
 * **완결 8시즌 × 2리그의 RPW.** ⚠**리그내 경기만**(교류전 제외).
 *
 * ⚠**2020 만 경기 수가 다르다(360)** — 120경기 시즌이었고 **그해에는 교류전이 없었다.**
 * 그래서 2020 만 「리그내」와 「교류전 포함」의 값이 정확히 같다(아래 시험이 그것도 못 박는다).
 */
const RPW: Readonly<Record<string, readonly [games: number, runs: number, rpw: string]>> = {
  "2018 central": [375, 3342, "9.951"],
  "2018 pacific": [375, 3185, "9.714"],
  "2019 central": [375, 3158, "9.673"],
  "2019 pacific": [375, 3222, "9.771"],
  "2020 central": [360, 2962, "9.561"],
  "2020 pacific": [360, 2963, "9.563"],
  "2021 central": [375, 2796, "9.102"],
  "2021 pacific": [375, 2731, "8.995"],
  "2022 central": [375, 2781, "9.077"],
  "2022 pacific": [375, 2631, "8.829"],
  "2023 central": [375, 2621, "8.812"],
  "2023 pacific": [375, 2582, "8.747"],
  "2024 central": [375, 2423, "8.473"],
  "2024 pacific": [375, 2542, "8.679"],
  "2025 central": [375, 2430, "8.485"],
  "2025 pacific": [375, 2535, "8.667"],
};

/** 리그·시즌별 「리그내 경기」의 득점 환경 */
function leagueInner(): Map<string, RunEnvironment> {
  const { games, settled } = load();
  const out = new Map<string, RunEnvironment>();
  for (const g of games) {
    if (!settled.has(g.season)) continue;
    // ⚠**득점을 모르는 경기는 분모에서도 뺀다**(M11)
    if (g.runs === null) continue;
    const away = leagueOf(g.awayCode);
    const home = leagueOf(g.homeCode);
    if (away !== home) continue; // 교류전
    const key = `${g.season} ${home}`;
    const cur = out.get(key) ?? { runs: 0, games: 0 };
    out.set(key, { runs: cur.runs + g.runs, games: cur.games + 1 });
  }
  return out;
}

test("⚠RPW 16개(완결 8시즌 × 2리그)가 DB 와 같다 — **리그내 경기만**", { skip: SKIP }, () => {
  const inner = leagueInner();
  const bad: string[] = [];
  for (const [key, [games, runs, rpw]] of Object.entries(RPW)) {
    const e = inner.get(key);
    if (e === undefined) {
      bad.push(`${key}: DB 에 없다`);
      continue;
    }
    const got = runsPerWin(e);
    const line = `${key}: ${e.games}경기 ${e.runs}점 RPW ${got.value?.toFixed(3)}`;
    if (e.games !== games || e.runs !== runs || got.value?.toFixed(3) !== rpw) {
      bad.push(`${line} ← 표는 ${games}경기 ${runs}점 RPW ${rpw}`);
    }
  }
  assert.deepEqual(bad, [], "RPW 실측이 바뀌었다 — 백필했거나 시즌이 끝났으면 이 표를 갱신하라");
  // ⚠완결 시즌이 늘면 표도 늘어야 한다. 「16건 통과」가 「8건만 쟀음」이 되지 않게(작업규칙 7)
  assert.equal(inner.size, Object.entries(RPW).length, `잰 것 ${inner.size}건 · 표 ${Object.entries(RPW).length}건`);
});

test("⚠2020 만 교류전이 없다 — 그래서 그해만 「리그내」와 「전체」가 같다", { skip: SKIP }, () => {
  const { games, settled } = load();
  const interleague = new Map<number, number>();
  for (const g of games) {
    if (!settled.has(g.season)) continue;
    if (leagueOf(g.awayCode) === leagueOf(g.homeCode)) continue;
    interleague.set(g.season, (interleague.get(g.season) ?? 0) + 1);
  }
  assert.equal(interleague.get(2020), undefined, "2020 에 교류전이 있다 — RPW 표의 360 이 틀린 것이다");
  const others = [...settled].filter((s) => s !== 2020).sort();
  assert.deepEqual(
    others.map((s) => interleague.get(s)),
    others.map(() => 108),
    "교류전이 시즌당 108경기가 아니다(6팀 × 18 = 108 · 리그당 54)",
  );
});

test("⚠교류전을 넣으면 다른 수가 된다 — 「리그내만」이 공짜 선택이 아니다", { skip: SKIP }, () => {
  const { games, settled } = load();
  const all = new Map<string, RunEnvironment>();
  for (const g of games) {
    if (!settled.has(g.season) || g.runs === null) continue;
    for (const l of new Set([leagueOf(g.awayCode), leagueOf(g.homeCode)])) {
      const key = `${g.season} ${l}`;
      const cur = all.get(key) ?? { runs: 0, games: 0 };
      all.set(key, { runs: cur.runs + g.runs, games: cur.games + 1 });
    }
  }
  const inner = leagueInner();
  const diffs = [...inner].map(([k, e]) => Math.abs(runsPerWin(e).value! - runsPerWin(all.get(k)!).value!));
  /**
   * 실측(**완결 8시즌 · 16건**): 최소 **0.000**(2020 · 교류전이 없었다) · 최대 **0.167**(2021 퍼시픽).
   * ⚠**`scripts/rpw-measure.ts` 는 진행 중 시즌까지 세므로 최대가 0.216(2026 퍼시픽)으로 나온다** —
   *   그 수를 여기 옮겨 적었다가 이 시험이 잡았다. **분모가 다르면 답이 다르다**(작업규칙 7).
   */
  assert.equal(Math.min(...diffs).toFixed(3), "0.000");
  assert.equal(Math.max(...diffs).toFixed(3), "0.167");
});

/* ── 파크팩터 ─────────────────────────────────────────────────────────── */

/**
 * **건물 단위 파크팩터**(완결 8시즌 · 홈팀의 홈구장만 · 경기당 양팀 합계 득점).
 *
 * ⚠**「홈팀의 홈구장」 판정은 `@bb-app/domain` 의 `isHomeVenue` 가 한다** — 경기 수로 자르지 않는다.
 * 그래서 여기 `kyocera-dome` 은 오릭스 홈경기 **와** 阪神 홈경기를 **둘 다** 담는다.
 * ⚠**세 번째 자리를 구장의 성질로 읽지 마라.** 기준 표본을 조금만 다르게 자르면 전 구장이 같이 움직인다.
 */
const BASELINE_GAMES = 6487;
const BASELINE_RPG = "7.504";
const PF: Readonly<Record<string, readonly [games: number, pf: string]>> = {
  jingu: [534, "1.198"],
  yokohama: [544, "1.069"],
  "seibu-dome": [533, "1.043"],
  "hotto-motto-kobe": [58, "1.041"],
  "zozo-marine": [556, "1.033"],
  mazda: [558, "1.016"],
  "tokyo-dome": [534, "1.014"],
  "sapporo-dome": [297, "1.000"],
  "rakuten-sendai": [536, "0.991"],
  "fukuoka-dome": [519, "0.989"],
  "es-con-field": [214, "0.977"],
  "kyocera-dome": [562, "0.935"],
  koshien: [492, "0.884"],
  "nagoya-dome": [550, "0.829"],
};

/** 홈팀의 홈구장 경기만. **키를 부르는 쪽이 정한다**(건물 · 팀 · 팀+건물) */
function homeEnvironments(key: (g: GameRow) => string): Map<string, RunEnvironment> {
  const { games, settled } = load();
  const out = new Map<string, RunEnvironment>();
  for (const g of games) {
    if (!settled.has(g.season) || g.runs === null || g.venue === null) continue;
    if (!isHomeVenue(g.venue, g.homeCode, g.season)) continue;
    const k = key(g);
    const cur = out.get(k) ?? { runs: 0, games: 0 };
    out.set(k, { runs: cur.runs + g.runs, games: cur.games + 1 });
  }
  return out;
}

test("⚠건물 단위 파크팩터가 DB 와 같다 — 기준 표본도 함께 못 박는다", { skip: SKIP }, () => {
  const byBuilding = homeEnvironments((g) => venueOf(g.venue!).id);
  const baseline = sumRunEnvironments([...byBuilding.values()]);
  assert.equal(baseline.games, BASELINE_GAMES, "기준 표본이 바뀌었다 — 전 구장의 PF 가 같이 움직인다");
  assert.equal((baseline.runs / baseline.games).toFixed(3), BASELINE_RPG);

  const bad: string[] = [];
  for (const [id, [games, pf]] of Object.entries(PF)) {
    const e = byBuilding.get(id);
    if (e === undefined) {
      bad.push(`${id}: DB 에 없다`);
      continue;
    }
    const got = parkFactor(e, baseline);
    if (e.games !== games || got.value?.toFixed(3) !== pf) {
      bad.push(`${id}: ${e.games}경기 PF ${got.value?.toFixed(3)} ← 표는 ${games}경기 ${pf}`);
    }
  }
  assert.deepEqual(bad, [], "파크팩터 실측이 바뀌었다 — 백필했거나 시즌이 끝났으면 이 표를 갱신하라");
  assert.equal(byBuilding.size, Object.entries(PF).length, "본거지·제2 홈구장이 늘거나 줄었다");
});

/**
 * ⚠**이 시험이 「건물 단위로 내라」의 근거다.**
 *
 * 甲子園(0.884)과 京セラ(1.022)는 성질이 정반대인데 **둘 다 阪神의 홈구장**이다.
 * 팀으로 뭉치면 0.900 이 나오고 그건 **어느 구장의 값도 아니다.**
 */
test("⚠팀으로 뭉치면 어느 구장의 값도 아닌 수가 나온다 — 阪神 · オリックス · 日本ハム", { skip: SKIP }, () => {
  const byBuilding = homeEnvironments((g) => venueOf(g.venue!).id);
  const baseline = sumRunEnvironments([...byBuilding.values()]);
  const byTeam = homeEnvironments((g) => g.homeCode);
  const byPair = homeEnvironments((g) => `${g.homeCode}|${venueOf(g.venue!).id}`);
  const pf = (e: RunEnvironment): string => parkFactor(e, baseline).value!.toFixed(3);

  // 홈구장이 둘 이상인 팀 = 뭉개짐이 일어나는 팀. **실측으로 셋뿐이다**
  const multi = [...byTeam.keys()]
    .filter((t) => [...byPair.keys()].filter((k) => k.startsWith(`${t}|`)).length >= 2)
    .sort();
  assert.deepEqual(multi, ["b", "f", "t"], "홈구장이 둘 이상인 팀이 바뀌었다");

  assert.equal(pf(byTeam.get("t")!), "0.900");
  assert.equal(pf(byPair.get("t|koshien")!), "0.884");
  assert.equal(pf(byPair.get("t|kyocera-dome")!), "1.022");

  assert.equal(pf(byTeam.get("b")!), "0.936");
  assert.equal(pf(byPair.get("b|kyocera-dome")!), "0.924");
  assert.equal(pf(byPair.get("b|hotto-motto-kobe")!), "1.041");

  assert.equal(pf(byTeam.get("f")!), "0.991");
  assert.equal(pf(byPair.get("f|sapporo-dome")!), "1.000");
  assert.equal(pf(byPair.get("f|es-con-field")!), "0.977");
});

/**
 * ⚠**같은 건물인데 홈팀에 따라 값이 갈린다 — 이 PF 에 팀 성질이 섞여 있다는 증거다.**
 * 京セラ 는 오릭스 홈에서 0.924 · 阪神 홈에서 1.022 다. **구장이 둘로 갈린 게 아니다.**
 * 이 사실을 적지 않고 값을 내보내면 그 값이 거짓말을 한다 — `park.ts` 주석과 짝이다.
 */
test("⚠원시 파크팩터에는 팀 성질이 섞여 있다 — 京セラ 한 건물 안의 폭이 0.097", { skip: SKIP }, () => {
  const byBuilding = homeEnvironments((g) => venueOf(g.venue!).id);
  const baseline = sumRunEnvironments([...byBuilding.values()]);
  const byPair = homeEnvironments((g) => `${g.homeCode}|${venueOf(g.venue!).id}`);
  const b = parkFactor(byPair.get("b|kyocera-dome")!, baseline).value!;
  const t = parkFactor(byPair.get("t|kyocera-dome")!, baseline).value!;
  /**
   * ⚠**표시값을 빼지 마라.** `1.022 − 0.924 = 0.098` 이지만 실제 차는 **0.097** 이다 —
   * 반올림한 뒤 빼면 마지막 자리가 어긋난다. 처음에 0.098 로 적었다가 이 시험이 잡았다.
   */
  assert.equal(Math.abs(t - b).toFixed(3), "0.097");
  // ⚠표본이 63경기밖에 안 된다는 사실도 같이 못 박는다(M2)
  assert.equal(byPair.get("t|kyocera-dome")!.games, 63);
});
