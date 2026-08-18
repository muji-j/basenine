/**
 * **여는 태그 안이 깨지지 않았는가.**
 *
 * ⚠**HTML 주석은 마크업 수준에서만 주석이다.** `<div ... <!-- 설명 --> data-x="1">` 처럼
 * 태그 **안**에 쓰면 파서가 `-->` 의 `>` 를 태그의 끝으로 읽고, 그 뒤의 속성이 통째로
 * **화면에 글자로 나온다.** 2026-08-18 에 실제로 났다 — 対戦 탭에
 * `data-thinfield="pa" data-thinmin="10" …` 이 본문으로 렌더됐다.
 *
 * ⚠**타입도 린트도 이걸 못 잡는다.** 문자열 안의 일이라 컴파일러에게는 보이지 않고,
 * 링크 검사도 통과한다(링크는 멀쩡하니까). **산출물을 직접 보는 수밖에 없다.**
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
 * 화면 몇 장이면 충분하다 — 이 결함은 **부품**에서 나므로 한 장에 나오면 전부에 나온다.
 *
 * ⚠**선수 페이지를 반드시 넣는다.** 처음에 최상위 화면만 골랐더니 **시험이 통과했다** —
 * 정작 깨진 것은 선수 페이지의 対戦成績 표였다(実測 60/60장). 부품이 어디서 쓰이는지
 * 모른 채 표본을 고르면, 있는 결함을 못 보고 「검사했다」고 믿게 된다.
 */
const pages = existsSync(DIST)
  ? [
    "matchup.html", "compare.html", "ranking.html", "index.html", "players.html",
    ...readdirSync(join(DIST, "players")).slice(0, 5).map((f) => join("players", f)),
  ].filter((f) => existsSync(join(DIST, f)))
  : [];

test("⚠여는 태그 안에 주석이 없다 — 있으면 뒤의 속성이 본문으로 새어 나온다", {
  skip: pages.length === 0 ? "dist 없음" : false,
}, () => {
  for (const f of pages) {
    const html = readFileSync(join(DIST, f), "utf8");
    /**
     * `<태그 … <!--` 를 찾는다. 태그 이름 뒤부터 `>` 를 만나기 전에 `<!--` 가 나오면 그것이다.
     * ⚠`>` 가 속성값 안에 있을 수 있으므로 따옴표 안은 건너뛴다.
     */
    const bad: string[] = [];
    for (const m of html.matchAll(/<[a-zA-Z][^>]*?<!--/g)) {
      bad.push(m[0].slice(0, 70));
    }
    assert.equal(bad.length, 0, `${f}: 여는 태그 안에 주석이 있다 — ${bad.slice(0, 2).join(" / ")}`);
  }
});

/**
 * ⚠**속성 문자열이 본문에 나오지 않는가.**
 * 위 검사가 원인을 잡는다면 이쪽은 **증상**을 잡는다 — 다른 경로로 같은 일이 나도 걸린다.
 */
test("⚠data-* 속성이 화면에 글자로 나오지 않는다", {
  skip: pages.length === 0 ? "dist 없음" : false,
}, () => {
  for (const f of pages) {
    const html = readFileSync(join(DIST, f), "utf8");
    // 태그를 지운 뒤에도 `data-…="…"` 가 남아 있으면 그건 본문에 새어 나온 것이다
    const text = html.replace(/<[^>]*>/g, " ");
    const leaked = [...text.matchAll(/data-[a-z]+="[^"]*"/g)].map((m) => m[0]);
    assert.equal(leaked.length, 0, `${f}: 속성이 본문에 보인다 — ${leaked.slice(0, 3).join(" ")}`);
  }
});

/**
 * ⚠**CSP `script-src 'self'` 를 지키는 회귀 감시가 하나도 없었다**(2026-08-18 감사 P2).
 *
 * 「인라인 실행 스크립트 0개」는 **1회 실측**이었고, 다시 들어와도 빌드·시험·배포가 전부 통과했다.
 * 인라인 스크립트가 하나 생기면 두 갈래로 나쁘다:
 *  · CSP 가 그것을 막아 **그 화면의 기능이 조용히 죽거나**,
 *  · 막으려고 `unsafe-inline` 을 여는 순간 **CSP 가 있으나 마나가 된다.**
 * ⚠**`type="application/json"` 은 실행되지 않는다** — 그건 데이터 블록이라 허용이다.
 *   그래서 `script-src 'self'` 로도 부트 데이터를 실을 수 있다(그 설계의 근거다).
 */
const scriptPages = existsSync(DIST)
  ? [
    "index.html", "ranking.html", "matchup.html", "compare.html", "starters.html",
    ...readdirSync(join(DIST, "players")).slice(0, 3).map((f) => join("players", f)),
    ...readdirSync(join(DIST, "teams")).slice(0, 2).map((f) => join("teams", f)),
  ].filter((f) => existsSync(join(DIST, f)))
  : [];

test("⚠실행되는 인라인 스크립트가 없다 — CSP 가 script-src 'self' 로 닫혀 있다", {
  skip: scriptPages.length === 0 ? "dist 없음" : false,
}, () => {
  assert.ok(scriptPages.length >= 5, `표본이 ${scriptPages.length}장뿐이다 — 이 시험이 공회전한다`);
  let checked = 0;
  for (const f of scriptPages) {
    const html = readFileSync(join(DIST, f), "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
      const attrs = m[1] ?? "";
      checked += 1;
      const external = /\ssrc="/.test(attrs);
      const dataBlock = /\stype="application\/json"/.test(attrs);
      assert.ok(
        external || dataBlock,
        `${f}: 실행되는 인라인 스크립트가 있다 — CSP 가 막는다 <script${attrs}>`,
      );
    }
    // ⚠**인라인 이벤트 핸들러도 CSP 가 막는다**(`onclick=` 등). 붙이면 그 조작이 조용히 죽는다
    const onAttr = /\son(?:click|load|error|change|input|submit|focus|blur|mouseover)=/.exec(html);
    assert.equal(onAttr, null, `${f}: 인라인 이벤트 핸들러가 있다 — ${onAttr?.[0]}`);
    assert.ok(!html.includes('href="javascript:'), `${f}: javascript: 링크가 있다`);
  }
  assert.ok(checked >= 5, `<script> 를 ${checked}개밖에 안 봤다 — 표본이 부트 블록을 안 덮는다`);
});
