/**
 * **`update.ts` 의 자식 실행 — 한 헬퍼(`execStep`)로 모은다**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · D5).
 *
 * ⚠**왜 따로 있는가**: 예전 `update.ts` 는 `run()` 밖에서 `spawnSync` 를 직접 부르는 곳이 셋(`emit-stale-player-ids` · `emit-player-ids` ·
 *   `freshness`)이라, 판정을 `failures` 개수에서 단계 기록으로 옮기면 **emit 실패가 판정에서 사라질** 자리가 있었다.
 *   → 모든 자식이 여기를 지나고(`update.ts` 에 `spawnSync` 직접 호출 0 · `update-steps.test.ts` 가 정적으로 본다) 단계 기록이 판정의 입력이다.
 * ⚠**받기 자식의 종료로 뒤 받기를 정한다 — 닫힌 표**(설계 D4 · 2026-10-24 3중 검토 반영 · 자식 쪽은 `upstream.ts` 의 `exitCodeFor`):
 *
 * | 자식 종료 | 뜻 | 뒤의 받기 자식 | 실행 판정(`run-verdict.ts`) |
 * |---|---|---|---|
 * | 0 | 정상 | 계속 | — |
 * | 75 | 상류 실패만 · 회로 닫힘 | **계속**(연속 한도 1 로) | 상류 |
 * | 69 | 상류 실패만 · 회로 열림 | **멈춤** | 상류 |
 * | 1 | 로컬 실패 있음 · 회로 닫힘 | 계속(연속 한도 1 로) | blocking |
 * | 70 | 로컬 실패 있음 · 회로 열림 | **멈춤** | blocking |
 * | 그 밖(2 · 신호 · 종료 코드 없음 · spawn 실패) | 모름 | **멈춤**(요청에 대해 닫힌 쪽) | blocking |
 *
 *   멈춘 뒤의 받기 자식은 띄우지 않고 합성 step 으로 남긴다 — 회로 열림(69·70)이면 종료 69(상류 · 「상류 실패 — 이후 받기 건너뜀」),
 *   모름이면 종료 1(blocking · 「모르는 종료 — 이후 받기 건너뜀」). 적재·emit·신선도는 **계속 돈다**(이미 받은 데이터로 배포하려면 DB 가 돌아야 한다).
 * ⚠⚠**실패했지만 회로가 닫힌 채 끝난 자식(75·1) 뒤의 받기 자식은 연속 한도 1 로 띄운다**(`BB_NPB_CIRCUIT_N=1`) — 자식마다 회로가 새로 서므로
 *   이게 없으면 「닫힌 채 소진 5」를 자식마다 되풀이할 수 있다(전면 장애 · 날짜 2개면 예고 1 + 날짜 2+2 + 선수 3 = 소진 8).
 *   이것으로 **실행 전체 소진(`UpstreamError` 로 끝난 `get()`) ≤ 6**: 처음 실패한 자식이 닫힌 채 끝나면 그 자식 ≤ 5(합계 6 이면 열린다) +
 *   다음 자식 ≤ 1(연속 1 → 열림 → 69/70 → 멈춤) · 열린 채 끝나면 그 자식 ≤ 6 → 멈춤. 걸쇠(30분)가 자식을 죽이면 그때 진행 중이던 `get()` 하나가 더해질 수 있다.
 * ⚠**정규화**: 판정용 종료 코드는 지금처럼 — 종료 코드가 없음(`status === null` · 신호) · spawn 실패는 **1**(막는 쪽 · I4).
 *   ⚠단 **뒤 받기를 정할 때는 정규화 전의 값을 본다** — 신호로 죽은 자식(1 로 정규화)을 「로컬 · 회로 닫힘」(계속)으로 읽지 않는다.
 * ⚠import 하는 것은 `node:*` 와 잎 모듈뿐이다 — 이 모듈은 부작용이 없다(만들 때 자식을 띄우지 않는다).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { CIRCUIT_ENV } from "../packages/archiver/src/circuit.ts";
import { EXIT_LOCAL_CIRCUIT_OPEN, EXIT_UPSTREAM_CIRCUIT_OPEN, EXIT_UPSTREAM_ONLY, parseFreshnessReasons } from "./run-verdict.ts";
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
 * 받기 자식의 끝 → 뒤 받기의 처분(위 표). **정규화 전의 값**으로 가른다.
 * - `continue` — 0 · 75 · 1(회로 닫힘)
 * - `circuit` — 69 · 70(회로 열림 — 호스트가 아프다)
 * - `unknown` — 그 밖 전부(2 · 다른 코드 · 신호 · 종료 코드 없음 · spawn 실패)
 */
export function fetchExitDisposition(r: { readonly status: number | null; readonly signal?: string | null; readonly error?: Error | undefined }): "continue" | "circuit" | "unknown" {
  if (r.error !== undefined || r.status === null || (r.signal !== undefined && r.signal !== null)) return "unknown";
  if (r.status === 0 || r.status === EXIT_UPSTREAM_ONLY || r.status === 1) return "continue";
  if (r.status === EXIT_UPSTREAM_CIRCUIT_OPEN || r.status === EXIT_LOCAL_CIRCUIT_OPEN) return "circuit";
  return "unknown";
}

/**
 * 자식 실행기 하나 — `update.ts` 의 한 실행에 하나. `steps` 가 판정(`classifyRun`)의 입력이다.
 * ⚠`cwd` 는 저장소 뿌리다 — 자식에 넘기는 상대 경로(`packages/…`)가 그 기준으로 풀린다.
 */
export function createStepRunner(o: { readonly cwd: string; readonly log?: StepLog }) {
  const log = o.log ?? consoleLog;
  const steps: StepRecord[] = [];
  /** 뒤 받기를 멈추게 한 받기 단계(위 표의 「멈춤」) — 그 뒤 받기는 띄우지 않는다 */
  let stoppedBy: { readonly id: string; readonly circuit: boolean; readonly exit: string } | null = null;
  /** 실패했지만 회로가 닫힌 채 끝난 첫 받기 단계(75 · 1) — 그 뒤 받기 자식은 연속 한도 1 로 띄운다 */
  let tightenedBy: string | null = null;

  /**
   * 자식 하나. `capture` 면 표준출력·오류를 돌려주고(목록 만들기) 아니면 그대로 물려준다(머리 줄을 찍는다).
   * ⚠`args[0]` 은 스크립트 경로다 — 실행기는 언제나 이 Node(`process.execPath`)다.
   */
  function execStep(id: string, group: StepGroup, args: readonly string[], opts: { readonly capture?: boolean } = {}): ExecResult {
    if (group === "fetch" && stoppedBy !== null) {
      log.out(`\n── ${id} ──`);
      if (stoppedBy.circuit) {
        log.err(`  상류 실패 — 이후 받기 건너뜀 ${id}(앞선 「${stoppedBy.id}」 가 ${stoppedBy.exit} 로 끝났다 · 회로 열림 · 요청 0)`);
        steps.push({ id, group, exit: EXIT_UPSTREAM_CIRCUIT_OPEN, skipped: true });
        return { exit: EXIT_UPSTREAM_CIRCUIT_OPEN, ran: false, stdout: "", stderr: "" };
      }
      log.err(`  모르는 종료 — 이후 받기 건너뜀 ${id}(앞선 「${stoppedBy.id}」 의 종료 ${stoppedBy.exit} · 요청에 대해 닫힌 쪽 · 요청 0)`);
      steps.push({ id, group, exit: 1, skipped: true });
      return { exit: 1, ran: false, stdout: "", stderr: "" };
    }
    if (opts.capture !== true) log.out(`\n── ${id} ──`);
    // ⚠앞선 받기가 닫힌 채 실패했으면 연속 한도 1 — 실행 전체 소진 ≤ 6(위 머리말)
    const env = group === "fetch" && tightenedBy !== null ? { ...process.env, [CIRCUIT_ENV]: "1" } : undefined;
    const r =
      opts.capture === true
        ? spawnSync(process.execPath, [...args], { cwd: o.cwd, encoding: "utf8", ...(env === undefined ? {} : { env }) })
        : spawnSync(process.execPath, [...args], { cwd: o.cwd, stdio: "inherit", ...(env === undefined ? {} : { env }) });
    const exit = normalizeExit(r);
    if (exit !== 0) log.err(`  ⚠${id} 종료 코드 ${describeExit(r)}`);
    steps.push({ id, group, exit });
    if (group === "fetch") {
      const d = fetchExitDisposition(r);
      if (d !== "continue") {
        stoppedBy ??= { id, circuit: d === "circuit", exit: describeExit(r) };
      } else if (exit !== 0 && tightenedBy === null) {
        tightenedBy = id;
        log.err(`  · 「${id}」 가 실패로 끝났다(종료 ${String(exit)} · 회로 닫힘) — 이후 받기 자식은 ${CIRCUIT_ENV}=1 로 띄운다(실행 전체 소진 ≤ 6)`);
      }
    }
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
