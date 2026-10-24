/**
 * 빌드의 낡음 게이트 — `BB_UPSTREAM_OUTAGE=1` 이면 **그 게이트만** 경고로(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D5 · 시험 T10).
 *
 * ⚠워크플로는 `수집·적재` 의 rc 가 75(받기 실패만)일 때만 이 값을 `1` 로 넘긴다. 받기만 실패한 실행은 이미 받은 데이터로 배포하고
 *   화면의 띠가 낡음을 말한다(사용자 결정 ②). ⚠**깨진 링크·중복 id·연락처·우승 판정 등 다른 게이트는 그대로 막는다** —
 *   그것은 실제로 빌드를 돌리는 `build-gates.test.ts` 의 시험이 잰다(끝난 시즌의 판정 부재가 env 와 무관하게 막는다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { staleGate } from "../src/layout.ts";

test("⚠T10 staleGate — BB_UPSTREAM_OUTAGE 가 정확히 「1」 이면 경고만(종료 코드 불변) · 그 밖은 막는다", () => {
  const outage = staleGate("1");
  assert.equal(outage.fatal, false);
  assert.match(outage.message, /^::warning::/);
  assert.match(outage.message, /BB_UPSTREAM_OUTAGE=1/);
  for (const v of [undefined, "", "0", "true", "yes", " 1", "1 "]) {
    const g = staleGate(v);
    assert.equal(g.fatal, true, `${JSON.stringify(v)} 에 막지 않았다`);
    assert.equal(g.message, "⚠ 데이터가 낡았다 — 수집이 멈췄는지 확인하라", "막는 갈래의 문구가 바뀌었다(로그 검색 호환)");
  }
});

/** `build.ts` 에서 `if (result.stale)` 블록(중괄호를 세어 자른다 — `build-gates.test.ts` 의 `gate()` 와 같은 방식) */
function staleBlock(src: string): { start: number; end: number; text: string } {
  const start = src.indexOf("if (result.stale)");
  assert.notEqual(start, -1, "빌드가 낡음 게이트를 안 본다");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, text: src.slice(start, i + 1) };
    }
  }
  assert.fail("낡음 게이트 블록이 닫히지 않는다");
}

test("⚠T10 build.ts — 그 스위치는 낡음 게이트 블록 안에서만 읽힌다(다른 exitCode=1 갈래는 env 와 무관)", () => {
  // ⚠주석은 걷어내고 본다 — 주석 속 낱말이 판정을 흐리지 않게(이 저장소의 다른 소스 시험과 같은 방식)
  const src = readFileSync(join(import.meta.dirname, "..", "tools", "build.ts"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
  const block = staleBlock(src);
  const reads = [...src.matchAll(/BB_UPSTREAM_OUTAGE/g)].map((m) => m.index);
  assert.equal(reads.length, 1, `BB_UPSTREAM_OUTAGE 를 ${String(reads.length)}곳에서 읽는다 — 낡음 게이트 한 곳이어야 한다`);
  assert.ok(reads[0]! > block.start && reads[0]! < block.end, "낡음 게이트 밖에서 그 스위치를 읽는다 — 다른 게이트가 풀릴 수 있다");
  assert.equal((src.match(/staleGate\(/g) ?? []).length, 1);
  assert.match(block.text, /if \(gate\.fatal\) \{[^}]*process\.exitCode = 1;/, "막는 갈래가 종료 코드를 안 세운다");
  // 게이트의 조건이 낡음 하나다 — 다른 판정과 섞이지 않았다(「stale || other」 변이를 막는다)
  assert.match(block.text, /^if \(result\.stale\) \{/);
});
