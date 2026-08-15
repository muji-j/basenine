import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS, CSS } from "../src/assets.ts";
import { BLOCKS, PRESETS } from "../src/blocks.ts";

test("클라이언트 스크립트가 문법적으로 유효하다 — 깨진 스크립트는 조용히 아무것도 안 한다", () => {
  // 실행하지 않고 파싱만 한다(document가 없으므로 실행은 불가능하다).
  assert.doesNotThrow(() => new Function(CLIENT_JS));
});

test("스크립트가 끝까지 실려 있다 — 안에 백틱이 들어가면 문자열이 거기서 잘린다", () => {
  // 실제로 한 번 잘렸다: 스크립트 안 주석에 백틱을 썼더니 템플릿 리터럴이 조기 종료됐다
  assert.ok(CLIENT_JS.trim().endsWith("})();"), "클라이언트 스크립트가 잘렸다");
  assert.ok(CSS.trim().endsWith("}"), "스타일시트가 잘렸다");
  assert.ok(!CLIENT_JS.includes("`") && !CSS.includes("`"), "백틱이 남아 있다");
});

test("클라이언트는 서버가 심는 전역만 읽는다", () => {
  assert.match(CLIENT_JS, /window\.__BLOCKS__/);
  assert.match(CLIENT_JS, /window\.__PRESETS__/);
  assert.match(CLIENT_JS, /PRESETS\.standard/);
  assert.ok(
    PRESETS.some((p) => p.id === "standard"),
    "클라이언트가 기대하는 standard 프리셋이 사라졌다",
  );
});

test("설정 저장 실패가 화면을 죽이지 않는다 — localStorage가 막힌 환경이 있다", () => {
  const save = /const save=\(s\)=>\{[\s\S]*?\};/.exec(CLIENT_JS)?.[0] ?? "";
  const load = /const load=\(\)=>\{[\s\S]*?\};/.exec(CLIENT_JS)?.[0] ?? "";
  assert.match(save, /try\{[\s\S]*catch/);
  assert.match(load, /try\{[\s\S]*catch/);
});

test("검색 색인을 못 받으면 그렇다고 말한다 — 빈 목록으로 두지 않는다(M12)", () => {
  assert.match(CLIENT_JS, /\.catch\(/);
  assert.match(CLIENT_JS, /読み込めませんでした/);
});

test("클라이언트는 선수명을 textContent로만 넣는다 — innerHTML을 쓰지 않는다", () => {
  assert.ok(!CLIENT_JS.includes("innerHTML"), "innerHTML이 들어오면 XSS 경로가 생긴다");
  assert.ok(!CLIENT_JS.includes("insertAdjacentHTML"));
});

test("CSS는 라이트 팔레트를 맨 :root에 전부 정의한다", () => {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
  for (const token of ["--page", "--tx", "--tx-2", "--tx-3", "--hair", "--panel", "--warn"]) {
    assert.ok(root.includes(token), `${token}가 기본 :root에 없다`);
  }
});

test("다크는 OS 설정과 명시적 지정 양쪽에서 먹는다", () => {
  assert.match(CSS, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(CSS, /:root\[data-theme="dark"\]/);
});

test("body는 배경을 스스로 칠한다 — 투명하면 호스트 테마를 빌린다", () => {
  assert.match(CSS, /body\{[^}]*background:var\(--page\)/);
});

test("모션 감소 설정을 존중한다", () => {
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)/);
});

test("키보드 초점이 보인다", () => {
  assert.match(CSS, /:focus-visible\{outline:/);
});

test("넓은 표는 자기 컨테이너 안에서만 가로 스크롤한다", () => {
  assert.match(CSS, /\.scroller\{overflow-x:auto/);
});

test("좁은 화면 규칙이 실제로 들어 있다 — 스마트폰에서 보는 화면이다", () => {
  for (const bp of [900, 680, 420]) {
    assert.ok(CSS.includes(`@media (max-width:${bp}px)`), `${bp}px 분기점이 없다`);
  }
  // 배면(44px)이 좁은 화면에서 본문을 먹지 않아야 한다
  assert.match(CSS, /@media \(max-width:680px\)\{[\s\S]*?\.shell\{grid-template-columns:7px 1fr\}/);
});

test("손가락 조작에서 버튼이 커진다", () => {
  assert.match(CSS, /@media \(pointer:coarse\)/);
});

test("모션은 감소 설정에서 전부 꺼진다 — 애니메이션을 늘렸으면 이 규칙도 넓어야 한다", () => {
  const rule = /@media \(prefers-reduced-motion:reduce\)\{([^}]*\}[^}]*)\}/.exec(CSS)?.[1] ?? "";
  assert.match(rule, /animation-duration:1ms!important/);
  assert.match(rule, /transition-duration:1ms!important/);
  assert.match(rule, /\*,\*::before,\*::after/);
});

test("구단 색은 CSS 변수로 받는다 — 색값이 스타일시트에 박혀 있지 않다", () => {
  assert.match(CSS, /var\(--team,/);
  assert.match(CSS, /var\(--team-ink,/);
});

test("블록 재배치 기준점이 서버 마크업과 맞는다 — 어긋나면 순서 변경이 조용히 안 먹는다", () => {
  assert.match(CLIENT_JS, /\$\("#blocksEnd"\)/);
});

test("블록마다 CSS가 필요로 하는 id 규칙이 유지된다", () => {
  assert.match(CSS, /\.block\[hidden\]\{display:none\}/);
  for (const b of BLOCKS) assert.ok(/^[a-z]+$/.test(b.id), `${b.id}가 id로 쓸 수 없는 형태다`);
});
