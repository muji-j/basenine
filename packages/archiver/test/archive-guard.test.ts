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
import {
  BYTES_DROP_FLOOR,
  BYTES_DROP_RATIO,
  checkNotShrunk,
  countArchive,
  readManifest,
} from "../../../scripts/archive-guard.ts";

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

/**
 * **바이트 대조** — ⚠**기록만 되고 한 번도 대조되지 않던 값이다**(2026-08-21 감사 [4]-③).
 *
 * 파일 수는 **없어진 것**을 잡고, 바이트는 **잘린 것**을 잡는다. 파일이 다 있는데 내용이 모자라면
 * 파일 수 검사는 통과시킨다 — 그리고 그 상태로 보관소에 올라간다.
 *
 * ## ⚠임계는 손으로 고르지 않았다
 *
 * `ops/archive-manifest.json` 의 git 이력 **58개 · 연속 쌍 57**(2026-08-15~08-24)을 실측했다:
 * **`files` 감소 0/57** · **`bytes` 감소 15/57(26.3%)** · **최악 −96,769 B(0.035%)**.
 * 살아 있는 페이지(일정·予告先発)를 다시 받으면 gz 가 작아질 수 있어서다.
 * → 「줄면 실패」로 두면 **네 번에 한 번 거짓 경보**가 난다. 실측 최악의 약 14배인 **0.5%** 로 뒀다.
 */
const PREV = { files: 33207, bytes: 280_226_044, updatedAt: "" };

test("⚠파일 수는 그대로인데 크게 줄면 잡는다 — 잘려 들어온 것이다", () => {
  const drop = Math.floor(Math.max(BYTES_DROP_FLOOR, PREV.bytes * BYTES_DROP_RATIO)) + 1;
  const problem = checkNotShrunk({ files: PREV.files, bytes: PREV.bytes - drop }, PREV);
  assert.ok(problem !== null, "크게 줄었는데 통과시켰다");
  assert.match(problem!, /잘려/);
});

/** ⚠**실측으로 관측된 최악의 감소는 통과해야 한다** — 안 그러면 매일 운다 */
test("⚠실측 최악(−96,769 B)은 통과한다 — 매일 우는 게이트를 만들지 않는다", () => {
  assert.equal(checkNotShrunk({ files: PREV.files, bytes: PREV.bytes - 96_769 }, PREV), null);
});

test("⚠경계에서 정확히 갈린다 — 허용치까지는 통과, 1바이트 더는 실패", () => {
  // ⚠**정수다** — 분수로 재면 부동소수 잡음이 경계를 미끄러뜨린다(실제로 그랬다)
  const allow = Math.floor(Math.max(BYTES_DROP_FLOOR, PREV.bytes * BYTES_DROP_RATIO));
  assert.equal(checkNotShrunk({ files: PREV.files, bytes: PREV.bytes - allow }, PREV), null, "허용치가 통과 안 된다");
  assert.ok(checkNotShrunk({ files: PREV.files, bytes: PREV.bytes - allow - 1 }, PREV) !== null, "허용치+1 이 통과됐다");
});

/** ⚠**늘어나는 것은 정상이다** — 경기가 들어오면 늘어난다 */
test("바이트가 늘면 통과한다", () => {
  assert.equal(checkNotShrunk({ files: PREV.files + 4, bytes: PREV.bytes + 1_000_000 }, PREV), null);
});

/**
 * ⚠**작은 아카이브에서 비율만 쓰면 시험이 못 돈다** — 1,000 B 의 0.5% 는 5 B 다.
 * 절대 하한이 그것을 막는다.
 */
test("⚠작은 아카이브는 절대 하한이 지킨다 — 몇 바이트로 울지 않는다", () => {
  const tiny = { files: 3, bytes: 1_000, updatedAt: "" };
  assert.equal(checkNotShrunk({ files: 3, bytes: 500 }, tiny), null, "작은 아카이브에서 울었다");
});

/** ⚠**파일 수 감소가 먼저다** — 둘 다 나빠도 더 무거운 쪽을 말한다 */
test("파일 수가 줄면 그쪽을 먼저 말한다", () => {
  const problem = checkNotShrunk({ files: PREV.files - 1, bytes: 0 }, PREV);
  assert.ok(problem !== null);
  assert.match(problem!, /건 →/);
});
