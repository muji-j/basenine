/**
 * 문서와 코드의 대조 — 수준 등급의 임계값.
 *
 * ⚠**규칙이 코드에만 있으면 아무도 검증할 수 없다**(M3의 정신). 그래서 임계값을
 * `docs/metrics/README.md` §6-A에 표로 적었는데, **적어두기만 하면 반드시 어긋난다.**
 * 코드를 고치고 문서를 잊는 것이 기본값이기 때문이다. 여기서 둘을 묶는다.
 *
 * ⚠**그룹(타자·선발·구원)마다 표가 따로 있다.** 같은 `防御率`이 선발과 구원에서 다른 값이므로,
 * 표를 하나로 읽으면 뒤쪽 표가 앞쪽을 덮어쓰고 **한 그룹이 통째로 검증 밖으로 나간다.**
 *
 * 이 테스트가 깨지면 **둘 중 하나를 고르는 것이 아니라 어느 쪽이 맞는지 정한 뒤 둘 다** 고친다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCALES, gradeGroups } from "../src/grade.ts";
import type { GradeGroup } from "../src/grade.ts";

const DOC = join(import.meta.dirname, "..", "..", "..", "docs", "metrics", "README.md");

/** 문서의 표기 → 등급 척도 키. 표기가 바뀌면 여기도 바뀐다 */
const BY_LABEL: Readonly<Record<string, string>> = {
  打率: "avg",
  出塁率: "obp",
  長打率: "slg",
  OPS: "ops",
  wOBA: "woba",
  "wRC+": "wrcPlus",
  ISO: "iso",
  "BB%": "bbRate",
  "K%": "kRate",
  防御率: "era",
  WHIP: "whip",
  FIP: "fip",
  "K/9": "k9",
  "BB/9": "bb9",
  "HR/9": "hr9",
};

/** 어느 소제목 아래의 표인가. 문서의 제목이 바뀌면 여기도 바뀐다 */
const HEADINGS: Readonly<Record<GradeGroup, string>> = {
  batter: "### 타자 임계값",
  starter: "### 선발 임계값",
  reliever: "### 구원 임계값",
};

interface DocRow {
  label: string;
  key: string;
  thresholds: number[];
  lowerIsBetter: boolean;
}

/** 한 소제목 아래, 다음 소제목까지의 표만 읽는다 */
function docRows(group: GradeGroup): DocRow[] {
  const md = readFileSync(DOC, "utf8");
  const from = md.indexOf(HEADINGS[group]);
  assert.notEqual(from, -1, `${HEADINGS[group]} 를 문서에서 못 찾았다`);
  const rest = md.slice(from + HEADINGS[group].length);
  const nextHeading = rest.search(/\n### /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const rows: DocRow[] = [];
  for (const line of section.split("\n")) {
    const c = line.split("|").map((s) => s.trim());
    if (c.length < 7) continue;
    const key = BY_LABEL[c[1] ?? ""];
    if (key === undefined) continue;
    rows.push({
      label: c[1] ?? "",
      key,
      thresholds: c.slice(2, 6).map(Number),
      // 문서는 「낮을수록 좋음」 또는 「↓」로 방향을 쓴다
      lowerIsBetter: (c[6] ?? "").includes("↓") || (c[6] ?? "").includes("낮을수록"),
    });
  }
  return rows;
}

test("문서의 표가 코드의 전 그룹·전 지표를 덮는다 — 빠진 줄은 검증 밖이다", () => {
  for (const group of gradeGroups()) {
    const rows = docRows(group);
    assert.ok(rows.length > 0, `${group}: 표를 한 줄도 못 읽었다 — 문서 형식이 바뀌었다`);
    const documented = new Set(rows.map((r) => r.key));
    const missing = Object.keys(SCALES[group]).filter((k) => !documented.has(k));
    assert.deepEqual(missing, [], `${group}: 문서에 없는 지표 — ${missing.join(", ")}`);
    assert.equal(
      rows.length,
      Object.keys(SCALES[group]).length,
      `${group}: 문서에만 있는 줄이 있다`,
    );
  }
});

test("임계값이 문서와 코드에서 같다 — 어긋나면 화면의 색이 문서의 주장과 달라진다", () => {
  for (const group of gradeGroups()) {
    for (const row of docRows(group)) {
      const code = SCALES[group][row.key]!.thresholds;
      assert.deepEqual(
        row.thresholds,
        [...code],
        `${group}/${row.label}: 문서 ${row.thresholds.join(" / ")} ≠ 코드 ${code.join(" / ")}`,
      );
    }
  }
});

test("⚠방향이 문서와 코드에서 같다 — 뒤집히면 좋은 투수가 「매우 나쁨」 색이 된다", () => {
  for (const group of gradeGroups()) {
    for (const row of docRows(group)) {
      assert.equal(
        SCALES[group][row.key]!.higherIsBetter,
        !row.lowerIsBetter,
        `${group}/${row.label}: 문서와 코드의 방향이 반대다`,
      );
    }
  }
});

test("⚠선발과 구원의 임계값이 실제로 다르다 — 같아지면 이 분리가 무의미해진다", () => {
  const sp = SCALES["starter"]!["era"]!.thresholds;
  const rp = SCALES["reliever"]!["era"]!.thresholds;
  assert.notDeepEqual([...sp], [...rp], "선발과 구원의 방어율 임계값이 같다");
  // 구원 쪽이 전 구간에서 더 엄하다 — 실측 분포가 그렇다
  for (let i = 0; i < 4; i += 1) {
    assert.ok(rp[i]! < sp[i]!, `방어율 ${i}번째 임계값: 구원(${rp[i]})이 선발(${sp[i]})보다 크다`);
  }
});

test("문서가 「색을 칠하지 않는 것」을 실제 코드와 같이 말한다", () => {
  const md = readFileSync(DOC, "utf8");
  for (const group of gradeGroups()) {
    for (const key of ["babip", "src", "srcPer600"]) {
      assert.equal(SCALES[group][key], undefined, `${group}/${key}에 등급이 생겼다 — 문서를 고쳐야 한다`);
    }
  }
  assert.match(md, /BABIP/);
  assert.match(md, /SRC · SRC\/600/);
});

test("역할 규칙이 문서에 있다 — 코드에만 있으면 아무도 검증할 수 없다(M3)", () => {
  const md = readFileSync(DOC, "utf8");
  assert.match(md, /## 5-B\. 투수의 역할/);
  // 자체 기준임을 문서가 분명히 말하는가
  assert.match(md, /우리 기준\. NPB 기준이 아니다/);
  // 선발 판정의 근거(첫 타석 투수)와 실측 분모
  assert.match(md, /첫 타석을 던진 투수/);
  assert.match(md, /632경기 전부 \/ 1264명/);
});
