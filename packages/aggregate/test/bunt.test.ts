/**
 * 번트 가치 · 타순 순회 · 상대전적 · 타구 성향 — **SQL을 실제로 돌려서** 검증한다.
 *
 * ⚠**이 파일이 없어서 P0가 통과했다**(2026-08-17 이중 검토).
 * `buntValues` 가 리그로 거르지 않는데 호출부는 리그마다 부르고 있었다 —
 * **전 시즌 번트가 두 리그 버킷에 모두 들어가 표본이 정확히 2배**가 됐다.
 * 렌더 계층 시험 1,033개가 전부 초록인데도 값이 2배로 틀렸다:
 * 픽스처 객체를 화면에 넘길 뿐 **SQL을 한 번도 실행하지 않았기 때문**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame, upsertPlayer } from "@bb-app/store";
import { buildRunExpectancy } from "../src/run-expectancy.ts";
import { buntValues, timesThroughOrder } from "../src/bunt.ts";
import { headToHead } from "../src/head-to-head.ts";
import { battedBalls } from "../src/batted-ball.ts";

const NOW = "2026-08-17T00:00:00.000Z";
/** 센트럴 2팀 · 퍼시픽 2팀. ⚠**리그가 섞이는지 보려면 양쪽에 데이터가 있어야 한다** */
const CL = ["t", "g"] as const;
const PL = ["h", "l"] as const;

type Ev = {
  bases: string;
  outs: number;
  outcome: string;
  runs?: number;
  raw?: string;
  batter?: string;
  pitcher?: string;
};

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-agg-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 한 경기 + 그 경기의 타석들. 홈팀이 공격하는 하프(bottom)만 쓴다.
 *
 * ⚠**이 픽스처는 「1회 말」 하나뿐이고 홈이 이긴다** — 그래서 RE 행렬의 기본값(`exclude`)에서는
 * **끝내기로 판정돼 통째로 빠진다**(2026-08-25 · `walkoffHalves`). 규칙이 맞고 픽스처가 그 모양이다.
 * → 아래 번트 시험들은 RE 를 만들 때 **`"include"` 를 명시**한다. 여기서 재는 것은
 * **번트 커널**이지 끝내기 처리가 아니고, 끝내기 쪽은 `walkoff.test.ts` 가 따로 지킨다.
 * ⚠**픽스처의 승패를 뒤집어 피하지 마라** — 같은 헬퍼를 쓰는 상대전적 시험이 그 값을 본다.
 */
function game(
  db: ReturnType<typeof openDb>,
  id: string,
  away: string,
  home: string,
  evs: readonly Ev[],
): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
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
          outcome, rbi, raw_box, raw_pbp, status, runs_scored)
         VALUES (?, ?, 1, 'bottom', ?, ?, ?, ?, ?, 0, '', ?, 'final', ?)`,
      )
      .run(id, i + 1, e.outs, e.bases, batter, pitcher, e.outcome, e.raw ?? "セカンドゴロ", e.runs ?? 0);
  });
}

/**
 * 두 이닝짜리 경기. **2회 말의 마지막 타석이 번트**이고 그 다음 행은 3회 말 선두다 —
 * 하프이닝 경계를 무시하면 그 선두 상태를 「이후」로 잘못 쓴다.
 */
function twoHalves(db: ReturnType<typeof openDb>, id: string, away: string, home: string): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertPlayer(db, "B1", "B1", NOW);
  upsertPlayer(db, "P1", "P1", NOW);
  const rows: { inning: number; outs: number; bases: string; outcome: string; runs?: number }[] = [
    { inning: 2, outs: 0, bases: "", outcome: "single" },
    { inning: 2, outs: 0, bases: "1", outcome: "fieldedOut" },
    { inning: 2, outs: 1, bases: "1", outcome: "fieldedOut" },
    { inning: 2, outs: 2, bases: "1", outcome: "sacBunt" },
    { inning: 3, outs: 0, bases: "", outcome: "fieldedOut" },
    { inning: 3, outs: 1, bases: "", outcome: "fieldedOut" },
    { inning: 3, outs: 2, bases: "", outcome: "fieldedOut" },
    // ⚠**2사 1루에서 득점이 나는 사례를 넣는다.** 없으면 그 상태의 기대값이 0이 되어
    // 「경계를 넘었는가」를 값으로 구별할 수 없다 — 시험이 공회전한다
    { inning: 4, outs: 2, bases: "1", outcome: "single", runs: 1 },
    { inning: 4, outs: 2, bases: "1", outcome: "fieldedOut" },
    // ⚠**선두 상태(주자없음·무사)에서도 득점이 나야** 「경계를 넘었는가」가 값으로 갈린다.
    // 이 이닝이 없으면 두 경로가 같은 수를 내서 시험이 공회전한다
    { inning: 5, outs: 0, bases: "", outcome: "single", runs: 1 },
    { inning: 5, outs: 0, bases: "", outcome: "fieldedOut" },
    { inning: 5, outs: 1, bases: "", outcome: "fieldedOut" },
    { inning: 5, outs: 2, bases: "", outcome: "fieldedOut" },
  ];
  rows.forEach((r, i) => {
    db.raw
      .prepare(
        `INSERT INTO pa_event
         (game_id, seq, inning, half, outs_before, bases, batter_id, pitcher_id,
          outcome, rbi, raw_box, raw_pbp, status, runs_scored)
         VALUES (?, ?, ?, 'bottom', ?, ?, 'B1', 'P1', ?, 0, '', 'セカンドゴロ', 'final', ?)`,
      )
      .run(id, i + 1, r.inning, r.outs, r.bases, r.outcome, r.runs ?? 0);
  });
}

const RE_OK: readonly Ev[] = [
  { bases: "1", outs: 0, outcome: "sacBunt" },
  { bases: "2", outs: 1, outcome: "fieldedOut" },
  { bases: "", outs: 2, outcome: "fieldedOut" },
];

/**
 * ⚠**이것이 P0를 잡는 시험이다.**
 * 양 리그에 같은 번트를 하나씩 두고, 리그별로 부르면 **각각 1건**이어야 한다.
 * 필터가 없으면 각 버킷이 2건을 본다.
 */
test("⚠번트는 그 리그의 것만 센다 — 필터가 없으면 표본이 정확히 2배가 된다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], RE_OK);
    game(db, "pl1", PL[1], PL[0], RE_OK);

    for (const [lg, codes] of [["central", CL], ["pacific", PL]] as const) {
      const re = buildRunExpectancy(db, 2026, lg, [...codes], "regular", "9999-12-31", "include");
      const out = buntValues(db, 2026, "regular", "9999-12-31", re, [...codes]);
      const total = out.reduce((a, b) => a + b.n, 0);
      assert.equal(total, 1, `${lg} 버킷이 다른 리그의 번트까지 셌다(${total}건)`);
    }
  });
});

test("번트의 득점기대값 변화는 다음 타석 상태에서 나온다 — SRC와 같은 커널", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], RE_OK);
    const re = buildRunExpectancy(db, 2026, "central", [...CL], "regular", "9999-12-31", "include");
    const out = buntValues(db, 2026, "regular", "9999-12-31", re, [...CL]);
    assert.equal(out.length, 1);
    const b = out[0]!;
    assert.equal(b.bases, "1");
    assert.equal(b.outs, 0);
    assert.equal(b.n, 1);
    // 1루 무사 → 2루 1사. 두 상태의 기대값 차이가 그대로 나온다
    const before = re.matrix.get("1|0") ?? 0;
    const after = re.matrix.get("2|1") ?? 0;
    assert.ok(Math.abs(b.delta - (after - before)) < 1e-9, `Δ가 상태 차이와 다르다(${b.delta})`);
  });
});

/**
 * ⚠**하프이닝의 마지막 타석은 「이후」가 없다** — 이닝이 끝나면 기대값은 0이다.
 * 경계를 무시하고 다음 행을 쓰면 **다음 이닝의 선두 타자 상태**를 이후로 삼게 되어
 * 번트가 조용히 큰 플러스가 된다.
 */
test("⚠하프이닝 경계를 넘어 다음 행을 이후 상태로 쓰지 않는다", async () => {
  await withDb((db) => {
    // 2회 말의 마지막 타석이 번트다. 그 다음 행은 **3회 말 선두**(주자 없음·무사)라
    // 경계를 무시하면 「주자 없음 무사」의 큰 기대값을 이후로 삼아 Δ가 크게 플러스가 된다
    twoHalves(db, "cl1", CL[1], CL[0]);
    const re = buildRunExpectancy(db, 2026, "central", [...CL], "regular", "9999-12-31", "include");
    const out = buntValues(db, 2026, "regular", "9999-12-31", re, [...CL]);
    assert.equal(out.length, 1, "번트를 못 찾았다 — 이 시험이 공회전한다");
    // ⚠**정확한 기대식으로 못 박는다.** 「음수인가」로만 보면 경계를 넘어 다른 상태를 써도
    // 우연히 음수가 나올 수 있어 시험이 통과해 버린다
    const before = re.matrix.get("1|2") ?? 0;
    assert.ok(before > 0, "2사 1루의 기대값이 0이다 — 이 시험이 공회전한다");
    assert.ok(
      Math.abs(out[0]!.delta - (0 - before)) < 1e-9,
      `이닝이 끝났는데 다음 하프의 상태를 이후로 썼다(Δ=${out[0]!.delta}, 기대 ${0 - before})`,
    );
  });
});

test("타순 순회는 같은 투수 × 같은 타자의 만남 횟수로 센다", async () => {
  await withDb((db) => {
    // ⚠**투수가 바뀌면 순회도 다시 1부터다.** 타자만으로 세면 P2 의 첫 상대가 2순회가 된다
    game(db, "cl1", CL[1], CL[0], [
      { bases: "", outs: 0, outcome: "single", batter: "B1", pitcher: "P1" },
      { bases: "1", outs: 0, outcome: "fieldedOut", batter: "B2", pitcher: "P1" },
      { bases: "1", outs: 1, outcome: "single", batter: "B1", pitcher: "P1" },
      { bases: "12", outs: 1, outcome: "fieldedOut", batter: "B1", pitcher: "P2" },
    ]);
    const t = timesThroughOrder(db, 2026, "regular", "9999-12-31");
    const by = new Map(t.map((x) => [x.round, x]));
    assert.equal(by.get(1)?.pa, 3, "투수가 바뀌면 순회가 1부터 다시 시작해야 한다");
    assert.equal(by.get(2)?.pa, 1, "같은 투수와의 두 번째 만남이 2순회다");
    assert.equal(by.get(3), undefined, "투수를 무시하고 세었다");
    assert.equal((by.get(1)?.ab ?? 0) + (by.get(2)?.ab ?? 0), 4);
  });
});

/**
 * ⚠**수비방해 아웃(`捕守妨`)은 「타수 아님」이 아니다.**
 * 이름이 `interference`(打妨出 · 출루) 와 비슷해서 `NOT_AB` 로 밀어 넣기 쉬운데,
 * 타자가 아웃된 것이라 **타수에 들어간다**(박스 打数 실측으로 확정).
 * 아는 어휘 목록에서 빠지면 M7 이 먼저 멈춘다 — 그 자리를 여기서 고정한다.
 */
test("⚠수비방해 아웃을 타수로 센다 — 아는 어휘에서 빠지면 멈춘다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [
      { bases: "", outs: 0, outcome: "single", batter: "B1", pitcher: "P1" },
      { bases: "1", outs: 0, outcome: "interferenceOut", batter: "B2", pitcher: "P1", raw: "キャッチャー守備妨害アウト" },
    ]);
    const t = timesThroughOrder(db, 2026, "regular", "9999-12-31");
    const one = t.find((x) => x.round === 1)!;
    assert.equal(one.pa, 2);
    assert.equal(one.ab, 2, "수비방해 아웃이 타수에서 빠졌다");
    assert.equal(one.h, 1);
  });
});

/** ⚠**어휘를 추측하지 않는다.** 모르는 결과가 오면 멈춘다(M7) */
test("⚠모르는 타석 결과가 오면 멈춘다 — 조용히 타수에서 빼지 않는다(M7)", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [{ bases: "", outs: 0, outcome: "宇宙へ消えた" }]);
    assert.throws(() => timesThroughOrder(db, 2026, "regular", "9999-12-31"), /모르는 타석 결과/);
  });
});

test("상대전적은 양 팀 관점으로 한 줄씩 나온다 — 승·패·분이 뒤집힌다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], RE_OK); // away 1 - home 2 → 홈 승
    const h = headToHead(db, 2026, "regular", "9999-12-31");
    const home = h.find((x) => x.teamCode === CL[0])!;
    const away = h.find((x) => x.teamCode === CL[1])!;
    assert.deepEqual([home.w, home.l, home.t], [1, 0, 0]);
    assert.deepEqual([away.w, away.l, away.t], [0, 1, 0]);
    assert.equal(home.runsFor, 2);
    assert.equal(home.runsAgainst, 1);
    // ⚠자기 자신과의 전적은 없다
    assert.equal(h.filter((x) => x.teamCode === x.opponentCode).length, 0);
  });
});

/** ⚠**득점을 못 읽은 경기는 세지 않는다**(M11) — 「0-0」으로 접으면 없는 무승부가 생긴다 */
test("득점이 결측인 경기는 무승부로 접지 않는다(M11)", async () => {
  await withDb((db) => {
    upsertGame(db, {
      gameId: "x1", season: 2026, gameDate: "2026-04-02", awayCode: CL[1], homeCode: CL[0], gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: null, homeRuns: null,
    });
    assert.deepEqual(headToHead(db, 2026, "regular", "9999-12-31"), []);
  });
});

test("타구 성향은 아웃만 분모로 센다 — 안타는 타구 종류를 모른다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [
      { bases: "", outs: 0, outcome: "fieldedOut", raw: "セカンドゴロ" },
      { bases: "", outs: 1, outcome: "fieldedOut", raw: "センターフライ" },
      // ⚠안타는 타구 종류가 없다 — 분모에 들어가면 분자만 빠진 비율이 된다
      { bases: "", outs: 2, outcome: "single", raw: "センター前ヒット" },
      // ⚠**타구 종류가 붙은 안타**(내야안타는 ゴロ 표기가 붙는다). 이걸 아웃으로 세면 안 된다
      { bases: "1", outs: 2, outcome: "single", raw: "ショートゴロ" },
    ]);
    const b = battedBalls(db, 2026, "regular", "9999-12-31")[0]!;
    assert.equal(b.groundOuts, 1, "안타로 나간 땅볼을 아웃으로 셌다");
    assert.equal(b.airOuts, 1);
    assert.equal(b.groundOuts + b.airOuts, 2, "안타가 아웃 분모에 들어갔다");
    // 방향은 안타도 센다 — 그건 원문에 있다
    assert.equal(b.left + b.center + b.right, 4);
  });
});

/**
 * ⚠**C13 — 「ゴロアウト率」의 분모는 아웃만이다**(2026-09-25 감사 C13 · 2026-09-27 수정).
 *
 * 화면은 「ゴロアウト率の分母はアウトだけ」라고 말하는데, 집계는 **「안타가 아니면 아웃」**으로 셌다 —
 * 그래서 **타자가 산 타구**(실책 출루 · 野選 · 犠飛失策)가 땅볼·공중 아웃에 들어갔다.
 * 정의서(D8 정본 · `docs/metrics/README.md` §3.1)가 이미 野選 은 「타자가 살아 있다」,
 * 실책 출루는 「타자가 **아웃이 아니고**」라고 정의한다.
 * → 결과 분류마다 **들어가는가 / 안 들어가는가**를 표로 못 박는다(타자 쪽 한 줄씩 · 투수 쪽은 합계).
 * ⚠원문은 보유 로그의 실제 표기다(`（エラー）`·`（フィールダースチョイス）` 가 타구 종류 뒤에 붙는다).
 */
test("⚠C13 타구 성향의 아웃 분모는 결과 분류로 가른다 — 타자가 산 타구는 아웃이 아니다", async () => {
  const CASES: readonly (readonly [outcome: string, raw: string, ground: number, air: number, why: string])[] = [
    ["fieldedOut", "セカンドゴロ", 1, 0, "범타 — 땅볼 아웃"],
    ["fieldedOut", "センターフライ", 0, 1, "범타 — 뜬공 아웃"],
    ["fieldedOut", "ショートライナー", 0, 1, "범타 — 직선타는 공중 아웃"],
    ["fieldedOut", "キャッチャーファウルフライ", 0, 1, "범타 — 파울플라이는 공중 아웃"],
    ["groundedIntoDoublePlay", "ショートゴロ併殺打", 1, 0, "併殺打 — 타자 아웃(땅볼)"],
    ["sacFly", "センター犠牲フライ（打点1）", 0, 1, "犠飛 — 잡혔으니 타자 아웃(타수가 아닐 뿐이다)"],
    ["reachedOnError", "サードゴロ（エラー）", 0, 0, "실책 출루(땅볼) — 타자가 산다"],
    ["reachedOnError", "レフトフライ（エラー）", 0, 0, "실책 출루(뜬공) — 타자가 산다"],
    ["fieldersChoice", "セカンドゴロ（フィールダースチョイス）", 0, 0, "野選 — 타자가 산다"],
    ["sacFlyError", "ライト犠牲フライ（エラー）（打点1）", 0, 0, "犠飛失策 — 타자가 산다"],
    ["sacBunt", "ピッチャー犠牲バント", 0, 0, "犠打 — 번트는 땅볼·공중 어느 쪽도 아니다"],
    ["sacBuntError", "ピッチャー犠牲バント（エラー）", 0, 0, "犠打失策 — 번트 · 타자가 산다"],
    ["sacBuntFieldersChoice", "ピッチャー犠牲バント（フィールダースチョイス）", 0, 0, "犠打野選 — 번트 · 타자가 산다"],
    ["single", "ショートゴロ", 0, 0, "내야안타 — 타구 종류가 붙어도 아웃이 아니다"],
  ];
  await withDb((db) => {
    game(
      db,
      "cl1",
      CL[1],
      CL[0],
      CASES.map(([outcome, raw], i) => ({ bases: "", outs: i % 3, outcome, raw, batter: `B${i}` })),
    );
    const byBatter = new Map(battedBalls(db, 2026, "regular", "9999-12-31").map((b) => [b.playerId, b]));
    const bad: string[] = [];
    CASES.forEach(([outcome, raw, ground, air, why], i) => {
      const b = byBatter.get(`B${i}`);
      const got = b === undefined ? "행 없음" : `${b.groundOuts}/${b.airOuts}`;
      if (got !== `${ground}/${air}`) bad.push(`${outcome}「${raw}」 땅볼/공중 = ${got} (기대 ${ground}/${air} — ${why})`);
    });
    assert.deepEqual(bad, [], "아웃이 아닌 타구가 아웃 분모에 들어갔거나, 아웃이 빠졌다");
    // ⚠**투수 쪽은 같은 로그를 다른 SQL 로 센다** — 한쪽만 고치면 투수 페이지에서만 틀린다
    const p = battedBalls(db, 2026, "regular", "9999-12-31", true);
    assert.equal(p.length, 1, "투수 행이 하나가 아니다");
    const want = CASES.reduce((a, c) => ({ g: a.g + c[2], a: a.a + c[3] }), { g: 0, a: 0 });
    assert.deepEqual(
      { g: p[0]!.groundOuts, a: p[0]!.airOuts },
      want,
      "투수 쪽의 땅볼·공중 아웃이 타자 쪽 합계와 다르다",
    );
  });
});

/**
 * ⚠**결과 분류를 모르는 타구는 멈춘다**(M7 · C13).
 * 「안타가 아니면 아웃」이던 시절에는 **모르는 결과가 조용히 아웃**이 됐다. 목록으로 바꾸면 반대로
 * **조용히 빠진다** — 어느 쪽이든 분모가 소리 없이 틀린다. 그래서 둘 다 아니고 멈춘다.
 * ⚠`bunt.ts` 의 타순 순회가 이미 같은 자리에서 멈춘다(모르는 결과면 던진다) — 새 실패 모드가 아니다.
 * 실측: 보유 전 시즌 `pa_event` 의 `unknown` **0건**.
 */
test("⚠C13 결과 분류를 모르는 타구는 아웃에 넣지도 빼지도 않고 멈춘다(M7)", async () => {
  for (const outcome of ["unknown", "mysteryOutcome"]) {
    await withDb((db) => {
      game(db, "cl1", CL[1], CL[0], [{ bases: "", outs: 0, outcome, raw: "セカンドゴロ" }]);
      assert.throws(
        () => battedBalls(db, 2026, "regular", "9999-12-31"),
        /결과 분류를 모른다/,
        `결과 분류 ${outcome} 인 땅볼을 조용히 셌다(또는 조용히 뺐다)`,
      );
    });
  }
});

/** ⚠**내야안타의 분모는 내야 타구**다. 홈런은 내야안타가 될 수 없다 */
test("내야안타는 내야 타구를 분모로 하고, 홈런을 세지 않는다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [
      { bases: "", outs: 0, outcome: "single", raw: "ショートヒット" },
      { bases: "1", outs: 0, outcome: "fieldedOut", raw: "ショートゴロ" },
      // ⚠**내야 방향으로 기록된 홈런**(런닝 홈런 표기). 홈런을 거르지 않으면 내야안타로 샌다
      { bases: "1", outs: 1, outcome: "homerun", raw: "ショートへのランニングホームラン" },
    ]);
    const b = battedBalls(db, 2026, "regular", "9999-12-31")[0]!;
    assert.equal(b.infield, 3, "내야 타구 수가 틀렸다");
    assert.equal(b.infieldHits, 1, "홈런을 내야안타로 셌다");
  });
});

/**
 * ⚠**「방향 토큰으로 시작한다」만으로는 M7이 안 지켜진다.**
 * `unknownTokens` 는 접두어만 보므로 `センター大飛球` 처럼 **종류 어휘만 바뀌면 통과**한다.
 * 그러면 실측 22,901건의 공중 아웃이 조용히 0이 되고 땅볼 비율이 1.000으로 튄다.
 *
 * 실측 불변식이 그 자리를 막는다 — **종류를 모르는 인플레이 타구는 22,271/22,271이 전부 안타**다.
 */
test("⚠타구 종류 어휘가 바뀌면 멈춘다 — 접두어만 맞으면 통과시키지 않는다(M7)", async () => {
  await withDb((db) => {
    // 방향은 읽히지만 종류를 모르는 **아웃**. 어휘가 바뀐 날의 모습이다
    game(db, "cl1", CL[1], CL[0], [{ bases: "", outs: 0, outcome: "fieldedOut", raw: "センター大飛球" }]);
    assert.throws(
      () => battedBalls(db, 2026, "regular", "9999-12-31"),
      /타구 종류를 못 읽었는데 안타도 아니다/,
      "종류 어휘가 바뀌었는데 조용히 흘렸다",
    );
  });
});

test("종류를 모르는 안타는 정상이다 — 비홈런 안타에는 표기가 없다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [{ bases: "", outs: 0, outcome: "single", raw: "センター前ヒット" }]);
    const b = battedBalls(db, 2026, "regular", "9999-12-31")[0]!;
    assert.equal(b.groundOuts + b.airOuts, 0, "안타를 아웃으로 셌다");
    assert.equal(b.center, 1, "방향은 읽혀야 한다");
  });
});

/**
 * ⚠**번트는 방향 통계에서 뺀다.** 「어디로 치는가」를 말하는 값인데 희생번트는 작전이다.
 * 실측 1,672건 중 919건이 투수 앞이라, 번트를 많이 대는 타자의 「중앙」이 통째로 부푼다.
 */
test("⚠희생번트를 방향 통계에 넣지 않는다 — 작전이지 타격 성향이 아니다", async () => {
  await withDb((db) => {
    game(db, "cl1", CL[1], CL[0], [
      { bases: "", outs: 0, outcome: "single", raw: "センター前ヒット" },
      { bases: "1", outs: 0, outcome: "sacBunt", raw: "ピッチャー犠牲バント" },
      { bases: "2", outs: 1, outcome: "fieldedOut", raw: "レフトフライ" },
    ]);
    const b = battedBalls(db, 2026, "regular", "9999-12-31")[0]!;
    assert.equal(b.center, 1, "번트가 중앙에 섞였다");
    assert.equal(b.left + b.center + b.right, 2, "번트가 방향 분모에 들어갔다");
  });
});
