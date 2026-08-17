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
      teams: [
        { teamCode: "t", shortName: "阪神", color: colorOf("t"), w: 5, l: 1, t: 0, rf: 31, ra: 14 },
      ],
    },
    paces: [
      {
        playerId: "B2", name: "栗原", teamCode: "h", shortName: "ソフトバンク", color: colorOf("h"),
        label: "本塁打", count: 32, teamGames: 107, pace: 42, toNext: 8, next: 40,
      },
      // ⚠**도루 1위가 반드시 있어야 한다.** 예전 필터가 「마디까지 5개 이내」였을 때
      // 이 사람(31 → 다음 마디 40까지 9개)이 통째로 잘려 나갔다
      {
        playerId: "B4", name: "浦田", teamCode: "g", shortName: "巨人", color: colorOf("g"),
        label: "盗塁", count: 31, teamGames: 107, pace: 41, toNext: 9, next: 40,
      },
      // 마디가 남지 않은 사람도 실린다 — 「도전 중」이 아니라 「지금 어떤가」가 이 구획이다
      {
        playerId: "B5", name: "才木", teamCode: "t", shortName: "阪神", color: colorOf("t"),
        label: "奪三振", count: 150, teamGames: 106, pace: 202, toNext: null, next: null,
      },
    ],
    milestones: [
      {
        playerId: "B6", name: "西川", teamCode: "f", shortName: "日本ハム", color: colorOf("f"),
        label: "通算盗塁", count: 344, next: 350, toNext: 6, thisSeason: 12,
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

/**
 * ⚠**주간 승률을 내지 않는다.** 한 주는 5~6경기라 「.833」 같은 수가 나오고,
 * 그 자릿수는 시즌 승률과 같은 무게로 읽힌다 — 승·패·분 그대로가 정직하다(M2).
 * ⚠**득실을 차이만 내지 않는다** — 「+17」이 31-14 인지 20-3 인지 다르다.
 */
test("⚠주간 구단 성적은 승패분과 득실을 그대로 내고, 주간 승률을 만들지 않는다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /<b>5-1-0<\/b>/, "승패분이 없다");
  assert.match(out, /31\/14<s>\+17<\/s>/, "득점·실점과 차이가 함께 나오지 않는다");
  // 주간 승률(.833)을 만들지 않았다
  assert.ok(!out.includes(".833"), "주간 승률을 만들었다");
});

/**
 * ⚠**부문의 실제 상위가 화면에 있어야 한다**(2026-08-17 유저 지적 · 실측으로 재현).
 *
 * 예전에는 「마디까지 5개 이내」로 걸렀는데, 그러면
 * **도루 1위 浦田(31)·홈런 1위 栗原(32)·타점 1위 近藤(87)·탈삼진 1위 才木(150)이
 * 한 명도 화면에 없고**, 대신 「10홈런까지 1개 남은」 9홈런 선수 7명이 자리를 채웠다.
 * 제목이 「今シーズンのペース」인데 페이스가 좋은 사람이 없는 화면이었다.
 */
test("⚠부문 상위가 마디 거리 때문에 잘리지 않는다", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, />浦田</, "도루 1위가 페이스 구획에 없다 — 마디까지 9개라 잘렸다");
  assert.match(out, />栗原</, "홈런 1위가 없다");
  // 마디가 남지 않은 사람도 남는다
  assert.match(out, />才木</, "다음 마디가 없다고 목록에서 뺐다");
});

/** ⚠**무엇을 골랐는지 화면이 말한다**(M3의 정신) — 「왜 4위가 없지?」에 답할 수 있어야 한다 */
test("⚠페이스 구획이 「각 부문 상위 3명」이라고 말한다", () => {
  assert.match(renderHomePage(data(), context()), /各部門の上位3人/);
});

/**
 * ⚠**사이트 첫 화면의 순위표에 순위가 없었다**(2026-08-17 2차 검토 지적).
 * 順位 열이 없으면 **동률 표시(同)도 함께 사라진다** — M3 가 요구하는 동률 규칙이
 * 화면에서 없어지는 것이다. `ranking.html` 은 지키는데 첫 화면만 안 지켰다.
 */
test("⚠순위 열이 있고 동률이 「同」으로 나온다(M3)", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /<th>順位<\/th>/, "순위 열이 없다");
  const tied = renderHomePage(
    data({ leagues: [{ id: "central", name: "セ", rows: [team("t", { tiedRank: true }), team("g", { rank: 2 })] }] }),
    context(),
  );
  assert.match(tied, /<s>同<\/s>/, "동률인데 표시가 없다");
  assert.match(tied, /当該球団間の対戦成績/, "동률을 어떻게 가르는지 말하지 않는다");
});

/** ⚠**「差」가 무엇의 차인지 적는다** — 축약하면 승차인지 승률차인지 알 수 없다 */
test("게임차 열의 이름이 「ゲーム差」다", () => {
  assert.match(renderHomePage(data(), context()), /<th>ゲーム差<\/th>/);
});

/**
 * ⚠**첫 화면에서 갈 곳이 보여야 한다**(2026-08-17 유저 요청).
 * 맨 아래 링크 줄만 있으면 스크롤 끝까지 가야 알 수 있다.
 * ⚠**시즌마다 있고 없고 하는 화면은 넣지 않는다** — 눌러도 빈 화면이 되면 고장으로 읽힌다(M12).
 */
test("⚠첫 화면 위쪽에 주요 페이지로 가는 길이 있다", () => {
  const out = renderHomePage(data(), context());
  const nav = /<nav class="hnav"[\s\S]*?<\/nav>/.exec(out)?.[0] ?? "";
  assert.ok(nav.length > 0, "내비가 없다");
  for (const path of ["ranking.html", "players.html", "today.html", "matchup.html", "compare.html", "days.html"]) {
    assert.ok(nav.includes(path), `${path} 로 가는 길이 없다`);
  }
  // 머리(h1)보다 뒤, 첫 구획보다 앞이다
  assert.ok(out.indexOf('class="hnav"') > out.indexOf("<h1"), "내비가 표제보다 앞에 왔다");
  assert.ok(out.indexOf('class="hnav"') < out.indexOf('class="block"'), "내비가 첫 구획보다 뒤에 있다");
});

/**
 * ⚠**통산 마디는 이 사이트에서 유일하게 출처가 다른 수다**(M4).
 * NPB 가 선수 페이지에 공표한 연도별을 **우리가 더한** 값이고,
 * 다른 수치는 우리가 경기에서 쌓은 것이다 — 화면이 그 구별을 말해야 한다.
 *
 * ⚠**세 가지를 더 말해야 한다.**
 * 1. NPB 기록만이다 — 해외 리그 기간이 빠져 세간의 통산과 다를 수 있다
 * 2. 지금 선수 페이지가 있는 선수만이다 — 은퇴 선수가 없으므로 **통산 순위가 아니다**
 * 3. 무엇으로 골랐는지 — 「남은 수가 적은 순 8명」
 */
test("⚠통산 마디 구획이 출처와 한계를 말한다(M4)", () => {
  const out = renderHomePage(data(), context());
  assert.match(out, /記録に近づいている/);
  assert.match(out, />西川</, "마디에 다가선 선수가 없다");
  assert.match(out, /350まであと<b>6<\/b>/, "남은 수가 안 나온다");
  // 출처와 한계
  assert.match(out, /この表だけ出典が違います/, "출처가 다르다는 말이 없다");
  assert.match(out, /NPBの記録だけ/, "해외 리그가 빠진다는 말이 없다");
  assert.match(out, /通算の順位ではありません/, "은퇴 선수가 없다는 말이 없다");
  assert.match(out, /残りが少ない順/, "무엇으로 골랐는지 말하지 않는다");
});

/** ⚠**마디가 없으면 구획을 통째로 비운다** — 빈 표는 고장으로 읽힌다(M12) */
test("⚠다가선 선수가 없으면 「記録に近づいている」 구획을 만들지 않는다(M12)", () => {
  const out = renderHomePage(data({ milestones: [] }), context());
  assert.ok(!out.includes("b-hmile"), "빈 마디 구획을 남겼다");
});

/**
 * ⚠**통산 블록도 출처를 적는다.** 선수 페이지에서 이 블록만 NPB 공표치다.
 * ⚠**통산은 우리가 더한 값**이라는 것도 적는다 — 남의 계산을 빌린 것이 아니다.
 */
test("⚠선수 페이지의 通算 블록이 출처와 「우리가 더했다」를 말한다(M4)", async () => {
  const { renderPlayerPage } = await import("../src/player-page.ts");
  const { playerPage } = await import("./fixtures.ts");
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /通算成績/);
  assert.match(out, /この表だけ出典が違います/, "출처가 다르다는 말이 없다");
  assert.match(out, /通算は当サイトが足した値/, "우리가 더했다는 말이 없다");
  // ⚠**시즌 수는 행 수가 아니다** — 픽스처에 2025년 두 줄(이적)이 들어 있다
  assert.match(out, /2シーズン/, "이적한 해를 두 시즌으로 셌다");
});
