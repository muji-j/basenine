/**
 * 試合 화면.
 *
 * ⚠**이 화면이 조용히 거짓말하는 두 경로를 막는다.**
 * ① 「今日」라고 적어 이틀 전 결과를 오늘 것으로 읽히게 하는 것,
 * ② 같은 카드의 동명이인을 구별하지 않아 「진 투수가 상대 팀에 홈런을 쳤다」로 읽히게 하는 것.
 * 둘 다 데이터는 맞는데 화면이 틀리는 종류라, 값 검사로는 잡히지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ambiguousNames, renderTodayPage } from "../src/today-page.ts";
import type { TodayGame, TodayPageData, TodayStar } from "../src/today-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function side(teamCode: string, shortName: string, runs: number | null, hits: number | null, errors: number | null) {
  return { teamCode, shortName, name: `${shortName}チーム`, color: colorOf(teamCode), runs, hits, errors };
}

function star(over: Partial<TodayStar> = {}): TodayStar {
  return {
    playerId: "B1", name: "源田", teamCode: "l", kind: "batting",
    ab: 4, h: 3, hr: 0, rbi: 2, outs: 0, er: 0, so: 0, decision: null,
    ...over,
  };
}

function game(over: Partial<TodayGame> = {}): TodayGame {
  return {
    gameId: "g1",
    venue: "ベルーナドーム",
    status: "played",
    notPlayedReason: null,
    away: side("m", "ロッテ", 0, 5, 1),
    home: side("l", "西武", 7, 12, 0),
    winner: "home",
    win: { playerId: "PW", name: "岩城", teamCode: "l" },
    lose: { playerId: "PL", name: "小島", teamCode: "m" },
    save: null,
    stars: [star()],
    hasPage: true,
    ...over,
  };
}

function data(over: Partial<TodayPageData> = {}): TodayPageData {
  return {
    gameDate: "2026-08-14",
    builtOn: "2026-08-16",
    games: [game()],
    probableDate: "2026-08-16",
    probables: [],
    starRule: "打者は3安打以上・本塁打・4打点以上、投手は6回以上を自責2以内、または10奪三振以上",
    starLimit: 6,
    ...over,
  };
}

test("⚠경기일이 생성일과 다르면 「本日」라고 쓰지 않는다 — 이틀 전 결과를 오늘 것으로 읽힌다", () => {
  const out = renderTodayPage(data(), context());
  assert.match(out, /2026年8月14日の結果/);
  assert.ok(!out.includes("（本日）"), "이틀 전인데 오늘이라고 했다");
});

test("경기일과 생성일이 같은 날에만 「本日」를 붙인다", () => {
  const out = renderTodayPage(data({ gameDate: "2026-08-16" }), context());
  assert.match(out, /（本日）/);
});

test("⚠같은 카드의 동명이인을 구별한다 — 데이터가 맞아도 화면이 거짓말한다(M10)", () => {
  const g = game({
    // 로데의 패전투수 小島와 세이부의 타자 小島. 실제로 2026-08-14에 있었다
    lose: { playerId: "PL", name: "小島", teamCode: "m" },
    stars: [star({ playerId: "B_KOJIMA", name: "小島", teamCode: "l", h: 1, hr: 1, rbi: 1, ab: 3 })],
  });
  assert.deepEqual([...ambiguousNames(g)], ["小島"]);

  const out = renderTodayPage(data({ games: [g] }), context());
  assert.match(out, /小島（ロッテ）/, "패전투수에 구단이 안 붙었다");
  assert.match(out, /小島（西武）/, "타자에 구단이 안 붙었다");
});

test("⚠같은 사람이 두 줄에 나오는 것은 겹침이 아니다 — 선발은 승리투수이면서 호투 기록에도 선다", () => {
  const g = game({
    win: { playerId: "P1", name: "奥川", teamCode: "l" },
    stars: [star({ playerId: "P1", name: "奥川", teamCode: "l", kind: "pitching", outs: 20, er: 2, so: 9, decision: "○" })],
  });
  assert.deepEqual([...ambiguousNames(g)], [], "같은 ID를 동명이인으로 셌다");
  const out = renderTodayPage(data({ games: [g] }), context());
  assert.ok(!out.includes("奥川（"), "구단이 필요 없는 자리에 붙었다");
});

test("겹치지 않는 이름에는 구단을 붙이지 않는다 — 전부 붙이면 읽기만 어려워진다", () => {
  const out = renderTodayPage(data(), context());
  assert.ok(!out.includes("源田（"), "겹치지 않는데 구단이 붙었다");
});

test("⚠중지 경기에 0을 그리지 않는다 — 「경기가 없었다」와 「0점」은 다르다(M11)", () => {
  const out = renderTodayPage(
    data({
      games: [
        game({
          status: "notPlayed",
          notPlayedReason: "雨天中止",
          away: side("m", "ロッテ", null, null, null),
          home: side("l", "西武", null, null, null),
          winner: null,
          win: null,
          lose: null,
          stars: [],
        }),
      ],
    }),
    context(),
  );
  assert.match(out, /雨天中止/);
  assert.match(out, /gcard off/, "중지 경기가 치른 경기와 같은 모양이다");
  assert.ok(!/class="gr">0</.test(out), "중지 경기에 0점이 그려졌다");
});

test("무승부는 그렇게 말한다 — 어느 쪽도 이긴 것으로 그리지 않는다", () => {
  const out = renderTodayPage(
    data({
      games: [
        game({
          away: side("m", "ロッテ", 3, 8, 0),
          home: side("l", "西武", 3, 9, 1),
          winner: null,
          win: null,
          lose: null,
        }),
      ],
    }),
    context(),
  );
  assert.match(out, /引き分け/);
  assert.ok(!/gside w/.test(out), "무승부인데 이긴 쪽 표시가 붙었다");
});

test("⚠「눈에 띈 기록」의 기준을 화면에 적는다 — 없으면 「왜 이 선수가 없지?」에 답할 수 없다", () => {
  const out = renderTodayPage(data(), context());
  assert.match(out, /3安打以上/);
  assert.match(out, /自責2以内/);
  assert.match(out, /1試合6人まで/, "자른다는 사실을 말하지 않았다");
});

test("⚠타자 기록에 분모(打数)를 함께 낸다(M2)", () => {
  const out = renderTodayPage(data(), context());
  assert.match(out, /4打数3安打/, "안타 수만 있고 타수가 없다");
});

test("투수 기록은 이닝과 자책을 함께 낸다 — 탈삼진만 내면 어떤 등판인지 모른다", () => {
  const out = renderTodayPage(
    data({
      games: [
        game({ stars: [star({ kind: "pitching", playerId: "P", name: "奥川", outs: 20, er: 2, so: 9, decision: "○" })] }),
      ],
    }),
    context(),
  );
  assert.match(out, /6\.2回 自責2/);
  assert.match(out, /9奪三振/);
});

test("승·패·세이브를 라벨로 구분한다 — 색만으로는 구별되지 않는다", () => {
  const out = renderTodayPage(
    data({ games: [game({ save: { playerId: "PS", name: "藤平", teamCode: "l" } })] }),
    context(),
  );
  assert.match(out, /<b>勝<\/b>/);
  assert.match(out, /<b>負<\/b>/);
  assert.match(out, /<b>S<\/b>/);
});

test("경기가 하나도 없으면 그렇게 말한다 — 빈 화면은 고장으로 보인다(M12)", () => {
  const out = renderTodayPage(data({ gameDate: null, games: [] }), context());
  assert.match(out, /試合の記録がまだありません|まだ取り込んでいません/);
});

test("중지 경기 수를 표제에 센다 — 「6試合」이라고만 쓰면 하루가 통째로 사라진다", () => {
  const out = renderTodayPage(
    data({
      games: [game(), game({ gameId: "g2", status: "notPlayed", notPlayedReason: "雨天中止" })],
    }),
    context(),
  );
  assert.match(out, /1試合 · 中止1試合/);
});

test("예고선발 요약에 방어율과 분모가 함께 나온다(M2)", () => {
  const out = renderTodayPage(
    data({
      probables: [
        {
          venue: "神宮",
          startTime: "18:00",
          anchor: "sg-s-db",
          sides: [
            { shortName: "ヤクルト", color: colorOf("s"), playerId: "P1", name: "奥川", era: { value: 2.52, denominator: 354 } },
            { shortName: "DeNA", color: colorOf("db"), playerId: null, name: null, era: null },
          ],
        },
      ],
    }),
    context(),
  );
  assert.match(out, /防御率 2\.52/);
  assert.match(out, /118回/, "방어율만 있고 투구회가 없다");
  // ⚠미발표는 「投手なし」가 아니다(M11)
  assert.match(out, /発表待ち/);
});

/**
 * ⚠**경기 페이지가 없는데 링크를 내면 404다.** 라인스코어만 못 읽어 득점이 null인 경기가
 * 정확히 이 구멍에 빠진다 — 카드에는 「—」가 뜨고 링크는 죽는다.
 * (2026-08-16 이중 검토에서 지적. 현 데이터 해당 0건이지만 경로는 실재한다.)
 */
test("⚠경기 페이지가 없으면 「詳細」 링크를 내지 않는다 — 죽은 링크는 조용하다", () => {
  const out = renderTodayPage(data({ games: [game({ hasPage: false })] }), context());
  assert.ok(!out.includes("この試合の詳細"), "만들어지지 않은 페이지로 링크했다");
  assert.ok(!out.includes("games/"), "경기 페이지 경로가 남아 있다");
});

test("경기 페이지가 있으면 링크를 낸다 — 슬래시는 파일명으로 바뀐다", () => {
  const out = renderTodayPage(
    data({ games: [game({ gameId: "2026/0814/s-db-17" })] }),
    context(),
  );
  assert.match(out, /games\/2026-0814-s-db-17\.html/);
});

/**
 * ⚠**카드 전체를 누르게 만드는 것은 「링크를 하나 더 얹는다」가 아니다.**
 * 겹쳐 두면 같은 곳이 링크 목록에 두 번 나오고 탭 이동도 두 번 걸린다.
 * 이미 있는 「この試合の詳細」의 클릭 영역을 카드까지 넓히는 것이 맞는 방법이다.
 */
test("試合 카드는 카드 전체가 눌린다 — 링크를 겹치지 않고 있는 링크를 넓힌다", () => {
  const out = renderTodayPage(data(), context());
  assert.match(out, /<article class="gcard tapcard">/, "카드가 누를 수 있는 상태가 아니다");
  assert.equal((out.match(/class="cardlink"/g) ?? []).length, 1, "덮개 링크가 카드마다 하나가 아니다");
  // 목적지가 하나뿐이어야 한다 — 겹친 링크는 여기서 2가 된다
  assert.equal((out.match(/href="games\//g) ?? []).length, 1);
});

test("⚠눌러도 갈 곳이 없는 카드는 눌릴 것처럼 보이지 않는다", () => {
  const withoutPage = renderTodayPage(data({ games: [game({ hasPage: false })] }), context());
  assert.ok(!withoutPage.includes("tapcard"), "상세가 없는데 카드가 눌릴 것처럼 보인다");

  const cancelled = renderTodayPage(
    data({ games: [game({ status: "cancelled", notPlayedReason: "雨天中止" })] }),
    context(),
  );
  assert.ok(!cancelled.includes("tapcard"), "중지된 경기 카드가 눌릴 것처럼 보인다");
});

/**
 * ⚠**보이는 글자가 접근 이름에 그대로 들어 있어야 한다**(WCAG 2.5.3 Label in Name).
 * aria-label로 「阪神 対 巨人の詳細」이라고 덮어쓰면, 음성 조작으로
 * 「この試合の詳細」이라고 말한 사람이 이 링크를 못 누른다.
 */
test("덮개 링크의 이름은 보이는 글자를 품은 채 어느 경기인지까지 말한다", () => {
  const out = renderTodayPage(data(), context());
  assert.ok(!out.includes('cardlink" aria-label'), "보이는 글자를 aria-label로 덮었다");
  const at = out.indexOf('class="cardlink"');
  const link = out.slice(at, out.indexOf("</a>", at));
  assert.ok(link.includes("この試合の詳細"), "보이는 글자가 없다");
  assert.match(link, /class="vh">（ロッテ 対 西武）/, "어느 경기인지 말하지 않는다");
});

test("予告先発 카드도 카드 전체가 눌리고, 그 경기 구획으로 간다", () => {
  const out = renderTodayPage(
    data({
      probables: [
        {
          venue: "神宮",
          startTime: "18:00",
          anchor: "sg-s-db",
          sides: [
            { shortName: "ヤクルト", color: colorOf("s"), playerId: "P1", name: "奥川", era: null },
            { shortName: "DeNA", color: colorOf("db"), playerId: null, name: null, era: null },
          ],
        },
      ],
    }),
    context(),
  );
  assert.match(out, /<article class="pbcard tapcard">/);
  assert.match(out, /href="starters\.html#sg-s-db"/, "予告先発 화면의 그 경기로 가지 않는다");
});
