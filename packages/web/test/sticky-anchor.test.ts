/**
 * **고정 바가 앵커를 가리지 않는가** — 브라우저 없이.
 *
 * `--topbar` 를 sticky 오프셋으로 읽는 바가 **둘**이다(`.rail` · `.pickbar`).
 * ⚠**~~셋(`.rail` · `.hjump` · `.pickbar`)~~ 은 낡았다**(2026-09-08 · 2f).
 *   목차가 줄바꿈 + 접기로 바뀌면서 높이가 **43.3 ~ 122.5px** 로 움직이게 됐고,
 *   그런 바에는 정직한 상수가 없어 **고정을 걷었다**(assets.ts 의 .hjbar 문단).
 *   그래서 사다리 규칙도 둘에서 **하나**(`.rail`)로 줄었다.
 * 앵커로 뛰면 그 바 뒤에 대상이 숨으므로 `scroll-padding-top` 사다리가 그만큼을 비워 줘야 한다.
 * ⚠**그 사다리에 `.pickbar` 만 없다**(2026-08-25 · 감사 P3 #32).
 *
 * ## ⚠그런데 값을 박지 않기로 했다
 *
 * `.pickbar` 는 `flex-wrap:wrap` 이라 **높이가 고정이 아니다.** 여기에 상수를 박으면
 * 접히는 폭에서 그 값이 거짓이 된다 — `--topbar` 가 한때 어긋났던 병(`topbar-geometry.test.ts`
 * 머리말 · 폭 스윕 151점 중 **72점**에서 탭줄이 바 밖으로 샜다)을 그대로 되풀이하는 것이다.
 * **효과가 0 인데 언젠가 틀릴 수 있는 규칙**을 넣는 것보다, **효과가 0 이라는 사실을 지키는 편**이 낫다.
 *
 * ## 그 「0」은 실측이다
 *
 * `.pickbar` 를 쓰는 페이지는 **9장**(시즌별 `matchup.html` 하나씩 · dist 15,341장 중)이고,
 * 그 안의 같은 페이지 앵커는 `#main` **하나뿐**이며 그것은 픽바보다 **앞**에 있다.
 * 아래 두 시험이 그 상태를 붙든다 — 누가 픽바 아래에 앵커를 만들면 붉어지고,
 * 그때 비로소 사다리를 늘릴 근거가 생긴다.
 *
 * ⚠**한 축은 여기서 계속 지키지 않는다**: 다른 페이지에서 `matchup.html#…` 로 걸어 들어오는
 * **교차 페이지 딥링크**. 2026-08-25 에 dist 전장 훑어 **0건**이었지만, 매번 15,341장을 여는 대신
 * 그날의 실측으로 남긴다. 다시 재려면:
 * `grep -roh 'href="[^"]*matchup\.html#[^"]*"' dist --include=*.html`
 * ⚠**「0건」이지 「안 쟀음」이 아니다**(작업규칙 7). 대신 **계속 지켜지지는 않는다.**
 *
 * ⚠`scrollIntoView` 경로(`revealHash`)는 `data-panelgroup` 조상이 있어야 도는데
 * matchup 에는 그 계통이 없다 — 그래서 JS 로도 픽바 아래로 못 뛴다(실측).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CSS } from "../src/assets.ts";

/** 주석 안의 예시가 규칙으로 잡히면 시험이 헛돈다 */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** `--topbar` 를 sticky 오프셋으로 읽는 선택자들 */
function stickyAtTopbar(): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2]!;
    if (!body.includes("position:sticky")) continue;
    if (!/top:\s*var\(--topbar\)/.test(body)) continue;
    for (const sel of m[1]!.split(",")) out.add(sel.trim().split(/\s+/).pop()!);
  }
  return out;
}

/** `scroll-padding-top` 사다리가 `:has()` 로 덮는 선택자들 */
function ladderCovers(): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/html(?::root)?:has\(([^)]+)\)\s*\{([^{}]*)\}/g)) {
    if (m[2]!.includes("scroll-padding-top")) out.add(m[1]!.trim());
  }
  return out;
}

test("⚠집합을 뽑는 방식이 헛돌지 않는다 — 아래 두 시험이 전부 여기에 얹혀 있다", () => {
  const bars = stickyAtTopbar();
  const ladder = ladderCovers();
  // ⚠**분모를 실제 수에 맞춘다**(2026-09-08 · 2f 에서 .hjbar 가 고정을 버렸다).
  //   예전 문턱(바 3 · 사다리 2)은 .hjump 가 sticky 이던 시절의 수다.
  //   ⚠문턱을 낮추는 것이 검사를 약하게 만들지 않는다 — 이 시험의 일은
  //   **정규식이 아무것도 못 잡는 상태**를 잡는 것이고, 새 바가 생기면 아래 시험이 잡는다.
  assert.ok(bars.size >= 2, `--topbar 에 붙는 고정 바를 ${bars.size}개밖에 못 찾았다 — 정규식이 헛돈다`);
  assert.ok(ladder.size >= 1, `사다리 규칙을 ${ladder.size}개밖에 못 찾았다 — 정규식이 헛돈다`);
  assert.ok(bars.has(".rail"), `.rail 을 못 찾았다: ${[...bars].join(" ")}`);
  assert.ok(bars.has(".pickbar"), `.pickbar 를 못 찾았다: ${[...bars].join(" ")}`);
  console.log(`  · 고정 바 ${bars.size}개 [${[...bars].sort().join(" ")}] / 사다리 ${ladder.size}개 [${[...ladder].sort().join(" ")}]`);
});

/**
 * ⚠**「빠진 것이 정확히 `.pickbar` 하나」를 못 박는다.**
 * 새 고정 바를 만들고 사다리를 안 늘리면 여기서 잡힌다 —
 * 그때는 **그 바 아래에 앵커가 있는가**를 재고, 있으면 사다리를 늘려라.
 */
test("⚠scroll-padding-top 사다리에서 빠진 고정 바는 .pickbar 하나뿐이다", () => {
  const uncovered = [...stickyAtTopbar()].filter((s) => !ladderCovers().has(s)).sort();
  assert.deepEqual(
    uncovered,
    [".pickbar"],
    "사다리에서 빠진 고정 바가 달라졌다.\n" +
      "⚠새 바를 넣었다면 **그 바 아래에 앵커 대상이 있는지 먼저 재라** — 있으면 사다리를 늘리고,\n" +
      "  없으면 이 목록과 아래 시험의 대상에 그 바를 더해라. **상수를 짐작해서 넣지 마라.**",
  );
});

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");
const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/** 시즌 디렉터리의 `matchup.html` + 루트의 것 */
function pickbarPages(): string[] {
  if (!existsSync(DIST)) return [];
  const dirs = ["", ...readdirSync(DIST, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name)).map((e) => e.name)];
  return dirs.map((d) => join(DIST, d, "matchup.html")).filter((f) => existsSync(f));
}

test("⚠.pickbar 아래로 떨어지는 앵커가 없다 — 있으면 픽바가 그것을 가린다", () => {
  const pages = pickbarPages();
  if (pages.length === 0) {
    console.log("  · dist 없음 — 건너뜀(BB_REQUIRE_DIST=1 이면 실패한다)");
    return;
  }
  let checked = 0;
  const below: string[] = [];
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    const at = html.indexOf('class="pickbar"');
    if (at < 0) continue;
    checked += 1;
    const ids = new Map<string, number>();
    for (const m of html.matchAll(/ id="([^"]+)"/g)) ids.set(m[1]!, m.index);
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      const pos = ids.get(m[1]!);
      if (pos !== undefined && pos > at) below.push(`${file} → #${m[1]!}`);
    }
  }
  assert.ok(checked > 0, "픽바가 든 페이지를 한 장도 못 열었다 — 이 시험이 공회전한다");
  assert.deepEqual(
    below,
    [],
    "픽바 아래에 앵커 대상이 생겼다 — 뛰면 픽바 뒤에 숨는다.\n" +
      "⚠고치려면 `html:has(.pickbar){scroll-padding-top:...}` 를 더해야 하는데,\n" +
      "  **픽바는 `flex-wrap:wrap` 이라 높이가 고정이 아니다.** 상수를 박기 전에\n" +
      "  `tools/measure-topbar.ts` 처럼 폭을 훑어 실측하고, 접히는 구간을 반드시 포함시켜라.",
  );
  console.log(`  · 픽바 페이지 ${checked}장 / 픽바 아래 앵커 ${below.length}건`);
});
