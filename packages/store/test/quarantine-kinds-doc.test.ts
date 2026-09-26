/**
 * `packages/store/README.md` 의 격리 종류 표가 **정본(`derive.ts` 의 `QuarantineRow["kind"]` 유니온)과 같은가**.
 *
 * ⚠**표가 정본보다 낡아 있었다**(2026-09-26 · 3중 검토 2차 B). 10종 중 4종만 적었고, 그중 `paMismatch` 는
 * 감사 C11 이 지운 가드의 뜻(「분류 합계가 타석 수를 넘는다 = 분류 규칙이 빠졌다」)으로 적혀 있었다 —
 * 지금 `paMismatch` 는 `align.ts` 만 내고 뜻은 **박스·경과 타석 수 불일치**다.
 * 문서가 없는 뜻을 말하면 격리 화면의 표본을 보는 사람이 **엉뚱한 규칙을 고친다.**
 * ⚠유니온은 타입이라 실행 중에 열거할 수 없다 — 소스 글자에서 뽑는다(블록 주석을 먼저 걷어낸다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** ⚠이 체크아웃은 CRLF 일 수 있다 — 줄 단위로 읽기 전에 맞춘다 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function unionKinds(): string[] {
  const src = read("../src/derive.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = /export interface QuarantineRow \{[\s\S]*?\bkind:([\s\S]*?);/.exec(src)?.[1];
  assert.ok(body !== undefined, "derive.ts 에서 QuarantineRow 의 kind 유니온을 못 찾았다 — 이 시험의 뽑기 규칙이 낡았다");
  return [...body.matchAll(/"(\w+)"/g)].map((m) => m[1]!).sort();
}

function readmeKinds(): { kinds: string[]; section: string } {
  const md = read("../README.md");
  const section = /\n## 격리 \(quarantine\)\n([\s\S]*?)(?=\n## |$)/.exec(md)?.[1];
  assert.ok(section !== undefined, "README 에 「## 격리 (quarantine)」 절이 없다");
  const kinds: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const first = line.split("|")[1] ?? "";
    for (const m of first.matchAll(/`(\w+)`/g)) kinds.push(m[1]!);
  }
  return { kinds: kinds.sort(), section };
}

test("README 의 격리 종류 표가 derive.ts 의 유니온과 같다 — 빠진 것도 없는 것도 없다", () => {
  const union = unionKinds();
  assert.ok(union.length >= 10, `유니온에서 ${union.length}종만 뽑혔다 — 뽑기 규칙을 의심하라`);
  const { kinds } = readmeKinds();
  const missing = union.filter((k) => !kinds.includes(k));
  const extra = kinds.filter((k) => !union.includes(k));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `README 표가 정본과 갈렸다 — 유니온 ${union.length}종 · 표 ${kinds.length}종`);
});

test("README 는 정본이 derive.ts 의 유니온이라고 말하고, paMismatch 를 지운 가드의 뜻으로 적지 않는다", () => {
  const { section } = readmeKinds();
  assert.match(section, /정본은 `packages\/store\/src\/derive\.ts`/, "표 머리에 정본이 어디인지 안 적었다");
  assert.doesNotMatch(section, /분류 합계가 타석 수를 넘는다/, "paMismatch 가 감사 C11 이 지운 가드의 뜻으로 남아 있다");
  // ⚠**표 행만** 본다 — 표 위 안내문에도 `paMismatch` 가 나온다(처음에 그 줄을 집어 헛실패가 났다)
  const pa = section.split("\n").find((l) => l.startsWith("|") && l.includes("`paMismatch`")) ?? "";
  assert.match(pa, /align\.ts/, "paMismatch 를 누가 내는지(align.ts) 안 적었다");
});
