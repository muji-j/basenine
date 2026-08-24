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
 *
 * ## ⚠고치려던 병을 처음 판에서 스스로 앓았다 (2026-08-21 최종 검토 P2-④)
 *
 * 이 시험은 **진행 중 시즌을 포함한 수**를 문서에 요구했다. 같은 브랜치가 走塁 각주를
 * 완결 시즌으로 바꾸며 「경기가 하나 들어올 때마다 이 문서가 낡는다 … 시즌 중에는 매일 그렇게 된다 …
 * 지속 가능한 구조가 아니었다」고 적어 놓고, **여기서 정반대를 했다.**
 * → **문서에 요구하는 수는 완결 시즌만**으로 좁혔다(`completedSeasons`).
 *
 * ⚠**전칭 명제는 약해지지 않는다.** 「번트를 뺀 안타는 **전 보유 시즌** 전건이 타구 종류 없음」과
 * 「미분류율이 20%를 넘는다」는 **진행 중 시즌까지 포함해** 계속 검사한다 —
 * 그 둘은 **자라는 수를 문서에 요구하지 않으므로** 매일 낡지 않는다.
 * ⚠**완결 판정은 손으로 적지 않는다** — 12구단 전부가 `regularSeasonGames(시즌)` 을 치렀는가로 잰다.
 * 2026 이 끝나는 날 이 수들은 **한 번** 바뀌고, 그때 문서를 고치는 것이 맞는 일이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { regularSeasonGames } from "@bb-app/domain";

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
  /** 실제로 센 시즌. **분모의 분모다**(작업규칙 7) */
  seasons: number[];
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

/**
 * **완결 시즌** — 12구단 전부가 그 시즌의 규정 경기수를 치렀는가.
 *
 * ⚠**「최근 시즌을 뺀다」로 쓰지 마라.** 그러면 2026 이 끝난 뒤에도 영원히 빠진다.
 * ⚠**2020 은 120경기다** — `regularSeasonGames` 가 시즌별 표를 갖고 있으므로 여기서 143을 쓰지 않는다.
 */
function completedSeasons(db: ReturnType<typeof openDb>): Set<number> {
  const rows = db.raw
    .prepare(
      `SELECT season, MIN(n) AS fewest FROM (
         SELECT season, code, COUNT(*) AS n FROM (
           SELECT season, home_code AS code FROM game
            WHERE competition = 'regular' AND status = 'played'
           UNION ALL
           SELECT season, away_code AS code FROM game
            WHERE competition = 'regular' AND status = 'played'
         ) GROUP BY season, code
       ) GROUP BY season`,
    )
    .all() as { season: number; fewest: number }[];
  return new Set(rows.filter((r) => r.fewest >= regularSeasonGames(r.season)).map((r) => r.season));
}

/** 같은 스캔을 시험마다 다시 하지 않는다 — 타석 로그가 50만 행이다 */
const cache = new Map<string, Figures>();

/**
 * @param only 셀 시즌. `null` 이면 **보유 전부**(전칭 명제를 검사할 때).
 *   완결 시즌 집합을 주면 **문서에 요구하는, 자라지 않는 수**가 나온다.
 */
function measure(only: ReadonlySet<number> | null): Figures {
  const key = only === null ? "all" : [...only].sort((a, b) => a - b).join(",");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const take = (s: number): boolean => only === null || only.has(s);
    const rows = (
      db.raw
        .prepare(
          `SELECT g.season AS season, p.outcome AS outcome, p.raw_box AS raw
             FROM pa_event p JOIN game g USING (game_id)`,
        )
        .all() as { season: number; outcome: string; raw: string }[]
    ).filter((r) => take(r.season));
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

    const bg = (
      db.raw
        .prepare(
          `SELECT g.season AS season, b.position AS pos FROM batting_line b JOIN game g USING (game_id)
            WHERE g.competition = 'regular' AND g.status = 'played'`,
        )
        .all() as { season: number; pos: string | null }[]
    ).filter((r) => take(r.season));
    const TOKENS = "投捕一二三遊左中右指打走";
    let multiPos = 0;
    for (const r of bg) {
      const t = [...(r.pos ?? "").replace(/[()（）]/g, "")].filter((c) => TOKENS.includes(c));
      if (t.length >= 2) multiPos += 1;
    }

    const out: Figures = {
      seasons: [...per.keys()].sort((a, b) => a - b),
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
    cache.set(key, out);
    return out;
  } finally {
    db.close();
  }
}

/** 문서가 요구하는 수는 **완결 시즌만**이다 — 진행 중 시즌을 넣으면 매일 낡는다 */
function completed(): Figures {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  let only: Set<number>;
  try {
    only = completedSeasons(db);
  } finally {
    db.close();
  }
  assert.ok(only.size >= 8, `완결 시즌이 ${only.size}개뿐이다 — 이 시험이 공회전한다`);
  return measure(only);
}

/** 문서 안에 있어야 하는 글자들. **하나라도 없으면 그 문서가 낡은 것이다** */
function required(f: Figures): { text: string; what: string }[] {
  return [
    { text: group(f.pa), what: `완결 ${f.seasons.length}시즌 총 타석` },
    { text: group(f.inPlay), what: "인플레이 타구" },
    { text: group(f.unclassified), what: "타구 종류 미분류" },
    { text: `${f.pctAll}%`, what: "미분류율(완결 시즌 전체)" },
    { text: group(f.single), what: "미분류 単打" },
    { text: group(f.double), what: "미분류 二塁打" },
    { text: group(f.triple), what: "미분류 三塁打" },
    { text: `${f.buntHits}건`, what: "종류가 붙은 비홈런 안타(=번트안타)" },
    { text: `${f.pctMin}%`, what: "시즌별 미분류율 하한" },
    { text: `${f.pctMax}%`, what: "시즌별 미분류율 상한" },
  ];
}

test("⚠xFIP 사유의 수치가 DB 와 같다 — 완결 시즌만 센다(진행 중 시즌을 넣으면 매일 낡는다)", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = completed();
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
    `문서가 말하는 수치와 DB 가 갈렸다(잰 시즌: ${f.seasons.join("·")}). ` +
      "**DB 가 정본이다** — 위에 적힌 값으로 문서를 고쳐라.\n" +
      "⚠세 문서가 같은 말을 해야 한다(M1): CLAUDE.md §2-2 · docs/metrics/README.md §6 · " +
      "docs/sources/2026-08-20-war-xfip-recheck.md\n" +
      "⚠**이 수는 완결 시즌만 센다.** 진행 중 시즌이 자라서 떨어진 것이라면 그건 이 시험의 결함이다",
  );
});

test("⚠「번트를 뺀 안타는 전건이 종류 없음」이 아직 참이다 — **진행 중 시즌까지 본다**", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = measure(null);
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

test("⚠Positional 사유의 수치가 DB 와 같다 — 완결 시즌만 센다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = completed();
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
/**
 * **走塁 대조 수치** — CLAUDE.md §2-2 와 `steal.ts` 머리말이 같은 말을 해야 한다(M1).
 *
 * ⚠**이 시험이 없어서 그 두 곳이 조용히 낡았다**(감사 #3·#6 · 2026-08-22 반증).
 * 원문은 「2,395경기(2024〜2026) · 2026 도루 611 · 도루자 254」였는데 **진행 중 시즌**을 인용해서
 * 경기가 들어올 때마다 낡았고, 감사 시점에 이미 **2,401 · 618 · 255** 였다.
 * xFIP·Positional 은 이미 완결 시즌으로 고정돼 있었는데 **走塁만 빠져 있었다** —
 * ⚠**같은 파일의 머리말이 「走塁 각주에 이미 적용한 규칙」이라고 적고 있었고 그게 사실이 아니었다.**
 *
 * ⚠**기대값을 손으로 적지 않는다.** DB 에서 세어 만든 문자열이 **문서 안에 있는가**를 본다.
 * ⚠**분모를 둘로 낸다** — 도루 0인 경기는 `0 = 0` 으로 자동 일치하므로,
 * 전체 경기 수만 적으면 「전수 어긋남 0」이 실제보다 강해 보인다.
 */
interface StealFigures {
  seasons: number[];
  games: number;
  withSteal: number;
  mismatch: number;
  /** 마지막 완결 시즌 */
  last: number;
  regular: number;
  caught: number;
  allComp: number;
  gap: number;
}

function stealFigures(): StealFigures {
  const db = openDb(DB, "2026-08-22T00:00:00.000Z");
  try {
    const only = [...completedSeasons(db)].sort((a, b) => a - b);
    assert.ok(only.length >= 8, `완결 시즌이 ${only.length}개뿐이다 — 이 시험이 공회전한다`);
    const list = only.join(",");
    const rows = db.raw
      .prepare(
        `SELECT (SELECT COUNT(*) FROM runner_event r WHERE r.game_id = g.game_id AND r.kind = 'steal') AS derived,
                (SELECT COALESCE(SUM(b.sb), 0) FROM batting_line b WHERE b.game_id = g.game_id) AS box
           FROM game g WHERE g.season IN (${list}) AND g.status = 'played'`,
      )
      .all() as unknown as { derived: number; box: number }[];
    let withSteal = 0;
    let mismatch = 0;
    for (const r of rows) {
      if (r.box > 0 || r.derived > 0) withSteal += 1;
      if (r.derived !== r.box) mismatch += 1;
    }
    const last = only.at(-1)!;
    const n = (sql: string): number =>
      (db.raw.prepare(sql).get(last) as unknown as { n: number }).n;
    const regular = n(
      "SELECT COUNT(*) AS n FROM runner_event r JOIN game g ON g.game_id = r.game_id" +
        " WHERE g.season = ? AND g.competition = 'regular' AND r.kind = 'steal'",
    );
    const caught = n(
      "SELECT COUNT(*) AS n FROM runner_event r JOIN game g ON g.game_id = r.game_id" +
        " WHERE g.season = ? AND g.competition = 'regular' AND r.kind = 'caughtStealing'",
    );
    const allComp = n(
      "SELECT COUNT(*) AS n FROM runner_event r JOIN game g ON g.game_id = r.game_id" +
        " WHERE g.season = ? AND r.kind = 'steal'",
    );
    return {
      seasons: only, games: rows.length, withSteal, mismatch,
      last, regular, caught, allComp, gap: allComp - regular,
    };
  } finally {
    db.close();
  }
}

/** ⚠**두 곳이 같은 말을 해야 한다** — 한쪽만 고치면 여기서 떨어진다(M1) */
const STEAL_DOCS = ["CLAUDE.md", "packages/aggregate/src/steal.ts"] as const;

test("⚠走塁 대조 수치가 DB 와 같다 — 완결 시즌만 센다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = stealFigures();
  const want: { text: string; what: string }[] = [
    { text: `완결 ${f.seasons.length}시즌 ${group(f.games)}경기`, what: "대조한 경기 수" },
    { text: `도루가 있던 ${group(f.withSteal)}경기`, what: "⚠실질 분모(0=0 자동 일치를 뺀 것)" },
    { text: `어긋남 ${f.mismatch}건`, what: "파생 도루 대 박스 盗塁 의 불일치" },
    { text: `${f.last} 정규시즌 도루 ${group(f.regular)} · 도루자 ${group(f.caught)}`, what: "마지막 완결 시즌 합계" },
    { text: `${group(f.allComp)} 이 되어 ${f.gap} 어긋난다`, what: "대회를 섞었을 때의 차이" },
  ];
  const miss: string[] = [];
  for (const rel of STEAL_DOCS) {
    const src = read(rel);
    for (const w of want) if (!src.includes(w.text)) miss.push(`${rel}: ${w.what} = 「${w.text}」 가 없다`);
  }
  assert.deepEqual(
    miss,
    [],
    `走塁 수치가 DB 와 갈렸다(잰 시즌: ${f.seasons.join("·")}). **DB 가 정본이다.**\n` +
      "⚠**진행 중 시즌을 인용해서 떨어진 것이라면 그건 문서의 결함이다** — 완결 시즌으로 다시 적어라.\n" +
      "⚠두 곳이 같은 말을 해야 한다(M1): CLAUDE.md §2-2 · packages/aggregate/src/steal.ts 머리말",
  );
});

/**
 * ⚠**「어긋남 0건」이 「아무것도 안 쟀다」로 통과하지 못하게 한다.**
 * 주자 행이 통째로 비면 파생도 0, 박스 합도… 아니, 박스는 0이 아니다 —
 * 그래서 그 경우 이 시험이 아니라 위 시험이 운다. 여기서는 **분모 자체**를 지킨다.
 */
test("⚠走塁 대조가 실제로 무언가를 세고 있다 — 분모", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const f = stealFigures();
  assert.ok(f.games > 5_000, `대조 경기가 ${f.games}뿐이다 — 완결 시즌 판정이 망가졌다`);
  assert.ok(f.withSteal > 3_000, `도루가 있던 경기가 ${f.withSteal}뿐이다 — 주자 행이 안 들어왔을 수 있다`);
  assert.ok(f.gap > 0, "정규와 전 대회의 도루가 같다 — 대회 구분이 안 들어갔을 수 있다");
});

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
