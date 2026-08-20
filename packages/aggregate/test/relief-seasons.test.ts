/**
 * 火消し — **실DB로, 그리고 다른 방법으로 다시 세어** 검증한다.
 *
 * ⚠**창 함수 SQL 은 눈으로 검증할 수 없다.** `LAG` 와 `ROWS BETWEEN CURRENT ROW AND
 * UNBOUNDED FOLLOWING` 이 맞는지는 **같은 답을 다른 방법으로 얻어** 맞대는 수밖에 없다.
 * 그래서 이 시험은 타석 로그를 통째로 읽어 **JS 로 다시 세고** SQL 의 답과 비교한다.
 * 두 구현이 같은 실수를 할 가능성은 낮다(정렬·경계 처리가 서로 다른 계층에 있다).
 *
 * ⚠**그리고 자격 기준을 고정한다**(M3). 「시즌 단위 개인 순위를 만들지 마라」는 판단의 근거가
 * 실측 표본이므로, 그 표본이 바뀌면 판단도 다시 해야 한다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "@bb-app/store";
import { MIN_INHERITED_FOR_RATE, foldRelief, midInningEntries } from "../src/relief.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** ⚠**SQL 과 다른 경로다** — 창 함수를 쓰지 않고 행을 순서대로 훑는다 */
const RAW_SQL = `
SELECT e.game_id AS gameId, e.seq AS seq, e.inning AS inning, e.half AS half,
       e.pitcher_id AS pitcherId, e.bases AS bases, e.runs_scored AS runs
FROM pa_event e JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final'
ORDER BY e.game_id, e.seq
`;

interface RawRow {
  gameId: string;
  seq: number;
  inning: number;
  half: string;
  pitcherId: string | null;
  bases: string;
  runs: number;
}

/** JS 로 다시 세기. **하프이닝을 덩어리로 잘라** 뒤에서부터 남은 득점을 만든다 */
function recount(): { midInning: number; inherited: number; runners: number; doused: number } {
  const db = new DatabaseSync(DB, { readOnly: true });
  let rows: RawRow[];
  try {
    rows = db.prepare(RAW_SQL).all() as unknown as RawRow[];
  } finally {
    db.close();
  }

  let midInning = 0;
  let inherited = 0;
  let runners = 0;
  let doused = 0;

  let i = 0;
  while (i < rows.length) {
    // 하프이닝 덩어리 [i, j)
    let j = i;
    const head = rows[i]!;
    while (
      j < rows.length &&
      rows[j]!.gameId === head.gameId &&
      rows[j]!.inning === head.inning &&
      rows[j]!.half === head.half
    ) {
      j += 1;
    }
    // 뒤에서부터 「이 타석 이후(포함) 득점」
    const rest = new Array<number>(j - i).fill(0);
    let acc = 0;
    for (let k = j - 1; k >= i; k -= 1) {
      acc += rows[k]!.runs;
      rest[k - i] = acc;
    }
    for (let k = i + 1; k < j; k += 1) {
      const cur = rows[k]!;
      const prev = rows[k - 1]!;
      if (cur.pitcherId === null || prev.pitcherId === null) continue;
      if (cur.pitcherId === prev.pitcherId) continue;
      midInning += 1;
      if (cur.bases === "") continue;
      inherited += 1;
      runners += cur.bases.length;
      if (rest[k - i] === 0) doused += 1;
    }
    i = j;
  }
  return { midInning, inherited, runners, doused };
}

test(
  "⚠창 함수 SQL 의 답이 다른 방법으로 센 답과 같다 — 이 시험이 없으면 SQL 을 검증할 길이 없다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const scan = midInningEntries(db, "regular", "9999-12-31", 0, 9999);
      const lines = foldRelief(scan.entries, () => undefined);
      const got = {
        midInning: lines.reduce((a, l) => a + l.midInning, 0),
        inherited: lines.reduce((a, l) => a + l.inherited, 0),
        runners: lines.reduce((a, l) => a + l.inheritedRunners, 0),
        doused: lines.reduce((a, l) => a + l.doused, 0),
      };
      // ⚠**공회전 방지**: 둘 다 0이면 `deepEqual` 이 조용히 통과한다
      assert.ok(got.midInning > 5000, `이닝 도중 등판이 ${got.midInning}회뿐이다 — 이 시험이 공회전한다`);
      assert.deepEqual(got, recount(), "창 함수 SQL 과 JS 재계산이 어긋난다 — relief.ts 의 SQL 을 의심하라");
    } finally {
      db.close();
    }
  },
);

test(
  "⚠자격 기준의 근거가 아직 참이다 — 시즌 단위로는 순위가 성립하지 않는다(M3)",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      // 한 시즌
      const one = foldRelief(midInningEntries(db, "regular", "9999-12-31", 2025, 2025).entries, () => undefined);
      const withRunners = one.filter((l) => l.inherited > 0);
      assert.ok(withRunners.length > 100, `2025 투수가 ${withRunners.length}명뿐이다 — 이 시험이 공회전한다`);
      const perPitcher = withRunners.reduce((a, l) => a + l.inherited, 0) / withRunners.length;
      // 실측 2026-08-20: 743 / 178 = 4.17
      assert.ok(
        perPitcher < MIN_INHERITED_FOR_RATE,
        `한 시즌 1인당 주자 안은 등판이 ${perPitcher.toFixed(2)}회로 자격선(${MIN_INHERITED_FOR_RATE})을 넘었다 — ` +
          "시즌 단위 순위를 만들지 않는다는 판단의 근거가 바뀌었다. relief.ts 의 주석과 화면 문구를 다시 보라",
      );

      // 통산
      const all = foldRelief(midInningEntries(db, "regular", "9999-12-31", 0, 9999).entries, () => undefined);
      const qualified = all.filter((l) => l.inherited >= MIN_INHERITED_FOR_RATE);
      // 실측 2026-08-20: 235명(10회 이상)
      assert.ok(
        qualified.length > 100,
        `통산으로도 자격자가 ${qualified.length}명뿐이다 — 이 지표를 낼 근거가 약해졌다`,
      );
    } finally {
      db.close();
    }
  },
);

/**
 * ⚠**빌드가 이 조회를 시즌마다 하지 않고 한 번만 한다**(`query.ts` 의 `CareerContext`).
 * 시즌 범위로 자르는 대신 **전 범위를 뽑아 `season <= S` 로 거르는데**, 그 둘이 같아야만
 * 그 최적화가 성립한다. 다르면 **과거 시즌 화면의 火消し 가 조용히 달라진다** —
 * 값이 빠지는 게 아니라 **남은 값이 틀리는** 모양이라 분모로도 결측으로도 안 드러난다.
 *
 * ⚠**같은 이유**: 조회는 하프이닝 **안의 인접**만 보고, 경기는 시즌을 넘지 않는다.
 * 그래도 「그럴 것이다」로 두지 않고 **실제로 맞대 본다.**
 */
test(
  "⚠시즌 범위로 자른 답과 전 범위를 걸러 낸 답이 같다 — 빌드의 한 번만 계산이 여기 걸려 있다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const full = midInningEntries(db, "regular", "9999-12-31", 0, 9999).entries;
      assert.ok(full.length > 5000, `등판을 ${full.length}건밖에 못 읽었다 — 이 시험이 공회전한다`);
      const seasons = [...new Set(full.map((e) => e.season))].sort();
      assert.ok(seasons.length >= 5, `시즌이 ${seasons.length}개뿐이다 — 이 시험이 공회전한다`);
      /**
       * ⚠**전 시즌을 돌지 않는다 — 3점만 본다**(처음·가운데·끝).
       * 성질 자체가 구조적이라(하프이닝 안의 인접만 본다) 전수와 3점의 판정력이 같고,
       * 전수로 돌면 이 시험 하나가 **48초**를 먹는다(실측 2026-08-20 · 시즌 수의 제곱이라
       * 백필할수록 더 커진다 — 그건 이 최적화가 없애려던 바로 그 모양이다).
       */
      const probes = [...new Set([seasons[0]!, seasons[Math.floor(seasons.length / 2)]!, seasons.at(-1)!])];
      const key = (e: (typeof full)[number]): string =>
        [e.pitcherId, e.season, e.teamCode, e.offenseCode, e.bases, e.outs, e.restRuns].join("|");
      for (const s of probes) {
        const ranged = midInningEntries(db, "regular", "9999-12-31", seasons[0]!, s).entries;
        const filtered = full.filter((e) => e.season <= s);
        assert.ok(ranged.length > 0, `${s}년까지의 등판이 0건이다 — 이 시험이 공회전한다`);
        assert.deepEqual(
          ranged.map(key).sort(),
          filtered.map(key).sort(),
          `${s}년까지: 범위 조회 ${ranged.length}건 · 전 범위 필터 ${filtered.length}건 — ` +
            "`CareerContext` 의 「한 번만 계산」이 성립하지 않는다",
        );
      }
    } finally {
      db.close();
    }
  },
);
