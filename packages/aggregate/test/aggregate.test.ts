import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";
import {
  buildLeagues,
  battingEntries,
  neededOuts,
  pitchingEntries,
  rankBatters,
  rankPitchersInRole,
  teamGamesOf,
} from "../src/leaderboard.ts";
import { qualifiedBatterPa } from "@bb-app/metrics";
import type { BattingEntry, PitchingEntry } from "../src/leaderboard.ts";

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
    h: 4, hr: 1, bb: 1, hbp: 0, so: 5, runs: er, er, wp: null, balk: null,
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

/**
 * ⚠**규정타석의 분모는 「그 선수의 소속 구단」 시합수다**(NPB 규칙 · `docs/metrics` §5).
 *
 * 예전에는 **리그 최다 팀**의 시합수를 전원에게 썼다. 그러면 **적게 치른 팀의 선수가
 * 규정을 채웠는데도 탈락**한다 — 실측(2026-08-18): 최다 111경기 대 최소 102경기로 9경기 차,
 * 규정타석이 **345 대 317 로 28타석** 벌어졌다.
 * 그리고 화면은 그 판정을 **「NPB公式」이라고 적고 있었다**(2026-08-18 다방면 감사 P1).
 *
 * ⚠**시험 1,221본이 이것을 하나도 못 잡았다.** 리그 안의 팀들이 **같은 경기 수**를 치른
 * 픽스처만 있었기 때문이다 — 이 시험은 **일부러 다르게** 만든다.
 */
test("⚠규정타석 분모는 소속 구단 시합수다 — 리그 최다가 아니다", async () => {
  await withDb((db) => {
    // 阪神(t)·巨人(g) 는 10경기, 中日(d)·広島(c) 는 6경기를 치른다
    for (let i = 1; i <= 10; i += 1) {
      const id = `tg${i}`;
      seedGame(db, id, `2026-04-${String(i).padStart(2, "0")}`, "t", "g");
      seedBatter(db, id, "1001", "away", 3, 1); // 阪神 소속: 30타석
      seedPitcher(db, id, "2001", "home", 27, 1);
    }
    for (let i = 1; i <= 6; i += 1) {
      const id = `dc${i}`;
      seedGame(db, id, `2026-05-${String(i).padStart(2, "0")}`, "d", "c");
      seedBatter(db, id, "1002", "away", 3, 1); // 中日 소속: 18타석
      seedPitcher(db, id, "2002", "home", 27, 1);
    }

    const bundle = buildLeagues(aggregateSeason(db, 2026)).find((b) => b.league === "central")!;

    // ⚠**분모가 팀마다 다르다.** 阪神 10경기 → 31타석 · 中日 6경기 → 19타석
    assert.equal(teamGamesOf(bundle, "t"), 10, "阪神 시합수가 다르다");
    assert.equal(teamGamesOf(bundle, "d"), 6, "中日 시합수가 다르다");
    assert.equal(bundle.teamGames, 10, "리그 최다는 그대로 10이어야 한다");

    const ranked = rankBatters(bundle, battingEntries(bundle), (e: BattingEntry) => e.avg);
    const tiger = ranked.find((r) => r.item.player.playerId === "1001");
    const dragon = ranked.find((r) => r.item.player.playerId === "1002");
    assert.ok(tiger && dragon);

    /**
     * ⚠**여기가 급소다.** 中日 선수는 18타석이고,
     * · 옳은 분모(6경기 → 19타석)로도 미달이지만,
     * · 리그 최다(10경기 → 31타석)를 쓰면 **훨씬 더 크게** 미달로 밀린다.
     * 그래서 「자격선 자체」를 재서 고정한다 — 순위만 보면 두 규칙이 같은 답을 낼 수 있다.
     */
    assert.equal(qualifiedBatterPa(teamGamesOf(bundle, "t")), 31, "阪神 규정타석이 다르다");
    assert.equal(qualifiedBatterPa(teamGamesOf(bundle, "d")), 19, "中日 규정타석이 다르다");
    assert.notEqual(
      qualifiedBatterPa(teamGamesOf(bundle, "d")),
      qualifiedBatterPa(bundle.teamGames),
      "팀별 분모가 리그 최다와 같아져 버렸다 — 이 시험이 아무것도 재지 못한다",
    );
  });
});

/**
 * ⚠**타자만 고쳤고 투수는 그대로였다**(2026-08-18 감사 P1 · 하루 뒤에 잡혔다).
 *
 * 위 시험이 타자 쪽을 고정한 그 커밋에서 `rankPitchersInRole` 은 **자격선을 미리 한 번**
 * 계산해 전원에게 쓰고 있었고, 그 분모가 **리그 최다 팀**이었다.
 * 실측 2026년 기준 早川·エスピノーザ·星·ハーン·藤平 **5명**이 자기 팀 기준을 채우고도
 * 순위에서 통째로 사라졌다 — 예외도 로그도 없이 「順位なし」로만 보이므로
 * 「아직 이닝이 모자라구나」로 읽힌다. 그 위의 등수도 전부 한 칸씩 밀렸다.
 *
 * ⚠**「같은 규칙을 두 곳에 쓰면 절반만 고쳐진다」의 실증**이라 여기 남긴다.
 */
test("⚠규정투구회 분모도 소속 구단 시합수다 — 자격자를 순위에서 지우지 않는다", async () => {
  await withDb((db) => {
    // 阪神(t)·巨人(g) 는 10경기, 中日(d)·広島(c) 는 6경기
    for (let i = 1; i <= 10; i += 1) {
      const id = `tg${i}`;
      seedGame(db, id, `2026-04-${String(i).padStart(2, "0")}`, "t", "g");
      // ⚠타자가 0명이면 `buildLeagues` 가 그 리그를 통째로 건너뛴다
      seedBatter(db, id, "1001", "away", 3, 1);
      seedPitcher(db, id, "2001", "home", 2, 0); // 巨人: 20아웃
    }
    for (let i = 1; i <= 6; i += 1) {
      const id = `dc${i}`;
      seedGame(db, id, `2026-05-${String(i).padStart(2, "0")}`, "d", "c");
      seedBatter(db, id, "1002", "away", 3, 1);
      seedPitcher(db, id, "2002", "home", 3, 1); // 広島: 18아웃
    }
    /**
     * ⚠**여기가 급소다.** 中日 구원 8아웃 —
     * · 옳은 분모(6경기 → 6아웃)로는 **자격이 있고**,
     * · 리그 최다(10경기 → 10아웃)를 쓰면 **미달**이 된다.
     * 두 규칙이 정반대 답을 내는 구간을 일부러 골랐다.
     */
    for (let i = 1; i <= 2; i += 1) seedPitcher(db, `dc${i}`, "2003", "away", 4, 1);

    const bundle = buildLeagues(aggregateSeason(db, 2026)).find((b) => b.league === "central")!;
    const entries = pitchingEntries(bundle);
    const mine = entries.find((e) => e.player.playerId === "2003");
    assert.ok(mine, "픽스처의 투수가 집계에 없다 — 이 시험이 아무것도 안 재고 있다");
    assert.equal(mine.player.role, "reliever", "역할이 바뀌었다 — 자격선 기준이 달라진다");
    assert.equal(mine.player.line.outs, 8, "아웃 수가 바뀌었다 — 판정 구간을 벗어난다");

    assert.equal(neededOuts(bundle, "d", "reliever"), 6, "中日 기준이 다르다");
    assert.equal(neededOuts(bundle, "t", "reliever"), 10, "리그 최다 기준이 다르다");
    assert.notEqual(
      neededOuts(bundle, "d", "reliever"),
      neededOuts(bundle, "t", "reliever"),
      "두 기준이 같아졌다 — 이 시험이 아무것도 재지 못한다",
    );

    const ranked = rankPitchersInRole(bundle, entries, "reliever", (e: PitchingEntry) => e.era);
    const row = ranked.find((r) => r.item.player.playerId === "2003");
    assert.ok(row, "순위 목록에서 사라졌다 — 자격 미달도 목록에는 남아야 한다(M11)");
    assert.notEqual(
      row.rank,
      null,
      "자기 구단 기준(6아웃)을 채운 8아웃 투수가 순위에서 빠졌다 — 리그 최다 기준을 쓰고 있다",
    );
  });
});

/**
 * ⚠**모르는 구단 코드는 리그 최다로 떨어진다**(M11).
 * 조용히 0이 되면 `ceil(0 × 3.1) = 0` 이라 **전원이 자격을 얻는다** — 10타석 .400 이 1위가 된다.
 */
test("⚠모르는 구단 코드는 0이 아니라 리그 최다로 떨어진다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01", "t", "g");
    seedBatter(db, "g1", "1001", "away", 1);
    seedPitcher(db, "g1", "2001", "home", 27, 1);
    const bundle = buildLeagues(aggregateSeason(db, 2026)).find((b) => b.league === "central")!;
    assert.equal(teamGamesOf(bundle, "존재하지않는코드"), bundle.teamGames);
    assert.notEqual(teamGamesOf(bundle, "존재하지않는코드"), 0, "0으로 떨어지면 전원이 자격을 얻는다");
  });
});
