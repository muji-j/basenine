# 배포 런북 — 증분 H

**작성일** 2026-08-15 · **상태** 계정 작업 대기

> **승인 경계**(`../../x-scraper/docs/operations/trovune-domain-cutover.md`의 규약을 따른다)
> 이 문서는 **검토된 순서와 정확한 값**을 기록한다. 유료 인프라 생성·DNS 변경·공개 트래픽 유입에
> 대한 승인이 아니다. **외부 변경마다 실행 시점에 승인을 받는다.**

---

## 0. 이미 되어 있는 것 (2026-08-15 확인)

| 항목 | 상태 | 근거 |
|---|---|---|
| GitHub 계정 | `muji-j` 로그인됨. 스코프 `repo`·`workflow`·`gist`·`read:org` | `gh auth status` 실측 |
| GitHub 리포 | **`muji-j/bb-app` 생성 완료(비공개)** | 아래 §1 |
| Cloudflare 계정 | **있다.** `lunomel.com`·`trovune.app`이 등록·Active(2026-08-14 확인, 2027-08-14 만료, 자동갱신) | x-scraper 컷오버 문서 |
| Cloudflare Pages 사용 이력 | 있다(x-scraper가 쓴다) | 동상 |
| Cloudflare Access 무료 한도 | **50 사용자** | `docs/decisions/2026-08-14-paid-track-verified.md` |

⚠**bb-app 전용 도메인은 아직 없다.** 제품명이 미확정이기 때문이다(CLAUDE.md §7).
S1(지인한정)에서는 **`*.pages.dev` + Access**로 충분하다. 도메인은 제품명 확정 뒤에 정한다.
`lunomel.com`은 x-scraper 컷오버 문서에서 **파킹 유지**로 못 박혀 있으므로 여기에 붙이지 않는다.

---

## 1. GitHub 리포 (완료)

```
muji-j/bb-app   비공개
```

⚠**반드시 비공개다.** 리포에 NPB 원시 아카이브·DB는 들어가지 않지만(`.gitignore`),
`docs/mockups/`의 산출물에는 실제 선수명과 성적이 들어 있다. S1은 재배포 형태를 취하지 않는다.

보관소는 **릴리스 자산**이다(`data-store` 태그). 코드 릴리스가 아니다.

---

## 2. 리포 시크릿 (사람이 넣는다)

`Settings → Secrets and variables → Actions`

| 이름 | 값 | 왜 |
|---|---|---|
| `BB_ARCHIVER_CONTACT` | 연락 가능한 메일 주소 | ⚠**L1이 요구한다** — 식별 가능한 UA + 연락처 없이 수집하지 않는다. 없으면 수집기가 `exit 2`로 멈춘다 |
| `BB_CONTACT` | 삭제·정정 요청을 받을 주소 | ⚠**L4가 요구한다.** 없으면 화면이 「連絡先が未設定です」라고 표시한다 |

두 값은 같아도 되지만 **역할이 다르다** — 하나는 상대 서버에 밝히는 신원,
하나는 이용자에게 공개하는 창구다.

---

## 3. 보관소 초기 적재 (완료 · 2026-08-15)

⚠**CI를 먼저 돌리면 안 됐다.** CI가 처음부터 다시 받는 것이 아니라 **어제분만** 받으므로,
로컬에 쌓인 3,354건이 CI로 옮겨가지 않은 채 빈 아카이브가 보관소가 됐을 것이다.
그래서 로컬 자산을 먼저 올렸다.

```
릴리스 data-store
  archive.tar    35,287,040 B  (3,354건 · 27.5MB 압축분)
  bb.sqlite.gz    3,247,281 B
```

**복원 왕복을 실측했다** — 이게 안 되면 설계 자체가 무의미하다:

| 검사 | 결과 |
|---|---|
| 내려받아 풀었을 때 파일 수 | 3,354건 → **3,354건 일치** |
| 가드 판정 | `복원 확인: 3354건 → 3354건` · exit 0 |
| 복원된 DB `game` | 663 → **663** |
| 복원된 DB `pa_event` | 46,899 → **46,899** |
| 복원된 DB `player` | 695 → **695** |
| 복원된 DB `probable_pitcher` | 12 → **12** |

### 이후의 일일 실행

```
Actions → daily collection → Run workflow  (또는 02:00 JST 크론)
```

- `ops/archive-manifest.json`이 매 실행 갱신·커밋된다. **이 값이 축소 감지의 기준**이다.
- 복원 직후와 수집 직후 **두 번** 검사하고, 통과하지 못하면 보관소에 올리지 않는다.

---

## 4. Cloudflare Pages — ⚠**Access를 먼저 걸고 데이터를 나중에 올린다**

**순서를 바꾸지 마라.** Pages는 배포하는 즉시 URL이 살아난다.
데이터를 먼저 올리면 Access를 붙이기 전까지 **공개 상태**가 되고, 그 사이가 S1 위반이다.

### 4-1. 빈 프로젝트를 먼저 만든다 — ⚠**GitHub 연결을 하지 않는다**

⚠**대시보드의 「Connect to Git」을 쓰지 마라.** 두 가지 이유가 있다:

1. **Pages 빌더에는 `data/bb.sqlite`가 없다.** 리포에 DB를 두지 않기 때문이다(L6).
   Git 빌드를 연결해도 빌드가 성립하지 않는다.
2. Cloudflare GitHub App이 새 비공개 리포를 못 본다 —
   앱 설치가 「선택한 리포만」이면 `bb-app`이 검색 결과에 **뜨지 않는다**(2026-08-15 실측).
   권한을 열어도 1번 때문에 소용이 없다.

**직접 업로드로 만든다.** 로컬에서:

```bash
npx wrangler@4 login                                     # 브라우저 OAuth (Cloudflare 계정)
npx wrangler@4 pages project create bb-app --production-branch main

# 자리표시자 1장으로 첫 배포 — 사람이 볼 것이 없는 상태에서 Access를 건다
mkdir -p .tmp-empty && echo "setting up" > .tmp-empty/index.html
npx wrangler@4 pages deploy .tmp-empty --project-name bb-app --branch main
rm -rf .tmp-empty
```

⚠**호스트명에 임의 접미사가 붙는다.** 2026-08-15 실행 결과는 `bb-app`이 아니라
**`bb-app-7mk.pages.dev`**였다. Cloudflare가 `pages.dev` 서브도메인 선점을 막으려고 붙인다.
아래의 모든 검증·Access 설정은 **실제로 받은 호스트명**을 쓴다.

**실측(2026-08-15, Access 적용 전):**

| 대상 | 결과 |
|---|---|
| `https://bb-app-7mk.pages.dev/` | **200 · 공개** — 자리표시자가 그대로 보였다 |
| `https://ae09c431.bb-app-7mk.pages.dev/` | TLS 핸드셰이크 실패로 **판정 불가**(인증서 미발급 추정) |

→ **자리표시자를 올린 판단이 맞았다.** 여기에 데이터를 올렸다면 그 사이가 공개였다.

### 4-2. Access를 건다 (Zero Trust)

`Zero Trust → Access → Applications → Add an application → Self-hosted`

| 항목 | 값 |
|---|---|
| Application domain | `bb-app-7mk.pages.dev` |
| Identity provider | **One-time PIN**(기본 제공). 아래 참조 |
| Policy | Action **Allow** · Include **Emails** 에 주소를 하나씩 열거 |
| Session | 24시간 |

#### ⚠IdP는 문지기가 아니다

누가 들어올 수 있는지는 **Policy**가 정한다. IdP는 「어떻게 본인임을 증명하는가」일 뿐이다.
IdP를 고르는 것으로 허용목록이 생기지 않는다.

⚠**`Everyone`이나 `Emails ending in`(도메인 전체)을 쓰지 마라.** 그건 허용목록이 아니다.
`Emails`에 주소를 하나씩 적는다.

#### Google 로그인 대신 One-time PIN을 쓴다 (2026-08-15 확정)

CLAUDE.md §2-5의 S1은 「**Google 로그인** + 허용목록」이라고 적었다. 그런데 그 조항의
**목적은 「허용목록을 UI 숨김이 아니라 엣지에서 매 요청 검증한다」**였고,
Google 로그인은 그 목적을 이루는 **수단**이었다.

Zero Trust 계정에 Google IdP가 없으면 드롭다운에 기본 제공 항목 하나만 뜬다
(2026-08-15 실측). 추가하려면 Google Cloud Console에서 OAuth 클라이언트를 만들어
client ID/secret과 리디렉션 URI를 등록해야 한다.

**One-time PIN으로 간다.** 판단 근거:

| 축 | One-time PIN | Google IdP |
|---|---|---|
| 엣지에서 매 요청 검증 | ✅ 같다 | ✅ |
| 허용목록 강제 | ✅ Policy가 한다(동일) | ✅ |
| 지인이 Google 계정 필요 | **불필요** | 필요 |
| 설정 비용 | 0 | Google Cloud OAuth 클라이언트 생성·유지 |
| 접속 마찰 | 이메일로 6자리 코드(세션 24시간이면 하루 1회) | 원클릭 |

마찰이 문제가 되면 그때 Google IdP를 추가한다. **보증 수준은 바뀌지 않는다.**
→ CLAUDE.md §2-5의 「Google 로그인」 표기는 「Access의 로그인 수단(One-time PIN 등)」으로
읽는다. 수단이 목적으로 굳지 않게 문구를 고쳐 둔다.

⚠**허용목록은 UI 숨김이 아니라 엣지에서 매 요청 검증**돼야 한다(CLAUDE.md §2-5).
Access 애플리케이션은 그 조건을 만족한다.

#### ⚠앱 하나로는 부족하다 — 실측으로 확인했다 (2026-08-15)

`bb-app-7mk.pages.dev` 하나만 Access 앱으로 걸고 잰 결과:

| 대상 | 결과 |
|---|---|
| `bb-app-7mk.pages.dev` | **302** → Access 로그인 ✅ |
| `ae09c431.bb-app-7mk.pages.dev` | **200** · 내용이 그대로 ⚠**뚫림** |

Pages는 **배포마다** `<hash>.bb-app-7mk.pages.dev`를 새로 내준다.
막지 않으면 **배포할 때마다 그 시점의 전체 사이트가 공개 URL로 하나씩 쌓인다.**

⚠**처음 쟀을 때 이 URL은 `000`(TLS 실패)이었다.** 인증서가 나오면서 200으로 드러났다.
**`000`을 「막혔다」로 읽었다면 여기서 데이터를 올렸을 것이다.** 판정표를 그래서 만들었다.

**막는 법 — `Preview access`로 해결됐다 (2026-08-15 확인)**

`Workers & Pages → bb-app → Settings → Preview access` → **Restrict**.

화면 설명은 「preview deployment URL만 보호한다」고 한정하지만, **프로덕션 브랜치(`main`)로
올린 배포의 해시 별칭까지 덮였다** — 문구로 추정하지 않고 재서 확인했다:

| 대상 | Restrict 후 |
|---|---|
| `bb-app-7mk.pages.dev` | **302** → `…cloudflareaccess.com/…/login/bb-app-7mk.pages.dev` |
| `ae09c431.bb-app-7mk.pages.dev` | **302** → `…/login/ae09c431.bb-app-7mk.pages.dev` |

별칭도 **자기 호스트명으로** Access 로그인에 넘겨진다 — 우회 경로 없이 걸렸다.

⚠**302가 나왔다고 끝이 아니다.** `Preview access`가 만드는 정책이 「가입한 사람 누구나」류면
로그인 화면은 뜨지만 아무나 들어온다. **상태 코드만으로는 구별되지 않는다.**
`Zero Trust → Access → Applications`에서 새 앱의 정책이 **이메일 허용목록**인지 확인한다.

안 되는 경우의 대안(이번에는 쓰지 않았다):
- 앱을 하나 더 만든다 — subdomain `*` · domain `bb-app-7mk.pages.dev`.
  ⚠정책은 새로 만들지 말고 기존 `allow_emails`를 선택한다 — 두 벌이 되면 한쪽만 고치게 된다.
  ⚠`pages.dev`는 계정 소유 존이 아니라 와일드카드 입력이 거부될 수 있다.
- 그것도 안 되면 **제품명 확정 후 소유 도메인의 서브도메인으로 옮긴다.**

⚠**정책과 애플리케이션은 다른 것이다.** 정책은 「누가」, 애플리케이션은 「어느 주소를」이다.
정책 화면의 `Used by applications` 수가 **지켜지고 있는 주소의 수**다 —
1이면 배포별 URL은 지켜지지 않고 있다.

**검증 — 이걸 통과하기 전에는 데이터를 올리지 않는다:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://bb-app-7mk.pages.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://<배포해시>.bb-app-7mk.pages.dev/
```

| 코드 | 뜻 |
|---|---|
| 302 / 403 | **정상** — Access가 막고 있다 |
| 200 | ⚠**아직 공개다.** 데이터를 올리지 마라 |
| 000 | 판정 불가(TLS·DNS). 막힌 것이 **아니다** — 다시 잰다 |

### 4-3. 첫 실제 배포 (Access 검증을 통과한 뒤에만)

로컬에서 한 번 확인하고 싶다면:

```bash
npm run build:web
npx wrangler@4 pages deploy dist --project-name bb-app --branch main
```

이후는 Actions가 매일 올린다(§5).

⚠**왜 Pages의 Git 빌드를 쓰지 않는가** — 다시 적어 둔다.
Pages 빌더에는 `data/bb.sqlite`가 없다(리포에 DB를 두지 않는다 · L6).
보관소에서 받아오게 하려면 Pages 빌더에 GitHub 토큰을 줘야 하고,
그러면 시크릿이 한쪽 더 늘면서 **어느 쪽이 무엇을 할 수 있는지의 경계가 흐려진다.**
DB를 이미 들고 있는 Actions에서 올리는 편이 단순하고 권한도 좁다.

---

## 5. Actions에서 직접 배포 (A안)

`Settings → Secrets and variables → Actions`

| 이름 | 값 | 범위 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages 편집 권한 토큰 | ⚠**최소 권한으로 만든다** — `Account · Cloudflare Pages · Edit`만. 계정 전역 토큰을 쓰지 마라 |
| `CLOUDFLARE_ACCOUNT_ID` | 계정 ID | 대시보드 우측에 있다 |

워크플로에 붙일 단계(§6에서 실제로 넣는다):

```yaml
      - name: 배포
        if: success()
        run: npx wrangler@4 pages deploy dist --project-name bb-app --branch main
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

⚠**`if: success()`가 중요하다.** 신선도가 낡으면 빌드가 종료 코드 1을 내는데,
그때 배포하면 **낡은 화면이 조용히 올라간다.** 실패는 실패로 끝낸다.

---

## 6. 아직 넣지 않은 것 — 왜

배포 단계는 **시크릿 2개가 생긴 뒤에** 워크플로에 넣는다.
없는 시크릿으로 도는 단계를 미리 넣으면 매일 밤 빨간 실패가 쌓이고,
**실패가 일상이 되면 진짜 실패를 못 본다.**

시크릿을 넣었다고 알려 주면 §5의 단계를 워크플로에 붙인다.

---

## 7. 남은 확인 항목

| # | 항목 | 상태 |
|---|---|---|
| 1 | `*.pages.dev`에 Access가 프리뷰까지 걸리는가 | **미확인** — 4-2에서 실측 |
| 2 | 제품명·도메인 | 미정(CLAUDE.md §7) |
| 3 | Pages 무료 한도 대비 산출물 크기 | 702파일 / 45.9MB. Pages는 파일 20,000개·파일당 25MiB — **여유 있다** |
| 4 | 모바일 실기 확인 | 미확인 |
| 5 | wRC+ 외부 공표값 대조 | 미실시 |
