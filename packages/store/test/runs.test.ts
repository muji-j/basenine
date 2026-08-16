import { test } from "node:test";
import assert from "node:assert/strict";
import type { LineScore, PlayEvent } from "@bb-app/parser";
import { deriveRuns } from "../src/runs.ts";

function ev(inning: number, half: "top" | "bottom", outs: number, bases: string): PlayEvent {
  return {
    inning, half, seq: 0, outsBefore: outs, bases,
    batterId: "B", batterName: "타자", pitcherId: "P",
    count: "0-0より", result: "x", completed: true,
  };
}

function ls(away: (number | null)[], home: (number | null)[]): LineScore {
  const sum = (a: (number | null)[]): number => a.reduce<number>((n, v) => n + (v ?? 0), 0);
  // H·E는 이 테스트의 관심 밖이다. ⚠0이 아니라 null로 둔다 — 「없음」과 「0」은 다르다(M11)
  return {
    away, home, awayTotal: sum(away), homeTotal: sum(home),
    awayHits: null, homeHits: null, awayErrors: null, homeErrors: null,
  };
}

test("이닝 내부 전이로 득점을 유도한다", () => {
  // 무사주자없음 → 1루(안타) → 2루 1아웃 … 마지막은 라인스코어로 닫는다
  const events = [
    ev(1, "top", 0, ""),   // 타자 출루 → 다음 상태 1루 0아웃 : 0점
    ev(1, "top", 0, "1"),  // 다음 상태 2아웃 주자없음 → 1루주자+타자=2, 아웃 2 : 0점
    ev(1, "top", 2, ""),   // 마지막 → 라인스코어 0점
  ];
  const r = deriveRuns("g", events, ls([0], [0]));
  assert.deepEqual(r.runsPerEvent, [0, 0, 0]);
  assert.equal(r.quarantine.length, 0);
});

test("주자가 사라지고 아웃이 늘지 않으면 득점이다", () => {
  const events = [
    ev(1, "top", 0, "3"),  // 3루 주자 + 타자 = 2명. 다음 상태 1루 0아웃(1명) → 1점
    ev(1, "top", 0, "1"),
    ev(1, "top", 2, ""),
  ];
  const r = deriveRuns("g", events, ls([1], [0]));
  assert.equal(r.runsPerEvent[0], 1);
});

test("⚠이닝 마지막 타석은 전이로 풀지 않는다 — 잔루를 득점으로 세게 된다", () => {
  // 2아웃 1루에서 타자가 아웃되며 이닝 종료. 보존식만 쓰면 주자 1명이 득점으로 잡힌다.
  const events = [ev(1, "top", 2, "1")];
  const r = deriveRuns("g", events, ls([0], [0]));
  assert.equal(r.runsPerEvent[0], 0, "잔루는 득점이 아니다");
});

test("마지막 타석의 득점은 라인스코어로 닫는다", () => {
  // 2아웃 만루에서 2점 적시타 → 라인스코어 2점
  const events = [ev(1, "top", 2, "123")];
  const r = deriveRuns("g", events, ls([2], [0]));
  assert.equal(r.runsPerEvent[0], 2);
  assert.equal(r.quarantine.length, 0);
});

test("⚠닫히지 않으면 격리한다 — 조용히 쓰지 않는다", () => {
  // 2아웃 주자없음(최대 1점 가능)인데 라인스코어가 5점이면 유도가 틀린 것이다.
  const events = [ev(1, "top", 2, "")];
  const r = deriveRuns("g", events, ls([5], [0]));
  assert.equal(r.quarantine.length, 1);
  assert.equal(r.quarantine[0]?.kind, "runsMismatch");
});

test("하프이닝을 섞지 않는다", () => {
  const events = [
    ev(1, "top", 2, "1"),
    ev(1, "bottom", 0, ""),
    ev(1, "bottom", 2, "23"),
  ];
  const r = deriveRuns("g", events, ls([0], [2]));
  assert.equal(r.runsPerEvent[0], 0, "표는 0점");
  assert.equal(r.runsPerEvent[2], 2, "리는 마지막 타석에서 2점");
});

test("치지 않은 이닝(라인스코어 null)은 0으로 두고 격리하지 않는다", () => {
  const events = [ev(9, "bottom", 0, "")];
  const r = deriveRuns("g", events, ls([0, 0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0, null]));
  assert.equal(r.runsPerEvent[0], 0);
  assert.equal(r.quarantine.length, 0);
});

test("여러 이닝이 각각 독립적으로 닫힌다", () => {
  const events = [
    ev(1, "top", 2, "2"), // 1회 마지막 타석 — 라인스코어 1점으로 닫힌다
    ev(2, "top", 1, "1"), // 2회: 주자 1루 유지한 채 타자 아웃 → 0점
    ev(2, "top", 2, "1"),
  ];
  const r = deriveRuns("g", events, ls([1, 0], [0, 0]));
  assert.equal(r.runsPerEvent[0], 1, "1회는 1점");
  assert.equal((r.runsPerEvent[1] ?? 0) + (r.runsPerEvent[2] ?? 0), 0, "2회는 0점");
  assert.equal(r.quarantine.length, 0, "이닝별로 닫히므로 격리가 없어야 한다");
});
