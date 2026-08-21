/**
 * 연속 기록 — 연속 안타·연속 출루·연속 무안타.
 *
 * ⚠**「지금 이어지고 있는가」와 「올해 가장 길었는가」는 다른 값이다.** 둘을 같은 칸에 쓰면
 * 어제 끊긴 기록이 오늘도 이어지는 것처럼 보인다. 그래서 항상 **둘 다** 낸다.
 *
 * ⚠**시즌 경계를 넘기지 않는다**(§2-1). 보유 시즌이 늘어도 마찬가지다 —
 * 「통산」이라는 말을 쓰지 않는다 — 2025년 이전이 없는데 통산이라고 하면 거짓말이 된다.
 *
 * ⚠**연속 안타는 「경기」 단위, 연속 출루도 「경기」 단위다**(NPB·MLB 관례).
 * 타석 단위로 세면 훨씬 짧은 수가 나오고, 사람들이 아는 그 기록이 아니게 된다.
 * 대신 「그 경기에 타석이 있었는가」로 경기를 세므로, **대주자로만 나온 경기는 세지 않는다.**
 */
import type { Db } from "@bb-app/store";

export interface Streak {
  /** 지금 이어지고 있는 길이. 마지막 경기에서 끊겼으면 0 */
  current: number;
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

const EMPTY: Streak = { current: 0, best: 0, bestFrom: null, bestTo: null };

/**
 * 경기별 참/거짓 나열에서 연속 길이를 센다.
 *
 * @param days 경기일 오름차순
 */
function streakOf(days: readonly { date: string; hit: boolean }[]): Streak {
  let current = 0;
  let best = 0;
  let from: string | null = null;
  let bestFrom: string | null = null;
  let bestTo: string | null = null;

  for (const d of days) {
    if (d.hit) {
      if (current === 0) from = d.date;
      current += 1;
      // ⚠**같은 길이면 나중 구간으로 갱신한다**(`>=`). 지금 이어지는 기록이 최장과 동률일 때
      // 앞 구간의 날짜가 남으면, 독자는 지금의 기록이 그때 시작했다고 읽는다
      if (current >= best) {
        best = current;
        bestFrom = from;
        bestTo = d.date;
      }
    } else {
      current = 0;
      from = null;
    }
  }
  return { current, best, bestFrom, bestTo };
}

/**
 * ⚠**타석이 없는 경기는 세지 않는다.** 박스스코어에 이름은 있는데 타석이 0인 경우
 * (대주자·수비 교대)를 「무안타 경기」로 세면 연속 안타가 억울하게 끊긴다.
 * NPB·MLB의 관례도 같다.
 *
 * ⚠**「경기」로 묶는다. 「날짜」로 묶으면 더블헤더가 한 경기가 된다.**
 *
 * 날짜로 묶으면 1차전 무안타·2차전 안타인 날이 「안타 있는 날」이 되어, **끊겼어야 할
 * 연속 안타가 이어진 것으로 계산된다.** 값이 그럴듯하게 커질 뿐이라 눈으로는 발견되지 않는다.
 * (2026-08-16 이중 검토에서 지적. 2025~2026 정규시즌에 더블헤더가 **0건**이라 아직
 * 틀린 값을 낸 적은 없지만, 첫 더블헤더에 조용히 터진다.)
 *
 * ⚠**정렬은 날짜 → 경기 번호 순이다.** 같은 날 두 경기의 순서는 `game_no`가 정한다.
 */
const SQL = `
SELECT b.player_id AS playerId,
       b.game_id AS gameId,
       g.game_date AS date,
       SUM(b.h) AS hits,
       SUM(b.h + b.bb + b.hbp) AS onBase,
       SUM(b.pa) AS pa,
       -- ⚠**공인야구규칙 9.23(b)를 판정하려면 타수와 희생플라이가 필요하다.**
       -- 타석은 있는데 타수도 犠飛 도 0 이면 「사사구·희생번트·방해로만 끝난 경기」다.
       SUM(b.ab) AS ab,
       SUM(b.sf) AS sf
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
GROUP BY b.player_id, b.game_id
HAVING SUM(b.pa) > 0
ORDER BY b.player_id, g.game_date, g.game_no
`;

/**
 * **이 경기는 연속 기록을 끊는가 — 공인야구규칙 9.23(b).**
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

export function battingStreaks(
  db: Db,
  season: number,
  competition = "regular",
  through = "9999-12-31",
): Map<string, PlayerStreaks> {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    playerId: string;
    gameId: string;
    date: string;
    hits: number;
    onBase: number;
    pa: number;
    ab: number;
    sf: number;
  }[];

  // ⚠한 칸이 한 **경기**다. 더블헤더면 같은 날짜가 두 칸 들어온다
  const byPlayer = new Map<string, { date: string; hits: number; onBase: number; skip: boolean }[]>();
  for (const r of rows) {
    const g = { date: r.date, hits: r.hits, onBase: r.onBase, skip: skipsForStreak(r) };
    const list = byPlayer.get(r.playerId);
    if (list === undefined) byPlayer.set(r.playerId, [g]);
    else list.push(g);
  }

  const out = new Map<string, PlayerStreaks>();
  for (const [playerId, games] of byPlayer) {
    out.set(playerId, {
      playerId,
      // ⚠**기록을 끊지 않는 경기는 뺀다** — 「무안타」로 넣는 것과 다르다(9.23(b)).
      hitting: streakOf(games.filter((d) => !d.skip).map((d) => ({ date: d.date, hit: d.hits > 0 }))),
      onBase: streakOf(games.filter((d) => !d.skip).map((d) => ({ date: d.date, hit: d.onBase > 0 }))),
      // ⚠**連続無安打에는 적용하지 않는다.** 예외는 「기록을 지켜 주는」 규칙이라
      //   반대 부호의 기록에 갖다 붙이면 무안타 행진이 이유 없이 **길어진다.**
      hitless: streakOf(games.map((d) => ({ date: d.date, hit: d.hits === 0 }))),
      games: games.length,
      lastGameDate: games.at(-1)?.date ?? null,
    });
  }
  return out;
}

/** 등판이 없는 선수를 위한 빈 값. ⚠0과 「없음」을 섞지 않기 위해 호출자가 명시적으로 쓴다 */
export function emptyStreaks(playerId: string): PlayerStreaks {
  return { playerId, hitting: EMPTY, onBase: EMPTY, hitless: EMPTY, games: 0, lastGameDate: null };
}
