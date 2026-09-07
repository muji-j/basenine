/**
 * **`streakCategoriesByLeague` — 계산 계층과 화면 사이의 배선**.
 *
 * 여기서 잡는 것 둘. 둘 다 **화면 픽스처로는 못 잡는다** — 픽스처는 이 배선을 건너뛴다.
 * ⑴ 못 찾은 이름·구단이 **후보에서도** 빠지는가(M11 · M2 · 아래).
 * ⑵ 이닝 축의 행이 **이닝 축의 기간**을 받는가(2026-09-07 P2).
 *
 * ---
 *
 * ## ⑴ 후보 만들기 — 못 찾으면 후보에서도 뺀다 · **이 시험이 없어서 되돌려도 초록이었다**
 *
 * `streakCategoriesByLeague` 는 **이름과 「그때 소속 구단」을 후보를 만들 때** 정한다.
 * 나중에 정하면 못 찾은 행이 **표에서만** 빠지고 **각주의 분모(`candidates`)에는 남아**
 * 「162人のうち13人」이 조용히 틀린 수가 된다 — 두 수가 **다른 모집단**에서 나오기 때문이다.
 *
 * ⚠**그 고침을 지키는 시험이 0건이었다**(2026-09-07 이중 검토 P2). 되돌려도 스위트가 통과하고,
 * **실데이터에 결측이 0건이라 산출물 대조로도 안 잡힌다** — 「없는 것」은 화면에 안 나온다.
 * → **결측을 만들어서** 그 행이 `rows` 와 `candidates` **양쪽에서 동시에** 빠지는지 고정한다.
 *
 * ⚠**분모가 둘이라는 것 자체가 요점이다.** 한쪽만 보는 시험은 이 결함을 못 잡는다 —
 * 되돌린 코드에서도 `rows` 는 여전히 맞고, **틀리는 것은 `candidates` 뿐이며 그 수는 각주에만 나온다.**
 *
 * ## ⑵ 이닝 축의 기간
 *
 * 계산 계층이 `innings.from`/`innings.to` 를 따로 내는데(정의서 §3-3-B), **화면에 그것을
 * 넘기는 자리가 여기다.** 그 배선이 끊겨도 화면 픽스처 시험은 전부 초록이다 —
 * 그쪽은 `from`/`to` 를 손으로 주기 때문이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  replacePaEvents,
  upsertBatting,
  upsertGame,
  upsertPitching,
  upsertPlayer,
} from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { pitchingStreaks } from "@bb-app/aggregate";
import type { PlayerStreaks } from "@bb-app/aggregate";
import { streakCategoriesByLeague } from "../src/query.ts";

const NOW = "2026-09-07T00:00:00.000Z";
const SEASON = 2025;
const COMPETITION = "regular";
/** ⚠**실재하는 구단 코드여야 한다** — 리그를 못 찾으면 그 자체로 후보에서 빠진다 */
const HOME = "g";
const AWAY = "t";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-streakcand-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let seq = 0;
function game(db: Db, date: string): string {
  seq += 1;
  const gameId = `x${seq}`;
  upsertGame(db, {
    gameId,
    season: SEASON,
    gameDate: date,
    awayCode: AWAY,
    homeCode: HOME,
    gameNo: 1,
    status: "played",
    notPlayedReason: null,
    competition: COMPETITION,
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
  });
  return gameId;
}

function pitching(db: Db, gameId: string, playerId: string, outs: number, runs: number): void {
  upsertPitching(db, {
    gameId,
    playerId,
    side: "home",
    decision: null,
    outs,
    bf: null,
    pitches: null,
    h: 0,
    hr: 0,
    bb: 0,
    hbp: 0,
    so: 0,
    runs,
    er: runs,
    wp: null,
    balk: null,
  });
}

/** 무실점 등판 하나 */
function scoreless(db: Db, gameId: string, playerId: string): void {
  pitching(db, gameId, playerId, 3, 0);
}

/**
 * **깨끗한 1이닝 뒤에 실점한 등판** — 마루를 끝내는 경계 등판.
 * 규칙 R 로 **앞의 3아웃이 마루에 들어가므로**, 이닝 축의 기간은 **이 경기까지**다.
 */
function cleanThenRuns(db: Db, gameId: string, playerId: string): void {
  pitching(db, gameId, playerId, 6, 1);
  const rows: PaEventRow[] = [];
  let seq = 0;
  for (const [inning, runsIn] of [[1, 0], [2, 1]] as const) {
    for (let k = 0; k < 3; k += 1) {
      seq += 1;
      rows.push({
        gameId,
        seq,
        inning,
        half: "top",
        outsBefore: k,
        bases: "",
        batterId: "BX",
        pitcherId: playerId,
        outcome: "outOther",
        rbi: 0,
        rawBox: "",
        rawPbp: "",
        ballCount: null,
        status: "final",
        runsScored: k === 2 ? runsIn : 0,
      });
    }
  }
  replacePaEvents(db, gameId, rows);
}

/** 안타 하나 있는 출장 — 타자 축의 후보를 만들기 위해서 */
function hit(db: Db, gameId: string, playerId: string): void {
  upsertBatting(db, {
    gameId,
    playerId,
    side: "home",
    battingOrder: "1",
    position: "右",
    pa: 4,
    ab: 4,
    h: 1,
    d2: 0,
    d3: 0,
    hr: 0,
    bb: 0,
    ibb: 0,
    hbp: 0,
    sf: 0,
    sh: 0,
    so: 0,
    roe: 0,
    runs: 0,
    rbi: 0,
    sb: 0,
  });
}

/** 타자 마루 하나 — `battingStreaks` 를 통과시키지 않고 **입력을 직접 준다** */
function batStreak(playerId: string, best: number, from: string, to: string): PlayerStreaks {
  const empty = { current: 0, currentFrom: null, currentTo: null, best: 0, bestFrom: null, bestTo: null };
  return {
    playerId,
    hitting: { current: best, currentFrom: from, currentTo: to, best, bestFrom: from, bestTo: to },
    onBase: { ...empty },
    hitless: { ...empty },
    games: best,
    lastGameDate: to,
  };
}

/** 그 축 패널을 꺼낸다 */
function panel(
  cats: ReturnType<typeof streakCategoriesByLeague>,
  league: "central" | "pacific",
  id: string,
) {
  const p = cats.get(league)?.panels.find((x) => x.id === id);
  assert.notEqual(p, undefined, `${id} 패널이 없다`);
  return p!;
}

function build(db: Db, nameOf: (id: string) => string | null, bat: readonly PlayerStreaks[]) {
  return streakCategoriesByLeague(
    db,
    SEASON,
    COMPETITION,
    ["central"],
    pitchingStreaks(db, { fromSeason: SEASON, toSeason: SEASON, competition: COMPETITION }),
    new Map(bat.map((b) => [b.playerId, b])),
    nameOf,
  );
}

test("⚠이름을 못 찾은 투수는 rows 에서도 candidates 에서도 빠진다 — 분모가 둘로 갈리면 안 된다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "P1", "投手いち", NOW);
    upsertPlayer(db, "P2", "投手に", NOW);
    for (const d of ["2025-04-01", "2025-04-02", "2025-04-03"]) {
      const g = game(db, d);
      scoreless(db, g, "P1");
      scoreless(db, g, "P2");
    }

    // ⚠**먼저 둘 다 찾히는 경우를 잰다** — 안 그러면 「원래 1명뿐」과 구별이 안 된다
    const both = panel(build(db, () => "名前", []), "central", "scorelessAppearanceStreak");
    assert.equal(both.candidates, 2, "밑값이 2가 아니다 — 이 시험이 공회전한다");
    assert.equal(both.rows.length, 2);

    const one = panel(
      build(db, (id) => (id === "P2" ? null : "名前"), []),
      "central",
      "scorelessAppearanceStreak",
    );
    assert.equal(one.rows.length, 1, "이름을 못 찾은 투수가 표에 남았다");
    assert.equal(
      one.candidates,
      1,
      "이름을 못 찾은 투수가 각주의 분모에는 남았다 — rows 와 candidates 가 다른 모집단이 된다",
    );
    assert.deepEqual(one.rows.map((r) => r.playerId), ["P1"]);
  });
});

test("⚠이름을 못 찾은 타자도 같다 — 안타 마루 축", async () => {
  await withDb((db) => {
    upsertPlayer(db, "B1", "打者いち", NOW);
    upsertPlayer(db, "B2", "打者に", NOW);
    for (const d of ["2025-04-01", "2025-04-02", "2025-04-03"]) {
      const g = game(db, d);
      hit(db, g, "B1");
      hit(db, g, "B2");
    }
    const bat = [
      batStreak("B1", 3, "2025-04-01", "2025-04-03"),
      batStreak("B2", 3, "2025-04-01", "2025-04-03"),
    ];

    const both = panel(build(db, () => "名前", bat), "central", "hitStreak");
    assert.equal(both.candidates, 2, "밑값이 2가 아니다 — 이 시험이 공회전한다");

    const one = panel(build(db, (id) => (id === "B2" ? null : "名前"), bat), "central", "hitStreak");
    assert.equal(one.rows.length, 1, "이름을 못 찾은 타자가 표에 남았다");
    assert.equal(one.candidates, 1, "이름을 못 찾은 타자가 각주의 분모에는 남았다");
  });
});

/**
 * ⚠**이닝 축의 행은 이닝 축의 기간을 받아야 한다**(2026-09-07 이중 검토 P2).
 *
 * 각주가 「期間」을 **「記録に数えた最後の試合まで」**라고 약속한다. 경계 등판의 아웃이
 * 값에 들어갔는데 기간이 그 앞에서 끝나면 **값의 근거가 화면에서 사라진다** —
 * 실측 사례가 山﨑(2025 · `36回` = 4/2~4/30 의 105아웃 + **5/7 의 3아웃**)인데
 * 화면 기간이 `4月2日〜4月30日` 이었다.
 *
 * ⚠**등판 축은 그대로여야 한다** — 경계 등판은 **등판 축에는 안 들어간다.**
 * **한 필드에 두 뜻을 담지 않는다**는 것이 이 시험의 요점이다.
 * ⚠**화면 픽스처로는 못 잡는다** — 그쪽은 `from`/`to` 를 손으로 주므로 이 배선을 건너뛴다.
 */
test("⚠이닝 축의 기간은 경계 등판까지 · 등판 축의 기간은 그대로다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "P1", "投手いち", NOW);
    // ⚠**`pa_event.batter_id` 는 외래키다** — 없으면 FAIL 이 아니라 ERROR 로 죽는다
    upsertPlayer(db, "BX", "打者エックス", NOW);
    for (const d of ["2025-04-01", "2025-04-02", "2025-04-03"]) scoreless(db, game(db, d), "P1");
    // 4/10: 1회 무실점(3아웃) → 2회 실점. 규칙 R 로 **3아웃이 마루에 들어간다**
    cleanThenRuns(db, game(db, "2025-04-10"), "P1");

    const cats = build(db, () => "名前", []);
    const psi = panel(cats, "central", "scorelessInningStreak");
    const psa = panel(cats, "central", "scorelessAppearanceStreak");
    assert.equal(psi.rows.length, 1);
    assert.equal(psi.rows[0]!.value, "4回", "경계 등판의 3아웃이 값에 안 들어갔다 — 시험이 공회전한다");
    assert.equal(
      psi.rows[0]!.to,
      "2025-04-10",
      "이닝 축의 행이 등판 축의 기간을 받았다 — 값의 근거가 된 등판이 기간에서 빠진다",
    );
    assert.equal(psi.rows[0]!.from, "2025-04-01");
    assert.equal(psa.rows[0]!.to, "2025-04-03", "등판 축의 기간이 실점 등판까지 늘어났다");
    assert.equal(psi.spanUncertain, false, "확정인데 유보를 켰다");
  });
});

/**
 * ⚠**구단을 못 찾는 쪽도 같은 규칙이다.** 그 날짜에 출장 기록이 없으면
 * `battingTeamOn` 이 `null` 을 내고(M11 — 다른 값으로 안 때운다), 그 행은 **후보가 아니다.**
 * ⚠**이쪽은 실데이터에서 안 일어난다** — 마루의 날짜는 출장 기록에서 나오기 때문이다.
 * 그래도 고정하는 이유는, 「못 찾으면 뒤에서 뺀다」로 되돌리면 **여기서만 갈리기** 때문이다.
 */
test("⚠구단을 못 찾은 행도 rows·candidates 양쪽에서 빠진다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "B1", "打者いち", NOW);
    upsertPlayer(db, "B9", "打者きゅう", NOW);
    for (const d of ["2025-04-01", "2025-04-02", "2025-04-03"]) {
      const g = game(db, d);
      hit(db, g, "B1");
      hit(db, g, "B9");
    }
    // B9 의 마루만 **출장이 없는 날짜**로 끝난다 → 그 날의 구단을 말할 수 없다
    const bat = [
      batStreak("B1", 3, "2025-04-01", "2025-04-03"),
      batStreak("B9", 3, "2025-04-01", "2025-05-30"),
    ];
    const p = panel(build(db, () => "名前", bat), "central", "hitStreak");
    assert.equal(p.rows.length, 1, "구단을 못 찾은 행이 표에 남았다");
    assert.equal(p.candidates, 1, "구단을 못 찾은 행이 각주의 분모에는 남았다");
    assert.deepEqual(p.rows.map((r) => r.playerId), ["B1"]);
  });
});
