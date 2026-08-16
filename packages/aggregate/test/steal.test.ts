/**
 * 도루 성적 — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠렌더 계층 시험만으로는 이 값이 틀려도 전부 초록이 된다(`bunt.test.ts` 머리말 참조).
 * 여기서 지키는 것은 세 가지다: **대회를 섞지 않는가**(§2-1) · **견제사를 기도에 넣지
 * 않는가** · **기도 0을 `.000`으로 만들지 않는가**(M11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replaceRunnerEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { RunnerEventRow } from "@bb-app/store";
import { attempts, steals, successRate } from "../src/steal.ts";

const NOW = "2026-08-17T00:00:00.000Z";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-steal-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

type Ev = { runner: string; kind: RunnerEventRow["kind"]; base?: RunnerEventRow["base"]; half?: "top" | "bottom" };

function game(
  db: ReturnType<typeof openDb>,
  id: string,
  competition: string,
  evs: readonly Ev[],
): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition,
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  const rows: RunnerEventRow[] = evs.map((e, i) => {
    upsertPlayer(db, e.runner, e.runner, NOW);
    return {
      gameId: id, seq: i + 1, inning: 1, half: e.half ?? "bottom", afterSeq: i,
      outsBefore: 0, bases: "1", runnerId: e.runner, kind: e.kind,
      base: e.base ?? "2b", doubleSteal: false, raw: "二塁盗塁成功",
    };
  });
  replaceRunnerEvents(db, id, rows);
}

test("도루와 도루자를 선수별로 센다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal" },
      { runner: "R1", kind: "steal" },
      { runner: "R1", kind: "caughtStealing" },
      { runner: "R2", kind: "steal" },
    ]);
    const s = steals(db, 2026, "regular", "9999-12-31");
    const r1 = s.find((x) => x.playerId === "R1")!;
    assert.equal(r1.sb, 2);
    assert.equal(r1.cs, 1);
    assert.equal(attempts(r1), 3);
    assert.equal(s.length, 2);
  });
});

/**
 * ⚠**견제사는 도루자가 아니다.** NPB 기록에서 牽制アウト 는 盗塁刺 에 들어가지 않는다.
 * 넣으면 기도가 부풀어 **전 선수의 성공률이 실제보다 낮게** 나온다.
 * 실측 2026 정규시즌: 도루자 254 = 공표 `盗塁刺` 254. 견제사 45건은 그 밖이다.
 */
test("⚠견제사를 도루 기도에 넣지 않는다 — 넣으면 성공률이 전부 낮아진다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal" },
      { runner: "R1", kind: "pickoff", base: "1b" },
    ]);
    const r = steals(db, 2026, "regular", "9999-12-31")[0]!;
    assert.equal(r.pickoff, 1, "견제사를 세지 않았다");
    assert.equal(attempts(r), 1, "견제사가 기도에 들어갔다");
    assert.equal(successRate(r), 1, "견제사 때문에 성공률이 내려갔다");
  });
});

/**
 * ⚠**대회를 섞지 않는다**(§2-1). 실측으로 이 경계가 값을 갈랐다 —
 * 올스타를 넣으면 2026 도루가 611이 아니라 **620**이 되어 공표값과 9 어긋난다.
 */
test("⚠올스타를 정규시즌에 섞지 않는다 — 실측으로 9건 어긋났다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ runner: "R1", kind: "steal" }]);
    game(db, "g2", "allStar", [{ runner: "R1", kind: "steal" }, { runner: "R1", kind: "steal" }]);
    assert.equal(steals(db, 2026, "regular", "9999-12-31")[0]!.sb, 1, "올스타가 정규시즌에 섞였다");
    assert.equal(steals(db, 2026, "allStar", "9999-12-31")[0]!.sb, 2);
  });
});

/**
 * ⚠**기도 0을 `.000`으로 만들지 않는다**(M11).
 * 「한 번도 안 뛴 선수」와 「뛰었지만 다 실패한 선수」는 다른 사실이다.
 */
test("⚠기도가 0이면 성공률은 null이다 — .000이 아니다", () => {
  assert.equal(successRate({ sb: 0, cs: 0 }), null, "0/0을 값으로 만들었다");
  assert.equal(successRate({ sb: 0, cs: 3 }), 0, "3번 실패한 것을 「없음」으로 만들었다");
  assert.equal(successRate({ sb: 3, cs: 1 }), 0.75);
});

/** 주자의 소속은 **공격 측**이다 — 표(top)면 원정, 리(bottom)면 홈 */
test("주자의 소속을 공격 측으로 잡는다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal", half: "top" },
      { runner: "R2", kind: "steal", half: "bottom" },
    ]);
    const s = steals(db, 2026, "regular", "9999-12-31");
    assert.equal(s.find((x) => x.playerId === "R1")!.teamCode, "g", "표의 주자를 홈 소속으로 잡았다");
    assert.equal(s.find((x) => x.playerId === "R2")!.teamCode, "t", "리의 주자를 원정 소속으로 잡았다");
  });
});

/** ⚠미성립 경기의 기록은 무효다 — 2024/0710 c-g-14 는 우천 노게임인데 도루 1건이 인쇄돼 있다 */
test("⚠미성립 경기의 도루를 세지 않는다 — 노게임 기록은 무효다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ runner: "R1", kind: "steal" }]);
    db.raw.prepare("UPDATE game SET status = 'notPlayed' WHERE game_id = 'g1'").run();
    assert.deepEqual(steals(db, 2026, "regular", "9999-12-31"), [], "무효 경기의 도루를 셌다");
  });
});
