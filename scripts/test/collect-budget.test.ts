/**
 * **수집·적재 단계 30분 안의 선수 재취득 상한**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D6 ·
 * 3중 검토 1차 P2-2 · 2차 F2) — 대상 경기일이 2일을 넘는 복구 실행에서만 상한을 낮춘다.
 *
 * ⚠**순수 함수만 잰다** — `update.ts` 가 그 값을 `emit-stale-player-ids --limit` 로 넘기는 배선은 `update-steps.test.ts` 가 가짜 자식으로 잰다.
 * ⚠**단계 제한은 워크플로에서 읽는다** — 상수와 `daily.yml` 이 갈리면 여기서 붉다(`correction-budget.test.ts` 와 같은 방식).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHILD_COUNT_BESIDES_DATES,
  LOCAL_MIN,
  MARGIN_MIN,
  NEW_PLAYER_RESERVE,
  NORMAL_MAX_DATES,
  REQUESTS_PER_DATE,
  RESPONSE_ALLOWANCE_S,
  STEP_LIMIT_MIN,
  playerRefetchCap,
  worstStepMin,
} from "../collect-budget.ts";

/** `수집·적재` 단계의 `timeout-minutes` — 그 단계 블록에서만 읽는다(잡 수준이 아니다) */
function updateStepTimeoutMin(): number {
  const yml = readFileSync(fileURLToPath(new URL("../../.github/workflows/daily.yml", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const at = yml.indexOf("      - name: 수집·적재\n");
  assert.notEqual(at, -1, "daily.yml 에 수집·적재 단계가 없다 — 이 시험의 전제가 바뀌었다");
  const next = yml.indexOf("\n      - ", at + 1);
  const m = /\n {8}timeout-minutes: (\d+)(?=\n)/.exec(yml.slice(at, next === -1 ? yml.length : next));
  assert.ok(m, "수집·적재 단계에 timeout-minutes 가 없다");
  return Number(m[1]);
}

test("⚠D6 상수 — 단계 제한은 daily.yml 의 수집·적재 timeout-minutes 와 같다 · 입력값(설계 D6)", () => {
  assert.equal(STEP_LIMIT_MIN, updateStepTimeoutMin(), "상수와 워크플로의 단계 제한이 갈렸다 — 한쪽만 고쳤다");
  assert.deepEqual(
    { LOCAL_MIN, MARGIN_MIN, RESPONSE_ALLOWANCE_S, REQUESTS_PER_DATE, NEW_PLAYER_RESERVE, NORMAL_MAX_DATES, CHILD_COUNT_BESIDES_DATES },
    { LOCAL_MIN: 2.0, MARGIN_MIN: 3.0, RESPONSE_ALLOWANCE_S: 1.0, REQUESTS_PER_DATE: 26, NEW_PLAYER_RESERVE: 40, NORMAL_MAX_DATES: 2, CHILD_COUNT_BESIDES_DATES: 3 },
  );
});

test("⚠⚠D6 표 — 간격 3초면 3~9일 상한 252 · 225 · 198 · 172 · 145 · 118 · 91", () => {
  const want: Record<number, number> = { 3: 252, 4: 225, 5: 198, 6: 172, 7: 145, 8: 118, 9: 91 };
  for (const [d, cap] of Object.entries(want)) assert.equal(playerRefetchCap(Number(d), 400, 3000), cap, `${d}일`);
});

test("⚠⚠D6 2일 이하(정상 실행)는 설정값 그대로 — 바꾸는 것은 복구 실행뿐이다", () => {
  for (const d of [0, 1, 2]) {
    assert.equal(playerRefetchCap(d, 400, 3000), 400, `${String(d)}일`);
    assert.equal(playerRefetchCap(d, 1000, 3000), 1000);
  }
});

test("⚠D6 설정이 더 작으면 그대로 · 날짜가 아주 많아도 0 이 아니라 1(목록 도구는 양의 정수만 받는다)", () => {
  assert.equal(playerRefetchCap(7, 100, 3000), 100);
  assert.equal(playerRefetchCap(30, 400, 3000), 1);
});

test("⚠D6 간격이 길면 상한이 준다(요청 하나의 시간 = 간격 + 응답 여유)", () => {
  assert.ok(playerRefetchCap(7, 400, 5000) < playerRefetchCap(7, 400, 3000));
  // (25분 × 60 − 9 × 5초) ÷ 6초 − (1 + 7 × 26 + 40) = 242.5 − 223 → 19
  assert.equal(playerRefetchCap(7, 400, 5000), 19);
});

/**
 * ⚠⚠**그 상한이 실제로 30분 안에 든다**(식의 뜻) — 최악 시간(예고 1 + 날짜 × 26 + 선수 재취득 + 신규 선수 여유 · 요청마다 간격+응답 여유 ·
 * 받기 자식 사이 간격 · 로컬 2분)이 단계 제한 − 여유 3분 안이고, 하나만 더 받으면 넘는다(그 상한이 가장 크다).
 */
test("⚠⚠D6 최악 시간 — 3~9일 모두 단계 제한 − 여유 안 · 상한 + 1 이면 넘는다", () => {
  for (let d = 3; d <= 9; d += 1) {
    const cap = playerRefetchCap(d, 400, 3000);
    assert.ok(worstStepMin(d, cap, 3000) <= STEP_LIMIT_MIN - MARGIN_MIN, `${String(d)}일: ${String(worstStepMin(d, cap, 3000))}분`);
    assert.ok(worstStepMin(d, cap + 1, 3000) > STEP_LIMIT_MIN - MARGIN_MIN, `${String(d)}일: 상한이 가장 크지 않다`);
  }
});

test("D6 잘못된 입력은 던진다(모르는 값을 기본값으로 메우지 않는다)", () => {
  for (const [d, c, ms] of [
    [-1, 400, 3000],
    [1.5, 400, 3000],
    [Number.NaN, 400, 3000],
    [3, 0, 3000],
    [3, 2.5, 3000],
    [3, 400, 500],
    [3, 400, Number.NaN],
  ] as const) {
    assert.throws(() => playerRefetchCap(d, c, ms), RangeError, `${String(d)} ${String(c)} ${String(ms)}`);
  }
});
