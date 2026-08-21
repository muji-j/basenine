import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLDS, bootstrapFor, renderPlayerPage, seasonSurelyOver } from "../src/player-page.ts";
// ⚠**경로를 손으로 적지 않는다**(M1) — 화면과 시험이 같은 상수를 봐야 한다
import { ROSTER_PATH, freshness } from "../src/layout.ts";
import { NO_VALUE } from "../src/format.ts";
// ⚠**정의의 정본은 용어집이다**(M1) — 시험이 문장을 다시 쓰지 않고 거기 있는 것을 본다
import { termOf } from "../src/glossary.ts";
import {
  battingBlock,
  context,
  EMPTY_MARK,
  LEAGUE_HOME,
  mixedPitchingBlock,
  pitcherMark,
  pitchingBlock,
  playerPage,
  rankingPanel,
} from "./fixtures.ts";

test("이름과 팀이 제목·배면·본문에 들어간다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /<title>佐藤 — 阪神タイガース 2026年<\/title>/);
  assert.match(out, /class="vt">阪神タイガース　佐藤</);
  assert.match(out, /class="nm">佐藤</);
});

/**
 * ⚠**선수 페이지만 「지금 어디에 있는가」가 통째로 없었다**(2026-08-19 실측: dist 6,207장).
 *
 * `nav: "player"` 였는데 내비에 `選手` 항목이 없어서 **어느 링크에도 표시가 안 붙었다.**
 * `topbar-consistency` 는 dist 최상위 11장만 봐서 이걸 못 봤다 — 재귀시키자 드러났다.
 * ⚠**`page` 는 아니다.** 이 화면은 選手一覧 그 자체가 아니라 그 구획 안의 다른 문서다
 * (경기 상세·날짜별이 `試合` 에서 쓰는 것과 같은 어법).
 */
test("⚠헤더가 「지금 여기」를 말한다 — 선수 페이지만 표시가 없었다", () => {
  const nav = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(renderPlayerPage(playerPage(), context()))![0];
  // ⚠상수를 정규식에 넣을 때는 `.` 을 죽인다 — 안 그러면 `playersXhtml` 도 맞는다
  const item = new RegExp(`<a\\s[^>]*href="[^"]*${ROSTER_PATH.replace(/\./g, "\\.")}"[^>]*>`).exec(nav);
  assert.notEqual(item, null, `내비에 ${ROSTER_PATH} 링크가 없다`);
  assert.match(item![0], /aria-current="true"/, `현재 구획 표시가 없다: ${item![0]}`);
  assert.ok(
    !nav.includes('aria-current="page"'),
    "선수 페이지는 選手一覧 그 자체가 아니다 — 다른 문서를 「지금 이 문서」라고 말했다",
  );
});

test("비율에는 반드시 분모가 붙는다(M2)", () => {
  const out = renderPlayerPage(playerPage(), context());
  // 값 바로 뒤에 분모 span이 오는지 — 떨어져 있으면 M2 위반이다
  for (const [value, den] of [
    [".317", "382打数"],
    [".403", "442出塁機会"],
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
  // ⚠**`dd`에 클래스가 붙어도 잡혀야 한다.** 전에 `<dd>`만 찾다가 클래스가 붙은 순간
  // 매치 0건이 되어 이 테스트가 조용히 공회전했다. 분모를 세는 것이 이 테스트의 일이다
  const dds = [...out.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((m) => m[1] ?? "");
  assert.ok(dds.length > 10, `dd를 찾지 못했다(${dds.length}건) — 이 테스트가 공회전하고 있다`);
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

test("대전 성적에는 순위 열이 없다 — 매긴 순위가 아니라 정렬이다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.ok(section.length > 0, "대전 성적 블록이 없다");
  const head = /<thead>[\s\S]*?<\/thead>/.exec(section)?.[0] ?? "";
  assert.ok(!head.includes("順位"), "대전 성적 표에 순위 열이 생겼다");
  assert.match(section, /見出しを押すと並べ替わります/);
});

test("모든 열의 머리가 정렬 버튼이다 — 클릭만 되고 초점이 안 가는 머리를 만들지 않는다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  const keys = [...section.matchAll(/class="sortable" type="button" data-sortkey="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["name", "team", "pa", "ab", "h", "hr", "bb", "so", "rbi", "avg"]);
  const heads = [...section.matchAll(/<th[\s>]/g)].length;
  assert.equal(heads, keys.length, "정렬 버튼이 없는 머리가 있다");
});

test("행이 정렬에 필요한 값을 전부 싣는다 — 클라이언트가 다시 계산하지 않는다(M1)", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  const row = /<tr class="thin"[\s\S]*?<\/tr>/.exec(section)?.[0] ?? "";
  for (const attr of ["data-name", "data-team", "data-pa", "data-ab", "data-h", "data-hr", "data-bb", "data-so", "data-rbi"]) {
    assert.ok(row.includes(attr), `${attr}가 없다`);
  }
});

test("초기 정렬은 打席 내림차순이고 aria-sort가 그것만 가리킨다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.equal([...section.matchAll(/aria-sort="descending"/g)].length, 1);
  assert.match(section, /aria-sort="descending"[\s\S]{0,120}data-sortkey="pa"/);
});

test("최소 타석은 탭이 아니라 버튼 묶음이다 — 여는 패널이 없다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /role="group" data-tabgroup="matchupMin"/);
  assert.ok(!section.includes('data-tabgroup="matchupMin" aria-label="表示の切り替え"'));
  assert.match(section, /data-tab="1"[^>]*aria-pressed="true"/);
  assert.match(section, /10打席以上/);
});

test("정렬 상태를 말하는 자리가 있다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /id="matchupStatus" role="status"/);
});

test("대전 성적은 이름으로 좁힐 수 있고 상대 페이지로 이어진다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /id="matchupFilter"/);
  assert.match(section, /<a href="91045111\.html">山本<\/a>/);
  assert.match(section, /全2件/);
});

test("구단으로 좁힐 수 있다 — 선택지는 **실제로 대전한 구단만**", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  const opts = [...section.matchAll(/<option value="(\w*)">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(opts, [
    ["", "すべての球団"],
    ["g", "巨人（1）"],
    ["b", "オリックス（1）"],
  ]);
});

test("구단 열은 표기로 정렬하고 좁히기는 코드로 한다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /data-team="オリックス" data-teamcode="b"/);
  assert.match(section, /<td class="l">オリックス<\/td>/);
});

test("정렬용 값이 행에 실린다 — 클라이언트가 다시 계산하지 않는다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  assert.match(section, /data-pa="14"[^>]*data-hr="27"[^>]*data-avg="0\.3330"/);
});

test("⚠율로 정렬할 수 있게 하되, 그것이 순위가 아님을 화면이 말한다", () => {
  const section = matchupSection(renderPlayerPage(playerPage(), context()));
  // 타율 열도 정렬 가능하다 — 막지 않는다
  assert.match(section, /data-sortkey="avg"[^>]*data-sortrate="1"/);
  // 대신 표본이 작다는 사실을 말한다
  assert.match(section, /率で並べると少ない打席が先頭に来ます/);
  assert.match(section, /10打席未満は薄く表示/);
});

test("투수 페이지의 대전 상대는 타자다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  assert.match(matchupSection(out), /data-sortkey="name"[^>]*>打者</);
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

test("투수 페이지에 득점기대치는 없다 — 타석에 선 쪽의 이야기다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  assert.ok(!out.includes('id="b-situation"'));
  assert.ok(out.includes('id="b-splits"'), "투수 스플릿은 있어야 한다");
});

test("⚠투수 스플릿은 「被成績」이라고 이름을 바꾼다 — 같은 숫자가 뜻이 반대다", () => {
  const pitcherSplits = playerPage().splits.map((a) => ({
    ...a,
    allowed: true,
    rows: a.rows.map((r) => ({ ...r, label: r.label.replace("投手", "打者") })),
  }));
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      position: "投手",
      batting: null,
      pitching: pitchingBlock(),
      splits: pitcherSplits,
    }),
    context(),
  );
  const section = /<section class="block"[^>]*id="b-splits">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.match(section, /スプリット（被成績）/);
  assert.match(section, /棒は被OPS（短いほど良い）/);
  assert.match(section, /被打率 \/ 被出塁率 \/ 被長打率/);
  assert.match(section, /対右打者/);
  assert.ok(!section.includes("対右投手"), "투수 페이지에 「対右投手」가 남았다");
});

test("타자 스플릿의 문구는 그대로다", () => {
  const section =
    /<section class="block"[^>]*id="b-splits">[\s\S]*?<\/section>/.exec(
      renderPlayerPage(playerPage(), context()),
    )?.[0] ?? "";
  assert.match(section, />スプリット</);
  assert.match(section, /棒はOPS。/);
  assert.ok(!section.includes("被打率"));
});

test("투수는 기본 성적이 투수 항목이 된다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  const standard = /<section class="block"[^>]*id="b-standard">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.match(standard, /防御率/);
  // 라벨은 설명 버튼이 되었지만 값의 자리는 그대로여야 한다
  assert.match(standard, /data-term="innings"[^>]*>投球回<\/button><\/dt><dd class="v">100<\/dd>/);
  assert.ok(!standard.includes(">打率<"), "투수의 기본 성적에 타율 항목이 남았다");
  // ⚠기준의 출처를 화면이 말한다 — 선발은 NPB 공식, 구원은 우리 기준
  assert.match(standard, /規定投球回（NPB公式）到達（100回 \/ 100回）/);
});

test("⚠구원 투수에게는 자체 기준임을 밝힌다 — 공식과 같은 얼굴로 내보내지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      position: "投手",
      batting: null,
      pitching: pitchingBlock({ role: "reliever", starts: 0, needOuts: 108 }),
    }),
    context(),
  );
  assert.match(out, /当サイトの救援基準（規定投球回の3分の1）/);
  assert.ok(!out.includes("NPB公式）到達"), "구원에 공식 기준 문구가 붙었다");
  // 범례도 구원 분포를 근거로 든다
  assert.match(out, /20回以上の救援投手90人の分布/);
});

test("역할과 그 근거를 화면이 말한다 — 색과 순위가 무엇과 비교한 것인지 알 수 있어야 한다", () => {
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      position: "投手",
      batting: null,
      pitching: mixedPitchingBlock(),
    }),
    context(),
  );
  assert.match(out, /この投手は救援として扱っています（先発5試合 \/ 救援21試合/);
  assert.match(out, /投球回の多いほうを役割としています/);
});

test("⚠선발과 구원을 겸하면 나눠서 보여준다 — 하나의 방어율은 어느 쪽 것인지 알 수 없다", () => {
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      position: "投手",
      batting: null,
      pitching: mixedPitchingBlock(),
    }),
    context(),
  );
  const split = /<section class="block"[^>]*id="b-rolesplit">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.ok(split.length > 0, "先発・救援別 블록이 없다");
  assert.match(split, /先発として/);
  assert.match(split, /救援として/);
  // ⚠같은 3.20이 양쪽에서 다른 색이 된다 — 이 블록의 존재 이유가 그것이다
  assert.match(split, /g-average[^]*3\.20/, "선발 3.20이 ふつう가 아니다");
  assert.match(split, /g-bad[^]*3\.20/, "구원 3.20이 悪い가 아니다");
});

test("한쪽 역할만 뛴 투수에게는 나눌 것이 없다고 말한다 — 0을 성적으로 그리지 않는다(M11)", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock() }),
    context(),
  );
  const split = /<section class="block"[^>]*id="b-rolesplit">[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.match(split, /救援登板がありません。/);
  assert.ok(!split.includes("救援として"), "0등판을 성적표로 그렸다");
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

test("紋을 눌러 열 수 있고, 다섯 항목의 판독부가 미리 그려져 있다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /<button class="mark markbtn"[^>]*id="markBtn"[^>]*aria-expanded="false"/);
  assert.match(out, /aria-controls="markPanel"/);
  // ⚠판독부는 **서버가 다섯 벌 다 그린다.** 클라이언트가 글자를 만들면 용어집과 두 벌이 된다
  const reads = [...out.matchAll(/<div class="mkread" data-axisread="(\d)"/g)].map((m) => m[1]);
  assert.deepEqual(reads, ["0", "1", "2", "3", "4"]);
  // 첫 벌만 열려 있다 — 스크립트가 없어도 하나는 읽힌다
  assert.equal([...out.matchAll(/<div class="mkread" data-axisread="\d" hidden>/g)].length, 4);
});

test("⚠紋의 값에도 분모가 붙는다(M2) — 축마다 분모가 다르다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const panel = /<section class="markpanel"[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.ok(panel.length > 0, "紋 패널이 없다");
  assert.ok(panel.includes(`.317<span class="den">382打数</span>`), "打率에 打数가 안 붙었다");
  assert.ok(panel.includes(`.403<span class="den">442出塁機会</span>`), "出塁에 出塁機会가 안 붙었다");
  // 값이 나오는 자리 전부에 분모가 따라온다
  const values = [...panel.matchAll(/<em>([^<]*)<span class="den">([^<]*)<\/span>/g)];
  assert.equal(values.length, 5);
  for (const v of values) assert.ok((v[2] ?? "").length > 0, `${v[1]}에 분모가 없다`);
});

test("紋의 설명은 용어집에서 온다 — 여기서 새로 쓰면 두 벌이 된다(M1)", async () => {
  const { termOf } = await import("../src/glossary.ts");
  const out = renderPlayerPage(playerPage(), context());
  assert.ok(out.includes(termOf("avg")!.short), "打率 설명이 용어집 문장과 다르다");
  assert.ok(out.includes(termOf("obp")!.short), "出塁 설명이 용어집 문장과 다르다");
});

test("⚠투수의 뒤집힌 축은 그 사실을 화면에서 말한다 — 안 말하면 도형을 반대로 읽는다", () => {
  const out = renderPlayerPage(
    playerPage({ role: "pitcher", position: "投手", batting: null, pitching: pitchingBlock(), mark: pitcherMark() }),
    context(),
  );
  const panel = /<section class="markpanel"[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
  assert.match(panel, /mr-note/);
  assert.match(panel, /外側ほど良くなるよう反転/);
  // 방향이 그대로인 축(奪三振)에는 붙지 않는다 — 전부에 붙이면 경고가 소음이 된다
  assert.equal([...panel.matchAll(/mr-note/g)].length, 4);
});

test("성적이 없으면 紋도 여는 버튼도 없다 — 눌리는 척하는 버튼을 만들지 않는다(M11)", () => {
  const out = renderPlayerPage(
    playerPage({ batting: null, splits: [], scorebook: [], situation: [], matchups: [], ranking: [], mark: EMPTY_MARK }),
    context(),
  );
  assert.ok(!out.includes('id="markBtn"'), "열 것이 없는데 버튼이 있다");
  assert.ok(!out.includes('id="markPanel"'));
  assert.match(out, /<span class="mark">/, "대체 마크는 남아야 한다");
});

test("설명을 띄울 자리가 모든 페이지에 있다 — 없으면 툴팁이 조용히 안 뜬다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /<div id="tip" role="tooltip" hidden><\/div>/);
  assert.match(out, /class="term" type="button" data-term="avg"/);
});

test("수준 색에는 범례와 끄는 버튼이 함께 있다 — 범례 없는 색은 장식이다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(out, /class="legend"/);
  assert.match(out, /id="gradeBtn"/);
  for (const label of ["とても悪い", "悪い", "ふつう", "良い", "とても良い"]) {
    assert.ok(out.includes(label), `범례에 ${label}가 없다`);
  }
  // 기준 모집단을 화면이 말한다 — 「무엇과 비교한 색인가」에 답할 수 있어야 한다
  // 타자 페이지의 범례는 **타자 분포**를 근거로 든다
  assert.match(out, /100打席以上の打者157人の分布/);
});

test("⚠버튼 안에 버튼이 없다 — 정렬 헤더에는 속성만 붙는다", () => {
  const out = renderPlayerPage(playerPage(), context());
  // <button …> 이 닫히기 전에 또 <button 이 나오면 중첩이다
  const nested = /<button(?:(?!<\/button>)[\s\S])*?<button/.exec(out);
  assert.equal(nested, null, `중첩된 버튼이 있다: ${nested?.[0].slice(0, 120)}`);
  // 정렬 헤더는 data-term만 갖는다
  assert.match(out, /<button class="sortable"[^>]*data-term="avg"/);
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

/**
 * ⚠**「今」이 석 달 전에 끝나 있었다**(2026-08-16 이중 검토에서 배포물의 21명 확인).
 * `streakOf`는 그 선수의 **자기 출장 목록**만 훑으므로, 5월 22일 이후 출장이 없으면
 * `current`는 그때 값 그대로 남는다. 화면이 그걸 「今」이라고 쓰면 거짓말이 된다.
 */
test("⚠최신 경기일에 안 나온 선수의 연속 기록은 「今」이 아니라 시점을 적는다", () => {
  const out = renderPlayerPage(
    playerPage({
      asOf: "2026-08-14",
      streaks: {
        hitting: { current: 8, best: 8, bestFrom: "2026-05-09", bestTo: "2026-05-22" },
        onBase: { current: 8, best: 8, bestFrom: "2026-05-09", bestTo: "2026-05-22" },
        hitless: { current: 0, best: 2, bestFrom: null, bestTo: null },
        games: 30,
        lastGameDate: "2026-05-22",
      },
    }),
    context(),
  );
  assert.match(out, /5月22日時点/, "석 달 전 기록을 「今」이라고 했다");
  assert.match(out, /最後の出場は5月22日/, "왜 그런지 말하지 않았다");
});

test("최신 경기일에 나온 선수는 「今」이다 — 전부 시점 표기로 바꾸면 뜻이 없어진다", () => {
  const out = renderPlayerPage(playerPage({ asOf: "2026-08-14" }), context());
  assert.match(out, /<span class="den">今<\/span>/);
  /**
   * ⚠**「時点」만으로 찾으면 안 된다.** 通算 블록이 자기 취득일(`2026-08-17時点`)을 적기 시작하면서
   * 이 검사가 그것에 걸렸다 — 연속기록과 아무 상관이 없는 문자열이다.
   *
   * ⚠**`\d+月\d+日時点` 로 좁힌 것도 부족했다**(2026-08-20 · 두 번째). 등급 범례가
   * 「2026年8月15日時点で100打席以上…」이라고 **기준일을 적기 시작하자 여기가 또 걸렸다.**
   * 페이지 전체에서 날짜꼴을 찾는 한 이 검사는 **다른 블록이 날짜를 적을 때마다** 붉어진다.
   * → **연속기록이 실제로 쓰는 자리**(`<span class="den">…時点</span>`)만 본다.
   */
  assert.ok(
    !/<span class="den">\d+月\d+日時点<\/span>/.test(out),
    "최신 경기에 나온 선수에게 시점 표기가 붙었다",
  );
});

// ── 「今」의 두 번째 조건 — 그 시즌이 아직 진행 중인가 ────────────────────────
//
// ⚠**위 두 시험은 조건 ⑵(그 선수가 최신 경기일에 나왔는가)만 쟀다.** 그것만으로는
// 아카이브 시즌이 통째로 새어 나간다 — 2018년 페이지의 「今」은 8년 전에 끝난 기록이다.
// 실측(2026-08-21 · `dist` 전수 6,207장 중 연속기록 구획이 있는 3,459장):
// 아카이브 **259장**이 현재형이었다(2018:50 · 2019:23 · 2020:30 · 2021:29 · 2022:29 ·
// 2023:20 · 2024:27 · 2025:51).
// ⚠**그렇다고 「시즌이 끝났으면 과거형」 하나로 바꾸면 반대쪽이 샌다** — 진행 중인 2026 에서
// 5월에 끊긴 기록까지 「今」이 된다(같은 실측으로 **204장**). 두 기준이 갈라지는 페이지는
// **463장**이고, 겹치는 **135장**만이 정말 「今」이다. **두 조건을 모두 본다.**

/**
 * **連続記録 구획만** 잘라 낸다.
 *
 * ⚠**페이지 전체에서 「時点」을 찾으면 다른 블록에 걸린다** — 通算 블록이 취득일을,
 * 등급 범례가 기준일을 적는다(바로 위 시험이 두 번 밟은 자리다).
 */
function streakBlockOf(out: string): string {
  const from = out.indexOf('id="b-streak"');
  assert.notEqual(from, -1, "連続記録 구획이 없다");
  const to = out.indexOf("</section>", from);
  assert.notEqual(to, -1, "連続記録 구획이 닫히지 않았다");
  return out.slice(from, to);
}

/**
 * 그 구획의 **「언제 시점인가」 라벨 세 개**(연속안타·연속출루·연속무안타).
 *
 * ⚠**같은 자리에 `今季最長` 의 기간(`5月9日〜5月22日`)도 `den` 으로 들어간다.**
 * 그쪽은 `${from}〜${to}` 라 **구조적으로 반드시 `〜` 를 품는다** — 그것으로 가른다.
 * ⚠**개수를 단언한다.** 셋이 안 나오면 이 시험이 공회전하고 있는 것이다.
 */
function streakAsOfLabels(out: string): string[] {
  const all = [...streakBlockOf(out).matchAll(/<dd class="v">[^<]*<span class="den">([^<]*)<\/span><\/dd>/g)]
    .map((m) => m[1]!)
    .filter((s) => !s.includes("〜"));
  assert.equal(all.length, 3, `시점 라벨이 3개가 아니다(${all.length}) — 마크업이 바뀌었다`);
  return all;
}

/** `heldTo` 만 다른 문맥. **이 값이 「이 시즌이 끝났는가」의 유일한 근거다** */
function heldContext(heldTo: number) {
  return context({ freshness: freshness("2026-08-14", "2026-08-15", "2026-08-14", { from: 2018, to: heldTo }) });
}

/** 2018년 페이지 한 장. **그 선수는 그 시즌 최종전(10月13日)에 나왔다** — 조건 ⑵는 참이다 */
function archived(over: Partial<Parameters<typeof playerPage>[0]> = {}) {
  return playerPage({
    season: 2018,
    asOf: "2018-10-13",
    streaks: {
      hitting: { current: 5, best: 9, bestFrom: "2018-06-01", bestTo: "2018-06-12" },
      onBase: { current: 5, best: 9, bestFrom: "2018-06-01", bestTo: "2018-06-12" },
      hitless: { current: 0, best: 2, bestFrom: null, bestTo: null },
      games: 130,
      lastGameDate: "2018-10-13",
      ...(over.streaks ?? {}),
    },
    ...over,
  });
}

/**
 * ⚠**아카이브 259장이 「今」이라고 말하고 있었다.** 조건 ⑵(최신 경기일에 나왔다)는 참인데
 * 그 「최신」이 2018년 10월 13일이다 — 지금 이어지는 기록이 아니다.
 */
test("⚠끝난 시즌의 연속 기록은 「今」이 아니다 — 최종전에 나온 선수여도 그렇다", () => {
  const out = renderPlayerPage(archived(), heldContext(2026));
  assert.deepEqual(streakAsOfLabels(out), ["10月13日時点", "10月13日時点", "10月13日時点"]);
  assert.ok(!streakBlockOf(out).includes(">今<"), "8년 전 기록을 「今」이라고 했다");
  // ⚠**「~とは限りません」은 진행 중 시즌에서만 참인 유보다** — 끝난 시즌에는 그렇게 쓰지 않는다
  assert.match(streakBlockOf(out), /このシーズンはすでに終わっています/, "왜 「今」이 아닌지 말하지 않았다");
  assert.ok(!streakBlockOf(out).includes("いまも続いているとは限りません"), "끝난 시즌을 유보형으로 말했다");
});

/** 진행 중인 시즌은 그대로 「今」이다 — 위 수정이 여기까지 삼키면 라벨의 뜻이 사라진다 */
test("⚠진행 중인 시즌에서 최신 경기일에 나온 선수는 여전히 「今」이다", () => {
  const out = renderPlayerPage(playerPage({ asOf: "2026-08-14" }), heldContext(2026));
  assert.deepEqual(streakAsOfLabels(out), ["今", "今", "今"]);
  assert.match(streakBlockOf(out), /「今」はいま続いている記録/);
});

/**
 * ⚠**「시즌이 끝났으니 과거형」 하나로는 못 가른다.** 진행 중인 시즌에도 5월에 끊긴 기록이 있고,
 * 그건 「지금 이어지고 있다」가 아니다 — 실측으로 2026 쪽 204장이 그 상태다.
 */
test("⚠진행 중인 시즌이라도 최신 경기일에 안 나왔으면 「今」이 아니다", () => {
  const out = renderPlayerPage(
    playerPage({
      asOf: "2026-08-14",
      streaks: {
        hitting: { current: 8, best: 8, bestFrom: "2026-05-09", bestTo: "2026-05-22" },
        onBase: { current: 8, best: 8, bestFrom: "2026-05-09", bestTo: "2026-05-22" },
        hitless: { current: 0, best: 2, bestFrom: null, bestTo: null },
        games: 30,
        lastGameDate: "2026-05-22",
      },
    }),
    heldContext(2026),
  );
  assert.deepEqual(streakAsOfLabels(out), ["5月22日時点", "5月22日時点", "5月22日時点"]);
  // ⚠**이쪽은 유보가 맞다** — 시즌이 남아 있으므로 다시 나올 수 있다
  assert.match(streakBlockOf(out), /いまも続いているとは限りません/);
  assert.ok(!streakBlockOf(out).includes("すでに終わっています"), "진행 중인 시즌을 끝났다고 했다");
});

/**
 * ⚠**각주에 `<b>` 를 직접 적으면 화면에 글자로 찍힌다.** `note()` 는 문자열을 이스케이프하고
 * 강조는 **별표 두 개**로만 만든다(`emphasis.ts` 가 그 규칙의 정본 · M1).
 * 실측(2026-08-21 · `dist` 전수)으로 연속기록 구획이 있는 **3,459 / 6,207장**이
 * 「下の&lt;b&gt;通算成績&lt;/b&gt;（出典：NPB）」라고 쓰고 있었다 —
 * ⚠**소스만 읽어서는 안 보인다**(문법은 멀쩡하다). 실기로 열어야 보인다.
 */
test("⚠연속기록 각주의 강조가 태그가 아니라 굵은 글씨로 나간다", () => {
  const blk = streakBlockOf(renderPlayerPage(playerPage({ asOf: "2026-08-14" }), heldContext(2026)));
  assert.ok(!blk.includes("&lt;b&gt;"), "화면에 <b> 가 글자로 찍힌다");
  assert.match(blk, /「通算」は下の<b>通算成績<\/b>（出典：NPB）/, "강조가 굵은 글씨로 나가지 않는다");
});

/**
 * ⚠**마지막 출장일을 모르면 「今」으로 때우지 않는다**(M11).
 * 실측(2026-08-21 · `dist` 6,207장)으로는 **0건**이지만 `lastGameDate` 가 `string | null` 인 이상
 * 화면이 답을 갖고 있어야 한다 — 「0건」과 「일어날 수 없다」는 다른 말이다(작업규칙 7).
 */
test("⚠마지막 출장일을 모르면 「今」이 아니라 「모른다」를 낸다", () => {
  const out = renderPlayerPage(
    playerPage({
      asOf: "2026-08-14",
      streaks: {
        hitting: { current: 0, best: 0, bestFrom: null, bestTo: null },
        onBase: { current: 0, best: 0, bestFrom: null, bestTo: null },
        hitless: { current: 0, best: 0, bestFrom: null, bestTo: null },
        games: 0,
        lastGameDate: null,
      },
    }),
    heldContext(2026),
  );
  assert.deepEqual(streakAsOfLabels(out), [NO_VALUE, NO_VALUE, NO_VALUE]);
  assert.ok(!streakBlockOf(out).includes(">今<"), "언제 기준인지도 모르면서 「今」이라고 했다");
  assert.match(streakBlockOf(out), /いつの時点のものかがわかりません/);
});

/**
 * ⚠**`true` 는 증명이고 `false` 는 「모른다」다**(M11). 시즌은 겹치지 않으므로
 * 더 새로운 시즌의 경기가 있으면 이 시즌은 **반드시** 끝났다 — 그 반대는 성립하지 않는다.
 */
test("⚠시즌 종료 판정은 「더 새로운 시즌이 있는가」 하나로만 낸다", () => {
  assert.equal(seasonSurelyOver(2018, 2026), true, "더 새로운 시즌이 있는데 안 끝났다고 했다");
  assert.equal(seasonSurelyOver(2025, 2026), true);
  // 가장 새로운 시즌은 이 근거로 못 가른다 — 「끝났다」고 단정하지 않는다
  assert.equal(seasonSurelyOver(2026, 2026), false);
  assert.equal(seasonSurelyOver(2027, 2026), false);
  /**
   * ⚠**`heldTo === 0` 은 「0년까지 보유」가 아니라 「모른다」다**(freshness() 의 기본값 · M11).
   * ⚠**이 줄은 가지를 재는 것이 아니라 계약을 재는 것이다** — 0 이 어떤 실제 시즌보다 작아서
   * 비교가 저절로 안전한 쪽으로 떨어진다. 그 성질이 뒤집히면(`heldTo === 0 || …` 같은 식으로)
   * 여기가 떨어진다.
   */
  assert.equal(seasonSurelyOver(2018, 0), false, "모르는 값으로 시제를 뒤집었다");
});

/**
 * ⚠**한 화면에 수가 두 종류 있으면 그 이유를 그 화면이 말해야 한다.**
 * 리그를 넘어 이적한 선수의 성적은 시즌 합계이고 順位는 소속 리그에서 낸 몫으로만 매긴다
 * (NPB의 타이틀 규정). 적지 않으면 「어느 쪽이 맞지?」가 되고,
 * 그 질문에 답할 수 없는 화면은 값이 맞아도 틀린 화면이다.
 */
test("이적 이력 아래에 「합계인지 리그별인지」를 적는다", () => {
  const out = renderPlayerPage(
    playerPage({
      stints: [
        {
          teamCode: "db", teamName: "横浜DeNAベイスターズ", leagueName: "セントラル・リーグ",
          games: 28, sample: 105, sampleText: "105打席", lastDate: "2026-06-30",
        },
        {
          teamCode: "h", teamName: "福岡ソフトバンクホークス", leagueName: "パシフィック・リーグ",
          games: 27, sample: 97, sampleText: "97打席", lastDate: "2026-08-15",
        },
      ],
    }),
    context(),
  );
  assert.match(out, /横浜DeNAベイスターズ28試合 → 福岡ソフトバンクホークス27試合/);
  // **마지막(=현재) 소속 리그와 그 표본**을 적는다 — 옛 리그를 적으면 반대로 읽힌다
  assert.match(out, /成績は今季の合計。順位はパシフィック・リーグでの97打席で計算/);
});

test("이적하지 않았으면 그 줄 자체가 없다 — 설명할 차이가 없다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.ok(!out.includes('class="stint"'));
  assert.ok(!out.includes("成績は今季の合計"));
});

/**
 * ⚠**선수 페이지가 포스트시즌을 말하지 않으면, 그 데이터는 사실상 없는 것과 같다.**
 * 「阪神の佐藤이 일본시리즈에서 어땠나」는 선수 페이지에서 묻는 질문이지
 * 대회 페이지를 뒤져서 찾는 질문이 아니다. 그리고 **위 성적에 포함되지 않는다고 적는다**(§2-1).
 */
test("포스트시즌 기록이 있으면 선수 페이지에 별도 구획으로 붙는다", () => {
  const out = renderPlayerPage(
    playerPage({
      postseason: [
        {
          competitionId: "nipponSeries",
          competitionName: "日本シリーズ",
          games: 5,
          sampleText: "21打席",
          line: "6安打 2本塁打 5打点",
        },
      ],
    }),
    context(),
  );
  assert.ok(out.includes("日本シリーズ"), "포스트시즌 구획이 없다");
  assert.ok(out.includes("6安打 2本塁打 5打点"));
  // ⚠**분모가 붙는다**(M2) — 5경기 21타석짜리 수라는 것을 값 옆에서 말한다
  assert.ok(
    out.includes('<span class="den">5試合 21打席</span>'),
    "분모가 값에서 떨어졌거나 없다",
  );
  // ⚠**위 성적에 포함되지 않는다고 적는다** — 안 적으면 더한 수로 읽힌다
  assert.ok(out.includes("上の成績に含まれていません"), "경계를 말하지 않는다");
});

test("포스트시즌 기록이 없으면 빈 구획을 만들지 않는다", () => {
  const out = renderPlayerPage(playerPage({ postseason: [] }), context());
  assert.ok(!out.includes("ポストシーズン"), "기록이 없는데 구획이 나왔다");
});

/**
 * ⚠**타대회 화면은 이제 대회별 탭이라 첫 대회만 열려 있다.**
 * 그냥 `postseason.html` 로 보내면 日本シリーズ만 나온 선수의 링크가 **탭을 넣기 전보다 나빠진다** —
 * 눌러도 자기 기록이 없는 화면이 나온다. 대회 이름이 그 대회의 앵커로 간다.
 */
test("포스트시즌 요약의 대회 이름이 그 대회 탭으로 간다", () => {
  const out = renderPlayerPage(
    playerPage({
      postseason: [
        {
          competitionId: "nipponSeries",
          competitionName: "日本シリーズ",
          games: 5,
          sampleText: "21打席",
          line: "6安打 2本塁打 5打点",
        },
      ],
    }),
    context(),
  );
  assert.ok(
    out.includes(`postseason.html#pc-nipponSeries`),
    "대회 이름이 그 대회 앵커로 가지 않는다 — 첫 탭만 열린 화면이 나온다",
  );
});

/**
 * ⚠**지표 카탈로그에 「퀄리티스타트」가 적혀 있는데 구현이 0곳이었다**(2026-08-16 확인) —
 * 규약과 코드의 명시적 불일치였다. 그리고 **공표값과 대조 가능한 몇 안 되는 신규 지표**다.
 */
test("선발 투수에게 QS·완투를 낸다 — 분모는 선발 등판 수다(M2)", () => {
  const out = renderPlayerPage(playerPage({ role: "pitcher", batting: null, pitching: pitchingBlock(), mark: pitcherMark(), streaks: null }), context());
  assert.ok(out.includes("QS"), "QS가 없다");
  assert.ok(out.includes("完投"), "완투가 없다");
  // ⚠**비율에는 분모가 붙는다.** QS율의 분모는 시합수가 아니라 **선발 등판 수**다
  assert.ok(out.includes('<span class="den">22先発</span>'), "QS율의 분모가 없거나 틀렸다");
  // ⚠완투를 어떻게 셌는지 화면이 말한다 — 아웃 27개로 세면 값이 달라진다
  assert.ok(out.includes("この1人だけ"), "완투를 어떻게 셌는지 말하지 않는다");
});

/**
 * ⚠**구원 투수에게 「QS 0」은 「못 했다」로 읽힌다**(M11).
 * 선발이 0경기면 그 줄 자체가 없어야 한다 — 0과 해당없음은 다르다.
 */
test("선발이 0경기면 QS 줄을 그리지 않는다 — 0과 해당없음은 다르다(M11)", () => {
  const relief = pitchingBlock();
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      batting: null,
      mark: pitcherMark(),
      streaks: null,
      pitching: { ...relief, quality: { starts: 0, qs: 0, hqs: 0, cg: 0, sho: 0 } },
    }),
    context(),
  );
  assert.ok(!out.includes("QS率"), "선발이 없는데 QS율을 냈다");
  assert.ok(!out.includes("完封勝"), "선발이 없는데 완봉승을 냈다");
});

/**
 * ⚠**이름을 정확히 붙이는 것이 이 지표의 절반이다.**
 * 땅볼 비율을 「GB%」라고 부르면 거짓말이 된다 — GB%는 안타를 포함한 전 타구가 분모인데
 * 비홈런 안타에는 타구 종류 표기가 없어(실측 27.5%) 우리는 그걸 **모른다**.
 * 그리고 방향은 「타구가 떨어진 지점」이 아니라 **「처리한 야수 기준」**이다.
 */
test("타구 성향을 내되, 무엇을 센 것인지 화면이 말한다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.ok(out.includes("ゴロアウト率"), "타구 성향이 없다");
  // ⚠**라벨로 쓰였는지**를 본다. 설명문이 「GB%와 분모가 다르다」고 말하는 것은 옳은 등장이다
  assert.ok(!/<dt[^>]*>[^<]*GB%/.test(out), "GB% 를 지표 이름으로 썼다 — 분모가 달라 거짓말이 된다");
  assert.ok(out.includes("一般的なGB%とは分母が違います"), "GB% 와 어떻게 다른지 말하지 않는다");
  assert.ok(out.includes("処理した野手の位置"), "방향의 뜻을 말하지 않는다");
  assert.ok(out.includes("分母はアウトだけ"), "땅볼 비율의 분모를 말하지 않는다");
  assert.ok(out.includes("三振の内訳"), "삼진 내역을 헛스윙률로 오해할 수 있다");
  // ⚠분모가 값에 인접한다(M2). 축마다 분모가 다르다
  assert.ok(out.includes('<span class="den">230アウト</span>'), "땅볼 비율의 분모가 없다");
  assert.ok(out.includes('<span class="den">360打球</span>'), "방향의 분모가 없다");
});

/**
 * ⚠**얇은 표본에서 방향 비율은 값이 아니라 소음이다.**
 * 20타구짜리 「좌측 70%」를 내면 M2가 막으라는 바로 그것을 하게 된다.
 */
test("표본이 얇은 축은 그리지 않는다 — 축마다 분모가 다르므로 임계값도 다르다", () => {
  const thin = playerPage({
    batting: {
      ...playerPage().batting!,
      batted: {
        groundOuts: 5, airOuts: 5, left: 8, center: 6, right: 6,
        infield: 4, infieldHits: 1, swinging: 6, looking: 2,
      },
    },
  });
  const out = renderPlayerPage(thin, context());
  assert.ok(!out.includes("ゴロアウト率"), "10아웃짜리 땅볼 비율을 냈다");
  assert.ok(!out.includes("引っ張り側"), "20타구짜리 방향 비율을 냈다");
  assert.ok(!out.includes("内野安打率"), "4타구짜리 내야안타율을 냈다");
});

/**
 * ⚠**「번트는 손해다」가 결론이 아니다.** 상황별로 갈리는 것이 결론이고,
 * 무엇보다 **득점기대값은 승리기대값이 아니다** — 동점 9회말에 1점만 필요하면
 * RE가 내려가는 선택이 옳을 수 있다. 우리는 승리기대값을 신뢰도 있게 만들 수 없으므로
 * 거기까지만 말한다. 이 문장이 빠지면 화면이 과한 주장을 하게 된다.
 */
test("번트의 득점기대값을 내되, 승리기대값이 아니라고 말한다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.ok(out.includes("犠打"), "번트 표가 없다");
  assert.ok(out.includes("-0.121"), "기대값 변화가 없다");
  assert.ok(out.includes("勝利期待値ではありません"), "RE와 WE를 구별하지 않는다");
  assert.ok(out.includes("「バントは損」が結論ではありません"), "과한 주장을 막는 문장이 없다");
  // ⚠**분모가 붙는다**(M2) — 6건짜리 평균과 895건짜리 평균은 다른 값이다
  assert.match(out, /<td class="b">895<\/td>/, "번트 수(분모)가 없다");
});

/** ⚠**표본이 얇은 상황은 내지 않는다.** 6건짜리 평균은 값이 아니라 소음이다 */
test("번트가 적은 상황은 표에 넣지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({ bunts: [{ bases: "3", outs: 1, n: 6, before: 0.869, delta: 0.208 }] }),
    context(),
  );
  assert.ok(!out.includes("0.208"), "6건짜리 상황을 값으로 냈다");
});

/**
 * ⚠**좌타자는 당겨치면 오른쪽이다.**
 * 무조건 「왼쪽 = 당겨치기」로 적으면 **좌타자 페이지의 두 라벨이 정반대**가 되어
 * 당겨치는 타자를 밀어치는 타자로 읽게 만든다.
 * 실측(2026): 우타는 좌 46.3%/우 31.2%, 좌타는 좌 34.4%/우 43.3% —
 * 이 줄이 그려지는 163장 중 **83장(50.9%)이 좌타자**였다.
 */
test("⚠좌타자의 당겨치기는 오른쪽이다 — 라벨이 뒤집힌다", () => {
  const dir = (bats: string | null): string =>
    renderPlayerPage(playerPage({ bats }), context());

  const r = dir("right");
  const l = dir("left");
  // 우타: 왼쪽이 당겨치기
  const rl = /引っ張り側<\/[^>]*><dd[^>]*>\.?(\d+)/.exec(r.replace(/<span class="dt-[^"]*">/g, ""));
  assert.ok(r.includes("引っ張り側"), "우타에 당겨치기 라벨이 없다");
  assert.ok(l.includes("引っ張り側"), "좌타에 당겨치기 라벨이 없다");
  // ⚠**같은 값에 붙는 라벨이 좌우로 갈려야 한다.** 두 화면이 같으면 뒤집지 않은 것이다
  const pos = (html: string, label: string): number => html.indexOf(label);
  assert.ok(
    pos(r, "引っ張り側") < pos(r, "逆方向側"),
    "우타는 당겨치기(왼쪽)가 먼저 나와야 한다",
  );
  assert.ok(
    pos(l, "引っ張り側") > pos(l, "逆方向側"),
    "좌타인데 당겨치기가 왼쪽 자리에 있다 — 라벨이 뒤집히지 않았다",
  );
  void rl;
});

/**
 * ⚠**양타·미상은 방향으로만 말한다.** 그 타석에 어느 쪽에 섰는지 우리는 모른다 —
 * 추정해서 「당겨치기」라고 쓰면 사실이 아니라 우리 짐작이다.
 */
test("타석의 좌우를 모르면 당겨치기라고 말하지 않는다", () => {
  for (const bats of ["both", null]) {
    const out = renderPlayerPage(playerPage({ bats }), context());
    assert.ok(!out.includes("引っ張り側"), `${bats}: 모르는데 당겨치기라고 했다`);
    assert.ok(out.includes("左方向"), `${bats}: 방향 라벨이 없다`);
    assert.ok(out.includes("打席の左右がわからない"), `${bats}: 왜 그렇게 쓰는지 말하지 않는다`);
  }
});

/**
 * ⚠**내야타구만 충분한 선수가 통째로 빠졌다** — 실측 1,664 선수-시즌 중 55건(3.3%).
 * 표시 가드에서 그 축만 빠져 있었다.
 */
test("내야타구만 충분해도 그 줄은 그린다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: {
        ...playerPage().batting!,
        batted: {
          groundOuts: 10, airOuts: 10, left: 20, center: 20, right: 20,
          infield: 80, infieldHits: 8, swinging: 10, looking: 5,
        },
      },
    }),
    context(),
  );
  assert.ok(out.includes("内野安打率"), "내야타구가 충분한데 줄이 사라졌다");
});

/**
 * ⚠**등번호 없음은 「0번」이 아니라 「지금 등록이 없다」**(M11).
 * 실측(2026-08-17) 화면 색인 기준: 2026년 698명 중 0명 · 2025년 721명 중 76명 ·
 * 2024년 702명 중 177명이 등번호 없음이다(`player` 표 전체로는 980명 중 198명).
 * 「―」로 채우면 그 198장이 전부 같은 기호를 달고, 결손처럼 읽힌다.
 */
test("등번호가 있으면 표제에 내고, 없으면 자리도 만들지 않는다", () => {
  const withNo = renderPlayerPage(playerPage({ uniformNumber: "18" }), context());
  assert.match(withNo, /背番号 18/, "등번호가 표제에 안 나온다");

  const noNo = renderPlayerPage(playerPage({ uniformNumber: null }), context());
  assert.doesNotMatch(noNo, /背番号/, "등번호가 없는데 항목이 그려졌다");
  // 나머지 소개줄은 그대로 남아야 한다 — 등번호 하나 때문에 줄이 사라지면 안 된다
  assert.match(noNo, /投手|野手/, "등번호가 없다고 소개줄까지 잃었다");
});

/**
 * ⚠**「도루자 0」과 「도루자를 세지 못했다」는 다른 사실이다**(M11).
 *
 * 0으로 때우면 성공률이 `sb/sb = 1.000` 이 되고, **분모까지 붙은 그럴듯한 거짓말**이 된다 —
 * 「盗塁成功率 1.000（30企図）」는 분모 없는 값보다 나쁘다. M2는 「분모를 붙여라」가 아니라
 * 「분모 없는 값을 내지 마라」이고, 거짓 분모는 그 정신을 정면으로 어긴다.
 *
 * 방아쇠는 이론이 아니다: `--skip-events` 는 문서화된 플래그이고 종료 코드 0이다.
 */
test("⚠도루자를 세지 못했으면 未集計다 — 0으로 때우면 성공률이 1.000이 된다", () => {
  const out = renderPlayerPage(
    playerPage({ batting: battingBlock({ sb: 30, steal: null }) }),
    context(),
  );
  assert.match(out, /未集計/, "세지 못한 것을 말하지 않았다");
  assert.ok(!out.includes("1.000<span"), "세지 못했는데 성공률 1.000을 냈다");
  // 도루 자체(박스 값)는 그대로 나온다 — 못 센 것은 도루자 쪽이다
  assert.match(out, /盗塁/, "도루 항목까지 사라졌다");
});

test("도루자를 셌으면 값과 분모가 나온다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 30,
        steal: {
          cs: 7,
          pickoff: 2,
          rate: { value: 30 / 37, denominator: 37 },
          byBase: [{ label: "二盗", base: "2b", sb: 30, cs: 7, rate: { value: 30 / 37, denominator: 37 } }],
          pickoffByBase: [{ label: "一塁", n: 2 }],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.match(out, /\.811/, "성공률이 안 나온다");
  assert.match(out, /37企図/, "분모가 안 붙었다(M2)");
  assert.ok(!out.includes("未集計"), "센 값인데 未集計라고 했다");
});

// ─── 走塁の内訳 (루별 도루 · 견제사 · 더블스틸) ─────────────────────────────
//
// ⚠**`runner_event.base` 와 `double_steal` 은 저장만 되고 읽는 코드가 0곳이었다**(2026-08-20).

/**
 * ⚠**뭉치면 사라지는 사실이 있다.** 9시즌 정규시즌 실측: 본루는 도루 성공 **47** 인데
 * 도루자가 **146** 으로 실패가 3배 많다. 총계 성공률 하나로 내면 이 사실이 묻힌다.
 * ⚠**루가 다르면 성공률도 다르다** — 표가 그것을 보여야 존재 이유가 있다.
 */
test("⚠루별 도루 내역이 나오고, 루마다 분모가 따로 붙는다(M2)", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 12,
        steal: {
          cs: 5,
          pickoff: 1,
          rate: { value: 12 / 17, denominator: 17 },
          byBase: [
            { label: "二盗", base: "2b", sb: 10, cs: 2, rate: { value: 10 / 12, denominator: 12 } },
            { label: "三盗", base: "3b", sb: 2, cs: 2, rate: { value: 0.5, denominator: 4 } },
            { label: "本盗", base: "home", sb: 0, cs: 1, rate: { value: 0, denominator: 1 } },
          ],
          pickoffByBase: [{ label: "一塁", n: 1 }],
          doubleSteal: 2,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.match(out, /二盗/, "루별 표가 없다");
  assert.match(out, /三盗/);
  assert.match(out, /本盗/);
  // 루마다 분모가 따로 붙는다 — 총계 17企図 하나로 때우지 않는다
  assert.match(out, /<span class="den">12企図<\/span>/, "2루의 분모가 없다");
  assert.match(out, /<span class="den">4企図<\/span>/, "3루의 분모가 없다");
  assert.match(out, /<span class="den">1企図<\/span>/, "본루의 분모가 없다");
  // ⚠**본루는 0성공 1실패다** — `.000` 을 「값 없음」으로 만들면 안 된다(M11)
  assert.match(out, /\.000/, "0성공을 값 없음으로 만들었다");
  assert.match(out, /ダブルスチール/, "더블스틸이 안 나온다");
});

/**
 * ⚠**`base` 의 뜻이 종류마다 다르다**(마이그레이션 010). 도루는 **노린 루**,
 * 견제사는 **있던 루**다. 하나의 표로 그리면 「一塁」 줄이
 * 「1루를 훔치려다 잡혔다」로 읽히는데 그런 일은 일어나지 않는다.
 */
test("⚠견제사를 도루와 다른 표로 그린다 — 같은 열에 넣으면 루의 뜻이 뒤집힌다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 3,
        steal: {
          cs: 1,
          pickoff: 2,
          rate: { value: 0.75, denominator: 4 },
          byBase: [{ label: "二盗", base: "2b", sb: 3, cs: 1, rate: { value: 0.75, denominator: 4 } }],
          pickoffByBase: [{ label: "一塁", n: 2 }],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  /**
   * 두 표가 정말 나뉘어 있다 — **머리가 서로 다른 말을 하는 표가 하나씩** 있어야 한다.
   *
   * ⚠**낱말이 있는지만 보면 안 잡힌다**(2026-08-20 뮤테이션 검사에서 실제로 안 잡혔다).
   * 각주가 「盗塁は狙った塁、牽制死はいた塁です」라고 같은 말을 하고 있어서,
   * 두 표를 **같은 머리로 합쳐 버려도** `match(/いた塁/)` 는 그대로 참이었다.
   * → `<th>` 로 좁히고 **각각 정확히 1개**를 요구한다.
   */
  const stolenHead = out.match(/<th class="l">狙った塁<\/th>/g) ?? [];
  const pickoffHead = out.match(/<th class="l">いた塁<\/th>/g) ?? [];
  assert.equal(stolenHead.length, 1, "도루 표의 머리가 「노린 루」가 아니거나 여러 개다");
  assert.equal(pickoffHead.length, 1, "견제사 표의 머리가 「있던 루」가 아니거나 여러 개다");
  // ⚠견제사는 도루 성공률의 분모 밖이다(NPB 기록) — 총계 분모는 4(3+1)이지 6이 아니다
  assert.match(out, /<span class="den">4企図<\/span>/, "견제사가 기도의 분모에 들어갔다");
});

/**
 * ⚠**총계를 세지 못했으면 내역도 내지 않는다.** 내역만 나오면 「합이 안 맞는 화면」이 되고,
 * 그건 「모른다」보다 나쁘다(M11·M12).
 */
test("⚠도루를 세지 못했으면 루별 내역도 없다 — 합이 안 맞는 표를 만들지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({ batting: battingBlock({ sb: 30, steal: null }) }),
    context(),
  );
  assert.ok(!out.includes("狙った塁"), "총계가 未集計인데 루별 표가 나왔다");
  assert.ok(!out.includes("ダブルスチール"), "총계가 未集計인데 더블스틸이 나왔다");
});

/** 기도도 견제사도 없으면 표 자체를 그리지 않는다 — 빈 표는 「기록이 없다」로 읽힌다(M12) */
test("주자 사건이 하나도 없으면 루별 표를 그리지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 0,
        steal: { cs: 0, pickoff: 0, rate: { value: null, denominator: 0 }, byBase: [], pickoffByBase: [], doubleSteal: 0, leagueHome: LEAGUE_HOME },
      }),
    }),
    context(),
  );
  assert.ok(!out.includes("狙った塁"), "빈 표를 그렸다");
});

// ─── 併殺打 ──────────────────────────────────────────────────────────────

/**
 * ⚠**§2-2 지표 카탈로그의 항목인데 사이트 전체 출현이 0회였다**(2026-08-20 실측).
 * ⚠**「0」과 「세지 못했다」를 구별한다**(M11) — 0으로 때우면 「병살이 없는 타자」가 된다.
 */
test("⚠併殺打가 기본 성적에 나오고, 세지 못했으면 0이 아니다(M11)", () => {
  const shown = renderPlayerPage(playerPage({ batting: battingBlock({ gidp: 14 }) }), context());
  assert.match(shown, /併殺打/, "併殺打 항목이 없다");
  assert.match(shown, /data-term="gidp"/, "설명이 안 붙었다 — 뜻을 오해하기 쉬운 지표다(M3)");
  assert.match(shown, /併殺打<\/button><\/dt><dd class="v">14</, "값이 안 나온다");

  const unknown = renderPlayerPage(playerPage({ batting: battingBlock({ gidp: null }) }), context());
  assert.match(unknown, /併殺打<\/button><\/dt><dd class="v">—/, "세지 못한 것을 0으로 냈다");
});

/**
 * ⚠**「이 타자가 나쁘다」로 읽히는 지표라 경계를 화면이 말해야 한다**(M3).
 * 병살의 책임 배분은 재지 않는다 — 주자의 발, 앞 타자의 출루 성향이 전부 섞인다.
 */
test("⚠併殺打의 설명이 「무엇을 재지 않는가」를 말한다", () => {
  const t = termOf("gidp");
  assert.ok(t !== undefined, "용어집에 併殺打가 없다");
  assert.match(t.caveat ?? "", /責任配分/, "책임 배분을 재지 않는다는 말이 없다");
  // ⚠**분모(打席)를 함께 보라고 말한다**(M2) — 개수만 보면 「많이 나가는 타자」와 구별이 안 된다
  assert.match(t.caveat ?? "", /打席/, "분모를 말하지 않는다");
  // ⚠**`併失` 을 포함한다는 사실**은 값의 정의라 화면에서 확인할 수 있어야 한다
  assert.match(t.how ?? "", /併失/, "併殺崩れの失策를 포함한다는 사실이 정의에 없다");
});

/**
 * ⚠**드래프트는 「어디서 왔는가」라 표제 줄의 맨 뒤다.**
 * 앞쪽은 「지금 이 선수가 누구인가」(구단·배번·포지션·투타)가 차지한다.
 * ⚠**없으면 항목째 빠진다**(M11) — 「―」를 넣으면 결손이 성적처럼 보인다.
 */
test("⚠드래프트가 표제 줄에 나오고, 없으면 항목째 빠진다", () => {
  const withD = renderPlayerPage(playerPage(), context());
  assert.match(withD, /2016年ドラフト1位/, "드래프트가 표제에 안 나온다");
  // 맨 뒤다 — 체격 뒤에 온다
  // ⚠**이 추출이 `[^<]*` 였다** — 구단명을 링크로 바꾸자 첫 `<` 에서 끊겨
  // 빈 문자열을 재고도 「둘 다 -1 이라 순서가 맞다」로 통과할 뻔했다.
  // 재는 것은 **항목의 순서**이지 마크업 모양이 아니므로, 안의 태그를 지우고 글자만 본다.
  const subHtml = /<span class="sub">([\s\S]*?)<\/span>/.exec(withD)?.[1] ?? "";
  const sub = subHtml.replace(/<[^>]*>/g, "");
  assert.ok(sub.includes("ドラフト") && sub.includes("cm"), "표제 줄에서 둘 중 하나가 사라졌다");
  assert.ok(sub.indexOf("ドラフト") > sub.indexOf("cm"), "드래프트가 체격보다 앞에 왔다");

  const noD = renderPlayerPage(playerPage({ draft: null }), context());
  assert.doesNotMatch(noD, /ドラフト/, "드래프트가 없는데 항목이 그려졌다");
  assert.match(noD, /背番号/, "드래프트가 없다고 다른 항목까지 사라졌다");
});


/**
 * ⚠**각주가 그 페이지에 실제로 그려진 것만 말해야 한다**(2026-08-20 이중 검토 P1).
 *
 * 처음에는 표가 몇 개든 늘 같은 문장을 냈다. 배포물 실측: 각주가 실린 선수 페이지 **1,808장 중**
 * 두 표가 다 있는 것은 **385장**뿐인데 「**塁の意味が2つの表で違います**」라고 쓰고 있었다 —
 * **1,423장(79%)에서 거짓**이다. 本盗 설명도 **1,633장(90%)에 本盗 행이 없는데** 실렸다.
 * ⚠이번 커밋이 고친 `105試合`(수는 맞는데 낱말이 거짓)과 **같은 종류**다.
 */
test("⚠표가 하나뿐이면 각주가 「2つの表」라고 말하지 않는다", () => {
  const onlyStolen = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 3,
        steal: {
          cs: 1,
          pickoff: 0,
          rate: { value: 0.75, denominator: 4 },
          byBase: [{ label: "二盗", base: "2b", sb: 3, cs: 1, rate: { value: 0.75, denominator: 4 } }],
          pickoffByBase: [],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.ok(!onlyStolen.includes("2つの表"), "표가 하나뿐인데 「2つの表」라고 했다");
  assert.match(onlyStolen, /狙った塁/, "무슨 루인지 말하지 않았다");
  assert.ok(!onlyStolen.includes("いた塁"), "견제사 표가 없는데 「있던 루」를 설명했다");

  const onlyPickoff = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 0,
        steal: {
          cs: 0,
          pickoff: 2,
          rate: { value: null, denominator: 0 },
          byBase: [],
          pickoffByBase: [{ label: "一塁", n: 2 }],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.ok(!onlyPickoff.includes("2つの表"), "견제사 표만 있는데 「2つの表」라고 했다");
  assert.ok(!onlyPickoff.includes("狙った塁"), "도루 표가 없는데 「노린 루」를 설명했다");
  assert.match(onlyPickoff, /いた塁/, "무슨 루인지 말하지 않았다");
});

/**
 * ⚠**리그 전체의 本盗 수치는 本盗 행이 있는 페이지에만 낸다.**
 * 없는 페이지에 실으면 그 각주가 무엇을 설명하는지 알 수 없고, 실측 1,808장 중 1,633장이 그 상태였다.
 */
test("⚠本盗 행이 없으면 리그 전체의 本盗 수치를 내지 않는다", () => {
  const without = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 3,
        steal: {
          cs: 1,
          pickoff: 0,
          rate: { value: 0.75, denominator: 4 },
          byBase: [{ label: "二盗", base: "2b", sb: 3, cs: 1, rate: { value: 0.75, denominator: 4 } }],
          pickoffByBase: [],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.ok(!without.includes("本盗はリーグ全体でも"), "本盗 행이 없는데 本盗 설명을 냈다");
  assert.ok(!without.includes("盗塁刺120"), "本盗 행이 없는데 리그 수치를 냈다");

  const withHome = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 1,
        steal: {
          cs: 1,
          pickoff: 0,
          rate: { value: 0.5, denominator: 2 },
          byBase: [{ label: "本盗", base: "home", sb: 1, cs: 1, rate: { value: 0.5, denominator: 2 } }],
          pickoffByBase: [],
          doubleSteal: 0,
          leagueHome: LEAGUE_HOME,
        },
      }),
    }),
    context(),
  );
  assert.match(withHome, /本盗はリーグ全体でも/, "本盗 행이 있는데 그 드묾을 말하지 않았다");
  /**
   * ⚠**픽스처 값이 그대로 나와야 한다** — 그것이 「화면이 DB 에서 읽는다」의 증거다.
   * 예전에는 이 수가 `player-page.ts` 에 문자열로 박혀 있어서 **경기가 하나 늘 때마다
   * 사람이 고쳐야** 했고, 안 고치면 배포물 1,808장이 한꺼번에 거짓을 말했다(2026-08-20).
   * ⚠픽스처는 일부러 실제와 다른 수(2011〜2019 · 40 · 120 · 33)다 — 소스에 다시 박으면 여기서 떨어진다.
   */
  assert.match(withHome, /2011〜2019年のレギュラーシーズンで成功40・盗塁刺120/, "리그 수치가 픽스처에서 오지 않는다");
  // ⚠**「3倍」도 값에서 만든다** — 120 ÷ 40 = 3.0
  // ⚠`**…**` 는 `note()` 가 `<b>` 로 바꾸므로 별표로 찾지 않는다(2026-08-20에 한 번 밟았다)
  assert.match(withHome, /<b>失敗のほうが3\.0倍多い<\/b>/, "실패 배율을 값에서 만들지 않았다");
  assert.match(withHome, /成功40のうち33はダブルスチール/, "더블스틸 수가 픽스처에서 오지 않는다");
});

/**
 * ⚠**리그 수치를 못 셌으면 그 문장을 아예 내지 않는다**(M11·M12).
 * 「成功0・盗塁刺0」은 「本盗가 한 번도 없었다」로 읽히는데, 실제로는 **주자 사건을 못 읽은 것**이다.
 */
test("⚠리그 本盗 수치가 없으면 그 각주를 내지 않는다 — 0으로 때우지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 1,
        steal: {
          cs: 1,
          pickoff: 0,
          rate: { value: 0.5, denominator: 2 },
          byBase: [{ label: "本盗", base: "home", sb: 1, cs: 1, rate: { value: 0.5, denominator: 2 } }],
          pickoffByBase: [],
          doubleSteal: 0,
          leagueHome: null,
        },
      }),
    }),
    context(),
  );
  assert.ok(!out.includes("本盗はリーグ全体でも"), "리그 수치를 모르는데 그 각주를 냈다");
  // 표 자체는 그대로 나온다 — 사라지는 것은 각주뿐이다
  assert.match(out, /本盗/, "本盗 행까지 사라졌다");
});

/**
 * ⚠**리그 本盗 성공이 0이면 「그 0의 내역」을 말하지 않는다**(2026-08-21 최종 검토 P3).
 *
 * 「成功例がありません。」 바로 뒤에 「また成功**0**のうち**0**はダブルスチールの一部でした。」가
 * 그대로 붙어서 **없는 것의 내역을 말하는 문장**이 됐다.
 * ⚠**지금 데이터로는 안 밟힌다**(9시즌 本盗 성공 44) — 그래서 더 위험하다.
 * 밟히는 것은 **보유 시즌이 1개인 DB**(초기 구축 · 개막 직후)이고 그건 이 리포가 지나온 상태다.
 */
test("⚠리그 本盗 성공이 0이면 「成功0のうち0はダブルスチール」을 붙이지 않는다", () => {
  const out = renderPlayerPage(
    playerPage({
      batting: battingBlock({
        sb: 1,
        steal: {
          cs: 1,
          pickoff: 0,
          rate: { value: 0.5, denominator: 2 },
          byBase: [{ label: "本盗", base: "home", sb: 1, cs: 1, rate: { value: 0.5, denominator: 2 } }],
          pickoffByBase: [],
          doubleSteal: 0,
          // ⚠성공 0 · 도루자 3 — 「한 시즌치 DB」에서 실제로 나오는 모양이다
          leagueHome: { from: 2026, to: 2026, sb: 0, cs: 3, doubleSteal: 0 },
        },
      }),
    }),
    context(),
  );
  // 각주 자체는 나온다 — 사라지는 것은 마지막 한 문장뿐이다
  assert.match(out, /本盗はリーグ全体でも/, "성공이 0이라고 각주를 통째로 없앴다");
  assert.match(out, /<b>成功例がありません<\/b>/, "성공 0 인데 그렇게 말하지 않았다");
  assert.ok(
    !out.includes("ダブルスチールの一部でした"),
    "「成功例がありません」 뒤에 「成功0のうち0はダブルスチール…」을 그대로 붙였다",
  );
});

/**
 * ⚠**선수 페이지의 소속 구단명이 링크가 아니었다**(2026-08-21 배포물 전수 실측).
 * 페이지 맨 아래 `nav.find` 에는 구단 링크가 있었지만(장당 1개), 사람이 먼저 보는
 * 표제 줄의 구단명은 생텍스트였다 — 6,207장 전부.
 * ⚠구단명 **뒤의 구분자**까지 링크에 들어가면 난독이 「한신 가운데점」으로 끝난다.
 */
test("⚠선수 페이지 표제 줄의 구단명이 그 구단 페이지로 간다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.match(
    out,
    /<span class="sub"><a href="[^"]*teams\/t\.html">阪神タイガース<\/a> · /,
    "표제 줄의 구단명이 링크가 아니거나 구분자까지 링크에 들어갔다",
  );
  // 나머지 항목은 지금긌대로 글자다 — 갈 곳이 없는 것을 링크로 만들지 않는다
  assert.ok(!/<a[^>]*>背番号/.test(out), "배번까지 링크가 됐다");
});

/**
 * ⚠**NPB 에 없는 이닝 표기가 화면에 나가고 있었다**(2026-08-21 다방면 감사 확정).
 * 이닝의 소수 첫자리는 **0·1·2 뿐**이다(1/3 · 2/3 이닝). 그런데
 * `Math.floor(outs/3)` 로 잘라 만든 「到達치 / 기준치」가 **둘 다 정수로 띄어**
 * 도달했는데도 「35回 / 35回 … 未満」가 되는 자리가 있었다
 * (감사 실측: 9시즌 구원 1,919 선수-시즌 중 **12건** · 2026 에 2건).
 * ⚠**변환을 여기서 다시 쓰지 않는다**(M1) — `innings()` 가 정본이다.
 */
test("⚠투구회 표기는 NPB 어법을 따른다 — 소수 첫자리는 0·1·2 뿐이다", () => {
  // 106 아웃 = 35.1回 · 107 아웃 = 35.2回. 잘라 쓰면 둘 다 「35回」가 된다.
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      position: "投手",
      batting: null,
      pitching: pitchingBlock({
        role: "reliever",
        starts: 0,
        needOuts: 106,
        qualified: false,
        // 104 아웃 = 34.2回. 기준 106 아웃(35.1回) 에 미달이다 —
        // 잘라 쓰면 「34回 / 35回」가 되어 **두 수 다 거짓**이 된다.
        line: { outs: 104, bf: 140, h: 30, hr: 3, bb: 9, ibb: 0, hbp: 1, so: 38, er: 11, r: 12 },
      }),
    }),
    context(),
  );
  assert.match(out, /35\.1回/, "기준치 106아웃이 35.1回 로 나오지 않는다");
  // 이 화면의 자격 문구 안에 불가능한 소수가 없어야 한다
  const q = /class="qual"[^>]*>([^<]*)</.exec(out)?.[1] ?? out;
  assert.ok(!/[0-9]\.[3-9]回/.test(q), `자격 문구에 NPB 에 없는 이닝 표기가 있다: ${q}`);
});

/**
 * ⚠**오프시즌에 선수 페이지가 끝난 시즌을 현재형으로 말했다**(handover #56).
 *
 * `seasonSurelyOver` 는 근거가 `season < heldTo` 하나였다. 그러면 **최신 시즌이 끝나고
 * 다음 시즌 첫 경기가 들어오기 전(11월~이듭해 3월)**에는 `false` 가 되고,
 * 그 창에서 최종전에 나온 선수의 기록이 계속 「今」이 된다(그 함수의 주석이 **135장**으로 실측).
 * 그 주석이 적어 둔 처방이 **「query.ts 의 seasonIsOver 가 PlayerPageData 까지 와야 한다」**였고,
 * 지금 그렇게 배선됐다.
 */
test("⚠끝난 시즌은 현재형으로 말하지 않는다 — 다음 시즌 경기가 아직 없어도", () => {
  // ⚠픽스처 기본값은 **최신 경기일에 나온 선수**라 「今」이 붙는다 — 그게 이 시험의 대조군이다
  const running = renderPlayerPage(playerPage(), context());
  assert.match(running, /続いている/, "진행 중인데 현재형이 아니다 — 이 시험이 공회전한다");

  const over = renderPlayerPage(playerPage({ seasonOver: true }), context());
  assert.ok(!over.includes("続いている"), "끝난 시즌을 「続いている」이라고 말했다");
});
