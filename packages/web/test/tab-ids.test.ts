/**
 * **같은 문서에 `id` 가 두 번 있으면 그 자리로 가는 URL 이 사라진다.**
 *
 * ⚠**「HTML 유효성 문제」가 아니라 도달성 결함이었다**(2026-08-19 감사 · 실측).
 * 순위표의 부문 탭(`rankcat`)과 지표 탭(`rankmetric-*`)이 **セ 패널 안과 パ 패널 안에
 * 그대로 두 번** 그려져서, `dist` 전 15,340장 중 **ranking.html 9장**(시즌별 8 + 현행 1)에
 * **중복 id 86종 / 172노드**가 있었다.
 * `ranking.html#pn-rankmetric-starter-era` 로 들어가면 `getElementById` 가 **セ 사본**을
 * 반환하고 `revealHash()` 가 그쪽 조상만 편다 — 열린 리그 패널이 `['central']` 이었다.
 * → **パ의 어떤 개인 지표도 링크로 가리킬 수 없었다.**
 * 부수적으로 パ 탭의 `aria-controls` 와 パ 패널의 `aria-labelledby` 가 전부 セ 쪽을 가리켜,
 * 낭독기에는 「パ의 打者 탭이 セ의 패널을 조작한다」고 들렸다.
 *
 * ⚠**고치는 방향은 「그룹을 나눈다」가 아니다.** 같은 `data-tabgroup` 을 공유하는 것이
 * 「리그를 바꿔도 지표 선택이 남는다」의 근거다(parts.ts `tablist` 주석).
 * **id 만 리그별로 나누고 그룹 이름은 공유한다** — 아래 마지막 시험이 그 경계를 지킨다.
 *
 * ⚠**중복 id 는 링크 검사가 원리적으로 못 잡았다** — `LinkIndex.ids` 가 `Set` 이라
 * 두 번 나온 id 도 「있다」로만 보였다. 그래서 검사기 쪽에도 `dupIds` 를 두고
 * 여기서는 **그 한 벌을 그대로 써서** 잰다(M1 · 두 벌로 만들지 않는다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colorOf } from "@bb-app/domain";
import { renderRankingPage } from "../src/pages.ts";
import type { LeagueSection, RankingPageData, StandingRow } from "../src/pages.ts";
import { TIE_RULE } from "../src/parts.ts";
import { duplicateIds, linkIndex } from "../src/link-check.ts";
import { context, rankingPanel } from "./fixtures.ts";

function standingRow(over: Partial<StandingRow> = {}): StandingRow {
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

/**
 * 한 리그분의 개인 순위. **부문을 둘 이상 둔다** — 부문이 하나면
 * 「부문 탭이 리그마다 복제된다」를 재지 못한다.
 */
function league(id: string, name: string): LeagueSection {
  return {
    id,
    name,
    categories: [
      { id: "batter", label: "打者", panels: [rankingPanel(), rankingPanel({ id: "avg", label: "打率" })] },
      { id: "starter", label: "先発", panels: [rankingPanel({ id: "era", label: "防御率" })] },
    ],
  };
}

/** ⚠**두 리그를 반드시 넣는다.** 한 리그만이면 중복이 애초에 생기지 않아 시험이 공회전한다 */
function twoLeagues(): RankingPageData {
  return {
    season: 2026,
    asOf: "2026-08-14",
    seasonOver: false,
    standings: [
      { id: "central", name: "セントラル・リーグ", rows: [standingRow()] },
    ],
    tieRule: TIE_RULE,
    draws: [],
    leagues: [league("central", "セントラル・リーグ"), league("pacific", "パシフィック・リーグ")],
  };
}

const rendered = (): string => renderRankingPage(twoLeagues(), context());

/** 검사기와 **같은 한 벌**로 센다(M1) */
function dupsOf(html: string): string[] {
  return linkIndex({ path: "ranking.html", content: html }).dupIds;
}

test("⚠순위표에 중복 id 가 없다 — 있으면 파 리그의 지표를 URL 로 가리킬 수 없다", () => {
  const out = rendered();
  // 공회전 방지: 두 리그가 실제로 그려졌는가
  assert.ok(out.includes('id="lg-central"') && out.includes('id="lg-pacific"'), "두 리그가 안 그려졌다");
  assert.deepEqual(dupsOf(out), [], "같은 id 가 두 번 나온다 — 깊은 링크가 먼저 나온 쪽으로만 간다");
});

/**
 * ⚠**「id 가 있다」와 「그 id 가 하나다」는 다르다.** ARIA 참조는 `getElementById` 와
 * 같은 규칙으로 풀리므로, 중복이면 **두 리그 중 문서에서 먼저 나온 쪽**을 가리킨다.
 * 그래서 「같은 리그 안에 있는가」만 재면 중복 상태에서도 통과한다(둘 다 자기 사본을 갖고 있다).
 * **유일성과 소속을 함께** 잰다.
 */
test("⚠부문·지표 탭의 ARIA 참조가 같은 리그의 짝을 유일하게 가리킨다", () => {
  const out = rendered();
  /** 리그 패널의 시작 위치. 여기부터 다음 리그 패널까지가 그 리그의 영역이다 */
  const marks = [...out.matchAll(/\sid="pn-rankleague-([a-z]+)"/g)].map((m) => ({
    league: m[1] ?? "",
    at: m.index,
  }));
  assert.equal(marks.length, 2, `리그 패널이 ${marks.length}개다 — 픽스처가 두 리그를 안 만들었다`);
  const regionOf = (at: number): string => {
    let hit = "";
    for (const m of marks) if (m.at <= at) hit = m.league;
    return hit;
  };

  let checked = 0;
  const bad: string[] = [];
  for (const m of out.matchAll(/\s(aria-(?:controls|labelledby))="([^"]+)"/g)) {
    const attr = m[1] ?? "";
    const ref = m[2] ?? "";
    // 리그·갈래 탭은 레일에 있고 리그 영역 밖이 정상이다. 여기서 보는 것은 부문·지표뿐이다
    if (!/^(?:tb|pn)-rank(?:cat|metric)/.test(ref)) continue;
    checked += 1;
    const hits = [...out.matchAll(new RegExp(`\\sid="${ref}"`, "g"))];
    if (hits.length !== 1) {
      bad.push(`${attr}="${ref}" 가 가리키는 id 가 ${hits.length}개다`);
      continue;
    }
    const from = regionOf(m.index);
    const to = regionOf(hits[0]!.index);
    if (from !== to) bad.push(`${attr}="${ref}" — ${from} 안에서 ${to} 의 짝을 가리킨다`);
  }
  // 공회전 방지: 부문 2 + 지표 3 = 5쌍 × 탭·패널 2 × 리그 2 = 20건이 기대치다
  assert.ok(checked >= 20, `부문·지표의 ARIA 참조를 ${checked}건밖에 못 봤다 — 이 시험이 공회전한다`);
  assert.deepEqual(bad, [], `어긋난 ARIA 참조 ${bad.length}건 / 검사한 참조 ${checked}건`);
});

/**
 * ⚠**id 를 나누면서 그룹까지 나누면 동작이 바뀐다.**
 * 「리그를 바꿔도 보고 있던 지표가 유지된다」는 **같은 `data-tabgroup` 을 공유**하는 데서 온다
 * (parts.ts `tablist`). id 만 나누고 그룹은 한 이름이어야 한다 —
 * 이 시험이 그 경계를 지킨다(그룹까지 리그별로 나누는 「고침」이면 여기서 떨어진다).
 */
test("⚠부문·지표 탭의 그룹 이름은 두 리그가 공유한다 — 리그를 바꿔도 지표 선택이 남는다", () => {
  const out = rendered();
  const count = (re: RegExp): number => [...out.matchAll(re)].length;
  assert.equal(count(/data-tabgroup="rankcat"/g), 2, "부문 탭줄이 두 리그에서 같은 그룹을 쓰지 않는다");
  assert.equal(count(/data-panelgroup="rankcat"/g), 4, "부문 패널이 두 리그에서 같은 그룹을 쓰지 않는다");
  // 지표 그룹은 부문마다 나뉘어 있다(打者에서 고른 지표가 先発로 새지 않게) — 리그로는 안 나뉜다
  assert.equal(count(/data-tabgroup="rankmetric-batter"/g), 2, "打者 지표 탭줄의 그룹이 리그별로 갈렸다");
  assert.equal(count(/data-tabgroup="rankmetric-starter"/g), 2, "先発 지표 탭줄의 그룹이 리그별로 갈렸다");
  // ⚠**반대편도 잰다** — 그룹이 부문별로 나뉘어 있지 않으면 「打者에서 고른 지표가 先発에서 사라진다」
  assert.equal(count(/data-tabgroup="rankmetric"[^-]/g), 0, "지표 그룹이 부문별로 나뉘어 있지 않다");
});

// ── 산출물 실측 ────────────────────────────────────────────────────────────────

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/**
 * 화면 표본.
 *
 * ⚠**전수는 빌드가 본다**(`tools/build.ts` 의 중복 id 게이트 · 15,340장). 여기서 15,340장을
 * 다시 읽으면 **20.8초**가 든다(2026-08-19 실측) — 시험 한 벌에 그 값을 치를 이유가 없다.
 * 대신 **화면 종류**를 덮는다. 렌더러는 한 벌이라 종류가 같으면 같은 결함이 나온다(M1).
 * ⚠**시즌별 ranking.html 을 전부 넣는다** — 실제로 깨져 있던 9장이 그것이다.
 */
function samplePages(): string[] {
  if (!existsSync(DIST)) return [];
  const top = [
    "index.html", "ranking.html", "teams.html", "starters.html", "postseason.html",
    "today.html", "compare.html", "matchup.html", "log.html", "days.html", "players.html",
  ];
  const seasons = readdirSync(DIST)
    .filter((d) => /^\d{4}$/.test(d))
    .map((d) => join(d, "ranking.html"));
  const dirs: [string, number][] = [
    ["players", 5], ["teams", 5], ["games", 3], ["days", 2], ["starters", 2], ["compare", 2],
  ];
  const nested: string[] = [];
  for (const [d, n] of dirs) {
    const p = join(DIST, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).filter((x) => x.endsWith(".html")).slice(0, n)) nested.push(join(d, f));
  }
  return [...top, ...seasons, ...nested].filter((f) => existsSync(join(DIST, f)));
}

const PAGES = samplePages();

test("⚠배포물에 중복 id 가 없다 — 있으면 그 자리로 가는 URL 이 조용히 다른 곳을 연다", {
  skip: PAGES.length === 0 ? "dist 없음" : false,
}, () => {
  // 공회전 방지: 원래 깨져 있던 화면이 표본에 있는가
  assert.ok(PAGES.includes("ranking.html"), "순위표가 표본에 없다 — 이 시험이 원래 결함을 못 본다");
  assert.ok(PAGES.length >= 20, `표본이 ${PAGES.length}장뿐이다 — 화면 종류를 못 덮는다`);
  const dups = duplicateIds(
    PAGES.map((f) => linkIndex({ path: f, content: readFileSync(join(DIST, f), "utf8") })),
  );
  assert.deepEqual(
    dups.map((d) => `${d.path}: ${d.id}`),
    [],
    `중복 id ${dups.length}건 / 검사한 화면 ${PAGES.length}장`,
  );
});
