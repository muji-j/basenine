# IBM Plex — 벤더링한 원본 (부분집합의 재료)

여기 있는 `.woff2` 는 **배포되는 파일이 아니다.** `scripts/build-fonts.ts` 가 이걸 재료로
`dist/assets/fonts/` 에 **쓰이는 글자만 담은 부분집합**을 굽는다(설계는
`docs/superpowers/specs/2026-09-07-design-direction.md` §5-A · §5-C).

## ⚠왜 npm 이 아니라 여기 있는가 — 설치 스크립트 때문이다

`@ibm/plex-sans-jp` 는 **2.0.0 부터**, `@ibm/plex-sans` 는 **1.1.0 부터**
`postinstall: ibmtelemetry --config=telemetry.yml` 을 단다(레지스트리 메타데이터 실측 · 2026-09-08).
그 스크립트는 **`contents: write` 와 Cloudflare 배포 토큰이 같이 도는 잡**에서 실행되고,
`scripts/test/install-scripts.test.ts` 가 정확히 그것을 막는다. 그 시험의 규칙은
「**무엇을 놓는지** 적어라. 「의존이 그렇다」는 사유가 아니다」인데,
IBM 텔레메트리는 **아무것도 안 놓고 IBM 으로 사용 통계를 보낸다** — 그 규칙을 통과할 수 없다.

⚠**텔레메트리가 없는 판으로 내려가는 길은 막혔다**(실측):

| 패키지 | 설치 스크립트 | cmap | 우리 글자를 덮는가 |
|---|---|---|---|
| `@ibm/plex-sans-jp@1.0.0` | 없음 | **8,316자** | ⚠**아니오 — `⚠`(U+26A0)이 없다.** 그 글자는 화면에 실제로 나온다 |
| `@ibm/plex-sans-jp@3.0.0` | ⚠ibmtelemetry | 15,718자 | 예 |
| `@ibm/plex-sans@1.0.0` | 없음 | 895자 | 예 — ⚠**1.1.0 과 파일이 바이트까지 같다**(sha256 대조) |

→ **JP 는 3.0.0 이어야 하고 3.0.0 은 텔레메트리를 단다.** 그래서 **파일만 가져왔다.**
라틴은 1.0.0 으로 내려가도 되지만 **한 서체를 두 곳에서 가져오면 판이 갈릴 자리**가 생겨
같이 벤더링한다.

⚠**Noto 는 여기 없다.** `@expo-google-fonts/noto-sans{,-jp}` 는 **설치 스크립트가 0개**라
npm 으로 고정하는 편이 낫다(저장소 바이트를 안 쓴다). **층이 다르니 같이 옮기지 마라.**

## 출처 (재현 가능한 형태로)

```
@ibm/plex-sans@1.1.0
  https://registry.npmjs.org/@ibm/plex-sans/-/plex-sans-1.1.0.tgz
  sha512-WPgvO6Yfj2w5YbhyAr1tv95RUz4LRJlqN+CmYvBglabXteufP1D1E9BABMde+ZIKdRbFJDoKF5eQzfhpnbgZcQ==
  → package/fonts/complete/woff2/IBMPlexSans-{Regular,SemiBold,Bold}.woff2
  → package/LICENSE.txt  (여기의 OFL.txt)

@ibm/plex-sans-jp@3.0.0
  https://registry.npmjs.org/@ibm/plex-sans-jp/-/plex-sans-jp-3.0.0.tgz
  sha512-/v46f2qWBwOg0U/At3R9yVIWrHZKYHM0ByCz2lnNk60VqTHATcCHUT9djTmYBlRwaepybLzDsvx2DtxpHpIPvA==
  → package/fonts/complete/woff2/hinted/IBMPlexSansJP-{Regular,SemiBold,Bold}.woff2
```

⚠**아무것도 고치지 않았다** — 타르볼에서 꺼낸 그대로다. sha256 은
`scripts/test/fonts.test.ts` 가 대조한다. **손으로 바꾸면 그 시험이 먼저 운다.**

## 라이선스

**SIL Open Font License 1.1** (`OFL.txt`). ⚠**예약 서체명(Reserved Font Name)은 `"Plex"` 다.**
OFL §1 은 「글리프를 지우는 것」도 Modified Version 으로 정의하므로 **부분집합은 개변판이고**,
§3 은 개변판에 예약명을 쓰지 못하게 한다.
⚠**여기 있는 파일은 개변하지 않은 원본이라 이 조항에 안 걸린다.** 걸리는 것은
`dist/assets/fonts/` 로 나가는 **부분집합** 쪽이고, 그 이름을 무엇으로 부를지는
**사람이 정할 문제다**(→ 설계 문서 §5-A 로 올렸다). 여기서 조용히 정하지 않는다.

## 웨이트를 왜 셋만 두는가

화면 토큰이 셋이다 — `--w-reg:400` · `--w-semi:600` · `--w-bold:700`(`packages/web/src/assets.ts` 실측).
CSS 에 `font-weight:500`(표 머리)과 `800`(순위 1위)이 각 한 곳 있는데 **웨이트 매칭 규칙상
500→400 · 800→700 으로 실제 페이스가 붙는다**(합성 굵게가 아니다).
⚠**웨이트를 늘리면 저장소가 2.3 MB 씩 는다** — 늘리기 전에 화면에서 그 차이가 보이는지 재라.
