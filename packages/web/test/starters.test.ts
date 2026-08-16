import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStartersPage } from "../src/pages.ts";
import type { ProbableGame, ProbableSide, StartersPageData } from "../src/pages.ts";
import { colorOf } from "@bb-app/domain";
import { context, r } from "./fixtures.ts";

function side(over: Partial<ProbableSide> = {}): ProbableSide {
  return {
    teamCode: "d",
    teamName: "中日ドラゴンズ",
    shortName: "中日",
    color: colorOf("d"),
    playerId: "63165134",
    name: "柳",
    summary: { games: 19, outs: 354, era: r(2.52, 354), whip: r(1.12, 354), fip: r(3.12, 354), so: 96 },
    opponents: [
      {
        opponentId: "71575132",
        opponentName: "泉口",
        opponentTeam: "g",
        line: { pa: 6, ab: 6, h: 3, double: 1, triple: 0, hr: 1, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 1, roe: 0 },
        avg: r(0.5, 6),
        rbi: 2,
      },
      {
        opponentId: "71575133",
        opponentName: "吉川",
        opponentTeam: "g",
        line: { pa: 3, ab: 3, h: 3, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0 },
        avg: r(1, 3),
        rbi: 1,
      },
    ],
    ...over,
  };
}

function pending(): ProbableSide {
  return side({
    teamCode: "g",
    teamName: "読売ジャイアンツ",
    shortName: "巨人",
    color: colorOf("g"),
    playerId: null,
    name: null,
    summary: null,
    opponents: [],
  });
}

function game(over: Partial<ProbableGame> = {}): ProbableGame {
  return {
    venue: "バンテリンドーム",
    startTime: "13:30",
    league: "cl",
    sides: [side(), pending()],
    ...over,
  };
}

function data(over: Partial<StartersPageData> = {}): StartersPageData {
  return { gameDate: "2026-08-16", builtOn: "2026-08-15", games: [game()], ...over };
}

test("경기와 구장·시각을 낸다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /中日 対 巨人/);
  assert.match(out, /バンテリンドーム 13:30/);
});

test("⚠「오늘」이라고 단정하지 않는다 — 예고는 내일분인 경우가 많다", () => {
  const tomorrow = renderStartersPage(data(), context());
  assert.match(tomorrow, /2026年8月16日の試合/);
  assert.ok(!tomorrow.includes("（本日）"), "생성일과 다른데 「本日」가 붙었다");

  const today = renderStartersPage(data({ builtOn: "2026-08-16" }), context());
  assert.match(today, /2026年8月16日（本日）の試合/);
});

test("미발표는 「投手なし」가 아니라 「まだ発表されていません」다(M11)", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /先発はまだ発表されていません/);
});

test("예고가 하나도 없으면 화면이 그렇다고 말한다", () => {
  const out = renderStartersPage(data({ gameDate: null, games: [] }), context());
  assert.match(out, /予告先発はまだ発表されていません/);
  assert.match(out, /発表待ち/);
});

test("투수 성적의 분모는 이닝이다 — 아웃 카운트를 그대로 쓰지 않는다", () => {
  const out = renderStartersPage(data(), context());
  assert.ok(out.includes('<span class="den">118回</span>'), "354아웃이 118이닝으로 나오지 않았다");
  assert.ok(!out.includes("354投球回"));
});

test("상대 타자 표는 상대 팀 이름을 머리에 쓴다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /<th class="l">巨人の打者<\/th>/);
});

test("상대 타자 링크는 이 투수와의 대전을 연 채로 간다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(
    out,
    new RegExp(`players/71575132\\.html\\?vs=${encodeURIComponent("柳")}#b-matchup`),
  );
});

test("표본이 얇은 행은 시각적 무게를 뺀다 — 값은 남는다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /<tr class="thin">[\s\S]*?吉川/);
  assert.match(out, /1\.000/);
});

test("대전 이력이 없으면 없다고 말한다", () => {
  const out = renderStartersPage(
    data({ games: [game({ sides: [side({ opponents: [] }), pending()] })] }),
    context(),
  );
  assert.match(out, /巨人の打者との対戦記録はまだありません/);
});

test("라인업을 아는 척하지 않는다고 화면이 밝힌다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /打順は試合前には分からない/);
  assert.match(out, /試合中の情報は取得していません/);
});

test("헤더에서 부모 항목(試合)을 켠다 — 予告先発은 그 자식 화면이다", () => {
  const out = renderStartersPage(data(), context());
  // ⚠**어느 항목도 안 켜진 상태로 두지 않는다.** 「지금 어디인가」가 사라지면
  // 내비게이션이 방향을 잃는다. 予告先発은 「試合」 아래에 있으므로 그쪽을 켠다
  assert.match(out, /<a href="today\.html" aria-current="page">試合<\/a>/);
  assert.equal(out.match(/aria-current="page"/g)?.length, 1, "켜진 항목이 하나가 아니다");
});

// ── 대전 카드 버튼 ────────────────────────────────────────────────────────

function threeGames(): StartersPageData {
  return data({
    games: [
      game(),
      game({
        venue: "神宮",
        startTime: "18:00",
        sides: [
          side({ teamCode: "s", shortName: "ヤクルト", color: colorOf("s") }),
          side({ teamCode: "db", shortName: "DeNA", color: colorOf("db") }),
        ],
      }),
      game({
        venue: "ベルーナドーム",
        startTime: "17:00",
        sides: [
          side({ teamCode: "l", shortName: "西武", color: colorOf("l") }),
          side({ teamCode: "m", shortName: "ロッテ", color: colorOf("m") }),
        ],
      }),
    ],
  });
}

test("경기 수만큼 버튼이 생긴다 — 실제 대전 카드 기준이다", () => {
  const out = renderStartersPage(threeGames(), context());
  const tabs = [...out.matchAll(/class="card[^"]*"[^>]*data-tab="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ["d-g", "s-db", "l-m", "all"]);
});

test("버튼 키는 팀 코드 쌍이다 — 순번이나 구장이면 다음날 엉뚱한 경기를 가리킨다", () => {
  const out = renderStartersPage(threeGames(), context());
  assert.match(out, /data-tab="d-g"/);
  assert.ok(!out.includes('data-tab="0"'), "순번을 키로 쓰고 있다");
});

test("버튼에 양 팀 색과 카드 이름·시각이 들어간다", () => {
  const out = renderStartersPage(threeGames(), context());
  const card = /<button class="card"[\s\S]*?<\/button>/.exec(out)?.[0] ?? "";
  assert.ok(card.includes(colorOf("d").base), "왼쪽 팀 색이 없다");
  assert.ok(card.includes(colorOf("g").base), "오른쪽 팀 색이 없다");
  assert.match(card, /中日 − 巨人/);
  assert.match(card, /13:30 バンテリンドーム/);
});

test("첫 경기만 열려 있고 나머지는 접혀 있다 — JS가 없어도 하나는 보인다", () => {
  const out = renderStartersPage(threeGames(), context());
  const panels = [...out.matchAll(/data-panelgroup="starters" data-panelkey="([a-z-]+)"([^>]*)>/g)];
  assert.deepEqual(
    panels.map(([, key, attrs]) => [key, attrs!.includes("hidden")]),
    [
      ["d-g", false],
      ["s-db", true],
      ["l-m", true],
    ],
  );
});

test("「すべて」 버튼이 있다 — 골라 보는 화면에서 전부 보기를 뺏지 않는다", () => {
  const out = renderStartersPage(threeGames(), context());
  assert.match(out, /data-tab="all"[^>]*aria-selected="false"/);
  assert.match(out, /すべて<\/b><s>3試合/);
});

test("예고가 없으면 버튼도 없다", () => {
  const out = renderStartersPage(data({ gameDate: null, games: [] }), context());
  assert.ok(!out.includes('class="cards"'));
});
