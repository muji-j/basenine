/**
 * **어느 날의 경기를 받는가.**
 *
 * ⚠**`scripts/` 에 시험이 하나도 없었다**(2026-08-18에 알았다). 수집 스케줄과 신선도 판정이
 * 여기 있는데 `npm test` 의 글로브가 `packages/*` 만 봤다 —
 * 「0건 통과」가 아니라 **한 번도 안 쟀던 것**이다.
 * 하필 이 판단이 틀리면 「어제 것도 오늘 것도 안 받는 날」이 생기고,
 * 경기 페이지는 소급이 되므로 눈치채기까지 오래 걸린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JST_TODAY_FROM_HOUR, jstDate, jstHour, targetDates } from "../date-window.ts";

/** UTC 문자열로 시각을 만든다. **JST 를 직접 못 만드는 것이 이 시험의 요점**이다 */
const at = (utc: string): Date => new Date(utc);

test("JST 는 UTC + 9시간이다 — 날짜 경계가 함께 넘어간다", () => {
  assert.equal(jstDate(at("2026-08-18T14:00:00Z")), "2026-08-18", "23시 JST 인데 날짜가 넘어갔다");
  assert.equal(jstDate(at("2026-08-18T15:00:00Z")), "2026-08-19", "자정 JST 인데 날짜가 안 넘어갔다");
  assert.equal(jstHour(at("2026-08-18T14:30:00Z")), 23, "23:30 JST 의 시가 다르다");
  assert.equal(jstHour(at("2026-08-18T15:00:00Z")), 0, "자정을 24시로 셌다");
});

test("어제는 언제나 받는다 — 거르면 영영 안 들어온다", () => {
  for (const utc of ["2026-08-18T22:00:00Z", "2026-08-18T05:00:00Z", "2026-08-18T14:30:00Z"]) {
    assert.ok(targetDates(at(utc)).includes(jstDate(at(utc), -1)), `${utc} 에 어제가 빠졌다`);
  }
});

/**
 * ⚠**막는 이유는 M9 가 아니라 M7 이다.**
 * 「끝나지 않은 경기」는 파서가 `inProgress` 로 안전하게 다룬다.
 * 문제는 **시작도 안 한 경기** — 그 페이지에는 타격표가 아예 없어서 파서가
 * 「구조 변경을 의심하라」로 예외를 던진다. 아침·낮에 받으면 그 예외가 **매일** 난다.
 */
test("⚠아침·낮 실행은 오늘 경기를 받지 않는다 — 시작 전 페이지는 「구조 변경」으로 읽힌다", () => {
  // 07:00 JST = 전날 22:00 UTC
  assert.deepEqual(targetDates(at("2026-08-17T22:00:00Z")), ["2026-08-17"], "07:00 이 오늘 것을 받았다");
  // 14:00 JST = 05:00 UTC
  assert.deepEqual(targetDates(at("2026-08-18T05:00:00Z")), ["2026-08-17"], "14:00 이 오늘 것을 받았다");
});

test("⚠밤 실행은 당일까지 받는다 — 이게 결과 지연을 줄이는 자리다", () => {
  // 23:30 JST = 14:30 UTC
  assert.deepEqual(
    targetDates(at("2026-08-18T14:30:00Z")),
    ["2026-08-17", "2026-08-18"],
    "23:30 이 오늘 것을 안 받았다",
  );
});

test("경계는 22시다 — 21:59 는 안 받고 22:00 은 받는다", () => {
  const before = at("2026-08-18T12:59:00Z"); // 21:59 JST
  const after = at("2026-08-18T13:00:00Z"); // 22:00 JST
  assert.equal(jstHour(before), JST_TODAY_FROM_HOUR - 1);
  assert.equal(jstHour(after), JST_TODAY_FROM_HOUR);
  assert.equal(targetDates(before).length, 1, "21:59 가 오늘 것을 받았다");
  assert.equal(targetDates(after).length, 2, "22:00 이 오늘 것을 안 받았다");
});

test("날짜를 명시하면 그 하루만이다 — 소급 수집의 어법을 바꾸지 않는다", () => {
  assert.deepEqual(targetDates(at("2026-08-18T14:30:00Z"), { date: "2018-07-09" }), ["2018-07-09"]);
});

test("--today 는 시각 판정을 넘긴다 — 손으로 돌릴 때를 위한 것", () => {
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { forceToday: true }),
    ["2026-08-17", "2026-08-18"],
  );
});

/**
 * ⚠**자정 직전·직후가 이 종류의 단골 사고 자리다**(구 PPS 에서 시계를 두 번 읽어
 * 연 1~2회 날짜가 어긋났다 · M6). 여기서는 시계를 한 번만 받으므로 그 사고가 없다 —
 * 그 사실을 **경계 시각으로 고정**한다.
 */
test("⚠자정을 넘긴 직후에도 「어제」가 하루만 밀린다", () => {
  const justBefore = at("2026-08-18T14:59:59Z"); // 23:59:59 JST
  const justAfter = at("2026-08-18T15:00:00Z"); // 00:00:00 JST 다음날
  assert.deepEqual(targetDates(justBefore), ["2026-08-17", "2026-08-18"]);
  // 자정을 넘기면 「오늘」이 19일이 되고, 22시 전이므로 어제(18일)만 받는다
  assert.deepEqual(targetDates(justAfter), ["2026-08-18"]);
});
