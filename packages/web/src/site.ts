/**
 * 사이트 조립 — 데이터 → 파일 목록.
 *
 * ⚠**파일을 쓰지 않는다.** 경로와 내용의 쌍을 돌려줄 뿐이고, 실제 쓰기는 `tools/build.ts`가 한다.
 * 그래야 「무엇이 만들어지는가」를 디스크 없이 테스트할 수 있다.
 */
import { CLIENT_JS, CSS } from "./assets.ts";
import {
  renderIndexPage,
  renderMatchupPage,
  renderRankingPage,
  renderStartersPage,
  searchIndexJson,
} from "./pages.ts";
import { renderPlayerPage } from "./player-page.ts";
import { compareCard, compareCardJson, renderComparePage } from "./compare.ts";
import { renderDayIndexPage, renderDayPage, renderTodayPage } from "./today-page.ts";
import { gameSlug, renderGamePage } from "./game-page.ts";
import { renderLogPage } from "./log-page.ts";
import type { LogPageData } from "./log-page.ts";
import { freshness, isStale, pathsFor } from "./layout.ts";
import type { RenderContext, SeasonPlan, SiteMeta } from "./layout.ts";
import type { SiteData } from "./query.ts";

export interface SiteFile {
  /** 출력 루트 기준 상대 경로. 항상 `/` 구분자 */
  path: string;
  content: string;
}

export interface BuildResult {
  files: SiteFile[];
  /** 신선도 판정. 낡았으면 호출자가 종료 코드를 바꾼다 */
  stale: boolean;
  latestGameDate: string | null;
  playerCount: number;
}

/**
 * 한 시즌이 만드는 **화면 경로**(시즌 안 기준).
 *
 * ⚠**렌더링 전에 알아야 한다.** 시즌 전환이 「그 시즌에 같은 화면이 있는가」를 물어야 하고,
 * 없는 곳으로 링크하면 404가 된다 — 조용하고 발견이 늦다.
 */
/**
 * 실제로 만들어지는 날짜 화면.
 *
 * ⚠**최신 경기일은 `today.html`이 맡는다.** 그 날의 `days/` 페이지는 만들지 않으므로,
 * **파일 목록과 시즌 경로 목록이 같은 규칙을 봐야 한다** — 어긋나면 시즌 전환이 404로 간다.
 */
function pastDays(data: SiteData): SiteData["days"] {
  return data.days.filter((d) => d.date !== data.today.gameDate);
}

export function seasonPaths(data: SiteData, hasLog: boolean): Set<string> {
  const out = new Set<string>([
    "today.html",
    "index.html",
    "ranking.html",
    "starters.html",
    "matchup.html",
    "compare.html",
    "days.html",
  ]);
  if (hasLog) out.add("log.html");
  for (const d of pastDays(data)) out.add(`days/${d.date}.html`);
  for (const p of data.players) out.add(`players/${p.playerId}.html`);
  for (const g of data.games) out.add(`games/${gameSlug(g.gameId)}.html`);
  return out;
}

export function buildSite(
  data: SiteData,
  site: SiteMeta,
  builtOn: string,
  // ⚠수집 기록이 없으면 그 페이지를 만들지 않는다 — 빈 페이지를 두는 것보다 없는 편이 정직하다
  log?: LogPageData,
  /**
   * 전 시즌의 배치. 시즌 전환을 그리는 데 쓴다.
   * ⚠**비우면 시즌이 하나뿐인 것으로 다룬다** — 전환 띠가 안 나온다.
   */
  plans: readonly SeasonPlan[] = [],
): BuildResult {
  const f = freshness(data.asOf, builtOn);
  const me = plans.find((p) => p.season === data.season);
  const prefix = me?.prefix ?? "";
  const ctx: RenderContext = { site, freshness: f, paths: pathsFor(plans, data.season) };

  /** 시즌 접두사를 붙인다. ⚠**자산은 붙이지 않는다** — 사이트 전체가 한 벌을 쓴다 */
  const at = (p: string): string => `${prefix}${p}`;

  const files: SiteFile[] = [
    /**
     * ⚠**자산은 사이트에 한 벌이다.** 시즌마다 쓰면 같은 CSS·JS가 두 번 올라가고,
     * 한쪽만 갱신되는 순간 시즌에 따라 화면이 다르게 동작한다.
     * 그래서 **현재 시즌(접두사 없음)일 때만** 쓴다.
     */
    ...(prefix === ""
      ? [
          { path: "assets/site.css", content: CSS },
          { path: "assets/site.js", content: CLIENT_JS },
        ]
      : []),
    { path: at("today.html"), content: renderTodayPage(data.today, ctx) },
    { path: at("days.html"), content: renderDayIndexPage(data.dayIndex, ctx) },
    ...pastDays(data).map((d) => ({ path: at(`days/${d.date}.html`), content: renderDayPage(d, ctx) })),
    { path: at("index.html"), content: renderIndexPage(data.index, ctx) },
    { path: at("ranking.html"), content: renderRankingPage(data.ranking, ctx) },
    { path: at("starters.html"), content: renderStartersPage(data.starters, ctx) },
    {
      path: at("matchup.html"),
      content: renderMatchupPage(data.matchup, ctx),
    },
    {
      path: at("compare.html"),
      content: renderComparePage({ season: data.season, asOf: data.asOf }, ctx),
    },
    { path: at("players.json"), content: searchIndexJson(data.search) },
  ];

  if (log !== undefined) {
    files.push({ path: at("log.html"), content: renderLogPage(log, ctx) });
  }

  for (const p of data.players) {
    // ⚠**선수 ID는 외부에서 온 문자열이고, 여기서 파일 경로가 된다.**
    // `../`가 섞이면 출력 디렉터리 밖에 쓴다 — 조용히 정규화하지 말고 던진다.
    if (!/^[A-Za-z0-9_-]+$/.test(p.playerId)) {
      throw new Error(`선수 ID가 경로로 쓸 수 없는 형태다: ${JSON.stringify(p.playerId)}`);
    }
    files.push({ path: at(`players/${p.playerId}.html`), content: renderPlayerPage(p, ctx) });
    // ⚠**비교용 값을 따로 계산하지 않는다**(M1) — 위 페이지가 쓰는 것과 같은 객체에서 뽑는다
    files.push({ path: at(`compare/${p.playerId}.json`), content: compareCardJson(compareCard(p)) });
  }

  /**
   * 경기 페이지.
   *
   * ⚠**경기 ID가 파일 경로가 된다.** `2026/0814/s-db-17` 형태이므로 `/`를 그대로 두면
   * 디렉터리가 세 겹 파이는데, 그건 상대 경로 계산을 어렵게 만들 뿐이다 — 평평하게 편다.
   * 그리고 **외부에서 온 문자열이므로 형태를 검사한다**(선수 ID와 같은 이유).
   */
  for (const g of data.games) {
    const slug = gameSlug(g.gameId);
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
      throw new Error(`경기 ID가 경로로 쓸 수 없는 형태다: ${JSON.stringify(g.gameId)}`);
    }
    files.push({ path: at(`games/${slug}.html`), content: renderGamePage(g, ctx) });
  }

  return {
    files,
    stale: isStale(f),
    latestGameDate: data.asOf,
    playerCount: data.players.length,
  };
}
