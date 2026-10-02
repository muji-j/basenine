#!/usr/bin/env node
/**
 * 정정 자동 재수집의 받기 도구 — **경기 ID 목록만** 받는다(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7-2).
 *
 *   node packages/archiver/src/cli-games.ts --ids <work>/games.txt --out data/archive --delay 3000 \
 *     --deadline <ISO> --result <work>/fetch-result.json
 *
 * 부르는 쪽은 `scripts/correction-refetch.ts`(진입점)다. 사람이 손으로 부르는 도구가 아니다 — 수동 복구는 `refetch_dates` 다.
 *
 * - **연락처는 env `BB_ARCHIVER_CONTACT` 에서만** 읽는다 — 진입점이 명령줄에 남기지 않으려고 env 로 물려준다(설계 D1). 비면 종료 2.
 * - `--ids` 는 한 줄에 경기 ID(`<시즌>/<MMDD>/<슬러그>` · DB `game.game_id`) 하나. **받는 차례 = 줄 차례**(진입점이 고른 차례 · D6).
 * - **월간 일정을 받지 않는다** — 경기 ID 가 곧 주소다(`gameRefFromId`). 선수·予告先発·공표표도 받지 않는다(D7-7).
 * - 결과는 `--result` 에 JSON(스키마 1)으로 **원자적으로** 쓴다(`<path>.tmp-<pid>` → `rename`). 시작할 때 그 경로를 먼저 지운다 —
 *   입력이 틀려 끝나도 옛 결과를 이 실행의 것으로 읽지 않게.
 *
 * **종료 코드**(D7-6):
 * - **0** — `prepare_failed`·`commit_failed`·`snapshot_failed` 가 없다(마감·예산·고통 신호로 멈춘 것은 실패가 아니다).
 * - **1** — 그 셋 중 하나라도 있다. 또는 결과 JSON 을 못 썼다.
 * - **2** — 입력이 틀렸다. **요청 0** 이다(L1 의 마지막 방어선): ID 모양 · 줄 수 > `AUTO_REFETCH_MAX_GAMES` · 중복 · 빈 목록 ·
 *   `--deadline` 이 정규 UTC ISO 가 아님 · `--delay` 가 L1 하한 미만 · 연락처 없음/닿지 않음 · 인자 누락·모름.
 *   ⚠**fetcher 를 만들기 전에 전부 검사한다** — 그래서 어느 검사가 회귀해도 연락처 검사(`buildUserAgent`)가 마지막 걸쇠로 남는다.
 */
import { parseArgs } from "node:util";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { AUTO_REFETCH_MAX_GAMES, AUTO_REFETCH_MAX_HTTP } from "@bb-app/store/refetch-limit";
import { systemClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { gameIdOf, gameRefFromId } from "./discover.ts";
import type { GameRef } from "./discover.ts";
import { L1_MIN_DELAY_MS, buildUserAgent, parseDelayMs } from "./fetcher.ts";
import type { SleepImpl } from "./fetcher.ts";
import { newFetchMeter } from "./metered-fetch.ts";
import type { TimedFetchImpl, TimeoutSignalImpl } from "./metered-fetch.ts";
import { createRefetchFetcher, refetchGames } from "./refetch-games.ts";
import type { RefetchGame } from "./refetch-games.ts";
import { LocalSink } from "./sink.ts";

/**
 * `--delay` 기본값(ms). ⚠**정정 자동 재수집의 시간 계산(설계 D7-8)이 이 값에 기댄다** —
 * `scripts/test/correction-budget.test.ts`(T13)가 이 값을 읽어 잡 최악을 다시 셈한다.
 */
export const CLI_GAMES_DEFAULT_DELAY_MS = 3000;

/** `--ids` 내용 → 경기. 끝 줄바꿈 하나만 허용한다 — 빈 줄·공백·CR 이 섞인 줄은 ID 가 아니다(M7: 모양이 틀리면 실패) */
export function parseGameIds(text: string): { ok: true; refs: GameRef[] } | { ok: false; error: string } {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return { ok: false, error: "경기 ID 가 0개다 — 받을 경기가 없으면 부르지 않는다" };
  if (lines.length > AUTO_REFETCH_MAX_GAMES) {
    return { ok: false, error: `경기 ID 가 ${String(lines.length)}줄이다 — 자동 재수집은 ${String(AUTO_REFETCH_MAX_GAMES)}경기까지다(L1)` };
  }
  const refs: GameRef[] = [];
  const seen = new Set<string>();
  for (const [i, line] of lines.entries()) {
    let ref: GameRef;
    try {
      ref = gameRefFromId(line);
    } catch (err) {
      return { ok: false, error: `${String(i + 1)}번째 줄의 경기 ID 가 틀렸다 — ${err instanceof Error ? err.message : String(err)}` };
    }
    const id = gameIdOf(ref);
    if (seen.has(id)) return { ok: false, error: `같은 경기 ID 가 두 번 있다(${String(i + 1)}번째 줄): ${id} — 두 번 받지 않는다(L1)` };
    seen.add(id);
    refs.push(ref);
  }
  return { ok: true, refs };
}

/**
 * `--deadline` → UTC 밀리초. **정규 UTC ISO(`Date#toISOString()` 모양)만 받는다** — 못 읽으면 `null`.
 * ⚠시간대 없는 값은 `Date.parse` 가 **실행 기계의 현지 시간**으로 읽어 JST 기계와 UTC CI 에서 9시간 갈린다(`store/src/meta.ts` 와 같은 함정).
 *   진입점은 `new Date(…).toISOString()` 을 넘기므로(설계 D6) 그 밖의 모양은 계약 위반이다.
 */
export function parseDeadline(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  // ⚠`new Date(ms)` 는 주어진 값을 해석할 뿐 시계를 읽지 않는다(M6)
  return new Date(ms).toISOString() === raw ? ms : null;
}

/** 진입 함수에 주입하는 것 — **시험 전용**이다. 파일로 실행될 때는 전부 기본값(네이티브 fetch · 진짜 sleep · 시스템 시계) */
export interface CliGamesIo {
  fetchImpl?: TimedFetchImpl;
  sleep?: SleepImpl;
  clock?: Clock;
  timeoutSignal?: TimeoutSignalImpl;
  /** 사람이 읽는 줄(기본: 표준오류) */
  log?: (line: string) => void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** ⚠모르는 인자·위치 인자는 던진다(`strict`) — `--contact` 도 받지 않는다(연락처는 env 로만) */
function readArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      ids: { type: "string" },
      out: { type: "string" },
      delay: { type: "string", default: String(CLI_GAMES_DEFAULT_DELAY_MS) },
      deadline: { type: "string" },
      result: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  }).values;
}

/**
 * 진입 함수 — 종료 코드를 돌려준다(던지지 않는다 · 결함으로 던지면 파일 실행은 0·2 가 아닌 코드로 끝난다).
 * ⚠`process.exit()` 를 부르지 않는다 — 네트워크 뒤에 부르면 Windows 에서 libuv 가 죽는다(`cli.ts` 머리말).
 */
export async function runCliGames(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: CliGamesIo = {}): Promise<0 | 1 | 2> {
  const log = io.log ?? ((line: string) => console.error(line));
  const reject = (message: string): 2 => {
    log(message);
    return 2;
  };

  let values: ReturnType<typeof readArgs>;
  try {
    values = readArgs(argv);
  } catch (err) {
    return reject(`인자를 못 읽었다 — ${errorText(err)}`);
  }

  // ⚠결과 경로를 먼저 정하고 옛 결과를 지운다 — 아래 어느 검사에서 끝나도 「결과 없음」이 이 실행의 사실이 되게
  const resultPath = values.result;
  if (resultPath === undefined || resultPath === "") return reject("--result <결과 JSON 경로> 가 필요하다");
  try {
    await rm(resultPath, { force: true });
  } catch (err) {
    return reject(`--result 의 옛 파일을 못 지웠다: ${errorText(err)}`);
  }

  const contact = (env["BB_ARCHIVER_CONTACT"] ?? "").trim();
  if (contact === "") {
    return reject(
      "연락처가 필요하다 — BB_ARCHIVER_CONTACT 환경변수를 설정하라.\n" +
        "이유: 연락처 없는 UA로 긁으면 상대가 문제를 알릴 방법이 차단밖에 없다 (CLAUDE.md L1).",
    );
  }

  // ⚠`Number(values.delay)` 를 직접 넘기지 마라 — `NaN` 이 간격 0이 된다(`fetcher.ts` 의 `parseDelayMs`)
  const delayMs = parseDelayMs(values.delay);
  if (delayMs === null) return reject(`--delay 는 ${String(L1_MIN_DELAY_MS)}ms 이상이어야 한다 (L1: 1req/2~5초): ${String(values.delay)}`);

  const deadlineMs = parseDeadline(values.deadline);
  if (deadlineMs === null) {
    return reject(`--deadline 이 시각으로 안 읽힌다 — 정규 UTC ISO(toISOString 모양)만 받는다: ${JSON.stringify(values.deadline ?? null)}`);
  }

  const out = values.out;
  if (out === undefined || out === "") return reject("--out <아카이브 폴더> 가 필요하다");
  const idsPath = values.ids;
  if (idsPath === undefined || idsPath === "") return reject("--ids <경기 ID 파일> 이 필요하다");

  let text: string;
  try {
    text = await readFile(idsPath, "utf8");
  } catch (err) {
    return reject(`--ids 파일을 못 읽었다: ${errorText(err)}`);
  }
  const parsed = parseGameIds(text);
  if (!parsed.ok) return reject(parsed.error);

  // ⚠**마지막 걸쇠** — 닿지 않는 연락처(예약 도메인)는 빈 연락처와 같다. fetcher 를 만들기 **전에** 부른다
  let userAgent: string;
  try {
    userAgent = buildUserAgent(contact);
  } catch (err) {
    return reject(errorText(err));
  }

  const clock = io.clock ?? systemClock;
  const meter = newFetchMeter();
  const fetcher = createRefetchFetcher({
    userAgent,
    minDelayMs: delayMs,
    clock,
    meter,
    fetchImpl: io.fetchImpl ?? (globalThis.fetch as unknown as TimedFetchImpl),
    ...(io.sleep !== undefined ? { sleep: io.sleep } : {}),
    ...(io.timeoutSignal !== undefined ? { timeoutSignal: io.timeoutSignal } : {}),
  });
  const deadline = new Date(deadlineMs).toISOString();

  log(
    `정정 자동 재수집 받기 — 경기 ${String(parsed.refs.length)}건 · 저장 ${out} · 요청 간격 ${String(delayMs)}ms · ` +
      `마감 ${deadline} · HTTP 예산 ${String(AUTO_REFETCH_MAX_HTTP)}`,
  );
  const result = await refetchGames(
    parsed.refs,
    { fetcher, sink: new LocalSink(out), clock, meter },
    {
      deadlineMs,
      maxHttp: AUTO_REFETCH_MAX_HTTP,
      onGame: (game, detail) => {
        log(gameLine(game));
        for (const p of detail.pages) if (p.outcome === "failed") log(`  FAILED ${p.url} — ${String(p.error)}`);
        for (const note of detail.notes) log(`  ${note}`);
      },
    },
  );

  const count = (pred: (g: RefetchGame) => boolean): number => result.games.filter(pred).length;
  log(
    `합계: ${String(result.games.length)}경기 중 기록 ${String(count((g) => g.status === "recorded"))} · ` +
      `받기 실패 ${String(count((g) => g.status === "prepare_failed"))} · ` +
      `기록 실패 ${String(count((g) => g.status === "commit_failed"))}` +
      `(되돌림 ok ${String(count((g) => g.rollback === "ok"))} / 실패 ${String(count((g) => g.rollback === "failed"))}) · ` +
      `건너뜀 ${String(count((g) => g.status === "skipped"))}${result.stopped === null ? "" : `(처음 멈춘 사유 ${result.stopped})`} · ` +
      `논리 페이지 ${String(result.page_fetches)} · HTTP 전송 ${String(result.http_attempts)} · 상태별 ${JSON.stringify(result.by_status)}` +
      (result.distress ? " · 고통 신호 있음" : ""),
  );

  try {
    await writeJsonAtomically(resultPath, { schema: 1, deadline, ...result });
  } catch (err) {
    log(`결과 JSON 을 못 썼다 — 부르는 쪽은 결과 없음(종료 1)으로 센다: ${errorText(err)}`);
    return 1;
  }
  return result.exit;
}

function gameLine(g: RefetchGame): string {
  if (g.status === "skipped") return `${g.id}  skipped:${String(g.reason)}`;
  const p = g.pages;
  return (
    `${g.id}  ${g.status} · 페이지 ${String(g.page_fetches)}장 ` +
    `(신규 ${String(p.stored)} / 변경없음 ${String(p.unchanged)} / 부재 ${String(p.absent)} / 실패 ${String(p.failed)} / 보류 ${String(p.held)}) · ` +
    `HTTP ${String(g.http_attempts)}${g.rollback === null ? "" : ` · 되돌림 ${g.rollback}`}`
  );
}

/** `<path>.tmp-<pid>` 에 쓰고 `rename` 한다 — 읽는 쪽이 반쯤 쓴 파일을 보지 않는다(`crosscheck.ts` 의 감지 결과와 같은 규칙) */
async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * **파일로 실행될 때만** 진입한다 — import 만으로는 아무것도 하지 않는다(시험·T13 이 상수를 읽으러 import 한다).
 * ⚠경로 전체가 아니라 **파일 이름**으로 가른다 — Windows 에서 드라이브 문자 대소문자·구분자가 `import.meta.url` 과 달라
 *   전체 비교가 거짓이 되면 **조용히 아무것도 안 하고 0 으로 끝난다**(`heartbeat.ts` · `verify-deploy.ts` 와 같은 방식).
 */
const entry = process.argv[1];
if (entry !== undefined && /(?:^|[\\/])cli-games\.ts$/.test(entry)) {
  process.exitCode = await runCliGames(process.argv.slice(2), process.env);
}
