import { test } from "node:test";
import assert from "node:assert/strict";
import { StarterParseError, parseAnnouncedStarters } from "../src/starter.ts";

/**
 * 실제 마크업 그대로의 픽스처(2026-08-15 실측 구조).
 * **발표된 경기와 미발표 경기가 섞여 있다** — 그게 이 페이지의 정상 상태다.
 */
const FIXTURE = `<h3><span>予告先発投手</span></h3>
<div class="contents"><div class="wrap">
<h4>8月16日の予告先発投手</h4>
<div class="unit_starter_position"><div class="starting_pit_wrapper_top">
<section class="starting_wrap_cl">
  <div class="unit cl_1">
    <div class="team_left">
    <img src="/img/common/logo/2026/logo_s_m.gif" alt="東京ヤクルトスワローズ" title="東京ヤクルトスワローズ" />
      </div>
    <div class="team_right">
    <img src="/img/common/logo/2026/logo_db_m.gif" alt="横浜DeNAベイスターズ" title="横浜DeNAベイスターズ" />
      </div>
  <div class="info">
        （神　宮）18:00          </div>
</div>
  <div class="unit cl_2">
      <a href="/bis/players/63165134.html">
     <img src="//p.npb.jp/players_photo/2026/180/d/017_63165134.jpg" class="photo_left" />
    </a>
      <div class="team_left">
    <img src="/img/common/logo/2026/logo_d_m.gif" alt="中日ドラゴンズ" title="中日ドラゴンズ" />
        <a href="/bis/players/63165134.html">
     <span>柳　裕也</span>
    </a>
      </div>
      <a href="/bis/players/71575132.html">
     <img src="//p.npb.jp/players_photo/2026/180/g/098_71575132.jpg" class="photo_right" />
    </a>
      <div class="team_right">
    <img src="/img/common/logo/2026/logo_g_m.gif" alt="読売ジャイアンツ" title="読売ジャイアンツ" />
        <a href="/bis/players/71575132.html">
     <span>小笠原　慎之介</span>
    </a>
      </div>
  <div class="info">
        （バンテリンドーム）13:30          </div>
</div>
</section>
<section class="starting_wrap_pl">
  <div class="unit pl_1">
      <a href="/bis/players/51255159.html">
     <img src="//p.npb.jp/players_photo/2026/180/l/021_51255159.jpg" class="photo_left" />
    </a>
      <div class="team_left">
    <img src="/img/common/logo/2026/logo_l_m.gif" alt="埼玉西武ライオンズ" title="埼玉西武ライオンズ" />
        <a href="/bis/players/51255159.html">
     <span>武内　夏暉</span>
    </a>
      </div>
      <div class="team_right">
    <img src="/img/common/logo/2026/logo_m_m.gif" alt="千葉ロッテマリーンズ" title="千葉ロッテマリーンズ" />
      </div>
  <div class="info">
        （ベルーナドーム）17:00          </div>
</div>
</section>
</div></div></div></div>`;

test("날짜를 읽는다 — 연도는 붙이지 않는다(페이지에 없다)", () => {
  assert.equal(parseAnnouncedStarters(FIXTURE).monthDay, "08-16");
});

test("경기 수는 발표 여부와 무관하다", () => {
  assert.equal(parseAnnouncedStarters(FIXTURE).games.length, 3);
});

test("발표된 경기는 선수 ID와 표기를 준다 — 이름으로 조인하지 않아도 된다(M10)", () => {
  const g = parseAnnouncedStarters(FIXTURE).games[1]!;
  assert.deepEqual(g.sides[0], {
    teamName: "中日ドラゴンズ",
    teamCodeHint: "d",
    playerId: "63165134",
    displayName: "柳　裕也",
  });
  assert.deepEqual(g.sides[1], {
    teamName: "読売ジャイアンツ",
    teamCodeHint: "g",
    playerId: "71575132",
    displayName: "小笠原　慎之介",
  });
});

test("⚠미발표는 실패가 아니라 상태다 — null이고 0이나 빈 문자열이 아니다(M11)", () => {
  const g = parseAnnouncedStarters(FIXTURE).games[0]!;
  assert.equal(g.sides[0].playerId, null);
  assert.equal(g.sides[0].displayName, null);
  assert.equal(g.sides[0].teamName, "東京ヤクルトスワローズ");
});

test("⚠한쪽만 발표된 경기도 짝이 어긋나지 않는다", () => {
  // 순서로 짝지으면 여기서 조용히 틀린다 — 실제로 6경기 중 2경기만 발표된 날이 있었다
  const g = parseAnnouncedStarters(FIXTURE).games[2]!;
  assert.equal(g.sides[0].displayName, "武内　夏暉");
  assert.equal(g.sides[0].teamCodeHint, "l");
  assert.equal(g.sides[1].displayName, null);
  assert.equal(g.sides[1].teamCodeHint, "m");
});

test("구장과 개시 시각을 나눠 준다", () => {
  const games = parseAnnouncedStarters(FIXTURE).games;
  assert.deepEqual(
    games.map((g) => [g.venue, g.startTime, g.league]),
    [
      ["神宮", "18:00", "cl"],
      ["バンテリンドーム", "13:30", "cl"],
      ["ベルーナドーム", "17:00", "pl"],
    ],
  );
});

test("선수 사진 URL은 결과에 넣지 않는다 — 쓰지 않기로 한 것이다", () => {
  const json = JSON.stringify(parseAnnouncedStarters(FIXTURE));
  assert.ok(!json.includes("players_photo"), "사진 URL이 결과에 섞여 나왔다");
});

test("⚠구조가 바뀌면 빈 목록이 아니라 예외다(M7)", () => {
  assert.throws(() => parseAnnouncedStarters("<html>なにもない</html>"), StarterParseError);
  // 제목은 있는데 경기 블록이 사라진 경우 — 매일 「未発表」가 되는 침묵 실패를 막는다
  assert.throws(
    () => parseAnnouncedStarters("<h4>8月16日の予告先発投手</h4>"),
    /경기 블록/,
  );
});

test("⚠로고가 없으면 던진다 — 팀을 모르는 채로 투수를 붙이지 않는다", () => {
  const broken = FIXTURE.replace(/<img src="\/img\/common\/logo\/2026\/logo_d_m\.gif"[^>]*\/>/, "");
  assert.throws(() => parseAnnouncedStarters(broken), StarterParseError);
});
