/**
 * `update.ts` 의 실행 판정 — 종료 0 / 75 / 1(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D5 · 시험 T7).
 *
 * ⚠**순수 함수만 잰다** — 자식 실행·사유 파일 I/O 는 `update-steps.test.ts`(가짜 자식)와 `freshness-wired.test.ts`(쓰는 쪽)가 잰다.
 * ⚠**R4 가 이 PR 의 가장 위험한 줄이다** — 신선도 사유를 「상류 장애로 설명된다」고 보는 것은 **상류 실패가 같은 실행에 있을 때만**이다.
 *   그 조건이 빠지면 PR-1 이 고친 헛경보 유형(상류 실패 없는 `career-lag`)이 다시 배포로 흘러간다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_REASON_KEYS } from "@bb-app/domain";
import { EXIT_UPSTREAM_ONLY, EXPLAINED_BY_UPSTREAM, classifyRun, parseFreshnessReasons } from "../run-verdict.ts";
import type { FreshReasons, StepRecord } from "../run-verdict.ts";

const fetch = (id: string, exit: number, skipped = false): StepRecord => ({ id, group: "fetch", exit, ...(skipped ? { skipped } : {}) });
const load = (id: string, exit: number): StepRecord => ({ id, group: "load", exit });
const emit = (id: string, exit: number): StepRecord => ({ id, group: "emit", exit });
const fresh = (exit: number): StepRecord => ({ id: "신선도", group: "freshness", exit });
const ok = (...reasons: string[]): FreshReasons => parseFreshnessReasons(JSON.stringify({ schema: 1, exit: 1, reasons }), 1);

const healthy: StepRecord[] = [fetch("予告先発 아카이브", 0), fetch("경기 아카이브 2026-10-20", 0), load("DB 적재", 0), emit("선수 ID 목록", 0), load("선수 프로필 적재", 0), fresh(0)];

// ---- R1 ~ R5 -------------------------------------------------------------------

test("⚠T7 R5 — 실패 없음 → 0", () => {
  assert.deepEqual(classifyRun(healthy, null), { exit: 0, blocking: [], upstream: [], explained: [] });
});

test("⚠T7 R1 — 적재·emit 의 0 아닌 종료는 blocking(75 여도)", () => {
  for (const exit of [1, 2, 75, 137]) {
    assert.equal(classifyRun([...healthy, load("DB 적재", exit)], null).exit, 1, `load ${String(exit)}`);
    assert.equal(classifyRun([...healthy, emit("낡은 선수 목록", exit)], null).exit, 1, `emit ${String(exit)}`);
  }
});

test("⚠T7 R2 — 받기 자식의 0·75 밖 종료(1·2·137)는 blocking", () => {
  for (const exit of [1, 2, 137]) assert.equal(classifyRun([...healthy, fetch("경기 아카이브 2026-10-21", exit)], null).exit, 1, String(exit));
});

test("⚠T7 R3 — 받기 75(건너뛴 합성 step 포함)는 upstream → 75", () => {
  const v = classifyRun([fetch("予告先発 아카이브", 75), fetch("경기 아카이브 2026-10-20", 75, true), load("DB 적재", 0), fresh(0)], null);
  assert.equal(v.exit, EXIT_UPSTREAM_ONLY);
  assert.deepEqual(v.upstream, ["予告先発 아카이브", "경기 아카이브 2026-10-20"]);
  assert.deepEqual(v.blocking, []);
});

test("⚠T7 R5 — blocking 이 하나라도 있으면 상류 실패가 있어도 1", () => {
  const v = classifyRun([fetch("予告先発 아카이브", 75), load("DB 적재", 1), fresh(0)], null);
  assert.equal(v.exit, 1);
  assert.deepEqual(v.blocking, ["DB 적재 — 종료 1"]);
  assert.deepEqual(v.upstream, ["予告先発 아카이브"]);
});

// ---- R4 · 신선도 사유 표 ---------------------------------------------------------

test("⚠T7 R4 — 설명되는 사유 넷+하나는 상류 실패가 있을 때만 explained → 75", () => {
  assert.deepEqual([...EXPLAINED_BY_UPSTREAM].sort(), ["career-lag", "game-lag", "game-missed", "starters-behind", "starters-lag"]);
  for (const r of EXPLAINED_BY_UPSTREAM) {
    const v = classifyRun([fetch("予告先発 아카이브", 75), load("DB 적재", 0), fresh(1)], ok(r));
    assert.equal(v.exit, EXIT_UPSTREAM_ONLY, `${r}: ${JSON.stringify(v)}`);
    assert.deepEqual(v.explained, [r]);
  }
});

test("⚠⚠T7 R4 — 상류 실패 없는 신선도 사유는 blocking(career-lag 포함 — PR-1 이 고친 헛경보 유형은 여전히 막힌다)", () => {
  for (const r of EXPLAINED_BY_UPSTREAM) {
    const v = classifyRun([...healthy.slice(0, -1), fresh(1)], ok(r));
    assert.equal(v.exit, 1, `${r} 가 상류 실패 없이 통과했다`);
    assert.deepEqual(v.explained, []);
  }
});

test("⚠T7 R4 — no-games 는 상류 실패가 있어도 blocking(배포할 것이 없다)", () => {
  const v = classifyRun([fetch("予告先発 아카이브", 75), fresh(1)], ok("no-games"));
  assert.equal(v.exit, 1);
  // 섞여 있어도 막는다
  assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(1)], ok("career-lag", "no-games")).exit, 1);
});

test("⚠T7 R4 — 신선도 0 이면 사유 파일을 안 본다 · 2 이면 파일과 무관하게 blocking · 1 인데 파일을 못 읽었으면 blocking", () => {
  assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(0)], { ok: false, error: "x" }).exit, EXIT_UPSTREAM_ONLY, "0 인데 파일 오류로 막았다");
  assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(2)], ok("career-lag")).exit, 1, "2(표 없음 등)를 사유로 설명했다");
  assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(1)], { ok: false, error: "사유 파일이 없다" }).exit, 1);
  assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(1)], null).exit, 1, "1 인데 사유를 아예 안 넘겼다");
});

test("⚠T7 사유 표는 STALE_REASON_KEYS 전부를 덮는다 — 키가 늘면 여기서 붉다(모르는 사유를 설명된 것으로 두지 않는다)", () => {
  const covered = new Set([...EXPLAINED_BY_UPSTREAM, "no-games"]);
  assert.deepEqual([...STALE_REASON_KEYS].filter((k) => !covered.has(k)), [], "표에 없는 사유가 생겼다 — 설명되는지 정하고 표에 넣어라");
});

// ---- 사유 파일 계약(읽는 쪽 · 4차-3) ------------------------------------------------

test("⚠T7 사유 파일 — 유효하면 중복을 지우고 받는다", () => {
  const v = parseFreshnessReasons(JSON.stringify({ schema: 1, exit: 1, reasons: ["career-lag", "starters-lag", "career-lag"] }), 1);
  assert.deepEqual(v, { ok: true, reasons: ["career-lag", "starters-lag"] });
});

test("⚠T7 사유 파일 — 없음 · 깨짐 · schema≠1 · exit 불일치 · allow-list 밖 · 빈 reasons · 모양이 다르면 전부 blocking 입력", () => {
  const bad: [string, string | null][] = [
    ["없음", null],
    ["JSON 깨짐", "{"],
    ["빈 파일", ""],
    ["배열", "[]"],
    ["null", "null"],
    ["schema 2", JSON.stringify({ schema: 2, exit: 1, reasons: ["career-lag"] })],
    ["schema 문자열", JSON.stringify({ schema: "1", exit: 1, reasons: ["career-lag"] })],
    ["파일의 exit 0", JSON.stringify({ schema: 1, exit: 0, reasons: ["career-lag"] })],
    ["allow-list 밖", JSON.stringify({ schema: 1, exit: 1, reasons: ["career-lag", "upstream-ok"] })],
    ["빈 reasons", JSON.stringify({ schema: 1, exit: 1, reasons: [] })],
    ["reasons 가 문자열", JSON.stringify({ schema: 1, exit: 1, reasons: "career-lag" })],
    ["reasons 없음", JSON.stringify({ schema: 1, exit: 1 })],
    ["키가 더 있다", JSON.stringify({ schema: 1, exit: 1, reasons: ["career-lag"], explained: true })],
    ["__proto__ 키", '{"schema":1,"exit":1,"reasons":["career-lag"],"__proto__":{"x":1}}'],
    ["사유가 숫자", JSON.stringify({ schema: 1, exit: 1, reasons: [1] })],
  ];
  for (const [name, raw] of bad) {
    const v = parseFreshnessReasons(raw, 1);
    assert.equal(v.ok, false, `${name} 를 받았다`);
    // 그리고 그 결과는 상류 실패가 있어도 막는다
    assert.equal(classifyRun([fetch("予告先発 아카이브", 75), fresh(1)], v).exit, 1, `${name} 가 막지 않았다`);
  }
});
