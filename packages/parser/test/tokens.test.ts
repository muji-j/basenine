import { test } from "node:test";
import assert from "node:assert/strict";
import { countsAsAtBat, countsAsHit, parsePaCell } from "../src/tokens.ts";
import type { Outcome } from "../src/tokens.ts";

/** 실측 어휘에서 뽑은 대표 토큰. 전부 아카이브에 실재하는 문자열이다. */
const CASES: readonly (readonly [string, Outcome, number])[] = [
  ["三 振", "strikeout", 0],
  ["四 球", "walk", 0],
  ["敬遠四", "intentionalWalk", 0],
  ["死 球", "hitByPitch", 0],
  ["中前安", "single", 0],
  ["左前安①", "single", 1],
  ["遊 安", "single", 0],
  ["左線２", "double", 0],
  ["右線２③", "double", 3],
  ["右中３", "triple", 0],
  ["右中３①", "triple", 1],
  ["左越本①", "homerun", 1],
  ["中越本④", "homerun", 4],
  ["二ゴロ", "fieldedOut", 0],
  ["中 飛", "fieldedOut", 0],
  ["捕邪飛", "fieldedOut", 0],
  ["遊 直", "fieldedOut", 0],
  ["遊併打", "groundedIntoDoublePlay", 0],
  ["投犠打", "sacBunt", 0],
  ["中犠飛①", "sacFly", 1],
  ["三ゴ失", "reachedOnError", 0],
  ["遊ゴ失①", "reachedOnError", 1],
  ["投野選", "fieldersChoice", 0],
  ["振逃", "strikeoutReached", 0],
  ["投犠野①", "sacBuntFieldersChoice", 1],
  ["投犠失", "sacBuntError", 0],
  ["打妨出", "interference", 0],
];

for (const [cell, outcome, rbi] of CASES) {
  test(`「${cell}」 → ${outcome} (타점 ${rbi})`, () => {
    const r = parsePaCell(cell);
    assert.ok(r, "해석 결과가 있어야 한다");
    assert.equal(r.outcome, outcome);
    assert.equal(r.rbi, rbi);
  });
}

test("빈 칸과 하이픈은 타석이 아니다", () => {
  assert.equal(parsePaCell(""), null);
  assert.equal(parsePaCell("-"), null);
  assert.equal(parsePaCell(" "), null);
});

test("⚠三振(삼진)과 三ゴロ(3루수 땅볼)를 혼동하지 않는다", () => {
  // 둘 다 三으로 시작한다. 수비 위치로 앞을 자르면 반드시 틀린다.
  assert.equal(parsePaCell("三 振")?.outcome, "strikeout");
  assert.equal(parsePaCell("三ゴロ")?.outcome, "fieldedOut");
  assert.equal(parsePaCell("三 安")?.outcome, "single");
  assert.equal(parsePaCell("三ゴ失")?.outcome, "reachedOnError");
});

test("⚠희생(犠) 계열은 뒤에 무엇이 붙어도 희생이다", () => {
  // `投犠失`를 失 규칙으로 먼저 잡으면 타수가 1 늘어난다 — 아카이브 대조에서 19건이 이 원인이었다.
  for (const cell of ["投犠失", "投犠野", "一犠野①", "捕犠野"]) {
    const r = parsePaCell(cell);
    assert.ok(r);
    assert.equal(countsAsAtBat(r.outcome), false, `${cell}은 타수가 아니다`);
  }
});

test("⚠振逃는 삼진이면서 출루다 — 타수에는 들어간다", () => {
  const r = parsePaCell("振逃");
  assert.ok(r);
  assert.equal(r.outcome, "strikeoutReached");
  assert.equal(countsAsAtBat(r.outcome), true);
  assert.equal(countsAsHit(r.outcome), false);
});

test("⚠타격방해 출루는 타수가 아니다", () => {
  assert.equal(countsAsAtBat("interference"), false);
  assert.equal(countsAsHit("interference"), false);
});

test("⚠모르는 토큰은 예외가 아니라 unknown이다 — 한 셀 때문에 경기가 통째로 죽지 않게", () => {
  const r = parsePaCell("珍プレー");
  assert.ok(r);
  assert.equal(r.outcome, "unknown");
  assert.equal(r.raw, "珍プレー", "원문을 보존해야 나중에 사람이 판단할 수 있다");
});

test("⚠unknown은 타수에도 안타에도 넣지 않는다", () => {
  assert.equal(countsAsAtBat("unknown"), false);
  assert.equal(countsAsHit("unknown"), false);
});

test("사사구·희생은 타수가 아니고, 안타·아웃은 타수다", () => {
  for (const o of ["walk", "intentionalWalk", "hitByPitch", "sacFly", "sacBunt"] as const) {
    assert.equal(countsAsAtBat(o), false, o);
  }
  for (const o of ["single", "double", "triple", "homerun", "strikeout", "fieldedOut"] as const) {
    assert.equal(countsAsAtBat(o), true, o);
  }
});

test("안타 판정은 4종뿐이다", () => {
  for (const o of ["single", "double", "triple", "homerun"] as const) {
    assert.equal(countsAsHit(o), true, o);
  }
  for (const o of ["walk", "reachedOnError", "fieldersChoice", "strikeoutReached"] as const) {
    assert.equal(countsAsHit(o), false, `${o}은 안타가 아니다`);
  }
});

test("전각 공백도 제거한다", () => {
  assert.equal(parsePaCell("三　振")?.outcome, "strikeout");
});
