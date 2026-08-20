/**
 * **랜드마크가 실제로 이동할 곳을 갖고 있는가.**
 *
 * ⚠`<nav>` 는 낭독기의 이동 메뉴에 오르는 랜드마크다. 안에 `<a>` 가 하나도 없으면
 * 그 메뉴는 「눌러도 아무 데도 안 가는 항목」으로 채워진다.
 * 실측(2026-08-20 감사 ⑤ · 수정 전 `dist` 15,340장): **링크 0개인 `<nav>` 가 6,395개**,
 * 그중 이름조차 없는 것이 `starters.html` 한 장에 **8개**(`.muswitch`)였고,
 * `matchup.html`·`compare.html` 은 **같은 이름 「試合」의 nav 두 개**를 갖고 있었다.
 * 전부 `<button>` 묶음이다 — ARIA 를 덧붙일 것이 아니라 `<div>` 로 되돌리는 문제였다.
 *
 * ⚠**타입도 린트도 못 잡는다** — 산출물을 직접 보는 수밖에 없다(`tag-integrity.test.ts` 와 같은 이유).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/**
 * ⚠**표본에 반드시 넣을 것**: `starters.html`(`.muswitch` 8개) · `matchup.html`·`compare.html`
 * (같은 이름의 nav 두 개) · 구단 페이지·선수 페이지(`.rail`) · `ranking.html`(`.rail` 안에 탭줄 둘).
 * 이 결함은 **부품**에서 나므로 부품이 쓰이는 화면을 고르지 않으면 있는 결함을 놓친다.
 */
const pages = existsSync(DIST)
  ? [
    "index.html", "starters.html", "matchup.html", "compare.html", "ranking.html",
    "today.html", "players.html", "teams.html", "log.html", "postseason.html",
    ...readdirSync(join(DIST, "teams")).slice(0, 3).map((f) => join("teams", f)),
    ...readdirSync(join(DIST, "players")).slice(0, 3).map((f) => join("players", f)),
  ].filter((f) => existsSync(join(DIST, f)))
  : [];

interface Nav {
  cls: string;
  label: string | null;
  links: number;
}

function navsOf(html: string): Nav[] {
  const out: Nav[] = [];
  for (const m of html.matchAll(/<nav\b([^>]*)>([^]*?)<\/nav>/g)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    out.push({
      cls: /class="([^"]*)"/.exec(attrs)?.[1] ?? "",
      label: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? null,
      links: (inner.match(/<a\b/g) ?? []).length,
    });
  }
  return out;
}

test("⚠링크가 하나도 없는 <nav> 를 만들지 않는다 — 버튼 묶음은 랜드마크가 아니다", {
  skip: pages.length === 0 ? "dist 없음" : false,
}, () => {
  const bad: string[] = [];
  for (const f of pages) {
    for (const n of navsOf(readFileSync(join(DIST, f), "utf8"))) {
      if (n.links === 0) bad.push(`${f} nav.${n.cls}（${n.label ?? "이름 없음"}）`);
    }
  }
  assert.deepEqual(bad, [], `링크 0개인 <nav>: ${bad.slice(0, 5).join(" / ")}`);
});

test("⚠<nav> 에는 이름이 있고, 한 문서 안에서 겹치지 않는다", {
  skip: pages.length === 0 ? "dist 없음" : false,
}, () => {
  const bad: string[] = [];
  for (const f of pages) {
    const seen = new Map<string, number>();
    for (const n of navsOf(readFileSync(join(DIST, f), "utf8"))) {
      if (n.label === null) bad.push(`${f} nav.${n.cls} 이름 없음`);
      else seen.set(n.label, (seen.get(n.label) ?? 0) + 1);
    }
    for (const [label, count] of seen) {
      if (count > 1) bad.push(`${f} 이름 「${label}」이 ${count}개`);
    }
  }
  assert.deepEqual(bad, [], `랜드마크 이름 문제: ${bad.slice(0, 5).join(" / ")}`);
});
