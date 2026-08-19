/**
 * 구단 페이지의 「続いている記録」·「記録に近づいている」 — **query.ts의 필터가 실제로 도는가**.
 *
 * ⚠**team-page.test.ts만으로는 이걸 잴 수 없다.** `renderTeamPage`는 받은 `TeamPageData`를
 * 그대로 그릴 뿐이라, 「다른 팀 선수가 안 섞인다」를 정말로 재려면 `teamCode`로 거르는 코드
 * (`query.ts`의 `teamPages`)를 통과시켜야 한다. 그래서 이 시험은 `loadSite`를 실제로 돈다 —
 * `build-gates.test.ts`가 이미 쓰는 것과 같은 DB 픽스처 패턴이다.
 *
 * ⚠**뮤테이션 표(작업 지시)**: `teamPages`의 `.filter((s) => s.teamCode === code)`를 지우면
 * (전체 배열을 그대로 쓰면) 이 파일의 「다른 팀 선수는 안 나온다」 단언들이 떨어져야 한다.
 * 실측: 지워 보고 이 파일을 돌리면 4건이 전부 실패로 바뀐다(구현 절 참고).
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
} from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { loadSite } from "../src/query.ts";

const NOW = "2026-08-19T00:00:00.000Z";
const BUILT_ON = "2026-08-19";

let seq = 0;

/**
 * 경기 한 개 — **양 팀 타자·투수 모두**에게 기록을 남긴다.
 *
 * ⚠**`build-gates.test.ts`의 `played()`와 다르다** — 그쪽은 홈 팀에게만 기록을 남기는데,
 * 여기서는 「두 팀 다 연속 기록을 쌓는가」를 재야 해서 양쪽 다 안타를 준다.
 */
function playedBoth(db: Db, date: string, home: string, away: string): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  for (const [side, code] of [["home", home], ["away", away]] as const) {
    upsertBatting(db, {
      gameId, playerId: `BAT_${code}`, side, battingOrder: "1", position: "(遊)",
      pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
      sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    });
    upsertPitching(db, {
      gameId, playerId: `PIT_${code}`, side, decision: null,
      outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
    });
  }
}

/**
 * 통산 마디에 다가선 선수 하나 만들기.
 *
 * ⚠**`career_batting`은 store 패키지에 전용 upsert 헬퍼가 없다**(적재 도구가 원문 그대로
 * DELETE 후 INSERT 하는 원시 SQL이라 — `packages/store/tools/load-players.ts`). 시험도 같은
 * 형태로 원시 SQL을 쓴다. 두 해로 나눈다 — 작년까지 누적 + 올해분(今季 열의 근거).
 */
function career(db: Db, playerId: string, lastYearH: number, thisYearH: number): void {
  const insert = db.raw.prepare(
    `INSERT INTO career_batting (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
       sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
     VALUES (?, 2025, 'x', 100, 400, 380, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'test', ?, 0)`,
  );
  insert.run(playerId, lastYearH, NOW);
  db.raw
    .prepare(
      `INSERT INTO career_batting (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
         sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
       VALUES (?, 2026, 'x', 20, 80, 70, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'test', ?, 0)`,
    )
    .run(playerId, thisYearH, NOW);
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-team-streaks-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠구단 페이지의 연속 기록·기록 근접은 그 구단 선수만 싣는다 — 다른 구단은 안 섞인다", async () => {
  await withDb((db) => {
    // 센트럴 t·g, 파 l·m — 네 팀 다 선수를 남긴다(양대 리그가 다 있어야 팀 페이지가 만들어진다)
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}`, `${c}球団の続巻`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }

    // t·g 는 5경기 연속으로 서로 맞붙는다 — 둘 다 연속 안타 5경기(HOME_STREAK_MIN=5)를 채운다
    const centralDates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
    for (const d of centralDates) playedBoth(db, d, "t", "g");
    // l·m 은 최소한만 — 리그 번들이 비지 않게 하는 목적뿐이다
    for (const d of centralDates.slice(0, 2)) playedBoth(db, d, "l", "m");

    // 통산 마디 — t·g 선수 둘 다 500안타에 근접(각각 5개·10개 남음), l 은 마디에서 멀다(400개 남음)
    career(db, "BAT_t", 480, 15); // 495 → 500까지 5
    career(db, "BAT_g", 470, 20); // 490 → 500까지 10
    career(db, "BAT_l", 50, 5); // 55 → 500까지 445(근접이 아니다 — CAREER_MILESTONES 밖은 안 실린다)

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });

    const teamT = site.teams.find((x) => x.teamCode === "t");
    const teamG = site.teams.find((x) => x.teamCode === "g");
    assert.notEqual(teamT, undefined, "t 구단 페이지가 안 만들어졌다");
    assert.notEqual(teamG, undefined, "g 구단 페이지가 안 만들어졌다");

    // ⚠**픽스처가 실제로 무언가를 만들었는지부터 잰다** — 안 그러면 아래 단언이 전부 공회전한다
    assert.ok(teamT!.streaks.length > 0, "픽스처가 t 의 연속 기록을 하나도 못 만들었다 — 시험이 공회전한다");
    assert.ok(teamT!.milestones.length > 0, "픽스처가 t 의 기록 근접을 하나도 못 만들었다 — 시험이 공회전한다");

    // t 페이지에는 t 선수만
    assert.ok(teamT!.streaks.every((s) => s.playerId === "BAT_t"), "t 구단 페이지의 연속 기록에 다른 구단 선수가 섞였다");
    assert.ok(teamT!.milestones.every((m) => m.playerId === "BAT_t"), "t 구단 페이지의 기록 근접에 다른 구단 선수가 섞였다");
    // g 페이지에는 g 선수만 — 반대편도 잰다(한쪽만 재면 우연히 맞은 것과 구별이 안 된다)
    assert.ok(teamG!.streaks.every((s) => s.playerId === "BAT_g"), "g 구단 페이지의 연속 기록에 다른 구단 선수가 섞였다");
    assert.ok(teamG!.milestones.every((m) => m.playerId === "BAT_g"), "g 구단 페이지의 기록 근접에 다른 구단 선수가 섞였다");
  });
});

/**
 * ⚠**M1 — 홈 화면과 값이 같아야 한다.** 팀 페이지가 다시 계산하면 두 화면이 갈릴 수 있다.
 * 필터링만 했다면 팀 페이지의 항목이 **홈의 부분집합**이어야 한다(같은 playerId 는 같은 값).
 */
test("팀 페이지의 연속 기록은 홈 화면 것을 거른 것과 값이 같다 — 다시 계산하지 않는다(M1)", async () => {
  await withDb((db) => {
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}`, `${c}球団の続巻`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }
    const centralDates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
    for (const d of centralDates) playedBoth(db, d, "t", "g");
    for (const d of centralDates.slice(0, 2)) playedBoth(db, d, "l", "m");

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });
    const teamT = site.teams.find((x) => x.teamCode === "t")!;
    const fromHome = site.home.streaks.find((s) => s.playerId === "BAT_t");
    const fromTeam = teamT.streaks.find((s) => s.playerId === "BAT_t");
    assert.notEqual(fromHome, undefined, "홈 화면에 t 선수의 연속 기록이 없다 — 시험이 공회전한다");
    assert.deepEqual(fromTeam, fromHome, "팀 페이지의 값이 홈 화면과 다르다 — 다시 계산했다는 뜻이다");
  });
});
