/**
 * 투수의 역할 판정과 성적 분할.
 *
 * ⚠**이 규칙이 틀리면 화면이 조용히 거짓말을 한다.** 역할은 ①어느 순위표에 서는가
 * ②어떤 분포로 색을 칠하는가를 정하는데, 둘 다 값 자체는 맞아 보인다.
 * 마무리 투수를 선발로 분류하면 방어율 2.80이 「とても良い」가 되지만
 * 구원 분포에서는 「ふつう」다 — 숫자는 맞고 뜻만 틀린다.
 *
 * ⚠**선발 등판은 `pitching_line`에 없다.** 등판 순서를 담을 자리가 없어서
 * 타석 로그(각 이닝 절반의 첫 타석)에서 되찾는다. 그 되찾기를 여기서 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  replacePaEvents,
  upsertGame,
  upsertPitching,
  upsertPlayer,
} from "@bb-app/store";
import type { Db, PaEventRow, PitchingRow } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";

const NOW = "2026-08-15T00:00:00.000Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-role-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    // 타석 로그의 타자도 실재해야 한다(외래키). 역할 판정과는 무관한 배경이다
    upsertPlayer(db, "B1", "타자", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function seedGame(db: Db, id: string, date: string): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
  });
}

function pitch(o: Partial<PitchingRow> & { gameId: string; playerId: string }): PitchingRow {
  return {
    side: "home", decision: null, outs: 3, bf: 3, pitches: 12,
    h: 1, hr: 0, bb: 0, hbp: 0, so: 1, runs: 0, er: 0,
    ...o,
  };
}

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number; pitcherId: string }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    batterId: "B1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", status: "final",
    ...o,
  };
}

/**
 * 한 경기를 만든다. `topStarter`가 **홈 팀 선발**(1회초를 던진 투수),
 * `bottomStarter`가 원정 팀 선발이다.
 */
function seedWithStarters(
  db: Db,
  gameId: string,
  date: string,
  topStarter: string,
  bottomStarter: string,
  extra: readonly PaEventRow[] = [],
): void {
  seedGame(db, gameId, date);
  replacePaEvents(db, gameId, [
    ev({ gameId, seq: 1, half: "top", inning: 1, pitcherId: topStarter }),
    ev({ gameId, seq: 2, half: "bottom", inning: 1, pitcherId: bottomStarter }),
    ...extra,
  ]);
}

test("각 이닝 절반의 첫 타석 투수가 선발이다 — 양 팀에서 한 명씩 나온다", async () => {
  await withDb((db) => {
    for (const id of ["SP1", "SP2", "RP1"]) upsertPlayer(db, id, id, NOW);
    seedWithStarters(db, "g1", "2026-04-01", "SP1", "SP2", [
      // 8회에 등판한 구원. **순번이 뒤라서 선발이 아니다**
      ev({ gameId: "g1", seq: 3, half: "top", inning: 8, pitcherId: "RP1" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SP1", outs: 18 }));
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SP2", outs: 18, side: "away" }));
    upsertPitching(db, pitch({ gameId: "g1", playerId: "RP1", outs: 3 }));

    const agg = aggregateSeason(db, 2026);
    const by = new Map(agg.pitching.map((p) => [p.playerId, p]));
    assert.equal(by.get("SP1")!.starts, 1);
    assert.equal(by.get("SP2")!.starts, 1);
    assert.equal(by.get("RP1")!.starts, 0, "8회 등판이 선발로 잡혔다");
  });
});

test("⚠역할은 등판 수가 아니라 아웃으로 정한다 — 33등판 1선발 같은 투수가 실재한다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SWING", "스윙맨", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);

    // 선발 1경기 21아웃(7이닝)
    seedWithStarters(db, "g1", "2026-04-01", "SWING", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SWING", outs: 21 }));
    // 구원 5경기 합계 15아웃 — **등판 수는 구원이 5배 많지만 아웃은 선발이 많다**
    for (let i = 2; i <= 6; i += 1) {
      const gameId = `g${i}`;
      seedWithStarters(db, gameId, `2026-04-0${i}`, "OTHER", "OTHER", [
        ev({ gameId, seq: 3, half: "top", inning: 8, pitcherId: "SWING" }),
      ]);
      upsertPitching(db, pitch({ gameId, playerId: "SWING", outs: 3 }));
    }

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "SWING")!;
    assert.equal(p.games, 6);
    assert.equal(p.starts, 1);
    assert.equal(p.asStarter.outs, 21);
    assert.equal(p.asReliever.outs, 15);
    assert.equal(p.role, "starter", "등판 수로 판정하면 구원이 된다 — 아웃으로 재야 한다");
  });
});

test("아웃이 구원 쪽에 많으면 구원형이다 — 반대 방향도 실제로 뒤집힌다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SWING", "스윙맨", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);

    seedWithStarters(db, "g1", "2026-04-01", "SWING", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SWING", outs: 6 }));
    for (let i = 2; i <= 6; i += 1) {
      const gameId = `g${i}`;
      seedWithStarters(db, gameId, `2026-04-0${i}`, "OTHER", "OTHER", [
        ev({ gameId, seq: 3, half: "top", inning: 8, pitcherId: "SWING" }),
      ]);
      upsertPitching(db, pitch({ gameId, playerId: "SWING", outs: 3 }));
    }

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "SWING")!;
    assert.equal(p.asStarter.outs, 6);
    assert.equal(p.asReliever.outs, 15);
    assert.equal(p.role, "reliever");
  });
});

test("아웃이 같으면 선발로 본다 — 선발 등판이 있었다는 사실을 우선한다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SWING", "스윙맨", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);
    seedWithStarters(db, "g1", "2026-04-01", "SWING", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SWING", outs: 9 }));
    seedWithStarters(db, "g2", "2026-04-02", "OTHER", "OTHER", [
      ev({ gameId: "g2", seq: 3, half: "top", inning: 8, pitcherId: "SWING" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g2", playerId: "SWING", outs: 9 }));

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "SWING")!;
    assert.equal(p.asStarter.outs, p.asReliever.outs);
    assert.equal(p.role, "starter");
  });
});

test("선발 등판이 하나도 없으면 구원형이다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "RP", "마무리", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);
    seedWithStarters(db, "g1", "2026-04-01", "OTHER", "OTHER", [
      ev({ gameId: "g1", seq: 3, half: "top", inning: 9, pitcherId: "RP" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g1", playerId: "RP", outs: 3, decision: "S" }));

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "RP")!;
    assert.equal(p.starts, 0);
    assert.equal(p.role, "reliever");
    assert.equal(p.asStarter.outs, 0);
  });
});

test("⚠분할의 합이 전체와 같다 — 어긋나면 어딘가에서 성적이 새고 있다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SWING", "스윙맨", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);
    seedWithStarters(db, "g1", "2026-04-01", "SWING", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SWING", outs: 18, h: 5, hr: 1, bb: 2, so: 6, er: 2, runs: 3 }));
    seedWithStarters(db, "g2", "2026-04-02", "OTHER", "OTHER", [
      ev({ gameId: "g2", seq: 3, half: "top", inning: 8, pitcherId: "SWING" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g2", playerId: "SWING", outs: 3, h: 1, hr: 0, bb: 1, so: 2, er: 1, runs: 1 }));

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "SWING")!;
    for (const k of ["outs", "h", "hr", "bb", "hbp", "so", "er", "r"] as const) {
      assert.equal(
        p.asStarter[k] + p.asReliever[k],
        p.line[k],
        `${k}: 선발분+구원분이 전체와 다르다`,
      );
    }
  });
});

test("결정 표기를 센다 — 구원승은 홀드포인트의 입력이라 따로 센다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SP", "선발", NOW);
    upsertPlayer(db, "RP", "구원", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);

    // 선발승
    seedWithStarters(db, "g1", "2026-04-01", "SP", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SP", outs: 18, decision: "○" }));
    // 구원승 + 홀드
    seedWithStarters(db, "g2", "2026-04-02", "OTHER", "OTHER", [
      ev({ gameId: "g2", seq: 3, half: "top", inning: 7, pitcherId: "RP" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g2", playerId: "RP", outs: 3, decision: "○" }));
    seedWithStarters(db, "g3", "2026-04-03", "OTHER", "OTHER", [
      ev({ gameId: "g3", seq: 3, half: "top", inning: 8, pitcherId: "RP" }),
    ]);
    upsertPitching(db, pitch({ gameId: "g3", playerId: "RP", outs: 3, decision: "H" }));

    const by = new Map(aggregateSeason(db, 2026).pitching.map((p) => [p.playerId, p]));
    const sp = by.get("SP")!;
    const rp = by.get("RP")!;
    assert.equal(sp.decisions.w, 1);
    assert.equal(sp.decisions.reliefW, 0, "선발승이 구원승으로 세어졌다");
    assert.equal(rp.decisions.w, 1);
    assert.equal(rp.decisions.reliefW, 1, "구원승이 세어지지 않았다");
    assert.equal(rp.decisions.hld, 1);
    // HP = 홀드 + 구원승
    assert.equal(rp.decisions.hld + rp.decisions.reliefW, 2);
  });
});

test("타석 로그가 없는 경기는 선발이 0이다 — 우천 중지에는 투수 기록 자체가 없다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "SP", "선발", NOW);
    upsertPlayer(db, "OTHER", "상대", NOW);
    seedWithStarters(db, "g1", "2026-04-01", "SP", "OTHER");
    upsertPitching(db, pitch({ gameId: "g1", playerId: "SP", outs: 18 }));
    // 타석 로그가 없는 경기에 투수 기록만 있는 상황(있어서는 안 되지만, 있어도 죽지 않아야 한다)
    seedGame(db, "g2", "2026-04-02");
    upsertPitching(db, pitch({ gameId: "g2", playerId: "SP", outs: 6 }));

    const p = aggregateSeason(db, 2026).pitching.find((x) => x.playerId === "SP")!;
    assert.equal(p.games, 2);
    assert.equal(p.starts, 1, "로그 없는 경기가 선발로 잡혔다");
    // ⚠로그가 없으면 **구원으로 떨어진다.** 조용히 선발로 세는 것보다 낫지만, 합은 보존된다
    assert.equal(p.asStarter.outs + p.asReliever.outs, p.line.outs);
  });
});
