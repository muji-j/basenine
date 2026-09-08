/**
 * 디자인 토큰의 **척도**를 붙든다 — 1단계(2026-09-07)에서 세운 배선이 흩어지지 않게.
 *
 * 이 스타일시트에는 오래전부터 색 토큰이 있었지만 **간격·활자·괘선 굵기·모션 시간은
 * 값이 흩어져 있었다.** 1단계는 그것들을 한 곳에 모으는 배선이고, **화면은 안 바꿨다.**
 *
 * ⚠**「척도를 세웠다」와 「전부 척도 위에 있다」는 다르다.** 1단계 직후의 실측은
 *   **간격 339 · 활자 57 · 웨이트 2** 였다 — 간격은 5·6·7·9·10·11px 이 대량이고
 *   활자는 9~16px 사이에 0.5px 단으로 13종이었다. **계단이 아니라 연속이었다.**
 *
 * ⚠**2a(2026-09-08)가 그것을 접었다 — 여기서부터 화면이 실제로 바뀐 자리다.**
 *   지금은 **간격 1 · 활자 0 · 웨이트 0** 이고, 남은 1건은 리듬이 아니라 기하다(아래 BUDGET 주석).
 *
 * ⚠**그래도 이 시험의 목적은 「0」이 아니라 「늘지 못하게 하는 것」이다.**
 *   **예산을 올리지 마라** — 올려야 할 것 같으면 그건 새 값을 척도 밖에 만들었다는 뜻이다.
 * ⚠**괘선(inset box-shadow)과 모서리는 아직 이 시험이 안 센다** — 2b 의 몫이다.
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
  /^(padding|margin|gap|row-gap|column-gap|padding-(top|right|bottom|left)|margin-(top|right|bottom|left)|padding-inline|padding-block|scroll-margin-top|scroll-padding-top|scroll-padding-left)$/;
const BORDER_PROP = /^border(-(top|right|bottom|left))?(-width)?$/;

/**
 * 간격 척도의 규칙(2026-09-08 · 2a).
 *
 * ⚠**~~s(n) = 4n~~ 이 아니다.** 4px 격자는 **이 제품의 아래쪽 절반에서 너무 거칠다** —
 * 표 셀 여백이 사는 2~8px 구간에서 4px 단은 한 걸음이 50% 다. 실제로 현행 화면이 쓰고 있던 값은
 * 1·2·3·5·6·7·9·10·11px 이었고, 그걸 4n 으로만 접으면 **여백을 늘리는 쪽**이 되어
 * 밀도가 깎인다(이 제품에서 그건 개악이다).
 * → **네 단마다 걸음이 두 배가 되는 계단**으로 바꿨다:
 *   `2·4·6·8`(걸음 2) → `12·16·20·24`(걸음 4) → `32·40·…`(걸음 8).
 * ⚠**이름이 바뀐 게 아니라 값이 바뀌었다** — 옛 --s1(4px)은 지금 --s2 다.
 */
function expectedStep(n: number): number {
  let px = 0;
  for (let i = 1; i <= n; i++) px += 2 * 2 ** Math.floor((i - 1) / 4);
  return px;
}

test("⚠간격 척도가 유도 가능하다 — 네 단마다 걸음이 두 배", () => {
  const steps = [...TOK.keys()].filter((k) => /^--s\d+$/.test(k)).sort();
  assert.ok(steps.length >= 8, `간격 토큰이 ${steps.length}개뿐이다 — 척도가 아니다`);
  // ⚠**공회전 방지** — 규칙이 실제로 계단을 만드는지 먼저 확인한다
  assert.deepEqual([1, 2, 4, 5, 8, 9].map(expectedStep), [2, 4, 8, 12, 24, 32], "규칙 자체가 틀렸다");
  for (const k of steps) {
    const n = Number(k.slice(3));
    assert.equal(TOK.get(k), `${expectedStep(n)}px`, `${k} 가 ${expectedStep(n)}px 가 아니다 — 계단이 아니면 유도가 안 된다`);
  }
  // 빠진 단이 있으면 규칙이 거짓이 된다
  assert.deepEqual(
    steps.map((k) => Number(k.slice(3))),
    steps.map((_, i) => i + 1),
    "간격 단이 이어지지 않는다",
  );
});

/**
 * 활자 사다리의 위쪽 절반(2026-09-08 · 2a).
 *
 * ⚠**아래쪽 7단(9.5~13px)은 안 건드렸다** — 그건 서체를 바꾸는 3단계의 일이고,
 * 여기서 0.5px 단을 접으면 106개 선언의 글자 크기가 한꺼번에 움직인다.
 * ⚠**위쪽에는 단이 아예 없었다.** 13px 위로는 토큰이 0개였고 화면에는
 * 14·14.5·15·16·17·18·19·20·21·22·26·28·34·36·44px 이 흩어져 있었다 —
 * 「이탈」이라기보다 **척도의 절반이 없었던 것**이다.
 * → **14 × 1.26ⁿ**(세 단마다 두 배) 로 여섯 단을 만들어 그 15종을 여기로 접었다.
 */
test("⚠활자 사다리 — 14 × 1.26ⁿ(세 단마다 두 배)", () => {
  const want = [0, 1, 2, 3, 4, 5].map((k) => Math.round(14 * 1.26 ** k));
  assert.deepEqual(want, [14, 18, 22, 28, 35, 44], "사다리 규칙 자체가 틀렸다 — 이 시험이 공회전한다");
  const got = ["--fs-name", "--fs-title", "--fs-num", "--fs-score", "--fs-score-2", "--fs-score-3"].map(
    (k) => TOK.get(k),
  );
  assert.deepEqual(got, want.map((n) => `${n}px`), "활자 사다리가 규칙에서 벗어났다");
});

/**
 * ⚠**한 선언 안에서 척도와 리터럴을 섞지 마라.**
 *
 * 1단계가 남긴 함정이 정확히 이것이었다: `padding:5px var(--s2)` 처럼 한 축은 토큰,
 * 한 축은 리터럴인 선언이 **39개** 있었다. 그 상태로 --s2 를 움직이면
 * **세로/가로 중 한쪽만 따라온다** — 눈으로는 안 보이고 값만 어긋난다.
 */
test("⚠간격 선언에 척도와 px 리터럴이 섞여 있지 않다", () => {
  const mixed: string[] = [];
  for (const d of DECLS) {
    if (d.prop.startsWith("--")) continue;
    if (!SPACE_PROP.test(d.prop)) continue;
    if (!/var\(--s\d/.test(d.val)) continue;
    if (/(^|[^-\w.])\d*\.?\d+px/.test(d.val)) mixed.push(`${d.prop}:${d.val}`);
  }
  assert.deepEqual(mixed, [], "한 선언이 두 척도 위에 서 있다 — 토큰을 움직이면 한 축만 따라온다");
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
 * ⚠**아래 넷은 「지금 이만큼 이탈해 있다」는 실측이다.**
 * 1단계(2026-09-07)가 세어 둔 값은 **간격 339 · 활자 57 · 웨이트 2 · 괘선 0** 이었고,
 * 2a(2026-09-08)가 그것을 척도로 접었다 — **간격 336건 · 활자 53건**이 토큰이 됐다.
 * ⚠**예산을 올리지 마라** — 올려야 할 것 같으면 그건 새 값을 척도 밖에 만들었다는 뜻이다.
 */
const BUDGET = {
  /**
   * ⚠**둘 다 리듬이 아니라 기하다** — 척도(`--s*`)에 올릴 값이 아니라서 예외로 남긴다.
   *
   * 1. `.seasons{scroll-padding-left:84px}` — sticky 라벨(「シーズン」)의 **폭**에서 나온 수.
   *    계단에 억지로 올리면 라벨 밑에 연도가 다시 겹친다(2026-08-18 에 고친 그 결함).
   *    **라벨 폭을 재는 토큰이 생기면 그때 0 이 된다.**
   * 2. `html:has(.hjump){scroll-padding-top:calc(var(--topbar) + 52px)}` —
   *    **`.hjump` 자신의 실제 높이**(sticky 두 겹째)라서 `+var(--s4)`(형제 규칙 둘의 8px)로
   *    바꾸면 앵커가 그 막대 뒤로 숨는다. **2026-09-08 검토가 잡은 사각지대**:
   *    `SPACE_PROP` 이 `scroll-margin-top`·`scroll-padding-left`는 보면서 `scroll-padding-top`
   *    은 안 봐서 이 줄이 한 번도 안 세어졌다 — 이번에 정규식에 추가해 보이게 했다.
   *    **`.hjump` 높이를 재는 토큰(`.rail`의 `--rail`과 같은 자리)이 생기면 그때 0 이 된다.**
   */
  space: 2,
  fontSize: 0,
  fontWeight: 0,
  borderWidth: 0,   // ⚠**1단계부터 0 이었다** — border 굵기는 전부 --rw-* 에서 나온다
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
  /* ⚠**위 루프는 상한(`<=`)만 본다** — 감지 정규식이 후퇴해 `space`가 실제보다 적게 잡혀도
     예산 안이면 조용히 통과한다. **그게 정확히 이 파일이 고친 사각지대의 모양이다**
     (`SPACE_PROP`이 `scroll-padding-top`을 안 보던 것 · 2026-09-08).
     `space`만은 예외 목록과 실측이 **정확히** 맞아야 그 재발을 잡는다. */
  assert.equal(
    count("space"),
    BUDGET.space,
    `간격 이탈이 ${count("space")}건인데 예산은 ${BUDGET.space}건이다 — 둘이 정확히 같지 않으면 `
      + "SPACE_PROP 감지가 예외 목록과 어긋난 것이다(새 값이 생겼거나, 잡던 것을 놓쳤거나).",
  );
});

/**
 * ⚠**진입 연출은 「화면이 명시적으로 켠 자리」에만 있다**(2026-09-08 · 2e · 방향서 §7-2).
 *
 * 기본은 꺼짐이고 **순위 화면은 안 켠다.** 그 화면은 긴 표가 84개이고
 * **이미 4,453행 전부에 트랜지션이 걸려 있다**(1단계 실측) — 연출을 더할 자리가 아니라 뺄 자리다.
 *
 * ⚠**이 시험이 없으면 「전역에 얹기」가 조용히 들어온다.** 그게 목업이 가장 하기 쉬운 실수이고,
 * 이 저장소에서 실제로 경고해 둔 것이다(「모션 같은 것을 전역에 얹을 때 이 화면이 먼저 무너진다」).
 */
/**
 * ⚠**열 묶음은 묶은 표에만 걸린다**(2026-09-08 · 2d 검토 P2 · 3단계 검토 P2).
 *
 * 홈의 순위표(10열)와 순위 화면의 표(12열)가 **`.hstand` 클래스를 공유한다.**
 * 묶음 여백을 `.hstand` 로만 걸었더니 **묶지도 않은 12열 표의 3·7·9 열에 이유 없는 16px** 이 붙었다 —
 * 계획서는 「순위 화면의 12열 표는 아직 안 묶었다」고 적어 두고 **CSS 는 이미 손대고 있었다.**
 *
 * ⚠**그 결함을 손으로 고치고 시험은 안 붙였다**(같은 PR 의 다른 항목에는 전부 붙였는데 이것만).
 * 이 저장소는 바로 이런 **재발**을 경계한다 — 그래서 여기서 못 박는다.
 */
test("⚠열 묶음 여백은 .colgrp 를 붙인 표에만 걸린다 — .hstand 만으로 걸지 않는다", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
  // nth-child(3|7|9) 에 padding-left 를 주는 규칙을 전부 찾는다
  const rules = [...css.matchAll(/([^{}]*nth-child\((?:3|7|9)\)[^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => /padding-left/.test(m[2]!))
    .map((m) => m[1]!.trim().replace(/\s+/g, " "));
  assert.ok(rules.length > 0, "열 묶음 여백 규칙을 못 찾았다 — 선택자가 바뀌었으면 이 시험도 고쳐라");
  const unscoped = rules.filter((r) => !r.includes(".colgrp"));
  assert.deepEqual(
    unscoped,
    [],
    "묶음 여백이 .colgrp 밖으로 나갔다 — 같은 .hstand 를 쓰는 순위 화면(12열)으로 샌다",
  );
  console.log(`  · 열 묶음 여백 규칙 ${rules.length}개 전부 .colgrp 안에 있다`);
});

test("⚠진입 연출(animation:grow)은 켠 자리에만 있다 — 전역에 얹히지 않는다", () => {
  // ⚠**주석을 먼저 걷는다** — 이 파일은 CSS 원문을 쓰므로 앞 주석이 선택자에 딸려 온다(실제로 그랬다)
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
  const users = [...css.matchAll(/([^{}]+)\{[^{}]*animation:\s*grow[^{}]*\}/g)]
    .map((m) => m[1]!.trim().replace(/\s+/g, " "))
    .sort();
  assert.deepEqual(
    users,
    [".anim .wlbar", ".track i"],
    "animation:grow 를 쓰는 자리가 바뀌었다 — 켜는 자리를 늘렸으면 그 화면의 표 길이를 먼저 재라",
  );
  console.log(`  · 진입 연출을 쓰는 선택자 ${users.length}종: ${users.join(" / ")}`);
});
