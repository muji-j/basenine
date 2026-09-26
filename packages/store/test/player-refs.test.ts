/**
 * 경과가 가리키는 선수가 **선수 표에 있는가**(감사 N1 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §6-3 · 시험 1-4).
 *
 * ⚠**외래키 오류는 원인을 말하지 않는다**(`FOREIGN KEY constraint failed`) — 경과의 링크는 살아 있는데 박스에서 그 선수 링크를
 *   못 읽은 신규 선수는 선수 표에 없고, 적재가 그 타석을 쓰는 순간 외래키로 던졌다. 이 점검이 그 **전에** ID·역할·행 수를 말한다.
 * ⚠메모리 DB 에 마이그레이션을 적용해 잰다 — 외래키 조건과 같은 표(`player`)를 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, upsertPlayer } from "../src/index.ts";
import { MissingPlayerRefError, missingPlayerRefs } from "../src/player-refs.ts";

const NOW = "2026-09-27T00:00:00.000Z";

function withDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const db = openDb(":memory:", NOW);
  try {
    for (const id of ["B1", "B2", "P1", "R1"]) upsertPlayer(db, id, `시험${id}`, NOW);
    fn(db);
  } finally {
    db.close();
  }
}

const pa = (batterId: string, pitcherId: string | null) => ({ batterId, pitcherId });

test("N1 1-4 · 가리키는 선수가 전부 선수 표에 있으면 빈 목록이다", () => {
  withDb((db) => {
    assert.deepEqual(
      missingPlayerRefs(db, { events: [pa("B1", "P1"), pa("B2", "P1")], runners: [{ runnerId: "R1" }] }),
      [],
    );
  });
});

test("⚠N1 1-4 · 선수 표에 없는 투수를 역할과 타석 수로 말한다", () => {
  withDb((db) => {
    const got = missingPlayerRefs(db, { events: [pa("B1", "NEWP"), pa("B2", "NEWP"), pa("B1", "P1")], runners: [] });
    assert.deepEqual(got, [{ role: "投手", playerId: "NEWP", count: 2 }]);
  });
});

test("⚠N1 1-4 · 선수 표에 없는 타자·주자도 말한다", () => {
  withDb((db) => {
    const got = missingPlayerRefs(db, {
      events: [pa("NEWB", "P1")],
      runners: [{ runnerId: "R1" }, { runnerId: "NEWR" }, { runnerId: "NEWR" }, { runnerId: "NEWR" }],
    });
    assert.deepEqual(got, [
      { role: "打者", playerId: "NEWB", count: 1 },
      { role: "走者", playerId: "NEWR", count: 3 },
    ]);
  });
});

/** ⚠투수 미상(null) 타석은 가리키는 선수가 없다 — 외래키도 NULL 은 검사하지 않는다 */
test("N1 1-4 · 투수가 null 인 타석은 무시한다", () => {
  withDb((db) => {
    assert.deepEqual(missingPlayerRefs(db, { events: [pa("B1", null), pa("B2", null)], runners: [] }), []);
  });
});

test("⚠N1 1-4 · 같은 선수가 여러 타석에 나오면 한 번만 말하고 수를 센다 · 오류 문구가 ID·역할·수를 말한다", () => {
  withDb((db) => {
    const got = missingPlayerRefs(db, {
      events: Array.from({ length: 21 }, (_, i) => pa(i % 2 === 0 ? "B1" : "B2", "61465150")),
      runners: [{ runnerId: "99999999" }],
    });
    assert.deepEqual(got, [
      { role: "投手", playerId: "61465150", count: 21 },
      { role: "走者", playerId: "99999999", count: 1 },
    ]);
    const err = new MissingPlayerRefError(got);
    assert.equal(err.name, "MissingPlayerRefError");
    assert.equal(err.message, "선수 표에 없는 선수를 가리킨다 — 投手 61465150(타석 21) · 走者 99999999(주자 사건 1)");
    assert.deepEqual(err.missing, got);
  });
});

/** ⚠같은 트랜잭션에서 **방금 넣은** 선수가 보여야 한다 — 박스 선수 `upsertPlayer` 뒤에 부르므로 */
test("N1 1-4 · 같은 트랜잭션에서 방금 넣은 선수는 있는 것으로 본다", () => {
  withDb((db) => {
    db.transaction(() => {
      upsertPlayer(db, "FRESH", "新顔", NOW);
      assert.deepEqual(missingPlayerRefs(db, { events: [pa("FRESH", "P1")], runners: [] }), []);
    });
  });
});
