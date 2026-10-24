/**
 * 홉마다의 시간 상한(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D3 · 시험 T4).
 *
 * ⚠**연결 30 · 헤더 30 · 본문 유휴 30초는 undici `Agent` 의 옵션이다** — 우리는 `AbortSignal` 을 쓰지 않는다(4차-1 로 단일 90초 마감 폐기).
 *   그래서 시간 초과는 전부 undici 코드(`UND_ERR_*_TIMEOUT`)로 오고, 상한은 **홉마다** 새로 걸린다.
 * ⚠**루프백(127.0.0.1)만 쓴다 — 외부 요청 0.** 작은 한도를 주입해 재고, 제품 값(30초)은 가짜 `Agent` 생성자로 잰다.
 * ⚠**undici 의 시간 초과는 정밀하지 않다**(실측 2026-10-24 · 7.29.0): 헤더·본문 한도는 약 0.5초 눈금의 「빠른 타이머」라
 *   300ms 를 주면 약 1.0초에 끊겼다. 눈금 하나만큼 **이르게**도 끊길 수 있다(`lib/util/timers.js` 의 `_idleStart = fastNow - TICK_MS`).
 *   → 홉 지연은 한도보다 눈금 하나(499ms) 넘게 짧게 잡는다.
 * ⚠**걸리면 매달리지 않고 실패한다** — 시험마다 `timeout` 을 준다(node:test 의 기본은 무한이다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { MAX_REDIRECTS, PoliteFetcher, TRANSPORT_LIMITS, createDefaultFetchImpl, worstAttemptMs, worstUrlMs } from "../src/fetcher.ts";
import type { TransportImpl, TransportLimits } from "../src/fetcher.ts";
import { UpstreamError } from "../src/upstream.ts";

const FETCHER = fileURLToPath(new URL("../src/fetcher.ts", import.meta.url));

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${String(port)}` };
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}

/** 가상 간격(즉시 돌아오는 sleep) · 재시도 0 — 한도만 잰다 */
function fetcherWith(limits: TransportLimits): PoliteFetcher {
  let t = Date.parse("2026-10-24T00:00:00Z");
  return new PoliteFetcher({
    userAgent: "bb-test",
    maxRetries: 0,
    clock: { now: () => new Date(t) },
    sleep: async (ms) => {
      t += ms;
    },
    fetchImpl: createDefaultFetchImpl(limits),
  });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- 제품 값 — 가짜 Agent 생성자로 ------------------------------------------------

test("⚠T4 제품 한도 — 연결 30 · 헤더 30 · 본문 유휴 30초 · 동시 1커넥션이 Agent 에 그대로 간다", async () => {
  assert.deepEqual(TRANSPORT_LIMITS, { connectMs: 30_000, headersMs: 30_000, bodyMs: 30_000 });
  const made: unknown[] = [];
  const sent: { url: string; init: Record<string, unknown> }[] = [];
  class FakeAgent {
    constructor(opts: unknown) {
      made.push(opts);
    }
  }
  const fake: TransportImpl = {
    Agent: FakeAgent,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return { status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  };
  const impl = createDefaultFetchImpl(undefined, fake);
  assert.deepEqual(made, [{ connect: { timeout: 30_000 }, headersTimeout: 30_000, bodyTimeout: 30_000, connections: 1 }]);
  await impl("https://npb.jp/a", { headers: { "User-Agent": "ua" }, redirect: "manual" });
  await impl("https://npb.jp/b", { headers: {}, redirect: "manual" });
  assert.equal(made.length, 1, "요청마다 Agent 를 새로 만든다 — 연결 재사용과 동시 1커넥션이 깨진다");
  assert.ok(sent[0]!.init["dispatcher"] instanceof FakeAgent, "그 Agent 를 dispatcher 로 넘기지 않는다");
  assert.equal(sent[1]!.init["dispatcher"], sent[0]!.init["dispatcher"], "같은 Agent 를 쓰지 않는다");
  assert.equal(sent[0]!.init["redirect"], "manual", "리디렉션을 fetch 에 맡겼다 — 홉이 L1 간격을 안 거친다");
  assert.deepEqual(sent[0]!.init["headers"], { "User-Agent": "ua" });
  assert.equal("signal" in sent[0]!.init, false, "AbortSignal 을 붙였다 — 단일 마감은 폐기됐다(설계 4차-1)");
});

test("⚠T4 PoliteFetcher 의 기본 fetchImpl 은 그 조립(createDefaultFetchImpl)이다 — 주입한 것은 그대로", () => {
  const src = readFileSync(FETCHER, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
  assert.match(src, /this\.fetchImpl = opts\.fetchImpl \?\? createDefaultFetchImpl\(\);/, "기본 전송이 홉별 한도를 가진 Agent 가 아니다");
  assert.equal(/globalThis\.fetch/.test(src), false, "내장 fetch 로 되돌렸다 — 헤더·본문 대기 상한이 300초(미확인)로 돌아간다");
});

test("⚠T4 시도 하나의 이론 상계 = H × (연결 + 헤더 + 본문 유휴) + H × 슬롯, H = 1 + MAX_REDIRECTS — 코드의 상수에서 나온다", () => {
  assert.equal(MAX_REDIRECTS, 3);
  const H = 1 + MAX_REDIRECTS;
  const per = (TRANSPORT_LIMITS.connectMs + TRANSPORT_LIMITS.headersMs + TRANSPORT_LIMITS.bodyMs) / 1000;
  assert.equal(per, 90);
  assert.equal(worstAttemptMs(3000), (H * per + H * 3) * 1000, "식이 홉별 한도와 안 맞는다 — 단일 마감을 되살렸는가");
  assert.equal(worstAttemptMs(3000), 372_000, "설계 D3 의 372초");
  // URL 하나 = 4시도 + 백오프 3+6+12+24 = 45초(마지막 시도 뒤에도 잔다)
  assert.equal(worstUrlMs(3000, 3), 4 * 372_000 + 45_000);
  assert.equal(worstUrlMs(3000, 3), 1_533_000, "설계 D3 의 1,533초");
});

// ---- 루프백 — 작은 한도를 주입해 실제로 끊기는지 ----------------------------------

test("⚠T4 응답 헤더가 안 오면 헤더 한도에서 끊는다 — headers-timeout(UND_ERR_HEADERS_TIMEOUT)", { timeout: 10_000 }, async () => {
  const { server, origin } = await listen(() => {
    /* 헤더를 영영 안 보낸다 */
  });
  try {
    const t0 = performance.now();
    const err = await fetcherWith({ connectMs: 2000, headersMs: 300, bodyMs: 2000 }).get(`${origin}/hang`).catch((e: unknown) => e);
    const took = performance.now() - t0;
    assert.ok(err instanceof UpstreamError, String(err));
    assert.equal(err.kind, "headers-timeout");
    assert.match(err.message, /headers-timeout\[UND_ERR_HEADERS_TIMEOUT\]/);
    assert.ok(took < 3000, `헤더 한도(300ms · 눈금 포함 약 1초)에서 안 끊겼다: ${took.toFixed(0)}ms`);
  } finally {
    await close(server);
  }
});

test("⚠T4 본문이 멈추면 본문 유휴 한도에서 끊는다 — body-timeout(UND_ERR_BODY_TIMEOUT)", { timeout: 10_000 }, async () => {
  const { server, origin } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial"); // 끝내지 않는다
  });
  try {
    const err = await fetcherWith({ connectMs: 2000, headersMs: 2000, bodyMs: 300 }).get(`${origin}/slow`).catch((e: unknown) => e);
    assert.ok(err instanceof UpstreamError, String(err));
    assert.equal(err.kind, "body-timeout");
  } finally {
    await close(server);
  }
});

/**
 * ⚠**홉 하나의 지연이 다음 홉의 한도를 깎지 않는다**(설계 4차-1). 각 홉은 700ms 늦게 답한다 — 헤더 한도(2,000ms · 눈금 하나 일러도 1,501ms)보다
 * 짧고, 넷을 합한 2.8초는 한 시도에 단일 마감(연결 + 헤더 + 본문 = 2,400ms)을 걸었다면 넘는다.
 */
test("⚠T4 3홉 리디렉션 — 각 홉이 자기 한도를 새로 받는다(합이 단일 마감을 넘어도 성공)", { timeout: 15_000 }, async () => {
  const hits: string[] = [];
  const { server, origin } = await listen((req, res) => {
    hits.push(req.url ?? "");
    const next: Record<string, string> = { "/a": "/b", "/b": "/c", "/c": "/d" };
    void delay(700).then(() => {
      const to = next[req.url ?? ""];
      if (to !== undefined) res.writeHead(302, { location: to }).end();
      else res.writeHead(200).end("OK");
    });
  });
  try {
    const limits = { connectMs: 200, headersMs: 2000, bodyMs: 200 };
    const t0 = performance.now();
    const r = await fetcherWith(limits).get(`${origin}/a`);
    const took = performance.now() - t0;
    assert.equal(r.status, 200);
    assert.deepEqual(hits, ["/a", "/b", "/c", "/d"]);
    assert.ok(took > limits.connectMs + limits.headersMs + limits.bodyMs, `전제가 틀렸다 — 합(${took.toFixed(0)}ms)이 단일 마감보다 짧다`);
  } finally {
    await close(server);
  }
});

test("⚠T4 3홉 리디렉션 — 마지막 홉이 멈추면 그 홉의 헤더 한도에서 끊긴다(앞 홉의 시간이 남은 한도를 줄이지 않는다)", { timeout: 15_000 }, async () => {
  const { server, origin } = await listen((req, res) => {
    const next: Record<string, string> = { "/a": "/b", "/b": "/c", "/c": "/d" };
    const to = next[req.url ?? ""];
    if (to !== undefined) void delay(700).then(() => res.writeHead(302, { location: to }).end());
    // "/d" 는 영영 답하지 않는다
  });
  try {
    const t0 = performance.now();
    const err = await fetcherWith({ connectMs: 200, headersMs: 2000, bodyMs: 200 }).get(`${origin}/a`).catch((e: unknown) => e);
    const took = performance.now() - t0;
    assert.ok(err instanceof UpstreamError, String(err));
    assert.equal(err.kind, "headers-timeout");
    // 앞 세 홉 2.1초 + 마지막 홉의 자기 한도(눈금 하나 일러도 1.5초) — 남은 한도를 깎았다면 3.6초 전에 끊긴다
    assert.ok(took > 3_500, `마지막 홉이 자기 한도를 다 못 받았다: ${took.toFixed(0)}ms`);
  } finally {
    await close(server);
  }
});

/**
 * ⚠**프로세스가 끝난다**(설계 T4) — 시간 초과 뒤에 Agent 의 소켓·타이머가 이벤트 루프를 붙들면 CLI 가 안 끝나고
 * 단계 걸쇠(30분)가 죽일 때까지 매달린다. 자식 프로세스로 띄워 4초 안에 **스스로** 끝나는지 본다(`process.exit` 없이).
 */
test("⚠T4 헤더 시간 초과 뒤 프로세스가 4초 안에 스스로 끝난다", { timeout: 15_000 }, () => {
  const script = [
    `import { createServer } from "node:http";`,
    `const { PoliteFetcher, createDefaultFetchImpl } = await import(${JSON.stringify(pathToFileURL(FETCHER).href)});`,
    `const server = createServer(() => {});`,
    `await new Promise((r) => server.listen(0, "127.0.0.1", r));`,
    `const { port } = server.address();`,
    `const f = new PoliteFetcher({ userAgent: "bb-test", maxRetries: 0, clock: { now: () => new Date(0) }, sleep: async () => {}, fetchImpl: createDefaultFetchImpl({ connectMs: 1000, headersMs: 300, bodyMs: 1000 }) });`,
    `try { await f.get("http://127.0.0.1:" + port + "/hang"); console.log("no-error"); } catch (e) { console.log("kind=" + e.kind); }`,
    `server.closeAllConnections(); server.close();`,
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 4000 });
  assert.equal(r.error, undefined, `4초 안에 안 끝났다(또는 못 띄웠다): ${String(r.error)}`);
  assert.equal(r.signal, null, "시간 제한으로 죽었다 — 무언가가 이벤트 루프를 붙든다");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kind=headers-timeout/, r.stdout + r.stderr);
});
