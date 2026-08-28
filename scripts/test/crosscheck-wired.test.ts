/**
 * **외부 대조가 실제로 돌고 있는가.**
 *
 * ⚠**`sweep-wired.test.ts` 와 같은 병을 막는다** — 「도구가 있다」와 「그것이 돈다」는 다른 말이다.
 * `crosscheck.ts` 는 **2026-08-27 까지 어디서도 안 돌았다.** 그날 처음 돌려 보니
 * 보유 4시즌(2023~2026) 전부 **결함 후보 0건**이었다 — **통과하는데 안 돌던 검사**다.
 *
 * ## 위 `sweep-archive` 와 재는 층이 다르다
 *
 * | | 재는 것 | 못 잡는 것 |
 * |---|---|---|
 * | `sweep-archive` | **경기 하나 안에서** 타석 셀 도출값 대 박스 컬럼 합계 | 집계·반올림 |
 * | `crosscheck` | **시즌 집계**(타율·출루율·장타율·방어율) 대 **NPB 공표표** | 경기 단위 토큰 해석 |
 *
 * **집계 층을 재는 외부 대조는 이것뿐이다.** 우리 산식으로 우리 산식을 재는 게 아니라
 * **외부 정답과 맞추는 것**이라 다른 시험이 대신 못 한다.
 *
 * ## 실측 (2026-08-27)
 *
 * | 시즌 | 선수 | 항목 | 결함 후보 |
 * |---|---:|---:|---:|
 * | 2023 | 920 | 16,484 | **0** |
 * | 2024 | 946 | 16,945 | **0** |
 * | 2025 | 973 | 17,428 | **0** |
 * | 2026 | 949 | 16,978 | **0** |
 *
 * 합계 **선수 3,788 · 항목 67,835 · 결함 후보 0**.
 * ⚠**게이트가 실제로 문다**: `batting_line` 한 행의 안타를 +5 하면 `EXIT=1` 이 되고
 * **결함 후보 4건**(타율·출루율·장타율·안타)이 잡힌다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const yml = readFileSync(join(ROOT, ".github", "workflows", "daily.yml"), "utf8");
/** ⚠주석을 코드로 읽지 않는다 — 값을 보는 단언은 전부 이쪽이다 */
const code = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
const tool = readFileSync(join(ROOT, "packages", "aggregate", "tools", "crosscheck.ts"), "utf8");

test("⚠외부 대조가 CI 에서 돈다 — 도구가 있다는 것과 도는 것은 다른 말이다", () => {
  assert.match(
    code,
    /packages\/aggregate\/tools\/crosscheck\.ts/,
    "crosscheck 가 워크플로에서 안 돈다 — 아카이브와 DB 가 함께 있는 곳은 여기뿐이다",
  );
});

/**
 * ⚠**배포보다 먼저 돌아야 한다.** 뒤에 두면 **공표값과 어긋난 수가 이미 화면으로 나간 뒤**에 안다.
 */
test("⚠외부 대조가 화면 생성보다 앞이다", () => {
  const cross = code.indexOf("crosscheck.ts");
  const build = code.indexOf("web/tools/build.ts");
  assert.ok(cross > 0 && build > 0, "두 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(cross < build, "외부 대조가 화면 생성 뒤다 — 어긋난 수가 먼저 나간다");
});

/**
 * ⚠**정답지가 낡으면 대조가 낡는다.** 공표표를 안 받으면 새로 들어온 경기는
 * **영영 외부와 맞춰지지 않는다** — 통과하지만 아무것도 안 재는 상태가 된다.
 */
test("⚠공표 성적표를 갱신한다 — 정답지가 낡으면 대조도 낡는다", () => {
  assert.match(code, /cli-stats\.ts/, "공표 성적표 갱신이 워크플로에 없다");
  const fetchAt = code.indexOf("cli-stats.ts");
  const crossAt = code.indexOf("crosscheck.ts");
  assert.ok(fetchAt > 0 && crossAt > 0, "두 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(fetchAt < crossAt, "정답지를 대조보다 나중에 받는다 — 그러면 그날 것은 안 쓰인다");
});

/**
 * ⚠**진행 중 시즌만 받는다.** 완결 시즌의 공표표는 더 이상 바뀌지 않으므로 다시 받는 것은
 * **L1 예산을 태우기만 한다**(시즌당 30페이지 · 1req/2~5초).
 * ⚠**연도는 JST 로 정한다**(§2-1) — UTC 로 세면 새해 첫날에 지난 시즌을 받는다.
 */
test("⚠공표표는 진행 중 시즌만 · 연도는 JST 로 정한다", () => {
  const line = code.split("\n").find((l) => l.includes("cli-stats.ts"));
  assert.notEqual(line, undefined, "cli-stats 줄을 못 찾았다 — 이 시험이 공회전한다");
  assert.match(line!, /--season/, "시즌을 안 준다 — 도구가 usage 를 내고 종료한다");
  assert.match(line!, /Asia\/Tokyo/, "연도를 JST 로 안 정한다 — 새해 첫날에 지난 시즌을 받는다");
});

/**
 * ⚠**화면이 쓰는 그 이름으로 짝짓는다**(M1).
 *
 * `player.display_name` 은 **「지금」의 이름**이고, 화면은 `player_season_name` 의
 * **그 시즌 이름**을 쓴다. 대조가 기본명을 쓰면 **같은 성이 여럿일 때 짝을 못 짓고**,
 * 그 선수들은 **아무 검증도 못 받은 채 「결함 0건」에 섞인다** — 통과하지만 안 재는 상태다.
 *
 * ⚠**커버리지가 조용히 준다**는 것이 이 시험의 요점이다. 실측(2026-08-28 · 기본명 → 시즌명):
 *
 * | 시즌 | 대조 선수 | 항목 | 우리쪽 미해결 |
 * |---|---|---|---|
 * | 2023 | 920 → **943** | 16,484 → **16,903** | 33 → **10** |
 * | 2024 | 946 → **968** | 16,945 → **17,348** | 30 → **8** |
 * | 2025 | 973 → **996** | 17,428 → **17,853** | 34 → **11** |
 * | 2026 | 971 → **972** | 17,363 → **17,397** | 30 → **6** |
 *
 * **결함 후보는 네 시즌 다 0건 그대로**다 — 새로 대조된 선수들도 전부 맞는다.
 * ⚠2026 은 시즌 표시명이 아직 덜 갈렸는지 개선 폭이 작다 — **시즌마다 다르다.**
 */
test("⚠대조가 화면과 같은 이름을 쓴다 — 기본명으로 되돌리면 커버리지가 조용히 준다", () => {
  assert.match(tool, /seasonNameExpr\("p"\)/, "시즌 표시명을 안 쓴다 — 같은 성이 여럿이면 짝을 못 짓는다");
  const joins = [...tool.matchAll(/seasonNameJoin\(/g)];
  assert.equal(joins.length, 2, `seasonNameJoin 이 ${joins.length}번이다 — 타격·투구 두 SQL 다 붙어야 한다`);
  assert.ok(
    !/SELECT p\.display_name AS name/.test(tool),
    "기본명으로 되돌아갔다 — 「지금」의 이름은 그 시즌의 이름이 아니다",
  );
});

/**
 * ⚠**결함이 있으면 실패로 나가야 한다.** 종료 코드가 결함 수를 안 보면
 * 「돌기는 도는데 아무것도 못 막는」 장치가 된다.
 */
test("⚠결함 후보가 있으면 종료 코드가 1 이다", () => {
  assert.match(
    tool,
    /process\.exit\(\s*real\.length\s*>\s*0\s*\?\s*1\s*:\s*0\s*\)/,
    "종료 코드가 결함 수를 안 본다 — 게이트가 아니다",
  );
});

/**
 * ⚠**공표값을 화면에 쓰지 않는다**(L6). 이 도구가 읽은 수치는 리포트에만 나오고,
 * 사이트가 내보내는 값은 언제나 우리가 계산한 것이다 — 그 경계가 무너지면 재배포 형태가 된다.
 */
test("⚠공표값은 리포트에만 — 화면 코드가 이 도구를 부르지 않는다", () => {
  const webUses = readFileSync(join(ROOT, "packages", "web", "src", "query.ts"), "utf8");
  assert.ok(!/crosscheck/.test(webUses), "화면 경로가 대조 도구를 부른다 — 공표값이 새어 나갈 자리다");
});
