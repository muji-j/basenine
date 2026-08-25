/**
 * **강제 색 모드(Windows 고대비 등)에서 상태가 사라지지 않는가.**
 *
 * ⚠**대응 규칙이 1,900여 줄에 0개였다**(2026-08-25 · 감사 P3 #34).
 * 저장소는 그 모드를 **알고 있었다** — `tr.thin` 옆 주석이 「forced-colors: active 에서
 * box-shadow 는 none 이 되고 color 도 강제된다」고 적고 `.qmk` 글자 표식을 그 근거로 둔다.
 * **알면서 한 곳에만 적용했다.**
 *
 * ## 무엇이 죽고 무엇이 사는가
 *
 * OS 가 갈아치우는 것: `color` · `background-color` · `border-color` · `outline-color` · `fill` · `stroke`.
 * ⚠**`box-shadow` 는 아예 `none`** 이 된다.
 * 살아남는 것: `font-weight` · `content` · `border-style` · `text-decoration` · `stroke-width` ·
 * 크기 · 위치 · **시스템 색 키워드**(`Highlight` 등은 갈아치우지 않는다).
 *
 * ## ⚠브라우저로는 확인하지 못했다
 *
 * 실제 렌더는 Windows 고대비를 켜야 보이고 그건 CI 에 없다 —
 * `topbar-geometry.test.ts` 가 같은 이유로 「기하가 아니라 기하를 결정하는 구조를 잰다」고
 * 적은 그 자리다. 여기서 지키는 것도 **구조**다:
 * **죽는 채널만으로 말하는 상태를 목록 밖에 남기지 않는다.**
 * 새 상태 규칙을 넣으면 이 시험이 먼저 울고, 그때 **「이 상태가 색 없이도 보이는가」를
 * 손으로 재게** 된다(`css-contrast.test.ts` 의 `OPACITY_ALLOWED` 와 같은 장치다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** 주석 안의 예시가 규칙으로 잡히면 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 상태를 말하는 표식.
 *
 * ⚠**처음엔 `.ok`·`.bad`·`.fav` 가 빠져 있었고, 그래서 분모가 작았다**(2026-08-25).
 * 「죽는 규칙 18개」라고 셌는데 스캐너가 그 셋을 아예 안 보고 있었다 —
 * 아래 「사유만 남고 대상이 없는 항목」 시험이 `td.ok` 를 뱉으면서 드러났다.
 * **목록이 스캐너보다 넓으면 스캐너가 좁은 것이다.**
 */
const STATE = /\[aria-(?:pressed|selected|current|sort)="[^"]*"\]|\.(?:on|off|me|thin|fresh|stale|ok|bad|fav)\b/;
/** 강제 색 모드에서 갈아치워지거나 사라지는 선언 */
const DIES = /^(?:color|background|background-color|border-color|outline-color|box-shadow|fill|stroke)$/;
/** 그 모드에서 그대로 남는 선언 */
const LIVES =
  /^(?:font-weight|font-style|font-size|text-decoration|content|border-style|border-width|outline-style|outline-width|stroke-width|transform|width|height|display|padding|margin)$/;

/** `@media (forced-colors:active)` 블록 안의 본문 */
function forcedBlock(): string {
  const at = css.search(/@media\s*\(forced-colors\s*:\s*active\)\s*\{/);
  assert.notEqual(at, -1, "@media (forced-colors:active) 블록이 없다");
  let depth = 0, i = css.indexOf("{", at);
  const start = i + 1;
  for (; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") { depth -= 1; if (depth === 0) return css.slice(start, i); }
  }
  throw new Error("forced-colors 블록의 끝을 못 찾았다 — 이 시험이 공회전한다");
}

/**
 * ⚠**죽는 채널만 쓰는 상태 규칙은 전부 여기 있어야 한다.**
 * `covered` = 위 블록이 다시 말해 준다 · `why` = 다른 규칙·글자가 그 상태를 이미 말한다.
 * ⚠**「아마 괜찮다」를 적지 마라** — 무엇이 그 상태를 말하는지 이름을 적어라.
 */
const JUSTIFIED: readonly { sel: string; covered?: true; why: string }[] = [
  { sel: '.qhits li.on a', covered: true, why: "background+box-shadow 뿐 · 강조색으로 다시 말한다" },
  { sel: '.card[aria-selected="true"]', covered: true, why: "바탕 .card 와 테두리 굵기가 같아 구별이 사라진다 · 윤곽으로 말한다" },
  { sel: '.brand[aria-current="page"]', covered: true, why: "box-shadow 밑줄 하나뿐 · 글자 밑줄로 바꾼다" },
  { sel: '.tnav a[aria-current="true"]', covered: true, why: "page 는 font-weight 로 사는데 이쪽은 못 산다 · 점선 밑줄" },
  { sel: '.favbtn[aria-pressed="true"]', covered: true, why: "눌려도 글자가 ★ 그대로다 · 윤곽으로 말한다" },

  { sel: ".state.stale", why: "문장 자체가 다르다(更新が止まっています ↔ 最新の試合…)" },
  { sel: ".state.fresh", why: "같은 이유" },
  { sel: ".mf-ax.on .mf-spoke", why: ".mf-ax.on .mf-dot 의 transform 과 .mf-lab 의 font-weight 가 남는다" },
  { sel: ".scroller tr.me td:first-child", why: "tr.me td 의 font-weight:700 이 남는다" },
  { sel: "tr.me:hover td", why: "같은 이유" },
  { sel: "tr.thin td", why: "이름 옆 .qmk 글자 표식이 남는다(그 주석이 이 모드를 사유로 적는다)" },
  { sel: "tr.thin td:first-child", why: "같은 이유" },
  { sel: '.dg .c.thin u', why: "얇음은 힌트다 — 값(.dg .c u)과 분모(.dg .c s)는 색과 무관하게 그대로 보인다" },
  { sel: "td.ok", why: "글자가 「取得済み」라고 적혀 있다 · 색은 강조일 뿐이다" },
  { sel: '.pk[aria-pressed="true"] s', why: "부모 .pk[aria-pressed] 의 font-weight:700 이 남는다" },
  { sel: '.pk[aria-pressed="true"] em', why: "같은 이유" },
  // ⚠`.dia .db.on` 은 **여기 없다** — `stroke-width` 1.2→2 로 살아남아 이 목록의 대상이 아니다.
  //   한때 적어 뒀다가 「사유만 남고 대상이 없는 항목」 시험이 잡아냈다.
  { sel: ".dia .do.on", why: "fill:none→색 · none 은 색이 아니라 강제 대상이 아니므로 채움 유무가 남는다" },
  { sel: ".gcard.off .gvenue,.gcard.off .gt,.gcard.off .gr", why: ".gcard.off 의 border-style:dashed 가 남는다" },
  { sel: 'th[aria-sort="ascending"] .sortable i,th[aria-sort="descending"] .sortable i', why: "::before 의 content 가 ↕→↑↓ 로 바뀐다" },
];

/** 상태 규칙 중 죽는 채널만 쓰는 것 */
function dyingStateRules(): string[] {
  const out: string[] = [];
  const forced = forcedBlock();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.trim().replace(/\s+/g, " ");
    if (!STATE.test(sel)) continue;
    // 대응 블록 안의 규칙 자체는 대상이 아니다
    if (forced.includes(m[0]!)) continue;
    const props = [...m[2]!.matchAll(/(?:^|;)\s*([a-z-]+):/g)].map((p) => p[1]!);
    if (props.some((p) => LIVES.test(p))) continue;
    if (!props.some((p) => DIES.test(p))) continue;
    out.push(sel);
  }
  return out;
}

test("⚠상태 규칙을 뽑는 방식이 헛돌지 않는다 — 아래 시험이 여기에 얹혀 있다", () => {
  const dying = dyingStateRules();
  assert.ok(dying.length >= 15, `죽는 상태 규칙을 ${dying.length}개밖에 못 찾았다 — 정규식이 헛돈다`);
  console.log(`  · 죽는 상태 규칙 ${dying.length}개 / 정당화 목록 ${JUSTIFIED.length}개`);
});

test("⚠강제 색 모드 대응 블록이 있다", () => {
  const body = forcedBlock();
  assert.ok(body.trim().length > 0, "대응 블록이 비었다");
  const rules = [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].length;
  assert.ok(rules >= 5, `대응 규칙이 ${rules}개뿐이다 — 목록의 covered 와 안 맞는다`);
});

test("⚠covered 라고 적은 것은 실제로 그 블록 안에 있다", () => {
  const body = forcedBlock();
  const missing = JUSTIFIED.filter((j) => j.covered === true && !body.includes(j.sel)).map((j) => j.sel);
  assert.deepEqual(missing, [], "covered 라고 적었는데 대응 블록에 없다 — 적기만 하고 안 고친 것이다");
});

/**
 * ⚠**안 쓰이는 사유는 낡은 주장이다.** 규칙이 고쳐져 더는 죽지 않는데 사유만 남으면,
 * 다음 사람이 그 목록을 「지금도 그렇다」로 읽는다 — 이 저장소가 반복해 데인 모양이다.
 * `covered` 는 예외다: 대응 블록이 살려 놓았으니 여기서는 안 잡히는 것이 정상이다.
 */
test("⚠사유만 남고 대상이 없는 항목이 없다", () => {
  const dying = dyingStateRules();
  const stale = JUSTIFIED
    .filter((j) => j.covered !== true && !dying.includes(j.sel))
    .map((j) => `${j.sel} — 적힌 사유: ${j.why}`);
  assert.deepEqual(
    stale,
    [],
    "이 항목들은 더는 죽지 않는다(또는 선택자가 바뀌었다) — 목록에서 빼거나 선택자를 고쳐라",
  );
});

test("⚠죽는 채널만 쓰는 상태 규칙은 전부 사유가 적혀 있다", () => {
  const known = JUSTIFIED.map((j) => j.sel);
  const unknown = dyingStateRules().filter((sel) => !known.includes(sel));
  assert.deepEqual(
    unknown,
    [],
    "강제 색 모드에서 사라지는 상태 규칙이 새로 생겼다.\n" +
      "⚠**「이 상태가 색 없이도 보이는가」를 손으로 재라.** 보이면 무엇이 그것을 말하는지\n" +
      "  이름을 적어 JUSTIFIED 에 넣고, 안 보이면 @media (forced-colors:active) 에서 다시 말해라.\n" +
      "  ⚠「아마 괜찮다」는 사유가 아니다.",
  );
});
