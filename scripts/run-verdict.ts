/**
 * **`update.ts` 의 실행 판정** — 종료 0 / 75 / 1(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D5).
 *
 * ⚠**순수다 — 시계·I/O 없음.** 자식 실행과 사유 파일 읽기는 `collect-steps.ts` 가 하고, 여기는 그 결과로 가르기만 한다
 *   (`scripts/test/run-verdict.test.ts` 가 표 전수를 잰다).
 * ⚠**잎만 가져온다**(I1 · `refetch-wiring.test.ts`) — `update.ts` 가 이 모듈을 가져오므로 배럴을 끌면 수집이 시작되기도 전에 죽을 수 있다.
 *   가져오는 둘은 import 0 개인 잎이다: `archiver/src/upstream.ts`(75 의 정본) · `domain/src/collection-verdict.ts`(사유 키의 정본).
 *
 * | 규칙 | 조건 | 결과 |
 * |---|---|---|
 * | R1 | 적재·emit 의 종료 ≠ 0 | blocking |
 * | R2 | 받기의 종료 ∉ {0, 75, 69}(1 · 70 · 2 · 신호 → 1 · 모르는 종료로 건너뛴 합성 step) | blocking |
 * | R3 | 받기의 종료 ∈ {75, 69}(69 = 회로 열림 · 회로 열림으로 건너뛴 합성 step 포함) | upstream |
 * | R4 | 신선도: 0 → 파일 불필요 · ≠ 0 → 사유 파일 계약으로 읽는다(읽기 실패 · `no-games` → blocking · 그 밖은 upstream 이 1건 이상이면 explained, 아니면 blocking) | |
 * | R5 | blocking ≥ 1 → **1** · 아니면 upstream ∪ explained ≥ 1 → **75** · 아니면 **0** | |
 *
 * ⚠**대가**: 상류 실패와 수집 결함이 같은 실행에 겹치면 결함은 한 실행 늦게 드러난다 — 실행은 붉고 배포되는 것은 검증된 옛 데이터라
 *   지연이지 오염이 아니다(설계 D5).
 */
import { EXIT_LOCAL_CIRCUIT_OPEN, EXIT_UPSTREAM_CIRCUIT_OPEN, EXIT_UPSTREAM_ONLY } from "../packages/archiver/src/upstream.ts";
import { STALE_REASON_KEYS } from "../packages/domain/src/collection-verdict.ts";
import type { StaleReason } from "../packages/domain/src/collection-verdict.ts";

export { EXIT_LOCAL_CIRCUIT_OPEN, EXIT_UPSTREAM_CIRCUIT_OPEN, EXIT_UPSTREAM_ONLY };

/** 받기 자식의 「상류 실패만」 — 회로 닫힘(75)과 열림(69) · 실행 판정에서는 같다(설계 D4 · D5) */
function isUpstreamOnlyExit(exit: number): boolean {
  return exit === EXIT_UPSTREAM_ONLY || exit === EXIT_UPSTREAM_CIRCUIT_OPEN;
}

/** 자식의 갈래 — 받기(npb.jp) · 적재 · 목록 만들기 · 신선도 */
export type StepGroup = "fetch" | "load" | "emit" | "freshness";

/** 자식 하나의 결과. `exit` 는 정규화된 종료 코드다(신호·시간 제한·spawn 실패 → 1 · `collect-steps.ts`) */
export interface StepRecord {
  readonly id: string;
  readonly group: StepGroup;
  readonly exit: number;
  /**
   * 부모가 띄우지 않고 합성한 step(설계 D4) — 앞선 받기가 회로를 연 채(69·70) 끝났으면 종료 69(상류) ·
   * 종료를 모르게 끝났으면(2 · 신호 등) 종료 1(blocking)로 남긴다.
   */
  readonly skipped?: boolean;
}

/** 사유 파일의 스키마 판 — 쓰는 쪽(`freshness.ts --reasons-out`)과 같은 수 */
export const REASONS_SCHEMA = 1;

/** 사유 파일을 읽은 결과 — 실패면 그 까닭(사람이 읽는 한 줄) */
export type FreshReasons = { readonly ok: true; readonly reasons: readonly StaleReason[] } | { readonly ok: false; readonly error: string };

/**
 * **상류 장애로 설명되는 사유**(설계 D5 의 표) — 상류 실패가 **같은 실행에** 있을 때만 쓴다.
 * - `starters-behind`·`starters-lag` — 예고 취득이 실패했다(직접 결과)
 * - `game-missed` — 월간 일정·박스 취득 실패의 결과
 * - `career-lag` — 선수 페이지 취득 실패의 직접 결과. ⚠blocking 으로 두면 시즌 중 장애 4일 뒤부터 배포가 다시 막혀 사용자 결정 ②를 깬다
 * - `game-lag`(백스톱) — 장기 장애의 끝 단계(그래도 띠·붉은 실행·하트비트는 남는다)
 * ⚠**`no-games` 는 여기 없다** — DB 에 경기가 없으면 배포할 것이 없다. 이 표에 없는 사유(키가 늘어난 경우 포함)는 전부 blocking 이다(I4).
 */
export const EXPLAINED_BY_UPSTREAM: ReadonlySet<StaleReason> = new Set<StaleReason>([
  "starters-behind",
  "starters-lag",
  "game-missed",
  "career-lag",
  "game-lag",
]);

const KNOWN: ReadonlySet<string> = new Set(STALE_REASON_KEYS);

/**
 * **사유 파일 계약 — 읽는 쪽**(설계 D5 · 4차-3). `raw` 는 파일 글자(없으면 `null`) · `stepExit` 는 신선도 자식의 종료 코드(1 일 때만 부른다).
 * ⚠**모양이 하나라도 다르면 읽기 실패다**(M7 — 구조가 바뀌면 빈 값이 아니라 실패): 정확히 `{schema, exit, reasons}` 세 키 · `schema === 1` ·
 *   파일의 `exit` 가 프로세스의 종료 코드와 같음 · `reasons` 는 비지 않은 문자열 배열이고 전부 `STALE_REASON_KEYS` 안. 중복은 지운다.
 */
export function parseFreshnessReasons(raw: string | null, stepExit: number): FreshReasons {
  if (raw === null) return { ok: false, error: "사유 파일이 없다" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `사유 파일을 못 읽었다 — ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "사유 파일 모양이 다르다 — 객체가 아니다" };
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "exit,reasons,schema") return { ok: false, error: `사유 파일 모양이 다르다 — 키가 ${JSON.stringify(keys)} 다` };
  const v = value as { schema: unknown; exit: unknown; reasons: unknown };
  if (v.schema !== REASONS_SCHEMA) return { ok: false, error: `사유 파일 스키마가 다르다: ${JSON.stringify(v.schema)}` };
  if (v.exit !== stepExit) return { ok: false, error: `사유 파일의 exit(${JSON.stringify(v.exit)})가 신선도 종료 코드(${String(stepExit)})와 다르다` };
  if (!Array.isArray(v.reasons) || v.reasons.length === 0) return { ok: false, error: "사유 파일의 reasons 가 비지 않은 배열이 아니다" };
  const reasons: StaleReason[] = [];
  for (const r of v.reasons) {
    if (typeof r !== "string" || !KNOWN.has(r)) return { ok: false, error: `사유 파일에 모르는 사유가 있다: ${JSON.stringify(r)}` };
    if (!reasons.includes(r as StaleReason)) reasons.push(r as StaleReason);
  }
  return { ok: true, reasons };
}

export interface RunVerdict {
  readonly exit: 0 | 1 | typeof EXIT_UPSTREAM_ONLY;
  /** 막는 까닭(사람이 읽는 한 줄씩) */
  readonly blocking: readonly string[];
  /** 상류 실패로 끝난(또는 건너뛴) 받기 단계 */
  readonly upstream: readonly string[];
  /** 상류 장애로 설명된 신선도 사유 */
  readonly explained: readonly string[];
}

/** R1~R5 — 판정 하나 */
export function classifyRun(steps: readonly StepRecord[], fresh: FreshReasons | null): RunVerdict {
  const blocking: string[] = [];
  const upstream: string[] = [];
  for (const s of steps) {
    if (s.group === "load" || s.group === "emit") {
      if (s.exit !== 0) blocking.push(`${s.id} — 종료 ${String(s.exit)}`); // R1
    } else if (s.group === "fetch") {
      if (isUpstreamOnlyExit(s.exit)) upstream.push(s.id); // R3
      else if (s.exit !== 0) blocking.push(s.skipped === true ? `${s.id} — 건너뜀(앞선 받기의 종료를 몰라 멈췄다)` : `${s.id} — 종료 ${String(s.exit)}`); // R2
    }
  }
  const explained: string[] = [];
  for (const s of steps) {
    if (s.group !== "freshness" || s.exit === 0) continue; // R4 — 0 이면 파일을 안 본다
    if (s.exit !== 1) {
      blocking.push(`${s.id} — 종료 ${String(s.exit)}`);
      continue;
    }
    if (fresh === null) {
      blocking.push(`${s.id} — 사유를 읽지 않았다`);
      continue;
    }
    if (!fresh.ok) {
      blocking.push(`${s.id} — ${fresh.error}`);
      continue;
    }
    const unexplained = fresh.reasons.filter((r) => !EXPLAINED_BY_UPSTREAM.has(r));
    if (unexplained.length > 0) blocking.push(`${s.id} — 설명되지 않는 사유 ${unexplained.join(" ")}`);
    else if (upstream.length === 0) blocking.push(`${s.id} — 상류 실패 없이 울었다 ${fresh.reasons.join(" ")}`);
    else explained.push(...fresh.reasons);
  }
  // R5
  const exit = blocking.length > 0 ? 1 : upstream.length + explained.length > 0 ? EXIT_UPSTREAM_ONLY : 0;
  return { exit, blocking, upstream, explained };
}
