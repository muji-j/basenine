/**
 * 도루 성적.
 *
 * ⚠**이 값의 존재 이유는 분모다**(M2). 박스스코어는 `盗塁` 만 주므로 지금까지 화면은
 * 「30도루」라고만 말할 수 있었다 — 40번 시도해서 30번 성공한 것과 33번 시도해서
 * 30번 성공한 것이 같은 표시가 된다. 도루자(盗塁刺)는 §2-2 카탈로그 항목이면서
 * **타석 로그가 유일한 출처**다.
 *
 * ## 대조 실측 (2026-08-17)
 *   · 경기별 도루 수 대 박스스코어 `盗塁` 열: **2,395경기 중 어긋남 0건**(2024〜2026)
 *   · 2026 정규시즌 합계: 도루 611 = 공표 611 · 도루자 254 = 공표 `盗塁刺` 254
 */
import type { Db } from "@bb-app/store";

export interface StealLine {
  playerId: string;
  displayName: string;
  teamCode: string;
  /** 도루 성공 */
  sb: number;
  /** 도루자(盗塁刺) */
  cs: number;
  /**
   * 견제사. ⚠**도루 기도에 넣지 않는다** — NPB 기록에서 견제사는 盗塁刺가 아니다.
   * 넣으면 성공률의 분모가 부풀어 전 선수의 성공률이 실제보다 낮게 나온다.
   */
  pickoff: number;
}

/**
 * ⚠**대회를 섞지 않는다**(§2-1). 실측으로 이 경계가 값을 갈랐다 — 올스타를 넣으면
 * 2026 도루가 611이 아니라 620이 되어 공표값과 9 어긋난다.
 * ⚠**주자의 소속은 공격 측이다** — 표(top)면 원정, 리(bottom)면 홈.
 */
const SQL = `
SELECT r.runner_id AS playerId, p.display_name AS displayName,
       CASE r.half WHEN 'top' THEN g.away_code ELSE g.home_code END AS teamCode,
       r.kind AS kind
FROM runner_event r
JOIN game g ON g.game_id = r.game_id
JOIN player p ON p.player_id = r.runner_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
`;

/** 도루 기도 = 성공 + 도루자. **견제사는 들어가지 않는다** */
export function attempts(l: Pick<StealLine, "sb" | "cs">): number {
  return l.sb + l.cs;
}

/**
 * 도루 성공률. ⚠**기도가 0이면 null이다** — 0/0을 `.000`으로 내면
 * 「한 번도 안 뛴 선수」가 「뛰었지만 다 실패한 선수」와 같아진다(M11).
 */
export function successRate(l: Pick<StealLine, "sb" | "cs">): number | null {
  const n = attempts(l);
  return n === 0 ? null : l.sb / n;
}

/** 한 시즌의 선수별 도루 성적 */
export function steals(db: Db, season: number, competition: string, through: string): StealLine[] {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    playerId: string; displayName: string; teamCode: string; kind: string;
  }[];

  const out = new Map<string, StealLine>();
  for (const r of rows) {
    /**
     * ⚠**선수당 한 벌이다**(팀을 키에 넣으면 이적 선수가 반씩 나뉜다).
     *
     * 팀 코드는 **처음 본 것**이 그대로 남는다 — 엔트리를 만들 때 한 번만 넣고 갱신하지 않는다.
     * ⚠**「마지막에 본 것을 쓴다」고 적혀 있었는데 그건 사실이 아니었다**(2026-08-20).
     * 코드가 그렇게 동작한 적이 없고(아래 `if (e === undefined)` 안에서만 넣는다),
     * `SQL` 에 `ORDER BY` 도 없어서 **애초에 「마지막」이라는 것이 정의되지 않는다.**
     * 지금은 무해하다 — 웹 계층이 `playerId` 로만 다시 묶어 쓰기 때문이다.
     * ⚠**다음 사람이 이 주석을 믿고 「이적 후 팀이 나온다」고 가정하면 틀린다.**
     * 시즌 중 이적한 선수의 표시 팀을 이 값으로 정하려면 `ORDER BY` 부터 넣어야 한다.
     */
    let e = out.get(r.playerId);
    if (e === undefined) {
      e = { playerId: r.playerId, displayName: r.displayName, teamCode: r.teamCode, sb: 0, cs: 0, pickoff: 0 };
      out.set(r.playerId, e);
    }
    if (r.kind === "steal") e.sb += 1;
    else if (r.kind === "caughtStealing") e.cs += 1;
    else if (r.kind === "pickoff") e.pickoff += 1;
    else {
      // ⚠**모르는 종류가 오면 멈춘다**(M7). 조용히 흘리면 성공률이 서서히 틀려진다
      throw new RangeError(`모르는 주자 사건 종류 ${r.kind}`);
    }
  }
  return [...out.values()];
}
