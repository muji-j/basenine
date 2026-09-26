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
import { JST_TODAY_FROM_HOUR, MAX_CATCHUP_DAYS, MAX_REFETCH_DATES, jstDate, jstHour, parseRefetchDates, targetDates } from "../date-window.ts";

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

/**
 * ## ⚠따라잡기 — 「이틀 이상 멈추면 가운데 날이 영구히 빈다」 (2026-08-31)
 *
 * 창이 **딱 하루**였다. 실행이 하루 걸러지면 그날 경기는 다음 실행의 창 **밖**으로 밀려나
 * **영영 안 들어온다.** 2026-08-31 에 실제로 그 상황이 왔다 — GitHub Actions 무료 분이
 * 소진돼 스케줄이 통째로 멈췄다.
 * ⚠**그날 NPB 가 쉬는 날이라 손해가 0이었을 뿐이고, 설계가 막은 게 아니다.**
 *
 * ⚠**아래 두 본이 이 변경의 값을 지킨다**: 정상·휴식일에는 **요청이 1건도 안 늘어야** 한다.
 * 늘면 L1(1req/2~5초)에서 그만큼 느려지고, **따라잡기가 평상시의 비용이 되면 안 된다.**
 */
test("⚠정상일 때는 예전과 글자까지 같다 — 따라잡기가 평상시 요청을 늘리지 않는다", () => {
  for (const utc of ["2026-08-18T22:00:00Z", "2026-08-18T05:00:00Z", "2026-08-18T14:30:00Z"]) {
    const plain = targetDates(at(utc));
    const withSince = targetDates(at(utc), { collectedThrough: jstDate(at(utc), -1) });
    assert.deepEqual(withSince, plain, `${utc}: 어제까지 받아 뒀는데 창이 넓어졌다`);
  }
});

test("⚠휴식일 뒤에도 안 는다 — 그저께까지 받았으면 빠진 날은 어제 하나다", () => {
  // 14:00 JST · 어제 = 08-17(월·경기 없음) · 마지막 경기일 = 08-16(일)
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { collectedThrough: "2026-08-16" }),
    ["2026-08-17"],
    "휴식일 뒤에 일요일까지 다시 받으려 했다",
  );
});

test("⚠이틀 이상 비면 그 사이를 메운다 — 이게 없으면 가운데 날이 영구히 빈다", () => {
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { collectedThrough: "2026-08-14" }),
    ["2026-08-15", "2026-08-16", "2026-08-17"],
    "빠진 날을 안 메웠다",
  );
});

test("⚠밤 실행에서도 오래된 것부터이고 오늘이 마지막이다", () => {
  assert.deepEqual(
    targetDates(at("2026-08-18T14:30:00Z"), { collectedThrough: "2026-08-15" }),
    ["2026-08-16", "2026-08-17", "2026-08-18"],
    "순서가 어긋났거나 오늘이 빠졌다",
  );
});

/**
 * ⚠**상한이 없으면 비시즌에 매일 헛돈다.** 10월에 시즌이 끝나면 마지막 경기일이 멈추므로
 * 다음 개막까지 **수백 일**을 훑게 된다. 그건 따라잡기가 아니라 **백필**이고,
 * 백필은 사람이 `--date` 로 하는 일이다.
 * ⚠**침묵하는 쪽으로 넘어가지 않는다** — `scripts/freshness.ts` 가 2일에 이미 빨개진다.
 */
test("⚠상한을 넘으면 따라잡지 않는다 — 비시즌에 매일 수백 일을 훑지 않는다", () => {
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { collectedThrough: "2026-07-01" }),
    ["2026-08-17"],
    "상한을 넘겼는데도 따라잡으려 했다",
  );
  // 경계 — 상한 이내의 가장 먼 날은 메우고, 하루만 더 멀면 안 메운다
  assert.equal(
    targetDates(at("2026-08-18T05:00:00Z"), { collectedThrough: "2026-08-10" }).length,
    MAX_CATCHUP_DAYS,
    `상한(${MAX_CATCHUP_DAYS}일) 이내인데 다 안 메웠다`,
  );
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { collectedThrough: "2026-08-09" }),
    ["2026-08-17"],
    "상한을 하루 넘겼는데 메웠다",
  );
});

test("⚠날짜를 명시하면 따라잡기가 끼어들지 않는다 — 소급 수집의 어법을 바꾸지 않는다", () => {
  assert.deepEqual(
    targetDates(at("2026-08-18T05:00:00Z"), { date: "2026-08-01", collectedThrough: "2026-07-20" }),
    ["2026-08-01"],
    "명시한 날짜 하나만이어야 한다",
  );
});

test("13 재수집 날짜: 비면 평소 창 · 정상 3일은 그 3일", () => {
  assert.deepEqual(parseRefetchDates(undefined), { ok: true, dates: null });
  assert.deepEqual(parseRefetchDates("  "), { ok: true, dates: null });
  assert.deepEqual(parseRefetchDates("2026-08-01, 2026-08-02,2026-08-03"), { ok: true, dates: ["2026-08-01", "2026-08-02", "2026-08-03"] });
});

test("13 재수집 날짜: 8개 · 없는 날짜 · 셸 문자 · 중복 · 자릿수 틀림은 거부", () => {
  const eight = Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1}`).join(",");
  for (const bad of [eight, "2026-02-30", "2026-08-01;rm -rf /", "2026-08-01,2026-08-01", "2026-8-1", "2026-08-01,"]) {
    const r = parseRefetchDates(bad);
    assert.equal(r.ok, false, bad);
  }
});

/**
 * ⚠**경계는 정확히 상한(M1 · 감사 반영)**. 적재기의 복구 힌트(`load-archive.ts`)는
 * 정확히 `MAX_REFETCH_DATES` 개짜리 줄을 찍는다 — 그 줄을 그대로 붙여 넣으면 통과해야 한다.
 */
test("13 재수집 날짜: 정확히 상한(7)개 · 전부 다른 날짜는 받는다", () => {
  const seven = Array.from({ length: MAX_REFETCH_DATES }, (_, i) => `2026-08-0${i + 1}`);
  assert.deepEqual(parseRefetchDates(seven.join(",")), { ok: true, dates: seven });
});

/**
 * ⚠**재수집 날짜는 오름차순으로 돌려준다** — 받는 순서와 로그가 날짜순이 되고 「마지막 날짜 = 가장 늦은 대상일」이 늘 참이다.
 * ⚠~~`update.ts` 가 마지막 날짜로 予告先発 조회 시즌을 정한다~~ 는 **틀린 서술이었다**(2026-09-26 · 3중 검토 1차 P3 · 2차 F4) —
 *   마지막 날짜로 정하는 것은 **앞으로의 일정**(`load-upcoming.ts`)의 시즌이고 予告先発(`cli-starters.ts`)은 날짜를 받지 않는다.
 *   재수집 실행에서는 그 시즌을 **JST 의 올해**로 정한다(`scripts/test/refetch-wiring.test.ts` 가 지킨다).
 */
test("13 재수집 날짜: 뒤죽박죽 입력도 오름차순으로 정렬해 돌려준다", () => {
  assert.deepEqual(parseRefetchDates("2026-08-02,2025-09-01"), { ok: true, dates: ["2025-09-01", "2026-08-02"] });
});
