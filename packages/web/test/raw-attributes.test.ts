/**
 * **`raw()` 안에서 속성을 문자열로 짓지 마라 — 그 안의 값은 이스케이프를 거치지 않는다.**
 *
 * `layout.ts` 와 `teams-page.ts` 가 **말로는** 이 규칙을 적어 뒀다
 * (「그 안의 값은 이스케이프를 거치지 않는다 — 따옴표 하나로 속성이 끊긴다」).
 * 그런데 2026-08-19 검토에서 세어 보니 그 자리가 **둘이 아니라 넷**이었다 —
 * `parts.ts`(탭의 `id`/`aria-controls`) · `player-page.ts`(`data-avg`) 가 남아 있었다.
 * 지금 들어가는 값이 안전한 토큰·숫자라 **뚫리지는 않았지만**, 규칙이 주석에만 있으면
 * 다음 사람이 그 자리에 문자열 필드를 얹는 순간 따옴표 하나로 속성이 끊긴다.
 * **말로 적은 규칙은 지켜지지 않는다 — 세는 것만 지켜진다.**
 *
 * ⚠**줄 단위 grep 으로는 못 센다.** `` html`<td class="${x}"${raw(c ? " hidden" : "")}>` `` 처럼
 * **같은 줄에 있지만 `raw()` 밖인** 형태가 이 저장소에 10곳 있고 전부 정상이다
 * (`raw()` 가 받는 것이 상수 문자열이면 이스케이프할 것이 없다).
 * 그래서 **`raw(` 의 인자 구간을 실제로 떠서** 그 안만 본다.
 *
 * ⚠**모듈을 import 하지 않는다** — 검사 대상이 소스의 **모양**이지 동작이 아니다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const TICK = "`";
const NL = String.fromCharCode(10);

/** 위반의 모양: 속성값을 여는 따옴표 **바로 뒤**에 템플릿 삽입이 온다 */
const ATTR_IN_TEMPLATE = '="${';

interface RawSpan {
  line: number;
  body: string;
}

/**
 * 스캐너가 지금 어디에 있는가.
 * `tpl: true` = 백틱 안의 **글자** 부분 · `tpl: false` = 그 안의 `${…}`(= 다시 코드).
 * `braces` 는 `${…}` 안에서 만나는 중괄호 짝 — 0에서 `}` 를 만나면 그 삽입이 끝난 것이다.
 */
interface Frame {
  tpl: boolean;
  braces: number;
}

/**
 * 따옴표 문자열의 끝(닫는 따옴표 **다음** 칸).
 *
 * ⚠**줄을 넘기지 않는다.** 정규식 리터럴 안의 따옴표(`/[&<>"']/` 가 실재한다)를
 * 문자열의 시작으로 오해할 수 있는데, 줄에서 끊으면 그 오해가 **그 줄 안에서 끝난다.**
 * 넘기게 두면 한 번의 오해가 파일 끝까지 번져 검사가 통째로 눈이 먼다.
 */
function endOfQuoted(src: string, at: number): number {
  const q = src[at];
  for (let i = at + 1; i < src.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === q) return i + 1;
    if (src[i] === NL) return i;
  }
  return src.length;
}

/**
 * `raw(…)` 의 **인자 구간**을 전부 뜬다.
 *
 * 주석·따옴표 문자열·템플릿 리터럴을 구별해서 걷는다. 정교한 파서가 아니라
 * **이 저장소의 소스에서 괄호 짝을 맞출 수 있을 만큼**이다 — 그래서 아래 시험이
 * ⑴ 옛 형태를 잡는가 ⑵ 고친 형태를 놓아주는가 ⑶ **몇 곳을 봤는가**를 함께 못 박는다.
 */
function rawSpans(src: string): RawSpan[] {
  const out: RawSpan[] = [];
  const frames: Frame[] = [];
  /** 열려 있는 `raw(` — 인자 시작 위치와 **그때의 괄호 깊이** */
  const opens: { from: number; depth: number }[] = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const top = frames[frames.length - 1];
    const c = src[i];
    if (top !== undefined && top.tpl) {
      // 백틱 안의 글자 부분 — `${` 와 닫는 백틱만 본다
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === TICK) {
        frames.pop();
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        frames.push({ tpl: false, braces: 0 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // 코드(최상위 또는 `${…}` 안)
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf(NL, i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = endOfQuoted(src, i);
      continue;
    }
    if (c === TICK) {
      frames.push({ tpl: true, braces: 0 });
      i += 1;
      continue;
    }
    if (c === "{" && top !== undefined) {
      top.braces += 1;
      i += 1;
      continue;
    }
    if (c === "}" && top !== undefined) {
      if (top.braces === 0) frames.pop();
      else top.braces -= 1;
      i += 1;
      continue;
    }
    if (c === "(") {
      depth += 1;
      // ⚠`isRaw(`·`__raw(`·`x.raw(` 는 아니다 — 앞 글자가 식별자의 일부면 다른 이름이다
      if (/(?:^|[^A-Za-z0-9_$.])raw$/.test(src.slice(Math.max(0, i - 16), i))) {
        opens.push({ from: i + 1, depth });
      }
      i += 1;
      continue;
    }
    if (c === ")") {
      const open = opens[opens.length - 1];
      if (open !== undefined && open.depth === depth) {
        opens.pop();
        out.push({ line: src.slice(0, open.from).split(NL).length, body: src.slice(open.from, i) });
      }
      depth -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * ⚠**그물이 잡는지·안 잡는지 둘 다 확인한다.**
 * 「위반 0건」은 검사기가 **죽어 있을 때도** 나오는 값이다(작업규칙 7 「0건과 안 쟀음」).
 * 그래서 **2026-08-19 이전의 실제 형태**에서 1건, **고친 형태**에서 0건임을 먼저 못 박는다.
 * ⚠한쪽만 두면 안 된다 — 잡기만 보면 「전부 위반」인 그물이 통과하고,
 * 놓아주기만 보면 아무것도 안 잡는 그물이 통과한다.
 */
test("⚠검사기가 옛 형태를 잡고 고친 형태는 놓아준다 — 「0건」이 「안 쟀음」이 아님을 먼저 보인다", () => {
  const before = 'html`<button data-tab="${t.id}" ${raw(on ? ` id="${tabId(g, k)}"` : "")}>`';
  const after = 'html`<button data-tab="${t.id}" ${on ? html` id="${tabId(g, k)}"` : raw("")}>`';
  const hits = (s: string): number => rawSpans(s).filter((r) => r.body.includes(ATTR_IN_TEMPLATE)).length;
  assert.equal(hits(before), 1, "검사기가 2026-08-19 이전의 실제 형태를 못 잡는다 — 그물이 죽어 있다");
  assert.equal(hits(after), 0, "고친 형태까지 위반이라고 부른다 — 그물이 넓으면 고칠 것이 없는데도 빨개진다");
});

test("⚠raw() 안에서 속성을 문자열로 짓지 않는다 — 그 안의 값은 이스케이프를 거치지 않는다", () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 5, `소스를 못 찾았다(${files.length}개)`);
  let spans = 0;
  const offenders: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(SRC_DIR, f), "utf8");
    for (const s of rawSpans(text)) {
      spans += 1;
      if (!s.body.includes(ATTR_IN_TEMPLATE)) continue;
      offenders.push(`${f}:${s.line}  raw(${s.body.replace(/\s+/g, " ").trim().slice(0, 80)})`);
    }
  }
  // ⚠**본 곳의 수를 못 박는다**(작업규칙 7). 스캐너가 어느 날 첫 파일에서 멈춰도 위반은 0건이 된다.
  //   실측 2026-08-19: 소스 **26개**에서 raw( 구간 **112곳**. 하한은 그보다 낮게 둔다 —
  //   `raw()` 를 지우는 것은 정상적인 개선이고, 그때마다 이 시험이 빨개지면 안 된다.
  assert.ok(
    spans >= 80,
    `raw( 구간을 ${spans}곳밖에 못 떴다 — 검사기가 소스를 못 읽고 있다(파일 ${files.length}개)`,
  );
  assert.deepEqual(
    offenders,
    [],
    `raw() 안에서 속성을 짓고 있다 — raw( 구간 ${spans}곳 중 ${offenders.length}곳:${NL}${offenders.join(NL)}`,
  );
});
