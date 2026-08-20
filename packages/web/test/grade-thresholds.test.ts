/**
 * **등급 임계값이 「지금 쓰는 자」로 뽑은 것인가.**
 *
 * ⚠**이 시험이 생긴 이유**(2026-08-21 최종 검토 P2-①): 2026-08-20 에 wOBA 계수를
 * **모듈 상수 1세트 → 리그×시즌 유도값**으로 갈면서 **임계값을 안 갈았다.**
 * 그러면 색이 「60%」라고 부르면서 **56.7%** 에서 자른다 — 값은 맞고 화면만 틀린,
 * `grade.ts` 표제부가 「만들면 안 된다」고 적어 둔 그 상태다.
 *
 * ⚠**값만 고치면 다음에 또 난다.** 그래서 두 그물을 친다:
 * ⑴ **기계적** — 임계값을 DB 에서 다시 뽑아 대조한다. 계수 유도가 바뀌면 **자동으로** 떨어진다
 * ⑵ **대장(帳簿)** — 임계값 산출일이 `docs/metrics/README.md` §4 「계수를 바꾼 날」보다
 *    앞서면 떨어진다. DB 없이도 도는 쪽이고, M4(「어제 본 숫자와 다른데?」)의 기록과 묶는다
 *
 * ⚠**기대값을 손으로 적지 않는다**(`scripts/test/doc-figures.test.ts` 와 같은 결) —
 * 손으로 적으면 시험과 코드가 같이 낡고, 그건 검사가 아니라 복사다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "@bb-app/store";
import {
  BASIS,
  BASIS_LABEL_DATE,
  ROUND_STEP,
  derivedThresholds,
  gradeIndex,
  quantiles,
  roundTo,
} from "../../../scripts/grade-thresholds-measure.ts";
import {
  BASIS_AS_OF,
  GROUP_BASIS,
  SCALES,
  THRESHOLDS_DERIVED_ON,
  gradeOf,
  gradeOrder,
} from "../src/grade.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const DB = join(ROOT, "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const DOC = join(ROOT, "docs", "metrics", "README.md");

/**
 * **§4 「계수를 바꾼 날」이 적은 날짜 중 가장 최근 것.**
 *
 * ⚠**한 절만 보지 않는다.** 다음에 계수를 또 바꾸면 **새 절을 덧붙일** 가능성이 높으므로
 * 제목에 그 말이 들어간 절을 **전부** 훑는다. 하나만 보면 새 절이 조용히 검사 밖으로 나간다.
 */
function coefficientChangeDates(): string[] {
  const md = readFileSync(DOC, "utf8");
  const out: string[] = [];
  const heading = /^#{2,4} .*계수를 바꾼 날.*$/gm;
  for (let m = heading.exec(md); m !== null; m = heading.exec(md)) {
    const rest = md.slice(m.index + m[0].length);
    const next = rest.search(/\n#{2,4} /);
    const section = next === -1 ? rest : rest.slice(0, next);
    for (const line of section.split("\n")) {
      if (!/^\|\s*언제\s*\|/.test(line)) continue;
      const d = /\d{4}-\d{2}-\d{2}/.exec(line);
      if (d !== null) out.push(d[0]);
    }
  }
  return out;
}

test("⚠임계값 산출일이 계수 변경일보다 앞서면 안 된다 — 옛 자의 눈금이 새 값에 붙어 있다는 뜻이다", () => {
  const dates = coefficientChangeDates();
  assert.ok(
    dates.length > 0,
    "docs/metrics/README.md §4 「계수를 바꾼 날」의 「언제」 행을 못 읽었다 — " +
      "문서 형식이 바뀌었으면 이 시험도 같이 고쳐라(그물을 조용히 없애지 마라)",
  );
  const latest = dates.reduce((a, b) => (b > a ? b : a));
  assert.ok(
    THRESHOLDS_DERIVED_ON >= latest,
    `임계값 산출일 ${THRESHOLDS_DERIVED_ON} < 계수 변경일 ${latest} — ` +
      "계수를 갈았으면 임계값도 다시 뽑아야 한다. " +
      "`node scripts/grade-thresholds-measure.ts data/bb.sqlite` 로 다시 뽑고 " +
      "grade.ts 의 THRESHOLDS_DERIVED_ON 을 그 날로 고쳐라",
  );
});

/** ⚠**영향 범위에 「등급 색」이 없으면 다음 사람이 또 임계값을 안 고친다**(M4 기록의 구멍) */
test("⚠§4 「계수를 바꾼 날」의 영향 범위가 등급 색을 말한다", () => {
  const md = readFileSync(DOC, "utf8");
  const at = md.search(/^#{2,4} .*계수를 바꾼 날.*$/m);
  assert.notEqual(at, -1, "§4 「계수를 바꾼 날」 절이 없다");
  const rest = md.slice(at);
  const next = rest.slice(1).search(/\n#{2,4} /);
  const section = next === -1 ? rest : rest.slice(0, next + 1);
  const line = section.split("\n").find((l) => /^\|\s*영향 범위\s*\|/.test(l));
  assert.notEqual(line, undefined, "영향 범위 행이 없다");
  assert.match(
    line!,
    /등급 색/,
    "영향 범위가 wOBA·wRAA·wRC+ 만 말한다 — **색도 같이 움직인다.** " +
      "그 사실이 빠져 있었기 때문에 계수를 갈고도 임계값이 안 갈렸다",
  );
});

/** ⚠**화면 문구와 코드의 기준일이 갈리면 화면이 거짓말을 한다** */
test("⚠기준 모집단의 날짜가 코드·화면 문구·계측 스크립트에서 같다", () => {
  assert.equal(BASIS.through, BASIS_AS_OF, "계측 스크립트와 grade.ts 의 기준일이 다르다");
  for (const group of ["batter", "starter", "reliever"] as const) {
    assert.ok(
      GROUP_BASIS[group].includes(BASIS_LABEL_DATE),
      `${group} 의 화면 문구가 기준일을 다르게 말한다: ${GROUP_BASIS[group]}`,
    );
  }
  /**
   * ⚠**산출일이 모집단 기준일보다 앞설 수는 없다** — 없는 데이터로 뽑았다는 뜻이 된다.
   * ⚠**같은 날인 것은 정상이다.** 그게 오히려 기본이고(2026-08-15 산출이 그랬다),
   * 지금 둘이 갈라져 있는 이유는 **자가 바뀌어서 모집단은 그대로 두고 다시 쟀기** 때문이다.
   */
  assert.ok(
    THRESHOLDS_DERIVED_ON >= BASIS_AS_OF,
    `산출일 ${THRESHOLDS_DERIVED_ON} 이 모집단 기준일 ${BASIS_AS_OF} 보다 앞선다 — 없는 데이터로 뽑을 수는 없다`,
  );
});

/**
 * ⚠**계측 스크립트가 `gradeOf` 와 같은 계단인가.**
 * 스크립트는 「옛 임계값」으로도 등급을 매겨야 해서 계단을 한 벌 더 갖고 있다 —
 * 그 둘이 어긋나면 스크립트가 낸 실측치가 화면과 다른 것을 잰 수가 된다(M1).
 */
test("⚠계측 스크립트의 계단이 gradeOf 와 한 글자도 다르지 않다", () => {
  const order = gradeOrder();
  for (const key of ["woba", "wrcPlus"] as const) {
    const t = SCALES.batter[key]!.thresholds;
    // 임계값 주변·바깥까지 훑는다. **경계값(== 임계값)이 위 칸으로 가는가**가 핵심이다
    const probes = [...t.flatMap((x) => [x - 1e-9, x, x + 1e-9]), t[0]! - 1, t[3]! + 1];
    for (const v of probes) {
      const mine = gradeIndex(v, t, SCALES.batter[key]!.minSample);
      assert.notEqual(mine, null);
      assert.equal(
        order[mine!],
        gradeOf(key, v, SCALES.batter[key]!.minSample, "batter"),
        `${key} ${v}: 스크립트와 gradeOf 의 등급이 다르다`,
      );
    }
    // 표본이 모자라면 둘 다 「매기지 않는다」
    assert.equal(gradeIndex(t[0]!, t, SCALES.batter[key]!.minSample - 1), null);
    assert.equal(gradeOf(key, t[0]!, SCALES.batter[key]!.minSample - 1, "batter"), null);
  }
});

/** ⚠반올림 눈금이 바뀌면 임계값의 뜻이 바뀐다 — 여기서 못 박는다 */
test("⚠반올림은 wOBA 0.005 눈금 · wRC+ 1 눈금이다", () => {
  assert.equal(roundTo(0.3182, ROUND_STEP.woba), 0.32);
  assert.equal(roundTo(0.3457, ROUND_STEP.woba), 0.345);
  assert.equal(roundTo(0.2742, ROUND_STEP.woba), 0.275);
  assert.equal(roundTo(77.3, ROUND_STEP.wrcPlus), 77);
  assert.equal(roundTo(131.49, ROUND_STEP.wrcPlus), 131);
  // 최근접 순위법 — 보간하지 않으므로 결과는 **반드시 표본 안의 값**이다
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(quantiles(xs), [2, 4, 6, 8]);
  assert.throws(() => quantiles([]), RangeError);
});

/**
 * ⚠**기계적 그물** — 임계값을 DB 에서 다시 뽑아 코드와 맞댄다.
 *
 * ⚠**모집단은 기준일에 고정돼 있다**(`BASIS.through`). 그래서 2026 이 자라도 이 수는 안 움직인다 —
 * 움직이는 것은 **자가 바뀔 때뿐**이고, 그때는 **떨어져야 한다.**
 */
test(
  "⚠wOBA·wRC+ 임계값이 지금 계수로 다시 뽑은 분위수와 같다 — 계수를 갈면 여기가 떨어진다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const d = derivedThresholds(db);
      assert.equal(
        d.n,
        157,
        `기준 모집단이 ${d.n}명이다(기대 157) — ${BASIS.through} 이전의 데이터가 바뀌었다. ` +
          "그러면 임계값 전체를 다시 뽑아야 한다",
      );
      // ⚠**화면이 인원을 말한다**(M2). 코드가 잰 수와 갈리면 화면이 거짓말이 된다
      assert.ok(
        GROUP_BASIS.batter.includes(`${d.n}人`),
        `화면 문구가 인원을 다르게 말한다: ${GROUP_BASIS.batter}（실측 ${d.n}명）`,
      );
      for (const key of ["woba", "wrcPlus"] as const) {
        assert.deepEqual(
          d.rounded[key],
          [...SCALES.batter[key]!.thresholds],
          `${key}: 코드 ${SCALES.batter[key]!.thresholds.join(" / ")} ≠ ` +
            `다시 뽑은 값 ${d.rounded[key].join(" / ")}（분위수 ${d.raw[key].map((x) => x.toFixed(4)).join(" / ")}）\n` +
            "⚠**계수가 바뀌었는데 임계값이 안 바뀐 상태다.** " +
            "`node scripts/grade-thresholds-measure.ts data/bb.sqlite` 를 돌려 " +
            "grade.ts · docs/metrics/README.md §6-A · THRESHOLDS_DERIVED_ON 을 같이 고쳐라",
        );
      }
    } finally {
      db.close();
    }
  },
);
