/**
 * 중첩 가능한 부분 롤백.
 *
 * ⚠**「한 건이 실패해도 나머지는 살린다」를 예외 잡기만으로 하면 거짓말이 된다.**
 * 그 건이 도중까지 쓴 것이 **그대로 커밋**되기 때문이다 — 실제로 선수 통산이
 * `DELETE` 만 되고 `INSERT` 가 끊긴 채 커밋되는 경로가 있었다(2026-08-18 다방면 감사 P1).
 * 화면에는 「데이터 없음」이 아니라 **정상적인 작은 수**로 보여서 아무도 눈치채지 못한다(M11·M2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertPlayer } from "../src/index.ts";

const NOW = "2026-08-18T00:00:00.000Z";

async function withDb(fn: (db: ReturnType<typeof openDb>) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-sp-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("⚠실패한 한 건만 되돌리고, 그 앞뒤는 살아남는다", async () => {
  await withDb((db) => {
    db.transaction(() => {
      upsertPlayer(db, "A", "앞", NOW);
      try {
        db.savepoint("mid", () => {
          upsertPlayer(db, "B", "중간", NOW);
          throw new Error("여기서 깨진다");
        });
      } catch {
        // 호출자가 센다 — savepoint 는 되돌리고 그대로 던진다
      }
      upsertPlayer(db, "C", "뒤", NOW);
    });

    const ids = (db.raw.prepare("SELECT player_id FROM player ORDER BY player_id").all() as unknown as
      { player_id: string }[]).map((r) => r.player_id);
    assert.deepEqual(ids, ["A", "C"], "실패한 건이 남았거나 앞뒤가 함께 죽었다");
  });
});

/** ⚠**예외를 삼키지 않는다** — 셀지 말지는 호출자가 정한다 */
test("⚠되돌린 뒤 예외를 그대로 던진다", async () => {
  await withDb((db) => {
    db.transaction(() => {
      assert.throws(
        () => db.savepoint("x", () => { throw new RangeError("원본"); }),
        /원본/,
        "예외를 삼켰다",
      );
    });
  });
});

/** ⚠**중첩된다** — 이름이 겹치지 않게 호출자가 준다 */
test("savepoint 를 중첩해도 안쪽만 되돌린다", async () => {
  await withDb((db) => {
    db.transaction(() => {
      db.savepoint("outer", () => {
        upsertPlayer(db, "OUT", "바깥", NOW);
        try {
          db.savepoint("inner", () => {
            upsertPlayer(db, "IN", "안쪽", NOW);
            throw new Error("안쪽만 깨진다");
          });
        } catch {
          /* 무시 */
        }
      });
    });
    const ids = (db.raw.prepare("SELECT player_id FROM player ORDER BY player_id").all() as unknown as
      { player_id: string }[]).map((r) => r.player_id);
    assert.deepEqual(ids, ["OUT"], "중첩이 어긋났다");
  });
});
