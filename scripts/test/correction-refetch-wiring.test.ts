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
 * ⚠T8(`daily.yml` 정적 배선)은 작업 D 가 이 파일에 더한다(설계 D13 이 T8 · T9 를 같은 파일에 둔다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
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
