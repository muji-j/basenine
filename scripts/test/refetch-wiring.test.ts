/**
 * 재수집 입력의 배선(설계 D4 · 시험 14).
 * ⚠`run:` 안에 `${{ inputs.refetch_dates }}` 를 직접 쓰면 입력이 셸 코드로 끼어든다(스크립트 인젝션). **환경변수로만** 넘긴다.
 * ⚠**I1(감사 반영)**: `scripts/date-window.ts` 는 `scripts/update.ts`(수집 오케스트레이터)가 직접
 * import 한다. 그 스크립트는 경기·予告先発 수집을 각각 자식 프로세스로 격리해 부분 실패를
 * 전체 실패로 만들지 않는데, `date-window.ts` 가 `@bb-app/store` **배럴**을 가져오면 parser·domain
 * 까지 통째로 평가돼 그 격리가 무의미해진다. 그래서 이 파일은 배럴 import 를 정적으로 금지한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const YML = readFileSync(fileURLToPath(new URL("../../.github/workflows/daily.yml", import.meta.url)), "utf8");
const DATE_WINDOW = readFileSync(fileURLToPath(new URL("../date-window.ts", import.meta.url)), "utf8");
const REFETCH_LIMIT = readFileSync(
  fileURLToPath(new URL("../../packages/store/src/refetch-limit.ts", import.meta.url)),
  "utf8",
);

test("14 수동 실행에 refetch_dates 입력이 있다", () => {
  assert.match(YML, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+refetch_dates:/);
});

test("⚠14 입력은 수집 단계의 env 로만 쓰인다 — run: 에 직접 나오지 않는다", () => {
  const uses = [...YML.matchAll(/inputs\.refetch_dates/g)].length;
  assert.equal(uses, 1, "정확히 한 곳(env)에서만 읽어야 한다");
  assert.match(YML, /\n\s+BB_REFETCH_DATES: \$\{\{ inputs\.refetch_dates \}\}\n/);
  const step = YML.slice(YML.indexOf("- name: 수집·적재"), YML.indexOf("- name: 드래프트 적재"));
  assert.equal(step.includes("BB_REFETCH_DATES: ${{ inputs.refetch_dates }}"), true, "수집·적재 단계의 env 에 그 줄 그대로 있어야 한다");
});

/**
 * ⚠**I1**: `scripts/date-window.ts` 는 `scripts/update.ts` 가 직접 import 하는 진입점 인접 모듈이다.
 * `@bb-app/store` 배럴을 가져오면 parser·domain 까지 로드 시점에 평가되어, 그중 어디서든 결함이
 * 있으면 수집이 시작하기도 전에 죽는다 — update.ts 가 지키려는 「부분 실패를 전체 실패로 만들지
 * 않는다」가 무너진다. 잎 서브패스(`@bb-app/store/refetch-limit`)나 그 상대경로만 허용한다.
 */
test("⚠I1 date-window.ts 는 store 배럴을 가져오지 않는다 — 잎 서브패스(또는 상대경로)만 허용", () => {
  assert.equal(
    /from\s+"@bb-app\/store"/.test(DATE_WINDOW),
    false,
    "@bb-app/store(배럴)를 그대로 import 하면 안 된다 — @bb-app/store/refetch-limit 나 상대경로 잎을 써라",
  );
  assert.match(
    DATE_WINDOW,
    /from\s+"(@bb-app\/store\/refetch-limit|\.\.\/packages\/store\/src\/refetch-limit\.ts)"/,
    "MAX_REFETCH_DATES 를 잎 서브패스(또는 상대경로 잎)에서 가져와야 한다",
  );
});

test("⚠I1 refetch-limit.ts 는 import 가 0개인 잎 파일이다", () => {
  assert.equal(/^\s*import\b/m.test(REFETCH_LIMIT), false, "refetch-limit.ts 에 import 문이 있으면 안 된다 — 그 자체가 배럴을 끌어올 수 있다");
});

/**
 * ⚠**`update.ts` 의 재수집 배선을 소스로 고정한다**(2026-09-26 · 3중 검토 2차 F3).
 * `update.ts` 는 import 하는 순간 수집을 시작하므로 실행 시험을 할 수 없다(`date-window.ts` 머리말) — 검증 함수
 * (`parseRefetchDates`)는 시험이 있지만 **그것을 부르고 결과대로 멈추는 배선**은 아무도 안 쟀다. 한 줄만 빠져도
 * 틀린 입력으로 수집이 돌거나(종료 2 없음) 재수집 날짜가 무시되고 평소 창을 받는다(`refetch.dates ??` 없음) — 둘 다 초록인 채로.
 * ⚠주석은 걷어내고 본다(주석 속 낱말이 판정을 흐리지 않게).
 */
const UPDATE = readFileSync(fileURLToPath(new URL("../update.ts", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n")
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

test("⚠14b update.ts 는 BB_REFETCH_DATES 를 검증 함수로 읽고 · 틀리면 아무것도 받기 전에 종료 2 로 멈춘다", () => {
  const calls = UPDATE.match(/parseRefetchDates\(process\.env\["BB_REFETCH_DATES"\]\)/g) ?? [];
  assert.equal(calls.length, 1, `parseRefetchDates(process.env["BB_REFETCH_DATES"]) 호출이 ${calls.length}곳이다(1곳이어야 한다)`);
  const invalid = topBlock("if (!refetch.ok) {");
  assert.match(invalid, /process\.exit\(2\)/, "틀린 BB_REFETCH_DATES 에서 종료 2 로 멈추지 않는다 — 틀린 입력으로 수집이 돈다");
  const firstRun = UPDATE.indexOf("run(`");
  assert.notEqual(firstRun, -1, "수집 단계(run)를 못 찾았다 — 이 순서 검사가 공회전한다");
  assert.ok(firstRun > UPDATE.indexOf("if (!refetch.ok) {"), "검증이 첫 수집(run) 뒤에 있다 — 틀린 입력으로 일부를 받은 뒤에 멈춘다");
});

test("⚠14c 재수집 날짜가 수집 창을 대신한다(`refetch.dates ??`) · --date · --today 와 같이 주면 각각 종료 2", () => {
  assert.match(UPDATE, /const dates = refetch\.dates \?\? targetDates\(/, "재수집 날짜가 수집 창을 대신하지 않는다 — 평소 창을 받는다");
  assert.match(topBlock("if (refetch.dates !== null && values.date !== undefined) {"), /process\.exit\(2\)/, "--date 와 같이 줘도 멈추지 않는다");
  assert.match(topBlock("if (refetch.dates !== null && values.today === true) {"), /process\.exit\(2\)/, "--today 와 같이 줘도 멈추지 않는다");
});

/**
 * ⚠**재수집 실행의 「앞으로의 일정」 시즌은 JST 의 올해다**(2026-09-26 · 3중 검토 1차 P3 · 2차 F4).
 * 재수집 날짜는 지난 날짜이고 작년일 수 있다 — 마지막 날짜의 해를 쓰면 그 실행은 올해 일정을 건너뛴다.
 * 시계는 진입점에서 **한 번** 읽은 `now` 를 수집 창과 같이 쓴다(M6 · `clock-injection.test.ts` 가 개수를 센다).
 */
test("⚠14d 재수집이면 앞으로의 일정 시즌은 jstDate(now) 의 해 · 평소는 마지막 대상일의 해 · load-upcoming 에 그 값이 간다", () => {
  assert.match(UPDATE, /const now = new Date\(\);/, "진입점 시계 `now` 가 없다");
  assert.match(UPDATE, /targetDates\(now,/, "수집 창이 같은 `now` 를 쓰지 않는다");
  assert.match(
    UPDATE,
    /const upcomingSeason = refetch\.dates !== null \? jstDate\(now\)\.slice\(0, 4\) :\s*dates\[dates\.length - 1\]!\.slice\(0, 4\);/,
    "재수집 갈래가 JST 올해를 쓰지 않는다 — 작년 날짜를 재수집하면 올해 일정을 건너뛴다",
  );
  const at = UPDATE.indexOf('run("앞으로의 일정 적재", [');
  assert.notEqual(at, -1, "앞으로의 일정 적재 단계를 못 찾았다");
  const args = UPDATE.slice(at, UPDATE.indexOf("])", at));
  assert.match(args, /\bupcomingSeason\b/, "load-upcoming 에 upcomingSeason 이 안 간다");
  assert.ok(!args.includes("dates[dates.length - 1]"), "load-upcoming 인자가 여전히 마지막 대상일을 직접 쓴다");
});
