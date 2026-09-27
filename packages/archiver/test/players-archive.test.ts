/**
 * 선수 페이지 아카이버(`archivePlayer`)가 **본문·사이드카 짝이 틀린 로컬 사본**을 스스로 고치는가
 * (2026-09-27 · 3중 검토 2차 F1 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5-4).
 *
 * ⚠**짝 불일치는 저절로 안 풀렸다.** 본문 rename 과 사이드카 rename 사이에서 죽었거나(`sink.ts` 의 `write`) 짝이 틀린 덧붙임이
 *   풀리면 **본문만 다른 것**이 남는다. 다시 받아도 상류가 사이드카와 같으면 `markSeen` 이 「봤다」만 남기고 끝나서 그 본문이
 *   영영 안 고쳐졌다 — 적재기는 매 실행 판 모름(종료 1)으로 배포를 막았다.
 *   → 상류 sha 가 사이드카와 같을 때 **로컬 본문의 sha 도 본다.** 다르거나 없거나 못 읽으면 받은 바이트로 본문을 다시 쓴다.
 * ⚠**`revision` 은 올리지 않는다** — 내용은 사이드카가 말하는 그대로다(바뀐 것은 로컬 파일이지 상류가 아니다 · M5).
 * ⚠**외부 요청 수는 안 는다** — 어차피 받은 응답의 바이트를 쓴다. 가짜 응답만 쓴다(외부 요청 0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSink, MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import { archivePlayer, playerKey } from "../src/players.ts";
import { PoliteFetcher } from "../src/fetcher.ts";

const ID = "01005134";
const KEY = playerKey(ID);
const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-27T03:00:00.000Z";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const A = enc("<html>본문 A — 사이드카가 말하는 내용</html>");
const B = enc("<html>본문 B — 짝이 틀린 로컬 파일</html>");
const clock = { now: () => new Date(T1) };

/** 같은 본문을 돌려주는 가짜 상류 — ⚠검증자를 안 준다(상류 실측과 같은 모양) · 요청 수를 센다 */
function upstream(body: Uint8Array): { fetcher: PoliteFetcher; calls: () => number } {
  let n = 0;
  const fetcher = new PoliteFetcher({
    userAgent: "bb-app-test",
    clock,
    fetchImpl: async () => {
      n += 1;
      return {
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      };
    },
    sleep: async () => undefined,
  });
  return { fetcher, calls: () => n };
}

function meta(body: Uint8Array, over: Partial<BlobMeta> = {}): BlobMeta {
  return {
    url: "https://npb.jp/bis/players/01005134.html",
    fetchedAt: T0,
    lastModified: null,
    etag: null,
    status: 200,
    sha256: sha256(body),
    byteLength: body.byteLength,
    revision: 3,
    ...over,
  };
}

test("⚠2차 F1 · 짝 불일치(본문만 다름) + 상류가 사이드카와 같다 — 받은 바이트로 본문을 되살린다 · revision·fetchedAt·sha 불변 · 요청 1", async () => {
  const sink = new MemorySink();
  await sink.write(KEY, B, meta(A)); // 사이드카는 A 를 말하는데 본문은 B
  sink.writeCount = 0;
  const up = upstream(A);
  const r = await archivePlayer(ID, { fetcher: up.fetcher, sink, clock });
  assert.equal(r.outcome, "unchanged", "내용은 사이드카가 말하는 그대로다 — 새 판이 아니다");
  assert.equal(r.repaired, true, "본문을 되살렸다고 말하지 않는다");
  assert.deepEqual(await sink.readBody(KEY), A, "본문을 되살리지 않았다 — 짝 불일치가 영영 남는다");
  const m = (await sink.readMeta(KEY))!;
  assert.equal(m.revision, 3, "내용이 안 바뀌었는데 revision 을 올렸다(M5)");
  assert.equal(m.sha256, sha256(A));
  assert.equal(m.fetchedAt, T0, "fetchedAt(내용이 마지막으로 바뀐 시각)이 움직였다");
  assert.equal(m.checkedAt, T1, "「봤다」가 안 남았다");
  assert.equal(up.calls(), 1, "요청이 늘었다(L1)");
});

test("⚠2차 F1 · 사이드카만 있고 본문이 없다 + 상류가 사이드카와 같다 — 본문을 쓴다", async () => {
  const sink = new MemorySink();
  await sink.writeMeta(KEY, meta(A));
  const r = await archivePlayer(ID, { fetcher: upstream(A).fetcher, sink, clock });
  assert.equal(r.outcome, "unchanged");
  assert.equal(r.repaired, true);
  assert.deepEqual(await sink.readBody(KEY), A, "빠진 본문을 되살리지 않았다");
  assert.equal((await sink.readMeta(KEY))!.revision, 3);
});

test("⚠2차 F1 · 로컬 .gz 가 깨졌다(LocalSink) + 상류가 사이드카와 같다 — 본문을 되살린다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-player-repair-"));
  try {
    const sink = new LocalSink(dir);
    await sink.writeMeta(KEY, meta(A));
    await mkdir(join(dir, "npb", "players"), { recursive: true });
    await writeFile(join(dir, `${KEY}.html.gz`), Buffer.from("잘린 gzip 이 아니다"));
    const r = await archivePlayer(ID, { fetcher: upstream(A).fetcher, sink, clock });
    assert.equal(r.outcome, "unchanged");
    assert.equal(r.repaired, true);
    assert.deepEqual(await sink.readBody(KEY), A, "깨진 본문을 그대로 뒀다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** ⚠**짝이 맞으면 본문을 다시 쓰지 않는다**(M5) — 되살리기는 틀린 사본에만 걸린다. 정상 경로의 쓰기·요청은 예전과 같다 */
test("2차 F1 · 짝이 맞는 정상 사본 + 상류 불변 — 본문을 다시 쓰지 않고 「봤다」만 남긴다", async () => {
  const sink = new MemorySink();
  await sink.write(KEY, A, meta(A));
  sink.writeCount = 0;
  const r = await archivePlayer(ID, { fetcher: upstream(A).fetcher, sink, clock });
  assert.equal(r.outcome, "unchanged");
  assert.notEqual(r.repaired, true, "멀쩡한 사본을 되살렸다고 한다");
  assert.equal(sink.writeCount, 0, "짝이 맞는데 본문을 다시 썼다");
  assert.equal(sink.metaWriteCount, 1);
  assert.equal((await sink.readMeta(KEY))!.checkedAt, T1);
});

/** 상류가 바뀌었으면 지금처럼 새 판이다 — 되살리기 갈래에 들어가지 않는다 */
test("2차 F1 · 상류가 바뀌었다 — 지금처럼 새 판을 쓴다(revision+1)", async () => {
  const sink = new MemorySink();
  await sink.write(KEY, B, meta(A));
  const C = enc("<html>본문 C — 상류의 새 판</html>");
  const r = await archivePlayer(ID, { fetcher: upstream(C).fetcher, sink, clock });
  assert.equal(r.outcome, "stored");
  assert.notEqual(r.repaired, true);
  assert.deepEqual(await sink.readBody(KEY), C);
  const m = (await sink.readMeta(KEY))!;
  assert.equal(m.revision, 4);
  assert.equal(m.sha256, sha256(C));
});
