/**
 * **정정 자동 재수집의 후보 조회 — DB 읽기 전용**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D5).
 *
 * 결함 키 하나(팀 · 역할 · 선수 · 항목 · 방향)를 **그 차이를 만들 수 있는 경기**로 바꾼다(키당 한 번 · M-E 실측 1ms · 새 색인 불필요):
 *
 * ```sql
 * SELECT g.game_id, g.game_date, g.fetched_at, <경기 값 식> AS value
 * FROM <batting_line|pitching_line> x JOIN game g ON g.game_id = x.game_id
 * WHERE <crosscheckScope("x")>            -- 시즌 · played · 대회 · game_date ≤ 기준일 · 그 팀 쪽
 *   AND x.player_id = ?
 *   AND (<o>p 이면 그 항목의 술어 · o<p 이면 1 = 1>)
 * ORDER BY g.game_date DESC, g.game_id
 * ```
 *
 * ⚠**선수는 ID 로만 잇는다**(M10) — 이름은 이 파일에 한 번도 나오지 않는다. 동명이인·표기 흔들림이 다른 선수의 경기를 끌어오지 않는다.
 * ⚠**범위 조각은 외부 대조(`crosscheck.ts`)의 두 SQL 과 한 벌이다**(M1 · `crosscheckScope` · `crosscheckScopeParams`) —
 *   「도구가 센 경기」와 「다시 받는 경기」가 갈리지 않는다. 「그 팀 쪽」 조건이 이적한 선수를 팀마다 가른다(설계 M-D).
 * ⚠**경기 값 식과 술어도 닫힌 표(`CROSSCHECK_FIELDS`)의 것을 그대로 쓴다** — 여기서 칼럼 이름을 다시 적지 않는다.
 * ⚠**읽기 전용으로 연다**(`node:sqlite` `readOnly`) — `openDb` 는 마이그레이션을 적용해 파일을 바꾸므로 쓰지 않는다.
 *   없는 파일은 만들지 않고 던진다(→ 진입점이 「계획 실패」 · 종료 1). 한 연결의 질의는 **한 읽기 트랜잭션**에서 같은 스냅숏을 본다.
 * ⚠**import 만으로는 아무것도 하지 않는다** — DB 를 여는 것은 `openCandidateDb` 를 부를 때뿐이다.
 * ⚠**잎만 가져온다** — `@bb-app/aggregate/crosscheck-fields`(import 0) · `node:sqlite` · 순수 모듈의 타입.
 */
import { DatabaseSync } from "node:sqlite";
import { CROSSCHECK_FIELDS, crosscheckScope, crosscheckScopeParams } from "@bb-app/aggregate/crosscheck-fields";
import type { CrosscheckKind, CrosscheckTargetField } from "@bb-app/aggregate/crosscheck-fields";
import type { AfterValue, CandidateQuery, CandidateRow, Direction, ValueQuery } from "./correction-plan.ts";

/** 열린 읽기 전용 DB — 쓰고 나면 `close()` 로 닫는다(읽기 트랜잭션을 끝낸다) */
export interface CandidateDb {
  candidates(q: CandidateQuery): CandidateRow[];
  /** 그 경기·선수의 항목 값. 행이 없으면 `found: false`(M11 — 「행 없음」과 값 NULL 을 가른다) */
  valueIn(q: ValueQuery): AfterValue;
  close(): void;
}

function tableOf(kind: CrosscheckKind): "batting_line" | "pitching_line" {
  return kind === "batting" ? "batting_line" : "pitching_line";
}

/** 재수집 대상 행 — 아니면 던진다(대상이 아닌 항목으로 경기를 찾는 것은 부르는 쪽의 결함이다) */
function target(kind: CrosscheckKind, field: string): CrosscheckTargetField {
  const row = CROSSCHECK_FIELDS.find((f) => f.kind === kind && f.field === field);
  if (row === undefined || !row.refetch) throw new Error(`재수집 대상 항목이 아니다: ${kind}/${field}`);
  return row;
}

/** 후보 조회 SQL — 위 머리말의 모양 그대로. 자리표시자는 범위 조각의 다섯 개 다음에 `player_id` 하나다 */
export function candidateSql(kind: CrosscheckKind, field: string, direction: Direction): string {
  const f = target(kind, field);
  return `SELECT g.game_id AS game_id, g.game_date AS game_date, g.fetched_at AS fetched_at, ${f.gameValue("x")} AS value
FROM ${tableOf(kind)} x JOIN game g ON g.game_id = x.game_id
WHERE ${crosscheckScope("x")}
  AND x.player_id = ?
  AND (${direction === "ours_more" ? f.oursMore("x") : f.oursLess("x")})
ORDER BY g.game_date DESC, g.game_id`;
}

/** 값 칸이 수·문자열·NULL 인가 — 아니면 스키마가 바뀐 것이다(M7) */
function cellValue(v: unknown, where: string): number | string | null {
  if (v === null || typeof v === "number" || typeof v === "string") return v;
  throw new Error(`${where}: 값이 수·문자열·NULL 이 아니다(${typeof v})`);
}

/** DB 가 준 행을 그대로 믿지 않는다 — 모양이 틀리면 던진다(M7) */
function asRow(r: Record<string, unknown>): CandidateRow {
  const { game_id, game_date, fetched_at, value } = r;
  if (typeof game_id !== "string" || typeof game_date !== "string" || (fetched_at !== null && typeof fetched_at !== "string")) {
    throw new Error(`후보 행의 모양이 틀렸다: ${JSON.stringify(r)}`);
  }
  return { game_id, game_date, fetched_at, value: cellValue(value, game_id) };
}

/**
 * 읽기 전용으로 열고 읽기 트랜잭션을 시작한다.
 * @throws 파일이 없거나 열 수 없으면 — 부르는 쪽(진입점)이 「DB 를 못 읽었다」(종료 1)로 센다(설계 D9 의 4)
 */
export function openCandidateDb(dbPath: string): CandidateDb {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    db.exec("BEGIN");
  } catch (e) {
    db.close();
    throw e;
  }
  let open = true;
  return {
    candidates(q) {
      const sql = candidateSql(q.kind, q.field, q.direction);
      const params = crosscheckScopeParams({ season: q.season, competition: q.competition, through: q.through, team: q.team });
      return (db.prepare(sql).all(...params, q.playerId) as Record<string, unknown>[]).map(asRow);
    },
    valueIn(q) {
      const f = target(q.kind, q.field);
      const row = db
        .prepare(`SELECT ${f.gameValue("x")} AS value FROM ${tableOf(q.kind)} x WHERE x.game_id = ? AND x.player_id = ?`)
        .get(q.gameId, q.playerId) as Record<string, unknown> | undefined;
      if (row === undefined) return { found: false };
      return { found: true, value: cellValue(row["value"], q.gameId) };
    },
    close() {
      if (!open) return;
      open = false;
      try {
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    },
  };
}
