/**
 * 경기 페이지 세트 기록(설계 D2 · 시험 8 · 8a · 9 · 9a · 10 · 11a · 12a · 12b · 12c).
 * ⚠8a 는 설계 부록 C 의 I1(2026-09-26 최종 가지 검토)이다 — 받기 단계 실패 때 box 의 본 시각이 오르면 옛 판 가드가 풀린다.
 * ⚠15·15a 는 설계 부록 D 의 A1(2026-09-26 3중 검토 3차 P1)이다 — 「봤다」는 **받은 시각**이지 기록 시각이 아니다.
 * ⚠가짜 fetcher 는 `get` 만 가진 객체다 — 재시도·지연 없이 호출 순서를 그대로 기록한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import type { FetchResponse, PoliteFetcher } from "../src/fetcher.ts";
import { archiveDate, archiveGame, archivePage, commitPrepared, prepareUrl } from "../src/archive.ts";

const REF = { season: 2026, date: "2026-08-14", slug: "s-db-17", path: "/scores/2026/0814/s-db-17/", venue: null };
const KEY = (leaf: string) => `npb/scores/2026/0814/s-db-17/${leaf}`;
const URL_OF = { index: "https://npb.jp/scores/2026/0814/s-db-17/", playbyplay: "https://npb.jp/scores/2026/0814/s-db-17/playbyplay.html", box: "https://npb.jp/scores/2026/0814/s-db-17/box.html", roster: "https://npb.jp/scores/2026/0814/s-db-17/roster.html" } as const;
const LEAF_OF_URL = new Map<string, string>(Object.entries(URL_OF).map(([k, v]) => [v, k]));
const clock = { now: () => new Date("2026-09-25T00:00:00.000Z") };

const enc = (s: string) => new TextEncoder().encode(s);
const ok = (s: string): FetchResponse => ({ status: 200, body: enc(s), etag: null, lastModified: null });
const notFound: FetchResponse = { status: 404, body: null, etag: null, lastModified: null };

function stubFetcher(route: (leaf: string, url: string) => FetchResponse | Error) {
  const calls: string[] = [];
  const fetcher = {
    async get(url: string): Promise<FetchResponse> {
      calls.push(url);
      const r = route(LEAF_OF_URL.get(url) ?? "?", url);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as PoliteFetcher;
  return { fetcher, calls };
}

async function seed(sink: MemorySink, leaf: string, body: string, extra: Partial<BlobMeta> = {}): Promise<void> {
  await sink.write(KEY(leaf), enc(body), {
    url: `x/${leaf}`, fetchedAt: "2026-08-15T00:00:00.000Z", lastModified: null, etag: null, status: 200,
    sha256: sha256(enc(body)), byteLength: body.length, revision: 1, ...extra,
  });
}

async function seedAll(sink: MemorySink, extra: Partial<BlobMeta> = {}): Promise<void> {
  for (const leaf of ["index", "playbyplay", "box", "roster"]) await seed(sink, leaf, `${leaf}0`, extra);
}

class ThrowingMetaSink extends MemorySink {
  private readonly badLeaf: string;
  constructor(badLeaf: string) {
    super();
    this.badLeaf = badLeaf;
  }
  override async readMeta(key: string): Promise<BlobMeta | null> {
    if (key === KEY(this.badLeaf)) throw new SyntaxError("Unexpected token in JSON");
    return super.readMeta(key);
  }
}

for (const bad of ["index", "playbyplay", "roster"]) {
  test(`11a 깨진 사이드카(${bad})는 던지지 않고 그 페이지 failed — archivePage · archiveDate`, async () => {
    const sink = new ThrowingMetaSink(bad);
    const { fetcher } = stubFetcher((leaf) => ok(`${leaf}1`));
    const page = await archivePage(REF, bad === "index" ? "" : (`${bad}.html` as "playbyplay.html" | "roster.html"), { fetcher, sink, clock });
    assert.equal(page.outcome, "failed");
    assert.match(page.error ?? "", /사이드카를 못 읽었다/);

    const monthly = `<a href="/scores/2026/0814/s-db-17/">g</a>`;
    const day = await archiveDate("2026-08-14", {
      fetcher: stubFetcher((_leaf, url) => (url.includes("schedule") ? ok(monthly) : ok("x"))).fetcher,
      sink,
      clock,
    });
    assert.ok(!("error" in day), "날짜 단위 오류가 아니라 페이지 failed 여야 한다");
    assert.ok(day.pages.some((p) => p.outcome === "failed" && /사이드카를 못 읽었다/.test(p.error ?? "")));
  });
}

const outcomes = (rs: { outcome: string }[]) => rs.map((r) => r.outcome);

test("8 받기 단계에서 playbyplay 가 실패하면 바뀐 box 는 held · 어떤 본문도 사이드카도 안 쓴다(안 바뀐 페이지의 「봤다」도 없다)", async () => {
  const sink = new MemorySink();
  await seedAll(sink, { set: "S0" });
  const writes = sink.writeCount;
  const metaWrites = sink.metaWriteCount;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? new Error("ECONNRESET") : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.equal(sink.writeCount, writes, "새 본문 쓰기 0회");
  assert.equal(sink.metaWriteCount, metaWrites, "사이드카만 고치는 쓰기(markSeen)도 0회 — 설계 G3a(2026-09-26 정정)");
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("box"))), "box0");
  assert.equal((await sink.readMeta(KEY("box")))?.revision, 1);
  for (const leaf of ["index", "roster"]) {
    const m = await sink.readMeta(KEY(leaf));
    assert.equal(m?.checkedAt, undefined, `${leaf} 의 checkedAt 은 심은 그대로(없음)다`);
    assert.equal(m?.set, "S0", `${leaf} 의 set 은 이전 값 그대로다`);
  }
});

test("8a 받기 단계 실패 때 안 바뀐 box 의 본 시각을 올리지 않는다 — 올리면 적재기가 held 된 옛 playbyplay 를 새 판으로 믿는다(I1)", async () => {
  const SEEN = "2026-08-15T00:00:00.000Z";
  const sink = new MemorySink();
  await seedAll(sink, { set: "S0", checkedAt: SEEN });
  const { fetcher } = stubFetcher((leaf) => (leaf === "index" ? new Error("ECONNRESET") : leaf === "playbyplay" ? ok("playbyplay1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["failed", "held", "unchanged", "unchanged"]);
  const box = await sink.readMeta(KEY("box"));
  assert.equal(box?.checkedAt, SEEN, "box 의 checkedAt(적재기가 세트의 판으로 쓰는 값)은 심은 그대로다");
  assert.equal(box?.set, "S0");
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("playbyplay"))), "playbyplay0", "playbyplay 본문은 옛 판 그대로(held)");
  assert.equal((await sink.readMeta(KEY("playbyplay")))?.revision, 1);
});

test("9 전부 성공이면 네 사이드카의 set 이 모두 같다 · 바뀐 페이지만 revision 이 오른다", async () => {
  const sink = new MemorySink();
  await seedAll(sink);
  const { fetcher } = stubFetcher((leaf) => (leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "unchanged", "stored", "unchanged"]);
  const sets = await Promise.all(["index", "playbyplay", "box", "roster"].map(async (l) => (await sink.readMeta(KEY(l)))?.set));
  assert.ok(typeof sets[0] === "string" && sets[0].startsWith("2026-09-25T00:00:00.000Z-"));
  assert.equal(new Set(sets).size, 1);
  assert.equal((await sink.readMeta(KEY("box")))?.revision, 2);
  assert.equal((await sink.readMeta(KEY("index")))?.revision, 1);
});

test("9a 세트 id: 같은 시각이라도 내용이 다르면 다르고 · 같으면 같다", async () => {
  const run = async (box: string) => {
    const sink = new MemorySink();
    await seedAll(sink);
    await archiveGame(REF, { fetcher: stubFetcher((leaf) => (leaf === "box" ? ok(box) : ok(`${leaf}0`))).fetcher, sink, clock });
    return (await sink.readMeta(KEY("box")))?.set;
  };
  const a = await run("boxA");
  const b = await run("boxB");
  const a2 = await run("boxA");
  assert.notEqual(a, b);
  assert.equal(a, a2);
});

test("10 요청 수·순서는 지금과 같다 — index · playbyplay · box · roster 한 번씩", async () => {
  const sink = new MemorySink();
  const { fetcher, calls } = stubFetcher((leaf) => ok(`${leaf}0`));
  await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(calls, [URL_OF.index, URL_OF.playbyplay, URL_OF.box, URL_OF.roster]);
});

class FailingWriteSink extends MemorySink {
  /** ⚠사전 적재(`seedAll`)가 끝난 뒤에 켠다 — 안 그러면 준비 단계에서 먼저 죽는다 */
  armed = false;
  private readonly badLeaf: string;
  private readonly halfWrite: boolean;
  constructor(badLeaf: string, halfWrite: boolean) {
    super();
    this.badLeaf = badLeaf;
    this.halfWrite = halfWrite;
  }
  override async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    if (this.armed && key === KEY(this.badLeaf)) {
      // halfWrite: 본문 rename 은 됐고 사이드카 rename 에서 죽은 모양(12b)
      if (this.halfWrite) this.bodies.set(key, body);
      throw new Error("디스크 오류");
    }
    return super.write(key, body, meta);
  }
}

test("12a 기록 단계에서 playbyplay 쓰기가 실패하면 거기서 멈춘다 · 앞 index 만 새 set · 뒤는 held/무기록", async () => {
  const sink = new FailingWriteSink("playbyplay", false);
  await seedAll(sink);
  sink.armed = true;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? ok("playbyplay1") : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.ok((await sink.readMeta(KEY("index")))?.set, "index 는 새 set 을 받았다");
  const roster = await sink.readMeta(KEY("roster"));
  assert.equal(roster?.checkedAt, undefined, "멈춘 뒤의 roster 는 markSeen 도 안 한다");
  assert.equal(roster?.set, undefined);
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("box"))), "box0");
});

test("12b 본문만 바뀌고 사이드카에서 죽으면 failed · 본문과 사이드카 sha 가 어긋난 채 남는다(적재기가 본문 불일치로 잡는다)", async () => {
  const sink = new FailingWriteSink("playbyplay", true);
  await seedAll(sink);
  sink.armed = true;
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? ok("playbyplay1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.equal(rs[1]!.outcome, "failed");
  const body = sink.bodies.get(KEY("playbyplay"))!;
  assert.notEqual(sha256(body), (await sink.readMeta(KEY("playbyplay")))?.sha256);
});

test("12c 있던 playbyplay 가 404 면 실패 · 본문·사이드카 보존 · 바뀐 box 는 held", async () => {
  const sink = new MemorySink();
  await seedAll(sink);
  const { fetcher } = stubFetcher((leaf) => (leaf === "playbyplay" ? notFound : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "failed", "held", "unchanged"]);
  assert.match(rs[1]!.error ?? "", /있던 페이지가 사라졌다/);
  assert.equal(new TextDecoder().decode(sink.bodies.get(KEY("playbyplay"))), "playbyplay0");
});

test("12c 처음부터 없던 roster 의 404 는 absent 이고 세트가 기록된다", async () => {
  const sink = new MemorySink();
  for (const leaf of ["index", "playbyplay", "box"]) await seed(sink, leaf, `${leaf}0`);
  const { fetcher } = stubFetcher((leaf) => (leaf === "roster" ? notFound : leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const rs = await archiveGame(REF, { fetcher, sink, clock });
  assert.deepEqual(outcomes(rs), ["unchanged", "unchanged", "stored", "absent"]);
  assert.equal(await sink.readMeta(KEY("roster")), null);
  assert.ok((await sink.readMeta(KEY("box")))?.set);
});

/**
 * ⚠**15 「봤다」는 받은 시각이다 — 기록 시각이 아니다**(설계 부록 D · 3중 검토 3차 P1).
 * 두 아카이버가 같은 폴더에서 겹치면 **먼저 옛 내용을 받고 늦게 기록한 쪽**이 있다. 기록할 때 시계를 다시 읽으면
 * 그 옛 내용에 가장 새 `checkedAt` 이 붙고, 적재기의 판 가드(box 의 `checkedAt ?? fetchedAt`)가 그것을 새 판으로 믿는다.
 * → 받기와 기록 사이에 시계가 흐르게 하고, 기록된 시각이 **받은 시각**인지 본다.
 */
test("15 prepare 와 commit 사이에 시계가 흘러도 안 바뀐 페이지의 checkedAt · 바뀐 페이지의 fetchedAt 은 받은 시각이다", async () => {
  const OBSERVED = "2026-09-25T00:00:00.000Z";
  const COMMITTED = "2026-09-25T00:05:00.000Z";
  let now = OBSERVED;
  const movingClock = { now: () => new Date(now) };
  const sink = new MemorySink();
  await seedAll(sink);
  const { fetcher } = stubFetcher((leaf) => (leaf === "box" ? ok("box1") : ok(`${leaf}0`)));
  const deps = { fetcher, sink, clock: movingClock };

  const same = await prepareUrl(KEY("index"), URL_OF.index, deps);
  const changed = await prepareUrl(KEY("box"), URL_OF.box, deps);
  assert.equal(same.kind, "unchanged");
  assert.equal(changed.kind, "changed");
  now = COMMITTED; // 받은 뒤 한참 지나 기록한다
  assert.equal((await commitPrepared(same, deps)).outcome, "unchanged");
  assert.equal((await commitPrepared(changed, deps)).outcome, "stored");

  const index = await sink.readMeta(KEY("index"));
  assert.equal(index?.checkedAt, OBSERVED, "안 바뀐 페이지의 「봤다」에 기록 시각이 찍혔다 — 겹친 아카이버가 옛 내용을 새 판으로 만든다");
  assert.equal(index?.fetchedAt, "2026-08-15T00:00:00.000Z", "안 바뀐 페이지의 fetchedAt 은 움직이지 않는다");
  const box = await sink.readMeta(KEY("box"));
  assert.equal(box?.fetchedAt, OBSERVED, "바뀐 페이지의 fetchedAt 에 기록 시각이 찍혔다");
  assert.equal(box?.checkedAt, undefined, "새로 쓴 사이드카는 fetchedAt 이 곧 본 시각이다");
});

test("15a archiveGame: 네 장 각각의 본 시각은 **그 페이지를 받은 직후**의 시각이다 — 세트를 기록할 때의 시각이 아니다", async () => {
  const OBS: Record<string, string> = {
    index: "2026-09-25T00:00:01.000Z",
    playbyplay: "2026-09-25T00:00:04.000Z",
    box: "2026-09-25T00:00:07.000Z",
    roster: "2026-09-25T00:00:10.000Z",
  };
  const COMMITTED = "2026-09-25T00:09:00.000Z";
  let now = "2026-09-25T00:00:00.000Z";
  const movingClock = { now: () => new Date(now) };
  const { fetcher } = stubFetcher((leaf) => {
    now = OBS[leaf]!; // 이 페이지의 응답이 도착한 시각
    return leaf === "box" ? ok("box1") : ok(`${leaf}0`);
  });
  // 기록 단계의 첫 쓰기에서 시계를 크게 밀어 「기록은 받기보다 늦다」를 만든다
  class LateSink extends MemorySink {
    override async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
      now = COMMITTED;
      return super.write(key, body, meta);
    }
    override async writeMeta(key: string, meta: BlobMeta): Promise<void> {
      now = COMMITTED;
      return super.writeMeta(key, meta);
    }
  }
  const late = new LateSink();
  await seedAll(late, { set: "S0" }); // 심는 쓰기도 시계를 밀지만 곧바로 받기가 다시 정한다

  const rs = await archiveGame(REF, { fetcher, sink: late, clock: movingClock });
  assert.deepEqual(outcomes(rs), ["unchanged", "unchanged", "stored", "unchanged"]);
  for (const leaf of ["index", "playbyplay", "roster"]) {
    assert.equal((await late.readMeta(KEY(leaf)))?.checkedAt, OBS[leaf], `${leaf} 의 checkedAt 이 받은 시각이 아니다`);
  }
  assert.equal((await late.readMeta(KEY("box")))?.fetchedAt, OBS["box"], "box 의 fetchedAt 이 받은 시각이 아니다");
  const sets = await Promise.all(["index", "playbyplay", "box", "roster"].map(async (l) => (await late.readMeta(KEY(l)))?.set));
  assert.equal(new Set(sets).size, 1, "세트 표식은 여전히 한 값이다");
});
