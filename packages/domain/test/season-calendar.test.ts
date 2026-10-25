/**
 * **NPB 공식 경기가 열리지 않는 달**(`NO_GAME_MONTHS`) — 잎 `season-calendar.ts`.
 *
 * ⚠**따라잡기의 확인된 휴식일(PR-2b D2 · PR-4 설계 D1-c)이 이 값을 쓴다** — 이 달의 날은 그 달 일정 사본이 없어도
 *   **그 해·달 전체의** 예정·치러짐 표시·경기 행이 0 이면 휴식으로 확인한다(한 행이라도 있으면 일반 달처럼 사본 조건). 사본이 없는 달(12·1·2월은 보유 9시즌에 사본 0장)에서 확인이 멈추면
 *   달 첫 주마다 사이 메우기가 늘었다(PR-2b 검토 P2-1 · 최대 +6 날짜 자식).
 * ⚠**11월은 넣지 않는다** — 경기가 열리는 해가 있다(일본시리즈 · CS · 2020/2021 정규). 넣으면 사본 없이 그 날을 휴식으로 쳐서 따라잡기가 건너뛴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NO_GAME_MONTHS, scheduleAbsencePolicy } from "../src/season-calendar.ts";

/** ⚠줄끝을 `\n` 으로 맞추고 BOM 을 뗀다 — 이 패키지의 `package.json` 은 BOM 으로 시작한다 */
function readLf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

test("⚠NO_GAME_MONTHS 는 12·1·2월이다 — 11월은 없다(경기가 열리는 해가 있다)", () => {
  assert.deepEqual([...NO_GAME_MONTHS].sort((a, b) => a - b), [1, 2, 12]);
  assert.equal(NO_GAME_MONTHS.includes(11), false, "11월을 넣었다 — 경기가 남은 해의 11월 날을 사본 없이 휴식으로 친다");
  for (const m of NO_GAME_MONTHS) assert.ok(Number.isInteger(m) && m >= 1 && m <= 12, String(m));
});

test("⚠NO_GAME_MONTHS 는 얼어 있다 — 모듈 전역 가변 상태를 두지 않는다", () => {
  assert.equal(Object.isFrozen(NO_GAME_MONTHS), true);
});

/**
 * ⚠⚠**현재 달 월간 일정 404·410 의 해석**(PR-4 설계 `2026-10-24-offseason-readiness-design.md` D1) — 12·1·2 조용 · 11 경고 · 3~10 실패.
 * ⚠11월이 「경고」인 이유: 경기가 열리는 해가 있다(5시즌 71경기) — 사본 없이 받으면 남은 경기를 잃을 수 있어 **시끄럽게** 받는다.
 * ⚠3~10월은 시즌 달이다 — 그 달 일정이 없다는 것은 주소·구조 변경 의심이라 지금처럼 막는다(PR-2a D1).
 */
test("⚠⚠scheduleAbsencePolicy — 12·1·2 quiet · 11 warn · 3~10 fail(달 12개 전부)", () => {
  const got = Array.from({ length: 12 }, (_, i) => [i + 1, scheduleAbsencePolicy(i + 1)] as const);
  assert.deepEqual(got, [
    [1, "quiet"], [2, "quiet"], [3, "fail"], [4, "fail"], [5, "fail"], [6, "fail"],
    [7, "fail"], [8, "fail"], [9, "fail"], [10, "fail"], [11, "warn"], [12, "quiet"],
  ]);
});

/** ⚠**조용한 달은 `NO_GAME_MONTHS` 한 벌에서 나온다**(M1) — 따라잡기의 「확인된 휴식일」과 404 의 해석이 다른 달 목록을 쓰지 않게 */
test("⚠scheduleAbsencePolicy 의 quiet 달 = NO_GAME_MONTHS — 두 벌이 아니다", () => {
  const quiet = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => scheduleAbsencePolicy(m) === "quiet");
  assert.deepEqual(quiet, [...NO_GAME_MONTHS].sort((a, b) => a - b));
});

test("scheduleAbsencePolicy — 1~12 의 정수가 아니면 던진다(모르는 달을 조용히 받지 않는다)", () => {
  for (const bad of [0, 13, -1, 1.5, Number.NaN]) {
    assert.throws(() => scheduleAbsencePolicy(bad), RangeError, String(bad));
  }
});

/**
 * ⚠**잎이어야 한다**(I1) — `scripts/collected-through.ts`(→ `scripts/update.ts` · 수집 오케스트레이터)가 서브패스로 가져온다.
 * 배럴(`@bb-app/domain`)이나 무엇이든 import 하면 그 사슬의 로드 오류가 **수집을 시작 전에** 죽인다.
 */
test("⚠I1 season-calendar.ts 는 import 가 0개인 잎이고 · 서브패스 `@bb-app/domain/season-calendar` 로 같은 값을 내보낸다", async () => {
  assert.equal(/^\s*import\b/m.test(readLf("../src/season-calendar.ts")), false, "season-calendar.ts 에 import 문이 있다");
  const pkg = JSON.parse(readLf("../package.json")) as { exports: Record<string, string> };
  assert.equal(pkg.exports["./season-calendar"], "./src/season-calendar.ts", "package.json 의 exports 에 ./season-calendar 가 없다");
  const viaSubpath = (await import("@bb-app/domain/season-calendar")) as { NO_GAME_MONTHS: unknown };
  assert.equal(viaSubpath.NO_GAME_MONTHS, NO_GAME_MONTHS, "서브패스로 가져온 것이 같은 값이 아니다 — 두 벌이다");
});
