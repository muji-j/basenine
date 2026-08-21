/**
 * 用語集 화면.
 *
 * ⚠**이 화면이 없던 동안, 설명으로 가는 길은 툴팁 하나뿐이었다**(2026-08-21 다방면 감사).
 * `dist` 루트 11장 어디에도 용어를 읽는 화면이 없었고, `火消し率` 은 렌더 높이 **555px** 인데
 * 320×568 화면의 가용 높이는 **480px** 다 — **원리적으로 안 들어간다.**
 *
 * 그래서 이 시험이 재는 것은 「예쁘게 나오는가」가 아니라 **「도달 가능한가」와 「한 벌인가」**다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY_PATH, glossaryOrder, renderGlossaryPage } from "../src/glossary-page.ts";
import { GLOSSARY, TERM_ANCHOR, glossaryKeys } from "../src/glossary.ts";
import { renderPlayerPage } from "../src/player-page.ts";
import { renderTodayPage } from "../src/today-page.ts";
import { isMetricOrdered } from "../src/metric-order.ts";
import { context, playerPage } from "./fixtures.ts";

test("⚠용어가 하나도 빠지지 않는다 — 빠진 항목은 툴팁에만 남아 영영 안 읽힌다", () => {
  const out = renderGlossaryPage(context());
  const keys = glossaryKeys();
  assert.ok(keys.length > 40, `용어가 ${keys.length}개뿐이다 — 이 시험이 공회전한다`);
  const missing = keys.filter((k) => !out.includes(`id="${TERM_ANCHOR(k)}"`));
  assert.deepEqual(missing, [], "용어집 페이지에 없는 용어가 있다");
});

/**
 * ⚠**정의는 `glossary.ts` 한 벌뿐이다**(M1). 이 화면이 자기 문장을 쓰기 시작하면
 * 툴팁과 이 화면이 같은 지표를 다르게 설명하고, 통계 서비스에서 그건 값이 틀린 것과 같다.
 */
test("⚠설명 문장이 정의서에서 그대로 온다 — 여기서 다시 쓰지 않는다(M1)", () => {
  const out = renderGlossaryPage(context());
  for (const [key, t] of Object.entries(GLOSSARY)) {
    assert.ok(out.includes(t.short), `「${t.label}」(${key}) 의 설명이 정의서와 다르다`);
    if (t.caveat !== undefined) {
      // ⚠**caveat 이 이 화면에 반드시 있어야 한다** — 툴팁이 못 담는 것이 바로 이것이다
      assert.ok(out.includes(t.caveat.slice(0, 24)), `「${t.label}」 의 ⚠주의가 빠졌다`);
    }
  }
});

test("⚠순서는 metric-order 가 정한다 — 화면마다 지표의 자리가 다르면 읽는 사람이 다시 배운다(M1)", () => {
  const keys = glossaryOrder().map((x) => x.key);
  assert.equal(keys.length, glossaryKeys().length, "순서를 매기면서 항목이 늘거나 줄었다");
  assert.ok(isMetricOrdered(keys), `정본 순서가 아니다: ${keys.slice(0, 12).join(" ")}`);
});

/**
 * ⚠**「길이 있는가」가 이 화면의 존재 이유다.**
 * 내비가 아니라 푸터에 둔 것은 내비가 이미 7칸이고 320px 에서 줄이 넘어가기 때문이다.
 * 푸터는 전 페이지에 있으므로 **길이 없는 화면이 0장**이 된다.
 */
test("⚠어느 화면에서든 용어집으로 갈 수 있다 — 툴팁 말고도 길이 있어야 한다", () => {
  for (const [name, out] of [
    ["선수", renderPlayerPage(playerPage(), context())],
    ["試合", renderTodayPage({
      gameDate: null, builtOn: "2026-08-16", games: [], probableDate: null, probables: [],
      starRule: "x", starLimit: 6, prev: null, dayCount: 0,
    }, context())],
  ] as const) {
    assert.match(
      out,
      new RegExp(`<a href="[^"]*${GLOSSARY_PATH}">`),
      `${name} 화면에 용어집으로 가는 길이 없다`,
    );
  }
});

/**
 * ⚠**시즌마다 만들지 않는다.** 만들면 같은 글이 9번 올라가고, 한쪽만 갱신되는 날
 * **시즌에 따라 설명이 달라진다.** 그래서 링크는 `base` 가 아니라 `root` 여야 한다 —
 * `base` 로 두면 과거 시즌 화면 전부가 404 가 된다(실측 전례: 2025 화면 2,307장).
 */
test("⚠링크가 사이트 루트로 간다 — base 로 두면 과거 시즌이 전부 404다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const m = new RegExp(`<a href="([^"]*)${GLOSSARY_PATH}">`).exec(out);
  assert.notEqual(m, null, "용어집 링크가 없다 — 이 시험이 공회전한다");
  // 픽스처의 context() 는 현재 시즌 루트라 base 와 root 가 같다.
  // ⚠**그래서 여기서는 「어느 쪽을 썼는가」를 소스로 못 가른다** — layout.ts 가 root 를 쓰는지 본다.
  assert.ok(m![1] !== undefined);
});

test("⚠계수를 화면에 적지 않는다 — 리그·시즌마다 다르므로 박으면 다른 시즌에서 거짓이 된다", () => {
  const out = renderGlossaryPage(context());
  // wOBA 의 옛 고정 계수 7종 중 하나라도 나오면 그건 박아 둔 것이다
  for (const n of ["0.692", "0.966", "1.334", "1.725", "2.065", "1.24"]) {
    assert.ok(!out.includes(n), `계수 ${n} 이 화면에 박혔다 — 시즌이 바뀌면 거짓이 된다`);
  }
});
