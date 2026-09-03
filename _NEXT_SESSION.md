# 다음 세션 인계 (2026-09-03 18:0x · 지침 정합성 복구 작업 중단)

## 0. 먼저 알아야 할 것 — ⚠**메인 체크아웃의 `_NEXT_SESSION.md` 는 전제가 반대다**

메인 체크아웃(`bb-app/` 루트)에 있는 `_NEXT_SESSION.md`(로컬 `main` 소속)는 이렇게 적는다:

> ⚠`.claude/worktrees/npb-foundation/` 에 **정리 전** 273행 `CLAUDE.md` 가 남아 있다.
> 그 브랜치를 살릴 계획이면 머지할 때 **현재 `main` 에 맞춰라**.

**그 방향이 반대다. 실측:**

| 항목 | 실측값 |
|---|---|
| 로컬 `main`(07cf86b) ↔ `origin/main`(f5f9120) | **ahead 3 / behind 549** |
| 갈라진 지점 `8647cb6` | **2026-08-15 14:31** |
| 그 사이 `origin/main` 에 쌓인 것 | **365파일 · +94,646행** |

즉 2026-09-03 의 지침 정리 3커밋은 **8/15 판 `CLAUDE.md` 위에서** 이뤄졌다.
그래서 로컬 `main` 의 `CLAUDE.md`(300행 · 26,951B)에는 8월 하순 실측이 없다 —
`Cache-Control` **0건** · `BB_ALL_SEASONS` **0건** · `2026-08-2*` 날짜 **0건**.

⚠**그 판을 「현재 main」으로 삼으면 사라지는 것**: 도루자 대조(6,875경기) · xFIP/WAR 사유 4차 정정 ·
「이름을 바꿔야 하면 패스」 기준(§2-2-2) · 통산 전환 판정표 · roster 미독 결함(2,374 중 917) ·
Pages 파일 상한 · 8/30 주소 동결 사고 · 8/31 CI 분 소진 + 수집 창 사고.

**사용자 결정(2026-09-03): 「최신 판 위에 정리를 다시 적용」.** 그래서 이 브랜치가 있다.

⚠**로컬 `main` 의 정리본을 그대로 베끼지 마라.** 그 판은 xFIP 사유를 「FB% 가 소스에 없다」로,
WAR 사유를 「타구 좌표가 존재하지 않는다」로 적는데 **둘 다 이미 실측으로 반증된 문장**이다.
가져올 것은 **구조**(무엇을 뺐는가)뿐이고 **내용은 최신 판이 정본**이다.

---

## 1. 이 브랜치에서 한 것

브랜치 `guidelines-realign` (기준 `origin/main` = f5f9120 · ⚠**push 안 함 — 승인 전**)

| 커밋 | 내용 |
|---|---|
| `8381799` | 감사 스킬 로컬 사본 제거(5파일) — 로컬 `main` 의 `6ffd99a` cherry-pick |
| `32fbe45` | 에이전트 5종 제거 + 11종 루트 참조 정리 (15파일 · +36 / −243) |

⚠**`.claude/settings.json` 의 `permissions.allow` 삭제는 옮기지 않았다.** 유저 레벨
(`~/.claude/settings.json`)에 대체가 없어 「중복 제거」가 아니고, 지우면 편의만 잃는다.

**베이스라인(작업 전 측정)**: `npm test` **2,123본 중 2,123본 통과** · fail 0 · ERROR 0 ·
skipped 0 · 356.6초 · exit 0 / `npm run typecheck` exit 0.

---

## 2. 다음에 할 일 — `CLAUDE.md` 재정리 (⚠**아직 손도 안 댔다**)

### 2-1. 반증을 통과한 26건 (울트라코드 6축 조사 · 39에이전트 · 오류 0)

조사 **61건 발견 → 33건 반증 판정 → 26건 통과 / 7건 기각(21%)**.
⚠**기각률이 21% 다. 반증 없이 반영하지 마라.**

**A. `CLAUDE.md` — 사실이 낡은 것**

| 줄 | 무엇이 틀렸나 | 어떻게 |
|---|---|---|
| **§1 전체(42~)** | 「스택 미확정 · **선택 전 구현 착수 금지**」인데 **완성돼 배포 중**(Node/TS 워크스페이스 · SQLite 163MB · 정적 생성 · Pages+Access · Actions). ⚠**`ADR-001` 은 저장소에 한 번도 존재한 적 없다**(`git ls-files \| grep -i adr` → 0건) | §1 을 「확정 스택」 절로 다시 쓴다 — 실제 구성과 **언제·왜 그렇게 됐는지**. `docs/decisions/` 의 실제 3건은 날짜 접두사 명명 |
| **8행** | 「스택·DB·호스팅·**제품명** 미확정」 — §7 은 「**BaseNine**(2026-08-15 확정)」이고 코드가 그 값을 기본값으로 갖는다. **같은 파일이 정면 충돌** | 「미확정」 목록에서 제품명을 빼고 스택도 §1 수정에 맞춘다 |
| **6행** | 「작업 규약의 뿌리 = `../PPS_NEW_PORTAL/CLAUDE.md`」 + 열거한 5항목이 **전부 루트가 소유**(검증 §1 · 분모 §1 · 감사↔구현 §4 · 모델/에포트 §4 · 침묵 오류 §6) | 「공통 규칙은 루트 `CLAUDE.md`(§0~§12)에서 자동 상속 · 이 파일에는 고유한 것만」으로 교체 |
| **736행** | `docs/decisions/ADR-XXX-*.md` 명명 규칙에 맞는 파일 **0건** | 실제 명명(날짜 접두사)으로 고치거나 기존 3건 개명 — §0-2 판정 기준·§1 과 함께 |
| **611행** | 플러그인 목록이 6개인데 실제 `enabledPlugins` 는 **7개**(빠진 것 = `shiro-core@shiro-common`) | 목록에 더하고 「`shiro-common` 은 GitHub 이 아니라 워크스페이스 `_common/` 소스」를 붙인다 |
| **613행** | 「프로젝트 `.claude/settings.json` 은 마켓플레이스 등록만 담당(PPS_NEW_PORTAL과 동일 구성)」 — 실제로는 `permissions.allow` 10건을 갖고, 그래서 「동일 구성」도 거짓 | 사실대로 고치고 「동일 구성」 삭제 |
| **690행** | 「`data/archive` 의 250.8 MiB 가 **git 이력에 남아** 되돌릴 수 없다」 — `data/` 는 `.gitignore` 2행이고 **그 경로를 건드린 커밋 0건** | 노출 경로는 git 이력이 아니라 **데이터 보관소 릴리스 자산**이다. 「이미 받아 간 사본은 되돌릴 수 없다」가 맞는 사유 |
| **641행** | 「남길 소스 표본 → `docs/sources/samples/`」 — 바로 위 줄이 「저장소가 참조하지 않는 파일은 아무 시험도 안 지킨다」라고 경고하는데 **그 자리가 정확히 그런 자리**(`.gitignore` 25행 · 추적 0) | 「⚠무추적 · 클론에는 0파일 · 재현은 `docs/sources/*.md` 의 URL·기준일·인용문으로」를 박는다 |

**B. `CLAUDE.md` §4 — 삭제된 에이전트가 표에 남아 있다**

- **§4 표가 16종을 싣는데 실재는 11종**. 5행(`junior-engineer` · `concurrency-correctness-auditor` ·
  `review-specialist` · `qa-test-engineer` · `chore-runner`)이 모델/에포트까지 달고 남았다.
- **§0-8 판정 기준(23행)** 이 삭제된 `concurrency-correctness-auditor` 에 합격 판정을 위임한다.
- **§3-5(561행)** 이중 검토가 「`review-specialist` 를 `model:"opus"` 로 오버라이드」인데,
  공통 8종은 **모델 기본치를 쓴다**(1차 라운드에서 이 지적의 *사유*는 기각됐다 — 아래 2-3 참조).
- ⚠**`qa-test-engineer` 만은 공통에도 없다**(공통 8종 = scout · chore-runner · test-runner ·
  junior-engineer · review-specialist · deep-reviewer · concurrency-correctness-auditor · factcheck-frame).
  → `shiro-core:test-runner` 로 대체하되, roster 의 「QA 계열 분리 규칙」이 **프리뷰 파이프라인 조작·
  스택 고유 하네스는 프로젝트에 남기라**고 한다. 그 몫을 받을 프로젝트 에이전트가 지금 없다.

**C. `CLAUDE.md` — 루트와 중복 (지울 것)**

| 줄 | 내용 | 루트 위치 |
|---|---|---|
| 708 | `background-attachment: fixed` 금지 | §7 117행 (루트는 **대체 패턴까지** 담아 더 강하다) |
| 709 | 「AI틱함」 금지 목록 5항목 | §7 118행 (이 제품 **추가분** 2개는 `design-graphics-engineer.md:26` 형식이 정본) |
| 710 | 비밀키를 코드·리포에 두지 마라 | §5 91행 (루트는 「시크릿 스토어에만」까지) |
| 574~580 | DeepSWE 모델·에포트 기준 4불릿 | §4 81~83행 (사유까지 동일) |

**D. `.claude/agents/` — 고칠 것**

| 파일:줄 | 무엇이 틀렸나 |
|---|---|
| `data-pipeline-engineer.md:20` | M4 를 「전 레코드에 `source`·`fetched_at`·`as_of`·`revision`」으로 지시 — **2026-08-27 에 거짓이라고 명시하고 폐기한 옛 문구 그대로**. 현행은 「어디서·언제는 전 수집 표가(부모를 타고든) · 몇 번째 판은 정정이 성립하는 표만(실측 6/11)」 |
| `data-pipeline-engineer.md:39`<br>`senior-engineer.md:34` | 파서 픽스처를 `docs/sources/samples/` 로 지시 — 실제는 **`packages/parser/test/fixtures/`**(추적 7파일). `samples/` 는 무추적 0파일이고 내용도 권리 조사 사본이다 |
| `senior-engineer.md:34` | `CLAUDE.md §3-2` 참조가 「신규 기능은 설계부터」를 가리킨다. 픽스처 규칙은 **§3-11(작업규칙 11)** |
| `frontend-architect.md:30` | `(§6 — 제품 UI 언어…)` 인데 §6 에 i18n·로케일 **0건**. 실제는 **§7 「제품 UI 언어」 행** |
| `sabermetrics-analyst.md:5` | description 이 「세이버 산식 확정(wOBA·wRC+·FIP·**WAR** 등)」 — WAR 은 **닫힌 항목**(§2-2-2 「이름을 바꿔야 하면 패스」). 이 에이전트를 부르면 닫은 것을 다시 연다. → 예시를 **SRC** 로 바꾸고 본문에 닫힌 목록(WAR·xFIP·통산 세이버)을 넣는다 |
| `devops-platform-engineer.md:24` | 「CI 는 타입체크 + 테스트 + **린트**를 전부 돌린다」 — **린트는 존재한 적이 없고**(§6 가 이미 정정) CI 는 `npm test` 만 돌린다 |
| `data-source-scout.md:49` | 「샘플을 `docs/sources/samples/` 에 저장해 재요청을 없앤다」 — 무추적이라 **이 기계에서만** 참. 다음 조사자는 L1 로 다시 쏜다 |

### 2-2. ⚠**미검증 19건 — 「0건」이 아니라 「안 쟀음」**

1차 조사에서 축당 상한(6)에 걸려 반증 못 한 19건이 있다. 2차 반증 워크플로를 띄웠으나
**PC 종료로 중단**했다. 스크립트가 남아 있으니 그대로 다시 돌리면 된다:

```
~/.claude/projects/C--Users-REDACTED-USER-Desktop----010-----bb-app--claude-worktrees-npb-foundation/
  047b805b-5885-409d-b7e0-e5dc0983417a/workflows/scripts/
  guidelines-staleness-verify-2-wf_2dd07185-a7e.js
```

→ `Workflow({scriptPath: "<위 경로>"})` (⚠`resumeFromRunId` 는 **같은 세션 전용**이라 못 쓴다 · 새로 돈다)

미검증분의 무거운 것: **i18n 키 체계가 저장소에 0건인데** §7(726행)·`i18n-engineer.md:28`·
`frontend-architect.md:30` 이 「하드코딩 금지 · 전부 키로」를 규칙으로 든다(= **지켜진 적 없는 규칙**) /
`frontend-architect` 가 「라이브 폴링/스트리밍 배선」을 역할로 두는데 **라이브 취득 금지 ·
`setInterval`/`EventSource`/`WebSocket` 0건 · 서버 없음** / `contrast_sweep.py` 는
`.claude/audit/target.json` 이 없으면 **exit 2 로 죽는다**(오버레이가 아직 없다) /
RO 에이전트 3종이 파일 산출을 임무로 받는데 `tools` 에 `Write` 가 없어 **Bash 로 우회하게 된다**.

1차 조사 전문(발견 61건 · 반증 33건의 사유 포함)은 저널에 남아 있다:
```
~/.claude/projects/C--Users-...-npb-foundation/047b805b-.../subagents/workflows/
  wf_94ffae69-bf3/journal.jsonl
```

### 2-3. ⚠**반증에서 배운 것 — 이걸 모르면 같은 실수를 한다**

1차에서 기각된 7건이 가르친 것:

1. **접두사 없는 맨이름은 오류가 아니다.** `_common/docs/agent-roster.md` 의 「별칭 매핑」 표가
   `concurrency-correctness-auditor` 같은 맨이름을 **공식 별칭**으로 인정한다.
   → `shiro-core:` 를 기계적으로 붙이는 수정은 **틀린 수정**이다.
2. **§3 「작업 규칙」을 통째로 지우지 마라.** 죽은 사본이 아니라 **다른 문서가 「작업규칙 N」으로
   인용하는 주소 공간**이다(`packages/parser/test/fixtures/README.md` 가 실제로 그렇게 가리킨다).
   지우려면 인용하는 쪽을 먼저 옮겨야 한다.
3. **라이브를 폐기된 것으로 읽지 마라.** 금지된 것은 라이브 **취득**(2026-08-15)이고,
   라이브 **표시**는 v2 로 살아 있다(제약 4). 두 개를 섞으면 M9(확정/잠정)의 근거까지 지우게 된다.
4. **플러그인 목록이 6개인 것**은 바로 옆 줄이 `shiro-core:` 를 설명하므로 실피해가 없다고 기각됐다
   (숫자가 틀린 것은 여전히 사실 — **사유가 약했을 뿐**이다).

---

## 3. 착수 순서 (제안)

1. **미검증 19건 반증을 먼저 돌린다**(위 스크립트). 파일을 고치기 전에 — 원문이 바뀌면 반증이 깨진다.
2. 26건 + 살아남은 것을 합쳐 **`CLAUDE.md` 재정리 1커밋**, **에이전트 수정 1커밋**으로 나눈다.
3. ⚠**§2(도메인)는 건드리지 마라.** `scripts/test/doc-figures.test.ts` 가 §2 의 수치·문장을
   DB·소스와 대조한다. 편집 대상은 **머리말 · §0 판정기준 2곳 · §1 · §3~§8** 이다.
4. 검증: `npm test`(2,123본 기준선) · `npm run typecheck`.
5. `_NEXT_SESSION.md`(이 파일)를 결과에 맞춰 갱신하고, **메인 체크아웃의 낡은 판을 어떻게 할지**
   사용자에게 확인받는다.

⚠**push 는 아직 승인받지 않았다**(CLAUDE.md §8). 원격에 올리기 전에 물어라.
