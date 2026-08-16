/**
 * ポストシーズン — **배제하지 않고 구분한다.**
 *
 * ⚠**이 화면이 없던 동안 데이터는 있었다.** 2025년 CS 13경기·일본시리즈 5경기(타석 로그 1,351개)를
 * 모든 화면이 `competition = 'regular'`로 걸러 통째로 안 보여줬다.
 * ⚠**그렇다고 정규시즌에 더하지 않는다**(§2-1). 여기서 지키는 것은 그 경계다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPostseasonPage } from "../src/postseason-page.ts";
import type { PostCompetition, PostseasonPageData } from "../src/postseason-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function cs(over: Partial<PostCompetition> = {}): PostCompetition {
  return {
    id: "climaxSeries",
    name: "クライマックスシリーズ",
    detail: "各リーグの上位3球団が争います。",
    games: [
      {
        gameId: "2025-1011-t-db-01",
        rawGameId: "2025/1011/t-db-01",
        hasPage: true,
        date: "2025-10-11",
        venue: "甲子園",
        gameNo: 1,
        series: "CS ファイナルステージ",
        stage: "セ・リーグ CS ファイナルステージ",
        away: { shortName: "DeNA", color: colorOf("db"), runs: 2 },
        home: { shortName: "阪神", color: colorOf("t"), runs: 5 },
        winner: "home",
      },
    ],
    batters: [
      {
        playerId: "B1", name: "佐藤", teamCode: "t", shortName: "阪神", color: colorOf("t"),
        games: 5, pa: 21, ab: 18, h: 6, hr: 2, rbi: 5, bb: 3, so: 4,
        avg: { value: 6 / 18, denominator: 18 },
      },
      {
        playerId: "B2", name: "代打", teamCode: "t", shortName: "阪神", color: colorOf("t"),
        games: 2, pa: 2, ab: 0, h: 0, hr: 0, rbi: 0, bb: 2, so: 0,
        avg: { value: null, denominator: 0 },
      },
    ],
    pitchers: [
      {
        playerId: "P1", name: "村上", teamCode: "t", shortName: "阪神", color: colorOf("t"),
        games: 2, outs: 39, h: 8, hr: 0, bb: 3, so: 14, er: 2, w: 2, l: 0, sv: 0,
        era: { value: (2 * 27) / 39, denominator: 39 },
      },
    ],
    ...over,
  };
}

function data(over: Partial<PostseasonPageData> = {}): PostseasonPageData {
  return { season: 2025, competitions: [cs()], ...over };
}

test("대회마다 따로 낸다 — 경기·타자·투수가 그 대회 안에 모인다", () => {
  const out = renderPostseasonPage(data(), context());
  assert.match(out, /id="pc-climaxSeries"/);
  assert.match(out, /クライマックスシリーズ/);
  assert.match(out, /第1戦/);
  // ⚠앞서 여기 있던 정규식은 교대(|) 때문에 佐藤을 한 번도 검사하지 않았다 — 항상 통과였다
  assert.ok(out.includes("佐藤"), "타자표가 없다");
  assert.ok(out.includes("村上"), "투수표가 없다");
});

/**
 * ⚠**순위를 매기지 않는다.** 표본이 13경기·5경기다. 「1위」를 붙이면
 * 5타수 3안타가 타율 1위가 된다 — M2·M3가 정확히 막으라고 하는 것이다.
 */
test("순위가 아니라는 것을 화면이 말한다 — 표본이 13경기다", () => {
  const out = renderPostseasonPage(data(), context());
  assert.match(out, /出場の多い順/);
  assert.match(out, /順位ではありません/);
  // 순위 배지가 붙어 있으면 안 된다
  assert.ok(!/class="rank"/.test(out), "순위 배지가 붙었다");
});

test("⚠정규시즌에 더하지 않는다는 것을 화면이 말한다(§2-1)", () => {
  const out = renderPostseasonPage(data(), context());
  assert.match(out, /レギュラーシーズンの成績には加えていません/);
});

/**
 * ⚠**리그 평균이 기준선인 지표를 내지 않는다.** wRC+·FIP는 「그 리그」가 있어야 뜻이 있는데,
 * 포스트시즌은 양 리그가 맞붙으므로 그 리그가 없다. 계산이 되더라도 근거 없는 수다.
 */
test("리그 상수를 쓰는 지표를 내지 않고, 그 이유를 적는다", () => {
  const out = renderPostseasonPage(data(), context());
  assert.ok(!out.includes("wRC+</"), "wRC+를 냈다");
  assert.match(out, /wRC\+・FIP）は出していません/);
});

test("⚠비율에는 분모가 붙는다(M2)", () => {
  const out = renderPostseasonPage(data(), context());
  assert.match(out, /<span class="den">18打数<\/span>/, "타율에 타수가 없다");
  assert.match(out, /<span class="den">13回<\/span>/, "방어율에 이닝이 없다");
});

test("⚠타수가 0이면 「.000」이 아니라 「—」다(M11)", () => {
  const out = renderPostseasonPage(data(), context());
  const at = out.indexOf("代打");
  const row = out.slice(at, out.indexOf("</tr>", at));
  assert.match(row, /—<span class="den">0打数<\/span>/, "0타수를 .000으로 냈다");
});

test("상세 페이지가 없는 경기는 누를 수 있게 만들지 않는다", () => {
  const withPage = renderPostseasonPage(data(), context());
  assert.match(withPage, /class="gcard tapcard"/);

  const without = renderPostseasonPage(
    data({ competitions: [cs({ games: [{ ...cs().games[0]!, hasPage: false }] })] }),
    context(),
  );
  assert.ok(!without.includes("tapcard"), "만들지 않은 페이지로 갈 수 있는 것처럼 보인다");
  assert.ok(!without.includes("games/"), "죽은 링크가 남았다");
});

/**
 * ⚠**올스타는 포스트시즌이 아니다.** 시즌 중 친선경기이고, 소속이 구단이 아니라 리그 선발이다.
 * 그래서 선수 성적을 집계하지 않고, **왜 없는지를 화면이 말한다**(M12의 정신).
 */
test("올스타는 포스트시즌이 아니라고 말하고, 선수표가 없는 이유도 말한다", () => {
  const out = renderPostseasonPage(
    data({
      competitions: [
        {
          id: "allStar",
          name: "オールスターゲーム",
          detail: "⚠**これはポストシーズンではありません** — シーズン中の親善試合です。",
          games: [
            {
              gameId: "x", rawGameId: "x", hasPage: false, date: "2025-07-23", venue: "京セラD大阪", gameNo: 1, series: null, stage: null,
              away: { shortName: "セ・リーグ", color: colorOf("t"), runs: 1 },
              home: { shortName: "パ・リーグ", color: colorOf("h"), runs: 5 },
              winner: "home",
            },
          ],
          batters: [],
          pitchers: [],
        },
      ],
    }),
    context(),
  );
  assert.match(out, /これはポストシーズンではありません/);
  assert.match(out, /選手成績を集計していません/, "없는 이유를 말하지 않았다");
  // 빈 표를 남기지 않는다
  assert.ok(!out.includes("打者の記録がありません"), "빈 표 자리를 남겼다");
});

/**
 * ⚠**있는 것만 이름으로 부른다.** 2026년은 올스타뿐인데 「ポストシーズン」이라고 하면
 * 화면이 거짓말을 한다.
 */
test("올스타뿐인 시즌은 「ポストシーズン」이라고 부르지 않는다", () => {
  const only = renderPostseasonPage(
    data({
      season: 2026,
      competitions: [
        { id: "allStar", name: "オールスターゲーム", detail: "", games: [], batters: [], pitchers: [] },
      ],
    }),
    context(),
  );
  assert.match(only, /レギュラーシーズン外の試合/);
  assert.ok(!/<span class="nm">ポストシーズン<\/span>/.test(only));

  // CS가 있으면 그대로 ポストシーズン이다
  assert.match(renderPostseasonPage(data(), context()), /<span class="nm">ポストシーズン<\/span>/);
});

test("기록이 없으면 그렇다고 말한다 — 빈 화면은 고장으로 보인다(M12)", () => {
  const out = renderPostseasonPage(data({ competitions: [] }), context());
  assert.match(out, /ポストシーズンはまだ記録していません/);
});

/**
 * ⚠**클라이맥스시리즈는 하나의 시리즈가 아니다** — セ/パ × ファースト/ファイナル로 넷이다.
 * 한 줄로 이어 놓으면 「第1戦」이 네 번 나오고 어느 것이 어느 시리즈인지 화면에서 사라진다.
 */
test("스테이지가 둘 이상이면 제목으로 나눈다", () => {
  const g = cs().games[0]!;
  const out = renderPostseasonPage(
    data({
      competitions: [
        cs({
          games: [
            { ...g, gameId: "a1", gameNo: 1, stage: "CS ファーストステージ" },
            { ...g, gameId: "a2", gameNo: 2, stage: "CS ファーストステージ" },
            { ...g, gameId: "b1", gameNo: 1, stage: "CS ファイナルステージ" },
          ],
        }),
      ],
    }),
    context(),
  );
  assert.ok(out.includes("CS ファーストステージ"), "스테이지 제목이 없다");
  assert.ok(out.includes("CS ファイナルステージ"), "스테이지 제목이 없다");
  // 「第1戦」 제목이 두 번 나오는 것이 정상이다 — 서로 다른 시리즈의 1차전이기 때문.
  // ⚠제목만 센다. 링크의 숨김 텍스트에도 같은 문자열이 들어가 전체를 세면 배로 잡힌다
  assert.equal((out.match(/class="gvenue">第1戦/g) ?? []).length, 2);
  assert.ok(
    out.indexOf("CS ファーストステージ") < out.indexOf("CS ファイナルステージ"),
    "스테이지 순서가 뒤집혔다",
  );
});

test("스테이지가 하나뿐이면 제목을 붙이지 않는다 — 나눌 것이 없는데 나눈 척하지 않는다", () => {
  const out = renderPostseasonPage(data(), context());
  assert.ok(!out.includes(`class="standname">セ・リーグ CS ファイナルステージ`), "나눌 것이 없는데 제목을 냈다");
});

/**
 * ⚠**같은 스테이지가 붙어 들어오는 것을 아무도 보장하지 않는다.**
 * 전에는 「앞 항목과 라벨이 같으면 같은 그룹」이라 순서에 기댔고,
 * 우천으로 한 리그의 스테이지가 밀려 겹치는 날 **같은 제목이 두 번** 나왔을 것이다.
 */
test("떨어져 들어온 같은 스테이지를 한 제목으로 모은다 — 순서에 기대지 않는다", () => {
  const g = cs().games[0]!;
  const out = renderPostseasonPage(
    data({
      competitions: [
        cs({
          games: [
            { ...g, gameId: "a1", gameNo: 1, stage: "セ CS" },
            { ...g, gameId: "b1", gameNo: 1, stage: "パ CS" },
            { ...g, gameId: "a2", gameNo: 2, stage: "セ CS" },
            { ...g, gameId: "b2", gameNo: 2, stage: "パ CS" },
          ],
        }),
      ],
    }),
    context(),
  );
  assert.equal((out.match(/class="standname">セ CS</g) ?? []).length, 1, "같은 제목이 두 번 나왔다");
  assert.equal((out.match(/class="standname">パ CS</g) ?? []).length, 1, "같은 제목이 두 번 나왔다");
});
