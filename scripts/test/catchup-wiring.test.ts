/**
 * **덜 받은 날 — `update.ts` 의 배선**(감사 C10 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md` · 2026-09-27 3중 검토 반영).
 *
 * ⚠**판정 자체는 여기서 재지 않는다.** 판정 I/O 는 `scripts/collected-through.ts` 로 떼어 `collected-through.test.ts` 가
 *   임시 SQLite·임시 아카이브로 **실제로 돌린다**(3중 검토 2차 F1 — 소스 모양 검사로는 변이 5개가 전부 초록이었다).
 *   창은 `date-window.test.ts` 가 실행으로 잰다. 여기는 `update.ts`(import 하면 수집이 시작돼 실행할 수 없다)가
 *   **그것들을 제자리에서 부르는가**만 본다:
 *   · 판정 I/O 가 `update.ts` 에 두 벌로 남지 않는다(M1) · store 배럴을 안 가져온다(I1)
 *   · 시계를 한 번 읽고 그 `now` 를 판정과 창에 같이 준다(M6) · 재수집·`--date` 면 판정하지 않는다(D6)
 *   · 덜 받은 날은 `include` 로만 창에 들어간다(D4) · 알림은 `include` 없는 창과 맞대 **새로 더한 날만** 말한다(D5)
 *   · 「대상 경기일」 꼬리표는 **오늘이 들었는가**로 가른다(날짜 수로 가르면 아침 따라잡기 창에서 「어제와 오늘」이라고 거짓말한다)
 * ⚠주석은 걷어내고 본다 · 줄끝은 `\n` 으로 맞춘다(Windows 체크아웃은 CRLF).
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

/** `needle` 이 코드에 정확히 한 번 나오는 위치 */
function once(needle: string, what: string): number {
  const at = UPDATE.indexOf(needle);
  assert.notEqual(at, -1, `update.ts 에 ${what}(${needle})가 없다 — 배선이 빠졌거나 모양이 바뀌었다`);
  assert.equal(UPDATE.indexOf(needle, at + 1), -1, `update.ts 에 ${what}(${needle})가 두 곳 이상이다`);
  return at;
}

test("⚠I1·M1 update.ts 는 판정 모듈을 가져오기만 한다 — 판정 I/O 를 따로 갖지 않고 store 배럴도 안 가져온다", () => {
  assert.match(UPDATE, /import \{ catchupNotes, readCollectedThrough \} from "\.\/collected-through\.ts";/, "판정 모듈을 가져오지 않는다");
  assert.equal(/from\s+"@bb-app\/store"|import\s+"@bb-app\/store"/.test(UPDATE), false, "store 배럴을 가져온다");
  for (const own of ["new DatabaseSync(", "readdirSync(", "gameFromBoxPath", "dayStatus(", "judgeDates("]) {
    assert.equal(UPDATE.includes(own), false, `update.ts 에 판정 I/O(${own})가 남아 있다 — 두 벌이면 한쪽만 고쳐진다(M1)`);
  }
});

test("⚠M6·D6 시계를 먼저 한 번 읽고 · 재수집·--date 가 아닐 때만 · 그 now 로 판정한다", () => {
  // ⚠시계 호출을 **문자열로 적지 않는다** — `clock-injection.test.ts` 가 문자열 속 호출도 센다(괄호를 이스케이프한 정규식으로 찾는다)
  const clocks = [...UPDATE.matchAll(/const now = new Date\(\);/g)];
  assert.equal(clocks.length, 1, `진입점 시계가 ${clocks.length}곳이다(1곳이어야 한다)`);
  const clock = clocks[0]!.index;
  const call = once("readCollectedThrough(", "판정 호출");
  assert.ok(clock < call, "판정이 시계보다 먼저다 — 판정과 창이 다른 「지금」을 본다(M6)");
  assert.match(
    UPDATE,
    /const read = values\.date === undefined && refetch\.dates === null\s*\?\s*readCollectedThrough\(\{ dbPath: resolve\(ROOT, values\.db\), archiveRoot: resolve\(ROOT, values\.archive\), now \}\)\s*:\s*undefined;/,
    "재수집·--date 에도 판정하거나 · now·경로를 다르게 넘긴다",
  );
});

test("⚠D4 덜 받은 날은 include 로만 창에 들어간다 — 한 곳 · 옛 includeSince 는 없다", () => {
  assert.equal(UPDATE.includes("includeSince"), false, "옛 includeSince 가 남아 있다");
  assert.match(
    UPDATE,
    /const dates = refetch\.dates \?\? targetDates\(now, \{\s*\.\.\.windowOpts,\s*\.\.\.\(collected === undefined \? \{\} : \{ include: collected\.include \}\),?\s*\}\);/,
    "덜 받은 날을 include 로 넘기지 않는다(또는 모양이 바뀌었다)",
  );
  assert.equal([...UPDATE.matchAll(/include:/g)].length, 1, "include 를 넘기는 곳이 한 곳이 아니다");
});

test("⚠D5 판정 모듈의 알림을 찍고 · 창에 새로 더한 날만 말한다(include 없는 창과 맞댄다)", () => {
  assert.match(UPDATE, /for \(const n of read\?\.notes \?\? \[\]\) say\(n\);/, "판정 모듈의 알림을 찍지 않는다");
  assert.match(
    UPDATE,
    /if \(collected !== undefined\) for \(const n of catchupNotes\(collected, targetDates\(now, windowOpts\), dates\)\) say\(n\);/,
    "알림이 include 없는 창(원래 창)과 맞대지 않는다 — 원래 창에 있던 날도 「다시 받는다」고 말한다",
  );
  const say = UPDATE.slice(once("function say(", "알림 출력"), UPDATE.indexOf("\n}", UPDATE.indexOf("function say(")));
  assert.match(say, /n\.level === "warn"[\s\S]*console\.error/, "경고를 표준오류로 찍지 않는다");
});

/** ⚠변이 (e) — 3중 검토 2차 F1: 꼬리표를 옛 판(`dates.length > 1`)으로 되돌려도 배선 시험 7본이 전부 초록이었다 */
test("⚠「대상 경기일」 꼬리표는 오늘이 들었는가로 가른다 — 날짜 수로 가르지 않는다", () => {
  assert.match(UPDATE, /: dates\.at\(-1\) === jstDate\(now\)\s*\?\s*" \(오늘 JST 까지/, "꼬리표가 「마지막 날짜가 오늘인가」로 가르지 않는다");
  assert.equal(/dates\.length > 1/.test(UPDATE), false, "꼬리표를 날짜 수로 가른다 — 아침 따라잡기 창에서 「어제와 오늘」이라고 말한다");
});
