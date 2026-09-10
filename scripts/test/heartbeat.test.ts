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
import {
  type ApiJob,
  type CollectJob,
  LOOKBACK_HOURS,
  heartbeatVerdict,
  toCollectJob,
} from "../heartbeat.ts";

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
 * ⚠**이 시험의 단언 메시지가 거짓말이었다**(2026-09-09 · 이중 검토 F4).
 * 「created_at 으로 재고 있다」고 잡는다고 적어 뒀지만, **어느 필드를 읽는지는
 * `toCollectJob` 이 정하고 그건 이 시험이 안 부른다** — 검토자가 `started_at` 으로 바꿔 돌렸을 때
 * **9본이 전부 통과했다.** 여기서 재는 것은 **창 경계(23.83 ≤ 24)** 뿐이다.
 * **필드 선택은 아래 `toCollectJob` 시험이 잰다.**
 */
test("창 경계 — 23.83시간 전 성공은 창(24시간) 안이다", () => {
  const v = heartbeatVerdict(NOW, [job({ completedAt: ago(23.83) })]);
  assert.equal(v.kind, "ok", "23.83 <= 24 인데 알렸다 — 창 비교가 틀렸다");
});

/**
 * ⚠**여기가 F4 가 뚫은 자리다.** 설계서가 「`completed_at` 을 `created_at` 으로 바꾸면 붉어져야
 * 한다」고 적어 뒀는데 **그 선택이 시험 밖에 있었다.** 떼어내서 직접 잰다.
 *
 * ⚠**왜 `completed_at` 인가**: 묻는 것은 「끝까지 돌았는가」이고 `collect` 는 `timeout-minutes: 45` 다.
 * 시작·생성 시각으로 재면 **23시간 50분 전에 끝난 성공**을 24시간 밖으로 밀어내 거짓 경보가 난다.
 */
test("⚠끝난 시각(completed_at)을 읽는다 — started_at·created_at 으로 바꾸면 붉어진다", () => {
  const api: ApiJob = {
    name: "collect",
    conclusion: "success",
    completed_at: "2026-09-09T09:00:00Z",
    started_at: "2026-09-09T08:15:00Z",
    created_at: "2026-09-09T08:10:00Z",
  };
  const j = toCollectJob(7, api);
  assert.equal(j.completedAt, "2026-09-09T09:00:00Z", "completed_at 이 아닌 다른 필드를 읽고 있다");
  assert.equal(j.runId, 7);
  assert.equal(j.conclusion, "success");
});

/** 없는 필드는 `null` 이 되어야 한다 — `undefined` 가 새면 판정에서 조용히 빠진다 */
test("⚠없는 필드는 null 이다 — undefined 가 새면 판정에서 조용히 빠진다", () => {
  const j = toCollectJob(1, { name: "collect" });
  assert.equal(j.conclusion, null);
  assert.equal(j.completedAt, null);
});

/**
 * ⚠**파싱 못 한 시각이 최솟값 자리를 먹으면 멀쩡한 날에 경보가 난다**(이중 검토 Minor).
 * `NaN` 은 어떤 비교에도 false 라 그 뒤 유효한 성공이 와도 갱신되지 않는다.
 */
test("⚠읽을 수 없는 시각이 섞여도 유효한 성공을 가린다면 안 된다", () => {
  const v = heartbeatVerdict(NOW, [
    job({ runId: 2, completedAt: "그런 날짜 없음" }),
    job({ runId: 1, completedAt: ago(2) }),
  ]);
  assert.equal(v.kind, "ok", "읽을 수 없는 시각이 유효한 최근 성공을 가렸다");
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

/**
 * ⚠**진입점에서 `process.exit()` 을 부르지 않는다**(2026-09-10 · 머지 뒤 직접 돌려 발견).
 * 대기 중인 핸들(실패한 fetch 의 `AbortSignal.timeout` 타이머)이 남은 채 끊으면
 * Windows 에서 **libuv 단언이 터져 exit 127** 이 된다 — **종료 코드가 뜻을 잃는다.**
 * 감시기에서는 종료 코드가 곧 알림이라 그 자리를 지켜야 한다.
 * ⚠**「리눅스 러너면 괜찮겠지」로 두지 마라** — 실측: 정상 0 · 못 쟀을 때 **127 → 1**.
 */
test("⚠진입점이 process.exit 을 안 쓴다 — 대기 핸들이 남으면 종료 코드가 뜻을 잃는다", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../heartbeat.ts", import.meta.url)), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/process\.exit\s*\(/.test(code), "process.exit() 로 되돌아갔다 — exitCode 를 세워라");
  assert.match(code, /process\.exitCode\s*=/, "종료 코드를 세우지 않는다");
});
