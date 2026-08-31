/**
 * **내보낼 때 주석을 떼는 것이 안전한가.**
 *
 * ⚠**「길이가 줄었다」는 안전의 증거가 아니다** — 규칙을 하나 잘라먹어도 줄어든다.
 * 그래서 재는 것은 **줄어든 양이 아니라 남은 내용**이다.
 *
 * ⚠**이 방식이 깨지는 조건은 하나다**: 문자열·정규식 안에 `/*` 나 `*​/` 가 들어가는 것.
 * 그때는 **코드를 잘라먹는다.** 실측으로 지금은 0건이지만 **그 측정은 「오늘」의 것**이라
 * 여기서 매번 다시 잰다 — 누군가 그런 문자열을 넣는 날 **그날 바로** 붉어진다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync } from "node:zlib";
import { CLIENT_JS, CSS } from "../src/assets.ts";
import { cssRules, stripBlockComments } from "../src/ship.ts";

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const br = (s: string): number => brotliCompressSync(Buffer.from(s, "utf8")).length;

/**
 * ⚠**이것이 이 기능의 안전 근거다.** 주석을 뗀 뒤에도 `/*` 나 `*​/` 가 남아 있으면
 * **문자열 안에 있었다는 뜻**이고, 그렇다면 정규식이 코드를 잘라먹었을 수 있다.
 */
test("⚠주석 표시가 문자열 안에 없다 — 있으면 이 방식이 코드를 잘라먹는다", () => {
  for (const [name, src] of [["CSS", CSS], ["JS", CLIENT_JS]] as const) {
    const out = stripBlockComments(src);
    assert.equal((out.match(/\/\*/g) ?? []).length, 0, `${name}: 문자열 안에 여는 주석 표시가 있다`);
    assert.equal((out.match(/\*\//g) ?? []).length, 0, `${name}: 문자열 안에 닫는 주석 표시가 있다`);
  }
});

/**
 * ⚠**규칙이 하나도 안 바뀌어야 한다.** 선택자와 본문의 쌍을 통째로 비교한다 —
 * 하나라도 잘리거나 붙으면 여기서 떨어진다.
 */
test("⚠CSS 규칙이 한 줄도 안 바뀐다 — 주석만 사라진다", () => {
  const before = cssRules(CSS);
  const after = cssRules(stripBlockComments(CSS));
  assert.ok(before.length > 300, `규칙을 ${before.length}개밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.deepEqual(after, before, "주석을 떼자 CSS 규칙이 달라졌다");
});

/**
 * ⚠**미디어 쿼리와 중괄호 균형도 본다** — 규칙 비교만으로는 `@media` 블록이
 * 통째로 열린 채 남는 경우를 못 잡는다.
 */
test("⚠중괄호가 맞고 미디어 쿼리 수가 같다", () => {
  const out = stripBlockComments(CSS);
  const open = (out.match(/\{/g) ?? []).length;
  const close = (out.match(/\}/g) ?? []).length;
  assert.equal(open, close, `중괄호가 안 맞는다: ${open} vs ${close}`);
  assert.equal(
    (out.match(/@media/g) ?? []).length,
    (CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/@media/g) ?? []).length,
    "미디어 쿼리 수가 달라졌다",
  );
});

/**
 * ⚠**JS 는 「돈다」까지 봐야 한다.** 문법이 깨지면 화면이 통째로 죽는데,
 * 그건 배포된 뒤에야 보인다.
 */
test("⚠주석을 뗀 클라이언트 스크립트가 문법으로 성립한다", () => {
  const out = stripBlockComments(CLIENT_JS);
  assert.doesNotThrow(
    () => new Function("document", "localStorage", "window", "fetch", "location", out),
    "주석을 떼자 스크립트가 깨졌다",
  );
});

/**
 * ⚠**「실제로 그렇게 내보내지는가」는 `site.test.ts` 가 본다** — 그쪽에 `buildSite` 픽스처가 있다.
 * 여기서 픽스처를 복제하면 두 벌이 되어 언젠가 갈린다(M1).
 * **함수만 있고 안 쓰면 아무 이득이 없다** — 이 저장소가 이미 두 번 겪은 병이라 그 시험은 반드시 있어야 한다.
 */

/**
 * ⚠**이득이 사라지면 알아야 한다.** 누군가 주석을 코드로 바꾸거나 이 단계를 껐을 때
 * **조용히 되돌아가는 것**을 막는다.
 * ⚠**압축 후로 잰다** — 사용자가 실제로 받는 것은 그쪽이다.
 * 기준선은 2026-08-31 실측(CSS −74.1% · JS −49.4%)에서 여유를 둔 값이다.
 */
test("⚠주석 제거가 실제로 이득이다 — 압축 후로 잰다", () => {
  const cssCut = 1 - br(stripBlockComments(CSS)) / br(CSS);
  const jsCut = 1 - br(stripBlockComments(CLIENT_JS)) / br(CLIENT_JS);
  assert.ok(cssCut > 0.5, `CSS 절감이 ${(cssCut * 100).toFixed(1)}% 다 — 이 단계의 이득이 사라졌다`);
  assert.ok(jsCut > 0.3, `JS 절감이 ${(jsCut * 100).toFixed(1)}% 다 — 이 단계의 이득이 사라졌다`);
  // 원본 크기도 남긴다 — 다음 사람이 「얼마였는지」를 알 수 있게
  assert.ok(bytes(CSS) > 100_000, `CSS 가 ${bytes(CSS)}B 다 — 기준선이 낡았다`);
});
