/**
 * ホーム(대시보드).
 *
 * ⚠**여기서 지키는 것은 「정확히 계산되는 것만 낸다」이다.**
 * 마디·페이스·잔여 경기·연속 기록은 전부 우리가 셀 수 있는 값이고,
 * 셀 수 없는 것(마직넘버·통산)은 **화면에 없어야 한다**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGULAR_SEASON_GAMES, renderHomePage } from "../src/home-page.ts";
import type { HomePageData } from "../src/home-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function team(code: string, over: Record<string, unknown> = {}) {
  return {
    teamCode: code,
    shortName: code.toUpperCase(),
    color: colorOf(code),
    rank: 1,
    tiedRank: false,
    w: 58,
    l: 46,
    t: 1,
    pct: 58 / 104,
    gamesBehind: 0,
    played: 105,
    remaining: REGULAR_SEASON_GAMES - 105,
    bestPct: (58 + 38) / (58 + 38 + 46),
    worstPct: 58 / (58 + 46 + 38),
    streak: 3,
    last10: { w: 6, l: 4, t: 0 },
    ...over,
  };
}

function data(over: Partial<HomePageData> = {}): HomePageData {
  return {
    season: 2026,
    asOf: "2026-08-16",
    latestDate: "2026-08-16",
    latest: {
      date: "2026-08-16",
      games: [
        { away: "阪神", home: "広島", awayCode: "t", homeCode: "c", awayRuns: 8, homeRuns: 1 },
        // ⚠**득점을 못 읽은 경기**(M11). 0대0 으로 때우면 무승부가 늘어난다
        { away: "巨人", home: "中日", awayCode: "g", homeCode: "d", awayRuns: null, homeRuns: null },
      ],
    },
    leagues: [
      { id: "central", name: "セントラル・リーグ", rows: [team("t"), team("g", { rank: 2, streak: -4, gamesBehind: 2.5 })] },
    ],
    week: {
      from: "2026-08-10",
      to: "2026-08-16",
      gameDays: 6,
      batters: [
        {
          playerId: "B1", name: "長岡", teamCode: "s", shortName: "ヤクルト", color: colorOf("s"),
          runs: 7.7, faced: 18, line: "18打席 7安打 2本 7打点",
        },
      ],
      pitchers: [
        {
          playerId: "P1", name: "平良", teamCode: "l", shortName: "西武", color: colorOf("l"),
          runs: 3.0, faced: 24, line: "7回 5奪三振 自責0",
        },
      ],
    },
    paces: [
      {
        playerId: "B2", name: "栗原", teamCode: "h", shortName: "ソフトバンク", color: colorOf("h"),
        label: "本塁打", count: 32, teamGames: 107, pace: 42, toNext: 8, next: 40,
      },
    ],
    streaks: [
      {
        playerId: "B3", name: "森下", teamCode: "t", shortName: "阪神", color: colorOf("t"),
        kind: "hitting", games: 12, lastGameDate: "2026-08-16",
      },
    ],
    hasPostseason: false,
    ...over,
  };
}

/**
 * ⚠**마직넘버를 내지 않는다**(2026-08-17 확정). NPB는 승률(무승부 제외)로 순위를 매기고
 * 잔여 맞대결 일정을 우리는 받지 않아, 표준 공식이 그대로 맞지 않는다.
 * 같은 이름으로 다른 값을 내면 그것이 거짓말이 된다 — **화면이 그 사실을 말한다.**
 */
test("⚠マジックナンバー를 내지 않고, 왜 안 내는지 화면이 말한다", () => {
  const out = renderHomePage(data(), context());
  assert.ok(!/マジックナンバー\s*[:：]\s*\d/.test(out), "마직넘버 값을 냈다");
  assert.match(out, /マジックナンバーは出していません/, "안 내는 이유를 말하지 않는다");
});

/**
 * ⚠**통산 기록을 다루지 않는다.** 우리가 가진 것은 4시즌뿐이라
 * 「통산 2000안타까지 3개」는 우리가 할 수 없는 말이다.
 */
test("⚠통산이라고 쓰지 않는다 — 우리는 그 말을 할 수 없다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /通算記録は扱いません/, "통산을 다루지 않는다는 말이 없다");
});

/**
 * ⚠**잔여 경기와 승률 범위는 계산할 수 있는 것이다.** 143은 실측으로 확인한 값이고,
 * 「전승〜전패」는 예측이 아니라 상한·하한이다 — 화면이 그 구별을 말해야 한다.
 */
test("⚠잔여 경기와 「전승〜전패」의 승률이 나오고, 예측이 아니라고 말한다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /<td>38<\/td>/, "잔여 경기가 없다");
  assert.match(out, /予想ではなく計算できる範囲/, "예측이 아니라는 말이 없다");
  assert.ok(out.includes(`${REGULAR_SEASON_GAMES}試合`), "143이라는 기준이 화면에 없다");
});

/** ⚠**연승·연패를 글자로 낸다** — 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
test("연승·연패가 글자로 나온다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /3連勝/);
  assert.match(out, /4連敗/);
});

/**
 * ⚠**득점을 못 읽은 경기를 0으로 그리지 않는다**(M11).
 * 「0-0」으로 그리면 무승부가 하나 생긴 것으로 읽힌다.
 */
test("⚠득점을 못 읽은 경기는 0이 아니라 「없음」으로 나온다(M11)", () => {
  const out = renderHomePage(data(), context());
  const g = out.slice(out.indexOf("巨人"), out.indexOf("巨人") + 220);
  assert.ok(!/<b>0<\/b>/.test(g), "못 읽은 득점을 0으로 그렸다");
  assert.match(g, /<b>—<\/b>/, "「없음」 표시가 없다");
});

/**
 * ⚠**주간 베스트는 율이 아니라 런으로 세운다.** 한 주는 20~30타석이라
 * 율로 줄 세우면 「7타수 4안타」가 1위가 된다 — M2 가 막는 것이 주간 단위에서 되살아난다.
 * ⚠**그래도 표본은 늘 함께 낸다.**
 */
test("⚠주간 베스트에 근거(SRC/SRP)와 표본이 함께 나온다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /先週の顔/);
  assert.match(out, /8\/10〜8\/16 · 6日/, "어느 주인지, 며칠 열렸는지 말하지 않는다");
  assert.match(out, /\+7\.7<\/b><s>SRC<\/s>/, "타자의 근거가 없다");
  assert.match(out, /\+3\.0<\/b><s>SRP<\/s>/, "투수의 근거가 없다");
  assert.match(out, /18打席 7安打 2本 7打点/, "표본이 빠진 성적 줄이다");
  assert.match(out, /率で並べると/, "왜 율로 세우지 않는지 말하지 않는다");
});

/** ⚠**끝난 주가 없으면 그 구획을 통째로 비운다** — 빈 표는 고장으로 읽힌다(M12) */
test("⚠끝난 주가 없으면 「先週の顔」 구획을 만들지 않는다(M12)", () => {
  const out = renderHomePage(data({ week: null }), context());
  assert.ok(!out.includes("b-hweek"), "빈 주간 구획을 남겼다");
});

/**
 * ⚠**환산은 예측이 아니다.** 「이 페이스면 42본」은 계산이고,
 * 분모(그 팀의 소화 경기)가 함께 나와야 무엇을 나눈 값인지 알 수 있다(M2).
 */
test("⚠페이스에 분모와 「예측이 아니다」가 함께 나온다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /32<span class="den">107試合<\/span>/, "환산의 분모가 없다");
  assert.match(out, /40まであと<b>8<\/b>/, "다음 마디가 없다");
  assert.match(out, /予想ではありません/, "예측이 아니라는 말이 없다");
});

/**
 * ⚠**「이어지는 중」은 마지막 출장일과 함께 말한다.**
 * 5월에 끊긴 기록이 8월 화면에 「継続中」으로 남으면 화면이 거짓말을 한다.
 */
test("⚠연속 기록에 마지막 출장일이 반드시 붙는다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /連続安打/);
  assert.match(out, /2026年8月16日/, "마지막 출장일이 없다");
  assert.match(out, /最後の出場日を必ず併記/, "왜 날짜를 내는지 말하지 않는다");
});

/** ⚠**구단 로고를 쓰지 않는다**(§6). 팀을 구별하는 것은 우리가 고른 색과 이름이다 */
test("⚠로고·사진을 쓰지 않는다(§6)", () => {
  const out = renderHomePage(data(), context());
  assert.ok(!/<img/.test(out), "이미지 태그가 들어갔다");
});
