/**
 * **파서 자기 검증이 실제로 돌고 있는가.**
 *
 * ⚠**이 저장소에서 가장 강한 종류의 대조인데 어디서도 안 돌고 있었다**(2026-08-26 · 감사 [2]).
 * 박스스코어는 `打数`·`安打`·`打点` 를 **컬럼으로도 주고 타석 셀로도** 준다 —
 * 우리가 셀에서 도출한 값이 npb.jp 합계와 어긋나면 **토큰 해석이 틀린 것**이다.
 * **우리 산식으로 우리 산식을 재는 게 아니라 외부 정답과 맞추는 것**이라 다른 시험이 대신 못 한다.
 *
 * ⚠**「있는데 안 도는 장치」는 이 저장소의 반복 병이다** — M6 린트 · 走塁 규칙 ·
 * 「연 1회 재조사」 · 흡수된 백필 삭제. **도구가 있다는 것과 그것이 돈다는 것은 다른 말이다.**
 * 그래서 여기서 지키는 것은 도구의 정확성이 아니라 **배선**이다.
 *
 * ## 실측 (2026-08-26 · 9시즌)
 *
 * 성립 경기 **7,518** · 타자 행 **211,862** · 파싱 오류 **0** · 미해석 토큰 **0종** ·
 * 투수 컬럼 교차 **0건 / 15,036팀** · 타격 불일치 **1건**(전부 알려진 출처 불일치) ·
 * 실행 시간 **1분 12초**.
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
const tool = readFileSync(join(ROOT, "packages", "parser", "tools", "sweep-archive.ts"), "utf8");

test("⚠파서 자기 검증이 CI 에서 돈다 — 도구가 있다는 것과 도는 것은 다른 말이다", () => {
  assert.match(
    code,
    /node packages\/parser\/tools\/sweep-archive\.ts/,
    "sweep-archive 가 워크플로에서 안 돈다 — 아카이브가 있는 곳은 여기뿐이다",
  );
});

/**
 * ⚠**배포보다 먼저 돌아야 한다.** 뒤에 두면 **잘못 읽은 수가 이미 화면으로 나간 뒤**에 알게 된다.
 */
test("⚠자기 검증이 화면 생성보다 앞이다", () => {
  const sweep = code.indexOf("sweep-archive.ts");
  const build = code.indexOf("web/tools/build.ts");
  assert.ok(sweep > 0 && build > 0, "두 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(sweep < build, "자기 검증이 화면 생성 뒤다 — 잘못 읽은 수가 먼저 나간다");
});

/**
 * ⚠**개수 임계가 아니라 이름이어야 한다.** 「1건까지 허용」으로 두면 **다른 행이 어긋나도**
 * 개수가 같아서 통과한다 — 그건 검사가 아니라 눈감기다.
 */
test("⚠알려진 불일치는 개수가 아니라 이름으로 면제한다", () => {
  assert.match(tool, /const KNOWN\b/, "면제 목록이 없다");
  assert.match(tool, /keyOf/, "이름으로 대조하는 열쇠가 없다");
  assert.ok(
    !/mismatches\.length\s*(<=|<|>)\s*\d/.test(tool),
    "불일치를 개수로 비교한다 — 다른 행이 어긋나도 통과한다",
  );
});

/**
 * ⚠**목록에 적는 것은 사유가 있어야 한다** — 「아마 괜찮다」는 사유가 아니다.
 *
 * ⚠**첫 판이 엉뚱한 것을 집었다**(2026-08-26): `{` 뒤에 `field:` 가 오는 모양으로 찾았더니
 * `interface Mismatch` **본문**까지 걸렸다(거기엔 `why` 가 없으니 당연히 떨어진다).
 * **범위를 `KNOWN` 배열 안으로 좁힌다** — 지표가 질문에 답하는지 먼저 봐야 한다.
 */
test("⚠면제 항목마다 사유가 붙어 있다", () => {
  const arr = /const KNOWN[^=]*=\s*\[([\s\S]*?)\n\];/.exec(tool);
  assert.notEqual(arr, null, "KNOWN 배열을 못 찾았다 — 이 시험이 공회전한다");
  const entries = [...arr![1]!.matchAll(/\{[\s\S]*?\n  \}/g)].map((m) => m[0]);
  assert.ok(entries.length >= 1, `면제 항목을 ${entries.length}개 찾았다 — 이 시험이 공회전한다`);
  const noWhy = entries.filter((e) => !/why:/.test(e));
  assert.deepEqual(noWhy, [], "사유(why) 없는 면제가 있다 — 왜 우리 결함이 아닌지 적어라");
  console.log(`  · 면제 ${entries.length}건 · 전부 사유 있음`);
});

/**
 * ⚠**새 불일치·미해석 토큰·파싱 오류는 반드시 실패**여야 한다.
 * 그때는 우리 파서가 틀렸을 수 있고 자동으로 판정할 방법이 없다 — **모르면 멈춘다**(M7).
 */
test("⚠새 불일치와 미해석 토큰은 실패로 나간다", () => {
  const exit = /process\.exitCode\s*=([\s\S]*?);/.exec(tool);
  assert.notEqual(exit, null, "종료 코드 판정을 못 찾았다 — 이 시험이 공회전한다");
  for (const must of ["parseErrors", "unknownTokens", "fresh", "stale", "pitcherMismatches"]) {
    assert.ok(exit![1]!.includes(must), `종료 판정이 ${must} 를 안 본다`);
  }
});

/** ⚠**사유만 남고 대상이 없어도 실패**한다 — 낡은 면제는 다음 사람을 속인다 */
test("⚠고쳐진 면제를 방치하지 않는다", () => {
  assert.match(tool, /const stale = KNOWN\.filter/, "낡은 면제를 찾는 곳이 없다");
});
