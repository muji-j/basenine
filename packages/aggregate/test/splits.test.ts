import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { battingSplits, matchups } from "../src/splits.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function seedGame(db: Db, id: string, date: string, away = "t", home = "g"): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: `https://npb.jp/${id}`, fetchedAt: NOW,
  });
}

function seedPlayer(db: Db, id: string, name: string, throws: string | null = null): void {
  upsertPlayer(db, id, name, NOW);
  if (throws !== null) {
    db.raw.prepare("UPDATE player SET throws = ?, bats = 'right' WHERE player_id = ?").run(throws, id);
  }
}

function event(o: Partial<PaEventRow> & { gameId: string; seq: number; batterId: string }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    pitcherId: "P1", outcome: "single", rbi: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-splits-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("좌우 스플릿 — 상대 투수의 던지는 손으로 나눈다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "PL", "좌완", "left");
    seedPlayer(db, "PR", "우완", "right");
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1", pitcherId: "PL", outcome: "single" }),
      event({ gameId: "g1", seq: 2, batterId: "B1", pitcherId: "PL", outcome: "strikeout" }),
      event({ gameId: "g1", seq: 3, batterId: "B1", pitcherId: "PR", outcome: "homerun", rbi: 2 }),
    ]);

    const [p] = battingSplits(db, "opponentHand", 2026);
    assert.ok(p);
    const left = p.splits.find((s) => s.key === "left");
    const right = p.splits.find((s) => s.key === "right");
    assert.equal(left?.line.pa, 2);
    assert.equal(left?.line.h, 1);
    assert.equal(right?.line.pa, 1);
    assert.equal(right?.line.hr, 1);
    assert.equal(right?.rbi, 2);
  });
});

test("⚠투타 미상 상대는 좌우 스플릿에서 빠지되 **숨기지 않고 센다**", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "PL", "좌완", "left");
    seedPlayer(db, "PX", "미상"); // throws 미상
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1", pitcherId: "PL" }),
      event({ gameId: "g1", seq: 2, batterId: "B1", pitcherId: "PX" }),
      event({ gameId: "g1", seq: 3, batterId: "B1", pitcherId: "PX" }),
    ]);

    const [p] = battingSplits(db, "opponentHand", 2026);
    assert.ok(p);
    assert.equal(p.splits.find((s) => s.key === "left")?.line.pa, 1);
    assert.equal(p.unclassified, 2, "미상 타석 수를 보고해야 한다");
    assert.equal(p.splits.length, 1, "미상을 임의의 분류에 넣지 않는다");
  });
});

test("홈/원정 스플릿 — 표에서 치는 쪽이 원정이다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "P1", "투수", "right");
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1", half: "top" }),
      event({ gameId: "g1", seq: 2, batterId: "B1", half: "bottom" }),
      event({ gameId: "g1", seq: 3, batterId: "B1", half: "bottom" }),
    ]);
    const [p] = battingSplits(db, "homeAway", 2026);
    assert.equal(p?.splits.find((s) => s.key === "away")?.line.pa, 1);
    assert.equal(p?.splits.find((s) => s.key === "home")?.line.pa, 2);
  });
});

test("주자상황 스플릿 — 득점권은 2루 또는 3루에 주자가 있는 상태", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "P1", "투수", "right");
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1", bases: "" }),
      event({ gameId: "g1", seq: 2, batterId: "B1", bases: "1" }),
      event({ gameId: "g1", seq: 3, batterId: "B1", bases: "2" }),
      event({ gameId: "g1", seq: 4, batterId: "B1", bases: "13" }),
      event({ gameId: "g1", seq: 5, batterId: "B1", bases: "123" }),
    ]);
    const [p] = battingSplits(db, "baseState", 2026);
    assert.equal(p?.splits.find((s) => s.key === "empty")?.line.pa, 1);
    assert.equal(p?.splits.find((s) => s.key === "onBase")?.line.pa, 1, "1루만은 득점권이 아니다");
    assert.equal(p?.splits.find((s) => s.key === "scoring")?.line.pa, 3);
  });
});

test("월별 스플릿", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-30");
    seedGame(db, "g2", "2026-05-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "P1", "투수", "right");
    replacePaEvents(db, "g1", [event({ gameId: "g1", seq: 1, batterId: "B1" })]);
    replacePaEvents(db, "g2", [
      event({ gameId: "g2", seq: 1, batterId: "B1" }),
      event({ gameId: "g2", seq: 2, batterId: "B1" }),
    ]);
    const [p] = battingSplits(db, "month", 2026);
    assert.equal(p?.splits.find((s) => s.key === "2026-04")?.line.pa, 1);
    assert.equal(p?.splits.find((s) => s.key === "2026-05")?.line.pa, 2);
  });
});

test("⚠모든 스플릿이 분모(타석 수)를 나른다 (M2)", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "P1", "투수", "left");
    replacePaEvents(db, "g1", [event({ gameId: "g1", seq: 1, batterId: "B1", pitcherId: "P1" })]);
    for (const d of ["opponentHand", "homeAway", "baseState", "month"] as const) {
      for (const s of battingSplits(db, d, 2026)[0]?.splits ?? []) {
        assert.ok(s.line.pa > 0, `${d}의 스플릿에 타석 수가 없다`);
      }
    }
  });
});

test("상대전적 — 투수×타자로 묶는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "B2", "타자2");
    seedPlayer(db, "P1", "투수", "right");
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1", outcome: "single" }),
      event({ gameId: "g1", seq: 2, batterId: "B1", outcome: "strikeout" }),
      event({ gameId: "g1", seq: 3, batterId: "B2", outcome: "homerun", rbi: 1 }),
    ]);
    const all = matchups(db, 2026);
    assert.equal(all.length, 2);
    const m = all.find((x) => x.batterId === "B1");
    assert.equal(m?.line.pa, 2);
    assert.equal(m?.line.h, 1);
    assert.equal(m?.line.so, 1);
  });
});

test("⚠상대전적은 표본이 작다 — 최소 타석으로 거를 수 있다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "B2", "타자2");
    seedPlayer(db, "P1", "투수", "right");
    replacePaEvents(db, "g1", [
      event({ gameId: "g1", seq: 1, batterId: "B1" }),
      event({ gameId: "g1", seq: 2, batterId: "B1" }),
      event({ gameId: "g1", seq: 3, batterId: "B2" }),
    ]);
    assert.equal(matchups(db, 2026, 2).length, 1, "1타석 매치업은 걸러진다");
    assert.equal(matchups(db, 2026, 1).length, 2, "거르지 않으면 둘 다 남는다");
  });
});

test("올스타전은 스플릿에도 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", "2026-04-01");
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-20", awayCode: "pl", homeCode: "cl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/as1", fetchedAt: NOW,
    });
    seedPlayer(db, "B1", "타자");
    seedPlayer(db, "P1", "투수", "left");
    replacePaEvents(db, "g1", [event({ gameId: "g1", seq: 1, batterId: "B1", pitcherId: "P1" })]);
    replacePaEvents(db, "as1", [event({ gameId: "as1", seq: 1, batterId: "B1", pitcherId: "P1" })]);

    const [p] = battingSplits(db, "opponentHand", 2026);
    assert.equal(p?.splits.find((s) => s.key === "left")?.line.pa, 1);
  });
});
