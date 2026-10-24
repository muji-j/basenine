/**
 * `scripts/update.ts` 의 부모 판정 — **가짜 자식으로 실제로 돌린다**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · D5 · 시험 T6 · T7).
 *
 * ⚠**외부 요청 0 · 진짜 자식 0** — `fake-spawn.ts` 를 `--import` 로 먼저 올려 `spawnSync` 를 갈아 끼운다. 받기 자식(npb.jp)도
 *   적재 자식(DB)도 안 뜬다. `--date` 를 주므로 덜 받은 날 판정(DB 읽기)도 안 돈다. 작업 파일은 `--work` 의 임시 폴더에만 쓴다.
 * ⚠재는 것: ① 予告先発이 받기의 **맨 앞** ② 받기 자식의 종료가 뒤 받기를 정한다(`collect-steps.ts` 의 표 — 69·70·모름은 **멈춤** ·
 *   75·1 은 **계속하되 연속 한도 1**) · 로컬 자식(적재·emit·신선도)은 언제나 뜬다 ③ emit 둘의 종료 1·2·신호(null)가 blocking 한 건씩
 *   ④ 사유 파일을 spawn **전에** 지운다 ⑤ 종료 코드 0 / 75 / 1(69·70 은 밖으로 안 나간다).
 * ⚠연락처는 RFC 2606 예약 도메인이다(3중 검토 2차 F5) — 가짜 자식만 받으므로 어디에도 안 닿고, 진짜 자식이 잘못 떠도 `buildUserAgent` 가 요청 0 으로 거부한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blockingSleep, createStepRunner, fetchExitDisposition } from "../collect-steps.ts";

const UPDATE = fileURLToPath(new URL("../update.ts", import.meta.url));
const FAKE = pathToFileURL(fileURLToPath(new URL("./fake-spawn.ts", import.meta.url))).href;

const S = {
  starters: "packages/archiver/src/cli-starters.ts",
  games: "packages/archiver/src/cli.ts",
  load: "packages/store/tools/load-archive.ts",
  stale: "packages/store/tools/emit-stale-player-ids.ts",
  ids: "packages/store/tools/emit-player-ids.ts",
  players: "packages/archiver/src/cli-players.ts",
  loadPlayers: "packages/store/tools/load-players.ts",
  upcoming: "packages/store/tools/load-upcoming.ts",
  loadStarters: "packages/store/tools/load-starters.ts",
  fresh: "scripts/freshness.ts",
} as const;

const FETCHERS: readonly string[] = [S.starters, S.games, S.players];

interface Planned {
  exit?: number | null;
  stdout?: string;
  stderr?: string;
  reasonsFile?: string;
}

interface Call {
  script: string;
  args: string[];
  /** 그 자식이 받은 `BB_NPB_CIRCUIT_N`(없으면 `null`) */
  circuitN: string | null;
}

/** 가짜 자식 기록 한 줄 — 자식 하나(`spawn`) 또는 부모의 동기 잠(`sleep` · `fake-spawn.ts` 가 가로챈 `Atomics.wait`) */
type Event = { kind: "spawn"; script: string } | { kind: "sleep"; ms: number | null };

interface Ran {
  status: number | null;
  out: string;
  scripts: string[];
  calls: Call[];
  /** 자식과 잠의 차례 그대로 */
  events: Event[];
  work: string;
}

/** 기본: 선수 목록 둘 다 비지 않게(재취득·신규 선수 받기 자식이 뜰 자리가 생긴다) */
const BASE: Record<string, Planned> = {
  [S.stale]: { stdout: "00000001\n", stderr: "1명" },
  [S.ids]: { stdout: "00000001\n00000002\n" },
};

/**
 * `update.ts` 를 가짜 자식으로 한 번 돌린다. `dates` 가 `null` 이면 `--date` 를 안 준다(`env.BB_REFETCH_DATES` 로 날짜를 줄 때) ·
 * `args` 는 뒤에 덧붙인다(`--delay` 등).
 */
function run(
  plan: Record<string, Planned>,
  o: { before?: (work: string) => void; dates?: string | null; args?: readonly string[]; env?: Record<string, string> } = {},
): Ran {
  const work = mkdtempSync(join(tmpdir(), "bb-update-steps-"));
  try {
    o.before?.(work);
    const log = join(work, "spawn.jsonl");
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    delete env["BB_REFETCH_DATES"];
    delete env["BB_NPB_CIRCUIT_N"];
    const dateArgs = o.dates === null ? [] : ["--date", o.dates ?? "2026-10-20"];
    const r = spawnSync(
      process.execPath,
      [
        "--import", FAKE, UPDATE,
        "--contact", "me@example.com",
        ...dateArgs,
        "--archive", join(work, "archive"),
        "--db", join(work, "bb.sqlite"),
        "--work", work,
        ...(o.args ?? []),
      ],
      { encoding: "utf8", env: { ...env, ...(o.env ?? {}), BB_FAKE_SPAWN_PLAN: JSON.stringify({ ...BASE, ...plan }), BB_FAKE_SPAWN_LOG: log }, timeout: 60_000 },
    );
    const lines = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Call | { sleep: number | null })
      : [];
    const calls = lines.filter((l): l is Call => "script" in l);
    const events: Event[] = lines.map((l) => ("script" in l ? { kind: "spawn", script: l.script } : { kind: "sleep", ms: l.sleep }));
    return { status: r.status, out: `${r.stdout}\n${r.stderr}`, scripts: calls.map((c) => c.script), calls, events, work };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const reasons = (...rs: string[]): string => JSON.stringify({ schema: 1, exit: 1, reasons: rs });

// ---- 정상 · 순서 ----------------------------------------------------------------

test("⚠T6 정상 — 종료 0 · 予告先発이 받기의 맨 앞(경기보다 앞) · 단계 차례", () => {
  const r = run({});
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.scripts, [S.starters, S.games, S.load, S.stale, S.players, S.ids, S.players, S.loadPlayers, S.upcoming, S.loadStarters, S.fresh]);
  assert.ok(r.scripts.indexOf(S.starters) < r.scripts.indexOf(S.games), "予告先発이 경기보다 뒤다 — 경기 단계의 소진이 예고를 건너뛰게 한다");
  assert.match(r.out, /정상 종료/);
  // 신선도 자식에 사유 파일 경로를 넘긴다(작업 폴더 안)
  const freshCall = r.calls.find((c) => c.script === S.fresh)!;
  assert.equal(freshCall.args[freshCall.args.indexOf("--reasons-out") + 1], join(r.work, "freshness-reasons.json"));
});

// ---- 부모의 처분(D4 · collect-steps.ts 의 표) ------------------------------------------------

const fetchCalls = (r: Ran): Call[] => r.calls.filter((c) => FETCHERS.includes(c.script));

test("⚠⚠T6 받기 자식의 처분 표(닫힌 표) — 0·75·1 계속 · 69·70 회로 · 그 밖(2·137·신호·종료 코드 없음·spawn 실패)은 모름 = 멈춤", () => {
  const plain = (status: number | null) => ({ status, signal: null });
  for (const s of [0, 75, 1]) assert.equal(fetchExitDisposition(plain(s)), "continue", String(s));
  for (const s of [69, 70]) assert.equal(fetchExitDisposition(plain(s)), "circuit", String(s));
  for (const s of [2, 3, 76, 137, 255]) assert.equal(fetchExitDisposition(plain(s)), "unknown", String(s));
  assert.equal(fetchExitDisposition({ status: null, signal: "SIGKILL" }), "unknown", "신호로 죽은 자식(정규화하면 1)을 「계속」으로 읽었다");
  assert.equal(fetchExitDisposition({ status: 1, signal: "SIGTERM" }), "unknown");
  assert.equal(fetchExitDisposition({ status: null, signal: null }), "unknown");
  assert.equal(fetchExitDisposition({ status: 0, signal: null, error: new Error("spawn ENOENT") }), "unknown");
});

test("⚠⚠T6 予告先発이 69(상류만 · 회로 열림) → 그 뒤 받기 자식은 안 뜬다 · 로컬 자식은 뜬다 · 종료 75(69 는 밖으로 안 나간다)", () => {
  const r = run({ [S.starters]: { exit: 69 } });
  assert.equal(r.status, 75, r.out);
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters], "회로가 열렸는데 받기 자식이 떴다 — 장애 중 같은 호스트를 또 두드린다");
  for (const local of [S.load, S.stale, S.ids, S.loadPlayers, S.upcoming, S.loadStarters, S.fresh]) {
    assert.ok(r.scripts.includes(local), `로컬 자식 ${local} 이 안 떴다 — 이미 받은 데이터로 배포할 수 없다`);
  }
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 경기 아카이브 2026-10-20/);
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 낡은 선수 프로필 재취득/);
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 신규 선수 프로필/);
  assert.match(r.out, /blocking 0 · 상류 4 · 설명된 신선도 0/);
});

/**
 * ⚠⚠**75(상류만 · 회로 닫힘)는 뒤 받기를 멈추지 않는다**(3중 검토 2차 F1) — 한 페이지만의 소진이 형제·다음 단계를 굶기지 않게.
 * 대신 **뒤 받기 자식은 연속 한도 1 로 뜬다** — 자식마다 회로가 새로 서므로, 이게 없으면 실행 전체 소진 ≤ 6 이 깨진다(3중 검토 3차 ①).
 */
test("⚠⚠T6 予告先発이 75(회로 닫힘) → 뒤 받기 자식은 뜬다 · 그 자식들은 BB_NPB_CIRCUIT_N=1 · 종료 75", () => {
  const r = run({ [S.starters]: { exit: 75 } });
  assert.equal(r.status, 75, r.out);
  const fetches = fetchCalls(r);
  assert.deepEqual(fetches.map((c) => c.script), [S.starters, S.games, S.players, S.players], "75 뒤에 받기를 멈췄다 — 한 URL 의 소진이 나머지를 굶긴다");
  assert.deepEqual(fetches.map((c) => c.circuitN), [null, "1", "1", "1"], "75 뒤의 받기 자식이 연속 한도 1 로 안 떴다 — 자식마다 소진 5 를 되풀이할 수 있다");
  assert.match(r.out, /blocking 0 · 상류 1 · 설명된 신선도 0/);
});

test("⚠T6 경기 받기가 69 → 그 뒤 날짜·선수 받기 자식은 안 뜬다(같은 URL 반복이 사라진다)", () => {
  const r = run({ [S.games]: { exit: 69 } }, { dates: "2026-10-20" });
  assert.equal(r.status, 75, r.out);
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters, S.games]);
});

test("⚠T6 받기 자식이 1(로컬 · 회로 닫힘)이면 계속하되 뒤 받기는 연속 한도 1 · 종료 1", () => {
  const r = run({ [S.starters]: { exit: 1 } });
  assert.equal(r.status, 1, r.out);
  const fetches = fetchCalls(r);
  assert.deepEqual(fetches.map((c) => c.script), [S.starters, S.games, S.players, S.players]);
  assert.deepEqual(fetches.map((c) => c.circuitN), [null, "1", "1", "1"]);
});

test("⚠T6 정상이면 받기 자식은 물려받은 회로 env 그대로다(덮어쓰지 않는다)", () => {
  const r = run({});
  assert.deepEqual(fetchCalls(r).map((c) => c.circuitN), [null, null, null, null]);
});

/** ⚠⚠**3중 검토 3차 ①의 모양** — 로컬과 상류가 섞여(70) 회로가 열린 채 끝나도 부모가 멈춘다. 예전에는 1 이라 다음 자식이 새 회로로 또 두드렸다 */
test("⚠⚠T6 받기 자식이 70(로컬 · 회로 열림)이면 뒤 받기를 멈춘다 · 종료 1", () => {
  const r = run({ [S.starters]: { exit: 70 } });
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters], "70 뒤에 받기 자식이 떴다 — 열린 회로가 부모에게 전해지지 않았다");
  verdict(r, { status: 1, blocking: 1, upstream: 3, reason: /blocking: 予告先発 아카이브 — 종료 70/ });
});

for (const [label, exit] of [["2(입력 오류)", 2], ["신호(null)", null], ["137", 137]] as const) {
  test(`⚠T6 받기 자식의 모르는 종료 ${label} → 뒤 받기를 멈춘다(요청에 대해 닫힌 쪽) · 건너뛴 받기는 blocking · 종료 1`, () => {
    const r = run({ [S.starters]: { exit } });
    assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters], "모르는 종료 뒤에 받기 자식이 떴다");
    assert.match(r.out, /모르는 종료 — 이후 받기 건너뜀 경기 아카이브 2026-10-20/);
    verdict(r, { status: 1, blocking: 4, upstream: 0, reason: /blocking: 경기 아카이브 2026-10-20 — 건너뜀/ });
  });
}

// ---- 받기 자식 경계의 L1 간격(3중 검토 3차 ②) ------------------------------------------------

/**
 * ⚠⚠**받기 자식마다 fetcher 가 새로 서므로 각 자식의 첫 요청은 기다리지 않는다** — 예고 자식의 마지막 요청과 경기 자식의 첫 요청이
 * 붙을 수 있었다(공유 가상 시계 재현에서 둘 다 0ms). 부모가 받기 자식을 띄우기 전에 `--delay` 만큼 잔다(첫 받기 자식 앞은 안 잔다).
 */
test("⚠⚠T6 받기 자식 사이에 --delay 만큼 쉰다(L1) — 예고 → 경기 사이 ≥ delay · 첫 받기 앞·로컬 자식 앞은 안 잔다 · 자식 수 불변", () => {
  const r = run({});
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.scripts, [S.starters, S.games, S.load, S.stale, S.players, S.ids, S.players, S.loadPlayers, S.upcoming, S.loadStarters, S.fresh], "자식 수·차례가 바뀌었다");
  assert.deepEqual(r.events.slice(0, 3), [
    { kind: "spawn", script: S.starters },
    { kind: "sleep", ms: 3000 },
    { kind: "spawn", script: S.games },
  ], "예고 자식과 경기 자식 사이에 L1 간격이 없다");
  const fetchAt = r.events.flatMap((e, i) => (e.kind === "spawn" && FETCHERS.includes(e.script) ? [i] : []));
  for (const i of fetchAt.slice(1)) {
    const prev = r.events[i - 1];
    assert.ok(prev?.kind === "sleep" && (prev.ms ?? 0) >= 3000, `받기 자식 #${String(i)} 앞에 L1 간격이 없다: ${JSON.stringify(r.events)}`);
  }
  assert.equal(r.events.filter((e) => e.kind === "sleep").length, fetchAt.length - 1, "받기 자식이 아닌 곳에서 잤다(또는 첫 받기 앞에서 잤다)");
});

test("⚠T6 blockingSleep 은 정말로 잔다(동기) · NaN·0·음수는 안 잔다(NaN 은 Atomics.wait 에서 무한이다) · 실행기는 L1 밖 간격으로 만들 수 없다", () => {
  const t0 = performance.now();
  blockingSleep(40);
  assert.ok(performance.now() - t0 >= 35, "자지 않았다");
  const t1 = performance.now();
  for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) blockingSleep(bad);
  assert.ok(performance.now() - t1 < 1000, "NaN·0·음수·무한에서 잤다");
  for (const gap of [0, 500, Number.NaN]) assert.throws(() => createStepRunner({ cwd: ".", fetchGapMs: gap }), RangeError, String(gap));
});

test("⚠T6 --delay 5000 이면 받기 자식 사이도 5000 · L1 밖(500 · abc)이면 자식 0 으로 종료 2 · 멈춘 뒤에는 자지 않는다", () => {
  const slow = run({}, { args: ["--delay", "5000"] });
  assert.equal(slow.status, 0, slow.out);
  assert.deepEqual([...new Set(slow.events.flatMap((e) => (e.kind === "sleep" ? [e.ms] : [])))], [5000]);
  for (const c of fetchCalls(slow)) assert.equal(c.args[c.args.indexOf("--delay") + 1], "5000", "자식에 같은 간격을 안 넘겼다");
  for (const bad of ["500", "abc"]) {
    const r = run({}, { args: ["--delay", bad] });
    assert.equal(r.status, 2, `${bad}: ${r.out}`);
    assert.deepEqual(r.events, [], `${bad}: 자식이 떴다(또는 잤다)`);
  }
  const stopped = run({ [S.starters]: { exit: 69 } });
  assert.deepEqual(stopped.events.filter((e) => e.kind === "sleep"), [], "띄우지 않는 받기 자식 앞에서 잤다");
});

// ---- 신선도 사유와 원인 갈래(3중 검토 1차 P3-3) -----------------------------------------------

/**
 * ⚠⚠**설명되는 사유는 그 사유의 갈래에 상류 실패가 있을 때만이다** — `game-missed`·`game-lag` ↔ 경기 · `career-lag` ↔ 선수 · `starters-*` ↔ 예고.
 * 예전에는 상류 실패가 **어디든** 하나 있으면 다섯 사유를 전부 설명된 것으로 봤다 — 선수 페이지 하나의 소진이 경기 누락을 덮었다.
 */
test("⚠⚠T6 선수 받기만 75 · 경기 받기는 성공 · game-missed → blocking(그 갈래에 상류 실패가 없다)", () => {
  verdict(run({ [S.players]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: reasons("game-missed") } }), {
    status: 1,
    blocking: 1,
    upstream: 2,
    reason: /blocking: 신선도 — 그 갈래에 상류 실패가 없다 game-missed\(경기\)/,
  });
});

test("⚠T6 선수 받기 75 + career-lag → 설명됨(75) · 예고 받기만 75 + career-lag → blocking", () => {
  verdict(run({ [S.players]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: reasons("career-lag") } }), { status: 75, blocking: 0, upstream: 2, explained: 1 });
  verdict(run({ [S.starters]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: reasons("career-lag") } }), {
    status: 1,
    blocking: 1,
    upstream: 1,
    reason: /그 갈래에 상류 실패가 없다 career-lag\(선수\)/,
  });
});

test("⚠T6 회로 열림으로 건너뛴 갈래는 설명된다 — 예고 69 → 경기·선수 건너뜀 → game-missed·career-lag·starters-lag 전부 설명(75)", () => {
  verdict(run({ [S.starters]: { exit: 69 }, [S.fresh]: { exit: 1, reasonsFile: reasons("game-missed", "career-lag", "starters-lag") } }), {
    status: 75,
    blocking: 0,
    upstream: 4,
    explained: 3,
  });
});

// ---- 복구 실행의 선수 재취득 상한(설계 D6 · 3중 검토 1차 P2-2 · 2차 F2) ------------------------------

const staleLimit = (r: Ran): string | undefined => {
  const c = r.calls.find((x) => x.script === S.stale);
  return c === undefined ? undefined : c.args[c.args.indexOf("--limit") + 1];
};
const DAYS7 = "2026-10-14,2026-10-15,2026-10-16,2026-10-17,2026-10-18,2026-10-19,2026-10-20";

test("⚠⚠T6 대상 경기일이 2일을 넘으면 선수 재취득 상한을 낮춘다 — 7일이면 145 · 1일이면 400(설정값) · 설정이 더 작으면 그대로", () => {
  const seven = run({}, { dates: null, env: { BB_REFETCH_DATES: DAYS7 } });
  assert.equal(seven.status, 0, seven.out);
  assert.equal(seven.scripts.filter((s) => s === S.games).length, 7, "날짜 자식이 7개가 아니다 — 전제가 틀렸다");
  assert.equal(staleLimit(seven), "145", "7일 복구 실행에서 상한을 안 낮췄다 — 30분 걸쇠가 단계를 죽인다");
  assert.match(seven.out, /선수 재취득 상한 400 → 145/);
  assert.equal(staleLimit(run({})), "400", "정상 실행(1일)의 상한을 바꿨다");
  assert.equal(staleLimit(run({}, { dates: null, env: { BB_REFETCH_DATES: DAYS7 }, args: ["--player-limit", "100"] })), "100");
});

/**
 * ⚠⚠**예산에 남는 몫이 없으면(상한 0) 그 실행의 선수 재취득을 건너뛴다**(반영분 재검토 P3) — 목록 도구(`emit-stale-player-ids`)는
 * `--limit 0` 을 「양의 정수가 아니다」로 거부(종료 2 → blocking)하므로 **띄우지 않는다.** 신규 선수 받기와 나머지는 그대로 돈다.
 * 간격 20000ms × 재수집 7일이면 날짜만으로 예산을 넘는다(fake-spawn 이 잠을 가로채므로 실제로는 안 잔다).
 */
test("⚠⚠T6 상한이 0 이면 낡은 선수 목록·재취득 자식을 띄우지 않는다 · 신규 선수 받기는 돈다 · 종료 0", () => {
  const r = run({}, { dates: null, env: { BB_REFETCH_DATES: DAYS7 }, args: ["--delay", "20000"] });
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.scripts.includes(S.stale), "상한 0 인데 낡은 선수 목록을 띄웠다 — `--limit 0` 은 거부(blocking)된다");
  assert.equal(r.scripts.filter((s) => s === S.players).length, 1, "신규 선수 받기만 떠야 한다(재취득은 건너뛴다)");
  assert.ok(r.scripts.includes(S.loadPlayers) && r.scripts.includes(S.fresh), "나머지 단계가 안 돌았다");
  assert.match(r.out, /선수 재취득 건너뜀/);
  assert.match(r.out, /blocking 0 · 상류 0/);
});

// ---- emit 둘 — 1·2·신호가 blocking 한 건씩 ----------------------------------------------

for (const [label, exit] of [["1", 1], ["2", 2], ["신호(null)", null]] as const) {
  test(`⚠T6 낡은 선수 목록(emit) 종료 ${label} → blocking 한 건 · 재취득 받기는 안 뜬다 · 종료 1`, () => {
    const r = run({ [S.stale]: { exit, stdout: "00000001\n" } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /blocking 1 · 상류 0/);
    assert.equal(r.scripts.filter((s) => s === S.players).length, 1, "목록이 실패했는데 재취득을 띄웠다(또는 신규 선수를 안 띄웠다)");
  });

  test(`⚠T6 선수 ID 목록(emit) 종료 ${label} → blocking 한 건 · 신규 선수·선수 적재는 안 뜬다 · 종료 1`, () => {
    const r = run({ [S.ids]: { exit, stdout: "00000001\n" } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /blocking 1 · 상류 0/);
    assert.ok(!r.scripts.includes(S.loadPlayers), "목록이 실패했는데 선수 적재를 띄웠다");
  });
}

test("T6 선수 ID 목록이 종료 0 인데 비었다 → 옛 판처럼 실패(blocking 한 건)", () => {
  const r = run({ [S.ids]: { exit: 0, stdout: "" } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /blocking 1 · 상류 0/);
});

// ---- 적재 · 받기의 그 밖 종료 ------------------------------------------------------------

/** 판정 요약 줄 — 「종료 코드가 1 이다」만 보면 크래시(옛 코드)와 판정을 못 가른다. 요약과 사유까지 본다 */
function verdict(r: Ran, want: { status: number; blocking: number; upstream: number; explained?: number; reason?: RegExp }): void {
  assert.equal(r.status, want.status, r.out);
  assert.match(r.out, new RegExp(`blocking ${String(want.blocking)} · 상류 ${String(want.upstream)} · 설명된 신선도 ${String(want.explained ?? 0)}`), r.out);
  if (want.reason !== undefined) assert.match(r.out, want.reason, r.out);
}

test("⚠T6 적재 자식은 75 여도 blocking(R1) · 받기 자식의 2 는 blocking(R2) 이고 뒤 받기(선수 둘)를 멈춘다 · 신호로 죽은 자식은 1 로 정규화", () => {
  verdict(run({ [S.load]: { exit: 75 } }), { status: 1, blocking: 1, upstream: 0, reason: /blocking: DB 적재 — 종료 75/ });
  // ⚠받기 자식의 2 는 「모름」이다 — 뒤 받기 자식(선수 둘)을 띄우지 않고 그 둘도 blocking(건너뜀)으로 남긴다(설계 D4 · 3중 검토 반영)
  verdict(run({ [S.games]: { exit: 2 } }), { status: 1, blocking: 3, upstream: 0, reason: /blocking: 경기 아카이브 2026-10-20 — 종료 2/ });
  verdict(run({ [S.upcoming]: { exit: null } }), { status: 1, blocking: 1, upstream: 0, reason: /blocking: 앞으로의 일정 적재 — 종료 1/ });
});

// ---- 신선도와 사유 파일(D5 · 4차-3) -----------------------------------------------------------

test("⚠T6 신선도 1 + 사유 파일(career-lag) + 상류 실패 → 75(설명됨)", () => {
  const r = run({ [S.starters]: { exit: 69 }, [S.fresh]: { exit: 1, reasonsFile: reasons("career-lag", "starters-lag") } });
  assert.equal(r.status, 75, r.out);
  assert.match(r.out, /설명된 신선도 2/);
});

test("⚠⚠T6 신선도 1 + career-lag + 상류 실패 없음 → 1(PR-1 이 고친 헛경보 유형은 여전히 막힌다)", () => {
  verdict(run({ [S.fresh]: { exit: 1, reasonsFile: reasons("career-lag") } }), {
    status: 1,
    blocking: 1,
    upstream: 0,
    reason: /blocking: 신선도 — 상류 실패 없이 울었다 career-lag/,
  });
});

test("⚠⚠T6 사유 파일은 spawn 전에 지운다 — 이전 실행의 파일을 읽지 않는다(새 파일이 없으면 blocking)", () => {
  const r = run(
    { [S.starters]: { exit: 69 }, [S.fresh]: { exit: 1 } }, // 이번 신선도는 파일을 안 쓴다
    { before: (work) => writeFileSync(join(work, "freshness-reasons.json"), reasons("career-lag")) }, // 이전 실행의 유효한 파일
  );
  verdict(r, { status: 1, blocking: 1, upstream: 4, reason: /blocking: 신선도 — 사유 파일이 없다/ });
});

test("⚠T6 신선도 2(표 없음 등)는 사유 파일과 무관하게 blocking · no-games 는 상류 실패가 있어도 blocking · 깨진 파일도 blocking", () => {
  verdict(run({ [S.starters]: { exit: 69 }, [S.fresh]: { exit: 2, reasonsFile: reasons("career-lag") } }), {
    status: 1,
    blocking: 1,
    upstream: 4,
    reason: /blocking: 신선도 — 종료 2/,
  });
  verdict(run({ [S.starters]: { exit: 69 }, [S.fresh]: { exit: 1, reasonsFile: reasons("no-games") } }), {
    status: 1,
    blocking: 1,
    upstream: 4,
    reason: /blocking: 신선도 — 설명되지 않는 사유 no-games/,
  });
  verdict(run({ [S.starters]: { exit: 69 }, [S.fresh]: { exit: 1, reasonsFile: "{" } }), {
    status: 1,
    blocking: 1,
    upstream: 4,
    reason: /blocking: 신선도 — 사유 파일을 못 읽었다/,
  });
});

// ---- 정적 — spawnSync 직접 호출 0 ----------------------------------------------------------------

test("⚠T6 update.ts 에 spawnSync 직접 호출이 0 이다 — 모든 자식은 execStep 한 헬퍼를 지난다(emit 이 판정에서 빠지지 않게)", () => {
  const code = readFileSync(UPDATE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
  assert.equal(/\bspawnSync\b/.test(code), false, "update.ts 가 spawnSync 를 직접 부른다(또는 가져온다)");
  assert.equal(/\bspawn\s*\(/.test(code), false);
  assert.ok((code.match(/\bexecStep\(/g) ?? []).length >= 9, "execStep 호출이 너무 적다 — 자식을 다른 길로 띄운다");
});
