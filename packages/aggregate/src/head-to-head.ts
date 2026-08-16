/**
 * 팀 대 팀 상대전적.
 *
 * ⚠**사이트 3,257장 중 0장이었다**(2026-08-16 확인). NPB 순위표를 보는 사람이 두 번째로
 * 찾는 표인데 없었고, 재료(`game` 테이블의 양 팀 코드와 득점)는 계속 있었다.
 *
 * ⚠**정규시즌만 센다**(§2-1). 포스트시즌을 섞으면 「阪神 15勝10敗」가 어느 규칙에도 속하지 않는 수가 된다.
 * ⚠**무승부를 승도 패도 아닌 자리에 둔다**(M11). 승률의 분모에서 빼는 것은 NPB 규정 그대로다.
 */
import type { Db } from "@bb-app/store";

export interface HeadToHead {
  /** 이 팀 */
  teamCode: string;
  /** 상대 팀 */
  opponentCode: string;
  w: number;
  l: number;
  t: number;
  /** 득점·실점. **이 팀 기준**이다 */
  runsFor: number;
  runsAgainst: number;
}

/** 경기 수. ⚠**승률의 분모가 아니다** — 무승부는 승률 분모에서 빠진다(NPB 규정) */
export function games(h: HeadToHead): number {
  return h.w + h.l + h.t;
}

const SQL = `
SELECT away_code AS away, home_code AS home, away_runs AS ar, home_runs AS hr
FROM game
WHERE season = ? AND competition = ? AND status = 'played' AND game_date <= ?
  AND away_runs IS NOT NULL AND home_runs IS NOT NULL
`;

/**
 * 한 시즌의 팀 대 팀 전적.
 *
 * ⚠**득점을 못 읽은 경기는 세지 않는다**(M11) — SQL이 `IS NOT NULL` 로 거른다.
 * 「0-0」으로 접으면 있지도 않은 무승부가 생긴다.
 * ⚠**한 경기가 두 줄이 된다**(양 팀 관점). 합쳐서 읽지 마라 — 각 줄이 「그 팀에서 본 전적」이다.
 */
export function headToHead(db: Db, season: number, competition: string, through: string): HeadToHead[] {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    away: string; home: string; ar: number; hr: number;
  }[];

  const out = new Map<string, HeadToHead>();
  const bump = (me: string, you: string, mine: number, yours: number): void => {
    const key = `${me}|${you}`;
    let e = out.get(key);
    if (e === undefined) {
      e = { teamCode: me, opponentCode: you, w: 0, l: 0, t: 0, runsFor: 0, runsAgainst: 0 };
      out.set(key, e);
    }
    e.runsFor += mine;
    e.runsAgainst += yours;
    if (mine > yours) e.w += 1;
    else if (mine < yours) e.l += 1;
    else e.t += 1;
  };
  for (const r of rows) {
    bump(r.away, r.home, r.ar, r.hr);
    bump(r.home, r.away, r.hr, r.ar);
  }
  return [...out.values()];
}
