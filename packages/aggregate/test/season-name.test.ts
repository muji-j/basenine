/**
 * 시즌별 표시명이 **화면에 실제로 실리는가**.
 *
 * ⚠**저장만 하고 안 읽으면 아무것도 안 고쳐진다.** 이 저장소는 「그 코드가 있다」로
 * 「효력이 있다」를 확인했다가 두 번 데었다 — 그래서 여기서는 **집계 함수를 실제로 돌려**
 * 나온 이름을 본다.
 *
 * ## 무엇이 문제였나
 *
 * 표시명이 **아카이브 최초 등장 경기**의 이름으로 영구 고정돼 있었다(2026-08-21 감사 확정 P1).
 * 실측: 드리프트 **109명 전원이 옛 이름** · 배포물 **12,862/15,439장(83.3%)** 이
 * 그중 최소 한 명을 옛 이름으로 그렸고, 2026 화면에 `石川` 이 **두 사람** 나왔다
 * (NPB 는 그 해 `石川慎`/`石川柊` 로 구별한다 — **충돌은 우리가 만든 것**이다).
 *
 * ⚠**「최신이 이긴다」로 고치면 오히려 나빠진다**(분모 6,207쌍: 390 → 409).
 * 옳은 것은 **그 시즌 화면에는 그 시즌의 이름**이다.
 *
 * ## 이 시험이 재는 것
 *
 * ⚠**두 시즌을 한 DB 에 넣고 각각을 집계한다.** 한 시즌만으로는 「시즌을 안 보고
 * 아무 이름이나 쓴다」가 통과한다 — 그게 이 결함의 원래 모양이다.
 * ⚠**폴백도 함께 못 박는다** — 그 시즌 행이 없으면 `player.display_name` 으로 떨어져야 한다.
 * `JOIN` 으로 두면 **선수가 통째로 사라진다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  upsertBatting,
  upsertGame,
  upsertPitching,
  upsertPlayer,
  upsertPlayerSeasonName,
} from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";

const NOW = "2026-08-21T00:00:00.000Z";
const SRC = "https://npb.jp/x";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-sn-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let seq = 0;
/** 한 경기 — 타자 하나와 투수 하나에게 기록을 남긴다 */
function played(db: Db, season: number, date: string): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: SRC, fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId: "BAT", side: "away", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 2, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: "PIT", side: "home", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

function nameOfBatter(db: Db, season: number): string | undefined {
  return aggregateSeason(db, season).batting.find((b) => b.playerId === "BAT")?.displayName;
}
function nameOfPitcher(db: Db, season: number): string | undefined {
  return aggregateSeason(db, season).pitching.find((p) => p.playerId === "PIT")?.displayName;
}

test("⚠그 시즌 화면에는 그 시즌의 이름이 실린다 — 타자·투수 양쪽", async () => {
  await withDb((db) => {
    upsertPlayer(db, "BAT", "옛이름", NOW);
    upsertPlayer(db, "PIT", "옛투수", NOW);
    played(db, 2018, "2018-04-01");
    played(db, 2026, "2026-04-01");
    upsertPlayerSeasonName(db, "BAT", 2018, "石川", "2018-04-01", SRC);
    upsertPlayerSeasonName(db, "BAT", 2026, "石川慎", "2026-04-01", SRC);
    upsertPlayerSeasonName(db, "PIT", 2018, "松井", "2018-04-01", SRC);
    upsertPlayerSeasonName(db, "PIT", 2026, "松井雅", "2026-04-01", SRC);

    // ⚠**두 시즌을 각각 본다** — 한 시즌만으로는 「시즌을 안 보고 아무거나 쓴다」가 통과한다
    assert.equal(nameOfBatter(db, 2018), "石川", "2018 화면에 2018 이름이 안 나온다");
    assert.equal(nameOfBatter(db, 2026), "石川慎", "2026 화면에 2026 이름이 안 나온다");
    assert.equal(nameOfPitcher(db, 2018), "松井");
    assert.equal(nameOfPitcher(db, 2026), "松井雅");
  });
});

/**
 * ⚠**`LEFT JOIN` 이어야 한다.** 그 시즌 행이 없는 DB(적재를 아직 안 돌린 판)에서
 * `JOIN` 으로 두면 **그 선수가 집계에서 통째로 사라진다** — 값이 틀린 것보다 나쁘다.
 */
test("⚠그 시즌 행이 없으면 player.display_name 으로 떨어진다 — 선수가 사라지지 않는다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "BAT", "폴백이름", NOW);
    upsertPlayer(db, "PIT", "폴백투수", NOW);
    played(db, 2026, "2026-04-01");
    // ⚠**시즌 이름을 일부러 안 넣는다**
    assert.equal(nameOfBatter(db, 2026), "폴백이름", "시즌 행이 없자 타자가 사라졌거나 이름이 비었다");
    assert.equal(nameOfPitcher(db, 2026), "폴백투수", "시즌 행이 없자 투수가 사라졌거나 이름이 비었다");
  });
});

/** ⚠**다른 시즌의 이름이 새면 안 된다** — 조인 조건에 시즌이 빠지면 여기가 운다 */
test("⚠다른 시즌의 이름이 새지 않는다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "BAT", "폴백이름", NOW);
    upsertPlayer(db, "PIT", "폴백투수", NOW);
    played(db, 2026, "2026-04-01");
    // 2018 행만 넣는다 — 2026 화면은 이걸 쓰면 안 된다
    upsertPlayerSeasonName(db, "BAT", 2018, "다른시즌", "2018-04-01", SRC);
    assert.equal(nameOfBatter(db, 2026), "폴백이름", "2018 이름이 2026 화면으로 샜다");
  });
});
