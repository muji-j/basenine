/**
 * **CSS 토큰의 대비를 시험이 지킨다.**
 *
 * ⚠**대비는 실측 1회로 지켜지지 않는다**(2026-08-18 감사 P2·P3). 실제로 두 곳이 새어 있었다:
 *  · `.state.stale` 이 `--warn` 채움 위에 **흰 글자를 하드코딩**해 다크에서 **2.61:1**
 *    (`--warn` 은 라이트에서 어두운 벽돌색이지만 다크에서는 밝은 살구색이다),
 *  · `.daystep.off` 가 `opacity:.5` 를 얹어 라이트 **1.99:1** · 다크 **2.31:1**.
 * 둘 다 화면은 멀쩡해 보이고 빌드·시험·배포가 전부 통과했다.
 *
 * ⚠**색을 눈대중하지 마라.** 이 파일은 CSS 원문에서 토큰을 읽어 계산한다 —
 * 토큰 값을 바꾸면 **여기서 먼저 깨진다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEUTRAL_COLOR, TEAMS, colorOf } from "@bb-app/domain";
// ⚠**강조행을 실제로 그려서 재는 시험이 있다** — 정적 CSS 검사만으로는
//   「자손이 tr.me 를 이름으로 안 적는다」는 모양을 원리적으로 못 잡는다
import { drawRate, extraDecidedRate } from "@bb-app/aggregate";
import { CLIENT_JS, CSS } from "../src/assets.ts";
import { renderRankingPage } from "../src/pages.ts";
import type { DrawSeasonRow } from "../src/pages.ts";
import { TIE_RULE } from "../src/parts.ts";
import { context } from "./fixtures.ts";

/** WCAG 상대 휘도 */
function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * CSS 원문에서 토큰 값을 읽는다.
 *
 * ⚠**라이트와 다크가 따로다.** 다크는 `prefers-color-scheme` 블록과
 * `[data-theme="dark"]` 블록 **양쪽**에 있다 — 어느 쪽을 읽어도 같은 값이어야 한다.
 * ⚠**못 찾으면 던진다.** 못 찾은 것을 「통과」로 흘리면 이 시험이 조용히 죽는다.
 */
function tokens(scope: "light" | "dark"): Map<string, string> {
  const out = new Map<string, string>();
  // 다크 값은 뒤에 나오므로, 라이트는 **첫 번째** 정의를 취한다
  for (const m of CSS.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const name = m[1]!;
    const value = m[2]!.toLowerCase();
    if (scope === "light") {
      if (!out.has(name)) out.set(name, value);
    } else {
      out.set(name, value); // 마지막 정의 = 다크
    }
  }
  return out;
}

const NEED = 4.5;

for (const scope of ["light", "dark"] as const) {
  test(`⚠${scope}: --warn 채움 위의 글자가 AA 를 넘는다 — 흰 글자 하드코딩이 여기서 걸린다`, () => {
    const t = tokens(scope);
    const warn = t.get("warn");
    const page = t.get("page");
    assert.ok(warn !== undefined && page !== undefined, "토큰을 못 읽었다 — 이 시험이 공회전한다");
    const r = contrast(warn!, page!);
    assert.ok(r >= NEED, `--warn ${warn} 위 --page ${page} = ${r.toFixed(2)}:1 (${NEED} 필요)`);
    // ⚠**흰 글자가 답이 아니라는 것도 못 박는다** — 그게 실제로 났던 결함이다
    if (scope === "dark") {
      assert.ok(
        contrast(warn!, "#ffffff") < NEED,
        "다크 --warn 위 흰 글자가 통과한다 — 이 시험의 전제가 바뀌었으니 다시 판단하라",
      );
    }
  });

  test(`⚠${scope}: 옅은 글자(--tx-3)가 AA 를 넘는다 — 여기에 opacity 를 더 얹지 마라`, () => {
    const t = tokens(scope);
    const tx3 = t.get("tx-3");
    const page = t.get("page");
    assert.ok(tx3 !== undefined && page !== undefined, "토큰을 못 읽었다");
    const r = contrast(tx3!, page!);
    assert.ok(r >= NEED, `--tx-3 ${tx3} 위 --page ${page} = ${r.toFixed(2)}:1 (${NEED} 필요)`);
  });
}

/**
 * ⚠**`opacity` 로 글자를 흐리면 위의 계산이 전부 거짓이 된다.**
 * 토큰은 통과하는데 화면은 절반 대비가 된다 — 실제로 `.daystep.off` 가 그랬다(1.99:1).
 * 그래서 **글자에 opacity 를 얹는 규칙 자체를 세어 둔다.**
 * ⚠장식(구분선·그림)에는 써도 된다 — 여기서 막는 것은 **글자색과 함께 쓰는 것**이다.
 */
/**
 * ⚠**구단 색을 글자색으로 쓰지 마라.**
 *
 * 배경으로 쓸 때는 `--team-ink` 가 짝이 되어 대비가 보장되는데, **글자색에는 짝이 없다.**
 * 실측(2026-08-19 · 12구단 전부, `--panel` 기준):
 * ```
 * 阪神    #f2c800  라이트 1.61 : 1   다크 10.35 : 1
 * ソフトバンク #f5c400  라이트 1.64 : 1   다크 10.15 : 1
 * ロッテ   #22262b  라이트 15.22 : 1  다크  1.10 : 1
 * オリックス #1d1f4e  라이트 15.46 : 1  다크  1.08 : 1
 * ```
 * **어느 구단 색이든 한쪽 테마에서 반드시 무너진다** — 라이트에서 통과하는 색은 다크에서 떨어진다.
 * 그래서 「이 구단은 괜찮다」가 성립하지 않고, 규칙 자체를 막는다.
 * ⚠**장식(배경·테두리·그림)에는 써도 된다** — 여기서 막는 것은 `color:` 뿐이다.
 * ⚠**이 시험은 실제 결함에서 나왔다**: 구단 페이지의 「いまの状況」 순위 숫자(22px)를
 * 구단 색으로 칠했다가 실측에서 阪神 1.61:1 이 나왔다(2026-08-19).
 */
test("⚠구단 색(--team)을 글자색으로 쓰지 않는다 — 어느 테마에서든 한쪽이 무너진다", () => {
  /**
   * ⚠**알려진 예외 2건 — 둘 다 이 규칙이 생기기 전부터 있던 것이라 기록만 남긴다**(2026-08-19 발견).
   * 둘 다 「이 구단의 것」이라는 표시를 글자색으로 하고 있고, 그래서 阪神·ソフトバンク의 라이트와
   * ロッテ·オリックス의 다크에서 대비가 무너진다.
   * · `.roster li[data-favon="true"] .hn::before` — 즐겨찾기 `★`(10px)
   * · `.favbtn[aria-pressed="true"]` — 즐겨찾기 버튼의 눌림 상태(테두리도 같이 바뀐다)
   * ⚠**`.trecent li.w b` 는 2026-08-20 에 여기서 빠졌다** — 예외가 아니라 **고쳤다.**
   * 直近の試合의 `○` 는 이제 `--up`(라이트 4.95~5.59 · 다크 5.87~7.00)이다.
   * 아래 「구단 색에 기대지 않는다」 시험이 그 자리를 12구단 × 2테마로 계속 잰다.
   * ⚠**여기 더 넣지 마라.** 새 자리가 생기면 그건 고칠 것이지 예외로 둘 것이 아니다.
   */
  const KNOWN = new Set(['.roster li[data-favon="true"] .hn::before', '.favbtn[aria-pressed="true"]']);
  // ⚠**주석을 먼저 지운다** — 안 지우면 규칙 바로 앞의 주석까지 선택자로 잡혀
  // 예외 목록이 맞아떨어지지 않는다(첫 판이 그렇게 헛돌았다)
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? "").trim();
    // ⚠`--team-ink` 는 짝이 되는 글자색이므로 걸리면 안 된다 — `--team` 바로 뒤가 `,` 나 `)` 인 것만 본다
    if (!/(^|;)\s*color:\s*var\(--team[,)]/.test(m[2] ?? "")) continue;
    if (KNOWN.has(sel)) continue;
    bad.push(sel);
  }
  assert.deepEqual(bad, [], `구단 색을 글자색으로 썼다: ${bad.join(" / ")}`);
  /**
   * ⚠**예외 목록이 낡으면 이 시험이 조용히 헐거워진다.**
   * 예전에는 「선택자가 CSS 에 있는가」만 봤는데, 그러면 **고친 뒤에도 예외가 남는다** —
   * 실제로 `.trecent li.w b` 가 그럴 뻔했다(선택자는 남고 색만 바뀐다).
   * → **그 규칙이 지금도 구단 색을 글자색으로 쓰고 있는가**를 본다. 안 쓰면 목록에서 빼라는 뜻이다.
   */
  for (const k of KNOWN) {
    const rule = new RegExp(`${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`).exec(css);
    assert.ok(rule !== null, `예외로 적어 둔 ${k} 가 CSS 에 없다 — 목록에서 빼라`);
    assert.ok(
      /(^|;)\s*color:\s*var\(--team[,)]/.test(rule![1]!),
      `${k} 는 이제 구단 색을 글자색으로 쓰지 않는다 — 고쳐진 것이니 예외 목록에서 빼라`,
    );
  }
});

/**
 * ⚠**구단 색에 「보이는지」를 걸지 마라.**
 *
 * 이 시험은 **CSS 가 지금 선언한 값을 그대로 읽어** 12구단 × 2테마 = 24조합을 잰다.
 * 구단 색으로 되돌리면 24 중 12 가 떨어진다(어느 색이든 한쪽 테마에서 무너지므로).
 * 토큰(`--up`·`--tx`)이면 구단과 무관하게 24조합이 다 통과한다 — 그게 이 수정의 요지다.
 *
 * ⚠**두 자리 다 실제 결함이었다**(2026-08-19 감사 P1 · 2026-08-20 수정):
 * · `.trecent li.w b`(13px 글자 · 4.5:1 필요) — 이긴 경기 `○` 가 구단 색이라 **12/12 가 한쪽 테마에서 미달**.
 *   진 경기(`--tx-2` · 6.6:1)만 또렷해 팀이 실제보다 나쁘게 읽혔다.
 * · `.dia .db.on`(비텍스트 3:1 · WCAG 1.4.11) — 주자 있는 베이스가 **면과 선 둘 다** 구단 색이라
 *   대비가 낮으면 통째로 사라졌다. 「주자 있음」이 「베이스가 아예 없음」으로 보였다.
 *   경기 페이지 7,502장 = 사이트의 49%.
 *
 * ⚠**바탕은 `--panel` 이다**(실측 2026-08-20 · 브라우저에서 두 자리 모두 `.block` = `--panel` 위였다).
 * 눈대중이 아니라 `getComputedStyle` 로 확인한 값이다.
 */
const TEAM_MARKS: readonly { sel: string; prop: "color" | "stroke"; need: number; what: string }[] = [
  { sel: ".trecent li.w b", prop: "color", need: 4.5, what: "直近の試合의 이긴 경기 표식(13px)" },
  { sel: ".dia .db.on", prop: "stroke", need: 3.0, what: "주자 있는 베이스의 윤곽(비텍스트)" },
  /**
   * ⚠**成績の紋도 같은 병이었다**(2026-08-21 감사 P1 · 같은 날 수정).
   * · `.mf-shape` — 도형의 윤곽. 구단 색일 때 **24조합 중 12 미달**(라이트 4 · 다크 8)이고
   *   **미달 구단의 합집합이 12/12** 다. 살(fill-opacity .42)을 합성해도 **0/24** 만 3:1 도달이고,
   *   `.thin` 은 fill-opacity 가 0 이라 **점선 윤곽 하나가 도형의 전부**다(배포물 2,314/5,666장).
   * · `.mf-dot` — 이것은 차트가 아니라 **조작 요소**다. 감싸는 `.mf-ax` 가
   *   `role="button" tabindex="0"` 이고 이 점이 유일한 시각 어포던스인데, 채움이 `--panel`
   *   (바탕과 같은 색)이라 **선이 곧 전부**다. 다크 オリックス 1.08 · ロッテ 1.10 에서
   *   누를 수 있는 것이 화면에 없었다. WCAG 1.4.11 에는 「글자로도 제공되면 예외」가 없다.
   * ⚠**고른 축의 채움(`.mf-ax.on .mf-dot`)은 구단 색으로 남는다** — 링이 3:1 경계를 만든다.
   * 그래서 여기서 재는 것은 `stroke` 뿐이다.
   */
  { sel: ".mf-shape", prop: "stroke", need: 3.0, what: "成績の紋 도형의 윤곽(비텍스트)" },
  { sel: ".mf-dot", prop: "stroke", need: 3.0, what: "成績の紋 꼭짓점의 링 — 조작 요소의 유일한 어포던스" },
];

for (const scope of ["light", "dark"] as const) {
  for (const mark of TEAM_MARKS) {
    test(`⚠${scope}: ${mark.sel} 는 구단 색에 기대지 않는다 — ${mark.what}`, () => {
      const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
      /**
       * ⚠**규칙의 시작에 붙인다.** 안 붙이면 `.mf-dot` 이 `.mf-ax.on .mf-dot{…}` 에도 걸려,
       * 어느 규칙을 쟀는지가 **CSS 안의 순서에 달리게 된다.**
       */
      const rule = new RegExp(
        `(?:^|[\\n}])\\s*${mark.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`,
      ).exec(css);
      assert.ok(rule !== null, `${mark.sel} 규칙이 CSS 에 없다 — 이 시험이 공회전한다`);
      const decl = new RegExp(`(?:^|;)\\s*${mark.prop}:\\s*([^;]+)`).exec(rule![1]!);
      assert.ok(decl !== null, `${mark.sel} 에 ${mark.prop} 선언이 없다 — 이 시험이 공회전한다`);
      const raw = decl![1]!.trim();
      const t = tokens(scope);
      const bg = t.get("panel");
      assert.ok(bg !== undefined, "--panel 을 못 읽었다");

      /**
       * 선언값을 색으로 푼다.
       * ⚠**모르는 형태는 통과시키지 않고 던진다** — 못 푼 것을 「괜찮다」로 흘리면 시험이 죽는다.
       */
      const resolve = (teamHex: string): string => {
        const v = /^var\(\s*--([a-z0-9-]+)/.exec(raw);
        if (v === null) {
          assert.ok(/^#[0-9a-fA-F]{6}$/.test(raw), `${mark.sel} 의 ${mark.prop} 값을 못 읽었다: ${raw}`);
          return raw.toLowerCase();
        }
        const name = v[1]!;
        // 구단 색이면 그 구단의 실제 색으로 푼다 — 24조합이 여기서 갈린다
        if (name === "team" || name === "chip") return teamHex;
        const tok = t.get(name);
        assert.ok(tok !== undefined, `${mark.sel} 이 모르는 토큰 --${name} 을 쓴다`);
        return tok!;
      };

      const failed: string[] = [];
      for (const team of TEAMS) {
        const hex = colorOf(team.code).base.toLowerCase();
        const r = contrast(resolve(hex), bg!);
        if (r < mark.need) failed.push(`${team.code} ${r.toFixed(2)}`);
      }
      assert.deepEqual(
        failed,
        [],
        `${mark.sel} 의 ${mark.prop}(${raw})가 ${mark.need}:1 에 미달하는 구단: ${failed.join(" / ")}`,
      );
    });
  }
}

/**
 * ⚠**`stroke` 는 얇아서 `color` 보다 더 위험한데, 위의 금지 규칙이 `color` 만 본다.**
 *
 * 그래서 **구단 색을 선 색으로 쓰는 자리를 통째로 세어 못 박는다.** 새 자리가 생기면 여기서 걸린다.
 * ⚠**남아 있던 둘(`.mf-shape`·`.mf-dot`)은 2026-08-21 에 고쳤다** — 예외로 둔 것이 아니다.
 * 둘 다 `--tx-2` 로 바뀌었고, 위의 `TEAM_MARKS` 가 그 자리를 12구단 × 2테마로 계속 잰다.
 * 이제 **기대값은 빈 목록**이다.
 * ⚠**여기 늘리지 마라.** 늘어나면 그건 같은 결함이 한 자리 더 생겼다는 뜻이다.
 * ⚠**이 시험은 CSS 문자열만 본다** — 클라이언트 스크립트가 `setAttribute("stroke", …)` 로
 * 얹는 자리는 **원리적으로 못 본다.** 실제로 비교 화면의 겹친 紋이 그랬다(2026-08-21 감사 P2).
 * 아래 시험이 그 구멍을 따로 막는다.
 */
/**
 * **배경색 하나로 말하는 자리** — 2026-08-22 감사 #18·#21 이 잡은 둘.
 *
 * ⚠**둘 다 「색이 틀렸다」가 아니라 「색밖에 없다」였다.**
 * · `.qhits li.on a`(검색 드롭다운에서 화살표가 고른 자리) — panel 대 panel-2 가
 *   라이트 **1.129** · 다크 **1.100**. 3:1 의 절반도 안 되고, **hover 와 똑같이 생겼다.**
 * · `.tbar i`(월별 勝-敗 막대) — 구단 색 대 바탕이 **합집합 12/12 미달**,
 *   敗 막대(--hair-2)는 **전 구단·양 테마 미달**(라이트 1.580 · 다크 1.557).
 *
 * ⚠**막대 쪽은 WCAG 미달이 아니다** — 勝은 늘 위·敗는 늘 아래이고 옆의 `s` 가
 * 「○勝○敗○分 · ○試合」을 분모까지 적는다. 그래서 이건 **가독성**이지 적합성이 아니다.
 * 그래도 안 보이는 그림은 그림이 아니라 얼룩이라 고쳤다.
 *
 * 여기서 재는 것은 **테두리가 있는가**와 **그 색이 어느 테마에서든 3:1 을 넘는가** 둘이다.
 * ⚠`box-shadow` 라서 위의 `TEAM_MARKS` 하네스(color/stroke 전용)가 못 본다 — 그래서 따로 있다.
 */
const EDGE_MARKS: readonly { sel: string; bg: string; what: string }[] = [
  { sel: ".qhits li.on a", bg: "panel-2", what: "화살표가 고른 자리의 표식" },
  { sel: ".tbar i", bg: "panel", what: "월별 승패 막대의 테두리" },
];

for (const scope of ["light", "dark"] as const) {
  for (const mark of EDGE_MARKS) {
    test(`⚠${scope}: ${mark.sel} 는 배경색 하나로 말하지 않는다 — ${mark.what}`, () => {
      const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
      const rule = new RegExp(
        `(?:^|[\\n}])\\s*${mark.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`,
      ).exec(css);
      assert.ok(rule !== null, `${mark.sel} 규칙이 CSS 에 없다 — 이 시험이 공회전한다`);
      const decl = /(?:^|;)\s*box-shadow:\s*([^;]+)/.exec(rule![1]!);
      assert.ok(
        decl !== null,
        `${mark.sel} 에 box-shadow 가 없다 — 배경색 하나로 돌아갔다.\n` +
          "⚠**border 로 바꾸지 마라** — 높이가 늘어 막대가 값을 거짓말하고 목록이 흔들린다",
      );
      const v = /var\(\s*--([a-z0-9-]+)/.exec(decl![1]!);
      assert.ok(v !== null, `${mark.sel} 의 box-shadow 색이 토큰이 아니다: ${decl![1]!}`);
      const t = tokens(scope);
      const ink = t.get(v![1]!);
      const bg = t.get(mark.bg);
      assert.ok(ink !== undefined, `--${v![1]!} 을 못 읽었다`);
      assert.ok(bg !== undefined, `--${mark.bg} 을 못 읽었다`);
      const cr = contrast(ink!, bg!);
      assert.ok(
        cr >= 3,
        `${mark.sel} 의 테두리가 --${mark.bg} 위에서 ${cr.toFixed(3)}:1 이다 — 비텍스트 3:1 미달`,
      );
    });
  }
}

test("⚠구단 색을 선 색(stroke)으로 쓰는 자리가 늘지 않는다", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*stroke:\s*var\(--(team|chip)[,)]/.test(m[2] ?? "")) continue;
    found.push((m[1] ?? "").trim());
  }
  assert.deepEqual(found.sort(), [], `구단 색을 선 색으로 쓰는 자리가 바뀌었다: ${found.join(" / ")}`);
});

/**
 * ⚠**클라이언트가 얹는 선 색은 CSS 검사가 못 본다.**
 *
 * 비교 화면의 겹친 紋은 브라우저가 조립하므로 색이 `setAttribute` 로 붙는다.
 * 그래서 위의 CSS 검사가 **영원히 통과하는 채로** 라이트·다크 양쪽에서
 * `cf-a=#1d1f4e` · `cf-b=#22262b`(테마 무관)가 나가고 있었다 —
 * 다크 `--panel` 기준 **1.08 / 1.10**, 두 도형끼리 **1.02**.
 * `.cf-b` 는 `fill-opacity:0` 이라 **점선 하나가 그 선수의 전부**였다.
 * → **선 색을 스크립트에서 얹지 않는다**를 글자로 못 박는다. 채움(fill)은 허용한다.
 */
test("⚠클라이언트 스크립트가 폴리곤의 선 색을 얹지 않는다 — 얹으면 대비 검사가 못 본다", () => {
  const js = CLIENT_JS.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [...js.matchAll(/setAttribute\(\s*"stroke"/g)].map((m) => m[0]);
  assert.deepEqual(bad, [], `선 색을 스크립트가 얹는다(${bad.length}건) — CSS 토큰으로 옮겨라`);
  // ⚠**공회전 방지**: 채움은 실제로 얹고 있다. 이 자리가 통째로 사라지면 위 단언이 무의미해진다.
  assert.ok(/setAttribute\(\s*"fill"/.test(js), 'setAttribute("fill") 이 없다 — 이 시험이 공회전한다');
});

test("⚠글자색과 opacity 를 같은 규칙에 함께 쓰지 않는다", () => {
  const bad: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2] ?? "";
    if (!/(^|;)\s*color:/.test(body)) continue;
    if (!/(^|;)\s*opacity:\s*0?\.\d/.test(body)) continue;
    bad.push((m[1] ?? "").trim().slice(0, 60));
  }
  assert.deepEqual(bad, [], `글자색에 opacity 를 얹었다 — 대비가 계산과 달라진다: ${bad.join(" / ")}`);
});
/**
 * ⚠**위 시험은 공회전하고 있었다**(2026-08-21 다방면 감사 확정).
 *
 * 그 시험은 **한 규칙 안에** color 와 opacity 가 같이 있을 때만 잡는다.
 * 그런데 실제 결함은 **부모에 opacity, 자식에 color** 모양으로 왔다 —
 * `.gcard.off{opacity:.62}` 에는 color 가 없고, 글자를 가진 `.gvenue`·`.gt`·`.gnone` 은
 * `.gcard` 를 이름으로 안 적는다. 그래서 시험은 **오늘 잡을 수 있는 규칙이 0건인 채로 초록**이었다.
 *
 * DOM 이 없으면 「누가 누구의 자식인가」를 정적으로 알 수 없다.
 * 그래서 **잡는 방법을 바꾸는 대신 「정당화를 강제」한다**:
 * 1 미만의 opacity 를 쓰는 규칙은 **전부 아래 목록에 있어야 하고**, 목록은 그 이유를 적는다.
 *
 * ⚠⚠**그런데 그 「이유」가 문자열이었고, 넷이 거짓이었다**(2026-09-08 · design-auditor P0).
 * 아무도 검산하지 않는 자리라 **틀린 수가 그대로 근거로 통했다**:
 *
 * | 항목 | 적혀 있던 수 | 무엇을 잘못 잡았나 | 다시 잰 값 |
 * |---|---|---|---|
 * | `.spl tr.thin td` | 5.56 / 6.45 | 잉크 `--tx`·바탕 `--panel` (실제는 `--tx-2` / `--page`) | **2.917 / 3.758** |
 * | `.chip.fav s` | 9.55 / 9.14 | 잉크 `--tx` (실제는 `.chip` 이 물려주는 `--tx-2`) | **3.999 / 5.076** |
 * | `.pk[data-slot]::after` | 11.35 / 10.14 | 바탕 `--panel` (실제는 눌린 버튼의 `--chip`) | **4.246**(広島) |
 * | `.go:hover` | 「기준 아래로 안 내려간다」 | 수를 아예 안 적었다 · 그룹 opacity 라 면도 같이 흐려진다 | **3.436** |
 *
 * ⚠**첫 줄이 가장 무겁다.** 두 오차가 **같은 방향으로 겹쳐** 2.9 를 5.6 으로 보이게 했고,
 * 그 행은 **「표본이 얇으니 값을 믿지 마라」를 말하는 자리**다 — M2 가 요구하는 그 분모가
 * 화면에서 가장 안 읽혔다.
 *
 * → **이 목록은 이제 문자열이 아니라 계산이다.** 각 항목은 「무엇이 잉크이고 무엇이 바탕인가」만
 * 선언하고, **alpha 는 CSS 에서 읽는다** — 여기 적으면 CSS 만 고쳤을 때 조용히 낡는다.
 * 시험이 두 테마에서 `contrast(mix(ink, bg, alpha), bg) >= 4.5` 를 **다시 센다.**
 * ⚠**「글자가 없다」와 「비활성이라 면제」도 종류로 적는다** — 「미검증」이라고 적어 두는 것으로는
 * 아무도 안 잰다(`.sortable i` 가 그 교훈이다).
 * ⚠**넷 중 넷을 고쳤다** — 넷 다 opacity 를 뺐고(또는 색으로 바꿨고) 그래서 이 목록에서 사라졌다.
 * 남은 것은 **글자가 없는 것 다섯 · 비활성 둘 · 색이 뒤집힌 툴팁 하나**다.
 */

/** 두 색을 alpha 로 합성한다 — `opacity` 가 만드는 화면상의 색이 이것이다 */
function mix(ink: string, bg: string, alpha: number): string {
  const at = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16);
  const ch = [1, 3, 5].map((i) => Math.round(at(ink, i) * alpha + at(bg, i) * (1 - alpha)));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 주석을 뗀 CSS — 주석 안의 예시가 규칙으로 잡히면 시험이 헛돈다 */
const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** `opacity: .NN` 을 쓰는 규칙 전부(선택자는 공백 정규화) */
function opacityRules(): { sel: string; alpha: number }[] {
  const out: { sel: string; alpha: number }[] = [];
  for (const m of CSS_NC.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const a = /(^|;)\s*opacity:\s*(0?\.\d+)/.exec(m[2] ?? "");
    if (a === null) continue;
    out.push({ sel: (m[1] ?? "").trim().replace(/\s+/g, " "), alpha: Number(a[2]) });
  }
  return out;
}

/**
 * 이 항목의 alpha 를 **CSS 에서** 읽는다.
 * ⚠**목록에 적지 않는 것이 요점이다** — 적으면 CSS 만 고쳤을 때 시험이 옛 값을 잰다.
 */
function alphaOf(sel: string): number {
  const hit = opacityRules().filter((r) => r.sel === sel || r.sel.endsWith(` ${sel}`));
  assert.equal(hit.length, 1, `${sel} 의 opacity 규칙이 ${hit.length}건이다 — 이 시험이 공회전한다`);
  return hit[0]!.alpha;
}

type OpacityEntry =
  /** 글자가 있다 — `ink` 를 `bg` 위에 CSS 의 alpha 로 합성해 **두 테마에서** 4.5 를 잰다 */
  | { sel: string; kind: "ink"; ink: string; bg: string; why: string }
  /** 그 서브트리에 글자가 없다(도형·덮개). ⚠「안 쟀다」가 아니라 **「잴 것이 없다」**다 */
  | { sel: string; kind: "shape"; why: string }
  /** 무효 컨트롤 — WCAG 1.4.3 이 명시적으로 면제한다 */
  | { sel: string; kind: "disabled"; why: string };

const OPACITY_ALLOWED: readonly OpacityEntry[] = [
  { sel: ".mv:disabled", kind: "disabled", why: "무효 컨트롤 — WCAG 1.4.3 이 명시적으로 면제한다" },
  { sel: ".go:disabled", kind: "disabled", why: "같은 이유" },
  /**
   * ⚠**툴팁은 색이 뒤집힌다** — `#tip{background:var(--tx);color:var(--page)}` 이라
   * 잉크가 `--page`, 바탕이 `--tx` 다. 옛 목록은 여기서만 우연히 결론이 맞았다(9.23 / 6.48 대 계산값).
   */
  { sel: "#tip s", kind: "ink", ink: "page", bg: "tx", why: "툴팁 안의 부제 — 색이 뒤집힌 면 위의 글자" },
  { sel: ".legend .bar", kind: "shape", why: "범례 견본 — 도형이고 글자가 없다(등급 표시를 끌 때의 연출)" },
  { sel: ".hstand .rdbar::before", kind: "shape", why: "기준선 막대 · 글자 없음" },
  { sel: ".pswing i", kind: "shape", why: "막대 · 글자 없음" },
  { sel: "table.stand .dif i", kind: "shape", why: "방향 도형 · 글자 없음" },
  { sel: ".cardlink:active::after", kind: "shape", why: "누름 덮개 · 글자 없음(⚠alpha 를 여기 적지 않는다 — CSS 가 정본이다)" },
];

/**
 * ⚠**계산기가 맞는지 먼저 잰다.** 아래 시험 전부가 이 두 함수 위에 얹혀 있고,
 * `mix` 가 조용히 틀리면 **전부 초록인 채로 아무것도 안 재게 된다.**
 * ⚠**세 번째 단언이 이 라운드의 결함 그 자체다** — 계산기가 그것을 재현하지 못하면
 * 이 시험은 옛 상태로 돌아간 것이다.
 */
test("⚠합성 계산기가 맞는다 — 이 파일의 새 시험 전부가 여기에 얹혀 있다", () => {
  const t = tokens("light");
  const tx2 = t.get("tx-2")!;
  const page = t.get("page")!;
  assert.equal(mix(tx2, page, 1), tx2, "alpha=1 이 잉크 자신이 아니다");
  assert.equal(mix(tx2, page, 0), page, "alpha=0 이 바탕 자신이 아니다");
  assert.equal(contrast(page, page).toFixed(3), "1.000", "같은 색의 대비가 1 이 아니다");
  // ⚠**이 라운드가 고친 결함을 계산기가 재현하는가** — `.spl tr.thin td{opacity:.65}` 였을 때의 값
  const was = contrast(mix(tx2, page, 0.65), page);
  assert.ok(
    was < NEED,
    `얇은 행을 .65 로 흐렸을 때가 ${was.toFixed(3)}:1 로 나온다 — 4.5 미만이어야 한다(그게 P0 였다)`,
  );
  console.log(`  · 옛 .spl tr.thin td(.65 · --tx-2 over --page) = ${was.toFixed(3)}:1 · 목록에 적혀 있던 수 5.56`);
});

test("⚠opacity 를 새로 얹으면 여기서 먼저 운다 — 「그 서브트리에 글자가 있는가」를 손으로 재게 한다", () => {
  const found = opacityRules().map((r) => r.sel);
  // ⚠**공회전 방지** — 규칙이 통째로 사라지면 이 시험은 아무것도 재지 않는다
  assert.ok(found.length >= 8, `opacity 규칙이 ${found.length}건뿐이다 — 이 시험이 공회전한다`);

  const allow = OPACITY_ALLOWED.map((x) => x.sel);
  const unknown = found.filter((sel) => !allow.some((a) => sel.endsWith(a) || sel === a));
  assert.deepEqual(
    unknown,
    [],
    "opacity 를 쓰는 새 규칙이 있다. **그 서브트리에 글자가 있는지 재고** OPACITY_ALLOWED 에\n" +
      "  종류(ink / shape / disabled)와 함께 넣어라. ⚠**`ink` 면 수를 적지 마라 — 시험이 잰다**: " +
      unknown.join(" / "),
  );

  // ⚠**반대 방향도 막는다.** 규칙이 고쳐져 opacity 가 사라졌는데 항목만 남으면
  //   다음 사람이 그 목록을 「지금도 흐리다」로 읽는다 — 이 저장소가 반복해 데인 모양이다.
  const stale = allow.filter((a) => !found.some((sel) => sel.endsWith(a) || sel === a));
  assert.deepEqual(stale, [], "이 항목들은 더는 opacity 를 안 쓴다 — 목록에서 빼라");
  console.log(
    `  · opacity 규칙 ${found.length}건 = 목록 ${OPACITY_ALLOWED.length}건` +
      `(글자 ${OPACITY_ALLOWED.filter((e) => e.kind === "ink").length} ·` +
      ` 도형 ${OPACITY_ALLOWED.filter((e) => e.kind === "shape").length} ·` +
      ` 비활성 ${OPACITY_ALLOWED.filter((e) => e.kind === "disabled").length})`,
  );
});

for (const scope of ["light", "dark"] as const) {
  test(`⚠${scope}: opacity 로 흐린 글자가 AA 를 넘는다 — 「적어 둔 수」가 아니라 **계산**으로 잰다`, () => {
    const t = tokens(scope);
    const inks = OPACITY_ALLOWED.filter((e) => e.kind === "ink");
    // ⚠**공회전 방지** — 글자 항목이 0건이면 이 시험은 아무것도 안 잰다
    assert.ok(inks.length >= 1, "글자를 가진 opacity 항목이 0건이다 — 이 시험이 공회전한다");
    const failed: string[] = [];
    let measured = 0;
    for (const e of inks) {
      if (e.kind !== "ink") continue;
      const alpha = alphaOf(e.sel);
      const ink = t.get(e.ink);
      const bg = t.get(e.bg);
      assert.ok(ink !== undefined && bg !== undefined, `${e.sel} 의 토큰(--${e.ink} / --${e.bg})을 못 읽었다`);
      const r = contrast(mix(ink!, bg!, alpha), bg!);
      measured += 1;
      if (r < NEED) failed.push(`${e.sel} (--${e.ink} @ ${alpha} over --${e.bg}) ${r.toFixed(3)}`);
      console.log(`  · ${scope} ${e.sel} α=${alpha} --${e.ink} over --${e.bg} = ${r.toFixed(3)}:1`);
    }
    assert.equal(measured, inks.length, `잰 항목이 ${measured}건인데 목록은 ${inks.length}건이다`);
    assert.deepEqual(failed, [], `opacity 로 흐린 글자가 ${NEED}:1 에 미달한다: ${failed.join(" / ")}`);
  });
}

/**
 * ⚠**중지 경기 카드가 다시 opacity 로 돌아가지 않게 못 박는다.**
 * `.gcard.off{opacity:.62}` 는 배포물 **208장 · 284카드**에서 글자 12/12 를 AA 미달로 만들었다.
 * 그 카드가 혼자 가진 정보는 **어느 경기인가**(구장명 + 양 팀명)라 더 중요하다.
 */
test("⚠중지 경기 카드는 opacity 로 흐리지 않는다 — 형태로 말한다", () => {
  const rule = /\.gcard\.off\{([^}]*)\}/.exec(CSS);
  assert.notEqual(rule, null, ".gcard.off 규칙이 사라졌다 — 이 시험이 공회전한다");
  assert.ok(!/opacity/.test(rule![1]!), `.gcard.off 에 opacity 가 돌아왔다: ${rule![1]}`);
  assert.match(rule![1]!, /border-style:\s*dashed/, "「열리지 않았다」를 말하는 형태가 없다");
});

/**
 * **紋(레이더 도형)의 눈금선은 왜 흐려도 되는가** — 그 전제를 여기 못 박는다.
 *
 * 실측(2026-08-25 · 감사 P3 #30 · 배경은 `--panel`):
 * `.mf-grid`(`--hair-2`) **1.580 / 1.557** · `.mf-spoke`(`--hair`) **1.336 / 1.212** —
 * 비텍스트 기준 3:1 에 한참 못 미친다. **그래도 고치지 않는다.**
 *
 * 전제는 **「눈금선은 정보를 나르지 않는다」**이다. 나르는 것은 셋이고 전부 `--tx-2` 다:
 * 도형 윤곽(`.mf-shape`) · 꼭짓점(`.mf-dot`) · 축 이름(`.mf-lab`) — 실측 **6.613 / 6.668**.
 * 눈금선을 진하게 하면 **읽어야 할 것이 배경 격자에 묻힌다** — 고치는 것이 나쁜 쪽이다.
 *
 * ⚠**이 전제가 깨지는 두 가지**를 아래 시험이 지킨다:
 *   ⑴ 나르는 셋 중 하나라도 약한 토큰으로 내려가면 — 그때는 눈금선 논거가 사라진다
 *   ⑵ **배경이 `--panel` 이 아니게 되면** — 위의 수 전부가 다른 값이 된다
 *
 * ⚠**⑵ 는 내가 실제로 틀렸던 자리다**(2026-08-25). 처음에 `--page` 위에서 재서
 * 1.514/1.688 이 나왔고 감사 수치와 안 맞았다 — **배경을 잘못 잡으면 대비는 그냥 다른 수다.**
 */
/* ⚠CSS_NC(주석을 뗀 CSS)의 정의는 위로 옮겼다 — OPACITY_ALLOWED 가 먼저 쓴다 */
/** 비텍스트(도형·표시) 기준 */
const UI_NEED_MF = 3;

/**
 * ⚠**`--panel` 이 바탕이라는 것은 위 `TEAM_MARKS` 주석이 이미 적고 있다**(실측 2026-08-20 ·
 * `getComputedStyle`). 여기서는 그것을 **시험으로 바꾼다** — 적어 둔 전제와 실제 CSS 는 따로 논다.
 */
test("⚠紋의 배경은 --panel 이다 — 이 파일의 대비 계산 전부가 여기에 얹혀 있다", () => {
  const rule = /\.markpanel\{([^}]*)\}/.exec(CSS_NC);
  assert.notEqual(rule, null, ".markpanel 규칙이 사라졌다 — 이 시험이 공회전한다");
  assert.match(
    rule![1]!,
    /background:\s*var\(--panel\)/,
    "紋의 배경이 --panel 이 아니게 됐다 — 눈금선·윤곽 대비를 **전부 다시 재라**",
  );
});

/**
 * ⚠**축 이름(`.mf-lab`)은 아무도 안 재고 있었다.** `TEAM_MARKS` 는 `.mf-shape`·`.mf-dot` 의
 * `stroke` 만 본다. 그런데 눈금선을 흐리게 두는 근거는 **「읽을 것이 따로 또렷하다」**이고,
 * 축 이름은 그 「읽을 것」의 하나다.
 */
for (const scope of ["light", "dark"] as const) {
  test(`⚠${scope}: 紋의 축 이름이 3:1 을 넘는다 — 눈금선을 흐리게 두는 근거의 일부다`, () => {
    const t = tokens(scope);
    const panel = t.get("panel");
    const rule = /\.mf-lab\{([^}]*)\}/.exec(CSS_NC);
    assert.notEqual(rule, null, ".mf-lab 규칙이 사라졌다 — 이 시험이 공회전한다");
    const m = /(?:^|;)\s*fill:\s*var\(--([a-z0-9-]+)\)/.exec(rule![1]!);
    assert.notEqual(m, null, `.mf-lab 이 토큰 색을 안 쓴다: ${rule![1]}`);
    const c = t.get(m![1]!);
    assert.ok(c !== undefined && panel !== undefined, "토큰을 못 읽었다 — 이 시험이 공회전한다");
    const r = contrast(c!, panel!);
    assert.ok(r >= UI_NEED_MF, `.mf-lab --${m![1]!} ${c} 위 --panel ${panel} = ${r.toFixed(3)}:1`);
    console.log(`  · ${scope} 축 이름 ${r.toFixed(3)}:1`);
  });
}

/**
 * **눈금선은 흐리다. 그건 결함이 아니라 선택이고, 그 선택을 여기 적는다.**
 *
 * 실측(2026-08-25 · 감사 P3 #30 · 바탕 `--panel`):
 * `.mf-grid`(`--hair-2`) **1.580 / 1.557** · `.mf-spoke`(`--hair`) **1.336 / 1.212**.
 * 비텍스트 3:1 에 한참 못 미친다. **고치지 않는다** — 눈금선을 진하게 하면
 * **읽어야 할 것(도형·꼭짓점·축 이름)이 배경 격자에 묻힌다.**
 *
 * ⚠**감사는 이 값을 「전제가 바뀌었다」로 기록했다** — 예전에는 도형이 구단 색이라
 * 눈금선과 세기가 비슷했고, 지금은 도형이 `--tx-2`(6.613/6.668)라 **위계가 생겼다.**
 * 그래서 같은 수가 이제 다른 뜻이다.
 *
 * ⚠**이 시험은 값을 못 박는 것이 아니라 「눈금선이 정보 운반자가 되지 않았는가」를 지킨다.**
 * 눈금선에 색·굵기를 얹어 무언가를 말하기 시작하면 여기서 먼저 운다.
 */
test("⚠紋의 눈금선은 정보를 나르지 않는다 — 흐린 채로 두는 근거다", () => {
  for (const [sel, token] of [[".mf-grid", "hair-2"], [".mf-spoke", "hair"]] as const) {
    const rule = new RegExp(`\\${sel}\\{([^}]*)\\}`).exec(CSS_NC);
    assert.notEqual(rule, null, `${sel} 규칙이 사라졌다 — 이 시험이 공회전한다`);
    assert.match(
      rule![1]!,
      new RegExp(`stroke:\\s*var\\(--${token}\\)`),
      `${sel} 의 색이 --${token} 이 아니게 됐다 — 눈금선이 무언가를 말하기 시작했다면\n` +
        "  ⚠**그 순간 3:1 이 필요해진다.** 감사 #30 의 전제(「눈금선은 정보를 안 나른다」)를 다시 판단하라.",
    );
    // ⚠**상태 클래스가 붙으면 그건 「말하기 시작한 것」이다**(`.mf-ax.on .mf-spoke` 는 별개 — forced-colors.test.ts 가 다룬다)
    assert.ok(
      !/stroke-dasharray|marker|font/.test(rule![1]!),
      `${sel} 이 눈금선 이상의 일을 한다: ${rule![1]}`,
    );
  }
  const t = tokens("light");
  console.log(
    `  · 눈금선 --hair-2 ${contrast(t.get("hair-2")!, t.get("panel")!).toFixed(3)}` +
      ` · --hair ${contrast(t.get("hair")!, t.get("panel")!).toFixed(3)} (라이트 · 3:1 미만이지만 선택이다)`,
  );
});

/**
 * **정렬 표시가 보이는가.**
 *
 * ⚠**안 보였다**(2026-08-25 · 감사 P3 #31). `.sortable i{opacity:.3}` 이 `--tx-2` 를 흐려
 * 실효 대비가 **라이트 1.554 · 다크 1.765** 였다 — UI 표시에 필요한 **3:1** 의 절반이다.
 * 그 표시는 「이 열은 정렬할 수 있다」를 말하는 **유일한 신호**라, 안 보이면 그 기능이 없는 것과 같다.
 *
 * ⚠**기존 시험 둘 다 못 잡았다.** 대비 시험은 규칙 안에 color 가 있어야 재는데
 * 그 규칙에는 없었고(부모에서 상속), opacity 시험은 그 선택자를
 * **「도형이라 글자 없음 · 도형 대비는 별건으로 미검증」**으로 면제하고 있었다.
 * **그 「미검증」이 결함 그 자체였다** — 목록에 적어 두는 것만으로는 아무도 안 잰다.
 *
 * ⚠**위계는 지킨다**: 정렬 안 됨 --tx-3(4.910/5.499) 대 정렬됨 --tx(17.139/14.736).
 */
const UI_NEED = 3;

test("⚠정렬 표시는 opacity 로 흐리지 않는다 — 계산을 거짓으로 만든다", () => {
  const rule = /\.sortable i\{([^}]*)\}/.exec(CSS);
  assert.notEqual(rule, null, ".sortable i 규칙이 사라졌다 — 이 시험이 공회전한다");
  assert.ok(
    !/opacity/.test(rule![1]!),
    `.sortable i 에 opacity 가 돌아왔다: ${rule![1]} — 대비를 색으로 말해라`,
  );
});

for (const scope of ["light", "dark"] as const) {
  test(`⚠${scope}: 정렬 표시가 UI 기준 ${UI_NEED}:1 을 넘는다`, () => {
    const rule = /\.sortable i\{([^}]*)\}/.exec(CSS);
    assert.notEqual(rule, null, ".sortable i 규칙이 사라졌다 — 이 시험이 공회전한다");
    const m = /(?:^|;)\s*color:\s*var\(--([a-z0-9-]+)\)/.exec(rule![1]!);
    assert.notEqual(m, null, `.sortable i 가 토큰 색을 안 쓴다: ${rule![1]}`);
    const t = tokens(scope);
    const fg = t.get(m![1]!);
    const page = t.get("page");
    assert.ok(fg !== undefined && page !== undefined, "토큰을 못 읽었다 — 이 시험이 공회전한다");
    const r = contrast(fg!, page!);
    assert.ok(
      r >= UI_NEED,
      `정렬 표시 --${m![1]!} ${fg} 위 --page ${page} = ${r.toFixed(3)}:1 (${UI_NEED} 필요)`,
    );
    // ⚠**위계가 남아 있는가** — 그냥 지우면 정렬 안 된 표시가 정렬된 것과 같은 세기가 된다
    const sorted = contrast(t.get("tx")!, page!);
    assert.ok(sorted > r * 2, `정렬된 표시(${sorted.toFixed(2)})와 안 된 표시(${r.toFixed(2)})가 안 갈린다`);
    console.log(`  · ${scope} 정렬표시 ${r.toFixed(3)}:1 / 정렬됨 ${sorted.toFixed(3)}:1`);
  });
}

/** 비텍스트(UI 표시·경계) 기준 — WCAG 1.4.11 */
const UI_NEED_EDGE = 3;

/**
 * **구단 색 면 위의 자손 텍스트** — 이 사이트에서 **바탕이 토큰이 아닌 유일한 자리**다.
 *
 * ⚠**분모가 사라져 있었다**(2026-09-08 · design-auditor P0). `tr.me td` 는 배경을 구단 색으로,
 * 글자를 `--team-ink` 로 칠하는데, **그 안의 `.den` 만 자기 규칙(`--tx-3`)을 그대로 들고 있었다** —
 * 직접 건 색은 상속을 언제나 이기므로 조용히 그렇게 된다.
 * 실측(`ranking.html` · 그 화면의 `--team` 은 중립색 #6b7280): **라이트 1.060 · 다크 1.470** · 10px.
 * **값(`.017`)은 4.547 로 보이고 분모만 안 보였다** — M2 가 요구하는 바로 그 정보다.
 *
 * ⚠**우연이 아니다**: `--tx-3` 를 12구단 색 위에 얹으면 **라이트 12/12 · 다크 10/12 가 4.5 미달**이다.
 * ⚠**지금은 9장이지만 `tr.me` 행은 배포물에 83,808개**다(2026-09-08 실측 · dist 9,392장 주사) —
 * 그 행에 비율을 하나 더 넣는 순간 같은 결함이 그 수만큼 생긴다.
 *
 * 여기서 재는 것은 둘이다:
 *   ⑴ `tr.me` 로 한정된 색 규칙이 **12구단 × 2테마 = 24조합**에서 4.5 를 넘는가
 *   ⑵ **강조행 안에 자기 색을 쓰는 자손이 새로 생기지 않았는가**(실제 렌더에서 확인한다)
 * ⚠**⑵ 가 이 라운드의 결함을 잡는 쪽이다** — ⑴ 만 있으면 「규칙을 안 쓴 자손」은 영원히 안 보인다.
 */
const TEAM_SURFACE_TEXT: readonly { sel: string; need: number; what: string }[] = [
  { sel: "tr.me td", need: 4.5, what: "강조행의 값" },
  { sel: "tr.me td .den", need: 4.5, what: "강조행의 분모(10px · M2)" },
];

for (const scope of ["light", "dark"] as const) {
  for (const mark of TEAM_SURFACE_TEXT) {
    test(`⚠${scope}: ${mark.sel} 가 구단 색 면 위에서 AA 를 넘는다 — ${mark.what}`, () => {
      const rule = new RegExp(
        `(?:^|[\\n}])\\s*${mark.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`,
      ).exec(CSS_NC);
      assert.notEqual(rule, null, `${mark.sel} 규칙이 CSS 에 없다 — 이 시험이 공회전한다`);
      const decl = /(?:^|;)\s*color:\s*([^;]+)/.exec(rule![1]!);
      assert.notEqual(decl, null, `${mark.sel} 에 color 선언이 없다 — 이 시험이 공회전한다`);
      const raw = decl![1]!.trim();
      const token = /^var\(\s*--([a-z0-9-]+)/.exec(raw);
      assert.notEqual(token, null, `${mark.sel} 의 color 가 토큰이 아니다: ${raw}`);
      assert.equal(
        token![1]!,
        "team-ink",
        `${mark.sel} 가 --${token![1]!} 를 쓴다 — **구단 색 면 위에서는 그 면의 잉크(--team-ink)에 맞춰라.**\n` +
          "  ⚠--tx-3 는 12구단 색 위에서 라이트 12/12 · 다크 10/12 가 4.5 미달이다",
      );
      // ⚠**토큰이 아니라 실제 구단 색으로 푼다** — 24조합이 여기서 갈린다
      const failed: string[] = [];
      let combos = 0;
      for (const team of TEAMS) {
        const c = colorOf(team.code);
        const r = contrast(c.ink, c.base);
        combos += 1;
        if (r < mark.need) failed.push(`${team.code} ${r.toFixed(3)}`);
      }
      // ⚠**공회전 방지** — 구단이 줄면 이 시험은 더 적게 재고도 초록이 된다
      assert.equal(combos, 12, `구단이 ${combos}개다 — 12구단 × 2테마 = 24조합이어야 한다`);
      assert.deepEqual(failed, [], `${mark.sel} 가 미달하는 구단: ${failed.join(" / ")}`);
      /**
       * ⚠**실제로 이 결함이 난 화면은 구단이 아니라 중립색이다.** 리그 전체 화면
       * (`ranking.html`·`matchup.html`·`players.html`)은 `--team` 이 `NEUTRAL_COLOR` 이고,
       * 그 짝의 대비가 **4.547** 로 12구단 최저(広島 5.466)보다도 낮다 — **기준 4.5 바로 위다.**
       * 중립색을 흐리거나 밝히면 여기서 먼저 운다.
       */
      const neutral = contrast(NEUTRAL_COLOR.ink, NEUTRAL_COLOR.base);
      assert.ok(
        neutral >= mark.need,
        `중립색(리그 화면의 --team)에서 ${neutral.toFixed(3)}:1 이다 — ${mark.need} 필요`,
      );
      console.log(
        `  · ${scope} ${mark.sel} 12구단 최저 ${Math.min(
          ...TEAMS.map((t) => contrast(colorOf(t.code).ink, colorOf(t.code).base)),
        ).toFixed(3)} · 중립색 ${neutral.toFixed(3)}`,
      );
    });
  }
}

/**
 * ⚠**`.den` 에 색을 주는 규칙 중 `tr.me td .den` 보다 특이도가 높은 것이 둘 있다.**
 *
 * `table.stand td.wd .den` · `.hstand td.wd .den` 이 (0,3,2)로 (0,2,2)를 이긴다.
 * **그 두 표에는 `tr.me` 가 없다**(2026-09-08 실측 — dist 의 順位表·홈 순위표 전건에서 0건)
 * 그래서 오늘은 문제가 아니다. ⚠**셋째가 생기면 여기가 조용히 진다** — 그때 이 시험이 먼저 운다.
 */
test("⚠강조행의 분모를 특이도로 이기는 .den 규칙이 늘지 않는다 — 늘면 조용히 진다", () => {
  /** (클래스+속성, 요소) — 우리 CSS 에는 id 선택자가 규칙에 안 쓰이므로 두 자리로 충분하다 */
  const spec = (one: string): [number, number] => [
    (one.match(/\.[a-zA-Z][\w-]*|\[[^\]]+\]/g) ?? []).length,
    (one.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length,
  ];
  /** `tr.me td .den` = 클래스 2 · 요소 2 */
  const beats = (one: string): boolean => {
    const [b, c] = spec(one);
    return b > 2 || (b === 2 && c > 2);
  };
  const stronger: string[] = [];
  for (const m of CSS_NC.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? "").trim().replace(/\s+/g, " ");
    if (!/(^|;)\s*color:/.test(m[2] ?? "")) continue;
    // ⚠**마지막 컴파운드가 .den 이어야 한다** — 조상 자리의 .den 은 그 요소의 색이 아니다
    if (!targetsClass(sel, "den")) continue;
    if (sel.split(",").some((one) => beats(one.trim()))) stronger.push(sel);
  }
  assert.deepEqual(
    stronger.sort(),
    [".hstand td.wd .den", "table.stand td.wd .den"],
    "특이도로 `tr.me td .den` 을 이기는 .den 색 규칙이 바뀌었다.\n" +
      "  ⚠**그 표에 tr.me 가 있는지 실물로 확인해라** — 있으면 강조행의 분모가 조용히 --tx-3 로 돌아간다",
  );
});

/**
 * **강조행 안에 자기 색을 쓰는 자손이 새로 생기지 않았는가** — 실제 렌더로 잰다.
 *
 * ⚠**정적 CSS 검사만으로는 원리적으로 못 잡는다.** 결함의 모양이 「`.den` 이 `tr.me` 를
 * 이름으로 안 적는다」라서, CSS 만 보면 그 둘이 만나는 것을 알 수 없다.
 * 그래서 **강조행을 실제로 그려서** 그 안의 클래스를 꺼내고, 그 클래스에 색을 주는 규칙이
 * `tr.me` 로 덮여 있는지 본다.
 */
function meRowClasses(out: string): string[] {
  const m = /<tr class="me"[^>]*>([\s\S]*?)<\/tr>/.exec(out);
  assert.notEqual(m, null, "강조행(tr.me)이 안 그려졌다 — 이 시험이 공회전한다");
  const set = new Set<string>();
  for (const a of m![1]!.matchAll(/class="([^"]*)"/g)) {
    for (const c of (a[1] ?? "").split(/\s+/)) if (c !== "") set.add(c);
  }
  return [...set].sort();
}

/** 선택자의 **마지막 컴파운드**에 그 클래스가 있는가 — 조상 자리에 있는 것은 그 요소의 색이 아니다 */
function targetsClass(sel: string, cls: string): boolean {
  return sel.split(",").some((one) => {
    const last = one.trim().split(/[\s>+~]+/).pop() ?? "";
    return new RegExp(`\\.${cls}(?![\\w-])`).test(last);
  });
}

test("⚠강조행 안에서 자기 색을 쓰는 자손은 전부 그 면의 잉크로 덮여 있다", () => {
  const drawRow: DrawSeasonRow = {
    season: 2025, games: 858, draws: 23, extra: 101, extraDrawn: 21,
    current: true,
    drawRate: drawRate({ games: 858, draws: 23 }),
    extraDecided: extraDecidedRate({ extra: 101, extraDrawn: 21 }),
    regulationDrawn: 2, maxInning: 12, inningUnknown: 0,
  };
  const out = renderRankingPage(
    {
      season: 2025,
      asOf: "2025-10-05",
      seasonOver: true,
      standings: [{ id: "central", name: "セントラル・リーグ", rows: [] }],
      tieRule: TIE_RULE,
      draws: [drawRow],
      leagues: [],
    },
    context(),
  );
  const classes = meRowClasses(out);
  // ⚠**공회전 방지** — 강조행이 클래스 없는 칸만 갖게 되면 이 시험은 아무것도 안 잰다
  assert.ok(classes.length >= 3, `강조행 안의 클래스가 ${classes.length}종뿐이다 — 이 시험이 공회전한다`);
  assert.ok(classes.includes("den"), "강조행에 분모(.den)가 없다 — 이 시험이 재려던 것이 사라졌다(M2)");

  const rules = [...CSS_NC.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: (m[1] ?? "").trim().replace(/\s+/g, " "),
    body: m[2] ?? "",
  }));
  const bare: string[] = [];
  for (const c of classes) {
    const colored = rules.filter((r) => /(^|;)\s*color:/.test(r.body) && targetsClass(r.sel, c));
    if (colored.length === 0) continue; // 자기 색이 없다 — 면의 잉크를 상속한다
    if (colored.some((r) => /tr\.me\b/.test(r.sel))) continue; // 덮여 있다
    bare.push(`.${c} (${colored.map((r) => r.sel).join(" / ")})`);
  }
  assert.deepEqual(
    bare,
    [],
    "강조행(구단 색 면) 안에서 자기 색을 쓰는 자손이 있다 — 면의 잉크(--team-ink)로 덮어라.\n" +
      "  ⚠--tx-3 는 구단 색 위에서 라이트 12/12 · 다크 10/12 가 4.5 미달이다: " + bare.join(" / "),
  );
  console.log(`  · 강조행 안의 클래스 ${classes.length}종(${classes.join(" ")}) · 덮이지 않은 것 ${bare.length}`);
});

/**
 * ⚠**같은 결함을 옆자리에 만들 뻔했다** — 자기 수정 재확인에서 잡았다(2026-09-08).
 *
 * `.chip.fav s`(즐겨찾기 개수)의 흐림을 `color:var(--tx-3)` 로 바꿨는데, **그 칩은 눌리면
 * 면이 구단 색으로 바뀐다**(`.chip[aria-pressed="true"]`). 그러면 `--tx-3` 는 그 면 위에서
 * **1.060 / 1.470** 이 된다 — `tr.me td .den` 과 글자 그대로 같은 결함이다.
 * ⚠**옛 상태도 이미 미달이었다**(inherit 를 .8 로 흐려 **3.760**). 흐림을 빼서 **4.834** 가 됐다.
 *
 * `.pk` 는 이 처방을 처음부터 갖고 있었다(`.pk[aria-pressed="true"] s{color:inherit}`).
 * **그 처방이 규칙이 아니라 한 자리의 관습이었던 것이 문제다** — 여기서 규칙으로 만든다.
 *
 * ⚠**이 시험이 재는 것과 못 재는 것**: 「눌리면 구단 색 면이 되는 버튼」의 자손이
 * `--tx*` 를 **직접** 박았다면 눌림 상태의 덮개가 있어야 한다는 것까지다.
 * **이름으로 그 버튼을 안 적는 자손**(예: 공용 클래스)은 정적으로 못 본다 —
 * 그 구멍은 `tr.me` 쪽에서 실제 렌더로 막는다(위의 강조행 시험).
 */
test("⚠눌리면 구단 색 면이 되는 버튼의 자손이 --tx* 를 그대로 들고 들어가지 않는다", () => {
  const rules = [...CSS_NC.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: (m[1] ?? "").trim().replace(/\s+/g, " "),
    body: m[2] ?? "",
  }));
  /** 배경이 구단 색이고 글자가 그 면의 잉크인 규칙 = 「구단 색 면」 */
  const surfaces = rules
    .filter(
      (r) =>
        /(^|;)\s*background:\s*var\(--(chip|team)[,)]/.test(r.body) &&
        /(^|;)\s*color:\s*var\(--(chip|team)-ink[,)]/.test(r.body),
    )
    .flatMap((r) => r.sel.split(",").map((s) => s.trim()));
  // ⚠**공회전 방지** — 면을 못 찾으면 아래가 전부 통과한다
  assert.ok(surfaces.length >= 5, `구단 색 면 규칙을 ${surfaces.length}개밖에 못 찾았다 — 이 시험이 공회전한다`);
  /** 눌림 조건을 뗀 버튼 이름 */
  const bases = [...new Set(surfaces.map((s) => s.replace(/\[aria-[^\]]*\]/g, "").trim()))].filter(
    (s) => s.startsWith("."),
  );
  assert.ok(bases.length >= 3, `버튼 이름을 ${bases.length}개밖에 못 뽑았다 — 이 시험이 공회전한다`);

  /** `<버튼> <자손>{color:var(--tx*)}` 모양 — 눌리면 그 잉크가 면과 부딪친다 */
  const risky = rules
    .filter((r) => /(^|;)\s*color:\s*var\(--tx/.test(r.body))
    .map((r) => /^(\S+)\s+(\S.*)$/.exec(r.sel))
    .filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => bases.some((b) => m[1]!.startsWith(b)))
    .map((m) => ({ head: m[1]!, desc: m[2]!, sel: m[0] }));

  // ⚠**목록을 못 박는다** — 늘면 그 자리도 덮개가 필요한지 손으로 재게 된다
  assert.deepEqual(
    risky.map((r) => r.sel).sort(),
    [".chip.fav s", ".pk s"],
    "구단 색 면이 되는 버튼의 자손에 --tx* 를 박은 자리가 바뀌었다 — 눌림 상태에서 재라",
  );

  const missing: string[] = [];
  for (const r of risky) {
    const cover = rules.find(
      (x) =>
        (x.sel === `${r.head}[aria-pressed="true"] ${r.desc}` ||
          x.sel === `${r.head}[aria-selected="true"] ${r.desc}`) &&
        /(^|;)\s*color:\s*(inherit|var\(--(chip|team)-ink)/.test(x.body),
    );
    if (cover === undefined) missing.push(r.sel);
  }
  assert.deepEqual(
    missing,
    [],
    "눌리면 구단 색 면이 되는데 자손이 --tx* 를 그대로 쓴다 — `[aria-pressed=\"true\"] <자손>{color:inherit}` 를 더해라.\n" +
      "  ⚠중립색(#6b7280) 위에서 --tx-3 는 1.060 / 1.470 이다: " + missing.join(" / "),
  );
  console.log(`  · 구단 색 면 ${surfaces.length}건 · 버튼 이름 ${bases.length}개 · 덮개가 필요한 자손 ${risky.length}건(전부 덮여 있다)`);
});

/**
 * **입력칸의 경계가 보이는가** — WCAG 2.2 SC 1.4.11(비텍스트 3:1).
 *
 * ⚠**검색칸의 경계를 말하는 것이 1px 테두리 하나였다**(2026-09-08 · design-auditor P1).
 * 채움(`--page`)과 상단바(`--panel`)의 대비가 **라이트 1.044 · 다크 1.084** 라 면으로는 경계가 없고,
 * 그 테두리가 `--hair-2` 로 **1.580 / 1.557** 이었다 — 3:1 의 절반이다.
 * ⚠**예외 둘(비활성 · UA 기본)에 해당하지 않는다.**
 * ⚠**「hover 에서 진해지니 괜찮다」는 답이 아니다** — 1.4.11 은 **rest 상태**를 잰다.
 *
 * 감사자가 준 판정 기준(셋 중 하나를 두 테마에서):
 *   1 `CR(테두리, 바깥면) ≥ 3` **그리고** `CR(테두리, 채움) ≥ 3`
 *   2 `CR(채움, 바깥면) ≥ 3`
 *   3 테두리를 3:1 이상 잉크의 **밑줄(하단 2px+)** 로 바꾸고 채움 폭 전체를 덮게
 * ⚠**3 은 여기서 못 잰다** — 형태를 바꾸는 안이라 규칙 모양 자체가 달라진다. 그때 이 시험을 고쳐라.
 *
 * ## ⚠같은 결함이 네 자리였다 (2026-09-08 · 첫 라운드는 검색칸만 고쳤다)
 *
 * `.find input` · `.mfind input` · `.mfind select` 가 같은 모양이었다 —
 * 채움 `--panel` · 테두리 `--hair-2`.
 * ⚠**`.mfind` 는 더 나쁘다**: `.block`(`--panel`) 안이라 **채움 대 둘러싼 면이 정확히 1.000** 이다.
 * ⚠**바탕이 다르니 처방(`--tx-3`)을 그대로 옮기기 전에 다시 쟀다** — 네 자리 모두에서 통과한다:
 * `--tx-3` 대 `--page` **4.910 / 5.499** · 대 `--panel` **5.125 / 5.072**.
 * ⚠**hover 도 같이 옮겼다** — `.mfind` 의 hover 가 `--tx-3` 이라 rest 와 **같은 색**이 될 뻔했다.
 */
const FIELD_EDGES: readonly { sel: string; fill: string; around: string; what: string }[] = [
  { sel: ".qbox input", fill: "page", around: "panel", what: "상단바의 검색칸" },
  { sel: ".find input", fill: "panel", around: "page", what: "선수 목록의 이름 좁히기" },
  { sel: ".mfind input", fill: "panel", around: "panel", what: "표 좁히기 칸(.block 안 · 면이 같다)" },
  { sel: ".mfind select", fill: "panel", around: "panel", what: "표 좁히기 고르개(.block 안 · 면이 같다)" },
];

/**
 * ⚠**같은 잉크의 다른 자리는 등급이 다르다. 같이 끌고 오지 마라.**
 * 아래 다섯은 `--hair-2` 테두리를 쓰지만 **가시 텍스트 라벨**이 있고 그 라벨이 6.6 대비라
 * 1.4.11 위반으로 **단정할 수 없다**(감사자 판정 · 2026-09-08).
 * ⚠**「라벨이 없는 것은 입력칸뿐이다」로 읽지 마라 — 그건 틀렸다.** `.find input` 도 `.mfind input` 도
 * **바로 옆에 보이는 `label` 을 갖는다**(`名前でしぼる` 등). 가르는 것은 라벨의 유무가 아니라 **그 자리**다:
 * 아래 다섯은 글자가 **컨트롤 안에** 있어서 테두리가 없어도 컨트롤의 넓이가 보이는데,
 * **빈 입력칸은 안이 비어 있어 경계를 말하는 것이 테두리뿐**이다. 그래서 입력칸 넷만 올린다.
 * ⚠**여기 적어 둔 것이 낡지 않게** 아래 시험이 「그 선택자가 아직 CSS 에 있는가」를 확인한다.
 */
const EDGE_EXEMPT: readonly { sel: string; why: string }[] = [
  { sel: ".tab", why: "탭 이름이 글자로 보인다(선택된 탭은 구단 색 면 + --team-ink)" },
  { sel: ".chip", why: "구단 약칭이 글자로 보인다" },
  { sel: ".mv", why: "「前へ / 次へ」가 글자로 보인다" },
  { sel: ".go.alt", why: "버튼 문구가 글자로 보인다(주 버튼 .go 는 구단 색 면이라 경계가 면으로 산다)" },
  { sel: ".hjump a", why: "이동처 이름이 글자로 보인다" },
];

test("⚠1.4.11 면제로 적어 둔 자리가 아직 실재한다 — 사라진 선택자를 면제로 남기지 않는다", () => {
  const missing = EDGE_EXEMPT.filter(
    (e) => !new RegExp(`(?:^|[\\n},])\\s*${e.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[{,:\\s]`).test(CSS_NC),
  ).map((e) => e.sel);
  assert.deepEqual(missing, [], "면제로 적어 둔 선택자가 CSS 에 없다 — 목록에서 빼라");
  console.log(`  · 1.4.11 면제 ${EDGE_EXEMPT.length}건(전부 가시 텍스트 라벨이 있다)`);
});

for (const scope of ["light", "dark"] as const) {
  for (const f of FIELD_EDGES) {
    test(`⚠${scope}: ${f.sel} 의 경계가 3:1 을 넘는다 — ${f.what}`, () => {
      // ⚠**`exec` 로 첫 규칙만 잡지 않는다** — 같은 선택자가 `@media` 안에 다시 나오고
      //   (`.mfind input` 은 680px 이하에서 폭만 바꾼다) 그쪽에는 `border` 가 없다.
      //   **테두리를 선언하는 규칙이 정확히 하나인지**까지 여기서 못 박는다.
      const all = [
        ...CSS_NC.matchAll(
          new RegExp(`(?:^|[\\n}])\\s*${f.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`, "g"),
        ),
      ].map((m) => m[1]!);
      assert.ok(all.length > 0, `${f.sel} 규칙이 CSS 에 없다 — 이 시험이 공회전한다`);
      const withBorder = all.filter((body) => /(?:^|;)\s*border:/.test(body));
      assert.equal(
        withBorder.length,
        1,
        `${f.sel} 의 border 선언이 ${withBorder.length}곳이다 — 어느 것이 rest 상태인지 이 시험이 못 고른다`,
      );
      // ⚠**border 단축 속성은 var() 를 둘 쓴다**(`var(--rw-row) solid var(--tx-3)`) —
      //   **색은 마지막 것**이다. 첫 것을 잡으면 굵기 토큰(--rw-row: 1px)을 색으로 읽는다.
      const shorthand = /(?:^|;)\s*border:\s*([^;]+)/.exec(withBorder[0]!);
      assert.notEqual(shorthand, null, `${f.sel} 에 border 선언이 없다 — 이 시험이 공회전한다`);
      const vars = [...shorthand![1]!.matchAll(/var\(\s*--([a-z0-9-]+)/g)].map((v) => v[1]!);
      assert.ok(vars.length >= 1, `${f.sel} 의 border 가 토큰을 안 쓴다: ${shorthand![1]}`);
      const border = vars[vars.length - 1]!;
      // ⚠**채움도 CSS 에서 읽는다 — 목록에 적어 둔 것을 믿지 않는다.**
      //   여기 적힌 `fill` 이 문자열이던 동안, CSS 의 `background` 를 바꿔도 이 시험은 **초록이었다**
      //   (2026-09-08 뮤테이션 실측). 「적어 둔 주장을 시험이 검산하지 않는」 그 병이다.
      //   ⚠`around`(둘러싼 면)는 DOM 포함관계라 CSS 만으로는 못 읽는다 — 그쪽은 선언으로 남는다.
      const bg = /(?:^|;)\s*background:\s*var\(\s*--([a-z0-9-]+)\s*\)/.exec(withBorder[0]!);
      assert.notEqual(bg, null, `${f.sel} 이 background 를 토큰으로 안 쓴다 — 채움을 확인할 수 없다`);
      assert.equal(
        bg![1]!,
        f.fill,
        `${f.sel} 의 채움이 --${bg![1]} 인데 목록은 --${f.fill} 이라고 적고 있다 — 목록을 고쳐라`,
      );
      const t = tokens(scope);
      const ink = t.get(border);
      const fill = t.get(f.fill);
      const around = t.get(f.around);
      assert.ok(ink !== undefined && fill !== undefined && around !== undefined, "토큰을 못 읽었다");
      const c1 = contrast(ink!, around!) >= UI_NEED_EDGE && contrast(ink!, fill!) >= UI_NEED_EDGE;
      const c2 = contrast(fill!, around!) >= UI_NEED_EDGE;
      assert.ok(
        c1 || c2,
        `${f.sel}: 테두리 --${border} 대 --${f.around} ${contrast(ink!, around!).toFixed(3)} ·` +
          ` 대 채움 --${f.fill} ${contrast(ink!, fill!).toFixed(3)} ·` +
          ` 채움 대 바깥면 ${contrast(fill!, around!).toFixed(3)} — 셋 다 ${UI_NEED_EDGE} 미만이다.\n` +
          "  ⚠**hover 를 근거로 삼지 마라** — 1.4.11 은 rest 상태를 잰다",
      );
      // ⚠**공회전 방지 ⑴** — 옛 값(--hair-2)으로 되돌아가면 반드시 떨어지는지 여기서 확인한다
      const was = t.get("hair-2")!;
      assert.ok(
        contrast(was, around!) < UI_NEED_EDGE && contrast(was, fill!) < UI_NEED_EDGE,
        `--hair-2 가 이제 --${f.around} 위에서 ${contrast(was, around!).toFixed(3)} ·` +
          ` --${f.fill} 위에서 ${contrast(was, fill!).toFixed(3)} 이다 —` +
          " 이 시험의 전제(옛 테두리가 미달이었다)가 바뀌었으니 다시 판단하라",
      );
      // ⚠**공회전 방지 ⑵ — 위의 `c1 || c2` 가 c2 로 조용히 통과하면 테두리를 아무 색이나 써도 초록이다.**
      //   여기 있는 네 자리는 전부 **면으로는 경계가 없어서** 골라 둔 것이므로, 그 전제를 못 박는다.
      //   면이 실제로 갈라지게 바뀌었다면 이 시험이 아니라 **목록을 다시 판단해야 한다.**
      assert.ok(
        !c2,
        `${f.sel}: 채움 --${f.fill} 대 바깥면 --${f.around} 가 ${contrast(fill!, around!).toFixed(3)} 이다 —` +
          " 이제 면만으로 경계가 서므로 이 자리는 목록의 전제(테두리가 유일한 채널)를 벗어났다",
      );
      console.log(
        `  · ${scope} ${f.sel} 테두리 --${border}: 바깥면 --${f.around} ${contrast(ink!, around!).toFixed(3)} ·` +
          ` 채움 --${f.fill} ${contrast(ink!, fill!).toFixed(3)} ·` +
          ` 채움 대 바깥면 ${contrast(fill!, around!).toFixed(3)} (기준 ${UI_NEED_EDGE} · 판정 ${c1 ? "1" : "2"})`,
      );
    });
  }
}

/**
 * **자리표시 글자(`::placeholder`)** — 규칙이 CSS 전체에 **0건**이었다(2026-09-08 · design-auditor P1).
 *
 * UA 기본값 `rgb(117,117,117)` 이 **두 테마 모두에** 새어 라이트 **4.414** · 다크 **3.924** 였다.
 * ⚠**더 무거운 것은 토큰 이탈이다** — 이 색만 디자인 시스템 밖에 있어 팔레트를 바꿔도 **안 따라온다.**
 * ⚠**채움이 두 가지다**: 상단바 검색칸은 `--page`, 본문 입력칸(`.find input`·`.mfind input`)은 `--panel`.
 * 둘 다에서 재야 한다.
 */
for (const scope of ["light", "dark"] as const) {
  test(`⚠${scope}: ::placeholder 가 토큰 색이고 두 채움 위에서 AA 를 넘는다`, () => {
    const rule = /(?:^|[\n}])\s*::placeholder\{([^{}]*)\}/.exec(CSS_NC);
    assert.notEqual(rule, null, "::placeholder 규칙이 없다 — UA 기본값이 두 테마에 샌다");
    const m = /(?:^|;)\s*color:\s*var\(\s*--([a-z0-9-]+)\s*\)/.exec(rule![1]!);
    assert.notEqual(m, null, `::placeholder 가 토큰 색을 안 쓴다: ${rule![1]}`);
    // ⚠**Firefox 는 자리표시에 opacity 를 얹는다** — 안 되돌리면 색을 정해도 흐려진다
    assert.match(rule![1]!, /(^|;)\s*opacity:\s*1\b/, "::placeholder 에 opacity:1 이 없다 — 일부 브라우저가 흐린다");
    const t = tokens(scope);
    const ink = t.get(m![1]!);
    assert.ok(ink !== undefined, `--${m![1]!} 을 못 읽었다`);
    for (const bg of ["page", "panel"] as const) {
      const r = contrast(ink!, t.get(bg)!);
      assert.ok(r >= NEED, `::placeholder --${m![1]!} 이 --${bg} 위에서 ${r.toFixed(3)}:1 (${NEED} 필요)`);
      console.log(`  · ${scope} ::placeholder --${m![1]!} over --${bg} = ${r.toFixed(3)}:1`);
    }
    // ⚠**공회전 방지 겸 근거** — UA 기본값이 지금도 미달인가. 아니게 되면 이 규칙의 이유가 바뀐다
    const ua = contrast("#757575", t.get("page")!);
    assert.ok(ua < NEED, `UA 기본 자리표시색이 ${ua.toFixed(3)}:1 로 통과한다 — 이 규칙의 근거를 다시 판단하라`);
  });
}
