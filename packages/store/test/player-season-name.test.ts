/**
 * 시즌별 표시명.
 *
 * ⚠**표시명이 「아카이브 최초 등장 경기」의 이름으로 영구 고정돼 있었다**(2026-08-21 감사 확정 P1).
 * `load-archive.ts` 가 `seenPlayers` 로 첫 접촉에만 `upsertPlayer` 를 부르는데
 * 순회가 **날짜 오름차순**이라 첫 접촉 = 가장 오래된 경기다.
 * 실측(감사 · box 7,805장 전수 재파싱): DB 이름이 **최초 이름과 1,640/1,640 일치** ·
 * **최종 이름과는 1,531/1,640** → 드리프트 **109명 전원이 옛 이름**.
 * 배포물 **12,862/15,439장(83.3%)** 이 그 109명 중 최소 한 명을 옛 이름으로 그렸다.
 *
 * ⚠**「최신이 이긴다」로 고치면 오히려 나빠진다** — NPB 박스 표기는 「신·구 등록명」이 아니라
 * **그 시점의 로스터 식별 표기**라 방향이 양쪽이다(`松井雅→松井` · `山田哲→山田`).
 * 감사 실측: 최초 고정 시 620쌍 중 298 틀림 → **최종 고정 시 327 틀림**.
 * 옳은 것은 **그 시즌 화면에는 그 시즌의 이름**이고, 이 표가 그것을 담는다.
 *
 * 여기서 재는 것은 **저장이 적재 순서에 의존하지 않는가**(M5)다 — 그게 이 표의 유일한 규칙이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertPlayer, upsertPlayerSeasonName } from "../src/index.ts";
import type { Db } from "../src/index.ts";

const NOW = "2026-08-21T00:00:00.000Z";
const SRC = "https://npb.jp/x";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-psn-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "P1", "이름", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function nameOf(db: Db, season: number): string | undefined {
  const r = db.raw
    .prepare("SELECT display_name AS n FROM player_season_name WHERE player_id='P1' AND season=?")
    .get(season) as { n: string } | undefined;
  return r?.n;
}

test("시즌마다 다른 이름을 담는다 — 한 시즌의 이름이 다른 시즌을 덮지 않는다", async () => {
  await withDb((db) => {
    upsertPlayerSeasonName(db, "P1", 2018, "山田哲", "2018-04-01", SRC);
    upsertPlayerSeasonName(db, "P1", 2026, "山田", "2026-04-01", SRC);
    assert.equal(nameOf(db, 2018), "山田哲");
    assert.equal(nameOf(db, 2026), "山田");
  });
});

/**
 * ⚠**같은 시즌 안에서 표기가 흔들리면 「가장 나중 경기」의 표기를 쓴다.**
 * 그리고 그 판정은 `as_of`(경기일) 비교이지 **호출 순서**가 아니다 —
 * `--from` 으로 중간부터 다시 돌려도, 두 번 돌려도 같은 결과여야 한다(M5).
 */
test("⚠적재 순서에 의존하지 않는다 — 늦은 경기가 이긴다(M5)", async () => {
  await withDb((db) => {
    upsertPlayerSeasonName(db, "P1", 2026, "遅い", "2026-09-01", SRC);
    // ⚠**나중에 부른 것이 더 이른 경기다** — 덮으면 안 된다
    upsertPlayerSeasonName(db, "P1", 2026, "早い", "2026-04-01", SRC);
    assert.equal(nameOf(db, 2026), "遅い", "이른 경기가 늦은 경기를 덮었다 — 적재 순서에 의존한다");
  });
});

test("같은 것을 두 번 넣어도 결과가 한 번과 같다(M5)", async () => {
  await withDb((db) => {
    upsertPlayerSeasonName(db, "P1", 2026, "山田", "2026-04-01", SRC);
    upsertPlayerSeasonName(db, "P1", 2026, "山田", "2026-04-01", SRC);
    const n = db.raw
      .prepare("SELECT COUNT(*) AS c FROM player_season_name WHERE player_id='P1'")
      .get() as { c: number };
    assert.equal(n.c, 1, "같은 (선수, 시즌)이 두 행이 됐다");
    assert.equal(nameOf(db, 2026), "山田");
  });
});

test("늦은 경기의 표기로 갱신된다 — 시즌 도중 표기가 바뀌는 경우", async () => {
  await withDb((db) => {
    upsertPlayerSeasonName(db, "P1", 2026, "石川", "2026-04-01", SRC);
    upsertPlayerSeasonName(db, "P1", 2026, "石川慎", "2026-07-01", SRC);
    assert.equal(nameOf(db, 2026), "石川慎");
  });
});

/**
 * ⚠**`as_of` 는 M4 가 요구하는 「무엇 기준인가」다** — 적재 시각이 아니라 **경기일**이다.
 * 적재 시각을 넣으면 위의 순서 무의존성이 즉시 깨진다(다시 돌릴 때마다 값이 바뀐다).
 */
test("⚠as_of 가 경기일이다 — 적재 시각이 아니다(M4)", async () => {
  await withDb((db) => {
    upsertPlayerSeasonName(db, "P1", 2026, "山田", "2026-04-01", SRC);
    const r = db.raw
      .prepare("SELECT as_of AS a, source AS s FROM player_season_name WHERE player_id='P1'")
      .get() as { a: string; s: string };
    assert.equal(r.a, "2026-04-01", "as_of 가 경기일이 아니다");
    assert.equal(r.s, SRC, "source 가 비었다 — M4 는 「어디서」도 요구한다");
  });
});
