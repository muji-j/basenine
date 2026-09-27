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

/**
 * ⚠**id 선택자를 조용히 「불일치」로 버렸다**(2026-09-27 · PR-D 교차 모델 검토 P3 · 디자인 감사 공통).
 * `El` 에 id 가 없어 `#favBtn{…}` 이 언제나 안 맞았다 — 브라우저에서는 id 가 클래스를 이기는데
 * 계산기는 클래스 쪽 값을 냈다. 파일 머리의 원칙(「모르면 조용히 틀리지 말 것」)을 어긴 자리였다.
 */
test("⚠id 선택자는 요소의 id 로 맞추고 특이도에서 클래스를 이긴다 — 조용히 버리지 않는다", () => {
  const fav = { tag: "button", classes: ["favbtn"], id: "favBtn" };
  const r = parseRules(`#favBtn{min-height:1px} .favbtn{min-height:24px}`);
  assert.equal(computed(r, fav, "min-height"), "1px", "뒤에 온 클래스가 앞의 id 를 이겼다 — 특이도를 안 봤다");
  const imp = parseRules(`#favBtn{min-height:1px!important}.favbtn{min-height:24px}`);
  assert.equal(computed(imp, fav, "min-height"), "1px");
  // id 가 없거나 다른 요소에는 안 맞는다
  assert.equal(computed(r, { tag: "button", classes: ["favbtn"] }, "min-height"), "24px");
  assert.equal(computed(r, { ...fav, id: "other" }, "min-height"), "24px");
  assert.deepEqual(elementOf("#favBtn.favbtn", "button"), { tag: "button", classes: ["favbtn"], attrs: {}, id: "favBtn" });
});

/**
 * ⚠**가상 요소를 잰다**(2026-09-27 · 감사 N8b·N8c). 생성 콘텐츠도 접근 가능한 이름에 드는데(AccName),
 * 계산기가 `::before` 를 가진 선택자를 **늘 「불일치」로 버려서** 그 값을 물을 방법이 없었다.
 * `pseudo` 를 주면 그 가상 요소를 잰다 — 선택자의 나머지(태그·클래스·속성)는 요소 자신에, 결합자 앞은 조상에 맞춘다.
 * ⚠**`ancestors: []` 를 준다** — 안 주면 조상 조건을 「맞는다」로 보므로 조상 규칙이 전부 이긴다(파일 머리 · 한계).
 */
test("가상 요소는 pseudo 를 준 쪽에만 맞는다 — 요소 자신·다른 가상 요소에는 안 맞고, 조상 조건은 맞춰 본다", () => {
  const r = parseRules(
    `.card::before{content:"a"} .card[aria-selected="true"]::before{content:"b";content:"b" / ""}` +
      ` .card::after{content:"z"} .card{content:"self"} th[aria-sort="ascending"] .card::before{content:"up"}`,
  );
  const bare = { ...BTN, ancestors: [] };
  // 특이도(0,2,1)가 (0,1,1)을 이기고, 같은 규칙 안에서는 뒤 선언이 이긴다
  assert.equal(computed(r, { ...bare, pseudo: "before" }, "content"), `"b" / ""`);
  assert.equal(computed(r, { ...bare, attrs: { "aria-selected": "false" }, pseudo: "before" }, "content"), `"a"`);
  assert.equal(computed(r, { ...bare, pseudo: "after" }, "content"), `"z"`, "::before 규칙이 ::after 에 맞았다");
  // ⚠**pseudo 없이 물으면 요소 자신이다** — 옛 동작 그대로 가상 요소 규칙은 안 맞는다
  assert.equal(computed(r, bare, "content"), `"self"`);
  // 결합자 앞 조건(조상)을 맞춰 본다 — 맞는 조상이 있으면 특이도가 더 높은 그 규칙이 이긴다
  const sorted = { ...BTN, pseudo: "before" as const, ancestors: [{ tag: "th", classes: [], attrs: { "aria-sort": "ascending" } }] };
  assert.equal(computed(r, sorted, "content"), `"up"`);
  // ⚠**가상 요소는 조상 자리에 올 수 없다** — `.x::before .card` 같은 것은 어느 조상에도 안 맞는다
  const odd = parseRules(`.card::before .card{display:none} .card{display:block}`);
  assert.equal(computed(odd, { ...BTN, ancestors: [{ tag: "div", classes: ["card"] }] }, "display"), "block");
  // ⚠**:not 의 안쪽은 주인 요소에 맞춘다** — 가상 요소 판정이 안쪽까지 번지면 :not 이 늘 통과한다(첫 구현이 그랬다)
  const neg = parseRules(`.card::before{content:"base"} .card:not([aria-selected="false"])::before{content:"on"}`);
  assert.equal(computed(neg, { ...bare, attrs: { "aria-selected": "false" }, pseudo: "before" }, "content"), `"base"`,
    ":not 의 안쪽이 가상 요소 판정을 받아 늘 불일치가 됐다 — :not 이 거꾸로 맞는다");
  assert.equal(computed(neg, { ...bare, pseudo: "before" }, "content"), `"on"`);
});

/**
 * ⚠**켜진 미디어 안의 `:root` 재정의도 따라간다**(2026-09-27 · PR-D 검토 P3).
 * 옛 판은 첫 `@media` 앞의 `:root` 만 읽어서, `@media (pointer:coarse){:root{--hit:20px}}` 를 더해도
 * 손가락 장면의 N13 시험이 24px 로 통과했다 — **그 시험이 재야 할 바로 그 장면**을 못 봤다.
 * ⚠이 시험은 예전에 「미디어 안 재정의를 무시한다」를 정답으로 고정하고 있었다(아래 첫 단언만 있었다).
 */
test("길이를 px 로 푼다 — 토큰을 따라가고, 켠 미디어의 :root 재정의를 반영하고, 모르는 형태는 던진다", () => {
  const css = `:root{--a:var(--b);--b:24px} @media print{:root{--a:1px}}`;
  assert.equal(toPx(css, "var(--a)"), 24);
  assert.equal(toPx(css, "var(--a)", (q) => q === "print"), 1, "켠 미디어 안의 :root 재정의를 안 봤다");
  assert.equal(toPx(css, "13px"), 13);
  assert.throws(() => toPx(css, "calc(1px + 2px)"), /풀 수 없는/);
  assert.throws(() => toPx(css, "var(--none)"), /없는 토큰/);
  // ⚠**요소 단위 재정의는 이 계산기가 모른다** — 조용히 :root 값을 내지 않고 던진다
  assert.throws(() => toPx(`:root{--a:1px} .x{--a:2px}`, "var(--a)"), /요소 단위/);
});
