/**
 * **표에 이름이 붙어 있는가.**
 *
 * ⚠**낭독기에서 이름 없는 표는 그냥 「표」다.** 실측(2026-08-31 · 배포물):
 * **표 327개 중 295개에 이름이 없었다.** 순위표 한 장에만 87개가 있어서,
 * 표 단위로 이동하면 **「표」만 87번 들린다** — 어느 것이 무엇인지 알 방법이 없다.
 *
 * ⚠**화면에는 안 보이는 글자다.** 그래도 제품 언어이므로 일본어로 짓는다(§7).
 * ⚠**`caption` 이 아니라 `aria-label` 을 쓴다** — caption 은 보이는 요소라 레이아웃이 바뀐다.
 * 여기서 고치려는 것은 **낭독 경로**이지 화면이 아니다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

/**
 * ⚠**소스에서 본다** — `dist` 가 없어도 돌아야 하기 때문이다.
 * 로컬에서 건너뛰는 검사가 앞선 사고의 절반이었다(`den-units` 가 그랬다).
 */
test("⚠표를 만드는 곳마다 이름을 붙인다 — 낭독기에서 「표」로만 들리지 않게", () => {
  const bare: string[] = [];
  let total = 0;
  for (const f of readdirSync(SRC).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(SRC, f), "utf8");
    for (const m of src.matchAll(/<table\b([^>]*)>/g)) {
      // 주석 안의 예시는 세지 않는다
      const at = m.index ?? 0;
      const line = src.slice(src.lastIndexOf("\n", at) + 1, at);
      if (/^\s*\*|^\s*\/\//.test(line)) continue;
      total += 1;
      const attrs = m[1] ?? "";
      if (!/aria-label=/.test(attrs)) bare.push(`${f}: <table${attrs}>`);
    }
  }
  assert.ok(total >= 25, `표를 만드는 곳을 ${total}개밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(bare, [], `이름 없는 표 ${bare.length}개 / 전체 ${total}개`);
});

/**
 * ⚠**소스에 있다고 배포물에 있는 것은 아니다** — 값이 빈 문자열이면 이름이 없는 것과 같다.
 * ⚠**`dist` 가 있을 때만 돈다**(위 시험이 이미 로컬을 지킨다).
 */
function distPages(): string[] {
  if (!existsSync(DIST)) return [];
  const out: string[] = [];
  for (const f of readdirSync(DIST)) if (f.endsWith(".html")) out.push(f);
  for (const d of ["players", "teams", "games"]) {
    const p = join(DIST, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).filter((x) => x.endsWith(".html")).slice(0, 3)) out.push(join(d, f));
  }
  return out;
}

test("⚠배포물의 표에 실제로 이름이 실린다 — 빈 이름은 없는 것과 같다", () => {
  const pages = distPages();
  if (pages.length === 0) return; // dist 없음 — 위 시험이 이미 돈다
  let total = 0;
  const bare: string[] = [];
  for (const page of pages) {
    const html = readFileSync(join(DIST, page), "utf8");
    for (const m of html.matchAll(/<table\b([^>]*)>/g)) {
      total += 1;
      const label = /aria-label="([^"]*)"/.exec(m[1] ?? "")?.[1];
      const captioned = false; // caption 은 쓰지 않는다(위 주석)
      if ((label === undefined || label.trim() === "") && !captioned) {
        bare.push(`${page}: <table${(m[1] ?? "").slice(0, 60)}>`);
      }
    }
  }
  assert.ok(total > 50, `배포물에서 표를 ${total}개밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(bare.slice(0, 8), [], `이름 없는 표 ${bare.length}개 / 전체 ${total}개`);
});
