/**
 * **헤더는 어느 화면에서나 같아야 한다.**
 *
 * ⚠**이 시험이 없어서 홈만 탭이 하나 모자랐다**(2026-08-17 유저 지적:
 * 「홈화면에 있을때랑 탭이 활성화 되어 있을때랑 헤더 디자인이 다르다」).
 * 원인은 `home-page.ts` 가 `hasPostseason` 을 레이아웃에 **넘기지 않은 것**이었다 —
 * 다른 렌더러 8곳은 전부 넘기는데 홈만 빠져서 `他大会` 탭이 통째로 사라졌다.
 * 타입은 못 잡는다(`hasPostseason?: boolean` 이 선택값이라 빠뜨려도 컴파일된다).
 *
 * ⚠**「보이는 것」을 세는 시험이다.** 렌더러마다 인자를 넘겼는지 grep 하는 것으로는
 * 부족하다 — 넘겨도 값이 false 면 같은 증상이 난다. **생성된 HTML을 센다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";

/** 그 화면의 탭 목록(순서 포함) */
function tabsOf(html: string): string[] {
  const nav = /<nav class="tnav"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  if (nav === null) return [];
  return [...nav[1]!.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[2]!.trim());
}

/**
 * 이 화면의 헤더가 쓰는 `aria-current` 값들.
 *
 * ⚠**두 값이 다 정당하다** — `page`(바로 이 화면) · `true`(이 구획 안이지만 다른 화면).
 * `days.html`·`starters.html` 이 후자다. 처음에 `page` 만 찾도록 썼더니
 * **올바른 마크업을 결함이라고 불렀다** — 시험이 좁으면 고칠 것이 없는데도 빨개진다.
 */
function currentValues(html: string): string[] {
  const head = /<header class="topbar"[\s\S]*?<\/header>/.exec(html);
  if (head === null) return [];
  return [...head[0].matchAll(/aria-current="([^"]+)"/g)].map((m) => m[1]!);
}

const pages = existsSync(DIST)
  ? readdirSync(DIST).filter((f) => f.endsWith(".html"))
  : [];

test("⚠모든 화면의 탭 목록이 같다 — 홈만 하나 모자라던 결함", { skip: pages.length === 0 ? "dist 없음" : false }, () => {
  const seen = new Map<string, string[]>();
  for (const f of pages) {
    const tabs = tabsOf(readFileSync(join(DIST, f), "utf8"));
    if (tabs.length > 0) seen.set(f, tabs);
  }
  assert.ok(seen.size >= 5, `검사한 화면이 너무 적다: ${seen.size}`);
  const [firstFile, want] = [...seen][0]!;
  const bad: string[] = [];
  for (const [f, tabs] of seen) {
    if (tabs.join("|") !== want.join("|")) bad.push(`${f}: ${tabs.join("·")}`);
  }
  assert.deepEqual(
    bad,
    [],
    `탭 목록이 화면마다 다르다(기준 ${firstFile}: ${want.join("·")})\n  ${bad.join("\n  ")}`,
  );
});

/**
 * ⚠**「지금 어디에 있는가」가 어느 화면에서나 보여야 한다.**
 * 홈에서는 `aria-current` 가 브랜드에 붙는데 `.brand[aria-current]` 에 **CSS 가 없어서**
 * 아무것도 선택돼 보이지 않았다. 마크업만 맞고 화면은 틀린 상태였다.
 */
test("⚠모든 화면이 「지금 여기」를 표시한다", { skip: pages.length === 0 ? "dist 없음" : false }, () => {
  const bad = pages.filter((f) => {
    const h = readFileSync(join(DIST, f), "utf8");
    return h.includes('<header class="topbar"') && currentValues(h).length === 0;
  });
  assert.deepEqual(bad, [], `현재 위치 표시가 없는 화면: ${bad.slice(0, 5).join(", ")}`);
});

/**
 * ⚠**마크업만 맞고 화면은 비어 있을 수 있다.**
 * `days.html`·`starters.html` 이 정확히 그랬다 — `aria-current="true"` 는 붙어 있는데
 * CSS 가 `="page"` 만 스타일해서 **아무것도 선택돼 보이지 않았다**.
 * 그래서 **실제로 쓰이는 값마다 CSS 규칙이 있는지**까지 검사한다.
 */
test("⚠쓰이는 aria-current 값마다 CSS 규칙이 있다 — 보이지 않으면 표시가 아니다", { skip: pages.length === 0 ? "dist 없음" : false }, () => {
  const used = new Set<string>();
  for (const f of pages) {
    for (const v of currentValues(readFileSync(join(DIST, f), "utf8"))) used.add(v);
  }
  assert.ok(used.size > 0, "aria-current 를 쓰는 화면이 없다");
  const css = readFileSync(join(DIST, "assets", "site.css"), "utf8");
  const missing = [...used].filter((v) => !css.includes(`[aria-current="${v}"]`));
  assert.deepEqual(missing, [], `CSS 규칙이 없는 값: ${missing.join(", ")}(쓰이는 값: ${[...used].join(", ")})`);
});
