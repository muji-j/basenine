import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, toJstDateString } from "../src/clock.ts";
import { LocalSink, MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";

test("JST 날짜 — UTC 15:00이 다음날 00:00이 된다", () => {
  assert.equal(toJstDateString(new Date("2026-08-14T14:59:59Z")), "2026-08-14");
  assert.equal(toJstDateString(new Date("2026-08-14T15:00:00Z")), "2026-08-15");
});

test("JST 날짜 — 연장전이 자정을 넘겨도 UTC 날짜가 아니라 JST 날짜를 쓴다", () => {
  // 2026-08-14 22:30 JST = 13:30Z. UTC로 자르면 같은 날이지만,
  // 2026-08-15 00:30 JST = 2026-08-14 15:30Z 는 UTC로는 전날이다.
  assert.equal(toJstDateString(new Date("2026-08-14T15:30:00Z")), "2026-08-15");
});

test("고정 시계는 호출마다 같은 값을 준다", () => {
  const clock = fixedClock("2026-08-14T12:00:00Z");
  assert.equal(clock.now().toISOString(), clock.now().toISOString());
});

test("고정 시계가 돌려준 Date를 변조해도 시계는 오염되지 않는다", () => {
  const clock = fixedClock("2026-08-14T12:00:00Z");
  const a = clock.now();
  a.setFullYear(1999);
  assert.equal(clock.now().getUTCFullYear(), 2026);
});

test("sha256은 내용이 같으면 같고 다르면 다르다", () => {
  const a = new TextEncoder().encode("試合経過");
  const b = new TextEncoder().encode("試合経過");
  const c = new TextEncoder().encode("試合経過 ");
  assert.equal(sha256(a), sha256(b));
  assert.notEqual(sha256(a), sha256(c));
});

function meta(overrides: Partial<BlobMeta> = {}): BlobMeta {
  return {
    url: "https://npb.jp/scores/2026/0814/s-db-17/",
    fetchedAt: "2026-08-14T13:00:00.000Z",
    lastModified: null,
    etag: null,
    status: 200,
    sha256: "deadbeef",
    byteLength: 4,
    revision: 1,
    ...overrides,
  };
}

test("LocalSink 왕복 — 원시 바이트가 그대로 돌아온다", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-archiver-"));
  try {
    const sink = new LocalSink(root);
    // UTF-8이 아닌 바이트가 섞여도 변형되지 않아야 한다(인코딩 변환 금지).
    const body = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x82, 0xa0, 0xff]);
    await sink.write("npb/scores/2026/0814/s-db-17/index", body, meta());

    const back = await sink.readBody("npb/scores/2026/0814/s-db-17/index");
    assert.deepEqual(back, body);

    const m = await sink.readMeta("npb/scores/2026/0814/s-db-17/index");
    assert.equal(m?.status, 200);
    assert.equal(m?.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LocalSink — 없는 키는 예외가 아니라 null", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-archiver-"));
  try {
    const sink = new LocalSink(root);
    assert.equal(await sink.readMeta("없음"), null);
    assert.equal(await sink.readBody("없음"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MemorySink는 쓰기 횟수를 센다", async () => {
  const sink = new MemorySink();
  await sink.write("k", new Uint8Array([1]), meta());
  await sink.write("k", new Uint8Array([2]), meta());
  assert.equal(sink.writeCount, 2);
});
