/**
 * 상류 받기 실패의 분류 · 원인 기록 · 종료 코드(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D2 · 시험 T1 · T2 · T3).
 *
 * ⚠**가짜 `fetchImpl`·`sleep`·시계만 쓴다 — 외부 요청 0.** 루프백조차 안 쓴다(시간 상한은 `fetcher-timeouts.test.ts`).
 * ⚠**T1 은 표 구동이다** — 설계 D1 의 표 한 줄이 아래 `ROWS` 한 줄이다. 표에 줄이 늘면 여기도 는다.
 * ⚠**T2 가 이 PR 에서 가장 무거운 시험이다** — 「받기 실패만 배포」가 깨진 데이터를 내보내는 길을 열지 않는다는 것은
 *   **쓰기·구조·사이드카 실패가 절대 75 가 되지 않는다**는 것이다(설계 D7 경로 표).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { errors as undiciErrors } from "undici";
import { MonthlyScheduleCache, archiveDates, archiveUrl, isDayError } from "../src/archive.ts";
import type { DayError, DayResult, PageResult } from "../src/archive.ts";
import { HostCircuit } from "../src/circuit.ts";
import { PoliteFetcher, buildUserAgent, createDefaultFetchImpl } from "../src/fetcher.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import { archivePlayer } from "../src/players.ts";
import { MemorySink } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import { archiveStarters } from "../src/starters.ts";
import {
  EXIT_LOCAL_CIRCUIT_OPEN,
  EXIT_UPSTREAM_CIRCUIT_OPEN,
  EXIT_UPSTREAM_ONLY,
  FetchLocalError,
  MESSAGE_CUT,
  MESSAGE_MAX,
  ScheduleAbsentError,
  UpstreamError,
  classifyFetchCause,
  errorKindOf,
  exitCodeFor,
  fitMessage,
  isUpstreamCause,
  upstreamMessage,
} from "../src/upstream.ts";

// ---- 하네스 ---------------------------------------------------------------

/** 가상 시계 — `sleep` 이 시간을 전진시킨다 */
function harness() {
  let t = Date.parse("2026-10-24T00:26:00Z");
  const sleeps: number[] = [];
  return {
    clock: { now: () => new Date(t) },
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** 가짜 응답 한 벌 — `bodyError` 가 있으면 본문 읽기가 그것을 던진다(헤더 뒤 끊김) */
interface Fake {
  status: number;
  body?: string;
  location?: string;
  bodyError?: Error;
}

function respond(f: Fake) {
  const bytes = new TextEncoder().encode(f.body ?? "");
  return {
    status: f.status,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? (f.location ?? null) : null) },
    arrayBuffer: async () => {
      if (f.bodyError !== undefined) throw f.bodyError;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

/** `route` 는 n번째 전송(1부터)에 줄 응답 또는 던질 오류다 */
function fetcherOf(route: (url: string, n: number) => Fake | Error, o: { circuit?: HostCircuit; maxRetries?: number } = {}) {
  const h = harness();
  const calls: string[] = [];
  const impl: FetchImpl = async (url) => {
    calls.push(url);
    const r = route(url, calls.length);
    if (r instanceof Error) throw r;
    return respond(r);
  };
  const circuit = o.circuit ?? new HostCircuit({ clock: h.clock });
  const fetcher = new PoliteFetcher({
    userAgent: "bb-test",
    clock: h.clock,
    fetchImpl: impl,
    sleep: h.sleep,
    circuit,
    ...(o.maxRetries === undefined ? {} : { maxRetries: o.maxRetries }),
  });
  return { fetcher, calls, circuit, h };
}

const URL0 = "https://npb.jp/bis/players/00000001.html";

/** undici 가 연결 시간 초과에서 실제로 던지는 모양 — 바깥 `TypeError("fetch failed")` + 안쪽 `ConnectTimeoutError` */
const connectTimeout = (addr = "npb.jp:443"): Error =>
  new TypeError("fetch failed", { cause: new undiciErrors.ConnectTimeoutError(`Connect Timeout Error (attempted address: ${addr}, timeout: 30000ms)`) });
const headersTimeout = (): Error => new TypeError("fetch failed", { cause: new undiciErrors.HeadersTimeoutError() });
const bodyTimeout = (): Error => new TypeError("terminated", { cause: new undiciErrors.BodyTimeoutError() });
const coded = (code: string, message = `${code}(주입)`): Error => Object.assign(new Error(message), { code });

// ---- T1 · classifyFetchCause(설계 D1 의 kind 매핑 표) ------------------------

/**
 * ⚠⚠**로컬 오류를 상류로 분류하지 않는다**(2026-10-24 · 3중 검토 반영 · 설계 D1 ⑶). 예전에는 「모르는 것 → network」라
 * `cause` 없는 `TypeError`(헤더 검증 실패 등 우리 쪽 고장)도 4번 재시도한 뒤 상류 실패(75)가 되어 **배포가 열렸다.**
 * 이제 **HTTP 응답이 있었거나 `cause` 사슬에 알려진 네트워크 코드가 있을 때만** 상류다 — 목록은 `upstream.ts` 한 곳이다.
 */
test("⚠⚠T1 isUpstreamCause — 알려진 네트워크 코드·시간 초과만 상류 · cause 없는 TypeError·RangeError·ERR_INVALID_URL·모르는 코드는 로컬", () => {
  const upstream: [string, unknown][] = [
    ["연결 시간 초과", connectTimeout()],
    ["헤더 시간 초과", headersTimeout()],
    ["본문 시간 초과", bodyTimeout()],
    ["UND_ERR_SOCKET", new TypeError("fetch failed", { cause: coded("UND_ERR_SOCKET") })],
    ["ECONNRESET(직접)", coded("ECONNRESET")],
    ["ECONNREFUSED(cause)", new TypeError("fetch failed", { cause: coded("ECONNREFUSED") })],
    ["ECONNABORTED", coded("ECONNABORTED")],
    ["ENOTFOUND", coded("ENOTFOUND")],
    ["EAI_AGAIN", coded("EAI_AGAIN")],
    ["ETIMEDOUT", coded("ETIMEDOUT")],
    ["EPIPE", coded("EPIPE")],
    ["EHOSTUNREACH", coded("EHOSTUNREACH")],
    ["ENETUNREACH", coded("ENETUNREACH")],
    ["EPROTO", coded("EPROTO")],
    ["ERR_SSL_*", coded("ERR_SSL_WRONG_VERSION_NUMBER")],
    ["AggregateError 의 첫 원소", new TypeError("fetch failed", { cause: new AggregateError([coded("ECONNREFUSED"), coded("ENETUNREACH")]) })],
    // 정정 경로의 전송 시간 상한(AbortSignal.timeout) — 이름으로 온다
    ["DOMException(TimeoutError)", new DOMException("시간 초과", "TimeoutError")],
    ["DOMException(AbortError)", new DOMException("끊김", "AbortError")],
  ];
  const local: [string, unknown][] = [
    ["cause 없는 TypeError", new TypeError("Headers.append: invalid header value")],
    ["cause 없는 RangeError", new RangeError("x")],
    ["ERR_INVALID_URL", Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" })],
    ["모르는 코드", coded("E_SOMETHING_NEW")],
    ["undici 의 인자 오류(UND_ERR_INVALID_ARG)", new TypeError("fetch failed", { cause: coded("UND_ERR_INVALID_ARG") })],
    ["인증서 오류(목록 밖 — 막는 쪽)", coded("CERT_HAS_EXPIRED")],
    ["문자열", "boom"],
    ["null", null],
  ];
  for (const [name, err] of upstream) assert.equal(isUpstreamCause(err), true, `${name} 를 상류로 안 봤다`);
  for (const [name, err] of local) assert.equal(isUpstreamCause(err), false, `${name} 를 상류로 봤다 — 로컬 고장이 배포를 연다`);
});

test("⚠T1 classifyFetchCause — HTTP 응답이 있으면 http-<status> · 코드 표 · AggregateError 는 첫 원소", () => {
  const rows: [string, Parameters<typeof classifyFetchCause>[0], string, string][] = [
    ["HTTP 503", { status: 503 }, "http-503", "503"],
    ["HTTP 403", { status: 403 }, "http-403", "403"],
    ["연결 시간 초과", { error: connectTimeout() }, "connect-timeout", "UND_ERR_CONNECT_TIMEOUT"],
    ["헤더 시간 초과", { error: headersTimeout() }, "headers-timeout", "UND_ERR_HEADERS_TIMEOUT"],
    ["본문 시간 초과", { error: bodyTimeout() }, "body-timeout", "UND_ERR_BODY_TIMEOUT"],
    ["ECONNRESET", { error: coded("ECONNRESET") }, "network", "ECONNRESET"],
    ["ECONNREFUSED(cause)", { error: new TypeError("fetch failed", { cause: coded("ECONNREFUSED") }) }, "network", "ECONNREFUSED"],
    ["ENOTFOUND", { error: coded("ENOTFOUND") }, "network", "ENOTFOUND"],
    ["EAI_AGAIN", { error: coded("EAI_AGAIN") }, "network", "EAI_AGAIN"],
    ["ETIMEDOUT", { error: coded("ETIMEDOUT") }, "network", "ETIMEDOUT"],
    ["EPROTO", { error: coded("EPROTO") }, "network", "EPROTO"],
    ["UND_ERR_SOCKET", { error: coded("UND_ERR_SOCKET") }, "network", "UND_ERR_SOCKET"],
    ["ERR_SSL_*", { error: coded("ERR_SSL_WRONG_VERSION_NUMBER") }, "network", "ERR_SSL_WRONG_VERSION_NUMBER"],
    // ⚠DOMException 의 code 는 옛 숫자 코드(23)다 — 문자열 코드만 읽고 이름으로 떨어진다
    ["DOMException(TimeoutError)", { error: new DOMException("시간 초과", "TimeoutError") }, "network", "TimeoutError"],
    [
      "AggregateError 를 직접 던짐 → 첫 원소",
      { error: new AggregateError([coded("UND_ERR_CONNECT_TIMEOUT", "a"), coded("ECONNREFUSED", "b")]) },
      "connect-timeout",
      "UND_ERR_CONNECT_TIMEOUT",
    ],
    [
      "cause 가 AggregateError → 그 첫 원소",
      { error: new TypeError("fetch failed", { cause: new AggregateError([coded("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:443"), coded("ENETUNREACH", "x")]) }) },
      "network",
      "ECONNREFUSED",
    ],
  ];
  for (const [name, input, kind, code] of rows) {
    const c = classifyFetchCause(input);
    assert.equal(c.kind, kind, `${name}: kind`);
    assert.equal(c.code, code, `${name}: code`);
  }
  // HTTP 상태는 status 를 싣는다 · 오류는 null
  assert.equal(classifyFetchCause({ status: 503 }).status, 503);
  assert.equal(classifyFetchCause({ error: connectTimeout() }).status, null);
});

test("⚠T3 연결 시간 초과의 detail 에서 시도한 주소가 나온다(undici ConnectTimeoutError 의 메시지)", () => {
  const c = classifyFetchCause({ error: connectTimeout("203.0.113.7:443") });
  assert.match(c.detail, /attempted address: 203\.0\.113\.7:443, timeout: 30000ms/, `주소가 detail 에 없다: ${c.detail}`);
  // cause 가 AggregateError 면 첫 원소의 메시지 — 바깥의 「fetch failed」 가 아니다
  const agg = classifyFetchCause({ error: new TypeError("fetch failed", { cause: new AggregateError([coded("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:443")]) }) });
  assert.match(agg.detail, /1\.2\.3\.4:443/);
});

// ---- T1 · fetcher 가 D1 표대로 반환/던짐 · 회로 효과 · errorKind ----------------

interface Row {
  /** 설계 D1 표의 줄 */
  name: string;
  route: (url: string, n: number) => Fake | Error;
  /** 반환이면 상태 · 상류 실패면 kind 와 시도 기록 수 · 로컬 오류면 `local`(재시도 0 · 회로 0) */
  want: { returns: number } | { throws: string; attempts: number } | { local: true };
  /** 전송 수 */
  calls: number;
  /** 그 get 하나 뒤의 회로(연속 · 합계 · 열림) */
  circuit: { consecutive: number; total: number; open: boolean };
  /** 같은 응답으로 archiveUrl 을 돌렸을 때의 결과 */
  page: { outcome: PageResult["outcome"]; errorKind?: "upstream" | "local" };
}

const elsewhere = "https://other.example.net/x";
const CLOSED0 = { consecutive: 0, total: 0, open: false };
const FAILED1 = { consecutive: 1, total: 1, open: false };
const UP: Row["page"] = { outcome: "failed", errorKind: "upstream" };
const LOCAL: Row["page"] = { outcome: "failed", errorKind: "local" };
const ROWS: Row[] = [
  { name: "200", route: () => ({ status: 200, body: "OK" }), want: { returns: 200 }, calls: 1, circuit: CLOSED0, page: { outcome: "stored" } },
  { name: "304", route: () => ({ status: 304 }), want: { returns: 304 }, calls: 1, circuit: CLOSED0, page: { outcome: "unchanged" } },
  { name: "404(사실)", route: () => ({ status: 404 }), want: { returns: 404 }, calls: 1, circuit: CLOSED0, page: { outcome: "absent" } },
  { name: "410(사실)", route: () => ({ status: 410 }), want: { returns: 410 }, calls: 1, circuit: CLOSED0, page: { outcome: "absent" } },
  { name: "400 — 즉시(재시도 없음)", route: () => ({ status: 400 }), want: { throws: "http-400", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "405 — 즉시", route: () => ({ status: 405 }), want: { throws: "http-405", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  // ⚠401·403·451 도 즉시 열지 않는다(3중 검토 반영) — 한 페이지만의 403 이 형제 받기를 막지 않게. 의도적 차단이면 모든 페이지가 같아 연속 3 에서 곧 열린다
  { name: "401 — 즉시(재시도 없음) · 회로 +1", route: () => ({ status: 401 }), want: { throws: "http-401", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "403 — 즉시(재시도 없음) · 회로 +1", route: () => ({ status: 403 }), want: { throws: "http-403", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "451 — 즉시(재시도 없음) · 회로 +1", route: () => ({ status: 451 }), want: { throws: "http-451", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "501(재시도 집합 밖의 5xx) — 즉시 · 회로 +1", route: () => ({ status: 501 }), want: { throws: "http-501", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "408 — 재시도 후 소진", route: () => ({ status: 408 }), want: { throws: "http-408", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "429 — 재시도 후 소진(즉시 열림 아님)", route: () => ({ status: 429 }), want: { throws: "http-429", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "500 — 재시도 후 소진", route: () => ({ status: 500 }), want: { throws: "http-500", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "3xx 종결 ① 다른 출처", route: () => ({ status: 302, location: elsewhere }), want: { throws: "http-302", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  { name: "3xx 종결 ② 읽을 수 없는 Location", route: () => ({ status: 301, location: "http://[bad" }), want: { throws: "http-301", attempts: 1 }, calls: 1, circuit: FAILED1, page: UP },
  // 첫 요청 + 같은 출처 홉 3 = 전송 4 · 시도는 하나(홉은 한 시도 안이다)
  { name: "3xx 종결 ③ 홉 > 3", route: (_u, n) => ({ status: 307, location: `/hop${String(n)}` }), want: { throws: "http-307", attempts: 1 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "네트워크(ECONNRESET) — 재시도 후 소진", route: () => coded("ECONNRESET"), want: { throws: "network", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "연결 시간 초과 — 재시도 후 소진", route: () => connectTimeout(), want: { throws: "connect-timeout", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  { name: "헤더 시간 초과 — 재시도 후 소진", route: () => headersTimeout(), want: { throws: "headers-timeout", attempts: 4 }, calls: 4, circuit: FAILED1, page: UP },
  // ⚠로컬 오류 — 재시도 0 · 회로 0 · UpstreamError 아님(3중 검토 반영 · 설계 D1 ⑶)
  { name: "cause 없는 TypeError — 로컬 즉시", route: () => new TypeError("Headers.append: invalid"), want: { local: true }, calls: 1, circuit: CLOSED0, page: LOCAL },
  { name: "ERR_INVALID_URL — 로컬 즉시", route: () => Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" }), want: { local: true }, calls: 1, circuit: CLOSED0, page: LOCAL },
  { name: "모르는 코드 — 로컬 즉시", route: () => coded("E_SOMETHING_NEW"), want: { local: true }, calls: 1, circuit: CLOSED0, page: LOCAL },
];

for (const row of ROWS) {
  test(`⚠T1 D1 표 — ${row.name}`, async () => {
    const { fetcher, calls, circuit } = fetcherOf(row.route);
    let got: Row["want"];
    try {
      const res = await fetcher.get(URL0);
      got = { returns: res.status };
    } catch (err) {
      if ("local" in row.want) {
        assert.ok(err instanceof FetchLocalError, `로컬 오류가 FetchLocalError 가 아니다: ${String(err)}`);
        assert.ok(!(err instanceof UpstreamError));
        got = { local: true };
      } else {
        assert.ok(err instanceof UpstreamError, `UpstreamError 가 아닌 것을 던졌다: ${String(err)}`);
        got = { throws: err.kind, attempts: err.attempts.length };
        assert.equal(err.url, URL0);
      }
    }
    assert.deepEqual(got, row.want);
    assert.equal(calls.length, row.calls, "전송 수");
    const s = circuit.snapshot();
    assert.deepEqual({ consecutive: s.consecutive, total: s.total, open: s.open }, row.circuit, "회로 효과");

    // 같은 응답으로 archiveUrl — 결과와 errorKind(설계 D1 「호출자 판정은 instanceof UpstreamError 하나다」)
    const again = fetcherOf(row.route);
    const r = await archiveUrl("npb/test/page", URL0, { fetcher: again.fetcher, sink: new MemorySink(), clock: again.h.clock });
    assert.equal(r.outcome, row.page.outcome, "archiveUrl 의 결과");
    assert.equal(r.errorKind, row.page.errorKind, "archiveUrl 의 errorKind");
  });
}

test("⚠T1 회로가 열리면 남은 get 은 요청 0 으로 circuit-open 을 던진다 · 회로 상태는 그대로다", async () => {
  const { fetcher, calls, circuit } = fetcherOf(() => ({ status: 403 }));
  // ⚠403 도 한 번으로는 안 연다 — 연속 3 이면 연다(3중 검토 반영)
  for (let i = 0; i < 3; i += 1) await assert.rejects(fetcher.get(URL0), (e) => e instanceof UpstreamError && e.kind === "http-403");
  assert.equal(circuit.isOpen, true);
  const before = circuit.snapshot();
  await assert.rejects(fetcher.get(URL0), (e) => e instanceof UpstreamError && e.kind === "circuit-open" && e.attempts.length === 0);
  assert.equal(calls.length, 3, "열린 뒤에 요청이 나갔다");
  assert.deepEqual(circuit.snapshot(), before, "열린 뒤의 get 이 회로를 바꿨다");
});

test("⚠T1 로컬 오류는 재시도하지 않고 회로에 안 센다 — 그 뒤의 get 은 그대로 나간다", async () => {
  let n = 0;
  const { fetcher, calls, circuit } = fetcherOf(() => (++n <= 5 ? new TypeError("Headers.append: invalid") : { status: 200, body: "ok" }));
  for (let i = 0; i < 5; i += 1) await assert.rejects(fetcher.get(URL0), (e) => e instanceof FetchLocalError);
  assert.equal(calls.length, 5, "로컬 오류를 재시도했다");
  assert.deepEqual([circuit.snapshot().consecutive, circuit.snapshot().total, circuit.isOpen], [0, 0, false], "로컬 오류를 회로에 셌다");
  assert.equal((await fetcher.get(URL0)).status, 200);
});

/**
 * ⚠**응답이 왔으면 상류다**(설계 D1 ⑶ 「HTTP 응답이 있었다」) — 200 헤더 뒤 본문 읽기가 코드 없는 예외로 끊겨도 상대가 말을 하다 끊긴 것이다.
 * 이 갈래가 없으면 그런 끊김이 로컬 오류(재시도 0 · 막음)로 떨어진다.
 */
test("⚠T1 200 헤더 뒤 본문 읽기가 코드 없는 예외로 끊기면 상류(재시도 → 소진) — 응답이 있었다", async () => {
  const { fetcher, calls, circuit } = fetcherOf(() => ({ status: 200, bodyError: new TypeError("본문 끊김(주입)") }));
  const err = await fetcher.get(URL0).catch((e: unknown) => e);
  assert.ok(err instanceof UpstreamError, `상류 실패가 아니다: ${String(err)}`);
  assert.equal(err.kind, "network");
  assert.equal(calls.length, 4, "재시도하지 않았다");
  assert.equal(circuit.snapshot().total, 1);
});

test("T1 errorKindOf — UpstreamError 만 upstream · 나머지는 전부 local", () => {
  const up = new UpstreamError("x", { kind: "network", url: URL0, attempts: [], status: null });
  assert.equal(errorKindOf(up), "upstream");
  for (const other of [new Error("x"), new TypeError("fetch failed"), new ScheduleAbsentError(URL0, 404), new FetchLocalError("x", URL0), "문자열", null, undefined]) {
    assert.equal(errorKindOf(other), "local", String(other));
  }
});

/**
 * ⚠⚠**연락처가 로그에 안 남는다**(3중 검토 ③ · 방어). undici 의 헤더 검증 오류는 **헤더 값(= UA = 연락처)** 을 메시지에 싣는다 —
 * 로컬 오류든 상류 오류의 원인이든 메시지에서 UA 와 연락처를 지운다. ⚠`buildUserAgent` 가 이제 제어 문자를 막으므로 이 갈래는 방어다.
 */
test("⚠⚠T1 오류 메시지에서 UA 와 연락처를 지운다 — 로컬 오류 · 상류 오류의 원인 둘 다", async () => {
  const contact = "canary-contact@lunomel.jp";
  const ua = buildUserAgent(contact);
  const h = harness();
  const mk = (route: () => Error) =>
    new PoliteFetcher({ userAgent: ua, clock: h.clock, sleep: h.sleep, maxRetries: 1, fetchImpl: async () => { throw route(); } });
  const local = await mk(() => new TypeError(`Headers.append: "${ua}" is an invalid header value`)).get(URL0).catch((e: unknown) => e);
  assert.ok(local instanceof FetchLocalError);
  assert.equal(local.message.includes(contact), false, `로컬 오류 메시지에 연락처가 남았다: ${local.message}`);
  assert.equal(local.message.includes(ua), false);
  assert.match(local.message, /<User-Agent>/);
  const up = await mk(() => new TypeError("fetch failed", { cause: coded("ECONNRESET", `socket hang up (${ua}) ${contact}`) })).get(URL0).catch((e: unknown) => e);
  assert.ok(up instanceof UpstreamError);
  assert.equal(up.message.includes(contact), false, `상류 오류 메시지에 연락처가 남았다: ${up.message}`);
});

/**
 * ⚠**실제 undici 의 헤더 검증**(3중 검토 ③의 재현 모양) — 내부 CR/LF 가 든 UA 로 요청하면 연결 전에 `TypeError` 가 난다.
 * ⚠루프백 discard 포트(127.0.0.1:9)만 쓴다 — 검증이 요청 전이라 연결조차 안 한다(외부 요청 0).
 */
test("⚠T1 실제 undici — 내부 CR/LF 가 든 UA 는 로컬 오류(재시도 0 · UpstreamError 아님) · 메시지에 연락처 없음", async () => {
  const contact = "canary-contact@lunomel.jp";
  const ua = `bb-app-archiver/0.1 (personal, non-commercial; ${contact}\r\nX-Injected: 1)`;
  const h = harness();
  const fetcher = new PoliteFetcher({ userAgent: ua, clock: h.clock, sleep: h.sleep, fetchImpl: createDefaultFetchImpl({ connectMs: 500, headersMs: 500, bodyMs: 500 }) });
  const err = await fetcher.get("http://127.0.0.1:9/x").catch((e: unknown) => e);
  assert.ok(err instanceof FetchLocalError, `로컬 오류가 아니다: ${String(err)}`);
  assert.deepEqual(h.sleeps, [], "로컬 오류를 재시도했다(백오프를 잤다)");
  assert.equal(err.message.includes(contact), false, `메시지에 연락처가 남았다: ${err.message}`);
  assert.equal(fetcher.circuit.snapshot().total, 0, "로컬 오류를 회로에 셌다");
});

test("⚠T1 buildUserAgent — 제어 문자(CR·LF·TAB·DEL·C1)와 ByteString 밖 문자를 거부한다 · 메시지에 연락처를 남기지 않는다", () => {
  for (const bad of ["me@lunomel.jp\r\nX: 1", "me@lu\nnomel.jp", "me\t@lunomel.jp", "me@lunomel.jp\u007f", "me@lunomel.jp\u0085", "연락@lunomel.jp", "me@lunomel.jp😀"]) {
    let message = "";
    assert.throws(
      () => buildUserAgent(bad),
      (e: unknown) => {
        message = e instanceof Error ? e.message : String(e);
        return /쓸 수 없는 문자/.test(message);
      },
      JSON.stringify(bad),
    );
    assert.equal(message.includes("lunomel"), false, `거부 메시지에 연락처가 남았다: ${message}`);
  }
  // 앞뒤 공백은 지금처럼 잘라서 받는다 · latin1 보통 문자(é)는 ByteString 이라 받는다
  assert.match(buildUserAgent("  me@lunomel.jp \n"), /\(personal, non-commercial; me@lunomel\.jp\)$/);
  assert.doesNotThrow(() => buildUserAgent("café@lunomel.jp"));
});

test("⚠T2 exitCodeFor — 회로가 열렸으면 상류만 69 · 로컬이 있으면 70(부모가 뒤 받기를 멈춘다) · 닫혔으면 75 / 1", () => {
  const up: PageResult = { key: "b", url: "u", outcome: "failed", status: null, error: "x", errorKind: "upstream" };
  const local: PageResult = { key: "c", url: "u", outcome: "failed", status: null, error: "x", errorKind: "local" };
  assert.deepEqual([EXIT_UPSTREAM_CIRCUIT_OPEN, EXIT_LOCAL_CIRCUIT_OPEN, EXIT_UPSTREAM_ONLY], [69, 70, 75]);
  assert.equal(exitCodeFor([up], true), 69);
  assert.equal(exitCodeFor([up], false), 75);
  assert.equal(exitCodeFor([up, local], true), 70);
  assert.equal(exitCodeFor([up, local], false), 1);
  assert.equal(exitCodeFor([local], true), 70);
  assert.equal(exitCodeFor([], false), 0);
});

// ---- T2 · local 은 75 가 되지 않는다(가장 중요) ------------------------------

/** 쓰기·사이드카에 고장을 넣는 Sink */
class FaultySink extends MemorySink {
  failRead = false;
  failWrite = false;
  failWriteMeta = false;
  override async readMeta(key: string): Promise<BlobMeta | null> {
    if (this.failRead) throw new Error("사이드카가 깨졌다(주입)");
    return super.readMeta(key);
  }
  override async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    if (this.failWrite) throw new Error("디스크 오류(본문 · 주입)");
    return super.write(key, body, meta);
  }
  override async writeMeta(key: string, meta: BlobMeta): Promise<void> {
    if (this.failWriteMeta) throw new Error("디스크 오류(사이드카 · 주입)");
    return super.writeMeta(key, meta);
  }
}

const MONTHLY = `<a href="/scores/2026/1020/s-db-17/">g1</a>`;

test("⚠⚠T2 쓰기 실패(commitPrepared 의 catch)는 local — exitCodeFor 는 1 이다(75 가 아니다)", async () => {
  const sink = new FaultySink();
  sink.failWrite = true;
  const { fetcher, h } = fetcherOf(() => ({ status: 200, body: "<html>new</html>" }));
  const r = await archiveUrl("npb/test/page", URL0, { fetcher, sink, clock: h.clock });
  assert.equal(r.outcome, "failed");
  assert.equal(r.errorKind, "local", "쓰기 실패가 상류로 분류됐다 — 받기만 실패한 것으로 보고 배포한다");
  assert.equal(exitCodeFor([r], false), 1);
});

test("⚠T2 사이드카를 못 읽음(readMeta) → local → 1", async () => {
  const sink = new FaultySink();
  sink.failRead = true;
  const { fetcher, h, calls } = fetcherOf(() => ({ status: 200, body: "x" }));
  const r = await archiveUrl("npb/test/page", URL0, { fetcher, sink, clock: h.clock });
  assert.equal(r.outcome, "failed");
  assert.equal(r.errorKind, "local");
  assert.equal(calls.length, 0, "사이드카를 못 읽으면 받지도 않는다(지금과 같다)");
  assert.equal(exitCodeFor([r], false), 1);
});

test("⚠T2 일정 구조 변경(NoGamesFoundError) · 현재 달 일정 404(ScheduleAbsentError) → 날짜 실패 local → 1", async () => {
  // 구조 변경 — 링크 0건 · 날짜 행 없음
  const broken = fetcherOf((url) => (url.includes("schedule_10_detail") ? { status: 200, body: "<div>新レイアウト</div>" } : { status: 200, body: "x" }));
  const a = await archiveDates(["2026-10-20"], { fetcher: broken.fetcher, sink: new MemorySink(), clock: broken.h.clock });
  assert.ok(isDayError(a[0]!));
  assert.equal(a[0].errorKind, "local");
  assert.equal(exitCodeFor(a, false), 1);

  // 현재 달 일정 404 — 404 는 사실이지만 「그 달 일정이 없다」는 받기 실패가 아니라 우리가 모르는 상태다
  const absent = fetcherOf((url) => (url.includes("schedule_10_detail") ? { status: 404 } : { status: 200, body: "x" }));
  const b = await archiveDates(["2026-10-20"], { fetcher: absent.fetcher, sink: new MemorySink(), clock: absent.h.clock });
  assert.ok(isDayError(b[0]!));
  assert.equal(b[0].errorKind, "local");
  assert.match(b[0].error, /월간 일정을 받지 못했다 \(HTTP 404\)/);
  assert.equal(exitCodeFor(b, false), 1);
  // 꼬리표를 붙일 자리가 가를 수 있게 — ScheduleAbsentError 자체를 던진다
  const cache = new MonthlyScheduleCache();
  const again = fetcherOf(() => ({ status: 410 }));
  await assert.rejects(cache.get(2026, 10, { fetcher: again.fetcher, sink: new MemorySink(), clock: again.h.clock }), (e) => e instanceof ScheduleAbsentError && e.status === 410);
});

test("⚠T2 일정 받기가 상류 실패면 날짜 실패는 upstream → 75", async () => {
  const down = fetcherOf(() => connectTimeout());
  const days = await archiveDates(["2026-10-20"], { fetcher: down.fetcher, sink: new MemorySink(), clock: down.h.clock });
  assert.ok(isDayError(days[0]!));
  assert.equal(days[0].errorKind, "upstream");
  assert.equal(exitCodeFor(days, false), EXIT_UPSTREAM_ONLY);
});

test("⚠T2 선수 페이지 — 쓰기 실패·「없다」 기록 실패는 local → 1 · 받기 실패는 upstream → 75", async () => {
  const write = new FaultySink();
  write.failWrite = true;
  const a = fetcherOf(() => ({ status: 200, body: "<html>選手</html>" }));
  const ra = await archivePlayer("00000001", { fetcher: a.fetcher, sink: write, clock: a.h.clock });
  assert.equal(ra.outcome, "failed");
  assert.equal(ra.errorKind, "local");
  assert.equal(exitCodeFor([ra], false), 1);

  const meta = new FaultySink();
  meta.failWriteMeta = true;
  const b = fetcherOf(() => ({ status: 404 }));
  const rb = await archivePlayer("00000001", { fetcher: b.fetcher, sink: meta, clock: b.h.clock });
  assert.equal(rb.outcome, "failed");
  assert.equal(rb.errorKind, "local");

  const c = fetcherOf(() => ({ status: 503 }));
  const rc = await archivePlayer("00000001", { fetcher: c.fetcher, sink: new MemorySink(), clock: c.h.clock });
  assert.equal(rc.outcome, "failed");
  assert.equal(rc.errorKind, "upstream");
  assert.equal(exitCodeFor([rc], false), EXIT_UPSTREAM_ONLY);
});

test("⚠T2 予告先発 — 쓰기 실패는 local → 1 · 받기 실패는 upstream → 75", async () => {
  const write = new FaultySink();
  write.failWrite = true;
  const a = fetcherOf(() => ({ status: 200, body: "<html>予告</html>" }));
  const ra = await archiveStarters("2026-10-24", { fetcher: a.fetcher, sink: write, clock: a.h.clock });
  assert.equal(ra.errorKind, "local");
  assert.equal(exitCodeFor([ra], false), 1);

  const b = fetcherOf(() => coded("ECONNRESET"));
  const rb = await archiveStarters("2026-10-24", { fetcher: b.fetcher, sink: new MemorySink(), clock: b.h.clock });
  assert.equal(rb.outcome, "failed");
  assert.equal(rb.errorKind, "upstream");
  assert.equal(exitCodeFor([rb], false), EXIT_UPSTREAM_ONLY);
});

test("⚠T2 exitCodeFor — 0건 0 · 전부 upstream 75 · local 이 하나라도 1 · 미분류(errorKind 없음)도 1 · 실패 아닌 결과는 세지 않는다", () => {
  const ok: PageResult = { key: "a", url: "u", outcome: "stored", status: 200, error: null };
  const held: PageResult = { key: "h", url: "u", outcome: "held", status: 200, error: null };
  const up: PageResult = { key: "b", url: "u", outcome: "failed", status: null, error: "x", errorKind: "upstream" };
  const local: PageResult = { key: "c", url: "u", outcome: "failed", status: null, error: "x", errorKind: "local" };
  const unknown: PageResult = { key: "d", url: "u", outcome: "failed", status: null, error: "x" };
  assert.equal(EXIT_UPSTREAM_ONLY, 75);
  assert.equal(exitCodeFor([], false), 0);
  assert.equal(exitCodeFor([ok, held], false), 0);
  assert.equal(exitCodeFor([ok, up], false), 75);
  // 날짜 실패·다음 달 일정 실패는 `outcome` 없이 `error` 를 든 실패다
  const dayUp: DayError = { date: "2026-10-20", error: "x", errorKind: "upstream" };
  assert.equal(exitCodeFor([up, dayUp], false), 75);
  assert.equal(exitCodeFor([{ error: "다음 달 일정 소진", errorKind: "upstream" }], false), 75);
  // 날짜 결과(`DayResult`)는 실패가 아니다 — 경기 0건인 날도, 페이지가 실패한 날도(페이지는 따로 넘긴다)
  const quiet: DayResult = { date: "2026-10-20", gamesFound: 0, pages: [] };
  const withFailedPage: DayResult = { date: "2026-10-21", gamesFound: 1, pages: [local] };
  assert.equal(exitCodeFor([quiet, withFailedPage], false), 0);
  assert.equal(exitCodeFor([up, local], false), 1, "상류와 섞여도 local 이면 1");
  assert.equal(exitCodeFor([local, up], false), 1);
  assert.equal(exitCodeFor([up, unknown], false), 1, "미분류는 막는 쪽(1)이다(I4)");
  const dayUnknown: DayError = { date: "2026-10-20", error: "x" };
  assert.equal(exitCodeFor([dayUnknown], false), 1, "분류 없는 날짜 실패는 1");
});

// ---- T3 · 원인 기록(설계 D2) -------------------------------------------------

test("⚠T3 소진 메시지 — 앞 구절 글자 그대로 · 마지막 원인 · 시도별 코드와 ms · cause 는 그대로", async () => {
  const { fetcher, h } = fetcherOf((_u, n) => {
    h.advance(10_000 + n); // 시도마다 다른 경과(가상 시계)
    return connectTimeout("203.0.113.7:443");
  });
  const err = await fetcher.get(URL0).then(
    () => assert.fail("던져야 한다"),
    (e: unknown) => e,
  );
  assert.ok(err instanceof UpstreamError);
  const m = err.message;
  assert.ok(m.startsWith(`취득 실패 (재시도 3회 소진): ${URL0} — 마지막 원인 connect-timeout[UND_ERR_CONNECT_TIMEOUT] `), m);
  assert.match(m, /attempted address: 203\.0\.113\.7:443/);
  assert.match(m, / · 시도 1:UND_ERR_CONNECT_TIMEOUT 10001ms 2:UND_ERR_CONNECT_TIMEOUT 10002ms 3:UND_ERR_CONNECT_TIMEOUT 10003ms 4:UND_ERR_CONNECT_TIMEOUT 10004ms$/, m);
  assert.deepEqual(err.attempts.map((a) => a.ms), [10_001, 10_002, 10_003, 10_004]);
  assert.ok(err.cause instanceof TypeError, "cause 를 그대로 붙이지 않았다");
  assert.equal(err.status, null);
});

test("⚠T3 HTTP 소진 — 시도마다 상태 코드 · status 는 마지막 응답", async () => {
  const { fetcher } = fetcherOf((_u, n) => ({ status: n % 2 === 1 ? 503 : 502 }));
  const err = (await fetcher.get(URL0).catch((e: unknown) => e)) as UpstreamError;
  assert.ok(err instanceof UpstreamError);
  assert.equal(err.kind, "http-502");
  assert.equal(err.status, 502);
  assert.match(err.message, /마지막 원인 http-502\[502\]/);
  assert.match(err.message, / · 시도 1:503 0ms 2:502 0ms 3:503 0ms 4:502 0ms$/);
});

test("⚠T3 즉시 실패(4xx · 3xx 종결)는 「소진」이라고 쓰지 않는다 — 다른 출처면 어디로 보냈는지 적는다", async () => {
  const a = (await fetcherOf(() => ({ status: 403 })).fetcher.get(URL0).catch((e: unknown) => e)) as UpstreamError;
  assert.ok(a.message.startsWith("취득 실패 (재시도 없음 · 즉시 실패): "), a.message);
  assert.doesNotMatch(a.message, /소진/);
  const b = (await fetcherOf(() => ({ status: 302, location: elsewhere })).fetcher.get(URL0).catch((e: unknown) => e)) as UpstreamError;
  assert.match(b.message, /마지막 원인 http-302\[302\] 다른 출처로 보냄 https:\/\/other\.example\.net/, b.message);
});

test("⚠T3 400자 규칙 — fitMessage: 399·400 은 그대로 · 401 은 397자 + … (단위는 string.length)", () => {
  assert.equal(MESSAGE_MAX, 400);
  assert.equal(MESSAGE_CUT, 397);
  for (const n of [0, 1, 399, 400]) assert.equal(fitMessage("가".repeat(n)), "가".repeat(n), `${String(n)}자가 바뀌었다`);
  for (const n of [401, 402, 1000]) {
    const out = fitMessage("가".repeat(n));
    assert.equal(out.length, 398, `${String(n)}자 → ${String(out.length)}자`);
    assert.ok(out.endsWith("…"));
    assert.equal(out.slice(0, 397), "가".repeat(397));
  }
});

test("⚠T3 400자 규칙 — 조립한 메시지가 정확히 399 · 400 · 401 자일 때(경계)", () => {
  /**
   * URL 은 딱 120자(줄이지 않는 상한) · 시도 12개로 길이를 거의 채우고, **detail 의 길이로 한 자씩** 맞춘다 —
   * detail 은 120자 안에서만 쓰므로 줄지 않고, 조립 길이 = detail 이 빈 길이 + 1(띄어쓰기) + detail 길이다.
   */
  const url120 = `https://npb.jp/${"u".repeat(120 - "https://npb.jp/".length)}`;
  assert.equal(url120.length, 120);
  const attempts = Array.from({ length: 12 }, () => ({ code: "503", ms: 1 }));
  const withDetail = (detail: string): string =>
    upstreamMessage({ mode: "exhausted", retries: 3, url: url120, last: { kind: "http-503", code: "503", detail, status: 503 }, attempts });
  const empty = withDetail("").length;
  const at = (target: number): string => {
    const d = target - empty - 1;
    assert.ok(d >= 1 && d <= 120, `전제가 틀렸다 — detail 이 ${String(d)}자여야 한다(빈 길이 ${String(empty)})`);
    return withDetail("d".repeat(d));
  };
  assert.equal(at(399).length, 399);
  assert.equal(at(400).length, 400, "정확히 400자인데 잘랐다");
  assert.ok(!at(400).endsWith("…"));
  const cut = at(401);
  assert.equal(cut.length, 398, "401자를 397자 + … 로 자르지 않았다");
  assert.ok(cut.endsWith("…"));
});

test("⚠T3 400자 규칙 — 긴 URL 200자 + 긴 detail + 4시도 AggregateError: URL·detail 은 120자 · 마지막 원인은 늘 남는다", async () => {
  const longUrl = `https://npb.jp/${"a".repeat(200 - "https://npb.jp/".length)}`;
  assert.equal(longUrl.length, 200);
  const longDetail = `connect ECONNREFUSED ${"9".repeat(300)}`;
  const { fetcher } = fetcherOf(() => new TypeError("fetch failed", { cause: new AggregateError([coded("UND_ERR_CONNECT_TIMEOUT", longDetail), coded("ECONNREFUSED", "b")]) }));
  const err = (await fetcher.get(longUrl).catch((e: unknown) => e)) as UpstreamError;
  assert.ok(err instanceof UpstreamError);
  const m = err.message;
  assert.ok(m.length <= MESSAGE_MAX, `${String(m.length)}자`);
  assert.equal(m.length, 398, "조립이 400자를 넘는데 397자 + … 가 아니다");
  assert.ok(m.endsWith("…"));
  // URL 은 앞 119자 + …
  assert.ok(m.includes(`${longUrl.slice(0, 119)}… — 마지막 원인 `), "URL 을 120자(119 + …)로 줄이지 않았다");
  // 마지막 원인은 목록 앞에 있어 잘리지 않는다 — detail 도 120자(119 + …)
  assert.ok(m.includes(`마지막 원인 connect-timeout[UND_ERR_CONNECT_TIMEOUT] ${longDetail.slice(0, 119)}… · 시도 1:`), m);
  // 잘린 것은 시도 목록의 꼬리뿐이다
  assert.ok(m.indexOf("마지막 원인") < m.indexOf(" · 시도 "));
});

test("T3 회로 열림의 메시지 — 요청 0 이라고 적고 열린 계기를 적는다", async () => {
  const { fetcher } = fetcherOf(() => ({ status: 451 }));
  for (let i = 0; i < 3; i += 1) await fetcher.get(URL0).catch(() => undefined);
  const err = (await fetcher.get(URL0).catch((e: unknown) => e)) as UpstreamError;
  assert.equal(err.kind, "circuit-open");
  assert.ok(err.message.startsWith(`취득 실패 (회로 열림 · 요청 0): ${URL0} — 마지막 원인 circuit-open[consecutive]`), err.message);
  assert.ok(err.message.length <= MESSAGE_MAX);
});
