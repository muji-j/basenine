/**
 * **통산 대전 상대의 소속을 「마지막으로 뛴 시즌」에서 유도한다.**
 *
 * ⚠**이 시험이 없어서 빌드가 죽었다**(2026-08-27). SQL 을 `bl.team_code` 로 썼는데
 * **그런 컬럼이 없다** — `batting_line`·`pitching_line` 이 가진 것은 `side`(home/away)이고
 * 팀은 **경기에서 유도해야** 한다. 타입 검사도 단위 시험도 SQL 문자열 안은 안 본다.
 * ⚠**게다가 그 실패를 `| tail` 이 가려 exit 0 으로 보고됐다** — 그 파이프를 쓰지 마라.
 *
 * → **SQL 이 실제로 도는지 재는 시험**을 둔다. 빈 DB 에 마이그레이션만 적용해도
 * 「컬럼이 없다」는 그 자리에서 터진다(`provenance.test.ts` 와 같은 방식).
 *
 * ## 왜 필요한가
 *
 * `teamOfPlayer` 는 **그 시즌 소속만** 담는다. 통산 대전에는 은퇴·이탈한 상대가 섞이므로
 * 그대로 쓰면 구단 칸이 **빈 채로 나가고**(「어느 팀인가」에 답할 수 없다 · M11)
 * 구단 선택 상자에서도 빠진다. 실측(2026 화면): 그런 상대가 **투수 523명 · 타자 651명**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@bb-app/store";

const NOW = "2026-08-27T00:00:00.000Z";

/** ⚠**SQL 문자열 안은 타입이 안 본다** — 실제로 실행해야 컬럼 이름이 검증된다 */
test("⚠소속 유도 SQL 이 실제로 돈다 — 없는 컬럼을 쓰면 여기서 터진다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-cto-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    const rows = db.raw
      .prepare(
        `SELECT id, team FROM (
           SELECT player_id AS id, team, ROW_NUMBER() OVER (
             PARTITION BY player_id ORDER BY season DESC, game_date DESC
           ) AS rn FROM (
             SELECT bl.player_id, g.season, g.game_date,
                    CASE bl.side WHEN 'home' THEN g.home_code ELSE g.away_code END AS team
             FROM batting_line bl JOIN game g ON g.game_id = bl.game_id
             WHERE g.season BETWEEN ? AND ? AND g.status = 'played'
             UNION ALL
             SELECT pl.player_id, g.season, g.game_date,
                    CASE pl.side WHEN 'home' THEN g.home_code ELSE g.away_code END
             FROM pitching_line pl JOIN game g ON g.game_id = pl.game_id
             WHERE g.season BETWEEN ? AND ? AND g.status = 'played'
           )
         ) WHERE rn = 1`,
      )
      .all(2018, 2026);
    assert.deepEqual(rows, [], "빈 DB 인데 행이 나왔다 — 이 시험이 공회전한다");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠**이 시험은 소스와 시험이 같은 SQL 을 쓰는지까지 본다.**
 * 위 시험이 자기가 적어 둔 SQL 만 돌리면, 소스가 딴 SQL 로 바뀌어도 초록이다 —
 * 그러면 「없는 장치를 있다고 적는」 쪽이 된다.
 */
test("⚠소스가 그 SQL 을 실제로 쓴다 — 시험이 자기 사본만 돌리지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join: j } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(j(dirname(fileURLToPath(import.meta.url)), "..", "src", "query.ts"), "utf8");
  for (const must of [
    "PARTITION BY player_id ORDER BY season DESC, game_date DESC",
    "CASE bl.side WHEN 'home' THEN g.home_code ELSE g.away_code END",
    "CASE pl.side WHEN 'home' THEN g.home_code ELSE g.away_code END",
  ]) {
    assert.ok(src.includes(must), `소스에 이 조각이 없다: ${must}`);
  }
  // ⚠**없는 컬럼으로 되돌아가는 것을 막는다**
  assert.ok(!/bl\.team_code|pl\.team_code/.test(src), "line 표에 없는 team_code 를 다시 쓰고 있다");
});
