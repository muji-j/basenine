#!/usr/bin/env node
/**
 * **정정 감지 · 자동 재수집 — 진입점**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D1 · D8 · D9).
 *
 *   node scripts/correction-refetch.ts --db data/bb.sqlite --archive data/archive --work-dir /tmp/correction-refetch [--plan-only]
 *
 * 외부 대조가 진행 중 시즌에서 찾을 결함 후보를 **관문(`외부 대조` 단계)보다 먼저** 감지하고, 그 차이를 만들 수 있는 경기만
 * 이 실행 안에서 다시 받아 다시 적재한다. 풀리지 않으면 관문이 지금처럼 막는다(사용자 결정 ②) — **남은 결함으로 이 단계가
 * 실패하지 않는다.** 판단은 전부 순수 모듈 `scripts/correction-plan.ts` 에 있고, 여기는 자식 실행·파일·git·DB 의 배선이다.
 *
 * **차례**(설계 D9 의 표): 1 이력 읽기 → 2 사전 감지 → 3 ① 사전 이력 갱신 → 4 계획 → 5 받기(`cli-games.ts`) → 6 다시 적재 →
 * 7 ③ 시도 기록 → 8 사후 감지 → 9 ④ 사후 이력 갱신 → 10 ⑤ 소진 → 11 쓰기(`report.json` · `report.txt`(표준출력에도) ·
 * `history.base` · `history.next.json`) → 12 종료.
 *
 * **env**: `BB_ARCHIVER_CONTACT`(받기 도구에만 env 로 물려준다 — 명령줄에 남기지 않는다) · `BB_REFETCH_DATES`(수동 날짜 · 날짜 자리를
 * 나눠 쓴다) · `BB_RUN_SLOT`(`scheduled`·`retry`·`manual`) · `BB_COLLECT_STARTED_AT`(잡 시작) · `GITHUB_RUN_ID` · `GITHUB_REF_NAME`.
 *
 * **종료 코드**: **0** — 할 일 없음 · 건너뜀 · 받았는데 결함이 남음 · 마감·예산·고통 신호로 일부만(남은 결함의 판정은 관문의 몫) ·
 * 감지기 오류 · 손상된 이력(`history_invalid`). **1** — 받기·기록·사본 실패 · 받기 결과 없음 · 자식 시간 제한 · 다시 적재 실패 ·
 * 계획·DB 읽기 실패 · 연락처 없음 · 산출 실패 · 예상 밖 예외(**보고와 다음 이력은 그 전에 이미 썼다** · P2-5). **2** — 인자가 틀렸다
 * (아무것도 하지 않았다 · 작업 폴더도 안 건드린다).
 *
 * `--plan-only` — 감지 → 계획 → 보고만. **받기·적재·이력 쓰기 0 · git 0**(이력은 작업 트리 사본을 읽는다). 설계 D13 의 실측 검증용이다.
 *
 * ⚠**시계는 이 파일에서 한 번만 읽는다**(M6 · `scripts/test/clock-injection.test.ts` 의 허용 목록 1) — `main` 은 주입받은
 *   `deps.now()` 를 **한 번** 부르고, 파일로 실행될 때 그 함수가 진짜 시계다.
 * ⚠**import 만으로는 아무것도 하지 않는다** — 파일로 실행될 때만 `main` 을 부른다(시험은 `main(deps)` 에 가짜를 넣는다).
 * ⚠`process.exit()` 를 부르지 않는다 — `exitCode` 를 세운다(`scripts/test/exit-code.test.ts`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { jstDate, parseRefetchDates } from "./date-window.ts";
import { openCandidateDb } from "./correction-candidates.ts";
import type { CandidateDb } from "./correction-candidates.ts";
import {
  CHILD_TIMEOUT_MS,
  EMPTY_HISTORY,
  FETCH_DELAY_MS,
  HISTORY_MAX_BYTES,
  HISTORY_PATH,
  PlanError,
  RELOAD_MAX_WRITES,
  WORK_FILES,
  afterValues,
  fetchChildTimeoutMs,
  gamesTxt,
  parseHistory,
  planRefetch,
  readDetect,
  readFetchResult,
  renderReport,
  serializeHistory,
  settleHistory,
  shouldReload,
  stepExitCode,
  updateHistory,
} from "./correction-plan.ts";
import type { AfterValue, ChildExit, DetectRead, FetchRead, History, Plan, RunRecord, SettleOutput } from "./correction-plan.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 자식 도구(저장소 뿌리 기준) */
const CROSSCHECK = "packages/aggregate/tools/crosscheck.ts";
const CLI_GAMES = "packages/archiver/src/cli-games.ts";
const LOAD_ARCHIVE = "packages/store/tools/load-archive.ts";

/** 자식 하나 — `node <args…>` 로 띄운다 */
export interface ChildSpec {
  readonly label: "detect-before" | "detect-after" | "fetch" | "reload";
  /** node 에 넘기는 인자(첫째가 스크립트 경로) */
  readonly args: readonly string[];
  /** ⚠연락처(`BB_ARCHIVER_CONTACT`)는 받기 도구의 env 에만 든다 */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}

/** 원격 이력 읽기(git) — 성공이면 바이트(파일이 없으면 null), 실패면 사유 */
export type RemoteHistory = { readonly ok: true; readonly bytes: Uint8Array | null } | { readonly ok: false; readonly reason: string };

export interface MainDeps {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 시계 — **한 번만** 부른다(M6) */
  readonly now: () => Date;
  /** 저장소 뿌리 — 자식 도구의 경로와 작업 트리 사본(`ops/correction-refetch.json`)의 기준 */
  readonly root: string;
  readonly runChild: (spec: ChildSpec) => ChildExit;
  /** `origin/<ref>` 의 이력 파일을 읽는다(`git fetch` 60초 → `cat-file -e` 로 없음/실패를 가른다 → `git show`) */
  readonly readRemoteHistory: (ref: string) => RemoteHistory;
  readonly openDb: (dbPath: string) => CandidateDb;
  /** 표준출력 한 덩어리(보고 · `::warning::`) */
  readonly out: (text: string) => void;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const childOk = (c: ChildExit): boolean => !c.timedOut && c.code === 0;
/** git 의 옵션으로 읽히지 않는 가지 이름만(`-` 로 시작하면 옵션 주입이다) */
const SAFE_REF = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

/**
 * 자식이 남긴 결과 파일 — 없으면 `text: null`. ⚠ENOENT 가 아닌 읽기 오류도 「결과를 못 읽었다」로 돌려준다
 *   (감지면 `detector_error`, 받기면 「결과 없음」 — 그 갈래의 규칙대로 가고 실행 전체를 「예상 밖」으로 끊지 않는다).
 */
function readResult(path: string): { text: string | null; error: string | null } {
  try {
    return { text: readFileSync(path, "utf8"), error: null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { text: null, error: null };
    return { text: null, error: `결과 파일을 못 읽었다(${errorText(e)})` };
  }
}

/** `.tmp-<pid>` 에 쓰고 `rename` 한다 — 읽는 쪽(기록 단계 · 관문)이 반쯤 쓴 파일을 보지 않는다 */
function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** 처음 쓸 때만 연다 — 관문 1~9 에서 끝나는 실행은 DB 를 열지 않는다 */
function lazyDb(open: (p: string) => CandidateDb, path: string): { get: () => CandidateDb; close: () => void } {
  let db: CandidateDb | null = null;
  return {
    get: () => (db ??= open(path)),
    close: () => {
      if (db === null) return;
      const d = db;
      db = null;
      // ⚠읽기 전용 연결이다 — 읽은 값은 이미 손에 있고, 닫기 실패가 그 값의 정오를 바꾸지 않는다
      try {
        d.close();
      } catch {
        /* 닫기 실패는 읽은 값과 무관하다 */
      }
    },
  };
}

interface HistoryRead {
  readonly bytes: Uint8Array | null;
  readonly source: "remote" | "worktree";
  /** 작업 트리 사본을 읽다가 ENOENT 가 아닌 오류가 났다(→ 손상으로 다룬다 · 빈 이력으로 받지 않는다) */
  readonly readError: string | null;
}

/**
 * 이력 읽기(설계 D8 의 「읽기」) — **원격 최신에서 읽는다**(체크아웃 사본은 줄을 섰던 실행이면 낡았다).
 * 원격을 못 읽으면 작업 트리 사본으로 물러서고 경고한다. `--plan-only` 는 git 을 부르지 않고 작업 트리 사본만 읽는다.
 */
function readHistoryBytes(deps: MainDeps, planOnly: boolean, ref: string, warn: (s: string) => void): HistoryRead {
  if (!planOnly) {
    if (ref === "" || !SAFE_REF.test(ref)) {
      warn(
        `GITHUB_REF_NAME 이 ${ref === "" ? "없다" : `가지 이름 모양이 아니다(${JSON.stringify(ref)})`} — 원격 이력을 못 읽어 작업 트리 사본을 쓴다 ` +
          "(그 판 위에 쓴 이력은 기록 단계의 base 대조가 거른다)",
      );
    } else {
      const r = deps.readRemoteHistory(ref);
      if (r.ok) return { bytes: r.bytes, source: "remote", readError: null };
      warn(`원격 이력(origin/${ref}:${HISTORY_PATH})을 못 읽었다 — ${r.reason} · 작업 트리 사본으로 물러선다`);
    }
  }
  try {
    return { bytes: readFileSync(join(deps.root, HISTORY_PATH)), source: "worktree", readError: null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { bytes: null, source: "worktree", readError: null };
    return { bytes: null, source: "worktree", readError: `작업 트리 사본을 못 읽었다(${errorText(e)})` };
  }
}

/**
 * 진입 함수 — 종료 코드를 돌려준다(설계 D9). ⚠시계(`deps.now`)는 **한 번** 부른다.
 */
export function main(deps: MainDeps): number {
  // 0. 인자 — 틀리면 아무것도 하지 않는다(작업 폴더도 안 건드린다)
  let values: { db?: string; archive?: string; "work-dir"?: string; "plan-only"?: boolean };
  try {
    values = parseArgs({
      args: [...deps.argv],
      options: {
        db: { type: "string" },
        archive: { type: "string" },
        "work-dir": { type: "string" },
        "plan-only": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    deps.out(`::error::정정 자동 재수집 — 인자를 못 읽었다: ${errorText(e)}`);
    return 2;
  }
  if (!values.db || !values.archive || !values["work-dir"]) {
    deps.out("::error::정정 자동 재수집 — --db · --archive · --work-dir 가 필요하다");
    return 2;
  }
  const planOnly = values["plan-only"] === true;
  const db = resolve(values.db);
  const archive = resolve(values.archive);
  const work = resolve(values["work-dir"]);
  const at = (name: keyof typeof WORK_FILES): string => join(work, WORK_FILES[name]);
  const warn = (s: string): void => deps.out(`::warning::${s}`);

  // ⚠시계는 여기서 한 번(M6)
  const nowDate = deps.now();
  const now = nowDate.toISOString();
  const env = deps.env;
  const run = (env["GITHUB_RUN_ID"] ?? "").trim() || "local";
  const ref = (env["GITHUB_REF_NAME"] ?? "").trim();
  const slot = env["BB_RUN_SLOT"];
  const collectStartedAt = env["BB_COLLECT_STARTED_AT"];
  // ⚠감지 시즌은 시계를 읽은 시각의 JST 연도다(설계 D3 — `공표 성적표 갱신` 과 같은 규칙)
  const season = Number(jstDate(nowDate).slice(0, 4));
  const manual = parseRefetchDates(env["BB_REFETCH_DATES"]);
  // ⚠연락처는 받기 도구에만 — 다른 자식의 env 에서는 뺀다
  const childEnv: Record<string, string | undefined> = { ...env };
  delete childEnv["BB_ARCHIVER_CONTACT"];

  // 작업 폴더 — 이 실행이 쓸 산출의 옛 판을 먼저 지운다(이 실행이 안 쓴 `history.next.json` 을 기록 단계가 줍지 않게)
  try {
    mkdirSync(work, { recursive: true });
    for (const f of Object.values(WORK_FILES)) rmSync(join(work, f), { force: true });
  } catch (e) {
    deps.out(`::error::정정 자동 재수집 — 작업 폴더를 준비하지 못했다(${work}): ${errorText(e)}`);
    return 1;
  }

  let historySource: "remote" | "worktree" | "none" = "none";
  let base: string | null = null;
  let violation: string | null = null;
  let h0: History | null = null;
  let h: History | null = null;
  let pre: DetectRead | null = null;
  let plan: Plan | null = null;
  let planError: string | null = null;
  let noContact = false;
  let fetch: FetchRead | null = null;
  let reload: ChildExit | null = null;
  let post: DetectRead | null = null;
  let postSource: RunRecord["postSource"] = "none";
  let after: Map<string, AfterValue> | null = null;
  let settle: SettleOutput | null = null;
  let postError: string | null = null;
  let unexpected: string | null = null;

  const detect = (label: "detect-before" | "detect-after", file: "detectBefore" | "detectAfter"): DetectRead => {
    const path = at(file);
    rmSync(path, { force: true });
    const exit = deps.runChild({
      label,
      args: [join(deps.root, CROSSCHECK), db, String(season), "--archive", archive, "--emit", path],
      env: childEnv,
      timeoutMs: CHILD_TIMEOUT_MS.detect,
    });
    const r = readResult(path);
    return r.error !== null ? { ok: false, exit, error: r.error } : readDetect(exit, r.text, season);
  };

  try {
    // 1. 이력 읽기
    const hr = readHistoryBytes(deps, planOnly, ref, warn);
    historySource = hr.source;
    base = hr.bytes === null ? "absent" : sha256(hr.bytes);
    const parsed = hr.readError !== null ? { ok: false as const, violation: hr.readError } : parseHistory(hr.bytes);
    if (parsed.ok) h0 = parsed.history;
    else {
      violation = parsed.violation;
      warn(`정정 재수집 이력 ${HISTORY_PATH} 이 손상됐다 — history_invalid · ${violation} · 받지 않는다 · 원격 파일은 그대로 둔다(런북 §7-I)`);
    }

    // 2. 사전 감지
    pre = detect("detect-before", "detectBefore");

    // 3. ① 사전 이력 갱신
    h = h0 === null ? null : updateHistory(h0, pre, collectStartedAt, now, run);

    // 4. 계획 — 관문 1~9 는 DB 를 읽지 않는다(DB 는 처음 쓸 때 연다)
    const preDb = lazyDb(deps.openDb, db);
    try {
      plan = planRefetch(
        { detect: pre, historyViolation: violation, history: h ?? EMPTY_HISTORY, slot, manual, collectStartedAt, now },
        (q) => preDb.get().candidates(q),
      );
    } catch (e) {
      planError = e instanceof PlanError ? e.message : `후보 DB 를 못 읽었다 — ${errorText(e)}`;
    } finally {
      preDb.close();
    }

    // 5·6. 받기 · 다시 적재
    if (plan?.kind === "fetch" && !planOnly) {
      const contact = (env["BB_ARCHIVER_CONTACT"] ?? "").trim();
      if (contact === "") noContact = true;
      else {
        writeAtomically(at("games"), gamesTxt(plan));
        const resultPath = at("fetchResult");
        const exit = deps.runChild({
          label: "fetch",
          args: [
            join(deps.root, CLI_GAMES),
            "--ids", at("games"),
            "--out", archive,
            "--delay", String(FETCH_DELAY_MS),
            "--deadline", plan.deadline,
            "--result", resultPath,
          ],
          env: { ...childEnv, BB_ARCHIVER_CONTACT: contact },
          timeoutMs: fetchChildTimeoutMs(plan.deadline, now),
        });
        const res = readResult(resultPath);
        fetch = res.error !== null ? { kind: "no_result", exit, error: res.error } : readFetchResult(exit, res.text, plan.games);
        if (shouldReload(fetch)) {
          reload = deps.runChild({
            label: "reload",
            args: [join(deps.root, LOAD_ARCHIVE), archive, db, "--max-writes", RELOAD_MAX_WRITES],
            env: childEnv,
            timeoutMs: CHILD_TIMEOUT_MS.reload,
          });
        }
      }
    }

    // 8. 사후 감지 — 다시 적재를 안 했으면 DB 가 그대로라 사전 결과를 쓴다 · 다시 적재가 실패했으면 하지 않는다(DB 를 믿을 수 없다)
    //    ⚠계획만이면 사후가 없다(받지도 적재하지도 않았다)
    if (plan !== null && !planOnly) {
      if (reload === null) {
        post = pre;
        postSource = "reused_pre";
      } else if (childOk(reload)) {
        post = detect("detect-after", "detectAfter");
        postSource = "detected";
      } else {
        post = null;
        postSource = "skipped";
      }
    }

    // 7·9·10. ③ → ④ → ⑤(차례는 settleHistory 가 고정한다) · 후 값
    if (h !== null && plan !== null && !planOnly) {
      const postDb = lazyDb(deps.openDb, db);
      try {
        settle = settleHistory(
          { history: h, plan, fetch, post, manualDates: manual.ok ? (manual.dates ?? []) : [], collectStartedAt, now, run },
          (q) => postDb.get().candidates(q),
        );
        h = settle.history;
        if (settle.judgeError !== null) postError = `소진 판정의 DB 읽기 — ${settle.judgeError}`;
        if (plan.kind === "fetch" && reload !== null && childOk(reload)) {
          try {
            after = afterValues(plan, (q) => postDb.get().valueIn(q));
          } catch (e) {
            postError ??= `후 값 조회 — ${errorText(e)}`;
          }
        }
      } finally {
        postDb.close();
      }
      for (const k of settle?.newlyExhausted ?? []) {
        const n = settle?.remaining.get(k)?.candidateDates.length ?? 0;
        warn(`소진 — 런북 §7-I · ${k} · 후보 ${String(n)}일을 다 다시 받았는데 남았다`);
      }
    }
  } catch (e) {
    unexpected = errorText(e);
  }

  // 11. 쓰기 — 보고 → history.base → history.next.json(바뀐 경우에만)
  const changed = !planOnly && h !== null && h0 !== null && serializeHistory(h) !== serializeHistory(h0);
  const exit = stepExitCode({ planError, noContact, fetch, reload, postError, writeError: null, unexpected });
  const rec: RunRecord = {
    run,
    slot,
    planOnly,
    now,
    collectStartedAt,
    season,
    history: { source: historySource, ref: ref === "" ? null : ref, base: planOnly ? null : base, violation, written: changed },
    manual,
    pre,
    plan,
    planError,
    noContact,
    fetch,
    reload,
    post,
    postSource,
    after,
    settle,
    postError,
    finalHistory: planOnly ? null : h,
    unexpected,
    exit,
  };
  const report = renderReport(rec);
  let writeError: string | null = null;
  const put = (name: keyof typeof WORK_FILES, text: string): void => {
    try {
      writeAtomically(at(name), text);
    } catch (e) {
      writeError ??= `${WORK_FILES[name]}: ${errorText(e)}`;
    }
  };
  put("reportJson", `${JSON.stringify(report.json, null, 2)}\n`);
  put("reportText", `${report.text}\n`);
  deps.out(report.text);
  if (!planOnly && base !== null) {
    put("historyBase", base);
    if (changed && h !== null) put("historyNext", serializeHistory(h));
  }
  if (writeError !== null) {
    deps.out(`::error::정정 자동 재수집 — 산출 파일을 못 썼다: ${writeError}`);
    return 1;
  }
  return exit;
}

// ── 파일로 실행될 때의 배선(시험은 이 아래를 지나지 않는다) ─────────────────────

/** `node <args>` 를 띄운다 — 출력은 그대로 이 단계의 로그로 흐른다 */
function spawnNode(root: string): (spec: ChildSpec) => ChildExit {
  return (spec) => {
    const r = spawnSync(process.execPath, [...spec.args], {
      cwd: root,
      env: spec.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: spec.timeoutMs,
      windowsHide: true,
    });
    const err = r.error as NodeJS.ErrnoException | undefined;
    return { code: r.status, signal: r.signal, timedOut: err?.code === "ETIMEDOUT", error: err === undefined ? null : err.message };
  };
}

/** git 한 번의 끝 — `spawnSync` 결과에서 이 파일이 읽는 칸만(시험이 가짜를 넣는다 · 진짜 git 0) */
export interface GitExit {
  readonly status: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  /** 띄우지 못했다 · 시간 제한(60초) — 있으면 그 호출은 실패다 */
  readonly error: Error | null;
}

/** git 을 한 번 띄운다 — 파일 실행은 `spawnSync("git", …)`(`spawnGit`), 시험은 가짜 */
export type GitSpawn = (args: readonly string[], opts: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }) => GitExit;

/**
 * 원격 이력 읽기(git) 자식의 env. ⚠**연락처(`BB_ARCHIVER_CONTACT`)를 뺀다** — 연락처는 받기 도구의 env 에만 간다(최소 권한 ·
 * 3중 검토 2차 Minor · 다른 자식의 `childEnv` 와 같은 규칙). ⚠**메시지를 영어로 고정한다**(`LC_ALL=C`) — 「파일 없음」 판정이
 * git 의 문장에 기댄다(`PATH_NOT_IN_REV`). 번역된 git 이면 「없음」이 「실패」로 읽혀 매번 경고하고 작업 트리 사본으로 물러선다.
 */
export function gitEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env, LC_ALL: "C" };
  delete out["BB_ARCHIVER_CONTACT"];
  return out;
}

/**
 * `cat-file -e <rev>:<path>` 의 비0 가운데 **「그 경로가 그 커밋에 없다」만** 「파일 없음」이다(설계 D8 · 3중 검토 1차 P3-1).
 * git 은 경로가 없으면 `fatal: path '<p>' does not exist in '<rev>'`(작업 트리에는 있으면 `… exists on disk, but not in '<rev>'`)를 찍고
 * 128 로 끝난다(둘 다 실측). ⚠그런데 **객체를 못 읽어도 비0** 이다 — 블롭이 없으면(부분 clone · 손상) **말없이 1** 이다(`cat-file -e` 는
 * 객체 유무만 종료코드로 낸다 — git 소스 근거 · 안 쟀다). 그것까지 「없음」으로 읽으면 빈 이력으로 새 일화를 열어 이미 받은 경기를
 * 다시 받는다(L1) — 그래서 그 밖의 비0 은 실패(→ 작업 트리 사본 · 경고)다.
 * ⚠**남는 한계**: 트리 객체를 못 읽을 때는 git 의 경로 진단이 같은 「없다」 문장을 낼 수 있어(git 소스 근거 · 안 쟀다) 그 갈래는 여전히
 * 「없음」으로 읽힌다. 바로 앞의 `^{commit}` 확인이 막는 것은 커밋까지다.
 */
const PATH_NOT_IN_REV = /(?:does not exist in|exists on disk, but not in) '/;

/**
 * `origin/<ref>` 의 이력 파일(설계 D8) — `git fetch --quiet origin <ref>`(60초) → 커밋이 있는지 → `cat-file -e` 로 「없음」과 「실패」를
 * 가른다(`PATH_NOT_IN_REV`) → `git show`. ⚠가지 이름은 인자 하나로 넘긴다(셸을 안 거친다 · `-` 로 시작하는 이름은 부르기 전에 거른다).
 */
export function gitReadHistory(root: string, ref: string, env: Readonly<Record<string, string | undefined>>, spawn: GitSpawn): RemoteHistory {
  const childEnv = gitEnv(env);
  const git = (args: readonly string[]): GitExit => spawn(args, { cwd: root, env: childEnv });
  const why = (r: GitExit): string =>
    r.error !== null ? r.error.message : `종료 ${String(r.status)}${r.stderr.length > 0 ? ` · ${Buffer.from(r.stderr).toString("utf8").trim().slice(0, 200)}` : ""}`;
  const fetched = git(["fetch", "--quiet", "origin", ref]);
  if (fetched.error !== null || fetched.status !== 0) return { ok: false, reason: `git fetch 실패(${why(fetched)})` };
  const remote = `origin/${ref}`;
  const commit = git(["cat-file", "-e", `${remote}^{commit}`]);
  if (commit.error !== null || commit.status !== 0) return { ok: false, reason: `${remote} 커밋을 못 찾았다(${why(commit)})` };
  const exists = git(["cat-file", "-e", `${remote}:${HISTORY_PATH}`]);
  if (exists.error !== null) return { ok: false, reason: `git cat-file 실패(${why(exists)})` };
  if (exists.status !== 0) {
    if (PATH_NOT_IN_REV.test(Buffer.from(exists.stderr).toString("utf8"))) return { ok: true, bytes: null };
    return { ok: false, reason: `git cat-file 실패 — 「그 경로가 그 커밋에 없다」가 아니다(${why(exists)})` };
  }
  const shown = git(["show", `${remote}:${HISTORY_PATH}`]);
  if (shown.error !== null || shown.status !== 0) return { ok: false, reason: `git show 실패(${why(shown)})` };
  return { ok: true, bytes: shown.stdout };
}

/** 진짜 git — 호출마다 60초 · 출력 상한은 이력 상한의 2배 */
const spawnGit: GitSpawn = (args, opts) => {
  const r = spawnSync("git", [...args], {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv,
    timeout: CHILD_TIMEOUT_MS.git,
    maxBuffer: HISTORY_MAX_BYTES * 2,
    windowsHide: true,
  });
  // ⚠띄우지 못하면(ENOENT) 출력 칸이 비어 온다(`undefined` · 실측) — 빈 바이트로 받고 실패는 `error` 가 말한다
  return { status: r.status, stdout: r.stdout ?? new Uint8Array(), stderr: r.stderr ?? new Uint8Array(), error: r.error ?? null };
};

/**
 * **파일로 실행될 때만** 진입한다. ⚠경로 전체가 아니라 **파일 이름**으로 가른다(Windows 의 드라이브 문자·구분자 차이로
 *   전체 비교가 거짓이 되면 조용히 아무것도 안 하고 0 으로 끝난다 — `cli-games.ts` 와 같은 방식).
 */
const entry = process.argv[1];
if (entry !== undefined && /(?:^|[\\/])correction-refetch\.ts$/.test(entry)) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    env: process.env,
    // ⚠**진짜 시계는 여기 한 곳이다**(M6 · 허용 목록 1)
    now: () => new Date(),
    root: ROOT,
    runChild: spawnNode(ROOT),
    readRemoteHistory: (ref) => gitReadHistory(ROOT, ref, process.env, spawnGit),
    openDb: openCandidateDb,
    out: (text) => console.log(text),
  });
}
