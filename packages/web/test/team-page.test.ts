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
import type { TeamNow, TeamPageData } from "../src/team-page.ts";
import type { TeamRace } from "@bb-app/aggregate";
import type { HomeMilestone, HomeStreak } from "../src/home-page.ts";
import { colorOf } from "@bb-app/domain";
import { NO_VALUE } from "../src/format.ts";
import { context } from "./fixtures.ts";

/**
 * 우승 경쟁 판정 한 벌.
 *
 * ⚠**기본값은 「판정이 서 있고 아직 다투는 중」**이다 — 자력 가능·매직 미점등·소멸 아님.
 * 각 시험은 재려는 조합만 덮어쓴다.
 */
function race(over: Partial<TeamRace> = {}): TeamRace {
  return {
    teamCode: "t",
    remaining: 37,
    h2hLeft: new Map([["g", 8]]),
    selfPossible: true,
    magic: null,
    eliminated: false,
    ...over,
  };
}

function nowFixture(over: Partial<TeamNow> = {}): TeamNow {
  return {
    race: race(),
    next: {
      date: "2026-08-18", opponentCode: "c", opponentName: "広島",
      home: true, venue: "甲子園", startTime: "18:00",
    },
    probable: { mine: "村上", theirs: "大瀬良" },
    ...over,
  };
}

/**
 * 이 팀의 연속 기록 한 건.
 *
 * ⚠**`teamCode` 는 `data()` 의 팀("t")과 맞춘다** — 「이 팀 것만 싣는다」를 재는 시험의 기준이다.
 */
function streakFixture(over: Partial<HomeStreak> = {}): HomeStreak {
  return {
    playerId: "SK1", name: "続巻タイガー", teamCode: "t", shortName: "阪神", color: colorOf("t"),
    kind: "hitting", games: 7, lastGameDate: "2026-08-15",
    ...over,
  };
}

/** 이 팀의 기록 근접 한 건. `teamCode` 는 위와 같은 이유로 "t" 다 */
function milestoneFixture(over: Partial<HomeMilestone> = {}): HomeMilestone {
  return {
    playerId: "MK1", name: "積み上げタイガー", teamCode: "t", shortName: "阪神", color: colorOf("t"),
    label: "通算安打", count: 1990, next: 2000, toNext: 10, thisSeason: 45,
    ...over,
  };
}

function data(over: Partial<TeamPageData> = {}): TeamPageData {
  return {
    season: 2026,
    teamCode: "t",
    name: "阪神タイガース",
    shortName: "阪神",
    color: colorOf("t"),
    leagueName: "セントラル・リーグ",
    calendar: {
      teamCode: "t",
      shortName: "阪神",
      color: colorOf("t"),
      today: "2026-08-17",
      upcoming: 1,
      upcomingAsOf: "2026-08-17",
      seasonOver: false,
      months: [
        {
          key: "2026-08",
          year: 2026,
          month: 8,
          // 2026-08-01 은 토요일(요일 계산은 순수 함수로 낸다)
          firstWeekday: 6,
          days: 31,
          byDay: new Map([
            [16, [{
              date: "2026-08-16", slug: "2026-0816-t-g-15", opponent: "巨人", opponentCode: "g",
              home: true, result: "win" as const, runsFor: 5, runsAgainst: 2,
              startTime: null, venue: "", upcoming: false,
            }]],
            [18, [{
              date: "2026-08-18", slug: null, opponent: "DeNA", opponentCode: "db",
              home: false, result: null, runsFor: null, runsAgainst: null,
              startTime: "17:45", venue: "横浜", upcoming: true,
            }]],
          ]),
        },
      ],
    },
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
        woba: { value: 0.381, denominator: 420 },
        wrcPlus: { value: 142.3, denominator: 420 },
        wraa: { value: 24.6, denominator: 420 },
        src: { value: 11.2, denominator: 420 },
        qualified: true,
      },
      {
        playerId: "B2", name: "控え", games: 12, pa: 20, ab: 18, h: 4, hr: 0, rbi: 1, sb: 0,
        avg: { value: 4 / 18, denominator: 18 },
        obp: { value: 0.25, denominator: 20 },
        slg: { value: 0.28, denominator: 18 },
        ops: { value: 0.53, denominator: 20 },
        woba: { value: 0.241, denominator: 20 },
        wrcPlus: { value: 41.0, denominator: 20 },
        wraa: { value: -2.4, denominator: 20 },
        // ⚠**타석 로그가 없으면 SRC 는 없다**(M11) — 0 이 아니다.
        // 이 행이 있어야 「없는 값을 0으로 그리지 않는가」를 잴 수 있다
        src: { value: null, denominator: 0 },
        qualified: false,
      },
    ],
    pitchers: [
      {
        playerId: "P1", name: "村上", role: "starter", games: 20, outs: 400,
        w: 12, l: 4, sv: 0, hld: 0, so: 140,
        era: { value: 2.1, denominator: 400 },
        whip: { value: 1.02, denominator: 400 },
        fip: { value: 2.65, denominator: 400 },
        k9: { value: 9.45, denominator: 400 },
        bb9: { value: 2.11, denominator: 400 },
        srp: { value: 18.4, denominator: 520 },
        qs: 14,
        pitches: 2010,
        pitchesPerOut: { value: 2010 / 400, denominator: 400 },
        qualified: true,
      },
      {
        // ⚠**투구수를 못 읽은 투수.** 0 으로 메우면 「球数/アウト 0.00」이 되어
        // 효율이 리그 최고로 보인다 — 없는 값은 없는 채로 그려야 한다(M11)
        playerId: "P2", name: "無記録", role: "reliever", games: 8, outs: 24,
        w: 0, l: 1, sv: 2, hld: 3, so: 9,
        era: { value: 3.75, denominator: 24 },
        whip: { value: 1.25, denominator: 24 },
        fip: { value: 3.9, denominator: 24 },
        k9: { value: 10.13, denominator: 24 },
        bb9: { value: 3.38, denominator: 24 },
        srp: { value: null, denominator: 0 },
        qs: 0,
        pitches: null,
        pitchesPerOut: { value: null, denominator: 24 },
        qualified: false,
      },
    ],
    batQualifier: "規定打席 338（チーム109試合 × 3.1、小数切り上げ）",
    pitQualifier: "先発は規定投球回 109回（NPB公式）、救援はその3分の1 36.3回（当サイトの基準でNPBのものではありません）",
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
    now: nowFixture(),
    // ⚠**기본은 빈 배열이다.** 값이 필요한 시험은 `streakFixture`·`milestoneFixture`로 채운다
    streaks: [],
    milestones: [],
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

/** 그 선수의 이름이 든 `<tr ...>` 여는 태그. **행 전체가 아니라 태그만** 본다 */
function rowTagOf(out: string, name: string): string {
  const at = out.indexOf(`>${name}</a>`);
  assert.notEqual(at, -1, `${name} 가 목록에 없다`);
  const from = out.lastIndexOf("<tr", at);
  assert.notEqual(from, -1, `${name} 의 행을 못 찾았다`);
  return out.slice(from, out.indexOf(">", from) + 1);
}

test("규정에 닿지 않은 선수도 목록에 남고, 시각적 무게만 뺀다(M11)", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(out.includes("控え"), "규정 미달 선수가 목록에서 빠졌다");
  // ⚠**행 태그 안에서 찾는다.** 예전에는 `<tr class="thin">` 를 통째로 맞췄는데,
  // 정렬용 속성이 붙으면서 그 모양이 아니게 됐다. 재려는 것은 **그 행이 옅은가**이지
  // 「tr 태그에 속성이 class 하나뿐인가」가 아니다(2026-08-17)
  assert.match(rowTagOf(out, "控え"), /class="thin"/);
  assert.ok(!/class="thin"/.test(rowTagOf(out, "佐藤")), "규정에 닿은 선수까지 옅어졌다");
});

/**
 * ⚠**옅게 그리는 근거와 좁히기의 근거가 같아야 한다.** 옅음은 `class="thin"`,
 * 좁히기는 `data-qualified` 를 보는데, 둘이 갈리면 「옅은데 規定到達のみ에 남는」
 * 행이 생긴다 — 화면이 자기 자신과 모순된다.
 */
test("⚠옅게 그리는 근거와 「規定到達のみ」의 근거가 같다", () => {
  const out = renderTeamPage(data(), context());
  for (const name of ["佐藤", "控え", "村上", "無記録"]) {
    const tag = rowTagOf(out, name);
    const thin = /class="thin"/.test(tag);
    const q = /data-qualified="1"/.test(tag);
    assert.equal(thin, !q, `${name}: 옅음(${thin})과 규정도달(${q})이 어긋난다`);
  }
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

/**
 * ⚠**세로로 너무 길었다**(2026-08-17 유저 지적). 한 줄로 이어진 6구획 중
 * 打者·投手 표가 76행을 먹어, 팀 성적을 보러 온 사람이 그걸 다 지나야 直近の試合에 닿았다.
 *
 * ⚠**탭 줄은 늘 네 개다.** 구단·시즌에 따라 탭이 생겼다 없어지면 같은 자리를 눌러도
 * 다른 것이 열린다. 그래서 「기록이 없으면 탭도 없앤다」로 고치지 마라 —
 * 없는 것은 **탭 안에서 말한다**(아래 시험).
 */
test("⚠구단 페이지는 다섯 탭으로 갈린다 — 한 화면에 76행을 쌓지 않는다", () => {
  const out = renderTeamPage(data(), context());
  const tabs = [...out.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
  // ⚠**日程 이 2026-08-17 에 추가됐다**(유저 요청: 구단별 일정 캘린더).
  //   탭 수는 구단·시즌과 무관하게 늘 같아야 한다 — 있다 없다 하면 손이 기억한 자리가 깨진다
  assert.deepEqual(tabs, ["成績", "日程", "打者", "投手", "対戦"], "탭 구성이 달라졌다");
  // 처음 열리는 것은 하나뿐이다 — 두 개가 열려 있으면 나눈 뜻이 없다.
  // ⚠**이 탭줄(`team`)만 센다.** 안쪽에 基本/セイバー 패널이 또 있어서, 전부 세면
  // 「어느 층이 열렸는가」가 뭉개진다(2026-08-17)
  const open = out.match(/data-panelgroup="team" data-panelkey="[a-z]+" role="tabpanel"(?![^>]*hidden)/g) ?? [];
  assert.equal(open.length, 1, "펼쳐진 패널이 하나가 아니다");
  // 무거운 두 표는 각각 다른 패널에 들어가 있다
  const panelOf = (id: string): number => {
    const at = out.indexOf(`id="b-${id}"`);
    assert.notEqual(at, -1, `${id} 구획이 없다`);
    return out.lastIndexOf('role="tabpanel"', at);
  };
  assert.notEqual(panelOf("teambat"), panelOf("teampit"), "打者와 投手가 같은 패널에 있다");
  assert.notEqual(panelOf("teamsum"), panelOf("teambat"), "チーム成績이 打者표와 같은 패널에 있다");
  // 直近の試合은 選手 표 뒤가 아니라 成績 쪽으로 옮겼다
  assert.equal(panelOf("teamgames"), panelOf("teamsum"), "直近の試合이 成績 탭에 없다");
});

/**
 * ⚠**탭이 있는데 안이 비면 고장으로 읽힌다.** 예전에는 対戦 구획을 통째로 빼면 그만이었지만,
 * 탭으로 나눈 뒤에는 **누를 자리는 남고 안만 빈다.** 그래서 말로 채운다(M12).
 */
test("⚠対戦이 비어도 탭은 남고, 비었다고 화면이 말한다(M12)", () => {
  const out = renderTeamPage(data({ vs: [] }), context());
  assert.match(out, /role="tab"[^>]*>対戦</, "기록이 없다고 탭까지 사라졌다");
  // ⚠**요소로 잰다.** `includes("対戦成績がありません")` 로 쟀더니 **소스 주석의 같은 글자**에
  // 걸려 뮤턴트를 놓쳤다(2026-08-17). 화면에 보이는 것은 마크업이지 주석이 아니다
  assert.match(out, /<p class="empty">対戦成績がありません。<\/p>/, "눌러도 아무 말이 없다");
});

/**
 * ⚠**「보기 힘들고 난잡하다」**(2026-08-17 유저 지적)의 실체는 배치가 아니라 **없는 CSS**였다.
 * 10개 항목을 `<dl class="row">` 로 감쌌는데 `.row` 규칙이 **한 줄도 없어서**,
 * `dl{display:grid;grid-template-columns:auto 1fr}` 이 그대로 걸려
 * 10개 묶음이 좁은 칸·넓은 칸에 번갈아 떨어졌다.
 * → 이미 있는 `columns()` 로 바꾼다. **뜻이 같은 것끼리 한 단**에 모은다.
 */
test("⚠チーム成績은 뜻이 같은 것끼리 단으로 묶는다 — 규칙 없는 class 에 기대지 않는다", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(!out.includes('class="row"'), "CSS 규칙이 없는 class 로 되돌아갔다");
  const sum = out.slice(out.indexOf('id="b-teamsum"'), out.indexOf("</section>", out.indexOf('id="b-teamsum"')));
  assert.equal((sum.match(/<dl>/g) ?? []).length, 4, "단이 네 개가 아니다");
  // 得点·失点·得失点差는 한 단 안에 함께 있다 — 흩어지면 비교가 안 된다
  const cols = sum.split("<dl>").slice(1);
  const runs = cols.find((c) => c.includes("得点"));
  assert.ok(runs !== undefined && runs.includes("失点") && runs.includes("得失点差"), "득점 계열이 흩어졌다");
  // 단으로 옮기면서 분모를 흘리지 않았다(M2) — 58-46-1 이므로 승률의 분모는 104(105 아님)
  assert.match(sum, /勝率<\/dt><dd>[.\d]+<span class="den">104試合<\/span>/, "승률에 분모가 없다");
});

/**
 * ⚠**머리 수와 칸 수가 어긋나면 값이 아니라 「머리」가 거짓말을 한다.**
 *
 * 실제로 났다(2026-08-17): 세이버 타자 표에 `打席` 머리는 있는데 칸이 없어서
 * **모든 값이 한 칸씩 왼쪽으로 밀렸다** — wOBA 자리에 wRAA 가, SRC 자리에 OPS 가 그려졌다.
 * 값 자체는 전부 맞으므로 화면을 봐도 이상하지 않고, 순위 화면과 **표시값을 대조**해서야 나왔다.
 * 눈으로 잡히지 않는 종류라 시험이 없으면 다시 난다.
 */
test("⚠모든 표에서 머리 수와 칸 수가 같다 — 어긋나면 머리가 거짓말을 한다", () => {
  const out = renderTeamPage(data(), context());
  const tables = [...out.matchAll(/<table id="([^"]+)">([\s\S]*?)<\/table>/g)];
  assert.ok(tables.length >= 4, `표가 ${tables.length}개뿐이다 — 이 시험이 아무것도 안 재고 있다`);
  for (const t of tables) {
    const id = t[1] ?? "";
    const inner = t[2] ?? "";
    const heads = (inner.match(/<th\b/g) ?? []).length;
    const rows = [...inner.matchAll(/<tr [^>]*>([\s\S]*?)<\/tr>/g)];
    assert.ok(rows.length > 0, `${id}: 본문 행이 없다`);
    for (const r of rows) {
      const tds = ((r[1] ?? "").match(/<td\b/g) ?? []).length;
      assert.equal(tds, heads, `${id}: 머리 ${heads}개인데 칸이 ${tds}개다`);
    }
  }
});

/**
 * ⚠**같은 지표를 화면마다 다른 자릿수로 내지 않는다.** 같은 SRP 가 순위에서 5.83,
 * 구단에서 5.8 로 보이면 어느 쪽이 맞는지 묻게 된다 — 값은 같은데 신뢰가 깎인다.
 * 여기서는 **구단 세이버 표의 자릿수가 순위 화면의 규칙과 같은가**를 고정한다.
 */
test("⚠세이버 지표의 자릿수가 순위 화면과 같다", () => {
  const out = renderTeamPage(data(), context());
  // wRC+ 1자리 · wOBA 3자리 · wRAA 1자리 · SRC 1자리
  assert.match(out, />142\.3<span class="den">420打席</, "wRC+ 가 1자리가 아니다");
  assert.match(out, />\.381<span class="den">420打席</, "wOBA 가 3자리가 아니다");
  assert.match(out, />24\.6<span class="den">420打席</, "wRAA 가 1자리가 아니다");
  assert.match(out, />11\.2<span class="den">420打席</, "SRC 가 1자리가 아니다");
  // 투수 비율은 전부 2자리
  // ⚠분모는 **아웃을 이닝으로 옮긴 값**이라 여기서 자릿수를 단정하지 않는다 — 재는 것은 값 쪽이다
  assert.match(out, />2\.65<span class="den">\d/, "FIP 가 2자리가 아니다");
  assert.match(out, />18\.40<span class="den">520打者</, "SRP 가 2자리가 아니다");
});

/**
 * ⚠**없는 값을 0으로 그리지 않는다**(M11). 「球数/アウト 0.00」은
 * 효율이 리그 최고라는 뜻이 되고, 「SRC 0」은 기여가 없었다는 뜻이 된다 —
 * 둘 다 「모른다」와 전혀 다른 말이다.
 */
test("⚠기록이 없는 값은 —로 그리고, 정렬 속성 자체를 만들지 않는다(M11)", () => {
  const out = renderTeamPage(data(), context());
  // SRC 가 없는 타자와 投球数가 없는 투수
  const bench = rowTagOf(out, "控え");
  assert.ok(!/ data-src=/.test(bench), "없는 SRC 에 정렬 속성이 붙었다 — 오름차순에서 1위가 된다");
  const noRec = rowTagOf(out, "無記録");
  assert.ok(!/ data-ppo=/.test(noRec), "없는 球数/アウト 에 정렬 속성이 붙었다");
  assert.ok(!/ data-srp=/.test(noRec), "없는 SRP 에 정렬 속성이 붙었다");
  // 화면에는 값이 아니라 「없음」이 나온다
  assert.match(out, new RegExp(`${NO_VALUE}`), "없음 표시가 화면에 없다");
});

/**
 * ⚠**가리키는 id 가 실재해야 한다.**
 *
 * `aria-controls`/`aria-labelledby` 를 붙이면서 **패널 8개 중 4개가 없는 탭을 가리켰다**
 * (2026-08-17 실측). `tablist()` 는 id 를 내는데 `buttonGroup()` 은 안 냈기 때문이다.
 * **깨진 ARIA 참조는 없는 것보다 나쁘다** — 접근성 트리에 거짓이 들어가고,
 * 화면에는 아무 표시도 나지 않아 눈으로는 영영 못 잡는다.
 *
 * ⚠**반대 방향도 잰다** — 패널이 없는 버튼줄에 `aria-controls` 를 붙이면 허공을 가리킨다.
 */
test("⚠ARIA 참조가 실재하는 id 를 가리킨다 — 깨진 참조는 화면에 안 보인다", () => {
  const out = renderTeamPage(data(), context());
  const ids = new Set([...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ""));
  const refs = [...out.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)];
  assert.ok(refs.length >= 8, `ARIA 참조가 ${refs.length}개뿐이다 — 이 시험이 공회전한다`);
  for (const m of refs) {
    assert.ok(ids.has(m[1] ?? ""), `${m[0]} 가 가리키는 id 가 없다`);
  }
});

/**
 * ⚠**탭과 패널이 서로를 가리킨다.** 한쪽만 있으면 반쪽짜리다 —
 * 낭독기가 「이 패널은 어느 탭의 것인가」에 답할 수 없다.
 */
test("⚠탭↔패널이 양방향으로 이어져 있다", () => {
  const out = renderTeamPage(data(), context());
  for (const m of out.matchAll(/<button[^>]*id="([^"]+)"[^>]*aria-controls="([^"]+)"/g)) {
    const panel = new RegExp(`id="${m[2]}"[^>]*aria-labelledby="([^"]+)"`).exec(out)
      ?? new RegExp(`aria-labelledby="([^"]+)"[^>]*id="${m[2]}"`).exec(out);
    assert.notEqual(panel, null, `${m[2]} 패널이 자기 탭을 가리키지 않는다`);
    assert.equal(panel?.[1], m[1], `${m[2]} 가 다른 탭을 가리킨다`);
  }
});

/**
 * ⚠**개수가 같아도 라벨이 거짓말을 할 수 있다**(2026-08-18 감사 P0 · 내가 만든 결함).
 *
 * 위의 「머리 수 = 칸 수」 시험은 **이 결함을 통과시켰다.** 순서를 `metric-order.ts` 로 옮기면서
 * `orderCols` 가 머리만 재정렬했고 `<td>` 는 옛 순서 그대로였다 — 개수는 그대로니까.
 * 실물 `dist/teams/g.html` 에서 「打率 104」·「打席 0」이 그려지고 있었다.
 * 4개 표 전부, 모든 구단·모든 시즌에서.
 *
 * → **위치별 항등성**을 본다. 지표마다 다른 표식값을 주고,
 *   `data-sortkey` 머리 i 번째 아래의 칸이 그 지표의 값을 담고 있는지 대조한다.
 * ⚠**분모도 칸에 들어간다**(M2). 그래서 「담고 있는가」로 본다 — 「같은가」로 보면 분모 때문에 늘 실패한다.
 *   표식값을 전부 다르게 잡았으므로 두 열이 뒤바뀌면 **적어도 한쪽이 반드시 걸린다.**
 */
const MARK_BAT: Record<string, string> = {
  games: "811", pa: "822", h: "844", hr: "855", rbi: "866", sb: "877",
  avg: ".401", obp: ".402", slg: ".403", ops: ".404",
  woba: ".405", wrcplus: "91.1", wraa: "92.2", src: "93.3",
  name: "識別",
};
const MARK_PIT: Record<string, string> = {
  games: "711", outs: "241", w: "733", l: "744", sv: "755", hld: "766", so: "777", qs: "788",
  era: "5.11", whip: "5.22", fip: "5.33", k9: "5.44", bb9: "5.55", srp: "5.66", ppo: "5.77",
  name: "識別", role: "先発",
};

function marked(): TeamPageData {
  return data({
    batters: [{
      playerId: "U1", name: "識別", games: 811, pa: 822, ab: 833, h: 844, hr: 855, rbi: 866, sb: 877,
      avg: { value: 0.401, denominator: 833 },
      obp: { value: 0.402, denominator: 822 },
      slg: { value: 0.403, denominator: 833 },
      ops: { value: 0.404, denominator: 822 },
      woba: { value: 0.405, denominator: 822 },
      wrcPlus: { value: 91.1, denominator: 822 },
      wraa: { value: 92.2, denominator: 822 },
      src: { value: 93.3, denominator: 822 },
      qualified: true,
    }],
    pitchers: [{
      playerId: "U2", name: "識別", role: "starter", games: 711, outs: 723,
      w: 733, l: 744, sv: 755, hld: 766, so: 777, qs: 788, pitches: 799,
      era: { value: 5.11, denominator: 723 },
      whip: { value: 5.22, denominator: 723 },
      fip: { value: 5.33, denominator: 723 },
      k9: { value: 5.44, denominator: 723 },
      bb9: { value: 5.55, denominator: 723 },
      srp: { value: 5.66, denominator: 799 },
      pitchesPerOut: { value: 5.77, denominator: 723 },
      qualified: true,
    }],
  });
}

test("⚠머리 i번째 아래에 그 지표의 값이 있다 — 개수만 세면 라벨이 거짓말을 한다", () => {
  const out = renderTeamPage(marked(), context());
  const tables = [...out.matchAll(/<table id="(team[^"]*)">([\s\S]*?)<\/table>/g)];
  const seen = new Set(tables.map((t) => t[1] ?? ""));
  for (const want of ["teambatTable", "teambatsaberTable", "teampitTable", "teampitsaberTable"]) {
    assert.ok(seen.has(want), `${want} 를 못 찾았다 — 이 시험이 아무것도 안 재고 있다`);
  }
  let checked = 0;
  for (const t of tables) {
    const id = t[1] ?? "";
    const inner = t[2] ?? "";
    const keys = [...inner.matchAll(/data-sortkey="([^"]+)"/g)].map((m) => m[1] ?? "");
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(inner)?.[1] ?? "";
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]*>/g, ""),
    );
    assert.equal(cells.length, keys.length, `${id}: 머리 ${keys.length} · 칸 ${cells.length}`);
    const marks = id.startsWith("teambat") ? MARK_BAT : MARK_PIT;
    keys.forEach((k, i) => {
      const mark = marks[k];
      assert.notEqual(mark, undefined, `${id}: 「${k}」의 표식값을 이 시험이 안 갖고 있다`);
      assert.ok(
        (cells[i] ?? "").includes(mark ?? ""),
        `${id}: 머리 ${i}번째가 「${k}」인데 그 칸은 「${cells[i]}」다 — ${mark} 가 없다`,
      );
      checked += 1;
    });
  }
  assert.ok(checked >= 34, `${checked}칸밖에 안 쟀다 — 4개 표가 다 안 걸렸다`);
});

// ── 「いまの状況」 요약 띠 ──────────────────────────────────────────────────
//
// ⚠**이 구획이 우승 경쟁 판정(자력·소멸·매직)을 화면에 내는 첫 자리다.**
// `packages/aggregate/src/race.ts` 가 그 값들의 뜻을 **증명해서** 정했다 —
// 화면이 뜻을 틀리게 옮기면 그 증명이 통째로 무의미해진다.

/**
 * **그 구획만** 잘라 낸다.
 *
 * ⚠**페이지 전체에서 찾으면 시험이 헐거워진다.** 「勝率」은 チーム成績 구획에도 있어서
 * `out` 을 통째로 보면 요약 띠가 비어 있어도 통과한다.
 */
function nowBlockOf(out: string): string {
  const from = out.indexOf('id="b-tnow"');
  assert.notEqual(from, -1, "「いまの状況」 구획이 없다");
  const to = out.indexOf("</section>", from);
  assert.notEqual(to, -1, "「いまの状況」 구획이 닫히지 않았다");
  return out.slice(from, to);
}

/**
 * **우승 경쟁 판정 한 줄만** 잘라 낸다.
 *
 * ⚠**각주와 부딪힌다.** 각주는 「優勝が決まりました」·「自力優勝」이 **무슨 뜻인지**를
 * 설명하느라 그 문구를 인용한다 — 구획 전체에서 찾으면 판정이 무엇이든 통과한다.
 * 실제로 그렇게 썼다가 이 시험 하나가 **어떤 코드에서도 떨어지는** 상태가 됐다(2026-08-19 실측).
 */
function raceLineOf(out: string): string {
  const m = /<p class="tnow race">([^<]*)<\/p>/.exec(nowBlockOf(out));
  assert.notEqual(m, null, "우승 경쟁 판정 줄이 없다");
  return m![1]!;
}

/**
 * **각주만** 잘라 낸다.
 *
 * ⚠**구획 전체에서 「勝率」을 찾으면 그 단언은 항상 참이다**(2026-08-19 검토 m1).
 * 요약 띠의 머리줄이 언제나 `<span>勝率 …</span>` 를 내기 때문에, **각주에서 「勝率」을
 * 통째로 지워도 통과**했다 — M3(판정 기준을 화면에 적는다)를 실제로 재던 것은 옆의 `/勝数/`
 * 하나뿐이었다. 기준을 말하는 자리는 각주이므로 각주만 본다.
 */
function noteOf(out: string): string {
  const m = /<p class="note">([\s\S]*?)<\/p>/.exec(nowBlockOf(out));
  assert.notEqual(m, null, "「いまの状況」에 각주가 없다");
  return m![1]!;
}

/**
 * ⚠**팬이 가장 먼저 보는 줄이다.** 순위·승률·잔여·다음 경기가 한 자리에 있어야
 * 「지금 우리 팀이 어떤가」에 답한다.
 * ⚠**모든 비율에 분모를 붙인다**(M2) — 승률에는 `(勝+敗)`.
 */
test("⚠구단 페이지 맨 위에 「지금 이 팀」이 온다 — 분모를 달고", () => {
  const out = renderTeamPage(data(), context());
  const now = out.indexOf('id="b-tnow"');
  // ⚠**실재하는 구획과 대본다.** 브리프는 `b-tstat` 와 비교했는데 그런 id 는 이 화면에 없어
  // 그 단언은 무엇을 넣어도 참이었다(항상 참인 단언 금지 — 작업규칙 9)
  const stat = out.indexOf('id="b-teamsum"');
  assert.ok(now >= 0, "「지금 이 팀」 구획이 없다");
  assert.notEqual(stat, -1, "チーム成績 구획을 못 찾았다 — 이 시험이 순서를 안 재고 있다");
  assert.ok(now < stat, "「지금 이 팀」이 チーム成績보다 뒤에 있다");

  const b = nowBlockOf(out);
  assert.match(b, /<span class="den">104試合<\/span>/, "승률에 분모(勝+敗)가 없다");
  assert.match(b, /残り\s*37試合/, "잔여 경기가 안 나온다");
  assert.match(b, /5-5-0/, "直近10 이 안 나온다");
});

/**
 * ⚠**판정 불가를 숨기지 않는다**(M11·M12).
 * ⚠**그런데 이유를 단정하지도 않는다.** `basis: "unknown"` 은 ⒜교류전 미완(정상)과
 * ⒝입력이 어긋남(버그) **둘 다**라서, 「今季の対戦数が確定していません」이라고 쓰면
 * ⒝일 때 **틀린 이유를 말하는 것**이 된다(브리프의 문구가 그랬다).
 * 운영자가 알아야 할 것은 화면이 아니라 빌드 로그로 간다(`query.ts` 의 `disagreed` 경고).
 */
test("⚠우승 경쟁을 판정할 수 없으면 그렇게 말한다 — 이유는 단정하지 않는다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ selfPossible: null, magic: null, eliminated: null }) }) }),
    context(),
  );
  assert.match(raceLineOf(out), /まだ判定できません/);
  assert.ok(!nowBlockOf(out).includes("対戦数が確定"), "판정 불가의 이유를 화면이 단정했다");
});

/**
 * ⚠**`magic === 0` 은 「매직 0」이 아니라 「우승 확정」이다.**
 * `race.ts` 가 증명해서 정한 값이다(타팀 전원 소멸 ⇒ 내 최악 > 전원의 최선).
 * 그대로 숫자로 흘리면 **이미 우승한 팀 옆에 「マジック 0」**이 붙는다.
 */
test("⚠매직 0 은 「マジック 0」이 아니라 우승 확정이다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ magic: 0, selfPossible: true, eliminated: false }) }) }),
    context(),
  );
  // ⚠**판정 줄만 본다.** 각주가 「優勝が決まりました」의 뜻을 설명하느라 그 문구를 인용하므로,
  //   구획 전체에서 찾으면 판정이 무엇이든 통과한다(실제로 그 상태를 만들었다가 실측으로 잡았다)
  assert.equal(raceLineOf(out), "優勝が決まりました");
  assert.ok(!/マジック\s*0/.test(nowBlockOf(out)), "「マジック 0」이 그대로 나왔다");
});

/** 매직이 양수면 그 값을 낸다 — 「승수식」이라는 것을 각주가 말한다(M3) */
test("⚠매직이 양수면 값을 내고, 승수식임을 화면이 말한다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ magic: 12, selfPossible: true, eliminated: false }) }) }),
    context(),
  );
  assert.match(raceLineOf(out), /マジック\s*12/);
  // M3 — 순위는 승률, 매직은 승수. 규칙이 코드에만 있으면 아무도 검증할 수 없다
  // ⚠**각주만 본다.** 구획 전체를 보면 머리줄의 「勝率 …」이 늘 걸려 단언이 항상 참이 된다
  const n = noteOf(out);
  assert.match(n, /勝率/, "순위가 승률로 정해진다는 것을 각주가 안 쓴다");
  assert.match(n, /勝数/, "매직이 승수식이라는 것을 각주가 안 쓴다");
});

/**
 * ⚠**`eliminated === false` 는 「가능성 있음」이 아니다.**
 * 판정이 **쌍별(pairwise)**이라 「쌍별로는 소멸이 증명되지 않았다」는 뜻이다
 * (정확한 판정에는 최대유량이 필요하다 — `race.ts` 의 JSDoc).
 * → 「消滅」쪽만 단정하고 반대편은 단정하지 않는다.
 */
test("⚠자력 소멸은 단정하되 「まだ可能性がある」는 단정하지 않는다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ selfPossible: false, magic: null, eliminated: false }) }) }),
    context(),
  );
  const line = raceLineOf(out);
  assert.match(line, /自力優勝(が|は)?消滅/, "자력 소멸을 말하지 않는다");
  assert.ok(!line.includes("可能性があります"), "쌍별 판정으로 증명되지 않은 것을 단정했다");
});

/** 잔여가 남은 동안에는 자력 가능을 단정한다 — 그건 증명되기 때문이다 */
test("⚠자력 가능은 단정한다", () => {
  assert.equal(raceLineOf(renderTeamPage(data(), context())), "自力優勝の可能性があります");
});

/**
 * ⚠**끝난 레이스에 「가능성」이라고 쓰지 않는다.**
 * 실측(2026-08-19 전 시즌 빌드): **2022 퍼시픽의 `h`·`b` 가 76-65-2 로 완전히 같아**
 * 둘 다 `selfPossible true · magic null · eliminated false` 로 끝났고, 화면이
 * 「シーズンの結果」라는 제목 아래 **현재형으로** 「自力優勝の可能性があります」라고 말했다.
 * 잔여 0 에서 그 상태가 뜻하는 것은 **「어떤 팀도 승률로 나를 넘을 수 없다」**이고,
 * 우승이라고는 못 한다(동률이 남아 있고 그건 당사자 간 대전 성적으로 가른다).
 */
test("⚠잔여 0 의 동률을 현재형으로 말하지 않는다", () => {
  const out = renderTeamPage(
    data({
      now: nowFixture({
        next: null,
        probable: null,
        race: race({ remaining: 0, selfPossible: true, magic: null, eliminated: false }),
      }),
    }),
    context(),
  );
  const line = raceLineOf(out);
  assert.ok(!line.includes("可能性があります"), "끝난 레이스를 현재형으로 말했다");
  // ⚠**완전 일치로 「リーグに」를 고정한다**(2026-08-19 재검토 — 22d2470 이 놓쳤고 1차 검토도
  //   놓쳤다). `race.ts` 의 비교는 리그 내부에서만 이뤄지는데(`leagueOf(other) !== leagueOf(me)`
  //   는 스킵) 문장이 「球団」을 리그 한정 없이 쓰면 실측으로 거짓이 된다 — 2022 `dist/teams/b.html`
  //   (오릭스 `.539`, 이 문장을 냄) ↔ 같은 저장소 `dist/2022/index.html`(**ヤクルト `.576`**,
  //   다른 리그). 부분일치(`assert.match`)는 「リーグに」가 빠져도 통과해 이 결함을 못 잡았다.
  assert.equal(
    line,
    "リーグに勝率で上回る球団はありません — 同率のときは当該球団間の対戦成績で順位が決まります",
    "무엇이 증명됐는지, 어느 범위에서 증명됐는지 말하지 않는다",
  );
  assert.ok(!line.includes("優勝が決まりました"), "동률인데 우승을 단정했다");
});

/**
 * ⚠**잔여 0 의 「勝率で上回る球団はありません」는 `selfPossible === true` 일 때만 참이다.**
 *
 * 그 문장의 증명은 「내 잔여가 0 ⇒ 각 h2h 가 0 ⇒ `selfPossible` 판정에 쓰인 상대의 최선이
 * 곧 상대의 **진짜** 최선이고, 그게 내 승률을 넘은 적이 없다」인데 —
 * **마지막 절이 곧 `selfPossible === true` 다.** `false` 는 정확히 그 반대,
 * 「어떤 상대의 최선이 내 승률을 넘는다」는 뜻이다.
 *
 * ⚠**이 조합은 NPB 시즌 최종주의 정상 상태다**(2026-08-19 검토자 프로브 재현 ·
 * 2026 · 12팀 6:6 · 교류전 3 완료 · `c2:c3` 만 22/25):
 * ```
 * c1 80-63-0 g=143 pct=.559 → rem 0 · self false · magic null · elim false
 * c2 79-61-0 g=140 pct=.564 → rem 3 · self true  · magic 2
 * ```
 * `c1` 은 내 143경기를 다 치렀는데 `c2` 가 우천 재편성으로 3경기를 남겼고 **이미 위에 있다.**
 * 그런데 화면은 「勝率で上回る球団はありません」이라고 썼다 — 같은 페이지 머리가 「2位」라고
 * 쓰는 그 자리에서. **자기 증명의 전제가 깨진 상태에서 그 결론을 출력한 것**이다.
 *
 * ⚠**이건 앞 라운드가 자기 결함(2022 퍼시픽 현재형 문구)을 고치면서 새로 만들었다**
 * — 작업규칙 10(자기 수정을 다시 읽는다)이 잡았어야 할 자리다.
 */
test("⚠잔여 0 이라도 자력이 없으면 「勝率で上回る球団はありません」라고 하지 않는다", () => {
  const out = renderTeamPage(
    data({
      now: nowFixture({
        next: null,
        probable: null,
        race: race({ remaining: 0, selfPossible: false, magic: null, eliminated: false }),
      }),
    }),
    context(),
  );
  const line = raceLineOf(out);
  assert.ok(
    !line.includes("勝率で上回る球団はありません"),
    "자력이 없는데 「나를 넘는 팀은 없다」고 단정했다 — 그 증명의 전제가 깨져 있다",
  );
  // ⚠**「自力優勝は消滅しました」로 떨어져도 사실이지만 뜻이 흐리다** — 잔여가 0 이면
  //   「자력으로 못 뒤집는다」가 아니라 **내가 할 수 있는 일이 남아 있지 않다**는 뜻이다
  assert.equal(line, "残り試合はありません — 他球団の結果次第です");
  // 소멸은 증명되지 않았으므로 단정하지 않는다(쌍별 판정 · race.ts)
  assert.ok(!line.includes("優勝の可能性がなくなりました"), "증명되지 않은 소멸을 단정했다");
});

test("⚠소멸이 증명되면 그것은 단정한다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ selfPossible: false, magic: null, eliminated: true }) }) }),
    context(),
  );
  assert.match(raceLineOf(out), /優勝の可能性が(なくなり|消滅し)ました/);
});

/**
 * ⚠**`remaining` 은 `number | null` 이다**(2026-08-19 재리뷰 Important A).
 * `null` 을 그대로 템플릿에 넣으면 `html` 이 빈 문자열로 렌더해 **「残り 試合」**이 나간다 —
 * 그건 「모른다」가 아니라 **아무 말도 안 한 것**이다(M11·M12).
 */
test("⚠잔여를 모르면 빈칸이 아니라 「모른다」를 낸다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ race: race({ remaining: null }) }) }),
    context(),
  );
  const b = nowBlockOf(out);
  assert.match(b, /残りの試合数はわかりません/, "잔여를 모른다고 말하지 않는다");
  assert.ok(!/残り\s*(試合|<)/.test(b), "잔여 자리가 빈칸으로 나갔다");
});

/** ⚠**予告先発이 없으면 「投手なし」가 아니라 「発表待ち」다**(M11) */
test("⚠予告先発이 아직 없으면 発表待ち라고 쓴다", () => {
  const out = renderTeamPage(data({ now: nowFixture({ probable: null }) }), context());
  const b = nowBlockOf(out);
  assert.match(b, /発表待ち/);
  assert.ok(!b.includes("投手なし"));
});

/** 한쪽만 발표되는 일이 있다 — 있는 쪽은 내고, 없는 쪽을 「없다」고 하지 않는다(M11) */
test("⚠予告先発이 한쪽만 나왔으면 그쪽만 낸다", () => {
  const out = renderTeamPage(
    data({ now: nowFixture({ probable: { mine: "村上", theirs: null } }) }),
    context(),
  );
  const b = nowBlockOf(out);
  assert.match(b, /村上/);
  assert.ok(!b.includes("投手なし"));
});

/** ⚠**다음 경기가 없어도 줄을 지우지 않는다**(M12) */
test("⚠다음 경기가 없으면 그렇다고 말한다 — 줄을 지우지 않는다", () => {
  const out = renderTeamPage(data({ now: nowFixture({ next: null, probable: null }) }), context());
  const b = nowBlockOf(out);
  assert.match(b, /次の試合/);
  assert.match(b, /予定はありません|シーズンは終了/);
});

/**
 * ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다.** 기다리는 것이 아니라 끝난 것이다 —
 * 이 리포가 予告先発·対戦 화면에서 이미 밟은 결함이다(2026-08-16 이중 검토 P2).
 */
test("⚠끝난 시즌에 「発表待ち」라고 쓰지 않는다", () => {
  const base = data();
  const out = renderTeamPage(
    data({
      calendar: { ...base.calendar, seasonOver: true, upcoming: 0 },
      now: nowFixture({ next: null, probable: null }),
    }),
    context(),
  );
  const b = nowBlockOf(out);
  assert.match(b, /シーズンは終了/);
  assert.ok(!b.includes("発表待ち"), "끝난 시즌에 현재형으로 말했다");
});

test("이동 버튼이 네 화면을 가리킨다", () => {
  const out = renderTeamPage(data(), context());
  const b = nowBlockOf(out);
  // ⚠**日程의 id 는 `b-teamcal` 이다.** 브리프는 `b-tcal` 이라고 썼는데 그런 구획은 없다 —
  // 그대로 두면 빌드의 링크 검사가 잡는다(같은 페이지 앵커도 대조한다)
  for (const href of ["starters.html", "ranking.html#stand-t", "players.html#hi-t", "#b-teamcal"]) {
    assert.ok(b.includes(href), `${href} 로 가는 길이 없다`);
  }
  assert.match(out, /id="b-teamcal"/, "日程 구획이 없다 — 앵커가 가리킬 곳이 없다");
});

// ── Task 6: 이 팀의 연속 기록 · 기록 근접 ─────────────────────────────────

/**
 * **그 구획만** 잘라 낸다. `nowBlockOf`와 같은 이유 — 페이지 전체에서 찾으면
 * 다른 구획(예: 対戦成績의 선수명)과 부딪혀 시험이 헐거워진다.
 */
function blockOf(out: string, id: string): string {
  const from = out.indexOf(`id="b-${id}"`);
  assert.notEqual(from, -1, `구획 b-${id} 가 없다`);
  const to = out.indexOf("</section>", from);
  assert.notEqual(to, -1, `구획 b-${id} 가 닫히지 않았다`);
  return out.slice(from, to);
}

/** ⚠**0건이어도 구획을 지우지 않는다**(M12) — 「없다」와 「고장」이 같은 화면이면 결함이다 */
test("⚠이 팀의 연속 기록이 0건이어도 구획이 남고 없다고 말한다", () => {
  const out = renderTeamPage(data({ streaks: [], milestones: [] }), context());
  assert.ok(out.includes('id="b-tstreak"'), "연속 기록 구획이 사라졌다");
  assert.ok(out.includes('id="b-tmile"'), "기록 근접 구획이 사라졌다");
  assert.match(blockOf(out, "tstreak"), /ありません/);
  assert.match(blockOf(out, "tmile"), /ありません/);
});

/**
 * ⚠**브리프의 원 시험은 아무것도 재지 않았다** — `"巨人の選手"`는 어떤 구현에서도
 * 출력에 나오지 않는 문자열이라 항상 통과했다. 실제로 다른 팀 선수를 픽스처에 넣고
 * **이 팀 선수는 나오는가·다른 팀 선수는 안 나오는가**를 둘 다 잰다.
 * ⚠**필터는 query.ts 쪽 책임이다**(M1) — `renderTeamPage`는 받은 것을 그대로 그린다.
 * 그래서 「render가 받은 것만 정직하게 그리는가」를 여기서, 「query.ts가 실제로 거르는가」는
 * `team-streaks-milestones.test.ts`(loadSite 경유 통합 시험)에서 잰다 — 둘이 합쳐야
 * `.filter(s => s.teamCode === code)`를 지우는 뮤테이션을 잡는다.
 */
test("이 팀의 연속 기록·기록 근접은 이 팀 선수가 나오고, 다른 팀 선수는 안 나온다", () => {
  const other: HomeStreak = streakFixture({
    playerId: "SK2", name: "隣球団の続巻", teamCode: "g", shortName: "巨人", color: colorOf("g"),
  });
  const otherMile: HomeMilestone = milestoneFixture({
    playerId: "MK2", name: "隣球団の積み上げ", teamCode: "g", shortName: "巨人", color: colorOf("g"),
  });
  const out = renderTeamPage(
    data({ streaks: [streakFixture()], milestones: [milestoneFixture()] }),
    context(),
  );
  assert.ok(blockOf(out, "tstreak").includes("続巻タイガー"), "이 팀 선수의 연속 기록이 안 보인다");
  assert.ok(blockOf(out, "tmile").includes("積み上げタイガー"), "이 팀 선수의 기록 근접이 안 보인다");

  // renderTeamPage는 받은 대로 그린다 — data()에 다른 팀 항목이 없으므로 안 나오는 것이 당연하다.
  // 실제 필터(query.ts)가 살아 있는지는 통합 시험이 잰다.
  assert.ok(!out.includes(other.name), "다른 팀 선수 이름이 픽스처에도 없는데 나왔다 — render가 다른 데를 그리고 있다");
  assert.ok(!out.includes(otherMile.name));
});

test("연속 기록 표에 경기 수와 마지막 출장일이 나온다", () => {
  const out = renderTeamPage(
    data({ streaks: [streakFixture({ games: 9, lastGameDate: "2026-08-15" })] }),
    context(),
  );
  const b = blockOf(out, "tstreak");
  assert.match(b, />9</, "연속 경기 수가 안 보인다");
  assert.match(b, /2026年8月15日/, "마지막 출장일이 안 보인다");
});

/**
 * ⚠**`lastGameDate` 는 「継続中」을 말해도 되는지 판단하는 근거다.** 화면은 그 판단을
 * 대신 내리지 않는다(홈 화면과 같은 규칙 · M1) — 날짜만 그대로 보여주고, 독자가
 * 최신 경기일과 비교해서 판단한다. ⚠**끊긴 기록에도 「継続中」이라는 말을 쓰지 않는다.**
 */
test("⚠연속 기록에 「継続中」이라는 말을 쓰지 않는다 — 마지막 출장일로만 말한다", () => {
  const out = renderTeamPage(
    // 최신 경기일(2026-08-15)보다 훨씬 이전에 끊긴 기록
    data({ streaks: [streakFixture({ lastGameDate: "2026-05-22" })] }),
    context(),
  );
  const b = blockOf(out, "tstreak");
  assert.ok(!b.includes("継続中"), "끝난 기록을 「継続中」이라고 썼다");
  assert.match(b, /2026年5月22日/, "마지막 출장일이 그대로 안 보인다");
});

/** ⚠**마지막 출장일을 모르면 빈칸이 아니라 「모른다」다**(M11) */
test("⚠연속 기록의 마지막 출장일을 모르면 빈칸이 아니라 NO_VALUE다", () => {
  const out = renderTeamPage(
    data({ streaks: [streakFixture({ lastGameDate: null })] }),
    context(),
  );
  assert.ok(blockOf(out, "tstreak").includes(NO_VALUE));
});

test("기록 근접 표에 통산·마디까지·今季가 나온다", () => {
  const out = renderTeamPage(
    data({ milestones: [milestoneFixture({ count: 1990, next: 2000, toNext: 10, thisSeason: 45 })] }),
    context(),
  );
  const b = blockOf(out, "tmile");
  assert.match(b, />1990</, "통산이 안 보인다");
  assert.match(b, />2000まであと<b>10<\/b>/, "마디까지 남은 수가 안 보인다");
  assert.match(b, />45</, "今季 수가 안 보인다");
});
