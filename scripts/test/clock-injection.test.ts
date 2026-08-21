/**
 * **M6 — 시계는 주입받는다.** 그것을 **실제로 강제한다.**
 *
 * ⚠**CLAUDE.md 가 「린트로 강제한다」고 두 곳(M6 표 · §6 금지목록)에서 단언했는데
 * 린트가 없었다**(2026-08-21 실측: 린트 설정 파일 0개 · `package.json` 에 `lint` 스크립트 없음 ·
 * 소스를 훑는 시험도 0개). 규칙을 지키고 있었는지와 별개로 **문서가 없는 장치를 있다고 말하고 있었다.**
 * 이 시험이 그 단언을 참으로 만든다.
 *
 * ## 무엇을 금지하는가 — **인자 없는 호출만이다**
 *
 * `new Date()` 와 `Date.now()` 만 시계를 읽는다. **`new Date("2026-08-14")` 는 시계를 읽지 않는다** —
 * 주어진 문자열을 해석할 뿐이라 자정 경계와 무관하고, 금지하면 날짜 계산을 아예 못 한다.
 * ⚠**둘을 뭉뚱그리면 이 시험은 거짓말이 된다.**
 *
 * ## 왜 진입점은 예외인가
 *
 * 프로그램 어딘가에서는 **진짜 시계를 한 번 읽어야 한다.** M6 이 막는 것은
 * 「라이브러리가 몰래 시계를 읽는 것」이지 「시계가 존재하는 것」이 아니다.
 * 그래서 **`packages/<x>/src/**` 는 0건**이어야 하고(실측으로 이미 0건이다 —
 * `archiver/src/clock.ts` 하나만 예외), 진입점(`tools/` · `scripts/`)은 **목록에 적힌 만큼만** 허용한다.
 * ⚠**목록에 수를 적는 이유**: 새로 하나 더 부르면 **목록을 고쳐야 하고**, 고치는 순간
 * 「여기서 시계를 읽는 게 맞나」를 한 번 생각하게 된다. 파일 단위로만 허용하면 그 순간이 없다.
 *
 * ⚠**주석은 세지 않는다.** 이 저장소는 주석에서 `new Date()` 를 자주 인용한다
 * (「부르지 마라」라고 쓰려면 이름을 적어야 한다). 블록·행 주석을 걷어내고 센다 —
 * 그래서 **문자열 안의 `//` 뒤가 함께 지워질 수 있다.** 지워지면 **놓치는 쪽**으로 틀리므로,
 * 아래 「전체 합계」 단언이 그 미끄러짐을 잡는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP_DIR = new Set(["node_modules", "dist", ".git", "data", "coverage", ".claude"]);

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** 블록 주석과 행 주석을 걷어낸다. ⚠`://` 는 남긴다(URL 뒤가 통째로 지워지는 것을 줄인다) */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
}

/** ⚠**인자 없는 것만** — `new Date(iso)` 는 시계를 읽지 않는다 */
const CLOCK = /new\s+Date\s*\(\s*\)|Date\s*\.\s*now\s*\(\s*\)/g;

/**
 * 허용 목록. **파일 → 허용 건수.**
 *
 * ⚠**늘리기 전에 「여기서 진짜 시계를 읽어야 하나」를 먼저 물어라.**
 * 라이브러리(`packages/<x>/src/**`)라면 답은 거의 항상 **아니오**다 — `clock` 을 인수로 받아라.
 */
const ALLOWED: ReadonlyMap<string, number> = new Map([
  // **시계의 유일한 출처.** 이 파일이 곧 M6 그 자체다
  ["packages/archiver/src/clock.ts", 1],
  // 진입점(CLI). 적재 시각을 스탬프하려면 한 번은 진짜 시계를 읽어야 한다
  ["packages/store/tools/load-archive.ts", 1],
  ["packages/store/tools/load-players.ts", 1],
  ["packages/store/tools/load-starters.ts", 1],
  ["packages/store/tools/load-upcoming.ts", 1],
  ["packages/web/tools/marks.ts", 1],
  ["scripts/freshness.ts", 2],
  ["scripts/update.ts", 1],
  // 경과 시간 측정(성능). ⚠**날짜가 아니라 duration 이라 자정 경계와 무관하다**
  ["packages/web/test/client.test.ts", 2],
]);

test("⚠M6 — 시계를 직접 읽는 곳은 목록에 적힌 곳뿐이다", () => {
  const found = new Map<string, number>();
  const files = tsFiles(ROOT);
  assert.ok(files.length > 100, `훑은 파일이 ${files.length}개뿐이다 — 탐색이 망가졌다`);

  for (const p of files) {
    const n = stripComments(readFileSync(p, "utf8")).match(CLOCK)?.length ?? 0;
    if (n > 0) found.set(relative(ROOT, p).replace(/\\/g, "/"), n);
  }

  const problems: string[] = [];
  for (const [file, n] of [...found].sort()) {
    const limit = ALLOWED.get(file);
    if (limit === undefined) problems.push(`${file}: ${n}건 — 목록에 없다. clock 을 주입받아라(M6)`);
    else if (n > limit) problems.push(`${file}: ${n}건 (허용 ${limit}) — 늘었다`);
  }
  // ⚠**줄어든 것도 알린다** — 목록이 낡으면 다음 사람이 「여기는 원래 시계를 읽는다」고 오해한다
  for (const [file, limit] of [...ALLOWED].sort()) {
    const n = found.get(file) ?? 0;
    if (n < limit) problems.push(`${file}: ${n}건 (허용 ${limit}) — 줄었다. 목록을 줄여라`);
  }
  assert.deepEqual(problems, [], `시계를 직접 읽는 곳\n${problems.join("\n")}`);
});

/**
 * ⚠**라이브러리는 0건이어야 한다.** 위 목록이 느슨해지는 것을 따로 막는다 —
 * 진입점 예외를 핑계로 `src/` 에 시계가 스며드는 것이 M6 가 실제로 죽는 경로다.
 */
test("⚠M6 — 라이브러리 코드(`packages/*/src`)는 clock.ts 말고는 0건이다", () => {
  const bad: string[] = [];
  let scanned = 0;
  for (const p of tsFiles(join(ROOT, "packages"))) {
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (!/^packages\/[^/]+\/src\//.test(rel)) continue;
    scanned += 1;
    if (rel === "packages/archiver/src/clock.ts") continue;
    const n = stripComments(readFileSync(p, "utf8")).match(CLOCK)?.length ?? 0;
    if (n > 0) bad.push(`${rel}: ${n}건`);
  }
  assert.ok(scanned > 30, `훑은 라이브러리 파일이 ${scanned}개뿐이다 — 경로 규칙이 안 맞는다`);
  assert.deepEqual(bad, [], `라이브러리가 시계를 직접 읽는다 — clock 을 인수로 받아라(M6)\n${bad.join("\n")}`);
});

/**
 * ⚠**주석 제거가 코드를 먹어 「0건」이 되는 미끄러짐**을 잡는다.
 * 전체 합계가 실측치와 다르면 어느 쪽으로든 스캐너가 바뀐 것이다.
 */
test("⚠스캐너가 실제로 세고 있다 — 전체 합계", () => {
  let total = 0;
  for (const p of tsFiles(ROOT)) {
    total += stripComments(readFileSync(p, "utf8")).match(CLOCK)?.length ?? 0;
  }
  const want = [...ALLOWED.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, want, `시계 직접 호출 합계가 ${total}건 (목록 합계 ${want}건)`);
});
