/**
 * 선수 적재기(`load-players.ts`)의 **판 가드 배선**을 소스로 고정한다(감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5-3 · 시험 3-21).
 *
 * ⚠**왜 정적 시험인가.** 판정이 쓰기와 **같은 트랜잭션 안**이어야 하는 이유는 「판정과 쓰기 사이에 다른 적재기가 더 새 판을
 *   커밋하는」 경합뿐이고, 프로세스 하나로 도는 통합 시험(`load-players.test.ts`)은 그 경로에 닿지 않는다(경기 가드와 같은 사정 ·
 *   `load-archive-wiring.test.ts` 머리말). 판정 함수 자체는 트랜잭션 밖이면 던진다(`player-version.test.ts` 3-2) — 여기는
 *   **적재기가 그 함수를 제자리에서 부르는가**를 잰다: 루프의 `db.transaction(` 콜백 안 · 프로필 UPDATE 와 통산 savepoint **앞**.
 * ⚠**사이드카를 다시 읽지 않는다**(`fetchedAtOf(` 0곳) — 판정한 판과 다른 판의 시각이 들어간다(경기 가드 부록 D A2 · TOCTOU).
 * ⚠주석은 같은 길이의 공백으로 지우고 본다(`load-archive-wiring.test.ts` 와 같은 방식 — 주석 속 낱말이 판정을 흐리지 않게).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAW = readFileSync(fileURLToPath(new URL("../tools/load-players.ts", import.meta.url)), "utf8");

/** 문자열 리터럴이 끝나는 따옴표 위치(이스케이프 존중) */
function endOfString(src: string, open: number): number {
  const q = src[open];
  for (let i = open + 1; i < src.length; i += 1) {
    if (src[i] === "\\") i += 1;
    else if (src[i] === q) return i;
  }
  throw new Error(`문자열이 닫히지 않았다(위치 ${open})`);
}

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

const SRC = maskComments(RAW);
const line = (i: number): number => RAW.slice(0, i).split("\n").length;

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

test("⚠N3 3-21 · 선수 적재기는 사이드카를 다시 읽지 않는다 — `fetchedAtOf(` 0곳 · 스냅샷에서 `playerArchiveOf(` 로 낸다", () => {
  assert.equal(codeIndicesOf("fetchedAtOf(").length, 0, "사이드카 파일을 다시 읽는다(fetchedAtOf) — 판정한 판과 다른 판의 시각이 들어간다");
  assert.equal(codeIndicesOf("playerArchiveOf(").length, 1, "판정 재료(playerArchiveOf)를 내는 곳이 정확히 한 곳이 아니다");
});

test("⚠N3 3-21 · `judgePlayerVersion(` 은 루프의 `db.transaction(` 콜백 안 · 프로필 `stmt.run(` 과 통산 `db.savepoint(` **앞**이다", () => {
  const judge = codeIndicesOf("judgePlayerVersion(");
  assert.equal(judge.length, 1, `judgePlayerVersion( 가 ${judge.length}곳이다(1곳이어야 한다)`);
  const j = judge[0]!;
  const tx = codeIndicesOf("db.transaction(");
  assert.equal(tx.length, 1, `db.transaction( 가 ${tx.length}곳이다 — 루프 전체가 트랜잭션 하나라는 전제가 바뀌었다`);
  assert.ok(j > tx[0]! && j < closingParen(tx[0]!), `${line(j)}행의 판정이 쓰기 트랜잭션 밖이다 — 판정과 쓰기 사이에 다른 연결이 끼어든다`);
  const update = codeIndicesOf("stmt.run(");
  const savepoint = codeIndicesOf("db.savepoint(");
  assert.equal(update.length, 1, `프로필 stmt.run( 가 ${update.length}곳이다`);
  assert.equal(savepoint.length, 1, `통산 db.savepoint( 가 ${savepoint.length}곳이다`);
  assert.ok(j < update[0]!, `판정(${line(j)}행)이 프로필 UPDATE(${line(update[0]!)}행) 뒤다 — 옛 판을 쓴 뒤에 판정한다`);
  assert.ok(j < savepoint[0]!, `판정(${line(j)}행)이 통산 savepoint(${line(savepoint[0]!)}행) 뒤다`);
});
