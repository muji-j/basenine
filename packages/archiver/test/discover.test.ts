import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_PAGES,
  NoGamesFoundError,
  discoverGames,
  gamesOn,
  monthlyScheduleUrl,
  pageKey,
  pageUrl,
} from "../src/discover.ts";

/**
 * 실제 npb.jp 월간 일정 페이지의 링크 형태를 축약한 픽스처.
 * 2026-08-14 실측한 href 형식을 그대로 따른다.
 */
const MONTHLY_HTML = `
<table class="js-schedule">
  <tr><td><a href="/scores/2026/0801/g-db-15/">DeNA 3-2 巨人</a></td>
      <td><a href="/scores/2026/0801/s-t-14/">阪神 5-1 ヤクルト</a></td></tr>
  <tr><td><a href="/scores/2026/0813/h-m-17/">ロッテ 0-4 ソフトバンク</a></td></tr>
  <tr><td><a href="/scores/2026/0814/s-db-17/">DeNA 7-2 ヤクルト</a></td>
      <td><a href="/scores/2026/0814/d-g-18/">巨人 1-3 中日</a></td>
      <td><a href="/scores/2026/0814/c-t-16/">阪神 2-2 広島</a></td></tr>
  <tr><td><a href="/scores/2026/0814/s-db-17/">(중복 링크 — 스코어보드와 표에 두 번 나온다)</a></td></tr>
  <tr><td>8/15 18:00 予定</td></tr>
</table>`;

test("월간 일정에서 경기 링크를 추출한다", () => {
  const games = discoverGames(MONTHLY_HTML, "https://npb.jp/games/2026/schedule_08_detail.html");
  assert.equal(games.length, 6, "중복 1건을 제외한 6건이어야 한다");

  const first = games[0];
  assert.ok(first);
  assert.deepEqual(first, {
    season: 2026,
    date: "2026-08-01",
    slug: "g-db-15",
    path: "/scores/2026/0801/g-db-15/",
  });
});

test("같은 경기 링크가 여러 번 나와도 1건으로 센다", () => {
  const games = discoverGames(MONTHLY_HTML, "u");
  const paths = games.map((g) => g.path);
  assert.equal(new Set(paths).size, paths.length, "중복이 남아 있으면 같은 페이지를 두 번 받는다");
});

test("⚠M7: 링크가 0건이면 빈 배열이 아니라 예외를 던진다", () => {
  // 페이지 구조가 바뀐 상황을 모사한다. 조용한 0건은 「그날 경기가 없었다」로 오독된다.
  const changed = `<div class="new-layout"><span data-game="2026-08-14">試合</span></div>`;
  assert.throws(() => discoverGames(changed, "https://npb.jp/x"), NoGamesFoundError);
});

test("⚠M7: 예외에 진단 정보가 담긴다", () => {
  try {
    discoverGames("<html></html>", "https://npb.jp/x");
    assert.fail("던져야 한다");
  } catch (err) {
    assert.ok(err instanceof NoGamesFoundError);
    assert.equal(err.sourceUrl, "https://npb.jp/x");
    assert.equal(err.htmlLength, 13);
  }
});

test("경기일로 거른다", () => {
  const games = discoverGames(MONTHLY_HTML, "u");
  assert.equal(gamesOn(games, "2026-08-14").length, 3);
  assert.equal(gamesOn(games, "2026-08-13").length, 1);
});

test("경기가 없는 날은 0건이며 이것은 정상이다", () => {
  // 「구조가 깨져서 0건」(예외)과 「그날 경기가 없어서 0건」(정상)은 다르다.
  const games = discoverGames(MONTHLY_HTML, "u");
  assert.equal(gamesOn(games, "2026-08-12").length, 0);
});

test("더블헤더처럼 같은 날 복수 경기가 남는다", () => {
  const games = discoverGames(MONTHLY_HTML, "u");
  const slugs = gamesOn(games, "2026-08-14").map((g) => g.slug);
  assert.deepEqual(slugs, ["s-db-17", "d-g-18", "c-t-16"]);
});

test("저장 키와 URL", () => {
  const ref = { season: 2026, date: "2026-08-14", slug: "s-db-17", path: "/scores/2026/0814/s-db-17/" };
  assert.equal(pageKey(ref, ""), "npb/scores/2026/0814/s-db-17/index");
  assert.equal(pageKey(ref, "playbyplay.html"), "npb/scores/2026/0814/s-db-17/playbyplay");
  assert.equal(pageUrl(ref, ""), "https://npb.jp/scores/2026/0814/s-db-17/");
  assert.equal(pageUrl(ref, "box.html"), "https://npb.jp/scores/2026/0814/s-db-17/box.html");
});

test("보존 대상 하위 페이지는 4종", () => {
  assert.deepEqual([...GAME_PAGES], ["", "playbyplay.html", "box.html", "roster.html"]);
});

test("월간 일정 URL", () => {
  assert.equal(monthlyScheduleUrl(2026, 8), "https://npb.jp/games/2026/schedule_08_detail.html");
  assert.equal(monthlyScheduleUrl(2026, 12), "https://npb.jp/games/2026/schedule_12_detail.html");
  assert.throws(() => monthlyScheduleUrl(2026, 13), RangeError);
  assert.throws(() => monthlyScheduleUrl(2026, 0), RangeError);
});
