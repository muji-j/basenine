/**
 * `assets.ts`를 **글자로** 읽는 검사.
 *
 * ⚠**이 파일은 일부러 `assets.ts`를 import 하지 않는다.**
 *
 * CSS와 클라이언트 스크립트는 템플릿 리터럴에 담겨 있어서, 그 안에 백틱이 하나 들어가면
 * 문자열이 거기서 끝나고 **뒤의 CSS가 TypeScript 코드로 해석된다.** 그러면 모듈을 불러올 수 없고,
 * `assets.ts`를 import 하는 테스트는 전부 **FAIL이 아니라 ERROR**로 죽는다 —
 * 「테스트 0건 실패」로 오독되는, CLAUDE.md 작업규칙 8이 경고하는 바로 그 모양이다.
 *
 * 실제로 **세 번 일어났다**(2026-08-15에만 두 번). 그래서 파싱이 필요 없는 검사를 따로 둔다.
 * 이 파일은 어떤 상황에서도 실행되고, 깨졌을 때 **몇 번째 줄인지** 말한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * ⚠**`compare.ts` 는 import 해도 된다.** 이 파일이 피하는 것은 `assets.ts` 다 —
 * 거기 백틱이 하나 들어가면 모듈을 못 불러와 이 파일까지 ERROR 로 죽기 때문이다.
 * `compare.ts` 에는 템플릿 리터럴 덩어리가 없다.
 */
import { compareShardOf } from "../src/compare.ts";

const SRC = join(import.meta.dirname, "..", "src", "assets.ts");

/** 템플릿 리터럴로 열리는 상수들. 시작 줄과 끝 줄(단독 백틱+세미콜론)로 구간을 잡는다 */
const OPENERS = ["export const CSS = ", "const CLIENT_JS_TEMPLATE = "];

interface Region {
  name: string;
  from: number;
  to: number;
  lines: string[];
}

function regions(): Region[] {
  const lines = readFileSync(SRC, "utf8").replace(/\r\n/g, "\n").split("\n");
  const out: Region[] = [];
  for (const opener of OPENERS) {
    const from = lines.findIndex((l) => l.startsWith(opener));
    assert.notEqual(from, -1, `${opener} 로 시작하는 줄이 없다 — 이 검사가 대상을 놓치고 있다`);
    const to = lines.findIndex((l, i) => i > from && l === "`;");
    assert.notEqual(to, -1, `${opener} 의 닫는 줄을 못 찾았다`);
    out.push({ name: opener.trim(), from, to, lines: lines.slice(from + 1, to) });
  }
  return out;
}

test("⚠템플릿 리터럴 안에 백틱이 없다 — 있으면 문자열이 거기서 끊긴다", () => {
  for (const r of regions()) {
    const bad = r.lines
      .map((line, i) => ({ line, no: r.from + 2 + i }))
      .filter((x) => x.line.includes("`"));
    assert.deepEqual(
      bad.map((x) => `${x.no}행: ${x.line.trim()}`),
      [],
      `${r.name} 안에 백틱이 있다. 주석에서는 백틱 대신 따옴표나 공백을 써라`,
    );
  }
});

test("구간을 실제로 잡았다 — 0줄을 검사하고 통과하면 그건 공회전이다", () => {
  for (const r of regions()) {
    assert.ok(r.lines.length > 50, `${r.name}: ${r.lines.length}줄만 잡혔다`);
  }
});

test("스크립트 안에서 </script> 를 직접 쓰지 않는다 — 인라인 삽입 시 문서가 끊긴다", () => {
  for (const r of regions()) {
    const bad = r.lines.filter((l) => l.includes("</script"));
    assert.deepEqual(bad, [], `${r.name}: </script 가 그대로 들어 있다`);
  }
});

/**
 * ⚠**샤드 규칙이 빌드와 클라이언트에 두 벌 있다** — 빌드(`compareShardOf`)는 파일을 놓고,
 * 클라이언트(`shardOf`)는 찾는다. M1이 경계하는 「같은 규칙의 두 벌 구현」이 불가피한 자리다.
 *
 * ⚠**갈리면 전 선수의 比較가 404가 된다.** 그런데 그것을 막는 자동 검사가
 * **한동안 0건이었다** — 주석에는 「여기서 글자로 확인한다」고 적혀 있었는데
 * 실제로는 백틱·길이·`&lt;/script&gt;` 세 가지만 보고 있었다(2026-08-17 이중 검토 지적).
 * **없는 안전장치를 있다고 적은 주석은 없는 것보다 나쁘다.**
 *
 * 그래서 여기서 **문자열 존재가 아니라 실행 결과를 대조한다** —
 * 클라이언트 소스에서 규칙 한 줄을 뽑아 실제로 돌리고, 빌드 쪽 함수와 같은 답이 나오는지 본다.
 */
function clientShardOf(): (id: string) => string {
  const src = readFileSync(SRC, "utf8");
  const m = /const shardOf=\(id\)=>([^;]+);/.exec(src);
  assert.notEqual(
    m,
    null,
    "클라이언트에서 shardOf 규칙을 찾지 못했다 — 사라졌거나 모양이 바뀌었다. " +
      "바꿨다면 이 검사도 함께 고쳐라(그래야 두 벌이 갈리는 것을 계속 막는다)",
  );
  return new Function("id", `return (${m![1]!});`) as (id: string) => string;
}

test("⚠샤드 규칙이 빌드와 클라이언트에서 같은 답을 낸다 — 갈리면 전 선수의 比較가 404다", () => {
  const client = clientShardOf();
  /**
   * ⚠**틀린 규칙을 골라내도록 고른 입력이다.**
   * · `01005134` 는 첫 글자 `0`·끝 글자 `4` — 「끝 글자」로 바꾸면 여기서 갈린다
   * · `A1` 은 소문자화를 넣으면 갈린다
   * · `9` 는 한 글자짜리(잘라내기 실수를 잡는다)
   */
  for (const id of ["01005134", "41045153", "61965131", "73175159", "9", "A1", "abc123"]) {
    assert.equal(client(id), compareShardOf(id), `${id} 에서 빌드와 클라이언트의 샤드가 갈렸다`);
  }
});
