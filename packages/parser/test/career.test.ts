/**
 * 年度別成績 파서.
 *
 * ⚠**여기서 지키는 것은 「조용히 사라지지 않는가」다.**
 * 이 파서를 만들면서 **오류를 하나도 내지 않고 514명분이 통째로 사라진 결함이 두 번** 났다.
 * 둘 다 중첩 표(`table_inning`) 때문이었고, 둘 다 「칸 수가 안 맞는 행은 건너뛴다」가
 * 그것을 삼켰다. 실물로 재지 않았으면 못 봤다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { careerTotal, parseCareer, seasonsPlayed } from "../src/career.ts";

/** 투수표의 投球回는 **중첩 표**로 온다 — 이 픽스처의 존재 이유가 그것이다 */
const PITCH_INNINGS = `<td><table class="table_inning"><tbody><tr><th>28</th><td>.2</td></tr></tbody></table></td>`;

function page(opts: { bat?: boolean; pit?: boolean } = {}): string {
  const bat = opts.bat === false ? "" : `
<table id="tablefix_b">
<thead><tr><th class="year">年度</th><th class="team">所属球団</th>
<th>試合</th><th>打席</th><th>打数</th><th>得点</th><th>安打</th><th>二塁打</th><th>三塁打</th>
<th>本塁打</th><th>塁打</th><th>打点</th><th>盗塁</th><th>盗塁刺</th><th>犠打</th><th>犠飛</th>
<th>四球</th><th>死球</th><th>三振</th><th>併殺打</th><th>打率</th><th>長打率</th><th>出塁率</th></tr></thead>
<tbody>
<tr class="registerStats"><td class="year"> 2024 </td><td class="team">阪 神</td>
<td>100</td><td>400</td><td>350</td><td>50</td><td>98</td><td>20</td><td>2</td>
<td>12</td><td>158</td><td>55</td><td>3</td><td>1</td><td>5</td><td>4</td>
<td>40</td><td>1</td><td>70</td><td>8</td><td>.280</td><td>.451</td><td>.355</td></tr>
<tr class="registerStats"><td class="year"> 2025 </td><td class="team">巨 人</td>
<td>40</td><td>160</td><td>140</td><td>18</td><td>35</td><td>7</td><td>0</td>
<td>4</td><td>54</td><td>20</td><td>0</td><td>0</td><td>2</td><td>1</td>
<td>16</td><td>1</td><td>30</td><td>3</td><td>.250</td><td>.386</td><td>.331</td></tr>
</tbody>
<tfoot><tr><th class="year"></th><th class="team">通　算</th>
<th>140</th><th>560</th><th>490</th><th>68</th><th>133</th><th>27</th><th>2</th>
<th>16</th><th>212</th><th>75</th><th>3</th><th>1</th><th>7</th><th>5</th>
<th>56</th><th>2</th><th>100</th><th>11</th><th>.271</th><th>.433</th><th>.348</th></tr></tfoot>
</table>`;
  const pit = opts.pit === false ? "" : `
<table id="tablefix_p">
<thead><tr><th class="year">年度</th><th class="team">所属球団</th>
<th>登板</th><th>勝利</th><th>敗北</th><th>セーブ</th><th>H</th><th>HP</th><th>完投</th>
<th>完封勝</th><th>無四球</th><th>勝率</th><th>打者</th><th>投球回</th><th>安打</th><th>本塁打</th>
<th>四球</th><th>死球</th><th>三振</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th><th>防御率</th></tr></thead>
<tbody>
<tr class="registerStats"><td class="year"> 2024 </td><td class="team">福岡ソフトバンク</td>
<td>5</td><td>3</td><td>1</td><td>0</td><td>0</td><td>0</td><td>1</td>
<td>1</td><td>1</td><td>.750</td><td>120</td>${PITCH_INNINGS}<td>25</td><td>2</td>
<td>8</td><td>1</td><td>30</td><td>0</td><td>0</td><td>9</td><td>8</td><td>2.51</td></tr>
</tbody>
<tfoot><tr><th class="year"></th><th class="team">通　算</th>
<th>5</th><th>3</th><th>1</th><th>0</th><th>0</th><th>0</th><th>1</th>
<th>1</th><th>1</th><th>.750</th><th>120</th>
<th><table class="table_inning"><tbody><tr><th>28</th><td>.2</td></tr></tbody></table></th>
<th>25</th><th>2</th>
<th>8</th><th>1</th><th>30</th><th>0</th><th>0</th><th>9</th><th>8</th><th>2.51</th></tr></tfoot>
</table>`;
  return `<html><body><div id="pc_stats_wrapper">${bat}${pit}</div></body></html>`;
}

test("연도별 타격을 읽는다 — 개수만 담고 비율은 담지 않는다", () => {
  const c = parseCareer(page());
  assert.equal(c.batting.length, 2);
  const first = c.batting[0]!;
  assert.equal(first.year, 2024);
  assert.equal(first.team, "阪 神");
  assert.equal(first.h, 98);
  assert.equal(first.hr, 12);
  // ⚠**盗塁刺는 박스스코어에 없다** — 이 표가 유일한 공표 출처다
  assert.equal(first.cs, 1);
  assert.equal(first.gidp, 8);
});

/**
 * ⚠**중첩 표가 두 층에서 파서를 망가뜨렸다**(2026-08-17).
 * 1. 행을 자르는 `<tr>…</tr>` 가 **안쪽 `</tr>`** 에서 먼저 닫혔다
 * 2. 칸을 자르는 `<td>…</td>` 가 **안쪽 `</th>`** 에서 먼저 닫혔다
 * 둘 다 「칸 수가 안 맞으면 건너뛴다」에 삼켜져 **오류 0으로 투수 514명분이 사라졌다.**
 */
test("⚠중첩 표 안의 投球回를 읽는다 — 여기서 투수 전원이 조용히 사라졌었다", () => {
  const c = parseCareer(page());
  assert.equal(c.pitching.length, 1, "투수 행이 통째로 사라졌다 — 중첩 표에서 잘렸다");
  const p = c.pitching[0]!;
  // 28.2回 = 86아웃. **이닝이 아니라 아웃으로 담는다**
  assert.equal(p.outs, 86, "28.2回를 86아웃으로 읽지 못했다");
  assert.equal(p.games, 5);
  assert.equal(p.w, 3);
  assert.equal(p.so, 30);
  assert.equal(p.er, 8);
  assert.equal(p.bf, 120);
});

/**
 * ⚠**열 이름이 하나만 바뀌어도 던진다**(M7).
 *
 * 처음에는 「아는 열이 절반 미만이면」이었고, 그래서 **아무것도 못 물었다** —
 * 실제 마크업 변경은 한두 칸이다. 실측(2026-08-17 이중 검토):
 * `年度` 하나만 바꾸면 **행 0건**, `本塁打` 하나만 바꾸면 **통산 홈런 0**,
 * `盗塁刺` 하나만 바꾸면 **도루자 51 → 0**. **셋 다 오류 없이** 그렇게 됐다.
 */
test("⚠열 이름이 하나만 바뀌어도 던진다 — 빈 값으로 흘리지 않는다(M7)", () => {
  for (const [label, replaced] of [["安打", "ヒット"], ["盗塁刺", "CS"], ["年度", "Year"]] as const) {
    const one = page().replace(new RegExp(`<th(?: class="year")?>${label}</th>`), `<th>${replaced}</th>`);
    assert.throws(() => parseCareer(one), /있어야 할 열이 없다/, `${label} 하나를 바꿨는데 안 던졌다`);
  }
});

/**
 * ⚠**NPB 는 합계 행을 싣는다** — 처음에 「없다(실측 0/980)」고 적었는데 틀린 판정이었다.
 * `<td>通算</td>` 를 찾았지만 실제로는 `<tfoot>` 의 `<th class="team">通　算</th>`(전각 공백)이고,
 * 다시 재니 **980/980** 이다(2026-08-17 이중 검토 지적).
 *
 * ⚠**그 값을 표시에 쓰지는 않는다** — 통산은 우리가 더한다. 대신 **검산에 쓴다.**
 * 이것이 이 파서에서 가장 싼 안전장치다: 행이 잘리든 칸이 밀리든 그 자리에서 걸린다.
 */
test("⚠우리 합이 NPB 공표 합계와 어긋나면 던진다", () => {
  // 정상 페이지는 통과한다
  assert.doesNotThrow(() => parseCareer(page()));

  // 본문 행 하나를 지우면 합계가 안 맞는다
  const short = page().replace(/<tr class="registerStats">[\s\S]*?<\/tr>/, "");
  assert.throws(() => parseCareer(short), /공표 합계와 어긋난다/, "행이 사라졌는데 안 던졌다");
});

/** 표가 없는 선수도 있다 — 던지지 않고 빈 배열이다 */
test("표가 없으면 빈 배열이다", () => {
  const c = parseCareer(page({ pit: false }));
  assert.equal(c.pitching.length, 0);
  assert.equal(c.batting.length, 2, "한쪽이 없다고 다른 쪽까지 잃었다");
});

/**
 * ⚠**통산은 우리가 더한다.** NPB 도 합계 행을 싣지만(실측 980/980),
 * 그 값은 **검산에만** 쓴다 — 남의 계산값을 그대로 싣지 않는다.
 */
test("⚠통산 합계를 우리가 더한다", () => {
  const c = parseCareer(page());
  const t = careerTotal(c.batting, ["games", "pa", "ab", "h", "hr", "rbi", "cs"]);
  assert.equal(t["games"], 140);
  assert.equal(t["h"], 133);
  assert.equal(t["hr"], 16);
  assert.equal(t["cs"], 1);
});

/**
 * ⚠**「몇 시즌」은 행 수가 아니다.** 시즌 도중 이적하면 한 해에 여러 줄이 된다 —
 * 행으로 세면 그 선수만 한 시즌 더 뛴 것이 된다.
 */
test("⚠시즌 수는 연도로 센다 — 이적한 해를 두 번 세지 않는다", () => {
  const rows = [{ year: 2024 }, { year: 2025 }, { year: 2025 }];
  assert.equal(seasonsPlayed(rows), 2);
  assert.equal(rows.length, 3, "픽스처가 이적을 담고 있지 않다 — 이 시험이 공회전한다");
});
