/**
 * **`update.ts` 의 자식 실행 — 한 헬퍼(`execStep`)로 모은다**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · D5).
 *
 * ⚠**왜 따로 있는가**: 예전 `update.ts` 는 `run()` 밖에서 `spawnSync` 를 직접 부르는 곳이 셋(`emit-stale-player-ids` · `emit-player-ids` ·
 *   `freshness`)이라, 판정을 `failures` 개수에서 단계 기록으로 옮기면 **emit 실패가 판정에서 사라질** 자리가 있었다.
 *   → 모든 자식이 여기를 지나고(`update.ts` 에 `spawnSync` 직접 호출 0 · `update-steps.test.ts` 가 정적으로 본다) 단계 기록이 판정의 입력이다.
 * ⚠**부모 중단**(D4-2): 받기 자식이 **75 로 끝나면 그 뒤의 받기 자식은 띄우지 않는다** — 로그 「상류 실패 — 이후 받기 건너뜀 <단계>」 ·
 *   합성 step(종료 75 · `skipped`)으로 남긴다. 적재·emit·신선도는 **계속 돈다**(이미 받은 데이터로 배포하려면 DB 가 돌아야 한다).
 * ⚠**정규화**: 종료 코드가 없음(`status === null` · 신호) · spawn 실패 · 시간 제한은 전부 **1**(막는 쪽 · I4).
 * ⚠import 하는 것은 `node:*` 와 순수 판정 모듈뿐이다 — 이 모듈은 부작용이 없다(만들 때 자식을 띄우지 않는다).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { EXIT_UPSTREAM_ONLY, parseFreshnessReasons } from "./run-verdict.ts";
import type { FreshReasons, StepGroup, StepRecord } from "./run-verdict.ts";

export interface StepLog {
  /** 단계 머리 · 안내(표준출력) */
  out(line: string): void;
  /** 경고(표준오류) */
  err(line: string): void;
}

const consoleLog: StepLog = { out: (l) => console.log(l), err: (l) => console.error(l) };

export interface ExecResult {
  /** 정규화된 종료 코드 */
  readonly exit: number;
  /** 실제로 띄웠는가(건너뛴 합성 step 이면 `false`) */
  readonly ran: boolean;
  /** `capture` 일 때만 채워진다 */
  readonly stdout: string;
  readonly stderr: string;
}

/** `spawnSync` 결과 → 종료 코드. 신호·spawn 실패·시간 제한은 1(막는 쪽) */
export function normalizeExit(r: { readonly status: number | null; readonly signal?: string | null; readonly error?: Error | undefined }): number {
  if (r.error !== undefined) return 1;
  if (r.status === null) return 1;
  if (r.signal !== undefined && r.signal !== null) return 1;
  return r.status;
}

function describeExit(r: { readonly status: number | null; readonly signal?: string | null; readonly error?: Error | undefined }): string {
  if (r.error !== undefined) return `없음(띄우지 못했다 — ${r.error.message})`;
  if (r.status === null || (r.signal !== undefined && r.signal !== null)) return `없음(신호 ${String(r.signal ?? "?")})`;
  return String(r.status);
}

/**
 * 자식 실행기 하나 — `update.ts` 의 한 실행에 하나. `steps` 가 판정(`classifyRun`)의 입력이다.
 * ⚠`cwd` 는 저장소 뿌리다 — 자식에 넘기는 상대 경로(`packages/…`)가 그 기준으로 풀린다.
 */
export function createStepRunner(o: { readonly cwd: string; readonly log?: StepLog }) {
  const log = o.log ?? consoleLog;
  const steps: StepRecord[] = [];
  /** 처음 75 로 끝난 받기 단계 — 그 뒤 받기는 띄우지 않는다 */
  let stoppedBy: string | null = null;

  /**
   * 자식 하나. `capture` 면 표준출력·오류를 돌려주고(목록 만들기) 아니면 그대로 물려준다(머리 줄을 찍는다).
   * ⚠`args[0]` 은 스크립트 경로다 — 실행기는 언제나 이 Node(`process.execPath`)다.
   */
  function execStep(id: string, group: StepGroup, args: readonly string[], opts: { readonly capture?: boolean } = {}): ExecResult {
    if (group === "fetch" && stoppedBy !== null) {
      log.out(`\n── ${id} ──`);
      log.err(`  상류 실패 — 이후 받기 건너뜀 ${id}(앞선 「${stoppedBy}」 가 ${String(EXIT_UPSTREAM_ONLY)} 로 끝났다 · 요청 0)`);
      steps.push({ id, group, exit: EXIT_UPSTREAM_ONLY, skipped: true });
      return { exit: EXIT_UPSTREAM_ONLY, ran: false, stdout: "", stderr: "" };
    }
    if (opts.capture !== true) log.out(`\n── ${id} ──`);
    const r =
      opts.capture === true
        ? spawnSync(process.execPath, [...args], { cwd: o.cwd, encoding: "utf8" })
        : spawnSync(process.execPath, [...args], { cwd: o.cwd, stdio: "inherit" });
    const exit = normalizeExit(r);
    if (exit !== 0) log.err(`  ⚠${id} 종료 코드 ${describeExit(r)}`);
    steps.push({ id, group, exit });
    if (group === "fetch" && exit === EXIT_UPSTREAM_ONLY) stoppedBy ??= id;
    const text = (v: unknown): string => (typeof v === "string" ? v : "");
    return { exit, ran: true, stdout: opts.capture === true ? text(r.stdout) : "", stderr: opts.capture === true ? text(r.stderr) : "" };
  }

  /** 자식 없이 실패를 남긴다(옛 판이 실패로 세던 「종료 0 인데 빈 목록」 같은 것) — 종료 1 */
  function failStep(id: string, group: StepGroup, why: string): void {
    log.err(`  ⚠${id} — ${why}`);
    steps.push({ id, group, exit: 1 });
  }

  /**
   * **신선도 단계 — 사유 파일 계약의 읽는 쪽**(설계 D5 · 4차-3).
   * ⑴ spawn **전에** 파일을 지운다(이전 실행의 것을 읽지 않는다 · 못 지우면 그 자체가 blocking — 종료 2 로 남긴다)
   * ⑵ `--reasons-out <path>` 를 붙여 띄운다 ⑶ 종료 1 일 때만 읽는다(0 → 파일 불필요 · 그 밖 → 판정이 파일과 무관하게 막는다)
   */
  function freshnessStep(id: string, args: readonly string[], reasonsPath: string): FreshReasons | null {
    try {
      rmSync(reasonsPath, { force: true });
    } catch (err) {
      log.err(`  ⚠${id} — 이전 사유 파일을 못 지웠다(${err instanceof Error ? err.message : String(err)}) — 그 파일을 믿을 수 없으므로 막는다`);
      steps.push({ id: `${id}(사유 파일 정리)`, group: "freshness", exit: 2 });
    }
    const r = execStep(id, "freshness", [...args, "--reasons-out", reasonsPath]);
    if (r.exit !== 1) return null;
    let raw: string | null = null;
    try {
      raw = existsSync(reasonsPath) ? readFileSync(reasonsPath, "utf8") : null;
    } catch (err) {
      return { ok: false, error: `사유 파일을 못 읽었다 — ${err instanceof Error ? err.message : String(err)}` };
    }
    return parseFreshnessReasons(raw, r.exit);
  }

  return { steps, execStep, failStep, freshnessStep };
}
