import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";
import { buildLeagues, battingEntries, rankBatters } from "../src/leaderboard.ts";
import type { BattingEntry } from "../src/leaderboard.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function seedGame(db: Db, id: string, date: string, away: string, home: string, competition = "regular"): void {
  upsertGame(db, {
    gameId: id,
    season: 2026,
    gameDate: date,
    awayCode: away,
    homeCode: home,
    gameNo: 1,
    status: "played",
    notPlayedReason: null,
    competition,
    sourceUrl: `https://npb.jp/${id}`,
    fetchedAt: NOW,
  });
}

function seedBatter(db: Db, gameId: string, playerId: string, side: "away" | "home", h: number, hr = 0): void {
  upsertPlayer(db, playerId, `선수${playerId}`, NOW);
  upsertBatting(db, {
    gameId, playerId, side, battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h, d2: 0, d3: 0, hr,
    bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 1, roe: 0,
    runs: 0, rbi: hr, sb: 0,
  });
}

function seedPitcher(db: Db, gameId: string, playerId: string, side: "away" | "home", outs: number, er: number): void {
  upsertPlayer(db, playerId, `투수${playerId}`, NOW);
  upsertPitching(db, {
    gameId, playerId, side, decision: null, outs, bf: 20, pitches: 80,
    h: 4, hr: 1, bb: 1, hbp: 0, so: 5, runs: er, er,
  });
}

async function withDb(fn: (db: Db) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-agg-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("소속 구단은 game의 코드와 side로 정해진다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 2);
    seedBatter(db, "g1", "1002", "home", 1);

    const agg = aggregateSeason(db, 2026);
    assert.equal(agg.batting.find((b) => b.playerId === "1001")?.teamCode, "t");
    assert.equal(agg.batting.find((b) => b.playerId === "1002")?.teamCode, "g");
    assert.equal(agg.batting.find((b) => b.playerId === "1001")?.league, "central");
  });
});

test("⚠올스타전은 정규시즌 집계에 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 2, 1);
    seedGame(db, "as1", "2026-07-20", "pl", "cl", "allStar");
    seedBatter(db, "as1", "1001", "home", 3, 2);

    const agg = aggregateSeason(db, 2026);
    const p = agg.batting.find((b) => b.playerId === "1001");
    assert.ok(p);
    assert.equal(p.games, 1, "올스타 1경기가 섞이면 안 된다");
    assert.equal(p.line.h, 2);
    assert.equal(p.line.hr, 1, "올스타 홈런 2개가 더해지면 안 된다");
  });
});

test("⚠기준일로 자를 수 있다 — 외부 공표값과 대조하려면 필수", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 2);
    seedGame(db, "g2", "2026-04-02", "t", "g");
    seedBatter(db, "g2", "1001", "away", 3);

    assert.equal(aggregateSeason(db, 2026, "regular", "2026-04-01").batting[0]?.line.h, 2);
    assert.equal(aggregateSeason(db, 2026, "regular", "2026-04-02").batting[0]?.line.h, 5);
  });
});

test("중지 경기는 집계에 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 2);
    upsertGame(db, {
      gameId: "g2", season: 2026, gameDate: "2026-04-02", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "notPlayed", notPlayedReason: "中止", competition: "regular",
      sourceUrl: "https://npb.jp/g2", fetchedAt: NOW,
    });
    assert.equal(aggregateSeason(db, 2026).batting[0]?.games, 1);
  });
});

test("리그 상수는 리그별로 따로 나온다", async () => {
  await withDb((db) => {
    seedGame(db, "c1", "2026-04-01", "t", "g");
    seedBatter(db, "c1", "1001", "away", 2, 1);
    seedPitcher(db, "c1", "2001", "home", 27, 3);
    seedGame(db, "p1", "2026-04-01", "h", "l");
    seedBatter(db, "p1", "1101", "away", 1);
    seedPitcher(db, "p1", "2101", "home", 27, 1);

    const bundles = buildLeagues(aggregateSeason(db, 2026));
    assert.equal(bundles.length, 2);
    const central = bundles.find((b) => b.league === "central");
    const pacific = bundles.find((b) => b.league === "pacific");
    assert.ok(central && pacific);
    assert.notEqual(central.constants.averageWoba, pacific.constants.averageWoba);
  });
});

test("⚠자격 미달자가 순위를 밀어내지 않는다", async () => {
  await withDb((db) => {
    // 팀이 10경기를 치렀다 → 규정타석 = ceil(10 × 3.1) = 31
    for (let i = 1; i <= 10; i += 1) {
      const id = `g${i}`;
      seedGame(db, id, `2026-04-${String(i).padStart(2, "0")}`, "t", "g");
      seedBatter(db, id, "1001", "away", 1); // 40타석 4안타 = .100 자격자
      seedPitcher(db, id, "2001", "home", 27, 1);
    }
    // 1경기만 나와 4타수 4안타(1.000)인 미달자
    seedBatter(db, "g1", "1002", "away", 4);

    const bundle = buildLeagues(aggregateSeason(db, 2026)).find((b) => b.league === "central")!;
    const ranked = rankBatters(bundle, battingEntries(bundle), (e: BattingEntry) => e.avg);

    const top = ranked.find((r) => r.rank === 1);
    assert.equal(top?.item.player.playerId, "1001", "미달자가 1위를 차지하면 안 된다");

    const short = ranked.find((r) => r.item.player.playerId === "1002");
    assert.ok(short, "미달자도 목록에는 남는다");
    assert.equal(short.rank, null);
    assert.equal(short.rate.value, 1, "성적 자체는 그대로 보인다");
  });
});

test("스캔 행 수를 함께 낸다 — D1 읽기 예산 감시", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 2);
    seedPitcher(db, "g1", "2001", "home", 27, 1);
    assert.equal(aggregateSeason(db, 2026).readRows, 2);
  });
});
