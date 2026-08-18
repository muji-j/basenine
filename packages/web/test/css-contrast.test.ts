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
