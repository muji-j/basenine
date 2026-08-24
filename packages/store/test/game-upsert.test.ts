/**
 * `upsertGame` 의 `ON CONFLICT` 가 **무엇을 갱신하고 무엇을 안 갱신하는가**.
 *
 * ⚠**감사 지적 #3 을 실측으로 반으로 갈랐다**(2026-08-22). 원 지적은
 * 「`away_code`·`home_code`·`season`·`game_date`·`game_no` 를 한 번도 갱신 안 함」이었는데,
 * **분모 7,805경기 전수 대조**에서 둘로 나뉘었다:
 *
 * | 열 | `game_id` 와 어긋난 행 | 판정 |
 * |---|---|---|
 * | `season` · `game_date` · `game_no` | **0 / 7,805** | **갱신 안 하는 게 맞다.** `game_id` 가 `season/MMDD/{home}-{away}-{no}` 라 키가 값을 결정한다 |
 * | `away_code` · `home_code` | **148 / 7,805 (1.9%)** | ⚠**진짜다.** 별칭 정규화가 코드를 슬러그에서 떼어 놓는다 |
 *
 * ## 왜 팀 코드만 다른가
 *
 * `game_id` 는 **슬러그 원문 그대로**다(`load-archive.ts`). 그런데 팀 코드는
 * `TEAM_CODE_ALIASES` 로 **적재 시점에 정규화**한다 — 2018 오릭스가 `bs` 였고 2019 부터 `b` 다.
 * 그래서 `2018/0330/h-bs-01` 의 `away_code` 가 `b` 로 들어간다(실측 148경기).
 *
 * ⚠**별칭 표는 코드고, 이미 한 번 바뀌었다.** 새 별칭을 넣거나 기존 것을 고치면
 * **이미 들어와 있는 행은 영영 옛 코드를 유지한다** — `ON CONFLICT` 가 그 두 열을 안 건드렸기 때문이다.
 * 그러면 CLAUDE.md 가 경고하는 그 사고(「2018 오릭스 성적이 화면에서 사라진 채
 * 「그 시즌은 원래 그렇다」로 읽힌다」)가 **재적재를 해도 안 고쳐진 채** 재현된다.
 *
 * ⚠**지금 틀린 값은 0건이다** — 148행은 별칭이 들어간 뒤에 적재돼서 이미 정규화돼 있다.
 * 이건 **잠재 결함**이고, 그래서 시험으로 못 박는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "@bb-app/store";
import type { Db } from "@bb-app/store";

const NOW = "2026-08-22T00:00:00.000Z";
const SRC = "https://npb.jp/x";
const GAME_ID = "2018/0330/h-bs-01";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-gu-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** 한 경기를 넣는다. 바꾸고 싶은 것만 덮어쓴다 */
function put(db: Db, over: Partial<Parameters<typeof upsertGame>[1]> = {}): void {
  upsertGame(db, {
    gameId: GAME_ID, season: 2018, gameDate: "2018-03-30",
    awayCode: "bs", homeCode: "h", gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: SRC, fetchedAt: NOW, awayRuns: 3, homeRuns: 2,
    ...over,
  });
}

function row(db: Db): { away: string; home: string; rev: number } {
  return db.raw
    .prepare("SELECT away_code AS away, home_code AS home, revision AS rev FROM game WHERE game_id = ?")
    .get(GAME_ID) as unknown as { away: string; home: string; rev: number };
}

/**
 * ⚠**이것이 별칭 표가 바뀌는 날의 모양이다.** 같은 `game_id` 로 다른 팀 코드가 들어온다 —
 * 슬러그는 안 바뀌므로 새 행이 아니라 **갱신**이 되어야 한다.
 */
test("⚠팀 코드가 바뀌면 갱신된다 — 별칭 표가 바뀌어도 재적재로 고쳐진다", async () => {
  await withDb((db) => {
    put(db, { awayCode: "bs" });
    assert.equal(row(db).away, "bs", "첫 적재가 안 들어갔다 — 시험의 전제가 깨졌다");

    // 별칭이 들어와 `bs` → `b` 로 정규화된 뒤의 재적재
    put(db, { awayCode: "b" });
    assert.equal(row(db).away, "b", "팀 코드가 안 바뀌었다 — 별칭 표를 고쳐도 기존 행이 안 낫는다");
  });
});

test("⚠홈 코드도 같다", async () => {
  await withDb((db) => {
    put(db, { homeCode: "hb" });
    put(db, { homeCode: "h" });
    assert.equal(row(db).home, "h", "홈 코드가 안 바뀌었다");
  });
});

/** ⚠**팀 코드 정정도 정정이다**(M4) — 안 오르면 「어제와 다른데?」에 답할 수 없다 */
test("⚠팀 코드가 바뀌면 revision 이 오른다", async () => {
  await withDb((db) => {
    put(db, { awayCode: "bs" });
    const before = row(db).rev;
    put(db, { awayCode: "b" });
    assert.equal(row(db).rev, before + 1, "팀 코드가 바뀌었는데 revision 이 안 올랐다(M4)");
  });
});

/**
 * ⚠**재적재만으로 오르면 안 된다**(M5) — `revision` 이 「몇 번째 정정인가」를 말해야 하는데
 * 매일 도는 적재가 그 수를 올리면 아무 뜻도 없는 수가 된다.
 */
test("⚠같은 내용을 다시 넣어도 revision 은 안 오른다 — 멱등(M5)", async () => {
  await withDb((db) => {
    put(db);
    const before = row(db).rev;
    put(db);
    put(db);
    assert.equal(row(db).rev, before, "재적재만으로 revision 이 올랐다");
  });
});

/**
 * ⚠**`season`·`game_date`·`game_no` 는 일부러 갱신하지 않는다.**
 * `game_id` 가 `season/MMDD/{home}-{away}-{no}` 라 **키가 값을 결정**하고,
 * 실측(7,805경기 전수)에서 어긋난 행이 **0건**이다. 셋이 바뀌면 `game_id` 도 바뀌어
 * **갱신이 아니라 새 행**이 된다.
 *
 * 이 시험은 「왜 안 넣었나」를 코드로 남겨 **같은 지적이 다시 올라오는 것을 막는다.**
 * ⚠**전제가 깨지면(예: `game_id` 형식이 바뀌면) 여기가 먼저 운다.**
 */
test("⚠game_id 는 season·날짜·경기번호를 담는다 — 그래서 그 셋은 갱신 대상이 아니다", async () => {
  const [s, mmdd, slug] = GAME_ID.split("/") as [string, string, string];
  const parts = slug.split("-");
  const no = parts.pop();
  const away = parts.pop();
  assert.equal(Number(s), 2018);
  assert.equal(mmdd, "0330");
  assert.equal(Number(no), 1);
  assert.equal(away, "bs", "슬러그가 팀 코드를 담는다 — 다만 별칭 정규화로 값과 갈릴 수 있다");
});
