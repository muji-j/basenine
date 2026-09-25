# 다방면 감사 — 2026-09-25

스킬 `shiro-core:auditing-multi-dimensionally`(ultracode) · 전 범위(코드군 + 화면 19단위) · 차원 D1~D8 전부.
**수정은 하지 않았다.** 이 문서는 발견과 측정 범위만 적는다.

## 0. 한눈에

| 분류 | 건수 | 뜻 |
|---|---|---|
| **신규 확정** | **7** | 다른 벤더 모델(gpt-5.6-sol · high)의 **블라인드 반증을 견딘 것**(P1 2 · P2 5) |
| 동작 확정 · 정본 미대조 | 1 | 코드 동작은 반증을 견뎠지만 지적이 서 있는 **NPB 규정 원문**을 대조하지 않았다(C12) |
| 미검증 | 17 | 찾았지만 **반증을 안 돌렸다**(P2 표본 밖 8 · P3 9) — 합의·자기 확인은 확정 근거가 아니다 |
| 반증됨 | 0 | 반증 대상 **8건 중 0건**이 죽었다 |
| 원장 대조 | 102 | 해소 **67** · 기지 26(코드 재확인 10 · 미확인 16) · 판단済 9(전제 확인 8 · 미확인 1) |

**P0 는 0건이다**(분모: 찾기 25건). P1 은 둘 다 수집·적재의 멱등성·정정 순서다(C5 · C6).

> ⚠**「0건」과 「안 쟀음」을 섞지 않는다** — 재지 못한 범위는 §7 에 전부 적었다.
> 픽셀 대비는 **19화면 중 6화면**만 도구로 쟀다(나머지 13화면은 도구 ERROR · 계산값 대비로 따로 보완).

## 1. 조건 (재현에 필요한 것)

| 항목 | 값 |
|---|---|
| 기준 커밋 | `pub/main` = `5f8faec`(`muji-j/basenine`) · 감사 가지 `audit-2026-09-25` · 오버레이 보완 커밋 `d5c4be7` |
| ⚠로컬 `main` | `07cf86b` 는 무관한 옛 가지다 — 기준으로 쓰지 않았다 |
| 로컬 DB | `data/bb.sqlite` **파일 수정 09-11**(마이그레이션 021·022 적용)이지만 **경기 데이터는 2026-08-16 까지**(2026 시즌 675경기 · 취득 08-18). 인계 메모가 「09-11 적재본」이라 적은 것은 파일 시각이고 **데이터 기준일은 그보다 한 달 가까이 이르다** |
| 화면 | `npm run build:web` (2026-09-25 · exit 0 · 762초 · 9,548파일 1,491.6MiB · 링크 9,392장 깨진 것 0) → `npm run preview`(`http://127.0.0.1:4173` · **file:// 아님**) |
| 빌드 경고 | `BB_CONTACT` 미설정(로컬 빌드라 정상 · CI 는 `BB_REQUIRE_CONTACT=1`) · `予告先発が古い`(로컬 DB 가 낡아서) — 둘 다 결함 아님 |
| gh | 활성 계정이 **이 저장소의 소유 계정(`muji-j`)이 아니었다**(다른 계정이 활성). 이 라운드는 원격 쓰기가 없어 전환하지 않았다 |
| gh 격리 | 모든 감사 에이전트가 `GH_CONFIG_DIR=<빈 폴더>` · `GH_HOST=harness.invalid` 로 돌았고, 각자 첫 명령 `gh auth status` 가 **실패함을 확인**했다(보고 9/9 + 원장 대조 1/1) |
| npb.jp 요청 | 0 |
| 측정 스크립트 | 발견의 재현조건·검증법에 나오는 `<세션 스크래치>/wf/…` 는 **세션 임시 폴더라 보존되지 않는다.** 재현하려면 그 절이 적은 절차를 다시 짜라 |

## 2. 방법

**Workflow 판정(2단 게이트)**: 허가 = 인자 `ultracode`. 효율 = 관점 11(D1·D2·D2-c·D3·D4·D5·D6·D6-b·D6-c·D7·D8) × 코드군 2(서버측 패키지·scripts ≈ 32,000줄 / web 28,905줄 + 화면 19) → 에이전트 보고가 길어 메인 컨텍스트를 밀어낼 규모 → **Workflow**.
세션 규모 지침(10기 미만)에 맞춰 **워크플로를 둘로 나누고** 관점을 묶었다:

| 워크플로 | 찾기 | 반증 | 기수 |
|---|---|---|---|
| 코드군 `wf_dbbe3b60-685` | ① D1+D2-c+D7 — **외부**(gpt-6-astra · xhigh · 보안 판단) ② D2 — **외부**(gpt-5.6-sol · high) ③ D3 ④ D8(외부에 안 줌) | 외부 블라인드 1기 | 5 |
| 화면군 `wf_ac9b05e6-53b` | ⑤ D5+D6 ⑥ D6-b ⑦ D4+D6-c | 외부 블라인드 1기 | 4 |

- D2/D2-c · D6/D6-b/D6-c 는 서로 다른 에이전트로 쪼갰다.
- **블라인드 반증**: P0·P1 전건 + P2 는 3건에 1건 표본(각 워크플로 최대 6). 반증자에게는 **파일·행·관측 증상만** 주고 원 지적문·근거는 주지 않았다. 스키마는 `verdict.schema.json` 과 같은 필드를 배열로 묶은 것이고 **`ok && !refuted` 만 확정**이다.
- **`agentType` 외부 반증 스모크(1회)**: 코드군 반증 응답에 실제로 넘긴 `-m gpt-5.6-sol · high` · rc=0 · 항목마다 경로:행 인용이 있다 → **통과**. 응답 JSON 의 자기보고 `model` 은 「GPT-5」였고 믿지 않았다.
- 모델 섞기: 외부 벤더가 찾기 2관점과 반증 2기를 맡았다. Claude 쪽 찾기 5기는 같은 계열이다 — **그것을 「섞었다」로 세지 않는다.**

## 3. 원장 신선도 대조 (외부 · gpt-5.6-sol · high · rc=0 · ok=true)

대상: `ledger.paths`(`docs/audits/2026-08-21-*` · `docs/handover/**` · `docs/decisions/**` · `_NEXT_SESSION.md`) + 판단済 정본(오프시즌 설계서 §5·부록 E~K · `CLAUDE.md` §2-2 · `docs/metrics/`).
`_NEXT_SESSION.md` 는 **은퇴한 `muji-j/bb-app` 시절 이력**으로만 읽혔다(거기의 PR #90 은 지금 저장소의 PR 이 아니다).

- 항목 **102건** — 해소 **67** · 기지 **26** · 판단済 **9**.
- 중개자가 대조한 것: 인용 커밋 해시 **28/28 실재** · 경로:행 내용 **11/93** 직접 대조(1건은 행 번호만 밀림 — `query.ts:315` → 현재 439).
- ⚠**2026-08-21 원장은 이제 대부분 해소 기록이다.** 살아 있는 것은 아래 35건뿐이고, 그중 16건은 실기기·외부 관측이 필요해 이번 읽기 전용 라운드로는 **원래 닫을 수 없는** 항목이다(「손 검증 대기열」).
- ⚠판단済 1건(S1 허용목록 유지)은 코드 전제는 확인했지만 **실제 배포가 지금 302 를 돌려주는지는 네트워크 금지로 못 쟀다.**


### 3-1. 살아 있는 원장 항목 (기지 26 · 판단済 9)

「코드로 재확인」이 `미확인` 인 16건은 실기기·스크린리더·타 브라우저·외부 관측이 필요한 것이다 — **0건이 아니라 안 쟀다.**

| 등급 | 분류 | 코드로 재확인 | 위치 | 요지 |
|---|---|---|---|---|
| P3 | 판단済 | 확인 | `.github/workflows/daily.yml:117` | 코드 저장소와 비공개 데이터 저장소를 분리하는 결정의 구현 전제는 현재도 유지된다. |
| P3 | 판단済 | 미확인 | `.github/workflows/daily.yml:263` | 사이트를 Cloudflare Access 허용목록 뒤 S1로 유지하는 결정의 코드 전제는 살아 있다. |
| P3 | 판단済 | 확인 | `packages/web/src/assets.ts:4347` | 라이브 취득을 하지 않고 사용자가 상대를 고르는 정적 matchup을 제공하는 결정의 전제는 유지된다. |
| P3 | 판단済 | 확인 | `docs/decisions/2026-08-14-paid-track-verified.md:1` | 유료 VPS 트랙을 채택하지 않고 정적 Cloudflare 트랙을 유지하는 결정의 전제는 현재도 참이다. |
| P3 | 판단済 | 확인 | `CLAUDE.md:157` | 투수 WAR를 표시하지 않는 결정의 현재 전제는 코드와 문서에서 유지된다. |
| P3 | 판단済 | 확인 | `docs/handover/2026-08-21-session.md:24` | JBD·NPB BIP 문의를 나중에 결정한다는 보류는 현재도 정책상 채택된 선택이다. |
| P3 | 판단済 | 확인 | `packages/aggregate/src/bunt.ts:184` | 타순 순회가 아니라 타자별 상대 횟수를 쓰는 근사치는 명칭을 바로잡고 한계를 공개한 채 채택됐다. |
| P3 | 판단済 | 확인 | `packages/web/src/glossary.ts:103` | 파크팩터를 계산하지만 wRC+ 등에 배선하지 않는 선택은 현재 정의서가 확정한 트레이드오프다. |
| P3 | 판단済 | 확인 | `packages/aggregate/src/run-expectancy.ts:47` | 끝내기 하프이닝 제외는 현재도 존재하지만 정의서가 명시한 채택済 표본 규칙이다. |
| P3 | 기지 | 미확인 | `_NEXT_SESSION.md:93` | `.claude/settings.json`의 중복 권한 정리는 Codex 경계 밖이라 확인하지 않았다. |
| P3 | 기지 | 미확인 | `_NEXT_SESSION.md:93` | DeepSWE 원수치의 공통 roster 이관 여부는 현재 저장소 범위만으로 확인하지 못했다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:200` | `$CLAUDE_JOB_DIR/tmp` 누적 용량 과제는 현재 저장소 자료로 확인할 수 없다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:200` | 은퇴 저장소의 `design-2a` 원격 브랜치 삭제는 확인·실행되지 않았다. |
| P3 | 기지 | 확인 | `packages/web/src/assets.ts:615` | 선수 화면 탭줄 하나는 지금도 의도적으로 가로 스크롤을 사용한다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:200` | 순위 화면 12열 표의 의미 그룹화는 아직 구현되지 않았다. |
| P3 | 기지 | 확인 | `docs/superpowers/specs/2026-09-07-design-direction.md:151` | 폰트 preload는 현재도 적용되지 않았고 적용 비용도 측정되지 않았다. |
| P3 | 기지 | 확인 | `packages/web/src/assets.ts:2111` | 시즌 링크의 23.8px 표적은 24px보다 0.2px 작고 후속 문서도 미수정으로 남겼다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:120` | 체크박스로 구현한 접기 컨트롤의 실제 스크린리더 낭독은 미확인이다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:119` | 모바일 내비·목차 접기의 손 사용성은 자동 계측 밖의 미검증 항목으로 남아 있다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:118` | Plex·Noto·표준 서체의 실회선 297KiB 비용과 실제 가독성 비교가 남아 있다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:114` | 순위 화면의 문서 간 전환이 실제로 발동하고 체감상 버벅이지 않는지 확인되지 않았다. |
| P3 | 기지 | 확인 | `docs/handover/2026-09-08-design-night.md:49` | '초기값도 IBM Plex'를 스크립트가 있을 때만 Plex로 해석한 변경은 사용자 재확인이 남아 있다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-08-21-session.md:175` | 비교 화면 구단 紋 조합은 동일리그 30쌍 외 교류 조합이 미측정이다. |
| P3 | 기지 | 미확인 | `packages/web/src/assets.ts:862` | 툴팁 56항목 중 나머지 29개의 높이·작은 화면 수용성은 아직 측정되지 않았다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-09-08-design-night.md:122` | Firefox·Safari·macOS의 화면·전환 동작은 여전히 미검증이다. |
| P3 | 기지 | 미확인 | `packages/web/src/assets.ts:3587` | 터치+마우스 하이브리드 기기의 툴팁 거동은 코드 대응은 있으나 실제 기기 검증이 없다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-08-21-session.md:65` | `山形`/`山形市` 지방구장 명칭의 1차 출처 판정은 현재도 확인되지 않았다. |
| P3 | 기지 | 미확인 | `docs/handover/2026-08-21-session.md:50` | npb.jp 통산표 게시 시각은 허용된 로컬 자료만으로 여전히 확인되지 않았다. |
| P3 | 기지 | 미확인 | `packages/web/test/transitions.test.ts:13` | 비합성 transition 다수의 실제 성능 영향은 여전히 측정되지 않았고 정적 허용목록만 있다. |
| P3 | 기지 | 확인 | `packages/web/src/assets.ts:2569` | 명단 hover의 `padding-left` 레이아웃 애니메이션은 지금도 의도적 예외로 남아 있다. |
| P3 | 기지 | 확인 | `packages/web/src/assets.ts:877` | 5단계 등급색의 명도 순서가 단조롭지 않은 상태가 지금도 남아 있다. |
| P3 | 기지 | 확인 | `packages/web/src/assets.ts:3574` | 마우스로 연 툴팁은 버튼과 툴팁 사이를 이동할 때 mouseleave로 닫혀 내부 스크롤에 접근하기 어렵다. |
| P2 | 기지 | 확인 | `packages/web/src/assets.ts:3439` | 편집기 재렌더링이 DOM을 통째로 만들며 체크박스·이동 버튼의 키보드 포커스를 복구하지 않는다. |
| P3 | 기지 | 확인 | `packages/archiver/src/fetcher.ts:161` | 429 응답의 `Retry-After`를 읽지 않고 고정 지수 백오프만 사용한다. |
| P3 | 기지 | 확인 | `packages/store/tools/load-upcoming.ts:165` | 진행 중 경기가 `game`과 `upcoming_game` 어느 쪽에도 남지 않는 상태는 지금도 존재한다. |

## 4. 오버레이 점검 (별도 커밋 `d5c4be7`)

09-04 부트스트랩의 빈틈을 실측으로 메웠다(렌더된 18화면에서 요소 수/색 종류를 셌다):

| 항목 | 전 → 후 | 근거 |
|---|---|---|
| `units` | 14 → **19** | **하위 화면(구단 상세·경기일·날짜)이 통째로 없었다.** `teams/g` · `games/2026-08-15` · `days/2026-08-15` · 과거 시즌 `2025/postseason` · 경기 없는 시즌의 `2017/draft` 추가. 최상위 13화면은 dist 와 일치 |
| `selectors.dataColor` | 0 → **9** | 구단색 견본 등. 최대 `.gside .gt i` 40개/12색 · `.dia .db` 222/13. `i.up`·`i.dn` 은 각각 6/1 이라 **한 묶음**으로 넣었다 |
| `selectors.floating` | 0 → **2** | `.qhits`(검색 결과) · `#tip`(툴팁). 토스트·모달·`dialog`·`[popover]` 는 18화면 **0건** |

⚠과거 시즌 화면은 여전히 두 장만 들어왔다. `AGENTS.md` 는 여전히 없다(부트스트랩이 남긴 일).

## 5. 도구 스윕 (전체 출력을 받았다)

| 도구 | 결과 |
|---|---|
| **강제 배색** `forced_colors_sweep.py` | rc=0 · 19화면 × light/dark · 비교 A **1,546쌍** / B **138그룹** / C **580면**. 걸린 것: A `button.tab` 선택=비선택(3화면) · B 구단색 견본 1색(9화면). 도구가 스스로 센 「실측 미비 346건/12종」 |
| → 판정(D5 에이전트) | B 9/9 화면 **결함 아님**(8화면은 옆에 텍스트 라벨 · `teams/g` 는 행 이름이 나른다). A 는 `ranking` 결함 아님(굵기 700/400 이 남는다) · **`players`·`players/01005157` 결함**(→ W1 확정) |
| **대비** `contrast_sweep.py` | ⚠**전체 1회 실행은 첫 결과 전에 ERROR**(`Page.screenshot` 30초 타임아웃). 화면별로 다시 돌려 **측정 6/19**(ranking · players · starters · matchup · compare · players/01005157) — **위반 0**(matchup·compare 「픽셀 실측 미달 13인스턴스/1종」). **ERROR 13/19** 전부 같은 타임아웃 |
| → 보완 | D5 에이전트가 **계산값 대비**로 19화면 × 2테마 × 2뷰포트(1440·390) 전부 쟀다 — 위반 **0**(면제인 비활성 버튼 3개 제외 · 최소 4.54). ⚠**픽셀 대비는 13화면에서 여전히 안 쟀다** |
| **상태 구동** `state_driver.py` | ⚠**단독 진입점이 없다**(`__main__` 없음) — 라이브러리이고 두 스윕 안에서 돈다. 대비 측정 화면마다 「상태 26회」가 찍혔다 = 기동 + 내비 순회가 실제로 돌았다 |

⚠**대비 도구의 타임아웃은 원인을 끝까지 안 쫓았다**(지원 작업이 제품 감사보다 커지지 않게 — 루트 §4). 확인한 것: 같은 화면을 단독으로 찍으면 **0.2초**에 찍히고 무한 애니메이션은 **0/38 로드**다. `uiShims`·`overlays` 가 비어 있어 부유면을 여는 단계는 실행되지 않는다(내가 넣은 `floating` 이 원인이 아니다). 09-04 에는 같은 도구가 index 등을 쟀으므로 **그 뒤의 무엇(09-08 서체 도입 등)이 상태 구동과 부딪힐 가능성**이 있다 — 가설일 뿐이다. D6-b 에이전트도 선수 페이지에서 같은 증상을 봤다. 고칠 곳은 공통 도구(`_common/`)라 **이 프로젝트 작업에서 손대지 않았다.**

## 6. 결정적 스크린

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | rc=0 · 오류 0 |
| `npm test`(전체 · 단일 러너) | **2,801본 중 통과 2,800 · FAIL 0 · 취소(ERROR) 0 · 건너뜀 1** · rc=0 · 254.7초. 건너뛴 1본은 「공표값 대조 ③ 石井大智 시즌 넘김」 — 로컬 DB 에 2026 복귀 등판이 없어 **미대조**(합격이 아니다) |
| 에이전트가 개별로 돌린 시험 | 외부 D1 7파일 244/244 · 외부 D2 108/108 · D5 `css-contrast`+`forced-colors` 64/64 · D4 `transitions` 4/4 — **FAIL 0 · ERROR 0**. ⚠외부 모델의 읽기 전용 샌드박스는 `node --test` 가 `spawn EPERM` 으로 **ERROR** 가 났고 `--experimental-test-isolation=none` 으로 우회했다(결함 아님 · 샌드박스 탓) |
| D3 아카이브 실측 | 박스 7,805장(실시 7,518): 선수 ID 없는 타자행 0/211,862 · 투수행 0/63,315 · 해석 못 한 타석 토큰 0 · 이닝 0 · 격리 0 · 실시 경기의 PBP 파싱 오류 0 |
| D8 공표값 대조(T1) | 타격 선수-시즌 3,432건 14항목 어긋남 0 · 투수 1,857건 18항목 0 · 도루/도루자 1,290건 0 · 득점 합 7,367경기 0 |
| D6-b 링크·딥링크 | 렌더 링크 7,642 깨짐 0 · 앵커 133종 × 2뷰포트 안 보임 0 · `data-*` 경로 840 없는 파일 0 · 비교 화면 비율 442칸 분모 누락 0 |
| D4 | 무한 애니메이션 0/38 · CLS 최대 0.007 · 하드코딩 duration 0 · `font-display:swap` 12/12 · 500ms 넘는 긴 작업은 ranking 로드(872~927ms)뿐 |


## 6-A. 발견 — 발견사항 계약 형식

각 항목의 `근거` · `재현조건` · `수정안` · `검증법` 은 찾은 에이전트가 쓴 것을 그대로 옮겼다. 확신도는 **블라인드 반증 결과**로만 정했다.
⚠일부 항목(D3·D5+D6·D4+D6-c)은 에이전트가 **영어로** 썼다 — 근거 문장이 번역으로 변질되지 않게 **원문 그대로** 옮겼다(내부 문서 한국어 원칙의 의도적 예외).

## A. 신규 확정 — 블라인드 반증을 견딘 것 (7건)

### [P1/D2-revision-order (M4/M9)] `packages/store/src/load.ts:222` — C5
**경기 적재의 upsertGame이 fetched_at 최신성을 비교하지 않고 무조건 갱신해, 더 오래된 판(예: 옛 백업·과거 아카이브 재적재)이 나중에 들어오면 점수·상태·구장·fetched_at이 과거 값으로 되돌아가고도 revision이 오히려 올라간다.**

- 관측 증상: 인메모리 DB에 fetched_at=2026-09-02·away_runs=5인 game_id를 먼저 upsert한 뒤 같은 game_id에 fetched_at=2026-09-01·away_runs=4를 upsert하면, SELECT away_runs,fetched_at,revision 결과가 {"away_runs":4,"fetched_at":"2026-09-01T00:00:00.000Z","revision":2}로 나온다.
- 근거: packages/store/src/load.ts:215-265의 upsertGame은 `ON CONFLICT(game_id) DO UPDATE SET ... fetched_at = excluded.fetched_at, away_runs = excluded.away_runs, ...`로 무조건 갱신하며, revision을 올리는 CASE(245-265행)는 '내용이 바뀌었는가'만 보고 '더 새 판인가'는 보지 않는다. 같은 파일 178-197행의 probable_pitcher용 upsert는 대조적으로 `OR (excluded.fetched_at IS NOT NULL AND excluded.fetched_at > probable_pitcher.fetched_at)`이라는 최신판 가드를 명시적으로 갖고 있어, game 쪽에 같은 가드가 빠진 것이 설계 누락임을 시사한다. packages/store/tools/load-archive.ts:262-269의 주석은 '옛 아카이브로 되돌아가는 경우는 archive-guard가 앞에서 막는다'고 명시하는데, 내가 scripts/archive-guard.ts:90-130을 직접 읽은 결과 checkNotShrunk는 (a) 파일 수 감소 (b) 총바이트가 이전 대비 0.5%(최소 1,048,576B) 넘게 감소, 이 두 가지만 검사하고 개별 파일의 revision·해시·fetched_at은 비교하지 않는다 — 파일 수가 같고 바이트 차이가 작은 옛 세대 복원은 이 가드를 통과한다. 즉 코드 자신이 적어 둔 방어 전제가 실제로 성립하지 않는다.
- 재현조건: 운영자가 옛 백업(또는 오래된 수동 백필 아카이브)을 현재 data/archive에 복사해 넣고 load-archive를 재실행한다. 같은 game_id의 box 사이드카가 현재 DB보다 오래된 fetched_at을 가지면, 파일 수·바이트가 archive-guard 허용 범위 안에 들 경우 그대로 통과해 game 표의 점수·상태·구장·fetched_at이 과거 값으로 덮어써진다. 그 경기가 MAX_CATCHUP_DAYS(7일) 수집 창 밖이면 이후 일일 실행이 해당 날짜를 자동 재취득하지 않는다.
- 영향: 다음 정적 빌드가 퇴행한 경기 결과와 그것을 사용하는 순위·지표를 정상값처럼 게시한다. 화면에 오류 표시가 없는 침묵 오류이며, 수집 창 밖이면 다음 수집 사이클로 자동 자기치유되지 않는다 — CLAUDE.md가 명시한 '이 제품에서 가장 비싼 결함(에러 없이 조용히 틀린 숫자)' 범주에 정확히 해당해 P1로 판정했다.
- 수정안: game 적재에 최신판 가드를 추가한다. 최소한 `excluded.fetched_at >= game.fetched_at`일 때만 갱신하거나(probable_pitcher 패턴과 통일), 더 견고하게는 box 사이드카의 sha256 또는 source revision을 game 표에 보존해 동일 game_id의 단조 증가를 강제한다. archive-guard의 파일 수·총바이트 검사는 유지하되, 코드 주석에서 이것을 'revision 역행 방지'의 대체물로 서술하지 않는다(현재 서술이 거짓 안도감을 준다).
- 검증법: packages/store/test/game-upsert.test.ts(신규 또는 기존 파일에 추가)에서 인메모리 DB에 새 판(득점 5, fetched_at 2026-09-02)을 먼저 upsert하고 옛 판(득점 4, fetched_at 2026-09-01)을 나중에 upsert한 뒤 `SELECT away_runs,fetched_at,revision FROM game WHERE game_id=?`가 새 판 값을 유지하는지 단언한다. 반대 순서(옛 판→새 판)에서는 새 판이 정상 반영되는지도 함께 단언한다. `node --test packages/store/test/game-upsert.test.ts packages/store/test/store.test.ts`로 결정적으로 검증 가능하다.
- 반증(찾은 쪽 자기 시도): probable_pitcher처럼 game에도 별도 최신판 방어가 있는지 upsertGame 전체(215-276행)를 읽어 확인했으나 없었다. archive-guard가 '옛 복원을 막는다'는 주석의 실제 구현(scripts/archive-guard.ts:90-130)을 직접 읽어 파일 수·총바이트만 보고 개별 파일 내용은 비교하지 않음을 확인했다 — 주석의 전제가 거짓임을 코드로 반증했다. 마지막으로 codex가 실제 upsertGame 함수를 인메모리 DB에서 새 판→옛 판 순으로 호출해 과거 값 역행을 실행으로 재현했고, 나 역시 해당 SQL(load.ts:222-265)을 직접 읽어 WHERE 가드 부재를 확인했다 — 발견이 반증을 견뎠다.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 증상을 인메모리 DB에서 그대로 재현했다. upsertGame의 ON CONFLICT UPDATE 에는 새 입력의 fetched_at 이 기존 값보다 최신인지 확인하는 조건이 없고, fetched_at 과 away_runs 를 무조건 덮어쓴다(packages/store/src/load.ts:222-242). 값이 달라지면 기존 revision 에 1을 더한다(packages/store/src/load.ts:245-265). 따라서 최신(2026-09-02·5점) 기록 뒤 과거(2026-09-01·4점) 기록을 넣었을 때 실제 결과는 away_runs=4, fetched_at=2026-09-01T00:00:00.000Z, revision=2 였다. 독립 대조: 같은 파일 179-196행의 upsertProbablePitcher 에는 'WHERE probable_pitcher.fetched_at IS NULL OR excluded.fetched_at > probable_pitcher.fetched_at' 이라는 시간 역전 방지 가드가 있는데 upsertGame 에는 그 대응 가드가 없다 — 같은 파일 안에서 한쪽만 지켜지는 비대칭을 코드로 확인했다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D2(ext)

### [P1/D2-partial-failure (page-set atomicity)] `packages/store/tools/load-archive.ts:397` — C6
**경기의 4개 하위 페이지(index·playbyplay·box·roster)가 독립적으로 저장·적재되어, playbyplay만 실패하고 box가 갱신되면 game/box 유래 데이터는 새 판인데 pa_event/runner_event는 옛 playbyplay 판인 혼합 DB가 만들어질 수 있다.**

- 관측 증상: 고정 MemorySink로 playbyplay 요청만 실패시키고 box 요청을 변경된 본문으로 성공시킨 재현에서 outcomes=["unchanged","failed","stored","unchanged"], pbpBody="old-playbyplay.html", boxBody="new-box", pbpRevision=1, boxRevision=2가 관측된다.
- 근거: packages/archiver/src/discover.ts:111 `export const GAME_PAGES = ["", "playbyplay.html", "box.html", "roster.html"] as const;`를 직접 확인. packages/archiver/src/archive.ts:203-209의 archiveGame은 `for (const page of GAME_PAGES) { out.push(await archivePage(ref, page, deps)); }`로 각 페이지를 독립적으로 저장하며, archiveUrl(같은 파일 160-195행 부근)은 페이지별 try/catch로 실패를 결과 배열에만 담고 이미 저장된 다른 페이지를 되돌리지 않는다(직접 읽어 확인, 정확한 catch 블록 행은 192-194 부근으로 codex 인용 190-193과 약간의 오차가 있으나 구조는 일치). packages/store/tools/load-archive.ts:271은 `fetchedAtOf(join(dirname(file), "box.meta.json"))`로 box의 취득시각만 읽고, 390-425행(내가 직접 읽음)은 `file.replace(/box\.html\.gz$/, "playbyplay.html.gz")`로 playbyplay.html.gz 본문을 gunzip해 파싱하면서 playbyplay.meta.json의 시각이나 공통 세대/revision을 box와 비교하는 코드가 없다.
- 재현조건: MAX_CATCHUP_DAYS 창 안의 과거 경기에서 기존 4페이지가 이미 저장된 상태로 재수집한다. playbyplay 요청만 일시 실패시키고 box 요청은 정정된 본문으로 성공시킨다. 해당 실행 자체는 실패로 끝나 배포가 막히지만, .github/workflows/daily.yml의 백업 단계는 guard(archive-guard)만 통과하면 부분 아카이브를 보존한다(정확한 조건부 단계 행 번호 475-491은 codex 인용이며 내가 재확인하지 못함 — not_covered 참조). 이후 더 최근 경기로 MAX(game_date)가 전진하면 다음 실행이 이 과거 날짜를 재요청하지 않을 수 있고, 그 상태에서 load-archive를 재실행하면 box는 새 판, playbyplay는 옛 판인 채로 성공 적재된다.
- 영향: 경기 결과·선수 라인(박스 유래)은 새 판인데 타석·주자 사건 및 그로부터 파생되는 세이버메트릭스는 옛 PBP 기준으로 남아 서로 어긋난다. 최초 실패 실행의 배포는 막히지만 부분 백업이 보존되고, 다음 성공 실행에서 이 혼합 상태가 오류 표시 없이 게시될 수 있다. 수집 창 밖으로 밀리면 자동 복구도 보장되지 않는 침묵성 핵심 통계 오류로 P1로 판정했다.
- 수정안: 경기 수집에 공통 batch/generation ID를 부여해 필수 페이지가 모두 성공한 뒤 한 세트로 승격하고, 실패 시에는 해당 경기의 마지막 정상 세트 전체를 유지한다. 적재기에서도 box와 playbyplay 사이드카의 공통 generation을 비교해 불일치 시 그 경기 전체를 건너뛰고 명시적으로 실패 처리한다. 기존 per-file temp+rename(파일 단위 원자성)은 유지하되 경기 페이지 묶음 단위의 원자성을 추가한다.
- 검증법: 고정 fake fetcher와 임시 sink로 기존 정상 세트를 준비한 뒤 playbyplay 실패·box 변경을 강제하는 회귀 시험을 작성한다. 수집 후 활성 세트가 전부 옛 판으로 유지되거나 적재가 명시적으로 실패하는지 단언하고, 이어서 네트워크 재수집 없이 적재기만 재실행해도 새 box+옛 playbyplay 조합의 game/pa_event/runner_event가 생성되지 않는지 확인한다. `node --test packages/archiver/test/fetcher-archive.test.ts`(및 신규 archive-generation-coherence 시험)로 결정적 검증이 가능하다.
- 반증(찾은 쪽 자기 시도): per-file 쓰기가 원자적인지(잘린 파일 방지), 경기 단위 트랜잭션이 절반 DB를 막는지, 같은 실행 내 비정상 종료가 배포를 막는지 각각 확인했다 — 셋 다 성립하지만 서로 다른 '정상적으로 완료된' 파일들 사이의 세대 불일치는 어느 것도 막지 않는다는 것이 핵심이다. discover.ts·archive.ts·load-archive.ts 핵심 인용 행을 내가 직접 읽어 구조를 확인했고, codex의 fake fetcher 실행 결과(pbpRevision=1, boxRevision=2 동시 존재)도 이 구조와 논리적으로 일치한다.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 고정 MemorySink 재현에서 주장과 정확히 같은 outcomes=[unchanged,failed,stored,unchanged], pbpBody=old-playbyplay.html, boxBody=new-box, pbpRevision=1, boxRevision=2 를 관측했다. 페이지 순서는 index/playbyplay/box/roster 로 정의되고(packages/archiver/src/discover.ts:111-118, GAME_PAGES 상수), archiveGame 은 네 페이지를 차례로 '독립' 처리한다(packages/archiver/src/archive.ts:203-208). 각 성공 페이지는 즉시 개별 저장되고 revision 도 페이지별로 독립 증가한다(packages/archiver/src/archive.ts:171-191, packages/archiver/src/sink.ts:169-172). 인용된 load-archive.ts:397 은 원자성 결여가 '발생'하는 지점이 아니라 그 결과를 '소비'하는 지점이다 — box 를 별도로 읽은 뒤(packages/store/tools/load-archive.ts:238-242) playbyplay 를 별도로 읽으며(packages/store/tools/load-archive.ts:397-426), 두 페이지의 revision 일치를 검사하지 않는다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D2(ext)

### [P2/D1] `packages/archiver/src/fetcher.ts:149` — C1
**자동 리디렉션 요청이 수집 예의 규칙(L1: 1req/2~5초)의 요청 간격 제어를 우회한다**

- 관측 증상: minDelayMs=2000으로 설정했는데 연속 HTTP 요청 간격이 91ms·6ms로 측정됨(수집 대상이 302 리디렉션을 반환할 때)
- 근거: packages/archiver/src/fetcher.ts:120 `this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);` — 기본 구현이 네이티브 fetch. :142 `await this.waitForSlot();` 뒤 :149 `const res = await this.fetchImpl(url, { headers });` 에서 redirect 옵션을 지정하지 않는다. 네이티브 fetch의 기본 리디렉션 처리는 이 함수 호출 내부에서 일어나 :181-184의 waitForSlot 간격 제어를 다시 거치지 않는다. 저장소에서 직접 대조 완료 — 인용 코드와 라인 번호가 HEAD d5c4be7 기준 정확히 일치.
- 재현조건: 로컬 node:http 서버에서 /a → /b → /c 를 각각 302·302·200으로 응답하도록 하고, minDelayMs=2000인 기본 PoliteFetcher로 get('/a')를 1회 호출. 서버에 도착한 요청 3개의 인접 간격이 91ms·6ms로 2000ms 미달. 재현 1/1, 외부 요청 0회(codex 보고, 로컬 합성 서버 기준).
- 영향: 실제 npb.jp가 리디렉션을 반환하는 경로에서 L1을 위반해 원본 서버에 촘촘한 간격으로 요청한다. 복구 불가 데이터 손실이나 인가 우회는 아니다. 실제 npb.jp의 현재 리디렉션 발생 여부는 미측정.
- 수정안: fetch 호출에 redirect:'manual'을 지정해 리디렉션을 명시적으로 처리하거나, 각 Location 홉도 동일한 요청 큐·간격 제어(waitForSlot)를 통과시킨다. 허용 시 홉 수 상한도 둔다.
- 검증법: node:http 합성 서버로 다단 리디렉션(302→302→200)을 구성하고 요청 도착 시각을 기록. minDelayMs=2000인 PoliteFetcher로 get 1회 호출 후, 리디렉션을 거부한다면 서버 요청 1개, 지원한다면 모든 인접 요청 간격이 2000ms 이상이어야 함을 단언.
- 반증(찾은 쪽 자기 시도): get()의 직렬 promise chain·생성자의 최소 간격 검증·재시도 backoff가 이 경로를 막는지 확인했으나 모두 fetch 호출 바깥에 있어 한 호출 내부의 리디렉션 홉에는 적용되지 않는다(codex 자체 반증 시도, 내가 코드 구조로 재확인).
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 로컬 302→302→200 서버로 재현한 결과 minDelayMs=2000 인데 실제 세 HTTP 요청의 간격은 26.6ms 와 4ms 였다. 슬롯 대기는 바깥 fetchImpl 호출 전에만 수행되고(packages/archiver/src/fetcher.ts:141-149, 181-185), 기본 구현은 globalThis.fetch 다(packages/archiver/src/fetcher.ts:120). 요청 시 redirect 모드를 제어하지 않으며 FetchImpl 의 init 도 headers 만 받는다(packages/archiver/src/fetcher.ts:23-27). lastRequestAt 도 리디렉션을 모두 따라간 fetch 가 반환된 뒤에야 기록된다(packages/archiver/src/fetcher.ts:149-150). 따라서 내부 리디렉션 요청에는 L1 간격이 적용되지 않는다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D1+D2c+D7(ext)

### [P2/D2c] `packages/web/src/assets.ts:4725` — C4
**비교 화면에서 URL 파라미터 복원이 지연 도착 시 사용자가 그 사이 고른 새 선택을 조용히 덮어쓴다**

- 관측 증상: 사용자가 고른 선수 표시가 새 선택(예: id=33)이었다가, 색인 로딩 완료 후 URL의 기존 선수(예: id=11)로 자동 변경됨
- 근거: packages/web/src/assets.ts:4718-4728 `const ia=qs("a"),ib=qs("b"); if(ia&&ib){ withIndex(idx=>{ ...; setInput("a",pa);show("a",pa);setInput("b",pb);show("b",pb); run(); }); fetchIndex(); }` 는 대기 중 사용자의 선택 변경 여부를 검사하지 않고 무조건 실행한다. :4475-4481 `$$("#cmpToday [data-pick]").forEach(...)` 의 빠른 선택 버튼은 그 대기 시간 동안 클릭 가능(서버 렌더 데이터라 색인 로딩과 무관). :4670-4682의 cmpGen 세대 보호는 비교 요청끼리만 보호하며, 이 URL 복원의 콜백 자체가 새 run()을 시작해 최신 세대를 다시 차지한다. 저장소 직접 대조 완료.
- 재현조건: ?a=11&b=22 인 공유 비교 URL에서 색인(players.json) 로딩이 끝나기 전에 빠른 선택으로 다른 선수(id=33)를 고른 뒤 응답을 해제. 선택 라벨이 33에서 11/22로 되돌아가고 비교 샤드 요청도 URL의 11·22로 자동 시작됨(재현 1/1, codex 보고).
- 영향: 사용자의 최신 선택 상태가 조용히 사라지고 원래 공유 링크의 비교로 되돌아간다(침묵성 — 에러 없이 사용자 조작이 무효화됨). 다시 선택하면 복구되나 느린 초기 로딩에서 반복될 수 있다. 표시되는 수치 자체가 틀린 것은 아니고 '어떤 두 선수를 비교하는가'라는 선택 상태가 되돌아가는 결함이다.
- 수정안: URL 복원 대기 중 사용자의 입력·선택·교환이 발생하면 초기 복원을 취소한다. 사용자 조작 세대를 별도로 캡처해 콜백에서 확인하는 방식으로 비교 요청 세대(cmpGen)와 독립적으로 보호한다.
- 검증법: packages/web/test/client.test.ts에서 location.search를 ?a=11&b=22로 설정하고 players.json 응답을 보류. id=33 선수를 선택한 뒤 응답을 해제해도 선택 id·라벨이 유지되고 URL의 11·22 비교가 자동 시작되지 않음을 단언. 사용자 조작이 없는 대조군에서는 11·22가 정상 복원돼야 함. 실행: node --test --experimental-test-isolation=none packages/web/test/client.test.ts (파일 존재 확인 완료).
- 반증(찾은 쪽 자기 시도): cmpGen의 마지막 요청 우선 보호와 샤드 Promise 캐시가 초기 복원에도 적용되는지 추적했으나, 초기 복원 콜백은 사용자 변경을 검사하지 않고 자체적으로 새 run()을 호출해 오히려 최신 세대를 차지한다. 공유 picker의 검색어 검사(발견3)와 달리 이 경로는 별도 withIndex 콜백이라 그 보호도 적용되지 않는다.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 색인이 아직 없으면 URL 복원 콜백은 대기열에 들어가고, 색인 fetch 완료 시 나중에 실행된다(packages/web/src/assets.ts:4170-4183, withIndex/waiting 큐). 그 사이 사용자는 '오늘 대전' 버튼으로 최신 선택을 chosen 에 기록할 수 있다(packages/web/src/assets.ts:4475-4480). 그러나 대기 중이던 URL 복원 콜백은 사용자 조작 여부나 세대 번호를 확인하지 않고 URL 의 선수로 두 슬롯을 무조건 다시 설정한다(packages/web/src/assets.ts:4718-4727, 4725 포함). 따라서 색인 완료 후 과거 URL 선택이 더 최신 사용자 선택을 덮어쓰는 순서가 코드상 성립한다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D1+D2c+D7(ext)

### [P2/D5+D6] `packages/web/src/assets.ts:602` — W1
**Tabs placed inside a section heading (h2 .sw) inherit h2 bold through .tab{font:inherit}. Selected and unselected tabs then have the same weight, so the selected state is shown by team colour alone. In forced colors the two cannot be told apart.**

- 관측 증상: On a player page (split tabs and metric tabs), the selected tab and the others are the same thickness, and in dark mode for teams such as Lotte and Orix the selected tab's fill is nearly invisible against the background.
- 근거: assets.ts:602 `.tab{font:inherit;...}` · assets.ts:606 `.tab[aria-selected="true"]{background:var(--team);color:var(--team-ink);font-weight:var(--w-bold)}` · parts.ts:259 `<h2>${o.title}...<span class="sw">${o.controls}</span></h2>` puts the tabs inside the h2. CDP matched rules for an unselected tab: `.tab font-weight:inherit` ← `inh .block > h2 font-weight:var(--w-bold)`. Measured (normal mode, one player page per team for all 12 teams): selected/unselected weight is 700/700 in every group (split 8 tabs, metric 12–15 tabs). Selected fill vs container: dark DeNA 2.54, Carp 2.83, Chunichi 1.35, Nippon-Ham 2.40, Lotte 1.10, Seibu 1.46, Rakuten 1.74, Orix 1.08 (8/12 below 3:1); light Giants 2.79, Hanshin 1.61, Yakult 2.72, SoftBank 1.64 (4/12). Union: 12/12 teams fall below 3:1 in at least one theme. Selected vs unselected ink contrast in those cases is 2.18–2.84. Forced colors (emulated): on players/01005157 the split 8 and metric 15 tabs, and on players the 打者/先発/救援 3 tabs, have selected = `700|rgb(255,255,255)|rgb(0,0,0)|border rgb(0,0,0) solid` and unselected = `700|rgba(255,255,255,0)|...` (transparent over Canvas, so it looks the same). The justification in forced-colors.test.ts:224 (「고른 쪽은 굵기로 산다」, "the selected one lives through its weight") and the comment at assets.ts:601 (「배경 + 굵기가 말한다」, "background + weight carry it") are false for these groups.
- 재현조건: py -3 probe4.py (<세션 스크래치>/wf/d5d6/) → 'SAMEW' lines · probe2.py (forced_colors='active') → players/01005157 all tabs 700
- 영향: Keyboard, low-vision and high-contrast users cannot see which split or metric is showing. The panel content changes, but the tab row does not say which one is current. It is not silent, because the panel content reveals the context, so no Q3 escalation. The team colour of every team falls below 3:1 in at least one theme.
- 수정안: Cut the inheritance with `.sw .tab{font-weight:var(--w-reg)}`, or give .tab its own `font-weight:var(--w-reg)`. That restores the weight channel of the selected rule. forced-colors.test should check that selected and unselected weights actually differ in computed values (the current test only checks that a selected-rule declaration exists).
- 검증법: On players/01005157 in normal and forced-colors mode, compare getComputedStyle(fontWeight) of tabs with aria-selected=true and =false in each .tabs group. Currently 700 = 700 is reproduced.
- 반증(찾은 쪽 자기 시도): I tried to argue that team colour is fine as an identity signal (the comment at assets.ts:520). That argument covers the identity mark, not state indication, and the repo has already swapped team colour for tokens three times when it carried state (assets.ts:2123–2129). The ranking segmented tabs keep 700/400, so I limited the finding to the tabs inside h2. The forced-colors sweep's A (players/ranking) is the same phenomenon, but on ranking the weight difference means it is not a defect.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 반증 실패(=결함 존재 가능성 확인). codex 근거: 롯데 선수페이지 --team:#22262b(dist/players/01005157.html:25) · .tab이 font:inherit이고 h2>span.sw>div.tabs>button.tab 구조로 h2의 font-weight:var(--w-bold)를 그대로 상속하며 aria-pressed 선택 상태도 같은 bold를 재지정할 뿐이라 굵기 차이가 없다(dist/players/01005157.html:283/3929 구조, dist/assets/site.css:283-288 규칙, packages/web/src/assets.ts:602-607 소스 동일). 다크 패널 --panel:#1c1e23(dist/assets/site.css:62-63) 대비 선택 배경이 팀색 그대로(background:var(--team,#6b7280)). 내가 추가로 대조한 근거: packages/web/src/assets.ts:2124(오릭스 다크 1.020, 롯데 1.004 — 다른 요소인 밑줄에서 실측) · :2223("ロッテ #22262b 는 다크 1.10:1" — 순위숫자색에서 실측, 같은 이유로 팀색 미사용 결정) · :2455(같은 조합 다크 1.08/1.10 — compare 페이지 도형 선에서 실측, 같은 이유로 선에서 제외). 즉 이 프로젝트는 동일 색상쌍의 저대비를 이미 3곳에서 실측·문서화하고 매번 '팀색을 선/글자에 쓰지 않는다'로 처방했는데, .tab[aria-pressed] 배경(assets.ts:606-607)에는 그 처방이 적용되지 않은 것으로 보인다 — codex가 인용한 511-514(미니 다이어그램용 수치)보다 이 세 곳이 더 직접적인 근거다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D5+D6

### [P2/D6] `packages/web/src/assets.ts:1980` — W4
**The season strip's scroll-padding-left:84px is smaller than the strip's padding-left calc(var(--gut)+var(--pad)), which is 128px at 1440. On draft screens, where the strip overflows, scroll snap at load (even without JS) scrolls the strip by 108px and years end up under the sticky label 「シーズン」 or to its left. This is the same overlap as a defect the user already reported.**

- 관측 증상: When the draft screen loads at a width of 1440, 「2026年」 appears to the left of the 「シーズン」 label, overlapping it, and 「2025年」 is mostly hidden behind the label.
- 근거: assets.ts:1975–1980 `.seasons{padding-left:calc(var(--gut) + var(--pad));... scroll-snap-type:x proximity; scroll-padding-left:84px}` · :2097 `.slab{position:sticky;left:0;z-index:3;...}` · :2105 `.seasons a{scroll-snap-align:start}`. The comment at :1967–1971 records the 2026-08-18 user report (「시즌 텍스트와 2026년이 겹침」, "the season text and 2026年 overlap") and says the padding was set 「라벨 폭(약 50px)+여백보다 넉넉하게」 ("with more room than the label width, about 50px, plus margin"), but it does not account for the strip's own padding-left (128px at 1440). Measured: draft and 2017/draft at 1440 on load: scrollLeft=108, slab at x=128, 2026年 overlap 0.26 and to the left of the slab, 2025年 overlap 0.60. The same with JS off (0.24/0.64), so revealInStrip is not the cause. At 1000px after the user scrolls 150px: 2025年 overlap 0.90. index and players/01005157 do not overflow at 1440/900/800, so it does not occur there. Screenshot: sb0_draft_1440.png. 2 of 19 units (the 22 draft-only screens, 2005–2026, are affected by extension).
- 재현조건: py -3 probe7.py (<세션 스크래치>/wf/d5d6/) → 'LOAD' sl=108, links overlap
- 영향: On draft screens the 「今どの年か」 (which year is current) indicator is corrupted by the overlap on first render. When 2025年 has keyboard focus, 60% of it is hidden behind the label: 2.4.11 is only a partial obstruction and passes, and 2.4.12 (AAA) fails.
- 수정안: Tie scroll-padding-left to the actual padding plus label width, for example `calc(var(--gut) + var(--pad) + 84px)`, or make .slab sticky with `left:calc(-1 * (var(--gut) + var(--pad)))` so it covers the padding area too. Add a test that checks, after load, the overlap between .slab and each a on draft screens at >680px width.
- 검증법: On draft.html at 1440 wide, measure #seasonbar.scrollLeft and the overlap of each a rect with .slab. After the fix it should be 0/0.
- 반증(찾은 쪽 자기 시도): I suspected JS (revealInStrip), but it reproduces with JS off, so the cause is CSS snap. At 390 the strip wraps (≤680px), so it does not occur there. At 1440 on regular screens (9 seasons) the strip does not overflow, so they are unaffected. The ledger's 「시즌 링크 표적 23.8px」 ("season link target 23.8px") is a different issue: a target-size difference of 0.2px.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 반증 실패. HTML 순서는 라벨→2026→2025(dist/draft.html:64-70, 직접 대조 확인). .seasons가 overflow-x:auto·scroll-snap-type:x proximity(dist/assets/site.css:1083-1088, 직접 대조 확인 — 라인 번호까지 정확히 일치). .slab 라벨이 position:sticky;left:0;z-index:3;background:var(--panel-2) 불투명 배경(dist/assets/site.css:1129-1137, 직접 대조 확인). site.js의 revealInStrip()이 nav.getBoundingClientRect()의 n.left/n.right만 비교하고 스티키 라벨이 점유하는 폭은 별도로 빼지 않는다(dist/assets/site.js 확인 — revealInStrip/showCurrentTab 함수 실재 확인). 따라서 코드상 스티키 라벨이 스크롤된 콘텐츠 위를 덮는 구조 자체는 확인되나, 1440px 최초 로드에서 실제로 2026/2025가 얼마나 가려지는지(스크롤 초기 위치·정확한 px)는 정적 코드만으로는 계산이 어렵다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D5+D6

### [P2/D4] `packages/web/src/assets.ts:3392` — W9
**The scroller overflow check (mark) reads scrollWidth and offsetLeft on scrollers inside panels closed with hidden="until-found" (content-visibility:hidden). Each read forces a layout of the hidden panel, so the ranking page takes 84–85 forced layouts on load and again on the first 個人 tab click.**

- 관측 증상: On ranking.html the first click on the 「個人」 tab takes 446–561 ms of synchronous handling at x1 and 3.6–5.1 s under 4x CPU throttling; the screen does not respond during that time.
- 근거: assets.ts:3392 `$$(".scroller").forEach(el=>{ ... const overflows=el.scrollWidth>el.clientWidth+1; ... $$(FOCUSABLE,el).forEach(f=>{ ... f.offsetLeft ... f.offsetWidth` iterates over every scroller (ranking has 95), including hidden ones. Line 3181 `if(shut&&SUPPORTS_UNTIL_FOUND&&p.setAttribute)p.setAttribute("hidden","until-found")` closes panels with until-found, and line 775 `[data-panelgroup][hidden="until-found"]{display:block;content-visibility:hidden}`. The comment at 3432-3434 (「그때 hidden 이던 탭 안의 표는 scrollWidth === clientWidth === 0 이라」) is false for until-found. Measured on ranking at 390: of 92 scrollers inside until-found panels, 92/92 return a nonzero scrollWidth. Trace (devtools.timeline stack) on ranking 390 load: 108 Layout events, of which 84 (402 ms) come from `(anon):301 < mark:299 < (anon):177` (site.js; 177 = tabHooks.forEach) and 10 (105 ms) from `slide:147` (void el.offsetWidth). The same pattern occurs on the first 個人 click: 85 (379.6 ms) plus 10 (64.3 ms); at x4, 3,558 ms plus 610 ms. A/B test that changes only the feature detect (delete HTMLElement.prototype.onbeforematch, which switches until-found to display:none), ranking 390: load layouts 108→7, layoutMs 596→271, TBT 694→230 ms; first 個人 click sync 463→37 ms, layouts +97→+5. At x4: load TBT 8,491/7,951→2,491/3,150 ms, first click 3,601/4,227→396/374 ms. The same thing happens on 2019/ranking (108 layouts, long task 986 ms). In the load-time A/B across all 19 units, 9 screens have until-found; the gap is large only on ranking and small on players/01005157 (29 vs 7 layouts, TBT 379 vs 272) and teams/g (15 vs 7, TBT 418 vs 286). After the first reveal, repeated toggles cost +3 to +6 layouts and 48–82 ms.
- 재현조건: Serve dist with npm run preview, then load http://127.0.0.1:4173/ranking.html in Chromium at 390×844, wait 1.5 s, and run `document.querySelector('[data-tabgroup="ranktype"] [data-tab="personal"]').click()` bracketed by performance.now(). Scripts: <세션 스크래치>/wf/d4/uf_ab.py · trace.py · trace_load.py · uf_width.py
- 영향: The main exploration path on the ranking screen (all 9 season ranking.html pages) is the heaviest place on the site, on load (TBT about 3x) and on the first tab switch (INP about 12x at x1). The effect grows on mobile. No values are wrong (not silent), so this is P2.
- 수정안: In mark(), skip scrollers inside hidden panels, e.g. `if(el.closest('[hidden]'))return;` (they are re-checked by tabHooks when opened, as today), and separate the geometry reads from the attribute writes (read everything first, then write). Keep until-found (Ctrl+F feature). Correct the false comment at 3432-3434 in the same change. For regression, a Playwright measurement (layout count on ranking load ≤ about 10) is more reliable than a stub DOM.
- 검증법: Run uf_ab.py and trace_load.py again after the fix: ranking 390 load Layout events 108→about 7, and the mark:299 stack frames disappear from the trace. First 個人 click sync under 100 ms at x1 (display:none baseline 37–47 ms). The Ctrl+F reveal (beforematch) behavior is unchanged.
- 반증(찾은 쪽 자기 시도): Checked whether it was noise: 2 runs per condition at x1 and x4, results consistent (±10%). Checked whether the DOM size itself is the cause, as opposed to until-found: the A/B keeps the same DOM and the same script and toggles only the feature detect, and the gap reproduces, so it is not DOM size alone. Checked whether the attribute writes (tabindex/role) invalidate layout: at 1440, regions=0 (no writes happened), yet 97 layouts still occurred, so the cause is the hidden-content geometry read, not the writes. Checked whether it is a one-time initialization cost: after the first reveal, toggles are cheap, but it recurs on every load and on the first click.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — 반증 실패. 탭 클릭 핸들러가 동기적으로 showTabs()를 호출(packages/web/src/assets.ts:3212-3215, 직접 대조 확인 — b.addEventListener("click",()=>{...;state.tabs[g]=b.dataset.tab;save(state);showTabs();})). showTabs()는 마지막에 revealSelectedTabs()와 tabHooks.forEach(f=>f())를 동기 실행(packages/web/src/assets.ts:3203-3204, 직접 대조 확인). 등록된 mark 훅이 모든 .scroller에서 scrollWidth/clientWidth를 읽고 각 FOCUSABLE 요소의 offsetLeft/offsetWidth까지 순회한다(packages/web/src/assets.ts:3390-3403, 직접 대조 확인). 결정적으로, 소스 자체의 주석이 이 시나리오를 정확히 지목한다: mark()는 showTabs() 호출 전에 등록되어 hidden 상태였던 패널은 scrollWidth===clientWidth===0으로 읽혀 '넘치지 않음'으로 오판되고, 탭이 바뀔 때(hook으로) 다시 측정하며 '순위 화면의 리그·지표 탭이 전부 여기 해당한다'고 프로젝트 스스로 명시한다(assets.ts, mark 함수 하단 주석). ranking.html은 이 대상이 다수(개인 패널이 최초 hidden인 대형 DOM)라 첫 클릭 시 강제 레이아웃 재계산이 집중되는 구조가 소스 차원에서 확인된다.
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D4+D6-c

## B. 동작은 확정 · 도메인 정본 미대조 (1건)

⚠코드 동작과 로컬 DB 재현은 외부 반증을 견뎠다. 그러나 이 지적이 서 있는 **「NPB 最高勝率의 자격은 13勝以上」이라는 외부 규정은 1차 출처로 대조하지 않았다**(이 라운드는 npb.jp 요청 0). 오버레이 D8 규칙상 정본 인용 없는 지적은 확정으로 올리지 않는다.

### [P2/D8⑤ 자격 기준(타이틀 자격)] `packages/web/src/query.ts:958` — C12
**개인 勝率 순위를 「最高勝率(NPB 공식 타이틀)」로 내면서 자격을 NPB 規定投球回로 걸고, 화면에 「最高勝率はNPBの規定投球回が資格」이라고 적는다. 그런데 완결 16 리그-시즌 중 4곳에서 1위가 13勝以上 기준의 1위와 다르다.**

- 관측 증상: 2018 パ 순위표 勝率 1위가 菊池 14-4 이고, 13勝-2敗(.867)인 ボルシンガー는 그 표에 순위가 없다. 2025 パ 1위는 モイネロ 12-3 이고 大関 13-5 는 1위가 아니다.
- 근거: query.ts:952-960 주석「**最高勝率** — NPB 공식 타이틀 … ⚠**선발 목록에만 둔다.** 最高勝率의 자격은 **NPB 규정투구회**인데」, rate("winPct","勝率",…) 가 rankPitchersInRole(선발·isQualifiedPitcher = teamGames×3 아웃)로 순위를 매긴다(aggregate/src/leaderboard.ts:283-285 · 358-376). 화면 문구 player-page.ts:1399「最高勝率はNPBの規定投球回が資格ですが」. 정의서 docs/metrics/README.md §5-B 「순위 부문」:「⚠**勝率은 선발 부문에만 있다.** 最高勝率의 자격은 **NPB 규정투구회**인데」. 실측(wpct.ts · 2018~2025 정규): 우리 1위와 「13勝以上 중 勝率 1위」가 다른 리그-시즌이 4/16이다. 2018セ 東 11-5 대 大瀬良 15-7 · 2018パ 菊池 14-4 대 ボルシンガー 13-2(353아웃 = 117.2回로 규정 미달) · 2020パ 涌井 11-4 대 (13勝 없음) · 2025パ モイネロ 12-3 대 大関 13-5(440아웃). 나머지 12곳은 같다.
- 재현조건: cd 저장소; node <세션 스크래치>/wf/d8/wpct.ts — aggregateSeason→buildLeagues→pitchingEntries 로, 선발·규정 도달자의 勝率 1위와 w≥13 인 투수의 勝率 1위를 리그-시즌마다 비교한다(readOnly DatabaseSync).
- 영향: Q3 침묵이라 승격했다. 값(勝/敗)은 T1 로 전부 맞는다(1,857건 어긋남 0). 틀린 것은 자격 규칙인데, 화면이 그 규칙을 「NPB 공식」이라고 단언한다. 사용자는 NPB 最高勝率 수상자가 순위표에 없거나 1위가 아닌 것을 보고도 왜인지 알 수 없다. 정의서 §0 이 「공식 = 산출 주체의 공개 정의를 인용하고 URL 병기」라고 하는데, 이 줄에는 인용 URL 이 없다.
- 수정안: 수정은 하지 않았다. 선택지로 올린다. ① NPB 표창 규정 원문(npb.jp 의 타이틀 규정 페이지)을 1차 출처로 확인하고, 13勝以上이 맞으면 자격을 승수 기준으로 바꾼다. 그러면 역할 필터와도 분리된다(구원도 13勝이면 자격). ② 또는 「最高勝率」·「NPB」라는 말을 화면과 정의서에서 빼고 「規定投球回到達者の勝率順」이라는 자체 정의로 표기한다. 어느 쪽이든 §5-B 와 query.ts·player-page.ts 문구를 함께 고친다.
- 검증법: NPB 1차 출처로 타이틀 자격 문언을 확인한다(워크플로 밖). 그 뒤 wpct.ts 를 다시 돌려 우리 1위가 역대 공표 最高勝率 수상자와 16/16 일치하는지 대조한다. 2018パ ボルシンガー · 2025パ 大関가 판별 케이스다.
- 반증(찾은 쪽 자기 시도): 반증 시도 ⑴ 역할 필터 때문에 규정 도달 투수가 빠지는 것 아닌가 → 구원 판정인데 규정투구회를 채운 투수는 0/176이라 원인이 아니다. ⑵ 우리 승패 집계가 틀린 것 아닌가 → career_pitching 대비 w·l 어긋남 0/1,857. ⑶ 13勝 규칙이 내 기억일 뿐인가 → 외부 접속 금지라 원문을 보지 못했다. 다만 13勝-2敗·117.2回인 ボルシンガー(2018)가 規定 미달인데도 수상자라는 공개 기록과, 이 규칙이 우리 데이터에서 그를 1위로 내는 것은 서로 맞는다. 2020パ 는 단축 시즌 특례가 있었을 수 있어 판별 케이스에서 뺐다.
- 반증(블라인드): 외부 블라인드 반증(gpt-5.6-sol · high): ok=true · refuted=false — read-only 로컬 DB로 실제 loadSite 를 실행해 두 증상을 모두 재현했다. 2018 パ는 菊池 14-4(.778)가 1위이고 ボルシンガー 13-2(.867)는 순위가 없었으며, 2025 パ는 モイネロ 12-3(.800)가 1위이고 大関 13-5(.722)가 2위였다. 원인은 勝率도 다른 선발 지표와 같은 rankPitchersInRole 을 사용하기 때문이다(packages/web/src/query.ts:844-879, 944-974). 그 공통 자격 판정은 승수 기준이 아니라 투구 아웃 수가 규정투구회 이상인지 검사한다(packages/aggregate/src/leaderboard.ts:278-288, 372-376). 2013년 이후 NPB 最高勝率의 공식 자격은 13승 이상이므로 2018년 ボルシンガー는 자격이 있고 2025년 モイネロ는 자격이 없다. 정의서도 이를 확정된 맞교환으로 설명하지 않고 'NPB 규정투구회'라고 잘못 전제한다(docs/metrics/README.md:1307-1314, 정확히는 1309-1314).
- 확신도: 확정 · 분류: 신규 · 찾은 관점: D8

## C. 미검증 — 반증을 돌리지 않은 것 (17건)

⚠찾은 에이전트는 confirmed 로 냈지만 **블라인드 반증을 안 거쳤다**(P2 는 표본 3건씩만, P3 는 배치 규칙상 미검증). 합의나 자기 확인은 확정의 근거가 아니다.

### [P2/D1] `packages/archiver/src/fetcher.ts:159` — C2
**오류 응답 본문을 소비·취소하지 않아 재시도 시 동시 1커넥션 제한이 깨질 수 있다**

- 관측 증상: 첫 번째 429/5xx 응답이 아직 열린 상태에서 backoff 이후 두 번째 HTTP 요청이 시작됨
- 근거: packages/archiver/src/fetcher.ts:155-157(비재시도 오류 즉시 반환)과 :159-162(`await this.backoff(attempt); continue;`) 모두 response body를 소비하거나 취소하지 않는다. 성공 경로 :167 `body: new Uint8Array(await res.arrayBuffer())` 만이 저장소 내 유일한 body 소비 지점(grep으로 확인). 네이티브 fetch는 헤더 수신 후 즉시 반환되므로 첫 응답 본문 전송 중 두 번째 요청이 시작될 수 있다. 저장소 직접 대조 완료.
- 재현조건: 합성 서버가 첫 요청에 429 헤더와 일부 본문만 보내고 연결을 유지, minDelayMs=2000·maxRetries=1로 get 호출. 두 번째 요청(2115ms 후)이 도착했을 때 첫 응답이 여전히 열려 있었다(codex 보고, 재현 1/1).
- 영향: 요청 간격은 지켜도 활성 응답이 겹쳐 L1의 동시 1커넥션 제약을 어길 수 있다. 오류가 반복되면 미정리 응답·연결이 누적될 가능성. 데이터 손실이나 잘못된 값 표시는 아니다.
- 수정안: 재시도하거나 다음 요청으로 넘어가기 전에 오류 응답 본문을 취소(cancel)하거나 끝까지 소비하고 그 완료를 기다린다. 비재시도 오류 반환 경로에도 동일하게 적용.
- 검증법: node:http 서버가 첫 429 응답을 열린 채 유지하며 연결 종료 이벤트를 기록하도록 구성. 다음 요청이 도착하기 전에 첫 응답이 종료/취소됐음을 단언. 비재시도 404 뒤 두 번째 get을 큐에 넣는 경우도 동일 조건 확인.
- 반증(찾은 쪽 자기 시도): 직렬 promise chain과 backoff가 연결 겹침을 막는지 실제 네이티브 fetch로 확인했으나, 2초 이상 대기 후에도 첫 본문이 열려 있어 반증되지 않았다(codex 자체 반증 시도).
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D1+D2c+D7(ext)

### [P2/D2c] `packages/web/src/assets.ts:4303` — C3
**검색 결과 목록을 닫아도(Escape/바깥클릭) 지연 도착한 색인 응답이 목록을 다시 연다**

- 관측 증상: Escape 또는 바깥 클릭 직후 hidden=true였던 결과 목록이, 지연된 색인(players.json) 응답 도착 후 hidden=false로 바뀌어 다시 표시됨
- 근거: packages/web/src/assets.ts:4228 `const close=()=>{list.hidden=true;sayAtOnce("");active=-1};` 는 대기 중인 withIndex 콜백을 무효화하지 않는다. :4303 `withIndex(idx=>{ if(input.value.trim()!==term)return; ... })` 는 입력값이 검색어와 같은지만 검사하고 통과하면 draw()를 호출하며, draw는 :4296 `list.hidden=false;` 로 되돌린다. Escape(:4320)와 바깥 클릭(:4338-4341) 모두 입력값을 바꾸지 않으므로 이 검사를 통과한다. 저장소 직접 대조 완료 — 인용 코드·라인 번호가 HEAD d5c4be7 기준 정확히 일치.
- 재현조건: 실제 CLIENT_JS와 dom-stub.ts로 players.json 응답을 보류한 뒤, 검색어 입력 → Escape 또는 바깥 클릭(닫기) → 응답 해제 순서로 실행. 두 닫기 방식 모두 목록이 다시 열림(재현 2/2). 검색어를 Alpha→Beta로 바꾸는 대조군은 정상적으로 Beta만 표시(1/1).
- 영향: 사용자가 닫은 검색 목록이 다시 나타나고 결과 안내음도 재예약된다. 공유 picker를 쓰는 헤더 검색·「対戦を選ぶ」·「比較」선수 선택 화면 전반에 영향. 데이터 손실이나 잘못된 지표 계산은 아니며, 다시 닫으면 복구된다.
- 수정안: picker별로 열림 의도/요청 세대를 관리하고, close()에서 대기 중인 draw 권한을 무효화한다. withIndex 콜백은 검색어와 함께 해당 세대가 유효한지도 검사한다.
- 검증법: packages/web/test/client.test.ts의 DOM 하네스에서 players.json Promise를 보류. 검색어 입력→Escape 또는 바깥 클릭→Promise 해제→microtask 처리 후 목록이 계속 hidden인지 단언. 실행: node --test --experimental-test-isolation=none packages/web/test/client.test.ts (파일 존재 확인 완료).
- 반증(찾은 쪽 자기 시도): 현재 검색어 비교가 오래된 결과를 버리는 보호는 정상 작동함을 대조군으로 확인했으나, 닫기 동작은 검색어를 바꾸지 않으므로 이 보호가 적용되지 않는다. sayStop도 안내 타이머만 정리해 draw 호출 자체는 막지 못한다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D1+D2c+D7(ext)

### [P2/D2-provenance-ordering (M4/M11)] `packages/store/tools/load-players.ts:126` — C7
**선수 프로필 적재에서 profile_fetched_at 컬럼에 아카이브의 실제 취득시각이 아니라 매 적재 실행 시각(nowIso)이 들어가, 같은 파일의 career_batting/career_pitching이 올바르게 fetchedAt을 쓰는 것과 내부적으로 모순된다.**

- 관측 증상: stmt.run 호출(126행)의 마지막 값 인자가 95행에서 사이드카로부터 읽은 fetchedAt 변수가 아니라 nowIso다. 같은 함수 안 160·166행의 insBat/insPit 호출은 동일 위치 인자로 fetchedAt을 올바르게 전달한다.
- 근거: packages/store/tools/load-players.ts:89-95의 주석은 '취득 시각은 아카이브가 갖고 있다 — 적재 시각(nowIso)과 다르다... 모르면 null 그대로 넣는다. 적재 시각으로 메우지 마라(M11 · 2026-08-17 재검토 P1)... 메우면 재취득 선정이 그것을 가장 신선함으로 읽어 그 선수를 영영 다시 안 받는다'고 명시하고, 95행에서 `const fetchedAt = fetchedAtOf(join(dir, \`${playerId}.meta.json\`));`로 올바르게 사이드카를 읽는다. 그러나 44-48행 UPDATE 문의 `profile_fetched_at = ?`에 대응하는 116-127행 stmt.run 호출의 마지막 인자(126행)는 `nowIso`다. 같은 파일 154-169행(내가 직접 읽음)의 career_batting/career_pitching INSERT(insBat.run/insPit.run, 160·166행)는 동일 위치 인자로 fetchedAt(사이드카 값)을 올바르게 전달해, profile 쪽만 예외적으로 틀렸음을 확인했다. UPDATE에는 incoming 판이 기존 profile_fetched_at보다 새로운지 확인하는 조건도 없다.
- 재현조건: 고정 시각 T1의 meta.json과 유효한 선수 HTML을 임시 아카이브에 두고 T2>T1 시점(clock)에 load-players를 실행하면 `SELECT profile_fetched_at FROM player`가 T1이 아니라 T2를 반환한다. 이어 T3의 새 프로필을 적재한 뒤 내용이 다른 T1 옛 아카이브를 재적재하면 프로필 필드(포지션·투타·배번 등)가 옛 값으로 되돌아가면서도 취득시각은 실행 시각(T3보다도 늦은 재실행 시각)으로 새로 표시된다.
- 영향: 화면·provenance 조회가 오래된 원본을 방금 취득한 것처럼 표시해 '언제 받은 값인가'(M4)에 정확히 답하지 못한다. 옛 아카이브 재적재 시 포지션·투타·배번 같은 프로필 필드도 조용히 역행할 수 있다. 핵심 경기 수치(P1 두 건)보다 영향 범위가 좁고(활동 선수는 후속 재취득으로 완화될 가능성), 잘못된 시각 표시 자체는 매 실행 반복되는 구조적 결함이라 P2로 판정했다.
- 수정안: 116-127행 stmt.run 호출에서 profile_fetched_at 자리에 nowIso 대신 95행에서 읽은 fetchedAt을 전달한다. 동시에 `profile_fetched_at IS NULL OR (incoming IS NOT NULL AND incoming >= profile_fetched_at)`에 준하는 최신판 조건을 적용해 시각을 모르는 판이나 확인된 옛 판이 새 판을 덮지 못하게 한다.
- 검증법: 고정 T1 sidecar를 T2 clock에서 적재해 profile_fetched_at=T1이 되는지 확인하고, 새 판 T3→옛 판 T1 순으로 재적재해 프로필 필드와 시각이 T3에 남는지 단언한다. 반대 순서(T1→T3)에서는 T3가 정상 반영되는지도 확인한다. `node --test packages/store/test/provenance.test.ts`(및 신규 player-profile-provenance 시험)로 결정적 검증이 가능하다.
- 반증(찾은 쪽 자기 시도): fetchedAt이 career 적재에만 의도된 것인지 확인하기 위해 89-95행 주석 전체를 읽었으나, 주석은 명시적으로 '프로필' 화면의 취득일까지 언급하며 nowIso 대입을 정당화하는 문구가 없다. packages/store/test/provenance.test.ts가 이 컬럼을 선수 프로필의 '언제' 근거로 다루는지는 codex의 인용(79-85행)을 신뢰했고 내가 직접 그 테스트 파일을 열람하지는 않았다(경미한 미확인 — 핵심 결함인 89-95행 대 126행의 불일치 자체는 이 테스트 파일과 무관하게 코드만으로 이미 확정적이다). 나 자신이 89-127행과 154-169행을 나란히 읽어 nowIso 대 fetchedAt의 비일관성을 직접 확인했다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D2(ext)

### [P2/D3-M7] `packages/parser/src/career.ts:225` — C8
**If the career (年度別成績) table id is not found, parseCareer returns empty rows without throwing. load-players then deletes the player's career rows, inserts nothing, and exits 0, so a markup change wipes all career tables silently.**

- 관측 증상: After the page ids change, every player page records 年度別成績 0 rows, 0 failures and exit code 0, and the career tables become empty.
- 근거: career.ts:225 `if (table === null) return { rows: [], head: [], foot: null };` — the header, column and footer checks after it (M7 guards) never run when the table itself is missing. load-players.ts:154-158 `db.savepoint(..., () => { const career = parseCareer(html); delBat.run(playerId); delPit.run(playerId); for (... career.batting ...) insBat...` — with an empty result the delete succeeds and the savepoint commits. careerFailed does not increase, so `process.exitCode = failed > 0 || careerFailed > 0 || coverage < ... ? 1 : 0` stays 0. Consumers: web/src/query.ts:2885 and :2901 (career totals and milestones) and :3834-3838 (the player page 通算 block).
- 재현조건: On all 980 archived player pages (data/archive/npb/players), replace id="tablefix_b" / id="tablefix_p" with other names and call parseCareer: 980/980 return batting=[] and pitching=[], 0/980 throw. The same input fed to load-players would delete and not reinsert.
- 영향: When npb.jp renames the table ids, every player's career stats and milestone screens go blank or lose rows with no failure signal, and the daily deploy ships that. The missing batting table is a detectable anomaly (currently 980/980 pages have it). A missing pitching table is legitimate for 466/980 players, so a rename of that id alone would wipe the careers of the 514 pitchers in the sample while looking like a normal page. It recovers after a parser fix and reload, but nothing tells anyone a fix is needed, so Q3 (silent) raises it to P2.
- 수정안: Treat an absent tablefix_b as a CareerParseError (it is present on 100% of pages). For tablefix_p, add a guard in load-players: throw, or quarantine without deleting, for players who have pitching_line rows in the DB but parse with zero pitching rows. Or add a threshold on the ratio of pages yielding career rows, the same pattern as KANA_COVERAGE_MIN.
- 검증법: node <세션 스크래치>/wf/d3/career.ts <repo> → {files:980, both:514, onlyB:466, onlyP:0, none:0, err:0, mutTried:980, mutEmpty:980, mutThrow:0}
- 반증(찾은 쪽 자기 시도): Checked whether the absence can be legitimate: career.test.ts:125 fixes 「표가 없으면 빈 배열이다」 only for the pitching table; the batting table appears on 980/980 pages. Checked for a downstream guard: collection-evidence's career-lag looks only at fetched_at dates and does not see a row count of zero. load-players prints careerBat/careerPit counts but sets no threshold. No catch path was found.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D3

### [P2/D6] `packages/web/src/player-page.ts:994` — W2
**Two places still draw with team colour as a line or glyph colour: the player-page sparkline stroke and the pressed favourite ★. Against the background this falls below 3:1 for 11 of 12 teams in at least one theme, and the element all but disappears.**

- 관측 증상: On a Lotte player page in dark mode, after pressing the favourite button the ★ and its border blend into the background, and the monthly trend line is barely visible.
- 근거: player-page.ts:994 `<polyline ... stroke="var(--team,#6b7280)"` · player-page.ts:996 `<circle ... fill="var(--team,#6b7280)">` · assets.ts:2611 `.favbtn[aria-pressed="true"]{color:var(--team,#6b7280);border-color:var(--team,#6b7280)}` · (the same pattern: assets.ts:2591 `.roster li[data-favon="true"] .hn::before{content:"★";color:var(--team,...)}`). Measured (team colour vs page background, 12 teams): dark Lotte 1.188, Orix 1.169, Chunichi 1.464, Seibu 1.585, Rakuten 1.881, Nippon-Ham 2.604, DeNA 2.75; light Hanshin 1.543, SoftBank 1.574, Yakult 2.607, Giants 2.668. Only Carp is 3:1 or better in both themes (3.07/5.64). After actually pressing the button on players/03305152 (dark): aria-pressed=true, color = border = rgb(34,38,43) on rgb(21,22,26), 1.188 (screenshot fav_dark_lotte.png). Sparkline screenshot: spark_dark_lotte.png. The repo's own principle 「구단색을 선에서 빼고 토큰으로 바꾼다」 ("take team colour out of lines and use tokens"), applied three times at assets.ts:2123–2129 (.tbar i, .mf-shape/.mf-dot, .seasons a[aria-current]), was not applied to these places.
- 재현조건: py -3 probe.py → spark[*][light|dark].spark contrast · probe11.py (Lotte dark after pressing favbtn)
- 영향: The pressed favourite state (1.4.11 state indicator) and the only visual channel of the sparkline trend (the .sl label shows only the range 「6月→7月」) are lost in one of the themes. The sparkline values are available through aria-label and the monthly split table, so no Q3 escalation.
- 수정안: As in the three precedents, take team colour out of lines and glyphs: polyline and circle to var(--tx-2) or var(--tx), .favbtn[aria-pressed] to var(--tx) plus a thicker border or a fill-channel change, and the roster ★ likewise. Keep team colour only in the identity areas (.spine, .block>h2::before).
- 검증법: On the 12 team player pages, compute contrast of getComputedStyle(polyline).stroke and of pressed .favbtn color against the effective background for both themes. Currently 11/12 fail in some theme.
- 반증(찾은 쪽 자기 시도): The sparkline might be decoration that is not required for understanding, but the trend is the content, and the adjacent label gives only the period. The favourite button has aria-label 「お気に入りから外す」, so screen-reader users are fine, but the visual state still fails. The ledger's 「비교 화면 구단 紋 조합 미측정」 ("comparison-screen team crest pairs not measured") is about a different element, so this is not known.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D5+D6

### [P2/D5] `packages/web/src/assets.ts:547` — W3
**The radar axes (.mf-ax, role=button) remove the outline and rely on the dot scaling up and the label darkening to show focus. The selected (.on) axis already has those styles, so focusing it changes nothing. The first Tab stop into the radar is always the selected axis.**

- 관측 증상: After opening the profile panel on a player page and Tabbing into the radar chart, nothing on screen shows which axis has focus.
- 근거: assets.ts:547 `.mf-ax:focus-visible{outline:none}` · :548 `.mf-ax:focus-visible .mf-dot{transform:scale(1.7)}` · :549 label/spoke to --tx · :551–553 `.mf-ax.on .mf-dot{transform:scale(2)}` / `.on .mf-lab{fill:var(--tx);font-weight:bold}` / `.on .mf-spoke{stroke:var(--tx-2)}` (same specificity (0,3,0), later rule wins, so .on overrides focus). Measured (players/01005157, after clicking #markBtn, 3 Tabs lands on axis 0 = pressed=true): the focused and blurred computed values are identical at `['mf-ax on','true','matrix(2, 0, 0, 2, 0, 0)','rgb(23, 23, 26)','700','rgb(93, 93, 89)']`. The screenshots mfax_focus.png and mfax_nofocus.png look the same. Arrow keys (assets.ts:3677–3683) move select() and focus together, so after an arrow move the focused axis is always .on and focus is still not shown separately.
- 재현조건: py -3 probe8.py (<세션 스크래치>/wf/d5d6/)
- 영향: WCAG 2.4.7 Focus Visible fails at the first stop, which every keyboard user passes through, and on every stop reached by arrow keys. Of the 5 axes, the 4 non-selected ones show focus (scale 1.7).
- 수정안: Give focus its own channel separate from .on, for example a focus ring on `.mf-ax:focus-visible .mf-dot{stroke:var(--tx);stroke-width:3}`, or keep the outline on .mf-ax (outline works on SVG g). The spoke rule should also come after the .on rule or have higher specificity.
- 검증법: Record the computed transform/fill/stroke/outline of the pressed=true .mf-ax before and after keyboard focus and check they differ. Currently they are identical.
- 반증(찾은 쪽 자기 시도): The dot scaling up might count as a focus indicator, but on the selected axis .on already has scale(2), which is larger than focus's 1.7, so there is no change at all. The ledger's P2 about the editor not restoring focus (assets.ts:3439) is a different element and a different cause.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D5+D6

### [P2/D6-b 존재하지 않는 곳을 가리킴 / 필터 0건] `packages/web/src/assets.ts:4982` — W6
**헤더 검색은 구단명도 맞추고 「N人中20人を表示 — 選手一覧ですべて見る」로 選手一覧에 보낸다. 그런데 選手一覧의 좁히기는 구단명을 맞추지 않아 같은 질의가 0人이 된다.**

- 관측 증상: 헤더 검색에 「阪神」을 치면 「58人中20人を表示 — 選手一覧ですべて見る」가 나온다. 그 링크를 누르면 選手一覧이 「阪神」이 든 채 「0人を表示中」을 보여 준다.
- 근거: 헤더 검색은 이름·구단·읽는 법·등번호로 맞춘다. assets.ts:4309-4310 `idx.filter(p=>p.n.indexOf(term)>=0||p.t.indexOf(term)>=0 ||(p.kf&&p.kf.indexOf(q)>=0)||p.u===term)`. 넘치면 assets.ts:4290 `a.href=BASE+"players.html?q="+encodeURIComponent(asked)` 로 보낸다. 받는 쪽 assets.ts:4982-4987 은 `li.dataset.name.indexOf(term)>=0 ||(li.dataset.kana&&...)||li.dataset.uniform===term` 만 보고 구단 조건이 없다. 바로 위 주석(4974)은 「헤더 검색과 같은 규칙으로 찾는다」고 적지만 사실이 아니다. 실측(Playwright): 루트에서 ジャイアンツ 62人→0人 · 阪神 58人→0人 · ヤクルト 58人→0人. 2025/ 에서 ジャイアンツ 62→0 · 阪神 57→0 · ヤクルト 62→0. 구단명 질의 6건 중 6건이 0人이다. 대조군: 「田」 81→81 · 2025 87→87 로 일치했다. 0人 화면에는 「조건에 맞는 선수가 없다」 같은 안내가 없다. 텍스트는 「0人を表示中」뿐이다. 화면: players.html?q=%E9%98%AA%E7%A5%9E (390×844 에서도 같다).
- 재현조건: http://127.0.0.1:4173/index.html → 헤더 검색칸에 「阪神」 입력 → 목록 맨 끝 「58人中20人を表示 — 選手一覧ですべて見る」 클릭 → #rosterCount 가 「0人」이 되고 .teamgroup li 가 전부 hidden 이다.
- 영향: 가장 많이 쓰는 조작(§0-1 의 3클릭 주 경로)이 「전부 보여 주겠다」고 약속한 뒤 0명을 보여 준다. 사용자는 그 구단 선수가 목록에 없다고 읽는다. 같은 화면 위에 구단 칩(阪神)이 있는데도 같은 글자를 좁히기 칸에 넣으면 0이 된다. 틀린 값이 조용히 나가는 것은 아니고 약속이 깨지는 결함이라 P2 로 둔다.
- 수정안: 選手一覧 좁히기에 헤더 검색과 같은 구단 조건을 넣는다(li 에 구단명 data 속성을 두고 매칭). 더 나은 쪽은 두 곳이 같은 판정 함수를 부르게 하는 것이다(M1 — 주석이 이미 그것을 약속한다). 그리고 0건일 때 「条件に合う選手はいません」과 해제 수단을 보인다.
- 검증법: Playwright 로 헤더 검색 → 「すべて見る」 링크를 따라간 뒤 #rosterCount 와 보이는 li 수를 읽는다. 결정적이다(정적 dist · 같은 입력이면 같은 출력).
- 반증(찾은 쪽 자기 시도): 「選手一覧의 ?q= 는 이름 전용이고 헤더 검색이 과하다」로 죽여 보려 했다. 하지만 링크 문구가 「すべて見る」라고 약속하고 코드 주석(4974)도 같은 규칙을 약속하므로 불일치 자체가 결함이다. 「JS 가 없으면 전원이 보이니 참」(4288 주석)이라는 반론도 봤다. JS 가 살아 있을 때 오히려 0이 되므로 성립하지 않는다. 원장 known/accepted 35건에 같은 항목은 없다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D6-b

### [P2/D6-b 빈 상태 오표시 / URL 상태 복원] `packages/web/src/assets.ts:3888` — W7
**対戦を選ぶ → 선수 페이지 ?vs= 착지가 今季 대전 표만 좁힌다. 과거 시즌에만 대전이 있거나 투수끼리를 고른 경우, 좁히기 칸에 원시 선수 ID 를 넣고 「この条件の対戦記録はありません。」만 보인다. 通算 표에 그 대전이 있어도 안내하지 않는다.**

- 관측 증상: matchup.html 에서 投手 大津 · 打者 鈴木叶 를 고르고 이동하면, 대전 표 좁히기 칸에 「01305157」이 들어 있다. 표는 0件이고 「この条件の対戦記録はありません。」이 나온다.
- 근거: assets.ts:3888 `if(id==="matchup"&&finder){` — 못 박기는 data-stable="matchup"(今季)에만 걸리고 "matchupCareer" 에는 안 걸린다. assets.ts:3902-3903: ID 로 걸리는 행이 없으면 `finder.value=vs;` 로 ID 문자열을 이름 좁히기에 넣는다. 그래서 name.indexOf("01305157") 가 0건이 된다. 도착점은 assets.ts:4395 `go(BASE+"players/"+chosen.batter.i+".html?vs="+...+"#b-matchup")`. 실측(Playwright · 1440×1000): players/01005159.html?vs=01305157 → matchup: filter='01305157' · visibleRows 0 · empty 표시. matchupCareer: 64행 · 좁히기 없음 · 숨은 탭(今季 탭 aria-selected=true). 투수 2명(E.ラミレス→アドゥワ · 390×844)을 골라도 이동 버튼이 활성이고, 착지 결과가 filter='73975150' · 같은 빈 문구다. 역할 불일치 안내가 없다(비교 화면은 assets.ts:4565 에서 이 경우를 안내한다). 규모: 현 시즌 타자 페이지 339장 중 290장에, 현 색인에 있는 투수이면서 通算에만 대전이 있는 상대가 1명 이상 있다(dist 정적 HTML 대조).
- 재현조건: http://127.0.0.1:4173/matchup.html → 投手 칸에 「大津」 → 목록에서 players/01305157 선택 → 打者 칸에 「鈴木叶」 → players/01005159 선택 → 「対戦成績を見る」(#pickGo) → [data-stable=matchup] [data-stable-filter] 값과 [data-stable-empty] 상태를 읽는다. 또는 URL 을 바로 연다: players/01005159.html?vs=01305157#b-matchup
- 영향: 두 선수가 실제로 대전했는데(通算 표에 행이 있다) 화면은 「대전 기록 없음」과 알아볼 수 없는 숫자만 보여 준다. 사용자는 대전이 없었다고 읽고 떠난다. §2-2 는 통산 대전 표를 「今季에 원리적으로 없는 행이 생긴다」는 이유로 붙였는데, 바로 그 행으로 가는 입구가 今季에서 끊긴다. 투수끼리는 원리적으로 대전이 없다는 사실도 말하지 않는다.
- 수정안: ?vs= 처리를 matchupCareer 에도 적용한다. 今季에 행이 없고 通算에 있으면 通算 탭을 연다(저장하지 않는 일시 전환). ID 로 못 찾으면 좁히기 칸에 ID 를 넣지 말고, 이름으로 「今季は対戦なし（通算 N打席）」 또는 「対戦記録なし」를 말한다. matchup.html 은 두 선수의 역할이 같으면 이동 전에 비교 화면처럼 안내한다.
- 검증법: Playwright 로 matchup.html 을 조작한 뒤 착지 페이지의 [data-stable=matchup]·[data-stable=matchupCareer] 의 좁히기 값·보이는 행 수·빈 상태 표시와 今季/通算 탭의 aria-selected 를 읽는다. 결정적이다. 규모 290/339 는 dist/players/*.html 의 data-oppid 집합 차이로 셌다.
- 반증(찾은 쪽 자기 시도): 「빈 문구가 『この条件の』라서 今季 조건에 대해서는 참이다」로 죽여 보려 했다. 그러나 좁히기 칸에 사람이 읽을 수 없는 ID 가 들어가는 것은 어느 해석으로도 정상이 아니다. 通算 행이 같은 페이지에 존재한다는 것도 실측했다. 「옛 이름 링크 호환을 위해 이름으로 흘린다」(3881 주석)는 설계 의도도 확인했다. 하지만 ID 로 들어온 경우까지 그 갈래로 떨어지는 것은 의도 밖이다(주석은 ID 로 걸리는 행이 없을 때 = 옛 이름 링크를 상정한다). 원장 known/accepted 에 없다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D6-b

### [P3/D3-M7] `packages/store/src/derive.ts:187` — C9
**Box rows whose player link cannot be read (playerId null) are dropped by deriveBatting and derivePitching without quarantine or any count. Pitchers have no cross-check at all, so a missing pitcher line would not be noticed.**

- 관측 증상: A pitcher row without a link leaves no pitching_line row, adds no quarantine row, and the load exits 0.
- 근거: derive.ts:120 `if (row.playerId === null) return null;` (batting) and derive.ts:187 the same (pitching). In load-archive.ts the handling is only `if (derived === null) continue;`. For batters, align.ts cross-checks against PBP and can raise a paMismatch quarantine. Pitchers have no such path, and stealMismatch and the other checks also skip null IDs.
- 재현조건: In a played box HTML, remove the /bis/players/ link from one pitcher row and load it. The team's pitching_line total drops by that pitcher's outs, hits and earned runs, and the quarantine table stays at 0 rows.
- 영향: Latent. Current value is 0 (null ID: 0/211,862 batter rows, 0/63,315 pitcher rows). If a link format change partly hits pitcher rows, team IP and ERA and the pitcher's season stats go down without any signal. A full link change is caught indirectly because the PBP parser throws on 0 plate appearances.
- 수정안: Push rows that are not team totals, have a name and have a null playerId into quarantine (a new kind such as unlinkedPlayer), and add the matching line to the log-page text table. Optionally compare the sum of pitching_line outs with the 3 x innings from the line score.
- 검증법: node <세션 스크래치>/wf/d3/nullid.ts <repo> → batNull:0/211862, pitNull:0/63315 (current value). The code path is confirmed by reading derive.ts:187 and load-archive.ts at `if (derived === null) continue;`.
- 반증(찾은 쪽 자기 시도): Checked whether the batter side is covered by align's 「경과에는 있으나 박스에 없는 타자」 quarantine: it is (when PBP has that ID). The pitcher side has no counterpart. Measured occurrence is 0, so the finding stays latent at P3.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D3

### [P3/D3-boundary] `scripts/date-window.ts:103` — C10
**The catch-up window starts the day after MAX(played game_date). A day partly collected by the 23:30 JST run (finished games saved, games still in progress skipped) is never automatically re-fetched if the next successful run is two or more days later.**

- 관측 증상: Days collected (since): 2026-09-10. A run at 07:00 JST on 09-12 targets only ['2026-09-11'] and does not include 09-10.
- 근거: scripts/update.ts:130 `SELECT MAX(game_date) AS d FROM game WHERE status = 'played'` → date-window.ts:102-103 `if (since !== undefined && daysBetween(since, yesterday) >= 2 ...) for (let d = nextDay(since); d < yesterday; ...)`. The cron `30 14 * * *` (23:30 JST) runs with includeToday, so finished games on day D are stored and D becomes MAX, while load-archive.ts skips inProgress games with `continue`.
- 재현조건: node -e: targetDates(new Date('2026-09-11T22:00:00Z'), {collectedThrough:'2026-09-10'}) → ['2026-09-11']; targetDates(new Date('2026-09-12T22:00:00Z'), {collectedThrough:'2026-09-10'}) → ['2026-09-11','2026-09-12'].
- 영향: This happens after the 23:30 run if every run the next day fails (for example the 2026-08-31 Actions outage). An extra-inning or late game that was in progress on D stays uncollected. The 09-11 design's collection verdict A (schedule_played scores link without a game row) catches it after the 2-day grace, so it is detected, but only a manual `--date D` recovers it.
- 수정안: Start the catch-up one day earlier (from `since` itself), or compute collectedThrough as the last day on which every card in schedule_played is present in game. Keep the "0 extra requests on normal days" test.
- 검증법: The node --input-type=module run of targetDates shown in repro (actually executed, output confirmed).
- 반증(찾은 쪽 자기 시도): Checked for silence: verdict A (collection-evidence.ts:48-55) flags the missing game, so this is not silent and does not rise above P3. Checked the case where the next run comes the next day (D+1): yesterday = D, so D is re-fetched with no problem. The gap exists only for runs at D+2 or later.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D3

### [P3/D3-green-test] `packages/store/src/derive.ts:158` — C11
**deriveBatting's paMismatch guard (`accounted > out.pa`) can never fire, by construction, yet its comment says it catches missing classification rules.**

- 관측 증상: paMismatch from deriveBatting is always 0 rows regardless of input (only align.ts's separate paMismatch is ever recorded).
- 근거: derive.ts:156-158 comment `// 타석 = 타수 + 사사구 + 희생 + 타격방해. 어긋나면 분류 규칙이 빠진 것이다.` followed by `const accounted = out.ab + out.bb + out.hbp + out.sf + out.sh; if (accounted > out.pa)`. fold.ts: pa += count for every PA, while the outcomes where countsAsAtBat is true and the walk/HBP/sac-fly/sac-bunt outcomes are mutually exclusive (tokens.ts:217-247), so accounted <= pa always holds. A missing rule yields `unknown` (not an AB), which moves in the accounted < pa direction.
- 재현조건: For every Outcome, foldOutcomes([{outcome,count:1,rbi:0}]) gives ab+bb+hbp+sf+sh <= 1 = pa, so no input sequence produces accounted > pa.
- 영향: No wrong numbers now, because the real protection comes from unknownToken plus abMismatch and hitMismatch. The comment claims detection this guard cannot provide, which creates a false belief that PA consistency is being checked.
- 수정안: Remove the guard, or fix the comment to say that detection is handled by unknownToken and abMismatch.
- 검증법: Read fold.ts and tokens.ts countsAsAtBat and confirm the case split (every Outcome is either counted in ab or in exactly one of bb/hbp/sf/sh, never both).
- 반증(찾은 쪽 자기 시도): Checked whether ibb double-counting could make accounted exceed pa: intentionalWalk increases only bb (ibb is not added to accounted), so no.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D3

### [P3/D8② 분모 정의(ゴロアウト率)] `packages/aggregate/src/batted-ball.ts:150` — C13
**「ゴロアウト率」의 분모는 화면이 「アウトだけ」라고 하는데, 실책 출루(reachedOnError)와 야수선택 타석도 ゴロ/フライ 아웃으로 센다. 그래서 분자와 분모에 아웃이 아닌 타석이 섞인다.**

- 관측 증상: 2025 정규 규정 표시 대상(아웃 100 이상) 120명 중 112명의 ゴロアウト率 표시값(소수 3자리)이 「실제 아웃만」 기준 값과 다르다. 최대 차는 .028이다.
- 근거: batted-ball.ts:147-151 `if (!isHit) { if (f.trajectory === "ground") e.groundOuts += 1; else if (… fly|liner|foulFly) e.airOuts += 1; }`. 안타가 아니면 전부 아웃으로 본다. 화면 player-page.ts:1483 `statRate(GROUND_LABEL, { value: d.groundOuts / outs, denominator: outs }, "アウト", 3)` 이고, 각주 1503 은「**ゴロアウト率の分母はアウトだけ**です」라고 한다. 정본: docs/metrics/README.md §1 표의 ROE 행 — 결과 셀의 `失` 계열은 **실책 출루**(출루로 계산해 打数·出塁에 쓴다)라서 아웃이 아니다. 실측(gb.ts · 2025 정규 · 비안타 인플레이): ground 중 fieldedOut 13,845 · 併殺打 1,046 · **reachedOnError 474 · fieldersChoice 26**, fly 중 reachedOnError 31, liner 중 reachedOnError 1.
- 재현조건: node <세션 스크래치>/wf/d8/gb.ts — readPbp 로 trajectory 를 다시 읽어 outcome 별로 집계하고, reachedOnError·fieldersChoice 를 뺀 값과 표시 반올림 값을 선수별로 비교한다(선수 키는 playerId 만이라 이적 선수는 합산된다).
- 영향: 조용히 틀린 값이지만 크기가 작고, 다음 빌드에서 고친 정의로 저절로 복구된다(Q2 강등). 실책은 땅볼에 몰리므로 한 방향으로 치우친다(ゴロ 쪽으로 부풂). 투수 쪽(SQL_PITCHER)도 같은 코드라 같은 치우침이 있다.
- 수정안: 수정하지 않았다. outcome 이 reachedOnError·fieldersChoice(와 sacBunt 계열)인 타석을 ground/air 집계에서 빼거나, 아니면 라벨·각주를 「ゴロ率(安打を除く打球)」처럼 실제로 세는 것에 맞춘다.
- 검증법: 고친 뒤 gb.ts 로 v1 과 v2 가 같아지는지 확인한다(표시가 다른 선수 0/120). 시험은 픽스처 한 경기에 `三ゴ失` 타석을 넣어 groundOuts 가 늘지 않는지 고정하고, 고치기 전 코드에서 실패하는지 확인한다.
- 반증(찾은 쪽 자기 시도): 반증 시도: 야수선택은 주자가 아웃되므로 「아웃이 일어난 타구」로 볼 여지가 있어 26건은 논쟁 가능하다. 그러나 reachedOnError 506건은 누구도 아웃되지 않은 타석이다(정의서 §1 ROE). 또 표시 반올림을 보면 영향 인원이 다수여서 「무시할 크기」라는 반론도 표시값 수준에서는 성립하지 않는다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D8

### [P3/D8 표시 문구(도메인 설명)] `packages/web/src/player-page.ts:2294` — C14
**打順一巡 블록 각주의 일본어 문장 한가운데에 영어 낱말 「good」이 섞여 그대로 배포된다.**

- 관측 증상: 투수 선수 페이지 「打順一巡」 각주에 「3巡目まで投げる投手はその日good投球をしている投手なので」라고 나온다.
- 근거: player-page.ts:2294 `"⚠**「3巡目は打たれる」と読まないでください。** 3巡目まで投げる投手はその日good投球をしている" +`. 정본 docs/metrics/README.md §3.4-A 는 같은 생존자 편향을 「그날 잘 던진 투수」로 서술한다(일본어 화면 문구의 번역 누락).
- 재현조건: grep -n "good投球" packages/web/src/player-page.ts → 1행 매치. 빌드 후에는 dist/players/*.html 에서 같은 문자열로 grep 한다(이번에는 dist 를 재지 않았다).
- 영향: 값은 틀리지 않았다. 도메인 경고 문장이 비문이 되어 설명의 신뢰도가 떨어지는 문구 결함이다(루트 §2 UI 언어는 일본어).
- 수정안: 수정하지 않았다. 「好投」 등 일본어로 바꾼다.
- 검증법: grep 으로 good投球 가 0건인지 확인하고, 빌드한 dist 에서도 0건인지 본다.
- 반증(찾은 쪽 자기 시도): 의도한 표기인지 확인하려고 같은 파일에서 영어가 섞인 다른 일본어 문장을 찾았으나 없었다. 이 한 곳만 섞여 있다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D8

### [P3/D5] `packages/web/src/assets.ts:2179` — W5
**When the win/loss/save pitcher links (.gdec .gd a, about 24×18.6px) wrap onto two lines, the vertical gap between them is only var(--s2). The centre distance between adjacent undersized targets is 22.8–23.6px, which fails the 2.5.8 spacing exemption (24px).**

- 관측 증상: In the win/loss/save pitcher names on a game card, the links on the upper and lower lines are closer than 24px.
- 근거: assets.ts:2179 `.gdec{...flex-wrap:wrap;gap:var(--s2) var(--s5);font-size:var(--fs-sub)}` · today-page.ts:241 / game-page.ts:291 `<p class="gdec">`. Measured at 1440: on today, 6 of 77 targets (有原↔来田 22.8, 正木↔山本祐 23.6, 長岡↔筒香 22.8); on days/2026-08-15, 17 of 85 targets (水野↔野村 22.8, etc.). The other 17 units have 0 at 1440.
- 재현조건: py -3 probe9.py (<세션 스크래치>/wf/d5d6/)
- 영향: Mis-taps on the pitcher names when tapping by touch or with a pointer. The margin is under 1.2px and the impact is minor.
- 수정안: Make the vertical gap of .gdec at least var(--s3), or give .gd a a vertical padding that makes the line height 24px or more.
- 검증법: Centre distance between adjacent .gd a in today and days/<date> should be 24 or more.
- 반증(찾은 쪽 자기 시도): Checked whether the inline-in-sentence exemption applies: each .gd is a label + link inside a flex item, not inline in a sentence. The ledger's known 23.8px season link is a different element.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D5+D6

### [P3/D6-b URL 상태 복원 / 침묵 실패] `packages/web/src/assets.ts:4724` — W8
**比較 화면의 공유 URL(?a=&b=) 복원이 두 사람 중 하나라도 현 색인에 없거나 색인을 못 받으면 아무 말 없이 둘 다 버리고 「未選択」 빈 화면이 된다.**

- 관측 증상: compare.html?a=43345155&b=23925150 을 열면 A·B 가 둘 다 「未選択」이고 결과 영역이 비어 있다. 안내 문구도 없다.
- 근거: assets.ts:4719-4729: `withIndex(idx=>{ if(!idx)return; ... const pa=find(ia),pb=find(ib); if(!pa||!pb)return; ...})` — 색인 실패도, 한쪽 미발견도 조용히 반환한다. 유효한 A 까지 버린다. 실측(Playwright): 유효 쌍 → 정상 복원. b=99999999 → A·B 둘 다 未選択 · #cmpOut 빈 문자열. b=2025 색인에만 있는 선수(2026 색인에는 없음) → 루트·2025/compare 모두 같은 빈 상태. 규모: 2025 색인 721명 중 160명이 2026 색인에 없다. 시즌이 바뀌면 그만큼의 공유 링크가 이 상태가 된다.
- 재현조건: http://127.0.0.1:4173/compare.html?a=43345155&b=99999999 → #cmp-a-chosen · #cmp-b-chosen 텍스트와 #cmpOut innerText 를 읽는다.
- 영향: 공유받은 사람은 링크가 고장났는지, 그 선수가 없는지, 아직 읽는 중인지 구별하지 못한다. 틀린 값이 나가지는 않으므로(Q3 아님) P3 이다.
- 수정안: 찾은 쪽은 복원한다. 못 찾은 쪽은 「共有リンクの選手（ID …）はこのシーズンの一覧にいません」을, 색인 실패는 기존 실패 문구를 #cmpOut 에 낸다.
- 검증법: Playwright 로 5가지 URL(유효 쌍 · 없는 ID · 전 시즌 전용 선수 · 2025 화면 · 한쪽만)을 열고 선택 라벨과 결과 영역 텍스트를 읽는다.
- 반증(찾은 쪽 자기 시도): 「한쪽만 있으면 비교가 성립하지 않으니 비우는 게 맞다」는 반론을 검토했다. 비교가 안 되는 것은 맞지만, 말없이 비우는 것은 D6-b(없음과 못 읽음을 섞지 않는다)에 어긋난다. 같은 화면이 샤드 실패·카드 없음은 문구로 구별하면서(4692-4695) 이 경로만 빠져 있다. 원장에 없다.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D6-b

### [P3/D6-c] `packages/web/src/assets.ts:2860` — W10
**Under reduced motion, `*,*::before,*::after{transition-duration:var(--t1)!important}` gives a 1 ms duration to every element whose transition-property is still the initial value all, which effectively creates transition:all. Under that setting, layout properties such as max-width also transition, outside the guard in transitions.test.ts.**

- 관측 증상: With prefers-reduced-motion: reduce, clicking the ranking page's 個人 tab creates 138 max-width transitions; with no-preference it creates 0.
- 근거: assets.ts:2860 `*,*::before,*::after{animation-duration:var(--t1)!important;animation-delay:var(--t-stagger)!important;transition-duration:var(--t1)!important}`. The initial value of transition-property is all, so the site-wide transition:all ban (transitions.test.ts:74, the reason given at 4-8, 「앞으로 더할 속성까지 조용히 따라간다」) applies in reverse in reduce mode. The test regex only captures the `transition:` shorthand (transitions.test.ts:41 `(?:^|;)\s*transition:\s*`), so this `transition-duration` longhand is invisible to it. Measured (1440, all 19 units): elements with a nonzero transition-duration went from 4,920 to 42,841 on ranking, 1,007 to 9,402 on players, and 710 to 5,725 on players/01005157, i.e. every element on the page. After the tab click, the animation list is 18 in no-preference and 156 in reduce (max-width 138); on players/01005157 it is 61 vs 82 (max-width 21). Meanwhile no CSS motion avoids the tokens: `grep -o "(transition|animation)[a-z-]*:[^;}]*" dist/assets/site.css | grep -v "var(--t"` returns 0 lines, so the ⑴ token path (--t1..--t3:1ms) already covers every transition and animation that exists today.
- 재현조건: Chromium with reduced_motion='reduce' → ranking.html → click `[data-tabgroup="ranktype"] [data-tab="personal"]` → count document.getAnimations() by transitionProperty (<세션 스크래치>/wf/d4/rm_click.py · motion.py)
- 영향: At 1 ms there is no visible motion. Click cost did not differ measurably either: ranking sync 453–614 vs 461–701 ms across 3 runs each. What exists today is a contradiction with the stated rule, and a blind spot the test cannot see. It is not user harm, so P3.
- 수정안: Drop transition-duration from ⑵. Every current transition goes through a token, so ⑴ is enough; if a safety net is still wanted, use `transition-delay:0s!important`. Alternatively, extend transitions.test.ts to also catch `transition-duration`/`transition-property` longhands on the universal selector (*).
- 검증법: After the fix, with reduced_motion=reduce, the 個人 click on ranking should create 0 max-width transitions, and the maximum transition/animation duration should stay 1 ms (motion.py prints maxTransitionMs=1 and maxAnimDur=1 on all 19 screens).
- 반증(찾은 쪽 자기 시도): Checked for perceptible motion or cost: duration is 1 ms and no click-cost difference was measured, which is why this is P3. Checked whether the reduced-motion guarantee itself is broken: it is not. Under reduce, the maximum animation and transition duration was 1 ms on 19/19 screens, and the view-transition is none (pagereveal viewTransition=null). Infinite animations: 0/38.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 신규 · 찾은 관점: D4+D6-c

### [P3/D4] `packages/web/src/pages.ts:12` — W11
**The ranking-weight deferral (accepted) still cites 「822KB · DOM 25,851요소」, but the page is now 1,446,688 B and 42,841 elements (+66%). The premise that deferring is justified (the §0-1 no-script requirement) still holds, but the cost figures are stale.**

- 관측 증상: The measured values in the pages.ts comment differ from the current ranking.html: 25,851 elements documented vs 42,841 measured.
- 근거: pages.ts:14-15 `실측(2026-08-18): \`ranking.html\` 이 **822KB · DOM 25,851요소**` · pages.ts:22 `**그래도 지금 고치지 않는다.**` (deferral decision). Measured 2026-09-25 (preview): ranking.html decodedBodySize 1,446,688 B · document.getElementsByTagName('*') 42,841 · CDP Nodes 99,819 · scrollers 95 · until-found panels 93. Even with display:none (without the extra cost of finding 1), ranking 390 at x4 has load TBT 2,491–3,150 ms and a maximum long task of 925–1,195 ms. With JS off at x4, layout is 4,129 ms and total task time 8,825 ms. Past seasons are the same size (2019/ranking.html 1,465,558 B).
- 재현조건: Run <세션 스크래치>/wf/d4/measure.py (all 19 units) and throttle_load.py ranking
- 영향: The weight basis of the decision recorded in the document has grown 66%, and the next person will judge from the old figures. The trade-off itself (no-JS reachability, §0-1) is still valid, so no change is required.
- 수정안: Update the figures in the pages.ts comment and note that they grow over time (or have doc-figures pin them). Before deciding whether to lift the deferral, fix finding 1 first: it cuts TBT about 3x without changing the DOM.
- 검증법: Compare the pages.ts comment with the measure.py ranking line (nodes/decoded).
- 반증(찾은 쪽 자기 시도): Checked whether this is resolved on the ledger: the ledger's 「1MB HTML 크기만으로 성능 결함 단정 → 반증됨」 is about a claim made without measurement. This item is about stale figures inside an accepted comment, a different point. Checked whether the premise is still true: the no-JS path still shows every panel through the noscript style (`[data-panelgroup][hidden]{display:block!important}`), so the reason for deferring still stands. Classified as accepted.
- 반증(블라인드): 블라인드 반증 대상 밖(P2 표본 추출 밖 또는 P3) — 찾은 에이전트의 자기 반증만 있다
- 확신도: 미검증 · 분류: 판단済 · 찾은 관점: D4+D6-c

## D. 반증됨 (0건)

없음 — 반증 대상 8건(코드군 5 · 화면군 3) 중 죽은 것 0건.

## 7. 재지 못한 범위 (⚠「0건」이 아니라 「안 쟀음」)

| 영역 | 안 잰 것 |
|---|---|
| 대비 | **픽셀 대비 13/19 화면**(도구 ERROR) · 숨은 탭 패널·접힌 블록·툴팁·검색 결과 상태의 대비 · `.dia`·`.track`·`.tbar` 등 SVG/막대 그래픽 대비 |
| 접근성 | 실제 Windows 고대비(에뮬레이션만) · 스크린리더 낭독 · Firefox·Safari · 키보드 순회는 화면당 45정지까지 |
| 과거 시즌 | 19단위 중 과거 시즌은 `2025/postseason`·`2017/draft` 둘뿐. **2018~2024 화면 전반은 범위 밖** |
| D3 | `parser/{draft,draft-wiki,upcoming,player,pbp}.ts` · `store/src/{draft,draft-wiki,load,db,meta}.ts` · `load-archive`·`load-players`·`load-upcoming` 밖의 적재 도구 · 아카이버의 discover/players/starters/draft · 서스펜디드(아카이브에 0건이라 검증 불가) · 2016~2017 구형 경로(아카이브가 2018~) |
| D8 | aggregate 의 `count·draw·relief·race·streaks 본문·run-expectancy·situational(SRC/SRP)·woba-weights 유도·bunt·gidp·game·day` 와 정의서의 코드 대조 · `query.ts` 7,456행 중 일부 구간만 · 부동소수 동률 · 자정 넘긴 경기의 경기일 · **NPB 표창 규정 원문**(C12 의 전제) |
| D4 | **빌드 메모리**(`build.ts:93` 전 시즌 선적재 — 실행 금지라 안 쟀다) · 다크 테마 성능 · 실기기 · 교차 문서 View Transition 실발동 · 정렬 비용은 `teams/g` 만 |
| D6-b | 느린 색인 응답의 「読み込み中…」 상태 · 순위 「順位をもっと見る」 실패 경로 · JS 없는 상태 · 오프시즌·수집 실패 띠의 실물(로컬 DB 가 낡아 늘 「まで反映」) · 즐겨찾기·IME 입력 |
| D1 | 배포된 실제 응답 헤더·Cloudflare 정책 · 실제 npb.jp 의 리디렉션 발생률(C1 은 로컬 합성 서버 재현) · `access-config.ts` 가 대조하는 허용목록 자체 |
| D7 | 외부 모델이 「신규 0건」을 보고했다. 범위는 2026-09-11 이후 관련 커밋 25개와 `CLAUDE.md`·`deploy.md`·`metrics/README.md` — **중개자가 재열람해 반증하지는 않았다** |
| 반증 | P2 14건 중 표본 6건만 · P3 9건 전부 반증 안 함 |
| 원장 | 경로:행 내용 직접 대조 11/93 · 미확인 16건(실기기·외부 관측) |

## 8. 이 라운드에서 드러난 운영 관찰 (결함 목록과 별개)

- **대비 도구가 이 프로젝트 화면 13/19 에서 돌지 못한다**(§5). 다음 감사 전에 공통 도구 쪽 원인 조사가 필요하다 — 별도 작업(`_common/`).
- **병렬 에이전트가 같은 스크래치 파일명(`brief.txt`)을 덮어썼다**(외부 D2 중개자가 목격하고 고유 이름으로 피했다). 다음 워크플로는 에이전트마다 고유 스크래치 하위 폴더를 배정한다.
- 인계 메모의 「로컬 DB 09-11 적재본」은 파일 시각이었고 **데이터는 08-16 까지**였다 — 신선도 관련 화면(띠·予告先発)은 이 라운드에서 판정할 수 없었다.
- 오프시즌 판정 단계 B(12월 첫 실행 전)·C(1월 전)는 이 감사의 범위가 아니다(인계 메모 §2).

## 9. 고칠 순서 제안

1. **C5 · C6**(P1 · 수집·적재 멱등성과 정정 순서) — 조용히 과거 값으로 되돌아가거나 섞인 DB 가 된다. 운영 수집기가 매일 돌므로 먼저.
2. **C1**(리디렉션이 L1 간격 우회) — 권리·예의 문제라 크기에 비해 무겁다(§2-5 L1·M8).
3. **C12** — 먼저 NPB 표창 규정 원문을 1차 출처로 확인(`shiro-core:factcheck-frame`). 맞으면 자격을 승수로, 아니면 이름을 바꾼다.
4. 화면: **W1**(탭 선택이 색에만 의존) · **W4**(드래프트 시즌 띠가 로드 때 밀림) · **W9**(숨은 패널 레이아웃 강제) · **C4**(비교 URL 복원이 사용자 선택을 덮어씀).
5. 미검증 17건은 고치기 전에 반증부터(특히 C8 경력 표 마크업 변경 시 통째 삭제 · W6 검색→선수 목록 0명 · W7 대전 착지).

⚠이 목록의 수정을 배포할 때는 루트 §4 배포 게이트(3중 검토)가 그대로 산다 — 감사한 것은 고치기 전 코드다.

