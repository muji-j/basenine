/**
 * **끝내기(walk-off)로 잘린 하프이닝을 RE 행렬이 어떻게 다루는가.**
 *
 * ⚠**끝내기는 규칙으로 끝난다** — 3아웃까지 가지 않는다. 그래서 그 하프이닝의 「남은 득점」은
 * **잘린 값**이다. 정상 이닝과 같이 세면 행렬이 치우치는데, **방향이 하나가 아니다**:
 *   · **선택 효과(대부분)** — 끝내기 이닝은 「홈이 득점한 이닝」만 골라 담는다 → RE 를 **올린다**
 *   · **절단 효과(만루 계열)** — 이길 점수가 나는 순간 멈춘다 → RE 를 **내린다**
 *
 * 실측(2026-08-25 · 완결 8시즌 × 2리그 · 끝내기 **834개**):
 * 제외하면 상태-리그-시즌 **384개 중 내림 287 · 오름 70**, 최대 **2024 퍼시픽 `123|0` +0.0687**.
 * ⚠**감사(#7)가 적은 것은 「오름」 쪽 하나(2025 센트럴 +0.026)뿐이라 방향이 반대로 읽힌다.**
 *
 * 화면으로 번지는 크기(완결 8시즌 · 16 리그-시즌 · 자격 타자 **418명**):
 * `|Δ wOBA|` 중앙 **0.0001** 최대 **0.0014** · `|Δ wRC+|` 중앙 **0.11** 최대 **0.69** ·
 * **1위가 바뀐 리그-시즌 0/16**.
 * ⚠비교: 1.02 의존을 끊었을 때는 `|Δ wRC+|` 중앙 **1.01** 최대 **10.00** 이었다(CLAUDE.md §2-2).
 *
 * ⚠**기본은 `exclude` 다**(사용자 결정 2026-08-25). 되돌리는 스위치는 남긴다.
 * 여기서 지키는 것은 **「그 선택이 코드에 이름을 갖고, 두 경로가 갈리지 않는다」**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { buildRunExpectancy, halfKey, stateKey, walkoffHalves } from "../src/run-expectancy.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function ev(o: Partial<PaEventRow> & { gameId: string; seq: number }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    batterId: "B1", pitcherId: "P1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-wo-"));
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

function seedGame(db: Db, id: string, homeRuns: number | null, awayRuns: number | null): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: "2026-04-01", awayCode: "t", homeCode: "g", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, homeRuns, awayRuns,
  });
}

/** 판정에 필요한 최소 행 */
function row(
  gameId: string, inning: number, half: string, seq: number,
  homeRuns: number | null, awayRuns: number | null,
) {
  return { gameId, inning, half, seq, homeRuns, awayRuns };
}

test("끝내기 = 마지막 하프이닝 · 말 공격 · 홈 승리", () => {
  const rows = [
    row("g1", 1, "top", 1, 3, 2),
    row("g1", 1, "bottom", 2, 3, 2),
    row("g1", 9, "bottom", 3, 3, 2), // ← 마지막 · 말 · 홈 승 = 끝내기
  ];
  assert.deepEqual([...walkoffHalves(rows)], [halfKey(row("g1", 9, "bottom", 3, 3, 2))]);
});

/** ⚠**무승부는 끝내기가 아니다** — 동점으로 끝난 말 공격은 3아웃까지 갔다 */
test("⚠무승부로 끝난 말 공격은 끝내기가 아니다", () => {
  const rows = [row("g1", 1, "top", 1, 2, 2), row("g1", 9, "bottom", 2, 2, 2)];
  assert.equal(walkoffHalves(rows).size, 0);
});

/** 원정이 이겼으면 마지막 말 공격은 3아웃까지 간 것이다 */
test("홈이 졌으면 끝내기가 아니다", () => {
  const rows = [row("g1", 9, "top", 1, 1, 5), row("g1", 9, "bottom", 2, 1, 5)];
  assert.equal(walkoffHalves(rows).size, 0);
});

/** 마지막 하프이닝이 표(top)면 끝내기일 수 없다 */
test("마지막이 초 공격이면 끝내기가 아니다", () => {
  const rows = [row("g1", 9, "bottom", 1, 5, 1), row("g1", 9, "top", 2, 5, 1)];
  assert.equal(walkoffHalves(rows).size, 0);
});

/** ⚠**「모른다」를 「그렇다」로 바꾸지 않는다**(M11) */
test("⚠득점을 모르면(NULL) 끝내기로 치지 않는다", () => {
  const rows = [row("g1", 9, "bottom", 1, null, null)];
  assert.equal(walkoffHalves(rows).size, 0);
});

/** 경기가 여럿이면 각 경기의 마지막을 따로 본다 */
test("경기마다 따로 판정한다", () => {
  const rows = [
    row("g1", 9, "bottom", 1, 3, 2),
    row("g2", 1, "top", 1, 0, 4),
    row("g2", 9, "bottom", 2, 0, 4),
  ];
  assert.deepEqual([...walkoffHalves(rows)], ["g1|9|bottom"]);
});

test("⚠기본은 exclude 다 — 바꾸면 화면의 전 타격 지표가 같이 움직인다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 3, 2);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, inning: 1, half: "top", outsBefore: 0, bases: "123", runsScored: 2 }),
      ev({ gameId: "g1", seq: 2, inning: 9, half: "bottom", outsBefore: 0, bases: "123", runsScored: 1 }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["g", "t"]);
    assert.equal(re.walkoff, "exclude", "기본값이 바뀌었다 — wOBA 계수·wRC+·SRC·RE24·WPA 가 전부 움직인다");
    // ⚠**제외해도 몇 개를 뺐는지 말한다**(작업규칙 7)
    assert.equal(re.walkoffHalves, 1);
    assert.equal(re.matrix.get(stateKey("123", 0)), 2, "잘린 쪽이 빠지고 초 공격만 남아야 한다");
  });
});

/** ⚠**되돌리는 스위치는 남긴다** — 「화면이 얼마나 움직이는지」를 수로 다시 답할 수 있어야 한다 */
test("include 로 부르면 끝내기 타석이 그대로 들어간다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 3, 2);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, inning: 1, half: "top", outsBefore: 0, bases: "123", runsScored: 2 }),
      ev({ gameId: "g1", seq: 2, inning: 9, half: "bottom", outsBefore: 0, bases: "123", runsScored: 1 }),
    ]);
    const re = buildRunExpectancy(db, 2026, "central", ["g", "t"], "regular", "9999-12-31", "include");
    assert.equal(re.walkoff, "include");
    assert.equal(re.matrix.get(stateKey("123", 0)), 1.5, "두 타석의 평균이어야 한다");
  });
});

/** ⚠**이것이 고친 대상이다** — 고치기 전에는 이 선택 자체가 존재하지 않았다 */
test("⚠exclude 로 부르면 끝내기 하프이닝이 행렬에서 빠진다", async () => {
  await withDb((db) => {
    seedGame(db, "g1", 3, 2);
    replacePaEvents(db, "g1", [
      ev({ gameId: "g1", seq: 1, inning: 1, half: "top", outsBefore: 0, bases: "123", runsScored: 2 }),
      ev({ gameId: "g1", seq: 2, inning: 9, half: "bottom", outsBefore: 0, bases: "123", runsScored: 1 }),
    ]);
    const inc = buildRunExpectancy(db, 2026, "central", ["g", "t"], "regular", "9999-12-31", "include");
    const exc = buildRunExpectancy(db, 2026, "central", ["g", "t"], "regular", "9999-12-31", "exclude");
    assert.equal(inc.matrix.get(stateKey("123", 0)), 1.5, "두 타석의 평균이어야 한다");
    assert.equal(exc.matrix.get(stateKey("123", 0)), 2, "잘린 쪽을 빼면 초 공격만 남는다");
    assert.equal(exc.walkoff, "exclude");
    assert.equal(exc.walkoffHalves, 1, "제외해도 몇 개를 뺐는지 말한다");
    assert.ok(exc.totalPa < inc.totalPa, "타석 수가 줄어야 한다");
  });
});
