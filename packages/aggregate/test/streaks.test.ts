/**
 * 연속 기록.
 *
 * ⚠**여기서 잡는 것은 「길이가 맞는가」보다 「무엇을 세는가」다.**
 * 타석 없는 경기를 세면 연속 기록이 이유 없이 끊기고, 그건 값이 틀린 것보다
 * 발견하기 어렵다 — 숫자가 그럴듯하게 작아질 뿐이기 때문이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPlayer } from "@bb-app/store";
import type { BattingRow, Db } from "@bb-app/store";
import { battingStreaks } from "../src/streaks.ts";

const NOW = "2026-08-16T00:00:00.000Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-streak-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "B1", "타자", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function bat(over: Partial<BattingRow> & { gameId: string }): BattingRow {
  return {
    playerId: "B1", side: "away", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 0, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    ...over,
  };
}

/** `hits` 배열대로 날짜순 경기를 만든다. `null`이면 **타석이 없는 경기**(대주자 등) */
function seed(db: Db, hits: readonly (number | null)[], walks: readonly number[] = []): void {
  hits.forEach((h, i) => {
    const gameId = `g${i}`;
    const date = `2026-04-${String(i + 1).padStart(2, "0")}`;
    upsertGame(db, {
      gameId, season: 2026, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    upsertBatting(db, bat({
      gameId,
      pa: h === null ? 0 : 4,
      ab: h === null ? 0 : 4,
      h: h ?? 0,
      bb: walks[i] ?? 0,
    }));
  });
}

test("연속 안타를 경기 단위로 센다", async () => {
  await withDb((db) => {
    // 안타 · 안타 · 무안타 · 안타 · 안타 · 안타
    seed(db, [1, 2, 0, 1, 1, 3]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitting.best, 3, "마지막 3경기가 최장이다");
    assert.equal(s.hitting.current, 3, "마지막까지 이어지고 있다");
    assert.equal(s.games, 6);
  });
});

test("⚠끊긴 기록의 「今」은 0이다 — 최장만 내면 오늘도 이어지는 것처럼 보인다", async () => {
  await withDb((db) => {
    seed(db, [1, 1, 1, 1, 0]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitting.best, 4);
    assert.equal(s.hitting.current, 0, "마지막 경기에서 끊겼는데 이어진다고 했다");
  });
});

test("⚠타석 없는 경기는 세지 않는다 — 대주자로만 나온 날에 기록이 끊기면 안 된다", async () => {
  await withDb((db) => {
    // 안타 · [타석 없음] · 안타 → 연속 2경기로 이어져야 한다
    seed(db, [1, null, 1]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.games, 2, "타석 없는 경기를 분모에 넣었다");
    assert.equal(s.hitting.best, 2, "대주자 경기가 기록을 끊었다");
    assert.equal(s.hitting.current, 2);
  });
});

test("연속 출루는 사사구로도 이어진다 — 연속 안타보다 길어진다", async () => {
  await withDb((db) => {
    // 안타 · 무안타(볼넷) · 안타
    seed(db, [1, 0, 1], [0, 1, 0]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitting.best, 1, "안타는 이어지지 않는다");
    assert.equal(s.onBase.best, 3, "볼넷으로 출루는 이어져야 한다");
  });
});

test("연속 무안타도 센다 — 좋은 기록이 아니어도 지금 상태를 말하려면 필요하다", async () => {
  await withDb((db) => {
    seed(db, [1, 0, 0, 0]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitless.current, 3);
    assert.equal(s.hitless.best, 3);
  });
});

test("최장 구간의 시작·끝 날짜를 낸다 — 언제였는지 말할 수 없으면 기록이 아니다", async () => {
  await withDb((db) => {
    seed(db, [0, 1, 1, 1, 0]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitting.best, 3);
    assert.equal(s.hitting.bestFrom, "2026-04-02");
    assert.equal(s.hitting.bestTo, "2026-04-04");
  });
});

test("기록이 0이면 날짜도 null이다 — 없는 구간에 날짜를 붙이지 않는다(M11)", async () => {
  await withDb((db) => {
    seed(db, [0, 0, 0]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitting.best, 0);
    assert.equal(s.hitting.bestFrom, null);
    assert.equal(s.hitting.bestTo, null);
  });
});

test("⚠더블헤더는 두 경기다 — 날짜로 묶으면 끊겼어야 할 기록이 이어진다", async () => {
  await withDb((db) => {
    // 같은 날 1차전 무안타 · 2차전 안타. **날짜로 묶으면 「안타 있는 날」이 되어 이어진다**
    //
    // ⚠**경기 ID의 사전순을 경기 번호와 일부러 반대로 둔다.** 같은 순서면 정렬이 없어도
    // 우연히 통과해서, 「경기 번호 순으로 센다」가 실제로 검증되지 않는다
    // (2026-08-16 변이 검사에서 실제로 그렇게 새어 나갔다).
    const day = "2026-04-10";
    const dh: [string, number, number][] = [
      ["z-first", 1, 0], // 1차전 · 무안타
      ["a-second", 2, 1], // 2차전 · 안타
    ];
    for (const [gameId, gameNo, h] of dh) {
      upsertGame(db, {
        gameId, season: 2026, gameDate: day, awayCode: "t", homeCode: "g", gameNo,
        status: "played", notPlayedReason: null, competition: "regular",
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      });
      upsertBatting(db, bat({ gameId, h }));
    }
    // 그 전날에도 안타를 쳤다면, 1차전에서 끊겨야 한다
    upsertGame(db, {
      gameId: "pre", season: 2026, gameDate: "2026-04-09", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    upsertBatting(db, bat({ gameId: "pre", h: 1 }));

    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.games, 3, "더블헤더를 한 경기로 셌다");
    // 4/9 안타 → 1차전 무안타(끊김) → 2차전 안타. 최장은 1, 현재도 1
    assert.equal(s.hitting.best, 1, "1차전 무안타가 기록을 끊지 못했다");
    assert.equal(s.hitting.current, 1);
  });
});

test("⚠시즌을 넘겨 세지 않는다 — 2시즌뿐이라 「통산」이 될 수 없다", async () => {
  await withDb((db) => {
    for (const [i, season] of [2025, 2026].entries()) {
      const gameId = `s${season}`;
      upsertGame(db, {
        gameId, season, gameDate: `${season}-04-0${i + 1}`, awayCode: "t", homeCode: "g", gameNo: 1,
        status: "played", notPlayedReason: null, competition: "regular",
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      });
      upsertBatting(db, bat({ gameId, h: 1 }));
    }
    assert.equal(battingStreaks(db, 2026).get("B1")!.hitting.best, 1);
    assert.equal(battingStreaks(db, 2025).get("B1")!.hitting.best, 1);
  });
});

/**
 * ⚠**연속 무안타의 정의를 못 박는다.** 「출루가 없는 경기」로 바꿔도 시험이 통과하고 있었다
 * (2026-08-16 변이 검사에서 생존). 볼넷으로 출루한 무안타 경기가 갈림길이다.
 */
test("⚠연속 무안타는 「안타가 없는 경기」다 — 볼넷으로 출루해도 무안타는 무안타다", async () => {
  await withDb((db) => {
    // 무안타·볼넷 · 무안타·볼넷 → 연속 무안타 2, 연속 출루 2
    seed(db, [0, 0], [1, 1]);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.hitless.current, 2, "출루했다고 무안타가 끊겼다");
    assert.equal(s.onBase.current, 2);
  });
});

test("⚠사구도 출루로 센다 — 볼넷만 세면 몸에 맞고 나간 경기가 사라진다", async () => {
  await withDb((db) => {
    const day = (i: number, hbp: number): void => {
      const gameId = `hb${i}`;
      upsertGame(db, {
        gameId, season: 2026, gameDate: `2026-04-1${i}`, awayCode: "t", homeCode: "g", gameNo: 1,
        status: "played", notPlayedReason: null, competition: "regular",
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      });
      upsertBatting(db, bat({ gameId, h: 0, bb: 0, hbp }));
    };
    day(1, 1);
    day(2, 1);
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.onBase.current, 2, "사구가 출루로 안 세어졌다");
  });
});

test("⚠포스트시즌을 섞지 않는다 — CS의 안타가 정규시즌 연속 기록을 이어 주면 안 된다", async () => {
  await withDb((db) => {
    seed(db, [1, 0]);
    upsertGame(db, {
      gameId: "cs", season: 2026, gameDate: "2026-10-11", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "climaxSeries",
      sourceUrl: "https://npb.jp/z", fetchedAt: NOW,
    });
    upsertBatting(db, bat({ gameId: "cs", h: 3 }));
    const s = battingStreaks(db, 2026).get("B1")!;
    assert.equal(s.games, 2, "CS 경기가 정규시즌 분모에 들어갔다");
    assert.equal(s.hitting.current, 0, "CS의 안타가 연속 기록을 이었다");
  });
});
