/**
 * **워크플로가 애초에 돌 수 있는가.**
 *
 * ⚠**이 시험이 없어서 P0 둘이 통과했다**(2026-09-09 · 이중 검토). `heartbeat.yml` 이
 * **매 실행 `SyntaxError` 로 죽는 상태**로 커밋됐고, 시험 **2,697본이 하나도 못 잡았다** —
 * 판정 함수만 재고 **「그 함수가 CI 에서 한 줄이라도 실행되는가」는 아무도 안 봤기** 때문이다.
 *
 * ## 잡은 것 둘 (검토자 둘이 각각 재현했다)
 *
 * 1. **`sparse-checkout` 이 루트를 안 가져온다.** 비-cone 모드는 gitignore 식 패턴이라
 *    **루트 파일이 자동 포함되지 않는다** → `package.json` 이 없다 → 그 안의 `"type": "module"` 이
 *    사라져 Node 가 `.ts` 를 **CommonJS 로** 읽는다 → `SyntaxError: Unexpected token 'export'`.
 *    ⚠**「받는 것이 적을수록 덜 깨진다」는 최적화가 바로 깨뜨렸다.**
 * 2. **`permissions:` 를 하나라도 적으면 안 적은 것은 전부 `none` 이다**(GitHub 문서 원문:
 *    「If you specify the access for any of these permissions, all of those that are not specified
 *    are set to `none`」). `contents` 를 안 적고 `actions/checkout` 을 쓰면 체크아웃이 막힌다.
 *
 * ⚠**둘 다 「조용한 고장」이 아니라 「영구 거짓 경보」다** — 감시 장치에서는 그쪽이 더 나쁘다.
 * 매번 실패하는 메일은 곧 무시되고, **진짜 정지가 왔을 때 그 메일과 구별되지 않는다.**
 *
 * ⚠**이 시험은 YAML 을 글자로 읽는다.** 실제 러너에서 돌려 보는 것과는 다르다 —
 * **「이 모양이면 확실히 깨진다」를 막을 뿐 「이 모양이면 확실히 돈다」를 보장하지 않는다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

interface Workflow {
  name: string;
  text: string;
  /** 주석을 코드로 읽지 않는다 — 이 저장소가 반복해 데인 모양이다 */
  code: string;
}

const WORKFLOWS: Workflow[] = FILES.map((name) => {
  const text = readFileSync(join(DIR, name), "utf8");
  return { name, text, code: text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n") };
});

test("⚠워크플로를 실제로 읽고 있다 — 못 읽으면 아래 시험이 전부 공회전한다", () => {
  assert.ok(WORKFLOWS.length >= 3, `워크플로를 ${String(WORKFLOWS.length)}개밖에 못 찾았다: ${FILES.join(" ")}`);
  assert.ok(
    WORKFLOWS.some((w) => w.name === "heartbeat.yml"),
    `heartbeat.yml 을 못 찾았다: ${FILES.join(" ")}`,
  );
});

/**
 * ⚠**`permissions:` 를 적었으면 `contents` 를 빠뜨리지 마라.**
 * 체크아웃을 쓰는데 `contents` 가 없으면 그 값은 `none` 이고 체크아웃이 막힌다.
 */
test("⚠체크아웃을 쓰는 워크플로는 contents 권한을 적는다 — 안 적으면 none 이다", () => {
  const bad: string[] = [];
  for (const w of WORKFLOWS) {
    if (!/uses:\s*actions\/checkout/.test(w.code)) continue;
    // `permissions:` 를 아예 안 적었으면 기본값이 넉넉하므로 이 검사의 대상이 아니다
    if (!/^\s*permissions:/m.test(w.code)) continue;
    if (!/^\s*contents:\s*(read|write)\s*$/m.test(w.code)) bad.push(w.name);
  }
  assert.deepEqual(
    bad,
    [],
    "체크아웃을 쓰는데 contents 권한이 없다 — permissions 를 적으면 안 적은 것은 전부 none 이다",
  );
});

/**
 * ⚠**`.ts` 를 직접 실행하는데 `package.json` 이 없으면 CommonJS 로 읽혀 죽는다.**
 * `sparse-checkout` 으로 일부만 받으면 루트가 빠질 수 있다 —
 * **비-cone 모드는 루트 파일을 자동 포함하지 않는다.**
 */
test("⚠.ts 를 직접 실행하는 워크플로는 package.json 이 딸려 오게 한다", () => {
  const bad: string[] = [];
  for (const w of WORKFLOWS) {
    if (!/\bnode\b[^\n]*\.ts\b/.test(w.code)) continue;
    if (!/sparse-checkout:/.test(w.code)) continue; // 통짜 체크아웃이면 루트가 온다
    const nonCone = /sparse-checkout-cone-mode:\s*false/.test(w.code);
    const hasPkg = /sparse-checkout:[\s\S]{0,200}?package\.json/.test(w.code);
    if (nonCone && !hasPkg) bad.push(w.name);
  }
  assert.deepEqual(
    bad,
    [],
    "비-cone sparse-checkout 으로 .ts 를 실행한다 — 루트 package.json 이 안 와서\n"
      + '  `"type": "module"` 이 사라지고 SyntaxError 로 매 실행 죽는다',
  );
});

/**
 * ⚠**감시기를 취소하지 마라.** 취소된 실행은 결론이 `cancelled` 라 **실패 메일이 안 간다** —
 * 경보를 켜려고 만든 장치가 조용히 꺼지는 모양이다.
 */
test("⚠하트비트는 진행 중 실행을 취소하지 않는다 — 취소되면 알림이 안 간다", () => {
  const hb = WORKFLOWS.find((w) => w.name === "heartbeat.yml");
  assert.ok(hb, "heartbeat.yml 이 없다");
  assert.match(
    hb.code,
    /cancel-in-progress:\s*false/,
    "감시기에 cancel-in-progress: true 가 걸려 있다 — 취소는 실패 메일을 보내지 않는다",
  );
});

/** 워크플로가 실제로 그 스크립트를 부르는가 — 「도구가 있다」와 「그것이 돈다」는 다른 말이다 */
test("⚠하트비트가 실제로 판정 스크립트를 부른다", () => {
  const hb = WORKFLOWS.find((w) => w.name === "heartbeat.yml");
  assert.ok(hb, "heartbeat.yml 이 없다");
  assert.match(hb.code, /node\s+scripts\/heartbeat\.ts/, "판정 스크립트를 안 부른다");
  assert.match(hb.code, /GH_TOKEN:/, "토큰을 안 넘긴다 — 스크립트가 첫 줄에서 실패한다");
  assert.match(hb.code, /REPO:/, "저장소를 안 넘긴다");
});
