/**
 * **상단 헤더가 스스로를 넘치지 않는다는 것을, 브라우저 없이 지킨다.**
 *
 * ⚠**실제로 났던 결함**(2026-08-19 감사 P1 · 15,340장 전부):
 * `.topbar` 가 `height:var(--topbar)` 고정인데 `.tnav{flex-wrap:wrap}` 이라 탭 8개가
 * **481~770px 에서 2행**이 됐다. 바 높이는 안 따라와서 탭줄이 위아래로 삐져나갔다 —
 * 실측 768px 에서 탭줄 `top:-7.1 ~ bottom:52.1`(바는 0~46)이라 **첫 행이 화면 위로 잘리고**
 * 아랫행이 시즌 띠를 배경 없이 덮었다. 폭 스윕 151점 중 **72점**이 그랬다(손가락에서는 76점).
 * 같은 구간에서 `#themeBtn` 의 「自動」이 「自/動」 2줄로 접혀 높이가 27 → **40px** 이 됐다.
 *
 * ⚠**이 파일은 「기하」가 아니라 「기하를 결정하는 구조」를 잰다.**
 * 진짜 기하는 레이아웃 엔진이 있어야 나오고, 그건 `tools/measure-topbar.ts` 가 한다
 * (playwright 필요 · 저장소 의존성이 아니다). 시험으로 만들면 CI 에서 **영구히 skip** 되고,
 * 그건 이 저장소가 여러 번 데인 「skipped 인데 종료 코드 0 이라 합격으로 읽힌다」 그 자리다
 * (작업규칙 8). → **CI 가 매번 지키는 것은 여기 적힌 불변식**이고,
 * 그 불변식이 성립하면 넘칠 방법이 없다는 것을 계측기가 실측으로 확인했다.
 * 실측(2026-08-20 · 400~1000px step 4 · index/球団/順位/対戦 4종 · 마우스와 손가락 양쪽):
 * 탭줄 이탈 **0/151** · 테마 버튼 초과 **0/151** · `--topbar` 와 실제 높이 불일치 **0/151**.
 *
 * ⚠**`--topbar` 는 다섯 곳이 읽는다** — `.rail`·`.hjump`·`.pickbar` 의 sticky 오프셋,
 * `scroll-padding-top`, `.shell` 의 최소 높이. 바가 그 높이가 **아니면** 앵커가 헤더 뒤로 숨는다.
 * 그래서 「넘치지 않는다」만으로는 부족하고 「자라지도 않는다」까지 지켜야 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** 주석을 지운 CSS — 주석 안의 예시 코드가 규칙으로 잡히면 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 하나의 선언 묶음을 전부 모은다(미디어쿼리 안의 것 포함) */
function bodiesOf(selector: string): string[] {
  const re = new RegExp(`(?:^|[{}\\s;])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]!);
}

/** `prop:` 의 값. 없으면 undefined */
function decl(body: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(body);
  return m === null ? undefined : m[1]!.trim();
}

/**
 * `@media` 블록을 조건과 내용으로 쪼갠다(이 파일의 @media 는 한 겹이다).
 *
 * ⚠**닫는 괄호 앞의 줄바꿈을 허용해야 한다** — 처음에 그걸 빠뜨렸더니 **한 줄짜리 8개만**
 * 걸리고 여러 줄짜리 20개가 통째로 안 보였다. 그러면 「접는 미디어쿼리가 0개」라는
 * **거짓 결론**이 나오고, 그 시험은 고칠 것이 있어도 조용히 지나간다.
 * (실측: 파일 안 @media 는 28개 · 고치기 전 이 함수가 본 것은 8개)
 */
function mediaBlocks(): { cond: string; body: string }[] {
  return [...css.matchAll(/@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map((m) => ({
    cond: m[1]!.trim(),
    body: m[2]!,
  }));
}

test("⚠@media 를 세는 방식이 헛돌지 않는다 — 이 파일의 다른 시험이 전부 여기에 얹혀 있다", () => {
  const seen = mediaBlocks().length;
  const total = (css.match(/@media/g) ?? []).length;
  assert.ok(total > 20, `@media 가 ${total}개뿐이다 — CSS 를 못 읽었을 가능성이 크다`);
  assert.equal(seen, total, `@media ${total}개 중 ${seen}개만 파싱됐다 — 나머지의 결함은 보이지 않는다`);
});

test("⚠.topbar 는 height 로 높이를 못 박지 않는다 — 넘치는 대신 자라야 한다", () => {
  const bodies = bodiesOf(".topbar");
  assert.ok(bodies.length > 0, ".topbar 규칙을 못 찾았다 — 이 시험이 공회전한다");
  const base = bodies[0]!;
  assert.equal(
    decl(base, "min-height"),
    "var(--topbar)",
    ".topbar 의 최소 높이가 --topbar 가 아니다 — 토큰을 읽는 다섯 곳이 어긋난다",
  );
  for (const b of bodies) {
    assert.equal(
      decl(b, "height"),
      undefined,
      `.topbar 에 height 를 박았다 — 안의 것이 넘쳐도 화면에는 안 보인다(2026-08-19 결함): ${b.slice(0, 80)}`,
    );
  }
});

test("⚠탭줄은 접히지 않는다 — 2행이 되면 바 밖으로 샌다", () => {
  const bodies = bodiesOf(".tnav");
  assert.ok(bodies.length > 0, ".tnav 규칙을 못 찾았다 — 이 시험이 공회전한다");
  assert.equal(decl(bodies[0]!, "flex-wrap"), "nowrap", "탭줄 기본이 nowrap 이 아니다 — 좁은 폭에서 2행이 된다");
  // ⚠**넘칠 때 잡을 수 있어야 한다**(.seasons·.hjump 와 같은 어법). 없으면 페이지가 가로로 늘어난다
  assert.equal(decl(bodies[0]!, "overflow-x"), "auto", "탭줄에 가로 스크롤이 없다 — 넘치면 잡을 수단이 사라진다");
  /**
   * ⚠**그 스크롤바가 자리를 먹으면 바 높이가 다시 거짓이 된다.**
   * headless 크로뮴은 오버레이 스크롤바라 0px 인데, **화면이 붙은 크로뮴(Windows)에서는
   * `scrollbar-width:thin` 이 실제로 9px 을 차지**해 탭줄 33 → 44px · 바 88 → 96.6px 이 됐다
   * (실측 2026-08-20 · 토큰은 88 인 채였다). 플랫폼마다 갈리는 값을 토큰에 담을 수는 없다.
   * ⚠**시즌 띠(.seasons)는 반대로 스크롤바를 보여 준다** — 거기 높이는 아무도 안 읽기 때문이다.
   */
  assert.equal(
    decl(bodies[0]!, "scrollbar-width"),
    "none",
    "탭줄 스크롤바가 자리를 먹는다 — 플랫폼에 따라 바가 9px 자라 --topbar 가 거짓이 된다",
  );
});

test("⚠테마 버튼은 글자에서 줄바꿈하지 않는다 — 「自動」이 「自/動」이 되면 높이가 40px 이 된다", () => {
  const bodies = bodiesOf(".tbtn");
  assert.ok(bodies.length > 0, ".tbtn 규칙을 못 찾았다 — 이 시험이 공회전한다");
  assert.equal(decl(bodies[0]!, "white-space"), "nowrap", ".tbtn 이 줄바꿈할 수 있다 — 폭 대신 높이가 늘어난다");
  assert.equal(decl(bodies[0]!, "flex"), "0 0 auto", ".tbtn 이 줄어들 수 있다 — 줄어들면 글자가 접힌다");
});

/**
 * ⚠**이것이 이 파일의 핵심 단언이다.**
 *
 * 헤더를 접는 것 자체는 좁은 화면에서 옳다 — 실제로 ≤680px 에서 검색칸이 제 줄로 내려간다.
 * 틀린 것은 **접으면서 `--topbar` 를 그대로 두는 것**이다. 예전 CSS 가 정확히 그랬다:
 * ≤480px 에 `.topbar{height:auto;flex-wrap:wrap}` 만 넣고 토큰은 44px 인 채였고,
 * 그 어긋남을 `scroll-padding-top:86px` 를 손으로 박아 메우려 했는데 **그 86 조차
 * 실측 113~115px 에 28px 모자랐다**(2026-08-20 계측).
 * → **접는 곳과 토큰을 다시 정하는 곳은 같은 블록이어야 한다.**
 */
test("⚠헤더를 접는 미디어쿼리는 --topbar 도 같이 다시 정한다", () => {
  const blocks = mediaBlocks();
  assert.ok(blocks.length > 0, "@media 블록을 못 찾았다 — 이 시험이 공회전한다");
  let wrapping = 0;
  for (const { cond, body } of blocks) {
    const topbar = /\.topbar\s*\{([^{}]*)\}/.exec(body);
    if (topbar === null || decl(topbar[1]!, "flex-wrap") !== "wrap") continue;
    wrapping += 1;
    assert.ok(
      /--topbar:\s*\d/.test(body),
      `${cond} 에서 헤더를 접는데 --topbar 를 다시 정하지 않았다 — 앵커가 헤더 뒤로 숨는다`,
    );
  }
  // ⚠**한 곳도 못 찾으면 위 루프가 통째로 헛돈 것이다** — 「접는 곳이 없다」는 지금 사실이 아니다
  assert.equal(wrapping, 1, `헤더를 접는 미디어쿼리가 1개여야 하는데 ${wrapping}개다 — 어느 쪽인지 다시 보라`);
});

/**
 * ⚠**손가락에서는 같은 CSS 가 더 두꺼워진다.**
 * `@media (pointer:coarse)` 가 `.tnav a` 의 패딩을 9px 로 올려 탭 높이가 27.0 → 36.6px 이 된다.
 * 접힌 헤더에서는 그게 그대로 바 높이라, 폭만 보고 정한 `--topbar` 는 손가락에서 다시 거짓이 된다
 * (실측 86px 토큰 · 실제 94.6px). **폭 조건과 함께 걸린 보정이 반드시 있어야 한다.**
 * ⚠**폭 조건 없는 보정은 반대로 틀린다** — 터치 노트북의 1200px 화면은 바가 46px 이다.
 */
test("⚠손가락(pointer:coarse)에도 --topbar 보정이 있고, 폭 조건이 붙어 있다", () => {
  const coarse = mediaBlocks().filter((b) => /pointer\s*:\s*coarse/.test(b.cond) && /--topbar:\s*\d/.test(b.body));
  assert.equal(coarse.length, 1, "손가락용 --topbar 보정이 정확히 하나여야 한다");
  assert.match(
    coarse[0]!.cond,
    /max-width\s*:\s*\d+px/,
    "손가락 보정에 폭 조건이 없다 — 넓은 터치 화면에서 반대로 어긋난다",
  );
});
