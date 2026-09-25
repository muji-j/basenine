/**
 * 적재기의 **판 가드 배선**을 소스로 고정한다(설계 D1 · 2026-09-25 감사 C5).
 *
 * ⚠**왜 정적 시험인가.** 쓰기 트랜잭션 안의 재판정(`writeGameGuarded`)과 「쓰기가 된 뒤에만 명단을 합친다」가
 *   뜻을 갖는 것은 **사전 판정은 통과했는데 그 사이 다른 적재기가 더 새 판을 커밋한** 경합뿐이다(설계 D1 동시 적재).
 *   프로세스 하나로 도는 통합 시험(`load-archive-guard.test.ts`)에서는 **사전 판정이 옛 판을 전부 먼저 잡으므로**
 *   그 경로에 닿지 않는다. 실측으로 이렇게 살아남았다(2026-09-25 구현 보고 · 검토):
 *   ① 쓰기 하나를 `writeGameGuarded(` 에서 `db.transaction(` 으로 되돌려도 · ② `mergeRoster(localRoster)` 를
 *   쓰기 앞으로 옮겨도 통합 시험이 전부 초록이었다.
 *   → 함수 자체의 경합 동작은 `version-guard.test.ts`(7a·7a′)가 재고, **적재기가 그 함수를 제자리에서 부르는가**는 여기가 잰다.
 *
 * ⚠파서가 아니라 **문자열 위치**로 본다. 주석은 같은 길이의 공백으로 지우고(주석 속 낱말이 판정을 흐리지 않게 ·
 *   위치는 그대로), 괄호 짝은 문자열 리터럴을 건너뛰며 센다. 정규식 리터럴은 따로 다루지 않는다 —
 *   따옴표가 든 정규식이 생겨 가림이 어긋나면 아래 개수 검사가 **붉어진다**(조용히 초록이 되지 않는다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAW = readFileSync(fileURLToPath(new URL("../tools/load-archive.ts", import.meta.url)), "utf8");

/** 주석을 같은 길이의 공백으로 바꾼다(줄바꿈은 남긴다). 문자열 리터럴 안의 `//`·`/*` 는 주석이 아니다 */
function maskComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      i = endOfString(src, i) + 1;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** `open` 의 따옴표로 시작한 문자열 리터럴이 끝나는 따옴표 위치(이스케이프 존중) */
function endOfString(src: string, open: number): number {
  const q = src[open];
  for (let i = open + 1; i < src.length; i += 1) {
    if (src[i] === "\\") i += 1;
    else if (src[i] === q) return i;
  }
  throw new Error(`문자열이 닫히지 않았다(위치 ${open})`);
}

const SRC = maskComments(RAW);

/** 코드(주석 밖)에 나오는 `needle` 의 위치 전부 */
function codeIndicesOf(needle: string): number[] {
  const out: number[] = [];
  for (let i = SRC.indexOf(needle); i !== -1; i = SRC.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** `from` 이후 첫 여는 괄호의 짝이 되는 닫는 괄호 위치. 문자열 리터럴 안의 괄호는 세지 않는다 */
function closingParen(from: number): number {
  let depth = 0;
  for (let i = SRC.indexOf("(", from); i < SRC.length; i += 1) {
    const c = SRC[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(SRC, i);
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`괄호 짝을 못 찾았다(위치 ${from})`);
}

const GUARDED = "writeGameGuarded(";
const TX = "db.transaction(";

test("경기 행을 쓰는 곳(`upsertGame(`)은 전부 `writeGameGuarded(` 콜백 안이다 — 날것의 트랜잭션이 아니다", () => {
  const upserts = codeIndicesOf("upsertGame(");
  // ⚠분모 — 쓰기 경로는 미성립·실시 둘이다. 0 이면 이 시험은 아무것도 안 잰 것이다
  assert.ok(upserts.length >= 2, `upsertGame( 호출이 ${upserts.length}곳뿐이다 — 소스 모양이 바뀌었거나 가림이 코드를 먹었다`);
  const openers = [...codeIndicesOf(GUARDED).map((i) => ({ i, kind: GUARDED })), ...codeIndicesOf(TX).map((i) => ({ i, kind: TX }))]
    .sort((a, b) => a.i - b.i);
  for (const u of upserts) {
    const nearest = openers.filter((o) => o.i < u).at(-1);
    const line = RAW.slice(0, u).split("\n").length;
    assert.ok(nearest !== undefined, `${line}행의 upsertGame( 앞에 여는 호출이 없다`);
    assert.equal(nearest.kind, GUARDED, `${line}행의 upsertGame( 가 ${nearest.kind} 안에 있다 — 판정 없이 쓴다(설계 D1-6)`);
    assert.ok(u < closingParen(nearest.i), `${line}행의 upsertGame( 가 ${GUARDED} 호출이 닫힌 뒤에 있다`);
  }
});

test("`db.transaction(` 콜백 어디에도 `upsertGame(` 이 없다", () => {
  for (const t of codeIndicesOf(TX)) {
    const body = SRC.slice(t, closingParen(t) + 1);
    const line = RAW.slice(0, t).split("\n").length;
    assert.ok(!body.includes("upsertGame("), `${line}행의 ${TX} 콜백이 경기 행을 쓴다 — 트랜잭션 안 재판정이 빠진다`);
  }
});

test("명단 합치기(`mergeRoster(`)는 실시 쓰기의 판정 결과를 본 **뒤**에만 있다", () => {
  const staleCheck = codeIndicesOf('written.outcome === "stale"');
  const invalidCheck = codeIndicesOf('written.outcome === "invalid-db"');
  assert.equal(staleCheck.length, 1, `written.outcome === "stale" 가 ${staleCheck.length}곳이다(1곳이어야 한다)`);
  assert.equal(invalidCheck.length, 1, `written.outcome === "invalid-db" 가 ${invalidCheck.length}곳이다(1곳이어야 한다)`);
  const after = Math.max(staleCheck[0]!, invalidCheck[0]!);
  // 정의(`function mergeRoster(`)는 빼고 호출만 본다
  const calls = codeIndicesOf("mergeRoster(").filter((i) => !SRC.slice(Math.max(0, i - 9), i).endsWith("function "));
  assert.ok(calls.length >= 1, "mergeRoster( 호출이 없다 — 명단 보충이 빠졌다");
  for (const c of calls) {
    const line = RAW.slice(0, c).split("\n").length;
    assert.ok(c > after, `${line}행의 mergeRoster( 가 쓰기 판정보다 앞이다 — 건너뛴 경기의 명단이 선수 표로 흘러간다(설계 D1-6)`);
  }
});
