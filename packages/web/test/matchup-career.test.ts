/**
 * **対戦成績의 「今季 / 通算」 전환.**
 *
 * ## ⚠지표를 두 번 골랐다 — 첫 번째 지표가 질문에 답하지 않았다
 *
 * 다른 축과 같은 잣대(**얇은 칸의 비율**)로 재고 「통산이 못 고친다」고 판정할 뻔했다:
 * 화면 임계(10타석) 미만이 **今季 91.6% → 通算 82.0%** 이고 **대전 타석 중앙값은 3으로 그대로**다.
 * 상대 투수가 매년 바뀌어, 깊어지는 만큼 얕은 새 쌍이 늘기 때문이다.
 *
 * ⚠**그런데 이 표는 분모를 달고 얇은 행을 그대로 싣는 표다** — 「얇은 행의 비율」은
 * 애초에 결함이 아니다. 물어야 할 것은 **「시즌 화면에 원리적으로 존재할 수 없는 행이
 * 생기는가」**였다. 실측(2025 · 규정타석급 40명):
 *
 * | 30타석 이상인 대전 | 今季 | 通算 |
 * |---|---|---|
 * | 행 수 | **0** | **382** |
 * | 타자당 중앙 | 0 | **7** |
 * | 한 행도 없는 타자 | **40/40** | 11/40 |
 * | 한 쌍 최대 타석 | **27** | **105** |
 *
 * **今季는 한 쌍 최대가 27타석이라 30을 넘는 행이 하나도 없다.**
 *
 * ⚠**바이트 걱정도 압축 전 수였다.** 가장 큰 선수 페이지 실측 **178.7 KB → gzip 22.0 KB(8.1배)** —
 * 반복이 많은 표라 전송량은 +30 KB 남짓이고, Pages 상한은 **파일 수**라 이 변경은 안 건드린다.
 *
 * ## 이 시험이 지키는 것 — **두 표가 서로를 안 움직이는가**
 *
 * `stableTable` 의 DOM 은 `id` 에서 기계적으로 나온다(`<id>Filter`·`<id>Table`…).
 * 좁히기 상태도 **그룹 이름**으로 갈린다(`state.tabs[minGroup]`).
 * **하나라도 겹치면 「今季에서 10타석 이상」이 通算 탭에도 걸린다** — 임계의 뜻이 범위마다 다른데도.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import type { MatchupRow } from "../src/player-page.ts";
import { BATTING_LINE, context, playerPage, r } from "./fixtures.ts";

function blockOf(html: string, id: string): string {
  const m = new RegExp(`<section class="block"[^>]*id="b-${id}"[\\s\\S]*?\\n</section>`).exec(html);
  assert.notEqual(m, null, `#b-${id} 구획이 없다`);
  return m![0];
}

function row(id: string, name: string, team: string, pa: number): MatchupRow {
  return {
    opponentId: id,
    opponentName: name,
    opponentTeam: team,
    line: { ...BATTING_LINE, pa, ab: pa, h: Math.floor(pa / 3) },
    avg: r(Math.floor(pa / 3) / pa, pa),
    rbi: 1,
  };
}

const CAREER = {
  rows: [row("9001", "通算相手A", "g", 47), row("9002", "通算相手B", "db", 31), row("9003", "通算相手C", "c", 8)],
  span: { from: 2018, to: 2026 },
};

test("통산 대전이 있으면 두 범위가 탭으로 나온다", () => {
  const b = blockOf(renderPlayerPage(playerPage({ matchupsCareer: CAREER }), context()), "matchup");
  assert.match(b, /data-tabgroup="matchupScope"/, "범위 탭이 없다");
  assert.match(b, /通算相手A/, "통산 표의 행이 화면에 없다");
  assert.match(b, /data-stable="matchup"/, "시즌 표가 사라졌다");
  assert.match(b, /data-stable="matchupCareer"/, "통산 표가 없다");
});

/**
 * ⚠**여기가 급소다.** DOM id 나 좁히기 그룹이 하나라도 겹치면
 * 한쪽 표의 좁히기·정렬이 다른 쪽을 조용히 움직인다.
 */
test("⚠두 표가 DOM 도 좁히기 그룹도 겹치지 않는다", () => {
  const b = blockOf(renderPlayerPage(playerPage({ matchupsCareer: CAREER }), context()), "matchup");
  for (const part of ["Filter", "Table", "Count", "Empty"]) {
    const hits = [...b.matchAll(new RegExp(`id="matchup${part}"`, "g"))];
    assert.equal(hits.length, 1, `matchup${part} 가 ${hits.length}번 나왔다 — 두 표가 같은 DOM id 를 쓴다`);
    const career = [...b.matchAll(new RegExp(`id="matchupCareer${part}"`, "g"))];
    assert.equal(career.length, 1, `matchupCareer${part} 가 ${career.length}번이다`);
  }
  // 구단 선택 상자도 따로다
  assert.match(b, /id="matchupTeam"/);
  assert.match(b, /id="matchupCareerTeam"/);
  // 최소 타석 버튼줄의 그룹이 갈린다
  assert.match(b, /data-mingroup="matchupMin"/);
  assert.match(b, /data-mingroup="matchupCareerMin"/);
});

/** ⚠**「통산」이라는 말만으로는 어느 범위인지 알 수 없다** — 화면이 말한다 */
test("⚠통산 표가 보유 범위를 말하고, 시즌 표에는 안 붙는다", () => {
  const b = blockOf(renderPlayerPage(playerPage({ matchupsCareer: CAREER }), context()), "matchup");
  assert.match(b, /<b>2018〜2026年<\/b>を合算/, "통산 표에 보유 범위가 없다");
  const hits = [...b.matchAll(/を合算しています/g)];
  assert.equal(hits.length, 1, `범위 표기가 ${hits.length}번 — 통산 표 하나에만 붙어야 한다`);
});

/**
 * ⚠**통산이 없으면 이 변경 전과 DOM 이 한 글자도 달라지면 안 된다.**
 * 기존 시험들이 `matchupTable`·`matchupFilter` 같은 이름에 붙어 회귀 감시자로 남아 있다.
 */
test("⚠통산이 없으면 탭을 만들지 않는다 — 옛 DOM 그대로다", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "matchup");
  assert.ok(!/data-tabgroup="matchupScope"/.test(b), "통산이 없는데 탭이 생겼다");
  assert.ok(!/matchupCareer/.test(b), "통산 표의 흔적이 남았다");
  assert.match(b, /data-stable="matchup"/);
  assert.match(b, /data-mingroup="matchupMin"/);
});

/** ⚠빈 통산도 탭을 만들지 않는다 — 「通算」 탭을 눌렀는데 빈 표가 나오면 그게 더 나쁘다 */
test("⚠통산 행이 0건이면 탭을 만들지 않는다", () => {
  const b = blockOf(
    renderPlayerPage(playerPage({ matchupsCareer: { rows: [], span: { from: 2018, to: 2026 } } }), context()),
    "matchup",
  );
  assert.ok(!/data-tabgroup="matchupScope"/.test(b), "빈 통산으로 탭을 만들었다");
});

/**
 * ⚠**통산에는 그 시즌 페이지가 없는 상대가 섞인다** — 은퇴하거나 그해 1군 기록이 없는 사람이다.
 * 링크를 걸면 **404** 이고, 실측(2026 화면)으로 그런 상대가 **투수 523명 · 타자 651명**이다.
 * ⚠**행은 지우지 않는다** — 그 대전은 실제로 있었다. **이름만 링크가 아니게 둔다.**
 */
test("⚠그 시즌 페이지가 없는 상대는 링크를 걸지 않는다 — 404 가 된다", () => {
  const gone = { ...row("9900", "引退した投手", "", 24), noPage: true as const };
  const b = blockOf(
    renderPlayerPage(
      playerPage({ matchupsCareer: { rows: [...CAREER.rows, gone], span: { from: 2018, to: 2026 } } }),
      context(),
    ),
    "matchup",
  );
  assert.match(b, /引退した投手/, "행이 통째로 사라졌다 — 그 대전은 실제로 있었다");
  assert.ok(!/href="9900\.html"/.test(b), "페이지가 없는 상대에 링크를 걸었다 — 404 다");
  // 페이지가 있는 상대는 여전히 링크다
  assert.match(b, /href="9001\.html"/, "정상 상대의 링크가 사라졌다");
});

/** ⚠**구단을 모르면 빈 칸이 아니라 「모름」이다**(M11) — 빈 칸은 「소속이 없다」로 읽힌다 */
test("⚠구단을 모르는 상대는 빈 칸이 아니라 모름 표시다", () => {
  const gone = { ...row("9900", "引退した投手", "", 24), noPage: true as const };
  const b = blockOf(
    renderPlayerPage(
      playerPage({ matchupsCareer: { rows: [gone], span: { from: 2018, to: 2026 } } }),
      context(),
    ),
    "matchup",
  );
  assert.ok(
    !/<td class="l"><\/td>/.test(b),
    "구단 칸이 비어 있다 — 「어느 팀인가」에 답할 수 없다(M11)",
  );
});

/** ⚠분모는 범위마다 자기 것을 낸다(M2) — 시즌 건수를 통산 표에 쓰면 거짓이 된다 */
test("⚠건수가 범위마다 따로 나온다", () => {
  const b = blockOf(renderPlayerPage(playerPage({ matchupsCareer: CAREER }), context()), "matchup");
  assert.match(b, /id="matchupCount" data-stable-count>2件<\/span> \/ 全2件/, "시즌 건수가 2가 아니다");
  assert.match(b, /id="matchupCareerCount" data-stable-count>3件<\/span> \/ 全3件/, "통산 건수가 3이 아니다");
});
