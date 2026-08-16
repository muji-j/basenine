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
import type { RankingPageData, StandingRow } from "../src/pages.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

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

test("팀 순위표가 개인 순위보다 먼저 온다 — 「順位」를 누른 사람이 먼저 찾는 것이다", () => {
  const out = renderRankingPage(data(), context());
  const standings = out.indexOf("チーム順位");
  const rail = out.indexOf('class="rail"');
  assert.ok(standings > 0, "팀 순위표가 없다");
  assert.ok(standings < rail, "개인 순위 탭이 팀 순위표보다 앞에 있다");
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
  assert.match(out, /class="l tm"><i><\/i>阪神/, "색 마크로 구단을 구별하지 않는다");
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
