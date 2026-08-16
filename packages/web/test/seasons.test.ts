/**
 * 시즌 전환.
 *
 * ⚠**여기서 잡는 것은 「경로가 맞는가」다.** 시즌 접두사가 붙는 순간 자산 경로·시즌 링크가
 * 한 단계씩 어긋나고, 그때 생기는 것은 오류가 아니라 **404**다 — 조용하고 발견이 늦다.
 * 실측(2026-08-16): 과거 시즌의 記録 링크 하나 때문에 **1,585종**이 깨져 있었다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessBar, pathsFor } from "../src/layout.ts";
import { toString } from "../src/html.ts";
import { freshness } from "../src/layout.ts";
import { renderTodayPage } from "../src/today-page.ts";
import { context, seasonContext } from "./fixtures.ts";

const PLANS = [
  { season: 2026, prefix: "", paths: new Set(["index.html", "ranking.html", "players/A.html"]) },
  { season: 2025, prefix: "2025/", paths: new Set(["index.html", "ranking.html", "players/B.html"]) },
];

test("현재 시즌은 사이트 루트에 놓인다 — 기존 URL이 그대로 산다", () => {
  const p = pathsFor(PLANS, 2026)("ranking.html");
  assert.equal(p.base, "");
  assert.equal(p.root, "");
});

test("⚠과거 시즌은 자산이 한 단계 더 위다 — 합치면 CSS가 조용히 404가 된다", () => {
  const top = pathsFor(PLANS, 2025)("ranking.html");
  assert.equal(top.base, "", "시즌 안의 링크는 시즌 루트 기준이다");
  assert.equal(top.root, "../", "자산은 사이트 루트 기준이다");

  const deep = pathsFor(PLANS, 2025)("players/B.html");
  assert.equal(deep.base, "../");
  assert.equal(deep.root, "../../");
});

test("깊이는 경로에서 센다 — 렌더러가 손으로 적지 않는다", () => {
  assert.equal(pathsFor(PLANS, 2026)("players/A.html").base, "../");
  assert.equal(pathsFor(PLANS, 2026)("index.html").base, "");
});

test("⚠시즌 전환은 같은 화면으로 간다 — 첫 화면으로 튕기지 않는다", () => {
  const s = pathsFor(PLANS, 2026)("ranking.html").seasons;
  const past = s.find((x) => x.season === 2025)!;
  assert.equal(past.href, "2025/ranking.html");
  assert.equal(past.fallback, false);
});

test("⚠그 시즌에 없는 화면이면 선수 일람으로 보낸다 — 404를 만들지 않는다", () => {
  // A는 2026에만 있다
  const s = pathsFor(PLANS, 2026)("players/A.html").seasons;
  const past = s.find((x) => x.season === 2025)!;
  assert.equal(past.href, "../2025/index.html");
  assert.equal(past.fallback, true, "대체로 보낸다는 사실을 표시하지 않았다");
});

test("현재 시즌 칸은 자기 자신을 가리키고 current다", () => {
  const s = pathsFor(PLANS, 2026)("players/A.html").seasons;
  const now = s.find((x) => x.season === 2026)!;
  assert.equal(now.current, true);
  assert.equal(now.href, "../players/A.html");
});

test("시즌이 하나면 전환 띠를 그리지 않는다 — 고를 것 없는 조작은 소음이다", () => {
  const out = renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    context(),
  );
  assert.ok(!out.includes('class="seasons"'));
});

test("시즌이 둘이면 「シーズン」이라는 이름과 함께 그린다 — 연도만 띄우면 무엇인지 모른다", () => {
  const out = renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    seasonContext(["today.html"]),
  );
  assert.match(out, /aria-label="シーズン"/);
  assert.match(out, /<span class="slab">シーズン<\/span>/);
  assert.match(out, /2025年/);
});

/**
 * ⚠**끝난 시즌에 「更新が止まっています」라고 쓰지 않는다.**
 * 수집이 죽은 것이 아니라 시즌이 끝난 것이고, 경고를 남발하면 진짜 경고가 안 보인다.
 * 실측(2026-08-16): 2025년 화면 2,307장 전부가 「315일 전」이라는 빨간 띠를 달고 있었다.
 */
test("⚠지난 시즌에는 「終了したシーズン」이라고 쓴다 — 고장으로 보이면 안 된다", () => {
  const f = freshness("2025-10-05", "2026-08-16");
  const past = toString(freshnessBar(f, true));
  assert.match(past, /終了したシーズンです/);
  assert.ok(!past.includes("更新が止まっています"), "끝난 시즌을 고장이라고 했다");
  assert.ok(!past.includes("stale"), "경고색이 붙었다");

  const now = toString(freshnessBar(f, false));
  assert.match(now, /更新が止まっています/, "현재 시즌의 경고까지 없애면 안 된다");
});

test("지난 시즌에 경기가 없으면 그렇게 말한다", () => {
  const out = toString(freshnessBar(freshness(null, "2026-08-16"), true));
  assert.match(out, /このシーズンの試合はありません/);
});
