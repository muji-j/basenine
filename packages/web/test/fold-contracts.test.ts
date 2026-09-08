/**
 * **접기 둘의 계약을 못 박는다** — 시즌 띠와 홈 목차.
 *
 * ⚠**이 파일은 2차 검토 F7 이 「이 계약을 붙드는 시험이 0본이다」라고 지적해서 생겼다.**
 * 2f 는 시험 파일 셋을 만졌지만 전부 **기존 단언을 실측에 맞춘 것**이었고
 * **새로 지킨 것은 0건**이었다. 지켜지지 않던 것 넷:
 *
 * 1. 목차가 **기본 펼침**이다(`checked`) — **2c 의 정반대 결정**이라 되돌아가기 쉽다.
 * 2. 시즌 접기의 문턱이 **7시즌**이다 — 「눌러도 아무 일이 없는 손잡이」를 안 만들려는 값이다.
 * 3. 두 손잡이가 **`<nav>` 밖**에 있다 — 소스 주석 두 곳이 「안에 넣으면 접었을 때 같이 숨어
 *    다시 못 편다」고 경고하는데, **경고만 있고 시험이 없었다.**
 * 4. CSS 가 **`.snwrap` 이라는 이름**에 의존한다 — 마크업만 고치면 조용히 죽는다.
 *
 * ⚠**그리고 F1·F2 가 만든 계약을 같이 지킨다**: 시즌 접기는 **높이가 아니라 개수**로 자르고
 * **`[aria-current="page"]` 는 예외**다. 높이로 자르면 ⑴2018년 화면에서 「지금 여기」가
 * 첫 줄 밖으로 밀려 **표식이 0개**가 되고 ⑵잘린 링크가 **초점을 그대로 먹어** 띠가
 * 「접혔다는데 둘째 줄만 보이는」 상태로 굳는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import { freshness, page, pathsFor } from "../src/layout.ts";
import type { SeasonLink } from "../src/layout.ts";
import { html } from "../src/html.ts";
import { CSS } from "../src/assets.ts";

/** 주석 안의 예시가 규칙으로 잡히면 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function seasonsOf(n: number): SeasonLink[] {
  return Array.from({ length: n }, (_, i) => ({
    season: 2026 - i,
    href: i === 0 ? "index.html" : `${String(2026 - i)}/index.html`,
    current: i === 0,
    fallback: false,
    fallbackTo: "",
  }));
}

function render(n: number): string {
  return page({
    title: "테스트",
    base: "",
    root: "",
    seasons: seasonsOf(n),
    navTo: pathsFor([], 2026)("index.html").navTo,
    color: NEUTRAL_COLOR,
    freshness: freshness("2026-08-14", "2026-08-15"),
    site: { name: "bb-app", contact: "a@example.invalid" },
    nav: "index",
    body: html`<p>본문</p>`,
  });
}

/** `<nav class="seasons…">…</nav>` 의 안쪽만 잘라 낸다 */
function insideSeasonsNav(page_: string): string {
  const at = page_.indexOf('<nav class="seasons');
  assert.ok(at >= 0, "시즌 띠를 못 찾았다 — 이 시험이 대상을 놓치고 있다");
  const end = page_.indexOf("</nav>", at);
  assert.ok(end > at, "시즌 띠가 안 닫혔다");
  return page_.slice(at, end);
}

test("⚠접기 문턱은 7시즌이다 — 6시즌에는 손잡이를 아예 안 낸다", () => {
  const six = render(6);
  assert.ok(!six.includes('class="sntoggle'), "6시즌인데 체크박스가 나왔다");
  assert.ok(!six.includes('class="snbtn"'), "6시즌인데 손잡이가 나왔다");
  assert.ok(!six.includes("seasons fold"), "6시즌인데 접기 표식이 붙었다");

  const seven = render(7);
  assert.ok(seven.includes('class="sntoggle'), "7시즌인데 체크박스가 없다");
  assert.ok(seven.includes('class="snbtn"'), "7시즌인데 손잡이가 없다");
  assert.ok(seven.includes("seasons fold"), "7시즌인데 접기 표식이 없다");
});

test("⚠손잡이는 시즌 띠(nav) 밖이다 — 안에 넣으면 접었을 때 같이 숨어 다시 못 편다", () => {
  const out = render(9);
  assert.ok(
    !insideSeasonsNav(out).includes('class="snbtn"'),
    "손잡이가 nav 안으로 들어갔다 — 접히면 자기도 숨어 되돌릴 수단이 없어진다",
  );
  assert.ok(out.includes('class="snbtn"'), "손잡이 자체가 사라졌다");
});

test("⚠CSS 가 의존하는 상자 이름(.snwrap)이 마크업에 실제로 나온다", () => {
  const out = render(9);
  assert.ok(out.includes('class="snwrap"'), "마크업에 .snwrap 이 없다");
  assert.ok(
    css.includes(".sntoggle:not(:checked) ~ .snwrap") || css.includes(".sntoggle:checked ~ .snwrap"),
    "CSS 가 .snwrap 을 거치지 않는다 — 이름을 바꿨으면 양쪽을 같이 고쳐야 한다",
  );
});

/**
 * ⚠**높이로 자르면 두 가지가 깨진다**(2026-09-08 · 2차 검토 F1·F2). 그 둘을 여기서 막는다.
 * 자세한 사유는 `assets.ts` 의 `.seasons.fold` 문단에 있다.
 */
test("⚠시즌 접기는 높이가 아니라 개수로 자른다 — max-height/overflow 로 자르지 않는다", () => {
  const foldRules = [...css.matchAll(/([^{}]*\.seasons\.fold[^{}]*)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel!.trim(), body: body!.trim() }));
  assert.ok(foldRules.length > 0, ".seasons.fold 규칙을 못 찾았다 — 이 시험이 헛돈다");

  const byHeight = foldRules.filter((r) => /max-height|overflow/.test(r.body));
  assert.deepEqual(
    byHeight.map((r) => `${r.sel} { ${r.body} }`),
    [],
    "시즌 접기를 높이로 자르고 있다.\n" +
      "⚠**그러면 「지금 여기」가 첫 줄 밖으로 밀리고**(2018년 화면에서 현재 칩은 9개 중 9번째다)\n" +
      "  **잘린 링크가 초점을 그대로 먹어** 띠가 스스로 굴러 굳는다. 개수로 잘라라.",
  );

  assert.ok(
    foldRules.some((r) => /display:\s*none/.test(r.body) && /nth-of-type/.test(r.sel)),
    "개수로 자르는 규칙(nth-of-type + display:none)이 없다",
  );
});

test("⚠접어도 「지금 여기」는 남는다 — aria-current 가 예외로 적혀 있다", () => {
  const rule = [...css.matchAll(/([^{}]*\.seasons\.fold[^{}]*)\{([^{}]*)\}/g)]
    .find(([, , body]) => /display:\s*none/.test(body!));
  assert.ok(rule, "개수로 자르는 규칙을 못 찾았다");
  assert.match(
    rule![1]!,
    /:not\(\[aria-current="page"\]\)/,
    "잘라 내는 규칙에 aria-current 예외가 없다 — 과거 시즌 화면에서 표식이 통째로 사라진다",
  );
});

test("⚠첫 자식은 라벨이므로 nth-of-type 으로 센다 — nth-child 면 연도가 하나씩 밀린다", () => {
  const out = render(9);
  const inside = insideSeasonsNav(out);
  const firstTag = /<(\w+)/.exec(inside.slice(inside.indexOf(">") + 1));
  assert.equal(firstTag?.[1], "span", "띠의 첫 자식이 라벨(span.slab)이 아니다 — 세는 방식을 다시 보라");
  assert.ok(
    !/\.seasons\.fold[^{}]*nth-child/.test(css),
    "접기가 nth-child 로 세고 있다 — 첫 자식이 라벨이라 연도가 하나씩 밀린다",
  );
});
