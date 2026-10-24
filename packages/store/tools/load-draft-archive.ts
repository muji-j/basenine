/**
 * 드래프트 적재 — 아카이브(`npb/draft/{year}/{slug}.html.gz`) → DB.
 *
 *   node packages/store/tools/load-draft-archive.ts data/archive data/bb.sqlite [--from 2005] [--to 2026] [--only 2019]
 *
 * ⚠**`load-archive.ts` 에 붙이지 않았다** — 그것은 경기 아카이브를 날짜별로 순회하는
 * 도구이고, 드래프트는 경로 구조도 주기(연 1회)도 다르다.
 *
 * ⚠**시즌 단위로 모은다.** 구단 하나만 보면 「소스가 경합을 안 쓴다」와
 * 「이 구단은 안 겹쳤다」를 구별할 수 없다(A2) — **2019 히로시마도 `※` 0건이다**(픽스처 실측).
 *
 * ⚠**아카이브 키를 여기에 적지 않는다**(M1). `npb/draft/{year}/{slug}` 는 수집기가 소유하고
 * (`@bb-app/archiver`), 여기서는 `yearIndexKey`·`teamPageKey` 를 **가져다 쓴다.** 두 벌로 두면
 * 수집기가 키를 바꾼 날 적재만 옛 경로를 보고 **조용히 0건**이 된다.
 * ⚠**순환 의존이 아니다**(실측): `archiver` 는 `parser` 만 참조하고 `store` 를 참조하지 않는다.
 * `load-starters.ts` 가 이미 같은 방향으로 `STARTERS_URL` 을 가져다 쓴다.
 *
 * ⚠**출처는 전부 사이드카(`{slug}.meta.json`)에서 온다**(M4) — URL 도, 시각도, 판도.
 * 브리프 초판은 URL 을 `https://draft.npb.jp/draft/${season}/...` 로 **다시 지었는데**,
 * 그러면 ⑴ URL 규칙이 세 벌이 되고 ⑵ 실제로 어디서 받았는지가 아니라 **우리가 그랬을 것이라고
 * 믿는 것**을 적게 된다. 사이드카의 `url` 은 **실제로 친 주소**다.
 *
 * ⚠**`fetchedAt` 규칙을 새로 쓰지 않는다**(M1). `checkedAt`(마지막으로 본 시각)이 먼저이고
 * 없으면 `fetchedAt` 으로 떨어진다 — 그 규칙은 `src/meta.ts` 의 `fetchedAtOf` 한 벌이 소유한다.
 * ⚠그래서 사이드카를 **두 번 읽는다**(여기서 `url`·`sha256` 을, `fetchedAtOf` 가 시각을).
 * 연 12장짜리 파일이라 값싸고, 규칙을 두 벌로 만드는 것보다 훨씬 싸다.
 *
 * ⚠⚠**「몇 번째 판」은 `sha256`(본문 해시)이지 사이드카의 `revision` 이 아니다.**
 * 019 마이그레이션이 그렇게 정의한다 — 「npb.jp 는 `ETag`·`Last-Modified` 를 주지 않으므로
 * `revision` 은 **본문 해시**다」. 사이드카의 `revision` 은 **우리 아카이브 안의 카운터**라
 * 아카이브를 다시 만들면 1 로 돌아가고, 서로 다른 페이지가 전부 `"1"` 이 되어
 * **판을 구별하지 못한다.** 해시는 내용이 바뀔 때만, 그리고 반드시 바뀐다.
 * ⚠**브리프 초판은 `typeof meta.revision !== "string"` 으로 걸렀는데 그 값은 숫자라
 * 언제나 던졌을 것이다**(실측: `BlobMeta.revision: number`).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { BACKNUMBER_KEY, draftWikiKey, teamPageKey, toJstDateString, yearIndexKey } from "@bb-app/archiver";
import {
  DraftParseError,
  DraftWikiParseError,
  checkDraftWikiInvariants,
  draftHeldOnFirst,
  normalizePlayerName,
  parseDraftBids,
  parseDraftHeldOn,
  parseDraftPicks,
  parseDraftWiki,
} from "@bb-app/parser";
import type { DraftBidRow, DraftHeldOn, DraftKind, DraftPickRow, DraftWikiParse } from "@bb-app/parser";
import { openDb } from "../src/db.ts";
import type { Db } from "../src/db.ts";
import { DraftLoadError, draftPicksIn, eventHeldOnFor, loadDraft } from "../src/draft.ts";
import type { DraftEventHeldOn, DraftEventSource, DraftProvenance } from "../src/draft.ts";
import {
  DraftWikiLoadError,
  compareDraftWikiBids,
  compareDraftWikiPicks,
  countBySeverity,
  isLotteryKind,
  loadDraftWiki,
  npbBidsBySeason,
  npbNamesBySeason,
  npbPicksBySeason,
  resolveDraftWikiColumns,
} from "../src/draft-wiki.ts";
import type { BidFact, DraftWikiDiff } from "../src/draft-wiki.ts";
import { fetchedAtOf } from "../src/meta.ts";

/** `LocalSink` 의 배치. **키**는 수집기가 소유하고 이 두 꼬리만 여기서 안다 */
const BODY_EXT = ".html.gz";
const META_EXT = ".meta.json";

const bodyPath = (root: string, key: string): string => join(root, `${key}${BODY_EXT}`);
const metaPath = (root: string, key: string): string => join(root, `${key}${META_EXT}`);

// ──────────────────────────────────────────────────────────────────────────
// 경합 판정 — 시즌 단위
// ──────────────────────────────────────────────────────────────────────────

export interface TeamPage {
  readonly team: string;
  readonly picks: DraftPickRow[];
  readonly bids: DraftBidRow[];
}

/**
 * 아카이브에서 읽은 한 구단 페이지 + **그 판의 출처**(M4).
 *
 * ⚠**세 값이 전부 사이드카에서 온다** — 적재 시각도, 템플릿으로 지은 URL 도 아니다.
 */
export interface TeamPageWithMeta extends TeamPage, DraftProvenance {}

export interface BidsDecision {
  /** 이 시즌 소스가 경합을 **적기는 하는가**. 한 구단이라도 적었으면 true */
  readonly sourceWritesBids: boolean;
  /**
   * 그 구단에 넘길 `bids` 값.
   *
   * ⚠**`null` 과 `[]` 는 다른 말이다**(M11):
   *   `null` = 「이 시즌 소스는 경합을 아예 안 쓴다」 → 단독지명을 **유도하지 않는다**
   *   `[]`   = 「소스가 말했고, 이 구단은 아무와도 안 겹쳤다」 → 유도한다
   *
   * @throws {Error} 이 시즌에 없던 구단을 물었을 때. ⚠**조용히 `[]` 를 주면 안 된다** —
   *   그 구단에 단독지명이 유도되고, 그건 **일어난 적 없는 사실**이다.
   */
  forTeam(team: string): DraftBidRow[] | null;
}

/**
 * ⚠**G2 를 여기서 지킨다.** 「0건인데 `null` 판정을 안 했다」가 **구조적으로 불가능**하다 —
 * 판정이 자동으로 따라오므로 호출자가 잊을 수 없다.
 */
export function decideBids(pages: readonly TeamPage[]): BidsDecision {
  if (pages.length === 0) {
    // ⚠「안 쟀음」과 「0건」을 구별한다(M11). 구단이 0장이면 판정할 대상이 없다.
    throw new Error("구단 페이지가 0장이다 — 판정할 수 없다");
  }
  const writes = pages.some((p) => p.bids.length > 0);
  const byTeam = new Map(pages.map((p) => [p.team, p.bids]));
  return {
    sourceWritesBids: writes,
    forTeam(team: string): DraftBidRow[] | null {
      const own = byTeam.get(team);
      if (own === undefined) {
        throw new Error(`이 시즌에 없는 구단이다: ${team} — 판정한 구단=${[...byTeam.keys()].join(",")}`);
      }
      return writes ? own : null;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 아카이브 읽기
// ──────────────────────────────────────────────────────────────────────────

/**
 * 아카이브를 못 읽었다. ⚠**두 갈래를 뭉치지 마라** — 해야 할 일이 다르다:
 *   · `absent`     그 해를 **안 받았다**. 결함이 아니다(M11)
 *   · `provenance` 본문은 있는데 **출처를 말할 수 없다**(M4). 다시 받으면 풀린다
 */
export class DraftArchiveError extends Error {
  readonly kind: "absent" | "provenance";
  readonly detail: string;
  constructor(kind: "absent" | "provenance", message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "DraftArchiveError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * 사이드카가 말하는 **어디서 · 언제 · 몇 번째 판**(M4).
 *
 * ⚠**하나라도 없으면 던진다. 넣지 않는다.** 출처를 못 대는 행은 「버그인가 정정인가」에
 * 영영 답할 수 없고, 그 행이 화면에 나가면 우리는 그것을 **되짚을 방법이 없다.**
 */
async function provenanceOf(root: string, key: string, label: string): Promise<DraftProvenance> {
  const p = metaPath(root, key);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch {
    throw new DraftArchiveError("provenance", `${label}: 사이드카(${META_EXT})가 없다 — 출처를 말할 수 없다`, p);
  }
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new DraftArchiveError("provenance", `${label}: 사이드카가 JSON 이 아니다`, p);
  }
  const url = m["url"];
  if (typeof url !== "string" || url === "") {
    throw new DraftArchiveError("provenance", `${label}: 사이드카에 url 이 없다 — 「어디서」에 답할 수 없다`, p);
  }
  // ⚠**본문 해시가 판이다**(019). 사이드카의 `revision`(카운터)이 아니다 — 파일 머리말 참조.
  const sha = m["sha256"];
  if (typeof sha !== "string" || sha === "") {
    throw new DraftArchiveError("provenance", `${label}: 사이드카에 본문 해시가 없다 — 「몇 번째 판」에 답할 수 없다`, p);
  }
  // ⚠**`checkedAt` 이 먼저다.** 그 규칙은 `fetchedAtOf` 한 벌이 소유한다(M1).
  const fetchedAt = fetchedAtOf(p);
  if (fetchedAt === null) {
    throw new DraftArchiveError("provenance", `${label}: 사이드카에 취득 시각이 없다 — 「언제」에 답할 수 없다`, p);
  }
  return { source: url, fetchedAt, revision: sha };
}

export interface SeasonPages {
  readonly pages: readonly TeamPageWithMeta[];
  /**
   * 연도 톱(`/draft/{YYYY}/`) — **회의 행(`draft_event`)**의 출처([I3])와 **그 페이지가 적은 개최일**(2026-10-24).
   */
  readonly event: DraftEventSource;
}

/**
 * 연도 톱 본문을 읽는다. ⚠**`TextDecoder` 로 푼다** — 아래 `readSeasonPages` 주석의 그 사고 때문이다.
 * @returns 본문. **파일이 없을 때(`ENOENT`)만** `null`(「안 받았다」 · M11)
 * @throws ⚠**그 밖의 읽기 오류는 던진다**(2026-10-24 · GPT 검토 P2) — `EACCES`·`EISDIR` 같은 것을 「없음」으로 삼키면
 *   자산 손상·권한 장애가 난 **바로 그때** 경고가 꺼진다. gzip 이 깨져도 던진다.
 */
async function readYearIndex(archiveRoot: string, season: number): Promise<string | null> {
  const p = bodyPath(archiveRoot, yearIndexKey(season));
  let raw: Buffer;
  try {
    raw = await readFile(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return new TextDecoder("utf-8").decode(gunzipSync(raw));
}

/** 오류를 사람이 읽을 한 줄로. ⚠코드가 있으면 붙인다(`EISDIR` 같은 것이 사유의 핵심이다) */
function errLine(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as NodeJS.ErrnoException).code;
  return `${err.name}${code === undefined ? "" : `(${code})`}: ${err.message}`;
}

/** 그 경로에 **아무것도 없는가**(`ENOENT`). ⚠그 밖의 오류는 던진다 — 「모르겠다」를 「없다」로 접지 않는다 */
async function isAbsent(p: string): Promise<boolean> {
  try {
    await stat(p);
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

/**
 * **적재 경로**의 개최일 — ⚠**던지지 않는다.** 못 읽으면 사유를 든 `unreadable` 을 돌려주고, 그 해 지명·입찰은 그대로 넣는다
 * (2026-10-24 · 1차 검토 P2 (b)). 실패는 `SeasonLoadReport.heldOnError` → 사유 줄 + 종료 1 로 시끄럽다(M7).
 * ⚠**이 경로는 연도 톱 사이드카가 있는 것이 확인된 뒤에만 온다**(`provenanceOf` 가 먼저 돈다) — 그래서 본문이 없으면
 *   「안 받았다」가 아니라 **불완전한 자산**이다.
 */
async function readSeasonHeldOn(archiveRoot: string, season: number): Promise<DraftEventHeldOn> {
  try {
    const html = await readYearIndex(archiveRoot, season);
    if (html === null) {
      return { shape: "unreadable", reason: "연도 톱 사이드카는 있는데 본문이 없다 — 불완전한 자산이다(다시 받으면 풀린다)" };
    }
    return parseDraftHeldOn(html, season);
  } catch (err) {
    return { shape: "unreadable", reason: errLine(err) };
  }
}

/**
 * 그 시즌 아카이브에서 구단 페이지를 **전부** 읽는다. 연도 톱(`index`)은 구단이 아니라 제외한다.
 *
 * ⚠**파서가 던지면 그대로 올린다**(M7·G3) — 여기서 삼키면 「그 해는 원래 그렇다」가 된다.
 * ⚠**한 장이라도 못 읽으면 아무것도 안 돌려준다** — 그게 시즌 단위 원자성의 첫 번째 층이다.
 *
 * @throws {DraftArchiveError} 그 해가 없거나(`absent`) 출처를 못 대는 페이지가 있을 때(`provenance`)
 * @throws {DraftParseError} 구조가 바뀌었을 때(M7)
 */
export async function readSeasonPages(archiveRoot: string, season: number): Promise<SeasonPages> {
  const indexKey = yearIndexKey(season);
  const dir = dirname(bodyPath(archiveRoot, indexKey));
  const indexSlug = basename(indexKey);

  const entries = await readdir(dir).catch(() => null);
  if (entries === null) {
    throw new DraftArchiveError("absent", `${season}: 아카이브에 그 해가 없다`, dir);
  }
  const slugs = entries
    .filter((f) => f.endsWith(BODY_EXT))
    .map((f) => f.slice(0, -BODY_EXT.length))
    .filter((s) => s !== indexSlug)
    // ⚠**이름순으로 고정한다** — `readdir` 순서는 파일시스템이 정한다. 적재가 재현 가능해야 한다.
    .sort();
  if (slugs.length === 0) {
    // ⚠**「경합이 0건」이 아니라 「구단을 안 받았다」**다(M11). 여기서 `decideBids` 로 넘기면
    //   빈 시즌이 「소스가 경합을 안 쓴다」로 판정될 뻔한다.
    throw new DraftArchiveError("absent", `${season}: 구단 페이지가 0장`, dir);
  }

  const eventProv = await provenanceOf(archiveRoot, indexKey, `${season}/${indexSlug}`);
  const event: DraftEventSource = { ...eventProv, heldOn: await readSeasonHeldOn(archiveRoot, season) };

  const pages: TeamPageWithMeta[] = [];
  for (const slug of slugs) {
    const key = teamPageKey(season, slug);
    // ⚠**키 규칙이 갈라지면 여기서 붉어진다**(M7). 목록은 연도 톱 키에서, 본문은 구단 키에서
    //   경로를 얻으므로 둘이 다른 디렉터리를 가리키기 시작하면 **조용히 0건**이 될 자리다.
    if (dirname(bodyPath(archiveRoot, key)) !== dir) {
      throw new DraftArchiveError(
        "absent",
        `${season}/${slug}: 연도 톱과 구단 페이지의 키가 다른 디렉터리를 가리킨다 — 수집기 키 규칙이 바뀌었다`,
        `${dir} vs ${dirname(bodyPath(archiveRoot, key))}`,
      );
    }
    // ⚠**`gunzipSync` 의 결과를 `TextDecoder` 로 푼다.** `Uint8Array#toString("utf8")` 은 인자를
    //   무시하고 `"60,104,116,..."` 를 돌려주는데 **던지지 않아서** 파서가 「드래프트가 아니다」로
    //   오진하고 조용히 0건이 된다(수집기에서 실측된 사고 · `archiver/src/draft.ts`).
    const html = new TextDecoder("utf-8").decode(gunzipSync(await readFile(bodyPath(archiveRoot, key))));
    const prov = await provenanceOf(archiveRoot, key, `${season}/${slug}`);
    pages.push({
      team: slug,
      picks: parseDraftPicks(html, slug),
      bids: parseDraftBids(html, slug),
      ...prov,
    });
  }
  return { pages, event };
}

/** 아카이브가 가진 드래프트 시즌. **분모다** — 「무엇을 안 받았나」는 이 목록과의 차다 */
export async function seasonsInArchive(archiveRoot: string): Promise<number[]> {
  const root = dirname(bodyPath(archiveRoot, BACKNUMBER_KEY));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  return entries
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => Number(e.name))
    .sort((a, b) => a - b);
}

// ──────────────────────────────────────────────────────────────────────────
// 적재 — 시즌 단위 원자성
// ──────────────────────────────────────────────────────────────────────────

export interface SeasonLoadCounts {
  readonly teams: number;
  /** 이 시즌에 실재한 구획 수(중복 제거). ⚠구단별 `loadDraft` 반환을 더하면 12배가 된다 */
  readonly events: number;
  readonly picks: number;
  readonly bids: number;
  /** ⚠**`null` 은 「안 유도했다」**이지 「0건」이 아니다(M11) */
  readonly soleNominations: number | null;
  readonly sourceWritesBids: boolean;
  /**
   * npb 가 그 자리를 실제로 채워서 **비켜세운** 다른 출처(wikipedia)의 행 수([C1]).
   * ⚠**0 이 정상이다.** 0 이 아니면 **어제까지 CC BY-SA 로 나가던 행이 오늘 npb 것이 됐다**는
   * 뜻이라 사람이 알아야 한다 — CLI 가 그 시즌 이름을 따로 찍는다.
   */
  readonly yielded: { readonly picks: number; readonly bids: number };
  /**
   * 구획마다 **실제로 넣은** 개최일(`draft_event.held_on` · 2026-10-24). 구획 이름순.
   * ⚠**`date: null` 의 뜻은 `heldOnError` 가 가른다** — `null` 이면 「연도 톱이 그 회의의 날짜를 안 적는다」(M11),
   *   아니면 「우리가 못 읽었다」(M7)다.
   */
  readonly heldOn: readonly HeldOnEntry[];
  /**
   * 연도 톱에서 개최일을 **못 읽은 사유**. 못 읽었어도 지명·입찰은 넣었다 — 이 칸이 그 실패를 **시끄럽게** 만든다
   * (요약이 시즌을 따로 세고 종료코드를 올린다). ⚠`null` 은 「읽었다」다.
   */
  readonly heldOnError: string | null;
}

/** 구획 하나의 개최일. ⚠`null` 은 「소스가 안 말한다」 */
export interface HeldOnEntry {
  readonly kind: DraftKind;
  readonly date: string | null;
}

function applyPages(db: Db, season: number, sp: SeasonPages, decision: BidsDecision): SeasonLoadCounts {
  let picks = 0;
  let bids = 0;
  let soles = 0;
  let yieldedPicks = 0;
  let yieldedBids = 0;
  for (const p of sp.pages) {
    // ⚠**A16 — 한 키에는 출처가 하나다.** `loadDraft` 가 `origin='npb'` 만 지운다.
    // ⚠**`page` 는 그 구단 페이지, `event` 는 연도 톱**이다 — 입도가 다르므로 값도 달라야 한다([I3]).
    const r = loadDraft(db, {
      season,
      team: p.team,
      picks: p.picks,
      bids: decision.forTeam(p.team),
      page: { source: p.source, fetchedAt: p.fetchedAt, revision: p.revision },
      event: sp.event,
    });
    picks += r.picks;
    bids += r.bids;
    soles += r.soleNominations ?? 0;
    yieldedPicks += r.yielded.picks;
    yieldedBids += r.yielded.bids;
  }
  // ⚠**`loadDraft` 가 `draft_event` 를 세우는 구획과 같은 식이다**(지명이 있는 구획) — 두 벌이 갈리면
  //   로그가 넣지 않은 구획의 날짜를 말하게 된다. 날짜 규칙은 `draftHeldOnFor` 한 벌이다(M1 · `eventHeldOnFor` 가 감싼다).
  const kinds = [...new Set(sp.pages.flatMap((p) => p.picks.map((x) => x.kind)))].sort();
  return {
    teams: sp.pages.length,
    events: kinds.length,
    picks,
    bids,
    soleNominations: decision.sourceWritesBids ? soles : null,
    sourceWritesBids: decision.sourceWritesBids,
    yielded: { picks: yieldedPicks, bids: yieldedBids },
    heldOn: kinds.map((kind) => ({ kind, date: eventHeldOnFor(sp.event.heldOn, kind) })),
    heldOnError: sp.event.heldOn.shape === "unreadable" ? sp.event.heldOn.reason : null,
  };
}

/**
 * 시즌 전체를 넣는다 — **전부 아니면 아무것도 아니다**(G3).
 *
 * ⚠⚠**한 트랜잭션이다. 그게 전부이고, 그렇게 되기까지가 이 함수의 이력이다.**
 *
 * ⚠**그것이 정확히 A7 이 밟는 자리다.** 2005~2007 分離ドラフト에서 `firstRoundPick` 이 던지는
 * `DraftLoadError` 는 **파싱이 다 끝난 뒤 `loadDraft` 안에서** 나온다 — 구단마다 커밋이 떨어지면
 * **k번째에서 던졌을 때 앞의 k−1 구단이 남고**, 부분 적재는 화면에서 「그 해는 원래 그렇다」로
 * 읽힌다(2018 오릭스 `bs` 사고와 같은 모양).
 *
 * ⚠⚠**~~「버릴 DB 에 먼저 리허설한다」~~ 였고, 2026-09-06 에 버렸다**([C1]).
 * 그 구조는 「`loadDraft` 가 `BEGIN` 을 열어서 바깥에서 못 묶는다」는 **막다른 골목** 위에 서 있었는데,
 * 골목의 출구는 `BEGIN` 이 아니라 **`SAVEPOINT`** 였다(실측: 밖에 트랜잭션이 없으면
 * `BEGIN DEFERRED` 와 같게 동작하고, 있으면 중첩된다). `loadDraft` 를 그렇게 바꾸자
 * 시즌을 통째로 묶을 수 있게 됐다.
 * ⚠**리허설이 원리적으로 못 잡던 것이 있었다**: 리허설 DB 는 **비어 있어서**, 이미 들어 있는
 * **다른 `origin`** 의 행과 PK 가 부딪히는 경우를 **보지 못했다.** 그건 가정이 아니라
 * **2023~2026 이 실제로 밟는 경로**였다(`store/src/draft.ts` 머리말 [C1]).
 * → **한계를 우회한 것이 아니라 없앴다.** 지금 되돌아가는 것은 그 눈먼 자리를 되살리는 것이다.
 * ⚠**덤으로 시즌당 약 61ms(마이그레이션 20본 · 10회 611.5ms 실측)와 두 번 적재하던 비용이 사라졌다** —
 * 그건 이유가 아니라 결과다.
 *
 * ⚠**`decideBids` 는 트랜잭션 밖에서 부른다** — 판정에서 던지면 **SQL 을 한 줄도 안 만진다.**
 *
 * @throws {DraftLoadError} 입력이 적재 규칙에 안 맞을 때. ⚠**되돌려져서 아무것도 안 남는다**
 */
export function loadSeasonPages(db: Db, season: number, sp: SeasonPages): SeasonLoadCounts {
  const decision = decideBids(sp.pages);
  return db.transaction(() => applyPages(db, season, sp, decision));
}

// ──────────────────────────────────────────────────────────────────────────
// 보고
// ──────────────────────────────────────────────────────────────────────────

/**
 * 건너뛴 사유. ⚠**다섯 갈래를 뭉치지 마라** — 갈래마다 해야 할 일이 다르다.
 * 수집기(`archiver/src/draft.ts`)의 `DraftYearSkip` 과 **같은 사고방식**이다.
 *   · `absent`     그 해를 안 받았다. **FAIL 도 ERROR 도 아니다**(M11)
 *   · `provenance` 출처를 못 댄다. FAIL — **다시 받으면 풀린다**
 *   · `parse`      구조가 바뀌었다(M7). FAIL — **사람이 봐야 한다**
 *   · `load`       적재 규칙에 안 맞는다(A7 등). FAIL — ⚠**재시도로 절대 안 풀린다**
 *   · `error`      우리가 예상하지 못한 것. ERROR — 「돌지도 않음」이라 FAIL 과 따로 센다
 */
export type SeasonSkipKind = "absent" | "provenance" | "parse" | "load" | "error";

export interface SeasonSkip {
  readonly kind: SeasonSkipKind;
  readonly reason: string;
}

export interface SeasonLoadReport {
  readonly season: number;
  /** 적재했는가. false 면 `skipped` 가 사유를 갖는다 */
  readonly loaded: boolean;
  /** **적재한** 구단 수. 건너뛰었으면 0 이다 */
  readonly teams: number;
  readonly events: number;
  readonly picks: number;
  readonly bids: number;
  readonly soleNominations: number | null;
  /**
   * npb 가 그 자리를 채워 **비켜세운** 다른 출처의 행 수([C1]).
   * ⚠**`null` 은 「안 쟀음」**(건너뛴 시즌)이고 `{picks:0,bids:0}` 은 「재 봤더니 0」이다(M11).
   */
  readonly yielded: { readonly picks: number; readonly bids: number } | null;
  readonly skipped: SeasonSkip | null;
  /**
   * ⚠**소스가 경합을 쓰는 시즌인가.** 화면이 「데이터 없음」으로 그리면 거짓이다(B2).
   *
   * ⚠**`null` 은 「판정 안 했다」**이고 `false` 는 「소스가 안 쓴다」다(M11).
   * 브리프 초판은 건너뛴 시즌에도 `false` 를 넣었는데, **그건 이 태스크가 막으려는 바로 그 혼동**이다.
   */
  readonly sourceWritesBids: boolean | null;
  /** 구획별 개최일(`SeasonLoadCounts.heldOn`). ⚠**`null` 은 「안 쟀음」**(건너뛴 시즌)이다 */
  readonly heldOn: readonly HeldOnEntry[] | null;
  /** 개최일을 못 읽은 사유(`SeasonLoadCounts.heldOnError`). ⚠건너뛴 시즌은 `null`(묻지 않았다) */
  readonly heldOnError: string | null;
}

function classify(err: unknown): SeasonSkip {
  if (err instanceof DraftArchiveError) return { kind: err.kind, reason: err.message };
  // ⚠`DraftIndexError` 는 `DraftParseError` 의 자식이다 — 이 순서가 그것을 함께 받는다
  if (err instanceof DraftParseError) return { kind: "parse", reason: `${err.name}: ${err.message}` };
  if (err instanceof DraftLoadError) return { kind: "load", reason: `${err.name}: ${err.message}` };
  return { kind: "error", reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
}

function skipped(season: number, skip: SeasonSkip): SeasonLoadReport {
  return {
    season,
    loaded: false,
    teams: 0,
    events: 0,
    picks: 0,
    bids: 0,
    // ⚠**전부 `null` 이다** — 0 이라고 쓰면 「재 봤더니 0」이 된다(M11)
    soleNominations: null,
    yielded: null,
    skipped: skip,
    sourceWritesBids: null,
    heldOn: null,
    heldOnError: null,
  };
}

/**
 * 한 시즌을 아카이브에서 읽어 넣는다.
 *
 * ⚠**던지지 않는다** — 사유를 보고서에 담는다. 한 해가 무너져도 다른 해를 계속 넣는 것이
 * 이 도구의 방침이고(`archiveDates` 와 같다), **무너진 사실은 종료코드와 사유로 남는다.**
 */
export async function loadDraftSeason(
  db: Db,
  season: number,
  opts: { readonly archiveRoot: string },
): Promise<SeasonLoadReport> {
  let sp: SeasonPages;
  try {
    sp = await readSeasonPages(opts.archiveRoot, season);
  } catch (err) {
    return skipped(season, classify(err));
  }
  try {
    const n = loadSeasonPages(db, season, sp);
    return {
      season,
      loaded: true,
      teams: n.teams,
      events: n.events,
      picks: n.picks,
      bids: n.bids,
      soleNominations: n.soleNominations,
      yielded: n.yielded,
      skipped: null,
      sourceWritesBids: n.sourceWritesBids,
      heldOn: n.heldOn,
      heldOnError: n.heldOnError,
    };
  } catch (err) {
    return skipped(season, classify(err));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 개최일 — 로그 한 칸 · 「개최 후 미수집」 경고(2026-10-24)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 시즌 줄의 개최일 칸. ⚠**「모름」을 숨기지 않는다** — 구획마다 같은 날이면 한 번, 아니면 구획별로 적는다.
 * ⚠**세 가지를 가른다**: 건너뛴 시즌은 「안쟀음」, 연도 톱이 안 적은 구획은 「모름」(M11),
 *   **우리가 못 읽은 것은 「못읽음」**(M7 · 사유는 요약 줄이 적는다). 셋 다 DB 에서는 NULL 이라 **줄이 갈라 줘야 한다.**
 */
export function heldOnNote(h: readonly HeldOnEntry[] | null, error: string | null): string {
  if (h === null) return "개최일 안쟀음";
  if (error !== null) return "개최일 못읽음(⚠요약 줄에 사유)";
  if (h.length === 0) return "개최일 구획없음";
  const dates = new Set(h.map((x) => x.date));
  const only = [...dates][0];
  if (dates.size === 1 && only !== null && only !== undefined) return `개최일 ${only}`;
  return `개최일 ${h.map((x) => `${x.kind} ${x.date ?? "모름"}`).join(" · ")}`;
}

/**
 * 「개최 후 미수집」의 유예(일). 개최일 **다음 날부터 세어** 이 날수를 **넘으면** 경고한다 —
 * 2026-10-22 개최면 10-25 까지 조용하고 **10-26 부터** 운다.
 * ⚠**3일인 이유**: 수집은 사람이 로컬에서 연 1회 돌리고(런북 §0), 경합 주석은 개최 며칠 뒤에 붙는다(런북 §2).
 *   개최 당일 밤에 울면 아직 할 수 없는 일을 재촉하게 된다.
 */
export const DRAFT_UNCOLLECTED_GRACE_DAYS = 3;

/** `YYYY-MM-DD` → 1970-01-01 부터의 날수. ⚠시계를 안 읽는다(M6) — 주어진 글자를 해석할 뿐이다 */
function dayNumber(ymd: string, label: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(ymd);
  const t = m === null ? Number.NaN : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (m === null || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== ymd) {
    // ⚠**모르면 「넘지 않았다」로 기울지 않는다** — 그러면 경고가 조용히 꺼진다. 던진다.
    throw new Error(`${label} 이 YYYY-MM-DD 가 아니다: ${JSON.stringify(ymd)}`);
  }
  return t / 86_400_000;
}

/**
 * **「개최 후 미수집」 판정** — 순수 함수(M6: 오늘은 주입받는다).
 *
 * @returns 경고 문장(`::warning::` 접두사 없이). 조용해야 하면 `null`.
 * ⚠**배포를 막지 않는다** — 드래프트는 연 1회 바뀌고 어제 값이 그대로 나간다. 그래도 **조용하면 안 된다**:
 *   화면은 그 해를 「まだ収集していません」으로 그리는데 그건 **에러가 아니라 빈 칸**이라 아무도 결함으로 못 읽는다.
 */
export function uncollectedDraftWarning(input: {
  readonly season: number;
  /** 그 해 **가장 이른** 회의의 날짜(`draftHeldOnFirst`) */
  readonly heldOn: string;
  /** 그 시즌 `draft_pick` 행 수(출처 무관) */
  readonly picks: number;
  /** 오늘(JST · `YYYY-MM-DD`) */
  readonly todayJst: string;
}): string | null {
  const elapsed = dayNumber(input.todayJst, "todayJst") - dayNumber(input.heldOn, "heldOn");
  if (input.picks > 0 || elapsed <= DRAFT_UNCOLLECTED_GRACE_DAYS) return null;
  return (
    `${input.season} 드래프트는 ${input.heldOn} 에 열렸는데(${elapsed}일 전) 지명이 0행이다 — `
    + "수집하지 않았거나 자산(draft-archive.tar)을 안 올렸다. 배포는 막지 않는다 · "
    + "docs/operations/draft-backfill.md §1(수집)·§0(자산 업로드)"
  );
}

/** 연도 톱에서 개최일을 읽은 결과. ⚠**세 갈래를 뭉치지 마라** — 할 일이 다르다 */
export type HeldOnRead =
  | { readonly state: "dated"; readonly heldOn: DraftHeldOn }
  /** 연도 톱을 **안 받았다**(M11) — 판정할 근거가 없다. 조용하다 */
  | { readonly state: "no-index" }
  /** 받았는데 **날짜를 못 읽었다**(M7) — 경고가 이 해를 못 본다는 사실을 알린다 */
  | { readonly state: "unreadable"; readonly reason: string };

/**
 * ⚠**던지지 않는다** — 경고 경로가 적재 도구 전체를 죽이면 요약·종료코드 줄이 통째로 사라진다.
 *   본문이 깨져 있어도(gzip 손상 등) 「못 읽었다」로 돌려준다.
 * ⚠**「안 받았다(no-index)」는 본문도 사이드카도 없을 때뿐이다**(2026-10-24 · GPT 검토 P2). 사이드카만 있으면
 *   **불완전한 자산**이고, 본문 자리를 못 읽으면(`EISDIR`·`EACCES` …) 그건 「없다」가 아니라 「못 읽었다」다 —
 *   그 둘을 조용히 넘기면 **자산 손상이 난 바로 그 해에 경고가 꺼진다.**
 */
export async function readHeldOn(archiveRoot: string, season: number): Promise<HeldOnRead> {
  try {
    const html = await readYearIndex(archiveRoot, season);
    if (html === null) {
      if (await isAbsent(metaPath(archiveRoot, yearIndexKey(season)))) return { state: "no-index" };
      return { state: "unreadable", reason: "연도 톱 사이드카는 있는데 본문이 없다 — 불완전한 자산이다(다시 받거나 자산을 다시 펴라)" };
    }
    return { state: "dated", heldOn: parseDraftHeldOn(html, season) };
  } catch (err) {
    return { state: "unreadable", reason: errLine(err) };
  }
}

/**
 * 시즌들의 「개최 후 미수집」 경고 문장(`::warning::` 접두사 없이). **지명이 1행이라도 있는 시즌은 묻지 않는다.**
 *
 * ⚠**오늘은 주입받는다**(M6) — CLI 는 적재 시각을 스탬프한 **그 한 번의 시계**에서 JST 날짜를 만든다.
 * ⚠**연도 톱이 없는 해는 판정하지 못한다**(조용하다) — 그래서 개최일이 발표되면 그 해 연도 톱을
 *   **미리 한 장 받아 자산에 넣어 두라**고 런북 §1 이 말한다. 그 장이 없으면 이 경고는 그 해를 못 본다.
 * ⚠**날짜를 못 읽은 해는 그 사실을 문장으로 낸다** — 경고가 꺼진 것을 경고한다. 단 지명이 있는 해는 묻지 않으므로
 *   (그 해의 날짜 실패는 npb 적재가 이미 `parse` 로 붉혔다) 같은 실패를 두 번 세지 않는다.
 */
export async function draftCollectionWarnings(
  db: Db,
  archiveRoot: string,
  seasons: readonly number[],
  todayJst: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const season of seasons) {
    const picks = draftPicksIn(db, season);
    if (picks > 0) continue;
    const read = await readHeldOn(archiveRoot, season);
    if (read.state === "no-index") continue;
    if (read.state === "unreadable") {
      out.push(`${season} 연도 톱에서 개최일을 못 읽었다 — 「개최 후 미수집」 경고가 이 해를 못 본다(${read.reason})`);
      continue;
    }
    const w = uncollectedDraftWarning({ season, heldOn: draftHeldOnFirst(read.heldOn), picks, todayJst });
    if (w !== null) out.push(w);
  }
  return out;
}


// ──────────────────────────────────────────────────────────────────────────
// wikipedia 경로 — ⚠**npb 가 말하지 않는 자리만 채운다**(M1)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 한 시즌의 wikipedia 결과.
 *
 * ⚠**「적재」와 「대조」가 한 함수에 있는 것이 일부러다.** 2005~2022 는 npb 가 경합을 말하므로
 * **넣지 않고 대조만** 하고, 2023~ 은 npb 가 말하지 않으므로 **넣는다.** 두 일을 갈라 놓으면
 * 대조가 「따로 돌리는 것」이 되고, 따로 돌리는 검사는 **안 돌게 된다.**
 * ⚠**그리고 대조가 이 소스를 채용할 수 있는 유일한 근거다**(규칙표 §5 · `X-1`).
 */
export interface WikiSeasonReport {
  readonly season: number;
  /**
   * ⚠**셋은 결함이 아니다**(M11) — `absent`(아카이브에 그 해가 없다) · `no-grid`(개최 전·미기재) ·
   * `no-npb`(npb 지명이 아직 안 들어왔다). **`failed` 만 종료코드를 올린다.**
   *
   * ⚠⚠**`no-npb` 를 `failed` 로 세면 헛불이 일상이 된다**(2026-09-06 · [I-5]).
   * 수집이 **두 명령**이라(런북 §1 · §8-2) **위키만 먼저 들어온 상태가 정상적인 중간 상태**다.
   * 그때 열↔구단 맞추기는 「npb 명단이 0건이라 맞출 근거가 없다」로 **정당하게 던지는데**,
   * 그 예외를 `failed` 로 세면 **자산을 아직 안 넓힌 날 배치가 매일 붉어진다.**
   * ⚠**헛불이 일상이 되면 진짜 위반도 안 읽힌다** — 이 저장소가 A6·A14 에서 이미 판단한 그것이다.
   */
  readonly state: "absent" | "no-grid" | "no-npb" | "done" | "failed";
  readonly reason: string | null;
  /** 열↔구단이 붙은 수. **12여야 한다** */
  readonly columns: number;
  /** 이름 겹침의 **최솟값**. ⚠1이면 아슬아슬하다는 뜻이라 사람이 봐야 한다 */
  readonly minOverlap: number | null;
  readonly invariantChecked: Readonly<Record<string, number>> | null;
  readonly invariantViolations: readonly string[];
  /**
   * `X-3` — 지명 명단 대조.
   * ⚠**두 갈래를 나눠 센다**: `fact` 는 「누가 뽑혔나」가 갈린 것이고 `spelling` 은 **글자만** 다른 것이다.
   * 뭉치면 대조가 **매일 붉어지고** 헛불이 일상이 된다(`DraftWikiDiffSeverity` 주석).
   */
  readonly pickChecked: number;
  readonly pickFact: number;
  readonly pickSpelling: number;
  readonly pickDiffs: readonly string[];
  /** `X-1` — 경합 대조. ⚠**npb 가 경합을 안 쓰는 시즌은 분모가 0이다**(「안 쟀음」) */
  readonly bidChecked: number;
  readonly bidFact: number;
  readonly bidSpelling: number;
  readonly bidDiffs: readonly string[];
  readonly wrote: { readonly picks: number; readonly bids: number; readonly events: number } | null;
  readonly deferred: { readonly picks: number; readonly bids: number } | null;
  /**
   * CSS 문법상 무효라 **선언이 없는 칸으로 읽은** `font-weight`(2026-10-24 · 규칙표 §3).
   * 한 줄에 「행 라벨 · 열 머리 · 값」(`1巡目1 楽天 heavy`). ⚠**빈 배열이 정상이다**(2005~2025 전수 0).
   * ⚠종료코드를 안 올린다 — 브라우저와 같게 읽은 것이지 실패가 아니다. 대신 **세어서 찍는다.**
   */
  readonly ignoredFontWeights: readonly string[];
}

function wikiSkip(season: number, state: WikiSeasonReport["state"], reason: string | null): WikiSeasonReport {
  return {
    season,
    state,
    reason,
    columns: 0,
    minOverlap: null,
    invariantChecked: null,
    invariantViolations: [],
    // ⚠**전부 0 이지만 「0건 일치」가 아니라 「안 쟀음」이다.** `state` 가 그것을 말한다(M11).
    pickChecked: 0,
    pickFact: 0,
    pickSpelling: 0,
    pickDiffs: [],
    bidChecked: 0,
    bidFact: 0,
    bidSpelling: 0,
    bidDiffs: [],
    wrote: null,
    deferred: null,
    ignoredFontWeights: [],
  };
}

/**
 * 한 시즌의 wikipedia 기사를 읽어 **대조하고, npb 가 말하지 않는 자리에만 넣는다.**
 *
 * ⚠**던지지 않는다** — 사유를 보고서에 담는다(npb 쪽 `loadDraftSeason` 과 같은 방침).
 * ⚠**대조 불일치는 종료코드를 올린다.** 그것이 채택 게이트 `G-B`·`G-C` 이고, 조용해지면
 * 이 소스를 계속 쓸 근거가 사라진다.
 */
export async function loadDraftWikiSeason(
  db: Db,
  season: number,
  opts: { readonly archiveRoot: string },
): Promise<WikiSeasonReport> {
  const key = draftWikiKey(season);
  let html: string;
  try {
    html = new TextDecoder("utf-8").decode(gunzipSync(await readFile(bodyPath(opts.archiveRoot, key))));
  } catch {
    // ⚠**「안 받았다」는 결함이 아니다**(M11). 자산이 아직 없는 상태에서도 배치는 돌아야 한다.
    return wikiSkip(season, "absent", `${bodyPath(opts.archiveRoot, key)}`);
  }

  let prov: DraftProvenance;
  let parsed: DraftWikiParse;
  try {
    // ⚠**출처는 사이드카에서 온다**(M4) — URL 도 시각도 판도. npb 쪽과 같은 한 벌을 쓴다.
    prov = await provenanceOf(opts.archiveRoot, key, `wikipedia/${season}`);
    parsed = parseDraftWiki(html, season);
  } catch (err) {
    return wikiSkip(season, "failed", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
  if (parsed.kind !== "grid") {
    // ⚠**미개최·미기재다**(2026). 실패가 아니다.
    return wikiSkip(season, "no-grid", `절 ${parsed.sectionId} 에 wikitable 이 없다`);
  }

  /**
   * ⚠⚠**[I-5] npb 지명이 아직 없는 것은 결함이 아니라 정상적인 중간 상태다.**
   *
   * 수집이 두 명령이라(런북 §1 · §8-2) **순서가 갈릴 수 있다** — 위키 자산만 먼저 넓혀졌거나,
   * npb 아카이브가 그 해만 아직 없는 상태. 그때 `resolveDraftWikiColumns` 는 「맞출 근거가 없다」로
   * **정당하게 던지지만**, 그 예외를 `failed` 로 세면 **exit 1 이 되어 배치가 매일 붉어진다.**
   * ⚠**여기서 미리 묻는 이유**: 예외 메시지로 갈래를 되찾으면 문구가 바뀐 날 조용히 `failed` 로
   * 돌아간다. **묻는 것과 던지는 것을 같은 문자열에 의존시키지 않는다**(M1).
   * ⚠**그 아래 갈래(열 수가 다르다 · 겹침이 0 · 동점)는 그대로 `failed` 다** — 그건 진짜 붕괴다.
   */
  const npbNames = npbNamesBySeason(db, season);
  if (npbNames.size === 0) {
    return wikiSkip(season, "no-npb", `${season}: npb 지명이 0건이라 열↔구단을 맞출 수 없다 — 먼저 npb 를 넣어라`);
  }

  try {
    const inv = checkDraftWikiInvariants(parsed);

    // ── 열 ↔ 구단 ──
    const namesByColumn = parsed.grid.columns.map(
      (_, c) => new Set(parsed.picks.filter((p) => p.columnIndex === c).map((p) => normalizePlayerName(p.nameDisplay))),
    );
    const matches = resolveDraftWikiColumns(season, parsed.grid.columns, namesByColumn, npbNames);
    const teamOfColumn = matches.map((m) => m.team);

    // ── X-3: 지명 명단 ──
    // ⚠**회차 없는 제도(希望入団枠·自由獲得)는 순번을 「적재가」 매긴다** — 그 순번은 소스가 말한
    //   값이 아니므로 **회차로 대조하면 안 된다.** 그래서 양쪽 다 그 구획만 회차를 뺀다.
    const noRound = (kind: string): boolean => kind === "kibou_nyudanwaku" || kind === "jiyuu_kakutoku";
    const npbPicks = npbPicksBySeason(db, season).map((p) => ({ ...p, roundNo: noRound(p.kind) ? -1 : p.roundNo }));
    const x3 = compareDraftWikiPicks(
      season,
      npbPicks,
      parsed.picks.map((p) => ({
        team: teamOfColumn[p.columnIndex]!,
        kind: p.kind,
        roundNo: noRound(p.kind) ? -1 : p.roundNo,
        nameDisplay: p.nameDisplay,
      })),
    );

    // ── X-1: 경합 ──
    // ⚠**추첨이 성립하는 구획만 본다** — 育成·希望入団枠 에는 추첨이 없어서 비교 대상이 아니다.
    const wikiBids: BidFact[] = parsed.bids
      .filter((b) => isLotteryKind(b.kind))
      .map((b) => ({
        kind: b.kind,
        roundNo: b.bidRound,
        team: teamOfColumn[b.columnIndex]!,
        groupKey: b.groupKey,
        won: b.won === null ? null : b.won ? 1 : 0,
        nameDisplay: b.nameDisplay,
      }));
    const npbBids = npbBidsBySeason(db, season);
    /**
     * ⚠⚠**추첨이 실제로 열린 구획만 분모에 넣는다** — 둘 중 **한 쪽이라도 경합 그룹을 가진** 구획.
     *
     * ⚠**실측으로 나온 자리다**(2005·2006 `daigaku_shakaijin`): 그 두 해의 대학생·사회인 드래프트는
     * **희망입단枠 + 웨이버**라 추첨이 없었다. 그런데 npb 적재는 그 구획의 1巡目 지명을 보고
     * **単独指名 을 유도**하고(`deriveSoleNominations`), wikipedia 는 그 행이 **웨이버 행**이라 입찰을 안 낸다.
     * → **둘 다 틀리지 않았고 모델이 다른 것**이라, 그걸 「불일치」로 세면 **매일 붉어진다.**
     *
     * ⚠**그렇다고 구멍이 생기지는 않는다**: 파서가 어느 구획의 색을 통째 못 읽으면
     * **npb 쪽에 경합 그룹이 남아 있으므로** 그 구획은 분모에 들고, 그때 npb 행 전부가 `fact` 로 드러난다.
     */
    const contested = new Set(
      [...npbBids, ...wikiBids].filter((b) => b.groupKey !== null).map((b) => b.kind),
    );
    const npbInScope = npbBids.filter((b) => contested.has(b.kind));
    const wikiInScope = wikiBids.filter((b) => contested.has(b.kind));
    // ⚠**npb 가 경합을 안 쓰는 시즌은 대조하지 않는다** — 그때 「전건 불일치」를 내면
    //   2023~2025 가 매번 붉어지고, 헛불이 일상이 되면 진짜 위반도 안 읽힌다(A6 과 같은 사고).
    const x1: { checked: number; diffs: readonly DraftWikiDiff[] } =
      npbBids.length === 0 ? { checked: 0, diffs: [] } : compareDraftWikiBids(season, npbInScope, wikiInScope);

    // ── 적재 ──
    // ⚠**불변식이 깨졌으면 넣지 않는다.** 「일단 넣고 나중에 고친다」가 이 도메인에서 가장 비싸다.
    const wrote =
      inv.violations.length > 0
        ? null
        : loadDraftWiki(db, { season, teamOfColumn, picks: parsed.picks, bids: parsed.bids, page: prov });

    return {
      season,
      state: "done",
      reason: null,
      columns: matches.length,
      minOverlap: Math.min(...matches.map((m) => m.overlap)),
      invariantChecked: inv.checked,
      invariantViolations: inv.violations.map((v) => `${v.id} ${v.detail}`),
      pickChecked: x3.checked,
      pickFact: countBySeverity(x3.diffs).fact,
      pickSpelling: countBySeverity(x3.diffs).spelling,
      pickDiffs: x3.diffs.map((d) => `[${d.severity}] ${d.detail}`),
      bidChecked: x1.checked,
      bidFact: countBySeverity(x1.diffs).fact,
      bidSpelling: countBySeverity(x1.diffs).spelling,
      bidDiffs: x1.diffs.map((d) => `[${d.severity}] ${d.detail}`),
      wrote: wrote === null ? null : { picks: wrote.picks, bids: wrote.bids, events: wrote.events },
      deferred: wrote === null ? null : { picks: wrote.picksDeferred, bids: wrote.bidsDeferred },
      ignoredFontWeights: parsed.ignoredFontWeights.map(
        (s) => `${s.rowLabel} ${parsed.grid.columns[s.columnIndex] ?? `col=${s.columnIndex}`} ${s.value}`,
      ),
    };
  } catch (err) {
    if (err instanceof DraftWikiLoadError || err instanceof DraftWikiParseError || err instanceof DraftLoadError) {
      return wikiSkip(season, "failed", `${err.name}: ${err.message}`);
    }
    return wikiSkip(season, "failed", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 검사 시점 — 「지금 걸어도 되는가」
// ──────────────────────────────────────────────────────────────────────────

/**
 * 불변식 여섯의 이름. ⚠**정본은 `scripts/test/draft-invariants.test.ts` 의 `name:` 필드**이고
 * 여기 있는 것은 **그것을 가리키는 라벨**이다 — 사람이 이 줄을 보고 그 파일을 grep 한다.
 * ⚠**그래서 갈리면 안 된다.** 두 목록이 어긋나면 시험이 붉어진다
 * (`load-draft-archive.test.ts` 의 「찍는 이름이 실재해야 한다」 · M1).
 * ⚠**`INV-4b` 가 아니라 `INV-4′` 다** — 계획서 코드 블록이 `INV-4b` 로 적었는데
 * **저장소 어디에도 그 이름은 없다.** 검사기가 스스로 붙인 이름이 `INV-4′` 이고,
 * 런북을 읽은 사람이 실제로 찾을 수 있는 것은 그쪽이다.
 */
const ALL_INVARIANTS = ["INV-4", "INV-4′", "INV-5", "INV-N1", "INV-N2", "INV-N3"] as const;

/**
 * `draft_bid` 가 0행이어도 **분모가 서는** 유일한 불변식.
 * 그것만 분모를 `draft_pick ∪ draft_bid` 에서 얻는다 — 지명은 어느 시즌에나 있다.
 */
const INV_WITHOUT_BIDS = ["INV-N2"] as const;

/**
 * 시즌이 다 들어왔다고 볼 최소 구단 수.
 *
 * ⚠**`TEAMS.length`(domain)를 쓰지 않는다.** 그건 **현재** 12구단의 명단이라
 * 언젠가 확장구단이 붙으면 **과거 시즌 전부가 조용히 「검사 대상 아님」으로 떨어진다** —
 * 안전망이 소리 없이 꺼지는 쪽으로 틀린다. 여기는 **하한**이고 비교가 `<` 라,
 * 13구단 시즌이 와도 여섯을 그대로 건다(안전한 쪽으로 틀린다).
 */
const SEASON_COMPLETE_TEAMS = 12;

/**
 * 그 시즌에 **실제로 걸 수 있는** 불변식 목록.
 *
 * ⚠**A6** — 12구단이 다 들어오기 전에는 아무것도 안 건다. 중간 상태에서 INV-N1 이
 * 붉은 것은 결함이 아니라 **시즌이 덜 들어온 것**이고(이긴 구단이 아직 안 왔을 뿐이다),
 * 헛불이 일상이 되면 **진짜 위반도 안 읽힌다.**
 *
 * ⚠**A14** — `sourceWritesBids` 가 참이 아닌 시즌(실측 2023~2025)은 `draft_bid` 가
 * **0행**이라 여섯 중 다섯이 **구조적으로 붉다**:
 *   `INV-4`                      분모는 `draft_pick` 에서 와 슬롯이 살아 있는데
 *                                획득이 영원히 0 → **만족 불가**
 *   `INV-4′`·`INV-5`·`INV-N1`·`INV-N3`  분모를 `draft_bid` 에서 얻어 **0**
 *                                → `assertClean` 이 그 자체를 실패시킨다
 * **남는 것은 `INV-N2` 하나뿐**이다.
 *
 * ⚠**그 붉음을 결함으로 읽지 마라.** `INV-4` 의 메시지는 「확정된 획득이 0건이다」인데
 * 그 시즌의 실제 뜻은 **「이 시즌 소스가 경합을 안 쓴다」**다(B2). 「데이터 없음」이 아니다.
 *
 * ⚠**`sourceWritesBids === null`(판정 안 함)도 제한 쪽으로 떨어뜨린다.** 모르면
 * 안전한 쪽이다 — 여섯을 켰다가 헛불을 내는 것보다 하나만 켜는 편이 싸다(M11).
 */
export function checkableInvariants(r: SeasonLoadReport): string[] {
  if (!r.loaded || r.teams < SEASON_COMPLETE_TEAMS) return [];
  if (r.sourceWritesBids !== true) return [...INV_WITHOUT_BIDS];
  return [...ALL_INVARIANTS];
}

export interface SeasonsSummary {
  /** 이번에 **돌린** 시즌 수. 분모다 */
  readonly targets: number;
  readonly loaded: number;
  /** ⚠**결함이 아니다**(M11) — 안 받았을 뿐이라 종료코드를 안 올린다 */
  readonly absent: number;
  readonly provenance: number;
  readonly parse: number;
  readonly load: number;
  /** ⚠**「돌지도 않음」이라 FAIL 과 따로 센다** */
  readonly error: number;
  /** 적재됐지만 **소스가 경합을 안 쓰는** 시즌 수(B2). ⚠건너뛴 시즌은 안 센다 — 「안 쟀음」이다 */
  readonly noBidsSource: number;
  /**
   * **일부만** 걸 수 있는 적재 시즌(실측 2023~2025). ⚠사람이 21줄을 훑지 않아도 되게 담는다.
   *
   * ⚠**「여섯보다 적다」로 세지 마라** — 그러면 구단이 덜 들어와 **하나도 못 거는** 시즌이
   * 같은 칸에 들어가 요약이 「INV-N2 는 걸 수 있다」고 **거짓말을 한다.** 그쪽은 `incomplete` 다.
   */
  readonly limited: readonly number[];
  /**
   * 적재는 됐는데 **구단이 덜 들어와 아무것도 못 거는** 시즌.
   *
   * ⚠**이것은 정상이 아니다** — 아카이브가 불완전하다는 뜻이고, 화면에는
   * 「그 해는 원래 이렇다」로 보인다(2018 오릭스 `bs` 사고와 같은 모양).
   * ⚠종료코드는 안 올린다(건너뛴 게 아니라 들어오긴 했다) — **대신 눈에 띄게 찍는다.**
   */
  readonly incomplete: readonly number[];
  /**
   * npb 가 **다른 출처의 행을 비켜세운** 시즌([C1]).
   *
   * ⚠**결함이 아니다 — 규칙대로 동작한 것이다**(공식 > 커뮤니티). 그래도 **조용하면 안 된다**:
   * 그 시즌은 어제까지 화면에 **CC BY-SA 고지와 함께** 나가던 행이 오늘 npb 것으로 바뀌었고,
   * `X-1` 대조도 「안 쟀음」에서 「쟀음」으로 넘어간다(런북 §8-5).
   * ⚠**종료코드는 안 올린다** — 정상 동작이다.
   */
  readonly yielded: readonly number[];
  /**
   * 연도 톱에서 **개최일을 못 읽은** 적재 시즌(2026-10-24). ⚠지명·입찰은 들어갔다 — 그래서 `loaded` 로 세면서도
   * **종료코드를 올린다**(M7 을 로그와 종료코드가 지킨다 · 조용한 NULL 이 아니다).
   */
  readonly heldOnFailed: readonly number[];
  readonly exitCode: 0 | 1;
}

/**
 * 시즌 보고서를 한 줄로 접는다.
 *
 * ⚠**`main` 이 이것을 쓴다 — 세는 규칙은 한 벌이다**(M1). 표시용으로 따로 세면
 * 종료코드와 화면이 갈리는 날이 온다.
 * ⚠**`absent` 는 종료코드를 안 올린다.** 2026 은 개최 전이라 구단 페이지가 0장인 것이
 * **정답**이고, 그걸로 배치를 붉히면 매년 드래프트 전까지 빨간 배치를 보게 된다.
 */
export function summarizeSeasons(reports: readonly SeasonLoadReport[]): SeasonsSummary {
  const by = (k: SeasonSkipKind): number => reports.filter((r) => r.skipped?.kind === k).length;
  const bad = by("provenance") + by("parse") + by("load") + by("error");
  /** ⚠**걸 수 있는 개수로 세 갈래를 가른다** — 「여섯보다 적다」 하나로 묶으면 거짓이 된다 */
  const loadedWith = (want: (n: number) => boolean): number[] =>
    reports.filter((r) => r.loaded && want(checkableInvariants(r).length)).map((r) => r.season);
  const heldOnFailed = reports.filter((r) => r.loaded && r.heldOnError !== null).map((r) => r.season);
  return {
    targets: reports.length,
    loaded: reports.filter((r) => r.loaded).length,
    absent: by("absent"),
    provenance: by("provenance"),
    parse: by("parse"),
    load: by("load"),
    error: by("error"),
    noBidsSource: reports.filter((r) => r.loaded && r.sourceWritesBids === false).length,
    limited: loadedWith((n) => n > 0 && n < ALL_INVARIANTS.length),
    incomplete: loadedWith((n) => n === 0),
    yielded: reports.filter((r) => (r.yielded?.picks ?? 0) + (r.yielded?.bids ?? 0) > 0).map((r) => r.season),
    heldOnFailed,
    exitCode: bad > 0 || heldOnFailed.length > 0 ? 1 : 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

/**
 * 불변식 여섯의 **분모**를 한 칸에 적는다(Minor-1 · 2026-09-06).
 *
 * ⚠⚠**초판은 `invariantChecked` 를 계산해 놓고 버렸다** — 로그에는 「INV 위반 0」만 남았고,
 * 그건 **「0건」과 「안 쟀음」을 구별하지 못하는 문장**이다(작업규칙 7). 파서가 어느 구획의 색을
 * 통째로 못 읽으면 그 검사의 분모가 **0 으로 조용히 내려앉는데**, 위반도 0 이라 로그가 초록으로 보인다.
 * ⚠**그래서 분모 0 인 검사의 이름을 따로 찍는다** — `assertClean` 이 시험 하네스에서 하는 일과
 * 같은 판단이고(런북 §7), 실 DB 검사 도구가 없는 지금 **사람이 이 줄을 보고 판단한다.**
 */
export function invariantNote(w: WikiSeasonReport): string {
  const n = w.invariantViolations.length;
  if (w.invariantChecked === null) return `INV 안쟀음(위반 ${n})`;
  const entries = Object.entries(w.invariantChecked);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const zero = entries.filter(([, v]) => v === 0).map(([id]) => id);
  return (
    `INV 위반 ${n} / ${entries.length}종 분모 ${total}`
    + (zero.length > 0 ? ` ⚠분모0: ${zero.join(",")}` : "")
  );
}

/** 한 시즌 wikipedia 결과 한 줄. ⚠**「안 쟀음」을 「0건」으로 적지 않는다**(M11) */
export function wikiLine(w: WikiSeasonReport): string {
  if (w.state !== "done") return `[${w.state}] ${w.reason ?? ""}`;
  const wrote = w.wrote === null ? "적재안함(불변식 위반)" : `지명 ${w.wrote.picks} · 입찰 ${w.wrote.bids}`;
  const held = w.deferred === null ? "" : ` · npb 우선 ${w.deferred.picks}/${w.deferred.bids}`;
  // ⚠**「사실」과 「표기」를 한 수로 접지 않는다** — 접으면 매일 붉고, 붉으면 아무도 안 읽는다
  const x3 = `X-3 사실 ${w.pickFact} · 표기 ${w.pickSpelling} / ${w.pickChecked}`;
  const x1 = w.bidChecked === 0 ? "X-1 안쟀음" : `X-1 사실 ${w.bidFact} · 표기 ${w.bidSpelling} / ${w.bidChecked}`;
  // ⚠**0 이면 안 적는다** — `done` 이면 언제나 잰 수라 「안 쟀음」과 섞일 일이 없다. 0 이 아닐 때만 눈에 띄게 붙인다
  const css = w.ignoredFontWeights.length === 0 ? "" : ` · ⚠무효 font-weight ${w.ignoredFontWeights.length}칸(굵게 읽음)`;
  return `열 ${w.columns}/12 (겹침 최소 ${w.minOverlap}) · ${wrote}${held} · ${x3} · ${x1} · ${invariantNote(w)}${css}`;
}

export interface WikiSummary {
  readonly targets: number;
  readonly done: number;
  readonly absent: number;
  readonly noGrid: number;
  /** ⚠**결함이 아니다**(M11 · [I-5]) — npb 를 아직 안 넣었을 뿐이라 종료코드를 안 올린다 */
  readonly noNpb: number;
  readonly failed: number;
  readonly picks: number;
  readonly bids: number;
  readonly events: number;
  readonly picksDeferred: number;
  readonly bidsDeferred: number;
  readonly invariantViolations: number;
  /**
   * 불변식 여섯의 **분모 합**(Minor-1). ⚠**「위반 0」이 「안 쟀음」인지 가르는 유일한 수다.**
   * ⚠**여섯을 더한 수라 그 자체는 뜻이 없다** — 0 인가 아닌가만 읽어라. 갈래별 분모는 시즌 줄에 있다.
   */
  readonly invariantChecked: number;
  /** 분모가 **0 으로 내려앉은** 검사가 있던 시즌. ⚠**위반 0 과 같은 칸에 세면 안 된다** */
  readonly invariantBlind: readonly number[];
  readonly pickChecked: number;
  readonly pickFact: number;
  readonly pickSpelling: number;
  readonly bidChecked: number;
  readonly bidFact: number;
  readonly bidSpelling: number;
  /** 무효 `font-weight` 를 선언 없음으로 읽은 칸의 합. ⚠종료코드는 안 올린다 — 세어서 찍는다 */
  readonly ignoredFontWeights: number;
}

/** ⚠**세는 규칙은 한 벌이다**(M1) — 화면과 종료코드가 갈릴 자리를 없앤다 */
export function summarizeWiki(reports: readonly WikiSeasonReport[]): WikiSummary {
  const by = (st: WikiSeasonReport["state"]): number => reports.filter((r) => r.state === st).length;
  const sum = (f: (r: WikiSeasonReport) => number): number => reports.reduce((a, r) => a + f(r), 0);
  return {
    targets: reports.length,
    done: by("done"),
    absent: by("absent"),
    noGrid: by("no-grid"),
    noNpb: by("no-npb"),
    failed: by("failed"),
    picks: sum((r) => r.wrote?.picks ?? 0),
    bids: sum((r) => r.wrote?.bids ?? 0),
    events: sum((r) => r.wrote?.events ?? 0),
    picksDeferred: sum((r) => r.deferred?.picks ?? 0),
    bidsDeferred: sum((r) => r.deferred?.bids ?? 0),
    invariantViolations: sum((r) => r.invariantViolations.length),
    invariantChecked: sum((r) =>
      r.invariantChecked === null ? 0 : Object.values(r.invariantChecked).reduce((a, v) => a + v, 0),
    ),
    invariantBlind: reports
      .filter((r) => r.invariantChecked !== null && Object.values(r.invariantChecked).some((v) => v === 0))
      .map((r) => r.season),
    pickChecked: sum((r) => r.pickChecked),
    pickFact: sum((r) => r.pickFact),
    pickSpelling: sum((r) => r.pickSpelling),
    bidChecked: sum((r) => r.bidChecked),
    bidFact: sum((r) => r.bidFact),
    bidSpelling: sum((r) => r.bidSpelling),
    ignoredFontWeights: sum((r) => r.ignoredFontWeights.length),
  };
}

/**
 * ⚠**진입점을 최상위에 두지 않는다.** 시험이 이 파일을 `import` 하는 순간 `parseArgs` 가
 * 돌아 `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` 로 죽는다(수집기 쪽에서 실측된 사고).
 * `scripts/access-config.ts` 와 같은 판정식을 쓴다.
 */
async function main(): Promise<void> {
  const { parseArgs } = await import("node:util");
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      only: { type: "string" },
    },
  });
  const [archiveRoot, dbPath] = positionals;
  if (archiveRoot === undefined || dbPath === undefined) {
    console.error(
      "usage: node tools/load-draft-archive.ts <archive-root> <db-path> [--from YYYY] [--to YYYY] [--only YYYY]",
    );
    process.exit(2);
  }

  /**
   * ⚠**연도가 아니면 멈춘다.** `Number("2O19")` 는 `NaN` 이고 `NaN` 과의 비교는 전부 false 라
   * **대상이 조용히 0시즌**이 된다 — 로그에는 「적재 0」만 남고 오타는 아무 데도 안 적힌다.
   */
  const year = (name: string, raw: string | undefined): number | null => {
    if (raw === undefined) return null;
    if (!/^\d{4}$/.test(raw)) {
      console.error(`--${name} 이 연도가 아니다: ${JSON.stringify(raw)}`);
      process.exit(2);
    }
    return Number(raw);
  };

  const all = await seasonsInArchive(archiveRoot);
  const from = year("from", values.from);
  const to = year("to", values.to);
  const only = year("only", values.only);
  // ⚠**섞어 쓰면 뜻이 갈린다.** 수집기(`DraftCollectOptions`)의 `only` 는 「범위 **안에서** 한 해」인데
  //   여기 `only` 는 아카이브 목록을 아예 건너뛴다(아래) — 조용히 다르게 동작하느니 거절한다.
  if (only !== null && (from !== null || to !== null)) {
    console.error("--only 와 --from/--to 를 함께 쓰지 마라 — 어느 쪽이 이기는지 이름이 말해 주지 않는다");
    process.exit(2);
  }
  /**
   * ⚠**`--only` 는 아카이브 목록을 거치지 않는다.** 거치면 그 해를 안 받았을 때
   * **대상 0시즌 · 종료코드 0** 이 되어 「없다」가 「했다」로 보인다. 그대로 넘겨서
   * `absent` 로 보고하게 한다 — 그게 「0건」과 「안 쟀음」의 구별이다(M11).
   */
  const targets = only !== null ? [only] : all.filter((y) => y >= (from ?? -Infinity) && y <= (to ?? Infinity));

  // 시계는 1회만 읽어 전체 적재에 같은 값을 쓴다(M6).
  // ⚠**「개최 후 미수집」의 오늘도 이 한 번에서 만든다** — 두 번 읽으면 자정 경계에서 날짜가 갈린다.
  const nowIso = new Date().toISOString();
  const todayJst = toJstDateString(new Date(nowIso));
  const db = openDb(dbPath, nowIso);
  const reports: SeasonLoadReport[] = [];
  const wiki: WikiSeasonReport[] = [];
  let warnings: string[] = [];
  try {
    for (const season of targets) {
      const r = await loadDraftSeason(db, season, { archiveRoot });
      reports.push(r);
      if (r.loaded) {
        /**
         * ⚠**무엇을 걸 수 있는지 찍는다**(A6·A14). 실 DB 불변식 검사 도구가 **아직 없어서**
         * **사람이 이 줄을 보고 판단한다** — 「전부 걸 수 있다」고 침묵하지 않는다.
         * ⚠제한된 시즌은 **이름을 그대로** 적는다. 「일부만」이라고 쓰면 어느 것인지 알 수 없다.
         */
        const inv = checkableInvariants(r);
        const invNote = inv.length === ALL_INVARIANTS.length ? `${inv.length}종 전부` : inv.join(",") || "없음";
        console.log(
          `${season}: 구단 ${r.teams} · 구획 ${r.events} · 지명 ${r.picks} · 입찰 ${r.bids}`
            + ` · 단독지명 ${r.soleNominations ?? "유도안함"}`
            + ` · 경합표기 ${r.sourceWritesBids === true ? "있음" : "없음"}`
            + ` · 검사가능 ${invNote}`
            + ` · ${heldOnNote(r.heldOn, r.heldOnError)}`,
        );
      } else {
        console.log(`${season}: 건너뜀 [${r.skipped?.kind}] ${r.skipped?.reason}`);
      }

      /**
       * ⚠**wikipedia 는 npb **뒤에** 돈다 — 순서가 뜻을 갖는다.**
       * 「npb 가 말한 자리는 건너뛴다」를 DB 를 읽어 판정하므로, npb 가 먼저 들어와 있어야 한다.
       * 뒤집으면 **같은 자리를 두 출처가 채우려다 PK 로 부딪치거나**, 더 나쁘게는
       * npb 적재가 wikipedia 행을 못 보고 지나쳐 **두 판이 한 표에 남는다.**
       */
      const w = await loadDraftWikiSeason(db, season, { archiveRoot });
      wiki.push(w);
      console.log(`${season}: wiki ${wikiLine(w)}`);
      for (const d of [...w.invariantViolations, ...w.pickDiffs, ...w.bidDiffs]) console.log(`    !! ${d}`);
      // ⚠**무효 굵기 칸은 하나하나 적는다** — 「몇 칸」만으로는 그 칸이 당첨인지 낙첨인지 사람이 못 맞춰 본다
      for (const c of w.ignoredFontWeights) console.log(`    ~~ [css] ${season} ${c} → 선언 없음(표의 bold 상속)으로 읽었다`);
    }
    // ⚠**지명을 다 넣은 뒤에 묻는다** — 적재 전에 물으면 이번 실행이 채운 해까지 「0행」으로 운다.
    warnings = await draftCollectionWarnings(db, archiveRoot, targets, todayJst);
  } finally {
    db.close();
  }

  // ⚠**분모를 적는다.** 「몇 시즌 중 몇 시즌」이 없으면 「0건」과 「안 쟀음」을 구별할 수 없다.
  // ⚠**세는 규칙은 `summarizeSeasons` 한 벌이다**(M1) — 화면과 종료코드가 갈릴 자리를 없앤다.
  const s = summarizeSeasons(reports);
  console.log(
    `\n대상 ${s.targets}시즌 / 아카이브 ${all.length}시즌 — 적재 ${s.loaded} ·`
      + ` 미수집 ${s.absent} · 출처없음 ${s.provenance} · 파싱실패 ${s.parse} ·`
      + ` 적재규칙 ${s.load} · ERROR ${s.error}`,
  );
  // ⚠**「무엇을 검사할 수 있는가」를 합계로도 적는다** — 21줄을 훑게 하지 않는다.
  // ⚠**적재가 0시즌이면 안 찍는다** — 「0시즌은 6종 전부」는 잰 것처럼 보이는 빈 문장이다(M11).
  if (s.loaded > 0) {
    const full = s.loaded - s.limited.length - s.incomplete.length;
    console.log(
      `검사: 적재 ${s.loaded}시즌 중 ${full}시즌은 ${ALL_INVARIANTS.length}종 전부 ·`
        + ` ${s.limited.length}시즌은 ${INV_WITHOUT_BIDS.join(",")} 만`
        + (s.limited.length > 0 ? `(${s.limited.join(",")})` : ""),
    );
  }
  if (s.incomplete.length > 0) {
    // ⚠**정상이 아니다.** 구단이 덜 들어온 시즌은 화면에서 「그 해는 원래 이렇다」로 읽힌다.
    console.log(
      `⚠구단이 덜 들어온 시즌 ${s.incomplete.length}개(${s.incomplete.join(",")})`
        + " — 불변식을 하나도 걸 수 없다. 아카이브가 불완전하니 그 해를 다시 받아라",
    );
  }
  /**
   * ⚠**개최일 「모름」을 합계로도 적는다**(2026-10-24). 그 구획은 `held_on` 이 NULL 인데,
   * 그건 「못 읽었다(M7)」가 아니라 **「연도 톱이 그 회의의 날짜를 안 적는다(M11)」**다 — 못 읽었으면 그 시즌은 `parse` 로 건너뛰었다.
   */
  // ⚠**못 읽은 시즌(M7)은 여기 넣지 않는다** — 그건 「모름」이 아니라 아래 ⚠ 줄이 따로 센다.
  const unknownHeld = reports
    .filter((r) => r.heldOnError === null)
    .flatMap((r) => (r.heldOn ?? []).filter((x) => x.date === null).map((x) => `${r.season} ${x.kind}`));
  if (unknownHeld.length > 0) {
    console.log(
      `개최일 모름 ${unknownHeld.length}구획(${unknownHeld.join(" · ")}) — 연도 톱이 그 회의의 날짜를 안 적는다(M11 · 런북 §2-1)`,
    );
  }
  if (s.heldOnFailed.length > 0) {
    /**
     * ⚠⚠**개최일을 못 읽었다 — 지명·입찰은 넣었고 `held_on` 만 NULL 이다**(2026-10-24 · 1차 검토 P2 (b)).
     * 곁가지 하나로 그 해 지명을 막지 않되 **조용하지도 않다** — 이 줄과 종료코드 1 이 M7 을 지킨다.
     */
    const rows = reports.filter((r) => r.heldOnError !== null).map((r) => `${r.season}(${r.heldOnError})`);
    console.log(
      `⚠개최일을 못 읽은 시즌 ${s.heldOnFailed.length}개 — 지명·입찰은 넣었고 held_on 만 NULL 이다.`
        + ` 연도 톱 모양이 바뀌었거나 자산이 불완전하다(M7 · 런북 §2-1): ${rows.join(" · ")}`,
    );
  }
  if (s.noBidsSource > 0) {
    // ⚠**B2 — 「데이터 없음」이 아니다.** 경합은 실제로 있었고 소스가 그걸 안 적는 것뿐이다.
    console.log(
      `⚠경합 없는 소스 ${s.noBidsSource}시즌 — 그 시즌 draft_bid 가 0행인 것이 **정상**이다`
        + "(「데이터 없음」이 아니라 「소스가 안 쓴다」)",
    );
  }
  if (s.load > 0) {
    // ⚠**A7 — 재시도로 안 풀린다**(입력이 같으면 같은 예외). 다시 돌리라고 안내하지 않는다.
    console.log("⚠[load] 는 재시도로 풀리지 않는다 — 입력이 규칙에 안 맞는 것이라 사람이 봐야 한다");
  }
  if (s.yielded.length > 0) {
    /**
     * ⚠**[C1] — 정상 동작이지만 조용하면 안 된다.** npb 가 그 자리를 실제로 채웠으므로
     * 다른 출처(wikipedia)의 행이 비켜섰다. **그 시즌 화면의 CC BY-SA 고지가 사라진다**는 뜻이고,
     * 아래 wikipedia 줄의 「npb 우선」 수도 그만큼 움직인다.
     */
    const rows = reports
      .filter((r) => (r.yielded?.picks ?? 0) + (r.yielded?.bids ?? 0) > 0)
      .map((r) => `${r.season}(지명 ${r.yielded!.picks}·입찰 ${r.yielded!.bids})`);
    console.log(
      `⚠npb 가 자리를 채워 다른 출처를 비켜세운 시즌 ${s.yielded.length}개: ${rows.join(" · ")}`
        + " — 규칙대로지만(공식 > 커뮤니티) 그 시즌의 CC BY-SA 행이 npb 것으로 바뀌었다(런북 §8-1)",
    );
  }
  const w = summarizeWiki(wiki);
  // ⚠**wikipedia 줄을 npb 줄과 섞지 않는다** — 같은 표에 들어가지만 **다른 소스이고 다른 규칙**이다.
  console.log(
    `\nwikipedia: 대상 ${w.targets}시즌 — 읽음 ${w.done} · 미수집 ${w.absent} ·`
      + ` 미개최 ${w.noGrid} · npb대기 ${w.noNpb} · 실패 ${w.failed}`,
  );
  if (w.noNpb > 0) {
    // ⚠**[I-5] 결함이 아니다.** 수집이 두 명령이라 순서가 갈릴 수 있고, 그때는 npb 를 넣으면 풀린다.
    console.log(
      `⚠npb 지명이 아직 없는 시즌 ${w.noNpb}개 — wikipedia 열을 구단에 맞출 근거가 없어 건너뛴다.`
        + " **실패가 아니라 순서다**(런북 §8-4: npb 를 먼저 넣는다)",
    );
  }
  if (w.done > 0) {
    console.log(
      `  적재: 지명 ${w.picks} · 입찰 ${w.bids} · 회의 ${w.events}`
        + ` (npb 가 말해서 안 넣은 것: 지명 ${w.picksDeferred} · 입찰 ${w.bidsDeferred})`,
    );
    // ⚠**분모 없이 「불일치 0」이라고 쓰지 않는다.** 「0건」과 「안 쟀음」은 다른 말이다.
    // ⚠**「사실」과 「표기」를 따로 센다** — 종료코드가 반응하는 것은 앞쪽뿐이다.
    // ⚠**INV 도 분모와 함께 적는다**(Minor-1) — 「위반 0」만으로는 「안 쟀음」과 구별되지 않는다.
    console.log(
      `  대조: INV 위반 ${w.invariantViolations} / 분모 ${w.invariantChecked}`
        + ` · X-3 사실 ${w.pickFact} · 표기 ${w.pickSpelling} / ${w.pickChecked}`
        + ` · X-1 사실 ${w.bidFact} · 표기 ${w.bidSpelling} / ${w.bidChecked}`
        + (w.bidChecked === 0 ? " ⚠X-1 은 **안 쟀다**(이 범위에 npb 경합 문장이 없다)" : ""),
    );
    if (w.invariantBlind.length > 0) {
      /**
       * ⚠**분모가 0 인 검사는 「통과」가 아니라 「안 쟀음」이다**(M11 · 런북 §7 의 `assertClean`).
       * 파서가 어느 구획의 색을 통째로 못 읽으면 정확히 이 모양이 되고, **위반도 0 이라 초록으로 보인다.**
       */
      console.log(
        `⚠분모가 0 인 불변식이 있는 시즌 ${w.invariantBlind.length}개(${w.invariantBlind.join(",")})`
          + " — 그 검사는 **통과한 것이 아니라 안 쟀다**. 시즌 줄의 `⚠분모0:` 이 어느 것인지 말한다",
      );
    }
    if (w.pickSpelling > 0 || w.bidSpelling > 0) {
      /**
       * ⚠**표기 차는 결함이 아니지만 「없는 것」도 아니다**(M10). 이체자(`髙/高`·`﨑/崎`)와
       * 등록명 축약이고, **정규화 넷 다 못 붙인다**(실측). 우리는 두 소스를 **이름으로 잇지 않으므로**
       * 값이 틀리지는 않는다 — 그래도 **수가 움직이면 사람이 봐야 한다.**
       */
      console.log(
        `⚠표기 차 ${w.pickSpelling + w.bidSpelling}건 — 이체자·등록명 축약이다(M10).`
          + " 값에는 영향이 없지만 **수가 바뀌면 무엇이 바뀐 것인지 확인해라**(런북 §8)",
      );
    }
  }
  if (w.ignoredFontWeights > 0) {
    /**
     * ⚠**실패가 아니지만 조용하면 안 된다**(2026-10-24 · 규칙표 §3). CSS 에 없는 값(`heavy`)은 브라우저가 버리므로
     * 그 칸은 표의 `bold` 를 물려받아 굵게 보이고, 우리도 그렇게 읽었다. **그해 편집자가 스타일을 새로 썼다**는 뜻이라
     * 연도마다 사람이 규칙을 확인할 때(규칙표 §11 조건 1) 이 줄을 본다.
     */
    console.log(
      `⚠무효 font-weight ${w.ignoredFontWeights}칸 — CSS 에 없는 값이라 선언이 없는 칸(굵게 = 당첨)으로 읽었다.`
        + " 시즌 줄 아래 `~~ [css]` 가 어느 칸인지 말한다(규칙표 §3 · 런북 §8-7)",
    );
  }
  if (w.failed > 0) {
    console.log("⚠wikipedia 실패는 재시도로 안 풀릴 수 있다 — 규칙이 바뀐 것이면 사람이 봐야 한다(M7)");
  }
  /**
   * ⚠⚠**「개최 후 미수집」 — 배포를 막지 않는다**(2026-10-24). 종료코드를 안 올리고 워크플로 주석으로만 올린다:
   * 드래프트는 연 1회 바뀌고 어제 값이 그대로 나가므로 **그날 사이트를 막을 이유가 없다.** 그래도 조용하면
   * 그 해 화면이 「まだ収集していません」인 채로 계속 나간다 — **에러가 아니라 빈 칸**이라 아무도 결함으로 못 읽는다.
   */
  for (const line of warnings) console.log(`::warning::${line}`);
  /**
   * ⚠⚠**위의 npb 줄이 「검사가능 INV-N2」라고 말한 시즌에 이제 입찰이 있다.**
   * `checkableInvariants` 는 **npb 적재 보고**만 보므로 그 줄은 여전히 「npb 는 경합을 안 쓴다」를
   * 말한다 — 그건 참이지만, **DB 의 `draft_bid` 는 더 이상 0행이 아니다.**
   * 두 문장을 나란히 두지 않으면 다음 사람이 런북 §3 의 A14 를 그대로 믿고
   * 「이 시즌은 INV-N2 밖에 못 건다」고 읽는다.
   */
  const filled = wiki.filter((r) => (r.wrote?.bids ?? 0) > 0).map((r) => r.season);
  if (filled.length > 0) {
    console.log(
      `⚠wikipedia 가 입찰을 채운 시즌 ${filled.length}개(${filled.join(",")}) —`
        + " 위 npb 줄의 「검사가능」은 **npb 기준**이다. 그 시즌 draft_bid 는 이제 0행이 아니다",
    );
  }
  /**
   * ⚠**대조 불일치와 불변식 위반이 종료코드를 올린다.** 그것이 채택 게이트(`G-A`·`G-B`·`G-C`)이고,
   * 조용해지면 **색을 잘못 읽어도 아무도 모른 채** 화면에 나간다.
   * ⚠**`absent`·`no-grid`·`no-npb` 는 올리지 않는다**(M11) — 자산이 아직 없는 것 · 개최 전 ·
   * **npb 가 아직 안 들어온 것**은 결함이 아니다([I-5]). 셋 다 「다음 실행에서 저절로 풀리는」 모양이고,
   * 그걸로 붉히면 **헛불이 일상이 되어 진짜 위반도 안 읽힌다.**
   */
  // ⚠**`spelling` 은 종료코드를 안 올린다** — 위 주석의 그 이유다. 올리는 것은 `fact` 뿐이다.
  const wikiBad = w.failed > 0 || w.invariantViolations > 0 || w.pickFact > 0 || w.bidFact > 0;
  // ⚠**`absent` 는 결함이 아니다**(M11) — 그것만으로는 종료코드를 올리지 않는다.
  process.exitCode = s.exitCode === 1 || wikiBad ? 1 : 0;
}

const entry = process.argv[1];
if (entry !== undefined) {
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url === pathToFileURL(entry).href) await main();
}
