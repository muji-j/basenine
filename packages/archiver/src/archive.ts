/**
 * 아카이브 오케스트레이션.
 *
 * 원칙:
 *   - **멱등**(M5): 같은 날을 두 번 돌려도 내용이 같으면 쓰기가 일어나지 않는다.
 *   - **결과를 4분류**(M11·M12): stored / unchanged / absent / failed.
 *     「저장 안 함」의 이유를 뭉개면 나중에 버그와 정상을 구별할 수 없다.
 *   - **부분 실패를 삼키지 않는다**: 실패한 페이지는 결과에 남고, 재실행하면 그것만 다시 받는다.
 */
import type { Clock } from "./clock.ts";
import { GAME_PAGES, discoverGames, gamesOn, monthlyScheduleUrl, pageKey, pageUrl } from "./discover.ts";
import type { GamePage, GameRef } from "./discover.ts";
import type { PoliteFetcher } from "./fetcher.ts";
import type { BlobMeta, Sink } from "./sink.ts";
import { sha256 } from "./sink.ts";

export type PageOutcome = "stored" | "unchanged" | "absent" | "failed";

export interface PageResult {
  key: string;
  url: string;
  outcome: PageOutcome;
  status: number | null;
  /** 실패했을 때만 채워진다 */
  error: string | null;
}

export interface DayResult {
  date: string;
  gamesFound: number;
  pages: PageResult[];
}

export interface ArchiveDeps {
  fetcher: PoliteFetcher;
  sink: Sink;
  clock: Clock;
}

/** 하위 페이지 1장을 보존한다. */
export async function archivePage(ref: GameRef, page: GamePage, deps: ArchiveDeps): Promise<PageResult> {
  const key = pageKey(ref, page);
  const url = pageUrl(ref, page);
  const prev = await deps.sink.readMeta(key);

  try {
    const res = await deps.fetcher.get(url, prev ?? undefined);

    if (res.status === 304) {
      return { key, url, outcome: "unchanged", status: 304, error: null };
    }
    if (res.status === 404 || res.status === 410) {
      // 사실이다 — 이 경기에 이 페이지는 존재하지 않는다. 실패가 아니다.
      return { key, url, outcome: "absent", status: res.status, error: null };
    }
    if (res.body === null) {
      return { key, url, outcome: "failed", status: res.status, error: `본문 없는 ${res.status} 응답` };
    }

    const digest = sha256(res.body);
    if (prev && prev.sha256 === digest) {
      // 서버가 조건부 요청을 지원하지 않아 200을 줬지만 내용은 같다 → 쓰지 않는다(멱등).
      return { key, url, outcome: "unchanged", status: res.status, error: null };
    }

    const meta: BlobMeta = {
      url,
      fetchedAt: deps.clock.now().toISOString(),
      lastModified: res.lastModified,
      etag: res.etag,
      status: res.status,
      sha256: digest,
      byteLength: res.body.byteLength,
      revision: (prev?.revision ?? 0) + 1,
    };
    await deps.sink.write(key, res.body, meta);
    return { key, url, outcome: "stored", status: res.status, error: null };
  } catch (err) {
    return { key, url, outcome: "failed", status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 경기 1건의 전 하위 페이지를 보존한다. */
export async function archiveGame(ref: GameRef, deps: ArchiveDeps): Promise<PageResult[]> {
  const out: PageResult[] = [];
  for (const page of GAME_PAGES) {
    out.push(await archivePage(ref, page, deps));
  }
  return out;
}

/**
 * 지정한 경기일(JST `YYYY-MM-DD`)의 전 경기를 보존한다.
 *
 * ⚠월간 일정 페이지에서 링크를 하나도 못 찾으면 `discoverGames`가 예외를 던진다(M7).
 * 여기서 잡아서 빈 결과로 만들지 마라 — 호출자가 실패를 알아야 한다.
 * 반면 「그날 경기가 0건」(월요일·우천 등)은 정상이며 `gamesFound: 0`으로 표현된다.
 */
export async function archiveDate(date: string, deps: ArchiveDeps): Promise<DayResult> {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parsed) throw new RangeError(`경기일은 YYYY-MM-DD 형식이어야 한다: ${date}`);
  const season = Number(parsed[1]);
  const month = Number(parsed[2]);

  const scheduleUrl = monthlyScheduleUrl(season, month);
  const res = await deps.fetcher.get(scheduleUrl);
  if (res.body === null) {
    throw new Error(`월간 일정을 받지 못했다 (HTTP ${res.status}): ${scheduleUrl}`);
  }

  const all = discoverGames(new TextDecoder("utf-8").decode(res.body), scheduleUrl);
  const games = gamesOn(all, date);

  const pages: PageResult[] = [];
  for (const g of games) {
    pages.push(...(await archiveGame(g, deps)));
  }
  return { date, gamesFound: games.length, pages };
}

/** 결과 집계 — 분모를 함께 보고하기 위한 것(CLAUDE.md 작업규칙 7). */
export function summarize(pages: readonly PageResult[]): Record<PageOutcome | "total", number> {
  const acc: Record<PageOutcome | "total", number> = {
    stored: 0,
    unchanged: 0,
    absent: 0,
    failed: 0,
    total: pages.length,
  };
  for (const p of pages) acc[p.outcome] += 1;
  return acc;
}
