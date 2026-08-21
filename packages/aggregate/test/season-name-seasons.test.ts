/**
 * **이름을 내는 집계 전부를 실DB에 돌려 대조한다.**
 *
 * ⚠**이 시험은 「합성 DB 시험이 못 잡는 것」을 잡으려고 있다.** 배선(2026-08-21) 중에
 * 실제로 셋이 나왔고 **셋 다 합성 시험과 타입체크를 통과했다**:
 *
 * | 무엇 | 어떻게 드러났나 |
 * |---|---|
 * | `splits` 타자 쿼리에 투수 조인이 들어가 별칭 `psn` 이 **두 번** | `ambiguous column name` 으로 **던진다** |
 * | `splits` 투수 쿼리는 조인 없이 `psn` 참조 | `no such column` 으로 **던진다** |
 * | `batted-ball` 투수판이 시즌명을 **`batter_id`** 로 조인 | 안 던진다. **다른 사람 이름**이 조용히 실린다 |
 *
 * 셋째가 이 시험의 존재 이유다 — **던지지 않는 결함**이라 「돌려 보기」로는 안 잡히고,
 * **나온 이름을 정본과 대조**해야만 잡힌다.
 *
 * ## 무엇을 정본으로 두는가
 *
 * `player_season_name`(적재가 그 시즌 박스에서 뽑은 표기)이다. 화면에 나간 이름이 그것과
 * 다르면 배선이 틀린 것이다. ⚠**그 시즌 행이 없는 선수는 대조 대상이 아니다** —
 * `player.display_name` 으로 떨어지는 것이 설계된 동작이다(`season-name.ts`).
 *
 * ⚠**분모를 반드시 센다**(작업규칙 7). 대조한 건수가 0이면 **시험이 아무것도 안 잰 것**이므로
 * 통과가 아니라 실패다 — 이 저장소는 「0건 = 합격」으로 읽어 데인 적이 있다(작업규칙 8).
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";
import { battingSplits, matchups, pitchingSplits } from "../src/splits.ts";
import { battedBalls } from "../src/batted-ball.ts";
import { countLines } from "../src/count.ts";
import { groundedIntoDoublePlays } from "../src/gidp.ts";
import { steals } from "../src/steal.ts";
import { foldRelief, midInningEntries } from "../src/relief.ts";
import { careerNames } from "../src/season-name.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = join(ROOT, "data", "bb.sqlite");
const HAS_DB = existsSync(DB);

if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

const NOW = "2026-08-21T00:00:00.000Z";
const THROUGH = "9999-12-31";

/**
 * ⚠**두 시즌을 본다.** 한 시즌만 보면 「시즌을 안 보고 아무 이름이나 쓴다」가 통과한다 —
 * 그게 고치고 있는 결함의 원래 모양이다. 표기가 실제로 흔들린 해를 고른다.
 */
const SEASONS = [2018, 2026] as const;

test("⚠이름을 내는 집계 전부가 그 시즌의 표기를 낸다 — 실DB", { skip: HAS_DB ? false : "data/bb.sqlite 없음" }, () => {
  const db = openDb(DB, NOW);
  try {
    const has = (db.raw
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='player_season_name'")
      .get() as unknown as { n: number }).n > 0;
    assert.equal(has, true, "player_season_name 표가 없다 — 마이그레이션 018 이 안 걸렸다");

    /**
     * ⚠**출처별로 센다.** 합계만 세면 **한 출처가 통째로 0건**이어도 다른 출처의 수에 묻혀
     * 통과한다 — 그러면 이 시험은 「전부」라는 이름으로 일부만 재게 된다(작업규칙 7·8).
     */
    const byLabel = new Map<string, number>();
    const bad: string[] = [];

    for (const season of SEASONS) {
      const canon = new Map<string, string>();
      for (const r of db.raw
        .prepare("SELECT player_id AS id, display_name AS n FROM player_season_name WHERE season = ?")
        .all(season) as unknown as { id: string; n: string }[]) {
        canon.set(r.id, r.n);
      }
      assert.ok(canon.size > 0, `${season} 시즌의 표시명이 한 건도 없다 — 적재가 안 돌았다`);

      /** 그 시즌 행이 있는 선수만 본다. 없으면 폴백이 설계된 동작이다 */
      const cmp = (label: string, id: string, name: string): void => {
        const want = canon.get(id);
        if (want === undefined) return;
        byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
        if (want !== name && bad.length < 20) bad.push(`${season} ${label} ${id}: 화면=${name} 정본=${want}`);
      };

      const agg = aggregateSeason(db, season);
      for (const b of agg.batting) cmp("season.batting", b.playerId, b.displayName);
      for (const p of agg.pitching) cmp("season.pitching", p.playerId, p.displayName);

      for (const s of battingSplits(db, "opponentHand", season, "regular", THROUGH)) {
        cmp("splits.batting", s.playerId, s.displayName);
      }
      for (const s of pitchingSplits(db, "opponentHand", season, "regular", THROUGH)) {
        cmp("splits.pitching", s.playerId, s.displayName);
      }

      // ⚠**타자판과 투수판을 둘 다 본다** — 투수판은 `.replace()` 로 만들어지므로 따로 틀릴 수 있다
      for (const r of battedBalls(db, season, "regular", THROUGH, false)) {
        cmp("battedBall.batter", r.playerId, r.displayName);
      }
      for (const r of battedBalls(db, season, "regular", THROUGH, true)) {
        cmp("battedBall.pitcher", r.playerId, r.displayName);
      }
      for (const r of countLines(db, season, "regular", THROUGH, false)) {
        cmp("count.batter", r.playerId, r.displayName);
      }
      for (const r of countLines(db, season, "regular", THROUGH, true)) {
        cmp("count.pitcher", r.playerId, r.displayName);
      }

      for (const r of groundedIntoDoublePlays(db, season, "regular", THROUGH)) {
        cmp("gidp", r.playerId, r.displayName);
      }
      for (const r of steals(db, season, "regular", THROUGH)) {
        cmp("steal", r.playerId, r.displayName);
      }

      // 그 시즌만 보는 火消し 표 — 시즌 표기가 그대로 나와야 한다
      const scan = midInningEntries(db, "regular", THROUGH, season, season);
      for (const l of foldRelief(scan.entries, () => undefined)) {
        cmp("relief", l.pitcherId, l.displayName);
      }

      // 통산 대전을 **그 시즌만**으로 부르면 시즌 표기와 같아야 한다(`careerNameJoin` 의 범위 끝이 곧 그 시즌)
      // ⚠**한 시즌에서 같은 투수를 30타석 만나는 일은 없다** — 임계를 통산 것으로 두면 행이 0이 된다
      for (const m of matchups(db, season, 5, "regular", THROUGH, season)) {
        cmp("matchup.pitcher", m.pitcherId, m.pitcherName);
        cmp("matchup.batter", m.batterId, m.batterName);
      }
    }

    assert.deepEqual(bad, [], `그 시즌의 표기와 다른 이름이 나갔다(앞 20건)\n${bad.join("\n")}`);

    /**
     * ⚠**이 목록이 곧 「전부」의 정의다.** 배선을 새로 만들면 여기에 더해라 —
     * 안 더하면 그 자리는 **이 시험이 한 번도 안 본 자리**가 된다.
     */
    const SOURCES = [
      "season.batting", "season.pitching", "splits.batting", "splits.pitching",
      "battedBall.batter", "battedBall.pitcher", "count.batter", "count.pitcher",
      "gidp", "steal", "relief", "matchup.pitcher", "matchup.batter",
    ] as const;
    const empty = SOURCES.filter((k) => (byLabel.get(k) ?? 0) === 0);
    assert.deepEqual(empty, [], `대조 건수가 0인 출처가 있다 — 그 자리는 안 재고 있다: ${empty.join(", ")}`);
    const total = [...byLabel.values()].reduce((a, b) => a + b, 0);
    console.log(`  · 대조 ${total}건 / 어긋남 0건 / 출처 ${SOURCES.length}종 (시즌 ${SEASONS.join("·")})`);
    for (const k of SOURCES) console.log(`    - ${k}: ${byLabel.get(k)}건`);
  } finally {
    db.close();
  }
});

/**
 * **통산 표의 규칙은 다르다** — 「범위 안에서 가장 나중 시즌의 이름」(`careerNameJoin`).
 *
 * ⚠**여기가 원래 결함이 남아 있던 자리다.** 여러 시즌을 접으면 SQL 은 그룹 안의 아무 행이나 고르고
 * JS 로 접으면 **가장 오래된 것**이 이긴다. 그래서 **표기가 흔들린 선수**를 골라
 * 「통산 범위를 넓혀도 최신 이름이 나오는가」를 직접 본다.
 */
test("⚠통산 표는 범위 안에서 가장 나중 시즌의 이름을 쓴다 — 실DB", { skip: HAS_DB ? false : "data/bb.sqlite 없음" }, () => {
  const db = openDb(DB, NOW);
  try {
    const season = 2026;
    /** 표기가 흔들렸고 그 시즌에도 뛴 선수 — 통산 범위를 넓혀도 최신 이름이어야 한다 */
    const drifted = db.raw
      .prepare(
        `SELECT a.player_id AS id, a.display_name AS latest
           FROM player_season_name a
           JOIN player_season_name b ON b.player_id = a.player_id AND b.season < a.season
                                    AND b.display_name <> a.display_name
          WHERE a.season = ?
          GROUP BY a.player_id`,
      )
      .all(season) as unknown as { id: string; latest: string }[];
    assert.ok(drifted.length > 0, "표기가 흔들린 선수가 한 명도 없다 — 시험의 전제가 깨졌다");

    const want = new Map(drifted.map((r) => [r.id, r.latest]));
    let checked = 0;
    const bad: string[] = [];
    // 보유 첫 시즌부터 2026 까지 — 여러 시즌이 한 행으로 접히는 상태를 만든다
    const from = (db.raw.prepare("SELECT MIN(season) AS s FROM game").get() as unknown as { s: number }).s;
    assert.ok(from < season, `통산 범위가 한 시즌뿐이다(${from}~${season}) — 이 시험이 아무것도 안 잰다`);

    const scan = midInningEntries(db, "regular", THROUGH, from, season);
    for (const l of foldRelief(scan.entries, () => undefined, careerNames(db, season))) {
      const w = want.get(l.pitcherId);
      if (w === undefined) continue;
      checked += 1;
      if (w !== l.displayName && bad.length < 20) bad.push(`relief통산 ${l.pitcherId}: 화면=${l.displayName} 최신=${w}`);
    }
    for (const m of matchups(db, season, 30, "regular", THROUGH, from)) {
      for (const [id, name, label] of [
        [m.pitcherId, m.pitcherName, "matchup통산.pitcher"],
        [m.batterId, m.batterName, "matchup통산.batter"],
      ] as const) {
        const w = want.get(id);
        if (w === undefined) continue;
        checked += 1;
        if (w !== name && bad.length < 20) bad.push(`${label} ${id}: 화면=${name} 최신=${w}`);
      }
    }

    assert.deepEqual(bad, [], `통산 표에 옛 이름이 남았다(앞 20건)\n${bad.join("\n")}`);
    assert.ok(checked > 0, "대조 건수가 0이다 — 시험이 아무것도 안 쟀다");
    console.log(`  · 통산 대조 ${checked}건 / 어긋남 0건 (표기 흔들린 선수 ${drifted.length}명)`);
  } finally {
    db.close();
  }
});
