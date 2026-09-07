/**
 * 디자인 토큰의 **척도**를 붙든다 — 1단계(2026-09-07)에서 세운 배선이 흩어지지 않게.
 *
 * 이 스타일시트에는 오래전부터 색 토큰이 있었지만 **간격·활자·괘선 굵기·모션 시간은
 * 값이 흩어져 있었다.** 1단계는 그것들을 한 곳에 모으는 배선이고, **화면은 안 바꿨다.**
 *
 * ⚠**「척도를 세웠다」와 「전부 척도 위에 있다」는 다르다.** 실측하면 현행은 척도 위에 없다 —
 *   간격은 5·6·7·9·10·11px 이 대량으로 있고 활자는 9~16px 사이에 0.5px 단으로 13종이다.
 *   **맞추지 않고 남겼다**(그건 값을 바꾸는 일이고 2단계다). 대신 **그 수를 여기서 센다.**
 *
 * ⚠**그래서 이 시험의 목적은 「0으로 만드는 것」이 아니라 「늘지 못하게 하는 것」이다.**
 *   예산을 줄이는 것이 2단계의 성과 지표가 된다. **예산을 올리지 마라** —
 *   올려야 할 것 같으면 그건 새 값을 척도 밖에 만들었다는 뜻이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** 주석 안의 예시가 규칙으로 잡히면 이 시험이 통째로 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** 중첩 { 가 없는 블록 = 선언 블록. 그 안의 선언만 센다(미디어 조건은 안 센다) */
function declarations(): { prop: string; val: string }[] {
  const out: { prop: string; val: string }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") stack.push(i);
    else if (css[i] === "}") {
      const open = stack.pop();
      if (open === undefined) continue;
      const body = css.slice(open + 1, i);
      if (body.includes("{")) continue;
      for (const d of body.split(";")) {
        const at = d.indexOf(":");
        if (at < 0) continue;
        out.push({ prop: d.slice(0, at).trim(), val: d.slice(at + 1).trim() });
      }
    }
  }
  return out;
}
const DECLS = declarations();

/** 기본 `:root`(첫 미디어 쿼리 앞)에서 토큰 값을 읽는다 */
function rootTokens(): Map<string, string> {
  const head = css.slice(0, css.indexOf("@media"));
  const m = new Map<string, string>();
  for (const d of head.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) m.set(d[1]!, d[2]!.trim());
  return m;
}
const TOK = rootTokens();

const SPACE_PROP =
  /^(padding|margin|gap|row-gap|column-gap|padding-(top|right|bottom|left)|margin-(top|right|bottom|left)|padding-inline|padding-block|scroll-margin-top|scroll-padding-left)$/;
const BORDER_PROP = /^border(-(top|right|bottom|left))?(-width)?$/;

test("⚠간격 척도가 유도 가능하다 — s(n) = 4n px", () => {
  const steps = [...TOK.keys()].filter((k) => /^--s\d+$/.test(k)).sort();
  assert.ok(steps.length >= 5, `간격 토큰이 ${steps.length}개뿐이다 — 척도가 아니다`);
  for (const k of steps) {
    const n = Number(k.slice(3));
    assert.equal(TOK.get(k), `${4 * n}px`, `${k} 가 4×${n}px 가 아니다 — 계단이 아니면 유도가 안 된다`);
  }
  // 빠진 단이 있으면 「4n」이라는 규칙이 거짓이 된다
  assert.deepEqual(
    steps.map((k) => Number(k.slice(3))),
    steps.map((_, i) => i + 1),
    "간격 단이 이어지지 않는다",
  );
});

test("⚠죽은 척도 토큰이 없다 — 선언만 하고 안 쓰는 이름은 장식이다", () => {
  const scale = [...TOK.keys()].filter((k) => /^--(s\d+|fs-|w-|rw-|r-|t\d+$|t-stagger|e-out)/.test(k));
  assert.ok(scale.length >= 20, `척도 토큰을 ${scale.length}개밖에 못 찾았다 — 정규식이 헛돈다`);
  const dead = scale.filter((k) => !css.includes(`var(${k})`));
  assert.deepEqual(dead, [], "쓰이지 않는 척도 토큰이 있다 — 값이 생기는 자리에서 만들어라");
});

test("⚠모션 시간이 리터럴로 남아 있지 않다 — 시간은 토큰에서만 나온다", () => {
  const raw: string[] = [];
  for (const d of DECLS) {
    if (d.prop.startsWith("--")) continue;
    if (!/^(transition|animation)(-(duration|delay))?$/.test(d.prop)) continue;
    for (const m of d.val.matchAll(/(?<![\w.-])(\d*\.?\d+)m?s(?![\w-])/g)) {
      if (m[1] === "0") continue; // 0 은 단위가 있으나 없으나 0 이다
      raw.push(`${d.prop}:${d.val}`);
    }
  }
  assert.deepEqual(raw, [], "모션 시간을 값으로 박았다 — --t1/--t2/--t3 를 쓰거나 새 단을 척도에 만들어라");
});

/**
 * ⚠**아래 넷은 「지금 이만큼 이탈해 있다」는 실측이다**(2026-09-07 · 토큰 1단계 직후).
 * 2단계에서 값을 접으면 **내려간다.** 올라가면 그건 척도 밖에 새 값을 만들었다는 뜻이다.
 */
const BUDGET = {
  space: 339,       // 5·6·7·9·10·11px 이 대부분이다. 4px 계단이 아니었다
  fontSize: 57,     // 12.5px 12 · 15px 8 · 9px 7 · 14px 7 · 13.5px 6 · …
  fontWeight: 2,    // 500 하나 · 800 하나
  borderWidth: 0,   // ⚠**여기만 0 이다** — border 굵기는 전부 --rw-* 에서 나온다
};

function offScale() {
  const S = new Set([...TOK.keys()].filter((k) => /^--s\d+$/.test(k)).map((k) => TOK.get(k)!));
  const space: string[] = [];
  const fontSize: string[] = [];
  const fontWeight: string[] = [];
  const borderWidth: string[] = [];
  for (const d of DECLS) {
    if (d.prop.startsWith("--")) continue;
    if (SPACE_PROP.test(d.prop)) {
      for (const m of d.val.matchAll(/(^|[^-\w.])(\d*\.?\d+px)/g)) if (!S.has(m[2]!)) space.push(`${d.prop}:${d.val}`);
    } else if (d.prop === "font-size") {
      if (/^\d*\.?\d+px$/.test(d.val)) fontSize.push(d.val);
    } else if (d.prop === "font-weight") {
      if (/^\d+$/.test(d.val)) fontWeight.push(d.val);
    } else if (BORDER_PROP.test(d.prop)) {
      const w = /^(0|\d*\.?\d+px)(?=$|\s)/.exec(d.val);
      if (w) borderWidth.push(`${d.prop}:${d.val}`);
    }
  }
  return { space, fontSize, fontWeight, borderWidth };
}

test("⚠척도 이탈 예산 — 늘어나지 않는다", () => {
  const off = offScale();
  const count = (k: keyof typeof BUDGET): number => off[k].length;
  console.log(
    `  · 척도 밖: 간격 ${count("space")} · 활자 ${count("fontSize")} · 웨이트 ${count("fontWeight")} · 괘선 ${count("borderWidth")}`,
  );
  for (const k of Object.keys(BUDGET) as (keyof typeof BUDGET)[]) {
    assert.ok(
      count(k) <= BUDGET[k],
      `${k} 의 척도 이탈이 ${count(k)}건으로 예산 ${BUDGET[k]}건을 넘었다.\n`
        + "⚠**예산을 올리지 마라** — 새 값을 만들었으면 척도에 단을 만들고 거기서 꺼내 써라.\n"
        + `  예: ${[...new Set(off[k])].slice(0, 8).join(" / ")}`,
    );
  }
});
