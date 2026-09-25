/**
 * **옛 판이 새 판을 덮지 못하게 한다**(설계 `docs/superpowers/specs/2026-09-25-archive-load-version-guard-design.md` D1).
 *
 * ⚠**비교하는 값은 둘 다 「마지막으로 확인한 시각」이다.** 아카이브 쪽은 `fetchedAtOf`(사이드카의 `checkedAt ?? fetchedAt`),
 * DB 쪽 `game.fetched_at` 에는 적재기가 **바로 그 값**을 넣는다(`load-archive.ts` · `game-fetched-at.test.ts`).
 * ⚠**같은 시각은 진행한다** — 팀 코드 별칭 재정규화(`load.ts` 223-227행)는 같은 판을 다시 적재해 기존 행을 고치는 데 의존한다.
 * ⚠**판정은 쓰기 트랜잭션 안에서 다시 한다**(`writeGameGuarded`) — 사전 판정과 쓰기 사이에 다른 적재기가
 *   더 새 판을 넣어도 옛 판이 이기지 못한다. 시험 `version-guard.test.ts` 의 7a 가 그 위치를 고정한다.
 */
import type { Db } from "./db.ts";
import { normalizeFetchedAt } from "./meta.ts";

/**
 * 재수집 날짜의 상한. **L1 근거**다 — 하루 최대 6경기 × 4장 × 7일 = 168요청 ≈ 3초 간격 8.4분.
 * ⚠**여기가 유일한 정본이다**(M1) — `load-archive.ts` 의 복구 힌트 출력과 `scripts/date-window.ts` 의
 * `parseRefetchDates` 둘 다 이 값을 가져다 쓴다. 두 곳에 따로 적으면 하나만 고쳐졌을 때 어긋난다.
 */
export const MAX_REFETCH_DATES = 7;

export type VersionJudgement = "new" | "same-or-newer" | "stale" | "invalid-db";

export type GuardedWrite<T> =
  | { outcome: "written"; value: T }
  | { outcome: "stale" }
  | { outcome: "invalid-db" };

export function judgeVersion(db: Db, gameId: string, boxSeenAt: string): VersionJudgement {
  const box = normalizeFetchedAt(boxSeenAt);
  // ⚠호출자는 `fetchedAtOf` 의 결과(이미 정규화·검증됨)만 넘긴다. 아니면 호출자 결함이다
  if (box === null || box !== boxSeenAt) {
    throw new TypeError(`정규화되지 않은 취득 시각이다: ${JSON.stringify(boxSeenAt)} — fetchedAtOf 의 결과를 넘겨라`);
  }
  // ⚠**별칭(`AS f`) 없이 그대로 쓴다** — 7a 시험이 이 SELECT 를 정규식으로 탐지한다(`SELECT\s+fetched_at\s+FROM\s+game`).
  //   별칭을 붙이면 문면이 갈려 탐지가 안 된다(구현 중 실측). 의미는 같다.
  const row = db.raw.prepare("SELECT fetched_at FROM game WHERE game_id = ?").get(gameId) as
    | { fetched_at: unknown }
    | undefined;
  // ⚠`fetched_at` 은 NOT NULL 이라 SQL NULL 은 실제로 오지 않는다 — 방어 분기다(시험 불가)
  if (row === undefined || row.fetched_at === null) return "new";
  const dbSeen = normalizeFetchedAt(row.fetched_at);
  if (dbSeen === null) return "invalid-db";
  return Date.parse(box) < Date.parse(dbSeen) ? "stale" : "same-or-newer";
}

export function writeGameGuarded<T>(db: Db, gameId: string, boxSeenAt: string, write: () => T): GuardedWrite<T> {
  return db.transaction((): GuardedWrite<T> => {
    const v = judgeVersion(db, gameId, boxSeenAt);
    if (v === "stale") return { outcome: "stale" };
    if (v === "invalid-db") return { outcome: "invalid-db" };
    return { outcome: "written", value: write() };
  });
}
