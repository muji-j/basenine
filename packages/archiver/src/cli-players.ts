#!/usr/bin/env node
/**
 * 선수 페이지 아카이버 CLI.
 *
 *   node packages/archiver/src/cli-players.ts --ids data/player-ids.txt --contact <닿는-연락처>
 *
 * ID 목록은 한 줄에 하나. `#`로 시작하는 줄과 빈 줄은 무시한다.
 *
 * **종료 코드**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D4 — 회로가 열렸는가로 가른다): 0 실패 없음 ·
 * **75 실패가 전부 상류 · 회로 닫힘**(부모 계속) · **69 전부 상류 · 회로 열림**(부모가 뒤 받기를 멈춘다) ·
 * 1 하나라도 local(쓰기·「없다」 기록 실패 등)·미분류 · 회로 닫힘 · **70 local 이 있고 회로 열림** · 2 입력이 틀렸다(요청 0).
 * ⚠사이드카를 못 읽으면(`readMeta` 예외) 지금처럼 **그 자리에서 끝난다** — 진입 함수가 잡아 회로 상태로 1/70 을 고른다(local).
 */
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { systemClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { CIRCUIT_ENV, CIRCUIT_TOTAL_LIMIT, HostCircuit, parseCircuitN } from "./circuit.ts";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, firstSuccessNote, parseDelayMs } from "./fetcher.ts";
import type { FetchImpl, SleepImpl } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import type { Sink } from "./sink.ts";
import { archivePlayers } from "./players.ts";
import { summarize } from "./archive.ts";
import { exitCodeFor } from "./upstream.ts";

/** 진입 함수에 주입하는 것 — **시험 전용**이다. 파일로 실행될 때는 전부 기본값 */
export interface PlayersCliIo {
  fetchImpl?: FetchImpl;
  sleep?: SleepImpl;
  clock?: Clock;
  sink?: Sink;
  /** 사람이 읽는 줄(기본: 표준오류) */
  log?: (line: string) => void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function readArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      ids: { type: "string" },
      out: { type: "string", default: "data/archive" },
      contact: { type: "string" },
      delay: { type: "string", default: "3000" },
      /** 이미 받아둔 선수는 건너뛴다. 900명 × 3초 = 45분이라 기본값은 건너뛰기다 */
      refresh: { type: "boolean", default: false },
    },
  }).values;
}

/** 진입 함수 — 종료 코드를 돌려준다(`process.exit()` 를 부르지 않는다 · `cli.ts` 진입부 주석) */
export async function runPlayersCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: PlayersCliIo = {}): Promise<number> {
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
  if (!values.ids) {
    log("usage: node src/cli-players.ts --ids <file> --contact <email> [--out DIR] [--refresh]");
    return 2;
  }

  // ⚠**`Number(values.delay)` 를 직접 넘기지 마라** — `NaN` 은 nullish 가 아니라서
  //   `minDelayMs ?? 3000` 을 통과하고 **간격이 조용히 0이 된다**(L1 · `fetcher.ts` 참조).
  //   ⚠여기는 900명을 도는 자리라 간격이 사라지면 피해가 가장 크다.
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

  const ids = (await readFile(values.ids, "utf8"))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

  const clock = io.clock ?? systemClock;
  const fetcher = new PoliteFetcher({
    userAgent,
    minDelayMs: delayMs,
    clock,
    circuit: new HostCircuit({ clock, consecutive: circuitN }),
    ...(io.fetchImpl !== undefined ? { fetchImpl: io.fetchImpl } : {}),
    ...(io.sleep !== undefined ? { sleep: io.sleep } : {}),
  });
  const sink = io.sink ?? new LocalSink(values.out);

  log(
    `선수 ${ids.length}명 · 저장 위치 ${values.out} · 간격 ${delayMs}ms · ` +
      `${values.refresh ? "전량 재취득" : "기존은 건너뜀"} · 회로 연속 ${String(circuitN)}`,
  );

  let results: Awaited<ReturnType<typeof archivePlayers>>;
  try {
    results = await archivePlayers(ids, { fetcher, sink, clock }, {
      skipExisting: !values.refresh,
      onEach: (r, i, total) => {
        if (r.outcome === "failed") log(`  FAILED ${r.url} — ${r.error}`);
        // ⚠짝이 틀린 로컬 본문을 되살렸다(3중 검토 2차 F1) — 드문 일이라 한 줄씩 남긴다(어느 선수였는지 로그로 답할 수 있게)
        if (r.repair === "rewritten") log(`  REPAIRED ${r.url} — 로컬 본문이 사이드카와 달라 받은 바이트로 되살렸다(revision 불변)`);
        // ⚠되살리려 했는데 그 사이 다른 작성자가 사이드카를 바꿨다(반영분 재검토 P2) — 안 썼다. 겹친 실행이 있었다는 신호다
        if (r.repair === "concurrent") {
          log(`  REPAIR SKIPPED ${r.url} — 확인하는 사이 다른 작성자가 사이드카를 바꿔 되살리지 않았다(겹친 실행 · 다음 실행이 다시 본다)`);
        }
        if ((i + 1) % 50 === 0 || i + 1 === total) log(`  ${i + 1}/${total}`);
      },
    });
  } catch (err) {
    // ⚠**던져서 끝나는 local**(사이드카를 못 읽음 등) — 회로가 열려 있으면 70(부모가 뒤 받기를 멈춘다) · 닫혀 있으면 1(설계 D4)
    const circuit = fetcher.circuit.snapshot();
    log(`⚠중단 — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    log(`\n중단: 회로 ${circuit.open ? `열림(${String(circuit.reason)})` : "닫힘"} · 소진 ${String(circuit.total)} · ${firstSuccessNote(fetcher.firstSuccess)}`);
    return exitCodeFor([{ error: errorText(err), errorKind: "local" }], circuit.open);
  }

  const s = summarize(results);
  /** ⚠「변경없음」 안에 든다(내용은 그대로다) — 따로 세서 0 이어도 찍는다(「0건」과 「안 쟀음」을 가른다) */
  const repaired = results.filter((r) => r.repair === "rewritten").length;
  const repairSkipped = results.filter((r) => r.repair === "concurrent").length;
  const circuit = fetcher.circuit.snapshot();
  log(
    `\n합계 ${s.total}명 (신규 ${s.stored} / 변경없음·건너뜀 ${s.unchanged}(그중 본문 되살림 ${repaired} · 겹쳐서 보류 ${repairSkipped}) / 부재 ${s.absent} / 실패 ${s.failed}) · ` +
      `회로 ${circuit.open ? `열림(${String(circuit.reason)})` : "닫힘"} · 소진 ${String(circuit.total)} · ${firstSuccessNote(fetcher.firstSuccess)}`,
  );

  // ⚠회로가 열린 채 끝났으면 69/70 — 부모가 뒤 받기 자식을 멈춘다(설계 D4)
  return exitCodeFor(results, circuit.open);
}

/** **파일로 실행될 때만** 진입한다 — import 만으로는 아무것도 하지 않는다(`cli.ts` 와 같은 방식) */
const entry = process.argv[1];
if (entry !== undefined && /(?:^|[\\/])cli-players\.ts$/.test(entry)) {
  process.exitCode = await runPlayersCli(process.argv.slice(2), process.env);
}
