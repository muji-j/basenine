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
test("⚠모르는 주자 표기를 조용히 흘리지 않는다 — 세어서 돌려준다(M7)", () => {
  const r = parsePlayByPlay(RUNNER_PBP.replace("二塁盗塁成功", "宇宙へ消えた"));
  if (r.status !== "played") throw new Error("played 가 아니다");
  assert.equal(r.unreadRunners.length, 1, "모르는 표기를 세지 않았다");
  assert.equal(r.runners.length, 2, "읽을 수 있던 주자 사건까지 잃었다");
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
test("⚠타자도 주자 표기도 없는 행을 버리지 않고 센다 — 그러나 경기를 죽이지도 않는다(M7)", () => {
  const broken = RUNNER_PBP.replace(
    "（走者・<a href=\"/bis/players/01005131.html\">打者一</a>）二塁盗塁成功",
    "リクエストにより判定変更",
  );
  const r = parsePlayByPlay(broken);
  assert.equal(r.status, "played");
  if (r.status !== "played") return;
  // ⚠**타석 로그는 살아 있어야 한다.** 도루 표기 1건이 상대전적의 유일한 출처를
  // 가져가면 blast radius가 맞지 않는다 — `tokens.ts` 도 같은 이유로 던지지 않는다
  assert.equal(r.events.length, 2, "주자 행 하나 때문에 타석 로그가 사라졌다");
  // ⚠**그렇다고 조용하지도 않다.** 적재가 이것을 격리에 넣는다
  assert.deepEqual(r.unreadRunners, ["リクエストにより判定変更"], "읽지 못한 행을 세지 않았다");
  assert.equal(r.runners.length, 2, "읽은 주자 사건까지 잃었다");
});

/** 도루 어휘를 못 읽어도 같다 — 경기를 죽이지 않고, 대신 센다 */
test("모르는 도루 표기도 격리로 넘긴다 — 경기를 죽이지 않는다", () => {
  const r = parsePlayByPlay(RUNNER_PBP.replace("二塁盗塁成功", "二塁宇宙転送"));
  if (r.status !== "played") throw new Error("played 가 아니다");
  assert.equal(r.events.length, 2, "타석 로그가 사라졌다");
  assert.equal(r.runners.length, 2, "읽을 수 있던 주자 사건까지 잃었다");
  assert.equal(r.unreadRunners.length, 1, "모르는 표기를 세지 않았다");
  assert.match(r.unreadRunners[0]!, /二塁宇宙転送/);
});

// ─── N2 · 투수 표기 행의 모양을 검증한다(감사 N2 · 설계 docs/superpowers/specs/2026-09-27-profile-version-guard-design.md §7) ───
//
// ⚠**예전 규칙은 「링크가 하나라도 있으면 마지막 링크가 새 투수」였다** — 링크 개수도 화살표 위치도 안 봤다.
//   교대 행에서 **새 투수의 링크만** 못 읽으면 `ids = [옛 투수]` 가 되어, 다음 교대까지의 타석이 **이전 투수에게
//   조용히** 붙었다(반증자 실물 변이: 6회초 5타석). 정렬(`align.ts`)은 타자별 타석 수만 맞대므로 그것을 못 잡는다.

/** 픽스처의 한 조각을 바꾼다. ⚠**정확히 한 번 있지 않으면 던진다** — 변이가 헛돌면 이 시험은 아무것도 안 잰다 */
function mutate(from: string, to: string, html: string = FIXTURE): string {
  assert.equal(html.split(from).length - 1, 1, `픽스처에 ${JSON.stringify(from)} 가 정확히 한 번이 아니다`);
  return html.replace(from, to);
}

/** 던지는 것이 `PlayByPlayParseError` 이고 **그 이유**를 말하는지까지 본다 — 아무 예외나 받으면 다른 결함도 초록이 된다 */
function throwsBecause(html: string, why: RegExp): PlayByPlayParseError {
  let caught: unknown;
  try {
    parsePlayByPlay(html);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught !== undefined, `던지지 않았다 — 기대한 이유: ${why}`);
  assert.ok(caught instanceof PlayByPlayParseError, `PlayByPlayParseError 가 아니다: ${String(caught)}`);
  assert.match(caught.message, why);
  return caught;
}

/** 픽스처의 교대 행(2회표 · 宮城 7001 → 東松 7002) */
const CHANGE_ROW = `（投手交代） ${link("7001", "宮城")} → ${link("7002", "東松")}`;
/** 링크를 못 읽게 만든 모양(`.html` 이 빠졌다) — 파서의 링크 정규식은 `.html` 로 끝나는 것만 읽는다 */
const unreadable = (id: string, name: string): string => `<a href="/bis/players/${id}">${name}</a>`;

test("⚠N2 2-1 · 交代 의 새 투수 링크를 못 읽으면 던진다 — 이전 투수에게 조용히 붙이지 않는다", () => {
  const html = mutate(CHANGE_ROW, `（投手交代） ${link("7001", "宮城")} → ${unreadable("7002", "東松")}`);
  const err = throwsBecause(html, /投手交代 표기의 화살표 뒤에서 새 투수 링크를 정확히 하나 읽지 못했다/);
  // detail 이 어느 하프·어느 행인지 말한다(M7 — 사람이 원문으로 돌아갈 자리)
  assert.match(err.detail, /half=top/);
  assert.match(err.detail, /row="（投手交代） 宮城 → 東松"/);
});

/**
 * ⚠**옛 투수 링크만 없는 경우는 살린다** — 새 투수는 화살표 뒤에서 정확히 안다. 이것까지 던지면 헛실패다.
 * 변이 「교대 행에 링크 정확히 2 를 요구」가 이 시험을 붉게 만든다.
 */
test("N2 2-2 · 交代 의 옛 투수 링크만 없으면 통과한다 — 그 뒤 타석의 투수는 새 투수다", () => {
  for (const old of ["宮城", unreadable("7001", "宮城")]) {
    const html = mutate(CHANGE_ROW, `（投手交代） ${old} → ${link("7002", "東松")}`);
    const r = parsePlayByPlay(html);
    if (r.status !== "played") return assert.fail("played 여야 한다");
    assert.deepEqual(
      r.events.map((e) => e.pitcherId),
      ["7001", "7001", "7001", "8001", "7002", "7002"],
      `옛 투수 표기 ${JSON.stringify(old)} 에서 투수 귀속이 달라졌다`,
    );
  }
});

test("⚠N2 2-3 · 先発 행은 화살표 0 · 링크 정확히 1 이어야 한다 — 0 · 2 · 화살표가 있으면 던진다", () => {
  const start = `（先発投手） ${link("7001", "宮城")}`;
  for (const [label, to] of [
    ["링크 0", "（先発投手） 宮城"],
    ["링크를 못 읽음", `（先発投手） ${unreadable("7001", "宮城")}`],
    ["링크 2", `（先発投手） ${link("7001", "宮城")} ${link("7009", "誰")}`],
    ["화살표", `（先発投手） ${link("7001", "宮城")} →`],
  ] as const) {
    const err = throwsBecause(mutate(start, to), /先発投手 표기에서 투수 링크를 정확히 하나 읽지 못했다/);
    assert.match(err.detail, /links=\d/, `${label}: detail 이 링크 수를 말하지 않는다`);
  }
});

test("⚠N2 2-3 · 交代 행은 글자·본문 양쪽에서 화살표가 정확히 1 이어야 한다 — 0 · 2 · &rarr; · 속성 안 화살표는 던진다", () => {
  for (const to of [
    `（投手交代） ${link("7001", "宮城")} ${link("7002", "東松")}`,
    `（投手交代） ${link("7001", "宮城")} → → ${link("7002", "東松")}`,
    // 글자로는 화살표가 0 이다(엔티티를 풀지 않는다) — 어디서 나눌지 모른다
    `（投手交代） ${link("7001", "宮城")} &rarr; ${link("7002", "東松")}`,
    // 글자로는 1 인데 본문에는 2 다(속성 안) — 본문을 나누는 자리가 갈린다
    `（投手交代） <a href="/bis/players/7001.html" title="→">宮城</a> → ${link("7002", "東松")}`,
  ]) {
    throwsBecause(mutate(CHANGE_ROW, to), /投手交代 표기의 화살표\(→\)가 정확히 하나가 아니다/);
  }
});

test("⚠N2 2-3 · 交代 행의 화살표 뒤 링크 2 · 앞 링크 2 는 던진다", () => {
  throwsBecause(
    mutate(CHANGE_ROW, `（投手交代） ${link("7001", "宮城")} → ${link("7002", "東松")} ${link("7003", "誰")}`),
    /投手交代 표기의 화살표 뒤에서 새 투수 링크를 정확히 하나 읽지 못했다/,
  );
  throwsBecause(
    mutate(CHANGE_ROW, `（投手交代） ${link("7009", "誰")} ${link("7001", "宮城")} → ${link("7002", "東松")}`),
    /投手交代 표기의 화살표 앞 링크가 둘 이상이다/,
  );
});

test("⚠N2 2-3 · 先発投手 와 投手交代 가 한 행에 같이 있으면 던진다", () => {
  throwsBecause(
    mutate(CHANGE_ROW, `（先発投手）（投手交代） ${link("7001", "宮城")} → ${link("7002", "東松")}`),
    /先発投手 와 投手交代 가 한 행에 같이 있다/,
  );
});

/**
 * ⚠**옛 투수가 우리 추적과 다르면 그 앞 타석 귀속이 이미 틀렸을 수 있다**(빠진 先発 행 · 하프 헤더 오판).
 * 같은 행에 이미 있는 정보로 잡는다 — 실측 어긋남 0/48,900(설계 §4-3). 변이 「대조 삭제」가 이 시험을 붉게 만든다.
 */
test("⚠N2 2-4 · 交代 의 옛 투수가 그 하프의 현재 투수와 다르면 던진다", () => {
  const err = throwsBecause(
    mutate(CHANGE_ROW, `（投手交代） ${link("7009", "誰か")} → ${link("7002", "東松")}`),
    /投手交代 의 옛 투수가 그 하프의 현재 투수와 다르다/,
  );
  assert.match(err.detail, /old=7009/);
  assert.match(err.detail, /current=7001/);
});

/** ⚠**규칙을 만족하는 행에서는 새 투수 = 예전의 「마지막 링크」다** — 기존 귀속이 한 타석도 안 바뀐다(설계 §7-3) */
test("N2 · 규칙을 만족하는 픽스처의 투수 귀속은 그대로다", () => {
  for (const html of [FIXTURE, RUNNER_PBP]) {
    assert.doesNotThrow(() => parsePlayByPlay(html));
  }
  const r = parsePlayByPlay(FIXTURE);
  if (r.status !== "played") return assert.fail("played 여야 한다");
  assert.deepEqual(r.events.map((e) => e.pitcherId), ["7001", "7001", "7001", "8001", "7002", "7002"]);
});
