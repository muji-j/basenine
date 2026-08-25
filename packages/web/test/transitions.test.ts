/**
 * **무엇을 애니메이트하는가** — 목록으로 붙든다.
 *
 * ⚠**`transition:all` 이 하나 있었다**(2026-08-25 · 감사 P3 #36 · `.chip`). 둘이 나빴다:
 *   ⑴ 그 칩이 바꾸는 넷 중 **`font-weight` 까지 애니메이트**했다 — 글자 굵기가 보간되면
 *      칩의 폭이 프레임마다 달라지고 칩줄이 흔들린다(리플로).
 *   ⑵ **앞으로 더할 속성까지 조용히 따라간다** — `padding` 하나만 얹어도 그날부터 애니메이트된다.
 *      ⚠이것이 `transition:all` 의 본질적인 문제다. 오늘 옳아도 **내일 아무도 모르게 틀려진다.**
 *
 * ## ⚠감사가 든 「29건(93.5%)」보다 실제 대상은 훨씬 좁다
 *
 * 실측: 전환 규칙 **31개** · 그중 **합성 속성(transform/opacity/filter) 3** ·
 * **레이아웃 속성 1**(`.roster a` 의 `padding-left`) · **`transition:all` 1**(`.chip`).
 * 나머지는 색·경계·그림자 같은 **칠하기 속성**이고, 그건 레이아웃을 다시 잡지 않는다.
 * ⚠**CLAUDE.md 가 「합성 전용」을 제약으로 못 박은 적이 없다**(감사 스스로 적었다) —
 * 그래서 여기서 막는 것은 **「모르는 사이에 늘어나는 것」** 둘뿐이다:
 * `transition:all` 과 **목록에 없는 레이아웃 속성**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** ⚠주석 안의 예시가 규칙으로 잡히면 이 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** 브라우저가 레이아웃을 다시 잡는 속성 */
const LAYOUT = new Set([
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "padding", "padding-left", "padding-right", "padding-top", "padding-bottom",
  "margin", "margin-left", "margin-right", "margin-top", "margin-bottom",
  "top", "left", "right", "bottom", "inset",
  "font-size", "font-weight", "line-height", "letter-spacing", "gap", "flex", "flex-basis",
]);
const COMPOSITED = new Set(["transform", "opacity", "filter"]);

interface Tr { sel: string; props: string[] }

function transitions(): Tr[] {
  const out: Tr[] = [];
  for (const m of css.matchAll(/([^{}\n][^{}]*)\{([^{}]*)\}/g)) {
    for (const t of m[2]!.matchAll(/(?:^|;)\s*transition:\s*([^;]+)/g)) {
      out.push({
        sel: m[1]!.trim().replace(/\s+/g, " "),
        props: t[1]!.split(",").map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean),
      });
    }
  }
  return out;
}

/**
 * ⚠**레이아웃 속성을 애니메이트해도 되는 자리.** 늘리려면 **왜 합성 속성으로 못 하는지** 적어라.
 * 「가볍다」는 사유가 아니다 — **모양이 달라진다**가 사유다.
 */
const LAYOUT_ALLOWED: readonly { sel: string; prop: string; why: string }[] = [
  {
    sel: ".roster a",
    prop: "padding-left",
    why:
      "transform:translateX 로 바꾸면 아래 경계선까지 같이 밀려 줄 밑줄의 왼쪽이 4px 빈다. "
      + "padding-left 는 경계선을 제자리에 두고 내용만 민다 — 비용은 그 한 줄의 레이아웃이고 알고 고른다",
  },
];

test("⚠전환을 뽑는 방식이 헛돌지 않는다 — 아래 시험이 여기에 얹혀 있다", () => {
  const all = transitions();
  assert.ok(all.length >= 25, `전환 규칙을 ${all.length}개밖에 못 찾았다 — 정규식이 헛돈다`);
  const comp = all.filter((t) => t.props.some((p) => COMPOSITED.has(p))).length;
  const layout = all.flatMap((t) => t.props.filter((p) => LAYOUT.has(p))).length;
  console.log(`  · 전환 규칙 ${all.length}개 · 합성 포함 ${comp} · 레이아웃 속성 ${layout}`);
});

/** ⚠**오늘 옳아도 내일 아무도 모르게 틀려진다** — 그게 `transition:all` 의 본질적 문제다 */
test("⚠transition:all 을 쓰지 않는다 — 앞으로 더할 속성까지 조용히 따라간다", () => {
  const bad = transitions().filter((t) => t.props.includes("all")).map((t) => t.sel);
  assert.deepEqual(
    bad,
    [],
    "transition:all 이 돌아왔다 — **바꾸는 것을 이름으로 적어라.**\n" +
      "⚠font-weight 를 넣지 마라: 글자 굵기가 보간되면 폭이 프레임마다 달라져 줄이 흔들린다.",
  );
});

test("⚠레이아웃 속성을 애니메이트하는 자리는 목록뿐이다", () => {
  const known = new Set(LAYOUT_ALLOWED.map((a) => `${a.sel}|${a.prop}`));
  const found: string[] = [];
  for (const t of transitions()) {
    for (const p of t.props) {
      if (!LAYOUT.has(p)) continue;
      if (!known.has(`${t.sel}|${p}`)) found.push(`${t.sel} → ${p}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    "레이아웃 속성을 새로 애니메이트한다 — 호버할 때마다 그 요소의 레이아웃을 다시 잡는다.\n" +
      "⚠**transform 으로 되나 먼저 재라.** 안 되면(모양이 달라지면) LAYOUT_ALLOWED 에\n" +
      "  **왜 합성 속성으로 못 하는지**를 적어라. 「가볍다」는 사유가 아니다.",
  );
});

/** ⚠**사유만 남고 대상이 없으면 낡은 주장이다** — `forced-colors.test.ts` 와 같은 장치 */
test("⚠사유만 남고 대상이 없는 항목이 없다", () => {
  const live = new Set(
    transitions().flatMap((t) => t.props.filter((p) => LAYOUT.has(p)).map((p) => `${t.sel}|${p}`)),
  );
  const stale = LAYOUT_ALLOWED.filter((a) => !live.has(`${a.sel}|${a.prop}`)).map((a) => `${a.sel} → ${a.prop}`);
  assert.deepEqual(stale, [], "이 자리는 더는 레이아웃 속성을 애니메이트하지 않는다 — 목록에서 빼라");
});
