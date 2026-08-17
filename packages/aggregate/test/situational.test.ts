import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { buildRunExpectancy, stateKey } from "../src/run-expectancy.ts";
import type { RunExpectancy } from "../src/run-expectancy.ts";
import { computeSrc, computeSrp } from "../src/situational.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number; batterId: string }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    pitcherId: "P1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-src-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "P1", "투수", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function seedGame(db: Db, id: string): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
  });
}

const FIXED_RE: RunExpectancy = {
  season: 2026,
  league: "central",
  matrix: new Map([
    [stateKey("", 0), 0.4],
    [stateKey("1", 0), 0.8],
    [stateKey("", 1), 0.2],
    [stateKey("1", 1), 0.5],
  ]),
  samples: new Map(),
  observedStates: 4,
  totalPa: 0,
};

test("SRC는 타석마다의 득점기대치 변화를 합산한다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 무사주자없음(0.4) → 1루 무사(0.8): +0.4
    // 1루 무사(0.8) → 1루 1아웃(0.5): −0.3
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "" }),
      ev({ gameId: "g1", seq: 2, batterId: "B1", outsBefore: 0, bases: "1" }),
      ev({ gameId: "g1", seq: 3, batterId: "B1", outsBefore: 1, bases: "1" }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    // 마지막 타석은 이닝 종료로 0 − 0.5 + 0 = −0.5
    assert.ok(Math.abs(e.src - (0.4 - 0.3 - 0.5)) < 1e-9);
    assert.equal(e.pa, 3);
    assert.equal(e.skipped, 0);
  });
});

test("득점은 그대로 더해진다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 2점 나고 이닝 종료: 0 − 0.8 + 2 = +1.2
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e && Math.abs(e.src - 1.2) < 1e-9);
  });
});

test("⚠RE에 없는 상태는 0으로 때우지 않고 미계산으로 센다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 2, bases: "123" }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.pa, 0);
    assert.equal(e.skipped, 1, "미계산을 숨기면 그 타석이 조용히 사라진다");
    assert.equal(e.src, 0);
    assert.equal(e.srcPer600, null, "분모가 0이면 환산값도 없다");
  });
});

test("600타석 환산은 표본이 다른 선수를 나란히 보기 위한 것", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.ok(e && e.srcPer600 !== null);
    assert.ok(Math.abs(e.srcPer600 - 1.2 * 600) < 1e-6);
  });
});

test("⚠리그 전체의 SRC 합은 0에 가까워야 한다 — 평균 대비 지표이므로", async () => {
  await withDb((db) => {
    // 실제 RE를 데이터에서 만들고 같은 데이터로 SRC를 계산하면 합이 0이 되어야 한다.
    seedGame(db, "g1");
    for (const id of ["B1", "B2", "B3"]) upsertPlayer(db, id, id, NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 2, batterId: "B2", outsBefore: 0, bases: "1", runsScored: 1 }),
      ev({ gameId: "g1", seq: 3, batterId: "B3", outsBefore: 1, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 4, batterId: "B1", inning: 2, outsBefore: 0, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 5, batterId: "B2", inning: 2, outsBefore: 1, bases: "", runsScored: 0 }),
      ev({ gameId: "g1", seq: 6, batterId: "B3", inning: 2, outsBefore: 2, bases: "", runsScored: 0 }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["t", "g"]);
    const total = computeSrc(db, re, ["t", "g"]).reduce((n, e) => n + e.src, 0);
    assert.ok(Math.abs(total) < 1e-9, `합이 0이어야 하는데 ${total}`);
  });
});

test("올스타전은 SRC에 들어가지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-20", awayCode: "pl", homeCode: "cl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/as", fetchedAt: NOW,
    });
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", bases: "1", runsScored: 2 })]);
    replacePaEvents(db, "as1", [ev({ gameId: "as1", seq: 1, batterId: "B1", bases: "1", runsScored: 2 })]);
    const [e] = computeSrc(db, FIXED_RE, ["t", "g"]);
    assert.equal(e?.pa, 1);
  });
});

// ── SRP (투수판) ──────────────────────────────────────────────────────────

test("⚠SRP는 같은 타석에서 SRC의 정확한 반대다 — 타자가 얻은 것이 투수가 내준 것이다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "" }),
      ev({ gameId: "g1", seq: 2, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 1 }),
      ev({ gameId: "g1", seq: 3, batterId: "B1", outsBefore: 1, bases: "1" }),
    ]);
    const [bat] = computeSrc(db, FIXED_RE, ["t", "g"]);
    const [pit] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(bat && pit);
    assert.ok(
      Math.abs(bat.src + pit.srp) < 1e-9,
      `부호만 반대여야 한다: SRC ${bat.src} · SRP ${pit.srp}`,
    );
    assert.equal(pit.bf, bat.pa, "같은 타석 수를 세야 한다");
    assert.equal(pit.playerId, "P1");
  });
});

test("실점을 막으면 SRP가 양수다 — 부호 방향을 고정한다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 아무도 안 들어오고 이닝 종료 → 0.8을 막았다
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
    const [good] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(good && Math.abs(good.srp - 0.8) < 1e-9, `막았으면 양수여야 한다: ${good?.srp}`);
  });
});

test("실점하면 SRP가 음수가 된다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 1루 무사(0.8)에서 2점 주고 이닝 종료 → −(0 − 0.8 + 2) = −1.2
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1", runsScored: 2 }),
    ]);
    const [bad] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(bad && Math.abs(bad.srp + 1.2) < 1e-9, `내줬으면 음수여야 한다: ${bad?.srp}`);
  });
});

test("⚠RE에 없는 상태는 SRP에서도 0으로 때우지 않는다", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    // 만루는 FIXED_RE에 없다
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "123" })]);
    const [e] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.srp, 0);
    assert.equal(e.bf, 0, "계산 못 한 타석을 분모에 넣으면 안 된다");
    assert.equal(e.skipped, 1);
  });
});

test("9이닝 환산은 아웃이 없으면 null이다 — 0으로 나누지 않는다(M11)", async () => {
  await withDb((db) => {
    seedGame(db, "g1");
    upsertPlayer(db, "B1", "타자", NOW);
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
    // 투수표를 적재하지 않았으므로 아웃은 0이다
    const [e] = computeSrp(db, FIXED_RE, ["t", "g"]);
    assert.ok(e);
    assert.equal(e.outs, 0);
    assert.equal(e.srpPer9, null);
  });
});

/**
 * ⚠**기간을 좁히면 `srp`·`bf`·`outs` 가 같은 기간이어야 한다.**
 *
 * 처음에 `from` 을 더할 때 SRP 본체 SQL 에만 걸고 **아웃 합산 SQL 에는 안 걸었다**.
 * 그러면 `srp`·`bf` 는 그 기간 것인데 `outs` 는 시즌 누적이라
 * `srpPer9` 가 「그 기간의 SRP ÷ 시즌 아웃」이 된다 — 값이 조용히 무의미해진다.
 * 화면에는 아직 안 나오지만 이건 **공개 함수**라 다음 호출자가 그대로 쓴다(M1).
 * (2026-08-17 1차 검토 지적)
 *
 * ⚠**빈 구간으로는 이걸 못 잰다.** 처음에 그렇게 썼다가 뮤테이션을 놓쳤다 —
 * 타석이 0이면 항목 자체가 안 만들어져서 아웃 SQL 이 무엇을 하든 결과가 같다.
 * **두 날짜에 경기를 두고 한쪽만 남겨야** 어긋남이 드러난다.
 */
test("⚠기간을 좁히면 SRP도 아웃도 그 기간만 센다 — 한쪽만 좁히면 9이닝 환산이 무의미해진다", async () => {
  await withDb((db) => {
    for (const [id, date] of [["g1", "2026-04-01"], ["g2", "2026-04-08"]] as const) {
      upsertGame(db, {
        gameId: id, season: 2026, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
        status: "played", notPlayedReason: null, competition: "regular",
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      });
      upsertPlayer(db, "B1", "타자", NOW);
      upsertPlayer(db, "P1", "투수", NOW);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
      // 경기마다 9아웃씩 — 두 경기면 18, 한 경기만 남기면 9여야 한다
      upsertPitching(db, {
        gameId: id, playerId: "P1", side: "home", decision: null, outs: 9, bf: 12, pitches: null,
        h: 3, hr: 0, bb: 1, hbp: 0, so: 5, runs: 1, er: 1, wp: null, balk: null,
      });
    }

    const both = computeSrp(db, FIXED_RE, ["t", "g"]);
    const p2 = both.find((x) => x.playerId === "P1");
    assert.notEqual(p2, undefined, "투수 항목이 없다 — 이 시험이 아무것도 안 재고 있다");
    assert.equal(p2?.outs, 18, "두 경기분 아웃이 안 잡힌다");

    // 둘째 경기만 남긴다
    const only2 = computeSrp(db, FIXED_RE, ["t", "g"], "regular", "2026-04-08", "2026-04-08");
    const q = only2.find((x) => x.playerId === "P1");
    assert.notEqual(q, undefined, "좁혔더니 투수가 통째로 사라졌다");
    assert.equal(q?.outs, 9, "아웃이 기간을 안 본다 — SRP는 한 경기분인데 아웃은 시즌 누적이다");

    // 기본값은 동작을 바꾸지 않는다
    const again = computeSrp(db, FIXED_RE, ["t", "g"], "regular", "9999-12-31", "0000-01-01");
    assert.deepEqual(
      again.map((x) => [x.playerId, x.outs, x.bf]),
      both.map((x) => [x.playerId, x.outs, x.bf]),
      "기본값이 동작을 바꿨다",
    );
  });
});

/**
 * ⚠**SRC/SRP 는 「선수 × 구단」 단위로 나온다.**
 *
 * 처음에는 선수 ID 하나로만 묶었는데, 그러면 시즌 도중 이적한 선수의 **같은 SRC 가
 * 두 구단 페이지에 그대로 실린다** — 실측(2026): 선수 23125136 이 DeNA 105타석 페이지와
 * ソフトバンク 101타석 페이지에 **둘 다 13.31** 이었다. 같은 행 안에서 打席 는 팀 몫이고
 * SRC 는 시즌 합계라 **분모가 두 종류**가 된다(2026-08-17 2차 검토 지적).
 *
 * ⚠**순위는 반대로 시즌 합계여야 한다** — 부르는 쪽이 선수 단위로 더한다.
 * 나눠 두면 더할 수 있지만, 합쳐 두면 나눌 수 없다.
 */
test("⚠이적하면 SRC 가 구단마다 갈린다 — 같은 값이 두 구단 페이지에 실리지 않는다", async () => {
  await withDb((db) => {
    upsertPlayer(db, "B1", "타자", NOW);
    // 같은 타자가 두 경기에서 **다른 팀 소속**으로 친다(원정/홈을 바꿔 소속을 가른다)
    upsertGame(db, {
      gameId: "g1", season: 2026, gameDate: "2026-04-01", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    upsertGame(db, {
      gameId: "g2", season: 2026, gameDate: "2026-04-08", awayCode: "g", homeCode: "t", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    // half=top 이면 공격은 원정팀 — g1 은 t, g2 는 g 가 된다
    replacePaEvents(db, "g1", [ev({ gameId: "g1", seq: 1, batterId: "B1", outsBefore: 0, bases: "1" })]);
    replacePaEvents(db, "g2", [ev({ gameId: "g2", seq: 1, batterId: "B1", outsBefore: 0, bases: "" })]);

    const out = computeSrc(db, FIXED_RE, ["t", "g"]).filter((x) => x.playerId === "B1");
    assert.equal(out.length, 2, "구단별로 갈리지 않았다 — 이적 선수의 몫이 한 줄로 뭉쳤다");
    assert.deepEqual(out.map((x) => x.teamCode).sort(), ["g", "t"], "구단 코드가 붙지 않았다");
    for (const x of out) assert.equal(x.pa, 1, `${x.teamCode}: 타석이 팀 몫이 아니다`);
    // 두 줄의 값이 서로 다르다 — 같은 값이 두 번 실리던 것이 이 시험이 막는 것이다
    assert.notEqual(out[0]?.src, out[1]?.src, "구단이 달라도 같은 값이 나왔다");
  });
});
