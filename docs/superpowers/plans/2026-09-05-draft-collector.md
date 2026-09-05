# 드래프트 수집기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** npb.jp 의 드래프트 페이지를 **받아서 아카이브에 넣고**, 그 아카이브를 읽어 **DB 에 적재**한다 — 파서·적재·불변식은 이미 있고, 이 계획은 **그것들을 부르는 사람**을 만든다.

**Architecture:** 기존 수집 관용을 그대로 쓴다 — `PoliteFetcher`(L1) + `LocalSink` + `archiveUrl`. 수집과 적재를 **분리**한다(`cli-stats.ts` 와 `load-archive.ts` 가 그렇다). 드래프트는 **연 1회**라 일일 배치(`update.ts`)에 붙이지 않고 별도 CLI 로 둔다.

**Tech Stack:** Node ≥24 · TypeScript · `node:test` · `node:sqlite`

---

## ⚠이 계획도 실행 이력이 되고 있다 — 초판이 틀린 곳

| 무엇 | 초판 | 실제(정본) |
|---|---|---|
| **호스트** | `https://npb.jp/draft/…` | ⚠**`https://draft.npb.jp/draft/…`** — 초판대로면 **302 → 301 두 번 리다이렉트**라 **1장마다 3요청**이 되고(287장 → **861요청**), 조사 문서 §9-A 가 「**리다이렉트 홉은 간격 밖이다**」라고 적으므로 **L1 의 예의가 2/3 사라진다.** 가운데 홉은 **평문 `http`** 라 식별 UA 가 그대로 나간다. ⚠**픽스처의 `og:url` 이 `npb.jp` 라 속기 쉽다 — 그건 페이지가 스스로 쓴 문자열이지 서버가 어디서 답하는지가 아니다** |
| 본문 디코드 | `gunzipSync(body).toString("utf8")` | ⚠**두 겹으로 틀렸다.** `readBody` 가 **이미 gunzip 해서** 주므로 재-gunzip 은 `incorrect header check`. 고쳐도 `Uint8Array#toString("utf8")` 은 **`Buffer` 가 아니라 인자를 무시**하고 `"60,104,116,…"` 를 낸다 — ⚠**던지지 않아서 파서가 오진하고 드래프트가 조용히 0건이 된다**(크래시보다 나쁘다). `archive.ts` 와 같은 `TextDecoder` 를 쓴다 |
| 파일 배치 | `cli-draft.ts` 한 장 | **`draft.ts`(발견·취득) + `cli-draft.ts`(진입점)** — 진입점에 top-level `parseArgs` 가 있으면 시험이 import 하는 순간 죽는다. 이 패키지의 **지배적 관용**이다(`players.ts`↔`cli-players.ts`). ⚠**`draftTargets` 는 `draft.ts` 에 있다** |
| Task 1 시험 2본째 | `[2001,2005,2026,2027].filter(...)` | ⚠**우리 코드를 하나도 안 지난다 — `cli-draft.ts` 가 비어 있어도 통과한다.** 「아무것도 안 재는 시험」이었고 13본으로 갈았다 |

**정본은 코드다.** 아래 코드는 「무엇을 하려 했는가」로 읽어라.

⚠**호스트는 위 표에 따라 이미 본문에서 고쳤다**(11곳). Task 2·3 의 `DraftProvenance.source` 도 그 값이다.

---

## Global Constraints

이 계획의 **모든 태스크**가 아래를 만족해야 한다. 출처는 `CLAUDE.md` 와 `docs/superpowers/plans/2026-09-04-draft-npb-source.md` 의 짐 목록이다.

- **L1** — 수집은 **1req / 2~5초 · 동시 1커넥션 · 식별 가능한 UA + 연락처**. ⚠**`fetch` 를 직접 부르지 마라.** `PoliteFetcher` 한 벌을 쓴다. 연락처가 없으면 **`exit 2`**.
- **L7** — 조건부 요청(ETag/If-Modified-Since)을 쓴다. `archiveUrl` 이 이미 한다.
- **M5** — 같은 시즌을 두 번 수집·적재해도 결과가 한 번과 같다.
- **M7** — 파서 실패를 빈 값으로 흘리지 마라. **던져야 할 때 던진다.**
- **M11** — **미수집 · 0 · 결측을 구별한다.** ⚠**「부재는 실패가 아니다」**(`cli-stats.ts:99`).
- **M4** — 적재하는 모든 행이 「어디서 · 언제 · 몇 번째 판」에 답한다. `DraftProvenance` 를 채운다.
- **분모를 항상 표기**하고 **「0건」과 「안 쟀음」을 구별**한다. **FAIL 과 ERROR 를 분리해서 센다.**
- ⚠**개발 루프에서 외부 사이트를 히트하지 마라.** 시험은 **가짜 fetch + `MemorySink`** 로 한다(`packages/archiver/test/fetcher-archive.test.ts` 의 관용).

### 이 계획이 반드시 소화해야 할 짐 (앞 계획이 남긴 것)

| 짐 | 어느 태스크가 받는가 |
|---|---|
| **A1** 0건 예외를 「아직」으로 삼키지 마라 | Task 1 |
| **A2 · A12** 「소스가 경합을 안 쓴다」는 **시즌 전체를 봐야** 갈린다 | **Task 2** |
| **A3** 슬러그는 시즌마다 다르다(26개 중 6개만 실측) | Task 1 |
| **A4** 수집 범위 2005~2026 은 **호출자가 자른다** | Task 1 |
| **A5** 파서가 던졌을 때의 회복 | Task 2 |
| **A6 · A11** 불변식은 **시즌 완결 후**에만 | Task 3 |
| **A7** 2005~2007 은 **재시도로 안 풀린다** | Task 2(격리) |
| **A13** `[]` 로 거짓말하는 것은 **G2 가 본다** | Task 2 |
| **A16** 한 키에는 출처가 하나 | Task 2 |
| **G2** 0건인데 `null` 판정을 안 했으면 멈춘다 | Task 2 |
| **G3** `DraftParseError` 한 건이면 그 시즌을 적재하지 않는다 | Task 2 |
| **G1 · G4** 실물 픽스처가 없는 자리 | Task 3(런북에 기록) |

---

## ⚠A7 의 처리 — 이 계획의 가장 큰 결정

**2005~2007 分離ドラフト**에서 한 구단이 두 추첨 구획에 각각 1巡目을 가지면 `firstRoundPick` 이 던진다. 그건 그 제도의 **정상적인 모양**이고, 뿌리가 파서(`parseDraftBids` 가 `※` 로만 잘라 섹션 정보를 잃는다)라 **입력이 같으면 같은 예외가 난다 — 재시도로 절대 안 풀린다.**

**이 계획은 (c) 를 택한다: 수집은 하고, 적재에서 그 시즌을 건너뛰고 명시적으로 보고한다.**

- ⚠**수집은 반드시 한다** — 아카이브가 남으면 나중에 파서를 고쳤을 때 **재적재만 하면 되고 외부 요청이 0**이다.
- ⚠**「조용히 건너뛰지」 않는다** — 건너뛴 시즌과 사유를 **종료 코드와 요약에 낸다**.
- ⚠**화면에 그 3시즌이 빈다.** 그것은 결함이 아니라 **알려진 미완**이고, 파서를 고치는 별도 작업이 후속이다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/archiver/src/cli-draft.ts` (신규) | **받는다.** 연도 색인 → 연도 톱 → 구단 페이지 2단계 발견 + `archiveUrl` |
| `packages/store/tools/load-draft-archive.ts` (신규) | **넣는다.** 아카이브를 **시즌 단위로 모아** `bids` 판정 → `loadDraft` |
| `packages/archiver/test/draft-collect.test.ts` (신규) | 수집 시험 — 가짜 fetch · `MemorySink` |
| `packages/store/test/load-draft-archive.test.ts` (신규) | 적재 시험 — 픽스처 HTML · 메모리 DB |
| `docs/operations/draft-backfill.md` (신규) | 런북 — 실제 수집 절차와 G1~G4 확인 |

⚠**`load-archive.ts`(1,320줄)에 붙이지 않는다** — 그것은 **경기** 아카이브를 날짜별로 순회하는 도구이고, 드래프트는 경로 구조도 주기(연 1회)도 다르다.

⚠**`scripts/update.ts`(일일 배치)에 붙이지 않는다** — 날짜 창 기반이라 연 1회 수집과 층이 다르다.

---

### Task 1: 수집 CLI (`cli-draft.ts`)

> ⚠**이 태스크는 이미 구현됐다**(`b87bcb7`). **아래 코드는 초판이고 세 곳이 틀렸다** —
> 호스트 · **본문 디코드**(`gunzipSync(...).toString("utf8")`) · **시험 2본째**(우리 코드를 하나도 안 지난다).
> **정본은 `packages/archiver/src/{draft,cli-draft}.ts` 와 `test/draft-collect.test.ts`(13본) 다.**
> ⚠**아래에서 복사하지 마라** — 무엇이 왜 틀렸는지는 이 문서 머리의 실행 이력 표에 있다.

**Files:**
- Create: `packages/archiver/src/cli-draft.ts`
- Create: `packages/archiver/test/draft-collect.test.ts`

**Interfaces:**
- Consumes: `PoliteFetcher`·`buildUserAgent`(`./fetcher.ts`) · `LocalSink`(`./sink.ts`) · `systemClock`(`./clock.ts`) · `archiveUrl`·`summarize`·`PageResult`(`./archive.ts`) · `parseDraftYears`·`parseDraftTeamSlugs`·`DraftIndexError`(`@bb-app/parser`)
- Produces: 아카이브 키 규칙 **`npb/draft/{year}/index`** 와 **`npb/draft/{year}/{slug}`** — Task 2 가 이 규칙으로 읽는다

**아카이브 키·URL 규칙** (`cli-stats.ts:53` 의 `npb/stats/${year}/${name}` 관용을 따른다):

| 무엇 | 키 | URL |
|---|---|---|
| 연도 색인 | `npb/draft/backnumber` | `https://draft.npb.jp/draft/backnumber.html` |
| 연도 톱 | `npb/draft/{year}/index` | `https://draft.npb.jp/draft/{year}/` |
| 구단 페이지 | `npb/draft/{year}/{slug}` | `https://draft.npb.jp/draft/{year}/draftlist_{slug}.html` |

- [ ] **Step 1: 실패하는 시험을 쓴다**

Create `packages/archiver/test/draft-collect.test.ts`:

```typescript
/**
 * 드래프트 수집 — **외부 요청 0회**. 가짜 fetch 와 메모리 sink 로만 잰다.
 *
 * ⚠`packages/archiver/test/fetcher-archive.test.ts` 의 하네스 관용을 따른다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftTargets } from "../src/cli-draft.ts";

test("⚠연도 톱과 구단 페이지가 2단계로 발견된다 — 슬러그를 하드코딩하지 않는다", () => {
  const indexHtml = `<a href="/draft/2013/">2013年</a><a href="/draft/2019/">2019年</a>`;
  const yearHtml2013 = `<a href="draftlist_bs.html">オリックス</a><a href="draftlist_g.html">読売</a>`;
  const targets = draftTargets({
    years: [2013],
    slugsByYear: new Map([[2013, ["bs", "g"]]]),
  });
  assert.deepEqual(
    targets.map((t) => t.key),
    ["npb/draft/2013/bs", "npb/draft/2013/g"],
    "⚠2013 오릭스는 bs 다 — b 로 박으면 그 구단이 통째로 빈다",
  );
  assert.equal(targets[0]!.url, "https://draft.npb.jp/draft/2013/draftlist_bs.html");
  // indexHtml·yearHtml2013 은 이 시험에서 직접 안 쓴다 — 발견은 파서가 하고
  // 여기서는 「발견 결과 → 대상 목록」 변환만 잰다(경계를 좁게 유지)
  void indexHtml;
  void yearHtml2013;
});

test("⚠수집 범위를 자르는 것은 호출자다(A4) — 색인은 나열하는 그대로를 준다", () => {
  const inRange = [2001, 2005, 2026, 2027].filter((y) => y >= 2005 && y <= 2026);
  assert.deepEqual(inRange, [2005, 2026], "2001 은 범위 밖 · 2027 도 범위 밖");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/archiver/test/draft-collect.test.ts`
Expected: FAIL — `Cannot find module '../src/cli-draft.ts'`

- [ ] **Step 3: 대상 목록 생성기를 만든다**

Create `packages/archiver/src/cli-draft.ts` — 먼저 **순수 함수 부분만**:

```typescript
/**
 * 드래프트 취득 — **연 1회 배치**.
 *
 * ⚠**일일 배치(`scripts/update.ts`)에 붙이지 않는다** — 날짜 창 기반이라 층이 다르다.
 *
 * ⚠**예의도 멱등도 기존 취득기와 같은 한 벌을 쓴다**(L1·L7·M5·M8) —
 * `PoliteFetcher`(간격 기본 3초 · 동시 1커넥션 · 조건부 요청 · 식별 UA)와 `archiveUrl`.
 * **여기서 `fetch` 를 직접 부르거나 revision 규칙을 새로 쓰지 않는다.**
 *
 * ⚠**슬러그를 하드코딩하지 마라**(A3). 2013 오릭스는 `bs` 이고 2019 는 `b` 다.
 * 실측은 **26개 연도 중 6개**뿐이라 나머지는 「같다」가 아니라 **「안 쟀다」**이다.
 *
 * 사용:
 *   node packages/archiver/src/cli-draft.ts --from 2005 --to 2026 --contact you@example.com
 */
import { parseArgs } from "node:util";
import { PoliteFetcher, buildUserAgent } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { systemClock } from "./clock.ts";
import { archiveUrl, summarize } from "./archive.ts";
import type { PageResult } from "./archive.ts";

/** 아카이브 키 접두. `cli-stats.ts` 의 `npb/stats/...` 와 같은 층이다 */
const KEY_ROOT = "npb/draft";

/** 연도 색인 — 이 한 장이 어느 해가 있는지 말한다 */
export const BACKNUMBER_KEY = `${KEY_ROOT}/backnumber`;
export const BACKNUMBER_URL = "https://draft.npb.jp/draft/backnumber.html";

export function yearIndexKey(year: number): string {
  return `${KEY_ROOT}/${year}/index`;
}
export function yearIndexUrl(year: number): string {
  return `https://draft.npb.jp/draft/${year}/`;
}

export interface DraftTarget {
  readonly key: string;
  readonly url: string;
}

/**
 * 받을 구단 페이지 목록.
 *
 * ⚠**슬러그는 연도마다 다르다** — 그래서 `slugsByYear` 를 받는다. 호출자가
 * `parseDraftTeamSlugs` 로 그 해 연도 톱에서 뽑아 넣는다.
 */
export function draftTargets(input: {
  readonly years: readonly number[];
  readonly slugsByYear: ReadonlyMap<number, readonly string[]>;
}): DraftTarget[] {
  const out: DraftTarget[] = [];
  for (const year of [...input.years].sort((a, b) => a - b)) {
    const slugs = input.slugsByYear.get(year) ?? [];
    for (const slug of [...slugs].sort()) {
      out.push({
        key: `${KEY_ROOT}/${year}/${slug}`,
        url: `https://draft.npb.jp/draft/${year}/draftlist_${slug}.html`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: 시험이 통과하는지 확인한다**

Run: `node --test packages/archiver/test/draft-collect.test.ts`
Expected: PASS 2/2

- [ ] **Step 5: 2단계 발견과 취득 루프를 붙인다**

같은 파일 아래에 이어서:

```typescript
const { values } = parseArgs({
  options: {
    from: { type: "string", default: "2005" },
    to: { type: "string", default: "2026" },
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
    only: { type: "string" },
  },
});

const from = Number(values.from);
const to = Number(values.to);
if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
  console.error("usage: node src/cli-draft.ts --from 2005 --to 2026 --contact <email> [--out DIR] [--only YEAR]");
  process.exit(2);
}

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

const deps = {
  fetcher: new PoliteFetcher({
    userAgent: buildUserAgent(contact),
    minDelayMs: Number(values.delay),
    clock: systemClock,
  }),
  sink: new LocalSink(values.out),
  clock: systemClock,
};

const results: PageResult[] = [];
async function get(key: string, url: string): Promise<PageResult> {
  const r = await archiveUrl(key, url, deps);
  results.push(r);
  console.error(`  ${r.outcome.padEnd(9)} ${url}${r.error === null ? "" : ` — ${r.error}`}`);
  return r;
}

// ── 1단계: 연도 색인 ────────────────────────────────────────────────
console.error(`드래프트 취득 ${from}~${to} · 저장 ${values.out} · 간격 ${values.delay}ms · UA ${buildUserAgent(contact)}`);
await get(BACKNUMBER_KEY, BACKNUMBER_URL);

const backnumberBody = await deps.sink.readBody(BACKNUMBER_KEY);
if (backnumberBody === null) {
  console.error("연도 색인을 못 받았다 — 여기서 멈춘다(무엇을 받을지 모른다)");
  process.exit(1);
}
const { gunzipSync } = await import("node:zlib");
const { parseDraftYears, parseDraftTeamSlugs, DraftIndexError } = await import("@bb-app/parser");

const allYears = parseDraftYears(gunzipSync(backnumberBody).toString("utf8"));
// ⚠**범위를 자르는 것은 호출자다**(A4) — 색인은 사이트가 나열하는 그대로를 준다
const years = allYears.filter((y) => y >= from && y <= to);
console.error(`색인 ${allYears.length}개 중 범위 안 ${years.length}개: ${years.join(" ")}`);

// ── 2단계: 연도 톱 → 구단 슬러그 ────────────────────────────────────
const slugsByYear = new Map<number, string[]>();
const skippedYears: { year: number; why: string }[] = [];

for (const year of years) {
  if (values.only !== undefined && String(year) !== values.only) continue;
  await get(yearIndexKey(year), yearIndexUrl(year));
  const body = await deps.sink.readBody(yearIndexKey(year));
  if (body === null) {
    // ⚠**「부재는 실패가 아니다」**(M11) — 그 해 페이지가 없는 것과 못 받은 것은 다르다
    skippedYears.push({ year, why: "연도 톱을 못 받았다" });
    continue;
  }
  try {
    slugsByYear.set(year, parseDraftTeamSlugs(gunzipSync(body).toString("utf8")));
  } catch (e) {
    // ⚠**A1 — 0건 예외를 「아직」으로 삼키지 마라.** 관측을 그대로 적어 남긴다.
    const why = e instanceof DraftIndexError ? `슬러그 0건(${e.observed})` : String(e);
    skippedYears.push({ year, why });
  }
}

// ── 3단계: 구단 페이지 ──────────────────────────────────────────────
const targets = draftTargets({ years: [...slugsByYear.keys()], slugsByYear });
console.error(`구단 페이지 ${targets.length}장`);
for (const t of targets) await get(t.key, t.url);

const s = summarize(results);
console.error(
  `\n합계: ${s.total}장 (신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`,
);
for (const sk of skippedYears) console.error(`  건너뜀 ${sk.year}: ${sk.why}`);
// ⚠**부재는 실패가 아니다**(M11) · ⚠**건너뛴 해가 있으면 종료코드로 알린다**(A1)
process.exit(s.failed > 0 || skippedYears.length > 0 ? 1 : 0);
```

- [ ] **Step 6: 타입체크와 시험을 돌린다**

Run: `npm run typecheck`
Expected: exit 0

Run: `node --test packages/archiver/test/draft-collect.test.ts`
Expected: PASS 2/2

⚠**파이프가 `$LASTEXITCODE` 를 덮어쓴다** — 종료코드는 파이프 전에 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add packages/archiver/src/cli-draft.ts packages/archiver/test/draft-collect.test.ts
git commit -m "feat(archiver): 드래프트 취득 CLI — 슬러그를 2단계로 발견한다"
```

---

### Task 2: 적재 도구 (`load-draft-archive.ts`)

**Files:**
- Create: `packages/store/tools/load-draft-archive.ts`
- Create: `packages/store/test/load-draft-archive.test.ts`

**Interfaces:**
- Consumes: Task 1 의 키 규칙(`npb/draft/{year}/{slug}`) · `parseDraftPicks`·`parseDraftBids`·`DraftParseError`(`@bb-app/parser`) · `loadDraft`·`DraftLoadInput`·`DraftProvenance`(`@bb-app/store`) · `openDb`(`@bb-app/store`)
- Produces: `loadDraftSeason(db, season, files, opts) => SeasonLoadReport` — Task 3 이 이 반환값으로 불변식을 걸 시점을 안다

**⚠이 태스크가 이 계획의 심장이다.** 아래 넷을 **한 자리에서** 풀어야 한다:

| # | 무엇 | 왜 여기인가 |
|---|---|---|
| **A2·A12** | `bids: null` 판정 | **시즌 전 구단을 다 읽은 뒤에야** 갈린다 — 2019 히로시마도 `※` 0건이다 |
| **G2** | 0건인데 `null` 판정을 안 했으면 멈춘다 | 같은 자리에서 판정하므로 같은 자리에서 검사한다 |
| **G3** | `DraftParseError` 한 건이면 그 시즌을 안 넣는다 | 부분 적재는 「그 해는 원래 그렇다」로 읽힌다 |
| **A7** | 2005~2007 격리 | 재시도로 안 풀리므로 **건너뛴 사실을 남긴다** |

- [ ] **Step 1: 실패하는 시험을 쓴다**

Create `packages/store/test/load-draft-archive.test.ts`:

```typescript
/**
 * 드래프트 적재 — 아카이브 HTML → DB.
 *
 * ⚠**시즌 단위로 모아서 판정한다.** 구단 하나만 보면
 * 「소스가 경합을 안 쓴다」와 「이 구단은 안 겹쳤다」를 구별할 수 없다(A2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { decideBids, type TeamPage } from "../tools/load-draft-archive.ts";

const PROV = { source: "https://draft.npb.jp/draft/2023/", fetchedAt: "2026-09-05T00:00:00.000Z", revision: "h" };

test("⚠시즌 전 구단에 경합이 0건이면 bids 는 null 이다 — 「소스가 안 쓴다」(A2)", () => {
  const pages: TeamPage[] = [
    { team: "c", picks: [], bids: [] },
    { team: "h", picks: [], bids: [] },
  ];
  const d = decideBids(pages);
  assert.equal(d.sourceWritesBids, false, "한 구단도 경합을 안 적었다");
  assert.equal(d.forTeam("c"), null, "⚠null 이다 — [] 로 주면 단독지명이 유도된다");
});

test("⚠한 구단이라도 경합을 적었으면 나머지는 [] 다 — 「안 겹쳤다」(M11)", () => {
  const pages: TeamPage[] = [
    { team: "s", picks: [], bids: [{ team: "s", roundNo: 1, rivals: ["読売"], nameDisplay: "X", won: true }] },
    { team: "c", picks: [], bids: [] },
  ];
  const d = decideBids(pages);
  assert.equal(d.sourceWritesBids, true);
  assert.deepEqual(d.forTeam("c"), [], "⚠null 이 아니다 — 히로시마는 진짜로 안 겹친 것이다");
  assert.equal(d.forTeam("s")!.length, 1);
});

test("⚠G2 — 0건인데 null 판정을 안 하면 그 자체가 결함이다", () => {
  const pages: TeamPage[] = [{ team: "c", picks: [], bids: [] }];
  const d = decideBids(pages);
  assert.equal(d.sourceWritesBids, false);
  assert.equal(d.forTeam("c"), null, "판정이 자동으로 따라온다 — 호출자가 잊을 수 없다");
});

test("⚠빈 시즌(구단 0장)은 판정 대상이 아니다 — 「안 쟀음」과 「0건」을 구별한다(M11)", () => {
  assert.throws(() => decideBids([]), /구단 페이지가 0장/);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/load-draft-archive.test.ts`
Expected: FAIL — `Cannot find module '../tools/load-draft-archive.ts'`

- [ ] **Step 3: 판정기를 만든다**

Create `packages/store/tools/load-draft-archive.ts`:

```typescript
/**
 * 드래프트 적재 — 아카이브(`npb/draft/{year}/{slug}.html.gz`) → DB.
 *
 * ⚠**`load-archive.ts` 에 붙이지 않았다** — 그것은 경기 아카이브를 날짜별로 순회하는
 * 도구이고, 드래프트는 경로 구조도 주기(연 1회)도 다르다.
 *
 * ⚠**시즌 단위로 모은다.** 구단 하나만 보면 「소스가 경합을 안 쓴다」와
 * 「이 구단은 안 겹쳤다」를 구별할 수 없다(A2) — 2019 히로시마도 `※` 0건이다.
 */
import type { DraftPickRow, DraftBidRow } from "@bb-app/parser";

export interface TeamPage {
  readonly team: string;
  readonly picks: DraftPickRow[];
  readonly bids: DraftBidRow[];
}

export interface BidsDecision {
  /** 이 시즌 소스가 경합을 **적기는 하는가**. 한 구단이라도 적었으면 true */
  readonly sourceWritesBids: boolean;
  /**
   * 그 구단에 넘길 `bids` 값.
   *
   * ⚠**`null` 과 `[]` 는 다른 말이다**(M11):
   *   `null` = 「이 시즌 소스는 경합을 아예 안 쓴다」 → 단독지명을 **유도하지 않는다**
   *   `[]`   = 「소스가 말했고, 이 구단은 아무와도 안 겹쳤다」 → 유도한다
   */
  forTeam(team: string): DraftBidRow[] | null;
}

/**
 * ⚠**G2 를 여기서 지킨다.** 「0건인데 `null` 판정을 안 했다」가 **구조적으로 불가능**하다 —
 * 판정이 자동으로 따라오므로 호출자가 잊을 수 없다.
 */
export function decideBids(pages: readonly TeamPage[]): BidsDecision {
  if (pages.length === 0) {
    // ⚠「안 쟀음」과 「0건」을 구별한다(M11). 구단이 0장이면 판정할 대상이 없다.
    throw new Error("구단 페이지가 0장이다 — 판정할 수 없다");
  }
  const writes = pages.some((p) => p.bids.length > 0);
  const byTeam = new Map(pages.map((p) => [p.team, p.bids]));
  return {
    sourceWritesBids: writes,
    forTeam(team: string): DraftBidRow[] | null {
      if (!writes) return null;
      return byTeam.get(team) ?? [];
    },
  };
}
```

- [ ] **Step 4: 시험이 통과하는지 확인한다**

Run: `node --test packages/store/test/load-draft-archive.test.ts`
Expected: PASS 4/4

- [ ] **Step 5: 시즌 적재 루프를 붙인다 — G3 · A7 · A16**

같은 파일에 이어서:

```typescript
import { readFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseDraftPicks, parseDraftBids, DraftParseError } from "@bb-app/parser";
import { loadDraft } from "../src/draft.ts";
import type { Db } from "../src/db.ts";
import type { DraftProvenance } from "../src/draft.ts";

/**
 * 아카이브에서 읽은 한 구단 페이지 + **그 판의 출처**.
 *
 * ⚠**`revision`·`fetchedAt` 은 사이드카(`{slug}.meta.json`)에서 온다**(M4) —
 * Step 6 이 그것을 읽는 코드를 넣는다. 여기서는 타입만 먼저 세운다.
 */
export interface TeamPageWithMeta extends TeamPage {
  readonly revision: string;
  readonly fetchedAt: string;
}

export interface SeasonLoadReport {
  readonly season: number;
  /** 적재했는가. false 면 아래 `skipped` 가 사유를 갖는다 */
  readonly loaded: boolean;
  readonly teams: number;
  readonly picks: number;
  readonly bids: number;
  readonly skipped: string | null;
  /** ⚠**소스가 경합을 안 쓰는 시즌**(2023~2026). 화면이 「데이터 없음」으로 그리면 거짓이다(B2) */
  readonly sourceWritesBids: boolean;
}

/** 그 시즌 아카이브에서 구단 페이지를 읽는다. `index` 는 연도 톱이라 제외한다 */
async function readTeamPages(archiveRoot: string, season: number): Promise<TeamPage[]> {
  const dir = join(archiveRoot, "npb", "draft", String(season));
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: TeamPage[] = [];
  for (const f of entries.sort()) {
    if (!f.endsWith(".html.gz")) continue;
    const slug = f.slice(0, -".html.gz".length);
    if (slug === "index") continue;
    const html = gunzipSync(await readFile(join(dir, f))).toString("utf8");
    // ⚠던지면 그대로 올린다(M7·G3) — 여기서 삼키면 「그 해는 원래 그렇다」가 된다
    out.push({ team: slug, picks: parseDraftPicks(html, slug), bids: parseDraftBids(html, slug) });
  }
  return out;
}

export async function loadDraftSeason(
  db: Db,
  season: number,
  opts: { readonly archiveRoot: string; readonly fetchedAt: string },
): Promise<SeasonLoadReport> {
  // ⚠**Step 6 에서 `readTeamPages` 가 `TeamPageWithMeta[]` 를 내게 바뀐다.**
  //   이 선언도 그때 함께 바꿔라 — 안 바꾸면 `p.revision` 에서 타입 오류가 난다.
  let pages: TeamPageWithMeta[];
  try {
    pages = await readTeamPages(opts.archiveRoot, season);
  } catch (e) {
    // ⚠**G3 — 한 건이라도 던지면 그 시즌을 통째로 안 넣는다.** 부분 적재는 거짓말이 된다.
    // ⚠**A7 — 2005~2007 分離ドラフト는 여기서 걸리고 재시도로 안 풀린다**(입력이 같으면 같은 예외).
    const why = e instanceof DraftParseError ? `${e.message} (${e.detail})` : String(e);
    return { season, loaded: false, teams: 0, picks: 0, bids: 0, skipped: why, sourceWritesBids: false };
  }
  if (pages.length === 0) {
    return { season, loaded: false, teams: 0, picks: 0, bids: 0, skipped: "구단 페이지가 0장", sourceWritesBids: false };
  }

  const decision = decideBids(pages);
  const event: DraftProvenance = {
    source: `https://draft.npb.jp/draft/${season}/`,
    fetchedAt: opts.fetchedAt,
    revision: `season-${season}`,
  };

  let picks = 0;
  let bids = 0;
  for (const p of pages) {
    const page: DraftProvenance = {
      source: `https://draft.npb.jp/draft/${season}/draftlist_${p.team}.html`,
      fetchedAt: opts.fetchedAt,
      revision: `${season}-${p.team}`,
    };
    // ⚠**A16 — 한 키에는 출처가 하나다.** `loadDraft` 가 `origin='npb'` 만 지운다.
    const r = loadDraft(db, { season, team: p.team, picks: p.picks, bids: decision.forTeam(p.team), page, event });
    picks += r.picks;
    bids += r.bids;
  }
  return {
    season,
    loaded: true,
    teams: pages.length,
    picks,
    bids,
    skipped: null,
    sourceWritesBids: decision.sourceWritesBids,
  };
}
```

⚠**`revision` 을 위처럼 두면 M4 의 「몇 번째 판」이 약해진다.** 실제 판은 아카이브 사이드카(`.meta.json`)에 있다 — **Step 6 에서 그것을 읽어 채운다.**

- [ ] **Step 6: `revision` 을 사이드카에서 읽는다 (M4)**

`readTeamPages` 를 고쳐 `.meta.json` 의 값을 함께 반환한다. ⚠**타입은 Step 5 에서 이미 세웠다** — 여기서는 **읽는 코드만** 넣는다:

```typescript
async function readTeamPages(archiveRoot: string, season: number): Promise<TeamPageWithMeta[]> {
  const dir = join(archiveRoot, "npb", "draft", String(season));
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: TeamPageWithMeta[] = [];
  for (const f of entries.sort()) {
    if (!f.endsWith(".html.gz")) continue;
    const slug = f.slice(0, -".html.gz".length);
    if (slug === "index") continue;
    const html = gunzipSync(await readFile(join(dir, f))).toString("utf8");
    const metaRaw = await readFile(join(dir, `${slug}.meta.json`), "utf8").catch(() => null);
    if (metaRaw === null) {
      // ⚠**출처 없이 넣지 않는다**(M4). 사이드카가 없으면 그 판을 말할 수 없다.
      throw new Error(`${season}/${slug}: 사이드카(.meta.json)가 없다 — 출처를 말할 수 없다`);
    }
    const meta = JSON.parse(metaRaw) as { revision?: string; fetchedAt?: string };
    if (typeof meta.revision !== "string" || typeof meta.fetchedAt !== "string") {
      throw new Error(`${season}/${slug}: 사이드카에 revision/fetchedAt 이 없다`);
    }
    out.push({
      team: slug,
      picks: parseDraftPicks(html, slug),
      bids: parseDraftBids(html, slug),
      revision: meta.revision,
      fetchedAt: meta.fetchedAt,
    });
  }
  return out;
}
```

그리고 `loadDraftSeason` 안의 `page` 를 이렇게 바꾼다:

```typescript
    const page: DraftProvenance = {
      source: `https://draft.npb.jp/draft/${season}/draftlist_${p.team}.html`,
      fetchedAt: p.fetchedAt,
      revision: p.revision,
    };
```

⚠**`opts.fetchedAt` 은 이제 `event`(연도 톱) 전용이다.** 연도 톱의 사이드카도 같은 방식으로 읽는 것이 옳지만, **이 태스크에서는 `index.meta.json` 을 읽어 `event` 에 넣는다** — 아래 시험이 그것을 고정한다.

- [ ] **Step 7: 사이드카 시험을 더한다**

`packages/store/test/load-draft-archive.test.ts` 에 추가:

```typescript
test("⚠사이드카가 없으면 던진다 — 출처 없이 넣지 않는다(M4)", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { gzipSync } = await import("node:zlib");
  const { loadDraftSeason } = await import("../tools/load-draft-archive.ts");
  const { openDb } = await import("../src/db.ts");

  const root = await mkdtemp(join(tmpdir(), "bb-draft-"));
  const dir = join(root, "npb", "draft", "2019");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "g.html.gz"), gzipSync("<html></html>"));
  // ⚠사이드카를 일부러 안 만든다

  const db = openDb(":memory:", "2026-09-05T00:00:00.000Z");
  const r = await loadDraftSeason(db, 2019, { archiveRoot: root, fetchedAt: "2026-09-05T00:00:00.000Z" });
  db.close();
  assert.equal(r.loaded, false, "적재하지 않았다");
  assert.match(r.skipped ?? "", /사이드카|출처/, "사유가 기록됐다");
});
```

- [ ] **Step 8: 돌린다**

Run: `node --test packages/store/test/load-draft-archive.test.ts`
Expected: PASS 5/5

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 9: 커밋**

```bash
git add packages/store/tools/load-draft-archive.ts packages/store/test/load-draft-archive.test.ts
git commit -m "feat(store): 드래프트 적재 — 시즌 단위로 모아 bids 를 판정한다"
```

---

### Task 3: 시즌 검사 연결과 런북

**Files:**
- Create: `docs/operations/draft-backfill.md`
- Modify: `packages/store/tools/load-draft-archive.ts` (CLI 진입점 추가)
- Modify: `packages/store/test/load-draft-archive.test.ts` (검사 시점 시험 추가)

**Interfaces:**
- Consumes: Task 2 의 `loadDraftSeason` → `SeasonLoadReport`
- Produces: `node packages/store/tools/load-draft-archive.ts --db data/bb.sqlite --archive data/archive --from 2005 --to 2026`

- [ ] **Step 1: 검사 시점 시험을 쓴다**

`packages/store/test/load-draft-archive.test.ts` 에 추가:

```typescript
test("⚠불변식은 시즌이 다 들어온 뒤에만 건다(A6) — 중간 상태의 붉음은 결함이 아니다", async () => {
  const { checkableInvariants } = await import("../tools/load-draft-archive.ts");
  const full = { loaded: true, teams: 12, sourceWritesBids: true } as never;
  assert.deepEqual(checkableInvariants(full), ["INV-4", "INV-4b", "INV-5", "INV-N1", "INV-N2", "INV-N3"]);
  assert.deepEqual(checkableInvariants({ loaded: true, teams: 7, sourceWritesBids: true } as never), [],
    "⚠아직 덜 들어왔다 — 걸면 헛불이다");
  assert.deepEqual(checkableInvariants({ loaded: false, teams: 0, sourceWritesBids: false } as never), [],
    "안 들어온 시즌은 검사 대상이 아니다");
});

test("⚠경합을 안 쓰는 시즌은 INV-N2 만 걸 수 있다(A14) — 나머지는 구조적으로 붉다", async () => {
  const { checkableInvariants } = await import("../tools/load-draft-archive.ts");
  // 2023~2026: bids 가 null 이라 draft_bid 가 0행이다.
  // INV-4 는 분모를 draft_pick 에서 얻는데 획득은 영원히 0 → 만족 불가.
  // INV-4b·5·N1·N3 는 분모 0 → assertClean 이 실패시킨다.
  assert.deepEqual(
    checkableInvariants({ loaded: true, teams: 12, sourceWritesBids: false } as never),
    ["INV-N2"],
    "⚠INV-N2 만 남는다 — 그것만 분모를 draft_pick 에서 얻는다",
  );
});

test("⚠2005~2007 은 재시도로 안 풀린다(A7) — 건너뛴 사실이 보고에 남는다", async () => {
  const { summarizeSeasons } = await import("../tools/load-draft-archive.ts");
  const s = summarizeSeasons([
    { season: 2006, loaded: false, teams: 0, picks: 0, bids: 0, skipped: "1巡目이 두 구획에 있다", sourceWritesBids: false },
    { season: 2019, loaded: true, teams: 12, picks: 100, bids: 14, skipped: null, sourceWritesBids: true },
  ]);
  assert.equal(s.loaded, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.exitCode, 1, "⚠건너뛴 시즌이 있으면 종료코드로 알린다 — 조용히 넘어가지 않는다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/load-draft-archive.test.ts`
Expected: FAIL — `checkableInvariants is not a function`

- [ ] **Step 3: 구현한다**

`packages/store/tools/load-draft-archive.ts` 에 추가:

```typescript
/**
 * 그 시즌에 **실제로 걸 수 있는** 불변식 목록.
 *
 * ⚠**A6** — 12구단이 다 들어오기 전에는 아무것도 안 건다. 중간 상태에서 INV-N1 이
 * 붉은 것은 결함이 아니라 **시즌이 덜 들어온 것**이고, 헛불이 일상이 되면
 * 진짜 위반도 안 읽힌다.
 *
 * ⚠**A14** — `sourceWritesBids === false` 인 시즌(2023~2026)은 `draft_bid` 가
 * **0행**이라 여섯 중 다섯이 **구조적으로 붉다**:
 *   `INV-4`  는 분모를 `draft_pick` 에서 얻는데 획득은 영원히 0 → **만족 불가**
 *   `INV-4b`·`INV-5`·`INV-N1`·`INV-N3` 는 **분모 0** → `assertClean` 이 실패시킨다
 * **남는 것은 `INV-N2` 하나뿐**이다 — 그것만 분모를 `draft_pick` 에서 얻는다.
 */
export function checkableInvariants(r: SeasonLoadReport): string[] {
  if (!r.loaded || r.teams < 12) return [];
  if (!r.sourceWritesBids) return ["INV-N2"];
  return ["INV-4", "INV-4b", "INV-5", "INV-N1", "INV-N2", "INV-N3"];
}

export interface SeasonsSummary {
  readonly loaded: number;
  readonly skipped: number;
  readonly noBidsSource: number;
  readonly exitCode: 0 | 1;
}

export function summarizeSeasons(reports: readonly SeasonLoadReport[]): SeasonsSummary {
  const loaded = reports.filter((r) => r.loaded).length;
  const skipped = reports.filter((r) => !r.loaded).length;
  // ⚠**B2** — 소스가 경합을 안 쓰는 시즌을 따로 센다. 화면이 「데이터 없음」으로 그리면 거짓이다.
  const noBidsSource = reports.filter((r) => r.loaded && !r.sourceWritesBids).length;
  return { loaded, skipped, noBidsSource, exitCode: skipped > 0 ? 1 : 0 };
}
```

- [ ] **Step 4: CLI 진입점을 붙인다**

같은 파일 끝에:

```typescript
// ── CLI ─────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseArgs } = await import("node:util");
  const { openDb } = await import("../src/db.ts");
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "data/bb.sqlite" },
      archive: { type: "string", default: "data/archive" },
      from: { type: "string", default: "2005" },
      to: { type: "string", default: "2026" },
    },
  });
  const nowIso = new Date().toISOString();
  const db = openDb(values.db!, nowIso);
  const reports: SeasonLoadReport[] = [];
  for (let y = Number(values.from); y <= Number(values.to); y += 1) {
    const r = await loadDraftSeason(db, y, { archiveRoot: values.archive!, fetchedAt: nowIso });
    reports.push(r);
    const mark = r.loaded ? `구단 ${r.teams} · 지명 ${r.picks} · 입찰 ${r.bids}` : `건너뜀 — ${r.skipped}`;
    // ⚠**무엇을 걸 수 있는지 찍는다**(A6·A14) — 실 DB 검사 도구가 아직 없으므로
    //   사람이 이 줄을 보고 판단한다. 「전부 걸 수 있다」고 침묵하지 않는다.
    const inv = checkableInvariants(r);
    const invNote = r.loaded ? `  검사가능 ${inv.length === 6 ? "전부" : inv.join(",") || "없음"}` : "";
    const bidsNote = r.loaded && !r.sourceWritesBids ? "  ⚠이 시즌 소스는 경합을 안 쓴다" : "";
    console.error(`  ${y}  ${mark}${bidsNote}${invNote}`);
  }
  db.close();
  const s = summarizeSeasons(reports);
  console.error(`\n합계: 적재 ${s.loaded}시즌 / 건너뜀 ${s.skipped}시즌 / 경합 없는 소스 ${s.noBidsSource}시즌`);
  process.exit(s.exitCode);
}
```

- [ ] **Step 5: 돌린다**

Run: `node --test packages/store/test/load-draft-archive.test.ts`
Expected: PASS 8/8

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: 런북을 쓴다**

Create `docs/operations/draft-backfill.md`:

```markdown
# 드래프트 소급 수집 런북

## 무엇을 하는가

npb.jp 의 드래프트 페이지를 **연 1회** 받아 아카이브에 넣고, 그것을 DB 에 적재한다.
⚠**일일 배치(`daily.yml`)에 붙어 있지 않다** — 손으로 돌린다.

## 절차

### 1. 수집 (외부 요청 · 약 15~25분)

    node packages/archiver/src/cli-draft.ts --from 2005 --to 2026 --contact <연락처>

⚠**연락처는 필수다**(L1). 없으면 `exit 2`.
⚠**간격 기본 3초**를 줄이지 마라 — `--delay` 는 늘릴 때만 쓴다.

### 2. 적재

    node packages/store/tools/load-draft-archive.ts --db data/bb.sqlite --archive data/archive

### 3. 불변식

    node --test scripts/test/draft-invariants.test.ts

⚠**이것은 합성 데이터로 도는 시험이지 실 DB 검사가 아니다.** 실 DB 에 거는 도구는
**아직 없다**(이 계획 밖). 적재 도구가 시즌마다 `checkableInvariants` 로 **무엇을 걸 수 있는지**
찍어 주므로, 그것을 보고 판단한다.

⚠**2023~2026 은 `INV-N2` 하나만 걸 수 있다**(A14) — 나머지 다섯은 `draft_bid` 가 0행이라
**구조적으로 붉다.** 그 붉음을 결함으로 읽지 마라.

## ⚠나오면 정상인 것

- **2005·2006·2007 이 「건너뜀」으로 나온다**(A7). 分離ドラフト에서 한 구단이 두 구획에
  1巡目을 갖는 것이 정상인데 `firstRoundPick` 이 던진다. **재시도로 안 풀린다** —
  파서가 `※` 로만 잘라 섹션 정보를 잃는 것이 뿌리다. **아카이브는 남으므로
  파서를 고치면 재적재만 하면 되고 외부 요청은 0이다.**
- **2023~2026 이 「이 시즌 소스는 경합을 안 쓴다」로 나온다**(B2). npb 가 2023 부터
  경합 주석을 안 쓴다(**12구단 전수 0/12** 실측). ⚠**「데이터 없음」이 아니다** —
  경합은 실제로 있었고 우리가 그 소스를 안 가진 것뿐이다.

## ⚠아직 못 지키는 게이트

- **G1** — 2007 세이부의 `<br>` 없는 결합 주석이 **합성 픽스처로만** 검증된다.
  2007 을 적재하게 되면(A7 이 풀리면) **그 전에 실물을 픽스처로 고정하라.**
- **G4** — `確定`(당첨) 주석이 실린 실물이 픽스처에 **0건**이라 INV-N3 의 전제를
  저장소 안에서 재현할 수 없다. **수집 후 실물이 생기면 한 장을 픽스처로 고정하라.**
```

- [ ] **Step 7: 커밋**

```bash
git add packages/store/tools/load-draft-archive.ts packages/store/test/load-draft-archive.test.ts docs/operations/draft-backfill.md
git commit -m "feat(store): 시즌 검사 시점과 런북 — 건너뛴 시즌을 종료코드로 알린다"
```

---

## 이 계획 밖

| 후속 | 왜 여기 없는가 |
|---|---|
| **실제 수집 실행** | 외부 요청 264~330장이라 **사용자 승인**이 필요하다. 런북대로 돌린다 |
| **화면** | 데이터가 들어간 뒤. 설계는 `specs/2026-09-04-draft-page-design.md` 에 있다 |
| **A7 파서 수정** | `parseDraftBids` 가 섹션 정보를 보존하게 고치는 별도 작업. **이 계획은 그 시즌을 격리만 한다** |
| **wikipedia 파서** | 2023~2026 경합. 3단계 게이트(2005~2022 npb 대조 불일치 0) 뒤에 |
| **실 DB 불변식 검사 도구** | 지금 불변식은 **합성 데이터로 도는 시험**뿐이다. 실 DB 에 거는 도구는 데이터가 들어간 뒤에 만든다 — ⚠**만들 때 `assertClean` 을 함께 꺼내라**(**A8**: 검사기 자체는 `{checked:0, violations:[]}` 를 내고 **분모 0을 실패로 만드는 것은 하네스의 `assertClean` 뿐**이다) |
| **A10** INV-2 | 「1巡目k 낙첨 = 1巡目k+1 참가」는 이제 **npb 단독으로 계산된다**(`draft_bid(round_no, team, won)` 이면 충분). 이월 사유가 틀렸었다 — 데이터가 들어간 뒤 바로 만들 수 있다 |
| **A9 · A15 · A17** | **A9**(문서층 오탐 방향 · 264페이지) · **A15**(주석 짝 검사 실패 표면)는 **실제 수집 뒤에 실물로 재야** 뜻이 있다. **A17**(경계 배선을 시험이 지키게)은 언제든 |
