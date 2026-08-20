/**
 * **이적한 선수의 併殺打가 구단 페이지에서 갈라지는가** — 실데이터로.
 *
 * ⚠**이 시험이 없어서 뮤테이션이 통과했다**(2026-08-20 이중 검토 P2).
 * `query.ts` 의 구단 표는 `gidpByTeam.get(\`${playerId}|${code}\`)` 로 **그 구단 몫만** 싣는다.
 * 그런데 그것을 **시즌 합계**로 바꿔도 시험 1,500본이 전부 통과했다 —
 * 즉 코드 주석이 「바로 아래 SRC 가 같은 함정을 밟았던 자리다」라고 적어 둔 결함이
 * **다시 나도 아무도 못 잡는** 상태였다.
 *
 * 그 결함이 실제로 무엇을 하는가: 이적 선수의 옛 팀 몫이 새 팀 표에 실리고,
 * 같은 화면의 `打席` 열(그 팀만의 打席)과 어긋난다. **값이 화면 안에서 자기모순**이 된다.
 *
 * ⚠**시즌을 데이터로 고른다**(`ranking-src-srp.test.ts` 와 같은 이유). 특정 연도를 박으면
 * 그 해에 해당 선수가 없어지는 날 시험이 조용히 헛돈다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { gidpOrUnknown, loadSite } from "../src/query.ts";
// ⚠**명시 타입을 붙인다** — 단언 함수로 좁히는 값을 자기 메시지에서 참조하면
//   TS 가 초기화식 순환(TS7022)으로 본다. 시험이 컴파일 안 되는 것이 가장 조용한 실패다
import type { TeamBatter, TeamPageData } from "../src/team-page.ts";
import type { PlayerPageData } from "../src/player-page.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * **두 구단에서 모두 併殺打가 1 이상인 선수-시즌.**
 * ⚠양쪽 다 0보다 커야 한다 — 한쪽이 0이면 「합계를 실었다」와 「그 팀 몫을 실었다」가
 * 같은 수가 되어 이 시험이 아무것도 가르지 못한다.
 */
const SQL = `
SELECT g.season AS season, e.batter_id AS pid,
       (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) AS code,
       SUM(CASE WHEN e.outcome = 'groundedIntoDoublePlay' OR e.raw_box LIKE '%併失%' THEN 1 ELSE 0 END) AS gidp
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final'
GROUP BY season, pid, code
HAVING gidp > 0
`;

interface Split {
  season: number;
  playerId: string;
  /** 구단 코드 → 그 구단에서 낸 併殺打 */
  byTeam: Map<string, number>;
  total: number;
}

/** 가장 **최근** 시즌의 후보를 고른다 — 화면 구조가 최신인 시즌에서 재는 편이 낫다 */
function pick(db: Db): Split | null {
  const rows = db.raw.prepare(SQL).all() as unknown as
    { season: number; pid: string; code: string; gidp: number }[];
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = `${r.season}|${r.pid}`;
    const m = by.get(k) ?? new Map<string, number>();
    m.set(r.code, Number(r.gidp));
    by.set(k, m);
  }
  const found = [...by]
    .filter(([, m]) => m.size > 1)
    .map(([k, m]) => {
      const [season, playerId] = k.split("|");
      return {
        season: Number(season),
        playerId: playerId!,
        byTeam: m,
        total: [...m.values()].reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => b.season - a.season);
  return found[0] ?? null;
}

test("⚠이적 선수의 併殺打가 구단마다 갈라진다 — 합계를 실으면 옆의 打席 열과 어긋난다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const target = pick(db);
    /**
     * ⚠**후보가 없으면 통과가 아니라 실패다**(작업규칙 8). 「안 쟀음」을 「0건」으로 읽지 않는다.
     * 실측(2026-08-20): 9시즌에 **6명**이 있다(2018 ×2 · 2019 · 2021 · 2025 …).
     */
    assert.ok(
      target !== null,
      "두 구단에서 모두 併殺打가 1 이상인 선수-시즌이 없다 — 이 시험이 재려는 상황을 재현할 수 없다",
    );
    assert.ok(target.byTeam.size >= 2 && target.total > 0);

    const site = loadSite(db, { season: target.season, builtOn: "1970-01-01" });

    // ── 구단 페이지: **그 구단에서 낸 몫만**
    let seenTeams = 0;
    for (const [code, want] of target.byTeam) {
      const team: TeamPageData | undefined = site.teams.find((t) => t.teamCode === code);
      assert.ok(team !== undefined, `${target.season} ${code} 구단 페이지가 없다`);
      const row: TeamBatter | undefined = team.batters.find((r) => r.playerId === target.playerId);
      assert.ok(row !== undefined, `${code} 표에 ${target.playerId} 가 없다`);
      assert.equal(
        row.gidp,
        want,
        `${code} 표의 併殺打가 그 구단 몫(${want})이 아니다 — 시즌 합계(${target.total})를 실었을 것이다`,
      );
      // ⚠**합계보다 작아야 한다.** 이것이 「갈라졌다」의 증거다
      assert.ok(
        row.gidp < target.total,
        `${code} 표의 併殺打(${row.gidp})가 시즌 합계(${target.total})와 같다 — 갈라지지 않았다`,
      );
      seenTeams += 1;
    }
    assert.ok(seenTeams >= 2, `구단 페이지를 ${seenTeams}개밖에 못 봤다 — 이 시험이 공회전한다`);

    // ── 선수 페이지: **시즌 합계**
    const player: PlayerPageData | undefined = site.players.find((p) => p.playerId === target.playerId);
    assert.ok(player !== undefined, `선수 페이지가 없다: ${target.playerId}`);
    assert.ok(player.batting !== null, "타격 블록이 없다");
    assert.equal(
      player.batting.gidp,
      target.total,
      "선수 페이지의 併殺打가 시즌 합계가 아니다 — 한 구단 몫만 실었을 것이다",
    );
  } finally {
    db.close();
  }
});

// ── 「0打席이면 0」과 「모름」 ────────────────────────────────────────────────

/**
 * ⚠**이 규칙을 지키는 시험이 0본이었다**(2026-08-20 최종 검토 ②).
 * `gidp: … ?? (pa === 0 ? 0 : null)` 을 `?? null` 로 되돌리는 뮤테이션이
 * `packages/web/test` **920본을 전부 통과**했다. 왜 못 잡았는가:
 * ⑴ 위 시험은 **두 구단 모두 併殺打 ≥ 1** 인 선수만 고른다 — 0打席 경로에 절대 안 닿는다.
 * ⑵ `player-page.test.ts` 는 `gidp: 14` / `gidp: null` 의 **렌더링**만 본다 — 판정 규칙은 안 본다.
 * ⑶ 배포물 시험(`den-units`)은 併殺打 **값**을 안 읽는다.
 * 피해 규모(실측): `dist` 타격 블록 **3,998장 중 535장**이 `打席 0` 이고 지금 전부 `0` 을 낸다
 * (`—` 는 **0장**). 뮤테이션을 넣으면 그 535장이 다시 `—` 가 된다.
 */
test("⚠판정 규칙 자체 — 0打席은 0이고, 打席가 있는데 못 세면 모름이다(M11)", () => {
  // 센 수가 있으면 그대로. 0을 센 것도 「센 것」이다
  assert.equal(gidpOrUnknown(3, 400), 3);
  assert.equal(gidpOrUnknown(0, 400), 0);
  // 행이 없다 + 打席 0 = **알 수 있는 0**
  assert.equal(gidpOrUnknown(undefined, 0), 0);
  // 행이 없다 + 打席 있음 = 진짜 모름
  assert.equal(gidpOrUnknown(undefined, 1), null);
  assert.equal(gidpOrUnknown(undefined, 400), null);
  // ⚠**0 과 null 을 섞어 쓰지 않는다**(M11) — 타입이 같아도 뜻이 다르다
  assert.notEqual(gidpOrUnknown(undefined, 0), null);
});

/** 그 시즌에 실제로 센 併殺打 — 화면과 **다른 경로**로 구한다 */
const GIDP_BY_PLAYER = `
SELECT e.batter_id AS pid,
       SUM(CASE WHEN e.outcome = 'groundedIntoDoublePlay' OR e.raw_box LIKE '%併失%' THEN 1 ELSE 0 END) AS gidp
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final' AND g.season = ?
GROUP BY pid
`;

/** 가장 최근의, 타자가 실려 있는 시즌 */
function latestSeason(db: Db): number {
  const row = db.raw
    .prepare("SELECT MAX(season) AS s FROM game WHERE status = 'played' AND competition = 'regular'")
    .get() as unknown as { s: number | null };
  assert.notEqual(row.s, null, "정규시즌 경기가 하나도 없다");
  return Number(row.s);
}

/**
 * 두 방향을 **한 번의 `loadSite` 로** 잰다.
 *
 * ⚠**나누면 30초가 두 번이다**(실측: `loadSite` 1회 ≈ 30초). 재는 것이 같은 산출물이므로
 * 한 시험에 담되, 실패했을 때 **어느 방향인지** 메시지가 말하게 한다.
 */
test("⚠併殺打의 0과 「—」 — 打席 0 은 0, 打席가 있는데 못 세면 「—」(실DB)", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const season = latestSeason(db);
    const counted = new Map<string, number>();
    for (const r of db.raw.prepare(GIDP_BY_PLAYER).all(season) as unknown as { pid: string; gidp: number }[]) {
      counted.set(r.pid, Number(r.gidp));
    }
    assert.ok(counted.size > 100, `${season}시즌 타석 로그가 ${counted.size}명뿐이다 — 시험이 공회전한다`);

    const site = loadSite(db, { season, builtOn: "1970-01-01" });
    const batters = site.players.filter((p) => p.batting !== null);
    assert.ok(batters.length > 100, `타자가 ${batters.length}명뿐이다 — 공회전`);

    // ── ① 打席 0 → **0**. 「—」가 아니다
    const zeroPa = batters.filter((p) => p.batting!.line.pa === 0);
    /**
     * ⚠**대상이 0명이면 통과가 아니라 실패다**(작업규칙 8) — 실측(2026-08-20)으로
     * 배포물 타격 블록 3,998장 중 **535장**이 `打席 0` 이다.
     */
    assert.ok(zeroPa.length >= 10, `打席 0 인 타자가 ${season}시즌에 ${zeroPa.length}명뿐이다 — 공회전`);
    for (const p of zeroPa) {
      assert.equal(
        p.batting!.gidp,
        0,
        `①${p.playerId}: 打席 0 인데 併殺打가 ${p.batting!.gidp} 다 — 「모름(—)」으로 강등됐다`,
      );
    }

    // ── ② 「—」가 나오는 조건은 **단 하나** — 打席가 있는데 타석 로그에 행이 없을 때다
    /**
     * ⚠**「0 == 0」처럼 보이지만 공회전이 아니다.** 양쪽을 **다른 경로**로 구한다:
     * 규칙이 `?? null` 로 되돌아가면 왼쪽(화면의 「—」)이 수백으로 뛰고 오른쪽(SQL)은 그대로라
     * **떨어진다.** 소급 시즌 백필로 진짜 결측이 생기면 그때는 양쪽이 함께 늘어야 한다.
     */
    const unknown = batters.filter((p) => p.batting!.gidp === null).map((p) => p.playerId);
    const shouldBeUnknown = batters
      .filter((p) => p.batting!.line.pa > 0 && !counted.has(p.playerId))
      .map((p) => p.playerId);
    assert.deepEqual(
      [...unknown].sort(),
      [...shouldBeUnknown].sort(),
      "②화면의 「—」와 「打席가 있는데 타석 로그가 없는 사람」이 어긋난다",
    );

    // ── ③ 센 사람은 센 수 그대로 — 판정이 값을 덮지 않는다
    let matched = 0;
    for (const p of batters) {
      const c = counted.get(p.playerId);
      if (c === undefined) continue;
      assert.equal(p.batting!.gidp, c, `③${p.playerId}: 併殺打가 타석 로그의 수와 다르다`);
      matched += 1;
    }
    assert.ok(matched > 100, `③대조한 타자가 ${matched}명뿐이다 — 공회전`);
  } finally {
    db.close();
  }
});
