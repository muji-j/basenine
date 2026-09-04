/**
 * 드래프트 적재 시험.
 *
 * ⚠**단독지명(`won = NULL`)은 소스가 말해 주지 않는다** — 경합 그룹의 여집합으로 유도한다.
 * 그 유도가 틀리면 「아무도 안 겹친 지명」이 「경합에서 이긴 지명」으로 둔갑한다(M11).
 *
 * ⚠**여기 있는 모양은 지어낸 것이 아니라 픽스처에서 뽑았다**(2026-09-05 실측 ·
 * `packages/parser/test/fixtures/draft-{2019-list-g,2019-list-c,2006-list-g,2001-list-f}.html.gz`
 * 를 파서에 통과시킨 값). 특히 **2019 요미우리가 낙첨 2건뿐이고 자기 1순위(堀田 賢慎)는
 * 주석에 한 줄도 없다** — 그게 아래 「전부 낙첨한 구단」 시험의 근거다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftBidRow, DraftKind, DraftPickRow } from "@bb-app/parser";
import { openDb } from "../src/db.ts";
import { loadDraft } from "../src/draft.ts";

/**
 * ⚠**출처가 두 벌이다**([I3]). 구단 페이지(`page`)와 연도 톱(`event`)은 **입도가 다르므로**
 * 값도 달라야 한다 — 여기서 같은 값을 쓰면 「덮였는가」를 재는 시험이 **구별할 수 없게 된다.**
 */
const PAGE = {
  source: "https://npb.jp/draft/2019/draftlist_g.html",
  fetchedAt: "2026-09-05T01:00:00Z",
  revision: "sha256:page-g",
};
const EVENT = {
  source: "https://npb.jp/draft/2019/",
  fetchedAt: "2026-09-05T00:00:00Z",
  revision: "sha256:event-2019",
};
const META = { page: PAGE, event: EVENT };

async function withDb(fn: (db: ReturnType<typeof openDb>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-"));
  const db = openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function pick(team: string, kind: DraftKind, roundNo: number | null, nameDisplay: string): DraftPickRow {
  return { team, kind, roundNo, waiverDir: null, nameDisplay, position: null, fromOrg: null };
}

function bid(team: string, roundNo: number, rivals: string[], nameDisplay: string | null, won: boolean): DraftBidRow {
  return { team, roundNo, rivals, nameDisplay, won };
}

interface BidRow {
  kind: string;
  round_no: number;
  team: string;
  group_key: string | null;
  won: number | null;
  name_display: string;
  name_canonical: string | null;
}

function bidsOf(db: ReturnType<typeof openDb>, season: number): BidRow[] {
  return db.raw
    .prepare("SELECT * FROM draft_bid WHERE season = ? ORDER BY kind, team, round_no")
    .all(season) as unknown as BidRow[];
}

// ---- 기본 ---------------------------------------------------------------

test("지명과 입찰이 들어간다", async () => {
  await withDb((db) => {
    const out = loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [
        { team: "g", kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "堀田 賢慎", position: "投手", fromOrg: "青森山田高" },
        { team: "g", kind: "shihaika", roundNo: 2, waiverDir: null, nameDisplay: "太田 龍", position: "投手", fromOrg: "JR東日本" },
      ],
      bids: [
        bid("g", 1, ["東京ヤクルト", "阪神"], "奥川恭伸", false),
        bid("g", 2, ["埼玉西武"], "宮川哲", false),
      ],
      ...META,
    });

    const picks = db.raw
      .prepare("SELECT * FROM draft_pick WHERE season = 2019 ORDER BY round_no")
      .all() as unknown as Array<Record<string, unknown>>;
    assert.equal(picks.length, 2, "지명 2건 중 2건");
    assert.equal(picks[0]?.name_display, "堀田 賢慎");
    assert.equal(picks[0]?.name_canonical, "堀田賢慎", "표시명과 별개로 정규화명을 넣는다(M10)");
    assert.equal(picks[0]?.position, "投手");
    assert.equal(picks[0]?.from_org, "青森山田高");
    assert.equal(picks[0]?.origin, "npb");
    assert.equal(picks[0]?.waiver_dir, null, "이 소스는 웨이버 방향을 적지 않는다(M11)");
    assert.equal(picks[0]?.pick_seq, null, "이 소스는 전체 지명 순번을 적지 않는다(M11)");
    assert.equal(picks[0]?.player_id, null, "이름으로 선수를 잇지 않는다(M10)");
    assert.equal(picks[0]?.source, PAGE.source, "⚠지명은 구단 페이지에 실렸다 — 연도 톱이 아니다");
    assert.equal(picks[0]?.fetched_at, PAGE.fetchedAt);
    assert.equal(picks[0]?.revision, PAGE.revision);

    const rows = bidsOf(db, 2019);
    assert.equal(rows.filter((r) => r.won === 0).length, 2, "낙첨 2건은 0 이다");
    assert.equal(out.picks, 2);
    assert.equal(out.bids, rows.length);
  });
});

test("draft_event 가 kind 마다 생기고 출처 3종을 채운다(M4)", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "ikusei", 1, "平間 隼人")],
      bids: [],
      ...META,
    });
    const evs = db.raw
      .prepare("SELECT * FROM draft_event WHERE season = 2019 ORDER BY kind")
      .all() as unknown as Array<Record<string, unknown>>;
    assert.equal(evs.length, 2, "구획 2종 중 2종");
    assert.deepEqual(evs.map((e) => e.kind), ["ikusei", "shihaika"]);
    for (const e of evs) {
      // ⚠**연도 톱이다. 구단 페이지가 아니다**([I3]) — 회의는 시즌 단위 사실이라
      //   구단 페이지 하나로 출처를 대면 12구단 중 11구단분이 거짓이 된다.
      assert.equal(e.source, EVENT.source);
      assert.equal(e.fetched_at, EVENT.fetchedAt);
      assert.equal(e.revision, EVENT.revision);
      assert.notEqual(e.source, PAGE.source, "⚠구단 페이지가 회의의 출처가 되면 안 된다");
      assert.equal(e.held_on, null, "개최일은 이 소스가 안 준다(M11)");
    }
  });
});

/**
 * ⚠⚠**[I3] 의 회귀 시험.** 검토자가 실측한 그대로: g 페이지를 넣고 c 페이지를 넣으면
 * `draft_event` 의 출처가 **마지막 구단 페이지로 덮였다.** 그러면
 * 「2019 支配下 회의는 어느 판인가?」의 답이 **12구단 중 11구단에 대해 틀리다.**
 * ⚠**`provenance.test.ts` 는 컬럼 존재만 보므로 이 거짓을 영원히 못 본다** —
 * 그래서 값을 재는 시험이 여기 따로 있어야 한다.
 */
test("⚠draft_event 의 출처가 마지막 구단 페이지로 덮이지 않는다([I3])", async () => {
  await withDb((db) => {
    const pageC = { source: "https://npb.jp/draft/2019/draftlist_c.html", fetchedAt: "2026-09-05T02:00:00Z", revision: "sha256:page-c" };
    loadDraft(db, { season: 2019, team: "g", picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [], ...META });
    loadDraft(db, { season: 2019, team: "c", picks: [pick("c", "shihaika", 1, "森下 暢仁")], bids: [], page: pageC, event: EVENT });

    const ev = db.raw
      .prepare("SELECT source, fetched_at, revision FROM draft_event WHERE season = 2019 AND kind = 'shihaika'")
      .get() as unknown as { source: string; fetched_at: string; revision: string };
    assert.deepEqual(
      { ...ev },
      { source: EVENT.source, fetched_at: EVENT.fetchedAt, revision: EVENT.revision },
      "⚠회의의 출처는 시즌 단위 페이지 하나다 — 몇 구단을 넣든 같아야 한다",
    );

    // ⚠**지명 쪽은 반대다** — 구단마다 자기 페이지를 가리켜야 한다.
    const picks = db.raw
      .prepare("SELECT team, source, revision FROM draft_pick WHERE season = 2019 ORDER BY team")
      .all() as unknown as Array<{ team: string; source: string; revision: string }>;
    assert.deepEqual(picks.map((r) => ({ ...r })), [
      { team: "c", source: pageC.source, revision: pageC.revision },
      { team: "g", source: PAGE.source, revision: PAGE.revision },
    ]);
  });
});

// ---- 멱등 (M5) ----------------------------------------------------------

test("⚠멱등하다 — 두 번 넣어도 한 번과 같다(M5)", async () => {
  await withDb((db) => {
    const input = {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "shihaika", 2, "太田 龍")],
      bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false)],
      ...META,
    };
    loadDraft(db, input);
    const first = bidsOf(db, 2019);
    loadDraft(db, input);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM draft_pick").get() as unknown as { n: number };
    assert.equal(n.n, 2, "두 번 넣어도 2행이다");
    assert.deepEqual(bidsOf(db, 2019), first, "입찰도 한 번과 똑같다");
  });
});

test("⚠재수집이 줄면 사라진 행도 사라진다 — 덮어쓰기만으로는 남는다(M5)", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [
        pick("g", "shihaika", 1, "堀田 賢慎"),
        pick("g", "shihaika", 2, "太田 龍"),
        pick("g", "shihaika", 3, "菊田 拡和"),
      ],
      bids: [],
      ...META,
    });
    // 정정으로 3순위가 사라진 판을 다시 넣는다.
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "shihaika", 2, "太田 龍")],
      bids: [],
      ...META,
    });
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM draft_pick").get() as unknown as { n: number };
    assert.equal(n.n, 2, "3행 중 2행만 남아야 한다 — UPSERT 만으로는 3행이 남는다");
  });
});

test("⚠1순위 지명이 사라지면 그 구단의 옛 입찰 행도 사라진다(M5)", async () => {
  await withDb((db) => {
    loadDraft(db, { season: 2019, team: "g", picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [], ...META });
    assert.equal(bidsOf(db, 2019).length, 1, "먼저 단독지명 행이 하나 생긴다");
    // 정정으로 1巡目 이 사라진 판. 이번 판에서는 유도할 단독지명이 없다.
    loadDraft(db, { season: 2019, team: "g", picks: [pick("g", "shihaika", 2, "太田 龍")], bids: [], ...META });
    assert.equal(bidsOf(db, 2019).length, 0, "없어진 지명을 가리키는 입찰 행이 남으면 안 된다");
  });
});

/**
 * ⚠**지명이 0건인 판도 반영돼야 한다** — 그래서 지울 구단을 행에서 유도하지 않고 입력에서 받는다.
 * `parseDraftPicks` 는 「전 회차를 건너뛴 구단」에 대해 **빈 배열을 내는 것이 정상**이다
 * (그 파서의 `@returns`). 유도했다면 지울 대상을 몰라 **옛 행이 조용히 남는다.**
 * ⚠**이건 [I3] 을 고치다 딸려 온 것이지 검토가 지적한 항목이 아니다** — 그래도 여기 못 박는다.
 */
test("⚠지명이 0건인 판을 넣으면 그 구단의 옛 행이 사라진다(M5)", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2001,
      team: "f",
      picks: [pick("f", "shihaika", 1, "江尻 慎太郎")],
      bids: [],
      ...META,
    });
    loadDraft(db, { season: 2001, team: "c", picks: [pick("c", "shihaika", 1, "가상")], bids: [], ...META });
    assert.equal(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM draft_pick").get() as unknown as { n: number }).n,
      2,
      "먼저 두 구단이 들어간다",
    );

    // 정정으로 그 구단이 전 회차를 건너뛴 것이 됐다.
    loadDraft(db, { season: 2001, team: "f", picks: [], bids: [], ...META });
    const rows = db.raw
      .prepare("SELECT team FROM draft_pick WHERE season = 2001 ORDER BY team")
      .all() as unknown as Array<{ team: string }>;
    assert.deepEqual(rows.map((r) => r.team), ["c"], "⚠f 의 옛 행이 남으면 안 되고, c 는 건드리면 안 된다");
    assert.equal(bidsOf(db, 2001).length, 1, "f 의 유도된 단독지명 행도 같이 사라진다");
  });
});

test("⚠다른 구단을 지우지 않는다 — 구단 단위로 다시 넣어도 된다(M5)", async () => {
  await withDb((db) => {
    // ⚠삭제 범위가 **구단 단위**라, 다른 구단의 **어느 구획도** 건드리면 안 된다.
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "ikusei", 1, "平間 隼人")],
      bids: [],
      ...META,
    });
    loadDraft(db, { season: 2019, team: "c", picks: [pick("c", "shihaika", 1, "森下 暢仁")], bids: [], ...META });
    const rows = db.raw
      .prepare("SELECT team, kind FROM draft_pick WHERE season = 2019 ORDER BY team, kind")
      .all() as unknown as Array<{ team: string; kind: string }>;
    assert.deepEqual(
      rows.map((r) => `${r.team}/${r.kind}`),
      ["c/shihaika", "g/ikusei", "g/shihaika"],
      "요미우리 2구획 + 히로시마 1구획 = 3행이 그대로 남는다",
    );
    assert.equal(bidsOf(db, 2019).length, 2, "입찰도 두 구단 것이 다 남는다");
  });
});

test("⚠kind 가 바뀌는 정정에서 옛 지명이 고아로 남지 않는다(M5)", async () => {
  await withDb((db) => {
    // ⚠**이 브랜치에서 실제로 일어난 이력이다**(019 주석): 초판 파서가 `自由獲得選手` 를
    //   `shihaika` 로 접었고 나중에 별도 kind 로 갈랐다. 그 정정을 재적재로 반영하면
    //   **같은 선수가 두 구획에 동시에 지명된 것처럼** 보인다.
    loadDraft(db, { season: 2001, team: "f", picks: [pick("f", "shihaika", 1, "江尻 慎太郎")], bids: [], ...META });
    loadDraft(db, { season: 2001, team: "f", picks: [pick("f", "jiyuu_kakutoku", null, "江尻 慎太郎")], bids: [], ...META });
    const rows = db.raw
      .prepare("SELECT kind, round_no, name_display FROM draft_pick WHERE season = 2001 AND team = 'f'")
      .all() as unknown as Array<{ kind: string; round_no: number; name_display: string }>;
    assert.equal(rows.length, 1, "옛 구획의 행이 남으면 같은 선수가 두 번 지명된 것이 된다");
    assert.equal(rows[0]?.kind, "jiyuu_kakutoku");
  });
});

test("⚠kind 가 바뀌는 정정에서 옛 입찰도 고아로 남지 않는다(M5)", async () => {
  await withDb((db) => {
    // 2005~2007 은 本ドラフト가 高校生 / 大学生・社会人 으로 갈라져 있었다 —
    // 구획 판정이 정정되면 **유도한 단독지명 행도 구획을 옮긴다.**
    loadDraft(db, { season: 2006, team: "g", picks: [pick("g", "koukousei", 1, "坂本 勇人")], bids: [], ...META });
    assert.equal(bidsOf(db, 2006)[0]?.kind, "koukousei", "먼저 高校生 쪽에 단독지명 행이 생긴다");
    loadDraft(db, { season: 2006, team: "g", picks: [pick("g", "daigaku_shakaijin", 1, "坂本 勇人")], bids: [], ...META });
    const rows = bidsOf(db, 2006);
    assert.equal(rows.length, 1, "옛 구획의 입찰 행이 남으면 안 된다");
    assert.equal(rows[0]?.kind, "daigaku_shakaijin");
  });
});

// ---- 단독지명 유도 (M11) ------------------------------------------------

test("⚠단독지명은 won 이 NULL 이다 — 낙첨(0)과 구별한다(M11)", async () => {
  await withDb((db) => {
    // 2019 히로시마 실물 모양 — 경합 주석이 0건이다.
    const out = loadDraft(db, {
      season: 2019,
      team: "c",
      picks: [pick("c", "shihaika", 1, "森下 暢仁")],
      bids: [],
      ...META,
    });
    const rows = bidsOf(db, 2019);
    assert.equal(rows.length, 1, "단독지명도 draft_bid 에 행이 있어야 한다 — 1순위가 전부 한 표에 모인다");
    assert.equal(rows[0]?.won, null, "⚠0 이 아니라 NULL 이다");
    assert.equal(rows[0]?.group_key, null, "어느 경합 그룹에도 안 속한다");
    assert.equal(rows[0]?.round_no, 1, "주석이 없으면 첫 입찰에서 얻은 것이다");
    assert.equal(rows[0]?.name_display, "森下 暢仁");
    assert.equal(out.soleNominations, 1);
  });
});

test("⚠전부 낙첨한 구단도 자기 1순위 획득 행을 갖는다 — 2019 요미우리 실물 모양", async () => {
  await withDb((db) => {
    // 실측: 요미우리 주석은 낙첨 2건뿐이고, 실제로 얻은 堀田 賢慎 은 어디에도 안 적힌다.
    // 「경합 주석이 있는 구단은 건너뛴다」로 유도하면 이 지명이 통째로 사라진다.
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "shihaika", 2, "太田 龍")],
      bids: [bid("g", 1, ["東京ヤクルト", "阪神"], "奥川恭伸", false), bid("g", 2, ["埼玉西武"], "宮川哲", false)],
      ...META,
    });
    const rows = bidsOf(db, 2019);
    assert.equal(rows.length, 3, "낙첨 2건 + 유도한 단독 1건 = 3건");
    const sole = rows.find((r) => r.won === null);
    assert.ok(sole, "1순위를 얻은 행이 있어야 한다");
    assert.equal(sole.round_no, 3, "두 번 떨어졌으면 세 번째 입찰에서 얻은 것이다");
    assert.equal(sole.name_display, "堀田 賢慎", "얻은 선수는 그 구단의 1巡目 지명이다");
    assert.equal(sole.group_key, null);
  });
});

test("⚠경합에서 이긴 구단에는 단독지명 행을 만들지 않는다", async () => {
  await withDb((db) => {
    const out = loadDraft(db, {
      season: 2019,
      team: "s",
      picks: [pick("s", "shihaika", 1, "奥川 恭伸")],
      bids: [bid("s", 1, ["読売", "阪神"], null, true)],
      ...META,
    });
    const rows = bidsOf(db, 2019);
    assert.equal(rows.length, 1, "이긴 행 하나뿐이다");
    assert.equal(rows[0]?.won, 1);
    assert.equal(out.soleNominations, 0);
  });
});

test("⚠육성에는 단독지명 행을 만들지 않는다 — 추첨이 없는 구획이다", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "ikusei", 1, "平間 隼人"), pick("g", "ikusei", 2, "加藤 壮太")],
      bids: [],
      ...META,
    });
    const rows = bidsOf(db, 2019);
    assert.equal(rows.length, 1, "支配下 1순위 하나만 — 育成 은 0건");
    assert.equal(rows[0]?.kind, "shihaika");
  });
});

// ---- 당첨 주석의 이름 ---------------------------------------------------

test("⚠당첨 주석의 이름은 그 구단의 1巡目 지명에서 온다 — 입찰 회차의 지명이 아니다", async () => {
  await withDb((db) => {
    // 1순위 경합은 「1巡目 안에서 몇 번째 추첨인가」이지 「몇 순위 지명인가」가 아니다.
    // 입찰 회차(2)를 지명 회차로 읽으면 **그 구단의 2순위 선수**를 당첨자로 적는다.
    loadDraft(db, {
      season: 2019,
      team: "l",
      picks: [pick("l", "shihaika", 1, "宮川 哲"), pick("l", "shihaika", 2, "浜屋 将太")],
      bids: [bid("l", 1, ["読売"], "奥川恭伸", false), bid("l", 2, ["読売"], null, true)],
      ...META,
    });
    const won = bidsOf(db, 2019).find((r) => r.won === 1);
    assert.ok(won);
    assert.equal(won.round_no, 2);
    assert.equal(won.name_display, "宮川 哲", "⚠2순위 지명(浜屋 将太)이 들어오면 틀린 것이다");
  });
});

test("⚠같은 구획·구단·추첨회차에 입찰이 둘이면 던진다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "shihaika", 1, "堀田 賢慎")],
          bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false), bid("g", 1, ["阪神"], "佐々木朗希", false)],
          ...META,
        }),
      /중복/,
    );
  });
});

// ---- 경합 그룹 (M10) ----------------------------------------------------

test("⚠경합 그룹은 정규화한 이름으로 묶는다 — 표기 차로 갈리지 않는다(M10)", async () => {
  await withDb((db) => {
    // 실측: 지명 표는 `奥川 恭伸`(공백 있음), 주석은 `奥川恭伸`(공백 없음)이다.
    // 표시 이름으로 group_key 를 만들면 **같은 경합이 두 그룹으로 갈린다.**
    // ⚠**구단마다 따로 넣는다** — 소스가 구단당 한 장이고, 한 호출은 한 페이지분이다([I3]).
    loadDraft(db, {
      season: 2019,
      team: "s",
      picks: [pick("s", "shihaika", 1, "奥川 恭伸")],
      bids: [bid("s", 1, ["読売"], null, true)],
      ...META,
    });
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎")],
      bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false)],
      ...META,
    });
    const rows = bidsOf(db, 2019).filter((r) => r.won !== null);
    assert.equal(rows.length, 2, "경합 2건 중 2건");
    assert.equal(rows[0]?.group_key, rows[1]?.group_key, "⚠같은 경합이면 group_key 가 같아야 한다");
    assert.equal(rows[0]?.name_canonical, rows[1]?.name_canonical);
  });
});

/**
 * ⚠⚠**[I1]⑵·[I2] — 「몇 구단이 겹쳤어야 하는가」를 DB 가 알아야 한다.**
 *
 * 단독지명은 **여집합으로 유도**하므로, 경합 주석 하나가 조용히 안 읽히면
 * 그 구단의 1巡目이 「아무도 안 겹쳤다」로 둔갑한다. 그때 모순을 드러내는 유일한 자료가
 * 주석이 **선언한 상대 목록**인데, 적재가 그 필드를 **한 번도 읽지 않았다**(그게 [I2] 다).
 * ⚠**담고 나서야 `DraftBidRow.rivals` 의 JSDoc 이 참이 된다.**
 */
test("⚠주석이 선언한 경합 상대를 그대로 담는다 — 유도한 단독은 NULL 이다(M11)", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "堀田 賢慎")],
      bids: [bid("g", 1, ["東京ヤクルト", "阪神"], "奥川恭伸", false)],
      ...META,
    });
    const rows = db.raw
      .prepare("SELECT round_no, won, group_key, rivals FROM draft_bid WHERE season = 2019 ORDER BY round_no")
      .all() as unknown as Array<{ round_no: number; won: number | null; group_key: string | null; rivals: string | null }>;
    assert.equal(rows.length, 2, "낙첨 1건 + 유도한 단독 1건");
    // ⚠**표기 그대로다** — `東京ヤクルト` 를 `s` 로 바꾸지 않는다(그 사유는 파서 JSDoc).
    assert.equal(rows[0]?.rivals, JSON.stringify(["東京ヤクルト", "阪神"]));
    assert.equal(rows[1]?.won, null, "유도한 단독지명");
    assert.equal(rows[1]?.rivals, null, "⚠`'[]'` 가 아니라 NULL 이다 — 주석 자체가 없다(M11)");
  });
});

test("⚠단독지명 행에 상대를 붙이면 스키마가 막는다 — 019·020 의 CHECK", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        db.raw
          .prepare(
            `INSERT INTO draft_bid
               (season, kind, round_no, team, group_key, won, name_display, name_canonical,
                rivals, origin, player_id, source, fetched_at, revision)
             VALUES (2019, 'shihaika', 1, 'g', NULL, NULL, '堀田 賢慎', '堀田賢慎',
                     '["阪神"]', 'npb', NULL, ?, ?, ?)`,
          )
          .run(PAGE.source, PAGE.fetchedAt, PAGE.revision),
      /CHECK/,
      "그룹에 안 속하는데(=단독) 상대를 주장하는 행은 만들 수 없다",
    );
  });
});

test("⚠경합 상대 목록이 모양을 벗어나면 던진다 — 이 값은 HTML 에서 온다(M7)", async () => {
  await withDb((db) => {
    for (const rivals of [[] as string[], [""], ["阪神", " "], [null as unknown as string]]) {
      const broken = { ...bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false), rivals };
      assert.throws(
        () =>
          loadDraft(db, {
            season: 2019,
            team: "g",
            picks: [pick("g", "shihaika", 1, "堀田 賢慎")],
            bids: [broken],
            ...META,
          }),
        /경합 상대 목록/,
        JSON.stringify(rivals),
      );
    }
  });
});

test("⚠won 이 boolean 이 아니면 던진다 — 3값을 2값으로 접지 않는다(M11)", async () => {
  await withDb((db) => {
    const broken = { ...bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false), won: "確定" as unknown as boolean };
    assert.throws(
      () =>
        loadDraft(db, { season: 2019, team: "g", picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [broken], ...META }),
      /won/,
      "truthy 로 접으면 「確定」이 조용히 당첨(1)이 되고, 빈 문자열은 조용히 낙첨(0)이 된다",
    );
  });
});

// ---- 회차 없는 제도 -----------------------------------------------------

test("⚠회차 없는 제도에 적재가 1부터 순번을 매긴다 — 그 뜻은 kind 가 진다", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2001,
      team: "f",
      picks: [
        pick("f", "jiyuu_kakutoku", null, "江尻 慎太郎"),
        pick("f", "jiyuu_kakutoku", null, "가상 선수"),
        pick("f", "shihaika", 2, "山口 弘佑"),
      ],
      bids: [],
      ...META,
    });
    const rows = db.raw
      .prepare("SELECT round_no, name_display FROM draft_pick WHERE season = 2001 AND kind = 'jiyuu_kakutoku' ORDER BY round_no")
      .all() as unknown as Array<{ round_no: number; name_display: string }>;
    assert.equal(rows.length, 2, "회차가 없다고 버리지 않는다 — 실재하는 지명이다");
    assert.deepEqual(rows.map((r) => r.round_no), [1, 2], "⚠0 이 아니라 1 부터다");
    assert.equal(rows[0]?.name_display, "江尻 慎太郎", "입력 순서가 곧 순번이다");
    assert.equal(bidsOf(db, 2001).length, 0, "自由獲得 에는 추첨이 없다 — 입찰 행을 만들지 않는다");
  });
});

test("⚠한 구획에 회차 있는 지명과 없는 지명이 섞이면 던진다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2001,
          team: "f",
          picks: [pick("f", "jiyuu_kakutoku", null, "江尻 慎太郎"), pick("f", "jiyuu_kakutoku", 3, "가상 선수")],
          bids: [],
          ...META,
        }),
      /회차/,
      "순번을 매기면 우리가 만든 1 이 소스의 1 과 같은 칼럼에서 부딪친다",
    );
  });
});

test("⚠추첨이 있는 구획의 회차가 비면 던진다 — 없던 1巡目을 만들지 않는다(M7)", async () => {
  await withDb((db) => {
    // 파서는 오늘 이런 모양을 내지 않는다. 그래도 막는 이유: 순번을 매기면 **없던 1巡目이
    // 생기고**, 그 위에 단독지명까지 유도되어 「아무도 안 겹쳤다」는 거짓 사실이 쌓인다.
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "shihaika", null, "堀田 賢慎")],
          bids: [],
          ...META,
        }),
      /회차/,
    );
  });
});

/**
 * ⚠⚠**[I4] 의 회귀 시험 — 가드가 `ikusei` 에서 정확히 뚫려 있었다.**
 *
 * 회차 검사가 「추첨이 있는 구획」(`LOTTERY_KINDS`)으로 묻고 있었는데,
 * **`ikusei` 는 추첨은 없지만 회차는 있다.** 그래서 회차가 빈 育成 입력이 그물을 지나
 * **적재가 1·2 를 지어냈다**(고치기 전 실측):
 * ```
 * g/ikusei roundNo=1,2 (소스)  → round_no 1,2
 * c/ikusei roundNo=null,null   → round_no 1,2   ← 적재가 만든 값. 예외 0건
 * DB: [c/1 빈칸A][c/2 빈칸B][g/1 정상A][g/2 정상B]  ← 구별 불가
 * ```
 * ⚠**그 순간 `draft.ts` 머리말의 표가 거짓이 된다** — 「그 순번이 회차인지 순번인지는
 * `kind` 만이 안다」인데 `ikusei` 에서는 `kind` 를 봐도 모르게 된다.
 * ⚠**시험이 `shihaika` 로만 이 가드를 재고 있었다**(`ikusei` 케이스 0본) — 그래서 초록이었다.
 */
test("⚠育成의 회차가 비어도 던진다 — 추첨은 없지만 회차는 있는 구획이다([I4])", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "c",
          picks: [pick("c", "shihaika", 1, "森下 暢仁"), pick("c", "ikusei", null, "빈칸A"), pick("c", "ikusei", null, "빈칸B")],
          bids: [],
          ...META,
        }),
      /회차/,
      "적재가 1·2 를 지어내면 소스의 회차와 구별할 수 없다",
    );
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM draft_pick").get() as unknown as { n: number };
    assert.equal(n.n, 0, "판정에서 걸렸으므로 SQL 을 만지지 않는다");
  });
});

test("⚠회차 없는 제도는 그대로 통과한다 — 가드가 넓어지면 안 된다", async () => {
  await withDb((db) => {
    // ⚠**여집합 정의가 헛돌지 않는지 본다.** 두 상수를 하나로 합치거나 여집합을 뒤집으면
    //   여기서 붉어진다 — `自由獲得選手`·`希望入団枠獲得選手` 는 회차라는 개념이 없다.
    loadDraft(db, {
      season: 2006,
      team: "g",
      picks: [pick("g", "jiyuu_kakutoku", null, "가상1"), pick("g", "kibou_nyudanwaku", null, "金刃 憲人")],
      bids: [],
      ...META,
    });
    const rows = db.raw
      .prepare("SELECT kind, round_no FROM draft_pick WHERE season = 2006 ORDER BY kind")
      .all() as unknown as Array<{ kind: string; round_no: number }>;
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { kind: "jiyuu_kakutoku", round_no: 1 },
      { kind: "kibou_nyudanwaku", round_no: 1 },
    ]);
  });
});

test("⚠같은 (kind, team, round_no) 지명이 둘이면 던진다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "shihaika", 1, "太田 龍")],
          bids: [],
          ...META,
        }),
      /중복/,
    );
  });
});

// ---- 구획 판정 ----------------------------------------------------------

test("⚠kind 를 shihaika 로 박지 않는다 — 2006 고교생 드래프트 경합", async () => {
  await withDb((db) => {
    // 실측(2006 요미우리): 支配下 지명이 0건이다. 구획은 高校生 · 大学生・社会人 ·
    // 希望入団枠 · 育成 이고, 堂上直倫 경합은 **高校生** 1巡目이다.
    loadDraft(db, {
      season: 2006,
      team: "g",
      picks: [
        pick("g", "kibou_nyudanwaku", null, "金刃 憲人"),
        pick("g", "daigaku_shakaijin", 3, "上野 貴久"),
        pick("g", "koukousei", 1, "坂本 勇人"),
        pick("g", "ikusei", 1, "鈴木 誠"),
      ],
      bids: [bid("g", 1, ["阪神", "中日"], "堂上直倫", false)],
      ...META,
    });
    const rows = bidsOf(db, 2006);
    assert.equal(rows.length, 2, "낙첨 1건 + 유도한 단독 1건");
    for (const r of rows) assert.equal(r.kind, "koukousei", "⚠shihaika 로 박으면 지명이 없는 구획에 입찰이 생긴다");
    const sole = rows.find((r) => r.won === null);
    assert.equal(sole?.name_display, "坂本 勇人", "떨어진 뒤 얻은 高校生 1巡目 이다");
    assert.equal(sole?.round_no, 2);
  });
});

test("⚠1순위 지명이 둘 이상의 구획에 있으면 던진다 — 어느 구획의 경합인지 정하지 않는다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2006,
          team: "t",
          picks: [pick("t", "koukousei", 1, "가상 고교생"), pick("t", "daigaku_shakaijin", 1, "가상 대학생")],
          bids: [bid("t", 1, ["阪神"], "堂上直倫", false)],
          ...META,
        }),
      /구획/,
      "말없이 한쪽을 고르면 경합이 조용히 다른 드래프트에 붙는다",
    );
  });
});

test("⚠1순위 지명이 없는데 경합 주석이 있으면 던진다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "ikusei", 1, "平間 隼人")],
          bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false)],
          ...META,
        }),
      /구획/,
    );
  });
});

// ---- 부분 실패 (M5) -----------------------------------------------------

test("⚠판정에서 걸리면 SQL 을 한 줄도 안 만진다(M5)", async () => {
  await withDb((db) => {
    // 판정은 전부 트랜잭션 **밖**에서 끝낸다 — 여기서 걸리면 애초에 쓰지 않는다.
    // 걸리는 자리는 `firstRoundPick`: 育成만 있는 구단에 1순위 경합 주석이 왔다.
    assert.throws(() =>
      loadDraft(db, {
        season: 2019,
        team: "g",
        picks: [pick("g", "ikusei", 1, "平間 隼人")],
        bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false)],
        ...META,
      }),
    );
    for (const t of ["draft_event", "draft_pick", "draft_bid"]) {
      const n = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as unknown as { n: number };
      assert.equal(n.n, 0, `${t} 에 부분 적재가 남았다`);
    }
  });
});

/**
 * ⚠**출처는 페이지 하나를 가리킨다 — 그러니 한 호출에 구단이 섞이면 안 된다**([I3]).
 * 섞이면 최소 한 구단의 `draft_pick.source` 가 **자기가 실리지 않은 페이지**를 가리키고,
 * 그건 `draft_event` 에서 고친 것과 똑같은 거짓말이 한 층 아래에서 반복되는 것이다.
 * ⚠**그리고 지울 대상도 흐려진다** — 삭제는 「선언한 구단」 하나에만 걸린다.
 */
test("⚠선언한 구단이 아닌 행이 섞이면 던진다 — 남의 페이지 출처를 붙이지 않는다(M4·M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("c", "shihaika", 1, "森下 暢仁")],
          bids: [],
          ...META,
        }),
      /섞였다/,
    );
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
          team: "g",
          picks: [pick("g", "shihaika", 1, "堀田 賢慎")],
          bids: [bid("x", 1, ["阪神"], "가상", false)],
          ...META,
        }),
      /섞였다/,
    );
    for (const t of ["draft_event", "draft_pick", "draft_bid"]) {
      const n = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as unknown as { n: number };
      assert.equal(n.n, 0, `${t} 에 부분 적재가 남았다`);
    }
  });
});

test("⚠쓰는 도중에 터져도 아무것도 남지 않는다 — 되돌린다(M5)", async () => {
  await withDb((db) => {
    // ⚠**여기가 트랜잭션을 실제로 재는 자리다.** 위 시험은 SQL 앞에서 걸려 트랜잭션이
    //   없어도 통과한다. 이건 다르다 — `draft_event` 1행과 첫 지명이 **이미 들어간 뒤**
    //   두 번째 지명이 `waiver_dir` CHECK 에 걸려 터진다.
    const bad = { ...pick("g", "shihaika", 2, "太田 龍"), waiverDir: "↑" as unknown as "→" };
    assert.throws(() =>
      loadDraft(db, {
        season: 2019,
        team: "g",
        picks: [pick("g", "shihaika", 1, "堀田 賢慎"), bad],
        bids: [],
        ...META,
      }),
    );
    for (const t of ["draft_event", "draft_pick", "draft_bid"]) {
      const n = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as unknown as { n: number };
      assert.equal(n.n, 0, `${t} 에 반쯤 쓴 것이 남았다 — 되돌리지 않았다`);
    }
  });
});
