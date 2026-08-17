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
import { NO_VALUE } from "../src/format.ts";
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
test("⚠구단 페이지는 네 탭으로 갈린다 — 한 화면에 76행을 쌓지 않는다", () => {
  const out = renderTeamPage(data(), context());
  const tabs = [...out.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(tabs, ["成績", "打者", "投手", "対戦"], "탭 구성이 달라졌다");
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
