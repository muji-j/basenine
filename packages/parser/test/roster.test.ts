/**
 * 경기별 ベンチ入り選手 명단 파서.
 *
 * ⚠**이 페이지는 처음부터 받고 있었는데 한 번도 읽지 않았다**(2026-08-17).
 * 그 안에 투타가 있고, 선수 페이지로는 **닿지 않는 선수**(NPB를 떠난 선수)의 투타가
 * 거기에만 있다 — 소급 시즌을 백필하면 그런 선수가 대거 들어온다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RosterParseError, parseGameRoster } from "../src/roster.ts";

/**
 * 실제 마크업 그대로. 배번 없는 행과 育成 세 자리 배번을 함께 넣는다.
 *
 * ⚠**포지션 구획 머리(`<th colspan="3">`)를 반드시 포함한다** — 실물이 그렇고,
 * 빼면 「구획 없는 명단」이라는 실재하지 않는 모양을 시험하게 된다.
 */
const ROSTER = `<div class="rosterbox"><table><tbody>
<tr><th colspan="3">投手</th></tr>
<tr><td>1</td><td><a href="/bis/players/31135133.html">秋山</a></td><td>右投左打</td></tr>
<tr><th colspan="3">捕手</th></tr>
<tr><td>37</td><td><a href="/bis/players/01005134.html">野間</a></td><td>右投左打</td></tr>
<tr><th colspan="3">内野手</th></tr>
<tr><td>122</td><td><a href="/bis/players/01305155.html">育成の選手</a></td><td>左投左打</td></tr>
<tr><th colspan="3">外野手</th></tr>
<tr><td></td><td><a href="/bis/players/61665136.html">背番号なし</a></td><td>右投両打</td></tr>
</tbody></table></div>`;

test("명단에서 배번·투타를 읽는다 — 재수집 없이 이미 받아 둔 페이지에 있다", () => {
  const rows = parseGameRoster(ROSTER);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    playerId: "31135133", name: "秋山", uniformNumber: "1", throws: "right", bats: "left",
    position: "投手",
  });
  // ⚠**세 자리 育成 배번을 그대로 둔다** — 숫자로 바꾸면 `061` 이 `61` 이 되어 支配下와 섞인다
  assert.equal(rows[2]!.uniformNumber, "122");
  assert.equal(rows[2]!.throws, "left");
});

/** ⚠배번 없음은 「0번」이 아니다(M11) */
test("배번이 없으면 null이다 — 투타는 그대로 읽는다", () => {
  const rows = parseGameRoster(ROSTER);
  const noNumber = rows[3]!;
  assert.equal(noNumber.uniformNumber, null, "없는 배번을 값으로 만들었다");
  assert.equal(noNumber.bats, "both", "배번이 없다고 투타까지 잃었다");
});

/**
 * ⚠**투타 칸까지 한 덩어리로 잡는다.** 선수 링크만 찾으면 이 페이지의 다른 링크
 * (라인스코어 밑의 배터리 표기 등)까지 걸리고, 그러면 투타가 없는 행이 섞인다.
 */
test("명단 행이 아닌 선수 링크는 줍지 않는다", () => {
  /**
   * ⚠**투타 칸이 아예 없는 행**을 넣는다. 첫 칸이 비어 있어 배번 자리와 모양이 같으므로,
   * 「투타 칸까지 요구한다」를 빼면 이 행이 선수로 잡히고 투타가 `undefined` 가 된다.
   */
  const withNoise = ROSTER.replace(
    "<tbody>",
    `<tbody><tr><td></td><td><a href="/bis/players/99999999.html">別の選手</a></td></tr>`,
  );
  const ids = parseGameRoster(withNoise).map((r) => r.playerId);
  assert.ok(!ids.includes("99999999"), "명단이 아닌 링크를 선수로 셌다");
  assert.equal(ids.length, 4);
});

/**
 * ⚠**모르는 표기를 조용히 넘기지 않는다**(M7).
 * 실측 156,782행 중 형식을 벗어난 행이 **0건**이라 임계값 0으로 걸 수 있다.
 * 흘리면 투타 보충이 서서히 줄고 아무도 눈치채지 못한다.
 */
test("⚠모르는 투타 표기가 오면 멈춘다 — 조용히 건너뛰지 않는다(M7)", () => {
  assert.throws(
    () => parseGameRoster(ROSTER.replace("右投左打", "投打不明")),
    RosterParseError,
  );
});

/** ⚠빈 배열로 넘기면 「그날은 벤치가 비어 있었다」가 된다 */
test("⚠명단을 한 행도 못 찾으면 멈춘다 — 빈 배열이 아니다(M7)", () => {
  assert.throws(() => parseGameRoster("<html><body>新レイアウト</body></html>"), /명단을 한 행도/);
});

/**
 * ## 포지션 — **투타를 메울 때 같은 페이지에서 이 칸만 안 읽었다**(2026-08-27)
 *
 * 선수 페이지의 역할 판정이 `position === "投手"` 를 먼저 보므로,
 * **미상이면 투수가 타자로 판정되어 투수 스플릿이 화면에서 통째로 사라진다.**
 * 실측(보유 9시즌): 투타 양쪽 기록을 가진 2,374 선수-시즌 중 **917 이 미상**이고
 * 그만큼 사라졌다(상대한 타자 합 163,631 · 한 명 최대 847). 2018년 191명 · 2026년 0명.
 *
 * ⚠**「받고 있는데 안 읽던 것」의 재발**이다(§2-2-1). 페이지는 처음부터 갖고 있었다.
 */
test("포지션 구획을 읽는다 — 선수 페이지가 없는 선수의 유일한 출처다", () => {
  const rows = parseGameRoster(ROSTER);
  assert.deepEqual(rows.map((r) => r.position), ["投手", "捕手", "内野手", "外野手"]);
});

/**
 * ⚠**모르는 머리를 조용히 넘기면 그 구획 선수들이 「바로 위 구획」의 포지션을 받는다** —
 * 빈 값보다 나쁘다. 실측(아카이브 명단 **7,805장** 전수): 머리 라벨은
 * `投手`·`捕手`·`内野手`·`外野手` **넷뿐**이고 각각 15,066회(= 7,533장 × 2팀)다.
 * ⚠**나머지 272장은 머리도 선수 행도 0개**라 지금도 이미 실패로 세고 있다.
 */
test("⚠모르는 포지션 구획이 오면 멈춘다 — 위 구획의 값을 물려주지 않는다(M7)", () => {
  assert.throws(
    () => parseGameRoster(ROSTER.replace("内野手", "指名打者")),
    /포지션 구획을 해석하지 못했다/,
  );
});

/** ⚠구획 밖의 선수 행을 포지션 없이 흘리지 않는다 — 마크업이 바뀌면 여기서 걸린다 */
test("⚠구획 앞에 선수 행이 있으면 멈춘다", () => {
  const noHead = ROSTER.replace(/<tr><th colspan="3">[^<]*<\/th><\/tr>\n?/g, "");
  assert.throws(() => parseGameRoster(noHead), /포지션 구획 앞에 있는 선수 행/);
});

/**
 * ⚠**실물로 확인한다.** 구획은 **머리 행의 위치로만** 정해지므로, 합성 픽스처로 쓰면
 * 「머리와 행의 순서」를 내가 정하게 되어 **한 칸씩 밀린 포지션**이 들어가도 초록이 된다.
 * 구형 박스 픽스처에서 겪은 그대로다(fixtures/README.md).
 */
test("⚠실물 명단(2018-03-30 広島 대 中日)에서 포지션이 구획대로 붙는다", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "2018-roster.html.gz");
  const rows = parseGameRoster(gunzipSync(readFileSync(path)).toString("utf8"));
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.position, (by.get(r.position) ?? 0) + 1);
  // ⚠**분모를 적는다**(작업규칙 7). 이 장은 실측 **50명**(두 팀 × 25명)이다.
  //   ⚠**「52명 안팎」이라고 적혀 있던 것은 어림값이었다** — 아카이브 전수(행이 있는 7,533장)
  //   실측은 **43~64명**이고 최빈이 52(5,238장)다. 어림값을 상수로 박았다가 이 시험이 잡았다.
  console.log(`  · 실물 ${rows.length}명 · ${[...by].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  assert.equal(rows.length, 50, "명단 인원이 예상 밖이다 — 마크업이 바뀌었을 수 있다");
  // ⚠**정렬 순서에 기대지 않는다** — CJK 는 코드포인트 순이라 눈으로 쓴 순서와 다르다
  //   (실제로 한 번 틀렸다: 내가 쓴 内·捕·投·外 가 아니라 内·外·投·捕 다).
  for (const want of ["投手", "捕手", "内野手", "外野手"]) {
    assert.ok(by.has(want), `${want} 구획이 하나도 안 잡혔다`);
  }
  assert.equal(by.size, 4, "포지션 종류가 넷이 아니다");
  // ⚠**두 팀이 들어 있다** — 각 구획이 팀마다 한 번씩 나오므로 인원이 한쪽으로 쏠리면 밀린 것이다
  for (const [pos, n] of by) assert.ok(n >= 2, `${pos} 가 ${n}명뿐이다 — 구획이 밀렸을 수 있다`);
  // ⚠첫 행은 반드시 첫 구획(投手)에 속한다
  assert.equal(rows[0]!.position, "投手");
});
