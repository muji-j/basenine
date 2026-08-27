/**
 * カウント別成績 — **타석이 끝난 볼카운트**에서 나오는 값.
 *
 * ⚠**재료는 계속 있었다.** `pa_event.ball_count` 는 **563,833행 전부 채워져 있는데**
 * 읽는 코드가 **0곳**이었다(2026-08-20 실측 · `align.ts:141` 이 만들고 `load.ts:279` 가 쓰고 그 뒤 없음).
 * 새 수집은 0이다.
 *
 * ## 왜 종료 카운트로 「도달」을 말할 수 있는가
 *
 * 한 타석 안에서 **스트라이크도 볼도 줄지 않는다**(단조 비감소). 그래서
 * 종료 카운트의 `S=2` 는 **「2스트라이크에 도달했다」와 정확히 동치**이고(근사가 아니다),
 * `B=3` 은 「3볼에 도달했다」와, `3-2` 는 「풀카운트에 도달했다」와 동치다.
 *
 * ⚠**원문은 「そのカウントから」다.** `1-2より` 는 **마지막 1구를 1-2에서 던졌다**는 뜻이지
 * 「타석이 1-2로 끝났다」가 아니다. 그래서 볼넷은 `3-Xより`, 삼진은 `X-2より` 로 남는다 —
 * 실측이 그것을 보증한다(2026-08-20 · 정규시즌):
 * 볼넷의 종료 볼 카운트가 3인 것 **42,568 / 42,579 (99.974%)** ·
 * 2스트라이크가 아닌 타석의 삼진 **9 / 삼진 110,353 (0.008%)**.
 * ⚠**「0건」이 아니다.** 2025 정규시즌만 보면 0이지만(非2S 30,832타석) **9시즌 전 대회로 넓히면 9건**이고,
 * 원문을 직접 열어 확인한 결과 **npb.jp 쪽 기입 오류**다
 * (`data/archive/npb/scores/2023/0704/h-f-12/playbyplay.html.gz` 가 `0-1より` `空振り三振` 그대로).
 * 그래서 시험도 「0」이 아니라 **비율**로 건다(`count-seasons.test.ts`).
 *
 * ## ⚠무엇을 재지 않는가 — **화면이 이것을 말해야 한다**
 *
 * **투구 단위 데이터가 아니다.** 우리가 아는 것은 **도달 카운트 하나**뿐이다.
 * 파울·헛스윙·초구 스트라이크율은 **여전히 불가능**하고, 「몇 구 던지게 했나」도 못 잰다.
 * (`batted-ball.ts` 가 「헛스윙 유도율이 아니다」라고 적은 것과 같은 경계다.)
 *
 * ## ⚠함정 세 개 — 전부 실측이다 (2026-08-20)
 *
 * 1. **申告敬遠이 `0-0より` 로 들어온다.** 안 빼면 「초구에 끝냈다」에 **던지지도 않은 공**이
 *    섞인다 → `firstPitch` 가 **분자에서만** 뺀다(분모에는 남는다).
 *    ⚠**완결 시즌(2018〜2025)만 인용한다**(2026-08-20 정정) — 진행 중 시즌을 넣으면 이 줄이
 *    경기마다 낡는다. 실측: 전 대회 **2,151건 중 1,509건** · 정규시즌만 **2,085건 중 1,463건**.
 *    ⚠전에는 「전 시즌 2,319건 중 1,614건」이라고 적혀 있었는데, 그 수는 로컬 08-16 스냅샷에서만
 *    참이었고 CI DB(08-19)에서는 **2,325** 였다.
 * 2. **정의역 밖 값이 실재한다.** `4-2より` **1건**(`2018/0809/c-d-18` seq 25 · `二ゴロ`).
 *    **0 으로 때우지 않고 격리한다**(M7) — 격리 수를 함께 낸다(M11).
 * 3. **`ball_count` 는 NULL 이 될 수 있다.** 지금 아카이브에는 0건이지만 스키마가 허용하고
 *    (마이그레이션 008 이 이유를 적어 뒀다) 소급 시즌에서 나올 수 있다.
 *
 * ## ⚠독창이 아니다
 *
 * nf3 · データパーク · Proran · Baseball Geeks 가 이미 낸다. 이것은 **「가지고 있는데 안 쓰던 표준」**이고,
 * 화면 문구에서 독창인 척하지 않는다.
 */
import type { Db } from "@bb-app/store";
import { seasonNameExpr, seasonNameJoin } from "./season-name.ts";
import { foldOutcomes } from "@bb-app/store";
import type { BattingLine, Rate } from "@bb-app/metrics";
import { rate } from "@bb-app/metrics";

/** 볼카운트. **B≤3 · S≤2 를 넘으면 이 타입이 아니다** */
export interface BallCount {
  balls: number;
  strikes: number;
}

/** 정의역. ⚠**코드 두 곳에 적지 않는다** — 시험이 이 값을 읽는다 */
export const MAX_BALLS = 3;
export const MAX_STRIKES = 2;

/**
 * `1-2より` → `{balls:1, strikes:2}`.
 *
 * ⚠**모르면 `null` 이다.** 형식이 다르거나(`1-2`) 정의역 밖(`4-2`)이거나 `NULL` 이면
 * 호출부가 **격리**한다 — 0 으로 때우면 「초구에 끝냈다」가 되어 조용히 틀린다.
 * ⚠**던지지 않는 이유**: 563,833행 중 1건이 정의역 밖인데(실측) 그것 때문에 사이트 전체가
 * 죽으면 대가가 너무 크다. **버리지도 않는다** — 세어서 화면이 말한다(M11).
 */
export function parseBallCount(raw: string | null): BallCount | null {
  if (raw === null) return null;
  const m = /^(\d)-(\d)より$/.exec(raw);
  if (m === null) return null;
  const balls = Number(m[1]);
  const strikes = Number(m[2]);
  if (balls > MAX_BALLS || strikes > MAX_STRIKES) return null;
  return { balls, strikes };
}

export interface CountLine {
  playerId: string;
  displayName: string;
  /**
   * 소속. ⚠**타자는 공격 측, 투수는 수비 측**이다 — 표(top)면 타자가 원정, 투수가 홈.
   * `batted-ball.ts` 와 같은 규칙이다.
   */
  teamCode: string;
  /** **읽을 수 있었던** 타석. ⚠이것이 이 블록 전 비율의 분모다(M2) */
  pa: number;
  /**
   * 읽지 못해 **격리한** 타석. ⚠**분모에 넣지 않는다** — 넣으면 「몰리지 않았다」로 세어져
   * 전 선수의 追い込まれ率이 낮아진다. **버리지도 않는다**(M11) — 화면이 이 수를 말한다.
   */
  quarantined: number;
  /** 2스트라이크에 도달한 타석 */
  twoStrike: number;
  /** 3볼에 도달한 타석 */
  threeBall: number;
  /** 풀카운트(3-2)에 도달한 타석 */
  fullCount: number;
  /**
   * 初球決着. ⚠**申告敬遠을 뺀 수**다 — 전 시즌 IBB 2,319건 중 1,614건이 `0-0より` 로 들어온다.
   */
  firstPitch: number;
  /** 2스트라이크 **도달 후**의 타격 성적 */
  twoStrikeLine: BattingLine;
  /** 2스트라이크에 **도달하지 않은** 타석의 타격 성적. 둘을 나란히 놓는 것이 이 블록의 뜻이다 */
  beforeTwoStrikeLine: BattingLine;
}

/**
 * ⚠**대회를 섞지 않는다**(§2-1) · **미성립 경기는 기록이 무효다**(`status='played'`) ·
 * **잠정값을 섞지 않는다**(M9 · `e.status='final'`).
 *
 * ⚠**`ball_count` 를 SQL 에서 해석하지 않는다.** 정의역 검사는 `parseBallCount` 한 벌이고
 * (M1), SQL 에도 적으면 두 곳이 어긋날 때 어느 쪽이 맞는지 알 수 없다.
 *
 * ⚠**문자열 치환으로 투수판을 만들지 마라 — 실제로 밟았다**(2026-08-20).
 * `batted-ball.ts` 를 흉내 내 `SQL.replace(...) + " AND e.pitcher_id IS NOT NULL"` 로 썼는데,
 * 그쪽 SQL 에는 `GROUP BY` 가 없고 **이쪽에는 있다.** 그래서 조건이 `GROUP BY` **뒤에** 붙어
 * `GROUP BY …, e.outcome AND e.pitcher_id IS NOT NULL` 로 파싱됐다 —
 * **문법 오류가 아니라 「불리언으로 묶기」라 조용히 통과하고**, 한 카운트의 모든 결과가
 * 한 그룹으로 뭉쳐 `twoStrikeLine` 이 통째로 틀린다.
 * ⚠**시험도 못 잡았다** — 투수 시험의 결과가 전부 `strikeout` 이라 뭉쳐도 답이 같았다.
 * → **양쪽을 한 함수에서 조립한다.** 조건이 붙는 자리를 눈으로 볼 수 있어야 한다.
 */
function sqlFor(forPitcher: boolean): string {
  const idCol = forPitcher ? "e.pitcher_id" : "e.batter_id";
  // ⚠**타자는 공격 측, 투수는 수비 측**이다 — 표(top)면 타자가 원정, 투수가 홈
  const team = forPitcher
    ? "CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END"
    : "CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END";
  /** ⚠**`WHERE` 안에 있다** — 이 조건이 `GROUP BY` 뒤로 새는 것이 위에 적은 결함이었다 */
  const notNull = forPitcher ? "  AND e.pitcher_id IS NOT NULL\n" : "";
  return `
SELECT ${idCol} AS playerId, ${seasonNameExpr("p")} AS displayName,
       ${team} AS teamCode,
       e.ball_count AS ballCount, e.outcome AS outcome,
       COUNT(*) AS n, SUM(e.rbi) AS rbi
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = ${idCol}
${seasonNameJoin(idCol, "g.season")}
WHERE g.season BETWEEN ? AND ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final'
${notNull}GROUP BY ${idCol}, teamCode, e.ball_count, e.outcome
`;
}

const SQL = sqlFor(false);
const SQL_PITCHER = sqlFor(true);

interface QueryRow {
  playerId: string;
  displayName: string;
  teamCode: string;
  ballCount: string | null;
  outcome: string;
  n: number;
  rbi: number;
}

type Tally = { outcome: string; count: number; rbi: number };

interface Accum {
  playerId: string;
  displayName: string;
  teamCode: string;
  pa: number;
  quarantined: number;
  twoStrike: number;
  threeBall: number;
  fullCount: number;
  firstPitch: number;
  two: Tally[];
  before: Tally[];
}

/**
 * 선수별 カウント別成績.
 *
 * @param forPitcher 투수 기준으로 셀 것인가
 * @param fromSeason 어느 시즌부터 셀 것인가. 기본은 `season`(= 그 시즌만).
 *   ⚠**끝은 언제나 `season` 이다** — 과거 시즌 화면이 미래를 말하지 않게 한다
 *   (`matchups`·`battingSplits` 와 같은 규약 · M1).
 *
 * ⚠**0인 선수도 행이 나온다** — 「0」과 「기록 없음」은 다르다(M11).
 *   행이 아예 없다는 것은 그 선수의 타석 로그가 없다는 뜻이고, 화면은 그때 「모름」을 낸다.
 *
 * ## 왜 통산을 셀 수 있게 두는가 — 표본이 그렇다
 *
 * 실측(2025 · 규정타석급 타자 40명 · 칸 480): 그 시즌만이면 **가장 작은 칸의 중앙이 6타석**이고
 * **33.8%가 30타석 미만**이다. 통산(보유 9시즌)이면 **중앙 23타석 · 14.0%** 로 내려간다.
 * ⚠**볼카운트는 9시즌 전 시즌 100% 보유**다(**결측 0건** · 보유 전 시즌·전 대회) — 통산이 결측을 섞지 않는다.
 */
export function countLines(
  db: Db,
  season: number,
  competition: string,
  through: string,
  forPitcher = false,
  fromSeason = season,
): CountLine[] {
  const rows = db.raw
    .prepare(forPitcher ? SQL_PITCHER : SQL)
    .all(fromSeason, season, competition, through) as unknown as QueryRow[];

  const out = new Map<string, Accum>();
  for (const r of rows) {
    const n = Number(r.n);
    let a = out.get(r.playerId);
    if (a === undefined) {
      a = {
        playerId: r.playerId, displayName: r.displayName, teamCode: r.teamCode,
        pa: 0, quarantined: 0, twoStrike: 0, threeBall: 0, fullCount: 0, firstPitch: 0,
        two: [], before: [],
      };
      out.set(r.playerId, a);
    }
    const c = parseBallCount(r.ballCount);
    if (c === null) {
      // ⚠**버리지 않는다.** 몇 건을 못 읽었는지가 화면에 나가야 한다(M11)
      a.quarantined += n;
      continue;
    }
    a.pa += n;
    const t: Tally = { outcome: r.outcome, count: n, rbi: Number(r.rbi) };
    if (c.strikes === MAX_STRIKES) {
      a.twoStrike += n;
      a.two.push(t);
    } else {
      a.before.push(t);
    }
    if (c.balls === MAX_BALLS) {
      a.threeBall += n;
      if (c.strikes === MAX_STRIKES) a.fullCount += n;
    }
    /**
     * ⚠**申告敬遠을 뺀다.** 원문이 `0-0より` 인데 **투수는 한 구도 던지지 않았다** —
     * 안 빼면 「초구에 끝냈다」가 거짓이 된다(전 시즌 IBB 2,319건 중 1,614건이 이 모양).
     */
    if (c.balls === 0 && c.strikes === 0 && r.outcome !== "intentionalWalk") a.firstPitch += n;
  }

  return [...out.values()].map((a) => ({
    playerId: a.playerId,
    displayName: a.displayName,
    teamCode: a.teamCode,
    pa: a.pa,
    quarantined: a.quarantined,
    twoStrike: a.twoStrike,
    threeBall: a.threeBall,
    fullCount: a.fullCount,
    firstPitch: a.firstPitch,
    // ⚠**결과 → 카운팅 스탯 변환은 `foldOutcomes` 한 벌뿐이다**(M1)
    twoStrikeLine: foldOutcomes(a.two).line,
    beforeTwoStrikeLine: foldOutcomes(a.before).line,
  }));
}

/** 이 블록 전 비율의 분모. ⚠**격리분은 들어가지 않는다** */
type Denominated = Pick<CountLine, "pa">;

/**
 * 追い込まれ率(투수면 追い込み率) = 2스트라이크 도달 ÷ 읽은 타석.
 * ⚠**타석이 0이면 값을 내지 않는다**(M11) — `rate()` 가 그렇게 만든다.
 */
export function twoStrikeRate(l: Denominated & Pick<CountLine, "twoStrike">): Rate {
  return rate(l.twoStrike, l.pa);
}

/** 初球決着率. ⚠분자에서 申告敬遠이 빠져 있다 */
export function firstPitchRate(l: Denominated & Pick<CountLine, "firstPitch">): Rate {
  return rate(l.firstPitch, l.pa);
}

/** フルカウント率 */
export function fullCountRate(l: Denominated & Pick<CountLine, "fullCount">): Rate {
  return rate(l.fullCount, l.pa);
}

/** 3ボール到達率 */
export function threeBallRate(l: Denominated & Pick<CountLine, "threeBall">): Rate {
  return rate(l.threeBall, l.pa);
}

/** 선수별로 합친다(리그를 나눠 두 번 부르는 호출부를 위한 것). ⚠**소속은 처음 본 것을 남긴다** */
export function addCount(a: CountLine | undefined, b: CountLine): CountLine {
  if (a === undefined) return b;
  return {
    playerId: a.playerId,
    displayName: a.displayName,
    teamCode: a.teamCode,
    pa: a.pa + b.pa,
    quarantined: a.quarantined + b.quarantined,
    twoStrike: a.twoStrike + b.twoStrike,
    threeBall: a.threeBall + b.threeBall,
    fullCount: a.fullCount + b.fullCount,
    firstPitch: a.firstPitch + b.firstPitch,
    twoStrikeLine: addLine(a.twoStrikeLine, b.twoStrikeLine),
    beforeTwoStrikeLine: addLine(a.beforeTwoStrikeLine, b.beforeTwoStrikeLine),
  };
}

function addLine(a: BattingLine, b: BattingLine): BattingLine {
  return {
    pa: a.pa + b.pa, ab: a.ab + b.ab, h: a.h + b.h,
    double: a.double + b.double, triple: a.triple + b.triple, hr: a.hr + b.hr,
    bb: a.bb + b.bb, ibb: a.ibb + b.ibb, hbp: a.hbp + b.hbp,
    sf: a.sf + b.sf, sh: a.sh + b.sh, so: a.so + b.so, roe: a.roe + b.roe,
  };
}
