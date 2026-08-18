/**
 * 팀 순위표.
 *
 * ⚠**여기서 잡는 것은 「무엇을 분모에 넣는가」와 「동률을 어떻게 가르는가」다**(M2·M3).
 * 승률의 분모에 무승부를 넣으면 값이 그럴듯하게 조금 작아질 뿐이라 눈으로는 안 보이고,
 * 동률 규칙이 코드에만 있으면 다른 사이트와 어긋났을 때 버그와 구별할 수 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertGame } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { RECENT_GAMES, bestPct, gamesBehind, pctKey, teamStandings, winPct, worstPct } from "../src/standings.ts";

const NOW = "2026-08-16T00:00:00.000Z";

/** 시험용 리그 배정 — 도메인을 끌어오지 않는다(이 모듈은 리그를 주입받는다) */
const LEAGUE: Readonly<Record<string, string>> = {
  a: "x", b: "x", c: "x",
  p: "y", q: "y",
};
const leagueOf = (code: string): string => LEAGUE[code] ?? "x";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-stand-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let seq = 0;
/** 한 경기. `away`가 `ar`점, `home`이 `hr`점 */
function play(
  db: Db,
  away: string,
  home: string,
  ar: number | null,
  hr: number | null,
  over: { date?: string; status?: "played" | "notPlayed" } = {},
): void {
  seq += 1;
  const day = String((seq % 28) + 1).padStart(2, "0");
  upsertGame(db, {
    gameId: `g${seq}`,
    season: 2026,
    gameDate: over.date ?? `2026-04-${day}`,
    awayCode: away,
    homeCode: home,
    gameNo: 1,
    status: over.status ?? "played",
    notPlayedReason: over.status === "notPlayed" ? "雨天中止" : null,
    competition: "regular",
    sourceUrl: "https://npb.jp/x",
    fetchedAt: NOW,
    awayRuns: ar,
    homeRuns: hr,
  });
}

function find(db: Db, code: string) {
  return teamStandings(db, 2026, leagueOf).find((r) => r.teamCode === code)!;
}

test("⚠승률의 분모에서 무승부를 뺀다 — NPB 규칙이다", () => {
  // 2승 1패 1무. NPB식이면 2/3 = .667, MLB식이면 2/4 = .500
  assert.equal(winPct(2, 1), 2 / 3);
  assert.notEqual(winPct(2, 1), 0.5);
});

test("⚠결판난 경기가 없으면 승률은 null이다 — 「0할」이 아니다(M11)", () => {
  assert.equal(winPct(0, 0), null, "무승부만 있는 팀이 전패로 정렬된다");
});

// ─── 전승·전패 승률(「全勝〜全敗の勝率」) ─────────────────────────────────────

/**
 * ⚠**이 자리를 재는 시험이 저장소 전체에 0건이었다**(2026-08-19 재리뷰 Important B).
 * 사본 3벌이던 것을 여기 한 벌로 올려(M1) 홈 순위표(`query.ts`)와 우승 경쟁(`race.ts`)이 같이 쓰게 만들었는데,
 * **공개 API 로 만들면서 시험을 같이 올리지 않았다.**
 * 실측: `bestPct` 를 `winPct(w + remaining, l)` 로 바꿔도(가드 삭제) **1313본이 전부 통과**했다.
 */
test("잔여가 양수면 전승·전패를 잔여만큼 더한다", () => {
  // 70승60패 · 잔여 10 → 전승 80/140 · 전패 70/140
  assert.equal(bestPct(70, 60, 10), 80 / 140);
  assert.equal(worstPct(70, 60, 10), 70 / 140);
});

/**
 * ⚠**음수 잔여가 승수·패수를 깎으면 안 된다.** 소화를 행 수로 세면 팀당 144~153 이 나오던 실측이 있고
 * (`home-page.ts:15`), 그러면 잔여가 음수가 된다. 가드가 없으면 `bestPct` 가 `65/125 = .520` 이 되어
 * **자기 최선을 실제보다 낮게** 잡고 「우승 가능성 소멸」이 거짓으로 켜진다(1차 리뷰 I4).
 *
 * ⚠**가드를 재는 자리는 여기뿐이다** — 잔여 0 으로는 못 잰다.
 * 가드를 지워도 `bestPct(w,l,0) = winPct(w+0, l)` 로 값이 같기 때문이다(실측 확인).
 */
test("⚠음수 잔여는 승수·패수를 깎지 않는다 — 지금 승률 그대로다", () => {
  assert.equal(bestPct(70, 60, -5), 70 / 130, "음수 잔여가 승수를 깎았다(65/125 = .520)");
  assert.equal(worstPct(70, 60, -5), 70 / 130, "음수 잔여가 패수를 깎았다(70/125 = .560)");
});

/** 잔여 0 = 시즌 종료. 더할 것이 없으므로 지금 승률 그대로다 */
test("잔여가 0 이면 전승·전패 승률이 지금 승률과 같다", () => {
  assert.equal(bestPct(70, 60, 0), 70 / 130);
  assert.equal(worstPct(70, 60, 0), 70 / 130);
});

/** ⚠**결판난 경기가 없으면 여기서도 `null` 이다**(M11) — `winPct` 한 벌을 그대로 탄다 */
test("⚠결판난 경기가 없고 잔여도 없으면 전승·전패 승률도 null 이다", () => {
  assert.equal(bestPct(0, 0, 0), null, "「0할」로 흘렀다");
  assert.equal(worstPct(0, 0, 0), null, "「0할」로 흘렀다");
});

test("게임 차 = ((1위 승 − 승) + (패 − 1위 패)) ÷ 2", () => {
  assert.equal(gamesBehind({ w: 58, l: 45, t: 1 }, { w: 56, l: 47, t: 2 }), 2);
  assert.equal(gamesBehind({ w: 58, l: 45, t: 1 }, { w: 58, l: 45, t: 3 }), 0);
});

test("⚠팀 승패를 득점으로만 판정한다 — 투수의 승패 표기로 세면 무승부가 사라진다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 3, 1);
    play(db, "a", "b", 1, 3);
    play(db, "a", "b", 2, 2);
    const a = find(db, "a");
    assert.deepEqual([a.w, a.l, a.t], [1, 1, 1]);
    assert.equal(a.games, 3);
    assert.equal(a.pct, 0.5);
  });
});

test("⚠중지 경기는 세지 않는다 — 치르지 않은 경기가 성적이 되면 안 된다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 3, 1);
    play(db, "a", "b", null, null, { status: "notPlayed" });
    assert.equal(find(db, "a").games, 1);
  });
});

test("⚠득점이 남아 있어도 치르지 않은 경기면 세지 않는다 — 재분류된 ノーゲーム에서 실제로 생긴다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 3, 1);
    // 한 번 played로 적재됐다가 ノーゲーム으로 다시 분류된 경기. 득점 열이 남아 있다
    play(db, "a", "b", 2, 5, { status: "notPlayed" });
    const a = find(db, "a");
    assert.equal(a.games, 1, "치르지 않은 경기를 셌다");
    assert.equal(a.rf, 3, "치르지 않은 경기의 득점이 합계에 들어갔다");
  });
});

test("득점이 없는 경기는 세지 않는다 — 없는 값으로 승패를 만들지 않는다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 3, 1);
    play(db, "a", "b", null, null);
    assert.equal(find(db, "a").games, 1);
  });
});

test("홈과 원정을 나눠 센다 — 뒤집으면 남의 성적이 된다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 1); // a 원정 승
    play(db, "b", "a", 0, 4); // a 홈 승
    play(db, "b", "a", 7, 2); // a 홈 패
    const a = find(db, "a");
    assert.deepEqual([a.away.w, a.away.l], [1, 0]);
    assert.deepEqual([a.home.w, a.home.l], [1, 1]);
    assert.equal(a.rf, 5 + 4 + 2);
    assert.equal(a.ra, 1 + 0 + 7);
  });
});

test(`⚠直近${RECENT_GAMES}試合은 날짜순 뒤에서 센다 — 정렬하지 않으면 아무 ${RECENT_GAMES}경기가 된다`, async () => {
  await withDb((db) => {
    // ⚠**홈과 원정을 번갈아 넣는다.** 이 표는 한 경기를 원정/홈 두 줄로 펴서 만들기 때문에,
    // 정렬하지 않으면 목록이 [원정 경기 전부][홈 경기 전부] 순으로 이어진다 —
    // 날짜를 아무리 넣어도 「뒤에서 10경기」가 홈 경기 뭉치의 꼬리가 된다.
    // (날짜만 뒤섞는 시험은 통하지 않는다. SQLite가 날짜 색인을 타서 우연히 날짜순으로 돌려준다.)
    for (let i = 1; i <= 20; i += 1) {
      const date = `2026-05-${String(i).padStart(2, "0")}`;
      const win = i > 10;
      // 홀숫날은 원정, 짝숫날은 홈
      if (i % 2 === 1) play(db, "a", "b", win ? 5 : 0, win ? 0 : 5, { date });
      else play(db, "b", "a", win ? 0 : 5, win ? 5 : 0, { date });
    }
    const a = find(db, "a");
    assert.equal(a.games, 20);
    assert.deepEqual([a.last10.w, a.last10.l], [10, 0], "직전 10경기가 날짜순이 아니다");
  });
});

test("⚠동률은 당사자 간 대전 성적으로 가른다(M3)", async () => {
  await withDb((db) => {
    // ⚠**정말로 동률로 만든다.** a와 b를 둘 다 2승2패로 두고, 맞대결만 b가 2승0패로 앞선다.
    // (c 상대 성적으로 상쇄한다 — 안 그러면 맞대결에서 이긴 쪽이 승률에서도 앞서
    //  「동률 규칙이 없어도 통과하는」 시험이 된다.)
    play(db, "a", "b", 0, 5); // b 승
    play(db, "b", "a", 5, 0); // b 승
    play(db, "a", "c", 5, 0); // a 승
    play(db, "c", "a", 0, 5); // a 승
    play(db, "b", "c", 0, 5); // b 패
    play(db, "c", "b", 5, 0); // b 패
    const rows = teamStandings(db, 2026, leagueOf).filter((r) => r.league === "x");
    const a = rows.find((r) => r.teamCode === "a")!;
    const b = rows.find((r) => r.teamCode === "b")!;
    assert.deepEqual([a.w, a.l], [2, 2]);
    assert.deepEqual([b.w, b.l], [2, 2]);
    assert.equal(a.pct, b.pct, "시험 데이터가 동률이 아니다");
    assert.ok(b.rank < a.rank, `맞대결에서 앞선 팀이 위가 아니다 (a=${a.rank} b=${b.rank})`);
    assert.ok(!a.tiedRank && !b.tiedRank, "가를 수 있었는데 동률이라고 했다");
  });
});

test("⚠맞대결도 같으면 같은 순위를 주고 「同」이라고 말한다 — 없는 근거로 가르지 않는다", async () => {
  await withDb((db) => {
    // a와 b가 승률도 맞대결도 완전히 같다
    play(db, "a", "c", 5, 0);
    play(db, "c", "a", 5, 0);
    play(db, "b", "c", 5, 0);
    play(db, "c", "b", 5, 0);
    play(db, "a", "b", 5, 0);
    play(db, "b", "a", 5, 0);
    const rows = teamStandings(db, 2026, leagueOf).filter((r) => r.league === "x");
    const a = rows.find((r) => r.teamCode === "a")!;
    const b = rows.find((r) => r.teamCode === "b")!;
    assert.equal(a.pct, b.pct);
    assert.equal(a.rank, b.rank, "가를 수 없는데 순위를 갈랐다");
    assert.ok(a.tiedRank && b.tiedRank, "동률이라고 말하지 않았다");
  });
});

test("동률이 아니면 「同」을 붙이지 않는다 — 붙으면 뜻이 없어진다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 0);
    const rows = teamStandings(db, 2026, leagueOf);
    assert.ok(rows.every((r) => !r.tiedRank));
  });
});

test("⚠교류전 경기도 리그 순위에 든다 — 빼면 어느 사이트와도 맞지 않는다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 0); // 리그 내
    play(db, "a", "p", 5, 0); // 다른 리그 상대
    const a = find(db, "a");
    assert.equal(a.games, 2, "다른 리그 상대 경기가 빠졌다");
    assert.equal(a.w, 2);
  });
});

test("리그마다 따로 순위를 매긴다 — 12팀을 한 표로 세우지 않는다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 0);
    play(db, "p", "q", 5, 0);
    const rows = teamStandings(db, 2026, leagueOf);
    assert.equal(rows.filter((r) => r.rank === 1).length, 2, "리그마다 1위가 하나씩이어야 한다");
    assert.equal(rows.find((r) => r.teamCode === "a")!.rank, 1);
    assert.equal(rows.find((r) => r.teamCode === "p")!.rank, 1);
  });
});

test("1위의 게임 차는 0이고 화면은 그걸 「—」로 읽는다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 0);
    play(db, "a", "b", 5, 0);
    assert.equal(find(db, "a").gamesBehind, 0);
    assert.equal(find(db, "b").gamesBehind, 2);
  });
});

test("팀 타격·투구 합계가 없으면 0으로 채운다 — undefined를 흘리지 않는다", async () => {
  await withDb((db) => {
    play(db, "a", "b", 5, 0);
    const a = find(db, "a");
    assert.equal(a.batting.pa, 0);
    assert.equal(a.pitching.outs, 0);
  });
});

test("경기가 하나도 없으면 빈 배열이다", async () => {
  await withDb((db) => {
    assert.deepEqual(teamStandings(db, 2026, leagueOf), []);
  });
});

/**
 * ⚠**화면에 같은 `.563`인 두 팀이 코드에서는 다른 값일 수 있다.**
 * 배정밀도로 가르면 「同」 표시 없이 순서가 갈리고, 독자는 같은 승률인데 왜 위아래인지 모른다.
 * (2026-08-16 이중 검토에서 지적. 현 데이터에서 발생 0건이지만 경로는 실재한다.)
 */
test("⚠승률은 표시 자릿수(3자리)로 비교한다 — 보이지 않는 소수점 뒤에서 순위를 가르지 않는다", () => {
  // 45승35패 = .56250 · 58승45패 = .56311 — **다른 수인데 화면에는 둘 다 .563**
  const a = winPct(45, 35)!;
  const b = winPct(58, 45)!;
  assert.notEqual(a, b, "시험 데이터가 배정밀도로는 같다 — 이러면 아무것도 안 잰다");
  assert.equal(pctKey(a), pctKey(b), "표시 자릿수로는 같아야 한다");
});

test("표시 자릿수로도 다르면 그대로 가른다", () => {
  assert.notEqual(pctKey(winPct(60, 40)), pctKey(winPct(59, 41)));
});

test("값이 없으면 키도 없다 — 0으로 때우지 않는다(M11)", () => {
  assert.equal(pctKey(null), null);
});
