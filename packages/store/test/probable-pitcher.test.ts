import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { ensurePlayer, upsertPlayer, upsertProbablePitcher } from "../src/load.ts";
import type { ProbablePitcherRow } from "../src/load.ts";

const NOW = "2026-08-15T00:00:00.000Z";
const LATER = "2026-08-15T09:00:00.000Z";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-probable-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function row(over: Partial<ProbablePitcherRow> = {}): ProbablePitcherRow {
  return {
    gameDate: "2026-08-16",
    teamCode: "d",
    opponentCode: "g",
    playerId: "63165134",
    sourceName: "柳　裕也",
    venue: "バンテリンドーム",
    startTime: "13:30",
    league: "cl",
    sourceUrl: "https://npb.jp/announcement/starter/",
    fetchedAt: NOW,
    ...over,
  };
}

function read(db: ReturnType<typeof openDb>, teamCode = "d") {
  return db.raw
    .prepare(
      `SELECT player_id AS playerId, source_name AS sourceName, revision, fetched_at AS fetchedAt
       FROM probable_pitcher WHERE game_date = ? AND team_code = ?`,
    )
    .get("2026-08-16", teamCode) as
    | { playerId: string | null; sourceName: string | null; revision: number; fetchedAt: string }
    | undefined;
}

test("같은 예고를 두 번 넣어도 한 번과 같다(M5)", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳　裕也", NOW);
    upsertProbablePitcher(db, row());
    upsertProbablePitcher(db, row({ fetchedAt: LATER }));
    const r = read(db)!;
    assert.equal(r.playerId, "63165134");
    assert.equal(r.revision, 1, "내용이 같은데 revision이 올랐다");
    assert.equal(r.fetchedAt, LATER, "언제 확인했는지는 갱신돼야 한다");
  });
});

test("⚠투수가 바뀌면 revision이 오른다 — 예고는 실제로 바뀐다(M4)", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳　裕也", NOW);
    ensurePlayer(db, "71575132", "小笠原　慎之介", NOW);
    upsertProbablePitcher(db, row());
    // 정정은 「나중에 받은 판」이다 — 같은 시각의 두 판은 애초에 존재하지 않는다
    upsertProbablePitcher(db, row({ playerId: "71575132", sourceName: "小笠原　慎之介", fetchedAt: LATER }));
    const r = read(db)!;
    assert.equal(r.playerId, "71575132");
    assert.equal(r.revision, 2);
  });
});

test("⚠미발표 → 발표도 변화로 센다 — NULL 비교를 놓치면 여기서 조용히 멈춘다", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳　裕也", NOW);
    upsertProbablePitcher(db, row({ playerId: null, sourceName: null }));
    assert.equal(read(db)!.revision, 1);
    upsertProbablePitcher(db, row({ fetchedAt: LATER }));
    const r = read(db)!;
    assert.equal(r.playerId, "63165134");
    assert.equal(r.revision, 2, "NULL → 값 전이가 변화로 세어지지 않았다");
  });
});

test("미발표는 행이 없는 것이 아니라 player_id가 NULL인 행이다(M11)", async () => {
  await withDb((db) => {
    upsertProbablePitcher(db, row({ playerId: null, sourceName: null }));
    const r = read(db)!;
    assert.notEqual(r, undefined, "미발표라고 행을 만들지 않으면 경기 자체가 사라진다");
    assert.equal(r.playerId, null);
    assert.equal(r.sourceName, null);
  });
});

test("⚠ensurePlayer는 이미 있는 선수의 표기를 덮어쓰지 않는다", async () => {
  await withDb((db) => {
    // 박스스코어가 만든 짧은 표기
    upsertPlayer(db, "63165134", "柳", NOW);
    // 予告先発의 긴 표기가 들어와도 바뀌면 안 된다
    ensurePlayer(db, "63165134", "柳　裕也", LATER);
    const p = db.raw
      .prepare("SELECT display_name AS n FROM player WHERE player_id = ?")
      .get("63165134") as { n: string };
    assert.equal(p.n, "柳", "予告先発 표기가 박스스코어 표기를 덮어썼다");
  });
});

test("ensurePlayer는 없는 선수는 만든다 — 첫 선발 등판 전이어도 예고에는 나온다", async () => {
  await withDb((db) => {
    ensurePlayer(db, "99999999", "新人　太郎", NOW);
    const p = db.raw
      .prepare("SELECT display_name AS n FROM player WHERE player_id = ?")
      .get("99999999") as { n: string } | undefined;
    assert.equal(p?.n, "新人　太郎");
  });
});

test("한 팀은 하루에 한 번만 예고된다 — 키가 (경기일, 팀)이다", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳", NOW);
    upsertProbablePitcher(db, row());
    upsertProbablePitcher(db, row({ opponentCode: "t", venue: "マツダスタジアム" }));
    const n = db.raw
      .prepare("SELECT COUNT(*) AS n FROM probable_pitcher WHERE game_date = ? AND team_code = ?")
      .get("2026-08-16", "d") as { n: number };
    assert.equal(n.n, 1);
  });
});

/**
 * ⚠**낡은 판이 새 판을 덮어쓰면 revision 이 뜻을 잃는다**(M5·M4 · 2026-08-18 감사 P2).
 *
 * 적재는 아카이브 **전체**를 매번 훑는데 한 경기일이 여러 파일에 걸린다 —
 * 페이지가 하루 중에 다음날치로 넘어가기 때문이다. 겹친 두 판의 투수가 다르면
 * **실행마다 old→new→old→new** 로 오가며 revision 만 매일 올랐다.
 * 종착값은 그대로인데 「몇 번째 정정인가」가 아무 뜻도 없는 수가 된다.
 */
test("⚠낡은 판은 새 판을 덮어쓰지 않는다 — 재적재로 revision 이 오르지 않는다", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳　裕也", NOW);
    ensurePlayer(db, "71575132", "小笠原　慎之介", NOW);
    // 새 판(LATER)이 먼저 들어오고, 뒤이어 **낡은 판**(NOW)이 들어온다
    upsertProbablePitcher(db, row({ playerId: "71575132", sourceName: "小笠原", fetchedAt: LATER }));
    upsertProbablePitcher(db, row({ fetchedAt: NOW }));
    const r = read(db)!;
    assert.equal(r.playerId, "71575132", "낡은 판이 새 판을 덮어썼다");
    assert.equal(r.revision, 1, "덮어쓰지도 않았는데 revision 이 올랐다");
    assert.equal(r.fetchedAt, LATER, "취득 시각이 과거로 되돌아갔다");
  });
});

/**
 * ⚠**「모른다」를 「최신」으로 대접하지 않는다**(M11).
 * 사이드카를 못 읽어 취득 시각이 없는 판이 확정된 값을 밀어내면 안 된다.
 */
test("⚠취득 시각을 모르는 판은 아는 판을 덮어쓰지 않는다", async () => {
  await withDb((db) => {
    ensurePlayer(db, "63165134", "柳　裕也", NOW);
    upsertProbablePitcher(db, row({ fetchedAt: LATER }));
    upsertProbablePitcher(db, row({ playerId: null, sourceName: null, fetchedAt: null }));
    const r = read(db)!;
    assert.equal(r.playerId, "63165134", "모르는 판이 아는 판을 지웠다");
    assert.equal(r.fetchedAt, LATER);
  });
});
