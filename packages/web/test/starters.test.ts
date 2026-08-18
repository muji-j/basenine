import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStartersPage } from "../src/pages.ts";
import { isNextProbable } from "../src/query.ts";
import type { ProbableGame, ProbableSide, StartersPageData } from "../src/pages.ts";
import { colorOf } from "@bb-app/domain";
import { context, pastSeasonContext, r } from "./fixtures.ts";

function side(over: Partial<ProbableSide> = {}): ProbableSide {
  return {
    teamCode: "d",
    teamName: "中日ドラゴンズ",
    shortName: "中日",
    color: colorOf("d"),
    playerId: "63165134",
    name: "柳",
    summary: { games: 19, outs: 354, era: r(2.52, 354), whip: r(1.12, 354), fip: r(3.12, 354), so: 96, srp: r(8.4, 461) },
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
    /**
     * ⚠**통산은 시즌보다 넓다** — 같은 상대가 더 많은 타석으로 나온다.
     *   두 표가 **정말 다른 값**을 내는지 시험이 보려면 값이 달라야 한다.
     */
    opponentsCareer: [
      {
        opponentId: "71575132",
        opponentName: "泉口",
        opponentTeam: "g",
        line: { pa: 24, ab: 22, h: 8, double: 2, triple: 0, hr: 2, bb: 2, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 5, roe: 0 },
        avg: r(8 / 22, 22),
        rbi: 6,
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
  return {
    heldFrom: 2019, defaultDate: "2026-08-16", prev: "2026-08-15", next: null, dayCount: 3, gameDate: "2026-08-16", builtOn: "2026-08-15", games: [game()], ...over };
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

/**
 * ⚠ **넘기는 것은 이름이 아니라 선수 ID 다**(M10 · 2026-08-18 감사 P2).
 * 이름으로 넘기면 그 페이지의 대전 표가 **동명이인을 함께** 걸어,
 * 「이 투수와의 성적」이라며 남의 기록이 섞인 표를 보여 준다.
 */
test("⚠상대 타자 링크는 이 투수를 ID로 지목한다 — 동명이인이 섞이지 않게", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /players\/71575132\.html\?vs=63165134#b-matchup/);
  assert.ok(
    !out.includes(`vs=${encodeURIComponent("柳")}`),
    "아직 이름으로 넘기는 링크가 남아 있다",
  );
});

test("표본이 얇은 행은 시각적 무게를 뺀다 — 값은 남는다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /<tr class="thin">[\s\S]*?吉川/);
  assert.match(out, /1\.000/);
});

/**
 * ⚠**「없다」는 今季와 通算이 **둘 다** 비었을 때만이다**(2026-08-18 토글 도입).
 * 한쪽만 비었으면 그건 「없다」가 아니라 「그 범위에는 없다」이고,
 * 그때는 토글을 남겨 다른 범위를 볼 수 있게 해야 한다(M12).
 */
test("대전 이력이 없으면 없다고 말한다", () => {
  const out = renderStartersPage(
    data({ games: [game({ sides: [side({ opponents: [], opponentsCareer: [] }), pending()] })] }),
    context(),
  );
  assert.match(out, /巨人の打者との対戦記録はまだありません/);
});

test("⚠今季만 비면 「없다」가 아니라 통산 쪽을 남긴다 — 범위가 다르면 다른 사실이다", () => {
  const out = renderStartersPage(
    data({ games: [game({ sides: [side({ opponents: [] }), pending()] })] }),
    context(),
  );
  assert.ok(!out.includes("巨人の打者との対戦記録はまだありません"), "통산이 있는데 「없다」고 말했다");
  assert.match(out, /今季の対戦はまだありません/, "今季가 비었다는 말이 없다");
  /**
   * ⚠**「通算」이라고 쓰지 않는다** — 우리가 가진 시즌의 합계일 뿐이다(2026-08-18 유저 지적).
   * 라벨이 **실제 범위**를 말하는지 못 박는다.
   */
  assert.match(out, /2019年〜/, "넓은 쪽의 범위를 말하지 않는다");
  assert.ok(!out.includes(">通算<"), "우리 보유분을 「通算」이라고 불렀다");
});

/**
 * ⚠**통산은 시즌보다 넓다.** 두 표가 같은 값을 내면 토글이 아무 일도 안 하는 것이고,
 * 그건 「있는 척하는 조작」이다 — 실제로 다른 값이 나오는지 못 박는다.
 */
test("⚠今季와 通算이 서로 다른 값을 낸다 — 토글이 실제로 무언가를 바꾼다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /data-panelkey="season"/, "今季 패널이 없다");
  assert.match(out, /data-panelkey="career"/, "通算 패널이 없다");
  // 今季 6타석 · 통산 24타석 — 픽스처가 일부러 다르게 잡혀 있다
  assert.match(out, /<td>6<\/td>/, "今季 타석수가 없다");
  assert.match(out, /<td>24<\/td>/, "통산 타석수가 없다");
});

test("라인업을 아는 척하지 않는다고 화면이 밝힌다", () => {
  const out = renderStartersPage(data(), context());
  assert.match(out, /打順は試合前には分からない/);
  assert.match(out, /試合中の情報は取得していません/);
});

test("헤더에서 부모 항목(試合)을 켠다 — 予告先発은 그 자식 화면이다", () => {
  const out = renderStartersPage(data(), context());
  // ⚠**어느 항목도 안 켜진 상태로 두지 않는다.** 「지금 어디인가」가 사라지면
  // 내비게이션이 방향을 잃는다. 予告先発은 「試合」 아래에 있으므로 그쪽을 켠다.
  //
  // ⚠**단 `page`가 아니라 `true`다.** `aria-current="page"`는 「이 링크가 지금 이 문서다」라는
  // 뜻인데 그 링크는 `today.html`(다른 문서)을 가리킨다 — 스크린리더에게 거짓말이 된다.
  // 구획 안에 있다는 뜻은 `aria-current="true"`가 낸다(2026-08-16 이중 검토 P2).
  assert.match(out, /<a href="today\.html" aria-current="true">試合<\/a>/);
  assert.equal(out.match(/aria-current="page"/g), null, "다른 문서를 가리키는 링크를 「지금 여기」라고 했다");
  assert.equal(out.match(/aria-current="true"/g)?.length, 1, "켜진 항목이 하나가 아니다");
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

/**
 * ⚠**試合 화면의 予告先発 카드가 여기로 온다.** 착지점이 없으면 눌러도 페이지 맨 위에 떨어지고,
 * 고른 경기가 아닌 첫 경기가 열린 채로 보인다 — 「눌렀는데 다른 경기」가 된다.
 */
test("경기마다 착지점이 있다 — 試合 화면의 카드가 그 경기로 온다", () => {
  const out = renderStartersPage(threeGames(), context());
  const ids = [...out.matchAll(/id="(sg-[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["sg-d-g", "sg-s-db", "sg-l-m"]);
  // 착지점은 그 경기의 탭 키와 짝이어야 한다 — 어긋나면 탭이 안 열린다
  for (const id of ids) assert.ok(out.includes(`data-tab="${id.slice(3)}"`), `${id}에 맞는 탭이 없다`);
});

/**
 * ⚠**끝난 시즌에 「発表待ち」라고 쓰지 않는다.** 기다리는 것이 아니라 끝난 것이다.
 * 신선도 띠만 고치고 본문을 두면, 같은 화면이 위에서는 「終了したシーズン」이라 하고
 * 아래에서는 「発表は前日〜当日です」라고 말한다(2026-08-16 이중 검토 P2).
 */
test("끝난 시즌의 予告先発 화면은 현재형으로 말하지 않는다", () => {
  const out = renderStartersPage(data({ gameDate: null, games: [] }), pastSeasonContext(["starters.html"]));
  assert.match(out, /終了したシーズンです/);
  assert.ok(!out.includes("発表は前日〜当日です"), "끝난 시즌에 「곧 발표된다」고 말했다");
  assert.ok(!out.includes("発表待ち"), "끝난 시즌을 기다리고 있다고 말했다");
});

test("진행 중인 시즌에서는 지금까지대로 말한다", () => {
  const out = renderStartersPage(data({ gameDate: null, games: [] }), context());
  assert.match(out, /発表は前日〜当日です/);
  assert.match(out, /発表待ち/);
});

/**
 * ⚠**한 페이지가 같은 날을 「예정」이자 「종료」로 동시에 선언했다**(2026-08-18 감사 P1).
 *
 * 배포물 `today.html` 이 위에서 「次の予告先発 2026年8月16日」, 아래에서 「2026年8月16日の結果」.
 * 당일 예고를 못 받은 날에 기본값이 **무조건 마지막 예고일로 떨어졌고**, 그 날은 이미 치러진 날이었다.
 * 양쪽 다 그럴듯해서 오류로 보이지 않고, 읽는 사람은 **끝난 경기의 선발을 예습한다** —
 * 침묵 오류 중에서도 눈에 안 띄는 쪽이다.
 */
test("⚠끝난 날을 「次の予告先発」이라고 부르지 않는다", () => {
  // 실제로 났던 상태: 예고도 최신 경기일도 8/16
  assert.equal(isNextProbable("2026-08-16", "2026-08-16"), false, "같은 날을 「다음」이라고 했다");
  assert.equal(isNextProbable("2026-08-15", "2026-08-16"), false, "지난 날을 「다음」이라고 했다");
  assert.equal(isNextProbable("2026-08-17", "2026-08-16"), true, "진짜 다음 날을 감췄다");
  assert.equal(isNextProbable(null, "2026-08-16"), false);
});

/**
 * ⚠**시즌 첫 경기 전에는 최신 경기일이 없다.** 그때 「없으니까 다음도 없다」로 떨어뜨리면
 * 개막 전날에 予告先発이 통째로 사라진다 — 정작 가장 보고 싶은 날이다.
 */
test("⚠최신 경기일이 없으면(개막 전) 예고는 그대로 「다음」이다", () => {
  assert.equal(isNextProbable("2026-03-27", null), true, "개막 전날의 예고를 감췄다");
});
