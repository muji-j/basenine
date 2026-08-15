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
