/**
 * 투수 연속 기록 — **連続無失点登板**(PSA) 와 **連続無失点イニング**(PSI · 규칙 R).
 *
 * ⚠**여기서 잡는 것은 「길이가 맞는가」보다 「어디서 끊기는가」다.**
 * 규칙 R 과 경합안(「실점 직전까지의 아웃」)은 **1/3회 차이로 갈리고 눈으로는 못 잡는다.**
 * 공표값 대조는 `streaks-published.test.ts`(실DB) 가 하고, 여기서는 **그 규칙의 모양**을 고정한다.
 *
 * ⚠**계승주자 함정을 반드시 재현한다** — `pitching_line.runs = 0` 인데 `pa_event` 가
 * 「실점이 있다」고 말하는 등판이 실측 **1,691건(무실점 등판의 4.8%)** 이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import {
  emptyPitchingStreaks,
  pitchingStreaks,
  rankStreaks,
} from "../src/pitching-streaks.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const P = "P1";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-pstreak-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, P, "투수", NOW);
    upsertPlayer(db, "P2", "다른 투수", NOW);
    upsertPlayer(db, "B1", "타자", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

interface HalfSpec {
  inning: number;
  /** 그 하프이닝에서 **이 투수가** 잡은 아웃 */
  outs: number;
  /** 그 하프이닝에서 **이 투수에게** 붙은 실점(`pa_event.runs_scored`) */
  runs: number;
  /** 그 하프이닝을 던진 투수. 기본 `P` */
  pitcher?: string;
}

/**
 * 등판 하나를 만든다.
 *
 * `boxRuns`/`boxOuts` 를 주면 **박스스코어(`pitching_line`)** 가 그 값이 되고,
 * `halves` 가 **`pa_event`** 를 만든다. ⚠**둘을 일부러 어긋나게 할 수 있어야**
 * 계승주자·불일치 경로를 시험할 수 있다.
 */
function appearance(
  db: Db,
  o: {
    gameId: string;
    date: string;
    season?: number;
    gameNo?: number;
    competition?: string;
    status?: "played" | "notPlayed";
    boxRuns: number;
    boxOuts: number;
    halves?: readonly HalfSpec[];
    pitcher?: string;
  },
): void {
  const season = o.season ?? Number(o.date.slice(0, 4));
  upsertGame(db, {
    gameId: o.gameId,
    season,
    gameDate: o.date,
    awayCode: "t",
    homeCode: "g",
    gameNo: o.gameNo ?? 1,
    status: o.status ?? "played",
    notPlayedReason: null,
    competition: o.competition ?? "regular",
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
  });
  upsertPitching(db, {
    gameId: o.gameId,
    playerId: o.pitcher ?? P,
    side: "away",
    decision: null,
    outs: o.boxOuts,
    bf: null,
    pitches: null,
    h: 0,
    hr: 0,
    bb: 0,
    hbp: 0,
    so: 0,
    runs: o.boxRuns,
    er: o.boxRuns,
    wp: null,
    balk: null,
  });
  if (o.halves === undefined) return;

  // ⚠**하프이닝을 아웃 수만큼의 타석으로 편다.** `outs_before` 가 0,1,2 로 올라가고
  //   마지막 타석은 `3 − outs_before` 로 계산되므로, 3아웃 하프이닝은 타석 3개가 된다
  const rows: PaEventRow[] = [];
  let seq = 0;
  for (const h of o.halves) {
    const n = Math.max(h.outs, 1);
    for (let k = 0; k < n; k += 1) {
      seq += 1;
      rows.push({
        gameId: o.gameId,
        seq,
        inning: h.inning,
        half: "top",
        outsBefore: h.outs === 0 ? 0 : k,
        bases: "",
        batterId: "B1",
        pitcherId: h.pitcher ?? o.pitcher ?? P,
        outcome: "outOther",
        rbi: 0,
        rawBox: "",
        rawPbp: "",
        ballCount: null,
        status: "final",
        // 실점은 그 하프이닝의 **마지막 타석**에 얹는다
        runsScored: k === n - 1 ? h.runs : 0,
      });
    }
  }
  replacePaEvents(db, o.gameId, rows);
}

const scope = { fromSeason: 2020, toSeason: 2030 };

test("무실점 등판이 이어지면 마루가 자란다 · 실점 등판에서 「지금」이 사라진다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "g2", date: "2026-04-02", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "g3", date: "2026-04-03", boxRuns: 1, boxOuts: 3, halves: [{ inning: 1, outs: 3, runs: 1 }] });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 2);
    assert.equal(s.appearances, 3, "분모가 훑은 등판 수가 아니다");
    assert.equal(s.current, null, "마지막 등판에서 실점했는데 「지금」이 남았다");
    assert.equal(s.lastGameDate, "2026-04-03");
  });
});

test("⚠아웃 없이 강판한 무실점 등판도 마루를 잇는다 — 끊지 않는다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "g2", date: "2026-04-02", boxRuns: 0, boxOuts: 0 });
    appearance(db, { gameId: "g3", date: "2026-04-03", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 3, "0아웃 등판이 마루를 끊었다");
    assert.equal(s.best!.interiorOuts, 6);
  });
});

test("⚠등판이 0이면 지도에 없다 · 빈 값은 0이 아니라 null 이다(M11)", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3, pitcher: "P2" });
    const all = pitchingStreaks(db, scope);
    assert.equal(all.has(P), false, "등판 0인 투수가 지도에 들어갔다");
    const e = emptyPitchingStreaks(P, scope);
    assert.equal(e.best, null);
    assert.equal(e.current, null);
    assert.equal(e.appearances, 0);
    assert.equal(e.lastGameDate, null);
  });
});

/**
 * ⚠**이 시험이 규칙 R 의 심장이다.**
 * 하프이닝 [3아웃/0실점, 3아웃/1실점] 인 등판이 마루를 끝냈다면 기여는 **3아웃**이다.
 * 경합안(「실점 직전까지의 아웃」)이면 실점이 2아웃째에 났을 때 **4아웃**이 되어 1/3회가 어긋난다.
 * (정의서 §3-2 山﨑伊織 2025-05-07 의 모양.)
 */
test("⚠규칙 R · 끝 경계 — 실점이 붙은 하프이닝은 통째로 0이다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 21 });
    appearance(db, {
      gameId: "g2",
      date: "2026-04-08",
      boxRuns: 1,
      boxOuts: 6,
      halves: [
        { inning: 1, outs: 3, runs: 0 },
        { inning: 2, outs: 3, runs: 1 },
      ],
    });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.interiorOuts, 21);
    assert.equal(s.best!.innings.lowerOuts, 24, "끝 경계의 기여가 3아웃이 아니다(규칙 R)");
    assert.equal(s.best!.innings.upperOuts, 24);
    assert.equal(s.best!.innings.exact, true);
  });
});

test("⚠규칙 R · 시작 경계 — 마지막 실점 하프이닝 뒤부터 센다", async () => {
  await withDb((db) => {
    appearance(db, {
      gameId: "g0",
      date: "2026-04-01",
      boxRuns: 1,
      boxOuts: 6,
      halves: [
        { inning: 1, outs: 3, runs: 1 },
        { inning: 2, outs: 3, runs: 0 },
      ],
    });
    appearance(db, { gameId: "g1", date: "2026-04-08", boxRuns: 0, boxOuts: 21 });
    appearance(db, { gameId: "g2", date: "2026-04-15", boxRuns: 1, boxOuts: 3, halves: [{ inning: 1, outs: 3, runs: 1 }] });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 1);
    assert.equal(s.best!.innings.lowerOuts, 24, "시작 경계의 기여가 3아웃이 아니다(규칙 R)");
    assert.equal(s.best!.innings.exact, true);
    assert.equal(s.best!.atRangeStart, false);
  });
});

/**
 * ⚠**하프이닝이 1개뿐인 실점 등판은 `pa_event` 를 안 봐도 기여가 0이다** — 실점이 붙은 이상
 * 그 하프이닝에 붙었을 수밖에 없다. **계승주자여도 그렇다**(내보낸 주자는 같은 하프이닝 안에 들어온다).
 * 실측: 경계 등판 12,817건 중 **7,467건(58.3%)** 이 이 경우다.
 * ⚠**石井大智의 시작 경계가 정확히 이 모양이다**(2025-04-04 · 9회 한 하프이닝 · 3아웃 · 1실점.
 * 실점은 2아웃 시점이고 **그 뒤 1아웃을 더 잡았다**).
 */
test("⚠하프이닝 1개뿐인 실점 등판은 pa_event 없이도 확정 · 기여 0", async () => {
  await withDb((db) => {
    // pa_event 를 아예 안 넣는다 — 그래도 하프이닝 1개 판정이 서면 확정이어야 한다…가 아니다.
    // 하프이닝 수를 알려면 pa_event 가 있어야 하므로, 있는 쪽으로 시험한다
    appearance(db, {
      gameId: "g0",
      date: "2026-04-01",
      boxRuns: 1,
      boxOuts: 3,
      halves: [{ inning: 9, outs: 3, runs: 1 }],
    });
    appearance(db, { gameId: "g1", date: "2026-04-02", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.innings.lowerOuts, 3, "한 하프이닝 등판의 기여가 0이 아니다");
    assert.equal(s.best!.innings.upperOuts, 3);
    assert.equal(s.best!.innings.exact, true);
  });
});

/**
 * ⚠**계승주자.** `pitching_line.runs = 0` 인데 `pa_event.runs_scored` 는 실점이 있다고 말한다.
 * 실측 **무실점 등판 35,171건 중 1,691건(4.8%)** — 순진하게 `pa_event` 로 세면
 * **공식적으로 무실점인 등판 21개 중 1개에서 마루가 거짓으로 끊긴다.**
 */
test("⚠계승주자 — pa_event 가 실점을 말해도 pitching_line.runs=0 이면 마루가 안 끊긴다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, {
      gameId: "g2",
      date: "2026-04-02",
      boxRuns: 0,
      boxOuts: 3,
      halves: [{ inning: 7, outs: 3, runs: 2 }],
    });
    appearance(db, { gameId: "g3", date: "2026-04-03", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 3, "계승주자 등판이 마루를 끊었다");
    assert.equal(s.best!.innings.lowerOuts, 9, "마루 안에서 pa_event 를 봤다");
    assert.equal(s.current!.appearances, 3);
  });
});

test("⚠실점 귀속이 안 맞는 경계는 미확정이다 — lower·upper·exact 셋 다 낸다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 21 });
    // 박스는 2실점인데 pa_event 합은 1실점 → 귀속 불일치
    appearance(db, {
      gameId: "g2",
      date: "2026-04-08",
      boxRuns: 2,
      boxOuts: 6,
      halves: [
        { inning: 1, outs: 3, runs: 0 },
        { inning: 2, outs: 3, runs: 1 },
      ],
    });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.innings.exact, false, "귀속이 안 맞는데 확정이라고 했다");
    assert.equal(s.best!.innings.lowerOuts, 21, "미확정 경계의 기여를 0으로 두지 않았다");
    assert.equal(s.best!.innings.upperOuts, 27, "상한이 그 등판의 전체 아웃을 얹지 않았다");
  });
});

test("⚠아웃 합이 안 맞는 경계도 미확정이다 — 하프이닝이 3아웃으로 안 끝난 경우", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 21 });
    // 박스는 5아웃인데 도출은 6아웃(끝내기·주자 아웃으로 이닝 종료)
    appearance(db, {
      gameId: "g2",
      date: "2026-04-08",
      boxRuns: 1,
      boxOuts: 5,
      halves: [
        { inning: 1, outs: 3, runs: 0 },
        { inning: 2, outs: 3, runs: 1 },
      ],
    });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.innings.exact, false);
    assert.equal(s.best!.innings.lowerOuts, 21);
    assert.equal(s.best!.innings.upperOuts, 26);
  });
});

/**
 * ⚠**두 「以上」의 사유가 다르다**(정의서 §1-6).
 * `atRangeStart` = 「그 앞을 우리가 안 봤다」 · `exact=false` = 「실점 시점을 못 짚는다」.
 * **섞어 쓰면 다음 사람이 잘못된 것을 고친다.**
 */
test("⚠atRangeStart 와 exact 는 다른 필드다 — 사유가 다른 두 「以上」", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "g2", date: "2026-04-02", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.atRangeStart, true, "범위 첫 등판에서 시작했는데 아니라고 했다");
    assert.equal(s.best!.open, true, "뒤에 등판이 없는데 끊긴 것으로 했다");
    assert.equal(s.best!.innings.exact, true, "경계가 없는데 미확정이라고 했다");
    assert.equal(s.best!.innings.lowerOuts, 6);
  });
});

test("⚠시즌을 넘는 마루가 이어지고 건너뛴 시즌이 seasons 에서 드러난다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "a", date: "2022-08-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "b", date: "2022-09-01", boxRuns: 0, boxOuts: 3 });
    // 2023 은 등판이 없다
    appearance(db, { gameId: "c", date: "2024-04-01", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, { fromSeason: 2018, toSeason: 2026 }).get(P)!;
    assert.equal(s.best!.appearances, 3);
    assert.deepEqual(s.best!.seasons, [2022, 2024], "건너뛴 시즌이 안 보인다");
    assert.equal(s.best!.from, "2022-08-01");
    assert.equal(s.best!.to, "2024-04-01");
  });
});

test("⚠보고 있는 시즌에서 자른다 — 2022년 화면이 2024년을 말하지 않는다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "a", date: "2022-08-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "c", date: "2024-04-01", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, { fromSeason: 2018, toSeason: 2022 }).get(P)!;
    assert.equal(s.best!.appearances, 1);
    assert.deepEqual(s.best!.seasons, [2022]);
    assert.equal(s.toSeason, 2022, "범위를 결과가 말하지 않는다");
  });
});

test("⚠포스트시즌·미성립 경기를 섞지 않는다", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "cs", date: "2026-10-11", boxRuns: 0, boxOuts: 3, competition: "climaxSeries" });
    appearance(db, { gameId: "no", date: "2026-04-05", boxRuns: 0, boxOuts: 3, status: "notPlayed" });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.appearances, 1, "정규시즌 밖의 등판이 분모에 들어갔다");
    assert.equal(s.best!.appearances, 1);
  });
});

test("⚠더블헤더는 두 경기다 — 정렬은 날짜 → 경기 번호", async () => {
  await withDb((db) => {
    // 경기 ID 의 사전순을 경기 번호와 **반대로** 둔다. 같으면 정렬 없이도 우연히 통과한다
    appearance(db, { gameId: "z-first", date: "2026-04-10", gameNo: 1, boxRuns: 1, boxOuts: 3, halves: [{ inning: 1, outs: 3, runs: 1 }] });
    appearance(db, { gameId: "a-second", date: "2026-04-10", gameNo: 2, boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.appearances, 2, "더블헤더를 한 경기로 셌다");
    assert.equal(s.best!.appearances, 1);
    assert.equal(s.current!.from, "2026-04-10");
    assert.equal(s.current!.interiorOuts, 3, "1차전(실점)을 「지금」에 넣었다");
  });
});

test("⚠음수는 계산하지 않고 던진다 — 조용히 화면에 나가면 안 된다(M7)", async () => {
  await withDb((db) => {
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: -1, boxOuts: 3 });
    assert.throws(() => pitchingStreaks(db, scope), /음수/);
  });
});

test("⚠이닝은 아웃 정수다 — 부동소수를 누적하지 않는다", async () => {
  await withDb((db) => {
    // 1/3 · 2/3 · 1/3 이닝을 이어 붙이면 정확히 4아웃이어야 한다
    appearance(db, { gameId: "g1", date: "2026-04-01", boxRuns: 0, boxOuts: 1 });
    appearance(db, { gameId: "g2", date: "2026-04-02", boxRuns: 0, boxOuts: 2 });
    appearance(db, { gameId: "g3", date: "2026-04-03", boxRuns: 0, boxOuts: 1 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.innings.lowerOuts, 4);
    assert.equal(Number.isInteger(s.best!.innings.lowerOuts), true);
  });
});

/**
 * ⚠**등판 마루와 이닝 마루는 다른 마루일 수 있다.**
 * 짧지만 긴 이닝(선발)과 길지만 짧은 이닝(구원)이 한 투수에게 같이 있는 경우다.
 */
test("⚠best(등판)와 bestInnings(이닝)가 다른 마루를 가리킬 수 있다", async () => {
  await withDb((db) => {
    // 마루 A: 2등판 · 42아웃(선발 7이닝 두 번)
    appearance(db, { gameId: "a1", date: "2026-04-01", boxRuns: 0, boxOuts: 21 });
    appearance(db, { gameId: "a2", date: "2026-04-08", boxRuns: 0, boxOuts: 21 });
    appearance(db, { gameId: "x", date: "2026-04-15", boxRuns: 1, boxOuts: 3, halves: [{ inning: 1, outs: 3, runs: 1 }] });
    // 마루 B: 3등판 · 9아웃
    appearance(db, { gameId: "b1", date: "2026-04-20", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "b2", date: "2026-04-21", boxRuns: 0, boxOuts: 3 });
    appearance(db, { gameId: "b3", date: "2026-04-22", boxRuns: 0, boxOuts: 3 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 3, "등판 기준 최장이 아니다");
    assert.equal(s.bestInnings!.innings.lowerOuts, 42, "이닝 기준 최장이 아니다");
    assert.equal(s.bestInnings!.appearances, 2);
  });
});

test("⚠bestInnings 는 하한으로 고른다 — 모를수록 길어지면 안 된다", async () => {
  await withDb((db) => {
    // ⚠**미확정 경계를 마루 A 쪽에만 붙인다** — 이웃한 두 마루는 경계 등판을 **공유**하므로
    //   가운데에 두면 양쪽 다 미확정이 되어 이 시험이 아무것도 안 잡는다
    appearance(db, {
      gameId: "x0",
      date: "2026-04-01",
      boxRuns: 2,
      boxOuts: 24,
      halves: [
        { inning: 1, outs: 3, runs: 0 },
        { inning: 2, outs: 3, runs: 1 },
      ],
    });
    // 마루 A: 3아웃이지만 시작 경계가 미확정이라 **상한이 크다**
    appearance(db, { gameId: "a1", date: "2026-04-02", boxRuns: 0, boxOuts: 3 });
    // 한 하프이닝뿐이라 **확정**인 경계
    appearance(db, { gameId: "x1", date: "2026-04-03", boxRuns: 1, boxOuts: 3, halves: [{ inning: 9, outs: 3, runs: 1 }] });
    // 마루 B: 6아웃 · 확정
    appearance(db, { gameId: "b1", date: "2026-04-04", boxRuns: 0, boxOuts: 6 });
    const s = pitchingStreaks(db, scope).get(P)!;
    assert.equal(s.best!.appearances, 1);
    assert.equal(s.bestInnings!.innings.lowerOuts, 6, "상한이 큰 미확정 마루가 이겼다");
    assert.equal(s.bestInnings!.innings.exact, true);
  });
});

/**
 * ⚠**공표값 대조 ③(石井大智 시즌 넘김 50.0回)의 「모양」을 합성으로 고정한다.**
 *
 * 실DB 쪽은 **2026-09-05 복귀 등판이 로컬 DB 에 없어서** 아직 못 잰다
 * (`streaks-published.test.ts` 가 그 건을 **skip 으로 센다** — 「0건 = 합격」이 아니다).
 * 여기서 고정하는 것은 **「시즌 넘김 마루의 아웃이 그냥 더해진다」**는 성질이다:
 * 2025분 147아웃(49.0回) + 2026 복귀 1回(3아웃) = **150아웃 = 50.0回**.
 * ⚠**공표도 「50回（2025〜2026年）※更新中」이다** — 진행형이라 값 자체는 낡는다.
 */
test("⚠시즌 넘김 마루의 이닝은 그냥 더해진다 — 147 + 3 = 150아웃(50.0回)", async () => {
  await withDb((db) => {
    // 2025: 마지막 실점 등판(한 하프이닝 · 확정 · 기여 0) → 무실점 등판들 합 147아웃
    appearance(db, {
      gameId: "s25-0",
      date: "2025-04-04",
      boxRuns: 1,
      boxOuts: 3,
      halves: [{ inning: 9, outs: 3, runs: 1 }],
    });
    appearance(db, { gameId: "s25-1", date: "2025-04-05", boxRuns: 0, boxOuts: 147 });
    // 2026: 복귀 등판 1回 무실점
    appearance(db, { gameId: "s26-1", date: "2026-09-05", boxRuns: 0, boxOuts: 3 });

    const s = pitchingStreaks(db, { fromSeason: 2018, toSeason: 2026 }).get(P)!;
    assert.equal(s.best!.appearances, 2);
    assert.equal(s.best!.innings.lowerOuts, 150, "시즌 넘김에서 아웃이 안 더해졌다");
    assert.equal(s.best!.innings.exact, true);
    assert.deepEqual(s.best!.seasons, [2025, 2026], "넘긴 시즌이 안 보인다");
    assert.equal(s.best!.open, true, "아직 안 끊겼는데 끊긴 것으로 했다");
  });
});

test("⚠순위 — 동률은 같은 순위, 다음을 건너뛴다 · 「以上」은 순위 null", () => {
  const ranked = rankStreaks([
    { playerId: "c", value: 10, outs: 30, to: "2025-05-01", rankable: true },
    { playerId: "a", value: 12, outs: 36, to: "2025-04-01", rankable: true },
    { playerId: "b", value: 10, outs: 31, to: "2025-06-01", rankable: true },
    { playerId: "d", value: 9, outs: 27, to: "2025-07-01", rankable: true },
    { playerId: "e", value: 11, outs: 33, to: "2025-08-01", rankable: false },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.playerId, r.rank]),
    [
      ["a", 1],
      ["e", null],
      ["b", 2],
      ["c", 2],
      ["d", 4],
    ],
    "동률 처리·「以上」·2차 정렬 중 하나가 어긋났다",
  );
});

test("⚠순위의 2차 정렬에 playerId 가 들어간다 — 없으면 빌드마다 diff 가 흔들린다", () => {
  const rows = [
    { playerId: "zzz", value: 5, outs: 15, to: "2025-05-01", rankable: true },
    { playerId: "aaa", value: 5, outs: 15, to: "2025-05-01", rankable: true },
    { playerId: "mmm", value: 5, outs: 15, to: "2025-05-01", rankable: true },
  ];
  const a = rankStreaks(rows).map((r) => r.playerId);
  const b = rankStreaks([...rows].reverse()).map((r) => r.playerId);
  assert.deepEqual(a, ["aaa", "mmm", "zzz"]);
  assert.deepEqual(a, b, "입력 순서가 결과를 바꿨다 — 정적 생성에서 diff 가 흔들린다");
});
