/**
 * **選手一覧의 항목이 헤더 검색 색인과 같은 판정 재료를 싣는가**(2026-09-25 감사 W6).
 *
 * ⚠**헤더 검색은 구단명도 맞추는데 選手一覧은 구단명을 몰랐다.** 헤더가 「阪神」으로 58명을 찾고
 * 「選手一覧ですべて見る」로 `players.html?q=阪神` 에 보내면, 받는 쪽 항목에는 구단명이 없어서 **0人** 이었다.
 *
 * 판정 함수는 클라이언트 한 벌(`assets.ts` 의 `playerHit`)이고, 그 함수가 받는 것은
 * **색인 항목과 같은 네 가지**다 — 이름(`n`) · 구단명(`t`) · 읽는 법(`k`) · 등번호(`u`).
 * 헤더는 `players.json` 에서, 選手一覧은 **서버가 그린 `li` 의 속성**에서 그것을 읽는다.
 * 그래서 여기서 **진짜 렌더 결과**의 `li` 가 그 네 가지를 다 싣는지 잰다 —
 * `client.test.ts` 의 목록은 손으로 짓는 픽스처라 이름이 바뀌어도 초록으로 남는다(`stable-contract.test.ts` 와 같은 이유).
 *
 * ⚠**구단명의 출처가 색인과 같아야 한다**(M1). 색인의 `t` 는 `teamOf(code).name`(`query.ts`)이고
 * 여기 `TeamRoster.name` 도 `TEAMS` 의 이름이다. 둘 다 `domain/teams.ts` 한 벌에서 나온다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorOf, teamOf } from "@bb-app/domain";
import { renderIndexPage } from "../src/pages.ts";
import type { IndexPageData, RosterEntry, TeamRoster } from "../src/pages.ts";
import { context } from "./fixtures.ts";

function entry(playerId: string, name: string, over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    playerId,
    name,
    mark: "投",
    axes: [],
    sampleText: "0打席",
    summary: null,
    kana: null,
    uniformNumber: null,
    ...over,
  };
}

function team(code: string, players: RosterEntry[]): TeamRoster {
  const t = teamOf(code);
  return { code: t.code, name: t.name, shortName: t.name.slice(0, 2), color: colorOf(t.code), players };
}

function page(): string {
  const d: IndexPageData = {
    season: 2026,
    playerCount: 3,
    gameCount: 0,
    asOf: null,
    teams: [
      team("t", [
        entry("b1", "佐藤", { kana: "さとう・てるあき", uniformNumber: "8" }),
        entry("f1", "ボイト", { kana: "ルーク・ボイト (LUKE VOIT)" }),
      ]),
      team("b", [entry("p1", "山本", { uniformNumber: "18" })]),
    ],
    highlights: [],
  };
  return renderIndexPage(d, context());
}

/** 選手一覧의 선수 항목 하나하나의 여는 태그 */
function rosterItems(html: string): string[] {
  return [...html.matchAll(/<li data-team="[^"]*"[^>]*>/g)].map((m) => m[0]);
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : m[1]!;
};

test("⚠W6 選手一覧의 항목이 구단명을 싣는다 — 헤더 검색이 맞추는 그 이름이다", () => {
  const items = rosterItems(page());
  assert.equal(items.length, 3, `선수 항목이 ${items.length}개다 — 이 시험이 재는 것이 바뀌었다`);
  for (const li of items) {
    const code = attr(li, "data-team");
    assert.notEqual(code, null, `구단 코드가 없다: ${li}`);
    assert.equal(
      attr(li, "data-teamname"),
      teamOf(code!).name,
      `구단명이 없거나 색인(teamOf(code).name)과 다르다: ${li}`,
    );
  }
});

test("⚠W6 選手一覧의 항목이 판정 재료 넷을 다 싣는다 — 이름 · 구단명 · 읽는 법 · 등번호", () => {
  const sato = rosterItems(page()).find((li) => attr(li, "data-id") === "b1");
  assert.notEqual(sato, undefined, "佐藤 항목이 없다");
  assert.equal(attr(sato!, "data-name"), "佐藤");
  assert.equal(attr(sato!, "data-teamname"), "阪神タイガース");
  assert.equal(attr(sato!, "data-kana"), "さとう・てるあき");
  assert.equal(attr(sato!, "data-uniform"), "8");
});

/**
 * ⚠**없는 것은 속성째 안 싣는다**(M11) — 읽는 법·등번호가 없는 선수에게 빈 문자열을 넣으면
 * 「모른다」와 「빈 값」이 같아진다. 이 규칙은 구단명을 더하면서도 그대로여야 한다.
 */
test("W6 대조군 — 읽는 법·등번호가 없는 선수는 그 속성이 없고 구단명만 더해진다", () => {
  const yamamoto = rosterItems(page()).find((li) => attr(li, "data-id") === "p1");
  assert.notEqual(yamamoto, undefined, "山本 항목이 없다");
  assert.equal(attr(yamamoto!, "data-kana"), null, "읽는 법이 없는데 속성이 생겼다");
  assert.equal(attr(yamamoto!, "data-uniform"), "18");
  assert.equal(attr(yamamoto!, "data-teamname"), "オリックス・バファローズ");
});
