/**
 * 通算成績이 **DB에서 화면까지** 온전히 도착하는가.
 *
 * ⚠**이 시험이 없어서 하루에 P0가 셋 나갔다**(2026-08-17 이중 검토).
 * 그날 붙인 시험은 전부 **손으로 만든 픽스처를 렌더러에 직접 넣는 것**이라
 * `careerOf`·`milestonesOf` 를 **한 줄도 태우지 않았다.** 그래서
 * 「통산을 우리 집계로 갈아끼우는」 변경이 들어가도, 그 변경이 만든 결함
 * (試合 정의 뒤섞임 · 盗塁刺 소실 · 아카이브 시즌의 「今シーズン」 거짓말)이
 * **1,180본 전부 초록인 채로** 통과했다.
 *
 * ⚠**그래서 여기서는 실제 DB를 만든다.** 계약이 깨지는 곳은 계산이 아니라
 * **DB → 화면 경계**였고, 시험도 그 경계에 둔다(`trade-site.test.ts` 와 같은 이유).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { loadSite } from "../src/query.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HITTER = "HIT1";
const PITCHER = "PIT1";
/**
 * ⚠**취득 시각은 적재 시각과 다르다.** 일부러 엿새 벌려 둔다.
 * ⚠**UTC 로 자르면 8/10, JST 로는 8/11 이 되는 시각을 고른다.**
 *   처음 픽스처는 `02:00Z`(JST 로도 같은 날)라 **타임존을 틀려도 시험이 초록**이었다 —
 *   실제로 화면이 UTC 날짜를 내보내고 있었는데 못 잡았다(2026-08-17 재검토 P0).
 */
const FETCHED = "2026-08-10T23:00:00.000Z";

/**
 * 年度別成績 한 줄을 넣는다.
 *
 * ⚠`@bb-app/store` 에 이 표의 upsert 가 없다(적재 도구가 직접 SQL 을 쓴다).
 * 그래서 여기서도 직접 쓴다 — 시험이 검사하려는 것은 **읽는 쪽**이다.
 */
function career(
  db: Db,
  o: { year: number; team: string; games: number; pa: number; ab: number; h: number; hr: number; sb: number; cs: number; seq?: number },
): void {
  db.raw
    .prepare(
      `INSERT INTO career_batting
         (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
          sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, 0, 0, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?)`,
    )
    .run(
      HITTER, o.year, o.team, o.games, o.pa, o.ab, o.h, o.hr, o.sb, o.cs,
      "npb.jp/bis/players (年度別成績)", FETCHED, o.seq ?? 0,
    );
}

/**
 * 年度別成績(투구) 한 줄.
 *
 * ⚠**투구 쪽에 시험이 저장소 전체에 0본이었다**(2026-08-17 재검토 P1).
 * 그래서 `careerOf` 의 투구 질의를 `year < ?` 로 되돌려도, 마디의 `yw`/`yso`/`ysv` 를
 * 서로 바꿔치기해도 **전부 초록**이었다 — 방금 고친 결함군이 투구 쪽에서 그대로 재발할 수 있었다.
 */
function careerPit(
  db: Db,
  o: { year: number; team: string; games: number; w: number; l: number; sv: number; outs: number; so: number },
): void {
  db.raw
    .prepare(
      `INSERT INTO career_pitching
         (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf, outs,
          h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, ?, 0, 0, 0, 0, ?, ?, 0)`,
    )
    .run(
      PITCHER, o.year, o.team, o.games, o.w, o.l, o.sv, o.outs, o.so,
      "npb.jp/bis/players (年度別成績)", FETCHED,
    );
}

let seq = 0;
function play(db: Db, date: string, season: number, pa: number, h: number): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season, gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId: HITTER, side: "home", battingOrder: "1", position: "(遊)",
    pa, ab: pa, h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: "PIT1", side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

async function withSite(
  season: number,
  fn: (site: ReturnType<typeof loadSite>) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-career-site-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, HITTER, "通算太郎", NOW);
    upsertPlayer(db, PITCHER, "投手", NOW);
    /**
     * ⚠**우리 집계와 NPB 공표치를 일부러 어긋나게 둔다.**
     * 실제로 어긋나는 열이 있기 때문이다 — `試合` 은 NPB 가 「출장한 경기」,
     * 우리가 「타석이 있던 경기」다(실측: 1,777쌍 중 569쌍 어긋남, 전부 NPB 가 컸다).
     * 여기서는 NPB 2026 = **20試合**, 우리 경기 = **2試合**로 둔다.
     * 갈아끼우는 코드가 들어오면 이 차이가 시험을 빨갛게 만든다.
     */
    career(db, { year: 2024, team: "阪 神", games: 100, pa: 400, ab: 350, h: 98, hr: 12, sb: 3, cs: 2 });
    career(db, { year: 2025, team: "阪 神", games: 130, pa: 550, ab: 500, h: 150, hr: 20, sb: 5, cs: 4 });
    career(db, { year: 2026, team: "阪 神", games: 20, pa: 80, ab: 70, h: 25, hr: 3, sb: 1, cs: 1 });
    // 투구도 넣는다 — 우리 집계는 2등판, NPB 는 50등판으로 **일부러 다르게** 둔다
    // ⚠**2024년 행이 있어야 아카이브 시즌 시험이 실제로 돈다** — 없으면 career 가 null 이라
    //   그 시험이 조용히 건너뛰어지고, 연도 상한을 없애도 초록이었다(뮤테이션으로 확인)
    careerPit(db, { year: 2024, team: "阪 神", games: 30, w: 4, l: 6, sv: 0, outs: 200, so: 55 });
    careerPit(db, { year: 2025, team: "阪 神", games: 45, w: 8, l: 5, sv: 2, outs: 300, so: 90 });
    careerPit(db, { year: 2026, team: "阪 神", games: 50, w: 9, l: 4, sv: 3, outs: 330, so: 110 });
    play(db, "2026-07-01", 2026, 4, 2);
    play(db, "2026-07-02", 2026, 4, 1);
    // ⚠**아카이브 시즌 화면을 검사하려면 그 시즌의 경기가 있어야 한다** — 없으면 선수 페이지 자체가 없다
    play(db, "2024-07-01", 2024, 4, 2);
    fn(loadSite(db, { season, builtOn: "2026-08-16" }));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠通算表는 NPB 공표치 한 벌이다 — 올해 행을 우리 집계로 갈아끼우지 않는다", async () => {
  await withSite(2026, (site) => {
    const p = site.players.find((x) => x.playerId === HITTER)!;
    const row = p.career!.batting.find((r) => r.year === 2026)!;
    assert.notEqual(row, undefined, "올해 행이 없다");
    /**
     * ⚠**여기가 핵심이다.** 우리 경기 데이터는 2경기 8타석 3안타인데
     * 이 표에는 NPB 값(20試合 80打席 25安打)이 나와야 한다.
     * 갈아끼우면 `20` 이 `2` 가 되어 실패한다.
     */
    assert.equal(row.games, 20, "試合를 우리 집계(2)로 갈아끼웠다 — 정의가 다른 열이다");
    assert.equal(row.faced, 80, "打席를 우리 집계로 갈아끼웠다");
    assert.match(row.line, /25安打/, "安打를 우리 집계로 갈아끼웠다");
    // ⚠**盗塁刺가 살아 있어야 한다** — 갈아끼우면 이 값이 통째로 사라진다
    assert.match(row.line, /1盗塁1刺/, "올해 행의 盗塁刺가 사라졌다");
  });
});

test("⚠통산 합계에 盗塁刺가 들어간다 — 반쪽짜리 합계를 내지 않는다", async () => {
  await withSite(2026, (site) => {
    const p = site.players.find((x) => x.playerId === HITTER)!;
    // 3 + 5 + 1 = 9盗塁 · 2 + 4 + 1 = 7刺
    assert.match(p.career!.battingTotal!, /9盗塁7刺/, "통산 도루자가 빠졌다");
    // 100 + 130 + 20 = 250試合
    assert.match(p.career!.battingTotal!, /250試合/, "통산 試合 합계가 NPB 정의가 아니다");
  });
});

/**
 * ⚠**아카이브 시즌 화면은 그 시즌까지만 싣는다.**
 * 배포는 `2026,2025,2024,2023` 을 **같은 코드로** 돌린다 — 조건이 없으면
 * 2024년 화면이 2026년 행까지 싣는다(예전에는 연도 조건이 아예 없었다).
 */
test("⚠2024년 화면의 通算表에 2025·2026년 행이 없다", async () => {
  await withSite(2024, (site) => {
    const p = site.players.find((x) => x.playerId === HITTER)!;
    const years = p.career!.batting.map((r) => r.year);
    assert.deepEqual(years, [2024], `그 시즌 뒤의 행이 실렸다: ${years.join(",")}`);
    assert.equal(p.career!.to, 2024);
    // 합계도 그 해까지다
    assert.match(p.career!.battingTotal!, /100試合/, "합계가 그 시즌까지가 아니다");
  });
});

/**
 * ⚠**취득 시각은 적재 시각이 아니다**(M4).
 *
 * 적재는 매일 돌지만 페이지는 **다시 받지 않으면 그대로**다. 적재 시각을 넣으면
 * 8월 10일에 받은 페이지가 매일 「오늘 받은 것」이 되고, 낡은 값이 낡은 줄 모르고 나간다.
 * 실제로 그 상태였고, 그 결과 **「NPB 가 늦다」고 오진**했다(2026-08-17).
 */
test("⚠通算表가 「언제 받은 것인가」를 적재 시각이 아니라 취득 시각으로 말한다(M4)", async () => {
  await withSite(2026, (site) => {
    const p = site.players.find((x) => x.playerId === HITTER)!;
    assert.equal(p.career!.asOf, "2026-08-11", "JST 날짜가 아니다(UTC 로 자르면 8/10 이다)");
    assert.notEqual(p.career!.asOf, "2026-08-16", "적재 시각을 취득 시각이라고 했다");
  });
});

/**
 * ⚠**마디의 「통산」과 「今季」는 같은 표에서 온다.**
 * 출처가 갈리면 기준일이 달라 **한 줄 안에서 뺄셈이 안 맞는다**
 * (실측: 통산 90 · 今季 13 인데 작년까지가 78이었다).
 */
test("⚠마디의 통산 − 今季 = 작년까지 가 성립한다 — 우리 경기 데이터를 섞지 않는다", async () => {
  await withSite(2026, (site) => {
    const m = site.home.milestones.find((x) => x.playerId === HITTER && x.label === "通算安打");
    assert.notEqual(m, undefined, "마디에 나오지 않는다");
    // 98 + 150 + 25 = 273安打 · 今季 25 · 작년까지 248
    assert.equal(m!.count, 273, "통산 안타가 年度別成績 합계가 아니다");
    /**
     * ⚠**우리 경기 데이터는 3안타다.** 여기가 3이면 우리 쪽을 섞은 것이고,
     * 그러면 `count − thisSeason` 이 작년까지(248)와 어긋난다.
     */
    assert.equal(m!.thisSeason, 25, "今季를 우리 경기 데이터에서 가져왔다");
    assert.equal(m!.count - m!.thisSeason, 248, "뺄셈이 작년까지와 맞지 않는다");
  });
});

test("⚠投球 通算表도 NPB 공표치 한 벌이다 — 여기도 갈아끼우지 않는다", async () => {
  await withSite(2026, (site) => {
    const p = site.players.find((x) => x.playerId === PITCHER)!;
    const row = p.career!.pitching.find((r) => r.year === 2026)!;
    assert.notEqual(row, undefined, "투구 올해 행이 없다");
    // 우리 경기 데이터는 3등판인데 NPB 는 50등판이다
    assert.equal(row.games, 50, "登板을 우리 집계로 갈아끼웠다");
    assert.match(row.line, /9勝4敗/, "승패를 우리 집계로 갈아끼웠다");
    assert.match(row.line, /110奪三振/, "탈삼진을 우리 집계로 갈아끼웠다");
    // 통산 합계 45 + 50 = 95登板 · 8 + 9 = 17勝
    assert.match(p.career!.pitchingTotal!, /125登板/, "투구 통산 합계가 틀렸다");
    assert.match(p.career!.pitchingTotal!, /21勝15敗/, "투구 통산 승패가 틀렸다");
  });
});

test("⚠2024년 화면의 投球 通算表에도 2025·2026년 행이 없다", async () => {
  await withSite(2024, (site) => {
    const p = site.players.find((x) => x.playerId === PITCHER)!;
    assert.notEqual(p, undefined, "2024년 화면에 투수가 없다 — 시험이 조용히 건너뛰어진다");
    const years = p.career!.pitching.map((r) => r.year);
    assert.deepEqual(years, [2024], `그 시즌 뒤의 행이 실렸다: ${years.join(",")}`);
    // 합계도 그 해까지다(30登판 · 4승)
    assert.match(p.career!.pitchingTotal!, /30登板/, "합계가 그 시즌까지가 아니다");
  });
});

/**
 * ⚠**마디의 투수 항목도 같은 표에서 온다.** 타자 쪽만 시험하면 투수 쪽 출처 혼합을 못 잡는다.
 */
test("⚠마디의 投球 통산 − 今季 = 작년까지 가 성립한다", async () => {
  await withSite(2026, (site) => {
    const m = site.home.milestones.find((x) => x.playerId === PITCHER && x.label === "通算奪三振");
    assert.notEqual(m, undefined, "투수 마디가 나오지 않는다");
    // 90 + 110 = 200奪三振 · 今季 110 · 작년까지 90
    assert.equal(m!.count, 255, "통산 탈삼진이 年度別成績 합계가 아니다");
    assert.equal(m!.thisSeason, 110, "今季를 우리 경기 데이터에서 가져왔다");
    assert.equal(m!.count - m!.thisSeason, 145, "뺄셈이 작년까지와 맞지 않는다");
  });
});
