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

const TIE_RULE =
  "勝率が同じ場合は当該球団間の対戦成績で上位を決めます。それでも並ぶときは同順位として表示します" +
  "（NPBの規定では次に前年度順位を使いますが、当サイトは2025年からのデータしか持たないため使えません）。";

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
  const at = out.indexOf('class="rail"');
  assert.ok(at > 0, "조작 레일이 없다");
  return out.slice(at, out.indexOf("</nav>", at));
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
  const teamPanel = /data-panelgroup="ranktype" data-panelkey="team" role="tabpanel" >/.exec(out);
  const personalPanel = /data-panelgroup="ranktype" data-panelkey="personal" role="tabpanel" hidden>/.exec(out);
  assert.notEqual(teamPanel, null, "팀 패널이 열려 있지 않다");
  assert.notEqual(personalPanel, null, "개인 패널이 닫혀 있지 않다");
  assert.ok(teamPanel!.index < personalPanel!.index, "팀 순위표가 문서 뒤쪽에 있다");
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
  assert.equal(out.match(/<em>同<\/em>/g)?.length, 2, "동률 표시가 두 팀에 붙지 않았다");
});

test("동률이 아니면 「同」이 없다", () => {
  const out = renderRankingPage(data(), context());
  assert.ok(!out.includes("<em>同</em>"));
});

test("⚠구단 로고를 쓰지 않는다 — 기록은 사실이지만 로고는 상표다", () => {
  const out = renderRankingPage(data(), context());
  assert.ok(!/<img/.test(out), "이미지 태그가 들어갔다");
  assert.match(out, /class="l tm"><i><\/i><a href="teams\/t\.html">阪神<\/a>/, "색 마크로 구단을 구별하지 않는다");
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
