/**
 * 예의 있는 HTTP 취득 (CLAUDE.md L1 · L7 · M8).
 *
 * 이 파일이 지키는 것:
 *   - 요청 간 최소 간격 (기본 3초) · **동시 1커넥션**
 *   - 식별 가능한 UA + 연락처
 *   - 조건부 요청(If-None-Match / If-Modified-Since) → 안 보내는 요청이 가장 안전한 요청
 *   - 지수 백오프 재시도, 단 4xx는 재시도하지 않는다
 *
 * ⚠npb.jp의 robots.txt는 404다(2026-08-14 실측). 이는 **「허용」이 아니라 「지시 없음」**이므로
 * 허용의 근거로 쓰지 않는다. 지시가 없을수록 보수적으로 움직인다.
 *
 * ## 받기 실패의 분류 · 원인 기록 · 회로 · 시간 상한 (2026-10-24 · 설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md`)
 *
 * - **2xx · 304 · 404 · 410 만 돌려준다.** 그 밖의 모든 비성공은 `UpstreamError` 를 **여기서만** 던진다(D1) — 재시도 대상(`RETRYABLE` 의
 *   408·425·429·500·502·503·504 · 알려진 네트워크 코드·시간 초과)은 소진 뒤에, 그 밖의 4xx·5xx·3xx 종결은 즉시. 호출자는 만들지도 세지도 않는다.
 * - ⚠**응답 없는 예외가 알려진 네트워크 코드가 아니면 로컬 오류다**(D1 ⑶ · 2026-10-24 3중 검토 반영) — `FetchLocalError` 를 즉시 던진다
 *   (재시도 0 · 회로 0). 헤더 검증(연락처의 CR/LF) 같은 우리 고장이 「상류 장애」로 배포를 여는 길을 막는다. 메시지에서 UA·연락처를 지운다.
 * - **소진 메시지에 원인을 싣는다**(D2) — 예전에는 `cause` 만 붙이고 메시지에 안 넣어 **10/21 장애 로그에 원인이 0건**이었다.
 * - **회로**(D4 · `circuit.ts`) — 404·410 을 뺀 비성공이 연속 N 또는 합계 6 이면 남은 `get()` 이 요청 0 으로 끝난다.
 * - **홉마다 연결 30 · 헤더 30 · 본문 유휴 30초**(D3) — 기본 전송이 undici `Agent` 다. 예전 기본(내장 `fetch`)은 연결 10초(실측)에
 *   헤더·본문 대기가 300초(npm `undici@7.29.0` 소스 · 내장 7.28.0 은 **미확인**)였다. ⚠**`AbortSignal` 을 쓰지 않는다** — 단일 마감은 폐기했다(4차-1).
 */
import { Agent, fetch as undiciFetch } from "undici";
import type { Clock } from "./clock.ts";
import { HostCircuit } from "./circuit.ts";
import { L1_MIN_DELAY_MS, isValidDelayMs } from "./l1.ts";
import {
  FetchLocalError,
  UpstreamError,
  classifyFetchCause,
  describeCause,
  isUpstreamCause,
  localFetchMessage,
  redactSecrets,
  upstreamMessage,
} from "./upstream.ts";
import type { FetchCause, UpstreamAttempt } from "./upstream.ts";

export interface FetchResponse {
  status: number;
  body: Uint8Array | null;
  etag: string | null;
  lastModified: string | null;
}

/**
 * 테스트에서 갈아끼우기 위한 최소 인터페이스.
 *
 * ⚠`redirect: "manual"` 을 넘긴다 — 리디렉션은 `PoliteFetcher` 가 **직접** 따라간다(아래 `getUnqueued`).
 * ⚠`body` 는 선택이다. 있으면 성공 본문을 읽지 않는 응답(3xx 홉·오류·304)에서 **취소**한다.
 */
export type FetchImpl = (url: string, init: { headers: Record<string, string>; redirect?: "manual" }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: { cancel(): Promise<void> } | null;
}>;

type RawResponse = Awaited<ReturnType<FetchImpl>>;

/**
 * 읽지 않을 응답 본문을 버린다(2026-09-25 감사 C2).
 *
 * ⚠**버리지 않으면 연결이 열린 채 남는다.** 네이티브 `fetch` 는 헤더만 받고 돌아오므로, 오류 본문을
 * 안 버리면 백오프 뒤의 다음 요청이 **앞 응답이 열린 채로** 나간다 — 간격은 지켜도 L1 의
 * **동시 1커넥션**이 깨진다(실측: 로컬 서버에서 첫 429 응답이 끝까지 안 닫혔다).
 * ⚠**끝까지 읽지(`arrayBuffer`) 않고 취소한다** — 상대가 본문을 안 닫으면 읽기는 영원히 기다린다.
 * ⚠취소 실패는 삼킨다 — 이미 닫힌 흐름을 또 닫는 것은 결함이 아니다. 요청의 성패는 상태 코드가 말한다.
 */
async function discard(res: RawResponse): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // 이미 닫혔다
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * **홉마다의 시간 상한**(설계 D3) — 연결 · 응답 헤더 · 본문 유휴(청크 사이). 우리는 `AbortSignal` 을 쓰지 않으므로
 * 시간 초과는 전부 undici 코드(`UND_ERR_CONNECT_/HEADERS_/BODY_TIMEOUT`)로 오고 **단계가 코드에 담긴다.**
 * ⚠**10 → 30초**: 10초(undici 기본값이 우연히 막은 값)에서는 「수락이 느린 호스트」와 「SYN 을 버리는 호스트」가 둘 다 10.5초 실패로 보였다.
 *   30초는 다섯 번째 SYN(15초) 재전송의 응답까지 담는다(일반 동작 · 러너 커널 설정 **미확인**). 우회가 아니다 — 요청 수는 같고 더 오래 기다릴 뿐이다.
 * ⚠**undici 의 헤더·본문 한도는 약 0.5초 눈금이다**(빠른 타이머 `lib/util/timers.js` · 7.29.0) — 작은 값 실측은 300ms → 약 1.0초였고,
 *   소스상 눈금 하나만큼 **일찍** 끊길 수도 있다. 30초 한도에서 ±1초 안쪽의 차이라 설계의 계산(D3)을 바꾸지 않는다. 작은 값으로 재는 시험은 눈금을 감안한다.
 */
export interface TransportLimits {
  readonly connectMs: number;
  readonly headersMs: number;
  readonly bodyMs: number;
}
export const TRANSPORT_LIMITS: TransportLimits = { connectMs: 30_000, headersMs: 30_000, bodyMs: 30_000 };

/** `Agent` 에 넘기는 옵션 — 이 모양 그대로다(시험이 가짜 생성자로 대조한다) */
export interface AgentOptionsUsed {
  readonly connect: { readonly timeout: number };
  readonly headersTimeout: number;
  readonly bodyTimeout: number;
  readonly connections: number;
}

/** 기본 전송의 부품 — **시험이 가짜를 넣으려고만** 둔다(제품 경로는 언제나 undici 의 진짜 `Agent`·`fetch`) */
export interface TransportImpl {
  readonly Agent: new (opts: AgentOptionsUsed) => object;
  readonly fetch: (url: string, init: Record<string, unknown>) => Promise<unknown>;
}

const UNDICI: TransportImpl = { Agent, fetch: undiciFetch as unknown as TransportImpl["fetch"] };

/**
 * `PoliteFetcher` 의 기본 전송 — undici `fetch` + **fetcher 하나에 `Agent` 하나**(연결 재사용 · `connections: 1` 은 동시 1커넥션의 겉 걸쇠).
 * ⚠**주입된 `fetchImpl` 은 그대로다**(정정 경로의 계측·시간 상한은 `metered-fetch.ts` 가 따로 건다 · 설계 D3).
 * ⚠Agent 를 모듈 전역에 두지 않는다(루트 §6) — fetcher 마다 만든다.
 */
export function createDefaultFetchImpl(limits: TransportLimits = TRANSPORT_LIMITS, transport: TransportImpl = UNDICI): FetchImpl {
  const dispatcher = new transport.Agent({
    connect: { timeout: limits.connectMs },
    headersTimeout: limits.headersMs,
    bodyTimeout: limits.bodyMs,
    connections: 1,
  });
  return async (url, init) => (await transport.fetch(url, { ...init, dispatcher })) as RawResponse;
}

/** 백오프 한 번 — `minDelayMs × 2^시도`(마지막 시도 뒤에도 잔다 · `scripts/test/correction-budget.test.ts` 가 이 식에 기댄다) */
export function backoffMs(minDelayMs: number, attempt: number): number {
  return minDelayMs * 2 ** attempt;
}

/**
 * **시도 하나의 최악(이론 상계)** = H × (연결 + 헤더 + 본문 유휴) + H × 슬롯, H = 1 + `MAX_REDIRECTS`(설계 D3).
 * ⚠상계다 — 리디렉션 홉은 본문을 읽지 않으므로 실제는 이보다 작다. 기본값(3초 간격)이면 4 × 90 + 12 = **372초**.
 */
export function worstAttemptMs(minDelayMs: number, limits: TransportLimits = TRANSPORT_LIMITS): number {
  const hops = 1 + MAX_REDIRECTS;
  return hops * (limits.connectMs + limits.headersMs + limits.bodyMs) + hops * minDelayMs;
}

/** URL 하나의 최악 = (재시도 + 1) × 시도 최악 + 백오프 합. 기본값이면 4 × 372 + 45 = **1,533초**(설계 D3) */
export function worstUrlMs(minDelayMs: number, maxRetries: number, limits: TransportLimits = TRANSPORT_LIMITS): number {
  let backoff = 0;
  for (let a = 0; a <= maxRetries; a += 1) backoff += backoffMs(minDelayMs, a);
  return (maxRetries + 1) * worstAttemptMs(minDelayMs, limits) + backoff;
}

/**
 * `Location` 을 다음 주소로. **못 읽으면 `null`** — 호출자가 3xx 종결(`UpstreamError(http-<3xx>)`)로 끝낸다.
 *
 * ⚠**퍼센트 인코딩 안 한 UTF-8 을 되살린다.** 규약을 어기고 한글·일본어를 날 바이트로 보내는 서버가 있고,
 *   `headers.get` 은 그 바이트를 **latin1 한 글자씩**으로 준다. 그대로 `new URL` 에 넣으면 이중 인코딩된
 *   주소(`/%C3%A6…`)로 가서 404 를 받는다 — 네이티브 `fetch` 가 따라가던 때는 undici 가 같은 복원을 해서
 *   안 나던 실패다(2026-09-26 · C1 수정의 3중 검토 2차 실측).
 * ⚠**형식이 깨진 주소도 `null` 이다** — 던지게 두면 바깥 `catch` 가 일시 오류로 보고 **재시도**한다.
 *   같은 헤더가 또 올 뿐이므로 다른 출처로 보내는 3xx 처럼 **한 번에** 끝낸다.
 */
function resolveLocation(location: string | null, base: string): URL | null {
  if (location === null) return null;
  const raw = /[\x80-\xff]/.test(location) ? Buffer.from(location, "latin1").toString("utf8") : location;
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

export type SleepImpl = (ms: number) => Promise<void>;

export interface PoliteFetcherOptions {
  userAgent: string;
  minDelayMs?: number;
  maxRetries?: number;
  clock: Clock;
  fetchImpl?: FetchImpl;
  sleep?: SleepImpl;
  /**
   * 회로. **안 주면 연속 3 · 합계 6**(설계 D4) — 정정 경로·연 1회 도구도 이 기본값을 공통으로 받는다(설계 D1).
   * 받기 자식 셋은 `BB_NPB_CIRCUIT_N`(재시도 슬롯 1)으로 만든 것을 넘긴다.
   */
  circuit?: HostCircuit;
}

/** 프로세스의 첫 성공 응답 — 헤더까지의 ms(새 연결 + TTFB 의 합 · 연결만 가르지 못한다 · 설계 D3) */
export interface FirstSuccess {
  readonly url: string;
  readonly headersMs: number;
}

/**
 * CLI 합계 줄에 붙이는 한 마디(설계 D3) — 성공한 연결의 시간은 소진 메시지가 없어 못 보므로 **첫 성공 하나만** 적는다.
 * ⚠「accept 지연이다」의 근거가 아니다 — 새 연결과 TTFB 가 합쳐진 값이다(H2 와 정합할 뿐 입증이 아니다).
 */
export function firstSuccessNote(first: FirstSuccess | null): string {
  return first === null ? "첫 성공 응답 없음" : `첫 성공 응답 헤더까지 ${String(Math.round(first.headersMs))}ms(새 연결+TTFB · 연결만 가르지 못한다)`;
}

/** 시도 하나의 결과 — `ok` 는 돌려줄 응답 · `terminal` 은 즉시 실패(재시도 없음) · `retry` 는 재시도 대상 */
type AttemptStep =
  | { readonly type: "ok"; readonly response: FetchResponse; readonly headersMs: number }
  | { readonly type: "terminal"; readonly cause: FetchCause }
  | { readonly type: "retry"; readonly cause: FetchCause; readonly error: unknown };

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

/**
 * 재시도할 상태(일시 오류). ⚠**정정 자동 재수집의 계측(`metered-fetch.ts`)이 「고통 신호」를 가르는 데 이 집합을 그대로 쓴다**(M1 ·
 * 설계 `2026-10-02-correction-auto-refetch-design.md` D7-3) — 두 벌로 두면 「재시도는 했는데 고통 신호는 아니다」가 생긴다.
 */
export const RETRYABLE: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * 따라가는 리디렉션 홉의 상한(2026-09-25 감사 C1).
 * ⚠**상한이 없으면 고리 하나가 요청 폭주가 된다** — 네이티브 `fetch` 는 20홉까지 따라간 뒤 던지고,
 *   그걸 재시도가 되풀이했다(실측: 로컬 고리 서버에 `get` 한 번이 수십 요청).
 */
export const MAX_REDIRECTS = 3;

/**
 * L1 의 하한과 그 술어는 잎 `l1.ts` 한 벌이다(M1) — `scripts/update.ts` 가 받기 자식 사이 간격에 같은 술어를 쓰려고 옮겼다
 * (undici 를 끌지 않는 잎이어야 한다 · 2026-10-24 3중 검토 반영). 여기서는 기존 import 가 그대로 돌게 다시 내보낸다.
 */
export { L1_MIN_DELAY_MS, parseDelayMs } from "./l1.ts";

export class PoliteFetcher {
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private readonly clock: Clock;
  private readonly fetchImpl: FetchImpl;
  private readonly sleep: SleepImpl;
  /** 회로 — 세는 곳은 `getUnqueued` 한 곳이다(설계 D1) */
  readonly circuit: HostCircuit;
  /** 오류 메시지에서 지울 것 — UA 와(그 안의) 연락처(3중 검토 ③ · `redactSecrets`) */
  private readonly secrets: readonly { readonly value: string; readonly label: string }[];
  /** 직전 요청 시각(ms). 동시 1커넥션을 큐로 강제한다 */
  private lastRequestAt: number | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private first: FirstSuccess | null = null;

  constructor(opts: PoliteFetcherOptions) {
    this.userAgent = opts.userAgent;
    const minDelayMs = opts.minDelayMs ?? 3000;
    // ⚠**여기가 예의의 유일한 관문이다**(L1). `new PoliteFetcher` 는 이 저장소에 5곳이고
    //   `scripts/update.ts` 가 자기 `--delay` 를 그중 넷에 그대로 넘긴다 — 호출자마다
    //   검사를 두면 **반드시 하나를 빠뜨리고**, 빠뜨린 그 하나가 간격 없이 나간다.
    //   ⚠**`buildUserAgent` 이 빈 연락처를 거부하는 것과 같은 자리다**(아래).
    if (!isValidDelayMs(minDelayMs)) {
      throw new RangeError(
        `요청 간격(minDelayMs)은 ${L1_MIN_DELAY_MS}ms 이상의 유한한 수여야 한다 (CLAUDE.md L1: 1req/2~5초): ${minDelayMs}`,
      );
    }
    this.minDelayMs = minDelayMs;
    this.maxRetries = opts.maxRetries ?? 3;
    this.clock = opts.clock;
    // ⚠**기본 전송은 홉별 한도를 가진 undici Agent 다**(설계 D3) — 내장 fetch 로 되돌리면 헤더·본문 대기 상한이 300초(미확인)로 돌아간다
    this.fetchImpl = opts.fetchImpl ?? createDefaultFetchImpl();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.circuit = opts.circuit ?? new HostCircuit({ clock: opts.clock });
    const contact = contactOfUserAgent(opts.userAgent);
    this.secrets = [
      { value: opts.userAgent, label: "<User-Agent>" },
      ...(contact === null ? [] : [{ value: contact, label: "<연락처>" }]),
    ];
  }

  /** 이 fetcher 의 첫 성공 응답(없으면 `null`) — CLI 합계 줄이 `firstSuccessNote` 로 적는다 */
  get firstSuccess(): FirstSuccess | null {
    return this.first;
  }

  /**
   * 조건부 GET. 이전 메타가 있으면 If-None-Match / If-Modified-Since를 붙인다.
   * 304면 `body: null`을 돌려준다 — 「변경 없음」과 「빈 본문」은 다르다(M11).
   */
  async get(url: string, prev?: ConditionalHeaders): Promise<FetchResponse> {
    // 동시 1커넥션: 앞선 요청이 끝난 뒤에만 다음이 시작된다.
    const run = this.chain.then(() => this.getUnqueued(url, prev));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * ⚠**`UpstreamError` 를 만들고 회로에 세는 곳은 여기 한 곳이다**(설계 D1) — 재시도 루프 **밖에서** 던진다(루프 안에서 던지면 catch 가 재시도로 삼킨다).
   * ⚠**회로가 열려 있으면 요청 0 으로 끝난다** — 간격 대기도 하지 않는다.
   */
  private async getUnqueued(url: string, prev?: ConditionalHeaders): Promise<FetchResponse> {
    if (this.circuit.isOpen) {
      const s = this.circuit.snapshot();
      const last: FetchCause = {
        kind: "circuit-open",
        code: s.reason ?? "open",
        detail: `연속 ${String(s.consecutive)}(한도 ${String(s.limit)}) · 합계 ${String(s.total)} · 열린 시각 ${s.openedAt ?? "?"}`,
        status: null,
      };
      throw new UpstreamError(upstreamMessage({ mode: "circuit-open", retries: this.maxRetries, url, last, attempts: [] }), {
        kind: "circuit-open",
        url,
        attempts: [],
        status: null,
      });
    }

    const attempts: UpstreamAttempt[] = [];
    let last: FetchCause | null = null;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForSlot();

      const headers: Record<string, string> = { "User-Agent": this.userAgent };
      if (prev?.etag) headers["If-None-Match"] = prev.etag;
      if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

      // ⚠**시도의 경과는 간격 대기 뒤부터 잰다**(설계 D2 「그 시도의 경과」) — 시계는 주입된 것이다(M6)
      const startedAt = this.clock.now().getTime();
      let step: AttemptStep;
      try {
        step = await this.attemptOnce(url, headers, prev, startedAt);
      } catch (err) {
        /**
         * 응답 없는 예외. ⚠⚠**알려진 네트워크 코드(시간 초과 포함)만 상류이고 재시도 대상이다**(설계 D1 ⑶ · 3중 검토 반영).
         * 그 밖(cause 없는 `TypeError` — undici 의 헤더 검증 · 잘못된 URL · 우리 코드의 예외 · 모르는 코드)은 **로컬 오류로 즉시 던진다** —
         * 재시도 0 · 회로 계수 0. 예전에는 전부 「network」로 4번 재시도한 뒤 상류(75)가 되어 우리 고장이 배포를 열었다.
         */
        this.lastRequestAt = this.clock.now().getTime();
        if (!isUpstreamCause(err)) throw this.localError(url, err);
        step = { type: "retry", cause: classifyFetchCause({ error: err }), error: err };
      }
      const ms = this.clock.now().getTime() - startedAt;

      if (step.type === "ok") {
        this.circuit.success();
        this.first ??= { url, headersMs: step.headersMs };
        return step.response;
      }
      // ⚠원인의 한 줄에서 UA·연락처를 지운다(자르기 전에 · `redactSecrets`)
      const cause = this.scrub(step.cause);
      attempts.push({ code: cause.code, ms });
      if (step.type === "terminal") {
        // ⚠**즉시 실패에는 백오프가 없다**(예전 「본문 없는 3xx/4xx 반환」과 같은 요청 수 · L1)
        // ⚠401·403·451 도 여기서 **+1 일 뿐이다** — 즉시 열림은 없앴다(3중 검토 2차 F1 · 한 페이지만의 거절이 형제 받기를 막지 않게)
        this.circuit.failure();
        throw new UpstreamError(upstreamMessage({ mode: "immediate", retries: this.maxRetries, url, last: cause, attempts }), {
          kind: cause.kind,
          url,
          attempts,
          status: cause.status,
        });
      }
      last = cause;
      lastErr = step.error;
      await this.backoff(attempt);
    }

    // 루프가 한 번은 돌았으므로 `last` 는 있다 — 없으면 결함이고 그래도 상류 실패로 끝낸다(막는 쪽은 부르는 쪽 종료 코드가 정한다)
    const cause = last ?? this.scrub(classifyFetchCause({ error: lastErr }));
    this.circuit.failure();
    throw new UpstreamError(
      upstreamMessage({ mode: "exhausted", retries: this.maxRetries, url, last: cause, attempts }),
      { kind: cause.kind, url, attempts, status: cause.status },
      { cause: lastErr },
    );
  }

  /**
   * 시도 하나 — 리디렉션 홉까지. 네트워크·본문 읽기 예외는 **던진다**(부르는 쪽이 재시도로 센다).
   *
   * ⚠**리디렉션은 직접 따라간다**(2026-09-25 감사 C1). 네이티브 `fetch` 에 맡기면 홉이
   * **그 호출 안에서** 일어나 `waitForSlot` 을 안 거친다 — 로컬 302→302→200 에서 세 요청 간격이
   * 26.6ms·4ms 였다(L1 은 2초 이상). → 홉마다 슬롯을 기다리고 그 시각을 남긴다.
   * ⚠**같은 출처(scheme+host+port)만 따라간다.** 다른 곳으로 보내면 따라가지 않고 **3xx 종결**이다 —
   *   `UpstreamError(http-<3xx>)` 를 즉시 던진다(설계 D1 · 예전에는 본문 없는 3xx 를 돌려주고 호출자가 「본문 없는 302 응답」으로 셌다).
   *   예의의 대상과 권리 판정(§2-5)은 우리가 고른 출처에 대한 것이지 상대가 보낸 곳에 대한 것이 아니다.
   *   ⚠어디로 보냈는지를 detail 에 적는다 — 차단 페이지로 보내는 모양(H3)이면 그 출처가 증거다.
   * ⚠**홉 수에 상한이 있다**(`MAX_REDIRECTS`) — 넘으면 역시 3xx 종결. `Location` 이 없거나 못 읽어도 같다(`resolveLocation`).
   */
  private async attemptOnce(url: string, headers: Record<string, string>, prev: ConditionalHeaders | undefined, startedAt: number): Promise<AttemptStep> {
    let res = await this.request(url, headers);
    // 첫 홉의 응답 헤더까지(새 연결 + TTFB) — 첫 성공 한 번만 CLI 가 적는다
    const headersMs = this.clock.now().getTime() - startedAt;

    const origin = new URL(url).origin;
    let current = url;
    for (let hop = 0; REDIRECTS.has(res.status); hop += 1) {
      const location = res.headers.get("location");
      const next = resolveLocation(location, current);
      await discard(res);
      if (next === null || next.origin !== origin || hop >= MAX_REDIRECTS) {
        const why =
          next === null
            ? location === null
              ? "Location 없음"
              : `Location 을 못 읽음 ${location}`
            : next.origin !== origin
              ? `다른 출처로 보냄 ${next.href}`
              : `홉 상한 ${String(MAX_REDIRECTS)} 초과 ${next.href}`;
        return { type: "terminal", cause: classifyFetchCause({ status: res.status, detail: why }) };
      }
      current = next.href;
      await this.waitForSlot();
      res = await this.request(current, headers);
    }
    // 홉을 탔으면 마지막 홉의 주소를 적는다 — 처음 주소와 다르면 그것도 증거다
    const via = current === url ? "" : `(홉) ${current}`;

    if (res.status === 304) {
      await discard(res);
      return { type: "ok", headersMs, response: { status: 304, body: null, etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null } };
    }
    if (res.status === 404 || res.status === 410) {
      // 사실이다 — 이 페이지는 없다. 재시도해도 바뀌지 않는다(회로도 성공으로 센다 · 설계 D1)
      await discard(res);
      return { type: "ok", headersMs, response: { status: res.status, body: null, etag: null, lastModified: null } };
    }
    if (RETRYABLE.has(res.status)) {
      // ⚠**백오프 전에 버린다** — 안 버리면 다음 시도가 이 응답이 열린 채로 나간다(C2)
      await discard(res);
      return { type: "retry", cause: classifyFetchCause({ status: res.status, detail: via }), error: new Error(`HTTP ${String(res.status)} — ${current}`) };
    }
    if (res.status < 200 || res.status >= 300) {
      /**
       * ⚠**그 밖의 비성공은 즉시 실패다**(설계 D1 · 4차-2) — 400·401·403·405·451… 의 4xx · 따라가지 않는 3xx(300 등) · 재시도 집합 밖의 5xx.
       * 예전에는 404 처럼 「사실」로 돌려줬고 호출자가 「본문 없는 403 응답」으로 셌다 — 회로에 안 세는 비성공이 있으면 요청 상한이 안 선다.
       */
      await discard(res);
      return { type: "terminal", cause: classifyFetchCause({ status: res.status, detail: via }) };
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch (err) {
      /**
       * ⚠**응답(상태 2xx)은 왔다 — 본문을 받는 중의 실패는 상류다**(설계 D1 ⑶ 「HTTP 응답이 있었다」) · 재시도 대상.
       * undici 는 `TypeError("terminated", { cause })` 로, 정정 경로의 시간 상한은 `DOMException` 으로 온다 — 어느 쪽이든 상대가 말을 하다 끊겼다.
       */
      this.lastRequestAt = this.clock.now().getTime();
      return { type: "retry", cause: classifyFetchCause({ error: err }), error: err };
    }
    return {
      type: "ok",
      headersMs,
      response: {
        status: res.status,
        body: new Uint8Array(bytes),
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      },
    };
  }

  /** 원인의 한 줄에서 UA·연락처를 지운다 */
  private scrub(cause: FetchCause): FetchCause {
    const detail = redactSecrets(cause.detail, this.secrets);
    return detail === cause.detail ? cause : { ...cause, detail };
  }

  /**
   * 로컬 오류 하나 — **원인(`cause`)을 붙이지 않는다**: 헤더 검증 오류의 메시지는 UA(= 연락처)를 품고, 붙여 두면 누가 `util.inspect` 로
   * 찍는 순간 그대로 나간다. 코드와(지운) 한 줄은 메시지에 있다.
   */
  private localError(url: string, err: unknown): FetchLocalError {
    const { code, detail } = describeCause(err);
    return new FetchLocalError(localFetchMessage({ url, code, detail: redactSecrets(detail, this.secrets) }), url);
  }

  /** 요청 한 번. ⚠리디렉션은 넘겨받지 않는다(`manual`) — 호출자가 홉마다 슬롯을 기다린다 */
  private async request(url: string, headers: Record<string, string>): Promise<RawResponse> {
    const res = await this.fetchImpl(url, { headers, redirect: "manual" });
    this.lastRequestAt = this.clock.now().getTime();
    return res;
  }

  private async waitForSlot(): Promise<void> {
    if (this.lastRequestAt === null) return;
    const elapsed = this.clock.now().getTime() - this.lastRequestAt;
    if (elapsed < this.minDelayMs) await this.sleep(this.minDelayMs - elapsed);
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(backoffMs(this.minDelayMs, attempt));
  }
}

/**
 * **닿지 않는 도메인** — RFC 2606(예약 TLD·2단계) · RFC 6761(특수 용도).
 *
 * ⚠**여기 있는 것은 「가짜처럼 보이는 것」이 아니라 「표준이 영구히 예약해서 아무에게도
 * 닿지 않는 것」이다.** 그래서 `myexample.com` 이나 `example-team.jp` 같은 실도메인은
 * 걸리지 않는다 — 부분 문자열이 아니라 **도메인 경계로** 맞춘다.
 */
const UNREACHABLE_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "example",
  "test",
  "invalid",
  "localhost",
] as const;

/**
 * 연락처에서 **호스트**를 꺼낸다. 꺼낼 수 없으면 빈 문자열.
 *
 * 두 모양을 받는다: URL(`https://호스트/…`)과 메일주소(`이름@호스트`).
 * ⚠**꺼내지 못하면 판정하지 않는다**(빈 문자열 → 통과). 모양을 모르는 연락처를 거부하면
 * **CI 시크릿(`BB_ARCHIVER_CONTACT`)의 모양을 우리가 못 보는 채로 매일 배치를 깨뜨린다** —
 * 여기서 막으려는 것은 「모양이 낯선 것」이 아니라 **「닿지 않는 것이 확실한 것」**이다(M11).
 */
function contactHost(contact: string): string {
  const url = /^https?:\/\/([^/?#\s]+)/i.exec(contact);
  if (url) return (url[1] ?? "").toLowerCase().replace(/^.*@/, "").replace(/:\d+$/, "");
  const at = contact.lastIndexOf("@");
  if (at === -1) return "";
  return contact
    .slice(at + 1)
    .toLowerCase()
    .replace(/[>)\]\s.]+$/, "");
}

/**
 * 연락처를 포함한 UA를 만든다.
 *
 * ⚠연락처 없는 UA로 긁지 마라 — 상대가 문제를 알릴 방법이 없으면 차단이 유일한 수단이 된다.
 *
 * ⚠**닿지 않는 연락처는 빈 연락처와 같다**(2026-09-06 추가). L1 이 연락처를 요구하는 이유는
 * 문자열을 채우는 것이 아니라 **「상대가 문제를 알릴 방법」**이고, `example.com` 은 RFC 2606 이
 * **영구 예약**해서 어디에도 닿지 않는다. **빈 문자열과 실질이 같은데 옛 검사는 통과시켰다.**
 *
 * ⚠**이건 2026-09-05 L1 사고의 나머지 절반이다.** 그 사고는 **간격(0.583초)**과
 * **연락처(`me@example.com`)** 두 겹이었는데 **간격만 막혀 있었다.**
 * ⚠**이 검사가 그때 있었으면 사고가 아예 안 났다** — 진입점은 이 함수를 **fetcher 를 만들기
 * 전에** 부르므로, 여기서 던졌으면 **222요청이 0요청이었다.** 간격 하한(`isValidDelayMs`)과
 * **독립적인 두 번째 걸쇠**이고, 둘 중 하나만 있어도 그날의 요청은 안 나갔다.
 */
export function buildUserAgent(contact: string): string {
  const trimmed = contact.trim();
  if (!trimmed) throw new Error("연락처 없는 User-Agent는 허용하지 않는다 (CLAUDE.md L1)");

  /**
   * ⚠⚠**헤더에 쓸 수 없는 문자를 막는다**(2026-10-24 · 3중 검토 ③) — 제어 문자(CR·LF·TAB 등 C0 · DEL · C1)와 ByteString 밖(0xFF 초과).
   * 예전에는 통과시켰고, 내부 CR/LF 는 undici 의 헤더 검증에서 `TypeError` 가 되어 **「네트워크」로 4번 재시도한 뒤 75(배포)** 가 됐다 —
   * 그 오류 메시지가 UA(= 연락처)를 그대로 로그에 실었다. ⚠**거부 메시지에 연락처를 싣지 않는다**(위치만) — 줄바꿈이 든 값을 로그에 되찍지 않는다.
   * ⚠예약 도메인 검사보다 **먼저** 본다 — 그쪽 메시지는 연락처를 되찍는다.
   */
  const bad = unwritableCharAt(trimmed);
  if (bad !== -1) {
    throw new Error(
      `연락처에 User-Agent 에 쓸 수 없는 문자가 있다(제어 문자 또는 latin1 밖 · ${String(bad + 1)}번째 글자) — 연락처는 로그에 남기지 않는다 (CLAUDE.md L1)`,
    );
  }

  // ⚠**호스트를 꺼내서 도메인 경계로 맞춘다.** 부분 문자열로 보면 `myexample.com` 같은
  //   **실도메인을 오탐**하고, 문자열 끝만 보면 **URL 연락처를 놓친다**
  //   (`https://example.com/issues` — 초판이 실제로 통과시켰다).
  const host = contactHost(trimmed);
  if (host !== "" && UNREACHABLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new Error(
      `닿지 않는 연락처는 연락처가 아니다 — 예약 도메인(RFC 2606/6761)이다 (CLAUDE.md L1): ${trimmed}`,
    );
  }
  return `${UA_HEAD}${trimmed}${UA_TAIL}`;
}

/** UA 의 모양 — `buildUserAgent` 가 만들고 `contactOfUserAgent` 가 거꾸로 읽는다(한 곳 · M1) */
const UA_HEAD = "bb-app-archiver/0.1 (personal, non-commercial; ";
const UA_TAIL = ")";

/** 헤더 값으로 못 쓰는 첫 글자의 위치(없으면 -1) — C0 제어 문자 · DEL · C1 제어 문자 · 0xFF 초과(서로게이트 포함) */
function unwritableCharAt(s: string): number {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c > 0xff) return i;
  }
  return -1;
}

/** `buildUserAgent` 가 만든 UA 에서 연락처를 꺼낸다(모양이 다르면 `null`) — 오류 메시지에서 지우려고만 쓴다 */
function contactOfUserAgent(ua: string): string | null {
  if (!ua.startsWith(UA_HEAD) || !ua.endsWith(UA_TAIL) || ua.length <= UA_HEAD.length + UA_TAIL.length) return null;
  return ua.slice(UA_HEAD.length, ua.length - UA_TAIL.length);
}
