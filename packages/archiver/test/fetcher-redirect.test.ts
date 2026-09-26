/**
 * 리디렉션과 오류 응답이 **예의(L1)를 새지 않는가** — 2026-09-25 감사 C1·C2.
 *
 * ⚠**가짜 `fetchImpl` 로는 못 잰다.** 두 결함 모두 **네이티브 `fetch` 의 동작**에서 나온다 —
 *   C1: 리디렉션을 `fetch` 가 **자기 안에서** 따라가서 각 홉이 `waitForSlot` 을 안 거친다.
 *   C2: 오류 응답의 본문을 안 버려서 **연결이 열린 채** 다음 요청이 나간다.
 * 그래서 로컬 `node:http` 서버(127.0.0.1 · 외부 요청 0)에 **기본 `fetchImpl`(= 네이티브 fetch)** 로 붙는다.
 * ⚠시계와 `sleep` 은 가상이다 — 간격은 「홉마다 `sleep(minDelayMs)` 가 불렸는가」로 잰다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MAX_REDIRECTS, PoliteFetcher } from "../src/fetcher.ts";

const MIN = 2000;

function harness() {
  let t = Date.parse("2026-09-26T00:00:00Z");
  const sleeps: number[] = [];
  return {
    clock: { now: () => new Date(t) },
    sleeps,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}

function fetcherWith(h: ReturnType<typeof harness>, maxRetries = 3): PoliteFetcher {
  return new PoliteFetcher({ userAgent: "bb-test", minDelayMs: MIN, maxRetries, clock: h.clock, sleep: h.sleep });
}

test("⚠C1 같은 출처의 302→302→200 은 홉마다 L1 간격을 지킨다", async () => {
  const hits: string[] = [];
  const { server, origin } = await listen((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/a") return void res.writeHead(302, { location: "/b" }).end();
    if (req.url === "/b") return void res.writeHead(302, { location: `${origin}/c` }).end();
    res.writeHead(200, { "content-type": "text/html" }).end("OK");
  });
  try {
    const h = harness();
    const r = await fetcherWith(h).get(`${origin}/a`);
    assert.deepEqual(hits, ["/a", "/b", "/c"]);
    assert.equal(r.status, 200);
    assert.equal(new TextDecoder().decode(r.body!), "OK");
    // 첫 요청은 기다릴 것이 없다. 뒤의 두 홉은 각각 한 간격씩 기다려야 한다
    assert.deepEqual(h.sleeps, [MIN, MIN], "리디렉션 홉이 waitForSlot 을 거치지 않았다(L1 우회)");
  } finally {
    await close(server);
  }
});

test("⚠C1 다른 출처로의 리디렉션은 따라가지 않는다 — 본문 없는 3xx 로 돌려준다", async () => {
  let otherHits = 0;
  const other = await listen((_req, res) => {
    otherHits += 1;
    res.writeHead(200).end("ELSEWHERE");
  });
  const { server, origin } = await listen((_req, res) => {
    res.writeHead(302, { location: `${other.origin}/x` }).end();
  });
  try {
    const r = await fetcherWith(harness()).get(`${origin}/a`);
    assert.equal(r.status, 302);
    assert.equal(r.body, null);
    assert.equal(otherHits, 0, "다른 출처에는 요청이 나가면 안 된다");
  } finally {
    await close(server);
    await close(other.server);
  }
});

test("⚠C1 홉 수에 상한이 있다", async () => {
  const hits: string[] = [];
  const { server, origin } = await listen((req, res) => {
    hits.push(req.url ?? "");
    const n = Number((req.url ?? "/r0").slice(2));
    res.writeHead(302, { location: `/r${n + 1}` }).end();
  });
  try {
    const r = await fetcherWith(harness()).get(`${origin}/r0`);
    assert.equal(r.status, 302);
    assert.equal(r.body, null);
    assert.equal(hits.length, 1 + MAX_REDIRECTS, "첫 요청 + 상한만큼의 홉");
  } finally {
    await close(server);
  }
});

/** 본문을 반쯤 보내고 끝내지 않는 응답 — 받는 쪽이 버리지 않으면 연결이 열린 채 남는다 */
async function openErrorServer(status: number) {
  const events: string[] = [];
  const { server, origin } = await listen((req, res) => {
    const n = events.filter((e) => e.startsWith("req")).length + 1;
    events.push(`req${n}`);
    res.on("close", () => events.push(`close${n}`));
    if (n === 1) {
      res.writeHead(status, { "content-type": "text/plain" });
      res.write("partial body …");
      return; // 끝내지 않는다
    }
    res.writeHead(200).end("OK");
  });
  return { server, origin, events };
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

test("⚠C2 재시도할 오류(429)의 본문을 버린다 — 열린 응답을 남기지 않는다", async () => {
  const s = await openErrorServer(429);
  try {
    const r = await fetcherWith(harness(), 1).get(`${s.origin}/a`);
    assert.equal(r.status, 200);
    assert.ok(await waitFor(() => s.events.includes("close1"), 1500), `첫 429 응답이 닫히지 않았다: ${s.events.join(",")}`);
  } finally {
    await close(s.server);
  }
});

test("⚠C2 재시도하지 않는 오류(404)의 본문도 버린다", async () => {
  const s = await openErrorServer(404);
  try {
    const r = await fetcherWith(harness()).get(`${s.origin}/a`);
    assert.equal(r.status, 404);
    assert.equal(r.body, null);
    assert.ok(await waitFor(() => s.events.includes("close1"), 1500), `404 응답이 닫히지 않았다: ${s.events.join(",")}`);
  } finally {
    await close(s.server);
  }
});
