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

/**
 * ⚠**별표가 그대로 화면에 찍히고 있었다** — 실측 1,537장(2026-08-16).
 * 이 프로젝트의 문구는 어디서나 `**…**`로 강조를 쓰는데 `note()`만 순수 텍스트였다.
 * 값이 맞아도 화면이 어수선해지는 종류라 값 검사로는 잡히지 않는다.
 */
test("설명 줄의 별표 강조가 굵은 글자가 된다 — 별표가 그대로 남지 않는다", async () => {
  const { note } = await import("../src/parts.ts");
  const out = toString(note("これは**強調**です"));
  assert.equal(out, '<p class="note">これは<b>強調</b>です</p>');
  assert.ok(!out.includes("**"), "별표가 화면에 남았다");
});

test("⚠짝이 안 맞으면 아무것도 하지 않는다 — 억지로 자르면 엉뚱한 곳이 굵어진다", async () => {
  const { note } = await import("../src/parts.ts");
  assert.equal(toString(note("짝이 없는 **경우")), '<p class="note">짝이 없는 **경우</p>');
});

/**
 * ⚠**이스케이프가 살아 있어야 한다.** 이 문구에는 선수명·구단명이 섞여 들어온다 —
 * 우리가 만든 문자열이 아니므로 태그가 되면 안 된다.
 */
test("강조를 붙여도 태그는 글자로 남는다", async () => {
  const { note } = await import("../src/parts.ts");
  const out = toString(note("태그가 <b>섞여도</b> **굵게**"));
  assert.match(out, /&lt;b&gt;섞여도&lt;\/b&gt;/, "태그가 escape 되지 않았다");
  assert.match(out, /<b>굵게<\/b>/);
});
