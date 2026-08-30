/**
 * 사이트 조립 — 데이터 → 파일 목록.
 *
 * ⚠**파일을 쓰지 않는다.** 경로와 내용의 쌍을 돌려줄 뿐이고, 실제 쓰기는 `tools/build.ts`가 한다.
 * 그래야 「무엇이 만들어지는가」를 디스크 없이 테스트할 수 있다.
 */
import { CLIENT_JS, CSS, ICON_SVG } from "./assets.ts";
import {
  renderIndexPage,
  renderMatchupPage,
  renderRankingPage,
  renderStartersPage,
  searchIndexJson,
} from "./pages.ts";
import { renderPlayerPage } from "./player-page.ts";
import { compareCard, compareShardJson, compareShardOf, renderComparePage } from "./compare.ts";
import type { CompareCard } from "./compare.ts";
import { renderDayIndexPage, renderDayPage, renderTodayPage } from "./today-page.ts";
import { renderPostseasonPage } from "./postseason-page.ts";
import { renderTeamPage, teamPath } from "./team-page.ts";
import { renderTeamsPage } from "./teams-page.ts";
import { gameDayPath, gameSlug, renderGameDayPage } from "./game-page.ts";
import type { GamePageData } from "./game-page.ts";
import { renderLogPage } from "./log-page.ts";
import { GLOSSARY_PATH, renderGlossaryPage } from "./glossary-page.ts";
import type { LogPageData } from "./log-page.ts";
import { ROSTER_PATH, TEAMS_PATH, freshness, isStale, pathsFor } from "./layout.ts";
import type { RenderContext, SeasonPlan, SiteMeta } from "./layout.ts";
import type { SiteData } from "./query.ts";
import { renderHomePage } from "./home-page.ts";

/**
 * Cloudflare Pages 의 응답 헤더(`_headers`).
 *
 * ⚠**XSS 방어층이 html.ts 의 이스케이프 하나뿐이었다**(2026-08-18 감사 P2).
 * 그 한 겹이 뚫리면 막을 것이 없었다 — 이 사이트의 글자는 **전부 외부 사이트에서 긁어온 것**이라
 * (선수명·구장명·경기 결과 문장) 신뢰할 수 없는 입력이 화면까지 오는 경로가 실재한다.
 *
 * ⚠**script-src 를 unsafe-inline 없이 닫았다.** 그러려고 선수 페이지의 인라인 부트스트랩을
 * `type="application/json"` **데이터 블록**으로 바꿨다(layout.ts / player-page.ts).
 * 실측(2026-08-18): dist 표본에서 **실행되는 인라인 script 0개 · on* 속성 0개 · form 0개**.
 * ⚠**style-src 에는 unsafe-inline 이 필요하다** — 구단 색을 `style="--team:…"` 인라인 속성으로
 * 나르고(로고를 못 쓰는 자리에서 팀을 말하는 유일한 수단 · §6) 화면마다 작은 `<style>` 이 하나 있다.
 * 속성·스타일은 스크립트를 실행하지 않으므로 방어의 본체(script-src)는 닫힌 채로 남는다.
 * ⚠**frame-ancestors 'none'** — 남의 프레임에 넣어 자기 것처럼 보이게 하는 것을 막는다(§2-5 3층).
 * ⚠**form-action 'none'** — 이 사이트에 `<form>` 이 0개다. 생기면 여기도 같이 고쳐라.
 *
 * ⚠**빌드가 이 파일을 검사하지 않는다** — Pages 가 배포 시에 읽는 파일이라 링크 검사에 안 걸리고,
 * 문법이 틀리면 **조용히 무시된다.** 바꾼 뒤에는 배포된 응답 헤더를 실제로 확인하라.
 *
 * ⚠**`Cache-Control` 이 한 줄도 없었다**(2026-08-30). 사용자가 「最新の試合 2026年8月18日 まで反映」을
 * 보고 있는데 그날 배포된 화면은 **8월 29일**이었다. 조사 결과 어긋난 곳이 하나도 없었다 —
 * DB 는 경기 7,580·데이터 나이 1일이었고(구멍도 없다: 7,574→7,580), 빌드도 `최신 경기일 2026-08-29`로
 * 나갔고(그날 두 실행이 3,134+1 파일을 올렸다), 서비스워커·PWA 는 **0건**, 호스트도 하나다.
 * 그리고 **사용자가 본 8/18·8/27 은 둘 다 실재했던 빌드**다(수집 로그 실측 3회·8회).
 * → **산출물은 멀쩡했고 낡은 사본이 전달되고 있었다.**
 *
 * ⚠**띠가 초록이었다는 것이 결정적이었다.** `isStale` 는 `lagDays > 3` 에서 켜지므로
 * 「更新が止まっています」가 아니라 「まで反映」이었다는 것은 **그 화면이 만들어질 당시엔 신선했다**는 뜻이다.
 * 렌더 버그였다면 초록일 수 없다.
 *
 * ⚠**진짜 결함은 「우리가 고르지 않은 것」이다.** 재사용 기간을 플랫폼 기본값에 맡겼고,
 * 그 기본값이 무엇인지 **아무도 재 본 적이 없다.** 하루 3번 다시 만드는 사이트,
 * 그것도 **신선도가 곧 상품인 사이트**가 그 결정을 위임하면 안 된다.
 *
 * ⚠**`no-store` 가 아니라 `max-age=0, must-revalidate` 다** — 사본은 두되 **쓰기 전에 물어보게** 한다.
 * ETag 가 붙으므로 안 바뀐 화면은 304 로 끝나 전송량이 늘지 않는다(L7 과 같은 방향이다).
 * ⚠**자산에 긴 수명을 주지 마라** — `assets/site.css`·`site.js` 는 **파일명에 내용 해시가 없다.**
 * 길게 캐시하면 CSS 를 고쳐도 영영 안 닿는다. 해시를 붙이기 전까지 규칙은 `/*` 한 벌이다.
 */
const HEADERS = [
  "/*",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Cross-Origin-Opener-Policy: same-origin",
  "",
].join("\n");

/**
 * **경로가 되는 문자열은 형태를 검사한다.**
 *
 * ⚠**같은 파일이 같은 위험을 두 번은 막고 두 번은 안 막고 있었다**(2026-08-18 감사 P3).
 * 선수 ID·경기 ID 에는 검사가 있는데 **구단 코드와 경기일에는 없었다** —
 * 둘 다 똑같이 외부(npb.jp)에서 온 문자열이고 똑같이 파일 경로가 된다.
 * 검사를 **한 곳으로 모아** 다음에 경로가 늘 때 빠뜨릴 자리를 없앤다.
 *
 * ⚠**조용히 정규화하지 않는다** — `..` 를 지우고 계속 가면 어느 파일에 썼는지 아무도 모른다.
 */
function safeSegment(value: string, what: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${what}가 경로로 쓸 수 없는 형태다: ${JSON.stringify(value)}`);
  }
  return value;
}

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
    // ⚠**루트는 대시보드, 선수 일람은 따로다**(2026-08-17). 둘 다 시즌마다 있다
    "index.html",
    ROSTER_PATH,
    "ranking.html",
    "starters.html",
    "matchup.html",
    "compare.html",
    "days.html",
    /**
     * 球団一覧. ⚠**다른 시즌으로 전환할 때 같은 화면으로 가야 한다.**
     * 여기에 빠뜨리면 시즌 전환이 이 화면을 「그 시즌에는 없다」고 보고 선수 일람으로 튀긴다.
     */
    TEAMS_PATH,
  ]);
  if (hasLog) out.add("log.html");
  // ⚠**기록이 있는 시즌에만 넣는다.** 없는 화면을 시즌 전환이 가리키면 404가 된다
  if (data.postseason.competitions.length > 0) out.add("postseason.html");
  for (const t of data.teams) out.add(teamPath(t.teamCode));
  for (const d of pastDays(data)) out.add(`days/${d.date}.html`);
  for (const d of data.starterDays) {
    if (d.gameDate !== null) out.add(`starters/${d.gameDate}.html`);
  }
  for (const p of data.players) out.add(`players/${p.playerId}.html`);
  // ⚠**앵커는 경로가 아니다** — 시즌 경로 목록에는 파일 경로만 넣는다
  for (const g of data.games) out.add(gameDayPath(g.gameDate));
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
  // ⚠**신선도는 대회를 가리지 않는다.** 정규시즌만 보면 포스트시즌 기간에
  // 사이트 전체가 「취득 실패」라고 거짓말하고, 빌드가 매일 실패로 끝난다
  // ⚠**마지막 인자가 오프시즌 오진을 막는다**(2026-08-21 반증 라운드 P1).
  //   그전까지 신선도 판정은 「시즌 번호가 최신인가」만 봐서, 최신 시즌이 끝난 뒤
  //   다음 시즌 첫 경기까지의 창(11월~3월)에 「取得に失敗している可能性」을 매일 냈다.
  // ⚠**판정은 `seasonIsOver` 한 벌에서 온다**(M1) — 여기서 다시 계산하지 않는다.
  const f = freshness(
    data.latestAnyGameDate ?? data.asOf,
    builtOn,
    data.asOf,
    data.heldSeasons,
    data.home.seasonOver,
  );
  const me = plans.find((p) => p.season === data.season);
  const prefix = me?.prefix ?? "";
  const ctx: RenderContext = {
    site,
    freshness: f,
    paths: pathsFor(plans, data.season),
    // ⚠**기록이 있는 시즌에만 내비에 항목을 낸다.** 2026년은 아직 포스트시즌이 없다 —
    // 눌러도 빈 화면이 나오는 항목은 고장으로 읽힌다
    hasPostseason: data.postseason.competitions.length > 0,
  };

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
          { path: "assets/icon.svg", content: ICON_SVG },
          { path: "_headers", content: HEADERS },
          /**
           * ⚠**용어집은 시즌마다 만들지 않는다.** 용어는 시즌에 매이지 않고,
           * 시즌마다 만들면 같은 글이 9번 올라가며 한쪽만 갱신되는 날 **시즌에 따라 설명이 달라진다.**
           * `log.html` 이 같은 이유로 루트 전용이고, 링크는 `root` 로 간다(layout.ts 푸터).
           * ⚠Pages 파일 수는 **+1장**이다 — 시즌마다 만들었으면 +9장이었다.
           */
          { path: GLOSSARY_PATH, content: renderGlossaryPage(ctx) },
        ]
      : []),
    { path: at("today.html"), content: renderTodayPage(data.today, ctx) },
    { path: at("days.html"), content: renderDayIndexPage(data.dayIndex, ctx) },
    // ⚠기록이 없는 시즌에는 만들지 않는다 — 빈 화면을 두는 것보다 없는 편이 정직하다
    ...(data.postseason.competitions.length === 0
      ? []
      : [{ path: at("postseason.html"), content: renderPostseasonPage(data.postseason, ctx) }]),
    ...data.teams.map((t) => ({ path: at(teamPath(safeSegment(t.teamCode, "구단 코드"))), content: renderTeamPage(t, ctx) })),
    ...pastDays(data).map((d) => ({ path: at(`days/${safeSegment(d.date, "경기일")}.html`), content: renderDayPage(d, ctx) })),
    // ⚠**루트가 대시보드다**(2026-08-17). Cloudflare Pages 는 사이트 루트를 index.html 로 주므로,
    // 「홈 화면」이 되려면 이 자리여야 한다
    { path: at("index.html"), content: renderHomePage(data.home, ctx) },
    { path: at(ROSTER_PATH), content: renderIndexPage(data.index, ctx) },
    { path: at("ranking.html"), content: renderRankingPage(data.ranking, ctx) },
    /**
     * 球団一覧. ⚠**구단으로 가는 길이다** — 지금까지 구단 페이지는
     * 순위표에서 팀명을 눌러야만 닿았다. 경기가 없는 시즌에도 만든다 —
     * 화면이 「아직 순위를 못 매겼다」고 말하고(M12), 시즌 전환의 목적지가 끊기지 않는다.
     */
    { path: at(TEAMS_PATH), content: renderTeamsPage(data.teamsPage, ctx) },
    { path: at("starters.html"), content: renderStartersPage(data.starters, ctx) },
    /**
     * 날짜별 予告先発.
     * ⚠**앞뒤 링크의 대상이다** — 링크만 만들고 페이지를 안 만들면 빌드가 멈춘다.
     */
    ...data.starterDays
      .filter((d) => d.gameDate !== null)
      .map((d) => ({
        path: at(`starters/${safeSegment(d.gameDate!, "예고일")}.html`),
        content: renderStartersPage(d, ctx),
      })),
    {
      path: at("matchup.html"),
      content: renderMatchupPage(data.matchup, ctx),
    },
    {
      path: at("compare.html"),
      // ⚠**대전 화면과 같은 데이터를 쓴다**(M1) — 두 화면이 각자 만들면
      // 「같은 날인데 나오는 선수가 다르다」가 된다
      content: renderComparePage(
        {
          season: data.season,
          asOf: data.asOf,
          builtOn: data.matchup.builtOn,
          days: data.matchup.days,
        },
        ctx,
      ),
    },
    { path: at("players.json"), content: searchIndexJson(data.search) },
  ];

  if (log !== undefined) {
    files.push({ path: at("log.html"), content: renderLogPage(log, ctx) });
  }

  /** 比較 데이터. **선수마다가 아니라 ID 첫 글자로 묶는다**(`compareShardOf`) */
  const compareShards = new Map<string, Map<string, CompareCard>>();
  for (const p of data.players) {
    // ⚠**선수 ID는 외부에서 온 문자열이고, 여기서 파일 경로가 된다.**
    // `../`가 섞이면 출력 디렉터리 밖에 쓴다 — 조용히 정규화하지 말고 던진다.
    if (!/^[A-Za-z0-9_-]+$/.test(p.playerId)) {
      throw new Error(`선수 ID가 경로로 쓸 수 없는 형태다: ${JSON.stringify(p.playerId)}`);
    }
    files.push({ path: at(`players/${p.playerId}.html`), content: renderPlayerPage(p, ctx) });
    /**
     * ⚠**비교용 값을 따로 계산하지 않는다**(M1) — 위 페이지가 쓰는 것과 같은 객체에서 뽑는다.
     * ⚠**선수마다 파일을 만들지 않는다.** 예전엔 그렇게 했고, 그 결과 이 2.5KB짜리들이
     * 산출물 파일의 29%(4시즌 2,797개)를 차지해 Pages 배포 상한을 먹고 있었다.
     */
    const shard = compareShardOf(p.playerId);
    const bucket = compareShards.get(shard) ?? new Map<string, CompareCard>();
    bucket.set(p.playerId, compareCard(p));
    compareShards.set(shard, bucket);
  }

  // ⚠**빈 시즌이면 샤드도 0개다** — 「파일은 있는데 안이 비었다」를 만들지 않는다(M11)
  for (const [shard, cards] of compareShards) {
    files.push({ path: at(`compare/${shard}.json`), content: compareShardJson(cards) });
  }

  /**
   * 경기 상세 — **경기일 하나에 파일 하나**(2026-08-26 · 감사 P3 #41).
   *
   * ⚠**경기 ID가 파일 경로가 된다.** `2026/0814/s-db-17` 형태이므로 `/`를 그대로 두면
   * 디렉터리가 세 겹 파이는데, 그건 상대 경로 계산을 어렵게 만들 뿐이다 — 평평하게 편다.
   * 그리고 **외부에서 온 문자열이므로 형태를 검사한다**(선수 ID와 같은 이유).
   *
   * ⚠**날짜는 `g.gameDate` 다** — 파일도 링크도 같은 필드를 본다.
   *   한때 슬러그에서 유도했다가 되돌렸다: 유도는 npb.jp 의 ID 형식이 영원하다고 가정하고,
   *   형식이 다르면 **그리는 중에 던져** 그 화면이 통째로 안 나온다.
   * ⚠**그래도 갈릴 수 있다** — 링크 쪽이 다른 날짜를 넘기면 그렇다.
   *   막는 것은 **링크 검사**다(빌드가 앵커까지 포함해 전 링크를 확인하고 어긋나면 멈춘다).
   */
  const byDay = new Map<string, GamePageData[]>();
  for (const g of data.games) {
    const slug = gameSlug(g.gameId);
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
      throw new Error(`경기 ID가 경로로 쓸 수 없는 형태다: ${JSON.stringify(g.gameId)}`);
    }
    const day = g.gameDate;
    const bucket = byDay.get(day);
    if (bucket === undefined) byDay.set(day, [g]);
    else bucket.push(g);
  }
  for (const [day, games] of byDay) {
    files.push({
      path: at(gameDayPath(safeSegment(day, "경기일"))),
      content: renderGameDayPage(day, games, ctx),
    });
  }

  return {
    files,
    stale: isStale(f),
    // ⚠**신선도 판정과 같은 값을 보고한다.** 다른 값을 보고하면 「낡았다」와 「최신 경기일」이
    // 서로 다른 날을 가리키고, 로그를 읽는 사람이 그 차이를 설명할 수 없다
    latestGameDate: data.latestAnyGameDate ?? data.asOf,
    playerCount: data.players.length,
  };
}
