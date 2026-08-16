import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PlayerParseError,
  parseBirthDate,
  parsePlayerProfile,
  parseThrowsBats,
  parseVitals,
} from "../src/player.ts";

/**
 * 실제 마크업 그대로의 픽스처.
 * ⚠**표제부(`#pc_vitals`)가 같이 있어야 한다** — 실측 858/858 이라 파서가 이것을 요구한다.
 * 없으면 던지는 쪽이 옳다: 조용히 null 이면 읽는 법이 사라진 것을 아무도 모르지만,
 * 던지면 적재가 크게 실패하고 **DB에는 옛 값이 남는다**(UPDATE 가 아예 안 돈다).
 */
const FIXTURE = `<html><section id="pc_vitals"><div id="pc_v_name"><ul>
  <li id="pc_v_no">34</li><li id="pc_v_kana">たかはし・こうや</li>
</ul></div></section><section id="pc_bio"><table>
  <tr><th>ポジション</th><td>投手</td></tr>
  <tr><th>投打</th><td>右投左打</td></tr>
  <tr><th>身長／体重</th><td>186cm／92kg </td></tr>
  <tr><th>生年月日</th><td>2004年6月6日</td></tr>
  <tr><th>経歴</th><td> 日本文理高 </td></tr>
  <tr><th>ドラフト</th><td>2022年ドラフト3位</td></tr>
</table></section></html>`;

test("프로필을 읽는다", () => {
  const p = parsePlayerProfile(FIXTURE);
  assert.equal(p.position, "投手");
  assert.equal(p.throws, "right");
  assert.equal(p.bats, "left");
  assert.equal(p.birthDate, "2004-06-06");
  assert.equal(p.physique, "186cm／92kg");
  // 표제부의 두 값도 같은 호출로 들어온다 — 호출부가 두 번 파싱하지 않게 한다(M1)
  assert.equal(p.kana, "たかはし・こうや");
  assert.equal(p.uniformNumber, "34");
});

test("투타 표기 해석", () => {
  assert.deepEqual(parseThrowsBats("右投右打"), { throws: "right", bats: "right" });
  assert.deepEqual(parseThrowsBats("左投左打"), { throws: "left", bats: "left" });
  assert.deepEqual(parseThrowsBats("右投左打"), { throws: "right", bats: "left" });
  assert.deepEqual(parseThrowsBats("左投右打"), { throws: "left", bats: "right" });
});

test("⚠스위치히터와 양투를 both로 읽는다", () => {
  assert.deepEqual(parseThrowsBats("右投両打"), { throws: "right", bats: "both" });
  assert.deepEqual(parseThrowsBats("両投両打"), { throws: "both", bats: "both" });
});

test("⚠모르는 투타 표기는 조용히 null이 아니라 예외다", () => {
  // 절반이 null이 되면 좌우 스플릿이 조용히 반쪽이 된다.
  assert.throws(() => parseThrowsBats("不明"), PlayerParseError);
  assert.throws(() => parseThrowsBats("右投"), PlayerParseError);
  assert.throws(() => parseThrowsBats(""), PlayerParseError);
});

test("생년월일 변환", () => {
  assert.equal(parseBirthDate("2004年6月6日"), "2004-06-06");
  assert.equal(parseBirthDate("1999年3月13日"), "1999-03-13");
  assert.equal(parseBirthDate("1999年12月31日"), "1999-12-31");
});

test("생년월일이 예상 밖이면 null — 여기는 스플릿의 근거가 아니다", () => {
  assert.equal(parseBirthDate("不明"), null);
  assert.equal(parseBirthDate(""), null);
});

test("⚠프로필 표가 없으면 빈 프로필이 아니라 예외다", () => {
  // 빈 프로필을 흘리면 전 선수가 투타 미상이 되고 좌우 스플릿이 통째로 사라진다.
  assert.throws(() => parsePlayerProfile("<html><div>新レイアウト</div></html>"), PlayerParseError);
});

/**
 * ⚠**구획이 없는 것과 항목이 없는 것을 구별한다.**
 * 구획(`#pc_bio`·`#pc_vitals`)이 사라진 것은 **마크업이 바뀐 것**이라 던진다 —
 * 조용히 넘기면 전 선수가 한꺼번에 미상이 되고 아무도 모른다(M7).
 * 그 안의 항목이 없는 것은 **그 선수에게 그 값이 없는 것**이라 null 이다(M11).
 */
test("구획은 있는데 일부 항목이 없으면 나머지는 읽는다", () => {
  const html = `<html><section id="pc_vitals"><div id="pc_v_name"><ul>
    <li id="pc_v_kana">やまだ・てつと</li>
  </ul></div></section><section id="pc_bio"><table>
    <tr><th>ポジション</th><td>外野手</td></tr>
    <tr><th>投打</th><td>左投左打</td></tr>
  </table></section></html>`;
  const p = parsePlayerProfile(html);
  assert.equal(p.position, "外野手");
  assert.equal(p.throws, "left");
  assert.equal(p.birthDate, null);
  assert.equal(p.physique, null);
  assert.equal(p.kana, "やまだ・てつと");
  // 등번호만 없다 = 이 선수가 지금 등록되어 있지 않다(은퇴·이적). 0 이 아니다
  assert.equal(p.uniformNumber, null);
});

/**
 * 표제부(`#pc_vitals`) — 읽는 법과 등번호.
 *
 * ⚠**사진과 구단 로고가 같은 구획에 있다.** 읽지 않는 것이 규칙이다(CLAUDE.md §6) —
 * 사진은 촬영자의 저작물이고 선수의 초상권이 붙으며 로고는 상표다.
 */
const VITALS = `<section id="pc_vitals"><div id="pc_v_wrap" class="c">
<div id="pc_v_photo"><img src="https://p.npb.jp/players_photo/2026/180/c/034_01005134.jpg" title="高橋　昂也"></div>
<div id="pc_v_name"><ul>
<li id="pc_v_no">34</li>
<li id="pc_v_team">広島東洋カープ</li>
<li id="pc_v_name">高橋　昂也                       </li>
<li id="pc_v_kana">たかはし・こうや</li>
</ul></div>
<div id="pc_v_logo"><img src="//p.npb.jp/img/common/logo/2026/logo_c_l.gif" title="広島東洋カープ"></div>
</section>`;

test("표제부에서 읽는 법과 등번호를 꺼낸다 — 재수집 없이 이미 받아 둔 페이지에 있다", () => {
  const v = parseVitals(VITALS);
  assert.equal(v.kana, "たかはし・こうや");
  assert.equal(v.uniformNumber, "34");
});

/**
 * ⚠**등번호 없음은 「0번」이 아니라 「지금 등록이 없다」**(M11).
 * 실측 858명 중 76명이 이 항목 자체가 없고, 그 76명은 **2026시즌 출장이 0**이다(은퇴·이적).
 * 0으로 채우면 은퇴 선수가 전원 0번이 된다.
 */
test("⚠등번호가 없으면 null이다 — 0으로 채우지 않는다", () => {
  // 요소 자체가 없는 형태(실측 858명 중 76명이 이것)
  const gone = parseVitals(VITALS.replace(`<li id="pc_v_no">34</li>`, ""));
  assert.equal(gone.uniformNumber, null, "없는 등번호를 값으로 만들었다");
  assert.equal(gone.kana, "たかはし・こうや", "등번호가 없다고 읽는 법까지 잃었다");
  // 요소는 있는데 비어 있는 형태. ⚠**빈 문자열을 값으로 넣지 않는다** —
  // 화면이 「등번호 칸은 있는데 아무것도 없는 줄」을 그리게 되고, 그건 결손처럼 보인다
  const blank = parseVitals(VITALS.replace(`<li id="pc_v_no">34</li>`, `<li id="pc_v_no">  </li>`));
  assert.equal(blank.uniformNumber, null, "빈 표기를 값으로 만들었다");
});

/**
 * ⚠**「히라가나」로 좁히지 않는다.** 실측 858명 중 **121명이 외국인 선수**라
 * 값이 카타카나 + 라틴이다. 히라가나만 받게 만들면 그 121명의 검색어가 통째로 사라진다.
 * ⚠**여기서 정규화하지 않는다**(M4) — 접기는 검색 쪽 한 벌이 한다.
 */
test("⚠외국인 선수의 표기를 원문 그대로 둔다 — 히라가나로 좁히면 121명이 사라진다", () => {
  const v = parseVitals(
    VITALS.replace("たかはし・こうや", "ルーク・ボイト (LUKE VOIT)"),
  );
  assert.equal(v.kana, "ルーク・ボイト (LUKE VOIT)");
});

/** ⚠표제부가 없으면 던진다(M7). 조용히 null 이면 어느 날 검색이 이름만으로 좁아진다 */
test("⚠표제부가 없으면 멈춘다 — 조용히 빈 값을 돌려주지 않는다(M7)", () => {
  assert.throws(() => parseVitals("<html><body>표제부가 없다</body></html>"), /pc_vitals/);
});

/**
 * ⚠**표제부가 없어도 프로필 전체를 잃지 않는다** — blast radius 를 맞춘 결과다.
 *
 * 처음에는 `parsePlayerProfile` 이 여기서 던졌다. M7 의 취지에는 맞지만,
 * 던지면 `load-players.ts` 가 그 선수를 건너뛰어 **투타·생년월일까지 갱신이 스킵**되고
 * `failed>0 → exit 1 → 배포 전면 중단`이 된다. 「읽는 법이 조용히 사라진다」를 막으려고
 * 「화면이 안 올라간다」를 사는 거래였다.
 *
 * ⚠**조용히 넘기는 것이 아니다** — 적재가 커버리지를 재서 임계값(90%)을 건다.
 * 한 명이 없는 것과 858명이 한꺼번에 없어지는 것은 거기서 갈린다.
 */
test("표제부가 없어도 투타는 읽는다 — 멈추는 자리는 적재의 커버리지 검사다", () => {
  const html = `<html><section id="pc_bio"><table>
    <tr><th>ポジション</th><td>投手</td></tr>
    <tr><th>投打</th><td>右投右打</td></tr>
  </table></section></html>`;
  const p = parsePlayerProfile(html);
  assert.equal(p.throws, "right", "표제부가 없다고 투타까지 잃었다");
  assert.equal(p.position, "投手");
  // 못 읽은 두 값만 null 이다(M11) — 「없다」가 아니라 「못 읽었다」
  assert.equal(p.kana, null);
  assert.equal(p.uniformNumber, null);
  // 엄격한 원본은 그대로 던진다 — 커버리지 검사가 이것을 센다
  assert.throws(() => parseVitals(html), /pc_vitals/);
});
