#!/usr/bin/env node
/**
 * 데이터 신선도 점검.
 *
 *   node scripts/freshness.ts data/bb.sqlite [경고_일수]
 *
 * ⚠**이것이 이 서비스의 주 감시 장치다.** 조사에서 무료 외부 감시 3종이 전부 시한부로
 * 판명됐다(Free에 헬스체크 없음 · GH Actions 60일 · healthchecks.io 1년).
 * 그래서 감시를 제품 안에 둔다 — **제품의 일부인 감시는 만료되지 않는다.**
 *
 * 종료 코드: 낡았으면 1. 크론이 그대로 실패로 잡을 수 있다.
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, staleDaysArg] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/freshness.ts <db-path> [stale-days]");
  process.exit(2);
}
const staleDays = Number(staleDaysArg ?? "2");

const db = new DatabaseSync(dbPath);

const latest = db.prepare(
  "SELECT MAX(game_date) AS d FROM game WHERE status = 'played'",
).get() as { d: string | null };

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM game WHERE status='played') AS games,
    (SELECT COUNT(*) FROM pa_event) AS pa,
    (SELECT COUNT(*) FROM player) AS players,
    (SELECT COUNT(*) FROM player WHERE throws IS NULL OR bats IS NULL) AS noHand,
    (SELECT COUNT(*) FROM quarantine) AS quarantine
`).get() as { games: number; pa: number; players: number; noHand: number; quarantine: number };

// JST 기준 오늘. 경기일은 JST로만 의미가 있다.
const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const todayJst = nowJst.toISOString().slice(0, 10);

console.log(`최신 경기일 ${latest.d ?? "없음"} · 오늘(JST) ${todayJst}`);
console.log(
  `경기 ${counts.games.toLocaleString()} · 타석 ${counts.pa.toLocaleString()} · ` +
    `선수 ${counts.players} (투타 미상 ${counts.noHand}) · 격리 ${counts.quarantine}`,
);

let stale = false;
if (latest.d === null) {
  console.error("⚠경기 데이터가 하나도 없다");
  stale = true;
} else {
  const ageDays = Math.floor(
    (Date.parse(`${todayJst}T00:00:00Z`) - Date.parse(`${latest.d}T00:00:00Z`)) / 86_400_000,
  );
  console.log(`데이터 나이 ${ageDays}일`);
  if (ageDays > staleDays) {
    console.error(
      `⚠**데이터가 낡았다** — 최신 경기일이 ${ageDays}일 전이다(허용 ${staleDays}일).\n` +
        `   수집이 조용히 멈췄을 수 있다. 이 서비스가 죽는 가장 흔한 방식이다.`,
    );
    stale = true;
  }
}

if (counts.quarantine > 0) {
  console.error(`⚠격리 ${counts.quarantine}건 — 버그가 아니라 판단 요청이다. 원문을 보고 규칙을 정하라`);
  for (const r of db.prepare("SELECT kind, COUNT(*) AS n FROM quarantine GROUP BY kind").all() as {
    kind: string;
    n: number;
  }[]) {
    console.error(`   ${r.kind}: ${r.n}`);
  }
}

db.close();
process.exitCode = stale ? 1 : 0;
