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
 *
 * ## ⚠겹친 작성자 — 되살리기가 새 판을 옛 판으로 되돌리지 않는다(2026-09-27 · 반영분 재검토 P2)
 *
 * 로컬 본문을 읽는 동안(비동기) 다른 작성자(겹친 수동 백필 — `sink.ts` 의 `writeAtomic` 주석이 인정한다)가 새 판 B 를 쓰면,
 * 예전 되살리기는 그 B 를 「짝이 틀린 본문」으로 오인해 **옛 A 로 덮고** 기록할 때 읽은 **늦은 시각**을 붙였다 — 적재기가 A 를 새 판으로
 * 받아 DB 를 조용히 되돌렸다. 두 겹으로 막는다: ⑴ 본 시각은 **응답 직후 한 번** 읽는다(모든 기록이 그 값) · ⑵ 쓰기 직전에 사이드카를
 * **다시 읽어** 요청 전의 것과 다르면 되살리지 않는다(비교-후-쓰기). 같은 키의 프로세스 간 직렬화는 범위 밖이다(설계 §12).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSink, MemorySink, sha256 } from "../src/sink.ts";
import type { BlobMeta, Sink } from "../src/sink.ts";
import { archivePlayer, playerKey } from "../src/players.ts";
import { PoliteFetcher } from "../src/fetcher.ts";
import type { Clock } from "../src/clock.ts";

const ID = "01005134";
const KEY = playerKey(ID);
const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-27T03:00:00.000Z";
/** 겹친 작성자가 새 판을 쓴 시각 */
const T2 = "2026-09-27T03:00:05.000Z";
/** 첫 수집기의 본문 읽기가 끝난 시각(늦은 읽기) */
const T3 = "2026-09-27T03:00:09.000Z";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const A = enc("<html>본문 A — 사이드카가 말하는 내용</html>");
const B = enc("<html>본문 B — 짝이 틀린 로컬 파일</html>");
const clock = { now: () => new Date(T1) };

/** 같은 본문을 돌려주는 가짜 상류 — ⚠검증자를 안 준다(상류 실측과 같은 모양) · 요청 수를 센다 */
function upstream(body: Uint8Array, c: Clock = clock, status = 200): { fetcher: PoliteFetcher; calls: () => number } {
  let n = 0;
  const fetcher = new PoliteFetcher({
    userAgent: "bb-app-test",
    clock: c,
    fetchImpl: async () => {
      n += 1;
      return {
        status,
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

/** 손으로 옮기는 시계 — 응답을 받는 동안은 `at` 이고, 시험이 도중에 옮긴다 */
function movableClock(start: string): Clock & { set: (t: string) => void } {
  let now = start;
  return { now: () => new Date(now), set: (t: string) => { now = t; } };
}

/**
 * 안쪽 싱크를 감싸 **본문 읽기**(`onReadBody`)나 **본문 쓰기**(`onWrite`) 직전에 시험이 끼어들게 한다 — 겹친 작성자를 결정론적으로 만든다.
 * 끼어들기는 한 번만 한다(두 번째부터는 그냥 지나간다).
 */
function interleaving(inner: Sink, hooks: { onReadBody?: () => Promise<void>; onWrite?: () => Promise<void> }): Sink {
  let readDone = false;
  let writeDone = false;
  return {
    readMeta: (k) => inner.readMeta(k),
    readBody: async (k) => {
      if (!readDone && hooks.onReadBody) {
        readDone = true;
        await hooks.onReadBody();
      }
      return inner.readBody(k);
    },
    write: async (k, b, m) => {
      if (!writeDone && hooks.onWrite) {
        writeDone = true;
        await hooks.onWrite();
      }
      return inner.write(k, b, m);
    },
    writeMeta: (k, m) => inner.writeMeta(k, m),
  };
}

test("⚠2차 F1 · 짝 불일치(본문만 다름) + 상류가 사이드카와 같다 — 받은 바이트로 본문을 되살린다 · revision·fetchedAt·sha 불변 · 요청 1", async () => {
  const sink = new MemorySink();
  await sink.write(KEY, B, meta(A)); // 사이드카는 A 를 말하는데 본문은 B
  sink.writeCount = 0;
  const up = upstream(A);
  const r = await archivePlayer(ID, { fetcher: up.fetcher, sink, clock });
  assert.equal(r.outcome, "unchanged", "내용은 사이드카가 말하는 그대로다 — 새 판이 아니다");
  assert.deepEqual(await sink.readBody(KEY), A, "본문을 되살리지 않았다 — 짝 불일치가 영영 남는다");
  assert.equal(r.repair, "rewritten", "본문을 되살렸다고 말하지 않는다");
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
  assert.deepEqual(await sink.readBody(KEY), A, "빠진 본문을 되살리지 않았다");
  assert.equal(r.repair, "rewritten");
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
    assert.deepEqual(await sink.readBody(KEY), A, "깨진 본문을 그대로 뒀다");
    assert.equal(r.repair, "rewritten");
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
  assert.equal(r.repair, undefined, "멀쩡한 사본을 되살렸다고 한다");
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
  assert.equal(r.repair, undefined);
  assert.deepEqual(await sink.readBody(KEY), C);
  const m = (await sink.readMeta(KEY))!;
  assert.equal(m.revision, 4);
  assert.equal(m.sha256, sha256(C));
});

// ─── 반영분 재검토 P2 · 겹친 작성자 · 본 시각(2026-09-27) ───

/**
 * ⚠⚠**재검토자 재현 그대로다** — 짝이 맞는 A/A(revision 1)에서 첫 수집기가 A 를 t1 에 받고 로컬 본문을 읽는 동안, 다른 작성자가
 * 새 판 B(revision 2 · t2)를 본문·사이드카로 쓴다. 예전에는 첫 수집기가 그 B 를 「짝이 틀린 본문」으로 오인해 **A 로 덮고 t3 을 붙였다**
 * (최종 A/A · revision 1 · checkedAt t3 → 적재가 A 를 새 판으로 받는다). → 쓰기 직전에 사이드카를 다시 읽어 **요청 전과 다르면 안 쓴다.**
 * 변이 「재확인 삭제」가 이 시험을 붉게 만든다.
 */
test("⚠⚠반영분 재검토 P2 · 본문을 읽는 사이 다른 작성자가 새 판 B 를 쓰면 되살리지 않는다 — B/B 가 남고 결과는 concurrent", async () => {
  const inner = new MemorySink();
  await inner.write(KEY, A, meta(A, { revision: 1, checkedAt: T0 }));
  inner.writeCount = 0;
  const c = movableClock(T1);
  const sink = interleaving(inner, {
    onReadBody: async () => {
      c.set(T2);
      await inner.write(KEY, B, meta(B, { revision: 2, fetchedAt: T2, checkedAt: T2 }));
      c.set(T3);
    },
  });
  const r = await archivePlayer(ID, { fetcher: upstream(A, c).fetcher, sink, clock: c });
  assert.deepEqual(await inner.readBody(KEY), B, "다른 작성자의 새 판 B 본문을 옛 A 로 덮었다");
  const m = (await inner.readMeta(KEY))!;
  assert.equal(m.sha256, sha256(B), "다른 작성자의 새 판 B 사이드카를 옛 A 로 덮었다");
  assert.equal(m.revision, 2, "사이드카 카운터가 되돌아갔다");
  assert.equal(m.checkedAt, T2);
  assert.equal(inner.writeCount, 1, "이 수집기가 본문을 썼다 — 다른 작성자의 한 번만 있어야 한다");
  assert.equal(inner.metaWriteCount, 0, "이 수집기가 사이드카를 썼다");
  assert.equal(r.outcome, "unchanged");
  assert.equal(r.repair, "concurrent", "되살리지 않은 이유(겹친 작성자)를 결과가 말하지 않는다");
});

/**
 * ⚠**본 시각은 응답 직후 한 번 읽는다** — 로컬 본문 읽기가 늦어져도(시계가 t3 으로 갔다) 되살린 사이드카의 `checkedAt` 은 받은 시각 t1 이다.
 * 기록할 때 시계를 다시 읽으면 옛 내용에 늦은 시각이 붙어 적재가 그것을 더 새 판으로 믿는다(`archive.ts` `prepareUrl` 과 같은 규칙).
 * 변이 「되살리기가 시계를 뒤에서 읽음」이 이 시험을 붉게 만든다.
 */
test("⚠반영분 재검토 P2 · 본문 읽기가 늦어도 되살린 사이드카의 checkedAt 은 받은 시각(t1)이다", async () => {
  const inner = new MemorySink();
  await inner.write(KEY, B, meta(A));
  const c = movableClock(T1);
  const sink = interleaving(inner, { onReadBody: async () => c.set(T3) });
  const r = await archivePlayer(ID, { fetcher: upstream(A, c).fetcher, sink, clock: c });
  assert.deepEqual(await inner.readBody(KEY), A);
  assert.equal((await inner.readMeta(KEY))!.checkedAt, T1, "되살린 사이드카에 늦은 기록 시각이 붙었다 — 옛 내용이 새 판처럼 보인다");
  assert.equal(r.repair, "rewritten");
});

/** 「봤다」(짝이 맞는 경로)도 같다 — 본문 읽기가 늦어도 `checkedAt` 은 받은 시각. 변이 「markSeen 에 본 시각을 안 넘김」이 붉게 만든다 */
test("⚠반영분 재검토 P2 · 짝이 맞는 「봤다」도 본문 읽기가 늦어도 checkedAt 은 받은 시각(t1)이다", async () => {
  const inner = new MemorySink();
  await inner.write(KEY, A, meta(A));
  const c = movableClock(T1);
  const sink = interleaving(inner, { onReadBody: async () => c.set(T3) });
  const r = await archivePlayer(ID, { fetcher: upstream(A, c).fetcher, sink, clock: c });
  assert.equal(r.repair, undefined);
  assert.equal((await inner.readMeta(KEY))!.checkedAt, T1, "「봤다」에 늦은 기록 시각이 붙었다");
});

/**
 * ⚠**모든 기록이 한 번 읽은 본 시각을 쓴다** — 시계를 부를 때마다 1ms 씩 가는 시계로 잰다. 예전에는 404 경로가 `checkedAt`·`absentAt` 을,
 * 새 판 경로가 `fetchedAt`·`checkedAt` 을 **따로** 읽어 서로 달랐다(한 벌이 아니다). 이제 둘 다 같은 값이다.
 */
test("반영분 재검토 P2 · 404 의 checkedAt = absentAt · 새 판의 fetchedAt = checkedAt — 본 시각 한 벌", async () => {
  let ms = Date.parse(T1);
  const ticking: Clock = { now: () => new Date(ms++) };
  const absent = new MemorySink();
  await absent.write(KEY, A, meta(A));
  const r404 = await archivePlayer(ID, { fetcher: upstream(A, ticking, 404).fetcher, sink: absent, clock: ticking });
  assert.equal(r404.outcome, "absent");
  const m404 = (await absent.readMeta(KEY))!;
  assert.equal(m404.checkedAt, m404.absentAt, "404 경로가 시계를 두 번 읽었다");

  const stored = new MemorySink();
  await stored.write(KEY, A, meta(A));
  const C = enc("<html>본문 C</html>");
  const rNew = await archivePlayer(ID, { fetcher: upstream(C, ticking).fetcher, sink: stored, clock: ticking });
  assert.equal(rNew.outcome, "stored");
  const mNew = (await stored.readMeta(KEY))!;
  assert.equal(mNew.fetchedAt, mNew.checkedAt, "새 판 경로가 시계를 두 번 읽었다");
});

/**
 * ⚠**좁힌 창 안의 경합은 남는다**(설계 §12) — 재확인과 쓰기 사이에 다른 작성자가 끼면 옛 A 가 덮는다. 그때도 A 의 시각은 받은 시각 t1 이라
 * B(t2)보다 이르다 — 적재 판정이 **옛 판**이 되어 DB 는 B 를 지킨다(적재기 쪽 종단 시험은 `packages/store/test/load-players.test.ts`).
 */
test("반영분 재검토 P2 · 재확인과 쓰기 사이에 끼면 A 가 덮지만 그 시각은 t1 이다(B 의 t2 보다 이르다)", async () => {
  const inner = new MemorySink();
  await inner.write(KEY, B, meta(A, { revision: 1 })); // 짝 불일치(본문 B · 사이드카 A)
  const c = movableClock(T1);
  // ⚠본문 읽기가 늦어 시계가 t3 으로 간다 — 기록할 때 시계를 다시 읽는 구현이면 여기서 t3 이 붙는다(쓰기 인자는 쓰기 **전에** 만들어진다)
  const sink = interleaving(inner, {
    onReadBody: async () => c.set(T3),
    onWrite: async () => {
      await inner.write(KEY, B, meta(B, { revision: 2, fetchedAt: T2, checkedAt: T2 }));
    },
  });
  const r = await archivePlayer(ID, { fetcher: upstream(A, c).fetcher, sink, clock: c });
  const m = (await inner.readMeta(KEY))!;
  assert.equal(m.sha256, sha256(A));
  assert.equal(m.checkedAt, T1, "덮은 A 에 늦은 시각이 붙었다 — 적재가 A 를 B 보다 새 판으로 믿는다");
  assert.ok(Date.parse(m.checkedAt!) < Date.parse(T2));
  assert.equal(r.repair, "rewritten");
});
