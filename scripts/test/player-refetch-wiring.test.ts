/**
 * 선수 페이지 **아카이브 옛 판**의 자기 치유 배선(감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5-4 · 시험 3-18).
 *
 * ⚠**`update.ts` 는 import 하는 순간 수집을 시작한다** — 실행 시험을 할 수 없어 소스를 정적으로 본다(`refetch-wiring.test.ts` 선례).
 * ⚠**이 배선이 빠지면 옛 판이 영구히 남는다** — 선수 적재기의 판 가드가 옛 사본을 건너뛰어 DB 를 지켜도, 선정기가 DB 만 보면
 *   그 선수를 신선하다고 보고 다시 받지 않는다(설계 §1-1 사실 1). 가드는 매 실행 걸리고 경고만 쌓인다.
 * ⚠**순서가 곧 치유다** — 선정·재취득 → 신규 → **적재** 순이라, 뽑힌 선수는 적재 **전에** 새 사이드카를 얻어 같은 실행에서 풀린다.
 * ⚠주석은 걷어내고 본다(주석 속 낱말이 판정을 흐리지 않게).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** ⚠줄끝을 `\n` 으로 맞춰 읽는다 — Windows 체크아웃은 CRLF 다(`refetch-wiring.test.ts` 와 같은 이유) */
const UPDATE = readFileSync(fileURLToPath(new URL("../update.ts", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(?<!:)\/\/[^\n]*/g, "");

/** `open` 의 `[` 와 짝이 되는 `]` — 인자 안의 `values["player-limit"]` 같은 대괄호를 건너뛴다(문자열 리터럴 안은 세지 않는다) */
function closingBracket(open: number): number {
  let depth = 0;
  for (let i = open; i < UPDATE.length; i += 1) {
    const c = UPDATE[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < UPDATE.length && UPDATE[i] !== c; i += 1) if (UPDATE[i] === "\\") i += 1;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`대괄호 짝을 못 찾았다(위치 ${open})`);
}

/** 호출 인자 배열(`[` … `]`) — `literal` 이 든 배열 */
function argsOf(literal: string): string {
  const at = UPDATE.indexOf(literal);
  assert.notEqual(at, -1, `update.ts 가 ${literal} 를 부르지 않는다`);
  assert.equal(UPDATE.indexOf(literal, at + 1), -1, `${literal} 호출이 두 곳 이상이다`);
  const open = UPDATE.lastIndexOf("[", at);
  assert.notEqual(open, -1, `${literal} 의 인자 배열을 못 찾았다`);
  return UPDATE.slice(open, closingBracket(open) + 1);
}

test("⚠N3 3-18 · update.ts 의 재취득 선정 호출이 --archive 다음 values.archive 를 넘긴다", () => {
  const args = argsOf('"packages/store/tools/emit-stale-player-ids.ts"');
  assert.match(args, /"--archive",\s*values\.archive\b/, `선정기에 아카이브 루트를 안 넘긴다 — 옛 판이 영구히 남는다\n${args}`);
  // 적재기와 같은 아카이브를 봐야 한다 — 선수 적재 단계도 values.archive 를 쓴다
  assert.match(argsOf('"packages/store/tools/load-players.ts"'), /values\.archive\b/, "선수 적재가 다른 아카이브를 본다");
});

/**
 * ⚠**선수 적재에 이번 실행의 시작 시각을 넘긴다**(2026-09-27 · 반영분 재검토 P2 · 설계 §5-2 5번). 기준선 없는 행에 다른 본문이 오면
 * 적재기는 「이번 실행에서 받은 200」이라는 증명(본 시각 ≥ 실행 시작)이 있을 때만 새 판으로 받는다 — 이 인자가 빠지면 증명이 없어
 * 그 선수는 같은 실행에서 다시 받아도 **판 모름(종료 1)** 으로 남는다. 값은 `update.ts` 가 **한 번 읽은** 시계(`now` · M6)다.
 */
test("⚠반영분 재검토 P2 · update.ts 의 선수 적재 호출이 --run-started-at 다음 now.toISOString() 을 넘긴다", () => {
  const args = argsOf('"packages/store/tools/load-players.ts"');
  assert.match(args, /"--run-started-at",\s*now\.toISOString\(\)/, `선수 적재에 실행 시작을 안 넘긴다 — 기준선 없는 행이 같은 실행에서 안 풀린다\n${args}`);
  // `now` 는 update.ts 가 한 번 읽는 시계다(두 번 읽으면 판정 범위와 증명이 서로 다른 「지금」을 본다)
  assert.equal((UPDATE.match(/\bconst now = new Date\(\)/g) ?? []).length, 1, "update.ts 가 시계를 한 번만 읽지 않는다");
});

test("⚠N3 3-18 · 순서 — 재취득 선정 → 낡은 선수 재취득 → 신규 선수 → 선수 프로필 적재", () => {
  const at = (needle: string): number => {
    const i = UPDATE.indexOf(needle);
    assert.notEqual(i, -1, `update.ts 에 ${needle} 가 없다`);
    return i;
  };
  const select = at('"packages/store/tools/emit-stale-player-ids.ts"');
  const refetch = at('run("낡은 선수 프로필 재취득"');
  const fresh = at('run("신규 선수 프로필"');
  const load = at('run("선수 프로필 적재"');
  assert.ok(select < refetch && refetch < fresh && fresh < load, "선정·재취득이 적재 뒤에 있다 — 옛 판이 같은 실행에서 안 풀린다");
});
