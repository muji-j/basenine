import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayByPlayParseError, parsePlayByPlay } from "../src/playbyplay.ts";

const link = (id: string, name: string) => `<a href="/bis/players/${id}.html">${name}</a>`;

function pa(outs: number, bases: string, batter: string, name: string, count: string, result: string): string {
  return `<table><tr>
    <td class="w1">${outs}アウト</td>
    <td class="w1">${bases === "" ? "&nbsp;" : bases}</td>
    <td class="w1">${link(batter, name)}</td>
    <td class="w1">${count}</td>
    <td class="w2">${result}</td>
  </tr></table>`;
}

/** 실제 마크업을 축약한 픽스처. 표 머리글·라인스코어까지 포함해 실전 조건을 맞춘다. */
const FIXTURE = `<html>
<table id="tablefix_ls"><tr><th>&nbsp;</th><th>1</th><td class="total-1">計</td></tr></table>
<table><thead><tr><th class="w1">アウト</th><th class="w1">塁上</th><th class="w1">打者</th><th class="w1">カウント</th><th class="w2 last">結果</th></tr></thead></table>
<h5 id="com1-1">1回表（楽天の攻撃）</h5>
<table><tr><td colspan="5" class="w2">（先発投手） ${link("7001", "宮城")}</td></tr>
<tr><td class="w1">0アウト</td><td class="w1">&nbsp;</td><td class="w1">${link("1001", "村林")}</td><td class="w1">0-1より</td><td class="w2">セカンドゴロ</td></tr></table>
${pa(1, "1塁", "1002", "辰己", "3-2より", "フォアボール")}
${pa(1, "1・2塁", "1003", "ボイト", "1-2より", "レフト線タイムリーツーベース（打点2）")}
<h5 id="com1-2">1回裏（オリックスの攻撃）</h5>
<table><tr><td colspan="5" class="w2">（先発投手） ${link("8001", "荘司")}</td></tr>
<tr><td class="w1">0アウト</td><td class="w1">&nbsp;</td><td class="w1">${link("2001", "中川")}</td><td class="w1">2-2より</td><td class="w2">空振り三振</td></tr></table>
<h5 id="com2-1">2回表（楽天の攻撃）</h5>
<table><tr><td colspan="5" class="w2">（投手交代） ${link("7001", "宮城")} → ${link("7002", "東松")}</td></tr>
<tr><td class="w1">2アウト</td><td class="w1">満塁</td><td class="w1">${link("1001", "村林")}</td><td class="w1">2-1より</td><td class="w2">（途中終了）</td></tr></table>
${pa(0, "2・3塁", "1002", "辰己", "1-0より", "センター前タイムリーヒット（打点2）")}
</html>`;

test("타석 이벤트를 순서대로 읽는다", () => {
  const r = parsePlayByPlay(FIXTURE);
  assert.equal(r.status, "played");
  if (r.status !== "played") return;
  assert.equal(r.events.length, 6);
  assert.deepEqual(
    r.events.map((e) => `${e.inning}${e.half === "top" ? "表" : "裏"}`),
    ["1表", "1表", "1表", "1裏", "2表", "2表"],
  );
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
});

test("아웃 카운트와 주자 상태를 정규형으로 읽는다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(
    r.events.map((e) => `${e.outsBefore}|${e.bases}`),
    ["0|", "1|1", "1|12", "0|", "2|123", "0|23"],
  );
});

test("⚠M10: 타자를 공식 ID로 식별한다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(r.events.map((e) => e.batterId), ["1001", "1002", "1003", "2001", "1001", "1002"]);
});

test("⚠투수는 하프별로 따로 추적한다 — 표에서는 홈, 리에서는 원정이 던진다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(r.events.map((e) => e.pitcherId), ["7001", "7001", "7001", "8001", "7002", "7002"]);
});

test("⚠투수 교대는 뒤 링크가 새 투수다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  // 2회 표는 宮城(7001) → 東松(7002) 교대 뒤이므로 7002여야 한다.
  assert.equal(r.events[4]?.pitcherId, "7002");
});

test("⚠도중 종료·도중 교대는 타석으로 성립하지 않는다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  const incomplete = r.events.filter((e) => !e.completed);
  assert.equal(incomplete.length, 1);
  assert.equal(incomplete[0]?.result, "（途中終了）");
  assert.equal(r.events.filter((e) => e.completed).length, 5);
});

test("도중 교대도 미완으로 센다", () => {
  const html = FIXTURE.replace("（途中終了）", "（途中交代）");
  const r = parsePlayByPlay(html);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.equal(r.events.filter((e) => !e.completed).length, 1);
});

test("⚠결과 문자열을 해석하지 않고 원문 그대로 보존한다", () => {
  // 결과 어휘는 566종이고 박스스코어(208종)와 같은 사실을 다른 말로 적은 것이다.
  // 해석을 두 벌 만들면 반드시 어긋난다(M1).
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.equal(r.events[2]?.result, "レフト線タイムリーツーベース（打点2）");
  assert.equal(r.events[3]?.result, "空振り三振");
});

test("표 머리글과 라인스코어는 타석으로 세지 않는다", () => {
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played여야 한다");
  assert.ok(r.events.every((e) => e.batterId !== ""));
  assert.equal(r.events.length, 6, "머리글 행이 섞이면 수가 늘어난다");
});

test("⚠중지 경기는 오류가 아니라 미성립이다", () => {
  const r = parsePlayByPlay('<html><div class="state">中止</div></html>');
  assert.equal(r.status, "notPlayed");
  if (r.status === "notPlayed") assert.equal(r.reason, "中止");
});

test("⚠이닝 표기도 중지 표기도 없으면 예외 — 구조 변경을 놓치지 않는다", () => {
  assert.throws(() => parsePlayByPlay("<html><div>新レイアウト</div></html>"), PlayByPlayParseError);
});

test("⚠모르는 주자 표기는 조용히 넘기지 않고 던진다", () => {
  const html = FIXTURE.replace("満塁", "謎の塁");
  assert.throws(() => parsePlayByPlay(html), /주자 표기/);
});

test("⚠타석을 하나도 못 찾으면 예외 — 빈 결과로 위장하지 않는다", () => {
  const html = "<html><h5>1回表（楽天の攻撃）</h5></html>";
  assert.throws(() => parsePlayByPlay(html), /타석을 하나도/);
});
