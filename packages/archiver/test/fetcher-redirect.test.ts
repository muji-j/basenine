/**
 * 리디렉션과 오류 응답이 **예의(L1)를 새지 않는가** — 2026-09-25 감사 C1·C2.
 *
 * ⚠**가짜 `fetchImpl` 로는 못 잰다.** 두 결함 모두 **네이티브 `fetch` 의 동작**에서 나온다 —
 *   C1: 리디렉션을 `fetch` 가 **자기 안에서** 따라가서 각 홉이 `waitForSlot` 을 안 거친다.
 *   C2: 오류 응답의 본문을 안 버려서 **연결이 열린 채** 다음 요청이 나간다.
 * 그래서 로컬 `node:http` 서버(127.0.0.1 · 외부 요청 0)에 **기본 `fetchImpl`(= 네이티브 fetch)** 로 붙는다.
 * ⚠시계와 `sleep` 은 가상이다 — 간격은 「홉마다 `sleep(minDelayMs)` 가 불렸는가」로 잰다.
 * ⚠**C2 는 순서로 잰다** — 「첫 응답의 연결이 **다음 요청이 서버에 닿기 전에** 닫혔는가」.
 *   「결국 닫혔는가」만 보면 버리기를 성공 직전으로 미룬 변이가 살아남는다(3중 검토 2차 실측 m7·m9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MAX_REDIRECTS, PoliteFetcher } from "../src/fetcher.ts";

const MIN = 2000;

/**
 * 가상 시계 + 가상 `sleep`. `pause` 를 주면 `sleep` 마다 **실제로도** 그것을 기다린다 —
 * C2 에서 버린 연결의 닫힘이 서버에 도착할 틈을 준다(가상 `sleep` 은 즉시 돌아와 그 틈이 없다).
 */
function harness(pause?: () => Promise<void>) {
  let t = Date.parse("2026-09-26T00:00:00Z");
  const sleeps: number[] = [];
  return {
    clock: { now: () => new Date(t) },
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      if (pause) await pause();
    },
  };
}

/**
 * `ready()` 가 참이 될 때까지 실제로 기다린다. ⚠**시계를 안 읽고 횟수로 끊는다**(M6 ·
 * `scripts/test/clock-injection.test.ts`) — 상한(약 2초)을 넘기면 그냥 돌아가고, 판정은 호출자의 단언이 한다.
 */
async function settle(ready: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries && !ready(); i += 1) await new Promise((r) => setTimeout(r, 20));
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

test("C1 퍼센트 인코딩 없는 UTF-8 Location 도 네이티브 fetch 처럼 읽는다", async () => {
  const hits: string[] = [];
  const { server, origin } = await listen((req, res) => {
    hits.push(req.url ?? "");
    // 규약 위반 서버를 흉내 낸다 — UTF-8 바이트를 헤더에 그대로(Node 는 헤더를 latin1 로 쓴다)
    if (req.url === "/a") return void res.writeHead(302, { location: Buffer.from("/選手", "utf8").toString("latin1") }).end();
    res.writeHead(200).end("OK");
  });
  try {
    const r = await fetcherWith(harness()).get(`${origin}/a`);
    assert.deepEqual(hits, ["/a", encodeURI("/選手")], "이중 인코딩된 주소로 갔다");
    assert.equal(r.status, 200);
  } finally {
    await close(server);
  }
});

test("C1 형식이 깨진 Location 은 재시도하지 않고 본문 없는 3xx 로 돌려준다", async () => {
  let hits = 0;
  const { server, origin } = await listen((_req, res) => {
    hits += 1;
    res.writeHead(302, { location: "http://[bad" }).end();
  });
  try {
    const h = harness();
    const r = await fetcherWith(h).get(`${origin}/a`);
    assert.equal(r.status, 302);
    assert.equal(r.body, null);
    assert.equal(hits, 1, "같은 헤더가 또 올 뿐인데 재시도했다");
    assert.deepEqual(h.sleeps, [], "백오프를 잤다 — 일시 오류로 읽었다");
  } finally {
    await close(server);
  }
});

/**
 * 첫 응답만 본문을 반쯤 보내고 끝내지 않는 서버 — 받는 쪽이 버리지 않으면 **그 연결이 열린 채** 남는다.
 * `events` 는 서버가 본 순서다: `reqN` = N번째 요청 도착 · `closeN` = 그 요청이 탄 연결이 닫힘.
 */
async function halfOpenServer(status: number, headers: Record<string, string> = {}) {
  const events: string[] = [];
  const { server, origin } = await listen((req, res) => {
    const n = events.filter((e) => e.startsWith("req")).length + 1;
    events.push(`req${n}`);
    req.socket.once("close", () => events.push(`close${n}`));
    if (n === 1) {
      res.writeHead(status, { "content-type": "text/plain", ...headers });
      res.write("partial body …");
      return; // 끝내지 않는다
    }
    res.writeHead(200).end("OK");
  });
  return { server, origin, events, firstClosed: () => events.includes("close1") };
}

/** ⚠L1 「동시 1커넥션」 — 첫 응답의 연결이 **두 번째 요청이 닿기 전에** 닫혔는가 */
function assertClosedBeforeNext(events: string[]): void {
  const closed = events.indexOf("close1");
  const next = events.indexOf("req2");
  assert.notEqual(next, -1, `두 번째 요청이 안 왔다: ${events.join(",")}`);
  assert.ok(closed !== -1 && closed < next, `첫 응답이 열린 채 다음 요청이 나갔다(동시 1커넥션 위반): ${events.join(",")}`);
}

test("⚠C2 재시도할 오류(429)의 본문을 버린다 — 다음 시도 전에 연결이 닫힌다", async () => {
  const s = await halfOpenServer(429);
  try {
    const r = await fetcherWith(harness(() => settle(s.firstClosed)), 1).get(`${s.origin}/a`);
    assert.equal(r.status, 200);
    assertClosedBeforeNext(s.events);
  } finally {
    await close(s.server);
  }
});

test("⚠C2 재시도하지 않는 오류(404)의 본문도 버린다 — 다음 요청 전에 연결이 닫힌다", async () => {
  const s = await halfOpenServer(404);
  try {
    const f = fetcherWith(harness(() => settle(s.firstClosed)));
    const r = await f.get(`${s.origin}/a`);
    assert.equal(r.status, 404);
    assert.equal(r.body, null);
    assert.equal((await f.get(`${s.origin}/b`)).status, 200);
    assertClosedBeforeNext(s.events);
  } finally {
    await close(s.server);
  }
});

test("⚠C2 리디렉션 홉의 본문도 버린다 — 다음 홉 전에 연결이 닫힌다", async () => {
  const s = await halfOpenServer(302, { location: "/b" });
  try {
    const r = await fetcherWith(harness(() => settle(s.firstClosed))).get(`${s.origin}/a`);
    assert.equal(r.status, 200);
    assertClosedBeforeNext(s.events);
  } finally {
    await close(s.server);
  }
});
