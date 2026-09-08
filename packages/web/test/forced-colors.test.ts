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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CSS } from "../src/assets.ts";
// ⚠**주석을 걷어내고 본다** — 안 그러면 「그 문구가 주석에도 적혀 있어서」 통과한다.
//   실제로 `更新が止まっています` 는 layout.ts 에 **주석 1 · 화면 1** 로 두 번 있고,
//   뮤테이션(화면 쪽만 지우기)이 **안 잡혔다**(2026-09-08 실측). 판정기는 scripts 에 이미 한 벌 있다(M1).
import { stripJsComments } from "../../../scripts/fonts.ts";

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
 * ⚠**「이름을 적어라」로는 부족했다**(2026-09-08 · design-auditor).
 *
 * `why` 는 **검산되지 않는 문자열**이었고, 그중 여럿이 *다른 규칙의* 살아남는 속성을
 * **산문으로 인용**했다 — 그 규칙이 고쳐지거나 사라져도 시험은 초록이었다.
 * ⚠**실제로 하나가 이미 전칭으로 부풀어 있었다**: `tr.thin td` 의 사유가 「`.qmk` 글자 표식이 남는다」인데
 * `tr.thin` 을 그리는 자리 **6곳 중 3곳**만 그 표식을 붙인다(아래 그 항목에 표로 적었다).
 *
 * → **인용을 자료구조로 옮긴다.** `css-contrast.test.ts` 의 `OPACITY_ALLOWED` 가 문자열에서
 * 계산으로 바뀐 것과 같은 수술이다.
 *
 * · `covered` — 아래 `@media (forced-colors:active)` 블록이 다시 말해 준다
 * · `cites`   — **CSS 선언**을 인용한다. 시험이 그 규칙을 찾아 선언이 실재하는지 보고,
 *               **그 속성이 이 모드에서 살아남는지**까지 확인한다
 * · `says`    — **화면에 나오는 글자**를 인용한다. 시험이 그 소스 파일에서 실제로 찾는다
 * · `noCite`  — ⚠**인용할 것이 없을 때만.** 무엇이 사라지고 왜 그래도 되는지 적는다
 *
 * ⚠**넷 중 하나도 없으면 시험이 붉어진다** — 산문만 남은 항목이 다시 생기지 못하게.
 */
type Cite = { readonly sel: string; readonly decl: string };
type Says = { readonly file: string; readonly text: string };
interface Justification {
  readonly sel: string;
  readonly covered?: true;
  readonly why: string;
  readonly cites?: readonly Cite[];
  readonly says?: readonly Says[];
  readonly noCite?: string;
}
const JUSTIFIED: readonly Justification[] = [
  { sel: '.qhits li.on a', covered: true, why: "background+box-shadow 뿐 · 강조색으로 다시 말한다" },
  { sel: '.card[aria-selected="true"]', covered: true, why: "바탕 .card 와 테두리 굵기가 같아 구별이 사라진다 · 윤곽으로 말한다" },
  { sel: '.brand[aria-current="page"]', covered: true, why: "box-shadow 밑줄 하나뿐 · 글자 밑줄로 바꾼다" },
  { sel: '.tnav a[aria-current="true"]', covered: true, why: "page 는 font-weight 로 사는데 이쪽은 못 산다 · 점선 밑줄" },
  { sel: '.favbtn[aria-pressed="true"]', covered: true, why: "눌려도 글자가 ★ 그대로다 · 윤곽으로 말한다" },

  {
    sel: ".state.stale",
    why: "문장 자체가 다르다(更新が止まっています ↔ 最新の試合…) · 색은 거드는 표시다",
    says: [
      { file: "layout.ts", text: "更新が止まっています" },
      { file: "layout.ts", text: "データがありません" },
    ],
  },
  {
    sel: ".state.fresh",
    why: "같은 이유 — 신선한 쪽의 문장도 따로 있다",
    says: [
      { file: "layout.ts", text: "まで反映" },
      { file: "layout.ts", text: "終了したシーズンです" },
    ],
  },
  {
    sel: ".mf-ax.on .mf-spoke",
    why: ".mf-ax.on .mf-dot 의 transform 과 .mf-ax.on .mf-lab 의 font-weight 가 남는다",
    cites: [
      { sel: ".mf-ax.on .mf-dot", decl: "transform:scale(2)" },
      { sel: ".mf-ax.on .mf-lab", decl: "font-weight:var(--w-bold)" },
    ],
  },
  {
    sel: ".scroller tr.me td:first-child",
    // ⚠**~~font-weight:700~~ 이라고 적혀 있었다** — CSS 가 쓰는 것은 토큰(--w-bold, 값 700)이다.
    //   값을 적어 두면 토큰이 바뀐 날 사유가 조용히 거짓이 되므로 **인용은 CSS 원문 그대로** 한다.
    why: "tr.me td 의 font-weight:var(--w-bold) 가 남는다",
    cites: [{ sel: "tr.me td", decl: "font-weight:var(--w-bold)" }],
  },
  {
    sel: "tr.me:hover td",
    why: "같은 이유 — tr.me td 의 font-weight 가 남는다",
    cites: [{ sel: "tr.me td", decl: "font-weight:var(--w-bold)" }],
  },
  // ⚠**이 규칙은 구단 색 면 위의 대비를 위한 것이다**(2026-09-08 · design-auditor P0).
  //   강제 색 모드에는 **그 면 자체가 없다** — 배경도 글자도 시스템 색으로 갈린다.
  {
    sel: "tr.me td .den",
    why: "구단 색 면 위의 대비만을 위한 규칙이고, 이 모드에는 그 면이 없다",
    noCite:
      "⚠**인용할 「남는 것」이 없는 것이 맞다.** 이 규칙이 고치는 결함(구단 색 면 위에서 분모가 안 읽힘)이" +
      " 이 모드에는 **애초에 생기지 않는다** — 배경도 글자도 시스템 색으로 갈리고, 분모는 부모 tr.me td 와" +
      " 같은 색을 받는다. **사라지는 것은 규칙이지 정보가 아니다.**",
  },
  // ⚠⚠**여기 적혀 있던 사유가 전칭으로 부풀어 있었다**(2026-09-08 · design-auditor 가 잡았다).
  //   옛 사유: 「이름 옆 .qmk 글자 표식이 남는다」 — **tr.thin 을 그리는 자리 전부가 그렇지는 않다.**
  //   ⚠**감사자가 준 수(「스플릿 표에 .qmk 0건」)는 맞지만 그것은 선수 페이지의 분모다.**
  //     저장소 전체로 다시 세면 이렇다(실측 · 아래 시험이 이 수를 붙든다):
  //
  //     그리는 곳                                .qmk   막대 흐림(opacity:.35)   행 안의 분모
  //     pages.ts 선발예고 対戦표                   있음   없음                     打席 열
  //     team-page.ts 타자표                        있음   없음                     打席 열 + valueWithDen
  //     team-page.ts 투수표                        있음   없음                     投球回 열 + valueWithDen
  //     player-page.ts 구원 스플릿                 없음   있음                     valueWithDen
  //     player-page.ts 스플릿                      없음   있음                     打席 열 + valueWithDen
  //     player-page.ts 対戦成績 표                 없음   없음                     打席 열
  //
  //   ⚠**opacity 는 이 모드에서 안 죽는다** — 강제되는 것은 색이고 opacity 는 그 목록에 없다.
  //     그래서 막대 흐림은 남는 채널이다(2/6).
  //   ⚠**여섯 중 하나(player-page 의 対戦成績 표)에만 「이 행이 얇다」를 말하는 것이 아무것도 없다.**
  //     정보는 남는다(같은 행의 打席 열이 분모다 · M2) — 사라지는 것은 **강조**다.
  //   ⚠**여기서 화면을 고치지 않는다**(감사↔구현 분리). 고칠 때의 선례는 이미 있다:
  //     parts.ts 의 thinMark() 를 그 표에도 붙이는 것이고, 나머지 셋이 **정확히 이 사유로** 그렇게 했다.
  {
    sel: "tr.thin td",
    why: "색은 죽는다 · .qmk 글자 표식이 그리는 자리 6곳 중 3곳에 있고, 막대 흐림(opacity)이 2곳에 더 있다",
    says: [{ file: "parts.ts", text: 'class="qmk"' }],
    noCite:
      "⚠**CSS 로 인용할 「남는 것」이 없다** — 남는 채널이 CSS 규칙이 아니라 마크업(.qmk)과" +
      " 인라인 opacity 이기 때문이다. ⚠**여섯 자리 중 한 곳(player-page 対戦成績 표)에는 둘 다 없다.**" +
      " 정보(분모)는 같은 행의 打席 열로 남고 사라지는 것은 강조다.",
  },
  {
    sel: "tr.thin td:first-child",
    why: "같은 이유 — 이 규칙의 box-shadow 괘선은 이 모드에서 none 이 된다",
    says: [{ file: "parts.ts", text: 'class="qmk"' }],
    noCite: "⚠위 tr.thin td 와 같다 — box-shadow 는 none 이 되고, 대신 말해 주는 CSS 선언이 없다.",
  },
  {
    sel: ".dg .c.thin u",
    why: "얇음은 힌트다 — 값(.dg .c u)과 분모(.dg .c s)는 색과 무관하게 그대로 그려진다",
    cites: [
      { sel: ".dg .c u", decl: "display:block" },
      { sel: ".dg .c s", decl: "display:block" },
    ],
  },
  {
    sel: "td.ok",
    why: "글자가 「取得済み」라고 적혀 있다 · 색은 강조일 뿐이다",
    says: [{ file: "log-page.ts", text: "取得済み" }],
  },
  {
    sel: '.pk[aria-pressed="true"] s',
    why: "부모 .pk[aria-pressed=true] 의 font-weight 가 남는다",
    cites: [{ sel: '.pk[aria-pressed="true"]', decl: "font-weight:var(--w-bold)" }],
  },
  {
    sel: '.pk[aria-pressed="true"] em',
    why: "같은 이유",
    cites: [{ sel: '.pk[aria-pressed="true"]', decl: "font-weight:var(--w-bold)" }],
  },
  // ⚠**2b 에서 쉬는 탭의 테두리를 껐고**(인접한 두 상자가 사이에 선을 두 개 세웠다),
  //   세그먼티드 줄에서만 되살렸다 — 거기서는 붙은 상자 모양 자체가 「둘 중 하나」를 말한다.
  //   그 되살리는 규칙이 상태(고르지 않음)를 색으로만 말하므로 강제 색 모드에서 죽는다.
  // ⚠**:where() 로 감싼 형태다.** 안 감싸면 :not() 안의 속성 선택자가 특이도를 (0,5,0) 으로
  //   올려 .tab:hover 까지 눌러 **호버 강조가 죽는다**(검토 P1 · 실측으로 재현했다).
  {
    sel: '.tabs.seg .tab:where(:not([aria-selected="true"]):not([aria-pressed="true"]))',
    why: "쉬는 세그먼트에 테두리를 돌려주는 규칙이라 강제 색에서 색이 죽는다 — 고른 쪽은 굵기로 산다",
    cites: [
      { sel: '.tab[aria-pressed="true"],.tab[aria-selected="true"]', decl: "font-weight:var(--w-bold)" },
    ],
  },
  // ⚠**홀로 서는 토글의 테두리 규칙 둘**(2026-09-08 · 2차 검토 F1). 선택자에 aria-pressed 가
  //   들어 있어 상태 규칙으로 잡힌다. 강제 색 모드에서는 **이 규칙이 없어도 괜찮다** —
  //   그 모드는 transparent 테두리마저 시스템 색으로 강제하므로(실측 rgb(0,0,0))
  //   토글이 스스로 상자를 되찾는다. 우리가 색으로 메우는 것은 **일반 모드의 구멍**이다.
  {
    sel: '.mfind .tab:where(:not([aria-pressed="true"]))',
    why: "일반 모드에서 홀로 선 토글의 경계를 만드는 규칙 — 강제 색 모드는 테두리를 스스로 강제하고, 눌림/안 눌림은 굵기가 나른다",
    cites: [
      { sel: '.tab[aria-pressed="true"],.tab[aria-selected="true"]', decl: "font-weight:var(--w-bold)" },
    ],
  },
  {
    sel: '.mfind .tab:hover:where(:not([aria-pressed="true"]))',
    why: "같은 이유 — 호버는 강제 색 모드에서 색으로 말할 수 없고, 눌림/안 눌림은 굵기가 나른다",
    cites: [
      { sel: '.tab[aria-pressed="true"],.tab[aria-selected="true"]', decl: "font-weight:var(--w-bold)" },
    ],
  },
  // ⚠**호버 쪽도 같은 이유로 목록에 든다** — 선택자에 aria-* 가 들어 있어서다(뜻은 「고르지 않은 것」).
  //   강제 색 모드에서 호버의 테두리 색은 죽지만, **구별해야 할 상태(고름/안 고름)는 굵기가 나른다.**
  //   호버 자체의 피드백은 그 모드에서 시스템이 맡는 몫이고 우리가 색으로 되살릴 수 없다.
  {
    sel: '.tabs.seg .tab:hover:where(:not([aria-selected="true"]):not([aria-pressed="true"]))',
    why: "같은 이유 — 고름/안 고름은 굵기가 나른다. 호버는 강제 색 모드에서 색으로 말할 수 없다",
    cites: [
      { sel: '.tab[aria-pressed="true"],.tab[aria-selected="true"]', decl: "font-weight:var(--w-bold)" },
    ],
  },
  // ⚠**같은 처방을 .chip.fav 에도 붙였다**(2026-09-08). 눌린 칩은 면이 구단 색이 되므로
  //   개수(<s>)가 --tx-3 를 들고 들어가면 안 되는데, 강제 색 모드에는 그 면이 아예 없다.
  {
    sel: '.chip.fav[aria-pressed="true"] s',
    why: "부모 .chip[aria-pressed=true] 의 font-weight 가 남는다 · color:inherit 라 부모와 같은 시스템 색이 된다",
    cites: [{ sel: '.chip[aria-pressed="true"]', decl: "font-weight:var(--w-bold)" }],
  },
  // ⚠`.dia .db.on` 은 **여기 없다** — `stroke-width` 1.2→2 로 살아남아 이 목록의 대상이 아니다.
  //   한때 적어 뒀다가 「사유만 남고 대상이 없는 항목」 시험이 잡아냈다.
  {
    sel: ".dia .do.on",
    why: "바탕 .dia .do 가 fill:none 이고 none 은 색이 아니라 강제 대상이 아니다 — 채움 유무가 남는다",
    cites: [{ sel: ".dia .do", decl: "fill:none" }],
  },
  {
    sel: ".gcard.off .gvenue,.gcard.off .gt,.gcard.off .gr",
    why: ".gcard.off 의 border-style:dashed 가 남는다",
    cites: [{ sel: ".gcard.off", decl: "border-style:dashed" }],
  },
  {
    sel: 'th[aria-sort="ascending"] .sortable i,th[aria-sort="descending"] .sortable i',
    why: "::before 의 content 가 ↕→↑↓ 로 바뀐다",
    cites: [
      { sel: 'th[aria-sort="ascending"] .sortable i::before', decl: 'content:"↑"' },
      { sel: 'th[aria-sort="descending"] .sortable i::before', decl: 'content:"↓"' },
    ],
  },
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

/**
 * `@media` 블록을 통째로 걷어낸 CSS.
 *
 * ⚠**조건부로 적용되는 규칙을 「남는다」의 근거로 쓸 수 없다.** `.mfind input` 처럼 같은 선택자가
 * 미디어 쿼리 안에 다시 나오는 자리가 실재하고, 그쪽 본문을 인용하면 **화면 폭에 따라 참이 되는 사유**가 된다.
 */
function unconditionalCss(): string {
  let out = "";
  let i = 0;
  for (;;) {
    const at = css.slice(i).search(/@media[^{]*\{/);
    if (at === -1) return out + css.slice(i);
    const start = i + at;
    out += css.slice(i, start);
    let depth = 0;
    let j = css.indexOf("{", start);
    for (; j < css.length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    assert.ok(j < css.length && depth === 0, "@media 블록의 끝을 못 찾았다 — 이 시험이 공회전한다");
    i = j + 1;
  }
}

/** 선택자 → 그 선택자의 규칙 본문들(무조건 적용되는 것만) */
function rulesBySelector(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of unconditionalCss().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.trim().replace(/\s+/g, " ");
    const list = out.get(sel);
    if (list === undefined) out.set(sel, [m[2]!]);
    else list.push(m[2]!);
  }
  return out;
}

const squash = (s: string): string => s.replace(/\s+/g, "");

/** 인용은 언제나 `prop:value` 한 쌍이다 */
function splitDecl(decl: string): { prop: string; value: string } {
  const i = decl.indexOf(":");
  assert.notEqual(i, -1, `인용이 prop:value 모양이 아니다: ${decl}`);
  return { prop: decl.slice(0, i).trim(), value: decl.slice(i + 1).trim() };
}

/**
 * ⚠**이 롱핸드를 되감는 숏핸드** — 뒤에 오면 앞의 롱핸드가 **무효**가 된다.
 * 인용에 실제로 쓰이는 속성만 적는다. **여기 없는 속성은 숏핸드 검사를 하지 않는다** —
 * 「안 쟀다」가 아니라 **그 속성에는 되감는 숏핸드가 없다**(content·display·transform·fill).
 */
const RESET_BY: Readonly<Record<string, readonly string[]>> = {
  "font-weight": ["font"],
  "border-style": ["border"],
  "border-width": ["border"],
  "border-color": ["border"],
  "background-color": ["background"],
};

/**
 * 그 선택자의 규칙들에서 `prop` 이 **최종적으로 갖는 값**.
 *
 * ⚠**마지막이 이긴다**(2026-09-08 3차 검토 · P2). 옛 판은 규칙 본문에 그 문자열이
 * **있는지만** 봤다 — 같은 규칙 안에 같은 속성의 후속 선언이 있어 앞의 것이 무효가 돼도
 * 「인용이 실재한다」로 통과했다. **캐스케이드에서 이기는 것은 마지막 선언이다.**
 *
 * @returns `undefined` = 선언이 아예 없다 · `null` = 뒤의 숏핸드가 되감았다 · 그 밖 = 이긴 값
 */
function winningValue(bodies: readonly string[], prop: string): string | null | undefined {
  let out: string | null | undefined;
  const shorthands = RESET_BY[prop] ?? [];
  for (const body of bodies) {
    for (const m of body.matchAll(/(?:^|;)\s*([a-zA-Z-]+)\s*:\s*([^;]*)/g)) {
      const p = m[1]!.trim();
      if (p === prop) out = m[2]!.trim();
      else if (shorthands.includes(p)) out = null;
    }
  }
  return out;
}

test("⚠사유가 인용한 CSS 선언이 **지금도 이긴다** — 덮어써진 선언을 근거로 인정하지 않는다", () => {
  const rules = rulesBySelector();
  const bad: string[] = [];
  let n = 0;
  for (const j of JUSTIFIED) {
    for (const c of j.cites ?? []) {
      n += 1;
      const bodies = rules.get(c.sel);
      if (bodies === undefined) {
        bad.push(`${j.sel} → 인용한 규칙 ${c.sel} 가 CSS 에 없다`);
        continue;
      }
      const { prop, value } = splitDecl(c.decl);
      const won = winningValue(bodies, prop);
      if (won === undefined) {
        bad.push(`${j.sel} → ${c.sel} 에 ${prop} 선언이 없다: ${bodies.join(" | ").slice(0, 160)}`);
      } else if (won === null) {
        bad.push(
          `${j.sel} → ${c.sel} 의 ${prop} 를 **뒤에 오는 숏핸드가 되감는다** — 인용이 이미 거짓이다`,
        );
      } else if (squash(won) !== squash(value)) {
        bad.push(
          `${j.sel} → ${c.sel} 의 ${prop} 는 지금 「${won}」 이다(인용은 「${value}」) —` +
            " **뒤 선언이 이긴다.** 인용을 고치든 CSS 를 고치든 하나는 해야 한다",
        );
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    "사유가 인용한 선언이 CSS 에서 이기지 않는다 — 그 사유는 이미 거짓이다.\n" +
      "  ⚠고친 쪽이 맞으면 **사유를 고쳐라.** 인용만 지우고 산문을 남기면 처음 상태로 돌아간다.",
  );
  assert.ok(n >= 12, `CSS 인용이 ${n}건뿐이다 — 자료구조가 비면 이 시험이 공회전한다`);
  console.log(`  · CSS 인용 ${n}건이 전부 실재하고 전부 캐스케이드에서 이긴다`);
});

test("⚠인용한 속성이 이 모드에서 실제로 살아남는다 — 죽는 것을 근거로 적지 않는다", () => {
  const bad: string[] = [];
  for (const j of JUSTIFIED) {
    for (const c of j.cites ?? []) {
      const prop = c.decl.slice(0, c.decl.indexOf(":")).trim();
      const value = c.decl.slice(c.decl.indexOf(":") + 1).trim();
      if (LIVES.test(prop)) continue;
      // ⚠**`fill:none` 처럼 「값이 색이 아닌」 경우만 예외다** — OS 가 갈아치우는 것은 색이고,
      //   `none` 은 색이 아니라서 채움 유무 자체가 남는다. **그 밖의 예외를 여기에 더하지 마라.**
      if (DIES.test(prop) && value === "none") continue;
      bad.push(`${j.sel} → ${c.sel}{${c.decl}} — ${prop} 은 이 모드에서 남지 않는다`);
    }
  }
  assert.deepEqual(bad, [], "죽는 속성을 「남는다」의 근거로 적었다");
});

test("⚠사유가 인용한 글자가 그 소스 파일에 실재한다 — ⚠주석의 같은 글자로 통과하지 않는다", () => {
  const cache = new Map<string, { code: string; comments: string }>();
  const read = (file: string): { code: string; comments: string } => {
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    const split = stripJsComments(readFileSync(join(import.meta.dirname, "..", "src", file), "utf8"));
    cache.set(file, split);
    return split;
  };
  const bad: string[] = [];
  let n = 0;
  let alsoInComment = 0;
  for (const j of JUSTIFIED) {
    for (const s of j.says ?? []) {
      n += 1;
      const src = read(s.file);
      if (src.comments.includes(s.text)) alsoInComment += 1;
      if (!src.code.includes(s.text)) {
        bad.push(
          `${j.sel} → ${s.file} 의 **코드**에 「${s.text}」 가 없다` +
            (src.comments.includes(s.text) ? "(주석에는 있다 — 화면에서 사라진 문구다)" : ""),
        );
      }
    }
  }
  assert.deepEqual(bad, [], "사유가 인용한 화면 글자가 소스에 없다 — 문구가 바뀌었거나 사유가 거짓이다");
  assert.ok(n >= 6, `글자 인용이 ${n}건뿐이다 — 자료구조가 비면 이 시험이 공회전한다`);
  // ⚠**공회전 방지** — 주석까지 보면 통과하는 인용이 실제로 있어야 이 구분이 값을 한다
  assert.ok(alsoInComment >= 1, "주석에도 같은 글자가 있는 인용이 하나도 없다 — 이 시험의 전제가 바뀌었으니 다시 판단하라");
  console.log(`  · 글자 인용 ${n}건이 전부 코드에 실재한다(그중 ${alsoInComment}건은 주석에도 같은 글자가 있다)`);
});

/**
 * **`tr.thin` 의 사유는 「몇 곳 중 몇 곳」이라 숫자가 곧 사유다.** 그래서 그 수를 여기서 다시 센다.
 *
 * ⚠**옛 사유는 「.qmk 가 남는다」였고 전칭으로 부풀어 있었다**(2026-09-08).
 * 감사자가 준 근거(「스플릿 표에 .qmk 0건」)는 맞지만 그건 **선수 페이지의 분모**였고,
 * 저장소 전체로 세면 **6곳 중 3곳**이 그 표식을 붙인다. 숫자를 안 세면 이 사유가 또 낡는다.
 * ⚠**틀리면 목록의 사유를 고쳐라 — 숫자만 고치지 마라.**
 */
const THIN_ROW_SITES = 6;
const THIN_MARK_SITES = 3;

test("⚠tr.thin 을 그리는 자리와 .qmk 를 붙이는 자리의 수가 사유에 적힌 그대로다", () => {
  const files = ["pages.ts", "player-page.ts", "team-page.ts", "parts.ts"];
  let rows = 0;
  let marks = 0;
  const where: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(import.meta.dirname, "..", "src", f), "utf8");
    const r = [...src.matchAll(/<tr class="\$\{[^}]*"thin"[^}]*\}/g)].length;
    // ⚠**정의(`export function thinMark`)가 아니라 **호출**만 센다 — `${thinMark(` 로 좁힌다
    const m = [...src.matchAll(/\$\{thinMark\(/g)].length;
    rows += r;
    marks += m;
    if (r > 0 || m > 0) where.push(`${f} tr.thin ${r} · thinMark ${m}`);
  }
  assert.equal(rows, THIN_ROW_SITES, `tr.thin 을 그리는 자리가 ${rows}곳이다 — 사유의 분모가 바뀌었다: ${where.join(" / ")}`);
  assert.equal(marks, THIN_MARK_SITES, `thinMark 호출이 ${marks}곳이다 — 사유의 분자가 바뀌었다: ${where.join(" / ")}`);
  console.log(`  · tr.thin ${rows}곳 중 .qmk ${marks}곳 (${where.join(" / ")})`);
});

test("⚠산문만 남은 사유가 없다 — 넷 중 하나는 반드시 있어야 한다", () => {
  const naked = JUSTIFIED.filter(
    (j) => j.covered !== true && j.cites === undefined && j.says === undefined && j.noCite === undefined,
  ).map((j) => `${j.sel} — ${j.why}`);
  assert.deepEqual(
    naked,
    [],
    "사유가 검산되지 않는 문자열뿐이다.\n" +
      "  ⚠covered / cites / says 중 하나로 적어라. 정말 인용할 것이 없으면 noCite 에\n" +
      "  **무엇이 사라지고 왜 그래도 되는지** 적어라 — 「아마 괜찮다」는 사유가 아니다.",
  );
  const byKind = {
    covered: JUSTIFIED.filter((j) => j.covered === true).length,
    cites: JUSTIFIED.filter((j) => j.cites !== undefined).length,
    says: JUSTIFIED.filter((j) => j.says !== undefined).length,
    noCite: JUSTIFIED.filter((j) => j.noCite !== undefined).length,
  };
  console.log(
    `  · 정당화 ${JUSTIFIED.length}건 — covered ${byKind.covered} · CSS 인용 ${byKind.cites} ·` +
      ` 글자 인용 ${byKind.says} · 인용 없음 ${byKind.noCite}`,
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
