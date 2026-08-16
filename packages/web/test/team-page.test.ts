/**
 * 球団ページ.
 *
 * ⚠**순위표에서 팀명을 누른 사람이 오는 자리다.** 지금까지 그 목적지가 없어서
 * 팀을 보려면 순위표의 한 줄과 선수 일람의 한 덩어리를 머리에서 합쳐야 했다.
 * ⚠**여기서 지키는 것은 분모(M2)와 경계(§2-1)다** — 팀 타율에 타수를 붙이고,
 * 이 화면의 수가 정규시즌만이라는 것을 화면이 말한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTeamPage, teamPath } from "../src/team-page.ts";
import type { TeamPageData } from "../src/team-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function data(over: Partial<TeamPageData> = {}): TeamPageData {
  return {
    season: 2026,
    teamCode: "t",
    name: "阪神タイガース",
    shortName: "阪神",
    color: colorOf("t"),
    leagueName: "セントラル・リーグ",
    asOf: "2026-08-15",
    rank: 1,
    tiedRank: false,
    games: 105,
    w: 58,
    l: 46,
    t: 1,
    pct: 58 / 104,
    gamesBehind: 0,
    rf: 394,
    ra: 337,
    avg: { value: 0.245, denominator: 3469 },
    era: { value: 2.95, denominator: 2793 },
    home: { w: 25, l: 24, t: 1 },
    away: { w: 33, l: 22, t: 0 },
    last10: { w: 5, l: 5, t: 0 },
    months: [
      { month: "2026-03", w: 3, l: 1, t: 0 },
      { month: "2026-04", w: 14, l: 9, t: 1 },
    ],
    batters: [
      {
        playerId: "B1", name: "佐藤", games: 100, pa: 420, ab: 380, h: 110, hr: 22, rbi: 70, sb: 3,
        avg: { value: 110 / 380, denominator: 380 },
        obp: { value: 0.36, denominator: 420 },
        slg: { value: 0.52, denominator: 380 },
        ops: { value: 0.88, denominator: 420 },
        qualified: true,
      },
      {
        playerId: "B2", name: "控え", games: 12, pa: 20, ab: 18, h: 4, hr: 0, rbi: 1, sb: 0,
        avg: { value: 4 / 18, denominator: 18 },
        obp: { value: 0.25, denominator: 20 },
        slg: { value: 0.28, denominator: 18 },
        ops: { value: 0.53, denominator: 20 },
        qualified: false,
      },
    ],
    pitchers: [
      {
        playerId: "P1", name: "村上", role: "starter", games: 20, outs: 400,
        w: 12, l: 4, sv: 0, hld: 0, so: 140,
        era: { value: 2.1, denominator: 400 },
        whip: { value: 1.02, denominator: 400 },
        qualified: true,
      },
    ],
    vs: [
    { code: "g", shortName: "巨人", color: colorOf("g"), w: 13, l: 7, t: 0 },
    { code: "db", shortName: "DeNA", color: colorOf("db"), w: 8, l: 8, t: 1 },
    ],
    recent: [
      { date: "2026-08-15", opponent: "広島", home: false, result: "●" },
      { date: "2026-08-14", opponent: "広島", home: true, result: "○" },
    ],
    latestDate: "2026-08-15",
    hasPostseason: false,
    ...over,
  };
}

test("팀 경로는 한 곳에서만 만든다 — 갈리면 어딘가는 404다", () => {
  assert.equal(teamPath("t"), "teams/t.html");
  assert.equal(teamPath("db"), "teams/db.html");
});

test("팀의 지금 상태가 머리에 나온다 — 순위·승패·리그", () => {
  const out = renderTeamPage(data(), context());
  assert.match(out, /阪神タイガース/);
  assert.match(out, /セントラル・リーグ · 1位 · 58-46-1/);
});

test("⚠팀 타율·방어율에 분모가 붙는다(M2)", () => {
  const out = renderTeamPage(data(), context());
  assert.match(out, /<span class="den">3469打数<\/span>/, "팀 타율에 타수가 없다");
  assert.match(out, /<span class="den">931回<\/span>/, "팀 방어율에 이닝이 없다(2793아웃=931이닝)");
});

test("⚠승률의 분모는 勝+敗다 — 무승부가 빠진다는 사실이 값만으로는 안 보인다", () => {
  const out = renderTeamPage(data(), context());
  assert.match(out, /<span class="den">104試合<\/span>/, "승률의 분모가 105경기로 나왔다");
  assert.match(out, /引き分けは分母に入れません/);
});

/**
 * ⚠**이 화면의 수는 전부 정규시즌이다**(§2-1). 포스트시즌이 있는 시즌이면
 * 그것이 다른 화면에 있다는 것까지 말해야 「이 팀 CS 성적은?」이 미아가 되지 않는다.
 */
test("정규시즌만이라는 것을 화면이 말하고, 포스트시즌이 있으면 그 사실도 말한다", () => {
  const without = renderTeamPage(data(), context());
  assert.match(without, /レギュラーシーズン<\/b>のものです。/);
  assert.ok(!without.includes("ポストシーズンは別の画面"), "없는 것을 있다고 했다");

  const with_ = renderTeamPage(data({ hasPostseason: true }), context());
  assert.match(with_, /ポストシーズンは別の画面にあります/);
});

test("규정에 닿지 않은 선수도 목록에 남고, 시각적 무게만 뺀다(M11)", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("控え"), "규정 미달 선수가 목록에서 빠졌다");
  const at = out.indexOf("控え");
  assert.match(out.slice(Math.max(0, at - 120), at), /<tr class="thin">/);
  // 규정에 닿은 선수에는 붙지 않는다
  const q = out.indexOf("佐藤");
  assert.ok(!out.slice(Math.max(0, q - 120), q).includes('class="thin"'));
});

test("월별 승패에 분모(경기 수)가 함께 나온다 — 「4월 14승」만으로는 몇 경기 중인지 모른다", () => {
  const out = renderTeamPage(data(), context());
  assert.match(out, /14-9-1<em>24試合<\/em>/);
});

/**
 * ⚠**최근 경기는 날짜 화면으로 보낸다.** 경기 페이지는 득점을 못 읽은 경기에 대해 만들어지지 않는데
 * 날짜 화면은 언제나 있다.
 * ⚠**주소는 렌더러가 만든다** — 이 화면은 `teams/` 아래(깊이 1)라 루트 기준으로 적으면 전부 404다.
 */
test("최근 경기가 그 날짜 화면으로 가고, 깊이가 맞는다", () => {
  const out = renderTeamPage(data(), context());
  // 최신 경기일은 today.html 이 맡는다
  assert.match(out, /href="\.\.\/today\.html"/);
  assert.match(out, /href="\.\.\/days\/2026-08-14\.html"/);
  assert.ok(!out.includes('href="days/'), "깊이를 무시한 주소가 남았다");
});

test("승패를 글자로도 낸다 — 색만 쓰면 색각 특성에 따라 구별되지 않는다", () => {
  const out = renderTeamPage(data(), context());
  assert.match(out, /<b>●<\/b>/);
  assert.match(out, /<b>○<\/b>/);
});

test("⚠구단 로고를 쓰지 않는다 — 로고는 상표다(§6)", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(!/<img/.test(out), "이미지 태그가 들어갔다");
});

test("경기가 없으면 월별·최근 경기 자리를 통째로 비운다 — 빈 표를 남기지 않는다", () => {
  const out = renderTeamPage(data({ months: [], recent: [] }), context());
  assert.ok(!out.includes("b-teammonth"));
  assert.ok(!out.includes("b-teamgames"));
});

/**
 * ⚠**이 표는 「현재 로스터」가 아니다.** `battingByTeam`은 그 구단에서 낸 몫이라
 * 시즌 도중 떠난 선수도 남는다(실측 2026-08-16: 2026년 3구단·2025년 4구단).
 * 一覧 화면의 구단 묶음은 **최신 소속 기준**이라, 말하지 않으면 두 화면이 같은 로스터를
 * 다르게 말하게 된다. 숫자를 고칠 문제가 아니라 **무엇을 세었는지**를 적을 문제다.
 */
test("표가 「현재 로스터」가 아니라 「이 구단에서 낸 기록」임을 말한다", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("この球団で出場した記録です"), "타자표가 무엇을 센 것인지 말하지 않는다");
  assert.ok(out.includes("この球団で登板した記録です"), "투수표가 무엇을 센 것인지 말하지 않는다");
  assert.equal((out.match(/移籍した/g) ?? []).length, 2, "이적 선수가 포함된다는 말이 빠졌다");
});

/**
 * ⚠**「対戦成績表」가 사이트 3,257장 중 0장이었다**(2026-08-16 확인).
 * NPB 순위표를 보는 사람이 두 번째로 찾는 표인데 없었고, 재료는 계속 있었다.
 */
test("구단 페이지에 상대 구단별 전적이 실린다", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("対戦成績"), "상대전적 표가 없다");
  assert.ok(out.includes("巨人"), "상대 구단이 안 보인다");
  // ⚠**상대 구단 페이지로 갈 수 있어야 한다** — 막다른 표를 만들지 않는다
  assert.match(out, /href="g\.html"/, "상대 구단으로 가는 길이 없다");
});

/**
 * ⚠**무승부는 승률의 분모에서 빠진다**(NPB 규정). 그래서 경기 수를 따로 낸다 —
 * 「13勝7敗」만 보면 몇 경기 중인지 알 수 없다(M2).
 */
test("승·패·분과 경기 수를 함께 낸다 — 무승부가 승률 분모에서 빠지기 때문이다", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("引き分けは勝率の分母に入りません"), "무승부 규칙을 말하지 않는다");
  // 8-8-1 은 17경기다. 분모가 화면에 있어야 한다
  assert.match(out, /<td>17<\/td>/, "경기 수가 없다");
});

/** ⚠**정규시즌만이다**(§2-1). 포스트시즌을 섞으면 어느 규칙에도 속하지 않는 수가 된다 */
test("정규시즌만이라고 화면이 말한다(§2-1)", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("レギュラーシーズンのみです"), "무엇을 센 것인지 말하지 않는다");
});

test("상대가 없으면 표를 만들지 않는다 — 빈 표는 고장으로 보인다(M12)", () => {
  const out = renderTeamPage(data({ vs: [] }), context());
  assert.ok(!out.includes(`id="b-vs"`), "상대가 없는데 빈 표를 냈다");
});
