/**
 * 引き分けの解剖 — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠**이 지표의 함정은 「연장이 없는 해가 있다」다.** NPB 는 규정을 자주 바꾼다 —
 * 2021 년은 **연장 자체가 없었고**(실측: 최대 9회 · 무승부 102), 2020 년은 **10회까지**였다.
 * 「9회 뒤에는 연장이 있다」를 상수로 박으면 그 두 해에서 조용히 틀린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertPlayer } from "@bb-app/store";
import { drawRate, extraDecidedRate, seasonDraws } from "../src/draw.ts";

const NOW = "2026-08-20T00:00:00.000Z";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-draw-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function game(
  db: ReturnType<typeof openDb>,
  o: {
    id: string;
    season: number;
    away: number;
    home: number;
    /** 마지막 이닝. `null` 이면 타석 로그를 만들지 않는다(이닝 미상) */
    lastInning: number | null;
    competition?: string;
    status?: "played" | "notPlayed";
  },
): void {
  upsertGame(db, {
    gameId: o.id, season: o.season, gameDate: `${o.season}-04-01`, awayCode: "g", homeCode: "t",
    gameNo: 1, status: o.status ?? "played", notPlayedReason: null,
    competition: o.competition ?? "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: o.away, homeRuns: o.home,
  });
  if (o.lastInning === null) return;
  upsertPlayer(db, "B1", "B1", NOW);
  upsertPlayer(db, "P1", "P1", NOW);
  for (let i = 1; i <= o.lastInning; i += 1) {
    db.raw
      .prepare(
        `INSERT INTO pa_event
         (game_id, seq, inning, half, outs_before, bases, batter_id, pitcher_id,
          outcome, rbi, raw_box, raw_pbp, status, runs_scored, ball_count)
         VALUES (?, ?, ?, 'top', 0, '', 'B1', 'P1', 'fieldedOut', 0, '', '', 'final', 0, '0-0より')`,
      )
      .run(o.id, i, i);
  }
}

test("무승부와 연장을 시즌별로 나눠 센다", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2026, away: 3, home: 2, lastInning: 9 });
    game(db, { id: "g2", season: 2026, away: 2, home: 2, lastInning: 12 });
    game(db, { id: "g3", season: 2026, away: 4, home: 3, lastInning: 11 });
    const [s] = seasonDraws(db, "regular", "9999-12-31", 2000, 2100);
    assert.ok(s !== undefined);
    assert.equal(s.season, 2026);
    assert.equal(s.games, 3);
    assert.equal(s.draws, 1);
    assert.equal(s.extra, 2);
    assert.equal(s.extraDrawn, 1);
    assert.equal(s.regulationDrawn, 0);
    assert.equal(s.maxInning, 12);
    assert.equal(s.inningUnknown, 0);
  });
});

test("⚠연장이 없는 해를 다룰 수 있다 — 2021년은 최대 9회였고 무승부가 102였다", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2021, away: 1, home: 1, lastInning: 9 });
    game(db, { id: "g2", season: 2021, away: 5, home: 1, lastInning: 9 });
    const [s] = seasonDraws(db, "regular", "9999-12-31", 2000, 2100);
    assert.ok(s !== undefined);
    assert.equal(s.draws, 1);
    assert.equal(s.extra, 0, "연장이 없는 해에 연장 경기를 만들어냈다");
    assert.equal(s.extraDrawn, 0);
    assert.equal(s.regulationDrawn, 1, "9회로 끝난 무승부를 세지 않았다");
    assert.equal(s.maxInning, 9);
    // 연장이 0이면 「연장에서 결착난 비율」은 값이 없다 — 0.000 이 아니다(M11)
    assert.equal(extraDecidedRate(s).value, null);
    assert.equal(extraDecidedRate(s).denominator, 0, "분모를 버리지 않는다(M2)");
  });
});

test("⚠연장이 있는 해의 9회 무승부는 콜드 게임이다 — 별도로 센다", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2022, away: 2, home: 2, lastInning: 9 });
    game(db, { id: "g2", season: 2022, away: 2, home: 2, lastInning: 12 });
    game(db, { id: "g3", season: 2022, away: 3, home: 1, lastInning: 11 });
    const [s] = seasonDraws(db, "regular", "9999-12-31", 2000, 2100);
    assert.ok(s !== undefined);
    assert.equal(s.draws, 2);
    assert.equal(s.regulationDrawn, 1);
    assert.equal(s.extraDrawn, 1);
    assert.equal(s.extra, 2);
    // 연장 2경기 중 1경기가 결착
    assert.equal(extraDecidedRate(s).value, 0.5);
  });
});

test("⚠미성립 경기는 세지 않는다 — 기록이 무효다", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2026, away: 0, home: 0, lastInning: null, status: "notPlayed" });
    game(db, { id: "g2", season: 2026, away: 1, home: 0, lastInning: 9 });
    const [s] = seasonDraws(db, "regular", "9999-12-31", 2000, 2100);
    assert.equal(s?.games, 1);
    assert.equal(s?.draws, 0, "우천 노게임을 0-0 무승부로 셌다");
  });
});

test("⚠대회를 섞지 않는다(§2-1)", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2026, away: 1, home: 1, lastInning: 12 });
    game(db, { id: "g2", season: 2026, away: 1, home: 1, lastInning: 9, competition: "allStar" });
    assert.equal(seasonDraws(db, "regular", "9999-12-31", 2000, 2100)[0]?.draws, 1);
    assert.equal(seasonDraws(db, "allStar", "9999-12-31", 2000, 2100)[0]?.draws, 1);
  });
});

test("⚠타석 로그가 없는 경기는 이닝을 「모름」으로 센다 — 9회로 때우지 않는다(M11)", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2026, away: 1, home: 1, lastInning: null });
    game(db, { id: "g2", season: 2026, away: 1, home: 0, lastInning: 12 });
    const [s] = seasonDraws(db, "regular", "9999-12-31", 2000, 2100);
    assert.ok(s !== undefined);
    assert.equal(s.games, 2);
    assert.equal(s.draws, 1);
    assert.equal(s.inningUnknown, 1);
    assert.equal(s.extra, 1, "이닝을 모르는 경기를 연장으로도 9회로도 세지 않는다");
    assert.equal(s.extraDrawn, 0);
    assert.equal(s.regulationDrawn, 0, "이닝을 모르는 무승부를 「9회 무승부」로 셌다");
  });
});

test("시즌 범위로 자른다 — 미래 시즌을 과거 화면에 싣지 않는다", async () => {
  await withDb((db) => {
    game(db, { id: "g1", season: 2024, away: 1, home: 1, lastInning: 12 });
    game(db, { id: "g2", season: 2026, away: 1, home: 1, lastInning: 12 });
    assert.equal(seasonDraws(db, "regular", "9999-12-31", 2018, 2024).length, 1);
    assert.equal(seasonDraws(db, "regular", "9999-12-31", 2018, 2026).length, 2);
  });
});

test("⚠경기가 0이면 비율을 내지 않는다(M11)", () => {
  const empty = {
    season: 2026, games: 0, draws: 0, extra: 0, extraDrawn: 0, regulationDrawn: 0,
    maxInning: null, inningUnknown: 0,
  };
  assert.equal(drawRate(empty).value, null);
  assert.equal(drawRate(empty).denominator, 0);
});
