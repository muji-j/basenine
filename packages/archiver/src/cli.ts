#!/usr/bin/env node
/**
 * 아카이버 CLI.
 *
 *   node packages/archiver/src/cli.ts --date 2026-08-14
 *   node packages/archiver/src/cli.ts --from 2026-08-01 --to 2026-08-14
 *
 * 연락처는 필수다(CLAUDE.md L1) — `--contact` 또는 `BB_ARCHIVER_CONTACT`.
 *
 * **종료 코드**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1):
 * - **0** — 실패 없음(다음 달 일정이 404·410 인 것은 사실이라 실패가 아니다).
 * - **75** — 실패가 있고 **전부 상류 받기 실패**(`UpstreamError` — 소진·즉시 실패·회로 열림). 데이터는 바뀌지 않았다.
 *   `scripts/update.ts` 가 이 코드로 「이후 받기 건너뜀」과 「이미 받은 데이터로 배포」를 정한다.
 * - **1** — 하나라도 local(쓰기·사이드카·구조 변경·현재 달 일정 없음) 또는 미분류.
 * - **2** — 입력이 틀렸다(연락처 · `--delay` · `BB_NPB_CIRCUIT_N` · 날짜). **요청 0.**
 */
import { parseArgs } from "node:util";
import { systemClock, toJstDateString } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { CIRCUIT_ENV, CIRCUIT_TOTAL_LIMIT, HostCircuit, parseCircuitN } from "./circuit.ts";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, firstSuccessNote, parseDelayMs } from "./fetcher.ts";
import type { FetchImpl, SleepImpl } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import type { Sink } from "./sink.ts";
import { MonthlyScheduleCache, archiveDates, isDayError, summarize } from "./archive.ts";
import type { DayError, PageResult } from "./archive.ts";
import { ScheduleAbsentError, UpstreamError, exitCodeFor } from "./upstream.ts";
import type { ResultLike } from "./upstream.ts";

/** 진입 함수에 주입하는 것 — **시험 전용**이다. 파일로 실행될 때는 전부 기본값(undici 전송 · 진짜 sleep · 시스템 시계 · `LocalSink(--out)`) */
export interface ArchiveCliIo {
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
      date: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      out: { type: "string", default: "data/archive" },
      contact: { type: "string" },
      delay: { type: "string", default: "3000" },
      "dry-run": { type: "boolean", default: false },
    },
  }).values;
}

/**
 * 진입 함수 — 종료 코드를 돌려준다.
 * ⚠`process.exit()` 를 부르지 않는다 — 네트워크 뒤에 부르면 Windows 에서 libuv 가 죽는다(아래 진입부 주석).
 */
export async function runArchiveCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: ArchiveCliIo = {}): Promise<number> {
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
    log(
      "연락처가 필요하다. --contact <닿는-연락처> 또는 BB_ARCHIVER_CONTACT 환경변수를 설정하라.\n" +
        "이유: 연락처 없는 UA로 긁으면 상대가 문제를 알릴 방법이 차단밖에 없다 (CLAUDE.md L1).",
    );
    return 2;
  }

  // ⚠**`Number(values.delay)` 를 직접 넘기지 마라** — `NaN` 은 nullish 가 아니라서
  //   `minDelayMs ?? 3000` 을 통과하고 **간격이 조용히 0이 된다**(L1 · `fetcher.ts` 참조).
  //   ⚠여기는 경기 페이지를 날짜 수 × 4장 도는 자리다.
  const delayMs = parseDelayMs(values.delay);
  if (delayMs === null) {
    log(`--delay 는 ${L1_MIN_DELAY_MS}ms 이상이어야 한다 (L1: 1req/2~5초): ${values.delay}`);
    return 2;
  }

  // ⚠**회로의 연속 한도**(설계 D4) — 워크플로가 재시도 슬롯에 1, 그 밖에 3 을 준다. 틀린 값을 기본값으로 메우지 않는다(M11) — 요청 0 으로 멈춘다
  const circuitN = parseCircuitN(env[CIRCUIT_ENV]);
  if (circuitN === null) {
    log(`${CIRCUIT_ENV} 가 틀렸다 — 1~${String(CIRCUIT_TOTAL_LIMIT)} 의 정수만 받는다: ${JSON.stringify(env[CIRCUIT_ENV])}. 아무것도 받지 않는다`);
    return 2;
  }

  // ⚠**마지막 걸쇠** — 닿지 않는 연락처(예약 도메인)는 빈 연락처와 같다. fetcher 를 만들기 **전에** 부른다
  let userAgent: string;
  try {
    userAgent = buildUserAgent(contact);
  } catch (err) {
    log(errorText(err));
    return 2;
  }

  const clock = io.clock ?? systemClock;
  let dates: string[];
  try {
    dates = resolveDates(values, clock);
  } catch (err) {
    log(`날짜를 못 읽었다 — ${errorText(err)}`);
    return 2;
  }

  const fetcher = new PoliteFetcher({
    userAgent,
    minDelayMs: delayMs,
    clock,
    circuit: new HostCircuit({ clock, consecutive: circuitN }),
    ...(io.fetchImpl !== undefined ? { fetchImpl: io.fetchImpl } : {}),
    ...(io.sleep !== undefined ? { sleep: io.sleep } : {}),
  });
  const sink = io.sink ?? new LocalSink(values.out);

  log(`대상 ${dates.length}일 · 저장 위치 ${values.out} · 요청 간격 ${delayMs}ms · 회로 연속 ${String(circuitN)} · 합계 ${String(CIRCUIT_TOTAL_LIMIT)}`);

  const all: PageResult[] = [];
  const dayErrors: DayError[] = [];
  let daysWithGames = 0;
  const schedule = new MonthlyScheduleCache();

  // ERROR(돌지도 않음)와 FAIL(떨어짐)을 분리해서 센다 (CLAUDE.md 작업규칙 8).
  await archiveDates(dates, { fetcher, sink, clock, schedule }, (day) => {
    if (isDayError(day)) {
      dayErrors.push(day);
      log(`${day.date}  ERROR — ${day.error}`);
      return;
    }
    const s = summarize(day.pages);
    all.push(...day.pages);
    if (day.gamesFound > 0) daysWithGames += 1;
    if (day.gamesFound > 0 || s.failed > 0) {
      log(
        `${day.date}  경기 ${day.gamesFound}건 · 페이지 ${s.total}장 ` +
          `(신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed} / 보류 ${s.held})`,
      );
    }
    for (const p of day.pages) {
      if (p.outcome === "failed") log(`  FAILED ${p.url} — ${p.error}`);
    }
  });

  /**
   * **다음 달 일정을 한 장 더 받는다.**
   *
   * ⚠**월말마다 「앞으로의 경기」가 비었다**(2026-08-18 감사 P2). 월간 일정 페이지는 **그 달만** 담는데,
   * 우리는 **수집 대상 날짜의 달**만 받는다 — 8/30 에 8월 일정을 받으면 거기 남은 미래는 8/31 하루뿐이고,
   * 9월분은 9/1 이 되어야 들어온다. 즉 **월말 이틀은 캘린더의 앞날이 통째로 비고**,
   * 화면은 그것을 「일정을 아직 안 받았다」로 그린다 — 사실은 시즌이 한창인데도.
   *
   * ⚠**비용은 하루 1요청이다**(L1: 1req/2~5초 · 하루 1회 배치).
   * ⚠**여기에 조건부 요청은 안 걸려 있다**(2026-08-18 감사 P3에서 정정).
   *   예전에 이 자리에 「조건부 요청이 걸리므로 대부분 304 다(L7)」라고 적혀 있었는데
   *   **코드가 안 하는 일을 문서가 보증하고 있었다** — 월간 일정만 `fetcher.get(url)` 을
   *   이전 메타 없이 부른다(다른 경로는 전부 넘긴다).
   *   ⚠**틀린 보증이 값 자체보다 위험하다.** 다음 사람이 이 문장을 근거로
   *   「L7 은 이미 지켜진다」고 판단하면 그 판단이 틀린다.
   *   못 고친 이유: 304 를 받으면 파싱할 본문이 없는데 `Sink` 에 **본문 읽기가 없다.**
   *   인터페이스를 넓히는 변경이라 수집 경로를 건드린다 — 얻는 것은 월 10요청분의 바이트뿐이다.
   *   ⚠수집 경로를 손볼 일이 생기면 그때 같이 넣어라.
   * ⚠**갈래가 셋이다**(2026-10-24 · 설계 D1 · 3차-3):
   *   ⑴ **404·410**(`ScheduleAbsentError`) — 12월에 다음 해 1월을 물으면 그런 것이 정상이다. 꼬리표 「（오프시즌이면 정상）」만 · 종료 코드 무영향.
   *   ⑵ **상류 실패**(`UpstreamError`) — **75 에 넣는다.** 예전에는 무영향이라 장애 중 이것만 실패하면 실행이 초록이었다.
   *      ⚠예전에는 이 경우에도 「（오프시즌이면 정상）」이 붙었다(P3) — 네트워크 실패는 오프시즌과 무관하다.
   *   ⑶ 그 밖(구조 변경 의심 등) — 지금처럼 **경고만**(무영향 · 현행 유지).
   */
  const extra: ResultLike[] = [];
  const last = dates[dates.length - 1];
  if (last !== undefined) {
    const y = Number(last.slice(0, 4));
    const m = Number(last.slice(5, 7));
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const label = `다음 달 일정(${nextY}-${String(nextM).padStart(2, "0")})`;
    try {
      const found = await schedule.get(nextY, nextM, { fetcher, sink, clock });
      log(`${label} 확보 · 경기 ${found.length}건`);
    } catch (err) {
      if (err instanceof ScheduleAbsentError) {
        log(`${label} 은 못 받았다 — ${err.message}（오프시즌이면 정상）`);
      } else if (err instanceof UpstreamError) {
        log(`${label} 은 못 받았다 — ${err.message}`);
        extra.push({ error: err.message, errorKind: "upstream" });
      } else {
        log(`${label} 은 못 받았다 — ${errorText(err)}`);
      }
    }
  }

  const total = summarize(all);
  const circuit = fetcher.circuit.snapshot();
  log(
    `\n합계: ${dates.length}일 중 ${dates.length - dayErrors.length}일 처리 (경기 있는 날 ${daysWithGames}일) · ` +
      `월간 일정 취득 ${schedule.fetchCount}회 · ` +
      `페이지 ${total.total}장 (신규 ${total.stored} / 변경없음 ${total.unchanged} / 부재 ${total.absent} / 실패 ${total.failed} / 보류 ${total.held}) · ` +
      `회로 ${circuit.open ? `열림(${String(circuit.reason)})` : "닫힘"} · 소진 ${String(circuit.total)} · ${firstSuccessNote(fetcher.firstSuccess)}`,
  );

  return exitCodeFor([...all, ...dayErrors, ...extra]);
}

function resolveDates(values: ReturnType<typeof readArgs>, clock: Clock): string[] {
  if (values.date) return [values.date];
  if (values.from || values.to) {
    const from = values.from ?? values.to;
    const to = values.to ?? values.from;
    if (!from || !to) throw new Error("--from 과 --to 를 함께 지정하라");
    return datesBetween(from, to);
  }
  return [toJstDateString(clock.now())];
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new RangeError(`날짜 형식이 잘못됐다: ${from}..${to}`);
  if (end < start) throw new RangeError(`--to 가 --from 보다 이르다: ${from}..${to}`);
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * **파일로 실행될 때만** 진입한다 — import 만으로는 아무것도 하지 않는다(시험이 진입 함수를 가짜 전송으로 부른다).
 * ⚠경로 전체가 아니라 **파일 이름**으로 가른다(`cli-games.ts` 와 같은 방식 — Windows 의 드라이브 문자·구분자 차이).
 * ⚠`process.exit()`를 쓰지 마라. 네트워크 작업 뒤에 부르면 Windows에서 libuv가
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 로 죽는다(실측 2026-08-14).
 * 크래시하면 종료 코드가 0xC0000409가 되어 **크론이 성공/실패를 오판한다.**
 * exitCode만 세우고 이벤트 루프가 자연히 비도록 둔다.
 */
const entry = process.argv[1];
if (entry !== undefined && /(?:^|[\\/])cli\.ts$/.test(entry)) {
  process.exitCode = await runArchiveCli(process.argv.slice(2), process.env);
}
