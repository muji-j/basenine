/**
 * 라인스코어 — 득점·안타·실책.
 *
 * ⚠**`H`·`E`는 낱말이 아니라 열 머리 한 글자로만 나온다.** 페이지 어디에도 「失策」이라는
 * 낱말이 없어서, 낱말로 찾으면 영원히 못 찾는다(2026-08-15에 실제로 그렇게 놓치고 있었다).
 * ⚠**자리로 세지 않는다.** 연장전이면 이닝 열이 늘어 위치가 밀린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLineScore } from "../src/linescore.ts";

function table(header: string, away: string, home: string): string {
  return `<table id="tablefix_ls">
    <tr>${header}</tr>
    <tr>${away}</tr>
    <tr>${home}</tr>
  </table>`;
}

const NINE = table(
  `<th>&nbsp;</th><th>1</th><th>2</th><th>3</th><th>計</th><th>H</th><th>E</th>`,
  `<th>日本ハム</th><td>0</td><td>1</td><td>1</td><td>2</td><td>8</td><td>0</td>`,
  `<th>オリックス</th><td>2</td><td>0</td><td>4</td><td>6</td><td>8</td><td>1</td>`,
);

test("득점·안타·실책을 함께 읽는다", () => {
  const ls = parseLineScore(NINE);
  assert.equal(ls.awayTotal, 2);
  assert.equal(ls.homeTotal, 6);
  assert.equal(ls.awayHits, 8);
  assert.equal(ls.homeHits, 8);
  assert.equal(ls.awayErrors, 0);
  assert.equal(ls.homeErrors, 1);
});

test("⚠연장전이라 이닝 열이 늘어도 H·E를 찾는다 — 자리로 세지 않기 때문이다", () => {
  const ext = table(
    `<th>&nbsp;</th><th>1</th><th>2</th><th>3</th><th>10</th><th>11</th><th>計</th><th>H</th><th>E</th>`,
    `<th>A</th><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td><td>3</td><td>11</td><td>2</td>`,
    `<th>B</th><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>4</td><td>0</td>`,
  );
  const ls = parseLineScore(ext);
  assert.equal(ls.awayTotal, 3);
  assert.equal(ls.awayHits, 11);
  assert.equal(ls.awayErrors, 2);
  assert.equal(ls.homeHits, 4);
});

test("⚠H·E 열이 없으면 0이 아니라 null이다(M11)", () => {
  const noHe = table(
    `<th>&nbsp;</th><th>1</th><th>計</th>`,
    `<th>A</th><td>1</td><td>1</td>`,
    `<th>B</th><td>2</td><td>2</td>`,
  );
  const ls = parseLineScore(noHe);
  assert.equal(ls.awayTotal, 1);
  assert.equal(ls.awayHits, null, "없는 것을 0으로 채우면 「안타 0개」가 된다");
  assert.equal(ls.awayErrors, null);
  assert.equal(ls.homeErrors, null);
});

test("⚠計 앞의 열은 이닝이지 H가 아니다 — 앞에서 찾으면 이닝을 안타로 읽는다", () => {
  // 이닝 머리에 우연히 H가 들어간 적은 없지만, 검색 범위를 計 뒤로 제한한 것을 고정한다
  const ls = parseLineScore(NINE);
  assert.equal(ls.awayHits, 8);
  assert.notEqual(ls.awayHits, 1, "1회 득점을 안타로 읽었다");
});

test("빈 칸은 null이다", () => {
  const blank = table(
    `<th>&nbsp;</th><th>1</th><th>計</th><th>H</th><th>E</th>`,
    `<th>A</th><td>1</td><td>1</td><td>&nbsp;</td><td>-</td>`,
    `<th>B</th><td>2</td><td>2</td><td>5</td><td>0</td>`,
  );
  const ls = parseLineScore(blank);
  assert.equal(ls.awayHits, null);
  assert.equal(ls.awayErrors, null);
  assert.equal(ls.homeHits, 5);
  assert.equal(ls.homeErrors, 0, "0은 실제 값이다 — null과 다르다");
});
