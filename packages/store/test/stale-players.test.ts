/**
 * **다시 받아야 할 선수**를 고르는 SQL.
 *
 * ⚠**이 SQL 하나가 통산 기록의 신선도를 지키는 유일한 장치다.** 그런데 처음 넣었을 때
 * 시험이 0본이었고, 이중 검토가 **그 상태에서 결함 셋을 찾아냈다**(2026-08-17):
 * · UTC 절단과 JST 경기일을 비교하고 있었다 — 크론 시각의 우연으로만 맞았다
 * · 「취득 시각을 모르는 선수」 분기가 **죽어 있었다**(적재가 `?? nowIso` 로 메워서)
 * · 「받을 수 없는 선수」(이탈자)가 매일 몫의 앞자리를 먹고 있었다
 * 셋 다 「읽으면 맞아 보이는」 종류라, 시험이 없으면 다음에도 못 잡는다.
 *
 * ⚠**그리고 넷째가 2026-08-20 에 나왔다 — 시험이 있어도 못 잡았다.**
 * 여기 있던 시험은 전부 **날짜 판정**만 재고 있었고, 그 판정의 전제(「경기 다음날이면 실려 있다」)를
 * **아무도 재지 않았다.** 전제는 틀렸다 — **08-19 01:05 JST 에 받은 페이지가 08-18 경기를
 * 담고 있지 않았다.** 그래서 「출장 다음날에 받았지만 그 경기가 없는 사본」이 영원히 최신으로
 * 판정됐다. 실측 피해: 통산행을 가진 **1,643명 중 264명**이 그 상태였고 옛 판정식은
 * **그중 0명**을 뽑았다. 아래 「사본에 내용이 모자라면」 시험들이 그 갈래를 못 박는다.
 *
 * ⚠**도구를 프로세스로 띄워서 잰다.** SQL 을 시험 안에 복사하면 도구가 바뀌어도 시험은 초록이다 —
 * 그건 시험이 아니라 사본이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "../src/index.ts";
import type { Db } from "../src/index.ts";
import type { Competition } from "@bb-app/domain";

const NOW = "2026-08-20T00:00:00.000Z";
const TOOL = fileURLToPath(new URL("../tools/emit-stale-player-ids.ts", import.meta.url));

let seq = 0;
/**
 * 한 경기를 넣고 그 선수의 타격 기록을 붙인다.
 *
 * ⚠`pa` 를 열어 둔다 — **대주자·守備固め는 出場試合만 늘리고 打席는 안 늘린다.**
 * 실측(CI DB · 2026 정규시즌): `pa=0` 인 출장 기록이 **3,431행**이다.
 * ⚠`competition` 을 열어 둔다 — 年度別成績 은 **정규시즌**이라 올스타를 섞으면 우리가 더 커지고,
 * 그러면 전 선수가 **영구 후보**가 된다(L1).
 */
function play(
  db: Db,
  playerId: string,
  date: string,
  opts: { pa?: number; competition?: Competition; pitcherId?: string } = {},
): void {
  seq += 1;
  const gameId = `g${seq}`;
  const pa = opts.pa ?? 4;
  upsertGame(db, {
    gameId, season: Number(date.slice(0, 4)), gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
    status: "played", notPlayedReason: null, competition: opts.competition ?? "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId, side: "home", battingOrder: "1", position: "(遊)",
    pa, ab: pa, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: opts.pitcherId ?? "PIT", side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

/**
 * `career_batting` 에 한 줄을 넣는다. `fetchedAt === null` 이면 「모른다」.
 * ⚠`games`·`pa` 를 열어 둔다 — **이 두 수가 「사본이 무엇을 담았는가」를 말한다.**
 */
function career(
  db: Db,
  playerId: string,
  fetchedAt: string | null,
  o: { year?: number; games?: number; pa?: number } = {},
): void {
  db.raw
    .prepare(
      `INSERT INTO career_batting
         (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
          sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
       VALUES (?, ?, '阪 神', ?, ?, ?, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'npb', ?, 0)`,
    )
    .run(playerId, o.year ?? 2026, o.games ?? 1, o.pa ?? 4, o.pa ?? 4, fetchedAt);
}

/** `career_pitching` 의 그 해 등판 試合 */
function careerPit(db: Db, playerId: string, fetchedAt: string | null, o: { year?: number; games?: number } = {}): void {
  db.raw
    .prepare(
      `INSERT INTO career_pitching
         (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf, outs,
          h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq)
       VALUES (?, ?, '阪 神', ?, 0, 0, 0, 0, 0, 0, 0, 0, 28, 21, 5, 0, 2, 0, 7, 0, 0, 1, 1, 'npb', ?, 0)`,
    )
    .run(playerId, o.year ?? 2026, o.games ?? 1, fetchedAt);
}

interface Run {
  ids: string[];
  /** 사유별 보고. ⚠**합계만 재면 어느 갈래가 죽어도 안 보인다**(M7) */
  report: string;
}

async function withDb(fn: (dbPath: string, db: Db) => void): Promise<Run> {
  const dir = await mkdtemp(join(tmpdir(), "bb-stale-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath, NOW);
  try {
    fn(dbPath, db);
  } finally {
    db.close();
  }
  const r = spawnSync(process.execPath, [TOOL, dbPath, "--limit", "400"], { encoding: "utf8" });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, `도구가 실패했다: ${r.stderr}`);
  return {
    ids: r.stdout.split("\n").map((x) => x.trim()).filter((x) => x !== ""),
    report: r.stderr,
  };
}

test("⚠취득 시각을 모르는 선수는 반드시 대상이다 — 「모른다」를 「최신」으로 읽지 않는다(M11)", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "UNKNOWN", "取得不明", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "UNKNOWN", "2026-08-16");
    career(db, "UNKNOWN", null);
  });
  assert.ok(ids.includes("UNKNOWN"), "취득 시각을 모르는 선수를 빠뜨렸다");
});

test("페이지를 출장 이후에 받았고 그 경기가 실려 있으면 대상이 아니다 — 헛되이 다시 치지 않는다(L1)", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "FRESH", "最新", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "FRESH", "2026-08-16");
    // JST 8/17 08:00 에 받았고, 8/16 경기가 실려 있다(1試合 4打席)
    career(db, "FRESH", "2026-08-16T23:00:00.000Z", { games: 1, pa: 4 });
  });
  assert.ok(!ids.includes("FRESH"), "이미 최신인 선수를 다시 받으려 한다");
});

/**
 * ⚠**타임존이 이 판정을 뒤집는다.**
 * `2026-08-16T20:00:00Z` 는 **JST 8/17 05:00** 이다. UTC 로 자르면 `08-16` 이 되어
 * 「경기 당일에 받았다 → 다시 받아야 한다」로 잘못 읽는다. JST 로 자르면 `08-17` 이라 대상이 아니다.
 * ⚠**이 시험이 없으면 UTC/JST 혼용이 조용히 산다** — 지금 크론(02:00 JST)에서는 우연히 맞기 때문이다.
 */
test("⚠날짜는 JST 로 센다 — UTC 로 자르면 하루 어긋나 헛되이 다시 친다(§2-1)", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "TZ", "時差", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "TZ", "2026-08-16");
    career(db, "TZ", "2026-08-16T20:00:00.000Z", { games: 1, pa: 4 }); // JST 2026-08-17 05:00
  });
  assert.ok(!ids.includes("TZ"), "UTC 로 잘라서 하루 이르게 봤다");
});

/**
 * ⚠**경기 당일 낮에 받은 페이지에는 그날 경기가 없다.**
 * 「받은 날 == 마지막 출장일」이면 아직 그 경기가 안 들어온 것이라 다시 받아야 한다.
 * ⚠**이 갈래는 사본의 내용과 무관하게 성립한다** — 그래서 날짜 판정을 지우지 않고 남겼다.
 */
test("⚠받은 날과 마지막 출장일이 같으면 대상이다 — 그 페이지엔 그날 경기가 없다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "SAMEDAY", "当日", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "SAMEDAY", "2026-08-16");
    career(db, "SAMEDAY", "2026-08-16T03:00:00.000Z", { games: 1, pa: 4 }); // JST 8/16 12:00
  });
  assert.ok(ids.includes("SAMEDAY"), "경기 당일 낮에 받은 페이지를 최신으로 봤다");
});

/**
 * ⚠**받을 수 없는 선수가 매일 몫을 먹으면 진짜 대상이 굶는다.**
 * 실측(CI DB · 2026-08-20): 최근 400일 미출장이라 제외된 선수가 **810명**이고
 * 마지막 출장 연도가 2018~2025 에 고르게 퍼져 있다.
 * 선수 페이지는 현재 등록 선수만 확실히 받을 수 있어 이들은 받아도 안 온다 —
 * 소급 시즌을 넣을수록 이 무리가 시즌당 100명 넘게 늘어 상한을 통째로 잠식한다.
 */
test("⚠오래 안 뛴 선수는 제외한다 — 그건 백필의 일이지 신선도 유지의 일이 아니다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "GONE", "離脱", NOW);
    upsertPlayer(db, "ACTIVE", "現役", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "GONE", "2023-05-01");
    play(db, "ACTIVE", "2026-08-16");
    career(db, "ACTIVE", null);
    // GONE 은 통산 행 자체가 없다 — 옛 코드라면 「취득기록 없음」으로 맨 앞에 뽑혔다
  });
  assert.ok(!ids.includes("GONE"), "3년 전에 떠난 선수를 매일 다시 받으려 한다");
  assert.ok(ids.includes("ACTIVE"), "현역 선수를 빠뜨렸다");
});

/**
 * ⚠⚠**이 시험이 이 라운드의 이유다**(2026-08-20).
 *
 * npb.jp 는 경기 다음날 새벽에도 그 경기를 아직 안 싣는다 —
 * **실측: 08-19 01:05 JST 에 받은 페이지가 08-18 경기를 담고 있지 않았다.**
 * 그런데 옛 판정식은 「받은 날 > 마지막 출장일」이면 최신이라고 단정했다.
 * → 그 선수가 **그 뒤로 안 뛰면 그 경기는 영영 안 실린다.**
 *   시즌 최종전 출장자 전원 · 은퇴 선수가 그 상태가 되고,
 *   화면의 `通算成績` 과 `記録に近づいている`(마디까지 남은 수)가 실제보다 크게 나간다.
 *
 * ⚠**옛 코드에서 반드시 떨어진다**(작업규칙 9): 취득일(08-19) > 마지막 출장일(08-18)이라
 * 날짜 판정만으로는 이 선수가 선정되지 않는다.
 */
test("⚠⚠출장 다음날에 받았어도 그 경기가 사본에 없으면 대상이다 — 안 그러면 영영 안 실린다", async () => {
  const { ids, report } = await withDb((_p, db) => {
    upsertPlayer(db, "LAGGED", "反映遅れ", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "LAGGED", "2026-08-17");
    play(db, "LAGGED", "2026-08-18");
    // 08-19 01:05 JST 에 받았는데 **08-17 경기까지만** 실려 있다(1試合 4打席)
    career(db, "LAGGED", "2026-08-18T16:05:00.000Z", { games: 1, pa: 4 });
  });
  assert.ok(ids.includes("LAGGED"), "출장 다음날에 받은 낡은 사본을 최신으로 봤다 — 이 경기는 영영 안 실린다");
  assert.match(report, /출장량 부족 1명/, "사유별 보고가 「출장량 부족」을 안 셌다 — 갈래가 죽어도 안 보인다(M7)");
});

/**
 * ⚠**打席만 보면 이 선수를 놓친다.** 대주자·守備固め는 出場試合만 늘리고 打席는 안 늘린다.
 * 실측(CI DB · 2026 정규시즌): `pa=0` 출장 기록 **3,431행** ·
 * 打席만 보면 낡은 타자가 171명인데 **試合를 같이 보면 179명**이다.
 *
 * ⚠**타자 試合는 「같다」를 요구하면 안 된다.** 공표는 **出場試合**이고 우리는
 * **打撃記録のある試合**이라 공표가 더 큰 것이 정상이다(완결 8시즌 실측 2,066건).
 * 요구할 수 있는 것은 **「공표가 더 적을 수 없다」**뿐이고, 그건 실측으로 0/5,509 다.
 */
test("⚠打席가 안 늘어난 출장도 잡는다 — 대주자·守備固め는 出場試合만 늘린다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "PINCHRUN", "代走", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "PINCHRUN", "2026-08-17", { pa: 4 });
    play(db, "PINCHRUN", "2026-08-18", { pa: 0 }); // 대주자 — 打席 0
    // 사본은 1試合 4打席 — 打席는 맞는데 試合가 모자라다
    career(db, "PINCHRUN", "2026-08-18T16:05:00.000Z", { games: 1, pa: 4 });
  });
  assert.ok(ids.includes("PINCHRUN"), "打席만 보고 넘어갔다 — 出場試合가 모자란 사본이다");
});

/** 투수는 登板試合로 판정한다 — 투수는 `batting_line` 에 안 나오는 경기가 있다 */
test("⚠투수는 登板試合가 모자라면 대상이다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "STARTER", "投手", NOW);
    upsertPlayer(db, "BAT", "打者", NOW);
    play(db, "BAT", "2026-08-17", { pitcherId: "STARTER" });
    play(db, "BAT", "2026-08-18", { pitcherId: "STARTER" });
    careerPit(db, "STARTER", "2026-08-18T16:05:00.000Z", { games: 1 }); // 2등판 중 1등판만 실렸다
    career(db, "BAT", "2026-08-18T16:05:00.000Z", { games: 2, pa: 8 }); // 타자 쪽은 최신
  });
  assert.ok(ids.includes("STARTER"), "登板試合가 모자란 투수를 빠뜨렸다");
  assert.ok(!ids.includes("BAT"), "최신인 타자를 같이 뽑았다");
});

/**
 * ⚠**그 해 행이 아예 없으면 조인할 상대가 없어 위 비교가 한 번도 안 돈다**(M7의 조용한 통과).
 * 실측(CI DB): 3명이 여기 걸렸고 셋 다 2026 출장이 08-18·08-19 하루뿐인 선수였다 —
 * 딱 반영 지연이다. 이 갈래가 없으면 **데뷔전을 뛴 선수의 사본이 영영 안 갱신된다.**
 */
test("⚠사본에 그 해 행이 아예 없으면 대상이다 — 조인이 안 돌아 조용히 통과한다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "DEBUT", "初出場", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "DEBUT", "2026-08-18");
    // 사본은 08-19 에 받았지만 2025 행까지만 있다
    career(db, "DEBUT", "2026-08-18T16:05:00.000Z", { year: 2025, games: 100, pa: 400 });
  });
  assert.ok(ids.includes("DEBUT"), "그 해 행이 없는 사본을 최신으로 봤다");
});

/**
 * ⚠⚠**영구 루프를 만들지 않는다**(L1).
 *
 * 「공표 ≠ 우리」로 판정하면 **정의 차이와 보유 시즌 밖이 전부 후보가 되어 매일 영원히** 다시 친다.
 * · 타자 出場試合 은 우리 打撃記録のある試合보다 **항상 크거나 같다**(실측 2,066건이 더 크다)
 * · 2017 이전은 우리가 경기를 안 갖고 있어 공표만 있다
 * → 그래서 방향을 하나로 못 박는다: **「공표가 우리보다 적을 때」만** 낡음이다.
 */
test("⚠⚠공표가 우리보다 많으면 대상이 아니다 — 방향을 안 못 박으면 전원이 영구 후보가 된다", async () => {
  const { ids, report } = await withDb((_p, db) => {
    upsertPlayer(db, "AHEAD", "定義差", NOW);
    upsertPlayer(db, "OLD", "保有外", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "AHEAD", "2026-08-16", { pa: 4 });
    // 出場試合 5 · 打席 20 — 공표가 더 크다(대주자 출장 등 정의 차이)
    career(db, "AHEAD", "2026-08-16T23:00:00.000Z", { games: 5, pa: 20 });
    play(db, "OLD", "2026-08-16", { pa: 4 });
    career(db, "OLD", "2026-08-16T23:00:00.000Z", { games: 1, pa: 4 });
    // 우리가 안 가진 시즌 — 공표만 있다
    career(db, "OLD", "2026-08-16T23:00:00.000Z", { year: 2015, games: 120, pa: 500 });
  });
  assert.ok(!ids.includes("AHEAD"), "공표가 더 큰 것을 낡음으로 읽었다 — 이 선수는 매일 영원히 다시 받힌다");
  assert.ok(!ids.includes("OLD"), "보유 시즌 밖의 공표행을 낡음으로 읽었다");
  assert.match(report, /출장량 부족 0명/, "출장량 부족을 0으로 안 셌다");
});

/**
 * ⚠**年度別成績은 정규시즌이다**(§2-1). 올스타·CS 를 우리 쪽에 섞으면 우리가 더 커져서
 * 그 경기에 나온 선수 전원이 **영구 후보**가 된다. CLAUDE.md 가 도루에서 같은 함정을 적어 뒀다
 * (「올스타를 넣으면 2026 도루가 620이 되어 9 어긋난다」).
 */
test("⚠올스타는 대조에서 뺀다 — 섞으면 그 경기 출장자가 전원 영구 후보가 된다", async () => {
  const { ids } = await withDb((_p, db) => {
    upsertPlayer(db, "ALLSTAR", "球宴", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    play(db, "ALLSTAR", "2026-08-16", { pa: 4 });
    play(db, "ALLSTAR", "2026-08-18", { pa: 4, competition: "allStar" });
    // 사본은 정규시즌만 담는다 — 1試合 4打席이 맞다
    career(db, "ALLSTAR", "2026-08-18T16:05:00.000Z", { games: 1, pa: 4 });
  });
  assert.ok(!ids.includes("ALLSTAR"), "올스타를 정규시즌 집계에 섞었다 — 이 선수는 영원히 다시 받힌다");
});

/**
 * ⚠**「받을 수 없어 못 고치는 것」을 「할 일 없음」과 섞지 않는다**(M11).
 * 최근 400일 미출장이라 제외한 선수가 **낡은 사본을 든 채**라면 그건 재취득으로 안 고쳐진다 —
 * 세어서 내보내야 어느 날 그 무리가 커져도 보인다. 시즌이 끝나면 반드시 생긴다(최종전 출장 후 은퇴).
 * 실측(CI DB · 2026-08-20): 제외 810명 · 그중 낡은 사본 **0명**.
 */
test("⚠못 고치는 낡은 사본을 따로 센다 — 「고칠 수 있는데 안 고쳐지는 것」과 다르다(M11)", async () => {
  const { ids, report } = await withDb((_p, db) => {
    upsertPlayer(db, "RETIRED", "引退", NOW);
    upsertPlayer(db, "ACTIVE", "現役", NOW);
    upsertPlayer(db, "PIT", "投手", NOW);
    // 2년 전이 마지막 출장이고, 그 마지막 경기가 사본에 없다
    play(db, "RETIRED", "2024-10-01");
    play(db, "RETIRED", "2024-10-02");
    career(db, "RETIRED", "2024-10-02T16:05:00.000Z", { year: 2024, games: 1, pa: 4 });
    play(db, "ACTIVE", "2026-08-16");
    career(db, "ACTIVE", "2026-08-16T23:00:00.000Z", { games: 1, pa: 4 });
  });
  assert.ok(!ids.includes("RETIRED"), "받을 수 없는 선수를 매일 다시 받으려 한다");
  assert.match(
    report,
    /그중 1명은 낡은 사본을 든 채다/,
    "제외한 선수 중 낡은 사본을 든 사람을 안 셌다 — 「0건」과 「안 쟀음」이 섞인다",
  );
});
