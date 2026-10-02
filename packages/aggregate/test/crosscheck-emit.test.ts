/**
 * **외부 대조의 감지 모드(`--emit <path>`) — 상태 계약**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D2·D3 · 시험 T1).
 *
 * 관문(`--emit` 없이)의 종료 1 은 「결함 발견 · 기준일 불일치 · 비교 0명」을 **한 코드로 겸한다**(1차 콜드 리뷰 P1-1).
 * 그래서 자동 재수집이 그 코드를 읽으면 「받을 경기가 있다」와 「잴 수 없었다」를 못 가른다.
 * 감지 모드는 그 셋을 **JSON 의 `status` 3값**으로 가르고, 종료코드도 따로 낸다:
 *
 * | | 관문(그대로 · `crosscheck-gate-unchanged.test.ts`) | 감지 모드(여기) |
 * |---|---|---|
 * | 측정 성공 · 결함 0 | 종료 0 | 종료 0 · `no_defects` |
 * | 측정 성공 · 결함 N | 종료 1 | 종료 0 · `defects` |
 * | 측정 실패(닫힌 목록 넷) | 종료 1 또는 잡히지 않은 예외 | 종료 2 · `unmeasured` |
 * | 예상 밖 예외 | 0 이 아닌 종료 | 0·2 가 아닌 종료 · JSON 을 약속하지 않는다 |
 *
 * ⚠**감지 모드는 관문보다 엄격하다** — 공표표가 한 장이라도 빠지면 관문은 경고만 하고 통과하지만(설계 §7 R3-1 · 기존 한계)
 * 감지 모드는 `tables_missing` 으로 「잴 수 없었다」고 말한다. 빠진 장의 선수는 대조되지 않았기 때문이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CROSSCHECK_UNMEASURED_REASONS,
  crosscheckEmitExitCode,
  crosscheckEmitStatus,
  crosscheckUnmeasuredReasons,
} from "../src/crosscheck-classify.ts";
import type { CrosscheckEmitInput } from "../src/crosscheck-classify.ts";
import { AS_OF, buildScenario, runTool } from "./crosscheck-scenario.ts";
import type { Scenario, ScenarioOptions } from "./crosscheck-scenario.ts";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// ── ⑴ 판정 함수 — 표 6경우와 사유 우선순위 ─────────────────────────────────────

const OK: CrosscheckEmitInput = {
  asOfDates: [AS_OF],
  tablesRead: 24,
  tablesExpected: 24,
  parseError: false,
  comparedPlayers: 8,
  defects: 0,
};

test("T1 ⑴ crosscheckEmitStatus — 표 6경우", () => {
  assert.deepEqual(crosscheckEmitStatus(OK), { status: "no_defects", reason: null });
  assert.deepEqual(crosscheckEmitStatus({ ...OK, defects: 7 }), { status: "defects", reason: null });
  assert.deepEqual(crosscheckEmitStatus({ ...OK, asOfDates: ["2026-09-27", AS_OF] }), { status: "unmeasured", reason: "asof_split" });
  assert.deepEqual(crosscheckEmitStatus({ ...OK, parseError: true }), { status: "unmeasured", reason: "table_parse_error" });
  assert.deepEqual(crosscheckEmitStatus({ ...OK, tablesRead: 23 }), { status: "unmeasured", reason: "tables_missing" });
  assert.deepEqual(crosscheckEmitStatus({ ...OK, comparedPlayers: 0 }), { status: "unmeasured", reason: "compared_zero" });
});

test("T1 ⑴ 사유가 둘 이상이면 닫힌 목록의 차례대로 첫 것 하나 — asof_split > table_parse_error > tables_missing > compared_zero", () => {
  assert.deepEqual(CROSSCHECK_UNMEASURED_REASONS, ["asof_split", "table_parse_error", "tables_missing", "compared_zero"]);
  const all: CrosscheckEmitInput = {
    asOfDates: ["2026-09-27", AS_OF],
    tablesRead: 20,
    tablesExpected: 24,
    parseError: true,
    comparedPlayers: 0,
    defects: 3,
  };
  assert.deepEqual(crosscheckUnmeasuredReasons(all), ["asof_split", "table_parse_error", "tables_missing", "compared_zero"]);
  assert.equal(crosscheckEmitStatus(all).reason, "asof_split");
  assert.equal(crosscheckEmitStatus({ ...all, asOfDates: [AS_OF] }).reason, "table_parse_error");
  assert.equal(crosscheckEmitStatus({ ...all, asOfDates: [AS_OF], parseError: false }).reason, "tables_missing");
  assert.equal(crosscheckEmitStatus({ ...all, asOfDates: [AS_OF], parseError: false, tablesRead: 24 }).reason, "compared_zero");
  // ⚠「잴 수 없었다」가 「결함이 있다」를 이긴다 — 결함 3 이어도 unmeasured
  assert.equal(crosscheckEmitStatus({ ...OK, tablesRead: 23, defects: 3 }).status, "unmeasured");
});

test("T1 ⑴ 공표표가 0장이면 tables_missing — 대조 0명보다 앞선다(설계 D2 의 예)", () => {
  assert.deepEqual(crosscheckEmitStatus({ ...OK, asOfDates: [], tablesRead: 0, comparedPlayers: 0 }), {
    status: "unmeasured",
    reason: "tables_missing",
  });
});

test("T1 ⑴ 같은 날짜가 여러 번 들어와도 갈린 것이 아니다", () => {
  assert.equal(crosscheckEmitStatus({ ...OK, asOfDates: [AS_OF, AS_OF] }).status, "no_defects");
  assert.equal(crosscheckEmitStatus({ ...OK, asOfDates: [] }).status, "no_defects", "「現在」가 없는 것은 갈림이 아니다(as_of.source 가 말한다)");
});

test("T1 ⑴ 종료코드 — 측정 성공은 결함 수와 무관하게 0 · 측정 실패는 2", () => {
  assert.equal(crosscheckEmitExitCode("no_defects"), 0);
  assert.equal(crosscheckEmitExitCode("defects"), 0);
  assert.equal(crosscheckEmitExitCode("unmeasured"), 2);
});

test("T1 ⑴ 셈이 아닌 입력은 받지 않는다 — 틀린 판정을 조용히 내지 않는다(M7)", () => {
  for (const bad of [
    { ...OK, tablesRead: -1 },
    { ...OK, tablesRead: Number.NaN },
    { ...OK, tablesRead: 25 },
    { ...OK, tablesExpected: 0 },
    { ...OK, comparedPlayers: 1.5 },
    { ...OK, defects: -1 },
  ]) {
    assert.throws(() => crosscheckEmitStatus(bad), RangeError, JSON.stringify(bad));
  }
});

// ── 도구를 실제로 돌린다 ───────────────────────────────────────────────────────

interface Emitted {
  schema: number;
  season: number;
  competition: string;
  status: string;
  reason: string | null;
  reason_detail: string | null;
  as_of: { date: string | null; source: string };
  tables: { expected: number; read: number; with_genzai: number | null };
  compared: { players: number; fields: number };
  unmatched: { ours: number; published: number };
  folded: number;
  defects: { team: string; kind: string; player_id: string; name: string; field: string; ours: string; published: string }[];
}

const SCHEMA_KEYS = [
  "schema",
  "season",
  "competition",
  "status",
  "reason",
  "reason_detail",
  "as_of",
  "tables",
  "compared",
  "unmatched",
  "folded",
  "defects",
];

/** 같은 재료로 관문(`--emit` 없이)과 감지 모드를 둘 다 돌린다 */
function both(opts: ScenarioOptions, extra: readonly string[] = []) {
  const s: Scenario = buildScenario(opts);
  try {
    const gate = runTool(s, extra);
    const out = join(s.dir, "detect.json");
    const emit = runTool(s, [...extra, "--emit", out]);
    const json = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Emitted) : null;
    const left = readdirSync(s.dir).filter((f) => f !== "bb.sqlite" && f !== "archive" && f !== "detect.json");
    return { gate, emit, json, left };
  } finally {
    s.cleanup();
  }
}

function defectKeys(j: Emitted): string[] {
  return j.defects.map((d) => [d.team, d.kind, d.player_id, d.name, d.field, d.ours, d.published].join("|")).sort();
}

test("⚠T1 ⑵ 공표표 0장 — 감지 모드는 종료 2 · tables_missing · 중간 파일 없음 / 관문은 그대로 종료 1", () => {
  const r = both({ noStats: true });
  assert.equal(r.gate.code, 1, "관문 종료코드가 바뀌었다");
  assert.equal(r.emit.code, 2, `감지 모드 종료코드 — stderr: ${r.emit.stderr}`);
  assert.ok(r.json !== null, "결과 JSON 이 없다");
  assert.equal(r.json.status, "unmeasured");
  assert.equal(r.json.reason, "tables_missing");
  assert.deepEqual(r.json.tables, { expected: 24, read: 0, with_genzai: 0 });
  assert.deepEqual(r.json.as_of, { date: null, source: "absent" });
  assert.deepEqual(r.json.compared, { players: 0, fields: 0 });
  assert.match(r.json.reason_detail ?? "", /24장 중 0장/, "reason_detail 이 무엇이 빠졌는지 말하지 않는다");
  assert.match(r.json.reason_detail ?? "", /대조한 선수가 0명/, "나머지 사유(compared_zero)를 reason_detail 에 덧붙이지 않았다");
  assert.deepEqual(r.left, [], `중간 파일이 남았다: ${r.left.join(", ")}`);
  assert.equal(r.emit.stdout, r.gate.stdout, "감지 모드의 사람용 출력이 관문과 다르다");
  assert.equal(r.emit.stderr, r.gate.stderr, "감지 모드의 사람용 출력이 관문과 다르다");
});

test("⚠T1 결함 — 종료 0 · status defects · 결함마다 player_id 와 team · 사람용 출력은 관문과 같다", () => {
  const r = both({});
  assert.equal(r.gate.code, 1);
  assert.equal(r.emit.code, 0, `측정에 성공했으면 결함 수와 무관하게 0 이다 — stderr: ${r.emit.stderr}`);
  assert.equal(r.emit.stdout, r.gate.stdout, "감지 모드의 사람용 출력이 관문과 다르다(설계 D2: 지금과 같은 것을 찍는다)");
  assert.equal(r.emit.stderr, r.gate.stderr);
  assert.ok(r.json !== null);
  assert.deepEqual(Object.keys(r.json), SCHEMA_KEYS, "결과 JSON 의 칸이 스키마 1 과 다르다");
  assert.equal(r.json.schema, 1);
  assert.equal(r.json.season, 2026);
  assert.equal(r.json.competition, "regular");
  assert.equal(r.json.status, "defects");
  assert.equal(r.json.reason, null);
  assert.equal(r.json.reason_detail, null);
  assert.deepEqual(r.json.as_of, { date: AS_OF, source: "genzai" });
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: 24 });
  assert.deepEqual(r.json.compared, { players: 8, fields: 143 });
  assert.deepEqual(r.json.unmatched, { ours: 1, published: 1 });
  assert.equal(r.json.folded, 5);
  // ⚠이번 사고의 결함 — 이름이 아니라 ID 로 나간다(M10). 순서는 계약이 아니다
  assert.deepEqual(defectKeys(r.json), [
    "g|pitching|00000202|戸郷|ボーク|null|0",
    "g|pitching|00000202|戸郷|暴投|null|0",
    "t|batting|00000101|森下|出塁率|.385|.462",
    "t|batting|00000101|森下|安打|4|5",
    "t|batting|00000101|森下|打率|.364|.455",
    "t|batting|00000101|森下|長打率|.727|.818",
    "t|pitching|91095136|髙橋|暴投|3|2",
  ]);
  const takahashi = r.json.defects.find((d) => d.field === "暴投" && d.team === "t");
  assert.deepEqual(Object.keys(takahashi ?? {}), ["team", "kind", "player_id", "name", "field", "ours", "published"]);
  assert.deepEqual(r.left, []);
});

test("T1 결함 0 — 종료 0 · status no_defects · defects 는 빈 배열", () => {
  const r = both({ clean: true });
  assert.equal(r.gate.code, 0);
  assert.equal(r.emit.code, 0);
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.equal(r.emit.stderr, r.gate.stderr);
  assert.ok(r.json !== null);
  assert.equal(r.json.status, "no_defects");
  assert.equal(r.json.reason, null);
  assert.deepEqual(r.json.defects, []);
  assert.equal(r.json.folded, 5);
});

test("⚠T1 기준일이 장마다 다르다 — 종료 2 · asof_split · 대조하지 않는다 · 사람용 출력은 관문과 같다", () => {
  const r = both({ clean: true, asOf: (t) => (t === "idb1_g" ? "2026-09-27" : AS_OF) });
  assert.equal(r.gate.code, 1);
  assert.equal(r.emit.code, 2);
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.equal(r.emit.stderr, r.gate.stderr);
  assert.ok(r.json !== null);
  assert.equal(r.json.status, "unmeasured");
  assert.equal(r.json.reason, "asof_split");
  assert.match(r.json.reason_detail ?? "", /2026-09-27\(1장\) \/ 2026-09-28\(23장\)/);
  assert.deepEqual(r.json.as_of, { date: null, source: "partial" }, "갈린 기준일 중 하나를 골라 적었다");
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: 24 });
  assert.deepEqual(r.json.compared, { players: 0, fields: 0 });
  assert.deepEqual(r.json.defects, []);
  assert.deepEqual(r.left, []);
});

test("⚠T1 공표표 한 장이 없다 — 관문은 통과(기존 한계 · 바꾸지 않는다) · 감지 모드는 종료 2 · tables_missing", () => {
  const r = both({ clean: true, missing: ["idp1_g"] });
  assert.equal(r.gate.code, 0, "관문 판정이 바뀌었다 — 설계 §7 R3-1 은 기존 한계로 둔다");
  assert.equal(r.emit.code, 2, "감지 모드가 빠진 장을 넘겼다 — 그 장의 선수는 대조되지 않았다");
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.equal(r.emit.stderr, r.gate.stderr);
  assert.ok(r.json !== null);
  assert.equal(r.json.reason, "tables_missing");
  assert.match(r.json.reason_detail ?? "", /24장 중 23장/);
  assert.match(r.json.reason_detail ?? "", /idp1_g/, "어느 장이 빠졌는지 말하지 않는다");
  assert.deepEqual(r.json.tables, { expected: 24, read: 23, with_genzai: 23 });
  assert.deepEqual(r.json.as_of, { date: AS_OF, source: "partial" }, "24장 전부가 아니면 genzai 가 아니다(설계 D3)");
});

test("T1 「現在」가 어디에도 없다 — as_of 는 absent · date null · 측정은 성공", () => {
  const r = both({ clean: true, asOf: () => null });
  assert.equal(r.emit.code, 0);
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.ok(r.json !== null);
  assert.deepEqual(r.json.as_of, { date: null, source: "absent" });
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: 0 });
  assert.equal(r.json.status, "defects", "자르지 않으므로 기준일 뒤 경기까지 들어와 결함이 된다(관문과 같다)");
});

test("T1 「現在」가 일부 장에만 있다 — as_of 는 partial · 그 날짜", () => {
  const r = both({ clean: true, asOf: (t) => (t.startsWith("idb1") ? AS_OF : null) });
  assert.equal(r.emit.code, 0);
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.ok(r.json !== null);
  assert.deepEqual(r.json.as_of, { date: AS_OF, source: "partial" });
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: 12 });
  assert.equal(r.json.status, "no_defects");
});

test("T1 `--through` — as_of 는 override · 「現在」는 읽지 않는다(with_genzai null = 안 쟀다)", () => {
  const r = both({ asOf: () => null }, ["--through", AS_OF]);
  assert.equal(r.emit.code, 0);
  assert.equal(r.emit.stdout, r.gate.stdout);
  assert.ok(r.json !== null);
  assert.deepEqual(r.json.as_of, { date: AS_OF, source: "override" });
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: null });
  assert.equal(r.json.status, "defects");
  assert.equal(r.json.defects.length, 7);
});

test("⚠T1 성적표 해석이 던진다 — 감지 모드는 종료 2 · table_parse_error(관문은 지금처럼 예외로 죽는다)", () => {
  for (const [table, message] of [
    ["idb1_c", /타격 성적표의 헤더가 예상과 다르다/],
    ["idp1_g", /투구 성적표에 「暴投」 열이 없다/],
  ] as const) {
    const r = both({ clean: true, broken: [table] });
    assert.equal(r.gate.code, 1);
    assert.equal(r.emit.code, 2, `${table}: ${r.emit.stderr}`);
    assert.ok(r.json !== null);
    assert.equal(r.json.status, "unmeasured");
    assert.equal(r.json.reason, "table_parse_error");
    assert.match(r.json.reason_detail ?? "", new RegExp(table));
    assert.match(r.json.reason_detail ?? "", message);
    assert.match(r.json.reason_detail ?? "", /공표표 해석 실패 1건/);
    assert.match(r.emit.stderr, message, "사람용 출력에 해석 실패가 안 나온다");
    assert.equal(r.json.tables.read, 24, "던진 장도 「읽은 장」이다 — 빠진 장이 아니다");
    assert.deepEqual(r.left, []);
  }
});

test("⚠T1 한 장 안에 「現在」 날짜가 둘이다 — 감지 모드는 table_parse_error · 나머지 장으로 기준일을 정한다", () => {
  const r = both({ asOf: (t) => (t === "idb1_t" ? ["2026-09-28", "2026-09-27"] : AS_OF) });
  assert.equal(r.gate.code, 1);
  assert.equal(r.emit.code, 2);
  assert.ok(r.json !== null);
  assert.equal(r.json.reason, "table_parse_error");
  assert.match(r.json.reason_detail ?? "", /idb1_t/);
  assert.deepEqual(r.json.as_of, { date: AS_OF, source: "partial" });
  assert.deepEqual(r.json.tables, { expected: 24, read: 24, with_genzai: 23 });
});

/** ⚠사유문의 수는 **장이 아니라 건**이다 — 한 장이 「現在」와 본문에서 두 번 던질 수 있고, 둘 다 사람이 봐야 한다 */
test("T1 한 장이 「現在」와 본문에서 두 번 던지면 해석 실패 2건 — 둘 다 reason_detail 에 남는다", () => {
  const r = both({ asOf: (t) => (t === "idb1_t" ? ["2026-09-28", "2026-09-27"] : AS_OF), broken: ["idb1_t"] });
  assert.equal(r.emit.code, 2);
  assert.ok(r.json !== null);
  assert.equal(r.json.reason, "table_parse_error");
  const detail = r.json.reason_detail ?? "";
  assert.match(detail, /공표표 해석 실패 2건/);
  assert.match(detail, /idb1_t: 공표표의 기준일이 서로 다른 것이 둘 이상이다/);
  assert.match(detail, /idb1_t: 타격 성적표의 헤더가 예상과 다르다/);
});

test("T1 결과는 원자적으로 쓴다 — 미리 있던 파일을 통째로 갈아 끼우고 · 임시 파일을 남기지 않는다", () => {
  const s = buildScenario({});
  try {
    const out = join(s.dir, "detect.json");
    writeFileSync(out, "{ 이전 실행의 낡은 결과");
    const r = runTool(s, ["--emit", out]);
    assert.equal(r.code, 0);
    const j = JSON.parse(readFileSync(out, "utf8")) as Emitted;
    assert.equal(j.status, "defects");
    assert.ok(readFileSync(out, "utf8").endsWith("}\n"), "끝 줄바꿈");
    assert.deepEqual(
      readdirSync(s.dir).filter((f) => f.includes(".tmp")),
      [],
      "임시 파일이 남았다",
    );
  } finally {
    s.cleanup();
  }
});

test("T1 예상 밖 오류(결과를 쓸 수 없다) — 0·2 가 아닌 종료 · 결과 JSON 을 약속하지 않는다", () => {
  const s = buildScenario({ clean: true });
  try {
    const out = join(s.dir, "없는-디렉터리", "detect.json");
    const r = runTool(s, ["--emit", out]);
    assert.ok(r.code !== 0 && r.code !== 2, `종료 ${String(r.code)} — 0·2 는 「측정 결과를 썼다」는 약속이다`);
    assert.equal(existsSync(out), false);
  } finally {
    s.cleanup();
  }
});

/**
 * ⚠**두 SQL 이 `player_id` 를 SELECT 한다**(설계 D2 · 2차 콜드 리뷰 P2-7). 공표 쪽과 짝짓는 것은 지금처럼 이름이고(공표표에 ID 가 없다),
 * **그 뒤는 ID 로만 간다**(M10) — 후보 조회가 이름으로 선수를 다시 찾으면 동명이인·등록명 변경에서 엉뚱한 경기를 받는다.
 * 위 「결함」 시험이 결과 JSON 으로 이것을 이미 재지만, SQL 에서 빠지면 **어디서** 빠졌는지를 여기서 바로 말한다.
 */
test("⚠T1 ⑶ 타격·투구 두 SQL 이 player_id 를 SELECT 한다 — 그 뒤는 ID 로만 간다(M10)", () => {
  const tool = stripComments(read("../tools/crosscheck.ts"));
  for (const [name, alias, table] of [
    ["BAT_SQL", "b", "batting_line"],
    ["PIT_SQL", "pl", "pitching_line"],
  ] as const) {
    const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(tool);
    assert.ok(m !== null, `${name} 를 못 찾았다`);
    const select = m[1]!.split(`FROM ${table}`)[0] ?? "";
    assert.match(select, new RegExp(`\\b${alias}\\.player_id AS player_id\\b`), `${name} 의 SELECT 에 ${alias}.player_id 가 없다`);
  }
});
