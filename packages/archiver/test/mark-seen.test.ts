/**
 * **「받았는데 안 바뀌었다」도 「봤다」로 남기는가.**
 *
 * ⚠**경기·일정 페이지는 그걸 안 남기고 있었다**(2026-08-25 · 감사 P3 #10).
 * `players.ts` 는 2026-08-17 에 이 규칙을 얻었는데, `archiveUrl` 은 못 받았다 —
 * ⚠**그 함수가 스스로 「멱등·revision 규칙을 여기 한 벌만 둔다(M5)」고 적어 두고 있으면서
 * 그 절반이 다른 파일에 있었다.** 「한 벌」이라는 주장과 실제가 달랐던 것이 결함의 모양이다.
 *
 * 안 남기면 두 가지가 동시에 망가진다:
 *   · 화면이 「N時点に取得」이라고 **실제보다 낡은 날짜**를 말한다
 *   · 재취득 선정이 「아직 안 받았다」로 오판해 **같은 페이지를 매일 다시 친다**(L1)
 *
 * ## ⚠조건부 요청(L7)으로는 못 고친다 — 다시 조사하지 마라
 *
 * 실측(2026-08-25 · 아카이브 사이드카 **32,398개** 중 **3,000 표본**):
 * `etag` **0건** · `lastModified` **0건**. **상류가 검증자를 하나도 안 준다.**
 * 그래서 `304` 경로는 영영 안 타고, 「매번 200 + sha 비교」는 우리 결함이 아니라 상류의 성질이다.
 * 재현: `data/archive/npb/**\/*.meta.json` 을 열어 두 필드를 세라.
 *
 * ⚠**신규 저장 경로는 두 파일이 여전히 다르다** — `players.ts` 는 `checkedAt` 을 같이 쓰고
 * `archiveUrl` 은 안 쓴다. **무해하다**: 그때는 두 값이 같고, 읽는 쪽(`store/src/meta.ts`)이
 * `checkedAt ?? fetchedAt` 으로 떨어뜨린다. 사이드카를 32,398개만큼 키우지 않으려고 그대로 둔다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySink } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import { archiveUrl, markSeen } from "../src/archive.ts";
import { PoliteFetcher } from "../src/fetcher.ts";
import type { FetchImpl } from "../src/fetcher.ts";

const T0 = "2026-08-20T00:00:00.000Z";
const T1 = "2026-08-25T09:00:00.000Z";

function meta(over: Partial<BlobMeta> = {}): BlobMeta {
  return {
    url: "https://npb.jp/x",
    fetchedAt: T0,
    lastModified: null,
    etag: null,
    status: 200,
    sha256: "abc",
    byteLength: 3,
    revision: 1,
    ...over,
  };
}

test("전에 본 적이 없으면 남길 것이 없다 — 빈 메타를 지어내지 않는다", async () => {
  const sink = new MemorySink();
  await markSeen(sink, { now: () => new Date(T1) }, "k", null);
  assert.equal(await sink.readMeta("k"), null, "없던 키에 메타가 생겼다");
});

test("⚠본문·revision·fetchedAt 은 그대로 두고 checkedAt 만 얹는다", async () => {
  const sink = new MemorySink();
  await sink.write("k", new TextEncoder().encode("old"), meta());
  await markSeen(sink, { now: () => new Date(T1) }, "k", await sink.readMeta("k"));
  const m = (await sink.readMeta("k"))!;
  assert.equal(m.checkedAt, T1, "「봤다」가 안 남았다");
  assert.equal(m.fetchedAt, T0, "fetchedAt 이 움직였다 — 「마지막으로 바뀐 시각」이어야 한다");
  assert.equal(m.revision, 1, "안 바뀌었는데 revision 이 올랐다(M5)");
  assert.equal(new TextDecoder().decode((await sink.readBody("k"))!), "old", "본문을 다시 썼다");
});

/** 같은 응답을 두 번 받는 가짜 서버 — ⚠**검증자를 안 준다**(상류 실측과 같은 모양) */
function server(body: string): FetchImpl {
  const bytes = new TextEncoder().encode(body);
  return async () => ({
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

/** ⚠**이것이 고친 대상이다** — 고치기 전에는 경기 페이지의 checkedAt 이 영영 안 생겼다 */
test("⚠archiveUrl: 내용이 같으면 본문은 안 쓰고 「봤다」만 남긴다", async () => {
  const sink = new MemorySink();
  let now = T0;
  const deps = {
    fetcher: new PoliteFetcher({
      userAgent: "test",
      clock: { now: () => new Date(now) },
      fetchImpl: server("same"),
      minDelayMs: 0,
      sleep: async () => {},
    }),
    sink,
    clock: { now: () => new Date(now) },
  };

  const first = await archiveUrl("npb/games/2026/x/box", "https://npb.jp/x", deps);
  assert.equal(first.outcome, "stored");
  const a = (await sink.readMeta("npb/games/2026/x/box"))!;
  assert.equal(a.fetchedAt, T0);

  now = T1;
  const second = await archiveUrl("npb/games/2026/x/box", "https://npb.jp/x", deps);
  assert.equal(second.outcome, "unchanged", "내용이 같은데 stored 로 셌다");
  const b = (await sink.readMeta("npb/games/2026/x/box"))!;
  assert.equal(b.checkedAt, T1, "「봤다」가 안 남았다 — 취득일이 실제보다 낡게 나간다");
  assert.equal(b.fetchedAt, T0, "fetchedAt 이 움직였다");
  assert.equal(b.revision, a.revision, "안 바뀌었는데 revision 이 올랐다(M5)");
});

/**
 * ⚠**규칙이 두 벌이 되지 않게 못 박는다**(M1).
 * `players.ts` 의 「안 바뀌었을 때」 경로는 이 한 벌을 불러야 한다 —
 * 예전에는 같은 코드가 거기 따로 있었고, 그래서 경기·일정 페이지가 이 규칙을 못 받았다.
 */
test("⚠players.ts 는 자기 벌을 갖지 않고 markSeen 을 부른다", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(
    fileURLToPath(new URL("../src/players.ts", import.meta.url)),
    "utf8",
  );
  assert.match(src, /markSeen\(/, "players.ts 가 공용 규칙을 안 부른다");
  // 「안 바뀌었을 때」 경로에 자기 writeMeta 가 다시 생기면 두 벌이 된다
  const seen = /const seen = async[\s\S]*?\n    \};/.exec(src);
  assert.notEqual(seen, null, "players.ts 의 seen() 을 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(
    !/writeMeta/.test(seen![0]),
    `seen() 안에 자기 writeMeta 가 돌아왔다 — markSeen 한 벌만 써라:\n${seen![0]}`,
  );
});
