/**
 * **파이프라인이 멈춘 것을 무엇이 알려 주는가.**
 *
 * ⚠**답은 「아무것도」였다**(2026-09-09 발견). 우리 문서 여러 곳이 「화면의 신선도 띠가 뜨면 안다」를
 * 안전망으로 적어 왔는데 **거짓이다** — `packages/web/src/layout.ts:160` 이 `lagDays` 를
 * **`builtOn`**(빌드 시각)으로 계산하고, 이 사이트는 **정적 생성물**이다.
 * **파이프라인이 멈추면 페이지가 다시 안 구워지므로 그 값이 얼어붙는다.**
 * 마지막 빌드 당시가 신선했으면 **영원히 초록**이다.
 * ⚠**CLAUDE.md §6 이 2026-08-30 사고에서 이미 같은 함정을 적어 뒀다** — 읽고도 되풀이했다.
 *
 * ## 이 시험이 붙드는 계약
 *
 * `heartbeat.yml` 이 묻는 것은 **「최근 24시간 안에 수집이 한 번이라도 끝까지 돌았는가」** 하나다.
 * 그 판정을 순수 함수로 떼어 **네트워크 없이** 재고, **두 가지 함정**을 못 박는다:
 *
 * 1. ⚠**실행 결론(`conclusion`)을 쓰면 안 된다.** `decide` 만 성공하고 `collect` 가 `skipped` 여도
 *    실행은 `success` 다 — **우리 이력에 실물이 있다**(2026-09-08 11:35 실행).
 *    그걸 「수집됨」으로 읽으면 **수집이 멈춰도 조용하다.**
 * 2. ⚠**`created_at` 이 아니라 `completed_at` 으로 재야 한다.** 묻는 것은 「끝까지 돌았는가」이고
 *    `collect` 는 `timeout-minutes: 45` 다. 생성 시각으로 재면 **23시간 50분 전에 끝난 성공**을
 *    **24시간 10분 전에 생성됐다**는 이유로 놓쳐 **거짓 경보**가 난다.
 *
 * ⚠**「모르면 알린다」가 원칙이다** — 안전한 방향은 침묵이 아니라 거짓 경보다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKBACK_HOURS, type CollectJob, heartbeatVerdict } from "../heartbeat.ts";

const NOW = "2026-09-09T12:00:00.000Z";

/** `ago(3)` = 지금부터 3시간 전 */
function ago(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3600 * 1000).toISOString();
}

function job(over: Partial<CollectJob> = {}): CollectJob {
  return { runId: 1, conclusion: "success", completedAt: ago(3), ...over };
}

test("최근 24시간 안에 collect 가 성공했으면 조용하다", () => {
  const v = heartbeatVerdict(NOW, [job()]);
  assert.equal(v.kind, "ok");
});

/**
 * ⚠**이 시험이 이 파일의 존재 이유다.**
 * 실행 결론으로 판정하면 이 이력이 「성공」으로 읽히고 **수집이 멈춰도 영원히 조용하다.**
 */
test("⚠성공이 collect:skipped 뿐이면 알린다 — 실행 결론은 success 라도 수집은 안 됐다", () => {
  const v = heartbeatVerdict(NOW, [job({ conclusion: "skipped" })]);
  assert.equal(v.kind, "stopped");
});

test("collect 가 실패했으면 알린다", () => {
  const v = heartbeatVerdict(NOW, [job({ conclusion: "failure" })]);
  assert.equal(v.kind, "stopped");
});

test("24시간보다 오래된 성공뿐이면 알린다", () => {
  const v = heartbeatVerdict(NOW, [job({ completedAt: ago(LOOKBACK_HOURS + 1) })]);
  assert.equal(v.kind, "stopped");
});

/**
 * ⚠**`created_at` 으로 재면 이 경우를 놓친다**(콜드 리뷰 P2-4).
 * 23시간 50분 전에 **끝난** 성공인데, 45분짜리 잡이라 **생성은 24시간 35분 전**이다.
 */
test("⚠끝난 시각으로 잰다 — 생성이 24시간 밖이어도 완료가 안이면 조용하다", () => {
  const v = heartbeatVerdict(NOW, [job({ completedAt: ago(23.83) })]);
  assert.equal(v.kind, "ok", "완료 시각이 창 안인데 알렸다 — created_at 으로 재고 있다");
});

test("⚠실행이 하나도 없으면 알린다 — 「0건」은 「정상」이 아니다", () => {
  const v = heartbeatVerdict(NOW, []);
  assert.equal(v.kind, "stopped");
});

/**
 * ⚠**모르면 알린다.** API 가 답을 못 주는 것은 「정상」이 아니라 **안 잰 것**이다(작업규칙 7).
 * 안전한 방향은 침묵이 아니라 거짓 경보다.
 */
test("⚠못 쟀으면 알린다 — 침묵보다 거짓 경보가 안전한 방향이다", () => {
  const v = heartbeatVerdict(NOW, null);
  assert.equal(v.kind, "unmeasured");
});

/** 여럿 중 하나라도 창 안에서 성공했으면 조용하다 */
test("여러 실행 중 하나라도 창 안 성공이면 조용하다", () => {
  const v = heartbeatVerdict(NOW, [
    job({ runId: 3, conclusion: "failure", completedAt: ago(1) }),
    job({ runId: 2, conclusion: "skipped", completedAt: ago(7) }),
    job({ runId: 1, conclusion: "success", completedAt: ago(13) }),
  ]);
  assert.equal(v.kind, "ok");
});

/** 판정에 「마지막 성공이 몇 시간 전인가」가 들어 있어야 로그가 쓸모 있다 */
test("판정이 마지막 성공까지의 시간을 말한다 — 없으면 로그가 원인을 못 말한다", () => {
  const v = heartbeatVerdict(NOW, [job({ completedAt: ago(5) })]);
  assert.equal(v.kind, "ok");
  if (v.kind === "ok") assert.equal(Math.round(v.lastSuccessHoursAgo), 5);
});
