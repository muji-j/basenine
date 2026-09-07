/**
 * 「続いている記録」 표의 **자리 나누기** — 홈과 구단 페이지가 같은 함수를 쓴다.
 *
 * ## ⚠왜 필요했나
 *
 * 투수를 넣자마자 **길이로만 자르면 투수가 표를 차지했다.**
 * 실측(2026-09-07 · 로컬 DB · 하한 5): 후보 수가
 * **2026 타자 23 · 투수 37** · **2025 타자 6 · 투수 37** · **2022 타자 4 · 투수 32** ·
 * **2018 타자 7 · 투수 19** 다 — 진행 중 마루가 있는 투수는 늘 수십 명인데, 타자는
 * 「최신 경기일에 출장」까지 요구하므로 한 자릿수인 시즌이 흔하다.
 *
 * ⚠**실제로 그렇게 됐다**: 나누기 전 2026 홈 화면은 **10행 중 7행이 투수**였다.
 * 끝난 시즌이면 거의 전부가 투수가 된다 — 그러면 이 구획이 조용히 **「투수의 기록」**이 되고,
 * 그건 이번에 고친 **「조용히 타자의 기록」과 같은 결함의 반대 방향**이다.
 *
 * ⚠**순서는 안 바꾼다.** 나누는 것은 **자리**이지 순위가 아니다 —
 * 종류가 다르면 길이 비교가 성립하지 않는다는 것은 각주(`streakTableNote`)가 말한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorOf } from "@bb-app/domain";
import { shareStreakRows } from "../src/query.ts";
import type { HomeStreak } from "../src/home-page.ts";

const row = (kind: HomeStreak["kind"], games: number, i: number): HomeStreak => ({
  playerId: `${kind}${i}`,
  name: "x",
  teamCode: "t",
  shortName: "阪神",
  color: colorOf("t"),
  kind,
  games,
  scanned: games + 10,
  scannedUnit: kind === "scorelessAppearances" ? "登板" : "試合",
  from: "2026-05-01",
  to: "2026-08-16",
  lastGameDate: "2026-08-16",
});

/** 길이순으로 미리 정렬된 목록 — `shareStreakRows` 는 그것을 전제한다 */
const sorted = (rows: readonly HomeStreak[]): HomeStreak[] => [...rows].sort((a, b) => b.games - a.games);

test("⚠자리를 타자 몫과 투수 몫으로 나눈다 — 안 나누면 10행이 통째로 투수가 된다", () => {
  const rows = sorted([
    ...Array.from({ length: 20 }, (_, i) => row("scorelessAppearances", 40 - i, i)),
    ...Array.from({ length: 20 }, (_, i) => row("hitting", 19 - i, i)),
  ]);
  // 자르기 전에는 상위 10이 전부 투수다 — 그것이 이 시험이 막는 상태다
  assert.equal(rows.slice(0, 10).every((r) => r.kind === "scorelessAppearances"), true);

  const picked = shareStreakRows(rows, 10);
  assert.equal(picked.length, 10);
  assert.equal(picked.filter((r) => r.kind === "scorelessAppearances").length, 5, "투수가 자리를 다 가져갔다");
  assert.equal(picked.filter((r) => r.kind === "hitting").length, 5, "타자가 밀려났다");
  // ⚠**정렬은 그대로 길이순이다** — 나누는 것은 자리이지 순서가 아니다
  assert.deepEqual([...picked].sort((a, b) => b.games - a.games), picked);
});

/** ⚠**한쪽이 모자라면 다른 쪽이 채운다** — 자리를 비워 두면 정보가 줄기만 한다 */
test("⚠한쪽 후보가 적으면 남은 자리를 다른 쪽이 채운다", () => {
  const rows = sorted([
    ...Array.from({ length: 20 }, (_, i) => row("scorelessAppearances", 40 - i, i)),
    row("hitting", 9, 0),
    row("hitting", 8, 1),
  ]);
  const picked = shareStreakRows(rows, 10);
  assert.equal(picked.length, 10, "자리를 비워 뒀다");
  assert.equal(picked.filter((r) => r.kind === "hitting").length, 2);
  assert.equal(picked.filter((r) => r.kind === "scorelessAppearances").length, 8);
});

/** ⚠**`連続試合出塁` 는 타자 몫이다** — 종류가 셋이지만 자리는 둘로 나눈다 */
test("타자 쪽 두 종류는 같은 몫을 나눠 쓴다", () => {
  const rows = sorted([
    ...Array.from({ length: 10 }, (_, i) => row("scorelessAppearances", 40 - i, i)),
    ...Array.from({ length: 10 }, (_, i) => row("onBase", 30 - i, i)),
    ...Array.from({ length: 10 }, (_, i) => row("hitting", 20 - i, i)),
  ]);
  const picked = shareStreakRows(rows, 10);
  assert.equal(picked.filter((r) => r.kind === "scorelessAppearances").length, 5);
  assert.equal(picked.filter((r) => r.kind !== "scorelessAppearances").length, 5);
  // 타자 몫 안에서는 길이가 이긴다 — 出塁 가 더 길므로 5칸을 다 가져간다
  assert.equal(picked.filter((r) => r.kind === "onBase").length, 5);
});

/**
 * ⚠**홀수 한도에서 한 행이 더 나왔다** — `ceil(5/2) = 3` 을 **양쪽에** 주면 3+3 = **6행**이고,
 * 남는 자리를 배분하는 아래 가지는 `spare > 0` 만 보므로 **음수(−1)를 되돌리지 않았다.**
 *
 * ⚠**지금 호출 상수가 둘 다 짝수(10)라 화면에서는 안 드러났다** — 발현하지 않는 것과
 * 계약이 맞는 것은 다르다. 상수를 하나 홀수로 고치는 날 **조용히 한 행이 는다.**
 *
 * ⚠**짝수 한도의 거동은 안 바뀐다**(위 시험들이 그것을 고정한다) — `floor` 와 `ceil` 이 같은 값이다.
 */
test("⚠홀수 한도에서 한 행을 더 내지 않는다 — ceil 이면 5를 시켰는데 6행이 나온다", () => {
  const rows = sorted([
    ...Array.from({ length: 8 }, (_, i) => row("scorelessAppearances", 40 - i, i)),
    ...Array.from({ length: 8 }, (_, i) => row("hitting", 30 - i, i)),
  ]);
  for (const limit of [1, 3, 5, 7, 9]) {
    const picked = shareStreakRows(rows, limit);
    assert.equal(picked.length, limit, `한도 ${limit} 인데 ${picked.length}행이 나왔다`);
  }
  // ⚠**한 자리만 남을 때 어느 쪽이 가져가는지도 고정한다** — 안 정하면 빌드마다 흔들린다
  const five = shareStreakRows(rows, 5);
  assert.equal(five.filter((r) => r.kind === "scorelessAppearances").length, 2);
  assert.equal(five.filter((r) => r.kind === "hitting").length, 3);
  // ⚠**정렬은 그대로 길이순이다**
  assert.deepEqual([...five].sort((a, b) => b.games - a.games), five);
});

/** ⚠**한도가 0 이하면 빈 목록이다** — `slice` 가 뒤에서 자르는 사고를 막는다 */
test("한도가 0이면 아무것도 안 낸다", () => {
  const rows = sorted([row("hitting", 9, 0), row("scorelessAppearances", 8, 1)]);
  assert.deepEqual(shareStreakRows(rows, 0), []);
});

test("후보가 한도보다 적으면 전부 낸다 · 빈 목록은 빈 목록이다", () => {
  const one = [row("hitting", 7, 0)];
  assert.deepEqual(shareStreakRows(one, 10), one);
  assert.deepEqual(shareStreakRows([], 10), []);
});
