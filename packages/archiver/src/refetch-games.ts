/**
 * 정정 자동 재수집의 받기 핵심 — 고른 경기만 다시 받는다(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7).
 *
 * 평소 수집(`archiveDates` · `cli.ts`)과 다른 것은 셋뿐이고 **전부 이 파일과 자동 경로의 조립(`createRefetchFetcher`)에만 있다**:
 * 1. **경기 사이에서 멈춘다**(D7-4) — 경기를 시작하기 전마다 ① 회로 ② 마감 ③ HTTP 예산을 이 차례로 묻는다.
 * 2. **경기마다 사본을 뜨고, 기록이 반쯤 실패하면 되돌린다**(D7-5) — 자동 경로는 섞인 세트를 남기지 않는다.
 * 3. **`maxRetries` 1 · 전송 시간 상한 · 전송 계측**(D7-3) — `createRefetchFetcher` 가 조립한다.
 * ⚠**평소 경로는 바뀌지 않는다** — `archiveGame` 을 그대로 부르고, `PoliteFetcher` 의 기본값도 그대로다.
 * ⚠**월간 일정을 받지 않는다** — 경기 ID 가 곧 주소다(`gameRefFromId`).
 */
import { AUTO_REFETCH_MAX_GAMES, AUTO_REFETCH_MAX_RETRIES, AUTO_REFETCH_REQUEST_TIMEOUT_MS } from "@bb-app/store/refetch-limit";
import { archiveGame, summarize } from "./archive.ts";
import type { PageResult } from "./archive.ts";
import type { Clock } from "./clock.ts";
import { GAME_PAGES, gameIdOf, pageKey } from "./discover.ts";
import type { GameRef } from "./discover.ts";
import { MAX_REDIRECTS, PoliteFetcher } from "./fetcher.ts";
import type { SleepImpl } from "./fetcher.ts";
import { meteredFetch } from "./metered-fetch.ts";
import type { FetchMeter, TimedFetchImpl, TimeoutSignalImpl } from "./metered-fetch.ts";
import { sameSnapshot } from "./sink.ts";
import type { PageSnapshot, RestorableSink } from "./sink.ts";

/**
 * **한 경기 최악 전송** = 4장 × (`AUTO_REFETCH_MAX_RETRIES` + 1) × (1 + `MAX_REDIRECTS`) = 4 × 2 × 4 = **32**(설계 D7-4).
 * ⚠상수를 따로 적지 않고 이 식으로 낸다 — 재시도·홉 상한이 바뀌면 예산 검사가 같이 바뀐다(`scripts/test/correction-budget.test.ts` 가 대조한다).
 * ⚠경기 하나 안에서는 멈추지 않으므로(네 장을 한 단위로 받는다) 시작 전에 이만큼의 여유가 있어야 시작한다.
 */
export const WORST_HTTP_PER_GAME = GAME_PAGES.length * (AUTO_REFETCH_MAX_RETRIES + 1) * (1 + MAX_REDIRECTS);

export interface RefetchFetcherOptions {
  userAgent: string;
  minDelayMs: number;
  clock: Clock;
  meter: FetchMeter;
  fetchImpl: TimedFetchImpl;
  sleep?: SleepImpl;
  timeoutSignal?: TimeoutSignalImpl;
}

/**
 * 자동 경로의 fetcher — **CLI 와 시험이 같은 조립을 지난다**(그래서 `maxRetries`·시간 상한·계측의 배선을 시험이 잰다).
 * ⚠간격은 그대로 `PoliteFetcher` 가 검사한다 — L1 하한(2000ms) 미만이면 생성자가 던진다. 여기서 우회하지 않는다.
 */
export function createRefetchFetcher(o: RefetchFetcherOptions): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: o.userAgent,
    minDelayMs: o.minDelayMs,
    maxRetries: AUTO_REFETCH_MAX_RETRIES,
    clock: o.clock,
    fetchImpl: meteredFetch(o.fetchImpl, o.meter, {
      timeoutMs: AUTO_REFETCH_REQUEST_TIMEOUT_MS,
      ...(o.timeoutSignal !== undefined ? { timeoutSignal: o.timeoutSignal } : {}),
    }),
    ...(o.sleep !== undefined ? { sleep: o.sleep } : {}),
  });
}

export interface RefetchDeps {
  /**
   * ⚠**`createRefetchFetcher` 로 만든 것**이어야 한다 — `maxRetries`(`AUTO_REFETCH_MAX_RETRIES`)·전송 시간 상한·계측이
   *   예산 검사(`WORST_HTTP_PER_GAME`)와 회로(고통 신호)의 전제다. 평소 fetcher(`maxRetries` 3)를 넘기면 한 경기가 32전송을 넘을 수 있다.
   */
  fetcher: PoliteFetcher;
  sink: RestorableSink;
  clock: Clock;
  /** ⚠`fetcher` 가 쓰는 계측과 **같은 객체**여야 한다(`createRefetchFetcher` 에 넘긴 것) — 아니면 예산·회로가 0을 본다 */
  meter: FetchMeter;
}

/** 경기별 결과 한 줄을 받는다 — `pages` 는 그 경기의 페이지 결과(실패한 주소와 사유 · 로그용), `notes` 는 사본·되돌리기 오류 */
export type RefetchGameListener = (game: RefetchGame, detail: { pages: readonly PageResult[]; notes: readonly string[] }) => void;

export interface RefetchOptions {
  /** 이 시각(UTC 밀리초)과 **같거나 지나면** 새 경기를 시작하지 않는다(`now >= deadline` · 설계 D6 의 8 과 같은 식) */
  deadlineMs: number;
  /** 한 실행의 실제 HTTP 전송 상한 — 시작 전에 `http + WORST_HTTP_PER_GAME > maxHttp` 이면 멈춘다 */
  maxHttp: number;
  onGame?: RefetchGameListener;
}

/** `recorded`(네 장 기록) · `prepare_failed`(아무것도 안 바뀜 = G3a 상태) · `commit_failed`(기록이 반쯤 · 되돌림) · `skipped`(시작 안 함) */
export type RefetchGameStatus = "recorded" | "prepare_failed" | "commit_failed" | "skipped";
/** 시작하지 않은 사유. `snapshot_failed` 만 그 경기 자신의 실패이고(종료 1) 나머지는 멈춤이다 */
export type RefetchSkipReason = "circuit_open" | "deadline" | "http_budget" | "snapshot_failed";
/** `commit_failed` 에서만 값이 있다 — 다시 떠서 사전과 **바이트로 같으면** `ok` */
export type RefetchRollback = "ok" | "failed" | null;

/** 결과 JSON 의 경기 한 줄(설계 D7-6 · 키 이름이 곧 계약이다) */
export interface RefetchGame {
  id: string;
  date: string;
  status: RefetchGameStatus;
  reason: RefetchSkipReason | null;
  pages: { stored: number; unchanged: number; absent: number; failed: number; held: number };
  /** 논리 페이지 = `prepareUrl` 호출 수 — 시작한 경기는 늘 4(`archiveGame` 은 받기 단계에서 네 장을 다 받는다) · 시작 안 한 경기는 0 */
  page_fetches: number;
  /** 그 경기 동안 늘어난 `meter.http`(실제 HTTP 전송) */
  http_attempts: number;
  rollback: RefetchRollback;
  /** 경기 전 box 사이드카의 `sha256`. 없으면 `null`. ⚠시작 안 한 경기는 **안 쟀다**는 뜻의 `null` 이다 */
  box_sha_before: string | null;
  /** 처리 뒤 box 사이드카의 `sha256` — 다시 받아 box 내용이 바뀌었는지(정정을 받았는지)를 말한다 */
  box_sha_after: string | null;
}

/** 결과 JSON(설계 D7-6) 중 받기 핵심이 내는 부분 — CLI 가 `schema` · `deadline` 을 앞에 붙인다 */
export interface RefetchResult {
  page_fetches: number;
  /** 계측(`meter.http`)의 합 — 한 실행에 계측 하나라 곧 그 실행의 실제 HTTP 전송 수다 */
  http_attempts: number;
  by_status: Record<string, number>;
  distress: boolean;
  /** **처음 시작하지 않은 경기의 사유**(없으면 `null`) */
  stopped: RefetchSkipReason | null;
  games: RefetchGame[];
  /** 1 — `prepare_failed` · `commit_failed` · `snapshot_failed` 가 하나라도 있다. 마감·예산·고통 신호만으로 멈춘 것은 0 */
  exit: 0 | 1;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * 고른 경기를 **차례대로** 다시 받는다(받는 차례 = 고른 차례 · 설계 D6).
 *
 * 경기마다:
 * 1. **시작 전에 묻는다**(D7-4 · 이 차례로 · 처음 걸린 것으로 멈추고, 남은 경기는 전부 같은 사유로 `skipped`):
 *    ① 회로가 열렸다 — 앞 경기가 실패했거나(`prepare_failed`·`commit_failed`·`snapshot_failed`) 고통 신호가 한 번이라도 났다 → `circuit_open`
 *    ② `clock.now() >= deadline` → `deadline`
 *    ③ `meter.http + WORST_HTTP_PER_GAME > maxHttp` → `http_budget`
 * 2. 네 장의 **저장 바이트**를 뜬다. 못 뜨면(ENOENT 아닌 읽기 오류) 그 경기는 `skipped:snapshot_failed`(요청 0)이고 회로가 열린다.
 * 3. `archiveGame` 을 **그대로** 부른다.
 * 4. 결과에 `failed` 가 없으면 `recorded`. 있으면 다시 떠서 사전과 **바이트로** 맞댄다 — 같으면 `prepare_failed`(G3a 상태),
 *    다르면 `commit_failed`(G3b) → 되돌리고 → 다시 떠서 같으면 `rollback: "ok"`, 아니면 `"failed"`(이중 고장).
 *
 * ⚠갈래를 결과 문자열이 아니라 바이트 비교로 가른다 — `PageResult` 에는 실패가 받기에서 났는지 기록에서 났는지 칸이 없다.
 *   **바이트가 그대로라는 사실이 곧 「아무것도 안 썼다」의 판정**이다.
 * @throws {RangeError} 경기 상한(`AUTO_REFETCH_MAX_GAMES`) 초과 · 같은 경기 중복 · 잘못된 옵션 — **한 장도 받기 전에**.
 */
export async function refetchGames(refs: readonly GameRef[], deps: RefetchDeps, opts: RefetchOptions): Promise<RefetchResult> {
  const ids = refs.map(gameIdOf);
  if (ids.length > AUTO_REFETCH_MAX_GAMES) throw new RangeError(`경기가 ${String(ids.length)}개다 — 자동 재수집은 ${String(AUTO_REFETCH_MAX_GAMES)}경기까지다(L1)`);
  if (new Set(ids).size !== ids.length) throw new RangeError("같은 경기가 두 번 들어 있다 — 두 번 받지 않는다(L1)");
  if (!Number.isFinite(opts.deadlineMs)) throw new RangeError(`마감이 시각이 아니다: ${String(opts.deadlineMs)}`);
  if (!Number.isInteger(opts.maxHttp) || opts.maxHttp < 0) throw new RangeError(`HTTP 예산이 0 이상의 정수가 아니다: ${String(opts.maxHttp)}`);

  const games: RefetchGame[] = [];
  const emit = (game: RefetchGame, pages: readonly PageResult[], notes: readonly string[]): void => {
    games.push(game);
    opts.onGame?.(game, { pages, notes });
  };
  /** ①~③ 으로 한 번 멈추면 그 사유를 남은 경기 전부에 쓴다(시계가 되돌아가도 다시 시작하지 않는다) */
  let halted: HaltReason | null = null;
  let stopped: RefetchSkipReason | null = null;
  /** 회로 ⑴ — 앞 경기가 실패했다 */
  let failedBefore = false;

  for (const [i, ref] of refs.entries()) {
    const id = ids[i]!;
    const why: HaltReason | null = halted ?? stopBefore(deps, opts, failedBefore);
    if (why !== null) {
      halted = why;
      stopped ??= why;
      emit(skipped(ref, id, why), [], []);
      continue;
    }

    let pre: PageSnapshot[];
    try {
      pre = await snapshotGame(deps.sink, ref);
    } catch (err) {
      failedBefore = true;
      stopped ??= "snapshot_failed";
      emit(skipped(ref, id, "snapshot_failed"), [], [`사전 사본을 못 떴다 — 되돌릴 수 없으므로 받지 않는다: ${errorText(err)}`]);
      continue;
    }
    const boxBefore = await boxSha(deps.sink, ref);

    const httpBefore = deps.meter.http;
    let pages: PageResult[];
    try {
      pages = await archiveGame(ref, { fetcher: deps.fetcher, sink: deps.sink, clock: deps.clock });
    } catch (err) {
      // ⚠`archiveGame` 은 던지지 않는다(`prepareUrl`·`commitPrepared` 가 흡수한다). 던졌다면 결함이다 —
      //   섞인 세트를 남기지 않게 맞대고 되돌린 뒤 **다시 던진다**(결과 JSON 을 약속하지 않는다 · 부르는 쪽이 종료 1 로 센다)
      await settleFailedGame(deps.sink, ref, pre);
      throw err;
    }
    const http = deps.meter.http - httpBefore;

    let status: RefetchGameStatus = "recorded";
    let rollback: RefetchRollback = null;
    const notes: string[] = [];
    if (pages.some((p) => p.outcome === "failed")) {
      failedBefore = true;
      ({ status, rollback } = await settleFailedGame(deps.sink, ref, pre, notes));
    }
    const s = summarize(pages);
    emit(
      {
        id,
        date: ref.date,
        status,
        reason: null,
        pages: { stored: s.stored, unchanged: s.unchanged, absent: s.absent, failed: s.failed, held: s.held },
        page_fetches: pages.length,
        http_attempts: http,
        rollback,
        box_sha_before: boxBefore,
        box_sha_after: await boxSha(deps.sink, ref),
      },
      pages,
      notes,
    );
  }

  const failed = games.some((g) => g.status === "prepare_failed" || g.status === "commit_failed" || g.reason === "snapshot_failed");
  return {
    page_fetches: games.reduce((n, g) => n + g.page_fetches, 0),
    http_attempts: deps.meter.http,
    by_status: { ...deps.meter.byStatus },
    distress: deps.meter.distress,
    stopped,
    games,
    exit: failed ? 1 : 0,
  };
}

/** 멈춤 사유(①~③) — 한 번 걸리면 남은 경기 전부가 이 사유다. `snapshot_failed` 는 멈춤이 아니라 그 경기의 실패다 */
type HaltReason = Exclude<RefetchSkipReason, "snapshot_failed">;

/** 시작 전 검사 ①~③(설계 D7-4 의 차례). 걸리면 사유, 아니면 `null` */
function stopBefore(deps: RefetchDeps, opts: RefetchOptions, failedBefore: boolean): HaltReason | null {
  if (failedBefore || deps.meter.distress) return "circuit_open";
  if (deps.clock.now().getTime() >= opts.deadlineMs) return "deadline";
  if (deps.meter.http + WORST_HTTP_PER_GAME > opts.maxHttp) return "http_budget";
  return null;
}

function skipped(ref: GameRef, id: string, reason: RefetchSkipReason): RefetchGame {
  return {
    id,
    date: ref.date,
    status: "skipped",
    reason,
    pages: { stored: 0, unchanged: 0, absent: 0, failed: 0, held: 0 },
    page_fetches: 0,
    http_attempts: 0,
    rollback: null,
    box_sha_before: null,
    box_sha_after: null,
  };
}

/** 네 장의 사본 — `GAME_PAGES` 차례 */
async function snapshotGame(sink: RestorableSink, ref: GameRef): Promise<PageSnapshot[]> {
  const out: PageSnapshot[] = [];
  for (const page of GAME_PAGES) out.push(await sink.snapshot(pageKey(ref, page)));
  return out;
}

function sameGame(a: readonly PageSnapshot[], b: readonly PageSnapshot[]): boolean {
  return a.length === b.length && a.every((s, i) => b[i] !== undefined && sameSnapshot(s, b[i]));
}

/** 다시 뜬다 — 못 뜨면 `null`(「모른다」) */
async function trySnapshotGame(sink: RestorableSink, ref: GameRef, notes: string[], what: string): Promise<PageSnapshot[] | null> {
  try {
    return await snapshotGame(sink, ref);
  } catch (err) {
    notes.push(`${what} 사본을 못 떴다: ${errorText(err)}`);
    return null;
  }
}

/**
 * 실패한 경기를 정리한다(설계 D7-5).
 * - 다시 뜬 바이트가 사전과 같다 → `prepare_failed`(아무것도 안 바뀌었다 · 되돌릴 것이 없다).
 * - 다르거나 **못 떴다**(모른다 → 바뀐 쪽으로 다룬다) → `commit_failed` → 네 장 전부 되돌리고 → 다시 떠서 같으면 `ok`.
 * ⚠되돌리기의 성패는 `restore` 의 반환이 아니라 **다시 뜬 바이트**가 정한다 — 조용히 아무것도 안 한 `restore` 도 잡는다.
 * ⚠한 장의 되돌리기가 실패해도 나머지 장을 되돌린다 — 섞인 정도를 줄인다(판정은 마지막 비교 하나다).
 */
async function settleFailedGame(
  sink: RestorableSink,
  ref: GameRef,
  pre: readonly PageSnapshot[],
  notes: string[] = [],
): Promise<{ status: "prepare_failed" | "commit_failed"; rollback: RefetchRollback }> {
  const post = await trySnapshotGame(sink, ref, notes, "실패 뒤");
  if (post !== null && sameGame(pre, post)) return { status: "prepare_failed", rollback: null };
  for (const snap of pre) {
    try {
      await sink.restore(snap.key, snap);
    } catch (err) {
      notes.push(`되돌리기 실패 ${snap.key}: ${errorText(err)}`);
    }
  }
  const after = await trySnapshotGame(sink, ref, notes, "되돌린 뒤");
  return { status: "commit_failed", rollback: after !== null && sameGame(pre, after) ? "ok" : "failed" };
}

/** box 사이드카의 `sha256`. 없거나 못 읽으면 `null` — 보고용이고 판정에 쓰지 않는다 */
async function boxSha(sink: RestorableSink, ref: GameRef): Promise<string | null> {
  try {
    const meta = await sink.readMeta(pageKey(ref, "box.html"));
    return typeof meta?.sha256 === "string" ? meta.sha256 : null;
  } catch {
    return null;
  }
}
