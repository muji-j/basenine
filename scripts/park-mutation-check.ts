#!/usr/bin/env node
/**
 * **파크팩터·RPW 시험이 「고치기 전 코드」에서 실제로 떨어지는가**(작업규칙 9).
 *
 * 쓰는 법:  node scripts/park-mutation-check.ts
 *
 * ⚠**여기서 재현하는 것은 「이 산식이 막으려던 사고」다.** 실제로 이 도메인에서 나오는 것들이고,
 * 전부 **문법이 완벽하고 값만 틀린** 상태다 — 타입도 린트도 못 잡는다.
 * ⚠DB 가 필요하다(`BB_REQUIRE_DB=1`). 없으면 DB 시험이 건너뛰어져 「안 쟀음」이 「0건」으로 읽힌다.
 */
import { fileURLToPath } from "node:url";
import { runMutations } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}packages/metrics/src/park.ts`;
const TESTS = [`${ROOT}packages/metrics/test/park.test.ts`, `${ROOT}packages/metrics/test/park-db.test.ts`];

const MUTATIONS: readonly Mutation[] = [
  {
    what: "① 표본 0을 「평균(1.000)」으로 때운다 — **이 프로젝트에서 가장 위험한 한 줄**(M11)",
    from: `    value: p.value === null || b.value === null || b.value === 0 ? null : p.value / b.value,`,
    to: `    value: p.value === null || b.value === null || b.value === 0 ? 1 : p.value / b.value,`,
  },
  {
    what: "② RPW 에서 이닝 나눗셈을 뺀다(9를 1로) — 값이 3배가 된다",
    from: `export const INNINGS_PER_GAME = 9;`,
    to: `export const INNINGS_PER_GAME = 1;`,
  },
  {
    what: "③ RPW 의 제곱근을 뺀다",
    from: `    value: rpg.value === null ? null : 10 * Math.sqrt(rpg.value / INNINGS_PER_GAME),`,
    to: `    value: rpg.value === null ? null : 10 * (rpg.value / INNINGS_PER_GAME),`,
  },
  {
    what: "④ RPW 계수 10 을 9로 (한 자리 오타)",
    from: `    value: rpg.value === null ? null : 10 * Math.sqrt(rpg.value / INNINGS_PER_GAME),`,
    to: `    value: rpg.value === null ? null : 9 * Math.sqrt(rpg.value / INNINGS_PER_GAME),`,
  },
  {
    what: "⑤ 합산에서 경기 수를 안 더한다 — 분모가 조용히 작아진다",
    from: `  return parts.reduce<RunEnvironment>((a, b) => ({ runs: a.runs + b.runs, games: a.games + b.games }), {`,
    to: `  return parts.reduce<RunEnvironment>((a, b) => ({ runs: a.runs + b.runs, games: Math.max(a.games, b.games) }), {`,
  },
  {
    what: "⑥ 파크팩터의 분자·분모를 뒤집는다(기준선 ÷ 구장)",
    from: `? null : p.value / b.value,`,
    to: `? null : b.value / p.value,`,
  },
  {
    what: "⑦ 표본(games)을 안 나른다 — 분모 없는 비율이 된다(M2)",
    from: `    games: park.games,`,
    to: `    games: 0,`,
  },
  {
    what: "⑧ 기준선을 안 나른다 — PF 를 되짚을 수 없게 된다",
    from: `    baselineGames: baseline.games,`,
    to: `    baselineGames: 0,`,
  },
];

process.exitCode = runMutations({ src: SRC, tests: TESTS, mutations: MUTATIONS }) === 0 ? 0 : 1;
