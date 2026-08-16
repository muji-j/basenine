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
import { renderTodayPage } from "./today-page.ts";
import { gameSlug, renderGamePage } from "./game-page.ts";
import { renderLogPage } from "./log-page.ts";
import type { LogPageData } from "./log-page.ts";
import { freshness, isStale } from "./layout.ts";
import type { SiteMeta } from "./layout.ts";
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

export function buildSite(
  data: SiteData,
  site: SiteMeta,
  builtOn: string,
  // ⚠수집 기록이 없으면 그 페이지를 만들지 않는다 — 빈 페이지를 두는 것보다 없는 편이 정직하다
  log?: LogPageData,
): BuildResult {
  const f = freshness(data.asOf, builtOn);
  const ctx = { site, freshness: f };

  const files: SiteFile[] = [
    { path: "assets/site.css", content: CSS },
    { path: "assets/site.js", content: CLIENT_JS },
    { path: "today.html", content: renderTodayPage(data.today, ctx) },
    { path: "index.html", content: renderIndexPage(data.index, ctx) },
    { path: "ranking.html", content: renderRankingPage(data.ranking, ctx) },
    { path: "starters.html", content: renderStartersPage(data.starters, ctx) },
    {
      path: "matchup.html",
      content: renderMatchupPage({ season: data.season, asOf: data.asOf }, ctx),
    },
    {
      path: "compare.html",
      content: renderComparePage({ season: data.season, asOf: data.asOf }, ctx),
    },
    { path: "players.json", content: searchIndexJson(data.search) },
  ];

  if (log !== undefined) {
    files.push({ path: "log.html", content: renderLogPage(log, ctx) });
  }

  for (const p of data.players) {
    // ⚠**선수 ID는 외부에서 온 문자열이고, 여기서 파일 경로가 된다.**
    // `../`가 섞이면 출력 디렉터리 밖에 쓴다 — 조용히 정규화하지 말고 던진다.
    if (!/^[A-Za-z0-9_-]+$/.test(p.playerId)) {
      throw new Error(`선수 ID가 경로로 쓸 수 없는 형태다: ${JSON.stringify(p.playerId)}`);
    }
    files.push({ path: `players/${p.playerId}.html`, content: renderPlayerPage(p, ctx) });
    // ⚠**비교용 값을 따로 계산하지 않는다**(M1) — 위 페이지가 쓰는 것과 같은 객체에서 뽑는다
    files.push({ path: `compare/${p.playerId}.json`, content: compareCardJson(compareCard(p)) });
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
    files.push({ path: `games/${slug}.html`, content: renderGamePage(g, ctx) });
  }

  return {
    files,
    stale: isStale(f),
    latestGameDate: data.asOf,
    playerCount: data.players.length,
  };
}
