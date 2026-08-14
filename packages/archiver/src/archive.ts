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
  /** 월간 일정 캐시. 없으면 호출마다 새로 받는다 — 기간 백필에서는 반드시 넘겨라 */
  schedule?: MonthlyScheduleCache;
}

/**
 * 월간 일정 페이지를 **1회만** 받는다.
 *
 * ⚠이게 없으면 기간 백필에서 같은 페이지를 날짜 수만큼 다시 받는다.
 * 167일치를 돌리면 167번이다 — 낭비이자 L1(예의) 위반이다.
 * 캐시는 프로세스 수명과 같다. 시즌 중 일정이 갱신되므로 영속화하지 않는다.
 */
export class MonthlyScheduleCache {
  private readonly byMonth = new Map<string, Promise<GameRef[]>>();
  /** 실제 네트워크 취득이 일어난 횟수 — 테스트가 이걸 본다 */
  fetchCount = 0;

  async get(season: number, month: number, deps: ArchiveDeps): Promise<GameRef[]> {
    const key = `${season}-${month}`;
    const hit = this.byMonth.get(key);
    if (hit) return hit;

    const pending = this.load(season, month, deps);
    this.byMonth.set(key, pending);
    // ⚠실패를 캐시에 남기지 않는다. 남기면 일과성 오류 1회로 **그 달의 남은 날짜가 전부**
    // 같은 실패를 되풀이한다 — 긴 백필에서 하루치 오류가 한 달치 손실이 된다.
    void pending.catch(() => {
      if (this.byMonth.get(key) === pending) this.byMonth.delete(key);
    });
    return pending;
  }

  private async load(season: number, month: number, deps: ArchiveDeps): Promise<GameRef[]> {
    this.fetchCount += 1;
    const url = monthlyScheduleUrl(season, month);
    const res = await deps.fetcher.get(url);
    if (res.body === null) throw new Error(`월간 일정을 받지 못했다 (HTTP ${res.status}): ${url}`);

    // 발견의 출처도 보존한다 (M4: 이 경기 목록이 어디서 나왔는가).
    const key = `npb/games/${season}/schedule_${String(month).padStart(2, "0")}`;
    const digest = sha256(res.body);
    const prev = await deps.sink.readMeta(key);
    if (!prev || prev.sha256 !== digest) {
      await deps.sink.write(key, res.body, {
        url,
        fetchedAt: deps.clock.now().toISOString(),
        lastModified: res.lastModified,
        etag: res.etag,
        status: res.status,
        sha256: digest,
        byteLength: res.body.byteLength,
        revision: (prev?.revision ?? 0) + 1,
      });
    }

    return discoverGames(new TextDecoder("utf-8").decode(res.body), url);
  }
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

  const schedule = deps.schedule ?? new MonthlyScheduleCache();
  const all = await schedule.get(season, month, deps);
  const games = gamesOn(all, date);

  const pages: PageResult[] = [];
  for (const g of games) {
    pages.push(...(await archiveGame(g, deps)));
  }
  return { date, gamesFound: games.length, pages };
}

/**
 * 여러 경기일을 보존한다. 월간 일정은 달마다 1회만 받는다.
 *
 * 하루가 통째로 실패해도(ERROR) 나머지 날짜는 계속 진행한다 —
 * 5시간짜리 백필이 3일차에서 멈추면 앞의 이틀도 헛수고가 된다.
 */
export async function archiveDates(
  dates: readonly string[],
  deps: ArchiveDeps,
  onDay?: (day: DayResult | DayError) => void,
): Promise<(DayResult | DayError)[]> {
  const schedule = deps.schedule ?? new MonthlyScheduleCache();
  const withCache: ArchiveDeps = { ...deps, schedule };
  const out: (DayResult | DayError)[] = [];

  for (const date of dates) {
    let entry: DayResult | DayError;
    try {
      entry = await archiveDate(date, withCache);
    } catch (err) {
      entry = { date, error: err instanceof Error ? err.message : String(err) };
    }
    out.push(entry);
    onDay?.(entry);
  }
  return out;
}

/** 날짜 단위 실패 — 페이지 단위 실패(FAIL)와 구별해서 센다(작업규칙 8). */
export interface DayError {
  date: string;
  error: string;
}

export function isDayError(x: DayResult | DayError): x is DayError {
  return "error" in x;
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
