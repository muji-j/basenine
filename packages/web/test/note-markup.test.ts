/**
 * **설명 한 줄(`note()`)에 생 HTML 태그를 적지 않는다.**
 *
 * ⚠`note()`/`emphasize()` 는 문자열을 **이스케이프한다**(그것이 이 함수들의 존재 이유다 —
 * 선수명·구단명이 섞여 들어와도 태그가 되지 않게 한다). 그래서 인자에 `<b>` 를 적으면
 * 굵어지는 것이 아니라 **화면에 `<b>` 라는 글자가 그대로 찍힌다.** 강조는 `**…**` 다.
 *
 * ⚠**두 번 났다.**
 * · `player-page.ts` 의 연속기록 각주 — 배포물 **3,459 / 6,207장**에 `<b>通算成績</b>` 이
 *   글자로 나갔다(2026-08-21 수정 `ecde7d9`).
 * · `log-page.ts` 의 「判断待ちの一覧」 각주 — 같은 결함인데 그 분기가 아직 안 그려져
 *   배포물에는 **0 / 15,340장**이었다. 격리가 1건이라도 생기는 날 그대로 나갔을 것이다.
 *
 * ⚠**타입도 린트도 이걸 못 잡는다** — 인자 타입이 `string` 이라 `<b>` 는 완벽하게 합법이다.
 * ⚠**산출물 검사로도 못 잡는다** — 두 번째 사례처럼 **안 그려지는 분기**는 배포물에 안 나온다.
 * 그래서 **소스를 글자로 읽는다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

/** 검사 대상 함수 — 둘 다 인자를 이스케이프한다 */
const CALLERS = ["note", "emphasize"] as const;

/** 굵게·기울임 계열. 이 중 하나라도 인자 안에 있으면 화면에 글자로 나간다 */
const TAGS = /<\/?(?:b|i|u|s|em|strong|span|br)\b[^>]*>/gi;

/**
 * 주석을 지운다.
 *
 * ⚠**안 지우면 헛돈다**: 주석에도 `note()` 와 `<b>` 가 같이 나오는 줄이 있다
 * (바로 이 결함을 설명하는 주석들이다). 지우지 않으면 「경고를 적어 둔 것」이 위반으로 잡힌다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * `이름(` 부터 짝이 맞는 `)` 까지를 잘라 낸다.
 *
 * ⚠**따옴표 안의 괄호를 세지 않는다** — 문구에 「（」가 아니라 `)` 가 들어가는 일이 실제로 있다.
 * 템플릿 리터럴은 중첩을 따라가지 않고 백틱 짝만 본다(인자 안의 백틱은 지금 0건이다).
 */
function callArgs(src: string, name: string): string[] {
  const out: string[] = [];
  const head = new RegExp("(?:^|[^A-Za-z0-9_$.])" + name + "\\(", "g");
  for (const m of src.matchAll(head)) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = "";
    const from = i;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]!;
      if (quote !== "") {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    if (depth === 0) out.push(src.slice(from, i - 1));
  }
  return out;
}

const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));

test("⚠note()/emphasize() 의 인자에 생 태그가 없다 — 있으면 화면에 태그가 글자로 찍힌다", () => {
  const bad: string[] = [];
  let calls = 0;
  for (const f of files) {
    const src = stripComments(readFileSync(join(SRC, f), "utf8"));
    for (const name of CALLERS) {
      for (const arg of callArgs(src, name)) {
        calls++;
        const hit = arg.match(TAGS);
        if (hit === null) continue;
        bad.push(`${f}: ${name}(…) 안에 ${[...new Set(hit)].join(" ")} — 강조는 별표 두 개다`);
      }
    }
  }
  // ⚠**분모를 못 박는다.** 0건을 훑고 통과하면 그건 공회전이다(작업규칙 7).
  assert.ok(calls >= 50, `note()/emphasize() 호출을 ${calls}건밖에 못 찾았다 — 이 시험이 헛돌고 있다`);
  assert.deepEqual(bad, [], bad.join(" / "));
});

/**
 * ⚠**위 시험이 진짜로 잡는가**(작업규칙 9의 뮤테이션을 시험 자체에 심는다).
 * 스캐너가 어느 날 조용히 0건을 내면 위 시험은 초록인 채로 죽는다.
 */
test("⚠스캐너가 실제로 태그를 잡는다 — 이 시험이 위 시험의 뮤테이션 검사다", () => {
  const sample = 'const x = note(\n  "⚠これは不具合の一覧ではなく<b>判断待ちの一覧</b>です。(注)" +\n  "つづき",\n);';
  const args = callArgs(stripComments(sample), "note");
  assert.equal(args.length, 1, "괄호 짝을 못 찾았다");
  assert.deepEqual([...new Set(args[0]!.match(TAGS) ?? [])], ["<b>", "</b>"]);
  // 주석 안의 같은 글자는 잡지 않는다
  assert.equal(callArgs(stripComments("/* note(\"<b>x</b>\") 라고 적지 마라 */"), "note").length, 0);
  // 이름이 겹치는 다른 호출(`footnote(`)을 잘못 잡지 않는다
  assert.equal(callArgs(stripComments('footnote("<b>x</b>")'), "note").length, 0);
});
