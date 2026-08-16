/**
 * 시즌 중 이적.
 *
 * ⚠**두 질문이 서로 다른 답을 갖는다.**
 * ① 「이 선수의 올 시즌 성적은?」 → **합계**(선수 페이지)
 * ② 「이 리그의 타율 1위는?」 → **그 리그에서 낸 성적만**(순위표 · NPB 관례)
 * 하나로 뭉치면 반대 리그에서 친 안타가 이 리그 순위에 들어간다.
 * 실측(2026): 山本는 DeNA 105타석 · ソフトバンク 97타석인데 합산 202타석이
 * 「セントラル 순위」에 실려 있었다.
 *
 * ⚠**소속은 「가장 최근에 뛴 팀」이다** — 출장 수가 아니다. 山本는 DeNA 28경기 ·
 * ソフトバンク 27경기라 출장 기준으로는 DeNA가 되는데, **지금 뛰는 곳은 ソフトバンク**다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { BattingRow, Db } from "@bb-app/store";
import { aggregateSeason, buildLeagues } from "../src/index.ts";

const NOW = "2026-08-16T00:00:00.000Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-trade-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "P", "移籍太郎", NOW);
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let seq = 0;
/** 그 날짜에 `team`(홈)으로 1경기 출장. 안타 `h`개 */
function play(db: Db, date: string, team: string, opponent: string, h: number): string {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: opponent, homeCode: team, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 0, homeRuns: 1,
  });
  upsertBatting(db, {
    gameId, playerId: "P", side: "home", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  } satisfies BattingRow);
  // ⚠**경기 ID를 돌려준다.** `seq`가 시험 사이에 이어지므로 「g1」 같은 고정 이름을 쓰면
  // 시험 순서가 바뀌는 순간 엉뚱한 경기를 가리킨다(2026-08-16에 실제로 그랬다)
  return gameId;
}

/** 세 → 파 이적. **세에서 더 많이 뛰었지만 지금은 파에 있다** */
function crossLeague(db: Db): { cl: string; pl: string } {
  const cl = play(db, "2026-04-01", "t", "g", 3); // 阪神(セ)
  play(db, "2026-04-02", "t", "g", 2); // 阪神(セ)
  const pl = play(db, "2026-07-01", "h", "l", 1); // ソフトバンク(パ)
  return { cl, pl };
}

test("⚠소속은 가장 최근에 뛴 팀이다 — 출장 수로 정하면 지금 있는 팀과 달라진다", async () => {
  await withDb((db) => {
    crossLeague(db);
    const agg = aggregateSeason(db, 2026);
    const p = agg.batting.find((b) => b.playerId === "P")!;
    assert.equal(p.teamCode, "h", "출장이 많은 阪神이 소속으로 잡혔다");
    assert.equal(p.lastDate, "2026-07-01");
  });
});

test("선수 페이지가 쓰는 합계는 두 팀을 더한다 — 「올 시즌 성적」은 합계다", async () => {
  await withDb((db) => {
    crossLeague(db);
    const agg = aggregateSeason(db, 2026);
    const p = agg.batting.find((b) => b.playerId === "P")!;
    assert.equal(p.games, 3);
    assert.equal(p.line.pa, 12);
    assert.equal(p.line.h, 6);
  });
});

test("⚠순위는 리그별로 나눈다 — 반대 리그에서 친 안타를 이 리그 순위에 넣지 않는다", async () => {
  await withDb((db) => {
    crossLeague(db);
    const agg = aggregateSeason(db, 2026);
    const parts = agg.battingByLeague.filter((b) => b.playerId === "P");
    assert.equal(parts.length, 2, "리그를 넘었는데 한 줄로 합쳐졌다");

    const cl = parts.find((p) => p.league === "central")!;
    const pl = parts.find((p) => p.league === "pacific")!;
    assert.equal(cl.line.h, 5);
    assert.equal(cl.line.pa, 8);
    assert.equal(pl.line.h, 1);
    assert.equal(pl.line.pa, 4);
  });
});

test("⚠리그 상수에도 반대 리그분이 섞이지 않는다", async () => {
  await withDb((db) => {
    crossLeague(db);
    // 상수를 만들려면 양 리그에 투수도 있어야 하므로, 여기서는 리그별 타석 합만 본다
    const agg = aggregateSeason(db, 2026);
    const clPa = agg.battingByLeague.filter((b) => b.league === "central").reduce((n, b) => n + b.line.pa, 0);
    const plPa = agg.battingByLeague.filter((b) => b.league === "pacific").reduce((n, b) => n + b.line.pa, 0);
    assert.equal(clPa, 8);
    assert.equal(plPa, 4);
  });
});

test("⚠같은 리그 안의 이적은 합친다 — 나누면 규정타석에 아무도 못 닿는다", async () => {
  await withDb((db) => {
    play(db, "2026-04-01", "t", "g", 3); // 阪神(セ)
    play(db, "2026-07-01", "c", "g", 1); // 広島(セ) — 같은 리그
    const agg = aggregateSeason(db, 2026);
    const parts = agg.battingByLeague.filter((b) => b.playerId === "P");
    assert.equal(parts.length, 1, "같은 리그 안인데 둘로 갈렸다");
    assert.equal(parts[0]!.line.pa, 8);
    assert.equal(parts[0]!.teamCode, "c", "소속이 최근 팀이 아니다");
  });
});

test("이적하지 않은 선수는 두 배열이 같다", async () => {
  await withDb((db) => {
    play(db, "2026-04-01", "t", "g", 3);
    play(db, "2026-04-02", "t", "g", 1);
    const agg = aggregateSeason(db, 2026);
    assert.equal(agg.batting.filter((b) => b.playerId === "P").length, 1);
    assert.equal(agg.battingByLeague.filter((b) => b.playerId === "P").length, 1);
  });
});

/**
 * ⚠**이 시험은 한 번 무의미하게 통과했다**(2026-08-16 변이 검사).
 * `buildLeagues`는 타자나 투수가 없는 리그를 통째로 건너뛰므로, 투수를 안 넣으면
 * **루프 본문이 아예 안 돌아** 무엇을 넣든 통과한다.
 * 그래서 양 리그에 투수를 세우고 **번들이 두 개 만들어졌는지부터 확인한다.**
 */
test("순위표는 리그별로 나눈 쪽을 쓴다 — 양쪽 리그에 각각 실린다", async () => {
  await withDb((db) => {
    const g = crossLeague(db);
    // 양 리그에 투수를 하나씩 — 없으면 그 리그의 번들이 만들어지지 않는다
    upsertPlayer(db, "PIT_CL", "セ投手", NOW);
    upsertPlayer(db, "PIT_PL", "パ投手", NOW);
    upsertPitching(db, {
      gameId: g.cl, playerId: "PIT_CL", side: "away", decision: null,
      outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
    });
    upsertPitching(db, {
      gameId: g.pl, playerId: "PIT_PL", side: "away", decision: null,
      outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
    });

    const agg = aggregateSeason(db, 2026);
    const bundles = buildLeagues(agg);
    assert.equal(bundles.length, 2, "리그 번들이 두 개 만들어지지 않았다 — 아래 단언이 무의미해진다");

    for (const bundle of bundles) {
      const rows = bundle.batting.filter((b) => b.playerId === "P");
      assert.equal(rows.length, 1, `${bundle.league}에 ${rows.length}줄`);
      // ⚠**그 리그에서 낸 성적만** 실려야 한다. 합계(12타석)가 오면 반대 리그분이 섞인 것이다
      assert.equal(rows[0]!.line.pa, bundle.league === "central" ? 8 : 4, `${bundle.league}에 합계가 실렸다`);
    }
  });
});
