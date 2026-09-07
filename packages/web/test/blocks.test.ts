import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, PRESETS, blocksFor, presetsFor } from "../src/blocks.ts";

test("블록 수를 고정한다 — 하나 빠지면 조립 UI에서 조용히 사라진다", () => {
  // 2026-08-17: 通算成績(career) 추가로 10 → 11
  // 2026-08-20: カウント別(count) · 火消し(relief) 추가로 11 → 13
  assert.equal(BLOCKS.length, 13);
  assert.equal(new Set(BLOCKS.map((b) => b.id)).size, 13);
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

test("⚠득점기대치는 투수에게 주지 않는다 — 빈 화면보다 없는 편이 정직하다", () => {
  const ids = blocksFor("pitcher").map((b) => b.id);
  assert.ok(!ids.includes("situation"), "타석에 선 쪽의 이야기를 투수 페이지에 붙였다");
  assert.ok(ids.includes("standard"));
});

/**
 * ⚠**2026-09-07 에 뒤집혔다.** 예전 시험은 「연속 기록은 투수에게 주지 않는다 — 타석이 주역인
 * 기록이다」였는데, 투수에게도 주역인 연속 기록이 있다: **連続無失点登板 · 連続無失点イニング**.
 * ⚠**같은 블록 id 를 쓴다** — 사용자에게는 둘 다 「連続記録」이고, 한 페이지가 둘 다 그리지 않는다
 * (`renderBlock` 이 `role` 로 가른다). 블록을 둘로 쪼개면 조립 UI 에 **자기 역할에 없는 이름**이
 * 하나 더 뜬다.
 */
test("⚠연속 기록은 양쪽에 있다 — 투수 쪽은 連続無失点이고 타자 쪽과 세는 것이 다르다", () => {
  assert.ok(blocksFor("pitcher").map((b) => b.id).includes("streak"));
  assert.ok(blocksFor("batter").map((b) => b.id).includes("streak"));
});

/**
 * ⚠**설명문이 목록보다 늦게 낡는다.** `PITCHER_BLOCKS` 에 `streak` 를 넣은 순간
 * 「打者のみ」가 거짓이 됐는데 **타입도 시험도 그것을 몰랐다**(설명문은 자유 문자열이다).
 * → **역할별 목록과 설명문이 어긋나지 않는지 여기서 센다.**
 */
test("⚠양쪽에 나오는 블록의 설명문이 「〜のみ」라고 말하지 않는다", () => {
  const bat = new Set(blocksFor("batter").map((b) => b.id));
  const pit = new Set(blocksFor("pitcher").map((b) => b.id));
  for (const b of BLOCKS) {
    if (!bat.has(b.id) || !pit.has(b.id)) continue;
    assert.ok(
      !b.desc.includes("打者のみ") && !b.desc.includes("投手のみ"),
      `${b.id} は両方に出るのに説明文が「〜のみ」と言っている: ${b.desc}`,
    );
  }
});

test("⚠선발·구원별은 타자에게 주지 않는다 — 반대 방향의 같은 오류다", () => {
  const batter = blocksFor("batter").map((b) => b.id);
  assert.ok(!batter.includes("rolesplit"), "투수 전용 블록이 타자 페이지에 샜다");
  assert.ok(blocksFor("pitcher").map((b) => b.id).includes("rolesplit"));
  // 타자 프리셋에도 새지 않는다 — 목록과 프리셋 양쪽을 걸러야 한다
  for (const p of presetsFor("batter")) {
    assert.ok(!p.blocks.includes("rolesplit"), `${p.id}가 투수 블록을 가리킨다`);
  }
});

test("⚠火消し는 타자에게 주지 않는다 — 타석에 서는 쪽의 이야기가 아니다", () => {
  const batter = blocksFor("batter").map((b) => b.id);
  assert.ok(!batter.includes("relief"), "투수 전용 블록이 타자 페이지에 샜다");
  assert.ok(blocksFor("pitcher").map((b) => b.id).includes("relief"));
  for (const p of presetsFor("batter")) {
    assert.ok(!p.blocks.includes("relief"), `${p.id}가 투수 블록을 가리킨다`);
  }
});

test("カウント別은 양쪽에 있다 — 같은 타석 로그를 반대편에서 읽은 값이다", () => {
  assert.ok(blocksFor("batter").map((b) => b.id).includes("count"));
  assert.ok(blocksFor("pitcher").map((b) => b.id).includes("count"));
});

test("어느 쪽에도 안 나오는 블록이 없다 — 만들어 놓고 아무 데도 안 쓰면 죽은 코드다", () => {
  const shown = new Set([
    ...blocksFor("batter").map((b) => b.id),
    ...blocksFor("pitcher").map((b) => b.id),
  ]);
  const orphan = BLOCKS.filter((b) => !shown.has(b.id)).map((b) => b.id);
  assert.deepEqual(orphan, [], `어디에도 안 나오는 블록: ${orphan.join(", ")}`);
});

test("스플릿은 투수에게도 있다 — 투수 축(対左右打者)을 만들었다", () => {
  assert.ok(blocksFor("pitcher").some((b) => b.id === "splits"));
});

test("투수 프리셋도 투수 블록만 가리킨다", () => {
  const allowed = new Set(blocksFor("pitcher").map((b) => b.id));
  for (const p of presetsFor("pitcher")) {
    assert.ok(p.blocks.length > 0, `${p.id}가 비어 있다`);
    for (const id of p.blocks) assert.ok(allowed.has(id), `${p.id}가 타자 블록을 가리킨다: ${id}`);
  }
});
