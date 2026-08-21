# 증분 C — 지표 엔진 구현 계획

> ⚠**2026-08-20 정정 — 이 계획서의 wOBA 계수 부분은 더 이상 우리가 하는 일이 아니다.**
>
> **1.02 산식 의존을 끊기로 정했다**(`docs/metrics/README.md` §6-C · 사용자 결정).
> 지금은 계수와 wOBAscale 을 **우리 RE 행렬에서 리그×시즌마다 유도**한다
> (`scripts/woba-weights-derive.ts` · `packages/aggregate/src/woba-weights.ts`).
> **선형가중치는 원래 RE 에서 나오고 우리는 RE 를 이미 만들고 있었다** — 베낄 이유가 애초에 없었다.
>
> ⚠**계획서는 「그때의 기록」이라 본문을 고치지 않는다. 표시만 붙인다**(#54 사용자 결정).
> 본문에서 낡은 자리는 **네 곳**이다: 「계수는 시즌마다 다르다(1.02도 그렇게 명시)」 주석 ·
> **「wOBA 계수는 1.02 공개값과 일치한다」시험**(⚠이 시험은 지금 존재하지 않는다) ·
> 계수 상수의 출처 주석 · wOBAscale 의 출처 주석.
> ⚠**여기 적힌 고정 계수를 새 코드에 옮기지 마라** — 리그·시즌마다 다르므로 박는 순간 다른 시즌에서 거짓이 된다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 야구 지표를 계산하는 순수 함수 패키지 `packages/metrics`를 만든다. I/O 의존 0, 스택 비의존.

**Architecture:** 카운팅 스탯(입력) → 순수 함수 → `Rate`(값 + 분모). 모든 비율 지표가 분모를 함께 반환하는 타입을 쓰므로 M2(분모 없는 비율 금지)가 타입 수준에서 강제된다. 리그 상수(평균 wOBA·cFIP)는 상수로 박지 않고 **리그 집계에서 산출**한다 — 시즌마다 값이 다르고, 남의 값을 베끼지 않는 것이 §7 L2에도 부합한다.

**Tech Stack:** TypeScript (Node 24 네이티브 타입 스트리핑, 빌드 없음) · `node:test` · 런타임 의존성 0

## Global Constraints

- Node.js >= 24. 빌드 단계 없음 — `.ts`를 직접 실행한다. 상대 import는 **반드시 `.ts` 확장자**를 붙인다.
- **런타임 의존성 0.** 이 패키지에 `dependencies`를 추가하지 않는다.
- **I/O 금지.** `node:fs` · `fetch` · `node:crypto` 를 import하지 않는다. 순수 함수만.
- `new Date()` / `Date.now()` 직접 호출 금지(M6). 이 패키지는 시각을 다루지 않는다.
- 모든 비율 지표는 `Rate`(값 + 분모)를 반환한다(M2). 분모를 버리는 시그니처를 만들지 않는다.
- 분모가 0이면 `value: null`. **0으로 대체하지 않는다**(M11 — 「0」과 「없음」은 다르다).
- 이닝은 **아웃 카운트(정수)**로 다룬다. `6.2` 같은 부동소수를 이닝으로 쓰지 않는다.
- 표시 언어는 한국어(주석·문서). 코드 식별자는 영어.
- 새 테스트는 **고치기 전 코드에서 실패하는지 확인**한 뒤 채택한다.
- 커밋 메시지 말미에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/metrics/package.json` | 패키지 정의(의존성 0) |
| `packages/metrics/tsconfig.json` | 루트 base 상속 |
| `packages/metrics/src/rate.ts` | `Rate` 타입과 생성자. 분모 0 처리의 유일한 지점 |
| `packages/metrics/src/lines.ts` | `BattingLine` · `PitchingLine` 입력 타입과 파생값 |
| `packages/metrics/src/batting.ts` | AVG · OBP · SLG · OPS · ISO · BABIP · K% · BB% |
| `packages/metrics/src/pitching.ts` | ERA · WHIP · K/9 · BB/9 · HR/9 |
| `packages/metrics/src/league.ts` | 리그 집계 → 리그 상수(평균 wOBA · cFIP) |
| `packages/metrics/src/advanced.ts` | wOBA · wRAA · wRC · wRC+ · FIP |
| `packages/metrics/src/ranking.ts` | 자격 기준 · 순위 · 동률 처리 |
| `packages/metrics/src/index.ts` | 공개 API |
| `packages/metrics/test/*.test.ts` | 테스트 |
| `docs/metrics/README.md` | 지표 정의서(산식·출처·확신도·검증 케이스) |

**`advanced.ts`가 `league.ts`에 의존하는 방향은 단방향이다.** 리그 상수가 개별 선수 지표에 의존하게 만들지 마라 — 순환이 생기고 집계 순서가 결과를 바꾼다.

## 검증 전략 (이 증분의 핵심)

지표를 두 등급으로 나눈다. **섞지 마라.**

| 등급 | 지표 | 검증 방법 |
|---|---|---|
| **T1 독립 대조 가능** | AVG · OBP · SLG · OPS · ERA · WHIP | npb.jp가 **공표하는 값**과 대조한다. 우리 계산이 틀리면 즉시 드러난다 |
| **T2 대조 불가** | wOBA · wRAA · wRC+ · FIP · ISO · BABIP · K% · BB% | 무료·약관 클린한 NPB 공표값이 존재하지 않는다. **성질 테스트(property test)**로 검증한다 |

T2의 성질 테스트가 실제로 잡는 것:
- 리그 평균과 정확히 같은 wOBA를 가진 선수 → `wRAA = 0`
- 리그 전체를 하나의 선수로 넣으면 → `wRC+ = 100`
- 리그 전체를 넣으면 → `FIP = 리그 ERA` (cFIP의 정의가 그렇다)
- 카운팅 스탯을 전부 k배 해도 비율 지표는 불변
- wOBA는 HR 증가에 대해 단조 증가

⚠**자기 산식으로 자기 산식을 검증하지 마라.** 위 성질들은 산식을 다시 쓴 것이 아니라 산식이 만족해야 할 **외부 조건**이다.

---

### Task 1: `Rate` 타입 — 분모를 버릴 수 없게 만든다

**Files:**
- Create: `packages/metrics/package.json`
- Create: `packages/metrics/tsconfig.json`
- Create: `packages/metrics/src/rate.ts`
- Test: `packages/metrics/test/rate.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `interface Rate { value: number | null; denominator: number }` · `rate(numerator: number, denominator: number): Rate` · `ratio(a: Rate, b: Rate): never` 는 만들지 않는다

- [ ] **Step 1: 패키지 껍데기를 만든다**

`packages/metrics/package.json`:

```json
{
  "name": "@bb-app/metrics",
  "private": true,
  "type": "module",
  "description": "야구 지표 계산 — 순수 함수, I/O 없음",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "node --test \"test/*.test.ts\""
  }
}
```

`packages/metrics/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/metrics/test/rate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rate } from "../src/rate.ts";

test("값과 분모를 함께 돌려준다", () => {
  assert.deepEqual(rate(3, 10), { value: 0.3, denominator: 10 });
});

test("⚠분모가 0이면 value는 null — 0이 아니다 (M11)", () => {
  assert.deepEqual(rate(0, 0), { value: null, denominator: 0 });
  assert.deepEqual(rate(5, 0), { value: null, denominator: 0 });
});

test("분자가 0인 것과 분모가 0인 것은 다르다", () => {
  assert.equal(rate(0, 10).value, 0, "10타수 0안타는 타율 0이다");
  assert.equal(rate(0, 0).value, null, "0타수는 타율이 없다");
});

test("음수 분모는 프로그래밍 오류다", () => {
  assert.throws(() => rate(1, -1), RangeError);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `node --test "packages/metrics/test/rate.test.ts"`
Expected: FAIL — `Cannot find module '../src/rate.ts'`

- [ ] **Step 4: 최소 구현**

`packages/metrics/src/rate.ts`:

```ts
/**
 * 비율 지표의 결과.
 *
 * ⚠**분모를 항상 함께 나른다**(CLAUDE.md M2). 10타석 .400을 「리그 1위」로 보여주는 것이
 * 이 도메인의 1급 함정이고, 분모를 버리는 시그니처를 허용하면 그 함정을 막을 방법이 없다.
 */
export interface Rate {
  /** 분모가 0이면 null. **0으로 대체하지 않는다** — 「0」과 「없음」은 다르다(M11) */
  value: number | null;
  /** 이 값이 몇 개의 표본에서 나왔는가 */
  denominator: number;
}

export function rate(numerator: number, denominator: number): Rate {
  if (denominator < 0) throw new RangeError(`분모는 음수일 수 없다: ${denominator}`);
  return { value: denominator === 0 ? null : numerator / denominator, denominator };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `node --test "packages/metrics/test/rate.test.ts"`
Expected: PASS — 4본 전부

- [ ] **Step 6: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): Rate type that cannot drop its denominator

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 입력 타입 — 카운팅 스탯

**Files:**
- Create: `packages/metrics/src/lines.ts`
- Test: `packages/metrics/test/lines.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `BattingLine` · `PitchingLine` · `singles(line: BattingLine): number` · `totalBases(line: BattingLine): number` · `inningsPitched(line: PitchingLine): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/lines.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inningsPitched, singles, totalBases } from "../src/lines.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const BAT: BattingLine = {
  pa: 600, ab: 520, h: 156, double: 30, triple: 3, hr: 25,
  bb: 60, ibb: 5, hbp: 8, sf: 6, sh: 6, so: 90,
};

test("단타 = 안타 − 2루타 − 3루타 − 홈런", () => {
  assert.equal(singles(BAT), 156 - 30 - 3 - 25);
});

test("루타 = 단타 + 2×2루타 + 3×3루타 + 4×홈런", () => {
  assert.equal(totalBases(BAT), 98 + 2 * 30 + 3 * 3 + 4 * 25);
});

const PIT: PitchingLine = {
  outs: 500, bf: 700, h: 150, hr: 12, bb: 45, ibb: 3, hbp: 5, so: 160, er: 60, r: 66,
};

test("⚠이닝 표기는 아웃 카운트에서 만든다 — 6.2는 6+2/3이지 6.2가 아니다", () => {
  assert.equal(inningsPitched({ ...PIT, outs: 20 }), "6.2");
  assert.equal(inningsPitched({ ...PIT, outs: 21 }), "7");
  assert.equal(inningsPitched({ ...PIT, outs: 19 }), "6.1");
  assert.equal(inningsPitched({ ...PIT, outs: 0 }), "0");
});

test("이닝 표기는 반올림하지 않는다", () => {
  assert.equal(inningsPitched({ ...PIT, outs: 500 }), "166.2");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/lines.test.ts"`
Expected: FAIL — `Cannot find module '../src/lines.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/lines.ts`:

```ts
/**
 * 타자 카운팅 스탯 1행.
 *
 * ⚠`bb`는 **고의사구를 포함한 총 사사구 중 볼넷**이고, `ibb`는 그중 고의사구다.
 * wOBA는 `bb - ibb`를 쓰고 BB%는 `bb`를 쓴다 — 산식마다 다르므로 둘 다 보관한다.
 */
export interface BattingLine {
  /** 타석 */ pa: number;
  /** 타수 */ ab: number;
  /** 안타(총) */ h: number;
  /** 2루타 */ double: number;
  /** 3루타 */ triple: number;
  /** 홈런 */ hr: number;
  /** 볼넷(고의사구 포함) */ bb: number;
  /** 고의사구 */ ibb: number;
  /** 사구 */ hbp: number;
  /** 희생플라이 */ sf: number;
  /** 희생번트 */ sh: number;
  /** 삼진 */ so: number;
}

/** 투수 카운팅 스탯 1행. **이닝은 아웃 카운트로만 다룬다.** */
export interface PitchingLine {
  /** 아웃 카운트. 이닝 × 3 */ outs: number;
  /** 상대한 타자 수 */ bf: number;
  /** 피안타 */ h: number;
  /** 피홈런 */ hr: number;
  /** 볼넷(고의사구 포함) */ bb: number;
  /** 고의사구 */ ibb: number;
  /** 사구 */ hbp: number;
  /** 탈삼진 */ so: number;
  /** 자책점 */ er: number;
  /** 실점 */ r: number;
}

export function singles(line: BattingLine): number {
  return line.h - line.double - line.triple - line.hr;
}

export function totalBases(line: BattingLine): number {
  return singles(line) + 2 * line.double + 3 * line.triple + 4 * line.hr;
}

/**
 * 야구 관례의 이닝 표기(`6.2` = 6과 3분의 2).
 * ⚠이건 **표시용 문자열**이다. 계산에는 절대 쓰지 마라 — 계산은 `outs`로 한다.
 */
export function inningsPitched(line: PitchingLine): string {
  const whole = Math.floor(line.outs / 3);
  const remainder = line.outs % 3;
  return remainder === 0 ? String(whole) : `${whole}.${remainder}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/lines.test.ts"`
Expected: PASS — 4본 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): counting-stat input types

Innings live as out counts; 6.2 is a display string, never a number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 타자 기본 비율 지표

**Files:**
- Create: `packages/metrics/src/batting.ts`
- Test: `packages/metrics/test/batting.test.ts`

**Interfaces:**
- Consumes: `rate` (Task 1), `BattingLine` · `singles` · `totalBases` (Task 2)
- Produces: `battingAverage` · `onBasePercentage` · `sluggingPercentage` · `ops` · `iso` · `babip` · `strikeoutRate` · `walkRate` — 전부 `(line: BattingLine) => Rate`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/batting.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  babip, battingAverage, iso, onBasePercentage, ops, sluggingPercentage, strikeoutRate, walkRate,
} from "../src/batting.ts";
import type { BattingLine } from "../src/lines.ts";

/** 검증용. 소수 자릿수가 딱 떨어지도록 고른 값이다. */
const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100,
};

test("타율 = 안타 / 타수", () => {
  assert.equal(battingAverage(LINE).value, 0.3);
  assert.equal(battingAverage(LINE).denominator, 500);
});

test("출루율 = (안타+볼넷+사구) / (타수+볼넷+사구+희생플라이)", () => {
  // (150+70+10) / (500+70+10+20) = 230/600
  assert.equal(onBasePercentage(LINE).value, 230 / 600);
  assert.equal(onBasePercentage(LINE).denominator, 600);
});

test("장타율 = 루타 / 타수", () => {
  // 단타 98 + 2×30 + 3×2 + 4×20 = 98+60+6+80 = 244
  assert.equal(sluggingPercentage(LINE).value, 244 / 500);
});

test("OPS = 출루율 + 장타율", () => {
  assert.equal(ops(LINE).value, 230 / 600 + 244 / 500);
});

test("ISO = 장타율 − 타율", () => {
  assert.equal(iso(LINE).value, 244 / 500 - 150 / 500);
});

test("BABIP = (안타−홈런) / (타수−삼진−홈런+희생플라이)", () => {
  // (150−20) / (500−100−20+20) = 130/400
  assert.equal(babip(LINE).value, 130 / 400);
  assert.equal(babip(LINE).denominator, 400);
});

test("K%·BB%의 분모는 타석이며 BB%는 고의사구를 포함한다", () => {
  assert.equal(strikeoutRate(LINE).value, 100 / 600);
  assert.equal(walkRate(LINE).value, 70 / 600);
});

test("⚠전 지표가 분모를 함께 낸다 (M2)", () => {
  const all = [battingAverage, onBasePercentage, sluggingPercentage, ops, iso, babip, strikeoutRate, walkRate];
  for (const f of all) assert.equal(typeof f(LINE).denominator, "number");
});

test("⚠빈 성적은 0이 아니라 null이다 (M11)", () => {
  const empty: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0,
    bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0,
  };
  assert.equal(battingAverage(empty).value, null);
  assert.equal(onBasePercentage(empty).value, null);
  assert.equal(ops(empty).value, null);
});

test("성적을 전부 2배로 해도 비율은 변하지 않는다", () => {
  const doubled: BattingLine = Object.fromEntries(
    Object.entries(LINE).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  assert.equal(battingAverage(doubled).value, battingAverage(LINE).value);
  assert.equal(onBasePercentage(doubled).value, onBasePercentage(LINE).value);
  assert.equal(babip(doubled).value, babip(LINE).value);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/batting.test.ts"`
Expected: FAIL — `Cannot find module '../src/batting.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/batting.ts`:

```ts
import { rate } from "./rate.ts";
import type { Rate } from "./rate.ts";
import { singles, totalBases } from "./lines.ts";
import type { BattingLine } from "./lines.ts";

/** 타율 打率 — npb.jp 공표값과 대조 가능(T1). */
export function battingAverage(line: BattingLine): Rate {
  return rate(line.h, line.ab);
}

/** 출루율 出塁率 — npb.jp 공표값과 대조 가능(T1). */
export function onBasePercentage(line: BattingLine): Rate {
  return rate(line.h + line.bb + line.hbp, line.ab + line.bb + line.hbp + line.sf);
}

/** 장타율 長打率 — npb.jp 공표값과 대조 가능(T1). */
export function sluggingPercentage(line: BattingLine): Rate {
  return rate(totalBases(line), line.ab);
}

/**
 * OPS = 출루율 + 장타율.
 * ⚠분모가 둘(출루 분모·타수)이라 하나로 줄일 수 없다. 표본 크기로는 **타석**을 싣는다.
 */
export function ops(line: BattingLine): Rate {
  const obp = onBasePercentage(line);
  const slg = sluggingPercentage(line);
  const value = obp.value === null || slg.value === null ? null : obp.value + slg.value;
  return { value, denominator: line.pa };
}

/** ISO = 장타율 − 타율. 순수 장타력. */
export function iso(line: BattingLine): Rate {
  const slg = sluggingPercentage(line);
  const avg = battingAverage(line);
  const value = slg.value === null || avg.value === null ? null : slg.value - avg.value;
  return { value, denominator: line.ab };
}

/** BABIP — 인플레이 타구의 안타 비율. */
export function babip(line: BattingLine): Rate {
  return rate(line.h - line.hr, line.ab - line.so - line.hr + line.sf);
}

/** 삼진 비율. 분모는 타석. */
export function strikeoutRate(line: BattingLine): Rate {
  return rate(line.so, line.pa);
}

/** 볼넷 비율. **고의사구를 포함한다**(wOBA와 다르다 — 관례가 다르다). */
export function walkRate(line: BattingLine): Rate {
  return rate(line.bb, line.pa);
}

export { singles, totalBases };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/batting.test.ts"`
Expected: PASS — 10본 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): batting rate metrics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 투수 기본 비율 지표

**Files:**
- Create: `packages/metrics/src/pitching.ts`
- Test: `packages/metrics/test/pitching.test.ts`

**Interfaces:**
- Consumes: `rate` (Task 1), `PitchingLine` (Task 2)
- Produces: `earnedRunAverage` · `whip` · `strikeoutsPer9` · `walksPer9` · `homeRunsPer9` — 전부 `(line: PitchingLine) => Rate`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/pitching.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { earnedRunAverage, homeRunsPer9, strikeoutsPer9, walksPer9, whip } from "../src/pitching.ts";
import type { PitchingLine } from "../src/lines.ts";

/** 아웃 486 = 정확히 162이닝. 자책 54 → ERA 3.00 */
const LINE: PitchingLine = {
  outs: 486, bf: 660, h: 150, hr: 18, bb: 45, ibb: 3, hbp: 9, so: 180, er: 54, r: 60,
};

test("방어율 = 자책점 × 9 / 이닝", () => {
  assert.equal(earnedRunAverage(LINE).value, 3);
  assert.equal(earnedRunAverage(LINE).denominator, 486, "분모는 아웃 카운트");
});

test("WHIP = (피안타 + 볼넷) / 이닝 — 사구는 넣지 않는다", () => {
  assert.equal(whip(LINE).value, (150 + 45) / 162);
});

test("K/9 · BB/9 · HR/9", () => {
  assert.equal(strikeoutsPer9(LINE).value, 10);
  assert.equal(walksPer9(LINE).value, 45 * 9 / 162);
  assert.equal(homeRunsPer9(LINE).value, 1);
});

test("⚠이닝을 부동소수로 다루지 않는다 — 1과 3분의 1이닝", () => {
  // 아웃 4 = 1⅓이닝. 자책 1이면 ERA = 1 × 9 / (4/3) = 6.75
  const short: PitchingLine = { ...LINE, outs: 4, er: 1 };
  assert.equal(earnedRunAverage(short).value, 6.75);
});

test("⚠등판하지 않은 투수는 0이 아니라 null이다 (M11)", () => {
  const none: PitchingLine = { outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0 };
  assert.equal(earnedRunAverage(none).value, null, "0.00은 「무실점」으로 오독된다");
  assert.equal(whip(none).value, null);
});

test("무실점 완투와 미등판은 다르다", () => {
  const shutout: PitchingLine = { ...LINE, outs: 27, er: 0 };
  assert.equal(earnedRunAverage(shutout).value, 0, "9이닝 무자책은 ERA 0이다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/pitching.test.ts"`
Expected: FAIL — `Cannot find module '../src/pitching.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/pitching.ts`:

```ts
import { rate } from "./rate.ts";
import type { Rate } from "./rate.ts";
import type { PitchingLine } from "./lines.ts";

/**
 * 아웃 카운트 기준의 「9이닝당」 환산.
 * 9이닝 = 27아웃이므로 `× 27 / outs`.
 */
function per9(count: number, outs: number): Rate {
  return { value: outs === 0 ? null : (count * 27) / outs, denominator: outs };
}

/** 방어율 防御率 — npb.jp 공표값과 대조 가능(T1). */
export function earnedRunAverage(line: PitchingLine): Rate {
  return per9(line.er, line.outs);
}

/** WHIP — 이닝당 출루 허용. **사구를 포함하지 않는 것이 관례다.** */
export function whip(line: PitchingLine): Rate {
  return { value: line.outs === 0 ? null : ((line.h + line.bb) * 3) / line.outs, denominator: line.outs };
}

export function strikeoutsPer9(line: PitchingLine): Rate {
  return per9(line.so, line.outs);
}

export function walksPer9(line: PitchingLine): Rate {
  return per9(line.bb, line.outs);
}

export function homeRunsPer9(line: PitchingLine): Rate {
  return per9(line.hr, line.outs);
}

export { rate };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/pitching.test.ts"`
Expected: PASS — 6본 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): pitching rate metrics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 리그 상수 — 베끼지 않고 산출한다

**Files:**
- Create: `packages/metrics/src/league.ts`
- Test: `packages/metrics/test/league.test.ts`

**Interfaces:**
- Consumes: `BattingLine` · `PitchingLine` (Task 2)
- Produces: `sumBatting(lines: readonly BattingLine[]): BattingLine` · `sumPitching(lines: readonly PitchingLine[]): PitchingLine` · `interface LeagueConstants { season: number; league: string; averageWoba: number; cFip: number; runsPerPa: number }` · `leagueConstants(args: { season: number; league: string; batting: BattingLine; pitching: PitchingLine; runs: number }): LeagueConstants`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/league.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { leagueConstants, sumBatting, sumPitching } from "../src/league.ts";
import { earnedRunAverage } from "../src/pitching.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const A: BattingLine = { pa: 100, ab: 90, h: 27, double: 5, triple: 1, hr: 3, bb: 8, ibb: 1, hbp: 1, sf: 1, sh: 0, so: 20 };
const B: BattingLine = { pa: 200, ab: 180, h: 45, double: 8, triple: 0, hr: 6, bb: 15, ibb: 0, hbp: 2, sf: 3, sh: 0, so: 40 };

test("타격 집계는 전 필드를 더한다", () => {
  const s = sumBatting([A, B]);
  assert.equal(s.pa, 300);
  assert.equal(s.ab, 270);
  assert.equal(s.h, 72);
  assert.equal(s.ibb, 1);
  assert.equal(s.so, 60);
});

test("빈 배열의 집계는 전부 0이다", () => {
  const s = sumBatting([]);
  assert.equal(s.pa, 0);
  assert.equal(s.h, 0);
});

const P1: PitchingLine = { outs: 243, bf: 330, h: 75, hr: 9, bb: 22, ibb: 1, hbp: 4, so: 90, er: 27, r: 30 };
const P2: PitchingLine = { outs: 243, bf: 330, h: 75, hr: 9, bb: 23, ibb: 2, hbp: 5, so: 90, er: 27, r: 30 };

test("투구 집계는 아웃 카운트를 더한다", () => {
  const s = sumPitching([P1, P2]);
  assert.equal(s.outs, 486);
  assert.equal(s.bb, 45);
});

test("⚠cFIP는 리그 전체를 넣었을 때 FIP가 리그 ERA와 같아지도록 정의된다", () => {
  const pitching = sumPitching([P1, P2]);
  const batting = sumBatting([A, B]);
  const c = leagueConstants({ season: 2026, league: "central", batting, pitching, runs: 60 });

  // FIP 미가공값 = (13HR + 3(BB+HBP) − 2K) × 3 / outs
  const raw = (13 * pitching.hr + 3 * (pitching.bb + pitching.hbp) - 2 * pitching.so) * 3 / pitching.outs;
  const leagueEra = earnedRunAverage(pitching).value;
  assert.ok(leagueEra !== null);
  assert.ok(Math.abs(raw + c.cFip - leagueEra) < 1e-9, "cFIP를 더하면 리그 ERA가 나와야 한다");
});

test("리그 득점/타석", () => {
  const c = leagueConstants({
    season: 2026, league: "central",
    batting: sumBatting([A, B]), pitching: sumPitching([P1, P2]), runs: 60,
  });
  assert.equal(c.runsPerPa, 60 / 300);
});

test("⚠표본이 비면 상수를 만들지 않고 던진다", () => {
  assert.throws(
    () => leagueConstants({
      season: 2026, league: "central",
      batting: sumBatting([]), pitching: sumPitching([]), runs: 0,
    }),
    RangeError,
    "0으로 나눈 상수를 조용히 돌려주면 그 시즌 전 지표가 조용히 틀린다",
  );
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/league.test.ts"`
Expected: FAIL — `Cannot find module '../src/league.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/league.ts`:

```ts
import type { BattingLine, PitchingLine } from "./lines.ts";
import { wobaRaw } from "./advanced.ts";

/**
 * 리그 상수.
 *
 * ⚠**남의 값을 베끼지 않는다.** 계수는 시즌마다 다르고(1.02도 그렇게 명시한다),
 * 우리 아카이브에서 산출하는 편이 정확할 뿐 아니라 「원본의 재배열이 아니라 우리 산출물」이라는
 * 위치(설계 스펙 §7 L2)에도 부합한다.
 */
export interface LeagueConstants {
  season: number;
  /** `central` | `pacific` — 리그를 섞어 집계하지 않는다 */
  league: string;
  /** 리그 평균 wOBA. wRAA의 기준선 */
  averageWoba: number;
  /** FIP 상수. 리그 전체 FIP가 리그 ERA와 같아지게 만드는 값 */
  cFip: number;
  /** 리그 득점 / 타석. wRC 계산의 기준선 */
  runsPerPa: number;
}

const BATTING_KEYS = [
  "pa", "ab", "h", "double", "triple", "hr", "bb", "ibb", "hbp", "sf", "sh", "so",
] as const;

const PITCHING_KEYS = [
  "outs", "bf", "h", "hr", "bb", "ibb", "hbp", "so", "er", "r",
] as const;

export function sumBatting(lines: readonly BattingLine[]): BattingLine {
  const out = Object.fromEntries(BATTING_KEYS.map((k) => [k, 0])) as unknown as BattingLine;
  for (const line of lines) for (const k of BATTING_KEYS) out[k] += line[k];
  return out;
}

export function sumPitching(lines: readonly PitchingLine[]): PitchingLine {
  const out = Object.fromEntries(PITCHING_KEYS.map((k) => [k, 0])) as unknown as PitchingLine;
  for (const line of lines) for (const k of PITCHING_KEYS) out[k] += line[k];
  return out;
}

export function leagueConstants(args: {
  season: number;
  league: string;
  batting: BattingLine;
  pitching: PitchingLine;
  runs: number;
}): LeagueConstants {
  const { season, league, batting, pitching, runs } = args;
  if (batting.pa === 0) throw new RangeError(`리그 타석이 0이다 — 상수를 만들 수 없다 (${season} ${league})`);
  if (pitching.outs === 0) throw new RangeError(`리그 아웃이 0이다 — 상수를 만들 수 없다 (${season} ${league})`);

  const averageWoba = wobaRaw(batting);
  if (averageWoba === null) throw new RangeError(`리그 wOBA 분모가 0이다 (${season} ${league})`);

  const leagueEra = (pitching.er * 27) / pitching.outs;
  const fipRaw =
    ((13 * pitching.hr + 3 * (pitching.bb + pitching.hbp) - 2 * pitching.so) * 3) / pitching.outs;

  return { season, league, averageWoba, cFip: leagueEra - fipRaw, runsPerPa: runs / batting.pa };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/league.test.ts"`
Expected: **FAIL** — `advanced.ts`가 아직 없다. 이는 예상된 것이며 Task 6에서 해소된다. Task 6 완료 후 이 테스트가 통과해야 한다.

- [ ] **Step 5: Task 6을 먼저 완료한 뒤 돌아와 통과를 확인하고 커밋한다**

```bash
node --test "packages/metrics/test/league.test.ts"
git add packages/metrics
git commit -m "feat(metrics): league constants derived from our own aggregates

Coefficients differ by season, so they are computed rather than copied.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: wOBA · wRAA · wRC+ · FIP

**Files:**
- Create: `packages/metrics/src/advanced.ts`
- Test: `packages/metrics/test/advanced.test.ts`

**Interfaces:**
- Consumes: `rate` (Task 1), `BattingLine` · `PitchingLine` · `singles` (Task 2), `LeagueConstants` (Task 5)
- Produces: `WOBA_WEIGHTS` · `wobaRaw(line: BattingLine): number | null` · `woba(line: BattingLine): Rate` · `wraa(line, lc): Rate` · `wrcPlus(line, lc): Rate` · `fip(line: PitchingLine, lc: LeagueConstants): Rate`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/advanced.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WOBA_WEIGHTS, fip, woba, wraa, wrcPlus } from "../src/advanced.ts";
import { leagueConstants, sumBatting, sumPitching } from "../src/league.ts";
import { earnedRunAverage } from "../src/pitching.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100,
};

test("wOBA 계수는 1.02 공개값과 일치한다", () => {
  assert.deepEqual(WOBA_WEIGHTS, {
    bb: 0.692, hbp: 0.73, roe: 0.966, single: 0.865, double: 1.334, triple: 1.725, hr: 2.065,
  });
});

test("⚠wOBA는 볼넷에서 고의사구를 뺀다", () => {
  const w = WOBA_WEIGHTS;
  const singles = 150 - 30 - 2 - 20; // 98
  // 失策出塁는 공개 소스가 없어 항을 생략한다(정의서에 명시).
  const numerator =
    w.bb * (70 - 5) + w.hbp * 10 + w.single * singles + w.double * 30 + w.triple * 2 + w.hr * 20;
  const denominator = 500 + (70 - 5) + 10 + 20;
  assert.ok(Math.abs(woba(LINE).value! - numerator / denominator) < 1e-12);
  assert.equal(woba(LINE).denominator, denominator);
});

test("wOBA는 홈런이 늘면 증가한다", () => {
  const more: BattingLine = { ...LINE, h: 151, hr: 21, ab: 501 };
  assert.ok(woba(more).value! > woba(LINE).value!);
});

test("⚠타석이 없으면 null이다", () => {
  const empty: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0,
  };
  assert.equal(woba(empty).value, null);
});

// --- 성질 테스트: 리그 전체를 넣으면 기준선이 나와야 한다 ---

const P: PitchingLine = { outs: 486, bf: 660, h: 150, hr: 18, bb: 45, ibb: 3, hbp: 9, so: 180, er: 54, r: 60 };
const LC = leagueConstants({
  season: 2026, league: "central",
  batting: sumBatting([LINE]), pitching: sumPitching([P]), runs: 60,
});

test("⚠리그 평균과 같은 선수의 wRAA는 0이다", () => {
  assert.ok(Math.abs(wraa(LINE, LC).value!) < 1e-9);
});

test("⚠리그 전체의 wRC+는 100이다", () => {
  assert.ok(Math.abs(wrcPlus(LINE, LC).value! - 100) < 1e-9);
});

test("⚠리그 전체의 FIP는 리그 ERA와 같다", () => {
  const leagueEra = earnedRunAverage(P).value!;
  assert.ok(Math.abs(fip(P, LC).value! - leagueEra) < 1e-9);
});

test("리그 평균보다 나은 타자는 wRAA > 0, wRC+ > 100", () => {
  const better: BattingLine = { ...LINE, h: 170, hr: 30, double: 35 };
  assert.ok(wraa(better, LC).value! > 0);
  assert.ok(wrcPlus(better, LC).value! > 100);
});

test("FIP는 삼진이 늘면 낮아지고 볼넷이 늘면 높아진다", () => {
  assert.ok(fip({ ...P, so: 200 }, LC).value! < fip(P, LC).value!);
  assert.ok(fip({ ...P, bb: 60 }, LC).value! > fip(P, LC).value!);
});

test("⚠미등판 투수의 FIP는 null이다", () => {
  const none: PitchingLine = { outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0 };
  assert.equal(fip(none, LC).value, null);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/advanced.test.ts"`
Expected: FAIL — `Cannot find module '../src/advanced.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/advanced.ts`:

```ts
import type { Rate } from "./rate.ts";
import { singles } from "./lines.ts";
import type { BattingLine, PitchingLine } from "./lines.ts";
import type { LeagueConstants } from "./league.ts";

/**
 * wOBA 계수 (NPB판).
 *
 * 출처: 1.02 Essence of Baseball Glossary
 * https://1point02.jp/op/gnav/glossary/gls_explanation.aspx?eid=20040
 *
 * 원식:
 *   wOBA = {0.692×(四球−故意四球) + 0.73×死球 + 0.966×失策出塁 + 0.865×単打
 *           + 1.334×二塁打 + 1.725×三塁打 + 2.065×本塁打}
 *          ÷ (打数 + 四球 − 故意四球 + 死球 + 犠飛)
 *
 * ⚠**`roe`(失策出塁) 항은 계산에서 생략한다.** 선수별 실책출루는 공개 소스가 존재하지 않는다
 * (소스 조사 보고서 §3-5). 계수는 출처 대조를 위해 남겨두되 쓰지 않으며,
 * 이 생략은 지표 라벨에 각주로 표시한다.
 *
 * ⚠**계수는 시즌마다 다르다**(1.02가 명시). 이 세트는 공개된 1세트뿐이므로,
 * wOBA 절대치가 아니라 **리그평균 대비 상대치(wRAA·wRC+)로 제시**한다.
 */
export const WOBA_WEIGHTS = {
  bb: 0.692,
  hbp: 0.73,
  roe: 0.966,
  single: 0.865,
  double: 1.334,
  triple: 1.725,
  hr: 2.065,
} as const;

/** wOBA를 스케일하기 위한 제수. 출처: 1.02 wRAA 항목(wOBAscale). */
export const WOBA_SCALE = 1.24;

function wobaDenominator(line: BattingLine): number {
  return line.ab + (line.bb - line.ibb) + line.hbp + line.sf;
}

/** 분모가 0이면 null. 리그 상수 산출에서 쓰기 위해 원시값을 노출한다. */
export function wobaRaw(line: BattingLine): number | null {
  const denominator = wobaDenominator(line);
  if (denominator === 0) return null;
  const w = WOBA_WEIGHTS;
  const numerator =
    w.bb * (line.bb - line.ibb) +
    w.hbp * line.hbp +
    w.single * singles(line) +
    w.double * line.double +
    w.triple * line.triple +
    w.hr * line.hr;
  return numerator / denominator;
}

export function woba(line: BattingLine): Rate {
  return { value: wobaRaw(line), denominator: wobaDenominator(line) };
}

/** wRAA = (wOBA − 리그평균wOBA) ÷ wOBAscale × 타석. */
export function wraa(line: BattingLine, lc: LeagueConstants): Rate {
  const w = wobaRaw(line);
  const value = w === null ? null : ((w - lc.averageWoba) / WOBA_SCALE) * line.pa;
  return { value, denominator: line.pa };
}

/**
 * wRC+ — 리그 평균을 100으로 지수화한 타격 생산성.
 *
 * ⚠**파크팩터를 적용하지 않는다.** 신뢰할 만한 PF를 만들려면 3~5시즌이 필요한데
 * 원시 로그가 2025년분부터만 존재한다(설계 스펙 §6.2). 이 사실을 라벨에 쓴다.
 */
export function wrcPlus(line: BattingLine, lc: LeagueConstants): Rate {
  const raa = wraa(line, lc);
  if (raa.value === null || line.pa === 0 || lc.runsPerPa === 0) {
    return { value: null, denominator: line.pa };
  }
  return { value: ((raa.value / line.pa + lc.runsPerPa) / lc.runsPerPa) * 100, denominator: line.pa };
}

/**
 * FIP — 수비와 무관한 결과(홈런·사사구·삼진)만으로 본 투수 성적.
 * 상수 `cFip`는 리그 전체 FIP가 리그 ERA와 같아지도록 `league.ts`가 산출한다.
 */
export function fip(line: PitchingLine, lc: LeagueConstants): Rate {
  if (line.outs === 0) return { value: null, denominator: 0 };
  const raw = ((13 * line.hr + 3 * (line.bb + line.hbp) - 2 * line.so) * 3) / line.outs;
  return { value: raw + lc.cFip, denominator: line.outs };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/advanced.test.ts" "packages/metrics/test/league.test.ts"`
Expected: PASS — advanced 10본 + league 6본

- [ ] **Step 5: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): wOBA, wRAA, wRC+, FIP

wOBA excludes intentional walks and drops the ROE term, which has no
public per-player source. Verified by property: the league aggregate
scores wRAA 0, wRC+ 100, and FIP equal to league ERA.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 자격 기준 · 순위 · 동률 처리

**Files:**
- Create: `packages/metrics/src/ranking.ts`
- Test: `packages/metrics/test/ranking.test.ts`

**Interfaces:**
- Consumes: `Rate` (Task 1)
- Produces: `qualifiedBatterPa(teamGames: number): number` · `qualifiedPitcherOuts(teamGames: number): number` · `interface Ranked<T> { item: T; rank: number | null; rate: Rate }` · `rankBy<T>(items, getRate, opts): Ranked<T>[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/ranking.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifiedBatterPa, qualifiedPitcherOuts, rankBy } from "../src/ranking.ts";
import { rate } from "../src/rate.ts";

test("규정타석 = 팀 경기수 × 3.1 (NPB)", () => {
  assert.equal(qualifiedBatterPa(143), Math.ceil(143 * 3.1));
  assert.equal(qualifiedBatterPa(0), 0);
});

test("규정투구회 = 팀 경기수 × 1이닝 → 아웃으로 환산", () => {
  assert.equal(qualifiedPitcherOuts(143), 143 * 3);
});

const rows = [
  { name: "A", r: rate(30, 100) }, // .300
  { name: "B", r: rate(35, 100) }, // .350
  { name: "C", r: rate(35, 100) }, // .350 동률
  { name: "D", r: rate(40, 100) }, // .400
  { name: "E", r: rate(4, 10) },   // .400 이지만 표본 미달
  { name: "F", r: rate(0, 0) },    // 값 없음
];

test("높을수록 좋은 지표는 내림차순", () => {
  const out = rankBy(rows, (x) => x.r, { minDenominator: 100, higherIsBetter: true });
  assert.deepEqual(out.filter((o) => o.rank !== null).map((o) => [o.item.name, o.rank]), [
    ["D", 1], ["B", 2], ["C", 2], ["A", 4],
  ]);
});

test("⚠동률은 같은 순위를 받고 다음 순위를 건너뛴다", () => {
  const out = rankBy(rows, (x) => x.r, { minDenominator: 100, higherIsBetter: true });
  const a = out.find((o) => o.item.name === "A");
  assert.equal(a?.rank, 4, "공동 2위가 둘이면 다음은 4위다");
});

test("⚠자격 미달은 순위가 null이며 목록에서 사라지지 않는다", () => {
  const out = rankBy(rows, (x) => x.r, { minDenominator: 100, higherIsBetter: true });
  const e = out.find((o) => o.item.name === "E");
  assert.ok(e, "미달 선수도 결과에 남아야 한다 — 성적은 있는데 순위만 없는 것이다");
  assert.equal(e.rank, null);
});

test("⚠값이 없는 선수도 순위가 null이다", () => {
  const out = rankBy(rows, (x) => x.r, { minDenominator: 100, higherIsBetter: true });
  assert.equal(out.find((o) => o.item.name === "F")?.rank, null);
});

test("낮을수록 좋은 지표는 오름차순", () => {
  const era = [
    { name: "X", r: rate(2, 1) },
    { name: "Y", r: rate(3, 1) },
    { name: "Z", r: rate(1, 1) },
  ];
  const out = rankBy(era, (x) => x.r, { minDenominator: 1, higherIsBetter: false });
  assert.deepEqual(out.map((o) => [o.item.name, o.rank]), [["Z", 1], ["X", 2], ["Y", 3]]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/ranking.test.ts"`
Expected: FAIL — `Cannot find module '../src/ranking.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/ranking.ts`:

```ts
import type { Rate } from "./rate.ts";

/**
 * 규정타석 — NPB는 **팀 시합수 × 3.1**.
 * ⚠자격 기준은 「표시 규칙」이 아니라 **값의 일부**다(M3). 바꾸면 순위가 바뀐다.
 */
export function qualifiedBatterPa(teamGames: number): number {
  return Math.ceil(teamGames * 3.1);
}

/** 규정투구회 — NPB는 **팀 시합수 × 1이닝**. 아웃 카운트로 돌려준다. */
export function qualifiedPitcherOuts(teamGames: number): number {
  return teamGames * 3;
}

export interface Ranked<T> {
  item: T;
  /** 자격 미달이거나 값이 없으면 null. **목록에서 빼지 않는다** */
  rank: number | null;
  rate: Rate;
}

export interface RankOptions {
  /** 이 분모 미만은 순위를 매기지 않는다 */
  minDenominator: number;
  /** 타율처럼 높을수록 좋으면 true, 방어율처럼 낮을수록 좋으면 false */
  higherIsBetter: boolean;
}

/**
 * 순위를 매긴다.
 *
 * ⚠**동률은 같은 순위를 받고 다음 순위를 건너뛴다**(공동 2위가 둘이면 다음은 4위).
 * 이 규칙을 테스트로 고정한다 — 규칙이 코드에만 있으면 아무도 검증할 수 없다(M3).
 */
export function rankBy<T>(
  items: readonly T[],
  getRate: (item: T) => Rate,
  opts: RankOptions,
): Ranked<T>[] {
  const rows = items.map((item) => ({ item, rate: getRate(item) }));
  const eligible = rows.filter((r) => r.rate.value !== null && r.rate.denominator >= opts.minDenominator);

  const sorted = [...eligible].sort((a, b) =>
    opts.higherIsBetter ? b.rate.value! - a.rate.value! : a.rate.value! - b.rate.value!,
  );

  const rankOf = new Map<unknown, number>();
  let previous: number | null = null;
  sorted.forEach((row, index) => {
    if (previous === null || row.rate.value !== previous) {
      rankOf.set(row.item, index + 1);
      previous = row.rate.value;
    } else {
      rankOf.set(row.item, rankOf.get(sorted[index - 1]!.item)!);
    }
  });

  const ordered = [
    ...sorted.map((r) => ({ item: r.item, rank: rankOf.get(r.item) ?? null, rate: r.rate })),
    ...rows.filter((r) => !rankOf.has(r.item)).map((r) => ({ item: r.item, rank: null, rate: r.rate })),
  ];
  return ordered;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test "packages/metrics/test/ranking.test.ts"`
Expected: PASS — 6본 전부

- [ ] **Step 5: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): qualification thresholds and tie-aware ranking

Unqualified players keep their stats and lose only their rank; ties share
a rank and skip the next one. Both rules are pinned by tests because a
ranking rule that lives only in code cannot be checked by anyone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 공개 API와 패키지 검증

**Files:**
- Create: `packages/metrics/src/index.ts`
- Modify: `package.json` (루트) — `typecheck` 스크립트가 새 패키지를 포함하는지 확인
- Test: `packages/metrics/test/index.test.ts`

**Interfaces:**
- Consumes: Task 1~7 전부
- Produces: `@bb-app/metrics`의 공개 표면

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/metrics/test/index.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as metrics from "../src/index.ts";

test("공개 API가 전부 노출된다", () => {
  for (const name of [
    "rate", "singles", "totalBases", "inningsPitched",
    "battingAverage", "onBasePercentage", "sluggingPercentage", "ops", "iso", "babip",
    "strikeoutRate", "walkRate",
    "earnedRunAverage", "whip", "strikeoutsPer9", "walksPer9", "homeRunsPer9",
    "sumBatting", "sumPitching", "leagueConstants",
    "WOBA_WEIGHTS", "WOBA_SCALE", "woba", "wobaRaw", "wraa", "wrcPlus", "fip",
    "qualifiedBatterPa", "qualifiedPitcherOuts", "rankBy",
  ]) {
    assert.ok(name in metrics, `${name}이(가) 공개되지 않았다`);
  }
});

test("⚠이 패키지는 I/O를 하지 않는다", async () => {
  // 소스에 I/O 모듈 import가 없는지 본다. 순수성이 이 패키지의 존재 이유다(M1).
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/", import.meta.url);
  const files = await readdir(dir);
  for (const f of files) {
    const src = await readFile(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /from "node:(fs|http|https|net|child_process)/, `${f}에 I/O import가 있다`);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f}에 fetch 호출이 있다`);
    assert.doesNotMatch(src, /new Date\(|Date\.now\(/, `${f}에 시계 직접 호출이 있다 (M6)`);
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test "packages/metrics/test/index.test.ts"`
Expected: FAIL — `Cannot find module '../src/index.ts'`

- [ ] **Step 3: 최소 구현**

`packages/metrics/src/index.ts`:

```ts
export { rate } from "./rate.ts";
export type { Rate } from "./rate.ts";
export { inningsPitched, singles, totalBases } from "./lines.ts";
export type { BattingLine, PitchingLine } from "./lines.ts";
export {
  babip, battingAverage, iso, onBasePercentage, ops, sluggingPercentage, strikeoutRate, walkRate,
} from "./batting.ts";
export { earnedRunAverage, homeRunsPer9, strikeoutsPer9, walksPer9, whip } from "./pitching.ts";
export { leagueConstants, sumBatting, sumPitching } from "./league.ts";
export type { LeagueConstants } from "./league.ts";
export { WOBA_SCALE, WOBA_WEIGHTS, fip, woba, wobaRaw, wraa, wrcPlus } from "./advanced.ts";
export { qualifiedBatterPa, qualifiedPitcherOuts, rankBy } from "./ranking.ts";
export type { RankOptions, Ranked } from "./ranking.ts";
```

- [ ] **Step 4: 전체 검증**

```bash
node --test "packages/*/test/*.test.ts"
npx tsc --noEmit -p packages/metrics/tsconfig.json
```

Expected: 전 테스트 통과(archiver 43본 + metrics 신규분), tsc 종료 코드 0

- [ ] **Step 5: 뮤테이션 검사**

`src/rate.ts`의 `denominator === 0 ? null : ...` 를 `numerator / denominator` 로 임시 변경하고 테스트를 돌린다.
Expected: 「분모가 0이면 value는 null」 계열 테스트가 **실패해야 한다**. 실패하지 않으면 그 테스트는 아무것도 재고 있지 않다. 확인 후 원복한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/metrics
git commit -m "feat(metrics): public API and purity guard

A test asserts the package imports no I/O and never calls the clock
directly, because purity is the whole reason this package exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 지표 정의서

**Files:**
- Create: `docs/metrics/README.md`

**Interfaces:**
- Consumes: Task 1~8의 구현
- Produces: 구현자·검토자가 참조하는 정본 문서

- [ ] **Step 1: 정의서를 쓴다**

`docs/metrics/README.md`에 지표마다 아래 슬롯을 채운다. **`확신도`와 `검증`이 없는 항목은 미완성이다.**

```markdown
### <지표명> (약어)
- 한 줄:    무엇을 재는가
- 산식:     기호를 정의한 완전한 식
- 입력:     필요한 카운팅 스탯
- 리그 상수: 필요 여부와 산출 방법
- 파크팩터:  적용 여부. 미적용이면 그 사실을 라벨에 쓰는가
- 경계값:   분모 0 · 음수 가능성
- 표시:     소수 자릿수 · 반올림
- 확신도:   공식 정의 인용 | 관례(출처) | 우리 정의
- 검증:     T1(공표값 대조) 또는 T2(성질 테스트) — 어느 테스트가 이것을 보장하는가
```

최소 다음 항목을 포함한다: AVG · OBP · SLG · OPS · ISO · BABIP · K% · BB% · ERA · WHIP · K/9 · BB/9 · HR/9 · wOBA · wRAA · wRC+ · FIP · 규정타석 · 규정투구회 · 동률 규칙.

**반드시 명시할 것:**
- wOBA의 `失策出塁` 항을 생략했다는 사실과 그 이유(공개 소스 부재)
- wOBA 계수가 시즌마다 다르며 공개된 것은 1세트뿐이라는 사실 → 절대치가 아니라 wRAA·wRC+로 제시하는 이유
- wRC+에 파크팩터를 적용하지 않는다는 사실과 그 이유(2025~ 2시즌뿐이라 PF 표본 부족)
- **WAR는 산출하지 않는다**는 사실과 그 이유(수비 입력 부재)
- **xFIP는 산출하지 않는다**는 사실과 그 이유(뜬공 비율이 공개 소스에 없음)

- [ ] **Step 2: 커밋**

```bash
git add docs/metrics
git commit -m "docs(metrics): metric definitions with confidence and verification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 이 계획이 스펙에서 벗어나는 점 (스펙 수정 필요)

| 스펙 | 문제 | 조치 |
|---|---|---|
| §3 v1 지표 목록에 **xFIP** 포함 | xFIP는 뜬공 비율(FB%)이 필요한데 **npb.jp 박스스코어에 없다.** 소스 조사에서도 타구질 데이터는 확인되지 않았다 | 이 계획에서 제외. **스펙 §3에서 xFIP를 빼고 「넣지 않는 것」으로 옮긴다** |
| §3 v1 지표 목록에 **RE24 · WPA** 포함 | 둘 다 타석 단위 로그가 필요하므로 이 증분(카운팅 스탯 기반)의 범위가 아니다 | 증분 F(간판 지표)로 이동. 스펙 §13 표에 이미 F가 있으므로 표기만 정리 |

---

## 자체 검토 결과

**스펙 커버리지:** §6.1(계산 규약)은 Task 1·7이, §6.2(리그 상수·PF 미적용)는 Task 5·6이 담당한다. §6.3(간판 지표)은 **이 증분의 범위 밖**이며 증분 F에서 다룬다 — 그 전제가 되는 리그 상수와 순수 함수 골격을 여기서 만든다.

**미해결로 남기는 것:** T1 대조 케이스(실제 선수의 npb.jp 공표 타율·출루율·장타율·방어율)는 **증분 B(파서) 완료 후** 추가한다. 지금은 공표값을 코드로 가져올 경로가 없어 손으로 옮겨 적어야 하는데, 손으로 옮긴 숫자는 그 자체가 오류원이다. Task 3·4의 테스트는 산식 자체를 고정하고, 실제 선수 대조는 파서가 값을 실어 나를 수 있게 된 뒤에 붙인다.
