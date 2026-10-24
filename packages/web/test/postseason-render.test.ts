/**
 * 포스트시즌 화면(PR-3)의 **문구 표 · 결정표 · 표기 함수** — 순수 함수와 렌더 조각.
 *
 * 설계: `docs/superpowers/specs/2026-10-24-postseason-display-design.md` D3 · D4 · D5 · D7 · D8 · D9
 * ⚠DB 로 재는 시나리오(T1~T13)는 `postseason-timeline.test.ts` 가 갖는다. 여기는 그 밑의 **한 벌**을 직접 잰다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextStateLine,
  nipponSeriesText,
  notPlayedText,
  notRecordedText,
  renderDayIndexPage,
  renderDayPage,
  renderTodayPage,
  withStartersBehind,
} from "../src/today-page.ts";
import type { DayIndexData, DayPageData, NextProbable, TodayGame, TodayPageData } from "../src/today-page.ts";
import { renderHomePage } from "../src/home-page.ts";
import { nextGameText } from "../src/team-page.ts";
import type { TeamNextGame } from "../src/team-page.ts";
import { postseasonLabel, postseasonStage } from "../src/query.ts";
import { collectionStatusFromDates, freshness } from "../src/layout.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

/* ── D4 日本シリーズ 문구 ─────────────────────────────────────────────── */

const H = (w: number, l: number, t = 0) => ({ teamCode: "h", shortName: "ソフトバンク", w, l, t });
const DB = (w: number, l: number, t = 0) => ({ teamCode: "db", shortName: "DeNA", w, l, t });

test("⚠D4 문구 — 진행은 앞선 구단 · 동률은 구단 없이 · 결착은 「で日本一」 · 分은 있을 때만", () => {
  assert.equal(nipponSeriesText({ teams: [H(2, 1), DB(1, 2)], unknownGames: 0 }), "対戦成績 ソフトバンク 2勝1敗");
  assert.equal(nipponSeriesText({ teams: [DB(1, 2), H(2, 1)], unknownGames: 0 }), "対戦成績 ソフトバンク 2勝1敗", "순서에 따라 앞선 구단이 바뀌었다");
  assert.equal(nipponSeriesText({ teams: [H(2, 2), DB(2, 2)], unknownGames: 0 }), "対戦成績 2勝2敗");
  assert.equal(nipponSeriesText({ teams: [H(1, 1, 1), DB(1, 1, 1)], unknownGames: 0 }), "対戦成績 1勝1敗1分");
  assert.equal(nipponSeriesText({ teams: [H(4, 2), DB(2, 4)], unknownGames: 0 }), "ソフトバンクが4勝2敗で日本一");
  assert.equal(nipponSeriesText({ teams: [H(4, 1, 1), DB(1, 4, 1)], unknownGames: 0 }), "ソフトバンクが4勝1敗1分で日本一");
});

test("⚠D4 결측 — 성적을 말하지 않고 모른다고 말한다 · 알려진 4승은 결착이다", () => {
  assert.equal(nipponSeriesText({ teams: [H(2, 1), DB(1, 2)], unknownGames: 1 }), "対戦成績は確認できません（得点を読めていない試合 1）");
  assert.equal(nipponSeriesText({ teams: [], unknownGames: 2 }), "対戦成績は確認できません（得点を読めていない試合 2）");
  assert.equal(nipponSeriesText({ teams: [H(4, 1), DB(1, 4)], unknownGames: 1 }), "ソフトバンクが日本一（対戦成績は確認できません）");
});

/* ── D3 대회 표기 ───────────────────────────────────────────────────── */

test("⚠D3 표기 — CS 는 리그(홈 팀)를 붙이고 · 日本S 는 후원사 없이 · 2020 원문 그대로 · 정규는 없다", () => {
  assert.equal(postseasonLabel("climaxSeries", "CS ファイナルステージ", "t", 4), "セ・リーグ CS ファイナルステージ 第4戦");
  assert.equal(postseasonLabel("climaxSeries", "CS ファーストステージ", "l", 3), "パ・リーグ CS ファーストステージ 第3戦");
  assert.equal(postseasonLabel("climaxSeries", "クライマックスシリーズ", "h", 2), "パ・リーグ クライマックスシリーズ 第2戦");
  assert.equal(postseasonLabel("nipponSeries", "SMBC日本シリーズ", "db", 1), "日本シリーズ 第1戦");
  assert.equal(postseasonLabel("regular", "セ・リーグ公式戦", "t", 25), null);
  // ⚠원문이 없으면 대회 이름으로 — 빈 표기를 내지 않는다
  assert.equal(postseasonLabel("climaxSeries", null, "g", 1), "セ・リーグ クライマックスシリーズ 第1戦");
});

test("D3 他大会 스테이지 — CS 는 지금 바이트 그대로 · 日本S 는 대회 이름(그룹이 하나라 제목이 안 나온다) · 올스타는 원문", () => {
  assert.equal(postseasonStage("climaxSeries", "CS ファーストステージ", "g"), "セ・リーグ CS ファーストステージ");
  assert.equal(postseasonStage("climaxSeries", null, "g"), null);
  assert.equal(postseasonStage("nipponSeries", "SMBC日本シリーズ", "h"), "日本シリーズ");
  assert.equal(postseasonStage("allStar", "オールスターゲーム", "cl"), "オールスターゲーム");
  assert.equal(postseasonStage("regular", "セ・リーグ公式戦", "t"), null);
});

/* ── D5 次の予告先発 ───────────────────────────────────────────────── */

test("⚠D5 상태 6종 — 문구와 모양(data-state)이 kind 마다 하나다", () => {
  const cases: [NextProbable, string | null, RegExp | null][] = [
    [{ kind: "seasonOver", recorded: true, savedFrom: 2026 }, "offseason", /このシーズンの試合は終わりました/],
    [{ kind: "seasonOver", recorded: false, savedFrom: 2026 }, "offseason", /この年の予告先発は記録していません（保存は2026年から）/],
    [{ kind: "announced", date: "2026-10-11", probables: [] }, null, null],
    [{ kind: "withdrawn", date: "2026-10-18" }, "empty", /2026年10月18日の予告先発は発表されましたが、試合は行われませんでした（NPB がこの日を「試合が予定されていません」と公表）/],
    [{ kind: "unknown", date: "2026-10-18", probables: [] }, "failed", /2026年10月18日の予告先発が有効か確認できません（取得時刻が記録されていない行があります）/],
    [{ kind: "behind", date: "2026-10-24" }, "failed", /2026年10月24日の予告先発を取り込めていません/],
    [{ kind: "awaiting", nextGameDay: "2026-10-24" }, "empty", /予告先発はまだ発表されていません。次の試合は2026年10月24日です（発表は前日〜当日）/],
    [{ kind: "awaiting", nextGameDay: null }, "failed", /次の試合の日程がまだありません（日程を取り込めていない場合もあります）/],
  ];
  for (const [n, state, text] of cases) {
    const line = nextStateLine(n);
    assert.equal(line?.state ?? null, state, `${n.kind}: 모양`);
    if (text !== null) assert.match(line!.text, text);
  }
  assert.equal(notRecordedText(null), "この年の予告先発は記録していません", "첫 보존 연도를 모르면 지어내지 않는다");
});

test("⚠D5 ⑤ 는 ⑥ 만 올린다 — ①~④ 가 먼저다", () => {
  const missing = "2026-10-24";
  assert.deepEqual(withStartersBehind({ kind: "awaiting", nextGameDay: "2026-10-24" }, missing), { kind: "behind", date: missing });
  assert.deepEqual(withStartersBehind({ kind: "awaiting", nextGameDay: null }, missing), { kind: "behind", date: missing });
  for (const n of [
    { kind: "seasonOver", recorded: true, savedFrom: 2026 },
    { kind: "announced", date: "2026-10-24", probables: [] },
    { kind: "withdrawn", date: "2026-10-24" },
    { kind: "unknown", date: "2026-10-24", probables: [] },
  ] as NextProbable[]) {
    assert.deepEqual(withStartersBehind(n, missing), n, `${n.kind} 를 ⑤ 로 덮었다`);
  }
  assert.deepEqual(withStartersBehind({ kind: "awaiting", nextGameDay: "2026-10-25" }, null), { kind: "awaiting", nextGameDay: "2026-10-25" });
});

function todayData(over: Partial<TodayPageData> = {}): TodayPageData {
  return {
    gameDate: "2026-10-17", builtOn: "2026-10-24", games: [],
    next: { kind: "awaiting", nextGameDay: "2026-10-24" },
    starRule: "x", starLimit: 6, prev: null, dayCount: 1, ...over,
  };
}

test("⚠D5 렌더 — 빌드의 수집 판정(startersMissingDate)이 「発表前」을 「取り込めていません」으로 올린다", () => {
  const col = { ...collectionStatusFromDates("2026-10-17", "2026-10-24", false), startersMissingDate: "2026-10-24" };
  const out = renderTodayPage(todayData(), context({ freshness: freshness("2026-10-17", "2026-10-24", "2026-10-08", { from: 2018, to: 2026 }, false, col) }));
  assert.match(out, /<p class="empty" data-state="failed" role="status">2026年10月24日の予告先発を取り込めていません<\/p>/);
  // 띠는 이 축을 말하지 않는다 — 띠는 여전히 「反映」이다
  assert.match(out, /最新の試合 2026年10月17日 まで反映（レギュラーシーズンは 2026年10月8日 まで）/);
});

test("D5 렌더 — 발표된 카드에는 「防御率はレギュラーシーズンの成績です」 각주와 「本日」이 붙는다", () => {
  const out = renderTodayPage(todayData({
    builtOn: "2026-10-11",
    next: {
      kind: "announced", date: "2026-10-11", probables: [{
        venue: "東京ドーム", startTime: "18:00", anchor: "sg-g-db",
        sides: [
          { shortName: "巨人", color: colorOf("g"), playerId: "P1", name: "戸郷", era: { value: 2.1, denominator: 300 } },
          { shortName: "DeNA", color: colorOf("db"), playerId: "P2", name: "東", era: { value: 2.5, denominator: 330 } },
        ],
      }],
    },
  }), context());
  assert.match(out, /次の予告先発<span class="qt">2026年10月11日（本日）<\/span>/);
  assert.match(out, /防御率はレギュラーシーズンの成績です/);
});

/* ── D8 중지 문구 · 홈 ─────────────────────────────────────────────── */

test("⚠D8 중지 문구는 한 벌이다 — 사유가 없으면 「試合なし」", () => {
  assert.equal(notPlayedText("中止"), "中止");
  assert.equal(notPlayedText(null), "試合なし");
});

test("⚠D8 홈 — 대회 표기 줄과 「中止」(점수 자리) · 정규 줄은 바이트 그대로", () => {
  const base = {
    season: 2026, asOf: "2026-10-08", todayDate: "2026-10-17", leagues: [], week: null, paces: [], milestones: [],
    streaks: [], hasPostseason: true, seasonOver: false,
  };
  const out = renderHomePage({
    ...base,
    latest: {
      date: "2026-10-17",
      games: [
        { away: "DeNA", home: "阪神", awayCode: "db", homeCode: "t", label: "セ・リーグ CS ファイナルステージ 第4戦", series: null, status: "played", awayRuns: 8, homeRuns: 5 },
        { away: "日本ハム", home: "ソフトバンク", awayCode: "f", homeCode: "h", label: "パ・リーグ CS ファイナルステージ 第4戦", series: null, status: "notPlayed", reason: "中止" },
      ],
    },
  }, context());
  assert.match(out, /<span class="hg-c">セ・リーグ CS ファイナルステージ 第4戦<\/span>/);
  assert.match(out, /<b class="hg-s hg-off">中止<\/b>/);
  assert.ok(!/—<s>-<\/s>—/.test(out), "중지 경기를 「득점 모름」으로 그렸다");
  assert.match(out, /<span class="asof">レギュラーシーズンは 2026年10月8日 まで<\/span>/);
  // 정규만인 날 — 표기 줄이 없고 머리는 지금 그대로
  const regular = renderHomePage({
    ...base, todayDate: "2026-10-08",
    latest: { date: "2026-10-08", games: [{ away: "巨人", home: "阪神", awayCode: "g", homeCode: "t", label: null, series: null, status: "played", awayRuns: 1, homeRuns: 2 }] },
  }, context());
  assert.ok(!regular.includes("hg-c"), "정규 줄에 대회 표기 줄이 생겼다");
  assert.match(regular, /<li>\n    <span class="hg-t">巨人<\/span>/, "정규 줄의 바이트가 바뀌었다");
  assert.match(regular, /<span class="asof">2026年10月8日まで<\/span>/);
});

/* ── D7 구단 「次の試合」 ─────────────────────────────────────────────── */

const NEXT_JS: TeamNextGame = {
  date: "2026-10-24", opponentCode: "db", opponentName: "DeNA", home: false, venue: "横浜", startTime: "18:30", competition: "nipponSeries",
};

test("⚠D7 결정표 — 시즌 종료가 남은 예정보다 먼저 · 日本S 는 표기 · 소진은 「全日程を終えました」 · 그 밖은 「場合も」", () => {
  assert.equal(nextGameText({ next: NEXT_JS, seasonOver: true, regularDone: true }), "このシーズンは終了しています");
  assert.equal(nextGameText({ next: NEXT_JS, seasonOver: false, regularDone: true }), "2026年10月24日 18:30 ＠DeNA（横浜） — 日本シリーズ");
  assert.equal(nextGameText({ next: { ...NEXT_JS, competition: "regular" }, seasonOver: false, regularDone: false }), "2026年10月24日 18:30 ＠DeNA（横浜）");
  assert.equal(nextGameText({ next: null, seasonOver: false, regularDone: true }), "レギュラーシーズンの全日程を終えました");
  assert.equal(nextGameText({ next: null, seasonOver: false, regularDone: false }), "予定はありません（日程をまだ取り込んでいない場合もあります）");
});

/* ── D9 부제 · 일람 ─────────────────────────────────────────────────── */

function game(over: Partial<TodayGame>): TodayGame {
  return {
    gameId: "g", venue: "甲子園", competition: "regular", label: null, series: null, status: "played", notPlayedReason: null,
    away: { teamCode: "g", shortName: "巨人", name: "巨人", color: colorOf("g"), runs: 1, hits: null, errors: null },
    home: { teamCode: "t", shortName: "阪神", name: "阪神", color: colorOf("t"), runs: 2, hits: null, errors: null },
    winner: "home", win: null, lose: null, save: null, stars: [], hasPage: false, ...over,
  };
}

function dayData(games: TodayGame[]): DayPageData {
  return { date: "2026-10-13", builtOn: "2026-10-24", games, starRule: "x", starLimit: 6, prev: null, next: null, todayDate: "2026-10-17", dayCount: 3 };
}

test("⚠D9 부제 — 정규만은 지금 그대로 · 포스트시즌 한 대회만은 대회 이름 · 섞이면 「うち」", () => {
  const cs = (o: Partial<TodayGame> = {}) => game({ competition: "climaxSeries", label: "セ・リーグ CS ファーストステージ 第1戦", ...o });
  assert.match(renderDayPage(dayData([game({}), game({ status: "notPlayed" })]), context()), /<span class="sub">1試合 · 中止1試合<\/span>/);
  assert.match(renderDayPage(dayData([cs(), cs({ gameId: "h" })]), context()), /<span class="sub">クライマックスシリーズ 2試合<\/span>/);
  assert.match(renderDayPage(dayData([game({}), game({}), cs(), cs()]), context()), /<span class="sub">4試合（うちクライマックスシリーズ 2）<\/span>/);
});

test("⚠D9 일람 — 칸에 「CS」·「日本S」를 글자로(中止 상자와 다른 모양) · 머리에 「うちポストシーズン」", () => {
  const idx: DayIndexData = {
    season: 2026, todayDate: "2026-10-24",
    days: [
      { date: "2026-10-08", scheduled: 6, played: 6, competitions: ["regular"] },
      { date: "2026-10-17", scheduled: 1, played: 1, competitions: ["climaxSeries"] },
      { date: "2026-10-24", scheduled: 1, played: 0, competitions: ["nipponSeries"] },
    ],
    postseasonPlayed: 1,
  };
  const out = renderDayIndexPage(idx, context());
  assert.match(out, /<s>1試合<\/s><i class="dk">CS<\/i>/);
  assert.match(out, /<s>0試合<em>中止1<\/em><\/s><i class="dk">日本S<\/i>/);
  assert.match(out, /<s>6試合<\/s>\n/, "정규 칸에 대회 표기를 붙였다");
  assert.match(out, /2026年 · 3日 · 7試合（うちポストシーズン 1） · 中止1試合/);
});
