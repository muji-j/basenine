/**
 * `scripts/update.ts` 의 부모 판정 — **가짜 자식으로 실제로 돌린다**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · D5 · 시험 T6 · T7).
 *
 * ⚠**외부 요청 0 · 진짜 자식 0** — `fake-spawn.ts` 를 `--import` 로 먼저 올려 `spawnSync` 를 갈아 끼운다. 받기 자식(npb.jp)도
 *   적재 자식(DB)도 안 뜬다. `--date` 를 주므로 덜 받은 날 판정(DB 읽기)도 안 돈다. 작업 파일은 `--work` 의 임시 폴더에만 쓴다.
 * ⚠재는 것: ① 予告先発이 받기의 **맨 앞** ② 받기 자식이 75 면 **그 뒤 받기 자식은 안 뜨고** 로컬 자식(적재·emit·신선도)은 뜬다
 *   ③ emit 둘의 종료 1·2·신호(null)가 blocking 한 건씩 ④ 사유 파일을 spawn **전에** 지운다 ⑤ 종료 코드 0 / 75 / 1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

interface Ran {
  status: number | null;
  out: string;
  scripts: string[];
  calls: { script: string; args: string[] }[];
  work: string;
}

/** 기본: 선수 목록 둘 다 비지 않게(재취득·신규 선수 받기 자식이 뜰 자리가 생긴다) */
const BASE: Record<string, Planned> = {
  [S.stale]: { stdout: "00000001\n", stderr: "1명" },
  [S.ids]: { stdout: "00000001\n00000002\n" },
};

function run(plan: Record<string, Planned>, o: { before?: (work: string) => void; dates?: string } = {}): Ran {
  const work = mkdtempSync(join(tmpdir(), "bb-update-steps-"));
  try {
    o.before?.(work);
    const log = join(work, "spawn.jsonl");
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    delete env["BB_REFETCH_DATES"];
    delete env["BB_NPB_CIRCUIT_N"];
    const r = spawnSync(
      process.execPath,
      [
        "--import", FAKE, UPDATE,
        "--contact", "bb-app@lunomel.jp",
        "--date", o.dates ?? "2026-10-20",
        "--archive", join(work, "archive"),
        "--db", join(work, "bb.sqlite"),
        "--work", work,
      ],
      { encoding: "utf8", env: { ...env, BB_FAKE_SPAWN_PLAN: JSON.stringify({ ...BASE, ...plan }), BB_FAKE_SPAWN_LOG: log }, timeout: 60_000 },
    );
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { script: string; args: string[] })
      : [];
    return { status: r.status, out: `${r.stdout}\n${r.stderr}`, scripts: calls.map((c) => c.script), calls, work };
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

// ---- 부모 중단(D4-2) ---------------------------------------------------------------

test("⚠⚠T6 予告先発이 75 → 그 뒤 받기 자식은 안 뜬다 · 로컬 자식은 뜬다 · 종료 75", () => {
  const r = run({ [S.starters]: { exit: 75 } });
  assert.equal(r.status, 75, r.out);
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters], "75 뒤에 받기 자식이 떴다 — 장애 중 같은 URL 을 또 두드린다");
  for (const local of [S.load, S.stale, S.ids, S.loadPlayers, S.upcoming, S.loadStarters, S.fresh]) {
    assert.ok(r.scripts.includes(local), `로컬 자식 ${local} 이 안 떴다 — 이미 받은 데이터로 배포할 수 없다`);
  }
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 경기 아카이브 2026-10-20/);
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 낡은 선수 프로필 재취득/);
  assert.match(r.out, /상류 실패 — 이후 받기 건너뜀 신규 선수 프로필/);
  assert.match(r.out, /blocking 0 · 상류 4 · 설명된 신선도 0/);
});

test("⚠T6 경기 받기가 75 → 그 뒤 날짜·선수 받기 자식은 안 뜬다(같은 URL 반복이 사라진다)", () => {
  const r = run({ [S.games]: { exit: 75 } }, { dates: "2026-10-20" });
  assert.equal(r.status, 75, r.out);
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters, S.games]);
});

test("T6 받기 자식이 1 이면 중단하지 않는다(지금처럼) · 종료 1", () => {
  const r = run({ [S.starters]: { exit: 1 } });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.scripts.filter((s) => FETCHERS.includes(s)), [S.starters, S.games, S.players, S.players]);
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

test("⚠T6 적재 자식은 75 여도 blocking(R1) · 받기 자식의 2 는 blocking(R2) · 신호로 죽은 자식은 1 로 정규화", () => {
  verdict(run({ [S.load]: { exit: 75 } }), { status: 1, blocking: 1, upstream: 0, reason: /blocking: DB 적재 — 종료 75/ });
  verdict(run({ [S.games]: { exit: 2 } }), { status: 1, blocking: 1, upstream: 0, reason: /blocking: 경기 아카이브 2026-10-20 — 종료 2/ });
  verdict(run({ [S.upcoming]: { exit: null } }), { status: 1, blocking: 1, upstream: 0, reason: /blocking: 앞으로의 일정 적재 — 종료 1/ });
});

// ---- 신선도와 사유 파일(D5 · 4차-3) -----------------------------------------------------------

test("⚠T6 신선도 1 + 사유 파일(career-lag) + 상류 실패 → 75(설명됨)", () => {
  const r = run({ [S.starters]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: reasons("career-lag", "starters-lag") } });
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
    { [S.starters]: { exit: 75 }, [S.fresh]: { exit: 1 } }, // 이번 신선도는 파일을 안 쓴다
    { before: (work) => writeFileSync(join(work, "freshness-reasons.json"), reasons("career-lag")) }, // 이전 실행의 유효한 파일
  );
  verdict(r, { status: 1, blocking: 1, upstream: 4, reason: /blocking: 신선도 — 사유 파일이 없다/ });
});

test("⚠T6 신선도 2(표 없음 등)는 사유 파일과 무관하게 blocking · no-games 는 상류 실패가 있어도 blocking · 깨진 파일도 blocking", () => {
  verdict(run({ [S.starters]: { exit: 75 }, [S.fresh]: { exit: 2, reasonsFile: reasons("career-lag") } }), {
    status: 1,
    blocking: 1,
    upstream: 4,
    reason: /blocking: 신선도 — 종료 2/,
  });
  verdict(run({ [S.starters]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: reasons("no-games") } }), {
    status: 1,
    blocking: 1,
    upstream: 4,
    reason: /blocking: 신선도 — 설명되지 않는 사유 no-games/,
  });
  verdict(run({ [S.starters]: { exit: 75 }, [S.fresh]: { exit: 1, reasonsFile: "{" } }), {
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
