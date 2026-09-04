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

const META = {
  source: "https://npb.jp/draft/2019/",
  fetchedAt: "2026-09-05T00:00:00Z",
  revision: "sha256:test",
};

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
    assert.equal(picks[0]?.source, META.source);
    assert.equal(picks[0]?.fetched_at, META.fetchedAt);
    assert.equal(picks[0]?.revision, META.revision);

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
      assert.equal(e.source, META.source);
      assert.equal(e.fetched_at, META.fetchedAt);
      assert.equal(e.revision, META.revision);
      assert.equal(e.held_on, null, "개최일은 이 소스가 안 준다(M11)");
    }
  });
});

// ---- 멱등 (M5) ----------------------------------------------------------

test("⚠멱등하다 — 두 번 넣어도 한 번과 같다(M5)", async () => {
  await withDb((db) => {
    const input = {
      season: 2019,
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
    loadDraft(db, { season: 2019, picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [], ...META });
    assert.equal(bidsOf(db, 2019).length, 1, "먼저 단독지명 행이 하나 생긴다");
    // 정정으로 1巡目 이 사라진 판. 이번 판에서는 유도할 단독지명이 없다.
    loadDraft(db, { season: 2019, picks: [pick("g", "shihaika", 2, "太田 龍")], bids: [], ...META });
    assert.equal(bidsOf(db, 2019).length, 0, "없어진 지명을 가리키는 입찰 행이 남으면 안 된다");
  });
});

test("⚠다른 구단을 지우지 않는다 — 구단 단위로 다시 넣어도 된다(M5)", async () => {
  await withDb((db) => {
    loadDraft(db, { season: 2019, picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [], ...META });
    loadDraft(db, { season: 2019, picks: [pick("c", "shihaika", 1, "森下 暢仁")], bids: [], ...META });
    const teams = db.raw
      .prepare("SELECT team FROM draft_pick WHERE season = 2019 ORDER BY team")
      .all() as unknown as Array<{ team: string }>;
    assert.deepEqual(teams.map((t) => t.team), ["c", "g"], "구단 2곳 중 2곳이 남는다");
  });
});

// ---- 단독지명 유도 (M11) ------------------------------------------------

test("⚠단독지명은 won 이 NULL 이다 — 낙첨(0)과 구별한다(M11)", async () => {
  await withDb((db) => {
    // 2019 히로시마 실물 모양 — 경합 주석이 0건이다.
    const out = loadDraft(db, {
      season: 2019,
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
    loadDraft(db, {
      season: 2019,
      picks: [pick("s", "shihaika", 1, "奥川 恭伸"), pick("g", "shihaika", 1, "堀田 賢慎")],
      bids: [bid("s", 1, ["読売"], null, true), bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false)],
      ...META,
    });
    const rows = bidsOf(db, 2019).filter((r) => r.won !== null);
    assert.equal(rows.length, 2, "경합 2건 중 2건");
    assert.equal(rows[0]?.group_key, rows[1]?.group_key, "⚠같은 경합이면 group_key 가 같아야 한다");
    assert.equal(rows[0]?.name_canonical, rows[1]?.name_canonical);
  });
});

test("⚠won 이 boolean 이 아니면 던진다 — 3값을 2값으로 접지 않는다(M11)", async () => {
  await withDb((db) => {
    const broken = { ...bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false), won: "確定" as unknown as boolean };
    assert.throws(
      () =>
        loadDraft(db, { season: 2019, picks: [pick("g", "shihaika", 1, "堀田 賢慎")], bids: [broken], ...META }),
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
          picks: [pick("g", "shihaika", null, "堀田 賢慎")],
          bids: [],
          ...META,
        }),
      /회차/,
    );
  });
});

test("⚠같은 (kind, team, round_no) 지명이 둘이면 던진다(M7)", async () => {
  await withDb((db) => {
    assert.throws(
      () =>
        loadDraft(db, {
          season: 2019,
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
    assert.throws(() =>
      loadDraft(db, {
        season: 2019,
        picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("c", "shihaika", 1, "森下 暢仁")],
        bids: [bid("g", 1, ["東京ヤクルト"], "奥川恭伸", false), bid("x", 1, ["阪神"], "가상", false)],
        ...META,
      }),
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
