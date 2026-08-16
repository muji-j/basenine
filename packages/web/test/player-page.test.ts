import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLDS, bootstrapFor, renderPlayerPage } from "../src/player-page.ts";
import {
  battingBlock,
  context,
  EMPTY_MARK,
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
  assert.ok(panel.includes(`.403<span class="den">442打席</span>`), "出塁에 打席이 안 붙었다");
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
  assert.ok(!out.includes("時点"), "최신 경기에 나온 선수에게 시점 표기가 붙었다");
});
