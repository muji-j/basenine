/**
 * wikipedia 드래프트 적재 시험.
 *
 * ⚠**이 적재기의 핵심은 「무엇을 넣는가」가 아니라 「무엇을 안 넣는가」다**(M1) —
 * npb 가 말한 (시즌·구획·구단)에는 손대지 않는다. 그 규칙이 깨지면 `draft_pick` 의
 * PK(`season,kind,team,round_no` · **origin 없음**)에서 부딪치거나, 더 나쁘게는
 * **한 표에 두 판이 섞인다.**
 *
 * ⚠**여기 있는 모양은 지어낸 것이 아니라 실물에서 뽑았다**(2026-09-06 ·
 * `packages/parser/test/fixtures/wiki-draft-2024.html.gz` 를 파서에 통과시킨 값):
 * 2024 1回目은 **宗山塁 5구단 · 金丸夢斗 4구단 · 西川史礁 2구단 · ヤクルト 단독** 이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFT_WIKI_LICENSE as ARCHIVER_LICENSE } from "@bb-app/archiver";
import type { DraftWikiBid, DraftWikiPick } from "@bb-app/parser";
import { openDb } from "../src/db.ts";
import type { Db } from "../src/db.ts";
import {
  DRAFT_WIKI_LICENSE,
  DraftWikiLoadError,
  compareDraftWikiBids,
  loadDraftWiki,
  resolveDraftWikiColumns,
} from "../src/draft-wiki.ts";

const PAGE = {
  source: "https://ja.wikipedia.org/wiki/2024年度新人選手選択会議_(日本プロ野球)",
  fetchedAt: "2026-09-06T04:31:47.587Z",
  revision: "4f7a3993",
};

/** 열 → 구단. 2024 실물의 열 순서다 */
const COLUMNS = ["西武", "中日", "オリックス", "ヤクルト", "楽天", "広島", "ロッテ", "DeNA", "日本ハム", "阪神", "ソフトバンク", "巨人"];
const TEAMS = ["l", "d", "b", "s", "e", "c", "m", "db", "f", "t", "h", "g"];

async function withDb(fn: (db: Db) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-wiki-"));
  const db = openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function wpick(col: number, roundNo: number | null, name: string, kind: DraftWikiPick["kind"] = "shihaika"): DraftWikiPick {
  return { columnIndex: col, kind, roundNo, waiverDir: null, nameDisplay: name, nameCanonical: `${name}(記事)` };
}

function wbid(col: number, bidRound: number, group: string | null, won: boolean | null, name: string): DraftWikiBid {
  return { columnIndex: col, kind: "shihaika", bidRound, groupKey: group, won, nameDisplay: name, nameCanonical: null };
}

/** npb 행 하나 심기 — 「npb 가 말한 자리」를 만든다 */
function npbPick(db: Db, season: number, kind: string, team: string, roundNo: number, name: string): void {
  db.raw
    .prepare(
      `INSERT INTO draft_pick (season, kind, team, round_no, name_display, origin, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, ?, 'npb', 'https://npb.jp/x', '2026-01-01T00:00:00Z', 'sha-npb')`,
    )
    .run(season, kind, team, roundNo, name);
}

// ──────────────────────────────────────────────────────────────────────────

test("⚠열을 이름표가 아니라 **지명 명단의 겹침**으로 맞춘다 — 두 어휘가 둘 다 연도의 함수다", () => {
  const wiki = [new Set(["宗山塁", "渡部聖弥"]), new Set(["金丸夢斗", "吉田聖弥"])];
  const npb = new Map([
    ["l", new Set(["宗山塁", "渡部聖弥", "齋藤大翔"])],
    ["d", new Set(["金丸夢斗", "吉田聖弥"])],
  ]);
  const m = resolveDraftWikiColumns(2024, COLUMNS.slice(0, 2), wiki, npb);
  assert.deepEqual(m.map((x) => x.team), ["l", "d"]);
  assert.deepEqual(m.map((x) => x.column), ["西武", "中日"]);
  assert.deepEqual(m.map((x) => x.overlap), [2, 2]);
  assert.ok(m.every((x) => x.margin >= 1));
  // ⚠**열 이름은 그대로 남는다** — 여기서 팀 코드로 바꿔 버리면 「소스가 뭐라고 썼나」를 잃는다
  assert.equal(COLUMNS.length, TEAMS.length, "열 이름과 구단 코드의 길이가 다르다");
});

test("⚠맞출 수 없으면 던진다 — 조용히 순서대로 붙이는 것이 최악이다(M7)", () => {
  // ⑴ npb 명단이 없다
  assert.throws(() => resolveDraftWikiColumns(2024, ["西武"], [new Set(["宗山塁"])], new Map()), DraftWikiLoadError);
  // ⑵ 열 수와 구단 수가 다르다
  assert.throws(
    () => resolveDraftWikiColumns(2024, ["西武"], [new Set(["宗山塁"])], new Map([["l", new Set(["宗山塁"])], ["d", new Set(["金丸夢斗"])]])),
    DraftWikiLoadError,
  );
  // ⑶ 겹치는 이름이 없다
  assert.throws(
    () => resolveDraftWikiColumns(2024, ["西武"], [new Set(["だれか"])], new Map([["l", new Set(["宗山塁"])]])),
    DraftWikiLoadError,
  );
  // ⑷ 동점 — 두 열이 같은 구단에 붙는다
  assert.throws(
    () =>
      resolveDraftWikiColumns(
        2024,
        ["西武", "中日"],
        [new Set(["宗山塁"]), new Set(["宗山塁"])],
        new Map([["l", new Set(["宗山塁"])], ["d", new Set(["金丸夢斗"])]]),
      ),
    DraftWikiLoadError,
  );
});

test("⚠npb 가 말한 자리에는 손대지 않는다 — 지명은 npb, 입찰은 wikipedia(M1)", async () => {
  await withDb((db) => {
    for (let i = 0; i < TEAMS.length; i += 1) npbPick(db, 2024, "shihaika", TEAMS[i]!, 1, `1位選手${i}`);

    const r = loadDraftWiki(db, {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [wpick(0, 1, "宗山塁"), wpick(1, 1, "金丸夢斗")],
      bids: [wbid(0, 1, "1:宗山塁", false, "宗山塁"), wbid(4, 1, "1:宗山塁", true, "宗山塁")],
      page: PAGE,
    });
    // 지명은 전부 미뤄지고(=npb 가 이김) 입찰만 들어간다
    assert.equal(r.picks, 0);
    assert.equal(r.picksDeferred, 2);
    assert.equal(r.bids, 2);
    assert.equal(r.bidsDeferred, 0);

    // ⚠`node:sqlite` 는 **null prototype** 행을 준다 — `deepEqual`(strict)이 그것을 다른 값으로 본다.
    //   `{ ...row }` 로 평범한 객체로 옮긴 뒤 비교한다.
    const picks = (db.raw.prepare("SELECT origin, COUNT(*) n FROM draft_pick GROUP BY origin").all() as unknown as { origin: string; n: number }[]).map((r) => ({ ...r }));
    assert.deepEqual(picks, [{ origin: "npb", n: 12 }], "npb 지명이 덮이거나 늘었다");
    const bids = (db.raw.prepare("SELECT team, won, origin FROM draft_bid ORDER BY team").all() as unknown as { team: string; won: number | null; origin: string }[]).map((r) => ({ ...r }));
    assert.deepEqual(bids, [
      { team: "e", won: 1, origin: "wikipedia" },
      { team: "l", won: 0, origin: "wikipedia" },
    ]);
  });
});

test("⚠npb 가 입찰을 이미 말했으면 wikipedia 는 그 구단에 안 넣는다 — 표마다 따로 묻는다", async () => {
  await withDb((db) => {
    db.raw
      .prepare(
        `INSERT INTO draft_bid (season, kind, round_no, team, group_key, won, name_display, origin, source, fetched_at, revision)
         VALUES (2019, 'shihaika', 1, 'l', '1:奥川恭伸', 0, '奥川 恭伸', 'npb', 'https://npb.jp/x', '2026-01-01T00:00:00Z', 'sha-npb')`,
      )
      .run();
    const r = loadDraftWiki(db, {
      season: 2019,
      teamOfColumn: TEAMS,
      picks: [],
      // `l` 은 npb 가 말했다 · `d` 는 안 말했다
      bids: [wbid(0, 1, "1:奥川恭伸", false, "奥川恭伸"), wbid(1, 1, "1:奥川恭伸", true, "奥川恭伸")],
      page: PAGE,
    });
    assert.equal(r.bids, 1, "npb 가 말한 구단까지 넣었다");
    assert.equal(r.bidsDeferred, 1);
    const rows = (db.raw.prepare("SELECT team, origin FROM draft_bid ORDER BY team").all() as unknown as { team: string; origin: string }[]).map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ team: "d", origin: "wikipedia" }, { team: "l", origin: "npb" }]);
  });
});

test("⚠멱등하다 — 두 번 넣어도 결과가 한 번과 같다(M5)", async () => {
  await withDb((db) => {
    const input = {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [wpick(0, 1, "宗山塁")],
      bids: [wbid(0, 1, "1:宗山塁", false, "宗山塁"), wbid(4, 1, "1:宗山塁", true, "宗山塁")],
      page: PAGE,
    };
    loadDraftWiki(db, input);
    const first = db.raw.prepare("SELECT COUNT(*) n FROM draft_bid").get() as unknown as { n: number };
    loadDraftWiki(db, input);
    const second = db.raw.prepare("SELECT COUNT(*) n FROM draft_bid").get() as unknown as { n: number };
    assert.deepEqual(second, first);
    assert.equal(second.n, 2);
  });
});

test("⚠정정으로 **줄어든** 판도 반영된다 — 덮어쓰기가 아니라 시즌 단위로 지우고 다시 넣는다", async () => {
  await withDb((db) => {
    loadDraftWiki(db, {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [],
      bids: [wbid(0, 1, "1:A", false, "A"), wbid(1, 1, "1:A", true, "A"), wbid(2, 2, null, null, "B")],
      page: PAGE,
    });
    assert.equal((db.raw.prepare("SELECT COUNT(*) n FROM draft_bid").get() as unknown as { n: number }).n, 3);
    loadDraftWiki(db, {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [],
      bids: [wbid(0, 1, "1:A", false, "A"), wbid(1, 1, "1:A", true, "A")],
      page: PAGE,
    });
    assert.equal(
      (db.raw.prepare("SELECT COUNT(*) n FROM draft_bid").get() as unknown as { n: number }).n,
      2,
      "사라진 입찰이 그대로 남았다",
    );
  });
});

test("⚠단독지명은 `won`·`group_key`·`rivals` 가 전부 NULL 이다 — 「이겼다」가 아니다(M11)", async () => {
  await withDb((db) => {
    loadDraftWiki(db, {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [],
      bids: [wbid(3, 1, null, null, "中村優斗")],
      page: PAGE,
    });
    const r = db.raw.prepare("SELECT won, group_key, rivals FROM draft_bid").get() as unknown as {
      won: number | null;
      group_key: string | null;
      rivals: string | null;
    };
    assert.deepEqual({ ...r }, { won: null, group_key: null, rivals: null });
  });
});

test("⚠`rivals` 는 전건 NULL — 색에서 뽑아 담으면 **언제나 통과하는 가짜 대조**가 된다", async () => {
  await withDb((db) => {
    loadDraftWiki(db, {
      season: 2024,
      teamOfColumn: TEAMS,
      picks: [],
      bids: [wbid(0, 1, "1:宗山塁", false, "宗山塁"), wbid(4, 1, "1:宗山塁", true, "宗山塁")],
      page: PAGE,
    });
    const n = db.raw.prepare("SELECT COUNT(*) n FROM draft_bid WHERE rivals IS NOT NULL").get() as unknown as { n: number };
    assert.equal(n.n, 0);
  });
});

test("⚠출처 3종이 전 행에 붙는다 — 「어디서·언제·몇 번째 판」(M4)", async () => {
  await withDb((db) => {
    loadDraftWiki(db, { season: 2024, teamOfColumn: TEAMS, picks: [], bids: [wbid(0, 1, null, null, "A")], page: PAGE });
    const r = db.raw.prepare("SELECT source, fetched_at, revision FROM draft_bid").get() as unknown as Record<string, string>;
    assert.deepEqual({ ...r }, { source: PAGE.source, fetched_at: PAGE.fetchedAt, revision: PAGE.revision });
    assert.match(r["source"]!, /^https:\/\/ja\.wikipedia\.org\/wiki\//u);
  });
});

test("⚠`draft_event` 를 덮지 않는다 — 그 표에는 `origin` 이 없어서 덮으면 npb 의 판이 사라진다", async () => {
  await withDb((db) => {
    db.raw
      .prepare(
        `INSERT INTO draft_event (season, kind, source, fetched_at, revision)
         VALUES (2024, 'shihaika', 'https://npb.jp/draft/2024/', '2026-01-01T00:00:00Z', 'sha-npb')`,
      )
      .run();
    const r = loadDraftWiki(db, { season: 2024, teamOfColumn: TEAMS, picks: [], bids: [wbid(0, 1, null, null, "A")], page: PAGE });
    assert.equal(r.events, 0, "있는 회의 행을 새로 썼다");
    const ev = db.raw.prepare("SELECT source, license FROM draft_event WHERE season=2024 AND kind='shihaika'").get() as unknown as {
      source: string;
      license: string | null;
    };
    assert.equal(ev.source, "https://npb.jp/draft/2024/", "npb 의 출처가 덮였다");
    // ⚠**라이선스도 안 얹는다** — 그 행의 URL 은 npb.jp 이고 그 페이지는 CC BY-SA 가 아니다
    assert.equal(ev.license, null);
  });
});

test("⚠회의 행이 아예 없을 때만 만든다 — 그때는 라이선스를 남긴다(L3)", async () => {
  await withDb((db) => {
    const r = loadDraftWiki(db, { season: 2024, teamOfColumn: TEAMS, picks: [], bids: [wbid(0, 1, null, null, "A")], page: PAGE });
    assert.equal(r.events, 1);
    const ev = db.raw.prepare("SELECT source, license FROM draft_event WHERE season=2024").get() as unknown as {
      source: string;
      license: string | null;
    };
    assert.equal(ev.source, PAGE.source);
    assert.equal(ev.license, DRAFT_WIKI_LICENSE);
  });
});

test("⚠`X-1` 대조가 승패·경합 집합·이름을 전부 본다 — 하나라도 빠지면 조용히 통과한다", () => {
  const npb = [
    { kind: "shihaika", roundNo: 1, team: "l", groupKey: "1:宗山塁", won: 0 as const, nameDisplay: "宗山 塁" },
    { kind: "shihaika", roundNo: 1, team: "e", groupKey: "1:宗山塁", won: 1 as const, nameDisplay: "宗山 塁" },
  ];
  // 같은 사실 — 공백만 다르다
  assert.deepEqual(compareDraftWikiBids(2024, npb, [
    { kind: "shihaika", roundNo: 1, team: "l", groupKey: "1:宗山塁", won: 0, nameDisplay: "宗山塁" },
    { kind: "shihaika", roundNo: 1, team: "e", groupKey: "1:宗山塁", won: 1, nameDisplay: "宗山塁" },
  ]).diffs, []);
  // 승패가 뒤집혔다
  assert.equal(
    compareDraftWikiBids(2024, npb, [
      { kind: "shihaika", roundNo: 1, team: "l", groupKey: "1:宗山塁", won: 1, nameDisplay: "宗山塁" },
      { kind: "shihaika", roundNo: 1, team: "e", groupKey: "1:宗山塁", won: 0, nameDisplay: "宗山塁" },
    ]).diffs.length,
    2,
  );
  // 경합 집합이 갈렸다(같은 회차인데 다른 그룹)
  assert.ok(
    compareDraftWikiBids(2024, npb, [
      { kind: "shihaika", roundNo: 1, team: "l", groupKey: "1:別人", won: 0, nameDisplay: "宗山塁" },
      { kind: "shihaika", roundNo: 1, team: "e", groupKey: "1:宗山塁", won: 1, nameDisplay: "宗山塁" },
    ]).diffs.some((d) => d.detail.includes("경합 구단 집합")),
  );
  // 한쪽에만 있다
  assert.equal(compareDraftWikiBids(2024, npb, []).diffs.length, 2);
  assert.equal(compareDraftWikiBids(2024, npb, []).checked, 2);
});

test("⚠라이선스 문자열이 두 층에서 같다 — 하나는 사이드카, 하나는 DB 다", () => {
  /**
   * ⚠**두 벌인 것을 알고 둔다**(`archiver/src/draft-wiki.ts` 주석). 아카이버는 **바이트에**,
   * 적재는 **행에** 붙이고 서로를 import 하지 않는다 — **그래서 갈릴 수 있고, 이 본이 그것을 막는다.**
   * ⚠**갈리면 「아카이브는 CC BY-SA 인데 DB 는 아니다」** 같은 상태가 조용히 생긴다(L3).
   */
  assert.equal(DRAFT_WIKI_LICENSE, ARCHIVER_LICENSE);
  assert.equal(DRAFT_WIKI_LICENSE, "CC BY-SA 4.0");
});
