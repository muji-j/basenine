/**
 * **번들이 파싱되는가.**
 *
 * ⚠**이 저장소는 이 사고가 구조적으로 나기 쉽다.** `assets.ts` 는 통째로 템플릿 리터럴이라
 * 클라이언트 스크립트가 **타입체크를 받지 않는 문자열**이다 — 그 안에서 이름이 겹쳐도
 * `tsc` 는 아무 말도 하지 않는다.
 *
 * ⚠**실제로 T9 직전에 잡혔다**(2026-08-19). 작업 브리프가 `const paintFav=()=>{…}` 를
 * 넣으라고 했는데, 번들은 `(()=>{"use strict"; … })();` **하나의 IIFE** 이고
 * `function paintFav(){…}` 가 이미 그 최상위에 있다:
 *
 * ```
 *   SyntaxError: Identifier 'paintFav' has already been declared
 * ```
 *
 * **파싱 실패라 번들이 통째로 안 돈다.** 검색·테마 토글·탭·툴팁·선수 즐겨찾기·일람 좁히기가
 * **전 페이지에서 동시에** 죽는데, 화면은 서버가 그린 대로 나오므로 눈으로는
 * 「좀 이상하다」로만 보인다. 그래서 **기계가 본다.**
 *
 * ⚠**`node --check` 로 진짜 파서에게 묻는다.** 우리가 흉내낸 검사로는 문법을 다 못 안다.
 * ⚠**「빈 검사」가 되지 않게 스스로 증명한다** — 아래 두 번째 시험이 **일부러 이름을 겹쳐**
 * 같은 검사가 떨어지는 것을 확인한다. 그게 없으면 이 파일은 언제나 초록일 수 있다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_JS } from "../src/assets.ts";

/** ⚠`cwd` 에 기대지 않는다 — `packages/web` 에서 돌려도 같은 곳을 본다(topbar-consistency 와 같은 이유) */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUNDLE = join(ROOT, "dist", "assets", "site.js");

/**
 * ⚠**「dist 가 없어서 안 돌았다」가 합격으로 읽히면 안 된다**(작업규칙 8).
 * CI 는 빌드 뒤에 `BB_REQUIRE_DIST=1` 로 돌리므로 거기서는 skip 이 불가능하다.
 */
if (process.env["BB_REQUIRE_DIST"] === "1" && !existsSync(BUNDLE)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${BUNDLE} 가 없다 — 빌드 뒤에 돌려라`);
}
const HAVE_BUNDLE = existsSync(BUNDLE);

/** 스크립트 하나를 진짜 파서에 넣어 본다. 통과하면 `null`, 아니면 파서가 한 말 */
function parseError(source: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "bb-parse-"));
  const file = join(dir, "check.js");
  try {
    writeFileSync(file, source);
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
    return null;
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? e);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 번들의 IIFE **안쪽**에 한 줄을 넣는다.
 *
 * ⚠**바깥에 넣으면 이 사고를 재현하지 못한다** — 모듈 최상위의 `const paintFav` 는
 * IIFE 안의 `function paintFav` 와 겹치지 않는다. 겹치는 것은 **같은 스코프일 때뿐**이고,
 * 그게 정확히 브리프가 시키던 자리였다.
 */
const IIFE_HEAD = '(()=>{"use strict";';
function injectIntoIife(source: string, line: string): string {
  const at = source.indexOf(IIFE_HEAD);
  assert.notEqual(at, -1, `번들의 IIFE 머리를 못 찾았다 — 이 시험이 재는 자리가 사라졌다: ${IIFE_HEAD}`);
  return source.slice(0, at + IIFE_HEAD.length) + line + source.slice(at + IIFE_HEAD.length);
}

test("⚠클라이언트 번들이 파싱된다 — 이름 하나 겹치면 전 페이지의 JS 가 통째로 죽는다", () => {
  const err = parseError(CLIENT_JS);
  assert.equal(err, null, `클라이언트 번들이 파싱되지 않는다:\n${err}`);
});

/**
 * ⚠**이 검사가 실제로 무언가를 잡는지 증명한다**(작업규칙 9 · 뮤테이션).
 * 위 시험만 있으면 「`node --check` 가 아무거나 통과시키는」 경우에도 초록이다.
 * 여기서는 **T9 브리프가 시키던 그 한 줄**을 그대로 넣고 떨어지는 것을 확인한다.
 */
test("⚠같은 검사가 이름 충돌을 잡는다 — 안 잡으면 위 시험은 빈 검사다", () => {
  const err = parseError(injectIntoIife(CLIENT_JS, "const paintFav=()=>{};"));
  assert.notEqual(err, null, "IIFE 안에서 paintFav 를 다시 선언했는데 파서가 통과시켰다");
  assert.match(err ?? "", /already been declared/);
});

test(
  "⚠배포되는 파일 그대로도 파싱된다",
  { skip: HAVE_BUNDLE ? false : "dist 없음" },
  () => {
    const err = parseError(readFileSync(BUNDLE, "utf8"));
    assert.equal(err, null, `dist/assets/site.js 가 파싱되지 않는다:\n${err}`);
  },
);

/**
 * ⚠**배포되는 파일이 최애 버튼을 실제로 다루는가.**
 *
 * T7 이 구단 목록에 버튼 108개(12구단 × 9시즌)를 놓았고 각주가 이미
 * 「「ひいき球団」を選ぶと上のメニューの一番左がその球団になります」라고 **말하는데**,
 * T9 전까지 번들의 `favteam` 등장 횟수는 **0** 이었다 — 화면이 있다고 말하는 기능이 없었다.
 * ⚠**선택자 글자로 좁혀 잰다** — 번들에는 설명문이 없지만, 넓게 재는 습관이
 * 이 저장소에서 「각주에 걸려 통과」를 세 번 냈다.
 */
test(
  "⚠배포되는 파일이 최애 버튼과 내비를 잇는다 — 각주가 이미 그렇다고 말한다",
  { skip: HAVE_BUNDLE ? false : "dist 없음" },
  () => {
    const js = readFileSync(BUNDLE, "utf8");
    for (const hook of ["[data-favteam]", "[data-navteam]", "favpath", "favname"]) {
      assert.ok(js.includes(hook), `번들이 ${hook} 를 다루지 않는다 — 버튼 108개가 눌러도 죽어 있다`);
    }
  },
);
