/**
 * **구장 정본 표가 아직 DB 와 맞는가** — 실DB로.
 *
 * ⚠**이 시험이 M7 의 자리다.** 구장은 `TEAM_CODE_ALIASES` 와 달리 **적재 시점에 정규화하지 않는다**
 * (사유는 `src/venues.ts` 머리말). 그래서 「새 구장·새 개명이 조용히 들어온다」를 막는 것이
 * 적재가 아니라 **여기**다. 이 시험이 없으면 정규화를 미룬 대가만 남고 안전장치가 없다.
 *
 * 무엇을 잡는가:
 *   ⑴ 표가 모르는 구장 문자열이 DB 에 있다 → **새 구장이거나 개명이다**
 *   ⑵ 표가 아는데 DB 에 없다 → 표가 썩었다(오타이거나 사라진 구장)
 *   ⑶ 「끝났다」고 적은 표기가 그 뒤에도 나온다 → 개명 판정이 틀렸다
 *   ⑷ 표가 적은 **본거지**가 실측 최다 건물이 아니다 → **구단이 구장을 옮겼는데 표를 안 고쳤다**
 *   ⑸ 홈구장이 아닌데 여러 경기가 열린 새 (팀, 건물) 짝 → 사람이 분류해야 한다
 *
 * ⚠**정규시즌만 보지 않는다.** `game.venue` 는 대회도 상태도 안 가리고 화면에 나가므로
 * (`dayResults` 는 중지 경기도 싣는다) 표는 **전 대회 · 전 상태**를 덮어야 한다.
 * 실제로 `函館` 은 **중지 경기 한 건에만** 있어서 「정규·실시 57종」에는 안 나온다.
 * ⚠**본거지·귀속 판정은 정규·실시만**(§2-1) — 올스타는 홈팀이라는 개념이 없다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 * 근거 재현: `node scripts/venue-measure.ts data/bb.sqlite`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { VENUES, homeVenueKind, knownVenueNames, primaryVenue, venueOf } from "../src/venues.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const SKIP = HAS_DB ? false : "DB 없음";

/** 정규시즌 실시 경기 — 홈 귀속을 물을 수 있는 유일한 범위 */
const REGULAR = `competition = 'regular' AND status = 'played'`;

interface Row {
  venue: string;
  season: number;
  homeCode: string;
  games: number;
}

let cached: { all: Map<string, number>; regular: Row[] } | null = null;

function load(): { all: Map<string, number>; regular: Row[] } {
  if (cached !== null) return cached;
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    /**
     * 구장 문자열 → 처음 관측된 시즌. **전 대회 · 전 상태**다.
     * ⚠`upcoming_game`(예정)도 넣는다 — 그쪽 `venue` 도 같은 `venueOf` 를 통과해야 한다.
     */
    const all = new Map<string, number>();
    for (const r of db
      .prepare(
        `SELECT venue, MIN(season) AS s FROM game WHERE venue IS NOT NULL GROUP BY venue
         UNION ALL
         SELECT venue, MIN(CAST(substr(game_date, 1, 4) AS INTEGER)) AS s
           FROM upcoming_game WHERE venue IS NOT NULL GROUP BY venue`,
      )
      .all() as unknown as { venue: string; s: number }[]) {
      const cur = all.get(r.venue);
      if (cur === undefined || Number(r.s) < cur) all.set(r.venue, Number(r.s));
    }

    const regular = (
      db
        .prepare(
          `SELECT venue, season, home_code AS homeCode, COUNT(*) AS games
             FROM game WHERE ${REGULAR} AND venue IS NOT NULL
            GROUP BY venue, season, home_code`,
        )
        .all() as unknown as Row[]
    ).map((r) => ({ ...r, season: Number(r.season), games: Number(r.games) }));

    assert.ok(all.size > 40, `구장 문자열이 ${all.size}종뿐이다 — 이 시험이 공회전한다`);
    assert.ok(regular.length > 300, `표본이 ${regular.length}행뿐이다 — 이 시험이 공회전한다`);
    cached = { all, regular };
    return cached;
  } finally {
    db.close();
  }
}

test("⚠DB 의 구장 문자열이 **전부** 표에 있다 — 여기가 새 구장을 잡는 자리다", { skip: SKIP }, () => {
  const { all } = load();
  const known = knownVenueNames();
  const missing = [...all.keys()].filter((n) => !known.has(n)).sort();
  assert.deepEqual(
    missing,
    [],
    "표가 모르는 구장 문자열이 DB 에 있다. **개명이면 그 건물의 `names` 에 넣어라 — 새 건물을 만들면 " +
      "한 구장이 둘로 쪼개져 파크팩터가 조용히 반반씩 틀린다.** " +
      "근거: node scripts/venue-measure.ts data/bb.sqlite",
  );
  // 분모를 함께 못 박는다(작업규칙 7) — 「0건」이 「안 쟀음」으로 보이지 않게
  assert.equal(known.size, all.size, `표 ${known.size}종 대 DB ${all.size}종`);
});

test("표에 있는데 DB 에 없는 문자열이 없다 — 오타·유령 항목을 잡는다", { skip: SKIP }, () => {
  const { all } = load();
  const dead = [...knownVenueNames()].filter((n) => !all.has(n)).sort();
  assert.deepEqual(dead, [], "표에만 있는 구장 문자열이다 — 오타이거나, DB 에서 사라진 것이다");
});

test("⚠`firstSeen` 이 실측과 같다 — 백필하면 여기가 먼저 깨진다", { skip: SKIP }, () => {
  const { all } = load();
  const bad: string[] = [];
  for (const v of VENUES) {
    for (const n of v.names) {
      const seen = all.get(n.name);
      if (seen !== undefined && seen !== n.firstSeen) {
        bad.push(`${v.id}/${n.name}: 표 ${n.firstSeen} · 실측 ${seen}`);
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    "표의 firstSeen 이 실측과 다르다. **소급 시즌을 넣었으면 여기가 옳게 깨진 것이다** — " +
      "표를 갱신하라(⚠`firstSeen` 은 건물의 개장 연도가 아니라 **우리 데이터의 하한**이다)",
  );
});

test("⚠「끝났다」고 적은 표기는 그 뒤에 안 나온다 — 개명 판정의 검증", { skip: SKIP }, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const bad: string[] = [];
    let checked = 0;
    for (const v of VENUES) {
      for (const n of v.names) {
        if (n.supersededAfter === null) continue;
        checked += 1;
        const r = db
          .prepare(`SELECT MAX(season) AS s, COUNT(*) AS n FROM game WHERE venue = ?`)
          .get(n.name) as { s: number | null; n: number };
        if (r.s !== null && Number(r.s) > n.supersededAfter) {
          bad.push(`${v.id}/${n.name}: 표는 ${n.supersededAfter} 에 끝났다는데 ${r.s} 시즌에도 있다`);
        }
      }
    }
    assert.equal(checked, 6, `개명이 ${checked}건이다 — 표의 개명 수가 바뀌었으면 이 수도 고쳐라`);
    assert.deepEqual(bad, [], "개명 시점이 틀렸다 — 옛 표기가 그 뒤에도 쓰인다");
  } finally {
    db.close();
  }
});

test("⚠표가 적은 본거지가 실측 최다 건물이다 — **구장 이전을 잡는 자리**", { skip: SKIP }, () => {
  const { regular } = load();
  /** (시즌, 팀) → 건물 → 홈경기 수 */
  const by = new Map<string, Map<string, number>>();
  for (const r of regular) {
    const key = `${r.season}|${r.homeCode}`;
    const m = by.get(key) ?? new Map<string, number>();
    m.set(venueOf(r.venue).id, (m.get(venueOf(r.venue).id) ?? 0) + r.games);
    by.set(key, m);
  }
  const bad: string[] = [];
  let minShare = 1;
  for (const [key, m] of by) {
    const [seasonStr, team] = key.split("|") as [string, string];
    const season = Number(seasonStr);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const top = [...m].sort((x, y) => y[1] - x[1])[0]!;
    // ⚠**모르면 던진다.** null 을 돌려주면 그 팀 홈경기가 통째로 파크팩터에서 사라진다
    const declared = primaryVenue(team, season);
    const share = (m.get(declared.id) ?? 0) / total;
    minShare = Math.min(minShare, share);
    if (top[0] !== declared.id) bad.push(`${season} ${team}: 표 ${declared.id} · 실측 최다 ${top[0]}(${top[1]})`);
  }
  assert.equal(by.size, 108, `(팀, 시즌) 이 ${by.size}건이다 — 9시즌 × 12팀 = 108 이어야 한다`);
  assert.deepEqual(bad, [], "본거지가 실측과 다르다 — 구단이 구장을 옮겼으면 `homes` 를 갱신하라");
  // 실측 최저 80.3%(2018 日本ハム). 과반을 밑돌면 「본거지」라는 말 자체가 흔들린다
  assert.ok(minShare > 0.5, `본거지 점유율 최저가 ${(minShare * 100).toFixed(1)}% 다`);
});

/**
 * ⚠**홈구장이 아닌데 여러 경기가 열린 (팀, 건물) 짝은 「분류를 요구하는 것」이다.**
 *
 * 자동 분류로 바꾸지 마라 — 그러면 2021년 올림픽 대체(東京ドーム db 6 · s 6)가
 * DeNA·ヤクルト의 홈구장이 되어 버린다. **판정은 사람이 하고, 시험은 「새 짝이 생겼다」만 말한다.**
 *
 * ⚠**짝 단위로 못 박는다**(시즌·경기 수가 아니라). 진행 중 시즌에 경기가 하나 더 들어와
 * 이미 아는 짝의 수가 3으로 올라가는 것은 사건이 아니고, 그걸로 매일 붉어지면 아무도 안 읽는다.
 */
test("⚠홈구장이 아닌데 3경기 이상인 (팀, 건물) 짝이 늘지 않았다", { skip: SKIP }, () => {
  const { regular } = load();
  const by = new Map<string, number>();
  for (const r of regular) {
    const id = venueOf(r.venue).id;
    if (homeVenueKind(r.venue, r.homeCode, r.season) !== "neutral") continue;
    const key = `${r.homeCode}@${id}`;
    by.set(key, Math.max(by.get(key) ?? 0, r.games));
  }
  const notable = [...by].filter(([, n]) => n >= 3).map(([k]) => k).sort();
  assert.deepEqual(
    notable,
    [
      // 2018·2019 각 3경기. 西武의 상설 지방 시리즈이지만 **제2 홈구장이라고 부를 근거가 없다**
      "l@omiya",
      // ⚠2021 올림픽으로 横浜를 못 쓴 DeNA 의 임시 대체(神宮 4 · 東京ドーム 6)
      "db@jingu",
      "db@tokyo-dome",
      // ⚠같은 해 神宮을 올림픽에 내준 ヤクルト의 임시 대체(東京ドーム 6)
      "s@tokyo-dome",
    ].sort(),
    "홈구장이 아닌데 3경기 이상 열린 (팀, 건물) 짝이 바뀌었다. " +
      "**새 제2 홈구장일 수도, 새 지방 시리즈일 수도 있다** — venues.ts 의 `homes` 를 고칠지 판단하라",
  );
});

test("표의 홈 귀속에 **죽은 줄이 없다** — 적어 두고 경기가 0인 것", { skip: SKIP }, () => {
  const { regular } = load();
  const seen = new Set<string>();
  for (const r of regular) seen.add(`${venueOf(r.venue).id}|${r.homeCode}|${r.season}`);
  const dead: string[] = [];
  for (const v of VENUES) {
    for (const h of v.homes) {
      const until = h.until ?? 2026;
      let any = false;
      for (let s = h.since; s <= until; s += 1) if (seen.has(`${v.id}|${h.team}|${s}`)) any = true;
      if (!any) dead.push(`${v.id}/${h.team}(${h.since}~${h.until ?? ""})`);
    }
  }
  assert.deepEqual(dead, [], "홈 귀속을 적어 뒀는데 그 기간에 경기가 하나도 없다 — 표가 사실과 다르다");
});
