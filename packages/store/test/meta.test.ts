/**
 * ⚠**「언제 받았는가」를 적재 시각으로 대신하면, 낡은 것이 낡은 줄 모른다**(M4).
 *
 * 실제로 그 일이 났다(2026-08-17): 선수 페이지를 8/15에 받고 다시 받지 않았는데
 * 적재는 매일 돌았고, `fetched_at` 에 **적재 시각**이 들어가 매일 「오늘 받았다」가 됐다.
 * 화면에도 취득일이 없어서 아무도 눈치채지 못했고, 결국 **「NPB 가 우리보다 늦다」고 오진**해
 * 두 출처를 이어 붙이는 코드까지 얹었다(전부 되돌렸다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchedAtOf } from "../src/meta.ts";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-meta-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("사이드카의 fetchedAt 을 그대로 읽는다", async () => {
  await withDir(async (dir) => {
    const p = join(dir, "x.meta.json");
    await writeFile(p, JSON.stringify({ url: "https://npb.jp/x", fetchedAt: "2026-08-15T03:51:56.478Z", status: 200 }));
    assert.equal(fetchedAtOf(p), "2026-08-15T03:51:56.478Z");
  });
});

/**
 * ⚠**우리가 답해야 하는 질문은 「이 값을 마지막으로 언제 확인했나」다.**
 *
 * 아카이버는 **내용이 안 바뀌면 본문도 `fetchedAt` 도 다시 쓰지 않는다**(`players.ts`).
 * 그래서 `fetchedAt` 은 「마지막으로 **바뀐**」 시각이고, 그것만 보면 두 개가 망가진다:
 * · 화면이 실제보다 낡은 날짜를 말한다
 * · 재취득 선정이 「아직 안 받았다」로 오판해 **같은 페이지를 매일 다시 친다**(L1)
 * 그래서 `checkedAt`(마지막으로 본 시각)이 있으면 그쪽을 쓴다.
 */
test("⚠checkedAt 이 있으면 그쪽이다 — fetchedAt 은 「마지막으로 바뀐」 시각이다", async () => {
  await withDir(async (dir) => {
    const p = join(dir, "c.meta.json");
    await writeFile(p, JSON.stringify({
      fetchedAt: "2026-08-15T03:51:56.478Z",
      checkedAt: "2026-08-17T02:00:00.000Z",
      revision: 3,
    }));
    assert.equal(fetchedAtOf(p), "2026-08-17T02:00:00.000Z", "「마지막으로 본 시각」을 무시했다");
  });
});

/**
 * ⚠**옛 사이드카에는 `checkedAt` 이 없다.** 그때는 `fetchedAt` 이 곧 확인 시각이었으므로
 * 그대로 떨어뜨린다 — 없다고 `null` 을 내면 아카이브 전체가 하루아침에 「취득일 모름」이 된다.
 */
test("⚠checkedAt 이 없는 옛 사이드카는 fetchedAt 으로 떨어진다(하위호환)", async () => {
  await withDir(async (dir) => {
    const p = join(dir, "old.meta.json");
    await writeFile(p, JSON.stringify({ fetchedAt: "2026-08-15T03:51:56.478Z", revision: 1 }));
    assert.equal(fetchedAtOf(p), "2026-08-15T03:51:56.478Z");
    // 빈 문자열이면 없는 것으로 보고 fetchedAt 으로 떨어진다
    const q = join(dir, "empty-checked.meta.json");
    await writeFile(q, JSON.stringify({ fetchedAt: "2026-08-15T03:51:56.478Z", checkedAt: "" }));
    assert.equal(fetchedAtOf(q), "2026-08-15T03:51:56.478Z");
  });
});

/**
 * ⚠**「모른다」를 「오늘」로 바꾸지 않는다**(M11). 여기서 오늘 날짜를 돌려주면
 * 취득 시각을 모르는 페이지가 **가장 신선한 것처럼** 보이고, 재취득 대상에서도 빠진다.
 */
test("⚠읽지 못하면 null 이다 — 오늘로 떨어뜨리지 않는다", async () => {
  await withDir(async (dir) => {
    // 파일이 없다
    assert.equal(fetchedAtOf(join(dir, "none.meta.json")), null, "없는 파일에 값을 줬다");
    // JSON 이 깨졌다
    const broken = join(dir, "broken.meta.json");
    await writeFile(broken, "{ not json");
    assert.equal(fetchedAtOf(broken), null, "깨진 JSON 에 값을 줬다");
    // 키가 없다
    const nokey = join(dir, "nokey.meta.json");
    await writeFile(nokey, JSON.stringify({ url: "https://npb.jp/x" }));
    assert.equal(fetchedAtOf(nokey), null, "키가 없는데 값을 줬다");
    // 타입이 다르다 — 옛 사이드카가 숫자였을 수도 있다
    const num = join(dir, "num.meta.json");
    await writeFile(num, JSON.stringify({ fetchedAt: 1755000000000 }));
    assert.equal(fetchedAtOf(num), null, "문자열이 아닌 값을 그대로 통과시켰다");
    // 빈 문자열도 「모른다」다 — 날짜로 자르면 "" 가 되어 화면이 이상해진다
    const empty = join(dir, "empty.meta.json");
    await writeFile(empty, JSON.stringify({ fetchedAt: "" }));
    assert.equal(fetchedAtOf(empty), null, "빈 문자열을 취득 시각이라고 했다");
  });
});

/**
 * ⚠**문법은 맞는데 객체가 아닌 JSON 에서 예외가 났다**(2026-09-11 · 콜드 리뷰 지적).
 *
 * `JSON.parse("null")` 은 성공하고 `null` 을 돌려주므로 `m.checkedAt` 에서 **TypeError** 로 멈췄다 —
 * 사이드카 한 장 때문에 **적재기 전체**가 뒤 파일까지 못 읽는다. 「모른다」는 null 이지 예외가 아니다.
 * ⚠실물 아카이브에서는 0장이다(로컬 사이드카 **32,695장 전수** · 객체 아님 0) — 그래도 막는다.
 */
test("⚠객체가 아닌 사이드카는 null 이다 — 예외로 적재를 멈추지 않는다", async () => {
  await withDir(async (dir) => {
    for (const [name, body] of [
      ["null", "null"],
      ["array", "[]"],
      ["string", JSON.stringify("2026-08-15T03:51:56.478Z")],
      ["number", "42"],
    ] as const) {
      const p = join(dir, `${name}.meta.json`);
      await writeFile(p, body);
      let got: string | null | undefined;
      assert.doesNotThrow(() => { got = fetchedAtOf(p); }, `JSON ${name} 에서 예외가 났다`);
      assert.equal(got, null, `JSON ${name} 에 값을 줬다`);
    }
  });
});

/**
 * ⚠**날짜로 읽을 수 없는 문자열을 취득 시각이라고 돌려줬다**(2026-09-11 · 콜드 리뷰 지적).
 *
 * 그 값이 신선도 맥박(`MAX(fetched_at)`)에 섞이면 문자열 비교로 **아무 날보다 늦은 날**이 될 수도 있다.
 * → **`YYYY-MM-DDTHH:MM` 으로 시작하고 `Date.parse` 가 유한할 때만** 인정한다.
 * ⚠`checkedAt` 이 무효면 `fetchedAt` 으로 떨어진다 — 옛 사이드카를 다루는 규칙(`checkedAt` 없음)과 같은 방향이다.
 */
test("⚠날짜가 아닌 값은 버린다 — checkedAt 이 무효면 fetchedAt, 둘 다 무효면 null", async () => {
  await withDir(async (dir) => {
    const fallback = join(dir, "fallback.meta.json");
    await writeFile(fallback, JSON.stringify({ checkedAt: "not-a-date", fetchedAt: "2026-08-15T03:51:56.478Z" }));
    assert.equal(fetchedAtOf(fallback), "2026-08-15T03:51:56.478Z", "무효한 checkedAt 을 믿었다");

    const both = join(dir, "both.meta.json");
    await writeFile(both, JSON.stringify({ checkedAt: "not-a-date", fetchedAt: "2026-13-99T00:00:00Z" }));
    assert.equal(fetchedAtOf(both), null, "둘 다 무효인데 값을 줬다");

    // 날짜만 있고 시각이 없다 — 아카이버가 쓰는 모양(`toISOString`)이 아니다
    const dateOnly = join(dir, "date-only.meta.json");
    await writeFile(dateOnly, JSON.stringify({ fetchedAt: "2026-08-15" }));
    assert.equal(fetchedAtOf(dateOnly), null, "시각 없는 날짜를 취득 시각이라고 했다");
  });
});

/**
 * ⚠**같은 시각이 다른 표기로 들어오면 문자열 비교가 틀린다**(2026-09-11 · 콜드 리뷰 지적).
 *
 * 신선도 판정은 취득 시각을 **문자열로** 비교한다(`MAX(fetched_at)` · 「예고보다 늦은 휴식 공표」).
 * `2026-10-30T09:00:00+09:00`(= `00:00Z`)은 `2026-10-30T01:00:00Z` 보다 **한 시간 이른데**, 문자열로는 앞의 것이 크다.
 * → 돌려줄 때 **UTC `toISOString` 한 모양**으로 맞춘다. 실물은 전부 그 모양이라(CI DB 5개 표 · `Z` 아닌 값 0) 바뀌는 값이 없다.
 */
test("⚠취득 시각은 UTC 한 모양으로 돌려준다 — 표기가 달라도 같은 시각은 같은 문자열이다", async () => {
  await withDir(async (dir) => {
    const jst = join(dir, "jst.meta.json");
    await writeFile(jst, JSON.stringify({ checkedAt: "2026-10-30T09:00:00+09:00" }));
    assert.equal(fetchedAtOf(jst), "2026-10-30T00:00:00.000Z", "시간대 표기를 그대로 돌려줬다");

    const noMs = join(dir, "no-ms.meta.json");
    await writeFile(noMs, JSON.stringify({ fetchedAt: "2026-08-15T03:51:56Z" }));
    assert.equal(fetchedAtOf(noMs), "2026-08-15T03:51:56.000Z");

    // 이미 아카이버 모양이면 그대로다 — 실물이 바뀌지 않는다
    const canonical = join(dir, "canonical.meta.json");
    await writeFile(canonical, JSON.stringify({ checkedAt: "2026-08-17T02:00:00.123Z" }));
    assert.equal(fetchedAtOf(canonical), "2026-08-17T02:00:00.123Z");
  });
});

/**
 * ⚠**시간대 표기가 없는 시각은 기계마다 다른 시각이 된다**(2026-09-11 · 3중 검토 2차 N3 · 실측).
 *
 * `Date.parse("2026-09-10T05:00")` 은 **실행 기계의 현지 시간**으로 읽는다 — 이 기계(JST)에서 `2026-09-09T20:00Z`,
 * UTC 인 CI 에서 `05:00Z` 로 **9시간이 갈린다.** 같은 문자열을 SQLite `datetime()` 은 UTC 로 읽어 **SQL 과 JS 도 갈린다.**
 * → 시간대 표기(`Z` · `±HH:MM`)가 없으면 **모른다(null)** 로 둔다. 실물 사이드카는 전부 `Z` 모양이라 바뀌는 값이 없다.
 */
test("⚠시간대 표기가 없는 시각은 버린다 — 기계마다 다른 시각이 된다", async () => {
  await withDir(async (dir) => {
    const naive = join(dir, "naive.meta.json");
    await writeFile(naive, JSON.stringify({ checkedAt: "2026-09-10T05:00:00", fetchedAt: "2026-09-10T05:00" }));
    assert.equal(fetchedAtOf(naive), null, "시간대 없는 시각을 실행 기계의 현지 시간으로 읽었다");

    const fallback = join(dir, "naive-fallback.meta.json");
    await writeFile(fallback, JSON.stringify({ checkedAt: "2026-09-10T05:00:00.000", fetchedAt: "2026-09-09T05:00:00.000Z" }));
    assert.equal(fetchedAtOf(fallback), "2026-09-09T05:00:00.000Z", "시간대 없는 checkedAt 을 믿었다");

    // 끝에 딴 글자가 붙은 값도 모양이 아니다
    const tail = join(dir, "tail.meta.json");
    await writeFile(tail, JSON.stringify({ fetchedAt: "2026-09-10T05:00:00.000Zjunk" }));
    assert.equal(fetchedAtOf(tail), null, "끝에 딴 글자가 붙은 값을 취득 시각이라고 했다");
  });
});
