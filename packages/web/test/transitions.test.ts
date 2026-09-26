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
 *
 * ## ⚠롱핸드도 센다 — 숏핸드만 보던 이 파일의 사각지대였다(2026-09-25 감사 W10 · 2026-09-27 수정)
 *
 * 모션 감소 블록의 `*,*::before,*::after{transition-duration:var(--t1)!important}` 는
 * **롱핸드**라 이 파일이 못 봤다. 그런데 `transition-property` 의 초기값이 `all` 이라
 * 그 한 줄이 **전환을 적지 않은 모든 요소에 transition:all 1ms** 를 걸었다 —
 * 감사 실측(Chromium 에뮬레이션): 순위 화면 個人 탭을 한 번 누르면 **max-width 전환 138건**,
 * 감소 설정이 없으면 0건. 이 파일이 막는다던 「transition:all」이 **감소 모드에서만 거꾸로** 살아 있었다.
 * → 롱핸드도 뽑는다. **시간만 주고 속성을 안 적은 규칙은 초기값 `all` 로 센다** — 브라우저가 그렇게 한다.
 * ⚠이 파일은 **소스만** 본다. 감소 모드의 브라우저 실측(에뮬레이션)은 이 수정에서 **안 쟀다**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** ⚠주석 안의 예시가 규칙으로 잡히면 이 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** 규칙 하나(가장 안쪽 중괄호) — `@media` 안의 규칙도 여기 걸린다 */
const RULE = /([^{}\n][^{}]*)\{([^{}]*)\}/g;

/** 선언값 끝의 `!important` 를 뗀다 — 속성 이름 목록에 섞이면 안 된다 */
const bare = (v: string): string => v.replace(/\s*!important\s*$/, "").trim();

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
  for (const m of css.matchAll(RULE)) {
    const sel = m[1]!.trim().replace(/\s+/g, " ");
    const body = m[2]!;
    for (const t of body.matchAll(/(?:^|;)\s*transition:\s*([^;]+)/g)) {
      out.push({
        sel,
        props: bare(t[1]!).split(",").map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean),
      });
    }
    /**
     * ⚠**롱핸드**(W10). 시간만 있고 속성이 없으면 그 요소의 속성은 **초기값 `all`** 이다 —
     * 다른 규칙이 속성을 적어 주지 않는 한. 이 추출기는 **같은 규칙만** 보므로 `all` 로 센다:
     * 시간을 주는 규칙이 **속성까지 이름으로 적게** 만드는 것이 목적이다(숏핸드에 요구하는 것과 같다).
     */
    const prop = /(?:^|;)\s*transition-property:\s*([^;]+)/.exec(body)?.[1];
    const dur = /(?:^|;)\s*transition-duration:\s*([^;]+)/.exec(body)?.[1];
    if (prop !== undefined || dur !== undefined) {
      out.push({
        sel,
        props: prop === undefined ? ["all"] : bare(prop).split(",").map((p) => p.trim()).filter(Boolean),
      });
    }
  }
  return out;
}

/**
 * **주어가 `*` 인 선택자** — `*` · `*::before` · `.x > *`.
 * ⚠마지막 복합 선택자만 본다 — 규칙이 실제로 걸리는 대상은 그것이다.
 */
function isUniversal(part: string): boolean {
  const last = part.trim().split(/\s*[>+~]\s*|\s+/).pop() ?? "";
  return /^\*(?:::?[a-z-]+(?:\([^)]*\))?)*$/.test(last);
}

/**
 * 중괄호를 세어 `@media …{ … }` 한 덩어리를 꺼낸다.
 * ⚠`assets.test.ts` 의 같은 이름 함수를 가져오지 않는다 — 시험 파일을 import 하면
 * **그 파일의 시험까지 이 실행에 같이 등록된다.**
 */
function atRuleBody(src: string, head: string): string {
  const at = src.indexOf(head);
  if (at < 0) return "";
  let depth = 0;
  for (let i = at + head.length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at + head.length, i);
  }
  return "";
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
      "⚠롱핸드도 같다: transition-duration 만 주고 transition-property 를 안 적으면 초기값 all 이다(W10).\n" +
      "⚠font-weight 를 넣지 마라: 글자 굵기가 보간되면 폭이 프레임마다 달라져 줄이 흔들린다.",
  );
});

/**
 * ⚠**전역 선택자(`*`)는 전환을 만지지 않는다**(W10).
 *
 * `*` 는 **페이지의 모든 요소**이고, 그 대부분은 전환을 적지 않았으니 `transition-property` 가
 * 초기값 `all` 이다 — **시간 하나만 줘도 전부 `transition:all` 이 된다.**
 * 속성까지 적으면 이번에는 **각 요소가 이름으로 적어 둔 속성 목록을 덮어쓴다.**
 * 어느 쪽이든 전역에서 할 일이 아니다.
 * ⚠모션 감소가 전환에 닿는 길은 **토큰**이다(바로 아래 시험) — 전역 못 박기가 필요 없다.
 */
test("⚠W10 전역 선택자(*)가 전환 속성을 갖지 않는다 — 초기값 all 과 만나 모든 요소에 transition:all 을 건다", () => {
  const bad: string[] = [];
  let universal = 0;
  for (const m of css.matchAll(RULE)) {
    const sel = m[1]!.trim().replace(/\s+/g, " ");
    if (!sel.split(",").some(isUniversal)) continue;
    universal += 1;
    const decl = [...m[2]!.matchAll(/(?:^|;)\s*(transition(?:-[a-z-]+)?)\s*:/g)].map((d) => d[1]!);
    if (decl.length > 0) bad.push(`${sel} → ${decl.join(" · ")}`);
  }
  // ⚠**공회전 방지** — 감소 블록의 `*` 규칙(애니메이션 못 박기)이 있으므로 0 이면 정규식이 헛돈다
  assert.ok(universal >= 1, "전역 선택자 규칙을 하나도 못 찾았다 — 정규식이 헛돈다");
  assert.deepEqual(
    bad,
    [],
    "전역 선택자가 전환 속성을 갖는다 — 전환을 적지 않은 모든 요소가 초기값 all 로 전환된다.\n" +
      "⚠모션 감소는 --t1~--t3 토큰 재정의가 맡는다. 전역에서 시간을 못 박지 마라.",
  );
});

/**
 * ⚠**전역 못 박기를 뺀 근거를 시험으로 둔다**(W10).
 *
 * 감소 블록은 `:root` 의 시간 토큰(--t1~--t3)을 1ms 로 내린다. 모든 전환이 **그 토큰으로만**
 * 시간을 받으면 감소는 전환 하나하나에 닿는다 — 그래서 `*` 에 시간을 못 박을 이유가 없다.
 * ⚠**이 시험이 곧 안전망이다**: 전환 시간을 토큰 밖(리터럴은 `design-tokens.test.ts` 가 막는다)이나
 * **감소 블록이 안 내리는 토큰**으로 주면 여기서 운다. 감소 블록에서 토큰 재정의를 빼도 운다.
 */
test("⚠W10 전환 시간은 전부 감소 블록이 1ms 로 내리는 토큰이다 — 전역 못 박기 없이 감소가 닿는 근거", () => {
  const block = atRuleBody(css, "@media (prefers-reduced-motion:reduce){");
  assert.notEqual(block, "", "모션 감소 블록이 없다 — 이 시험이 공회전한다");
  const reduced = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) reduced.set(m[1]!, m[2]!.trim());
  const outside = css.replace(block, "");
  const bad: string[] = [];
  let decls = 0;
  let times = 0;
  for (const m of outside.matchAll(RULE)) {
    const sel = m[1]!.trim().replace(/\s+/g, " ");
    for (const d of m[2]!.matchAll(/(?:^|;)\s*(transition(?:-duration|-delay)?)\s*:\s*([^;]+)/g)) {
      decls += 1;
      for (const v of d[2]!.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const name = v[1]!;
        if (name.startsWith("--e-")) continue; // 이징 곡선 — 시간이 아니다
        times += 1;
        const to = reduced.get(name);
        if (to === undefined || !/^(?:1ms|0m?s|0)$/.test(to)) {
          bad.push(`${sel} → ${d[1]}: ${name} (감소 블록에서 ${to ?? "재정의 없음"})`);
        }
      }
    }
  }
  // ⚠**공회전 방지** — 전환 선언이 거의 없으면 이 시험은 아무것도 안 잰다(첫 시험의 하한과 같은 수)
  assert.ok(decls >= 25, `전환 선언을 ${decls}개밖에 못 찾았다 — 정규식이 헛돈다`);
  assert.ok(times >= 25, `시간 토큰을 ${times}개밖에 못 찾았다 — var() 를 읽는 정규식이 헛돈다`);
  assert.deepEqual(
    bad,
    [],
    "감소 설정에서 1ms 로 안 내려가는 전환 시간이 있다 — 전역 못 박기가 없으니 이 전환은 감소를 무시한다.\n" +
      "⚠시간은 --t1/--t2/--t3 로 주거나, 새 토큰이면 감소 블록의 :root 에서도 1ms 로 내려라.",
  );
  console.log(`  · 감소 블록 밖 전환 선언 ${decls}개 · 시간 토큰 ${times}개가 전부 감소 블록에서 1ms 이하로 내려간다`);
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
