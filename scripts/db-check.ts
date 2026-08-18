#!/usr/bin/env node
/**
 * **이 DB 를 보관소에 올려도 되는가.**
 *
 *   node scripts/db-check.ts data/bb.sqlite
 *
 * ⚠**반쯤 쓰인 DB 가 보관소에 올라갈 수 있었다**(2026-08-18 감사 P2).
 *
 * 수집 잡의 「보관소에 올림」은 `always()` 라 **적재가 죽어도 돈다** —
 * 아카이브는 소급 불가라 그게 옳은 설계다. 그런데 SQLite 의 저널 모드가 `delete`(롤백 저널)이라,
 * 트랜잭션 중에 프로세스가 죽으면 **본체가 제자리에서 반쯤 갱신된 상태**이고
 * 원본 페이지는 `bb.sqlite-journal` 에만 있다. 업로드는 본체만 담으므로
 * **저널 없는 깨진 DB** 가 보관소에 올라가고, 다음 날 복원하면 `malformed` 로 열린다.
 *
 * ⚠**여는 것만으로 핫저널이 롤백된다.** 러너에는 저널이 아직 있으므로 먼저 열어 복구시키고,
 * 그 뒤에 무결성을 묻는다.
 * ⚠**아카이브와 DB 의 무게는 다르다.** 아카이브는 소급 불가라 무조건 지키고,
 * DB 는 **아카이브에서 언제든 다시 만들 수 있는 파생물**이라 의심스러우면 안 올리는 쪽이 맞다.
 * ⚠**「모른다」를 「괜찮다」로 바꾸지 않는다** — 열지 못하면 그것도 실패다.
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/db-check.ts <db-path>");
  process.exit(2);
}

try {
  const db = new DatabaseSync(dbPath);
  try {
    /**
     * ⚠`integrity_check` 는 전 페이지를 훑는다(현재 150MB 에 수 초). `quick_check` 로 줄이지 않는다 —
     * 여기서 아끼는 몇 초가 「되돌릴 수 없는 손실」과 맞바꿀 값이 아니다.
     */
    const row = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    const verdict = String(Object.values(row)[0] ?? "");
    console.log(`무결성 검사: ${verdict}`);
    if (verdict !== "ok") {
      console.error("⚠DB 가 깨졌다 — 보관소에 올리지 않는다. 다음 실행이 아카이브에서 다시 만든다");
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
} catch (err) {
  console.error(`⚠DB 를 열지 못했다 — 보관소에 올리지 않는다: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
