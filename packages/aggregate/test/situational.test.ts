import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { buildRunExpectancy, stateKey } from "../src/run-expectancy.ts";
import type { RunExpectancy } from "../src/run-expectancy.ts";
import { computeSrc, computeSrp } from "../src/situational.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number; batterId: string }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    pitcherId: "P1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-src-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "P1", "투수", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function seedGame(db: Db, id: string): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
  });
}

const FIXED_RE: RunExpectancy = {
  season: 2026,
  league: "central",
  matrix: new Map([
    [stateKey("", 0), 0.4],
    [stateKey("1", 0), 0.8],
    [stateKey("", 1), 0.2],
    [stateKey("1", 1), 0.5],
  ]),
  samples: new Map(),
  observedStates: 4,
  totalPa: 0,
};

test("SRC는 타석마다의 득점기대치 변화를 합산한다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 무사주자없음(0.4) → 1루 무사(0.8): +0.4
    // 1루 무사(0.8) → 1루 1아웃(0.5): −0.3
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "" }),
      ev({ gameId: "g1", seq: 2, batterId: "B1", outsBefore: 0, bases: "1" }),
      ev({ gameId: "g1", seq: 3, batterId: "B1", outsBefore: 1, bases: "1" }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    // 마지막 타석은 이닝 종료로 0 − 0.5 + 0 = −0.5
    assert.ok(Math.abs(e.src - (0.4 - 0.3 - 0.5)) < 1e-9);
    assert.equal(e.pa, 3);
    assert.equal(e.skipped, 0);
  });
});

test("득점은 그대로 더해진다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 2점 나고 이닝 종료: 0 − 0.8 + 2 = +1.2
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e && Math.abs(e.src - 1.2) < 1e-9);
  });
});

test("⚠RE에 없는 상태는 0으로 때우지 않고 미계산으로 센다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 2, bases: "123" }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.pa, 0);
    assert.equal(e.skipped, 1, "미계산을 숨기면 그 타석이 조용히 사라진다");
    assert.equal(e.src, 0);
    assert.equal(e.srcPer600, null, "분모가 0이면 환산값도 없다");
  });
});

test("600타석 환산은 표본이 다른 선수를 나란히 보기 위한 것", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e && e.srcPer600 !== null);
    assert.ok(Math.abs(e.srcPer600 - 1.2 * 600) < 1e-6);
  });
});

test("⚠리그 전체의 SRC 합은 0에 가까워야 한다 — 평균 대비 지표이므로", async () => {
  await withDb((db) => {
    // 실제 RE를 데이터에서 만들고 같은 데이터로 SRC를 계산하면 합이 0이 되어야 한다.
    seedGame(db, "g1");
    for (const id of ["B1", "B2", "B3"]) upsertPlayer(db, id, id, NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 2, batterId: "B2", outsBefore: 0, bases: "1", runsScored: 1 }),
      ev({ gameId: "g1", seq: 3, batterId: "B3", outsBefore: 1, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 4, batterId: "B1", inning: 2, outsBefore: 0, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 5, batterId: "B2", inning: 2, outsBefore: 1, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 6, batterId: "B3", inning: 2, outsBefore: 2, bases: "", runsScored: 0 }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["t", "g"]);
    const total = computeSrc(db, re, ["t", "g"]).reduce((n, e) => n + e.src, 0);
    assert.ok(Math.abs(total) < 1e-9, `합이 0이어야 하는데 ${total}`);
  });
});

test("올스타전은 SRC에 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-20", awayCode: "pl", homeCode: "cl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/as", fetchedAt: NOW,
    });
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", bases: "1", runsScored: 2 })]);
    replacePaEvents(db, "as1", [ev({ gameId: "as1", seq: 1, batterId: "B1", bases: "1", runsScored: 2 })]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.equal(e?.pa, 1);
  });
});

// ── SRP (투수판) ──────────────────────────────────────────────────────────

test("⚠SRP는 같은 타석에서 SRC의 정확한 반대다 — 타자가 얻은 것이 투수가 내준 것이다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "" }),
      ev({ gameId: "g1", seq: 2, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 1 }),
      ev({ gameId: "g1", seq: 3, batterId: "B1", outsBefore: 1, bases: "1" }),
    ]);
    const [bat] = computeSrc(db, FIXED_RE, ["t", "g"]);
    const [pit] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(bat && pit);
    assert.ok(
      Math.abs(bat.src + pit.srp) < 1e-9,
      `부호만 반대여야 한다: SRC ${bat.src} · SRP ${pit.srp}`,
    );
    assert.equal(pit.bf, bat.pa, "같은 타석 수를 세야 한다");
    assert.equal(pit.playerId, "P1");
  });
});

test("실점을 막으면 SRP가 양수다 — 부호 방향을 고정한다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 아무도 안 들어오고 이닝 종료 → 0.8을 막았다
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
    const [good] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(good && Math.abs(good.srp - 0.8) < 1e-9, `막았으면 양수여야 한다: ${good?.srp}`);
  });
});

test("실점하면 SRP가 음수가 된다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 2점 주고 이닝 종료 → −(0 − 0.8 + 2) = −1.2
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [bad] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(bad && Math.abs(bad.srp + 1.2) < 1e-9, `내줬으면 음수여야 한다: ${bad?.srp}`);
  });
});

test("⚠RE에 없는 상태는 SRP에서도 0으로 때우지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 만루는 FIXED_RE에 없다
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "123" })]);
    const [e] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.srp, 0);
    assert.equal(e.bf, 0, "계산 못 한 타석을 분모에 넣으면 안 된다");
    assert.equal(e.skipped, 1);
  });
});

test("9이닝 환산은 아웃이 없으면 null이다 — 0으로 나누지 않는다(M11)", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
    // 투수표를 적재하지 않았으므로 아웃은 0이다
    const [e] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.outs, 0);
    assert.equal(e.srpPer9, null);
  });
});
