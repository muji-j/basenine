/**
 * 収集ログ의 커버리지 표가 **취득이 멈춘 날에도 행을 만드는가**.
 *
 * ⚠**이 시험이 없어서 화면이 자기 결함을 숨겼다**(2026-08-20 감사 ①).
 * 표가 「적재된 경기일」에서만 행을 만들었기 때문에, **일정조차 못 받은 날은 통째로 사라졌다** —
 * 실측으로 최신 행이 2026-08-16 인데 같은 페이지가 생성일을 2026-08-20 이라고 적고 있었다.
 * 조용한 실패를 사람이 눈으로 찾으라고 만든 화면이 바로 그 조용한 실패를 못 보여줬다.
 *
 * ⚠**렌더러에 손으로 만든 픽스처를 넣는 시험으로는 못 잡는다** — 행을 만드는 곳이
 * `loadCoverage`(DB 쪽)이기 때문이다. 그래서 여기서는 실제 DB를 만든다
 * (`career-site.test.ts` 가 같은 이유로 정한 방식).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { loadLog } from "../src/query.ts";
import type { CoverageDay } from "../src/log-page.ts";

const NOW = "2026-08-20T00:00:00.000Z";
const FETCHED = "2026-08-16T23:00:00.000Z";

/** 치러진 경기 한 판 */
function game(db: Db, date: string, no: number): void {
  upsertGame(db, {
    gameId: `2026/${date.slice(5, 7)}${date.slice(8, 10)}/t-g-${no}`,
    season: 2026,
    gameDate: date,
    awayCode: "t",
    homeCode: "g",
    gameNo: no,
    status: "played",
    notPlayedReason: null,
    competition: "regular",
    sourceUrl: "https://npb.jp/scores/2026/",
    fetchedAt: FETCHED,
    awayRuns: 3,
    homeRuns: 2,
  });
}

/** 월간 일정에는 있는데 결과가 아직 없는 경기 */
function upcoming(db: Db, date: string, seq: number): void {
  db.raw
    .prepare(
      `INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at)
       VALUES (2026, ?, 'g', 't', ?, '東京ドーム', '18:00', 'npb.jp/games/2026/schedule_08_detail.html', ?)`,
    )
    .run(date, seq, FETCHED);
}

async function withLog(fn: (days: CoverageDay[], byDate: Map<string, CoverageDay>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-log-cov-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    // 8/14·8/15·8/16 은 들어왔다. 8/17 은 휴장(일정에도 없다).
    game(db, "2026-08-14", 1);
    game(db, "2026-08-15", 2);
    game(db, "2026-08-16", 3);
    // 8/18·8/19 는 일정표에 있는데 결과가 안 들어왔다 — **이것이 조용한 실패다**
    upcoming(db, "2026-08-18", 0);
    upcoming(db, "2026-08-19", 0);
    // 8/20(생성일) 은 아직 치르지 않았다. 결함이 아니다
    upcoming(db, "2026-08-20", 0);
    const d = loadLog(db, { season: 2026, builtOn: "2026-08-20" });
    fn(d.coverage, new Map(d.coverage.map((x) => [x.date, x])));
  } finally {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠취득이 멈춘 날에도 행이 생긴다 — 없으면 표가 결함을 숨긴다", async () => {
  await withLog((days, byDate) => {
    assert.equal(days[0]?.date, "2026-08-20", "생성일부터 역산하지 않았다");
    for (const missing of ["2026-08-17", "2026-08-18", "2026-08-19"]) {
      assert.ok(byDate.has(missing), `${missing} 의 행이 없다`);
    }
  });
});

test("일정에 있는데 결과가 없는 날과, 일정에도 없는 날을 다른 값으로 낸다(M11)", async () => {
  await withLog((_days, byDate) => {
    // 휴장 — 일정표가 그 날을 말하지 않는다
    assert.equal(byDate.get("2026-08-17")?.upcoming, 0);
    assert.equal(byDate.get("2026-08-17")?.scheduled, 0);
    // 취득 실패 — 일정표에는 있다
    assert.equal(byDate.get("2026-08-18")?.upcoming, 1);
    assert.equal(byDate.get("2026-08-19")?.upcoming, 1);
    // 생성일 당일도 일정에는 있다. 결함인지 아닌지는 화면이 판단한다
    assert.equal(byDate.get("2026-08-20")?.upcoming, 1);
  });
});

test("⚠적재가 끝난 경기를 일정 쪽에서 두 번 세지 않는다 — 없는 경기를 지어내게 된다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-log-dup-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    game(db, "2026-08-16", 3);
    // 일정 페이지 스냅숏이 결과보다 오래되면 같은 카드가 양쪽에 남는다
    upcoming(db, "2026-08-16", 0);
    const d = loadLog(db, { season: 2026, builtOn: "2026-08-16" });
    const day = d.coverage.find((x) => x.date === "2026-08-16");
    assert.equal(day?.scheduled, 1);
    assert.equal(day?.upcoming, 0, "적재된 경기를 일정 쪽에서 또 셌다");
  } finally {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠시즌이 끝난 뒤에 만들어도 「試合なし」로 표를 채우지 않는다 — 상한이 있다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-log-far-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    game(db, "2026-08-16", 3);
    // 마지막 경기에서 반년 뒤에 만든 화면
    const d = loadLog(db, { season: 2026, builtOn: "2027-02-16" });
    assert.equal(d.coverage[0]?.date, "2026-08-30", "상한(14일)을 넘겨 늘렸다");
    assert.ok(d.coverage.length <= 15, `행이 ${d.coverage.length}개로 늘었다`);
  } finally {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});
