import { colorOf } from "@bb-app/domain";
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
    home: {
      season: 2026,
      asOf: "2026-08-14",
      latestDate: "2026-08-14",
      latest: null,
      leagues: [],
      week: null,
      paces: [],
      milestones: [],
      streaks: [],
      hasPostseason: false,
      seasonOver: false,
    },
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
              kana: "さとう・てるあき",
              uniformNumber: "8",
              mark: "内",
              axes: p.mark.axes,
              summary: "打率 .317（382打数）",
              sampleText: p.mark.sampleText,
            },
          ],
        },
      ],
      highlights: [],
    },
    ranking: { season: 2026, asOf: "2026-08-14", standings: [], tieRule: "同順位", draws: [], leagues: [] },
    starters: { heldFrom: 2019, gameDate: null, defaultDate: null, prev: null, next: null, dayCount: 0, builtOn: "2026-08-15", games: [] },
    starterDays: [],
    matchup: { season: 2026, asOf: "2026-08-14", builtOn: "2026-08-15", days: [
      { date: "2026-08-15", state: "unknown" as const, hasProbable: false, games: [] },
      { date: "2026-08-16", state: "unknown" as const, hasProbable: false, games: [] },
    ] },
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
    heldSeasons: { from: 2022, to: 2026 },
    latestAnyGameDate: "2026-08-14",
    postseason: { season: 2026, competitions: [] },
    teams: [],
    // ⚠**경기가 없어도 만든다** — 시즌 전환의 목적지이고, 화면이 「아직 못 매겼다」고 말한다(M12)
    teamsPage: { season: 2026, asOf: "2026-08-14", leagues: [] },
    // ⚠**정상은 빈 배열이다.** 비지 않으면 빌드가 종료 코드 1을 낸다(`tools/build.ts` · 검토 m2)
    raceDisagreed: [],
    // ⚠**끝난 시즌인데 `unknown` 이면 빌드가 종료 코드 1**(`tools/build.ts` · 검토 ①)
    raceStatus: { basis: "confirmed", series: { intra: 25, inter: 3 }, seasonOver: false },
    // ⚠**리그가 실려 있고 셋 다 0/false 인 것이 정상이다** — 하나라도 어긋나면 빌드가 종료 코드 1
    wobaDerivation: [
      { league: "central", fellBack: false, skipped: 0, unrecognized: 0 },
      { league: "pacific", fellBack: false, skipped: 0, unrecognized: 0 },
    ],
    games: [],
    ...over,
  };
}

const SITE = { name: "bb-app", contact: "a@example.invalid" };

test("사이트는 정해진 파일 집합을 만든다", () => {
  const out = buildSite(siteData(), SITE, "2026-08-15");
  const paths = out.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    /**
     * ⚠**Cloudflare Pages 가 배포할 때 읽는 헤더 파일**(2026-08-18 감사 P2 대응).
     * 화면이 아니라서 링크 검사에도 안 걸리고, 문법이 틀리면 **조용히 무시된다** —
     * 그래서 「있는지」만이라도 여기서 못 박는다. 내용은 `site.ts` HEADERS.
     */
    "_headers",
    "assets/icon.svg",
    "assets/site.css",
    "assets/site.js",
    "compare.html",
    // ⚠**선수마다가 아니라 ID 첫 글자로 묶는다**(`41045153` → `4`).
    // 예전엔 선수마다 파일이었고, 그 2.5KB짜리들이 4시즌 산출물의 29%(2,797개)를 차지해
    // Cloudflare Pages 배포 상한(20,000)을 먹고 있었다
    "compare/4.json",
    "days.html",
    /**
     * ⚠**용어집은 루트 한 장이다**(2026-08-21). 시즌마다 만들면 같은 글이 9번 올라가고
     * 한쪽만 갱신되는 날 **시즌에 따라 설명이 달라진다** — `log.html` 과 같은 이유다.
     * 그래서 `seasonPaths` 에도 **넣지 않는다** — 시즌 전환이 이 화면을 찾지 않아야 한다.
     */
    "glossary.html",
    "index.html",
    "matchup.html",
    // ⚠**루트는 대시보드, 선수 일람은 players.html**(2026-08-17)
    "players.html",
    "players.json",
    "players/41045153.html",
    "ranking.html",
    "starters.html",
    /**
     * ⚠**구단으로 가는 길**(2026-08-19 Task 7). 시즌마다 한 장이고,
     * `seasonPaths` 에도 같은 이름이 들어 있어야 시즌 전환이 튕기지 않는다.
     */
    "teams.html",
    "today.html",
  ]);
  assert.equal(out.playerCount, 1);
  assert.equal(out.stale, false);
});

test("경기가 없으면 낡음으로 보고한다 — 호출자가 종료 코드를 바꾼다", () => {
  const out = buildSite(siteData({ asOf: null, latestAnyGameDate: null }), SITE, "2026-08-15");
  assert.equal(out.stale, true);
  assert.equal(out.latestGameDate, null);
});

/**
 * ⚠**신선도는 대회를 가리지 않는다.**
 * 정규시즌만 보면 10월에 사이트 전체가 「更新が止まっています … 取得に失敗している可能性があります」로 바뀌는데,
 * **같은 빌드의 포스트시즌 화면은 어제 경기를 보여주고 있다.**
 * 게다가 빌드가 종료 코드 1을 내므로 **일일 배치가 매일 실패로 보고된다.**
 * 날짜가 정해진 결함이라 손대지 않으면 그때 반드시 터진다.
 */
test("포스트시즌이 진행 중이면 낡았다고 하지 않는다 — 정규시즌만 보면 10월에 거짓말한다", () => {
  const out = buildSite(
    // 정규시즌은 10/5에 끝났고 오늘은 10/20 — 그런데 어제 CS 경기가 있었다
    siteData({ asOf: "2026-10-05", latestAnyGameDate: "2026-10-19" }),
    SITE,
    "2026-10-20",
  );
  assert.equal(out.stale, false, "포스트시즌이 도는 중인데 취득 실패라고 했다");
  assert.equal(out.latestGameDate, "2026-10-19", "보고하는 날짜가 판정과 다르다");
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

/**
 * ⚠**목록과 파일은 양방향으로 맞아야 한다.**
 * 한쪽만 보면 「만들었는데 목록에 없는」 화면이 생기고, 그 화면은 다른 시즌에서 볼 때
 * **조용히 選手一覧으로 튕긴다** — 404는 아니지만 사람은 「없어졌다」고 읽는다.
 */
test("만든 화면이 전부 시즌 경로 목록에 있다 — 빠진 만큼이 조용히 튕긴다", () => {
  const data = siteData({
    days: [day("2026-08-13")],
    teams: [
      {
        season: 2026, teamCode: "t", name: "阪神タイガース", shortName: "阪神",
        color: { base: "#f2c800", ink: "#17170f" }, leagueName: "セントラル・リーグ",
    calendar: {
      teamCode: "t",
      shortName: "阪神",
      color: colorOf("t"),
      today: "2026-08-17",
      upcoming: 1,
      upcomingAsOf: "2026-08-17",
      seasonOver: false,
      months: [
        {
          key: "2026-08",
          year: 2026,
          month: 8,
          // 2026-08-01 은 토요일(요일 계산은 순수 함수로 낸다)
          firstWeekday: 6,
          days: 31,
          byDay: new Map([
            [16, [{
              date: "2026-08-16", slug: "2026-0816-t-g-15", opponent: "巨人", opponentCode: "g",
              home: true, result: "win" as const, runsFor: 5, runsAgainst: 2,
              startTime: null, venue: "", upcoming: false,
            }]],
            [18, [{
              date: "2026-08-18", slug: null, opponent: "DeNA", opponentCode: "db",
              home: false, result: null, runsFor: null, runsAgainst: null,
              startTime: "17:45", venue: "横浜", upcoming: true,
            }]],
          ]),
        },
      ],
    },
        asOf: "2026-08-14", rank: 1, tiedRank: false, games: 1, w: 1, l: 0, t: 0,
        pct: 1, gamesBehind: 0, rf: 1, ra: 0,
        avg: { value: null, denominator: 0 }, era: { value: null, denominator: 0 },
        home: { w: 1, l: 0, t: 0 }, away: { w: 0, l: 0, t: 0 }, last10: { w: 1, l: 0, t: 0 },
        months: [], batters: [], pitchers: [], recent: [], vs: [], latestDate: "2026-08-14",
        batQualifier: "規定打席 4", pitQualifier: "先発は規定投球回 1回",
        hasPostseason: false,
        // ⚠**판정이 안 선 상태를 픽스처의 기본으로 둔다**(M11) — 이 시험이 재는 것은 경로 목록이지
        // 우승 경쟁이 아니고, 그렇다면 「모른다」가 가장 정직한 입력이다
        now: {
          race: {
            teamCode: "t", remaining: null, h2hLeft: new Map(),
            selfPossible: null, magic: null, eliminated: null,
          },
          next: null,
          probable: null,
        },
        streaks: [],
        milestones: [],
      },
    ],
  });
  const known = seasonPaths(data, false);
  const made = buildSite(data, SITE, "2026-08-15").files.map((f) => f.path);
  /**
   * ⚠**사이트에 한 장뿐인 화면은 시즌 경로 목록에 들어가면 안 된다.**
   * 넣으면 시즌 전환이 `2025/glossary.html` 을 찾고, 그건 **만들지 않으므로 404** 다.
   * ⚠**이 목록을 「예외」으로 늘리지 마라** — 한 줄 늘릴 때마다
   * 「그 화면은 시즌이 바뀌어도 같은 내용인가」를 답해야 한다.
   */
  const SITE_WIDE = new Set(["glossary.html"]);
  for (const p of made) {
    // 자산·색인은 화면이 아니다 — 시즌 전환의 대상이 아니므로 목록에도 없다
    if (!p.endsWith(".html")) continue;
    if (SITE_WIDE.has(p)) {
      assert.ok(!known.has(p), `${p} 는 사이트에 한 장인데 시즌 경로 목록에 들어갔다 — 시즌 전환이 404 로 간다`);
      continue;
    }
    assert.ok(known.has(p), `${p} 를 만들었는데 시즌 경로 목록에 없다`);
  }
  assert.ok(known.has("teams/t.html"), "팀 화면이 목록에 없다");
});


/**
 * ⚠**첫 화면 명부 698행에 숫자가 한 개도 없었다.**
 * 각 행은 마크 + 이름 + 포지션 한 글자뿐이었고, 리그 리더는 문서의 94.1% 지점에 있었다.
 * 여백 과다가 아니라 **정보 결손**이다 — 값은 계속 있었고 **실리는 자리가 없었을 뿐**이다
 * (같은 문자열을 헤더 검색 드롭다운이 이미 보여주고 있었다).
 */
test("⚠명부의 각 행이 성적을 한 줄 보여준다 — 분모까지 함께(M2)", () => {
  const out = buildSite(siteData(), SITE, "2026-08-16");
  // ⚠**루트가 아니라 選手一覧 화면을 본다**(2026-08-17부터 루트는 대시보드다)
  const idx = out.files.find((f) => f.path === "players.html");
  assert.notEqual(idx, undefined, "일람 화면이 없다");
  assert.ok(idx!.content.includes("打率 .317（382打数）"), "명부에 성적이 없다");
  // ⚠**분모가 문자열 안에 있다** — 명부의 성적 줄은 하나도 빠짐없이 분모를 동반해야 한다(M2)
  const rows = [...idx!.content.matchAll(/<span class="hs">([^<]*)<\/span>/g)].map((m) => m[1] ?? "");
  assert.ok(rows.length > 0, "성적 줄을 못 찾았다 — 이 시험이 공회전한다");
  const bare = rows.filter((r) => !r.includes("（"));
  assert.deepEqual(bare, [], `분모 없는 성적 줄이 있다: ${bare.join(" / ")}`);
});

/** ⚠**성적이 없으면 자리도 만들지 않는다** — 빈 줄은 「0」처럼 읽힌다(M11) */
test("성적이 없는 선수는 빈 줄을 만들지 않는다", () => {
  const d = siteData();
  const teams = d.index.teams.map((t) => ({
    ...t,
    players: t.players.map((pl) => ({ ...pl, summary: null })),
  }));
  const out = buildSite({ ...d, index: { ...d.index, teams } }, SITE, "2026-08-16");
  const idx = out.files.find((f) => f.path === "index.html")!;
  assert.ok(!idx.content.includes(`class="hs"`), "값이 없는데 자리를 만들었다");
});

/**
 * ⚠**`_headers` 는 「경로가 있다」만 확인하고 내용은 한 글자도 안 봤다**(2026-08-18 감사 P2).
 *
 * 이 파일은 Cloudflare Pages 가 **배포 시에** 읽는 것이라 링크 검사에도 안 걸리고,
 * 문법이 틀리면 **조용히 무시된다.** 즉 헤더가 통째로 사라져도 아무도 모른다.
 * ⚠**형태까지 못 박는다** — 첫 줄이 경로, 이후 줄은 두 칸 들여쓰기 + `이름: 값`.
 */
test("⚠_headers 가 CSP 를 unsafe-inline 없이 닫는다 — 내용까지 본다", () => {
  const f = buildSite(siteData(), SITE, "2026-08-15").files.find((x) => x.path === "_headers");
  assert.notEqual(f, undefined, "_headers 가 없다");
  const lines = (f?.content ?? "").split("\n").filter((l) => l !== "");
  assert.equal(lines[0], "/*", "첫 줄이 경로 패턴이 아니다 — Pages 가 통째로 무시한다");
  for (const l of lines.slice(1)) {
    assert.match(l, /^ {2}[A-Za-z-]+: .+$/, `헤더 줄의 형태가 다르다: ${JSON.stringify(l)}`);
  }
  const csp = lines.find((l) => l.includes("Content-Security-Policy"));
  assert.notEqual(csp, undefined, "CSP 헤더가 없다");
  assert.match(csp ?? "", /script-src 'self'/, "script-src 가 self 로 닫혀 있지 않다");
  /**
   * ⚠**style-src 의 unsafe-inline 은 의도된 것이다**(구단 색을 인라인 속성으로 나른다).
   * 그러니 「unsafe-inline 이 없다」가 아니라 **「script-src 에 없다」**를 봐야 한다 —
   * 통째로 금지하면 이 시험이 곧 거짓이 되어 누군가 지운다.
   */
  const scriptSrc = /script-src ([^;]*)/.exec(csp ?? "")?.[1] ?? "";
  assert.ok(!scriptSrc.includes("unsafe-inline"), `script-src 가 열려 있다: ${scriptSrc}`);
  assert.ok(!scriptSrc.includes("unsafe-eval"), `script-src 에 unsafe-eval 이 있다: ${scriptSrc}`);
  for (const must of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) {
    assert.ok((csp ?? "").includes(must), `CSP 에 ${must} 가 없다`);
  }
});
