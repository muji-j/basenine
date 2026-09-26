/**
 * **덜 받은 마지막 경기일 — `update.ts` 의 배선**(감사 C10 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md` D3·D5·D6).
 *
 * 판정(`sinceStatus`)과 창(`targetDates` 의 `includeSince`)은 `date-window.test.ts` 가 실행으로 잰다.
 * 여기는 **그것을 부르는 배선**을 잰다 — `update.ts` 는 import 하는 순간 수집을 시작하므로(외부 요청) 실행 시험을 할 수 없다.
 * 한 줄만 어긋나도 초록인 채로 틀린다:
 *   · 아카이브를 DB 보다 먼저 읽으면, 그 사이 적재가 끝난 경기를 「덜 받음」 쪽이 아니라 **빠뜨리는 쪽**으로 틀릴 수 있다(D3)
 *   · `includeSince` 를 판정과 무관하게 넘기면 **휴식일 다음 날마다** 다 받은 날을 다시 받는다(요청 0 증가 약속 · L1)
 *   · 경기 폴더를 적재기와 다른 규칙으로 세면 매 실행 그 날을 다시 받거나 덜 받은 날을 놓친다(D2 · M1)
 *   · 못 읽음을 빈 목록으로 두면 그날 경기 전부를 「덜 받음」으로 오판한다(D1 · 콜드 리뷰 ①)
 * ⚠주석은 걷어내고 본다(주석 속 낱말이 판정을 흐리지 않게) · 줄끝은 `\n` 으로 맞춘다(Windows 체크아웃은 CRLF).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readLf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const UPDATE = readLf("../update.ts")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(?<!:)\/\/[^\n]*/g, "");

/** `head` 로 시작하는 최상위 블록(`head` … 줄머리의 `}`). 정확히 한 곳이어야 한다 */
function topBlock(head: string): string {
  const at = UPDATE.indexOf(head);
  assert.notEqual(at, -1, `update.ts 에 ${head} 가 없다 — 배선이 빠졌거나 모양이 바뀌었다`);
  assert.equal(UPDATE.indexOf(head, at + 1), -1, `${head} 가 두 곳 이상이다`);
  const end = UPDATE.indexOf("\n}", at);
  assert.notEqual(end, -1, `${head} 블록이 닫히지 않는다`);
  return UPDATE.slice(at, end + 2);
}

/** `block` 안에서 `needle` 의 위치 — 없으면 떨어진다(순서 비교가 -1 로 공회전하지 않게) */
function posIn(block: string, needle: string, what: string): number {
  const i = block.indexOf(needle);
  assert.notEqual(i, -1, `collectedThrough 에 ${what}(${needle})가 없다`);
  return i;
}

/**
 * ⚠**따옴표까지 포함한 문자열 리터럴 전체**로 찾는다 — 부분 문자열로 찾으면 `… WHERE game_date = ? AND status = 'played'` 도
 * 통과한다(뮤테이션 실측). 그날 경기 id 는 **상태 무관**이어야 한다: 미성립 경기도 행이 있으므로 played 만 세면 비 온 날마다 「덜 받음」이 된다.
 */
const MAX_SQL = `"SELECT MAX(game_date) AS d FROM game WHERE status = 'played'"`;
const IDS_SQL = `"SELECT game_id AS id FROM game WHERE game_date = ?"`;

test("⚠I1 update.ts 는 경기 폴더 판별을 잎 서브패스로 가져온다 — store 배럴을 가져오지 않는다", () => {
  assert.equal(/from\s+"@bb-app\/store"/.test(UPDATE), false, "@bb-app/store(배럴)를 가져오면 parser·domain 까지 평가돼 수집이 시작 전에 죽을 수 있다");
  assert.match(UPDATE, /import \{ gameFromBoxPath \} from "@bb-app\/store\/game-slug";/, "gameFromBoxPath 를 잎 서브패스에서 가져오지 않는다");
});

test("⚠D3 collectedThrough 는 DB 를 먼저(읽기 전용 · 한 트랜잭션 · 마지막 경기일과 그날 경기 id) 읽고 그다음 아카이브를 읽는다", () => {
  const fn = topBlock("function collectedThrough(");
  const open = posIn(fn, "new DatabaseSync(", "DB 열기");
  assert.match(fn.slice(open, fn.indexOf(")", open) + 1), /readOnly: true/, "DB 를 읽기 전용으로 열지 않는다");
  const begin = posIn(fn, 'db.exec("BEGIN")', "트랜잭션 시작");
  const max = posIn(fn, MAX_SQL, "마지막 경기일 조회");
  const ids = posIn(fn, IDS_SQL, "그날 경기 id 조회(상태 무관)");
  const commit = posIn(fn, 'db.exec("COMMIT")', "트랜잭션 끝");
  const archive = posIn(fn, "readdirSync(", "아카이브 그날 폴더 읽기");
  assert.ok(begin < max && max < ids && ids < commit, "마지막 경기일과 그날 경기 id 가 한 트랜잭션(BEGIN … COMMIT) 안에서 그 순서로 읽히지 않는다");
  assert.ok(commit < archive, "아카이브를 DB 보다 먼저(또는 트랜잭션 안에서) 읽는다 — 읽는 순서는 DB → 아카이브다(D3)");
  assert.ok(open < archive, "아카이브를 DB 를 열기 전에 읽는다");
  const verdict = posIn(fn, "sinceStatus(archived, loaded)", "판정 호출");
  assert.ok(archive < verdict, "두 목록을 다 읽기 전에 판정한다");
});

test("⚠D2 아카이브의 경기 폴더는 box.html.gz 가 있고 잎 판정(gameFromBoxPath)을 통과한 것만 센다 — 제 판정을 따로 갖지 않는다", () => {
  const fn = topBlock("function collectedThrough(");
  assert.match(fn, /existsSync\(\s*box\s*\)/, "box.html.gz 가 있는지 안 본다");
  assert.match(fn, /join\([^)]*"box\.html\.gz"\)/, "경기 폴더의 box.html.gz 경로를 만들지 않는다");
  assert.match(fn, /gameFromBoxPath\(\s*box\s*\)/, "잎 판정(gameFromBoxPath)을 거치지 않는다");
  assert.equal(/split\("-"\)/.test(UPDATE) || UPDATE.includes("scores[\\\\/]"), false, "update.ts 가 슬러그·경로 판정을 따로 갖는다 — 적재기와 두 벌이 된다");
});

test("⚠D1 못 읽음은 null(모름)이다 — 빈 목록으로 메우지 않는다", () => {
  const fn = topBlock("function collectedThrough(");
  assert.match(fn, /let loaded: string\[\] \| null = null;/, "그날 경기 id 목록이 「못 읽음(null)」에서 시작하지 않는다");
  assert.match(fn, /archived = null;/, "아카이브를 못 읽었을 때 null 로 두지 않는다");
  assert.equal(/(loaded|archived)\s*\?\?\s*\[\]|loaded\s*=\s*\[\]/.test(fn), false, "못 읽음을 빈 목록으로 메운다 — 그날 경기 전부를 덜 받음으로 오판한다(콜드 리뷰 ①)");
  assert.match(fn, /"ENOENT"/, "그날 폴더가 없는 것(받아 둔 경기 0)과 못 읽은 것을 가르지 않는다");
});

test("⚠D4 includeSince 는 판정이 incomplete 일 때만 넘긴다 — 한 곳 · targetDates(now, …) 안", () => {
  const n = [...UPDATE.matchAll(/includeSince/g)].length;
  assert.equal(n, 1, `includeSince 가 ${n}곳이다(1곳이어야 한다) — 판정과 무관하게 넘기는 길이 있으면 휴식일 다음 날마다 다 받은 날을 다시 받는다`);
  const call = UPDATE.slice(UPDATE.indexOf("targetDates(now, {"), UPDATE.indexOf("});", UPDATE.indexOf("targetDates(now, {")));
  assert.match(
    call,
    /\.\.\.\(collected\?\.verdict\.status === "incomplete" \? \{ includeSince: true \} : \{\}\)/,
    "targetDates 에 includeSince 를 「incomplete 일 때만」 넘기지 않는다",
  );
});

test("⚠D6 재수집(BB_REFETCH_DATES)·--date 가 있으면 판정하지 않는다 — collectedThrough 는 한 곳에서 그 조건으로만 부른다", () => {
  // ⚠선언(`function collectedThrough():`)은 호출이 아니다 — 빼고 센다
  const calls = [...UPDATE.matchAll(/(?<!function )collectedThrough\(\)/g)].length;
  assert.equal(calls, 1, `collectedThrough() 호출이 ${calls}곳이다(1곳이어야 한다)`);
  assert.match(
    UPDATE,
    /const collected = values\.date === undefined && refetch\.dates === null \? collectedThrough\(\) : undefined;/,
    "--date·재수집일 때도 판정한다(또는 그 조건이 바뀌었다)",
  );
});

test("D5 판정을 한 줄로 말한다 — 덜 받음이면 몇 건이고 그날도 다시 받는지 · 모름이면 무엇을 못 읽었는지", () => {
  assert.match(UPDATE, /저장 안 된 경기 \$\{[^}]+\}건 — \$\{[^}]+\} 도 다시 받는다/, "덜 받음 판정을 말하지 않는다");
  assert.match(UPDATE, /덜 받혔는지 모른다/, "모름 판정을 말하지 않는다");
});
