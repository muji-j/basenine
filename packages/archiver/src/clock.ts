/**
 * 주입 가능한 시계 (CLAUDE.md M6).
 *
 * ⚠이 파일이 `new Date()`를 직접 부르는 **유일한 곳**이다.
 * 다른 어디에서도 `new Date()` / `Date.now()`를 직접 부르지 마라 —
 * 한 처리 안에서 시계를 두 번 읽으면 자정 경계에서 날짜가 어긋난다.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  // eslint-disable-next-line no-restricted-syntax -- 시계 구현체 본체
  now: () => new Date(),
};

/** 테스트용 고정 시계. */
export function fixedClock(iso: string): Clock {
  const at = new Date(iso);
  return { now: () => new Date(at.getTime()) };
}

/**
 * JST 기준 `YYYY-MM-DD`.
 * NPB의 경기일은 JST로만 의미가 있다. 로컬 타임존에 의존하면 서버에서 다르게 돈다.
 */
export function toJstDateString(at: Date): string {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
