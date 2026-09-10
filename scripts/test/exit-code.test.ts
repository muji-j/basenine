/**
 * **`fetch` 를 쓴 스크립트가 종료 코드를 잃지 않는가.**
 *
 * ⚠**`fetch` 를 쓴 뒤 `process.exit()` 을 부르면 Windows 에서 죽는다**(2026-09-10 실측).
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c` 가 터지고
 * **종료 코드가 127** 이 된다 — 우리가 세운 0/1 이 **뜻을 잃는다.**
 *
 * ⚠**원인을 좁게 적지 마라**(이것도 한 번 틀렸다). 처음엔 「실패한 fetch 의 `AbortSignal.timeout`
 * 타이머 때문」이라고 적었는데, **`AbortSignal` 없이도 · 성공한 fetch 만으로도 재현된다**(실측 3/3).
 * 원인은 그 타이머가 아니라 **연결·소켓 핸들이 정리되기 전에 강제 종료**하는 것이다.
 * **「타임아웃만 안 쓰면 안전하다」는 오독이 그 좁은 서술에서 나온다.**
 *
 * ## ⚠왜 저장소 전체 규칙인가
 *
 * 처음엔 이 검사를 `heartbeat.ts` 에만 붙였다. 그러자 검수가 **`verify-deploy.ts` 에 같은 결함이
 * 그대로 남아 「기준이 두 벌」이 됐다**고 잡았다 — 그쪽은 `AbortSignal` 조차 안 써서 더 취약했다.
 * 그리고 `access-config.ts` 는 **처음부터 `exitCode` 를 쓰고 있었다.**
 * → **셋 중 둘만 맞고 하나가 틀린 상태**였고, 한 파일에 붙인 검사는 그것을 못 본다.
 *
 * ⚠**CI 는 ubuntu 라 프로덕션은 안 깨졌다.** 깨지는 것은 **로컬에서 돌리는 사람**이고,
 * 그래서 **조용하다** — 이 저장소가 반복해 데인 모양이다.
 *
 * ## 이 검사의 한계
 *
 * ⚠**글자로 읽는다.** `process["exit"](1)` 이나 `import { exit } from "node:process"` 같은
 * **우회 호출은 못 잡는다.** 막는 것은 **직진 회귀**뿐이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Script {
  name: string;
  /** 주석을 코드로 읽지 않는다 — 이 저장소가 반복해 데인 모양이다 */
  code: string;
}

const ALL: Script[] = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith(".ts"))
  .map((name) => {
    const raw = readFileSync(join(SCRIPTS, name), "utf8");
    return {
      name,
      code: raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " "),
    };
  });

/** `fetch(` 를 실제로 부르는 스크립트 */
const FETCHERS = ALL.filter((s) => /\bfetch\s*\(/.test(s.code));

test("⚠fetch 를 쓰는 스크립트를 실제로 찾고 있다 — 못 찾으면 아래 시험이 공회전한다", () => {
  assert.ok(
    FETCHERS.length >= 3,
    `fetch 를 쓰는 스크립트를 ${String(FETCHERS.length)}개밖에 못 찾았다: ${ALL.map((s) => s.name).join(" ")}`,
  );
  for (const want of ["heartbeat.ts", "verify-deploy.ts", "access-config.ts"]) {
    assert.ok(
      FETCHERS.some((s) => s.name === want),
      `${want} 를 못 찾았다 — 목록이 낡았거나 정규식이 헛돈다`,
    );
  }
});

test("⚠fetch 를 쓰는 스크립트는 process.exit 을 부르지 않는다 — 종료 코드가 뜻을 잃는다", () => {
  const bad = FETCHERS.filter((s) => /process\.exit\s*\(/.test(s.code)).map((s) => s.name);
  assert.deepEqual(
    bad,
    [],
    "fetch 를 쓰고 process.exit() 을 부른다 — Windows 에서 libuv 단언이 터져 exit 127 이 된다.\n"
      + "  `process.exitCode = ...` 를 쓰고 Node 가 스스로 끝나게 하라",
  );
});

test("⚠그 스크립트들이 종료 코드를 실제로 세운다 — 안 세우면 언제나 0 이다", () => {
  const bad = FETCHERS.filter((s) => !/process\.exitCode\s*=/.test(s.code)).map((s) => s.name);
  assert.deepEqual(
    bad,
    [],
    "fetch 를 쓰면서 종료 코드를 안 세운다 — 실패해도 0 으로 끝나 아무도 모른다",
  );
});
