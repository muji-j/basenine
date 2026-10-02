/**
 * 전송 계측 · 전송 시간 상한 · 고통 신호 — 정정 자동 재수집 전용(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7-3).
 *
 * `PoliteFetcher` 에 넘기는 `fetchImpl` 을 감싼다. ⚠**`PoliteFetcher` 는 고치지 않는다** — 첫 전송 · 리디렉트 홉 · 재시도가
 * **전부** `request()` → `fetchImpl` 을 지나므로(`fetcher.ts`) 감싼 쪽이 전송을 빠짐없이 센다.
 * ⚠**간격 하한(L1)은 이 감싸기와 무관하게 걸린다** — `PoliteFetcher` 생성자가 `minDelayMs` 를 검사하고, 간격 대기는 `fetchImpl`
 *   바깥(`waitForSlot`)에 있다. 「전송 수단을 갈아 끼우면 하한이 사라진다」를 만들지 않았다(`fetcher.ts` 의 `isValidDelayMs`).
 *
 * 왜 두나:
 * - **논리 페이지와 실제 HTTP 전송은 다르다**(설계 R2-1). 재시도·리디렉트로 한 페이지가 여러 전송이 된다 — 상한은 **전송**으로 건다.
 * - **전송 시간 상한이 평소 fetcher 에는 없다**(설계 M-R) — 없으면 한 경기의 최악을 셀 수 없다.
 * - **고통 신호**: 재시도 대상 응답이나 전송 예외가 **한 번이라도** 나면 상대가 아프다는 뜻이다 — 그 페이지가 결국 성공했어도.
 *   받기 핵심(`refetch-games.ts`)이 그 신호로 회로를 연다(L1).
 */
import type { FetchImpl } from "./fetcher.ts";
import { RETRYABLE } from "./fetcher.ts";

/**
 * 한 실행의 전송 계측. **한 실행에 하나**를 만들어 fetcher 와 받기 핵심이 같이 본다.
 * - `http` — `fetchImpl` 호출 수(= 실제 HTTP 전송 수 · 예외로 끝난 전송도 센다)
 * - `distress` — 재시도 대상 응답 · 전송 예외 · 본문 읽기 실패가 한 번이라도 있었는가
 * - `byStatus` — 응답 상태별 횟수. 응답 없이 예외로 끝난 전송은 `exception` 에 센다 — **합이 `http` 와 같다**(분모)
 */
export interface FetchMeter {
  http: number;
  distress: boolean;
  byStatus: Record<string, number>;
}

export function newFetchMeter(): FetchMeter {
  return { http: 0, distress: false, byStatus: {} };
}

/** 전송 하나의 시간 상한 신호를 만든다. 기본은 `AbortSignal.timeout` — 시험이 주입한다 */
export type TimeoutSignalImpl = (ms: number) => AbortSignal;

/** 감싸는 안쪽 fetch — `FetchImpl` 과 같고 `signal` 을 **반드시** 받는다(네이티브 `fetch` 가 이 모양을 받는다) */
export type TimedFetchImpl = (url: string, init: Parameters<FetchImpl>[1] & { signal: AbortSignal }) => ReturnType<FetchImpl>;

export interface MeteredFetchOptions {
  timeoutMs: number;
  timeoutSignal?: TimeoutSignalImpl;
}

function count(meter: FetchMeter, bucket: string): void {
  meter.byStatus[bucket] = (meter.byStatus[bucket] ?? 0) + 1;
}

/**
 * `inner` 를 감싸 전송마다 센다 — 호출마다 `meter.http += 1` 한 뒤 **새** 시간 상한 신호를 붙여 부른다.
 * ⚠신호를 전송마다 새로 만든다 — 하나를 돌려 쓰면 둘째 전송부터 남은 시간이 줄어든다.
 * ⚠**본문 읽기도 감싼다** — 같은 신호가 본문 읽기까지 덮으므로(네이티브 `fetch`) 헤더 뒤에 시간이 다 되면 `arrayBuffer()` 가
 *   던진다. 그 예외는 `inner` 호출 밖에서 나므로 감싸지 않으면 **재시도는 일어났는데 고통 신호는 없는** 상태가 된다.
 *   본문 읽기 실패는 새 전송이 아니므로 `byStatus` 에는 더하지 않는다(응답 상태로 이미 셌다).
 */
export function meteredFetch(inner: TimedFetchImpl, meter: FetchMeter, opts: MeteredFetchOptions): FetchImpl {
  const signalFor = opts.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  return async (url, init) => {
    meter.http += 1;
    let res: Awaited<ReturnType<FetchImpl>>;
    try {
      res = await inner(url, { ...init, signal: signalFor(opts.timeoutMs) });
    } catch (err) {
      // 시간 초과·연결 오류 — PoliteFetcher 가 재시도 대상으로 본다. 고통 신호다
      meter.distress = true;
      count(meter, "exception");
      throw err;
    }
    count(meter, String(res.status));
    if (RETRYABLE.has(res.status)) meter.distress = true;
    const read = res;
    return {
      status: read.status,
      headers: read.headers,
      ...(read.body !== undefined ? { body: read.body } : {}),
      arrayBuffer: async () => {
        try {
          return await read.arrayBuffer();
        } catch (err) {
          meter.distress = true;
          throw err;
        }
      },
    };
  };
}
