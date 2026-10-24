/**
 * **호스트 회로 차단** — 상류가 아플 때 요청을 멈춘다(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · L1 · M8).
 *
 * ⚠**왜 있는가**: 2026-10-21 장애 중에도 평소 경로는 하루 약 250~340시도를 보냈다 — 회로가 정정 경로(`refetch-games.ts`)에만 있었다.
 *   실행 하나(`40044974431`)가 14 URL × 4시도 = 56시도를 22분 동안 두드렸다.
 * ⚠**상태 파일이 없다 — 프로세스 안에서만 센다.** 프로세스 사이는 부모(`scripts/collect-steps.ts`)가 자식의 종료 코드로 잇는다:
 *   회로가 **열린 채** 끝난 자식(69 · 70)이 있으면 그 뒤 받기 자식을 띄우지 않고, 실패가 있었지만 **닫힌 채** 끝난 자식(75 · 1) 뒤의 받기 자식은
 *   연속 한도 1 로 띄운다. 그래서 한 실행의 소진(`UpstreamError` 로 끝난 `get()`) ≤ 6 이다(설계 D4-3 · 2026-10-24 3중 검토 반영).
 * ⚠**세는 곳은 fetcher 한 곳이다**(`PoliteFetcher.getUnqueued`) — 404·410 을 뺀 모든 비성공이 연속 +1 · 합계 +1 이다(4차-2).
 *   성공(404·410 포함)은 **연속만** 리셋한다. ⚠**401·403·451 도 +1 일 뿐이다** — 「한 번에 열림」은 없앴다(3중 검토 2차 F1):
 *   한 페이지만의 거절(자원 단위)이 형제 받기를 막았다. 의도적 차단이면 모든 페이지가 같은 응답이라 연속 3(재시도 슬롯 1)에서 곧 열린다.
 * ⚠**로컬 오류(`FetchLocalError`)는 세지 않는다** — 상대 탓이 아니다(설계 D1 ⑶).
 * ⚠**한 번 열리면 프로세스가 끝날 때까지 닫히지 않는다** — 반쯤 열기(시간이 지나면 다시 시도)는 없다. 다음 실행이 다시 연다.
 */
import type { Clock } from "./clock.ts";

/** 연속 소진 한도의 기본값 — 정시·수동 실행. 재시도 슬롯은 워크플로가 1 을 준다(`BB_NPB_CIRCUIT_N`) */
export const CIRCUIT_CONSECUTIVE_DEFAULT = 3;
/** 합계 소진 한도 — 간헐 장애(소진과 성공이 번갈아)에도 요청 수의 상한이 서게 한다 */
export const CIRCUIT_TOTAL_LIMIT = 6;
/** 연속 한도를 주는 env — 받기 자식 셋만 읽는다(정정 경로·연 1회 도구는 기본값) */
export const CIRCUIT_ENV = "BB_NPB_CIRCUIT_N";

/**
 * `BB_NPB_CIRCUIT_N` → 연속 한도. **안 줬으면 3 · `1`~`6` 의 정수 글자만 · 그 밖은 `null`**(호출자가 요청 0 으로 종료 2).
 * ⚠빈 문자열·공백·앞자리 0·지수 표기를 받지 않는다 — 워크플로는 언제나 `1` 또는 `3` 을 준다. 모르는 값을 기본값으로 메우지 않는다(M11).
 */
export function parseCircuitN(raw: string | undefined): number | null {
  if (raw === undefined) return CIRCUIT_CONSECUTIVE_DEFAULT;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return n <= CIRCUIT_TOTAL_LIMIT ? n : null;
}

/** 열린 계기 */
export type CircuitOpenReason = "consecutive" | "total";

export interface CircuitSnapshot {
  readonly consecutive: number;
  readonly total: number;
  /** 연속 한도 */
  readonly limit: number;
  readonly open: boolean;
  /** 열린 시각(주입된 시계 · UTC ISO) — 닫혀 있으면 `null` */
  readonly openedAt: string | null;
  readonly reason: CircuitOpenReason | null;
}

export class HostCircuit {
  readonly limit: number;
  private readonly clock: Clock;
  private consecutive = 0;
  private total = 0;
  private openedAt: string | null = null;
  private reason: CircuitOpenReason | null = null;

  constructor(opts: { readonly clock: Clock; readonly consecutive?: number }) {
    const n = opts.consecutive ?? CIRCUIT_CONSECUTIVE_DEFAULT;
    if (!Number.isInteger(n) || n < 1 || n > CIRCUIT_TOTAL_LIMIT) {
      throw new RangeError(`연속 한도는 1~${String(CIRCUIT_TOTAL_LIMIT)} 의 정수여야 한다: ${String(n)}`);
    }
    this.limit = n;
    this.clock = opts.clock;
  }

  get isOpen(): boolean {
    return this.openedAt !== null;
  }

  snapshot(): CircuitSnapshot {
    return {
      consecutive: this.consecutive,
      total: this.total,
      limit: this.limit,
      open: this.isOpen,
      openedAt: this.openedAt,
      reason: this.reason,
    };
  }

  /** 성공(2xx · 304 · 404 · 410) — **연속만** 리셋한다. 합계는 그대로다 */
  success(): void {
    this.consecutive = 0;
  }

  /** 비성공 하나(`UpstreamError` 로 끝난 `get()`) — 상태가 무엇이든(401·403·451 포함) 연속 +1 · 합계 +1 이다 */
  failure(): void {
    this.consecutive += 1;
    this.total += 1;
    if (this.isOpen) return;
    if (this.consecutive >= this.limit) this.open("consecutive");
    else if (this.total >= CIRCUIT_TOTAL_LIMIT) this.open("total");
  }

  private open(reason: CircuitOpenReason): void {
    this.openedAt = this.clock.now().toISOString();
    this.reason = reason;
  }
}
