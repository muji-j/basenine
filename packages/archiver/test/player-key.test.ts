/**
 * **선수 ID 는 외부 문자열이고 여기서 경로가 된다.**
 *
 * ⚠`playerKey()` 가 형태를 안 봤다(2026-08-24 · 감사 P3 #14). `../` 가 섞이면
 * **아카이브 루트 밖에 쓴다** — 아카이브는 **소급 불가 자산**이라 그 밖으로 새는 것이 특히 나쁘다.
 *
 * ⚠**같은 값에 대해 `web/src/site.ts` 는 이미 같은 검사를 하고 있었다** — 여기만 없었다.
 * **같은 부류가 한쪽만 지켜지는 비대칭**이 이 결함의 모양이다.
 *
 * ⚠**지금 틀린 값은 0건이다**(실측: 선수 1,640명 전원 안전한 형태). **잠재 결함**을 막는 장치다.
 * ⚠**조용히 정규화하지 않고 던진다** — 정규화하면 「무엇을 받았는지」가 사라지고,
 * 그건 아카이브에서 가장 나쁜 종류의 손실이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { playerKey } from "../src/players.ts";

test("정상 ID 는 그대로 키가 된다", () => {
  assert.equal(playerKey("01105135"), "npb/players/01105135");
});

test("영숫자·밑줄·하이픈은 허용한다", () => {
  assert.equal(playerKey("a-b_9"), "npb/players/a-b_9");
});

/** ⚠**이것이 고친 대상이다** — 고치기 전에는 루트 밖 키가 그대로 나왔다 */
for (const evil of ["../../etc/passwd", "..", "a/../../b", "x/y", "a\\b", "", "a b", "a.html"]) {
  test(`⚠경로로 쓸 수 없는 ID 는 던진다: ${JSON.stringify(evil)}`, () => {
    assert.throws(() => playerKey(evil), /경로로 쓸 수 없는/);
  });
}

/** ⚠**던지는 것이 요점이다** — 조용히 고쳐서 통과시키면 무엇을 받았는지 모른다 */
test("⚠정규화해서 통과시키지 않는다", () => {
  let key: string | null = null;
  try {
    key = playerKey("../x");
  } catch {
    key = null;
  }
  assert.equal(key, null, "던지지 않고 무언가를 돌려줬다 — 조용히 고친 것이다");
});
