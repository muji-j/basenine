/**
 * 투수 연속 기록 — **連続無失点登板**(PSA) 와 **連続無失点イニング**(PSI).
 *
 * 정본은 `docs/metrics/2026-09-07-streak-metrics.md` §2·§3 이다. **여기서 산식을 정하지 않는다.**
 *
 * ## 두 지표는 다른 수다
 *
 * - **PSA** = 실점 없이 끝낸 **등판**이 몇 번 연속됐는가. 단위 **登板**.
 *   부속으로 그 등판들의 아웃 합(`interiorOuts`)을 낸다 — ⚠**이것은 PSI 가 아니다.**
 * - **PSI** = 실점 없이 던진 **이닝**이 몇 회 연속됐는가. **등판 도중에도 끊긴다.**
 *   `interiorOuts` + **양 끝 경계 등판의 기여**다.
 *
 * ⚠**그래서 두 지표는 기간도 다르다.** 경계 등판은 PSA 의 마루에 안 들어가고 PSI 의 값에는
 * 들어가므로, PSI 의 기간은 **그 등판일까지** 걸친다(`ScorelessInnings.from`/`to`).
 * `PitchingStreak.from`/`to` 를 이닝 축 화면에 그대로 쓰면 **값의 근거가 된 경기가 기간에서 빠진다.**
 *
 * ## ⚠규칙 R — 이닝 경계의 정의 (정의서 §3-1)
 *
 * > **하프이닝 단위로 센다. 그 투수에게 실점이 붙은 하프이닝은 그가 몇 아웃을 잡았든 통째로 0 으로 친다.**
 *
 * ⚠**「실점이 난 순간까지의 아웃을 센다」로 읽지 마라 — 그 읽기는 공표값 3건 전부와 어긋난다.**
 * 두 읽기는 **1/3회 차이로 갈리고 눈으로는 못 잡는다**(정의서 §3-2 山﨑 사례: 규칙 R = 36.0回,
 * 경합안 = 36回1/3, 공표 = 36回). 그 대조가 `test/streaks-published.test.ts` 에 있다.
 *
 * ## ⚠무실점 등판에 `pa_event` 를 쓰지 마라
 *
 * 「이 등판이 무실점인가」의 정본은 **`pitching_line.runs`(100%)** 다.
 * 무실점 등판 35,171건 중 **1,691건(4.8%)** 에서 `pa_event` 는 「실점이 있다」고 말한다 —
 * 실점은 **주자를 내보낸 투수**에게 붙는데 `pa_event.runs_scored` 는 **마운드에 선 투수**에게 붙기
 * 때문이다(계승주자). 그대로 쓰면 **공식적으로 무실점인 등판 21개 중 1개에서 마루가 거짓으로 끊긴다.**
 * → **`pa_event` 를 쓰는 곳은 마루의 양 끝 경계뿐이다.**
 *
 * ## 실측 (완결 8시즌 2018~2025 · 정규 · 2026-09-07 재현)
 *
 * 등판 **56,533**(무실점 35,171) · 마루 **9,725** · 범위 시작에 닿은 마루 **412** ·
 * 경계 등판 **12,817**(중복 제거 · 슬롯으로 세면 18,698) ·
 * 그중 확정 **11,913 = 92.9%**(하프이닝 1개 7,467 · 대조 통과 4,446) ·
 * 미확정 **904**(실점 귀속 857 · 아웃 합 47).
 * 마루 양 끝 확정 **88.3%**(≥10등판 **94.6%** · ≥30등판 **100%**).
 * 미확정 마루 **1,139**개의 폭(상한−하한) 중앙 **6아웃** · p90 **19** · 최대 **40**.
 * ⚠**폭이 작지 않다 — 「어차피 비슷하니 점추정하자」로 가지 마라.**
 */
import type { Db } from "@bb-app/store";

/**
 * 連続無失点イニング의 값. ⚠**세 값을 다 낸다**(정의서 §3-3) — 표시가 어느 쪽을 고르든.
 *
 * ⚠**`lowerOuts` 도 `upperOuts` 도 「반드시 참」이다.** 하한은 미확정 경계의 기여를 0 으로 둔 값이고,
 * 상한은 그 경계 등판의 아웃을 통째로 얹은 값이다.
 */
export interface ScorelessInnings {
  /** 하한(아웃). 화면이 「N回以上」이라고 쓸 때의 N */
  lowerOuts: number;
  /** 상한(아웃). `exact` 면 `lowerOuts` 와 같다 */
  upperOuts: number;
  /**
   * 규칙 R 의 경계를 **양 끝에서 다 짚었는가**. `false` 면 화면은 부등호를 붙인다.
   *
   * ⚠**`atRangeStart` 와 사유가 다르다** — 이쪽은 「그 등판의 실점 시점을 못 짚는다」이고
   * 저쪽은 「그 앞을 우리가 안 봤다」다. **각주에서 구별하라**(정의서 §1-6).
   */
  exact: boolean;
  /**
   * **이닝 축이 실제로 걸친 기간의 첫 경기일.**
   *
   * ⚠**`PitchingStreak.from` 과 다를 수 있다 — 한 필드에 두 뜻을 담지 않는다.**
   * 경계 등판은 **등판 축에는 안 들어가고 이닝 축에는 들어간다**(규칙 R). 앞 경계가
   * **확실히** 기여하면(`exact` 이고 기여 아웃 > 0) 이닝 마루는 **그 등판일에 시작한다.**
   *
   * ⚠**실제로 화면이 거짓말을 했다**(2026-09-07 이중 검토 P2): 山﨑(`03305153`) 2025 의
   * `36回` 는 4/2~4/30 의 105아웃 **+ 5/7 등판의 3아웃**인데, 화면 기간이 `4月2日〜4月30日` 라
   * **값의 근거가 된 5/7 이 빠져 있었다.** 값은 맞는데 근거를 가리키는 기간이 틀렸다.
   */
  from: string;
  /** 같은 규칙의 끝. 뒤 경계가 **확실히** 기여하면 **그 등판일**이다 */
  to: string;
  /**
   * `from`~`to` 안에 **등판이 있던 시즌**(오름차순 · 중복 없음).
   * ⚠**`PitchingStreak.seasons` 와 다를 수 있다** — 경계 등판이 이웃 시즌일 수 있다(통산 모드).
   * 화면이 **연도를 붙일지**를 이것으로 정한다(안 그러면 `9月13日〜7月19日` 이 거꾸로 읽힌다).
   */
  seasons: readonly number[];
  /**
   * **그 기간이 확정인가.**
   *
   * ⚠**`exact` 와 같은 값이 아니다.** 경계가 미확정이어도 그 등판의 아웃이 **0** 이면
   * 기여는 0 으로 정해져 기간이 안 흔들린다. 반대 방향은 성립한다 — `spanExact === false` 면
   * `exact` 도 반드시 `false` 다(미확정 경계가 있다는 뜻이므로).
   * ⚠**`false` 일 때 이 기간은 「하한이 센 범위」다** — 상한(`upperOuts`)은 그 밖의 등판까지 센다.
   */
  spanExact: boolean;
}

/** 마루 하나 */
export interface PitchingStreak {
  /** **連続無失点登板**(PSA). 단위 **登板** */
  appearances: number;
  /**
   * 마루 안 등판의 아웃 합.
   * ⚠**이것은 「連続無失点イニング」이 아니다** — 라벨은 「うち投球回」처럼 부속임이 드러나야 한다.
   */
  interiorOuts: number;
  /** **連続無失点イニング**(PSI · 규칙 R) */
  innings: ScorelessInnings;
  /** 마루의 첫·마지막 경기일 */
  from: string;
  to: string;
  /**
   * 마루 안에 **등판이 있던 시즌**(오름차순 · 중복 없음).
   * ⚠**건너뛴 시즌은 여기 없다 — 그래서 보인다**(島本: 2019 →(2020·2021 등판 없음)→ 2022).
   */
  seasons: readonly number[];
  /**
   * 마루가 **훑은 범위의 첫 등판**에서 시작한다 = 그 앞을 우리가 안 봤다.
   *
   * ⚠**뜻이 모드마다 다르다.** 시즌 모드에서는 「시즌 시작」이라 **「以上」이 아니다**
   * (화면이 이미 「今季」라고 말한다). **통산 모드에서만** 「(하한−1)年以前は未参照」가 된다.
   * ⚠**「2017」을 어디에도 박지 마라** — `PitchingStreaks.fromSeason − 1` 에서 유도한다.
   */
  atRangeStart: boolean;
  /**
   * 마루 뒤에 등판이 없다 = **아직 안 끊겼다**.
   *
   * ⚠**「継続中」이 아니다.** 「継続中 / 途切れていない·登板なし / 途切れた」는 **세 상태**이고
   * 그 판정에는 팀 소화 경기 수가 필요하다(정의서 §1-5) — 계산 계층은 **사실만** 낸다.
   * ⚠**끝쪽에는 「以上」을 붙이지 않는다**(§1-4) — 안 끊긴 것은 데이터가 없어서가 아니다.
   */
  open: boolean;
}

export interface PitchingStreaks {
  playerId: string;
  /**
   * 지금 이어지고 있는 마루. **마지막 등판에서 실점했으면 `null`**.
   * ⚠**`0` 으로 쓰지 않는다** — 「지금 이어지는 마루가 없다」와 「등판이 0이다」는 다른 사실이다(M11).
   */
  current: PitchingStreak | null;
  /** 가장 긴 마루 — **등판 기준**. 동률이면 **나중 구간**(`>=` · 타자 3종과 같은 규칙) */
  best: PitchingStreak | null;
  /**
   * 가장 긴 마루 — **이닝 기준**. ⚠**`best` 와 다른 마루일 수 있다.**
   *
   * ⚠**하한(`lowerOuts`)으로 고른다.** 상한으로 고르면 **경계를 못 짚은 마루가 이긴다** —
   * 「모를수록 길어진다」가 되어 값이 아니라 소음이 된다. 동률이면 상한 → 나중 구간 순.
   */
  bestInnings: PitchingStreak | null;
  /** 훑은 등판 수. **분모다**(M2) */
  appearances: number;
  /** 훑은 범위 — 화면이 「2018〜2026年」이라고 말할 근거다(M2 의 셋째 분모) */
  fromSeason: number;
  toSeason: number;
  /** 훑은 대회. ⚠**화면이 「レギュラーシーズンのみ」라고 말해야 한다**(정의서 §5 조건 3) */
  competition: string;
  /**
   * 이 투수가 **마지막으로 등판한 경기일**. 없으면 null.
   * ⚠**「今」으로 때우지 않는다**(M11 · 타자 3종과 같은 규칙).
   */
  lastGameDate: string | null;
}

/** 훑을 범위. ⚠**시즌 모드와 통산 모드가 같은 코드를 탄다**(M1) */
export interface StreakScope {
  /** 기본 `"regular"`. 사용자 결정 ⑴ — 포스트시즌을 섞지 않는다 */
  competition?: string;
  /** 이 날짜까지. 기본 `"9999-12-31"` */
  through?: string;
  /** 훑을 시즌의 하한. 시즌 모드면 그 시즌, 통산 모드면 **보유 하한** */
  fromSeason: number;
  /**
   * 훑을 시즌의 상한 = **보고 있는 시즌**.
   * ⚠**미래 시즌을 과거 화면에 싣지 않는다** — 「통산의 끝은 언제나 보고 있는 시즌」(CLAUDE.md §2-2).
   */
  toSeason: number;
}

const DEFAULT_COMPETITION = "regular";
const DEFAULT_THROUGH = "9999-12-31";

/**
 * ⚠**정렬은 경기일 → `game_no` 다**(정의서 §1-1). 더블헤더는 **두 경기**이고,
 * 날짜로 묶으면 1차전 실점·2차전 무실점인 날이 「무실점인 날」이 되어 마루가 거짓으로 이어진다.
 */
const APPEARANCE_SQL = `
SELECT pl.player_id AS playerId, pl.game_id AS gameId, g.game_date AS date,
       g.season AS season, pl.runs AS runs, pl.outs AS outs
FROM pitching_line pl
JOIN game g ON g.game_id = pl.game_id
WHERE g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND g.season BETWEEN ? AND ?
ORDER BY pl.player_id, g.game_date, g.game_no
`;

/**
 * **경계 등판의 하프이닝별 아웃·실점**(정의서 §3-4 의 구현 지시).
 *
 * 하프이닝 안에서 타석 `i` 가 만든 아웃 = `outs_before(i+1) − outs_before(i)`,
 * **마지막 타석은 `3 − outs_before(last)`**. `pitcher_id` 가 일치하는 타석의 아웃만 그 투수에게 더한다.
 *
 * ⚠**`LEAD` 는 하프이닝 전체 위에서 계산한다 — 투수로 먼저 거르면 아웃이 어긋난다.**
 * 교대가 일어난 하프이닝에서 다음 타석이 빠지면 「직전 타석」이 그 다음다음이 되어 아웃이 부푼다
 * (`relief.ts` 가 같은 함정을 적어 뒀다).
 *
 * ⚠**실점 등판만 읽는다**(`pl.runs > 0`). 무실점 등판에 `pa_event` 를 쓰면 계승주자 때문에
 * 4.8% 가 거짓으로 끊긴다 — 머리주석 참조.
 *
 * ⚠**`pitcher_id IS NULL` 인 타석의 아웃은 아무에게도 안 간다** — 그러면 아웃 합 대조가 어긋나
 * **미확정**이 된다. **0 으로 때우지 않는다**(M11). 실측 결측 0건이지만 소급 시즌에서 열릴 수 있다.
 */
const HALF_INNING_SQL = `
WITH pa AS (
  SELECT e.game_id AS gid, e.seq AS seq, e.inning AS inning, e.half AS half,
         e.outs_before AS ob, e.pitcher_id AS pid, e.runs_scored AS rs,
         LEAD(e.outs_before) OVER (PARTITION BY e.game_id, e.inning, e.half ORDER BY e.seq) AS nob
  FROM pa_event e
  JOIN game g ON g.game_id = e.game_id
  WHERE g.status = 'played' AND g.competition = ? AND g.game_date <= ?
    AND g.season BETWEEN ? AND ? AND e.status = 'final'
)
SELECT pa.gid AS gameId, pa.pid AS playerId, MIN(pa.seq) AS seq0,
       SUM(COALESCE(pa.nob, 3) - pa.ob) AS outs, SUM(pa.rs) AS runs
FROM pa
JOIN pitching_line pl ON pl.game_id = pa.gid AND pl.player_id = pa.pid AND pl.runs > 0
WHERE pa.pid IS NOT NULL
GROUP BY pa.gid, pa.pid, pa.inning, pa.half
ORDER BY pa.gid, pa.pid, MIN(pa.seq)
`;

interface AppearanceRow {
  playerId: string;
  gameId: string;
  date: string;
  season: number;
  runs: number;
  outs: number;
}

interface HalfRow {
  gameId: string;
  playerId: string;
  seq0: number;
  outs: number;
  runs: number;
}

/** 한 등판의 하프이닝들. `seq0` 오름차순 */
type Halves = readonly { outs: number; runs: number }[];

/**
 * 경계 등판의 **기여 아웃**과 **확정 여부**.
 *
 * `side`
 * - `"before"` — 마루 **앞**의 실점 등판. **마지막 실점 하프이닝 뒤**의 아웃이 마루에 들어간다.
 * - `"after"`  — 마루 **뒤**의 실점 등판. **첫 실점 하프이닝 앞**의 아웃이 마루에 들어간다.
 *
 * 확정 판정(정의서 §8) — 둘 중 하나:
 * 1. 하프이닝이 **1개**뿐 → 기여는 **무조건 0**. 실점이 붙은 이상 그 하프이닝에 붙었을 수밖에 없다
 *    (**계승주자여도 그렇다** — 내보낸 주자는 같은 하프이닝 안에 홈에 들어온다). `pa_event` 를 볼 필요조차 없다.
 * 2. `Σ runs_scored = pitching_line.runs` **그리고** `Σ 하프이닝별 아웃 = pitching_line.outs`.
 *
 * ⚠**둘 다 아니면 미확정이다. 「대략 맞으니 통과」로 완화하지 마라** —
 * 그 완화가 정의서 §5 의 이름 판정을 뒤집는다.
 */
function boundaryOuts(
  app: AppearanceRow,
  halves: Halves | undefined,
  side: "before" | "after",
): { outs: number; exact: boolean } {
  if (halves === undefined || halves.length === 0) return { outs: 0, exact: false };
  if (halves.length === 1) return { outs: 0, exact: true };

  let sumOuts = 0;
  let sumRuns = 0;
  for (const h of halves) {
    sumOuts += h.outs;
    sumRuns += h.runs;
  }
  if (sumRuns !== app.runs || sumOuts !== app.outs) return { outs: 0, exact: false };

  let acc = 0;
  if (side === "after") {
    for (const h of halves) {
      if (h.runs > 0) break;
      acc += h.outs;
    }
  } else {
    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i]!;
      if (h.runs > 0) break;
      acc += h.outs;
    }
  }
  return { outs: acc, exact: true };
}

/**
 * ⚠**음수는 계산 대상이 아니라 격리 대상이다**(정의서 §2·§3 경계값).
 * 여기서는 읽기 전용이므로 **던진다** — 조용히 계산하면 그 값이 화면에 나간다(M7 · 루트 §6).
 * 실측(완결 8시즌 전수): 음수 `runs`·`outs` **0건** · 도출 아웃이 음수인 하프이닝 **0건**.
 */
function assertNonNegative(app: AppearanceRow): void {
  if (app.runs < 0 || app.outs < 0) {
    throw new Error(
      `pitching_line 에 음수가 있다 — game=${app.gameId} player=${app.playerId} runs=${app.runs} outs=${app.outs}. 격리 대상이지 계산 대상이 아니다`,
    );
  }
}

function makeStreak(
  seg: readonly AppearanceRow[],
  before: AppearanceRow | null,
  after: AppearanceRow | null,
  halvesOf: (gameId: string, playerId: string) => Halves | undefined,
): PitchingStreak {
  let interiorOuts = 0;
  const seasons: number[] = [];
  for (const a of seg) {
    interiorOuts += a.outs;
    if (seasons.at(-1) !== a.season) seasons.push(a.season);
  }

  let lowerOuts = interiorOuts;
  let upperOuts = interiorOuts;
  let exact = true;
  /**
   * ⚠**이닝 축의 기간은 등판 축의 기간이 아니다.** 경계 등판은 등판 축에 안 들어가지만
   * 이닝 축에는 **들어간다** — 기여 아웃이 0 이 아니면 그 등판일이 마루의 끝(또는 시작)이다.
   * **한 필드에 두 뜻을 담지 않는다**(정의서 §1-6 ⑵ 가 「記録に数えた最後の試合まで」라고 약속한다).
   */
  let inningsFrom = seg[0]!.date;
  let inningsTo = seg.at(-1)!.date;
  const inningsSeasons = [...seasons];
  let spanExact = true;
  for (const [app, side] of [
    [before, "before"],
    [after, "after"],
  ] as const) {
    if (app === null) continue;
    const b = boundaryOuts(app, halvesOf(app.gameId, app.playerId), side);
    if (b.exact) {
      lowerOuts += b.outs;
      upperOuts += b.outs;
      // ⚠**기여가 0 이면 기간을 늘리지 않는다** — 그 등판은 한 아웃도 이 마루에 안 들어갔다
      if (b.outs > 0) {
        if (side === "before") {
          inningsFrom = app.date;
          if (inningsSeasons[0] !== app.season) inningsSeasons.unshift(app.season);
        } else {
          inningsTo = app.date;
          if (inningsSeasons.at(-1) !== app.season) inningsSeasons.push(app.season);
        }
      }
    } else {
      // ⚠**하한은 기여 0 · 상한은 그 등판의 전체 아웃.** 둘 다 「반드시 참」이다
      upperOuts += app.outs;
      exact = false;
      // ⚠**기간은 하한을 따라간다**(늘리지 않는다). 다만 **늘어날 수도 있다는 사실**을 낸다 —
      //   아웃이 0 인 경계는 기여가 0 으로 정해지므로 기간이 안 흔들린다(그때는 확정이다)
      if (app.outs > 0) spanExact = false;
    }
  }

  return {
    appearances: seg.length,
    interiorOuts,
    innings: {
      lowerOuts,
      upperOuts,
      exact,
      from: inningsFrom,
      to: inningsTo,
      seasons: inningsSeasons,
      spanExact,
    },
    from: seg[0]!.date,
    to: seg.at(-1)!.date,
    seasons,
    atRangeStart: before === null,
    open: after === null,
  };
}

/** ⚠**하한으로 고른다** — 상한으로 고르면 「모를수록 길어진다」가 된다 */
function betterInnings(a: PitchingStreak, b: PitchingStreak): boolean {
  if (b.innings.lowerOuts !== a.innings.lowerOuts) return b.innings.lowerOuts > a.innings.lowerOuts;
  if (b.innings.upperOuts !== a.innings.upperOuts) return b.innings.upperOuts > a.innings.upperOuts;
  return true; // 동률이면 **나중 구간**(입력이 시간순이므로 뒤에 온 것이 나중이다)
}

/**
 * 투수 연속 기록을 낸다.
 *
 * ⚠**등판이 0인 선수는 지도에 들어오지 않는다**(M11). 호출자는 `emptyPitchingStreaks()` 를 명시적으로 쓴다.
 *
 * @param scope 훑을 범위. **시즌 모드는 `fromSeason === toSeason`**
 */
export function pitchingStreaks(db: Db, scope: StreakScope): Map<string, PitchingStreaks> {
  const competition = scope.competition ?? DEFAULT_COMPETITION;
  const through = scope.through ?? DEFAULT_THROUGH;
  const args = [competition, through, scope.fromSeason, scope.toSeason] as const;

  const apps = db.raw.prepare(APPEARANCE_SQL).all(...args) as unknown as AppearanceRow[];
  const halfRows = db.raw.prepare(HALF_INNING_SQL).all(...args) as unknown as HalfRow[];

  /** `${gameId}|${playerId}` → 하프이닝들(SQL 이 이미 `seq0` 순으로 준다) */
  const halves = new Map<string, { outs: number; runs: number }[]>();
  for (const r of halfRows) {
    const outs = Number(r.outs);
    if (outs < 0) {
      throw new Error(
        `하프이닝 아웃이 음수다 — game=${r.gameId} player=${r.playerId} outs=${outs}. outs_before 가 줄었다는 뜻이라 격리 대상이다`,
      );
    }
    const key = `${r.gameId}|${r.playerId}`;
    const list = halves.get(key);
    const cell = { outs, runs: Number(r.runs) };
    if (list === undefined) halves.set(key, [cell]);
    else list.push(cell);
  }
  const halvesOf = (gameId: string, playerId: string): Halves | undefined =>
    halves.get(`${gameId}|${playerId}`);

  const byPlayer = new Map<string, AppearanceRow[]>();
  for (const a of apps) {
    assertNonNegative(a);
    const list = byPlayer.get(a.playerId);
    if (list === undefined) byPlayer.set(a.playerId, [a]);
    else list.push(a);
  }

  const out = new Map<string, PitchingStreaks>();
  for (const [playerId, list] of byPlayer) {
    let best: PitchingStreak | null = null;
    let bestInnings: PitchingStreak | null = null;
    let current: PitchingStreak | null = null;

    let i = 0;
    while (i < list.length) {
      if (list[i]!.runs !== 0) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < list.length && list[j]!.runs === 0) j += 1;
      const streak = makeStreak(
        list.slice(i, j),
        i > 0 ? list[i - 1]! : null,
        j < list.length ? list[j]! : null,
        halvesOf,
      );
      // ⚠**같은 길이면 나중 구간으로 갱신한다**(`>=` · 타자 3종과 같은 규칙).
      //   앞 구간의 날짜가 남으면 독자는 지금의 기록이 그때 시작했다고 읽는다
      if (best === null || streak.appearances >= best.appearances) best = streak;
      if (bestInnings === null || betterInnings(bestInnings, streak)) bestInnings = streak;
      if (streak.open) current = streak;
      i = j;
    }

    out.set(playerId, {
      playerId,
      current,
      best,
      bestInnings,
      appearances: list.length,
      fromSeason: scope.fromSeason,
      toSeason: scope.toSeason,
      competition,
      lastGameDate: list.at(-1)?.date ?? null,
    });
  }
  return out;
}

/**
 * 등판이 없는 투수를 위한 빈 값.
 * ⚠**0과 「없음」을 섞지 않기 위해 호출자가 명시적으로 쓴다**(`emptyStreaks` 선례 · M11).
 * ⚠**`current`·`best` 가 `null` 인 것은 「마루가 0이다」가 아니라 「등판이 없다」다.**
 */
export function emptyPitchingStreaks(playerId: string, scope: StreakScope): PitchingStreaks {
  return {
    playerId,
    current: null,
    best: null,
    bestInnings: null,
    appearances: 0,
    fromSeason: scope.fromSeason,
    toSeason: scope.toSeason,
    competition: scope.competition ?? DEFAULT_COMPETITION,
    lastGameDate: null,
  };
}

/**
 * 순위 한 줄. **정렬과 순위 규칙은 정의서 §1-7 이 정본이다.**
 */
export interface StreakRankEntry {
  playerId: string;
  /** 주 값 — 등판 마루면 **등판 수**, 이닝 마루면 **아웃 수** */
  value: number;
  /** 2차 정렬용 아웃 수. 등판 마루의 「うち投球回」 */
  outs: number;
  /** 마루의 마지막 경기일 */
  to: string;
  /**
   * 순위를 줄 수 있는가. ⚠**「以上」이면 `false`** — `23.0回以上` 과 `23.0回` 는 비교가 성립하지 않는다.
   * ⚠**등판 마루에는 이 문제가 없다**(항상 확정) — 그래서 순위표의 주 축은 등판이 안전하다.
   */
  rankable: boolean;
}

/**
 * 연속 기록에 순위를 매긴다 — 정의서 §1-7.
 *
 * - 같은 값은 **같은 순위**를 받고 **다음 순위를 건너뛴다**(`docs/metrics/README.md` §5 상속).
 * - **2차 정렬**(순위를 바꾸지 않는다): 1) 값 → 2) 아웃 수 → 3) `to` 가 **늦은 것 먼저** → 4) `playerId` 오름차순.
 *   ⚠**4번을 반드시 둔다** — 없으면 빌드마다 순서가 흔들리고, **정적 생성이라 그 흔들림이 diff 로 남는다.**
 * - `rankable === false` 는 **순위 `null` 로 목록에 남긴다**(자격 미달과 같은 취급 · M3·M11).
 *
 * ⚠**순위는 `rankable` 인 줄들 사이에서만 센다.** 「以上」이 섞여 있으면 그 줄 때문에 아래 순위가
 * 밀리지 않는다 — 대신 **그 목록이 완전한 순위표가 아니라는 것을 화면이 말해야 한다.**
 */
export function rankStreaks<T extends StreakRankEntry>(
  rows: readonly T[],
): (T & { rank: number | null })[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    if (b.outs !== a.outs) return b.outs - a.outs;
    if (a.to !== b.to) return a.to < b.to ? 1 : -1;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  });

  const out: (T & { rank: number | null })[] = [];
  let seen = 0;
  let prevValue: number | null = null;
  let prevRank = 0;
  for (const row of sorted) {
    if (!row.rankable) {
      out.push({ ...row, rank: null });
      continue;
    }
    seen += 1;
    const rank = prevValue !== null && row.value === prevValue ? prevRank : seen;
    prevValue = row.value;
    prevRank = rank;
    out.push({ ...row, rank });
  }
  return out;
}
