import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaCell } from "@bb-app/parser";
import type { BatterRow, BoxScore, PlayEvent } from "@bb-app/parser";
import { alignPaEvents } from "../src/align.ts";

function batter(playerId: string, name: string, cells: string[]): BatterRow {
  return {
    order: "1", position: "(遊)", name, playerId, isTeamTotal: false,
    ab: 0, runs: 0, hits: 0, rbi: 0, steals: 0,
    plateAppearances: cells.map(parsePaCell).filter((p) => p !== null),
  };
}

function box(away: BatterRow[], home: BatterRow[] = []): BoxScore {
  return {
    status: "played",
    away: { batters: away, pitchers: [] },
    home: { batters: home, pitchers: [] },
  };
}

function ev(
  seq: number, batterId: string, pitcherId: string | null, result: string,
  o: Partial<PlayEvent> = {},
): PlayEvent {
  return {
    inning: 1, half: "top", seq, outsBefore: 0, bases: "",
    batterId, batterName: batterId, pitcherId, count: "0-0より", result,
    completed: true, ...o,
  };
}

test("결과는 박스에서, 문맥은 경과에서 온다", () => {
  const b = box([batter("B1", "타자", ["左越本①", "三 振"])]);
  const events = [
    ev(1, "B1", "P1", "レフトソロホームラン（打点1）", { inning: 1, outsBefore: 1, bases: "12" }),
    ev(2, "B1", "P2", "空振り三振", { inning: 4, outsBefore: 2, bases: "3" }),
  ];
  const r = alignPaEvents("g1", b, events);

  assert.equal(r.quarantine.length, 0);
  assert.equal(r.events.length, 2);
  // 결과·타점은 박스
  assert.equal(r.events[0]?.outcome, "homerun");
  assert.equal(r.events[0]?.rbi, 1);
  assert.equal(r.events[1]?.outcome, "strikeout");
  // 문맥은 경과
  assert.equal(r.events[0]?.pitcherId, "P1");
  assert.equal(r.events[0]?.bases, "12");
  assert.equal(r.events[1]?.inning, 4);
  assert.equal(r.events[1]?.pitcherId, "P2");
  // 원문은 양쪽 다 보존
  assert.equal(r.events[0]?.rawBox, "左越本①");
  assert.equal(r.events[0]?.rawPbp, "レフトソロホームラン（打点1）");
});

test("⚠미완 타석은 짝짓지 않는다", () => {
  const b = box([batter("B1", "타자", ["三 振"])]);
  const events = [
    ev(1, "B1", "P1", "（途中終了）", { completed: false }),
    ev(2, "B1", "P1", "空振り三振"),
  ];
  const r = alignPaEvents("g1", b, events);
  assert.equal(r.quarantine.length, 0);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0]?.outcome, "strikeout");
});

test("경기 내 순번은 시간순으로 1부터 매겨진다", () => {
  const b = box(
    [batter("B1", "A", ["三 振", "四 球"])],
    [batter("B2", "B", ["中前安"])],
  );
  const events = [
    ev(1, "B1", "P1", "空振り三振"),
    ev(2, "B2", "P2", "センター前ヒット", { half: "bottom" }),
    ev(3, "B1", "P1", "フォアボール", { inning: 3 }),
  ];
  const r = alignPaEvents("g1", b, events);
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(r.events.map((e) => e.batterId), ["B1", "B2", "B1"]);
});

test("⚠타석 수가 어긋나면 짝짓지 않고 격리한다", () => {
  // 어긋난 채 짝지으면 결과가 엉뚱한 투수에게 붙고 상대전적이 조용히 틀린다.
  const b = box([batter("B1", "타자", ["三 振"])]);
  const events = [ev(1, "B1", "P1", "空振り三振"), ev(2, "B1", "P2", "セカンドゴロ")];
  const r = alignPaEvents("g1", b, events);

  assert.equal(r.events.length, 0, "그 타자는 통째로 빠진다");
  assert.equal(r.quarantine.length, 1);
  assert.equal(r.quarantine[0]?.kind, "paMismatch");
  assert.equal(r.quarantine[0]?.playerId, "B1");
});

test("한 타자가 어긋나도 나머지 타자는 정상 적재된다", () => {
  const b = box([
    batter("B1", "A", ["三 振"]),
    batter("B2", "B", ["中前安"]),
  ]);
  const events = [
    ev(1, "B1", "P1", "空振り三振"),
    ev(2, "B1", "P1", "セカンドゴロ"),
    ev(3, "B2", "P1", "センター前ヒット"),
  ];
  const r = alignPaEvents("g1", b, events);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0]?.batterId, "B2");
  assert.equal(r.quarantine.length, 1);
});

test("⚠경과에만 있는 타자도 격리한다", () => {
  const r = alignPaEvents("g1", box([]), [ev(1, "B9", "P1", "空振り三振")]);
  assert.equal(r.events.length, 0);
  assert.equal(r.quarantine[0]?.detail, "경과에는 있으나 박스에 없는 타자");
});

test("⚠박스에만 있는 타자도 격리한다", () => {
  const r = alignPaEvents("g1", box([batter("B1", "A", ["三 振"])]), []);
  assert.equal(r.events.length, 0);
  assert.equal(r.quarantine[0]?.detail, "박스에는 있으나 경과에 없는 타자");
});

test("팀 합계 행과 ID 없는 행은 대조 대상이 아니다", () => {
  const total: BatterRow = { ...batter("X", "チーム計", []), isTeamTotal: true };
  const noId: BatterRow = { ...batter("Y", "익명", []), playerId: null };
  const b = box([batter("B1", "A", ["三 振"]), total, noId]);
  const r = alignPaEvents("g1", b, [ev(1, "B1", "P1", "空振り三振")]);
  assert.equal(r.events.length, 1);
  assert.equal(r.quarantine.length, 0);
});

test("⚠v1은 확정값만 쓴다 (M9)", () => {
  const b = box([batter("B1", "A", ["三 振"])]);
  const r = alignPaEvents("g1", b, [ev(1, "B1", "P1", "空振り三振")]);
  assert.equal(r.events[0]?.status, "final");
});

test("중지 경기는 이벤트도 격리도 만들지 않는다", () => {
  const r = alignPaEvents("g1", { status: "notPlayed", reason: "中止" }, []);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.quarantine, []);
});

/**
 * ⚠**타석 번호가 두 개 계열로 갈라 있었다**(2026-08-21 실측 · wSB 선행 결함).
 *
 * 파서는 `afterSeq: events.length` 로 **자기 번호 체계 안에서 정확히** 「직전 타석」을 가리킨다.
 * 그런데 여기(`alignPaEvents`)가 **미완결 타석(`（途中交代）`)과 격리된 타자**를 버리면서
 * `seq` 를 1..N 으로 **다시 매긴다.** 그러면 파서의 `afterSeq` 와 DB 의 `seq` 가 어긋난다.
 *
 * 전수 검증(2026-08-21): 어긋난 주자 사건이 있는 **164경기 · 215사건 전부**가
 * 「그 앞에서 버려진 타석 수」로 설명되고 **미설명 0** 이었다.
 * 오프셋 분포 1:161 · 2:47 · 3:6 · 4:1.
 * 실례 `2018/0403/s-c-01`: 파서 타석 85 · DB 83 · 미완결 2건(seq 53·55) → 어긋남 정확히 +2.
 *
 * ⚠**그래서 재사상이 필요하고, 재사상은 여기서만 할 수 있다** —
 * 무엇을 버렸는지 아는 것은 이 함수뿐이다.
 */
test("⚠버린 타석이 있어도 파서 번호로 다시 찾을 수 있어야 한다 — 주자 사건을 이어 붙이는 유일한 열이다", () => {
  const b = box([batter("B1", "타자", ["左越本①", "三 振"])]);
  const events = [
    ev(1, "B1", "P1", "レフトソロホームラン（打点1）"),
    // ⚠**미완결 타석** — 적재가 버린다. 파서 번호는 2 를 쓴다
    ev(2, "B9", null, "（途中交代）", { completed: false }),
    ev(3, "B1", "P2", "空振り三振"),
  ];
  const r = alignPaEvents("g1", b, events);

  assert.equal(r.events.length, 2, "미완결 타석이 적재됐다 — 이 시험이 공회전한다");
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2], "DB 번호는 1..N 이어야 한다");

  // 파서 1 → DB 1 · 파서 3 → DB 2 · 파서 2 는 버려졌다
  assert.equal(r.seqOf.get(1), 1, "파서 1 번이 DB 1 번으로 안 간다");
  assert.equal(r.seqOf.get(3), 2, "파서 3 번이 DB 2 번으로 안 간다 — 버려진 타석만큼 밀려야 한다");
  assert.equal(r.seqOf.has(2), false, "버려진 타석이 지도에 남아 있다");
});

/**
 * ⚠**격리된 타자도 같은 이유로 번호를 밀린다.**
 * 미완결만 생각하면 오프셋이 대부분 맞아서 **그럴듯하게 틀린다** —
 * 이 저장소가 가장 무서워하는 모양이다.
 */
test("⚠격리된 타자의 타석도 지도에서 빠진다", () => {
  // B2 는 박스에 없다 → 격리되고 적재되지 않는다
  const b = box([batter("B1", "타자", ["左越本①", "三 振"])]);
  const events = [
    ev(1, "B1", "P1", "レフトソロホームラン（打点1）"),
    ev(2, "B2", "P1", "センター前ヒット"),
    ev(3, "B1", "P2", "空振り三振"),
  ];
  const r = alignPaEvents("g1", b, events);
  assert.ok(r.quarantine.length > 0, "격리가 안 일어났다 — 이 시험이 공회전한다");
  assert.equal(r.seqOf.has(2), false, "격리된 타자의 타석이 지도에 남아 있다");
  assert.equal(r.seqOf.get(3), 2, "격리만큼 밀리지 않았다");
});
