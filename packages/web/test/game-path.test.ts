/**
 * **경기 페이지로 가는 경로는 한 벌이다.**
 *
 * ⚠`gameSlug()` 의 주석이 「**규칙을 한 곳에만 둔다**(M1의 정신). 링크를 만드는 쪽과 파일을 쓰는 쪽이
 * 따로 계산하면 언젠가 어긋나고, 그때 생기는 것은 오류가 아니라 **404**다」라고 적고 있었다.
 * **그런데 슬러그만 한 벌이었고 그 한 단계 위(경로)는 다섯 벌이었다**(2026-08-26):
 * `calendar.ts` · `player-page.ts` · `postseason-page.ts` · `today-page.ts` · `site.ts` 가
 * 각자 `games/${slug}.html` 을 조립했고, 파일을 쓰는 `site.ts` 도 그중 하나였다.
 * **같은 병이 한 층 위에서 반복된 모양**이고, 어긋났을 때 생기는 것도 같다.
 *
 * ## 왜 지금 모았는가
 *
 * Pages 파일 상한(20,000) 때문에 **경기 페이지를 날짜 페이지로 옮길** 예정이다 —
 * 경기 **7,502장**이 배포물의 **48.6%** 이고, 남은 여유가 **2.6시즌**뿐이다.
 * 경로가 한 벌이면 그 변경은 **여기 한 줄**이 된다.
 *
 * ⚠**모으는 것만으로는 화면이 1바이트도 바뀌면 안 된다.** 실측으로 확인했다 —
 * 2026 시즌 재빌드 **1,500장 · 내용이 다른 파일 0건 · 늘거나 준 파일 0건**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gamePath, gameSlug } from "../src/game-page.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("경로는 슬러그 위에 얹힌다", () => {
  assert.equal(gamePath("2026/0814/s-db-17"), "games/2026-0814-s-db-17.html");
  assert.equal(gameSlug("2026/0814/s-db-17"), "2026-0814-s-db-17");
});

/** ⚠**이미 슬러그가 된 값을 넣어도 같다** — 호출부가 둘을 섞어 넘긴다 */
test("⚠슬러그를 두 번 걸어도 같은 값이다 — 호출부가 둘을 섞어 넘긴다", () => {
  const once = gamePath("2026/0814/s-db-17");
  assert.equal(gamePath(gameSlug("2026/0814/s-db-17")), once);
});

/**
 * ⚠**이것이 고친 대상이다.** 새 호출부가 경로를 다시 조립하면 여기서 먼저 운다.
 * `gamePath` 자신은 당연히 예외다.
 */
test("⚠경로를 손으로 조립하는 곳이 없다 — 어긋나면 조용한 404 다", () => {
  const bad: string[] = [];
  for (const f of readdirSync(SRC).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(SRC, f), "utf8");
    // 주석 안의 설명은 대상이 아니다
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(/`?games\/\$\{[^}]*\}\.html/g)) {
      if (f === "game-page.ts") continue; // gamePath 본체
      bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    "경기 경로를 손으로 조립한 곳이 있다 — `gamePath()` 를 써라.\n" +
      "⚠한 곳만 어긋나면 **오류가 아니라 404** 가 나고, 그건 조용하다.",
  );
});

/** ⚠**본체가 사라지면 위 시험이 공회전한다** — 그것도 막는다 */
test("⚠gamePath 본체는 game-page.ts 에 하나뿐이다", () => {
  const src = readFileSync(join(SRC, "game-page.ts"), "utf8");
  const hits = [...src.matchAll(/`games\/\$\{[^}]*\}\.html`/g)];
  assert.equal(hits.length, 1, `game-page.ts 안에 경로 조립이 ${hits.length}개다 — 한 벌이어야 한다`);
});
