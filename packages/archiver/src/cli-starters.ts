#!/usr/bin/env node
/**
 * 予告先発 아카이버 CLI. **하루 1요청.**
 *
 *   node packages/archiver/src/cli-starters.ts --contact <닿는-연락처>
 *
 * **종료 코드**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D4 — 회로가 열렸는가로 가른다): 0 성공 ·
 * **75 상류 받기 실패 · 회로 닫힘**(부모 계속) · **69 상류 · 회로 열림**(부모가 뒤 받기를 멈춘다 — 요청 1 이라 연속 한도 1 일 때만) ·
 * 1 local(쓰기 실패·전송 전 로컬 고장 등)·미분류 · **70 local · 회로 열림** · 2 입력이 틀렸다(요청 0).
 * ⚠`scripts/update.ts` 는 이것을 **받기의 맨 앞**에서 부른다(설계 D4-4) — 거르면 영영 못 받는 유일한 요청이라서다.
 */
import { parseArgs } from "node:util";
import { systemClock, toJstDateString } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { CIRCUIT_ENV, CIRCUIT_TOTAL_LIMIT, HostCircuit, parseCircuitN } from "./circuit.ts";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, firstSuccessNote, parseDelayMs } from "./fetcher.ts";
import type { FetchImpl, SleepImpl } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import type { Sink } from "./sink.ts";
import { archiveStarters } from "./starters.ts";
import { exitCodeFor } from "./upstream.ts";

/** 진입 함수에 주입하는 것 — **시험 전용**이다. 파일로 실행될 때는 전부 기본값 */
export interface StartersCliIo {
  fetchImpl?: FetchImpl;
  sleep?: SleepImpl;
  clock?: Clock;
  sink?: Sink;
  /** 결과 한 줄(기본: 표준출력) */
  out?: (line: string) => void;
  /** 경고·안내(기본: 표준오류) */
  log?: (line: string) => void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function readArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      out: { type: "string", default: "data/archive" },
      contact: { type: "string" },
      delay: { type: "string", default: "3000" },
      /** 취득일. 기본은 오늘(JST) */
      date: { type: "string" },
    },
  }).values;
}

/** 진입 함수 — 종료 코드를 돌려준다(`process.exit()` 를 부르지 않는다 · `cli.ts` 진입부 주석) */
export async function runStartersCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: StartersCliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const log = io.log ?? ((line: string) => console.error(line));
  let values: ReturnType<typeof readArgs>;
  try {
    values = readArgs(argv);
  } catch (err) {
    log(`인자를 못 읽었다 — ${errorText(err)}`);
    return 2;
  }

  const contact = values.contact ?? env["BB_ARCHIVER_CONTACT"] ?? "";
  if (!contact) {
    log("연락처가 필요하다. --contact <닿는-연락처> 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
    return 2;
  }

  // ⚠**`Number(values.delay)` 를 직접 넘기지 마라** — `NaN` 은 nullish 가 아니라서
  //   `minDelayMs ?? 3000` 을 통과하고 **간격이 조용히 0이 된다**(L1 · `fetcher.ts` 참조).
  const delayMs = parseDelayMs(values.delay);
  if (delayMs === null) {
    log(`--delay 는 ${L1_MIN_DELAY_MS}ms 이상이어야 한다 (L1: 1req/2~5초): ${values.delay}`);
    return 2;
  }

  // ⚠회로의 연속 한도(설계 D4) — 틀린 값을 기본값으로 메우지 않는다(M11 · 요청 0)
  const circuitN = parseCircuitN(env[CIRCUIT_ENV]);
  if (circuitN === null) {
    log(`${CIRCUIT_ENV} 가 틀렸다 — 1~${String(CIRCUIT_TOTAL_LIMIT)} 의 정수만 받는다: ${JSON.stringify(env[CIRCUIT_ENV])}. 아무것도 받지 않는다`);
    return 2;
  }

  let userAgent: string;
  try {
    userAgent = buildUserAgent(contact);
  } catch (err) {
    log(errorText(err));
    return 2;
  }

  const clock = io.clock ?? systemClock;
  // ⚠시계는 한 번만 읽는다(M6)
  const jstDate = values.date ?? toJstDateString(clock.now());
  const fetcher = new PoliteFetcher({
    userAgent,
    minDelayMs: delayMs,
    clock,
    circuit: new HostCircuit({ clock, consecutive: circuitN }),
    ...(io.fetchImpl !== undefined ? { fetchImpl: io.fetchImpl } : {}),
    ...(io.sleep !== undefined ? { sleep: io.sleep } : {}),
  });

  let result: Awaited<ReturnType<typeof archiveStarters>>;
  try {
    result = await archiveStarters(jstDate, { fetcher, sink: io.sink ?? new LocalSink(values.out), clock });
  } catch (err) {
    // ⚠**던져서 끝나는 local**(사이드카를 못 읽음 등) — 회로 상태로 1/70 을 고른다(설계 D4)
    log(`⚠중단 — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return exitCodeFor([{ error: errorText(err), errorKind: "local" }], fetcher.circuit.isOpen);
  }

  out(`予告先発 ${jstDate}: ${result.outcome}${result.status === null ? "" : ` (${result.status})`}`);
  if (result.error !== null) log(`  ⚠${result.error}`);
  log(`  ${firstSuccessNote(fetcher.firstSuccess)}`);
  // 취득 실패는 그날 예고를 영영 못 받는다는 뜻이다 — 조용히 성공으로 끝내지 않는다(상류 실패면 75/69 · 그 밖은 1/70)
  return exitCodeFor([result], fetcher.circuit.isOpen);
}

/** **파일로 실행될 때만** 진입한다 — import 만으로는 아무것도 하지 않는다(`cli.ts` 와 같은 방식) */
const entry = process.argv[1];
if (entry !== undefined && /(?:^|[\\/])cli-starters\.ts$/.test(entry)) {
  process.exitCode = await runStartersCli(process.argv.slice(2), process.env);
}
