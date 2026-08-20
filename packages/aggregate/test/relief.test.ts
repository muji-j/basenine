/**
 * 火消し(継投引き継ぎ) — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠**이 지표의 정의가 곧 값이다.** 「이닝 도중 등판」의 판정이 한 칸이라도 어긋나면
 * 분모가 통째로 달라진다. 그래서 경계를 하나씩 시험으로 못박는다:
 *   · 이닝 **사이**의 교대는 세지 않는다(실측: 교대의 85%가 이쪽이다)
 *   · **주자가 없는** 이닝 도중 등판은 火消し의 분모가 아니다
 *   · 하프이닝·경기 경계를 넘어 「교대」로 읽지 않는다
 *   · 투수를 모르는 행에서 교대를 **추측하지 않는다**(M11)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertPlayer } from "@bb-app/store";
import { averageEnteringRe, dousedRate, foldRelief, midInningEntries } from "../src/relief.ts";
import type { RunExpectancy } from "../src/run-expectancy.ts";
import { stateKey } from "../src/run-expectancy.ts";

const NOW = "2026-08-20T00:00:00.000Z";

type Ev = {
  inning: number;
  half: "top" | "bottom";
  pitcher: string | null;
  bases: string;
  outs: number;
  runs?: number;
};

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-relief-"));
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
  id: string,
  evs: readonly Ev[],
  competition = "regular",
  season = 2026,
): void {
  upsertGame(db, {
    gameId: id, season, gameDate: `${season}-04-01`, awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition,
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertPlayer(db, "B1", "B1", NOW);
  evs.forEach((e, i) => {
    if (e.pitcher !== null) upsertPlayer(db, e.pitcher, e.pitcher, NOW);
    db.raw
      .prepare(
        `INSERT INTO pa_event
         (game_id, seq, inning, half, outs_before, bases, batter_id, pitcher_id,
          outcome, rbi, raw_box, raw_pbp, status, runs_scored, ball_count)
         VALUES (?, ?, ?, ?, ?, ?, 'B1', ?, 'fieldedOut', 0, '', '', 'final', ?, '0-0より')`,
      )
      .run(id, i + 1, e.inning, e.half, e.outs, e.bases, e.pitcher, e.runs ?? 0);
  });
}

/** 시험용 RE 행렬. **값이 아니라 배선을 본다** — 상태마다 다른 수를 넣어 어느 칸을 읽는지 알 수 있게 한다 */
function fakeRe(): RunExpectancy {
  const matrix = new Map<string, number>();
  matrix.set(stateKey("", 0), 0.5);
  matrix.set(stateKey("1", 0), 0.9);
  matrix.set(stateKey("1", 1), 0.55);
  matrix.set(stateKey("12", 1), 0.95);
  matrix.set(stateKey("123", 2), 0.8);
  return { season: 2026, league: "central", matrix, samples: new Map(), observedStates: matrix.size, totalPa: 0 };
}

// ── 등판 추출 ─────────────────────────────────────────────────────────

test("이닝 도중에 투수가 바뀐 첫 타석을 뽑는다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P1", bases: "1", outs: 1 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1 },
      { inning: 7, half: "top", pitcher: "P2", bases: "123", outs: 2 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    assert.equal(scan.entries.length, 1);
    const e = scan.entries[0]!;
    assert.equal(e.pitcherId, "P2");
    assert.equal(e.bases, "12");
    assert.equal(e.outs, 1);
    // ⚠**수비 측이다** — 표(top)에서 던지는 것은 홈 팀이다
    assert.equal(e.teamCode, "t");
    assert.equal(e.offenseCode, "g");
  });
});

test("⚠이닝 **사이**의 교대는 세지 않는다 — 실측으로 교대의 85%가 이쪽이다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      // 하프가 바뀐 뒤 다른 투수 — 이건 「이닝 도중 등판」이 아니다
      { inning: 7, half: "bottom", pitcher: "Q1", bases: "", outs: 0 },
      { inning: 8, half: "top", pitcher: "P2", bases: "", outs: 0 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    assert.deepEqual(scan.entries, [], "하프·이닝 경계를 넘어 「교대」로 읽었다");
  });
});

test("⚠경기 경계를 넘어 교대로 읽지 않는다", async () => {
  await withDb((db) => {
    game(db, "g1", [{ inning: 9, half: "bottom", pitcher: "P1", bases: "1", outs: 1 }]);
    game(db, "g2", [{ inning: 9, half: "bottom", pitcher: "P2", bases: "1", outs: 1 }]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    assert.deepEqual(scan.entries, []);
  });
});

test("⚠투수를 모르는 행에서 교대를 추측하지 않는다(M11) — 몇 행인지는 보고한다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: null, bases: "1", outs: 1 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    assert.deepEqual(scan.entries, [], "투수 미상 행을 사이에 두고 교대를 단정했다");
    assert.equal(scan.unknownPitcher, 1, "투수 미상 행을 조용히 버렸다");
  });
});

test("⚠대회를 섞지 않는다(§2-1)", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "1", outs: 1 },
    ]);
    game(db, "g2", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P3", bases: "1", outs: 1 },
    ], "allStar");
    assert.equal(midInningEntries(db, "regular", "9999-12-31", 2000, 2100).entries.length, 1);
    assert.equal(midInningEntries(db, "allStar", "9999-12-31", 2000, 2100).entries.length, 1);
  });
});

test("시즌 범위로 자른다 — 화면이 보고 있는 시즌까지만 통산한다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "1", outs: 1 },
    ], "regular", 2024);
    game(db, "g2", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "1", outs: 1 },
    ], "regular", 2026);
    assert.equal(midInningEntries(db, "regular", "9999-12-31", 2018, 2024).entries.length, 1);
    assert.equal(midInningEntries(db, "regular", "9999-12-31", 2018, 2026).entries.length, 2);
  });
});

test("그 하프이닝의 남은 득점을 이 타석부터 더한다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0, runs: 1 },
      { inning: 7, half: "top", pitcher: "P2", bases: "1", outs: 1, runs: 2 },
      { inning: 7, half: "top", pitcher: "P2", bases: "", outs: 2, runs: 3 },
      // 다음 하프의 득점은 들어가지 않는다
      { inning: 7, half: "bottom", pitcher: "Q1", bases: "", outs: 0, runs: 9 },
    ]);
    const e = midInningEntries(db, "regular", "9999-12-31", 2000, 2100).entries[0]!;
    assert.equal(e.restRuns, 5, "등판 전의 1점이나 다음 하프의 9점이 섞였다");
  });
});

// ── 접기 ───────────────────────────────────────────────────────────────

test("⚠주자가 없는 이닝 도중 등판은 火消し의 분모가 아니다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      // 주자 없이 이닝 도중 등판 — 「등판」이지만 「불을 안고」는 아니다
      { inning: 7, half: "top", pitcher: "P2", bases: "", outs: 1 },
      { inning: 8, half: "top", pitcher: "P2", bases: "", outs: 0 },
      { inning: 8, half: "top", pitcher: "P3", bases: "1", outs: 1 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    const lines = foldRelief(scan.entries, () => fakeRe());
    const p2 = lines.find((l) => l.pitcherId === "P2")!;
    assert.equal(p2.midInning, 1);
    assert.equal(p2.inherited, 0, "주자 0명인 등판을 분모에 넣었다");
    assert.equal(dousedRate(p2).value, null, "분모 0에서 값을 냈다(M11)");
    const p3 = lines.find((l) => l.pitcherId === "P3")!;
    assert.equal(p3.inherited, 1);
    assert.equal(p3.inheritedRunners, 1);
  });
});

test("火消し 성공은 그 하프이닝이 무득점으로 끝난 것이다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1, runs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 2, runs: 0 },
      { inning: 8, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 8, half: "top", pitcher: "P2", bases: "1", outs: 1, runs: 1 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    const [p2] = foldRelief(scan.entries, () => fakeRe());
    assert.ok(p2 !== undefined);
    assert.equal(p2.inherited, 2);
    assert.equal(p2.doused, 1);
    assert.equal(p2.inheritedRunners, 3, "12(2명) + 1(1명)");
    assert.equal(dousedRate(p2).value, 0.5);
    assert.equal(dousedRate(p2).denominator, 2, "분모를 버리지 않는다(M2)");
  });
});

test("⚠등판 시점 득점기대치는 우리 RE 행렬에서 읽는다 — 여기서 다시 만들지 않는다(M1)", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1 },
      { inning: 8, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 8, half: "top", pitcher: "P2", bases: "123", outs: 2 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    const [p2] = foldRelief(scan.entries, () => fakeRe());
    assert.ok(p2 !== undefined);
    // 0.95 + 0.80
    assert.ok(Math.abs(p2.enteringRe - 1.75) < 1e-9, `기대치 합이 ${p2.enteringRe}`);
    assert.equal(p2.reMissing, 0);
    assert.ok(Math.abs((averageEnteringRe(p2).value ?? 0) - 0.875) < 1e-9);
    assert.equal(averageEnteringRe(p2).denominator, 2);
  });
});

test("⚠RE 를 모르는 상태는 0 으로 때우지 않는다 — 빼고 몇 건인지 보고한다(M11)", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1 },
      { inning: 8, half: "top", pitcher: "P1", bases: "", outs: 0 },
      // 이 상태는 fakeRe 에 없다
      { inning: 8, half: "top", pitcher: "P2", bases: "23", outs: 0 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    const [p2] = foldRelief(scan.entries, () => fakeRe());
    assert.ok(p2 !== undefined);
    assert.equal(p2.inherited, 2, "등판 자체는 2번이다");
    assert.equal(p2.reMissing, 1);
    assert.ok(Math.abs(p2.enteringRe - 0.95) < 1e-9);
    assert.equal(averageEnteringRe(p2).denominator, 1, "모르는 등판은 평균의 분모에서 뺀다");
  });
});

test("⚠RE 행렬이 아예 없으면 기대치를 세지 않는다 — 전 등판이 reMissing 이다", async () => {
  await withDb((db) => {
    game(db, "g1", [
      { inning: 7, half: "top", pitcher: "P1", bases: "", outs: 0 },
      { inning: 7, half: "top", pitcher: "P2", bases: "12", outs: 1 },
    ]);
    const scan = midInningEntries(db, "regular", "9999-12-31", 2000, 2100);
    const [p2] = foldRelief(scan.entries, () => undefined);
    assert.ok(p2 !== undefined);
    assert.equal(p2.inherited, 1);
    assert.equal(p2.reMissing, 1);
    assert.equal(p2.enteringRe, 0);
    assert.equal(averageEnteringRe(p2).value, null);
  });
});
