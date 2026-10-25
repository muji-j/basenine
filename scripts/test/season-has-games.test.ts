/**
 * **경기가 0 인 시즌의 공표표는 받지 않는다** — `scripts/season-has-games.ts` 와 그 배선(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D6 · T7).
 *
 * ⚠**왜**: 1/1~개막 전 「공표 성적표 갱신」이 `--season <새 해>` 로 받으면 빈 표 200 이 대조 0명이 되어 외부 대조 관문이 1 이 된다(설계 G6).
 *   그렇다고 관문(`packages/aggregate/tools/crosscheck.ts`)을 바꾸지 않는다 — 사용자 결정 2026-10-02 「관문 판정 불변」(`crosscheck-gate-unchanged.test.ts`).
 *   **받지 않으면** 새 해의 폴더가 안 생기고 대조는 보유한 완결 시즌으로 돈다. 덤: 1/1~개막 약 85일 × 하루 3실행 × 30장 ≈ 7,650요청을 안 보낸다(L1).
 * ⚠스크립트는 **시계를 안 읽는다**(시즌은 인자 · M6) · **DB 를 읽기 전용으로 연다**(마이그레이션 적용 없음 · 없는 파일을 만들지 않는다).
 * ⚠워크플로 조각은 **실제 bash** 로 돌린다(`workflow-shell.ts`) — 가짜 `node`·`date`(셸 함수)로 외부 요청 0 · 진짜 도구 0.
 *   GitHub 의 기본 셸과 같게 `set -eo pipefail` 을 앞에 붙인다 — `-e` 아래에서 종료 코드를 잡는 모양이 실제로 도는지 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, upsertGame } from "@bb-app/store";
import { DAILY, runBash, runOf, stepNamed } from "./workflow-shell.ts";

const SCRIPT = fileURLToPath(new URL("../season-has-games.ts", import.meta.url));
const NOW = "2026-10-25T00:00:00.000Z";

function withDb<T>(seed: ((db: ReturnType<typeof openDb>) => void) | "garbage" | "missing", fn: (dbPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "bb-season-has-games-"));
  const dbPath = join(dir, "t.sqlite");
  try {
    if (seed === "garbage") writeFileSync(dbPath, "not an sqlite database\n".repeat(64));
    else if (seed !== "missing") {
      const db = openDb(dbPath, NOW);
      try {
        seed(db);
      } finally {
        db.close();
      }
    }
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function game(db: ReturnType<typeof openDb>, id: string, season: number, status: "played" | "notPlayed"): void {
  upsertGame(db, {
    gameId: id, season, gameDate: `${String(season)}-04-01`, awayCode: "t", homeCode: "g", gameNo: 1,
    status, notPlayedReason: status === "played" ? null : "雨天中止", competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: status === "played" ? 1 : null, homeRuns: status === "played" ? 2 : null,
  });
}

function run(args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

test("⚠⚠T7 season-has-games — 그 시즌에 치른 경기가 있으면 0 · 없으면 10(중지 경기만이어도) · DB 를 못 읽으면 2", () => {
  withDb((db) => { game(db, "a", 2026, "played"); game(db, "b", 2027, "notPlayed"); }, (dbPath) => {
    const before = sha(dbPath);
    const has = run([dbPath, "2026"]);
    assert.equal(has.code, 0, has.err);
    assert.match(has.out, /2026 시즌 치른 경기 1건/);
    const canceled = run([dbPath, "2027"]);
    assert.equal(canceled.code, 10, `중지 경기뿐인 시즌을 「경기 있음」으로 봤다:\n${canceled.out}${canceled.err}`);
    assert.match(canceled.out, /2027 시즌 치른 경기 0건/);
    const none = run([dbPath, "2028"]);
    assert.equal(none.code, 10);
    assert.equal(sha(dbPath), before, "읽기 전용이 아니다 — DB 를 바꿨다");
  });
  withDb("garbage", (dbPath) => {
    const r = run([dbPath, "2026"]);
    assert.equal(r.code, 2, `못 읽는 DB 를 「경기 없음」(1)으로 봤다 — 모르는 것을 0 으로 메웠다(M11):\n${r.err}`);
    assert.match(r.err, /DB 를 읽지 못했다/);
  });
  withDb("missing", (dbPath) => {
    const r = run([dbPath, "2026"]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /DB 가 없다/);
    assert.equal(existsSync(dbPath), false, "없는 DB 를 만들었다");
  });
});

test("⚠T7 season-has-games — 인자가 틀리면 2(시즌이 4자리 연도가 아님 · 인자 수)", () => {
  withDb((db) => game(db, "a", 2026, "played"), (dbPath) => {
    for (const args of [[dbPath], [dbPath, "26"], [dbPath, "2026x"], [dbPath, ""], [dbPath, "2026", "extra"]]) {
      const r = run(args);
      assert.equal(r.code, 2, `${JSON.stringify(args.slice(1))}: ${r.out}${r.err}`);
    }
  });
});

/**
 * ⚠⚠**「없다」는 전용 코드 10 이다 — Node 의 비정상 종료(1)와 겹치지 않게**(PR-4 3중 검토 2차 F3).
 * 「없다」가 1 이던 때는 스크립트가 **모듈 수준에서 죽어도**(import 실패 · 미리 읽기 실패 · 잡히지 않은 예외 — Node 가 1 로 끝낸다)
 * 워크플로가 그것을 「개막 전 — 공표표를 받지 않는다」로 읽었다. 여기서는 그 모양을 실제로 만든다: 미리 읽기(`--import`)가 던지면
 * 스크립트 본문은 돌지도 않고 종료가 1 이다 → 10 이 아니다 → 워크플로는 단계 실패로 읽는다(아래 배선 시험).
 */
test("⚠⚠T7 season-has-games — 모듈 수준 실패(Node 비정상 종료)는 1 이고 「없다」(10)가 아니다", () => {
  withDb((db) => game(db, "a", 2026, "played"), (dbPath) => {
    const crash = spawnSync(process.execPath, ["--import", "data:text/javascript,throw new Error('module-level failure (injected)')", SCRIPT, dbPath, "2027"], { encoding: "utf8" });
    assert.equal(crash.status, 1, `모듈 수준 실패의 종료가 1 이 아니다: ${crash.stderr}`);
    assert.notEqual(crash.status, 10);
    assert.doesNotMatch(crash.stdout, /치른 경기/, "주입한 실패인데 본문이 돌았다 — 이 시험이 아무것도 안 잰다");
  });
});

// ---- 배선 — 「공표 성적표 갱신」 단계를 실제 bash 로 ------------------------------------------------------

const STEP = stepNamed(DAILY, "collect", "공표 성적표 갱신");

/** 가짜 `date`(JST 연도 2027) · 가짜 `node`(부른 인자를 `calls.txt` 에 적고 `HAS`·`STATS` 로 끝난다) — 진짜 도구는 안 돈다 */
function runStep(has: number, stats = 0): { status: number | null; out: string; calls: string[] } {
  const fakes = [
    "set -eo pipefail",
    "date() { echo 2027; }",
    'node() { echo "node $*" >> calls.txt; case "$1" in scripts/season-has-games.ts) return "$HAS" ;; packages/archiver/src/cli-stats.ts) return "$STATS" ;; *) return 99 ;; esac; }',
  ].join("\n");
  const r = runBash(`${fakes}\n${runOf(STEP)}`, { HAS: String(has), STATS: String(stats) }, (dir) => writeFileSync(join(dir, "calls.txt"), ""));
  const calls = readFileSync(join(r.dir, "calls.txt"), "utf8").split("\n").filter((l) => l !== "");
  rmSync(r.dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}

test("⚠⚠T7 공표 성적표 갱신 — 그 시즌에 치른 경기가 있을 때(0)만 cli-stats 를 JST 연도로 부른다", () => {
  const r = runStep(0);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, ["node scripts/season-has-games.ts data/bb.sqlite 2027", "node packages/archiver/src/cli-stats.ts --season 2027"]);
  // 공표표 받기가 실패하면 그 실패가 단계의 종료 코드다(지금처럼 · continue-on-error)
  const failed = runStep(0, 1);
  assert.notEqual(failed.status, 0, "cli-stats 실패를 삼켰다");
});

test("⚠⚠T7 공표 성적표 갱신 — 치른 경기가 0(10)이면 cli-stats 를 안 부르고 한 줄 · 단계는 성공", () => {
  const r = runStep(10);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, ["node scripts/season-has-games.ts data/bb.sqlite 2027"], "경기가 0 인 시즌의 공표표를 받으러 갔다 — 빈 표가 대조 0명으로 관문을 1 로 만든다");
  assert.match(r.out, /2027 시즌 경기가 DB 에 0 — 공표표를 받지 않는다\(개막 전\)/);
});

test("⚠T7 공표 성적표 갱신 — 못 읽음(2) · Node 비정상 종료(1) · 그 밖이면 cli-stats 를 안 부르고 단계 실패(::error::) — 「개막 전」으로 안 읽는다", () => {
  for (const has of [1, 2, 127]) {
    const r = runStep(has);
    assert.notEqual(r.status, 0, `${String(has)}: 판정을 못 했는데 단계가 성공했다`);
    assert.deepEqual(r.calls, ["node scripts/season-has-games.ts data/bb.sqlite 2027"], `${String(has)}: 판정을 못 했는데 받으러 갔다`);
    assert.match(r.out, /::error::/);
  }
});

test("⚠T7 공표 성적표 갱신 — if: · continue-on-error 는 그대로(배포를 안 막는다 · rc 75 면 건너뛴다)", () => {
  const body = STEP.body.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.match(body, /^ {8}if: success\(\) && steps\.update\.outputs\.rc != '75'$/m);
  assert.match(body, /^ {8}continue-on-error: true$/m);
  assert.equal(runOf(STEP).includes("${{"), false, "run: 에 식이 직접 들어갔다 — env 로만 넘겨라");
});
