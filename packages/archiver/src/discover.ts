/**
 * npb.jp 월간 일정 페이지에서 경기 페이지 링크를 발견한다.
 *
 * ⚠**이것이 이 패키지의 유일한 파싱이다.** 그리고 M7이 적용되는 지점이다 —
 * 구조가 바뀌어 링크를 하나도 못 찾으면 **빈 배열이 아니라 예외**를 던진다.
 * 조용한 0건은 「그날 경기가 없었다」로 오독되어 영구히 빈 아카이브를 남긴다.
 */

import { parseScheduleVenues } from "@bb-app/parser";

/** 발견된 경기 1건. */
export interface GameRef {
  /** 시즌(서기 연도) */
  season: number;
  /** 경기일 `YYYY-MM-DD` (JST) */
  date: string;
  /** `s-db-17` 형태의 경기 슬러그 (원정-홈-경기번호) */
  slug: string;
  /** npb.jp 기준 절대 경로 `/scores/2026/0814/s-db-17/` */
  path: string;
  /**
   * 구장 원문 표기(`京セラD大阪`). 못 찾으면 null.
   *
   * ⚠**홈팀으로 대리하면 안 된다.** 같은 팀의 홈경기가 여러 구장에서 열린다(지방개최).
   * ⚠**경기 페이지에서 뽑지 마라.** 경기 페이지에는 **다른 경기들의 스코어 박스**가 함께 있어
   * 남의 구장을 집어 온다(실측 2026-08-15: 8/14 페이지에서 8/15 경기의 구장이 먼저 잡혔다).
   * 일정 페이지의 `place` 칸이 유일하게 그 경기의 것이다.
   */
  venue: string | null;
}

export class NoGamesFoundError extends Error {
  readonly sourceUrl: string;
  readonly htmlLength: number;
  constructor(sourceUrl: string, htmlLength: number) {
    super(
      `경기 링크를 1건도 찾지 못했다: ${sourceUrl} (본문 ${htmlLength}바이트). ` +
        `페이지 구조 변경을 의심하라 — 조용히 0건으로 넘기지 않는다.`,
    );
    this.name = "NoGamesFoundError";
    this.sourceUrl = sourceUrl;
    this.htmlLength = htmlLength;
  }
}

const GAME_HREF = /\/scores\/(\d{4})\/(\d{2})(\d{2})\/([a-z0-9]+(?:-[a-z0-9]+)+)\//g;



/**
 * 월간 일정 HTML에서 경기 참조를 추출한다.
 *
 * @throws {NoGamesFoundError} 링크가 0건일 때. 호출자가 삼키지 마라.
 */
export function discoverGames(html: string, sourceUrl: string): GameRef[] {
  // ⚠구장 추출은 parser 한 벌만 쓴다(M1) — 수집기와 적재기가 다른 값을 내면 안 된다
  const venues = parseScheduleVenues(html);
  const seen = new Set<string>();
  const out: GameRef[] = [];

  for (const m of html.matchAll(GAME_HREF)) {
    const [, yyyy, mm, dd, slug] = m;
    if (!yyyy || !mm || !dd || !slug) continue;
    const path = `/scores/${yyyy}/${mm}${dd}/${slug}/`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      season: Number(yyyy),
      date: `${yyyy}-${mm}-${dd}`,
      slug,
      path,
      venue: venues.get(path) ?? null,
    });
  }

  if (out.length === 0) throw new NoGamesFoundError(sourceUrl, html.length);
  return out;
}

/** 특정 경기일만 남긴다. 더블헤더가 있으면 같은 날짜에 복수 건이 남는다. */
export function gamesOn(games: readonly GameRef[], date: string): GameRef[] {
  return games.filter((g) => g.date === date);
}

/** 월간 일정 페이지 URL. `month`는 1~12. */
export function monthlyScheduleUrl(season: number, month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month는 1~12여야 한다: ${month}`);
  }
  return `https://npb.jp/games/${season}/schedule_${String(month).padStart(2, "0")}_detail.html`;
}

/**
 * 경기 1건에서 보존할 하위 페이지.
 * 빈 문자열은 경기 요약(랜딩) 페이지.
 */
export const GAME_PAGES = ["", "playbyplay.html", "box.html", "roster.html"] as const;
export type GamePage = (typeof GAME_PAGES)[number];

/** 하위 페이지의 저장 키. 빈 문자열은 `index`로 정규화한다. */
export function pageKey(ref: GameRef, page: GamePage): string {
  const leaf = page === "" ? "index" : page.replace(/\.html$/, "");
  const mmdd = ref.date.slice(5).replace("-", "");
  return `npb/scores/${ref.season}/${mmdd}/${ref.slug}/${leaf}`;
}

export function pageUrl(ref: GameRef, page: GamePage): string {
  return `https://npb.jp${ref.path}${page}`;
}
