import { test } from "node:test";
import assert from "node:assert/strict";
import { attrToken, escapeHtml, html, raw, toString } from "../src/html.ts";

test("끼워 넣는 값은 자동으로 이스케이프된다", () => {
  const evil = `<img src=x onerror="alert(1)">`;
  const out = toString(html`<td>${evil}</td>`);
  assert.equal(out, "<td>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</td>");
});

test("따옴표와 홑따옴표도 막는다 — 속성값에 들어가는 경로가 있다", () => {
  assert.equal(escapeHtml(`"'`), "&quot;&#39;");
});

test("raw()로 표시한 것만 그대로 들어간다", () => {
  const child = html`<b>안</b>`;
  assert.equal(toString(html`<p>${child}</p>`), "<p><b>안</b></p>");
  assert.equal(toString(html`<p>${raw("<b>안</b>")}</p>`), "<p><b>안</b></p>");
});

test("배열은 이어 붙고 null/undefined는 사라진다", () => {
  assert.equal(toString(html`${[1, 2, 3]}${null}${undefined}`), "123");
});

test("숫자도 문자열로 들어간다", () => {
  assert.equal(toString(html`<td>${442}</td>`), "<td>442</td>");
});

test("attrToken은 속성값에 쓸 수 없는 문자를 지운다", () => {
  assert.equal(attrToken(`a b"c'd<e`), "abcde");
  assert.equal(attrToken("wrc-Plus_1"), "wrc-Plus_1");
});

test("선수명에 태그가 섞여도 문서 구조가 깨지지 않는다", () => {
  const out = toString(html`<span class="nm">${"</span><script>x()</script>"}</span>`);
  assert.ok(!out.includes("<script>"), "스크립트 태그가 살아 나가면 안 된다");
  assert.equal(out.match(/<span/g)?.length, 1);
});
