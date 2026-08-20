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
      // ⚠**투수도 이적한다.** 타자만으로는 투수 쪽 경계가 검사되지 않는다
      ["MOVER_P", "移籍投手"],
    ] as const) {
      upsertPlayer(db, id, name, NOW);
    }
    // 파 리그(西武 l) — 4월. 여기서 더 많이 뛴다
    play(db, "2026-04-01", "l", "m", [{ id: MOVER, pa: 5, h: 2 }, { id: "PL_BAT", pa: 4, h: 1 }], "MOVER_P");
    play(db, "2026-04-02", "l", "m", [{ id: MOVER, pa: 5, h: 1 }, { id: "PL_BAT", pa: 4, h: 2 }], "PL_PIT");
    // 세 리그(阪神 t) — 7월. **가장 최근에 뛴 곳이 여기다**
    play(db, "2026-07-01", "t", "g", [{ id: MOVER, pa: 3, h: 3 }, { id: "CL_BAT", pa: 4, h: 1 }], "MOVER_P");
    /**
     * ⚠**阪神에 경기를 더 채운다. MOVER 는 여기 안 나온다** — 이적 선수의 수(13·10·3·3경기)를
     * 하나도 건드리지 않으면서 **규정타석 기준만 올리기** 위한 것이다.
     *
     * 왜 필요한가: 자격 판정 시험 2본(「소속 리그 몫으로 한다」·「팀이 아니라 리그 몫」)은
     * **세 리그 몫 3타석은 미달이고 합계 13타석은 도달**이어야 뜻이 있다. 즉 기준이
     * **3 초과 13 이하**여야 한다. 阪神이 1경기뿐이면 기준은 `1 × 3.1 = 3.1 → 3` 이라
     * 3타석도 도달이 되어 **두 시험이 아무것도 구별하지 못한다.**
     * ⚠실제로 그렇게 돼 있었다 — 예전 기준은 `切り上げ` 라 `ceil(3.1) = 4` 였고,
     * 두 시험은 **결함이 만든 +1 에 얹혀서** 초록이었다(2026-08-20 규정타석 P0).
     * 3경기면 기준이 9(옛 식으로도 10)라 **어느 반올림 규칙에서도 3 < 기준 ≤ 13** 이 되어,
     * 이 두 시험이 「리그 몫이냐 합계냐」만 재게 된다.
     * ⚠**경기 수를 줄이지 마라.** 줄이면 시험이 조용히 아무것도 안 재는 상태로 돌아간다.
     */
    play(db, "2026-07-02", "t", "g", [{ id: "CL_BAT", pa: 4, h: 1 }], "CL_PIT");
    play(db, "2026-07-03", "t", "g", [{ id: "CL_BAT", pa: 4, h: 2 }], "CL_PIT");
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
    /**
     * ⚠**먼저 이 시험이 무언가를 구별할 수 있는 상태인지 확인한다**(작업규칙 8).
     * 기준이 3 이하이거나 13 초과면 리그 몫(3)과 합계(13)가 **같은 답**을 내어
     * 아래 단언이 조용히 아무것도 재지 않는다.
     */
    assert.ok(
      p.batting!.needPa > 3 && p.batting!.needPa <= 13,
      `규정타석이 ${p.batting!.needPa} 라 리그 몫(3)과 합계(13)가 구별되지 않는다 — 이 시험이 공회전한다`,
    );
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
    /**
     * ⚠**동명이인은 실재한다** — 이 프로젝트가 실측한 「小島」 2명이 그렇다.
     * 표시명도 타석 수도 같으면 정렬의 마지막 갈래가 없는 한 순서가 SQLite의 산출 순서에 기댄다.
     * 그러면 인덱스나 플랜이 바뀌는 날 빌드 diff가 이유 없이 흔들린다. **ID로 고정한다**(M10).
     */
    upsertPlayer(db, "AHERO", "英雄", NOW);
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
      // ⚠같은 이름·같은 타석 수의 두 번째 선수. 정렬의 마지막 갈래가 여기서 드러난다
      upsertBatting(db, {
        gameId: id, playerId: "AHERO", side: "away", battingOrder: "5", position: "(左)",
        pa: 4, ab: 4, h, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
        sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: h, sb: 0,
      });
    };
    play("r1", "2026-04-01", "regular", 2);
    play("r2", "2026-04-02", "regular", 1);
    play("cs1", "2026-10-11", "climaxSeries", 3);
    // ⚠**대회가 둘 이상이어야 「합쳐 집계」가 드러난다.** 하나뿐이면 합쳐도 같은 수가 나온다
    play("ns1", "2026-10-25", "nipponSeries", 1);
    /**
     * ⚠**스테이지와 경기 번호는 데이터에 있는 것을 쓴다.** 우리가 세면 4개의 독립 시리즈가
     * 한 줄로 이어져 최대 6경기짜리 파이널에 「第13戦」이 붙는다(2026-08-16 실측).
     */
    upsertGame(db, {
      gameId: "cs2", season: 2026, gameDate: "2026-10-12", awayCode: "g", homeCode: "t",
      gameNo: 2, status: "played", notPlayedReason: null, competition: "climaxSeries",
      series: "CS ファイナルステージ", sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      awayRuns: 0, homeRuns: 3,
    });
    // ⚠**득점을 못 읽은 경기.** 무승부와 같은 값으로 접으면 「— : — 引き分け」가 나온다(M11)
    upsertGame(db, {
      gameId: "cs3", season: 2026, gameDate: "2026-10-13", awayCode: "g", homeCode: "t",
      gameNo: 3, status: "played", notPlayedReason: null, competition: "climaxSeries",
      series: "CS ファイナルステージ", sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      awayRuns: null, homeRuns: null,
    });
    // ⚠**진짜 무승부.** 결측(cs3)과 같은 값으로 접히지 않는지는 둘이 다 있어야 드러난다
    upsertGame(db, {
      gameId: "cs4", season: 2026, gameDate: "2026-10-14", awayCode: "g", homeCode: "t",
      gameNo: 4, status: "played", notPlayedReason: null, competition: "climaxSeries",
      series: "CS ファイナルステージ", sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
      awayRuns: 2, homeRuns: 2,
    });
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
    assert.equal(cs.games.length, 4);
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
    // ⚠**그 팀에서 낸 것만 실린다.** 「없는 선수가 없다」는 아무것도 재지 않는다 —
    // 실제로 있는 선수가 **그 팀 몫으로** 실렸는지를 본다
    const hero = t.batters.find((b) => b.playerId === "HERO")!;
    assert.notEqual(hero, undefined, "그 팀 선수가 목록에 없다");
    assert.equal(hero.pa, 8, "포스트시즌이나 남의 팀 몫이 섞였다");
    assert.equal(hero.games, 2);
  });
});

/**
 * ⚠**球団ページ는 「이 팀에서 낸 것」만 싣는다.**
 * 합계를 쓰면 이적 선수의 옛 팀 몫이 새 팀 표에 실리고, 같은 화면 머리의 팀 打率 분모
 * (그 팀만의 打数)와 어긋난다 — 실측(2026): 山本가 ソフトバンク 표에 202타석으로 실리고
 * **DeNA 표에는 아예 없었다.** 24장 중 8장에서 머리와 표 합계가 어긋나 있었다.
 */
test("⚠球団ページ는 그 팀에서 낸 것만 싣는다 — 이적 선수가 양쪽에 각자의 몫으로 실린다", async () => {
  await withSite((site) => {
    const cl = site.teams.find((t) => t.teamCode === "t")!; // 세 리그 · 나중
    const pl = site.teams.find((t) => t.teamCode === "l")!; // 파 리그 · 먼저

    const a = cl.batters.find((b) => b.playerId === MOVER)!;
    const b = pl.batters.find((x) => x.playerId === MOVER)!;
    assert.notEqual(a, undefined, "옮겨 간 팀에 없다");
    assert.notEqual(b, undefined, "옛 팀에서 사라졌다 — 그 팀에서 낸 성적은 그 팀 것이다");
    assert.equal(a.pa, 3, "옮겨 간 팀 표에 합계가 실렸다");
    assert.equal(b.pa, 10, "옛 팀 표에 합계가 실렸다");
    // 합계는 선수 페이지의 몫이다
    assert.equal(site.players.find((p) => p.playerId === MOVER)!.batting!.line.pa, 13);
  });
});

/**
 * ⚠**머리의 팀 打数와 표의 打数 합계가 맞아야 한다.**
 * 한 화면 안에서 분모가 두 종류면, 어느 쪽을 믿어야 하는지 화면이 답할 수 없다.
 */
test("⚠머리의 팀 打数와 타자표 打数 합계가 맞는다", async () => {
  await withSite((site) => {
    for (const t of site.teams) {
      const sum = t.batters.reduce((n, b) => n + b.ab, 0);
      assert.equal(sum, t.avg.denominator, `${t.shortName}: 머리 ${t.avg.denominator} · 표합 ${sum}`);
    }
  });
});

/**
 * ⚠**자격 판정은 소속 리그 몫이다** — 팀 몫이 아니다.
 * 타이틀은 리그에서 겨루고, 같은 리그 안에서 이적한 선수의 규정타석은 두 팀분을 합쳐 센다.
 */
test("자격 판정은 팀이 아니라 소속 리그 몫으로 한다", async () => {
  await withSite((site) => {
    const t = site.teams.find((x) => x.teamCode === "t")!;
    const mover = t.batters.find((b) => b.playerId === MOVER)!;
    // ⚠구별 가능한 상태인지 먼저 본다 — 선수 페이지 쪽과 같은 이유다
    const needPa = site.players.find((p) => p.playerId === MOVER)!.batting!.needPa;
    assert.ok(
      needPa > 3 && needPa <= 13,
      `규정타석이 ${needPa} 라 리그 몫(3)과 합계(13)가 구별되지 않는다 — 이 시험이 공회전한다`,
    );
    // 세 리그 몫은 3타석 — 규정에 못 미친다. 팀 표의 3타석과 우연히 같지만 규칙이 다르다
    assert.equal(mover.qualified, false);
  });
});

test("⚠球団ページ의 투수도 그 팀에서 낸 것만 싣는다", async () => {
  await withSite((site) => {
    // ⚠`play()`는 투수를 **원정 팀**에 넣는다 — 그래서 이 투수의 소속은 m(파) → g(세)다
    const cl = site.teams.find((t) => t.teamCode === "g")!;
    const pl = site.teams.find((t) => t.teamCode === "m")!;
    const a = cl.pitchers.find((x) => x.playerId === "MOVER_P")!;
    const b = pl.pitchers.find((x) => x.playerId === "MOVER_P")!;
    assert.notEqual(a, undefined, "옮겨 간 팀에 투수가 없다");
    assert.notEqual(b, undefined, "옛 팀에서 투수가 사라졌다");
    assert.equal(a.games, 1, "옮겨 간 팀 표에 합계가 실렸다");
    assert.equal(b.games, 1, "옛 팀 표에 합계가 실렸다");
    // 합계(2등판)는 선수 페이지의 몫이다
    assert.equal(site.players.find((p) => p.playerId === "MOVER_P")!.pitching!.games, 2);
  });
});

/**
 * ⚠**「第N戦」을 우리가 세지 않는다.** 클라이맥스시리즈는 セ/パ × ファースト/ファイナル =
 * 4개의 독립 시리즈라, 대회 전체에 번호를 이으면 최대 6경기짜리 파이널에 「第13戦」이 붙는다.
 * 정답은 처음부터 데이터에 있었다 — `game.game_no`와 `game.series`다.
 */
test("⚠경기 번호와 스테이지는 데이터에서 온다 — 우리가 세지 않는다", async () => {
  await withPostseason((site) => {
    const cs = site.postseason.competitions.find((c) => c.id === "climaxSeries")!;
    assert.deepEqual(cs.games.map((g) => g.gameNo), [1, 2, 3, 4], "번호를 우리가 셌다");
    assert.deepEqual(
      cs.games.map((g) => g.series),
      [null, "CS ファイナルステージ", "CS ファイナルステージ", "CS ファイナルステージ"],
      "스테이지 표기를 싣지 않았다",
    );
  });
});

/**
 * ⚠**무승부와 「득점을 못 읽음」은 다르다**(M11).
 * 접으면 결측 경기가 「— : — 引き分け」로 나온다 — 있지도 않은 무승부를 만든다.
 */
test("⚠득점을 못 읽은 경기를 무승부로 만들지 않는다(M11)", async () => {
  await withPostseason((site) => {
    const cs = site.postseason.competitions.find((c) => c.id === "climaxSeries")!;
    const missing = cs.games.find((g) => g.gameNo === 3)!;
    assert.equal(missing.away.runs, null);
    assert.equal(missing.winner, null, "결측을 무승부로 접었다");
    // 진짜 결과가 있는 경기는 승자가 잡힌다 — 무승부는 무승부로, 결측은 결측으로
    assert.equal(cs.games.find((g) => g.gameNo === 2)!.winner, "home");
    assert.equal(cs.games.find((g) => g.gameNo === 4)!.winner, "tie", "무승부를 결측으로 접었다");
  });
});

/**
 * ⚠**대회 표기는 경기 페이지에도 실린다**(M4 — 어느 판의 무엇인지 답할 수 있어야 한다).
 * 포스트시즌 화면만 고치고 여기를 잊으면, 같은 경기가 화면마다 다른 것을 말하게 된다.
 */
test("경기 페이지도 대회 표기를 싣는다", async () => {
  await withPostseason((site) => {
    const g = site.games.find((x) => x.gameId === "cs2")!;
    assert.notEqual(g, undefined, "경기 페이지가 만들어지지 않았다");
    assert.equal(g.series, "CS ファイナルステージ", "경기 페이지에서 대회 표기가 사라졌다");
  });
});

/**
 * ⚠**신선도는 대회를 가리지 않는다.** 정규시즌만 보면 10월에 사이트 전체가
 * 「취득 실패」라고 거짓말하고, 빌드가 매일 실패로 끝난다.
 */
test("⚠신선도가 보는 최신 경기일은 포스트시즌을 포함한다", async () => {
  await withPostseason((site) => {
    assert.equal(site.asOf, "2026-04-02", "표시용 기준일은 정규시즌 그대로여야 한다");
    assert.equal(site.latestAnyGameDate, "2026-10-25", "포스트시즌을 보지 않는다");
  });
});

test("선수 페이지에 포스트시즌 요약이 실린다 — 가장 필요한 화면이다", async () => {
  await withPostseason((site) => {
    const p = site.players.find((x) => x.playerId === "HERO")!;
    assert.ok(p.postseason.length >= 2, "포스트시즌 요약이 없다");
    assert.deepEqual(
      p.postseason.map((b) => b.competitionId).sort(),
      ["climaxSeries", "nipponSeries"],
      "대회별로 나뉘지 않았다",
    );
    // ⚠올스타는 넣지 않는다 — 소속이 구단이 아니라 선수 성적을 집계하지 않는다
    assert.ok(!p.postseason.some((b) => b.competitionId === "allStar"));
  });
});

/**
 * ⚠**모르는 대회를 조용히 흘리지 않는다**(M7).
 * 이 화면이 고치고 있는 결함이 정확히 그 모양이었다 — 데이터는 있는데 어느 목록에도 없어서
 * 사이트 전체에서 조용히 사라졌다. 대회가 하나 늘면 같은 일이 반복된다.
 */
test("⚠모르는 대회가 데이터에 있으면 빌드가 멈춘다 — 조용히 사라지는 것보다 낫다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-unknown-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "X", "選手", NOW);
    upsertGame(db, {
      gameId: "op1", season: 2026, gameDate: "2026-03-01", awayCode: "g", homeCode: "t", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "openSeason",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
    });
    assert.throws(
      () => loadSite(db, { season: 2026, builtOn: "2026-08-16" }),
      /모르는 대회/,
      "모르는 대회를 조용히 흘렸다",
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠**「기록이 있다」와 「포스트시즌이 있다」는 다른 말이다.**
 * 2026년은 8월 시점에 올스타 4경기뿐이다. 그런데 「기록이 하나라도 있으면」으로 판정하면
 * 12개 구단 페이지 전부가 「ポストシーズンは別の画面にあります」라고 쓴다 — 없는 것을 있다고 안내한다.
 */
test("⚠올스타뿐인 시즌은 구단 페이지가 포스트시즌을 안내하지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-as-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    upsertPlayer(db, "HERO", "英雄", NOW);
    upsertPlayer(db, "ARM", "剛腕", NOW);
    upsertGame(db, {
      gameId: "r1", season: 2026, gameDate: "2026-04-01", awayCode: "g", homeCode: "t", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular",
      sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
    });
    upsertBatting(db, {
      gameId: "r1", playerId: "HERO", side: "home", battingOrder: "3", position: "(三)",
      pa: 4, ab: 4, h: 2, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
      sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 2, sb: 0,
    });
    // ⚠투수 기록이 없으면 그 리그의 번들 자체가 안 생긴다 — 리그 상수도 없어진다
    upsertPitching(db, {
      gameId: "r1", playerId: "ARM", side: "home", decision: "○",
      outs: 27, bf: 33, pitches: 110, h: 5, hr: 0, bb: 1, hbp: 0, so: 9, runs: 1, er: 1, wp: 0, balk: 0,
    });
    upsertGame(db, {
      gameId: "as1", season: 2026, gameDate: "2026-07-28", awayCode: "cl", homeCode: "pl", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "allStar",
      sourceUrl: "https://npb.jp/y", fetchedAt: NOW, awayRuns: 5, homeRuns: 7,
    });
    const site = loadSite(db, { season: 2026, builtOn: "2026-08-16" });
    assert.equal(site.postseason.competitions.length, 1, "올스타 경기 자체는 실려야 한다");
    assert.ok(
      site.teams.every((t) => !t.hasPostseason),
      "올스타뿐인데 구단 페이지가 포스트시즌이 있다고 말한다",
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ⚠**여기서 재지 못한 것을 적어 둔다** — 통과하든 말든 상관없는 시험을 남기면
 * 「무의미하게 통과하는 시험」이 하나 늘 뿐이라 넣지 않았다(2026-08-16 뮤테이션 검사).
 *
 * - **타율 식을 인라인으로 새로 쓰는 변형**은 `battingAverage`와 **수치가 같다.**
 *   M1(계산식 1벌)은 값이 아니라 구조의 규칙이라 값으로는 잡히지 않는다. 잡는 것은 리뷰다.
 * - **모르는 비구단 코드의 예외**는 `NON_TEAM_CODES`와 `SQUAD`가 둘 다 정확히 `cl`/`pl`이라
 *   현재 코드에서 발화할 수 없다. 발화하는 것은 **새 코드가 생긴 날**이고, 그때를 위한 장치다.
 * - **동점 시 `playerId` 정렬**은 SQLite의 GROUP BY 출력 순서가 이미 안정적이라 가려진다.
 *   가리는 것이 사라지는 날(인덱스·플랜 변경)을 대비한 것이므로 남긴다.
 */

/**
 * ⚠**이 시험은 계약을 못 박을 뿐, 갈래의 유무를 가려내지는 못한다.**
 * SQLite가 `player_id` 순으로 내보내고 갈래도 `playerId` 오름차순이라 **둘의 결과가 같다** —
 * 갈래를 빼도 오늘은 이 시험이 통과한다(2026-08-16 뮤테이션으로 확인).
 * 그래도 남긴다: 가리는 것이 사라지는 날(인덱스·플랜 변경)에 이 시험이 그 순간을 잡는다.
 */
test("⚠표시명도 타석 수도 같으면 선수 ID로 순서를 고정한다(M10)", async () => {
  await withPostseason((site) => {
    const cs = site.postseason.competitions.find((c) => c.id === "climaxSeries")!;
    const same = cs.batters.filter((b) => b.name === "英雄");
    assert.equal(same.length, 2, "동명이인 픽스처가 두 명이 아니다 — 이 시험이 공회전한다");
    assert.equal(same[0]!.pa, same[1]!.pa, "타석 수가 달라 정렬의 마지막 갈래에 닿지 않는다");
    assert.deepEqual(
      same.map((b) => b.playerId),
      ["AHERO", "HERO"],
      "동명·동타석의 순서가 ID로 고정되지 않았다",
    );
  });
});
