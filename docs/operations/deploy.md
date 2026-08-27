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
| Identity provider | **제한 없음**(비워 둔다) — One-time PIN 은 기본 제공이고, Google 을 붙이면 같이 뜬다 |
| Policy | `friends_allowlist` · Action **Allow** · Include **Emails** 에 주소를 하나씩 열거 |
| Session | **1개월(`730h`)** — ⚠2026-08-24 에 24시간에서 늘렸다. 아래 §4-2-A |
| Auto redirect to identity | **끈다** — 켜면 Google 없는 지인이 One-time PIN 화면에 못 간다 |

⚠**이 표는 이제 코드가 붙들고 있다** — `scripts/access-config.ts` 의 `TARGET` 이 정본이고,
매일 배포가 대조한다. **표만 고치고 코드를 안 고치면 배포가 운다.**

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

~~마찰이 문제가 되면 그때 Google IdP를 추가한다.~~ → ⚠**그 시점이 왔다**(2026-08-24 · §4-2-A).
**보증 수준은 바뀌지 않는다.**
→ CLAUDE.md §2-5의 「Google 로그인」 표기는 「Access의 로그인 수단(One-time PIN 등)」으로
읽는다. 수단이 목적으로 굳지 않게 문구를 고쳐 둔다.

⚠**허용목록은 UI 숨김이 아니라 엣지에서 매 요청 검증**돼야 한다(CLAUDE.md §2-5).
Access 애플리케이션은 그 조건을 만족한다.

### ⚠4-2-A. 마찰이 문제가 됐다 — 세션을 늘리고 Google 을 선택지로 둔다 (2026-08-24)

**사용자 보고**: 「이메일 주소를 넣고 → 메일로 온 코드를 다시 넣어야 한다. 실제로 쓰기에 너무 불편하다.」

⚠**원인의 대부분은 로그인 수단이 아니라 세션 길이였다.** 24시간이면 **매일** 그 왕복을 한다.
§4-2 의 옛 표가 그 값을 「24시간」으로 적어 두고 아무도 다시 안 봤다 —
**배포 게이트도 담장이 서 있는지만 보고 설정은 안 봤다.**

#### 무엇을 바꿨나

| # | 무엇 | 값 | 효과 |
|---|---|---|---|
| **1** | Session | 24시간 → **1개월(`730h`)** | 왕복이 **하루 1회 → 한 달 1회**. ⚠**이 하나가 거의 전부다** |
| **2** | Identity provider | 비워 둔다(제한 없음) | Google 을 붙이면 자동으로 같이 뜬다. One-time PIN 은 남는다 |
| **3** | Auto redirect | 끈 채로 | 켜면 **Google 없는 지인이 막힌다** |

⚠**「1개월이 최대」라고 적지 않는다** — 실측한 적 없다. 더 긴 값이 받아들여지면 그때 고친다.

#### ⚠세션을 늘린 대가 — 반드시 알고 있어야 한다

**허용목록에서 뺀 사람이 즉시 차단되지 않는다.** Access 는 로그인 시점에 정책을 평가해 토큰을 내주고,
그 뒤에는 **토큰을 검증**한다. 그래서 명단에서 지워도 **그 사람의 세션이 살아 있는 동안은 들어온다.**

→ **지울 때는 세션도 폐기한다**: `Zero Trust → Access → Sessions` 에서 그 사용자의 세션 revoke.
⚠**한 번 더 눌러야 하는 일이 생긴 것**이고, 그 대신 지인 전원의 매일이 편해졌다. 이 교환을 알고 고른다.

⚠**「엣지에서 매 요청 검증」은 그대로 성립한다**(CLAUDE.md §2-5 S1) — 매 요청 검증되는 것이
**「그 토큰이 유효한가」**이지 **「지금도 명단에 있는가」**가 아닐 뿐이다. **둘을 같은 말로 쓰지 마라.**

#### Google 로그인을 붙이려면 (선택 · 사람 손이 필요하다)

⚠**스크립트가 못 한다.** Google Cloud 에서 OAuth 클라이언트를 만드는 일이라 사람이 해야 한다.
⚠**안 해도 된다** — 위의 ①만으로 마찰의 대부분이 사라진다. 이건 **한 달에 한 번 오는 그 왕복**을
원클릭으로 바꾸는 추가분이다.

1. `Zero Trust → Settings → Authentication → Login methods → Add new → Google`
   화면에 **Redirect URL**(`https://<팀도메인>.cloudflareaccess.com/cdn-cgi/access/callback`)이 나온다. 복사한다.
2. Google Cloud Console → `APIs & Services → Credentials → Create credentials → OAuth client ID`
   → **Web application** → **Authorized redirect URIs** 에 1의 URL 을 붙인다.
   → 만들어진 **Client ID · Client secret** 을 복사한다.
3. 1의 화면으로 돌아가 붙여 넣고 **Test** → 저장.
4. ⚠**애플리케이션의 Identity provider 를 Google 하나로 좁히지 마라.** 비워 둔 채로 두면
   Google 과 One-time PIN 이 **둘 다** 뜬다. 좁히는 순간 Google 없는 지인이 못 들어온다
   (`scripts/test/access-config.test.ts` 가 이 실수를 잡는다).

#### 설정을 코드가 붙든다

```bash
node scripts/access-config.ts          # 확인만 (기본)
node scripts/access-config.ts --apply  # 목표대로 바꾼다
```

`CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID` 가 필요하고, 토큰에 **Zero Trust: Read/Edit** 권한이 있어야 한다.
⚠**Pages 배포용 토큰에는 그 권한이 없다.** 그래서 종료 코드를 셋으로 나눴다:

| 코드 | 뜻 | 배포 게이트의 반응 |
|---|---|---|
| `0` | 목표와 같다 | 통과 |
| `1` | **어긋났다** | **배포 실패** |
| `2` | **못 쟀다**(권한 없음·네트워크) | ⚠**경고만.** 여기서 세우면 읽기 권한 하나 때문에 매일 화면이 안 올라간다 |

⚠**`2` 를 「통과」로 적지 않는다** — 로그에 **「검사가 돌지 않았다」**라고 쓴다.
토큰에 권한을 붙였다면 **리포 변수 `ACCESS_GATE_STRICT=1`** 로 두어라 —
그때부터 「못 쟀다」도 실패가 된다. **안 그러면 이 게이트는 조용히 아무것도 안 하게 된다**
(이 저장소가 M6 린트와 走塁 각주에서 이미 두 번 겪은 상태다).

#### 더 편하게 만들 수는 없었나 — 검토하고 버린 것

| 안 | 왜 안 골랐나 |
|---|---|
| 집·회사 IP 는 로그인 없이 통과(Bypass 정책) | 마찰 0 이지만 **그 네트워크의 누구나 들어온다** — 허용목록이 그 경로에서 무력화된다. IP 가 바뀌면 조용히 깨진다 |
| 공개로 전환 | 마찰 0 이지만 **S1 이 아니라 S2** 이고 **일본 변호사 확인이 전제**다(CLAUDE.md §2-5). 단계 정의를 건너뛰는 일이라 별건으로 둔다 |

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

#### ⚠`Preview access`는 **자기 정책을 붙인다** — 확인하고 바꿔야 한다 (2026-08-15 실측)

켠 직후 `Zero Trust → Access → Applications`의 상태:

| 앱 | 대상 | 정책 |
|---|---|---|
| `bb-app-7mk.pages.dev` | 프로덕션 | `allow_emails` ✅ |
| `bb-app - Cloudflare Pages` | `*.bb-app-7mk.pages.dev` | ⚠**`Allow Members - Cloudflare Pages`**(자동 생성) |

**「Allow Members」는 Cloudflare 계정 멤버를 허용한다는 뜻이지 우리 허용목록이 아니다.**
계정 멤버가 혼자면 결과가 같아서 **차이가 드러나지 않는다.** 문제는 규칙이 두 벌인 것이다:

- 지인을 `allow_emails`에 넣어도 **배포별 URL에는 못 들어간다**
- Cloudflare 계정에 협업자를 한 명 추가하면(다른 프로젝트 때문이라도)
  **허용목록에 없는 사람이 배포별 URL로 사이트 전체를 본다**
- ⚠**두 번째가 조용하다.** 경고가 없고 상태 코드로도 드러나지 않는다

**고친다**: `bb-app - Cloudflare Pages` → Policies → 자동 생성 정책을 빼고
**기존 정책을 선택**한다(새로 만들지 않는다).
정책 화면의 `Used by applications`가 **2**가 되면 맞다.

※ 위 표의 `allow_emails`는 그 시점의 이름이다. 정리 과정에서 `friends_allowlist`로 바꿨다.

⚠**이 항목은 `curl`로 검증되지 않는다** — 단 **「이 항목」은 정책을 말한다.**
익명 접근은 정책이 허용목록이어도, 「계정 멤버 전원」이어도, **정책이 아예 없어도**
같은 302를 돌려준다(2026-08-15 실측). 그러므로 **정책의 내용**은 설정 화면을 읽는 것이 검증이다.

⚠**그러나 「담장이 서 있는가」는 curl 로 검증된다**(2026-08-21 정정 · 실측).
이 문장이 예전에 **게이트를 안 만드는 근거로 두 번 인용됐다** — 그러는 사이
인가 경계 전체가 대시보드 설정에만 있었고, **그것을 확인하는 코드가 리포에 0건**이었다.
무자격 요청에도 **애플리케이션은 자기를 밝힌다** — 리다이렉트 URL에 `kid=<AUD>`가 실려 온다:

```
$ curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://bb-app-7mk.pages.dev/
302 https://hidden-wildflower-d367.cloudflareaccess.com/cdn-cgi/access/login/bb-app-7mk.pages.dev?kid=3a221a60...
```

그래서 `.github/workflows/daily.yml`의 **「S1 확인」 단계**가 배포 앞에서 둘을 본다:
① prod가 302이고 그 AUD가 우리 앱인가 ② **아직 배포된 적 없는 무작위 별칭**도 302인가.
②가 핵심이다 — **오늘 만들 별칭은 아직 존재하지 않기 때문**이다. 시크릿을 쓰지 않는다.
⚠**페이지 문구로 판정하지 마라** — 실제 제목은 「Sign in ・ Cloudflare Access」이고
Cloudflare가 언제든 바꾼다. 상태 코드와 AUD 두 가지만 본다.
⚠**이 게이트는 정책의 내용을 모른다** — 「누가 들어올 수 있는가」는 여전히 위 표가 정본이다.

#### 사람을 추가할 때는 한 곳만 고친다

Access는 두 층이다. **애플리케이션은 이메일을 갖지 않고 정책을 참조할 뿐이다.**

| | 무엇 | 어디 |
|---|---|---|
| 정책 `friends_allowlist` | **누가** — 이메일 목록이 여기 하나만 있다 | Access → Policies |
| 애플리케이션 2개 | **어느 주소를** | Access → Applications |

```
friends_allowlist ─┬─→ bb-app-7mk.pages.dev      (프로덕션)
                   └─→ *.bb-app-7mk.pages.dev    (배포별 별칭)
```

지인을 넣고 뺄 때는 **`Access → Policies → friends_allowlist`의 Emails 목록 한 곳**만 고친다.
정책 화면의 `Used by applications`가 **2**인 것이 이 구조가 유지되고 있다는 표시다.

⚠**앱마다 정책을 따로 만들면 여기가 두 벌이 된다.** 그러면 한쪽만 고치는 날이 오고,
「추가했는데 왜 안 들어가지」 또는 더 나쁘게 **「뺐는데 아직 들어가진다」**가 된다.

##### ⚠실제로 어긋났다 (2026-08-15)

두 번째 앱에 정책을 붙일 때 **같은 이름의 정책이 새로 만들어졌다.**

| 이름 | Used by | Policy ID |
|---|---|---|
| `allow_emails` | 1 | `6ec85ed4-…-9d203f1cf6af` ← 새로 생긴 것 |
| `allow_emails` | 1 | `12fcaef5-…-17accc3b8965` ← 원래 것 |

**이름이 같아서 목록만 봐서는 두 벌인 줄 모른다.** 구별되는 것은 `Policy ID`뿐이고,
`Used by applications`가 **둘 다 1**인 것이 유일한 단서다(합쳐서 2가 아니라 각각 1).

정리 순서 — 이름이 같으면 선택할 때 또 틀리므로 **먼저 구별되게 만든다**:

1. 남길 정책의 이름을 바꾼다(예: `friends_allowlist`). 이름 변경으로 연결은 끊기지 않는다
2. 앱의 정책을 그것으로 교체한다
3. 남은 중복 정책을 지운다. ⚠**지우기 전에 `Used by applications`가 0인지 확인한다**

**완료 신호**: 정책이 **1개**만 남고, 그 `Used by applications`가 **2**.

##### 최종 상태 (2026-08-15 확인)

| 항목 | 값 |
|---|---|
| 정책 | `friends_allowlist` **1개** · Allow · Rules 1 |
| `Used by applications` | **2** |
| Policy ID | `12fcaef5-705f-4884-93c8-17accc3b8965` |
| `bb-app-7mk.pages.dev` | 302 → Access 로그인 |
| `ae09c431.bb-app-7mk.pages.dev` | 302 → Access 로그인(자기 호스트명으로) |

**지인을 넣고 뺄 곳은 `Access → Policies → friends_allowlist` 한 곳이다.**

안 되는 경우의 대안(이번에는 쓰지 않았다):
- 앱을 하나 더 만든다 — subdomain `*` · domain `bb-app-7mk.pages.dev`.
  ⚠정책은 새로 만들지 말고 기존 `friends_allowlist`를 선택한다 — 두 벌이 되면 한쪽만 고치게 된다.
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

## 6. 시크릿 (완료 · 2026-08-15)

`gh secret list --repo muji-j/bb-app`로 이름만 확인했다(값은 볼 수 없다):

```
BB_ARCHIVER_CONTACT
BB_CONTACT
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

배포 단계는 **시크릿이 생긴 뒤에** 워크플로에 넣었다.
없는 시크릿으로 도는 단계를 미리 넣으면 매일 밤 빨간 실패가 쌓이고,
**실패가 일상이 되면 진짜 실패를 못 본다.**

### 계정 ID를 찾는 법

`npx wrangler@4 whoami`가 표로 낸다. 비밀값이 아니다 — 대시보드 URL에도 그대로 들어간다.

### API 토큰

`wrangler login`의 OAuth 토큰은 CI에서 쓸 수 없다. 별도 발급한다.

`dash.cloudflare.com/profile/api-tokens → Create Token → Custom token`

| 항목 | 값 |
|---|---|
| Permissions | **Account · Cloudflare Pages · Edit** ← 이 한 줄만 |
| Account Resources | Include · 해당 계정 |

⚠**템플릿(「Edit Cloudflare Workers」 등)을 쓰지 마라.** 권한이 훨씬 넓다.
이 토큰은 GitHub에 저장되므로 **Pages 배포 하나만** 할 수 있어야 한다.
⚠권한 부족 오류가 나면 `Account · Account Settings · Read`를 한 줄 더한다.

---

## 7. 남은 확인 항목

| # | 항목 | 상태 |
|---|---|---|
| 1 | `*.pages.dev`에 Access가 프리뷰까지 걸리는가 | **미확인** — 4-2에서 실측 |
| 2 | 제품명·도메인 | 미정(CLAUDE.md §7) |
| 3 | Pages 무료 한도 대비 산출물 크기 | **9,514파일 / 1364.7MB**(9시즌 2018~2026 · **2026-08-27 CI 배포 실측**). ⚠~~15,500파일 / 1,031MB~~ 는 **경기 페이지를 날짜별로 묶기 전**(2026-08-24)이고, ⚠~~8,611파일 / 519MB(5시즌)~~ 는 **5시즌 시절 값이 그대로 남아 있던 것**이다(감사 [42]) — 같은 사실에 값이 셋 돌아다녔다. Pages는 **배포당 파일 20,000개**(유료 100,000)·파일당 25MiB → 지금 **47.6%**, 여유 **약 6.0시즌**. ⚠**시즌당 평균 1,743파일이었던 것이 약 1,090이 됐다** — 경기 상세가 시즌당 878장에서 **약 170장**(경기일 수)으로 줄었다. ⚠**이 수는 매일 는다** — 경기가 들어오면 페이지가 늘어난다. 날짜와 함께 읽어라. ⚠**`scripts/test/doc-figures.test.ts` 가 `dist/` 와 대조한다**(허용 오차 안). ⚠**그 「다음 지렛대」를 2026-08-26 에 당겼다** — 경기 페이지를 **날짜별로 묶었다**(`games/<date>.html#g-<slug>`). 설계와 기각한 안은 `docs/superpowers/specs/2026-08-26-game-pages-by-date-design.md`. **다음 지렛대는 선수 페이지 6,207장**이다 — ⚠**파일 수로는 65%지만 바이트로는 86.0%**다(1,164.1MB / 1,354.0MB · 2026-08-27 실측). ⚠**두 비율을 섞어 쓰지 마라** — 상한은 파일 수이고, 사람이 겪는 것은 바이트다. ⚠**바이트 쪽은 통산 대전 표를 얹으면서 크게 늘었다**(중앙 페이지 약 126 → **188.4 KB**). 전송량은 **gzip 약 10배**라 중앙 19KB 남짓이므로, 걸리는 것은 회선이 아니라 **DOM 크기**다. 시즌을 추가할 때마다 이 칸을 다시 재라. ⚠**比較 데이터를 선수별 파일에서 ID 첫 글자 10샤드로 묶어** 29%를 줄인 뒤의 수치다(2026-08-17). 그 대가는 전송량이다 — 최대 샤드 **213KB / gzip 25KB**(2026 기준), **첫 비교 왕복 1.9KB → 49KB gzip(26배)**. 두 번째 비교부터는 캐시로 줄어든다 |
| 4 | 모바일 실기 확인 | 미확인 |
| 5 | wRC+ 외부 공표값 대조 | 미실시 |
