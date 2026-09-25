/**
 * 경기 페이지 세트 기록(설계 D2 · 시험 8 · 9 · 9a · 10 · 11a · 12a · 12b · 12c).
 * ⚠가짜 fetcher 는 `get` 만 가진 객체다 — 재시도·지연 없이 호출 순서를 그대로 기록한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import type { FetchResponse, PoliteFetcher } from "../src/fetcher.ts";
import { archiveDate, archiveGame, archivePage } from "../src/archive.ts";

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
