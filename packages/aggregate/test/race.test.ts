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
import { deriveSeriesLengths, pairKey, seasonRace } from "../src/race.ts";
import type { TeamRaceInput } from "../src/race.ts";

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
 * 그 대전표에서 나오는 **팀별** 소화 경기 수.
 *
 * ⚠**픽스처가 스스로 모순되지 않게 하는 유일한 방법이다.** 소화를 손으로 적으면 대전표와 어긋나고,
 * 이제 그건 시험 실패가 아니라 **시즌 통째로 `basis: "unknown"`** 이 된다 — 즉 그 시험이 재려던 것을
 * 아무것도 안 재고 조용히 통과한다(2026-08-19 수정 라운드).
 *
 * ⚠**옛 `gamesFor(intra, inter) = intra*5 + inter*6` 을 지웠다.** 대전표가 균일하지 않은 픽스처
 * (예: `g`-`t` 만 덜 치른 경우)에서 그 식이 대전표와 갈리기 때문이다. 소화는 **대전표에서만** 나온다.
 */
function gamesFromPairs(pp: ReadonlyMap<string, number>): Map<string, number> {
  const m = new Map<string, number>(ALL.map((c) => [c, 0]));
  for (let i = 0; i < ALL.length; i += 1) {
    for (let j = i + 1; j < ALL.length; j += 1) {
      const a = ALL[i]!;
      const b = ALL[j]!;
      const n = pp.get(pairKey(a, b)) ?? 0;
      m.set(a, m.get(a)! + n);
      m.set(b, m.get(b)! + n);
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

// ─── 우승 경쟁 판정 ──────────────────────────────────────────────────────────

/**
 * 팀별 override. **없는 값은 대전표에서 유도한다** — 그래서 픽스처가 스스로 모순되지 않는다.
 *
 * - `games` 를 안 주면 대전표에서 나온 소화 경기 수
 * - `l` 을 안 주면 `games − w − t` (즉 `w + l + t === games` 가 공짜로 성립)
 * - `w` 를 안 주면 반타작
 *
 * ⚠**`games`·`l` 을 명시하는 것은 「일부러 어긋내는」 시험뿐이다.**
 */
interface Over {
  w?: number;
  l?: number;
  t?: number;
  games?: number;
}

/** 12팀을 만든다. `over` 로 특정 팀만 바꾼다 */
function teams(pp: ReadonlyMap<string, number>, over: Record<string, Over> = {}): TeamRaceInput[] {
  const derived = gamesFromPairs(pp);
  return ALL.map((c) => {
    const o = over[c] ?? {};
    const games = o.games ?? derived.get(c) ?? 0;
    const t = o.t ?? 0;
    const w = o.w ?? Math.floor((games - t) / 2);
    const l = o.l ?? games - w - t;
    return { teamCode: c, w, l, t, games };
  });
}

/**
 * 대부분의 픽스처가 쓰는 **시즌 중간** 상태.
 * 리그내 25전 중 20전 · 교류전 3전 전부 소화 → 팀당 `20×5 + 3×6 = 118` 경기, 잔여 25.
 * 상대별 잔여는 **같은 리그 5팀에 각 5경기** · 교류전 0 → 합 25 = 잔여 ✓
 *
 * ⚠**옛 픽스처는 `pairs(25, 3)` + `games: 120` 이었다** — 대전표는 143경기를 다 치렀다고 하는데
 * 성적은 120경기라고 하는 모순이었고, 그 상태에서는 Σ 불변식(I3)이 시즌을 `unknown` 으로 떨어뜨린다.
 */
const MID = (): Map<string, number> => pairs(20, 3);
/** 위 픽스처의 팀당 소화 경기 수 */
const MID_GAMES = 118;

test("잔여는 규정 경기수에서 소화를 뺀 값이다", () => {
  const r = seasonRace({ season: 2026, teams: teams(MID()), leagueOf, playedPairs: MID() });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.remaining, 143 - MID_GAMES);
  /**
   * ⚠**판정이 선 시즌에는 어긋난 팀이 하나도 없다.**
   * 이 줄이 「`disagreed` 를 항상 채우기」를 잡는다 — 아래 어긋난 픽스처의 단언과 짝이다.
   */
  assert.deepEqual(r.disagreed, []);
  assert.deepEqual(r.series, { intra: 25, inter: 3 });
});

/**
 * ⚠**Σ 직접대결 잔여 = 잔여 경기 수.**
 * 안 성립하면 규정 대전수를 잘못 유도했거나 성적과 대전표가 다른 세계의 것이고, 그 위의 판정이 전부 틀린다.
 */
test("⚠상대별 잔여의 합이 잔여 경기 수와 같다 — 이게 어긋나면 판정이 전부 틀린다", () => {
  const r = seasonRace({ season: 2026, teams: teams(MID()), leagueOf, playedPairs: MID() });
  // ⚠이 assert 가 없으면 유도 실패 시 h2hLeft 가 빈 지도(합 0)·remaining 도 0 이 되어 시험이 공회전 통과한다.
  assert.equal(r.basis, "confirmed");
  for (const [code, tr] of r.teams) {
    const sum = [...tr.h2hLeft.values()].reduce((n, x) => n + x, 0);
    assert.equal(sum, tr.remaining, `${code}: 합 ${sum} · 잔여 ${tr.remaining}`);
    // ⚠**교류전 잔여도 잔여다** — h2hLeft 는 리그를 가르지 않고 11팀 전부를 담는다
    assert.equal(tr.h2hLeft.size, 11, `${code}: 상대가 11팀이 아니다`);
  }
});

test("⚠유도가 안 되면 판정하지 않는다 — null 을 채우지 않는다(M11)", () => {
  const pp = pairs(10, 1);
  const r = seasonRace({ season: 2026, teams: teams(pp), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "unknown");
  assert.equal(r.teams.get("g")!.selfPossible, null);
  assert.equal(r.teams.get("g")!.magic, null);
  assert.equal(r.teams.get("g")!.eliminated, null);
  /**
   * ⚠**잔여는 여전히 안다** — 그건 규정 경기수와 소화만으로 나온다.
   * ⚠**이 자리가 「`unknown` 이면 전부 `null`」을 막는다**(재리뷰 Important A).
   * 교류전이 안 끝나 유도를 못 하는 것뿐이고 성적은 스스로 앞뒤가 맞는다
   * (`w + l + t === games` · `0 ≤ 56 ≤ 143`) — 그러면 잔여는 **아는 값**이다.
   */
  assert.equal(r.teams.get("g")!.remaining, 143 - (10 * 5 + 1 * 6));
  // ⚠**상대별 잔여는 모른다** — 규정 대전수를 모르면 뺄 대상이 없다
  assert.equal(r.teams.get("g")!.h2hLeft.size, 0);
  /**
   * ⚠**「아직 모름(정상)」의 모양을 못 박는다**(재리뷰 Important C).
   * 유도 자체가 실패했으므로 `series` 는 `null` 이고 어긋난 팀은 없다.
   * 이것이 아래 「입력이 어긋남(버그)」과 반환값에서 구별돼야 한다.
   */
  assert.equal(r.series, null);
  assert.deepEqual(r.disagreed, [], "어긋난 팀이 없는데 이름이 올라왔다");
});

/**
 * ⚠**압도적 1위는 자력우승이 남아 있다.**
 * 巨人이 잔여 25를 전승하면 `125/143 = .874`, 리그의 나머지는 전승해도 `79/143 = .552` 다.
 */
test("압도적 1위는 자력우승 가능이다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { g: { w: 100 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.teams.get("g")!.selfPossible, true);
  assert.equal(r.teams.get("g")!.eliminated, false);
});

/**
 * ⚠**Step 5 뮤테이션 검사용 픽스처** — `bMaxWins` 의 `- h` 를 지워도 다른 시험은 하나도 안 떨어진다.
 * 원인: 다른 시험은 리그내 대전이 5경기씩만 남아 h 가 작다. **직접대결이 크게 남은 픽스처**가 있어야 잰다.
 *
 * `g`-`t` 는 **한 경기도 안 치렀다**(다른 쌍은 20전) → 둘 다 소화 98 · 잔여 45 · h2hLeft(g,t) = 25.
 * 실측: `g` 최선 `105/143 = .734` ·
 *   정상 `t` 최선 `(80+45−25)/143 = 100/143 = .699` → `g.selfPossible = true`
 *   뮤테이션(−h 제거) `t` 최선 `125/168 = .744` → **`.744 > .734` 로 `g.selfPossible = false`**.
 */
test("⚠직접대결 잔여를 반영해야 자력우승이 정확하다 — 안 빼면 상대를 과대평가한다", () => {
  const pp = MID();
  pp.set(pairKey("g", "t"), 0);
  const r = seasonRace({
    season: 2026,
    teams: teams(pp, { g: { w: 60 }, t: { w: 80 } }),
    leagueOf,
    playedPairs: pp,
  });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.h2hLeft.get("t"), 25);
  assert.equal(r.teams.get("g")!.selfPossible, true);
});

/**
 * ⚠**꼴찌는 전승해도 못 따라잡으면 소멸이다.**
 * 상대가 **잔여를 전패해도** 내 최선을 넘으면 그것이 소멸이다.
 * `t` 최선 `45/143 = .315` · `g` 최악 `105/143 = .734`.
 */
test("전승해도 1위의 최악을 못 넘으면 우승 가능성 소멸이다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { g: { w: 105 }, t: { w: 20 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.teams.get("t")!.eliminated, true);
  assert.equal(r.teams.get("t")!.selfPossible, false);
  assert.equal(r.teams.get("g")!.eliminated, false);
});

// ─── 리그 분리 ────────────────────────────────────────────────────────────────

/**
 * ⚠**페넌트는 리그별이다.** 12팀 전체로 비교하면 한 리그의 독주팀이 다른 리그 전체를 소멸시킨다.
 *
 * 실측(2026-08-19, 리그 필터가 없던 판): 퍼시픽 `h` 가 독주하면
 * **센트럴 6팀이 전부 `self false · elim true · magic null`** 로 나왔다 —
 * 센트럴 선두 옆에 「消滅」이라고 쓰는 화면이다.
 *
 * 이 픽스처: `h`(퍼시픽) 95승23패 · `g`(센트럴 선두) 65승53패 · 나머지 59승59패.
 * `g` 최선 `90/143 = .629` 인데 `h` 최악은 `95/143 = .664` 다 —
 * **리그를 안 가르면 `.664 > .629` 로 `g` 가 소멸**하고, `h` 최선 `120/143 = .839` 로 자력도 죽는다.
 */
test("⚠다른 리그의 독주팀은 내 판정에 들어오지 않는다 — 안 가르면 센트럴 전멸이다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { h: { w: 95 }, g: { w: 65 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.selfPossible, true, "다른 리그 독주팀이 센트럴 선두의 자력을 죽였다");
  for (const c of CENTRAL) {
    assert.equal(r.teams.get(c)!.eliminated, false, `${c}: 다른 리그 때문에 소멸로 나왔다`);
  }
  // 독주팀 자신은 정상이어야 한다(이 시험이 「전부 false」로 눌러 통과하는 것을 막는다)
  assert.equal(r.teams.get("h")!.selfPossible, true);
  assert.equal(r.teams.get("h")!.eliminated, false);
});

/**
 * ⚠**매직의 점등 조건도 리그 안에서 센다.**
 * 센트럴은 `g` 가 이미 우승을 확정했는데(다른 5팀 전부 자력소멸) 퍼시픽은 6팀 전부 자력이 살아 있다.
 * 12팀으로 세면 `allGone` 이 영원히 거짓이라 **센트럴 1위의 매직이 절대 안 켜진다.**
 *
 * `g` 100승18패 · 센트럴 나머지 45승73패 · 퍼시픽 59승59패(전원 자력 생존).
 * 센트럴 최대 승수는 `45 + 25 = 70` 으로 `g` 의 현재 100승보다 낮다 → **매직 0(우승 확정)**.
 */
test("⚠매직 점등은 같은 리그 안에서만 센다 — 다른 리그의 생존자가 막으면 안 된다", () => {
  const over: Record<string, Over> = { g: { w: 100 } };
  for (const c of CENTRAL) if (c !== "g") over[c] = { w: 45 };
  const r = seasonRace({ season: 2026, teams: teams(MID(), over), leagueOf, playedPairs: MID() });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.magic, 0, "센트럴은 전원 자력소멸인데 매직이 안 켜졌다");
  // 퍼시픽은 전원 자력 생존이므로 아무도 매직이 없다 — 「12팀으로 세면 g 가 못 켠다」의 반대편 증거
  for (const c of PACIFIC) assert.equal(r.teams.get(c)!.magic, null, `${c}: 자력 생존자만 있는데 매직이 켜졌다`);
});

// ─── 매직 값 ─────────────────────────────────────────────────────────────────

/**
 * ⚠**매직의 「값」을 잰다.** 이전 판은 `magic !== null` 과 `magic >= 0` 둘뿐이었는데
 * `magic` 은 `0` 으로 초기화된 뒤 `Math.max` 로만 누적됐으므로 **`>= 0` 은 어떤 식을 넣어도 참**이었다.
 * 실측(2026-08-19): 그 픽스처가 받던 값은 `0` 이고 원식은 `20 + 8 − 130 + 1 = −101` 이었다 —
 * 즉 `+1`→`+100` · `Math.max`→`Math.min` · `− me.w`→`− me.l` 뮤테이션이 **전부 통과**했다.
 *
 * 이 픽스처는 **매직이 양수로 나오는** 상태를 만든다.
 * 리그내 23전씩 소화(잔여 10 · 직접대결 잔여 2) ·
 * `g` 95승38패 · 2위 `t` 88승45패(최대 98승) · 나머지는 그보다 낮다.
 * ```
 * 매직 = 2위 최대 승수 − 내 현재 승수 + 1 = (88 + 10) − 95 + 1 = 4
 * ```
 * 센트럴 나머지 5팀은 전부 자력소멸이다(`g` 의 최선 `103/143 = .720` 이 각 팀 최선보다 높다 —
 * `t` `98/143 = .685` · `db` `.629` · `c` `.594` · `d` `.559` · `s` `.490`).
 */
test("⚠매직은 「2위의 최대 승수 − 내 승수 + 1」이다 — 값을 못 박는다", () => {
  const pp = pairs(23, 3);
  const r = seasonRace({
    season: 2026,
    teams: teams(pp, {
      g: { w: 95 },
      t: { w: 88 },
      db: { w: 80 },
      c: { w: 75 },
      d: { w: 70 },
      s: { w: 60 },
    }),
    leagueOf,
    playedPairs: pp,
  });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.remaining, 10);
  assert.equal(r.teams.get("g")!.magic, 4);
  // 2위에게는 매직이 없다 — 매직은 「다른 전원이 자력소멸」인 팀에게만 붙는다
  assert.equal(r.teams.get("t")!.magic, null);
});

/**
 * ⚠**매직은 음수로 나가지 않는다.** 원식이 음수인 채로 나가면 화면에 「マジック −54」가 찍힌다.
 *
 * ⚠**주석 정정(2026-08-19 검토 지적 a).** 여기 「원식이 음수 → 0 = 우승 확정」이라고 적혀 있었는데
 * **그건 일반적으로 참이 아니다.** 원식은 승수식이고 순위 판정은 승률식이라, **무승부가 많으면
 * 아직 뒤집히는 상태에서도 원식이 음수가 된다**(아래 시험이 그 반례다 — 원값 `−1` · 라이벌 생존).
 * 예전 `Math.max(0, magic)` 클램프는 그 둘을 구별하지 않고 전부 `0`(= 우승 확정)으로 접었다.
 * 리뷰 프로브 실측: 점등 **241,384건 중 11,648건(4.8%)**이 「미확정인데 매직 0」이었다.
 * → 지금은 **`0` 을 「타팀 전원 소멸」이 증명됐을 때만** 쓴다. 클램프는 지웠다.
 *
 * **이 픽스처가 재는 것은 클램프가 아니라 그 「전원 소멸」 가지다.**
 * 리그내 24전 소화(잔여 5) · `g` 110승28패 · 나머지 50승88패.
 * 나머지의 최선 `55/143 = .385` 가 `g` 의 최악 `110/143 = .769` 에 못 미쳐 **5팀 전부 소멸**이다 →
 * 우승 확정 → `0`. (승수식 원값은 `55 − 110 + 1 = −54` 지만 그건 이제 안 쓰인다.)
 * ⚠**뮤테이션**: 「전원 소멸 → 0」 가지를 지우면 이 시험이 `null` 을 받아 떨어진다.
 */
test("⚠타팀이 전원 소멸이면 매직은 0 이다 — 음수 원값이 화면에 나가지 않는다", () => {
  const pp = pairs(24, 3);
  const over: Record<string, Over> = { g: { w: 110 } };
  for (const c of CENTRAL) if (c !== "g") over[c] = { w: 50 };
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "confirmed");
  // 「0 = 우승 확정」의 근거가 실제로 성립하는지 같이 잰다 — 이게 없으면 위 단언의 뜻이 비어 있다
  for (const c of CENTRAL) {
    if (c === "g") continue;
    assert.equal(r.teams.get(c)!.eliminated, true, `${c}: 전원 소멸이 전제인데 소멸이 아니다`);
  }
  assert.equal(r.teams.get("g")!.magic, 0);
});

/**
 * ⚠**「미확정인데 매직 0」 — 반대 방향의 거짓말**(2026-08-19 검토 지적 a · 리뷰 프로브 재현).
 *
 * 매직은 관례가 **승수식**인데 NPB 순위는 **승률식**(무승부가 분모에서 빠진다)이다.
 * 그래서 무승부가 많은 팀은 **승수가 적어도 승률로는 아직 따라잡을 수 있다** — 그때 승수식 원값은
 * 0 이하로 내려간다. 옛 `Math.max(0, magic)` 는 그 값을 `0` 으로 접었고,
 * 직전 수정이 「`0` = 우승 확정」의 의미를 **강화**했기 때문에 이 오류가 더 위험해졌다:
 * 아직 2위가 살아 있는데 화면에 「M 0(우승)」이 나간다.
 * 실측(리뷰 프로브 · 현실형 분포): 점등 **241,384건 중 11,648건 = 4.8%**.
 * ⚠무승부 8·16 은 NPB 에서 흔한 수치다(2021 센트럴이 10~20).
 *
 * 이 픽스처(리그내 22전 소화 · 잔여 15 · 직접대결 잔여 3):
 * ```
 * t  73-47- 8  최선 88/135 = .652  최악 73/135 = .541   ← 선두
 * s  56-56-16  최선 71/127 = .559                        ← .559 > .541 이라 **아직 안 죽었다**
 * 나머지 4팀 50-78-0 최선 65/143 = .455
 * ```
 * `t` 의 자력은 살아 있고(최선 .652 가 누구보다 높다) 5팀 전부 자력은 죽었다
 * (`t` 가 맞대결을 다 져도 `85/135 = .630` 이라 `s` 의 .559 를 넘는다) → **매직 점등 조건은 성립**.
 * 그런데 승수식 원값은 `max(56, 50…) + 15 − 73 + 1 = −1` 이다.
 * 실측(2026-08-19 프로브): 고치기 전 코드가 `t.magic = 0` 을 냈고 `s.eliminated` 는 `false` 였다.
 *
 * → **`null` 이 정답이다** — 「승수식으로는 표현할 수 없다」. `0` 으로 접으면 M11 위반이다.
 * ⚠**뮤테이션**: `null` 자리를 `Math.max(0, magic)` 로 되돌리면 이 시험이 `0` 을 받아 떨어진다.
 */
test("⚠미확정인데 승수식이 0 이하면 매직은 null 이다 — 0 으로 접으면 「우승 확정」이라는 거짓말이 된다", () => {
  const pp = pairs(22, 3); // 팀당 22×5 + 3×6 = 128경기 · 잔여 15 · 리그내 직접대결 잔여 3
  const over: Record<string, Over> = { t: { w: 73, t: 8 }, s: { w: 56, t: 16 } };
  for (const c of CENTRAL) if (c !== "t" && c !== "s") over[c] = { w: 50 };
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("t")!.remaining, 15);
  // ⑴ 점등 조건은 성립한다 — 내 자력은 살아 있고 리그 내 다른 5팀은 전부 자력이 죽었다
  assert.equal(r.teams.get("t")!.selfPossible, true, "선두의 자력이 죽었다 — 이 시험의 전제가 깨졌다");
  for (const c of CENTRAL) {
    if (c === "t") continue;
    assert.equal(r.teams.get(c)!.selfPossible, false, `${c}: 자력이 살아 있으면 매직이 애초에 안 켜진다`);
  }
  // ⑵ 그런데 **우승은 아직 확정이 아니다** — 무승부 16 인 `s` 가 승률로는 여전히 뒤집는다
  assert.equal(r.teams.get("s")!.eliminated, false, "s 가 소멸이면 이 시험이 재려는 상태가 아니다");
  // ⑶ 그러므로 매직은 `0`(= 우승 확정)이 아니라 `null` 이다
  assert.equal(
    r.teams.get("t")!.magic,
    null,
    "미확정인데 매직이 0 으로 나갔다 — 「우승 확정」이라는 반대 방향의 거짓말이다",
  );
});

/**
 * ⚠**매직의 점등 조건은 「같은 리그 다른 모든 팀의 자력 소멸」이다.**
 * 조건을 안 지킨 수를 「マジック」라고 부르면 거짓말이 된다 — SRC/SRP 와 같은 원칙이다.
 * 이 픽스처는 전원 59승59패라 아무도 자력이 죽지 않는다(각자 최선 `.587` · 상대 최선 `.552`).
 */
test("⚠다른 팀의 자력이 살아 있으면 매직은 켜지지 않는다", () => {
  const r = seasonRace({ season: 2026, teams: teams(MID()), leagueOf, playedPairs: MID() });
  for (const c of ALL) {
    assert.equal(r.teams.get(c)!.selfPossible, true, `${c}: 전원 동률인데 자력이 죽었다`);
    assert.equal(r.teams.get(c)!.magic, null, `${c}: 전원 자력이 살아 있는데 매직이 켜졌다`);
  }
});

/**
 * ⚠**무승부가 많아 승수식과 승률식이 갈리면 우승 확정 팀의 매직이 0 이 아닐 수 있었다**(실측 결함 —
 * 2021 센트럴, `.superpowers/sdd/task-3-report.md`). 매직은 관례대로 **승수식**인데 NPB 순위는
 * **승률식**(무승부는 분모에서 빠진다)이라 무승부가 많은 시즌에 「승률 1위 = 승수 2위」가 나올 수 있다.
 *
 * 이 픽스처는 2021 센트럴의 모양을 그대로 쓴다(완결 · 잔여 0):
 * `s` 73승52패18무(.584) 가 승률 1위, `t` 77승56패10무(.579) 가 승수는 더 많지만 승률 2위.
 * 나머지 4팀(`g`·`db`·`c`·`d`)은 70승73패(.490) 로 더 낮다.
 *
 * 클램프 없는 원식(승수식): `2위(t) 최대 승수 − s 승수 + 1 = 77 − 73 + 1 = 5`.
 * `s` 는 이미 리그 내 5팀 전부를 자력소멸시켰으므로 우승이 확정돼 있다 — 매직은 **0** 이어야 한다.
 */
test("⚠승률 1위가 승수 2위인 완결 시즌(2021 센트럴 모양)에서도 우승 확정 팀의 매직은 0이다", () => {
  const pp = pairs(25, 3); // 완결(리그내 25 · 교류전 3 전부 소화) → 팀당 143경기 · 잔여 0
  const over: Record<string, Over> = {
    s: { w: 73, t: 18 }, // .584 — 승률 1위
    t: { w: 77, t: 10 }, // .579 — 승수는 더 많지만 승률 2위
    g: { w: 70, t: 0 },
    db: { w: 70, t: 0 },
    c: { w: 70, t: 0 },
    d: { w: 70, t: 0 },
  };
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("s")!.remaining, 0);
  assert.equal(r.teams.get("s")!.eliminated, false);
  assert.equal(r.teams.get("s")!.selfPossible, true);
  // 승수는 많지만 승률로 밀린 t 도 잔여 0 이면 소멸이다 — 그래야 「전원 자력소멸」이 성립한다
  assert.equal(r.teams.get("t")!.eliminated, true, "승수는 많지만 승률로 밀린 t 가 소멸이 아니다");
  // 승수식 원값은 5(=77−73+1) 인데, 전원 자력소멸이라 우승은 이미 확정이다 — 매직은 0
  assert.equal(r.teams.get("s")!.magic, 0, "우승 확정 팀의 매직이 0 이 아니다(승수식·승률식 불일치)");
});

// ─── 동률 경계(M3) ────────────────────────────────────────────────────────────

/**
 * ⚠**동률은 「가능성 있음」이고, 동률인지는 표시 자릿수(소수 3자리)에서 가른다.**
 * 배정밀도로 가르면 순위표는 「同」이라고 쓰는데 옆 배지는 「消滅」이라고 쓰는 상태가 된다.
 * 규칙은 `standings.ts` 의 `pctKey` 한 벌이다(M1).
 *
 * 자력(`selfPossible`) 쪽 경계:
 * `g` 55승58패5분(소화 118 · 잔여 25) 최선 `80/138 = .57971` ·
 * `d` 63승55패 최선 `(63+25−5)/143 = 83/143 = .58042` → **둘 다 `.580`**.
 * 원값으로 가르면 `.58042 > .57971` 이라 `g` 의 자력이 조용히 죽는다.
 */
test("⚠동률이면 자력은 살아 있다 — 표시 자릿수에서 가른다(pctKey)", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { g: { w: 55, t: 5 }, d: { w: 63 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.selfPossible, true, "표시 자릿수로는 동률인데 자력이 죽었다");
  assert.equal(r.teams.get("g")!.eliminated, false);
});

/**
 * 소멸(`eliminated`) 쪽 경계. **두 뮤테이션을 동시에 잡는다.**
 *
 * `g` 55승58패5분 최선 `80/138 = .57971` → `.580` ·
 * `t` 83승35패 최악 `83/(35+25+83) = 83/143 = .58042` → `.580`.
 * - `pctKey` 를 빼고 원값으로 비교하면 `.58042 > .57971` → `eliminated = true`
 * - `bWorst > mine` 을 `>=` 로 바꾸면 `.580 >= .580` → `eliminated = true`
 *
 * ⚠**소멸과 자력소멸은 다른 것이다.** 같은 픽스처에서 `g` 의 자력은 죽어 있다
 * (`t` 최선 `103/143 = .720` > `.580`) — 「아직 가능성은 있지만 남의 손에 달렸다」가 정확한 상태다.
 */
test("⚠상대의 최악이 내 최선과 동률이면 소멸이 아니다 — 동률은 「가능성 있음」", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { g: { w: 55, t: 5 }, t: { w: 83 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.eliminated, false, "동률인데 소멸로 나왔다");
  assert.equal(r.teams.get("g")!.selfPossible, false, "자력은 죽어 있어야 한다 — 소멸과 다른 것이다");
});

// ─── 입력이 스스로 어긋나는 경우(M7·M11) ─────────────────────────────────────

/**
 * ⚠**「Σ 잔여 = 잔여」는 자동으로 성립하지 않는다.** 성적(`games`)과 대전표(`playedPairs`)는
 * 별개 입력이라 어긋날 수 있고, 이 태스크의 첫 판이 정확히 그 반례로 반려됐다.
 * 中止 재편성으로 실측 어긋남도 관측돼 있다(中日 +3 · 阪神 +1 · 広島 −1).
 *
 * 대전표는 118경기(`20×5 + 3×6`)라고 하는데 성적은 120경기라고 한다 →
 * 합 25 대 잔여 23. 어긋난 h2h 로 계산한 최대 승수가 **다른 팀 판정에도 섞이므로**
 * 그 팀만이 아니라 **시즌 전체**를 `unknown` 으로 떨어뜨린다.
 */
test("⚠대전표와 성적이 어긋나면 시즌 전체를 판정하지 않는다(M7·M11)", () => {
  const over: Record<string, Over> = {};
  for (const c of ALL) over[c] = { w: 60, l: 60, t: 0, games: 120 };
  const r = seasonRace({ season: 2026, teams: teams(MID(), over), leagueOf, playedPairs: MID() });
  assert.equal(r.basis, "unknown", "합 25 · 잔여 23 인데 판정했다");
  /**
   * ⚠**여기가 「입력이 어긋남(버그)」의 모양이다**(재리뷰 Important C).
   * 이전 판은 `series` 를 `null` 로 덮어써서 **유도는 성공했다는 사실까지 지웠고**,
   * 그 결과 5월(정상 미유도)과 파이프라인 버그가 반환값에서 완전히 같은 모양이었다.
   * 유도는 됐다 — 어긋난 것은 성적 쪽이고, `disagreed` 가 그것을 가리킨다.
   */
  assert.deepEqual(r.series, { intra: 25, inter: 3 }, "유도는 성공했는데 그 사실을 지웠다");
  assert.deepEqual(r.disagreed, [...ALL].sort(), "어긋난 팀을 못 가리킨다");
  for (const c of ALL) {
    const tr = r.teams.get(c)!;
    assert.equal(tr.selfPossible, null, `${c}`);
    assert.equal(tr.eliminated, null, `${c}`);
    assert.equal(tr.magic, null, `${c}`);
    // ⚠**틀린 잔여를 흘리지 않는다** — 조용한 오답이 예외보다 나쁘다
    assert.equal(tr.h2hLeft.size, 0, `${c}: 어긋난 대전표의 잔여를 그대로 내보냈다`);
  }
  /**
   * ⚠**잔여 자체는 규정 경기수와 소화만으로 나온다.**
   * 여기서 성적은 스스로 앞뒤가 맞는다(`60 + 60 + 0 = 120` · `0 ≤ 120 ≤ 143`) —
   * 어긋난 것은 **대전표와의 대조**뿐이다. 그러니 잔여까지 `null` 로 만들면 아는 것을 버리는 것이다.
   */
  assert.equal(r.teams.get("g")!.remaining, 143 - 120);
});

/**
 * ⚠**`w + l + t === games` 는 공짜 검산이다.** 이전 판은 `TeamRaceInput.t` 를 선언만 하고
 * 어디에서도 읽지 않아 이 검산을 버렸다.
 *
 * 이 픽스처는 대전표와는 앞뒤가 맞고(118 = 118, 그래서 Σ 검사는 통과한다) **성적만** 어긋난다 —
 * `59 + 58 + 0 = 117 ≠ 118`. 그러니까 이 시험이 떨어지는 이유는 `w+l+t` 검사 하나뿐이다.
 */
test("⚠승·패·무의 합이 소화 경기와 다르면 판정하지 않는다", () => {
  const r = seasonRace({
    season: 2026,
    teams: teams(MID(), { g: { w: 59, l: 58, t: 0 } }),
    leagueOf,
    playedPairs: MID(),
  });
  assert.equal(r.basis, "unknown", "117 경기치 성적을 118 경기라고 하는데 판정했다");
  assert.equal(r.teams.get("t")!.selfPossible, null, "어긋난 것은 g 인데 t 를 판정했다");
  /**
   * ⚠**한 팀만 어긋났으면 한 팀만 가리킨다.** 판정은 시즌 전체를 접지만
   * **어디를 봐야 하는지는 정확히 알려야 한다**(재리뷰 Important C).
   * 이 시험이 「`disagreed` 를 항상 전 팀으로 채우기」와 「항상 빈 배열」을 동시에 잡는다.
   */
  assert.deepEqual(r.disagreed, ["g"]);
  assert.deepEqual(r.series, { intra: 25, inter: 3 }, "유도는 성공했다");
  /**
   * ⚠**잔여도 어긋난 팀만 `null` 이다**(재리뷰 Important A · M11).
   * `g` 는 성적이 스스로 안 맞으니(`59 + 58 + 0 = 117 ≠ 118`) 잔여를 **모른다**.
   * `t` 는 자기 성적만 보면 멀쩡하니(`59 + 59 + 0 = 118`) 잔여를 **안다**.
   * ⚠이 두 줄이 짝이다 — 한쪽만 있으면 「전부 null」이나 「전부 숫자」로 눌러도 통과한다.
   */
  assert.equal(r.teams.get("g")!.remaining, null, "어긋난 성적으로 잔여를 계산했다");
  assert.equal(r.teams.get("t")!.remaining, 143 - 118, "멀쩡한 팀의 잔여까지 버렸다");
});

/**
 * ⚠**소화가 규정을 넘으면 잔여가 음수가 된다.** `home-page.ts` 가 소화를 행 수로 세던 시절
 * 팀당 144~153 이 나온 실측이 있다. 음수 잔여를 승수에 그대로 더하면 **자기 최선을 깎아**
 * 소멸이 거짓으로 켜진다.
 *
 * ⚠**판정(`basis`)을 접는 것은 Σ 검사다** — 상대별 잔여는 절대 음수가 될 수 없으므로(유도 상수 ≥ 치른 수)
 * Σ 는 항상 `≥ 0` 인데 `total − games` 는 음수다. 그래서 `agrees` 쪽에는 `games > total` 이 없다.
 * **잔여(`remaining`) 쪽에는 그 검사가 살아 있다** — 그쪽은 유도가 실패해 Σ 검사가 아예 안 도는
 * 경로(교류전 미완)도 통과해야 하므로 중복이 아니다.
 */
test("⚠소화가 규정 경기수를 넘으면 판정하지 않는다 — 잔여가 음수다", () => {
  const pp = pairs(25, 3);
  const over: Record<string, Over> = {};
  for (const c of ALL) over[c] = { w: 75, l: 70, t: 3, games: 148 };
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "unknown");
  assert.equal(r.teams.get("g")!.selfPossible, null);
  assert.equal(r.teams.get("g")!.eliminated, null);
  /**
   * ⚠**이 시험의 이름이 말하는 값을 못 박는다**(재리뷰 Important A · Minor d).
   * 이전 판은 여기서 **`remaining: −5`** 를 그대로 내보냈고 아무도 그걸 단언하지 않았다.
   * 소비자가 `残り${remaining}試合` 를 쓰면 「残り −5試合」가 화면에 나간다 —
   * 이 저장소는 음수 잔여를 화면까지 내보낸 전례가 이미 있다(`home-page.ts:15`).
   */
  for (const c of ALL) {
    assert.equal(r.teams.get(c)!.remaining, null, `${c}: 믿을 수 없다고 판정한 입력으로 잔여를 냈다`);
  }
  // 유도는 성공했다 — 어긋난 것은 성적 쪽이고 전 팀이 어긋났다
  assert.deepEqual(r.series, { intra: 25, inter: 3 });
  assert.deepEqual(r.disagreed, [...ALL].sort());
});

// ─── 0으로 나누지 않는다(M11) ────────────────────────────────────────────────

/**
 * ⚠**무승부는 승률 분모에서 빠진다**(NPB). 143경기가 **전부 무승부**면 `勝 + 敗 = 0` 이라
 * 승률이 `null` 이고, 그러면 **판정을 낼 수 없다** — 0 으로 두면 「전패」로 읽힌다.
 *
 * ⚠이전 판의 같은 이름 시험은 `basis === "unknown"` 한 줄뿐이라 **나눗셈 경로를 밟지도 않았다**
 * (대전표가 비면 유도 단계에서 멈춘다). `winPct` 의 `w + l === 0` 가지를 지워도 전부 통과했다.
 * 이 픽스처는 그 가지를 실제로 밟는다 — 지우면 `mine` 이 `NaN` 이 되어 `null` 검사를 통과하고
 * `selfPossible` 이 `true` 로 나온다.
 */
test("⚠전 경기가 무승부면 판정하지 않는다 — 0으로 나누지 않는다", () => {
  const pp = pairs(25, 3);
  const over: Record<string, Over> = {};
  for (const c of ALL) over[c] = { w: 0, l: 0, t: 143 };
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  // 대전표와 성적은 앞뒤가 맞는다 — 유도는 성공한다
  assert.equal(r.basis, "confirmed");
  assert.equal(r.teams.get("g")!.remaining, 0);
  assert.equal(r.teams.get("g")!.selfPossible, null, "승률이 없는데 자력을 판정했다");
  assert.equal(r.teams.get("g")!.eliminated, null, "승률이 없는데 소멸을 판정했다");
  assert.equal(r.teams.get("g")!.magic, null, "승률이 없는데 매직을 켰다");
});

/** ⚠**대전표가 비면 규정 대전수를 유도할 수 없다** — `(143 − 0) / 5 = 28.6` 은 정수가 아니다 */
test("⚠대전표가 비면 유도하지 않는다", () => {
  const r = seasonRace({ season: 2026, teams: teams(new Map()), leagueOf, playedPairs: new Map() });
  assert.equal(r.basis, "unknown", "경기가 하나도 없는데 유도했다");
  assert.equal(r.teams.get("g")!.selfPossible, null);
  assert.equal(r.teams.get("g")!.eliminated, null);
  assert.equal(r.teams.get("g")!.magic, null);
  assert.equal(r.teams.get("g")!.remaining, 143);
});

// ─── 3차 재리뷰 수정(Important · Minor m1 · Minor m2) ──────────────────────

/**
 * ⚠**유도 실패와 팀별 자체 모순이 겹치면 `disagreed` 가 비면 안 된다**(3차 재리뷰 Important).
 * 리뷰 프로브 그대로: 교류전이 안 끝나(대전표가 빔) 유도가 실패한 상태에서 `g` 만 `w+l+t≠games` 로
 * 자체 모순이다. 이전 판은 `x.w+x.l+x.t!==x.games` 검사가 `if (derived !== null)` 블록 안에
 * 갇혀 있어서 유도 실패 경로에서는 **전혀 안 돌았다** — 「대전표는 아직 못 세는데 파이프라인이
 * 성적을 망가뜨린」 상태가 `disagreed: []` 로 숨었다(`g.remaining === null` 로만 드러났다).
 *
 * ⚠**뮤테이션**: 이 검사를 다시 `if (derived !== null)` 안으로 넣으면 이 시험이 떨어진다
 * (`disagreed` 가 `[]` 로 돌아간다).
 */
test("⚠유도 실패 + 팀별 자체 모순이 겹치면 disagreed 가 비지 않는다(3차 재리뷰 Important)", () => {
  const pp = new Map<string, number>(); // 교류전 미완 재현 — 빈 대전표(유도 자체가 실패한다)
  const over: Record<string, Over> = { g: { w: 10, l: 10, t: 0, games: 21 } }; // 20 ≠ 21 자체 모순
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "unknown");
  assert.equal(r.series, null, "빈 대전표인데 유도됐다");
  assert.deepEqual(r.disagreed, ["g"], "유도 실패 때문에 팀별 자체 모순이 안 잡혔다");
  assert.equal(r.teams.get("g")!.remaining, null, "20 ≠ 21 인 입력으로 잔여를 계산했다");
});

/**
 * ⚠**팀코드가 중복 입력되면 `disagreed` 는 dedup 돼야 한다**(3차 재리뷰 Minor m1).
 * `teamCode` 는 입력 계약상 유일해야 하지만 타입으로는 강제되지 않는다 — 위반 시에도
 * `disagreed` 만은 결정적(중복 없이)이어야 한다.
 *
 * `h` 를 두 번 넣고 **둘 다** 자체 모순(`w+l+t≠games`)이 되게 한다 — dedup 이 없으면
 * `disagreed` 에 `"h"` 가 두 번 들어간다.
 *
 * ⚠**이 시험은 「정상 시즌에서의 중복」을 재지 않는다**(2026-08-19 4차 재리뷰 Minor 2로 명시).
 * `h` 를 13번째 엔트리로 밀어넣어 총 13팀이 되므로 `deriveSeriesLengths` 가
 * `teams.length !== 12` 에서 **즉시 `null`** 을 낸다 — 즉 이 픽스처는 유도가 애초에 실패하는
 * 가지(`derived === null`)에서만 dedup 을 잰다. 술어 자체(`isRecordSane`)는 유도 성공 여부와
 * 무관하게 항상 도므로 dedup 이 정상 시즌에서도 똑같이 동작하지만, **이 시험만으로는 그걸
 * 증명하지 않는다.**
 *
 * ⚠**뮤테이션**: `Set` 경유 dedup 을 지우고 배열에 그대로 push 하면 `hCount` 가 2 가 되어 떨어진다.
 */
test("⚠팀코드가 중복 입력되면 disagreed 가 dedup 된다(3차 재리뷰 Minor m1)", () => {
  const pp = MID();
  const base = teams(pp, { h: { w: 1, l: 1, t: 0, games: 5 } }); // 1+1+0=2≠5 자체 모순
  const dupH: TeamRaceInput = { teamCode: "h", w: 2, l: 2, t: 0, games: 9 }; // 2+2+0=4≠9 자체 모순
  const withDup = [...base, dupH];
  const r = seasonRace({ season: 2026, teams: withDup, leagueOf, playedPairs: pp });
  const hCount = r.disagreed.filter((c) => c === "h").length;
  assert.equal(hCount, 1, "중복 팀코드가 disagreed 에 중복으로 들어갔다 — dedup 이 안 됐다");
});

/**
 * ⚠**2020(120경기 · 교류전 0)에서도 잔여·매직이 옳아야 한다**(3차 재리뷰 Minor m2).
 * `deriveSeriesLengths` 단위 시험은 2020 을 재지만, `seasonRace` 종단(잔여·Σ 검사·매직)이
 * `total = regularSeasonGames(2020) = 120` 에 실제로 의존하는 것을 재는 시험이 없었다.
 *
 * ⚠**뮤테이션 주석 정정(2026-08-19 4차 재리뷰 Minor 1)**: 아래 문장은 틀렸었다.
 * 「`total` 을 143 으로 고정하면 유도 자체가 실패해 `series` 가 `null` 이 되어
 * `assert.deepEqual(r.series, ...)` 에서 떨어진다」— **아니다.** `seasonRace` 내부의 `const total`
 * 을 143 으로 고정해도 `deriveSeriesLengths` 는 `o.season` 을 **따로** 받아 `regularSeasonGames`
 * 를 별도로 부르므로 영향받지 않고 `series` 는 `{ intra: 24, inter: 0 }` 그대로다.
 * **실제로 떨어지는 자리는 그 앞줄 `assert.equal(r.basis, "confirmed")` 다** — 잘못된 `total`(143)
 * 이 Σ 검사(`sum !== total − games`)에 쓰여 `20 ≠ 43`(143−100) 으로 전 팀이 `disagreed` 가 되고,
 * `confirmed` 가 거짓이 되어 `basis` 가 `"unknown"` 으로 떨어진다. 시험이 이 뮤테이션을 잡는다는
 * 결론 자체는 옳다 — 틀린 것은 인과(어느 단언이 · 왜 떨어지는가)뿐이었다.
 */
test("⚠2020(120경기 · 교류전 0)에서도 잔여·매직이 옳다(3차 재리뷰 Minor m2)", () => {
  const pp = pairs(20, 0); // 리그내 24전 중 20전 소화 · 교류전 0(2020 은 애초에 0)
  const over: Record<string, Over> = { g: { w: 70, l: 30, t: 0, games: 100 } }; // 압도적 1위
  const r = seasonRace({ season: 2020, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "confirmed");
  assert.deepEqual(r.series, { intra: 24, inter: 0 }, "2020 은 교류전이 없다");
  assert.equal(r.teams.get("g")!.remaining, 20, "120경기 규정을 143 기준으로 계산했다");
  let sum = 0;
  for (const v of r.teams.get("g")!.h2hLeft.values()) sum += v;
  assert.equal(sum, 20, "Σ h2hLeft 가 120경기 기준 잔여와 다르다");
  assert.equal(r.teams.get("g")!.selfPossible, true);
  assert.equal(r.teams.get("g")!.eliminated, false);
  assert.equal(r.teams.get("g")!.magic, 1, "매직이 120경기 기준으로 옳게 나오지 않았다");
});

// ─── 4차 재리뷰 수정(형제 구멍) ──────────────────────────────────────────────

/**
 * ⚠**형제 구멍 — `games > total` 이 유도 실패 가지에서 안 잡혔다**(2026-08-19 4차 재리뷰 본체).
 * `disagreed` 자체 검사가 `w+l+t===games` 하나뿐이던 판은 「Σ 검사(대전표 대조)가 이미 잡으니
 * 중복」이라는 이유로 `games>total` 을 따로 안 봤다 — 하지만 그 논증은 `derived !== null`
 * (Σ 검사가 도는 경로)에서만 참이다. 교류전이 안 끝나 `derived === null` 이면 Σ 검사 자체가
 * 안 돌아서, 그 가지에서는 `games>total` 인 자체 모순이 아닌 어긋난 입력이
 * **「아직 유도할 수 없다(정상)」와 완전히 같은 모양**(`disagreed: []`)으로 새 나갔다 —
 * `remaining: null` 로만 드러났다(재리뷰 지적 그대로 재현).
 *
 * `playedPairs = pairs(10, 1)`(교류전 미완 → 유도 실패) · `g = {w:80, l:65, t:3, games:148}`
 * (`w+l+t === games` 라 옛 검사로는 자체 모순이 아니었다. `148 > 143` 만 어긋난다).
 *
 * ⚠**뮤테이션**: `isRecordSane` 대신 다시 `x.w + x.l + x.t === x.games` 만 보게 되돌리면
 * 이 시험이 떨어진다(`disagreed` 가 `["g"]` 대신 `[]` 로 돌아간다) — 직접 확인했다.
 */
test("⚠유도 실패 가지에서도 games>total 어긋남이 disagreed 에 잡힌다(4차 재리뷰 형제 구멍)", () => {
  const pp = pairs(10, 1); // 교류전 미완 → 유도 실패(derived === null)
  const over: Record<string, Over> = { g: { w: 80, l: 65, t: 3, games: 148 } }; // 148 > total(143)
  const r = seasonRace({ season: 2026, teams: teams(pp, over), leagueOf, playedPairs: pp });
  assert.equal(r.basis, "unknown");
  assert.equal(r.series, null, "교류전 미완인데 유도됐다 — 유도는 여전히 실패해야 한다");
  assert.deepEqual(r.disagreed, ["g"], "games>total 인 팀이 disagreed 에 안 잡혔다 — 형제 구멍이 남아 있다");
  assert.equal(r.teams.get("g")!.remaining, null, "믿을 수 없다고 판정한 입력으로 잔여를 냈다");
  // ⚠`deepEqual(r.disagreed, ["g"])` 가 이미 「g 하나만」을 못 박는다 — 「전 팀 오염」으로 눌러
  // 통과하는 것과 「아무도 안 잡힘」으로 눌러 통과하는 것을 둘 다 막는다.
  assert.equal(r.teams.get("t")!.remaining, 143 - 56, "어긋나지 않은 팀의 잔여까지 버렸다");
});
