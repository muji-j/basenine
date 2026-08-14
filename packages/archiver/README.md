# @bb-app/archiver

npb.jp의 경기 페이지를 **파싱하지 않고 원시 HTML 그대로** 보존한다.

파싱·스키마·지표는 나중에 바뀐다. 원본이 남아 있으면 언제든 다시 뽑을 수 있지만, 원본이 없으면 그날은 영구히 비어 있다. 그래서 이 패키지는 **저장만** 한다.

## 사용법

```bash
# 오늘(JST) 경기
node packages/archiver/src/cli.ts --contact you@example.com

# 특정 경기일
node packages/archiver/src/cli.ts --date 2026-08-14 --contact you@example.com

# 기간 백필
node packages/archiver/src/cli.ts --from 2026-04-01 --to 2026-08-14 --contact you@example.com
```

연락처는 **필수**다(`--contact` 또는 `BB_ARCHIVER_CONTACT`). 연락처 없는 UA로 긁으면 상대가 문제를 알릴 방법이 차단밖에 없다(CLAUDE.md L1).

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--date` | 오늘(JST) | 경기일 `YYYY-MM-DD` |
| `--from` / `--to` | — | 기간 백필 |
| `--out` | `data/archive` | 저장 루트 |
| `--delay` | `3000` | 요청 간 최소 간격(ms) |

종료 코드는 실패가 1건이라도 있으면 `1`이다. 크론에서 그대로 실패로 잡을 수 있다.

## 저장 형태

```
data/archive/npb/scores/{시즌}/{MMDD}/{슬러그}/
  index.html.gz         경기 요약
  playbyplay.html.gz    試合経過  ← 스플릿·상대전적의 원천
  box.html.gz           投打成績
  roster.html.gz        ベンチ入り選手
  *.meta.json           url · fetchedAt · lastModified · etag · status · sha256 · byteLength · revision
```

본문은 **바이트 그대로** 저장한다. 인코딩 변환도 정규화도 하지 않는다.
`revision`은 **내용이 실제로 바뀔 때만** 오른다 — 재수집만으로는 오르지 않는다.

## 실측으로 확인된 사실 (2026-08-14)

| 항목 | 값 | 확인 방법 |
|---|---|---|
| 경기 URL | `/scores/{YYYY}/{MMDD}/{원정}-{홈}-{경기번호}/` | 실제 취득 |
| 하위 페이지 | `index` · `playbyplay.html` · `box.html` · `roster.html` | 실제 취득 |
| 경기 발견 경로 | `/games/{YYYY}/schedule_{MM}_detail.html` (월 전체, 미래 일정 포함) | 실제 취득 |
| `robots.txt` | **HTTP 404** | 실제 취득 |
| ⚠**조건부 요청** | **ETag·Last-Modified 둘 다 없음** | 24페이지 전부 `null` |
| 크기 | playbyplay 원본 68KB → gzip 9KB. **경기당 4페이지 ≈ 33KB(gz)** | 실측 |
| 1시즌 실측 | 2026-03-27~08-14 **663경기 = 21.8MB(gz)**. 정규시즌 858경기 환산 시 **약 28MB** | 백필 실측 |

### 2026 시즌 백필 실적 (2026-08-15 완료)

```
167일 중 167일 처리 (경기 있는 날 123일)
월간 일정 취득 6회      ← 캐시가 없었다면 167회였다
페이지 2,652장 (신규 2,628 / 변경없음 24 / 부재 0 / 실패 0)
소요 약 2시간 · 요청 간격 3초
```
「변경없음 24」는 미리 받아둔 8/14분이다 — **실환경에서 멱등성이 확인된 것**이다.

### ⚠`robots.txt`가 404인 것은 「허용」이 아니라 「지시 없음」이다
허용의 근거로 쓰지 마라. 지시가 없을수록 보수적으로 움직인다.

### ⚠npb.jp는 조건부 요청을 지원하지 않는다
ETag도 Last-Modified도 주지 않으므로 `If-None-Match` / `If-Modified-Since`는 **효과가 없다**(304가 오지 않는다).
멱등성을 실제로 담보하는 것은 **본문 SHA-256 비교**다. 두 장치를 모두 둔 이유가 이것이다 —
조건부 요청은 상대가 지원할 때 트래픽을 아끼고, 해시 비교는 지원하지 않아도 쓰기를 막는다.
**실측 확인: 같은 날을 두 번 돌리면 신규 0 / 변경없음 24.**

## 설계 원칙 (CLAUDE.md 대응)

| 규칙 | 이 패키지에서의 구현 |
|---|---|
| **M5** 멱등 | 본문 해시가 같으면 쓰지 않는다. `revision`은 내용 변경 시에만 증가 |
| **M6** 주입 시계 | `clock.ts`가 `new Date()`를 부르는 유일한 곳. JST 날짜 변환도 여기 |
| **M7** 파싱 실패는 실패로 | 일정 페이지에서 링크 0건 → `NoGamesFoundError`. **빈 배열을 돌려주지 않는다** |
| **M11** 결측 3분류 | `stored` / `unchanged` / `absent`(404) / `failed`를 구별해서 센다 |
| **L1** 예의 | 요청 간 3초 · **동시 1커넥션**(큐로 강제) · 연락처 포함 UA · 4xx 무재시도 |
| **L7** 조건부 요청 | 이전 메타의 ETag/Last-Modified를 붙인다(상대가 지원하면 효과) |
| **작업규칙 7** 분모 | 결과를 항상 `총 N장 중 …` 형태로 보고 |
| **작업규칙 8** FAIL/ERROR 분리 | 페이지 단위 실패(`failed`)와 날짜 단위 실패(`ERROR`)를 따로 센다 |

## 테스트

```bash
npm test          # 38본
npm run typecheck
```

외부 사이트를 때리지 않는다. 파싱 테스트는 고정 픽스처를 쓴다(CLAUDE.md 작업규칙 11).

## 아직 안 한 것

- **R2 싱크** — 지금은 로컬 디스크뿐. `Sink` 인터페이스만 구현하면 교체된다
- **스케줄러** — 수동 실행. 자동화는 감시층 설계와 함께(보고서에서 무료 감시 3종이 전부 시한부로 판명됐다)
- **선수 마스터·시즌 성적 페이지** — 경기 페이지만 다룬다
