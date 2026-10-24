#!/usr/bin/env node
/**
 * **`runner_event.after_seq` 가 `pa_event.seq` 를 가리키는가** — wSB 의 선행 결함 계측.
 *
 * 쓰는 법:  node scripts/runner-seq-measure.ts data/bb.sqlite
 *
 * ## 왜 이걸 재는가
 *
 * **wSB(도루의 득점가치)를 내려면 「그 도루가 어떤 상황에서 일어났는가」가 필요하다** —
 * 최소한 이닝·아웃·주자를 알아야 RE 행렬을 붙일 수 있다. `runner_event` 는 그것을
 * 자기 열(`inning`·`outs_before`·`bases`)로 들고 있지만, **타석 로그와 이어 붙이는 열은
 * `after_seq` 하나**다. 그 열이 실제로 `pa_event.seq` 를 가리키지 않으면
 * 「이 도루 다음 타석에서 무엇이 일어났는가」를 물을 수 없다.
 *
 * ⚠**마이그레이션 010 은 이미 경고를 적어 두었다**: `runner_event.seq` 는
 * 「경기 내 **주자 사건** 순번」이고 「타석 순번과 **다른 계열**」이다.
 * 이 스크립트는 **`after_seq` 쪽도 그런가**를 실측한다.
 *
 * ⚠**대회를 섞지 않는다**(§2-1) — 정규시즌만 낸다. 전 대회 수치도 같이 낸다(분모를 적기 위해).
 * ⚠⚠**「문서에 적는 수」는 고정 범위(`DOC_SEASONS`)로 센다**(2026-10-24 · 이중 검토 P3) — `scripts/test/runner-seq.test.ts` 와
 *   같은 범위다. ~~데이터상 완결 시즌~~ 으로 셌더니 정규시즌이 끝난 날 2026 이 섞여 재현 명령이 시험·문서와 다른 분모를 냈다.
 *   데이터상 완결 시즌은 **참고 줄**로 따로 낸다(범위를 올리는 절차는 `docs/operations.md` 「해마다 하는 일」).
 */
import { DatabaseSync } from "node:sqlite";
import { DOC_SEASONS, regularSeasonGames } from "@bb-app/domain";

const dbPath = process.argv[2];
if (dbPath === undefined) {
  console.error("usage: node scripts/runner-seq-measure.ts <db-path>");
  process.exit(2);
}

/**
 * ⚠**읽기 전용으로 연다.** `openDb` 는 **미적용 마이그레이션을 적용한다** — 즉 쓴다.
 * 계측이 DB 를 바꾸면 「잰 것」과 「있던 것」이 갈리고, 이 워크트리는 여러 에이전트가 함께 쓴다.
 */
const db = new DatabaseSync(dbPath, { readOnly: true });

/**
 * **데이터상 완결 시즌** — 12구단 전부가 `regularSeasonGames(시즌)` 을 치렀는가 · **2020 은 120경기다.** ⚠**참고 줄에만 쓴다.**
 * ⚠**문서에 적는 수는 완결 시즌의 것이어야 한다** — 진행 중 시즌을 넣으면 경기가 들어올 때마다 낡는다.
 *   그 「완결 시즌」은 **`DOC_SEASONS`(고정 범위)** 다 — 데이터 판정은 정규시즌이 끝난 날 범위 밖 시즌을 넣는다.
 * ⚠**「최근 시즌을 뺀다」로 쓰지 마라**(2026 이 끝난 뒤에도 영원히 빠진다) — 고정 범위는 명시한 목록이고, 끝난 시즌이 그 밖이면
 *   수집 로그가 알린다(`scripts/freshness.ts`).
 */
const settled = new Set(
  (
    db
      .prepare(
        `SELECT season, MIN(n) AS fewest FROM (
           SELECT season, code, COUNT(*) AS n FROM (
             SELECT season, home_code AS code FROM game WHERE competition='regular' AND status='played'
             UNION ALL
             SELECT season, away_code AS code FROM game WHERE competition='regular' AND status='played'
           ) GROUP BY season, code
         ) GROUP BY season`,
      )
      .all() as unknown as { season: number; fewest: number }[]
  )
    .filter((r) => Number(r.fewest) >= regularSeasonGames(Number(r.season)))
    .map((r) => Number(r.season)),
);
// ⚠비면 `IN ()` 는 구문 오류다 — `IN (NULL)` 은 아무것도 안 고른다(0건이 「안 쟀음」이 아니라 「해당 없음」으로 찍힌다)
const inList = (seasons: Iterable<number>): string => `g.season IN (${[...seasons].sort((a, b) => a - b).join(",") || "NULL"})`;
/** **문서에 적는 수의 범위** — `DOC_SEASONS` 한 벌(M1) */
const DOC_SQL = inList(DOC_SEASONS);
const SETTLED_SQL = inList(settled);
console.log(`문서 범위(DOC_SEASONS): ${DOC_SEASONS.join(" ")} ← **문서·시험에 적는 수는 이 범위다**`);
console.log(`(참고) 데이터상 완결 시즌: ${[...settled].sort((a, b) => a - b).join(" ") || "없음"}`);
const docNotSettled = DOC_SEASONS.filter((s) => !settled.has(s));
if (docNotSettled.length > 0) console.log(`⚠문서 범위 중 이 DB 에서 완결이 아닌 시즌: ${docNotSettled.join(" ")} — 그 시즌의 수가 문서와 다르다`);
console.log("");

for (const [label, where] of [
  ["**문서 범위(DOC_SEASONS)** · 정규 · played  ← **문서에 적는 수**", `g.competition = 'regular' AND g.status = 'played' AND ${DOC_SQL}`],
  ["(참고) 데이터상 완결 시즌 · 정규 · played", `g.competition = 'regular' AND g.status = 'played' AND ${SETTLED_SQL}`],
  ["보유 전 시즌 · 정규 · played (진행 중 포함 — 자란다)", `g.competition = 'regular' AND g.status = 'played'`],
  ["보유 전 시즌 · 전 대회 · played", `g.status = 'played'`],
] as const) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN r.after_seq = 0 THEN 1 ELSE 0 END) AS beforeFirstPa,
         SUM(CASE WHEN r.after_seq > 0 AND p.seq IS NULL THEN 1 ELSE 0 END) AS noSuchPa,
         SUM(CASE WHEN p.seq IS NOT NULL AND p.inning <> r.inning THEN 1 ELSE 0 END) AS inningMismatch,
         SUM(CASE WHEN p.seq IS NOT NULL AND p.half <> r.half THEN 1 ELSE 0 END) AS halfMismatch,
         SUM(CASE WHEN p.seq IS NOT NULL AND (p.inning <> r.inning OR p.half <> r.half) THEN 1 ELSE 0 END) AS anyMismatch
       FROM runner_event r
       JOIN game g ON g.game_id = r.game_id
       LEFT JOIN pa_event p ON p.game_id = r.game_id AND p.seq = r.after_seq
       WHERE ${where}`,
    )
    .get() as Record<string, number>;

  const pct = (n: number): string => `${((n / row["total"]!) * 100).toFixed(2)}%`;
  console.log(`## ${label} — 주자 사건 ${row["total"]!.toLocaleString("en-US")}건`);
  console.log(`  after_seq = 0 (첫 타석 앞)            ${row["beforeFirstPa"]} (${pct(row["beforeFirstPa"]!)})`);
  console.log(`  after_seq > 0 인데 그 seq 의 타석 없음  ${row["noSuchPa"]} (${pct(row["noSuchPa"]!)})`);
  console.log(`  이어 붙였는데 **이닝이 다름**            ${row["inningMismatch"]} (${pct(row["inningMismatch"]!)})`);
  console.log(`  이어 붙였는데 **표리가 다름**            ${row["halfMismatch"]} (${pct(row["halfMismatch"]!)})`);
  console.log(`  둘 중 하나라도 어긋남                   ${row["anyMismatch"]} (${pct(row["anyMismatch"]!)})`);
  const broken = row["noSuchPa"]! + row["anyMismatch"]!;
  console.log(`  **이어 붙일 수 없거나 어긋남(합)**       ${broken} (${pct(broken)})`);
  console.log("");
}

/**
 * ⚠**어긋남이 「한 칸 밀림」인가** — 고칠 사람에게 필요한 진단.
 * `after_seq − 1` 의 타석이 그 주자 사건과 같은 이닝·표리라면 **`after_seq` 가 다음 타석을 가리킨** 것이다.
 * ⚠**이 스크립트는 어느 쪽이 옳은지 판정하지 않는다** — 「둘이 갈린다」까지가 여기서 말할 수 있는 것이다.
 * ⚠**범위는 위 「문서에 적는 수」 줄과 같다**(`DOC_SEASONS`) — 그 줄의 어긋남을 설명하는 진단이다.
 */
const offByOne = db
  .prepare(
    `SELECT COUNT(*) AS mismatched,
            SUM(CASE WHEN q.inning = r.inning AND q.half = r.half THEN 1 ELSE 0 END) AS prevMatches
       FROM runner_event r
       JOIN game g ON g.game_id = r.game_id
       JOIN pa_event p ON p.game_id = r.game_id AND p.seq = r.after_seq
       LEFT JOIN pa_event q ON q.game_id = r.game_id AND q.seq = r.after_seq - 1
      WHERE g.competition = 'regular' AND g.status = 'played' AND ${DOC_SQL}
        AND (p.inning <> r.inning OR p.half <> r.half)`,
  )
  .get() as { mismatched: number; prevMatches: number };
console.log(
  `## 어긋난 ${offByOne.mismatched}건 중 **(after_seq − 1) 이 같은 이닝·표리**: ` +
    `${offByOne.prevMatches} (${((offByOne.prevMatches / offByOne.mismatched) * 100).toFixed(1)}%)`,
);
console.log("");

/** ⚠**어긋난 실례를 낸다** — 「일부 불일치」로 적지 않는다(작업규칙 7) */
const samples = db
  .prepare(
    `SELECT r.game_id AS gameId, r.seq AS rseq, r.after_seq AS afterSeq, r.inning AS rInning,
            r.half AS rHalf, r.kind AS kind, p.inning AS pInning, p.half AS pHalf
       FROM runner_event r
       JOIN game g ON g.game_id = r.game_id
       JOIN pa_event p ON p.game_id = r.game_id AND p.seq = r.after_seq
      WHERE g.competition = 'regular' AND g.status = 'played'
        AND (p.inning <> r.inning OR p.half <> r.half)
      LIMIT 10`,
  )
  .all() as unknown as Record<string, unknown>[];
console.log("## 어긋난 실례 (정규 · 최대 10건)");
for (const s of samples) {
  console.log(
    `  ${s["gameId"]} 주자#${s["rseq"]}(${s["kind"]}) ${s["rInning"]}회${s["rHalf"]} → ` +
      `after_seq=${s["afterSeq"]} 의 타석은 ${s["pInning"]}회${s["pHalf"]}`,
  );
}
if (samples.length === 0) console.log("  없음");

/**
 * ⚠**「타석 순번이 이닝 안에서 다시 시작하는가」** — 두 계열이 갈리는 가장 흔한 원인.
 * 경기 단위 통번이면 `MAX(seq)` 가 타석 수와 같다.
 */
const seqShape = db
  .prepare(
    `SELECT COUNT(*) AS games,
            SUM(CASE WHEN maxSeq = n THEN 1 ELSE 0 END) AS gameWide
       FROM (SELECT p.game_id, MAX(p.seq) AS maxSeq, COUNT(*) AS n
               FROM pa_event p JOIN game g ON g.game_id = p.game_id
              WHERE g.competition = 'regular' AND g.status = 'played'
              GROUP BY p.game_id)`,
  )
  .get() as { games: number; gameWide: number };
console.log("");
console.log(
  `## pa_event.seq 가 경기 단위 통번인가: ${seqShape.gameWide}/${seqShape.games}경기 ` +
    `(MAX(seq) == 타석 수)`,
);

const rseqShape = db
  .prepare(
    `SELECT COUNT(*) AS games,
            SUM(CASE WHEN maxSeq = n THEN 1 ELSE 0 END) AS gameWide
       FROM (SELECT r.game_id, MAX(r.seq) AS maxSeq, COUNT(*) AS n
               FROM runner_event r JOIN game g ON g.game_id = r.game_id
              WHERE g.competition = 'regular' AND g.status = 'played'
              GROUP BY r.game_id)`,
  )
  .get() as { games: number; gameWide: number };
console.log(
  `## runner_event.seq 가 경기 단위 통번인가: ${rseqShape.gameWide}/${rseqShape.games}경기`,
);

db.close();
