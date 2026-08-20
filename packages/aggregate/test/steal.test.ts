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

type Ev = {
  runner: string;
  kind: RunnerEventRow["kind"];
  base?: RunnerEventRow["base"];
  half?: "top" | "bottom";
  doubleSteal?: boolean;
};

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
      base: e.base ?? "2b", doubleSteal: e.doubleSteal ?? false, raw: "二塁盗塁成功",
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

// ─── 루별 내역 ───────────────────────────────────────────────────────────
//
// ⚠**`runner_event.base` 와 `double_steal` 은 저장만 되고 읽는 코드가 0곳이었다**(2026-08-20).
// 여기서 지키는 것은 두 가지다: **뜻이 다른 열을 섞지 않는가**(도루=노린 루 · 견제사=있던 루) ·
// **루별 합이 전체와 맞는가**.

/**
 * ⚠**본루만 성공보다 도루자가 많다.** **2018〜2025**(완결 시즌) 정규시즌 실측(2026-08-20):
 * 도루 2루 6,877 / 3루 267 / 본루 **44**, 도루자 2루 2,998 / 3루 117 / 본루 **142**.
 * ⚠**진행 중 시즌을 넣어 적지 마라** — 경기가 하나 들어올 때마다 이 주석이 낡는다.
 * 뭉쳐서 성공률 하나로 내면 이 사실이 사라진다 — 그것이 루로 나누는 이유다.
 */
test("⚠도루·도루자를 **노린 루**별로 센다 — 뭉치면 본루의 성공률이 전체에 묻힌다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal", base: "2b" },
      { runner: "R1", kind: "steal", base: "2b" },
      { runner: "R1", kind: "steal", base: "3b" },
      { runner: "R1", kind: "caughtStealing", base: "home" },
      { runner: "R1", kind: "caughtStealing", base: "3b" },
    ]);
    const r = steals(db, 2026, "regular", "9999-12-31")[0]!;
    assert.deepEqual(r.sbByBase, { "1b": 0, "2b": 2, "3b": 1, home: 0 });
    assert.deepEqual(r.csByBase, { "1b": 0, "2b": 0, "3b": 1, home: 1 });
    // 루별 합이 전체와 맞는다 — 어긋나면 화면의 「그 밖」이 조용히 사라진다
    assert.equal(r.sb, 3);
    assert.equal(r.cs, 2);
    assert.equal(successRate({ sb: r.sbByBase["3b"], cs: r.csByBase["3b"] }), 0.5, "3루 기도 2 중 1 성공이다");
    assert.equal(attempts({ sb: r.sbByBase.home, cs: r.csByBase.home }), 1, "본루는 기도 1(전부 실패)이다");
  });
});

/**
 * ⚠**견제사의 `base` 는 「있던 루」다** — 도루의 「노린 루」와 뜻이 다르다(마이그레이션 010).
 * 같은 열에 넣으면 1루 견제사가 「1루를 훔치려다 잡혔다」로 읽힌다(그런 일은 없다).
 */
test("⚠견제사의 루는 「있던 루」라 도루와 다른 표다 — 섞으면 뜻이 뒤집힌다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal", base: "2b" },
      { runner: "R1", kind: "pickoff", base: "1b" },
      { runner: "R1", kind: "pickoff", base: "2b" },
    ]);
    const r = steals(db, 2026, "regular", "9999-12-31")[0]!;
    assert.deepEqual(r.pickoffByBase, { "1b": 1, "2b": 1, "3b": 0, home: 0 });
    // 견제사는 도루 표에 들어가지 않는다(기도의 분모 밖 · NPB 기록)
    assert.deepEqual(r.sbByBase, { "1b": 0, "2b": 1, "3b": 0, home: 0 });
    assert.deepEqual(r.csByBase, { "1b": 0, "2b": 0, "3b": 0, home: 0 });
    assert.equal(attempts(r), 1, "견제사가 기도에 들어갔다");
  });
});

/**
 * ⚠**「더블스틸 횟수」가 아니라 「그 선수가 관여한 도루 수」다.**
 * 한 번의 더블스틸이 주자 2명분으로 2행 남는다.
 * 실측(2026-08-20): 본루 도루 47건 중 **40건**이 더블스틸의 일부였다.
 */
test("더블스틸을 센다 — 그 선수가 관여한 도루 수다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { runner: "R1", kind: "steal", base: "home", doubleSteal: true },
      { runner: "R2", kind: "steal", base: "3b", doubleSteal: true },
      { runner: "R1", kind: "steal", base: "2b" },
    ]);
    const s = steals(db, 2026, "regular", "9999-12-31");
    assert.equal(s.find((x) => x.playerId === "R1")!.doubleSteal, 1);
    assert.equal(s.find((x) => x.playerId === "R2")!.doubleSteal, 1);
    assert.equal(s.find((x) => x.playerId === "R1")!.sb, 2, "더블스틸도 도루다 — 따로 세지만 빼지 않는다");
  });
});

/** ⚠**모르는 루가 오면 멈춘다**(M7) — 조용히 흘리면 루별 합이 전체와 어긋난다 */
test("⚠모르는 루에 멈춘다 — 조용히 흘리면 루별 합이 전체와 어긋난다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ runner: "R1", kind: "steal", base: "2b" }]);
    /**
     * DB 의 CHECK 를 잠시 끄고 「소스가 새 표기를 냈다」를 흉내 낸다.
     * ⚠**CHECK 가 있으니 이 가드는 죽은 코드라고 말하지 마라** — 마이그레이션이 어휘를 넓히는
     * 날(예: 견제사의 `home`)에 CHECK 는 통과하고 이 함수만 남는다. 그때 조용히 흘리면
     * 루별 합이 전체와 어긋난 채 화면이 「그 루는 0」이라고 말한다.
     */
    db.raw.exec("PRAGMA ignore_check_constraints = ON");
    db.raw.prepare("UPDATE runner_event SET base = '4b' WHERE game_id = 'g1'").run();
    db.raw.exec("PRAGMA ignore_check_constraints = OFF");
    assert.throws(() => steals(db, 2026, "regular", "9999-12-31"), /모르는 루/);
  });
});
