/**
 * **상류 받기 실패의 분류** — 한 타입(`UpstreamError`) · 만드는 곳 한 곳(`fetcher.ts`) · 종료 코드 75.
 *
 * 설계: `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D2.
 *
 * ⚠**왜 있는가**: 2026-10-21 부터 GitHub 러너에서 npb.jp 접속이 100% 실패했는데, 로그에 **원인이 0건**이었고(`cause` 를 메시지에
 *   안 넣었다) 「받기 실패」와 「적재·쓰기 실패」가 같은 종료 코드 1 이라 **이미 받아 둔 데이터로도 배포하지 못했다.**
 *   → 받기 실패만 있는 실행을 **75** 로 가르고(배포는 하되 붉게 끝낸다 · 사용자 결정 ②), 소진 메시지에 원인을 싣는다.
 * ⚠**`UpstreamError` 는 fetcher 만 만든다** — 호출자는 만들지도 세지도 않고 `instanceof` 로 가르기만 한다(`errorKindOf`).
 *   호출자가 만들 수 있으면 쓰기 실패를 상류로 잘못 적는 한 줄이 「깨진 데이터를 배포하는 길」이 된다(설계 D7).
 * ⚠⚠**상류인지는 닫힌 목록이 정한다**(2026-10-24 · 3중 검토 반영 · 설계 D1 ⑶) — HTTP 응답이 있었거나 원인 사슬에 **알려진 네트워크 코드**
 *   (`NETWORK_CODES`)가 있을 때만 상류다. 그 밖(cause 없는 `TypeError` · 헤더 검증 · 잘못된 URL · 모르는 코드)은 `FetchLocalError` —
 *   재시도 0 · 회로 계수 0 · local. 예전의 「모르는 것 → network」는 연락처의 CR/LF(우리 고장)를 4번 재시도한 뒤 **75(배포)** 로 만들었다.
 * ⚠**import 0개다** — 받기 자식 셋이 종료 코드를 정하는 곳이라 다른 모듈의 결함에 끌려 죽지 않게 잎으로 둔다.
 */

/** 받기 실패만 있었다 · **회로 닫힘** — 받기 자식 셋(`cli.ts` · `cli-players.ts` · `cli-starters.ts`)과 `scripts/update.ts` 만 쓴다(설계 D1) */
export const EXIT_UPSTREAM_ONLY = 75;
/** 받기 실패만 있었다 · **회로 열림** — 받기 자식 셋만 낸다. 부모가 뒤 받기 자식을 멈춘다(실행 판정은 75 와 같다 · 설계 D4) */
export const EXIT_UPSTREAM_CIRCUIT_OPEN = 69;
/** 로컬 실패가 있다 · **회로 열림** — 받기 자식 셋만 낸다. 부모가 뒤 받기 자식을 멈추고 실행은 막는다(설계 D4) */
export const EXIT_LOCAL_CIRCUIT_OPEN = 70;

/**
 * 실패의 갈래 — `upstream` 은 「새로 못 받았다」(실패한 단위는 쓰기 0) · `local` 은 그 밖 전부(쓰기·구조·사이드카·전송 전 로컬 고장·모르는 것).
 */
export type ErrorKind = "upstream" | "local";

/** 상류 실패의 종류 — HTTP 상태가 있으면 `http-<상태>` · 없으면 undici 코드 표(설계 D1) · 회로 열림 */
export type UpstreamKind = `http-${number}` | "connect-timeout" | "headers-timeout" | "body-timeout" | "network" | "circuit-open";

/** 시도 하나의 기록 — `code` 는 HTTP 상태나 오류 코드(없으면 오류 이름) · `ms` 는 그 시도의 경과 */
export interface UpstreamAttempt {
  readonly code: string;
  readonly ms: number;
}

/** 한 번의 실패 원인 — `detail` 은 사람이 읽을 한 줄(시도한 주소 · 다른 출처 등) */
export interface FetchCause {
  readonly kind: UpstreamKind;
  readonly code: string;
  readonly detail: string;
  /** HTTP 응답이 있었으면 그 상태 · 없으면 `null` */
  readonly status: number | null;
}

/** 소진·즉시 실패·회로 열림을 하나로 — 상류에서 「새로 못 받았다」 */
export class UpstreamError extends Error {
  readonly kind: UpstreamKind;
  readonly url: string;
  readonly attempts: readonly UpstreamAttempt[];
  readonly status: number | null;
  constructor(
    message: string,
    fields: { kind: UpstreamKind; url: string; attempts: readonly UpstreamAttempt[]; status: number | null },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UpstreamError";
    this.kind = fields.kind;
    this.url = fields.url;
    this.attempts = [...fields.attempts];
    this.status = fields.status;
  }
}

/**
 * **요청 전·중의 로컬 고장**(헤더 검증 · 잘못된 URL · 우리 코드의 예외 · 모르는 오류) — fetcher 가 **재시도하지 않고 회로에 세지 않고** 던진다.
 * ⚠`UpstreamError` 가 아니므로 `errorKindOf` 는 local 이다 → 종료 1(또는 70) — 배포를 막는 쪽(설계 D1 ⑶ · D7).
 * ⚠메시지에는 UA·연락처를 남기지 않는다(fetcher 가 지운 뒤 만든다 · 3중 검토 ③).
 */
export class FetchLocalError extends Error {
  readonly url: string;
  constructor(message: string, url: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FetchLocalError";
    this.url = url;
  }
}

/**
 * **그 달 월간 일정이 없다**(404 · 410) — 받기는 성공했다(회로도 성공으로 셌다).
 * ⚠**상류 실패가 아니다** — 현재 달이면 local(우리가 모르는 상태 → 막는다) · 다음 달이면 꼬리표 「（오프시즌이면 정상）」만 붙인다(설계 D1).
 * ⚠메시지 앞 구절은 옛 「월간 일정을 받지 못했다 (HTTP 404)」 그대로다(로그 검색 호환).
 */
export class ScheduleAbsentError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`월간 일정을 받지 못했다 (HTTP ${String(status)}): ${url}`);
    this.name = "ScheduleAbsentError";
    this.url = url;
    this.status = status;
  }
}

/** 호출자의 판정은 이 한 줄이다 — `UpstreamError` 만 상류 · 나머지는 전부 local(설계 D1 · M11 「모르면 막는다」) */
export function errorKindOf(err: unknown): ErrorKind {
  return err instanceof UpstreamError ? "upstream" : "local";
}

/**
 * **상류(전송) 실패로 보는 오류 코드 — 닫힌 목록**(설계 D1 ⑶ · 3중 검토 반영). 여기에 없으면 로컬 오류다(재시도 0 · 회로 0 · 막는 쪽).
 * ⚠**`UND_ERR_*` 를 통째로 넣지 않는다** — `UND_ERR_INVALID_ARG`(헤더 값 검증 · 비 latin1 UA)·`UND_ERR_CLOSED`·`UND_ERR_DESTROYED`·
 *   `UND_ERR_NOT_SUPPORTED` 같은 것은 **우리 쪽** 고장이다. 상대가 만든 것(시간 초과 · 소켓 · 응답 모양)만 고른다(undici 7.29.0 `lib/core/errors.js`).
 * ⚠**인증서 오류(`CERT_*` · `ERR_TLS_*`)는 넣지 않았다** — 상대의 설정 실수일 수도 있지만 가로채기일 수도 있다. 모르면 막는다(I4).
 */
export const NETWORK_CODES: ReadonlySet<string> = new Set([
  // undici — 시간 초과(홉별 한도 · 설계 D3) · 소켓 · 상대가 보낸 응답의 모양
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_OVERFLOW",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  // OS 소켓 · DNS
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "ENETDOWN",
  "EPROTO",
]);
/** 앞머리로 맞추는 네트워크 코드 — OpenSSL 의 TLS 핸드셰이크 오류(`ERR_SSL_WRONG_VERSION_NUMBER` 등) */
export const NETWORK_CODE_PREFIXES: readonly string[] = ["ERR_SSL_"];
/**
 * `DOMException` 의 이름으로 오는 전송 중단 — **정정 경로의 전송 시간 상한**(`metered-fetch.ts` 의 `AbortSignal.timeout`)과 본문 읽기 중단.
 * ⚠평소 경로는 `AbortSignal` 을 쓰지 않는다(설계 D3) — 이 두 이름은 정정 경로가 지금처럼 재시도하게 하려고 둔다.
 */
const NETWORK_DOM_NAMES: ReadonlySet<string> = new Set(["TimeoutError", "AbortError"]);

/** 코드가 닫힌 목록에 있는가 */
function isNetworkCode(code: string): boolean {
  return NETWORK_CODES.has(code) || NETWORK_CODE_PREFIXES.some((p) => code.startsWith(p));
}

/**
 * **이 예외가 상류(전송) 실패인가** — 원인 사슬(`chainOf`)의 어딘가에 닫힌 목록의 코드가 있거나, `DOMException` 이 시간 초과·중단이면 참.
 * ⚠그 밖은 전부 거짓이다(cause 없는 `TypeError`/`RangeError` · `ERR_INVALID_URL` · 헤더 검증 · 모르는 코드 · 문자열 · null) —
 *   fetcher 가 `FetchLocalError` 로 즉시 던진다(설계 D1 ⑶). **모르면 막는 쪽**(I4)이다: 상류로 잘못 보면 배포가 열리고, 로컬로 잘못 보면 한 실행이 막힐 뿐이다.
 * ⚠HTTP 응답이 있었던 실패(본문 읽기 중 끊김)는 fetcher 가 이 함수를 거치지 않고 상류로 센다 — 상대가 말을 했다.
 */
export function isUpstreamCause(err: unknown): boolean {
  for (const p of chainOf(err)) {
    if (typeof p.code === "string" && isNetworkCode(p.code)) return true;
    if (p instanceof DOMException && NETWORK_DOM_NAMES.has(p.name)) return true;
  }
  return false;
}

/** undici 코드 → kind(설계 D1 표) · 표에 없는 네트워크 코드는 `network` */
const CODE_KIND: ReadonlyMap<string, UpstreamKind> = new Map([
  ["UND_ERR_CONNECT_TIMEOUT", "connect-timeout"],
  ["UND_ERR_HEADERS_TIMEOUT", "headers-timeout"],
  ["UND_ERR_BODY_TIMEOUT", "body-timeout"],
]);

type Probe = { readonly code?: unknown; readonly name?: unknown; readonly message?: unknown; readonly cause?: unknown; readonly errors?: unknown };

function probe(x: unknown): Probe | null {
  return typeof x === "object" && x !== null ? (x as Probe) : null;
}

function firstOf(errors: unknown): Probe | null {
  return Array.isArray(errors) && errors.length > 0 ? probe(errors[0]) : null;
}

/**
 * 원인을 찾을 차례 — 오류 · 그 `cause` · `cause` 가 `AggregateError` 면 그 첫 원소 · 오류 자신이 `AggregateError` 면 그 첫 원소.
 * ⚠undici 의 `fetch` 는 바깥에 `TypeError("fetch failed")` 를 두고 진짜 원인을 `cause` 에 싣는다 — 바깥만 보면 「fetch failed」뿐이다.
 */
function chainOf(err: unknown): Probe[] {
  const top = probe(err);
  const cause = probe(top?.cause);
  return [top, cause, firstOf(cause?.errors), firstOf(top?.errors)].filter((p): p is Probe => p !== null);
}

/**
 * 예외 하나의 **코드와 한 줄** — 오류(→ `cause` → `AggregateError` 의 첫 원소)에서 처음 나오는 문자열 코드(없으면 오류 이름) ·
 * 가장 안쪽의 비지 않은 메시지. 상류 분류(`classifyFetchCause`)와 로컬 오류 메시지(`localFetchMessage`)가 같이 쓴다(M1).
 * ⚠**문자열 코드만 읽는다** — `DOMException` 의 `code` 는 옛 숫자 코드(23 등)라 원인을 말하지 않는다. 코드가 없으면 오류 이름이 남는다.
 */
export function describeCause(error: unknown): { readonly code: string; readonly detail: string } {
  const chain = chainOf(error);
  const withCode = chain.find((p) => typeof p.code === "string" && p.code !== "");
  const code = typeof withCode?.code === "string" ? withCode.code : nameOf(chain[0]);
  // ⚠detail 은 가장 안쪽의 비지 않은 메시지 — 바깥 「fetch failed」 가 아니라 「attempted address: …」 가 남게
  const detail = [...chain].reverse().map((p) => (typeof p.message === "string" ? p.message : "")).find((m) => m.trim() !== "") ?? (typeof error === "string" ? error : "");
  return { code, detail };
}

/**
 * **상류** 실패 하나를 분류한다(설계 D1 · 위에서부터 처음 맞는 것):
 * ⑴ HTTP 응답이 있었다 → `http-<status>` ⑵ 오류(→ `cause` → `AggregateError` 의 첫 원소)의 `code` 가 표에 있다 → 그 kind ⑶ 그 밖의 **네트워크 코드**
 *   (`isUpstreamCause` 가 참인 것) → `network`. ⚠**로컬 오류는 여기 오지 않는다** — fetcher 가 `isUpstreamCause` 로 먼저 가른다.
 * ⚠평소 경로는 `AbortSignal` 을 쓰지 않으므로(설계 D3) 시간 초과는 전부 undici 코드로 온다(정정 경로의 `DOMException` 은 이름이 코드 칸에 남는다).
 */
export function classifyFetchCause(input: { readonly status: number; readonly detail?: string } | { readonly error: unknown }): FetchCause {
  if ("status" in input) {
    return { kind: `http-${input.status}`, code: String(input.status), detail: input.detail ?? "", status: input.status };
  }
  const { code, detail } = describeCause(input.error);
  return { kind: CODE_KIND.get(code) ?? "network", code, detail, status: null };
}

/**
 * 로컬 오류 메시지 — `로컬 오류 (재시도 없음 · 상류 실패 아님): <url> — <code> <detail>`(400자 규칙은 `upstreamMessage` 와 같다).
 * ⚠`취득 실패 (` 로 시작하지 않는다 — 그 앞 구절은 상류 실패의 검색어다(설계 D2). 이건 npb.jp 가 아니라 **우리** 고장이다.
 * ⚠`detail` 은 부르는 쪽이 UA·연락처를 지운 것을 넘긴다(`redactSecrets`).
 */
export function localFetchMessage(o: { readonly url: string; readonly code: string; readonly detail: string }): string {
  const detail = clip(o.detail.replace(/\s+/g, " ").trim(), FIELD_MAX);
  return fitMessage(`로컬 오류 (재시도 없음 · 상류 실패 아님): ${clip(o.url, FIELD_MAX)} — ${clip(o.code, CODE_MAX)}${detail === "" ? "" : ` ${detail}`}`);
}

/**
 * **글에서 비밀을 지운다** — 각 `value`(비지 않은 것만)를 그 `label` 로 바꾼다. **긴 것부터** 바꾼다(UA 가 연락처를 품으므로 UA 를 먼저).
 * ⚠**공백 정리·자르기 전에** 부른다 — 잘린 뒤에는 일부만 남은 연락처를 못 찾는다(3중 검토 ③). undici 의 헤더 검증 오류는 헤더 값(= UA)을 메시지에 싣는다.
 */
export function redactSecrets(text: string, secrets: readonly { readonly value: string; readonly label: string }[]): string {
  let out = text;
  for (const s of [...secrets].filter((x) => x.value !== "").sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(s.value).join(s.label);
  }
  return out;
}

function nameOf(p: Probe | undefined): string {
  return typeof p?.name === "string" && p.name !== "" ? p.name : "Error";
}

/** 메시지 전체의 상한(JS `string.length`) — 넘으면 `MESSAGE_CUT` 자에서 자르고 `…`(설계 D2 · 4차-8) */
export const MESSAGE_MAX = 400;
export const MESSAGE_CUT = 397;
/** URL·detail 각각의 상한 — 넘으면 앞 119자 + `…` */
export const FIELD_MAX = 120;
/** 코드 칸의 상한 — 코드는 짧지만 출처가 남의 라이브러리라 상한을 둔다(마지막 원인이 늘 397자 안에 들게) */
const CODE_MAX = 40;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 400자 규칙 하나 — 400자까지는 그대로 · 넘으면 397자 + `…` */
export function fitMessage(message: string): string {
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_CUT)}…` : message;
}

/** 실패의 모양 — 앞 구절이 다르다(「소진」은 정말로 재시도를 다 쓴 것에만 쓴다) */
export type FailureMode = "exhausted" | "immediate" | "circuit-open";

/**
 * 소진 메시지(설계 D2):
 * `취득 실패 (재시도 N회 소진): <url> — 마지막 원인 <kind>[<code|status>] <detail> · 시도 1:<code|status> <ms>ms 2:<…> …`
 * ⚠**앞 구절 `취득 실패 (재시도 N회 소진)` 는 글자까지 유지한다**(로그 검색 호환). 즉시 실패와 회로 열림은 「소진」이 아니므로
 *   `취득 실패 (` 까지만 같고 괄호 안이 다르다 — 거짓으로 「소진」이라 쓰지 않는다.
 * ⚠**마지막 원인은 시도 목록 앞에 둔다** — 앞부분의 최악이 약 330자라 397자 안에 늘 들고, 잘리는 것은 시도 목록의 꼬리뿐이다.
 */
export function upstreamMessage(o: {
  readonly mode: FailureMode;
  readonly retries: number;
  readonly url: string;
  readonly last: FetchCause;
  readonly attempts: readonly UpstreamAttempt[];
}): string {
  const head =
    o.mode === "exhausted"
      ? `취득 실패 (재시도 ${String(o.retries)}회 소진)`
      : o.mode === "immediate"
        ? "취득 실패 (재시도 없음 · 즉시 실패)"
        : "취득 실패 (회로 열림 · 요청 0)";
  const detail = clip(o.last.detail.replace(/\s+/g, " ").trim(), FIELD_MAX);
  let message = `${head}: ${clip(o.url, FIELD_MAX)} — 마지막 원인 ${o.last.kind}[${clip(o.last.code, CODE_MAX)}]${detail === "" ? "" : ` ${detail}`}`;
  if (o.attempts.length > 0) {
    message += ` · 시도 ${o.attempts.map((a, i) => `${String(i + 1)}:${clip(a.code, CODE_MAX)} ${String(Math.max(0, Math.round(a.ms)))}ms`).join(" ")}`;
  }
  return fitMessage(message);
}

/**
 * 결과 하나 — ⑴ 페이지 결과(`outcome`) ⑵ 날짜 실패·다음 달 일정 실패(`error`) ⑶ 날짜 결과(`pages` — 그 자체는 실패가 아니다).
 * ⚠`errorKind` 가 없는 실패는 **미분류**이고 막는 쪽(1)으로 센다(I4).
 */
export type ResultLike =
  | { readonly outcome: string; readonly errorKind?: ErrorKind | undefined }
  | { readonly error: string; readonly errorKind?: ErrorKind | undefined }
  | { readonly pages: readonly unknown[] };

/** 실패인가 — 페이지 결과는 `failed` 만 · 날짜 실패 등은 `error` 문자열이 있으면 · 날짜 결과(`DayResult`)는 아니다(페이지는 따로 넘긴다) */
function isFailure(r: ResultLike): boolean {
  if ("outcome" in r) return r.outcome === "failed";
  return "error" in r && typeof r.error === "string";
}

function kindOf(r: ResultLike): ErrorKind | undefined {
  return "errorKind" in r ? r.errorKind : undefined;
}

/**
 * **종료 코드 — 「회로가 열렸는가」로 가른다**(설계 D1 · D4 · 2026-10-24 3중 검토 반영):
 *
 * | 실패 | 회로 닫힘 | 회로 열림 |
 * |---|---|---|
 * | 없음 | 0 | 0 |
 * | 전부 upstream | **75** | **69** |
 * | local/미분류가 하나라도 | **1** | **70** |
 *
 * ⚠**부모(`scripts/collect-steps.ts`)가 이 코드로 뒤 받기 자식을 띄울지 정한다** — 75·1 은 계속 · 69·70 은 멈춤. 예전에는 75 하나라
 *   「한 페이지만의 소진」과 「호스트가 죽었다」를 못 갈랐고(멈추면 형제를 굶기고), 로컬이 섞인 1 은 열린 회로를 부모에게 전하지 못해
 *   **다음 자식이 새 회로로 또 두드렸다**(3중 검토 3차 ① · 날짜 셋에 소진 9).
 * ⚠**75·69·70 계약은 받기 자식 셋뿐이다** — `cli-stats.ts`·`cli-draft*.ts`·`cli-games.ts` 는 0/1 그대로다(메시지·회로만 공통).
 *   `scripts/update.ts` 자신은 0 / 75 / 1 만 낸다(69 는 실행 판정에서 75 와 같다 · 워크플로 계약 불변).
 */
export function exitCodeFor(
  results: readonly ResultLike[],
  circuitOpen: boolean,
): 0 | 1 | typeof EXIT_UPSTREAM_ONLY | typeof EXIT_UPSTREAM_CIRCUIT_OPEN | typeof EXIT_LOCAL_CIRCUIT_OPEN {
  const failed = results.filter(isFailure);
  if (failed.length === 0) return 0;
  if (failed.every((r) => kindOf(r) === "upstream")) return circuitOpen ? EXIT_UPSTREAM_CIRCUIT_OPEN : EXIT_UPSTREAM_ONLY;
  return circuitOpen ? EXIT_LOCAL_CIRCUIT_OPEN : 1;
}
