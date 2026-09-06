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
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { BACKNUMBER_KEY, draftWikiKey, teamPageKey, yearIndexKey } from "@bb-app/archiver";
import {
  DraftParseError,
  DraftWikiParseError,
  checkDraftWikiInvariants,
  normalizePlayerName,
  parseDraftBids,
  parseDraftPicks,
  parseDraftWiki,
} from "@bb-app/parser";
import type { DraftBidRow, DraftPickRow, DraftWikiParse } from "@bb-app/parser";
import { openDb } from "../src/db.ts";
import type { Db } from "../src/db.ts";
import { DraftLoadError, loadDraft } from "../src/draft.ts";
import type { DraftProvenance } from "../src/draft.ts";
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

/**
 * 리허설 DB 의 마이그레이션 시각. ⚠**버려지는 DB 라 아무도 안 읽는다** —
 * 그래서 여기서 시계를 읽지 않는다(M6). 진짜 시계는 아래 CLI 진입점에서 한 번만 읽는다.
 */
const REHEARSAL_NOW = "1970-01-01T00:00:00.000Z";

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
  /** 연도 톱(`/draft/{YYYY}/`) — **회의 행(`draft_event`)**의 출처다([I3]) */
  readonly event: DraftProvenance;
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

  const event = await provenanceOf(archiveRoot, indexKey, `${season}/${indexSlug}`);

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
}

function applyPages(db: Db, season: number, sp: SeasonPages, decision: BidsDecision): SeasonLoadCounts {
  let picks = 0;
  let bids = 0;
  let soles = 0;
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
  }
  return {
    teams: sp.pages.length,
    events: new Set(sp.pages.flatMap((p) => p.picks.map((x) => x.kind))).size,
    picks,
    bids,
    soleNominations: decision.sourceWritesBids ? soles : null,
    sourceWritesBids: decision.sourceWritesBids,
  };
}

/**
 * 시즌 전체를 넣는다 — **전부 아니면 아무것도 아니다**(G3).
 *
 * ⚠⚠**먼저 버릴 DB 에 리허설한다.** 이유는 취향이 아니라 **막다른 골목**이다:
 * `loadDraft` 가 스스로 `db.transaction`(`BEGIN`/`COMMIT`)을 열기 때문에 **바깥에서 한 번 더
 * 묶을 수 없다** — 실측하면 `transaction` 안에서도 `savepoint` 안에서도
 * `cannot start a transaction within a transaction` 으로 죽는다(2026-09-05).
 * 즉 구단마다 커밋이 떨어지고, **k번째 구단에서 던지면 앞의 k−1 구단이 남는다.**
 *
 * ⚠**그것이 정확히 A7 이 밟는 자리다.** 2005~2007 分離ドラフト에서 `firstRoundPick` 이 던지는
 * `DraftLoadError` 는 **파싱이 다 끝난 뒤 `loadDraft` 안에서** 나온다 — 브리프 초판의 구조는
 * 그 예외를 `readTeamPages` 의 `try` 밖에서 맞아 **시즌을 반쯤 적재한 채 죽는다.**
 * 부분 적재는 화면에서 「그 해는 원래 그렇다」로 읽힌다(2018 오릭스 `bs` 사고와 같은 모양).
 *
 * ⚠**리허설은 같은 `loadDraft` 를 쓴다**(M1). 판정 규칙을 여기서 베껴 쓰면 두 벌이 되고,
 * 한쪽만 고쳐진 날 리허설이 **통과시키는 쪽**으로 틀린다.
 * ⚠**비용은 쟀다**: `openDb(":memory:")` = 마이그레이션 20본에 **약 61ms**(10회 611.5ms 실측).
 * 시즌당 한 번이므로 26시즌이면 약 1.6초다.
 *
 * ⚠**리허설이 못 잡는 것 하나**: 리허설 DB 는 **비어 있으므로**, 이미 들어 있는
 * **다른 `origin`** 의 행과 PK 가 부딪히는 경우는 진짜 DB 에서만 터진다.
 * 지금 `origin` 은 `'npb'` 고정이라 그 경로가 없지만, **wikipedia 적재를 붙이는 날 이 문단을 다시 읽어라.**
 *
 * @throws {DraftLoadError} 입력이 적재 규칙에 안 맞을 때. ⚠**진짜 DB 는 안 건드린 상태다**
 */
export function loadSeasonPages(db: Db, season: number, sp: SeasonPages): SeasonLoadCounts {
  const decision = decideBids(sp.pages);

  const rehearsal = openDb(":memory:", REHEARSAL_NOW);
  try {
    applyPages(rehearsal, season, sp, decision);
  } finally {
    rehearsal.close();
  }

  return applyPages(db, season, sp, decision);
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
  readonly skipped: SeasonSkip | null;
  /**
   * ⚠**소스가 경합을 쓰는 시즌인가.** 화면이 「데이터 없음」으로 그리면 거짓이다(B2).
   *
   * ⚠**`null` 은 「판정 안 했다」**이고 `false` 는 「소스가 안 쓴다」다(M11).
   * 브리프 초판은 건너뛴 시즌에도 `false` 를 넣었는데, **그건 이 태스크가 막으려는 바로 그 혼동**이다.
   */
  readonly sourceWritesBids: boolean | null;
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
    // ⚠**둘 다 `null` 이다** — 0 이라고 쓰면 「재 봤더니 0」이 된다(M11)
    soleNominations: null,
    skipped: skip,
    sourceWritesBids: null,
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
      skipped: null,
      sourceWritesBids: n.sourceWritesBids,
    };
  } catch (err) {
    return skipped(season, classify(err));
  }
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
  /** ⚠**`absent` 는 「아카이브에 그 해가 없다」**이지 결함이 아니다(M11) */
  readonly state: "absent" | "no-grid" | "done" | "failed";
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

  try {
    const inv = checkDraftWikiInvariants(parsed);

    // ── 열 ↔ 구단 ──
    const namesByColumn = parsed.grid.columns.map(
      (_, c) => new Set(parsed.picks.filter((p) => p.columnIndex === c).map((p) => normalizePlayerName(p.nameDisplay))),
    );
    const matches = resolveDraftWikiColumns(season, parsed.grid.columns, namesByColumn, npbNamesBySeason(db, season));
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
    exitCode: bad > 0 ? 1 : 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

/** 한 시즌 wikipedia 결과 한 줄. ⚠**「안 쟀음」을 「0건」으로 적지 않는다**(M11) */
export function wikiLine(w: WikiSeasonReport): string {
  if (w.state !== "done") return `[${w.state}] ${w.reason ?? ""}`;
  const wrote = w.wrote === null ? "적재안함(불변식 위반)" : `지명 ${w.wrote.picks} · 입찰 ${w.wrote.bids}`;
  const held = w.deferred === null ? "" : ` · npb 우선 ${w.deferred.picks}/${w.deferred.bids}`;
  // ⚠**「사실」과 「표기」를 한 수로 접지 않는다** — 접으면 매일 붉고, 붉으면 아무도 안 읽는다
  const x3 = `X-3 사실 ${w.pickFact} · 표기 ${w.pickSpelling} / ${w.pickChecked}`;
  const x1 = w.bidChecked === 0 ? "X-1 안쟀음" : `X-1 사실 ${w.bidFact} · 표기 ${w.bidSpelling} / ${w.bidChecked}`;
  return `열 ${w.columns}/12 (겹침 최소 ${w.minOverlap}) · ${wrote}${held} · ${x3} · ${x1} · INV 위반 ${w.invariantViolations.length}`;
}

export interface WikiSummary {
  readonly targets: number;
  readonly done: number;
  readonly absent: number;
  readonly noGrid: number;
  readonly failed: number;
  readonly picks: number;
  readonly bids: number;
  readonly events: number;
  readonly picksDeferred: number;
  readonly bidsDeferred: number;
  readonly invariantViolations: number;
  readonly pickChecked: number;
  readonly pickFact: number;
  readonly pickSpelling: number;
  readonly bidChecked: number;
  readonly bidFact: number;
  readonly bidSpelling: number;
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
    failed: by("failed"),
    picks: sum((r) => r.wrote?.picks ?? 0),
    bids: sum((r) => r.wrote?.bids ?? 0),
    events: sum((r) => r.wrote?.events ?? 0),
    picksDeferred: sum((r) => r.deferred?.picks ?? 0),
    bidsDeferred: sum((r) => r.deferred?.bids ?? 0),
    invariantViolations: sum((r) => r.invariantViolations.length),
    pickChecked: sum((r) => r.pickChecked),
    pickFact: sum((r) => r.pickFact),
    pickSpelling: sum((r) => r.pickSpelling),
    bidChecked: sum((r) => r.bidChecked),
    bidFact: sum((r) => r.bidFact),
    bidSpelling: sum((r) => r.bidSpelling),
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
  const db = openDb(dbPath, new Date().toISOString());
  const reports: SeasonLoadReport[] = [];
  const wiki: WikiSeasonReport[] = [];
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
            + ` · 검사가능 ${invNote}`,
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
    }
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
  const w = summarizeWiki(wiki);
  // ⚠**wikipedia 줄을 npb 줄과 섞지 않는다** — 같은 표에 들어가지만 **다른 소스이고 다른 규칙**이다.
  console.log(
    `\nwikipedia: 대상 ${w.targets}시즌 — 읽음 ${w.done} · 미수집 ${w.absent} ·`
      + ` 미개최 ${w.noGrid} · 실패 ${w.failed}`,
  );
  if (w.done > 0) {
    console.log(
      `  적재: 지명 ${w.picks} · 입찰 ${w.bids} · 회의 ${w.events}`
        + ` (npb 가 말해서 안 넣은 것: 지명 ${w.picksDeferred} · 입찰 ${w.bidsDeferred})`,
    );
    // ⚠**분모 없이 「불일치 0」이라고 쓰지 않는다.** 「0건」과 「안 쟀음」은 다른 말이다.
    // ⚠**「사실」과 「표기」를 따로 센다** — 종료코드가 반응하는 것은 앞쪽뿐이다.
    console.log(
      `  대조: INV 위반 ${w.invariantViolations}`
        + ` · X-3 사실 ${w.pickFact} · 표기 ${w.pickSpelling} / ${w.pickChecked}`
        + ` · X-1 사실 ${w.bidFact} · 표기 ${w.bidSpelling} / ${w.bidChecked}`
        + (w.bidChecked === 0 ? " ⚠X-1 은 **안 쟀다**(이 범위에 npb 경합 문장이 없다)" : ""),
    );
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
  if (w.failed > 0) {
    console.log("⚠wikipedia 실패는 재시도로 안 풀릴 수 있다 — 규칙이 바뀐 것이면 사람이 봐야 한다(M7)");
  }
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
   * ⚠**`absent`·`no-grid` 는 올리지 않는다**(M11) — 자산이 아직 없는 것과 개최 전은 결함이 아니다.
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
