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
import { CLIENT_JS } from "../src/assets.ts";
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
