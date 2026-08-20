/**
 * 파크팩터·RPW 산식 — **순수 함수만**. DB 대조는 `park-db.test.ts` 가 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INNINGS_PER_GAME,
  parkFactor,
  runsPerGame,
  runsPerWin,
  sumRunEnvironments,
} from "../src/park.ts";

test("경기당 득점은 분모를 함께 나른다(M2)", () => {
  assert.deepEqual(runsPerGame({ runs: 750, games: 100 }), { value: 7.5, denominator: 100 });
});

test("⚠표본이 0이면 값이 없다 — **1.000 으로 때우지 않는다**(M11)", () => {
  const pf = parkFactor({ runs: 0, games: 0 }, { runs: 750, games: 100 });
  assert.equal(pf.value, null, "0경기 구장이 「평균」으로 나오면 그건 거짓말이다");
  assert.equal(pf.games, 0);
  assert.equal(runsPerWin({ runs: 0, games: 0 }).value, null);
  // 기준선이 0인 경우도 마찬가지 — 나눗셈이 Infinity 로 새면 화면에 ∞ 가 나간다
  assert.equal(parkFactor({ runs: 10, games: 2 }, { runs: 0, games: 5 }).value, null);
});

test("파크팩터는 기준선에 대한 비다 — **표본과 기준선을 같이 나른다**(M2)", () => {
  // ⚠구장 표본과 기준 표본을 **다른 수**로 준다 — 같은 수면 어느 쪽이 새도 안 보인다
  const pf = parkFactor({ runs: 900, games: 100 }, { runs: 7500, games: 1000 });
  assert.equal(pf.value, 1.2);
  assert.equal(pf.runsPerGame, 9);
  // ⚠**이 구장의 표본이다.** 분모 없는 비율은 렌더링 금지이므로 값과 같이 나와야 한다
  assert.equal(pf.games, 100, "구장의 표본을 안 나르면 화면이 분모 없이 PF 를 그린다");
  assert.equal(pf.baselineRunsPerGame, 7.5);
  assert.equal(pf.baselineGames, 1000);
});

test("⚠RPW = 10 × √(경기당 득점 ÷ 9) — **2025 실측을 산식으로 재현한다**", () => {
  assert.equal(INNINGS_PER_GAME, 9);
  // 센트럴 2025: 리그내 375경기 · 2,430점
  const c = runsPerWin({ runs: 2430, games: 375 });
  assert.equal(c.runsPerGame, 6.48);
  assert.equal(c.value!.toFixed(3), "8.485");
  assert.equal(c.games, 375);
  // 퍼시픽 2025: 리그내 375경기 · 2,535점
  assert.equal(runsPerWin({ runs: 2535, games: 375 }).value!.toFixed(3), "8.667");
});

test("⚠경기를 두 번 세면 RPW 가 √2 배 작아진다 — 그래서 한 경기는 한 번만 센다", () => {
  const once = runsPerWin({ runs: 2430, games: 375 }).value!;
  const twice = runsPerWin({ runs: 2430 * 2, games: 375 * 2 }).value!;
  // 득점도 같이 두 배면 경기당은 그대로다 — 이쪽은 안 변한다
  assert.equal(once.toFixed(6), twice.toFixed(6));
  // ⚠**경기만 두 배로 세는 것**이 실제 사고다(홈·원정 양쪽에서 세기)
  const doubleCounted = runsPerWin({ runs: 2430, games: 750 }).value!;
  assert.equal((once / doubleCounted).toFixed(4), Math.SQRT2.toFixed(4));
});

test("⚠비율을 평균 내지 않는다 — 원시 수를 더한다", () => {
  const a = { runs: 100, games: 10 }; // 10.0
  const b = { runs: 10, games: 90 }; // 0.111…
  const summed = sumRunEnvironments([a, b]);
  assert.deepEqual(summed, { runs: 110, games: 100 });
  assert.equal(runsPerGame(summed).value, 1.1);
  // 비율의 단순 평균이면 5.055… 가 된다 — 분모가 다른 둘을 그렇게 합치면 안 된다
  assert.notEqual(runsPerGame(summed).value, (10 + 10 / 90) / 2);
});

test("빈 배열의 합은 0경기이고, 거기서 나온 값은 null 이다", () => {
  assert.deepEqual(sumRunEnvironments([]), { runs: 0, games: 0 });
  assert.equal(runsPerGame(sumRunEnvironments([])).value, null);
});
