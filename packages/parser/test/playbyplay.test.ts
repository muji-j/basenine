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

/**
 * 주자 사건(도루·도루자·견제사).
 *
 * ⚠**주자 행도 칸이 5개다** — 타석 행과 모양이 같고 **이름 칸만 비어 있다.**
 * 그래서 「선수 링크가 없는 행」으로 걸러져 **통째로 버려지고 있었다**(2026-08-17 확인).
 * 도루자(盗塁刺)는 §2-2 카탈로그 항목인데 박스스코어가 주지 않아 여기가 유일한 출처다.
 *
 * 실측: 2024〜2026 playbyplay 2,484장 · 주자 행 3,623건 · 고유 표기 **12종**(3시즌 동일).
 * 경기별 도루 수가 박스의 `盗塁` 열과 **2,395경기 중 어긋남 0건**.
 */
const RUNNER_PBP = `
<h5>1回表</h5>
<table>
<tr><th>アウト</th><th>塁</th><th>打者</th><th>カウント</th><th>結果</th></tr>
<tr><td colspan="5">（先発投手） <a href="/bis/players/01005101.html">先発</a></td></tr>
<tr><td>0アウト</td><td>&nbsp;</td><td><a href="/bis/players/01005131.html">打者一</a></td><td>3-1より</td><td>フォアボール</td></tr>
<tr><td>0アウト</td><td>1塁</td><td>&nbsp;</td><td>&nbsp;</td><td>（走者・<a href="/bis/players/01005131.html">打者一</a>）二塁盗塁成功</td></tr>
<tr><td>0アウト</td><td>2塁</td><td>&nbsp;</td><td>&nbsp;</td><td>（走者・<a href="/bis/players/01005131.html">打者一</a>）三塁盗塁失敗</td></tr>
<tr><td>1アウト</td><td>&nbsp;</td><td><a href="/bis/players/01005132.html">打者二</a></td><td>0-2より</td><td>空振り三振</td></tr>
<tr><td>2アウト</td><td>1塁</td><td>&nbsp;</td><td>&nbsp;</td><td>（走者・<a href="/bis/players/01005133.html">打者三</a>）一塁牽制アウト</td></tr>
</table>`;

test("⚠주자 사건을 버리지 않는다 — 도루자는 여기가 유일한 출처다", () => {
  const r = parsePlayByPlay(RUNNER_PBP);
  assert.equal(r.status, "played");
  if (r.status !== "played") return;
  // 타석은 2건. ⚠**주자 행이 타석으로 새면 타율의 분모가 부푼다**
  assert.equal(r.events.length, 2, "주자 행이 타석에 섞였다");
  assert.equal(r.runners.length, 3, "주자 사건을 버렸다");

  const [sb, cs, pk] = r.runners;
  assert.deepEqual(
    { kind: sb!.kind, base: sb!.base, runner: sb!.runnerId, afterSeq: sb!.afterSeq },
    { kind: "steal", base: "2b", runner: "01005131", afterSeq: 1 },
  );
  assert.deepEqual({ kind: cs!.kind, base: cs!.base }, { kind: "caughtStealing", base: "3b" });
  // ⚠견제사의 `base` 는 **노린 루가 아니라 있던 루**다. 도루와 뜻이 다르다
  assert.deepEqual({ kind: pk!.kind, base: pk!.base, runner: pk!.runnerId }, { kind: "pickoff", base: "1b", runner: "01005133" });
  // 문맥이 붙어 있어야 나중에 상황별로 볼 수 있다
  assert.equal(cs!.outsBefore, 0);
  assert.equal(pk!.outsBefore, 2);
  assert.equal(sb!.inning, 1);
  assert.equal(sb!.half, "top");
  // 원문 보존(M4)
  assert.equal(sb!.raw, "二塁盗塁成功");
});

test("더블스틸을 표시로 남긴다", () => {
  const r = parsePlayByPlay(RUNNER_PBP.replace("二塁盗塁成功", "二塁盗塁成功（ダブルスチール）"));
  if (r.status !== "played") throw new Error("played 가 아니다");
  assert.equal(r.runners[0]!.doubleSteal, true);
  assert.equal(r.runners[0]!.kind, "steal", "더블스틸 표기 때문에 종류를 못 읽었다");
  assert.equal(r.runners[1]!.doubleSteal, false);
});

/**
 * ⚠**모르는 주자 표기를 조용히 흘리지 않는다**(M7).
 * 흘리면 도루 성공률의 분모가 서서히 줄고 아무도 눈치채지 못한다.
 * 실측으로 12종이 전부이므로 임계값 0으로 걸 수 있다.
 */
test("⚠모르는 주자 표기가 오면 멈춘다 — 조용히 세지 않고 넘기지 않는다(M7)", () => {
  assert.throws(
    () => parsePlayByPlay(RUNNER_PBP.replace("二塁盗塁成功", "宇宙へ消えた")),
    /도루·견제 표기를 해석하지 못했다/,
  );
});

/**
 * ⚠**타자가 없는데 주자 표기도 아닌 행을 조용히 버리지 않는다**(M7).
 *
 * 이 지점은 「아웃 카운트가 있고 루 상태가 있는데 타자가 없는 행」이라, 우리가 아는 것은
 * 주자 사건뿐이다. 모르는 형태를 넘기면 **도루 성공률의 분모가 서서히 줄고 아무도 모른다** —
 * 이 파일이 막으려는 실패 모드 그 자체다.
 *
 * 실측(2026-08-17): 아카이브 playbyplay **2,761장**의 「타자 없는 5칸 행」이 **전부**
 * `（走者・` 를 갖는다. 임계값 0으로 걸 수 있고, 실제로 전량 스윕에서 파싱 실패 0건이다.
 */
test("⚠타자도 주자 표기도 없는 행이 오면 멈춘다 — 이 분기만 조용하면 그게 구멍이다(M7)", () => {
  const broken = RUNNER_PBP.replace(
    "（走者・<a href=\"/bis/players/01005131.html\">打者一</a>）二塁盗塁成功",
    "リクエストにより判定変更",
  );
  assert.throws(
    () => parsePlayByPlay(broken),
    /타자가 없는 행인데 주자 표기도 아니다/,
  );
});
