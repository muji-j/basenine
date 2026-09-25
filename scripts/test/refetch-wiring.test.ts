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
