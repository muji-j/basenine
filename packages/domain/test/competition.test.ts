/**
 * 경기 구분 판정.
 *
 * ⚠**이 판정이 틀리면 「시즌 성적」이 시즌 성적이 아니게 된다**(§2-1).
 * 실측(2026-08-16): 표기를 안 보던 동안 2025년 CS 13경기·일본시리즈 5경기가
 * 정규시즌에 섞여 있었고, 타석 로그 1,351건이 시즌 성적에 흘러들고 있었다.
 * 빼고 나서야 실시 858경기 = NPB 정규시즌 경기 수(143×12÷2)와 정확히 맞았다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { competitionFromLabel } from "../src/teams.ts";

/**
 * 아카이브 1,569장 전수 조사(2026-08-16)에서 나온 **실제 표기 전부**.
 * ⚠새 표기가 나오면 여기에 먼저 적는다 — 코드만 고치면 무엇을 근거로 고쳤는지 남지 않는다.
 */
const OBSERVED: readonly [string, string][] = [
  ["JERA セ・リーグ公式戦", "regular"],
  ["パーソル パ・リーグ公式戦", "regular"],
  ["日本生命セ・パ交流戦", "regular"],
  ["CS ファーストステージ", "climaxSeries"],
  ["CS ファイナルステージ", "climaxSeries"],
  ["SMBC日本シリーズ", "nipponSeries"],
  ["オールスターゲーム", "allStar"],
];

test("실제 아카이브에 나온 표기 7종을 전부 판정한다", () => {
  for (const [label, expected] of OBSERVED) {
    assert.equal(competitionFromLabel(label), expected, `${label}의 판정이 다르다`);
  }
});

test("⚠交流戦은 정규시즌이다 — 빼면 어느 사이트와도 승패 수가 맞지 않는다", () => {
  assert.equal(competitionFromLabel("日本生命セ・パ交流戦"), "regular");
});

test("⚠CS·일본시리즈는 정규시즌이 아니다 — 섞으면 시즌 성적이 시즌 성적이 아니게 된다", () => {
  assert.notEqual(competitionFromLabel("CS ファーストステージ"), "regular");
  assert.notEqual(competitionFromLabel("CS ファイナルステージ"), "regular");
  assert.notEqual(competitionFromLabel("SMBC日本シリーズ"), "regular");
});

test("⚠후원사 이름이 바뀌어도 판정된다 — 전체 일치로 보면 그해 전 경기가 미분류가 된다", () => {
  // 후원사는 실제로 바뀐다. JERA(セ)·パーソル(パ)·日本生命(交流戦)·SMBC(日本シリーズ)
  assert.equal(competitionFromLabel("○○損保 セ・リーグ公式戦"), "regular");
  assert.equal(competitionFromLabel("△△証券 パ・リーグ公式戦"), "regular");
  assert.equal(competitionFromLabel("××生命セ・パ交流戦"), "regular");
  assert.equal(competitionFromLabel("□□銀行日本シリーズ"), "nipponSeries");
});

test("「クライマックスシリーズ」라고 풀어 써도 판정된다", () => {
  assert.equal(competitionFromLabel("クライマックスシリーズ ファイナルステージ"), "climaxSeries");
});

test("⚠모르는 표기는 던진다 — 조용히 regular로 흘리면 아무도 모르는 채 집계가 오염된다(M7)", () => {
  assert.throws(() => competitionFromLabel("ファーム公式戦"), /모르는 대회 표기/);
  assert.throws(() => competitionFromLabel("オープン戦"), /모르는 대회 표기/);
  assert.throws(() => competitionFromLabel(""), /모르는 대회 표기/);
});

test("⚠일본시리즈를 리그 공식전보다 먼저 본다 — 넓은 규칙이 좁은 규칙을 삼키지 않게", () => {
  // 표기가 늘어날 때의 사고를 막는 순서 고정
  assert.equal(competitionFromLabel("日本シリーズ セ・リーグ代表"), "nipponSeries");
});
