/**
 * 火消し(継投引き継ぎ) — **「이 투수는 남의 불을 끄는 사람인가, 깨끗한 이닝만 받는 사람인가」**.
 *
 * ⚠**새 수집이 0이다.** 재료(`pitcher_id`·`bases`·`outs_before`·`inning`·`half`·`seq`·`runs_scored`)는
 * 2018 시즌부터 전부 채워져 있고, 세는 코드가 없었을 뿐이다.
 * ⚠**용어집에 `inheritedRunner` 가 있는데 그것을 재는 지표가 없었다**(2026-08-20) —
 * 설명만 있고 값이 없는 상태를 닫는 일이다.
 *
 * ## 어떻게 세는가
 *
 * 같은 하프이닝에서 **직전 타석과 `pitcher_id` 가 다른 첫 타석** = 이닝 도중 등판.
 * 그 타석의 `bases` 가 비어 있지 않으면 **주자를 안고 등판**했다는 뜻이다.
 * ⚠**`runner_event.after_seq` 를 쓰지 않는다** — 그 값은 `pa_event.seq` 와 세는 모집단이 달라
 * 236/12,062(2.0%)가 다른 하프이닝을 가리킨다(2026-08-20 실측). 지금 읽는 코드가 0곳이라 무해하고,
 * 이 파일도 쓰지 않는다.
 *
 * ## ⚠무엇을 재지 않는가 — **화면이 이것을 말해야 한다**
 *
 * **「引き継いだ走者が何人生還したか」(MLB 의 IS%)는 원리적으로 불가능하다.**
 * `bases` 는 **점유만** 말하고 주자의 **신원**을 말하지 않는다. 우리가 셀 수 있는 것은
 * 「그 이후 그 이닝에 들어온 점」이고 **거기엔 자기가 낸 주자의 득점도 섞인다.**
 * ⚠**그래서 「引き継ぎ走者生還率」로 이름 붙이면 그 이름 자체가 거짓말이다.**
 * 「火消し(그 이닝을 무득점으로 끝냈다)」로 부르고 정의를 붙인다.
 *
 * ## ⚠「그 이닝이 끝날 때까지」다 — 본인이 내려간 뒤도 포함한다
 *
 * `doused` 의 판정은 **등판 타석부터 그 하프이닝 끝까지 실점 0**이다. 같은 이닝에 다시 교대가
 * 일어나면 **뒷사람이 낸 점도 들어간다.** 실측(2026-08-20 · 9시즌 정규):
 * 이닝 도중 등판 **8,817회** 중 같은 이닝에 또 교대가 있었던 것 **701회(8.0%)**이고,
 * 「본인 타석만」으로 재는 정의와 **판정이 갈리는 것은 7,802회 중 98회(1.3%)**다.
 * ⚠**「불이 꺼졌는가」는 상황에 대한 진술**이라 이 정의를 골랐다. 화면이 그렇게 적는다.
 *
 * ## 실측 (2026-08-20 · 9시즌 정규시즌)
 *
 * · 이닝 도중 등판 **8,817회** · 주자를 안고 등판 **7,802회** · 火消し 성공 **4,910회**
 * · ⚠**분모를 구별해 쓴다**(작업규칙 7): 이닝 도중 등판이 있는 투수 **586명**,
 *   그중 **주자를 안은 적이 있는 투수 569명**. 주자 안은 등판이 20회 이상 **131명** · 10회 이상 **235명**.
 * · 2025 한 시즌만 보면 이닝 도중 등판 **804회 / 투수 185명(1인당 4.35회)** ·
 *   주자 안고 **743회 / 투수 178명(1인당 4.17회)**.
 *   ⚠**시즌 단위 개인 순위를 만들지 마라** — 그 표본으로는 값이 아니라 소음이다.
 * · 보조 실측: 2025 팀-경기당 투수 4.12명인데 이닝 도중 교대는 0.47회 — **교대의 85%가 이닝 사이**다.
 *
 * ⚠**무료 NPB 소스 검색 0건.** NPB 공식은 홀드·세이브만 낸다.
 */
import type { Db } from "@bb-app/store";
import { seasonNameExpr, seasonNameJoin } from "./season-name.ts";
import type { Rate } from "@bb-app/metrics";
import { rate } from "@bb-app/metrics";
import type { RunExpectancy } from "./run-expectancy.ts";
import { stateKey } from "./run-expectancy.ts";

/** 이닝 도중 등판 1회. **접기 전의 원재료**다 */
export interface ReliefEntry {
  pitcherId: string;
  displayName: string;
  /** 소속. ⚠**수비 측이다** — 표(top)면 홈, 리(bottom)면 원정 */
  teamCode: string;
  season: number;
  /**
   * 공격 팀 코드. ⚠**RE 행렬은 리그·시즌마다 다르고**, 그 리그를 정하는 것은
   * **공격 측**이다(`run-expectancy.ts` 가 그렇게 만든다).
   */
  offenseCode: string;
  bases: string;
  outs: number;
  /** 등판 타석부터 **그 하프이닝 끝까지** 난 득점 */
  restRuns: number;
}

export interface ReliefScan {
  entries: ReliefEntry[];
  /**
   * 투수를 몰라 판정하지 않은 타석 수 — **시즌별**로 센다. ⚠**0 으로 때우지 않는다**(M11).
   * 지금 아카이브는 `pitcher_id IS NULL` **0건**이지만(실측 2026-08-21 · 정규시즌 `status='final'`
   * **552,563행 중 0행**), CLAUDE.md §2-2 는 소급 시즌의 투수 귀속이 얇을 수 있다고 적어 뒀다 —
   * 그 창이 열리면 이 수가 말한다. **어느 시즌이 얇은지**까지 말해야 백필을 되짚을 수 있다.
   *
   * ⚠**시즌별인 이유는 「자를 수 있어야 하기」 때문이다**(2026-08-21 검토 ③).
   * 예전에는 합계 하나(`number`)였고, `query.ts` 가 통산 스캔을 시즌 화면용으로 자를 때
   * **`entries` 만 `season <=` 로 자르고 이 수는 전 범위 값을 그대로 복사**했다 —
   * 같은 객체 안에서 두 필드의 범위가 달랐다(실데이터가 0이라 드러나지 않았을 뿐이다).
   * 시즌 키가 있으면 같은 칼로 자를 수 있고, 못 자르는 모양 자체가 사라진다.
   *
   * ⚠**여기 없는 시즌은 「그 범위 안에서 0건」이다.** 범위 자체는 `midInningEntries` 의
   * `fromSeason`·`toSeason` 이 정한다 — **범위 밖 시즌을 이 지도만 보고 0 이라고 읽지 마라**
   * (「0건」과 「안 쟀음」은 다르다 · 작업규칙 7).
   */
  unknownPitcher: ReadonlyMap<number, number>;
}

/**
 * ⚠**행을 걸러내면 `LAG` 가 어긋난다.**
 * `run-expectancy.ts` 의 `afterStateOf` 가 같은 함정을 적어 뒀다 — 중간 타석 하나가 빠지면
 * 「직전 타석」이 **그 다음다음**이 되어 없는 교대를 만들어낸다.
 * 그래서 **투수 미상 행을 CTE 에서 빼지 않고** 그대로 두고, 판정할 때 양쪽이 다 있을 때만 센다.
 *
 * ⚠**`e.status='final'` 과 경기 단위 조건은 안전하다** — 전자는 진행 중 경기의 **꼬리**만 자르고
 * (v1 에는 `live` 행이 0건이다), 후자는 경기를 통째로 넣거나 뺀다. **하프이닝 안에 구멍을 내지 않는다.**
 * ⚠**정렬은 `game_id, seq` 다** — `half` 로 정렬하면 문자열이라 bottom 이 top 보다 먼저 온다.
 */
const SQL = `
WITH ev AS (
  SELECT e.game_id AS gameId, e.seq AS seq, e.inning AS inning, e.half AS half,
         e.pitcher_id AS pitcherId, e.bases AS bases, e.outs_before AS outs,
         g.season AS season,
         (CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END) AS teamCode,
         (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) AS offenseCode,
         LAG(e.pitcher_id) OVER w AS prevPitcherId,
         LAG(e.game_id)    OVER w AS prevGameId,
         LAG(e.inning)     OVER w AS prevInning,
         LAG(e.half)       OVER w AS prevHalf,
         SUM(e.runs_scored) OVER (PARTITION BY e.game_id, e.inning, e.half ORDER BY e.seq
                                  ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS restRuns
  FROM pa_event e
  JOIN game g ON g.game_id = e.game_id
  WHERE g.status = 'played' AND g.competition = ? AND g.game_date <= ?
    AND g.season BETWEEN ? AND ?
    AND e.status = 'final'
  WINDOW w AS (ORDER BY e.game_id, e.seq)
)
SELECT ev.pitcherId AS pitcherId, ${seasonNameExpr("p")} AS displayName,
       ev.teamCode AS teamCode, ev.offenseCode AS offenseCode, ev.season AS season,
       ev.bases AS bases, ev.outs AS outs, ev.restRuns AS restRuns
FROM ev
JOIN player p ON p.player_id = ev.pitcherId
${seasonNameJoin("ev.pitcherId", "ev.season")}
WHERE ev.prevGameId = ev.gameId AND ev.prevInning = ev.inning AND ev.prevHalf = ev.half
  AND ev.prevPitcherId IS NOT NULL AND ev.pitcherId IS NOT NULL
  AND ev.prevPitcherId <> ev.pitcherId
ORDER BY ev.gameId, ev.seq
`;

/**
 * ⚠**시즌별로 센다** — 합계 하나로는 시즌 화면용으로 자를 수 없다(`ReliefScan.unknownPitcher` 주석).
 * ⚠**0인 시즌은 행이 안 나온다.** 그게 「그 범위 안에서 0건」의 표현이다.
 */
const UNKNOWN_SQL = `
SELECT g.season AS season, COUNT(*) AS n
FROM pa_event e JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND g.season BETWEEN ? AND ? AND e.status = 'final' AND e.pitcher_id IS NULL
GROUP BY g.season
ORDER BY g.season
`;

/**
 * 이닝 도중 등판을 뽑는다.
 *
 * @param fromSeason 통산의 시작 시즌(보유 첫 시즌)
 * @param toSeason 화면이 보고 있는 시즌. ⚠**미래 시즌을 과거 화면에 싣지 않는다** —
 *   `query.ts` 의 통산 대전(`careerMatchups`)과 같은 규약이다
 */
export function midInningEntries(
  db: Db,
  competition: string,
  through: string,
  fromSeason: number,
  toSeason: number,
): ReliefScan {
  const entries = db.raw
    .prepare(SQL)
    .all(competition, through, fromSeason, toSeason) as unknown as ReliefEntry[];
  const unknown = db.raw
    .prepare(UNKNOWN_SQL)
    .all(competition, through, fromSeason, toSeason) as unknown as { season: number; n: number }[];
  return {
    entries,
    unknownPitcher: new Map(unknown.map((r) => [Number(r.season), Number(r.n)])),
  };
}

export interface ReliefLine {
  pitcherId: string;
  displayName: string;
  teamCode: string;
  /** 이닝 도중 등판(주자 유무 불문) */
  midInning: number;
  /** **주자를 안고** 이닝 도중 등판. ⚠**火消し率의 분모는 이것이다**(M2) */
  inherited: number;
  /** 등판 시점에 루상에 있던 주자의 합계 */
  inheritedRunners: number;
  /**
   * 등판 시점 득점기대치의 합. ⚠**RE 를 모르는 등판은 들어가지 않는다** —
   * 평균의 분모는 `inherited - reMissing` 이다.
   */
  enteringRe: number;
  /** RE 행렬에 그 상태가 없어 세지 못한 등판 수. **0 으로 때우지 않는다**(M11) */
  reMissing: number;
  /** 火消し 성공 = 등판 타석부터 **그 하프이닝 끝까지** 실점 0 */
  doused: number;
}

/**
 * 등판 목록을 투수별로 접는다.
 *
 * @param reOf 그 등판에 맞는 RE 행렬. ⚠**여기서 만들지 않는다**(M1) —
 *   행렬은 `buildRunExpectancy` 한 벌이고, 어느 리그인지는 부르는 쪽이 안다.
 */
/**
 * 등판을 투수별로 접는다.
 *
 * ⚠**이름은 「범위 안에서 가장 나중 시즌」의 것을 쓴다** — `careerNameJoin` 과 같은 규칙이다.
 * 여러 시즌을 접는 표에서 먼저 만난 것을 두면 **가장 오래된 등록명**이 이기고,
 * 그러면 같은 페이지의 시즌 표와 이름이 갈린다(M1).
 */
export function foldRelief(
  entries: readonly ReliefEntry[],
  reOf: (e: ReliefEntry) => RunExpectancy | undefined,
  /**
   * 통산 표에 쓸 이름 사전(`careerNames`). ⚠**주면 이것이 이긴다.**
   * 안 주면 **엔트리 중 가장 나중 시즌**의 표기를 쓴다 - 그건 「등판이 있던 마지막 시즌」이라
   * 「뛴 마지막 시즌」과 어긋날 수 있다(실측 4명). 시즌 표는 안 줘도 된다(그 시즌 것뿐이므로).
   */
  nameOf?: ReadonlyMap<string, string>,
): ReliefLine[] {
  const out = new Map<string, ReliefLine>();
  /** 이름을 고른 시즌. `careerNameJoin` 과 같은 규칙 — **범위 안에서 가장 나중** */
  const nameSeason = new Map<string, number>();
  for (const e of entries) {
    let l = out.get(e.pitcherId);
    if (l === undefined) {
      l = {
        pitcherId: e.pitcherId, displayName: e.displayName, teamCode: e.teamCode,
        midInning: 0, inherited: 0, inheritedRunners: 0, enteringRe: 0, reMissing: 0, doused: 0,
      };
      out.set(e.pitcherId, l);
      nameSeason.set(e.pitcherId, e.season);
      const better = nameOf?.get(e.pitcherId);
      if (better !== undefined) l.displayName = better;
    } else if (nameOf === undefined && e.season > (nameSeason.get(e.pitcherId) ?? -1)) {
      // ⚠**먼저 온 것을 그냥 두면 「가장 오래된 이름」이 이긴다** — 이 표는 여러 시즌을
      //   접으므로, 안 고르면 통산 火消し 표만 옛 등록명으로 남는다(2026-08-21 배선 중 실측)
      l.displayName = e.displayName;
      nameSeason.set(e.pitcherId, e.season);
    }
    l.midInning += 1;
    // ⚠**주자 없는 등판은 火消し의 분모가 아니다.** 넣으면 전원의 성공률이 부풀어 오른다
    if (e.bases === "") continue;
    l.inherited += 1;
    l.inheritedRunners += e.bases.length;
    if (Number(e.restRuns) === 0) l.doused += 1;
    const re = reOf(e);
    const value = re?.matrix.get(stateKey(e.bases, e.outs));
    if (value === undefined) l.reMissing += 1;
    else l.enteringRe += value;
  }
  return [...out.values()];
}

/**
 * 火消し率 = 무득점으로 끝난 등판 ÷ 주자를 안고 한 등판.
 * ⚠**분모가 0이면 값을 내지 않는다**(M11) — 「불을 안은 적이 없다」와 「안았는데 다 탔다」는 다르다.
 */
export function dousedRate(l: Pick<ReliefLine, "doused" | "inherited">): Rate {
  return rate(l.doused, l.inherited);
}

/**
 * 등판 시점의 평균 득점기대치 — **「얼마나 어려운 자리를 받았는가」**.
 * ⚠**분모에서 `reMissing` 을 뺀다** — 못 센 등판을 0점짜리 자리로 세면 전원이 낮아진다.
 */
export function averageEnteringRe(
  l: Pick<ReliefLine, "enteringRe" | "inherited" | "reMissing">,
): Rate {
  return rate(l.enteringRe, l.inherited - l.reMissing);
}

/**
 * 이 값으로 **순위를 매길 수 있는** 최소 등판 수.
 *
 * ⚠**시즌 단위로는 어떤 값을 써도 순위가 성립하지 않는다**(M3) — 실측으로 2025 시즌
 * 투수 1인당 주자 안은 등판이 평균 4.35회다. 9시즌 통산에서도 20회 이상은 **569명 중 131명**뿐이다.
 * 화면은 이 선 아래에서 **비율을 내지 않고 개수만** 낸다.
 */
export const MIN_INHERITED_FOR_RATE = 10;
