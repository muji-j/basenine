# 드래프트 — npb.jp 소스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** npb.jp 의 드래프트 페이지에서 **2005~2026 의 지명 명단과 1순위 경합·추첨**을 읽어 DB에 넣는다.

**Architecture:** 소스별 파서 1벌(`packages/parser/src/draft.ts`) → 적재(`packages/store`) →
수집(`packages/archiver`). 드래프트는 **`player` 의 속성이 아니라 독립 이벤트 표**다.
화면과 wikipedia 파서는 **이 계획 밖**(후속 계획).

**Tech Stack:** Node ≥24 · TypeScript · SQLite(better-sqlite3 계열 래퍼 `packages/store/src/db.ts`) ·
`node:test` + `node:assert/strict`.

## Global Constraints

- **설계 정본**: `docs/superpowers/specs/2026-09-04-draft-page-design.md`
- **파싱 규칙 정본**: `docs/sources/2026-09-04-draft-wikipedia-markup-rules.md`(§3 npb 주석 문법)
- **소스 판정 정본**: `docs/sources/2026-09-04-draft-source-survey.md`
- **M7** 파싱 실패는 **빈 값이 아니라 예외**. 이 저장소는 `StatsParseError` 처럼 **파서별 에러 클래스**를 던진다.
- **M11** 미수집 / 미지명(`---`) / 0 을 구별한다.
- **M10** 이름 문자열로 조인하지 않는다. `player_id` 는 nullable.
- **M4** 드래프트 표는 `source`·`fetched_at`·`revision` 을 **자체 컬럼**으로 갖는다
  (경기와 달리 부모를 타고 답할 상대가 없다).
- **L1** 외부 요청은 1req/2~5초 · 동시 1커넥션. ⚠**개발 루프에서 외부를 치지 않는다** — 고정 픽스처로.
- 픽스처는 **`packages/parser/test/fixtures/`**(추적됨). ⚠`docs/sources/samples/` 는 **무추적**이라
  클론에 0파일이다.
- 마이그레이션 다음 번호는 **019**(018 이 마지막).

⚠**설계 정정**: 설계 §7 의 1단계 완료 판정이 「X-3 통과」인데 **X-3 은 npb↔wikipedia 대조라
wikipedia 파서(3단계) 없이는 못 돌린다.** 이 계획에서는 **INV-4·INV-5 와 npb 내부 대조**로 판정한다.

---

## ⚠이 계획은 실행 이력이다 — 아래 SQL·코드를 그대로 베끼지 마라

**구현이 이 계획을 여러 곳에서 벗어났고, 벗어난 쪽이 옳았다.** 실물과 대조되기 전의 코드는 가설이었다.

| 무엇 | 계획 | 실제(정본) |
|---|---|---|
| `kind` | **4종** | **6종** — `jiyuu_kakutoku`·`kibou_nyudanwaku` 추가. `自由獲得選手`·`希望入団枠獲得選手` 는 **회차 없는 별도 제도**라 `shihaika` 로 접으면 1巡目과 구별 불가 |
| `roundNo` | `number` | **`number \| null`** — 회차 없는 지명이 실재한다 |
| `（選択権なし）` 필터 | 전각 패턴 | ⚠**NFKC 뒤라 원리적으로 안 맞았다.** 2006 에서 가짜 선수 3건 |
| 칸 수 | 4칸 고정 | **4칸 / 5칸**(2006 은 연령 포함) — 4개로 분해하면 **예외 없이 열이 밀린다** |
| 스키마 제약 | 없음 | `STRICT` · `CHECK` · `REFERENCES player` · PK 재설계 |
| `position` | 검증 없음 | **4종 밖이면 던진다**(M7 · `roster.ts` 와 어휘 공유) |
| `BID_RE`(경합 주석) | 전각 `（第N回）` 전제 | ⚠**실물 3건 중 0건 통과.** 전각 `（第N回）` 와 반각 `1巡目` 이 **NFKC 를 걸어도 안 걸어도 양립 불가**였다 — 폭 관용으로 다시 씀 |

**정본은 코드와 마이그레이션 파일이다.** 이 계획은 「무엇을 하려 했는가」의 기록으로만 읽어라.

⚠**전각/반각 경계에서 두 번 같은 방식으로 틀렸다**(`（選択権なし）` · `BID_RE`). 계획에 정규식을 쓸 때
**실물에 걸어 보기 전까지는 전부 가설**로 취급하라 — 둘 다 「그럴듯한데 실물 0건 통과」였다.

---

## ⚠백필 게이트 — 소급 시즌을 넣기 전에 반드시 통과할 것

**Task 4 검수(2026-09-05)가 남긴 조건이다. 여기 있는 이유는 원장(`.superpowers/`)이 무추적이라 사라지기 때문이다.**

| # | 게이트 | 왜 |
|---|---|---|
| **G1** | **2007 세이부 페이지를 실물 픽스처로 고정한 뒤에 2007 을 적재한다** | `<br>` 없이 `※` 가 연달아 붙는 결합 케이스가 지금 **합성 문자열로만** 검증된다. ⚠**이 저장소는 「합성 픽스처로는 검증되지 않는다」를 사고로 기록해 뒀다**(구형 박스 파서 · `CLAUDE.md` §2-2). 지금 것은 그때보다 낫지만(필드 4개를 실측값으로 단언한다) **입력 문자열 자체가 상상**인 것은 같다 |
| **G2** | **시즌마다 경합 주석 건수를 세고 0건이면 멈춘다** | 이 파서는 **실패와 정답이 같은 모양**이다(0건 = 단독지명뿐인 해의 정답이기도 하다). M7 그물이 문법 붕괴는 잡지만 **`※` 자체가 사라진 개편**은 못 잡는다 |
| **G3** | **`DraftParseError` 가 한 건이라도 나면 그 시즌을 적재하지 않는다** | 부분 적재는 「그 해는 원래 그렇다」로 읽힌다 — 2018 오릭스 `bs` 사고와 같은 모양 |

⚠**G1 을 「나중에」로 미루지 마라.** 2007 을 적재하는 커밋과 픽스처를 고정하는 커밋은 **같은 라운드**에 있어야 한다.

---

### Task 1: 마이그레이션 019 — 드래프트 4표

**Files:**
- Create: `packages/store/migrations/019-draft.sql`
- Test: `packages/store/test/provenance.test.ts` (기존 · 새 표를 자동으로 검사한다)

**Interfaces:**
- Produces: 표 `draft_event` · `draft_bid` · `draft_pick` · `draft_note`

- [ ] **Step 1: 기존 provenance 시험이 무엇을 요구하는지 읽는다**

Run: `node --test packages/store/test/provenance.test.ts`
Expected: PASS (현재 상태). 이 시험은 **빈 DB에 마이그레이션만 적용해 스키마를 본다** —
새 표가 출처 컬럼 없이 생기면 **그날 바로 붉어진다.**

- [ ] **Step 2: 마이그레이션을 쓴다**

Create `packages/store/migrations/019-draft.sql`:

⚠**이 블록은 검수 지적 5건 반영 후로 갱신했다**(2026-09-05). 최초 구현이 아래 그대로 옮겨
`STRICT`·`CHECK`·FK·PK 결함을 그대로 물려받았다 — 이 블록 자체가 브리프였다는 뜻이고,
**다음에 이 계획을 참고하는 사람이 낡은 SQL을 다시 베끼지 않도록** 여기도 고친다.
실제 사유는 `packages/store/migrations/019-draft.sql` 파일 머리말에 전부 적혀 있다(요약만 아래에).

```sql
-- 019 드래프트 회의 — 지명·1순위 입찰·사후 사실
--
-- ⚠**드래프트는 `player` 의 속성이 될 수 없다.** 011 이 `player.draft` 에
-- `2000年ドラフト5位` 원문을 넣었지만 그것으로는 지명 구단도 경합도 추첨도 답하지 못한다.
-- 더 근본적으로 **「추첨에서 진 구단」은 그 선수와 아무 기록도 안 남긴다** — 선수 단위로
-- 표현 자체가 불가능하다. 그리고 지명된 선수의 상당수가 `player` 에 영영 없다
-- (입단 거부 · 은퇴 · 1군 미등록). 그래서 독립 이벤트 표다.
--
-- ⚠**M4 를 자체 컬럼으로 갖는다.** 경기 데이터는 `game_id` 로 부모를 타고 출처를 답하지만
-- 드래프트에는 그 부모가 없다. npb.jp 는 `ETag`·`Last-Modified` 를 주지 않으므로
-- `revision` 은 **본문 해시**다.
--
-- ⚠**`won` 이 3값이다**: 1=당첨 · 0=낙첨 · NULL=단독지명.
-- **단독지명은 어느 소스도 적지 않는다** — 경합 그룹의 여집합으로 유도한다.
-- 셋을 같은 값으로 쓰면 「경합에서 이겼다」와 「아무도 안 겹쳤다」가 섞인다(M11).
--
-- ⚠**4표 전부 `STRICT`** — 이 저장소 관용(018·010 참조).
-- ⚠**`kind`·`won`·`origin`·`waiver_dir`·`note_kind` 에 `CHECK`** — 003·010 관용.
-- ⚠**`player_id` 는 `REFERENCES player (player_id)`** — 이 저장소의 nullable player_id 전부가 이 패턴.

CREATE TABLE draft_event (
  season       INTEGER NOT NULL,
  -- shihaika(支配下) | ikusei(育成) | koukousei(高校生) | daigaku_shakaijin(大学生・社会人)
  kind         TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin')),
  held_on      TEXT,               -- YYYY-MM-DD · 모르면 NULL(M11)
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL,   -- 본문 해시
  license      TEXT,               -- wikipedia 유래일 때 CC BY-SA 4.0
  PRIMARY KEY (season, kind)
) STRICT;

-- ⚠`name_display` 를 PK 에서 뺐다 — 2순위 이후 웨이버는 팀당 라운드당 1명이 자연 키다
-- (season, kind, team, round_no). PK 에 이름을 넣으면 정정 재수집 때 기존 행을 갱신하지 않고
-- 새 행이 추가돼 한 팀·한 라운드에 선수가 둘 남는다(`018-player-season-name.sql`과 같은 모양의 사고).
CREATE TABLE draft_pick (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin')),
  team           TEXT    NOT NULL,
  round_no       INTEGER NOT NULL,
  pick_seq       INTEGER,          -- 전체 지명 순번. 모르면 NULL
  waiver_dir     TEXT    CHECK (waiver_dir IS NULL OR waiver_dir IN ('→', '←')),  -- NULL(1순위)
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  position       TEXT,
  from_org       TEXT,
  origin         TEXT    NOT NULL CHECK (origin IN ('npb', 'wikipedia')),
  player_id      TEXT    REFERENCES player (player_id),
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  PRIMARY KEY (season, kind, team, round_no)
) STRICT;

CREATE TABLE draft_bid (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin')),
  round_no       INTEGER NOT NULL, -- 1巡目 몇 회차인가(1·2·3·4)
  team           TEXT    NOT NULL,
  group_key      TEXT,             -- 같은 회차·같은 경합 대상. 단독지명이면 NULL
  won            INTEGER CHECK (won IS NULL OR won IN (0, 1)),  -- 1 | 0 | NULL(단독지명) ⚠가장 중요한 CHECK — 주석만으로는 won=2 를 못 막았다
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  origin         TEXT    NOT NULL CHECK (origin IN ('npb', 'wikipedia')),
  player_id      TEXT    REFERENCES player (player_id),
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  PRIMARY KEY (season, kind, round_no, team)
) STRICT;

-- ⚠**`team`·`name_display` 를 `NOT NULL` 로 바꿨다**(구현 시점 판단). 원안은 둘 다 nullable 이었는데
-- SQLite 는 `NULL ≠ NULL` 이라 nullable 컬럼을 PK/UNIQUE 에 넣어도 유일성이 안 걸린다 —
-- 재수집(교섭권 정정이 이 표의 존재 이유다)이 조용히 중복 행을 쌓는다. 세 선택지
-- (NOT NULL / UNIQUE+COALESCE / 대리 키) 중 **NOT NULL** 을 골랐다: note_kind 4종 전부가
-- 「특정 구단의 특정 지명」에 대한 사후 사실이고(2005 교섭권 정정·2025 입단거부 실측 사례가
-- 전부 팀·선수를 둘 다 갖는다), 팀·선수 없는 주석은 조사 소스 어디에도 없다.
CREATE TABLE draft_note (
  season       INTEGER NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin')),
  team         TEXT    NOT NULL,
  name_display TEXT    NOT NULL,
  note_kind    TEXT    NOT NULL
    CHECK (note_kind IN ('kousyouken_teisei', 'nyudan_kyohi', 'shimei_hakudatsu', 'fugoui')),
  detail       TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL,
  PRIMARY KEY (season, kind, team, name_display, note_kind)
) STRICT;

CREATE INDEX draft_pick_season ON draft_pick (season, kind, round_no);
CREATE INDEX draft_bid_group   ON draft_bid (season, kind, round_no, group_key);
```

- [ ] **Step 3: 시험을 돌려 새 표가 M4 를 만족하는지 본다**

Run: `node --test packages/store/test/provenance.test.ts`
Expected: PASS. ⚠**실패하면 그 시험이 무엇을 요구하는지 읽고 마이그레이션을 고쳐라** —
시험을 고치지 마라.

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck`
Expected: exit 0 (무출력)

- [ ] **Step 5: 커밋**

```bash
git add packages/store/migrations/019-draft.sql
git commit -m "feat(store): 드래프트 4표 — 지명은 player 의 속성이 될 수 없다"
```

---

### Task 2: 픽스처를 추적 대상으로 옮긴다

**Files:**
- Create: `packages/parser/test/fixtures/draft-2019-list-g.html.gz`
- Create: `packages/parser/test/fixtures/draft-2019-list-c.html.gz`
- Create: `packages/parser/test/fixtures/draft-2006-list-g.html.gz`
- Create: `packages/parser/test/fixtures/draft-2001-list-f.html.gz`
- Modify: `packages/parser/test/fixtures/README.md`

**Interfaces:**
- Produces: 시험이 읽을 실물 픽스처 4개

⚠**왜 이 태스크가 따로 있는가**: 조사가 받은 표본은 `docs/sources/samples/` 에 있는데
**`.gitignore` 로 무추적**이라 **클론한 사람에게는 0파일**이다. 그 상태로 시험을 쓰면
**다른 기계에서 시험이 통째로 못 돈다.**

⚠**왜 이 4개인가**: 마크업이 연대별로 다르다(규칙 문서 §4의 표).
2019=현행 · 2006=전각/5칸 · 2001=최구형 · 2019 히로시마=**경합 주석이 없는 구단**(단독지명 검증용).

- [ ] **Step 1: 표본이 실재하는지 확인한다**

Run: `ls docs/sources/samples/draft-2019-list-g.html docs/sources/samples/draft-2019-list-c.html docs/sources/samples/draft-2006-list-g.html docs/sources/samples/draft-2001-list-f.html`
Expected: 4개 전부 출력. ⚠**없으면 멈춰라** — 외부를 다시 치지 말고 사람에게 물어라(L1).

- [ ] **Step 2: gz 로 압축해 옮긴다**

```bash
for f in draft-2019-list-g draft-2019-list-c draft-2006-list-g draft-2001-list-f; do
  gzip -c "docs/sources/samples/$f.html" > "packages/parser/test/fixtures/$f.html.gz"
done
ls -la packages/parser/test/fixtures/draft-*.html.gz
```
Expected: 4개 파일이 생성되고 각각 0바이트가 아니다.

- [ ] **Step 3: README 에 왜 필요한지 적는다**

`packages/parser/test/fixtures/README.md` 끝에 추가:

```markdown
## 드래프트 (2026-09-04 추가)

| 파일 | 왜 필요한가 |
|---|---|
| `draft-2019-list-g.html.gz` | 현행 마크업(2013~2025) · **경합 주석 2건**이 있는 구단 |
| `draft-2019-list-c.html.gz` | 같은 해 **경합 주석이 없는 구단** — 단독지명이 여집합으로 유도되는지 검증 |
| `draft-2006-list-g.html.gz` | 구형(2006~2012) — **전각 `１巡目` · 칸 5개(나이 포함) · 전각 공백 포지션** |
| `draft-2001-list-f.html.gz` | 최구형(2001~2005) — `自由獲得選手` 섹션 · `（選択権利なし）` |

⚠**합성 픽스처로는 검증되지 않는다.** 2016년 박스에서 실제로 겪었다 —
합성 픽스처에 결과 칸이 0개여서 파서가 빈 배열을 반환해도 시험이 전부 초록이었다.
```

- [ ] **Step 4: 추적되는지 확인한다**

Run: `git add packages/parser/test/fixtures/ && git status --short`
Expected: `A  packages/parser/test/fixtures/draft-*.html.gz` 4줄. ⚠**무시되면 안 된다.**

- [ ] **Step 5: 커밋**

```bash
git commit -m "test(parser): 드래프트 픽스처 4종 — 연대별 마크업 차이를 덮는다"
```

---

### Task 3: 지명 명단 파서 (`parseDraftPicks`)

**Files:**
- Create: `packages/parser/src/draft.ts`
- Create: `packages/parser/test/draft.test.ts`
- Modify: `packages/parser/src/index.ts` (export 추가)

**Interfaces:**
- Produces:
  - `class DraftParseError extends Error`
  - `interface DraftPickRow { team: string; kind: DraftKind; roundNo: number; waiverDir: "→" | "←" | null; nameDisplay: string; position: string | null; fromOrg: string | null }`
  - `type DraftKind = "shihaika" | "ikusei" | "koukousei" | "daigaku_shakaijin"`
  - `function parseDraftPicks(html: string, team: string): DraftPickRow[]`

- [ ] **Step 1: 실패하는 시험을 쓴다**

Create `packages/parser/test/draft.test.ts`:

```typescript
/**
 * 드래프트 파서 시험.
 *
 * ⚠**이 파서가 조용히 틀리면 「지명되지 않은 선수」가 지명 기록에 들어간다.**
 * `（選択権なし）` 는 선수가 아니라 **그 구단이 그 회차를 건너뛰었다**는 뜻이고,
 * 그대로 넣으면 **「選択権なし」라는 선수가 생긴다**(M11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { DraftParseError, parseDraftPicks } from "../src/draft.ts";

const fixture = (name: string): string =>
  gunzipSync(readFileSync(fileURLToPath(new URL(`fixtures/${name}.html.gz`, import.meta.url)))).toString("utf8");

test("현행 마크업(2019)에서 지명 명단을 읽는다", () => {
  const rows = parseDraftPicks(fixture("draft-2019-list-g"), "g");
  assert.ok(rows.length > 0, "빈 배열이면 파서가 조용히 실패한 것이다");
  const first = rows.find((r) => r.kind === "shihaika" && r.roundNo === 1);
  assert.ok(first, "1순위 지명이 있어야 한다");
  assert.equal(typeof first.nameDisplay, "string");
  assert.notEqual(first.nameDisplay, "", "이름이 비면 안 된다");
});

test("⚠育成 을 支配下 와 구별한다", () => {
  const rows = parseDraftPicks(fixture("draft-2019-list-g"), "g");
  const kinds = new Set(rows.map((r) => r.kind));
  assert.ok(kinds.has("shihaika"), "支配下 가 있어야 한다");
  // 育成 이 없는 해·구단도 있으므로 존재를 단정하지 않는다. 다만 섞이면 안 된다.
  for (const r of rows) {
    assert.ok(["shihaika", "ikusei", "koukousei", "daigaku_shakaijin"].includes(r.kind));
  }
});

test("⚠구형 마크업(2006)도 읽는다 — 전각 숫자·5칸·전각 공백", () => {
  const rows = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  assert.ok(rows.length > 0, "구형에서 빈 배열이면 연대 분기가 없는 것이다");
  assert.ok(rows.every((r) => Number.isInteger(r.roundNo) && r.roundNo >= 1), "전각 숫자가 정수로 정규화돼야 한다");
});

test("⚠최구형(2001)의 「選択権利なし」를 선수로 만들지 않는다", () => {
  const rows = parseDraftPicks(fixture("draft-2001-list-f"), "f");
  for (const r of rows) {
    assert.ok(!r.nameDisplay.includes("選択権"), `「${r.nameDisplay}」는 선수가 아니다`);
  }
});

test("⚠구조가 바뀌면 빈 배열이 아니라 던진다(M7)", () => {
  assert.throws(() => parseDraftPicks("<html><body><p>표가 없다</p></body></html>", "g"), DraftParseError);
});
```

- [ ] **Step 2: 시험이 실패하는지 확인한다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: FAIL — `Cannot find module '../src/draft.ts'`

- [ ] **Step 3: 파서를 쓴다**

Create `packages/parser/src/draft.ts`:

```typescript
/**
 * 드래프트 회의 결과 파서 — npb.jp `draft.npb.jp/draft/{YYYY}/draftlist_{team}.html`.
 *
 * ⚠**마크업이 연대별로 다르다**(규칙 문서 §4). 연도로 분기하지 말고 **구조로 판정**한다 —
 * 연도 하드코딩은 다음 해에 깨진다.
 * ⚠**`（選択権なし）`·`（選択権利なし）` 는 선수가 아니다**(한 글자 다르다).
 *   그대로 넣으면 그 이름의 선수가 생긴다(M11).
 */

export class DraftParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftParseError";
  }
}

export type DraftKind = "shihaika" | "ikusei" | "koukousei" | "daigaku_shakaijin";

export interface DraftPickRow {
  team: string;
  kind: DraftKind;
  roundNo: number;
  waiverDir: "→" | "←" | null;
  nameDisplay: string;
  position: string | null;
  fromOrg: string | null;
}

/** 섹션 머리 → 구획. ⚠규칙 문서 §3-1 의 실측 어휘다. 그 밖이면 던진다. */
const SECTION: ReadonlyArray<readonly [RegExp, DraftKind]> = [
  [/新人選手選択会議|選択選手|自由獲得選手|希望入団枠獲得選手/, "shihaika"],
  [/育成選手選択会議|育成選手/, "ikusei"],
  [/高校生選択会議/, "koukousei"],
  [/大学生・社会人ほか選択会議/, "daigaku_shakaijin"],
];

/** 선수가 아닌 칸. ⚠두 표기가 한 글자 다르다(2001 vs 2006). */
const NOT_A_PLAYER = /（選択権(利)?なし）/;

/** 전각 숫자·전각 공백을 정규화한다. ⚠NFKC 를 먼저 걸어야 `１巡目` 가 `1巡目` 가 된다. */
function normalize(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function kindOf(heading: string): DraftKind {
  for (const [re, kind] of SECTION) if (re.test(heading)) return kind;
  throw new DraftParseError(`모르는 섹션 머리: ${heading}`);
}

/** `1位` `１巡目` `3位` → 정수. 못 읽으면 던진다. */
function roundOf(label: string): number {
  const m = normalize(label).match(/^(\d+)\s*(位|巡目)/);
  if (!m) throw new DraftParseError(`모르는 순위 라벨: ${label}`);
  return Number(m[1]);
}

export function parseDraftPicks(html: string, team: string): DraftPickRow[] {
  const sections = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]*?)(?=<h4|$)/g)];
  if (sections.length === 0) {
    throw new DraftParseError("섹션(<h4>)이 없다 — 구조가 바뀌었거나 다른 페이지다");
  }

  const rows: DraftPickRow[] = [];
  for (const [, headingRaw, body] of sections) {
    const heading = normalize(headingRaw.replace(/<[^>]+>/g, ""));
    if (heading === "") continue;
    const kind = kindOf(heading);

    for (const [, rowHtml] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
        .map((m) => normalize(m[1].replace(/<[^>]+>/g, "")));
      if (cells.length < 2) continue;
      const [label, name, position, fromOrg] = cells;
      if (!/^\d+\s*(位|巡目)/.test(normalize(label))) continue; // 머리행
      if (NOT_A_PLAYER.test(name) || name === "") continue;     // ⚠선수가 아니다

      rows.push({
        team,
        kind,
        roundNo: roundOf(label),
        waiverDir: null,
        nameDisplay: name,
        position: position ?? null,
        fromOrg: fromOrg ?? null,
      });
    }
  }

  if (rows.length === 0) {
    throw new DraftParseError("지명 행을 한 건도 못 읽었다 — 빈 배열로 흘리지 않는다(M7)");
  }
  return rows;
}
```

- [ ] **Step 4: 시험을 돌린다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: PASS 5/5.
⚠**실패하면 픽스처의 실제 HTML을 열어 보고 파서를 맞춰라** — 시험의 기대를 낮추지 마라.
`gunzip -c packages/parser/test/fixtures/draft-2006-list-g.html.gz | head -80` 으로 실물을 봐라.

- [ ] **Step 5: export 하고 커밋**

`packages/parser/src/index.ts` 에 추가:
```typescript
export { DraftParseError, parseDraftPicks } from "./draft.ts";
export type { DraftKind, DraftPickRow } from "./draft.ts";
```

Run: `npm run typecheck`
Expected: exit 0

```bash
git add packages/parser/src/draft.ts packages/parser/src/index.ts packages/parser/test/draft.test.ts
git commit -m "feat(parser): 드래프트 지명 명단 — ⚠「選択権なし」는 선수가 아니다"
```

---

### Task 4: 경합 주석 파서 (`parseDraftBids`)

**Files:**
- Modify: `packages/parser/src/draft.ts`
- Modify: `packages/parser/test/draft.test.ts`
- Modify: `packages/parser/src/index.ts`

**Interfaces:**
- Consumes: `DraftParseError`, `normalize` (Task 3)
- Produces:
  - `interface DraftBidRow { team: string; roundNo: number; rivals: string[]; nameDisplay: string | null; won: boolean }`
  - `function parseDraftBids(html: string, team: string): DraftBidRow[]`

⚠**주석 문법**(규칙 문서 §2 · 40건 전건이 이 하나로 파싱됐다):
```
※{1巡目|1位}[（第N回）]： [{선수명}{投手|内野手|外野手|捕手}で]{구단}[、{구단}…]と重複、抽選で{外れる|確定}
```
- **낙첨이면 선수명을 쓰고, 당첨이면 생략한다**(그 팀 표의 그 회차 값이 곧 그 선수).
- `（第N回）` 는 그 구단 주석이 2건 이상일 때만 붙는다. 없으면 **주석 순서 = 회차**.
- ⚠**`<br>` 없이 붙어 있는 경우가 있다**(2007 西武) — `<p>` 가 아니라 **`※` 로 잘라라.**

- [ ] **Step 1: 실패하는 시험을 추가한다**

`packages/parser/test/draft.test.ts` 에 추가:

```typescript
import { parseDraftBids } from "../src/draft.ts";

test("경합 주석에서 상대 구단·당락·회차를 읽는다(2019 巨人)", () => {
  const bids = parseDraftBids(fixture("draft-2019-list-g"), "g");
  assert.equal(bids.length, 2, "2019 요미우리는 주석이 2건이다(실측)");
  assert.equal(bids[0].roundNo, 1);
  assert.equal(bids[0].won, false, "1회차는 낙첨이다");
  assert.ok(bids[0].rivals.length >= 1, "경합 상대가 있어야 한다");
  assert.ok(bids[0].nameDisplay, "⚠낙첨이면 대상 선수명이 적혀 있다");
  assert.equal(bids[1].roundNo, 2);
});

test("⚠경합이 없는 구단은 빈 배열이다 — 그건 실패가 아니다", () => {
  const bids = parseDraftBids(fixture("draft-2019-list-c"), "c");
  assert.deepEqual(bids, [], "단독지명 구단에는 주석이 없다");
});

test("⚠당첨 주석은 선수명을 생략한다", () => {
  // 규칙: `※1巡目： 阪神と重複、抽選で確定` — 이름이 없다.
  const html = `<h4>新人選手選択会議</h4><table><tr><td>1位</td><td>甲</td></tr></table>
                <p>※1巡目： 阪神と重複、抽選で確定</p>`;
  const bids = parseDraftBids(html, "g");
  assert.equal(bids.length, 1);
  assert.equal(bids[0].won, true);
  assert.equal(bids[0].nameDisplay, null, "당첨이면 이름이 없다 — 표에서 가져와야 한다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: FAIL — `parseDraftBids is not a function` (기존 5본은 계속 PASS)

- [ ] **Step 3: 파서를 추가한다**

`packages/parser/src/draft.ts` 끝에 추가:

```typescript
export interface DraftBidRow {
  team: string;
  /** 1순위 입찰 회차(1·2·3·4) */
  roundNo: number;
  /** 경합한 상대 구단들의 **표기 그대로**. ⚠코드 변환은 store 층에서 한다 */
  rivals: string[];
  /** ⚠당첨 주석은 이름을 생략한다 — 그때는 null 이고 표에서 가져와야 한다 */
  nameDisplay: string | null;
  won: boolean;
}

/** ⚠`<br>` 없이 붙어 있는 경우가 있어(2007 西武) `※` 로 자른다. */
const BID_RE =
  /^(?:1巡目|1位)(?:（第(\d+)回）)?[：:]\s*(?:(.+?)(?:投手|内野手|外野手|捕手)で)?(.+?)と重複、抽選で(外れる|確定)/;

export function parseDraftBids(html: string, team: string): DraftBidRow[] {
  const text = normalize(html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, " "));
  const chunks = text.split("※").slice(1);

  const rows: DraftBidRow[] = [];
  let seq = 0;
  for (const chunk of chunks) {
    const m = normalize(chunk).match(BID_RE);
    if (!m) continue; // 드래프트와 무관한 ※ 주석이 있을 수 있다
    seq += 1;
    const [, roundRaw, name, rivalsRaw, outcome] = m;
    rows.push({
      team,
      // ⚠（第N回）가 없으면 주석 순서가 회차다(규칙 문서 §2)
      roundNo: roundRaw ? Number(roundRaw) : seq,
      rivals: rivalsRaw.split(/[、，,]/).map((s) => normalize(s)).filter(Boolean),
      nameDisplay: name ? normalize(name) : null,
      won: outcome === "確定",
    });
  }
  return rows;
}
```

- [ ] **Step 4: 시험을 돌린다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: PASS 8/8.
⚠**2019 요미우리가 2건이 아니면** 실물을 열어 확인하라:
`gunzip -c packages/parser/test/fixtures/draft-2019-list-g.html.gz | grep -o "※[^<]*"`

- [ ] **Step 5: export 하고 커밋**

`packages/parser/src/index.ts` 에 추가:
```typescript
export { parseDraftBids } from "./draft.ts";
export type { DraftBidRow } from "./draft.ts";
```

```bash
npm run typecheck
git add packages/parser/src/draft.ts packages/parser/src/index.ts packages/parser/test/draft.test.ts
git commit -m "feat(parser): 경합 주석 — ⚠당첨은 이름을 생략하고 낙첨만 적는다"
```

---

### Task 5: 연도 색인과 구단 슬러그 발견

**Files:**
- Modify: `packages/parser/src/draft.ts`
- Modify: `packages/parser/test/draft.test.ts`
- Modify: `packages/parser/src/index.ts`

**Interfaces:**
- Produces:
  - `function parseDraftYears(html: string): number[]`
  - `function parseDraftTeamSlugs(html: string): string[]`

⚠**슬러그를 하드코딩하지 마라.** 실측: **2013 오릭스 = `bs`**(`b` 는 404) / 2019·2023 = `b`.
`CLAUDE.md` §2 의 「2018 오릭스 `bs`」와 같은 함정이다. **하드코딩하면 그 구단이 통째로 빈다.**

- [ ] **Step 1: 실패하는 시험을 추가한다**

```typescript
import { parseDraftYears, parseDraftTeamSlugs } from "../src/draft.ts";

test("연도 색인에서 연도를 뽑는다", () => {
  const html = `<a href="./2025/">2025年</a><a href="./2024/">2024年</a><a href="./2001/">2001年</a>`;
  assert.deepEqual(parseDraftYears(html), [2001, 2024, 2025], "오름차순 · 중복 없음");
});

test("⚠구단 슬러그를 하드코딩하지 않고 페이지에서 발견한다", () => {
  const html = `<a href="draftlist_g.html">読売</a><a href="draftlist_bs.html">オリックス</a>`;
  assert.deepEqual(parseDraftTeamSlugs(html), ["bs", "g"], "정렬 · 2013 오릭스는 bs 다");
});

test("⚠슬러그를 한 건도 못 찾으면 던진다", () => {
  assert.throws(() => parseDraftTeamSlugs("<html></html>"), DraftParseError);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: FAIL — `parseDraftYears is not a function`

- [ ] **Step 3: 구현한다**

`packages/parser/src/draft.ts` 에 추가:

```typescript
/** `backnumber.html` 에서 연도를 뽑는다. 오름차순·중복 제거. */
export function parseDraftYears(html: string): number[] {
  const years = new Set<number>();
  for (const m of html.matchAll(/href="\.?\/?(\d{4})\/"/g)) years.add(Number(m[1]));
  if (years.size === 0) throw new DraftParseError("연도 링크를 못 찾았다");
  return [...years].sort((a, b) => a - b);
}

/**
 * 연도 톱에서 구단 슬러그를 **발견**한다.
 * ⚠하드코딩 금지 — 2013 오릭스는 `bs` 이고 `b` 는 404다.
 */
export function parseDraftTeamSlugs(html: string): string[] {
  const slugs = new Set<string>();
  for (const m of html.matchAll(/draftlist_([a-z]+)\.html/g)) slugs.add(m[1]);
  if (slugs.size === 0) throw new DraftParseError("draftlist 링크를 못 찾았다");
  return [...slugs].sort();
}
```

- [ ] **Step 4: 시험을 돌린다**

Run: `node --test packages/parser/test/draft.test.ts`
Expected: PASS 11/11

- [ ] **Step 5: export 하고 커밋**

```typescript
export { parseDraftYears, parseDraftTeamSlugs } from "./draft.ts";
```

```bash
npm run typecheck
git add packages/parser/
git commit -m "feat(parser): 연도 색인과 슬러그 발견 — ⚠2013 오릭스는 bs 다"
```

---

### Task 6: 적재 (`loadDraft`)

**Files:**
- Create: `packages/store/src/draft.ts`
- Create: `packages/store/test/draft.test.ts`
- Modify: `packages/store/src/index.ts`

**Interfaces:**
- Consumes: `DraftPickRow`·`DraftBidRow` (Task 3·4) · `openDb` (`packages/store/src/db.ts`)
- Produces:
  - `interface DraftLoadInput { season: number; picks: DraftPickRow[]; bids: DraftBidRow[]; source: string; fetchedAt: string; revision: string }`
  - `function loadDraft(db: Db, input: DraftLoadInput): void`

⚠**단독지명은 여집합으로 유도한다**(설계 §2). 어느 소스도 「단독」이라고 적지 않는다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

Create `packages/store/test/draft.test.ts`:

```typescript
/**
 * 드래프트 적재 시험.
 *
 * ⚠**단독지명(`won = NULL`)은 소스가 말해 주지 않는다** — 경합 그룹의 여집합으로 유도한다.
 * 그 유도가 틀리면 「아무도 안 겹친 지명」이 「경합에서 이긴 지명」으로 둔갑한다(M11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { loadDraft } from "../src/draft.ts";

const META = { source: "https://draft.npb.jp/draft/2019/", fetchedAt: "2026-09-04T00:00:00Z", revision: "sha256:test" };

/**
 * 빈 DB 를 만든다. ⚠`packages/store/test/provenance.test.ts` 의 관용 그대로다 —
 * `openDb` 가 마이그레이션을 적용하므로 새 표가 자동으로 생긴다.
 * ⚠**시계는 주입 인자다**(M6).
 */
async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-"));
  return { db: openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z"), dir };
}

test("지명과 입찰이 들어간다", async () => {
  const { db } = await freshDb();
  loadDraft(db, {
    season: 2019,
    picks: [
      { team: "g", kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "堀田賢慎", position: "投手", fromOrg: "青森山田高" },
    ],
    bids: [
      { team: "g", roundNo: 1, rivals: ["東京ヤクルト", "阪神"], nameDisplay: "奥川恭伸", won: false },
      { team: "g", roundNo: 2, rivals: ["埼玉西武"], nameDisplay: "宮川哲", won: false },
    ],
    ...META,
  });
  const picks = db.raw.prepare("SELECT * FROM draft_pick WHERE season = 2019").all();
  assert.equal(picks.length, 1);
  const bids = db.raw.prepare("SELECT * FROM draft_bid WHERE season = 2019 ORDER BY round_no").all();
  assert.equal(bids.length, 2);
  assert.equal(bids[0].won, 0, "낙첨은 0 이다");
});

test("⚠멱등하다 — 두 번 넣어도 한 번과 같다(M5)", async () => {
  const { db } = await freshDb();
  const input = {
    season: 2019,
    picks: [{ team: "g", kind: "shihaika" as const, roundNo: 1, waiverDir: null, nameDisplay: "堀田賢慎", position: null, fromOrg: null }],
    bids: [],
    ...META,
  };
  loadDraft(db, input);
  loadDraft(db, input);
  const n = db.raw.prepare("SELECT COUNT(*) AS n FROM draft_pick").get() as { n: number };
  assert.equal(n.n, 1, "두 번 넣어도 1행이다");
});

test("⚠단독지명은 won 이 NULL 이다 — 낙첨(0)과 구별한다(M11)", async () => {
  const { db } = await freshDb();
  loadDraft(db, {
    season: 2019,
    picks: [{ team: "c", kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "森下暢仁", position: "投手", fromOrg: "明治大" }],
    bids: [],   // ⚠경합 주석이 없다 = 단독지명
    ...META,
  });
  const row = db.raw.prepare("SELECT won FROM draft_bid WHERE season = 2019 AND team = 'c'").get() as { won: number | null } | undefined;
  assert.ok(row, "단독지명도 draft_bid 에 행이 있어야 한다 — 그래야 1순위가 전부 한 표에 모인다");
  assert.equal(row.won, null, "⚠0 이 아니라 NULL 이다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/store/test/draft.test.ts`
Expected: FAIL — `Cannot find module '../src/draft.ts'`
(`openDb` 와 `mkdtemp` 관용은 `packages/store/test/provenance.test.ts:106` 에서 확인한 실제 것이다.)

- [ ] **Step 3: 구현한다**

Create `packages/store/src/draft.ts`:

```typescript
/**
 * 드래프트 적재.
 *
 * ⚠**단독지명은 소스가 말하지 않는다.** npb 주석은 경합만 적고, wikipedia 는 경합만 칠한다.
 * 그래서 **1순위 지명 중 경합 그룹에 없는 것**을 단독으로 유도한다(`won = NULL`).
 * ⚠**`0`(낙첨)과 `NULL`(단독)을 섞지 마라**(M11).
 */
import type { DraftBidRow, DraftPickRow } from "@bb-app/parser";
import type { Db } from "./db.ts";

export interface DraftLoadInput {
  season: number;
  picks: DraftPickRow[];
  bids: DraftBidRow[];
  source: string;
  fetchedAt: string;
  revision: string;
}

export function loadDraft(db: Db, input: DraftLoadInput): void {
  const { season, picks, bids, source, fetchedAt, revision } = input;

  db.transaction(() => {
    const kinds = new Set(picks.map((p) => p.kind));
    const ev = db.raw.prepare(
      `INSERT INTO draft_event (season, kind, held_on, source, fetched_at, revision)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(season, kind) DO UPDATE SET source = excluded.source,
         fetched_at = excluded.fetched_at, revision = excluded.revision`,
    );
    for (const kind of kinds) ev.run(season, kind, source, fetchedAt, revision);

    const insPick = db.raw.prepare(
      `INSERT INTO draft_pick
         (season, kind, team, round_no, pick_seq, waiver_dir, name_display, name_canonical,
          position, from_org, origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, 'npb', NULL, ?, ?, ?)
       ON CONFLICT(season, kind, team, round_no) DO UPDATE SET
         name_display = excluded.name_display,
         position = excluded.position, from_org = excluded.from_org,
         fetched_at = excluded.fetched_at, revision = excluded.revision`,
    );
    for (const p of picks) {
      insPick.run(season, p.kind, p.team, p.roundNo, p.waiverDir, p.nameDisplay,
        p.position, p.fromOrg, source, fetchedAt, revision);
    }

    // 경합이 적힌 구단
    const contested = new Set(bids.map((b) => b.team));
    const insBid = db.raw.prepare(
      `INSERT INTO draft_bid
         (season, kind, round_no, team, group_key, won, name_display, name_canonical,
          origin, player_id, source, fetched_at, revision)
       VALUES (?, 'shihaika', ?, ?, ?, ?, ?, NULL, 'npb', NULL, ?, ?, ?)
       ON CONFLICT(season, kind, round_no, team) DO UPDATE SET
         group_key = excluded.group_key, won = excluded.won,
         name_display = excluded.name_display,
         fetched_at = excluded.fetched_at, revision = excluded.revision`,
    );

    for (const b of bids) {
      // ⚠group_key 는 (회차 + 경합 대상)이다. 당첨 주석은 이름을 생략하므로
      //   그 구단의 그 회차 지명에서 가져온다.
      const name = b.nameDisplay ??
        picks.find((p) => p.team === b.team && p.kind === "shihaika" && p.roundNo === 1)?.nameDisplay ?? null;
      if (name === null) {
        throw new Error(`${season} ${b.team} ${b.roundNo}회차: 경합 대상 선수를 못 정했다 — 조용히 넘기지 않는다(M7)`);
      }
      insBid.run(season, b.roundNo, b.team, `${b.roundNo}:${name}`, b.won ? 1 : 0, name,
        source, fetchedAt, revision);
    }

    // ⚠단독지명 유도 — 1순위 지명이 있는데 경합 주석이 없는 구단
    for (const p of picks) {
      if (p.kind !== "shihaika" || p.roundNo !== 1) continue;
      if (contested.has(p.team)) continue;
      insBid.run(season, 1, p.team, null, null, p.nameDisplay, source, fetchedAt, revision);
    }
  })();
}
```

- [ ] **Step 4: 시험을 돌린다**

Run: `node --test packages/store/test/draft.test.ts`
Expected: PASS 3/3.
⚠**타입 오류가 나면** `packages/store/src/db.ts` 의 `Db` 인터페이스와 `packages/parser/package.json`
의 패키지명을 확인해 import 를 맞춰라.

- [ ] **Step 5: 커밋**

```bash
npm run typecheck
git add packages/store/src/draft.ts packages/store/src/index.ts packages/store/test/draft.test.ts
git commit -m "feat(store): 드래프트 적재 — ⚠단독지명은 여집합으로 유도한다"
```

---

### Task 7: 불변식 시험 (INV-4·INV-5·**INV-N1·INV-N2**)

**Files:**
- Create: `scripts/test/draft-invariants.test.ts`

**Interfaces:**
- Consumes: `loadDraft` (Task 6)

⚠**왜 따로 있는가**: 규칙 문서 §5 의 불변식은 **파싱이 조용히 틀리는 것을 잡는 유일한 장치**다.
INV-1~3·6·7 은 wikipedia 파서가 있어야 검사할 수 있으므로 **이 계획에서는 INV-4·5 만** 건다.

#### ⚠INV-N1·N2 를 여기 더한다 (2026-09-05 · Task 6 검수)

⚠**「N」은 npb 단독 파이프라인이라는 뜻이다.** 규칙 문서의 INV-1~7 은 **전부 wikipedia 표의
색·배치 정합성**을 재는 것이라, **npb 만으로 생기는 아래 두 결함을 재는 항목이 하나도 없다.**
번호를 이어 붙이면 규칙 문서를 고쳐야 하므로 접두사를 나눈다.

| # | 불변식 | 무엇을 잡는가 |
|---|---|---|
| **INV-N1** | **`won=0` 만 있고 이긴 구단이 없는 `group_key` 가 0건** | **이름 정규화가 실패해 경합 그룹이 갈린 것.** 갈리면 단독지명 유도(여집합)까지 틀린다. ⚠규칙 문서가 **이체자 불일치 1건을 실측**했고 Task 6 이 **NFC·NFKC·NFD·`normalizePlayerName` 넷 다 `山﨑`↔`山崎` 를 못 붙인다**고 재확인했다 — **가정이 아니라 실측된 위험이다** |
| **INV-N2** | **한 `(season, team, name_canonical)` 이 두 `kind` 에 동시에 있지 않다** | **`kind` 가 바뀌는 정정에서 옛 행이 고아로 남는 것.** ⚠**이 브랜치에서 실제로 일어난 이력이다**(초판 4종 → 6종). 화면에는 **같은 선수가 두 구획에 지명된 것처럼** 보인다 |

⚠**INV-N2 는 Task 6 이 그 결함 자체를 고친 뒤에도 남긴다** — 고침은 그 경로 하나를 막고,
불변식은 **아직 모르는 경로**를 막는다. 둘은 대체 관계가 아니다.

⚠**두 항목이 여기 있는 이유를 기억하라.** Task 5·Task 6 이 각각 「Task 6/7 이 받는다」로 짐을
넘겼는데 **두 번 다 받는 사람이 없었다.** 두 번째는 **그 선례가 이 문서에 이미 적혀 있는데도**
반복됐다. **「다음이 받는다」고 쓸 때는 그 다음의 브리프를 열어서 확인해라.**

- [ ] **Step 1: 시험을 쓴다**

Create `scripts/test/draft-invariants.test.ts`:

```typescript
/**
 * 드래프트 불변식 — 규칙 문서(`docs/sources/2026-09-04-draft-wikipedia-markup-rules.md` §5).
 *
 * ⚠**이 시험이 이 기능의 안전망이다.** 파싱이 조용히 틀리면 화면은 그럴듯하고
 * 합계도 맞아서 **눈으로는 못 잡는다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../packages/store/src/db.ts";
import { loadDraft } from "../../packages/store/src/draft.ts";

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-inv-"));
  return openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
}

test("INV-4: 구획×구단마다 확정된 1순위 지명이 정확히 1건", async () => {
  const db = await freshDb();
  loadDraft(db, {
    season: 2019,
    picks: [
      { team: "g", kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "堀田賢慎", position: null, fromOrg: null },
      { team: "c", kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "森下暢仁", position: null, fromOrg: null },
    ],
    bids: [{ team: "g", roundNo: 1, rivals: ["東京ヤクルト"], nameDisplay: "奥川恭伸", won: false }],
    source: "t", fetchedAt: "t", revision: "t",
  });
  const rows = db.raw.prepare(
    `SELECT team, COUNT(*) AS n FROM draft_pick
      WHERE season = 2019 AND kind = 'shihaika' AND round_no = 1 GROUP BY team`,
  ).all() as Array<{ team: string; n: number }>;
  for (const r of rows) assert.equal(r.n, 1, `${r.team}: 1순위 확정 지명이 ${r.n}건이다`);
});

test("INV-5: 같은 (season, kind, round_no, team) 에 입찰이 두 번 들어가지 않는다", async () => {
  const db = await freshDb();
  const input = {
    season: 2019,
    picks: [{ team: "g", kind: "shihaika" as const, roundNo: 1, waiverDir: null, nameDisplay: "堀田賢慎", position: null, fromOrg: null }],
    bids: [{ team: "g", roundNo: 1, rivals: ["東京ヤクルト"], nameDisplay: "奥川恭伸", won: false }],
    source: "t", fetchedAt: "t", revision: "t",
  };
  loadDraft(db, input);
  loadDraft(db, input);
  const n = db.raw.prepare("SELECT COUNT(*) AS n FROM draft_bid").get() as { n: number };
  assert.equal(n.n, 1);
});
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `node --test scripts/test/draft-invariants.test.ts`
Expected: 처음에는 import 경로 오류일 수 있다. 경로를 맞추고 다시 돌린다.

- [ ] **Step 3: 통과시킨다**

⚠**시험이 붉으면 `loadDraft` 를 고쳐라 — 시험을 낮추지 마라.**

- [ ] **Step 4: 전체 스위트를 돌린다**

Run: `npm test`
Expected: **기준선 2,123본 + 새로 추가한 본수**가 전부 통과. fail 0 · ERROR 0.
⚠**FAIL(떨어짐)과 ERROR(돌지도 않음)를 분리해 세라.**

- [ ] **Step 5: 커밋**

```bash
git add scripts/test/draft-invariants.test.ts
git commit -m "test(draft): 불변식 INV-4·5 — 조용히 틀리는 것을 붉게 만든다"
```

---

## 이 계획 밖 (후속)

| 후속 | 왜 여기 없는가 |
|---|---|
| **wikipedia 파서** | 규칙군 4종 + 예외 3건이라 별도 계획이 필요하다. ⚠**2005~2022 에서 npb 와 대조해 불일치 0을 확인한 뒤에만** 2023~ 에 적용한다(설계 §7 3단계 게이트) |
| **INV-1·2·3·6·7** | wikipedia 파서가 있어야 검사할 수 있다 |
| **수집기**(archiver) | 연 1회 배치라 기존 일일 배치와 층이 다르다. 파서가 안정된 뒤에 붙인다 |
| **화면** | 데이터가 들어간 뒤 |

### ⚠수집기 계획을 쓸 때 반드시 받아야 할 짐 (2026-09-05 · Task 5 검수)

**여기 적는 이유**: Task 5 구현자가 이 우려를 「Task 6/7 이 받는다」로 넘겼는데 **검수자가 세 파일을 대조해
뒤집었다** — Task 6 은 `DraftPickRow`·`DraftBidRow` 만, Task 7 은 `loadDraft` 만 소비하고
**둘 다 `parseDraftYears`/`parseDraftTeamSlugs` 를 부르지 않는다.** 그 둘을 부르는 것은 수집기뿐이다.
⚠**즉 이 항목은 「다음 태스크가 이어받는다」가 아니라 「아무도 배정되지 않았다」였다.**
스크래치 원장은 무추적이라 여기 적지 않으면 다음 계획에서 조용히 사라진다.

| # | 짐 | 왜 |
|---|---|---|
| **A1** | **`parseDraftTeamSlugs` 의 0건 예외를 「아직」으로 삼키지 마라** | `draftlist_*` 는 개최 당일 생기므로 **1년 중 대부분 그 해 연도 톱은 0건**이다. 삼키면 **마크업이 진짜 바뀐 날에도 조용하다.** 연도별 상태로 기록해라 |
| **A2** | ⚠**「개최 전」은 파서가 판정할 수 없다 — 호출자만 할 수 있다** | 파서는 **시계를 못 읽는다**(M6). 파서가 내는 것은 판정이 아니라 **관측**이고(`DraftIndexError.observed` — `"no-team-links"` / `"no-draft-marker"`), **과거 연도에서 `no-team-links` 가 나오면 그건 개최 전이 아니라 붕괴다.** 그 연도가 과거인지 아는 것은 수집기다 |
| **A2′** | ⚠**표지는 `page_draft` 다 — `開催要項` 이 아니다** | ~~파서가 아는 것은 `開催要項` 있음~~ 이라고 **이 표에 처음 적었던 것은 틀렸다**(2026-09-05 정정). 코드는 `開催要項` 을 **참조하지 않는다.** ⚠**낡은 채로 두면 수집기 작성자가 그 문자열을 관측 기준으로 오해한다** — 그것이 이 표의 존재 이유(짐을 넘기는 유일한 영속 기록)를 정면으로 깬다 |
| **A3** | **슬러그 실측은 26개 연도 중 6개다** | 나머지 20개는 「같다」가 아니라 **「안 쟀다」**. 백필하는 연도마다 실제로 확인해라 — `CLAUDE.md` §2 의 **2018 오릭스 `bs`** 사고가 정확히 이 모양이다 |
| **A4** | **수집 범위는 2005~2026 인데 색인은 26개 연도(2001~)를 준다** | `parseDraftYears` 는 **사이트가 나열하는 그대로**를 낸다. 범위를 자르는 것은 호출자 몫이다 |
| **A5** | ⚠**파서가 던졌을 때의 회복을 설계해라 — 지금 설계된 적이 없다** | 파서는 **오탐 쪽으로 기울여** 만들었다(「헛불은 시끄럽고 고칠 수 있지만 **지워진 행은 조용하고 영구적이다**」). 그 대가로 **한 구단 페이지가 통째로 실패**할 수 있다. ⚠**그것이 다른 구단·다른 시즌의 적재까지 막는지는 수집기의 트랜잭션 경계에 달렸고 그 경계가 아직 없다.** 「어느 팀·어느 시즌만 재시도하는가」를 정해라 |
| **A6** | ⚠**불변식 검사는 「그 시즌의 전 구단이 들어온 뒤」에만 걸어라** | `scripts/test/draft-invariants.test.ts` 의 5종은 **한 시즌이 완결된 상태**를 전제한다. 적재는 **구단 단위**이므로, 중간 상태에서 **INV-N1 이 붉은 것은 결함이 아니라 시즌이 덜 들어온 것**이다. ⚠**검사를 거는 자리는 그 시즌 마지막 구단 직후다.** 중간에 걸면 **매번 헛불이 나고, 헛불이 일상이 되면 진짜 위반도 안 읽힌다** |

⚠**A5 의 첫 신호는 소급 적재의 첫 실행이다.** 예외가 터지는 곳이 나오면 **그건 결함이 아니라
「던지는 쪽으로 기울인」 판단의 재검토 신호**다. 실측 분모가 작다 — **픽스처 4장 · 인식된 섹션 10개**에서
「지명 행이 0인 섹션」이 **0건**이었을 뿐이고, **12구단 × 22시즌은 안 쟀다.**

⚠**아직 반증도 재현도 안 된 잔여 위험 하나**: **한 섹션 안에 `<table>` 이 둘 이상이고 그중 하나만
깨지는 경우.** 같은 섹션의 다른 표가 카운터를 채우면 그물을 빠져나갈 수 있다 —
**픽스처 4장 어디에도 한 섹션에 표가 둘인 사례가 없어 재현도 반증도 못 했다.**

### ⚠화면을 만들 때 받아야 할 짐 (2026-09-05 · Task 6 검수)

| # | 짐 | 왜 |
|---|---|---|
| **B1** | ⚠**`draft_event` 를 「이 시즌에 있었던 구획 목록」으로 읽지 마라** | 이 표는 **upsert 만 하고 지우지 않는다**. 키가 `(season, kind)` 라 **구단이 없어서**, 구단 단위 적재로는 「이 구획이 시즌에서 통째로 사라졌는가」를 알 수 없다. **어떤 지명도 뒷받침하지 않는 행이 영구히 남는다** — 검수자 판정: **「값은 안 왜곡하지만 존재는 왜곡한다」**. 실제 재현: `shihaika` → `jiyuu_kakutoku` 정정 뒤 `draft_event` 에 **두 행**이 남고 `draft_pick` 에는 **한 행**뿐이다 |

⚠**「알면서 남긴 것」이라 지금 피해가 0이다** — 화면이 아직 없기 때문이지 안전해서가 아니다.
**구획 목록이 필요하면 `draft_pick` 에서 `DISTINCT kind` 를 뽑아라.**

⚠**이 계획이 끝나면 「2005~2026 의 npb.jp 지명 명단과 경합이 DB에 들어간다」까지가 완결된다.**
화면은 아직 없지만 **데이터의 정확성은 시험으로 지켜진다.**
