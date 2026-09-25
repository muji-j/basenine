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

/** `from` 이후 첫 여는 중괄호의 짝이 되는 닫는 중괄호 위치. 문자열 리터럴 안의 중괄호는 세지 않는다 */
function closingBrace(from: number): number {
  let depth = 0;
  for (let i = SRC.indexOf("{", from); i < SRC.length; i += 1) {
    const c = SRC[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(SRC, i);
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`중괄호 짝을 못 찾았다(위치 ${from})`);
}

/** `open`(예: `if (x.outcome === "written") {`)이 **정확히 한 곳**이고, 그 블록의 [시작, 끝] */
function writtenBranch(open: string): [number, number] {
  const at = codeIndicesOf(open);
  assert.equal(at.length, 1, `${open} 가 ${at.length}곳이다(1곳이어야 한다) — 성공 처리를 가두는 갈래가 없다`);
  return [at[0]!, closingBrace(at[0]!)];
}

/**
 * ⚠「판정 **뒤**에 있다」로는 부족했다(2026-09-26 최종 가지 검토 이월 1). 예전 모양은 `stale`·`invalid-db` 를 걸러 `continue` 하고
 *   그 아래에 성공 처리를 뒀는데, 위치만 보는 시험은 **그 `continue` 를 지워도 초록**이었다 — 쓰지 않은 경기의 명단이 선수 표로 흘러간다.
 *   → 성공 처리가 **`written` 갈래 안**에 있는지를 본다. 갈래 밖으로 옮기거나 옛 「걸러서 continue」 모양으로 돌아가면 붉어진다.
 */
test("명단 합치기(`mergeRoster(`)와 성공 집계는 실시 쓰기가 **`written` 인 갈래 안**에만 있다", () => {
  const [start, end] = writtenBranch('if (written.outcome === "written") {');
  const line = (i: number): number => RAW.slice(0, i).split("\n").length;
  // 정의(`function mergeRoster(`)는 빼고 호출만 본다
  const calls = codeIndicesOf("mergeRoster(").filter((i) => !SRC.slice(Math.max(0, i - 9), i).endsWith("function "));
  assert.ok(calls.length >= 1, "mergeRoster( 호출이 없다 — 명단 보충이 빠졌다");
  for (const c of calls) {
    assert.ok(c > start && c < end, `${line(c)}행의 mergeRoster( 가 written 갈래 밖이다 — 건너뛴 경기의 명단이 선수 표로 흘러간다(설계 D1-6)`);
  }
  // `notPlayed += 1` 과 섞이지 않게 앞 글자를 본다
  const playedInc = [...SRC.matchAll(/(?<![\w$])played \+= 1/g)].map((m) => m.index);
  assert.equal(playedInc.length, 1, `played += 1 이 ${playedInc.length}곳이다(1곳이어야 한다)`);
  assert.ok(playedInc[0]! > start && playedInc[0]! < end, `${line(playedInc[0]!)}행의 played += 1 이 written 갈래 밖이다 — 쓰지 않은 경기를 실시로 센다`);
});

test("미성립 쓰기도 같은 모양이다 — `notPlayed += 1` 은 `written` 인 갈래 안에만 있다", () => {
  const [start, end] = writtenBranch('if (w.outcome === "written") {');
  const inc = codeIndicesOf("notPlayed += 1");
  assert.equal(inc.length, 1, `notPlayed += 1 이 ${inc.length}곳이다(1곳이어야 한다)`);
  assert.ok(inc[0]! > start && inc[0]! < end, "notPlayed += 1 이 written 갈래 밖이다 — 쓰지 않은 경기를 미성립으로 센다");
});

/** 경기 순회(`for await (const file of walk(archiveRoot, "box.html.gz"))`)의 본문 [시작, 끝] — 정확히 한 곳이어야 한다 */
function gameLoop(): [number, number] {
  const at = codeIndicesOf('for await (const file of walk(archiveRoot, "box.html.gz"))');
  assert.equal(at.length, 1, `경기 순회가 ${at.length}곳이다(1곳이어야 한다) — 소스 모양이 바뀌었다`);
  return [at[0]!, closingBrace(at[0]!)];
}

/** `writeGameGuarded(` 호출 전부의 [여는 위치, 닫는 괄호] */
function guardedRanges(): [number, number][] {
  return codeIndicesOf(GUARDED).map((i) => [i, closingParen(i)]);
}

/**
 * ⚠**자식 행 쓰기도 판정 안이어야 한다**(2026-09-26 · 3중 검토 2차 · 설계 D1 끝).
 * 위 시험은 `upsertGame(` 만 본다 — 그런데 설계가 `upsertGame` 의 `WHERE` 만으로는 안 된다고 한 이유가 바로 **자식 행**이다
 * (경기 행만 지키면 자식만 옛 판인 새 혼합이 생긴다). 자식 행 쓰기 하나가 콜백 밖으로 나가면 옛 판 경기의 타석·주자·격리가
 * 판정 없이 갈아 끼워진다. 경기 순회 안의 쓰기를 **전부** 본다.
 * ⚠`upsertPlayer(` 도 넣는다 — 선수 표도 옛 판 경기에서 흘러가면 안 되는 쓰기다(명단과 같은 이유 · D1-6).
 */
test("경기 순회 안의 자식 행 쓰기(타격·투수·타석·주자·격리·삭제·선수)는 전부 `writeGameGuarded(` 콜백 안이다", () => {
  const [loopStart, loopEnd] = gameLoop();
  const ranges = guardedRanges();
  assert.ok(ranges.length >= 2, `${GUARDED} 호출이 ${ranges.length}곳뿐이다 — 미성립·실시 두 경로여야 한다`);
  const line = (i: number): number => RAW.slice(0, i).split("\n").length;
  const needles = ["replacePaEvents(", "replaceRunnerEvents(", "upsertBatting(", "upsertPitching(", "replaceQuarantine(", "DELETE FROM", "upsertPlayer("];
  const counts: string[] = [];
  for (const needle of needles) {
    const inLoop = codeIndicesOf(needle).filter((i) => i > loopStart && i < loopEnd);
    // ⚠분모 — 0 이면 이 시험은 그 쓰기를 아무것도 안 잰 것이다(이름이 바뀌었거나 가림이 코드를 먹었다)
    assert.ok(inLoop.length >= 1, `경기 순회 안에 ${needle} 가 없다 — 소스 모양이 바뀌었다`);
    counts.push(`${needle}${inLoop.length}`);
    for (const i of inLoop) {
      assert.ok(
        ranges.some(([s, e]) => i > s && i < e),
        `${line(i)}행의 ${needle} 가 ${GUARDED} 콜백 밖이다 — 판정 없이 자식 행을 쓴다(설계 D1 · 옛 판이 자식만 덮는다)`,
      );
    }
  }
  // ⚠삭제는 미성립 4 · 실시 2 다 — 하나라도 빠지면(가림 오류 포함) 분모가 달라진다
  assert.equal(codeIndicesOf("DELETE FROM").filter((i) => i > loopStart && i < loopEnd).length, 6, `DELETE FROM 개수가 다르다: ${counts.join(" · ")}`);
});

/**
 * ⚠**box 의 본 시각은 스냅샷에서 낸다 — 파일을 다시 읽지 않는다**(2026-09-26 · 3중 검토 3차 P2).
 * 예전에는 `readGamePages` 로 네 장을 읽은 **뒤** `fetchedAtOf(box.meta.json)` 로 사이드카를 한 번 더 읽었다(TOCTOU) —
 * 그 사이 아카이버가 사이드카를 바꾸면 무결성·세트는 옛 스냅샷으로, 판 가드는 새 시각으로 판정한다.
 */
test("box 의 본 시각(`boxFetchedAt`)은 `readGamePages` 스냅샷의 `pages.box.meta` 에서 낸다 — `fetchedAtOf(` 로 다시 읽지 않는다", () => {
  assert.equal(codeIndicesOf("fetchedAtOf(").length, 0, "적재기가 사이드카 파일을 다시 읽는다(fetchedAtOf) — 스냅샷과 다른 판의 시각이 들어간다");
  const derive = codeIndicesOf("const boxFetchedAt = seenAtOf(pages.box.meta);");
  assert.equal(derive.length, 1, `boxFetchedAt 을 스냅샷에서 내는 줄이 ${derive.length}곳이다(1곳이어야 한다)`);
  const read = codeIndicesOf("readGamePages(");
  const judge = codeIndicesOf("judgeVersion(");
  assert.equal(read.length, 1, `readGamePages( 가 ${read.length}곳이다`);
  assert.equal(judge.length, 1, `judgeVersion( 가 ${judge.length}곳이다`);
  assert.ok(read[0]! < derive[0]! && derive[0]! < judge[0]!, "순서가 다르다 — 스냅샷을 읽고 → 본 시각을 내고 → 사전 판정한다");
});
