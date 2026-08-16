/**
 * 템플릿 리터럴 안의 백틱 — **이 프로젝트에서 10번 재발한 결함이다.**
 *
 * `assets.ts`의 CSS와 클라이언트 스크립트는 하나의 거대한 템플릿 리터럴이다.
 * 그 **안쪽 주석**에 백틱을 하나 쓰면 문자열이 거기서 끝나고, 뒤에 남은 CSS가 JS 코드로 해석된다.
 * 타입체크가 매번 잡아 주긴 하지만 메시지가 「',' expected」라 **원인을 말하지 않는다.**
 * 여기서 하는 일은 탐지가 아니라 **이름 붙이기**다.
 *
 * ⚠**모듈을 import 하지 않는다.** 깨진 모듈은 애초에 import 되지 않으므로 소스를 글자로 읽는다.
 *
 * ⚠**앞선 시도 두 개는 틀렸고 버렸다.**
 * ① 「파일 전체의 백틱이 짝수인가」 — 문자열 리터럴 안의 정상적인 백틱까지 세어 오탐이 났다.
 * ② 「주석 줄에 백틱이 있는가」 — 템플릿 **바깥**의 JSDoc까지 잡았다. 그건 아무 문제가 없다.
 * 맞는 검사는 **템플릿이 어디서 끝나는가**를 보는 것이다 — 끝나야 할 곳에서 끝나지 않으면 그게 결함이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets.ts");
const TICK = "`";

/** `open` 다음의 첫 백틱 위치. 이스케이프된 것은 건너뛴다 */
function closingTick(text: string, open: string): number {
  const from = text.indexOf(open);
  assert.notEqual(from, -1, `여는 표식을 못 찾았다: ${open}`);
  for (let i = from + open.length; i < text.length; i += 1) {
    if (text[i] === TICK && text[i - 1] !== "\\") return i;
  }
  return -1;
}

/** 그 위치가 몇 번째 줄이고, 그 줄이 주석처럼 생겼는가 */
function lineAt(text: string, at: number): { no: number; text: string; comment: boolean } {
  const before = text.slice(0, at);
  const no = before.split("\n").length;
  const line = text.slice(before.lastIndexOf("\n") + 1, text.indexOf("\n", at));
  const t = line.trim();
  return { no, text: t, comment: t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.includes("⚠") };
}

/**
 * 템플릿이 **끝나야 할 곳에서 끝나는가.**
 *
 * CSS는 스타일시트의 마지막 `}` 뒤에서, 클라이언트 스크립트는 `})();` 뒤에서 끝난다.
 * 주석 줄에서 끝났다면 그 줄의 백틱이 범인이다 — 메시지가 그 줄을 그대로 보여준다.
 */
const REGIONS: { name: string; open: string; endsWith: string }[] = [
  { name: "CSS", open: "export const CSS = " + TICK, endsWith: "}" },
  { name: "클라이언트 스크립트", open: "CLIENT_JS_TEMPLATE = " + TICK, endsWith: "})();" },
];

test("템플릿 리터럴이 주석 줄에서 끊기지 않는다 — 안쪽 주석에 백틱을 쓰지 마라", () => {
  const src = readFileSync(SRC, "utf8");
  for (const r of REGIONS) {
    const at = closingTick(src, r.open);
    assert.notEqual(at, -1, `${r.name}: 닫는 백틱이 없다 — 문자열이 파일 끝까지 열려 있다`);
    const line = lineAt(src, at);
    assert.equal(
      line.comment,
      false,
      `${r.name}가 주석 줄에서 끊겼다 (assets.ts:${line.no})\n  ${line.text}\n` +
        "  → 이 줄의 백틱이 템플릿을 닫았다. 코드 인용은 백틱 없이 적어라.",
    );
    const body = src.slice(src.indexOf(r.open) + r.open.length, at).trimEnd();
    assert.ok(
      body.endsWith(r.endsWith),
      `${r.name}가 예정된 자리에서 끝나지 않았다 — 끝: ${JSON.stringify(body.slice(-40))}`,
    );
  }
});
