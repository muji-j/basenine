/**
 * 문서와 코드의 대조 — 수준 등급의 임계값.
 *
 * ⚠**규칙이 코드에만 있으면 아무도 검증할 수 없다**(M3의 정신). 그래서 임계값을
 * `docs/metrics/README.md` §6-A에 표로 적었는데, **적어두기만 하면 반드시 어긋난다.**
 * 코드를 고치고 문서를 잊는 것이 기본값이기 때문이다. 여기서 둘을 묶는다.
 *
 * 이 테스트가 깨지면 **둘 중 하나를 고르는 것이 아니라 어느 쪽이 맞는지 정한 뒤 둘 다** 고친다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCALES } from "../src/grade.ts";

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

interface DocRow {
  label: string;
  key: string;
  thresholds: number[];
  lowerIsBetter: boolean;
}

function docRows(): DocRow[] {
  const md = readFileSync(DOC, "utf8");
  const rows: DocRow[] = [];
  for (const line of md.split("\n")) {
    const c = line.split("|").map((s) => s.trim());
    if (c.length < 8) continue;
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

test("문서의 표가 코드의 전 지표를 덮는다 — 빠진 줄이 있으면 그 지표는 검증 밖이다", () => {
  const rows = docRows();
  assert.ok(rows.length > 0, "표를 한 줄도 못 읽었다 — 문서 형식이 바뀌었다");
  const documented = new Set(rows.map((r) => r.key));
  const missing = Object.keys(SCALES).filter((k) => !documented.has(k));
  assert.deepEqual(missing, [], `문서에 없는 지표: ${missing.join(", ")}`);
  assert.equal(rows.length, Object.keys(SCALES).length, "문서에만 있는 줄이 있다");
});

test("임계값이 문서와 코드에서 같다 — 어긋나면 화면의 색이 문서의 주장과 달라진다", () => {
  for (const row of docRows()) {
    const code = SCALES[row.key]!.thresholds;
    assert.deepEqual(
      row.thresholds,
      [...code],
      `${row.label}: 문서 ${row.thresholds.join(" / ")} ≠ 코드 ${code.join(" / ")}`,
    );
  }
});

test("⚠방향이 문서와 코드에서 같다 — 뒤집히면 좋은 투수가 「매우 나쁨」 색이 된다", () => {
  for (const row of docRows()) {
    assert.equal(
      SCALES[row.key]!.higherIsBetter,
      !row.lowerIsBetter,
      `${row.label}: 문서와 코드의 방향이 반대다`,
    );
  }
});

test("문서가 「색을 칠하지 않는 것」을 실제 코드와 같이 말한다", () => {
  const md = readFileSync(DOC, "utf8");
  for (const key of ["babip", "src", "srcPer600"]) {
    assert.equal(SCALES[key], undefined, `${key}에 등급이 생겼다 — 문서를 고쳐야 한다`);
  }
  assert.match(md, /BABIP/);
  assert.match(md, /SRC · SRC\/600/);
});
