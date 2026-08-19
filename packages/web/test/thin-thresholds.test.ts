/**
 * **정의서에 적힌 임계값이 코드가 쓰는 값인가**(M3).
 *
 * ⚠**문서가 코드와 갈리면 문서 쪽이 거짓말이 된다.** 2026-08-20 감사가 잡은 것이 그것이다:
 * `docs/metrics/README.md` §5-A 는 좌우 스플릿의 최소 표본을 **「100타석(잠정)」**이라고
 * 적고 있었는데, 코드는 그 수를 **한 번도 쓴 적이 없다** — `THIN_SPLIT_PA=30` ·
 * `THIN_SITUATION_PA=10` · `THIN_MATCHUP_PA=10` 이다.
 * 그 상태에서는 정의서를 읽고 화면을 예측할 수 없고, **자격 기준은 표시 규칙이 아니라 값의 일부**라
 * (M3) 그건 그냥 값을 잘못 공시한 것이다.
 *
 * ⚠**이 시험이 재는 것은 「값이 옳은가」가 아니라 「두 곳이 같은가」다.**
 * 30이 좋은 값인지는 여기서 정하지 않는다(§5-A 가 「정답이 아니라 선택」이라고 적어 두었다).
 * 바꿀 때 **한쪽만** 바뀌는 것을 막는 것이 일이다.
 *
 * ⚠**클라이언트 사본도 같이 본다**(M1). 대전 표의 얇음 판정은 브라우저에서도 한 번 더 도는데,
 * 그 상수는 `assets.ts` 안의 **JS 문자열에 박힌 리터럴**이라 타입도 린트도 두 값을 맞대 주지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THIN_SPLIT_PA } from "../src/query.ts";
import { THIN_MATCHUP_PA, THIN_SITUATION_PA } from "../src/player-page.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, "..", "..", "..", "docs", "metrics", "README.md");
const ASSETS = join(HERE, "..", "src", "assets.ts");

/** §5-A 표의 한 줄에서 「**N타석** `상수이름`」을 뽑는다 */
function documented(md: string, constant: string): number | null {
  const m = new RegExp(`\\*\\*(\\d+)타석\\*\\* \`${constant}\``).exec(md);
  return m === null ? null : Number(m[1]);
}

test("⚠정의서 §5-A 의 스플릿 임계값이 코드 상수와 같다", () => {
  const md = readFileSync(DOC, "utf8");

  // ⚠**공회전 방지**: 표 자체가 사라지거나 형식이 바뀌면 아래 비교가 전부 「없음 vs 없음」이 된다
  assert.match(md, /## 5-A\. 스플릿의 자격 기준/, "§5-A 가 정의서에서 사라졌다 — 이 시험이 잴 것이 없다");

  const pairs: [string, number][] = [
    ["THIN_SPLIT_PA", THIN_SPLIT_PA],
    ["THIN_SITUATION_PA", THIN_SITUATION_PA],
    ["THIN_MATCHUP_PA", THIN_MATCHUP_PA],
  ];
  for (const [name, code] of pairs) {
    const doc = documented(md, name);
    assert.notEqual(doc, null, `정의서 §5-A 가 ${name} 을 안 싣는다 — 코드에만 있는 기준은 아무도 검증할 수 없다(M3)`);
    assert.equal(doc, code, `${name}: 정의서 ${doc}타석 · 코드 ${code}타석 — 둘 중 하나가 거짓말이다`);
  }

  /**
   * ⚠**옛 값이 남아 있지 않은가.** 「100타석」이 §5-A 안에 **기준으로** 다시 나오면
   * 위 세 줄이 맞아도 읽는 사람은 100 을 믿는다.
   * 다만 「48타석 .364 → 143타석 .341」 같은 **관측 사례**의 수는 기준이 아니므로 건드리지 않는다.
   */
  const section = md.slice(md.indexOf("## 5-A."), md.indexOf("## 6."));
  assert.ok(section.length > 200, "§5-A 구간을 못 잘랐다 — 이 시험이 공회전한다");
  assert.doesNotMatch(
    section,
    /최소 표본[^\n|]*\|\s*100타석/,
    "§5-A 표에 옛 기준 「100타석」이 남아 있다",
  );
});

/**
 * ⚠**같은 임계값이 서버와 브라우저에 두 벌 있다**(M1). 서버가 그린 `thin` 클래스와
 * 브라우저가 정렬할 때 세는 「얇은 행」이 다른 수를 쓰면, **같은 표가 스크립트 유무에 따라
 * 다른 말을 한다** — 그건 값이 틀린 것과 같다.
 */
test("⚠클라이언트 번들의 THIN_MATCHUP_PA 가 서버 상수와 같다", () => {
  const src = readFileSync(ASSETS, "utf8");
  const m = /const THIN_MATCHUP_PA\s*=\s*(\d+)\s*;/.exec(src);
  assert.notEqual(m, null, "클라이언트 번들에서 THIN_MATCHUP_PA 를 못 찾았다 — 이름이 바뀌었으면 이 시험도 고쳐라");
  assert.equal(
    Number(m?.[1]),
    THIN_MATCHUP_PA,
    `클라 ${m?.[1]} · 서버 ${THIN_MATCHUP_PA} — 같은 표가 스크립트 유무에 따라 다른 행을 「얇다」고 한다`,
  );
});
