/**
 * **최신 시즌의 개막 초기 창 — 한 벌**(2026-10-25 · PR-4 완화 검토 P2) — 시험 전용 헬퍼.
 *
 * `season-games`(12팀)와 `venues-db`(12구단 · 본거지 판정)는 새 시즌 개막 직후에만 **시즌 크기에 기대는 하한**을 늦춘다
 * (개막일 1경기 · 개막 시리즈를 제2 구장에서 치르는 구단 — 늦추지 않으면 개막 2~15경기일째 daily 「시험」이 배포를 막았다).
 * **늦추는 조건을 이 파일 하나가 정한다** — 두 시험이 따로 정하면 한쪽만 고쳐진다(M1).
 *
 * ## ⚠「진행 중」을 데이터의 완결성으로 추정하지 않는다
 *
 * 앞 판은 「최신 시즌이 아직 덜 찼는가」(정규 실시 경기 < 6 × 시즌 경기수 · 12구단이 다 시즌 경기수를 치르지 않음)로 늦췄다.
 * **그 판정은 순환한다** — 끝난 최신 시즌에서 **한 구단의 경기가 통째로 빠지면** 그 결손이 곧 「덜 찼다」가 되어
 * 1~12구단을 받아 줬다. 다음 시즌 개막까지(4~5개월) 못 잡고, 그때 개막일 배포를 막는 모양으로 터진다.
 * → **경기일 수**(그 시즌 정규시즌 실시 경기의 서로 다른 날짜 수)로 가른다. 한 구단이 빠져도 다른 구단의 날짜가 남으므로
 *   창이 저절로 열리지 않는다(끝난 시즌은 136~172경기일).
 *
 * ## ⚠30 의 근거 — `node scripts/venue-measure.ts <db> --opening`(⑥ · 보유 9시즌 2018~2026 · 같은 경기일 단위)
 *
 * | 무엇이 서는 날 | 최대 경기일 |
 * |---|---|
 * | 12구단이 다 나온다(홈·원정 — `season-games`) | 2(2023 · 1경기 개막) |
 * | 12구단이 다 홈경기를 치렀다(`venues-db` 의 12구단) | 18(2020) |
 * | 본거지 판정(미루기 없음)이 마지막으로 떨어진다 | 18(2018) |
 *
 * → 최대 18 에 여유 12. 그리고 **제2 구장 개막 카드가 둘(6경기)인 해**(보유 9시즌에는 없다)가 와도 본거지가 과반이 되는
 *   홈 13번째 경기가 2026 일정으로 30경기일 무렵이다 — `venues-db` 의 판정 하한 13 과 같은 여유를 창 끝까지 준다.
 * ⚠**대가**: 창 안(개막 ~ 30경기일 · 약 5주)에는 최신 시즌에서 구단이 통째로 빠져도 이 두 시험이 안 잡는다 —
 *   31경기일째에 붉어진다(앞 판은 다음 시즌 개막까지였다). 창을 넓히면 이 구멍이 같이 넓어진다.
 */
import type { DatabaseSync } from "node:sqlite";

export const OPENING_WINDOW_GAME_DAYS = 30;

export interface NewestSeasonWindow {
  /** DB 의 최신 정규시즌(실시 경기가 있는 시즌) */
  readonly newest: number;
  /** 그 시즌의 정규시즌 실시 경기일 수(서로 다른 `game_date`) */
  readonly gameDays: number;
  /** 개막 초기 창 안인가(`gameDays ≤ OPENING_WINDOW_GAME_DAYS`) */
  readonly opening: boolean;
}

/** DB 의 최신 정규시즌과 그 경기일 수 — **판정은 이것 하나**다. 실시 경기가 하나도 없으면 던진다(공회전 금지) */
export function newestSeasonWindow(db: DatabaseSync): NewestSeasonWindow {
  const r = db
    .prepare(
      `SELECT season, COUNT(DISTINCT game_date) AS days FROM game
        WHERE competition = 'regular' AND status = 'played'
        GROUP BY season ORDER BY season DESC LIMIT 1`,
    )
    .get() as { season: number; days: number } | undefined;
  if (r === undefined) throw new Error("정규시즌 실시 경기가 하나도 없다 — 개막 초기 창을 판정할 수 없다");
  const gameDays = Number(r.days);
  return { newest: Number(r.season), gameDays, opening: gameDays <= OPENING_WINDOW_GAME_DAYS };
}
