/**
 * 경기별 ベンチ入り選手 명단 파서.
 *
 * ⚠**이 페이지는 처음부터 받고 있었는데 한 번도 읽지 않았다**(2026-08-17).
 * 그 안에 투타가 있고, 선수 페이지로는 **닿지 않는 선수**(NPB를 떠난 선수)의 투타가
 * 거기에만 있다 — 소급 시즌을 백필하면 그런 선수가 대거 들어온다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RosterParseError, parseGameRoster } from "../src/roster.ts";

/** 실제 마크업 그대로. 배번 없는 행과 育成 세 자리 배번을 함께 넣는다 */
const ROSTER = `<div class="rosterbox"><table><tbody>
<tr><td>1</td><td><a href="/bis/players/31135133.html">秋山</a></td><td>右投左打</td></tr>
<tr><td>37</td><td><a href="/bis/players/01005134.html">野間</a></td><td>右投左打</td></tr>
<tr><td>122</td><td><a href="/bis/players/01305155.html">育成の選手</a></td><td>左投左打</td></tr>
<tr><td></td><td><a href="/bis/players/61665136.html">背番号なし</a></td><td>右投両打</td></tr>
</tbody></table></div>`;

test("명단에서 배번·투타를 읽는다 — 재수집 없이 이미 받아 둔 페이지에 있다", () => {
  const rows = parseGameRoster(ROSTER);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    playerId: "31135133", name: "秋山", uniformNumber: "1", throws: "right", bats: "left",
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
