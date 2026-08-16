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

test("⚠탭줄이 줄어들 수 있다 — min-width:0이 없으면 페이지 전체가 옆으로 넓어진다", () => {
  // flex 아이템의 min-width 기본값은 auto = 내용의 최소폭이다. 버튼이 nowrap이라
  // 최소폭 = 버튼 폭의 합이 되고, 그러면 overflow-x:auto를 적어도 아무 일도 안 일어난다.
  // **모바일에서 실제로 일어났다**(2026-08-15 실기 확인).
  const rule = /\.tabs\.scroll\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
  assert.ok(rule.length > 0, ".tabs.scroll 규칙이 없다");
  assert.match(rule, /overflow-x:auto/);
  assert.match(rule, /min-width:0/, "줄어들 수 없으면 넘칠 수도 없다");
  assert.match(rule, /max-width:100%/);
  // 조상 쪽이 한 곳이라도 막히면 위의 규칙이 무효가 된다
  assert.match(CSS, /\.block>h4 \.sw[^{]*\{min-width:0\}/);
});

test("탭줄에 「더 있다」는 신호가 있다 — 넘친 것을 말하지 않으면 없는 것과 같다", () => {
  const rule = /\.tabs\.scroll\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
  // local은 내용과 함께 흐르고 scroll은 상자에 붙는다 — 둘을 겹쳐 끝을 감지한다
  assert.match(rule, /no-repeat local/);
  assert.match(rule, /no-repeat scroll/);
});

test("용어집이 스크립트에 실린다 — 정의를 두 벌로 만들지 않기 위해서다(M1)", async () => {
  const { GLOSSARY, glossaryKeys } = await import("../src/glossary.ts");
  assert.ok(!CLIENT_JS.includes("__GLOSSARY__"), "치환이 일어나지 않았다");
  for (const k of glossaryKeys()) {
    assert.ok(CLIENT_JS.includes(`"${k}":`), `${k}가 클라이언트에 없다`);
  }
  // 문장까지 실렸는지 — 키만 있고 내용이 비면 툴팁이 빈 채로 뜬다
  assert.ok(CLIENT_JS.includes(GLOSSARY["avg"]!.short), "설명 문장이 실리지 않았다");
});

test("⚠정렬 헤더는 탭으로 열지 않는다 — 같은 탭이 정렬과 설명을 둘 다 하면 안 된다", () => {
  assert.match(CLIENT_JS, /\[data-term\]/, "호버·포커스는 data-term 전체가 받는다");
  assert.match(CLIENT_JS, /tapToOpen/, "탭으로 여는 것은 .term뿐이어야 한다");
});

test("설명은 Escape·바깥클릭·스크롤로 닫힌다 — 열린 채 남으면 화면을 가린다", () => {
  assert.match(CLIENT_JS, /"Escape"/);
  assert.match(CLIENT_JS, /doc\.addEventListener\("scroll",hide,true\)/);
});

test("수준 색은 끌 수 있고, 분모는 끌 수 없다", () => {
  assert.match(CLIENT_JS, /data-grades/);
  assert.match(CSS, /:root\[data-grades="off"\] dd\.v\{box-shadow:none/);
  // 분모를 지우는 규칙이 있으면 M2가 무너진다
  assert.ok(!/\.den\{[^}]*display:none/.test(CSS), "분모를 숨기는 규칙이 있다");
});

test("⚠수준 색은 빨강↔초록이 아니다 — 가장 흔한 색각 이상에서 구별되지 않는다", () => {
  const good = /--g-vgood:(#[0-9a-f]{6})/.exec(CSS)?.[1] ?? "";
  const bad = /--g-vbad:(#[0-9a-f]{6})/.exec(CSS)?.[1] ?? "";
  const hue = (hex: string): "blue" | "orange" | "other" => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
    if (b > r && b > g) return "blue";
    if (r > b) return "orange";
    return "other";
  };
  assert.equal(hue(good), "blue", `좋은 쪽이 파랑이어야 한다: ${good}`);
  assert.equal(hue(bad), "orange", `나쁜 쪽이 주황이어야 한다: ${bad}`);
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

/**
 * ⚠**카드 전체를 누르는 장치는 CSS 두 줄이 전부다.**
 * 하나라도 사라지면 마크업은 그대로인 채 동작만 달라지므로, 렌더 검사로는 절대 안 잡힌다.
 * ① 덮개(`::after`)가 없으면 카드를 눌러도 아무 일이 없다 —— 기능이 통째로 사라진 것을 아무도 모른다.
 * ② 안쪽 링크를 위로 올리지 않으면 **선수 이름을 눌러도 경기 상세로 간다** ——
 *    누른 곳과 다른 데로 가는 것이라 더 나쁘다.
 */
test("⚠카드 덮개와 안쪽 링크의 층이 둘 다 있다 — 하나만 빠져도 조용히 오작동한다", () => {
  assert.match(CSS, /\.cardlink::after\{content:"";position:absolute;inset:0/, "덮개가 없다");
  assert.match(CSS, /\.tapcard a:not\(\.cardlink\)\{position:relative;z-index:1\}/, "안쪽 링크가 덮개 아래다");
  assert.match(CSS, /\.tapcard\{position:relative/, "덮개의 기준 상자가 없다");
  // 초점은 덮개에 준다 — :focus-within이면 안쪽 링크에 초점이 가도 카드가 켜진다
  assert.match(CSS, /\.cardlink:focus-visible::after\{outline:/);
  assert.ok(!/\.tapcard:focus-within/.test(CSS), "초점을 카드 전체로 받으면 어디에 있는지 알 수 없다");
});

test("카드의 hover는 마우스가 있는 환경에서만 — 터치에서는 눌린 뒤에도 남는다", () => {
  const at = CSS.indexOf("@media (hover:hover)");
  assert.ok(at > 0, "hover 가드가 없다");
  assert.ok(CSS.slice(at, at + 220).includes(".tapcard:hover"), "카드 hover가 가드 밖에 있다");
});

test("블록마다 CSS가 필요로 하는 id 규칙이 유지된다", () => {
  assert.match(CSS, /\.block\[hidden\]\{display:none\}/);
  for (const b of BLOCKS) assert.ok(/^[a-z]+$/.test(b.id), `${b.id}가 id로 쓸 수 없는 형태다`);
});

/**
 * ⚠**렌더 생략과 인쇄는 정면으로 부딪힌다.**
 * `content-visibility:auto`는 화면 밖을 그리지 않는데 종이에는 「화면 밖」이 없다 —
 * 켜 둔 채 인쇄하면 **빈 페이지가 나온다.** 이건 마크업으로는 절대 안 잡히는 종류다.
 *
 * ⚠**「문자열이 있는가」로 재지 않는다.** 그러면 내일 누가 새 셀렉터에 렌더 생략을 걸어도
 * 통과하고, 그때 나오는 것이 이 시험 제목이 말하는 빈 종이다.
 * **렌더 생략을 쓰는 셀렉터를 전부 뽑아** 각각이 인쇄에서 꺼지는지 센다.
 */
test("렌더 생략을 쓰는 셀렉터가 전부 인쇄에서 꺼진다 — 하나라도 남으면 빈 종이가 나온다", () => {
  const at = CSS.indexOf("@media print");
  assert.ok(at > 0, "인쇄 규칙이 없다");
  // ⚠**주석을 먼저 걷어낸다.** 안 걷으면 규칙 위의 설명문이 셀렉터로 잡힌다
  const screen = CSS.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, "");
  const printBlock = CSS.slice(at); // 인쇄 규칙은 스타일시트의 마지막 블록이다

  // 화면 쪽에서 content-visibility:auto 를 켜는 셀렉터를 전부 모은다
  const targets = [...screen.matchAll(/(^|\})([^{}]+)\{[^{}]*content-visibility:auto/g)].flatMap((m) =>
    m[2]!.split(",").map((x) => x.trim()).filter((x) => x !== "" && !x.startsWith("@") && !x.startsWith("/*")),
  );
  assert.ok(targets.length > 0, "렌더 생략을 쓰는 곳이 하나도 없다 — 규칙이 사라졌나?");

  const off = printBlock.slice(0, printBlock.indexOf("content-visibility:visible") + 40);
  for (const t of targets) {
    assert.ok(off.includes(t), `${t} 가 인쇄에서 꺼지지 않는다 — 그 부분이 빈 종이가 된다`);
  }
});

/**
 * ⚠**닫힌 탭을 인쇄에서 펼치지 않는다.** 한때 펼쳤다가 되돌렸다 —
 * 순위 화면이 14행에서 2,432행이 됐고, 그 표들에는 이름이 없었다(탭줄을 함께 숨겼기 때문).
 */
test("인쇄는 보고 있는 것을 찍는다 — 닫힌 탭을 펼치지 않고, 고른 탭의 이름은 남긴다", () => {
  const printBlock = CSS.slice(CSS.indexOf("@media print"));
  assert.ok(
    !printBlock.includes("[data-panelgroup][hidden]{display:block"),
    "닫힌 탭을 전부 펼치면 순위 화면이 2,432행이 되고 표에 이름이 없어진다",
  );
  // 탭줄 자체를 숨기면 고른 것의 이름이 사라진다 — 고르지 않은 것만 지운다
  assert.ok(!/\.tabs\{display:none\}/.test(printBlock), "탭줄을 통째로 숨겼다");
  assert.match(
    printBlock,
    /\.tab:not\(\[aria-selected="true"\]\):not\(\[aria-pressed="true"\]\)\{display:none\}/,
    "고르지 않은 탭만 지우는 규칙이 없다",
  );
});

/**
 * ⚠**좁혀서 인쇄한 종이는 그 사실을 말해야 한다**(작업규칙 7의 종이판).
 * 「お気に入り」로 3명만 남기고 인쇄하면, 나중에 그 종이를 보는 사람은
 * 「이 구단에 3명뿐인가」로 읽는다.
 */
test("좁히기 조작은 지우되 「몇 명을 보고 있는가」는 종이에 남는다", () => {
  const printBlock = CSS.slice(CSS.indexOf("@media print"));
  assert.ok(!/[^-]\.find\{display:none\}/.test(printBlock), "분모까지 통째로 지웠다");
  assert.match(printBlock, /\.find label,\.find input,\.find \.chips\{display:none\}/);
});

test("⚠크기를 기억하게 한다 — 고정값을 주면 스크롤바가 튄다", () => {
  assert.ok(!/contain-intrinsic-size:[0-9]/.test(CSS), "고정 크기를 줬다");
  assert.match(CSS, /contain-intrinsic-size:auto [0-9]+px/);
});

test("탭 전환에 방향이 있고, 탭줄 자체는 미끄러지지 않는다", () => {
  // ⚠**「이름이 있는가」가 아니라 「규칙이 그것을 쓰는가」를 본다.**
  // 키프레임 이름만 찾으면 slideNextOff 같은 것에도 매칭되어 무의미하게 통과한다.
  // ⚠정규식 대신 문자열 포함으로 본다 — 대괄호·중괄호가 많아 이스케이프가 먼저 틀린다
  for (const [dir, name] of [["next", "slideNext"], ["prev", "slidePrev"]] as const) {
    assert.ok(CSS.includes(`@keyframes ${name}{`), `${name} 키프레임이 없다`);
    // role="tabpanel" 로 좁힌다 — 레일 안의 하위 탭줄이 미끄러지면 조작이 흔들린다
    const sel = `[data-panelgroup][role="tabpanel"][data-slide="${dir}"]{animation:${name} `;
    assert.ok(CSS.includes(sel), `${dir} 방향 규칙이 ${name} 를 쓰지 않는다`);
  }
});

test("새로 넣은 모션도 감소 설정에서 꺼진다 — 예외를 만들지 않는다", () => {
  const rule = /@media \(prefers-reduced-motion:reduce\)\{([^}]*\}[^}]*)\}/.exec(CSS)?.[1] ?? "";
  assert.match(rule, /\*,\*::before,\*::after/, "전역 가드가 아니면 새 애니메이션이 새어 나간다");
  assert.match(rule, /animation-duration:1ms!important/);
});

test("검색 결과의 성적 줄에 자리가 있다 — 분모까지 들어가므로 한 줄을 통째로 쓴다", () => {
  assert.match(CSS, /\.qhits \.hs\{flex-basis:100%/);
});
