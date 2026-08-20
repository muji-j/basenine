#!/usr/bin/env node
/**
 * **引き分け 시험이 「고치기 전 코드」에서 실제로 떨어지는가**(작업규칙 9).
 *
 * 쓰는 법:  node scripts/draw-mutation-check.ts
 *
 * ⚠**①이 이번에 고친 그 결함이다.** 보유 9시즌에서 `inningUnknown` 은 **전 대회 0건**이라
 * 지금은 값이 안 바뀐다 — 그래서 **시험이 없으면 되돌아가도 아무도 모른다.**
 */
import { fileURLToPath } from "node:url";
import { runMutations } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}packages/aggregate/src/draw.ts`;
const TESTS = [`${ROOT}packages/aggregate/test/draw.test.ts`];

const MUTATIONS: readonly Mutation[] = [
  {
    what: "① 연장 진입률의 분모에 이닝 미상을 다시 넣는다 — **고치기 전 코드**",
    from: `  return rate(l.extra, l.games - l.inningUnknown);`,
    to: `  return rate(l.extra, l.games);`,
  },
  {
    what: "② 무승부율의 분모에서도 이닝 미상을 뺀다 — **반대 방향의 과잉 수정**",
    from: `export function drawRate(l: Pick<SeasonDrawLine, "draws" | "games">): Rate {
  return rate(l.draws, l.games);`,
    to: `export function drawRate(l: Pick<SeasonDrawLine, "draws" | "games" | "inningUnknown">): Rate {
  return rate(l.draws, l.games - l.inningUnknown);`,
  },
  {
    what: "③ 이닝 미상을 9회로 때운다(M11) — 「모른다」가 「9회로 끝났다」가 된다",
    from: `       SUM(CASE WHEN lastInning IS NULL THEN 1 ELSE 0 END) AS inningUnknown,`,
    to: `       0 AS inningUnknown,`,
  },
  {
    what: "④ 연장 판정을 `>=` 로 바꾼다 — 9회 경기가 전부 연장이 된다",
    from: `       SUM(CASE WHEN lastInning > ${"${REGULATION_INNINGS}"} THEN 1 ELSE 0 END) AS extra,`,
    to: `       SUM(CASE WHEN lastInning >= ${"${REGULATION_INNINGS}"} THEN 1 ELSE 0 END) AS extra,`,
  },
];

process.exitCode = runMutations({ src: SRC, tests: TESTS, mutations: MUTATIONS }) === 0 ? 0 : 1;
