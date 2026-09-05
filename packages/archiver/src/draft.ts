/**
 * 드래프트 취득 — **연 1회 배치**.
 *
 * ⚠**일일 배치(`scripts/update.ts`)에 붙이지 않는다** — 그쪽은 날짜 창 기반이라 층이 다르다.
 *
 * ⚠**예의도 멱등도 기존 취득기와 같은 한 벌을 쓴다**(L1·L7·M5·M8) —
 * `PoliteFetcher`(간격 기본 3초 · 동시 1커넥션 · 조건부 요청 · 식별 UA)와 `archiveUrl`.
 * **여기서 `fetch` 를 직접 부르거나 revision 규칙을 새로 쓰지 않는다.**
 *
 * ⚠**받은 원문은 아카이브에 내부 보관한다**(L6). 화면에 나가는 것은 파생값이다.
 *
 * ⚠**슬러그를 하드코딩하지 마라**(A3). 2013 오릭스는 `bs` 이고 2024 는 `b` 다.
 * 실측은 **26개 연도 중 6개**뿐이라 나머지 20개는 「같다」가 아니라 **「안 쟀다」**이다.
 * 하드코딩하면 그 해 그 구단이 **에러 없이 통째로 빈다** — CLAUDE.md §2 의 2018 오릭스
 * 사고(`bs` 를 `b` 로 알고 적재해 148경기가 「모르는 팀 코드」로 실패)와 같은 자리다.
 *
 * ⚠**`cli-draft.ts` 와 나뉜 이유**: 이 파일은 **부를 수 있어야** 한다. 진입점에 top-level
 * `parseArgs` 가 있으면 시험이 import 하는 순간 그게 돌아 `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`
 * 로 죽는다(실측). `players.ts`↔`cli-players.ts` · `starters.ts`↔`cli-starters.ts` 와 같은 배치다.
 */
import { DraftIndexError, DraftParseError, parseDraftTeamSlugs, parseDraftYears } from "@bb-app/parser";
import type { DraftIndexObservation } from "@bb-app/parser";
import { archiveUrl } from "./archive.ts";
import type { ArchiveDeps, PageResult } from "./archive.ts";

/** 아카이브 키 접두. `cli-stats.ts` 의 `npb/stats/...` 와 같은 층이다 */
const KEY_ROOT = "npb/draft";

/**
 * ⚠**호스트는 `draft.npb.jp` 다 — `npb.jp` 가 아니다.**
 *
 * 실측(`docs/sources/2026-09-04-draft-source-survey.md` §1):
 *   `https://npb.jp/draft/` → **302** → `http://draft.npb.jp/draft/` → **301** → `https://draft.npb.jp/draft/`
 *
 * `npb.jp` 로 치면 **1장마다 3요청**이 되고, 같은 문서 §9-A 가 적듯 **「리다이렉트 홉은
 * 간격 밖이다」** — 즉 L1(1req/3~5초)이 안 걸리는 요청이 2/3 이 된다. 게다가 가운데 홉이
 * 평문 `http` 라 식별 UA 가 그대로 나간다. **별도 서브도메인이고 CDN 뒤에 있다.**
 * ⚠**페이지 안의 `og:url` 은 `npb.jp` 라고 적혀 있다** — 그건 페이지가 스스로 쓴 문자열이지
 * 서버가 어디서 답하는지가 아니다. **근거로 쓰지 마라.**
 */
const URL_ROOT = "https://draft.npb.jp/draft";

/** 연도 색인 — 이 한 장이 어느 해가 있는지 말한다 */
export const BACKNUMBER_KEY = `${KEY_ROOT}/backnumber`;
export const BACKNUMBER_URL = `${URL_ROOT}/backnumber.html`;

export function yearIndexKey(year: number): string {
  return `${KEY_ROOT}/${year}/index`;
}

/** ⚠**끝 슬래시가 있다** — 디렉터리 색인이라 빼면 리다이렉트가 한 홉 더 붙는다 */
export function yearIndexUrl(year: number): string {
  return `${URL_ROOT}/${year}/`;
}

export function teamPageKey(year: number, slug: string): string {
  return `${KEY_ROOT}/${year}/${slug}`;
}

export function teamPageUrl(year: number, slug: string): string {
  return `${URL_ROOT}/${year}/draftlist_${slug}.html`;
}

export interface DraftTarget {
  readonly key: string;
  readonly url: string;
}

/**
 * 받을 구단 페이지 목록.
 *
 * ⚠**슬러그는 연도마다 다르다** — 그래서 `slugsByYear` 를 받는다. 호출자가
 * `parseDraftTeamSlugs` 로 **그 해 연도 톱에서** 뽑아 넣는다.
 */
export function draftTargets(input: {
  readonly years: readonly number[];
  readonly slugsByYear: ReadonlyMap<number, readonly string[]>;
}): DraftTarget[] {
  const out: DraftTarget[] = [];
  for (const year of [...input.years].sort((a, b) => a - b)) {
    for (const slug of [...(input.slugsByYear.get(year) ?? [])].sort()) {
      out.push({ key: teamPageKey(year, slug), url: teamPageUrl(year, slug) });
    }
  }
  return out;
}

/**
 * 그 해의 슬러그를 **못 얻은 이유**. ⚠**판정이 아니라 관측이다.**
 *
 * ⚠**다섯 갈래를 뭉치지 마라** — 뭉치는 순간 「아직 안 열렸다」와 「무너졌다」가 같은 줄이 되고,
 * 소급 연도의 붕괴가 조용히 넘어간다. 갈래마다 해야 할 일이 다르다:
 *   · `absent`  그 해 페이지가 **없다**(404). 실패가 아니다(M11)
 *   · `failed`  **못 받았다**(재시도 소진 등). FAIL — 다시 돌리면 회복될 수 있다
 *   · `index`   페이지는 받았는데 **슬러그가 0건**. `observed` 가 두 갈래를 가른다
 *   · `parse`   페이지는 받았는데 **어휘가 깨졌다**(M7). 사람이 봐야 한다
 *   · `error`   **우리가 예상하지 못한 것**. ERROR — 「돌지도 않음」이라 FAIL 과 따로 센다
 */
export type DraftYearSkip =
  | { readonly kind: "absent"; readonly status: number }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "index"; readonly observed: DraftIndexObservation; readonly error: string }
  | { readonly kind: "parse"; readonly error: string }
  | { readonly kind: "error"; readonly error: string };

export interface DraftYearSkipped {
  readonly year: number;
  readonly skip: DraftYearSkip;
}

export interface DraftCollectResult {
  /** ⚠**색인이 나열하는 그대로** — 여기서 범위를 자르지 않는다(A4). 분모다 */
  readonly yearsListed: readonly number[];
  /** 그중 우리가 받기로 한 것. `yearsListed` 와의 차가 「우리가 안 받기로 한 해」다 */
  readonly yearsAttempted: readonly number[];
  /** 슬러그를 얻은 해 */
  readonly slugsByYear: ReadonlyMap<number, readonly string[]>;
  /** 슬러그를 못 얻은 해. ⚠**버리지 않고 관측을 그대로 남긴다**(A1) */
  readonly skipped: readonly DraftYearSkipped[];
  /**
   * ⚠**옛 사본으로 진행한 것** — 취득은 실패했는데 아카이브에 이전 성공분이 있었다(L7).
   *
   * ⚠**실패가 `pages` 에 남는 것만으로는 부족하다.** 로그에는 「실패 1」만 찍히고 뒤따르는
   * 구단 페이지는 `stored`/`unchanged` 로 **정상처럼 보인다** — 그 구단 목록이 **낡은 슬러그
   * 집합**에서 나왔다는 신호가 없으면 **어느 해가 그렇게 받아졌는지 사후에 알 수 없다.**
   * ⚠**「빠뜨렸다」가 아니라 「덜 받았을 수 있다」**이다: 그해 구단이 늘었으면 그 구단이 통째로 빈다.
   */
  readonly stale: {
    /** 연도 색인이 옛 사본이다 → **어느 해가 있는지 자체가 낡았다** */
    readonly index: boolean;
    /** 이 해의 슬러그가 옛 사본에서 나왔다 → **구단이 빠져 있을 수 있다** */
    readonly years: readonly number[];
  };
  /** 받은 페이지 **전건**. 분모이자 `summarize` 의 입력이다 */
  readonly pages: readonly PageResult[];
}

/**
 * 연도 색인을 못 읽었다 — **여기서 멈춘다.**
 *
 * ⚠**빈 결과로 위장하지 않는다.** 무엇을 받을지 모르는 채 「0건 성공」으로 끝내면
 * 그날 드래프트가 통째로 안 들어온 것을 아무도 모른다(M7).
 */
export class DraftCollectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftCollectError";
  }
}

export interface DraftCollectOptions {
  readonly from: number;
  readonly to: number;
  /** 범위 안에서 한 해만. ⚠**범위 밖이면 호출자가 먼저 걸러라** — 조용한 0건이 된다 */
  readonly only?: number | undefined;
}

/**
 * 아카이브에 보존된 바이트를 문자열로.
 *
 * ⚠**`readBody` 는 이미 gunzip 해서 준다** — 여기서 또 풀면 `incorrect header check` 다(실측).
 * ⚠**`Uint8Array#toString("utf8")` 을 쓰지 마라** — `Buffer` 가 아니라서 인자를 무시하고
 * **`"60,104,116,..."`** 를 돌려준다(실측). 던지지도 않아서 파서가 `no-draft-marker` 로
 * 오진하고 **드래프트가 조용히 0건이 된다.** `archive.ts` 와 같은 `TextDecoder` 를 쓴다.
 */
function decodeArchived(body: Uint8Array): string {
  return new TextDecoder("utf-8").decode(body);
}

/**
 * 한 장을 받고 **아카이브에 보존된 본문**을 함께 돌려준다.
 *
 * ⚠**본문은 응답이 아니라 아카이브에서 읽는다.** `archiveUrl` 은 내용이 같으면 `unchanged` 로
 * 본문을 안 쓰기 때문이다(M5) — 그때 답이 되는 것은 **직전에 보존해 둔 것**이고, 그게
 * 캐시 우선(L7)의 뜻이다. 그래서 「받기 실패 + 옛 사본 있음」이면 **옛 사본으로 진행하되
 * 실패는 `pages` 에 그대로 남는다** — 조용히 성공이 되지 않는다.
 */
async function fetchAndRead(
  key: string,
  url: string,
  deps: ArchiveDeps,
): Promise<{ result: PageResult; html: string | null }> {
  const result = await archiveUrl(key, url, deps);
  const body = await deps.sink.readBody(key);
  return { result, html: body === null ? null : decodeArchived(body) };
}

/** 본문이 없을 때 그 이유를 관측 그대로 옮긴다. ⚠**「없다」와 「못 받았다」를 안 섞는다**(M11) */
function skipFromResult(result: PageResult): DraftYearSkip {
  if (result.outcome === "absent") return { kind: "absent", status: result.status ?? 404 };
  if (result.outcome === "failed") return { kind: "failed", error: result.error ?? "이유 미상" };
  // stored/unchanged 인데 본문이 없다 = 우리가 예상하지 못한 상태다. 삼키지 않는다.
  return { kind: "error", error: `${result.outcome} 인데 아카이브에 본문이 없다` };
}

/**
 * 드래프트를 **2단계로 발견**해서 받는다.
 *
 *   1. 연도 색인(`backnumber.html`) → 그 사이트가 가진 해 전부
 *   2. 연도 톱(`/draft/{YYYY}/`)   → **그 해의** 구단 슬러그
 *   3. 구단 페이지                  → 선택선수 일람
 *
 * ⚠**1단계가 실패하면 던진다**(`DraftCollectError`). 나머지는 연도별로 격리해서
 * **한 해가 무너져도 다른 해를 계속 받는다** — `archiveDates` 와 같은 방침이다
 * (「5시간짜리 백필이 3일차에서 멈추면 앞의 이틀도 헛수고다」).
 */
export async function collectDraft(
  opts: DraftCollectOptions,
  deps: ArchiveDeps,
  onPage?: (r: PageResult) => void,
): Promise<DraftCollectResult> {
  const pages: PageResult[] = [];
  const record = (r: PageResult): PageResult => {
    pages.push(r);
    onPage?.(r);
    return r;
  };

  // ── 1단계: 연도 색인 ──────────────────────────────────────────────────
  const index = await fetchAndRead(BACKNUMBER_KEY, BACKNUMBER_URL, deps);
  record(index.result);
  if (index.html === null) {
    throw new DraftCollectError(
      `연도 색인을 못 읽었다(${index.result.outcome}) — 무엇을 받을지 모르므로 여기서 멈춘다: ${BACKNUMBER_URL}`,
    );
  }

  // ⚠**받기는 실패했는데 옛 사본이 있다** — 그걸로 진행하되(L7) **낡았다고 표시한다.**
  //   표시하지 않으면 뒤따르는 전부가 정상처럼 보인다.
  const staleIndex = index.result.outcome === "failed";
  const staleYears: number[] = [];

  // ⚠**`parseDraftYears` 가 던지면 그대로 올린다**(M7) — 빈 배열로 흘리면 그 해부터
  //   영영 안 들어오고, 로그에는 「0건 성공」만 남는다.
  const yearsListed = parseDraftYears(index.html);

  // ⚠**범위를 자르는 것은 호출자다**(A4). 색인은 사이트가 나열하는 그대로를 냈고,
  //   「소스가 무엇을 갖고 있는가」와 「우리가 무엇을 받는가」는 다른 층이다 —
  //   섞으면 소스가 줄어든 것과 우리가 안 받기로 한 것을 구별할 수 없게 된다.
  const yearsAttempted = yearsListed.filter(
    (y) => y >= opts.from && y <= opts.to && (opts.only === undefined || y === opts.only),
  );

  // ── 2단계: 연도 톱 → 그 해의 구단 슬러그 ────────────────────────────────
  const slugsByYear = new Map<number, readonly string[]>();
  const skipped: DraftYearSkipped[] = [];

  for (const year of yearsAttempted) {
    const top = await fetchAndRead(yearIndexKey(year), yearIndexUrl(year), deps);
    record(top.result);

    if (top.html === null) {
      skipped.push({ year, skip: skipFromResult(top.result) });
      continue;
    }
    // ⚠**옛 사본으로 발견을 계속한다**(L7) — 다만 이 해는 낡은 슬러그 집합에서 나왔다.
    if (top.result.outcome === "failed") staleYears.push(year);

    try {
      slugsByYear.set(year, parseDraftTeamSlugs(top.html));
    } catch (err) {
      // ⚠**A1 — 0건 예외를 「아직」으로 삼키지 마라.** 관측(`observed`)을 그대로 적어 남긴다.
      // ⚠**파서는 「개최 전인가 붕괴인가」를 판정할 수 없다**(시계를 안 읽는다 · M6).
      //   그 판정은 **이 CLI 도 못 한다** — 여기 몫은 관측을 그대로 남기는 것까지다.
      //   ⚠**과거 연도에서 `no-team-links` 가 나오면 그건 개최 전이 아니라 붕괴다.**
      if (err instanceof DraftIndexError) {
        skipped.push({ year, skip: { kind: "index", observed: err.observed, error: err.message } });
      } else if (err instanceof DraftParseError) {
        skipped.push({ year, skip: { kind: "parse", error: `${err.name}: ${err.message}` } });
      } else {
        skipped.push({ year, skip: { kind: "error", error: err instanceof Error ? err.message : String(err) } });
      }
    }
  }

  // ── 3단계: 구단 페이지 ──────────────────────────────────────────────────
  for (const t of draftTargets({ years: [...slugsByYear.keys()], slugsByYear })) {
    record(await archiveUrl(t.key, t.url, deps));
  }

  return {
    yearsListed,
    yearsAttempted,
    slugsByYear,
    skipped,
    stale: { index: staleIndex, years: staleYears },
    pages,
  };
}

/**
 * 건너뛴 해를 **FAIL 과 ERROR 로 갈라서** 센다(작업규칙 8).
 *
 * ⚠**`absent` 는 어느 쪽도 아니다** — 그 해 페이지가 없는 것은 사실이지 결함이 아니다(M11).
 * ⚠**`index` 도 어느 쪽도 아니다** — 개최 전일 수 있고 붕괴일 수도 있어서, **세는 것이 아니라
 * 사람이 봐야 하는 것**이다. 그래서 따로 낸다.
 */
export function countSkips(skipped: readonly DraftYearSkipped[]): {
  absent: number;
  failed: number;
  index: number;
  parse: number;
  error: number;
  total: number;
} {
  const acc = { absent: 0, failed: 0, index: 0, parse: 0, error: 0, total: skipped.length };
  for (const s of skipped) acc[s.skip.kind] += 1;
  return acc;
}
