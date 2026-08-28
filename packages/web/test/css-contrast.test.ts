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
import { TEAMS, colorOf } from "@bb-app/domain";
import { CLIENT_JS, CSS } from "../src/assets.ts";

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
 * 그래서 **잡는 방법을 바꾸는 대신 「정당화을 강제」한다**:
 * 1 미만의 opacity 를 쓰는 규칙은 **전부 아래 목록에 있어야 하고**, 목록은 그 이유를 적는다.
 * 새 규칙을 넣으면 이 시험이 먼저 울고, 그때 **「이 서브트리에 글자가 있는가」를 손으로 재게** 된다.
 *
 * ⚠**이 목록은 「안전하다」가 아니라 「재 보고 넣었다」는 뜻이다.**
 * 글자를 가진 셋은 실측했다(라이트/다크 모두 기준 4.5 통과):
 *   `#tip s`(.72) 9.23 / 6.48 · `.chip.fav s`(.8) 9.55 / 9.14 · `.pk[data-slot]::after`(.85) 11.35 / 10.14
 */
const OPACITY_ALLOWED: readonly { sel: string; why: string }[] = [
  { sel: ".mv:disabled", why: "무효 컨트롤 — WCAG 1.4.3 이 명시적으로 면제한다" },
  { sel: ".go:disabled", why: "같은 이유" },
  { sel: ".go:hover:not(:disabled)", why: "hover 상태의 일시 연출 · .85 로 기준 아래로 내려가지 않는다" },
  { sel: "#tip s", why: "글자이지만 실측 9.23/6.48 · 기준 4.5 통과" },
  { sel: ".chip.fav s", why: "글자이지만 실측 9.55/9.14 통과" },
  { sel: ".pk[data-slot]::after", why: "생성 글자 · 실측 11.35/10.14 통과" },
  { sel: ".legend .bar", why: "범례 견본 — 도형이고 글자가 없다(등급 표시를 끕을 때의 연출)" },
  // ⚠`.sortable i` 는 **빠졌다**(2026-08-25 · 감사 P3 #31). 여기 적혀 있던
  //   「⚠도형 대비는 별건으로 미검증」이 바로 그 결함이었다 — 재 보니 **1.554/1.765** 로
  //   UI 표시 기준 3:1 의 절반이었다. opacity 를 `color:var(--tx-3)`(4.910/5.499)로 바꿨다.
  //   ⚠**「미검증」이라 적어 두는 것으로는 아무도 안 잰다.** 목록에 남기려면 수를 적어라.
  { sel: ".hstand .rdbar::before", why: "기준선 막대 · 글자 없음" },
  { sel: ".pswing i", why: "막대 · 글자 없음" },
  { sel: "table.stand .dif i", why: "방향 도형 · 글자 없음" },
  { sel: ".cardlink:active::after", why: "누름 덤개 · .06 · 글자 없음" },
  /**
   * ⚠**이 시험이 실제로 결함을 잡았다**(2026-08-28). 스플릿 표의 얇은 행을 `.55` 로 흐리게 뒀는데
   * 라이트에서 합성 대비가 **4.00 으로 기준 4.5 미달**이었다.
   * ⚠**다크는 5.02 로 통과**라 **한쪽만 재면 못 잡는다** — 두 테마를 다 재야 한다.
   * `.65` 로 올려 **라이트 5.56 · 다크 6.45**.
   */
  { sel: ".spl tr.thin td", why: "얇은 표본의 숫자 · .65 · 실측 5.56(라이트)/6.45(다크) · 기준 4.5 통과" },
];

test("⚠opacity 를 새로 얹으면 여기서 먼저 운다 — 「그 서브트리에 글자가 있는가」를 손으로 재게 한다", () => {
  const found: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*opacity:\s*0?\.\d/.test(m[2] ?? "")) continue;
    // 선택자 앞에 붙은 주석을 떼고, 마지막 선택자만 본다(쉼표로 묶인 경우)
    const sel = (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ");
    found.push(sel);
  }
  // ⚠**공회전 방지** — 규칙이 통째로 사라지면 이 시험은 아무것도 재지 않는다
  assert.ok(found.length >= 10, `opacity 규칙이 ${found.length}건뿐이다 — 이 시험이 공회전한다`);

  const allow = OPACITY_ALLOWED.map((x) => x.sel);
  const unknown = found.filter((sel) => !allow.some((a) => sel.endsWith(a) || sel === a));
  assert.deepEqual(
    unknown,
    [],
    `opacity 를 쓰는 새 규칙이 있다. **그 서브트리에 글자가 있는지 재고** OPACITY_ALLOWED 에 이유와 함께 넣어라: ${unknown.join(" / ")}`,
  );
});

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
/** ⚠주석 안의 예시가 규칙으로 잡히면 이 시험이 헛돈다 */
const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
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
