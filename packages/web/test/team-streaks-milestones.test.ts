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
 * 경기 한 개 — **한 팀에 타자를 여러 명** 남긴다.
 *
 * ⚠**`playedBoth`로는 「홈 상위 N에서 밀려난다」를 못 만든다.** 팀당 타자가 하나뿐이면
 * 후보가 최대 12명이라 홈의 상위 10명 안에 거의 다 들어가기 때문이다. 팀별 자르기를 재려면
 * **홈 한도를 넘길 만큼의 후보**가 있어야 한다.
 *
 * ⚠**홈/원정에 다른 인원을 줄 수 있다**(`awayBatters` 생략 시 `batters`와 같다 — 기존 호출은
 * 그대로 동작한다). 2026-08-19 검토에서 **「양 팀에 8명씩 균등 배분」로는 `TEAM_STREAK_ROWS`의
 * 하한(10)을 못 박지 못한다**는 것이 뮤테이션으로 드러났다 — playerId 오름차순 타이브레이크 때문에
 * 홈 상위 10이 두 팀에 8/2로 쪼개져, 「구단 페이지 행 수 ≥ 홈이 그 팀에 대해 낸 행 수」가
 * 최대 8만 요구하게 된다(`TEAM_STREAK_ROWS`를 10→8로 낮춰도 관련 시험 51본이 그대로 통과했다).
 * 하한 10을 실제로 요구하려면 **홈 상위 10 전부가 한 팀에 쏠려야** 한다 — 그러려면 그 팀 혼자
 * 10명 이상의 후보를 갖고, playerId가 상대 팀보다 전부 앞서야 한다.
 */
function playedWide(
  db: Db,
  date: string,
  home: string,
  away: string,
  batters: number,
  awayBatters: number = batters,
): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  for (const [side, code, n] of [
    ["home", home, batters],
    ["away", away, awayBatters],
  ] as const) {
    for (let i = 0; i < n; i += 1) {
      upsertBatting(db, {
        gameId, playerId: `BAT_${code}_${i}`, side, battingOrder: String(i + 1), position: "(遊)",
        pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
        sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
      });
    }
    upsertPitching(db, {
      gameId, playerId: `PIT_${code}`, side, decision: null,
      outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
    });
  }
}

/**
 * 경기 한 개 — **한쪽 투수만 무실점**으로 끝낸다.
 *
 * ⚠**`playedBoth` 는 양쪽 투수에게 `runs: 1` 을 준다** — 그러면 連続無失点登板 이 영영 안 생기고,
 * 「투수가 표에 실리는가」를 재는 시험이 **조용히 공회전한다.** 그래서 따로 만든다.
 */
function playedScoreless(db: Db, date: string, home: string, away: string, scoreless: "home" | "away"): void {
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
      outs: 3, bf: 3, pitches: 12, h: 0, hr: 0, bb: 0, hbp: 0, so: 1,
      runs: side === scoreless ? 0 : 1, er: side === scoreless ? 0 : 1, wp: 0, balk: 0,
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
    // ⚠55 → 500까지 445. **이것도 후보에는 들어간다** — `milestonesOf` 는 남은 수로 거르지
    //   않는다(西川 선례). 여기서는 t·g 페이지에 섞이지 않는 것만 재므로 상관없다
    career(db, "BAT_l", 50, 5);

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

/**
 * ⚠**「우리 팀엔 없다」가 거짓말이 되던 자리**(2026-08-19 실측).
 *
 * 처음 구현은 홈 화면이 **이미 상위 N으로 자른 배열**(연속 10명 · 근접 8명 · 전 리그 통합)을
 * `teamCode`로 거르기만 했다. 그래서 배포물이 이랬다 —
 * `b 1 · c 0 · d 0 · db 0 · e 2 · f 0 · g 0 · h 3 · l 2 · m 0 · s 1 · t 1`
 * → **12팀 중 6팀이 0건 · 최대 3건 · 합계 10건(= 홈 상위 10명 전부)**.
 * 구획 제목이 「続いている記録」인데 「ありません」이라고 쓰면, 그 팀 팬은
 * **「우리 팀엔 진행 중인 연속 기록이 없다」**로 읽는다. 실제로는 있었고 리그 상위 10명에
 * 못 든 것뿐이다 — **M11이 금지하는 「없음」과 「안 쟀음」의 혼동**이다.
 *
 * ⚠**기존 두 시험은 이걸 못 잡았다.** 「남의 팀이 안 섞인다」와 「홈과 값이 같다」만 재기
 * 때문이다 — 둘 다 **덜 나오는 것**에는 아무 말도 하지 않는다.
 *
 * 그래서 여기서는 **관계**를 잰다(선수 이름을 박지 않는다 — 데이터가 바뀌면 낡는다):
 * ⑴ 어떤 구단의 페이지 행 수 **≥** 그 구단이 홈 배열에서 차지한 행 수 — 홈이 그 팀에 대해
 *    보여주는 것을 구단 페이지가 빠뜨리면 안 된다(`TEAM_*_ROWS ≥ HOME_*_ROWS`의 근거).
 * ⑵ **적어도 한 구단에서는 진짜 부등호** — 그러지 않으면 「홈 배열 필터」와 구별되지 않는다.
 * ⑶ **홈에 한 명도 못 든 구단이 그래도 나온다** — 위 실측의 「6팀이 0건」 바로 그것.
 *
 * ⚠**뮤테이션(실측 확인)**:
 * ⒜ 팀별 상위 N → 홈 배열 필터로 복귀 → ⑵·⑶이 떨어진다.
 * ⒝ 팀별 한도를 1로 → ⑴이 떨어진다(홈에 10행을 가진 구단이 1행이 된다).
 * ⒞ `TEAM_STREAK_ROWS`를 10→9로 낮추면 → ⑴이 떨어진다(g: 구단 페이지 9행 < 홈이 낸 10행) —
 *   **이 하한(10)을 실제로 못 박는 것은 연속 쪽 픽스처뿐이다**(2026-08-19 검토 반영).
 *   근접 쪽은 `TEAM_MILESTONE_ROWS`를 8→7로 낮추면 이미 g 에서 같은 방식으로 떨어진다.
 */
test("⚠홈 상위 N에 못 든 구단 선수도 구단 페이지에는 나온다 — 팀별로 상위 N을 뽑는다", async () => {
  await withDb((db) => {
    /**
     * 센트럴 **g 에 10명 · t 에 8명** — 일부러 비대칭이다.
     * 홈 정렬은 `경기 수 내림차순 → playerId 오름차순`이고 전원이 5경기라 결국 playerId 순인데,
     * `BAT_g_*` < `BAT_t_*`(문자 비교)라 **g 10명이 홈 상위 10을 전부 채우고 t 는 한 명도 못 든다**.
     * ⚠**「각 8명씩 균등 배분」이었을 때는 이 하한(10)을 못 박지 못했다**(2026-08-19 검토에서
     * 뮤테이션으로 발견 — `TEAM_STREAK_ROWS`를 10→8로 낮춰도 51본이 그대로 통과했다).
     * 원인: 16명을 8/8로 나누면 홈 상위 10이 두 팀에 8/2로 쪼개져, 「구단 페이지 행 수 ≥ 홈이
     * 그 팀에 대해 낸 행 수」가 최대 8만 요구했다. 하한 10을 실제로 요구하려면 **홈 상위 10 전부가
     * 한 팀에 쏠려야** 하므로, 그 팀 혼자 10명 이상을 갖고 상대보다 playerId가 전부 앞서야 한다.
     */
    for (let i = 0; i < 10; i += 1) upsertPlayer(db, `BAT_g_${i}`, `g球団の続巻${i}`, NOW);
    upsertPlayer(db, "PIT_g", "g球団投手", NOW);
    for (let i = 0; i < 8; i += 1) upsertPlayer(db, `BAT_t_${i}`, `t球団の続巻${i}`, NOW);
    upsertPlayer(db, "PIT_t", "t球団投手", NOW);
    for (const c of ["l", "m"]) {
      upsertPlayer(db, `BAT_${c}_0`, `${c}球団の打者`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }

    const dates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
    // home=t(8명) · away=g(10명) — g 가 문자순으로 앞서므로 홈 상위 10을 전부 g 가 차지한다
    for (const d of dates) playedWide(db, d, "t", "g", 8, 10);
    // 파 리그는 리그 번들이 비지 않게 하는 목적뿐이다 — 2경기라 연속 기록 하한(5경기)에 못 미친다
    for (const d of dates.slice(0, 2)) playedWide(db, d, "l", "m", 1);

    /**
     * 통산 마디 — **g 8명이 근접, t 8명은 멀다.** 근접 정렬(남은 수 오름차순)에서
     * 홈 상위 8명이 **전부 g**가 되므로, t 는 홈에 **한 명도** 못 든다.
     * ⚠**근접은 연속과 다른 인원(g·t 각 8명)을 그대로 쓴다** — 이쪽은 이미 `TEAM_MILESTONE_ROWS`를
     * 7로 낮추면 정확히 떨어져 하한 8을 못 박고 있었다(검토자 실측). 손대지 않는다.
     */
    for (let i = 0; i < 8; i += 1) {
      career(db, `BAT_g_${i}`, 480 - i, 15); // 통산 495~488 → 500까지 5~12
      career(db, `BAT_t_${i}`, 455 - i, 15); // 통산 470~463 → 500까지 30~37
    }

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });

    // 공회전 방지 ① — 구단 페이지가 안 만들어지면 아래 루프가 조용히 0회 돈다
    assert.ok(site.teams.length >= 4, `구단 페이지가 ${site.teams.length}개뿐이다 — 시험이 공회전한다`);
    // 공회전 방지 ② — 홈 배열이 비면 「홈보다 많다」가 뜻을 잃는다
    assert.ok(site.home.streaks.length > 0, "홈의 연속 기록이 비었다 — 시험이 공회전한다");
    assert.ok(site.home.milestones.length > 0, "홈의 기록 근접이 비었다 — 시험이 공회전한다");

    let strictStreak = 0;
    let strictMilestone = 0;
    let shownDespiteHomeZero = 0;
    for (const team of site.teams) {
      const homeStreaks = site.home.streaks.filter((s) => s.teamCode === team.teamCode).length;
      const homeMilestones = site.home.milestones.filter((m) => m.teamCode === team.teamCode).length;

      // ⑴ 홈이 그 팀에 대해 보여주는 것을 구단 페이지가 빠뜨리면 안 된다
      assert.ok(
        team.streaks.length >= homeStreaks,
        `${team.teamCode}: 구단 페이지의 연속 기록 ${team.streaks.length}행 < 홈이 그 팀에 대해 낸 ${homeStreaks}행`,
      );
      assert.ok(
        team.milestones.length >= homeMilestones,
        `${team.teamCode}: 구단 페이지의 기록 근접 ${team.milestones.length}행 < 홈이 그 팀에 대해 낸 ${homeMilestones}행`,
      );

      if (team.streaks.length > homeStreaks) strictStreak += 1;
      if (team.milestones.length > homeMilestones) strictMilestone += 1;
      if (homeMilestones === 0 && team.milestones.length > 0) shownDespiteHomeZero += 1;
    }

    // ⑵ 적어도 한 구단에서 진짜 부등호 — 아니면 「홈 배열을 거른 것」과 구별되지 않는다
    assert.ok(
      strictStreak > 0,
      "어느 구단도 홈보다 많은 연속 기록을 못 냈다 — 홈 상위 N 배열을 거르기만 하고 있다",
    );
    assert.ok(
      strictMilestone > 0,
      "어느 구단도 홈보다 많은 기록 근접을 못 냈다 — 홈 상위 N 배열을 거르기만 하고 있다",
    );
    // ⑶ 홈에 한 명도 못 든 구단이 그래도 나온다 — 실측의 「12팀 중 6팀이 0건」 바로 그것
    assert.ok(
      shownDespiteHomeZero > 0,
      "홈 상위 N에 한 명도 못 든 구단이 여전히 0건이다 — 「この球団に記録に近づいている選手はありません」이 거짓말이 된다",
    );
  });
});

/**
 * ⚠**0건일 때의 「ありません」은 참이어야 한다**(M11·M12).
 *
 * 팀별로 뽑게 바꿨다고 「0건이 없어졌다」는 뜻이 아니다 — **정말 아무도 없는 팀**이 있고,
 * 그때 「この球団の続いている記録はありません」은 사실이다. 위 시험이 「더 나와야 한다」만
 * 재므로, 반대쪽(**없을 때는 없다고 한다**)을 여기서 못 박는다.
 */
test("정말 후보가 없는 구단은 0건이다 — 그때의 「ありません」은 참이다", async () => {
  await withDb((db) => {
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}_0`, `${c}球団の打者`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }
    // 두 리그 다 **2경기씩만** — 연속 기록 하한(5경기)에 아무도 못 미친다
    const dates = ["2026-08-11", "2026-08-12"];
    for (const d of dates) playedWide(db, d, "t", "g", 1);
    for (const d of dates) playedWide(db, d, "l", "m", 1);
    /**
     * 통산은 있지만 **今季가 0** — 근접 후보가 0명이다.
     * ⚠**「마디에서 멀다」로는 0이 안 된다.** `milestonesOf` 는 남은 수로 거르지 않는다
     * (西川 선례 — 근접이 이 구획의 정의라 근접으로만 고른다). 통산 55안타도 「500까지 445」로
     * 후보에 들어간다. 실제로 거르는 조건은 **`thisSeason > 0`** 뿐이다.
     */
    for (const c of ["t", "g", "l", "m"]) career(db, `BAT_${c}_0`, 50, 0);

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });

    assert.ok(site.teams.length >= 4, `구단 페이지가 ${site.teams.length}개뿐이다 — 시험이 공회전한다`);
    // 전제: 홈도 0건이어야 이 시험이 「없는 것을 없다고 한다」를 재는 것이 된다
    assert.equal(site.home.streaks.length, 0, "픽스처가 의도와 달리 홈에 연속 기록을 만들었다");
    assert.equal(site.home.milestones.length, 0, "픽스처가 의도와 달리 홈에 기록 근접을 만들었다");
    for (const team of site.teams) {
      assert.equal(team.streaks.length, 0, `${team.teamCode}: 후보가 없는데 연속 기록이 나왔다`);
      assert.equal(team.milestones.length, 0, `${team.teamCode}: 후보가 없는데 기록 근접이 나왔다`);
    }
  });
});

/**
 * ⚠**「続いている記録」이 조용히 「打者の記録」을 뜻하고 있었다**(2026-09-07) —
 * `blocks.ts` 의 「打者のみ」와 같은 모양의 결함이다. 이 시험은 **`loadSite` 를 실제로 돌려**
 * 투수의 連続無失点登板 이 홈·구단 표에 실리는지를 잰다(렌더러만 재면 배선이 빠져도 초록이다).
 *
 * ⚠**타자의 「최신 경기일에 출장」 조건을 그대로 쓰지 않는다.** 구원투수는 매일 안 던진다 —
 * 실측(2026 · 로컬 DB): 진행 중 마루 5등판 이상 37명 중 **최신 경기일 등판은 9명**뿐이다.
 * 이 픽스처의 투수도 **마지막 경기일에 안 던진다** — 그래도 실려야 한다.
 */
test("⚠투수의 連続無失点登板이 홈·구단 표에 실린다 — 마지막 경기일에 안 던져도 실린다", async () => {
  await withDb((db) => {
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}`, `${c}球団の続巻`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }
    // t 의 투수는 5경기 연속 무실점, g 의 투수는 매번 1실점
    const dates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
    for (const d of dates) playedScoreless(db, d, "t", "g", "home");
    for (const d of dates.slice(0, 2)) playedBoth(db, d, "l", "m");
    // ⚠**최신 경기일에는 t 가 안 뛴다** — 그날 등판이 없어도 기록은 안 끊긴다는 것이 요지다.
    //   `playedBoth` 로 t 를 한 번 더 넣으면 `PIT_t` 에게 1실점이 붙어 마루가 끊긴다
    playedBoth(db, "2026-08-16", "l", "m");

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });
    const rows = site.home.streaks.filter((s) => s.kind === "scorelessAppearances");
    assert.equal(rows.length, 1, `투수 행이 1개여야 한다(실제 ${rows.length}) — 픽스처가 공회전하거나 실점 투수가 섞였다`);
    assert.equal(rows[0]!.playerId, "PIT_t");
    assert.equal(rows[0]!.games, 5, "連続無失点登板 이 5가 아니다");
    // ⚠**마지막 등판일이 최신 경기일(8/16)이 아니다** — 그래도 실렸다는 것이 이 시험의 요지다
    assert.equal(rows[0]!.lastGameDate, "2026-08-15");
    assert.equal(site.home.latest?.date ?? null, "2026-08-16");

    // 구단 페이지에도 같은 행이 간다 — 다시 계산하지 않는다(M1)
    const teamT = site.teams.find((x) => x.teamCode === "t")!;
    const mine = teamT.streaks.filter((s) => s.kind === "scorelessAppearances");
    assert.deepEqual(mine, rows, "구단 페이지의 투수 행이 홈의 것과 다르다");
    const teamG = site.teams.find((x) => x.teamCode === "g")!;
    assert.equal(
      teamG.streaks.filter((s) => s.kind === "scorelessAppearances").length,
      0,
      "실점한 투수가 구단 표에 실렸다",
    );
  });
});

/**
 * ⚠**하한은 정한 값이고, 정했다는 것을 시험이 고정한다**(M3).
 * `HOME_PITCHING_STREAK_MIN = 5` — 근거는 `query.ts` 의 그 상수 주석(실측 분포)에 있다.
 */
test("⚠하한 미만의 투수는 표에 안 실린다 — 정한 값이 실제로 걸린다", async () => {
  await withDb((db) => {
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}`, `${c}球団の続巻`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}球団投手`, NOW);
    }
    // 4등판뿐 — 하한(5)에 하나 모자란다
    const dates = ["2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
    for (const d of dates) playedScoreless(db, d, "t", "g", "home");
    for (const d of dates.slice(0, 2)) playedBoth(db, d, "l", "m");

    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });
    assert.equal(
      site.home.streaks.filter((s) => s.kind === "scorelessAppearances").length,
      0,
      "하한 미만인데 실렸다 — 하한이 실제로 안 걸린다",
    );
  });
});
