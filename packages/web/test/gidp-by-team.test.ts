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
import { loadSite } from "../src/query.ts";
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
