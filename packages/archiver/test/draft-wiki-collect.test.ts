/**
 * ja.wikipedia 드래프트 수집기 — **네트워크를 안 친다.**
 *
 * ⚠**여기서 실사이트를 치면 안 된다**(작업규칙 11 · L1). 2026-09-05 에 npb 쪽에서 실제로
 * 그 사고가 났다 — 「이게 실사이트를 친다」를 **증명하는 시험**이 그 빨간 상태에서
 * **222페이지를 0.583초 간격으로 받아 버렸다**(런북 §5). 그래서 이 파일은 `fetchImpl` 과
 * `sleep` 을 **둘 다** 주입하고, 진짜 `PoliteFetcher` 를 스폰하는 본을 두지 않는다.
 *
 * ⚠**이 소스는 npb 와 예의의 성질이 다르다** — `Last-Modified` 를 주므로(19/19 실측)
 * **조건부 요청이 실제로 절약한다.** 그게 안 걸리면 매년 22장을 통째로 다시 받는다(L7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_WIKI_LICENSE, collectDraftWiki, draftWikiKey, draftWikiUrl } from "../src/draft-wiki.ts";
import { PoliteFetcher } from "../src/fetcher.ts";
import { MemorySink } from "../src/sink.ts";
import { fixedClock } from "../src/clock.ts";

const NOW = "2026-09-06T00:00:00.000Z";

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function deps(reply: (url: string, headers: Record<string, string>) => { status: number; body?: string; lastModified?: string }) {
  const calls: Call[] = [];
  const sink = new MemorySink();
  const clock = fixedClock(NOW);
  const fetcher = new PoliteFetcher({
    userAgent: "test-ua (contact@lunomel.test)",
    minDelayMs: 3000,
    clock,
    // ⚠**둘 다 주입한다** — `sleep` 만 목으로 두면 간격이 진짜로 걸려 시험이 느려지고,
    //   `fetchImpl` 만 두면 실사이트를 칠 위험이 남는다.
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      const r = reply(url, init.headers);
      const bytes = new TextEncoder().encode(r.body ?? "");
      return {
        status: r.status,
        headers: {
          get: (n: string) => (n.toLowerCase() === "last-modified" ? (r.lastModified ?? null) : null),
        },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    },
  });
  return { calls, sink, clock, archive: { fetcher, sink, clock } };
}

test("아카이브 키는 `wikipedia/draft/{year}` — ⚠`npb/` 아래에 두지 않는다(출처·라이선스가 다르다)", () => {
  assert.equal(draftWikiKey(2025), "wikipedia/draft/2025");
  assert.doesNotMatch(draftWikiKey(2025), /^npb\//u);
  assert.equal(draftWikiUrl(2025), "https://ja.wikipedia.org/wiki/2025年度新人選手選択会議_(日本プロ野球)");
});

test("연도 범위만큼 정확히 받는다 — ⚠분모가 곧 요청 수다(L1·M8)", async () => {
  const d = deps(() => ({ status: 200, body: "<html>x</html>", lastModified: "Sat, 22 Aug 2026 01:14:48 GMT" }));
  const r = await collectDraftWiki({ from: 2023, to: 2025 }, d.archive);
  assert.deepEqual(r.yearsAttempted, [2023, 2024, 2025]);
  assert.equal(d.calls.length, 3, "요청 수가 연도 수와 다르다");
  assert.deepEqual(r.pages.map((p) => p.outcome), ["stored", "stored", "stored"]);
});

test("⚠`/wiki/` 만 친다 — `/w/`·`/api/` 는 robots Disallow 다", async () => {
  const d = deps(() => ({ status: 200, body: "<html>x</html>" }));
  await collectDraftWiki({ from: 2005, to: 2010 }, d.archive);
  assert.equal(d.calls.length, 6);
  for (const c of d.calls) {
    assert.match(c.url, /^https:\/\/ja\.wikipedia\.org\/wiki\//u, `robots 위반 경로: ${c.url}`);
    assert.doesNotMatch(c.url, /\/w\/|\/api\/|action=raw/u);
  }
});

test("⚠식별 가능한 UA 가 매 요청에 붙는다(L1)", async () => {
  const d = deps(() => ({ status: 200, body: "<html>x</html>" }));
  await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  assert.equal(d.calls[0]?.headers["User-Agent"], "test-ua (contact@lunomel.test)");
});

test("⚠두 번째 실행은 `If-Modified-Since` 를 보낸다 — 이 소스는 조건부 요청이 실제로 통한다(L7)", async () => {
  const LM = "Sat, 22 Aug 2026 01:14:48 GMT";
  let served = 0;
  const d = deps((_url, headers) => {
    served += 1;
    if (headers["If-Modified-Since"] === LM) return { status: 304 };
    return { status: 200, body: "<html>x</html>", lastModified: LM };
  });
  const first = await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  assert.equal(first.pages[0]?.outcome, "stored");
  assert.equal(d.calls[0]?.headers["If-Modified-Since"], undefined, "첫 요청에 조건부 헤더가 붙었다");

  const second = await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  assert.equal(d.calls[1]?.headers["If-Modified-Since"], LM, "재취득에 If-Modified-Since 가 안 붙었다");
  assert.equal(second.pages[0]?.outcome, "unchanged");
  assert.equal(served, 2);
  // ⚠**멱등**(M5) — 본문을 다시 쓰지 않는다
  assert.equal(d.sink.writeCount, 1, "내용이 같은데 본문을 다시 썼다");
});

test("⚠라이선스가 사이드카에 남는다 — 아카이브만 보고도 다룰 조건을 알 수 있어야 한다(M4·L3)", async () => {
  const d = deps(() => ({ status: 200, body: "<html>x</html>", lastModified: "Sat, 22 Aug 2026 01:14:48 GMT" }));
  await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  const meta = await d.sink.readMeta(draftWikiKey(2024));
  assert.equal(meta?.license, DRAFT_WIKI_LICENSE);
  assert.equal(meta?.url, draftWikiUrl(2024));
  assert.equal(meta?.lastModified, "Sat, 22 Aug 2026 01:14:48 GMT");
  assert.equal(meta?.fetchedAt, NOW);
});

test("⚠`unchanged` 경로에도 라이선스가 붙는다 — 안 그러면 첫 실행에서 빠뜨린 값이 영영 안 들어간다", async () => {
  const LM = "Sat, 22 Aug 2026 01:14:48 GMT";
  const d = deps((_u, h) => (h["If-Modified-Since"] === LM ? { status: 304 } : { status: 200, body: "<html>x</html>", lastModified: LM }));
  await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  // 라이선스가 없던 옛 사이드카를 흉내낸다
  const prev = (await d.sink.readMeta(draftWikiKey(2024)))!;
  const { license, ...withoutLicense } = prev;
  void license;
  await d.sink.writeMeta(draftWikiKey(2024), withoutLicense);
  assert.equal((await d.sink.readMeta(draftWikiKey(2024)))?.license, undefined);

  await collectDraftWiki({ from: 2024, to: 2024 }, d.archive);
  assert.equal(
    (await d.sink.readMeta(draftWikiKey(2024)))?.license,
    DRAFT_WIKI_LICENSE,
    "304 로 돌아온 판에 라이선스가 안 붙었다 — 이 소스는 두 번째부터 늘 304 다",
  );
});

test("⚠404 는 실패가 아니라 `absent` 다 — 개최 전과 취득 실패를 섞지 않는다(M11)", async () => {
  const d = deps((url) => (url.includes("2026") ? { status: 404 } : { status: 200, body: "<html>x</html>" }));
  const r = await collectDraftWiki({ from: 2025, to: 2026 }, d.archive);
  assert.deepEqual(r.pages.map((p) => p.outcome), ["stored", "absent"]);
});

test("⚠한 해가 실패해도 다음 해를 계속 받는다 — 부분 실패를 삼키지 않는다", async () => {
  const d = deps((url) => (url.includes("2024") ? { status: 500 } : { status: 200, body: "<html>x</html>" }));
  const r = await collectDraftWiki({ from: 2023, to: 2025 }, d.archive);
  assert.equal(r.pages.length, 3);
  assert.equal(r.pages[1]?.outcome, "failed");
  assert.deepEqual([r.pages[0]?.outcome, r.pages[2]?.outcome], ["stored", "stored"]);
});

test("`--only` 는 범위 안에서 한 해만 받는다", async () => {
  const d = deps(() => ({ status: 200, body: "<html>x</html>" }));
  const r = await collectDraftWiki({ from: 2005, to: 2026, only: 2024 }, d.archive);
  assert.deepEqual(r.yearsAttempted, [2024]);
  assert.equal(d.calls.length, 1);
});
