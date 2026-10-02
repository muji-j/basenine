/**
 * **외부 대조의 비교 항목 — 닫힌 표 · 범위 조각 · 값 해석**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D4·D5 · 시험 T2).
 *
 * 공표 정정 자동 재수집은 외부 대조가 찾은 결함 후보 「(팀, 역할, 선수, 항목)」을 **그 차이를 만들 수 있는 경기**로 바꿔야 한다.
 * 그 다리가 `crosscheck-fields.ts` 다. 여기서 셋을 지킨다.
 *
 * 1. **표가 닫혀 있다** — 도구가 맞대는 항목 35개와 표의 행이 **정확히 같다**. 도구에 항목이 늘었는데 표에 없으면
 *    그 결함은 「어느 경기를 받을지 모르는」 채로 남고, 표에만 있는 행은 아무것도 안 잰다.
 * 2. **경기 값 식이 도구의 합계와 같은 칼럼이다**(M1) — 도구는 `SUM(b.d2)` 로 二塁打 를 셌는데 후보 조회가 `x.d3` 를 보면
 *    **엉뚱한 경기를 다시 받고**(L1) 결함은 영영 안 풀린다. 값도 그럴듯해서 눈으로는 못 잡는다.
 * 3. **범위 조각이 한 벌이다**(M1) — 도구의 두 SQL 과 후보 조회가 같은 `crosscheckScope` 를 쓴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import {
  CROSSCHECK_FIELDS,
  crosscheckScope,
  crosscheckScopeParams,
  parseFieldValue,
} from "../src/crosscheck-fields.ts";
import type { CrosscheckField, CrosscheckTargetField } from "../src/crosscheck-fields.ts";
import { AS_OF, SEASON, buildScenario } from "./crosscheck-scenario.ts";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
/** ⚠주석을 코드로 읽지 않는다 — 「이렇게 하지 마라」고 적은 주석이 증거로 읽히면 시험이 헛돈다 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const TOOL = stripComments(read("../tools/crosscheck.ts"));
const LEAF = read("../src/crosscheck-fields.ts");

type Kind = "batting" | "pitching";
const key = (kind: string, field: string): string => `${kind}|${field}`;

/**
 * 도구 소스에서 **비교 라벨**을 뽑는다 — `c("打席", …)` 와 `cmp(team.code, "batting", …, "打率", …)` 둘 다.
 * `c` 는 타격·투구에서 두 번 정의되므로 **가장 가까운 앞 정의의 역할**을 붙인다.
 */
function toolLabels(): { kind: Kind; field: string; at: number }[] {
  const defs = [...TOOL.matchAll(/const c = \([^)]*\): void =>\s*cmp\(team\.code, "(batting|pitching)"/g)].map((m) => ({
    kind: m[1] as Kind,
    at: m.index,
  }));
  assert.equal(defs.length, 2, `비교 함수 c 의 정의가 ${String(defs.length)}개다 — 도구 모양이 바뀌었다(이 시험이 공회전한다)`);
  const out: { kind: Kind; field: string; at: number }[] = [];
  for (const m of TOOL.matchAll(/\bc\("([^"]+)",/g)) {
    const def = defs.filter((d) => d.at < m.index).at(-1);
    assert.ok(def !== undefined, `c("${m[1]!}") 가 정의보다 앞에 있다`);
    out.push({ kind: def.kind, field: m[1]!, at: m.index });
  }
  for (const m of TOOL.matchAll(/\bcmp\(team\.code, "(batting|pitching)",(?:[^,]+,){2}\s*"([^"]+)",/g)) {
    out.push({ kind: m[1] as Kind, field: m[2]!, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

test("⚠T2 비교 라벨 집합과 닫힌 표가 정확히 같다 — 35개(타격 19 · 투구 16)", () => {
  const labels = toolLabels();
  // ⚠분모 — 추출이 비면 아래 「같다」가 공회전한다
  assert.equal(labels.length, 35, `도구에서 뽑은 비교가 ${String(labels.length)}개다 — 35개여야 한다(설계 D4)`);
  const fromTool = labels.map((l) => key(l.kind, l.field));
  assert.equal(new Set(fromTool).size, fromTool.length, "도구가 같은 (역할, 항목)을 두 번 맞댄다");
  const fromTable = CROSSCHECK_FIELDS.map((f) => key(f.kind, f.field));
  assert.equal(new Set(fromTable).size, fromTable.length, "표에 같은 (역할, 항목)이 두 번 있다");
  assert.deepEqual(
    [...fromTable].sort(),
    [...fromTool].sort(),
    "도구의 비교 항목과 표가 다르다 — 표에 없는 항목의 결함은 어느 경기를 받을지 모르는 채로 남는다",
  );
  assert.equal(labels.filter((l) => l.kind === "batting").length, 19);
  assert.equal(labels.filter((l) => l.kind === "pitching").length, 16);
});

test("T2 행마다 「대상」·「아님」 중 정확히 하나 — 대상 29(타격 15 · 투구 14) · 아님 6", () => {
  assert.equal(CROSSCHECK_FIELDS.length, 35);
  assert.deepEqual(
    CROSSCHECK_FIELDS.map((f) => f.no),
    Array.from({ length: 35 }, (_, i) => i + 1),
    "행 번호가 설계 D4 의 1~35 차례가 아니다",
  );
  for (const f of CROSSCHECK_FIELDS) {
    if (f.refetch) {
      assert.equal(typeof f.gameValue, "function", `${f.field}: 대상인데 경기 값 식이 없다`);
      assert.equal(typeof f.oursMore, "function", `${f.field}: 대상인데 o>p 술어가 없다`);
      assert.equal(typeof f.oursLess, "function", `${f.field}: 대상인데 o<p 술어가 없다`);
      assert.equal("why" in f, false, `${f.field}: 대상인데 「아님」 사유가 붙어 있다`);
    } else {
      assert.ok(typeof f.why === "string" && f.why.length > 0, `${f.field}: 대상 아님인데 사유가 없다`);
      assert.equal("gameValue" in f, false, `${f.field}: 대상 아님인데 경기 값 식이 붙어 있다`);
    }
    assert.equal(f.kind, f.no <= 19 ? "batting" : "pitching", `${String(f.no)}번 행의 역할이 D4 와 다르다`);
  }
  const targets = CROSSCHECK_FIELDS.filter((f) => f.refetch);
  assert.equal(targets.length, 29);
  assert.equal(targets.filter((f) => f.kind === "batting").length, 15);
  assert.equal(targets.filter((f) => f.kind === "pitching").length, 14);
});

test("T2 대상 아님 여섯은 D4 그대로 — 행 수 항목 둘과 비율 넷", () => {
  const others = CROSSCHECK_FIELDS.filter((f) => !f.refetch).map((f) => `${String(f.no)}:${key(f.kind, f.field)}`);
  assert.deepEqual(others, [
    "1:batting|試合",
    "17:batting|打率",
    "18:batting|長打率",
    "19:batting|出塁率",
    "20:pitching|試合",
    "35:pitching|防御率",
  ]);
});

/** 설계 D4 의 「경기 값 식 · o>p 후보 · o<p 후보」 세 칸 그대로(별칭 `x`) */
const D4_TARGETS: readonly (readonly [number, Kind, string, string, string])[] = [
  [2, "batting", "打席", "x.pa", "x.pa > 0"],
  [3, "batting", "打数", "x.ab", "x.ab > 0"],
  [4, "batting", "得点", "x.runs", "x.runs > 0"],
  [5, "batting", "安打", "x.h", "x.h > 0"],
  [6, "batting", "二塁打", "x.d2", "x.d2 > 0"],
  [7, "batting", "三塁打", "x.d3", "x.d3 > 0"],
  [8, "batting", "本塁打", "x.hr", "x.hr > 0"],
  [9, "batting", "打点", "x.rbi", "x.rbi > 0"],
  [10, "batting", "盗塁", "x.sb", "x.sb > 0"],
  [11, "batting", "犠打", "x.sh", "x.sh > 0"],
  [12, "batting", "犠飛", "x.sf", "x.sf > 0"],
  [13, "batting", "四球", "x.bb", "x.bb > 0"],
  [14, "batting", "故意四", "x.ibb", "x.ibb > 0"],
  [15, "batting", "死球", "x.hbp", "x.hbp > 0"],
  [16, "batting", "三振", "x.so", "x.so > 0"],
  [21, "pitching", "勝利", "x.decision", "x.decision = '○'"],
  [22, "pitching", "敗戦", "x.decision", "x.decision = '●'"],
  [23, "pitching", "セーブ", "x.decision", "x.decision = 'S'"],
  [24, "pitching", "ホールド", "x.decision", "x.decision = 'H'"],
  [25, "pitching", "被安打", "x.h", "x.h > 0"],
  [26, "pitching", "被本塁打", "x.hr", "x.hr > 0"],
  [27, "pitching", "与四球", "x.bb", "x.bb > 0"],
  [28, "pitching", "与死球", "x.hbp", "x.hbp > 0"],
  [29, "pitching", "奪三振", "x.so", "x.so > 0"],
  [30, "pitching", "失点", "x.runs", "x.runs > 0"],
  [31, "pitching", "自責点", "x.er", "x.er > 0"],
  [32, "pitching", "暴投", "x.wp", "x.wp > 0"],
  [33, "pitching", "ボーク", "x.balk", "x.balk > 0"],
  [34, "pitching", "投球回", "x.outs", "x.outs > 0"],
];

function target(kind: Kind, field: string): CrosscheckTargetField {
  const f = CROSSCHECK_FIELDS.find((r) => r.kind === kind && r.field === field);
  assert.ok(f !== undefined && f.refetch, `${key(kind, field)} 가 표에 대상으로 없다`);
  return f;
}

test("T2 대상 29행의 경기 값 식 · o>p · o<p 가 D4 그대로 — o<p 는 「출장」(범위 안에 그 선수의 행이 있는 경기)", () => {
  assert.equal(D4_TARGETS.length, 29);
  for (const [no, kind, field, value, more] of D4_TARGETS) {
    const f = target(kind, field);
    assert.equal(f.no, no, `${field}: 행 번호`);
    assert.equal(f.gameValue("x"), value, `${field}: 경기 값 식`);
    assert.equal(f.oursMore("x"), more, `${field}: o>p 술어`);
    assert.equal(f.oursLess("x"), "1 = 1", `${field}: o<p 는 출장 전부다`);
  }
});

/**
 * ⚠**경기 값 식이 도구가 실제로 더한 칼럼과 같은가**(M1) — D4 의 「우리 값(crosscheck)」 칸을 도구 소스에서 다시 읽는다.
 * 표를 손으로 옮기다 `x.d2` 를 `x.d3` 로 적으면 위 시험은 설계 문서의 오타와 같이 초록일 수 있다 — 여기는 **도구**와 맞댄다.
 */
test("⚠T2 대상 행의 경기 값 식이 도구의 합계 식과 같은 칼럼이다(M1)", () => {
  const sqlOf = (name: string): string => {
    const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(TOOL);
    assert.ok(m !== null, `${name} 를 못 찾았다`);
    return m[1]!;
  };
  const colOf = (sql: string, alias: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of sql.matchAll(new RegExp(`SUM\\(${alias}\\.(\\w+)\\) AS (\\w+)`, "g"))) out.set(m[2]!, `x.${m[1]!}`);
    for (const m of sql.matchAll(/SUM\(CASE WHEN pl\.decision = '([^']+)' THEN 1 ELSE 0 END\) AS (\w+)/g)) {
      out.set(m[2]!, `decision:${m[1]!}`);
    }
    return out;
  };
  const cols = { batting: colOf(sqlOf("BAT_SQL"), "b"), pitching: colOf(sqlOf("PIT_SQL"), "pl") };
  // ⚠분모 — 타격 15 칼럼 · 투구 10 칼럼 + 결정 4
  assert.equal(cols.batting.size, 15, "타격 SQL 의 합계 칼럼 수가 다르다 — 도구 모양이 바뀌었다");
  assert.equal(cols.pitching.size, 14, "투구 SQL 의 합계 칼럼 수가 다르다 — 도구 모양이 바뀌었다");

  // 라벨 → 도구가 그 라벨에 넘긴 우리 값(`o.<키>`)
  const ourKey = new Map<string, string>();
  for (const l of toolLabels()) {
    const after = TOOL.slice(l.at, l.at + 200);
    const m = /^(?:c\("[^"]+",\s*o\.(\w+)|cmp\([^"]*"[^"]+",(?:[^,]+,){2}\s*"[^"]+",\s*innings\(o\.(\w+)\))/.exec(after);
    if (m !== null) ourKey.set(key(l.kind, l.field), (m[1] ?? m[2])!);
  }
  let checked = 0;
  for (const f of CROSSCHECK_FIELDS) {
    if (!f.refetch) continue;
    const k = ourKey.get(key(f.kind, f.field));
    assert.ok(k !== undefined, `${key(f.kind, f.field)}: 도구가 이 라벨에 넘기는 우리 값을 못 찾았다`);
    const col = cols[f.kind].get(k);
    assert.ok(col !== undefined, `${key(f.kind, f.field)}: 우리 값 o.${k} 의 SQL 합계 식을 못 찾았다`);
    if (col.startsWith("decision:")) {
      assert.equal(f.gameValue("x"), "x.decision", `${f.field}: 결정 항목의 경기 값은 결정 표기다`);
      assert.equal(f.oursMore("x"), `x.decision = '${col.slice("decision:".length)}'`, `${f.field}: 도구가 센 결정 표기와 다르다`);
    } else {
      assert.equal(f.gameValue("x"), col, `${f.field}: 도구는 ${col} 를 더했는데 표는 ${f.gameValue("x")} 를 본다`);
    }
    checked += 1;
  }
  assert.equal(checked, 29);
});

test("T2 범위 조각 — `?` 다섯 개 · 값은 crosscheckScopeParams 의 차례(시즌 · 대회 · 기준일 · 팀 · 팀)", () => {
  const frag = crosscheckScope("b");
  assert.equal((frag.match(/\?/g) ?? []).length, 5, frag);
  assert.deepEqual(crosscheckScopeParams({ season: 2026, competition: "regular", through: AS_OF, team: "t" }), [
    2026,
    "regular",
    AS_OF,
    "t",
    "t",
  ]);
  for (const piece of ["g.season = ?", "g.status = 'played'", "g.competition = ?", "g.game_date <= ?", "b.side = 'away' AND g.away_code = ?", "b.side = 'home' AND g.home_code = ?"]) {
    assert.ok(frag.includes(piece), `범위 조각에 「${piece}」가 없다`);
  }
});

test("T2 별칭은 SQL 식별자만 받는다 — 조각에 그대로 박히므로", () => {
  for (const bad of ["b; DROP TABLE game", "x.y", "", "1x", "x--"]) {
    assert.throws(() => crosscheckScope(bad), /별칭/, `crosscheckScope(${JSON.stringify(bad)}) 가 던지지 않았다`);
    assert.throws(() => target("pitching", "暴投").gameValue(bad), /별칭/);
    assert.throws(() => target("pitching", "暴投").oursMore(bad), /별칭/);
  }
});

/**
 * ⚠**범위 조각의 뜻을 실제 DB 로 잰다** — 시즌 · `played` · 대회 · 기준일 · 그 팀 쪽.
 * 재료는 이번 사고를 줄인 것이다(`crosscheck-scenario.ts`): 髙橋 의 暴投 경기는 5/13 · 9/17 · 9/23 이고
 * 9/29(기준일 뒤) · 10/10(클라이맥스) · 3/15(오픈전) · 6/1(치르지 않은 경기)의 행은 빠져야 한다.
 * ⚠오픈전과 치르지 않은 경기는 **기준일 앞**이다 — 날짜 조건이 대신 빼 주지 않으므로 대회·상태 조건을 따로 잰다.
 * 이적 선수의 행은 팀마다 갈린다.
 */
test("⚠T2 범위 조각이 기준일 뒤 · 다른 대회 · 다른 팀 쪽 행을 뺀다 — 이적 선수는 팀마다 갈린다", () => {
  const s = buildScenario();
  try {
    const db = openDb(s.db, "2026-10-02T00:00:00.000Z");
    try {
      const games = (table: "batting_line" | "pitching_line", player: string, team: string, extra = "1 = 1"): string[] =>
        (
          db.raw
            .prepare(
              `SELECT g.game_id AS id FROM ${table} x JOIN game g ON g.game_id = x.game_id
               WHERE ${crosscheckScope("x")} AND x.player_id = ? AND (${extra})
               ORDER BY g.game_date DESC, g.game_id`,
            )
            .all(...crosscheckScopeParams({ season: SEASON, competition: "regular", through: AS_OF, team }), player) as {
            id: string;
          }[]
        ).map((r) => r.id);

      // 髙橋 — 9/29(기준일 뒤)를 빼고 셋
      assert.deepEqual(games("pitching_line", "91095136", "t"), ["2026/0923/s-t-23", "2026/0917/t-c-20", "2026/0513/s-t-08"]);
      // 森下 — 9/29(기준일 뒤) · 10/10(클라이맥스)을 빼고 셋
      assert.deepEqual(games("batting_line", "00000101", "t"), ["2026/0923/s-t-23", "2026/0917/t-c-20", "2026/0513/s-t-08"]);
      // 이적 — t 로는 5/13 하나 · s 로는 9/23 하나
      assert.deepEqual(games("batting_line", "00000401", "t"), ["2026/0513/s-t-08"]);
      assert.deepEqual(games("batting_line", "00000401", "s"), ["2026/0923/s-t-23"]);
      // 村上(s) — 같은 경기에 있었지만 t 쪽 행이 아니다
      assert.deepEqual(games("batting_line", "00000301", "t"), []);
      assert.deepEqual(games("batting_line", "00000301", "s"), ["2026/0513/s-t-08"]);

      // o>p 술어 — 暴投 가 NULL 인 행은 「> 0」이 아니다(戸郷) · 결정 표기는 그 표기만
      const wp = target("pitching", "暴投");
      assert.deepEqual(games("pitching_line", "00000202", "g", wp.oursMore("x")), []);
      assert.deepEqual(games("pitching_line", "91095136", "t", wp.oursMore("x")), [
        "2026/0923/s-t-23",
        "2026/0917/t-c-20",
        "2026/0513/s-t-08",
      ]);
      assert.deepEqual(games("pitching_line", "91095136", "t", target("pitching", "勝利").oursMore("x")), ["2026/0917/t-c-20"]);
      assert.deepEqual(games("pitching_line", "91095136", "t", target("pitching", "敗戦").oursMore("x")), []);
    } finally {
      db.close();
    }
  } finally {
    s.cleanup();
  }
});

test("T2 대상 29행의 식이 실제 스키마에서 돈다 — 칼럼 이름 오타를 잡는다", () => {
  const s = buildScenario();
  try {
    const db = openDb(s.db, "2026-10-02T00:00:00.000Z");
    try {
      for (const f of CROSSCHECK_FIELDS) {
        if (!f.refetch) continue;
        const table = f.kind === "batting" ? "batting_line" : "pitching_line";
        const sql = `SELECT g.game_id, g.game_date, g.fetched_at, ${f.gameValue("x")} AS value
                     FROM ${table} x JOIN game g ON g.game_id = x.game_id
                     WHERE ${crosscheckScope("x")} AND x.player_id = ? AND (${f.oursMore("x")}) AND (${f.oursLess("x")})`;
        assert.doesNotThrow(
          () => db.raw.prepare(sql).all(...crosscheckScopeParams({ season: SEASON, competition: "regular", through: AS_OF, team: "t" }), "91095136"),
          `${f.field}: ${sql}`,
        );
      }
    } finally {
      db.close();
    }
  } finally {
    s.cleanup();
  }
});

/** ⚠**도구가 같은 조각을 쓴다**(M1) — 도구 안에 범위 조건이 따로 남아 있으면 한쪽만 고쳐졌을 때 후보 조회와 갈린다 */
test("⚠T2 도구의 두 SQL 이 범위 조각을 crosscheckScope 에서 가져온다 — 따로 적지 않는다", () => {
  assert.match(TOOL, /import \{[^}]*\bcrosscheckScope\b[^}]*\} from "\.\.\/src\/crosscheck-fields\.ts";/, "도구가 crosscheck-fields 에서 범위 조각을 가져오지 않는다");
  assert.match(TOOL, /WHERE \$\{crosscheckScope\("b"\)\}/, "타격 SQL 이 범위 조각을 안 쓴다");
  assert.match(TOOL, /WHERE \$\{crosscheckScope\("pl"\)\}/, "투구 SQL 이 범위 조각을 안 쓴다");
  assert.equal(/g\.status = 'played'/.test(TOOL), false, "도구에 범위 조건이 따로 남아 있다 — 두 벌이다");
  // 값의 차례도 한 벌이다 — 두 SQL 이 모두 crosscheckScopeParams 가 낸 값으로만 묶인다
  const bound = /const (\w+) = crosscheckScopeParams\(/.exec(TOOL);
  assert.ok(bound !== null, "도구가 범위 값을 crosscheckScopeParams 로 만들지 않는다 — 차례를 손으로 적었다");
  for (const sql of ["BAT_SQL", "PIT_SQL"]) {
    assert.match(TOOL, new RegExp(`prepare\\(${sql}\\)\\.all\\(\\.\\.\\.${bound[1]!}\\)`), `${sql} 가 범위 값(${bound[1]!})만으로 묶이지 않는다`);
  }
});

/** `parseFieldValue(field, s)` 는 역할을 받지 않는다 — 라벨만으로 모양이 정해져야 그 서명이 성립한다 */
test("T2 두 역할에 같은 라벨이 있으면 모양도 같다 — parseFieldValue 가 라벨만 받아도 된다", () => {
  const shapes = new Map<string, Set<string>>();
  for (const f of CROSSCHECK_FIELDS) shapes.set(f.field, new Set([...(shapes.get(f.field) ?? []), f.shape]));
  const shared = CROSSCHECK_FIELDS.filter((f) => CROSSCHECK_FIELDS.some((g) => g.field === f.field && g.kind !== f.kind));
  assert.deepEqual([...new Set(shared.map((f) => f.field))], ["試合"], "역할을 넘어 겹치는 라벨이 試合 말고도 생겼다");
  for (const [field, s] of shapes) assert.equal(s.size, 1, `${field}: 역할마다 값 모양이 다르다 — 라벨만으로 못 읽는다`);
});

test("T2 parseFieldValue — 셈·결정은 `^\\d+$` 만, 「-」(NaN)·「null」은 해석 불가(M7·M11)", () => {
  assert.equal(parseFieldValue("暴投", "3"), 3);
  assert.equal(parseFieldValue("暴投", "0"), 0);
  assert.equal(parseFieldValue("安打", "121"), 121);
  assert.equal(parseFieldValue("勝利", "2"), 2);
  assert.equal(parseFieldValue("試合", "10"), 10, "試合 도 셈이다(대상 아님은 표가 말한다)");
  for (const bad of ["NaN", "null", "-", "－", "", " 3", "3 ", "3.0", "-1", "+1", "1e2", "３"]) {
    assert.equal(parseFieldValue("暴投", bad), null, `暴投 ${JSON.stringify(bad)} 를 수로 읽었다 — 기본값으로 메우는 것과 같다`);
  }
  assert.equal(parseFieldValue("暴投", "99999999999999999999"), null, "안전한 정수를 넘는 수는 읽지 않는다");
});

test("T2 parseFieldValue — 投球回 은 아웃 수로 · 공표의 「+」는 아웃 0", () => {
  assert.equal(parseFieldValue("投球回", "100"), 300);
  assert.equal(parseFieldValue("投球回", "100.1"), 301);
  assert.equal(parseFieldValue("投球回", "100.2"), 302);
  assert.equal(parseFieldValue("投球回", "0"), 0);
  assert.equal(parseFieldValue("投球回", "+"), 0);
  for (const bad of ["100.3", "100.0", "1.", ".1", "1/3", "-", "NaN", "null", "", "10 1/3"]) {
    assert.equal(parseFieldValue("投球回", bad), null, `投球回 ${JSON.stringify(bad)}`);
  }
});

test("T2 parseFieldValue — 비율과 표에 없는 항목은 수로 읽지 않는다", () => {
  for (const [field, s] of [["打率", ".300"], ["長打率", "1.000"], ["出塁率", ".385"], ["防御率", "2.00"], ["盗塁刺", "3"], ["", "3"]] as const) {
    assert.equal(parseFieldValue(field, s), null, `${field} ${s}`);
  }
});

/** ⚠잎(I1 · `packages/store/src/refetch-limit.ts` 선례) — 진입점이 이 표만 가져와도 도구·파서·DB 를 끌어오지 않는다 */
test("⚠T2 crosscheck-fields.ts 는 import 가 0개인 잎이다", () => {
  assert.equal(/^\s*import\b/m.test(LEAF), false, "crosscheck-fields.ts 에 import 문이 있다");
  assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(LEAF), false, "crosscheck-fields.ts 가 동적으로 무언가를 불러온다");
});

test("⚠T2 서브패스 `@bb-app/aggregate/crosscheck-fields` 로 내보내고 · 그것이 같은 표다", async () => {
  const pkg = JSON.parse(read("../package.json")) as { exports: Record<string, string> };
  assert.equal(pkg.exports["./crosscheck-fields"], "./src/crosscheck-fields.ts", "package.json 의 exports 에 ./crosscheck-fields 가 없다");
  const viaSubpath = (await import("@bb-app/aggregate/crosscheck-fields")) as { CROSSCHECK_FIELDS: readonly CrosscheckField[] };
  assert.equal(viaSubpath.CROSSCHECK_FIELDS, CROSSCHECK_FIELDS, "서브패스로 가져온 표가 같은 객체가 아니다 — 두 벌이다");
});
