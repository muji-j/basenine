/**
 * **용어 설명을 여닫는 규칙** — 터치·마우스·키보드가 같은 요소를 공유한다.
 *
 * ⚠**여기서 재는 것은 두 가지 실제 결함이다**(2026-08-21 감사 P1 · 같은 날 수정).
 *
 * ① **터치의 첫 탭이 아무 일도 안 했다.** 브라우저는 한 번의 탭에서 `click` 앞에
 *    `mouseenter` 와 `focus` 를 **합성**하는데, 그 둘이 이미 설명을 열어 놓으므로
 *    `click` 시점에 `current === btn` 을 보면 **방금 자기가 연 것을 자기가 닫는다.**
 *    실기 실측(Chromium 151 · `hasTouch:true` · 390x844): 탭1 `false` · 탭2 `true` · 탭3 `false`.
 *    ⚠`mouseenter` 만 떼는 안으로는 **안 나았다** — 같은 조건에서 그 배선을
 *    `matchMedia("(hover: hover) and (pointer: fine)")` 로 막고 다시 재도 탭1 은 여전히 `false` 다.
 *
 * ② **스크롤이 포커스로 여는 길을 막았다.** `scroll → hide` 가 걸려 있어서,
 *    포커스가 스크롤을 유발하면 그 스크롤이 방금 연 설명을 닫았다.
 *    실기 A/B(선수 페이지 · 용어 54개 · 같은 요소): 최상단에서 `focus()` **3/54** 대
 *    `scrollIntoView` 뒤 `focus()` **54/54**.
 *
 * ⚠**브라우저가 아니다**(`dom-stub.ts`). 여기서 재는 것은 우리 로직의 순서이고,
 * 자리·크기는 실기로만 잰다(`place()` 는 `getBoundingClientRect` 가 없으면 조기 반환한다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS, CSS } from "../src/assets.ts";
import { glossaryKeys } from "../src/glossary.ts";
import { El, make, makeDocument, makeStorage } from "./dom-stub.ts";

const TERM = glossaryKeys()[0]!;

interface Stage {
  doc: ReturnType<typeof makeDocument>;
  btn: El;
  /** 정렬 버튼처럼 **탭으로 열지 않는** 용어(class="term" 이 없다) */
  head: El;
  tip: El;
  open: () => boolean;
}

function stage(): Stage {
  const doc = makeDocument("");
  const btn = make("button", { class: "term", "data-term": TERM });
  doc.body.appendChild(btn);
  const head = make("button", { "data-term": TERM });
  doc.body.appendChild(head);
  const tip = make("div", { id: "tip", role: "tooltip" });
  tip.hidden = true;
  doc.body.appendChild(tip);
  new Function("document", "localStorage", "window", "fetch", "location", CLIENT_JS)(
    doc,
    makeStorage(),
    {},
    () => Promise.reject(new Error("no network")),
    { search: "", href: "" },
  );
  return { doc, btn, head, tip, open: () => !tip.hidden };
}

/**
 * 브라우저가 **한 번의 탭**에서 내는 순서 그대로 쏜다.
 * 실측 순서(Chromium 151 · `hasTouch:true`): pointerdown → mouseenter → focus → click.
 * ⚠**두 번째 탭부터는 `mouseenter` 가 안 온다**(포인터가 이미 「위」에 있다) —
 * 그 비대칭이 이 결함의 본체라서 첫 탭인지 아닌지를 인자로 받는다.
 */
function tap(s: Stage, first: boolean): void {
  s.btn.fire("pointerdown");
  if (first) s.btn.fire("mouseenter");
  if (first) s.btn.fire("focus");
  s.btn.fire("click");
}

test("⚠터치: 첫 탭에 설명이 열린다 — 예전에는 탭1 이 열고 곧바로 닫았다", () => {
  const s = stage();
  tap(s, true);
  assert.equal(s.open(), true, "탭1 에서 안 열렸다 — 이것이 P1 그 자체다");
  tap(s, false);
  assert.equal(s.open(), false, "탭2 에서 안 닫혔다 — 같은 것을 다시 누르면 닫혀야 한다");
  tap(s, false);
  assert.equal(s.open(), true, "탭3 에서 다시 안 열렸다");
});

test("⚠마우스: 호버로 열리고 누르면 닫힌다 — 토글은 그대로 남는다", () => {
  const s = stage();
  s.btn.fire("mouseenter");
  assert.equal(s.open(), true, "호버로 안 열렸다");
  s.btn.fire("pointerdown");
  s.btn.fire("click");
  assert.equal(s.open(), false, "호버 중 클릭이 안 닫혔다");
  s.btn.fire("pointerdown");
  s.btn.fire("click");
  assert.equal(s.open(), true, "다시 클릭했는데 안 열렸다");
  s.btn.fire("mouseleave");
  assert.equal(s.open(), false, "포인터가 떠났는데 안 닫혔다");
});

test("⚠키보드: 포인터 없는 click(Enter/Space)도 토글한다", () => {
  const s = stage();
  s.btn.fire("focus");
  assert.equal(s.open(), true, "포커스로 안 열렸다");
  // pointerdown 없이 오는 click — 이 경우에만 지금 상태로 토글한다
  s.btn.fire("click");
  assert.equal(s.open(), false, "Enter 로 안 닫혔다");
  s.btn.fire("click");
  assert.equal(s.open(), true, "Enter 로 다시 안 열렸다");
});

test("⚠스크롤이 설명을 닫지 않는다 — 닫으면 포커스로 여는 길이 통째로 막힌다", () => {
  const s = stage();
  s.btn.fire("focus");
  assert.equal(s.open(), true, "포커스로 안 열렸다 — 이 시험이 공회전한다");
  s.doc.fire("scroll", { target: s.doc });
  assert.equal(s.open(), true, "스크롤이 설명을 닫았다 — 이것이 P1 ② 그 자체다");
  s.doc.fire("scroll", { target: s.tip });
  assert.equal(s.open(), true, "툴팁 안을 굴렸더니 닫혔다");
});

test("⚠Escape 와 바깥 클릭은 그대로 닫는다 — 닫는 길까지 잃지 않았다", () => {
  const s = stage();
  s.btn.fire("focus");
  assert.equal(s.open(), true);
  s.doc.fire("keydown", { key: "Escape" });
  assert.equal(s.open(), false, "Escape 로 안 닫혔다");
  s.btn.fire("focus");
  assert.equal(s.open(), true);
  s.doc.fire("click", { target: s.doc.body });
  assert.equal(s.open(), false, "바깥을 눌렀는데 안 닫혔다");
});

/**
 * ⚠**정렬 버튼(`class="term"` 이 없는 용어)에는 호버·포커스만 붙는다.**
 * 탭이 「정렬」과 「설명 열기」를 겸하면 어느 쪽이 일어난 건지 알 수 없기 때문이다.
 * ⚠**그래서 호버 배선을 마우스 전용으로 좁히면 안 된다** — 배포물 전수에서
 * 구단 페이지 **108장**의 16개 용어(obp·slg·ops·pa·gidp·src·wrcPlus·woba·wraa·whip·
 * innings·srp·fip·k9·bb9·pitchesPerOut)는 **설명 경로가 정렬 버튼뿐**이고,
 * 손가락에서는 합성된 `mouseenter` 가 그 유일한 길이다(§0-1).
 */
test("⚠정렬 버튼의 용어는 호버로 열린다 — 손가락에서 그것이 유일한 길인 페이지가 108장 있다", () => {
  const s = stage();
  assert.equal(s.head.getAttribute("aria-expanded"), null, "탭으로 여는 버튼이 아니어야 한다");
  s.head.fire("mouseenter");
  assert.equal(s.open(), true, "정렬 버튼의 용어가 호버로 안 열렸다");
  s.head.fire("mouseleave");
  assert.equal(s.open(), false);
});

/**
 * **용어 버튼의 판정 영역** — WCAG 2.2 SC 2.5.8 Target Size (Minimum) 은 **24 × 24 CSS px** 을 요구한다.
 *
 * ⚠**넓히는 규칙이 `@media (pointer:coarse)` 안에 있었다**(2026-09-08 · design-auditor P2).
 * 그래서 마우스에서는 판정 영역이 글자 그대로 **22 × 17** 이었다 — 10.5px 글자 한 덩어리다.
 * ⚠**2.5.8 에는 「포인터가 정밀하면 면제」가 없다.** 면제는 인라인 텍스트 안의 링크·필수 크기·
 * 같은 기능이 옆에 또 있는 경우인데, 이 버튼은 **그 용어 설명을 여는 유일한 자리**다.
 * → 미디어 쿼리 밖으로 뺐다. 좌우 +7 · 상하 +5 이므로 **36 × 27** 이 된다.
 *
 * ⚠**CSS 문자열 검사로는 못 잡던 결함이다** — 규칙은 그대로 있었고 **어느 미디어 안에 있는가**만 달랐다.
 * 그래서 이 시험은 「규칙이 있는가」가 아니라 **「어느 블록 안에 있는가」**를 본다.
 */
test("⚠용어 버튼의 판정 영역이 마우스에서도 24×24 를 넘는다 — coarse 안에 가두지 마라", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /(?:^|[\n}])\s*\.term::after\{([^{}]*)\}/.exec(css);
  assert.notEqual(rule, null, ".term::after 규칙이 없다 — 이 시험이 공회전한다");

  /** `@media (pointer:coarse)` 블록들의 본문 — 그 안에 있으면 마우스에서는 안 걸린다 */
  const coarse: string[] = [];
  for (const at of css.matchAll(/@media \(pointer:coarse\)[^{]*\{/g)) {
    let depth = 0;
    const start = at.index! + at[0]!.length;
    for (let i = start - 1; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) { coarse.push(css.slice(start, i)); break; }
      }
    }
  }
  // ⚠**공회전 방지** — coarse 블록을 하나도 못 찾으면 아래 단언이 언제나 통과한다
  assert.ok(coarse.length >= 3, `@media (pointer:coarse) 블록을 ${coarse.length}개밖에 못 찾았다`);
  assert.ok(
    !coarse.some((b) => /\.term::after\{/.test(b)),
    "판정 영역을 넓히는 규칙이 다시 @media (pointer:coarse) 안으로 들어갔다 —\n" +
      "  ⚠마우스에서 22 × 17 로 돌아간다(SC 2.5.8 은 24 × 24 를 요구하고 포인터로 면제하지 않는다)",
  );

  // 실제 크기를 **계산**한다 — 글자 상자 + 좌우·상하 확장
  const px = (name: string): number => {
    const m = new RegExp(`${name}:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(rule![1]!);
    assert.notEqual(m, null, `.term::after 에 ${name} 이 없다: ${rule![1]}`);
    return Number(m![1]);
  };
  // 글자 상자: 항목명 10.5px 두 글자(=21px 남짓) · 줄높이 1.55 → 약 22 × 17 로 측정됐다
  const TEXT_W = 22;
  const TEXT_H = 17;
  const w = TEXT_W + -px("left") + -px("right");
  const h = TEXT_H + -px("top") + -px("bottom");
  assert.ok(w >= 24, `판정 영역의 가로가 ${w}px 이다 — SC 2.5.8 은 24px 을 요구한다`);
  assert.ok(h >= 24, `판정 영역의 세로가 ${h}px 이다 — SC 2.5.8 은 24px 을 요구한다`);
  // ⚠**위아래를 더 넓히지 마라** — 항목 줄 간격이 25px 남짓이라 옆 줄의 설명이 뜬다(그 주석이 근거다)
  assert.ok(-px("top") <= 5, `위쪽 확장이 ${-px("top")}px 이다 — 5px 을 넘으면 옆 줄과 겹친다`);
  assert.ok(-px("bottom") <= 5, `아래쪽 확장이 ${-px("bottom")}px 이다 — 5px 을 넘으면 옆 줄과 겹친다`);
  console.log(`  · .term 판정 영역 ${w} × ${h}px (글자 ${TEXT_W} × ${TEXT_H} + 확장)`);
});
