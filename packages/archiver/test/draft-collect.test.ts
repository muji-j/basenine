/**
 * 드래프트 수집 — **외부 요청 0회**. 가짜 fetch 와 메모리 sink 로만 잰다(작업규칙 11).
 *
 * ⚠**하네스 관용은 `fetcher-archive.test.ts` 를 따른다**(가상 시계 · `recorder` · `MemorySink`).
 *
 * ⚠**발견 계열은 실물 픽스처로 잰다.** 합성 HTML 로만 맞추면 「전부 초록인데 실물에서 0건」이
 * 난다 — 이 저장소가 실제로 당한 사고다(CLAUDE.md §2 구형 박스 픽스처: 결과 칸이 0개여서
 * 구형 경로가 **항상 빈 배열**이었는데 시험은 전부 통과했다).
 * 픽스처는 파서 패키지가 소유한다(`packages/parser/test/fixtures/README.md` 에 출처·취득일).
 * ⚠**합성 HTML 은 「실물에 없는 상태」를 강제할 때만 쓴다**(구조 붕괴 등).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { MemorySink } from "../src/sink.ts";
import { PoliteFetcher } from "../src/fetcher.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import {
  BACKNUMBER_KEY,
  BACKNUMBER_URL,
  DraftCollectError,
  collectDraft,
  draftTargets,
  teamPageUrl,
  yearIndexUrl,
} from "../src/draft.ts";

// ---- 하네스 ---------------------------------------------------------------

/** 실물 픽스처. ⚠**파서 패키지가 소유한다** — 옮기면 여기가 시끄럽게 깨진다(그게 맞다). */
const fixture = (name: string): string =>
  gunzipSync(
    readFileSync(fileURLToPath(new URL(`../../parser/test/fixtures/${name}.html.gz`, import.meta.url))),
  ).toString("utf8");

/** 가상 시계. sleep 이 시간을 전진시키므로 L1 간격을 실측할 수 있다. */
function harness() {
  let t = Date.parse("2026-09-05T00:00:00Z");
  return {
    clock: { now: () => new Date(t) },
    sleeps: [] as number[],
    sleep(this: { sleeps: number[] }, ms: number) {
      this.sleeps.push(ms);
      t += ms;
      return Promise.resolve();
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

function recorder(route: (url: string, n: number) => ReturnType<typeof response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return route(url, calls.length);
  };
  return { impl, calls };
}

function depsFor(h: ReturnType<typeof harness>, route: (url: string, n: number) => ReturnType<typeof response>) {
  const r = recorder(route);
  const sink = new MemorySink();
  return {
    deps: {
      fetcher: new PoliteFetcher({ userAgent: "ua", clock: h.clock, fetchImpl: r.impl, sleep: h.sleep.bind(h) }),
      sink,
      clock: h.clock,
    },
    sink,
    calls: r.calls,
  };
}

/**
 * 실물 픽스처로 답하는 라우터. 2013(`bs`)·2024(`b`)·2026(개최 전)만 실재하고,
 * 그 밖의 연도 톱은 404 다 — **부재가 실재한다**(M11).
 */
function realRoute(url: string): ReturnType<typeof response> {
  if (url === BACKNUMBER_URL) return response(200, fixture("draft-backnumber"));
  if (url === yearIndexUrl(2013)) return response(200, fixture("draft-2013-index"));
  if (url === yearIndexUrl(2024)) return response(200, fixture("draft-2024-index"));
  if (url === yearIndexUrl(2026)) return response(200, fixture("draft-2026-index"));
  if (/\/draftlist_[a-z]+\.html$/.test(url)) return response(200, `<html>${url}</html>`);
  return response(404);
}

// ---- 순수 부분: 대상 목록 --------------------------------------------------

test("⚠연도 톱과 구단 페이지가 2단계로 발견된다 — 슬러그를 하드코딩하지 않는다(A3)", () => {
  const targets = draftTargets({ years: [2013], slugsByYear: new Map([[2013, ["bs", "g"]]]) });
  assert.deepEqual(
    targets.map((t) => t.key),
    ["npb/draft/2013/bs", "npb/draft/2013/g"],
    "⚠2013 오릭스는 bs 다 — b 로 박으면 그 구단이 통째로 빈다",
  );
  assert.equal(targets[0]!.url, "https://draft.npb.jp/draft/2013/draftlist_bs.html");
});

test("⚠같은 구단이 연도마다 다른 슬러그다 — 목록이 연도의 함수인지 본다(A3)", () => {
  const targets = draftTargets({
    years: [2024, 2013],
    slugsByYear: new Map([
      [2013, ["bs"]],
      [2024, ["b"]],
    ]),
  });
  assert.deepEqual(
    targets.map((t) => t.key),
    ["npb/draft/2013/bs", "npb/draft/2024/b"],
    "⚠연도 오름차순 · 2013 은 bs · 2024 는 b",
  );
});

test("⚠호스트는 draft.npb.jp 다 — npb.jp 로 치면 리다이렉트 2홉을 탄다(L1)", () => {
  // 실측(docs/sources/2026-09-04-draft-source-survey.md §1):
  //   https://npb.jp/draft/ → 302 → http://draft.npb.jp/draft/ → 301 → https://draft.npb.jp/draft/
  // ⚠같은 문서 §9-A: **「리다이렉트 홉은 간격 밖이다」** — 홉은 L1 간격이 안 걸린다.
  for (const u of [BACKNUMBER_URL, yearIndexUrl(2013), teamPageUrl(2013, "bs")]) {
    assert.match(u, /^https:\/\/draft\.npb\.jp\/draft\//, `리다이렉트를 타는 주소다: ${u}`);
  }
  assert.equal(yearIndexUrl(2013), "https://draft.npb.jp/draft/2013/", "연도 톱은 끝 슬래시가 있다");
});

// ---- 취득 루프 -------------------------------------------------------------

test("⚠2단계 발견이 실물에서 돈다 — 2013 은 bs · 2024 는 b 를 받으러 간다(A3)", async () => {
  const h = harness();
  const { deps, calls } = depsFor(h, realRoute);

  const r = await collectDraft({ from: 2013, to: 2013 }, deps);
  assert.deepEqual(
    [...r.slugsByYear.get(2013)!],
    ["bs", "c", "d", "db", "e", "f", "g", "h", "l", "m", "s", "t"],
  );

  const listUrls = calls.map((c) => c.url).filter((u) => u.includes("draftlist_"));
  assert.equal(listUrls.length, 12, "12구단 12장");
  assert.ok(listUrls.includes(teamPageUrl(2013, "bs")), "⚠오릭스를 bs 로 받아야 한다");
  assert.ok(!listUrls.includes(teamPageUrl(2013, "b")), "⚠2013 에 draftlist_b.html 은 실물 404 다");

  const h2 = harness();
  const { deps: d2, calls: c2 } = depsFor(h2, realRoute);
  await collectDraft({ from: 2024, to: 2024 }, d2);
  const l2 = c2.map((c) => c.url).filter((u) => u.includes("draftlist_"));
  assert.ok(l2.includes(teamPageUrl(2024, "b")), "⚠같은 구단이 2024 에는 b 다");
  assert.ok(!l2.includes(teamPageUrl(2024, "bs")));
});

test("⚠범위를 자르는 것은 호출자다(A4) — 색인은 나열하는 그대로를 준다", async () => {
  const h = harness();
  const { deps, calls } = depsFor(h, realRoute);

  const r = await collectDraft({ from: 2013, to: 2013 }, deps);
  assert.equal(r.yearsListed.length, 26, "색인은 2001~2026 26개를 그대로 낸다 — 여기서 안 자른다");
  assert.deepEqual([...r.yearsAttempted], [2013], "우리가 받는 것은 범위 안뿐이다");

  const yearTops = calls.map((c) => c.url).filter((u) => /\/draft\/\d{4}\/$/.test(u));
  assert.deepEqual(yearTops, [yearIndexUrl(2013)], "범위 밖 연도 톱을 치면 안 된다(L1)");
});

test("⚠A1: 슬러그 0건을 「아직」으로 삼키지 않는다 — observed 를 그대로 남긴다", async () => {
  const h = harness();
  const { deps, calls } = depsFor(h, realRoute);

  // 2026 은 개최 2개월 전이라 실물이 `draftlist_*` **0건**이다(픽스처).
  const r = await collectDraft({ from: 2026, to: 2026 }, deps);
  assert.equal(r.slugsByYear.size, 0);
  assert.equal(r.skipped.length, 1);
  const skip = r.skipped[0]!;
  assert.equal(skip.year, 2026);
  assert.equal(skip.skip.kind, "index");
  assert.equal(
    skip.skip.kind === "index" ? skip.skip.observed : null,
    "no-team-links",
    "⚠파서의 관측을 그대로 옮긴다 — 메시지 문자열을 매칭하지 않는다",
  );
  assert.equal(calls.filter((c) => c.url.includes("draftlist_")).length, 0, "슬러그가 0건이면 받을 것도 0장이다");
});

test("⚠no-draft-marker 는 no-team-links 와 다른 갈래다 — 뭉치면 붕괴가 「아직」으로 읽힌다", async () => {
  const h = harness();
  // 실물 nginx 404 본문을 **200 으로** 준다(오배송처럼 드래프트 페이지가 아닌 것을 받은 경우).
  const { deps } = depsFor(h, (url) =>
    url === BACKNUMBER_URL
      ? response(200, fixture("draft-backnumber"))
      : response(200, fixture("draft-2013-list-b-404")),
  );

  const r = await collectDraft({ from: 2013, to: 2013 }, deps);
  const skip = r.skipped[0]!.skip;
  assert.equal(skip.kind, "index");
  assert.equal(skip.kind === "index" ? skip.observed : null, "no-draft-marker");
});

test("⚠M11: 연도 톱 404 는 부재이고 실패가 아니다", async () => {
  const h = harness();
  const { deps } = depsFor(h, realRoute);

  // 2020 은 이 라우터에 없다 → 404.
  const r = await collectDraft({ from: 2020, to: 2020 }, deps);
  assert.equal(r.skipped[0]!.skip.kind, "absent", "⚠「못 받았다」와 「없다」는 다른 말이다");
  assert.equal(
    r.pages.filter((p) => p.outcome === "failed").length,
    0,
    "⚠부재를 실패로 세면 매년 정상 종료가 exit 1 이 된다",
  );
});

test("⚠M7: 색인 구조가 바뀌면 빈 결과가 아니라 예외다", async () => {
  const h = harness();
  const { deps } = depsFor(h, (url) =>
    url === BACKNUMBER_URL ? response(200, "<html>新レイアウト</html>") : response(200, "x"),
  );
  await assert.rejects(
    () => collectDraft({ from: 2013, to: 2013 }, deps),
    /연도 링크/,
    "0건을 정답으로 인정하면 드래프트가 통째로 조용히 안 들어온다",
  );
});

test("⚠색인을 못 받으면 던진다 — 무엇을 받을지 모르는 채로 「0건 성공」 하지 않는다", async () => {
  const h = harness();
  const { deps } = depsFor(h, () => response(404));
  await assert.rejects(() => collectDraft({ from: 2013, to: 2013 }, deps), DraftCollectError);
});

test("⚠M5 멱등: 같은 내용을 두 번 돌려도 본문을 다시 쓰지 않는다", async () => {
  const h = harness();
  const { deps, sink } = depsFor(h, realRoute);

  const first = await collectDraft({ from: 2013, to: 2013 }, deps);
  const wrote = sink.writeCount;
  assert.equal(wrote, first.pages.filter((p) => p.outcome === "stored").length);

  const second = await collectDraft({ from: 2013, to: 2013 }, deps);
  assert.equal(sink.writeCount, wrote, "⚠두 번째 실행이 쓰면 revision 이 헛돈다");
  assert.equal(
    second.pages.every((p) => p.outcome === "unchanged"),
    true,
  );
  assert.deepEqual([...second.slugsByYear.get(2013)!], [...first.slugsByYear.get(2013)!]);
});

test("⚠L1: 전 요청이 주입된 fetch 를 지나고 간격을 지킨다 — 직접 fetch 가 없다", async () => {
  const h = harness();
  const { deps, calls } = depsFor(h, realRoute);

  const r = await collectDraft({ from: 2013, to: 2013 }, deps);
  // 색인 1 + 연도 톱 1 + 구단 12 = 14장.
  assert.equal(calls.length, 14, "요청 수는 분모와 함께 고정한다");
  assert.equal(r.pages.length, 14);
  assert.deepEqual(h.sleeps, new Array(13).fill(3000), "첫 요청 뒤 매번 3초를 기다린다(1req/3초 · 동시 1커넥션)");
});

/**
 * ⚠**옛 사본으로 진행한 것을 조용히 두지 마라.**
 *
 * 취득이 실패해도 아카이브에 이전 성공분이 있으면 그것으로 발견을 계속한다(L7 캐시 우선).
 * 실패 자체는 `pages` 에 남아 종료코드가 되지만, **그것만으로는 부족하다**: 로그에는
 * 「실패 1」만 찍히고 뒤따르는 구단 페이지들은 `stored`/`unchanged` 로 **정상처럼 보인다.**
 * 그 구단 목록이 **낡은(=구단이 빠져 있을 수 있는) 슬러그 집합**에서 나왔다는 신호가 없으면
 * **어느 해가 그렇게 받아졌는지 사후에 알 수 없다.**
 */
test("⚠연도 톱이 실패해 옛 사본으로 진행하면 그 해를 표시한다", async () => {
  const h = harness();
  const { deps, sink } = depsFor(h, realRoute);
  await collectDraft({ from: 2013, to: 2013 }, deps); // 1회차: 사본을 만든다
  assert.ok(await sink.readBody("npb/draft/2013/index"));

  // 2회차: 연도 톱만 죽는다. 색인과 구단 페이지는 정상.
  const h2 = harness();
  const r2 = recorder((url) => (url === yearIndexUrl(2013) ? response(503) : realRoute(url)));
  const deps2 = {
    fetcher: new PoliteFetcher({ userAgent: "ua", clock: h2.clock, fetchImpl: r2.impl, sleep: h2.sleep.bind(h2) }),
    sink, // ⚠**같은 sink** — 1회차의 사본이 남아 있다
    clock: h2.clock,
  };

  const r = await collectDraft({ from: 2013, to: 2013 }, deps2);
  assert.deepEqual([...r.stale.years], [2013], "⚠낡은 슬러그로 받은 해가 결과에 남아야 한다");
  assert.equal(r.stale.index, false, "색인은 멀쩡했다 — 뭉뚱그리지 않는다");
  assert.equal(r.pages.filter((p) => p.outcome === "failed").length, 1, "실패는 그대로 남는다");
  assert.equal(r.slugsByYear.get(2013)?.length, 12, "옛 사본으로 발견은 계속된다(L7)");
  assert.equal(r.skipped.length, 0, "건너뛴 게 아니다 — 옛 사본으로 진행한 것이다");
});

test("⚠색인이 옛 사본이면 연도 목록 전체가 낡았다 — 연도별 표시와 층이 다르다", async () => {
  const h = harness();
  const { deps, sink } = depsFor(h, realRoute);
  await collectDraft({ from: 2013, to: 2013 }, deps);

  const h2 = harness();
  const r2 = recorder((url) => (url === BACKNUMBER_URL ? response(503) : realRoute(url)));
  const deps2 = {
    fetcher: new PoliteFetcher({ userAgent: "ua", clock: h2.clock, fetchImpl: r2.impl, sleep: h2.sleep.bind(h2) }),
    sink,
    clock: h2.clock,
  };

  const r = await collectDraft({ from: 2013, to: 2013 }, deps2);
  assert.equal(r.stale.index, true, "⚠어느 해가 있는지 자체가 낡은 목록에서 나왔다");
  assert.deepEqual([...r.stale.years], [], "연도 톱은 멀쩡했다");
});

test("⚠색인 자체도 아카이브에 남는다 — 이 연도 목록이 어디서 나왔는가(M4)", async () => {
  const h = harness();
  const { deps, sink } = depsFor(h, realRoute);

  await collectDraft({ from: 2013, to: 2013 }, deps);
  const meta = await sink.readMeta(BACKNUMBER_KEY);
  assert.equal(meta?.url, BACKNUMBER_URL);
  assert.equal(meta?.revision, 1);
});
