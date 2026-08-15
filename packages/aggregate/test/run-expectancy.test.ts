import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { ALL_STATES, buildRunExpectancy, paValue, stateKey } from "../src/run-expectancy.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    batterId: "B1", pitcherId: "P1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-re-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "B1", "타자", NOW);
    upsertPlayer(db, "P1", "투수", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function seedGame(db: Db, id: string, home = "g", away = "t"): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
  });
}

test("이론상 상태는 24개다", () => {
  assert.equal(ALL_STATES.length, 24);
  assert.equal(new Set(ALL_STATES).size, 24);
});

test("상태 키 — 주자 없음은 하이픈", () => {
  assert.equal(stateKey("", 0), "-|0");
  assert.equal(stateKey("123", 2), "123|2");
});

test("이닝 뒤에서부터 누적해 잔여 득점을 만든다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    // 한 이닝: 무사주자없음(0점) → 1루 무사(1점) → 2루 1아웃(0점)
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, outsBefore: 0, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 2, outsBefore: 0, bases: "1", runsScored: 1 }),
      ev({ gameId: "g1", seq: 3, outsBefore: 1, bases: "2", runsScored: 0 }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["g", "t"]);
    // 무사주자없음 이후 남은 득점 = 1
    assert.equal(re.matrix.get(stateKey("", 0)), 1);
    // 1루 무사 이후 = 1
    assert.equal(re.matrix.get(stateKey("1", 0)), 1);
    // 2루 1아웃 이후 = 0
    assert.equal(re.matrix.get(stateKey("2", 1)), 0);
    assert.equal(re.totalPa, 3);
  });
});

test("⚠표본 수를 함께 낸다 (M2)", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, outsBefore: 0, bases: "" }),
      ev({ gameId: "g1", seq: 2, outsBefore: 1, bases: "" }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["g", "t"]);
    assert.equal(re.samples.get(stateKey("", 0)), 1);
    assert.equal(re.samples.get(stateKey("", 1)), 1);
    assert.equal(re.observedStates, 2, "관측된 상태만 센다");
  });
});

test("⚠리그를 섞지 않는다 — 공격 팀 기준으로 나눈다", async () => {
  await withDb((db) => {
    seedGame(db, "c1", "g", "t"); // 센트럴 대 센트럴
    seedGame(db, "p1", "h", "l"); // 퍼시픽 대 퍼시픽
    replacePaEvents(db, "c1", [ev({ gameId: "c1", seq: 1, runsScored: 2 })]);
    replacePaEvents(db, "p1", [ev({ gameId: "p1", seq: 1, runsScored: 0 })]);

    const central = buildRunExpectancy(db, 2026, "central", ["g", "t"]);
    const pacific = buildRunExpectancy(db, 2026, "pacific", ["h", "l"]);
    assert.equal(central.totalPa, 1);
    assert.equal(pacific.totalPa, 1);
    assert.equal(central.matrix.get(stateKey("", 0)), 2);
    assert.equal(pacific.matrix.get(stateKey("", 0)), 0);
  });
});

test("올스타전은 RE에 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "g", "t");
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-20", awayCode: "pl", homeCode: "cl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/as", fetchedAt: NOW,
    });
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1 })]);
    replacePaEvents(db, "as1", [ev({ gameId: "as1", seq: 1 })]);
    assert.equal(buildRunExpectancy(db, 2026, "central", ["g", "t"]).totalPa, 1);
  });
});

// ---- 타석 가치 -----------------------------------------------------------

const RE = {
  season: 2026,
  league: "central",
  matrix: new Map([
    [stateKey("", 0), 0.4],
    [stateKey("1", 0), 0.8],
    [stateKey("", 1), 0.2],
  ]),
  samples: new Map<string, number>(),
  observedStates: 3,
  totalPa: 0,
};

test("타석 가치 = 이후 기대치 − 이전 기대치 + 이 타석 득점", () => {
  // 무사주자없음(0.4) → 1루 무사(0.8), 득점 0 → +0.4
  const v = paValue(RE, { bases: "", outs: 0 }, { bases: "1", outs: 0 }, 0);
  assert.ok(v !== null);
  assert.ok(Math.abs(v - 0.4) < 1e-9);
});

test("아웃은 마이너스다", () => {
  const v = paValue(RE, { bases: "", outs: 0 }, { bases: "", outs: 1 }, 0);
  assert.ok(v !== null && v < 0);
  assert.ok(Math.abs(v - -0.2) < 1e-9);
});

test("이닝이 끝나면 이후 기대치는 0이다", () => {
  const v = paValue(RE, { bases: "1", outs: 0 }, null, 1);
  assert.ok(v !== null);
  assert.ok(Math.abs(v - (0 - 0.8 + 1)) < 1e-9);
});

test("⚠RE에 없는 상태는 0으로 때우지 않고 null을 낸다", () => {
  // 임의로 0을 넣으면 그 타석이 조용히 큰 마이너스가 된다.
  assert.equal(paValue(RE, { bases: "123", outs: 2 }, null, 0), null);
  assert.equal(paValue(RE, { bases: "", outs: 0 }, { bases: "123", outs: 1 }, 0), null);
});
