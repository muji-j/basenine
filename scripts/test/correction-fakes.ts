/**
 * 정정 자동 재수집 시험의 **가짜 세계** — 진입점(`main`)을 진짜 자식 프로세스·git·DB 없이 돌린다
 * (설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D13 의 T3 ⑩ · T5 · T9).
 *
 * ⚠**시험 파일이 아니다**(`*.test.ts` 가 아니라 러너가 따로 돌리지 않는다) — 시험 파일들이 가져다 쓴다.
 * ⚠**시계를 안 읽는다**(M6 · `clock-injection.test.ts` 가 이 파일도 센다) — 시각은 전부 고정 문자열이다.
 * ⚠**외부 요청 0 · 진짜 git 0 · 진짜 받기 도구 0** — 자식 실행은 아래 `child` 가 흉내 낸다:
 *   - 감지(`crosscheck.ts --emit`) → 세계가 정한 결과 JSON 을 `--emit` 경로에 쓴다
 *   - 받기(`cli-games.ts`) → `--ids` 를 읽어 「아카이브」의 취득 시각을 그 실행의 시각으로 올리고 결과 JSON 을 쓴다
 *   - 다시 적재(`load-archive.ts`) → 「아카이브」의 취득 시각을 「DB」로 옮긴다(실물: box 사이드카 → `game.fetched_at`)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../correction-refetch.ts";
import type { ChildSpec, MainDeps } from "../correction-refetch.ts";
import { WORK_FILES, defectKey } from "../correction-plan.ts";
import type { AfterValue, CandidateQuery, CandidateRow, ChildExit, DetectDefect } from "../correction-plan.ts";
import type { CandidateDb } from "../correction-candidates.ts";

/** 잡 시작(워크플로 `date -u +%Y-%m-%dT%H:%M:%SZ` 모양) */
export const START = "2026-09-28T20:40:57Z";
/** 진입점이 읽은 「지금」 — 잡 시작 10분 6초 뒤 */
export const NOW = "2026-09-28T20:51:03.000Z";
export const RUN = "36480899578";
/** 후보 경기의 옛 취득 시각(일화 시작보다 앞) */
export const OLD = "2026-08-01T00:00:00.000Z";
export const K_WP = "2026|t|pitching|91095136|暴投";

/** 이번 사고의 결함 후보 한 줄(설계 §1 · 阪神 髙橋遥 暴投 우리 3 공표 2) */
export const INCIDENT: DetectDefect = {
  team: "t",
  kind: "pitching",
  player_id: "91095136",
  name: "髙橋",
  field: "暴投",
  ours: "3",
  published: "2",
};

export function defect(o: Partial<DetectDefect> = {}): DetectDefect {
  return { ...INCIDENT, ...o };
}

/** `2026/0917/t-c-20` → `2026-09-17` */
export function dateOfId(id: string): string {
  const m = /^(\d{4})\/(\d{2})(\d{2})\//.exec(id);
  if (m === null) throw new Error(`시험 재료의 경기 ID 가 틀렸다: ${id}`);
  return `${m[1]!}-${m[2]!}-${m[3]!}`;
}

export interface DetectOpts {
  status?: "no_defects" | "defects" | "unmeasured";
  reason?: string | null;
  asOf?: { date: string | null; source: string };
  defects?: readonly DetectDefect[];
  season?: number;
  competition?: string;
}

/** 감지 결과 JSON(스키마 1 · 작업 A 의 실제 칸 차례) */
export function detectJson(o: DetectOpts = {}): string {
  const defects = o.defects ?? [INCIDENT];
  const status = o.status ?? (defects.length === 0 ? "no_defects" : "defects");
  const unmeasured = status === "unmeasured";
  return `${JSON.stringify(
    {
      schema: 1,
      season: o.season ?? 2026,
      competition: o.competition ?? "regular",
      status,
      reason: unmeasured ? (o.reason ?? "tables_missing") : null,
      reason_detail: unmeasured ? "공표표 24장 중 0장만 읽었다 — 없음: idb1_g" : null,
      as_of: o.asOf ?? { date: "2026-09-27", source: "genzai" },
      tables: { expected: 24, read: unmeasured ? 0 : 24, with_genzai: unmeasured ? 0 : 24 },
      compared: { players: unmeasured ? 0 : 1022, fields: unmeasured ? 0 : 18275 },
      unmatched: { ours: 6, published: 99 },
      folded: 702,
      defects,
    },
    null,
    2,
  )}\n`;
}

export interface FakeGameOutcome {
  status?: "recorded" | "prepare_failed" | "commit_failed" | "skipped";
  reason?: string | null;
  rollback?: "ok" | "failed" | null;
}

/** 받기 결과 JSON(작업 B 의 실제 칸 차례). `exit` 를 안 주면 실패 경기 유무로 정한다 */
export function fetchJson(
  ids: readonly string[],
  outcome: (id: string, i: number) => FakeGameOutcome = () => ({}),
  o: { exit?: 0 | 1; stopped?: string | null; distress?: boolean; deadline?: string } = {},
): string {
  let pages = 0;
  let failed = false;
  const games = ids.map((id, i) => {
    const r = outcome(id, i);
    const status = r.status ?? "recorded";
    const started = status !== "skipped";
    if (started) pages += 4;
    if (status === "prepare_failed" || status === "commit_failed" || r.reason === "snapshot_failed") failed = true;
    return {
      id,
      date: dateOfId(id),
      status,
      reason: status === "skipped" ? (r.reason ?? "circuit_open") : null,
      pages: { stored: status === "recorded" ? 4 : 0, unchanged: 0, absent: 0, failed: started && status !== "recorded" ? 1 : 0, held: 0 },
      page_fetches: started ? 4 : 0,
      http_attempts: started ? 4 : 0,
      rollback: status === "commit_failed" ? (r.rollback ?? "ok") : null,
      box_sha_before: started ? "a".repeat(64) : null,
      box_sha_after: started ? "b".repeat(64) : null,
    };
  });
  const firstSkipped = games.find((g) => g.status === "skipped");
  return `${JSON.stringify(
    {
      schema: 1,
      deadline: o.deadline ?? "2026-09-28T21:05:57.000Z",
      page_fetches: pages,
      http_attempts: pages,
      by_status: pages === 0 ? {} : { "200": pages },
      distress: o.distress ?? false,
      stopped: o.stopped !== undefined ? o.stopped : (firstSkipped?.reason ?? null),
      games,
      exit: o.exit ?? (failed ? 1 : 0),
    },
    null,
    2,
  )}\n`;
}

export const sha256 = (b: string | Uint8Array): string => createHash("sha256").update(b).digest("hex");

const exitOf = (code: number | null, extra: Partial<ChildExit> = {}): ChildExit => ({
  code,
  signal: null,
  timedOut: false,
  error: null,
  ...extra,
});

function argAfter(args: readonly string[], name: string): string {
  const i = args.indexOf(name);
  const v = i === -1 ? undefined : args[i + 1];
  if (v === undefined) throw new Error(`가짜 자식: ${name} 인자가 없다 — ${args.join(" ")}`);
  return v;
}

export interface SpawnRecord {
  label: ChildSpec["label"];
  args: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs: number;
}

/** 가짜 세계 — 필요한 것만 갈아 끼운다 */
export interface World {
  readonly dir: string;
  /** 커밋된(원격) 이력 바이트 — null 이면 파일 없음 */
  remote: Uint8Array | null;
  /** 원격 읽기(git)를 실패시킨다 */
  remoteFails: boolean;
  /** 원격 읽기(git)를 부른 횟수 */
  remoteReads: number;
  /** 키 → 그 키의 후보 경기 ID(그 키의 술어를 만족한다고 본다) */
  keyGames: Map<string, string[]>;
  /** DB 의 `game.fetched_at` */
  dbFetched: Map<string, string>;
  /** 아카이브 box 사이드카의 본 시각(다시 적재가 DB 로 옮긴다) */
  archiveFetched: Map<string, string>;
  /** 감지가 낼 것 — 사전(before)·사후(after) */
  detect: (phase: "before" | "after") => { exit: number | null; json: string | null; timedOut?: boolean };
  /** 받기 결과를 정한다(기본: 전부 recorded) */
  fetchOutcome: (id: string, i: number) => FakeGameOutcome;
  /** 받기 도구의 종료 코드를 덮어쓴다(기본: 결과 JSON 의 exit) · `noJson` 이면 결과를 안 쓴다 */
  fetchExit: { code: number | null; noJson: boolean; timedOut?: boolean } | null;
  reloadExit: number | null;
  /** DB 열기를 실패시킨다(몇 번째 열기부터 · 0 이면 처음부터) */
  dbFailsFrom: number | null;
  dbOpens: number;
  spawns: SpawnRecord[];
  /** 경기 → 받기 도구가 받은 횟수 */
  fetchCount: Map<string, number>;
  /** 받은 날짜 → 횟수 */
  dateFetchCount: Map<string, number>;
}

export function makeWorld(o: Partial<Omit<World, "dir">> = {}): World {
  return {
    dir: mkdtempSync(join(tmpdir(), "bb-corr-")),
    remote: null,
    remoteFails: false,
    remoteReads: 0,
    keyGames: new Map(),
    dbFetched: new Map(),
    archiveFetched: new Map(),
    detect: () => ({ exit: 0, json: detectJson() }),
    fetchOutcome: () => ({}),
    fetchExit: null,
    reloadExit: 0,
    dbFailsFrom: null,
    dbOpens: 0,
    spawns: [],
    fetchCount: new Map(),
    dateFetchCount: new Map(),
    ...o,
  };
}

/** 가짜 DB — 세계의 후보 표를 읽는다(`game_date ≤ 기준일` 만 · 취득 시각은 DB 쪽) */
function fakeDb(world: World): CandidateDb {
  const n = world.dbOpens;
  world.dbOpens += 1;
  if (world.dbFailsFrom !== null && n >= world.dbFailsFrom) throw new Error("가짜 DB 를 못 열었다");
  return {
    candidates(q: CandidateQuery): CandidateRow[] {
      const key = defectKey(q.season, q.team, q.kind, q.playerId, q.field);
      return (world.keyGames.get(key) ?? [])
        .map((id) => ({ game_id: id, game_date: dateOfId(id), fetched_at: world.dbFetched.get(id) ?? OLD, value: 1 }))
        .filter((r) => r.game_date <= q.through);
    },
    valueIn(): AfterValue {
      return { found: true, value: 1 };
    },
    close() {},
  };
}

/** 가짜 자식 실행 — `now` 는 그 실행의 「지금」(받은 사본의 취득 시각으로 쓴다) */
function fakeChild(world: World, spec: ChildSpec, now: string): ChildExit {
  world.spawns.push({ label: spec.label, args: [...spec.args], env: { ...spec.env }, timeoutMs: spec.timeoutMs });
  switch (spec.label) {
    case "detect-before":
    case "detect-after": {
      const d = world.detect(spec.label === "detect-before" ? "before" : "after");
      if (d.json !== null) writeFileSync(argAfter(spec.args, "--emit"), d.json);
      return exitOf(d.exit, d.timedOut === true ? { timedOut: true, error: "ETIMEDOUT" } : {});
    }
    case "fetch": {
      const ids = readFileSync(argAfter(spec.args, "--ids"), "utf8").split("\n").filter((l) => l !== "");
      ids.forEach((id, i) => {
        const status = world.fetchOutcome(id, i).status ?? "recorded";
        if (status === "skipped") return;
        world.fetchCount.set(id, (world.fetchCount.get(id) ?? 0) + 1);
        const date = dateOfId(id);
        world.dateFetchCount.set(date, (world.dateFetchCount.get(date) ?? 0) + 1);
        if (status === "recorded") world.archiveFetched.set(id, now);
      });
      const json = fetchJson(ids, world.fetchOutcome);
      const forced = world.fetchExit;
      if (forced === null || !forced.noJson) writeFileSync(argAfter(spec.args, "--result"), json);
      if (forced !== null) {
        return exitOf(forced.code, forced.timedOut === true ? { timedOut: true, error: "ETIMEDOUT", signal: "SIGTERM" } : {});
      }
      return exitOf((JSON.parse(json) as { exit: number }).exit);
    }
    case "reload": {
      if (world.reloadExit === 0) for (const [id, at] of world.archiveFetched) world.dbFetched.set(id, at);
      return exitOf(world.reloadExit);
    }
  }
}

export interface RunOpts {
  now?: string;
  env?: Record<string, string | undefined>;
  planOnly?: boolean;
  /** 실행마다 다른 작업 폴더(기본: 세계 폴더의 `work`) */
  work?: string;
  /** 원격 이력 읽기를 갈아 끼운다(기본: 세계의 `remote` · `remoteFails`) — 진짜 `gitReadHistory` 에 가짜 git 을 물려 볼 때 */
  readRemoteHistory?: MainDeps["readRemoteHistory"];
}

export interface Ran {
  exit: number;
  out: string[];
  work: string;
  /** 작업 폴더의 파일 내용(없으면 null) */
  file: (name: string) => string | null;
  /** 이 실행에서 띄운 자식(라벨) */
  spawned: ChildSpec["label"][];
}

/** 진입점을 가짜 세계로 돌린다 — 기본 env 는 「정시 실행 · 잡 시작 10분 전 · 연락처 있음」 */
export function runMain(world: World, o: RunOpts = {}): Ran {
  const now = o.now ?? NOW;
  const work = o.work ?? join(world.dir, "work");
  const out: string[] = [];
  const before = world.spawns.length;
  const deps: MainDeps = {
    argv: [
      "--db",
      join(world.dir, "bb.sqlite"),
      "--archive",
      join(world.dir, "archive"),
      "--work-dir",
      work,
      ...(o.planOnly === true ? ["--plan-only"] : []),
    ],
    env: {
      GITHUB_RUN_ID: RUN,
      GITHUB_REF_NAME: "main",
      BB_RUN_SLOT: "scheduled",
      BB_COLLECT_STARTED_AT: START,
      BB_ARCHIVER_CONTACT: "ops@example.invalid",
      ...o.env,
    },
    // ⚠인자를 준 `new Date(…)` 는 시계를 읽지 않는다(M6) — 「지금」은 고정값이다
    now: () => new Date(now),
    root: world.dir,
    runChild: (spec) => fakeChild(world, spec, now),
    readRemoteHistory: (ref) => {
      world.remoteReads += 1;
      if (o.readRemoteHistory !== undefined) return o.readRemoteHistory(ref);
      return world.remoteFails ? { ok: false, reason: "가짜 git fetch 실패" } : { ok: true, bytes: world.remote };
    },
    openDb: () => fakeDb(world),
    out: (line) => out.push(line),
  };
  const exit = main(deps);
  const file = (name: string): string | null => {
    const p = join(work, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  return { exit, out, work, file, spawned: world.spawns.slice(before).map((s) => s.label) };
}

/**
 * 워크플로 `기록 갱신과 커밋` 의 이력 반영(설계 D1)을 흉내 낸다 — 원격 파일의 sha256 이 `history.base` 와 같을 때만 옮긴다.
 * @returns 옮겼으면 `committed`, `history.next.json` 이 없으면 `none`, base 가 다르면 `conflict`
 */
export function commitHistory(world: World, work: string): "committed" | "none" | "conflict" {
  const next = join(work, WORK_FILES.historyNext);
  if (!existsSync(next)) return "none";
  const cur = world.remote === null ? "absent" : sha256(world.remote);
  const base = readFileSync(join(work, WORK_FILES.historyBase), "utf8").trim();
  if (cur !== base) return "conflict";
  world.remote = readFileSync(next);
  return "committed";
}
