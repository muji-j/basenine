/**
 * **연속 기록의 공표값 대조**(T1) — 실DB.
 *
 * ⚠**이것이 규칙 R 의 유일한 외부 근거다.** 정의서 §3-2 가 대조한 3건을 여기서 다시 잰다.
 * 규칙 R 과 경합안(「실점 직전까지의 아웃」)은 **1/3회 차이로 갈리고 눈으로는 못 잡는다** —
 * 그래서 **경합안도 같이 계산해 「다르다」를 못 박는다.** 안 그러면 어느 날 규칙이 뒤집혀도 초록일 수 있다.
 *
 * ⚠**출처가 npb.jp 의 기록 페이지가 아니라 보도·집계 사이트다** — 「NPB 공식 공표값」이라고 쓰지 마라.
 * 공인야구규칙 9.23 에 **투수 연속 무실점 조문이 아예 없다**(정의서 §7). 확신도는 **관례**다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 * ⚠**건너뛴 것을 「0건 통과」로 세지 않는다** — 몇 건을 못 쟀는지 이 파일이 콘솔에 적는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { inningsFromOuts } from "@bb-app/metrics";
import { battingStreaks } from "../src/streaks.ts";
import { pitchingStreaks } from "../src/pitching-streaks.ts";
import type { PitchingStreak } from "../src/pitching-streaks.ts";
import { settledSeasons } from "./published.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const NOW = "2026-09-07T00:00:00.000Z";

function withDb(fn: (db: Db) => void): void {
  const db = openDb(DB, NOW);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

/** 그 시즌 최장 마루를 등판 기준으로 집는다 */
function bestOf(db: Db, playerId: string, season: number): PitchingStreak {
  const s = pitchingStreaks(db, { fromSeason: season, toSeason: season }).get(playerId);
  assert.ok(s !== undefined, `${playerId} 의 ${season} 등판이 DB 에 없다`);
  assert.ok(s.best !== null, `${playerId} 의 ${season} 마루가 없다`);
  return s.best;
}

/**
 * ⚠**경합안**(「실점 직전까지의 아웃」)을 **출하 코드와 다른 길로** 계산한다.
 *
 * 그 등판에서 **첫 실점 타석보다 앞선** 타석들이 만든 아웃의 합이다.
 * 규칙 R 은 **그 하프이닝을 통째로 버리므로** 두 값이 갈린다.
 */
const COMPETING_SQL = `
WITH pa AS (
  SELECT e.seq AS seq, e.inning AS inning, e.half AS half, e.outs_before AS ob,
         e.pitcher_id AS pid, e.runs_scored AS rs,
         LEAD(e.outs_before) OVER (PARTITION BY e.game_id, e.inning, e.half ORDER BY e.seq) AS nob
  FROM pa_event e WHERE e.game_id = ? AND e.status = 'final'
)
SELECT seq, (COALESCE(nob, 3) - ob) AS outs, rs FROM pa WHERE pid = ? ORDER BY seq
`;

function competingOuts(db: Db, gameId: string, playerId: string): number {
  const rows = db.raw.prepare(COMPETING_SQL).all(gameId, playerId) as unknown as {
    seq: number;
    outs: number;
    rs: number;
  }[];
  let acc = 0;
  for (const r of rows) {
    if (r.rs > 0) break;
    acc += Number(r.outs);
  }
  return acc;
}

/**
 * **케이스 1 — 山﨑伊織(03305153 · 巨人) 2025 개막부터.**
 *
 * 공표: **「5月7日の阪神戦の2回に1点を失い、開幕からの連続無失点が36回でストップ」**
 * (SPAIA `https://spaia.jp/column/baseball/npb/21918`).
 *
 * ⚠**시즌 범위로 잰다** — 공표 문구가 「開幕からの」라 **시즌 시작이 마루의 시작**이다.
 * 통산 범위로 재면 2024년 마지막 등판이 시작 경계가 되어 「36回以上」이 된다(다른 물음이다).
 */
test("⚠공표값 대조 ① 山﨑伊織 2025 = 36.0回 — 규칙 R", { skip: !HAS_DB && "data/bb.sqlite 없음" }, () => {
  withDb((db) => {
    const best = bestOf(db, "03305153", 2025);
    assert.equal(best.atRangeStart, true, "개막부터의 마루가 아니다");
    assert.equal(best.interiorOuts, 105, "무실점 등판의 아웃 합이 105가 아니다");
    assert.equal(best.innings.lowerOuts, 108, `공표 36回(108아웃)과 다르다: ${best.innings.lowerOuts}`);
    assert.equal(best.innings.upperOuts, 108);
    assert.equal(best.innings.exact, true, "확정이어야 하는 경계를 미확정으로 냈다");
    assert.equal(inningsFromOuts(best.innings.lowerOuts), "36");
  });
});

/**
 * ⚠**이 시험이 묶음의 심장이다.** 규칙 R 과 경합안이 실제로 다른 답을 내는지 확인한다.
 * 정의서 §3-2: 규칙 R = 105+3 = **108(36.0回)** · 경합안 = 105+3+1 = **109(36回1/3)** · 공표 = **36回**.
 */
test("⚠공표값 대조 ①′ 경합안은 1/3회가 어긋난다 — 눈으로는 못 잡는다", { skip: !HAS_DB && "data/bb.sqlite 없음" }, () => {
  withDb((db) => {
    const best = bestOf(db, "03305153", 2025);
    // 마루를 끝낸 등판 = 2025-05-07 巨人 대 阪神
    const ended = db.raw
      .prepare(
        `SELECT pl.game_id AS gameId, pl.runs AS runs FROM pitching_line pl
         JOIN game g ON g.game_id = pl.game_id
         WHERE pl.player_id = ? AND g.season = 2025 AND g.competition = 'regular'
           AND g.status = 'played' AND g.game_date > ? AND pl.runs > 0
         ORDER BY g.game_date, g.game_no LIMIT 1`,
      )
      .get("03305153", best.to) as unknown as { gameId: string; runs: number } | undefined;
    assert.ok(ended !== undefined, "마루를 끝낸 등판을 못 찾았다");

    const competing = best.interiorOuts + competingOuts(db, ended.gameId, "03305153");
    assert.equal(competing, 109, `경합안이 109(36回1/3)가 아니다: ${competing}`);
    assert.notEqual(competing, best.innings.lowerOuts, "⚠두 읽기가 같은 답을 냈다 — 이 대조가 무의미해졌다");
    assert.equal(competing - best.innings.lowerOuts, 1, "차이가 1아웃(1/3회)이 아니다");
  });
});

/**
 * **케이스 2 — 石井大智(41145153 · 阪神) 2025.**
 * 공표: **「50試合・49イニング連続無失点」**
 * (`https://www.baseballchannel.jp/npb/232640/` · `https://note.com/ashtax/n/n06f4b9d11635`).
 *
 * ⚠**시작 경계가 정의서 §3-2 의 두 번째 케이스다** — 2025-04-04 는 9회 한 하프이닝 · 3아웃 · 1실점이고
 * 실점은 2아웃 시점이라 **그 뒤 1아웃을 더 잡았다.** 규칙 R 은 그 하프이닝을 통째로 버려 **49.0回**,
 * 경합안이면 **49回1/3** 이 된다.
 */
test("⚠공표값 대조 ② 石井大智 2025 = 50登板 · 49.0回", { skip: !HAS_DB && "data/bb.sqlite 없음" }, () => {
  withDb((db) => {
    const best = bestOf(db, "41145153", 2025);
    assert.equal(best.appearances, 50, "공표 50試合과 다르다");
    assert.equal(best.interiorOuts, 147);
    assert.equal(best.innings.lowerOuts, 147, "공표 49イニング(147아웃)과 다르다");
    assert.equal(best.innings.exact, true);
    assert.equal(inningsFromOuts(best.innings.lowerOuts), "49");
    assert.equal(best.from, "2025-04-05");
    assert.equal(best.to, "2025-09-28");
    assert.equal(best.atRangeStart, false, "시작 경계가 있는데 없다고 했다");
  });
});

/**
 * **케이스 3 — 石井大智 시즌 넘김.**
 * 공표: **「石井大智（阪神）- 50回（2025〜2026年）※更新中」**(`https://mattaridoudesyou.com/?p=49160`) ·
 * 「昨季から連続無失点試合は51」(日刊スポーツ).
 *
 * ⚠**로컬 DB 는 2026-09-05 복귀 등판을 아직 안 담을 수 있다**(작성 시점 최신 정규 경기일 2026-08-16).
 * **없으면 건너뛰고 그 사실을 적는다 — 「0건 통과」로 세지 않는다.**
 * ⚠**진행형이므로 51/50.0 이 최종값이 아니다** — 다음 등판에 낡는다. **그래서 「≥」로 잰다.**
 */
test("⚠공표값 대조 ③ 石井大智 시즌 넘김 — DB 에 복귀 등판이 있을 때만", { skip: !HAS_DB && "data/bb.sqlite 없음" }, (t) => {
  withDb((db) => {
    const after = db.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM pitching_line pl JOIN game g ON g.game_id = pl.game_id
         WHERE pl.player_id = ? AND g.season = 2026 AND g.competition = 'regular' AND g.status = 'played'`,
      )
      .get("41145153") as unknown as { n: number };
    if (Number(after.n) === 0) {
      // ⚠**초록으로 넘기지 않는다** — 러너가 「skipped」로 세게 한다(「0건 = 합격」 방지)
      t.skip("石井大智의 2026 정규 등판이 DB 에 0건이다(복귀 등판 미수집) — 「합격」이 아니라 미대조다");
      return;
    }
    const s = pitchingStreaks(db, { fromSeason: 2018, toSeason: 2026 }).get("41145153")!;
    assert.ok(s.best !== null);
    assert.ok(s.best.appearances >= 51, `시즌 넘김 마루가 51등판 미만이다: ${s.best.appearances}`);
    assert.ok(s.best.innings.lowerOuts >= 150, `시즌 넘김 마루가 150아웃 미만이다: ${s.best.innings.lowerOuts}`);
    assert.deepEqual([...s.best.seasons], [2025, 2026], "시즌 넘김이 아니다");
  });
});

/**
 * **참고 — 平良海馬(31035136 · 西武) 2021.**
 *
 * ⚠**출처 충돌이 있다**(정의서 §2-4). npb.jp **칼럼**은 **38試合**이라 쓰고, 집계 2곳과 우리 DB 는 **39**다.
 * npb.jp 가 신뢰 등급은 위이지만 ⑴그건 기록 페이지가 아니라 칼럼이고 ⑵같은 시기 보도
 * (39=セ記録 8/13 · 40=NPB新記録 8/17)와 어긋난다.
 * → **39 를 채택하고 충돌을 남긴다. 해소 전에는 이 케이스를 T1 근거로 단독 사용하지 마라.**
 */
test("참고 平良海馬 2021 = 39登板 · 38.0回 — ⚠출처 충돌 있음", { skip: !HAS_DB && "data/bb.sqlite 없음" }, () => {
  withDb((db) => {
    const best = bestOf(db, "31035136", 2021);
    assert.equal(best.appearances, 39);
    assert.equal(best.innings.lowerOuts, 114);
    assert.equal(inningsFromOuts(best.innings.lowerOuts), "38");
  });
});

/* ------------------------------------------------------------------ *
 *  타자 3종 — **리팩터로 값이 안 바뀌었는가**
 * ------------------------------------------------------------------ */

/**
 * ⚠**출하 코드와 다른 판정으로 센다**(작업규칙 9의 정신).
 * 여기 있는 것은 **리팩터 전의 구현**이다 — 시즌 고정 SQL(`g.season = ?`) + 스칼라 누적 루프.
 * 새 구현은 범위 SQL(`BETWEEN`) + 마루 스캔이라 **알고리즘이 다르다.**
 * 둘이 같은 답을 내야 「결과를 안 바꿨다」가 참이 된다.
 */
const OLD_SQL = `
SELECT b.player_id AS playerId, g.game_date AS date,
       SUM(b.h) AS hits, SUM(b.h + b.bb + b.hbp) AS onBase,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.sf) AS sf
FROM batting_line b JOIN game g ON g.game_id = b.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY b.player_id, b.game_id
HAVING SUM(b.pa) > 0
ORDER BY b.player_id, g.game_date, g.game_no
`;

interface OldStreak {
  current: number;
  /** ⚠**「지금」의 양 끝** — 화면이 M2 의 둘째 분모(마루의 기간)를 내려면 필요하다(정의서 §1-6 ⑵) */
  currentFrom: string | null;
  currentTo: string | null;
  best: number;
  bestFrom: string | null;
  bestTo: string | null;
}

function oldStreakOf(days: readonly { date: string; hit: boolean }[]): OldStreak {
  let current = 0;
  let best = 0;
  let from: string | null = null;
  let to: string | null = null;
  let bestFrom: string | null = null;
  let bestTo: string | null = null;
  for (const d of days) {
    if (d.hit) {
      if (current === 0) from = d.date;
      to = d.date;
      current += 1;
      if (current >= best) {
        best = current;
        bestFrom = from;
        bestTo = d.date;
      }
    } else {
      current = 0;
      from = null;
      to = null;
    }
  }
  return { current, currentFrom: from, currentTo: to, best, bestFrom, bestTo };
}

function oldBattingStreaks(db: Db, season: number): Map<string, unknown> {
  const rows = db.raw.prepare(OLD_SQL).all(season, "regular", "9999-12-31") as unknown as {
    playerId: string;
    date: string;
    hits: number;
    onBase: number;
    pa: number;
    ab: number;
    sf: number;
  }[];
  const byPlayer = new Map<string, { date: string; hits: number; onBase: number; skip: boolean }[]>();
  for (const r of rows) {
    const g = {
      date: r.date,
      hits: r.hits,
      onBase: r.onBase,
      skip: r.pa > 0 && r.ab === 0 && r.sf === 0 && r.hits === 0,
    };
    const list = byPlayer.get(r.playerId);
    if (list === undefined) byPlayer.set(r.playerId, [g]);
    else list.push(g);
  }
  const out = new Map<string, unknown>();
  for (const [playerId, games] of byPlayer) {
    out.set(playerId, {
      playerId,
      hitting: oldStreakOf(games.filter((d) => !d.skip).map((d) => ({ date: d.date, hit: d.hits > 0 }))),
      onBase: oldStreakOf(games.filter((d) => !d.skip).map((d) => ({ date: d.date, hit: d.onBase > 0 }))),
      hitless: oldStreakOf(games.map((d) => ({ date: d.date, hit: d.hits === 0 }))),
      games: games.length,
      lastGameDate: games.at(-1)?.date ?? null,
    });
  }
  return out;
}

/**
 * ⚠**완결 시즌만 본다.** 진행 중 시즌은 경기가 들어올 때마다 값이 바뀌지만,
 * 이 시험은 **두 구현을 같은 DB 로 맞대는 것**이라 사실 진행 중이어도 상관없다 —
 * 그래도 **분모를 안정시켜** 「몇 선수-시즌을 맞댔는가」가 매일 흔들리지 않게 완결 시즌으로 잡는다.
 */
test("⚠타자 3종 — 범위 코어로 바꿔도 시즌 안 결과가 그대로다", { skip: !HAS_DB && "data/bb.sqlite 없음" }, () => {
  withDb((db) => {
    const settled = [...settledSeasons(db).keys()].sort((a, b) => a - b);
    assert.ok(settled.length > 0, "완결 시즌이 0개다 — 대조할 대상이 없다");
    let compared = 0;
    for (const season of settled) {
      const now = battingStreaks(db, season);
      const old = oldBattingStreaks(db, season);
      assert.equal(now.size, old.size, `${season}: 선수 수가 다르다`);
      for (const [playerId, expected] of old) {
        assert.deepEqual(now.get(playerId), expected, `${season} ${playerId}: 결과가 바뀌었다`);
        compared += 1;
      }
    }
    console.log(`타자 연속 기록 대조: ${compared} 선수-시즌 / 완결 ${settled.length} 시즌 — 어긋남 0`);
    assert.ok(compared > 1000, `대조 분모가 너무 작다: ${compared}`);
  });
});
