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
  MAX_OWED_PER_RUN,
  NEW_PLAYER_RESERVE,
  NORMAL_MAX_DATES,
  REQUESTS_PER_DATE,
  RESPONSE_ALLOWANCE_S,
  STEP_LIMIT_MIN,
  maxDatesWithinBudget,
  owedRoom,
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

/**
 * ⚠⚠**예산에 남는 몫이 없으면 0 이다 — 1 이 아니다**(반영분 재검토 P3). 예전에는 최소 1 로 올려 「30분 안」이라는 설명이
 * 거짓이 됐다(9일 · 간격 5000ms 에서 선수 1명이어도 30.5분). 0 이면 `update.ts` 가 그 실행의 선수 재취득을 건너뛰고 다음 실행이 잇는다.
 */
test("⚠⚠D6 설정이 더 작으면 그대로 · 예산에 남는 몫이 없으면 0(그 실행은 재취득을 건너뛴다)", () => {
  assert.equal(playerRefetchCap(7, 100, 3000), 100);
  assert.equal(playerRefetchCap(30, 400, 3000), 0);
  assert.equal(playerRefetchCap(9, 400, 5000), 0);
  assert.equal(playerRefetchCap(8, 400, 5000), 0);
});

/**
 * ⚠⚠**상한을 내준 모든 경우가 실제로 예산 안이다**(교차 검사 · 반영분 재검토 P3) — 3~9일 × 간격 2000·3000·5000ms.
 * 1 이상이면 `T ≤ 27` 이고 하나 더면 넘거나(설정값에 걸린 경우 빼고) · 0 이면 1명만 더해도 넘는다.
 */
test("⚠⚠D6 교차 검사 — 3~9일 × 간격 2000·3000·5000ms 에서 내준 상한은 전부 예산 안 · 0 은 1명도 안 들어갈 때만", () => {
  const budget = STEP_LIMIT_MIN - MARGIN_MIN;
  let zero = 0;
  for (let d = 3; d <= 9; d += 1) {
    for (const ms of [2000, 3000, 5000]) {
      const cap = playerRefetchCap(d, 400, ms);
      if (cap >= 1) {
        assert.ok(worstStepMin(d, cap, ms) <= budget, `${String(d)}일 · ${String(ms)}ms: ${String(cap)}명이면 ${String(worstStepMin(d, cap, ms))}분`);
        if (cap < 400) assert.ok(worstStepMin(d, cap + 1, ms) > budget, `${String(d)}일 · ${String(ms)}ms: 상한이 가장 크지 않다`);
      } else {
        zero += 1;
        assert.equal(cap, 0);
        assert.ok(worstStepMin(d, 1, ms) > budget, `${String(d)}일 · ${String(ms)}ms: 1명은 들어가는데 0 을 냈다`);
      }
    }
  }
  assert.equal(zero, 2, "간격 5000ms 의 8·9일 두 경우만 0 이어야 한다 — 전제가 바뀌었다");
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

/**
 * ## ⚠받았어야 할 날(owed)의 실행당 몫 (PR-2b · 설계 `docs/superpowers/specs/2026-10-24-catchup-owed-days-design.md` D3 · 시험 T4)
 *
 * `owedRoom = max(0, min(MAX_OWED_PER_RUN, maxDatesWithinBudget(간격) − 정규 창))` — **새 상수 없이** PR-2a 의 식에서 유도한다:
 * `maxDatesWithinBudget` 은 `worstStepMin(D, 0, 간격) ≤ STEP_LIMIT_MIN − MARGIN_MIN(27분)` 인 가장 큰 D 다
 * (간격 3000ms: `(12,0)` = 26.2분 · `(13,0)` = 28.0분 → 12일 · 간격 5000ms 면 7일).
 * ⚠이 보장은 **성공 경로의 계산 예산**이다 — 장애 경로는 PR-2a 의 회로 + 단계 30분 걸쇠가 맡는다(D3 · `worstStepMin` 머리말).
 */
test("⚠⚠T4 maxDatesWithinBudget — 3000ms → 12일 · 5000ms → 7일 · 2000ms → 17일 · 그 날짜 수가 예산 안에 드는 가장 큰 수", () => {
  const budget = STEP_LIMIT_MIN - MARGIN_MIN;
  assert.equal(budget, 27);
  for (const [ms, want] of [[3000, 12], [5000, 7], [2000, 17]] as const) {
    assert.equal(maxDatesWithinBudget(ms), want, `${String(ms)}ms`);
    assert.ok(worstStepMin(want, 0, ms) <= budget, `${String(ms)}ms: ${String(want)}일이 예산을 넘는다`);
    assert.ok(worstStepMin(want + 1, 0, ms) > budget, `${String(ms)}ms: ${String(want + 1)}일도 예산 안이다 — 가장 큰 수가 아니다`);
  }
  // 설계 문장의 두 수(소수 첫째 자리)
  assert.equal(worstStepMin(12, 0, 3000).toFixed(1), "26.2");
  assert.equal(worstStepMin(13, 0, 3000).toFixed(1), "28.0");
});

test("⚠⚠T4 owedRoom — 상한 5 · 정규 9일(간격 3000ms)이면 3 · 예산이 다 찼으면 0 · 간격 5000ms 는 7일까지", () => {
  assert.equal(MAX_OWED_PER_RUN, 5);
  assert.equal(owedRoom(1, 3000), 5, "정규 1일인데 상한 5를 다 안 줬다");
  assert.equal(owedRoom(2, 3000), 5);
  assert.equal(owedRoom(7, 3000), 5);
  assert.equal(owedRoom(8, 3000), 4);
  assert.equal(owedRoom(9, 3000), 3, "정규 창 최대 9일이면 owed 여유는 3일이다");
  assert.equal(owedRoom(12, 3000), 0);
  assert.equal(owedRoom(13, 3000), 0, "예산을 넘은 정규 창에서 음수나 양수를 냈다");
  assert.equal(owedRoom(2, 5000), 5);
  assert.equal(owedRoom(3, 5000), 4);
  assert.equal(owedRoom(7, 5000), 0);
  assert.equal(owedRoom(9, 5000), 0);
});

/**
 * ⚠⚠**속성** — 정규 창 0~12일 × 간격 2000·3000·5000ms 전부에서: 몫은 0~5 · 몫이 1 이상이면 `worstStepMin(정규 + 몫, 0) ≤ 27` ·
 * 몫이 5 보다 작으면 하나 더 얹으면 넘는다(가장 크다). 그리고 그 날짜 수에서 선수 재취득 상한(`playerRefetchCap`)을 얹어도 27 안이다
 * (날짜가 2일을 넘을 때 — 정상 1~2일은 D6 의 결정대로 설정값 그대로라 이 속성 밖이다).
 */
test("⚠⚠T4 속성 — worstStepMin(정규 + owed) ≤ 27 · 몫은 가장 크다 · 선수 재취득 상한을 얹어도 27 안", () => {
  const budget = STEP_LIMIT_MIN - MARGIN_MIN;
  let checked = 0;
  for (const ms of [2000, 3000, 5000]) {
    for (let regular = 0; regular <= 12; regular += 1) {
      const room = owedRoom(regular, ms);
      assert.ok(Number.isInteger(room) && room >= 0 && room <= MAX_OWED_PER_RUN, `${String(ms)}ms 정규 ${String(regular)}: 몫 ${String(room)}`);
      if (room === 0) continue;
      checked += 1;
      const n = regular + room;
      assert.ok(worstStepMin(n, 0, ms) <= budget, `${String(ms)}ms 정규 ${String(regular)} + owed ${String(room)}: ${String(worstStepMin(n, 0, ms))}분`);
      if (room < MAX_OWED_PER_RUN) assert.ok(worstStepMin(n + 1, 0, ms) > budget, `${String(ms)}ms 정규 ${String(regular)}: 몫이 가장 크지 않다`);
      if (n > NORMAL_MAX_DATES) {
        const cap = playerRefetchCap(n, 400, ms);
        assert.ok(worstStepMin(n, cap, ms) <= budget, `${String(ms)}ms ${String(n)}일: 선수 ${String(cap)}명을 얹으면 ${String(worstStepMin(n, cap, ms))}분`);
      }
    }
  }
  assert.ok(checked >= 20, `몫이 1 이상인 경우를 ${String(checked)}개밖에 못 봤다 — 이 시험이 공회전한다`);
});

test("T4 잘못된 입력은 던진다 — 정규 창 날짜 수가 0 이상의 정수가 아니면 · 간격이 L1 밖이면", () => {
  for (const [r, ms] of [[-1, 3000], [1.5, 3000], [Number.NaN, 3000], [1, 500], [1, Number.NaN]] as const) {
    assert.throws(() => owedRoom(r, ms), RangeError, `${String(r)} ${String(ms)}`);
  }
  assert.throws(() => maxDatesWithinBudget(1000), RangeError);
});
