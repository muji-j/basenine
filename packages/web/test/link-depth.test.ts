/**
 * **홈에서 선수 성적까지 3클릭 이내인가** (CLAUDE.md §0-1).
 *
 * ⚠**규약의 판정 기준인데 한 번도 안 쟀다**(2026-08-31 에 처음). 제품의 가치 명제가
 * 「설치·계정·설정 없이 URL 만으로 핵심 정보에 도달」인데, **그것을 보는 장치가 0개였다.**
 * 화면을 늘리거나 내비 항목을 줄이면 **조용히 4클릭이 되고, 아무것도 실패하지 않는다** —
 * 깨진 링크와 달리 **아무 데도 안 걸리기 때문**이다.
 *
 * ⚠**링크만 센다.** 검색칸은 타이핑이라 클릭이 아니고, **JS 가 꺼져도 닿아야 한다**(§0-1).
 *
 * 첫 실측(2026-08-31 · 9시즌 dist): 전체 **9,370장 미도달 0** ·
 * 선수 페이지 **6,207장 전부 3클릭 이내**(현행 1~2 · 과거 시즌 2~3).
 * ⚠**과거 시즌이 3에 딱 걸린다**(시즌 전환 한 번이 더 든다) — 여유가 없다는 뜻이므로
 * 내비를 건드릴 때 **이 시험이 먼저 붉어진다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickDepthLazy, tooDeepIn } from "../src/link-check.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

/**
 * ⚠**경로만 모은다. 링크는 안 들고 있는다**(2026-08-31 · CI 에서 **OOM 으로 죽었다**).
 * 배포물 9,370장의 링크 참조는 **2,651,860개 · 문자 5,330만자**다 —
 * 문자열로 들고 있으면 수백 MB 이고, CI 의 기본 힙에서 `JavaScript heap out of memory` 가 난다.
 * ⚠**이 저장소가 이미 적어 둔 함정을 다시 밟았다** — 빌드도 같은 이유로
 * 「본문을 버리고 색인만 남기게」 고쳐진 이력이 있다.
 */
function listPages(dir = DIST, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === "" ? e.name : `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...listPages(join(dir, e.name), rel));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

const paths = existsSync(DIST) ? listPages() : [];
const pageSet = new Set(paths);
/**
 * ⚠**필요한 화면만 그때 읽고 버린다.** BFS 는 화면마다 최대 한 번만 읽으므로
 * 읽는 횟수는 전부 들고 있을 때와 같고, **보존량만 O(참조) → O(화면)** 이 된다.
 */
const refsOf = (p: string): string[] =>
  [...readFileSync(join(DIST, p), "utf8").matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1] ?? "");

/** ⚠**한 번만 걷는다** — 시험마다 다시 걸으면 9,370장을 세 번 훑는다 */
const depth = paths.length === 0 ? new Map<string, number>() : clickDepthLazy(pageSet, refsOf);
const deepPlayers = tooDeepIn(paths, depth);

test("⚠홈에서 모든 선수 페이지까지 3클릭 이내다 (§0-1)", { skip: paths.length === 0 ? "dist 없음" : false }, () => {
  const deep = deepPlayers;
  const players = paths.filter((p) => /(^|\/)players\/[^/]+\.html$/.test(p)).length;
  // ⚠**공회전 방지** — 선수 페이지를 못 찾으면 이 시험은 언제나 초록이다
  assert.ok(players > 500, `선수 페이지를 ${players}장밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(
    deep.map((d) => `${d.path}=${d.clicks ?? "도달 불가"}`),
    [],
    `${deep.length}장이 3클릭을 넘는다 / 선수 페이지 ${players}장`,
  );
});

/**
 * ⚠**「닿기는 하는가」와 「몇 번에 닿는가」는 다른 질문이다.** 링크 검사는 앞의 것도 안 본다 —
 * 어떤 화면도 안 가리키는 페이지는 **깨진 링크가 0개인 채로 존재만 한다.**
 */
test("⚠홈에서 못 닿는 화면이 없다 — 아무도 안 가리키는 페이지는 없는 것과 같다", {
  skip: paths.length === 0 ? "dist 없음" : false,
}, () => {

  const orphan = paths.filter((p) => !depth.has(p));
  assert.ok(paths.length > 1000, `화면을 ${paths.length}장밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(orphan.slice(0, 10), [], `홈에서 못 닿는 화면 ${orphan.length}장`);
});

/**
 * ⚠**여유가 얼마나 남았는지를 말한다.** 지금 과거 시즌이 3클릭으로 **상한에 딱 걸려 있다** —
 * 그 사실을 수치로 남겨야 다음 사람이 「한 단계 더 넣어도 되겠지」를 안 한다.
 */
test("현행 시즌 선수는 2클릭 이내다 — 과거 시즌만 3클릭을 쓴다", {
  skip: paths.length === 0 ? "dist 없음" : false,
}, () => {

  const worst = paths
    .filter((p) => /^players\/[^/]+\.html$/.test(p))
    .map((p) => depth.get(p) ?? 99);
  assert.ok(worst.length > 300, `현행 시즌 선수를 ${worst.length}장밖에 못 찾았다`);
  assert.ok(Math.max(...worst) <= 2, `현행 시즌 선수가 ${Math.max(...worst)}클릭이다 — 과거 시즌의 여유가 사라진다`);
});
