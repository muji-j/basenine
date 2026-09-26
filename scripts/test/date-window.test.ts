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
import {
  JST_TODAY_FROM_HOUR,
  MAX_CATCHUP_DAYS,
  MAX_REFETCH_DATES,
  dayStatus,
  isYmd,
  jstDate,
  jstHour,
  judgeDates,
  parseRefetchDates,
  targetDates,
} from "../date-window.ts";

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

/**
 * ## ⚠「덜 받은 마지막 경기일」을 다시 받는다 (감사 C10 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md`)
 *
 * 23:30 JST 실행은 **끝난 경기만** 저장하고 진행 중인 경기는 건너뛴다(`inProgress`). 그래서 D 날 밤 실행 뒤
 * `MAX(game_date)`(= `since`)는 D 가 되는데 D 의 진행 중이던 경기는 DB 에 없다. D+1 의 실행이 **전부 실패**하면
 * 따라잡기 창이 `since` **다음 날부터**라 D 는 영영 창에 안 든다 — 자동으로는 안 받힌다(수동 `refetch_dates` 로만).
 * → 덜 받았다고 판정된 날을 `include` 로 창에 넣는다. ⚠~~`includeSince`(since 하나만)~~ 는 **2026-09-27 에 걷어냈다** —
 *   부분 실패로 `since` 가 덜 받은 날을 지나 전진하는 경로가 있었다(3중 검토 3차 P2 · 아래 C10′ 절).
 * ⚠**정상·휴식일에는 요청이 1건도 안 는다** — 판정이 완결이면 `include` 가 비고, 비면 창은 예전과 **글자까지 같다**
 *   (아래 「고치기 전 창」 표 · 위 두 본이 그대로 지킨다).
 */

/** 07:00 JST(= 전날 22:00 UTC) — 어제는 2026-08-18 */
const MORNING = at("2026-08-18T22:00:00Z");

/** `from` 부터 `to` 까지(둘 다 포함) 하루씩 */
function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}

/**
 * since 하나가 덜 받혔을 때(`include: [since]`) 간격(= 어제 − since)별 기대 창 — 설계 표(간격 0·1·2·6·7·8).
 * ⚠시험을 간격마다 따로 둔다(아래 C10′ 절) — 한 본에 몰면 첫 실패에서 멈춰 **간격 7 이 떨어지는지**가 안 보인다.
 */
const INCLUDE_SINCE_TABLE: [gap: number, since: string, want: string[], why: string][] = [
  [0, "2026-08-18", ["2026-08-18"], "since 가 어제다 — 어제는 이미 창에 있다(더하지 않는다 · 중복 없음)"],
  [1, "2026-08-17", ["2026-08-17", "2026-08-18"], "휴식일 다음 날 모양 — 예전 창은 [어제] 뿐이라 since 가 빠졌다"],
  [2, "2026-08-16", ["2026-08-16", "2026-08-17", "2026-08-18"], "since 와 그 사이와 어제"],
  [6, "2026-08-12", daysFrom("2026-08-12", "2026-08-18"), "since 부터 어제까지 7일"],
  [MAX_CATCHUP_DAYS, "2026-08-11", daysFrom("2026-08-11", "2026-08-18"),
    "⚠간격이 정확히 상한이어도 들어간다(8일) — `since - 1일` 을 넘기는 안은 여기서 따라잡기를 통째로 껐다(콜드 리뷰 ③)"],
  [MAX_CATCHUP_DAYS + 1, "2026-08-10", ["2026-08-18"], "상한을 넘으면 따라잡지 않는다 — since 도 안 넣는다(백필은 사람의 일)"],
];

test("C10 표의 전제 — 07:00 JST 의 어제는 08-18 · 간격 7 의 창은 8일", () => {
  assert.equal(jstDate(MORNING, -1), "2026-08-18");
  assert.equal(daysFrom("2026-08-11", "2026-08-18").length, 8);
  assert.deepEqual(INCLUDE_SINCE_TABLE.map(([gap]) => gap), [0, 1, 2, 6, 7, 8], "표의 간격이 설계(0·1·2·6·7·8)와 다르다");
});

/**
 * ⚠**반증자의 재현 그대로**(감사 C10). 09-10 밤 실행이 09-10 을 반만 저장하고, 09-11 실행이 전부 실패하고,
 * 09-13 아침에야 성공한 경우 — 예전 창은 `["2026-09-11","2026-09-12"]` 이라 09-10 이 없었다.
 */
test("⚠C10 반증자 재현 — 09-13 07:00 JST · since 09-10(덜 받음) → 09-10 이 창에 있다", () => {
  const now = at("2026-09-12T22:00:00Z");
  assert.deepEqual(targetDates(now, { collectedThrough: "2026-09-10" }), ["2026-09-11", "2026-09-12"], "재현의 전제(예전 창)가 틀렸다");
  assert.deepEqual(
    targetDates(now, { collectedThrough: "2026-09-10", include: ["2026-09-10"] }),
    ["2026-09-10", "2026-09-11", "2026-09-12"],
    "덜 받은 09-10 이 창에 없다 — 진행 중이던 경기가 영영 안 받힌다",
  );
});

test("C10 밤 실행에서도 오래된 것부터 · 오늘이 마지막 · since 가 오늘이면 아무것도 더하지 않는다", () => {
  const night = at("2026-08-18T14:30:00Z"); // 23:30 JST · 어제 08-17 · 오늘 08-18
  assert.deepEqual(
    targetDates(night, { collectedThrough: "2026-08-15", include: ["2026-08-15"] }),
    ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"],
  );
  // 같은 밤에 한 번 더 돌린 경우 — since 가 오늘(간격 −1)이면 그대로다
  assert.deepEqual(
    targetDates(night, { collectedThrough: "2026-08-18", include: ["2026-08-18"] }),
    ["2026-08-17", "2026-08-18"],
  );
});

/**
 * ⚠**`include` 가 없거나 빈 배열이면 고치기 전과 한 글자도 다르지 않다**(설계 §5) — 정상·휴식일의 요청 0 증가가 여기에 걸려 있다.
 * 표는 **고치기 전 창**을 그대로 적었다(간격 0·1 은 [어제] · 2~7 은 since 다음 날부터 · 8 은 [어제]).
 * 시각 셋 × 간격 −3~9 의 없음/빈 배열 동일성은 아래 C10′ 절이 잰다.
 */
test("⚠C10 include 가 없거나 빈 배열이면 창은 고치기 전 창과 글자까지 같다(표로 고정)", () => {
  const before: [since: string, want: string[]][] = [
    ["2026-08-18", ["2026-08-18"]],
    ["2026-08-17", ["2026-08-18"]],
    ["2026-08-16", ["2026-08-17", "2026-08-18"]],
    ["2026-08-12", daysFrom("2026-08-13", "2026-08-18")],
    ["2026-08-11", daysFrom("2026-08-12", "2026-08-18")],
    ["2026-08-10", ["2026-08-18"]],
  ];
  for (const [since, want] of before) {
    assert.deepEqual(targetDates(MORNING, { collectedThrough: since }), want, `since ${since}: include 없이 창이 바뀌었다`);
    assert.deepEqual(targetDates(MORNING, { collectedThrough: since, include: [] }), want, `since ${since}: 빈 include 인데 창이 바뀌었다`);
  }
});

/** 그날의 경기 id — 아래 `dayStatus` 시험이 쓴다 */
const G1 = "2026/0816/b-f-21", G2 = "2026/0816/c-t-18", G3 = "2026/0816/d-g-20";

/**
 * ## ⚠덜 받음 판정을 **최근 창으로 소급**한다 (2026-09-27 · C10 3중 검토 3차 P2 · 2차 F3)
 *
 * 「마지막 경기일(`since`) 하나만 본다」의 전제가 틀렸다. `update.ts` 는 날짜마다 따로 받고 실패도 따로 센다 —
 * 한 실행 안에서 D 의 재수집(진행 중이던 경기)은 실패하고 D+1 은 성공하면 `MAX(played)` 가 D+1 로 전진해
 * **다음 실행부터 D 를 다시 보지 않는다**(그 실행은 빨갛지만 그 뒤 자동 복구가 없다).
 * → 판정 범위를 `[어제 − MAX_CATCHUP_DAYS, min(since, 어제)]` 의 **날마다**로 넓히고(`judgeDates`),
 *   덜 받은 날 **전부**를 창에 더한다(`include` · 합집합 · 오름차순 · 중복 없음).
 * ⚠**`include` 가 없거나 빈 배열이면 창은 예전과 글자까지 같다** — 정상·휴식일의 요청 0 증가가 여기에 걸려 있다.
 */

/** 07:00 JST 기준 판정 범위의 아래 끝(어제 − 상한) — 어제 08-18 이면 08-11 */
const LO = "2026-08-11";

test("C10′ include 가 없거나 빈 배열이면 창은 예전과 글자까지 같다 — 시각 셋 × 간격 −3~9", () => {
  for (const utc of ["2026-08-18T22:00:00Z", "2026-08-18T05:00:00Z", "2026-08-18T14:30:00Z"]) {
    for (let gap = -3; gap <= MAX_CATCHUP_DAYS + 2; gap += 1) {
      const since = jstDate(at(utc), -1 - gap);
      const plain = targetDates(at(utc), { collectedThrough: since });
      assert.deepEqual(targetDates(at(utc), { collectedThrough: since, include: [] }), plain, `${utc} 간격 ${gap}: 빈 include 인데 창이 바뀌었다`);
    }
    assert.deepEqual(targetDates(at(utc), { include: [] }), targetDates(at(utc)), `${utc}: 기준점 없이 빈 include 인데 창이 바뀌었다`);
  }
});

test("C10′ 덜 받은 날을 창에 더한다 — 합집합 · 오름차순 · 중복 없음(입력 순서·중복과 무관)", () => {
  assert.equal(jstDate(MORNING, -1 - MAX_CATCHUP_DAYS), LO, "시험의 전제(판정 범위 아래 끝)가 틀렸다");
  // since 08-17(간격 1) — 예전 창은 [어제] 뿐
  assert.deepEqual(
    targetDates(MORNING, { collectedThrough: "2026-08-17", include: ["2026-08-16", "2026-08-14", "2026-08-16", "2026-08-18"] }),
    ["2026-08-14", "2026-08-16", "2026-08-18"],
  );
  // since 08-15(간격 3) — 사이 메우기(08-16·08-17)와 겹치는 날은 한 번만
  assert.deepEqual(
    targetDates(MORNING, { collectedThrough: "2026-08-15", include: ["2026-08-17", "2026-08-12", "2026-08-15"] }),
    ["2026-08-12", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"],
  );
});

/**
 * ⚠**부분 실패 경로**(3중 검토 3차 P2 · 2차 F3 가 독립적으로 찾음). D(08-16)의 재수집은 실패하고 D+1(08-17)은 성공해
 * `since` 가 08-17 로 전진했다. 예전 판정(since 하나만)은 08-17 이 완결이라 08-16 을 영영 다시 안 봤다.
 */
test("⚠C10′ 부분 실패 — D 덜 받음 · D+1 완결로 since 가 D+1 이 돼도 D 가 창에 든다", () => {
  assert.deepEqual(targetDates(MORNING, { collectedThrough: "2026-08-17" }), ["2026-08-18"], "전제(예전 창)가 틀렸다");
  assert.deepEqual(targetDates(MORNING, { collectedThrough: "2026-08-17", include: ["2026-08-16"] }), ["2026-08-16", "2026-08-18"]);
});

/** since 하나만 덜 받은 경우는 예전 표(간격 0·1·2·6·7·8)와 같은 창이 나와야 한다 — 모양만 바뀌고 뜻은 그대로다 */
for (const [gap, since, want, why] of INCLUDE_SINCE_TABLE) {
  test(`⚠C10′ include [since] 간격 ${gap} → [${want.length === 1 ? want[0] : `${want[0]} … ${want.at(-1)} (${want.length}일)`}] — ${why}`, () => {
    assert.deepEqual(targetDates(MORNING, { collectedThrough: since, include: [since] }), want);
  });
}

test("⚠C10′ include 는 [어제 − 상한, 어제] 밖의 날을 더하지 않는다 — 범위 밖 · 오늘 · 미래 · 모양 틀림 · 없는 날짜", () => {
  assert.deepEqual(
    targetDates(MORNING, {
      collectedThrough: "2026-08-17",
      // ⚠`2026-08-15x` 는 문자열 비교로는 범위 **안**이다 — 모양 검사가 없으면 그대로 창에 들어간다
      include: ["2026-08-10", LO, "2026-08-19", "2026-08-25", "2026-8-12", "2026-02-30", "garbage", "2026-08-15x"],
    }),
    [LO, "2026-08-18"],
    "상한 밖·오늘 이후·틀린 모양을 창에 넣었다",
  );
});

test("⚠C10′ 간격이 상한을 넘으면 include 도 더하지 않는다 — 백필은 사람의 일", () => {
  assert.deepEqual(targetDates(MORNING, { collectedThrough: "2026-08-10", include: ["2026-08-10", "2026-08-12"] }), ["2026-08-18"]);
});

test("C10′ 기준점(since)을 모르면 include 를 더하지 않는다 — 넓힐 근거가 없다(M11)", () => {
  assert.deepEqual(targetDates(MORNING, { include: ["2026-08-16"] }), ["2026-08-18"]);
});

/** ⚠**음수 간격** — since 가 어제보다 뒤(오늘 · 미래). −1 은 밤 실행 뒤 재실행에서 실재하고, 그 밖은 잘못된 자료에서만 난다(1차 P3) */
test("⚠C10′ 음수 간격(−1·−2·−5) — 사이 메우기 없음 · include 는 범위 안의 것만 · 오늘 이후는 안 더한다", () => {
  for (const [gap, since] of [[-1, "2026-08-19"], [-2, "2026-08-20"], [-5, "2026-08-23"]] as const) {
    assert.deepEqual(targetDates(MORNING, { collectedThrough: since }), ["2026-08-18"], `간격 ${gap}: include 없이 창이 바뀌었다`);
    assert.deepEqual(
      targetDates(MORNING, { collectedThrough: since, include: ["2026-08-15", "2026-08-19", "2026-08-20", since] }),
      ["2026-08-15", "2026-08-18"],
      `간격 ${gap}: 범위 밖(오늘 이후)을 넣었거나 범위 안을 뺐다`,
    );
  }
  // 밤 실행(23:30 JST · 어제 08-17 · 오늘 08-18) — 오늘은 include 가 아니라 22시 규칙으로만 들어온다(중복 없음)
  const night = at("2026-08-18T14:30:00Z");
  assert.deepEqual(
    targetDates(night, { collectedThrough: "2026-08-21", include: ["2026-08-18", "2026-08-16"] }),
    ["2026-08-16", "2026-08-17", "2026-08-18"],
  );
});

test("C10′ judgeDates — [어제 − 상한, min(since, 어제)] · since 가 그보다 이르면(간격 > 상한) 빈 배열 · 틀린 모양도 빈 배열", () => {
  assert.deepEqual(judgeDates(MORNING, "2026-08-16"), daysFrom(LO, "2026-08-16"), "since 까지");
  assert.deepEqual(judgeDates(MORNING, "2026-08-18"), daysFrom(LO, "2026-08-18"), "since = 어제");
  assert.deepEqual(judgeDates(MORNING, "2026-08-21"), daysFrom(LO, "2026-08-18"), "since 가 어제보다 뒤면 어제까지(오늘 이후는 판정하지 않는다)");
  assert.deepEqual(judgeDates(MORNING, LO), [LO], "간격이 정확히 상한 — 그날 하나");
  assert.deepEqual(judgeDates(MORNING, "2026-08-10"), [], "간격이 상한을 넘었다");
  for (const bad of ["2026-8-16", "2026-02-30", "", "2026/08/16"]) assert.deepEqual(judgeDates(MORNING, bad), [], JSON.stringify(bad));
  assert.equal(judgeDates(MORNING, "2026-08-18").length, MAX_CATCHUP_DAYS + 1, "판정 범위는 최대 상한 + 1 일이다");
});

test("C10′ isYmd — 모양과 실재를 둘 다 본다", () => {
  for (const ok of ["2026-08-16", "2024-02-29", "2018-03-30"]) assert.equal(isYmd(ok), true, ok);
  for (const bad of ["2026-8-16", "2026-02-30", "2025-02-29", "2026-13-01", "2026/08/16", "", " 2026-08-16"]) assert.equal(isYmd(bad), false, bad);
});

test("C10′ dayStatus — 완결 · 덜 받음(그 id 를 정렬해 돌려준다) · 아카이브 모름 · DB 모름 · DB 에만 있는 경기", () => {
  assert.deepEqual(dayStatus([G1, G2, G3], [G3, G1, G2]), { status: "complete", missing: [] });
  assert.deepEqual(dayStatus([G3, G1, G2, G3], [G2]), { status: "incomplete", missing: [G1, G3] }, "폴더는 있는데 행이 없는 경기를 못 봤다(중복은 한 번)");
  assert.deepEqual(dayStatus(null, [G1]), { status: "unknown", missing: [] }, "아카이브를 못 읽었는데 판정했다");
  assert.deepEqual(dayStatus([G1, G2], null), { status: "unknown", missing: [] }, "⚠DB 를 못 읽었는데 판정했다 — 그날 경기 전부를 덜 받음으로 오판한다");
  assert.deepEqual(dayStatus([G1], [G1, G2]), { status: "complete", missing: [] });
  assert.deepEqual(dayStatus([], [G1]), { status: "complete", missing: [] });
});
