# 옛 판이 새 판을 덮지 못하게 — 경기 적재의 판 가드와 경기 페이지 세트 기록

- 날짜: 2026-09-25
- 출처: 다방면 감사 `docs/audits/2026-09-25-multi-dimensional.md` 의 **C5**(P1)·**C6**(P1) — 둘 다 외부 블라인드 반증을 견뎠다
- 결정(사용자 · 2026-09-25): 접근 A · 옛 판을 감지하면 **실패로 끝내 배포를 막는다** · 재수집 입력 포함
- 고위험 영역: 멱등성(M5) · 정정 순서(M4/M9) · 데이터 계약 → 배포 전 `shiro-core:triple-review`(루트 §4)
- 콜드 리뷰: 2회 반영(부록 A·B) · 최종 가지 검토 반영(부록 C · 2026-09-26 — ⚠G3a 를 고쳤다) · 3중 검토 반영(부록 D · 2026-09-26 — ⚠본 시각을 **받은 시각**으로 · 적재기는 스냅샷에서 판을 읽는다)

## 0. 한 줄 요약

적재기는 **아카이브가 DB 보다 옛 판인 경기를 통째로 건너뛰고 실패로 끝내고**, 아카이버는 **경기 페이지 4장을 다 받았을 때만 한꺼번에 기록**하며
그 세트를 사이드카에 표시해 적재기가 대조한다(본문 sha 도 대조한다). 옛 판이 감지되면 사람이 **그 날짜만 다시 받는** 수동 실행 입력으로 푼다.

## 1. 문제 — 실측

### 1-1. C5 · 경기 행은 판을 비교하지 않는다

- `packages/store/src/load.ts:215-276` `upsertGame` 은 `ON CONFLICT DO UPDATE` 로 **판을 비교하지 않고** 덮는다.
  덮는 열: 팀 코드 둘 · `status` · `not_played_reason` · `competition` · `series` · `source_url` · `fetched_at` · R·H·E 여섯 · `venue`
  (`season`·`game_date`·`game_no` 는 키가 결정하므로 일부러 안 덮는다 · 208-212행).
  `revision` 은 그중 **`series`·`source_url`·`fetched_at` 을 뺀** 열이 달라질 때만 +1 이다(245-265행).
  같은 파일의 `upsertProbablePitcher`(176-203)는 `WHERE probable_pitcher.fetched_at IS NULL OR (excluded.fetched_at IS NOT NULL AND excluded.fetched_at > probable_pitcher.fetched_at)` 로
  **더 새 판만 이기게** 한다(기존 행의 시각이 NULL 이면 새 값이 이긴다 · 새 값이 NULL 이면 덮지 않는다).
- `game.fetched_at` 에 들어가는 값은 **`fetchedAtOf(box.meta.json)`** 이다(`load-archive.ts:271`). 그 함수(`packages/store/src/meta.ts:46-72`)는
  `normalizeFetchedAt(checkedAt) ?? normalizeFetchedAt(fetchedAt)` — 즉 **「그 내용을 마지막으로 확인한 시각」을 UTC `toISOString` 모양으로** 돌려준다.
  `normalizeFetchedAt`(`meta.ts:37-45`)은 시간대 표기가 없는 값·무효 날짜를 `null` 로 거른다. `packages/store/test/game-fetched-at.test.ts` 가 DB 값과 사이드카를 1:1 로 대조한다.
- 경기에 판 가드가 없는 것은 **결정이었다** — `packages/store/tools/load-archive.ts:262-270`:
  ① 경기당 `box.html.gz` 가 하나라 한 실행 안의 경합이 없다 ② **옛 아카이브로 되돌아가는 경우는 `archive-guard` 가 앞에서 막는다**.
- ⚠**전제 ②가 부분적으로 거짓이다.** `scripts/archive-guard.ts` 는 **`.gz` 파일 수 감소**와 **바이트 감소(0.5% 또는 1MiB 중 큰 것 초과)**만 본다.
  파일 수가 같은 채 일부 경기의 페이지만 옛 판이 되면 **통과한다.** 그런 경로가 둘 있다:
  1. **CI 업로드 부분 실패** — `.github/workflows/daily.yml` 「보관소에 올림」은 세대 `store-YYYYMMDD.tar` 와 `bb.sqlite.gz` 를 `--clobber` 로 올린다.
     `--clobber` 는 **기존 자산을 지운 뒤** 올리므로(워크플로 주석이 `gh` 원문을 인용한다) 오늘 세대 업로드가 실패하면 오늘 세대가 사라지고,
     다음 실행은 **어제 세대 + 그보다 새 DB** 를 복원한다(복원 302-362행). 그 사이 **새 페이지가 하나라도 늘었으면** 커밋된 매니페스트의 파일 수 검사가 막지만,
     **정정만 있던 경우**(파일 수 같음 · 바이트 차이가 허용 안)는 통과한다.
  2. **수동 백필 덧붙임** — 복원은 `archive-*.tar` 를 최신 세대 **위에** 푼다(330-348행 · 「겹쳐 풀어도 같은 파일」). 로컬에서 만든 덧붙임에 이번 시즌의 **옛 페이지**가 들어 있으면 새 페이지를 덮는다. 파일 수는 그대로다.
- 그 뒤 적재기가 옛 box 로 `upsertGame` 과 자식 행(타격·투수·타석·주자)을 다시 쓰면 **점수·안타·상태가 과거로 돌아가고 `revision` 은 오른다.**
  수집 창(`MAX_CATCHUP_DAYS`) 밖의 경기는 다시 받지 않으므로 **영영 안 돌아온다.** 화면에는 오류가 없다(침묵).
- 반증자 재현: 메모리 DB 에 새 판(득점 5)을 넣고 옛 판(득점 4)을 넣으면 득점 4 · revision 2 가 된다(감사 C5 절).

### 1-2. C6 · 경기 페이지 4장이 따로 저장된다

- `packages/archiver/src/archive.ts:203-209` `archiveGame` 은 `GAME_PAGES`(`index`(빈 문자열)·`playbyplay`·`box`·`roster` · `discover.ts:111`)를
  **페이지마다 `archiveUrl` 로 받자마자 기록**하고, revision 도 페이지마다 따로 센다.
- 그래서 `playbyplay` 만 실패하고 `box` 가 바뀌면 **box 는 새 판 · playbyplay 는 옛 판**이 된다.
  적재기는 box(218행~)를 기준으로 playbyplay(397행)·roster(434행)를 **판 대조 없이** 따로 읽으므로 DB 에 그대로 섞인다
  (박스 유래 값과 타석 로그 유래 세이버가 서로 어긋난다).
- **실측(2026-09-25 · 로컬 아카이브 · 읽기 전용)** — 둘을 쟀다:
  ⑴ **box `fetchedAt` 과 다른 페이지의 `max(fetchedAt, checkedAt)` 차이가 10분을 넘는 경기**: 7,805경기 중 index **0** · playbyplay **0** · roster **0**(차이 중앙 6.1초 · 3.0초 · −3.0초).
  ⑵ **본문(gunzip 후) sha256 과 사이드카 `sha256` 의 불일치**: 경기 페이지 **31,220장 중 0**(사이드카 없음 0 · 읽기 오류 0).
  ⚠⑴은 「10분 넘게 떨어진 경기가 없다」까지만 말한다 — **같은 `archiveGame` 실행에서 나온 세트라는 증명이 아니다.**
  그래서 D3 의 「`set` 없는 기존 기록은 통과」는 **실측으로 뒷받침된, 그러나 증명되지 않은 수용 위험**이다(§6).
  → 소급 복구 작업은 이 설계의 범위가 아니다. ⚠로컬 아카이브는 2026-08-16 까지다. 그 뒤의 CI 아카이브는 안 쟀다.

## 2. 목표와 비목표

**목표**
- G1 적재가 **DB 보다 옛 판인 box** 로 경기를 되돌리지 못한다 — 경기 행·**자식 행 전부**·그 경기 명단에서 나오는 선수 표 갱신까지.
- G2 옛 판을 만나면 **조용히 넘기지 않는다** — 경기 ID 를 출력하고 종료 코드 1(→ 배포가 막힌다 · 사용자 결정).
- G3 아카이버는 경기 페이지 4장을 **다 받았을 때만** 기록을 시작한다:
  - G3a **받기 단계**에서 하나라도 실패하면 **어떤 페이지도 기록하지 않는다** — 본문도 사이드카도, **안 바뀐 페이지의 `checkedAt`(「봤다」)도** 안 쓴다. 이전 세트·이전 본 시각이 그대로다.
    ⚠~~안 바뀐 페이지의 `checkedAt` 갱신만 예외~~ 는 **결함이었다**(부록 C I1) — 적재기는 box 의 본 시각을 세트 전체의 판으로 쓰므로,
    다른 페이지가 `held` 인 채 box 의 `checkedAt` 만 오르면 판 가드가 풀려 **옛 페이지가 새 판처럼 적재된다.**
  - G3b **기록 단계**에서 실패하면 **거기서 멈춘다.** 이미 쓴 앞 페이지는 되돌리지 않는다 — 그 경기는 섞인 상태가 되고 **G4 가 잡는다.**
- G4 기록 도중 실패·사망으로 세트가 섞였거나 본문과 사이드카가 어긋났으면 적재기가 **알아차리고 그 경기를 건너뛴다**(실패로 센다).
- G5 사람이 옛 판 경기를 **CI 에서 그 날짜만 다시 받아** 풀 수 있다.

**비목표**
- `archive-guard` 확장(파일별 판 비교) — 적재기 가드가 경기 단위로 정확하므로 중복이다.
- DB 를 세대 tar 에 묶기(기각안 C · §8).
- 선수·予告先発·공표표 페이지의 세트화 — 한 URL 이 한 단위라 섞일 짝이 없다.
- 이미 옛 판으로 되돌아간 경기의 탐지·복구 — 되돌아간 뒤에는 DB 도 옛 값이라 비교 대상이 없다. 실측으로는 C6 혼합 0건이고 C5 는 안 쟀다(§6).
- **DB 가 없는 실행**(첫 실행 · `bb.sqlite.gz` 유실) — 비교할 관측이 없으므로 판 가드는 전부 「진행」이다. 이때 아카이브가 옛 세대면
  **그 사이의 정정은 아카이브에서도 DB 에서도 사라진다.** 그건 DB 되돌림(C5)이 아니라 **아카이브 자산 손실**이고 이 가드의 대상이 아니다.
  「DB 가 없으면 아카이브에서 다시 만든다」는 워크플로의 기존 결정(`daily.yml:349-358`)을 바꾸지 않는다. ⚠본문 무결성·세트 대조(D3)는 DB 없이도 돈다.
- **상류가 내용을 되돌린 경우**(나중에 받은 페이지가 예전 내용) — 가드는 **우리 관측 시각**으로 판을 정한다. 더 늦게 본 내용은 그것이 예전 내용과 같아도 **현재의 참**으로 받아들인다.
  상류의 판 식별자(revision·as-of)는 페이지에 없다(`archive.ts:112-115` — 검증자 `etag`·`lastModified` 0건 실측).

## 3. 용어

| 말 | 뜻 |
|---|---|
| **본 시각**(`seenAt`) | **`fetchedAtOf(사이드카)`** 의 값 — `normalizeFetchedAt(checkedAt) ?? normalizeFetchedAt(fetchedAt)`(`meta.ts`). 「그 내용이 상류와 같다고 마지막으로 확인한 때」 · UTC `toISOString` 모양. **`game.fetched_at` 에 이미 이 값이 들어간다**. ⚠규칙은 `seenAtOf`(이미 읽은 값) 한 벌이고 `fetchedAtOf` 는 파일을 읽어 그것을 부른다 — 경기 적재기는 스냅샷 값으로 부른다(부록 D A2). ⚠`checkedAt`·`fetchedAt` 은 아카이버가 **받은 직후** 읽은 시각이다 — 기록 시각이 아니다(부록 D A1) |
| **옛 판** | 아카이브 box 의 본 시각이 DB `game.fetched_at` 보다 **이른** 경우 |
| **세트** | 한 경기에서 한 번의 `archiveGame` 이 기록한 페이지들. 사이드카의 `set` 값이 같다 |
| **보류**(`held`) | 받았고 내용이 바뀌었지만, 같은 경기의 다른 페이지가 실패해서 **기록하지 않은** 페이지 |

## 4. 설계

### D1. 적재기의 경기 단위 판 가드 — `packages/store/tools/load-archive.ts` + `packages/store/src/`

**시각 규칙(한 벌)**: 아카이브 쪽은 기존 `fetchedAtOf` 를 그대로 쓴다. DB 쪽 `game.fetched_at` 도 **`normalizeFetchedAt` 을 거쳐** 읽는다.
비교는 정규화된 두 값을 `Date.parse` 한 밀리초로 한다(정규화 후라 문자열 비교와 같지만, 뜻을 코드에 남기려고 밀리초로 한다).
어느 쪽이든 `null`(무효)이면 **fail-closed**: 그 경기를 건너뛰고 `failed` 로 센다. ⚠DB 행이 **없거나** `fetched_at` 이 SQL `NULL` 인 것은 무효가 아니라 「처음 들어오는 경기」다 — 진행.
⚠`Date.parse` 를 날것으로 쓰지 않는다 — 시간대 표기 없는 값을 실행 기계의 현지 시간으로 읽어 JST 기계와 UTC CI 에서 9시간 갈린다(`meta.ts:22-28`).

**판정 함수**를 `packages/store/src/` 에 둔다(예: `version-guard.ts`):
```
judgeVersion(db, gameId, boxSeenAt) → "new" | "same-or-newer" | "stale" | "invalid-db"
writeGameGuarded(db, gameId, boxSeenAt, write: () => number) → { outcome: "written", n } | { outcome: "stale" } | { outcome: "invalid-db" }
```
`writeGameGuarded` 는 `db.transaction(() => { const v = judgeVersion(...); if (v === "stale" || v === "invalid-db") return {...}; return { outcome: "written", n: write() } })` 이다 —
**판정 SELECT 가 트랜잭션 안 첫 SQL** 이다.

**적재기의 경기별 순서**(바뀐 부분만):
1. box 본문을 읽고 파싱한다(지금과 같다).
2. `boxSeenAt = fetchedAtOf(box.meta.json)` — 지금 271-279행과 같다(`null` 이면 `failed`).
   ⚠**구현은 파일을 다시 읽지 않고 D3 가 읽은 스냅샷에서 낸다**(`seenAtOf(pages.box.meta)` · 같은 규칙 · 부록 D A2 — 다시 읽으면 대조한 판과 다른 판의 시각이 들어간다).
3. **사전 판정(읽기 전용)**: `judgeVersion`. `stale` → **아무것도 하지 않고** `staleArchive` 에 넣고 다음 경기로. `invalid-db` → `failed` 로 다음 경기로.
   ⚠**대회 판정·`inProgress`·`notPlayed`·라인스코어·PBP·명단 분기보다 앞**이다 — 옛 `inProgress` box·옛 명단도 여기서 걸린다.
4. **D3**(본문 무결성 → 세트 대조). 걸리면 아무것도 쓰지 않고 다음 경기로.
5. 기존 파싱(대회·라인스코어·PBP·명단)을 한다. ⚠**명단은 경기별 지역 목록에 모은다** — 지금처럼 전역 `rosterLatest`(201행~ · 441행 `set`)에 **바로 합치지 않는다.**
6. 쓰기: 미성립 분기(329행 트랜잭션)와 실시 분기(460행 트랜잭션)를 **둘 다 `writeGameGuarded` 로 감싼다.** 콜백 안의 쓰기 내용은 지금과 같다.
   - `written` → 5의 지역 명단을 `rosterLatest` 에 합친다(합치는 규칙은 지금과 같다).
   - `stale`(사전 판정 뒤 다른 적재기가 더 새 판을 커밋한 경우) → `staleArchive` · 명단 버림.
   - `invalid-db` → `failed` · 명단 버림.
7. 끝에서: `staleArchive`·`setMismatch`·`integrityMismatch` 가 하나라도 비어 있지 않으면 **경기 ID 전부**(날짜별로 묶어)와 복구 입력 예(§D4)를 출력하고
   종료 코드 1 에 합친다(747행 식에 `|| staleArchive.length > 0 || setMismatch.length > 0 || integrityMismatch.length > 0`).
8. 요약 줄(700행)에 `옛 판 건너뜀 N건 · 세트 불일치 N건 · 본문 불일치 N건` 을 **0 이어도** 찍는다.

판정 규칙:
- 행 없음 · `fetched_at` 이 SQL `NULL` → `new`(진행).
- `boxSeenAt < dbSeenAt` → `stale`.
- `boxSeenAt >= dbSeenAt` → `same-or-newer`(진행). ⚠**같은 시각도 진행한다** — 팀 코드 별칭 재정규화(`load.ts:223-227`)는 같은 판을 다시 적재해 기존 행을 고치는 데 의존한다.
- `game.fetched_at` 에 쓰는 값은 **지금 그대로 `boxSeenAt`** 이다(뜻이 이미 「마지막으로 확인한 시각」이다 · 바꾸지 않는다).

⚠**동시 적재**: 판정이 쓰기 트랜잭션 안이라 사전 판정 뒤 끼어든 더 새 판이 이긴다. 적재기는 `BEGIN`(지연 잠금 · `db.ts:67-68`)이라
두 적재기가 동시에 쓰면 SQLite 가 한쪽을 `SQLITE_BUSY` 로 실패시킨다 — 지금 동작 그대로 **실패로 보인다.** CI 는 `concurrency` 로 직렬이다.
이 설계는 동시 적재를 **허용하려는 것이 아니라 끼어들어도 옛 판이 이기지 못하게** 하는 것이다.

⚠`load.ts` 의 `upsertGame` SQL 에 `WHERE` 를 다는 방식은 **쓰지 않는다** — 자식 행은 같은 트랜잭션에서 통째로 갈아 넣으므로(`replacePaEvents` 등) 경기 행만 지키면 **자식만 옛 판**인 새 혼합이 생긴다.
262-270행의 결정 주석은 **전제 ②가 거짓이었다는 근거(§1-1)와 함께** 새 결정으로 바꿔 적는다.

### D2. 아카이버의 세트 기록 — `packages/archiver/src/archive.ts` · `sink.ts`

**`archiveUrl` 을 둘로 나눈다(규칙은 한 벌 · M1).**
- `prepareUrl(key, url, deps) → Promise<Prepared>` — `readMeta` · 받기 · 판정까지. **기록하지 않는다. 던지지 않는다.**
  결과: `unchanged`(304 또는 같은 sha · `prev` 를 든다) · `absent`(404/410 · `prev` 를 든다 — `null` 일 수 있다) · `failed`(`error`) · `changed`(새 본문과 새 `BlobMeta`).
  ⚠**`readMeta` 예외도 `failed` 로 흡수한다**(`error: "사이드카를 못 읽었다: …"`). 지금은 `readMeta`(154행)가 `try`(156행) **밖**이라 깨진 사이드카 하나가
  `archiveGame` → `archiveDate` 를 거쳐 **그날 전체를 날짜 단위 오류**로 만든다. ⚠**이것은 `archiveUrl` 단독 호출자(`cli-stats` 공표표 · `draft` · `draft-wiki`)에게도 동작 변경**이다 —
  예외(그날 전체 중단) 대신 그 페이지 `failed` 가 된다. 의도한 변경이고 시험 11a 가 고정한다.
  ⚠~~단독 호출자(공표표·선수·予告先発)~~ 는 **틀린 목록이었다**(부록 D) — 선수(`players.ts`)·予告先発(`starters.ts`)은 `archiveUrl` 을 안 쓰고 자기 `readMeta` 를 부른다.
  ⚠**`Prepared` 는 `observedAt`(받은 직후 읽은 시각)을 든다**(부록 D A1) — `changed` 의 `meta.fetchedAt` 이 그 값이고, `commitPrepared` 는 `unchanged` 의 `checkedAt` 에 그 값을 쓴다(시계를 다시 읽지 않는다).
- `commitPrepared(prepared, deps, extra) → Promise<PageResult>` — `changed` 면 `sink.write`, `unchanged` 면 `markSeen`, 나머지는 아무것도 안 한다.
  ⚠**던지지 않는다.** `sink` 가 던지면 잡아서 `{ outcome: "failed", error }` 를 돌려준다.
- `archiveUrl` = `prepareUrl` → `commitPrepared`. 위 `readMeta` 한 가지 말고는 **기존 호출자의 동작이 그대로다**(외부 요청 수·순서·결과 값 동일).

**`archiveGame` 은 이렇게 바뀐다.**
1. `GAME_PAGES` 순서대로 4장을 **모두** `prepareUrl` 한다. ⚠요청 수·순서·간격은 지금과 같다(L1). 중간에 실패해도 나머지를 계속 받는다(지금과 같다).
2. **「있던 페이지의 404/410」을 실패로 바꾼다.** `absent` 인데 `prev !== null`(사이드카가 이미 있다)이면 그 페이지를 `failed`(`error: "있던 페이지가 사라졌다"`)로 본다.
   기존 본문·사이드카는 **지우지 않는다**(소급 불가 자산). `prev === null` 인 404(처음부터 없음)는 `absent` 이고 세트의 정상 구성원이다.
   ⚠이 규칙은 `archiveGame` 안에만 둔다 — 단독 호출자의 `absent` 의미는 바꾸지 않는다.
3. **받기 단계 실패(G3a)** — 1·2 뒤 `failed` 가 하나라도 있으면(⚠**`index` 포함** — 세트는 4장 전부다. 맞교환: `index` 만 실패해도 그날 box 갱신이 보류된다. 대신 규칙이 「전부 아니면 전무」 하나라 예외 목록이 없다):
   - `changed` → **기록하지 않고** `held`.
   - `unchanged` → **`markSeen` 하지 않는다** — 결과만 `unchanged` 로 돌려준다(사이드카 쓰기 0회).
     ⚠~~`markSeen` 하되 `set` 을 넘기지 않는다~~ 는 **틀렸다**(부록 C I1 · 2026-09-26). 적재기는 **box 사이드카의 본 시각**
     (`fetchedAtOf` = `checkedAt ?? fetchedAt`)을 **네 장 세트 전체의 판**으로 쓴다(D1). box 가 안 바뀌고 playbyplay 가 바뀌어 `held` 인데
     다른 페이지가 실패하면, box 의 `checkedAt` 만 지금으로 올라 판 가드가 「같거나 새 판」으로 보고 **옛 playbyplay 를 적재한다** —
     `refetch_dates` 복구 중이면 타석·주자·격리가 **요약 0/0/0 인 채 조용히 옛 판으로** 돌아간다.
     「봤다」를 안 남겨 잃는 것은 없다 — 경기 페이지는 수집 창(날짜 단위)이 다시 받는다.
   - `absent`·`failed` → 결과만 그대로(기록 없음).
4. **실패가 없으면** 세트 id 를 **한 번** 만든다:
   `set = <clock.now().toISOString()> + "-" + sha256(<page key 들과 각 페이지의 새 sha256(absent 는 "-")를 GAME_PAGES 순서로 줄바꿈으로 이은 것>).slice(0, 16)`.
   ⚠**내용이 다르면 같은 밀리초라도 id 가 다르다**(수동 백필과 CI 가 같은 경기를 겹쳐 받는 경우 · `sink.ts:141-144` 가 그 겹침을 인정한다).
   내용이 같으면 id 가 같아도 무해하다(같은 세트다). 시각은 주입된 `clock` 이다(M6).
   그다음 `GAME_PAGES` 순서대로 `commitPrepared` 한다 — `changed` 는 `write`, `unchanged` 는 `markSeen` 이고 **둘 다 사이드카에 `set` 을 적는다.** `absent`(처음부터 없음)는 적을 곳이 없다.
5. **기록 단계 실패(G3b)** — `commitPrepared` 가 어떤 페이지에서 `failed` 를 돌려주면 **거기서 멈춘다.** 그 뒤 페이지의 `changed` 는 `held`, `unchanged` 는 `markSeen` 없이 `unchanged`.
   이미 기록한 앞 페이지는 **되돌리지 않는다**(되돌리기 자체가 또 실패할 수 있다) — 그 경기는 새 `set` 과 옛 `set` 이 섞이고 **D3 가 잡아 적재를 건너뛴다.**
   다음 실행(수집 창 안이면 자동 · 밖이면 D4 재수집)이 세트 전체를 다시 기록해 풀린다.
6. 한 파일의 쓰기는 본문 `rename` 다음 사이드카 `rename` 이다(`sink.ts:118-123` · `141-149`). ⚠**둘 사이에서 죽으면 본문은 새 판 · 사이드카는 옛 판(옛 `sha256`·옛 `set`)** —
   `set` 비교로는 못 잡으므로 **D3 가 본문 sha 도 대조한다.**

**타입**
- `BlobMeta` 에 선택 필드 `set?: string` 을 더한다. ⚠없는 사이드카(기존 전부)를 **깨진 것으로 읽지 않는다.**
- `BlobExtra` 에 `set?: string` 을 더한다(`markSeen` 과 `write` 양쪽에서 쓰려고).
- `PageOutcome` 에 `"held"` 를 더한다. `summarize` 는 `held` 를 따로 센다. ⚠`held` 는 실패가 아니다 — 그 경기에 **이미 `failed` 가 있으므로** CLI 의 종료 코드는 지금 규칙(실패가 있으면 1)으로 이미 1 이다.
- `MemorySink`(시험용)도 같은 계약을 지킨다.

### D3. 적재기의 본문 무결성과 세트 대조 — `load-archive.ts`

D1 순서의 4단계다(사전 판정 뒤 · 파싱·쓰기 전). ⚠`--skip-events` 여부와 무관하게 네 페이지 전부에 적용한다.
⚠**DB 없이도 돈다**(판 가드와 달리 비교 대상이 파일뿐이다).

**① 본문 무결성** — 네 페이지(index · playbyplay · box · roster) 각각 본문(`.html.gz`)과 사이드카(`.meta.json`)의 존재 조합:

| 본문 | 사이드카 | 판정 |
|---|---|---|
| 있음 | 있음 | gunzip 한 본문의 sha256 이 사이드카 `sha256` 과 **같아야** 한다. 다르면 **불일치** |
| 없음 | 있음 | **불일치**(본문이 사라졌다) |
| 있음 | 없음 | **불일치**(기록 도중 사이드카 전에 죽었다 · 아카이버는 다음에 `prev === null` 로 다시 받는다 — `sink.ts:113-117`) |
| 없음 | 없음 | **없는 페이지** — 불일치가 아니다. 그 뒤 처리는 지금 그대로다(playbyplay 가 없으면 지금처럼 PBP 읽기 실패로 `failed` 가 되고 경기는 타석 없이 적재된다 · 423-426행) |

⚠box 는 순회가 `box.html.gz` 로 찾으므로(218행) 「본문 없음」 행이 box 에는 생기지 않는다. box 사이드카가 없으면 지금처럼 2단계에서 `failed` 다.
불일치가 하나라도 있으면 그 경기를 **아무것도 쓰지 않고** 건너뛰고 `integrityMismatch` 에 넣는다.
⚠roster 는 「적재를 멈추지 않는 보충」(429-432행)이지만 **무결성 불일치는 예외로** 경기를 건너뛴다 — 본문과 사이드카가 어긋났다는 것은 그 경기 디렉터리가 기록 도중 죽었다는 신호다.
실측: 기존 아카이브 31,220장 전부 일치(§1-2 ⑵) — 첫 배포에서 기존 기록을 거짓으로 걸지 않는다.
⚠네 본문을 이 단계에서 **한 번** 읽고, 뒤의 라인스코어·PBP·명단 파싱이 그 버퍼를 재사용한다(파일을 두 번 읽지 않는다).

**② 세트 대조** — 사이드카가 있는 페이지의 `set` 값을 모은다.
- **아무 페이지에도 `set` 이 없다** → **기존 기록(D2 이전)으로 보고 통과**. 근거: §1-2 실측(수용 위험 · §6).
- **모두 같은 값** → 통과.
- **그 밖**(값이 둘 이상 · 어떤 페이지엔 있고 어떤 페이지엔 없음) → 아무것도 쓰지 않고 건너뛰고 `setMismatch` 에 넣는다.
  ⚠기존 경기가 D2 이후 처음 다시 받히면 **세트 전체에 `set` 이 한꺼번에 붙으므로**(`unchanged` 도 `markSeen` 으로 적는다) 섞이지 않는다.
  ⚠받기 단계 실패(G3a) 뒤에는 사이드카가 **하나도** 안 바뀌므로(`set` 도 `checkedAt` 도) 기존 상태 그대로다.

①을 ②보다 **먼저** 한다 — 본문이 사이드카와 안 맞으면 그 사이드카의 `set` 은 믿을 근거가 없다.

### D4. 재수집 입력 — `.github/workflows/daily.yml` · `scripts/update.ts`

- `workflow_dispatch` 에 입력 `refetch_dates`(문자열 · 선택)를 더한다.
- 수집 단계는 그 값을 **환경변수 `BB_REFETCH_DATES` 로만** 넘긴다. ⚠`run:` 안에 `${{ inputs.refetch_dates }}` 를 직접 쓰지 않는다(스크립트 인젝션).
- `update.ts` 는 `BB_REFETCH_DATES` 가 비어 있지 않으면:
  - 형식을 검증한다 — 쉼표로 나눈 `YYYY-MM-DD` 가 **1~7개**, 각각 실재하는 날짜(`2026-02-30` 거부), 중복 없음, 앞뒤 공백 외의 다른 문자 없음. 틀리면 **종료 코드 2 로 즉시 멈춘다**(아무것도 받지 않는다).
  - 그 날짜들을 **수집 창 대신** 받는다(`--date` 와 같은 어법 — 「날짜를 명시하면 그날만」). 적재와 이후 단계는 그대로다.
  - 상한 7 은 L1 근거다: 하루 최대 6경기 × 4장 × 7일 = 168요청 ≈ 3초 간격 8.4분.
  - 검증·날짜 목록 계산은 **import 가능한 순수 함수**로 둔다(`scripts/date-window.ts` 처럼) — `update.ts` 는 import 하면 수집을 시작해서 시험할 수 없다.
- ⚠수동 실행 전용이다. 크론 실행에서는 값이 비어 있어 **지금과 동작이 같다.**

### D5. 문서

- `docs/operations/deploy.md` 에 절 추가: 「옛 판·세트·본문 불일치로 수집이 실패했을 때」 — 원인(§1-1 둘 · 기록 도중 사망) · 로그에서 경기 ID 읽는 법 ·
  **`refetch_dates` 로 그 날짜를 다시 받는 절차** · 다시 받아도 안 풀리면(상류가 그 페이지를 지웠다 → 「있던 페이지가 사라졌다」 실패가 같이 찍힌다) 사람이 판단할 것.
- `load-archive.ts:262-270` 주석 교체(D1).
- 감사 문서는 **고치지 않는다**(그날의 기록이다). 원장 대조는 다음 감사가 한다.

## 5. 실패 모드와 그 처리

| 상황 | 결과 |
|---|---|
| CI 업로드 부분 실패 뒤 옛 세대 복원(정정만 있던 날) | 정정된 경기가 **옛 판**(사전 판정) → 건너뜀 · 잡 실패 · 배포 막힘 → 사람이 `refetch_dates` |
| 백필 덧붙임이 옛 페이지로 덮음 | 같다 |
| 옛 `inProgress` box · 옛 명단 | 사전 판정이 모든 분기보다 앞이라 같은 결과(아무것도 안 씀 · 선수 표도 안 바뀜) |
| `playbyplay` 만 일시 실패(받기 단계) | 바뀐 페이지는 `held` · **사이드카 쓰기 0회**(새 본문·`set` 없음 · 안 바뀐 페이지의 `checkedAt` 도 안 올림 · 부록 C I1) · 이전 세트·본 시각 유지 · 수집 잡은 지금처럼 실패로 센다 · 다음 실행(창 안)이 다시 받는다. ⚠**풀리는 것은 네 장을 다 받은 실행뿐이다** — 그 전까지는 이전 판 그대로라, 옛 판 복구(`refetch_dates`) 중이었다면 그 경기는 **여전히 옛 판으로 잡혀 잡이 실패하고** 깨끗한 재수집까지 그 상태다(조용히 옛 페이지를 적재하지 않는다) |
| 기록 도중 `sink` 예외 | 거기서 멈춤 · 뒤는 `held` · 앞은 새 `set` → `setMismatch` → 다음 실행이 풂 |
| 기록 도중 프로세스 사망(페이지 사이) | 일부 페이지만 새 `set` → `setMismatch` |
| 기록 도중 프로세스 사망(한 페이지의 본문과 사이드카 사이) | 본문 sha ≠ 사이드카 sha → `integrityMismatch` |
| 깨진 사이드카(JSON) | 아카이버: 그 페이지 `failed` → 세트 보류(날짜 전체 중단 아님) · 적재기: box 면 본 시각 `null`(`seenAtOf(pages.box.meta)`) → `failed`, 다른 페이지면 sha 를 못 읽어 `integrityMismatch`. ⚠**재수집으로 안 풀린다** — 받기 단계 실패라 그 경기에 아무것도 기록되지 않는다(G3a). 이전 세대에서 되살린다(런북 §7-E · 부록 D B1) |
| 잘리거나 깨진 `.gz` · 상류 = 사이드카 sha | 적재기: `본문을 못 풀었다` → `integrityMismatch` · 아카이버: `unchanged`(로컬 본문을 안 연다) → 본문을 영영 다시 안 쓴다. **재수집으로 안 풀린다** → 이전 세대에서 되살린다(부록 D B1) |
| 두 아카이버가 같은 아카이브 폴더에 겹쳐 기록(로컬 수동 백필끼리 · **지원하지 않는다**) | 본 시각이 **받은 시각**이라(부록 D A1) 옛 내용에 새 시각이 붙지 않는다 → 적재기가 옛 판·세트·본문 불일치로 **시끄럽게** 멈춘다. 늦게 기록한 쪽이 새 내용을 덮는 자산 손실은 막지 못한다 |
| 있던 페이지가 404(수집 중이든 재수집 중이든) | 그 페이지 `failed`(「있던 페이지가 사라졌다」) · 세트 보류 · 본문·사이드카 보존 · 옛 판이었다면 여전히 옛 판 → 런북의 「사람이 판단」 |
| 사이드카·DB 의 시각이 무효 | 그 경기 `failed`(fail-closed) |
| 두 적재기가 같은 DB 에 동시 쓰기 | 판정이 쓰기 트랜잭션 안이라 옛 판이 못 이긴다 · 잠금 경합은 `SQLITE_BUSY` 실패로 보인다(지금과 같다) |
| 재수집했는데 상류 내용이 옛 아카이브와 같다 | **네 장을 다 받았을 때만**: `unchanged` → `checkedAt` 이 올라 본 시각 ≥ DB → **진행**(DB 가 상류와 같아진다 · 이게 맞다). ⚠한 장이라도 받기에 실패하면 아무것도 기록하지 않으므로(G3a) `checkedAt` 이 안 올라 **여전히 옛 판** → 잡 실패 · 깨끗한 재수집까지 옛 판 그대로다(부록 C I1) |
| DB 가 없다(첫 실행 · DB 복원 실패) | 판 가드는 전부 「행 없음」 → 진행(지금과 같다). D3 는 돈다 |
| 시계가 뒤로 간 러너 | 새로 받은 페이지의 시각이 DB 보다 이를 수 있다 → 거짓 「옛 판」 → 실패로 **보인다**(조용히 틀리지 않는다). 러너 시계는 NTP 동기라 발생 기대는 낮다 — 안 쟀다 |

## 6. 미측정 전제 — 틀리면 무엇이 바뀌나

- **CI 아카이브의 혼합·옛 판·본문 불일치 실재 여부는 안 쟀다**(로컬 아카이브는 2026-08-16 까지). 배포 첫 실행에서 새 세 건수가 0 이 아니면 **이미 일어난 일**이다 — 런북대로 푼다.
  ⚠첫 실행이 빨개질 수 있다는 것을 배포 보고에 미리 적는다.
- `gh release upload` 가 자산 여러 개를 줄 때 **어느 순서로 지우고 올리는지**는 안 쟀다. §1-1 경로 1 은 「오늘 세대만 사라지고 DB 는 새것」이 가능하다는 것까지만 주장한다.
- 러너 시계 역행(§5)은 안 쟀다.
- **「관측 시각의 순서 = 내용 판의 순서」를 전제한다**(§2 비목표 마지막 줄). 우리 수집기의 시계가 판을 정한다.
- **`set` 없는 기존 기록이 섞이지 않았다**는 것은 증명이 아니라 실측 근거의 수용이다(§1-2 ⑴ — 10분 기준 · 네 페이지 전부 0건).
- ~~`isTransaction` 을 쓸 수 있는가~~ — **확인했다**(2026-09-25 · 이 저장소의 Node 24 · `BEGIN` 전 `false` · 안 `true`). 시험 7a 의 전제가 아니라 사실이다.

## 7. 시험 · 검증 — 완료 기준

⚠**새 시험은 고치기 전 코드에서 먼저 실패하는지 확인한 뒤** 채택한다(뮤테이션 검사 · 루트 §1).

**판정 함수(D1)** — `packages/store/test/` · 메모리 SQLite.
7a. `writeGameGuarded`: 판정 SELECT 가 실행되는 순간 `db.raw.isTransaction === true` 임을 문장 가로채기로 확인한다. ⚠**뮤턴트**: SELECT 를 `db.transaction` 밖(앞)으로 옮긴 판이 **반드시 RED** 여야 채택.
7a′. 사전 판정 뒤·쓰기 전에 더 새 `fetched_at` 을 커밋하는 훅(콜백 주입)을 넣으면 `writeGameGuarded` 가 `stale` 을 돌려주고 `write` 를 **부르지 않는다.**
7b. 시각 표: 행 없음 → `new` · SQL `NULL` → `new` · DB `fetched_at` 이 `"not-a-date"` 또는 시간대 없는 `2026-08-16T12:00:00` → `invalid-db` · box `…:00.5Z` 대 DB `…:00.500Z` → `same-or-newer` · box 가 1ms 이르면 `stale`.

**적재기(D1·D3)** — 임시 아카이브 디렉터리 + 임시 SQLite 로 `load-archive.ts` 를 실제로 돌리는 기존 시험 방식을 따른다.
1. 새 판(득점 5 · 본 시각 t2) 적재 뒤 옛 판(득점 4 · t1<t2) 적재 → 득점 5 · revision 불변 · **타격·투수·타석·주자 행도 새 판 그대로** · 종료 코드 1 · 출력에 경기 ID.
2. 같은 판을 두 번 적재 → 종료 코드 0 · revision 불변(기존 멱등 시험과 같아야 한다).
3. 별칭 재정규화: 같은 시각의 같은 판을 다시 적재했을 때 팀 코드가 갱신된다(`game-upsert.test.ts` 의 기존 기대가 계속 통과).
4. box `fetchedAt` 은 옛값이지만 `checkedAt` 이 DB 보다 늦다 → **진행**.
5. 옛 판 **미성립** box · 옛 판 **`inProgress`** box 가 들어와도 DB 의 실시 경기 행·자식 행이 **그대로**다.
5a. 옛 판 경기의 **명단**이 선수 표(`player` 의 투타·배번·포지션 보충)를 바꾸지 않는다 — 명단에만 있는 값을 심은 픽스처로 확인.
6. 세트: 모든 사이드카에 `set` 없음 → 통과 · 모두 같음 → 통과 · box 만 다른 `set` → 건너뜀·종료 코드 1 · 일부만 `set` 있음 → 건너뜀.
6a. 본문 무결성 네 조합 × 네 페이지: 본문 한 바이트 변경 · 본문만 삭제 · 사이드카만 삭제 → `integrityMismatch`·DB 불변 · 둘 다 없음(playbyplay) → 지금 동작(PBP 실패 `failed` · 경기 적재). `index` 본문만 바꾼 경우도 걸린다.
7. 요약 줄에 `옛 판 건너뜀 0건 · 세트 불일치 0건 · 본문 불일치 0건` 이 **0 일 때도** 찍힌다.
7c. DB 없이 돌려도 6·6a 가 똑같이 걸린다.

**아카이버(D2)** — 가짜 fetcher + `MemorySink`(고장 주입 가능한 판).
8. `index` 같은 본문 · `playbyplay` 예외 · `box` 바뀐 본문 · `roster` 같은 본문 → 결과가 정확히 `[unchanged, failed, held, unchanged]` · box 본문·revision 그대로 · 새 box 쓰기 0회 · **사이드카 쓰기(`markSeen`)도 0회** · `index`·`roster` 의 `checkedAt` 은 **심은 그대로**, `set` 은 이전 값 그대로.
   ⚠~~`checkedAt` 은 오르고~~ 는 부록 C I1 로 뒤집혔다.
8a. (부록 C I1) 네 장을 심고(`set`·box `checkedAt` 고정) `index` 예외 · `playbyplay` 바뀜 · `box`·`roster` 같음 → `[failed, held, unchanged, unchanged]` · box 사이드카의 `checkedAt` 이 **심은 값 그대로** · playbyplay 본문은 옛 판. ⚠**뮤턴트**: 이 갈래에 안 바뀐 페이지의 `markSeen` 을 되살리면 8·8a 가 **RED** 여야 채택.
9. 전부 성공 → 바뀐 페이지는 새 revision, 안 바뀐 페이지는 `checkedAt` 갱신, **네 사이드카의 `set` 이 모두 같다.**
9a. 세트 id: 같은 `clock` 값 · 다른 내용의 두 실행 → id 가 다르다 · 같은 내용 → 같다.
10. 요청 수·순서가 지금과 같다 — 가짜 fetcher 의 호출 기록을 기존 순서와 대조.
11. `archiveUrl` 을 쓰는 기존 호출자 시험(`cli-stats` 공표표 · `draft` · `draft-wiki` — ⚠~~공표표·선수·予告先発~~ 은 틀린 목록이었다 · 부록 D)이 **변경 없이** 통과.
11a. 깨진 사이드카: `readMeta` 가 던지는 sink → `prepareUrl` 이 `failed` · `archiveUrl` 도 던지지 않고 `failed` · `archiveGame` 은 그 경기 세트 보류 · `archiveDate` 가 **날짜 오류가 아니라** 페이지 `failed` 를 돌려준다. 첫·중간·마지막 페이지 각각.
12a. `index` 같음 · `playbyplay` 바뀜 · `box` 바뀜 · `roster` 같음 + `playbyplay` 의 `write` 에서 던지는 sink → 결과 `[unchanged, failed, held, unchanged]` · `index` 사이드카만 새 `set` · `roster` 는 `markSeen` 없음 · `archiveGame` 은 던지지 않음.
12b. `writeMeta` 에서 던지는 sink(본문은 이미 교체) → 그 페이지 `failed` · 뒤는 `held` · 이 아카이브를 적재기가 `integrityMismatch` 로 건너뛴다.
12c. 있던 `playbyplay` 가 404 → 그 페이지 `failed`(「있던 페이지가 사라졌다」) · 다른 바뀐 페이지 `held` · 기존 본문·사이드카 보존. 처음부터 없던 페이지의 404 는 `absent` 이고 세트가 기록된다.

**재수집 입력(D4)**
13. 검증 함수: 빈 값 → 기존 창 · `2026-08-01,2026-08-02,2026-08-03` → 그 3일 · 8개 → 거부 · `2026-02-30` → 거부 · `2026-08-01;rm -rf /` → 거부 · 중복 → 거부 · `2026-8-1` → 거부. 거부는 `update.ts` 에서 종료 코드 2.
14. 정적 시험(`scripts/test/` 의 워크플로 시험 방식): `daily.yml` 의 어떤 `run:` 블록에도 `inputs.refetch_dates` 가 **직접** 나오지 않고, 수집 단계의 `env` 에 `BB_REFETCH_DATES` 가 있다.

**전체**: `npm run typecheck` 0 · `npm test` 전체 FAIL 0 · ERROR 0(분모와 함께 보고).

## 8. 기각한 안

- **B — 적재기 검사만(시각 차로 C6 감지)**: C6 을 **막지 못하고 발견만** 하며, 「몇 분 안이면 같은 패스」라는 **추측 임계값**이 들어간다. 세트 id 는 추측이 없다.
- **C — DB 를 세대 tar 에 묶어 같은 시점으로 복원**: CI 경로는 막지만 **수동 백필 경로를 못 막는다.** 세대 크기와 운영 배선이 크게 바뀐다.
- **`upsertGame` 의 `WHERE` 만**: 자식 행이 옛 판으로 덮여 새 혼합을 만든다(D1 끝).
- **옛 판이면 경고만 하고 계속**: 아카이브 자산 손실(옛 판이 된 원인)을 아무도 모른다 — 사용자가 「실패로 끝내 배포를 막는다」를 골랐다.
- **`archive-guard` 에 파일별 판 비교**: 매니페스트가 공개 저장소에 커밋되는 파일이라 경기 수만큼의 목록을 싣기 어렵고, 적재기 가드가 경기 단위로 이미 정확하다.
- **세트 id 에 무작위(UUID)**: 시각·난수는 주입해 결정론화한다는 규칙(루트 §6)과 어긋난다. 내용 digest 가 충돌을 같은 효과로 막는다.
- **적재 트랜잭션을 `BEGIN IMMEDIATE` 로**: 동시 적재를 매끄럽게 만들 뿐 옛 판 방지에는 필요 없다. `db.transaction` 은 모든 적재에 쓰이는 공용 함수라 범위가 커진다.

## 9. 단계

1. D1(판정 함수 + 적재기 순서) + D3 + 시험 7a·7a′·7b·1~7c
2. D2 + 시험 8~12c
3. D4 + 시험 13~14 · D5 문서
4. `npm test` 전체 · 배포 전 `shiro-core:triple-review` · PR(사용자 승인 뒤)

## 부록 A. 콜드 리뷰 1회 반영 (2026-09-25 · `gpt-5.6-sol` · high · rc=0 · ok=true · 커밋 `081a477` 기준 · 지적 9건 · P1 3 · P2 5 · P3 1)

외부 판정: 「이 문서만으로 안전하게 구현을 시작할 수 없다」. 중개자가 코드 인용 6/6 · 문서 자기 인용 9/9 를 저장소에서 대조했고 전부 맞았다.

| # | 지적 | 반영 |
|---|---|---|
| 1 P1 | 판 검사(SELECT)와 쓰기 사이에 파싱 구간이 끼어 동시 적재기가 경합 | 판정을 **쓰기 트랜잭션 안**으로 · 2회차에서 함수로 묶음(D1) |
| 2 P1 | 본문 `rename` 과 사이드카 `rename` 사이에 죽으면 `set` 대조를 통과 | D3 ① 본문 무결성 · 실측 31,220/31,220 일치 |
| 3 P2 | 있던 페이지가 나중에 404 면 옛 사이드카가 옛 `set` 으로 남음 | D2-2: `failed` · 본문 보존 |
| 4 P1 | DB 가 없으면 가드가 조용히 우회됨 | §2 비목표로 명시 — 남는 것은 아카이브 자산 손실이다 · 워크플로의 기존 결정은 안 바꾼다 |
| 5 P2 | `commitPrepared` 반환·예외 계약 부재 | D2: 던지지 않음 · 기록 단계 실패에서 멈춤(G3b) |
| 6 P2 | 무효 시각(NaN) 규칙 부재 | fail-closed · 2회차에서 `normalizeFetchedAt` 한 벌로 |
| 7 P2 | 「관측 시각 순서 = 내용 판 순서」 전제 미기재 | §2 비목표 · §6 |
| 8 P2 | 혼합 0건 실측이 세트 동일성을 증명하지 않고 `index` 안 잼 | §1-2 문구를 낮춤 · `index` 포함 재측정(0/7,805) · §6 수용 위험 |
| 9 P3 | `upsertGame` 서술이 실제 SQL 보다 넓음 | §1-1 을 SET 열·revision 조건·NULL 규칙대로 |

## 부록 B. 콜드 리뷰 2회 반영 (2026-09-25 · `gpt-5.6-sol` · high · rc=0 · ok=true · 커밋 `f77d5c0` 기준 · 지적 10건 · P1 4 · P2 6)

외부 판정: 「이 문서만으로 안전하게 구현을 시작할 수 없다」. 중개자가 코드 인용 7/7 을 대조했고 전부 맞았다.
⚠**#1 은 이 문서의 사실 오류였다** — 1회 판은 「`fetchedAtOf` 는 `fetchedAt` 만 돌려준다」고 적고 그 위에 「비교는 본 시각 · 저장은 `fetchedAt`」의 비대칭을 세웠는데,
실제 `fetchedAtOf` 는 이미 `checkedAt` 을 먼저 돌려주고 DB 에 그 값이 들어간다(`meta.ts:46-72`). **코드를 안 열고 이름으로 추측한 서술이었다.**

| # | 지적 | 반영 |
|---|---|---|
| 1 P1 | `game.fetched_at` 의 현재 의미를 반대로 전제 | §1-1·§3·D1 을 `fetchedAtOf` 한 벌로 다시 씀 · 비대칭 절 삭제 |
| 2 P1 | `inProgress`·명단→선수 표 경로가 가드 밖 | D1-3 사전 판정을 모든 분기 앞에 · D1-5·6 명단은 쓰기 성공 뒤에만 합침 · 시험 5·5a |
| 3 P1 | 「트랜잭션 전에 심는」 시험은 SELECT 가 밖에 있어도 통과 | 판정·쓰기를 `writeGameGuarded` 로 묶고 `isTransaction` 확인 + 뮤턴트 RED 조건(7a) · 7a′ |
| 4 P1 | 본문·사이드카 단독 존재 조합 미정의 | D3 ① 4조합 표 · 시험 6a |
| 5 P2 | 무결성 검사가 `index` 를 빠뜨림 | D3 ① 네 페이지 전부 |
| 6 P2 | G3 「이전 세트 유지」와 「앞 페이지 안 되돌림」 모순 | G3a(받기 단계)·G3b(기록 단계)로 나눔 |
| 7 P2 | 실패 모드 표의 「재수집 중 404 → `absent`」가 D2 규칙과 충돌 | §5 표를 「있던 페이지가 404 → `failed`」 한 줄로 합침 |
| 8 P2 | `prepareUrl` 의 `readMeta` 예외 계약 부재 | `failed` 로 흡수 · 단독 호출자 동작 변경을 명시 · 시험 11a |
| 9 P2 | 새 시각 검증이 `normalizeFetchedAt` 보다 약함 | 양쪽 다 `normalizeFetchedAt`(D1 시각 규칙) · 시험 7b |
| 10 P2 | 시각만의 세트 id 가 같은 밀리초에서 충돌 | 시각 + 내용 digest(D2-4) · 시험 9a · §8 에 UUID 기각 사유 |

## 부록 C. 최종 가지 검토 반영 (2026-09-26 · opus · `324dccc..c8fa014` 기준 · Important 2 · Minor 6)

판정: 「고친 뒤 병합 가능」. 이 판에 반영한 것과, 구현 중 설계에서 벗어나 **받아들인** 편차를 적는다.

### C-1. I1 — G3a 의 「안 바뀐 페이지는 `markSeen`」이 옛 판 가드를 풀었다(설계 결함)

- **원래 문구**: G3a 「안 바뀐 페이지의 `checkedAt` 갱신만 예외 — `set` 은 안 바뀐다」 · D2-3 「`unchanged` → `markSeen` 하되 `set` 을 넘기지 않는다」.
  `set` 만 지키면 세트 대조(D3 ②)가 안 깨지니 무해하다고 봤다.
- **왜 틀렸나**: 판 가드(D1)는 **box 사이드카의 본 시각**(`fetchedAtOf` = `checkedAt ?? fetchedAt`)을 **네 장 세트 전체의 판**으로 쓴다.
  box 가 안 바뀌고 다른 페이지가 `held` 인 채 box 의 `checkedAt` 만 오르면, 세트 내용은 옛 판인데 **판은 방금 확인한 것처럼** 된다.
  이 설계가 막으려던 「옛 판이 새 판을 덮는다」가 **설계 자신의 경로로** 생긴다. `set` 이 안 바뀌었으니 세트 대조도 통과한다.
  콜드 리뷰 2회(부록 A·B)도 못 봤다 — **`checkedAt` 을 「봤다」의 기록으로만 읽고, 적재기가 그것을 판으로 읽는다는 것을 겹쳐 보지 않았다.**
- **언제 나나**: 한 장이라도 받기 실패(`index` 일시 오류 · 「있던 페이지가 사라졌다」 등) + box 안 바뀜 + playbyplay(또는 roster) 바뀜.
  ⚠**공식 복구 절차(`refetch_dates`)가 정확히 이 모양이다** — 옛 판으로 잡힌 경기를 다시 받는 중에 `index` 가 한 번 실패하면
  box 의 본 시각이 DB 이상이 되어 **옛 playbyplay 가 적재되고**, 타석·주자·격리가 옛 판으로 돌아간 채 요약은
  `옛 판 건너뜀 0건 · 세트 불일치 0건 · 본문 불일치 0건` 이 된다(침묵).
- **프로브**(검토자 · 읽기 전용 · `MemorySink`): 네 장을 심고 `index` 예외 · playbyplay 새 본문 · box·roster 같은 본문 →
  `index=failed playbyplay=held box=unchanged roster=unchanged` · **box `checkedAt` 이 실행 시각으로 올랐고** playbyplay 본문은 옛 판.
  고친 뒤 같은 프로브: box `checkedAt` 이 **심은 값 그대로**.
- **고침**: 받기 단계 실패 갈래에서 **어떤 페이지도 기록하지 않는다**(`unchanged` 는 `markSeen` 없이 결과만 · `absent`·`failed` 도 결과만).
  잃는 것은 없다 — 경기 페이지는 수집 창이 날짜 단위로 다시 받고, 네 장을 다 받는 실행에서 `set` 과 함께 한꺼번에 「봤다」가 남는다.
  G3a · D2-3 · D3 ② · §5 두 줄 · 시험 8 을 고치고 8a 를 더했다. 뮤턴트(이 갈래에 `markSeen` 을 되살림) → **8·8a 둘 다 RED** 확인.
- ⚠**§5 가 이제 「네 장을 다 받았을 때만」을 말한다** — 재수집이 푸는 것은 네 장을 다 받은 실행뿐이고, 그 전까지 그 경기는
  **옛 판으로 잡혀 잡이 실패한다**(조용히 옛 페이지를 적재하지 않는다). 런북 §7-E 의 완료 기준에 「수집 합계 실패 0 · 보류 0」을 더한 이유다.

### C-2. 구현이 설계에서 벗어나 받아들인 것

| 설계 | 구현 | 사유 |
|---|---|---|
| D1-1 「box 본문을 읽고 파싱한다」가 첫 단계 | box **파싱을 D3 뒤로** 옮겼다(네 장 읽기 → 본 시각 → 사전 판정 → 무결성 → 세트 → box 파싱) | 파싱은 D3 가 한 번 읽은 버퍼(`pages.box.body`)를 쓰고, 무결성을 통과해야 그 본문이 있다는 것이 보장된다. 무결성이 안 맞는 본문은 파싱할 근거가 없고, 파싱 오류가 무결성 불일치를 가리지도 않는다 |
| D1 `writeGameGuarded → { outcome: "written", n }` | `{ outcome: "written", value: T }`(`GuardedWrite<T>` · 계획 Task 1 이 정했다) | 콜백이 무엇을 돌려주든 담는다 — 미성립 경로는 `upsertGame` 의 수를 돌려주고 실시 경로의 콜백은 값이 없다 |
| D4 상한 7 의 자리를 정하지 않음 | `MAX_REFETCH_DATES` 를 **import 0개인 잎** `packages/store/src/refetch-limit.ts` 에 두고 서브패스 `@bb-app/store/refetch-limit` 로 내보낸다 | `scripts/update.ts` 가 `scripts/date-window.ts` 를 거쳐 이 값을 가져오는데, store 배럴을 거치면 parser·domain 까지 평가돼 **무관한 모듈의 로드 오류가 수집을 시작 전에 죽인다.** `scripts/test/refetch-wiring.test.ts` 가 잎임을 강제한다 |
| D3 ① 「네 본문을 이 단계에서 한 번 읽는다」(읽기 오류는 미정) | `roster`·`index` 의 **ENOENT 아닌 읽기 오류도 경기 전체 실패**(`READ ERROR` · `failed`) | 못 읽은 페이지는 무결성·세트 대조를 할 수 없다. ⚠**예전보다 엄격하다** — 예전엔 roster 읽기 오류는 `ROSTER ERROR` 로 세기만 하고 경기를 적재했고, PBP 읽기 오류는 타석 없이 적재했으며, `index` 는 읽지 않았다(`load-archive.ts` 주석에 적었다) |
| D4 날짜 목록(순서 미정) | `refetch_dates` 의 날짜를 **오름차순 정렬**해 받는다 | 받는 순서와 로그가 날짜순이 되고 「마지막 날짜 = 가장 늦은 대상일」이 늘 참이다. ⚠~~`update.ts` 가 마지막 날짜를 予告先発 조회 시즌의 근거로 쓴다~~ 는 **틀린 서술이었다**(부록 D A3) — 마지막 날짜로 정하던 것은 **앞으로의 일정**(`load-upcoming.ts`)의 시즌이고 予告先発(`cli-starters.ts`)은 날짜를 받지 않는다. 그리고 재수집 실행에서는 그 시즌을 이제 **JST 의 올해**로 정한다(재수집 날짜는 작년일 수 있다) |
| D4 `--date` 와의 관계만 | **`--today` 와 `BB_REFETCH_DATES` 를 같이 주면 거부**(종료 코드 2 · `--date` 와 같은 규칙) | 둘 다 받을 날짜를 정하는 입력이라 무엇이 이기는지 모호하다 |
| D1-7 「경기 ID 전부(날짜별로 묶어)와 복구 입력 예」 | 경기 ID 를 **전부 날짜별로** 찍고, 복구 입력을 **`refetch_dates=` 한 줄에 `MAX_REFETCH_DATES`일씩** 나눠 찍는다(한 줄 = 수동 실행 한 번) | 예 한 줄만 찍으면 상한을 넘는 날짜가 복구 목록에서 사라진다 |

### C-3. 받아들인 맞교환(M3) — `index` 가 계속 실패하면 그 경기의 box·PBP·roster 도 저장되지 않는다

세트는 「전부 아니면 전무」(G3a)라, **우리가 파싱하지도 않는** `index` 가 계속 실패하면(상류가 그 경기의 試合TOP 만 깨뜨리는 등)
그 경기의 box·playbyplay·roster 갱신이 **계속 보류**된다. 조용히 사라지는 것은 아니다 — ~~매 실행 수집 실패(`실패 N / 보류 N`)로 보인다~~
⚠**그 문장은 수집 창 안에서만 참이다**(부록 D · 3중 검토 2차). 창은 「어제(·오늘) + DB 의 `MAX(game_date) WHERE status='played'` 부터의 따라잡기」라
**다른 경기가 적재되면 창이 그 날짜를 지나간다** — 그 뒤로는 아카이버가 그 경기를 다시 받지 않아 수집 실패도 안 찍힌다.
그 뒤를 받치는 것은 신선도 감시(`scripts/freshness.ts`)의 **「NPB 가 치렀다고 표시했는데 경기 행이 없다」**(`game-missed` · 월간 일정 `schedule_played` · 유예 2일 · 최근 `LOOKBACK_DAYS` 30일)다 —
**처음 받는 경기**(행이 없다)면 30일까지 잡이 실패로 보인다. ⚠**이미 적재된 경기의 정정이 보류된 것**은 행이 있으므로 그 감시도 안 운다 —
창을 벗어나면 **옛 정정 전 값 그대로 조용하다**(되돌림이 아니라 정정 누락이다).
예외 목록 없는 한 규칙을 지키는 쪽을 골랐다. **실제로 일어나면 다시 본다**(예: `index` 를 세트에서 빼되 무결성 대조만 하는 안).

### C-4. 같은 판에 반영한 나머지

- **적재기 성공 처리를 `written` 갈래 안으로**(`packages/store/tools/load-archive.ts` · 실시·미성립 두 경로) — 예전 모양은 `stale`·`invalid-db` 를 걸러
  `continue` 하고 그 **아래**에 성공 처리를 뒀고, 배선 시험은 위치만 봐서 **`continue` 를 지워도 초록**이었다(쓰지 않은 경기의 명단이 선수 표로 흘러간다 · D1-6).
  `packages/store/test/load-archive-wiring.test.ts` 가 이제 `mergeRoster(`·`played += 1`·`notPlayed += 1` 이 `written` 갈래 **안**인지 본다 —
  뮤턴트 5종(옛 모양 · 옛 모양에서 `continue` 삭제 · 각 줄을 갈래 밖으로) 전부 RED.
- 런북 `docs/operations/deploy.md` §7-E: 워크플로 이름(`daily collection`) · 저절로 안 풀린다 · 7일 넘는 복구는 며칠에 나눠 ·
  재수집으로 안 풀리는 본문 불일치 2종 · 완료 기준에 수집 합계(실패 0 · 보류 0).
- `CLAUDE.md` §2-2-1: 「적재가 여는 것」(4장)과 「파싱하는 것」(3장)을 한 문장으로.

## 부록 D. 3중 검토 반영 (2026-09-26 · `fix-archive-load-version-guard` HEAD `6ff58e2` 기준)

배포 전 `shiro-core:triple-review`(1차 · 2차 · 3차 = 다른 벤더)의 발견을 합친 목록과 그 처리다. 한 라운드로 고쳤다.

### D-1. 발견과 처리

| # | 출처 · 심각도 | 무엇 | 처리 |
|---|---|---|---|
| **A1** | 3차 · P1 | **「봤다」의 시각이 기록 시각이었다.** `markSeen` 이 `commitPrepared` 때 `clock.now()` 를 찍었다. 두 아카이버가 같은 아카이브 폴더에서 겹치면(CI 는 `concurrency` 로 직렬이지만 로컬 수동 백필끼리는 겹칠 수 있다 · `sink.ts` 임시 파일 주석이 인정한다) **먼저 옛 내용을 받고 늦게 기록한 쪽**이 가장 새 `checkedAt` 을 찍고, 적재기의 판 가드(box 의 `checkedAt ?? fetchedAt`)가 **옛 내용을 새 판으로 믿는다** | `prepareUrl` 이 **받은 직후** 시계를 한 번 읽어 `Prepared.observedAt`(전 종류)에 싣는다 — `changed` 의 `meta.fetchedAt` 이 같은 값이다. `commitPrepared` 는 `unchanged` 에 `markSeen(…, seenAt = p.observedAt)` 로 그 값을 쓰고 **시계를 다시 읽지 않는다.** `markSeen` 의 새 인자 `seenAt` 은 선택이고 기본은 지금 시계라 `players.ts`·월간 일정(`MonthlyScheduleCache`)은 그대로다. `archiveUrl` 단독 호출자는 `checkedAt`/`fetchedAt` 이 받은 시각이 된다(한 프로세스에서는 기록 시각과 밀리초 차). 시험 `game-set.test.ts` 15(prepare → 시계 5분 흐름 → commit) · 15a(`archiveGame` · 페이지마다 다른 도착 시각). 뮤턴트 ① `unchanged` 를 기록 시각으로 되돌림 · ② `changed` 의 `fetchedAt` 을 기록 시각으로 → 둘 다 **15·15a RED**(14본 중 2본) |
| **A2** | 3차 · P2 | 적재기가 `readGamePages` 스냅샷으로 무결성·세트를 대조한 **뒤** `fetchedAtOf(box.meta.json)` 로 사이드카를 **다시** 읽었다(TOCTOU) — 그 사이 아카이버가 사이드카를 바꾸면 대조한 판과 다른 판의 시각이 판 가드에 들어간다 | 규칙을 `packages/store/src/meta.ts` 의 `seenAtOf(meta: unknown)`(객체 확인 + `normalizeFetchedAt(checkedAt) ?? normalizeFetchedAt(fetchedAt)`)로 뽑고 `fetchedAtOf` 가 그것을 부른다(한 벌 · M1). 적재기는 `seenAtOf(pages.box.meta)` — `null` 이면 예전과 같은 문구로 `failed` 이고 `metaError` 가 있으면 덧붙인다. 시험: `meta.test.ts` 에 두 경로 동치(8 사례) · `load-archive-wiring.test.ts` 에 「`fetchedAtOf(` 0곳 · `seenAtOf(pages.box.meta)` 1곳 · `readGamePages(` → 그것 → `judgeVersion(` 순서」. 뮤턴트(예전 재읽기로 되돌림) → **RED** |
| **A3** | 1차 · P3 + 2차 · F4 | `update.ts` 가 「앞으로의 일정」(`load-upcoming.ts`) 시즌을 **마지막 대상일의 해**로 넘겼다 — `refetch_dates` 로 작년 날짜를 받으면 그 실행은 **올해 일정을 건너뛴다.** 그리고 여러 곳이 그것을 「予告先発 조회 시즌」이라고 잘못 적었다(予告先発 `cli-starters.ts` 은 날짜를 받지 않는다) · D2 의 「`archiveUrl` 단독 호출자(공표표·선수·予告先発)」도 틀린 목록이었다 | 재수집이면 `jstDate(now)` 의 해, 평소는 그대로. 시계는 진입점에서 **한 번**(`const now = new Date()`)이고 수집 창과 같이 쓴다(`clock-injection.test.ts` 의 `update.ts` 허용 1건 그대로). 서술 정정: `scripts/date-window.ts` · `scripts/test/date-window.test.ts` · C-2 표 · D2 · 시험 11(실제 단독 호출자는 `cli-stats` · `draft` · `draft-wiki` — `players.ts`·`starters.ts` 는 자기 `readMeta`) |
| **A4** | 2차 · F3 | `update.ts` 의 재수집 **배선**(검증 함수 호출 · 틀리면 종료 2 · 수집 창 대체 · `--date`/`--today` 충돌)에 시험이 없었다 — import 하면 수집을 시작하는 파일이라 실행 시험을 못 한다 | `scripts/test/refetch-wiring.test.ts` 14b·14c·14d(주석을 걷어낸 소스 정적 대조 · 검증이 첫 `run(` 보다 앞인지까지). 뮤턴트 ① `refetch.dates ??` 삭제 → 14c RED ② 틀린 입력의 `process.exit(2)` 삭제 → 14b RED ③ A3 갈래 삭제 → 14d RED |
| **A5** | 2차 · F5 | 아카이버의 `GAME_PAGES`(`discover.ts`)와 적재기의 `GAME_PAGE_LEAVES`(`page-integrity.ts`)를 묶는 시험이 없었다 — 한쪽에만 페이지를 더하면 세트 밖 페이지가 섞이거나 없는 페이지를 찾는다 | `scripts/test/game-page-leaves.test.ts` — `GAME_PAGES` 를 `pageKey` 자체로 잎 이름에 옮겨 **순서까지** 같은지. 뮤턴트(잎 순서 바꿈) → RED |
| **A6** | 2차 · 가능성 | 배선 시험이 `upsertGame(` 만 봤다 — **자식 행 쓰기**가 `writeGameGuarded(` 콜백 밖으로 나가도 초록(설계가 `WHERE` 만으로 안 된다고 한 바로 그 이유) | `load-archive-wiring.test.ts`: 경기 순회 안의 `replacePaEvents(` · `replaceRunnerEvents(` · `upsertBatting(` · `upsertPitching(` · `replaceQuarantine(` · `DELETE FROM`(정확히 6) · `upsertPlayer(` 가 전부 콜백 안. 뮤턴트 ① `replaceQuarantine(` 을 콜백 뒤로 ② 미성립 경로의 `DELETE FROM pa_event` 를 콜백 앞으로 → 둘 다 **RED** |
| **B1** | 2차 · F2 | 런북 §7-E 가 재수집으로 **안 풀리는** 경우 둘을 빠뜨렸다 — ⑴ index·playbyplay·roster(와 box) 사이드카 **JSON 이 깨짐**: 아카이버 `readMeta` 실패 → 받기 단계 실패 → 아무것도 안 씀 → 영영 안 고쳐짐(적재기 사유 「사이드카 JSON 을 못 읽었다」) ⑵ **잘리거나 깨진 `.gz`** 인데 상류 = 사이드카 sha: 아카이버는 `unchanged`(로컬 본문을 안 연다) → 본문을 다시 안 씀(사유 「본문을 못 풀었다」). 그리고 「이전 세대에서 되살린다」의 **구체 절차**가 없었다 | §7-E 에 안 풀리는 다섯 경우 표 · 세대 복원 절차 ①~⑦(`store-*.tar` 에서 그 경기 폴더만 꺼내 `archive-<이름>.tar` 덧붙임으로 올리고 `refetch_dates` 한 번) · ⚠**덧붙임은 파일을 못 지운다** — 「있던 페이지가 사라졌다」는 「원래 없던 페이지」로 못 바꾸고, 그 페이지가 아직 있는(그리고 box 본 시각이 DB 이상인) 세대에서 되살리는 것뿐이다 · 세대는 최신 3개뿐. §5 표에 두 줄을 더했다 |
| **F1** | 2차 | **탈출구가 없다** — 옛 판·세트·본문 불일치를 사람이 「이번 한 번은 받아들인다」고 넘길 입력이 없어서, 세대 복원으로도 안 풀리면(좋은 판이 세대 3개 밖) 잡이 매일 실패하고 배포가 막힌 채다 | **코드는 바꾸지 않았다** — 사용자가 fail-closed 를 골랐다(§0 결정). 런북의 세대 복원이 유일한 출구다. ⚠「**가드 1회 수용 입력**」(경기 ID 를 지정해 그 경기만 한 번 판 가드를 넘기는 수동 입력)은 **사용자가 정할 열린 결정**으로 남긴다(D-3) |
| C-3 | 2차 · 가능성 | C-3 의 「매 실행 수집 실패로 보인다」는 **수집 창 안에서만** 참이다 — `collectedThrough = MAX(game_date) WHERE status='played'` 가 다른 경기 적재로 그 날짜를 지나가면 아카이버가 그 경기를 다시 안 받는다 | C-3 문구 정정: 그 뒤는 `freshness.ts` 의 `game-missed`(월간 일정 `schedule_played` · 유예 2일 · 30일)가 받치고, **이미 적재된 경기의 정정 보류**는 그것도 안 운다(정정 누락이지 되돌림이 아니다) |
| 되돌림 | 병합 목록 | **배포 뒤 이 가지를 되돌리면** 옛 코드가 바뀐 페이지를 `set` 없이 쓰고, 옛 `markSeen` 은 `{ ...prev }` 라 안 바뀐 페이지의 **이전 `set` 을 그대로 둔다** → 되돌린 동안 바뀐 경기는 재배포 때 「일부만 `set`」으로 **세트 불일치** | 기록만 한다(작다). 수집 창 안의 경기는 다음 실행이 네 장을 새 `set` 으로 다시 적어 풀리고, 창 밖은 `refetch_dates` 한 번 |

### D-2. 안 잰 것

- **CI 아카이브의 2026-08-17 이후 상태**(혼합·옛 판·본문 불일치) — 로컬 아카이브는 2026-08-16 까지다(§1-2 · §6 과 같다). 배포 첫 실행에서 새 세 건수가 0 이 아니면 **이미 일어난 일**이고 런북대로 푼다.
- **수동 재수집 실행의 총 소요 시간 대 `timeout-minutes: 45`**(`daily.yml` 의 `collect` 잡 — 복원부터 배포까지 한 잡이다). 재수집 요청 자체는 7일 상한에서 약 168요청 ≈ 8.4분(D4)이지만,
  그 실행은 적재 전체 · 선수 프로필 재취득 · 빌드 · 배포까지 같이 돈다 — **합계를 안 쟀다.** 첫 재수집은 날짜를 적게 넣고 실행 시간을 보고 늘린다.
- A1 의 겹침 시나리오를 **실제 두 프로세스**로 재현하지 않았다 — 시험은 한 프로세스 안에서 받기와 기록 사이에 시계를 흘려 **계약**(기록되는 시각 = 받은 시각)을 고정한다.
- 런북 복원 절차의 `gh` 단계(①②⑥)는 돌려 보지 않았다 — 워크플로가 쓰는 것과 같은 명령이다. ③⑤의 `tar` 와 ④의 확인 줄은 로컬 아카이브의 경기 폴더 하나로 실행해 확인했다.

### D-3. 열린 결정(사용자)

- **가드 1회 수용 입력** — 세대 복원으로도 못 푸는 경우(좋은 판이 최신 세대 3개 밖 · 상류가 페이지를 지웠고 남은 세대에 새 판이 없음)의 출구. 지금은 없다(fail-closed · F1).
- 세대 보관 수(`KEEP=3`)를 늘릴지 — 늘리면 복원 가능한 기간이 길어지고 보관소가 커진다(세대 하나 수백 MiB).

### D-4. 이 판에서 고친 설계 본문

§3 본 시각 · D1-2(스냅샷에서) · D2(`observedAt` · 단독 호출자 목록) · §5 표(깨진 사이드카 · 깨진 `.gz` · 겹친 아카이버) · 시험 11 · C-2 표 · C-3.

### D-5. 검증(2026-09-26 · 로컬 · 코드 커밋 `a3fe7cc`)

- 관련 시험 15파일(archiver 4 · store 6 · scripts 5 — 새 파일 `game-page-leaves.test.ts` 포함) **158 중 158 통과** · FAIL 0 · ERROR 0 · skip 0
  (`load-archive-guard.test.ts` 는 로컬 `data/archive` 가 있어 건너뛰지 않고 돌았다).
- `npm run typecheck` 종료 0.
- `npm test` 전체 **2,874 중 통과 2,873** · FAIL 0 · ERROR(cancelled) 0 · skip 1(`石井大智` 공표값 대조 — 데이터 조건부 · 기준선과 같다).
  기준선(`6ff58e2`) 2,865 에서 +9 = 15·15a · `seenAtOf` 동치 · 배선 2 · 14b·14c·14d · 페이지 목록 1.
- 뮤턴트: A1 2종 · A2 1종 · A4 3종 · A5 1종 · A6 2종 — **전부 RED** 확인 후 되돌렸다.
