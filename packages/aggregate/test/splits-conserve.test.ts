/**
 * **스플릿이 타석을 잃지도 만들지도 않는가.**
 *
 * ⚠**축마다 나누는 방법은 다른데, 나눈 조각의 합은 언제나 같아야 한다** —
 * 「행의 합 + 분류 못한 것 = 전체」. 이 하나가 안 맞으면 화면의 모든 비율이 조용히 틀린다.
 *
 * ⚠**스플릿에는 외부 정답이 없다.** 시즌 집계는 npb.jp 공표표와 맞출 수 있지만
 * (`crosscheck.ts` · 3,879명 / 69,501항목), **스플릿을 공표하는 곳은 없다.**
 * 그래서 여기서 재는 것은 **외부 일치**가 아니라 **내부 보존**이다 — 그것이 우리가 물을 수 있는 질문이다.
 *
 * ⚠**이 시험이 없었다**(2026-08-31 실측: `splits.test.ts` 14본 중 합계를 보는 것 0본).
 * 축마다 「이 조건이 이 행에 들어가는가」는 봤지만 **「전부 더하면 원래대로인가」는 아무도 안 봤다.**
 * CLAUDE.md 가 경고하는 **상대구단 뒤집힘**(타자에게는 수비하는 쪽, 투수에게는 치는 쪽)은
 * 값도 합계도 그럴듯해서 눈으로는 못 잡는데, **보존은 뒤집혀도 성립하므로 이 시험도 못 잡는다** —
 * 그건 `opponent-split.test.ts` 가 따로 본다. 여기서 잡는 것은 **새는 것과 겹치는 것**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, replacePaEvents, upsertGame, upsertPlayer } from "@bb-app/store";
import type { Db, PaEventRow } from "@bb-app/store";
import { SPLIT_DIMENSIONS, battingSplits, pitchingSplits } from "../src/splits.ts";

const NOW = "2026-08-15T00:00:00.000Z";

function seedGame(db: Db, id: string, date: string, away: string, home: string): void {
  upsertGame(db, {
    gameId: id, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: `https://npb.jp/${id}`, fetchedAt: NOW,
  });
}

function seedPlayer(db: Db, id: string, name: string, throws: string | null, bats: string | null): void {
  upsertPlayer(db, id, name, NOW);
  db.raw.prepare("UPDATE player SET throws = ?, bats = ? WHERE player_id = ?").run(throws, bats, id);
}

function event(o: Partial<PaEventRow> & { gameId: string; seq: number; batterId: string }): PaEventRow {
  return {
    inning: 1, half: "top", outsBefore: 0, bases: "",
    pitcherId: "P1", outcome: "single", rbi: 0, runsScored: 0,
    rawBox: "中前安", rawPbp: "センター前ヒット", ballCount: null, status: "final",
    ...o,
  };
}

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-conserve-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * **일부러 어수선하게 심는다.** 경기가 여럿 · 구장이 여럿 · 달이 다르고 ·
 * **투타를 모르는 상대**가 섞여 있다 — 마지막 것이 「분류 못한 것」을 실제로 만든다.
 * ⚠**깨끗한 표본으로는 보존을 못 잰다** — 미분류가 0이면 등식의 절반이 사라진다.
 */
function seedMessy(db: Db): { batter: string; pitcher: string; total: number } {
  seedGame(db, "g1", "2026-04-01", "t", "g");
  seedGame(db, "g2", "2026-05-02", "g", "t");
  seedGame(db, "g3", "2026-05-03", "c", "t");
  seedPlayer(db, "B1", "타자", "right", "left");
  seedPlayer(db, "P1", "우완", "right", "right");
  seedPlayer(db, "P2", "좌완", "left", "right");
  seedPlayer(db, "P3", "미상", null, null); // ⚠투타 미상 — 좌우 축에서 빠진다
  seedPlayer(db, "B2", "상대타자", null, null); // ⚠투수 축의 미분류를 만든다

  const rows: PaEventRow[] = [
    event({ gameId: "g1", seq: 1, batterId: "B1", pitcherId: "P1", half: "top" }),
    event({ gameId: "g1", seq: 2, batterId: "B1", pitcherId: "P2", half: "top", outcome: "walk" }),
    event({ gameId: "g1", seq: 3, batterId: "B1", pitcherId: "P3", half: "top", outcome: "strikeout" }),
    event({ gameId: "g2", seq: 1, batterId: "B1", pitcherId: "P1", half: "bottom", bases: "1" }),
    event({ gameId: "g2", seq: 2, batterId: "B1", pitcherId: "P3", half: "bottom", outcome: "homerun" }),
    event({ gameId: "g3", seq: 1, batterId: "B1", pitcherId: "P2", half: "bottom", bases: "2" }),
    event({ gameId: "g3", seq: 2, batterId: "B2", pitcherId: "P1", half: "top" }),
    event({ gameId: "g3", seq: 3, batterId: "B2", pitcherId: "P1", half: "top", outcome: "walk" }),
  ];
  for (const g of ["g1", "g2", "g3"]) {
    replacePaEvents(db, g, rows.filter((r) => r.gameId === g));
  }
  /**
   * ⚠**구장과 타순을 심는다.** 이것이 없으면 `venue`·`battingOrder` 축이 **전부 미분류**가 되고,
   * 그 상태에서도 보존은 성립하므로 **그 두 축은 아무것도 안 재게 된다.**
   * ⚠**이 함정을 실제로 밟았다** — 첫 판은 이걸 안 심어서 뮤테이션(homeAway 를 전부 NULL 로)이
   * **아무 시험도 못 떨어뜨렸다.** 「전부 잃어버리기」도 보존을 만족시키기 때문이다.
   */
  db.raw.prepare("UPDATE game SET venue = ?").run("東京ドーム");
  db.raw.prepare("UPDATE game SET venue = ? WHERE game_id = 'g3'").run("横浜");
  const bl = db.raw.prepare(
    `INSERT INTO batting_line (game_id, player_id, side, batting_order, position,
       pa, ab, h, d2, d3, hr, bb, ibb, hbp, sf, sh, so, roe, runs, rbi, sb)
     VALUES (?, ?, 'away', ?, '中', 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
  );
  for (const g of ["g1", "g2", "g3"]) {
    bl.run(g, "B1", 3);
    bl.run(g, "B2", 5);
  }
  return { batter: "B1", pitcher: "P1", total: 6 };
}

/**
 * ⚠**목록을 여기서 다시 적지 않는다**(M1). 소스의 `SPLIT_DIMENSIONS` 를 그대로 돌린다 —
 * 축이 늘면 **그 축도 자동으로 이 검사를 받는다.**
 * ⚠**첫 판에는 손으로 적었고 이름을 두 개 틀렸다**(`hand`·`runners` → 실제는
 * `opponentHand`·`baseState`). SQL 이 `no such column: undefined` 로 죽어서 알았다 —
 * **죽지 않고 0행을 돌려줬다면 「전부 통과」로 보였을 것이다.**
 */
const AXES = SPLIT_DIMENSIONS;

/**
 * **미분류가 원리적으로 나올 수 없는 축.**
 *
 * ⚠**보존만으로는 약하다** — 타석을 **미분류로 흘려보내도 보존은 성립한다.**
 * 실제로 첫 판에서 `homeAway` 를 절반만 NULL 로 만드는 뮤테이션이 **아무 시험도 못 떨어뜨렸다.**
 * 그래서 **「이 축은 모를 수가 없다」**를 따로 못 박는다.
 *
 * | 축 | 미분류 가능? | 왜 |
 * |---|---|---|
 * | `homeAway` | **불가** | `pa_event.half` 는 NOT NULL 이다 |
 * | `baseState` | **불가** | `bases` 의 CASE 에 ELSE 가 있어 언제나 값이 난다 |
 * | `month` | **불가** | `game.game_date` 는 NOT NULL 이다 |
 * | `opponentTeam` | **불가** | 홈·원정 코드가 둘 다 NOT NULL 이다 |
 * | `opponentHand` | 가능 | 상대의 투타를 모를 수 있다(소급 시즌에 흔하다) |
 * | `venue` | 가능 | `game.venue` 가 NULL 일 수 있다 |
 * | `battingOrder` | 가능 | `batting_line` 이 없는 경기가 있다(LEFT JOIN) |
 *
 * ⚠**「가능」을 「있어야 한다」로 읽지 마라** — 0이어도 정상이다.
 */
const NEVER_UNCLASSIFIED = new Set(["homeAway", "baseState", "month", "opponentTeam"]);

test("⚠타자 스플릿은 타석을 잃지도 만들지도 않는다 — 행의 합 + 미분류 = 전체", () => {
  return withDb((db) => {
    const { batter, total } = seedMessy(db);
    const problems: string[] = [];
    let checkedUnclassified = 0;
    for (const dim of AXES) {
      const all = battingSplits(db, dim, 2026);
      const me = all.find((p) => p.playerId === batter);
      assert.notEqual(me, undefined, `${dim}: 그 타자가 결과에 없다 — 이 시험이 공회전한다`);
      const sum = me!.splits.reduce((n: number, r: { line: { pa: number } }) => n + r.line.pa, 0);
      if (me!.unclassified > 0) checkedUnclassified += 1;
      /**
       * ⚠**보존만으로는 부족하다** — **전부 미분류로 흘려보내도 보존은 성립한다**(0 + N = N).
       * 그래서 **축이 실제로 무언가 분류했는가**를 같이 묻는다. 이 한 줄이 없어서
       * 첫 판의 뮤테이션(homeAway 를 전부 NULL 로)이 아무것도 못 떨어뜨렸다.
       */
      if (sum === 0) {
        problems.push(`${dim}: 분류된 타석이 0 이다 — 전부 미분류(${me!.unclassified})로 흘렀다`);
      }
      if (NEVER_UNCLASSIFIED.has(dim) && me!.unclassified !== 0) {
        problems.push(
          `${dim}: 미분류가 ${me!.unclassified} 이다 — 이 축은 입력이 NOT NULL 이라 모를 수가 없다`,
        );
      }
      if (sum + me!.unclassified !== total) {
        problems.push(
          `${dim}: 행의 합 ${sum} + 미분류 ${me!.unclassified} = ${sum + me!.unclassified} ≠ 전체 ${total}` +
            ` (행: ${me!.splits.map((r: { key: string; line: { pa: number } }) => `${r.key}=${r.line.pa}`).join(" · ")})`,
        );
      }
    }
    assert.deepEqual(problems, [], `스플릿이 타석을 잃거나 만들었다\n${problems.join("\n")}`);
    /**
     * ⚠**미분류가 한 축도 안 생겼으면 등식의 절반을 안 잰 것이다.**
     * 「합이 맞았다」가 「분류 못한 것을 제대로 세었다」를 뜻하지 않는다.
     */
    assert.ok(checkedUnclassified > 0, "미분류가 한 축도 없다 — 표본이 그 갈래를 안 만든다");
  });
});

test("⚠투수 스플릿도 같다 — 상대한 타석의 합 + 미분류 = 전체", () => {
  return withDb((db) => {
    const { pitcher } = seedMessy(db);
    // P1 이 상대한 타석: g1#1 · g2#1 · g3#2 · g3#3 = 4
    const total = 4;
    const problems: string[] = [];
    for (const dim of AXES) {
      const all = pitchingSplits(db, dim, 2026);
      const me = all.find((p) => p.playerId === pitcher);
      assert.notEqual(me, undefined, `${dim}: 그 투수가 결과에 없다 — 이 시험이 공회전한다`);
      const sum = me!.splits.reduce((n: number, r: { line: { pa: number } }) => n + r.line.pa, 0);
      /**
       * ⚠**보존만으로는 부족하다** — **전부 미분류로 흘려보내도 보존은 성립한다**(0 + N = N).
       * 그래서 **축이 실제로 무언가 분류했는가**를 같이 묻는다. 이 한 줄이 없어서
       * 첫 판의 뮤테이션(homeAway 를 전부 NULL 로)이 아무것도 못 떨어뜨렸다.
       */
      if (sum === 0) {
        problems.push(`${dim}: 분류된 타석이 0 이다 — 전부 미분류(${me!.unclassified})로 흘렀다`);
      }
      if (NEVER_UNCLASSIFIED.has(dim) && me!.unclassified !== 0) {
        problems.push(
          `${dim}: 미분류가 ${me!.unclassified} 이다 — 이 축은 입력이 NOT NULL 이라 모를 수가 없다`,
        );
      }
      if (sum + me!.unclassified !== total) {
        problems.push(
          `${dim}: 행의 합 ${sum} + 미분류 ${me!.unclassified} = ${sum + me!.unclassified} ≠ 전체 ${total}` +
            ` (행: ${me!.splits.map((r: { key: string; line: { pa: number } }) => `${r.key}=${r.line.pa}`).join(" · ")})`,
        );
      }
    }
    assert.deepEqual(problems, [], `투수 스플릿이 타석을 잃거나 만들었다\n${problems.join("\n")}`);
  });
});

/**
 * ⚠**한 타석이 두 행에 들어가면 합이 커진다** — 위 시험이 그것도 잡는다는 것을 못 박는다.
 * ⚠**보존만으로는 「어느 행에 들어갔는가」를 못 본다** — 그건 `splits.test.ts` 와
 * `opponent-split.test.ts` 가 축마다 따로 본다. **두 층을 다 두는 이유가 이것이다.**
 */
test("⚠보존은 「겹침」도 잡는다 — 합이 전체보다 크면 실패다", () => {
  return withDb((db) => {
    const { batter, total } = seedMessy(db);
    const me = battingSplits(db, "homeAway", 2026).find((p) => p.playerId === batter);
    const sum = me!.splits.reduce((n: number, r: { line: { pa: number } }) => n + r.line.pa, 0);
    assert.equal(sum + me!.unclassified, total);
    // 홈/원정은 두 값뿐이고 서로 배타적이다 — 행이 셋 이상이면 그 자체로 결함이다
    assert.ok(me!.splits.length <= 2, `홈/원정 행이 ${me!.splits.length}개다 — 배타적이지 않다`);
  });
});
