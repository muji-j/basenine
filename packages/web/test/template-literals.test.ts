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
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SRC = join(SRC_DIR, "assets.ts");
const TICK = "`";
const NL = String.fromCharCode(10);

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
  // ⚠`*,*::before` 같은 CSS 셀렉터를 주석으로 오판하지 않는다 — 틀린 메시지가 나온다
  const isComment = /^\*\s/.test(t) || t.startsWith("//") || t.startsWith("/*") || t.includes("⚠");
  return { no, text: t, comment: isComment };
}

/**
 * 템플릿이 **끝나야 할 곳에서 끝나는가.**
 *
 * 주석 줄에서 끝났다면 그 줄의 백틱이 범인이다 — 메시지가 그 줄을 그대로 보여준다.
 *
 * ⚠**「무엇으로 끝나는가」만 보면 부족하다.** CSS 구역의 끝을 「}로 끝난다」로 보면
 * CSS가 `}`로 가득하므로 사실상 아무것도 안 보는 것이 된다 — 실제로 뮤테이션 5본 중
 * 「닫는 중괄호 바로 뒤에 백틱」 1본이 살아남았다(2026-08-16 이중 검토).
 * 그래서 **닫는 백틱이 있어야 할 자리 자체**를 본다: 줄의 첫 비공백 문자이고 바로 뒤가 `;`다.
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
    // ⚠**닫는 백틱은 줄의 처음에 홀로 서고 바로 뒤에 세미콜론이 온다.**
    // 이 조건이 없으면 닫는 중괄호 바로 뒤에 붙은 백틱이 그냥 통과한다
    assert.equal(src[at - 1], "\n", `${r.name}의 닫는 백틱이 줄 처음에 있지 않다 (assets.ts:${line.no})`);
    assert.equal(src[at + 1], ";", `${r.name}의 닫는 백틱 뒤가 세미콜론이 아니다 (assets.ts:${line.no})`);
  }
});

/**
 * ⚠**구역을 헷갈려 코드를 엉뚱한 템플릿에 넣는 사고가 실제로 났다**(2026-08-16).
 * JS 한 덩어리를 CSS 구역에 꽂았는데 **타입체크는 통과했다** — 둘 다 문자열이기 때문이다.
 * `new Function(CLIENT_JS)`는 스크립트 쪽만 보므로 CSS에 들어간 JS는 아무도 못 봤다.
 *
 * 두 구역은 서로의 문법을 갖지 않는다. 그 사실을 **아주 성긴 그물**로 확인한다 —
 * 정교하게 만들면 오탐으로 죽는다. 실제로 밟은 형태만 잡으면 된다.
 */
test("CSS 구역에 스크립트가 섞이지 않는다 — 둘 다 문자열이라 타입체크가 못 본다", () => {
  const src = readFileSync(SRC, "utf8");
  const open = "export const CSS = " + TICK;
  const css = src.slice(src.indexOf(open) + open.length, closingTick(src, open));
  for (const sign of ["addEventListener(", "=>{", "querySelectorAll(", "const "]) {
    assert.ok(!css.includes(sign), `CSS 구역에 스크립트가 섞였다 — ${JSON.stringify(sign)} 이 있다`);
  }
});

test("스크립트 구역에 스타일시트가 섞이지 않는다", () => {
  const src = readFileSync(SRC, "utf8");
  const open = "CLIENT_JS_TEMPLATE = " + TICK;
  const js = src.slice(src.indexOf(open) + open.length, closingTick(src, open));
  for (const sign of ["@media ", "@keyframes "]) {
    assert.ok(!js.includes(sign), `스크립트 구역에 스타일시트가 섞였다 — ${JSON.stringify(sign)} 이 있다`);
  }
});

/**
 * ⚠**역슬래시 하나가 조용히 사라진다 — 이 저장소가 「반복해 데인 자리」라고 스스로 적어 둔 것인데
 * 세는 검사가 없었다**(2026-08-20 최종 검토 ⑥).
 *
 * 클라이언트 스크립트는 템플릿 리터럴 **안**에 있으므로, 거기 쓴 `\d` 는 JS 엔진이
 * **이스케이프로 먹어 `d` 로 만든다.** 그래서 `/\d/` 라고 쓰면 브라우저에는 `/d/` 가 나가
 * **숫자 대신 글자 d 를 찾는 정규식**이 된다 — 타입체크도 통과하고 예외도 안 난다.
 * ⚠`\n` 도 마찬가지로 위험하다(여긴 더 나쁘다) — 실제 줄바꿈으로 치환되어 **문자열 리터럴 안에서
 * 줄이 끊기고**, 나가는 스크립트가 문법 오류가 된다.
 * 즉 이 구역에서 **홑 역슬래시 + 영문자는 예외 없이 결함**이다. 허용 목록이 없다.
 *
 * ⚠**`\\` 는 결함이 아니다** — 그게 정답이다. 실측(2026-08-20)으로 이미 그렇게 쓰고 있다:
 * `assets.ts:2282` 의 `/\\+/g` 가 브라우저에는 `/\+/g` 로 나간다(쿼리의 `+` 를 공백으로 되돌리는 자리).
 * 그래서 검사는 **`\\` 를 한 쌍으로 소비하고 남은 홑 역슬래시만** 본다 — 정답을 결함이라고 부르면
 * 다음 사람이 이 시험을 지운다.
 *
 * 실측(2026-08-20 · 현 위반 0):
 * ```
 * CLIENT_JS_TEMPLATE 본문  62,302자 · 역따옴표 0 · 역슬래시 2(둘 다 `\\+` 의 것) · 홑 `\`+영문자 0
 * CSS 본문                 93,504자 · 역슬래시 0
 * ```
 * ⚠**CSS 구역은 일부러 안 본다** — CSS 는 `content:"\A"` 처럼 영문자 이스케이프가 정당하다.
 * 넓히면 오탐으로 죽는다(이 파일의 다른 검사와 같은 방침).
 * ⚠**뮤테이션 확인(2026-08-20 실측)**: 스크립트 구역에 `\d` 를 하나 넣으면 이 시험만 떨어진다.
 */
test("⚠스크립트 구역에 홑 역슬래시 이스케이프를 쓰지 않는다 — `\\d` 가 조용히 `d` 가 된다", () => {
  const src = readFileSync(SRC, "utf8");
  const open = "CLIENT_JS_TEMPLATE = " + TICK;
  const from = src.indexOf(open) + open.length;
  const js = src.slice(from, closingTick(src, open));
  const offenders: string[] = [];
  for (let i = 0; i < js.length; i += 1) {
    if (js[i] !== "\\") continue;
    const next = js[i + 1] ?? "";
    // `\\` 는 한 쌍으로 소비한다 — 그 뒤의 글자는 이스케이프가 아니라 평범한 글자다
    if (/[A-Za-z]/.test(next)) {
      const no = src.slice(0, from + i).split(NL).length;
      offenders.push(`assets.ts:${no}  ${JSON.stringify("\\" + next)}  ${js.slice(Math.max(0, i - 30), i + 20).trim()}`);
    }
    i += 1;
  }
  assert.deepEqual(
    offenders,
    [],
    `템플릿이 이 역슬래시를 먹어 버린다 — 브라우저에는 역슬래시 없이 나간다:${NL}${offenders.join(NL)}${NL}` +
      "  → 역슬래시를 정말 내보내려면 두 번 쓴다(assets.ts:2282 의 `/\\\\+/g` 가 그 예다).",
  );
});

/**
 * ⚠**실제로 12번 밟은 자리는 「HTML 주석 안의 백틱」이다.**
 *
 * 렌더러는 화면 설명을 `<!-- … -->`로 남기는데, 그 안에서 코드를 인용하려고 백틱을 쓰면
 * **템플릿 리터럴이 거기서 끝난다.** 타입체크가 잡긴 하지만 메시지가 「',' expected」라
 * 원인을 말하지 않고, `assets.ts` 전용 검사는 다른 렌더러를 못 본다(12번째가 그랬다).
 *
 * ⚠**아주 좁은 그물이다.** 소스의 `<!--` 는 사실상 전부 html 템플릿 안이므로,
 * 그 구간의 백틱은 예외 없이 결함이다. 넓히면 오탐으로 죽는다.
 */
test("HTML 주석 안에 백틱을 쓰지 않는다 — 템플릿이 거기서 끝난다", () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 5, `소스를 못 찾았다(${files.length}개)`);
  const offenders: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(SRC_DIR, f), "utf8");
    for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) {
      if (!m[0].includes(TICK)) continue;
      const no = text.slice(0, m.index).split(NL).length;
      offenders.push(`${f}:${no}  ${m[0].split(NL)[0]!.slice(0, 64)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `HTML 주석 안의 백틱 — 여기서 템플릿이 끝난다:${NL}${offenders.join(NL)}`,
  );
});
