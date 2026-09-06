/**
 * 강조 표기(`**…**`) — **서버와 클라이언트가 같은 규칙을 쓰는가**.
 *
 * ⚠**이 결함을 잡는 시험이 0본이었다**(2026-08-20 최종 검토 ①).
 * 서버의 `note()` 는 별표를 `<b>` 로 바꾸는데 **클라이언트의 용어 툴팁은 안 바꿨다** —
 * `assets.ts` 가 `u.textContent = t.caveat` 로 넣었기 때문이다. 그래서 화면에
 * 별표가 글자 그대로 찍혔다: 용어집 **56항목 중 15항목**이 사용자 가시 문자열에 별표를 갖고
 * (기저 커밋 `7e54ce3` 에서는 1항목이었다 — 이번 라운드가 14개를 더했다),
 * 그중 하나 이상을 `data-term` 으로 내보내는 배포물이 **6,333 / 15,340장(41%)**.
 * 하필 「무엇을 재지 않는가」를 적은 문장들만 골라 깨졌다(`doused`·`gidp`·`winPct`·`twoStrike*`).
 *
 * ⚠**여기서 재는 것은 두 가지다.**
 * ① 렌더된 결과에 별표가 남지 않는가 — 결함 그 자체.
 * ② 서버와 클라이언트가 **같은 조각으로 나누는가** — M1. 규칙이 두 벌이 되면 어느 날 갈린다.
 *
 * ⚠**브라우저가 아니다**(`dom-stub.ts`). 여기서 재는 것은 우리 로직이고, 실기 확인을 대신하지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS } from "../src/assets.ts";
import { GLOSSARY, glossaryKeys } from "../src/glossary.ts";
import { emphasisParts } from "../src/emphasis.ts";
import { emphasize, note } from "../src/parts.ts";
import { toString } from "../src/html.ts";
import { El, make, makeDocument, makeStorage } from "./dom-stub.ts";

/**
 * 툴팁 하나를 실제로 띄운다 — **클라이언트 스크립트를 실행해서**.
 *
 * ⚠`#tip` 과 `[data-term]` 이 둘 다 있어야 클라이언트가 용어 경로에 들어간다.
 * ⚠`place()` 는 `getBoundingClientRect` 가 없으면 조기 반환한다 — 스텁에는 없으므로 좌표는 안 잰다.
 */
function openTip(termKey: string): El {
  const doc = makeDocument("");
  const btn = make("button", { class: "term", "data-term": termKey });
  doc.body.appendChild(btn);
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
  btn.fire("mouseenter");
  assert.equal(tip.hidden, false, `${termKey}: 툴팁이 열리지 않았다 — 이 시험이 아무것도 재지 않는다`);
  return tip;
}

/** 툴팁 안에서 **굵게 그려진 조각**만. 표제(첫 `<b>`)는 이름이라 제외한다 */
function boldTextsUnderProse(tip: El): string[] {
  return tip.children
    .slice(1)
    .flatMap((el) => el.children.filter((c) => c.tagName === "B"))
    .map((b) => b.textContent);
}

/** 그 용어가 툴팁에 내보내는 문장들 — 표제는 뺀다 */
function proseOf(key: string): string[] {
  const t = GLOSSARY[key]!;
  return [t.short, ...(t.how === undefined ? [] : [t.how]), ...(t.caveat === undefined ? [] : [t.caveat])];
}

// ── ① 결함 그 자체 ───────────────────────────────────────────────────────

test("⚠용어 툴팁이 별표를 글자로 내지 않는다 — 6,333/15,340장(41%)이 그 상태였다", () => {
  const withStars = glossaryKeys().filter((k) => proseOf(k).some((s) => s.includes("**")));
  /**
   * ⚠**대상이 0이면 통과가 아니라 실패다**(작업규칙 8). 별표를 쓴 항목이 없으면
   * 이 시험은 아무것도 재지 않으면서 초록이 된다.
   * 실측(2026-08-20): 용어집 56항목 중 **15항목**.
   */
  assert.ok(
    withStars.length >= 15,
    `별표를 쓰는 용어가 ${withStars.length}개뿐이다 — 이 시험이 공회전한다(실측 15개)`,
  );
  for (const key of withStars) {
    const tip = openTip(key);
    assert.ok(
      !tip.textContent.includes("**"),
      `${key}: 툴팁에 별표가 글자로 남았다 — ${tip.textContent.slice(0, 60)}`,
    );
  }
});

test("⚠어느 용어를 열어도 별표가 남지 않는다 — 56항목 전수", () => {
  const keys = glossaryKeys();
  assert.ok(keys.length >= 56, `용어가 ${keys.length}개뿐이다 — 용어집을 못 읽었다`);
  for (const key of keys) {
    assert.ok(!openTip(key).textContent.includes("**"), `${key}: 별표가 남았다`);
  }
});

test("강조한 곳이 실제로 굵어진다 — 별표만 지우면 강조가 조용히 사라진 것과 같다", () => {
  // `doused`(火消し率)는 「무엇을 재지 않는가」를 적은 문장이고 별표가 여러 벌 들어 있다
  const key = "doused";
  const want = proseOf(key).flatMap((s) => emphasisParts(s).filter((p) => p.bold).map((p) => p.text));
  assert.ok(want.length >= 3, `${key} 의 강조가 ${want.length}곳뿐이다 — 시험 대상이 바뀌었다`);
  assert.deepEqual(boldTextsUnderProse(openTip(key)), want);
});

test("표제는 굵게 그리되 강조를 풀지 않는다 — 이름이지 문장이 아니다", () => {
  const tip = openTip("avg");
  assert.equal(tip.children[0]!.tagName, "B");
  assert.equal(tip.children[0]!.textContent, GLOSSARY["avg"]!.label);
});

// ── ② M1 — 같은 규칙 한 벌 ────────────────────────────────────────────────

/**
 * ⚠**규칙이 두 벌이면 언젠가 갈린다.** 실제로 갈려 있었다(위 ①).
 * 지금은 `assets.ts` 가 `emphasis.ts` 의 **함수 소스를 그대로 심는다** — 그 사실을 여기서 잰다.
 */
test("⚠클라이언트에 심긴 규칙이 서버의 그 함수다 — 두 번째 벌을 적으면 여기서 걸린다", () => {
  const decls = CLIENT_JS.split("function emphasisParts(").length - 1;
  assert.equal(decls, 1, `클라이언트에 emphasisParts 선언이 ${decls}개다`);
  // 나누는 자리(`split("**")`)도 클라이언트에 하나뿐이어야 한다
  const splits = CLIENT_JS.split('split("**")').length - 1;
  assert.equal(splits, 1, `별표를 나누는 곳이 클라이언트에 ${splits}군데다 — 규칙이 두 벌이다`);
  assert.ok(!CLIENT_JS.includes("__EMPHASIS_PARTS__"), "치환이 일어나지 않았다");
});

/**
 * ⚠**같은 입력에 같은 조각이 나오는가.** 용어집 전 문장 + 경계값으로 잰다.
 * 클라이언트가 만든 DOM 을 「굵은 조각의 목록」으로 환원해 서버의 `emphasisParts` 와 맞춘다.
 */
test("⚠서버와 클라이언트가 같은 조각으로 나눈다 — 용어집 전 문장", () => {
  let checked = 0;
  for (const key of glossaryKeys()) {
    const want = proseOf(key).flatMap((s) => emphasisParts(s).filter((p) => p.bold).map((p) => p.text));
    assert.deepEqual(boldTextsUnderProse(openTip(key)), want, `${key}: 나눈 결과가 다르다`);
    checked += 1;
  }
  assert.ok(checked >= 56, `${checked}항목만 봤다 — 공회전`);
});

test("⚠짝이 맞지 않으면 양쪽 다 아무것도 하지 않는다 — 엉뚱한 곳이 굵어지는 것보다 낫다", () => {
  // 클라이언트에 심긴 그 함수를 꺼내 직접 돌린다 — 서버 함수와 **같은 입력에 같은 출력**이어야 한다
  const at = CLIENT_JS.indexOf("function emphasisParts(");
  assert.notEqual(at, -1, "클라이언트에 규칙이 없다");
  const end = CLIENT_JS.indexOf("\n}", at) + 2;
  const client = new Function(`return (${CLIENT_JS.slice(at, end)})`)() as typeof emphasisParts;

  const cases = [
    "",
    "ふつうの文",
    "**まるごと太字**",
    "前**なか**後",
    "**A**と**B**",
    "閉じていない**まま",
    "*ひとつだけ*",
    "****",
    "**",
    "端**",
    "**端",
    "**空**の**間**",
  ];
  for (const s of cases) {
    assert.deepEqual(client(s), emphasisParts(s), `조각이 다르다: ${JSON.stringify(s)}`);
  }
  // 짝이 안 맞으면 원문 한 조각 — 별표가 남는다(그것이 눈에 띄어 고쳐진다)
  assert.deepEqual(emphasisParts("閉じていない**まま"), [{ text: "閉じていない**まま", bold: false }]);
  assert.ok(serverText("閉じていない**まま").includes("**"), "짝이 안 맞는데 별표가 사라졌다");
});

/** 서버 렌더 결과의 글자만 — `<b>` 를 벗긴 것 */
function serverText(text: string): string {
  return toString(emphasize(text)).replace(/<\/?b>/g, "");
}

// ── ③ 서버 쪽 — 이스케이프와 감싸는 태그 ────────────────────────────────────

test("⚠강조가 태그를 만들지 않는다 — 나올 수 있는 태그는 b 하나뿐이다", () => {
  const out = toString(emphasize('**<script>alert(1)</script>** と <img src=x onerror=y>'));
  assert.match(out, /^<b>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/b>/);
  assert.ok(!out.includes("<script"), "태그가 그대로 나갔다");
  assert.ok(!out.includes("<img"), "태그가 그대로 나갔다");
  assert.equal(out.replace(/<\/?b>/g, "").includes("<"), false, "b 말고 다른 태그가 있다");
});

test("note() 는 그 조각을 문단으로 감싼다 — 감싸는 태그는 부르는 쪽이 정한다", () => {
  assert.equal(toString(note("前**なか**後")), '<p class="note">前<b>なか</b>後</p>');
  assert.equal(toString(emphasize("前**なか**後")), "前<b>なか</b>後");
});

test("별표가 없는 문장은 글자만 남는다 — 기존 화면의 바이트가 바뀌지 않는다", () => {
  assert.equal(toString(emphasize("ふつうの文")), "ふつうの文");
  assert.equal(toString(emphasize("A & B")), "A &amp; B");
});

// ── ④ 강조를 걸지 않는 자리 ──────────────────────────────────────────────

/**
 * ⚠**라벨과 분모 단위는 강조를 풀지 않는다** — 표 머리와 값 옆에 순수 텍스트로 나가는 이름이다.
 * 그래서 거기에 별표를 쓰면 **고칠 곳이 없다.** 쓰지 않는 것이 규칙이고, 그것을 여기서 지킨다.
 */
test("⚠라벨·분모 단위에는 별표를 쓰지 않는다 — 그 자리는 강조를 풀지 않는다", () => {
  const bad = glossaryKeys().filter(
    (k) => GLOSSARY[k]!.label.includes("**") || (GLOSSARY[k]!.den ?? "").includes("**"),
  );
  assert.deepEqual(bad, [], `라벨/분모에 별표를 쓴 용어: ${bad.join(", ")} — 그 자리는 그대로 찍힌다`);
});
