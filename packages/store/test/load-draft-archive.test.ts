/**
 * 드래프트 적재 — 아카이브 HTML → DB.
 *
 * ⚠**시즌 단위로 모아서 판정한다.** 구단 하나만 보면
 * 「소스가 경합을 안 쓴다」와 「이 구단은 안 겹쳤다」를 구별할 수 없다(A2) —
 * **2019 히로시마도 `※` 0건**이다(픽스처 실측).
 *
 * ⚠**여기 쓰는 수는 지어낸 것이 아니라 픽스처를 파서에 통과시켜 잰 값이다**(2026-09-05):
 * `draft-2019-list-c` = 지명 9 · 경합 0 · 1巡目 `shihaika/森下 暢仁` ·
 * `draft-2019-list-g` = 지명 8 · 경합 2(둘 다 낙첨) · 1巡目 `shihaika/堀田 賢慎`.
 *
 * ⚠**「적재 안 했다」를 `loaded === false` 로만 재지 마라.** 그건 **보고서**가 뭐라고
 * 말하는지를 잴 뿐이다. 이 파일의 실패 시험들은 전부 **DB 행 수 0**까지 확인한다 —
 * 부분 적재는 화면에서 「그 해는 원래 그렇다」로 읽히고, 그게 이 도메인에서 가장 비싼 실패다(G3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { teamPageKey, yearIndexKey } from "@bb-app/archiver";
import type { BlobMeta } from "@bb-app/archiver";
import type { DraftBidRow, DraftKind, DraftPickRow } from "@bb-app/parser";
import { openDb, type Db } from "../src/db.ts";
import { DraftLoadError } from "../src/draft.ts";
import {
  checkableInvariants,
  decideBids,
  loadDraftSeason,
  loadSeasonPages,
  seasonsInArchive,
  summarizeSeasons,
  type SeasonLoadReport,
  type TeamPage,
  type TeamPageWithMeta,
} from "../tools/load-draft-archive.ts";

// ── 픽스처 ────────────────────────────────────────────────────────────────
/**
 * ⚠**픽스처는 파서 패키지가 소유한다**(`packages/parser/test/fixtures/README.md` 에 출처·취득일).
 * `packages/archiver/test/draft-collect.test.ts` 와 같은 방식으로 빌려 쓴다 — 사본을 만들지 않는다(M1).
 */
function fixture(name: string): string {
  const p = fileURLToPath(new URL(`../../parser/test/fixtures/${name}.html.gz`, import.meta.url));
  return gunzipSync(readFileSync(p)).toString("utf8");
}

// ── 아카이브 만들기 ────────────────────────────────────────────────────────
/**
 * ⚠**키는 `@bb-app/archiver` 에서 가져온다**(M1). 여기에 `npb/draft/{year}/{slug}` 를
 * 손으로 적으면 수집기가 키를 바꾼 날 **시험만 옛 규칙으로 조용히 초록**이 된다.
 * 확장자 두 벌(`.html.gz`·`.meta.json`)은 `LocalSink` 의 배치이고 적재 도구도 같은 것을 쓴다.
 */
async function writeBlob(
  root: string,
  key: string,
  body: string | null,
  meta: BlobMeta | null,
): Promise<void> {
  const p = join(root, key);
  await mkdir(dirname(p), { recursive: true });
  if (body !== null) await writeFile(`${p}.html.gz`, gzipSync(Buffer.from(body, "utf8")));
  if (meta !== null) await writeFile(`${p}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
}

/** 실물 사이드카와 **같은 모양**이다(`data/archive/npb/games/2018/schedule_03.meta.json` 실측). */
function meta(url: string, over: Partial<BlobMeta> = {}): BlobMeta {
  return {
    url,
    fetchedAt: "2026-09-01T00:00:00.000Z",
    lastModified: null,
    etag: null,
    status: 200,
    sha256: "0".repeat(64),
    byteLength: 1,
    // ⚠**숫자다.** `BlobMeta.revision` 은 「몇 번째로 내용이 바뀌었나」의 카운터다
    revision: 1,
    ...over,
  };
}

const IDX_URL = "https://draft.npb.jp/draft/2019/";
const C_URL = "https://draft.npb.jp/draft/2019/draftlist_c.html";
const G_URL = "https://draft.npb.jp/draft/2019/draftlist_g.html";

/** 2019 = 「소스가 경합을 쓴 시즌」의 실물. `c` 는 0건이고 `g` 는 2건(둘 다 낙첨)이다 */
async function archive2019(opts: { cMeta?: boolean; gBody?: string; idxMeta?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-draft-arc-"));
  await writeBlob(
    root,
    yearIndexKey(2019),
    "<html>index</html>",
    opts.idxMeta === false ? null : meta(IDX_URL, { sha256: "idx".padEnd(64, "0"), checkedAt: "2026-09-03T00:00:00.000Z" }),
  );
  await writeBlob(
    root,
    teamPageKey(2019, "c"),
    fixture("draft-2019-list-c"),
    opts.cMeta === false ? null : meta(C_URL, { sha256: "csha".padEnd(64, "0"), checkedAt: "2026-09-04T00:00:00.000Z" }),
  );
  await writeBlob(
    root,
    teamPageKey(2019, "g"),
    opts.gBody ?? fixture("draft-2019-list-g"),
    meta(G_URL, { sha256: "gsha".padEnd(64, "0") }),
  );
  return root;
}

async function withDb(fn: (db: Db) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-db-"));
  const db = openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function rows(db: Db, table: string): Record<string, unknown>[] {
  return db.raw.prepare(`SELECT * FROM ${table} ORDER BY 1, 2, 3, 4`).all() as unknown as Record<
    string,
    unknown
  >[];
}

function count(db: Db, table: string): number {
  return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/**
 * 보고서 한 장. ⚠**`as never` 로 뚫지 않는다** — 브리프 초판이 그렇게 썼는데,
 * 그러면 `skipped` 가 `string` 에서 `{kind, reason}` 으로 바뀐 것을 **시험이 못 잡는다.**
 * 기본값은 「적재된 평범한 시즌」이고 필요한 칸만 덮어쓴다.
 */
function report(over: Partial<SeasonLoadReport> = {}): SeasonLoadReport {
  return {
    season: 2019,
    loaded: true,
    teams: 12,
    events: 2,
    picks: 107,
    bids: 21,
    soleNominations: 7,
    skipped: null,
    sourceWritesBids: true,
    ...over,
  };
}

function pick(team: string, kind: DraftKind, roundNo: number | null, nameDisplay: string): DraftPickRow {
  return { team, kind, roundNo, waiverDir: null, nameDisplay, position: null, fromOrg: null };
}

/** ⚠**`kind` 를 `null` 로 낸다** — 「소스가 이 주석을 어느 `<h4>` 안에도 안 넣었다」이고,
 *  그때만 적재가 지명 표에서 구획을 유도한다(`store/src/draft.ts` `firstRoundPick`). */
function bid(team: string, roundNo: number, rivals: string[], nameDisplay: string | null, won: boolean): DraftBidRow {
  return { team, kind: null, roundNo, rivals, nameDisplay, won };
}

const PROV = { source: "https://draft.npb.jp/draft/2019/", fetchedAt: "2026-09-05T00:00:00.000Z", revision: "h" };

function page(team: string, picks: DraftPickRow[], bids: DraftBidRow[]): TeamPageWithMeta {
  return { team, picks, bids, source: `${PROV.source}draftlist_${team}.html`, fetchedAt: PROV.fetchedAt, revision: `r-${team}` };
}

// ── A2·A12·G2 — 시즌 단위 판정 ─────────────────────────────────────────────

test("⚠시즌 전 구단에 경합이 0건이면 bids 는 null 이다 — 「소스가 안 쓴다」(A2)", () => {
  const pages: TeamPage[] = [
    { team: "c", picks: [], bids: [] },
    { team: "h", picks: [], bids: [] },
  ];
  const d = decideBids(pages);
  assert.equal(d.sourceWritesBids, false, "한 구단도 경합을 안 적었다");
  assert.equal(d.forTeam("c"), null, "⚠null 이다 — [] 로 주면 단독지명이 유도된다");
  assert.equal(d.forTeam("h"), null);
});

test("⚠한 구단이라도 경합을 적었으면 나머지는 [] 다 — 「안 겹쳤다」(M11)", () => {
  const pages: TeamPage[] = [
    { team: "s", picks: [], bids: [bid("s", 1, ["読売"], "X", true)] },
    { team: "c", picks: [], bids: [] },
  ];
  const d = decideBids(pages);
  assert.equal(d.sourceWritesBids, true);
  assert.deepEqual(d.forTeam("c"), [], "⚠null 이 아니다 — 히로시마는 진짜로 안 겹친 것이다");
  assert.equal(d.forTeam("s")?.length, 1);
});

test("⚠G2 — 0건인데 null 판정을 안 하면 그 자체가 결함이다", () => {
  const d = decideBids([{ team: "c", picks: [], bids: [] }]);
  assert.equal(d.sourceWritesBids, false);
  assert.equal(d.forTeam("c"), null, "판정이 자동으로 따라온다 — 호출자가 잊을 수 없다");
});

test("⚠빈 시즌(구단 0장)은 판정 대상이 아니다 — 「안 쟀음」과 「0건」을 구별한다(M11)", () => {
  assert.throws(() => decideBids([]), /구단 페이지가 0장/);
});

test("⚠모르는 구단을 물으면 던진다 — 조용히 [] 를 주면 없는 구단에 단독지명이 유도된다", () => {
  const d = decideBids([{ team: "s", picks: [], bids: [bid("s", 1, ["読売"], "X", true)] }]);
  assert.throws(() => d.forTeam("zz"), /zz/);
});

// ── 실물 픽스처로 끝까지 ────────────────────────────────────────────────────

test("⚠2019 실물 2장 — c 는 [] 라 단독지명이 유도되고, g 는 낙첨 2건 뒤에 유도된다", async () => {
  const root = await archive2019();
  try {
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.equal(r.skipped, null, `건너뛰었다: ${JSON.stringify(r.skipped)}`);
      assert.equal(r.loaded, true);
      assert.equal(r.teams, 2, "구단 2장");
      assert.equal(r.sourceWritesBids, true, "g 가 경합을 적었다");
      assert.equal(r.picks, 17, "9(c) + 8(g) — 픽스처 실측");
      assert.equal(r.soleNominations, 2, "c 森下 · g 堀田 — 둘 다 여집합에서 나온다");

      // c: 경합이 0건이어도 `[]` 를 받았으므로 1巡目이 단독지명이 된다
      const c = db.raw
        .prepare("SELECT round_no, won, rivals, name_display FROM draft_bid WHERE team = 'c'")
        .all() as unknown as { round_no: number; won: number | null; rivals: string | null; name_display: string }[];
      assert.equal(c.length, 1, "c 의 입찰 행");
      assert.equal(c[0]?.name_display, "森下 暢仁");
      assert.equal(c[0]?.won, null, "⚠단독지명은 NULL 이다 — 0(낙첨)도 1(당첨)도 아니다");
      assert.equal(c[0]?.rivals, null, "⚠주석 자체가 없다 — `[]` 가 아니다(M11)");
      assert.equal(c[0]?.round_no, 1, "낙첨이 없으니 첫 회차다");

      // g: 낙첨 2건 + 그 다음 회차의 단독지명
      const g = db.raw
        .prepare("SELECT round_no, won, name_display FROM draft_bid WHERE team = 'g' ORDER BY round_no")
        .all() as unknown as { round_no: number; won: number | null; name_display: string }[];
      assert.deepEqual(
        g.map((x) => `${x.round_no}/${x.won}/${x.name_display}`),
        ["1/0/奥川恭伸", "2/0/宮川哲", "3/null/堀田 賢慎"],
        "⚠堀田 는 주석에 한 줄도 없다 — 「이긴 입찰이 없다」에서 유도된 것이다",
      );
      assert.equal(count(db, "draft_pick"), 17);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── M4 — 출처는 사이드카에서 온다 ───────────────────────────────────────────

test("⚠M4 — source·fetched_at·revision 이 전부 사이드카에서 온다(적재 시각이 아니다)", async () => {
  const root = await archive2019();
  try {
    await withDb(async (db) => {
      await loadDraftSeason(db, 2019, { archiveRoot: root });

      const c = db.raw
        .prepare("SELECT DISTINCT source, fetched_at, revision FROM draft_pick WHERE team = 'c'")
        .all() as unknown as { source: string; fetched_at: string; revision: string }[];
      assert.equal(c.length, 1, "한 구단의 행은 출처가 하나다");
      assert.equal(c[0]?.source, C_URL, "⚠URL 을 템플릿으로 짓지 않고 사이드카가 적은 것을 쓴다");
      assert.equal(
        c[0]?.fetched_at,
        "2026-09-04T00:00:00.000Z",
        "⚠`checkedAt`(마지막으로 본 시각)이 이긴다 — `fetchedAt` 은 「마지막으로 바뀐」 시각이다",
      );
      assert.equal(c[0]?.revision, "csha".padEnd(64, "0"), "⚠판은 본문 해시다(019 마이그레이션이 그렇게 정의한다)");

      const g = db.raw
        .prepare("SELECT DISTINCT source, fetched_at FROM draft_pick WHERE team = 'g'")
        .all() as unknown as { source: string; fetched_at: string }[];
      assert.equal(g[0]?.source, G_URL, "구단마다 자기 페이지를 가리킨다");
      assert.equal(g[0]?.fetched_at, "2026-09-01T00:00:00.000Z", "`checkedAt` 이 없으면 `fetchedAt` 으로 떨어진다");

      // ⚠**회의 행은 연도 톱이 출처다**([I3]) — 구단 페이지로 덮이면 12구단 중 11구단분이 거짓이 된다
      const ev = db.raw
        .prepare("SELECT DISTINCT source, fetched_at, revision FROM draft_event")
        .all() as unknown as { source: string; fetched_at: string; revision: string }[];
      assert.equal(ev.length, 1);
      assert.equal(ev[0]?.source, IDX_URL, "⚠구단 페이지가 아니라 연도 톱이다");
      assert.equal(ev[0]?.revision, "idx".padEnd(64, "0"));
      assert.equal(ev[0]?.fetched_at, "2026-09-03T00:00:00.000Z");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("⚠M4 — 구단 사이드카가 없으면 그 시즌을 통째로 안 넣는다(행 0)", async () => {
  const root = await archive2019({ cMeta: false });
  try {
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.equal(r.loaded, false, "적재하지 않았다");
      assert.equal(r.skipped?.kind, "provenance", "⚠재시도로 풀리는 갈래다 — parse·load 와 섞지 마라");
      assert.match(r.skipped?.reason ?? "", /사이드카|출처/);
      assert.equal(
        r.sourceWritesBids,
        null,
        "⚠`false` 가 아니다 — 판정을 안 한 것과 「소스가 안 쓴다」는 다른 사실이다(M11)",
      );
      assert.equal(count(db, "draft_pick"), 0, "⚠g 는 멀쩡했지만 넣지 않았다 — 부분 적재 금지(G3)");
      assert.equal(count(db, "draft_event"), 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("⚠M4 — 연도 톱 사이드카가 없으면 회의 행의 출처를 말할 수 없다(행 0)", async () => {
  const root = await archive2019({ idxMeta: false });
  try {
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.equal(r.loaded, false);
      assert.equal(r.skipped?.kind, "provenance");
      assert.equal(count(db, "draft_pick"), 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── G3 — 한 건이 깨지면 시즌 전체를 안 넣는다 ────────────────────────────────

test("⚠G3 — 구단 한 장이 파싱 실패면 멀쩡한 구단도 안 넣는다(행 0)", async () => {
  const root = await archive2019({ gBody: "<html><body>드래프트가 아닌 페이지</body></html>" });
  try {
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.equal(r.loaded, false);
      assert.equal(r.skipped?.kind, "parse", "⚠M7 — 구조가 바뀐 것이지 재시도할 것이 아니다");
      assert.equal(count(db, "draft_pick"), 0, "⚠c 는 파싱에 성공했지만 넣지 않았다");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * ⚠**A7 — 2005~2007 分離ドラフト.** 한 구단이 `koukousei` 와 `daigaku_shakaijin` 양쪽에
 * 1巡目을 가질 수 있는데, 경합 주석이 있으면 `firstRoundPick` 이 **어느 구획의 경합인지
 * 정할 근거가 없다**며 던진다(`DraftLoadError`).
 *
 * ⚠**그 예외는 파싱이 끝난 뒤 `loadDraft` 안에서 나온다** — 즉 **앞 구단은 이미 커밋된 뒤**다.
 * 그래서 시즌 전체를 **먼저 리허설**하지 않으면 이 시즌은 반쯤 적재된다.
 * ⚠**재시도로 절대 안 풀린다**(입력이 같으면 같은 예외). 건너뛰고 사유를 남기는 것이 유일한 답이다.
 *
 * ⚠**2006 요미우리 픽스처로는 안 재진다**(2026-09-05 실측): 그 구단은 `希望入団枠` 를 써서
 * `daigaku_shakaijin` 1巡目이 없고, 1巡目 후보가 `koukousei/坂本 勇人` **하나뿐**이라 안 던진다.
 * 그래서 이 시험은 **모양을 지어서** 잰다 — 그 해의 어느 구단이 그랬는지는 아직 안 쟀다.
 */
test("⚠A7 — 한 구단이 loadDraft 에서 던지면 앞 구단도 남지 않는다(행 0)", async () => {
  await withDb((db) => {
    const good = page("a", [pick("a", "shihaika", 1, "정상")], []);
    const bad = page(
      "b",
      [pick("b", "koukousei", 1, "고교"), pick("b", "daigaku_shakaijin", 1, "대학")],
      [bid("b", 1, ["阪神"], "누군가", false)],
    );
    assert.throws(
      () => loadSeasonPages(db, 2006, { pages: [good, bad], event: PROV }),
      DraftLoadError,
      "두 구획에 1巡目이 있으면 던져야 한다",
    );
    assert.equal(count(db, "draft_pick"), 0, "⚠앞 구단(a)이 남으면 부분 적재다");
    assert.equal(count(db, "draft_event"), 0);

    // ⚠**이 시험이 헛돌지 않는다는 증거** — 나쁜 구단을 빼면 같은 입력이 실제로 들어간다
    const n = loadSeasonPages(db, 2006, { pages: [good], event: PROV });
    assert.equal(n.picks, 1);
    assert.equal(count(db, "draft_pick"), 1);
  });
});

// ── M5 — 멱등 ──────────────────────────────────────────────────────────────

test("⚠M5 — 두 번 적재해도 한 번과 같다", async () => {
  const root = await archive2019();
  try {
    await withDb(async (db) => {
      const a = await loadDraftSeason(db, 2019, { archiveRoot: root });
      const snap = {
        event: rows(db, "draft_event"),
        pick: rows(db, "draft_pick"),
        bid: rows(db, "draft_bid"),
      };
      const b = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.deepEqual(b, a, "보고서가 달라졌다");
      assert.deepEqual(
        { event: rows(db, "draft_event"), pick: rows(db, "draft_pick"), bid: rows(db, "draft_bid") },
        snap,
        "행이 달라졌다",
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── M11 — 「없다」와 「깨졌다」를 안 섞는다 ────────────────────────────────────

test("⚠그 해 디렉터리가 없는 것은 결함이 아니다 — absent 는 FAIL 도 ERROR 도 아니다(M11)", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-draft-arc-"));
  try {
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2001, { archiveRoot: root });
      assert.equal(r.loaded, false);
      assert.equal(r.skipped?.kind, "absent");
      assert.equal(r.sourceWritesBids, null, "안 쟀다");
      assert.equal(r.teams, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("⚠연도 톱만 있고 구단이 0장이어도 absent 다 — 「받다 말았다」이지 「경합이 없다」가 아니다", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-draft-arc-"));
  try {
    await writeBlob(root, yearIndexKey(2026), "<html>index</html>", meta(IDX_URL));
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2026, { archiveRoot: root });
      assert.equal(r.skipped?.kind, "absent");
      assert.equal(r.sourceWritesBids, null);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 시즌 열거 ───────────────────────────────────────────────────────────────

test("아카이브에 있는 시즌을 연도순으로 센다 — 분모다", async () => {
  const root = await archive2019();
  try {
    await writeBlob(root, yearIndexKey(2024), "<html>x</html>", meta(IDX_URL));
    await writeBlob(root, teamPageKey(2024, "b"), "<html>x</html>", meta(IDX_URL));
    assert.deepEqual(await seasonsInArchive(root), [2019, 2024]);
    assert.deepEqual(await seasonsInArchive(join(root, "none")), [], "없는 경로는 0건이다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 사이드카 모양 검사(M7) ──────────────────────────────────────────────────

test("⚠사이드카에 본문 해시가 없으면 「몇 번째 판」을 말할 수 없다 — 던진다(M7)", async () => {
  const root = await archive2019();
  try {
    const p = join(root, `${teamPageKey(2019, "c")}.meta.json`);
    const m = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
    delete m["sha256"];
    await writeFile(p, JSON.stringify(m));
    await withDb(async (db) => {
      const r = await loadDraftSeason(db, 2019, { archiveRoot: root });
      assert.equal(r.skipped?.kind, "provenance");
      assert.equal(count(db, "draft_pick"), 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 검사 시점 ──────────────────────────────────────────────────────────────
/**
 * ⚠**여기서 재는 것은 「불변식이 성립하는가」가 아니라 「지금 걸어도 되는가」다.**
 * 불변식 자체는 `scripts/test/draft-invariants.test.ts` 가 잰다.
 */

test("⚠불변식은 시즌이 다 들어온 뒤에만 건다(A6) — 중간 상태의 붉음은 결함이 아니다", () => {
  assert.deepEqual(checkableInvariants(report({ teams: 12, sourceWritesBids: true })), [
    "INV-4",
    "INV-4′",
    "INV-5",
    "INV-N1",
    "INV-N2",
    "INV-N3",
  ]);
  assert.deepEqual(
    checkableInvariants(report({ teams: 7 })),
    [],
    "⚠아직 덜 들어왔다 — 걸면 헛불이고, 헛불이 일상이 되면 진짜 위반도 안 읽힌다",
  );
  assert.deepEqual(
    checkableInvariants(report({ loaded: false, teams: 0, sourceWritesBids: null })),
    [],
    "안 들어온 시즌은 검사 대상이 아니다",
  );
});

test("⚠경합을 안 쓰는 시즌은 INV-N2 만 걸 수 있다(A14) — 나머지 다섯은 구조적으로 붉다", () => {
  // 2023~2025 는 `bids: null` 이라 그 시즌 `draft_bid` 가 **0행**이다.
  //   INV-4       분모를 draft_pick 에서 얻어 슬롯은 살아 있는데 획득이 영원히 0 → **만족 불가**
  //   INV-4′·5·N1·N3  분모를 draft_bid 에서 얻어 **0** → `assertClean` 이 실패시킨다
  //   INV-N2      분모가 draft_pick ∪ draft_bid 라 지명만으로도 선다 → **이것만 남는다**
  assert.deepEqual(checkableInvariants(report({ sourceWritesBids: false })), ["INV-N2"]);
  assert.deepEqual(
    checkableInvariants(report({ sourceWritesBids: null })),
    ["INV-N2"],
    "⚠판정을 못 한 시즌도 안전한 쪽으로 — 나머지 다섯을 켜면 헛불이다",
  );
});

test("⚠찍는 이름이 실재해야 한다(M1) — 불변식 이름은 draft-invariants.test.ts 가 소유한다", async () => {
  const src = await readFile(
    fileURLToPath(new URL("../../../scripts/test/draft-invariants.test.ts", import.meta.url)),
    "utf8",
  );
  // 검사기가 스스로 붙이는 이름(`name: "INV-… (설명)"`)에서 ID 만 뽑는다.
  const owned = [...src.matchAll(/name: "(INV-[^\s"]+)/g)].map((m) => m[1]).sort();
  assert.equal(owned.length, 6, "⚠검사기가 6종이 아니다 — 늘거나 줄었으면 아래 목록도 같이 고쳐라");
  assert.deepEqual(
    [...checkableInvariants(report())].sort(),
    owned,
    "⚠CLI 가 찍는 이름과 검사기의 이름이 갈렸다 — 런북을 읽은 사람이 grep 해도 안 나온다",
  );
});

// ── 시즌 요약 ──────────────────────────────────────────────────────────────

test("⚠absent 는 종료코드를 올리지 않는다(M11) — 「안 받았다」는 FAIL 도 ERROR 도 아니다", () => {
  const s = summarizeSeasons([
    report({ season: 2025, sourceWritesBids: false }),
    report({
      season: 2026,
      loaded: false,
      teams: 0,
      sourceWritesBids: null,
      skipped: { kind: "absent", reason: "구단 페이지가 0장" },
    }),
  ]);
  assert.equal(s.loaded, 1);
  assert.equal(s.absent, 1);
  assert.equal(s.exitCode, 0, "⚠개최 전 시즌이 있다고 배치를 붉히지 않는다");
});

test("⚠FAIL 과 ERROR 를 갈래별로 센다 — 「일부 실패」로 뭉치지 않는다", () => {
  const s = summarizeSeasons([
    report({ season: 2005, loaded: false, skipped: { kind: "load", reason: "1巡目이 두 구획에" } }),
    report({ season: 2006, loaded: false, skipped: { kind: "parse", reason: "구조가 바뀌었다" } }),
    report({ season: 2007, loaded: false, skipped: { kind: "provenance", reason: "사이드카가 없다" } }),
    report({ season: 2008, loaded: false, skipped: { kind: "error", reason: "TypeError: x" } }),
    report({ season: 2009, loaded: false, skipped: { kind: "absent", reason: "안 받았다" } }),
  ]);
  assert.deepEqual(
    { load: s.load, parse: s.parse, provenance: s.provenance, error: s.error, absent: s.absent },
    { load: 1, parse: 1, provenance: 1, error: 1, absent: 1 },
  );
  assert.equal(s.loaded, 0);
  assert.equal(s.exitCode, 1);
});

test("⚠경합을 안 쓰는 시즌을 따로 센다(B2) — 화면이 「데이터 없음」으로 그리면 거짓이다", () => {
  const s = summarizeSeasons([
    report({ season: 2022, sourceWritesBids: true }),
    report({ season: 2023, sourceWritesBids: false }),
    report({ season: 2024, sourceWritesBids: false }),
    report({ season: 2026, loaded: false, sourceWritesBids: null, skipped: { kind: "absent", reason: "x" } }),
  ]);
  assert.equal(s.noBidsSource, 2, "⚠적재된 시즌만 센다 — 건너뛴 시즌은 「안 쟀음」이지 「안 쓴다」가 아니다");
  assert.deepEqual(
    s.limited,
    [2023, 2024],
    "⚠제한된 시즌은 이름으로 남는다 — 「일부만」이라고 쓰면 어느 것인지 알 수 없다",
  );
  assert.equal(s.exitCode, 0);
});

test("⚠구단이 덜 들어온 시즌을 「INV-N2 는 걸 수 있다」로 세지 마라 — 하나도 못 건다", () => {
  // ⚠적재는 됐는데 구단이 7장뿐인 시즌. `checkableInvariants` 는 []를 주는데,
  //   「여섯보다 적다」로만 세면 **제한 시즌과 한 칸에 들어가** 요약이 거짓말을 한다.
  const s = summarizeSeasons([
    report({ season: 2019, teams: 12, sourceWritesBids: true }),
    report({ season: 2020, teams: 7, sourceWritesBids: true }),
    report({ season: 2023, teams: 12, sourceWritesBids: false }),
  ]);
  assert.deepEqual(s.limited, [2023], "⚠INV-N2 를 걸 수 있는 시즌만 여기 온다");
  assert.deepEqual(s.incomplete, [2020], "⚠아카이브가 덜 들어온 시즌은 따로 세운다");
  assert.equal(s.loaded, 3);
});
