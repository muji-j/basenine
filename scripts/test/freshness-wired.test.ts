/**
 * 감시 스크립트가 **증거 → 판정 한 벌에 실제로 이어져 있는가** — 프로세스로 띄워서 잰다.
 *
 * 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D10 · D11)
 * ⚠판정 규칙 자체는 `packages/domain/test/collection-verdict.test.ts`·`packages/store/test/collection-evidence.test.ts` 가 잰다.
 * 여기는 **연결**만 본다 — 종료 코드 · 새 표가 없는 DB · JSONL 의 새 필드. 오늘 날짜에 기대지 않는 입력만 쓴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "@bb-app/store";

const SCRIPT = fileURLToPath(new URL("../freshness.ts", import.meta.url));

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-fresh-wired-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠수집 판정 증거 표가 없는 DB 면 조용히 틀리지 않고 exit 2", () => withDir(async (dir) => {
  const path = join(dir, "old.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec("CREATE TABLE game (game_id TEXT, game_date TEXT, status TEXT)");
  raw.close();
  const r = spawnSync(process.execPath, [SCRIPT, path, "2"], { encoding: "utf8" });
  assert.equal(r.status, 2, `새 표 없는 DB 를 판정했다: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /마이그레이션 021/);
}));

test("빈 DB — no-games · period unknown · exit 1 · JSONL 에 새 필드가 있다", () => withDir(async (dir) => {
  const path = join(dir, "empty.sqlite");
  openDb(path, "2026-09-11T00:00:00.000Z").close();
  const log = join(dir, "log.jsonl");
  const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--json", log], { encoding: "utf8" });
  assert.equal(r.status, 1, `빈 DB 를 정상으로 봤다: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /판정 근거: 모름/);
  const rec = JSON.parse((await readFile(log, "utf8")).trim()) as Record<string, unknown>;
  assert.deepEqual(rec.staleReasons, ["no-games"]);
  assert.equal(rec.stale, true);
  assert.equal(rec.period, "unknown");
  assert.equal(rec.missedPlayed, 0);
  assert.equal(rec.missedAnnounced, 0);
  assert.equal(rec.missedEarliest, null);
}));

test("⚠--json 뒤에 경로가 없으면 종료 코드 2 가 남는다(예전엔 마지막 줄이 1/0 으로 덮었다)", () => withDir(async (dir) => {
  const path = join(dir, "empty.sqlite");
  openDb(path, "2026-09-11T00:00:00.000Z").close();
  const r = spawnSync(process.execPath, [SCRIPT, path, "2", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 2, "인자 오류를 사유 판정으로 덮었다");
}));
