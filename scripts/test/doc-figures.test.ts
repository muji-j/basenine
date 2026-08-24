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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { openDb } from "@bb-app/store";
import { regularSeasonGames } from "@bb-app/domain";
import { GAME_PAGES } from "@bb-app/archiver";

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

/**
 * **백필 예산** — CLAUDE.md §2-2 의 「몇 요청 · 몇 MiB」.
 *
 * ⚠**옛 값 「16,389요청 · 149MB」는 실제의 약 절반이었다**(2026-08-21 감사 [46]).
 * 원인이 분명하다: `GAME_PAGES` 에 `roster.html` 을 더해 **경기당 3→4장**이 됐는데
 * **같은 문단의 아랫줄만 고치고 이 줄을 안 고쳤다.** 그래서 한 문단 안에서
 * 「9시즌 16,389」와 「2024 한 시즌 3,636」(= 909경기 × 4)이 **서로 모순**이었다.
 *
 * ⚠**기대값을 손으로 적지 않는다** — `DB 경기 수 × GAME_PAGES.length` 로 만든다.
 * 손으로 적으면 **문서와 시험이 같이 낡는다**(그게 옛 값이 죽은 방식이다).
 * ⚠**완결 시즌만 요구한다** — 진행 중 시즌을 넣으면 경기가 들어올 때마다 이 줄이 낡는다.
 */
test("⚠백필 예산이 DB × GAME_PAGES 와 같다 — 완결 시즌만 센다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "2026-08-24T00:00:00.000Z");
  let games = 0;
  let only: ReadonlySet<number>;
  try {
    only = completedSeasons(db);
    games = (db.raw
      .prepare(`SELECT COUNT(*) AS n FROM game WHERE season IN (${[...only].join(",")})`)
      .get() as unknown as { n: number }).n;
  } finally {
    db.close();
  }
  assert.ok(only.size >= 8, `완결 시즌이 ${only.size}개뿐이다 — 이 시험이 공회전한다`);
  assert.ok(games > 5_000, `경기가 ${games}건뿐이다`);
  const src = read(DOCS.claude);
  const want = [
    { text: `완결 ${only.size}시즌 ${group(games)}경기 × ${GAME_PAGES.length}장 = ${group(games * GAME_PAGES.length)}요청`,
      what: "완결 시즌의 요청 수" },
  ];
  const miss = want.filter((w) => !src.includes(w.text)).map((w) => `${w.what} = 「${w.text}」 가 없다`);
  assert.deepEqual(
    miss,
    [],
    "백필 예산이 DB 와 갈렸다. **DB 가 정본이다.**\n" +
      "⚠**「4장」을 문장에 박아 둔 이유를 지우지 마라** — 그것이 옛 값이 죽은 원인이다.",
  );
});

/** ⚠**죽은 수가 돌아오는 것을 막는다** — 그 둘은 분모가 틀렸던 값이다 */
test("⚠절반짜리 예산(16,389 · 149MB)이 문서에 살아 돌아오지 않는다", () => {
  const src = read(DOCS.claude);
  for (const dead of ["16,389", "149MB"]) {
    const at = src.indexOf(dead);
    if (at === -1) continue;
    // 취소선(~~…~~) 안에 남긴 기록은 허용한다 — 「왜 죽었는가」가 그것이다
    const line = src.slice(src.lastIndexOf("\n", at) + 1, src.indexOf("\n", at));
    assert.ok(line.includes("~~"), `죽은 값 ${dead} 이 취소선 밖에 살아 있다: ${line.trim()}`);
  }
});

/**
 * **배포물 파일 수** — Pages 상한(배포당 20,000개)까지 얼마나 남았는가.
 *
 * ⚠**`deploy.md` 가 5시즌 시절 값(8,611 / 43%)을 그대로 들고 있었다**(2026-08-21 감사 [42]).
 * 실제는 15,500 / 77.5% 였다 — **같은 사실에 세 값**이 돌아다녔고 방어 시험이 0건이었다.
 * 상한을 재는 칸이 절반짜리 값을 말하면 **여유가 없는 날을 못 알아챈다.**
 *
 * ## ⚠정확히 일치시키지 않는다 — 이 수는 매일 는다
 *
 * 경기가 들어오면 페이지가 늘어난다. 정확 일치를 요구하면 **매일 붉어지고**, 매일 붉은 시험은
 * 아무도 안 읽는다(`archive-guard` 의 바이트 임계와 같은 판단).
 * → **허용 오차 3%**. 옛 값(8,611)은 실제의 **55.6%** 라 이 안에 절대 안 들어온다.
 */
const DIST_TOLERANCE = 0.03;

test("⚠문서의 배포물 파일 수가 dist 와 크게 어긋나지 않는다", () => {
  const dist = `${ROOT}dist`;
  if (!existsSync(dist)) {
    if (process.env["BB_REQUIRE_DIST"] === "1") throw new Error(`BB_REQUIRE_DIST=1 인데 ${dist} 가 없다`);
    return;
  }
  const countFiles = (d: string): number => {
    let n = 0;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      n += e.isDirectory() ? countFiles(join(d, e.name)) : 1;
    }
    return n;
  };
  const actual = countFiles(dist);
  assert.ok(actual > 5_000, `dist 가 ${actual}파일뿐이다 — 빌드가 끝나지 않았을 수 있다`);

  /** ⚠**같은 사실을 말하는 두 문서** — 한쪽만 고치면 여기서 떨어진다(M1) */
  const where = [DOCS.claude, "docs/operations/deploy.md"] as const;
  const bad: string[] = [];
  for (const rel of where) {
    const src = read(rel);
    /**
     * ⚠**취소선 구간을 먼저 지운다** — 「왜 죽었는가」의 기록은 살려 두되 **검사 대상에서 뺀다.**
     *
     * ⚠**처음에는 「그 숫자가 취소선으로 어디엔가 있으면 면제」로 짰고 그게 틀렸다**(2026-08-24).
     * 숫자 단위로 면제하면, 한 번 취소선에 적힌 수는 **살아 있는 자리에 다시 나타나도 통과**한다 —
     * 뮤테이션(옛 값 8,611 을 되살리기)이 **안 잡혀서** 알았다. 위치로 판단해야 한다.
     * ⚠**한 줄 안에서만 짝을 맞춘다** — 여러 줄을 걸치면 짝 없는 물결표 하나가 뒤를 통째로 삼킨다.
     */
    const live0 = src.replace(/~~[^~\n]*~~/g, "");
    const nums = [...live0.matchAll(/\*\*([0-9][0-9,]{3,})파일/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
    if (nums.length === 0) {
      bad.push(`${rel}: 「…파일」 을 한 군데도 안 적었다(취소선 밖에)`);
      continue;
    }
    for (const n of nums) {
      const off = Math.abs(n - actual) / actual;
      if (off > DIST_TOLERANCE) {
        bad.push(`${rel}: ${n.toLocaleString("en-US")}파일 은 실측 ${actual.toLocaleString("en-US")} 과 ${(off * 100).toFixed(1)}% 어긋난다`);
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    `문서의 배포물 파일 수가 낡았다(실측 ${actual.toLocaleString("en-US")} · 허용 ${DIST_TOLERANCE * 100}%).\n` +
      "⚠**두 문서가 같은 수를 말해야 한다**(M1) — 한쪽만 고치지 마라.",
  );
});

/**
 * **적재가 여는 파일** — CLAUDE.md §2-2-1 의 「경기마다 4장을 받는데 적재가 여는 것은 …」.
 *
 * ⚠**「`box` 와 `playbyplay` 둘뿐」이라고 적혀 있었고 거짓이었다**(2026-08-21 감사 [43]).
 * **바로 위 표가 지적한 결함을 고친 커밋(`6f6e525` · roster 추가)이 이 줄을 낡게 만들었고,
 * 그 줄을 안 고쳤다** — **고침이 문서를 낡게 하는** 모양이다.
 *
 * ⚠**소스를 정본으로 둔다.** 문서에 적힌 목록이 아니라 `load-archive.ts` 가 실제로 여는 것을 센다 —
 * 손으로 적으면 다음 `roster` 가 추가될 때 **또 같은 일이 난다.**
 * ⚠**월간 일정(`schedule_MM.html.gz`)은 뺀다** — 구장 조회표용이고 경기별 4장 밖이라 층이 다르다.
 */
test("⚠문서가 말하는 「적재가 여는 파일」이 소스와 같다", () => {
  const src = readFileSync(`${ROOT}packages/store/tools/load-archive.ts`, "utf8");
  const opened = new Set(
    [...src.matchAll(/"([a-z]+)\.html\.gz"/g)].map((m) => m[1]!),
  );
  // 경기별 페이지만 본다 — 일정은 층이 다르다
  opened.delete("schedule");
  assert.ok(opened.size >= 2, `여는 파일을 ${opened.size}개밖에 못 찾았다 — 이 시험이 공회전한다`);

  const doc = read(DOCS.claude);
  const line = doc.split("\n").find((l) => l.includes("적재가 여는 것은"));
  assert.ok(line !== undefined, "CLAUDE.md 에서 「적재가 여는 것은 …」 줄을 못 찾았다");
  const missing = [...opened].filter((f) => !line!.includes(f));
  assert.deepEqual(
    missing,
    [],
    `적재는 여는데 문서가 안 적은 파일: ${missing.join(", ")}\n` +
      `소스가 여는 것: ${[...opened].sort().join(", ")}\n` +
      `문서: ${line}\n` +
      "⚠**소스가 정본이다.** 새 페이지를 열게 됐으면 이 줄도 같이 고쳐라.",
  );
});

/**
 * **문서가 근거로 가리키는 파일이 저장소에 실제로 있는가.**
 *
 * ⚠**소스 서베이가 「외부 요청 0회로 대부분이 재현된다」고 적었는데 거짓이었다**(감사 [49]).
 * `docs/sources/samples/` 가 `.gitignore` 로 무추적이라 **클론한 사람에게는 0파일**이다 —
 * 그 문장을 믿은 다음 조사자는 **약 70요청을 L1 준수로 다시 쏘거나** 인용을 재대조하지 못한다.
 * ⚠**결정(.gitignore)이 문서보다 71분 먼저 났는데 문서가 안 따라갔다.**
 *
 * ## 이 시험이 재는 것
 *
 * 문서 본문이 백틱으로 가리키는 **저장소 상대경로**를 뽑아, **추적 중이 아니면 잡는다.**
 * ⚠**「파일이 있는가」가 아니라 「추적 중인가」다** — 내 머신에 있는 것과 클론에 있는 것은 다르다.
 * 그게 이 결함의 정확한 모양이었다.
 * ⚠**취소선 안과 「로컬 전용」이라고 스스로 밝힌 줄은 봐준다** — 그건 이미 정직한 서술이다.
 */
test("⚠문서가 근거로 가리키는 경로가 저장소에 추적돼 있다", () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(/\\/g, "/")),
  );
  assert.ok(tracked.size > 100, `git ls-files 가 ${tracked.size}건뿐이다 — 이 시험이 공회전한다`);

  const bad: string[] = [];
  for (const rel of [DOCS.metrics, DOCS.recheck, "docs/sources/2026-08-20-blocked-metrics-source-survey.md"]) {
    for (const line of read(rel).split("\n")) {
      // 스스로 「로컬 전용 / 저장소에 없다」라고 밝힌 줄과 취소선은 봐준다
      if (line.includes("로컬 전용") || line.includes("저장소에 없다") || line.includes("~~")) continue;
      for (const m of line.matchAll(/`(docs\/[A-Za-z0-9_.\/-]+\.[a-z]{2,4})`/g)) {
        const path = m[1]!;
        if (path.endsWith("/")) continue;
        if (!tracked.has(path)) bad.push(`${rel}: \`${path}\` 를 근거로 가리키는데 **추적되지 않는다**`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(bad)],
    [],
    "문서가 **클론에 없는 파일**을 근거로 가리킨다.\n" +
      "⚠**「내 머신에 있다」와 「저장소에 있다」는 다르다** — 그 줄에 **로컬 전용임을 명시**하거나 파일을 추적하라.",
  );
});

/**
 * **배포물에 HTML 주석이 남지 않는다** — 출력 경계(`html.ts` 의 `toString`)가 뗀다.
 *
 * ⚠**떼기 전 실측(2026-08-24 · 15,341장 전수): 주석 359,399개 · 114.62 MiB · html 총량의 11.39%.**
 * gzip 표본 300장에서 **3,449,862 → 2,684,348 B (22.19% 절감)** 이었고,
 * 실제로 떼고 다시 재니 **예측과 정확히 같았다**. 빌드 산출 용량은 **1,022.4MB → 907.8MB**.
 * ⚠**Pages 20,000파일 벽에는 효과 0**이다 — 줄어드는 것은 전송량과 용량이지 파일 수가 아니다.
 *
 * ⚠**소스의 주석은 그대로 둔다.** 그게 「왜 이렇게 했는가」이고 이 저장소가 가장 아끼는 것이다.
 * 지우는 자리는 **출력 경계 한 곳**뿐이다(M1).
 */
test("⚠배포물에 HTML 주석이 없다", () => {
  const dist = `${ROOT}dist`;
  if (!existsSync(dist)) {
    if (process.env["BB_REQUIRE_DIST"] === "1") throw new Error(`BB_REQUIRE_DIST=1 인데 ${dist} 가 없다`);
    return;
  }
  const pages: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p2 = join(d, e.name);
      if (e.isDirectory()) walk(p2);
      else if (e.name.endsWith(".html")) pages.push(p2);
    }
  };
  walk(dist);
  assert.ok(pages.length > 5_000, `html 이 ${pages.length}장뿐이다 — 빌드가 끝나지 않았을 수 있다`);

  let left = 0;
  const where: string[] = [];
  for (const f of pages) {
    const n = (readFileSync(f, "utf8").match(/<!--/g) ?? []).length;
    if (n > 0) {
      left += n;
      if (where.length < 5) where.push(`${f.slice(ROOT.length)}: ${n}개`);
    }
  }
  assert.equal(
    left,
    0,
    `배포물에 주석이 ${left}개 남았다(앞 5장)\n${where.join("\n")}\n` +
      "⚠**출력 경계가 안 걸린 경로가 있다** — 파일을 직접 쓰는 자리를 찾아라.",
  );
  console.log(`  · html ${pages.length.toLocaleString()}장 / 남은 주석 0개`);
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
