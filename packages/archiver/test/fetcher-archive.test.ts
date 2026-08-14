import { test } from "node:test";
import assert from "node:assert/strict";
import { PoliteFetcher, buildUserAgent } from "../src/fetcher.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import { MemorySink } from "../src/sink.ts";
import { MonthlyScheduleCache, archiveDate, archiveDates, archivePage, isDayError, summarize } from "../src/archive.ts";
import { NoGamesFoundError } from "../src/discover.ts";

// ---- 테스트 하네스 -------------------------------------------------------

/** 가상 시계. sleep이 시간을 실제로 전진시키므로 지연 로직을 실측할 수 있다. */
function harness() {
  let t = Date.parse("2026-08-14T13:00:00Z");
  return {
    clock: { now: () => new Date(t) },
    sleeps: [] as number[],
    sleep(this: { sleeps: number[] }, ms: number) {
      this.sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

function response(status: number, body = "", headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/** 요청 헤더를 기록하면서 라우팅하는 가짜 fetch. */
function recorder(route: (url: string, n: number) => ReturnType<typeof response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return route(url, calls.length);
  };
  return { impl, calls };
}

const MONTHLY = `<a href="/scores/2026/0814/s-db-17/">g1</a><a href="/scores/2026/0813/h-m-17/">g2</a>`;
const REF = { season: 2026, date: "2026-08-14", slug: "s-db-17", path: "/scores/2026/0814/s-db-17/" };

// ---- PoliteFetcher -------------------------------------------------------

test("UA에 연락처가 없으면 만들어지지 않는다 (L1)", () => {
  assert.throws(() => buildUserAgent(""), /연락처/);
  assert.throws(() => buildUserAgent("   "), /연락처/);
  assert.match(buildUserAgent("me@example.com"), /me@example\.com/);
});

test("첫 요청에는 조건부 헤더가 붙지 않는다", async () => {
  const h = harness();
  const r = recorder(() => response(200, "ok"));
  const f = new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: r.impl, sleep: h.sleep.bind(h) });

  await f.get("https://npb.jp/a");
  assert.equal(r.calls[0]?.headers["If-None-Match"], undefined);
  assert.equal(r.calls[0]?.headers["User-Agent"], "ua");
});

test("이전 메타가 있으면 조건부 헤더를 보낸다 (L7)", async () => {
  const h = harness();
  const r = recorder(() => response(304));
  const f = new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: r.impl, sleep: h.sleep.bind(h) });

  await f.get("https://npb.jp/a", { etag: 'W/"abc"', lastModified: "Fri, 14 Aug 2026 13:00:00 GMT" });
  assert.equal(r.calls[0]?.headers["If-None-Match"], 'W/"abc"');
  assert.equal(r.calls[0]?.headers["If-Modified-Since"], "Fri, 14 Aug 2026 13:00:00 GMT");
});

test("304는 본문 없음이며 실패가 아니다", async () => {
  const h = harness();
  const r = recorder(() => response(304));
  const f = new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: r.impl, sleep: h.sleep.bind(h) });

  const res = await f.get("https://npb.jp/a", { etag: "e" });
  assert.equal(res.status, 304);
  assert.equal(res.body, null);
  assert.equal(res.etag, "e", "304는 이전 etag를 유지한다");
});

test("요청 간 최소 간격을 지킨다 (L1)", async () => {
  const h = harness();
  const r = recorder(() => response(200, "ok"));
  const f = new PoliteFetcher({
    userAgent: "ua",
    minDelayMs: 3000,
    clock: h.clock,
    fetchImpl: r.impl,
    sleep: h.sleep.bind(h),
  });

  await f.get("https://npb.jp/a");
  await f.get("https://npb.jp/b");
  assert.deepEqual(h.sleeps, [3000], "두 번째 요청 전에 3초를 기다려야 한다");
});

test("이미 충분히 지났으면 기다리지 않는다", async () => {
  const h = harness();
  const r = recorder(() => response(200, "ok"));
  const f = new PoliteFetcher({
    userAgent: "ua",
    minDelayMs: 3000,
    clock: h.clock,
    fetchImpl: r.impl,
    sleep: h.sleep.bind(h),
  });

  await f.get("https://npb.jp/a");
  h.advance(5000);
  await f.get("https://npb.jp/b");
  assert.deepEqual(h.sleeps, []);
});

test("404는 재시도하지 않는다 — 사실이기 때문", async () => {
  const h = harness();
  const r = recorder(() => response(404));
  const f = new PoliteFetcher({
    userAgent: "ua",
    maxRetries: 3,
    clock: h.clock,
    fetchImpl: r.impl,
    sleep: h.sleep.bind(h),
  });

  const res = await f.get("https://npb.jp/none");
  assert.equal(res.status, 404);
  assert.equal(r.calls.length, 1, "404를 4번 두드리는 것은 무례하고 무의미하다");
});

test("503은 지수 백오프로 재시도한 뒤 예외를 던진다", async () => {
  const h = harness();
  const r = recorder(() => response(503));
  const f = new PoliteFetcher({
    userAgent: "ua",
    minDelayMs: 1000,
    maxRetries: 2,
    clock: h.clock,
    fetchImpl: r.impl,
    sleep: h.sleep.bind(h),
  });

  await assert.rejects(() => f.get("https://npb.jp/a"), /취득 실패/);
  assert.equal(r.calls.length, 3, "최초 1회 + 재시도 2회");
  assert.deepEqual(h.sleeps.slice(0, 3), [1000, 2000, 4000], "백오프가 지수적으로 늘어야 한다");
});

test("동시에 불러도 직렬화된다 — 동시 1커넥션 (L1)", async () => {
  const h = harness();
  let inFlight = 0;
  let maxInFlight = 0;
  const impl: FetchImpl = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return response(200, "ok");
  };
  const f = new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: impl, sleep: h.sleep.bind(h) });

  await Promise.all([f.get("https://npb.jp/a"), f.get("https://npb.jp/b"), f.get("https://npb.jp/c")]);
  assert.equal(maxInFlight, 1);
});

// ---- archivePage ---------------------------------------------------------

function fetcherFor(h: ReturnType<typeof harness>, route: (url: string, n: number) => ReturnType<typeof response>) {
  const r = recorder(route);
  return {
    fetcher: new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: r.impl, sleep: h.sleep.bind(h) }),
    calls: r.calls,
  };
}

test("200이면 저장한다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, () => response(200, "<html>試合</html>", { etag: '"v1"' }));

  const res = await archivePage(REF, "playbyplay.html", { fetcher, sink, clock: h.clock });
  assert.equal(res.outcome, "stored");
  assert.equal(sink.writeCount, 1);

  const meta = await sink.readMeta("npb/scores/2026/0814/s-db-17/playbyplay");
  assert.equal(meta?.revision, 1);
  assert.equal(meta?.etag, '"v1"');
  assert.equal(meta?.fetchedAt, "2026-08-14T13:00:00.000Z", "주입된 시계를 쓴다 (M6)");
});

test("⚠M5 멱등: 내용이 같으면 두 번째 실행은 쓰지 않는다", async () => {
  const h = harness();
  const sink = new MemorySink();
  // 서버가 조건부 요청을 무시하고 매번 200 + 같은 본문을 준다고 가정한다.
  const { fetcher } = fetcherFor(h, () => response(200, "<html>同じ</html>"));
  const deps = { fetcher, sink, clock: h.clock };

  const first = await archivePage(REF, "box.html", deps);
  const second = await archivePage(REF, "box.html", deps);

  assert.equal(first.outcome, "stored");
  assert.equal(second.outcome, "unchanged");
  assert.equal(sink.writeCount, 1, "같은 내용을 두 번 쓰면 revision이 헛돈다");
});

test("내용이 바뀌면 revision이 오른다 (M4)", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, (_u, n) => response(200, n === 1 ? "<html>1回</html>" : "<html>9回</html>"));
  const deps = { fetcher, sink, clock: h.clock };

  await archivePage(REF, "playbyplay.html", deps);
  const second = await archivePage(REF, "playbyplay.html", deps);

  assert.equal(second.outcome, "stored");
  assert.equal((await sink.readMeta("npb/scores/2026/0814/s-db-17/playbyplay"))?.revision, 2);
});

test("304면 변경없음이고 쓰기가 없다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, (_u, n) => (n === 1 ? response(200, "x", { etag: '"e"' }) : response(304)));
  const deps = { fetcher, sink, clock: h.clock };

  await archivePage(REF, "", deps);
  const second = await archivePage(REF, "", deps);
  assert.equal(second.outcome, "unchanged");
  assert.equal(sink.writeCount, 1);
});

test("404는 실패가 아니라 부재다 (M11)", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, () => response(404));

  const res = await archivePage(REF, "roster.html", { fetcher, sink, clock: h.clock });
  assert.equal(res.outcome, "absent");
  assert.equal(res.status, 404);
  assert.equal(res.error, null);
  assert.equal(sink.writeCount, 0);
});

test("취득이 끝내 실패해도 예외로 터지지 않고 결과에 남는다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, () => response(503));

  const res = await archivePage(REF, "box.html", { fetcher, sink, clock: h.clock });
  assert.equal(res.outcome, "failed");
  assert.ok(res.error);
  assert.equal(sink.writeCount, 0, "실패한 페이지를 빈 값으로 저장하면 안 된다");
});

// ---- archiveDate ---------------------------------------------------------

function routeDay(url: string): ReturnType<typeof response> {
  if (url.includes("schedule_08_detail")) return response(200, MONTHLY);
  return response(200, `<html>${url}</html>`);
}

test("경기일의 전 경기 × 4페이지를 보존한다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, routeDay);

  const day = await archiveDate("2026-08-14", { fetcher, sink, clock: h.clock });
  assert.equal(day.gamesFound, 1, "픽스처에서 8/14 경기는 1건");
  assert.equal(day.pages.length, 4);
  assert.deepEqual(summarize(day.pages), { stored: 4, unchanged: 0, absent: 0, failed: 0, total: 4 });
});

test("경기가 없는 날은 0건이고 이것은 오류가 아니다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, routeDay);

  const day = await archiveDate("2026-08-12", { fetcher, sink, clock: h.clock });
  assert.equal(day.gamesFound, 0);
  assert.deepEqual(day.pages, []);
});

test("⚠M7: 일정 페이지 구조가 바뀌면 빈 결과가 아니라 예외가 올라온다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, (url) =>
    url.includes("schedule_08_detail") ? response(200, "<div>新レイアウト</div>") : response(200, "x"),
  );

  await assert.rejects(
    () => archiveDate("2026-08-14", { fetcher, sink, clock: h.clock }),
    NoGamesFoundError,
    "조용히 0건으로 넘기면 그날이 영구히 빈 아카이브로 남는다",
  );
});

test("일정 페이지를 못 받으면 예외 — 경기 0건으로 위장하지 않는다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, (url) => (url.includes("schedule") ? response(404) : response(200, "x")));

  await assert.rejects(() => archiveDate("2026-08-14", { fetcher, sink, clock: h.clock }), /월간 일정을 받지 못했다/);
});

// ---- MonthlyScheduleCache / archiveDates ---------------------------------

const JULY = `<a href="/scores/2026/0704/t-c-9/">g</a>`;

function routeMonths(url: string): ReturnType<typeof response> {
  if (url.includes("schedule_08_detail")) return response(200, MONTHLY);
  if (url.includes("schedule_07_detail")) return response(200, JULY);
  return response(200, `<html>${url}</html>`);
}

test("⚠L1: 같은 달의 여러 날을 돌려도 월간 일정은 1회만 받는다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher, calls } = fetcherFor(h, routeMonths);
  const schedule = new MonthlyScheduleCache();

  await archiveDates(["2026-08-12", "2026-08-13", "2026-08-14"], { fetcher, sink, clock: h.clock, schedule });

  assert.equal(schedule.fetchCount, 1, "날짜마다 다시 받으면 167일 백필에서 167번이 된다");
  const scheduleCalls = calls.filter((c) => c.url.includes("schedule_08_detail"));
  assert.equal(scheduleCalls.length, 1);
});

test("달이 바뀌면 그 달만 새로 받는다", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, routeMonths);
  const schedule = new MonthlyScheduleCache();

  await archiveDates(["2026-07-04", "2026-08-14", "2026-07-05"], { fetcher, sink, clock: h.clock, schedule });
  assert.equal(schedule.fetchCount, 2, "7월·8월 각 1회");
});

test("발견의 출처인 일정 페이지 자체도 보존한다 (M4)", async () => {
  const h = harness();
  const sink = new MemorySink();
  const { fetcher } = fetcherFor(h, routeMonths);

  await archiveDates(["2026-08-14"], { fetcher, sink, clock: h.clock });
  const meta = await sink.readMeta("npb/games/2026/schedule_08");
  assert.ok(meta, "이 경기 목록이 어디서 나왔는지 답할 수 있어야 한다");
  assert.equal(meta.url, "https://npb.jp/games/2026/schedule_08_detail.html");
});

test("하루가 통째로 실패해도 나머지 날짜는 계속 진행한다", async () => {
  const h = harness();
  const sink = new MemorySink();
  // 8월 일정은 정상, 7월 일정은 구조 파손 → 7월 날짜만 ERROR가 되어야 한다.
  const { fetcher } = fetcherFor(h, (url) => {
    if (url.includes("schedule_07_detail")) return response(200, "<div>新レイアウト</div>");
    return routeMonths(url);
  });

  const days = await archiveDates(["2026-07-04", "2026-08-14"], { fetcher, sink, clock: h.clock });

  assert.equal(days.length, 2);
  assert.ok(isDayError(days[0]!), "7월은 ERROR");
  assert.ok(!isDayError(days[1]!), "8월은 계속 진행되어야 한다");
  assert.equal(sink.writeCount > 0, true, "5시간짜리 백필이 3일차에서 멈추면 앞의 이틀도 헛수고다");
});

test("⚠실패한 달 조회가 캐시에 갇히지 않는다 — 갇히면 그 달 전체가 날아간다", async () => {
  const h = harness();
  const sink = new MemorySink();
  let attempt = 0;
  // maxRetries 기본 3 → 1회 시도 + 3회 재시도 = 4회. 그 뒤부터 성공시킨다.
  const { fetcher } = fetcherFor(h, (url) => {
    if (url.includes("schedule_08_detail")) {
      attempt += 1;
      return attempt <= 4 ? response(503) : response(200, MONTHLY);
    }
    return response(200, "x");
  });

  // **같은 캐시**로 두 번 돌린다. 실패가 캐시에 남으면 두 번째도 같은 실패를 되풀이한다.
  const schedule = new MonthlyScheduleCache();
  const deps = { fetcher, sink, clock: h.clock, schedule };

  const first = await archiveDates(["2026-08-14"], deps);
  assert.ok(isDayError(first[0]!), "재시도를 소진했으므로 첫 시도는 ERROR");

  const second = await archiveDates(["2026-08-14"], deps);
  assert.ok(!isDayError(second[0]!), "같은 캐시로도 회복되어야 한다");
  assert.equal(schedule.fetchCount, 2, "실패한 조회는 캐시에서 지워지고 다시 시도된다");
});

test("summarize는 분모를 함께 낸다 (작업규칙 7)", () => {
  const s = summarize([
    { key: "a", url: "u", outcome: "stored", status: 200, error: null },
    { key: "b", url: "u", outcome: "unchanged", status: 304, error: null },
    { key: "c", url: "u", outcome: "absent", status: 404, error: null },
    { key: "d", url: "u", outcome: "failed", status: null, error: "boom" },
  ]);
  assert.deepEqual(s, { stored: 1, unchanged: 1, absent: 1, failed: 1, total: 4 });
});
