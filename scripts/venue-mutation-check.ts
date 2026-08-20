#!/usr/bin/env node
/**
 * **구장 시험이 「고치기 전 코드」에서 실제로 떨어지는가**(작업규칙 9 — 뮤테이션 검사).
 *
 * ⚠**초록은 그 자체로는 아무 말도 안 한다.** 이 저장소는 이미 한 번 데었다 —
 * 합성 픽스처에 타석 결과 칸이 0개여서 **구형 파서가 항상 빈 배열을 내도 전부 초록**이었다
 * (CLAUDE.md §2-2). 그래서 시험을 새로 넣을 때는 **일부러 틀리게 만들어 붉어지는지** 본다.
 *
 * 쓰는 법:  node scripts/venue-mutation-check.ts
 *
 * ⚠**원본을 되돌리는 것이 이 스크립트의 절반이다** — 어떤 경로로 끝나도 되돌린다.
 * ⚠DB 가 필요하다(`BB_REQUIRE_DB=1` 로 돌린다). 없으면 DB 시험이 건너뛰어져
 *   「안 쟀음」이 「0건」으로 읽힌다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}packages/domain/src/venues.ts`;
const TESTS = [`${ROOT}packages/domain/test/venues.test.ts`, `${ROOT}packages/domain/test/venues-db.test.ts`];

interface Mutation {
  /** 무엇을 틀리게 만드는가 */
  what: string;
  from: string;
  to: string;
}

/**
 * ⚠**「이 표가 막으려던 사고」를 하나씩 재현한다.** 문법 오류를 넣는 것은 뮤테이션이 아니다 —
 * 그건 타입체커가 잡는 것이고, 우리가 묻는 것은 **문법이 완벽하고 사실만 틀린 상태**다.
 */
const MUTATIONS: readonly Mutation[] = [
  {
    what: "① 개명을 다른 건물로 쪼갠다(ヤフオクドーム 를 별도 건물로) — 소프트뱅크 홈이 둘이 된다",
    from: `      { name: "ヤフオクドーム", firstSeen: 2018, supersededAfter: 2019 },\n`,
    to: `    ],\n    homes: [{ team: "h", kind: "primary", since: 2020, until: null }],\n  },\n  {\n    id: "yahuoku-dome",\n    display: "ヤフオクドーム",\n    names: [{ name: "ヤフオクドーム", firstSeen: 2018, supersededAfter: 2019 }],\n    homes: [{ team: "h", kind: "primary", since: 2018, until: 2019 }],\n  },\n  {\n    id: "fukuoka-dome-2",\n    display: "みずほPayPay",\n    names: [\n`,
  },
  {
    what: "② 다른 건물을 합친다(札幌ドーム 를 エスコンＦ 의 별칭으로) — 2.3%p 가 뭉개진다",
    from: `    names: [{ name: "札幌ドーム", firstSeen: 2018, supersededAfter: null }],`,
    to: `    names: [],`,
  },
  {
    what: "③ 구장 하나를 표에서 지운다(函館 · 중지 경기에만 있는 것)",
    from: `  away("hakodate", "函館", 2018),`,
    to: ``,
  },
  {
    what: "④ 있지도 않은 구장을 표에 넣는다(오타)",
    from: `  away("iwaki", "いわき", 2026),`,
    to: `  away("iwaki", "いわき", 2026),\n  away("iwaki-typo", "いわきグリーン", 2026),`,
  },
  {
    what: "⑤ 구단 이전을 표에 안 반영한다(日本ハム 를 계속 札幌ドーム 로)",
    from: `    homes: [{ team: "f", kind: "primary", since: 2018, until: 2022 }],`,
    to: `    homes: [{ team: "f", kind: "primary", since: 2018, until: null }],`,
  },
  {
    what: "⑥ 제2 홈구장을 지운다(阪神 京セラ) — 「20경기 이하는 지방개최」와 같은 결과",
    from: `      { team: "t", kind: "secondary", since: 2018, until: null },`,
    to: ``,
  },
  {
    what: "⑦ 임시 대체를 홈구장으로 승격한다(2021 DeNA 의 東京ドーム)",
    from: `      { team: "f", kind: "secondary", since: 2018, until: 2022 },`,
    to: `      { team: "f", kind: "secondary", since: 2018, until: 2022 },\n      { team: "db", kind: "secondary", since: 2021, until: 2021 },`,
  },
  {
    what: "⑧ 개명 시점을 틀리게 적는다(メットライフ 가 2018 에 끝났다)",
    from: `      { name: "メットライフ", firstSeen: 2018, supersededAfter: 2021 },`,
    to: `      { name: "メットライフ", firstSeen: 2018, supersededAfter: 2018 },`,
  },
  {
    what: "⑨ `firstSeen` 을 틀리게 적는다(熊本 을 정규·실시 기준 2019 로) — 처음에 내가 낸 실수",
    from: `  away("kumamoto", "熊本", 2018),`,
    to: `  away("kumamoto", "熊本", 2019),`,
  },
  {
    /**
     * ⚠**지우는 것이 아니라 진짜로 합친다** — `山形` 을 `yamagata-shi` 의 별칭으로 옮긴다.
     * 지우기만 하면 「모르는 문자열」이 되어 다른 이유로 붉어지고, 그건 이 질문의 답이 아니다.
     */
    what: "⑩ 미확인을 확정으로 바꾼다(山形 을 山形市 의 별칭으로 합친다)",
    from: `  { ...away("yamagata", "山形", 2022), note: "⚠\`yamagata-shi\` 와 같은 건물인지 **미확인**. 합치지 않았다" },\n  { ...away("yamagata-shi", "山形市", 2018), note: "⚠\`yamagata\` 와 같은 건물인지 **미확인**. 합치지 않았다" },`,
    to: `  {\n    id: "yamagata-shi",\n    display: "山形市",\n    names: [\n      { name: "山形市", firstSeen: 2018, supersededAfter: null },\n      { name: "山形", firstSeen: 2022, supersededAfter: null },\n    ],\n    homes: [],\n  },`,
  },
];

const original = readFileSync(SRC, "utf8");

/** 시험을 돌린다. **떨어진 시험의 이름**을 돌려준다(FAIL 과 ERROR 를 가른다 — 작업규칙 8) */
function run(): { failed: string[]; error: string | null } {
  try {
    const out = execFileSync(
      process.execPath,
      ["--test", "--test-reporter=tap", ...TESTS],
      { encoding: "utf8", env: { ...process.env, BB_REQUIRE_DB: "1" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { failed: names(out), error: null };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    const out = `${e.stdout ?? ""}`;
    const failed = names(out);
    // ⚠**떨어진 시험이 하나도 없는데 종료 코드가 0이 아니면 그건 ERROR** — 「돌지도 않았다」
    if (failed.length === 0) return { failed: [], error: (e.stderr || out).slice(0, 400) };
    return { failed, error: null };
  }
}

function names(tap: string): string[] {
  return [...tap.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]!.trim());
}

let survived = 0;
try {
  const base = run();
  if (base.error !== null) {
    console.error(`기준선이 ERROR 다 — 뮤테이션을 잴 수 없다:\n${base.error}`);
    process.exit(1);
  }
  if (base.failed.length > 0) {
    console.error(`기준선이 이미 붉다(${base.failed.length}본): ${base.failed.join(" / ")}`);
    process.exit(1);
  }
  console.log(`기준선: FAIL 0 · ERROR 0`);
  console.log("");

  for (const m of MUTATIONS) {
    if (!original.includes(m.from)) {
      console.log(`⚠ ${m.what}\n   → 대상 문자열을 못 찾았다. **뮤테이션이 무효다**(코드가 바뀌었으면 여기를 고쳐라)`);
      survived += 1;
      continue;
    }
    writeFileSync(SRC, original.replace(m.from, m.to), "utf8");
    const r = run();
    if (r.error !== null) {
      // ⚠ERROR 는 「잡았다」가 아니다 — 시험이 아니라 로드가 죽은 것일 수 있다. 따로 적는다
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
  writeFileSync(SRC, original, "utf8");
}

console.log("");
console.log(`뮤테이션 ${MUTATIONS.length}건 중 살아남음 **${survived}건**`);
process.exitCode = survived === 0 ? 0 : 1;
