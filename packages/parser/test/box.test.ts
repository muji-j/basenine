import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxParseError, extractPlayerId, inningsToOuts, parseBoxScore } from "../src/box.ts";

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
