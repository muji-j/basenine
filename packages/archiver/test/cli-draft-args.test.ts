/**
 * `cli-draft.ts` 의 **인자 검사와 종료코드**.
 *
 * ⚠**이 파일은 import 할 수 없다** — top-level `parseArgs` 가 있어서 import 하는 순간
 * 시험 러너의 argv 를 읽고 `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` 로 죽는다(의도된 설계 ·
 * `draft.ts` 가 부를 수 있는 쪽이다). 그래서 **스폰해서 종료코드만 잰다.**
 *
 * ⚠**손으로 스모크한 것은 시험이 아니다.** 이 본들이 없으면 누가 `parseDelayMs` 를
 * `Number(values.delay)` 로 되돌려도 **아무것도 안 울린다** — 그리고 그 되돌림은
 * **예의가 조용히 사라지는** 바로 그 결함이다(L1).
 *
 * ⚠**외부 요청 0회다.** 아래 전건이 `PoliteFetcher` 를 만들기 **전에** `exit 2` 로 죽는
 * 경로다(진입점의 검사 순서: 연도 → 범위 → `--only` → 연락처 → `--delay` → deps 생성).
 * 그래서 픽스처도 가짜 fetch 도 필요 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli-draft.ts", import.meta.url));

/**
 * CLI 를 스폰해 종료코드와 stderr 를 돌려준다.
 *
 * ⚠**`BB_ARCHIVER_CONTACT` 를 지운다** — 개발자 셸에 그게 있으면 「연락처 없음」 본이
 * 조용히 통과해 **아무것도 안 재는 시험**이 된다.
 */
function runCli(args: readonly string[]): { status: number; stderr: string } {
  const env = { ...process.env };
  delete env["BB_ARCHIVER_CONTACT"];
  try {
    execFileSync(process.execPath, [CLI, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stderr?: string };
    // ⚠`status` 가 null 이면 시그널로 죽은 것이다 — 0 으로 뭉개지 않는다(M11)
    return { status: typeof e.status === "number" ? e.status : -1, stderr: e.stderr ?? "" };
  }
}

test("⚠연락처가 없으면 exit 2 — 연락처 없는 UA로 긁지 않는다(L1)", () => {
  const r = runCli(["--from", "2013", "--to", "2013"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /연락처/);
});

test("⚠`--delay` 가 수가 아니면 exit 2 — 오타가 간격 0이 되지 않는다(L1)", () => {
  const r = runCli(["--delay", "abc", "--contact", "me@example.com"]);
  assert.equal(r.status, 2, "⚠이게 0이면 `Number(\"abc\")` = NaN 이 그대로 나간 것이다");
  assert.match(r.stderr, /--delay/);
});

/**
 * ⚠**음수는 두 형태가 서로 다른 층에서 막힌다** — 둘 다 「막힌다」는 같지만 **누가 막는지가 다르다.**
 *
 * `--delay=-1` 은 우리 검사에 도달해 `exit 2`. 반면 **`--delay -1`(띄어쓰기)은
 * `parseArgs` 가 먼저** `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`(argument is ambiguous)로
 * 거부해 **잡히지 않은 예외 → `exit 1`** 이 된다 — `-1` 이 값인지 짧은 옵션인지 모호해서다.
 * ⚠**`exit 2` 로 못 박지 마라** — 그건 우리 코드가 아니라 Node 의 동작이고, 바뀌면
 * **우리 결함이 아닌 것으로 시험이 빨개진다.** 여기서 지킬 것은 **「어느 쪽도 조용히
 * 통과하지 않는다」**이지 특정 종료코드가 아니다.
 */
test("⚠음수 간격은 두 형태 다 거부된다 — 어느 쪽도 조용히 통과하지 않는다(L1)", () => {
  const explicit = runCli(["--delay=-1", "--contact", "me@example.com"]);
  assert.equal(explicit.status, 2, "우리 검사가 받는 형태다");
  assert.match(explicit.stderr, /--delay/);

  const spaced = runCli(["--delay", "-1", "--contact", "me@example.com"]);
  assert.notEqual(spaced.status, 0, "⚠0 이면 음수 간격으로 실사이트에 나간 것이다");
});

/**
 * ⚠**「유효하지만 위험한」 값도 막는다.**
 *
 * `--delay 500` 은 `NaN` 도 음수도 아니라 **문법적으로는 멀쩡하다.** 예전에는 경고 한 줄만
 * 찍고 **그대로 실사이트를 쳤다** — 오타로 인한 조용한 위반과 **결은 다르지만 정도만 다른
 * 같은 범주의 구멍**이다. L1(1req/2~5초)은 취향이 아니라 이 프로젝트의 규칙이고,
 * `fetcher.ts` 가 인용하는 岡崎 사건이 **1초 1요청 크롤러**에서 나온 일이다.
 */
test("⚠L1 하한 아래는 exit 2 — 경고만 하고 실사이트를 치지 않는다", () => {
  // ⚠⚠**이 본의 「빨간 상태」는 실제로 네트워크를 친다 — 그래서 범위를 묶어 둔다.**
  //   하한을 넣기 전에 이 본을 `--from 2005`(기본값)로 썼다가 **222페이지를 0.583초 간격으로
  //   실제로 받아 버렸다**(우리 사이드카 `fetchedAt` 실측 · 128.9초). L1 위반을 막는 시험이
  //   L1 을 위반한 것이다.
  //   `--from 2026 --to 2026` 은 개최 전 연도라 회귀해도 **색인 1 + 연도 톱 1 = 2요청**이 상한이다
  //   (`draftlist_*` 가 0건이라 3단계가 없다). ⚠**이 두 인자를 지우지 마라.**
  //   ⚠**진짜 방어는 `fetcher-archive.test.ts` 의 `parseDelayMs("500") === null` 이다** —
  //   그쪽은 스폰조차 안 한다. 이 본은 진입점까지 배선됐는지를 보는 2차 그물이다.
  const r = runCli(["--delay", "500", "--from", "2026", "--to", "2026", "--contact", "me@example.com"]);
  assert.equal(r.status, 2, "⚠0 이면 경고만 찍고 500ms 간격으로 나간 것이다");
  assert.match(r.stderr, /2000/);
});

test("⚠범위 밖 `--only` 는 exit 2 — 조용한 0건은 성공처럼 보이는 실패다", () => {
  const r = runCli(["--only", "2003", "--from", "2005", "--contact", "me@example.com"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /조용히 0건/);
});

test("⚠뒤집힌 범위는 exit 2", () => {
  assert.equal(runCli(["--from", "2020", "--to", "2010", "--contact", "me@example.com"]).status, 2);
});

test("⚠연도가 정수가 아니면 exit 2 — 「올해」로 메우지 않는다(M11)", () => {
  const r = runCli(["--from", "이천오년", "--contact", "me@example.com"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /정수/);
});
