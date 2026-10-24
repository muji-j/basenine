/**
 * **문서·고정 수치가 「완결 시즌」이라고 부르는 범위**(`DOC_SEASONS`)와 **연례 갱신 알림**(`docSeasonsToAdd`).
 *
 * ⚠**범위 자체(2018〜2025)를 여기서 다시 적지 않는다** — 적으면 범위를 올리는 날 두 곳을 고쳐야 하고,
 * 한쪽만 고치면 어느 쪽이 정본인지 모른다(M1). 여기서는 **모양**(오름차순 · 중복 없음 · 얼어 있음)과
 * **알림 규칙**만 못 박는다. 범위가 DB 와 맞는가는 DB 시험들이 가드로 잰다(`steal-seasons` · `doc-figures`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOC_SEASONS, docSeasonsToAdd } from "../src/index.ts";

test("범위는 오름차순 · 중복 없음 · 정수 · 비어 있지 않다 — 시험들이 「첫 해 〜 마지막 해」로 읽는다", () => {
  assert.ok(DOC_SEASONS.length > 0, "범위가 비었다 — 고정 수치 시험이 전부 공회전한다");
  for (const s of DOC_SEASONS) assert.ok(Number.isInteger(s), `${s} 는 정수가 아니다`);
  const sorted = [...DOC_SEASONS].sort((a, b) => a - b);
  assert.deepEqual([...DOC_SEASONS], sorted, "오름차순이 아니다");
  assert.equal(new Set(DOC_SEASONS).size, DOC_SEASONS.length, "중복이 있다");
});

test("⚠범위는 얼어 있다 — 시험 하나가 고치면 다른 시험이 다른 범위로 센다", () => {
  assert.ok(Object.isFrozen(DOC_SEASONS), "DOC_SEASONS 가 얼어 있지 않다");
  assert.throws(() => (DOC_SEASONS as number[]).push(2099), TypeError);
});

test("⚠끝났는데 범위 밖인 시즌만 알린다 — 오름차순 · 중복 없이", () => {
  const first = DOC_SEASONS[0]!;
  const last = DOC_SEASONS.at(-1)!;
  // 범위 안의 시즌이 끝난 것은 정상이다
  assert.deepEqual(docSeasonsToAdd(DOC_SEASONS), []);
  // 시즌이 끝났다(다음 해) · 백필했다(앞의 해) — 둘 다 범위를 올릴 사건이다
  assert.deepEqual(docSeasonsToAdd([last + 1, first, first - 1, last + 1]), [first - 1, last + 1]);
});

test("⚠범위 안인데 아직 안 끝난 시즌은 이 알림이 말하지 않는다 — 그건 시험의 가드가 막는다", () => {
  const last = DOC_SEASONS.at(-1)!;
  // `last` 가 끝나지 않았다고 해도(입력에 없다) 알림은 비어 있다 — 「범위를 너무 일찍 올렸다」는 doc-figures 가드의 몫이다
  assert.deepEqual(docSeasonsToAdd(DOC_SEASONS.filter((s) => s !== last)), []);
});

test("범위를 넘겨 줄 수 있다 — 알림 규칙만 따로 잰다", () => {
  assert.deepEqual(docSeasonsToAdd([2024, 2025, 2026], [2024, 2025]), [2026]);
  assert.deepEqual(docSeasonsToAdd([], [2024]), []);
});
