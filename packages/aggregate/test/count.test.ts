/**
 * カウント別成績 — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠**이 지표의 함정은 세 개이고 전부 실측이다**(2026-08-20):
 *   1. **申告敬遠이 `0-0より` 로 들어온다** — 전 시즌 `intentionalWalk` 2,319건 중 **1,614건**.
 *      안 빼면 「초구에 끝냈다」에 던지지도 않은 고의사구가 섞인다.
 *   2. **정의역 밖 값이 실재한다** — `4-2より` **1건**(`2018/0809/c-d-18` seq 25).
 *      **0 으로 때우지 않고 격리한다**(M7·M11).
 *   3. `ball_count` 는 지금 NULL 0건이지만 **스키마가 NULL 을 허용한다**(마이그레이션 008) —
 *      소급 시즌에서 나올 수 있다.
 *
 * ⚠**렌더 계층 시험만으로는 이 값이 틀려도 전부 초록이 된다**(`gidp.test.ts` 머리말과 같은 이유).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertPlayer } from "@bb-app/store";
import {
  countLines,
  firstPitchRate,
  fullCountRate,
  parseBallCount,
  threeBallRate,
  twoStrikeRate,
} from "../src/count.ts";

const NOW = "2026-08-20T00:00:00.000Z";

type Ev = {
  count: string | null;
  outcome: string;
  batter?: string;
  pitcher?: string;
  half?: "top" | "bottom";
};

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-count-"));
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
  competition: string,
  evs: readonly Ev[],
): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition,
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  evs.forEach((e, i) => {
    const batter = e.batter ?? "B1";
    const pitcher = e.pitcher ?? "P1";
    upsertPlayer(db, batter, batter, NOW);
    upsertPlayer(db, pitcher, pitcher, NOW);
    db.raw
      .prepare(
        `INSERT INTO pa_event
         (game_id, seq, inning, half, outs_before, bases, batter_id, pitcher_id,
          outcome, rbi, raw_box, raw_pbp, status, runs_scored, ball_count)
         VALUES (?, ?, 1, ?, 0, '', ?, ?, ?, 0, '', '', 'final', 0, ?)`,
      )
      .run(id, i + 1, e.half ?? "bottom", batter, pitcher, e.outcome, e.count);
  });
}

// ── 원문 해석 ──────────────────────────────────────────────────────────

test("`B-Sより` 를 읽는다 — 원문을 정규화해 저장하지 않으므로 여기서 해석한다", () => {
  assert.deepEqual(parseBallCount("1-2より"), { balls: 1, strikes: 2 });
  assert.deepEqual(parseBallCount("0-0より"), { balls: 0, strikes: 0 });
  assert.deepEqual(parseBallCount("3-2より"), { balls: 3, strikes: 2 });
});

test("⚠정의역 밖은 null 이다 — 0 으로 때우지 않는다(M7). `4-2より` 가 실재한다", () => {
  // 실측: 아카이브 563,833행 중 `4-2より` 1건(2018/0809/c-d-18 seq 25)
  assert.equal(parseBallCount("4-2より"), null);
  assert.equal(parseBallCount("3-3より"), null);
  assert.equal(parseBallCount("-1-2より"), null);
});

test("⚠NULL·형식 불명도 null 이다 — 스키마가 NULL 을 허용한다(마이그레이션 008)", () => {
  assert.equal(parseBallCount(null), null);
  assert.equal(parseBallCount(""), null);
  assert.equal(parseBallCount("1-2"), null, "`より` 가 없는 표기를 아는 척하지 않는다");
  assert.equal(parseBallCount("12より"), null);
});

// ── 집계 ───────────────────────────────────────────────────────────────

test("2스트라이크 도달·3볼 도달·풀카운트를 종료 카운트에서 센다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "0-0より", outcome: "single" },
      { count: "1-2より", outcome: "strikeout" },
      { count: "3-1より", outcome: "walk" },
      { count: "3-2より", outcome: "fieldedOut" },
      { count: "0-1より", outcome: "fieldedOut" },
    ]);
    const [l] = countLines(db, 2026, "regular", "9999-12-31");
    assert.ok(l !== undefined);
    assert.equal(l.pa, 5);
    assert.equal(l.quarantined, 0);
    // 1-2 · 3-2 = 2건
    assert.equal(l.twoStrike, 2);
    // 3-1 · 3-2 = 2건
    assert.equal(l.threeBall, 2);
    assert.equal(l.fullCount, 1);
    assert.equal(l.firstPitch, 1);
  });
});

test("⚠申告敬遠은 初球決着에서 뺀다 — 이 분기를 지우면 여기서 떨어진다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "0-0より", outcome: "single" },
      { count: "0-0より", outcome: "intentionalWalk" },
      { count: "0-0より", outcome: "intentionalWalk" },
    ]);
    const [l] = countLines(db, 2026, "regular", "9999-12-31");
    assert.ok(l !== undefined);
    assert.equal(l.pa, 3, "타석 자체는 3개다 — 뺀 것은 初球決着의 분자뿐이다");
    assert.equal(
      l.firstPitch,
      1,
      "申告敬遠 2건이 「초구に決着」に混ざっている — 投げていない球を数えている",
    );
  });
});

test("⚠정의역 밖·NULL 은 격리한다 — 분모에서 빼고 몇 건인지 보고한다(M11)", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "1-2より", outcome: "strikeout" },
      { count: "4-2より", outcome: "fieldedOut" },
      { count: null, outcome: "fieldedOut" },
      { count: "0-0より", outcome: "single" },
    ]);
    const [l] = countLines(db, 2026, "regular", "9999-12-31");
    assert.ok(l !== undefined);
    assert.equal(l.pa, 2, "읽을 수 있었던 타석만 분모다");
    assert.equal(l.quarantined, 2, "격리한 타석을 조용히 버리지 않는다");
    assert.equal(l.twoStrike, 1);
  });
});

test("2스트라이크 전후의 打撃 성적을 나눠 든다 — 나누지 않으면 이 블록의 뜻이 없다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "0-0より", outcome: "single" },
      { count: "1-1より", outcome: "double" },
      { count: "1-2より", outcome: "strikeout" },
      { count: "2-2より", outcome: "single" },
      { count: "3-2より", outcome: "walk" },
    ]);
    const [l] = countLines(db, 2026, "regular", "9999-12-31");
    assert.ok(l !== undefined);
    // 追い込まれる前: 単打1 + 二塁打1 = 2打数2安打
    assert.equal(l.beforeTwoStrikeLine.pa, 2);
    assert.equal(l.beforeTwoStrikeLine.ab, 2);
    assert.equal(l.beforeTwoStrikeLine.h, 2);
    // 追い込まれた後: 三振1 + 単打1 + 四球1 = 3打席 2打数 1安打
    assert.equal(l.twoStrikeLine.pa, 3);
    assert.equal(l.twoStrikeLine.ab, 2);
    assert.equal(l.twoStrikeLine.h, 1);
    assert.equal(l.twoStrikeLine.so, 1);
    assert.equal(l.twoStrikeLine.bb, 1);
  });
});

test("⚠대회를 섞지 않는다(§2-1) — 올스타를 넣으면 값이 바뀐다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ count: "1-2より", outcome: "strikeout" }]);
    game(db, "g2", "allStar", [
      { count: "1-2より", outcome: "strikeout" },
      { count: "0-0より", outcome: "single" },
    ]);
    const reg = countLines(db, 2026, "regular", "9999-12-31");
    const all = countLines(db, 2026, "allStar", "9999-12-31");
    assert.equal(reg[0]?.pa, 1);
    assert.equal(all[0]?.pa, 2);
  });
});

test("투수 기준으로도 센다 — 같은 로그를 반대편에서 읽는다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "1-2より", outcome: "strikeout", batter: "B1", pitcher: "P1" },
      { count: "0-2より", outcome: "strikeout", batter: "B2", pitcher: "P1" },
      { count: "0-0より", outcome: "single", batter: "B1", pitcher: "P2" },
    ]);
    const bat = countLines(db, 2026, "regular", "9999-12-31");
    const pit = countLines(db, 2026, "regular", "9999-12-31", true);
    assert.equal(bat.length, 2, "타자 2명");
    assert.equal(pit.length, 2, "투수 2명");
    const p1 = pit.find((x) => x.playerId === "P1");
    assert.ok(p1 !== undefined);
    assert.equal(p1.pa, 2);
    assert.equal(p1.twoStrike, 2, "이 투수는 두 타석 모두 追い込んだ");
    // ⚠투수의 소속은 **수비 측**이다 — 표(top)면 홈
    assert.equal(p1.teamCode, "g", "리(bottom)에서 던진 투수는 원정 소속이다");
    const b1 = bat.find((x) => x.playerId === "B1");
    assert.equal(b1?.teamCode, "t", "리(bottom)에서 친 타자는 홈 소속이다");
  });
});

/**
 * ⚠**이 시험이 실제 결함을 잡았다**(2026-08-20).
 *
 * 처음에는 투수판 SQL 을 `SQL.replace(...) + " AND e.pitcher_id IS NOT NULL"` 로 만들었는데,
 * 이 SQL 에는 **`GROUP BY` 가 있어서** 그 조건이 `GROUP BY` **뒤**에 붙었다 —
 * `GROUP BY …, e.outcome AND e.pitcher_id IS NOT NULL` 은 **문법 오류가 아니라**
 * 「불리언으로 묶기」라 조용히 통과하고, **한 카운트의 모든 결과가 한 그룹으로 뭉쳤다.**
 * 개수(`pa`·`twoStrike`)는 `COUNT(*)` 라 맞았고, 틀린 것은 **성적 줄뿐**이었다.
 *
 * ⚠**바로 위의 투수 시험은 이걸 못 잡는다** — 거기서는 결과가 전부 `strikeout` 이라
 * 뭉쳐도 답이 같다. **같은 카운트에 서로 다른 결과**를 넣어야 갈린다.
 */
test("⚠투수의 성적 줄이 결과별로 갈린다 — 같은 카운트에 다른 결과를 섞어 본다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { count: "1-2より", outcome: "strikeout", batter: "B1", pitcher: "P1" },
      { count: "1-2より", outcome: "single", batter: "B2", pitcher: "P1" },
      { count: "1-2より", outcome: "homerun", batter: "B3", pitcher: "P1" },
      { count: "1-2より", outcome: "walk", batter: "B4", pitcher: "P1" },
    ]);
    const [p1] = countLines(db, 2026, "regular", "9999-12-31", true);
    assert.ok(p1 !== undefined);
    assert.equal(p1.pa, 4);
    assert.equal(p1.twoStrike, 4);
    const l = p1.twoStrikeLine;
    assert.equal(l.pa, 4);
    assert.equal(l.so, 1, "삼진이 1이 아니다 — 결과가 뭉쳤다(GROUP BY 를 의심하라)");
    assert.equal(l.h, 2, "안타가 2가 아니다 — 결과가 뭉쳤다");
    assert.equal(l.hr, 1, "홈런이 1이 아니다 — 결과가 뭉쳤다");
    assert.equal(l.bb, 1, "볼넷이 1이 아니다 — 결과가 뭉쳤다");
    assert.equal(l.ab, 3, "打数가 3이 아니다(볼넷은 打数가 아니다)");
  });
});

// ── 비율 ───────────────────────────────────────────────────────────────

test("⚠분모가 0이면 값을 내지 않는다 — 「몰리지 않았다」와 「타석이 없다」는 다르다(M11)", () => {
  const empty = {
    playerId: "x", displayName: "x", teamCode: "t",
    pa: 0, quarantined: 0, twoStrike: 0, threeBall: 0, fullCount: 0, firstPitch: 0,
    twoStrikeLine: null as never, beforeTwoStrikeLine: null as never,
  };
  assert.equal(twoStrikeRate(empty).value, null);
  assert.equal(firstPitchRate(empty).value, null);
  assert.equal(fullCountRate(empty).value, null);
  assert.equal(threeBallRate(empty).value, null);
  assert.equal(twoStrikeRate(empty).denominator, 0, "분모는 버리지 않는다(M2)");
});

test("비율은 격리분을 뺀 분모로 낸다 — 못 읽은 타석을 「몰리지 않았다」로 세면 값이 낮아진다", () => {
  const l = {
    playerId: "x", displayName: "x", teamCode: "t",
    pa: 10, quarantined: 5, twoStrike: 5, threeBall: 2, fullCount: 1, firstPitch: 2,
    twoStrikeLine: null as never, beforeTwoStrikeLine: null as never,
  };
  assert.equal(twoStrikeRate(l).value, 0.5);
  assert.equal(twoStrikeRate(l).denominator, 10);
});
