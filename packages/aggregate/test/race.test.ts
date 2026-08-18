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

/**
 * 그 대전표에서 나오는 소화 경기 수.
 *
 * ⚠**픽스처가 스스로 모순되지 않게 한다.** 소화를 손으로 적으면 대전표와 어긋나고,
 * 그러면 「Σ 상대별 잔여 = 잔여」 같은 불변식을 잴 수 없다 —
 * 실제로 이 계획의 첫 판이 그래서 통과 불가능한 시험이 됐다(2026-08-18).
 *
 * ⚠**이 헬퍼는 그 불변식 시험에서만 쓴다.** 다른 시험의 `games` 는 `teams()` 기본값(120)이거나
 * 임의로 override 한 값이고, 일부러 「시즌 중간의 어떤 상태」를 흉내낸 것이다 —
 * 대전표와의 정합은 그 시험들이 재는 대상이 아니다.
 */
const gamesFor = (intra: number, inter: number): number => intra * 5 + inter * 6;

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

/**
 * ⚠**「구단 수가 12개」시험은 `teams.length !== 12` 검사만 태우고 `byLeague` 검사는 건드리지 않는다**
 * (실측: `byLeague` 검사 블록을 통째로 지워도 그 시험은 그대로 통과했다 — 6/6 이 그대로 통과).
 * 12팀은 그대로 두고 **리그를 7:5 로 쪼개서** `byLeague` 검사 자체를 태운다.
 * 데이터도 이 쪼갠 리그 기준으로 내부적으로 앞뒤가 맞게 만든다 — 그래야 `byLeague` 검사를 지웠을 때
 * 정수·양수 검사만으로는 걸러지지 않고 **`{ intra: 25, inter: 3 }` 라는 그럴듯한 값이 나와 버리는 것**까지
 * 재현된다(뮤테이션 검사로 확인 — task-2-report.md).
 */
test("⚠12구단이어도 리그가 7:5 로 쪼개지면 판정하지 않는다", () => {
  // pacific 팀 하나("e")를 central 로 옮겨 7:5 를 만든다
  const skewed = (c: string): string => (c === "e" ? "central" : leagueOf(c));
  const m = new Map<string, number>();
  for (let i = 0; i < ALL.length; i += 1) {
    for (let j = i + 1; j < ALL.length; j += 1) {
      const a = ALL[i]!;
      const b = ALL[j]!;
      // 이 쪼갠 리그 기준으로 「같은 그룹」이면 25, 「다른 그룹」이면 3 — 내부적으로 앞뒤가 맞는 데이터
      m.set(pairKey(a, b), skewed(a) === skewed(b) ? 25 : 3);
    }
  }
  assert.equal(deriveSeriesLengths({ season: 2026, teams: ALL, leagueOf: skewed, playedPairs: m }), null);
});

test("pairKey 는 순서에 무관하다 — 같은 쌍이 두 키가 되면 수가 반토막 난다", () => {
  assert.equal(pairKey("t", "g"), pairKey("g", "t"));
});

import { seasonRace } from "../src/race.ts";
import type { TeamRaceInput } from "../src/race.ts";

/** 12팀을 만든다. `over` 로 특정 팀만 바꾼다 */
function teams(over: Record<string, Partial<TeamRaceInput>> = {}): TeamRaceInput[] {
  return ALL.map((c) => ({
    teamCode: c,
    w: 60, l: 60, t: 0, games: 120,
    ...(over[c] ?? {}),
  }));
}

test("잔여는 규정 경기수에서 소화를 뺀 값이다", () => {
  const r = seasonRace({ season: 2026, teams: teams(), leagueOf, playedPairs: pairs(25, 3) });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.remaining, 143 - 120);
});

/**
 * ⚠**Σ 직접대결 잔여 = 잔여 경기 수** 가 자동으로 성립해야 한다.
 * 안 성립하면 규정 대전수를 잘못 유도한 것이고, 그 위의 판정이 전부 틀린다.
 */
test("⚠상대별 잔여의 합이 잔여 경기 수와 같다 — 이게 어긋나면 판정이 전부 틀린다", () => {
  // ⚠games 를 손으로 118 처럼 적지 않는다 — gamesFor(20,3) 가 대전표(pairs(20,3))에서 그 값을 유도한다.
  // 손으로 적으면 다음 사람이 「왜 이 수인가」를 모른다(2026-08-18, 코디네이터 지적).
  const played = { games: gamesFor(20, 3) };
  const r = seasonRace({
    season: 2026,
    teams: teams(Object.fromEntries(ALL.map((c) => [c, played]))),
    leagueOf,
    playedPairs: pairs(20, 3),
  });
  // ⚠이 assert 가 없으면 유도 실패 시 h2hLeft 가 빈 지도(합 0)·remaining 도 0 이 되어 시험이 공회전 통과한다.
  assert.equal(r.basis, "confirmed");
  for (const [code, tr] of r.teams) {
    const sum = [...tr.h2hLeft.values()].reduce((n, x) => n + x, 0);
    assert.equal(sum, tr.remaining, `${code}: 합 ${sum} · 잔여 ${tr.remaining}`);
  }
});

test("⚠유도가 안 되면 판정하지 않는다 — null 을 채우지 않는다(M11)", () => {
  const r = seasonRace({ season: 2026, teams: teams(), leagueOf, playedPairs: pairs(10, 1) });
  assert.equal(r.basis, "unknown");
  assert.equal(r.teams.get("g")!.selfPossible, null);
  assert.equal(r.teams.get("g")!.magic, null);
  assert.equal(r.teams.get("g")!.eliminated, null);
  // ⚠**잔여는 여전히 안다** — 그건 규정 경기수와 소화만으로 나온다
  assert.equal(r.teams.get("g")!.remaining, 143 - 120);
});

/**
 * ⚠**압도적 1위는 자력우승이 남아 있다.**
 * 巨人이 전승하면 .888, 나머지는 전패해도 아무도 못 넘는다.
 */
test("압도적 1위는 자력우승 가능이다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams({ g: { w: 100, l: 20, t: 0, games: 120 } }),
    leagueOf,
    playedPairs: pairs(25, 3),
  });
  assert.equal(r.teams.get("g")!.selfPossible, true);
});

/**
 * ⚠**Step 5 뮤테이션 검사용 픽스처** — `bMaxWins` 의 `- h` 를 지워도 위의 시험들은 하나도 안 떨어졌다.
 * 원인: 위 시험은 전부 `pairs(25, 3)` 를 쓴다 — 모든 대전이 이미 규정만큼 다 치러진 픽스처라
 * **누구와도 직접대결 잔여(h)가 0** 이다. h=0 이면 `- h` 를 지우든 말든 값이 똑같아서 뮤테이션이 숨는다.
 * → 직접대결이 남아 있는(h>0) 픽스처가 있어야 이 줄을 실제로 잰다.
 * g·t 는 25전 중 5전만 치러 h2hLeft(g,t)=20 을 만든다 — g 가 전승하면 이 20경기는 t 의 확정패다.
 * 그걸 안 빼면(뮤테이션) t 의 최선이 부풀어 g 의 자력우승이 거짓으로 사라진다
 * (실측: mine=0.7902 · 정상 selfPossible=true · 뮤테이션 selfPossible=false, t 의 bBest=0.8037 > mine).
 */
test("⚠직접대결 잔여를 반영해야 자력우승이 정확하다 — 안 빼면 상대를 과대평가한다", () => {
  const pp = pairs(25, 3);
  pp.set(pairKey("g", "t"), 5); // g-t 는 25전 중 5전만 치렀다 → h2hLeft(g,t) = 20
  const r = seasonRace({
    season: 2026,
    teams: teams({ g: { w: 90, l: 30, t: 0, games: 120 }, t: { w: 108, l: 12, t: 0, games: 120 } }),
    leagueOf,
    playedPairs: pp,
  });
  assert.equal(r.teams.get("g")!.selfPossible, true);
});

/**
 * ⚠**꼴찌는 전승해도 못 따라잡으면 소멸이다.**
 * 상대가 **잔여를 전패해도** 내 최선을 넘으면 그것이 소멸이다.
 */
test("전승해도 1위의 최악을 못 넘으면 우승 가능성 소멸이다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams({ g: { w: 110, l: 10, t: 0, games: 120 }, t: { w: 20, l: 100, t: 0, games: 120 } }),
    leagueOf,
    playedPairs: pairs(25, 3),
  });
  assert.equal(r.teams.get("t")!.eliminated, true);
  assert.equal(r.teams.get("t")!.selfPossible, false);
  assert.equal(r.teams.get("g")!.eliminated, false);
});

/**
 * ⚠**매직의 점등 조건은 「다른 모든 팀의 자력 소멸」이다.**
 * 조건을 안 지킨 수를 「マジック」라고 부르면 거짓말이 된다 — SRC/SRP 와 같은 원칙이다.
 */
test("⚠다른 팀의 자력이 살아 있으면 매직은 켜지지 않는다", () => {
  const r = seasonRace({ season: 2026, teams: teams(), leagueOf, playedPairs: pairs(25, 3) });
  assert.equal(r.teams.get("g")!.magic, null, "전원 자력이 살아 있는데 매직이 켜졌다");
});

test("⚠다른 모든 팀의 자력이 소멸하면 매직이 켜진다", () => {
  // 巨人만 압도적. 나머지는 전승해도 巨人의 전패 성적을 못 넘는다
  const over: Record<string, Partial<TeamRaceInput>> = { g: { w: 130, l: 5, t: 0, games: 135 } };
  for (const c of ALL) if (c !== "g") over[c] = { w: 20, l: 115, t: 0, games: 135 };
  const r = seasonRace({ season: 2026, teams: teams(over), leagueOf, playedPairs: pairs(25, 3) });
  const g = r.teams.get("g")!;
  assert.equal(g.magic !== null, true, "점등 조건을 채웠는데 매직이 null 이다");
  assert.ok(g.magic! >= 0, `매직이 음수다: ${g.magic}`);
});

/** ⚠**무승부는 승률 분모에서 빠진다**(NPB). 0으로 나누지 않는다 */
test("⚠경기가 없어도 죽지 않는다 — 0으로 나누지 않는다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(Object.fromEntries(ALL.map((c) => [c, { w: 0, l: 0, t: 0, games: 0 }]))),
    leagueOf,
    playedPairs: new Map(),
  });
  assert.equal(r.basis, "unknown", "경기가 하나도 없는데 유도했다");
});
