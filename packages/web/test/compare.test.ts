/**
 * 선수 비교.
 *
 * ⚠**여기서 지키는 것은 「값이 맞는가」가 아니라 「언제 우열을 말하지 않는가」다.**
 * 값은 선수 페이지와 같은 객체에서 나오므로 틀릴 여지가 적다. 반대로 승자 표시는
 * 이 화면이 **새로 만들어내는 주장**이라, 붙이면 안 되는 자리에 붙는 것이 유일한 큰 위험이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betterSide, compareCard, compareCardJson, renderComparePage } from "../src/compare.ts";
import type { CompareStat } from "../src/compare.ts";
import { CLIENT_JS } from "../src/assets.ts";
import { GLOSSARY } from "../src/glossary.ts";
import { SCALES } from "../src/grade.ts";
import {
  battingBlock,
  context,
  mixedPitchingBlock,
  pitcherMark,
  pitchingBlock,
  playerPage,
} from "./fixtures.ts";

function stat(over: Partial<CompareStat> = {}): CompareStat {
  return { k: "avg", l: "打率", v: ".300", d: "400打数", g: null, dir: 1, n: 0.3, s: 400, min: 50, ...over };
}

const BATTER = playerPage();
const PITCHER = playerPage({
  role: "pitcher",
  batting: null,
  pitching: pitchingBlock(),
  mark: pitcherMark(),
  streaks: null,
});

test("큰 쪽이 좋은 지표는 큰 값이 이긴다", () => {
  assert.equal(betterSide(stat({ n: 0.32 }), stat({ n: 0.28 })), "a");
  assert.equal(betterSide(stat({ n: 0.28 }), stat({ n: 0.32 })), "b");
});

test("작은 쪽이 좋은 지표는 작은 값이 이긴다 — 방향을 놓치면 좋은 투수가 지는 표가 된다", () => {
  const era = (n: number): CompareStat =>
    stat({ k: "era", l: "防御率", dir: -1, n, s: 300, min: 90 });
  assert.equal(betterSide(era(2.4), era(3.9)), "a");
  assert.equal(betterSide(era(3.9), era(2.4)), "b");
});

test("⚠표본이 최소치에 못 미치면 우열을 말하지 않는다 — 이 화면 최대의 함정", () => {
  // 20타석 .400 대 500타석 .300. 값만 보면 앞쪽이 이긴다
  const thin = stat({ n: 0.4, s: 20 });
  const thick = stat({ n: 0.3, s: 500 });
  assert.equal(betterSide(thin, thick), null, "얇은 표본이 이겼다 — M2 위반");
  assert.equal(betterSide(thick, thin), null, "반대 방향에서도 막아야 한다");
});

test("한쪽만 얇아도 말하지 않는다 — 이긴 쪽이 두꺼워도 근거는 양쪽이 필요하다", () => {
  assert.equal(betterSide(stat({ n: 0.32, s: 500 }), stat({ n: 0.28, s: 10 })), null);
});

/**
 * ⚠**선발과 구원은 최소 표본이 다르다**(90아웃 vs 60아웃). 상대에게 내 기준을 대면
 * 「자기 기준으로는 표본 미달이라 등급 색도 없는 선수」에게 패배 표시만 붙는다.
 * 그리고 `入れかえ` 버튼 한 번에 판정이 뒤집힌다 — 화면이 스스로 모순된다.
 *
 * ⚠**서버·클라 대조 테스트가 이걸 못 잡았다.** 두 구현이 **같은 방식으로** 틀렸기 때문이다.
 * 대조는 「두 벌이 어긋나는 것」을 잡지 「둘 다 틀린 것」은 못 잡는다 —
 * 그래서 `min`이 서로 다른 케이스를 여기서 따로 고정한다.
 * (2026-08-16 이중 검토에서 지적.)
 */
test("⚠최소 표본은 각자 자기 것으로 잰다 — 남의 기준을 대면 入れかえ로 판정이 뒤집힌다", () => {
  const reliever = stat({ k: "era", dir: -1, n: 2.4, s: 65, min: 60 });
  const starter = stat({ k: "era", dir: -1, n: 3.9, s: 70, min: 90 });
  // 선발은 자기 기준(90)에 못 미친다 → 우열을 말하면 안 된다
  assert.equal(betterSide(reliever, starter), null, "상대의 표본 미달을 자기 기준으로 덮었다");
  assert.equal(betterSide(starter, reliever), null, "방향을 바꾸면 답이 달라진다");
});

test("각자 기준에 둘 다 닿으면 판정한다 — 기준이 달라도 막지는 않는다", () => {
  const reliever = stat({ k: "era", dir: -1, n: 2.4, s: 65, min: 60 });
  const starter = stat({ k: "era", dir: -1, n: 3.9, s: 100, min: 90 });
  assert.equal(betterSide(reliever, starter), "a");
  assert.equal(betterSide(starter, reliever), "b", "⚠뒤집어도 같은 답이어야 한다");
});

test("한쪽만 등급 척도가 없으면 말하지 않는다", () => {
  assert.equal(betterSide(stat({ n: 0.32 }), stat({ n: 0.28, min: null })), null);
  assert.equal(betterSide(stat({ n: 0.32, min: null }), stat({ n: 0.28 })), null);
});

test("방향이 없는 지표에는 우열이 없다 — BABIP·안타 수", () => {
  assert.equal(betterSide(stat({ dir: 0, n: 5 }), stat({ dir: 0, n: 1 })), null);
});

test("등급 척도가 없으면 우열이 없다 — SRC·SRP는 남의 분포와 견줄 근거가 없다", () => {
  assert.equal(betterSide(stat({ min: null, n: 40 }), stat({ min: null, n: 10 })), null);
});

test("값이 없는 쪽이 있으면 말하지 않는다 — 「없음」은 지는 게 아니다(M11)", () => {
  assert.equal(betterSide(stat({ n: null, v: null }), stat({ n: 0.28 })), null);
  assert.equal(betterSide(stat({ n: 0.28 }), stat({ n: null, v: null })), null);
});

test("같은 값이면 승자가 없다", () => {
  assert.equal(betterSide(stat({ n: 0.3 }), stat({ n: 0.3 })), null);
});

test("⚠등급이 붙은 줄에는 반드시 분모가 있다(M2)", () => {
  for (const p of [BATTER, PITCHER]) {
    for (const s of compareCard(p).stats) {
      if (s.g !== null) assert.ok(s.d !== null, `${p.name}의 ${s.l}에 등급은 있는데 분모가 없다`);
    }
  }
});

test("개수 지표에는 등급도 방향도 주지 않는다 — 출장 기회가 다르다", () => {
  const byKey = new Map(compareCard(BATTER).stats.map((s) => [s.k, s]));
  for (const key of ["h", "hr", "rbi", "sb", "games"]) {
    const s = byKey.get(key)!;
    assert.equal(s.g, null, `${key}에 등급이 붙었다`);
    assert.equal(s.dir, 0, `${key}에 방향이 붙었다`);
    assert.equal(s.min, null, `${key}에 최소 표본이 붙었다`);
  }
});

test("타자 카드의 값은 선수 페이지와 같은 표기다 — 계산을 두 벌로 만들지 않는다(M1)", () => {
  const byKey = new Map(compareCard(BATTER).stats.map((s) => [s.k, s]));
  // 픽스처의 타율은 .3167 → 야구 표기는 선행 0을 지운 3자리
  assert.equal(byKey.get("avg")!.v, ".317");
  assert.equal(byKey.get("avg")!.d, "382打数");
  assert.equal(byKey.get("wrcPlus")!.v, "227.1");
  assert.equal(byKey.get("src")!.v, "+44.2");
});

test("투수 카드는 이닝을 분모로 낸다 — 아웃 수를 그대로 「回」라고 쓰지 않는다", () => {
  const byKey = new Map(compareCard(PITCHER).stats.map((s) => [s.k, s]));
  // 300아웃 = 100이닝
  assert.equal(byKey.get("era")!.d, "100回");
  assert.equal(byKey.get("innings")!.v, "100");
});

test("⚠투수의 등급 잣대는 역할을 따른다 — 선발 기준으로 구원을 재면 화면이 틀린 말을 한다", () => {
  const starter = compareCard(PITCHER);
  assert.equal(starter.group, "starter");

  const reliever = compareCard(
    playerPage({
      role: "pitcher",
      batting: null,
      pitching: mixedPitchingBlock(),
      mark: pitcherMark(),
      streaks: null,
    }),
  );
  assert.equal(reliever.group, "reliever");

  // 같은 방어율 2.70이 두 그룹에서 다른 등급이 되어야 한다(선발 임계값 2.6/2.9 · 구원 1.85/2.3)
  const era = (c: ReturnType<typeof compareCard>): string | null =>
    c.stats.find((s) => s.k === "era")!.g;
  assert.notEqual(era(starter), era(reliever), "역할이 달라도 같은 등급이 나왔다");
});

test("타자와 투수는 카드의 role이 다르다 — 화면이 이걸 보고 비교를 거절한다", () => {
  assert.equal(compareCard(BATTER).role, "batter");
  assert.equal(compareCard(PITCHER).role, "pitcher");
});

test("용어집 키를 쓰는 줄은 실제로 용어집에 있다 — 설명이 조용히 안 뜨는 것을 막는다", () => {
  const missing: string[] = [];
  for (const p of [BATTER, PITCHER]) {
    for (const s of compareCard(p).stats) {
      // 개수 지표는 용어집에 없어도 된다. **등급이 있는 지표는 설명도 있어야 한다**
      if (s.g !== null && GLOSSARY[s.k] === undefined) missing.push(`${p.name}:${s.k}`);
    }
  }
  assert.deepEqual(missing, [], `등급은 있는데 설명이 없는 지표: ${missing.join(", ")}`);
});

test("최소 표본은 등급 척도에서 그대로 온다 — 비교 화면이 자기 기준을 새로 만들지 않는다", () => {
  const byKey = new Map(compareCard(BATTER).stats.map((s) => [s.k, s]));
  assert.equal(byKey.get("avg")!.min, SCALES.batter.avg!.minSample);
  assert.equal(byKey.get("kRate")!.min, SCALES.batter.kRate!.minSample);
  // ⚠K%는 적을수록 좋다. 방향까지 척도에서 와야 한다
  assert.equal(byKey.get("kRate")!.dir, -1);
});

test("紋은 좌표까지 서버가 계산해 넣는다 — 클라이언트가 도형을 다시 그리지 않는다", () => {
  const c = compareCard(BATTER);
  assert.ok(c.mark !== null);
  assert.equal(c.mark!.labels.length, 5);
  assert.ok(/^[\d.,\s]+$/.test(c.mark!.shape), `도형 좌표가 아니다: ${c.mark!.shape}`);
  assert.ok(c.mark!.labels.every((l) => l.value !== "" && l.sample !== ""), "축에 값이나 분모가 없다");
});

test("성적이 없는 선수는 紋이 null이다 — 점 하나를 그려 「데이터 있음」처럼 보이게 하지 않는다", () => {
  const rookie = playerPage({ mark: { axes: [], sampleText: "0打席" }, batting: battingBlock() });
  assert.equal(compareCard(rookie).mark, null);
});

test("JSON은 그대로 되읽힌다", () => {
  const c = compareCard(BATTER);
  assert.deepEqual(JSON.parse(compareCardJson(c)), JSON.parse(JSON.stringify(c)));
});

/**
 * ⚠**클라이언트의 판정을 글자로 대조하지 않고 실제로 실행한다.**
 *
 * 우열 판정은 서버(`betterSide`)와 클라이언트(`assets.ts`의 `better`) 양쪽에 있다 —
 * 정적 사이트라 짝을 서버가 미리 계산할 수 없기 때문이다(695² 조합). 두 벌인 이상
 * **어긋나는 것이 기본값**이므로, 클라이언트 함수를 꺼내 같은 입력을 먹여 본다.
 *
 * 텍스트 일치 검사로는 「조건 하나를 지운 것」을 못 잡는다. 이 방식은 잡는다.
 */
function clientBetter(): (a: unknown, b: unknown) => string {
  const m = /const better=\((.*?)\)=>\{([\s\S]*?)\n  \};/.exec(CLIENT_JS);
  assert.ok(m !== null, "클라이언트에서 우열 판정 함수를 찾지 못했다 — 이름이 바뀌었는가");
  return new Function(`return (${m[1]})=>{${m[2]}}`)() as (a: unknown, b: unknown) => string;
}

test("⚠클라이언트의 우열 판정이 서버와 같은 답을 낸다 — 두 벌이 어긋나면 화면만 틀린다", () => {
  const better = clientBetter();
  const cases: [CompareStat, CompareStat][] = [
    [stat({ n: 0.32 }), stat({ n: 0.28 })],
    [stat({ n: 0.28 }), stat({ n: 0.32 })],
    [stat({ k: "era", dir: -1, n: 2.4, s: 300, min: 90 }), stat({ k: "era", dir: -1, n: 3.9, s: 300, min: 90 })],
    // 얇은 표본이 이기려 드는 경우 — 이 화면 최대의 함정
    [stat({ n: 0.4, s: 20 }), stat({ n: 0.3, s: 500 })],
    [stat({ n: 0.32, s: 500 }), stat({ n: 0.28, s: 10 })],
    [stat({ dir: 0, n: 5 }), stat({ dir: 0, n: 1 })],
    [stat({ min: null, n: 40 }), stat({ min: null, n: 10 })],
    [stat({ n: null, v: null }), stat({ n: 0.28 })],
    [stat({ n: 0.3 }), stat({ n: 0.3 })],
    // ⚠**min이 서로 다른 케이스.** 이게 없어서 「상대에게 내 기준을 대는」 결함이 두 벌 모두
    // 같은 방식으로 틀린 채 대조를 통과했다(2026-08-16)
    [stat({ k: "era", dir: -1, n: 2.4, s: 65, min: 60 }), stat({ k: "era", dir: -1, n: 3.9, s: 70, min: 90 })],
    [stat({ k: "era", dir: -1, n: 3.9, s: 70, min: 90 }), stat({ k: "era", dir: -1, n: 2.4, s: 65, min: 60 })],
    [stat({ n: 0.32 }), stat({ n: 0.28, min: null })],
  ];
  for (const [a, b] of cases) {
    // 클라이언트는 「없음」을 빈 문자열로 낸다(DOM 클래스에 그대로 쓰이기 때문)
    assert.equal(
      better(a, b) === "" ? null : better(a, b),
      betterSide(a, b),
      `${a.l} ${a.n}(${a.s}) 대 ${b.n}(${b.s})에서 서버와 클라이언트의 답이 다르다`,
    );
  }
});

test("⚠비교 화면은 스크립트 없이도 고를 것이 보인다 — 빈 페이지는 고장으로 보인다(M12)", () => {
  const out = renderComparePage({ season: 2026, asOf: "2026-08-14" }, context());
  assert.match(out, /id="cmpA"/, "선수 A 입력이 없다");
  assert.match(out, /id="cmpB"/, "선수 B 입력이 없다");
  assert.match(out, /打者と投手は共通の指標がない/, "왜 못 섞는지 설명이 없다");
  assert.match(out, /母数/, "母数를 말하지 않는다 — 이 화면이 우열을 참는 이유가 사라진다");
});
