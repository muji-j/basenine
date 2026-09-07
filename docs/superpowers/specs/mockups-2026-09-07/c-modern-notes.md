# C案「操作層」— 설계 노트

**한 줄**: 화면을 **조작층**(떠 있고 · 차갑고 · 반투명)과 **내용층**(가라앉고 · 따뜻하고 · 불투명) 두 장으로 자르고,
**모션은 그 경계에만** 둔다. 가로 스크롤 영역을 **4 → 1**로 줄이고, 남은 1개에게 「この先 N 列 →」이라고 **말하게** 했다.

산출물: `docs/superpowers/specs/mockups-2026-09-07/c-modern.html` (단일 파일 · 외부 의존 0 · 이미지 0)
소스: `.../tmp/src-c/` (`style-c.css` · `app-c.js` · `gen-c.js` + 검증 스크립트 6종)
스크린샷: `.../tmp/shots/` (라이트/다크 × 390/768/1280 · 팝오버 · 모션감소 · 대비증가)

⚠ **A안·B안은 열지 않았다.** 절충하지 않기 위해서다.

---

## 1. 읽은 HIG 절과, 무엇을 가져왔는가

SPA라 본문이 WebFetch로 안 나온다. **JSON API**(`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`)로
원문을 받아 파싱해서 읽었다. 읽은 절 **9개**.

| 절 | 가져온 문장(원문) | 이 목업의 어디에 |
|---|---|---|
| **Layout** | *"Group related items… use negative space, background shapes, colors, materials, or separator lines"* | 상단 내비를 **見る/調べる/読む 3묶음**으로. 감사 §2.5「10항목이 전부 같은 무게」의 답 |
| Layout | *"Differentiate controls from content… use a scroll edge effect to provide a transition between content and the control area"* | **`.ctl` = 조작층 단 하나**. 스크롤 시작 시에만 불투명도 .72→.94 + 그림자 |
| Layout | *"Take advantage of progressive disclosure… display parts of items to hint that people can reveal additional content by interacting with the view, such as by scrolling"* | 표의 **엿보기(peek)** + 「この先 N 列 →」 배지 |
| Layout | *"Avoid full-width buttons… respect system-defined margins and are inset from the edges"* | 390px에서 패널 바깥 여백 **0 → 12px**. 감사 §3.2의 답 |
| **Scroll views** | *"**Make it apparent when content is scrollable.** Because scroll indicators aren't always visible… displaying partial content at the edge of a view indicates that there's more content in that direction"* | ⚠ **이 문장이 이 안의 중심축이다** — 가로 스크롤을 없애는 게 아니라 **1개로 줄이고 그 1개를 말하게 한다** |
| Scroll views | *"the indicator shows whether the currently visible content is near the beginning, middle, or end of the view"* | 표 아래 **비례 스크롤바**(`.sbar`) — 폭 = clientWidth/scrollWidth, 위치 = scrollLeft 비율 |
| Scroll views | *"Scroll edge effects **aren't decorative**… they exist to ensure controls stay visually distinct"* | 그래서 스크롤엣지는 **`.ctl` 한 곳에만**. 표에는 안 쓴다(표에 쓰면 데이터를 가린다) |
| **Materials** | *"Liquid Glass forms a distinct functional layer for controls and navigation… **Don't use Liquid Glass in the content layer**"* | 반투명+블러는 **조작층·팝오버·툴팁만**. 패널·표는 전부 불투명 |
| Materials | *"Thicker materials, which are more opaque, can provide better contrast"* | 팝오버 .97 / 상단바 .72→.94 |
| **Color** | iOS 배경 3단(**primary / secondary / tertiary**): *"Primary for the overall view, Secondary for grouping content within the overall view, Tertiary for grouping within secondary"* | ⚠ **「부드러운 층」을 그림자가 아니라 명도로 만든다.** `--bg-1`(지면) / `--bg-2`(패널) / `--bg-3`(주석·호버·묶음) |
| Color | *"in apps with primarily monochromatic content… choosing your brand color as the app accent color can be an effective way"* | iOS 파랑 대신 **점토 주황 `#a34a12`** |
| Color | *"If you define a custom color, make sure to supply light and dark variants, **and an increased contrast option**"* | `@media (prefers-contrast:more)` → 장식 罫를 UI 경계색으로 승격 + 재질 해제 |
| **Motion** | *"**Add motion purposefully**… Don't add motion for the sake of adding motion"* / *"**In apps, generally avoid adding motion to UI interactions that occur frequently**"* | ⚠ **표의 행 호버는 트랜지션 없음(즉시)**. 현행은 여기에 트랜지션이 걸려 있다(§4) |
| Motion | *"Aim for brevity and precision in feedback animations"* | 전 모션 130/220/320ms 3단 |
| **Accessibility** | 대비 표(≤17pt **4.5:1** · 18pt·굵게 **3:1**) | 렌더된 요소 34개 × 라이트/다크 **68/68 통과**(§5) |
| Accessibility | 조작 대상 **기본 44×44pt · 최소 28×28pt** · *"add about 12 points of padding"* | ⚠ **여기서 HIG와 정면으로 부딪힌다 → §3-1** |
| Accessibility | 모션 감소 시: *"**Replacing transitions in x-, y-, and z-axes with fades** to avoid motion"* / *"**Avoiding animating into and out of blurs**"* | ⚠ 모션 감소에서 **끄지 않고 페이드로 바꾼다**. 블러는 애초에 트랜지션 대상이 아니다 |
| **Segmented controls** | *"no more than about five to seven segments in a wide interface and **no more than about five segments on iPhone**"* / *"keep segment size consistent" / "all segments have equal width"* | ⚠ **세그먼티드 컨트롤을 안 썼다 → §3-2** |
| **Buttons** | *"prefer the rounded-rectangle shape in a vertical stack… and **prefer the capsule shape in a horizontal row** of buttons"* | 각기 다른 **4단계 border-radius**의 근거(§2) |
| **Typography** | *"when people increase text size… **they don't expect the tab titles to increase in size**"* | 조작층은 px 고정, 데이터는 본문 크기를 따른다 |
| Typography | *"Minimize the number of typefaces"* / *"In general, avoid light font weights"* | 서체 1벌 유지. **등폭 서체를 없애고** `font-variant-numeric: tabular-nums`로 자릿수 정렬 |

---

## 2. 토큰 — 하드코딩 0, 눈대중 0

**색.** 43쌍을 `contrast.js`로 계산해서 정했다. 도메인(감청·점토주황·크림)에서 뽑았고 **iOS 시스템 색은 한 개도 안 썼다.**

핵심은 **조작층과 내용층의 색온도를 반대로 잡은 것**이다 —
조작층은 **차가운 회청**(`#eef1f5` / 다크 `#181c23`), 내용층은 **따뜻한 종이**(`#f6f3ec` / `#fffdf8`).
야구장의 **전광판(차갑고 발광)** 과 **기록지(따뜻하고 반사)**. 「지금 만지고 있는 게 어느 층인가」가 색온도만으로 읽힌다.

**角丸 4단계 · 각각 이유가 있다** (「모든 요소에 같은 border-radius」 금지에 대한 답):

| 값 | 어디에 | 근거 |
|---|---|---|
| `999px` | 가로로 늘어선 텍스트 버튼(칩·연도·`find`) | HIG Buttons: *"prefer the capsule shape in a horizontal row"* |
| `12px` | 내용 패널 | rounded rectangle |
| `8px` | 입력란·시트 안의 항목 | 작은 조작자 |
| **`0`** | **표와 막대** | **값에 둥근 끝은 없다** |

**그림자는 2개뿐이고 둘 다 「실제로 떠 있는 것」에만 붙는다** (「근거 없는 그림자」 금지에 대한 답):
`--lift`(조작층 · **스크롤이 시작된 뒤에만** 나타남) · `--lift-pop`(팝오버·툴팁).
**내용 패널은 그림자가 0이다** — 지면과의 명도차로만 떠 있다.

**간격**은 4px 격자 7단(`--s1`~`--s7`). 감사 §2.3「세로 리듬이 불규칙」의 답.

---

## 3. HIG가 이 제품과 부딪히는 자리 (그리고 어느 쪽을 골랐는가)

### 3-1. ⚠ 44pt 터치 영역 vs 데이터 밀도 → **HIG의 「최소값」을 골랐다**

HIG는 **기본 44×44pt**를 권하고, 같은 문서가 **최소 28×28pt**도 명시한다.
39px 행에 44px 타깃을 넣으면 **위아래 행과 겹쳐서 「옆을 누르는」 사고**가 난다. 그래서:

- **표 안**: `::after`로 **당사자 높이는 1px도 안 바꾸고** 판정 영역만 **28px**로. (HIG 최소값)
- **조작층**: 버튼·칩은 **44px 이상**. (HIG 기본값)

실측: **28×28 미만 조작 대상 0개 / 170개**. 현행 홈은 **133개 / 152개**가 미만이다.

### 3-2. ⚠ 세그먼티드 컨트롤 — **HIG를 정직하게 읽으면 「쓰면 안 된다」였다**

지시에 「세그먼티드 컨트롤」이 있었지만, HIG 원문이 요구하는 두 조건을
이 화면의 후보 셋이 **전부** 어긴다:

| 후보 | 개수 | HIG 조건 | 판정 |
|---|---|---|---|
| 시즌 띠 | **9**(드래프트 화면은 21) | iPhone 최대 5 | ✗ |
| 章 이동(`hjump`) | **7** | iPhone 최대 5 | ✗ |
| 내비 | **10** | 최대 5~7 + *"For switching between completely separate sections of an app, use a tab bar instead"* | ✗ |

세 후보 다 **폭이 제각각**이라 *"keep segment size consistent… all segments have equal width"* 도 못 지킨다.
→ **안 썼다.** 대신 HIG가 그 자리에 권하는 것(progressive disclosure · 그룹핑)을 썼다.
⚠ **이건 지시를 무시한 게 아니라 지시가 가리킨 문서를 끝까지 읽은 결과다.** 골랐다면 「HIG를 따랐다」가 아니라 「HIG처럼 보이게 했다」가 됐을 것이다.

### 3-3. ⚠ Liquid Glass vs 「목적 없는 glassmorphism」 금지 → **목적이 있는 자리에만**

금지 목록은 **「목적 없는」** glassmorphism이다. HIG의 답이 정확히 그 목적을 준다:
*"Don't use Liquid Glass in the content layer."*
→ 반투명+블러는 **내비·팝오버·툴팁뿐**. 데이터가 있는 곳은 전부 불투명.
그리고 `prefers-reduced-transparency: reduce`에서 **재질 자체가 사라진다**(실측: `backdrop-filter: none`, α=1).

### 3-4. ⚠ 「풍부한 전환」 vs 「자주 하는 조작에는 모션을 넣지 마라」 → **후자를 골랐다**

내가 「모션이 제일 많은 안」이라 여기서 함정에 빠지기 쉬웠다.
HIG는 정반대를 말한다: *"generally avoid adding motion to UI interactions that occur frequently."*
→ **표 행 호버는 트랜지션 0**(즉시 반응). 모션은 **상태가 실제로 바뀐 곳**에만.

---

## 4. 무엇을 바꿨고, 왜 — 실측과 함께

### ⓐ 가로 스크롤 4개 → **1개** (감사 §3.1 · 이 안의 최우선 과제)

| 영역 | 지금 | C안 |
|---|---|---|
| 내비 10항목 | 가로 스크롤 | ≥1080px는 **3묶음 인라인**, 그 아래는 **メニュー 시트**(2열 그리드 · 스크롤 없음) |
| 시즌 띠 9년 | 가로 스크롤 | **`‹ 2025年 ›` 스테퍼 + 3×3 그리드 팝오버**. 390px에서 9년이 스크롤 없이 다 보인다 |
| 章 이동 7개 | 가로 스크롤 | ≥1080px는 **왼쪽 세로 레일**(스크롤 스파이 · 슬라이딩 인디케이터), 그 아래는 **「現在地 ▾」 1줄 + 2열 시트** |
| 표 | 가로 스크롤 | **그대로 둔다**(데이터를 잃을 수 없다) — 대신 **말하게 한다** |

⚠ **세로 레일은 지금 화면의 44px `.spine`(팀색만 칠해진 장식 기둥)을 목적 있는 목차로 바꾼 것**이다.
새 공간을 뺏은 게 아니라 놀던 공간을 쓴 것.

**남은 1개를 말하게 하는 법 3중**: ① 다음 열이 **잘려서 보이는** 엿보기 ② `この先 N 列 →` 배지(스크롤에 따라 갱신 · `aria-live`) ③ 표 아래 **비례 스크롤바**.
+ 順位·球団 열은 sticky라 어느 행인지 잃지 않는다.

**실측(320·360·390·430·768·1024·1080·1440 8폭)**: 페이지 자체의 가로 넘침 **0** · 초기 화면 가로 스크롤 영역 **≤768px에서 1개 · ≥1024px에서 0개**.

### ⓑ 「선으로 구분한다」 → 「층으로 구분한다」 (감사 §2.1)

지금은 **패널 테두리 + 주황 세로줄 + 표 테두리가 몇 px 안에 3개**다.
→ **h2의 세로 강조바를 없애고**, 패널의 층(=지면과의 명도차)이 그 일을 하게 했다. 남는 선은 **h2 밑줄 1개**.

### ⓒ 표: 목이 덜 움직이게 (감사 §2.4)

- `width:100%` → **`width:max-content`**. 남는 폭을 열에 배분하지 않는다.
  **@1280 순위표 폭 1136px → 742px (−35%).** 「`全勝〜全敗の勝率`만 오른쪽 끝에 홀로」가 사라진다.
- **열 묶음**(`成績 / 勢い / この先`) + 구분선. ⚠**순위표(10열)에만** 붙였다 —
  나머지 표는 열 이름만으로 알 수 있어서 붙이면 같은 말이 두 줄이 될 뿐이다.
- 호버 + **8행 이상 표에만** 줄무늬(막대가 있는 순위표는 제외 — 배경이 3중이 된다).

### ⓓ 각주는 **한 글자도 안 지웠다** — 대신 역할을 줬다 (요청의 명시 금지사항)

`注` 태그 + `--bg-3` 바탕 + 2px 왼쪽 罫 + **64ch 폭 제한**.
읽을 수 있게 만든 것이지 숨긴 게 아니다. **`<details>`로 접지 않았다** — 접는 건 부드러운 삭제다.

### ⓔ 모션 — 「의미 있는 것만」 10종, 전부 유한 집합

| # | 무엇 | 요소 수 | 속성 | 모션 감소 시 |
|---|---|---|---|---|
| 1 | 조작층 스크롤엣지(불투명도·그림자) | 1 | background/box-shadow | 130ms 선형, 블러 전환 없음 |
| 2 | 큰 제목 → 상단바 축약 제목 | 1 | opacity + translateY | **페이드만**(HIG 지시 그대로) |
| 3 | 레일 현재 위치 인디케이터 | 1 | transform | 즉시 이동 |
| 4 | 現在地 라벨 갱신 | 2 | textContent | 동일 |
| 5 | 시즌/메뉴/章 팝오버 | 3 | opacity + scale(앵커 기준) | 페이드만 |
| 6 | 용어 툴팁 | 1 | opacity + 4px | 페이드만 |
| 7 | 표 넘침 배지 | 5 | opacity | 동일 |
| 8 | 표 스크롤 위치바 | 5 | transform(**손가락을 그대로 따라감**) | 동일 |
| 9 | **순위표 막대가 차오름**(1회) | 24 | `scaleX` | **없음 · 처음부터 만폭** |
| 10 | 칩·버튼 누름 | — | `scale(.97)` | 없음 |

⚠ **9번이 유일하게 「데이터가 움직이는」 모션**이다. 리그의 모양을 한 번 눈에 넣히는 용도이고,
`.hstand`에만 붙는 클래스라 **전역이 아니다**. 나머지는 전부 **사람의 조작에 답하는** 모션.

⚠ **현행에 있던 「블록마다 26ms씩 밀리는 등장 애니메이션」은 지웠다.** `frontend-design` 스킬이
「섹션마다 fade-and-slide-up = AI가 만든 티」로 명시하는 그것이고, HIG의 *"Don't add motion for the sake of adding motion"* 에도 걸린다.

### ⓕ ⚠ **DOM 비용 — 이 안에서 가장 중요한 수치**

브리프가 「행마다 그림자·전환을 거는 식이면 순위 화면이 무너진다」고 경고했다. **이미 무너져 있었다.**

| @1280 | 현행 `index.html` | C안 | 현행 `ranking.html`(42,703노드) |
|---|---|---|---|
| 트랜지션/애니를 가진 요소 | **91** | 108 | **5,017** |
| 그중 `tr`/`td`/`th` | **42** | **0** | **4,453** |
| 28×28 미만 조작 대상 | 133/152 | **0/170** | **2,906** |

현행 CSS의 `tbody tr{transition:background …}` 가 순위 화면에서 **4,450개 행에 트랜지션을 건다.**
C안은 **행·셀에 트랜지션이 하나도 없다.** 애니메이션을 가진 47개 `<a>`는 **전부 조작층**(내비 10·레일 7·시즌 9·시트 10·章 7·find 4)이라 **표 크기와 무관하게 고정**이다.

⚠ **`ranking.html`은 실제로 안 재 봤다**(목업은 홈 화면 1장이다). 산수로만 추정하면
표 1개당 +3노드(배지·바·바 내부) × 95표 = 285, 고정분(레일 16 + 팝오버 45 + 기타 8) ≈ 69 → **약 +354노드 = +0.8%**.
**추정이지 실측이 아니다.**

### ⓖ 그 밖

- 상태 띠(`終了したシーズン`)를 **독립된 단으로 두지 않고 제목 영역에 접었다** — 세로 리듬 한 단이 줄었다.
- **등폭 서체 폐기** → `tabular-nums`. (「작은 데이터 라벨에 monospace」는 AI 티 목록에 있다)
- 넓은 화면 2행째의 빈 공간에 **`現在地 · 続いていた記録 7/7`** 을 넣어 **정보로 채웠다**.

---

## 5. 대비 — 계산했다 (눈대중 0)

- **토큰 43쌍** (`contrast.js` · WCAG 상대휘도) → 전부 통과.
  ⚠ 처음 6쌍이 떨어졌고 **그게 설계를 바꿨다**: 罫를 **「장식용(정보를 안 담음)」과 「UI 경계(3:1 필수)」 두 종류로 분리**하게 만든 것이 이 실패다.
- **렌더된 요소 34개 × 라이트/다크 = 68/68 통과** (`live-contrast.js` · 조상 배경을 알파 합성해서 실제 배경을 계산).
- **반투명 최악 케이스 9쌍**(검은/흰 내용이 상단바 밑을 지날 때) → 9/9 통과. 최저 **5.54:1**.
- 접근성 설정 4종 실측: `prefers-contrast:more`(罫 승격 + 재질 해제) · `prefers-reduced-motion`(막대 애니 `none`·인디케이터 `0s`·제목 페이드 130ms) · `prefers-reduced-transparency`(`backdrop-filter:none`) · `forced-colors`(렌더됨).
- 콘솔 오류 **0건** (6개 컨텍스트 전부).

---

## 6. 일부러 **안** 바꾼 것

- **데이터 시각화**(승패 3색 막대 · 득실 중앙기준 막대) — 감사 §0이 「이미 작동한다」고 판정했다. 색만 토큰으로 옮겼다.
- **분모 병기**(`50 · 53登板` / `496得 352失 · 143試合`) — M2. 크기 위계만 손봤다.
- **상태를 글자로 말하기**(`1連勝`·`終了したシーズン`) — 색만으로 말하지 않는다.
- **각주 문면** — 한 글자도 안 고쳤다.
- **본문 16px / 행간 1.55** — 감사가 「읽기 자체는 무리 없다」고 했다.
- **선수 사진·구단 로고** — 안 쓴다(CLAUDE.md §6). 구단은 색 사각형만.

---

## 7. ⚠ 이 안의 약점 (여기를 안 읽으면 비교가 안 된다)

1. ⚠⚠ **고정 조작층이 두 배 두껍다.** 390px에서 **87px**(2행)이 항상 화면을 차지한다.
   지금 화면의 sticky는 상단바 **46px** 하나다(`hjump`는 ≤680px에서 static). **화면의 10.3%를 상시 점유한다.**
   → 정공법은 「아래로 스크롤하면 2행째가 접히고 위로 올리면 돌아온다」인데,
   `.ctl`이 문서 흐름 안의 sticky라 **높이를 바꾸면 본문이 튄다.** `position:fixed` + body padding 으로 바꿔야 하고
   **그건 이 세션에서 검증할 시간이 없었다. 미검증인 채로 넣지 않았다.**

2. ⚠ **페이지가 6% 길어졌다** (390px 5350→5672 · 1280px 4282→4531).
   패널 바깥 여백 · 주석의 안여백 · 스크롤바가 그 값이다. 행 높이는 오히려 줄었지만(60.4→58.9)
   **스크롤 총량은 늘었다.** 밀도를 지키는 것과 여백을 주는 것은 완전히 양립하지 않는다.

3. ⚠ **표 열 머리의 세로 고정을 포기했다.** `overflow-x:auto` 인 그릇이 세로 sticky의 기준이 되어
   **머리 행이 표 중간에 달라붙는다.** `overflow-y:clip` 으로도 안 고쳐졌다(Chromium 실측).
   지금은 최장 12행이라 손해가 작지만 **`ranking.html`의 긴 표에서는 문제가 된다.** 그 화면에는 다른 해법이 필요하다.

4. ⚠ **좁은 화면에서 내비가 한 탭 뒤로 갔다.** 10항목 전부 `メニュー` 안이다.
   가로 스크롤 하나를 없앤 대가이고, **「어느 페이지에 있는지」가 좁은 화면에서 안 보인다.**
   4개만 밖에 내놓는 절충안도 있는데 **390px에서 시즌 스테퍼와 자리를 다툰다.**

5. ⚠ **연도 그리드는 9년 기준으로 만들었다.** 드래프트 화면은 **2005~2025 21시즌**이라
   3×7 그리드가 되고 **팝오버 안에서 세로 스크롤이 생긴다.** 21년에서는 안 재 봤다.

6. ⚠ **레일은 ≥1080px에서만 나온다.** 1024~1079px 구간에는 레일도 인라인 내비도 없다(둘 다 `none`).
   **의도한 동작이지만 그 폭에서 화면이 제일 허전하다.**

7. ⚠ **막대가 차오르는 연출은 순위표를 볼 때마다 재생된다.** HIG의
   *"don't make people wait for an animation"* 과 아슬아슬하다. 460ms + 최대 605ms 지연이라
   숫자는 이미 읽히지만 **자주 보는 사람에게는 거슬릴 수 있다.** 1회성 플래그(sessionStorage 등)가 필요할지도 모른다.

8. ⚠ **반투명 상단바의 대비는 「최악의 배경」을 가정해 계산한 것**이지, 블러가 실제로 만드는 색을 잰 게 아니다.
   `--ctl-a`가 .94까지 올라가므로 배경 기여가 6%로 묶여 안전하다고 **논증**했지만, **화면에서 픽셀로 재지는 않았다.**

9. ⚠ **`ranking.html`(42,703노드)에 이 CSS를 얹어 보지 않았다.** §4-ⓕ의 개선폭은 **산수 추정**이다.
   ⚠**브리프가 「거기서 먼저 재고 나서 전역에 얹으라」고 했고, 나는 홈 화면만 만들었다.**

10. ⚠ **실기기·스크린리더로 안 봤다.** Playwright 헤드리스까지다. 특히 **`aria-live`가 붙은 넘침 배지가
    스크롤할 때마다 읽히면 시끄러울 수 있다.** VoiceOver로 확인해야 한다.

11. ⚠ **`role="region"`을 표 5개에 붙였다** — 키보드로 가로 스크롤을 하게 만드는 정공법이지만
    **랜드마크가 5개 늘어난다.** 스크린리더 사용자에게 득실이 어느 쪽인지 확인 안 했다.

12. ⚠ **홈 화면 1장만 만들었다.** 선수·구단·경기·드래프트 화면에서 이 층 구조가 성립하는지는 **모른다.**
    특히 **선수 페이지(최대 403KB · 블록 14개)** 는 章 레일이 7개가 아니라 14개가 된다.

---

## 8. 실측 요약

| 측정 | 현행 | C案 |
|---|---|---|
| 390px 첫 화면의 가로 스크롤 영역 | **4** | **1** |
| 페이지 자체의 가로 넘침(320~1440 · 8폭) | — | **0** |
| 순위표 행 높이 @390 | 60.4px | **58.9px** |
| 전 표 평균 행 높이 @390 | 40.5px | **39.0px** |
| 순위표 폭 @1280(눈의 횡단거리) | 1136px | **742px** |
| 페이지 전장 @390 / @1280 | 5350 / 4282 | 5672 / 4531 (**+6.0% / +5.8%**) |
| DOM 노드(홈) | 1094 | 1254 (+160) |
| 28×28 미만 조작 대상(홈) | **133 / 152** | **0 / 170** |
| 트랜지션·애니 요소(홈) | 91 (**tr/td 42**) | 108 (**tr/td 0**) |
| 같은 값 @`ranking.html` | **5,017 (tr/td 4,453)** | 미실측(추정 ~285) |
| 대비: 토큰 / 렌더 요소 / 반투명 최악 | — | **43·68·9 전부 통과** |
| 콘솔 오류 | — | **0 / 6컨텍스트** |
