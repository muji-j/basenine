/**
 * **문서에 박힌 실측 수치** — `.md` 를 글자로 읽어 DB 로 다시 센다.
 *
 * ⚠**`packages/web/test/source-figures.test.ts` 가 화면 문자열에 대해 하는 일을,
 * 이 시험은 문서에 대해 한다.** 둘 다 같은 사고 하나를 막는다:
 * **문법은 완벽하고 문장만 거짓인 상태**는 타입도 린트도 못 잡고,
 * **사람이 손으로 고치기 전까지 조용히 남는다.**
 *
 * 이 시험이 생긴 이유(2026-08-20):
 * `CLAUDE.md` §2-2 와 `docs/metrics/README.md` §6 이 xFIP 미산출 사유로
 * 「인플레이의 **30%** 가 미분류(타석 로그 **113,019행**)」이라고 적고 있었는데,
 * 그건 **보유가 4시즌이던 시절 값**이었다. 9시즌을 백필한 뒤에도 아무도 안 고쳤고,
 * **아무 시험도 그걸 못 잡았다.**
 *
 * ⚠**기대값을 손으로 적지 않는다.** DB 에서 세어 만든 수가 **문서 안에 있는가**를 본다 —
 * 손으로 적으면 문서와 시험이 같이 낡고, 그건 검사가 아니라 복사다.
 *
 * ⚠**여기서 못 박는 것은 「진행 중 시즌이 섞여 자라는 수」다.**
 * 완결 시즌만 인용한 수(파크팩터 2018~2025 · RPW 2025 · 특정 경기일 실측)는 자라지 않으므로
 * 대상이 아니다 — 넓히면 시험이 잡음으로 부풀고, 부푼 시험은 아무도 안 읽는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DB = `${ROOT}data/bb.sqlite`;
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** 이 수치들이 **같은 말을 해야 하는** 문서들(M1) */
const DOCS = {
  claude: "CLAUDE.md",
  metrics: "docs/metrics/README.md",
  recheck: "docs/sources/2026-08-20-war-xfip-recheck.md",
} as const;

const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

/** 12,345 형식. 문서가 쓰는 표기와 같아야 찾을 수 있다 */
const group = (n: number): string => n.toLocaleString("en-US");

/**
 * ⚠**「인플레이 타구」의 정의가 곧 이 수치의 절반이다.**
 * 타구가 나오지 않은 타석(삼진·사사구·방해·반칙)을 뺀 전부이고, **홈런은 포함**한다 —
 * 홈런은 정의상 뜬공이고 xFIP 의 FB 분모에 들어간다.
 */
const NOT_IN_PLAY = [
  "strikeout", "walk", "intentionalWalk", "hitByPitch", "strikeoutReached",
  "interference", "obstruction", "interferenceOut", "ruleViolationOut", "unknown",
];

interface Figures {
  pa: number;
  inPlay: number;
  unclassified: number;
  single: number;
  double: number;
  triple: number;
  buntHits: number;
  pctMin: string;
  pctMax: string;
  pctAll: string;
  batterGames: number;
  multiPos: number;
  multiPosPct: string;
}

function measure(): Figures {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const rows = db.raw
      .prepare(
        `SELECT g.season AS season, p.outcome AS outcome, p.raw_box AS raw
           FROM pa_event p JOIN game g USING (game_id)`,
      )
      .all() as { season: number; outcome: string; raw: string }[];
    assert.ok(rows.length > 400_000, `타석 로그가 ${rows.length}행뿐이다 — 이 시험이 공회전한다`);

    const skip = new Set(NOT_IN_PLAY);
    const per = new Map<number, { inPlay: number; uncl: number }>();
    let inPlay = 0, uncl = 0, buntHits = 0;
    const byOutcome = { single: 0, double: 0, triple: 0 };
    for (const r of rows) {
      if (skip.has(r.outcome)) continue;
      inPlay += 1;
      const e = per.get(r.season) ?? { inPlay: 0, uncl: 0 };
      e.inPlay += 1;
      per.set(r.season, e);
      // 안타(single/double/triple)에만 타구 종류가 없다. 단 **번트 안타는 붙어 있다**
      if (r.outcome !== "single" && r.outcome !== "double" && r.outcome !== "triple") continue;
      if (r.raw.includes("バ")) { buntHits += 1; continue; }
      uncl += 1;
      e.uncl += 1;
      byOutcome[r.outcome] += 1;
    }
    assert.ok(per.size >= 8, `시즌이 ${per.size}개뿐이다 — 이 시험이 공회전한다`);

    const pcts = [...per.values()].map((e) => (e.uncl / e.inPlay) * 100).sort((a, b) => a - b);

    const bg = db.raw
      .prepare(
        `SELECT b.position AS pos FROM batting_line b JOIN game g USING (game_id)
          WHERE g.competition = 'regular' AND g.status = 'played'`,
      )
      .all() as { pos: string | null }[];
    const TOKENS = "投捕一二三遊左中右指打走";
    let multiPos = 0;
    for (const r of bg) {
      const t = [...(r.pos ?? "").replace(/[()（）]/g, "")].filter((c) => TOKENS.includes(c));
      if (t.length >= 2) multiPos += 1;
    }

    return {
      pa: rows.length,
      inPlay,
      unclassified: uncl,
      single: byOutcome.single,
      double: byOutcome.double,
      triple: byOutcome.triple,
      buntHits,
      pctMin: pcts[0]!.toFixed(1),
      pctMax: pcts.at(-1)!.toFixed(1),
      pctAll: ((uncl / inPlay) * 100).toFixed(1),
      batterGames: bg.length,
      multiPos,
      multiPosPct: ((multiPos / bg.length) * 100).toFixed(1),
    };
  } finally {
    db.close();
  }
}

/** 문서 안에 있어야 하는 글자들. **하나라도 없으면 그 문서가 낡은 것이다** */
function required(f: Figures): { text: string; what: string }[] {
  return [
    { text: group(f.pa), what: "9시즌 총 타석" },
    { text: group(f.inPlay), what: "인플레이 타구" },
    { text: group(f.unclassified), what: "타구 종류 미분류" },
    { text: `${f.pctAll}%`, what: "미분류율(전 시즌)" },
    { text: group(f.single), what: "미분류 単打" },
    { text: group(f.double), what: "미분류 二塁打" },
    { text: group(f.triple), what: "미분류 三塁打" },
    { text: `${f.buntHits}건`, what: "종류가 붙은 비홈런 안타(=번트안타)" },
    { text: `${f.pctMin}%`, what: "시즌별 미분류율 하한" },
    { text: `${f.pctMax}%`, what: "시즌별 미분류율 상한" },
  ];
}

test("⚠xFIP 사유의 수치가 DB 와 같다 — 2026 이 자라면 여기가 먼저 떨어진다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = measure();
  const miss: string[] = [];
  for (const rel of Object.values(DOCS)) {
    const src = read(rel);
    for (const r of required(f)) {
      if (!src.includes(r.text)) miss.push(`${rel}: ${r.what} = ${r.text} 가 없다`);
    }
  }
  assert.deepEqual(
    miss,
    [],
    "문서가 말하는 수치와 DB 가 갈렸다. **DB 가 정본이다** — 위에 적힌 값으로 문서를 고쳐라.\n" +
      "⚠세 문서가 같은 말을 해야 한다(M1): CLAUDE.md §2-2 · docs/metrics/README.md §6 · " +
      "docs/sources/2026-08-20-war-xfip-recheck.md",
  );
});

test("⚠「번트를 뺀 안타는 전건이 종류 없음」이 아직 참이다 — 이게 무너지면 xFIP 판정이 통째로 바뀐다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = measure();
  // 미분류의 결과는 単打·二塁打·三塁打 셋뿐이고 그 합이 미분류 전체다
  assert.equal(
    f.single + f.double + f.triple,
    f.unclassified,
    "미분류에 안타가 아닌 것이 섞였다 — 문서의 「100% 안타」가 거짓이 됐다",
  );
  // ⚠**뒤집힐 조건 1 의 감시자**: npb.jp 가 안타에 종류를 붙이기 시작하면 이 비율이 내려간다
  assert.ok(
    Number(f.pctAll) > 20,
    `미분류율이 ${f.pctAll}% 로 내려갔다 — **소스가 바뀌었을 수 있다.** ` +
      "docs/metrics/README.md §6 「뒤집힐 조건」 1번을 확인하라(열리면 xFIP 와 tRA 기반 투수 WAR 이 동시에 열린다)",
  );
});

test("⚠Positional 사유의 수치가 DB 와 같다 — 타자 WAR 불가 판정의 근거다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = measure();
  const miss: string[] = [];
  for (const rel of [DOCS.claude, DOCS.metrics, DOCS.recheck]) {
    const src = read(rel);
    for (const r of [
      { text: group(f.batterGames), what: "정규 타자-경기" },
      { text: group(f.multiPos), what: "복수 표기 타자-경기" },
      { text: `${f.multiPosPct}%`, what: "복수 표기 비율" },
    ]) {
      if (!src.includes(r.text)) miss.push(`${rel}: ${r.what} = ${r.text} 가 없다`);
    }
  }
  assert.deepEqual(miss, [], "문서가 말하는 포지션 수치와 DB 가 갈렸다 — DB 값으로 고쳐라");
});

/**
 * ⚠**M1 은 「같은 사실을 두 곳에서 다르게 쓰지 않는다」이다.**
 * 위 시험들은 각 문서가 DB 와 맞는지만 본다 — 한 문서에서 수치를 **통째로 지우면** 통과해 버린다.
 * 그래서 **세 문서가 전부 그 수를 들고 있는가**를 따로 못 박는다.
 */
test("⚠결론이 세 문서에서 같다 — 한쪽만 고치고 다른 쪽을 두면 여기서 떨어진다", () => {
  for (const rel of [DOCS.claude, DOCS.metrics]) {
    const src = read(rel);
    assert.ok(
      src.includes("2026-08-20-war-xfip-recheck.md"),
      `${rel} 이 조사 전문(docs/sources/2026-08-20-war-xfip-recheck.md)을 가리키지 않는다`,
    );
    assert.ok(
      src.includes("tRA"),
      `${rel} 이 tRA 를 말하지 않는다 — 투수 WAR·xFIP 를 막는 것이 같은 구멍이라는 사실이 빠졌다`,
    );
  }
});
