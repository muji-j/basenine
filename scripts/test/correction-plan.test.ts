/**
 * **정정 자동 재수집의 판단**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D13 의 T3 · T4 · T5).
 *
 * - T3(순수) — ① 갱신 표 9칸 · ② 대상 판정 · ③ 제외(E1~E3 · 복원 되돌려짐) · ④ 고르기 · ⑤ 관문 1~10 · ⑥ 동률(R2-4) ·
 *   ⑦ 상태 전이(R2-5) · ⑧ 마감 경계(R2-6) · ⑨ `stepExitCode` · ⑩ 이력 검증(R3-4) · ⑪ 다시 적재 조건(R3-2)
 * - T4 — 이번 사고 재현(실제 ID · 날짜 · 취득 시각)
 * - T5 — 남는 결함을 정시·재시도 슬롯에 걸쳐 진입점(`main`)으로 돌린다(가짜 자식 · 가짜 DB · 가짜 git · `correction-fakes.ts`)
 *
 * ⚠**시계를 안 읽는다**(M6) — 「지금」은 전부 고정값이다. ⚠외부 요청 0 · 진짜 git 0 · 진짜 받기 도구 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GAME_PAGES } from "../../packages/archiver/src/discover.ts";
import {
  EMPTY_HISTORY,
  PAGES_PER_GAME,
  PlanError,
  attachAttempts,
  classifyDefects,
  defectKey,
  gamesTxt,
  judgeExhausted,
  parseHistory,
  planRefetch,
  readDetect,
  readFetchResult,
  serializeHistory,
  settleHistory,
  shouldReload,
  stepExitCode,
  timeBudget,
  updateHistory,
} from "../correction-plan.ts";
import type {
  CandidateQuery,
  CandidateRow,
  ChildExit,
  DetectDefect,
  DetectRead,
  FetchRead,
  History,
  HistoryEntry,
  Plan,
  PlanFetch,
  PlanInput,
  StepOutcome,
} from "../correction-plan.ts";
import {
  INCIDENT,
  K_WP,
  NOW,
  OLD,
  RUN,
  START,
  commitHistory,
  dateOfId,
  defect,
  detectJson,
  fetchJson,
  makeWorld,
  runMain,
} from "./correction-fakes.ts";
import type { DetectOpts, FakeGameOutcome } from "./correction-fakes.ts";

const ok = (code: number | null = 0, extra: Partial<ChildExit> = {}): ChildExit => ({
  code,
  signal: null,
  timedOut: false,
  error: null,
  ...extra,
});

/** 감지 결과(성공 판) — 재료가 틀리면 그 자리에서 알린다 */
function det(o: DetectOpts = {}): DetectRead {
  const defects = o.defects ?? [INCIDENT];
  const status = o.status ?? (defects.length === 0 ? "no_defects" : "defects");
  const r = readDetect(ok(status === "unmeasured" ? 2 : 0), detectJson(o), o.season ?? 2026);
  assert.ok(r.ok, `시험 재료의 감지 결과가 틀렸다: ${r.ok ? "" : r.error}`);
  return r;
}

const entry = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  direction: "ours_more",
  first_seen_at: "2026-09-20T00:00:00.000Z",
  first_seen_run: "1",
  last_seen_at: "2026-09-20T00:00:00.000Z",
  attempts: [],
  exhausted_at: null,
  ...o,
});
const hist = (pairs: readonly (readonly [string, HistoryEntry])[]): History => ({ keys: new Map(pairs) });
const keysOf = (h: History): string[] => [...h.keys.keys()];

/** 후보 행(가짜 DB 의 한 줄) */
const row = (id: string, fetched: string | null = OLD, value: number | string | null = 1): CandidateRow => ({
  game_id: id,
  game_date: dateOfId(id),
  fetched_at: fetched,
  value,
});

/** 키(+방향) → 후보 행의 가짜 읽기. 부른 질의를 센다. `reverse` 면 행 순서를 뒤집어 낸다 */
function reader(rows: Record<string, readonly CandidateRow[]>, reverse = false): { read: (q: CandidateQuery) => CandidateRow[]; queries: CandidateQuery[] } {
  const queries: CandidateQuery[] = [];
  return {
    queries,
    read: (q) => {
      queries.push(q);
      const k = defectKey(q.season, q.team, q.kind, q.playerId, q.field);
      const list = [...(rows[`${k}#${q.direction}`] ?? rows[k] ?? [])];
      return reverse ? list.reverse() : list;
    },
  };
}

function input(o: Partial<PlanInput> = {}): PlanInput {
  const detect = o.detect ?? det();
  const history = o.history ?? updateHistory(EMPTY_HISTORY, detect, START, NOW, RUN);
  return {
    detect,
    historyViolation: null,
    history,
    slot: "scheduled",
    manual: { ok: true, dates: null },
    collectStartedAt: START,
    now: NOW,
    ...o,
  };
}

function asFetch(plan: Plan): PlanFetch {
  assert.equal(plan.kind, "fetch", `받는 계획이 아니다: ${plan.kind === "skip" ? `${plan.reason} — ${plan.detail}` : ""}`);
  return plan as PlanFetch;
}
function skipReason(plan: Plan): string {
  assert.equal(plan.kind, "skip", "건너뛰는 계획이 아니다");
  return plan.kind === "skip" ? plan.reason : "";
}

/** `YYYY-MM-DD` + 팀 → 그날 그 팀 경기 ID(시험용 · 날짜마다 팀마다 하나) */
const gid = (date: string, team: string): string => `${date.slice(0, 4)}/${date.slice(5, 7)}${date.slice(8, 10)}/${team}-z-1`;
/** 2026-09-DD */
const sep = (d: number): string => `2026-09-${String(d).padStart(2, "0")}`;

// ── 연결 ──────────────────────────────────────────────────────────────────────

test("PAGES_PER_GAME 은 아카이버의 경기 페이지 수(GAME_PAGES)와 같다 — 계획만 보고의 「논리 페이지(예정)」", () => {
  assert.equal(PAGES_PER_GAME, GAME_PAGES.length);
});

// ── ① 갱신 표(9칸) ────────────────────────────────────────────────────────────

const K_OUT = "2026|g|batting|11111111|安打";
const K_OLD = "2025|t|pitching|91095136|暴投";
const NEW_DEFECT = defect({ team: "c", kind: "batting", player_id: "22222222", name: "新人", field: "本塁打", ours: "10", published: "9" });
const K_NEW = "2026|c|batting|22222222|本塁打";
const H0 = hist([
  [K_WP, entry({ attempts: [{ date: "2026-09-17", at: "2026-09-20T00:00:00.000Z", run: "1" }] })],
  [K_OUT, entry()],
  [K_OLD, entry()],
]);
/** 결함 21건(정시 상한 20 초과) — 사고 키와 새 키를 포함한다 */
const MANY = [INCIDENT, NEW_DEFECT, ...Array.from({ length: 19 }, (_, i) => defect({ team: "h", kind: "batting", player_id: String(40000000 + i), field: "安打", ours: "5", published: "4" }))];

test("T3① 감지 실패(unmeasured · 감지기 오류)면 이력을 바꾸지 않는다 — 결함이 실려 있어도(부분 측정)", () => {
  const unmeasured = det({ status: "unmeasured", defects: [INCIDENT, NEW_DEFECT] });
  assert.equal(serializeHistory(updateHistory(H0, unmeasured, START, NOW, RUN)), serializeHistory(H0));
  const broken = readDetect(ok(1), null, 2026);
  assert.equal(broken.ok, false);
  assert.equal(serializeHistory(updateHistory(H0, broken, START, NOW, RUN)), serializeHistory(H0));
});

test("T3① 측정 성공 · genzai · 결함 ≤ 20 — 있는 키는 last_seen_at · 없는 키는 새 일화(잡 시작) · 목록에 없는 키와 다른 시즌 키는 지운다", () => {
  const h = updateHistory(H0, det({ defects: [INCIDENT, NEW_DEFECT] }), START, NOW, RUN);
  assert.deepEqual(keysOf(h), [K_NEW, K_WP]);
  assert.deepEqual(h.keys.get(K_WP), { ...H0.keys.get(K_WP)!, last_seen_at: NOW });
  assert.deepEqual(h.keys.get(K_NEW), {
    direction: "ours_more",
    first_seen_at: START,
    first_seen_run: RUN,
    last_seen_at: NOW,
    attempts: [],
    exhausted_at: null,
  });
});

test("T3① 측정 성공 · 그 밖(as_of absent · 결함 21건) — 있는 키만 last_seen_at · 새로 만들지 않는다 · 나머지는 지운다", () => {
  for (const d of [det({ defects: [INCIDENT, NEW_DEFECT], asOf: { date: null, source: "absent" } }), det({ defects: MANY })]) {
    const h = updateHistory(H0, d, START, NOW, RUN);
    assert.deepEqual(keysOf(h), [K_WP]);
    assert.deepEqual(h.keys.get(K_WP), { ...H0.keys.get(K_WP)!, last_seen_at: NOW });
  }
});

test("T3① 결함 20건은 정시 상한 안이다(새 일화를 연다) — 21건부터 「그 밖」", () => {
  const twenty = MANY.slice(0, 20);
  assert.ok(updateHistory(EMPTY_HISTORY, det({ defects: twenty }), START, NOW, RUN).keys.has(K_NEW));
  assert.equal(updateHistory(EMPTY_HISTORY, det({ defects: MANY }), START, NOW, RUN).keys.size, 0);
});

test("T3① 방향이 바뀌면 — genzai 는 새 일화로 갈아 끼우고(시도·소진 기록 없음) · 그 밖은 옛 일화를 닫는다(지운다)", () => {
  const old = hist([[K_WP, entry({ direction: "ours_less", attempts: [{ date: "2026-09-17", at: OLD, run: "1" }], exhausted_at: OLD })]]);
  const g = updateHistory(old, det(), START, NOW, RUN);
  assert.deepEqual(g.keys.get(K_WP), {
    direction: "ours_more",
    first_seen_at: START,
    first_seen_run: RUN,
    last_seen_at: NOW,
    attempts: [],
    exhausted_at: null,
  });
  const other = updateHistory(old, det({ asOf: { date: null, source: "absent" } }), START, NOW, RUN);
  assert.equal(other.keys.size, 0);
});

test("T3① 잡 시작을 모르면 새 일화의 시작은 「지금」이다(후보가 넓어지는 쪽 · 그 실행은 받지 않는다)", () => {
  for (const s of ["abc", undefined, "2026-09-28T20:40:57"]) {
    const h = updateHistory(EMPTY_HISTORY, det(), s, NOW, RUN);
    assert.equal(h.keys.get(K_WP)?.first_seen_at, NOW, String(s));
  }
});

test("T3① 값을 못 읽게 된 결함(공표 `-` → NaN)은 「목록에 없다」 — 이력에서 지운다", () => {
  const h = updateHistory(H0, det({ defects: [defect({ published: "NaN" })] }), START, NOW, RUN);
  assert.equal(h.keys.size, 0);
});

// ── ② 대상 판정 ───────────────────────────────────────────────────────────────

test("T3② 대상 판정 — 닫힌 표의 대상 행 · 값 해석 · 방향 · 수로 같음 · 표에 없는 짝 · 중복", () => {
  const r = det({
    defects: [
      defect(), // 暴投 3 > 2 → ours_more
      defect({ team: "g", player_id: "1", field: "暴投", ours: "1", published: "2" }), // ours_less
      defect({ team: "g", kind: "batting", player_id: "2", field: "打率", ours: ".300", published: ".301" }), // 비율
      defect({ team: "g", kind: "batting", player_id: "3", field: "試合", ours: "10", published: "12" }), // 행 수
      defect({ team: "g", player_id: "4", field: "暴投", ours: "null", published: "2" }), // 우리 SUM 전부 NULL
      defect({ team: "g", player_id: "5", field: "暴投", ours: "2", published: "NaN" }), // 공표 `-`
      defect({ team: "g", player_id: "6", field: "投球回", ours: "100.1", published: "100.2" }), // 아웃 301 < 302
      defect({ team: "g", player_id: "7", field: "投球回", ours: "0.1", published: "+" }), // 아웃 1 > 0
      defect({ team: "g", player_id: "8", field: "暴投", ours: "05", published: "5" }), // 수로 같다
      defect({ team: "g", kind: "batting", player_id: "9", field: "暴投", ours: "3", published: "2" }), // 표에 없는 짝
      defect({ team: "G", player_id: "10", field: "暴投", ours: "3", published: "2" }), // 키 모양(팀)
      defect({ team: "g", player_id: "11|x", field: "暴投", ours: "3", published: "2" }), // 키 모양(ID)
      defect({ team: "g", player_id: "12", field: "勝利", ours: "5", published: "4" }), // 결정
      defect({ team: "g", player_id: "13", field: "暴投", ours: "3", published: "2" }),
      defect({ team: "g", player_id: "13", field: "暴投", ours: "3", published: "2" }), // 같은 값 중복 → 하나
      defect({ team: "g", player_id: "14", field: "暴投", ours: "3", published: "2" }),
      defect({ team: "g", player_id: "14", field: "暴投", ours: "4", published: "2" }), // 다른 값 중복 → 대상 아님
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const infos = classifyDefects(r.result);
  const by = new Map(infos.map((i) => [i.key, i]));
  const dir = (k: string): string | null => by.get(k)?.direction ?? null;
  assert.equal(dir("2026|t|pitching|91095136|暴投"), "ours_more");
  assert.equal(dir("2026|g|pitching|1|暴投"), "ours_less");
  assert.equal(dir("2026|g|pitching|6|投球回"), "ours_less");
  assert.equal(dir("2026|g|pitching|7|投球回"), "ours_more");
  assert.equal(dir("2026|g|pitching|12|勝利"), "ours_more");
  assert.equal(dir("2026|g|pitching|13|暴投"), "ours_more");
  for (const k of [
    "2026|g|batting|2|打率",
    "2026|g|batting|3|試合",
    "2026|g|pitching|4|暴投",
    "2026|g|pitching|5|暴投",
    "2026|g|pitching|8|暴投",
    "2026|g|batting|9|暴投",
    "2026|G|pitching|10|暴投",
    "2026|g|pitching|11|x|暴投",
    "2026|g|pitching|14|暴投",
  ]) {
    assert.equal(dir(k), null, `${k} 는 대상이 아니어야 한다`);
    assert.ok((by.get(k)?.why ?? "") !== "", `${k} 에 대상이 아닌 사유가 없다`);
  }
  // 중복은 하나로 · 키는 코드 단위 오름차순(UTF-16 · localeCompare 아님)
  assert.equal(infos.filter((i) => i.key === "2026|g|pitching|13|暴投").length, 1);
  const keys = infos.map((i) => i.key);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

// ── ③ 제외(E1~E3 · 복원 되돌려짐) ─────────────────────────────────────────────

test("T3③ E1 — 후보 질의는 감지의 기준일·대회·팀·ID 로 묻는다 · 기준일 뒤의 행이 돌아오면 계약 위반으로 던진다", () => {
  const { read, queries } = reader({ [K_WP]: [row("2026/0923/s-t-23")] });
  asFetch(planRefetch(input(), read));
  assert.deepEqual(queries, [
    {
      season: 2026,
      competition: "regular",
      through: "2026-09-27",
      team: "t",
      kind: "pitching",
      playerId: "91095136",
      field: "暴投",
      direction: "ours_more",
    },
  ]);
  const after = reader({ [K_WP]: [row("2026/0923/s-t-23"), row("2026/0928/s-t-24")] });
  assert.throws(() => planRefetch(input(), after.read), PlanError);
});

test("T3③ E2 — 일화 시작과 같거나 뒤에 본 사본은 뺀다 · 1ms 앞은 남긴다 · 못 읽는 취득 시각은 남긴다(M11)", () => {
  const { read } = reader({
    [K_WP]: [
      row("2026/0920/s-t-20", "2026-09-28T20:40:57.000Z"), // = 일화 시작 → 뺀다
      row("2026/0919/s-t-19", "2026-09-28T20:40:56.999Z"), // 1ms 앞 → 남는다
      row("2026/0918/s-t-18", "2026-09-28T21:00:00.000Z"), // 뒤 → 뺀다
      row("2026/0917/s-t-17", "garbage"), // 못 읽음 → 남는다
      row("2026/0916/s-t-16", null), // 없음 → 남는다
    ],
  });
  const plan = asFetch(planRefetch(input(), read));
  assert.deepEqual(plan.dates, ["2026-09-19", "2026-09-17", "2026-09-16"]);
  const k = plan.candidates?.find((c) => c.key === K_WP);
  assert.deepEqual(k?.e2, ["2026/0920/s-t-20", "2026/0918/s-t-18"]);
});

test("T3③ E3 — 이 실행의 수동 날짜는 후보에서 빼고 날짜 자리도 그만큼 줄인다", () => {
  const { read } = reader({ [K_WP]: [row("2026/0923/s-t-23"), row("2026/0917/t-c-20"), row("2026/0513/s-t-08")] });
  const plan = asFetch(planRefetch(input({ manual: { ok: true, dates: ["2026-09-17"] } }), read));
  assert.deepEqual(plan.dates, ["2026-09-23", "2026-05-13"]);
  assert.equal(plan.dateSlots, 6);
  assert.deepEqual(plan.candidates?.find((c) => c.key === K_WP)?.e3, ["2026/0917/t-c-20"]);
});

test("T3③ 복원 되돌려짐 — 시도한 날짜가 다시 남은 후보면(세대 복원으로 옛 사본) 표시하고 다시 받는다", () => {
  const h = hist([[K_WP, entry({ attempts: [{ date: "2026-09-17", at: "2026-09-25T00:00:00.000Z", run: "9" }] })]]);
  const { read } = reader({ [K_WP]: [row("2026/0917/t-c-20", OLD), row("2026/0923/s-t-23", OLD)] });
  const plan = asFetch(planRefetch(input({ history: updateHistory(h, det(), START, NOW, RUN) }), read));
  assert.deepEqual(plan.dates, ["2026-09-23", "2026-09-17"]);
  assert.deepEqual(plan.candidates?.find((c) => c.key === K_WP)?.reverted, ["2026-09-17"]);
});

// ── ④ 고르기 ──────────────────────────────────────────────────────────────────

test("T3④ 후보가 적은 키부터 · 한 키 안에서는 최근 날짜부터 · 받는 차례 = 고른 차례", () => {
  const kA = defect({ team: "c", player_id: "1", field: "暴投" });
  const kB = defect({ team: "g", player_id: "2", field: "暴投" });
  const rows = {
    "2026|c|pitching|1|暴投": [row(gid(sep(5), "c")), row(gid(sep(20), "c"))],
    "2026|g|pitching|2|暴投": [row(gid(sep(10), "g"))],
  };
  const plan = asFetch(planRefetch(input({ detect: det({ defects: [kA, kB] }) }), reader(rows).read));
  assert.deepEqual(plan.dates, [sep(10), sep(20), sep(5)]);
  assert.deepEqual(plan.games.map((g) => g.id), [gid(sep(10), "g"), gid(sep(20), "c"), gid(sep(5), "c")]);
  assert.equal(gamesTxt(plan), `${plan.games.map((g) => g.id).join("\n")}\n`);
});

test("T3④ 날짜 자리 = 7 − 수동 날짜 수 — 넘으면 거기서 멈춘다", () => {
  const rows = { [K_WP]: Array.from({ length: 8 }, (_, i) => row(gid(sep(20 - i), "t"))) };
  const plan = asFetch(planRefetch(input({ manual: { ok: true, dates: ["2026-08-01", "2026-08-02"] } }), reader(rows).read));
  assert.equal(plan.dateSlots, 5);
  assert.deepEqual(plan.dates, [sep(20), sep(19), sep(18), sep(17), sep(16)]);
  assert.equal(plan.capped, "date_slots");
  const all = asFetch(planRefetch(input(), reader(rows).read));
  assert.equal(all.dates.length, 7);
});

test("T3④ 경기 상한 24 — 그날 경기는 모든 대상 키의 그 날짜 후보의 합집합이다", () => {
  const teams = ["c", "d", "g", "h", "s", "t"];
  const defects = teams.map((t, i) => defect({ team: t, player_id: String(i + 1), field: "暴投" }));
  const rows: Record<string, CandidateRow[]> = {};
  teams.forEach((t, i) => {
    rows[`2026|${t}|pitching|${String(i + 1)}|暴投`] = [20, 19, 18, 17, 16].map((d) => row(gid(sep(d), t)));
  });
  const plan = asFetch(planRefetch(input({ detect: det({ defects }) }), reader(rows).read));
  assert.deepEqual(plan.dates, [sep(20), sep(19), sep(18), sep(17)]);
  assert.equal(plan.games.length, 24);
  assert.equal(plan.capped, "max_games");
  // 날짜 안에서는 game_id 코드 단위 오름차순
  assert.deepEqual(plan.games.slice(0, 6).map((g) => g.id), teams.map((t) => gid(sep(20), t)));
});

test("T3④ 상한을 넘으면 그 자리에서 전부 멈춘다 — 건너뛰고 들어갈 작은 날짜를 찾지 않는다", () => {
  // A(3일) → 18경기 · F1(5일)의 9/17 → 23경기 · 9/16(5경기)이 넘친다 → 멈춤. F5 혼자 가진 9/01(1경기)은 들어갈 수 있어도 안 고른다
  const A = defect({ team: "c", player_id: "1", field: "暴投" });
  const F = ["d", "g", "h", "s", "t"].map((t, i) => defect({ team: t, player_id: String(i + 2), field: "暴投" }));
  const rows: Record<string, CandidateRow[]> = { "2026|c|pitching|1|暴投": [20, 19, 18].map((d) => row(gid(sep(d), "c"))) };
  F.forEach((f, i) => {
    const days = [20, 19, 18, 17, 16, ...(i === 4 ? [1] : [])];
    rows[defectKey(2026, f.team, "pitching", f.player_id, "暴投")] = days.map((d) => row(gid(sep(d), f.team)));
  });
  const plan = asFetch(planRefetch(input({ detect: det({ defects: [A, ...F] }) }), reader(rows).read));
  assert.deepEqual(plan.dates, [sep(20), sep(19), sep(18), sep(17)]);
  assert.equal(plan.games.length, 23);
  assert.equal(plan.capped, "max_games");
});

// ── ⑤ 관문 1~10 ───────────────────────────────────────────────────────────────

const INCIDENT_ROWS = [row("2026/0923/s-t-23"), row("2026/0917/t-c-20"), row("2026/0513/s-t-08")];

test("T3⑤ 관문 1 detector_error — 0·2 밖 종료 · 결과 없음 · 시간 제한 · 종료와 status 불일치 · 모양 틀림 · 시즌 다름", () => {
  const cases: [ChildExit, string | null][] = [
    [ok(1), detectJson()],
    [ok(0), null],
    [ok(null, { timedOut: true, error: "ETIMEDOUT" }), detectJson()],
    [ok(null, { signal: "SIGKILL" }), detectJson()],
    [ok(2), detectJson()], // 2 인데 status defects
    [ok(0), detectJson({ status: "unmeasured" })], // 0 인데 unmeasured
    [ok(0), "{"],
    [ok(0), JSON.stringify({ schema: 2 })],
    [ok(0), detectJson({ season: 2025 })],
    [ok(0), detectJson({ defects: [{ ...INCIDENT, player_id: "" }] })],
    [ok(0), detectJson({ asOf: { date: null, source: "genzai" } })],
    [ok(0), detectJson({ status: "defects", defects: [] })],
  ];
  for (const [exit, text] of cases) {
    const d = readDetect(exit, text, 2026);
    assert.equal(d.ok, false, `${JSON.stringify(exit)} · ${String(text).slice(0, 40)}`);
    const { read, queries } = reader({ [K_WP]: INCIDENT_ROWS });
    assert.equal(skipReason(planRefetch(input({ detect: d, history: EMPTY_HISTORY }), read)), "detector_error");
    assert.equal(queries.length, 0);
  }
});

test("T3⑤ 관문 1′ history_invalid — 감지기 오류 다음 · unmeasured 앞", () => {
  const bad = "schema 가 1 이 아니다";
  assert.equal(skipReason(planRefetch(input({ historyViolation: bad }), reader({}).read)), "history_invalid");
  assert.equal(
    skipReason(planRefetch(input({ historyViolation: bad, detect: readDetect(ok(1), null, 2026), history: EMPTY_HISTORY }), reader({}).read)),
    "detector_error",
  );
  assert.equal(skipReason(planRefetch(input({ historyViolation: bad, detect: det({ status: "unmeasured" }) }), reader({}).read)), "history_invalid");
});

test("T3⑤ 관문 2~10 — 각 사유와 우선순위 · 1~9 는 DB 를 읽지 않는다", () => {
  const cases: { name: string; o: Partial<PlanInput>; want: string; reads: boolean }[] = [
    { name: "unmeasured", o: { detect: det({ status: "unmeasured", reason: "tables_missing" }) }, want: "unmeasured:tables_missing", reads: false },
    { name: "no_defects", o: { detect: det({ defects: [] }) }, want: "no_defects", reads: false },
    { name: "retry", o: { slot: "retry" }, want: "retry_slot", reads: false },
    { name: "slot 없음", o: { slot: undefined }, want: "slot_unknown", reads: false },
    { name: "slot 빈", o: { slot: "" }, want: "slot_unknown", reads: false },
    { name: "slot 모름", o: { slot: "nightly" }, want: "slot_unknown", reads: false },
    { name: "retry 가 as_of 를 이긴다", o: { slot: "retry", detect: det({ asOf: { date: null, source: "absent" } }) }, want: "retry_slot", reads: false },
    { name: "absent", o: { detect: det({ asOf: { date: null, source: "absent" } }) }, want: "as_of:absent", reads: false },
    { name: "partial", o: { detect: det({ asOf: { date: "2026-09-27", source: "partial" } }) }, want: "as_of:partial", reads: false },
    { name: "override", o: { detect: det({ asOf: { date: "2026-09-27", source: "override" } }) }, want: "as_of:override", reads: false },
    { name: "as_of 가 결함 수를 이긴다", o: { detect: det({ defects: MANY, asOf: { date: null, source: "absent" } }) }, want: "as_of:absent", reads: false },
    { name: "too_many", o: { detect: det({ defects: MANY }) }, want: "too_many_defects", reads: false },
    { name: "no_eligible", o: { detect: det({ defects: [defect({ kind: "batting", field: "打率", ours: ".3", published: ".2" })] }) }, want: "no_eligible", reads: false },
    { name: "no_eligible 이 시간을 이긴다", o: { detect: det({ defects: [defect({ published: "NaN" })] }), collectStartedAt: "abc" }, want: "no_eligible", reads: false },
    { name: "time", o: { collectStartedAt: "2026-09-28T20:26:03Z" }, want: "time_budget", reads: false },
    { name: "unknown start", o: { collectStartedAt: "abc" }, want: "started_at_unknown", reads: false },
    { name: "시간이 자리를 이긴다", o: { collectStartedAt: "abc", manual: { ok: true, dates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"] } }, want: "started_at_unknown", reads: false },
    { name: "no_date_slots", o: { manual: { ok: true, dates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"] } }, want: "no_date_slots", reads: false },
  ];
  for (const c of cases) {
    const { read, queries } = reader({ [K_WP]: INCIDENT_ROWS });
    assert.equal(skipReason(planRefetch(input(c.o), read)), c.want, c.name);
    assert.equal(queries.length > 0, c.reads, `${c.name}: DB 를 읽었는가`);
  }
  // 경계 — 결함 20 · 수동 6일은 통과한다
  assert.equal(planRefetch(input({ detect: det({ defects: MANY.slice(0, 20) }) }), reader({ [K_WP]: INCIDENT_ROWS }).read).kind, "fetch");
  const six = asFetch(planRefetch(input({ manual: { ok: true, dates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"] } }), reader({ [K_WP]: INCIDENT_ROWS }).read));
  assert.equal(six.dateSlots, 1);
  assert.deepEqual(six.dates, ["2026-09-23"]);
  // manual 슬롯은 받는다
  assert.equal(planRefetch(input({ slot: "manual" }), reader({ [K_WP]: INCIDENT_ROWS }).read).kind, "fetch");
});

test("T3⑤ 관문 10 all_exhausted — 대상 키 전부의 남은 날짜가 0 이다(DB 는 읽는다)", () => {
  const { read, queries } = reader({ [K_WP]: [row("2026/0923/s-t-23", "2026-09-28T20:45:00.000Z")] });
  assert.equal(skipReason(planRefetch(input(), read)), "all_exhausted");
  assert.equal(queries.length, 1);
  // 후보 0행도 소진이다(행이 없는 경기는 찾을 수 없다 · §7)
  assert.equal(skipReason(planRefetch(input(), reader({}).read)), "all_exhausted");
});

test("T3⑤ 수동 날짜 입력이 틀리면 날짜 자리를 셀 수 없다 — 계획 실패로 던진다(관문 9 자리)", () => {
  assert.throws(() => planRefetch(input({ manual: { ok: false, error: "YYYY-MM-DD 가 아니다" } }), reader({ [K_WP]: INCIDENT_ROWS }).read), PlanError);
  // 그 앞 관문에 걸리면 던지지 않는다
  assert.equal(skipReason(planRefetch(input({ slot: "retry", manual: { ok: false, error: "x" } }), reader({}).read)), "retry_slot");
});

// ── ⑥ 동률(R2-4) — 입력 순서를 뒤집어도 바이트가 같다 · 24경기와 7일 경계에 동시에 닿는다 ──

/**
 * 키 다섯 — db(8일) · d(8일)가 남은 날짜 수 동률이다. **코드 단위로는 `2026|db|` < `2026|d|`**('b' 0x62 < '|' 0x7C)이고
 * localeCompare(ja-JP 실측)로는 반대다. 채움 키 c·s·g(10일)가 날마다 경기를 보태 D1~D7 이 4·4·4·3·3·3·3 = **24경기 · 7일**에 꼭 찬다.
 */
function tieFixture(): { defects: DetectDefect[]; rows: Record<string, CandidateRow[]> } {
  const D = [20, 19, 18, 17, 16, 15, 14, 13].map(sep);
  const extra = (n: number): string[] => Array.from({ length: n }, (_, i) => `2026-08-0${String(i + 1)}`);
  const spec: [team: string, id: string, dates: string[]][] = [
    ["db", "70000001", D],
    ["d", "70000002", [D[0]!, ...[12, 11, 10, 9, 8, 7, 6].map(sep)]],
    ["c", "70000003", [D[0]!, D[1]!, D[2]!, D[3]!, D[4]!, D[5]!, D[7]!, ...extra(3)]],
    ["s", "70000004", [D[0]!, D[1]!, D[2]!, D[3]!, D[4]!, D[6]!, D[7]!, ...extra(3)]],
    ["g", "70000005", [D[1]!, D[2]!, D[5]!, D[6]!, D[7]!, ...extra(5)]],
  ];
  const defects = spec.map(([t, id]) => defect({ team: t, player_id: id, field: "暴投" }));
  const rows: Record<string, CandidateRow[]> = {};
  for (const [t, id, dates] of spec) rows[defectKey(2026, t, "pitching", id, "暴投")] = dates.map((d) => row(gid(d, t)));
  return { defects, rows };
}

test("⚠T3⑥ 동률은 코드 단위 비교로 가른다 — 정확한 고른 날짜·경기(24경기 · 7일 경계)", () => {
  const { defects, rows } = tieFixture();
  const plan = asFetch(planRefetch(input({ detect: det({ defects }) }), reader(rows).read));
  assert.deepEqual(plan.dates, [20, 19, 18, 17, 16, 15, 14].map(sep));
  assert.equal(plan.games.length, 24);
  assert.deepEqual(plan.games.slice(0, 4).map((g) => g.id), ["c", "d", "db", "s"].map((t) => gid(sep(20), t)));
  assert.deepEqual(plan.candidates?.map((c) => c.key.split("|")[1]), ["db", "d", "c", "g", "s"]);
});

test("⚠T3⑥ 입력 순서(결함 배열 · 후보 행)를 뒤집은 두 판의 계획 JSON 과 다음 이력이 바이트 단위로 같다", () => {
  const { defects, rows } = tieFixture();
  const fwd = input({ detect: det({ defects }) });
  const rev = input({ detect: det({ defects: [...defects].reverse() }) });
  const p1 = asFetch(planRefetch(fwd, reader(rows).read));
  const p2 = asFetch(planRefetch(rev, reader(rows, true).read));
  assert.equal(JSON.stringify(p2), JSON.stringify(p1));
  assert.equal(serializeHistory(rev.history), serializeHistory(fwd.history));
  // ③ 시도 기록 — 받기 결과의 경기 순서를 뒤집어도 같다
  const f1 = readFetchResult(ok(0), fetchJson(p1.games.map((g) => g.id)), p1.games);
  assert.equal(f1.kind, "result");
  if (f1.kind !== "result") return;
  const f2: FetchRead = { ...f1, result: { ...f1.result, games: [...f1.result.games].reverse() } };
  const h1 = attachAttempts(fwd.history, p1, f1, NOW, RUN);
  const h2 = attachAttempts(rev.history, p2, f2, NOW, RUN);
  assert.equal(serializeHistory(h2), serializeHistory(h1));
});

// ── ⑦ 상태 전이(R2-5) — ③ 시도 기록 → ④ 사후 갱신 → ⑤ 소진 ─────────────────────

const K_A = K_WP;
const K_B = "2026|g|batting|30000001|安打";
const K_C = "2026|c|batting|30000002|本塁打";
const DA = INCIDENT;
const DB_ = defect({ team: "g", kind: "batting", player_id: "30000001", name: "乙", field: "安打", ours: "100", published: "99" });
const DC = defect({ team: "c", kind: "batting", player_id: "30000002", name: "丙", field: "本塁打", ours: "10", published: "9" });
const DC_FLIP = { ...DC, ours: "8" };
/** 이 실행이 받은 사본의 취득 시각(잡 시작 뒤) */
const FRESH = "2026-09-28T20:45:00.000Z";
const A1 = "2026/0923/s-t-23";
const A2 = "2026/0917/t-c-20";
const B1 = "2026/0922/g-s-22";
const C1 = "2026/0921/c-d-21";
const C0 = "2026/0830/c-d-18";

function settleCase(o: { outcome?: (id: string, i: number) => FakeGameOutcome; post: DetectRead | null }) {
  const pre = det({ defects: [DA, DB_, DC] });
  const h1 = updateHistory(EMPTY_HISTORY, pre, START, NOW, RUN);
  const preRows = { [K_A]: [row(A1), row(A2)], [K_B]: [row(B1)], [K_C]: [row(C1)] };
  const plan = asFetch(planRefetch(input({ detect: pre, history: h1 }), reader(preRows).read));
  assert.deepEqual(plan.dates, ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-17"]);
  const json = fetchJson(plan.games.map((g) => g.id), o.outcome);
  const exit = (JSON.parse(json) as { exit: number }).exit;
  const f = readFetchResult(ok(exit), json, plan.games);
  assert.equal(f.kind, "result");
  const recorded = new Set(f.kind === "result" ? f.result.games.filter((g) => g.status === "recorded").map((g) => g.id) : []);
  const fetched = (id: string): string => (recorded.has(id) ? FRESH : OLD);
  // 다시 적재 뒤의 DB — 받은 경기의 취득 시각이 올랐다
  const postRows = {
    [`${K_A}#ours_more`]: [row(A1, fetched(A1)), row(A2, fetched(A2))],
    [`${K_B}#ours_more`]: [row(B1, fetched(B1))],
    [`${K_C}#ours_more`]: [row(C1, fetched(C1))],
    [`${K_C}#ours_less`]: [row(C1, fetched(C1)), row(C0, OLD)],
  };
  return settleHistory(
    { history: h1, plan, fetch: f, post: o.post, manualDates: [], collectStartedAt: START, now: NOW, run: RUN },
    reader(postRows).read,
  );
}

const attempt = (date: string) => ({ date, at: NOW, run: RUN });
const expectHistory = (keys: Record<string, unknown>): string => `${JSON.stringify({ schema: 1, keys }, null, 2)}\n`;
const fresh = (o: Record<string, unknown> = {}) => ({
  direction: "ours_more",
  first_seen_at: START,
  first_seen_run: RUN,
  last_seen_at: NOW,
  attempts: [] as unknown[],
  ...o,
});

test("⚠T3⑦ 사후 no_defects — 전부 풀렸다 · 시도 기록도 키째 지운다", () => {
  const s = settleCase({ post: det({ defects: [] }) });
  assert.equal(serializeHistory(s.history), expectHistory({}));
  assert.deepEqual([s.attempted, s.updated, s.judged], [true, true, true]);
});

test("⚠T3⑦ 일부 해결 — 풀린 키는 지우고 · 남은 키는 시도를 지닌 채 소진 판정 · 방향이 바뀐 키는 시도 없는 새 일화", () => {
  const s = settleCase({ post: det({ defects: [DB_, DC_FLIP] }) });
  assert.equal(
    serializeHistory(s.history),
    expectHistory({
      [K_C]: fresh({ direction: "ours_less" }),
      [K_B]: fresh({ attempts: [attempt("2026-09-22")], exhausted_at: NOW }),
    }),
  );
  assert.deepEqual(s.newlyExhausted, [K_B]);
});

test("⚠T3⑦ 사후 unmeasured — ④·⑤ 를 하지 않는다(③ 까지의 이력을 쓴다)", () => {
  const s = settleCase({ post: det({ status: "unmeasured" }) });
  assert.equal(
    serializeHistory(s.history),
    expectHistory({
      [K_C]: fresh({ attempts: [attempt("2026-09-21")] }),
      [K_B]: fresh({ attempts: [attempt("2026-09-22")] }),
      [K_A]: fresh({ attempts: [attempt("2026-09-23"), attempt("2026-09-17")] }),
    }),
  );
  assert.deepEqual([s.attempted, s.updated, s.judged], [true, false, false]);
});

test("⚠T3⑦ 일부 경기만 recorded — 시도는 recorded 날짜만 · 못 받은 날짜가 남은 키는 소진이 아니다", () => {
  const s = settleCase({ outcome: (id) => (id === A2 ? { status: "prepare_failed" } : {}), post: det({ defects: [DA, DB_, DC] }) });
  assert.equal(
    serializeHistory(s.history),
    expectHistory({
      [K_C]: fresh({ attempts: [attempt("2026-09-21")], exhausted_at: NOW }),
      [K_B]: fresh({ attempts: [attempt("2026-09-22")], exhausted_at: NOW }),
      [K_A]: fresh({ attempts: [attempt("2026-09-23")] }),
    }),
  );
  assert.deepEqual(s.remaining.get(K_A)?.remainingDates, ["2026-09-17"]);
});

test("T3⑦ 다시 적재 실패(사후 null)면 ③ 만 · 자동이 허용되지 않은 실행(관문 1~9)은 ⑤ 를 하지 않는다", () => {
  const s = settleCase({ post: null });
  assert.deepEqual([s.attempted, s.updated, s.judged], [true, false, false]);
  const pre = det();
  const h1 = updateHistory(EMPTY_HISTORY, pre, START, NOW, RUN);
  const { read, queries } = reader({ [K_WP]: INCIDENT_ROWS });
  const plan = planRefetch(input({ detect: pre, history: h1, slot: "retry" }), read);
  const t = settleHistory({ history: h1, plan, fetch: null, post: pre, manualDates: [], collectStartedAt: START, now: NOW, run: RUN }, read);
  assert.deepEqual([t.attempted, t.updated, t.judged], [false, true, false]);
  assert.equal(queries.length, 0);
});

test("T3⑦ 소진은 처음 한 번만 찍는다 — 이미 찍힌 키는 시각을 바꾸지 않는다", () => {
  const h = hist([[K_WP, entry({ exhausted_at: "2026-09-25T00:00:00.000Z" })]]);
  const j = judgeExhausted(h, new Map([[K_WP, { candidateDates: ["2026-09-17"], remainingDates: [] }]]), NOW);
  assert.equal(j.history.keys.get(K_WP)?.exhausted_at, "2026-09-25T00:00:00.000Z");
  assert.deepEqual(j.newly, []);
  const k = judgeExhausted(hist([[K_WP, entry()]]), new Map([[K_WP, { candidateDates: ["2026-09-17"], remainingDates: [] }]]), NOW);
  assert.equal(k.history.keys.get(K_WP)?.exhausted_at, NOW);
  assert.deepEqual(k.newly, [K_WP]);
});

// ── ⑧ 마감 경계(R2-6) ─────────────────────────────────────────────────────────

test("⚠T3⑧ 시간 예산 — elapsedMs >= 25 × 60_000 한 식 · 모름은 NaN·음수·6시간 초과·시간대 없음", () => {
  const at = (ms: number): string => new Date(Date.parse(START) + ms).toISOString();
  assert.deepEqual(timeBudget(START, at(1_499_999)), { kind: "ok", elapsedMs: 1_499_999, deadline: "2026-09-28T21:05:57.000Z" });
  assert.equal(timeBudget(START, at(1_500_000)).kind, "time_budget");
  assert.equal(timeBudget(START, at(1_500_001)).kind, "time_budget");
  assert.equal(timeBudget(START, at(-1)).kind, "started_at_unknown");
  assert.equal(timeBudget(START, at(21_600_001)).kind, "started_at_unknown");
  assert.equal(timeBudget(START, at(21_600_000)).kind, "time_budget");
  for (const s of ["abc", undefined, "", "2026-09-28T20:40:57", "2026-02-30T00:00:00Z"]) {
    assert.equal(timeBudget(s, NOW).kind, "started_at_unknown", String(s));
  }
  // 계획의 마감도 같은 식 · 정확히 1,500,000ms 면 받지 않는다
  assert.equal(skipReason(planRefetch(input({ now: at(1_500_000) }), reader({ [K_WP]: INCIDENT_ROWS }).read)), "time_budget");
  assert.equal(asFetch(planRefetch(input({ now: at(1_499_999) }), reader({ [K_WP]: INCIDENT_ROWS }).read)).deadline, "2026-09-28T21:05:57.000Z");
});

/**
 * ⚠**시간대 없는 시각을 UTC 기계(CI)에서 다시 잰다.** 이 기계가 JST 면 시간대 없는 값은 현지 시간으로 읽혀 9시간 어긋나고
 *   **왕복 검사(두 번째 걸쇠)가 대신 막는다** — 그래서 정규식에서 `Z` 를 빼는 변이가 여기서는 초록이었다(변이 실측).
 *   CI 는 UTC 라 그 걸쇠가 없고 정규식이 유일하다. `TZ=UTC` 자식이 그 조건을 이 기계에서도 만든다(외부 요청 0).
 */
test("⚠T3⑧ 시간대 없는 잡 시작 · 이력 시각은 UTC 기계에서도 모름·위반이다 — 왕복 검사에 기대지 않는다(TZ=UTC 자식)", () => {
  const url = pathToFileURL(fileURLToPath(new URL("../correction-plan.ts", import.meta.url))).href;
  const code = [
    `const m = await import(${JSON.stringify(url)});`,
    `const t = m.timeBudget("2026-09-28T20:40:57", "2026-09-28T20:51:03.000Z").kind;`,
    `const doc = { schema: 1, keys: { ${JSON.stringify(K_WP)}: { direction: "ours_more", first_seen_at: "2026-09-28T20:40:57", first_seen_run: "1", last_seen_at: "2026-09-28T20:51:03.000Z", attempts: [] } } };`,
    `const h = m.parseHistory(new TextEncoder().encode(JSON.stringify(doc))).ok;`,
    `console.log(JSON.stringify({ t, h, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));`,
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ: "UTC" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout) as unknown, { t: "started_at_unknown", h: false, tz: "UTC" });
});

// ── ⑨ stepExitCode ────────────────────────────────────────────────────────────

test("⚠T3⑨ stepExitCode — 1 은 받기·기록·사본 실패 · 결과 없음 · 자식 시간 제한 · 다시 적재 실패 · 계획·DB 실패 · 연락처 없음", () => {
  const ids = ["2026/0923/s-t-23", "2026/0917/t-c-20"];
  const planned = ids.map((id) => ({ id, date: dateOfId(id) }));
  const fr = (outcome: (id: string, i: number) => FakeGameOutcome, code?: number): FetchRead => {
    const json = fetchJson(ids, outcome);
    return readFetchResult(ok(code ?? (JSON.parse(json) as { exit: number }).exit), json, planned);
  };
  const base: StepOutcome = { planError: null, noContact: false, fetch: null, reload: null, postError: null, writeError: null, unexpected: null };
  const cases: [string, StepOutcome, 0 | 1][] = [
    ["할 일 없음", base, 0],
    ["전부 recorded", { ...base, fetch: fr(() => ({})), reload: ok(0) }, 0],
    ["마감·예산·고통 신호로 일부만", { ...base, fetch: fr((_, i) => (i === 1 ? { status: "skipped", reason: "deadline" } : {})), reload: ok(0) }, 0],
    ["받기 실패", { ...base, fetch: fr((_, i) => (i === 0 ? { status: "prepare_failed" } : { status: "skipped", reason: "circuit_open" })) }, 1],
    ["기록 실패(되돌림 ok)", { ...base, fetch: fr((_, i) => (i === 0 ? { status: "commit_failed", rollback: "ok" } : { status: "skipped", reason: "circuit_open" })) }, 1],
    ["사본 실패", { ...base, fetch: fr((_, i) => (i === 0 ? { status: "skipped", reason: "snapshot_failed" } : { status: "skipped", reason: "circuit_open" })) }, 1],
    ["결과 JSON 없음", { ...base, fetch: readFetchResult(ok(1), null, planned) }, 1],
    ["자식 시간 제한", { ...base, fetch: readFetchResult(ok(null, { timedOut: true, signal: "SIGTERM" }), null, planned) }, 1],
    ["다시 적재 실패", { ...base, fetch: fr(() => ({})), reload: ok(1) }, 1],
    ["다시 적재 시간 제한", { ...base, fetch: fr(() => ({})), reload: ok(null, { timedOut: true }) }, 1],
    ["계획·DB 실패", { ...base, planError: "DB 를 못 열었다" }, 1],
    ["연락처 없음", { ...base, noContact: true }, 1],
    ["사후 DB 실패", { ...base, postError: "DB 를 못 열었다" }, 1],
    ["보고 쓰기 실패", { ...base, writeError: "ENOSPC" }, 1],
    ["예상 밖 오류", { ...base, unexpected: "TypeError" }, 1],
  ];
  for (const [name, o, want] of cases) assert.equal(stepExitCode(o), want, name);
});

test("T3⑨ 받기 결과 읽기 — 계획과 다른 경기 · 종료와 exit 불일치 · 종료 2 는 결과 없음으로 센다", () => {
  const planned = [{ id: A1, date: "2026-09-23" }];
  assert.equal(readFetchResult(ok(0), fetchJson([A2]), planned).kind, "no_result");
  assert.equal(readFetchResult(ok(1), fetchJson([A1]), planned).kind, "no_result");
  assert.equal(readFetchResult(ok(2), null, planned).kind, "no_result");
  assert.equal(readFetchResult(ok(0), "{", planned).kind, "no_result");
  assert.equal(readFetchResult(ok(0), fetchJson([A1]), planned).kind, "result");
});

// ── ⑩ 이력 검증(R3-4) ─────────────────────────────────────────────────────────

const VALID = expectHistory({
  [K_WP]: {
    direction: "ours_more",
    first_seen_at: START,
    first_seen_run: RUN,
    last_seen_at: NOW,
    attempts: [attempt("2026-09-23"), attempt("2026-09-17")],
    exhausted_at: NOW,
  },
});

test("⚠T3⑩ parseHistory — 「없음」만 빈 이력 · 정상 판은 바이트 그대로 되돌아온다", () => {
  const none = parseHistory(null);
  assert.ok(none.ok);
  if (none.ok) assert.equal(serializeHistory(none.history), expectHistory({}));
  const good = parseHistory(new TextEncoder().encode(VALID));
  assert.ok(good.ok, good.ok ? "" : good.violation);
  if (good.ok) assert.equal(serializeHistory(good.history), VALID);
});

test("⚠T3⑩ parseHistory — 손상의 닫힌 목록은 전부 위반이다(빈 이력으로 받지 않는다)", () => {
  const e = (o: Record<string, unknown>) => ({ direction: "ours_more", first_seen_at: START, first_seen_run: RUN, last_seen_at: NOW, attempts: [], ...o });
  const doc = (keys: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ schema: 1, keys, ...extra });
  const bad: [string, string][] = [
    ["잘린 JSON", VALID.slice(0, 40)],
    ["빈 파일", ""],
    ["최상위 배열", "[]"],
    ["최상위 null", "null"],
    ["schema 2", JSON.stringify({ schema: 2, keys: {} })],
    ["schema 없음", JSON.stringify({ keys: {} })],
    ["keys 배열", JSON.stringify({ schema: 1, keys: [] })],
    ["keys 없음", JSON.stringify({ schema: 1 })],
    ["모르는 최상위 칸", doc({}, { extra: 1 })],
    ["모르는 항목", doc({ "2026|t|pitching|91095136|盗塁刺": e({}) })],
    ["대상 아닌 항목(비율)", doc({ "2026|t|batting|91095136|打率": e({}) })],
    ["역할-항목 짝이 표에 없음", doc({ "2026|t|batting|91095136|暴投": e({}) })],
    ["모르는 역할", doc({ "2026|t|fielding|91095136|暴投": e({}) })],
    ["키 모양", doc({ "26|t|pitching|91095136|暴投": e({}) })],
    ["direction x", doc({ [K_WP]: e({ direction: "x" }) })],
    ["first_seen_at abc", doc({ [K_WP]: e({ first_seen_at: "abc" }) })],
    ["last_seen_at 시간대 없음", doc({ [K_WP]: e({ last_seen_at: "2026-09-28T20:51:03" }) })],
    ["first_seen_run 수", doc({ [K_WP]: e({ first_seen_run: 1 }) })],
    ["attempts 객체", doc({ [K_WP]: e({ attempts: {} }) })],
    ["attempts[].date 9/17", doc({ [K_WP]: e({ attempts: [{ date: "9/17", at: NOW, run: RUN }] }) })],
    ["attempts[].date 없는 날", doc({ [K_WP]: e({ attempts: [{ date: "2026-02-30", at: NOW, run: RUN }] }) })],
    ["attempts[].at abc", doc({ [K_WP]: e({ attempts: [{ date: "2026-09-17", at: "abc", run: RUN }] }) })],
    ["attempts[].run 수", doc({ [K_WP]: e({ attempts: [{ date: "2026-09-17", at: NOW, run: 1 }] }) })],
    ["attempts 중복", doc({ [K_WP]: e({ attempts: [attempt("2026-09-17"), attempt("2026-09-17")] }) })],
    ["attempt 모르는 칸", doc({ [K_WP]: e({ attempts: [{ ...attempt("2026-09-17"), extra: 1 }] }) })],
    ["exhausted_at abc", doc({ [K_WP]: e({ exhausted_at: "abc" }) })],
    ["exhausted_at null", doc({ [K_WP]: e({ exhausted_at: null }) })],
    ["항목 모르는 칸", doc({ [K_WP]: e({ note: "x" }) })],
    ["필수 칸 없음", doc({ [K_WP]: { direction: "ours_more" } })],
    ["__proto__ 키", '{"schema":1,"keys":{"__proto__":{}}}'],
    ["1 MiB 초과", `${JSON.stringify({ schema: 1, keys: {} })}${" ".repeat(1_048_577)}`],
  ];
  for (const [name, text] of bad) {
    const r = parseHistory(new TextEncoder().encode(text));
    assert.equal(r.ok, false, `${name} 를 손상으로 보지 않았다`);
    if (!r.ok) assert.ok(r.violation.length > 0, `${name}: 위반 문장이 없다`);
  }
});

test("⚠T3⑩ 손상된 이력 — 사유 history_invalid · 받기 0 · history.next.json 을 쓰지 않음(원격 보존) · 종료 0 · 경고", () => {
  const world = makeWorld({ remote: new TextEncoder().encode(JSON.stringify({ schema: 2 })) });
  world.keyGames.set(K_WP, INCIDENT_ROWS.map((r) => r.game_id));
  const r = runMain(world);
  assert.equal(r.exit, 0);
  assert.ok(!r.spawned.includes("fetch"), "손상된 이력으로 받기 도구를 띄웠다");
  assert.ok(!r.spawned.includes("reload"));
  assert.equal(r.file("history.next.json"), null, "손상된 원격 이력을 덮어쓸 판을 남겼다");
  assert.match(r.file("report.txt") ?? "", /^정정 자동 재수집 — 해 보지 않았다: history_invalid — `ops\/correction-refetch\.json` 이 손상됐다\(.+\) · 런북 §7-I/);
  assert.ok(r.out.some((l) => l.startsWith("::warning::") && l.includes("history_invalid")), "경고를 찍지 않았다");
});

// ── ⑪ 다시 적재 조건(R3-2) ────────────────────────────────────────────────────

test("⚠T3⑪ 다시 적재는 recorded ≥ 1 또는 되돌림 실패 ≥ 1 일 때만", () => {
  const ids = ["2026/0923/s-t-23", "2026/0917/t-c-20"];
  const planned = ids.map((id) => ({ id, date: dateOfId(id) }));
  const fr = (outcome: (id: string, i: number) => FakeGameOutcome): FetchRead => {
    const json = fetchJson(ids, outcome);
    return readFetchResult(ok((JSON.parse(json) as { exit: number }).exit), json, planned);
  };
  const circuit: FakeGameOutcome = { status: "skipped", reason: "circuit_open" };
  assert.equal(shouldReload(fr((_, i) => (i === 0 ? { status: "commit_failed", rollback: "failed" } : circuit))), true, "recorded 0 · 되돌림 실패 1");
  assert.equal(shouldReload(fr((_, i) => (i === 0 ? { status: "commit_failed", rollback: "ok" } : circuit))), false, "recorded 0 · 되돌림 ok 1");
  assert.equal(shouldReload(fr((_, i) => (i === 0 ? {} : circuit))), true, "recorded 1");
  assert.equal(shouldReload(fr((_, i) => (i === 0 ? { status: "prepare_failed" } : circuit))), false, "받기 실패만");
  assert.equal(shouldReload(fr(() => ({ status: "skipped", reason: "deadline" }))), false, "시작 안 함만");
  assert.equal(shouldReload(readFetchResult(ok(1), null, planned)), false, "결과 없음 — recorded 를 모른다");
  assert.equal(shouldReload(null), false, "받지 않았다");
});

// ── T4 이번 사고 재현 ────────────────────────────────────────────────────────

test("⚠T4 이번 사고 — 髙橋遥 暴投 우리 3 공표 2 · 후보 3일 → 2026-09-23, 2026-09-17, 2026-05-13 · 3경기 · 논리 페이지 12", () => {
  // 실제 ID · 날짜 · 취득 시각(설계 M-F · §1) — 행은 취득 시각 오름차순으로 준다(그대로 받으면 붉다)
  const rows = [
    row("2026/0513/s-t-08", "2026-08-14T03:00:00.000Z"),
    row("2026/0917/t-c-20", "2026-09-18T09:24:00.000Z"),
    row("2026/0923/s-t-23", "2026-09-24T21:00:00.000Z"),
  ];
  const plan = asFetch(planRefetch(input(), reader({ [K_WP]: rows }).read));
  assert.deepEqual(plan.dates, ["2026-09-23", "2026-09-17", "2026-05-13"]);
  assert.deepEqual(plan.games.map((g) => g.id), ["2026/0923/s-t-23", "2026/0917/t-c-20", "2026/0513/s-t-08"]);
  assert.equal(plan.games.length * PAGES_PER_GAME, 12);
  assert.equal(gamesTxt(plan), "2026/0923/s-t-23\n2026/0917/t-c-20\n2026/0513/s-t-08\n");
  assert.equal(plan.deadline, "2026-09-28T21:05:57.000Z");
});

// ── T5 남는 결함 · 6슬롯 ─────────────────────────────────────────────────────

/**
 * 결함이 끝까지 남는 키 하나(후보 n일 · 날짜마다 한 경기)를 하루 6슬롯(정시·재시도 번갈아)으로 돌린다.
 * 실행마다 워크플로의 이력 반영(base 대조 커밋)을 흉내 낸다.
 * @returns 처음 소진이 찍힌 정시 실행의 차례(1부터) · 날짜별 받은 횟수 · 재시도 슬롯이 띄운 받기
 */
function simulate(days: number): { exhaustedAt: number | null; dateCounts: Map<string, number>; retryFetches: number; scheduled: number } {
  const ids = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.parse("2026-09-27T00:00:00Z") - i * 86_400_000).toISOString().slice(0, 10);
    return gid(d, "t");
  });
  const world = makeWorld({ keyGames: new Map([[K_WP, ids]]) });
  let scheduled = 0;
  let exhaustedAt: number | null = null;
  let retryFetches = 0;
  for (let i = 0; i < 12; i += 1) {
    const slot = i % 2 === 0 ? "scheduled" : "retry";
    if (slot === "scheduled") scheduled += 1;
    const startMs = Date.parse("2026-09-28T00:00:00Z") + i * 4 * 3_600_000;
    const start = new Date(startMs).toISOString().replace(".000Z", "Z");
    const now = new Date(startMs + 606_000).toISOString();
    const r = runMain(world, { now, env: { BB_RUN_SLOT: slot, BB_COLLECT_STARTED_AT: start }, work: `${world.dir}/work-${String(i)}` });
    assert.equal(r.exit, 0, `${String(i)}번째 실행이 종료 ${String(r.exit)}`);
    if (slot === "retry") retryFetches += r.spawned.filter((s) => s === "fetch").length;
    commitHistory(world, r.work);
    const committed = world.remote === null ? null : parseHistory(world.remote);
    if (exhaustedAt === null && committed?.ok === true && committed.history.keys.get(K_WP)?.exhausted_at != null && slot === "scheduled") {
      exhaustedAt = scheduled;
    }
  }
  return { exhaustedAt, dateCounts: world.dateFetchCount, retryFetches, scheduled };
}

test("⚠T5 남는 결함 — 날짜별 받은 횟수 ≤ 1 · 재시도 슬롯 요청 0 · 소진 시점(1·7일 첫 정시 · 8일 둘째 · 30일 다섯째)", () => {
  for (const [days, want] of [[1, 1], [7, 1], [8, 2], [30, 5]] as const) {
    const s = simulate(days);
    for (const [d, n] of s.dateCounts) assert.ok(n <= 1, `${String(days)}일: ${d} 를 ${String(n)}번 받았다`);
    assert.equal(s.dateCounts.size, days, `${String(days)}일: 받은 날짜 수`);
    assert.equal(s.retryFetches, 0, `${String(days)}일: 재시도 슬롯이 받았다`);
    assert.equal(s.exhaustedAt, want, `${String(days)}일: 소진이 ${String(s.exhaustedAt)}번째 정시 실행에 찍혔다`);
  }
});
