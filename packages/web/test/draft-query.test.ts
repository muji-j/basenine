/**
 * 드래프트 조회층 — **「비어 있음」이 네 가지 다른 사실이다.**
 *
 * ⚠**이 화면이 뭉뚱그리기 가장 쉬운 자리다.** 같은 「행이 0건」이 네 가지 다른 뜻이고,
 * 넷을 「データがありません」한 줄로 그리면 **전부 거짓**이 된다(M12):
 *
 * | 무엇이 0행인가 | 언제 | 무엇이 참인가 |
 * |---|---|---|
 * | `draft_bid` | **2023·2024·2025** | **NPB 가 공표하지 않는다.** 경합은 실제로 있었고 페이지가 표시만 껐다 |
 * | `draft_bid` (`ikusei` 등) | 전 시즌 | **제도상 추첨이 없다.** 「없다」가 아니라 **물을 것이 아니다** |
 * | `draft_note` | **전 시즌** | **우리가 아직 수집하지 않는다** — 파서가 없다 |
 * | `draft_event` | 개최월 전의 당해·다음 시즌 | **아직 개최되지 않았다** |
 * | `draft_event` | 그 밖 | **우리가 안 받았다.** ⚠**개최 여부를 단정하지 않는다** |
 *
 * ⚠**마지막 두 줄을 「보유 최신 시즌보다 뒤인가」로 가르면 안 된다** — 수집이 **연 1회 수동**이라
 * 한 사이클만 놓치면 **이미 끝난 드래프트를 「まだ開催されていません」이라고 단정**한다.
 * 판정은 **주입된 `builtOn`** 의 연·월로 한다(M6).
 *
 * ⚠**실측(2026-09-05 · `data/archive` 275장을 임시 DB 에 적재해 잼)**:
 * `draft_pick` **2,234** · `draft_bid` **374** · `draft_event` **47** · `draft_note` **0** ·
 * 경합 그룹 **75** 이고 **75/75 가 당첨 정확히 1** · `player_id` 는
 * **2,234/2,234 · 374/374 전건 NULL**(적재가 안 넣는다 · M10).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { DRAFT_KINDS } from "@bb-app/parser";
import { toString } from "../src/html.ts";
import { stateNote } from "../src/layout.ts";
import {
  DRAFT_KIND_LABEL,
  DRAFT_KIND_ORDER,
  DRAFT_NOTES_COLLECTED,
  loadDraftPage,
} from "../src/query.ts";

const NOW = "2026-09-05T00:00:00.000Z";
const BUILT_ON = "2026-09-05";

/** 픽스처의 출처 한 벌. ⚠**M4 는 컬럼이 아니라 「답할 수 있는가」다** — 채워 둔다 */
const PROV = { source: "https://example.invalid/draft/", fetchedAt: NOW, revision: "deadbeef" };

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/* ---- 데이터 빌더 + 덮어쓰기 (`packages/web/test/` 관용) -------------------- */

function event(db: Db, o: { season: number; kind: string; license?: string | null }): void {
  db.raw
    .prepare(
      `INSERT INTO draft_event (season, kind, held_on, source, fetched_at, revision, license)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(o.season, o.kind, PROV.source, PROV.fetchedAt, PROV.revision, o.license ?? null);
}

interface PickOver {
  season?: number;
  kind?: string;
  team?: string;
  roundNo?: number;
  nameDisplay?: string;
  position?: string | null;
  fromOrg?: string | null;
  playerId?: string | null;
}

function pick(db: Db, o: PickOver = {}): void {
  db.raw
    .prepare(
      `INSERT INTO draft_pick
         (season, kind, team, round_no, pick_seq, waiver_dir, name_display, name_canonical,
          position, from_org, origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'npb', ?, ?, ?, ?)`,
    )
    .run(
      o.season ?? 2019,
      o.kind ?? "shihaika",
      o.team ?? "g",
      o.roundNo ?? 1,
      o.nameDisplay ?? "山田 太郎",
      (o.nameDisplay ?? "山田 太郎").replace(/\s+/gu, ""),
      o.position ?? "投手",
      o.fromOrg ?? "架空高",
      o.playerId ?? null,
      PROV.source,
      PROV.fetchedAt,
      PROV.revision,
    );
}

interface BidOver {
  season?: number;
  kind?: string;
  roundNo?: number;
  team?: string;
  groupKey?: string | null;
  won?: 0 | 1 | null;
  nameDisplay?: string;
  rivals?: string | null;
  playerId?: string | null;
}

function bid(db: Db, o: BidOver = {}): void {
  const groupKey = o.groupKey === undefined ? null : o.groupKey;
  db.raw
    .prepare(
      `INSERT INTO draft_bid
         (season, kind, round_no, team, group_key, won, name_display, name_canonical,
          rivals, origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'npb', ?, ?, ?, ?)`,
    )
    .run(
      o.season ?? 2019,
      o.kind ?? "shihaika",
      o.roundNo ?? 1,
      o.team ?? "g",
      groupKey,
      o.won === undefined ? null : o.won,
      o.nameDisplay ?? "佐々木 朗希",
      (o.nameDisplay ?? "佐々木 朗希").replace(/\s+/gu, ""),
      groupKey === null ? null : (o.rivals ?? null),
      o.playerId ?? null,
      PROV.source,
      PROV.fetchedAt,
      PROV.revision,
    );
}

/** 선수 페이지가 **실제로 생기는** 최소 조건: `player` 행 + 그 시즌 타석 기록 */
function playerWithPage(db: Db, playerId: string, season: number): void {
  db.raw
    .prepare(
      `INSERT INTO player (player_id, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)`,
    )
    .run(playerId, playerId, NOW, NOW);
  const gameId = `${season}/0401/g-t-1-${playerId}`;
  db.raw
    .prepare(
      `INSERT INTO game (game_id, season, game_date, away_code, home_code, game_no, status,
                         competition, source_url, fetched_at)
       VALUES (?, ?, ?, 'g', 't', 1, 'played', 'regular', ?, ?)`,
    )
    .run(gameId, season, `${season}-04-01`, PROV.source, PROV.fetchedAt);
  db.raw
    .prepare(
      `INSERT INTO batting_line (game_id, player_id, side, pa, ab, h, d2, d3, hr, bb, ibb, hbp,
                                 sf, sh, so, roe, runs, rbi, sb)
       VALUES (?, ?, 'home', 4, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0)`,
    )
    .run(gameId, playerId);
}

/** `player` 에는 있는데 **그 시즌 페이지는 없는** 선수(경기 기록 0건) */
function playerWithoutPage(db: Db, playerId: string): void {
  db.raw
    .prepare(
      `INSERT INTO player (player_id, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)`,
    )
    .run(playerId, playerId, NOW, NOW);
}

/* ---- 시험 --------------------------------------------------------------- */

test("경합 그룹이 회차별로 묶인다 — 당첨 1 + 낙첨 N · 분모까지", async () => {
  await withDb((db) => {
    event(db, { season: 2019, kind: "shihaika" });
    pick(db, { season: 2019, team: "m", roundNo: 1, nameDisplay: "佐々木 朗希" });
    // 1회차 · 4구단 경합
    bid(db, { team: "m", groupKey: "1:佐々木朗希", won: 1, rivals: '["北海道日本ハム","東北楽天","埼玉西武"]' });
    for (const t of ["e", "f", "l"]) bid(db, { team: t, groupKey: "1:佐々木朗希", won: 0 });
    // 1회차 · 3구단 경합
    bid(db, { team: "s", groupKey: "1:奥川恭伸", won: 1, nameDisplay: "奥川 恭伸" });
    for (const t of ["g", "t"]) bid(db, { team: t, groupKey: "1:奥川恭伸", won: 0, nameDisplay: "奥川恭伸" });
    // 1회차 · 단독지명(경합 그룹의 여집합)
    bid(db, { team: "c", groupKey: null, won: null, nameDisplay: "森下 暢仁" });
    // 2회차(외れ1位)
    bid(db, { roundNo: 2, team: "l", groupKey: "2:宮川哲", won: 1, nameDisplay: "宮川 哲" });
    bid(db, { roundNo: 2, team: "g", groupKey: "2:宮川哲", won: 0, nameDisplay: "宮川哲" });

    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    assert.equal(data.sections.length, 1);
    const bids = data.sections[0]!.bids;
    assert.notEqual(bids, null, "支配下 는 추첨이 있는 구획이다");
    assert.equal(bids!.state.kind, "ok");

    assert.deepEqual(
      bids!.rounds.map((r) => r.roundNo),
      [1, 2],
      "회차가 오름차순으로 갈린다",
    );
    const first = bids!.rounds[0]!;
    assert.equal(first.groups.length, 2, "1회차에 경합 그룹 2개");
    const sasaki = first.groups.find((g) => g.name.canonical === "佐々木朗希")!;
    assert.equal(sasaki.winner?.team.code, "m");
    assert.equal(sasaki.losers.length, 3);
    // ⚠**분모다**(M2) — 「5球団競合」을 화면이 세지 않고 여기서 받는다
    assert.equal(sasaki.teams, 4, "당첨 1 + 낙첨 3");
    assert.deepEqual(sasaki.winner?.rivals, ["北海道日本ハム", "東北楽天", "埼玉西武"]);
    // ⚠**낙첨 행은 상대 문장이 없을 수 있다** — `null` 은 「원래 없음」이다(M11)
    assert.equal(sasaki.losers[0]!.rivals, null);
    // ⚠**세 값을 두 값으로 접지 마라**(M11): 당첨 1 · 낙첨 0 · **단독지명 null**
    assert.equal(sasaki.winner?.won, 1);
    assert.deepEqual(sasaki.losers.map((l) => l.won), [0, 0, 0]);
    assert.equal(first.solo[0]?.won, null);

    // ⚠**단독지명은 회차마다 나온다**(실측 2019: 1·2·3회차 전부에 있다) — 블록에 몰아 두면
    //   「어느 회차의 단독인가」가 사라지고 화면의 서사가 무너진다
    assert.equal(first.solo.length, 1, "단독지명은 그룹이 아니라 따로 온다");
    assert.equal(first.solo[0]!.team.code, "c");
    assert.equal(bids!.rounds[1]!.solo.length, 0);
    assert.deepEqual(bids!.counts, { bids: 10, groups: 3, solo: 1 });
    assert.deepEqual(data.defects.groupsWithoutWinner, []);
    assert.deepEqual(data.defects.groupsWithManyWinners, []);
  });
});

test("⚠2023 은 「데이터 없음」이 아니다 — NPB 가 공표하지 않는 것이다", async () => {
  await withDb((db) => {
    event(db, { season: 2023, kind: "shihaika" });
    pick(db, { season: 2023, team: "g", roundNo: 1 });
    pick(db, { season: 2023, team: "t", roundNo: 1 });

    const data = loadDraftPage(db, { season: 2023, builtOn: BUILT_ON });
    const bids = data.sections[0]!.bids;
    assert.notEqual(bids, null);
    // ⚠**이 줄이 이 태스크의 핵심이다.** `empty` 로 떨어지면 화면이 거짓말을 한다
    assert.notEqual(bids!.state.kind, "empty", "「데이터 없음」이 아니다 — 경합은 실제로 있었다");
    assert.notEqual(bids!.state.kind, "failed", "우리가 취득에 실패한 것도 아니다");
    assert.equal(bids!.state.kind, "unpublished");
    assert.match(
      bids!.state.kind === "unpublished" ? bids!.state.detail : "",
      /NPB/u,
      "누가 공표하지 않는지 문장이 말해야 한다",
    );
    assert.deepEqual(bids!.counts, { bids: 0, groups: 0, solo: 0 });
    // 지명 자체는 정상이다 — 「그 해는 원래 비어 있다」로 읽히면 안 된다
    assert.equal(data.sections[0]!.pickCount, 2);
    assert.equal(data.state.kind, "ok");
  });
});

test("⚠`player` 에 없는 선수도 행이 남는다 — 링크만 빠지고 이름은 남는다", async () => {
  await withDb((db) => {
    playerWithPage(db, "p-linked", 2020);
    playerWithoutPage(db, "p-nopage");
    event(db, { season: 2019, kind: "shihaika" });
    pick(db, { season: 2019, team: "g", roundNo: 1, nameDisplay: "出た 選手", playerId: "p-linked" });
    pick(db, { season: 2019, team: "t", roundNo: 1, nameDisplay: "登録のみ 選手", playerId: "p-nopage" });
    // ⚠**입단 거부·은퇴·1군 미등록** — 우리 `player` 에 영영 없는 선수
    pick(db, { season: 2019, team: "c", roundNo: 1, nameDisplay: "拒否 選手", playerId: null });

    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    const picks = data.sections[0]!.rounds[0]!.picks;
    assert.equal(picks.length, 3, "⚠행을 지우지 마라 — 그 지명은 실제로 있었다");
    const byName = new Map(picks.map((p) => [p.name.display, p]));

    assert.deepEqual(byName.get("出た 選手")!.name.link, { playerId: "p-linked", season: 2020 });
    assert.equal(byName.get("登録のみ 選手")!.name.link, null, "페이지가 없으면 링크도 없다");
    assert.equal(byName.get("登録のみ 選手")!.name.display, "登録のみ 選手", "이름은 남는다");
    assert.equal(byName.get("拒否 選手")!.name.link, null);
    assert.equal(byName.get("拒否 選手")!.name.display, "拒否 選手");

    // ⚠**「0건」과 「안 쟀음」을 구별한다** — 분모가 붙어 있어야 그 구별이 화면까지 간다
    assert.deepEqual(data.links, { linked: 1, total: 3 });
  });
});

test("⚠당첨이 없는 경합 그룹을 조용히 건너뛰지 않는다 — 데이터에 남는다(INV-N1)", async () => {
  await withDb((db) => {
    event(db, { season: 2019, kind: "shihaika" });
    pick(db, { season: 2019 });
    bid(db, { team: "g", groupKey: "1:誰か", won: 0 });
    bid(db, { team: "t", groupKey: "1:誰か", won: 0 });
    bid(db, { team: "c", groupKey: "1:二人", won: 1, nameDisplay: "二人 目" });
    bid(db, { team: "d", groupKey: "1:二人", won: 1, nameDisplay: "二人 目" });

    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    const groups = data.sections[0]!.bids!.rounds[0]!.groups;
    const orphan = groups.find((g) => g.groupKey === "1:誰か")!;
    assert.notEqual(orphan, undefined, "⚠그룹 자체가 사라지면 안 된다");
    assert.equal(orphan.winner, null);
    assert.equal(orphan.losers.length, 2);
    assert.equal(orphan.teams, 2);

    // ⚠**당첨이 둘일 때 둘째 행이 사라지면 안 된다** — 「당첨」과 「낙첨」으로 두 번 거르면
    //   어느 쪽에도 안 들어가 **조용히 없어진다**(자기 검토에서 실제로 그랬다)
    const twin = groups.find((g) => g.groupKey === "1:二人")!;
    assert.equal(twin.teams, 2);
    assert.equal((twin.winner === null ? 0 : 1) + twin.losers.length, twin.teams, "그룹의 전부가 남는다");
    assert.deepEqual(
      [twin.winner!.team.code, twin.losers[0]!.team.code].sort(),
      ["c", "d"],
      "두 구단 다 화면까지 간다",
    );
    // ⚠섞여 들어온 행은 자기 `won` 으로 스스로를 밝힌다
    assert.equal(twin.losers[0]!.won, 1);

    assert.deepEqual(data.defects.groupsWithoutWinner, ["1:誰か"]);
    assert.deepEqual(data.defects.groupsWithManyWinners, ["1:二人"]);
  });
});

test("⚠`draft_note` 0행은 「없었다」가 아니라 「아직 수집하지 않는다」다(M11)", async () => {
  await withDb((db) => {
    event(db, { season: 2019, kind: "shihaika" });
    pick(db, { season: 2019 });

    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    assert.deepEqual(data.notes.rows, []);
    assert.notEqual(data.notes.state.kind, "empty", "0 과 미수집을 섞지 마라");
    assert.equal(data.notes.state.kind, "uncollected");
  });
});

test("⚠기록이 없는 시즌은 「개최 전」이다 — 「데이터 없음」이 아니다", async () => {
  await withDb((db) => {
    event(db, { season: 2025, kind: "shihaika" });
    pick(db, { season: 2025 });

    const data = loadDraftPage(db, { season: 2026, builtOn: BUILT_ON });
    assert.equal(data.state.kind, "offseason");
    assert.equal(data.sections.length, 0);
    assert.match(data.state.kind === "offseason" ? data.state.detail : "", /開催/u);
    // 시즌 전환은 **우리가 실제로 가진 해**에서 나온다 — 화면이 목록을 박으면 백필할 때마다 거짓이 된다
    assert.deepEqual(data.heldSeasons, [2025]);
  });
});

test("⚠한 해도 없는 DB 를 「개최 전」이라고 하지 않는다 — 그건 우리가 안 받은 것이다", async () => {
  await withDb((db) => {
    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    // ⚠2019 드래프트는 **실제로 열렸다.** 「まだ開催されていません」는 순전한 거짓이다
    assert.equal(data.state.kind, "uncollected");
    assert.deepEqual(data.heldSeasons, []);
  });
});

test("⚠후일담 행이 있으면 「아직 수집하지 않는다」라고 하지 않는다", async () => {
  await withDb((db) => {
    event(db, { season: 2005, kind: "koukousei" });
    pick(db, { season: 2005, kind: "koukousei", team: "g", roundNo: 1 });
    db.raw
      .prepare(
        `INSERT INTO draft_note (season, kind, team, name_display, note_kind, detail,
                                 source, fetched_at, revision)
         VALUES (2005, 'koukousei', 'g', '辻内 崇伸', 'kousyouken_teisei', '交渉権が訂正された', ?, ?, ?)`,
      )
      .run(PROV.source, PROV.fetchedAt, PROV.revision);

    const data = loadDraftPage(db, { season: 2005, builtOn: BUILT_ON });
    assert.equal(data.notes.rows.length, 1);
    // ⚠화면이 그리고 있는 것을 상태가 부정하면 안 된다
    assert.equal(data.notes.state.kind, "ok");
    assert.equal(data.notes.rows[0]!.noteKind, "kousyouken_teisei");
  });
});

test("⚠수집 범위보다 앞선 시즌은 「개최 전」이 아니라 「미수집」이다", async () => {
  await withDb((db) => {
    event(db, { season: 2025, kind: "shihaika" });
    pick(db, { season: 2025 });

    const data = loadDraftPage(db, { season: 2004, builtOn: BUILT_ON });
    assert.equal(data.state.kind, "uncollected", "2004 는 열렸다 — 우리가 안 받았을 뿐이다");
  });
});

/**
 * ⚠⚠**수집을 한 사이클 놓치면 화면이 「아직 열리지 않았습니다」라고 거짓말을 한다.**
 *
 * 드래프트 수집은 **연 1회 수동 실행**이고 자동화도 리마인더도 없다(`docs/operations/draft-backfill.md`).
 * 그래서 「보유 최신 시즌보다 뒤 = 아직 개최 전」은 **성립하지 않는다** — 위험 창은 「며칠」이 아니라
 * **다음에 사람이 그 명령을 칠 때까지**이고, 상한이 없다.
 * ⚠**이 화면 전체가 막으려던 「틀린 사실을 조용히 보여준다」가 시즌 단위에서 재발한 것이다**(CLAUDE.md §6).
 */
test("⚠⚠수집을 걸러 먹은 지난 시즌을 「아직 개최되지 않았다」고 말하지 않는다", async () => {
  await withDb((db) => {
    // 마지막으로 수집한 것이 2023 이고, 오늘은 2026-09-05 다 — 2024·2025 는 **이미 끝났다**
    event(db, { season: 2023, kind: "shihaika" });
    pick(db, { season: 2023 });

    for (const season of [2024, 2025]) {
      const data = loadDraftPage(db, { season, builtOn: "2026-09-05" });
      const detail = data.state.kind === "ok" ? "" : data.state.detail;
      assert.notEqual(
        data.state.kind,
        "offseason",
        `${season}年のドラフトは実際に開催された — 「開催前」と言ってはいけない`,
      );
      assert.doesNotMatch(detail, /まだ開催されていません/u, `${season}: 거짓 사실 진술`);
      assert.equal(data.state.kind, "uncollected");
    }
  });
});

test("⚠그래도 진짜 「개최 전」은 개최 전이라고 말한다 — 확신을 통째로 버리지 않는다", async () => {
  await withDb((db) => {
    event(db, { season: 2025, kind: "shihaika" });
    pick(db, { season: 2025 });

    // 2026-09-05 는 **예년 개최월(10월) 전**이라 2026 은 확실히 아직 안 열렸다
    const before = loadDraftPage(db, { season: 2026, builtOn: "2026-09-05" });
    assert.equal(before.state.kind, "offseason");
    assert.match(before.state.kind === "offseason" ? before.state.detail : "", /まだ開催されていません/u);

    // ⚠**다음 해는 달을 볼 것도 없다** — 아직 오지 않은 시즌이다
    const nextYear = loadDraftPage(db, { season: 2027, builtOn: "2026-11-30" });
    assert.equal(nextYear.state.kind, "offseason");
  });
});

test("⚠개최월이 지난 당해 시즌은 「모른다」고 말한다 — 어느 쪽으로도 단정하지 않는다", async () => {
  await withDb((db) => {
    event(db, { season: 2025, kind: "shihaika" });
    pick(db, { season: 2025 });

    // 2026-11-01 — 예년 개최월이 지났다. **열렸는데 우리가 아직 안 받은 것일 수 있다**
    const data = loadDraftPage(db, { season: 2026, builtOn: "2026-11-01" });
    assert.equal(data.state.kind, "uncollected");
    const detail = data.state.kind === "uncollected" ? data.state.detail : "";
    assert.doesNotMatch(detail, /まだ開催されていません/u, "단정하면 안 된다");
    assert.match(detail, /判定できません|かもしれません/u, "모른다는 것을 말해야 한다");
  });
});

/**
 * ⚠**같은 함수 안에서 시즌 목록과 구획 목록이 다른 규칙을 쓰면 안 된다.**
 * `kinds` 는 event ∪ pick ∪ bid 합집합인데 `heldSeasons` 만 `draft_event` 단독이었다 —
 * 그러면 **화면에는 지명이 보이는데 시즌 전환 목록에는 그 해가 없다.**
 * ⚠지금 그 상태가 안 생기는 것은 적재기가 event 와 pick 을 한 트랜잭션에서 쓰기 때문이지
 * **이 함수가 보장하는 것이 아니다** — 계획된 wikipedia 적재기가 그 계약을 유지할지 모른다.
 */
test("⚠`draft_event` 가 없어도 지명이 있으면 그 시즌은 존재한다 — 목록에서도 화면에서도", async () => {
  await withDb((db) => {
    event(db, { season: 2025, kind: "shihaika" });
    pick(db, { season: 2025 });
    // ⚠이벤트 행 **없이** 지명만
    pick(db, { season: 2020, kind: "shihaika", team: "l", roundNo: 1, nameDisplay: "孤児 指名" });

    const data = loadDraftPage(db, { season: 2020, builtOn: BUILT_ON });
    // ⑴ 구획 합집합 — 이 본이 없으면 `kinds` 를 `events.map(...)` 로 되돌려도 아무도 안 죽는다
    assert.equal(data.sections.length, 1, "지명이 있으면 구획이 선다");
    assert.equal(data.sections[0]!.pickCount, 1);
    assert.equal(data.sections[0]!.rounds[0]!.picks[0]!.name.display, "孤児 指名");
    // ⚠출처를 못 대는 것은 숨기지 않는다(M4)
    assert.equal(data.sections[0]!.source, null);
    // ⑵ 시즌 목록도 같은 규칙이어야 한다 — 안 그러면 그 해 페이지가 안 만들어진다
    assert.deepEqual(data.heldSeasons, [2020, 2025]);
  });
});

/**
 * ⚠**모르는 값을 조용히 넘기지 않는다**(M7). DB 의 `CHECK` 가 앞을 막고 있지만
 * **그 제약이 느슨해지거나 새 값이 생긴 날** 화면이 무엇을 하는지가 여기서 정해진다.
 * `PRAGMA ignore_check_constraints` 로 그 미래를 지금 재 본다.
 */
test("⚠어휘 밖 값은 빈 화면이 아니라 예외다 — 다섯 자리 전부(M7)", async () => {
  await withDb((db) => {
    db.raw.exec("PRAGMA ignore_check_constraints = ON");
    event(db, { season: 2019, kind: "shihaika" });

    // ⚠메시지까지 본다 — 아무 예외나 받으면 **삽입이 실패해도 초록**이 되어 시험이 공회전한다
    const cases: { what: string; message: RegExp; run: () => void }[] = [
      {
        what: "구획",
        message: /모르는 드래프트 구획/u,
        run: () => pick(db, { season: 2019, kind: "unknown_kind", team: "g", roundNo: 1 }),
      },
      {
        what: "출처",
        message: /모르는 드래프트 출처/u,
        run: () =>
          db.raw
            .prepare(
              `INSERT INTO draft_pick (season, kind, team, round_no, name_display, origin,
                                       source, fetched_at, revision)
               VALUES (2019, 'shihaika', 'd', 2, 'x', 'somewhere', ?, ?, ?)`,
            )
            .run(PROV.source, PROV.fetchedAt, PROV.revision),
      },
      {
        what: "웨이버 방향",
        message: /모르는 웨이버 방향/u,
        run: () =>
          db.raw
            .prepare(
              `INSERT INTO draft_pick (season, kind, team, round_no, waiver_dir, name_display,
                                       origin, source, fetched_at, revision)
               VALUES (2019, 'shihaika', 'c', 3, '↑', 'x', 'npb', ?, ?, ?)`,
            )
            .run(PROV.source, PROV.fetchedAt, PROV.revision),
      },
      {
        what: "추첨 결과",
        message: /모르는 추첨 결과/u,
        run: () =>
          db.raw
            .prepare(
              `INSERT INTO draft_bid (season, kind, round_no, team, won, name_display, origin,
                                      source, fetched_at, revision)
               VALUES (2019, 'shihaika', 1, 'e', 7, 'x', 'npb', ?, ?, ?)`,
            )
            .run(PROV.source, PROV.fetchedAt, PROV.revision),
      },
      {
        what: "경합 상대",
        message: /경합 상대가 문자열 배열이 아니다/u,
        // ⚠**`json_valid('{}')` 는 1 이다**(실측) — 020 의 CHECK 는 배열까지 보지 않는다.
        //   여기는 제약을 끄지 않아도 통과하는 진짜 구멍이다
        run: () =>
          db.raw
            .prepare(
              `INSERT INTO draft_bid (season, kind, round_no, team, group_key, won, name_display,
                                      rivals, origin, source, fetched_at, revision)
               VALUES (2019, 'shihaika', 1, 'f', '1:x', 1, 'x', '{}', 'npb', ?, ?, ?)`,
            )
            .run(PROV.source, PROV.fetchedAt, PROV.revision),
      },
    ];

    for (const c of cases) {
      c.run();
      assert.throws(
        () => loadDraftPage(db, { season: 2019, builtOn: BUILT_ON }),
        c.message,
        `${c.what}: 어휘 밖 값이 조용히 화면까지 갔다`,
      );
      // 다음 자리를 재려면 이 행을 치운다 — 안 그러면 첫 예외가 나머지를 가린다
      db.raw.exec("DELETE FROM draft_pick; DELETE FROM draft_bid");
    }
  });
});

test("⚠`ikusei` 의 입찰 0행은 상태가 아니다 — 제도상 추첨이 없다", async () => {
  await withDb((db) => {
    event(db, { season: 2019, kind: "ikusei" });
    pick(db, { season: 2019, kind: "ikusei", team: "g", roundNo: 1 });

    const data = loadDraftPage(db, { season: 2019, builtOn: BUILT_ON });
    assert.equal(data.sections[0]!.kind, "ikusei");
    // ⚠`null` = 「물을 것이 아니다」. `unpublished` 로 그리면 **NPB 탓을 하는 거짓말**이 된다
    assert.equal(data.sections[0]!.bids, null);
  });
});

test("⚠모르는 구단 코드로 「YB」를 지어내지 않는다 — 그 사실이 데이터에 남는다(M7)", async () => {
  await withDb((db) => {
    event(db, { season: 2005, kind: "koukousei" });
    // 실측: `yb`(横浜 2005~2011) 53지명 · `bs`(オリックス 2005~2018) 116지명
    pick(db, { season: 2005, kind: "koukousei", team: "yb", roundNo: 1, nameDisplay: "山口 俊" });
    pick(db, { season: 2005, kind: "koukousei", team: "bs", roundNo: 2, nameDisplay: "岡田 貴弘" });

    const data = loadDraftPage(db, { season: 2005, builtOn: BUILT_ON });
    const all = data.sections[0]!.rounds.flatMap((r) => r.picks);
    const yb = all.find((p) => p.team.code === "yb")!;
    const bs = all.find((p) => p.team.code === "bs")!;
    // `bs` 는 도메인이 아는 옛 슬러그다(`TEAM_CODE_ALIASES`)
    assert.equal(bs.team.shortName, "オリックス");
    // ⚠`yb` 는 모른다. `shortNameOf` 에 그대로 넘기면 **「YB」라는 정체불명의 이름**이 화면에 나간다
    assert.equal(yb.team.shortName, null);
    assert.deepEqual(data.unknownTeamCodes, ["yb"]);
  });
});

test("⚠구획 어휘표가 `DRAFT_KINDS` 6종을 전부 덮는다 — 어휘는 한 벌이다(M1)", () => {
  for (const kind of DRAFT_KINDS) {
    assert.equal(typeof DRAFT_KIND_LABEL[kind], "string", `${kind} 의 표기가 없다`);
    assert.notEqual(DRAFT_KIND_LABEL[kind], "", `${kind} 의 표기가 비었다`);
  }
  // ⚠**반대 방향도 본다** — 구획이 사라졌는데 표기만 남으면 화면에 유령 구획이 생긴다
  assert.equal(Object.keys(DRAFT_KIND_LABEL).length, DRAFT_KINDS.length);
  assert.equal(new Set(Object.values(DRAFT_KIND_LABEL)).size, DRAFT_KINDS.length, "표기가 겹친다");

  /**
   * ⚠**표시 순서도 6종을 전부 덮어야 한다.** 빠진 구획은 `indexOf` 가 `-1` 을 내서
   * **말없이 맨 앞으로 튀어나온다** — 타입이 안 잡는 자리라 시험이 유일한 그물이다.
   */
  assert.deepEqual([...DRAFT_KIND_ORDER].sort(), [...DRAFT_KINDS].sort());
});

test("⚠새 상태 둘이 서로 다른 문장으로 그려진다 — 넷으로는 이 화면을 말할 수 없었다(M12)", () => {
  const unpublished = toString(stateNote({ kind: "unpublished", detail: "NPBが公表していません" }));
  const uncollected = toString(stateNote({ kind: "uncollected", detail: "パーサーがありません" }));
  const empty = toString(stateNote({ kind: "empty", detail: "ありません" }));
  assert.notEqual(unpublished, uncollected);
  assert.notEqual(unpublished, empty);
  assert.notEqual(uncollected, empty);
  assert.match(unpublished, /公表/u);
  assert.match(uncollected, /収集/u);
});

test("⚠`draft_note` 미수집 플래그가 실제 파서와 맞는다 — 안 고치면 영영 「아직」이다", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const parser = readFileSync(join(here, "..", "..", "parser", "src", "index.ts"), "utf8");
  // 파서가 후일담을 읽기 시작하면 이 시험이 붉어진다 — 그때 플래그를 `true` 로 바꿔라
  const hasNoteParser = /parseDraftNotes/u.test(parser);
  assert.equal(
    DRAFT_NOTES_COLLECTED,
    hasNoteParser,
    "파서의 유무와 플래그가 어긋났다 — 화면이 「아직 수집하지 않는다」를 거짓으로 말하게 된다",
  );
});
