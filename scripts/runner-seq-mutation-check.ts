#!/usr/bin/env node
/**
 * **wSB 사유 시험이 정말 문서를 감시하는가**(작업규칙 9).
 *
 * 쓰는 법:  node scripts/runner-seq-mutation-check.ts
 *
 * ⚠**여기서 뮤테이션을 넣는 대상은 코드가 아니라 문서다.** 이 시험이 잡으려는 사고는
 * 「DB 는 그대로인데 문서만 거짓이 된 상태」이고, 그건 **타입도 린트도 못 잡는다.**
 * ⚠**특히 「초록인데 아무것도 안 재는」 상태를 확인한다** — 1,400줄 문서에서 `119` 같은
 * 짧은 수는 아무 데나 걸린다. 절 밖에 같은 수를 심어도 붉어져야 한다.
 */
import { fileURLToPath } from "node:url";
import { runMutations } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}docs/metrics/README.md`;
const TESTS = [`${ROOT}scripts/test/runner-seq.test.ts`];

const MUTATIONS: readonly Mutation[] = [
  {
    what: "① 합계를 한 자리 틀리게 적는다(220 → 221)",
    from: `| **이어 붙일 수 없거나 어긋남(합)** | **220** | **2.01%** |`,
    to: `| **이어 붙일 수 없거나 어긋남(합)** | **221** | **2.01%** |`,
  },
  {
    what: "② 비율만 틀리게 적는다(2.01% → 1.96% · 진행 중 시즌 값)",
    from: `| **220** | **2.01%** |`,
    to: `| **220** | **1.96%** |`,
  },
  {
    what: "③ 분모(주자 사건 수)를 옛 값으로 되돌린다(10,944 → 11,862)",
    from: `주자 사건 **10,944건**`,
    to: `주자 사건 **11,862건**`,
  },
  {
    what: "④ 「한 칸 밀림」 건수를 지운다",
    from: `**191건(91.4%)**`,
    to: `**대부분**`,
  },
  {
    what: "⑤ 이닝 어긋남을 틀리게 적는다(119 → 124) — **짧은 수라 절 밖 어디든 걸릴 수 있다**",
    from: `| 그중 이닝까지 다른 것 | 119 | 1.09% |`,
    to: `| 그중 이닝까지 다른 것 | 124 | 1.09% |`,
  },
  {
    what: "⑥ 사유 절을 통째로 지운다 — **사유가 사라지면 시험도 그렇게 말해야 한다**",
    from: `### ⚠wSB — 선행 결함이 있다 (2026-08-21 실측)`,
    to: `### wSB — (사유를 지웠다)`,
  },
];

process.exitCode = runMutations({ src: SRC, tests: TESTS, mutations: MUTATIONS }) === 0 ? 0 : 1;
