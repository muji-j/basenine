# 수집 견고화 PR-2a — 상류 장애를 「받기 실패」로 가르고 이미 받은 데이터로 배포한다 — 설계

- 날짜: 2026-10-24 · **5판(4차 리뷰 반영 · 설계 마지막 판)** · 설계만 — 코드는 다음 단계. 기준: HEAD `535210a`(PR-1 위 · `freshness.ts` 변경은 연례 `::warning::` 뿐이라 겹치지 않는다)
- 사용자 결정(2026-10-24): **① npb 차단은 원인 확인 우선**(원인 기록 · 회로 차단 · 연결 시간 상한 · 러너에서 진단 · 의도적 차단이면 **우회하지 않고 다시 상의**) **② 「받기만 실패」면 배포한다**(경보와 신선도 띠는 유지 · 적재·파싱·시험 실패는 지금처럼 막는다)
- 조정자 결정(채택): 연결 30초 + `undici@7.29.0` 직접 의존(락에 같은 버전이 이미 있다) · 추가 진단 요청 없음 · 회로 정시 3 / 재시도 슬롯 1.
- 이력: 1차 콜드 리뷰(조건부 9건) → 2차(불가 8건) → 3차(불가 6건)로 **문서가 107KB 로 자라며 본문끼리의 모순이 새로 생겼다.** 그래서 4판은 **사용자 결정 ①②에 꼭 필요한 것만** 남기고 나머지는 §9 로 미뤘다(루트 §4 — 지원 작업이 제품보다 커지지 않게).
- 개발 순서: PR-1(시험 13본 · `career-lag`)이 먼저 머지돼야 이 배포 정책이 실제로 열린다(시험이 붉으면 `success()` 가 막는다).

## 0. 콜드 리뷰에 대한 답 (코드는 `535210a` 와 대조)

### 4차 (9건 P1 3 · P2 4 · P3 2 — 조정자 결정대로 모두 고침)

| # | 지적 | 답 |
|---|---|---|
| 4차-1 P1 | 90초 단일 신호와 「홉 대기는 신호 밖」·T4 가 양립하지 않는다 | **고침** — **단일 90초 마감을 없앴다.** 상한은 홉마다 undici `Agent` 옵션(연결 30 · 헤더 30 · 본문 유휴 30)뿐. 시도 최악 = `(1+MAX_REDIRECTS) × 90 + 슬롯 대기` 식·숫자와 30분 단계 제한 재확인은 D3. T4 는 홉별 상한 시험 |
| 4차-2 P1 | 회로에 안 세는 비재시도 4xx 가 있으면 요청 상한이 안 선다 | **고침** — 404·410 을 뺀 **모든 비성공은 `UpstreamError` 이고 전부 회로에 센다**(D1 표 · 상한 논증 D4) |
| 4차-3 P1 | freshness reasons 파일의 형식·시점·원자성이 없다 | **고침** — `{schema:1, exit, reasons[]}` · `.tmp-<pid>`+rename · spawn 전 삭제 · exit≠0 인데 파일 없음/깨짐/스키마 다름 = blocking(D5) |
| 4차-4 P2 | T9 「5경우 모두 메시지 1개」는 표와 안 맞는다 | **고침** — rc==75 이고 취소가 아니면 정확히 1개(A 또는 B) · 취소와 rc≠75 는 0개 |
| 4차-5 P2 | 「하루 48요청」은 수동·재실행을 안 센다 | **고침** — 정시 3 + 재시도 3 = 6실행 기준이라 밝히고 수동·재실행은 실행마다 +상한(D4) |
| 4차-6 P2 | 예외 → `kind` 매핑 규칙이 없다 | **고침** — D1 에 우선순위 표 하나 |
| 4차-7 P2 | 「한도를 올린 뒤 성공」으로 H2 를 입증한다고 썼다 | **고침** — H2 와 **정합할 뿐 입증이 아니다**(D3) |
| 4차-8 P3 | 400자 규칙이 긴 URL/경계에서 400자를 못 지킨다 | **고침** — 조립한 메시지가 400자를 넘으면 **397자에서 자르고 `…`**, URL·detail 은 각 120자 상한(D2) |
| 4차-9 P3 | 300초 기본값을 npm `undici@7.29.0` 으로 확인했다고 인용 | **고침** — 기준 코드는 Node 내장 fetch(Node v24.18.0 의 `process.versions.undici` = **7.28.0**)다. 300초는 npm 7.29.0 소스(`client.js:261-262`)로 확인한 값이고 내장 7.28.0 소스는 직접 안 봤다 → **미확인**으로 표기. 7.29.0 직접 사용은 이 PR 의 변경(§1) |

### 3차 (6건)

| # | 지적 | 답 |
|---|---|---|
| 3차-1 P1 | tally 분류(D12)가 D1 의 UpstreamError 규칙과 충돌 | **축소로 해소** — tally·run-verdict·D12 를 PR-2a 에서 뺐다(§9). 상태→동작은 D1 의 표 한 장뿐이다 |
| 3차-2 P1 | 「실패 뒤 이후 단계 skip」이 실제 `always()` 경로와 다르다 | **맞다 · 고침** — D6 에 실제 `daily.yml` 의 단계 전부를 rc 0/75/1 별로 표로 닫았다(`always()` 3곳 · `!cancelled()` 1곳 · `failure()\|\|cancelled()` 2곳 보존) |
| 3차-3 P1 | 다음 달 일정의 상류 실패가 종료 코드에 영향이 없어 fetch-only 실패가 녹색이 된다 | **맞다 · 고침** — 다음 달 일정의 `UpstreamError` 는 **75 에 포함**한다. 404/410 은 지금처럼 사실(꼬리표만 · 종료 코드 무영향)(D1·D4) |
| 3차-4 P2 | `beforeConnect` 부재가 「재사용」과 「계측 불가」를 동시에 뜻한다 | **축소로 해소** — diagnostics_channel 계측을 뺐다(§9). H1/H2 한계는 D3 에 정직하게 적었다 |
| 3차-5 P2 | run-verdict 가 stats·correction 요청을 포함하지 않는다 | **축소로 해소** — run-verdict JSON 을 뺐다(§9). 판정은 `update.ts` 한 프로세스 안에서만 쓰이고 파일로 남기지 않는다 |
| 3차-6 P2 | 메시지 600자 절단 규칙이 없다 | **맞다 · 고침** — 결정적 규칙 하나(D2): 전체 400자 · 넘으면 397자에서 자르고 `…`(4차-8 로 `…외 N건` 방식을 대체) · 마지막 원인은 목록 앞에 따로 둬서 항상 남는다 |

1·2차에서 반영한 것 중 **그대로 남는 것**: 정정 경로는 0\|1 계약 유지 · `rc==75` 면 건너뜀(D6) / 맨 끝 요약 단계 먼저 · 의도적 실패 단계 나중(D6) / I3 의 `continue-on-error` 세 예외 열거(D6) / 시간 상한은 홉마다 undici 옵션(D3 · 4차-1 로 단일 90초 마감은 폐기) / `UpstreamError` 는 fetcher 만 만들고 거기서만 센다(D1) / `수집·적재` 단계 제한을 33 → 30분으로 내림(D7). **미룬 것으로 사라지는 2차 지적**: 자동 날짜 상한(`--dates` 를 도입하지 않는다) · 상태 파일 fail-closed(상태 파일이 없다) · 네트워크 마감 `NET_DEADLINE_MIN`.

## 1. 사고와 실측 (분모·출처)

- **원인 정보 0건.** 최신 실패 실행 `40044974431`(10/24 00:26Z): 14 URL(월간 일정 12 + 선수 1 + 예고 1) × 4시도 = **56시도** · `update.ts` **22분 5초** · 끝 줄 `⚠실패 단계 9건` = 날짜 6 + 선수 1 + 예고 1 + 신선도 1 — 받기 실패 8건과 신선도 1건이 한 숫자로 섞인다. `fetcher.ts:262` 가 `cause` 를 붙이지만 메시지에는 안 넣고 호출자 6곳(`archive.ts:181·389`·`cli.ts:118`·`players.ts:176`·`starters.ts:77`·`draft.ts:274`)은 `err.message` 만 찍는다.
- **시도 하나 10.5초 = 연결 시간 초과의 지문.** 조정자 실측 URL 당 87.0±0.05초 = 4×10.5 + 백오프 45(3+6+12+24). 이 PC(Node v24.18.0)에서 응답 없는 주소(`192.0.2.1:443`)에 `fetch` 1회 → **10,685ms** 에 `ConnectTimeoutError{code:'UND_ERR_CONNECT_TIMEOUT', message:'…attempted address: 192.0.2.1:443, timeout: 10000ms'}`. ⚠시행 1회 · 일치일 뿐 증명이 아니다 — 즉시 끝나는 RST·403·TLS 오류를 **배제**할 뿐이다.
- **평소 경로에 시간 상한이 없다.** `fetcher.ts` 의 `request()` 는 `signal`·dispatcher 가 없고 **Node 내장 `fetch`** 를 쓴다(Node v24.18.0 의 `process.versions.undici` = **7.28.0**). 연결 10초는 이 PC 실측(10,685ms)이 보였고, 헤더·본문 대기 각 300초는 npm `undici@7.29.0` 소스(`lib/dispatcher/client.js:261-262`)로 확인한 기본값이다 — **내장 7.28.0 의 소스는 직접 안 봤으므로 같은 값이라는 것은 미확인**이다. npm `undici@7.29.0` 을 직접 쓰는 것은 **이 PR 의 변경**이다(D3).
- **회로가 없다.** 정정 경로(`refetch-games.ts`)만 가진다. 평소 경로는 실패 중에도 하루 약 250~340시도(조정자 집계)를 보냈고, `update.ts` 가 날짜마다 `cli.ts` 를 띄워 같은 월간 일정 URL 이 날짜 수만큼 87초씩 반복됐다.
- **job 시작 → `수집·적재` 시작**: 23.3 · 20.8 · 36.6 · 18.9초(4실행 · 최대 0.61분). **`update.ts` 로컬 구간**(10/21 09:49Z): `DB 적재` 103.7초 + 나머지 8.5초 ≈ 2.0분. **후속**: 정정 설계 D7-8 의 11.43분(M-J 최장).
- **장애 중 감시**: 최신 CI DB 사본에 실제 `collectionVerdict` 를 7일 돌리면 `game-missed` 는 **0/7일** 울고 `career-lag`·`starters-*` 가 울었다(`career-lag` 는 PR-1 이전 DB 기준 — 이후 규칙에서는 장애 중 경기가 없으면 안 울 수 있다). 장애 중 띠의 정직함은 예고 맥박이 맡는다.

## 2. 목표와 비목표

**목표**: ① 상류 받기 실패만 있는 실행은 이미 받은 데이터로 배포하고 **붉게** 끝낸다 ② 다음 정시 실행 한 번의 로그로 원인 가설을 가른다 ③ 장애 중 요청을 하루 250~340 → ≤ 48시도(자동 예약 6실행 기준 · 수동·재실행은 실행마다 +상한 — D4)로 줄인다.
**비목표**: 차단 우회(금지) · 크론 지연 · 비시즌 단계 B·C · 따라잡기(§9) · 관측 JSON(§9).

## 3. 불변식

| # | 불변식 |
|---|---|
| I1 | 받기는 아카이브에 온전한 것만 쓴다(경기 4장은 세트 · 하나라도 실패하면 안 씀 — `archiveGame`). 받기 실패는 데이터를 바꾸지 않는다 |
| I2 | DB 는 매 실행 아카이브 전체의 적재 결과다 — 받기가 실패해도 DB 는 「검증된 아카이브」의 함수다 |
| I3 | **`continue-on-error` 가 없는 단계의 실패는 배포를 막는다.** 예외는 지금 `continue-on-error: true` 인 **세 단계뿐**이고 이 설계는 바꾸지 않는다(D6 표) |
| I4 | 모르면 막는다(M11) — 분류·판정 입력을 못 읽으면 blocking |
| I5 | 경보는 사라지지 않는다 — 상류 장애 실행은 붉게 끝나고(실패 메일 · 하트비트 24시간) 띠는 낡음을 말한다 |

## 4. 설계

### D1. 실패 분류 — `UpstreamError` 한 타입, 만드는 곳 한 곳(fetcher)

`packages/archiver/src/upstream.ts`(신규 · import 0개): `UpstreamError{ kind, url, attempts[], status }`, `ScheduleAbsentError`, `EXIT_UPSTREAM_ONLY = 75`, `exitCodeFor(results)`.
**호출자는 `UpstreamError` 를 만들지도 세지도 않는다** — `fetcher.getUnqueued` 가 터미널 비성공을 **던지고**(재시도 루프 밖에서) 회로 계수도 그 자리 한 곳이다.

| 상황 | fetcher 결과 | 회로(프로세스 안) | `errorKind` |
|---|---|---|---|
| 2xx · 304 | 응답 반환 | 연속 소진 리셋 | — |
| **404 · 410** | 응답 반환(사실 · 지금처럼) | 리셋 | — |
| 408·425·429·5xx / 네트워크·타임아웃 | 재시도(최대 3회) 후 소진 시 `UpstreamError` | 연속 +1 · 합계 +1 | upstream |
| 3xx 종결(타 출처 · 읽을 수 없는 `Location` · 홉 > 3) | `UpstreamError(http-<3xx>)` 즉시 | 연속 +1 · 합계 +1 | upstream |
| **그 밖의 모든 4xx**(400·405·401·403·451…, 404·410 제외) | `UpstreamError(http-<status>)` 즉시(재시도 없음) | 연속 +1 · 합계 +1 · **401·403·451 은 즉시 열림** | upstream |
| 회로 열림 | `UpstreamError(circuit-open)` — 요청 0 | 불변 | upstream |
| `readMeta`/쓰기 예외 · `discoverGames` 구조 예외 · 현재 달 `ScheduleAbsentError` | (fetcher 밖) | — | **local** |

- **`kind` 매핑(순수 함수 `classifyFetchCause` · 위에서부터 처음 맞는 것)**: ⑴ HTTP 응답이 있었다 → `http-<status>` ⑵ 오류(또는 `cause`, `AggregateError` 면 `errors[0]`)의 `code` 가 아래 표에 있다 → 그 kind ⑶ 그 밖 → `network`(`code`/`name` 은 그대로 기록). 우리는 `AbortSignal` 을 쓰지 않으므로 시간 초과는 전부 undici 코드로 온다(D3).

| `code` | kind |
|---|---|
| `UND_ERR_CONNECT_TIMEOUT` | `connect-timeout` |
| `UND_ERR_HEADERS_TIMEOUT` | `headers-timeout` |
| `UND_ERR_BODY_TIMEOUT` | `body-timeout` |
| `ECONNRESET` · `ECONNREFUSED` · `ENOTFOUND` · `EAI_AGAIN` · `ETIMEDOUT` · `EPROTO` · `UND_ERR_SOCKET` · `ERR_SSL_*` · 모르는 코드 | `network` |

- 호출자 판정은 `instanceof UpstreamError` 하나다: `prepareUrl`·`players.ts`·`starters.ts` 의 바깥 `catch` 는 받기와 쓰기를 같이 덮으므로 `UpstreamError` 만 `upstream`, 나머지는 `local`. `PageResult`·`DayError` 에 `errorKind` 를 더한다. 호출자의 `res.body === null` 갈래(2xx/304 가 아닌 것은 도달 불가)는 방어용 `local`.
- `MonthlyScheduleCache.load` 는 404/410 에서 `ScheduleAbsentError` 를 던진다(회로는 fetcher 가 이미 성공으로 셌다).
- **종료 코드 `exitCodeFor(results)`**: 실패 0건 → 0 · 실패가 있고 **전부 `upstream`** → **75** · 하나라도 `local`/미분류 → 1. **75 계약은 `update.ts` 가 spawn 하는 받기 자식 세 개(`cli.ts` · `cli-players.ts` · `cli-starters.ts`) 뿐**이다. `cli-stats.ts`(`continue-on-error` 단계) · `cli-draft.ts` · `cli-draft-wiki.ts`(사람이 연 1회 로컬) · `cli-games.ts`(정정 경로 — `FetchResult.exit`·`readFetchResult`·`stepExitCode` 가 `0|1` 계약이다)는 **0/1 그대로**이고 메시지(D2)·회로(D4)만 공통으로 받는다.
- **다음 달 일정**(`cli.ts` 끝의 best-effort 취득): `UpstreamError` 는 **upstream 실패로 세어 75 에 포함**한다(조용히 녹색이 되지 않게 · 3차-3). `ScheduleAbsentError`(404/410)는 꼬리표 「（오프시즌이면 정상）」만 붙이고 종료 코드 무영향. 그 밖의 예외는 지금처럼 경고만(무영향 · 현행 유지).

### D2. 원인 기록 — 소진 메시지를 결정적으로

`취득 실패 (재시도 N회 소진): <url> — 마지막 원인 <kind>[<code|status>] <detail> · 시도 1:<code|status> <ms>ms 2:<…> …`
- 앞 구절 `취득 실패 (재시도 N회 소진)` 는 글자까지 유지(검색 호환).
- `<code|status>` = HTTP 상태, 아니면 `err.code ?? cause.code ?? cause.errors?.[0]?.code ?? err.name`(`AggregateError` 는 첫 원소). `<detail>` = 마지막 원인의 `message` 앞 120자(undici `ConnectTimeoutError` 메시지가 `attempted address:… timeout: …ms` 를 싣는다 — 시험이 이 메시지에서 주소가 나오는지 고정). `<ms>` = 그 시도의 경과.
- **길이 규칙(결정적 · 단위는 JS `string.length`)**: `<url>` 은 120자를 넘으면 앞 119자 + `…`, `<detail>` 도 120자 상한. 앞부분(`…<detail>`)의 최악은 약 35 + 120 + 50 + 120 ≈ 330자라 **마지막 원인은 항상 397자 안에 든다.** 시도 항목은 앞에서부터 전부 붙이고, **조립한 전체가 400자를 넘으면 397자에서 자르고 `…` 를 붙인다**(시도 목록의 꼬리만 잘린다).
- `cause` 는 그대로 붙인다. 6개 호출자는 `err.message` 를 찍으므로 코드 변경 0.
- 빼는 것(§9): server 헤더 · phase 분류 · DNS 조회 · family · 성공 요청 연결 계측.

### D3. 시간 상한 — 홉마다 연결 30 · 헤더 30 · 본문 유휴 30초

`PoliteFetcher` 기본 `fetchImpl` 만 바꾼다(주입된 것은 그대로): `undici` 의 `fetch` + `Agent({ connect:{timeout:30_000}, headersTimeout:30_000, bodyTimeout:30_000, connections:1 })`. `@bb-app/archiver` 가 `undici@7.29.0` 을 정확히 같은 버전으로 직접 의존한다(락의 `package-lock.json:1598` 에 이미 있다 · 새 tarball 0 · `dev` 플래그만 바뀐다).
- **상한은 홉마다 undici 옵션뿐이다**(4차-1 — 이전 판의 「시도 전체 90초 단일 `AbortSignal`」은 폐기: 홉 사이 슬롯 대기를 신호 밖에 두면서 전체를 90초로 검사하는 것이 양립하지 않았다). 우리는 `AbortSignal` 을 쓰지 않으므로 시간 초과는 전부 undici 오류 코드(`UND_ERR_CONNECT_/HEADERS_/BODY_TIMEOUT`)로 오고 단계가 코드에 담긴다.
- **한 시도(재시도 루프의 한 바퀴)의 최악** = `H × (연결 30 + 헤더 30 + 본문 유휴 30) + H × 슬롯 3`, `H = 1 + MAX_REDIRECTS = 4` → `4×90 + 12 = 372초`(상계 — 리디렉션 홉은 본문을 읽지 않으므로 실제 상계는 이보다 작다). URL 하나(4시도 + 백오프 3+6+12+24 = 45)의 최악 = `4×372 + 45 = 1,533초`.
- **실패 모양별 계산 · 30분 단계 제한(D6) 재확인** (선행 0.61분 실측 + 로컬 2.0분 포함 · 회로 N=3 연속 소진으로 자식이 끝남):

| 모양 | 시도 | URL 하나 | N=3 | 단계 안 최악(+2.6분) | 30분 안? |
|---|---|---|---|---|---|
| A 연결 단절(**관측**) | 30 | 4×30+45 = **165초** | 8.3분 | 10.9분 | 예 |
| B 연결 성공 뒤 무응답 | 30+30 = 60 | 4×60+45 = 285초 | 14.3분 | 16.9분 | 예 |
| C 본문 유휴 정지 | 90 | 4×90+45 = 405초 | 20.3분 | 22.9분 | 예 |
| D 리디렉션 홉마다 정지(이론) | 372 | 1,533초 | 76.7분 | — | **걸쇠가 죽임** → blocking(지금과 같다 · 관측된 적 없다) |
| A·B 의 간헐 장애(합계 한도 6까지) | | | 6×165 = 16.5 / 6×285 = 28.5분 | 19.1 / 31.1분 | A 예 · B 는 걸쇠 경계 |

단계 제한 식은 그대로다: 선행 1.0 + 30 + 0.4 + 후속 11.43 = **42.83 ≤ 43.5**(걸쇠가 있으면 위 모양과 무관하게 성립). 걸쇠가 풀리면 `rc` 출력이 없어 blocking(배포 없음 — 지금의 장애 모양과 같다). 절대 상한(네트워크 마감)은 §9.
- **왜 10 → 30초인가**: 10초 한도는 undici 기본값이 우연히 막은 것이고 그 값에서는 「수락이 느린 호스트」와 「SYN 을 버리는 호스트」가 둘 다 10.5초 실패로 보인다. TCP 는 SYN 이 지워지면 1·3·7·15초 뒤에 재전송한다(일반 동작 · 러너 커널 설정 **미확인**) — 30초는 다섯 번째 SYN(15초)의 응답까지 담는다. 이 PC 연결 1.4~9.1초(3/3)는 이미 10초에 가깝다. 우회가 아니다(요청 수 불변 · 더 오래 기다릴 뿐).
- **가설을 가르는 법과 그 한계** (D5 로그 `시도 n:<code> <ms>ms` 로 읽는다 · diagnostics 계측은 뺐다):

| 로그 | 읽는 법 |
|---|---|
| 모든 시도가 `UND_ERR_CONNECT_TIMEOUT` · 약 30,0xx ms · 성공 0 | **H1(SYN 폐기)** 쪽. 연결 30초 안에 응답이 없다 |
| 장애가 풀렸다(성공이 돌아옴) — 한도 상향 뒤 | **H2(수락 지연)와 정합할 뿐 입증은 아니다**(4차-7) — 「timeout 상향 후 회복했으나 계층 미확정」. 같은 시각의 우연한 회복·경로 복구와 구별하지 못한다. 성공한 연결의 시간은 소진 메시지가 없어 못 본다 — 프로세스의 첫 성공 `get` 의 헤더까지 ms 를 CLI 합계 줄에 한 번 찍는다(새 연결+TTFB 합 — 연결만 가르지 못한다). **accept 지연이라는 단정은 연결 단계 시간을 따로 재거나 통제된 동일 조건 비교가 있을 때만**(§9 의 diagnostics 계측) |
| `http-403`·`http-429`·`http-503` 등 | H3(HTTP 계층 거절) · 연결은 즉시 성공 |
| 즉시(<1초) `ECONNRESET`·`ENOTFOUND`·`EPROTO` | H4(RST·DNS·TLS) |

⚠**못 가르는 것**: H1 이 「러너 대역만 막힘」인지 「경로 장애」인지 · H2 에서 10~29초 구간의 분포. 더 가르려면 추가 요청이 필요하고 사용자 결정 ①이 막는다. 의도적 차단 정황(403/429/451 + 차단 본문, 또는 30초 소진이 정시 3회·24시간 연속 + 성공 0이고 사용자 PC 는 성공)이 보이면 **우회하지 않는다** — 프록시·UA 위장·다른 이그레스 금지, 사용자와 상의(L4: 확정은 사용자가 한다). 요청을 완전히 멈추는 스위치는 §9.

### D4. 회로 차단 — 상태 파일 없이, 프로세스 안 + 부모의 중단

1. **자식 안(프로세스 단위)**: `HostCircuit`(`circuit.ts` 신규 · 시계 주입). 연속 소진 **N**(정시·수동 3, 재시도 슬롯 1 — 워크플로가 env `BB_NPB_CIRCUIT_N` 으로 준다) **또는** 합계 소진 6 이면 열려 남은 `get()` 이 요청 0 으로 `circuit-open`. 401·403·451 은 즉시 열림. **404·410 을 뺀 모든 비성공은 연속 +1 · 합계 +1 로 센다**(4차-2). 성공(404·410 포함)은 연속 카운터를 리셋. 자식은 끝까지 돌고 종료 코드 `exitCodeFor` (실패가 있으면 75).
2. **부모(`update.ts`)**: 받기 자식이 **75 로 끝나면 그 뒤의 받기 자식을 띄우지 않는다**(로그 `상류 실패 — 이후 받기 건너뜀 <단계>` · 합성 step 으로 기록). 로컬 자식(적재 · emit · freshness)은 **계속 돈다**.
3. **상한 논증**: 첫 상류 실패 자식 이후 받기 자식 0. 그 자식 안에서 `UpstreamError` 로 끝나는 `get()` 은 어떤 상태 조합이든(404·410 만 제외하고 전부 센다) 연속이면 ≤ N(3 또는 1), 간헐이어도 합계 한도 6에서 열린다. → **실행 전체 소진(`UpstreamError` 로 끝난 `get()`) ≤ 6**(연속 장애 3, 재시도 슬롯 1). 요청 수는 `get()` 하나당 소진 유형별로 다르다: 재시도 대상은 ≤ 4시도(× 홉), 비재시도 4xx·3xx 종결은 1시도 — 그래서 아래 시도 수는 **재시도 대상(관측형 A)** 기준이다. 시간은 D3 표.
4. **받기 순서**: 예고(予告先発)를 **맨 앞**으로 옮긴다 — 거르면 영영 못 받는 유일한 요청이고, 현재 순서에서는 경기 단계의 소진이 부모를 멈춰 받을 수 있던 예고를 건너뛴다. 정상일 때는 로그 순서만 바뀐다.
5. **날짜별 spawn 은 그대로 둔다**(`--dates` 묶음은 §9). 대신 첫 날짜 자식이 소진으로 75 가 되면 부모가 나머지 날짜 자식을 안 띄우므로 같은 URL 의 반복은 사라진다.

**요청량(분모)**: 지금 `40044974431` **56시도**(14 URL) → 연속 장애 정시 ≤ **12시도**(3 URL × 4, 첫 자식 안) · 재시도 슬롯 ≤ **4시도**. **자동 예약 6실행(정시 3 + 재시도 슬롯 3)만 센 하루 상한** ≤ 3×12 + 3×4 = **48시도**(−81~86%) — 수동 실행·「실패한 잡 다시 실행」은 **실행마다 +12시도(재시도 슬롯 모드가 아니면)** 로 따로 더해진다(하루 전체 상한이 아니다 · 프로세스 간 공유 카운터가 없다 — §9 상태 파일). 받기 시간은 22분 5초 → 연결 단절형 ≤ 8.3분(165초 × 3).

### D5. 배포 정책 — `update.ts` 종료 0 / 75 / 1

`scripts/run-verdict.ts`(신규 · 순수 · 시계/I/O 없음) `classifyRun(steps, freshReasons)`. 모든 자식 실행은 `execStep(id, group, args)` 한 헬퍼로 모은다 — 기준 `update.ts` 는 `run()` 밖에서 직접 `spawnSync` 가 셋(`emit-stale-player-ids` · `emit-player-ids` · `freshness`)이라 구현이 `failures` 만 지우면 emit 실패가 판정에서 사라진다. `status===null`·signal·시간 제한은 1 로 정규화.

| 규칙 | 조건 | 결과 |
|---|---|---|
| R1 | `group ∈ {load, emit}` 이고 `exit ≠ 0` | blocking |
| R2 | `group = fetch` 이고 `exit ∉ {0, 75}` | blocking |
| R3 | `group = fetch` 이고 `exit = 75`(건너뛴 합성 step 포함) | upstream |
| R4 | `group = freshness`: `exit = 0` → 파일 불필요(무시) · `exit ≠ 0` → 아래 「사유 파일 계약」으로 읽는다: 읽기 실패 → blocking · **`no-games` 포함 → blocking** · 그 밖: **upstream 이 1건 이상이면 explained**, 아니면 blocking | |
| R5 | blocking ≥ 1 → **1** · 아니면 upstream ∪ explained ≥ 1 → **75** · 아니면 **0** | |

**사유 파일 계약**(4차-3): `freshness.ts --reasons-out <path>`(`update.ts` 가 `data/freshness-reasons.json` 으로 부른다). 스키마 `{"schema":1,"exit":<0|1>,"reasons":["career-lag",…]}` — 키는 `@bb-app/domain` 의 `STALE_REASON_KEYS` allow-list. **쓰는 쪽**: 종료 **직전**에 `<path>.tmp-<pid>` 로 쓰고 `rename`(원자적) — 정상(`exit:0`)일 때도 빈 `reasons` 로 쓴다. 쓰기 실패는 stderr 한 줄 + 종료 코드 **2**(1 이 아님 → 읽는 쪽에서 blocking). **읽는 쪽(`update.ts`)**: spawn **전에** 파일을 지우고(이전 실행의 것을 읽지 않는다), 끝난 뒤 — `exit 0` 이면 파일을 안 본다 · `exit 1` 인데 파일 없음/JSON 깨짐/`schema≠1`/파일의 `exit≠1`/allow-list 밖 키/`reasons` 가 비어 있음 → **blocking(로컬 실패)** · 유효하면 중복을 제거하고 아래 사유 표로 분류 · `exit ∉ {0,1}`(예: 2 = 표 없음) → 파일과 무관하게 blocking.

**신선도 사유 → 「상류 장애로 설명되는가」 (표 하나로 닫는다 · upstream 실패가 같은 실행에 있을 때만)**

| 사유 | 설명되나 | 이유 |
|---|---|---|
| `starters-behind` · `starters-lag` | 예 | 예고 취득이 실패했다 — 직접 결과 |
| `game-missed` | 예 | 월간 일정/박스 취득 실패의 결과(증거는 장애 중엔 맹목이기도 하다) |
| `career-lag` | 예 | 선수 페이지 취득 실패의 직접 결과. ⚠**조정자 지시(`career-lag` 등은 blocking)에서 벗어난다** — 이것을 blocking 으로 두면 경기가 이어지는 시즌 중 장애에서 4일 뒤부터 배포가 다시 막혀 사용자 결정 ②(받기 실패면 배포)를 깬다. 상류 실패 **없이** 울면 blocking 이라 PR-1 이 고친 헛경보 유형은 여전히 막힌다 |
| `game-lag`(백스톱 45/200일) | 예 | 장기 장애의 끝 단계 — 그래도 띠·붉은 실행·하트비트는 남는다 |
| `no-games` | **아니오** | DB 에 경기가 없으면 배포할 것이 없다 |

대가: 상류 실패와 수집 결함이 같은 실행에 겹치면 결함은 한 실행 늦게 드러난다 — 실행은 붉고 배포되는 것은 검증된 옛 데이터라 지연이지 오염이 아니다.
`update.ts` 마지막 줄은 `blocking N · 상류 M · 설명된 신선도 K` 로 가르고 종료 코드는 R5. **빌드의 `stale`(`packages/web/tools/build.ts:440-443`)**: `BB_UPSTREAM_OUTAGE=1` 이면 경고 한 줄만 · 종료 코드 불변. 그 밖의 `exitCode=1` 갈래는 건드리지 않는다. 값은 워크플로가 `rc == '75'` 일 때만 `1` 로 넘긴다.

### D6. 워크플로 — `daily.yml` (HEAD 의 단계 전부)

`수집·적재` 만 75 를 0 으로 통과시키고 출력 `rc` 를 남긴다. 나머지 단계의 `if:` 는 **고치지 않는다**(받기를 하는 두 단계 — 공표 성적표 갱신 · 정정 — 만 `rc != '75'` 를 더한다).

```yaml
- name: 수집·적재
  id: update
  timeout-minutes: 30
  env: { BB_ARCHIVER_CONTACT: …, BB_REFETCH_DATES: …,
         BB_NPB_CIRCUIT_N: ${{ needs.decide.outputs.slot == 'retry' && '1' || '3' }} }
  run: |
    set +e; node scripts/update.ts --max-writes 5000000; rc=$?; set -e
    echo "rc=${rc}" >> "$GITHUB_OUTPUT"
    case "$rc" in 0) ;; 75) echo "::warning::npb.jp 받기 실패만 있었다 — 이미 받은 데이터로 배포한다" ;; *) exit "$rc" ;; esac
```
`timeout-minutes: 30` = 걸쇠. 식: 선행 1.0(실측 최대 0.61) + 30 + 0.4 + 후속 11.43 = 42.8 ≤ 45 − 1.5 = 43.5. 이전 판의 33 은 44.8 이라 틀렸다. 정상 최악(전원이 낡은 날 선수 재취득 400건 ≈ 24분)은 30 안이다. 걸쇠가 풀리면 `rc` 출력이 없어 blocking.

**모든 collect 단계의 실행 조건** (e842915 와 HEAD 동일 · `[coe]` = `continue-on-error: true`):

| 단계 | 조건 | rc=0 | **rc=75** | rc=1·2·크래시·걸쇠 | 취소 |
|---|---|---|---|---|---|
| job-start · checkout · setup-node · npm ci · L6 확인 · 아카이브·DB 복원 · 복원 검증 | (없음) | 실행 | 실행(update 앞) | 실행(update 앞) | — |
| 드래프트 원본 복원 `[coe]` | (없음) | 실행 | 실행(update 앞) | 실행(update 앞) | — |
| **수집·적재** | (없음) | 0 | 0 으로 통과 | 실패 | 취소 |
| 드래프트 적재 `[coe]` | `success()` | 실행 | 실행 | skip | skip |
| 공표 성적표 갱신 `[coe]` | `success() && rc != '75'` (**변경**) | 실행 | **skip**(장애 중 30요청을 또 두드리지 않는다 · `외부 대조` 는 옛 스냅숏으로 돈다) | skip | skip |
| **정정 감지 · 자동 재수집** | `success() && rc != '75'` (**변경**) | 실행 | **skip** | skip | skip |
| 수집 후 재검증 | `always()` | 실행 | 실행 | **실행** | 실행 |
| 보관소에 올림 | `always() && guard 성공` | 실행 | 실행 | **실행** | 실행 |
| 기록 갱신과 커밋 | `always()` | 실행 | 실행 | **실행** | 실행 |
| 파서 자기검증 · 득점 대조 · 외부 대조 · 화면 생성(`BB_UPSTREAM_OUTAGE` env **추가**) · 서체 · 픽스처 복원 · 시험 | `success()` | 실행 | 실행 | skip | skip |
| S1 확인 · Access 설정 확인 · 배포 | `success()` | 실행 | 실행 | skip | skip |
| 배포 반영 확인 | `!cancelled()` | 실행 | 실행 | **실행** | skip |
| 산출물 목록 만들기 · 보관 | `failure() \|\| cancelled()` | skip | skip(앞이 성공이면) | **실행** | 실행 |
| **A 요약**(신규) `failure() && rc=='75'` | | skip | 앞 단계 실패가 있을 때만 | skip(rc≠75) | skip |
| **B 의도적 실패**(신규) `success() && rc=='75'` | | skip | **앞 단계 전부 성공일 때 실행 → `exit 1`** | skip | skip |

- 굵은 「실행」 = **부분 수집분 보존 · 운영 기록 · 반영 확인**이라는 현재 `always()` 경로를 그대로 둔다(3차-2). rc=75 인 실행은 이 세 단계가 정상 실행과 똑같이 돈다.
- **A 가 B 앞**(2차-6): `failure()` 는 앞선 단계 중 실패가 있으면 참이다. B 를 먼저 두면 B 의 의도적 `exit 1` 이 A 를 참으로 만들어 「다른 실패와 병존」을 오인한다. A 를 먼저 두면 A 평가 시점에 B 는 아직 실행 전이다. 상호 배타 · 최종 메시지는 하나.
  `!cancelled()` 를 쓰지 않는다 — 상태 함수가 있으면 암묵 `success()` 가 붙지 않아 앞 단계 실패에도 참이다.
- 정정 단계는 `FetchResult.exit`·`readFetchResult`·`stepExitCode` 가 `0|1` 이라 75 계약에 참여시키지 않는다 — `rc != '75'` 이면 건너뛴다(요청 0 · 이력 불변: `history.next.json` 없음은 커밋 단계가 이미 `-f` 로 건너뛴다). 건너뛴 실행의 `외부 대조` 관문은 정정 보고가 없으므로 실패 시 「정정: 상류 장애로 건너뜀」을 찍는다(관문 판정은 한 글자도 안 바꾼다 — 불일치가 남으면 지금처럼 막는다). `rc==0` 에서 정정 단계 자신의 받기가 실패하면 지금처럼 1 = 막는다.
- **I3 의 세 예외(`continue-on-error: true`)**: ① 드래프트 원본 복원 — 연 1회 행사, 실패는 `::warning::`, 뒤 적재가 아카이브 유무를 본다 ② 드래프트 적재 — DB 에 어제 값이 남고 실패는 `::error::` 주석 ③ 공표 성적표 갱신 — 외부 대조의 재료일 뿐, 못 받으면 `외부 대조` 가 옛 스냅숏으로 돌고 대상 0명이면 exit 1. 새 단계(`수집·적재` 셸 · A · B)에는 `continue-on-error` 를 쓰지 않는다.
- **B (마지막)**: `echo "::error::npb.jp 받기 실패 — 이미 받은 데이터로 배포했다(띠가 낡음을 말한다)"; exit 1`. 재시도 슬롯(`decide`)은 붉은 실행 뒤에 그대로 돈다(`prev != success`) — 바라는 동작이다(예고는 거르면 영영 못 받는다). 장애 실행을 녹색으로 끝내면 하트비트·실패 메일·재시도가 전부 침묵한다(I5 위반)라 기각. 재시도 슬롯의 회로 한도는 1.

### D7. 「받기 실패만 배포」가 깨진 데이터를 내보내지 않는다 (경로 표)

| 경로 | 쓰기 | 분류 | 배포 |
|---|---|---|---|
| fetcher 소진/회로/거절/3xx 종결 | 0 | upstream | **한다** |
| 경기 4장 중 일부 실패 | 0(전부 보류) | upstream | **한다** |
| 4장 받고 **기록 중** 쓰기 실패 | 일부 | **local → 1** | 막는다 |
| `readMeta` 예외 · 구조 변경 예외 · 현재 달 일정 404 | 0 | **local → 1** | 막는다 |
| `load-*` 실패(적재·파싱·판 가드·세트·본문 불일치) | — | R1 | 막는다 |
| emit 실패(종료 1·2·null) | — | R1 | 막는다 |
| 신선도 사유 + 상류 실패 **없음** / `no-games` | — | R4 | 막는다 |
| 외부 대조 · 파서/득점 대조 · 시험 · 빌드 게이트 · S1 · Access · 배포 | — | `success()` | 막는다 |

분류가 틀릴 때의 방향은 막는 쪽이다(새 종료 코드·크래시·읽지 못한 사유 파일 = blocking). 75 로 통과하는 행은 쓰기가 0인 위 두 줄뿐이다.

### D8. 시험 — 계약마다 하나 (고치기 전 RED · 변이)

모든 새 시험은 **고치기 전 코드에서 붉은 것을 실제로 돌려 확인**한 뒤 채택한다. 외부 요청 0 — 가짜 `fetchImpl`·루프백·임시 SQLite만. 전체 `npm test` 는 조정자의 분할 러너.

| # | 계약 | RED(고치기 전) | 변이(붉어야 한다) |
|---|---|---|---|
| T1 | D1 표 전수: 200·304·404·410·400·401·403·451·408·429·500·3xx 종결 3종·네트워크·타임아웃 각각의 반환/예외 · `kind`(`classifyFetchCause` 표: 세 UND_ERR 코드·`ECONNRESET` 등·모르는 코드→`network`·`AggregateError`→첫 원소) · 회로 효과(**404·410 외 전부 +1**, 401/403/451 즉시 열림) · `errorKind` (표 구동) | 타입 없음 | 비재시도 4xx 를 회로에서 빼면 · 404 를 던지게 바꾸면 · 3xx 종결을 반환으로 되돌리면 붉다 |
| T2 | `local` 은 75 가 되지 않는다: `readMeta`·쓰기·구조·`ScheduleAbsentError`·선수 쓰기 → `exitCodeFor === 1`, 상류와 섞여도 1 | 구분 없음 | `commitPrepared` 의 `catch` 가 `UpstreamError` 를 만들게 바꾸면 붉다(가장 중요) |
| T3 | D2: 마지막 원인·시도별 ms 포함 · 앞 구절 불변 · **400자 규칙**(긴 URL 200자 + 긴 detail + 4시도 `AggregateError` 픽스처: 길이 정확히 400 · 397자+`…` · 마지막 원인이 항상 포함 · 경계 399/400/401자) · `ConnectTimeoutError` 메시지에서 주소가 나옴 | `cause` 만 있고 메시지엔 없음 | 길이 비교를 빼면 · 마지막 원인을 목록 뒤에 두면 · 397 을 400 으로 바꾸면 붉다 |
| T4 | D3 **홉별 시간 상한**: 루프백 서버 — 무응답 서버에서 헤더 한도(작은 값 주입)가 `UND_ERR_HEADERS_TIMEOUT` → `headers-timeout` 으로 끊음 · 느린 본문이 `body-timeout` · **3홉 리디렉션의 각 홉이 자기 헤더 한도에서 끊긴다**(홉 하나의 지연이 다음 홉의 한도를 깎지 않는다) · `Agent` 옵션(`connect.timeout=30000`·`headersTimeout=30000`·`bodyTimeout=30000`·`connections=1`)이 가짜 `Agent` 생성자로 전달됨 · 프로세스가 4초 안에 끝남 · 시도 하나의 이론 상계 식 `H×90+H×3` 이 코드의 상수(`MAX_REDIRECTS`)에서 나온다 | 상한 없음 | `Agent` 를 빼면 · 한도 값을 바꾸면 · `AbortSignal` 단일 마감을 되살리면(식과 안 맞음) 붉다 |
| T5 | D4 회로: 연속 3 열림 · 성공 리셋 · 합계 6 · N=1 · 401/403/451 즉시 열림 · 비재시도 4xx·3xx 종결도 +1 · 열린 뒤 가짜 `fetchImpl` 호출 0 | 모듈 없음 | 리셋/합계 제거 변이 |
| T6 | D4 부모: 가짜 자식으로 — 예고 75 → 이후 받기 자식 spawn 0 · 로컬 자식은 spawn · 예고가 경기보다 앞 · `update.ts` 에 `spawnSync` 직접 호출 0(정적) · emit 둘에 종료 1·2·null 주입 → blocking 한 건씩 | 날짜마다 spawn · emit 은 `failures` 만 | 중단 조건을 빼면 · emit 을 steps 에서 빼면 붉다 |
| T7 | D5 `classifyRun` 표 전수(R1~R5) + 사유 표(설명되는 4 · 안 되는 1) + **사유 파일 계약**(4차-3): 정상 `exit:0` 도 빈 `reasons` 로 원자적 기록 · spawn 전 삭제(이전 파일을 읽지 않음) · `exit 1` 인데 없음/깨짐/`schema≠1`/`exit` 불일치/allow-list 밖 키/빈 `reasons` → blocking · `exit 2` → blocking · 중복 제거 · **상류 실패 없는 `career-lag` → blocking** | 모듈 없음 | R4 의 「upstream ≥ 1」 조건을 지우면 붉다 |
| T8 | 다음 달 일정: 현재 달 성공 + 다음 달 503 소진 + 회로 미달 → `cli.ts` 75 · 다음 달 404/410 → 0 + 꼬리표 · 현재 달 404 → 1 | 항상 0 · 항상 꼬리표 | 다음 달 실패를 무영향으로 되돌리면 · 꼬리표 조건을 지우면 붉다 |
| T9 | 워크플로(`workflow-shell.ts`, 가짜 `node`+실제 `bash`): rc 0→통과 / 75→통과+`rc=75` / 1·2·137→실패 · **D6 표의 모든 단계 `if:` 글자**(변경 없는 단계는 그대로, 정정은 `rc != '75'`) · 맨 끝 A→B 순서 · `continue-on-error: true` 가 정확히 셋 · **GitHub 식 평가기**(순차 · `failure()` = 앞선 실패 · 단계의 `exit 1` 이 뒤 `failure()` 를 참으로 만든다)로 5경우의 **메시지 수**(4차-4): 75+전부 성공 → **정확히 1(B)** · 75+crosscheck 실패 → **정확히 1(A)** · 75+배포 실패 → **정확히 1(A)** · 75+취소 → **0** · rc≠75 → **0** (rc==75 이고 취소가 아니면 항상 정확히 1) | 단계 없음 | `75)` 와 `*)` 합치면 · 끝 단계를 `!cancelled()` 로 바꾸면 · A·B 순서를 바꾸면 붉다 |
| T10 | `build.ts`: `BB_UPSTREAM_OUTAGE=1` 이면 stale 만으로 종료 0+경고 · 비면 1 · 다른 `exitCode=1` 갈래는 env 와 무관하게 1 | 항상 1 | 조건을 `stale \|\| other` 로 흐리면 붉다 |
| T11 | 예산 `correction-budget.test.ts`: `1.0 + 단계 제한(실제 daily.yml 의 값) + 0.4 + 11.43 ≤ 43.5` · 기존 `정정 마감 25 + 6.63 + 11.43` 유지 | 단계 제한 없음 | 단계 제한을 33 으로 올리면 붉다 |
| T12 | 기존 시험 갱신: `fetcher-redirect.test.ts`·`fetcher-archive.test.ts`·archive 계열의 「본문 없는 3xx/302 를 돌려준다」 → 「`http-<3xx>` `UpstreamError` 를 던진다」 · `exit-code.test.ts`·`clock-injection.test.ts`·`refetch-wiring.test.ts`(배럴 금지) 재실행 | — | 새 모듈의 `new Date()` 직접 호출 변이로 붉다 |

## 5. 비용 · 뒤집힐 조건 · 남는 위험

- **월 ¥0.** Actions: 공개 저장소의 표준 러너는 분이 무제한이다(CLAUDE.md §6 · 비공개로 되돌리면 2,000분 한도와 08-31 소진 사고 형태가 되살아난다 — 그때 장애 실행: 지금 6×33분 = 198분/일, 연결 단절형 제안 6×~19분 = 114분/일). Cloudflare Pages 배포가 장애 중 하루 0 → 최대 6회(월 ≈ 180)로 는다 — 500 빌드/월 한도가 직접 업로드에 적용되는지는 **미확인**이나 180 < 500. 소진 시 새 배포 불가(기존 화면 유지) · 알림은 `verify-deploy.ts`(12시간).
- **뒤집힐 조건**: ⑴ `explained` 로 가려진 결함이 실제로 나가면 R4 를 좁힌다 ⑵ 단일 URL 의 지속 5xx 가 매일 이후 받기를 멈춰(부모 중단) 선수 갱신을 굶기면 75 를 「회로 열림」과 「소진 있음」 두 코드로 가른다 ⑶ `undici` 승격이 정정 경로/시험에 영향을 주면 D3 을 내장 `fetch` + 연결 10초로 후퇴(그때 H1/H2 분리는 포기) ⑷ `rc==0` 에서 정정 단계 자신의 상류 실패가 월 1회 이상 배포를 막으면 정정 경로 계약을 3갈래로 넓히는 별도 설계.
- **남는 위험**: 부모의 「75 면 이후 받기 중단」은 한 건의 소진으로도 이후 받기를 멈추는 보수적 선택이다(⑵). 시간의 절대 상한(네트워크 마감)이 없어 D3 표의 D 모양(리디렉션 홉마다 정지)과 B 의 간헐 장애(합계 6 × 285초 = 28.5분 + 2.6)는 단계 걸쇠 30분을 넘을 수 있다 — 그때는 걸쇠가 단계를 죽여 blocking(배포 없음 — 지금과 같다). 관측된 연결 단절형은 3×165초 = 8.3분(간헐이어도 6×165 = 16.5분)이라 안에 든다. 러너 이그레스·SYN 재전송 곡선은 **측정하지 않은 가정**이다.

## 6. 바뀌는 파일 (PR-2a)

- `packages/archiver/src/upstream.ts`(신규) · `circuit.ts`(신규) · `fetcher.ts`(분류·던지기·시도 마감·`Agent`) · `archive.ts` · `players.ts` · `starters.ts` · `draft.ts`(`errorKind`)
- `packages/archiver/src/cli.ts`(다음 달 일정 75 · 꼬리표 `ScheduleAbsentError` 한정 · `exitCodeFor`) · `cli-players.ts` · `cli-starters.ts`(`exitCodeFor`)
- `packages/archiver/package.json` · `package-lock.json`(`undici` `7.29.0` 직접 의존)
- `scripts/run-verdict.ts`(신규) · `scripts/update.ts`(`execStep` · 예고 선행 · 부모 중단 · 종료 코드 75) · `scripts/freshness.ts`(`--reasons-out`)
- `packages/web/tools/build.ts`(`BB_UPSTREAM_OUTAGE`) · `.github/workflows/daily.yml`(`수집·적재` · 정정 `if` · 화면 생성 env · A·B)
- 시험 T1~T12 · 문서 `docs/operations/deploy.md`(상류 장애 실행의 읽는 법) · `CLAUDE.md` §6(「돌았다/받았다」 한 문장)
- **변경 없음 확정**: `cli-games.ts` · `refetch-games.ts` · `correction-plan.ts` · `correction-refetch.ts` · `cli-stats.ts` · `cli-draft*.ts`

## 9. 다음 PR 로 미룸 (PR-2b 이후 · 한 줄씩)

- **따라잡기(D8 이전 판)**: owed(일정표가 예정이라 했고 지난 날의 경기 행 없음 · 실행당 5일 · 상한 7일 밖 포함) + 확인된 휴식일로 `since` 앞당기기 · `schedule-owed.ts` 잎 · `daily.yml` 의 `freshness --run-verdict` 호출 포함. 지금 상태에서 10/26 이후 실행은 10/24 를 창 밖으로 잃는다(8시각 중 6시각 · 실측 시뮬레이션) — **장애가 풀리기 전에 PR-2b 가 머지돼야 10/24 이후가 자동으로 들어온다.**
- **자동 날짜 상한 상수** `MAX_AUTO_DATES`(14) + `parseDateList(raw, max)` 잎 — 수동 7일 검사기와 분리 · 따라잡기와 함께.
- **`--dates` 묶음 spawn**(월간 일정 6→2요청) — D4-5 가 부모 중단으로 장애 중 반복은 이미 막는다.
- **상태 파일**(프로세스 간 회로 공유 · fail-closed `stateError` · 종료 코드 76) — 부모 중단이 같은 상한을 준다.
- **tally · `run-verdict.json` · 관측 D12** + `ops/collection-log.jsonl` 의 `fetch`/`outage` 필드.
- **diagnostics_channel 연결 계측**(`beforeConnect`/`connected`/`connectError` → 성공 요청의 `connectMs`) — H2 의 연결 시간 분포가 필요해지면.
- **네트워크 마감 `NET_DEADLINE_MIN`**(잡 시작 + 18분 뒤 새 요청 0 · 응답 지연형 장애의 절대 상한) + 단계 제한 25분.
- **일시정지 스위치** `vars.NPB_FETCH_PAUSED`(요청 0 · 의도적 차단 확정 시) — 지금은 사람이 워크플로를 끈다.
- 로그 메시지의 server 헤더 · phase 분류 · DNS 조회 · family.
- `001-initial.sql` DDL 주석(`climax | japanSeries`)의 정정(P3).
