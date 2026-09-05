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
 */
import type { Clock } from "./clock.ts";

export interface FetchResponse {
  status: number;
  body: Uint8Array | null;
  etag: string | null;
  lastModified: string | null;
}

/** 테스트에서 갈아끼우기 위한 최소 인터페이스. */
export type FetchImpl = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type SleepImpl = (ms: number) => Promise<void>;

export interface PoliteFetcherOptions {
  userAgent: string;
  minDelayMs?: number;
  maxRetries?: number;
  clock: Clock;
  fetchImpl?: FetchImpl;
  sleep?: SleepImpl;
}

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * L1 의 하한 — 「1req / 2~5초」의 아래쪽. **이 아래로는 만들 수 없다.**
 *
 * ⚠**초판은 이것을 「경고에만 쓴다」고 적었고 그 근거가 틀렸다**(2026-09-05 정정).
 * 근거는 「픽스처 시험이 `minDelayMs: 0` 을 쓴다」였는데, **실측하니 그 시험은 값이 몇이든
 * 결과가 같다** — `sleep` 을 즉시 반환하는 목으로 주입하기 때문이다(`mark-seen.test.ts` 의
 * `0` 을 `999999` 로 바꿔도 4본이 그대로 통과한다). **시험을 빠르게 만드는 것은 `sleep` 목이지
 * 작은 `minDelayMs` 가 아니었다.** 실제로 요청을 보내는 시험 13곳이 **전부** `fetchImpl` 과
 * `sleep` 을 함께 주입한다 — **예외를 둘 이유가 애초에 없었다.**
 */
export const L1_MIN_DELAY_MS = 2000;

/**
 * 유효한 요청 간격인가. ⚠**생성자와 진입점이 같은 술어를 쓴다**(M1) —
 * 두 벌로 두면 한쪽만 고쳐진 채로 남고, 그 한쪽이 실제로 나가는 요청을 정한다.
 *
 * ⚠**`NaN` 만 막는 것으로는 부족했다.** `500` 은 수이고 음수도 아니라 통과했고, 진입점은
 * **경고 한 줄만 찍고 그대로 실사이트를 쳤다.** 오타로 인한 조용한 위반과 **결이 다를 뿐
 * 정도만 다른 같은 범주의 구멍**이다.
 * ⚠**이걸 「실측」으로 배웠다**: 이 하한을 넣기 전에 `--delay 500` 을 스폰하는 시험을 쓰자
 * **222페이지를 0.583초 간격으로 실제로 받아 버렸다**(우리 사이드카의 `fetchedAt` 실측).
 *
 * ⚠**「시험이면 봐 준다」를 만들지 않았다.** `fetchImpl` 주입 여부로 가르는 안이 있었는데,
 * 그러면 **예의의 보장이 「전송 수단을 갈아 끼웠는가」에 딸려 간다** — 제품 코드가 계측이나
 * 프록시로 `fetchImpl` 을 감싸는 순간 하한이 조용히 사라진다. **방금 고친 결함의 잠복형이다.**
 * → **예외 없는 한 줄 규칙**이고 우회할 것이 없다.
 * ⚠**`PoliteFetcher` 가 무례하게 설정될 수 있으면 이름이 거짓이다.**
 */
function isValidDelayMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= L1_MIN_DELAY_MS;
}

/**
 * 진입점의 `--delay` 문자열을 간격으로. **못 읽으면 `null`.**
 *
 * ⚠**`Number()` 를 그대로 쓰지 마라** — `Number("abc")` 는 `NaN` 인데 **`NaN` 은 nullish 가
 * 아니라서** `minDelayMs ?? 3000` 을 통과하고, `elapsed < NaN` 이 항상 false 라 **간격이
 * 0이 된다.** 던지지도 로그를 남기지도 않는다(실측: 연속 3요청에 sleep 0회).
 * ⚠**「안 줬다」와 「못 읽었다」를 여기서 구별하지 않는다** — 둘 다 `null` 이고,
 * 기본값을 고르는 것은 진입점의 일이다(`parseArgs` 의 `default`).
 */
export function parseDelayMs(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const ms = Number(raw);
  return isValidDelayMs(ms) ? ms : null;
}

export class PoliteFetcher {
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private readonly clock: Clock;
  private readonly fetchImpl: FetchImpl;
  private readonly sleep: SleepImpl;
  /** 직전 요청 시각(ms). 동시 1커넥션을 큐로 강제한다 */
  private lastRequestAt: number | null = null;
  private chain: Promise<unknown> = Promise.resolve();

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
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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

  private async getUnqueued(url: string, prev?: ConditionalHeaders): Promise<FetchResponse> {
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForSlot();

      const headers: Record<string, string> = { "User-Agent": this.userAgent };
      if (prev?.etag) headers["If-None-Match"] = prev.etag;
      if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

      try {
        const res = await this.fetchImpl(url, { headers });
        this.lastRequestAt = this.clock.now().getTime();

        if (res.status === 304) {
          return { status: 304, body: null, etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null };
        }
        if (res.status >= 400 && !RETRYABLE.has(res.status)) {
          // 404 등은 사실이다. 재시도해도 바뀌지 않는다.
          return { status: res.status, body: null, etag: null, lastModified: null };
        }
        if (res.status >= 400) {
          lastErr = new Error(`HTTP ${res.status} — ${url}`);
          await this.backoff(attempt);
          continue;
        }

        return {
          status: res.status,
          body: new Uint8Array(await res.arrayBuffer()),
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
        };
      } catch (err) {
        this.lastRequestAt = this.clock.now().getTime();
        lastErr = err;
        await this.backoff(attempt);
      }
    }

    throw new Error(`취득 실패 (재시도 ${this.maxRetries}회 소진): ${url}`, { cause: lastErr });
  }

  private async waitForSlot(): Promise<void> {
    if (this.lastRequestAt === null) return;
    const elapsed = this.clock.now().getTime() - this.lastRequestAt;
    if (elapsed < this.minDelayMs) await this.sleep(this.minDelayMs - elapsed);
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(this.minDelayMs * 2 ** attempt);
  }
}

/**
 * 연락처를 포함한 UA를 만든다.
 * ⚠연락처 없는 UA로 긁지 마라 — 상대가 문제를 알릴 방법이 없으면 차단이 유일한 수단이 된다.
 */
export function buildUserAgent(contact: string): string {
  if (!contact.trim()) throw new Error("연락처 없는 User-Agent는 허용하지 않는다 (CLAUDE.md L1)");
  return `bb-app-archiver/0.1 (personal, non-commercial; ${contact})`;
}
