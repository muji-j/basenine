/**
 * 경기 한 판.
 *
 * ⚠**여기서 잡는 것은 「0과 없음을 구별하는가」와 「복원이 맞는지 확인하는가」다.**
 * 홈 팀이 9회말을 치지 않은 경기가 실측 1,487경기 중 674경기다 — 거기에 `0`을 찍으면
 * 절반의 경기 페이지가 야구를 아는 사람에게 고장으로 보인다.
 * 그리고 이닝별 득점은 **우리가 조립한 값**이라, 공표 득점과 맞는지 매번 확인하지 않으면
 * 조용히 틀린 표가 나간다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { KEY_PLAY_LIMIT, gameDetails } from "../src/game.ts";
import type { RunExpectancy } from "../src/run-expectancy.ts";
import { stateKey } from "../src/run-expectancy.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const G = "2026/0814/s-db-17";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-game-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "B1", "打者", NOW);
    upsertPlayer(db, "P1", "投手", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function game(db: Db, awayRuns: number, homeRuns: number): void {
  upsertGame(db, {
    gameId: G,
    season: 2026,
    gameDate: "2026-08-14",
    awayCode: "db",
    homeCode: "s",
    gameNo: 17,
    status: "played",
    notPlayedReason: null,
    competition: "regular",
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
    awayRuns,
    homeRuns,
    venue: "神宮",
  });
}

let seq = 0;
function pa(
  inning: number,
  half: "top" | "bottom",
  over: Partial<PaEventRow> = {},
): PaEventRow {
  seq += 1;
  return {
    gameId: G, seq, inning, half, outsBefore: 0, bases: "",
    batterId: "B1", pitcherId: "P1", outcome: "single", rbi: 0,
    rawBox: "右前安", rawPbp: "ライト前ヒット", ballCount: null, status: "final", runsScored: 0,
    ...over,
  };
}

function events(db: Db, rows: readonly PaEventRow[]): void {
  seq = 0;
  replacePaEvents(db, G, rows as PaEventRow[]);
}

/** 아주 단순한 RE 행렬 — **값이 맞는지가 아니라 「쓰이는가」를 본다** */
function fakeRe(): RunExpectancy {
  const matrix = new Map<string, number>();
  for (const bases of ["", "1", "2", "3", "12", "13", "23", "123"]) {
    for (const outs of [0, 1, 2]) {
      // 주자가 많을수록·아웃이 적을수록 기대치가 크다
      matrix.set(stateKey(bases, outs), bases.length * 0.4 + (2 - outs) * 0.3);
    }
  }
  return { season: 2026, league: "central", matrix, samples: new Map(), observedStates: matrix.size, totalPa: 0, walkoff: "include" as const, walkoffHalves: 0 };
}

const RE = new Map<string, RunExpectancy>([["central", fakeRe()]]);
const leagueOf = (): string => "central";

test("이닝별 득점을 타석 로그에서 복원한다", async () => {
  await withDb((db) => {
    game(db, 2, 1);
    events(db, [
      pa(1, "top", { runsScored: 2, rbi: 2 }),
      pa(1, "bottom", { runsScored: 1, rbi: 1 }),
      pa(2, "top"),
      pa(2, "bottom"),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.equal(g.innings.find((i) => i.inning === 1 && i.half === "top")!.runs, 2);
    assert.equal(g.innings.find((i) => i.inning === 1 && i.half === "bottom")!.runs, 1);
    assert.equal(g.innings.find((i) => i.inning === 2 && i.half === "top")!.runs, 0);
    assert.equal(g.reconciles, true);
  });
});

test("⚠공격이 없던 이닝은 「0점」이 아니라 「치지 않았다」다(M11)", async () => {
  await withDb((db) => {
    // 홈이 앞선 채 9회 표가 끝났다 → 9회 말은 아예 없다
    game(db, 0, 1);
    events(db, [pa(1, "bottom", { runsScored: 1, rbi: 1 }), ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => pa(i, "top"))]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    const bot9 = g.innings.find((i) => i.inning === 9 && i.half === "bottom")!;
    assert.equal(bot9.batted, false, "치지 않은 이닝을 쳤다고 했다");
    assert.equal(bot9.runs, 0);
    const bot2 = g.innings.find((i) => i.inning === 2 && i.half === "bottom")!;
    assert.equal(bot2.batted, false);
    // 실제로 친 이닝은 batted가 true여야 한다 — 0점이어도
    assert.equal(g.innings.find((i) => i.inning === 5 && i.half === "top")!.batted, true);
    assert.equal(g.innings.find((i) => i.inning === 5 && i.half === "top")!.runs, 0);
  });
});

test("⚠복원 합계가 공표 득점과 어긋나면 그렇게 말한다 — 조용히 틀린 표를 내지 않는다", async () => {
  await withDb((db) => {
    // 공표는 5-1인데 로그에는 2점밖에 없다
    game(db, 5, 1);
    events(db, [pa(1, "top", { runsScored: 2, rbi: 2 }), pa(1, "bottom", { runsScored: 1, rbi: 1 })]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.equal(g.reconciles, false, "어긋났는데 맞다고 했다");
    // ⚠공표 값은 그대로 낸다 — 우리 복원값으로 덮어쓰지 않는다
    assert.equal(g.awayRuns, 5);
  });
});

test("득점이 난 타석만 고른다 — 전 타석 중계를 옮기지 않는다(L2)", async () => {
  await withDb((db) => {
    game(db, 3, 0);
    events(db, [
      pa(1, "top"),
      pa(1, "top", { runsScored: 1, rbi: 1, outsBefore: 1 }),
      pa(2, "top"),
      pa(2, "top", { runsScored: 2, rbi: 2, outsBefore: 2, bases: "12" }),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.equal(g.scoringPlays.length, 2);
    assert.deepEqual(g.scoringPlays.map((p) => p.runsScored), [1, 2]);
  });
});

test("누적 점수를 타석마다 든다 — 「그때 몇 대 몇이었나」에 답할 수 있어야 한다", async () => {
  await withDb((db) => {
    game(db, 3, 1);
    events(db, [
      pa(1, "top", { runsScored: 1, rbi: 1 }),
      pa(1, "bottom", { runsScored: 1, rbi: 1 }),
      pa(2, "top", { runsScored: 2, rbi: 2 }),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.deepEqual(
      g.scoringPlays.map((p) => `${p.awayScore}-${p.homeScore}`),
      ["1-0", "1-1", "3-1"],
    );
  });
});

test(`경기를 움직인 타석을 절댓값 순으로 ${KEY_PLAY_LIMIT}개까지 낸다`, async () => {
  await withDb((db) => {
    game(db, 4, 0);
    // 만루에서의 4득점이 가장 크게 움직인다
    events(db, [
      pa(1, "top", { bases: "", outsBefore: 0 }),
      pa(1, "top", { bases: "123", outsBefore: 2, runsScored: 4, rbi: 4 }),
      ...[2, 3, 4, 5, 6, 7].map((i) => pa(i, "top")),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.ok(g.keyPlays.length <= KEY_PLAY_LIMIT);
    assert.equal(g.keyPlays[0]!.runsScored, 4, "가장 크게 움직인 타석이 앞에 오지 않았다");
    const abs = g.keyPlays.map((p) => Math.abs(p.swing!));
    assert.deepEqual(abs, [...abs].sort((a, b) => b - a), "절댓값 내림차순이 아니다");
  });
});

test("⚠RE 행렬이 없으면 swing은 null이다 — 0으로 때우면 그 타석이 조용히 「움직이지 않은」 것이 된다", async () => {
  await withDb((db) => {
    game(db, 1, 0);
    events(db, [pa(1, "top", { runsScored: 1, rbi: 1 })]);
    const g = gameDetails(db, 2026, new Map(), leagueOf).get(G)!;
    assert.equal(g.scoringPlays[0]!.swing, null);
    assert.deepEqual(g.keyPlays, [], "값이 없는 타석을 「움직인 타석」에 넣었다");
  });
});

test("⚠반이닝의 마지막 타석은 「이후 상태」가 없다 — 이닝이 끝나면 기대치는 0이다", async () => {
  await withDb((db) => {
    game(db, 0, 0);
    // ⚠**다음 반이닝을 「높은 기대치」로 만든다.** 이렇게 하지 않으면 반이닝 경계를 무시해도
    // 부호가 같아서 시험을 통과한다 — 실제로 그런 구멍이 있었다(2026-08-16 변이 검사).
    // 1회 표 마지막: 1루 2사(=0.4) → 이닝 종료이므로 0 − 0.4 = −0.4
    // 경계를 무시하면 1회 말 첫 타석(만루 0사 = 1.8)을 이후 상태로 잡아 +1.4가 된다
    events(db, [
      pa(1, "top", { bases: "1", outsBefore: 2 }),
      pa(1, "bottom", { bases: "123", outsBefore: 0 }),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    const first = g.keyPlays.find((p) => p.inning === 1 && p.half === "top")!;
    assert.ok(first.swing !== null, "값이 없다");
    assert.ok(first.swing < 0, `이닝 종료를 기대치 0으로 다루지 않았다 (swing=${first.swing})`);
    assert.ok(Math.abs(first.swing + 0.4) < 1e-9, `기대치 0 기준이 아니다 (swing=${first.swing})`);
  });
});

test("⚠그 타석에서 난 득점을 더한다 — 빼면 만루 홈런이 「마이너스」가 된다", async () => {
  await withDb((db) => {
    game(db, 4, 0);
    // 만루 2사(=1.2)에서 4점. 이닝이 끝나므로 0 − 1.2 + 4 = +2.8
    events(db, [pa(1, "top", { bases: "123", outsBefore: 2, runsScored: 4, rbi: 4 }), pa(1, "bottom")]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    const slam = g.scoringPlays[0]!;
    assert.ok(slam.swing !== null);
    assert.ok(Math.abs(slam.swing - 2.8) < 1e-9, `득점이 빠졌다 (swing=${slam.swing})`);
    assert.ok(slam.swing > 0, "만루 홈런이 마이너스가 됐다");
  });
});

test("⚠크게 마이너스인 타석도 「경기를 움직인 타석」이다 — 부호가 아니라 크기로 고른다", async () => {
  await withDb((db) => {
    game(db, 0, 0);
    // 만루 무사(=1.8)에서 이닝이 끝나면 −1.8. **작은 플러스보다 훨씬 크게 움직인 타석**이다
    events(db, [
      pa(1, "top", { bases: "123", outsBefore: 0 }),
      pa(2, "top", { bases: "", outsBefore: 0 }),
      pa(2, "top", { bases: "", outsBefore: 1 }),
      pa(3, "top", { bases: "", outsBefore: 0 }),
    ]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    const worst = g.keyPlays[0]!;
    assert.equal(worst.inning, 1, "가장 크게 움직인 타석이 앞에 오지 않았다");
    assert.ok(worst.swing !== null && worst.swing < 0, "마이너스 타석이 밀려났다");
  });
});

test("연장전도 이닝을 낸다", async () => {
  await withDb((db) => {
    game(db, 1, 0);
    events(db, [...Array.from({ length: 12 }, (_, i) => pa(i + 1, "top")), pa(12, "top", { runsScored: 1, rbi: 1 })]);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.equal(Math.max(...g.innings.map((i) => i.inning)), 12);
  });
});

test("승·패·세이브 투수를 낸다", async () => {
  await withDb((db) => {
    game(db, 0, 1);
    events(db, [pa(1, "bottom", { runsScored: 1, rbi: 1 })]);
    db.raw
      .prepare(
        `INSERT INTO pitching_line (game_id, player_id, side, decision, outs, bf, pitches, h, hr, bb, hbp, so, runs, er, wp, balk)
         VALUES (?, 'P1', 'home', '○', 27, 30, 100, 4, 0, 1, 0, 8, 0, 0, 0, 0)`,
      )
      .run(G);
    const g = gameDetails(db, 2026, RE, leagueOf).get(G)!;
    assert.equal(g.winPitcher, "P1");
    assert.equal(g.losePitcher, null);
  });
});

test("치르지 않은 경기는 아예 나오지 않는다", async () => {
  await withDb((db) => {
    upsertGame(db, {
      gameId: G, season: 2026, gameDate: "2026-08-14", awayCode: "db", homeCode: "s", gameNo: 17,
      status: "notPlayed", notPlayedReason: "雨天中止", competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    assert.equal(gameDetails(db, 2026, RE, leagueOf).size, 0);
  });
});
