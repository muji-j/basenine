import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSite } from "../src/site.ts";
import { searchIndexJson } from "../src/pages.ts";
import type { SiteData } from "../src/query.ts";
import { playerPage } from "./fixtures.ts";

function siteData(over: Partial<SiteData> = {}): SiteData {
  const p = playerPage();
  return {
    season: 2026,
    asOf: "2026-08-14",
    gameCount: 630,
    players: [p],
    search: [{ i: p.playerId, n: p.name, t: p.teamName }],
    index: { season: 2026, playerCount: 1, gameCount: 630, asOf: "2026-08-14", highlights: [] },
    ranking: { season: 2026, asOf: "2026-08-14", leagues: [] },
    ...over,
  };
}

const SITE = { name: "bb-app", contact: "a@example.invalid" };

test("사이트는 정해진 파일 집합을 만든다", () => {
  const out = buildSite(siteData(), SITE, "2026-08-15");
  const paths = out.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "assets/site.css",
    "assets/site.js",
    "index.html",
    "players.json",
    "players/41045153.html",
    "ranking.html",
  ]);
  assert.equal(out.playerCount, 1);
  assert.equal(out.stale, false);
});

test("경기가 없으면 낡음으로 보고한다 — 호출자가 종료 코드를 바꾼다", () => {
  const out = buildSite(siteData({ asOf: null }), SITE, "2026-08-15");
  assert.equal(out.stale, true);
  assert.equal(out.latestGameDate, null);
});

test("선수 ID가 경로로 쓸 수 없는 형태면 던진다 — 출력 밖에 쓰지 않는다", () => {
  const bad = playerPage({ playerId: "../../etc/passwd" });
  assert.throws(
    () => buildSite(siteData({ players: [bad] }), SITE, "2026-08-15"),
    /경로로 쓸 수 없는 형태/,
  );
});

test("빈 문자열 ID도 막는다", () => {
  const bad = playerPage({ playerId: "" });
  assert.throws(() => buildSite(siteData({ players: [bad] }), SITE, "2026-08-15"));
});

test("검색 색인은 필드 3개만 나른다 — 선수 수만큼 커진다", () => {
  const json = searchIndexJson([{ i: "1", n: "佐藤", t: "阪神タイガース" }]);
  assert.equal(json, '[{"i":"1","n":"佐藤","t":"阪神タイガース"}]');
  assert.deepEqual(Object.keys(JSON.parse(json)[0]), ["i", "n", "t"]);
});

test("CSS와 클라이언트 스크립트는 파일로 나간다 — 페이지마다 인라인하지 않는다", () => {
  const out = buildSite(siteData(), SITE, "2026-08-15");
  const css = out.files.find((f) => f.path === "assets/site.css")!;
  const js = out.files.find((f) => f.path === "assets/site.js")!;
  assert.ok(css.content.includes("--team"), "구단 색 변수가 없다");
  assert.ok(js.content.includes("localStorage"), "설정 저장이 없다");
  const player = out.files.find((f) => f.path.startsWith("players/"))!;
  assert.ok(player.content.includes('href="../assets/site.css"'), "상대 경로가 어긋난다");
  assert.ok(!player.content.includes("--page:"), "CSS가 페이지에 인라인됐다");
});
