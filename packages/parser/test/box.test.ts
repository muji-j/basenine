import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BoxParseError,
  extractPlayerId,
  inningsToOuts,
  parseBoxScore,
  parseCompetitionLabel,
} from "../src/box.ts";

/**
 * 실제 npb.jp 마크업을 축약한 픽스처.
 * 컬럼 구성·표 id·팀 합계 행은 실측(2026-08-15) 그대로다.
 */
function fixture(opts: { battingHeader?: string; battingRows?: string; cancelled?: boolean } = {}): string {
  if (opts.cancelled) {
    return `<html><table id="tablefix_ls"><tr><td>1</td></tr></table><div class="state">中止</div></html>`;
  }
  const battingHeader =
    opts.battingHeader ??
    `<tr><th>&nbsp;</th><th>守備</th><th>選手</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>盗塁</th><th>1</th><th>2</th><th>3</th></tr>`;
  const battingRows =
    opts.battingRows ??
    `<tr><td>1</td><td>(遊)</td><td class="player"><a href="/bis/players/41845132.html">村林</a></td><td>2</td><td>1</td><td>1</td><td>2</td><td>0</td><td>左越本②</td><td>四 球</td><td>三 振</td></tr>
     <tr><td>&nbsp;</td><td>(打)</td><td class="player"><a href="/bis/players/11015138.html">代打太郎</a></td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>-</td><td>二ゴロ</td></tr>
     <tr><td>&nbsp;</td><td>&nbsp;</td><td>チーム計</td><td>3</td><td>1</td><td>1</td><td>2</td><td>0</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  const pitching = `<tr><th>&nbsp;</th><th>投手</th><th>投球数</th><th>打者</th><th>投球回</th><th>安打</th><th>本塁打</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr>
    <tr><td>○</td><td class="player"><a href="/bis/players/03005150.html">荘司</a></td><td>105</td><td>28</td><td><table class="table_inning"><tbody><tr><th>6</th><td>.2</td></tr></tbody></table></td><td>5</td><td>1</td><td>2</td><td>1</td><td>7</td><td>0</td><td>0</td><td>3</td><td>2</td></tr>
    <tr><td>&nbsp;</td><td>チーム計</td><td>105</td><td>28</td><td><table class="table_inning"><tbody><tr><th>6</th><td>.2</td></tr></tbody></table></td><td>5</td><td>1</td><td>2</td><td>1</td><td>7</td><td>0</td><td>0</td><td>3</td><td>2</td></tr>`;
  return `<html>
    <table id="tablefix_t_b">${battingHeader}${battingRows}</table>
    <table id="tablefix_t_p">${pitching}</table>
    <table id="tablefix_b_b">${battingHeader}${battingRows}</table>
    <table id="tablefix_b_p">${pitching}</table>
  </html>`;
}

test("타자 행과 타석 결과를 읽는다", () => {
  const box = parseBoxScore(fixture());
  assert.equal(box.status, "played");
  if (box.status !== "played") return;

  const first = box.away.batters[0];
  assert.ok(first);
  assert.equal(first.order, "1");
  assert.equal(first.name, "村林");
  assert.equal(first.position, "(遊)");
  assert.equal(first.ab, 2);
  assert.equal(first.rbi, 2);
  assert.deepEqual(
    first.plateAppearances.map((p) => p.outcome),
    ["homerun", "walk", "strikeout"],
  );
  assert.equal(first.plateAppearances[0]?.rbi, 2);
});

test("⚠M10: 선수를 NPB 공식 ID로 식별한다 — 이름이 아니라", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.equal(box.away.batters[0]?.playerId, "41845132");
  assert.equal(box.away.batters[1]?.playerId, "11015138");
  assert.equal(box.away.pitchers[0]?.playerId, "03005150");
});

test("⚠링크 없는 행(팀 합계)의 ID는 예외가 아니라 null이다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.equal(box.away.batters.at(-1)?.playerId, null);
});

test("선수 ID 추출", () => {
  assert.equal(extractPlayerId('<a href="/bis/players/41845132.html">村林</a>'), "41845132");
  assert.equal(extractPlayerId("<td>チーム計</td>"), null);
  assert.equal(extractPlayerId(undefined), null);
});

test("⚠교체 선수는 위 선수의 타순을 잇는다 — 빈 칸은 「없음」이 아니라 「위와 같음」이다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  // 2026-08-15 이전에는 여기서 null을 기대했다. **그게 틀렸다** —
  // 대타는 자기 타순이 없는 것이 아니라 바꿔 들어간 자리의 타순으로 친다.
  // null로 두면 실데이터의 34%(17,351행 중 5,975행)가 타순별 집계에서 사라진다.
  assert.equal(box.away.batters[1]?.name, "代打太郎");
  assert.equal(box.away.batters[1]?.order, "1", "대타가 1번 자리를 이어받아야 한다");
});

test("팀 합계 행에는 타순이 없다 — 팀은 타순을 갖지 않는다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  const total = box.away.batters.find((b) => b.isTeamTotal);
  assert.ok(total, "팀 합계 행이 없다");
  assert.equal(total.order, null, "합계 행이 마지막 타자의 타순을 이어받았다");
});

test("여러 번 교체돼도 각자 자기 자리의 타순을 잇는다", () => {
  const rows =
    `<tr><td>1</td><td>(遊)</td><td class="player"><a href="/bis/players/41845132.html">一番</a></td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>三 振</td><td>-</td><td>-</td></tr>
     <tr><td>&nbsp;</td><td>(打)</td><td class="player"><a href="/bis/players/11015138.html">一番の代打</a></td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>二ゴロ</td><td>-</td></tr>
     <tr><td>2</td><td>(中)</td><td class="player"><a href="/bis/players/11015139.html">二番</a></td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>-</td><td>三 振</td></tr>
     <tr><td>&nbsp;</td><td>(打)</td><td class="player"><a href="/bis/players/11015140.html">二番の代打</a></td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>-</td><td>二ゴロ</td></tr>`;
  const box = parseBoxScore(fixture({ battingRows: rows }));
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(
    box.away.batters.map((b) => [b.name, b.order]),
    [
      ["一番", "1"],
      ["一番の代打", "1"],
      ["二番", "2"],
      ["二番の代打", "2"],
    ],
  );
});

test("빈 칸(-)은 타석으로 세지 않는다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.equal(box.away.batters[1]?.plateAppearances.length, 1);
});

test("⚠팀 합계 행은 버리지 않고 표시만 한다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  const total = box.away.batters.at(-1);
  assert.ok(total);
  assert.equal(total.isTeamTotal, true);
  assert.equal(total.ab, 3, "합계 값 자체는 대조에 쓸 수 있게 남긴다");
  assert.equal(box.away.batters.filter((b) => !b.isTeamTotal).length, 2);
});

test("⚠컬럼 위치를 고정하지 않는다 — 연장전이면 이닝 컬럼이 늘어난다", () => {
  const extended =
    `<tr><th>&nbsp;</th><th>守備</th><th>選手</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>盗塁</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>`;
  const rows =
    `<tr><td>1</td><td>(遊)</td><td>村林</td><td>3</td><td>0</td><td>1</td><td>0</td><td>0</td><td>三 振</td><td>右前安</td><td>-</td><td>-</td><td>二ゴロ</td></tr>`;
  const box = parseBoxScore(fixture({ battingHeader: extended, battingRows: rows }));
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(
    box.away.batters[0]?.plateAppearances.map((p) => p.outcome),
    ["strikeout", "single", "fieldedOut"],
  );
});

test("⚠스페이서 빈 컬럼이 끼어도 어긋나지 않는다", () => {
  const spaced =
    `<tr><th>&nbsp;</th><th>守備</th><th>選手</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>盗塁</th><th>1</th><th>2</th><th>&nbsp;</th><th>3</th></tr>`;
  const rows =
    `<tr><td>1</td><td>(遊)</td><td>村林</td><td>2</td><td>0</td><td>1</td><td>0</td><td>0</td><td>右前安</td><td>三 振</td><td>&nbsp;</td><td>-</td></tr>`;
  const box = parseBoxScore(fixture({ battingHeader: spaced, battingRows: rows }));
  if (box.status !== "played") return assert.fail("played여야 한다");
  assert.deepEqual(
    box.away.batters[0]?.plateAppearances.map((p) => p.outcome),
    ["single", "strikeout"],
  );
});

test("투수 행을 읽고 투구회를 아웃으로 환산한다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  const p = box.away.pitchers[0];
  assert.ok(p);
  assert.equal(p.decision, "○");
  assert.equal(p.name, "荘司");
  assert.equal(p.outs, 20, "6.2이닝 = 20아웃");
  assert.equal(p.strikeouts, 7);
  assert.equal(p.earnedRuns, 2);
});

test("⚠投球回 셀의 중첩 테이블 때문에 뒤 컬럼이 밀리지 않는다", () => {
  // `<td><table class="table_inning"><tr><th>6</th><td>.2</td></tr></table></td>` 구조가
  // 셀 추출을 깨뜨려, 실제로 투수 성적이 전부 한 칸씩 밀려 null이 된 적이 있다.
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  const p = box.away.pitchers[0];
  assert.ok(p);
  assert.equal(p.outs, 20, "6.2이닝 = 20아웃");
  assert.equal(p.hits, 5, "投球回 뒤의 安打가 제자리에 있어야 한다");
  assert.equal(p.homeRuns, 1);
  assert.equal(p.walks, 2);
  assert.equal(p.strikeouts, 7);
  assert.equal(p.earnedRuns, 2, "맨 끝 컬럼까지 도달해야 한다");
});

test("⚠투수표에도 팀 합계 행이 있다 — 함께 더하면 정확히 2배가 된다", () => {
  const box = parseBoxScore(fixture());
  if (box.status !== "played") return assert.fail("played여야 한다");
  const total = box.away.pitchers.at(-1);
  assert.ok(total);
  assert.equal(total.isTeamTotal, true);
  assert.equal(box.away.pitchers[0]?.isTeamTotal, false);
  assert.equal(box.away.pitchers.filter((p) => !p.isTeamTotal).length, 1);
});

test("이닝 → 아웃 환산", () => {
  assert.equal(inningsToOuts("7"), 21);
  assert.equal(inningsToOuts("6.1"), 19);
  assert.equal(inningsToOuts("6.2"), 20);
  assert.equal(inningsToOuts("0"), 0);
  assert.equal(inningsToOuts(""), null);
  assert.equal(inningsToOuts("-"), null);
  assert.equal(inningsToOuts("6.3"), null, "3분의 3은 표기되지 않는다");
});

test("⚠중지 경기는 오류가 아니라 미성립이다", () => {
  const box = parseBoxScore(fixture({ cancelled: true }));
  assert.equal(box.status, "notPlayed");
  if (box.status === "notPlayed") assert.equal(box.reason, "中止");
});

test("⚠표가 없는데 중지 표기도 없으면 예외 — 구조 변경을 놓치지 않는다", () => {
  assert.throws(() => parseBoxScore("<html><div>新レイアウト</div></html>"), BoxParseError);
});

test("⚠헤더에서 필수 열을 못 찾으면 예외 — 빈 결과로 넘어가지 않는다", () => {
  const broken = `<tr><th>&nbsp;</th><th>守備</th><th>選手</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>1</th></tr>`;
  assert.throws(
    () => parseBoxScore(fixture({ battingHeader: broken, battingRows: "" })),
    /盗塁/,
    "盗塁 열이 사라지면 타석 셀의 시작 위치를 알 수 없다",
  );
});

test("⚠ノーゲームは表があっても成立しない — 부분 표가 남아 시즌 성적에 섞였다", () => {
  // 우천으로 2회에 끝난 경기. npb.jp는 **그때까지의 표를 그대로 남긴다**
  const html = fixture().replace(
    "<html>",
    '<html><div id="game_stats"><div class="line-score"><p class="game_info">【雨天のためノーゲーム】</p></div></div>',
  );
  const box = parseBoxScore(html);
  assert.equal(box.status, "notPlayed", "표가 있다고 실시로 판정했다");
  if (box.status === "notPlayed") assert.equal(box.reason, "ノーゲーム");
});

test("⚠남의 경기가 중지여도 이 경기는 실시다 — 페이지에 다른 경기 스코어가 함께 실린다", () => {
  // 경기 자신의 game_info 밖에 있는 중지 표기는 무시해야 한다
  const html = fixture().replace("<html>", '<html><div class="state">中止</div><div class="score">ノーゲーム</div>');
  const box = parseBoxScore(html);
  assert.equal(box.status, "played", "남의 경기 표기에 끌려갔다");
});

test("サスペンデッド는 무효가 아니다 — 이어서 하는 경기라 기록이 살아남는다", () => {
  const html = fixture().replace(
    "<html>",
    '<html><div id="game_stats"><div class="line-score"><p class="game_info">【サスペンデッドゲーム】</p></div></div>',
  );
  assert.equal(parseBoxScore(html).status, "played");
});

// ── 대회 구분 표기 ───────────────────────────────────────────────────────

/**
 * ⚠**표기는 `#game_stats > .game_tit > h3`에 있고 그 경기 하나만 설명한다.**
 * 경기 페이지에는 그날 다른 경기의 스코어 박스가 함께 실려 있으므로,
 * 페이지 전체에서 `【…】`를 찾으면 **남의 경기 표기**를 집는다.
 */
function titled(label: string, extra = ""): string {
  return `${extra}
<div class="wrap" id="game_stats">
  <div class="game_tit">
    <time>2025年10月11日（土）</time>
    <span class="place">横　浜</span>
    <h3>【${label}】 横浜DeNAベイスターズ vs 読売ジャイアンツ
    第1戦    </h3>
  </div>
  <p class="game_info">【試合終了】</p>
</div>`;
}

test("경기 표제에서 대회 표기를 읽는다", () => {
  assert.equal(parseCompetitionLabel(titled("CS ファーストステージ")), "CS ファーストステージ");
  assert.equal(parseCompetitionLabel(titled("JERA セ・リーグ公式戦")), "JERA セ・リーグ公式戦");
});

test("⚠같은 페이지의 다른 경기 표기를 집지 않는다 — 조용히 틀린 구분을 만드는 실수다", () => {
  // 페이지 상단의 「오늘의 경기」 목록에 다른 경기의 표기가 먼저 나오는 상황
  const other = `<div class="score_box"><h4>【SMBC日本シリーズ】 別の試合</h4></div>`;
  assert.equal(parseCompetitionLabel(titled("JERA セ・リーグ公式戦", other)), "JERA セ・リーグ公式戦");
});

test("⚠경기 상태(【試合終了】)를 대회 표기로 착각하지 않는다", () => {
  assert.equal(parseCompetitionLabel(titled("パーソル パ・リーグ公式戦")), "パーソル パ・リーグ公式戦");
});

test("표기가 없으면 null이다 — 호출자가 「구조 변경」으로 다룰 수 있어야 한다(M7)", () => {
  assert.equal(parseCompetitionLabel("<div>표제가 없는 문서</div>"), null);
  assert.equal(parseCompetitionLabel(`<div class="game_tit"><h3>표기 없는 표제</h3></div>`), null);
});

/**
 * ⚠**`5+`는 「5이닝을 던지고 다음 이닝에서 아웃 없이 강판」이다.**
 * NPB 박스스코어의 표기이고 아웃 수로는 15다.
 *
 * 실측(2026-08-16 외부 대조): 이 표기를 못 읽어 **투수 39명의 시즌 투구회가 모자랐다.**
 * 篠木는 67이닝이어야 하는데 57이닝이었고 방어율이 4.57 대신 5.37로 나왔다.
 * 검산: 그 경기의 팀 합계가 27아웃인데 다른 투수들이 12아웃이므로 篠木는 15아웃이다.
 */
test("⚠「5+」를 15아웃으로 읽는다 — 못 읽으면 그 등판이 통째로 사라진다", () => {
  assert.equal(inningsToOuts("5+"), 15);
  assert.equal(inningsToOuts("0+"), 0);
  // 분수와 함께 와도 아웃은 분수까지만 센다
  assert.equal(inningsToOuts("5.1+"), 16);
});

test("보통의 이닝 표기", () => {
  assert.equal(inningsToOuts("6"), 18);
  assert.equal(inningsToOuts("6.2"), 20);
  assert.equal(inningsToOuts("0.1"), 1);
});

test("⚠읽을 수 없으면 null이다 — 0을 돌려주면 「던지지 않았다」가 된다(M7)", () => {
  assert.equal(inningsToOuts(""), null);
  assert.equal(inningsToOuts("-"), null);
  assert.equal(inningsToOuts("5.3"), null, "3분의 3은 없다");
  assert.equal(inningsToOuts("5 1/3"), null);
  assert.equal(inningsToOuts("あ"), null);
});

/**
 * 구형(2016~2018) 박스스코어.
 *
 * ⚠**이 분기가 없으면 그 시즌들이 「타격표가 없다」로 예외를 던진다**(2026-08-17 실측).
 * 백필에서 예외를 삼키는 코드가 하나라도 있으면 **3시즌이 조용히 0건**으로 들어간다 —
 * M7이 잡으라고 하는 실패 모드 그 자체다.
 *
 * 구형은 표에 `id` 가 없고 `<div class="… table_batter">` 로 감싸 **순서로만** 구별한다.
 * 열 이름도 다르다 — 신형 `選手` 대 구형 `打者`.
 */
const LEGACY_BOX = `
<div class="wrap"><section><h4>広島東洋カープ</h4>
<div class="scroll_wrapper table_score table_batter"><table>
<thead><tr><th>&nbsp;</th><th>守備</th><th>打者</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>盗塁</th></tr></thead>
<tbody>
<tr><td>1</td><td>(遊)</td><td><a href="/bis/players/61965139.html">田中</a></td><td>6</td><td>2</td><td>2</td><td>0</td><td>0</td></tr>
<tr><td>&nbsp;</td><td>計</td><td>&nbsp;</td><td>6</td><td>2</td><td>2</td><td>0</td><td>0</td></tr>
</tbody></table></div>
<div class="scroll_wrapper table_score table_pitcher"><table>
<thead><tr><th>&nbsp;</th><th>投手</th><th>投球数</th><th>打者</th><th>投球回</th><th>安打</th><th>本塁打</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr></thead>
<tbody>
<tr><td>○</td><td><a href="/bis/players/53355130.html">ジョンソン</a></td><td>120</td><td>28</td><td>7</td><td>5</td><td>0</td><td>2</td><td>0</td><td>8</td><td>0</td><td>0</td><td>1</td><td>1</td></tr>
</tbody></table></div>
</section></div>
<div class="wrap"><section><h4>東京ヤクルトスワローズ</h4>
<div class="scroll_wrapper table_score table_batter"><table>
<thead><tr><th>&nbsp;</th><th>守備</th><th>打者</th><th>打数</th><th>得点</th><th>安打</th><th>打点</th><th>盗塁</th></tr></thead>
<tbody>
<tr><td>1</td><td>(中)</td><td><a href="/bis/players/11115131.html">山田</a></td><td>4</td><td>1</td><td>1</td><td>1</td><td>1</td></tr>
</tbody></table></div>
<div class="scroll_wrapper table_score table_pitcher"><table>
<thead><tr><th>&nbsp;</th><th>投手</th><th>投球数</th><th>打者</th><th>投球回</th><th>安打</th><th>本塁打</th><th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr></thead>
<tbody>
<tr><td>●</td><td><a href="/bis/players/22225132.html">小川</a></td><td>98</td><td>26</td><td>6</td><td>7</td><td>1</td><td>1</td><td>0</td><td>5</td><td>0</td><td>0</td><td>3</td><td>3</td></tr>
</tbody></table></div>
</section></div>`;

test("⚠구형 박스도 읽는다 — 안 읽으면 그 시즌이 조용히 0건이 된다(M7)", () => {
  const b = parseBoxScore(LEGACY_BOX);
  assert.equal(b.status, "played", "구형을 「중지」로 읽었다");
  if (b.status !== "played") return;
  // ⚠**순서가 뜻을 갖는다** — 원정 타자 → 원정 투수 → 홈 타자 → 홈 투수
  assert.equal(b.away.batters[0]?.name, "田中", "원정 타자를 못 읽었다");
  assert.equal(b.home.batters[0]?.name, "山田", "홈 타자가 원정 자리에 있다");
  assert.equal(b.away.pitchers[0]?.name, "ジョンソン");
  assert.equal(b.home.pitchers[0]?.name, "小川");
  // ⚠**선수 ID가 살아 있어야 한다**(M10) — 이름으로 조인하면 동명이인이 섞인다
  assert.equal(b.away.batters[0]?.playerId, "61965139");
  assert.equal(b.away.pitchers[0]?.playerId, "53355130");
});

/** ⚠**열 이름이 다르다** — 신형 `選手` 대 구형 `打者`. 하나를 못 맞히면 시즌이 통째로 예외다 */
test("구형의 打者 열을 선수명으로 읽는다", () => {
  const b = parseBoxScore(LEGACY_BOX);
  if (b.status !== "played") throw new Error("played 가 아니다");
  assert.equal(b.away.batters[0]?.ab, 6, "열 위치가 밀렸다");
  assert.equal(b.away.batters[0]?.hits, 2);
});

/**
 * ⚠**순서로 구별하므로 개수를 확인한다.** 3개만 있는데 조용히 읽으면
 * 한 팀의 투수 성적이 통째로 사라진다.
 */
test("⚠구형 표가 4개가 아니면 멈춘다 — 조용히 3개만 읽지 않는다", () => {
  const cut = LEGACY_BOX.slice(0, LEGACY_BOX.lastIndexOf(`<div class="scroll_wrapper table_score table_pitcher">`));
  assert.throws(() => parseBoxScore(cut), /구형 표가 4개가 아니다/);
});

/**
 * ⚠**순서만 믿지 않는다.** 구형은 `id` 가 없어 순서로 구별하는데,
 * 타자 자리에 투수표가 오면 **열이 통째로 어긋난 값**이 그대로 저장된다 —
 * 예외가 아니라 「그럴듯한 틀린 수」가 되는 쪽이 훨씬 나쁘다.
 */
test("⚠구형 표의 종류가 순서와 어긋나면 멈춘다 — 그럴듯한 틀린 수를 만들지 않는다", () => {
  // 원정 타자 자리에 투수표를 놓는다(클래스만 바꿔치기)
  const swapped = LEGACY_BOX.replace(
    `<div class="scroll_wrapper table_score table_batter">`,
    `<div class="scroll_wrapper table_score table_pitcher">`,
  );
  assert.throws(() => parseBoxScore(swapped), /구형 표의 순서가 다르다/);
});
