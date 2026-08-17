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

/**
 * ⚠**`犠失` 을 전부 번트로 읽으면 안 된다** — 번트는 외야로 가지 않는다.
 * 외야로 간 희생타는 **플라이**이고, 그 구별이 없으면 그 타석이 `犠飛` 가 아니라 `犠打` 로
 * 세어져 **출루율의 분모가 하나 줄고** 출루율이 실제보다 높게 나온다.
 *
 * 외부 대조가 실제로 잡았다(2024 ヤクルト 2명 — 우리 .234/.316 대 공표 .229/.315).
 * 실측(2023~2026): 이 규칙이 타석 로그 원문(`犠牲フライ` / `犠牲バント`)과
 * **5,860건 전부 일치 · 예외 0건**. `犠失` 134건 중 외야는 2건이었고 둘 다 플라이였다.
 */
test("⚠외야로 간 犠失은 희생플라이다 — 전부 번트로 읽으면 출루율이 높아진다", () => {
  /**
   * ⚠**실재하는 표기로 고정한다.** 처음에는 `左中間犠失` 을 넣었는데 그건 **타석 로그 쪽 표기**이고,
   * 박스 178,420행에서 `左中間`·`右中間` 은 **0건**이다 — 실재하지 않는 문자열을 고정하는
   * 단언은 아무것도 재지 않는다(2026-08-17 이중 검토 지적).
   * 박스의 중간 방향은 `左中`·`右中` 이다(접두어로 4,740건).
   * ⚠실측된 `sacFlyError` 2건은 **둘 다 `中犠失①`** 이므로, 아래 무마커 4건은
   *   「규칙이 있는가」를 재고 실재 형태는 다음 테스트가 잰다.
   */
  for (const raw of ["右犠失", "中犠失", "左犠失", "左中犠失", "右中犠失"]) {
    assert.equal(parsePaCell(raw)?.outcome, "sacFlyError", `${raw} 를 번트로 읽었다`);
  }
  for (const raw of ["投犠失", "捕犠失", "一犠失", "三犠失"]) {
    assert.equal(parsePaCell(raw)?.outcome, "sacBuntError", `${raw} 를 플라이로 읽었다`);
  }
  // 둘 다 희생타이므로 타수에 들어가지 않는다
  assert.equal(countsAsAtBat("sacFlyError"), false);
  assert.equal(countsAsAtBat("sacBuntError"), false);
});

/** 타점 표기(丸数字)가 붙어도 같다 — 실측된 2건이 전부 `①` 을 달고 있었다 */
test("犠失의 위치 판정이 타점 표기에 흔들리지 않는다", () => {
  assert.equal(parsePaCell("中犠失①")?.outcome, "sacFlyError");
  assert.equal(parsePaCell("投犠失①")?.outcome, "sacBuntError");
});
