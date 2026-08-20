# 최애 구단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최애 구단을 지정하면 내비 첫 탭이 그 구단이 되고, 구단 페이지가 「지금 이 팀」을 한눈에 보여주며 다른 화면으로 바로 이동하게 한다.

**Architecture:** 우승 경쟁 계산을 `aggregate/src/race.ts` **한 벌**로 두고 구단 페이지와 순위 화면이 같은 함수를 쓴다(M1). 직접대결 잔여는 **규칙에서 유도**하고(예정 일정을 쓰지 않는다), 유도가 확정되지 않으면 판정하지 않는다(M11). 최애는 클라이언트 상태이고 서버는 항상 `球団` 항목을 그린다(§0-1).

**Tech Stack:** Node 24 네이티브 TypeScript(빌드 없음 · `.ts` 확장자 import) · `node:test` + `node:assert/strict` · `node:sqlite` · 태그드 템플릿 HTML(`html`/`raw`)

## Global Constraints

- **M1** 지표·판정식은 한 벌. 화면마다 다시 쓰지 않는다.
- **M2** 분모 없는 비율을 렌더링하지 않는다. 승률에는 `(勝+敗)`를 붙인다.
- **M3** 자격·판정 기준을 화면에 적고 시험으로 고정한다.
- **M11** `0`·결측·미수집을 구별한다. 모르는 것을 아는 척하지 않는다.
- **M12** 빈 상태는 로딩/데이터없음/수집실패/시즌외 4상태로 가른다. 구획을 통째로 지우지 않는다.
- **M6** `new Date()`/`Date.now()` 직접 호출 금지. 시계는 주입받는다.
- **§0-1** 스크립트가 없어도 화면이 성립한다.
- **§6** 구단 로고·엠블럼·선수 사진을 쓰지 않는다. 색만 쓴다.
- **작업규칙 9** 새 시험은 **고치기 전 코드에서 실패하는지** 확인한 뒤 채택한다.
- 표시 언어: 제품 UI는 **일본어**, 코드 주석은 한국어.
- 시험 실행: `npm test` (= `node --test "packages/*/test/*.test.ts" "scripts/test/*.test.ts"`)
- 타입 검사: `npm run typecheck`
- 빌드: `npm run build:web`
- ⚠**`packages/web/src/assets.ts` 는 통째로 템플릿 리터럴이다.** 그 안의 주석·코드에 **역따옴표와 `\d` 같은 이스케이프를 쓰지 마라** — 조용히 깨지거나 문자가 사라진다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/aggregate/src/race.ts` **(신규)** | 규정 대전수 유도 · 자력/매직/소멸 판정. **순수 함수 + DB 조회 함수 분리** |
| `packages/aggregate/test/race.test.ts` **(신규)** | 위의 단위 시험 |
| `packages/aggregate/test/race-seasons.test.ts` **(신규)** | 완결 7시즌 실데이터 대조 |
| `packages/aggregate/src/index.ts` | 새 export 추가 |
| `packages/web/src/team-page.ts` | `b-tnow` 요약 띠 · 연속기록/기록근접 구획 · 이동 버튼 |
| `packages/web/src/teams-page.ts` **(신규)** | 구단 목록 화면 |
| `packages/web/src/layout.ts` | 내비 첫 항목 `球団` |
| `packages/web/src/pages.ts` | 一覧의 구단별 앵커 `id="hi-<코드>"` |
| `packages/web/src/standings-page.ts` 또는 순위표를 그리는 곳 | 순위표 행 앵커 `id="stand-<코드>"` |
| `packages/web/src/query.ts` | `TeamPageData` 확장 · `TeamsPageData` 생성 |
| `packages/web/src/site.ts` | `teams.html` 출력 · `seasonPaths` 등록 |
| `packages/web/src/assets.ts` | `favTeam` 상태 · 내비 교체 · 지정 버튼 |

---

### Task 1: 규정 대전수 유도 (`race.ts` 순수부)

**Files:**
- Create: `packages/aggregate/src/race.ts`
- Test: `packages/aggregate/test/race.test.ts`

**Interfaces:**
- Consumes: `regularSeasonGames(season: number): number` from `@bb-app/domain`
- Produces:
  - `pairKey(a: string, b: string): string` — 사전순 `"a|b"`
  - `interface SeriesLengths { intra: number; inter: number }`
  - `deriveSeriesLengths(o: { season: number; teams: readonly string[]; leagueOf: (c: string) => string; playedPairs: ReadonlyMap<string, number> }): SeriesLengths | null`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/aggregate/test/race.test.ts` 를 만든다:

```ts
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
```

- [ ] **Step 2: 시험이 실패하는지 확인한다**

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: FAIL — `Cannot find module '../src/race.ts'`

- [ ] **Step 3: 최소 구현을 쓴다**

`packages/aggregate/src/race.ts` 를 만든다:

```ts
/**
 * **우승 경쟁** — 자력우승·매직 넘버·소멸 판정.
 *
 * ⚠**한 벌이다**(M1). 구단 페이지의 요약 띠와 순위 화면이 **같은 함수**를 부른다.
 * 이 저장소는 「같은 값이 화면마다 다르다」를 여러 번 밟았다 — 2026-08-18 감사에서만
 * 규정 판정이 그 형태로 두 번 나왔다(순위표는 「打率21位」, 그 선수 페이지는 「順位がつきません」).
 *
 * ⚠**직접대결 잔여를 예정 일정에서 세지 않는다.** 공표된 일정은 `치름 + 중지 + 미실시` 라
 * 中止 재편성 상태에 따라 실제 잔여와 어긋난다(실측 2026-08-18: 中日 +3 · 阪神 +1 · 広島 −1).
 * 대신 **규칙**에서 낸다 — NPB 는 대전 수가 고정이고, 실측(아카이브 전수)으로
 * 완결 7시즌 리그내 30쌍 전부 25 · 교류전 36쌍 전부 3, 2020 은 24 / 0 이었다(예외 0건).
 *
 * ```
 * 직접대결 잔여(A,B) = 규정 대전수(A,B) − 이미 치른 A:B 경기 수
 * ```
 *
 * 덤으로 `Σ_B 잔여(A,B) = regularSeasonGames − 소화` 가 **자동으로 성립**한다.
 */
import { regularSeasonGames } from "@bb-app/domain";

/** 대전 쌍의 키. ⚠**사전순으로 고정한다** — 순서를 안 맞추면 같은 쌍이 두 키가 되어 수가 반토막 난다 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface SeriesLengths {
  /** 같은 리그끼리의 대전 수 */
  intra: number;
  /** 교류전 대전 수 */
  inter: number;
}

/**
 * 그 시즌의 규정 대전 수를 **유도한다**. 하드코딩하지 않는다 — 2020 이 그 이유다.
 *
 * ```
 * 교류전 = 교류전 쌍의 최대 관측값
 * 리그내 = (regularSeasonGames − 교류전 × 6) / 5
 * ```
 *
 * ⚠**양의 정수가 아니면 `null` 이다.** 교류전이 진행 중인 5~6월에는 관측값이 1~2 라
 * `(143 − 6) / 5 = 27.4` 처럼 정수가 안 나온다 — 그게 **「아직 모른다」의 신호**가 된다.
 * 143 시즌에서 정수가 나오는 것은 교류전이 3 일 때뿐이고, 120 시즌에서는 0 일 때뿐이다.
 * **검산이 공짜로 붙는다.**
 * ⚠**유도한 상수를 이미 넘긴 쌍이 있으면 유도가 틀린 것**이므로 역시 `null` 이다.
 */
export function deriveSeriesLengths(o: {
  season: number;
  teams: readonly string[];
  leagueOf: (code: string) => string;
  playedPairs: ReadonlyMap<string, number>;
}): SeriesLengths | null {
  if (o.teams.length !== 12) return null;
  const byLeague = new Map<string, number>();
  for (const c of o.teams) byLeague.set(o.leagueOf(c), (byLeague.get(o.leagueOf(c)) ?? 0) + 1);
  if (byLeague.size !== 2 || [...byLeague.values()].some((n) => n !== 6)) return null;

  let maxIntra = 0;
  let maxInter = 0;
  for (let i = 0; i < o.teams.length; i += 1) {
    for (let j = i + 1; j < o.teams.length; j += 1) {
      const a = o.teams[i]!;
      const b = o.teams[j]!;
      const n = o.playedPairs.get(pairKey(a, b)) ?? 0;
      if (o.leagueOf(a) === o.leagueOf(b)) maxIntra = Math.max(maxIntra, n);
      else maxInter = Math.max(maxInter, n);
    }
  }

  const inter = maxInter;
  const intra = (regularSeasonGames(o.season) - inter * 6) / 5;
  if (!Number.isInteger(intra) || intra <= 0) return null;
  if (maxIntra > intra) return null;
  return { intra, inter };
}
```

- [ ] **Step 4: 시험이 통과하는지 확인한다**

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: PASS 6/6

Run: `npm run typecheck`
Expected: 출력 없음(오류 없음)

- [ ] **Step 5: 뮤테이션 검사 — 시험이 진짜로 재는지 확인한다**

`race.ts` 의 `if (!Number.isInteger(intra) || intra <= 0) return null;` 을 `if (intra <= 0) return null;` 로 바꾼다.

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: FAIL — 「교류전이 끝나기 전에는 유도하지 않는다」가 떨어진다

원래대로 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add packages/aggregate/src/race.ts packages/aggregate/test/race.test.ts
git commit -m "feat(aggregate): 규정 대전수를 시즌마다 유도한다 — 2020 이 하드코딩을 금지한다"
```

---

### Task 2: 자력·소멸·매직 판정 (`race.ts` 판정부)

**Files:**
- Modify: `packages/aggregate/src/race.ts`
- Test: `packages/aggregate/test/race.test.ts`

**Interfaces:**
- Consumes: `deriveSeriesLengths`, `pairKey` (Task 1)
- Produces:
  - `interface TeamRaceInput { teamCode: string; w: number; l: number; t: number; games: number }`
  - `interface TeamRace { teamCode: string; remaining: number; h2hLeft: Map<string, number>; selfPossible: boolean | null; magic: number | null; eliminated: boolean | null }`
  - `interface SeasonRace { basis: "confirmed" | "unknown"; series: SeriesLengths | null; teams: Map<string, TeamRace> }`
  - `seasonRace(o: { season: number; teams: readonly TeamRaceInput[]; leagueOf: (c: string) => string; playedPairs: ReadonlyMap<string, number> }): SeasonRace`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/aggregate/test/race.test.ts` 끝에 덧붙인다:

```ts
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
  const r = seasonRace({ season: 2026, teams: teams(), leagueOf, playedPairs: pairs(20, 3) });
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
```

- [ ] **Step 2: 시험이 실패하는지 확인한다**

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: FAIL — `seasonRace` 를 못 찾는다

- [ ] **Step 3: 구현을 쓴다**

`packages/aggregate/src/race.ts` 끝에 덧붙인다:

```ts
export interface TeamRaceInput {
  teamCode: string;
  w: number;
  l: number;
  t: number;
  /** 소화 경기 수 */
  games: number;
}

export interface TeamRace {
  teamCode: string;
  /** 잔여 경기. **규정 경기수 − 소화** — 유도가 안 돼도 이건 안다 */
  remaining: number;
  /** 상대별 잔여. 유도가 안 되면 빈 지도 */
  h2hLeft: Map<string, number>;
  /** 자력우승 가능. 판정 불가면 `null`(M11) */
  selfPossible: boolean | null;
  /** 매직 넘버. **점등 조건을 못 채우면 `null`** */
  magic: number | null;
  /** 우승 가능성 소멸. 판정 불가면 `null` */
  eliminated: boolean | null;
}

export interface SeasonRace {
  /** `confirmed` 면 판정이 서 있다. `unknown` 이면 규정 대전수를 아직 모른다 */
  basis: "confirmed" | "unknown";
  series: SeriesLengths | null;
  teams: Map<string, TeamRace>;
}

/**
 * 勝率. ⚠**분모는 `勝 + 敗`** 다 — NPB 는 무승부를 뺀다.
 * 결정된 경기가 없으면 `null`(M11) — 0 으로 두면 「전패」로 읽힌다.
 */
function pct(w: number, l: number): number | null {
  return w + l === 0 ? null : w / (w + l);
}

/**
 * 우승 경쟁을 판정한다.
 *
 * ⚠**승률로 판정하고 매직만 승수식을 쓴다.** NPB 순위는 승률(`勝/(勝+敗)`)로 정하는데
 * 매직 넘버는 관례가 승수식이다. 그 차이를 **화면이 말해야 한다**(M3).
 */
export function seasonRace(o: {
  season: number;
  teams: readonly TeamRaceInput[];
  leagueOf: (code: string) => string;
  playedPairs: ReadonlyMap<string, number>;
}): SeasonRace {
  const total = regularSeasonGames(o.season);
  const codes = o.teams.map((x) => x.teamCode);
  const series = deriveSeriesLengths({
    season: o.season,
    teams: codes,
    leagueOf: o.leagueOf,
    playedPairs: o.playedPairs,
  });

  const byCode = new Map(o.teams.map((x) => [x.teamCode, x]));
  const out = new Map<string, TeamRace>();

  /** 그 팀이 잔여를 전승했을 때의 최종 승률 */
  const bestPct = (x: TeamRaceInput): number | null => pct(x.w + (total - x.games), x.l);
  /** 그 팀이 잔여를 전패했을 때의 최종 승률 */
  const worstPct = (x: TeamRaceInput): number | null => pct(x.w, x.l + (total - x.games));

  for (const me of o.teams) {
    const remaining = total - me.games;
    const h2hLeft = new Map<string, number>();
    if (series !== null) {
      for (const other of codes) {
        if (other === me.teamCode) continue;
        const full = o.leagueOf(other) === o.leagueOf(me.teamCode) ? series.intra : series.inter;
        h2hLeft.set(other, full - (o.playedPairs.get(pairKey(me.teamCode, other)) ?? 0));
      }
    }

    let selfPossible: boolean | null = null;
    let eliminated: boolean | null = null;
    const mine = bestPct(me);

    if (series !== null && mine !== null) {
      selfPossible = true;
      eliminated = false;
      for (const other of codes) {
        if (other === me.teamCode) continue;
        const b = byCode.get(other)!;
        const h = h2hLeft.get(other) ?? 0;
        /**
         * ⚠**내가 전승하면 상대는 나와의 잔여를 전패한다.** 그걸 빼지 않으면
         * 상대의 최대 승수를 실제보다 크게 잡아 자력을 과소평가한다.
         */
        const bMaxWins = b.w + (total - b.games) - h;
        const bBest = pct(bMaxWins, b.l + h);
        if (bBest !== null && bBest > mine) selfPossible = false;
        // 상대가 **전패해도** 내 최선을 넘으면 소멸이다
        const bWorst = worstPct(b);
        if (bWorst !== null && bWorst > mine) eliminated = true;
      }
    }

    out.set(me.teamCode, { teamCode: me.teamCode, remaining, h2hLeft, selfPossible, magic: null, eliminated });
  }

  /**
   * 매직 넘버.
   *
   * ⚠**점등 조건은 「다른 모든 팀의 자력우승 소멸」이다.** 그것이 매직의 정의다 —
   * 조건을 안 지킨 수를 「マジック」라고 부르면 그건 다른 것이고, 이 저장소는
   * 자체 지표에 공식과 다른 이름을 쓰기로 이미 정해 뒀다(SRC·SRP).
   */
  if (series !== null) {
    for (const me of o.teams) {
      const others = codes.filter((c) => c !== me.teamCode);
      const allGone = others.every((c) => out.get(c)!.selfPossible === false);
      if (!allGone) continue;
      let magic = 0;
      for (const c of others) {
        const b = byCode.get(c)!;
        magic = Math.max(magic, b.w + (total - b.games) - me.w + 1);
      }
      out.get(me.teamCode)!.magic = Math.max(0, magic);
    }
  }

  return { basis: series === null ? "unknown" : "confirmed", series, teams: out };
}
```

- [ ] **Step 4: 시험이 통과하는지 확인한다**

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: PASS 14/14

Run: `npm run typecheck`
Expected: 오류 없음

- [ ] **Step 5: 뮤테이션 검사**

`seasonRace` 의 `const bMaxWins = b.w + (total - b.games) - h;` 에서 `- h` 를 지운다.

Run: `node --test packages/aggregate/test/race.test.ts`
Expected: FAIL — 「압도적 1위는 자력우승 가능이다」가 떨어질 수 있다. 떨어지지 않으면 **그 시험이 이 줄을 안 재는 것**이므로, 직접대결이 판정을 뒤집는 픽스처를 추가하라.

원래대로 되돌린다.

- [ ] **Step 6: `index.ts` 에 export 를 더한다**

`packages/aggregate/src/index.ts` 의 `from "./leaderboard.ts";` 블록 **다음 줄**에 추가:

```ts
export { deriveSeriesLengths, pairKey, seasonRace } from "./race.ts";
export type { SeasonRace, SeriesLengths, TeamRace, TeamRaceInput } from "./race.ts";
```

Run: `npm run typecheck`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add packages/aggregate/src/race.ts packages/aggregate/src/index.ts packages/aggregate/test/race.test.ts
git commit -m "feat(aggregate): 자력우승·매직·소멸 판정 — 점등 조건을 지킨다"
```

---

### Task 3: 완결 7시즌 실데이터 대조

**Files:**
- Create: `packages/aggregate/test/race-seasons.test.ts`

**Interfaces:**
- Consumes: `seasonRace`, `pairKey` (Task 2)
- Produces: 없음(시험 전용)

이것이 이 계산의 **진짜 검산**이다. 픽스처는 내가 만든 세계이지만 완결 시즌은 사실이다.

- [ ] **Step 1: 시험을 쓴다**

```ts
/**
 * **완결 시즌으로 검산한다.**
 *
 * ⚠픽스처는 내가 만든 세계라 내 오해가 그대로 통과한다. 완결 시즌은 사실이다 —
 * 시즌 마지막 시점에 **최종 1위는 우승이 확정**돼 있어야 하고, 나머지는 **전부 소멸**이어야 한다.
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seasonRace, pairKey } from "../src/race.ts";
import type { TeamRaceInput } from "../src/race.ts";
import { TEAMS, leagueOf } from "@bb-app/domain";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
if (process.env["BB_REQUIRE_DB"] === "1" && !existsSync(DB)) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

test("⚠완결 시즌: 최종 1위는 우승 확정 · 나머지는 전부 소멸", {
  skip: existsSync(DB) ? false : "data/bb.sqlite 없음",
}, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const seasons = (db
      .prepare(
        `SELECT season FROM game WHERE status='played' AND competition='regular'
         GROUP BY season HAVING COUNT(*) >= 700 ORDER BY season`,
      )
      .all() as { season: number }[]).map((r) => r.season);
    assert.ok(seasons.length >= 5, `완결 시즌이 ${seasons.length}개뿐이다 — 이 시험이 공회전한다`);

    for (const season of seasons) {
      const rows = db
        .prepare(
          `SELECT code, SUM(w) w, SUM(l) l, SUM(t) t, SUM(w+l+t) games FROM (
             SELECT away_code AS code,
                    SUM(CASE WHEN away_runs>home_runs THEN 1 ELSE 0 END) w,
                    SUM(CASE WHEN away_runs<home_runs THEN 1 ELSE 0 END) l,
                    SUM(CASE WHEN away_runs=home_runs THEN 1 ELSE 0 END) t
               FROM game WHERE season=? AND status='played' AND competition='regular'
                 AND away_runs IS NOT NULL AND home_runs IS NOT NULL GROUP BY away_code
             UNION ALL
             SELECT home_code,
                    SUM(CASE WHEN home_runs>away_runs THEN 1 ELSE 0 END),
                    SUM(CASE WHEN home_runs<away_runs THEN 1 ELSE 0 END),
                    SUM(CASE WHEN home_runs=away_runs THEN 1 ELSE 0 END)
               FROM game WHERE season=? AND status='played' AND competition='regular'
                 AND away_runs IS NOT NULL AND home_runs IS NOT NULL GROUP BY home_code
           ) GROUP BY code`,
        )
        .all(season, season) as { code: string; w: number; l: number; t: number; games: number }[];

      const pairs = new Map<string, number>();
      for (const r of db
        .prepare(
          `SELECT away_code a, home_code h, COUNT(*) n FROM game
            WHERE season=? AND status='played' AND competition='regular' GROUP BY a,h`,
        )
        .all(season) as { a: string; h: string; n: number }[]) {
        const k = pairKey(r.a, r.h);
        pairs.set(k, (pairs.get(k) ?? 0) + r.n);
      }

      const teams: TeamRaceInput[] = rows.map((r) => ({
        teamCode: r.code, w: r.w, l: r.l, t: r.t, games: r.games,
      }));
      const race = seasonRace({ season, teams, leagueOf, playedPairs: pairs });
      assert.equal(race.basis, "confirmed", `${season}: 완결 시즌인데 유도가 안 됐다`);

      for (const league of ["central", "pacific"]) {
        const inLeague = teams.filter((x) => leagueOf(x.teamCode) === league);
        const champion = inLeague
          .slice()
          .sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0]!;
        for (const x of inLeague) {
          const r = race.teams.get(x.teamCode)!;
          assert.equal(r.remaining, 0, `${season} ${x.teamCode}: 완결인데 잔여가 ${r.remaining}`);
          if (x.teamCode === champion.teamCode) {
            assert.equal(r.eliminated, false, `${season} ${league}: 우승팀이 소멸로 판정됐다`);
            assert.equal(r.selfPossible, true, `${season} ${league}: 우승팀의 자력이 없다고 판정됐다`);
          } else {
            assert.equal(r.eliminated, true, `${season} ${league} ${x.teamCode}: 끝났는데 소멸이 아니다`);
          }
        }
      }
    }
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: 시험을 돌린다**

Run: `node --test packages/aggregate/test/race-seasons.test.ts`
Expected: PASS 1/1

⚠**떨어지면 계산이 틀린 것이다.** 어느 시즌·어느 팀인지 메시지에 나온다. 동률 우승이 있으면
`champion` 뽑는 방식을 「최고 승률과 같은 승률」 집합으로 넓혀라 — 그건 시험의 결함이지 계산의 결함이 아니다.

- [ ] **Step 3: 커밋**

```bash
git add packages/aggregate/test/race-seasons.test.ts
git commit -m "test(aggregate): 완결 7시즌으로 우승 경쟁 판정을 검산한다"
```

---

### Task 4: 이동 대상 앵커 만들기

**Files:**
- Modify: `packages/web/src/pages.ts` (一覧의 구단 구획)
- Modify: 순위표를 그리는 곳 — `grep -n 'hstand' packages/web/src/*.ts` 로 찾는다
- Test: `packages/web/test/link-check.test.ts` 는 이미 있다. 앵커 실재는 **빌드의 링크 검사**가 본다

**Interfaces:**
- Produces: `players.html#hi-<코드>` · `ranking.html#stand-<코드>` 앵커

- [ ] **Step 1: 一覧의 구단 구획에 id 를 붙인다**

`packages/web/src/pages.ts` 에서 구단별 `<h2>…人</h2>` 를 내는 구획을 찾는다:

Run: `grep -n '人</h2>\|shortName}.*人' packages/web/src/pages.ts`

그 구획을 감싸는 요소에 `id="hi-${팀코드}"` 를 더한다. 예:

```ts
<section class="block" id="hi-${t.teamCode}">
```

⚠**id 를 문자열로 짓지 마라** — 팀 코드는 우리가 만든 값이지만, `safeSegment` 처럼
형태를 검사하는 한 벌을 쓰는 것이 이 저장소의 관례다.

- [ ] **Step 2: 순위표 행에 id 를 붙인다**

Run: `grep -rn 'hstand' packages/web/src/*.ts | head -5`

순위표의 `<tr>` 에 `id="stand-${r.teamCode}"` 를 더한다.

- [ ] **Step 3: 빌드해서 앵커가 생겼는지 확인한다**

Run: `npm run build:web`
Expected: `링크: … 깨진 것 없음`

Run: `grep -c 'id="hi-' dist/players.html`
Expected: `12`

Run: `grep -c 'id="stand-' dist/ranking.html`
Expected: `12`

- [ ] **Step 4: 커밋**

```bash
git add packages/web/src/pages.ts packages/web/src/standings-page.ts
git commit -m "feat(web): 一覧·順位에 구단별 앵커를 둔다 — 구단 페이지에서 바로 온다"
```

---

### Task 5: 구단 페이지 「지금 이 팀」 요약 띠

**Files:**
- Modify: `packages/web/src/team-page.ts`
- Modify: `packages/web/src/query.ts` (`TeamPageData` 확장 · `teamPages` 에서 채우기)
- Test: `packages/web/test/team-page.test.ts`

**Interfaces:**
- Consumes: `TeamRace` (Task 2) · `TeamPageData` 의 기존 필드
- Produces: `TeamPageData.now: TeamNow`

```ts
export interface TeamNow {
  race: TeamRace;
  /** 다음 경기. 없으면 null(시즌 종료·경기 없음) */
  next: { date: string; opponentCode: string; opponentName: string; home: boolean; venue: string | null; startTime: string | null } | null;
  /** 그 경기의 予告先発. 아직 없으면 null — 「発表待ち」다 */
  probable: { mine: string | null; theirs: string | null } | null;
}
```

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/web/test/team-page.test.ts` 끝에 덧붙인다:

```ts
/**
 * ⚠**팬이 가장 먼저 보는 줄이다.** 순위·게임차·잔여·다음 경기가 한 줄에 있어야
 * 「지금 우리 팀이 어떤가」에 답한다.
 * ⚠**모든 비율에 분모를 붙인다**(M2) — 승률에는 `(勝+敗)`.
 */
test("⚠구단 페이지 맨 위에 「지금 이 팀」이 온다 — 분모를 달고", () => {
  const out = renderTeamPage(data(), context());
  const now = out.indexOf('id="b-tnow"');
  const stat = out.indexOf('id="b-tstat"');
  assert.ok(now >= 0, "「지금 이 팀」 구획이 없다");
  assert.ok(stat === -1 || now < stat, "「지금 이 팀」이 チーム成績보다 뒤에 있다");
  assert.match(out, /\.558|\.562|勝率/, "승률이 안 나온다");
  assert.match(out, /残り\s*\d+\s*試合/, "잔여 경기가 안 나온다");
});

/** ⚠**판정 불가를 숨기지 않는다**(M11·M12). 왜 못 정하는지도 쓴다 */
test("⚠우승 경쟁을 판정할 수 없으면 그렇게 말한다", () => {
  const out = renderTeamPage(
    data({ now: { ...nowFixture(), race: { ...nowFixture().race, selfPossible: null, magic: null, eliminated: null } } }),
    context(),
  );
  assert.match(out, /まだ判定できません/);
});

/** ⚠**予告先発이 없으면 「投手なし」가 아니라 「発表待ち」다**(M11) */
test("⚠予告先発이 아직 없으면 発表待ち라고 쓴다", () => {
  const out = renderTeamPage(data({ now: { ...nowFixture(), probable: null } }), context());
  assert.match(out, /発表待ち/);
  assert.ok(!out.includes("投手なし"));
});

/** ⚠**다음 경기가 없어도 줄을 지우지 않는다**(M12) */
test("⚠다음 경기가 없으면 그렇다고 말한다 — 줄을 지우지 않는다", () => {
  const out = renderTeamPage(data({ now: { ...nowFixture(), next: null, probable: null } }), context());
  assert.match(out, /次の試合/);
  assert.match(out, /予定はありません|シーズンは終了/);
});

test("이동 버튼이 네 화면을 가리킨다", () => {
  const out = renderTeamPage(data(), context());
  for (const href of ["starters.html", "ranking.html#stand-t", "players.html#hi-t"]) {
    assert.ok(out.includes(href), `${href} 로 가는 길이 없다`);
  }
});
```

그리고 파일 위쪽 `data()` 옆에 픽스처를 더한다:

```ts
function nowFixture(): TeamNow {
  return {
    race: {
      teamCode: "t",
      remaining: 37,
      h2hLeft: new Map([["g", 8]]),
      selfPossible: true,
      magic: null,
      eliminated: false,
    },
    next: {
      date: "2026-08-18", opponentCode: "c", opponentName: "広島",
      home: true, venue: "甲子園", startTime: "18:00",
    },
    probable: { mine: "村上", theirs: "大瀬良" },
  };
}
```

`data()` 의 반환에 `now: nowFixture(),` 를 더하고, `import type { TeamNow } from "../src/team-page.ts";` 를 더한다.

- [ ] **Step 2: 시험이 실패하는지 확인한다**

Run: `node --test packages/web/test/team-page.test.ts`
Expected: FAIL — `TeamNow` 를 못 찾는다

- [ ] **Step 3: 타입과 렌더를 쓴다**

`packages/web/src/team-page.ts` 에 `TeamNow` 를 export 하고 `TeamPageData` 에 `now: TeamNow` 를 더한 뒤, `renderTeamPage` 의 본문 **맨 앞** 구획으로 아래를 넣는다:

```ts
/**
 * 「지금 이 팀」.
 *
 * ⚠**이 화면에 오는 사람이 가장 먼저 묻는 것**이 여기 있어야 한다 —
 * 지금 몇 위인가, 얼마나 남았는가, 다음은 누구인가.
 * ⚠**모든 비율에 분모를 붙인다**(M2).
 */
function nowBlock(d: TeamPageData, base: string): RawHtml {
  const n = d.now;
  const raceText =
    n.race.selfPossible === null
      ? "まだ判定できません（今季の対戦数が確定していません）"
      : n.race.magic !== null
        ? `マジック ${n.race.magic}`
        : n.race.eliminated === true
          ? "優勝の可能性なし"
          : n.race.selfPossible
            ? "自力優勝の可能性あり"
            : "自力優勝消滅";
  return block("b-tnow", "いまの状況", html`
  <p class="tnow">
    <b>${d.rank === null ? "—" : `${d.tiedRank ? "同" : ""}${d.rank}位`}</b>
    <span>${wlt({ w: d.w, l: d.l, t: d.t })}</span>
    <span>${valueWithDen({ value: d.pct, denominator: d.w + d.l }, "試合", 3)}</span>
    <span>首位と${d.gamesBehind.toFixed(1)}ゲーム差</span>
    <span>残り ${n.race.remaining}試合</span>
  </p>
  <p class="tnow">直近10 ${wlt(d.last10)}</p>
  <p class="tnow">次の試合 ${n.next === null
    ? "予定はありません"
    : html`${fullDate(n.next.date)} ${n.next.startTime ?? ""} ${n.next.home ? "vs" : "@"} ${n.next.opponentName}${n.next.venue === null ? "" : ` ${n.next.venue}`}`}</p>
  <p class="tnow">予告先発 ${n.probable === null || n.probable.mine === null
    ? "発表待ち"
    : html`${n.probable.mine}${n.probable.theirs === null ? "" : ` ─ ${n.probable.theirs}`}`}</p>
  <p class="tnow race">${raceText}</p>
  ${note(
    "順位は**勝率**（勝÷(勝+敗)・引き分けは除く）で決まります。" +
      "マジックナンバーだけは慣例に従い**勝数**で数えます。" +
      "同率のときは規定による決定が残ります。",
  )}
  <p class="tgo">
    <a href="${base}starters.html">予告先発を見る</a>
    <a href="${base}ranking.html#stand-${d.teamCode}">順位表で見る</a>
    <a href="${base}${ROSTER_PATH}#hi-${d.teamCode}">選手一覧</a>
    <a href="#b-tcal">日程</a>
  </p>`);
}
```

⚠`block`·`note`·`valueWithDen`·`fullDate`·`ROSTER_PATH` 는 이 파일이 이미 쓰고 있는 것이다.
없으면 `parts.ts`·`format.ts`·`layout.ts` 에서 import 한다.

`packages/web/src/query.ts` 의 `teamPages` 에서 `now` 를 채운다 — `seasonRace` 를 **한 번만** 부르고(리그별이 아니라 시즌 단위) 팀마다 꺼내 쓴다.

- [ ] **Step 4: 시험이 통과하는지 확인한다**

Run: `node --test packages/web/test/team-page.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add packages/web/src/team-page.ts packages/web/src/query.ts packages/web/test/team-page.test.ts
git commit -m "feat(web): 구단 페이지에 「지금 이 팀」과 이동 버튼을 둔다"
```

---

### Task 6: 이 팀의 연속 기록 · 기록 근접

**Files:**
- Modify: `packages/web/src/team-page.ts`
- Modify: `packages/web/src/query.ts`
- Test: `packages/web/test/team-page.test.ts`

**Interfaces:**
- Consumes: `HomeStreak`·`HomeMilestone` (`packages/web/src/home-page.ts` · 둘 다 `teamCode` 를 갖는다)
- Produces: `TeamPageData.streaks: HomeStreak[]` · `TeamPageData.milestones: HomeMilestone[]`

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
/** ⚠**0건이어도 구획을 지우지 않는다**(M12) — 「없다」와 「고장」이 같은 화면이면 결함이다 */
test("⚠이 팀의 연속 기록이 0건이어도 구획이 남고 없다고 말한다", () => {
  const out = renderTeamPage(data({ streaks: [], milestones: [] }), context());
  assert.ok(out.includes('id="b-tstreak"'), "연속 기록 구획이 사라졌다");
  assert.ok(out.includes('id="b-tmile"'), "기록 근접 구획이 사라졌다");
  assert.match(out, /ありません/);
});

test("이 팀의 연속 기록만 싣는다 — 남의 팀이 섞이지 않는다", () => {
  const out = renderTeamPage(data(), context());
  assert.ok(!out.includes("巨人の選手"), "다른 팀 선수가 섞였다");
});
```

`data()` 에 `streaks: []`, `milestones: []` 기본값을 넣고, 하나짜리 픽스처도 만든다.

- [ ] **Step 2: 실패 확인**

Run: `node --test packages/web/test/team-page.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`query.ts` 의 `teamPages` 에서 홈 화면이 이미 만든 배열을 **팀으로 거른다**:

```ts
streaks: home.streaks.filter((s) => s.teamCode === code),
milestones: home.milestones.filter((m) => m.teamCode === code),
```

⚠**여기서 다시 계산하지 않는다**(M1) — 홈 화면이 쓰는 것과 같은 배열을 거르기만 한다.

`team-page.ts` 에 두 구획을 더한다. 0건이면 `<p class="empty">この球団の…はありません。</p>`.

- [ ] **Step 4: 통과 확인**

Run: `node --test packages/web/test/team-page.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/web/src/team-page.ts packages/web/src/query.ts packages/web/test/team-page.test.ts
git commit -m "feat(web): 구단 페이지에 이 팀의 연속 기록·기록 근접을 싣는다"
```

---

### Task 7: 구단 목록 화면 `teams.html`

**Files:**
- Create: `packages/web/src/teams-page.ts`
- Create: `packages/web/test/teams-page.test.ts`
- Modify: `packages/web/src/query.ts` (`SiteData.teamsPage`)
- Modify: `packages/web/src/site.ts` (출력 · `seasonPaths`)

**Interfaces:**
- Produces: `renderTeamsPage(d: TeamsPageData, ctx: RenderContext): string` · `TEAMS_PATH = "teams.html"`

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTeamsPage } from "../src/teams-page.ts";
import { context } from "./fixtures.ts";

test("12구단이 리그별로 나온다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.equal((out.match(/class="tcard"/g) ?? []).length, 12);
  assert.match(out, /セントラル/);
  assert.match(out, /パシフィック/);
});

/** ⚠**로고를 쓰지 않는다**(§6). 색만 쓴다 */
test("⚠구단 로고·엠블럼을 쓰지 않는다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.ok(!/<img/.test(out), "이미지를 썼다 — 로고는 상표다(§6)");
});

/** ⚠**JS 가 없어도 여기서 구단으로 갈 수 있어야 한다**(§0-1) */
test("⚠각 구단 카드가 그 구단 페이지로 간다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.ok(out.includes('href="teams/t.html"'));
});

test("최애 지정 버튼이 12개 있고 초기값은 눌리지 않은 상태다", () => {
  const out = renderTeamsPage(teamsData(), context());
  const btns = out.match(/data-favteam="[a-z]+"/g) ?? [];
  assert.equal(btns.length, 12);
  assert.equal((out.match(/aria-pressed="false"/g) ?? []).length >= 12, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test packages/web/test/teams-page.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 화면을 만든다**

`packages/web/src/teams-page.ts`:

```ts
/**
 * 구단 목록.
 *
 * ⚠**이 화면이 없어서 내비에 구단이 없었다.** 구단 페이지는 순위표에서 팀명을 눌러야만 닿았고,
 * 팬이 가장 자주 볼 화면으로 가는 길이 가장 멀었다.
 * ⚠**JS 가 없어도 여기서 구단으로 간다**(§0-1). 최애 지정만 스크립트의 일이다.
 * ⚠**로고·엠블럼을 쓰지 않는다**(§6) — 구단 색 마크만 쓴다.
 */
```

카드마다: 순위 · 승패분 · 승률(분모 포함) · 게임차 · 최근10 · 다음 경기 · `<button data-favteam="<코드>" aria-pressed="false">`.

`site.ts` 의 파일 목록에 `{ path: at("teams.html"), content: renderTeamsPage(...) }` 를 더하고 `seasonPaths` 에 `"teams.html"` 을 더한다.

- [ ] **Step 4: 통과 확인 · 빌드**

Run: `node --test packages/web/test/teams-page.test.ts`
Expected: PASS

Run: `npm run build:web`
Expected: `링크: … 깨진 것 없음` · 파일 수가 **+9**

- [ ] **Step 5: 커밋**

```bash
git add packages/web/src/teams-page.ts packages/web/test/teams-page.test.ts packages/web/src/query.ts packages/web/src/site.ts
git commit -m "feat(web): 구단 목록 화면 — 구단으로 가는 길을 만든다"
```

---

### Task 8: 내비 첫 항목 `球団`

**Files:**
- Modify: `packages/web/src/layout.ts:249-263`
- Test: `packages/web/test/layout.test.ts`

**Interfaces:**
- Consumes: `NavKey` 는 이미 `"team"` 을 갖고 있다(추가 불필요)

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
/**
 * ⚠**JS 가 없어도 구단으로 가는 길이 있어야 한다**(§0-1).
 * 최애 라벨 교체는 스크립트의 일이지만, **항목 자체는 서버가 그린다.**
 */
test("⚠내비 첫 항목이 球団이고 구단 목록으로 간다", () => {
  const out = renderSomePage();  // 이 파일의 기존 헬퍼를 쓴다
  const nav = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(out)![0];
  const first = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(nav)!;
  assert.equal(first[2], "球団", `첫 항목이 ${first[2]} 다`);
  assert.match(first[1]!, /teams\.html$/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test packages/web/test/layout.test.ts`
Expected: FAIL — 첫 항목이 `試合` 이다

- [ ] **Step 3: 구현**

`layout.ts` 의 `<nav class="tnav" …>` **바로 다음 줄**에 넣는다:

```ts
    <!-- ⚠**첫 자리다**(2026-08-18 유저 요청). 최애를 지정하면 클라이언트가 라벨과 링크를
         그 구단으로 바꾼다. **서버는 항상 「球団」을 그린다** — JS 가 없어도 구단으로 가는 길이
         있어야 하고(§0-1), 지금까지는 그 길이 아예 없었다(순위표를 거쳐야만 닿았다). -->
    <a href="${o.base}teams.html" data-navteam${here("team")}>球団</a>
```

- [ ] **Step 4: 통과 확인**

Run: `node --test packages/web/test/layout.test.ts`
Expected: PASS

Run: `npm run build:web`
Expected: 깨진 링크 0

- [ ] **Step 5: 커밋**

```bash
git add packages/web/src/layout.ts packages/web/test/layout.test.ts
git commit -m "feat(web): 내비 첫 항목에 球団 — 구단이 내비에 없었다"
```

---

### Task 9: 최애 지정 (클라이언트)

**Files:**
- Modify: `packages/web/src/assets.ts`
- Test: `packages/web/test/client.test.ts`

⚠**`assets.ts` 는 통째로 템플릿 리터럴이다.** 주석과 코드에 **역따옴표를 쓰지 마라.**
정규식 이스케이프(`\d` 등)도 쓰지 마라 — 클라이언트에서 글자로 죽는다.

**Interfaces:**
- Consumes: `state`(기존) · `$$`·`$`(기존 헬퍼)
- Produces: `state.favTeam: string`(빈 문자열이면 미지정)

- [ ] **Step 1: 실패하는 시험을 쓴다**

`packages/web/test/client.test.ts` 끝에 덧붙인다:

```ts
/**
 * ⚠**최애는 하나다.** 「가장 첫탭」이 하나여야 하므로 복수를 두지 않는다.
 * 선수 즐겨찾기(state.favs)는 다른 개념이라 건드리지 않는다.
 */
function withNavAndFav(): ReturnType<typeof makeDocument> {
  const doc = buildPage();
  const nav = make("nav", { class: "tnav" });
  nav.appendChild(make("a", { href: "teams.html", "data-navteam": "" }));
  doc.body.appendChild(nav);
  const btn = make("button", { "data-favteam": "t", "aria-pressed": "false" });
  doc.body.appendChild(btn);
  return doc;
}

test("⚠최애를 지정하면 내비 첫 항목이 그 구단이 된다", () => {
  const doc = withNavAndFav();
  const storage = makeStorage();
  run(doc, { storage });
  doc.querySelectorAll("[data-favteam]")[0]!.fire("click");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.match(a.getAttribute("href") ?? "", /teams\/t\.html$/);
  assert.equal(a.textContent, "阪神");
  assert.equal(doc.querySelectorAll("[data-favteam]")[0]!.getAttribute("aria-pressed"), "true");
});

test("⚠다시 누르면 해제되고 내비가 球団으로 돌아온다", () => {
  const doc = withNavAndFav();
  run(doc, { storage: makeStorage() });
  const btn = doc.querySelectorAll("[data-favteam]")[0]!;
  btn.fire("click");
  btn.fire("click");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.match(a.getAttribute("href") ?? "", /teams\.html$/);
  assert.equal(a.textContent, "球団");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
});

test("최애는 이 브라우저에 남는다 — 다시 열어도 살아 있다", () => {
  const storage = makeStorage();
  const first = withNavAndFav();
  run(first, { storage });
  first.querySelectorAll("[data-favteam]")[0]!.fire("click");
  const second = withNavAndFav();
  run(second, { storage });
  assert.match(second.querySelectorAll("[data-navteam]")[0]!.getAttribute("href") ?? "", /teams\/t\.html$/);
});
```

⚠팀 약칭(`阪神`)이 필요하다. 클라이언트는 구단 마스터를 모르므로 **버튼이 이름을 들고 있어야 한다** —
`data-favname="阪神"` 를 버튼에 붙이고(Task 7 의 화면에서), 클라이언트는 그것을 읽는다.
시험의 `make("button", …)` 에도 `"data-favname": "阪神"` 를 더한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test packages/web/test/client.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`assets.ts` 의 상태 복원부(`favs:` 를 읽는 곳 근처)에 더한다:

```js
  favTeam:typeof saved.favTeam==="string"?saved.favTeam:"",
```

그리고 스크립트 끝부분(다른 `$$(...)` 배선 옆)에:

```js
/* 최애 구단.
   ⚠**하나만 둔다** — 내비의 첫 자리가 하나이기 때문이다. 선수 즐겨찾기와는 다른 개념이라
   state.favs 를 건드리지 않는다.
   ⚠**서버는 항상 球団 을 그린다**(§0-1). 여기서 하는 일은 라벨과 링크를 바꾸는 것뿐이고,
   스크립트가 없으면 구단 목록으로 간다 — 길이 끊기지 않는다.
   ⚠**CSP 가 인라인 스크립트를 막으므로**(script-src self) 이 교체는 외부 스크립트가
   로드된 뒤에 일어난다. 한 프레임 깜빡임이 있고, 그 전에 눌러도 목록으로 가므로 문제되지 않는다. */
const favNameOf=(code)=>{
  const b=$$("[data-favteam]").filter(x=>x.dataset.favteam===code)[0];
  return b&&b.dataset.favname?b.dataset.favname:code.toUpperCase();
};
const paintFav=()=>{
  const code=state.favTeam;
  $$("[data-favteam]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.favteam===code?"true":"false"));
  $$("[data-navteam]").forEach(a=>{
    if(code===""){a.setAttribute("href",BASE+"teams.html");a.textContent="球団";return}
    a.setAttribute("href",BASE+"teams/"+code+".html");
    a.textContent=favNameOf(code);
  });
};
$$("[data-favteam]").forEach(b=>b.addEventListener("click",()=>{
  state.favTeam=state.favTeam===b.dataset.favteam?"":b.dataset.favteam;
  save(state);paintFav();
}));
paintFav();
```

⚠`BASE`·`save`·`state` 는 이 파일이 이미 쓰는 것이다. `save` 가 저장하는 객체에
`favTeam` 이 포함되는지 확인하라 — `cur.favs=state.favs` 처럼 필드를 골라 담는 곳이 있으면
`cur.favTeam=state.favTeam` 을 함께 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `node --test packages/web/test/client.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음 (⚠오류가 나면 역따옴표나 이스케이프를 넣은 것이다)

- [ ] **Step 5: 뮤테이션 검사**

`paintFav` 의 `a.textContent=favNameOf(code);` 를 지운다.

Run: `node --test packages/web/test/client.test.ts`
Expected: FAIL — 「내비 첫 항목이 그 구단이 된다」가 떨어진다

되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add packages/web/src/assets.ts packages/web/test/client.test.ts
git commit -m "feat(web): 최애 구단 지정 — 내비 첫 탭이 그 구단이 된다"
```

---

### Task 10: 전체 검증과 배포 준비

**Files:** 없음(검증 전용)

- [ ] **Step 1: 타입·시험·빌드**

Run: `npm run typecheck`
Expected: 오류 없음

Run: `BB_REQUIRE_DIST=1 BB_REQUIRE_DB=1 npm test`
Expected: `fail 0` · `skipped 0`

Run: `npm run build:web`
Expected: `링크: … 깨진 것 없음` · 파일 수 **15,445 안팎**(기존 15,436 + teams.html 9장)

- [ ] **Step 2: 산출물 실측**

Run: `grep -o '<nav class="tnav">[^<]*<a[^>]*>[^<]*' dist/index.html | head -1`
Expected: 첫 링크가 `球団`

Run: `grep -c 'id="b-tnow"' dist/teams/t.html`
Expected: `1`

Run: `grep -o 'まだ判定できません\|自力優勝の可能性あり\|マジック [0-9]*\|自力優勝消滅\|優勝の可能性なし' dist/teams/t.html | head -1`
Expected: 다섯 중 하나가 나온다

⚠**「まだ判定できません」이 나오면 정상일 수 있다** — 교류전이 안 끝난 시기이거나 데이터가 얇을 때다.
2026-08 시점에는 교류전이 끝났으므로 **판정이 서 있어야 한다.** 안 서면 Task 2 를 다시 본다.

- [ ] **Step 3: Pages 파일 상한 확인**

Run: `find dist -type f | wc -l`
Expected: 20,000 미만. ⚠**16,000 을 넘으면** 다음 백필 전에 파일 수를 줄여야 한다(CLAUDE.md 에 적혀 있다).

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore: 최애 구단 기능 검증 — 시험 전부 통과·링크 깨짐 0"
```

---

## Self-Review

**스펙 대비 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 1. `race.ts` 한 벌 | 1 · 2 |
| 규정 대전수 시즌별 유도 · 정수 검산 | 1 |
| 자력 · 매직(점등 조건) · 소멸 | 2 |
| 완결 7시즌 대조 | 3 |
| 이동 앵커(`hi-` · `stand-`) | 4 |
| 2. 구단 페이지 「지금 이 팀」 + 이동 | 5 |
| 이 팀의 연속기록 · 기록근접 | 6 |
| 3. `teams.html` | 7 |
| 내비 첫 항목 `球団` | 8 |
| 4. 최애 지정 · 내비 교체 · 저장 | 9 |
| 5. 시험(단위 · 실데이터 · 화면 · 클라이언트) | 1·2·3·5·6·7·8·9 |
| M2 분모 · M11 판정불가 · M12 0건 · §0-1 · §6 | 5·6·7·8 |

**빠진 것 없음.** 스펙의 「범위 밖」(CS 라인 · 팀 선수 순위 요약 · ①-A/B/C)은 계획에도 없다.

**타입 일관성**: `TeamRace`(Task 2)를 `TeamNow.race`(Task 5)가 그대로 쓴다.
`pairKey`(Task 1)를 Task 2·3 이 쓴다. `data-favteam`·`data-favname`(Task 7)을 Task 9 가 읽는다.
`data-navteam`(Task 8)을 Task 9 가 쓴다.
