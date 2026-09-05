# 드래프트 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DB 에 들어간 드래프트(**21시즌 · 지명 2,234행 · 입찰 374행**)를 **시즌별 페이지**로 보인다 — 사용자가 처음 요청한 그것이다.

**Architecture:** 이 저장소의 페이지 관용을 그대로 따른다 — `query.ts`(**유일한 DB 접점**) → `renderDraftPage(data, ctx): RawHtml` → `site.ts` 의 `seasonPaths()`·`buildSite()` 에 등록. **DB 를 렌더러가 모른다.**

**Tech Stack:** Node ≥24 · TypeScript · `node:test` · 태그드 템플릿 `html`

---

## ⚠이 계획의 코드는 최소한만 쓴다 — 그 이유

앞선 두 계획(`2026-09-04-draft-npb-source.md` · `2026-09-05-draft-collector.md`)에서
**내가 쓴 코드가 반복해서 실물과 어긋났다**: 정규식 3연속 0건 · 「아무것도 안 재는 SQL」 ·
호스트 · `BlobMeta.revision` 이 숫자 · CLI 인자 형태 · `as never` 로 타입을 뚫은 시험.

**매번 실물이 옳았다.** 그래서 이 계획은 **구조와 계약을 정확히 쓰고, 코드는 조사로 확인된 것만** 쓴다.
⚠**「먼저 실측하라」로 남긴 것은 게으름이 아니라 이 브랜치에서 배운 것이다.**

---

## Global Constraints

- **M1** — 지표 계산·어휘를 두 벌 두지 마라. ⚠**`query.ts` 가 유일한 DB 접점이고 렌더러는 DB 를 모른다.** 지표 라벨·분모 단위는 `glossary.ts` 가 정본이다.
- **M2** — **분모 없는 비율을 렌더링하지 마라.**
- **M11** — 미수집·0·결측을 구별한다.
- **M12** — 빈 상태를 **로딩 / 데이터없음 / 수집실패 / 시즌외**로 구분한다(`layout.ts` 의 `DataState`).
- **L2** — ⚠**원본 표 레이아웃을 재현하지 마라.** wikipedia 그리드(행=회차 × 열=12구단)를 그대로 옮기지 않고 **경합 그룹 단위로 재구성**한다.
- **L3** — **출처를 화면에 명기**한다.
- **L5·L6** — ⚠**선수 사진·구단 로고·엠블럼을 쓰지 마라.**
- **UI**(루트 §7) — **라벨 강조 원칙의 도메인 예외**: 값을 주역으로 두되 **라벨과 분모를 반드시 인접**시킨다. ⚠**「AI틱함」 회피**: 보라·파랑 그라데이션 · 균질 카드 그리드 · 이모지 아이콘 · 목적 없는 glassmorphism · 중앙정렬 히어로 금지.
- **분모를 항상 표기**하고 **「0건」과 「안 쟀음」을 구별**한다.

---

## 실물 상태 — 화면이 마주할 데이터 (2026-09-05 실측)

| | 값 |
|---|---|
| 적재 시즌 | **21**(2005~2025) · 2026 은 **미수집**(개최 전) |
| `draft_pick` | **2,234행** |
| `draft_bid` | **374행** — `won`: 당첨 / 낙첨 / **`NULL`=단독지명** |
| `draft_event` | **47행**(시즌 × 구획) |
| `draft_note` | ⚠**0행** — 파서가 없다 |

### ⚠화면이 반드시 구별해야 하는 세 가지 「비어 있음」

| 무엇 | 언제 | 화면이 말해야 하는 것 |
|---|---|---|
| **경합이 0행** | **2023·2024·2025** | ⚠**「NPB가 공표하지 않는다」** — 우리가 못 얻은 게 아니다. **경합은 실제로 있었고 npb 가 표시만 껐다**(2023 야쿠르트 페이지엔 그 문장이 **HTML 주석 안에** 아직 남아 있다) |
| **`draft_note` 가 0행** | **전 시즌** | **「아직 수집하지 않는다」** — 파서가 없다 |
| **시즌 자체가 없음** | **2026** | **「개최 전」** |

⚠**셋 다 「데이터가 없습니다」로 뭉뚱그리면 거짓이다.** 이 저장소가 M12 를 두는 이유가 그것이다.

⚠**`layout.ts` 의 `DataState` 는 4종**(`ok`·`empty`·`failed`·`offseason`)이고 **첫 번째를 담을 자리가 없다.**
Task 1 이 그 판단을 한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/web/src/query.ts` (수정) | **DB → 화면 데이터.** 드래프트 조회를 여기 더한다 — ⚠**유일한 DB 접점** |
| `packages/web/src/draft-page.ts` (신규) | `renderDraftPage(data, ctx): RawHtml` |
| `packages/web/src/site.ts` (수정) | `seasonPaths()` 에 경로 추가 · `buildSite()` 에 렌더 호출 추가 |
| `packages/web/test/draft-page.test.ts` (신규) | 렌더 시험 — 데이터 빌더 관용 |
| `packages/web/src/glossary.ts` (수정할 수도) | 드래프트 용어를 화면에 쓰면 여기 |

⚠**`layout.ts` 를 고칠지는 Task 1 이 정한다**(다섯 번째 상태).

---

### Task 1: 조회층과 「비어 있음」의 구별

**Files:**
- Modify: `packages/web/src/query.ts`
- Test: `packages/web/test/draft-query.test.ts` (신규)
- ⚠Modify(판단에 따라): `packages/web/src/layout.ts`

**Interfaces:**
- Produces: `DraftPageData` — Task 2 가 렌더한다. **필드 이름과 타입을 여기서 확정한다.**

- [ ] **Step 1: 먼저 실측하라 — 코드를 쓰기 전에**

⚠**이 저장소의 조사가 두 가지를 「못 찾았다」고 했다. 직접 확인하라:**

1. **조건부 링킹** — 「그 시즌 페이지가 있는 선수만 링크하고, 없으면 이름만 남긴다」. `CLAUDE.md` §2-2 가 **통산 대전 표에서 이미 쓴 규칙**이라고 적는데 **공통 함수를 못 찾았다**. `query.ts` 의 `careerMatchups` 부근을 봐라.
   - **있으면 그것을 쓴다**(M1).
   - **없으면 만든다** — ⚠**드래프트는 이 규칙이 특히 중요하다**: 지명된 선수의 상당수가 `player` 표에 **영영 없다**(입단 거부·은퇴·1군 미등록).
2. **`DataState` 의 다섯 번째** — 「NPB가 공표하지 않는다」를 `empty` 의 `detail` 로 쓸지, **새 kind 를 더할지** 정하라.
   - ⚠**`detail` 로 하면 `empty`(데이터 없음)의 뜻이 흐려진다.**
   - ⚠**새 kind 를 더하면 `layout.ts` 를 만지고 기존 4상태 시험이 영향받는다.**
   - **고른 쪽과 이유를 코드 주석에 적어라.**

**실측 결과를 보고에 분모와 함께 적어라.**

- [ ] **Step 2: 실패하는 시험을 쓴다**

Create `packages/web/test/draft-query.test.ts`. ⚠**`packages/web/test/` 의 기존 관용을 따라라**(데이터 빌더 + 덮어쓰기). 최소한 이 셋을 재라:

1. **경합 그룹이 회차별로 묶인다** — 같은 `(season, kind, round_no, group_key)` 가 한 그룹이고, **당첨 1 + 낙첨 N** 이다.
2. ⚠**2023 처럼 `draft_bid` 가 0행인 시즌**이 「데이터 없음」이 **아닌** 상태로 나온다.
3. ⚠**`player` 에 없는 선수도 행이 남는다** — 링크만 빠지고 **이름은 남는다**.

- [ ] **Step 3: 실패를 확인한다**

Run: `node --test packages/web/test/draft-query.test.ts`
⚠**파이프 없이 종료코드를 봐라.**

- [ ] **Step 4: 조회를 구현한다**

`query.ts` 에 더한다. ⚠**규칙:**
- **DB 접점은 여기뿐이다.** 렌더러에 `Db` 를 넘기지 마라.
- **지표를 여기서 다시 계산하지 마라**(M1).
- **`draft_event.kind` 6종**을 화면 어휘로 옮기는 표를 **한 벌만** 둬라 — ⚠**`packages/parser` 의 `DRAFT_KINDS` 가 정본이다. 새로 적지 마라.**

⚠**`group_key` 로 묶을 때 「당첨이 없는 그룹」이 나오면 그것은 결함이다**(INV-N1 이 그것을 잡는다). **화면에서 조용히 건너뛰지 말고** 데이터에 그 사실이 남게 해라.

- [ ] **Step 5: 시험을 통과시키고 커밋**

Run: `node --test packages/web/test/draft-query.test.ts` · `npm run typecheck`
⚠**전체 스위트는 코디네이터가 돌린다.**

```bash
git add packages/web/src/query.ts packages/web/test/draft-query.test.ts
git commit -m "feat(web): 드래프트 조회 — 「공표하지 않는다」와 「데이터 없음」을 가른다"
```

---

### Task 2: 화면 렌더

**Files:**
- Create: `packages/web/src/draft-page.ts`
- Test: `packages/web/test/draft-page.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `DraftPageData`
- Produces: `renderDraftPage(data: DraftPageData, ctx: RenderContext): RawHtml`

**화면 구성**(설계 `docs/superpowers/specs/2026-09-04-draft-page-design.md` §5):

```
① 1순위 입찰 (회차별 서사)
   1회차 ── 宗山塁 に 5球団      楽天 当選 / 西武·中日·ロッテ·ソフトバンク 落選
            佐々木麟太郎 に 2球団  ソフトバンク 当選 / 日本ハム 落選
            (단독지명 구단은 접어 둔다)
   2회차 ── 落選한 구단이 다시 입찰 …
② 2순위 이후 (구단 × 라운드 표) — 웨이버 방향(→ ←)을 라운드마다
③ 育成
④ 사후 사실 — ⚠**지금은 항상 빈다**(`draft_note` 0행)
```

⚠**요구하신 「누가 걸렸고 다음 1지망을 누구로 바꿨는지」가 ①에서 그대로 드러난다** —
**회차가 내려갈수록 낙첨 구단이 다시 나타나는 구조 자체가 그 서사다.**

- [ ] **Step 1: 실패하는 시험을 쓴다**

⚠**`packages/web/test/home-page.test.ts` 의 관용을 따라라** — 데이터 빌더 + `assert.match(html.toString(), …)`.

최소한 이 다섯을 재라:
1. **경합 그룹이 「당첨 / 낙첨」으로 렌더된다.**
2. ⚠**단독지명이 경합과 섞이지 않는다** — 접어 두든 따로 두든, **「아무도 안 겹쳤다」가 「졌다」로 읽히면 안 된다.**
3. ⚠**2023 이 「NPB가 공표하지 않는다」로 렌더된다** — 「데이터가 없습니다」가 **아니다**.
4. ⚠**`player` 에 없는 선수는 링크 없이 이름만** 나온다.
5. **출처가 화면에 있다**(L3).

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test packages/web/test/draft-page.test.ts`

- [ ] **Step 3: 렌더러를 구현한다**

⚠**`packages/web/src/home-page.ts` 를 선례로 봐라**(시즌 단위 · 표가 여럿 · `renderXxxPage(data, ctx): RawHtml`).

**지켜야 할 것:**
- **태그드 템플릿 `html`** 을 쓴다(XSS 이스케이프가 거기 있다). ⚠**문자열을 직접 이어 붙이지 마라.**
- **`layout.ts` 의 `stateNote()`** 로 빈 상태를 낸다.
- ⚠**L2** — wikipedia 그리드(행=회차 × 열=12구단)를 **재현하지 마라.** ①은 **경합 그룹 단위**다.
- ⚠**L5·L6** — 사진·로고·엠블럼 금지. 구단은 **색 칩**(기존 `teamChip` 관용)으로.
- ⚠**「AI틱함」 회피**(루트 §7): 균질한 카드 그리드 · 이모지 · 목적 없는 glassmorphism · 중앙정렬 히어로 금지. **색은 도메인(구단 색)에서 뽑는다.**
- **모든 요소에 같은 `border-radius` 를 주지 마라** · **근거 없는 그림자를 쓰지 마라**(`design-graphics-engineer.md`).

- [ ] **Step 4: 시험을 통과시키고 커밋**

Run: `node --test packages/web/test/draft-page.test.ts` · `npm run typecheck`

```bash
git add packages/web/src/draft-page.ts packages/web/test/draft-page.test.ts
git commit -m "feat(web): 드래프트 화면 — 1순위 서사와 전체 표"
```

---

### Task 3: 빌드 등록 · 링크 · 문서 수치

**Files:**
- Modify: `packages/web/src/site.ts`
- Modify: `docs/operations/deploy.md` (배포물 수치)
- ⚠Modify(필요하면): `scripts/test/doc-figures.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `renderDraftPage`

- [ ] **Step 1: 경로를 등록한다**

`packages/web/src/site.ts` 의 `seasonPaths()` 에 드래프트 경로를 더하고, `buildSite()` 에 렌더 호출을 더한다.

⚠**경로 규칙**: 최신 시즌은 루트(`draft.html`), 과거는 시즌 폴더(`2019/draft.html`). `prefix` 가 그것을 만든다(`build.ts:86-88`).

⚠**2026 은 드래프트 데이터가 없다.** 그 시즌에 페이지를 만들지 말지, **만들되 「개최 전」으로 보일지** 정하라 — ⚠**만들지 않으면 시즌 전환 링크가 깨진다**(빌드가 그것을 잡는다).

- [ ] **Step 2: 빌드하고 링크 검사를 통과시킨다**

Run: `npm run build:web`

⚠**빌드가 링크를 검사한다**(`build.ts:292-312`): 깨진 링크 · 중복 id · **홈에서 3클릭 초과**. 셋 다 **exit 1** 이다.
⚠**3클릭 제약은 `CLAUDE.md` §0 제약1**이다 — 드래프트 페이지가 홈에서 **3클릭 안**에 닿아야 한다.

- [ ] **Step 3: 배포물 수치를 갱신한다**

⚠**새 페이지가 파일 수와 바이트를 바꾼다.** `CLAUDE.md` §2-2 와 `docs/operations/deploy.md` 에 **박힌 수치**가 있고, `scripts/test/doc-figures.test.ts` 가 그것을 **DB·배포물로 다시 센다**.

**빌드 후 실제 수치를 재서 문서를 갱신하라.** ⚠**손으로 추정하지 마라 — 세어라.**

⚠**Pages 파일 상한이 배포당 20,000개**이고 지금 **9,473파일 / 47.4%** 다. 드래프트가 **21시즌 × 1장 = 21장** 정도면 영향이 작지만 **실측해서 적어라.**

- [ ] **Step 4: 전체 시험과 커밋**

Run: `npm run typecheck`
⚠**전체 스위트는 코디네이터가 돌린다.**

```bash
git add packages/web/src/site.ts docs/operations/deploy.md
git commit -m "feat(web): 드래프트 페이지를 빌드에 등록한다"
```

---

## 이 계획 밖

| 후속 | 왜 |
|---|---|
| **wikipedia 파서** | 2023~2025 경합을 채운다. **3단계 게이트**(2005~2022 를 npb 와 대조해 불일치 0) 뒤에. 그때 ①의 빈 자리가 채워진다 |
| **`draft_note`**(교섭권 정정·입단 거부) | 파서가 없다. ④가 그때 살아난다 |
| **2004 이전** | ⚠**데이터가 아니라 구단 문제다** — `大阪近鉄`(`bu`) 소멸·`楽天`(`e`) 창단. **「그 시즌에 존재한 구단」 이력 마스터**가 선행 조건이고, 오릭스로 접으면 **2004 드래프트에 오릭스가 두 번 나온다** |
| **`（辞退）` 를 스키마에 남기기** | 2007 세이부의 「스스로 포기」가 지금 어디에도 안 남는다. `draft_note.note_kind` 에 항목 추가가 필요하다 |
