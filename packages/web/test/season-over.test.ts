/**
 * **이 시즌이 끝났는가.**
 *
 * ⚠**「끝났다」와 「아직 안 받았다」는 다른 말이다**(M11). 둘 다 화면에서는 「앞으로의 경기가 0건」으로
 * 보이므로, 구별하지 않으면 4년 전 시즌에 대고 「まだ取り込んでいません」이라고 말하게 된다.
 *
 * 지금까지 근거는 **「더 나중 시즌의 경기가 아카이브에 있다」 하나**였다. 그건 정의상 참이지만
 * **오프시즌(11월~이듬해 3월)에는 성립하지 않는다** — 최신 시즌이 끝나고 다음 시즌 첫 경기가
 * 들어오기 전까지 그 근거가 `false` 를 낸다. 그 창에서 화면은 끝난 시즌에 대고
 * 「続いている記録」·「記録に近づいている」라고 **현재형으로 거짓**을 말한다.
 * ⚠이 구멍은 `player-page.ts` 의 `seasonSurelyOver` 주석이 이미 **135장**으로 실측해 적어 두었고,
 * **서로 모르는 두 담당이 독립적으로 찾았다**(handover #56). **11월에 실제로 문다.**
 *
 * → 근거를 하나 더 둔다: **일본시리즈에서 한 팀이 4승에 도달했으면 그 시즌은 끝났다.**
 * 일본시리즈는 NPB 시즌의 마지막 행사이므로 정의상 참이고, **날짜를 안 읽는다**(M6) —
 * 날짜로 어림하면 「수집 지연」과 「시즌 종료」가 같은 신호가 된다.
 *
 * 실측(2026-08-21 · 보유 완결 8시즌): **8/8 시즌 전부** 한 팀이 정확히 4승에 도달한다.
 * ⚠**「4경기」가 아니라 「4승」이다** — 일본시리즈에는 무승부가 있다(2018년은 6경기에 4승 1패 1무).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { seasonIsOver } from "../src/query.ts";

const NOW = "2026-11-20T00:00:00.000Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-seasonover-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let seq = 0;
function game(
  db: Db,
  o: { season: number; date: string; away: string; home: string; competition?: string; awayRuns?: number | null; homeRuns?: number | null },
): void {
  seq += 1;
  upsertGame(db, {
    gameId: `s${seq}`,
    season: o.season,
    gameDate: o.date,
    awayCode: o.away,
    homeCode: o.home,
    gameNo: 1,
    status: "played",
    notPlayedReason: null,
    competition: o.competition ?? "regular",
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
    awayRuns: o.awayRuns ?? 0,
    homeRuns: o.homeRuns ?? 1,
  });
}

/** `wins` 만큼 홈 팀이 이기고, `ties` 만큼 무승부인 일본시리즈 */
function japanSeries(db: Db, season: number, wins: number, ties = 0): void {
  for (let i = 0; i < wins; i += 1) {
    game(db, { season, date: `${season}-10-${String(20 + i).padStart(2, "0")}`, away: "f", home: "h", competition: "nipponSeries", awayRuns: 1, homeRuns: 5 });
  }
  for (let i = 0; i < ties; i += 1) {
    game(db, { season, date: `${season}-11-${String(1 + i).padStart(2, "0")}`, away: "f", home: "h", competition: "nipponSeries", awayRuns: 3, homeRuns: 3 });
  }
}

test("더 나중 시즌의 경기가 있으면 끝난 것이다 — 기존 근거는 그대로 산다", async () => {
  await withDb((db) => {
    game(db, { season: 2025, date: "2025-04-01", away: "t", home: "g" });
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    assert.equal(seasonIsOver(db, 2025), true, "다음 시즌 경기가 있는데 안 끝났다고 했다");
  });
});

test("⚠오프시즌 — 일본시리즈가 결착났으면 다음 시즌 경기가 없어도 끝난 것이다", async () => {
  await withDb((db) => {
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    japanSeries(db, 2026, 4);
    // ⚠**다음 시즌 경기는 하나도 없다** — 11월의 실제 상태다
    assert.equal(seasonIsOver(db, 2026), true, "일본시리즈가 끝났는데 시즌이 안 끝났다고 했다");
  });
});

test("⚠무승부가 섞여도 「4승」으로 센다 — 「4경기」로 세면 2018년이 틀린다", async () => {
  await withDb((db) => {
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    // 3승 + 무승부 2 = 5경기이지만 아직 결착이 아니다
    japanSeries(db, 2026, 3, 2);
    assert.equal(seasonIsOver(db, 2026), false, "무승부를 승으로 셌다 — 결착 전인데 끝났다고 했다");
  });
});

test("일본시리즈가 진행 중이면 아직 끝난 것이 아니다", async () => {
  await withDb((db) => {
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    japanSeries(db, 2026, 3);
    assert.equal(seasonIsOver(db, 2026), false, "3승뿐인데 끝났다고 했다");
  });
});

/**
 * ⚠**클라이맥스 시리즈로는 판정하지 않는다.** 그 뒤에 일본시리즈가 남아 있다.
 * 여기가 흔들리면 10월 중순에 화면이 「시즌 종료」라고 거짓말한다.
 */
test("⚠클라이맥스 시리즈의 승수는 근거가 아니다 — 그 뒤가 남아 있다", async () => {
  await withDb((db) => {
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    for (let i = 0; i < 6; i += 1) {
      game(db, { season: 2026, date: `2026-10-0${i + 1}`, away: "f", home: "h", competition: "climaxSeries", awayRuns: 1, homeRuns: 5 });
    }
    assert.equal(seasonIsOver(db, 2026), false, "CS 승수로 시즌 종료를 판정했다");
  });
});

test("정규시즌만 있으면 아직 모른다 — 「끝나지 않았다」가 아니라 「이 근거로는 못 가른다」다", async () => {
  await withDb((db) => {
    game(db, { season: 2026, date: "2026-04-01", away: "t", home: "g" });
    assert.equal(seasonIsOver(db, 2026), false);
  });
});
