/**
 * 연속 기록(타자) — **連続試合安打 · 連続試合出塁 · 連続試合無安打**.
 *
 * ⚠**「지금 이어지고 있는가」와 「올해 가장 길었는가」는 다른 값이다.** 둘을 같은 칸에 쓰면
 * 어제 끊긴 기록이 오늘도 이어지는 것처럼 보인다. 그래서 항상 **둘 다** 낸다.
 *
 * ⚠**연속 안타는 「경기」 단위, 연속 출루도 「경기」 단위다**(공인야구규칙 9.23(b) · NPB·MLB 관례).
 * 타석 단위로 세면 훨씬 짧은 수가 나오고, 사람들이 아는 그 기록이 아니게 된다.
 * ⚠**타석 단위의 `連続安打` 는 9.23(a) 라는 실재하는 다른 기록이다** — 그 이름을 쓰면 거짓이 된다.
 * 대신 「그 경기에 타석이 있었는가」로 경기를 세므로, **대주자로만 나온 경기는 세지 않는다.**
 *
 * ## 시즌 안 / 시즌 넘김 — **같은 코드가 낸다**(M1)
 *
 * ⚠**「시즌 경계를 넘기지 않는다」의 근거는 사라졌다.** 옛 주석은 「2025년 이전이 없는데 통산이라고
 * 하면 거짓말이 된다」였는데 **지금은 2018~2026 9시즌을 보유한다.**
 * 대신 남은 함정은 두 가지이고, 둘 다 **화면이 말해서** 푼다:
 * ⑴ **「通算」이라고만 쓰면 거짓이다** — 우리 통산은 **보유 범위 안**이다(그래서 `fromSeason`·`toSeason` 을 낸다).
 * ⑵ **범위 하한에 닿은 마루는 「N試合以上」이다**(그래서 `atRangeStart` 를 낸다).
 *
 * ⚠**`連続試合無安打` 에는 시즌 넘김을 만들지 않았다** — 정의서 §4-4 의 권고이고 §6-7 이
 * **사용자 결정 대기**로 남겼다. 세 근거: ⑴ 공표 범주가 없다(9.23 에 조문이 없다) ·
 * ⑵ 예외 규칙(`skipsForStreak`)의 부호가 반대다 · ⑶ 「토글이 있다 = 시즌 넘김 기록이 있다」는 신호가 흐려진다.
 * ⚠**`null` 로 두지 않고 타입에 자리를 안 뒀다** — `null` 은 「기록이 없다」로 읽히고,
 * 자리가 없는 것은 **「우리가 아직 안 정했다」**를 정직하게 말한다. 정하면 필드 하나를 더하면 된다.
 */
import type { Db } from "@bb-app/store";

export interface Streak {
  /** 지금 이어지고 있는 길이. 마지막 경기에서 끊겼으면 0 */
  current: number;
  /**
   * **지금 이어지고 있는 마루의 시작 경기일.** 이어지는 마루가 없으면 `null`(0 아님 · M11).
   *
   * ⚠**이것이 없으면 화면이 M2 의 둘째 분모(마루의 기간)를 낼 수 없다**(정의서 §1-6).
   * 끝은 `lastGameDate` 가 아니다 — `skipsForStreak` 로 빠진 경기가 마지막이면 둘이 갈린다.
   * ⚠**`bestFrom` 과 다른 값이다.** 「지금」과 「최장」은 다른 마루다.
   */
  currentFrom: string | null;
  /**
   * **지금 이어지고 있는 마루의 마지막 경기일.** 이어지는 마루가 없으면 `null`.
   *
   * ⚠**`lastGameDate` 와 같은 값이 아니다.** 9.23(b) 본문으로 **건너뛴 경기**(사사구·희생번트·
   * 방해로만 끝난 경기)가 마지막이면, 그 경기는 열에서 빠지므로 마루의 끝은 그 앞 경기다.
   * 「마지막으로 나온 경기」와 「마루의 끝」은 **다른 사실**이라 둘 다 낸다(M11).
   */
  currentTo: string | null;
  /** 이 시즌에 가장 길었던 길이 */
  best: number;
  /** 가장 길었던 구간의 시작·끝 경기일. 0이면 null */
  bestFrom: string | null;
  bestTo: string | null;
}

export interface PlayerStreaks {
  playerId: string;
  /** 연속 안타 경기 */
  hitting: Streak;
  /** 연속 출루 경기(안타·사사구 어느 쪽이든) */
  onBase: Streak;
  /** ⚠**연속 무안타 경기.** 좋은 기록이 아니지만 「지금 어떤 상태인가」를 말하려면 필요하다 */
  hitless: Streak;
  /** 센 경기 수. **분모다**(M2) */
  games: number;
  /**
   * 이 선수가 **마지막으로 나온 경기일**. 없으면 null.
   *
   * ⚠**「지금 이어지는 중」이 언제 기준인지 말하려면 이게 필요하다.** 5월 22일 이후
   * 출장이 없는 선수의 `current`는 5월 22일 값 그대로인데, 화면이 그걸 「今」이라고 쓰면
   * 석 달 전에 끝난 기록이 지금 이어지는 것처럼 보인다.
   * (2026-08-16 이중 검토에서 배포물의 21명이 그 상태로 확인됐다.)
   */
  lastGameDate: string | null;
}

/** 마루 하나. **시즌 넘김 화면이 필요로 하는 사실을 전부 담는다** */
export interface CareerStreak {
  /** 길이(경기) */
  length: number;
  /** 마루의 첫·마지막 경기일 */
  from: string;
  to: string;
  /**
   * 마루 안에 **사건이 있던 시즌**(오름차순 · 중복 없음).
   * ⚠**건너뛴 시즌은 여기 없다 — 그래서 보인다**(荻野의 36경기는 2019-09-13 ~ 2020-07-19 로
   * 10개월이 비어 있다. **날짜만 보이면 그 공백이 안 보인다**).
   */
  seasons: readonly number[];
  /**
   * 마루가 **훑은 범위의 첫 사건**에서 시작한다 = 그 앞을 우리가 안 봤다 → **「N試合以上」**.
   * ⚠**「2017」을 어디에도 박지 마라** — `fromSeason − 1` 에서 유도한다(사용자 결정 ⑵).
   */
  atRangeStart: boolean;
  /**
   * 마루 뒤에 사건이 없다 = 아직 안 끊겼다.
   * ⚠**「継続中」이 아니다** — 세 상태의 판정은 화면 몫이다(정의서 §1-5).
   */
  open: boolean;
}

export interface CareerStreakPair {
  /** 지금 이어지고 있는 마루. 마지막 경기에서 끊겼으면 `null`(0 아님 · M11) */
  current: CareerStreak | null;
  /** 가장 긴 마루. 동률이면 **나중 구간** */
  best: CareerStreak | null;
}

export interface CareerBattingStreaks {
  playerId: string;
  /** 連続試合安打 */
  hitting: CareerStreakPair;
  /** 連続試合出塁 */
  onBase: CareerStreakPair;
  /**
   * 훑은 경기 수(**타석이 있던 경기**). **분모다**(M2).
   * ⚠**시즌 값을 그대로 쓰면 분모가 마루보다 작아지는 화면이 나온다** — 여기는 **전 범위**로 다시 센다.
   */
  games: number;
  /** 훑은 범위 — 화면이 「2018〜2026年」이라고 말할 근거다(M2 의 셋째 분모) */
  fromSeason: number;
  toSeason: number;
  /** 훑은 대회. ⚠**화면이 「レギュラーシーズンのみ」라고 말해야 한다** */
  competition: string;
  lastGameDate: string | null;
}

/** 훑을 범위. ⚠**시즌 모드(`fromSeason === toSeason`)와 통산 모드가 같은 코드를 탄다**(M1) */
export interface BattingStreakScope {
  competition?: string;
  through?: string;
  fromSeason: number;
  /**
   * **보고 있는 시즌**. ⚠**미래 시즌을 과거 화면에 싣지 않는다** —
   * 「통산의 끝은 언제나 보고 있는 시즌」(CLAUDE.md §2-2). 2022년 화면이 2023년을 말하지 않는다.
   */
  toSeason: number;
}

const EMPTY: Streak = {
  current: 0,
  currentFrom: null,
  currentTo: null,
  best: 0,
  bestFrom: null,
  bestTo: null,
};
const DEFAULT_COMPETITION = "regular";
const DEFAULT_THROUGH = "9999-12-31";

interface Event {
  date: string;
  season: number;
  hit: boolean;
}

/**
 * 참이 연속된 **극대 구간**을 시간순으로 뽑는다. **마루 정의의 한 벌**(M1).
 *
 * ⚠**`streakOf` 와 통산 계산이 같은 함수를 쓴다.** 갈라 두면 규칙이 두 벌이 되고
 * 어느 날 시즌 화면과 통산 화면이 다른 답을 낸다.
 *
 * @param events 시간순(경기일 → `game_no`). **건너뛸 경기는 부르는 쪽에서 이미 뺐다**
 */
function marusOf(events: readonly Event[]): CareerStreak[] {
  const out: CareerStreak[] = [];
  let i = 0;
  while (i < events.length) {
    if (!events[i]!.hit) {
      i += 1;
      continue;
    }
    let j = i;
    const seasons: number[] = [];
    while (j < events.length && events[j]!.hit) {
      if (seasons.at(-1) !== events[j]!.season) seasons.push(events[j]!.season);
      j += 1;
    }
    out.push({
      length: j - i,
      from: events[i]!.date,
      to: events[j - 1]!.date,
      seasons,
      atRangeStart: i === 0,
      open: j === events.length,
    });
    i = j;
  }
  return out;
}

/**
 * 경기별 참/거짓 나열에서 연속 길이를 센다.
 *
 * ⚠**같은 길이면 나중 구간을 남긴다.** 지금 이어지는 기록이 최장과 동률일 때 앞 구간의 날짜가
 * 남으면, 독자는 지금의 기록이 그때 시작했다고 읽는다.
 */
function streakOf(events: readonly Event[]): Streak {
  const marus = marusOf(events);
  let best: CareerStreak | null = null;
  for (const m of marus) if (best === null || m.length >= best.length) best = m;
  const last = marus.at(-1);
  // ⚠**「지금」의 양 끝은 `best` 가 아니라 이 마루에서 나온다** — 둘은 다른 구간이다
  const open = last !== undefined && last.open ? last : null;
  return {
    current: open?.length ?? 0,
    currentFrom: open?.from ?? null,
    currentTo: open?.to ?? null,
    best: best?.length ?? 0,
    bestFrom: best?.from ?? null,
    bestTo: best?.to ?? null,
  };
}

/** 마루 목록 → 「지금」과 「최장」. 동률이면 **나중 구간** */
function pairOf(events: readonly Event[]): CareerStreakPair {
  const marus = marusOf(events);
  let best: CareerStreak | null = null;
  for (const m of marus) if (best === null || m.length >= best.length) best = m;
  const last = marus.at(-1);
  return { current: last !== undefined && last.open ? last : null, best };
}

/**
 * ⚠**타석이 없는 경기는 세지 않는다.** 박스스코어에 이름은 있는데 타석이 0인 경우
 * (대주자·수비 교대)를 「무안타 경기」로 세면 연속 안타가 억울하게 끊긴다.
 * ⚠**이것은 공인야구규칙 9.23(b) 의 【注】이기도 하다** — 「打席がこないうちに試合が終わった場合」과
 * 「打席に入ったが打撃を完了できなかった場合」은 기록을 중단시키지 않는다. `HAVING SUM(b.pa) > 0`
 * 이 첫 경우를 정확히 제외하고, 두 번째 경우도 박스의 `打席` 에 안 들어오므로 자동으로 만족된다.
 * ⚠**【注】는 `skipsForStreak` 와 별개 조문이다** — 그쪽은 (b) **본문**(사사구·희생번트·방해로만
 * 끝낸 경기)이고 이쪽은 **타석 자체가 성립 안 한 경우**다. **둘 다 맞는데 근거가 하나만 적혀 있었다.**
 *
 * ⚠**「경기」로 묶는다. 「날짜」로 묶으면 더블헤더가 한 경기가 된다.**
 *
 * 날짜로 묶으면 1차전 무안타·2차전 안타인 날이 「안타 있는 날」이 되어, **끊겼어야 할
 * 연속 안타가 이어진 것으로 계산된다.** 값이 그럴듯하게 커질 뿐이라 눈으로는 발견되지 않는다.
 * (2026-08-16 이중 검토에서 지적. 보유 9시즌 정규 **7,651경기 전수에서 더블헤더 0건**이라
 * 아직 틀린 값을 낸 적은 없지만, 첫 더블헤더에 조용히 터진다.)
 *
 * ⚠**정렬은 날짜 → 경기 번호 순이다.** 같은 날 두 경기의 순서는 `game_no`가 정한다.
 * ⚠**시즌 범위는 `BETWEEN` 이다** — 시즌 모드는 양쪽에 같은 값이 들어와 `=` 와 같은 집합이 된다.
 */
const SQL = `
SELECT b.player_id AS playerId,
       b.game_id AS gameId,
       g.game_date AS date,
       g.season AS season,
       SUM(b.h) AS hits,
       SUM(b.h + b.bb + b.hbp) AS onBase,
       SUM(b.pa) AS pa,
       -- ⚠**공인야구규칙 9.23(b)를 판정하려면 타수와 희생플라이가 필요하다.**
       -- 타석은 있는데 타수도 犠飛 도 0 이면 「사사구·희생번트·방해로만 끝난 경기」다.
       SUM(b.ab) AS ab,
       SUM(b.sf) AS sf
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
WHERE g.season BETWEEN ? AND ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
GROUP BY b.player_id, b.game_id
HAVING SUM(b.pa) > 0
ORDER BY b.player_id, g.game_date, g.game_no
`;

/**
 * **이 경기는 연속 기록을 끊는가 — 공인야구규칙 9.23(b) 본문.**
 *
 * 규칙: 「타자가 그 경기에서 **사사구·희생번트·타격방해·주자방해로만** 끝냈다면
 * 그 경기는 연속안타 기록을 끊지 않는다」 — 「없던 것」으로 친다.
 *
 * ⚠**`sf`(犠飛)를 반드시 본다.** 규칙은 희생플라이가 있으면 **중단된다**고 명시한다.
 * ⚠**`ab=0` 만 보면 틀린다** — 희생번트·희생플라이는 둘 다 타수에 안 들어가기 때문이다.
 * ⚠**타격방해는 우리 스키마에 열이 없다.** 그러나 실측상 항등식
 * `pa = ab + bb + hbp + sh + sf` 가 **211,844/211,862 행**에서 성립하고, 깨진 18행이
 * 전부 타격방해다 — 그만큼 그것도 `ab=0` 으로 떨어진다(2026-08-21 실측).
 */
function skipsForStreak(g: { pa: number; ab: number; sf: number; hits: number }): boolean {
  return g.pa > 0 && g.ab === 0 && g.sf === 0 && g.hits === 0;
}

interface Row {
  playerId: string;
  gameId: string;
  date: string;
  season: number;
  hits: number;
  onBase: number;
  pa: number;
  ab: number;
  sf: number;
}

interface Game {
  date: string;
  season: number;
  hits: number;
  onBase: number;
  skip: boolean;
}

/** SQL 을 돌려 선수별 경기 열을 만든다. **시즌 모드와 통산 모드가 공유하는 한 벌**(M1) */
function scan(db: Db, scope: Required<BattingStreakScope>): Map<string, Game[]> {
  const rows = db.raw
    .prepare(SQL)
    .all(scope.fromSeason, scope.toSeason, scope.competition, scope.through) as unknown as Row[];

  // ⚠한 칸이 한 **경기**다. 더블헤더면 같은 날짜가 두 칸 들어온다
  const byPlayer = new Map<string, Game[]>();
  for (const r of rows) {
    const g: Game = {
      date: r.date,
      season: Number(r.season),
      hits: r.hits,
      onBase: r.onBase,
      skip: skipsForStreak(r),
    };
    const list = byPlayer.get(r.playerId);
    if (list === undefined) byPlayer.set(r.playerId, [g]);
    else list.push(g);
  }
  return byPlayer;
}

const events = (games: readonly Game[], hit: (g: Game) => boolean, skip: boolean): Event[] =>
  games
    .filter((g) => (skip ? !g.skip : true))
    .map((g) => ({ date: g.date, season: g.season, hit: hit(g) }));

/**
 * **시즌 안**의 연속 기록. ⚠**시그니처를 바꾸지 않는다** — 화면이 이미 이 모양으로 쓴다.
 *
 * ⚠**결과는 통산 코어와 같은 함수(`marusOf`)에서 나온다** — 규칙이 두 벌이 되지 않게(M1).
 */
export function battingStreaks(
  db: Db,
  season: number,
  competition = DEFAULT_COMPETITION,
  through = DEFAULT_THROUGH,
): Map<string, PlayerStreaks> {
  const byPlayer = scan(db, { fromSeason: season, toSeason: season, competition, through });

  const out = new Map<string, PlayerStreaks>();
  for (const [playerId, games] of byPlayer) {
    out.set(playerId, {
      playerId,
      // ⚠**기록을 끊지 않는 경기는 뺀다** — 「무안타」로 넣는 것과 다르다(9.23(b)).
      hitting: streakOf(events(games, (g) => g.hits > 0, true)),
      onBase: streakOf(events(games, (g) => g.onBase > 0, true)),
      // ⚠**連続試合無安打에는 적용하지 않는다.** 예외는 「기록을 지켜 주는」 규칙이라
      //   반대 부호의 기록에 갖다 붙이면 무안타 행진이 이유 없이 **길어진다.**
      hitless: streakOf(events(games, (g) => g.hits === 0, false)),
      games: games.length,
      lastGameDate: games.at(-1)?.date ?? null,
    });
  }
  return out;
}

/**
 * **시즌을 넘는** 연속 기록.
 *
 * ⚠**「通算」이라고만 쓰면 거짓이다** — 이 값은 `fromSeason`〜`toSeason` **범위 안**의 통산이고,
 * NPB 가 공표하는 `通算成績` 은 그 선수의 실제 전 경력이다. **화면이 범위를 말해야 한다.**
 * ⚠**`連続試合無安打` 는 없다** — 머리주석 참조(정의서 §4-4 · §6-7 사용자 결정 대기).
 */
export function careerBattingStreaks(
  db: Db,
  scope: BattingStreakScope,
): Map<string, CareerBattingStreaks> {
  const full: Required<BattingStreakScope> = {
    competition: scope.competition ?? DEFAULT_COMPETITION,
    through: scope.through ?? DEFAULT_THROUGH,
    fromSeason: scope.fromSeason,
    toSeason: scope.toSeason,
  };
  const byPlayer = scan(db, full);

  const out = new Map<string, CareerBattingStreaks>();
  for (const [playerId, games] of byPlayer) {
    out.set(playerId, {
      playerId,
      hitting: pairOf(events(games, (g) => g.hits > 0, true)),
      onBase: pairOf(events(games, (g) => g.onBase > 0, true)),
      games: games.length,
      fromSeason: full.fromSeason,
      toSeason: full.toSeason,
      competition: full.competition,
      lastGameDate: games.at(-1)?.date ?? null,
    });
  }
  return out;
}

/** 등판이 없는 선수를 위한 빈 값. ⚠0과 「없음」을 섞지 않기 위해 호출자가 명시적으로 쓴다 */
export function emptyStreaks(playerId: string): PlayerStreaks {
  return { playerId, hitting: EMPTY, onBase: EMPTY, hitless: EMPTY, games: 0, lastGameDate: null };
}
