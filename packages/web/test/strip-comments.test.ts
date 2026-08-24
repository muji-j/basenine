/**
 * **주석 제거** — 배포물의 11.4%가 주석이었다.
 *
 * 실측(2026-08-24 · `dist` 15,341장 전수): 주석 **359,399개 · 114.62 MiB · html 총량의 11.39%**.
 * gzip 표본 300장에서 **전송량 22.19% 절감** — 매 페이지가 5분의 1 이상 가벼워진다.
 * ⚠**Pages 20,000파일 벽에는 효과 0**이다. 줄어드는 것은 **전송량과 용량**이지 파일 수가 아니다.
 *
 * ## ⚠이 시험이 재는 것은 「지웠는가」가 아니라 「안 지워야 할 것을 남겼는가」다
 *
 * 지우는 쪽은 정규식 하나면 된다. **위험은 반대편에 있다** —
 * `<script>` · `<style>` · `<pre>` · `<textarea>` 안의 `<!--` 는 **주석이 아니라 내용**이고,
 * 그걸 지우면 **스크립트가 조용히 망가진다.**
 *
 * ⚠**「지금 그런 블록이 0개다」는 안전의 근거가 아니다**(실측으로 0개인 것은 맞다).
 * 「오늘 없다」는 「내일도 없다」가 아니고 **JS 문자열 하나면 생긴다** — 그래서 구조로 막고 여기서 못 박는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw, stripComments, toString } from "../src/html.ts";

test("주석을 뗀다", () => {
  assert.equal(stripComments("<p>a</p><!-- 왜 이렇게 했는가 --><p>b</p>"), "<p>a</p><p>b</p>");
});

test("여러 줄 주석도 뗀다 — 이 저장소의 주석은 대부분 여러 줄이다", () => {
  assert.equal(stripComments("<i></i><!--\n  긴\n  설명\n--><b></b>"), "<i></i><b></b>");
});

test("주석이 없으면 그대로다", () => {
  const s = '<div class="x">텍스트</div>';
  assert.equal(stripComments(s), s);
});

/**
 * ⚠**여기가 이 시험의 존재 이유다.** 네 구역 안의 `<!--` 는 내용이지 주석이 아니다.
 */
for (const tag of ["script", "style", "pre", "textarea"] as const) {
  test(`⚠<${tag}> 안의 <!-- 는 건드리지 않는다 — 그건 주석이 아니라 내용이다`, () => {
    const inner = `x = "<!-- 이건 문자열이다 -->";`;
    const s = `<p>a</p><!-- 진짜 주석 --><${tag}>${inner}</${tag}><!-- 또 하나 -->`;
    assert.equal(stripComments(s), `<p>a</p><${tag}>${inner}</${tag}>`);
  });
}

test("⚠구역이 여럿이어도 각각 건너뛴다 — 첫 구역만 보고 멈추지 않는다", () => {
  const s = "<!--a--><script>1<!--x--></script><!--b--><style>2<!--y--></style><!--c-->";
  assert.equal(stripComments(s), "<script>1<!--x--></script><style>2<!--y--></style>");
});

/** ⚠**닫는 태그가 다른 이름이면 구역이 아니다** — 역참조가 그걸 지킨다 */
test("⚠여는 태그와 닫는 태그가 다르면 구역으로 보지 않는다", () => {
  const out = stripComments("<script>a</style><!-- 주석 -->");
  assert.ok(!out.includes("주석"), "짝이 안 맞는데 구역으로 보고 주석을 남겼다");
});

/** 속성이 붙어도 구역이다 */
test("속성이 붙은 여는 태그도 구역으로 본다", () => {
  const s = `<script type="module" defer>let a="<!--";</script><!-- 주석 -->`;
  assert.equal(stripComments(s), `<script type="module" defer>let a="<!--";</script>`);
});

/**
 * ⚠**출력 경계에 실제로 걸려 있는가.** 함수만 있고 안 불리면 아무것도 안 고쳐진다 —
 * 이 저장소는 「그 코드가 있다」로 「효력이 있다」를 확인했다가 데인 적이 있다.
 */
test("⚠toString 이 주석을 뗀다 — 함수만 만들고 안 부르면 소용없다", () => {
  const page = html`<div>${"이름"}</div>${raw("<!-- 왜 -->")}<p>끝</p>`;
  const out = toString(page);
  assert.ok(!out.includes("<!--"), `toString 이 주석을 남겼다: ${out}`);
  assert.ok(out.includes("이름") && out.includes("끝"), "내용까지 지웠다");
});

/**
 * ⚠**끼워 넣은 값에는 `<!--` 가 들어갈 수 없다** — `escapeHtml` 이 `<` 를 `&lt;` 로 바꾼다.
 * 그 전제 위에 이 함수가 서 있으므로 **전제 자체를 못 박는다.**
 */
test("⚠끼워 넣은 값의 <!-- 는 이스케이프되어 살아남는다 — 이 함수의 전제다", () => {
  const out = toString(html`<p>${"<!-- 사용자 값 -->"}</p>`);
  assert.ok(out.includes("&lt;!--"), `이스케이프가 안 됐다: ${out}`);
  assert.ok(!out.includes("<!--"), "이스케이프된 값이 주석으로 취급됐다");
});
