/**
 * **설치 때 남의 코드를 도는 패키지가 무엇인가** — 목록으로 붙든다.
 *
 * ⚠**`npm ci` 는 `contents: write` 토큰과 Cloudflare 배포 토큰이 있는 같은 잡에서 돈다**
 * (2026-08-25 · 감사 P3 #16). 설치 스크립트는 그 프로세스에서 임의 코드를 실행한다 —
 * 액션을 커밋 SHA 로 고정한 것과 **같은 걱정**이고, tj-actions/changed-files 사건이 그 형태였다.
 *
 * ## ⚠`--ignore-scripts` 는 답이 아니다 — 실측으로 확인했다
 *
 * 도는 것은 **3개**이고 전부 `wrangler` 계열이다: `esbuild` 와 `workerd` 는
 * `postinstall` 로 **플랫폼 바이너리를 놓는다.** 끄면 **배포가 깨진다.**
 * (`fsevents` 는 macOS 전용 선택적 의존이라 우리 러너에서는 설치되지 않는다.)
 * ⚠**그래서 여기서 하는 것은 「끄는 것」이 아니라 「늘어나면 아는 것」이다.**
 * 새 이행 의존이 설치 스크립트를 갖고 들어오면 이 시험이 먼저 운다.
 *
 * ## ⚠세는 곳이 두 군데이고 답이 다르다
 *
 * `node_modules` 를 훑으면 **6개**가 나온다 — `prepare` 를 가진 것 셋이 더 걸리기 때문이다.
 * 그런데 `prepare` 는 **깃 의존에서만** 돌고 레지스트리 타르볼에서는 안 돈다.
 * **락파일의 `hasInstallScript` 가 정확한 답**이고, 그게 3이다.
 * ⚠**나는 처음에 6으로 셌다** — 지표가 질문에 답하는지 먼저 보라는 그 자리다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
  packages?: Record<string, { hasInstallScript?: boolean }>;
};

/**
 * ⚠**목록이지 「안전하다」가 아니다.** 늘리려면 **왜 이 패키지가 설치 때 코드를 돌아야 하는지**
 * 적어라. 「의존이 그렇다」는 사유가 아니다 — **무엇을 놓는지**를 적어라.
 */
const ALLOWED: readonly { pkg: string; why: string }[] = [
  { pkg: "node_modules/esbuild", why: "wrangler 가 쓰는 번들러 — postinstall 이 플랫폼 바이너리를 놓는다" },
  { pkg: "node_modules/workerd", why: "Cloudflare 런타임 — postinstall 이 플랫폼 바이너리를 놓는다" },
  { pkg: "node_modules/fsevents", why: "macOS 전용 선택적 의존 — 우리 러너(ubuntu)에는 설치되지 않는다" },
];

function withInstallScript(): string[] {
  const pk = lock.packages;
  assert.ok(pk !== undefined, "package-lock.json 에 packages 가 없다 — 이 시험이 공회전한다");
  return Object.entries(pk!).filter(([, v]) => v.hasInstallScript === true).map(([k]) => k).sort();
}

test("⚠락파일을 읽는 방식이 헛돌지 않는다", () => {
  const n = Object.keys(lock.packages ?? {}).length;
  assert.ok(n >= 50, `락파일 항목이 ${n}개뿐이다 — 이 시험이 공회전한다`);
  console.log(`  · 락파일 ${n}개 중 설치 스크립트 ${withInstallScript().length}개`);
});

test("⚠설치 때 코드를 도는 패키지는 목록뿐이다", () => {
  const known = ALLOWED.map((a) => a.pkg).sort();
  assert.deepEqual(
    withInstallScript(),
    known,
    "설치 스크립트를 가진 패키지가 달라졌다.\n" +
      "⚠**늘었다면**: 그 패키지가 설치 때 **무엇을 놓는지** 보고, 필요하면 ALLOWED 에 사유와 함께 적어라.\n" +
      "  이 스크립트는 `contents: write` 와 배포 토큰이 있는 잡에서 돈다(§0-9 공급망).\n" +
      "⚠**줄었다면**: 목록에서 빼라 — 사유만 남으면 낡은 주장이 된다.\n" +
      "⚠**`--ignore-scripts` 로 끄지 마라** — esbuild·workerd 가 플랫폼 바이너리를 못 놓아 배포가 깨진다.",
  );
});

/**
 * ⚠**`npm ci` 여야 한다.** `npm install` 은 락파일을 **고쳐 가며** 설치하므로
 * 「고정했다」가 성립하지 않는다 — 그 순간 위 목록도 의미를 잃는다.
 */
test("⚠워크플로가 npm ci 를 쓴다 — npm install 이면 고정이 아니다", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "daily.yml"), "utf8");
  const m = /run:\s*(npm\s+\S+[^\n]*)/.exec(yml);
  assert.notEqual(m, null, "daily.yml 에서 npm 실행 줄을 못 찾았다 — 이 시험이 공회전한다");
  assert.match(m![1]!, /^npm ci\b/, `npm ci 가 아니다: ${m![1]}`);
});
