import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerParseError, parseBirthDate, parsePlayerProfile, parseThrowsBats } from "../src/player.ts";

/** 실제 마크업 그대로의 픽스처. */
const FIXTURE = `<html><section id="pc_bio"><table>
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

test("일부 항목이 없어도 나머지는 읽는다", () => {
  const html = `<html><section id="pc_bio"><table>
    <tr><th>ポジション</th><td>外野手</td></tr>
    <tr><th>投打</th><td>左投左打</td></tr>
  </table></section></html>`;
  const p = parsePlayerProfile(html);
  assert.equal(p.position, "外野手");
  assert.equal(p.throws, "left");
  assert.equal(p.birthDate, null);
  assert.equal(p.physique, null);
});
