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
 * ⚠**import 0개다** — 받기 자식 셋이 종료 코드를 정하는 곳이라 다른 모듈의 결함에 끌려 죽지 않게 잎으로 둔다.
 */

/** 받기 실패만 있었다 — 받기 자식 셋(`cli.ts` · `cli-players.ts` · `cli-starters.ts`)과 `scripts/update.ts` 만 쓴다(설계 D1) */
export const EXIT_UPSTREAM_ONLY = 75;

/** 실패의 갈래 — `upstream` 은 「새로 못 받았다」(데이터 불변) · `local` 은 그 밖 전부(쓰기·구조·사이드카·모르는 것) */
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

/** undici 코드 → kind(설계 D1 표) · 표에 없는 코드는 전부 `network` */
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
 * 실패 하나를 분류한다(설계 D1 · 위에서부터 처음 맞는 것):
 * ⑴ HTTP 응답이 있었다 → `http-<status>` ⑵ 오류(→ `cause` → `AggregateError` 의 첫 원소)의 `code` 가 표에 있다 → 그 kind ⑶ 그 밖 → `network`.
 * ⚠**문자열 코드만 읽는다** — `DOMException` 의 `code` 는 옛 숫자 코드(23 등)라 원인을 말하지 않는다. 코드가 없으면 오류 이름이 남는다.
 * ⚠우리는 `AbortSignal` 을 쓰지 않으므로(설계 D3) 평소 경로의 시간 초과는 전부 undici 코드로 온다.
 */
export function classifyFetchCause(input: { readonly status: number; readonly detail?: string } | { readonly error: unknown }): FetchCause {
  if ("status" in input) {
    return { kind: `http-${input.status}`, code: String(input.status), detail: input.detail ?? "", status: input.status };
  }
  const chain = chainOf(input.error);
  const withCode = chain.find((p) => typeof p.code === "string" && p.code !== "");
  const code = typeof withCode?.code === "string" ? withCode.code : nameOf(chain[0]);
  // ⚠detail 은 가장 안쪽의 비지 않은 메시지 — 바깥 「fetch failed」 가 아니라 「attempted address: …」 가 남게
  const detail = [...chain].reverse().map((p) => (typeof p.message === "string" ? p.message : "")).find((m) => m.trim() !== "") ?? "";
  return { kind: CODE_KIND.get(code) ?? "network", code, detail, status: null };
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
 * **종료 코드** — 실패 0건 → 0 · 실패가 있고 **전부 upstream** → 75 · 하나라도 local/미분류 → 1(설계 D1).
 * ⚠**75 계약은 받기 자식 셋뿐이다** — `cli-stats.ts`·`cli-draft*.ts`·`cli-games.ts` 는 0/1 그대로다(메시지·회로만 공통).
 */
export function exitCodeFor(results: readonly ResultLike[]): 0 | 1 | typeof EXIT_UPSTREAM_ONLY {
  const failed = results.filter(isFailure);
  if (failed.length === 0) return 0;
  return failed.every((r) => kindOf(r) === "upstream") ? EXIT_UPSTREAM_ONLY : 1;
}
