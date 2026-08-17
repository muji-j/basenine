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
