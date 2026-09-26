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
 * 따라가는 리디렉션 홉의 상한(2026-09-25 감사 C1).
 * ⚠**상한이 없으면 고리 하나가 요청 폭주가 된다** — 네이티브 `fetch` 는 20홉까지 따라간 뒤 던지고,
 *   그걸 재시도가 되풀이했다(실측: 로컬 고리 서버에 `get` 한 번이 수십 요청).
 */
export const MAX_REDIRECTS = 3;

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
        let res = await this.request(url, headers);

        /**
         * ⚠**리디렉션은 직접 따라간다**(2026-09-25 감사 C1). 네이티브 `fetch` 에 맡기면 홉이
         * **그 호출 안에서** 일어나 `waitForSlot` 을 안 거친다 — 로컬 302→302→200 에서 세 요청 간격이
         * 26.6ms·4ms 였다(L1 은 2초 이상). → 홉마다 슬롯을 기다리고 그 시각을 남긴다.
         * ⚠**같은 출처(scheme+host+port)만 따라간다.** 다른 곳으로 보내면 따라가지 않고 **본문 없는 3xx** 를
         *   돌려준다 — 호출자(`archiveUrl`)가 「본문 없는 302 응답」 실패로 센다(조용히 넘기지 않는다).
         *   예의의 대상과 권리 판정(§2-5)은 우리가 고른 출처에 대한 것이지 상대가 보낸 곳에 대한 것이 아니다.
         * ⚠**홉 수에 상한이 있다**(`MAX_REDIRECTS`) — 넘으면 역시 본문 없는 3xx.
         */
        const origin = new URL(url).origin;
        let current = url;
        for (let hop = 0; REDIRECTS.has(res.status); hop += 1) {
          const location = res.headers.get("location");
          await discard(res);
          const next = location === null ? null : new URL(location, current);
          if (next === null || next.origin !== origin || hop >= MAX_REDIRECTS) {
            return { status: res.status, body: null, etag: null, lastModified: null };
          }
          current = next.href;
          await this.waitForSlot();
          res = await this.request(current, headers);
        }

        if (res.status === 304) {
          await discard(res);
          return { status: 304, body: null, etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null };
        }
        if (res.status >= 400 && !RETRYABLE.has(res.status)) {
          // 404 등은 사실이다. 재시도해도 바뀌지 않는다.
          await discard(res);
          return { status: res.status, body: null, etag: null, lastModified: null };
        }
        if (res.status >= 400) {
          // ⚠**백오프 전에 버린다** — 안 버리면 다음 시도가 이 응답이 열린 채로 나간다(C2)
          await discard(res);
          lastErr = new Error(`HTTP ${res.status} — ${current}`);
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
    await this.sleep(this.minDelayMs * 2 ** attempt);
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

  // ⚠**호스트를 꺼내서 도메인 경계로 맞춘다.** 부분 문자열로 보면 `myexample.com` 같은
  //   **실도메인을 오탐**하고, 문자열 끝만 보면 **URL 연락처를 놓친다**
  //   (`https://example.com/issues` — 초판이 실제로 통과시켰다).
  const host = contactHost(trimmed);
  if (host !== "" && UNREACHABLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new Error(
      `닿지 않는 연락처는 연락처가 아니다 — 예약 도메인(RFC 2606/6761)이다 (CLAUDE.md L1): ${trimmed}`,
    );
  }
  return `bb-app-archiver/0.1 (personal, non-commercial; ${trimmed})`;
}
