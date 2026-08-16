import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSite, seasonPaths } from "../src/site.ts";
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
    index: {
      season: 2026,
      playerCount: 1,
      gameCount: 630,
      asOf: "2026-08-14",
      teams: [
        {
          code: "t",
          name: "阪神タイガース",
          shortName: "阪神",
          color: { base: "#f2c800", ink: "#17170f" },
          players: [
            {
              playerId: p.playerId,
              name: p.name,
              mark: "内",
              axes: p.mark.axes,
              sampleText: p.mark.sampleText,
            },
          ],
        },
      ],
      highlights: [],
    },
    ranking: { season: 2026, asOf: "2026-08-14", standings: [], tieRule: "同順位", leagues: [] },
    starters: { gameDate: null, builtOn: "2026-08-15", games: [] },
    matchup: { season: 2026, asOf: "2026-08-14", pickDate: null, builtOn: "2026-08-15", games: [] },
    today: {
      gameDate: "2026-08-14",
      builtOn: "2026-08-15",
      games: [],
      probableDate: null,
      probables: [],
      starRule: "3安打以上",
      starLimit: 6,
      prev: null,
      dayCount: 1,
    },
    days: [],
    dayIndex: { season: 2026, latestDate: "2026-08-14", days: [] },
    games: [],
    ...over,
  };
}

const SITE = { name: "bb-app", contact: "a@example.invalid" };

test("사이트는 정해진 파일 집합을 만든다", () => {
  const out = buildSite(siteData(), SITE, "2026-08-15");
  const paths = out.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "assets/icon.svg",
    "assets/site.css",
    "assets/site.js",
    "compare.html",
    "compare/41045153.json",
    "days.html",
    "index.html",
    "matchup.html",
    "players.json",
    "players/41045153.html",
    "ranking.html",
    "starters.html",
    "today.html",
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

/** 날짜 화면 하나 */
function day(date: string) {
  return {
    date, builtOn: "2026-08-15", games: [], starRule: "3安打以上", starLimit: 6,
    prev: null, next: null, latestDate: "2026-08-14", dayCount: 2,
  };
}

/**
 * ⚠**최신 경기일의 날짜 페이지는 만들지 않는다.** `today.html`이 같은 내용을 이미 내고 있어서,
 * 두 주소에 같은 화면이 생기면 「어느 쪽이 진짜인가」가 생긴다.
 * ⚠**파일 목록과 시즌 경로 목록이 같은 규칙을 봐야 한다** — 어긋나면 시즌 전환이 404로 간다.
 */
test("최신 경기일의 날짜 페이지는 만들지 않는다 — 그 날은 today.html이 맡는다", () => {
  const data = siteData({ days: [day("2026-08-13"), day("2026-08-14")] });
  const paths = buildSite(data, SITE, "2026-08-15").files.map((f) => f.path);
  assert.ok(paths.includes("days/2026-08-13.html"));
  assert.ok(!paths.includes("days/2026-08-14.html"), "최신 경기일이 두 주소에 생겼다");

  const known = seasonPaths(data, false);
  assert.ok(known.has("days.html"), "날짜 일람이 시즌 경로 목록에 없다");
  assert.ok(known.has("days/2026-08-13.html"));
  assert.ok(!known.has("days/2026-08-14.html"), "만들지 않는 날짜를 시즌 전환이 가리킨다");
});

test("시즌 경로 목록과 실제로 만든 파일이 어긋나지 않는다 — 어긋난 만큼이 404다", () => {
  const data = siteData({ days: [day("2026-08-13"), day("2026-08-14")] });
  const made = new Set(buildSite(data, SITE, "2026-08-15").files.map((f) => f.path));
  for (const p of seasonPaths(data, false)) {
    assert.ok(made.has(p), `${p} 를 만든다고 해놓고 안 만들었다`);
  }
});
