/**
 * 併殺打(GIDP) — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠**이 지표의 함정은 하나다: `併失`.**
 * 박스스코어의 `遊併失`(併殺崩れの失策)는 어휘표에서 `失$` 로 먼저 걸려 `reachedOnError` 가 된다.
 * 그런데 NPB 는 그것을 **併殺打로 센다** — 타석 로그 원문이 `ショートゴロ併殺打（エラー）` 이다.
 * 빼면 공표치와 **선수-시즌 14건**이 −1 씩 어긋난다
 * (실측 2026-08-20 · 2022:3 · 2023:6 · 2024:3 · 2025:1 · 2026:1).
 * 아래 두 번째 시험이 그 한 건을 직접 짚는다 — **`併失` 분기를 지우면 떨어진다.**
 *
 * ⚠**렌더 계층 시험만으로는 이 값이 틀려도 전부 초록이 된다**(`bunt.test.ts` 머리말과 같은 이유).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertPlayer } from "@bb-app/store";
import { groundedIntoDoublePlays } from "../src/gidp.ts";

const NOW = "2026-08-20T00:00:00.000Z";

type Ev = { outcome: string; rawBox: string; batter?: string; half?: "top" | "bottom" };

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-gidp-"));
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
    upsertPlayer(db, batter, batter, NOW);
    upsertPlayer(db, "P1", "P1", NOW);
    db.raw
      .prepare(
        `INSERT INTO pa_event
         (game_id, seq, inning, half, outs_before, bases, batter_id, pitcher_id,
          outcome, rbi, raw_box, raw_pbp, status, runs_scored)
         VALUES (?, ?, 1, ?, 0, '1', ?, 'P1', ?, 0, ?, '', 'final', 0)`,
      )
      .run(id, i + 1, e.half ?? "bottom", batter, e.outcome, e.rawBox);
  });
}

test("併殺打를 선수별로 센다 — 分類가 그것인 타석만", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打" },
      { outcome: "groundedIntoDoublePlay", rawBox: "二併打" },
      { outcome: "fieldedOut", rawBox: "遊ゴロ" },
      { outcome: "single", rawBox: "中安" },
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打", batter: "B2" },
    ]);
    const rows = groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31");
    assert.equal(rows.find((r) => r.playerId === "B1")!.gidp, 2);
    assert.equal(rows.find((r) => r.playerId === "B2")!.gidp, 1);
    assert.equal(rows.length, 2);
  });
});

/**
 * ⚠**이 시험이 이 지표의 함정 그 자체다.**
 * `併失` 은 어휘표에서 `失$` 로 먼저 걸려 `reachedOnError` 로 저장돼 있다.
 * 그것을 併殺打에서 빼면 공표치와 어긋난다 — 실DB 대조에서 선수-시즌 14건이 −1 이었다.
 */
test("⚠`併失`(併殺崩れの失策)을 併殺打에 넣는다 — 빼면 NPB 공표치와 어긋난다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打" },
      // 원문은 `ショートゴロ併殺打（エラー）` 이고 박스 셀은 `遊併失` 이다
      { outcome: "reachedOnError", rawBox: "遊併失" },
      // ⚠**보통의 실책 출루는 併殺打가 아니다.** `失$` 를 통째로 넣으면 여기서 부풀어 오른다
      { outcome: "reachedOnError", rawBox: "三ゴ失" },
    ]);
    const rows = groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31");
    assert.equal(rows[0]!.gidp, 2, "`併失` 을 併殺打에서 뺐다 — 공표치보다 1 적어진다");
  });
});

/**
 * ⚠**타점이 나면 `raw_box` 뒤에 丸数字가 붙는다**(`parsePaCell` 이 `raw` 를 그대로 담는다).
 *
 * 지금 아카이브에는 그런 행이 **0건**이라, 접미 패턴(`LIKE '%併失'`)으로 써도 실측으로는 티가 안 난다 —
 * 즉 **오늘의 데이터로는 검증되지 않는 분기**다. 그래서 합성 케이스로 고정한다:
 * 병살 도중 3루 주자가 홈에 들어오는 판이 아카이브에 들어오는 날, 접미 패턴이면 **조용히 0을 센다.**
 * ⚠**「지금 없으니 괜찮다」로 두면 그날 아무도 못 본다**(M7의 정신).
 */
test("⚠타점이 붙은 `遊併失①` 도 併殺打다 — 접미 패턴이면 조용히 0이 된다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打" },
      { outcome: "reachedOnError", rawBox: "遊併失①" },
    ]);
    assert.equal(
      groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31")[0]!.gidp,
      2,
      "丸数字가 붙은 `併失` 을 놓쳤다 — 판정을 `LIKE '%併失'`(접미)로 되돌리면 여기서 떨어진다",
    );
  });
});

/**
 * ⚠**대회를 섞지 않는다**(§2-1). 올스타를 섞으면 2026 도루가 9 어긋난 것과 같은 종류의 오염이다.
 */
test("⚠올스타를 정규시즌에 섞지 않는다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ outcome: "groundedIntoDoublePlay", rawBox: "遊併打" }]);
    game(db, "g2", "allStar", [
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打" },
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打" },
    ]);
    assert.equal(groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31")[0]!.gidp, 1);
    assert.equal(groundedIntoDoublePlays(db, 2026, "allStar", "9999-12-31")[0]!.gidp, 2);
  });
});

/** ⚠미성립 경기의 기록은 무효다 — `steal.ts` 와 같은 경계다 */
test("⚠미성립 경기의 併殺打를 세지 않는다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [{ outcome: "groundedIntoDoublePlay", rawBox: "遊併打" }]);
    db.raw.prepare("UPDATE game SET status = 'notPlayed' WHERE game_id = 'g1'").run();
    assert.deepEqual(groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31"), []);
  });
});

/** 소속은 **공격 측**이다 — 표(top)면 원정, 리(bottom)면 홈. 구단 표가 이 키로 고른다 */
test("소속을 공격 측으로 잡는다 — 구단 표가 이 키로 고른다", async () => {
  await withDb((db) => {
    game(db, "g1", "regular", [
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打", batter: "A1", half: "top" },
      { outcome: "groundedIntoDoublePlay", rawBox: "遊併打", batter: "H1", half: "bottom" },
    ]);
    const rows = groundedIntoDoublePlays(db, 2026, "regular", "9999-12-31");
    assert.equal(rows.find((r) => r.playerId === "A1")!.teamCode, "g");
    assert.equal(rows.find((r) => r.playerId === "H1")!.teamCode, "t");
  });
});
