/**
 * **선형가중치 유도** — 「어느 사건이 몇 점을 만들었는가」를 우리 로그에서 재는 부분.
 *
 * ⚠**이 파일이 지키는 것은 두 가지다.**
 * ⑴ **원점의 정의** — 계수가 0인 사건 **전체**의 평균이다(삼진만도, 범타만도 아니다).
 *    원점이 밀리면 계수 전체가 통째로 밀리고, **그 밀림은 값이 그럴듯해서 눈으로 안 잡힌다.**
 * ⑵ **분모의 정의와의 일치** — 어느 결과가 wOBA 분모에 들어가는가는 이미 두 곳이 알고 있다
 *    (`wobaDenominator` · `countsAsAtBat`). 여기서 셋째 벌을 만들면 언젠가 갈린다(M1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { OUTCOMES, countsAsAtBat } from "@bb-app/parser";
import type { Outcome } from "@bb-app/parser";
import { wobaDenominator } from "@bb-app/metrics";
import type { BattingLine } from "@bb-app/metrics";
import { emptyBattingLine, foldOutcomes } from "@bb-app/store";
import { buildRunExpectancy } from "../src/run-expectancy.ts";
import { WOBA_EVENTS, deriveRunValues, wobaSlotOf } from "../src/woba-weights.ts";

const NOW = "2026-08-15T00:00:00.000Z";
const CODES = ["g", "t"] as const;

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    batterId: "B1", pitcherId: "P1", outcome: "fieldedOut", rbi: 0, runsScored: 0,
    rawBox: "投ゴロ", rawPbp: "ピッチャーゴロ", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-lw-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "B1", "타자", NOW);
    upsertPlayer(db, "P1", "투수", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function seedGame(db: Db, id: string, date = "2026-04-01"): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: date, awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
  });
}

// ─── 분류표가 분모의 정의와 어긋나지 않는가 ────────────────────────────────

/** 그 결과 하나를 접었을 때 wOBA 분모가 1 늘어나는가 — **`fold.ts` 를 통해서만 묻는다** */
function inDenominator(outcome: Outcome): boolean {
  const before: BattingLine = emptyBattingLine();
  const after = foldOutcomes([{ outcome, count: 1, rbi: 0 }]).line;
  return wobaDenominator(after) - wobaDenominator(before) === 1;
}

test("⚠분류표가 wOBA 분모의 정의와 한 건도 안 어긋난다 — 셋째 벌을 만들지 않기 위한 그물", () => {
  const wrong: string[] = [];
  for (const outcome of OUTCOMES) {
    const slot = wobaSlotOf(outcome);
    const shouldBeInside = inDenominator(outcome);
    const isInside = slot.kind !== "outside";
    if (shouldBeInside !== isInside) {
      wrong.push(`${outcome}: 분모 ${shouldBeInside} 인데 분류는 ${slot.kind}`);
    }
  }
  assert.deepEqual(wrong, [], "분류표와 wobaDenominator 가 갈렸다 — 계수가 조용히 틀린다");
});

test("⚠분모가 1 늘지 않는 결과는 전부 outside 다 — 敬遠·犠打·방해 출루", () => {
  for (const outcome of ["intentionalWalk", "sacBunt", "sacBuntFieldersChoice", "sacBuntError",
    "interference", "obstruction", "unknown"] as const) {
    assert.equal(wobaSlotOf(outcome).kind, "outside", outcome);
  }
});

test("⚠타수에 들어가는 아웃은 전부 원점 쪽이다 — 「계수 0」과 「분모 밖」은 다르다(M11)", () => {
  for (const outcome of ["strikeout", "fieldedOut", "groundedIntoDoublePlay",
    "interferenceOut", "ruleViolationOut"] as const) {
    assert.ok(countsAsAtBat(outcome), `${outcome} 이 타수가 아니게 됐다 — 전제가 바뀌었다`);
    assert.equal(wobaSlotOf(outcome).kind, "zero", outcome);
  }
});

test("계수가 붙는 사건은 7개이고 `WobaWeights` 의 키와 같다", () => {
  const found = new Set<string>();
  for (const outcome of OUTCOMES) {
    const slot = wobaSlotOf(outcome);
    if (slot.kind === "weighted") found.add(slot.event);
  }
  assert.deepEqual([...found].sort(), [...WOBA_EVENTS].sort());
});

// ─── 유도 자체 ───────────────────────────────────────────────────────────

/**
 * ⚠**손으로 계산할 수 있는 최소 로그**를 만든다.
 *
 * 한 이닝짜리 경기 4개. 무사 주자없음에서 시작해 결과 하나가 나고 이닝이 끝난다.
 * → RE(무사 주자없음) = (1 + 0 + 0 + 0) / 4 = **0.25**
 *   (홈런 경기만 1점, 나머지 셋은 0점)
 * → 각 타석의 값 = 0(이닝 끝) − 0.25 + 그 타석의 득점
 *   홈런 **+0.75** · 나머지 셋 **−0.25**
 * → 원점 = 계수 0인 사건(삼진 · 범타 두 개)의 평균 = **−0.25**
 * → 홈런의 선형가중치 = 0.75 − (−0.25) = **1.0**
 */
test("⚠선형가중치 = (그 사건의 평균 득점가치) − (계수 0인 사건들의 평균) — 손으로 검산한다", async () => {
  await withDb((db) => {
    const cases: { id: string; outcome: Outcome; runs: number }[] = [
      { id: "g1", outcome: "homerun", runs: 1 },
      { id: "g2", outcome: "strikeout", runs: 0 },
      { id: "g3", outcome: "fieldedOut", runs: 0 },
      { id: "g4", outcome: "fieldedOut", runs: 0 },
    ];
    for (const c of cases) {
      seedGame(db, c.id);
      replacePaEvents(db, c.id, [
        ev({ gameId: c.id, seq: 1, outcome: c.outcome, runsScored: c.runs }),
      ]);
    }

    const re = buildRunExpectancy(db, 2026, "central", CODES);
    assert.equal(re.matrix.get("-|0"), 0.25, "RE 가 0.25 가 아니다 — 픽스처의 전제가 깨졌다");

    // ⚠홈런만 있으면 다른 계수의 표본이 0이라 던진다. 그것 자체가 지켜야 할 성질이다
    assert.throws(() => deriveRunValues(db, re, CODES), /표본이 0이다/);
  });
});

test("⚠계수 7종이 다 있으면 원점과 각 계수가 손계산과 일치한다", async () => {
  await withDb((db) => {
    /**
     * 이닝마다 타석 하나. 득점은 그 타석에서 난 것으로 둔다.
     * RE(무사 주자없음) = 총득점 ÷ 이닝 수.
     */
    const cases: { outcome: Outcome; runs: number }[] = [
      { outcome: "homerun", runs: 1 },
      { outcome: "triple", runs: 0 },
      { outcome: "double", runs: 0 },
      { outcome: "single", runs: 0 },
      { outcome: "walk", runs: 0 },
      { outcome: "hitByPitch", runs: 0 },
      { outcome: "reachedOnError", runs: 0 },
      { outcome: "strikeout", runs: 0 },
      { outcome: "fieldedOut", runs: 0 },
      { outcome: "sacFly", runs: 1 },
    ];
    cases.forEach((c, i) => {
      const id = `w${i}`;
      seedGame(db, id);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, outcome: c.outcome, runsScored: c.runs })]);
    });

    const re = buildRunExpectancy(db, 2026, "central", CODES);
    const base = re.matrix.get("-|0")!;
    assert.ok(Math.abs(base - 2 / 10) < 1e-12, `RE ${base} — 10이닝 2점이어야 한다`);

    const d = deriveRunValues(db, re, CODES);
    assert.equal(d.skipped, 0);
    assert.equal(d.unrecognized, 0);

    // 원점 = 계수 0인 셋(삼진 −0.2 · 범타 −0.2 · 희생플라이 +0.8)의 평균
    const expectedOrigin = (-base + -base + (1 - base)) / 3;
    assert.ok(
      Math.abs(d.origin - expectedOrigin) < 1e-12,
      `원점 ${d.origin} — ${expectedOrigin} 이어야 한다(삼진·범타·희생플라이의 평균)`,
    );
    assert.equal(d.originSamples, 3);

    // 홈런은 1점 났으므로 값 = 1 − 0.2 = 0.8, 계수 = 0.8 − 원점
    assert.ok(Math.abs(d.runValues.hr - (1 - base - expectedOrigin)) < 1e-12);
    // 볼넷은 점이 안 났으므로 값 = −0.2, 계수 = −0.2 − 원점 (음수여도 그대로 낸다)
    assert.ok(Math.abs(d.runValues.bb - (-base - expectedOrigin)) < 1e-12);
    for (const e of WOBA_EVENTS) assert.equal(d.samples[e], 1, e);
  });
});

test("⚠희생플라이는 원점 쪽에 **들어간다** — 분모에 있으면서 계수가 0이기 때문이다", async () => {
  assert.equal(wobaSlotOf("sacFly").kind, "zero");
  assert.equal(wobaSlotOf("sacFlyError").kind, "zero");
  // 희생번트는 분모 밖이라 원점에 영향을 주지 않는다 — 둘을 같이 다루면 원점이 밀린다
  assert.equal(wobaSlotOf("sacBunt").kind, "outside");
});

test("⚠실책 출루를 원점으로 옮기면 계수가 0이 되고 표본도 0이 된다 — 「아웃과 같다」는 주장이다", async () => {
  await withDb((db) => {
    const cases: { outcome: Outcome; runs: number }[] = [
      { outcome: "homerun", runs: 1 }, { outcome: "triple", runs: 0 },
      { outcome: "double", runs: 0 }, { outcome: "single", runs: 0 },
      { outcome: "walk", runs: 0 }, { outcome: "hitByPitch", runs: 0 },
      // ⚠**실책 출루에 점을 붙인다** — 안 붙이면 값이 아웃과 같아져서
      //   「계수가 0이 됐다」가 스위치 덕인지 우연인지 구별되지 않는다
      { outcome: "reachedOnError", runs: 1 }, { outcome: "strikeout", runs: 0 },
    ];
    cases.forEach((c, i) => {
      const id = `r${i}`;
      seedGame(db, id);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, outcome: c.outcome, runsScored: c.runs })]);
    });
    const re = buildRunExpectancy(db, 2026, "central", CODES);

    const kept = deriveRunValues(db, re, CODES);
    const dropped = deriveRunValues(db, re, CODES, "regular", "9999-12-31", "zero");
    assert.equal(dropped.runValues.roe, 0);
    assert.equal(dropped.samples.roe, 0);
    assert.notEqual(kept.runValues.roe, 0);
    // 원점이 움직인다 — 실책 출루가 원점 집합에 들어갔으므로
    assert.notEqual(kept.origin, dropped.origin);
    assert.equal(dropped.originSamples, kept.originSamples + 1);
  });
});

test("⚠다른 대회를 섞지 않는다 — 올스타 타석이 정규시즌 계수에 들어가면 안 된다(§2-1)", async () => {
  await withDb((db) => {
    const cases: { outcome: Outcome; runs: number }[] = [
      { outcome: "homerun", runs: 1 }, { outcome: "triple", runs: 0 },
      { outcome: "double", runs: 0 }, { outcome: "single", runs: 0 },
      { outcome: "walk", runs: 0 }, { outcome: "hitByPitch", runs: 0 },
      { outcome: "reachedOnError", runs: 0 }, { outcome: "strikeout", runs: 0 },
    ];
    cases.forEach((c, i) => {
      const id = `c${i}`;
      seedGame(db, id);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, outcome: c.outcome, runsScored: c.runs })]);
    });
    const re = buildRunExpectancy(db, 2026, "central", CODES);
    const before = deriveRunValues(db, re, CODES);

    // 올스타에 홈런 10개를 넣는다. 정규시즌 계수는 **1도 안 움직여야 한다**
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-20", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allstar",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    });
    replacePaEvents(
      db,
      "as1",
      Array.from({ length: 10 }, (_, i) =>
        ev({ gameId: "as1", seq: i + 1, inning: i + 1, outcome: "homerun", runsScored: 1 })),
    );

    const after = deriveRunValues(db, re, CODES);
    assert.deepEqual({ ...after.runValues }, { ...before.runValues });
    assert.equal(after.samples.hr, before.samples.hr);
  });
});

// ─── 「숨기지 않는다」의 두 카운터 ──────────────────────────────────────────

/**
 * ⚠**세는 코드가 있는데 아무도 안 읽으면 감시 장치가 아니다**(2026-08-21 최종 검토 P2-②).
 * 화면 경로가 `.runValues` 만 꺼내면서 이 둘을 그 줄에서 버리고 있었다. 지금은
 * `SiteData.wobaDerivation` 으로 나오고 빌드가 그것으로 배포를 막는다.
 *
 * ⚠**그런데 실데이터에서는 둘 다 늘 0이라, 값이 진짜인지 실데이터로는 증명할 수 없다.**
 * 「0건」과 「안 쟀음」을 가르는 것이 이 시험이다 — **0이 아닌 상태를 일부러 만들어** 센다.
 */
test("⚠하프이닝 중간의 타석이 빠지면 skipped 로 센다 — 그때 값이 빠지는 게 아니라 남은 값이 틀린다", async () => {
  await withDb((db) => {
    // 계수 7종의 표본을 채운다(없으면 유도 자체가 던진다)
    const cases: { outcome: Outcome; runs: number }[] = [
      { outcome: "homerun", runs: 1 }, { outcome: "triple", runs: 0 },
      { outcome: "double", runs: 0 }, { outcome: "single", runs: 0 },
      { outcome: "walk", runs: 0 }, { outcome: "hitByPitch", runs: 0 },
      { outcome: "reachedOnError", runs: 0 }, { outcome: "strikeout", runs: 0 },
      { outcome: "fieldedOut", runs: 0 },
    ];
    cases.forEach((c, i) => {
      const id = `s${i}`;
      seedGame(db, id);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, outcome: c.outcome, runsScored: c.runs })]);
    });

    const re = buildRunExpectancy(db, 2026, "central", CODES);
    const clean = deriveRunValues(db, re, CODES);
    assert.equal(clean.skipped, 0, "구멍이 없는데 skipped 가 0이 아니다 — 이 시험이 다른 것을 잰다");

    /**
     * **같은 하프이닝 안에 seq 구멍을 만든다**(1 · 2 · 4).
     * seq 2 의 「다음 행」이 seq 4 가 되므로 **두 타석분의 변화를 한 타석에 실을 뻔한 자리**이고,
     * `afterStateOf` 가 그것을 `null` 로 돌려 계산을 거부한다 — 그 수가 `skipped` 다.
     */
    seedGame(db, "gap");
    replacePaEvents(db, "gap", [1, 2, 4].map((seq) => ev({ gameId: "gap", seq, outcome: "fieldedOut" })));

    const holed = deriveRunValues(db, re, CODES);
    assert.equal(holed.skipped, 1, "하프이닝 중간이 빠졌는데 세지 않았다");
    assert.equal(holed.unrecognized, 0, "모르는 결과 문자열이 없는데 셌다");
    // ⚠**빠진 타석은 유도에도 안 들어간다** — 세 개 중 둘만 쓴다
    assert.equal(holed.usedPa, clean.usedPa + 2, "쓴 타석 수가 안 맞는다");
  });
});

/**
 * ⚠**모르는 결과 문자열을 「아웃」으로 흘리지 않는다**(M7·M11).
 * 파서 어휘가 DB 보다 낡으면 그 타석들이 조용히 원점 쪽으로 떨어져 **계수 전체가 밀린다.**
 * ⚠**타입을 우회해 넣는다** — 정상 경로로는 만들 수 없는 상태이고, 그래서 시험이 필요하다.
 */
test("⚠모르는 결과 문자열은 unrecognized 로 센다 — 원점 쪽으로 흘리지 않는다", async () => {
  await withDb((db) => {
    const cases: { outcome: Outcome; runs: number }[] = [
      { outcome: "homerun", runs: 1 }, { outcome: "triple", runs: 0 },
      { outcome: "double", runs: 0 }, { outcome: "single", runs: 0 },
      { outcome: "walk", runs: 0 }, { outcome: "hitByPitch", runs: 0 },
      { outcome: "reachedOnError", runs: 0 }, { outcome: "strikeout", runs: 0 },
      { outcome: "fieldedOut", runs: 0 },
    ];
    cases.forEach((c, i) => {
      const id = `u${i}`;
      seedGame(db, id);
      replacePaEvents(db, id, [ev({ gameId: id, seq: 1, outcome: c.outcome, runsScored: c.runs })]);
    });
    seedGame(db, "odd");
    replacePaEvents(db, "odd", [ev({ gameId: "odd", seq: 1, outcome: "fieldedOut" })]);

    const re = buildRunExpectancy(db, 2026, "central", CODES);
    const before = deriveRunValues(db, re, CODES);
    assert.equal(before.unrecognized, 0, "정상 픽스처인데 모르는 문자열이 있다");

    // 파서가 모르는 어휘가 DB 에 들어온 상태를 만든다
    db.raw.prepare("UPDATE pa_event SET outcome = ? WHERE game_id = 'odd'").run("フォースアウト裏");
    const after = deriveRunValues(db, re, CODES);
    assert.equal(after.unrecognized, 1, "모르는 결과 문자열을 세지 않았다");
    // ⚠**원점에 안 들어갔는가** — 들어갔으면 표본이 그대로 남는다
    assert.equal(after.originSamples, before.originSamples - 1, "모르는 문자열이 원점 쪽으로 흘렀다");
  });
});
