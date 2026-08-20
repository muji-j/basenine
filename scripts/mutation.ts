/**
 * **뮤테이션 검사 한 벌**(작업규칙 9) — 「고치기 전 코드에서 이 시험이 정말 떨어지는가」.
 *
 * ⚠**초록은 그 자체로는 아무 말도 안 한다.** 이 저장소는 이미 한 번 데었다 —
 * 합성 픽스처에 타석 결과 칸이 0개여서 **구형 파서가 항상 빈 배열을 내도 전부 초록**이었다
 * (CLAUDE.md §2-2). 그래서 시험을 새로 넣을 때는 **일부러 틀리게 만들어 붉어지는지** 본다.
 *
 * ⚠**M1** — 검사 절차를 스크립트마다 복사하지 않는다. 부르는 쪽은 대상과 뮤테이션 목록만 준다.
 * ⚠**원본을 되돌리는 것이 이 파일의 절반이다** — 어떤 경로로 끝나도 되돌린다.
 * ⚠**FAIL 과 ERROR 를 가른다**(작업규칙 8) — 「떨어졌다」와 「돌지도 않았다」는 다른 사건이고,
 *   후자를 「잡았다」로 세면 검사가 통째로 거짓이 된다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface Mutation {
  /** 무엇을 틀리게 만드는가 — **사고의 이름**으로 적는다 */
  what: string;
  /** 바꿀 대상. 못 찾으면 **무효 뮤테이션**으로 세고 살아남은 것으로 친다 */
  from: string;
  to: string;
}

export interface MutationTarget {
  /** 뮤테이션을 넣을 파일(절대 경로) */
  src: string;
  /** 돌릴 시험 파일들(절대 경로) */
  tests: readonly string[];
  mutations: readonly Mutation[];
}

function names(tap: string): string[] {
  return [...tap.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]!.trim());
}

/** 시험을 돌린다. ⚠**DB 를 요구한다** — 없으면 건너뛴 것이 「0건 통과」로 읽힌다 */
function run(tests: readonly string[]): { failed: string[]; error: string | null } {
  try {
    const out = execFileSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], {
      encoding: "utf8",
      env: { ...process.env, BB_REQUIRE_DB: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { failed: names(out), error: null };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ""}`;
    const failed = names(out);
    if (failed.length === 0) return { failed: [], error: (e.stderr || out).slice(0, 400) };
    return { failed, error: null };
  }
}

/** @returns 살아남은(=잡히지 않은) 뮤테이션 수. **0이 아니면 그 시험은 그 사고를 못 잡는다** */
export function runMutations(target: MutationTarget): number {
  const original = readFileSync(target.src, "utf8");
  let survived = 0;
  try {
    const base = run(target.tests);
    if (base.error !== null) {
      console.error(`기준선이 ERROR 다 — 뮤테이션을 잴 수 없다:\n${base.error}`);
      return target.mutations.length;
    }
    if (base.failed.length > 0) {
      console.error(`기준선이 이미 붉다(${base.failed.length}본): ${base.failed.join(" / ")}`);
      return target.mutations.length;
    }
    console.log("기준선: FAIL 0 · ERROR 0");
    console.log("");

    for (const m of target.mutations) {
      if (!original.includes(m.from)) {
        console.log(`⚠ ${m.what}\n   → 대상 문자열을 못 찾았다. **뮤테이션이 무효다**(코드가 바뀌었으면 여기를 고쳐라)`);
        survived += 1;
        continue;
      }
      writeFileSync(target.src, original.replace(m.from, m.to), "utf8");
      const r = run(target.tests);
      if (r.error !== null) {
        // ⚠ERROR 는 「잡았다」가 아니다 — 시험이 아니라 로드가 죽은 것일 수 있다
        console.log(`◆ ${m.what}\n   → ERROR(시험이 돌지 않았다): ${r.error.split("\n")[0]}`);
        continue;
      }
      if (r.failed.length === 0) {
        console.log(`✖ ${m.what}\n   → **살아남았다. 이 시험은 이 사고를 못 잡는다**`);
        survived += 1;
        continue;
      }
      console.log(`✔ ${m.what}\n   → FAIL ${r.failed.length}본: ${r.failed.join(" / ")}`);
    }
  } finally {
    writeFileSync(target.src, original, "utf8");
  }
  console.log("");
  console.log(`뮤테이션 ${target.mutations.length}건 중 살아남음 **${survived}건**`);
  return survived;
}
