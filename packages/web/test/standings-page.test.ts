/**
 * 팀 순위표 화면.
 *
 * ⚠**여기서 지키는 것은 「규칙을 화면이 말하는가」다**(M2·M3).
 * 승률의 정의와 동률 규칙이 코드에만 있으면, 다른 사이트와 순위가 어긋났을 때
 * 그것이 버그인지 규칙 차이인지 아무도 구별할 수 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRankingPage } from "../src/pages.ts";
import type { LeagueSection, RankingPageData, StandingRow } from "../src/pages.ts";
import { colorOf } from "@bb-app/domain";
import { context, rankingPanel } from "./fixtures.ts";
import type { RankingPanel, RankingRow } from "../src/player-page.ts";
import { rankingRowsFor } from "../src/query.ts";
/**
 * ⚠**세 벌째를 만들지 않는다**(2026-08-19 T7 검토 ⓓ). 동률 규칙 문장은 `parts.ts` 에 한 벌 있고
 * 순위표(`query.ts`)와 구단 목록(`teams-page.ts`)이 그것을 쓴다 —
 * 픽스처가 자기 사본을 들면 **본문이 바뀌어도 이 시험은 옛 문장을 지킨다.**
 */
import { TIE_RULE } from "../src/parts.ts";

function row(over: Partial<StandingRow> = {}): StandingRow {
  return {
    teamCode: "t",
    name: "阪神タイガース",
    shortName: "阪神",
    color: colorOf("t"),
    rank: 1,
    tiedRank: false,
    games: 104,
    w: 58,
    l: 45,
    t: 1,
    pct: 58 / 103,
    gamesBehind: 0,
    rf: 392,
    ra: 332,
    avg: { value: 0.245, denominator: 3480 },
    era: { value: 2.93, denominator: 2802 },
    home: { w: 25, l: 24, t: 1 },
    away: { w: 33, l: 21, t: 0 },
    last10: { w: 5, l: 5, t: 0 },
    ...over,
  };
}

function data(over: Partial<RankingPageData> = {}): RankingPageData {
  return {
    season: 2026,
    asOf: "2026-08-14",
    standings: [
      {
        id: "central",
        name: "セントラル・リーグ",
        rows: [
          row(),
          row({ teamCode: "g", name: "読売ジャイアンツ", shortName: "巨人", color: colorOf("g"), rank: 2, w: 56, l: 47, t: 2, pct: 56 / 103, gamesBehind: 2, rf: 348, ra: 335 }),
        ],
      },
    ],
    tieRule: TIE_RULE,
    /** ⚠**기본은 비어 있다** — 引き分けの解剖 구획은 그것을 시험하는 곳에서만 켠다 */
    draws: [],
    leagues: [],
    ...over,
  };
}

/** 개인 순위 한 리그분. 갈래가 생기려면 팀·개인이 **둘 다** 있어야 한다 */
function league(id = "central", name = "セントラル・リーグ"): LeagueSection {
  return {
    id,
    name,
    categories: [{ id: "batter", label: "打者", panels: [rankingPanel()] }],
  };
}

const split = (): RankingPageData => data({ leagues: [league()] });

/**
 * 조작 레일 한 줄만 잘라낸다.
 * ⚠**페이지 껍데기에도 `</nav>`가 있다.** 문서 첫 `</nav>`로 자르면 레일에 닿기 전에 끝나
 * 「탭줄이 0개」라는 무의미한 통과/실패가 나온다(2026-08-16에 실제로 그랬다).
 */
function railOf(out: string): string {
  const at = out.indexOf('<div class="rail"');
  assert.ok(at > 0, "조작 레일이 없다");
  /**
   * ⚠**닫는 자리를 세어서 자른다.** 예전에는 첫 `</nav>` 로 잘랐는데, 레일이
   * `<nav>` 를 그만두면서(2026-08-20 감사 ⑤ — 링크 0개인 랜드마크였다)
   * 그 표식이 사라져 **푸터의 `</nav>` 까지 통째로 들어왔다.**
   */
  let depth = 0;
  for (let i = at; i < out.length; i++) {
    if (out.startsWith("<div", i) && /[\s>]/.test(out[i + 4] ?? "")) depth++;
    else if (out.startsWith("</div>", i)) {
      depth--;
      if (depth === 0) return out.slice(at, i);
    }
  }
  return assert.fail("레일이 닫히지 않았다");
}

test("팀 순위가 먼저 열린다 — 「順位」를 누른 사람이 먼저 찾는 것이다", () => {
  const out = renderRankingPage(split(), context());
  const team = out.indexOf('data-tab="team"');
  const personal = out.indexOf('data-tab="personal"');
  assert.ok(team > 0 && personal > team, "チーム/個人 갈래가 없거나 순서가 뒤집혔다");
  assert.match(
    out.slice(team - 120, team + 60),
    /data-tab="team" aria-selected="true"/,
    "첫 화면에서 선택된 것이 팀이 아니다",
  );
});

test("⚠갈래를 나눠도 JS 없이 팀 순위는 보인다 — 열린 패널이 팀 쪽이다", () => {
  const out = renderRankingPage(split(), context());
  // ⚠**속성 순서에 기대지 않는다.** 여는 태그에 hidden 이 있는가만 본다 —
  // aria-controls/aria-labelledby 를 더했을 때 이 시험이 깨졌는데, 재려던 것(열림 여부)은
  // 그대로였다(2026-08-17). 속성이 늘 때마다 깨지는 시험은 무엇도 지키지 못한다
  const find = (key: string): { tag: string; at: number } => {
    // ⚠**role="tabpanel" 로 좁힌다** — 같은 그룹을 쓰는 follower(패널이 아닌 추종 자리)가
    // 있어서, 그것까지 잡으면 엉뚱한 div 의 위치를 재게 된다
    const m = new RegExp(
      `<div[^>]*data-panelgroup="ranktype"[^>]*data-panelkey="${key}"[^>]*role="tabpanel"[^>]*>`,
    ).exec(out);
    assert.notEqual(m, null, `${key} 패널이 없다`);
    return { tag: m![0], at: m!.index };
  };
  const team = find("team");
  const personal = find("personal");
  assert.ok(!team.tag.includes("hidden"), "팀 패널이 열려 있지 않다");
  assert.ok(personal.tag.includes("hidden"), "개인 패널이 닫혀 있지 않다");
  assert.ok(team.at < personal.at, "팀 순위표가 문서 뒤쪽에 있다");
});

test("⚠개인 순위가 없으면 갈래를 만들지 않는다 — 눌러도 빈 탭은 고장으로 읽힌다", () => {
  const out = renderRankingPage(data(), context()); // leagues: []
  assert.ok(!out.includes('data-tab="personal"'), "빈 개인 탭이 나왔다");
  assert.match(out, /チーム順位/);
});

test("⚠리그 탭은 個人 안에서만 보인다 — 팀 순위는 두 리그를 함께 보는 화면이다", () => {
  const out = renderRankingPage(split(), context());
  const rail = railOf(out);
  const sub = rail.indexOf('data-panelgroup="ranktype" data-panelkey="personal"');
  assert.ok(sub > 0, "리그 탭줄이 갈래를 따라 열리고 닫히지 않는다");
  assert.ok(rail.slice(sub).includes('data-tabgroup="rankleague"'), "리그 탭줄이 그 안에 없다");
  assert.ok(rail.slice(sub, sub + 80).includes("hidden"), "첫 화면부터 리그 탭이 보인다");
  // ⚠**이 자리는 패널이 아니다.** 안에 든 것이 탭줄인데 `tabpanel`이라고 하면
  // 「패널을 열었더니 또 탭」이 되어 스크린리더에게 구조를 잘못 말한다
  assert.ok(!rail.slice(sub, sub + 80).includes("tabpanel"), "레일의 탭줄 자리를 패널이라고 말했다");
});

test("⚠개인 순위로 바로 오는 깊은 링크가 존재한다 — 닫힌 탭 안은 스스로 열려야 한다", () => {
  const out = renderRankingPage(split(), context());
  assert.ok(out.includes('id="lg-central"'), "리그 구획에 링크할 자리가 없다");
});

test("⚠한 줄에 놓인 두 탭줄은 이름이 다르다 — 같으면 스크린리더가 구별할 수 없다", () => {
  const out = renderRankingPage(split(), context());
  const labels = [...railOf(out).matchAll(/role="tablist"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, `레일 안 탭줄이 ${labels.length}개`);
  assert.notEqual(labels[0], labels[1]);
  // ⚠**이름이 무엇을 바꾸는지 말해야 한다.** 기본값 「表示の切り替え」는 서로 다르기만 할 뿐
  // 어느 쪽이 리그인지 알려주지 않는다
  assert.deepEqual(labels, ["順位の種類", "リーグ"]);
});

test("⚠승률의 정의를 화면에 적는다 — 분모에 무승부가 없다는 사실이 값만으로는 안 보인다(M2)", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, /勝率は 勝 ÷（勝＋敗）/);
  assert.match(out, /引き分けは分母に入れません/);
});

test("⚠동률 처리 규칙을 화면에 적고, 쓰지 않는 단계까지 밝힌다(M3)", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, /当該球団間の対戦成績/);
  assert.match(out, /前年度順位/, "쓰지 않는 규칙과 그 이유를 말하지 않았다");
});

test("交流戦을 포함한다는 사실을 적는다 — 빼는 사이트와 값이 다를 수 있다", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, /交流戦の試合もリーグ順位に含めています/);
});

test("승률은 야구 표기다 — 선행 0을 지운 소수 3자리", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, />\.563</, "승률이 .563으로 나오지 않았다");
});

test("1위의 게임 차는 「—」다 — 0.0이라고 쓰면 0게임 뒤진 것처럼 읽힌다", () => {
  const out = renderRankingPage(data(), context());
  const first = out.slice(out.indexOf("阪神"), out.indexOf("巨人"));
  assert.match(first, /<td>—<\/td>/);
});

test("동률이면 「同」을 붙인다 — 같은 순위가 둘 있다는 사실이 보여야 한다", () => {
  const out = renderRankingPage(
    data({
      standings: [
        {
          id: "central",
          name: "セントラル・リーグ",
          rows: [row({ rank: 1, tiedRank: true }), row({ teamCode: "g", shortName: "巨人", color: colorOf("g"), rank: 1, tiedRank: true })],
        },
      ],
    }),
    context(),
  );
  /**
   * ⚠**홈의 순위표와 통합하면서 어법이 `<s>` 로 바뀌었다**(2026-08-18 유저 요청).
   * 태그가 아니라 **「동률이 두 팀에 보인다」**가 이 시험이 지키는 것이다.
   */
  assert.equal(out.match(/<s>同<\/s>/g)?.length, 2, "동률 표시가 두 팀에 붙지 않았다");
});

test("동률이 아니면 「同」이 없다", () => {
  const out = renderRankingPage(data(), context());
  assert.ok(!out.includes("<s>同</s>"));
});

test("⚠구단 로고를 쓰지 않는다 — 기록은 사실이지만 로고는 상표다", () => {
  const out = renderRankingPage(data(), context());
  assert.ok(!/<img/.test(out), "이미지 태그가 들어갔다");
  /**
   * ⚠**홈과 같은 칩(`.hteam`)을 쓴다**(2026-08-18 유저 요청으로 통합).
   * 지키는 것은 「로고가 아니라 **우리가 고른 색**으로 구단을 구별한다」이고,
   * 그 색이 인라인 커스텀 속성으로 실제로 실렸는지까지 본다.
   */
  assert.match(
    out,
    /class="hteam" href="teams\/t\.html"[\s\S]{0,80}?--chip:#[0-9a-f]{6}[\s\S]{0,40}?<i><\/i>阪神/,
    "색 마크로 구단을 구별하지 않는다",
  );
});

/**
 * ⚠**팀명을 누르면 갈 곳이 있어야 한다.** 지금까지 목적지가 없어서, 팀을 보려면
 * 순위표의 한 줄과 선수 일람의 한 덩어리를 **머리에서 합쳐야** 했다.
 */
test("팀명이 그 팀의 화면으로 간다", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, /href="teams\/t\.html"/);
  assert.match(out, /href="teams\/g\.html"/);
});

test("홈·원정·직전10경기를 승패무 세 자리로 낸다 — 무승부가 0이어도 자리를 비우지 않는다", () => {
  const out = renderRankingPage(data(), context());
  assert.match(out, />25-24-1</, "홈 성적");
  assert.match(out, />33-21-0</, "원정 성적(무승부 0을 생략하면 열이 흔들린다)");
  assert.match(out, />5-5-0</, "직전 10경기");
});

test("팀 순위표가 없으면 그 자리를 통째로 비운다 — 빈 표를 남기지 않는다", () => {
  const out = renderRankingPage(data({ standings: [] }), context());
  assert.ok(!out.includes("チーム順位"));
});

/**
 * ⚠**「規定到達のみ / 全員」 전환**(2026-08-17 유저 요청).
 *
 * 지키는 것 넷:
 * 1. **기본은 지금까지와 같은 화면**이다 — 미달 행은 서버가 `hidden` 으로 보낸다.
 *    스크립트가 없으면 그대로 숨은 채이고, 그것이 오늘까지의 순위표다(§0-1).
 * 2. **전환하면 실제로 나올 사람이 실려 있어야 한다.** 규정 도달자 상위 N만 실으면
 *    눌러도 아무도 안 나타나 「고장난 버튼」이 된다 — 打率처럼 미달자가 상위를 채우는
 *    지표에서는 두 목록이 거의 겹치지 않는다.
 * 3. **두 순위를 서버가 다 보낸다.** 클라이언트가 다시 매기면 동률 규칙이 갈린다(M3).
 * 4. **자격 기준이 없는 지표에는 버튼을 두지 않는다.** 홈런왕에 규정타석은 걸리지 않으므로
 *    눌러도 아무것도 안 사라진다.
 */
function panelWithUnqualified(id = "wrcPlus"): RankingPanel {
  const base = rankingPanel();
  return {
    ...base,
    id,
    rows: [
      ...base.rows.map((r, i) => ({ ...r, rank: i + 1, rankAll: i + 2 })),
      // 규정 미달인데 값은 더 좋다 — 전원 순위에서는 1위
      {
        rank: null, rankAll: 1, playerId: "sub", name: "代打",
        teamCode: "g", value: { value: 999, denominator: 12 }, isMe: false,
      },
    ],
  };
}

function withPanel(p: RankingPanel): string {
  return renderRankingPage(
    data({
      leagues: [{ id: "central", name: "セントラル・リーグ", categories: [{ id: "batter", label: "打者", panels: [p] }] }],
    }),
    context(),
  );
}

test("⚠규정 미달 행은 처음부터 숨어 있다 — 스크립트가 없으면 지금까지와 같은 화면이다", () => {
  const out = withPanel(panelWithUnqualified());
  assert.match(out, /data-qualified="0"\s+hidden>/, "미달 행이 숨겨져 있지 않다");
  assert.ok(!/data-qualified="1"\s+hidden/.test(out), "도달자까지 숨겼다");
});

test("⚠전환 버튼이 있고, 눌렀을 때 나올 사람이 실제로 실려 있다", () => {
  const out = withPanel(panelWithUnqualified());
  assert.match(out, /data-rankonly="wrcPlus"/, "전환 버튼이 없다");
  assert.match(out, />代打</, "전환하면 나올 사람이 아예 안 실렸다 — 버튼이 아무 일도 안 한다");
});

test("⚠두 순위를 다 싣는다 — 클라이언트가 다시 매기지 않는다(M3)", () => {
  const out = withPanel(panelWithUnqualified());
  const at = out.indexOf(">代打<");
  assert.notEqual(at, -1);
  const row = out.slice(out.lastIndexOf("<tr", at), out.indexOf("</tr>", at));
  assert.match(row, /<b data-rankq>—<\/b>/, "규정 순위 자리가 「없음」이 아니다");
  assert.match(row, /<b data-ranka hidden>1<\/b>/, "전원 순위가 안 실렸다");
});

test("⚠자격 기준이 없는 지표에는 전환 버튼을 두지 않는다 — 눌러도 아무것도 안 사라진다", () => {
  const base = rankingPanel();
  const noQual: RankingPanel = {
    ...base,
    id: "hr",
    rows: base.rows.map((r, i) => ({ ...r, rank: i + 1, rankAll: i + 1 })),
  };
  const out = withPanel(noQual);
  assert.ok(!out.includes('data-rankonly="hr"'), "기준이 없는데 전환 버튼을 냈다");
});

/**
 * ⚠**「全員」으로 바꿨을 때 표가 순위 순으로 읽혀야 한다.**
 *
 * 두 결함이 겹쳐 있었다(2026-08-17 1차 검토 · 실측으로 재현):
 * 1. **상위 N을 먼저 자른 뒤** 그 안에서 「전원 상위 N」을 뽑고 있었다 —
 *    그래서 전원 순위 1~10위가 애초에 실리지 않았다(打率 패널이 **11위부터** 시작했다).
 * 2. 규정 도달자를 앞에 몰고 미달자를 뒤에 붙여서, 「全員」이
 *    11, 18, 19, … 87, 12, 13 순으로 읽혔다 — **순위표가 순위 순이 아니었다.**
 *
 * 고침: 자르기 **전에** 합집합을 고르고, 최종 정렬을 **전원 순위** 기준으로 둔다.
 * 규정 도달자만 남겨도 그 부분집합의 상대 순서는 그대로다(두 순위가 같은 값을
 * 같은 규칙으로 줄 세운 것이라 어긋날 수 없다).
 *
 * ⚠**여기서 재는 것은 고르는 함수 자체다.** 렌더러는 이제 받은 순서대로 그리기만 하므로,
 * 렌더 결과를 재면 픽스처가 정한 순서를 확인하는 꼴이 된다(한 번 그렇게 썼다가 알아챘다).
 */
function rankRow(over: Partial<RankingRow> & { playerId: string }): RankingRow {
  return {
    rank: null, rankAll: null, name: over.playerId, teamCode: "t",
    value: { value: 1, denominator: 100 }, isMe: false, ...over,
  };
}

test("⚠고른 행이 전원 순위 오름차순이고, 규정 도달자만 남겨도 오름차순이다", () => {
  // 규정 도달자 20명(전원 순위는 3부터) + 미달자 2명이 전원 1·2위
  const rows: RankingRow[] = [
    ...Array.from({ length: 20 }, (_, i) => rankRow({ playerId: `q${i}`, rank: i + 1, rankAll: i + 3 })),
    rankRow({ playerId: "sub1", rankAll: 1 }),
    rankRow({ playerId: "sub2", rankAll: 2 }),
  ];
  const got = rankingRowsFor(rows, 5);
  assert.ok(got.length > 5, `${got.length}행뿐이다 — 두 세계에서 각각 뽑지 않았다`);

  const all = got.map((r) => r.rankAll ?? Number.MAX_SAFE_INTEGER);
  assert.deepEqual([...all].sort((a, b) => a - b), all, "전원 순위가 오름차순이 아니다");
  assert.equal(all[0], 1, "전원 1위가 안 실렸다 — 자르기 전에 고르지 않았다");

  const q = got.filter((r) => r.rank !== null).map((r) => r.rank ?? 0);
  assert.deepEqual([...q].sort((a, b) => a - b), q, "규정 순위가 오름차순이 아니다");
  assert.equal(q[0], 1, "규정 1위가 안 실렸다");
  assert.equal(q.length, 5, "규정 도달자를 상위 5명으로 자르지 않았다");
});

/** ⚠**값이 없는 지표는 예전대로 앞에서부터 자른다** — 「없음」 행이라도 보여야 한다(M11) */
test("값이 하나도 없는 지표는 행을 잃지 않는다", () => {
  const rows: RankingRow[] = Array.from({ length: 4 }, (_, i) => rankRow({ playerId: `n${i}` }));
  assert.equal(rankingRowsFor(rows, 3).length, 3);
});

/**
 * ⚠**「該当 N人」은 자르기 전의 수다**(작업규칙 7). 자른 뒤의 수를 쓰면
 * 「上位30人のみ表示（該当 30人）」처럼 **자른 적 없는 것처럼** 보인다.
 */
test("⚠「該当 N人」이 자르기 전의 규정 도달자 수다", () => {
  const base = rankingPanel();
  const p: RankingPanel = {
    ...base,
    rows: base.rows.map((r, i) => ({ ...r, rank: i + 1, rankAll: i + 1 })),
    qualifiedCount: 137,
    allCount: 240,
  };
  assert.match(withPanel(p), /該当 137人/, "자르기 전 수가 아니다");
});
