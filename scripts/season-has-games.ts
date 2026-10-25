#!/usr/bin/env node
/**
 * **그 시즌에 치른(`played`) 경기가 DB 에 있는가** — 「공표 성적표 갱신」 단계가 받을지 정한다(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D6).
 *
 *   node scripts/season-has-games.ts data/bb.sqlite 2027
 *
 * **종료 코드**: **0** 있다 · **1** 없다(중지 경기만 있어도 · 그 시즌 행이 없어도) · **2** 못 읽었다(DB 없음 · SQLite 아님 · 표 없음) 또는 인자가 틀렸다.
 *
 * ⚠**왜 있는가**: 1/1~개막 전에 `cli-stats.ts --season <새 해>` 가 빈 표(200)를 받으면 외부 대조가 **대조 0명**으로 1 이 된다(설계 G6).
 *   관문(`packages/aggregate/tools/crosscheck.ts`)은 바꾸지 않는다 — 사용자 결정 2026-10-02 「관문 판정 불변」. **경기가 0 인 시즌은 받지 않는다.**
 *   덤: 1/1~개막 약 85일 × 하루 3실행 × 30장 ≈ 7,650요청을 안 보낸다(L1).
 * ⚠**모르면 「없다」가 아니다**(M11) — 못 읽으면 2 다. 워크플로는 2 를 단계 실패로 남긴다(`continue-on-error` 라 배포는 안 막고 대조는 옛 스냅숏으로 돈다).
 * ⚠**시계를 읽지 않는다**(M6) — 시즌은 인자다(워크플로가 JST 연도를 준다).
 * ⚠**읽기 전용으로 연다** — `openDb` 는 마이그레이션을 적용해 파일을 바꾸므로 쓰지 않는다(`correction-candidates.ts` 와 같다). 없는 파일을 만들지 않는다.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const [dbPath, seasonArg] = args;

if (args.length !== 2 || dbPath === undefined || seasonArg === undefined || !/^\d{4}$/.test(seasonArg)) {
  console.error("usage: node scripts/season-has-games.ts <db-path> <season(YYYY)>");
  process.exitCode = 2;
} else if (!existsSync(dbPath)) {
  console.error(`⚠DB 가 없다: ${dbPath} — ${seasonArg} 시즌에 경기가 있는지 모른다`);
  process.exitCode = 2;
} else {
  const season = Number(seasonArg);
  let played: number | null = null;
  let why = "";
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      played = (db.prepare("SELECT COUNT(*) AS n FROM game WHERE season = ? AND status = 'played'").get(season) as { n: number }).n;
    } finally {
      db.close();
    }
  } catch (err) {
    why = err instanceof Error ? err.message : String(err);
  }
  if (played === null) {
    console.error(`⚠DB 를 읽지 못했다: ${dbPath} — ${why} · ${seasonArg} 시즌에 경기가 있는지 모른다`);
    process.exitCode = 2;
  } else {
    console.log(`${seasonArg} 시즌 치른 경기 ${String(played)}건`);
    process.exitCode = played > 0 ? 0 : 1;
  }
}
