/**
 * 리그를 넘어 이적한 선수가 **화면까지** 온전히 도착하는가.
 *
 * ⚠**이 시험이 없어서 P0가 나갔다**(2026-08-16 이중 검토).
 * 집계 계층의 이적 시험 8본은 전부 통과하는 동안, `loadSite`가 리그별 항목을
 * `playerId` 하나로 덮어써서 **시즌의 절반이 조용히 사라졌고 2명은 소속 구단이 틀렸다.**
 * 계약이 깨진 곳은 집계가 아니라 **집계 → 화면 경계**였다. 그래서 시험도 그 경계에 둔다.
 *
 * ⚠**나중에 도는 리그가 이겼다**는 것이 결함의 핵심이므로, 여기서는
 * **파(나중) → 세(먼저)** 방향으로 옮긴 선수를 쓴다. 덮어쓰기가 살아 있으면
 * 「지금 세 리그에 있는데 화면은 파 리그 옛 팀」이 되어 반드시 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { loadSite } from "../src/query.ts";

const NOW = "2026-08-16T00:00:00.000Z";
/** 이적 선수. **파 리그(西武)에서 뛰다 세 리그(阪神)로 옮겼다** */
const MOVER = "MOVER";

let seq = 0;
function play(
  db: Db,
  date: string,
  home: string,
  away: string,
  batters: { id: string; pa: number; h: number }[],
  pitcher: string,
): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  for (const b of batters) {
    upsertBatting(db, {
      gameId, playerId: b.id, side: "home", battingOrder: "1", position: "(遊)",
      pa: b.pa, ab: b.pa, h: b.h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
      sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    });
  }
  upsertPitching(db, {
    gameId, playerId: pitcher, side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

async function withSite(fn: (site: ReturnType<typeof loadSite>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-trade-site-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    for (const [id, name] of [
      [MOVER, "移籍太郎"], ["CL_BAT", "セ打者"], ["PL_BAT", "パ打者"],
      ["CL_PIT", "セ投手"], ["PL_PIT", "パ投手"],
    ] as const) {
      upsertPlayer(db, id, name, NOW);
    }
    // 파 리그(西武 l) — 4월. 여기서 더 많이 뛴다
    play(db, "2026-04-01", "l", "m", [{ id: MOVER, pa: 5, h: 2 }, { id: "PL_BAT", pa: 4, h: 1 }], "PL_PIT");
    play(db, "2026-04-02", "l", "m", [{ id: MOVER, pa: 5, h: 1 }, { id: "PL_BAT", pa: 4, h: 2 }], "PL_PIT");
    // 세 리그(阪神 t) — 7월. **가장 최근에 뛴 곳이 여기다**
    play(db, "2026-07-01", "t", "g", [{ id: MOVER, pa: 3, h: 3 }, { id: "CL_BAT", pa: 4, h: 1 }], "CL_PIT");
    fn(loadSite(db, { season: 2026, builtOn: "2026-08-16" }));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠선수 페이지의 성적은 시즌 합계다 — 리그를 넘어도 절반이 사라지지 않는다", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === MOVER)!;
    assert.notEqual(p, undefined, "이적 선수의 페이지가 없다");
    assert.equal(p.batting!.line.pa, 13, "합계 13타석이 아니다(파 10 + 세 3)");
    assert.equal(p.batting!.line.h, 6);
    assert.equal(p.batting!.games, 3);
  });
});

test("⚠소속은 가장 최근에 뛴 팀이다 — 나중에 도는 리그가 이기면 안 된다", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === MOVER)!;
    assert.equal(p.teamCode, "t", "파 리그의 옛 팀이 소속으로 남았다");
    assert.equal(p.teamName, "阪神タイガース");
  });
});

test("⚠현재 팀의 로스터에 실린다 — 빠지면 3클릭 이내 도달이 성립하지 않는다", async () => {
  await withSite((site) => {
    const t = site.index.teams.find((x) => x.code === "t")!;
    assert.ok(
      t.players.some((x) => x.playerId === MOVER),
      "지금 뛰는 팀의 일람에서 이적 선수가 빠졌다",
    );
    const old = site.index.teams.find((x) => x.code === "l");
    assert.ok(
      old === undefined || !old.players.some((x) => x.playerId === MOVER),
      "옛 팀 일람에도 남아 있다 — 한 사람이 두 팀에 있다",
    );
  });
});

test("검색 색인의 구단도 현재 팀이다 — 검색에서 옛 팀으로 찾게 두지 않는다", async () => {
  await withSite((site) => {
    const e = site.search.find((x) => x.i === MOVER)!;
    assert.equal(e.t, "阪神タイガース");
  });
});

/**
 * ⚠**순위는 합계로 매기지 않는다.** NPB의 타이틀은 소속 리그에서 낸 성적으로만 겨룬다.
 * 합계 13타석을 세 리그 순위에 실으면 파 리그에서 친 안타가 세 리그 타이틀에 섞인다.
 */
test("순위표에는 그 리그에서 낸 몫만 실린다 — 합계가 아니다", async () => {
  await withSite((site) => {
    for (const league of site.ranking.leagues) {
      for (const cat of league.categories) {
        for (const panel of cat.panels) {
          const row = panel.rows.find((r) => r.playerId === MOVER);
          if (row === undefined) continue;
          assert.notEqual(
            row.value.denominator,
            13,
            `${league.name}의 ${panel.label}에 합계(13)가 실렸다`,
          );
        }
      }
    }
  });
});

/**
 * ⚠**합계와 순위의 수가 다른 이유를 화면이 말해야 한다.** 말하지 않으면
 * 「어느 쪽이 맞지?」가 되고, 그 질문에 답할 수 없는 화면은 값이 맞아도 틀린 화면이다.
 */
test("이적 이력과 함께 「합계인지 리그별인지」를 화면이 적는다", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === MOVER)!;
    assert.equal(p.stints.length, 2, "리그를 넘었는데 이력이 한 줄이다");
    assert.deepEqual(
      p.stints.map((s) => s.teamCode),
      ["l", "t"],
      "이력이 시간 순이 아니다",
    );
    assert.equal(p.stints.at(-1)!.sample, 3, "마지막 소속의 표본이 그 리그 몫이 아니다");
  });
});

test("리그를 넘지 않은 선수는 아무것도 달라지지 않는다 — 이력도 붙지 않는다", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === "PL_BAT")!;
    assert.equal(p.batting!.line.pa, 8);
    assert.equal(p.teamCode, "l");
    assert.deepEqual(p.stints, []);
  });
});

/**
 * ⚠**자격 판정에 합계를 쓰면 자격이 없는 사람이 자격자가 된다.**
 * 이 선수는 세 리그에서 3타석만 뛰었다 — 합계 13타석을 세 리그의 규정타석에 대면
 * 「규정 도달」로 나오고, 그 순간 순위표의 규칙이 화면과 어긋난다.
 */
test("자격 판정은 소속 리그에서 낸 몫으로 한다 — 합계로 재지 않는다", async () => {
  await withSite((site) => {
    const p = site.players.find((x) => x.playerId === MOVER)!;
    // 세 리그 몫은 3타석. 규정타석(팀 경기수 기준)에 닿지 않는다
    assert.equal(p.batting!.qualified, false, "합계 13타석으로 규정 도달 판정이 났다");
    // 리그를 넘지 않은 선수는 판정이 달라지지 않는다
    const plain = site.players.find((x) => x.playerId === "PL_BAT")!;
    assert.equal(plain.batting!.qualified, plain.batting!.line.pa >= plain.batting!.needPa);
  });
});

/**
 * ⚠**검색 결과의 성적은 비율이다 — 분모 없이 내보내면 M2 위반이 색인에서 시작된다.**
 * 화면이 아무리 조심해도 데이터가 분모를 안 들고 오면 붙일 것이 없다.
 */
test("검색 색인의 성적 한 줄에 분모가 붙어 있다(M2)", async () => {
  await withSite((site) => {
    const bat = site.search.find((x) => x.i === "PL_BAT")!;
    assert.notEqual(bat.s, undefined, "타자에게 성적 줄이 없다");
    assert.match(bat.s!, /^打率 \.[0-9]{3}（[0-9]+打数）$/, `분모가 없다: ${bat.s}`);

    const pit = site.search.find((x) => x.i === "PL_PIT")!;
    assert.notEqual(pit.s, undefined, "투수에게 성적 줄이 없다");
    assert.match(pit.s!, /^防御率 [0-9.]+（[0-9.]+回）$/, `분모가 없다: ${pit.s}`);
  });
});

// ─── ポストシーズン의 경계 ──────────────────────────────────────────────

/**
 * ⚠**배제하지 않고 구분한다.** 데이터는 처음부터 있었는데 모든 화면이 `regular` 로 걸러
 * 통째로 안 보여주고 있었다(실측: 2025년 CS 13경기·일본시리즈 5경기).
 * ⚠**그렇다고 정규시즌에 더하지 않는다**(§2-1) — 여기서 지키는 것이 그 경계다.
 */
async function withPostseason(fn: (site: ReturnType<typeof loadSite>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-post-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "HERO", "英雄", NOW);
    upsertPlayer(db, "ARM", "剛腕", NOW);
    const play = (id: string, date: string, comp: string, h: number): void => {
      upsertGame(db, {
        gameId: id, season: 2026, gameDate: date, awayCode: "g", homeCode: "t", gameNo: 1,
        status: "played", notPlayedReason: null, competition: comp,
        sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
      });
      upsertBatting(db, {
        gameId: id, playerId: "HERO", side: "home", battingOrder: "3", position: "(三)",
        pa: 4, ab: 4, h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
        sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: h, sb: 0,
      });
      upsertPitching(db, {
        gameId: id, playerId: "ARM", side: "home", decision: "○",
        outs: 21, bf: 28, pitches: 95, h: 4, hr: 0, bb: 1, hbp: 0, so: 8, runs: 1, er: 1, wp: 0, balk: 0,
      });
    };
    play("r1", "2026-04-01", "regular", 2);
    play("r2", "2026-04-02", "regular", 1);
    play("cs1", "2026-10-11", "climaxSeries", 3);
    // ⚠**대회가 둘 이상이어야 「합쳐 집계」가 드러난다.** 하나뿐이면 합쳐도 같은 수가 나온다
    play("ns1", "2026-10-25", "nipponSeries", 1);
    /**
     * ⚠**올스타는 팀 코드가 구단이 아니다**(`cl`/`pl` = 리그 선발).
     * 구단 마스터에 없으므로 집계하면 예외가 난다 — 그 예외는 M7의 안전장치이고,
     * 2025년 CS·일본시리즈 18경기가 정규시즌에 섞여 있던 것을 잡아낸 바로 그 장치다.
     * 그래서 경기만 싣고 선수 성적은 만들지 않는다. **이 시험이 그 경계를 지킨다.**
     */
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-28", awayCode: "cl", homeCode: "pl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/y", fetchedAt: NOW, awayRuns: 5, homeRuns: 7,
    });
    upsertBatting(db, {
      gameId: "as1", playerId: "HERO", side: "away", battingOrder: "3", position: "(三)",
      pa: 3, ab: 3, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
      sf: 0, sh: 0, so: 1, roe: 0, runs: 0, rbi: 0, sb: 0,
    });
    fn(loadSite(db, { season: 2026, builtOn: "2026-11-01" }));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠포스트시즌을 정규시즌 성적에 더하지 않는다 — 섞으면 어느 규칙에도 속하지 않는 수가 된다", async () => {
  await withPostseason((site) => {
    const p = site.players.find((x) => x.playerId === "HERO")!;
    // 정규 2경기 8타석 3안타. CS 1경기 4타석 3안타는 **들어가면 안 된다**
    assert.equal(p.batting!.line.pa, 8, "포스트시즌이 시즌 합계에 섞였다");
    assert.equal(p.batting!.line.h, 3);
    assert.equal(p.batting!.games, 2);
  });
});

test("포스트시즌 성적은 그 화면에 따로 있다 — 배제하지 않는다", async () => {
  await withPostseason((site) => {
    assert.deepEqual(
      site.postseason.competitions.map((c) => c.id),
      ["climaxSeries", "nipponSeries", "allStar"],
      "대회가 통째로 사라졌거나 순서가 뒤집혔다",
    );
    const cs = site.postseason.competitions[0]!;
    assert.equal(cs.games.length, 1);
    const hero = cs.batters.find((b) => b.playerId === "HERO")!;
    assert.equal(hero.pa, 4, "CS 몫이 아니라 다른 수가 실렸다");
    assert.equal(hero.h, 3);
    assert.equal(cs.pitchers.find((x) => x.playerId === "ARM")!.outs, 21);
  });
});

/**
 * ⚠**대회끼리도 섞지 않는다.** 클라이맥스시리즈와 일본시리즈는 다른 대회다.
 * 하나로 합치면 그 수는 어느 대회의 기록도 아니게 된다(§2-1).
 */
test("⚠대회끼리도 합치지 않는다 — CS와 일본시리즈는 다른 수다", async () => {
  await withPostseason((site) => {
    const cs = site.postseason.competitions.find((c) => c.id === "climaxSeries")!;
    const ns = site.postseason.competitions.find((c) => c.id === "nipponSeries")!;
    assert.equal(cs.batters.find((b) => b.playerId === "HERO")!.h, 3, "CS 안타가 아니다");
    assert.equal(ns.batters.find((b) => b.playerId === "HERO")!.h, 1, "일본시리즈 안타가 아니다");
    assert.equal(ns.games.length, 1);
  });
});

/**
 * ⚠**올스타는 구단인 척하지 않는다.** 소속이 `cl`/`pl`(리그 선발)이라 구단이 아니고,
 * 억지로 구단 마스터에 끼워 넣으면 「모르는 코드는 예외」라는 안전장치(M7)를 우리 손으로 무너뜨린다.
 */
test("올스타는 경기만 싣고 선수 성적은 만들지 않는다 — 안전장치를 무너뜨리지 않는다", async () => {
  await withPostseason((site) => {
    const as = site.postseason.competitions.find((c) => c.id === "allStar")!;
    assert.equal(as.games.length, 1);
    assert.deepEqual(as.batters, [], "구단이 아닌 소속으로 선수 성적을 만들었다");
    assert.deepEqual(as.pitchers, []);
    // 리그 선발이라는 것이 이름에 드러난다
    assert.equal(as.games[0]!.away.shortName, "セ・リーグ");
    assert.equal(as.games[0]!.home.shortName, "パ・リーグ");
    // ⚠올스타 타석이 정규시즌에도 포스트시즌 집계에도 들어가면 안 된다
    const p = site.players.find((x) => x.playerId === "HERO")!;
    assert.equal(p.batting!.line.pa, 8, "올스타 타석이 시즌 합계에 섞였다");
  });
});

test("⚠순위표에도 포스트시즌이 섞이지 않는다", async () => {
  await withPostseason((site) => {
    const rows = site.ranking.standings.flatMap((s) => s.rows);
    const t = rows.find((r) => r.teamCode === "t");
    // 정규시즌 2경기만 센다
    assert.equal(t?.games, 2, "순위표에 포스트시즌 경기가 들어갔다");
  });
});

test("포스트시즌의 경기 상세 페이지도 만든다 — 링크가 죽지 않는다", async () => {
  await withPostseason((site) => {
    const ids = site.games.map((g) => g.gameId);
    assert.ok(ids.includes("cs1"), "포스트시즌 경기 페이지가 없다");
    assert.ok(ids.includes("r1"), "정규시즌 경기 페이지가 사라졌다");
    // 포스트시즌 화면의 링크가 실제로 만든 페이지를 가리킨다
    assert.equal(site.postseason.competitions[0]!.games[0]!.hasPage, true);
  });
});

test("팀 페이지도 정규시즌만 센다 — 12구단분이 나온다", async () => {
  await withPostseason((site) => {
    const t = site.teams.find((x) => x.teamCode === "t")!;
    assert.equal(t.games, 2, "팀 페이지에 포스트시즌이 섞였다");
    assert.equal(t.hasPostseason, true, "포스트시즌이 있는데 없다고 했다");
    // 그 팀 선수만 실린다
    assert.ok(t.batters.every((b) => b.playerId !== "NOBODY"));
    assert.ok(t.batters.some((b) => b.playerId === "HERO"));
  });
});
