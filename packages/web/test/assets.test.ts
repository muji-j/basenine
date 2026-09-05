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
  assert.match(CSS, /\.block>h2 \.sw[^{]*\{min-width:0\}/);
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

/**
 * ⚠**「스크롤로 닫힌다」는 요구가 아니었다**(2026-08-21 감사 P1 ②로 정정).
 *
 * 예전 이 시험은 `doc.addEventListener("scroll",hide,true)` 를 글자로 못 박고 있었는데,
 * 그 배선은 **포커스로 여는 길을 통째로 막았다** — 포커스가 스크롤을 유발하면
 * 그 스크롤이 방금 연 설명을 닫는다(실기 A/B: 최상단 focus() **3/54** 대
 * scrollIntoView 뒤 focus() **54/54**). 원래 의도는 「가로로 밀면 설명만 제자리에 남는다」는
 * **위치 문제**였고, 답은 닫기가 아니라 자리를 다시 잡는 것이다.
 * → 여기서 지키는 것은 **닫는 길이 남아 있는가**(Escape · 바깥 클릭)이고,
 *   스크롤 때 무엇을 하는가는 `term-tip.test.ts` 가 실행해서 잰다.
 * ⚠**「hide 로 되돌리기」를 여기서 다시 못 박지 마라.** 그것이 결함이었다.
 */
test("설명은 Escape·바깥클릭으로 닫힌다 — 열린 채 남으면 화면을 가린다", () => {
  assert.match(CLIENT_JS, /"Escape"/);
  assert.match(CLIENT_JS, /doc\.addEventListener\("click"/, "바깥 클릭으로 닫는 길이 없다");
  assert.ok(
    !/doc\.addEventListener\("scroll",hide/.test(CLIENT_JS),
    "스크롤에 닫고 있다 — 포커스로 여는 길이 막힌다(감사 P1 ②)",
  );
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

/**
 * ⚠**이름이 「전역」이었지만 이제 전역이 아니다**(2026-08-18).
 * 서버가 심던 인라인 스크립트(`window.__BLOCKS__=…`)를 `type="application/json"` 데이터 블록으로
 * 옮겼다 — 그래야 CSP 의 `script-src` 를 `unsafe-inline` 없이 닫을 수 있다(site.ts HEADERS).
 * ⚠**전역을 다시 쓰면 CSP 가 조용히 사이트를 깨뜨린다** — 그래서 여기서 못 박는다.
 */
test("클라이언트는 서버가 심는 데이터 블록에서 읽는다 — 인라인 스크립트를 되살리지 않는다", () => {
  assert.match(CLIENT_JS, /getElementById\("bb-boot"\)/);
  assert.doesNotMatch(CLIENT_JS, /window\.__BLOCKS__/, "인라인 전역이 되살아났다 — CSP 가 깨진다");
  assert.doesNotMatch(CLIENT_JS, /window\.__PRESETS__/, "인라인 전역이 되살아났다 — CSP 가 깨진다");
  assert.match(CLIENT_JS, /BOOT\.presets/);
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

/**
 * ⚠**없는 토큰을 쓰면 그 선언은 무효가 된다 — 그런데 화면은 얼추 맞아 보인다.**
 *
 * 2026-08-17 이중 검토에서 실제로 났다. `var(--tx-1)` 이라고 썼는데 그런 토큰은 없다
 * (있는 것은 `--tx` · `--tx-2` · `--tx-3`). 정의 없는 `var()` 는 **선언 전체**를
 * invalid-at-computed-value-time 으로 만들고, 각 롱핸드가 `unset` 으로 떨어진다.
 * · `color` 는 상속 프로퍼티라 부모 색을 물려받아 **그럴듯하게 보인다**
 * · `outline` 은 비상속이라 `outline-style:none` 이 된다 — **포커스 링이 사라진다.**
 *   더 나쁜 것은 그 선택자의 특이도가 전역 `:focus-visible` 을 이겨서,
 *   **그 줄을 안 썼으면 나왔을 링이 쓴 탓에 없어진다**는 점이다.
 *
 * ⚠**바로 위 시험이 이걸 못 잡는다.** 「초점이 보인다」가 재는 것은
 * `:focus-visible{outline:` 이라는 **글자가 어딘가 있는가**뿐이라, 그 글자를 남긴 채
 * 링을 없애는 이번 같은 회귀는 통과한다. 이름이 주장하는 것과 재는 것이 달랐다.
 *
 * ⚠**폴백이 있는 `var(--x, 기본값)` 은 뺀다** — 그건 없어도 되도록 쓴 것이다.
 * ⚠**정의처는 CSS 만이 아니다** — `--chip` 처럼 HTML 인라인 style 로 넣는 토큰이 있어
 * `src/` 전체에서 `--이름:` 을 모은다.
 */
test("⚠CSS가 쓰는 토큰은 전부 어딘가에 정의돼 있다 — 없는 이름은 선언을 통째로 무효로 만든다", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/", import.meta.url);
  const names = (await readdir(dir)).filter((f) => f.endsWith(".ts"));
  assert.ok(names.length > 0, "소스를 하나도 못 읽었다 — 이 시험은 아무것도 재지 않았다");
  const sources = await Promise.all(names.map((f) => readFile(new URL(f, dir), "utf8")));

  // ⚠**주석을 먼저 걷어낸다.** 이 시험을 처음 돌렸을 때 잡힌 것이 **바로 위 주석에 적어 둔
  // `var(--tx-1)` 이라는 글자**였다 — CSS 주석은 스타일시트에 그대로 실려 나가므로
  // 「고치지 마라」고 적은 문장이 「안 고쳤다」로 읽힌다.
  const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const defined = new Set<string>();
  for (const src of sources) {
    for (const m of strip(src).matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1] ?? "");
  }
  // 폴백 없는 참조만 — `var(--x,기본값)` 은 정의가 없어도 그 기본값으로 동작한다
  const used = new Map<string, number>();
  for (const m of strip(CSS).matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
    const n = m[1] ?? "";
    used.set(n, (used.get(n) ?? 0) + 1);
  }
  assert.ok(used.size > 0, "토큰 참조를 하나도 못 찾았다 — 정규식이 안 맞는다");
  const missing = [...used.keys()].filter((n) => !defined.has(n)).sort();
  assert.deepEqual(missing, [], `정의되지 않은 토큰 ${missing.length}종: ${missing.join(", ")}`);
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
  // ⚠**감싸는 것을 지워도 결과는 같다.** 이 시험은 `.tabs` 만 봤는데, 실제로 지워지고
  // 있던 것은 그것을 감싼 `.rail` 이었다 — 그래서 아래 「고른 탭만 남긴다」 규칙이
  // 붙을 대상 자체가 없었고, **의도는 적혀 있는데 한 번도 실행되지 않았다**(2026-08-17).
  // 레일을 쓰는 화면: 順位 · 選手 · ポストシーズン · 球団.
  for (const box of [".rail", ".tabs"]) {
    const hidden = new RegExp(`(^|[,{}])[^{}]*\\${box}\\b[^{}]*\\{[^}]*display:none`).test(printBlock);
    assert.ok(!hidden, `${box} 를 인쇄에서 숨겼다 — 고른 탭의 이름이 종이에서 사라진다`);
  }
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

/**
 * ⚠**숨은 탭의 글자를 브라우저 내 찾기(Ctrl+F)가 찾을 수 있어야 한다.**
 *
 * 구단 페이지는 打者 46행 + 投手 30행이 탭 뒤에 있고, 순위 화면은 숨은 패널이 80개다.
 * 그 상태에서 선수 이름을 Ctrl+F 로 찾으면 **아무것도 안 나온다** — 탭으로 나눈 대가였다.
 * `hidden="until-found"` 는 그 글자를 찾게 하고, 찾으면 브라우저가 스스로 펼친다.
 *
 * ⚠**`display:none` 이면 동작하지 않는다.** 그 상태는 `content-visibility:hidden` 이어야 한다.
 * ⚠**boolean `hidden` 은 지금까지대로 `display:none`** 이다 — 두 값을 구별해서 쓴다.
 * ⚠**모르는 브라우저는 이 값을 그냥 hidden 으로 읽는다** — 지금까지와 같고 잃는 것이 없다(§0-1).
 */
test("⚠until-found 로 닫힌 패널은 화면 밖이되 찾기의 대상이다", () => {
  const nc = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
  // boolean hidden 은 그대로 display:none
  assert.match(nc, /\[data-panelgroup\]\[hidden\]\{display:none\}/, "boolean hidden 이 안 숨는다");
  // until-found 는 렌더 트리에 남아야 한다
  assert.match(
    nc,
    /\[data-panelgroup\]\[hidden="until-found"\]\{[^}]*content-visibility:hidden/,
    "until-found 가 content-visibility:hidden 이 아니다",
  );
  assert.ok(
    !/\[data-panelgroup\]\[hidden="until-found"\]\{[^}]*display:none/.test(nc),
    "until-found 를 display:none 으로 숨겼다 — 그러면 찾기가 못 찾는다",
  );
});

/**
 * ⚠**찾기로 펼쳐졌는데 탭줄이 그대로면 화면이 자기 자신과 모순된다.**
 * 「投手 탭이 눌려 있는데 화면은 打者」가 된다. `beforematch` 로 탭도 함께 옮긴다.
 * ⚠**저장하지 않는다** — 찾다가 스친 것을 「이 사람이 고른 탭」으로 기억하면 안 된다.
 */
test("⚠찾기로 펼쳐지면 탭줄도 따라간다 — 저장은 하지 않는다", () => {
  assert.match(CLIENT_JS, /addEventListener\("beforematch"/, "beforematch 를 듣지 않는다");
  const at = CLIENT_JS.indexOf('addEventListener("beforematch"');
  const body = CLIENT_JS.slice(at, at + 260);
  assert.match(body, /transient\[/, "일시적인 자리에 넣지 않는다");
  assert.ok(!body.includes("save("), "찾다가 스친 탭을 저장했다");
});

/**
 * ⚠**지원 여부를 사용자 에이전트 문자열로 가르지 않는다.** 반드시 틀린다 —
 * 기능이 있는지를 직접 물어야 한다.
 */
test("⚠until-found 지원을 기능으로 판정한다 — UA 문자열로 가르지 않는다", () => {
  assert.match(CLIENT_JS, /onbeforematch" in /, "기능 판정이 없다");
  assert.ok(!/navigator\.userAgent/.test(CLIENT_JS), "UA 문자열로 갈랐다");
});

/* ── 접힘 손잡이(単独指名) — 2026-09-05 감사 P1 ────────────────────────────── */

/**
 * ⚠**손잡이가 손잡이로 안 보였다.** 세 가지가 겹쳤고 **셋이 다 CSS 에서 판정된다.**
 * 셋 다 「규칙은 있는데 아무 일도 안 하는」 모양이라 눈으로도 시험으로도 안 잡혔다 —
 * 하나만 되돌아가도 나머지 둘이 다시 감춘다.
 */
const NO_COMMENT = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const px = (s: string, prop: string): number => Number(new RegExp(`${prop}:([\\d.]+)px`).exec(s)?.[1] ?? NaN);

test("⚠접힘 손잡이가 회차 머리보다 작다 — 크면 문서 위계가 시각적으로 뒤집힌다", () => {
  const sum = /\.dsolo>summary\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  assert.notEqual(sum, "", ".dsolo>summary 규칙이 없다 — body 기본 16px 를 그대로 받는다");
  const drh = /\.drh\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  const h2 = /\.block>h2\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  const s = px(sum, "font-size");
  assert.ok(!Number.isNaN(s), "손잡이에 명시적 크기가 없다");
  assert.ok(s < px(drh, "font-size"), `손잡이(${s}px)가 회차 머리(${px(drh, "font-size")}px) 이상이다`);
  assert.ok(s < px(h2, "font-size"), `손잡이(${s}px)가 구획 제목(${px(h2, "font-size")}px) 이상이다`);
});

test("⚠hover 가 바꿀 것이 있다 — 시작색이 --tx 면 그 규칙은 죽은 규칙이다", () => {
  // 실측(2026-09-05): 드래프트 화면만 hover 전후가 같았고, 対戦 화면은 summary 에 .picklab 이
  // 붙어 --tx-3 에서 시작하므로 살아 있었다. **한쪽에서 도는 것을 「있으니 된다」로 읽지 마라.**
  const sum = /\.dsolo>summary\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  const hover = /\.pickfold>summary:hover\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  assert.match(hover, /color:var\(--tx\)/, "hover 규칙이 없어졌다");
  assert.match(sum, /color:var\(--tx-2\)/, "손잡이가 이미 --tx 라 hover 가 아무것도 안 바꾼다");
});

test("⚠마커가 라벨 옆에 있다 — margin-left:auto 면 상자 오른쪽 끝으로 날아간다", () => {
  // 실측(고치기 전) 라벨 끝 ~ 마커: 1440px 에서 884px · 1024:684 · 768:436 · 390:101
  const after = /\.dsolo>summary::after\{([^}]*)\}/.exec(NO_COMMENT)?.[1] ?? "";
  assert.notEqual(after, "", "이 화면 몫의 마커 규칙이 없다 — .pickfold 의 margin-left:auto 가 그대로 산다");
  assert.match(after, /margin-left:0/, "마커가 아직 오른쪽 끝으로 밀린다");
  // 접힘 표시는 details 의 관용대로 라벨 앞에 둔다
  assert.match(after, /order:-1/);
  // 회전은 한 벌 그대로여야 한다 — 자리를 옮기면서 펼침 표시를 잃으면 더 나쁘다
  assert.match(NO_COMMENT, /\.pickfold\[open\]>summary::after\{[^}]*rotate\(90deg\)/);
});

/**
 * ⚠**「지금 여기」 표시가 화면 밖에 있으면 아무 일도 안 한다**(감사 P2).
 * 탭이 10개가 되면서 390px 에서 현재 탭이 상자 밖([80,330] 대 [343,391])이었다.
 */
test("⚠현재 탭을 상자 안으로 들여놓는다 — 세로 위치는 건드리지 않는다", () => {
  assert.match(CLIENT_JS, /function showCurrentTab\(\)/, "현재 탭을 들여놓는 코드가 없다");
  const at = CLIENT_JS.indexOf("function showCurrentTab()");
  const body = CLIENT_JS.slice(at, CLIENT_JS.indexOf("\n}", at));
  assert.match(body, /scrollLeft/, "상자를 굴리지 않는다");
  assert.ok(!body.includes("scrollIntoView"), "scrollIntoView 는 조상까지 굴려 세로 위치를 건드린다");
  assert.match(body, /scrollWidth<=[^;]*clientWidth/, "안 넘치는데도 굴린다");
  assert.match(CLIENT_JS, /\n {2}showCurrentTab\(\);/, "부르는 곳이 없다");
});

/**
 * ⚠**표가 자기 이름을 갖고 있으면 그것을 쓴다**(감사 P2). 첫 th 만 보면 스크롤 영역의 이름이
 * **열 이름**이 되어, 같은 모양의 표가 둘 있는 화면에서 둘 다 「球団（横スクロール）」가 됐다.
 */
test("⚠가로 스크롤 영역의 이름이 표 이름에서 온다 — 열 이름은 이름이 아니다", () => {
  assert.match(CLIENT_JS, /querySelector\("table\[aria-label\]"\)/, "표의 이름을 안 본다");
  const at = CLIENT_JS.indexOf('querySelector("table[aria-label]")');
  const body = CLIENT_JS.slice(at, at + 320);
  assert.match(body, /caption,th/, "이름 없는 표를 위한 대비가 사라졌다");
  assert.match(body, /横スクロール/);
});
