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
import { CSS } from "../src/assets.ts";

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
];

for (const scope of ["light", "dark"] as const) {
  for (const mark of TEAM_MARKS) {
    test(`⚠${scope}: ${mark.sel} 는 구단 색에 기대지 않는다 — ${mark.what}`, () => {
      const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
      const rule = new RegExp(`${mark.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^{}]*)\\}`).exec(css);
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
 * ⚠**지금 남은 둘은 「고쳐야 할 것」이지 「괜찮은 것」이 아니다**(2026-08-20 · 이번 작업 범위 밖).
 * 成績の紋(레이더)의 윤곽과 꼭짓점이고, `.dia` 와 **정확히 같은 병**이다 —
 * ロッテ·オリックス의 다크에서 선이 바탕에 묻힌다. 차트라서 손대려면 dataviz 기준부터 봐야 하고,
 * 그건 이 수정의 범위가 아니다. **design-auditor 가 판정할 항목으로 남긴다.**
 * ⚠**여기 늘리지 마라.** 늘어나면 그건 같은 결함이 한 자리 더 생겼다는 뜻이다.
 */
test("⚠구단 색을 선 색(stroke)으로 쓰는 자리가 늘지 않는다", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*stroke:\s*var\(--(team|chip)[,)]/.test(m[2] ?? "")) continue;
    found.push((m[1] ?? "").trim());
  }
  assert.deepEqual(
    found.sort(),
    [".mf-dot", ".mf-shape"],
    `구단 색을 선 색으로 쓰는 자리가 바뀌었다: ${found.join(" / ")}`,
  );
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
