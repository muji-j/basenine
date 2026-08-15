import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLDS, bootstrapFor, renderPlayerPage } from "../src/player-page.ts";
import { battingBlock, context, pitchingBlock, playerPage, rankingPanel } from "./fixtures.ts";

test("이름과 팀이 제목·배면·본문에 들어간다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /<title>佐藤 — 阪神タイガース 2026年<\/title>/);
  assert.match(out, /class="vt">阪神タイガース　佐藤</);
  assert.match(out, /class="nm">佐藤</);
});

test("비율에는 반드시 분모가 붙는다(M2)", () => {
  const out = renderPlayerPage(playerPage(), context());
  // 값 바로 뒤에 분모 span이 오는지 — 떨어져 있으면 M2 위반이다
  for (const [value, den] of [
    [".317", "382打数"],
    [".403", "442打席"],
    [".620", "382打数"],
  ]) {
    assert.ok(
      out.includes(`${value}<span class="den">${den}</span>`),
      `${value} 옆에 ${den}가 붙어 있지 않다`,
    );
  }
});

test("분모 없는 비율이 화면에 없다 — dd 안의 소수는 전부 den을 동반한다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const dds = [...out.matchAll(/<dd>(.*?)<\/dd>/g)].map((m) => m[1] ?? "");
  const bare = dds.filter((d) => /^-?[\d.]*\.\d/.test(d) && !d.includes('class="den"'));
  assert.deepEqual(bare, [], `분모 없는 비율이 남아 있다: ${bare.join(" / ")}`);
});

test("규정 도달 여부를 분모와 함께 말한다(M3)", () => {
  const hit = renderPlayerPage(playerPage(), context());
  assert.match(hit, /規定到達（442打席 \/ 332打席）/);

  const miss = renderPlayerPage(
    playerPage({ batting: battingBlock({ qualified: false, ranks: {} }) }),
    context(),
  );
  assert.match(miss, /規定未満（442打席 \/ 332打席）— 率の指標には順位がつきません/);
});

test("자격 미달이면 순위 배지가 없다", () => {
  const miss = renderPlayerPage(
    playerPage({ batting: battingBlock({ qualified: false, ranks: {} }) }),
    context(),
  );
  assert.ok(!miss.includes('class="rank"'), "순위 없는 선수에게 배지가 붙었다");
});

test("SRC는 무엇을 재고 무엇을 안 재는지 화면에서 말한다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /WARではなく、WARと比較できません/);
  assert.match(out, /守備・走塁・ポジション補正は含みません/);
});

test("SRC 계산에서 빠진 타석은 숨기지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({ batting: battingBlock({ src: { src: 40, pa: 440, skipped: 7, srcPer600: 54 } }) }),
    context(),
  );
  assert.match(out, /7打席あり、計算から外しています/);
});

test("스플릿은 분류 불가 타석 수를 표시한다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /分類できない打席が12あります/);
});

test("표본이 얇은 스플릿은 칠이 약해진다 — 값은 그대로 남는다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /opacity:\.35/);
  assert.ok(out.includes("20打席"), "얇은 구간의 값과 분모는 지우지 않는다");
});

function matchupSection(out: string): string {
  return /<section class="block"[^>]*id="b-matchup">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
}

test("대전 성적에는 순위 열이 없다 — 10타석짜리를 순서로 보여주지 않는다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.ok(section.length > 0, "대전 성적 블록이 없다");
  const head = /<thead>[\s\S]*?<\/thead>/.exec(section)?.[0] ?? "";
  assert.ok(!head.includes("順位"), "대전 성적 표에 순위 열이 생겼다");
  assert.match(section, /既定は対戦数の多い順/);
});

test("대전 성적은 이름으로 좁힐 수 있고 상대 페이지로 이어진다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /id="matchupFilter"/);
  assert.match(section, /<a href="91045111\.html">山本<\/a>/);
  assert.match(section, /全2件/);
});

test("정렬용 값이 행에 실린다 — 클라이언트가 다시 계산하지 않는다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /data-pa="14"[^>]*data-hr="27"[^>]*data-avg="0\.3330"/);
});

test("타율순 정렬에 표본 하한이 있다는 것을 탭 이름이 말한다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /打率順（10打席以上）/);
  assert.match(section, /5打席3安打を先頭に置かないため/);
});

test("투수 페이지의 대전 상대는 타자다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  assert.match(matchupSection(out), /<th class="l">打者<\/th>/);
  assert.match(matchupSection(out), /打者名でしぼる/);
});

test("임계값을 코드 밖에서 확인할 수 있다", () => {
  assert.deepEqual(THRESHOLDS, { situationPa: 10, matchupPa: 10 });
});

test("본인 행은 강조되어 그려진다", () => {
  const rows = rankingPanel().rows.map((r, i) => (i === 0 ? { ...r, isMe: true } : r));
  const out = renderPlayerPage(playerPage({ ranking: [rankingPanel({ rows })] }), context());
  assert.equal(out.match(/<tr class="me">/g)?.length, 1);
});

test("JS 없이도 標準 프리셋은 보이고 나머지는 접혀 있다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /<section class="block" id="b-standard">/);
  assert.match(out, /<section class="block" hidden id="b-scorebook">/);
});

test("블록 재배치 기준점이 마지막 블록 뒤·내비 앞에 있다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const end = out.indexOf('id="blocksEnd"');
  assert.ok(end > out.lastIndexOf('class="block"'), "기준점이 블록보다 앞에 있다");
  assert.ok(end < out.indexOf('aria-label="ほかの選手"'), "기준점이 내비보다 뒤에 있다");
});

test("클라이언트에 실리는 카탈로그가 서버가 그린 블록과 같다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const boot = bootstrapFor("batter");
  const ids = [...boot.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]!);
  for (const id of ids) {
    assert.ok(out.includes(`id="b-${id}"`), `카탈로그에 있는 ${id} 블록이 화면에 없다`);
  }
});

test("투수 페이지에는 타자 블록이 없다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  assert.ok(!out.includes('id="b-splits"'));
  assert.ok(!out.includes('id="b-situation"'));
});

test("투수는 기본 성적이 투수 항목이 된다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  const standard = /<section class="block"[^>]*id="b-standard">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.match(standard, /防御率/);
  assert.match(standard, /<dt>投球回<\/dt><dd>100<\/dd>/);
  assert.ok(!standard.includes("打率"), "투수의 기본 성적에 타율 항목이 남았다");
  assert.match(standard, /規定到達（100回 \/ 100回）/);
});

test("투수 비율의 분모는 이닝으로 쓴다 — 아웃 카운트를 「投球回」라고 쓰지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  // outs=300 → 100이닝. `300投球回`라고 쓰면 분모가 3배로 부풀어 보인다
  assert.ok(out.includes('<span class="den">100回</span>'), "이닝 표기가 아니다");
  assert.ok(!out.includes("300投球回"), "아웃 카운트를 이닝처럼 표기했다");
});

test("자격 미달이어도 누계 지표에는 순위가 붙는다 — 화면 문구가 그 사실과 어긋나지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({ batting: battingBlock({ qualified: false, ranks: { hr: 2 } }) }),
    context(),
  );
  assert.match(out, /率の指標には順位がつきません/);
  assert.ok(out.includes('<span class="rank">2位</span>'), "누계 지표의 순위가 사라졌다");
});

test("성적이 아예 없으면 빈 상태를 말한다 — 0으로 채우지 않는다(M11)", () => {
  const out = renderPlayerPage(
    playerPage({ batting: null, splits: [], scorebook: [], situation: [], matchups: [], ranking: [] }),
    context(),
  );
  assert.match(out, /成績がありません/);
  assert.match(out, /打席記録がありません/);
  assert.match(out, /対戦記録がありません/);
});
