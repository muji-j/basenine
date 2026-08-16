/**
 * 날짜를 지정해서 보는 화면.
 *
 * ⚠**앞뒤는 달력의 어제·내일이 아니라 「경기가 있었던 날」이다.** 월요일은 대개 경기가 없어서
 * 달력대로 움직이면 빈 날에 떨어진다.
 * ⚠**최신 경기일의 `days/` 페이지는 만들지 않는다** — 그 날은 `today.html`이 이미 맡고 있다.
 * 같은 내용이 두 주소에 생기면 「어느 쪽이 진짜인가」가 생긴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHref, renderDayIndexPage, renderDayPage } from "../src/today-page.ts";
import type { DayIndexData, DayPageData, TodayGame } from "../src/today-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function side(teamCode: string, shortName: string, runs: number | null) {
  return {
    teamCode, shortName, name: `${shortName}チーム`, color: colorOf(teamCode),
    runs, hits: null, errors: null,
  };
}

function game(over: Partial<TodayGame> = {}): TodayGame {
  return {
    gameId: "g1",
    venue: "ベルーナドーム",
    status: "played",
    notPlayedReason: null,
    away: side("m", "ロッテ", 0),
    home: side("l", "西武", 7),
    winner: "home",
    win: null,
    lose: null,
    save: null,
    stars: [],
    hasPage: true,
    ...over,
  };
}

function data(over: Partial<DayPageData> = {}): DayPageData {
  return {
    date: "2026-08-13",
    builtOn: "2026-08-16",
    games: [game()],
    starRule: "3安打以上",
    starLimit: 6,
    prev: "2026-08-12",
    next: "2026-08-14",
    latestDate: "2026-08-15",
    dayCount: 122,
    ...over,
  };
}

test("그 날의 결과가 날짜와 함께 나온다", () => {
  const out = renderDayPage(data(), context());
  assert.match(out, /2026年8月13日の試合/);
  assert.match(out, /2026年8月13日の結果/);
  assert.match(out, /1試合/);
});

test("앞뒤 경기일로 이동한다 — 링크가 어느 날로 가는지도 적는다", () => {
  const out = renderDayPage(data(), context());
  assert.match(out, /href="\.\.\/days\/2026-08-12\.html"/, "앞날 링크가 없다");
  assert.match(out, /href="\.\.\/days\/2026-08-14\.html"/, "뒷날 링크가 없다");
  // ⚠어디로 가는지 글자로도 말한다 — 「前の試合日」만으로는 며칠 전인지 알 수 없다
  assert.match(out, /<i aria-hidden="true">←<\/i>前の試合日<\/span><s>2026年8月12日<\/s>/, "앞 방향 화살표와 날짜가 함께 있지 않다");
  assert.match(out, /次の試合日<i aria-hidden="true">→<\/i><\/span><s>2026年8月14日<\/s>/, "뒤 방향 화살표와 날짜가 함께 있지 않다");
});

/**
 * ⚠**최신 경기일만 `today.html`이다.** 그 날의 `days/` 페이지를 만들지 않으므로,
 * 링크가 갈리지 않으면 **거기가 반드시 404가 된다.**
 */
test("최신 경기일로 가는 링크만 today.html이다", () => {
  assert.equal(dayHref("../", "2026-08-15", "2026-08-15"), "../today.html");
  assert.equal(dayHref("../", "2026-08-14", "2026-08-15"), "../days/2026-08-14.html");
  // 최신을 모르는 경우(경기가 하나도 없는 시즌)에도 날짜 페이지로 간다
  assert.equal(dayHref("", "2026-08-14", null), "days/2026-08-14.html");

  const out = renderDayPage(data({ next: "2026-08-15" }), context());
  assert.match(out, /次の試合日/);
  assert.ok(!out.includes("days/2026-08-15.html"), "만들지 않는 페이지로 링크했다");
  assert.match(out, /href="\.\.\/today\.html"[\s\S]{0,40}?次の試合日/);
});

test("⚠끝에 오면 링크가 아니라 지워진 글자다 — 눌러도 아무 일이 없는 링크를 두지 않는다", () => {
  const out = renderDayPage(data({ prev: null }), context());
  assert.match(out, /<span class="daystep p off">[\s\S]{0,60}?前の試合日/, "끝인데 링크가 아닌 표시가 아니다");
  assert.ok(!/<a class="daystep p"/.test(out), "없는 방향에 링크가 남았다");
});

test("⚠지난 날짜에 「次の予告先発」를 붙이지 않는다 — 그 날의 예고처럼 읽힌다", () => {
  const out = renderDayPage(data(), context());
  assert.ok(!out.includes("予告先発"), "지난 날짜 화면에 예고선발이 있다");
});

test("그 날 경기가 하나도 없으면 그렇게 말한다 — 빈 화면은 고장으로 보인다(M12)", () => {
  const out = renderDayPage(data({ games: [] }), context());
  assert.match(out, /この日の記録がありません|取り込んでいません/);
});

test("중지 경기를 센다 — 「1試合」이라고만 쓰면 하루가 반쯤 사라진다", () => {
  const out = renderDayPage(
    data({ games: [game(), game({ gameId: "g2", status: "notPlayed", notPlayedReason: "雨天中止" })] }),
    context(),
  );
  assert.match(out, /1試合 · 中止1試合/);
});

// ─── 날짜 일람 ────────────────────────────────────────────────────────

function index(over: Partial<DayIndexData> = {}): DayIndexData {
  return {
    season: 2026,
    latestDate: "2026-08-15",
    days: [
      { date: "2026-07-31", scheduled: 6, played: 6 },
      { date: "2026-08-13", scheduled: 6, played: 5 },
      { date: "2026-08-15", scheduled: 6, played: 6 },
    ],
    ...over,
  };
}

test("일람은 달마다 묶고 최근이 위로 온다 — 찾는 날은 대개 최근이다", () => {
  const out = renderDayIndexPage(index(), context());
  const aug = out.indexOf(">8月<");
  const jul = out.indexOf(">7月<");
  assert.ok(aug > 0 && jul > 0, "달 제목이 없다");
  assert.ok(aug < jul, "오래된 달이 위에 있다");
});

/**
 * ⚠**중지만 있었던 날도 남긴다**(M11). 빼면 그 날이 없었던 것이 되고,
 * 「그날 왜 경기가 없었지?」에 답할 수 없다.
 */
test("편성과 실시가 다르면 그 사실을 적는다", () => {
  const out = renderDayIndexPage(index(), context());
  assert.match(out, /5試合<em>中止1<\/em>/, "중지가 있었던 날에 그 사실이 없다");
  assert.match(out, /122日|3日/);
  assert.match(out, /中止1試合/, "표제에 중지 합계가 없다");
});

test("최신 경기일은 today.html로 보내고 지금 보고 있다고 표시한다", () => {
  const out = renderDayIndexPage(index(), context());
  assert.match(out, /class="dayc now"\s+href="today\.html"/);
  assert.match(out, /href="days\/2026-08-13\.html"/);
});

test("경기가 하나도 없는 시즌이면 그렇게 말한다", () => {
  const out = renderDayIndexPage(index({ days: [], latestDate: null }), context());
  assert.match(out, /このシーズンの試合はまだありません/);
});
