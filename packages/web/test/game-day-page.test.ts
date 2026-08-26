/**
 * **경기일 하나에 파일 하나** — 여러 경기가 한 문서에 들어갈 때 무엇이 깨지는가.
 *
 * ⚠**경기 하나에 파일 하나였다**(2026-08-26 · 감사 P3 #41). Cloudflare Pages 의 배포당
 * 파일 상한(20,000)에 여유가 **2.61시즌**뿐이었고 경기 페이지가 배포물의 **48.6%(7,502장)** 였다.
 * 묶은 뒤 실측(9시즌 전 시즌 빌드): **9,473파일 = 47.4%** · 여유 **약 6.0시즌** ·
 * 링크 **9,370장 검사(앵커 포함) · 깨진 것 0**.
 *
 * ## 이 파일이 지키는 것
 *
 * ⚠**중복 id.** 예전 구획 id 는 `b-score`·`b-key`·`b-scoring` 고정이었다 —
 * 한 문서에 경기가 여섯이면 **같은 id 가 여섯 번** 나온다. 참조하는 곳은 0건이었지만
 * 중복 id 는 그 자체로 깨진 문서이고, **앵커가 어디로 갈지 브라우저가 정하게 된다.**
 * ⚠**누락.** 경기 하나가 빠져도 페이지는 멀쩡해 보인다 — 그게 이 변경의 조용한 실패다.
 * ⚠**제목 위계.** 문서의 `h1` 은 날짜이고 경기는 `h2` 다. 경기마다 `h1` 이면 낭독 화면에서
 * 「이 문서의 제목」이 여섯 개가 된다.
 *
 * ⚠`game-page.test.ts` 는 **경기 한 판의 화면**을 잰다(경기 하나짜리 하루 페이지로).
 * 여기서 재는 것은 **여럿이 한 장에 들어갈 때만 생기는 성질**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gameAnchor, renderGameDayPage } from "../src/game-page.ts";
import type { GamePageData, GameSide } from "../src/game-page.ts";
import { colorOf } from "@bb-app/domain";
import { context } from "./fixtures.ts";

function side(code: string, shortName: string, runs: number): GameSide {
  return { teamCode: code, name: `${shortName}チーム`, shortName, color: colorOf(code), runs, hits: 5, errors: 0 };
}

function game(gameId: string, away: string, home: string, ar: number, hr: number): GamePageData {
  return {
    gameId,
    gameDate: "2026-08-14",
    venue: "神宮",
    series: null,
    away: side(away, away.toUpperCase(), ar),
    home: side(home, home.toUpperCase(), hr),
    innings: [
      { inning: 1, half: "top", runs: ar, batted: true },
      { inning: 1, half: "bottom", runs: hr, batted: true },
    ],
    reconciles: true,
    scoringPlays: [],
    keyPlays: [],
    keyPlayLimit: 5,
    win: null,
    lose: null,
    save: null,
    sourceUrl: `https://npb.jp/scores/2026/0814/${gameId}/`,
  };
}

const GAMES = [
  game("2026/0814/s-db-17", "db", "s", 2, 3),
  game("2026/0814/g-t-11", "t", "g", 1, 0),
  game("2026/0814/b-f-19", "f", "b", 4, 4),
];

function render(): string {
  return renderGameDayPage("2026-08-14", GAMES, context());
}

test("그 날 경기가 전부 들어간다 — 하나가 빠져도 페이지는 멀쩡해 보인다", () => {
  const out = render();
  for (const g of GAMES) {
    assert.ok(out.includes(`id="${gameAnchor(g.gameId)}"`), `${g.gameId} 가 없다`);
  }
});

/** ⚠**중복 id 는 앵커가 어디로 갈지 브라우저가 정하게 만든다** */
test("⚠문서 안에 같은 id 가 두 번 나오지 않는다", () => {
  const ids = [...render().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dup.push(id);
    seen.add(id);
  }
  assert.deepEqual(dup, [], `중복된 id: ${[...new Set(dup)].join(" / ")}`);
  assert.ok(ids.length > 5, `id 를 ${ids.length}개밖에 못 찾았다 — 이 시험이 공회전한다`);
});

test("⚠문서의 h1 은 하나이고 그것은 날짜다 — 경기는 h2 로 내려간다", () => {
  const out = render();
  const h1 = [...out.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1]!);
  assert.equal(h1.length, 1, `h1 이 ${h1.length}개다`);
  assert.match(h1[0]!, /8月14日/, `h1 이 날짜가 아니다: ${h1[0]}`);
  for (const g of GAMES) {
    assert.match(
      out,
      new RegExp(`<h2 class="nm">${g.away.shortName} ${g.away.runs}-${g.home.runs} ${g.home.shortName}</h2>`),
      `${g.gameId} 의 제목이 h2 가 아니다`,
    );
  }
});

/**
 * ⚠**원본 링크는 경기마다 남긴다**(L3). 가리키는 대상이 경기별로 다르므로
 * 「한 장에 한 번」으로 묶으면 **어느 경기의 원본인지 말할 수 없게 된다.**
 */
test("⚠원본 링크(L3)는 경기마다 남는다", () => {
  const out = render();
  for (const g of GAMES) {
    assert.ok(out.includes(g.sourceUrl), `${g.gameId} 의 원본 링크가 없다`);
  }
});

/**
 * ⚠**공통 각주는 한 장에 한 번.** 경기마다 내면 같은 문장이 여섯 번 나오고,
 * 그건 읽는 사람에게도 배포물 크기에도 손해다 —
 * 실측으로 2026 한 시즌 `games/` 가 11.5 → **9.6 MiB** 로 줄었다(파일 641 → 122).
 */
test("⚠「記録について」 각주는 한 장에 한 번만 나온다", () => {
  const out = render();
  const hits = out.split("当サイトは試合の全経過を転載していません").length - 1;
  assert.equal(hits, 1, `공통 각주가 ${hits}번 나온다 — 경기 수만큼 반복되고 있다`);
});
