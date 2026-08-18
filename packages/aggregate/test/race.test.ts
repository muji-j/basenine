/**
 * 우승 경쟁 계산.
 *
 * ⚠**대전 수는 규칙으로 고정돼 있다** — 실측(아카이브 전수): 완결 7시즌에서
 * 리그내 30쌍 전부 25 · 교류전 36쌍 전부 3, 2020 만 24 / 0(교류전 미개최 · 24×5=120).
 * 그래서 **직접대결 잔여 = 규정 − 치름** 이고 예정 일정이 필요 없다.
 * ⚠**하드코딩하지 않는다.** 2020 이 그 이유다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSeriesLengths, pairKey } from "../src/race.ts";

const CENTRAL = ["g", "t", "db", "c", "d", "s"];
const PACIFIC = ["h", "f", "m", "l", "e", "b"];
const ALL = [...CENTRAL, ...PACIFIC];
const leagueOf = (c: string): string => (CENTRAL.includes(c) ? "central" : "pacific");

/** 모든 쌍에 같은 수를 넣은 지도. 리그내와 교류전을 따로 준다 */
function pairs(intra: number, inter: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < ALL.length; i += 1) {
    for (let j = i + 1; j < ALL.length; j += 1) {
      const a = ALL[i]!;
      const b = ALL[j]!;
      m.set(pairKey(a, b), leagueOf(a) === leagueOf(b) ? intra : inter);
    }
  }
  return m;
}

test("143경기 시즌은 리그내 25 · 교류전 3으로 유도된다", () => {
  const r = deriveSeriesLengths({ season: 2026, teams: ALL, leagueOf, playedPairs: pairs(25, 3) });
  assert.deepEqual(r, { intra: 25, inter: 3 });
});

/**
 * ⚠**2020 은 코로나로 120경기이고 교류전이 없었다.** 상수를 박아 두면 이 해가 조용히 틀린다 —
 * `regularSeasonGames` 를 시즌별 표로 바꿨던 것과 같은 함정이다.
 */
test("⚠120경기 시즌(2020)은 리그내 24 · 교류전 0이다", () => {
  const r = deriveSeriesLengths({ season: 2020, teams: ALL, leagueOf, playedPairs: pairs(24, 0) });
  assert.deepEqual(r, { intra: 24, inter: 0 });
});

/**
 * ⚠**교류전이 진행 중이면 유도가 정수가 아니게 된다** — 그게 「아직 모른다」의 신호다.
 * 143 시즌에서 정수가 나오는 것은 교류전이 3일 때뿐이다. 검산이 공짜로 붙는다.
 */
test("⚠교류전이 끝나기 전에는 유도하지 않는다 — 정수가 안 나온다", () => {
  for (const inter of [0, 1, 2]) {
    assert.equal(
      deriveSeriesLengths({ season: 2026, teams: ALL, leagueOf, playedPairs: pairs(10, inter) }),
      null,
      `교류전 ${inter}인데 유도했다`,
    );
  }
});

/** ⚠**유도한 상수를 이미 넘긴 쌍이 있으면 유도가 틀린 것이다.** 조용히 쓰지 않는다 */
test("⚠어떤 쌍이 유도 상수를 넘기면 판정하지 않는다", () => {
  const m = pairs(25, 3);
  m.set(pairKey("g", "t"), 26);
  assert.equal(deriveSeriesLengths({ season: 2026, teams: ALL, leagueOf, playedPairs: m }), null);
});

/** ⚠**12구단·리그별 6팀이 아니면 이 계산의 전제가 성립하지 않는다** */
test("⚠구단 수가 12가 아니면 판정하지 않는다", () => {
  assert.equal(
    deriveSeriesLengths({ season: 2026, teams: ALL.slice(0, 11), leagueOf, playedPairs: pairs(25, 3) }),
    null,
  );
});

test("pairKey 는 순서에 무관하다 — 같은 쌍이 두 키가 되면 수가 반토막 난다", () => {
  assert.equal(pairKey("t", "g"), pairKey("g", "t"));
});
