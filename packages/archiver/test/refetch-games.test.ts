/**
 * 정정 자동 재수집의 받기 핵심(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7 · 시험 T7).
 *
 * ⚠**가짜 `fetchImpl`·`sleep`·`clock`·`timeoutSignal` 만 쓴다 — 외부 요청 0.**
 * ⚠**가짜 시계는 흐르지 않는다**(설계 T7). 그래서 간격 대기(`waitForSlot`)도 `sleep 3000` 으로 기록되고,
 *   단정은 **전송(`GET`)과 `sleep` 의 전체 열**로 한다 — 「간격 → 전송 → … → 백오프」 차례가 하나로 정해진다.
 * ⚠되돌리기(R2-2)는 **실제 파일**(`LocalSink` · 임시 폴더)로 잰다 — 단정은 「네 장의 파일 바이트가 사전과 같다」이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { AUTO_REFETCH_MAX_HTTP, AUTO_REFETCH_REQUEST_TIMEOUT_MS } from "@bb-app/store/refetch-limit";
import type { Clock } from "../src/clock.ts";
import { GAME_PAGES, gameRefFromId, pageKey } from "../src/discover.ts";
import type { GamePage, GameRef } from "../src/discover.ts";
import { RETRYABLE } from "../src/fetcher.ts";
import type { PoliteFetcher } from "../src/fetcher.ts";
import { meteredFetch, newFetchMeter } from "../src/metered-fetch.ts";
import type { FetchMeter, TimedFetchImpl } from "../src/metered-fetch.ts";
import { WORST_HTTP_PER_GAME, createRefetchFetcher, refetchGames } from "../src/refetch-games.ts";
import type { RefetchOptions, RefetchResult } from "../src/refetch-games.ts";
import { LocalSink, MemorySink, sha256, tmpPathOf } from "../src/sink.ts";
import type { BlobMeta, PageSnapshot, RestorableSink } from "../src/sink.ts";

// ---- 하네스 ---------------------------------------------------------------

const T0 = Date.parse("2026-09-28T20:51:00.000Z");
const DEADLINE = T0 + 25 * 60_000;
/** 이번 사고의 세 경기(설계 M-F) — 차례는 D6 의 고른 차례(최근부터) */
const IDS = ["2026/0923/s-t-23", "2026/0917/t-c-20", "2026/0513/s-t-08"] as const;
const G1 = gameRefFromId(IDS[0]);
const G2 = gameRefFromId(IDS[1]);
const G3 = gameRefFromId(IDS[2]);
const REFS: readonly GameRef[] = [G1, G2, G3];
const LEAVES = ["index", "playbyplay", "box", "roster"] as const;
type Leaf = (typeof LEAVES)[number];
const PAGE_OF: Record<Leaf, GamePage> = { index: "", playbyplay: "playbyplay.html", box: "box.html", roster: "roster.html" };
const keyOf = (ref: GameRef, leaf: Leaf): string => pageKey(ref, PAGE_OF[leaf]);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const shaOf = (s: string): string => sha256(enc(s));

/** 가짜 응답 한 벌 */
interface Fake {
  status: number;
  body?: string;
  location?: string;
  /** 헤더는 왔는데 본문 읽기가 실패한다(전송 중 끊김·시간 초과의 모양) */
  bodyError?: Error;
}
const ok = (lbl: string): Fake => ({ status: 200, body: `new:${lbl}` });

function respond(f: Fake) {
  const bytes = enc(f.body ?? "");
  return {
    status: f.status,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? (f.location ?? null) : null) },
    arrayBuffer: async () => {
      if (f.bodyError) throw f.bodyError;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

/** 주소 → `g1/box?h=1` 같은 짧은 이름. 경기는 `REFS` 의 차례(1부터) */
function label(url: string): string {
  const u = new URL(url);
  const i = REFS.findIndex((r) => u.pathname.startsWith(r.path));
  if (i === -1) return `?${url}`;
  const leaf = u.pathname.slice(REFS[i]!.path.length).replace(/\.html$/, "") || "index";
  return `g${String(i + 1)}/${leaf}${u.search}`;
}

interface Rig {
  events: string[];
  timeouts: number[];
  meter: FetchMeter;
  clock: Clock;
  fetcher: PoliteFetcher;
  setNow(ms: number): void;
}

/**
 * 자동 경로의 fetcher 를 **진짜 조립 함수**(`createRefetchFetcher`)로 만든다 — `maxRetries`·시간 상한·계측이
 * CLI 와 같은 배선을 지난다. `route` 는 그 페이지(주소)의 n번째 전송에 줄 응답이다.
 */
function rig(route: (lbl: string, nth: number) => Fake | Error, o: { signal?: (n: number) => AbortSignal } = {}): Rig {
  let now = T0;
  const events: string[] = [];
  const timeouts: number[] = [];
  const meter = newFetchMeter();
  const seen = new Map<string, number>();
  const clock: Clock = { now: () => new Date(now) };
  const inner: TimedFetchImpl = async (url, init) => {
    const lbl = label(url);
    const n = (seen.get(lbl) ?? 0) + 1;
    seen.set(lbl, n);
    events.push(`GET ${lbl}`);
    // 진짜 fetch 처럼 끊긴 신호면 그 사유로 던진다
    if (init.signal.aborted) throw init.signal.reason;
    const r = route(lbl, n);
    if (r instanceof Error) throw r;
    return respond(r);
  };
  const fetcher = createRefetchFetcher({
    userAgent: "bb-test",
    minDelayMs: 3000,
    clock,
    meter,
    fetchImpl: inner,
    sleep: async (ms) => {
      events.push(`sleep ${String(ms)}`);
    },
    timeoutSignal: (ms) => {
      timeouts.push(ms);
      return o.signal ? o.signal(timeouts.length) : new AbortController().signal;
    },
  });
  return {
    events,
    timeouts,
    meter,
    clock,
    fetcher,
    setNow: (ms) => {
      now = ms;
    },
  };
}

function run(r: Rig, sink: RestorableSink, refs: readonly GameRef[], opts: Partial<RefetchOptions> = {}): Promise<RefetchResult> {
  return refetchGames(refs, { fetcher: r.fetcher, sink, clock: r.clock, meter: r.meter }, { deadlineMs: DEADLINE, maxHttp: AUTO_REFETCH_MAX_HTTP, ...opts });
}

/** 이미 받아 둔 경기(사고의 경기는 전부 이미 있다) — 옛 본문 `old:<key>` · 옛 세트 `S0` */
async function seedGame(sink: RestorableSink, ref: GameRef): Promise<void> {
  for (const leaf of LEAVES) {
    const key = keyOf(ref, leaf);
    const body = enc(`old:${key}`);
    await sink.write(key, body, {
      url: `https://npb.jp${ref.path}${PAGE_OF[leaf]}`,
      fetchedAt: "2026-09-18T09:24:00.000Z",
      lastModified: null,
      etag: null,
      status: 200,
      sha256: sha256(body),
      byteLength: body.byteLength,
      revision: 1,
      set: "S0",
    });
  }
}

// ---- 기대 열 ---------------------------------------------------------------

/** 200 한 번 — 그 실행의 첫 전송이면 앞의 간격 대기가 없다 */
const ok200 = (lbl: string, first: boolean): string[] => [...(first ? [] : ["sleep 3000"]), `GET ${lbl}`];
/** 재시도 대상 응답 연속 — 시도 2(maxRetries 1) · 백오프 3000 · 6000(마지막 시도 뒤에도 잔다) */
const fail2x = (lbl: string, first: boolean): string[] => [
  ...(first ? [] : ["sleep 3000"]),
  `GET ${lbl}`,
  "sleep 3000",
  "sleep 3000",
  `GET ${lbl}`,
  "sleep 6000",
];
/** 302→302→302→503 를 두 시도 — 시도마다 4전송(홉마다 간격) · 백오프 3000 · 6000 */
function redirect2x(lbl: string, first: boolean): string[] {
  const attempt = (backoff: number): string[] => [
    `GET ${lbl}`,
    "sleep 3000",
    `GET ${lbl}?h=1`,
    "sleep 3000",
    `GET ${lbl}?h=2`,
    "sleep 3000",
    `GET ${lbl}?h=3`,
    `sleep ${String(backoff)}`,
  ];
  return [...(first ? [] : ["sleep 3000"]), ...attempt(3000), "sleep 3000", ...attempt(6000)];
}
const game = (g: string, f: (lbl: string, first: boolean) => string[], first: boolean): string[] =>
  LEAVES.flatMap((leaf, i) => f(`${g}/${leaf}`, first && i === 0));

const statuses = (res: RefetchResult): string[] =>
  res.games.map((g) => (g.status === "skipped" ? `skipped:${String(g.reason)}` : g.status));

// ---- 전송과 백오프(R2-1) ----------------------------------------------------

test("T7⑴ 전부 200 — 경기당 전송 4 · 백오프 0 · 결과 JSON 의 모양 · 종료 0", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const r = rig((lbl) => ok(lbl));
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(r.events, [...game("g1", ok200, true), ...game("g2", ok200, false)]);
  assert.deepEqual(r.timeouts, Array(8).fill(AUTO_REFETCH_REQUEST_TIMEOUT_MS), "전송마다 시간 상한 신호를 새로 만든다");
  assert.deepEqual(Object.keys(res), ["page_fetches", "http_attempts", "by_status", "distress", "stopped", "games", "exit"]);
  assert.deepEqual(Object.keys(res.games[0]!), [
    "id", "date", "status", "reason", "pages", "page_fetches", "http_attempts", "rollback", "box_sha_before", "box_sha_after",
  ]);
  const gameOf = (ref: GameRef, id: string, g: string) => ({
    id,
    date: ref.date,
    status: "recorded",
    reason: null,
    pages: { stored: 4, unchanged: 0, absent: 0, failed: 0, held: 0 },
    page_fetches: 4,
    http_attempts: 4,
    rollback: null,
    box_sha_before: shaOf(`old:${keyOf(ref, "box")}`),
    box_sha_after: shaOf(`new:${g}/box`),
  });
  assert.deepEqual(res, {
    page_fetches: 8,
    http_attempts: 8,
    by_status: { "200": 8 },
    distress: false,
    stopped: null,
    games: [gameOf(G1, IDS[0], "g1"), gameOf(G2, IDS[1], "g2")],
    exit: 0,
  });
});

test("⚠T7⑵ 503 연속 — 페이지당 전송 2 · 백오프 [3000, 6000] · 그 경기 prepare_failed · 다음 경기 skipped:circuit_open · 종료 1", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const before = await Promise.all(LEAVES.map(async (l) => sink.snapshot(keyOf(G1, l))));
  const r = rig(() => ({ status: 503 }));
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(r.events, game("g1", fail2x, true), "⚠maxRetries 가 1 이 아니면 페이지당 전송이 2 가 아니다");
  assert.deepEqual(statuses(res), ["prepare_failed", "skipped:circuit_open"]);
  assert.equal(res.games[0]!.http_attempts, 8);
  assert.equal(res.games[0]!.rollback, null, "받기 실패(G3a)는 되돌릴 것이 없다");
  assert.equal(res.games[1]!.http_attempts, 0);
  assert.equal(res.games[1]!.page_fetches, 0);
  assert.deepEqual(res.by_status, { "503": 8 });
  assert.equal(res.distress, true);
  assert.equal(res.stopped, "circuit_open");
  assert.equal(res.exit, 1);
  const after = await Promise.all(LEAVES.map(async (l) => sink.snapshot(keyOf(G1, l))));
  assert.deepEqual(after, before, "받기 실패면 아무것도 안 쓴다");
});

test("⚠T7⑶ 302→302→302→503 — 페이지당 전송 8 · 경기 32(= 한 경기 최악) · 백오프 [3000, 6000] · 회로가 열린다", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const r = rig((lbl) => {
    const h = Number(/\?h=(\d)$/.exec(lbl)?.[1] ?? "0");
    return h < 3 ? { status: 302, location: `?h=${String(h + 1)}` } : { status: 503 };
  });
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(r.events, game("g1", redirect2x, true));
  assert.equal(r.meter.http, 32);
  assert.equal(WORST_HTTP_PER_GAME, 32, "한 경기 최악 = 4장 × 2시도 × (1 + 3홉)");
  assert.equal(res.games[0]!.http_attempts, WORST_HTTP_PER_GAME, "이 응답 모양이 한 경기 최악에 정확히 닿는다");
  assert.deepEqual(res.by_status, { "302": 24, "503": 8 });
  assert.deepEqual(statuses(res), ["prepare_failed", "skipped:circuit_open"]);
  assert.equal(res.exit, 1);
});

test("⚠T7⑷ 시간 초과(신호가 끊김) — 예외 → 재시도 → 고통 신호 · 그 경기는 recorded · 다음 경기 circuit_open · 종료 0", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const r = rig((lbl) => ok(lbl), {
    signal: (n) => (n === 1 ? AbortSignal.abort(new DOMException("시간 초과(주입)", "TimeoutError")) : new AbortController().signal),
  });
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(r.events.slice(0, 5), ["GET g1/index", "sleep 3000", "sleep 3000", "GET g1/index", "sleep 3000"]);
  assert.ok(r.timeouts.every((ms) => ms === AUTO_REFETCH_REQUEST_TIMEOUT_MS), `시간 상한이 ${AUTO_REFETCH_REQUEST_TIMEOUT_MS}ms 가 아니다: ${r.timeouts.join(",")}`);
  assert.deepEqual(statuses(res), ["recorded", "skipped:circuit_open"]);
  assert.deepEqual(res.by_status, { "200": 4, exception: 1 });
  assert.equal(res.http_attempts, 5);
  assert.equal(res.distress, true);
  assert.equal(res.exit, 0, "고통 신호만으로 열린 회로는 실패가 아니다");
});

test("⚠T7⑸ 503 한 번 뒤 200 — 그 경기는 recorded · 다음 경기는 skipped:circuit_open · 종료 0", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const r = rig((lbl, n) => (lbl === "g1/index" && n === 1 ? { status: 503 } : ok(lbl)));
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(r.events.slice(0, 4), ["GET g1/index", "sleep 3000", "sleep 3000", "GET g1/index"]);
  assert.deepEqual(statuses(res), ["recorded", "skipped:circuit_open"]);
  assert.deepEqual(res.by_status, { "200": 4, "503": 1 });
  assert.equal(res.distress, true);
  assert.equal(res.stopped, "circuit_open");
  assert.equal(res.exit, 0);
  assert.equal(new TextDecoder().decode(sink.bodies.get(keyOf(G1, "box"))), "new:g1/box", "그 경기는 기록됐다");
});

test("⚠T7 본문 읽기 실패(헤더 뒤 끊김)도 고통 신호다 — 재시도로 그 페이지가 성공해도 회로가 열린다", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  const r = rig((lbl, n) => (lbl === "g1/index" && n === 1 ? { status: 200, bodyError: new DOMException("끊김(주입)", "AbortError") } : ok(lbl)));
  const res = await run(r, sink, [G1, G2]);

  assert.deepEqual(statuses(res), ["recorded", "skipped:circuit_open"]);
  assert.deepEqual(res.by_status, { "200": 5 }, "본문 읽기 실패는 전송이 아니다 — 상태별 횟수는 응답마다 한 번");
  assert.equal(res.distress, true, "본문 읽기 실패가 고통 신호로 안 잡혔다");
});

// ---- 경기 사이에서 멈춘다 — 마감 · 예산 · 차례(R2-1 · R2-6) ------------------

for (const [name, at, want] of [
  ["1ms 전", DEADLINE - 1, "recorded"],
  ["정확히", DEADLINE, "skipped:deadline"],
  ["1ms 뒤", DEADLINE + 1, "skipped:deadline"],
] as const) {
  test(`⚠T7 마감 ${name} — 둘째 경기는 ${want}(\`now >= deadline\` 한 식)`, async () => {
    const sink = new MemorySink();
    await seedGame(sink, G1);
    await seedGame(sink, G2);
    let r!: Rig;
    r = rig((lbl) => {
      if (lbl === "g1/roster") r.setNow(at); // 첫 경기의 마지막 페이지를 받는 동안 시계가 그 자리에 닿는다
      return ok(lbl);
    });
    const res = await run(r, sink, [G1, G2]);
    assert.deepEqual(statuses(res), ["recorded", want]);
    assert.equal(res.stopped, want === "recorded" ? null : "deadline");
    assert.equal(res.exit, 0);
  });
}

test("⚠T7 마감으로 멈추면 남은 경기는 전부 같은 사유다 · 시작 전에 이미 지났으면 요청 0", async () => {
  const sink = new MemorySink();
  for (const g of REFS) await seedGame(sink, g);
  const r = rig((lbl) => ok(lbl));
  r.setNow(DEADLINE);
  const res = await run(r, sink, REFS);
  assert.deepEqual(statuses(res), ["skipped:deadline", "skipped:deadline", "skipped:deadline"]);
  assert.deepEqual(r.events, [], "마감이 지난 뒤에는 한 장도 받지 않는다");
  assert.equal(res.page_fetches, 0);
});

test("⚠T7 HTTP 예산 — meter.http 97 이면 다음 경기는 skipped:http_budget(97 + 32 > 128) · 96 이면 시작한다", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);

  const over = rig((lbl) => ok(lbl));
  over.meter.http = 97;
  const a = await run(over, sink, [G1, G2]);
  assert.deepEqual(statuses(a), ["skipped:http_budget", "skipped:http_budget"]);
  assert.deepEqual(over.events, []);
  assert.equal(a.stopped, "http_budget");
  assert.equal(a.exit, 0);

  const edge = rig((lbl) => ok(lbl));
  edge.meter.http = 96;
  const b = await run(edge, sink, [G1, G2]);
  assert.deepEqual(statuses(b), ["recorded", "skipped:http_budget"], "96 + 32 = 128 은 시작 · 그 뒤 100 + 32 > 128 은 멈춤");
  assert.equal(edge.meter.http, 100);
});

test("⚠T7 정상 24경기는 예산 안에서 다 돈다 — 24번째 경기 앞에서 92 + 32 = 124 ≤ 128(설계 D7-4)", async () => {
  const ids = Array.from({ length: 24 }, (_, i) => `2026/09${String(i + 1).padStart(2, "0")}/s-t-${String(i + 1)}`);
  const refs = ids.map(gameRefFromId);
  const sink = new MemorySink();
  const meter = newFetchMeter();
  const clock: Clock = { now: () => new Date(T0) };
  const fetcher = createRefetchFetcher({
    userAgent: "bb-test",
    minDelayMs: 3000,
    clock,
    meter,
    fetchImpl: async (url) => respond({ status: 200, body: url }),
    sleep: async () => undefined,
    timeoutSignal: () => new AbortController().signal,
  });
  const res = await refetchGames(refs, { fetcher, sink, clock, meter }, { deadlineMs: DEADLINE, maxHttp: AUTO_REFETCH_MAX_HTTP });
  assert.equal(res.games.filter((g) => g.status === "recorded").length, 24);
  assert.equal(res.page_fetches, 96);
  assert.equal(res.http_attempts, 96);
  assert.equal(res.exit, 0);
});

test("⚠T7 멈춤의 차례 — 회로 > 마감 > 예산(처음 걸린 것)", async () => {
  // 회로(고통 신호)와 마감이 함께 걸리면 회로다
  const sink = new MemorySink();
  await seedGame(sink, G1);
  await seedGame(sink, G2);
  let r!: Rig;
  r = rig((lbl, n) => {
    if (lbl === "g1/roster") r.setNow(DEADLINE);
    return lbl === "g1/index" && n === 1 ? { status: 503 } : ok(lbl);
  });
  const a = await run(r, sink, [G1, G2]);
  assert.deepEqual(statuses(a), ["recorded", "skipped:circuit_open"]);

  // 마감과 예산이 함께 걸리면 마감이다
  const both = rig((lbl) => ok(lbl));
  both.setNow(DEADLINE);
  both.meter.http = 97;
  const b = await run(both, sink, [G1]);
  assert.deepEqual(statuses(b), ["skipped:deadline"]);
});

test("⚠T7 경기 상한·중복·잘못된 옵션은 요청 전에 던진다(마지막 방어선)", async () => {
  const sink = new MemorySink();
  const r = rig((lbl) => ok(lbl));
  const many = Array.from({ length: 25 }, (_, i) => gameRefFromId(`2026/08${String(i + 1).padStart(2, "0")}/s-t-1`));
  await assert.rejects(run(r, sink, many), RangeError);
  await assert.rejects(run(r, sink, [G1, G1]), RangeError);
  await assert.rejects(run(r, sink, [G1], { deadlineMs: Number.NaN }), RangeError);
  await assert.rejects(run(r, sink, [G1], { maxHttp: -1 }), RangeError);
  assert.deepEqual(r.events, [], "던지기 전에 한 장도 받으면 안 된다");
});

// ---- 사전 사본 실패 ---------------------------------------------------------

class SnapshotFailSink extends MemorySink {
  private readonly bad: string;
  constructor(bad: string) {
    super();
    this.bad = bad;
  }
  override async snapshot(key: string): Promise<PageSnapshot> {
    if (key === this.bad) throw Object.assign(new Error("EACCES(주입)"), { code: "EACCES" });
    return super.snapshot(key);
  }
}

test("⚠T7 사전 사본을 못 뜨면 그 경기는 skipped:snapshot_failed(요청 0) · 회로가 열린다 · 종료 1", async () => {
  const sink = new SnapshotFailSink(keyOf(G2, "box"));
  for (const g of REFS) await seedGame(sink, g);
  const r = rig((lbl) => ok(lbl));
  const res = await run(r, sink, REFS);
  assert.deepEqual(statuses(res), ["recorded", "skipped:snapshot_failed", "skipped:circuit_open"]);
  assert.ok(!r.events.some((e) => e.startsWith("GET g2/")), "사본을 못 뜬 경기를 받았다 — 되돌릴 수 없는 채로 쓴다");
  assert.equal(res.stopped, "snapshot_failed");
  assert.equal(res.exit, 1);
});

test("T7 처음 받는 경기(파일 없음)는 사본이 「없음」이고 실패가 아니다", async () => {
  const sink = new MemorySink();
  const r = rig((lbl) => ok(lbl));
  const res = await run(r, sink, [G1]);
  assert.deepEqual(statuses(res), ["recorded"]);
  assert.equal(res.games[0]!.box_sha_before, null);
  assert.equal(res.games[0]!.box_sha_after, shaOf("new:g1/box"));
});

// ---- 한 경기 안 — G3a 와 G3b, 되돌리기(R2-2) ---------------------------------

/**
 * 실제 파일에 실패를 주입한다.
 * - `failBodyOf`: 그 키의 **본문** 기록이 실패한다. 기본은 「임시 파일은 썼고 rename 에서 죽은」 모양이라 이 프로세스의 임시 파일이 남는다.
 *   `cleanBodyFailure` 면 흔적 없이 던진다(디렉터리 만들기 실패 같은 모양).
 * - `failMetaOf`: 그 키의 **사이드카** 기록이 실패한다 — 본문은 이미 새 판으로 옮겨졌고 사이드카 임시 파일이 남는다.
 * ⚠`LocalSink.write` 가 사이드카를 `this.writeMeta` 로 쓰므로 여기서 가로챌 수 있다.
 */
class FaultySink extends LocalSink {
  armed = false;
  failBodyOf: string | null = null;
  cleanBodyFailure = false;
  failMetaOf: string | null = null;
  failRestore = false;
  restoreNoop = false;
  restoreCalls = 0;
  override async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    if (this.armed && key === this.failBodyOf) {
      if (!this.cleanBodyFailure) await writeFile(tmpPathOf(join(this.root, `${key}.html.gz`)), gzipSync(body).subarray(0, 7));
      throw new Error("디스크 오류(본문 · 주입)");
    }
    return super.write(key, body, meta);
  }
  override async writeMeta(key: string, meta: BlobMeta): Promise<void> {
    if (this.armed && key === this.failMetaOf) {
      await writeFile(tmpPathOf(join(this.root, `${key}.meta.json`)), "{");
      throw new Error("디스크 오류(사이드카 · 주입)");
    }
    return super.writeMeta(key, meta);
  }
  override async restore(key: string, snap: PageSnapshot): Promise<void> {
    this.restoreCalls += 1;
    if (this.failRestore) throw new Error("되돌리기 실패(주입)");
    if (this.restoreNoop) return;
    return super.restore(key, snap);
  }
}

/** 그 경기 네 장의 **저장 바이트**(본문 `.gz` · 사이드카) — 없으면 null */
async function rawPages(root: string, ref: GameRef): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const leaf of LEAVES) {
    for (const ext of [".html.gz", ".meta.json"]) {
      const p = join(root, `${keyOf(ref, leaf)}${ext}`);
      out[`${leaf}${ext}`] = await readFile(p).then(
        (b) => b.toString("base64"),
        () => null,
      );
    }
  }
  return out;
}

async function tmpFiles(root: string): Promise<string[]> {
  const all = await readdir(root, { recursive: true });
  return all.filter((p) => p.endsWith(".tmp"));
}

async function withFaultySink(fn: (sink: FaultySink, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bb-refetch-"));
  try {
    const sink = new FaultySink(root);
    await seedGame(sink, G1);
    await seedGame(sink, G2);
    sink.armed = true;
    await fn(sink, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [name, setup] of [
  ["첫째(index) 본문 쓰기", (s: FaultySink) => (s.failBodyOf = keyOf(G1, "index"))],
  ["둘째(playbyplay) 본문 쓰기", (s: FaultySink) => (s.failBodyOf = keyOf(G1, "playbyplay"))],
  ["넷째(roster) 본문 쓰기", (s: FaultySink) => (s.failBodyOf = keyOf(G1, "roster"))],
  ["셋째(box) 사이드카 쓰기", (s: FaultySink) => (s.failMetaOf = keyOf(G1, "box"))],
] as const) {
  test(`⚠T7 기록 단계 실패(G3b) — ${name}: 네 장의 파일 바이트가 사전과 같다 · commit_failed · rollback ok · 종료 1`, async () => {
    await withFaultySink(async (sink, root) => {
      setup(sink);
      const before = await rawPages(root, G1);
      const r = rig((lbl) => ok(lbl)); // 네 장 전부 바뀌었다 — 기록 단계가 네 장을 차례로 쓴다
      const res = await run(r, sink, [G1, G2]);
      assert.deepEqual(statuses(res), ["commit_failed", "skipped:circuit_open"]);
      assert.equal(res.games[0]!.rollback, "ok");
      assert.equal(res.exit, 1);
      assert.deepEqual(await rawPages(root, G1), before, "되돌린 뒤 저장 바이트가 받기 전과 다르다 — 섞인 세트가 남았다");
      assert.deepEqual(await tmpFiles(root), [], "이 프로세스가 남긴 임시 파일이 남았다");
      assert.equal(res.games[0]!.box_sha_after, res.games[0]!.box_sha_before, "되돌린 box 는 사전의 판이다");
    });
  });
}

test("⚠T7 되돌리기(restore)도 실패하면 rollback failed · commit_failed · 종료 1 — 섞인 세트가 남는다(이중 고장)", async () => {
  await withFaultySink(async (sink, root) => {
    sink.failBodyOf = keyOf(G1, "playbyplay");
    sink.failRestore = true;
    const before = await rawPages(root, G1);
    const res = await run(rig((lbl) => ok(lbl)), sink, [G1, G2]);
    assert.deepEqual(statuses(res), ["commit_failed", "skipped:circuit_open"]);
    assert.equal(res.games[0]!.rollback, "failed");
    assert.equal(res.exit, 1);
    assert.notDeepEqual(await rawPages(root, G1), before, "이 시험의 전제(앞 페이지가 이미 새 판으로 기록됐다)가 깨졌다");
  });
});

test("⚠T7 되돌리기가 조용히 아무것도 안 하면 다시 떠서 잡는다 — rollback failed(restore 의 반환을 믿지 않는다)", async () => {
  await withFaultySink(async (sink) => {
    sink.failBodyOf = keyOf(G1, "playbyplay");
    sink.restoreNoop = true;
    const res = await run(rig((lbl) => ok(lbl)), sink, [G1, G2]);
    assert.equal(res.games[0]!.status, "commit_failed");
    assert.equal(res.games[0]!.rollback, "failed");
    assert.equal(res.exit, 1);
  });
});

test("⚠T7 받기 실패(G3a)면 파일이 그대로 · prepare_failed · rollback null · 되돌리기를 부르지 않는다", async () => {
  await withFaultySink(async (sink, root) => {
    const before = await rawPages(root, G1);
    const res = await run(rig((lbl) => (lbl === "g1/playbyplay" ? { status: 503 } : ok(lbl))), sink, [G1, G2]);
    assert.deepEqual(statuses(res), ["prepare_failed", "skipped:circuit_open"]);
    assert.equal(res.games[0]!.rollback, null);
    assert.equal(sink.restoreCalls, 0);
    assert.equal(res.exit, 1);
    assert.deepEqual(await rawPages(root, G1), before);
  });
});

test("T7 기록 단계의 첫 쓰기가 흔적 없이 실패하면 상태는 G3a 와 같다 — prepare_failed · rollback null(설계 D7-5 의 주)", async () => {
  await withFaultySink(async (sink, root) => {
    sink.failBodyOf = keyOf(G1, "index");
    sink.cleanBodyFailure = true;
    const before = await rawPages(root, G1);
    const res = await run(rig((lbl) => ok(lbl)), sink, [G1, G2]);
    assert.deepEqual(statuses(res), ["prepare_failed", "skipped:circuit_open"]);
    assert.equal(res.games[0]!.rollback, null);
    assert.equal(sink.restoreCalls, 0);
    assert.deepEqual(await rawPages(root, G1), before);
  });
});

// ---- 사본 · 되돌리기 그 자체 -------------------------------------------------

test("RestorableSink(Memory) — 사본은 바이트 복사본이고 restore 는 있던 것은 되쓰고 없던 것은 지운다", async () => {
  const sink = new MemorySink();
  await seedGame(sink, G1);
  const key = keyOf(G1, "box");
  const fresh = keyOf(G2, "box");
  const snapOld = await sink.snapshot(key);
  const snapNone = await sink.snapshot(fresh);
  await sink.write(key, enc("changed"), { ...(await sink.readMeta(key))!, sha256: shaOf("changed"), revision: 2 });
  await sink.write(fresh, enc("brand-new"), { ...(await sink.readMeta(key))!, sha256: shaOf("brand-new") });
  assert.notDeepEqual(await sink.snapshot(key), snapOld);

  await sink.restore(key, snapOld);
  await sink.restore(fresh, snapNone);
  assert.deepEqual(await sink.snapshot(key), snapOld);
  assert.equal(new TextDecoder().decode(sink.bodies.get(key)), `old:${key}`);
  assert.equal(await sink.readMeta(fresh), null, "없던 사이드카를 지우지 않았다");
  assert.equal(sink.bodies.has(fresh), false, "없던 본문을 지우지 않았다");
});

test("RestorableSink(Local) — 다른 키의 사본으로는 되돌리지 않는다(덮어쓰기 사고 방지)", async () => {
  await withFaultySink(async (sink) => {
    const snap = await sink.snapshot(keyOf(G1, "box"));
    await assert.rejects(sink.restore(keyOf(G2, "box"), snap));
  });
});

// ---- 계측 — meteredFetch ----------------------------------------------------

const URL0 = "https://npb.jp/scores/2026/0923/s-t-23/box.html";

test("meteredFetch — 호출마다 http +1 · 상태별 횟수 · 재시도 대상 상태만 고통 신호(RETRYABLE 한 벌)", async () => {
  assert.ok(RETRYABLE.size > 0);
  for (const status of RETRYABLE) {
    const m = newFetchMeter();
    const f = meteredFetch(async () => respond({ status }), m, { timeoutMs: 5000 });
    await f(URL0, { headers: {} });
    assert.equal(m.http, 1);
    assert.equal(m.distress, true, `${String(status)} 이 고통 신호로 안 잡혔다`);
    assert.deepEqual(m.byStatus, { [String(status)]: 1 });
  }
  for (const status of [200, 301, 302, 304, 404, 410]) {
    const m = newFetchMeter();
    const f = meteredFetch(async () => respond({ status }), m, { timeoutMs: 5000 });
    await f(URL0, { headers: {} });
    assert.equal(m.distress, false, `${String(status)} 은 고통 신호가 아니다`);
  }
});

test("meteredFetch — 예외(시간 초과 포함)는 고통 신호이고 그대로 다시 던진다 · 그 전송도 센다", async () => {
  const m = newFetchMeter();
  const boom = new Error("ECONNRESET(주입)");
  const f = meteredFetch(async () => {
    throw boom;
  }, m, { timeoutMs: 5000 });
  await assert.rejects(f(URL0, { headers: {} }), (e) => e === boom);
  assert.equal(m.http, 1);
  assert.equal(m.distress, true);
  assert.deepEqual(m.byStatus, { exception: 1 });
});

test("meteredFetch — 전송마다 timeoutSignal(timeoutMs) 의 신호를 넘기고 · 머리·본문은 그대로 전한다", async () => {
  const m = newFetchMeter();
  const asked: number[] = [];
  const signals: AbortSignal[] = [];
  const got: AbortSignal[] = [];
  const f = meteredFetch(
    async (_url, init) => {
      got.push(init.signal);
      return respond({ status: 302, location: "/x", body: "b" });
    },
    m,
    {
      timeoutMs: 1234,
      timeoutSignal: (ms) => {
        asked.push(ms);
        const s = new AbortController().signal;
        signals.push(s);
        return s;
      },
    },
  );
  const res = await f(URL0, { headers: { "User-Agent": "ua" }, redirect: "manual" });
  await f(URL0, { headers: {} });
  assert.deepEqual(asked, [1234, 1234]);
  assert.equal(got[0], signals[0]);
  assert.equal(got[1], signals[1], "전송마다 새 신호여야 한다 — 하나를 돌려 쓰면 둘째 전송부터 시간이 줄어든다");
  assert.equal(res.headers.get("location"), "/x");
  assert.equal(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer())), "b");
});
