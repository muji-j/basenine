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
 *
 * ⚠**최상위만 보고 있었다**(2026-08-19 T7 검토 ⓑ). `readdirSync(DIST)` 는 하위 디렉터리를
 * 재귀하지 않아 **11장만** 재고 있었고, 그 바깥에 실제 결함이 두 종류 살아 있었다:
 * ⑴ 선수 페이지 6,207장에 `aria-current` 가 **하나도 없었다**(`nav:"player"` 인데 그 탭이 없다).
 * ⑵ 구단 상세는 `球団` 탭이 생기는 순간 **다른 문서를 「지금 이 문서」라고** 부르게 돼 있었다.
 * 둘 다 이 파일을 재귀시켜서 드러났다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, readSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ⚠**`cwd` 에 기대지 않는다.** 처음에 `"dist"` 라고만 적었더니
 * `packages/web` 에서 `npm test` 를 돌릴 때 **매번 조용히 skip** 됐다 —
 * 출력은 `pass 0 / fail 0 / skipped 3` 인데 종료 코드는 0이라 **「합격」으로 읽힌다.**
 * CLAUDE.md 작업규칙 8 이 경고하는 그 패턴이다(「E2E 5본이 전부 실행 불가인 채 0건=합격으로 오독」).
 * 이 파일 위치에서 저장소 루트를 거슬러 올라가 **어디서 돌려도 같은 곳을 본다.**
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

/**
 * 한 디렉터리에서 몇 장까지 열 것인가.
 *
 * ⚠**전수는 비싸다 — 실측했다**(2026-08-19): dist 는 **15,340장 · 924MB** 이고,
 * 머리만 잘라 읽어도 파일 하나를 여는 비용이 지배해 **한 바퀴에 23~34초**다.
 * 전체 시험 스위트가 49초이므로 이 한 파일이 스위트를 1.5~1.7배로 만든다.
 * ⚠**그래서 「재귀는 하되 디렉터리마다 상한」**을 둔다 — 헤더는 **렌더러 × 시즌**으로만
 * 갈리므로(데이터가 아니라) 디렉터리 45개를 전부 밟으면 그 조합은 다 밟힌다.
 * 실측 표본 **523장 / 45디렉터리**이고 1초 안에 끝난다.
 * ⚠**전수가 필요하면 `BB_FULL_SCAN=1`** — 그때는 15,340장을 전부 연다(CI·검증용).
 */
const PER_DIR = 12;
const FULL = process.env["BB_FULL_SCAN"] === "1";

/**
 * 헤더가 확실히 들어가는 크기.
 * ⚠**바이트 수다.** 문자열 위치(최대 3,130)와 다르다 — 헤더는 일본어라 글자당 3바이트다.
 * 못 찾으면 그 파일만 통째로 읽는다(조용히 건너뛰지 않는다).
 */
const HEAD_BYTES = 16384;

/** 파일 머리에서 `<header>` 까지만. 전부 읽지 않는 것이 이 시험이 감당되는 이유다 */
function headOf(file: string): string {
  const fd = openSync(file, "r");
  let prefix: string;
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    prefix = buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
  const at = prefix.indexOf("</header>");
  const text = at >= 0 ? prefix.slice(0, at + "</header>".length) : readFileSync(file, "utf8");
  return (/<header class="topbar"[\s\S]*?<\/header>/.exec(text) ?? [""])[0];
}

/** 그 화면의 탭 목록(순서 포함) */
function tabsOf(head: string): string[] {
  const nav = /<nav class="tnav"[^>]*>([\s\S]*?)<\/nav>/.exec(head);
  if (nav === null) return [];
  return [...nav[1]!.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[2]!.trim());
}

/**
 * 이 화면의 헤더가 쓰는 `aria-current` 값들.
 *
 * ⚠**두 값이 다 정당하다** — `page`(바로 이 화면) · `true`(이 구획 안이지만 다른 화면).
 * `days.html`·`starters.html`·선수 페이지가 후자다. 처음에 `page` 만 찾도록 썼더니
 * **올바른 마크업을 결함이라고 불렀다** — 시험이 좁으면 고칠 것이 없는데도 빨개진다.
 */
function currentValues(head: string): string[] {
  return [...head.matchAll(/aria-current="([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * ⚠**「dist 가 없어서 안 돌았다」가 합격으로 읽히면 안 된다**(작업규칙 8).
 * 위 주석은 `cwd` 문제만 고쳤을 뿐, **dist 자체가 없는 곳**(빌드 전 · CI)에서는
 * 여전히 3본이 조용히 skip 되고 종료 코드가 0이었다(2026-08-18 감사 P3).
 *
 * → **`BB_REQUIRE_DIST=1` 이면 던진다.** CI 는 빌드 뒤에 이 값을 켜고 시험을 돌리므로,
 *   거기서는 skip 이 불가능하다. 사람이 로컬에서 빌드 없이 돌릴 때만 skip 이 남는다.
 */
const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(
    `BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라. skip 으로 넘기면 「합격」으로 읽힌다`,
  );
}

/** dist 안의 모든 `.html` — **디렉터리별로** 모은다(상한이 디렉터리 단위라서) */
function byDirectory(dir: string, out = new Map<string, string[]>()): Map<string, string[]> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) byDirectory(p, out);
    else if (e.name.endsWith(".html")) {
      const key = relative(DIST, dir).split(sep).join("/") || ".";
      // ⚠**배열을 새로 만들지 않는다** — 한 디렉터리에 878장인 곳이 있어서 복사가 제곱이 된다
      const list = out.get(key);
      if (list === undefined) out.set(key, [p]);
      else list.push(p);
    }
  }
  return out;
}

/**
 * 검사 대상. **한 번만 읽고 세 시험이 나눠 쓴다** — 세 번 읽으면 비용이 세 배다.
 *
 * ⚠`season` 은 탭 목록을 비교하는 단위다. `他大会` 는 **그 시즌에 기록이 있을 때만** 나오므로
 * (`hasPostseason`), 시즌을 섞어 비교하면 **올바른 설계를 결함이라고 부르게 된다.**
 */
interface Screen {
  file: string;
  season: string;
  tabs: string[];
  current: string[];
  hasHeader: boolean;
}

const dirs = existsSync(DIST) ? byDirectory(DIST) : new Map<string, string[]>();
const picked = [...dirs.values()].flatMap((fs) => (FULL ? fs : fs.slice(0, PER_DIR)));
const screens: Screen[] = picked.map((f) => {
  const head = headOf(f);
  const rel = relative(DIST, f).split(sep).join("/");
  return {
    file: rel,
    // 과거 시즌은 `2025/…` 접두사를 갖는다. 없으면 현재 시즌이다
    season: /^(\d{4})\//.exec(rel)?.[1] ?? "current",
    tabs: tabsOf(head),
    current: currentValues(head),
    hasHeader: head !== "",
  };
});
/** 분모를 말한다(작업규칙 7) — 「전부 통과」가 아니라 「몇 장 중 몇 장」 */
const SCOPE = `${screens.length}장 / 디렉터리 ${dirs.size}개${FULL ? "(전수)" : `(디렉터리당 최대 ${PER_DIR}장)`}`;

/**
 * ⚠**시즌 안에서 비교한다.** `他大会` 탭만이 시즌에 따라 있고 없다 —
 * 그 하나 때문에 전 시즌을 한 덩어리로 비교하면, 포스트시즌 기록이 아직 없는 시즌이
 * 통째로 빨개진다(2026년은 실제로 그런 시기가 있었다).
 */
test("⚠모든 화면의 탭 목록이 같다 — 홈만 하나 모자라던 결함", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const withTabs = screens.filter((s) => s.tabs.length > 0);
  assert.ok(withTabs.length >= 5, `검사한 화면이 너무 적다: ${withTabs.length}(${SCOPE})`);
  const bad: string[] = [];
  const wantOf = new Map<string, { file: string; tabs: string[] }>();
  for (const s of withTabs) {
    const want = wantOf.get(s.season);
    if (want === undefined) {
      wantOf.set(s.season, { file: s.file, tabs: s.tabs });
      continue;
    }
    if (s.tabs.join("|") !== want.tabs.join("|")) {
      bad.push(`${s.file}: ${s.tabs.join("·")}  (기준 ${want.file}: ${want.tabs.join("·")})`);
    }
  }
  assert.deepEqual(bad, [], `시즌 안에서 탭 목록이 화면마다 다르다(${SCOPE})\n  ${bad.join("\n  ")}`);
});

/**
 * ⚠**시즌이 달라도 「他大会」 말고는 같아야 한다.**
 * 위 시험이 시즌별이라, 시즌 사이에서 탭이 통째로 어긋나는 것은 아무도 안 보게 된다 —
 * 과거 시즌 렌더링 경로에만 생기는 결함(`base`/`root` 계산)이 실제로 있었던 자리다.
 */
test("⚠시즌이 달라도 탭 줄기는 같다 — 다른 것은 他大会 하나뿐이다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  // ⚠**이 하나만 조건부다**(layout.ts `hasPostseason`). 늘어나면 여기도 함께 고쳐야 한다
  const OPTIONAL = new Set(["他大会"]);
  const shapes = new Map<string, string>();
  for (const s of screens) {
    if (s.tabs.length === 0) continue;
    const key = s.tabs.filter((t) => !OPTIONAL.has(t)).join("|");
    if (!shapes.has(key)) shapes.set(key, `${s.file}(${s.season})`);
  }
  assert.equal(
    shapes.size,
    1,
    `시즌에 따라 탭 줄기가 다르다(${SCOPE})\n  ${[...shapes].map(([k, f]) => `${f}: ${k}`).join("\n  ")}`,
  );
});

/**
 * ⚠**「지금 어디에 있는가」가 어느 화면에서나 보여야 한다.**
 * 홈에서는 `aria-current` 가 브랜드에 붙는데 `.brand[aria-current]` 에 **CSS 가 없어서**
 * 아무것도 선택돼 보이지 않았다. 마크업만 맞고 화면은 틀린 상태였다.
 * ⚠**재귀시키자 선수 페이지 6,207장이 여기 걸렸다**(2026-08-19) — `nav:"player"` 인데
 * 그 이름의 탭이 없어서 표시가 통째로 없었다. 최상위 11장만 보던 동안은 안 보였다.
 */
test("⚠모든 화면이 「지금 여기」를 표시한다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const bad = screens.filter((s) => s.hasHeader && s.current.length === 0).map((s) => s.file);
  assert.deepEqual(
    bad,
    [],
    `현재 위치 표시가 없는 화면 ${bad.length}장(${SCOPE}): ${bad.slice(0, 5).join(", ")}`,
  );
});

/**
 * ⚠**마크업만 맞고 화면은 비어 있을 수 있다.**
 * `days.html`·`starters.html` 이 정확히 그랬다 — `aria-current="true"` 는 붙어 있는데
 * CSS 가 `="page"` 만 스타일해서 **아무것도 선택돼 보이지 않았다**.
 * 그래서 **실제로 쓰이는 값마다 CSS 규칙이 있는지**까지 검사한다.
 */
test("⚠쓰이는 aria-current 값마다 CSS 규칙이 있다 — 보이지 않으면 표시가 아니다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const used = new Set(screens.flatMap((s) => s.current));
  assert.ok(used.size > 0, `aria-current 를 쓰는 화면이 없다(${SCOPE})`);
  const css = readFileSync(join(DIST, "assets", "site.css"), "utf8");
  const missing = [...used].filter((v) => !css.includes(`[aria-current="${v}"]`));
  assert.deepEqual(missing, [], `CSS 규칙이 없는 값: ${missing.join(", ")}(쓰이는 값: ${[...used].join(", ")})`);
});
