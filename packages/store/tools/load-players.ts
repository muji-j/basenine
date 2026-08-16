/**
 * 아카이브한 선수 페이지 → `player` 테이블의 속성 컬럼.
 *
 *   node packages/store/tools/load-players.ts data/archive data/bb.sqlite
 *
 * ⚠**투타를 못 읽은 선수를 임의로 채우지 않는다.** null로 두고 몇 명인지 보고한다 —
 * 좌우 스플릿의 근거이므로 모르는 채로 섞이면 스플릿이 조용히 틀린다.
 */
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parsePlayerProfile } from "@bb-app/parser";
import { openDb } from "../src/db.ts";

const [archiveRoot, dbPath] = process.argv.slice(2);
if (!archiveRoot || !dbPath) {
  console.error("usage: node tools/load-players.ts <archive-root> <db-path>");
  process.exit(2);
}

const nowIso = new Date().toISOString();
const dir = join(archiveRoot, "npb", "players");

let files: string[];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".html.gz"));
} catch {
  console.error(`선수 페이지 디렉터리가 없다: ${dir}`);
  process.exit(1);
}

const db = openDb(dbPath, nowIso);
const stmt = db.raw.prepare(
  `UPDATE player SET position = ?, throws = ?, bats = ?, birth_date = ?, physique = ?,
     kana = ?, uniform_number = ?, profile_fetched_at = ?
   WHERE player_id = ?`,
);

let updated = 0;
let missing = 0;
let failed = 0;
let noHand = 0;
const unknownPlayers: string[] = [];

db.transaction(() => {
  for (const f of files) {
    const playerId = f.replace(/\.html\.gz$/, "");
    let profile;
    try {
      // 트랜잭션 안이라 동기 읽기를 쓴다 — await 하면 트랜잭션이 열린 채로 이벤트 루프가 돈다.
      profile = parsePlayerProfile(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
    } catch (err) {
      failed += 1;
      console.error(`PARSE ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (profile.throws === null || profile.bats === null) {
      noHand += 1;
      unknownPlayers.push(playerId);
    }
    stmt.run(
      profile.position,
      profile.throws,
      profile.bats,
      profile.birthDate,
      profile.physique,
      profile.kana,
      profile.uniformNumber,
      nowIso,
      playerId,
    );
    const changes = db.raw.prepare("SELECT changes() AS n").get() as { n: number };
    if (changes.n === 0) missing += 1;
    else updated += 1;
  }
});

const total = (db.raw.prepare("SELECT COUNT(*) AS n FROM player").get() as { n: number }).n;
const withHand = (
  db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE throws IS NOT NULL AND bats IS NOT NULL").get() as {
    n: number;
  }
).n;

console.log(`선수 페이지 ${files.length}장 · 갱신 ${updated} · DB에 없는 선수 ${missing} · 파싱 실패 ${failed}`);
console.log(`투타 확인 ${withHand} / 전체 ${total}명 (미상 ${total - withHand}명)`);
// ⚠**분모를 같이 낸다.** 「카나 있음 737」만 내면 121명이 빠진 것인지 그런 선수가 없는 것인지 모른다.
// ⚠등번호 없음은 **결손이 아니라 「지금 등록이 없다」**(M11) — 은퇴·이적 선수다
const withKana = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE kana IS NOT NULL").get() as { n: number }).n;
const withNo = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE uniform_number IS NOT NULL").get() as { n: number }).n;
console.log(`읽는 법 ${withKana} / 전체 ${total}명 · 등번호 ${withNo} / 전체 ${total}명(없음 = 현役登録なし)`);
if (unknownPlayers.length > 0) {
  console.log(`⚠투타를 읽지 못한 선수: ${unknownPlayers.slice(0, 10).join(", ")}${unknownPlayers.length > 10 ? " …" : ""}`);
}

db.close();
process.exitCode = failed > 0 ? 1 : 0;
