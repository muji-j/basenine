/**
 * **상대 구단별 스플릿** — 타자와 투수에서 「상대」의 뜻이 반대다.
 *
 * ⚠**이것이 이 축의 급소다.** 타자에게 상대는 **수비하는 쪽**, 투수에게 상대는 **치는 쪽**이다.
 * 한쪽 식을 보고 다른 쪽에 베끼면 **조용히 반대 팀이 나온다** — 값은 그럴듯하고
 * 합계도 맞아서 **눈으로는 절대 못 잡는다.**
 *
 * ## ⚠범위가 둘인 이유는 표본이다
 *
 * 실측(2025 · 선수-상대 **3,831조합**): 그 시즌 타석 **중앙 11 · 1사분위 4** 이고
 * **교류전은 최대 17타석**이다 — 한 시즌만으로는 비율이 성립하지 않는 칸이 대부분이다.
 * 통산(보유 9시즌)이면 같은 리그 **중앙 30 · 최대 855**, 교류전 **중앙 9** 로 올라온다.
 *
 * ⚠**그래서 축을 둘로 둔다**(`opponent` = 그 시즌 · `opponentCareer` = 통산).
 * 축은 이미 탭이므로 **새 UI 없이** 구분해서 볼 수 있다.
 * ⚠**통산의 끝은 언제나 「보고 있는 시즌」이다** — `matchups` 와 같은 규칙이라
 * 2022년 화면이 2026년 성적을 말하지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { battingSplits, pitchingSplits } from "../src/splits.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    batterId: "BAT", pitcherId: "PIT", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-opp-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "BAT", "타자", NOW);
    upsertPlayer(db, "PIT", "투수", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** away=t(한신) · home=g(요미우리) */
function seedGame(db: Db, id: string, season: number, date: string): void {
  upsertGame(db, {
    gameId: id, season, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, homeRuns: 1, awayRuns: 2,
  });
}

function keysOf(list: readonly { playerId: string; splits: { key: string }[] }[], id: string): string[] {
  return (list.find((p) => p.playerId === id)?.splits ?? []).map((s) => s.key).sort();
}

/**
 * ⚠**표(top)에서 치는 것은 원정**이다. 그러니 그때 타자의 상대는 **홈**이다.
 * 이 한 줄이 뒤집히면 화면의 모든 구단별 성적이 반대 팀에 붙는다.
 */
test("⚠타자의 상대는 수비하는 쪽이다 — 표 공격이면 홈 구단", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2026, "2026-04-01");
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, half: "top" })]);
    assert.deepEqual(keysOf(battingSplits(db, "opponentTeam", 2026), "BAT"), ["g"]);
  });
});

test("⚠말 공격이면 타자의 상대는 원정 구단", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2026, "2026-04-01");
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, half: "bottom" })]);
    assert.deepEqual(keysOf(battingSplits(db, "opponentTeam", 2026), "BAT"), ["t"]);
  });
});

/**
 * ⚠**투수는 좌우가 뒤집힌다.** 표 공격일 때 투수는 홈 쪽이고, 그 투수의 상대는 **치는 원정**이다.
 * 같은 경기·같은 타석에서 **타자의 상대와 투수의 상대가 서로 다른 팀**이라는 것이 요점이다.
 */
test("⚠투수의 상대는 치는 쪽이다 — 같은 타석에서 타자와 반대가 나온다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2026, "2026-04-01");
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, half: "top" })]);
    const bat = keysOf(battingSplits(db, "opponentTeam", 2026), "BAT");
    const pit = keysOf(pitchingSplits(db, "opponentTeam", 2026), "PIT");
    assert.deepEqual(bat, ["g"], "타자의 상대가 홈이 아니다");
    assert.deepEqual(pit, ["t"], "투수의 상대가 원정이 아니다");
    assert.notDeepEqual(bat, pit, "타자와 투수의 상대가 같게 나왔다 — 한쪽 식을 베낀 것이다");
  });
});

/** ⚠**기본은 그 시즌만**이다 — 이 기본이 바뀌면 다른 축이 전부 통산이 된다 */
test("⚠기본 범위는 그 시즌만이다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2025, "2025-04-01");
    seedGame(db, "g2", 2026, "2026-04-01");
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, half: "top" })]);
    replacePaEvents(db, "g2", [ev({ gameId: "g2", seq: 1, half: "top" })]);
    const rows = battingSplits(db, "opponentTeam", 2026).find((p) => p.playerId === "BAT");
    assert.equal(rows?.splits.find((s) => s.key === "g")?.line.pa, 1, "그 시즌 밖 타석이 섞였다");
  });
});

/** ⚠**통산은 보유 첫 시즌부터 「보고 있는 시즌까지」**다 — `matchups` 와 같은 규칙 */
test("⚠통산 범위는 보고 있는 시즌까지다 — 과거 화면이 미래를 말하지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2024, "2024-04-01");
    seedGame(db, "g2", 2025, "2025-04-01");
    seedGame(db, "g3", 2026, "2026-04-01");
    for (const id of ["g1", "g2", "g3"]) {
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, half: "top" })]);
    }
    const upto2025 = battingSplits(db, "opponentTeam", 2025, "regular", "9999-12-31", 2024)
      .find((p) => p.playerId === "BAT");
    assert.equal(upto2025?.splits.find((s) => s.key === "g")?.line.pa, 2, "2025 화면이 2026 을 셌거나 2024 를 놓쳤다");

    const upto2026 = battingSplits(db, "opponentTeam", 2026, "regular", "9999-12-31", 2024)
      .find((p) => p.playerId === "BAT");
    assert.equal(upto2026?.splits.find((s) => s.key === "g")?.line.pa, 3, "보유 전 시즌을 못 셌다");
  });
});

/** ⚠**대회는 통산이라고 섞지 않는다**(§2-1) */
test("⚠통산이어도 대회는 섞지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 2025, "2025-04-01");
    upsertGame(db, {
      gameId: "cs1", season: 2025, gameDate: "2025-10-10", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "climaxSeries",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW, homeRuns: 1, awayRuns: 2,
    });
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, half: "top" })]);
    replacePaEvents(db, "cs1", [ev({ gameId: "cs1", seq: 1, half: "top" })]);
    const regular = battingSplits(db, "opponentTeam", 2025, "regular", "9999-12-31", 2018)
      .find((p) => p.playerId === "BAT");
    assert.equal(regular?.splits.find((s) => s.key === "g")?.line.pa, 1, "포스트시즌이 정규시즌 통산에 섞였다");
  });
});
