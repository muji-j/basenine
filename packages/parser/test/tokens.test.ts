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

/**
 * ⚠**주루방해(走妨出)는 타격방해(打妨出)와 다른 사건이다.**
 * 접미어가 한 글자만 다르지만 방해한 대상이 타자가 아니라 주자다.
 * 2024년 아카이브에서 실제로 나와 격리에 잡혔다(2026-08-17) —
 * **소급 시즌에는 지금 어휘에 없는 표기가 더 있을 수 있다**는 신호이기도 하다.
 */
test("⚠주루방해를 타격방해와 같은 것으로 묶지 않는다", () => {
  assert.equal(parsePaCell("走妨出")?.outcome, "obstruction");
  assert.equal(parsePaCell("打妨出")?.outcome, "interference");
  // 둘 다 타수에 들어가지 않는다
  assert.equal(countsAsAtBat("obstruction"), false);
  assert.equal(countsAsAtBat("interference"), false);
});

/**
 * ⚠**「방해」라는 낱말 하나에 정반대 규칙 둘이 들어 있다.**
 * `打妨出`·`走妨出` 은 **출루**(타수 제외), `捕守妨` 은 **아웃**(타수 산입)이다.
 * 이름을 같게 묶으면 타수가 1 줄고 타율이 조용히 올라간다.
 *
 * 실측 근거: 2024/0809 t-c-17 堂林의 박스가 결과 셀 3개(`三ゴロ`·`捕守妨`·`右飛`)에
 * 打数 **3** 이라고 적고 있다. 이 값이 `捕守妨` 을 타수로 세지 않으면 도출 2가 되어 어긋난다.
 */
test("⚠수비방해 아웃은 타수에 들어간다 — 다른 두 방해와 반대다", () => {
  assert.equal(parsePaCell("捕守妨")?.outcome, "interferenceOut");
  assert.equal(countsAsAtBat("interferenceOut"), true, "아웃인데 타수에서 빠졌다");
  // 방향이 반대인 둘과 섞이지 않는다
  assert.equal(countsAsAtBat("interference"), false);
  assert.equal(countsAsAtBat("obstruction"), false);
  // 안타는 아니다
  assert.equal(countsAsHit("interferenceOut"), false);
});

/** 접두어는 방해당한 야수의 위치다 — `捕` 로 고정하면 다른 위치에서 다시 격리된다 */
test("수비방해의 접두어를 고정하지 않는다", () => {
  assert.equal(parsePaCell("一守妨")?.outcome, "interferenceOut");
  assert.equal(parsePaCell("二守妨")?.outcome, "interferenceOut");
});
