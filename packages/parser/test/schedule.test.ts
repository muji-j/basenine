/**
 * 일정 페이지의 구장 추출.
 *
 * ⚠**이 파서가 조용히 틀리는 방식은 「남의 구장을 집는 것」이다.** 값이 비지 않고
 * 그럴듯한 구장명이 들어가므로 눈으로는 발견되지 않는다. 그래서 여기서 고정하는 것은
 * 「구장을 읽는가」가 아니라 **「그 경기의 구장을 읽는가」**다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVenue, parseScheduleVenues, venuesByGameId } from "../src/schedule.ts";

/** 실제 일정 표의 구조를 줄인 것. 링크 **뒤에** place가 온다 */
const HTML = `
<table>
  <tr id="date0814">
    <td><div class="team1">オリックス</div>
        <a href="/scores/2026/0814/b-f-19/"><div class="score1">6</div></a>
        <div class="team2">日本ハム</div></td>
    <td><div class="place">京セラD大阪</div><div class="time">18:00</div></td>
  </tr>
  <tr id="date0814b">
    <td><a href="/scores/2026/0814/s-db-17/">…</a></td>
    <td><div class="place">神　宮</div><div class="time">18:00</div></td>
  </tr>
  <tr id="date0815">
    <td><a href="/scores/2026/0815/b-f-20/">…</a></td>
    <td><div class="place">ほっと神戸</div></td>
  </tr>
</table>`;

test("경기마다 자기 구장을 읽는다", () => {
  const v = parseScheduleVenues(HTML);
  assert.equal(v.get("/scores/2026/0814/b-f-19/"), "京セラD大阪");
  assert.equal(v.get("/scores/2026/0814/s-db-17/"), "神宮");
  assert.equal(v.get("/scores/2026/0815/b-f-20/"), "ほっと神戸");
  assert.equal(v.size, 3);
});

test("⚠앞이 아니라 뒤에서 찾는다 — 앞에서 찾으면 이전 경기의 구장을 집는다", () => {
  const v = parseScheduleVenues(HTML);
  // 8/15 경기가 8/14의 구장을 가져오면 안 된다
  assert.notEqual(v.get("/scores/2026/0815/b-f-20/"), "神宮");
});

/**
 * ⚠**이전 결정을 뒤집었다**(2026-08-16). 예전에는 「원문 표기를 다듬지 않는다」였다.
 *
 * 뒤집은 이유: 구장명이 **집계의 키**가 됐기 때문이다(구장별 스플릿).
 * 키에 폭 맞춤용 전각 공백이 섞이면 같은 구장이 두 줄로 갈라질 수 있고,
 * 화면에도 구멍이 뚫린 채 나온다(`神　宮`).
 *
 * ⚠**「원문을 보존한다」는 원칙(M4)은 그대로다** — 보존 위치가 DB 열이 아니라
 * 저장된 HTML이라는 것이 요점이다. 아카이브는 손대지 않는다.
 */
test("⚠폭 맞춤용 전각 공백을 접는다 — 구장명은 집계의 키다", () => {
  const v = parseScheduleVenues(HTML);
  assert.equal(v.get("/scores/2026/0814/s-db-17/"), "神宮");
  assert.ok(!v.get("/scores/2026/0814/s-db-17/")!.includes("　"), "전각 공백이 남았다");
});

test("구장명 안의 뜻 있는 글자는 건드리지 않는다", () => {
  assert.equal(normalizeVenue("京セラD大阪"), "京セラD大阪");
  assert.equal(normalizeVenue("ほっと神戸"), "ほっと神戸");
  assert.equal(normalizeVenue("みずほPayPay"), "みずほPayPay");
});

test("빈 표기는 빈 문자열이다 — 공백만 있는 칸을 구장으로 만들지 않는다(M11)", () => {
  assert.equal(normalizeVenue("　　"), "");
  assert.equal(normalizeVenue("&nbsp;"), "");
});

test("place 칸이 없으면 넣지 않는다 — 빈 문자열로 만들지 않는다(M11)", () => {
  const v = parseScheduleVenues(`<table><tr><td><a href="/scores/2026/0801/g-db-15/">…</a></td></tr></table>`);
  assert.equal(v.size, 0);
  assert.equal(v.get("/scores/2026/0801/g-db-15/"), undefined);
});

test("빈 place 칸도 넣지 않는다", () => {
  const v = parseScheduleVenues(
    `<a href="/scores/2026/0801/g-db-15/">…</a><div class="place">&nbsp;</div>`,
  );
  assert.equal(v.size, 0);
});

test("⚠너무 먼 place는 남의 것이다 — 창을 넓히면 다음 행까지 넘어간다", () => {
  const far = `<a href="/scores/2026/0801/g-db-15/">…</a>${"x".repeat(1200)}<div class="place">東京ドーム</div>`;
  assert.equal(parseScheduleVenues(far).size, 0, "1200자 뒤의 구장을 집었다");
});

test("경기 ID 키로도 뒤집을 수 있다 — 적재기가 쓰는 모양", () => {
  const byId = venuesByGameId(HTML);
  assert.equal(byId.get("2026/0814/b-f-19"), "京セラD大阪");
  assert.equal(byId.get("2026/0815/b-f-20"), "ほっと神戸");
});

test("같은 경기가 두 번 나와도 한 번만 센다 — 일정 표에 링크가 중복된다", () => {
  const dup = `${HTML}<a href="/scores/2026/0814/b-f-19/">…</a><div class="place">別の球場</div>`;
  const v = parseScheduleVenues(dup);
  assert.equal(v.get("/scores/2026/0814/b-f-19/"), "京セラD大阪", "뒤의 중복이 앞을 덮어썼다");
});
