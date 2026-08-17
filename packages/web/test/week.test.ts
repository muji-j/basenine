/**
 * 「先週」의 경계.
 *
 * ⚠**이 프로젝트는 요일·날짜 경계에서 이미 한 번 실장애를 냈다** — 휴일(경기 0)을 오류로 받아
 * 매주 일요일 밤에 수집이 멈췄다. 그래서 **경계는 반드시 시험으로 고정한다.**
 *
 * ⚠**시계를 읽지 않는다**(M6). 여기 있는 것은 전부 **주어진 날짜 문자열**의 순수 산술이다 —
 * `new Date()` 를 부르지 않으므로 타임존이 끼어들 자리가 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dayOfWeek, fromDayNumber, lastCompleteWeek, toDayNumber } from "../src/query.ts";

/**
 * ⚠**왕복이 깨지면 나머지가 전부 조용히 틀린다.** 날짜 → 수 → 날짜가 제자리로 오지 않으면
 * 주 경계가 하루씩 밀리는데, 화면에는 「8/9〜8/15」처럼 **그럴듯한 날짜**가 나와서 안 잡힌다.
 */
test("⚠날짜와 일련번호가 왕복한다 — 윤년·세기·연말을 포함해서", () => {
  const days = [
    "1970-01-01", "1999-12-31", "2000-01-01", "2000-02-29", "2024-02-29",
    "2026-01-01", "2026-03-01", "2026-08-16", "2026-12-31", "2100-03-01",
  ];
  for (const d of days) {
    assert.equal(fromDayNumber(toDayNumber(d)), d, `${d} 가 왕복하지 않는다`);
  }
  // 하루씩 이어진다 — 월말·연말에서 건너뛰지 않는지
  let cur = "2026-12-28";
  for (let i = 0; i < 8; i += 1) cur = addDays(cur, 1);
  assert.equal(cur, "2027-01-05", "연말을 넘을 때 날짜가 어긋난다");
});

/**
 * ⚠**요일이 하루라도 어긋나면 「지난주」가 통째로 다른 주가 된다.**
 * 기준: 1970-01-01 은 목요일이다.
 */
test("⚠요일이 맞는다 — 1970-01-01 은 목요일", () => {
  assert.equal(dayOfWeek("1970-01-01"), 4);
  // 2026-08-16 은 일요일(0). 실제 데이터의 최신 경기일이다
  assert.equal(dayOfWeek("2026-08-16"), 0);
  assert.equal(dayOfWeek("2026-08-10"), 1, "월요일이 아니다");
  assert.equal(dayOfWeek("2000-02-29"), 2, "윤일의 요일이 틀리다");
  // 일주일이 7일마다 돌아온다
  for (let i = 0; i < 14; i += 1) {
    assert.equal(dayOfWeek(addDays("2026-08-16", i)), dayOfWeek(addDays("2026-08-16", i + 7)));
  }
});

/**
 * ⚠**진행 중인 주를 「지난주」라고 부르지 않는다.** 수요일까지밖에 없는 주를 내면
 * 3경기 나온 선수와 6경기 나온 선수가 같은 표에 선다.
 * ⚠**최신 경기일이 일요일이면 그 주가 끝난 주다** — 그 하루 때문에 한 주를 묵히면
 * 일요일 밤에 화면이 일주일 낡아 보인다.
 */
test("⚠최신 경기일의 요일마다 어느 주를 고르는지 고정한다", () => {
  // 2026-08-10(월) ~ 2026-08-16(일) 이 한 주다
  const cases: readonly [string, string, string, string][] = [
    ["2026-08-16", "日", "2026-08-10", "2026-08-16"],
    ["2026-08-17", "月", "2026-08-10", "2026-08-16"],
    ["2026-08-18", "火", "2026-08-10", "2026-08-16"],
    ["2026-08-19", "水", "2026-08-10", "2026-08-16"],
    ["2026-08-22", "土", "2026-08-10", "2026-08-16"],
    ["2026-08-23", "日", "2026-08-17", "2026-08-23"],
  ];
  for (const [latest, label, from, to] of cases) {
    assert.deepEqual(lastCompleteWeek(latest), { from, to }, `${latest}(${label}) 의 주가 다르다`);
  }
});

/** ⚠**월~일이다.** 시작이 월요일이고 끝이 일요일이 아니면 「주」의 정의가 어긋난 것이다 */
test("⚠고른 구간은 언제나 월요일에 시작해 일요일에 끝나고 7일이다", () => {
  for (let i = 0; i < 40; i += 1) {
    const latest = addDays("2026-01-01", i * 9);
    const w = lastCompleteWeek(latest);
    assert.notEqual(w, null);
    assert.equal(dayOfWeek(w!.from), 1, `${latest}: 시작이 월요일이 아니다`);
    assert.equal(dayOfWeek(w!.to), 0, `${latest}: 끝이 일요일이 아니다`);
    assert.equal(toDayNumber(w!.to) - toDayNumber(w!.from), 6, `${latest}: 7일이 아니다`);
    // **끝난 주만** — 주말이 최신 경기일을 넘지 않는다
    assert.ok(toDayNumber(w!.to) <= toDayNumber(latest), `${latest}: 아직 끝나지 않은 주를 골랐다`);
  }
});

/** 경기가 하나도 없으면 고를 주가 없다 */
test("최신 경기일이 없으면 null 이다", () => {
  assert.equal(lastCompleteWeek(null), null);
});
