/**
 * 아카이브 축소 감지.
 *
 * ⚠**이 테스트가 지키는 것은 소급 불가능한 자산이다.** 복원이 조용히 실패한 채
 * 덮어쓰면 아카이브가 한 번에 사라지고, npb.jp에서 다시 받을 수 있는 것은 최근 2시즌뿐이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNotShrunk, countArchive, readManifest } from "../../../scripts/archive-guard.ts";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-guard-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("`.gz`만 센다 — meta JSON은 파일마다 딸려 다녀 두 배가 된다", async () => {
  await withDir(async (dir) => {
    await mkdir(join(dir, "npb", "games"), { recursive: true });
    await writeFile(join(dir, "npb", "games", "a.html.gz"), "xx");
    await writeFile(join(dir, "npb", "games", "a.meta.json"), "{}");
    await writeFile(join(dir, "npb", "games", "b.html.gz"), "yyy");
    const c = countArchive(dir);
    assert.equal(c.files, 2);
    assert.equal(c.bytes, 5);
  });
});

test("깊은 디렉터리도 센다", async () => {
  await withDir(async (dir) => {
    await mkdir(join(dir, "a", "b", "c"), { recursive: true });
    await writeFile(join(dir, "a", "b", "c", "x.html.gz"), "z");
    assert.equal(countArchive(dir).files, 1);
  });
});

test("없는 디렉터리는 0건이다 — 던지지 않는다", () => {
  assert.deepEqual(countArchive(join(tmpdir(), "bb-존재하지-않음")), { files: 0, bytes: 0 });
});

test("⚠줄어들면 이유를 돌려준다", () => {
  const problem = checkNotShrunk({ files: 12 }, { files: 3354, bytes: 1, updatedAt: "" });
  assert.notEqual(problem, null);
  assert.match(problem!, /3354건 → 12건/);
  assert.match(problem!, /아카이브가 사라진다/);
});

test("같거나 늘면 통과한다 — 경기 없는 날은 늘지 않는다", () => {
  assert.equal(checkNotShrunk({ files: 3354 }, { files: 3354, bytes: 1, updatedAt: "" }), null);
  assert.equal(checkNotShrunk({ files: 3400 }, { files: 3354, bytes: 1, updatedAt: "" }), null);
});

test("⚠한 건만 줄어도 멈춘다 — 「거의 같으니 괜찮다」를 만들지 않는다", () => {
  assert.notEqual(checkNotShrunk({ files: 3353 }, { files: 3354, bytes: 1, updatedAt: "" }), null);
});

test("기록이 없으면 통과한다 — 첫 실행이다", () => {
  assert.equal(checkNotShrunk({ files: 0 }, null), null);
});

test("망가진 기록은 없는 것으로 다룬다 — 파싱 실패로 배치를 멈추지 않는다", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "m.json");
    await writeFile(path, "이건 JSON이 아니다");
    assert.equal(readManifest(path), null);
    await writeFile(path, '{"files":"많음"}');
    assert.equal(readManifest(path), null, "files가 숫자가 아니면 신뢰하지 않는다");
    await writeFile(path, '{"files":10,"bytes":20,"updatedAt":"2026-08-15T00:00:00.000Z"}');
    assert.deepEqual(readManifest(path), {
      files: 10,
      bytes: 20,
      updatedAt: "2026-08-15T00:00:00.000Z",
    });
  });
});

test("없는 기록 파일도 null이다", () => {
  assert.equal(readManifest(join(tmpdir(), "bb-없는-파일.json")), null);
});
