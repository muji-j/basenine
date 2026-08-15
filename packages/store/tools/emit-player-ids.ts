/**
 * DB의 선수 ID를 한 줄에 하나씩 내보낸다. 선수 페이지 아카이버의 입력이 된다.
 *
 *   node packages/store/tools/emit-player-ids.ts data/bb.sqlite > data/player-ids.txt
 *
 * 아카이버가 DB를 직접 읽지 않는 이유: 수집기는 저장소를 몰라야 한다.
 * 저장소가 바뀌어도 수집기는 그대로여야 하고, 그 경계를 파일 하나로 끊는다.
 */
import { openDb } from "../src/db.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node tools/emit-player-ids.ts <db-path>");
  process.exit(2);
}

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");
const rows = db.raw.prepare("SELECT player_id FROM player ORDER BY player_id").all() as {
  player_id: string;
}[];
for (const r of rows) console.log(r.player_id);
console.error(`${rows.length}명`);
db.close();
