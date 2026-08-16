/**
 * 연속 기록 — 연속 안타·연속 출루·연속 무안타.
 *
 * ⚠**「지금 이어지고 있는가」와 「올해 가장 길었는가」는 다른 값이다.** 둘을 같은 칸에 쓰면
 * 어제 끊긴 기록이 오늘도 이어지는 것처럼 보인다. 그래서 항상 **둘 다** 낸다.
 *
 * ⚠**시즌 경계를 넘기지 않는다**(§2-1). 그리고 소급 범위가 2시즌뿐이라
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
      if (current > best) {
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
 */
const SQL = `
SELECT b.player_id AS playerId,
       g.game_date AS date,
       SUM(b.h) AS hits,
       SUM(b.h + b.bb + b.hbp) AS onBase,
       SUM(b.pa) AS pa
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
GROUP BY b.player_id, g.game_date
HAVING SUM(b.pa) > 0
ORDER BY b.player_id, g.game_date
`;

export function battingStreaks(
  db: Db,
  season: number,
  competition = "regular",
  through = "9999-12-31",
): Map<string, PlayerStreaks> {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    playerId: string;
    date: string;
    hits: number;
    onBase: number;
    pa: number;
  }[];

  const byPlayer = new Map<string, { date: string; hits: number; onBase: number }[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.playerId);
    if (list === undefined) byPlayer.set(r.playerId, [{ date: r.date, hits: r.hits, onBase: r.onBase }]);
    else list.push({ date: r.date, hits: r.hits, onBase: r.onBase });
  }

  const out = new Map<string, PlayerStreaks>();
  for (const [playerId, days] of byPlayer) {
    out.set(playerId, {
      playerId,
      hitting: streakOf(days.map((d) => ({ date: d.date, hit: d.hits > 0 }))),
      onBase: streakOf(days.map((d) => ({ date: d.date, hit: d.onBase > 0 }))),
      hitless: streakOf(days.map((d) => ({ date: d.date, hit: d.hits === 0 }))),
      games: days.length,
    });
  }
  return out;
}

/** 등판이 없는 선수를 위한 빈 값. ⚠0과 「없음」을 섞지 않기 위해 호출자가 명시적으로 쓴다 */
export function emptyStreaks(playerId: string): PlayerStreaks {
  return { playerId, hitting: EMPTY, onBase: EMPTY, hitless: EMPTY, games: 0 };
}
