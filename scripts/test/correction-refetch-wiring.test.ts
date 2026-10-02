/**
 * **정정 자동 재수집 진입점(`scripts/correction-refetch.ts`)의 배선**
 * (설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D1 · D6 · D7-9 · D8 · D9 · 시험 T9).
 *
 * - **T9 요청 0 증가** — `no_defects` · `retry_slot` · `unmeasured` · `too_many_defects` · `time_budget` 에서 받기 도구(`cli-games.ts`)를
 *   띄우지 않는다(주입한 자식 실행 함수로 센다). 양성 대조 — 결함이 있으면 정확히 한 번 띄운다.
 * - 자식의 인자 · env(연락처는 받기 도구의 env 에만 · 명령줄에 0) · 시간 제한 · 차례(D9 표).
 * - 보고 첫 줄의 갈래 · 산출 파일 · 종료 코드 · `--plan-only` · 이력 읽기의 물러섬.
 *
 * ⚠**외부 요청 0 · 진짜 git 0 · 진짜 받기 도구 0** — 자식은 `correction-fakes.ts` 가 흉내 낸다.
 *   파일로 띄우는 본 하나(인자 오류)는 **자식을 띄우기 전에** 끝난다.
 * ⚠시계를 안 읽는다(M6).
 *
 * **T8**(`daily.yml` 정적 배선 + 순수 셸 조각의 실제 실행)은 이 파일 맨 아래다(설계 D13 이 T8 · T9 를 같은 파일에 둔다 · 작업 D).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUTO_REFETCH_MAX_RETRIES, AUTO_REFETCH_REQUEST_TIMEOUT_MS } from "@bb-app/store/refetch-limit";
import { CLI_GAMES_DEFAULT_DELAY_MS } from "../../packages/archiver/src/cli-games.ts";
import { GAME_PAGES } from "../../packages/archiver/src/discover.ts";
import { MAX_REDIRECTS } from "../../packages/archiver/src/fetcher.ts";
import { CHILD_TIMEOUT_MS, FETCH_CHILD_MARGIN_MS, FETCH_DELAY_MS, FETCH_WORST_GAME_MS, HISTORY_PATH } from "../correction-plan.ts";
import { INCIDENT, K_WP, NOW, OLD, START, defect, detectJson, makeWorld, runMain, sha256 } from "./correction-fakes.ts";
import type { World } from "./correction-fakes.ts";
import { DAILY, jobBlock, runBash, runOf, stepNamed, stepsOf } from "./workflow-shell.ts";

const IDS = ["2026/0923/s-t-23", "2026/0917/t-c-20", "2026/0513/s-t-08"];
const ENTRY = fileURLToPath(new URL("../correction-refetch.ts", import.meta.url));

/** 사고 키 하나 · 후보 3경기(취득 시각은 옛 것) */
function incidentWorld(o: Partial<World> = {}): World {
  const w = makeWorld(o);
  w.keyGames.set(K_WP, [...IDS]);
  return w;
}
/** 사전은 결함, 사후는 결함 없음(정정을 받아 풀렸다) */
const resolves = (phase: "before" | "after") => ({ exit: 0, json: detectJson(phase === "before" ? {} : { defects: [] }) });

const firstLine = (s: string | null): string => (s ?? "").split("\n")[0] ?? "";

// ── T9 요청 0 증가 ─────────────────────────────────────────────────────────────

test("⚠T9 결함이 있으면 받기 도구를 정확히 한 번 띄운다(양성 대조 — 아래 「0」이 빈 세계 때문이 아니다)", () => {
  const w = incidentWorld({ detect: resolves });
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.deepEqual(r.spawned, ["detect-before", "fetch", "reload", "detect-after"]);
});

test("⚠T9 no_defects · retry_slot · unmeasured · too_many_defects · time_budget 에서는 받기 도구를 띄우지 않는다", () => {
  const many = [INCIDENT, ...Array.from({ length: 20 }, (_, i) => defect({ team: "h", kind: "batting", player_id: String(60000000 + i), field: "安打", ours: "5", published: "4" }))];
  const cases: [string, Partial<World>, Record<string, string>, string][] = [
    ["no_defects", { detect: () => ({ exit: 0, json: detectJson({ defects: [] }) }) }, {}, "no_defects"],
    ["retry_slot", {}, { BB_RUN_SLOT: "retry" }, "retry_slot"],
    ["unmeasured", { detect: () => ({ exit: 2, json: detectJson({ status: "unmeasured" }) }) }, {}, "unmeasured:tables_missing"],
    ["too_many_defects", { detect: () => ({ exit: 0, json: detectJson({ defects: many }) }) }, {}, "too_many_defects"],
    ["time_budget", {}, { BB_COLLECT_STARTED_AT: "2026-09-28T20:26:03Z" }, "time_budget"],
  ];
  for (const [name, o, env, reason] of cases) {
    const w = incidentWorld(o);
    const r = runMain(w, { env });
    assert.equal(r.exit, 0, name);
    assert.deepEqual(r.spawned, ["detect-before"], `${name}: 감지 말고 띄운 것이 있다`);
    assert.equal(w.fetchCount.size, 0, `${name}: 경기를 받았다`);
    assert.equal(firstLine(r.file("report.txt")).startsWith(`정정 자동 재수집 — 해 보지 않았다: ${reason} — `), true, `${name}: ${firstLine(r.file("report.txt"))}`);
  }
});

// ── 자식의 인자 · env · 시간 제한 ─────────────────────────────────────────────

test("⚠자식 인자 — 감지 · 받기(--delay 3000 · 마감 = 잡 시작 + 25분) · 다시 적재(--max-writes 5000000) · 사후 감지", () => {
  const w = incidentWorld({ detect: resolves });
  const r = runMain(w);
  const [pre, fetch, reload, post] = w.spawns;
  const db = join(w.dir, "bb.sqlite");
  const archive = join(w.dir, "archive");
  assert.deepEqual(pre?.args, [join(w.dir, "packages/aggregate/tools/crosscheck.ts"), db, "2026", "--archive", archive, "--emit", join(r.work, "detect-before.json")]);
  assert.deepEqual(fetch?.args, [
    join(w.dir, "packages/archiver/src/cli-games.ts"),
    "--ids", join(r.work, "games.txt"),
    "--out", archive,
    "--delay", "3000",
    "--deadline", "2026-09-28T21:05:57.000Z",
    "--result", join(r.work, "fetch-result.json"),
  ]);
  assert.deepEqual(reload?.args, [join(w.dir, "packages/store/tools/load-archive.ts"), archive, db, "--max-writes", "5000000"]);
  assert.deepEqual(post?.args, [join(w.dir, "packages/aggregate/tools/crosscheck.ts"), db, "2026", "--archive", archive, "--emit", join(r.work, "detect-after.json")]);
  assert.equal(r.file("games.txt"), `${IDS.join("\n")}\n`);
});

test("⚠연락처는 받기 도구의 env 로만 간다 — 명령줄에 0 · 다른 자식의 env 에도 0", () => {
  const w = incidentWorld({ detect: resolves });
  runMain(w, { env: { BB_ARCHIVER_CONTACT: "  ops@example.invalid  " } });
  for (const s of w.spawns) {
    assert.ok(!s.args.some((a) => a.includes("example.invalid")), `${s.label}: 연락처가 명령줄에 있다`);
    if (s.label === "fetch") assert.equal(s.env["BB_ARCHIVER_CONTACT"], "ops@example.invalid");
    else assert.equal(s.env["BB_ARCHIVER_CONTACT"], undefined, `${s.label}: 연락처가 env 에 있다`);
  }
});

test("⚠자식 시간 제한(D7-9) — 감지 120초 · 다시 적재 600초 · 받기 = max(0, 마감 − 지금) + 292초 + 60초", () => {
  const w = incidentWorld({ detect: resolves });
  runMain(w);
  const t = Object.fromEntries(w.spawns.map((s) => [s.label, s.timeoutMs]));
  assert.equal(t["detect-before"], 120_000);
  assert.equal(t["detect-after"], 120_000);
  assert.equal(t["reload"], 600_000);
  // 지금 = 잡 시작 + 606초 → 마감까지 894초
  assert.equal(t["fetch"], 894_000 + 292_000 + 60_000);
  assert.deepEqual(CHILD_TIMEOUT_MS, { git: 60_000, detect: 120_000, reload: 600_000 });
  assert.equal(FETCH_CHILD_MARGIN_MS, 60_000);
});

test("⚠받기 시간 제한의 292초 · --delay 3000 은 아카이버 상수로 다시 셈한 값과 같다(T13 과 한 벌)", () => {
  assert.equal(FETCH_DELAY_MS, CLI_GAMES_DEFAULT_DELAY_MS);
  const attempts = AUTO_REFETCH_MAX_RETRIES + 1;
  const transmission = CLI_GAMES_DEFAULT_DELAY_MS + AUTO_REFETCH_REQUEST_TIMEOUT_MS;
  let backoff = 0;
  for (let a = 0; a < attempts; a += 1) backoff += CLI_GAMES_DEFAULT_DELAY_MS * 2 ** a;
  const page = attempts * (1 + MAX_REDIRECTS) * transmission + backoff;
  assert.equal(FETCH_WORST_GAME_MS, GAME_PAGES.length * page);
});

// ── 보고 첫 줄의 갈래 · 종료 코드 ─────────────────────────────────────────────

test("보고 — 해 봤다(풀림) · 산출 파일 · 표준출력 = report.txt", () => {
  const w = incidentWorld({ detect: resolves });
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.equal(firstLine(r.file("report.txt")), "정정 자동 재수집 — 해 봤다: 3경기(3일) · 논리 페이지 12 · HTTP 전송 12 · 남은 결함 후보 0건(대상 키 0 · 소진 0)");
  // 감지 줄 — 감지를 했으면 「안 함」이 붙지 않는다(첫 판에서 붙었다)
  assert.match(r.file("report.txt") ?? "", /\n {2}사전 감지: defects · 결함 후보 1건 · 기준일 2026-09-27\(genzai\)\n/);
  assert.match(r.file("report.txt") ?? "", /\n {4}2026-09-17 2026\/0917\/t-c-20 暴投 1 → 1 · recorded\n/);
  assert.equal(r.out.filter((l) => !l.startsWith("::")).join("\n"), (r.file("report.txt") ?? "").replace(/\n$/, ""));
  const json = JSON.parse(r.file("report.json") ?? "{}") as Record<string, unknown>;
  assert.equal(json["schema"], 1);
  assert.equal(json["verdict"], "refetched");
  assert.equal(json["exit"], 0);
  assert.equal(json["elapsed_ms"], 606_000);
  assert.deepEqual((json["selected"] as { dates: string[] }).dates, ["2026-09-23", "2026-09-17", "2026-05-13"]);
  assert.equal(r.file("history.base"), "absent");
  // 풀렸으니 이력은 비었다 — 처음부터 비어 있었으므로 「바뀌지 않았다」 → 다음 이력을 쓰지 않는다
  assert.equal(r.file("history.next.json"), null);
});

test("보고 — 마감·예산·고통 신호로 멈췄으면 「멈춤: <사유>(남은 G경기는 다음 정시 실행)」 · 종료 0", () => {
  const w = incidentWorld({ fetchOutcome: (_, i) => (i === 2 ? { status: "skipped", reason: "deadline" } : {}) });
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤다: 2경기\(2일\) · 논리 페이지 8 · HTTP 전송 8 · 남은 결함 후보 1건\(대상 키 1 · 소진 0\) · 멈춤: deadline\(남은 1경기는 다음 정시 실행\)$/);
});

test("⚠보고 — 받기 실패면 「해 봤으나 실패」 · 종료 1 · 보고와 다음 이력은 이미 썼다(P2-5)", () => {
  const w = incidentWorld({ fetchOutcome: (_, i) => (i === 0 ? { status: "prepare_failed" } : { status: "skipped", reason: "circuit_open" }) });
  const r = runMain(w);
  assert.equal(r.exit, 1);
  assert.equal(firstLine(r.file("report.txt")), "정정 자동 재수집 — 해 봤으나 실패: 받기 실패 1경기 — 런북 §7-E");
  assert.ok(!r.spawned.includes("reload"), "recorded 0 · 되돌림 실패 0 인데 다시 적재했다");
  assert.notEqual(r.file("history.next.json"), null, "① 의 새 일화를 쓰지 않았다");
  assert.equal(r.file("history.base"), "absent");
});

test("⚠보고 — 되돌리기도 실패(이중 고장)면 「섞인 세트 남음」 · 다시 적재는 부른다(R3-2) · 종료 1", () => {
  const w = incidentWorld({
    fetchOutcome: (_, i) => (i === 0 ? { status: "commit_failed", rollback: "failed" } : { status: "skipped", reason: "circuit_open" }),
    reloadExit: 1,
  });
  const r = runMain(w);
  assert.equal(r.exit, 1);
  assert.equal(firstLine(r.file("report.txt")), "정정 자동 재수집 — 해 봤으나 실패 — 섞인 세트 남음: 2026/0923/s-t-23 — 런북 §7-E");
  assert.deepEqual(r.spawned, ["detect-before", "fetch", "reload"]);
  // report.json 의 failures 에도 빠짐없이(첫 판에서 기록 실패가 빠졌다)
  const json = JSON.parse(r.file("report.json") ?? "{}") as { failures: string[]; verdict: string };
  assert.equal(json.verdict, "failed");
  assert.ok(json.failures.some((f) => f.includes("되돌림 실패")), JSON.stringify(json.failures));
  assert.ok(json.failures.some((f) => f.startsWith("다시 적재 실패")), JSON.stringify(json.failures));
});

test("⚠보고 — 다시 적재가 실패하면 사후 감지·④·⑤ 를 건너뛴다 · 종료 1", () => {
  const w = incidentWorld({ reloadExit: 1, detect: resolves });
  const r = runMain(w);
  assert.equal(r.exit, 1);
  assert.deepEqual(r.spawned, ["detect-before", "fetch", "reload"]);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤으나 실패: 다시 적재 실패\(종료 1\) — 런북 §7-E$/);
  // ③ 시도 기록은 남는다(아카이브에는 새 사본이 있다)
  const next = JSON.parse(r.file("history.next.json") ?? "{}") as { keys: Record<string, { attempts: unknown[] }> };
  assert.equal(next.keys[K_WP]?.attempts.length, 3);
});

test("보고 — 받기 도구가 결과 없이 끝났으면 실패 · 다시 적재하지 않는다(recorded 를 모른다)", () => {
  const w = incidentWorld({ fetchExit: { code: 1, noJson: true } });
  const r = runMain(w);
  assert.equal(r.exit, 1);
  assert.deepEqual(r.spawned, ["detect-before", "fetch"]);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤으나 실패: 받기 도구가 결과 없이 끝났다/);
});

test("보고 — 연락처가 비면 받기 도구를 띄우지 않고 종료 1", () => {
  const w = incidentWorld();
  const r = runMain(w, { env: { BB_ARCHIVER_CONTACT: " " } });
  assert.equal(r.exit, 1);
  assert.deepEqual(r.spawned, ["detect-before"]);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤으나 실패: 연락처 없음/);
});

test("보고 — DB 를 못 읽으면 받지 않고 종료 1(계획 실패)", () => {
  const w = incidentWorld({ dbFailsFrom: 0 });
  const r = runMain(w);
  assert.equal(r.exit, 1);
  assert.deepEqual(r.spawned, ["detect-before"]);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤으나 실패: 계획 실패 — /);
});

test("보고 — 감지기 오류면 받지 않고 종료 0(관문이 판정한다) · 이력을 바꾸지 않는다", () => {
  const w = incidentWorld({ detect: () => ({ exit: 1, json: null }) });
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 보지 않았다: detector_error — /);
  assert.equal(r.file("history.next.json"), null);
});

test("보고 — 사후 감지가 측정 못 하면 「사후 측정 못 함」 · 종료 0 · ③ 까지의 이력", () => {
  const w = incidentWorld({ detect: (p) => (p === "before" ? { exit: 0, json: detectJson() } : { exit: 2, json: detectJson({ status: "unmeasured", reason: "asof_split" }) }) });
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 봤다: 3경기\(3일\) · 논리 페이지 12 · HTTP 전송 12 · 사후 측정 못 함\(unmeasured:asof_split\)$/);
});

// ── --plan-only ──────────────────────────────────────────────────────────────

test("⚠--plan-only — 감지 → 계획 → 보고만 · 받기·적재·이력 쓰기 0 · git 0", () => {
  const w = incidentWorld();
  const r = runMain(w, { planOnly: true });
  assert.equal(r.exit, 0);
  assert.equal(w.remoteReads, 0, "계획만인데 원격 이력(git)을 읽었다");
  assert.deepEqual(r.spawned, ["detect-before"]);
  assert.equal(r.file("history.base"), null);
  assert.equal(r.file("history.next.json"), null);
  assert.equal(r.file("games.txt"), null);
  assert.equal(
    firstLine(r.file("report.txt")),
    "정정 자동 재수집 — 계획만(--plan-only): 3경기(3일) · 논리 페이지(예정) 12 · 고른 날짜 2026-09-23, 2026-09-17, 2026-05-13",
  );
  const json = JSON.parse(r.file("report.json") ?? "{}") as Record<string, unknown>;
  assert.equal(json["verdict"], "planned");
});

// ── 이력 읽기 ────────────────────────────────────────────────────────────────

test("⚠이력 — 원격 읽기가 실패하면 작업 트리 사본으로 물러서고 경고한다 · base 는 읽은 바이트의 sha256", () => {
  const w = incidentWorld({ remoteFails: true, detect: () => ({ exit: 0, json: detectJson() }) });
  const local = `${JSON.stringify({ schema: 1, keys: { [K_WP]: { direction: "ours_more", first_seen_at: "2026-09-25T00:00:00.000Z", first_seen_run: "7", last_seen_at: "2026-09-25T00:00:00.000Z", attempts: [] } } }, null, 2)}\n`;
  mkdirSync(join(w.dir, "ops"), { recursive: true });
  writeFileSync(join(w.dir, HISTORY_PATH), local);
  const r = runMain(w);
  assert.ok(r.out.some((l) => l.startsWith("::warning::") && l.includes("작업 트리")), r.out.join("\n"));
  assert.equal(r.file("history.base"), sha256(local));
  // 작업 트리 사본의 일화 시작(9/25)을 썼다 — 그 키는 이어진다(first_seen_run 7)
  const next = JSON.parse(r.file("history.next.json") ?? "{}") as { keys: Record<string, { first_seen_run: string }> };
  assert.equal(next.keys[K_WP]?.first_seen_run, "7");
});

test("이력 — GITHUB_REF_NAME 이 없으면 원격을 묻지 않고 작업 트리 사본(없으면 빈 이력) · 경고", () => {
  const w = incidentWorld();
  w.remote = new TextEncoder().encode(JSON.stringify({ schema: 2 }));
  const r = runMain(w, { env: { GITHUB_REF_NAME: undefined } });
  assert.ok(r.out.some((l) => l.startsWith("::warning::") && l.includes("GITHUB_REF_NAME")));
  assert.equal(r.file("history.base"), "absent");
  assert.ok(r.spawned.includes("fetch"), "원격의 손상된 판을 읽었다");
});

test("⚠이력 — 원격 판 위에서만 쓴다: base = 원격 바이트의 sha256 · 바뀐 경우에만 다음 이력", () => {
  const remote = `${JSON.stringify({ schema: 1, keys: { [K_WP]: { direction: "ours_more", first_seen_at: START, first_seen_run: "1", last_seen_at: START, attempts: [] } } }, null, 2)}\n`;
  const w = incidentWorld({ remote: new TextEncoder().encode(remote), detect: () => ({ exit: 2, json: detectJson({ status: "unmeasured" }) }) });
  const r = runMain(w);
  assert.equal(r.file("history.base"), sha256(remote));
  assert.equal(r.file("history.next.json"), null, "unmeasured 인데 이력을 바꿨다");
});

// ── 결정론(R2-4) · 작업 폴더 ─────────────────────────────────────────────────

test("⚠보고 JSON 은 결함 배열 · 후보 행 순서를 뒤집어도 바이트가 같다(R2-4)", () => {
  const two = [INCIDENT, defect({ team: "g", player_id: "30000001", name: "乙", field: "安打", kind: "batting", ours: "100", published: "99" })];
  const run = (reverse: boolean): string => {
    const w = makeWorld({ detect: () => ({ exit: 0, json: detectJson({ defects: reverse ? [...two].reverse() : two }) }) });
    const a = [...IDS];
    const b = ["2026/0922/g-s-22", "2026/0918/g-s-18"];
    w.keyGames.set(K_WP, reverse ? a.reverse() : a);
    w.keyGames.set("2026|g|batting|30000001|安打", reverse ? b.reverse() : b);
    const r = runMain(w);
    return (r.file("report.json") ?? "").replaceAll(w.dir, "<dir>").replaceAll(JSON.stringify(w.dir).slice(1, -1), "<dir>");
  };
  assert.equal(run(true), run(false));
});

test("작업 폴더의 옛 산출을 먼저 지운다 — 이 실행이 안 쓴 다음 이력이 남지 않는다", () => {
  const w = incidentWorld({ detect: () => ({ exit: 0, json: detectJson({ defects: [] }) }) });
  const work = join(w.dir, "work");
  mkdirSync(work, { recursive: true });
  for (const f of ["history.next.json", "fetch-result.json", "detect-after.json", "games.txt"]) writeFileSync(join(work, f), "옛 것");
  const r = runMain(w, { work });
  assert.equal(r.file("history.next.json"), null);
  assert.equal(r.file("fetch-result.json"), null);
  assert.equal(r.file("detect-after.json"), null);
  assert.equal(r.file("games.txt"), null);
});

test("시작 시각이 옛 취득 시각보다 앞이면(E2 로 전부 빠짐) all_exhausted · 소진을 찍는다", () => {
  const w = incidentWorld();
  for (const id of IDS) w.dbFetched.set(id, "2026-09-28T20:45:00.000Z");
  const r = runMain(w);
  assert.equal(r.exit, 0);
  assert.match(firstLine(r.file("report.txt")), /^정정 자동 재수집 — 해 보지 않았다: all_exhausted — /);
  const next = JSON.parse(r.file("history.next.json") ?? "{}") as { keys: Record<string, { exhausted_at?: string }> };
  assert.equal(next.keys[K_WP]?.exhausted_at, NOW);
  assert.ok(r.out.some((l) => l.includes("소진 — 런북 §7-I") && l.includes(K_WP)));
  void OLD;
});

// ── 파일 실행 ────────────────────────────────────────────────────────────────

test("import 만으로는 아무것도 하지 않는다 · 파일로 띄우면 인자 오류는 자식을 띄우기 전에 종료 2", () => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(ENTRY).href)});`], {
    encoding: "utf8",
  });
  assert.equal(out, "");
  const dir = mkdtempSync(join(tmpdir(), "bb-corr-entry-"));
  const r = spawnSync(process.execPath, [ENTRY, "--work-dir", dir, "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.deepEqual(readdirSync(dir), [], "인자 오류인데 작업 폴더에 무엇을 썼다");
  assert.equal(existsSync(join(dir, "report.txt")), false);
});

// ══════════════════════════════════════════════════════════════════════════════
// T8 — `daily.yml` 정적 배선 + 순수 셸 조각의 실제 실행(설계 D1 · D8 · D10 · D13 의 T8)
//
// ⚠**글자만 보지 않는다.** 이 저장소는 「배선이 있다」와 「그것이 돈다」가 갈린 사고를 여러 번 겪었다 — 외부 요청 0 · git 0 인 셸 조각
//   (이력 반영 · 관문의 보고 재출력)은 임시 폴더에서 **실제 bash 로** 돌린다(`workflow-shell.ts` · bash 가 없으면 시험이 실패한다).
// ⚠주석은 걷어내고 본다 — 「이렇게 하지 마라」고 적은 주석이 증거로 읽히면 시험이 헛돈다.
// ══════════════════════════════════════════════════════════════════════════════

const DECIDE = jobBlock(DAILY, "decide");
const COLLECT_JOB = jobBlock(DAILY, "collect");
const COLLECT_STEPS = stepsOf(DAILY, "collect");

const CORR_NAME = "정정 감지 · 자동 재수집";
/** ⚠새 스텝이 없을 때(고치기 전 코드) import 에서 죽지 않게 빈 스텝으로 받는다 — 시험마다 따로 붉어지게 한다 */
const soft = (prefix: string): ReturnType<typeof stepNamed> => {
  try {
    return stepNamed(DAILY, "collect", prefix);
  } catch {
    return { name: `<${prefix} 없음>`, uses: "", body: "", at: -1 };
  }
};
const CORR = soft(CORR_NAME);
const STAMP = soft("잡 시작 시각");
const RECORD = stepNamed(DAILY, "collect", "기록 갱신과 커밋");
const GATE = stepNamed(DAILY, "collect", "외부 대조");

/** 글자에서 `#` 주석 줄을 뺀다(셸 글자와 YAML 키 줄 둘 다) */
const noComment = (s: string): string =>
  s
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

test("⚠T8 collect 잡 — timeout-minutes 는 45 그대로(D7-8 의 합이 이 값 안이다)", () => {
  assert.match(COLLECT_JOB, /^ {4}timeout-minutes: 45$/m);
});

test("⚠T8 job-start — collect 의 맨 앞 스텝이고 체크아웃보다 앞이며 UTC 초 단위 시각을 낸다", () => {
  assert.equal(COLLECT_STEPS[0]!.name, STAMP.name, `첫 스텝이 「${COLLECT_STEPS[0]!.name}」다 — 잡 시작 시각이 첫 스텝이어야 한다`);
  const checkout = COLLECT_STEPS.findIndex((s) => s.uses.startsWith("actions/checkout@"));
  assert.ok(checkout > 0, "체크아웃 스텝을 못 찾았거나 첫 스텝이다 — 잡 시작 시각이 그보다 앞이어야 한다");
  assert.match(noComment(STAMP.body), /^ {8}id: job-start$/m);
  assert.equal(runOf(STAMP), 'echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"');
  assert.doesNotMatch(noComment(STAMP.body), /^ {8}if:/m, "잡 시작 시각에 조건이 붙었다 — 늘 찍어야 한다");
});

test("⚠T8 job-start 의 출력 모양은 진입점이 읽는 모양이다(UTC `…Z` 초 단위 · 시간대 없는 값이 아니다)", () => {
  const r = runBash(runOf(STAMP), { GITHUB_OUTPUT: "out.txt" });
  assert.equal(r.status, 0, r.stderr);
  const out = readFileSync(join(r.dir, "out.txt"), "utf8").trim();
  assert.match(out, /^at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("⚠T8 decide — slot 출력이 outputs 에 있고 · 갈래마다 · exit 0 앞에서 나온다", () => {
  assert.match(DECIDE, /^ {6}slot: \$\{\{ steps\.check\.outputs\.slot \}\}$/m, "decide 의 outputs 에 slot 이 없다");
  const run = noComment(runOf(stepNamed(DAILY, "decide", "재시도 슬롯인가")));
  const open = run.indexOf('case "${SCHEDULE:-}" in');
  assert.notEqual(open, -1);
  const close = run.indexOf("esac", open);
  const body = run.slice(open, close);
  for (const v of ["retry", "manual", "scheduled"]) {
    const n = body.split(`slot=${v}`).length - 1;
    assert.equal(n, 1, `case 안에 slot=${v} 가 ${String(n)}번이다 — 정확히 한 번이어야 한다`);
  }
  const exit0 = body.indexOf("exit 0");
  assert.ok(exit0 > body.indexOf("slot=manual") && exit0 > body.indexOf("slot=scheduled"), "slot 출력이 `exit 0` 뒤에 있다 — 정시 슬롯에서 비어 나간다");
  assert.ok(body.indexOf("slot=retry") < exit0, "slot=retry 가 정시 갈래의 `exit 0` 뒤에 있다");
  // 재시도 크론 목록은 한 곳이다 — 슬롯용 둘째 목록을 만들지 않았다(`retry-slot.test.ts` 가 크론과의 일치를 따로 지킨다)
  assert.equal((run.match(/"30 23 \* \* \*"/g) ?? []).length, 1, "재시도 크론 글자가 case 한 곳 말고도 쓰였다 — 목록이 둘이 됐다");
});

test("⚠T8 새 스텝의 자리 — 공표 성적표 갱신 바로 뒤 · 수집 후 재검증 바로 앞(사이에 스텝이 없다)", () => {
  const names = COLLECT_STEPS.map((s) => s.name);
  const at = names.findIndex((n) => n.startsWith(CORR_NAME));
  assert.ok(at > 0);
  assert.ok(names[at - 1]!.startsWith("공표 성적표 갱신"), `앞 스텝이 「${names[at - 1]}」다`);
  assert.ok(names[at + 1]!.startsWith("수집 후 재검증"), `뒤 스텝이 「${names[at + 1]}」다`);
});

test("⚠T8 새 스텝 — id correction · if 없음(= success()) · continue-on-error 없음 · timeout-minutes 30 · 실행 한 줄", () => {
  const b = noComment(CORR.body);
  assert.match(b, /^ {8}id: correction$/m);
  assert.doesNotMatch(b, /^ {8}if:/m, "if: 가 붙었다 — 앞 단계가 실패한 실행에서 돌면 안 되고, 그걸 `if:` 없이(success()) 지킨다");
  assert.doesNotMatch(b, /^ {8}continue-on-error:/m, "continue-on-error 가 붙었다 — 이 단계의 실패(종료 1)는 배포를 막아야 한다");
  assert.match(b, /^ {8}timeout-minutes: 30$/m);
  assert.equal(runOf(CORR), "node scripts/correction-refetch.ts --db data/bb.sqlite --archive data/archive --work-dir /tmp/correction-refetch");
  assert.equal(noComment(runOf(CORR)).includes("${{"), false, "run: 에 식이 직접 들어갔다 — env 로만 넘겨라");
});

test("⚠T8 새 스텝의 env — 정확히 네 줄(시크릿 하나 · 입력 · 슬롯 · 잡 시작) · 다른 토큰은 넘기지 않는다", () => {
  const lines = noComment(CORR.body).split("\n");
  const envAt = lines.findIndex((l) => l === "        env:");
  assert.notEqual(envAt, -1, "env: 가 없다");
  const envLines: string[] = [];
  for (const l of lines.slice(envAt + 1)) {
    if (!l.startsWith("          ")) break;
    envLines.push(l);
  }
  assert.deepEqual(envLines, [
    "          BB_ARCHIVER_CONTACT: ${{ secrets.BB_ARCHIVER_CONTACT }}",
    "          BB_REFETCH_DATES: ${{ inputs.refetch_dates }}",
    "          BB_RUN_SLOT: ${{ needs.decide.outputs.slot }}",
    "          BB_COLLECT_STARTED_AT: ${{ steps.job-start.outputs.at }}",
  ]);
  assert.equal(/secrets\.(BB_DATA_TOKEN|CLOUDFLARE|BB_CONTACT)|GH_TOKEN|github\.token/.test(noComment(CORR.body)), false, "이 단계에 필요 없는 토큰이 넘어갔다");
});

test("⚠T8 워크플로의 env 이름과 진입점이 읽는 env 가 같은 집합이다 — 한쪽만 바뀌면 붉다", () => {
  const src = readFileSync(ENTRY, "utf8");
  const read = new Set([...src.matchAll(/env\["([A-Z_]+)"\]/g)].map((m) => m[1]!));
  const runner = ["GITHUB_RUN_ID", "GITHUB_REF_NAME"]; // 러너가 늘 주는 값 — 워크플로에 적지 않는다
  const given = [...noComment(CORR.body).matchAll(/^ {10}([A-Z_]+):/gm)].map((m) => m[1]!);
  assert.deepEqual([...read].sort(), [...given, ...runner].sort());
  for (const flag of ["db", "archive", "work-dir"]) assert.ok(src.includes(`"${flag}"`) || src.includes(`${flag}:`), `진입점이 --${flag} 를 모른다`);
});

test("⚠T8 always() 단계의 조건과 순서가 그대로다 — 새 단계가 업로드 · 기록 · 관문의 조건을 바꾸지 않았다", () => {
  const names = COLLECT_STEPS.map((s) => s.name);
  const idx = (p: string): number => names.findIndex((n) => n.startsWith(p));
  assert.ok(idx(CORR_NAME) >= 0, "새 스텝이 없다 — 아래 순서 검사가 빈 채로 통과하지 않게 먼저 막는다");
  assert.ok(idx(CORR_NAME) < idx("수집 후 재검증") && idx("수집 후 재검증") < idx("보관소에 올림") && idx("보관소에 올림") < idx("기록 갱신과 커밋"), "차례가 바뀌었다");
  assert.ok(idx("기록 갱신과 커밋") < idx("파서 자기 검증") && idx("파서 자기 검증") < idx("득점 대조") && idx("득점 대조") < idx("외부 대조") && idx("외부 대조") < idx("화면 생성"), "관문의 차례가 바뀌었다");
  assert.match(noComment(stepNamed(DAILY, "collect", "수집 후 재검증").body), /^ {8}if: always\(\)$/m);
  assert.match(noComment(stepNamed(DAILY, "collect", "보관소에 올림").body), /^ {8}if: always\(\) && steps\.guard\.outcome == 'success'$/m);
  assert.match(noComment(RECORD.body), /^ {8}if: always\(\)$/m);
  assert.doesNotMatch(noComment(GATE.body), /^ {8}if:/m, "관문에 조건이 붙었다 — success() 여야 이전 단계 실패 때 건너뛴다");
});

// ── 기록 단계 — 이력 반영(D8 · D1) ─────────────────────────────────────────────

const RECORD_CODE = noComment(runOf(RECORD));
const HIST_FROM = RECORD_CODE.indexOf("if [ -f /tmp/correction-refetch/history.next.json ]; then");
const GIT_ADD = RECORD_CODE.indexOf("git add ops/collection-log.txt");

test("⚠T8 기록 단계 — 이력 반영은 `git reset --hard` 뒤 · `git add` 앞이고 `attempt()` 안이다", () => {
  assert.notEqual(HIST_FROM, -1, "이력 반영 블록이 없다");
  const attempt = RECORD_CODE.indexOf("attempt() {");
  const reset = RECORD_CODE.indexOf('git reset --quiet --hard "origin/${GITHUB_REF_NAME}"');
  assert.ok(attempt !== -1 && reset > attempt, "reset 이 attempt() 안에 없다");
  assert.ok(HIST_FROM > reset, "이력 반영이 reset 앞이다 — reset 이 복사본을 지운다");
  assert.ok(HIST_FROM < GIT_ADD, "이력 반영이 git add 뒤다");
  assert.ok(GIT_ADD < RECORD_CODE.indexOf("git commit"), "git add 가 commit 뒤다");
});

test("⚠T8 기록 단계 — git add 는 로그 3파일 한 줄 + 「파일이 있을 때만」 이력 한 줄뿐이다", () => {
  const adds = RECORD_CODE.split("\n").filter((l) => /\bgit add\b/.test(l));
  assert.deepEqual(
    adds.map((l) => l.trim()),
    [
      "git add ops/collection-log.txt ops/collection-log.jsonl ops/archive-manifest.json",
      "if [ -f ops/correction-refetch.json ]; then git add ops/correction-refetch.json; fi",
    ],
  );
  assert.equal(RECORD_CODE.includes("git add ."), false);
  assert.equal(/git add -[Aa]/.test(RECORD_CODE), false);
});

/** 이력 반영 블록만 — 경로를 상대로 바꿔 임시 폴더에서 돌린다(`/tmp/correction-refetch` → `work`) */
const HISTORY_BLOCK = RECORD_CODE.slice(HIST_FROM, GIT_ADD).replaceAll("/tmp/correction-refetch", "work");

function runHistory(o: { base?: string; next?: string; current?: string }): { out: string; ops: string | null } {
  const r = runBash(`set -euo pipefail\n${HISTORY_BLOCK}`, {}, (dir) => {
    mkdirSync(join(dir, "ops"));
    mkdirSync(join(dir, "work"));
    if (o.base !== undefined) writeFileSync(join(dir, "work", "history.base"), o.base); // ⚠끝 줄바꿈 없음(작업 C 계약)
    if (o.next !== undefined) writeFileSync(join(dir, "work", "history.next.json"), o.next);
    if (o.current !== undefined) writeFileSync(join(dir, "ops", "correction-refetch.json"), o.current);
  });
  assert.equal(r.status, 0, `${r.stderr}\n${HISTORY_BLOCK}`);
  const p = join(r.dir, "ops", "correction-refetch.json");
  return { out: r.stdout, ops: existsSync(p) ? readFileSync(p, "utf8") : null };
}

test("⚠T8 이력 반영(실제 bash) — base 가 현재 파일과 같을 때만 복사한다", () => {
  assert.equal(HISTORY_BLOCK.startsWith("if [ -f work/history.next.json ]; then"), true, "블록을 못 잘랐다 — 이 시험이 공회전한다");
  const cur = '{"schema": 1, "keys": {"a": 1}}\n';
  const next = '{\n  "schema": 1,\n  "keys": {}\n}\n';
  // ① next 가 없으면 아무것도 안 한다(작업 폴더가 없는 실행 · 변화 없음 · 손상 · 감지기 오류)
  const none = runHistory({ base: sha256(cur), current: cur });
  assert.equal(none.ops, cur);
  assert.equal(none.out, "");
  // ② 없던 파일에서 시작(base = absent)
  assert.equal(runHistory({ base: "absent", next }).ops, next);
  // ③ 읽은 판 그대로(base = 현재 sha256)
  const same = runHistory({ base: sha256(cur), next, current: cur });
  assert.equal(same.ops, next);
  assert.equal(same.out, "");
  // ④ 읽은 뒤에 누가 바꿨다 — 덮어쓰지 않고 경고한다
  const changed = runHistory({ base: sha256(cur), next, current: `${cur} ` });
  assert.equal(changed.ops, `${cur} `, "읽은 뒤에 바뀐 이력을 덮어썼다");
  assert.match(changed.out, /::warning::정정 재수집 이력이 이 실행이 읽은 뒤에 바뀌었다/);
  // ⑤ 없다고 읽었는데 그 사이 생겼다
  const born = runHistory({ base: "absent", next, current: cur });
  assert.equal(born.ops, cur);
  assert.match(born.out, /::warning::/);
  // ⑥ 있다고 읽었는데 지금은 없다(사람이 지웠다)
  const gone = runHistory({ base: sha256(cur), next });
  assert.equal(gone.ops, null);
  assert.match(gone.out, /::warning::/);
  // ⑦ base 를 못 읽으면(파일 없음) 덮어쓰지 않는다 — 읽은 판을 모르는 채로 쓰지 않는다
  const nobase = runHistory({ next, current: cur });
  assert.equal(nobase.ops, cur);
  assert.match(nobase.out, /::warning::/);
});

// ── 런북 §7-I 가 코드의 사유 코드·보고 첫 줄과 같은 말을 한다(D10) ─────────────────────

test("⚠T8 런북 §7-I 가 사유 코드 전부와 보고 첫 줄의 갈래를 적는다 — 코드와 어긋나면 붉다", () => {
  const doc = readFileSync(fileURLToPath(new URL("../../docs/operations/deploy.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const at = doc.indexOf("## 7-I. ");
  assert.notEqual(at, -1, "런북에 §7-I 가 없다");
  const next = doc.indexOf("\n## ", at + 5);
  const section = doc.slice(at, next === -1 ? doc.length : next);
  const plan = readFileSync(fileURLToPath(new URL("../correction-plan.ts", import.meta.url)), "utf8");
  const classify = readFileSync(fileURLToPath(new URL("../../packages/aggregate/src/crosscheck-classify.ts", import.meta.url)), "utf8");
  const CODES = [
    "detector_error",
    "history_invalid",
    "unmeasured:asof_split",
    "unmeasured:table_parse_error",
    "unmeasured:tables_missing",
    "unmeasured:compared_zero",
    "no_defects",
    "retry_slot",
    "slot_unknown",
    "as_of:absent",
    "as_of:partial",
    "as_of:override",
    "too_many_defects",
    "no_eligible",
    "started_at_unknown",
    "time_budget",
    "no_date_slots",
    "all_exhausted",
  ];
  for (const c of CODES) {
    assert.ok(section.includes(`\`${c}\``), `런북 §7-I 에 사유 코드 \`${c}\` 가 없다`);
    const word = c.split(":").at(-1)!;
    assert.ok(plan.includes(word) || classify.includes(word), `코드(correction-plan.ts · crosscheck-classify.ts)에 「${word}」가 없다 — 사유 코드가 바뀌었는데 이 목록과 런북이 안 따라갔다`);
  }
  // 코드가 내는 `skip("<코드>"` 리터럴이 전부 위 목록에 있다 — 새 사유가 생기면 런북부터 쓴다
  const emitted = [...plan.matchAll(/skip\("([a-z_]+)"/g)].map((m) => m[1]!);
  assert.ok(emitted.length >= 8, `skip 리터럴을 ${String(emitted.length)}개밖에 못 찾았다 — 이 검사가 공회전한다`);
  for (const e of emitted) assert.ok(CODES.includes(e), `코드가 새 사유 「${e}」 를 내는데 런북 §7-I 의 목록에 없다`);
  // 보고 첫 줄의 갈래 · 소진 경고 · 관문이 다시 찍는 머리
  for (const frag of ["해 봤다:", "해 보지 않았다:", "해 봤으나 실패", "섞인 세트 남음", "소진 — 런북 §7-I", "── 정정 자동 재수집 보고(이 실행) ──"]) {
    assert.ok(section.includes(frag), `런북 §7-I 에 「${frag}」 가 없다`);
  }
  for (const frag of ["해 봤다:", "해 보지 않았다:", "해 봤으나 실패", "섞인 세트 남음", "소진 — 런북 §7-I"]) {
    assert.ok(plan.includes(frag), `correction-plan.ts 에 「${frag}」 가 없다 — 보고 문구가 바뀌었는데 이 시험과 런북이 안 따라갔다`);
  }
});

// ── 관문 — 판정 불변 · 실패할 때만 보고를 다시 찍는다(D1 · D10) ─────────────────────

const GATE_CODE = noComment(runOf(GATE));

test("⚠T8 관문 — 판정 줄은 그대로다(--emit 없음 · `|| fail=1` · 마지막이 `exit $fail`)", () => {
  assert.match(
    GATE_CODE,
    /node packages\/aggregate\/tools\/crosscheck\.ts data\/bb\.sqlite "\$y" --archive data\/archive --verbose \|\| fail=1\n/,
    "외부 대조 호출이 바뀌었다 — 사용자 결정 ②(관문 판정 불변)",
  );
  assert.equal(GATE_CODE.includes("--emit"), false, "관문이 감지 모드로 돈다 — 관문은 --emit 없이 부른다");
  assert.ok(GATE_CODE.trimEnd().endsWith("exit $fail"), "마지막 줄이 `exit $fail` 이 아니다");
  assert.match(GATE_CODE, /^ *fail=0$/m);
  assert.equal((GATE_CODE.match(/fail=1/g) ?? []).length, 1, "fail 을 올리는 곳이 둘 이상이다 — 판정이 바뀌었다");
});

const GATE_TAIL = GATE_CODE.slice(GATE_CODE.indexOf('if [ "$fail" != 0 ]; then')).replaceAll("/tmp/correction-refetch", "work");

function runGateTail(fail: number, report: string | null): { status: number | null; out: string } {
  const r = runBash(`fail=${String(fail)}\n${GATE_TAIL}`, {}, (dir) => {
    mkdirSync(join(dir, "work"));
    if (report !== null) writeFileSync(join(dir, "work", "report.txt"), report);
  });
  return { status: r.status, out: r.stdout };
}

test("⚠T8 관문 꼬리(실제 bash) — 실패할 때만 보고를 다시 찍고 종료코드는 그대로다", () => {
  const rep = "정정 자동 재수집 — 해 봤다: 3경기(3일) · 논리 페이지 12 · HTTP 전송 12 · 남은 결함 후보 1건(대상 키 1 · 소진 0)\n본문\n";
  assert.equal(GATE_TAIL.startsWith('if [ "$fail" != 0 ]; then'), true, "꼬리를 못 잘랐다 — 이 시험이 공회전한다");
  const ok = runGateTail(0, rep);
  assert.equal(ok.status, 0);
  assert.equal(ok.out, "", "통과했는데 보고를 찍었다 — 성공 로그가 길어진다");
  const bad = runGateTail(1, rep);
  assert.equal(bad.status, 1, "종료코드가 fail 을 안 따른다");
  assert.ok(bad.out.includes("── 정정 자동 재수집 보고(이 실행) ──"));
  assert.ok(bad.out.includes(rep), "report.txt 를 그대로 찍지 않았다");
  const none = runGateTail(1, null);
  assert.equal(none.status, 1);
  assert.match(none.out, /보고 없음 — 「정정 감지 · 자동 재수집」 단계가 이 실행에서 보고를 남기지 않았다/);
  const noneOk = runGateTail(0, null);
  assert.equal(noneOk.status, 0);
  assert.equal(noneOk.out, "");
});
