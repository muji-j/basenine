import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, PRESETS, blocksFor, presetsFor } from "../src/blocks.ts";

test("블록 수를 고정한다 — 하나 빠지면 조립 UI에서 조용히 사라진다", () => {
  assert.equal(BLOCKS.length, 7);
  assert.equal(new Set(BLOCKS.map((b) => b.id)).size, 7);
});

test("모든 블록에 이름과 설명이 있다 — 이름만으로는 고를 수 없다", () => {
  for (const b of BLOCKS) {
    assert.ok(b.name.length > 0, `${b.id}에 이름이 없다`);
    assert.ok(b.desc.length > 0, `${b.id}에 설명이 없다`);
  }
});

test("프리셋은 존재하는 블록만 가리킨다", () => {
  const known = new Set(BLOCKS.map((b) => b.id));
  for (const p of PRESETS) {
    assert.ok(p.blocks.length > 0, `${p.id}가 비어 있다`);
    for (const id of p.blocks) assert.ok(known.has(id), `${p.id}가 모르는 블록을 가리킨다: ${id}`);
  }
});

test("기본 프리셋 standard가 존재한다 — 클라이언트의 초기 상태가 이걸 가정한다", () => {
  assert.ok(PRESETS.some((p) => p.id === "standard"));
});

test("투수에게는 타자용 블록을 주지 않는다 — 빈 화면보다 없는 편이 정직하다", () => {
  const ids = blocksFor("pitcher").map((b) => b.id);
  assert.ok(!ids.includes("splits"));
  assert.ok(!ids.includes("situation"));
  assert.ok(ids.includes("standard"));
  assert.equal(blocksFor("batter").length, BLOCKS.length);
});

test("투수 프리셋도 투수 블록만 가리킨다", () => {
  const allowed = new Set(blocksFor("pitcher").map((b) => b.id));
  for (const p of presetsFor("pitcher")) {
    assert.ok(p.blocks.length > 0, `${p.id}가 비어 있다`);
    for (const id of p.blocks) assert.ok(allowed.has(id), `${p.id}가 타자 블록을 가리킨다: ${id}`);
  }
});
