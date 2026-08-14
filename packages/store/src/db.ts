/**
 * 데이터베이스 개설과 마이그레이션.
 *
 * 로컬 개발은 `node:sqlite`로, 배포는 Cloudflare D1로 한다. **둘 다 SQLite이므로
 * SQL은 한 벌이면 된다** — 방언을 쓰지 않는 것이 그 전제다.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface Db {
  readonly raw: DatabaseSync;
  close(): void;
}

/** 적용된 마이그레이션 목록을 기록하는 표. 마이그레이션 자체보다 먼저 만든다. */
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migration (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
`;

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * 데이터베이스를 열고 미적용 마이그레이션을 적용한다.
 * 이미 적용된 것은 건너뛴다 — 재실행이 안전해야 한다.
 *
 * @param nowIso 적용 시각. **주입한다**(M6 — 시계를 직접 읽지 않는다)
 */
export function openDb(path: string, nowIso: string): Db {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(BOOTSTRAP);

  const applied = new Set(
    (raw.prepare("SELECT name FROM schema_migration").all() as { name: string }[]).map((r) => r.name),
  );

  for (const name of listMigrations()) {
    if (applied.has(name)) continue;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
    raw.prepare("INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)").run(name, nowIso);
  }

  return {
    raw,
    close: () => raw.close(),
  };
}
