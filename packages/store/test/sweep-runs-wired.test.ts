/**
 * **득점 대조가 실제로 돌고 있는가.**
 *
 * ⚠**이 저장소에서 세 번째로 나온 「있는데 안 도는」 검사다**(2026-08-31).
 * 앞의 둘은 `sweep-archive`(2026-08-26)와 `crosscheck`(2026-08-27)였고, 둘 다
 * **통과하는데 아무도 안 돌리던** 상태였다. 이번 것도 같았다.
 *
 * ## ⚠왜 잠자고 있었는지가 더 중요하다
 *
 * **정상인 데이터에 `ERROR` 를 51번 외치고 있었다.** 中止 경기에는 `playbyplay` 가 없어서
 * npb.jp 가 그 주소에 **200 으로 관계없는 페이지**를 주는데, 그것을 파싱 실패로 세고 있었다.
 * **붉은 검사는 곧 무시된다** — 배선하기 전에 그것부터 고쳐야 했다.
 *
 * ## 층이 다르다
 *
 * | 도구 | 재는 것 | 못 잡는 것 |
 * |---|---|---|
 * | `sweep-archive` | 타자 행의 **컬럼 합계** 대 타석 셀 도출 | 이닝별 득점 귀속 |
 * | `crosscheck` | **시즌 집계** 대 npb.jp 공표표 | 경기 안의 흐름 |
 * | **`sweep-runs`** | **이닝별 득점** 대 라인스코어 | 위 둘 |
 *
 * 실측(2026-08-31 · 9시즌): 경기 **7,533** · 하프이닝 **134,323** · 中止 **51건(정상)** ·
 * 오류 **0건** · 유도 총득점 **56,254 = 라인스코어 56,254** · 불일치 **0건 / 0건**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const yml = readFileSync(join(ROOT, ".github", "workflows", "daily.yml"), "utf8");
/** ⚠주석을 코드로 읽지 않는다 */
const code = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
const tool = readFileSync(join(ROOT, "packages", "store", "tools", "sweep-runs.ts"), "utf8");

test("⚠득점 대조가 CI 에서 돈다 — 도구가 있다는 것과 도는 것은 다른 말이다", () => {
  assert.match(code, /packages\/store\/tools\/sweep-runs\.ts/, "워크플로에서 안 돈다");
});

/**
 * ⚠**배포보다 먼저여야 한다.** 뒤에 두면 **어긋난 득점이 이미 화면으로 나간 뒤**에 안다.
 */
test("⚠득점 대조가 화면 생성보다 앞이다", () => {
  const sweep = code.indexOf("sweep-runs.ts");
  const build = code.indexOf("web/tools/build.ts");
  assert.ok(sweep > 0 && build > 0, "두 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(sweep < build, "득점 대조가 화면 생성 뒤다 — 어긋난 수가 먼저 나간다");
});

/**
 * ⚠**中止 를 결함으로 세면 이 검사는 다시 잠든다.** 정상인 데이터에 붉어지는 검사는
 * 곧 「또 그거네」가 되고, 그러면 **진짜 결함이 났을 때도 아무도 안 본다.**
 * ⚠**그렇다고 조용히 넘기지도 않는다** — 따로 세어 화면에 말한다(「0건」과 「안 쟀음」의 구별).
 */
test("⚠中止 는 결함이 아니라 따로 센다 — 정상인 데이터에 붉어지면 검사가 죽는다", () => {
  assert.match(tool, /notPlayed \+= 1/, "中止 를 따로 세지 않는다");
  assert.match(tool, /parseBoxScore/, "박스로 판정하지 않는다 — 정규식으로 「中止」를 찾으면 규칙이 두 벌이 된다");
  assert.match(tool, /中止 \$\{notPlayed\}건\(정상\)/, "요약이 中止 건수를 말하지 않는다");
});

/**
 * ⚠**결함이 있으면 실패로 나가야 한다** — 종료 코드가 결함 수를 안 보면
 * 「돌기는 도는데 아무것도 못 막는」 장치가 된다.
 */
test("⚠불일치나 오류가 있으면 종료 코드가 1 이다", () => {
  assert.match(
    tool,
    /process\.exitCode = errors > 0 \|\| mismatches\.length > 0 \? 1 : 0/,
    "종료 코드가 결함을 안 본다 — 게이트가 아니다",
  );
});
