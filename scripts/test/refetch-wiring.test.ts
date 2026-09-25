/**
 * 재수집 입력의 배선(설계 D4 · 시험 14).
 * ⚠`run:` 안에 `${{ inputs.refetch_dates }}` 를 직접 쓰면 입력이 셸 코드로 끼어든다(스크립트 인젝션). **환경변수로만** 넘긴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const YML = readFileSync(fileURLToPath(new URL("../../.github/workflows/daily.yml", import.meta.url)), "utf8");

test("14 수동 실행에 refetch_dates 입력이 있다", () => {
  assert.match(YML, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+refetch_dates:/);
});

test("⚠14 입력은 수집 단계의 env 로만 쓰인다 — run: 에 직접 나오지 않는다", () => {
  const uses = [...YML.matchAll(/inputs\.refetch_dates/g)].length;
  assert.equal(uses, 1, "정확히 한 곳(env)에서만 읽어야 한다");
  assert.match(YML, /\n\s+BB_REFETCH_DATES: \$\{\{ inputs\.refetch_dates \}\}\n/);
  const step = YML.slice(YML.indexOf("- name: 수집·적재"), YML.indexOf("- name: 드래프트 적재"));
  assert.ok(step.includes("BB_REFETCH_DATES:"), "수집·적재 단계의 env 에 있어야 한다");
});
