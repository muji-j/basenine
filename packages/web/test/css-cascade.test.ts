/**
 * **시험용 캐스케이드 계산기(`css-cascade.ts`)를 먼저 잰다.**
 *
 * ⚠계산기가 틀리면 그 위에 선 시험(강제 색 초점 · 인쇄 숨김 · 터치 표적)이 **틀린 채로 초록**이 된다 —
 * 이 저장소가 「공회전」이라고 부르는 모양이다. 그래서 답을 손으로 아는 작은 CSS 로 규칙마다 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computed, elementOf, parseRules, toPx } from "./css-cascade.ts";

const BTN = { tag: "button", classes: ["card"], attrs: { "aria-selected": "true" } };

test("특이도가 높은 쪽이 이긴다 — 뒤에 와도 낮으면 진다", () => {
  const r = parseRules(`.card[aria-selected="true"]{outline:2px solid red} :focus-visible{outline:3px dashed blue}`);
  assert.equal(computed(r, { ...BTN, focused: true }, "outline-style"), "solid");
  assert.equal(computed(r, { ...BTN, focused: true }, "outline-width"), "2px");
});

test("특이도가 같으면 뒤에 온 것이 이긴다 · !important 는 그 위다", () => {
  const r = parseRules(`.card{display:block} .card{display:flex}`);
  assert.equal(computed(r, BTN, "display"), "flex");
  const imp = parseRules(`.card{display:grid!important} .card[aria-selected="true"]{display:flex}`);
  assert.equal(computed(imp, BTN, "display"), "grid");
});

test("@media 는 켠 조건만 들어온다 · 숏핸드는 빠진 칸을 초기값으로 되감는다", () => {
  const r = parseRules(`.card{outline:2px solid red;outline-offset:1px} @media print{.card{outline:none}}`);
  assert.equal(computed(r, BTN, "outline-style"), "solid");
  assert.equal(computed(r, BTN, "outline-style", (q) => q === "print"), "none");
  assert.equal(computed(r, BTN, "outline-width", (q) => q === "print"), "medium");
  // outline-offset 은 outline 숏핸드에 없다 — 되감기지 않는다
  assert.equal(computed(r, BTN, "outline-offset", (q) => q === "print"), "1px");
});

test("가상 요소·다른 클래스·모르는 속성값은 맞지 않는다 · :not 과 ^= 를 푼다", () => {
  const r = parseRules(
    `.card::before{display:none} .tab{display:none} .card[aria-selected="false"]{display:none}` +
      ` .card:not([aria-selected="false"]){display:inline} a[href^="http"]{display:none}`,
  );
  assert.equal(computed(r, BTN, "display"), "inline");
  assert.equal(computed(r, { tag: "a", classes: [], attrs: { href: "https://x" } }, "display"), "none");
});

test("조상을 주면 결합자 앞 조건을 맞춰 보고, 모르는 구조 의사 클래스는 던진다", () => {
  const r = parseRules(`.idline .favbtn{min-height:24px} .other .favbtn{min-height:10px}`);
  const fav = { tag: "button", classes: ["favbtn"], ancestors: [{ tag: "header", classes: ["idline"] }] };
  assert.equal(computed(r, fav, "min-height"), "24px");
  assert.throws(() => computed(parseRules(`.card:first-child{display:none}`), BTN, "display"), /모르는 의사 클래스/);
  assert.deepEqual(elementOf('.card[aria-selected="true"]', "button"), BTN);
});

test("길이를 px 로 푼다 — 토큰을 따라가고, 모르는 형태는 던진다", () => {
  const css = `:root{--a:var(--b);--b:24px} @media print{:root{--a:1px}}`;
  assert.equal(toPx(css, "var(--a)"), 24);
  assert.equal(toPx(css, "13px"), 13);
  assert.throws(() => toPx(css, "calc(1px + 2px)"), /풀 수 없는/);
  assert.throws(() => toPx(css, "var(--none)"), /없는 토큰/);
});
