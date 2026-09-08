/**
 * 디자인 토큰과 클라이언트 스크립트.
 *
 * 名鑑(선수 명감)의 시각 언어 — 촘촘한 본문, 머리카락 굵기 괘선, 구단 색 배면.
 * 카드·그림자·둥근 모서리를 쓰지 않는다(인쇄물의 질감).
 *
 * ⚠**색은 전부 토큰으로 정의하고 라이트/다크 양쪽을 만든다.** 뷰어의 테마는 세 가지 상태가 있고
 * (명시적 light · 명시적 dark · 미지정), 미지정이 기본이다.
 * ⚠**모션은 인쇄물의 질감을 깨지 않는 선까지.** 튀는 이징·큰 이동·연속 재생은 쓰지 않는다.
 * 전부 `prefers-reduced-motion`에서 꺼진다.
 */
import { GLOSSARY } from "./glossary.ts";
import { emphasisParts } from "./emphasis.ts";

/**
 * 사이트 아이콘 — **우리가 그린 것**이다.
 *
 * ⚠**구단 로고·엠블럼을 쓰지 않는다**(CLAUDE.md §6). 로고는 상표이고, 「사실은 저작물이 아니다」의
 * 논리가 거기까지 닿지 않는다. 그래서 제품의 시각 언어에서 가져온다 —
 * 선수 紋과 **같은 기하**(정오각형, 꼭짓점 위)다.
 * ⚠**테마를 따라간다.** SVG 안의 `prefers-color-scheme`가 탭 배경에 맞춰 색을 바꾼다 —
 * 밝은 탭에 흰 도형을 그리면 아이콘이 사라진다.
 */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>
  .m{fill:#17171a}
  @media (prefers-color-scheme:dark){.m{fill:#e9e8e3}}
</style>
<polygon class="m" points="16.0,3.0 28.4,12.0 23.6,26.5 8.4,26.5 3.6,12.0"/>
</svg>
`;

export const CSS = `
:root {
  --page:#fbfaf7; --tx:#17171a; --tx-2:#5d5d59; --tx-3:#6e6e69;
  --hair:#e0dfd8; --hair-2:#cfcec5; --panel:#ffffff; --panel-2:#f3f1ec;
  --warn:#a8452f; --ok:#3f6b4a;
  /* ⚠**비비드는 「채도를 올린다」가 아니라 「한 곳에 몰아준다」다**(2026-08-17 유저 요청).
     화면 전체를 물들이면 팀 색이 죽고 수치가 안 읽힌다 — 이 서비스는 숫자가 내용이다(§6).
     그래서 강조색은 **좋음/나쁨·상승/하강처럼 뜻이 있는 자리에만** 쓴다.
     ⚠--ok/--warn 보다 **한 단계 진하다** — 그 둘은 문장 안의 조용한 신호이고,
     이쪽은 표 안에서 눈을 끌어야 하는 자리다. */
  /* ⚠**빨강↔초록을 쓰지 않는다**(이 파일이 이미 세워 둔 규칙 · 아래 「수준 색」 참조).
     처음에 초록↔빨강으로 넣었다가 되돌렸다 — 색각 시뮬레이션에서 두 색이 **1.00:1**,
     즉 완전히 같은 색이 됐다(2026-08-17 디자인 감사). 자기가 적어 둔 규칙을 자기가 깼다.
     → **파랑↔주황 발산 배색**을 쓰고 명도도 벌려 흑백에서도 순서가 남게 한다.
     ⚠득실차 글자는 4.5:1 이 필요하다(14px 굵은 글씨는 WCAG「큰 텍스트」가 아니다). */
  /* ⚠**--dn 은 #a85a17 이었다** — --panel 위에서는 5.073:1 인데 --panel-2(hover) 위에서는
     **4.494:1** 로 4.5 에 0.006 모자랐다(2026-08-18 감사 P3). 「거의 통과」는 통과가 아니다.
     #9e5415 는 panel 6.541 · panel-2 4.984 로 **두 바탕 모두 여유가 있다.** */
  --up:#1b6ca8; --dn:#9e5415;
  /* 승패 띠의 세 조각.
     ⚠**세 쌍이 전부 3:1 이어야 한다.** 이웃만 보면 부족하다 — **무승부가 0인 팀에서는
     승과 패가 직접 맞닿는다**(대부분의 팀이 그렇다). 처음에 이웃만 보고 골랐다가
     승|무 1.09 · 무|패 1.49 · 승|패 1.63 이 됐고, **주석에는 3:1 이라고 적혀 있었다**
     (2026-08-18 다방면 감사 P1).
     ⚠**색만으로 벌릴 수 없어 명도를 크게 벌렸다** — 아주 어두운 파랑 / 밝은 회색 / 주황.
     탐색으로 찾은 값이고 실측 대비는 **승|무 12.19 · 무|패 3.54 · 승|패 3.44** 다.
     ⚠파랑↔주황은 유지한다(색각 안전 · 아래 「수준 색」과 같은 이유). */
  --bar-w:#062a47; --bar-t:#eceae2; --bar-l:#b8651f;
  --f-body:"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans JP","Meiryo",system-ui,sans-serif;
  --f-num:"SFMono-Regular","Consolas","Menlo","Yu Gothic",monospace;
  /* ⚠**이 값은 .topbar 의 「실제」 높이여야 한다.** .rail·.hjump·.pickbar 의 sticky 오프셋과
     scroll-padding-top 이 전부 이 하나를 읽는다 — 어긋나면 앵커가 헤더 뒤로 숨는다.
     ⚠**한때 어긋나 있었다**(2026-08-19 감사 P1 · 2026-08-20 수정). .topbar 가 height 고정인데
     .tnav{flex-wrap:wrap} 이라 탭 8개가 **481~770px 에서 2행**이 됐고, 바 높이는 안 따라왔다.
     실측(step 4 · 400~1000px · 151점): **72점에서 탭줄이 바 밖으로** 나갔다 —
     768px 에서 탭줄이 top:-7.1 ~ bottom:52.1(바는 0~46)이라 첫 행이 화면 위로 잘리고
     아랫행이 시즌 띠를 배경 없이 덮었다. 손가락(pointer:coarse)에서는 더 넓어 **484~784px · 76점**이었다.
     → 지금은 **바가 실제로 이 높이가 되도록** 폭 구간마다 값을 바꾼다(아래 반응형 참조).
     ⚠**값을 바꿀 때는 tools/measure-topbar.ts 로 실측하라.** 눈대중이 이 결함을 못 잡았다. */
  --topbar:46px;
  /* 탭줄 한 줄의 높이. 스크롤 여백 계산이 이 값을 쓰므로 .rail 이 실제로 이 높이여야 한다 */
  --rail:48px;
  /* ══ 척도 ═══════════════════════════════════════════════════════════════════
     이름과 체계는 채택안 C(docs/superpowers/specs/mockups-2026-09-07/c-modern.html)에서
     가져왔다. **1단계(2026-09-07)는 배선만 세우고 화면을 안 바꿨고, 2a(2026-09-08)가
     흩어진 값을 여기로 접었다** — 간격 336건 · 활자 53건 · 웨이트 2건.
     ⚠**~~여기 없는 값이 화면에 아직 많다~~ 는 이제 거의 거짓이다** — 간격 이탈은
     339 → **1**(그 하나는 리듬이 아니라 라벨 폭 기하다 · .seasons 참조), 활자·웨이트는 **0** 이다.
     design-tokens.test.ts 가 그 수를 세어 **늘지 못하게** 붙든다.
     ⚠**아직 척도 밖인 것 둘**: inset box-shadow 로 그린 괘선과 모서리 반지름 —
     둘 다 2b 의 몫이다(값이 아니라 **선의 위계**를 정하는 일이라 같이 봐야 한다). */

  /* ── 간격 — **네 단마다 걸음이 두 배**: 2·4·6·8 → 12·16·20·24 → 32·(40·48…).
     ⚠**~~4px 계단(s_n = 4n)~~ 이 아니다**(2a 에서 바꿨다). 4px 격자는 이 제품의 아래쪽
     절반에서 너무 거칠다 — 표 셀 여백이 사는 2~8px 구간에서 한 걸음이 50% 다.
     현행이 실제로 쓰던 값이 1·2·3·5·6·7·9·10·11px 이었고, 그걸 4n 으로만 접으면
     **여백을 늘리는 쪽**이 되어 밀도가 깎인다. 이 제품에서 그건 개악이다.
     ⚠**번호가 밀렸다** — 옛 --s1(4px)이 지금 --s2 다. 옛 코드를 그대로 옮기지 마라.
     ⚠**접는 규칙은 「가장 가까운 단 · 같으면 작은 쪽」**이었다(움직임 최대 2px). */
  --s1:2px; --s2:4px; --s3:6px; --s4:8px;
  --s5:12px; --s6:16px; --s7:20px; --s8:24px;
  --s9:32px;

  /* ── 활자 크기 — 역할 이름. **아래 7단 + 위 사다리 6단.**
     ⚠**아래 7단(9.5~13px)은 2a 에서 안 건드렸다.** 0.5px 단이 촘촘한 것은 맞지만,
     여기를 접으면 **106개 선언의 글자 크기가 한꺼번에 움직인다** — 그건 서체를 바꾸는
     3단계와 같이 해야 할 일이다. 대신 **여기로 접을 수 있는 것만 접었다**:
     9px 7곳 → --fs-min · 12.5px 12곳 → --fs-data · 13.5px 6곳 → --fs-lead.
     ⚠**위쪽에는 단이 아예 없었다** — 13px 위로 토큰이 **0개**였고 화면에는
     14·14.5·15·16·17·18·19·20·21·22·26·28·34·36·44px 이 흩어져 있었다.
     「이탈」이라기보다 **척도의 절반이 없었던 것**이다.
     → **14 × 1.26ⁿ**(세 단마다 두 배: 14→28 · 18→35 · 22→44) 로 여섯 단을 만들었다.
     ⚠**16px 과 20px 은 양옆 단과 거리가 같아 자리마다 손으로 골랐다** —
     달력 날짜(.dayc b)는 이름급, 경합 그룹 머리(.dgn b)와 비교 상대명(.cmpwho .nm)은 제목급. */
  --fs-min:9.5px; --fs-col:10px; --fs-label:10.5px; --fs-note:11px;
  --fs-sub:11.5px; --fs-data:12px; --fs-lead:13px;
  --fs-name:14px; --fs-title:18px; --fs-num:22px;
  --fs-score:28px; --fs-score-2:35px; --fs-score-3:44px;

  /* ── 활자 웨이트. ⚠**500·800 을 2a 에서 접었다**(각 1곳).
     th 의 500 은 **--w-reg(400)** 로 갔다 — 600 이 아니다. 지금 본문 서체(Yu Gothic·
     Hiragino·Meiryo)는 **Regular/Bold 두 벌뿐**이라 CSS 500 은 실제로 400 으로 그려지고
     600 은 700 으로 그려진다. 600 으로 접으면 **모든 표의 열 머리가 갑자기 굵어진다.**
     ⚠**3단계에서 다중 웨이트 서체를 씌우면 여기가 다시 판단할 자리가 된다.**
     .hstand tr.lead .hrank 의 800 은 --w-bold(700) — 이건 지금도 700 으로 그려진다. */
  --w-reg:400; --w-semi:600; --w-bold:700;

  /* ── 괘선 굵기 — **뜻으로 이름을 준다**(B안 「선을 줄이는 대신 선에 위계를 준다」).
     ⚠**현행은 굵기가 아니라 잉크(--hair / --hair-2)로만 위계를 만든다.** border 굵기 실측은
     1px 77 · 0 13 · 2px 12 · 3px 10 이고 **행 구분과 구획 경계가 둘 다 1px** 이다 —
     즉 지금은 --rw-row 하나가 그 둘을 겸한다. **그 둘을 가르는 것이 2단계의 일**이고,
     이름이 먼저 있어야 어디를 가를지 말할 수 있다.
     ⚠**inset box-shadow 로 그린 괘선은 아직 이 척도 밖이다**(실측 36건) — **2b 의 몫**이다.
     2a 는 값(간격·활자)만 접었고 **선은 안 건드렸다**: 굵기를 정하는 일은 「몇 px 인가」가 아니라
     「무엇이 구획이고 무엇이 행인가」라 값만 옮기면 뜻이 안 생긴다. */
  --rw-none:0;      /* 없음 — 정렬만으로 가른다 */
  --rw-row:1px;     /* 행 구분 · 얇은 경계 */
  --rw-sect:2px;    /* 구획 경계 */
  --rw-mast:3px;    /* 기둥 — 왼쪽 강조바 · 팀색 밑줄 */

  /* ── 모서리.
     ⚠**이 디자인의 border-radius 는 2곳뿐이고 둘 다 스크롤바 손잡이다** — 「카드·둥근 모서리를
     쓰지 않는다」(이 파일 머리말)의 결과다. C안의 4단(pill/panel/field/data)에 대응하는 값이
     현행에 **없다.** 없는 것을 미리 만들지 않는다 — **2b** 에서 처음 값이 생긴다. */
  --r-thumb:3px;

  /* ── 모션 — C안의 t1/t2/t3 + e-out 체계. 값은 전부 현행 그대로.
     ⚠**t3 는 새 값이 아니다** — animation 두 곳(draw·grow)에 420ms 리터럴로 있던 것이다.
     ⚠**prefers-reduced-motion 분기를 같은 단계에서 세웠다**(이 파일 끝) — 나중에 붙이지 않는다. */
  --t1:120ms; --t2:200ms; --t3:420ms;
  --t-stagger:26ms;  /* .block 등장의 순번 지연 — --i 를 곱한다 */
  --e-out:cubic-bezier(.2,.6,.2,1);

  /* **--pad 는 좁은 폭에서 한 단씩 내려간다**(--s7 20 → --s6 16 → --s5 12px).
     ⚠**~~마지막 단 13px 은 계단에 없다~~ 는 2a 에서 해소됐다** — 12px(--s5)이 됐다. */
  --pad:var(--s7);
  /* 본문의 **최대 폭**.

     ⚠**이 값이 없었다**(2026-08-31 · 사용자 지적 「PC버전이 지저분함」).
     미디어 쿼리가 **전부 max-width(모바일 축소용)뿐이라 데스크톱 처리가 0건**이었고,
     .main 에 상한이 없어서 **모바일 레이아웃이 1920px 까지 그대로 늘어났다.**
     표는 width:100% 이므로 남는 폭이 **전부 숫자 사이 틈으로 흩어진다** —
     한 행을 눈으로 따라가는 거리가 길어지는 것이 「지저분함」의 정체다.
     ⚠**각주만 max-width:520px 이었다** — 표는 1900px, 설명문은 520px 이라 폭이 서로 어긋났다.

     ⚠**값의 근거는 실측이다**(2026-08-31 · dist 표 423개): 가장 넓은 표가 **14열**이고
     분포는 5열 152 · 7열 88 · 13열 69 · 14열 2다. 셀은 nowrap 에 좌우 8px 여백이라
     14열이 대략 1,100px 안에 들어간다 — **1180px 면 가장 넓은 표도 가로 스크롤 없이
     들어가고, 그보다 넓어지지도 않는다.**
     ⚠**이 상한 하나가 격자 전부를 같이 고친다** — auto-fit 격자들이 1900px 에서 10~12열로
     흩어지던 것이 4~7열이 된다.
     ⚠**가운데 정렬하지 않는다** — 왼쪽에 구단색 기둥(.spine)이 서 있어서,
     본문만 가운데로 보내면 기둥이 홀로 떨어져 남는다. */
  /* ⚠**고정값이었다가 반응형으로 바꿨다**(2026-08-31 · 사용자 체감:
     「노트북에서는 괜찮은데 27인치에서는 좁아 보인다」).
     1180px 고정이면 2560px 화면에서 **양쪽에 670px 씩** 남아 화면을 안 쓴다.

     · max(1180px, 62vw) — 노트북(1440)에서는 62vw=893 이라 **1180 이 이긴다**(지금 그대로)
     · 1920 에서 1190 · 2560 에서 1587 → 상한 1520 에서 멈춘다
     ⚠**상한을 두는 이유**: 표 대부분이 width:100% 라 더 넓히면 **남는 폭이 다시
     숫자 열 사이로 흩어진다** — 그게 원래 「지저분하다」의 정체였다.
     ⚠**이 값은 눈으로 보고 정했다**(2560·1920·1440 실측 스크린샷). 바꿀 때도 그렇게 하라. */
  --measure:min(1520px,max(1180px,62vw));
  /* 넓은 화면에서 **양쪽에 남는 여백**. 기둥(44px) + 본문(--measure) 을 뺀 나머지의 절반이다.

     ⚠**처음엔 왼쪽 정렬로 뒀고, 브라우저로 보니 틀렸다**(2026-08-31 · 1920px 실측 스크린샷).
     「왼쪽에 구단색 기둥이 있으니 왼쪽 정렬이 어울린다」고 판단했는데, 실제 화면에서는
     **오른쪽 약 700px 가 통째로 빈 채로 남아** 고장처럼 보였다.
     → 여백을 **반으로 갈라 양쪽에** 둔다. 기둥은 본문에 붙은 채로 같이 움직인다.
     ⚠**본문만 가운데로 보내면 안 된다** — 그러면 기둥이 화면 왼쪽 끝에 홀로 남는다.
     그래서 .shell(기둥+본문) 에 건다.
     ⚠**max(0px, …) 로 바닥을 둔다** — 좁은 화면에서 음수가 되면 안 된다. */
  --gut:max(0px,calc((100% - 44px - var(--measure)) / 2));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#8f8e87;
    --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --panel-2:#23262c;
    --warn:#e08a72; --ok:#8fc09c;
    /* ⚠어두운 바탕에서는 같은 색이 탁해진다 — 밝기를 올려 대비를 지킨다 */
    --up:#5fa8dd; --dn:#d98f4a;
    /* 실측 대비 승|무 9.98 · 무|패 3.22 · 승|패 3.09 */
  --bar-w:#bfe0f7; --bar-t:#2b2d33; --bar-l:#b8651f;
  }
}
:root[data-theme="dark"] {
  --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#8f8e87;
  --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --panel-2:#23262c;
  --warn:#e08a72; --ok:#8fc09c;
  /* ⚠어두운 바탕에서는 같은 색이 탁해진다 — 밝기를 올려 대비를 지킨다 */
  --up:#5fa8dd; --dn:#d98f4a;
  /* 실측 대비 승|무 9.98 · 무|패 3.22 · 승|패 3.09 */
  --bar-w:#bfe0f7; --bar-t:#2b2d33; --bar-l:#b8651f;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
/* ⚠**anywhere 였다 → break-word 로 바꿨다**(2026-08-31).
   차이는 「어디서 끊는가」가 아니라 **「최소 폭을 얼마로 보는가」**다:
     · anywhere   … 단어를 쪼개 만든 끊을 자리를 **min-content 계산에도 반영**한다
     · break-word … 넘칠 때만 쪼개고 **최소 폭은 단어 폭을 지킨다**
   그래서 **라틴 문자·긴 영숫자**가 든 칸이 한 글자 폭까지 찌그러지는 것을 막는다.

   ⚠⚠**이것이 「ウィットリー가 세로로 쪼개진」 결함의 수정이라고 쓰지 마라 — 처음에 그렇게 적었고 틀렸다.**
   **일본어는 원래 글자 사이에서 줄이 바뀐다**(writing system 의 기본 줄바꿈 기회이지
   overflow-wrap 이 만든 것이 아니다). 그래서 가나·한자 줄의 min-content 는
   **어느 값에서도 한 글자**다 — 이 줄을 바꿔도 그 결함은 그대로였다.
   **그 결함의 실제 수정은 .roster .hn 의 nowrap + 말줄임과 칸 폭이다**(아래).
   ⚠**넘침 방지는 그대로다** — 긴 URL·연속 영숫자는 여전히 끊어서 가로 스크롤을 안 만든다. */
body{margin:0;background:var(--page);color:var(--tx);font-family:var(--f-body);line-height:1.55;font-feature-settings:"palt" 1;overflow-wrap:break-word}
a{color:inherit}
:focus-visible{outline:2px solid var(--tx);outline-offset:1px}

/* 본문으로 건너뛰기 — 키보드 사용자가 매번 헤더를 지나지 않게 */
.skip{position:absolute;left:-9999px;top:0;z-index:50;background:var(--tx);color:var(--page);padding:var(--s4) var(--s5)}
.skip:focus{left:0}

/* ── 전역 헤더 ─────────────────────────────────────────────
   ⚠검색과 이동이 **어느 화면에서나 손에 닿아야 한다.** 최하단에만 두면
   1000행짜리 순위표 아래에 묻힌다. */
/* ⚠**height 가 아니라 min-height 다.** 고정 높이는 안에 든 것이 넘칠 때 **말없이 넘친다** —
   그게 2026-08-19 감사가 잡은 결함의 형태였다(탭줄이 바 위아래로 삐져나가 첫 행이 화면 밖으로 잘렸다).
   min-height 면 최악의 경우 바가 **자란다**. 자라는 것은 눈에 보이고, 넘치는 것은 안 보인다.
   ⚠**그렇다고 자라도 된다는 뜻은 아니다** — --topbar 를 읽는 곳이 다섯이라 자라면 그쪽이 어긋난다.
   아래 .tnav{flex-wrap:nowrap} 과 반응형의 --topbar 재정의가 **실제로 자라지 않게** 붙든다. */
/* ⚠**띠는 창 끝까지, 내용은 본문 끝까지**(2026-08-31).
   .topbar 와 .seasons 는 .shell 의 **형제**라 폭 상한이 안 걸린다. 본문만 1180px 로 묶으면
   1920px 화면에서 **오른쪽 내비가 본문 끝에서 약 700px 떨어져 뜬다** — 머리와 몸이 따로 논다.
   ⚠**띠 자체를 자르지 않는다** — 배경과 밑줄이 창 중간에서 끊기면 고장으로 보인다.
   → **오른쪽 여백을 키워** 내용만 본문 오른쪽 끝(기둥 44px + --measure)에 맞춘다.
   ⚠**max() 로 바닥을 둔다** — 좁은 화면에서 음수가 되면 안 되고, 기존 12px 여백이 그 바닥이다.
   ⚠**box-sizing:border-box 가 전역이라** 이 계산이 그대로 성립한다. */
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:var(--s4);
  min-height:var(--topbar);padding:0 var(--s5) 0 var(--pad);background:var(--panel);border-bottom:var(--rw-row) solid var(--hair-2);
  padding-left:calc(var(--gut) + var(--pad));padding-right:calc(var(--gut) + var(--s5))}
/* ⚠**줄지 않는다.** 기본 flex 항목은 내용보다 작아질 수 있어, 좁은 화면에서 워드마크가
   제 상자를 넘어 옆 것과 겹친다. 줄어드는 몫은 검색칸(≥681px)과 탭줄(≤680px)이 진다 */
.brand{flex:0 0 auto;font-size:var(--fs-lead);font-weight:var(--w-bold);letter-spacing:.14em;text-decoration:none;white-space:nowrap}
.brand b{color:var(--tx-3);font-weight:var(--w-reg);letter-spacing:.04em;font-size:var(--fs-col);margin-left:var(--s2)}
@media (max-width:560px){.brand b{display:none}}
/* ⚠**::placeholder 규칙이 CSS 전체에 0건이었다**(2026-09-08 · design-auditor P1).
   UA 기본값 rgb(117,117,117) 이 **두 테마 모두에** 새어 라이트 **4.414** · 다크 **3.924**
   (본문 기준 4.5 미달)였다. ⚠**더 무거운 것은 토큰 이탈이다** — 이 색만 디자인 시스템 밖에 있어
   팔레트를 바꿔도 **안 따라온다.**
   ⚠**전역으로 건다** — 입력칸은 상단바(.qbox input · 채움 --page)와 본문(.find input·
   .mfind input · 채움 --panel) 양쪽에 있고, --tx-3 는 둘 다에서 통과한다
   (--page 4.910 / 5.499 · --panel 5.125 / 5.072). */
::placeholder{color:var(--tx-3);opacity:1}
.qbox{position:relative;flex:1 1 auto;max-width:340px;min-width:0}
/* ⚠**검색칸의 경계를 말하는 것이 테두리 하나였다**(2026-09-08 · design-auditor P1 · WCAG 2.2 SC 1.4.11).
   채움(--page)과 상단바(--panel)의 대비가 **라이트 1.044 · 다크 1.084** 라 면으로는 경계가 안 보이고,
   그 하나뿐인 테두리가 --hair-2 로 **1.580 / 1.557** 이었다(비텍스트 3:1 필요).
   ⚠**예외 둘(비활성 · UA 기본)에 해당하지 않는다** — 우리가 그린 활성 입력칸이다.
   ⚠**「hover 에서 진해지니 괜찮다」는 답이 아니다** — 1.4.11 은 **rest 상태**를 잰다.
   → 테두리를 --tx-3 로 올린다: **--panel 대비 5.125 / 5.072 · 채움(--page) 대비 4.910 / 5.499** 로
   감사자의 판정 기준 1(양쪽 3:1)을 두 테마에서 만족한다. hover 는 한 단계 더 진한 --tx-2 로 옮긴다.
   ⚠**같은 잉크의 다른 자리를 같이 끌고 오지 마라** — .tab·.chip·.mv·.go.alt·.hjump a 는
   **가시 텍스트 라벨**이 있어 1.4.11 위반으로 단정할 수 없다(감사자 판정). */
.qbox input{font:inherit;font-size:var(--fs-lead);width:100%;padding:var(--s2) var(--s4);background:var(--page);color:var(--tx);
  border:var(--rw-row) solid var(--tx-3);transition:border-color var(--t1) var(--e-out)}
.qbox input:hover{border-color:var(--tx-2)}
.qhits{position:absolute;left:0;right:0;top:calc(100% + 3px);z-index:30;margin:0;padding:var(--s2) 0;list-style:none;
  background:var(--panel);border:var(--rw-row) solid var(--hair-2);max-height:min(60vh,380px);overflow:auto;
  animation:drop var(--t1) var(--e-out)}
.qhits[hidden]{display:none}
.qhits li a{display:flex;gap:var(--s4);align-items:baseline;padding:var(--s3) var(--s5);text-decoration:none;font-size:var(--fs-lead)}
/* 화살표가 고른 자리. ⚠**aria-selected 로 표시하지 않는다**(2026-08-20) — 이 목록은 listbox 가
   아니고, listbox 밖의 aria-selected 는 낭독기에 깨진 구조로 들린다. 표시는 우리 클래스로 한다 */
.qhits li a:hover{background:var(--panel-2)}
/* 화살표가 고른 자리. ⚠**배경색 하나로 말하지 않는다**(2026-08-22 감사 #18).
   panel 대 panel-2 의 대비는 라이트 1.129 · 다크 1.100 으로 **비텍스트 3:1 의 절반도 안 된다** —
   실측이다. 게다가 hover 와 똑같이 생겨서 「지금 어디에 있는가」가 두 뜻이 된다.
   → **왼쪽 규칙선을 더한다.** tx-3 대 panel-2 는 라이트 4.541 · 다크 4.611 이다.
   ⚠**border 가 아니라 inset box-shadow 다** — border 면 3px 만큼 글자가 밀려
   화살표를 누를 때마다 목록이 흔들린다 */
.qhits li.on a{background:var(--panel-2);box-shadow:inset 3px 0 0 var(--tx-3)}
.qhits li a{flex-wrap:wrap}
.qhits .ht{margin-left:auto;font-size:var(--fs-label);color:var(--tx-3);white-space:nowrap}
/* 등번호. **고정폭 자리를 준다** — 한 자리와 세 자리가 섞이면 이름의 시작선이 들쭉날쭉해진다.
   ⚠없는 사람에게는 요소 자체가 없으므로 이름이 왼쪽으로 붙는다. 그게 「등록 없음」의 표시다 */
.qhits .hu{min-width:2.1em;text-align:right;font-size:var(--fs-note);color:var(--tx-3);
  font-variant-numeric:tabular-nums}
/* 성적은 둘째 줄에. **분모까지 붙어 있다**(M2) — 이 줄의 존재 이유가 「이 사람이 맞나」의 판단이다 */
.qhits .hs{flex-basis:100%;font-size:var(--fs-label);color:var(--tx-2);font-variant-numeric:tabular-nums}
.qhits .none{padding:var(--s3) var(--s5);font-size:var(--fs-data);color:var(--tx-3)}
/* 「몇 명 중 몇 명을 보고 있는가」. ⚠**결과가 아니라 결과에 대한 설명이므로 선을 그어 가른다** —
   같은 모양으로 두면 21번째 선수처럼 보인다. 눌러서 가는 곳(選手一覧)이 있을 때만 링크가 된다.
   ⚠「.qhits li a」보다 클래스가 하나 많아 특이도에서 이긴다(0,2,1 대 0,1,2).
   ⚠**이 파일은 통째로 템플릿 리터럴이다 — 주석에 역따옴표를 쓰면 타입체크가 깨진다**
   (2026-08-19 이 주석을 쓰다가 실제로 깼다. 코드 인용은 「」로 감싼다) */
.qhits .more{border-top:var(--rw-row) solid var(--hair);margin-top:var(--s2);padding-top:var(--s1)}
.qhits .more a,.qhits .more span{display:block;padding:var(--s3) var(--s5);font-size:var(--fs-note);
  color:var(--tx-2);text-decoration:none}
.qhits .more a:hover{background:var(--panel-2);color:var(--tx)}
/* ⚠**탭줄은 접히지 않는다 — 한 줄로 남고 모자라면 옆으로 굴린다.**
   탭이 10개(球団 試合 一覧 順位 対戦 比較 他大会 ドラフト 用語 記録)라 flex-wrap:wrap 이면 좁은 폭에서 2행이 되는데,
   ⚠**이 목록은 낡기 쉽다** — 아래 실측(파손 구간 481~770px)은 **탭 8개일 때**의 값이고,
   그 뒤로 用語(2026-08-21)와 ドラフト(2026-09-05)가 늘었다. **구간을 다시 재지 않았다.**
   막는 것은 구간이 아니라 아래 nowrap + overflow-x 이므로 결론은 안 바뀐다.
   바는 --topbar 높이라 **2행이 들어갈 자리가 없다.** 실측 파손 구간 481~770px(손가락 481~784px).
   ⚠**flex:0 0 auto 가 짝이다**(≥681px). 안 그러면 flex 축소가 검색칸과 탭줄에 **비례 배분**되어
   자리가 남는데도 탭줄이 먼저 잘린다 — 실측으로 681px 에서 탭줄이 305px 로 줄어 굴림이 생겼다.
   여기서는 검색칸만 줄고(→최소 107px) 탭 8개는 온전히 남는다.
   ⚠**≤680px 에서는 뒤집는다** — 검색칸이 제 줄로 내려가므로 탭줄이 줄어드는 쪽이 된다(반응형 참조).
   ⚠overflow-x 는 「그래도 모자랄 때」의 안전판이다. 한 축이 visible 이 아니면 다른 축도
   스크롤 컨테이너가 되므로(이 파일이 표에서 이미 데인 성질) overflow-y:hidden 을 명시하고,
   포커스 링(2px + offset 1px)이 잘리지 않게 위아래 3px 을 비워 둔다.
   ⚠**여기만 스크롤바를 감춘다 — 바로 아래 .seasons 와 반대다.** .seasons 의 주석은
   「숨기면 더 있다는 것을 알 방법이 마우스 유저에게 없다」고 적었고 그건 거기서 옳다.
   여기서 반대로 하는 이유는 하나뿐이다: **이 상자의 높이가 --topbar 라는 계약이기 때문**이다.
   ⚠**실측이 이걸 잡았다**(2026-08-20). headless 크로뮴은 오버레이 스크롤바라 자리를 안 먹는데,
   **화면이 붙은 크로뮴(Windows)은 scrollbar-width:thin 이 9px 을 실제로 차지한다** —
   같은 페이지에서 탭줄 33 → **44px**, 바 88 → **96.6px** 이 됐고 토큰은 88 인 채였다.
   즉 headless 로만 쟀으면 **고친 줄 알고 같은 결함을 다시 냈다.**
   ⚠**더 있다는 신호는 잘린 탭 자체가 낸다** — 마지막 탭이 글자 중간에서 끊긴다(실측 420px 에서 「記」).
   그리고 바로 아래 시즌 띠가 같은 어법으로 스크롤바를 보여 주므로 패턴은 화면에 남아 있다. */
.tnav{display:flex;gap:var(--s1);margin-left:auto;flex-wrap:nowrap;flex:0 0 auto;justify-content:flex-end;
  min-width:0;padding:var(--s1) 0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none}
.tnav::-webkit-scrollbar{display:none}
.tnav a{flex:0 0 auto;font-size:var(--fs-data);padding:var(--s2) var(--s4);text-decoration:none;color:var(--tx-2);white-space:nowrap;
  transition:color var(--t1) var(--e-out),background var(--t1) var(--e-out)}
.tnav a:hover{color:var(--tx);background:var(--panel-2)}
/* ⚠**「지금 여기」가 어느 화면에서나 같은 방식으로 보여야 한다**(2026-08-17 유저 지적:
   「홈화면에 있을때랑 탭이 활성화 되어 있을때 헤더 디자인이 다르다」).
   ⚠**두 단계가 있다** — page(바로 이 화면) 와 true(이 구획 안이지만 다른 화면).
   예전에는 page 만 스타일이 있어서 days.html·starters.html 이 **아무것도 선택돼 보이지 않았다**
   (마크업은 맞고 화면만 비어 있었다). */
.tnav a[aria-current="page"]{color:var(--tx);font-weight:var(--w-bold);box-shadow:inset 0 -2px 0 var(--team,#6b7280)}
.tnav a[aria-current="true"]{color:var(--tx);box-shadow:inset 0 -2px 0 var(--hair-2)}
/* ⚠**홈에서는 표시가 브랜드에 붙는다** — 탭 줄에는 홈 항목이 없기 때문이다.
   여기에 규칙이 없어서 홈만 「아무 데도 안 있는」 것처럼 보였다. 탭과 같은 언어로 표시한다. */
.brand[aria-current="page"]{box-shadow:inset 0 -2px 0 var(--team,#6b7280)}
/* ⚠**「自動」이 「自/動」으로 접혔다**(2026-08-19 감사 P1). 이 버튼은 flex 항목인데
   flex 도 white-space 도 없어서, 자리가 모자라면 **글자에서 줄바꿈**을 했다 —
   실측 43.8×27 → 34.4×**40**. 40px 은 바(44~46px)를 거의 다 먹는다.
   ⚠글자가 두 자라 「줄이면 되겠지」로 보이지만, 줄어드는 것은 폭이 아니라 **높이**다. */
.tbtn{flex:0 0 auto;white-space:nowrap;
  font:inherit;font-size:var(--fs-lead);line-height:1;padding:var(--s3) var(--s4);cursor:pointer;background:transparent;
  color:var(--tx-2);border:var(--rw-row) solid transparent;transition:color var(--t1) var(--e-out)}
.tbtn:hover{color:var(--tx);border-color:var(--hair-2)}

/* ⚠**기둥과 본문을 함께 가운데로**(--gut 주석 참조). 본문만 옮기면 기둥이 홀로 남는다 */
.shell{display:grid;grid-template-columns:44px 1fr;min-height:calc(100vh - var(--topbar));
  padding-inline:var(--gut)}
.spine{background:var(--team,#6b7280);display:flex;flex-direction:column;align-items:center;padding:var(--s6) 0;gap:var(--s6)}
.spine .vt{writing-mode:vertical-rl;font-size:var(--fs-data);letter-spacing:.32em;font-weight:var(--w-bold);color:var(--team-ink,#fff)}
/* ⚠**상한이 없어서 모바일 레이아웃이 1920px 까지 늘어났다**(--measure 주석 참조).
   ⚠**.main 통째로 건다** — 상태 띠·표제 줄·블록이 **같은 폭에서 끝나야** 오른쪽 모서리가
   한 줄로 선다. 안쪽 요소마다 따로 걸면 그 선이 요소마다 어긋난다. */
.main{min-width:0;padding:0 0 var(--s9);max-width:var(--measure)}

/* 상태 띠 — 4상태(M12) 중 「수집실패·낡음」을 여기서 말한다 */
.state{padding:var(--s3) var(--pad);font-size:var(--fs-data);border-bottom:var(--rw-row) solid var(--hair)}
/* ⚠**채움 배경에 흰 글자를 하드코딩하지 않는다**(2026-08-18 감사 P2).
   --warn 은 라이트에서 어두운 벽돌색(#a8452f)이지만 **다크에서는 밝은 살구색**(#e08a72)이라,
   흰 글자를 얹으면 대비가 **2.61:1** 로 떨어진다(AA 본문 4.5:1 은커녕 큰 글자 3:1 도 미달).
   이 파일의 다른 --warn 용례는 전부 「옅은 바탕 위의 글자색」이고 여기만 풀-배경이었다.
   → **글자를 페이지 배경색으로 둔다.** --warn 과 --page 는 언제나 명암이 반대라
   두 모드 다 통과한다 — 실측 라이트 **5.66:1** · 다크 **6.93:1**. */
.state.stale{background:var(--warn);color:var(--page)}
.state.fresh{color:var(--tx-3)}
.state b{font-weight:var(--w-bold)}

/* ── 선수 표제 ───────────────────────────────────────────── */
.idline{display:flex;align-items:center;gap:var(--s5);flex-wrap:wrap;padding:var(--s6) var(--pad) var(--s5);
  border-bottom:var(--rw-mast) solid var(--team,#6b7280)}
/* 식별 마크(成績の紋). 배경은 SVG가 스스로 칠한다 */
.mark{flex:0 0 auto;display:flex;line-height:0}
.mk{display:block}
.mkline{display:inline-block;vertical-align:-3px;margin-right:var(--s3);line-height:0}
.idtext{min-width:0;display:flex;flex-direction:column;gap:var(--s1)}
/* ⚠**표제는 h1 이다.** 크기는 원래 맞았는데 태그가 span 이라, 스크린리더의 헤딩 목록에
   페이지 제목이 없었다(3,257장 중 h1 0장). 여백은 여기서 지운다 — h1 의 기본 여백이 붙으면
   머리줄이 벌어진다 */
.idline .nm{margin:0;font-size:clamp(var(--fs-num),5vw,var(--fs-score));font-weight:var(--w-bold);letter-spacing:.08em;line-height:1.2}
.idline .sub{font-size:var(--fs-sub);color:var(--tx-2);letter-spacing:.06em}
.spark{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:var(--s1)}
.spark svg{display:block;overflow:visible}
.spark .sl{font-family:var(--f-num);font-size:var(--fs-min);color:var(--tx-3);letter-spacing:.06em}
.idline .asof{font-family:var(--f-num);font-size:var(--fs-note);color:var(--tx-3)}

/* 紋을 여는 버튼 — 눌리는 것임을 글자로도 말한다. 도형만 두면 아무도 누르지 않는다 */
.markbtn{padding:0;border:var(--rw-none);background:transparent;cursor:pointer;flex-direction:column;gap:var(--s1);align-items:center}
.markbtn .mkcap{font-size:var(--fs-min);letter-spacing:.12em;color:var(--tx-3);line-height:1;
  border-bottom:var(--rw-row) dotted var(--hair-2);transition:color var(--t1) var(--e-out)}
.markbtn:hover .mkcap,.markbtn[aria-expanded="true"] .mkcap{color:var(--tx)}
.markbtn .mk{transition:box-shadow var(--t1) var(--e-out)}
.markbtn:hover .mk,.markbtn[aria-expanded="true"] .mk{box-shadow:0 0 0 2px var(--tx-2)}

/* ── 成績の紋（확대） ───────────────────────────────────────
   ⚠**꼭짓점을 고르는 판이다.** 표제의 52px 마크는 신원 표시라 꼭짓점이 붙어 있어 못 누른다. */
.markpanel{display:flex;flex-wrap:wrap;gap:var(--s6) var(--s8);align-items:flex-start;
  padding:var(--s5) var(--pad) var(--s6);border-bottom:var(--rw-row) solid var(--hair);background:var(--panel);
  animation:rise var(--t2) var(--e-out) both}
.markpanel[hidden]{display:none}
.mkfigwrap{flex:0 0 auto;width:min(212px,52vw)}
.mkfig{display:block;width:100%;height:auto;overflow:visible}
.mf-grid{fill:none;stroke:var(--hair-2);stroke-width:1}
.mf-spoke{stroke:var(--hair);stroke-width:1;transition:stroke var(--t1) var(--e-out)}
/* ⚠**윤곽은 구단 색이 아니라 글자색 토큰이다**(2026-08-21 감사 P1 · .dia .db.on 과 같은 수술).
   구단 색을 선으로 쓰면 **24조합(12구단 x 2테마) 중 12가 3:1 에 미달**했다:
   라이트 4 — ヤクルト 2.72 / 阪神 1.61 / 巨人 2.79 / ソフトバンク 1.64
   다크 8 — 中日 1.35 / 日本ハム 2.40 / DeNA 2.54 / 西武 1.46 / オリックス 1.08 /
            ロッテ 1.10 / 楽天 1.74 / 広島 2.83. 미달 구단의 합집합은 **12/12** 다.
   ⚠**살이 구제하지 못한다** — fill-opacity .42 를 합성한 뒤에도 **0/24 만 3:1 도달**이고,
   thin 은 fill-opacity 가 0 이라 **점선 윤곽 하나가 도형의 전부**다(배포물 2,314/5,666장).
   --tx-2 는 라이트 6.61 · 다크 6.67 이라 24/24 가 통과한다.
   ⚠**「구단 색을 지켰다」가 아니다 — 살에만 남겼고 그 살은 3:1 을 못 넘는다.**
   그래도 남기는 이유: 이 제품은 **선수 사진도 구단 로고도 엠블럼도 쓸 수 없고**(CLAUDE.md §6),
   대체로 정해 둔 것이 「우리가 계산한 값으로 만든 우리 그림 + 구단 색 마크」다.
   구단 색은 **우리에게 허용된 유일한 신원 신호**라, 대비를 못 벌더라도 살에는 남긴다.
   ⚠더 정직한 안(구단 색을 紋에서 아예 뺀다)도 감사에서 제시됐다. 고르지 않은 것은
   브랜드 규칙 쪽을 우선했기 때문이지, 그 안이 틀려서가 아니다. */
.mf-shape{fill-opacity:.42;stroke:var(--tx-2);stroke-width:1.5;stroke-linejoin:round;
  animation:draw var(--t3) var(--e-out)}
/* ⚠**표본이 얇으면 속을 비운다.** 꽉 찬 도형은 「이만큼이다」라는 단정인데,
   눈금을 맞춘 모집단(타자 50타석·투수 20이닝) 밖에서는 그 단정이 참이 아니다.
   등급이 같은 임계값에서 색을 보류하는 것과 같은 일을 도형에서 한다 */
.mf-shape.thin{fill-opacity:0;stroke-dasharray:4 3}
/* ⚠보이는 점은 작아도 **판정 영역은 손가락 크기**여야 한다 — mf-hit이 그 역할이다.
   손잡이는 둘레에 고르게 있고, 값 표시점(mf-dot)은 도형 위에 따로 있다 */
.mf-hit{fill:transparent}
/* ⚠**이 점은 차트가 아니라 조작 요소다** — 감싸는 .mf-ax 가 role="button" tabindex="0" 이고
   이 점이 **유일한 시각 어포던스**다. 그런데 채움이 --panel(바탕과 같은 색)이라
   선이 곧 전부인데, 그 선이 구단 색이면 다크 オリックス 1.08 · ロッテ 1.10 에서
   **누를 수 있는 것이 화면에 없다.** WCAG 1.4.11 의 user interface components 에는
   「글자로도 제공되면 예외」 조항이 없다 — 판단이 아니라 요구사항이다.
   → 링은 --tx-2 로 고정(24/24 통과). 고른 축의 **채움은 구단 색으로 남긴다** —
   링이 3:1 경계를 만들어 주므로 채움이 어두워도 점 자체는 보인다. */
.mf-dot{fill:var(--panel);stroke:var(--tx-2);stroke-width:2;
  transform-box:fill-box;transform-origin:center;
  transition:transform var(--t1) var(--e-out),fill var(--t1) var(--e-out)}
.mf-lab{font-family:var(--f-body);font-size:var(--fs-note);fill:var(--tx-2);letter-spacing:.06em;
  transition:fill var(--t1) var(--e-out)}
.mf-ax{cursor:pointer}
.mf-ax:hover .mf-dot{transform:scale(1.4)}
.mf-ax:hover .mf-lab{fill:var(--tx)}
.mf-ax:focus-visible{outline:none}
.mf-ax:focus-visible .mf-dot{transform:scale(1.7)}
.mf-ax:focus-visible .mf-lab,.mf-ax:focus-visible .mf-spoke{fill:var(--tx);stroke:var(--tx)}
/* 고른 축 — **점이 커지고 살과 라벨이 진해진다.** 색만으로 말하지 않는다 */
.mf-ax.on .mf-dot{transform:scale(2);fill:var(--team,#6b7280)}
.mf-ax.on .mf-lab{fill:var(--tx);font-weight:var(--w-bold)}
.mf-ax.on .mf-spoke{stroke:var(--tx-2)}

.mkside{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:var(--s4)}
.mkside [data-markpick]{gap:var(--s2)}
.mkside [data-markpick] .tab{font-size:var(--fs-sub);padding:var(--s1) var(--s4)}
.mkread{display:grid;grid-template-columns:auto 1fr;gap:var(--s1) var(--s5);align-items:baseline}
.mkread[hidden]{display:none}
.mkread b{font-size:var(--fs-data);letter-spacing:.14em;color:var(--tx-2);font-weight:var(--w-semi)}
.mkread em{font-style:normal;font-family:var(--f-num);font-variant-numeric:tabular-nums;
  font-size:var(--fs-num);text-align:right}
.mkread p{grid-column:1 / -1;margin:var(--s2) 0 0;font-size:var(--fs-data);color:var(--tx-2);line-height:1.6}
.mkread .mr-how{font-family:var(--f-num);font-size:var(--fs-label);color:var(--tx-3)}
/* ⚠뒤집힌 축의 한마디는 **눈에 띄어야 한다.** 못 보면 도형을 반대로 읽는다 */
.mkread .mr-note{padding-left:var(--s4);box-shadow:inset 2px 0 0 var(--warn);color:var(--tx)}
@media (max-width:520px){
  .markpanel{gap:var(--s5)}
  .mkfigwrap{width:min(190px,58vw);margin:0 auto}
  .mkread em{font-size:var(--fs-title)}
}

/* ── 조작 레일 ───────────────────────────────────────────── */
.rail{position:sticky;top:var(--topbar);z-index:10;display:flex;align-items:center;gap:var(--s3);
  min-height:var(--rail);
  padding:var(--s4) var(--pad);border-bottom:var(--rw-row) solid var(--hair);background:var(--panel);
  overflow-x:auto;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{height:0}
.rail .lbl{font-size:var(--fs-label);letter-spacing:.16em;color:var(--tx-3);white-space:nowrap}
.rail .grow{flex:1 1 auto;min-width:6px}
/* ⚠**쉬고 있는 탭은 테두리를 칠하지 않는다**(2026-09-08 · 2b). 자리는 그대로 잡아 두므로
   레이아웃은 안 움직인다(border-color 만 바꾼다 — width 를 건드리면 줄이 흔들린다).
   ⚠**왜**: 인접한 두 탭이 각자 상자를 그리면 사이에 **1px 선이 두 개** 서고, 실측에서
   그 무리가 화면 8장에 **38개**였다(탭 28 · .hjump a 10). 감사가 「가장 낡아 보이는 요소」로
   짚은 것이 정확히 이 모양이다. 선을 굵게 만드는 대신 **칠해진 테두리에 뜻을 준다 —
   칠해져 있으면 그것이 지금 고른 것이거나 손가락이 얹힌 것이다.**
   ⚠**대비 후퇴가 아니다** — 이 무리는 위 .qbox 주석이 적은 그 판정에서 「가시 텍스트 라벨이 있어
   1.4.11 위반으로 단정할 수 없다」로 분류된 쪽이다. 라벨이 컨트롤을 말하고, 고른 것은
   **배경 + 굵기**가 말한다(색만으로 말하지 않는다 · §7). */
.tab{font:inherit;font-size:var(--fs-data);padding:var(--s2) var(--s4);cursor:pointer;background:transparent;color:var(--tx-2);
  border:var(--rw-row) solid transparent;white-space:nowrap;
  transition:color var(--t1) var(--e-out),background var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.tab:hover{color:var(--tx);border-color:var(--tx-3)}
.tab[aria-pressed="true"],.tab[aria-selected="true"]{background:var(--team,#6b7280);color:var(--team-ink,#fff);
  border-color:var(--team,#6b7280);font-weight:var(--w-bold)}

/* 탭 묶음 — 화면을 아래로 늘리는 대신 골라 본다 */
.tabs{display:flex;gap:var(--s2);flex-wrap:wrap}
/* ⚠**min-width:0 이 이 줄의 핵심이다.** flex 아이템의 min-width 는 기본값이 auto 이고
   그것은 **내용의 최소폭**으로 풀린다. 버튼이 white-space:nowrap 이라 최소폭 = 버튼 폭의 합이 되고,
   그러면 이 줄은 줄어들기를 거부한다 → 부모가 밀리고 **페이지 전체가 옆으로 넓어진다.**
   overflow-x:auto 만 적어두면 아무 일도 일어나지 않는다 — 줄어들 수 있어야 넘칠 수 있다. */
.tabs.scroll{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;
  min-width:0;max-width:100%;padding-bottom:var(--s1);scrollbar-width:thin;
  /* 끝에 닿으면 사라지는 그늘 — 「더 있다」를 말하고, 다 봤으면 말하지 않는다.
     local은 내용과 함께 흐르고 scroll은 상자에 붙는다. 둘을 겹쳐 끝을 감지한다 */
  background:
    linear-gradient(to right,var(--panel) 30%,rgba(0,0,0,0)) left center/22px 100% no-repeat local,
    linear-gradient(to left,var(--panel) 30%,rgba(0,0,0,0)) right center/22px 100% no-repeat local,
    linear-gradient(to right,var(--hair-2),rgba(0,0,0,0)) left center/9px 100% no-repeat scroll,
    linear-gradient(to left,var(--hair-2),rgba(0,0,0,0)) right center/9px 100% no-repeat scroll}
.tabs.scroll::-webkit-scrollbar{height:0}
/* 탭줄을 안는 자리도 줄어들 수 있어야 한다 — 한 곳만 막혀도 위의 규칙이 무효가 된다 */
.rail>.tabs,.block>h2 .sw,.block>h2 .sw>.tabs{min-width:0}

/* 세그먼티드 — 「둘 중 하나」인 상위 전환. 붙여 놓으면 배타성이 형태로 보인다.
   ⚠**줄어들지 않게 flex:none.** 이 줄은 화면의 갈래 자체라 스크롤 밖으로 밀리면 안 된다 */
.tabs.seg{gap:0;flex:none}
/* ⚠**세그먼티드만 테두리를 되살린다**(2026-09-08 · 2b). 위에서 쉬는 탭의 테두리를 껐는데,
   이 줄은 **붙어 있는 상자 모양 자체가 「둘 중 하나」를 말하는** 자리라 끄면 뜻이 사라진다.
   ⚠**여기서는 이중선이 안 생긴다** — 아래 margin-left:-1px 이 두 테두리를 같은 픽셀에 포갠다
   (실측: seg 줄에서 나온 겹침 무리 0개). 끄는 이유가 애초에 없던 자리다. */
/* ⚠**고른 것은 빼야 한다 — 안 빼고 썼다가 회귀를 만들었다**(2026-09-08 실측).
   .tabs.seg .tab 는 (0,3,0) 이라 .tab[aria-selected] (0,2,0) 를 **특이도로 이긴다.**
   ⚠~~특이도가 같아 순서로 이긴다~~ 고 적었는데 **틀린 설명이었다**(검토 P3 · 결과는 옳았다).
   그대로 두면 고른 탭이 채움색 위에 --hair-2 테를 둘러 **채움과 테가 어긋난 고리**가 생긴다
   (실측: 고른 탭 테두리가 rgb(107,114,128) → rgb(207,206,197) 로 바뀌었다).
   ⚠**:where() 로 감싸 특이도를 (0,3,0) 에 묶는다.** 안 감싸면 :not() 안의 속성 선택자가
   각각 (0,1,0) 을 더해 **(0,5,0)** 이 되고, 그러면 .tab:hover (0,2,0) 까지 눌러
   **세그먼티드에서 호버 강조가 죽는다**(검토 P1 · 변경 전에는 살아 있었으니 회귀였다). */
.tabs.seg .tab:where(:not([aria-selected="true"]):not([aria-pressed="true"])){border-color:var(--hair-2)}
/* ⚠**호버를 세그먼티드 안에서 다시 얹는다.** 위 줄이 (0,3,0) 이라 전역 .tab:hover (0,2,0) 로는 못 이긴다.
   이 줄은 (0,4,0) 이라 이긴다 — 「칠해진 테두리 = 고른 것이거나 손가락이 얹힌 것」이 여기서도 성립한다.
   ⚠**여기서도 고른 것을 뺀다 — 안 빼고 썼다가 같은 결함을 호버에서 되살렸다**(실측:
   고른 탭에 손가락을 얹으면 테두리가 채움색 rgb(107,114,128) 에서 rgb(110,110,105) 로 바뀌어
   **채움 위에 어긋난 고리**가 다시 생겼다). 보통 탭에서는 원래 .tab[aria-selected] 가
   같은 특이도의 뒤 규칙이라 이기고 있었다 — 그 성질을 세그먼티드에서도 유지한다. */
.tabs.seg .tab:hover:where(:not([aria-selected="true"]):not([aria-pressed="true"])){border-color:var(--tx-3)}
/* 테두리를 겹쳐 한 줄로 만든다. 겹치면 고른 쪽 테두리가 덮이므로 위로 올린다 */
.tabs.seg .tab+.tab{margin-left:-1px}
.tabs.seg .tab[aria-selected="true"]{position:relative;z-index:1}
/* 레일 안에서 상위 탭을 따라 열리고 닫히는 자리(하위 탭줄).
   ⚠**[hidden] 규칙을 여기서 다시 쓴다** — 위쪽의 display:none 과 특이도가 같아
   나중에 오는 이 display:flex 가 이기기 때문이다. 안 쓰면 숨겨야 할 탭줄이 계속 보인다 */
.rail>[data-panelgroup]{display:flex;align-items:center;gap:var(--s3);min-width:0}
.rail>[data-panelgroup][hidden]{display:none}
.rail .div{flex:none;align-self:stretch;width:1px;margin:calc(-1 * var(--s1)) var(--s1);background:var(--hair-2)}

/* ── 조립 UI ─────────────────────────────────────────────── */
.editor{padding:var(--s5) var(--pad) var(--s6);border-bottom:var(--rw-row) solid var(--hair);background:var(--panel)}
.editor[hidden]{display:none}
/* ⚠**태그를 h2 로 올렸으면 선택자도 따라가야 한다.** 안 그러면 이 제목만
   브라우저 기본 h2(24px + 큰 여백)로 그려진다 — 헤딩 순서를 고치다 만든 결함이다 */
.editor h2{margin:0 0 var(--s1);font-size:var(--fs-data);letter-spacing:.14em;color:var(--tx-2);font-weight:var(--w-semi)}
.editor p{margin:0 0 var(--s5);font-size:var(--fs-sub);color:var(--tx-3)}
.blocks{display:flex;flex-direction:column;gap:var(--s2);max-width:520px}
.brow{display:grid;grid-template-columns:auto 1fr auto auto;gap:var(--s4);align-items:center;padding:var(--s3) var(--s4);
  border:var(--rw-row) solid var(--hair);background:var(--page)}
.brow input[type=checkbox]{accent-color:var(--team,#6b7280);width:16px;height:16px}
.brow .bn{font-size:var(--fs-lead)}
.brow .bd{font-size:var(--fs-note);color:var(--tx-3)}
.mv{font:inherit;font-size:var(--fs-note);padding:var(--s1) var(--s4);cursor:pointer;background:transparent;color:var(--tx-2);
  border:var(--rw-row) solid var(--hair-2);transition:color var(--t1) var(--e-out)}
.mv:hover:not(:disabled){color:var(--tx);border-color:var(--tx-3)}
.mv:disabled{opacity:.3;cursor:default}
.fixed-note{margin-top:var(--s5);padding:var(--s4) var(--s5);border-left:var(--rw-mast) solid var(--warn);background:var(--page);
  font-size:var(--fs-sub);color:var(--tx-2);max-width:520px}
.fixed-note b{color:var(--warn)}

/* ── 블록 ────────────────────────────────────────────────── */
/* ⚠**영역 구분을 더 또렷하게**(2026-08-17 유저 요청). 괘선 하나만으로는 구획이 이어져 보인다.
   카드·그림자·둥근 모서리는 쓰지 않으므로(§6), **여백과 괘선의 무게**로 가른다.

   ⚠**한 칸 걸러 바탕을 바꾸는 방식은 버렸다.** nth-of-type(even) 은 **같은 부모 안의
   형제**를 세는데, 구단 페이지는 구획이 탭 패널 안에 흩어져 있어
   **탭을 바꿀 때마다 줄무늬가 달라졌다**(成績 탭에는 있고 打者 탭에는 없음).
   선수 페이지는 사용자가 블록을 켜고 끄므로 더 심하다 — 위치에 기대는 장식은
   이 화면 구조에서 성립하지 않는다. */
/* ⚠**영역 구분을 더 세게**(2026-08-17 유저 지적: 「각각의 영역별 구분이 너무 약하다」).
   선 하나로는 스크롤 중에 구획이 바뀐 것을 못 알아챈다.
   ⚠**카드로 만들지 않는다**(§6: 균질한 카드 그리드 금지).
   ⚠**「면을 갈라 구분한다」고 적어 놨는데 그 면이 안 갈라진다**(2026-08-18 감사 P3에서 정정).
   --page #fbfaf7 대 --panel #ffffff 는 **1.044:1** 이고, 이 파일 스스로 다른 곳에
   「1.04:1 은 감지 한계 이하」라고 적어 뒀다. 자기가 세운 기준을 자기가 어긴 서술이었다.
   ⚠**색을 더 벌릴 수도 없다** — --page 를 #f4f2ec 까지 어둡게 하면 1.119 로 겨우 오르는데
   그 값이 --panel-2(#f3f1ec)와 **1.006** 이 되어 hover 배경이 사라진다(실측).
   → **실제로 가르는 것은 테두리다**: 1px --hair-2 + 좌측 3px + 사이 16px 여백.
   면은 **거드는 것**이지 근거가 아니다. 구획마다 같은 면을 주므로 탭을 바꿔도 무늬가
   흔들리지 않는다는 이점은 그대로다(예전 nth-of-type 줄무늬가 그래서 깨졌다). */
/* ⚠**패딩을 토큰으로 둔다.** 예전에는 여기에 값을 직접 적었는데,
   밀도 전환 스크립트가 el.style.paddingTop 으로 **인라인 덮어쓰기**를 해서
   이 값이 **한 번도 렌더되지 않았다**(2026-08-17 디자인 감사 P1).
   첫 페인트와 스크립트 뒤가 달라 블록마다 레이아웃이 튀기도 했다. */
/* ⚠**아래 패딩을 위와 같게 둔다**(2026-08-18 유저 지적: 「밑쪽 여백이 불필요하게 길다」).
   예전에는 + 4px 였는데, 구획의 마지막 요소는 대개 .note(작은 글씨)라
   그 아래 여백이 실제보다 더 넓어 보였다 — 글자가 작을수록 빈 공간이 크게 읽힌다.
   ⚠**전 화면에 걸리는 값이다.** 여기만 고치면 모든 구획의 아래가 같이 정돈된다. */
.block{padding:var(--block-pad-y, var(--s7)) var(--pad);background:var(--panel);
  /* ⚠**테두리를 이전보다 흐리게 만들면 안 된다.** 바꾸기 전이 2px --hair-2(1.51:1)였는데
     1px --hair(1.28:1)로 오히려 **약해졌다**(감사 P2 실측). 요청은 「더 강하게」였다. */
  /* ⚠**여기에 구단색을 쓰지 않는다**(2026-08-18 감사 P2). 선수·구단 화면에서는 바로 왼쪽에
     .spine 이 **같은 --team 색**으로 서 있어서, 3px 막대가 기둥에 녹아 신호가 사라졌다.
     게다가 블록 사이 16px 틈마다 색이 끊겨 기둥에 **톱니 모서리**가 생겼다.
     ⚠**구단색은 h2::before 가 계속 나른다** — 그쪽은 var(--pad) 만큼 안쪽이라 기둥과 안 겹친다.
     여기서는 굵기(3px)만 남겨 「구획이 여기서 시작한다」를 말한다. */
  /* ⚠**여기에 --rw-sect(2px)를 주지 마라 — 한 번 줬다가 되돌렸다**(2026-09-08 · 2b).
     구획의 윗변은 **바로 위 요소의 밑줄과 같은 픽셀에 서는 자리**다. 2px 으로 굵히면
     .legend 처럼 CSS 로 닿을 수 없는 경우에 **1px + 2px = 3px 띠**가 되어 오히려 투박해진다
     (닿을 수 없는 이유: 사이에 [hidden] 형제가 있어 DOM 인접과 화면 인접이 다르다 · 실측).
     굵기의 뜻은 **이웃이 없는 자리**에서 준다 — 아래 h2 의 밑줄이 그 자리다. */
  border:var(--rw-row) solid var(--hair-2);border-left:var(--rw-mast) solid var(--hair-2);
  margin-bottom:var(--s6);
  animation:rise var(--t2) var(--e-out) both;animation-delay:calc(var(--i,0) * var(--t-stagger))}
.block[hidden]{display:none}
/* ⚠**바로 위에 조작 줄이 붙는 구획은 자기 윗줄을 내려놓는다**(2026-09-08 · 2b).
   .rail·.legend·.idline 은 각자 border-bottom 을 갖는데 그 아래가 곧바로 구획이라
   **같은 픽셀에 1px 선이 두 개** 서 있었다(실측 8무리 · 간격 0.0px).
   ⚠**지우는 쪽이 구획이지 조작 줄이 아니다** — .rail 은 sticky 라 스크롤 중에 구획에서
   떨어져 나오고, 그때 자기 밑줄이 없으면 본문이 그 밑으로 그냥 흘러 들어간다. */
/* ⚠**구획이 래퍼 안에 있는 경우가 있다** — .rail 다음은 .block 이 아니라
   [data-panelgroup] 이고 구획은 그 안이다(실측).
   ⚠⚠**인접 결합자(+)를 쓰면 안 된다 — 처음에 그렇게 썼다가 검토가 잡았다**(P1 · 2026-09-08).
   패널들은 **전부 .rail 의 뒤 형제**이고 한 번에 하나만 보인다. + 는 **첫 패널만** 맞으므로
   **사용자가 탭을 바꾸는 순간 이중선이 되살아난다.** 실측으로 재현했다:
   팀 화면 日程·打者·投手·対戦 과 순위 화면 個人 에서 보이는 구획의 윗줄이 칠해져 있었다.
   ⚠**내 게이트가 첫 로드만 쟀기 때문에 안 보였다** — 상호작용 뒤 상태를 같이 재라.
   ⚠**:first-child 는 유지한다** — 한 패널에 구획이 여러 개 쌓이는 경우가 있고
   (순위 화면에서 y 244·1132 로 둘), 전부 끄면 **화면 중간 구획의 윗줄이 사라진다.**
   ⚠**죽은 선택자를 적지 마라**(검토 P2). 2시즌 전수 빌드에서 0건이던 것들:
   .rail + .block · .legend + .block · .legend + [data-panelgroup] · .idline + [data-panelgroup].
   .legend 는 애초에 CSS 로 못 닿는다(사이 형제가 [hidden] 이라 DOM 인접 ≠ 화면 인접). */
.idline + .block,
.rail ~ [data-panelgroup] .block:first-child{border-top-color:transparent}
/* ⚠**구획 머리를 더 또렷하게**(2026-08-17 유저 요청: 가시성·영역 구분).
   카드·그림자·둥근 모서리는 쓰지 않는다(§6) — 대신 **짧은 색 막대**와 글자 무게로 가른다.
   막대 색은 그 화면의 구단 색(--chip)이고, 없으면 본문 색이라 어디서든 보인다. */
.block>h2{margin:0 0 var(--s5);font-size:var(--fs-lead);letter-spacing:.16em;color:var(--tx);font-weight:var(--w-bold);
  display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;
  padding:0 0 var(--s4) var(--s5);position:relative;
  /* ⚠**머리 아래에 실선을 둔다** — 제목과 내용의 경계가 없으면 표가 제목에 붙어 읽힌다.
     ⚠**굵기 위계가 여기서 선다**(2026-09-08 · 2b). 여태 구획 경계도 행 구분도 둘 다 1px 이고
     잉크(--hair / --hair-2)로만 갈렸다 — --rw-sect 는 선언만 있고 어디서도 「구획」을 뜻하지 않았다.
     이제 셋이 각각 다른 것을 말한다: **왼쪽 3px = 구획의 기둥 · 여기 2px = 머리와 내용의 경계 ·
     1px = 가장자리와 행.**
     ⚠**이 자리를 고른 이유는 이웃이 없기 때문이다** — 구획 안쪽이라 다른 요소의 밑줄과
     같은 픽셀에 설 수 없다. 구획의 윗변에 주면 겹쳐서 띠가 된다(위 .block 주석).
     ⚠**선을 늘린 것이 아니라 굵힌 것이다** — 같은 커밋에서 겹친 선 47개를 없앴다. */
  border-bottom:var(--rw-sect) solid var(--hair-2)}
/* ⚠**구단 색이 여기까지 온다.** body 에 --team 이 이미 있고(선수·구단 페이지는 그 팀 색,
   그 밖은 중립색), 로고를 못 쓰는 자리에서 팀을 말하는 것이 색이다(§6).
   ⚠**--chip 이 있으면 그쪽이 이긴다** — 구단별 묶음 안에서는 그 구단 색이어야 한다 */
.block>h2::before{content:"";position:absolute;left:0;top:-.05em;bottom:-.05em;width:4px;
  background:var(--chip,var(--team,var(--tx)))}
.block>h2 .sw{display:flex;gap:var(--s2);margin-left:auto;flex-wrap:wrap}
.block>h2 .qt{letter-spacing:0;font-weight:var(--w-reg);color:var(--tx-3)}
[data-panelgroup]{animation:fade var(--t1) var(--e-out)}
/* ⚠**until-found 는 display:none 이면 동작하지 않는다.**
   브라우저 내 찾기(Ctrl+F)가 숨은 패널의 글자를 찾아 **스스로 펼치게** 하려면
   그 상태가 content-visibility:hidden 이어야 한다 — 렌더 트리에는 있고 화면에는 없는 상태다.
   display:none 은 그 기회를 아예 없앤다.
   ⚠**boolean hidden 은 지금까지대로 display:none** 이다. 두 값을 구별해서 쓴다.
   ⚠**이 규칙은 바깥 패널에만 넣는다** — 레일 안의 하위 패널은 접힌 채로 두는 것이 맞다 */
[data-panelgroup][hidden]{display:none}
[data-panelgroup][hidden="until-found"]{display:block;content-visibility:hidden}
/* ⚠**패널에만 준다.** 레일 안의 하위 탭줄도 같은 그룹에 속하는데, 탭줄이 미끄러지면 조작이 흔들린다 */
[data-panelgroup][role="tabpanel"][data-slide="next"]{animation:slideNext var(--t2) var(--e-out)}
[data-panelgroup][role="tabpanel"][data-slide="prev"]{animation:slidePrev var(--t2) var(--e-out)}

.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0 var(--s8)}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;align-items:baseline}
dt{font-size:var(--fs-label);color:var(--tx-2);letter-spacing:.12em;padding:var(--s2) var(--s4) var(--s2) 0;border-bottom:var(--rw-row) solid var(--hair);white-space:nowrap}
dd{margin:0;text-align:right;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:var(--fs-name);
  padding:var(--s2) 0;border-bottom:var(--rw-row) solid var(--hair)}
.den{font-family:var(--f-num);font-size:var(--fs-col);color:var(--tx-3);margin-left:var(--s2)}
/* ⚠**등급 틴트 위에서 분모가 AA 미달이었다**(2026-08-20 감사 ④ · 다크).
   픽셀 합성 실측: --g-vgood-bg rgba(95,168,221,.10) over --panel #1c1e23 = rgb(35,44,54) 이고
   그 위의 --tx-3(#8f8e87 · 10px)가 **4.31:1**, --g-vbad-bg 쪽이 **4.34:1** 이었다(본문 4.5:1 미달).
   라이트는 통과한다(4.65:1). 실물은 starters.html 의 「125回」·「65.1回」다.
   ⚠**이 파일은 바로 위에서 「분모에 opacity 를 얹지 않는다」고 적어 두고,
   등급 배경 틴트로 같은 결과를 만들고 있었다** — 채널만 바뀐 같은 잘못이다.
   ⚠**틴트를 옅게 하는 쪽이 아니라 글자를 올리는 쪽으로 고친다.** 틴트는 「아주 좋음/나쁨」을
   나르는 신호이고, 분모는 M2 가 요구하는 정보다 — 지워야 할 것은 어느 쪽도 아니다.
   --tx-2 는 같은 합성 배경에서 6.3:1 이고, 값(14px --tx)보다 작고 흐리다는 위계는 그대로다. */
dd.g-veryGood .den,dd.g-veryBad .den{color:var(--tx-2)}

/* 보이지 않는 글자 — 색으로만 전하지 않기 위한 것이다. 지우지 마라 */
.vh{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:var(--rw-none)}

/* ── 용어 ──────────────────────────────────────────────────
   ⚠버튼이어야 한다. span+hover로 만들면 터치와 키보드에서 열 방법이 없다. */
.term{font:inherit;color:inherit;letter-spacing:inherit;background:transparent;border:var(--rw-none);padding:0;
  cursor:help;text-align:inherit;
  border-bottom:var(--rw-row) dotted var(--hair-2);transition:border-color var(--t1) var(--e-out)}
.term:hover,.term[aria-expanded="true"]{border-bottom-color:var(--tx-2);border-bottom-style:solid}
th .term{cursor:help}
/* ⚠**손가락은 글자보다 크다.** 항목명은 10.5px라 그대로는 누르기 어렵다.
   가짜 요소로 **판정 영역만** 넓힌다 — 여백을 주면 표의 행 높이가 늘어난다.
   위아래는 5px까지만 — 항목 줄 간격이 25px 남짓이라 더 넓히면 옆 줄의 설명이 뜬다.
   ⚠**@media (pointer:coarse) 밖으로 뺐다**(2026-09-08 · design-auditor P2).
   그 안에 있어서 마우스에서는 판정 영역이 **22 × 17** 이었다 — WCAG 2.2 SC 2.5.8 의 24 × 24 미달이고,
   그 기준에는 「포인터가 정밀하면 면제」가 없다. 넓힌 뒤 **36 × 27**(가로 +7·+7 · 세로 +5·+5).
   ⚠**CSS 문자열 검사로는 못 잡는다** — 규칙은 그대로 있고 **어느 미디어 안에 있는가**만 달랐다. */
.term{position:relative}
.term::after{content:"";position:absolute;left:-7px;right:-7px;top:-5px;bottom:-5px}
.term:active{border-bottom-color:var(--tx);border-bottom-style:solid}

/* ⚠**넘치면 잘라서 굴린다.** 예전에는 max-height 도 overflow 도 없었고 자리잡기가 아래를
   클램프하지 않아서, 가장 긴 설명(火消し率 555px)이 **6/6 뷰포트에서 화면 밖으로** 나갔다.
   실측(2026-08-21 · 한 선수 페이지에서 열리는 용어 27개 · 중앙값 153px · 200px 초과 8/27):
   320x568 에서 358px 초과 · 280x653 316 · 360x640 322 · 390x844 220 · 768x700 271 · 1280x900 171.
   폭이 min(30ch,86vw) 라 **좁을수록 세로로 길어진다** — 280px 폭에서도 폭은 200px 로 풀린다.
   ⚠**실제 max-height 는 스크립트가 자리마다 계산해 얹는다**(위/아래 중 넓은 쪽이 다르다).
   여기 값은 스크립트가 못 도는 경우의 바닥이다.
   ⚠**overscroll-behavior 로 안쪽 스크롤을 가둔다** — 안 그러면 설명 끝에서 페이지가 따라 움직인다.
   ⚠**4문장짜리 caveat 는 툴팁이 담을 그릇이 아니다**(2026-08-21 감사 지적). 제대로 된 답은
   용어집 페이지를 따로 두는 것이지만 그건 범위가 다른 별개 결정이다 — 여기서는 읽을 수 있게만 한다. */
#tip{position:absolute;z-index:40;max-width:min(30ch,86vw);max-height:70vh;padding:var(--s4) var(--s5);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
  background:var(--tx);color:var(--page);font-size:var(--fs-data);line-height:1.5;
  box-shadow:0 2px 10px rgba(0,0,0,.22);animation:drop var(--t1) var(--e-out)}
#tip[hidden]{display:none}
#tip b{display:block;font-size:var(--fs-data);letter-spacing:.06em;margin-bottom:var(--s1)}
#tip s{display:block;text-decoration:none;font-family:var(--f-num);font-size:var(--fs-label);opacity:.72;margin-top:var(--s2)}
#tip u{display:block;text-decoration:none;font-size:var(--fs-sub);margin-top:var(--s2);
  padding-left:var(--s3);box-shadow:inset 2px 0 0 var(--warn)}

/* ── 수준 색 ───────────────────────────────────────────────
   ⚠**빨강↔초록을 쓰지 않는다.** 가장 흔한 색각 이상에서 구별되지 않는다.
   파랑↔주황의 발산 배색을 쓰고, 명도도 함께 벌려 흑백에서도 순서가 남게 한다.
   ⚠색은 **보조**다. 등급 자체는 보이지 않는 글자(.vh)로도 나간다. */
:root{
  --g-vgood:#1b6ca8; --g-good:#7aaed0; --g-avg:#c9c7c0; --g-bad:#e2a86a; --g-vbad:#b8651f;
  --g-vgood-bg:rgba(27,108,168,.07); --g-vbad-bg:rgba(184,101,31,.09);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --g-vgood:#5fa8dd; --g-good:#3d7ba6; --g-avg:#4a4d54; --g-bad:#a8703a; --g-vbad:#d98f4a;
    --g-vgood-bg:rgba(95,168,221,.10); --g-vbad-bg:rgba(217,143,74,.10);
  }
}
:root[data-theme="dark"]{
  --g-vgood:#5fa8dd; --g-good:#3d7ba6; --g-avg:#4a4d54; --g-bad:#a8703a; --g-vbad:#d98f4a;
  --g-vgood-bg:rgba(95,168,221,.10); --g-vbad-bg:rgba(217,143,74,.10);
}
dd.v{transition:box-shadow var(--t1) var(--e-out)}
dd.g-veryGood{box-shadow:inset 0 -3px 0 var(--g-vgood);background:var(--g-vgood-bg)}
dd.g-good{box-shadow:inset 0 -3px 0 var(--g-good)}
dd.g-average{box-shadow:inset 0 -3px 0 var(--g-avg)}
dd.g-bad{box-shadow:inset 0 -3px 0 var(--g-bad)}
dd.g-veryBad{box-shadow:inset 0 -3px 0 var(--g-vbad);background:var(--g-vbad-bg)}
/* 색 끄기 — 취향이다. 분모는 끌 수 없지만 색은 보조이므로 끌 수 있다 */
:root[data-grades="off"] dd.v{box-shadow:none;background:transparent}

/* 범례 — 색이 무엇을 뜻하는지 말한다. 말하지 않으면 색은 장식이다 */
.legend{display:flex;align-items:center;gap:var(--s5);flex-wrap:wrap;
  padding:var(--s3) var(--pad);border-bottom:var(--rw-row) solid var(--hair);background:var(--panel-2);
  font-size:var(--fs-label);color:var(--tx-2)}
/* ⚠**첫 색 블록이 「水準」의 것처럼 읽혔다**(2026-08-18 유저 지적).
   묶음 안쪽 간격(5px)과 바깥 간격(11px)이 너무 비슷해서, 라벨 다음에 오는
   とても悪い 의 견본이 **라벨에 붙은 블록**으로 보였다.
   → 라벨과 눈금 사이에 **세로선**을 넣어 「여기부터가 눈금」임을 형태로 말한다. */
.legend .lg{letter-spacing:.16em;color:var(--tx-3);white-space:nowrap}
.legend .lg:first-child{border-right:var(--rw-row) solid var(--hair-2);padding-right:var(--s5)}
.legend .tail{margin-left:auto}
/* ⚠**눈금은 이어져 있어야 눈금으로 읽힌다**(2026-08-18 유저 지적).
   예전에는 색과 글자가 번갈아 놓여서 ⑴ 첫 색이 「水準」에 붙은 것으로 읽히고
   ⑵ 다섯 칸이 **한 축**이라는 것이 보이지 않았다.
   → 양 끝에만 글자를 두고 가운데 색을 **틈 없이** 붙인다. */
.legend .scale{display:inline-flex;align-items:center;gap:var(--s3);white-space:nowrap}
.legend .send{font-weight:var(--w-reg);color:var(--tx-2)}
.legend .bar{display:inline-flex;height:9px;border:var(--rw-row) solid var(--hair-2)}
/* ⚠**틈을 두지 않는다** — 틈이 있으면 다섯 개의 점이지 하나의 축이 아니다 */
.legend .bar i{display:block;width:17px;height:100%;background:var(--g-avg)}
.legend .bar i.g-veryGood{background:var(--g-vgood)}
.legend .bar i.g-good{background:var(--g-good)}
.legend .bar i.g-bad{background:var(--g-bad)}
.legend .bar i.g-veryBad{background:var(--g-vbad)}
.legend #gradeBtn{font-size:var(--fs-note);padding:var(--s1) var(--s4)}
/* 색을 끄면 범례의 견본도 함께 죽는다 — 안 쓰는 안내가 남아 있으면 그것도 거짓말이다 */
:root[data-grades="off"] .legend .bar{opacity:.3}
@media (max-width:620px){.legend .tail{display:none}}
/* 좁은 화면 — 가운데 세 칸의 글자를 접고 견본만 남긴다. 양 끝(とても悪い↔とても良い)이
   남으므로 눈금의 뜻은 그대로 읽힌다. 다섯 줄을 다 늘어놓으면 성적이 화면 밖으로 밀린다 */
@media (max-width:520px){
  .legend{gap:var(--s3)}
  .legend .sw{gap:0}
  .legend .sw.g-bad b,.legend .sw.g-average b,.legend .sw.g-good b{display:none}
  .legend .sw.g-veryBad i{margin-right:var(--s2)}
  .legend .sw.g-veryGood i{margin-right:var(--s2)}
}
.rank{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:var(--w-bold);padding:0 var(--s2);font-size:var(--fs-col);
  margin-left:var(--s3);font-family:var(--f-body)}

/* 선발·구원별 — 두 단이 각자의 제목을 갖는다. 제목이 없으면 어느 쪽 숫자인지 알 수 없다 */
/* 격리 원문 — 코드가 아니라 **원본 그대로의 글자**임을 보이게 한다 */
.qs{font-family:var(--f-num);font-size:var(--fs-note);background:var(--panel-2);padding:var(--s1) var(--s2);white-space:nowrap}
.qd{font-size:var(--fs-label);color:var(--tx-3)}
/* ⚠**크기를 명시한다.** 원래 h5 의 기본값(0.83em)에 기대고 있었는데 h3 로 올리면서
   1.17em 이 되어 41% 커졌다 — 블록 제목(10.5px)보다 커진다. 태그에 기대지 않는다 */
.rolecol .subhead{margin:0 0 var(--s2);font-size:var(--fs-note);letter-spacing:.1em;color:var(--tx-2);font-weight:var(--w-semi)}
.rolecol dl{margin:0}

/* ⚠좁은 화면에서 표를 옆으로 밀면 **누구의 행인지**가 먼저 사라진다.
   첫 열을 고정해서 이름이 남게 한다. 오른쪽 끝의 그늘은 「더 있다」는 신호다. */
.scroller:focus-visible{outline:2px solid var(--tx);outline-offset:-2px}
.scroller{overflow-x:auto;-webkit-overflow-scrolling:touch;position:relative;
  background:linear-gradient(to left,var(--page),rgba(0,0,0,0) 24px) right center / 24px 100% no-repeat}
.scroller table{background:var(--page)}
.scroller th:first-child,.scroller td:first-child{position:sticky;left:0;z-index:1;background:var(--page)}
.scroller tr.me td:first-child{background:var(--team,#6b7280)}
.scroller tbody tr:hover td:first-child{background:var(--panel-2)}
/* ⚠**앵커가 고정 머리 아래로 들어가지 않게 한다.** #pc-nipponSeries 처럼 깊은 링크로
   들어오면 브라우저는 대상을 화면 맨 위에 두는데, 그 자리는 topbar 가 덮고 있다 —
   눌러서 왔는데 찾던 것이 안 보인다 */
html{scroll-padding-top:calc(var(--topbar) + var(--s4))}
/* 탭줄이 있는 화면은 그 높이만큼 더 비운다.
   ⚠**topbar 만 빼면 모자란다** — 順位·타대회는 topbar 아래에 탭줄이 한 겹 더 sticky 로 얹힌다.
   #pc-nipponSeries 로 들어오면 제목과 첫 줄이 그 탭줄 뒤로 가린 채 멈춘다.
   :has() 를 모르는 브라우저는 위의 기본값으로 떨어질 뿐이라 더 나빠지지 않는다 */
html:has(.rail){scroll-padding-top:calc(var(--topbar) + var(--rail) + var(--s4))}

table{border-collapse:collapse;width:100%;font-size:var(--fs-data)}
th,td{padding:var(--s2) var(--s4);text-align:right;font-variant-numeric:tabular-nums;border-bottom:var(--rw-row) solid var(--hair);white-space:nowrap}
th{font-size:var(--fs-col);letter-spacing:.1em;color:var(--tx-2);font-weight:var(--w-reg)}
/* ⚠**머리 고정은 thead 에만 건다.** th 전체에 걸면 tbody 의 **행 머리**(이닝 스코어의
   구단명 칸)까지 붙어 자기 행을 떠난다 — 표가 고장 난 것으로 보인다.
   실측(2026-08-16): 사이트에서 scope=row 를 쓰는 표는 이닝 스코어 하나뿐이다.

   ⚠**세로 오프셋(top)을 주지 않는다. 주면 헤더가 표 안으로 내려앉는다.**

   2026-08-16 에 top:var(--topbar)(탭줄이 있으면 +var(--rail))를 걸었는데,
   그것이 **유저가 본 「헤더가 내용 중간에 끼거나 겹친다」의 원인**이었다(2026-08-17 지적).

   이유: 우리 표는 전부 .scroller 안에 있고 .scroller 는 overflow-x:auto 다.
   한 축이 visible 이 아니면 **다른 축도 auto 로 계산**되므로 .scroller 는
   **세로로도 스크롤 컨테이너**가 된다. position:sticky 의 기준(scrollport)은
   **화면이 아니라 가장 가까운 스크롤 컨테이너**이므로:
     · 화면을 굴려도 머리는 붙지 않는다 — 의도한 효과는 **처음부터 없었다**
     · 대신 머리가 그 상자의 위에서 46px(탭줄이 있으면 94px) **아래로 밀려** 본문 행을 덮는다

   실측(2026-08-17): 검사한 121개 표가 **121/121 .scroller 안**이다.
   즉 이 오프셋은 이득이 0이고 손해만 있었다.

   ⚠**그래도 position:sticky 는 남긴다** — 첫 열 머리가 left:0 으로 **가로** 고정되어야 하고
   (.scroller th:first-child), 배경·쌓임 순서도 여기서 나온다.
   세로 고정을 진짜로 되살리려면 .scroller 에 높이를 주고 표 안쪽에서 굴리게 해야 하는데,
   그건 화면 설계를 바꾸는 일이라 별도 판단이 필요하다 */
thead th{position:sticky;z-index:2;background:var(--page)}
/* ⚠**모서리 칸이 제일 위여야 한다.** 가로·세로 양쪽으로 고정되는 칸은 첫 열의 머리 하나뿐인데,
   .scroller th:first-child(z-index:1)가 특이도에서 이겨 **다른 머리 칸(2)이 그 위를 지나간다** —
   가로로 밀면 고정된 첫 열의 머리만 사라진다. 본문 칸은 멀쩡해서 더 이상하게 보인다.
   2026-08-16 자기 수정이 만든 결함이다: 그 전에는 th 자체에 z-index 가 없어 모서리가 위였다 */
.scroller thead th:first-child{z-index:3}
/* 행 머리는 「머리」가 아니라 **그 행의 이름**이다. 10px 대문자 간격으로 그리면
   구단명이 열 제목처럼 작아져 옆 칸의 숫자와 크기가 어긋난다 */
tbody th{font-size:var(--fs-data);letter-spacing:0;color:var(--tx);font-weight:var(--w-reg)}
td.l,th.l{text-align:left}
tbody tr{transition:background var(--t1) var(--e-out)}
tbody tr:hover{background:var(--panel-2)}
tr.me td{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:var(--w-bold)}
tr.me:hover td{background:var(--team,#6b7280)}
/* ⚠**강조면 위에서는 면의 잉크에 맞춘다**(2026-09-08 · design-auditor P0).
   tr.me td 는 배경을 구단 색으로 칠하는데 그 안의 분모(.den)만 --tx-3 를 그대로 들고 있어서
   **면과 거의 같은 색이 됐다.** 실측(ranking.html · 그 화면의 --team 은 중립색 #6b7280):
   **라이트 1.060 · 다크 1.470** · 10px. **값은 4.547 로 보이고 분모만 안 보였다.**
   ⚠**우연이 아니다** — --tx-3 를 12구단 색 위에 얹으면 **라이트 12/12 · 다크 10/12 가 4.5 미달**이다.
   ⚠**지금은 9장(ranking.html × 9시즌)이지만 tr.me 행은 배포물에 83,808개**다(실측 2026-09-08) —
   그 행에 비율을 하나 더 넣는 순간 같은 결함이 그 수만큼 생긴다.
   ⚠**--team-ink 의 여유는 얇다**: 12구단 최저 **5.466**(広島) · **중립색 4.547** 로 기준 4.5 바로 위다.
   css-contrast.test.ts 가 12구단 + 중립색 × 2테마로 계속 잰다.
   ⚠**특이도에서 이 규칙을 이기는 .den 색 규칙이 둘 있다**(table.stand td.wd .den ·
   .hstand td.wd .den · 둘 다 (0,3,2)). **그 두 표에는 tr.me 가 없다**(실측) —
   생기면 여기가 **조용히 진다.** 시험이 「그 둘뿐인가」를 못 박는다. */
tr.me td .den{color:var(--team-ink,#fff)}
/* ⚠**「얇음」을 대비 강등으로 말하지 않는다.**
   --tx-3 이 붙는 것은 분모(.den)·자격 기준과 표본 경고(.note)·규정 미달 행인데,
   실측(2026-08-16) 대비가 라이트 3.20:1 · 다크 4.20:1 이었다 —
   **M2가 요구하는 바로 그 정보가 화면에서 가장 안 읽혔다.** 구단 페이지는 표의 86%가 그 색이다.
   토큰 명도를 올리고(색상환은 그대로라 인쇄물의 질감은 남는다), 얇음은 **다른 채널**로 말한다 */
tr.thin td{color:var(--tx-2)}
/* ⚠**막대가 안 보이는 굵기였다**(2026-08-20 감사 ③). --hair-2 대 --page 가
   **라이트 1.51:1 · 다크 1.69:1** 로 비텍스트 3:1 에 한참 못 미쳤다 —
   즉 「薄く表示しています」라는 범례가 자기 화면에 대해 거짓이었다.
   --tx-3 은 --page 기준 4.9:1 이라 통과한다(막대는 장식이 아니라 표식이다).
   ⚠**그래도 이 채널만으로는 부족하다** — forced-colors: active 에서 box-shadow 는 none 이 되고
   color 도 시스템 색으로 강제되어 **두 채널이 함께 죽는다.** 그래서 이름 옆에 글자 표식(.qmk)을 둔다.
   구단 페이지 타자표에는 ranking.html 의 順位 열 같은 제3의 채널이 없다.
   ⚠**「그래서 .qmk 를 둔다」를 전칭으로 읽지 마라**(2026-09-08 정정). tr.thin 을 그리는 자리는
   **6곳이고 그중 3곳**만 그 표식을 붙인다 — 선수 페이지의 세 표는 안 붙인다(둘은 막대 흐림이 대신하고,
   対戦成績 표는 **아무것도 없다**). 그 셈은 forced-colors.test.ts 가 소스에서 다시 센다. */
tr.thin td:first-child{box-shadow:inset 2px 0 0 var(--tx-3)}
/* 「薄く」의 글자 표식 — **어떤 색 모드에서도 남는다.** 범례가 같은 글자를 쓴다 */
.qmk{font-style:normal;font-size:var(--fs-note);color:var(--tx-2);margin-left:var(--s2)}
/* 구단 색 칩 — ~~**모든 표가 같은 한 벌을 쓴다**(M1의 정신)~~ **거짓이었다**(2026-08-25 · 감사 P3 #33).
   실측: 구단 색 스와치 규칙이 **9벌**이고 **크기 5종**(8·9·10·11·12px) · **링 4 · 없음 5**다
   (그 밖에 3px 막대 .gstars li i 하나와 4px 띠 둘이 더 있지만 스와치가 아니다).
   여기 적힌 「한 벌」은 아래 .tm i 하나를 가리키고, 그건 **네 화면이 공유한다**는 뜻이다 —
   ⚠**바로 다음 문장이 그 좁은 뜻을 이미 적고 있는데 첫 줄이 전칭으로 부풀어 있었다.**

   ⚠**그래도 링을 전부에 붙이지 않는다.** 링은 대비 보증인데, 실측으로
   **칩이 홀로 서는 자리가 0건**이다(dist 9,081장 · 칩 자리 **49,067개** · 뒤에 아무것도 없는 것 0).
   전부 바로 뒤에 구단 이름 글자가 온다 — 즉 칩은 **정보를 나르지 않는 장식**이다.
   ⚠**예외가 하나 있었고 이미 고쳐져 있다**: .gstars li i 는 막대가 유일한 구단 표시였고
   (2026-08-21 감사 P1) 그래서 링과 낭독용 이름을 함께 갖는다. **링은 「홀로 설 때」 붙는다.**
   → 남은 것은 **미관 불일치**이지 접근성 결함이 아니다. 통일은 값이 아니라 손질이다.
   ⚠**셀을 flex 컨테이너로 만들지 않는다.** td{display:flex} 는 그 칸을 테이블 셀 박스에서
   빼내어, **그 열만 아래 경계선이 다른 열과 어긋난다**(2026-08-16 실측: 순위표 球団 열).
   ⚠전에는 이 규칙이 .stand·.iscore 안에만 있어서 **ポストシーズン 표의 칩은
   아예 그려지지 않았다** — <i> 는 인라인이라 width/height 가 먹지 않는다.
   네 화면(順位·イニングスコア·ポストシーズン 타자표·투수표)이 이 한 벌을 쓴다 */
.tm i{display:inline-block;width:9px;height:9px;margin-right:var(--s3);vertical-align:middle;
  background:var(--chip,#6b7280);box-shadow:inset 0 0 0 1px var(--tx-2)}
td a{text-decoration:none;box-shadow:inset 0 -1px 0 var(--hair-2)}
td a:hover{box-shadow:inset 0 -1px 0 currentColor}

/* 정렬 가능한 머리 — **버튼이다.** 클릭만 되고 초점이 안 가는 머리를 만들지 않는다 */
th:has(.sortable){padding:0}
.sortable{font:inherit;font-size:var(--fs-col);letter-spacing:.1em;color:var(--tx-2);background:transparent;
  border:var(--rw-none);cursor:pointer;padding:var(--s2) var(--s4);width:100%;text-align:inherit;white-space:nowrap;
  display:inline-flex;align-items:center;gap:var(--s1);justify-content:flex-end;
  transition:color var(--t1) var(--e-out)}
th.l .sortable{justify-content:flex-start}
.sortable:hover{color:var(--tx)}
/* ⚠**opacity 로 흐리지 않는다**(2026-08-25 · 감사 P3 #31).
   ~~opacity:.3~~ 이었고, --tx-2 위에 얹으면 실효 대비가 **라이트 1.554 · 다크 1.765** 였다 —
   UI 표시에 필요한 **3:1** 의 절반이다. ↕ 는 「이 열은 정렬할 수 있다」를 말하는 **유일한 신호**라
   안 보이면 그 기능이 없는 것과 같다.
   ⚠**색을 낮춰서 위계를 지킨다** — 지우면 정렬 안 된 표시가 정렬된 것과 같은 세기가 된다.
   실측: --tx-3 **4.910 / 5.499**(통과) 대 정렬됨 --tx **17.139 / 14.736**. 위계는 그대로다.
   ⚠**opacity 는 계산을 거짓으로 만든다** — 그래서 목록(css-contrast.test.ts 의 OPACITY_ALLOWED)이
   이 선택자를 「도형 대비는 별건으로 미검증」이라 적어 두고 있었다. 그 미검증이 이것이었다. */
.sortable i{font-style:normal;width:7px;color:var(--tx-3)}
.sortable:hover i{color:var(--tx)}
.sortable i::before{content:"↕"}
th[aria-sort="ascending"] .sortable,th[aria-sort="descending"] .sortable{color:var(--tx);font-weight:var(--w-bold)}
th[aria-sort="ascending"] .sortable i,th[aria-sort="descending"] .sortable i{color:inherit}
th[aria-sort="ascending"] .sortable i::before{content:"↑"}
th[aria-sort="descending"] .sortable i::before{content:"↓"}
@media (pointer:coarse){.sortable{padding:var(--s4) var(--s4)}}

.pa{font-size:var(--fs-sub);letter-spacing:.02em}
.pa.h{color:var(--warn);font-weight:var(--w-bold)}

.dg{display:grid;grid-template-columns:66px repeat(3,minmax(56px,1fr));gap:var(--s1);min-width:300px}
.dg .h{font-size:var(--fs-col);letter-spacing:.1em;color:var(--tx-3);text-align:center}
.dg .rl{font-size:var(--fs-note);color:var(--tx-2);display:flex;align-items:center}
.dg .c{border:var(--rw-row) solid var(--hair);padding:var(--s2) var(--s1);text-align:center;font-family:var(--f-num);font-variant-numeric:tabular-nums}
.dg .c u{display:block;text-decoration:none;font-size:var(--fs-lead)}
.dg .c s{display:block;text-decoration:none;font-size:var(--fs-min);color:var(--tx-3)}
.dg .c.thin u{color:var(--tx-2)}

.bars{display:flex;flex-direction:column;gap:var(--s3);max-width:480px}
.bar{display:grid;grid-template-columns:84px 1fr 132px;gap:var(--s4);align-items:center}
.bar span{font-size:var(--fs-sub);color:var(--tx-2)}
/* 스플릿 표의 막대 열. ⚠**막대를 표 안에 남긴 이유**: 「対左 대 対右」를 한눈에 보는 것이
   이 블록의 존재 이유다. 표만 두면 두 칸을 눈이 아니라 머리로 비교하게 된다.
   ⚠**폭을 여기서 준다** — track 은 원래 bar 그리드의 남은 칸에 기대고 있었고,
   표 안에서는 그 부모가 없어 **폭 0 이 된다.**
   ⚠**이 파일 안에서 백틱을 쓰지 마라** — 파일 전체가 하나의 템플릿 리터럴이라
   백틱 하나가 문자열을 끊는다(template-literals.test.ts 가 지킨다). */
/* ⚠**남는 폭을 어디로 보낼 것인가**(2026-08-31 · 브라우저로 보고 두 번 고쳤다).
   표가 width:100% 라 여유는 반드시 어딘가로 간다. 그냥 두면 **숫자 열 사이 틈으로 흩어져**
   한 행을 눈으로 따라가는 거리가 길어진다 — 그게 「PC 가 지저분하다」의 정체였다.

   ⚠**첫 판에는 막대에 몰아줬고, 실제로 그려 보니 틀렸다**(1920px 스크린샷).
   막대가 표의 절반을 먹었는데 **.557 과 .521 의 길이 차이는 눈에 안 보였다** —
   자리는 가장 많이 쓰면서 정보는 거의 안 더한다.
   → **막대는 읽을 수 있을 만큼만**(고정 폭) 두고, 여유는 **맨 왼쪽 구분 이름**이 먹는다.
   왼쪽 끝의 여백은 눈이 지나가는 자리라 **거리를 늘리지 않는다.** */
.spl{width:auto}
/* 막대와 값을 한 줄에. ⚠**flex 는 셀(td)이 아니라 이 래퍼에 건다** — 셀을 flex 로 만들면
   그 칸이 테이블 박스에서 빠져나와 아래 경계선이 다른 칸과 어긋난다(css-tables 가 막는 결함) */
.spl td .tv{display:flex;align-items:center;gap:var(--s4)}
/* ⚠**막대는 읽을 만큼만.** 늘려도 정보가 안 늘고 자리만 먹는다(위 주석 · 실측으로 확인했다).
   좁은 화면에서는 줄어들되 실오라기가 되지 않게 바닥을 둔다. */
.spl td .tv .track{flex:0 1 140px;min-width:72px}
/* ⚠값은 줄어들지 않는다 — 막대가 먼저 줄어야 수가 읽힌다 */
.spl td .tv .wd{flex:0 0 auto;text-align:right}
.spl th:nth-child(2),.spl td:nth-child(2){padding-left:0}
/* ⚠**얇은 표본을 흐림으로 말하지 않는다 — opacity 를 뺐다**(2026-09-08 · design-auditor P0).
   ⚠**여기 적혀 있던 「라이트 5.56 · 다크 6.45」는 틀린 수였다.** 그 수는 --tx 를 --panel 위에
   .65 로 합성한 값인데, **실제 잉크는 tr.thin td 의 --tx-2 이고 바탕은 --page** 다
   (.scroller table{background:var(--page)} · 스플릿 표는 .scroller 안에 있다).
   **두 오차가 같은 방향으로 겹쳐 2.9 를 5.6 으로 보이게 했다.** 다시 잰 값:
   값(--tx-2) **라이트 2.917 · 다크 3.758** · 분모(.den = --tx-3 · 10px) **2.545 / 3.045**.
   ⚠**M2 가 요구하는 바로 그 분모가 화면에서 가장 안 읽혔다** — 「표본이 얇으니 값을 믿지 마라」를
   말하는 행에서 그 경고를 싣는 분모가 가장 안 보였다.
   → **흐림을 빼고 형태로 말한다.** 이 표에서 얇음을 말하는 채널은 셋이고, 전부 남는다:
   ⑴ tr.thin td 의 --tx-2(6.336 / 7.229 · 보통 행의 --tx 17.139 / 14.736 과 위계가 남는다) ·
   ⑵ 첫 칸의 inset 2px 괘선 · ⑶ 막대(.track i)의 인라인 opacity:.35 — **도형이라 글자 기준이 안 걸린다.**
   ⚠**.qmk 를 여기 세지 마라** — 그 글자 표식은 명단·순위 표의 것이고 **스플릿 표에는 0건**이다
   (실측: 한 선수 페이지의 spl 표 8개 · thin 행 13개 중 .qmk 보유 0). 뺀 뒤 분모는 **4.910 / 5.499**.
   ⚠**다시 얹지 마라** — css-contrast.test.ts 의 OPACITY_ALLOWED 는 이제 **문자열이 아니라 계산**이라
   얹는 순간 그 자리에서 값을 다시 센다. */
.track{height:13px;background:var(--hair)}
.track i{display:block;height:100%;background:var(--team,#6b7280);transform-origin:left center;
  animation:grow var(--t3) var(--e-out) both}
.bar em{font-style:normal;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:var(--fs-data);text-align:right}
/* 상대전적 좁히기 */
.mfind{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;margin:0 0 var(--s4)}
.mfind label{font-size:var(--fs-label);letter-spacing:.14em;color:var(--tx-3)}
/* ⚠**검색칸(.qbox input)과 같은 결함이고 여기가 더 나쁘다**(2026-09-08 · design-auditor · WCAG 2.2 SC 1.4.11).
   이 좁히기 줄은 .block(--panel) 안에 있고 칸의 채움도 --panel 이라 **채움 대 둘러싼 면이 정확히 1.000** —
   즉 **경계를 말하는 것이 테두리 하나뿐**인데 그게 --hair-2 로 **라이트 1.580 · 다크 1.557** 이었다(3:1 필요).
   ⚠**예외 둘(비활성 · UA 기본)에 해당하지 않는다** — 우리가 그린 활성 입력칸이다.
   ⚠**hover 를 근거로 삼지 마라** — 1.4.11 은 rest 상태를 잰다.
   → **--tx-3**: 테두리 대 채움 = 테두리 대 바깥면 = **5.125 / 5.072**(같은 면이라 한 수다) 로
   감사자 판정 기준 1(양쪽 3:1)을 두 테마에서 만족한다.
   ⚠**hover 를 --tx-2 로 옮긴다** — 안 옮기면 rest 와 hover 가 **같은 색**이 되어 되짚을 표시가 사라진다.
   ⚠**.tab·.chip·.mv·.go.alt·.hjump a 를 같이 끌고 오지 마라** — 가시 텍스트 라벨이 있어 등급이 다르다
   (css-contrast.test.ts 의 EDGE_EXEMPT 가 사유와 함께 붙든다). */
.mfind input{font:inherit;font-size:var(--fs-lead);padding:var(--s2) var(--s4);width:170px;background:var(--panel);color:var(--tx);
  border:var(--rw-row) solid var(--tx-3);transition:border-color var(--t1) var(--e-out)}
.mfind input:hover{border-color:var(--tx-2)}
.mfind select{font:inherit;font-size:var(--fs-lead);padding:var(--s2) var(--s4);background:var(--panel);color:var(--tx);
  border:var(--rw-row) solid var(--tx-3);max-width:180px;transition:border-color var(--t1) var(--e-out)}
.mfind select:hover{border-color:var(--tx-2)}
.mfind .count{font-family:var(--f-num);font-size:var(--fs-note);color:var(--tx-3)}
@media (max-width:680px){
  .mfind input{flex:1 1 auto;width:auto;min-width:0}
  .mfind select{flex:1 1 auto;max-width:none;min-width:0}
  .mfind .count{flex-basis:100%}
}
@media (pointer:coarse){.mfind select,.mfind input{padding:var(--s4)}}

.note{font-size:var(--fs-note);color:var(--tx-3);margin:var(--s4) 0 0;max-width:64ch}
/* 用語集 — 지표 설명 한 장.
   ⚠**카드 그리드로 만들지 않는다**(§6 「AI 틱함」 금지 목록). 이건 읽는 글이지 훑는 목록이라
   한 줄씩 쌓고 왼쪽에 가는 선으로 단을 만든다 — 목차를 따로 두지 않고도 경계가 보인다.
   ⚠**글 폭을 제한한다** — caveat 가 4문장짜리도 있어서 넓은 화면에서 한 줄이 너무 길어진다. */
.glist{display:flex;flex-direction:column;gap:var(--s5);margin-top:var(--s2)}
.gl{padding-left:var(--s5);border-left:var(--rw-sect) solid var(--hair-2);max-width:72ch;scroll-margin-top:calc(var(--topbar) + var(--s6))}
.gl:target{border-left-color:var(--tx)}
.gln{margin:0;font-size:var(--fs-name);letter-spacing:.02em}
.gls{margin:var(--s1) 0 0;font-size:var(--fs-data);color:var(--tx-2)}
.glh{margin:var(--s2) 0 0;font-size:var(--fs-sub);color:var(--tx-2);font-variant-numeric:tabular-nums}
.glh b{font-weight:var(--w-bold);margin-right:var(--s3);letter-spacing:.06em;font-size:var(--fs-label);color:var(--tx-3)}
.glh s{text-decoration:none;margin-left:var(--s4);color:var(--tx-3);font-size:var(--fs-label)}
.glc{margin:var(--s2) 0 0;font-size:var(--fs-sub);color:var(--tx-2);padding-left:var(--s3);box-shadow:inset 2px 0 0 var(--warn)}
.empty{font-size:var(--fs-data);color:var(--tx-3);padding:var(--s3) 0}
/* ── M12 의 여섯 갈래는 **형태**로 갈린다 ──────────────────────
   ⚠**타입에서 여섯으로 쪼갠 것이 화면에서 한 갈래로 되돌아가 있었다**(2026-09-05 감사 P1).
   stateNote() 가 여섯을 전부 .empty 로 냈고, 다른 것은 **문장 첫 낱말뿐**이었다.
   ⚠**그래서 무게가 정확히 뒤집혀 있었다** — 이 화면에서 형태를 가진 것은 「제도상 추첨이 없다」
   (.dnolot) 하나뿐이라, **가장 안 중요한 사실이 가장 진했다.**
   ⚠**빨강으로 칠하지 않는다** — 「없음」은 고장이 아니다. 위 .pmiss 가 2026-08-18 에
   같은 결론에 이미 이르렀고, **여기서는 그 어휘를 그대로 쓴다**(새 색·새 그림자 0).
   ⚠**갈라야 할 것은 「누가 고칠 수 있는가」다**(layout.ts 의 DataState 주석):
     실선 = 여기는 안 열린다(출처가 껐다 · 정말로 0건이었다)
     점선 = 채워질 자리다(우리 몫의 남은 일 · 시간이 채운다)
   두 상태를 한 문장으로 합치지 말라고 적어 둔 그 구별을 **화면에서도 지킨다.**
   ⚠**판정선은 .dnolot 이다** — 그보다 약하면 이 수정은 아무것도 안 고친 것이다.
   여기는 3px 실선 + --panel-2 바탕 + --tx-2 로 그보다 진하다(2px inset · 바탕 없음). */
.empty[data-state]{color:var(--tx-2);padding:var(--s2) 0 var(--s2) var(--s4);background:var(--panel-2);
  border-left:var(--rw-mast) solid var(--hair-2)}
.empty[data-state="uncollected"],.empty[data-state="offseason"]{border-left-style:dashed}
/* 이것만 우리 쪽 사고다 — 색을 쓰는 자리가 여기 하나뿐인 이유다(글자도 이미 다르다) */
.empty[data-state="failed"]{border-left-style:solid;border-left-color:var(--warn)}

/* ── 予告先発 ────────────────────────────────────────────── */
/* 대전 카드 버튼 — **경기 수만큼 만들어지고, 폭에 맞춰 열이 접힌다** */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:var(--s3);
  padding:var(--s5) var(--pad);border-bottom:var(--rw-row) solid var(--hair);background:var(--panel)}
.card{display:flex;align-items:center;gap:var(--s4);font:inherit;text-align:left;cursor:pointer;
  padding:var(--s4) var(--s4);background:transparent;color:var(--tx-2);border:var(--rw-row) solid var(--hair-2);
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out),background var(--t1) var(--e-out)}
.card:hover{color:var(--tx);border-color:var(--tx-3)}
.card[aria-selected="true"]{color:var(--tx);border-color:var(--tx);background:var(--page)}
.card .cbar{display:flex;flex-direction:column;gap:var(--s1);flex:0 0 auto}
.card .cbar i{display:block;width:5px;height:13px}
.card .ctxt{min-width:0;display:flex;flex-direction:column;gap:var(--s1)}
.card .ctxt b{font-size:var(--fs-data);font-weight:var(--w-bold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .ctxt s{text-decoration:none;font-family:var(--f-num);font-size:var(--fs-col);color:var(--tx-3);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.card.all .ctxt b{letter-spacing:.1em}
@media (max-width:420px){.cards{grid-template-columns:1fr 1fr;gap:var(--s2)}.card{padding:var(--s3) var(--s4)}}

.starters{display:grid;grid-template-columns:1fr 1fr;gap:var(--s7)}
.sside{min-width:0}
.sname{margin:0 0 var(--s3);font-size:var(--fs-note);letter-spacing:.14em;font-weight:var(--w-bold);display:flex;align-items:center;gap:var(--s3)}
.sname i{width:10px;height:10px;background:var(--chip,#6b7280);font-style:normal}
.spitcher{margin:0 0 var(--s4);font-size:var(--fs-title);font-weight:var(--w-bold);letter-spacing:.06em}
.spitcher a{text-decoration:none;box-shadow:inset 0 -2px 0 var(--chip,#6b7280)}
dl.srow{grid-template-columns:auto 1fr;margin-bottom:var(--s5)}
@media (max-width:680px){.starters{grid-template-columns:1fr;gap:var(--s6)}}

/* ── 対戦を選ぶ ──────────────────────────────────────────── */
.picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:var(--s6);max-width:640px}
.pickside label{display:block;font-size:var(--fs-label);letter-spacing:.16em;color:var(--tx-3);margin-bottom:var(--s3)}
.pickside .qbox{max-width:none}
.pickside .qbox input{font-size:var(--fs-name);padding:var(--s4) var(--s4)}
.chosen{margin:var(--s3) 0 0;font-size:var(--fs-data);color:var(--tx-3)}
.chosen b{color:var(--tx);font-weight:var(--w-bold)}
.go{font:inherit;font-size:var(--fs-lead);padding:var(--s4) var(--s6);cursor:pointer;background:var(--team,#6b7280);
  color:var(--team-ink,#fff);border:var(--rw-row) solid var(--team,#6b7280);font-weight:var(--w-bold);
  transition:border-color var(--t1) var(--e-out)}
.go:disabled{opacity:.35;cursor:default}
/* ⚠**버튼 전체를 흐리면 글자와 면이 함께 흐려진다** — 그러면 대비가 **비율까지 떨어진다**
   (2026-09-08 · ⑵ 를 계산으로 바꾸면서 드러남). 이 버튼이 실제로 서는 화면(matchup.html·compare.html)은
   --team 이 **중립색 #6b7280 / #f7f8f9 = 4.547** 이라 여유가 없어서, .85 로 흐리면 **라이트 3.436** 이 된다.
   ⚠**α 를 올려도 안 된다** — .99 에서도 4.482 로 미달이고 **1.00 에서만 4.547** 이다. 흐림 자체가 답이 아니다.
   → hover 를 **테두리 색**으로 말한다(.mv·.chip·.pk·.go.alt 가 이미 쓰는 이 집의 방식).
   --tx-3 는 --page 대비 **4.910 / 5.499** 라 면 색과 무관하게 보인다. */
.go:hover:not(:disabled){border-color:var(--tx-3)}
.go.alt{background:transparent;color:var(--tx-2);border-color:var(--hair-2);font-weight:var(--w-reg);margin-left:var(--s3)}
/* ⚠opacity:1 을 뺐다 — 그것은 위의 .go:hover 흐림을 **되돌리기 위한 것**이었고, 그 흐림이 사라졌다 */
.go.alt:hover:not(:disabled){color:var(--tx);border-color:var(--tx-3)}

/* ⚠**고른 것과 실행 버튼은 화면에서 사라지면 안 된다.** 아래의 선수 목록이 길어서
   스크롤하면 「골랐는데 어떻게 보지?」가 된다. 레일과 같은 sticky를 쓴다 */
.pickbar{position:sticky;top:var(--topbar);z-index:9;display:flex;align-items:center;
  flex-wrap:wrap;gap:var(--s4) var(--s6);margin:0 0 var(--s5);padding:var(--s4) 0;background:var(--panel);
  border-bottom:var(--rw-row) solid var(--hair)}
.pickbar .chosen{margin:0;display:flex;align-items:baseline;gap:var(--s3);min-width:0}
.pickbar .chosen span{font-size:var(--fs-col);letter-spacing:.16em;color:var(--tx-3);flex:none}
.pickbar .chosen b{font-size:var(--fs-name);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pickbar .go{margin-left:auto;flex:none}
.picknote{margin:0 0 var(--s4);font-size:var(--fs-sub);color:var(--tx-3)}
.pickgames{margin:0 0 var(--s5)}
/* 두 팀을 나란히. 좁으면 위아래로 — 어느 쪽이 어느 팀인지는 색 표식과 이름이 말한다 */
.pickteams{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:var(--s6)}
.pickteam{min-width:0}
.picktm{margin:0 0 var(--s4);font-size:var(--fs-lead);display:flex;align-items:center;gap:var(--s3)}
.picktm i{width:10px;height:10px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠**접힌 채로도 무엇이 몇 명인지 보여야 한다.** 요약이 라벨 노릇을 그대로 한다.
   ⚠**기본 화살표를 지우고 우리 표식을 쓴다** — 브라우저마다 모양이 달라 줄이 흔들린다 */
.pickfold{margin:var(--s4) 0 0}
.pickfold>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:var(--s3)}
.pickfold>summary::-webkit-details-marker{display:none}
/* ⚠**글리프에 빈 대체텍스트를 붙인다.** details/summary 는 접힘·펼침을 이미 네이티브로 알리는데,
   그 위에 생성 콘텐츠를 얹으면 낭독기가 「검은 오른쪽 삼각형」을 덧붙여 읽는다 */
/* ⚠**~~"▸"(U+25B8)~~ 였고 그 글자는 네 서체 어디에도 없다**(2026-09-08 · npm run build:fonts 가
   종료코드 1 로 세웠다 · 결정문 docs/superpowers/specs/2026-09-07-design-direction.md §5-E).
   → **"▶"(U+25B6)** 로 바꾼다. plex-jp·noto-jp 실측 보유(라틴 두 서체에는 **없다** — 이 표식은 JP 페이스가 맡는다).
   ⚠**같은 삼각형이 아니다 — 크기를 같이 안 고치면 줄이 커진다.** 실측(400 · 원본 hmtx/glyf):
   진폭 **1.000em**(全角 · › 0.30em 의 3.3배) · 잉크 **0.746×0.856em**(plex-jp) / **0.814×0.940em**(noto-jp)
   — **대문자 A(0.70~0.73em)보다 크고** 이미 쓰는 →(0.434/0.466em)의 **약 2배**다.
   게다가 **베이스라인 아래로 0.047~0.093em 내려간다**(이 줄들은 전부 align-items:baseline 이다).
   → **font-size 를 --fs-note(11px) → --fs-min(9.5px)** 로 내린다: 잉크 **8.1~8.9px** ·
   내려가는 양 **0.4~0.9px**(반올림되면 사라지는 크기)로 줄어든다.
   ⚠**브라우저로는 확인하지 못했다** — 옛 "▸" 는 서체에 없어 **시스템 폰트로 떨어져 있었고**(그래서 게이트가 잡았다)
   그 크기를 잴 방법이 없다. 남는 위험 둘: ⑴ **그래도 옛 모습보다 크다** — 소삼각형의 잉크를
   흔한 값(약 0.42em)으로 **가정하면** 11px 에서 4.6px 이었을 테니 **1.8배쯤**인데, ⚠**그 4.6px 은 실측이 아니라 가정이다** ·
   ⑵ **U+25B6/U+25C0 은 이모지 표현을 가진 글자**라, @font-face 배선 전에는 환경에 따라
   **색 이모지 폰트로 떨어질 수 있다**(옛 U+25B8 에는 그 성질이 없었다).
   ⚠**U+FE0E(VS15)로 못 막는다** — 그 글자도 서체에 없어 게이트가 다시 선다(isNonGlyph 에 예외를 더하지 마라).
   → **더 가볍게 가려면 ›/‹(U+203A/U+2039)** 다. **네 서체 전부**가 갖고(라틴 포함)
   진폭 0.30em · 잉크 0.41~0.43em · **베이스라인 아래로 안 내려가고** 이모지 표현이 없다 —
   즉 지금 CSS 가 전제한 그 치수다. 바꿀 때는 여기와 아래 .cmprow 두 줄을 **같이** 고쳐라. */
.pickfold>summary::after{content:"▶" / "";margin-left:auto;font-size:var(--fs-min);color:var(--tx-3);
  transition:transform var(--t1) var(--e-out)}
.pickfold[open]>summary::after{transform:rotate(90deg)}
/* 눌리는 자리임을 손에 알린다 — 라벨만으로는 눌러도 되는지 알 수 없다.
   ⚠**토큰 이름을 지어내지 마라.** 여기 처음 var(--tx-1) 이라고 썼는데 **그런 토큰은 없다**
   (있는 것은 --tx · --tx-2 · --tx-3). 정의 없는 var() 는 선언 전체를 무효로 만들고,
   무효가 된 자리는 상속으로 메워져 **얼추 맞아 보인다** — 그래서 눈으로는 안 잡힌다.
   아래 focus 규칙에서는 같은 실수가 훨씬 나쁘게 끝났다(2026-08-17 이중 검토) */
.pickfold>summary:hover{color:var(--tx)}
/* ⚠**이 한 줄이 포커스 링을 없앴었다.** var(--tx-1)(미정의)로 outline 숏핸드가 무효가 되면
   outline-style 이 initial(=none)로 떨어지는데, 이 선택자의 특이도(0,2,1)가
   전역 :focus-visible(0,1,0)을 이긴다 — **안 썼으면 나왔을 링이 쓴 탓에 사라진다.**
   접힌 목록을 여는 유일한 수단이라 키보드 사용자가 여기서 길을 잃는다.
   ⚠**둥근 모서리도 뺐다** — 이 스타일시트에 border-radius 는 그 한 줄뿐이었고,
   파일 머리말이 「둥근 모서리를 쓰지 않는다」고 적어 둔 그것이다 */
.pickfold>summary:focus-visible{outline:2px solid var(--tx);outline-offset:2px}
.pickfold .picklist{margin-top:var(--s2)}
.picklab{margin:var(--s4) 0 var(--s2);font-size:var(--fs-col);letter-spacing:.16em;color:var(--tx-3);
  display:flex;align-items:baseline;gap:var(--s3)}
.picklab s{text-decoration:none;letter-spacing:0;font-size:var(--fs-label)}
/* ── 「데이터가 없다」는 평범한 캡션과 달라야 한다 ─────────────────
   ⚠**클래스만 붙고 규칙이 0건이었다**(2026-08-18 감사 P2). M12 의 4상태를 가르려고
   .pmiss 를 붙여 놨는데 CSS 가 없어서, 「이 날은 아직 발표가 없습니다」가
   바로 옆의 안내문과 **글자 하나 다르지 않게** 그려졌다 — 가르려고 만든 표시가 안 갈랐다.
   ⚠**비교 화면은 더 나빴다**: .picklab 이 10px·자간 .16em 의 마이크로 라벨이라
   경고가 같은 줄의 힌트(10.5px)보다 **작았다.** 그래서 여기서 자간과 크기를 되돌린다.
   ⚠**빨강으로 칠하지 않는다** — 「없음」은 고장이 아니다. 색이 아니라 **형태**로 가른다. */
.pmiss{letter-spacing:0;font-size:var(--fs-data);color:var(--tx-2);
  border-left:var(--rw-mast) solid var(--hair-2);padding:var(--s2) 0 var(--s2) var(--s4);background:var(--panel-2)}
.picklab.pmiss{letter-spacing:0;font-size:var(--fs-data)}
/* 고를 것이 없으면 「누르는 법」도 필요 없다 */
.pmiss s{display:none}
/* ── 収集ログ의 상태 칸 ──
   ⚠**바로 위 .pmiss 와 같은 사고가 収集ログ 에서 또 났다**(2026-08-18 감사 P1).
   log-page.ts 가 .ok / .bad 를 붙이고 있는데 **CSS 규칙이 0건**이라,
   「取得済み」와 「打席ログN試合ぶん未取得」이 **글자색 하나 다르지 않게** 그려졌다.
   --ok·--warn 토큰은 이미 있었다 — 잇지 않았을 뿐이다.
   이 화면은 조용한 실패를 사람이 눈으로 찾는 유일한 자리라, 훑어서 안 보이면 존재 이유가 없다.
   ⚠**색만으로 가르지 않는다**(§0-1·1.4.1). 글자 자체가 이미 다르고(取得済み/未取得 · 正常/古い),
   여기서는 굵기를 더해 색을 못 보는 경우에도 결함 행이 튀게 한다.
   ⚠**선택자를 td 로 묶는다.** .ok / .bad 는 흔한 이름이라 전역으로 두면 언젠가 남의 칸을 물들인다. */
td.ok{color:var(--ok)}
td.bad{color:var(--warn);font-weight:var(--w-bold)}
/* ── 通算成績 ──
   ⚠**태그 기본값에 기대지 않는다.** h3 는 기본 1.17em 이라 **구획 제목(h2, 11px)보다 커진다** —
   이 저장소가 이미 한 번 밟은 함정이다(위 .standname 주석 참조).
   ⚠**통산 한 줄이 이 블록의 주역**이다. 연도별은 근거이고, 먼저 읽혀야 하는 것은 합계다. */
.cyr{margin:var(--s5) 0 var(--s3);font-size:var(--fs-label);letter-spacing:.16em;color:var(--tx-2);font-weight:var(--w-semi);
  display:flex;align-items:baseline;gap:var(--s4)}
.cyr:first-child{margin-top:0}
.cyr .qt{letter-spacing:0;font-weight:var(--w-reg);color:var(--tx-3);font-size:var(--fs-label)}
.ctot{margin:0 0 var(--s4);font-size:var(--fs-lead);font-variant-numeric:tabular-nums;
  padding:var(--s3) 0 var(--s3) var(--s5);border-left:var(--rw-mast) solid var(--chip,var(--team,var(--tx)))}
.ctot b{font-size:var(--fs-col);letter-spacing:.16em;color:var(--tx-3);font-weight:var(--w-semi);margin-right:var(--s4);
  vertical-align:.08em}
/* ── ホーム(대시보드) ──
   ⚠**로고를 쓰지 않는다**(§6). 구단을 구별하는 것은 **우리가 고른 색**과 이름이다.
   ⚠**카드 그리드를 만들지 않는다** — 균질한 카드 격자는 「AI틱함」 금지 목록에 있다.
   이 화면은 표와 목록으로 간다: 순위는 표가 가장 빨리 읽히고, 주간은 짧은 순서 목록이다. */
.hteam{display:inline-flex;align-items:center;gap:var(--s2);white-space:nowrap}
/* ⚠**색만으로는 안 된다.** 구단 12색 중 다크 바탕에서 3:1 을 못 넘는 것이 7색이다
   (실측 2026-08-17: 가장 낮은 것이 1.17:1). 표를 가로로 밀면 팀명이 화면 밖으로 나가
   **이 칩이 유일한 식별자**가 되는데, 그때 칩이 안 보이면 누구의 줄인지 알 수 없다.
   ⚠**테두리로 형태를 준다** — 색이 안 보여도 사각형은 남는다(.tm i 가 이미 쓰는 수법). */
.hteam i{width:9px;height:9px;background:var(--chip,#6b7280);flex:none;
  box-shadow:inset 0 0 0 1px var(--tx-3)}
.hteam:hover i{outline:1px solid var(--tx-3);outline-offset:1px}
/* ⚠**고정되는 열이 「이름」이어야 한다**(2026-08-17 디자인 감사 P1).
   .scroller 의 기본 규칙은 첫 열만 고정하는데, 이 표의 첫 열은 **순위 숫자**다 —
   오른쪽 절반을 볼 때 「3」만 남고 **누구의 줄인지 알 수 없다.**
   得失 를 더해 10열이 되면서 확실히 넘치게 됐다(최소폭 약 787px vs 스마트폰 353px).
   ⚠**두 열을 함께 고정한다.** 두 번째 열의 left 는 첫 열의 실제 폭과 같아야 한다 —
   그래서 순위 열에 고정 폭을 준다(어긋나면 겹치거나 틈이 벌어진다). */
.hstand td.hrank,.hstand th:first-child{width:44px;min-width:44px}
.hstand th:nth-child(2),.hstand td:nth-child(2){position:sticky;left:44px;z-index:2;
  background:var(--panel)}
.hstand thead th:nth-child(2){z-index:3}
/* 고정 열의 오른쪽 끝을 표시한다 — 어디까지가 고정인지 모르면 스크롤이 혼란스럽다 */
.hstand th:nth-child(2)::after,.hstand td:nth-child(2)::after{content:"";position:absolute;
  top:0;bottom:0;right:0;width:1px;background:var(--hair-2)}

/* ⚠**得失 셀을 두 줄로 접는다.** 한 줄이면 약 158px 로 이 표에서 가장 넓은 칸이 된다 —
   「득실차를 주역으로, 득점·실점을 뒤에」라는 위계도 한 줄에서는 성립하지 않는다.
   기존 .den 규칙이 table.stand 만 겨냥해 이 표에 안 닿고 있었다(감사 P2). */
.hstand td.wd .den{display:block;font-size:var(--fs-col);color:var(--tx-3);white-space:nowrap}
.hstand td.wd{white-space:normal}
/* 순위표는 숫자가 줄맞춰야 읽힌다 */
.hstand td,.hstand th{font-variant-numeric:tabular-nums}
.hstand .b{font-weight:var(--w-bold)}
/* ⚠**구단 색을 행에 세운다.** 로고를 못 쓰는 자리에서 팀을 구별하는 것은 색과 이름이고(§6),
   9px 칩 하나로는 표에서 팀이 안 읽힌다는 지적이 있었다(2026-08-17 「조금 더 비비드하게」).
   ⚠**색만으로 전하지 않는다** — 팀 이름이 바로 옆에 그대로 있다 */
/* ⚠**여기서 순위 열의 고정이 죽어 있었다**(2026-08-18 유저 지적).
   .scroller td:first-child 가 position:sticky 를 주는데(특이도 0,2,1),
   구단 색 막대를 붙이면서 여기에 **position:relative** 를 썼고 이쪽이 (0,2,2)로 이겨서
   **순위 열만 같이 안 따라왔다** — 팀명 열은 left:44px 에 붙어 있는데 그 왼쪽 44px 이
   비면서 스크롤이 이상하게 보였다. 바로 위 주석이 「두 열을 함께 고정한다」고 적어 둔
   그 약속이 CSS 에서는 지켜지지 않고 있었다(자기 수정이 만든 결함 · CLAUDE.md 작업규칙 10).
   ⚠**sticky 도 「위치가 정해진 요소」다** — ::before 의 기준으로 relative 와 똑같이 동작한다. */
.hstand tbody td:first-child{position:sticky;left:0;z-index:2;padding-left:var(--s5)}
.hstand thead th:first-child{position:sticky;left:0;z-index:3;background:var(--page)}
.hstand tbody td:first-child::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:4px;
  background:var(--chip,transparent)}
.hstand .hrank{font-weight:var(--w-bold);font-size:var(--fs-name)}
.hstand .hrank s{text-decoration:none;font-size:var(--fs-min);color:var(--tx-3);margin-left:var(--s1)}
/* 1위 행만 조금 더 무겁게 — 「지금 누가 위인가」가 이 표의 첫 질문이다 */
.hstand tr.lead td{background:var(--panel)}
.hstand tr.lead .hrank{color:var(--tx)}
.hstand tbody tr:hover td{background:var(--panel)}

/* 그 날의 결과 — 한 줄에 「팀 점수-점수 ＠팀」. 표로 만들면 두 줄이 되어 밀도가 떨어진다.
   ⚠**간격이 뜻과 반대로 묶여 있었다**(2026-08-20 감사 ②). .hg-t 에 flex:1 1 0 이 붙어
   양쪽 팀명을 셀 **바깥쪽**으로 밀어붙였기 때문에, 실측(1280px · 텍스트 잉크 기준)으로
   경기 **내부** 간격이 6~71px(중앙값 32) 인데 경기 **사이**가 **18px** 이었다 —
   즉 「オリックス」와 다음 경기의 「阪神」이 자기 점수보다 가까웠다.
   ⚠**칸을 내용에 맞춘다.** auto 3칸 + justify-content:start 면 한 경기가 왼쪽에 뭉치고,
   남는 폭이 그대로 경기 사이의 간격이 된다. 마지막 칸만 minmax(0,auto) 로 둬서
   긴 팀명(ソフトバンク)이 셀을 넘겨 가로 스크롤을 만들지 않게 한다.
   ⚠**괘선은 여전히 칸 전체를 가로지른다** — li 는 여전히 1fr 폭을 갖는 격자 항목이다 */
.hgames{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:var(--s1) var(--s7)}
.hgames li{display:grid;grid-template-columns:auto auto minmax(0,auto);justify-content:start;
  align-items:baseline;gap:0 var(--s3);padding:var(--s2) 0;
  border-bottom:var(--rw-row) solid var(--hair);font-variant-numeric:tabular-nums}
/* ⚠**찌그러짐이 아니라 말줄임으로 끝낸다**(2026-08-31 · 명부에서 겪은 것과 같은 병).
   이 줄의 점수(.hg-s)는 nowrap 이라 안 줄고, 마지막 칸이 minmax(0,auto) 라 **팀명만 줄어든다.**
   일본어는 글자 사이가 기본 줄바꿈 자리라 그대로 두면 「ソ/フ/ト/バ/ン/ク」가 된다.
   ⚠**가로 스크롤을 안 만든다는 원래 의도는 그대로다** — 줄어드는 것은 여전히 이 칸이고,
   줄어든 뒤의 **모양만** 바뀐다. */
.hgames .hg-t{font-size:var(--fs-data);color:var(--tx-2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hgames .hg-s{font-size:var(--fs-name);font-weight:var(--w-bold);white-space:nowrap}
.hgames .hg-s s{text-decoration:none;color:var(--tx-3);font-size:var(--fs-note);font-weight:var(--w-reg);margin:0 var(--s1)}
.more{margin:var(--s4) 0 0;font-size:var(--fs-sub)}

/* ── 일정 캘린더 ────────────────────────────────────────────────
   ⚠**격자를 카드로 만들지 않는다**(§6). 달력은 이미 격자라, 칸마다 그림자와 둥근 모서리를
   더하면 그 순간 「AI가 만든 대시보드」가 된다. 선과 여백만으로 짓는다.
   ⚠**승패를 색으로만 말하지 않는다** — 글자(○●△中)가 먼저이고 색은 보조다.
   ⚠**날짜를 큼직하게 두지 않는다.** 이 화면에서 읽을 것은 날짜가 아니라 **상대와 결과**다. */
.calwrap{display:flex;flex-direction:column;gap:var(--s7)}
.cal{width:100%;border-collapse:collapse;table-layout:fixed}
/* ⚠**구획 제목(.block>h2 = 12.5px/700)보다 크면 안 된다.** 13px/700 이었다 —
   이 파일이 이미 두 번 적어 둔 함정을 세 번째로 밟았다(2026-08-18 감사 P2).
   달 이름은 구획 안의 **소제목**이지 구획 제목이 아니다. */
.cal caption{text-align:left;font-size:var(--fs-sub);font-weight:var(--w-bold);letter-spacing:.1em;
  padding:0 0 var(--s4);color:var(--tx-2)}
.cal th{font-size:var(--fs-col);font-weight:var(--w-reg);letter-spacing:.1em;color:var(--tx-3);
  padding:0 0 var(--s3);text-align:center;border:var(--rw-none)}
.cal th abbr{text-decoration:none;border:var(--rw-none)}
/* 일요일은 조금 진하게. ⚠빨강을 쓰지 않는다 — 「나쁨」으로 읽힌다 */
.cal .cw0,.cal .cw6{color:var(--tx-2)}
.cal td{border:var(--rw-row) solid var(--hair);vertical-align:top;padding:var(--s2);height:62px;
  background:var(--panel)}
/* 그 달에 없는 칸. ⚠**지우지 않고 비운다** — 없애면 요일이 밀린다 */
.cal td.cpad{background:transparent;border-color:transparent}
.cday{display:block;font-family:var(--f-num);font-size:var(--fs-col);color:var(--tx-3);
  line-height:1;margin-bottom:var(--s1)}
/* 오늘. ⚠바탕을 칠하지 않고 테두리로 말한다 — 칠하면 「선택됨」으로 읽힌다
   ⚠**구단색만으로는 안 된다**(2026-08-18 감사 P2). 12구단 전부가 라이트·다크 중
   한쪽에서 3:1 을 못 넘고 최악은 **1.08:1** 이다 — 그 팀 페이지에서는 오늘 칸이 그냥 안 보인다.
   같은 함정의 대책이 이 파일 .hteam i 에 이미 있었는데 여기에는 안 왔다.
   ⚠**중립색 테두리를 한 겹 더 둔다** — 구단색이 안 보여도 **사각형은 남는다.**
   안쪽 2px 이 구단색, 그 바깥 1px 이 중립색이다(inset 은 먼저 쓴 것이 위에 그려진다). */
.cal td.ctoday{box-shadow:inset 0 0 0 2px var(--team,var(--tx-3)),inset 0 0 0 3px var(--tx-3)}
.cal td.ctoday .cday{color:var(--tx);font-weight:var(--w-bold)}

/* 한 칸 안의 경기. 지난 경기는 링크, 앞으로의 경기는 그냥 글자 */
.cg{display:block;text-decoration:none;color:var(--tx);font-size:var(--fs-note);line-height:1.35;
  padding:var(--s1) var(--s2);border-left:var(--rw-sect) solid var(--hair-2);
  transition:background var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.cg + .cg{margin-top:var(--s1)}
a.cg:hover{background:var(--panel-2);border-left-color:var(--team,var(--tx-3))}
a.cg:focus-visible{outline:2px solid var(--tx);outline-offset:1px}
.cvs{display:block;font-size:var(--fs-note);color:var(--tx-2);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.cscore{display:inline-block;font-family:var(--f-num);font-variant-numeric:tabular-nums;
  font-size:var(--fs-data);font-weight:var(--w-bold);margin-right:var(--s2)}
.cmark{font-size:var(--fs-data);font-weight:var(--w-bold)}
.cmark.win{color:var(--up)}
.cmark.loss{color:var(--dn)}
.cmark.draw,.cmark.notPlayed{color:var(--tx-3)}
/* 앞으로의 경기 — **확정이 아니다**(M9). 점선으로 그렇게 말한다 */
.cgup{border-left-style:dashed;background:transparent}
.ctime{display:block;font-family:var(--f-num);font-size:var(--fs-label);color:var(--tx-3)}

@media (max-width:680px){
  /* ⚠좁은 화면에서는 칸이 작아진다 — 그래도 **가로로 밀지 않는다**.
     달력을 옆으로 스크롤하면 「몇째 주인지」를 잃는다 */
  .cal td{height:auto;min-height:44px;padding:var(--s1)}
  /* ⚠**팀명을 자르지 않는다**(2026-08-18 감사 P2). 353px 화면에서 한 칸은 약 44px 이라
     nowrap+말줄임이면 「@ヤ…」처럼 **2글자만 남았다** — 이 화면이 읽으라고 만든
     바로 그 정보다. 줄을 바꾸는 쪽이 낫다: 칸 높이는 늘어나도 뜻은 남는다. */
  .cvs{font-size:var(--fs-col);white-space:normal;overflow:visible;text-overflow:clip;
    overflow-wrap:anywhere;line-height:1.25}
  .cg{padding:var(--s1) var(--s1)}
  .cscore{font-size:var(--fs-note)}
  .calwrap{gap:var(--s6)}
}

/* ── 순위표: 승패를 눈으로 비교할 수 있게 ─────────────────────────
   ⚠**수를 그림으로 바꾸지 않는다** — 수 옆에 띠를 둔다(2026-08-17 유저 지적).
   ⚠**띠의 승 비율과 승률은 일부러 다르다** — 무승부가 승률의 분모에서 빠지기 때문이다(NPB 규정).
   그 차이를 설명하는 것이 이 띠의 무승부 조각이다. */
.wl3{white-space:nowrap;min-width:150px}
.wlnum{font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:var(--fs-lead);font-weight:var(--w-bold)}
.wlnum s{text-decoration:none;font-size:var(--fs-min);font-weight:var(--w-reg);color:var(--tx-3);margin:0 var(--s1) 0 var(--s1)}
.wlbar{display:flex;height:5px;margin-top:var(--s2);width:100%;min-width:110px;
  background:var(--hair);overflow:hidden}
/* ⚠**0 이 아니면 보여야 한다.** 무승부 1경기는 폭 0.94% = 약 1px 이라 사실상 사라졌다 —
   「띠의 승 비율과 승률이 다른 이유」를 설명하는 조각이 그 설명을 못 했다(감사 P2). */
.wlbar i{display:block;height:100%}
.wlbar i.wt{min-width:2px}
.wlbar .ww{background:var(--bar-w)}
.wlbar .wl{background:var(--bar-l)}
.wlbar .wt{background:var(--bar-t)}

/* 득실차. ⚠**부호를 문자로 쓴다** — 색만으로 +− 를 구별하면 색각 이상에서 사라진다 */
.rdiff{font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:var(--fs-name);font-weight:var(--w-bold)}
.rdiff.up{color:var(--up)}
.rdiff.dn{color:var(--dn)}
/* ⚠**주역이 무엇인지 값 옆에서 말한다**(2026-08-18 유저 지적: 「이해가 안 됨」).
   열 이름은 得失点 인데 큰 수는 그 **차이**여서 둘이 어긋나 있었다. */
.hstand .rdlab{text-decoration:none;font-size:var(--fs-min);letter-spacing:.14em;
  color:var(--tx-3);margin-left:var(--s2)}
/* 득실차의 좌우 발산 띠 — 가운데가 0. ⚠**뜻을 나르는 것은 색이 아니라 방향**이다
   (--up 과 --dn 은 명도가 거의 같다 · 실측 1.01:1). 부호가 붙은 수가 바로 위에 있다.
   ⚠트랙 대비는 잰 값이다 — --up/--dn 대 --hair 가 라이트 4.18/4.21 · 다크 5.33/5.23. */
.hstand .rdbar{display:block;position:relative;height:5px;margin-top:var(--s2);
  width:100%;min-width:104px;background:var(--hair);overflow:hidden}
/* 0 자리를 눈에 보이게 — 어디가 기준인지 모르면 방향이 뜻을 못 나른다 */
.hstand .rdbar::before{content:"";position:absolute;left:50%;top:0;bottom:0;
  width:1px;background:var(--tx-3);opacity:.55;z-index:1}
.hstand .rdbar i{position:absolute;top:0;bottom:0;display:block}
.hstand .rdbar i.up{background:var(--up)}
.hstand .rdbar i.dn{background:var(--dn)}
/* 득점·실점 줄. ⚠**단위를 수보다 작게** 두고, 분모(경기 수)는 한 단계 더 뒤로 물린다 */
.hstand td.wd .den s{text-decoration:none;font-size:var(--fs-min);color:var(--tx-3);margin:0 var(--s1) 0 0}
/* ⚠**분모에 opacity 를 얹지 않는다**(2026-08-18 감사 P2에서 시험이 잡았다).
   0.8 이면 대비가 라이트 **3.32:1** · 다크 3.97:1 로 AA(4.5:1) 미달이다.
   하필 이 자리가 **분모**다 — 이 서비스가 「분모 없는 비율을 금지한다」고 말해 놓고
   그 분모를 못 읽게 그리면 규칙을 지킨 척만 하는 것이 된다(M2).
   ⚠**뒤로 물리는 것은 크기와 색으로 한다** — 그건 이미 --tx-3 과 9px 이 하고 있다. */
.hstand td.wd .den em{font-style:normal;color:var(--tx-3);margin-left:var(--s3)}
.hstand td.wd .den em::before{content:"·";margin-right:var(--s3)}

/* 1위 줄.
   ⚠**바탕을 칠하지 않는다** — 표 안에서 한 줄만 바탕이 다르면 「선택됨」으로 읽힌다.
   ⚠처음에 넣은 강조 셋이 **전부 무효였다**(2026-08-17 감사 P2):
   바탕(--panel)은 표 바탕과 1.04:1 이라 감지 한계 이하였고,
   좌측 그림자는 이미 있는 ::before(4px, 같은 색) 아래에 완전히 덮였다.
   → **굵기와 크기로만** 말한다. 색이 아니라 형태라 어느 테마·어느 색각에서도 남는다. */
.hstand tr.lead .wlnum{font-size:var(--fs-name)}
.hstand tr.lead .hrank{font-weight:var(--w-bold);font-size:var(--fs-name)}
.hstand tr.lead td{border-top:var(--rw-sect) solid var(--tx-3);border-bottom:var(--rw-sect) solid var(--tx-3)}
/* ⚠**이 화면 안의 이동**(2026-08-17 유저 지적: 「대쉬보드가 세로로 기니까 해당 부분으로
   바로 점프하는 네비게이션」). 예전에는 다른 화면으로 가는 줄이었는데 **그건 상단 탭에 있다.**
   ⚠**따라 붙는다**(sticky). 세로로 긴 화면에서 맨 위로 돌아가야 쓸 수 있는 내비는 안 쓰인다.
   ⚠**한 줄로 굴린다** — 구획이 늘어도 머리가 두 줄이 되지 않는다.
   ⚠**균질한 카드 격자를 만들지 않는다**(§6) — 글자 줄로 두되 누를 수 있게 크기만 준다. */
/* ⚠**음수 마진을 쓰지 않는다.** full-bleed 로 만들려고 좌우 −var(--pad) 를 줬는데
   부모(.main)에 **가로 패딩이 0**이라 상쇄할 것이 없었다 — 문서 전체에 가로 스크롤 20px 이 생기고
   왼쪽으로 삐져나간 배경이 .spine 의 구단색 기둥을 파냈다(2026-08-17 디자인 감사 P1).
   ⚠**부모의 패딩을 확인하지 않고 음수 마진을 쓰면 이렇게 된다.** */
/* ⚠**좌우 패딩이 없어 칩이 구단색 기둥에 딱 붙어 있었다**(2026-08-18 감사 P2).
   .block 은 좌우로 var(--pad) 를 두는데 이 줄만 0 이라, 페이지에서 **유일하게 정렬선을 벗어난
   요소**가 됐다. 음수 마진 사고(바로 위 문단) 뒤에 0 으로 되돌리면서 같이 빠졌다. */
/* ⚠**가로 스크롤 컨테이너의 왼쪽 패딩은 스크롤하면 사라진다**(2026-08-18 유저 지적:
   「가장 왼쪽의 버튼이 왼쪽 디자인 요소랑 겹쳐져 있다」).
   .hjump a 에 scroll-snap-align:start 가 있어서, 스냅이 끝나면 칩 하나가
   **스크롤포트 왼쪽 끝**에 와서 멈춘다 — 그 자리는 바로 옆이 .spine(구단색 기둥)이다.
   시즌 띠에서 이미 같은 함정을 밟았는데 이 줄만 교훈을 못 받았다.
   ⚠**scroll-padding-left 로 스냅 기준선을 안쪽으로 민다.** 패딩만으로는 안 된다 —
   패딩은 스크롤과 함께 밀려나지만 scroll-padding 은 스크롤포트에 붙어 있다. */
.hjump{position:sticky;top:var(--topbar);z-index:8;
  display:flex;flex-wrap:nowrap;gap:var(--s3);margin:0 0 var(--s4);
  padding:var(--s4) var(--pad);scroll-padding-left:var(--pad);
  background:var(--page);border-bottom:var(--rw-row) solid var(--hair);
  overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;
  scroll-snap-type:x proximity}
.hjump::-webkit-scrollbar{height:6px}
.hjump::-webkit-scrollbar-thumb{background:var(--hair-2);border-radius:var(--r-thumb)}
.hjump a{flex:0 0 auto;scroll-snap-align:start;
  display:inline-flex;align-items:center;padding:var(--s3) var(--s5);
  /* ⚠**쉬는 칩은 테두리도 면도 칠하지 않는다**(2026-09-08 · 2b · .tab 과 같은 사유).
     ⚠**배경까지 끄는 이유**: .hjump 의 바탕이 --page 이고 칩이 --panel 이었는데 그 둘의 대비가
     **라이트 1.044 · 다크 1.084** 라 애초에 안 보이는 면이었다. 안 보이는 면을 남겨 두면
     「면으로도 구분된다」는 거짓 근거가 남는다. **지금 보고 있는 구획**만 면과 테두리를 갖는다. */
  border:var(--rw-row) solid transparent;background:transparent;color:var(--tx);
  font-size:var(--fs-data);text-decoration:none;white-space:nowrap;
  transition:border-color var(--t1) var(--e-out),background var(--t1) var(--e-out),color var(--t1) var(--e-out)}
.hjump a:hover{border-color:var(--team,var(--tx-3));background:var(--panel-2)}
/* ⚠**지금 보고 있는 구획을 표시한다.** 스크롤 위치를 자바스크립트가 알려 준다 —
   안 켜지면 그냥 링크 줄로 남는다(§0-1: 스크립트 없이도 동작해야 한다) */
.hjump a[aria-current="true"]{border-color:var(--team,var(--tx));font-weight:var(--w-bold);
  background:var(--panel-2)}
@media (pointer:coarse){.hjump a{padding:var(--s4) var(--s5)}}
/* ⚠**좁은 화면에서는 따라 붙지 않는다.**
   ≤680px 에서 .topbar 는 2행으로 접혀 화면의 큰 몫을 이미 먹는다 — 그 아래에 링크 줄까지
   붙이면 본문이 사라진다. .rail 이 같은 이유로 ≤680px 에서 static 이다.
   ⚠고정을 포기해도 기능은 남는다 — 화면 맨 위의 링크 줄로 동작한다.
   ⚠**높이 어긋남은 더 이상 여기서 다루지 않는다**(2026-08-20). 예전에는 「≤480 에서 --topbar 가
   실제 높이가 아니다」를 이 근처와 아래 두 곳에 나눠 적고 **86px 를 손으로 박았는데**,
   그 86 조차 실측 113~115px 에 28px 모자랐다. 지금은 --topbar 자체가 폭 구간마다
   실제 높이로 정의되므로(반응형 §), 이 계산들은 그냥 맞는다. */
@media (max-width:680px){
  .hjump{position:static}
  /* ⚠**특정성을 한 단계 올린다.** 아래 무조건 규칙과 특정성이 같으면
     **소스 순서가 뒤인 그쪽이 이겨서** 이 보정이 한 번도 적용되지 않는다 —
     실제로 그 상태로 커밋했다(2026-08-17 검토 P2). 미디어쿼리는 특정성을 올려 주지 않는다. */
  html:root:has(.hjump){scroll-padding-top:calc(var(--topbar) + var(--s4))}
}
/* ⚠**앵커로 뛸 때 sticky 두 겹에 가리지 않게** 여백을 더 준다 */
html:has(.hjump){scroll-padding-top:calc(var(--topbar) + 52px)}

/* 先週の顔 — **순위 번호를 크게 쓰지 않는다.** 한 주짜리 순위를 시즌 순위와
   같은 무게로 그리면 그렇게 읽힌다 */
/* 予告先発 의 상대 타자 표 — 今季 / 범위 전환.
   ⚠**전환 줄을 표에서 떼어 놓는다** — 붙어 있으면 표 머리처럼 읽힌다. */
.muwrap{margin-top:var(--s4)}
.muswitch{display:flex;margin:0 0 var(--s3)}
/* ⚠**묶음 사이가 항목 사이와 비슷하면 어디서 바뀌는지 모른다**(2026-08-18 유저 지적).
   打者 → 投手 로 넘어가는 자리가 사람과 사람 사이와 같은 간격이었다.
   ⚠**아래 패딩을 여기서 또 주지 않는다** — 구획 자체가 이미 아래 여백을 갖는다.
   「묶음 사이를 벌린다」고 넣은 것이 구획 아래에서 이중으로 쌓이고 있었다. */
.wkcol{min-width:0}
.cols > .wkcol + .wkcol{margin-top:var(--s4)}
/* ⚠**이 목록에 CSS 가 한 줄도 없었다**(2026-08-18 유저 지적: 「득실점 쪽은 뭘 말하고 싶은지 모르겠음」).
   그래서 득실차를 감싼 <s> 태그가 **브라우저 기본 취소선**으로 그려졌다 —
   25/6+19 의 +19 에 줄이 그어져 「무효」처럼 보였다. 화면이 정반대를 말하고 있었다.
   ⚠**순위표와 같은 어법으로 맞춘다** — 값 옆에 点差 라벨, 부호는 글자, 색은 --up/--dn. */
.wkteams{list-style:none;margin:0;padding:0;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:0 var(--s6)}
.wkteams li{display:flex;align-items:baseline;gap:var(--s4);padding:var(--s3) 0;
  border-bottom:var(--rw-row) solid var(--hair);font-variant-numeric:tabular-nums}
/* 마지막 줄의 밑줄은 지운다 — 구획 테두리와 이중선이 된다 */
.wkteams li:last-child{border-bottom:var(--rw-none)}
.wkteams b{font-family:var(--f-num);font-size:var(--fs-lead);font-weight:var(--w-bold);white-space:nowrap}
/* ⚠**margin-left:auto 로 오른쪽 끝에 붙이지 않는다**(2026-08-18 유저 지적).
   한 줄에 한 팀만 들어가는 폭에서는 팀명과 성적 사이가 화면 폭만큼 벌어져,
   **같은 줄인데 따로 노는** 모양이 된다 — 눈이 두 번 움직여야 한 팀을 읽는다.
   → 붙여 놓고 gap 으로만 띄운다. 숫자 자리는 tabular-nums 가 맞춘다. */
.wkteams em{font-style:normal;font-size:var(--fs-note);color:var(--tx-3);white-space:nowrap}
.wkteams em s{text-decoration:none;font-family:var(--f-num);font-weight:var(--w-bold);font-size:var(--fs-data);margin-left:var(--s2)}
.wkteams em s.up{color:var(--up)}
.wkteams em s.dn{color:var(--dn)}
.wkteams em i{font-style:normal;font-size:var(--fs-min);letter-spacing:.14em;color:var(--tx-3);margin-left:var(--s1)}
/* ⚠**서브타이틀이 내용보다 작았다**(2026-08-18 유저 지적).
   10px 자간 .16em 회색이라 바로 아래 12~15px 내용에 묻혔고, 그래서
   「어디서 내용이 바뀌는지」가 안 보였다 — 打者 / 投手 / 球団 을 가르는 유일한 표시인데도.
   → **본문보다 크게 하지는 않되**(§6: 숫자가 주역) 무게·색·구분선으로 확실히 가른다. */
.wklab{margin:0 0 var(--s4);font-size:var(--fs-data);font-weight:var(--w-bold);letter-spacing:.1em;color:var(--tx);
  display:flex;align-items:baseline;gap:var(--s4);
  padding:0 0 var(--s2) var(--s4);position:relative;border-bottom:var(--rw-row) solid var(--hair)}
/* 구획 제목과 같은 어법의 짧은 색 막대 — 「여기서 새 묶음이 시작한다」 */
.wklab::before{content:"";position:absolute;left:0;top:1px;bottom:6px;width:3px;
  background:var(--tx-3)}
.wklab s{text-decoration:none;letter-spacing:0;font-size:var(--fs-label);font-weight:var(--w-reg);color:var(--tx-3)}
.wklist{list-style:none;margin:0;padding:0;counter-reset:wk}
/* ⚠**패딩을 늘려 항목을 갈랐다**(2026-08-18 유저 지적: 「경계가 약하거나 패딩이 좁거나
   일정하지 않아서 구분이 모호」). 6px 은 한 항목이 세 줄(이름·값·성적)인 목록에서
   **줄 간격과 구별되지 않는다** — 어디까지가 한 사람인지가 안 보였다. */
.wklist li{display:grid;grid-template-columns:auto auto 1fr;gap:var(--s2) var(--s3);align-items:baseline;
  padding:var(--s4) 0;border-bottom:var(--rw-row) solid var(--hair-2)}
.wklist li:last-child{border-bottom:var(--rw-none)}
.wklist li::before{counter-increment:wk;content:counter(wk);grid-row:span 2;
  font-size:var(--fs-col);color:var(--tx-3);width:11px;font-variant-numeric:tabular-nums}
.wklist a{font-size:var(--fs-lead)}
/* ⚠**margin-left:auto 가 값을 이름 길이에 따라 움직이게 하고 있었다**(2026-08-18 유저 지적).
   이 격자의 2번째 열은 폭이 auto 라 **그 열에서 가장 넓은 것**(=선수 이름)이 폭을 정한다.
   거기에 값을 오른쪽 정렬로 붙였으니, 이름이 두 글자인 사람과 세 글자인 사람의
   +7.7 · +5.7 이 **서로 다른 x 에서 시작**했다 — 세로로 훑을 때 눈이 걸린다.
   → 왼쪽 정렬로 되돌린다. 숫자 폭은 tabular-nums 가 이미 맞춰 준다. */
.wklist b{font-size:var(--fs-lead);font-weight:var(--w-bold);font-variant-numeric:tabular-nums}
.wklist s{text-decoration:none;font-size:var(--fs-min);letter-spacing:.1em;color:var(--tx-3)}
/* 성적 줄은 다음 줄 전체를 쓴다 — 분모가 잘리면 M2 를 어긴 화면이 된다 */
.wklist em{grid-column:2 / -1;font-style:normal;font-size:var(--fs-note);color:var(--tx-2);
  font-variant-numeric:tabular-nums}

/* 순위표의 전환 줄. ⚠**「지금 몇 명을 보고 있는가」를 늘 낸다**(M2) —
   전환했는데 인원이 안 보이면 무엇이 늘고 줄었는지 알 수 없다 */
.rankonly{margin:0 0 var(--s4)}
/* 「全員」일 때만 나오는 최소 표본 칸.
   ⚠**display 를 주면 [hidden] 을 다시 적어야 한다** — 안 적으면 브라우저 기본의
   [hidden]{display:none} 을 이겨 버려서 **숨긴 것이 안 숨는다.** 서버는 이 칸을 hidden 으로 내고
   (스크립트가 없으면 못 쓰는 조작이므로) 클라이언트가 「全員」에서만 연다 */
.rankmin{display:inline-flex;align-items:center;gap:var(--s3)}
.rankmin[hidden]{display:none}
/* ⚠**위의 .mfind input 을 순서가 아니라 특이도로 이긴다** — 저쪽은 width:170px 이고
   680px 이하에서 다시 width:auto 로 바뀐다. 순서에 기대면 규칙 하나가 옮겨진 날 조용히 어긋난다.
   ⚠**이 주석에 역따옴표를 쓰지 마라** — 이 파일은 통째로 템플릿 리터럴이라 거기서 끊긴다 */
.mfind .rankmin input{width:5.4em;text-align:right;letter-spacing:normal;
  font-variant-numeric:tabular-nums}
/* ⚠**색으로만 말하지 않는다** — 못 읽은 값을 알리는 본체는 아래의 글(data-rankbad)이고 이건 거드는 표시다 */
.mfind .rankmin input[aria-invalid="true"]{border-color:var(--warn)}
/* 못 읽은 값을 알리는 글. ⚠**보통 안내문과 같은 회색으로 두지 않는다** — 「친 값이 안 먹었다」는
   말이라 눈에 걸려야 한다. .empty 의 color 를 특이도로 이긴다(0,2,0 대 0,1,0).
   ⚠--warn 이 --page 위에서 AA 를 넘는 것은 css-contrast.test.ts 가 두 테마 다 잰다 */
.empty[data-rankbad]{color:var(--warn);padding-left:var(--s3);box-shadow:inset 2px 0 0 var(--warn)}
/* ⚠**자르지 않고 상자 안에서 스크롤한다.** 상위 N만 내면 대타·중간계투가 사라지고,
   찾는 사람이 없는 순간 이 기능은 없는 것과 같아진다 */
.picklist{display:flex;flex-wrap:wrap;gap:var(--s2);max-height:184px;overflow-y:auto;
  overscroll-behavior-y:contain;padding:var(--s1)}
.pk{font:inherit;font-size:var(--fs-data);padding:var(--s2) var(--s4);cursor:pointer;background:transparent;
  color:var(--tx-2);border:var(--rw-row) solid var(--hair-2);display:inline-flex;align-items:baseline;gap:var(--s2);
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.pk s{text-decoration:none;font-size:var(--fs-col);color:var(--tx-3);font-variant-numeric:tabular-nums}
.pk em{font-style:normal;font-size:var(--fs-min);letter-spacing:.08em;color:var(--chip-ink,#fff);
  background:var(--chip,#6b7280);padding:0 var(--s2)}
.pk:hover{color:var(--tx);border-color:var(--tx-3)}
/* 고른 것은 **버튼 자신이** 말한다 — 위의 pickbar만 바뀌면 목록 안에서 무엇을 눌렀는지 잃는다 */
.pk[aria-pressed="true"]{background:var(--chip,#6b7280);color:var(--chip-ink,#fff);
  border-color:var(--chip,#6b7280);font-weight:var(--w-bold)}
/* ⚠**여기도 opacity 를 뺐다**(위와 같은 이유). 눌린 칩의 잉크는 구단 색에 맞춰 고른 값이라
   그 위에 투명도를 얹으면 **대비를 계산한 의미가 없어진다.** 크기가 이미 부제임을 말한다. */
.pk[aria-pressed="true"] s{color:inherit}
.pk[aria-pressed="true"] em{background:var(--chip-ink,#fff);color:var(--chip,#6b7280)}
/* 비교 화면에서는 **어느 자리에 들어갔는지**까지 말한다 — 채울 자리가 둘이다 */
/* ⚠**「11.35 / 10.14」도 틀린 수였다**(2026-09-08 · 같은 조사). data-slot 은 **눌린 버튼에만** 붙으므로
   (markCmp 가 aria-pressed 와 함께 세운다) 실제 바탕은 --panel 이 아니라 **--chip(구단 색)** 이고
   잉크는 **--chip-ink** 다. .85 로 합성하면 **広島 4.246 으로 미달**(12구단 최저).
   이 글자는 「A / B 어느 자리에 넣었는가」를 말하는 정보라 흐릴 자리가 아니다.
   → **opacity 를 뺀다.** 12구단 최저 **5.466**. */
.pk[data-slot]::after{content:attr(data-slot);font-size:var(--fs-min);margin-left:var(--s2)}
.pickfind{margin:var(--s6) 0 0;border-top:var(--rw-row) solid var(--hair);padding-top:var(--s5)}
.pickfind .picker{margin-top:var(--s5)}

/* ── 試合ページ ────────────────────────────────────────────
   ⚠**원본의 이닝별 표를 옮긴 화면이 아니다**(L2). 숫자는 우리가 타석 로그에서 조립했고,
   화면의 주역은 「어디서 점수가 났는가」와 「어느 타석이 경기를 움직였는가」다. */
.gbig{display:grid;grid-template-columns:1fr;gap:var(--s1);max-width:520px}
.gbside{display:flex;align-items:center;gap:var(--s5);padding:var(--s3) 0;border-bottom:var(--rw-row) solid var(--hair)}
.gbside:last-child{border-bottom:var(--rw-none)}
.gbt{display:flex;align-items:center;gap:var(--s4);font-size:var(--fs-name);color:var(--tx-2);min-width:0}
.gbt i{width:12px;height:12px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠이긴 쪽은 **크기와 굵기**로 표시한다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.gbside.w .gbt{color:var(--tx);font-weight:var(--w-bold)}
.gbr{margin-left:auto;font-size:var(--fs-score-2);line-height:1;font-variant-numeric:tabular-nums;color:var(--tx-3);
  letter-spacing:-.02em}
.gbside.w .gbr{font-size:var(--fs-score-3);color:var(--tx);font-weight:var(--w-bold)}
.gtie2{margin:var(--s4) 0 0;font-size:var(--fs-data);color:var(--tx-2)}
/* 이닝별 득점 — 득점한 칸이 먼저 보여야 한다 */
table.iscore{font-variant-numeric:tabular-nums;margin-top:var(--s5)}
table.iscore th,table.iscore td{text-align:center;padding:var(--s2) var(--s4);white-space:nowrap}
table.iscore th.l{text-align:left}

table.iscore td.sc{font-weight:var(--w-bold);color:var(--tx);background:var(--panel-2)}
/* ⚠「x」는 0이 아니다 — 공격이 없었다는 뜻이다. 흐리게 두어 숫자와 섞이지 않게 한다 */
table.iscore td.x{color:var(--tx-3)}
table.iscore .tot{font-weight:var(--w-bold);border-left:var(--rw-row) solid var(--hair-2)}
/* 타석 목록 — 훑어 읽는 자리다. 이닝 · 상황 그림 · 사람 · 결과 · 점수 · 움직임 */
.plays{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.play{display:grid;grid-template-columns:4.6em 34px minmax(0,1fr) minmax(0,1.1fr) 4.2em 5.4em;
  gap:0 var(--s4);align-items:center;padding:var(--s4) 0;border-bottom:var(--rw-row) solid var(--hair)}
.play:last-child{border-bottom:var(--rw-none)}
.pin{font-size:var(--fs-sub);color:var(--tx-3);letter-spacing:.04em}
.pdia{display:flex;align-items:center}
.pwho{min-width:0;font-size:var(--fs-lead);display:flex;flex-direction:column;gap:var(--s1)}
.pwho a{text-decoration:none;font-weight:var(--w-bold);border-bottom:var(--rw-row) solid var(--hair-2)}
.pwho a:hover{border-bottom-color:var(--tx-3)}
.pwho s{text-decoration:none;font-size:var(--fs-label);color:var(--tx-3)}
/* ⚠**상대 투수도 링크지만 타자와 같은 무게로 만들지 않는다.**
   .pwho a 는 700 인데 그걸 그대로 받으면 둘째 줄이 첫째 줄과 같은 세기로 보여
   「누가 친 타석인가」라는 이 줄의 정보 위계가 무너진다. 굵기는 본문 그대로 두고
   **밑줄 한 올만** 남겨 누를 수 있다는 것만 말한다(색은 a{color:inherit} 로 s 를 따른다). */
.pwho s a{font-weight:inherit;border-bottom-color:var(--hair)}
.pres{font-size:var(--fs-lead);color:var(--tx-2);min-width:0;display:flex;align-items:baseline;gap:var(--s3)}
.pres em{font-style:normal;font-size:var(--fs-note);font-weight:var(--w-bold);color:var(--tx);
  border-left:var(--rw-mast) solid var(--chip,#6b7280);padding-left:var(--s2);flex:none}
/* ⚠**타점 없는 득점은 타자가 낸 점이 아니다.** 굵게 두면 그 타석의 성과로 읽힌다 */
.pres em.norbi{font-weight:var(--w-reg);color:var(--tx-2);border-left-color:var(--hair-2)}
.pres em.norbi s{text-decoration:none;font-size:var(--fs-min);color:var(--tx-3);margin-left:var(--s2)}
.psc{font-size:var(--fs-data);color:var(--tx-3);font-variant-numeric:tabular-nums;text-align:right}
.pswing{position:relative;text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-lead);padding-bottom:var(--s3)}
.pswing.none{color:var(--tx-3)}
.pswing i{position:absolute;bottom:0;height:3px;width:calc(var(--w) * 1%);font-style:normal;opacity:.8}
.pswing i.p{right:0;background:var(--g-vgood)}
.pswing i.n{right:0;background:var(--g-vbad)}
/* 주자 다이아몬드 — **우리 데이터로 그린 우리 그림**(로고·사진 금지의 대체물) */
.dia{display:block;overflow:visible}
.dia .db{fill:none;stroke:var(--tx-3);stroke-width:1.2}
/* ⚠**윤곽선까지 구단 색으로 칠하면 「주자 있음」이 「베이스가 없음」으로 보인다**
   (2026-08-19 감사 P1 · 2026-08-20 수정 · 경기 페이지 7,502장 = 사이트의 49%).
   빈 베이스는 --tx-3 테두리로 **6.67:1** 이라 확실히 보이는데, 찬 베이스는 면과 선이 같은 색이라
   대비가 낮은 구단에서 **둘 다 한꺼번에 사라졌다.** WCAG 1.4.11(비텍스트 3:1) 기준으로
   **12구단 전부가 한쪽 테마에서 미달**이었다(라이트: 阪神 1.61 등 / 다크: オリックス 1.08 등).
   ⚠**색을 밝게 고르는 것으로는 못 고친다** — 어느 색이든 한쪽 테마에서 무너진다.
   → **면만 구단 색, 윤곽과 굵기는 중립 고대비.** 색이 안 보여도 「두꺼운 마름모」가 남는다.
   --tx 는 어느 바탕에서도 실측 라이트 15.85~17.89 · 다크 12.36~14.74 다. 굵기 1.2→2.0 이 형태 채널이고,
   이 파일이 .hteam i · .cal td.ctoday 에서 이미 쓴 수법이다.
   ⚠**game-page.ts 의 주석이 「명도 차이로도 읽힌다」고 적어 뒀는데 그건 실측에 반박당했다** —
   같이 고쳤다. 두 곳에 적은 사실은 두 곳 다 고쳐야 한다. */
.dia .db.on{fill:var(--chip,#6b7280);stroke:var(--tx);stroke-width:2}
.dia .do{fill:none;stroke:var(--tx-3);stroke-width:1}
.dia .do.on{fill:var(--tx-2);stroke:var(--tx-2)}
@media (max-width:600px){
  .play{grid-template-columns:3.9em 30px minmax(0,1fr) 4.6em;gap:var(--s1) var(--s4)}
  /* 좁은 화면에서는 결과와 움직임을 아랫줄로 내린다 — 가로로 밀지 않는다 */
  .pres{grid-column:3 / span 2;font-size:var(--fs-data)}
  .psc{grid-column:1 / span 2;text-align:left;font-size:var(--fs-note)}
  .pswing{grid-column:4;text-align:right}
  .gbr{font-size:var(--fs-score)}
  .gbside.w .gbr{font-size:var(--fs-score-2)}
}

/* ── チーム順位表 ──────────────────────────────────────────
   ⚠**로고를 쓰지 않는다.** 구단 구별은 색 마크와 짧은 이름으로 한다(CLAUDE.md §6). */
.standwrap{margin-bottom:var(--s6)}
.standwrap:last-of-type{margin-bottom:0}
.standname{margin:0 0 var(--s3);font-size:var(--fs-note);letter-spacing:.14em;font-weight:var(--w-bold);color:var(--tx-2)}
table.stand{font-variant-numeric:tabular-nums}
table.stand td,table.stand th{white-space:nowrap}
table.stand .rk{font-weight:var(--w-bold)}
table.stand .rk em{font-style:normal;font-size:var(--fs-min);color:var(--tx-3);margin-left:var(--s1)}

table.stand td.b{font-weight:var(--w-bold)}
/* ⚠**타율과 방어율에도 분모를 붙인다**(M2). 勝率의 분모는 옆의 勝·敗 열 자체이지만,
   打率의 분모는 打数지 試合이 아니다 — 「인접」으로 지켜지지 않으므로 값에 붙인다 */
table.stand td.wd{line-height:1.2}
table.stand td.wd .den{display:block;font-size:var(--fs-min);color:var(--tx-3);margin-top:var(--s1)}
/* 得失点差 — **우리가 만든 그림**. 눈금은 없고, 정확한 값은 바로 옆 숫자에 있다 */
table.stand .dif{position:relative;min-width:64px}
table.stand .dif b{font-weight:var(--w-reg)}
table.stand .dif i{position:absolute;bottom:3px;height:3px;width:calc(var(--w) * 0.5%);
  background:var(--chip,#6b7280);font-style:normal;opacity:.75}
table.stand .dif i.p{left:50%}
table.stand .dif i.n{right:50%}

/* ── シーズン切り替え ────────────────────────────────────────
   ⚠**연도 두 개만 띄우지 않는다.** 「シーズン」이라는 이름이 없으면 그게 무엇을 고르는
   조작인지 알 수 없고, 순위표의 리그 탭과 헷갈린다. */
/* ⚠**한 줄로 두고 가로로 굴린다**(2026-08-17 유저 요청).
   시즌이 늘수록 줄바꿈이 생겨 머리가 두세 줄이 됐다 — 본문이 그만큼 아래로 밀린다.
   ⚠**flex-wrap:wrap 을 지우는 것만으로는 부족하다** — 넘친 것을 **잡을 수 있어야** 한다.
   ⚠**스크롤바를 숨기지 않는다.** 숨기면 더 있다는 것을 알 방법이 마우스 유저에게 없다. */
/* ⚠**스냅이 연도를 라벨 밑에 세운다**(2026-08-18 유저 지적: 「시즌 텍스트와 2026년이 겹침」).
   .seasons a 에 scroll-snap-align:start 가 있고 .slab 은 sticky left:0 이라,
   스냅이 끝나면 연도 하나가 **정확히 라벨이 있는 자리**에 와서 멈춘다 — 겹치는 것이 당연하다.
   ⚠**scroll-padding-left 로 스냅 기준선을 라벨 오른쪽으로 민다.**
   라벨 폭(약 50px)+여백보다 넉넉하게 잡는다 — 모자라면 다시 겹친다. */
/* ⚠**.topbar 와 같은 이유로 오른쪽을 맞춘다**(그쪽 주석 참조) — 이 띠도 .shell 밖이다.
   ⚠**가로 스크롤이 있는 띠다**(시즌이 늘면 넘친다). 여유 폭이 커지면 스크롤이 덜 필요해질 뿐,
   넘칠 때의 거동은 그대로다. */
.seasons{display:flex;align-items:center;gap:var(--s2);padding:var(--s2) var(--pad);
  padding-left:calc(var(--gut) + var(--pad));padding-right:calc(var(--gut) + var(--pad));
  border-bottom:var(--rw-row) solid var(--hair);background:var(--panel-2);
  flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;
  scrollbar-width:thin;scroll-snap-type:x proximity;
  scroll-padding-left:84px}
.seasons::-webkit-scrollbar{height:6px}
.seasons::-webkit-scrollbar-thumb{background:var(--hair-2);border-radius:var(--r-thumb)}
/* ⚠**라벨은 굴러 나가지 않는다** — 무엇을 고르는 줄인지가 사라지면 안 된다 */
/* ⚠**라벨이 덮는 넓이가 자기 글자만큼뿐이었다.** align-items:center 라 높이가 글자 높이였고,
   gap 4px + margin 5px 는 배경이 없다 — 그 틈과 위아래로 **지나가는 연도가 그대로 보였다.**
   → 세로로 늘려 칸을 꽉 채우고, 오른쪽으로 배경을 더 뻗어 gap 까지 덮는다.
   ⚠**그림자로 「밑으로 지나간다」를 말한다** — 안 그러면 글자가 갑자기 사라지는 것으로 보인다. */
/* ⚠**라벨과 첫 연도가 붙어 보였다**(2026-08-18 유저 지적: 「선택 박스가 시즌 텍스트 영역에 가려짐」).
   그림자를 12px 이나 뻗어 놔서 **고른 연도의 테두리 위로 그늘이 졌고**, 구분선이 없어
   어디까지가 라벨인지도 애매했다.
   → **세로선으로 가른다**(범례와 같은 수법). 그림자는 스크롤 중에만 뜻이 있으므로 짧게 줄인다. */
.slab{font-size:var(--fs-min);letter-spacing:.16em;color:var(--tx-3);
  position:sticky;left:0;z-index:3;background:var(--panel-2);
  align-self:stretch;display:flex;align-items:center;
  margin-right:0;padding-right:var(--s5);flex:0 0 auto;
  border-right:var(--rw-row) solid var(--hair-2);
  box-shadow:4px 0 0 0 var(--panel-2),7px 0 6px -6px rgba(0,0,0,.20)}
/* 구분선 오른쪽으로 첫 연도가 바로 붙지 않게 한다 */
.seasons .slab + a{margin-left:var(--s3)}
.seasons a{flex:0 0 auto;scroll-snap-align:start}
/* 시즌 중 이적 이력. ⚠**합계와 순위가 다른 이유**가 여기 적힌다 */
.stint{display:block;font-size:var(--fs-label);color:var(--tx-3);margin-top:var(--s1)}
/* 「합계와 순위의 수가 왜 다른가」 — 이적 이력 바로 아래에 붙는다 */
/* ⚠**opacity 를 뺐다**(위 .den em 과 같은 이유 · 2026-08-18). 뒤로 물리는 것은 크기와 색이 한다 */
.stint em{display:block;font-style:normal;font-size:var(--fs-col);color:var(--tx-3)}
.seasons a{font-size:var(--fs-data);padding:var(--s1) var(--s4);text-decoration:none;color:var(--tx-2);
  border:var(--rw-row) solid transparent;transition:color var(--t1) var(--e-out)}
.seasons a:hover{color:var(--tx);border-color:var(--hair-2)}
/* ⚠**「지금 여기」를 상단 내비와 같은 언어로 말한다**(2026-09-08 · 2b · M1).
   여태 이 칩만 **상자**로 표시했는데, 그 상자의 위·아래 테두리가 .topbar 의 밑줄과
   .seasons 의 밑줄 사이에 끼어 **34px 안에 가로선 4개**가 됐다(실측 16무리 · 간격 2~5px).
   상단 내비는 같은 뜻을 이미 inset 밑줄 2px 으로 말한다 — 표시 언어가 두 벌일 이유가 없다.
   ⚠**면도 뺐다** — --panel 이 .seasons 바탕(--page)과 **1.044** 라 보이지 않던 면이다.
   ⚠**색만으로 말하지 않는다**(§7) — 굵기(bold)와 잉크(--tx)가 같이 말한다. */
.seasons a[aria-current="page"]{color:var(--tx);font-weight:var(--w-bold);
  box-shadow:inset 0 calc(-1 * var(--rw-sect)) 0 var(--team,var(--tx-3))}
/* 같은 화면이 그 시즌에 없어 다른 곳으로 보낼 때. **숨기지 않고 표시한다**
   ⚠**탭줄과 브랜드도 같은 표식을 쓴다**(M1). 드래프트만 굽는 시즌(2005~2017)에서는
   그 시즌에 없는 화면의 탭이 **가장 최신 시즌으로** 간다 — 조용히 해가 바뀌면
   사용자는 그것을 모른다. 표식은 i 요소 하나이고 뜻은 세 자리에서 같다.
   ⚠**색만으로 말하지 않는다**(§7) — 글자(→)가 그 일을 하고 색은 뒤로 물릴 뿐이다.
   ⚠**이 주석에 역따옴표를 쓰지 마라** — 이 파일은 통째로 템플릿 리터럴이라 거기서 끊긴다. */
.seasons a i,.tnav a i,.brand i{font-style:normal;font-size:var(--fs-min);color:var(--tx-3);margin-left:var(--s1)}

/* ── 試合（直近の結果） ──────────────────────────────────────
   ⚠**원본 표(이닝별 스코어보드)를 재현하지 않는다**(L2). 우리가 가진 것은 R·H·E뿐이고,
   화면은 그 사실에 맞춰 만든다 — 없는 칸을 흉내 내지 않는다. */
.gcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:var(--s5)}
.gcard{border:var(--rw-row) solid var(--hair-2);padding:var(--s5) var(--s5) var(--s4);min-width:0}
/* ⚠**opacity 로 「열리지 않았다」를 말하지 않는다** — .daystep.off 가
   같은 이유로 이미 고쳐진 자리다(아래). **이것이 그 청소에서 살아남은 마지막 한 건**이었다.
   실측(2026-08-21 다방면 감사 · 독립 구현 2벌로 재계산): opacity:.62 를 얹으면
   카드 안 글자가 **바탕을 어느 쪽으로 잡아도 12/12 FAIL** 이다 —
   .gvenue 2.42–2.88 · .gt 2.74–3.54 · .gnone 2.42–2.88 (기준 4.5).
   글자 크기가 10.5/11.5/13.5px · weight 400 이라 **대문자 예외도 없다.**
   opacity 를 벗기면 4.91–7.23 로 전부 통과한다 — 원인은 토큰이 아니라 **그 한 줄**이었다.
   ⚠**중지 경기에는 승자가 없어 .gside.w 가 0개**다 — 「이긴 팀은 굵어서 통과」가 아니라
   **카드 안 모든 글자**가 미달이었다. 실측 범위: **208/15,340장 · 284카드**.
   ⚠**「中止」는 오히려 올린다** — 흐린 카드만이 가진 정보가 「어느 경기인가」·「왜 안 했는가」다. */
.gcard.off{border-style:dashed}
.gcard.off .gvenue,.gcard.off .gt,.gcard.off .gr{color:var(--tx-2)}
.gcard.off .gnone{color:var(--tx);font-weight:var(--w-semi)}
.gvenue{margin:0 0 var(--s4);font-size:var(--fs-label);letter-spacing:.12em;color:var(--tx-3);font-weight:var(--w-reg);
  display:flex;align-items:baseline;gap:var(--s3)}
.gtie{margin-left:auto;color:var(--tx-2);letter-spacing:.04em}
.gscore{display:flex;flex-direction:column;gap:var(--s1)}
.gside{display:flex;align-items:baseline;gap:var(--s4);padding:var(--s1) 0}
.gside .gt{display:flex;align-items:center;gap:var(--s3);font-size:var(--fs-lead);color:var(--tx-2)}
/* ⚠**어느 쪽이 홈인지가 카드에 없었다**(2026-08-20 감사 ②). 홈 화면의 「＠팀」과 같은 어법이다(M1).
   ⚠**자리는 두 줄 다 비워 둔다** — 글자를 한쪽에만 붙이면 팀명 시작선이 어긋난다.
   ⚠생성 콘텐츠는 낭독되지 않을 수 있어 마크업에 .vh 로 「ホーム／ビジター」를 함께 둔다 */
.gside .gt::before{content:"";flex:none;width:.9em;text-align:center;
  font-size:var(--fs-label);color:var(--tx-3)}
.gside.h .gt::before{content:"＠"}
.gside .gt i{width:9px;height:9px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠이긴 쪽은 **굵기와 크기**로 표시한다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.gside.w .gt{color:var(--tx);font-weight:var(--w-bold)}
.gside .gr{margin-left:auto;font-size:var(--fs-num);line-height:1;font-variant-numeric:tabular-nums;color:var(--tx-2)}
.gside.w .gr{font-size:var(--fs-score);font-weight:var(--w-bold);color:var(--tx)}
.ghe{margin:var(--s4) 0 0;display:flex;gap:var(--s5);font-size:var(--fs-note);color:var(--tx-3);
  padding-top:var(--s3);border-top:var(--rw-row) solid var(--hair)}
.ghe b{color:var(--tx-2);font-weight:var(--w-reg);font-variant-numeric:tabular-nums}
.gdec{margin:var(--s3) 0 0;display:flex;flex-wrap:wrap;gap:var(--s2) var(--s5);font-size:var(--fs-sub)}
.gd b{font-size:var(--fs-min);letter-spacing:.1em;color:var(--tx-3);font-weight:var(--w-reg);margin-right:var(--s2)}
.gd a{text-decoration:none;border-bottom:var(--rw-row) solid var(--hair-2)}
.gd a:hover{border-bottom-color:var(--tx-3)}
.gnone{margin:var(--s3) 0 0;font-size:var(--fs-sub);color:var(--tx-3)}
.gstars{list-style:none;margin:var(--s4) 0 0;padding:var(--s4) 0 0;border-top:var(--rw-row) solid var(--hair);
  display:flex;flex-direction:column;gap:var(--s2)}
.gstars li{display:flex;align-items:baseline;gap:var(--s3);font-size:var(--fs-data);min-width:0}
/* ⚠**유일한 구단 표시가 폭 3px 색 막대였다**(2026-08-21 감사 확정 P1).
   구단색과 --panel 의 대비가 **다크 8/12 · 라이트 4/12** 구단에서 3:1 미달이라
   그 막대가 그냥 사라졌다(배포물 1,431장 · 21,812행).
   ⚠**같은 파일이 두 곳에서 이미 쓰던 방식**이다 — 색이 아니라 **윤곽**이 보이게 한다.
   ⚠윤곽을 둘러도 **색각 특성에서 두 구단색이 가까운 쪽(감사 실측 883/21,812 행)은 안 풀린다** —
   그건 마크업 쪽의 낭독용 구단명이 받는다. */
.gstars li i{width:3px;align-self:stretch;background:var(--chip,#6b7280);font-style:normal;flex:none;
  box-shadow:inset 0 0 0 1px var(--tx-2);position:relative}
.gstars a{text-decoration:none;font-weight:var(--w-bold);white-space:nowrap}
.gstars a:hover{text-decoration:underline}
.gsl{color:var(--tx-2);font-variant-numeric:tabular-nums;font-size:var(--fs-sub)}
.gsd{margin-left:auto;font-style:normal;font-size:var(--fs-col);color:var(--tx-3);border:var(--rw-row) solid var(--hair-2);padding:0 var(--s2);flex:none}
.gmore{margin:var(--s4) 0 0;padding-top:var(--s4);border-top:var(--rw-row) solid var(--hair);font-size:var(--fs-sub)}
.gmore a{text-decoration:none;border-bottom:var(--rw-row) solid var(--hair-2)}
.gmore a:hover{border-bottom-color:var(--tx-3)}

/* ⚠**긴 표에는 걸지 않는다.** 한때 걸었다가 뺐다 — 실측으로 순위 화면의 scroller 80개 중
   실제로 렌더되는 것은 **2개**뿐이었다(나머지는 닫힌 탭 패널 안이라 이미 display:none 이다).
   그 2개는 대개 첫 화면 안에 있어 생략할 것이 없고, contain 의 부작용만 남는다.
   근거로 들었던 「대전 146행·순위 122행」은 전부 탭 패널 안이라 이 규칙이 애초에 안 닿는다. */

/* ── 球団ページ ────────────────────────────────────────────
   ⚠**로고를 쓸 수 없는 자리에서 팀을 구별하는 것은 구단 색과 이름이다**(§6).
   월별 막대는 우리가 계산한 값으로 만든 우리 그림이다. */
/* 「いまの状況」 — 이 화면에서 가장 먼저 읽히는 줄.
   ⚠**값이 주역이고 라벨은 그 옆에 붙는다**(§6의 도메인 예외). 다만 분모는 값에서 떼지 않는다(M2).
   ⚠**칸으로 감싸지 않는다** — 카드 그리드 금지(§6). 가르는 것은 여백과 괘선이다. */
.tnow{margin:0 0 var(--s2);display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s1) var(--s5);
  font-size:var(--fs-data);color:var(--tx-2);font-variant-numeric:tabular-nums}
.tnow b{font-style:normal;font-weight:var(--w-semi);color:var(--tx)}
/* 라벨 — 값보다 작게 두되 폭을 맞춰 세 줄이 같은 자리에서 시작하게 한다 */
.tnow s{text-decoration:none;font-size:var(--fs-label);letter-spacing:.1em;color:var(--tx-3);
  min-width:5.4em;flex:none}
.tnow.head{gap:var(--s1) var(--s5);margin-bottom:var(--s4)}
/* ⚠**순위 숫자를 구단 색으로 칠하지 않는다**(2026-08-19 실측). 배경으로 쓸 때는 --team-ink 가
   짝이 되지만 글자색에는 짝이 없고, **어느 구단 색이든 한쪽 테마에서 무너진다** —
   阪神 #f2c800 은 라이트 1.61:1, ロッテ #22262b 는 다크 1.10:1 이다.
   구단 색은 이 화면에 이미 .spine 과 .idline 의 3px 밑줄로 들어와 있다. */
.tnow.head b{font-size:var(--fs-num);line-height:1.1;color:var(--tx)}
/* 우승 경쟁 한 줄.
   ⚠**글자만으로 말한다.** 「消滅」을 붉게 칠하면 판정의 세기가 색으로 과장되고,
   색각 특성에 따라 아예 전달되지 않는다(이 화면의 승패 표기와 같은 규칙).
   ⚠괘선도 구단 색을 쓰지 않는다 — 위와 같은 이유로 ロッテ·オリックス의 다크에서
   패널 바탕과 1.1:1 이라 **선이 통째로 사라진다.** 가르는 것은 여백과 괘선이다. */
.tnow.race{margin:var(--s5) 0 0;font-size:var(--fs-name);color:var(--tx);
  border-left:var(--rw-mast) solid var(--hair-2);padding-left:var(--s4)}
/* 이동 버튼 — 이 띠에서 각 상세로 뛴다. 탭이 아니므로 탭처럼 보이지 않게 한다 */
.tgo{margin:var(--s5) 0 0;display:flex;flex-wrap:wrap;gap:var(--s3) var(--s4);font-size:var(--fs-sub)}
.tgo a{text-decoration:none;padding:var(--s2) var(--s4);border:var(--rw-row) solid var(--hair-2);color:var(--tx-2);
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.tgo a:hover{color:var(--tx);border-color:var(--tx-3)}
.tmonths{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:var(--s4)}
.tmonth{display:flex;flex-direction:column;gap:var(--s1);min-width:0}
.tmonth b{font-size:var(--fs-note);color:var(--tx-2);font-weight:var(--w-reg)}
.tmonth s{text-decoration:none;font-size:var(--fs-label);color:var(--tx-3);
  font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:var(--s2)}
.tmonth em{font-style:normal;font-size:var(--fs-min)}
/* 이긴 만큼과 진 만큼을 위아래로 — 색만으로 말하지 않게 수를 옆에 둔다.
   ⚠**뜻을 나르는 것은 색이 아니라 위치와 옆의 수다** — 勝은 늘 위, 敗는 늘 아래이고
   바로 옆 s 가 「○勝○敗○分 · ○試合」을 분모까지 적는다(M2). 막대는 **거드는 그림**이다.
   ⚠**그래도 안 보이면 그림이 아니라 얼룩이다**(2026-08-22 감사 #21 · 실측 12구단):
     막대 대 바탕 3:1 미달 — 라이트 **4/12** · 다크 **8/12** · **합집합 12/12**
       (阪神 라이트 1.61 · ソフトバンク 1.64 · オリックス 다크 1.08 · ロッテ 1.10 …)
     敗 막대(--hair-2)는 **전 구단·양 테마에서 미달** — 라이트 **1.580** · 다크 **1.557**
   → **두 막대에 같은 1px 테두리를 준다.** tx-3 은 라이트 5.125 · 다크 5.072 로 어느 바탕에서도 선다.
   ⚠**box-shadow 다. border 가 아니다** — border 면 높이가 2px 늘어 막대가 값을 거짓말한다.
   ⚠**敗를 더 진하게 만들지 않는다.** 같은 화면의 .trecent 가 바로 그 실수를 이미 겪었다 —
   진 쪽만 또렷해서 팀이 실제보다 나쁘게 읽혔다. 여기서 고치는 것은 **보이는가**이지 **누가 눈에 띄는가**가 아니다 */
.tbar{display:flex;flex-direction:column;gap:var(--s1);height:26px;justify-content:flex-end}
.tbar i{display:block;font-style:normal;box-shadow:inset 0 0 0 1px var(--tx-3)}
.tbar .w{height:calc(var(--w) * 0.24px);background:var(--team,#6b7280)}
.tbar .l{height:calc(var(--l) * 0.24px);background:var(--hair-2)}
/* 최근 경기 — 결과를 글자로 낸다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.trecent{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0 var(--s6)}
.trecent a{display:flex;align-items:baseline;gap:var(--s4);padding:var(--s2) 0;text-decoration:none;
  border-bottom:var(--rw-row) solid var(--hair)}
.trecent b{font-size:var(--fs-lead);width:1.2em;text-align:center;color:var(--tx-3)}
/* ⚠**이겼다는 표식에 구단 색을 쓰지 않는다**(2026-08-19 감사 P1 · 2026-08-20 수정).
   배경에 쓸 때는 --team-ink 가 짝이 되어 대비가 보장되는데 **글자색에는 짝이 없다.**
   실측(13px 본문 · 4.5:1 필요 · --page 기준) — **12구단 전부가 한쪽 테마에서 미달**이었다:
     라이트 미달  阪神 1.61 · ソフトバンク 1.64 · ヤクルト 2.72 · 巨人 2.79
     다크 미달    オリックス 1.08 · ロッテ 1.10 · 中日 1.35 · 西武 1.46 ·
                  楽天 1.74 · 日本ハム 2.40 · DeNA 2.54 · 広島 2.83
   ⚠**결과가 뜻과 반대였다** — 진 경기(--tx-2 · 6.6:1)만 또렷해서 최근 10경기를 훑으면
   팀이 실제보다 나쁘게 읽혔다. 이긴 경기가 안 보이는 승패 목록은 목록이 아니다.
   → 이 파일이 이미 세워 둔 「뜻이 있는 자리의 강조색」(--up/--dn)을 쓴다. --up 은 어느 바탕에서도
   통과한다 — 실측 라이트 4.95(--panel-2)~5.59(--panel) · 다크 5.87~7.00.
   ⚠**「구단 색은 월별 막대가 이미 배경으로 말하고 있다」고 적혀 있었고 그건 거짓이었다**
   (2026-08-22 감사 #21 · 실측): 그 막대도 **합집합 12/12 가 3:1 미달**이다
   (오릭스 다크 1.08 · 롯데 1.10 — 이 문단이 위에 적어 둔 바로 그 수다).
   막대 쪽은 1px 테두리로 따로 고쳤다(.tbar). **여기서 --up 을 쓰는 이유는 그대로 유효하다** —
   근거가 하나 무너졌을 뿐 결론은 안 바뀐다. */
.trecent li.w b{color:var(--up);font-weight:var(--w-bold)}
.trecent li.l b{color:var(--tx-2)}
.trecent span{font-size:var(--fs-sub);color:var(--tx-2)}
.trecent s{text-decoration:none;margin-left:auto;font-size:var(--fs-sub)}
.trecent a:hover{padding-left:var(--s2)}
/* 순위표·일람의 구단명이 링크가 됐다 — 밑줄 대신 색으로만 반응한다(인쇄물의 질감) */
.stand .tm a,.teamgroup h2 a{text-decoration:none}
.stand .tm a:hover,.teamgroup h2 a:hover{text-decoration:underline}

/* ── 球団一覧 ──────────────────────────────────────────────
   ⚠**격자로 만들지 않는다**(§6 「AI틱함」 금지 목록의 「균질한 카드 그리드」).
   이 화면이 나르는 것은 12개의 동등한 타일이 아니라 **두 리그 × 순위 순서**이고,
   격자는 그 순서를 지운다. 한 구단 = 한 줄기로 세우고, 가르는 것은 칸이 아니라 괘선과 여백이다
   (순위표 .hstand · 최근 경기 .trecent 와 같은 어법).
   ⚠**로고를 쓸 수 없는 자리에서 팀을 구별하는 것은 구단 색과 이름이다**(§6). */
.tlist{list-style:none;margin:0;padding:0}
.tcard{display:grid;grid-template-columns:46px 1fr auto;column-gap:var(--s5);align-items:start;
  padding:var(--s4) var(--pad);margin:0 calc(var(--pad) * -1);border-bottom:var(--rw-row) solid var(--hair)}
.tcard:last-child{border-bottom:var(--rw-none)}
/* ⚠**1위를 색으로 말하지 않는다.** 구단 색을 칠하면 어느 구단이든 한쪽 테마에서 무너진다
   (구단 페이지가 실측으로 이미 밟은 자리 · 阪神 라이트 1.61:1 · ロッテ 다크 1.10:1).
   바탕을 한 단 올리는 것은 순위표의 tr.lead 가 이미 쓰는 수법이다 — 같은 어법으로 말한다. */
.tcard[data-rank="1"]{background:var(--panel-2)}
/* 순위 — 이 화면에서 가장 먼저 읽히는 값. 왼쪽 끝에 고정 폭으로 세워 세로로 훑을 수 있게 한다 */
.tcr{grid-column:1;grid-row:1/span 3;margin:0;text-align:right;font-variant-numeric:tabular-nums}
.tcr b{font-style:normal;font-weight:var(--w-semi);font-size:var(--fs-num);line-height:1.05;color:var(--tx)}
.tcr s{text-decoration:none;display:block;font-size:var(--fs-min);color:var(--tx-3);margin-top:var(--s1)}
.tcn{grid-column:2;grid-row:1;margin:0;min-width:0}
.tcn a{display:inline-flex;align-items:center;gap:var(--s3);text-decoration:none;
  font-size:var(--fs-name);font-weight:var(--w-semi);color:var(--tx)}
/* ⚠**색만으로는 안 된다** — 구단 12색 중 다크 바탕에서 3:1 을 못 넘는 것이 7색이다.
   테두리로 형태를 준다: 색이 안 보여도 사각형은 남는다(.hteam i 와 같은 수법). */
.tcn a i{width:10px;height:10px;background:var(--chip,#6b7280);flex:none;
  box-shadow:inset 0 0 0 1px var(--tx-3)}
.tcn a:hover{text-decoration:underline}
.tcn a:hover i{outline:1px solid var(--tx-3);outline-offset:1px}
/* 성적 한 줄 — ⚠**값이 주역이고 라벨은 그 옆에 붙는다**(§6의 도메인 예외).
   다만 분모는 값에서 떼지 않는다(M2) — .den 이 값 바로 뒤에 붙어 나온다. */
.tcs{grid-column:2;grid-row:2;margin:var(--s1) 0 0;display:flex;flex-wrap:wrap;gap:var(--s1) var(--s5);
  font-size:var(--fs-data);color:var(--tx-2);font-variant-numeric:tabular-nums}
.tcv{display:inline-flex;align-items:baseline;gap:var(--s2);min-width:0}
.tcv s{text-decoration:none;font-size:var(--fs-min);letter-spacing:.1em;color:var(--tx-3);flex:none}
.tcv b{font-style:normal;font-weight:var(--w-semi);color:var(--tx)}
/* ⚠**분모까지 굵어지지 않게 한다.** 분모는 값에 붙어 있어야 하지만(M2) 값과 같은 무게로
   읽히면 「.562 105試合」이 한 덩어리의 수처럼 보인다 — .den 은 무게를 지정하지 않아
   .tcv b 의 600 을 그대로 상속한다. 여기서만 되돌린다. */
.tcv .den{font-weight:var(--w-reg)}
/* 다음 경기 — ⚠**없어도 줄을 지우지 않는다**(M12). 그래서 자리를 늘 차지한다 */
.tcx{grid-column:2;grid-row:3;margin:var(--s1) 0 0;display:flex;align-items:baseline;gap:var(--s3);
  font-size:var(--fs-sub);color:var(--tx-2)}
.tcx s{text-decoration:none;font-size:var(--fs-min);letter-spacing:.1em;color:var(--tx-3);flex:none}
.tcx b{font-style:normal;font-weight:var(--w-reg);color:var(--tx-2)}
.tcf{grid-column:3;grid-row:1/span 3;margin:0;align-self:center}
/* ⚠**눌린 상태를 색만으로 말하지 않는다** — ★와 굵기가 색 없이도 남는다.
   구단 색을 쓰지 않는 이유는 위 .tcard[data-rank="1"] 주석과 같다. */
.favt{font:inherit;font-size:var(--fs-sub);line-height:1;padding:var(--s3) var(--s4);cursor:pointer;white-space:nowrap;
  background:transparent;border:var(--rw-row) solid var(--hair-2);color:var(--tx-3);
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.favt:hover{color:var(--tx-2);border-color:var(--tx-3)}
.favt[aria-pressed="true"]{color:var(--tx);border-color:var(--tx-3);font-weight:var(--w-bold)}
.favt[aria-pressed="true"]::before{content:"★";margin-right:var(--s2)}
/* 좁은 화면에서는 버튼을 아래로 내린다 — 옆에 두면 구단명이 밀려 두 줄이 된다 */
@media (max-width:560px){
  .tcard{grid-template-columns:38px 1fr}
  .tcr b{font-size:var(--fs-title)}
  .tcf{grid-column:2;grid-row:4;margin-top:var(--s3);align-self:start}
}

/* 상대전적 — 이긴 비율의 띠. 눈금은 없고 정확한 수는 옆 칸에 있다 */
table.vs .vsbar{display:inline-block;width:88px;height:6px;background:var(--hair);vertical-align:middle}
table.vs .vsbar i{display:block;height:100%;width:calc(var(--w,0) * 1%);background:var(--chip,#6b7280)}

/* ── ポストシーズン ────────────────────────────────────────
   ⚠**순위가 아니라 기록이다.** 표본이 13경기·5경기라 순위를 붙이면 거짓말이 된다 */
.postrow{margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--s4)}
.postrow>div{display:flex;flex-direction:column;gap:var(--s1)}
.postrow dt{font-size:var(--fs-label);letter-spacing:.12em;color:var(--tx-3)}
/* ⚠**링크는 링크처럼 보이되 UA 기본 밑줄은 쓰지 않는다** — 이 사이트의 다른 링크와 같은 처리다.
   빠뜨리면 이 한 곳만 파란 밑줄에 hover 무반응이 되어 「여기만 남의 화면」이 된다 */
.postrow dt a{text-decoration:none;border-bottom:var(--rw-row) solid var(--hair-2)}
/* ⚠여기도 var(--tx-1)(미정의)이었다 — 이번 검토에서 같이 드러났다(2026-08-17).
   무효 선언이라 상속으로 메워져 「대충 진해지긴」 했지만 의도한 값이 아니었다 */
.postrow dt a:hover{border-bottom-color:var(--tx-3);color:var(--tx)}
.postrow dd{margin:0;font-size:var(--fs-name);font-variant-numeric:tabular-nums}

/* ── 카드 전체를 누르기 ──────────────────────────────────────
   ⚠**링크를 하나 더 겹치지 않는다.** 이미 있는 「この試合の詳細」의 클릭 영역을
   카드 전체로 넓힌다. 겹쳐 두면 같은 목적지가 링크 목록에 두 번 나오고 탭도 두 번 걸린다.
   ⚠**안쪽 링크를 위로 올려야 한다.** 안 올리면 선수 이름을 눌러도 경기 상세로 간다 —
   눌린 것과 다른 곳으로 가는 것은 조용한 오작동이다. */
.tapcard{position:relative;transition:border-color var(--t1) var(--e-out)}
.cardlink::after{content:"";position:absolute;inset:0;z-index:0}
.tapcard a:not(.cardlink){position:relative;z-index:1}
/* 마우스가 있는 환경에서만 hover를 준다 — 터치에서는 hover가 눌린 뒤에도 남아 있다 */
@media (hover:hover){
  .tapcard:hover{border-color:var(--tx-3)}
  .tapcard:hover .gmore a{border-bottom-color:var(--tx-3)}
}
/* ⚠**터치의 눌림 표시는 덮개가 낸다.** 링크 글자만 반짝이면 카드를 눌렀다는 느낌이 없고,
   article:active 는 iOS에서 링크가 아닌 요소에 걸리지 않는다 */
.cardlink:active::after{background:var(--tx);opacity:.06}
/* 초점은 **카드 테두리**로 낸다. 덮개에 outline을 걸면 실제로 눌리는 범위와 정확히 일치한다.
   :focus-within 을 쓰면 안쪽 선수 링크에 초점이 갔을 때도 카드가 켜져 어디에 있는지 알 수 없다 */
.cardlink:focus-visible{outline:none}
.cardlink:focus-visible::after{outline:2px solid var(--tx);outline-offset:-1px}
/* ── 날짜 이동 ────────────────────────────────────────────
   ⚠**앞뒤는 달력의 어제·내일이 아니라 「경기가 있었던 날」이다.** 월요일은 대개 경기가 없어서
   달력대로 움직이면 빈 날에 떨어진다. 그래서 날짜를 글자로 함께 낸다 — 어디로 가는지 보인다. */
.daybar{display:flex;align-items:stretch;gap:var(--s4);margin:0 0 var(--s2);padding:var(--s4) var(--pad);
  border-bottom:var(--rw-row) solid var(--hair)}
/* 화살표는 라벨과 **같은 줄**에 있어야 방향을 말한다 — daystep 이 세로 flex라 묶어야 한다 */
.dayrow{display:flex;align-items:baseline;gap:var(--s2);white-space:nowrap}
.daystep i{font-style:normal;color:var(--tx-3)}
.daystep,.daypick{display:flex;flex-direction:column;gap:var(--s1);text-decoration:none;font-size:var(--fs-data);
  padding:var(--s2) var(--s4);border:var(--rw-row) solid var(--hair-2);min-width:0;
  transition:border-color var(--t1) var(--e-out),color var(--t1) var(--e-out)}
.daystep s,.daypick s{text-decoration:none;font-size:var(--fs-col);color:var(--tx-3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.daystep:hover,.daypick:hover{border-color:var(--tx-3);color:var(--tx)}
.daystep.n{margin-left:auto;text-align:right}
.daypick{margin:0 auto;text-align:center}
/* ⚠**끝에 왔으면 링크가 아니다.** href 없는 a 는 초점도 안 받고 눌러도 아무 일이 없어서,
   「더 있다」고 조용히 거짓말하지 않는다 */
/* ⚠**opacity 로 「없음」을 말하지 않는다**(2026-08-18 감사 P3).
   0.5 를 얹으면 --tx-3 의 대비가 라이트 **1.99:1** · 다크 **2.31:1** 로 떨어진다 —
   4.5:1 의 절반도 안 된다. 이건 span 이라 「비활성 컨트롤」 예외도 못 받는다.
   ⚠**뜻은 색이 아니라 형태로 말한다** — 점선 테두리가 이미 「누를 수 없다」를 말하고 있다.
   실측(opacity 없이): 라이트 4.91:1 · 다크 5.50:1. */
.daystep.off{color:var(--tx-3);border-style:dashed}
.daystep.n.off{margin-left:auto}
@media (max-width:520px){
  .daybar{flex-wrap:wrap}
  .daypick{order:3;width:100%;margin:0}
}
/* 날짜 일람 — 달마다 한 덩어리 */
.daygrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:var(--s2)}
.dayc{display:flex;flex-direction:column;align-items:center;gap:var(--s1);padding:var(--s3) var(--s2);
  text-decoration:none;border:var(--rw-row) solid var(--hair-2);
  transition:border-color var(--t1) var(--e-out),background var(--t1) var(--e-out)}
.dayc b{font-size:var(--fs-name);font-variant-numeric:tabular-nums;color:var(--tx)}
.dayc s{text-decoration:none;font-size:var(--fs-min);color:var(--tx-3);display:flex;gap:var(--s2);align-items:baseline}
.dayc em{font-style:normal;color:var(--tx-2);border:var(--rw-row) solid var(--hair-2);padding:0 var(--s1)}
.dayc:hover{border-color:var(--tx-3);background:var(--panel-2)}
/* 지금 보고 있는 최신 경기일 */
.dayc.now{border-color:var(--tx);background:var(--panel-2)}

/* 予告先発の要約 — 상세는 予告先発 페이지가 낸다 */
.pbcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--s4)}
.pbcard{border:var(--rw-row) solid var(--hair-2);padding:var(--s4) var(--s5)}
.pbside{display:flex;align-items:baseline;gap:var(--s3);padding:var(--s1) 0;min-width:0}
.pbt{display:flex;align-items:center;gap:var(--s3);font-size:var(--fs-sub);color:var(--tx-3);flex:none}
.pbt i{width:8px;height:8px;background:var(--chip,#6b7280);font-style:normal}
.pbn{font-size:var(--fs-lead);text-decoration:none;font-weight:var(--w-bold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbn:hover{text-decoration:underline}
.pbn.empty{font-weight:var(--w-reg);color:var(--tx-3);font-size:var(--fs-sub)}
.pbe{margin-left:auto;font-size:var(--fs-note);color:var(--tx-2);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.pbe s{text-decoration:none;color:var(--tx-3);font-size:var(--fs-min);margin-left:var(--s2)}

/* ── 選手をくらべる ──────────────────────────────────────────
   ⚠**두 열의 폭을 같게 고정한다.** 이름 길이에 따라 열이 움직이면 값이 세로로 안 맞고,
   그러면 비교라는 이 화면의 유일한 목적이 사라진다. */
.cmpwrap{padding:var(--s6) var(--pad);border-bottom:var(--rw-row) solid var(--hair)}
.cmphead{display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);margin-bottom:var(--s2)}
.cmpwho{padding:var(--s4) var(--s5);border:var(--rw-row) solid var(--hair-2);border-top:var(--rw-mast) solid var(--who,#6b7280);min-width:0}
.cmpwho .nm{display:block;font-size:var(--fs-title);font-weight:var(--w-bold);line-height:1.25}
.cmpwho .nm a{text-decoration:none}
.cmpwho .nm a:hover{text-decoration:underline}
.cmpwho .sub{display:block;font-size:var(--fs-note);color:var(--tx-3);margin-top:var(--s1)}
.cmpwho .smp{display:block;font-size:var(--fs-note);color:var(--tx-2);margin-top:var(--s2);font-variant-numeric:tabular-nums}
/* 겹친 紋 — 두 선수를 같은 판에 그린다. 색만으로 구별하지 않고 범례를 붙인다 */
.cmpfig{max-width:300px;margin:var(--s5) auto var(--s2)}
.cmpfig svg{display:block;width:100%;height:auto;overflow:visible}
/* ⚠**여기 선 색은 CSS 가 아니라 클라이언트가 얹고 있었다**(2026-08-21 감사 P2).
   compare 화면은 브라우저가 표를 조립하므로 setAttribute("stroke", 구단색) 으로 칠했고,
   그래서 **CSS 문자열만 훑는 대비 시험이 이 자리를 원리적으로 못 봤다.**
   실측: 라이트·다크 **양쪽 다** A=#1d1f4e / B=#22262b(테마와 무관하게 같은 값) ·
   다크에서 --panel 기준 **1.08 / 1.10** · 두 도형끼리 **1.02**.
   .cf-b 는 fill-opacity 가 0 이라 **점선 하나가 그 선수의 전부**이고, 같은 색이
   범례에도 들어가 solid/dashed 범례 자체가 안 보였다.
   → 선은 토큰으로 고정한다. **누가 누구인지는 solid/dashed 와 이름이 말한다** — 색이 아니다.
   ⚠**살(fill)만 구단 색으로 남는다**(.mf-shape 와 같은 결정). B 는 fill-opacity 가 0 이라
   결과적으로 구단 색이 안 보이는데, 그건 겹친 도형을 읽히게 하려는 원래 설계다. */
.cmpfig .cf-a{fill-opacity:.30;stroke:var(--tx);stroke-width:1.8;stroke-linejoin:round}
.cmpfig .cf-b{fill-opacity:0;stroke:var(--tx-2);stroke-width:1.8;stroke-linejoin:round;stroke-dasharray:4 3}
.cmpkey{display:flex;gap:var(--s5);justify-content:center;font-size:var(--fs-note);color:var(--tx-2);margin:var(--s1) 0 0}
.cmpkey span{display:inline-flex;align-items:center;gap:var(--s2)}
.cmpkey i{width:16px;height:0;border-top-width:var(--rw-sect);font-style:normal}
.cmpkey .ka i{border-top-style:solid;border-top-color:var(--tx)}
.cmpkey .kb i{border-top-style:dashed;border-top-color:var(--tx-2)}
/* 값 표 — 라벨을 가운데 두고 값을 양쪽으로 민다. 어느 쪽 열인지 눈이 헤매지 않는다 */
.cmprow{display:grid;grid-template-columns:1fr 8.5em 1fr;align-items:baseline;gap:0 var(--s4);
  padding:var(--s3) 0;border-bottom:var(--rw-row) solid var(--hair)}
.cmprow .lb{grid-column:2;text-align:center;font-size:var(--fs-note);color:var(--tx-3);letter-spacing:.06em}
.cmprow .va,.cmprow .vb{font-variant-numeric:tabular-nums;font-size:var(--fs-title);line-height:1.15;min-width:0}
.cmprow .va{grid-column:1;text-align:right}
.cmprow .vb{grid-column:3;text-align:left}
.cmprow .den{display:block;font-size:var(--fs-col);color:var(--tx-3);margin-top:var(--s1);font-variant-numeric:tabular-nums}
/* ⚠**이긴 쪽에만 표시를 붙인다.** 양쪽에 붙이면 아무 말도 안 한 것과 같다 */
/* ⚠**~~"◂"/"▸"~~ 는 네 서체 어디에도 없었다** — 사유·실측·대안은 위 .pickfold>summary::after 에 한 벌로 적었다.
   여기도 같은 처방이다: **"◀"(U+25C0) / "▶"(U+25B6)** + **font-size --fs-data(12px) → --fs-min(9.5px)**.
   ⚠이 자리는 값이 **17px** 이라 표식이 값보다 커 보이면 안 된다 — 잉크 8.1~8.9px 로 값의 약 절반이다. */
/* ⚠**「이긴 쪽」이 낭독기에 전혀 안 들렸다**(2026-09-08 1차 검토).
   채널이 **굵기 + 생성 콘텐츠 삼각형** 둘뿐이었고 둘 다 낭독기에는 없는 것과 같다 —
   "aria-label" 도 숨김 글자도 0건이었다. **두 값은 들리는데 어느 쪽이 위인지가 안 들린다.**
   → 처방 둘을 **함께** 쓴다. 하나만 쓰면 더 나빠진다:
     ⑴ 뜻은 **보이지 않는 글자**가 나른다(client 의 cell() 이 ".vh" 를 넣는다 — 선수 이름 + 「が上」).
        ⚠**「こちらが上」로 하지 않는다** — 선형으로 읽히는 흐름에서 「こちら」는 무엇을 가리키는지 없다.
     ⑵ 그러고 나서 **글리프에 빈 대체텍스트**를 붙여 「검은 왼쪽 삼각형」이 덧붙어 읽히지 않게 한다.
        ⚠**대체텍스트만 붙이면 유일한 채널이 사라져 더 나빠진다** — ⑴ 없이 이 줄만 넣지 마라.
   ⚠**선례가 이미 있다**: 달력의 승패 표식(calendar.ts)이 aria-hidden 인 글자 + .vh 로 같은 짝을 쓴다.
   여기는 표식이 **생성 콘텐츠**라 aria-hidden 을 걸 자리가 없어서 대체텍스트로 같은 일을 한다.
   ⚠**같은 선언을 두 번 쓰는 것은 실수가 아니다.** content: "x" / "alt" 문법을 모르는 브라우저는
   **선언 전체를 무효로 버리므로** 표식이 통째로 사라진다 — 이 자리에서는 그게 정보 손실이다.
   앞줄이 보이는 표식을 보장하고, 뒷줄은 아는 브라우저에서만 덮는다. */
.cmprow .win{font-weight:var(--w-bold)}
.cmprow .win::after{content:"◀";margin-left:var(--s2);color:var(--g-vgood);font-size:var(--fs-min)}
.cmprow .win::after{content:"◀" / ""}
.cmprow .vb.win::after{content:none}
.cmprow .vb.win::before{content:"▶";margin-right:var(--s2);color:var(--g-vgood);font-size:var(--fs-min)}
.cmprow .vb.win::before{content:"▶" / ""}
.cmprow .g{display:inline-block;width:14px;height:3px;vertical-align:2px;margin-left:var(--s2);background:var(--g-avg)}
.cmprow .g.g-veryGood{background:var(--g-vgood)}
.cmprow .g.g-good{background:var(--g-good)}
.cmprow .g.g-bad{background:var(--g-bad)}
.cmprow .g.g-veryBad{background:var(--g-vbad)}
.cmprow .vb .g{margin-left:0;margin-right:var(--s2)}
.cmpwarn{margin:0 0 var(--s5);padding:var(--s4) var(--s5);font-size:var(--fs-data);line-height:1.6;color:var(--tx-2);
  border-left:var(--rw-mast) solid var(--g-bad);background:var(--panel-2);max-width:64ch}
/* 「나란히 못 놓는다」로 끝내지 않고 갈 곳을 준다 */
.cmpgo{display:inline-block;margin-top:var(--s4);font-size:var(--fs-lead);padding:var(--s3) var(--s5);
  border:var(--rw-row) solid var(--hair-2);text-decoration:none}
.cmpgo:hover{border-color:var(--tx-2);background:var(--panel-2)}
@media (max-width:560px){
  .cmprow{grid-template-columns:1fr 6.4em 1fr}
  .cmprow .va,.cmprow .vb{font-size:var(--fs-name)}
  .cmpwho .nm{font-size:var(--fs-name)}
}

/* ── 색인 ────────────────────────────────────────────────── */
.find{padding:var(--s5) var(--pad);border-bottom:var(--rw-row) solid var(--hair)}
.find label{display:block;font-size:var(--fs-label);letter-spacing:.16em;color:var(--tx-3);margin-bottom:var(--s3)}
/* ⚠**검색칸(.qbox input)과 같은 결함**(2026-09-08 · design-auditor · WCAG 2.2 SC 1.4.11).
   .find 는 배경을 안 깔아 바깥면이 --page 이고 칸의 채움은 --panel 이라 **채움 대 바깥면 1.044 / 1.084** —
   면으로는 경계가 없고, 그 하나뿐인 테두리가 --hair-2 로 **1.580 / 1.557**(채움 기준) ·
   **1.514 / 1.688**(바깥면 기준) 이었다. 셋 다 3:1 미만이다.
   → **--tx-3**: 채움 기준 **5.125 / 5.072** · 바깥면 기준 **4.910 / 5.499** 로 판정 기준 1 을 두 테마에서 만족한다.
   ⚠**hover 를 더하지 않는다** — 이 칸에는 원래 hover 규칙이 없었고, 없는 것이 결함은 아니다. */
.find input{font:inherit;font-size:var(--fs-name);padding:var(--s4) var(--s4);width:100%;max-width:420px;background:var(--panel);
  color:var(--tx);border:var(--rw-row) solid var(--tx-3)}
.chips{display:flex;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s5)}
/* ⚠**~~transition:all~~ 이었다**(2026-08-25 · 감사 P3 #36). 둘이 나빴다:
   ⑴ **지금 바꾸는 것 넷 중 font-weight 까지 애니메이트했다** — 눌림에서 글자 굵기가
      보간되면 그 칩의 폭이 프레임마다 달라지고, 칩줄 전체가 흔들린다(리플로).
   ⑵ **앞으로 더할 속성까지 조용히 따라간다** — padding 하나만 얹어도 그날부터 애니메이트된다.
   → **바꾸는 것을 이름으로 적는다.** font-weight 는 일부러 뺐다(즉시 바뀌는 편이 낫다). */
.chip{font:inherit;font-size:var(--fs-sub);padding:var(--s2) var(--s4);cursor:pointer;background:transparent;color:var(--tx-2);
  border:var(--rw-row) solid var(--hair-2);white-space:nowrap;
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out),background var(--t1) var(--e-out)}
.chip:hover{color:var(--tx);border-color:var(--tx-3)}
.chip[aria-pressed="true"]{background:var(--chip,#6b7280);color:var(--chip-ink,#fff);border-color:var(--chip,#6b7280);font-weight:var(--w-bold)}
.count{font-size:var(--fs-note);color:var(--tx-3);margin-top:var(--s4)}
.teamgroup{padding:var(--s5) var(--pad);border-bottom:var(--rw-row) solid var(--hair)}
.teamgroup[hidden]{display:none}
.teamgroup h2{margin:0 0 var(--s4);font-size:var(--fs-note);letter-spacing:.14em;font-weight:var(--w-bold);
  display:flex;align-items:center;gap:var(--s4)}
.teamgroup h2 i{width:11px;height:11px;background:var(--chip,#6b7280);font-style:normal;box-shadow:inset 0 0 0 1px var(--tx-2)}
/* ⚠**화면 밖의 구단 묶음은 그리지 않는다.**
   일람은 구단 12묶음에 선수 698명이고, 선수마다 인라인 SVG가 하나씩 붙는다
   (실측: SVG 698개 · polygon 1,390개 · DOM 요소 7,326개).
   전송량은 문제가 아니다 — 528KB가 brotli로 32KB가 된다. **문제는 첫 페인트의 레이아웃 비용**이다.
   ⚠contain-intrinsic-size 에 auto 를 붙인다. 고정값을 주면 실제 높이와 어긋나 스크롤바가 튀는데,
   auto 는 **한 번 그린 크기를 기억**한다.
   ⚠**단 그 기억은 이 문서가 살아 있는 동안만이다** — 뒤로가기로 다시 읽히면 12묶음이
   전부 900px 추정에서 시작한다. 스크롤 복원이 어긋나는지는 **실기 확인 전에는 모른다**(미검증).
   ⚠검색·구단 좁히기는 그대로 동작한다 — 이것은 렌더 생략이지 display:none 이 아니다. */
.teamgroup{content-visibility:auto;contain-intrinsic-size:auto 900px}
/* ⚠**168px 이었다**(2026-08-31). 그 안에 아이콘 18 + 성적 약 95 + 포지션 12 + 틈 24 가 들어가
   **이름 몫이 20px 도 안 남았다** — 그래서 「ウィットリー」가 ウ/ィ/ッ/ト/リ/ー 로 세로로 쪼개졌다.
   ⚠**값의 근거**: 이름은 카나 6글자가 흔하고 13px 이면 약 78px 이다.
   18+8+78+8+12+8+95 = **227px** — 여유를 두어 232px 로 잡는다. */
.roster{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:0 var(--s6)}
.roster li[hidden]{display:none}
/* ⚠**이 저장소에서 유일하게 레이아웃 속성을 애니메이트하는 자리다**(2026-08-25 · 감사 P3 #37 ·
   실측: 전환 규칙 31개 중 레이아웃 속성은 이것 하나).
   ⚠**transform:translateX 로 바꾸지 않는다** — 그러면 아래 경계선까지 같이 밀려
   줄 밑줄의 왼쪽이 4px 비고, 명부처럼 줄이 이어지는 화면에서 그게 눈에 띈다.
   padding-left 는 경계선을 제자리에 두고 내용만 민다 — **모양이 맞는 쪽이 이것**이다.
   비용은 그 한 줄의 레이아웃이고, 그 대가를 알고 고른다. */
.roster a{display:flex;gap:var(--s4);align-items:baseline;padding:var(--s2) 0;text-decoration:none;border-bottom:var(--rw-row) solid var(--hair);
  transition:padding-left var(--t1) var(--e-out)}
/* ⚠**명부의 성적 줄.** 규칙이 없으면 body 기본 16px·--tx 로 그려져 **선수 이름(13px)보다
   크고 진해진다** — 실측 1,397칸. 검색 드롭다운의 .qhits .hs 는 그쪽 전용이라 여기 안 걸린다 */
.roster .hs{flex:0 0 auto;margin-left:var(--s4);font-size:var(--fs-label);color:var(--tx-3);
  font-variant-numeric:tabular-nums;white-space:nowrap}
/* ⚠**여기서 칸 폭을 다시 정하지 마라**(2026-08-31). 위에서 232px 로 넓힌 것이 모바일을
   1열로 만든 줄 알고 여기에 160px 을 넣었는데, **아무 일도 안 하는 죽은 규칙이었다** —
   아래 max-width:680px 블록의 .roster{grid-template-columns:1fr} 이 **더 뒤에 있어 이긴다.**
   ⚠**즉 모바일 명부는 처음부터 1열이고, 그건 의도된 결정이다**(680px 블록). */
@media (max-width:520px){.roster .hs{display:none}}
.roster a:hover{padding-left:var(--s2)}
/* ⚠**이름이 성적에 밀려 한 글자 폭까지 찌그러졌다**(2026-08-31 · 사용자 지적).
   성적(.hs)은 flex:0 0 auto 라 **안 양보하는데** 이름에는 아무 제약이 없었고,
   **일본어는 글자 사이가 기본 줄바꿈 자리**라 세로로 쪼개졌다.
   → ⑴ nowrap 으로 **쪼개기 자체를 금지**하고 ⑵ 모자라면 말줄임으로 끝내고
     ⑶ 칸을 넓혀(위) 말줄임이 거의 안 일어나게 한다.
   ⚠**min-width:0 이 있어야 말줄임이 듣는다** — flex 항목의 기본 최소 폭은 내용 폭이라
   그것 없이는 overflow 가 아예 안 일어난다. */
.roster .hn{font-size:var(--fs-lead);flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.roster .hp{flex:0 0 auto;font-size:var(--fs-col);color:var(--tx-3)}
/* 즐겨찾기 표식 — 순서를 바꾸지 않고 **표시만** 얹는다.
   순서를 바꾸면 「내 선수가 어디 갔지」가 되고, 명감의 배열이 무너진다 */
.roster li[data-favon="true"] .hn::before{content:"★";color:var(--team,#6b7280);margin-right:var(--s2);font-size:var(--fs-col)}
.chip.fav i{font-style:normal;margin-right:var(--s2)}
/* ⚠**여기 적혀 있던 「9.55 / 9.14」도 같은 방식으로 틀렸다**(2026-09-08 · ⑵ 를 계산으로 바꾸면서 드러남).
   그 수는 --tx 를 --panel 위에 .8 로 합성한 값인데, **실제 잉크는 .chip 이 물려주는 --tx-2,
   바탕은 .find 가 배경을 안 깔아 --page** 다 — 다시 재면 **라이트 3.999(미달) · 다크 5.076**.
   즐겨찾기 개수는 글자이고 정보다. → .sortable i 와 같은 처방: **opacity 를 색으로 바꾼다**
   (--tx-3 = --page 대비 **4.910 / 5.499**). 값(--tx-2)보다 옅다는 위계는 그대로다. */
.chip.fav s{text-decoration:none;margin-left:var(--s2);font-size:var(--fs-col);color:var(--tx-3)}
/* ⚠⚠**바로 위 수정이 새 결함을 만들 뻔했다**(자기 수정 재확인에서 잡음 · 2026-09-08).
   이 칩은 눌리면 **면이 구단 색으로 바뀐다**(.chip[aria-pressed="true"] · 여기서는 --chip 이
   안 깔려 있어 중립색 #6b7280 / #fff 로 떨어진다). 그 위에서 --tx-3 는 **1.060 / 1.470** 이다 —
   tr.me td .den 과 **똑같은 결함**을 옆자리에 만드는 것이었다.
   → .pk 가 이미 쓰는 처방을 그대로 쓴다(.pk[aria-pressed="true"] s{color:inherit}).
   ⚠**옛 상태도 미달이었다**: inherit 를 .8 로 흐렸을 때 **3.760**. 흐림을 빼서 **4.834** 가 된다. */
.chip.fav[aria-pressed="true"] s{color:inherit}
.chip.fav[hidden]{display:none}
.favbtn{font:inherit;font-size:var(--fs-lead);line-height:1;margin-left:var(--s4);padding:var(--s1) var(--s3);cursor:pointer;
  background:transparent;border:var(--rw-row) solid var(--hair-2);color:var(--tx-3);vertical-align:middle;
  transition:color var(--t1) var(--e-out),border-color var(--t1) var(--e-out)}
.favbtn:hover{color:var(--tx-2);border-color:var(--tx-3)}
.favbtn[aria-pressed="true"]{color:var(--team,#6b7280);border-color:var(--team,#6b7280)}
.favbtn[hidden]{display:none}

.foot{padding:var(--s6) var(--pad);color:var(--tx-3);font-size:var(--fs-sub)}
.foot a{text-decoration:underline}

@keyframes rise{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes drop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* 탭 전환에 **방향**을 준다 — fade만 두면 「어디서 어디로 갔는지」가 남지 않는다.
   8px은 눈이 방향만 읽고 위치는 안 읽는 거리다. 크게 하면 인쇄물의 질감이 깨진다 */
@keyframes slideNext{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
@keyframes slidePrev{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
/* 큰 紋을 한 번 그린다. 둘레는 pathLength 로 100에 고정돼 있다 */
@keyframes draw{from{stroke-dasharray:0 100}to{stroke-dasharray:100 0}}

/* ── ドラフト会議 ──
   ⚠**원본의 격자를 재현하지 않는다**(L2). wikipedia 는 행=회차 × 열=12구단으로 짜는데
   그건 편집물의 구성이고, 옮기면 §2-5 2층에 닿는다. 우리 단위는 **경합 그룹**이다.
   ⚠**모서리와 그림자를 새로 만들지 않는다** — 이 화면도 사이트와 같이 각지고, 층이 없으므로
   깊이도 없다.
   ⚠**「구분은 선과 여백이 한다」고 적혀 있었는데 선은 그 일을 못 한다**(2026-09-05 감사 P3 정정).
   --hair-2 대 바탕이 **라이트 1.58:1 · 다크 1.34:1** 이라 비텍스트 3:1 에 한참 못 미친다 —
   눈에 보이는 날도 있고 안 보이는 날도 있는 선이다. 실제로 구분을 지고 있는 것은
   **글자 자체**다: 경합 그룹은 16px 굵은 선수명과 12px 간격이, 회차는 13px 굵은 머리가
   **중복으로** 말한다. 선은 그 위에 얹힌 거들기이지 근거가 아니다.
   ⚠**그러니 선만 남기고 글자 위계를 지우지 마라** — 그날 이 화면의 구분이 통째로 사라진다.
   ⚠**当選/落選을 색만으로 말하지 않는다** — 글자가 정보이고, 테두리와 굵기는 거들 뿐이다.
   ⚠**칩은 홈·순위표와 같은 .hteam 한 벌**이고(M1) 표 안에서는 .tm 이다 — 새 스와치를 만들지 않는다. */
.drnds{display:flex;flex-direction:column}
.drnd+.drnd{margin-top:var(--s6);padding-top:var(--s6);border-top:var(--rw-row) solid var(--hair)}
.drh{margin:0 0 var(--s4);font-size:var(--fs-lead);font-weight:var(--w-bold);letter-spacing:.1em;
  display:flex;align-items:baseline;gap:var(--s4);flex-wrap:wrap}
.drh .qt,.dgn .qt,.dsolo>summary .qt,.drgh .qt{letter-spacing:0;font-weight:var(--w-reg);
  color:var(--tx-3);font-size:var(--fs-label)}
/* 경합 하나가 한 덩어리다 — **왼쪽 선이 그 경계**(용어집 .gl 과 같은 어법) */
.dgrps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s5)}
.dgrp{padding-left:var(--s5);box-shadow:inset 2px 0 0 var(--hair-2)}
/* ⚠**주역은 선수 이름이다** — 이 제품은 이름과 수가 곧 내용이라 라벨을 값보다 키우지 않는다.
   대신 **분모(N球団競合)를 값에 붙여** 둔다(M2 · 루트 §7의 도메인 예외). */
.dgn{margin:0 0 var(--s2);display:flex;align-items:baseline;gap:var(--s4);flex-wrap:wrap}
.dgn b{font-size:var(--fs-title);font-weight:var(--w-bold);letter-spacing:.04em}
.dbids{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--s1) var(--s6)}
.dbid{display:inline-flex;align-items:baseline;gap:var(--s3);font-size:var(--fs-data)}
/* ⚠**라벨 줄이 단어 안에서 끊겼다**(390px 실측 2026-09-05) — .picklab 은 줄바꿈을 안 한다.
   남의 화면이 쓰는 규칙을 건드리지 않고 **이 화면 몫만** 접는다. */
.picklab.dlab{flex-wrap:wrap;gap:var(--s1) var(--s4)}
/* 회차들과 그 각주 사이 — 각주는 **마지막 회차가 아니라 블록 전체**에 붙는 말이다 */
.drnds+.note{margin-top:var(--s6)}
.dres{font-size:var(--fs-label);letter-spacing:.12em;font-weight:var(--w-bold);padding:var(--s1) var(--s2);flex:none}
.dbid.won{font-weight:var(--w-bold)}
.dbid.won .dres{color:var(--tx);box-shadow:inset 0 0 0 1px var(--tx-2)}
.dbid.lost .dres{color:var(--tx-3);font-weight:var(--w-reg);padding-left:0;padding-right:0}
.dbid.lost .hteam{color:var(--tx-2)}
.dbid.none .dres{color:var(--warn);box-shadow:inset 0 0 0 1px var(--warn)}
.dwarn{font-size:var(--fs-note);color:var(--warn)}
/* 구단마다 표기가 달랐을 때만 나온다 — **접지 않고 함께** 낸다 */
.dalt{font-style:normal;font-size:var(--fs-label);color:var(--tx-3)}
/* 단독지명은 **접어 둔다** — 펼쳐 두면 경합의 서사가 그 목록에 묻힌다 */
.dsolo{margin-top:var(--s5)}
/* ⚠**손잡이가 손잡이로 안 보였다**(2026-09-05 감사 P1). 셋이 겹쳤고 **셋을 다 고쳐야 한다** —
   하나만 고치면 나머지 둘이 그대로 「여기 접힌 것이 있다」를 감춘다:
     ⑴ font-size 선언이 없어 body 기본 **16px** 를 받았다. 회차 머리 .drh(13px)·구획 제목
        .block>h2(12.5px)보다 커서 **문서 위계가 시각적으로 뒤집혀 있었다.**
     ⑵ 마커가 .pickfold>summary::after{margin-left:auto} 로 상자 오른쪽 끝에 붙어
        라벨과 **1440px 에서 884px**(1024:684 · 768:436 · 390:101) 떨어졌다 — 그 거리면
        같은 줄의 것으로 안 읽힌다.
     ⑶ .pickfold>summary:hover{color:var(--tx)} 가 **이미 --tx 인 글자를 --tx 로** 바꿔
        아무것도 안 변했다. 対戦 화면에서만 살아 있었던 것은 거기 summary 에 .picklab 이
        붙어 --tx-3 에서 시작하기 때문이다 — **같은 규칙이 한쪽에서만 도는 것을
        「있으니 된다」로 읽지 마라.**
   ⚠**대가는 2019 서사의 결말이었다** — 巨人이 奥川·宮川 을 놓치고 外れ外れ1位에서 뽑은
   堀田賢慎이 이 안에만 있어서, 그 회차가 「この回の競合はありません。」만 남아
   **「3회차엔 아무 일도 없었다」로 읽혔다.**
   ⚠**마커를 라벨 앞으로 옮긴다**(order:-1). details 의 관용이 그 자리이고, 「접혀 있다」를
   이름보다 먼저 읽게 한다. **글리프와 회전은 한 벌 그대로**라 어휘가 갈리는 것이 아니라 자리만 다르다.
   ⚠**対戦 화면은 안 옮겼다. 「거기는 괜찮아서」가 아니다** — 실측하니 거기도 1200px 에서
   마커가 라벨에서 **약 480px** 떨어져 있다(summary 548px · margin-left:auto). 즉 같은 모양이
   그 화면에도 있다. 안 옮긴 이유는 하나다: **그 화면은 이번 감사 대상이 아니었고**,
   거기 두 접힘(投手/打者)은 마커가 오른쪽에서 세로 열을 이루는 배치라 **다르게 판단될 수 있다.**
   감사받지 않은 화면을 구현자 판단으로 바꾸지 않는다(감사↔구현 분리) — **다음 감사에 올린다.**
   ⚠**새 색·새 토큰을 만들지 않았다** — --tx-2 는 이 파일이 이미 12px 본문에 쓰는 값이다
   (라이트 6.61:1 · 다크 6.67:1 · .dnolot 과 같다). */
.dsolo>summary{font-size:var(--fs-data);color:var(--tx-2)}
.dsolo>summary::after{order:-1;margin-left:0}
.dsolos{list-style:none;margin:var(--s3) 0 0;padding:0;display:flex;flex-wrap:wrap;gap:var(--s1) var(--s6);font-size:var(--fs-data)}
.dsolos li{display:inline-flex;align-items:baseline;gap:var(--s3)}
.dsolos b{font-weight:var(--w-reg)}
/* 「제도상 추첨이 없다」 — 빈 상태(.empty)와 **다른 사실**이라 다른 모양으로 말한다 */
.dnolot{margin:0 0 var(--s5);font-size:var(--fs-data);color:var(--tx-2);padding-left:var(--s4);
  box-shadow:inset 2px 0 0 var(--hair-2)}
/* 지명의 전 기록 — 회차가 **행 묶음의 머리**다(열이 12개인 격자가 아니다) */
.dpick{margin-top:var(--s2)}
.dpick .drgh th{background:var(--panel-2);color:var(--tx);font-size:var(--fs-label);letter-spacing:.12em;
  font-weight:var(--w-bold);padding-top:var(--s4);border-bottom:var(--rw-row) solid var(--hair-2)}
/* 회차 묶음 사이에 숨 쉴 자리 — **첫 묶음은 붙이고 다음부터** 띄운다 */
.dpick .drg+.drg .drgh th{padding-top:var(--s6)}
.dpick .dnm{font-size:var(--fs-lead)}
.dpick .dorg{color:var(--tx-2)}
/* 우리 어휘에 없는 구단 코드 — **모른다는 것이 보이게** 한다(지금 이름으로 접지 않는다) */
.dunk{text-decoration:none;border-bottom:var(--rw-row) dotted var(--tx-3);font-family:var(--f-num);
  font-size:var(--fs-sub);cursor:help}
/* 출처(L3) · 불변식 위반 · 후일담 */
.dsrc{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s4);font-size:var(--fs-data)}
.dsrc li{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s1) var(--s4)}
.dsrc b{font-size:var(--fs-col);letter-spacing:.14em;color:var(--tx-2);font-weight:var(--w-semi)}
.dsrc a{word-break:break-all}
.dsrc s{text-decoration:none;font-family:var(--f-num);font-size:var(--fs-label);color:var(--tx-3)}
.ddef{list-style:none;margin:var(--s4) 0 0;padding:0;display:flex;flex-direction:column;gap:var(--s2);font-size:var(--fs-data)}
.ddef b{font-size:var(--fs-min);letter-spacing:.14em;color:var(--warn);margin-right:var(--s4)}
.dnotes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s3);font-size:var(--fs-data)}
.dnotes li{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s4)}
.dnotes s{text-decoration:none;color:var(--tx-2);font-size:var(--fs-sub)}

/* ── 반응형 ──────────────────────────────────────────────── */
@media (max-width:900px){
  :root{--pad:var(--s6)}
  .bar{grid-template-columns:76px 1fr 118px;gap:var(--s4)}
}
@media (max-width:680px){
  /* ⚠**여기서 헤더가 2행이 된다** — 브랜드·탭줄·테마가 윗줄, 검색칸이 아랫줄.
     그래서 --topbar 도 **2행의 실제 높이**로 바꾼다. 이 한 줄이 .rail·.hjump·.pickbar·
     scroll-padding-top·.shell 을 **전부 한꺼번에** 맞춘다 — 예전에는 여기가 44px 인 채
     scroll-padding-top:86px 를 ≤480 에 따로 박아 뒀고, 그 86 조차 실측 **113~115px** 에
     28px 모자랐다(2026-08-20 계측).
     ⚠**실측값이다**(step 4 · 400~680px · 마우스): 내용 높이가 **86.2px**(≤420px · 탭 글자 11px)와
     **87.7px**(421~680px · 12px) 둘뿐이라, 큰 쪽을 덮는 **88px** 로 잡는다.
     min-height 라서 작은 쪽도 88px 로 채워진다 — 즉 ≤680px 전 구간에서 바가 정확히 88px 이다.
     ⚠**작게 잡으면 안 된다**: 86px 로 뒀더니 421~680px 에서 바가 87.7px 로 자라 토큰이 다시 거짓이 됐다. */
  :root{--pad:var(--s5);--topbar:88px}
  /* ⚠**검색칸을 아랫줄로 내린다.** 브랜드·탭 8개·테마가 이미 윗줄을 다 쓴다 —
     한 줄에 넣으면 검색칸이 100px 아래로 찌부러져 무엇을 치는지 안 보인다.
     ⚠**탭줄은 여기서 줄어드는 쪽이 된다**(기본값 flex:0 0 auto 를 되돌린다). 아랫줄이 없어졌으니
     모자라면 옆으로 굴린다.
     ⚠**여기에 탭 개수와 임계 폭을 적지 않는다**(2026-09-05 정정). 「680px 은 8개가 다 보이고
     굴림이 필요한 것은 약 560px 아래」라고 박혀 있었는데, **탭이 10개가 되면서 그날 거짓이 됐다** —
     항목이 하나 늘 때마다 다시 거짓이 되는 수다(같은 자리에서 layout.ts 가 이미 한 번 겪었다).
     남길 사실은 **「모자라면 굴린다」**이고 그건 안 자란다.
     ⚠**굴리는 상자에는 첫 위치가 있다** — 왼쪽 끝이라 뒤쪽 항목에 서 있으면 현재 탭이
     화면 밖에서 시작한다. 그것은 CSS 로 못 고치므로 **스크립트가 상자 안으로 들여놓는다**
     (showCurrentTab). 스크립트가 죽으면 손으로 굴리는 상자로 남는다. */
  .topbar{flex-wrap:wrap;padding:var(--s3) var(--s4) var(--s4);gap:var(--s3)}
  .qbox{order:3;flex-basis:100%;max-width:none}
  /* ⚠**flex-basis 를 0 으로 만드는 것이 핵심이다**(실측으로 배웠다 · 2026-08-20).
     줄바꿈은 **줄이기 전의 크기**로 결정된다 — flex:0 1 auto 로 두면 탭줄의 기준 크기가
     내용 폭(약 330px)이라 400px 화면에서 **탭줄이 제 줄로 밀려나** 헤더가 3행 119.2px 이 됐다.
     기준을 0 으로 두면 줄바꿈을 유발하지 않고, 윗줄의 남는 폭을 받아 그 안에서 굴린다.
     ⚠**넘칠 때는 왼쪽 정렬이어야 한다.** justify-content:flex-end 로 넘치면 앞쪽 탭이
     스크롤로 닿지 않는 자리(시작 방향)로 밀려난다. 그래서 기본을 flex-start 로 두고,
     아는 브라우저에만 safe flex-end 를 준다 — 모르는 브라우저는 앞 줄에 남아 안전한 쪽으로 떨어진다. */
  .tnav{flex:1 1 0;margin:0;justify-content:flex-start;justify-content:safe flex-end}
  .shell{grid-template-columns:7px 1fr}
  .spine{padding:0}
  .spine .vt{display:none}
  /* 화면이 좁으면 레일까지 고정하면 본문이 사라진다 — 헤더만 남긴다 */
  .rail{position:static}
  .tnav a{padding:var(--s2) var(--s3)}
  .idline{gap:var(--s5);padding-top:var(--s5)}
  .mark .mk{width:42px;height:42px}
  .spark{width:100%;margin-left:0;align-items:flex-start}
  .cols{grid-template-columns:1fr;gap:0}
  .bars{max-width:none}
  .bar{grid-template-columns:1fr;gap:var(--s1)}
  .bar em{text-align:left}
  .roster{grid-template-columns:1fr}
  th,td{padding:var(--s3) var(--s3)}
}
/* ⚠**가장 작은 흔한 폰에서 첫 화면에 수치가 0개였다**(2026-08-20 감사 ⑥).
   이 제품의 가치 명제가 밀도인데 320×568 에서 그렇다는 것은 명제가 화면에서 무너진 것이다.
   실측(320×568 · 손가락): 고정 머리가 **topbar 96 + 시즌 띠 37.6 + 상태 띠 52.2 = 185.8px = 화면의 33%**
   이고, 그 아래에 화면마다 표제(index 91 · 선수 228.6)가 더 얹혀
   첫 수치가 index 368.9px(65%) · 順位 410.5(72%) · 予告先発 534.3(94%) · 選手 556.3(98%) ·
   試合 600.6(106% — 접힘선 아래)에 있었다.
   ⚠**여기서 줄이는 것은 「머리의 군살」뿐이다.** 검색칸을 접거나 시즌 띠를 아래로 옮기는 것은
   조작 설계를 바꾸는 결정이라 이 라운드에서 하지 않았다 — 남은 거리는 보고서에 수치로 남긴다.
   ⚠**--topbar 는 건드리지 않는다.** 그 토큰은 다섯 곳이 읽고, 폭 구간마다 실측으로 정해져 있다
   (topbar-geometry.test.ts). 여기서 바꾸면 그 계약을 다시 재야 한다. */
@media (max-width:480px){
  /* 표제 — 이 화면에서 읽을 것은 이름이지 여백이 아니다 */
  .idline{padding:var(--s4) var(--pad) var(--s4);gap:var(--s4)}
  .idline .nm{font-size:clamp(var(--fs-title),5.5vw,var(--fs-score))}
  /* 상태 띠는 **줄이되 지우지 않는다** — 여기 뜨는 것은 「수집이 멈췄다」는 경고다(M12) */
  .state{padding:var(--s2) var(--pad);line-height:1.4}
  /* 시즌 띠 — 9시즌이 늘 넘치므로 칩만 얇게 한다. 스크롤바는 남긴다(더 있다는 유일한 신호다) */
  .seasons{padding:var(--s1) var(--pad)}
  .seasons a{font-size:var(--fs-sub);padding:var(--s1) var(--s4)}
  /* 화면 안 이동 줄 — 칩 높이는 손가락 규칙이 정하므로 상자 여백만 줄인다 */
  .hjump{padding:var(--s2) var(--pad);margin-bottom:var(--s4)}
}
/* ⚠**≤480 에 있던 헤더 접기를 ≤680 으로 올렸다**(2026-08-20).
   접는 이유(「한 줄에 브랜드·검색·내비·테마가 다 안 들어간다」)는 480 이 아니라 **680 부터** 참이었다 —
   481~680 에서는 접지 않은 채 탭줄만 2행이 되어 바 밖으로 샜다. 규칙을 옮겼을 뿐 뜻은 그대로다. */
@media (max-width:420px){
  .brand{font-size:var(--fs-data);letter-spacing:.08em}
  .tnav a{font-size:var(--fs-note);padding:var(--s2) var(--s3)}
}
/* 손가락은 마우스보다 크다 */
@media (pointer:coarse){
  .tab,.chip{padding:var(--s3) var(--s5)}
  .mv{padding:var(--s3) var(--s5)}
  .tnav a{padding:var(--s4) var(--s4)}
  .roster a,.qhits li a{padding-top:var(--s4);padding-bottom:var(--s4)}
  /* ⚠**접힘 손잡이도 여기 든다.** 글자가 10px이라 손가락으로는 높이 16px 남짓인데,
     이게 목록을 여는 유일한 자리다 — 빠뜨리면 그 화면이 휴대폰에서 안 열린다 */
  .pickfold>summary{padding:var(--s3) 0}
}
/* ⚠**손가락에서는 헤더가 더 두껍다 — --topbar 도 따라가야 한다.**
   바로 위 .tnav a{padding:9px 10px} 이 탭 높이를 27.0 → 36.6px 으로 올린다.
   접힌 헤더(≤680px)에서는 그게 그대로 바 높이가 되므로, 86px 로 두면 바가 **94.6px** 로 자라고
   --topbar 가 다시 거짓이 된다 — 즉 이 결함의 재발이다.
   ⚠**폭 조건을 반드시 붙인다.** pointer:coarse 만으로 걸면 터치 노트북의 1200px 화면에서도
   96px 이 되는데 거기 바는 46px 이다(반대 방향으로 어긋난다).
   실측(step 4 · 400~680px · 손가락): 내용 높이 **95.0px**(≤420px)와 **95.7px**(421~680px) →
   큰 쪽을 덮는 96px. ≥684px 은 손가락에서도 42.6px 이라 46px 안에 들어간다(실측 바 46.0). */
@media (pointer:coarse) and (max-width:680px){
  :root{--topbar:96px}
}
/* ⚠**모션 감소의 분기가 이제 토큰에서 나온다**(1단계 · 2026-09-07). 아래 두 줄은 **같은 일을
   두 겹으로** 한다:
     ⑴ :root 가 시간 토큰을 내린다 → **토큰을 쓰는 모션은 앞으로 자동으로 따라온다**
     ⑵ * 가 !important 로 못을 박는다 → **토큰을 안 거치는 모션까지 막는다**
   ⚠**⑵ 를 지금 빼지 마라.** HIG 와 채택안 C 는 「끄지 말고 페이드로 바꾸라」고 하지만,
   그건 모션을 새로 설계하는 **2단계의 일**이다. 여기서 빼면 오늘 화면의 동작이 바뀐다.
   ⚠**「1ms」를 두 번 적지 않는다** — ⑵ 가 ⑴ 의 토큰을 읽는다. 값은 한 곳에만 있다. */
@media (prefers-reduced-motion:reduce){
  :root{--t1:1ms;--t2:1ms;--t3:1ms;--t-stagger:0ms}
  *,*::before,*::after{animation-duration:var(--t1)!important;animation-delay:var(--t-stagger)!important;transition-duration:var(--t1)!important}
}
/* **강제 색 모드**(Windows 고대비 등). ⚠**대응 규칙이 0개였다**(2026-08-25 · 감사 P3 #34).

   그 모드에서 OS 가 갈아치우는 것: color · background-color · border-color · outline-color.
   ⚠**box-shadow 는 아예 none 이 된다.** 살아남는 것: font-weight · content ·
   border-style · stroke-width · 크기 · 위치. **시스템 색 키워드는 갈아치우지 않는다** —
   그래서 대응은 「색을 지정하지 않는 것」이 아니라 **시스템 색으로 다시 말하는 것**이다.

   ⚠**상태 규칙 대부분은 이미 살아남는다**(실측 · 상태 묶음 47개). 그건 우연이 아니라
   이 저장소가 「색 하나로 말하지 않는다」를 여러 번 고쳐 왔기 때문이다 —
   tr.me 는 font-weight, aria-sort 는 content 로 화살표, tr.thin 은 .qmk 글자 표식,
   .gcard.off 는 border-style:dashed, .dia 는 fill:none(색이 아니라 강제 대상이 아니다)과
   stroke-width, .pk 는 font-weight, .state 는 문장 자체가 다르다.

   ⚠**두 곳이 남았고 둘 다 「지금 어디를 고르고 있는가」다.**
   ⑴ .qhits li.on a — 검색 목록에서 화살표가 고른 자리. background + box-shadow 뿐이라
      **강제 색 모드에서 통째로 사라지고 hover 와도 구별이 안 된다.**
      ⚠**그 box-shadow 는 「배경색 하나로 말하지 않으려고」 더한 것이었다**(2026-08-22 감사 #18) —
      대비를 고치려고 고른 채널이 하필 이 모드에서 죽는 채널이었다.
   ⑵ .card[aria-selected] — 고른 카드. color·border-color·background 뿐이고
      바탕 .card 도 같은 굵기 테두리라 **골랐는지 아닌지가 같은 모양이 된다.**

   ⚠**브라우저로는 확인하지 못했다.** 실제 렌더는 Windows 고대비를 켜야 보이고,
   그건 CI 에 없다(topbar-geometry.test.ts 가 같은 이유로 「구조를 잰다」고 적은 그 자리다).
   여기서 지키는 것은 **「죽는 채널만으로 말하는 상태를 남기지 않는다」**는 구조이고,
   시험이 그것을 붙든다. */
@media (forced-colors:active){
  /* 고른 자리는 시스템 강조색으로 다시 말한다 — 이 키워드는 갈아치우지 않는다 */
  .qhits li.on a{background:Highlight;color:HighlightText}
  /* 카드는 안쪽 글자들이 각자 색을 가지므로 배경 대신 **윤곽**으로 말한다 */
  .card[aria-selected="true"]{outline:2px solid Highlight;outline-offset:-3px}
  /* 지금 페이지 표시가 box-shadow 밑줄 하나였다 — 글자 밑줄로 바꿔 남긴다 */
  .brand[aria-current="page"]{text-decoration:underline;text-underline-offset:3px}
  /* 「이 구획 안에 있다」(page 가 아니라 true). page 는 font-weight 로 살아남지만
     이쪽은 색과 box-shadow 뿐이었다 — **점선 밑줄로 세기를 낮춰** 둘을 갈라 둔다 */
  .tnav a[aria-current="true"]{text-decoration:underline dotted;text-underline-offset:3px}
  /* 즐겨찾기는 눌려도 글자가 ★ 그대로다 — 색이 죽으면 눌렀는지가 안 보인다.
     ⚠낭독기는 aria-pressed 로 알지만, **고대비를 쓰는 눈 뜬 사용자**가 못 본다 */
  .favbtn[aria-pressed="true"]{outline:2px solid Highlight;outline-offset:1px}
}
@media print{
  /* 조작에 쓰는 것은 종이에서 아무 일도 하지 않는다 */
  .topbar,.editor,.skip,.seasons,.daybar,.pickbar,.pickgames{display:none}
  /* ⚠**레일은 지우지 않는다 — 지우면 아래 규칙이 닿기도 전에 이름이 사라진다.**
     여기 있던 .rail 의 display:none 이 그 일을 하고 있었다(2026-08-17 이중 검토).
     바로 밑 주석이 「탭줄은 조작이면서 고른 것의 이름이다」라고 적어 두고,
     .tab:not([aria-selected]) 로 안 고른 것만 지우는데 — 그 규칙이 붙는 대상이
     통째로 없어져 있었다. **적어 둔 의도가 실제로는 한 번도 실행되지 않았다.**
     레일을 쓰는 화면은 順位·選手·ポストシーズン·球団 넷이다(실측).
     ⚠고정·괘선·가로 스크롤은 종이에서 뜻이 없으므로 벗긴다 */
  .rail{position:static;overflow:visible;background:transparent;border:var(--rw-none);padding:var(--s4) 0 0;min-height:0}
  .block[hidden]{display:block}
  /*
     ⚠**닫힌 탭을 펼치지 않는다.** 한때 펼쳤다가 되돌렸다 — 실측으로 순위 화면이
     14행에서 **2,432행**이 됐고(패널 78개), 그 표들에는 **이름이 없었다.**
     탭줄을 조작으로 보고 함께 숨겼기 때문이다. 패널의 유일한 라벨이 그 탭줄이다.
     종이에는 여는 수단이 없지만 **고르는 것은 인쇄 전에 할 수 있다** — 보고 있는 것을 찍는다.
  */
  /* ⚠**탭줄은 조작이면서 「고른 것의 이름」이다.** 통째로 숨기면 표에서 이름이 사라진다 —
     고른 것만 글자로 남기고 버튼 모양은 지운다 */
  .tab{border:var(--rw-none);background:transparent!important;color:inherit!important;padding:0 var(--s4) 0 0;font-weight:var(--w-bold)}
  .tab:not([aria-selected="true"]):not([aria-pressed="true"]){display:none}
  /* ⚠**렌더 생략을 끈다.** content-visibility 는 화면 밖을 그리지 않는데,
     종이에는 「화면 밖」이 없다 — 켜 둔 채 인쇄하면 **빈 페이지가 나온다** */
  .teamgroup{content-visibility:visible!important}
  /* ⚠**좁혀서 인쇄한 종이는 그 사실을 말해야 한다**(작업규칙 7의 종이판).
     좁히기 조작은 지우되 「몇 명을 보고 있는가」는 남긴다 — 없으면 나중에 그 종이를 보는 사람이
     「이 구단에 3명뿐인가」로 읽는다 */
  .find label,.find input,.find .chips{display:none}
  .find{padding-top:0}
  /* 가로로 넘치는 표는 종이에서 잘린다.
     ⚠**「쪼개진다」고 쓰지 않는다** — 주요 엔진은 표를 가로로 쪼개지 않는다.
     여기서 하는 일은 잘림 위치를 상자 폭에서 종이 폭으로 옮기는 것뿐이고,
     오른쪽 열이 남는지는 **실제로 인쇄해 보기 전에는 모른다**(미검증) */
  .scroller{overflow:visible}
  /* 고정 열은 스크롤이 없는 종이에서 위치만 어긋난다 */
  .scroller th,.scroller td{position:static!important}
  .shell{grid-template-columns:0 1fr}
  /* 링크의 목적지를 남긴다 — 종이에서는 누를 수 없다 */
  .foot a[href^="http"]::after{content:" (" attr(href) ")";font-size:var(--fs-min);color:#555}
  /* ⚠블록에는 break-inside 를 걸지 않는다 — 한 페이지보다 큰 블록에는 엔진이 지킬 수 없어
     무시하거나 앞에 빈 여백을 남긴다. 행 단위만 지킨다 */
  table{break-inside:auto}
  tr{break-inside:avoid}
}
`;

/**
 * 클라이언트 스크립트 — 블록 조립·탭 전환·검색·테마.
 *
 * ⚠**저장에 실패해도 화면은 동작해야 한다.** localStorage가 막힌 환경이 있다.
 * ⚠**서버가 없다.** 정적 파일만으로 도는 것이 이 설계의 전제다.
 * ⚠**선수명은 우리가 만든 문자열이 아니다.** DOM에 넣을 때 `textContent`만 쓴다 — `innerHTML` 금지.
 */
const CLIENT_JS_TEMPLATE = `
(()=>{"use strict";
const doc=document;
const $=(s,r)=>(r||doc).querySelector(s);
const $$=(s,r)=>Array.from((r||doc).querySelectorAll(s));
const BASE=doc.documentElement.dataset.base||"";
// 테스트에서는 location이 없다. 없으면 이동도 질의문자열도 없는 것으로 다룬다
const LOC=typeof location!=="undefined"?location:{search:"",href:""};
const go=(url)=>{LOC.href=url};
const KEY="npb-meikan-layout";
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){return null}};
const save=(s)=>{try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}};
/* ⚠**「until-found 를 아는 브라우저인가」를 기능으로 묻는다.** 사용자 에이전트 문자열로
   가르면 반드시 틀린다. hidden 프로퍼티가 문자열을 받아들이는지로 판정한다. */
const SUPPORTS_UNTIL_FOUND=(()=>{
  try{
    const d=doc.createElement("div");
    d.setAttribute("hidden","until-found");
    return d.getAttribute("hidden")==="until-found"&&"onbeforematch" in d;
  }catch(e){return false}
})();
/* ⚠**window 전역이 아니라 데이터 블록에서 읽는다**(2026-08-18 감사 P2).
   예전에는 서버가 window 전역(__BLOCKS__ · __PRESETS__)을 **인라인 스크립트**로 심었는데, 그 한 줄 때문에
   CSP 의 script-src 를 닫을 수 없었다. 지금은 실행되지 않는 JSON 블록이다.
   ⚠**없어도 돈다** — 선수 페이지 말고는 이 블록이 없다(§0-1). */
const BOOT=(function(){
  try{
    const n=doc.getElementById("bb-boot");
    return n?JSON.parse(n.textContent||"{}"):{};
  }catch(e){return {}}
})();
const BLOCKS=BOOT.blocks||[];
/* 용어집. 서버와 같은 정의 한 벌을 쓴다(M1) */
const GLOSSARY=__GLOSSARY__;
/* 강조 표기(별표 두 개)를 나누는 규칙. ⚠**서버의 src/emphasis.ts 를 그대로 심은 것**이다(M1) —
   여기에 두 번째 벌을 적지 마라. 왜 심는가는 embedEmphasis 의 주석에 있다 */
__EMPHASIS_PARTS__
const PRESETS=BOOT.presets||{};

/* 최애 구단 경로에 허용하는 글자 — 영숫자와 「-」「_」「/」「.」뿐이다.
   ⚠**정규식으로 쓰지 않는다.** 이 파일은 통째로 템플릿 리터럴이라 정규식 이스케이프가
   런타임에 조용히 사라진다 — 글자를 하나씩 본다. */
const FAV_PATH_CHARS="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/.";
/* 저장된 경로가 **이 사이트 안의 상대경로**인가.
   ⚠**막을 것을 세는 대신 허용할 것만 센다**(2026-08-19 검토 ③). 예전 검사는 「:」와 선행 「/」
   둘뿐이었는데, 브라우저 URL 파서는 **역슬래시를 「/」로 정규화**하고 **선행 공백을 버린다** —
   실측으로 역슬래시 두 개로 시작하는 경로와 공백 뒤에 「//」가 오는 경로가 **그대로 href 에
   들어갔다**(BASE 가 빈 문자열인 화면이 dist 에 91장 있다).
   ⚠악용에는 동일 출처 스크립트 실행이 필요해 실질 위험은 낮았다 — 고친 이유는
   **바로 위 주석이 코드보다 강하게 말하고 있었기 때문**이다. */
function favPathOk(p){
  /* 선행 「/」는 사이트 루트다 — 우리가 만드는 경로가 아니다(상대경로만 받는다) */
  if(p.charAt(0)==="/")return false;
  /* 우리가 만드는 경로는 전부 .html 이다(teamPath) */
  if(p.length<6||p.slice(-5)!==".html")return false;
  for(let i=0;i<p.length;i++)if(FAV_PATH_CHARS.indexOf(p.charAt(i))<0)return false;
  return true;
}
/* 저장된 최애 구단 하나를 읽는다.
   ⚠**셋이 다 있어야 최애다**(M11). 코드·약칭·경로 중 하나라도 없으면 「미지정」으로 본다 —
   반쪽짜리를 받으면 내비 라벨이 코드(「T」)로 떨어지거나 링크를 아예 만들 수 없다.
   ⚠**여기서 내는 null 은 「없다」가 아니라 「모른다」다**(M11). 부르는 쪽이 그 둘을 섞으면
   알던 최애가 조용히 지워진다 — 실제로 그랬다(아래 클릭 처리 참조). */
function readFavTeam(v){
  if(!v||typeof v!=="object")return null;
  const code=typeof v.code==="string"?v.code:"";
  const name=typeof v.name==="string"?v.name:"";
  const path=typeof v.path==="string"?v.path:"";
  if(code===""||name===""||path==="")return null;
  if(!favPathOk(path))return null;
  return {code:code,name:name,path:path};
}

const saved=load()||{};
const state={
  order:Array.isArray(saved.order)&&saved.order.length?saved.order:(PRESETS.standard||[]).slice(),
  preset:typeof saved.preset==="string"?saved.preset:"standard",
  density:saved.density==="compact"?"compact":"normal",
  tabs:(saved.tabs&&typeof saved.tabs==="object")?saved.tabs:{},
  /* 표별 정렬·선택. ⚠**여기에 등록하지 않으면 저장이 조용히 안 된다** —
     이 초기화는 저장값을 통째로 받는 것이 아니라 **키를 하나씩 되살린다.**
     예전에 대전 표 전용으로 matchup · matchupTeam 두 자리가 있었고,
     표가 늘면서 자리도 표마다 하나씩 필요해졌다(2026-08-17).
     저장된 열이 지금 표에 없으면 표를 그릴 때 기본으로 되돌린다. */
  sort:(saved.sort&&typeof saved.sort==="object")?saved.sort:{},
  /* 「기준 도달자만 보기」가 켜진 표들 */
  only:(saved.only&&typeof saved.only==="object")?saved.only:{},
  /* 순위표에서 「全員」으로 본 지표들. ⚠**여기 등록하지 않으면 저장이 조용히 안 된다** */
  rankAll:(saved.rankAll&&typeof saved.rankAll==="object")?saved.rankAll:{},
  /* 「全員」일 때의 **최소 표본**(지표별). 0이면 거르지 않는다 = 전원.
     ⚠**분모의 원시 단위로 담는다** — 방어율 계열은 아웃 카운트다(화면 입력은 이닝이고
     환산은 순위표 구역이 한다). 여기 등록하지 않으면 저장이 조용히 안 된다 */
  rankMin:(saved.rankMin&&typeof saved.rankMin==="object")?saved.rankMin:{},
  /* select 로 좁힌 값(구단 등) */
  picked:(saved.picked&&typeof saved.picked==="object")?saved.picked:{},
  /* 즐겨찾기한 선수 ID. **이 브라우저에만 남는다** — 서버로 가지 않는다 */
  favs:Array.isArray(saved.favs)?saved.favs.filter(x=>typeof x==="string"):[],
  /* 최애 구단 **하나**. 선수 즐겨찾기(favs)와는 다른 개념이다 — 아래 「최애 구단」 구역 참조 */
  favTeam:readFavTeam(saved.favTeam),
  grades:saved.grades!==false,
  mark:saved.mark===true,
  theme:saved.theme==="dark"||saved.theme==="light"?saved.theme:"system"
};

function press(sel,attr,val,mark){
  $$(sel).forEach(b=>b.setAttribute(mark||"aria-pressed",String(b.dataset[attr]===val)));
}

/* ── 테마 ── */
function applyTheme(){
  const el=doc.documentElement;
  if(state.theme==="system")el.removeAttribute("data-theme");
  else el.setAttribute("data-theme",state.theme);
  const b=$("#themeBtn");
  if(b){
    const t={system:"自動",light:"明",dark:"暗"}[state.theme];
    b.textContent=t;
    b.setAttribute("aria-label","表示テーマ："+t+"（切り替え）");
  }
}
const tb=$("#themeBtn");
if(tb)tb.addEventListener("click",()=>{
  state.theme=state.theme==="system"?"light":state.theme==="light"?"dark":"system";
  save(state);applyTheme();
});

/* ── 탭 묶음 ──
   tablist: [data-tabgroup="G"] 안의 [data-tab="v"]
   panel  : [data-panelgroup="G"][data-panelkey="v"]
   같은 G를 쓰는 tablist가 여럿이면 함께 움직인다(리그를 바꿔도 지표 선택이 남는다). */
function tabGroups(){
  const groups={};
  $$("[data-tabgroup]").forEach(list=>{
    const g=list.dataset.tabgroup;
    (groups[g]=groups[g]||[]).push(list);
  });
  return groups;
}
const tabHooks=[];
/* ⚠**이번 방문에만 여는 선택.** 깊은 링크(#앵커)가 연 탭은 여기 들어간다 —
   state.tabs 에 쓰면 저장되어 다음 방문의 기본값까지 바뀐다. 사용자가 직접 탭을 누르면 지운다. */
const transient={};
/* 그룹별로 **직전에 몇 번째 탭이었나**. 방향을 알려면 이전 자리를 알아야 한다 */
const lastAt={};
/* 애니메이션을 다시 태우려면 속성을 지웠다 리플로를 한 번 강제하고 다시 붙여야 한다.
   같은 방향으로 두 번 움직이면 값이 그대로라 브라우저가 「바뀐 것이 없다」고 보기 때문이다.
   ⚠스텁 DOM에는 offsetWidth가 없다 — 있을 때만 읽는다 */
function slide(el,dir){
  if(!el.removeAttribute||!el.setAttribute)return;
  el.removeAttribute("data-slide");
  if(typeof el.offsetWidth==="number")void el.offsetWidth;
  if(dir!==0)el.setAttribute("data-slide",dir>0?"next":"prev");
}
function showTabs(){
  Object.keys(tabGroups()).forEach(g=>{
    const cur=transient[g]!==undefined?transient[g]:state.tabs[g];
    /* 탭줄에 적힌 순서가 방향의 기준이다 */
    const keys=$$('[data-tabgroup="'+g+'"] [data-tab]').map(b=>b.dataset.tab);
    const at=keys.indexOf(cur);
    const was=lastAt[g];
    const dir=(was===undefined||at<0||was===at)?0:(at>was?1:-1);
    lastAt[g]=at;
    // "all"은 특별 취급 — 골라 보는 화면에서 「전부」를 뺏지 않는다
    $$('[data-panelgroup="'+g+'"]').forEach(p=>{
      /* ⚠**닫을 때는 "until-found" 로 닫는다.** 그래야 Ctrl+F 가 그 안의 글자를 찾고,
         찾으면 브라우저가 스스로 펼친다(아래 beforematch 가 탭줄도 맞춘다).
         지원하지 않는 브라우저는 이 값을 **그냥 hidden 으로 읽으므로** 지금까지와 같다 —
         잃는 것이 없다(§0-1). */
      const shut=cur!=="all"&&p.dataset.panelkey!==cur;
      /* ⚠**프로퍼티를 먼저 둔다.** 실제 DOM 은 hidden 프로퍼티와 속성이 이어져 있지만,
         setAttribute 만 쓰면 프로퍼티를 읽는 코드·시험이 옛 값을 본다.
         지원하는 브라우저에서만 속성값을 until-found 로 덮는다 — 프로퍼티는 true 그대로다. */
      p.hidden=shut;
      if(shut&&SUPPORTS_UNTIL_FOUND&&p.setAttribute)p.setAttribute("hidden","until-found");
      if(!p.hidden)slide(p,dir);
    });
    /* ⚠**두 종류의 위젯이 같은 배선을 쓴다**(2026-08-18 유저 지적).
       패널을 여는 것은 role=tablist + aria-selected,
       표를 좁히기만 하는 버튼줄(buttonGroup)은 role=group + **aria-pressed** 다.
       그런데 여기서 aria-selected 만 갱신해서, 구단 페이지에서 セイバー 를 눌러도
       **基本 버튼이 눌린 채로 남았다** — 서버가 심은 aria-pressed 를 아무도 안 껐다.
       ⚠**어느 속성을 쓰는지는 버튼 자신이 안다.** 여기서 role 을 다시 판정하지 않는다. */
    $$('[data-tabgroup="'+g+'"] [data-tab]').forEach(b=>{
      const on=String(b.dataset.tab===cur);
      if(b.hasAttribute("aria-pressed"))b.setAttribute("aria-pressed",on);
      else b.setAttribute("aria-selected",on);
    });
  });
  /* ⚠**선택이 바뀌면 그 탭을 상자 안으로 들여놓는다 — 여기 한 곳에서 한다**(M1 · 2026-09-07 P2).
     처음에는 초기화에서 한 번만 불렀는데, **그 뒤에 선택을 바꾸는 경로가 넷 더 있었다**:
     깊은 링크(revealHash) · 브라우저 찾기(beforematch) · 클릭 · 화살표 키.
     앞의 둘은 「패널은 열리는데 그 탭이 상자 밖」이 되어 **유저가 이번에 지적한 바로 그 증상**이
     경로만 달리해서 그대로 남아 있었다. 부르는 자리를 늘리는 대신 **탭이 바뀌는 곳**에 건다 —
     그래야 다음에 경로가 하나 더 생겨도 잊을 자리가 없다.
     ⚠**이미 보이면 아무 일도 안 한다**(revealInStrip 이 넘침을 먼저 본다) — 클릭 경로가 조용한 이유다. */
  revealSelectedTabs();
  tabHooks.forEach(f=>f());
}
(function initTabs(){
  const groups=tabGroups();
  Object.keys(groups).forEach(g=>{
    const buttons=$$('[data-tabgroup="'+g+'"] [data-tab]');
    const keys=buttons.map(b=>b.dataset.tab);
    if(keys.indexOf(state.tabs[g])<0)state.tabs[g]=keys[0];
    buttons.forEach(b=>b.addEventListener("click",()=>{
      /* 직접 고른 것이 임시 선택을 이긴다 — 그리고 그때는 저장한다 */
      delete transient[g];
      state.tabs[g]=b.dataset.tab;save(state);showTabs();
    }));
    /* ⚠**tablist 에만 건다**(2026-08-18 유저 지적으로 좁혔다). 처음에는 모든 data-tabgroup 에
       걸었는데, 그중에는 **패널을 열지 않는 버튼줄**(role=group · buttonGroup)이 섞여 있다 —
       거기서 로빙 tabindex 를 쓰면 Tab 으로 닿던 버튼들이 **하나만 남고 사라진다.**
       화살표 규약은 tablist 의 것이지 버튼 묶음의 것이 아니다.
       ⚠**role=tab 을 붙였으면 화살표가 돌아야 한다**(2026-08-18 감사 P2).
       aria-selected 와 role 만 붙어 있고 **키보드 규약은 없었다** — 낭독기는
       「タブ 1/4」라고 안내하는데 화살표를 눌러도 아무 일도 일어나지 않았다.
       ⚠**새로 만든 날짜 토글(오늘·내일)도 이 위에 얹혀 있다.**
       ⚠tabindex 는 여기서 준다 — JS 가 없으면 화살표도 없으니 그때는 전부 탭으로 닿는 편이 맞다
       (바로 아래 .picklist 가 쓰는 것과 같은 방침). */
    /* ⚠**로빙은 「탭줄 하나」 안의 규약이다 — 그룹 전체의 규약이 아니다**(2026-09-07 P3).
       한 그룹이 리그마다 탭줄을 한 벌씩 갖는데(순위 화면의 rankcat·rankmetric·rankstreak),
       버튼을 문서 전체에서 한 배열로 모으면 둘이 난다:
       ⑴ 탭 정지가 **그룹에 하나**뿐이라 パ 로 바꾸면 그 탭줄에 탭 정지가 **0개**가 되어
          **Tab 으로 아예 닿을 수 없다**(WCAG 2.1.1).
       ⑵ 끝에서 화살표를 누르면 **숨은 반대 리그의 버튼**으로 넘어가고, 숨은 요소는 초점을
          못 받으므로 **초점이 사라진다.**
       ⚠**그룹을 리그별로 나눠서 고치지 마라**(parts.ts 의 TabGroup 주석) — 그러면
       「리그를 바꿔도 보던 지표가 남는다」가 함께 사라진다. 위의 클릭 배선은 그룹 전체
       그대로 두고, **탭 정지와 순환만** 탭줄 안으로 가둔다. */
    const tablists=groups[g].filter(l=>l.getAttribute&&l.getAttribute("role")==="tablist");
    const inList=(list)=>$$("[data-tab]",list);
    /* 지금 고른 키에 맞춰 **탭줄마다 하나씩** 탭 정지를 둔다. 숨은 탭줄에도 둔다 —
       그 리그로 바꾸는 순간 그 자리가 필요해지고, 그때 다시 계산할 자리가 없다 */
    const rove=(key)=>tablists.forEach(list=>{
      const bs=inList(list);
      const on=bs.filter(b=>b.dataset.tab===key)[0]||bs[0];
      bs.forEach(b=>b.setAttribute("tabindex",b===on?"0":"-1"));
    });
    rove(state.tabs[g]);
    tablists.forEach(list=>{
      const bs=inList(list);
      bs.forEach((b,at)=>{
        b.addEventListener("click",()=>rove(b.dataset.tab));
        b.addEventListener("keydown",(e)=>{
          const step=e.key==="ArrowRight"||e.key==="ArrowDown"?at+1
            :e.key==="ArrowLeft"||e.key==="ArrowUp"?at-1
            :e.key==="Home"?0:e.key==="End"?bs.length-1:null;
          if(step===null)return;
          const to=bs[(step+bs.length)%bs.length];
          e.preventDefault();
          /* ⚠**이동하면 그 탭을 연다**(자동 활성화). 이 탭들은 이미 그려진 패널을 여닫을 뿐이라
             여는 비용이 없고, 수동 활성화(Enter 를 또 눌러야 함)는 여기서 손만 늘린다. */
          delete transient[g];
          state.tabs[g]=to.dataset.tab;save(state);showTabs();
          rove(to.dataset.tab);if(to.focus)to.focus();
        });
      });
    });
  });
})();

/* ⚠**깊은 링크가 닫힌 탭 안을 가리킬 수 있다.**
   탭 선택은 localStorage에 남으므로, 「セの順位表をすべて見る」로 #b-standings 에 와도
   지난번에 個人을 보고 있었다면 그 자리는 hidden 이다. 브라우저는 아무 데도 가지 않고
   **아무 일도 일어나지 않은 것처럼 보인다.** 조상 패널을 거슬러 올라가 전부 연다. */
function revealHash(){
  const id=((typeof LOC.hash==="string"?LOC.hash:"")||"").slice(1);
  if(!id)return;
  const el=doc.getElementById(id);
  if(!el)return;
  let n=el,changed=false;
  while(n&&n!==doc.body){
    const d=n.dataset;
    if(d&&d.panelgroup&&d.panelkey&&state.tabs[d.panelgroup]!==d.panelkey&&state.tabs[d.panelgroup]!=="all"){
      transient[d.panelgroup]=d.panelkey;changed=true;
    }
    n=n.parentNode;
  }
  if(!changed)return;
  /* ⚠**저장하지 않는다.** 이 방문에만 연다.
     저장하면 「セの順位表をすべて見る」를 한 번 누른 뒤로 상단 내비의 「順位」가
     영원히 개인 순위부터 열린다 — 링크 한 번이 사용자의 기본값을 바꿔 버린다.
     ?vs= 처리도 같은 이유로 저장하지 않는다(한 파일 안에서 규칙을 둘로 두지 않는다). */
  showTabs();
  if(typeof el.scrollIntoView==="function")el.scrollIntoView();
}
if(typeof window!=="undefined"&&window.addEventListener)window.addEventListener("hashchange",revealHash);

/* ── 블록 조립 ── */
function renderBlocks(){
  const end=$("#blocksEnd");
  state.order.forEach(id=>{const el=doc.getElementById("b-"+id);if(el&&end)end.parentNode.insertBefore(el,end)});
  /* ⚠**조립 시스템이 있는 페이지에서만 숨긴다.**
     그 표식이 #blocksEnd 이고, 선수 페이지에만 있다.

     두 번 틀린 자리다.
     ① 처음에는 BLOCKS(클라이언트가 아는 목록)만 돌았다 → 서버가 그린 블록이 그 목록에 없으면
        **영원히 숨겨지지 않았다.**
     ② 그래서 화면의 블록 전부를 훑게 고쳤더니, **순위표·일람의 블록까지 숨겨
        빈 화면이 나갔다**(2026-08-15 실기 확인). 그 페이지들의 블록은 id가 없거나
        b-hi-central 처럼 조립 목록에 없는 id라 전부 「구성 밖」으로 판정됐다.

     맞는 규칙은 「구성에 없으면 끈다」가 아니라 **「이 페이지의 구성 대상이면, 구성에 없을 때 끈다」**이다. */
  if(end){
    $$(".block").forEach(el=>{
      /* 조립 대상은 b- 접두사를 가진 블록뿐이다 */
      if(el.id.indexOf("b-")!==0)return;
      el.hidden=state.order.indexOf(el.id.slice(2))<0;
    });
  }
  /* ⚠**인라인 스타일로 덮지 않는다** — 스타일시트의 설계값이 죽는다(감사 P1).
     토큰만 바꾸고, 실제 값과 아래쪽 여백 계산은 CSS 한 곳에 둔다(M1). */
  const pad=state.density==="compact"?"var(--s5)":"var(--s7)";
  /* ⚠**지금 보고 있는 구획을 내비가 표시한다.**
     ⚠**스크립트가 없어도 링크는 동작한다**(§0-1) — 여기서 하는 일은 표시뿐이다.
     ⚠IntersectionObserver 가 없으면 조용히 아무 것도 안 한다(옛 브라우저). */
  (function(){
    const nav=document.querySelector(".hjump");
    if(!nav||!("IntersectionObserver" in window))return;
    /* ⚠**이 함수는 두 번 이상 불린다**(밀도 전환 · 블록 재배치). 예전에는 그때마다
       IntersectionObserver 를 **새로 만들고 이전 것을 끊지 않아**, 관찰자가 계속 쌓였다 —
       같은 스크롤 한 번에 mark() 가 N 번 돌고, 떼어낸 노드를 잡은 관찰자가 남는다.
       지금은 도달 불가라 증상이 없지만(2026-08-18 감사 P3: 잠복), 잠복은 잠복이지 부재가 아니다.
       ⚠**만들기 전에 앞의 것을 끊는다.** 창(window)에 손잡이를 하나 두는 것이 가장 단순하다. */
    if(window.__bbSpy&&window.__bbSpy.disconnect)window.__bbSpy.disconnect();
    const links=Array.from(nav.querySelectorAll("a[href^='#']"));
    const byId=new Map(links.map(a=>[a.getAttribute("href").slice(1),a]));
    const targets=links.map(a=>document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
    if(targets.length===0)return;
    /* ⚠**가려지는 높이를 실측한다.** 상수로 두면 CSS 의 scroll-padding 과 갈리고,
       모바일에서 .topbar 가 접히면 **가려진 구획이 「현재」로 표시된다**(감사 P2 · M1). */
    const topInset=()=>{
      const bar=document.querySelector(".topbar");
      const jump=document.querySelector(".hjump");
      const h=(bar?bar.getBoundingClientRect().height:0)
        +(jump&&getComputedStyle(jump).position==="sticky"?jump.getBoundingClientRect().height:0);
      return -Math.round(h+8);
    };
    const seen=new Set();
    const mark=()=>{
      /* 화면에 걸친 것 중 **가장 위**를 현재로 삼는다 */
      let best=null,bestTop=Infinity;
      for(const id of seen){
        const el=document.getElementById(id);if(!el)continue;
        const t=el.getBoundingClientRect().top;
        if(t<bestTop){bestTop=t;best=id}
      }
      for(const [id,a] of byId){
        if(id===best)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current");
      }
    };
    const io=new IntersectionObserver((es)=>{
      for(const e of es){ if(e.isIntersecting)seen.add(e.target.id); else seen.delete(e.target.id); }
      mark();
    },{rootMargin:topInset()+"px 0px -55% 0px"});
    targets.forEach(t=>io.observe(t));
    window.__bbSpy=io;
  })();
  /**
   * ⚠**가로로 넘치는 표를 키보드로도 밀 수 있게 한다**(WCAG 2.1.1 Keyboard · Level A).
   *
   * 실측(2026-08-18 다방면 감사 P1): 스크롤 영역 120개 중 **13개가 키보드로 도달 불가**였다 —
   * 순위표 10열 중 3~10열(승률·게임차·득실차)이 키보드·스위치 사용자에게 **존재하지 않는 것과 같았다.**
   * 화면 어디에도 「오른쪽에 더 있다」는 표시가 없어 **침묵성**이기도 하다.
   *
   * ⚠**전부에 붙이지 않는다.** 순위 화면에만 스크롤 영역이 82개다 — 무조건 붙이면
   *   탭 정지와 랜드마크가 82개 늘어 오히려 못 쓰게 된다.
   *   **실제로 넘치고** 포커스만으로는 **오른쪽 끝까지 못 미는** 것만 고른다.
   * ⚠**리사이즈에 따라 다시 판정한다** — 창을 좁히면 넘치기 시작한다.
   * ⚠**스크립트가 없으면 지금과 같다**(§0-1) — 나빠지지 않는다. 정적으로는
   *   「넘치는가」를 알 수 없어 여기서 한다.
   *
   * ⚠**「포커스 갈 것이 있으면 건너뛴다」로는 순위표가 안 걸렸다**(2026-08-18 재감사 P1).
   * 그 판정의 전제는 「Tab 이 자식으로 들어가면 상자가 따라 굴러간다」인데,
   * 순위표의 **유일한 링크가 sticky 로 고정된 2열의 팀명**이라 포커스를 받아도 1px 도 안 민다.
   * 실측: dist/index.html 5/5 · dist/ranking.html 82/82 가 「포커스 있음」으로 판정돼
   * **한 개도 tabindex 를 못 받았다** — 즉 그 수정이 이 두 화면에서 고친 것이 0개였다.
   * 고쳤다고 위에 적어 둔 바로 그 표가 안 고쳐져 있었다.
   * → **「포커스로 오른쪽 끝에 닿는가」로 판정한다.** offsetLeft 는 sticky 여도 문서상 위치라
   *   고정 열은 작은 값에 머문다.
   */
  (function(){
    const FOCUSABLE="a[href],button,input,select,textarea,[tabindex]";
    const mark=()=>{
      $$(".scroller").forEach(el=>{
        /* ⚠크기를 모르는 환경(시험 스텁)에서는 아무것도 하지 않는다 — 없는 정보로 판정하지 않는다 */
        if(typeof el.scrollWidth!=="number"||typeof el.clientWidth!=="number")return;
        const overflows=el.scrollWidth>el.clientWidth+1;
        let reach=0,n=0;
        $$(FOCUSABLE,el).forEach(f=>{
          n++;
          /* 크기를 모르는 요소는 「끝까지 민다」의 근거가 될 수 없다 — 0으로 둔다 */
          const r=(typeof f.offsetLeft==="number"?f.offsetLeft:0)+(typeof f.offsetWidth==="number"?f.offsetWidth:0);
          if(r>reach)reach=r;
        });
        const hasFocus=n>0&&reach>=el.scrollWidth-1;
        if(overflows&&!hasFocus){
          if(!el.hasAttribute("tabindex")){
            el.setAttribute("tabindex","0");
            el.setAttribute("role","region");
            if(!el.hasAttribute("aria-label")){
              /* ⚠**표가 자기 이름을 갖고 있으면 그것을 쓴다**(2026-09-05 감사 P2).
                 첫 th 만 보면 이름이 **열 이름**이 되어, 같은 모양의 표가 둘 있는 화면에서
                 둘 다 「球団（横スクロール）」가 됐다 — 실측 2건. 우리 표는 거의 전부
                 aria-label 을 갖고 있고 그 이름은 이미 유일하다. th 는 **없을 때의 대비**로 남긴다. */
              const tbl=el.querySelector("table[aria-label]");
              const cap=el.querySelector("caption,th");
              const nm=tbl?tbl.getAttribute("aria-label"):(cap&&cap.textContent?cap.textContent.trim():"表");
              el.setAttribute("aria-label",(nm||"表")+"（横スクロール）");
            }
          }
        }else if(el.getAttribute("role")==="region"&&el.getAttribute("tabindex")==="0"){
          /* 넘치지 않게 됐으면 탭 정지를 도로 없앤다 — 쓸모없는 정지를 남기지 않는다 */
          el.removeAttribute("tabindex");el.removeAttribute("role");el.removeAttribute("aria-label");
        }
      });
    };
    mark();
    /* ⚠**리사이즈 배선은 있을 때만 건다.** 창 크기가 바뀌면 넘침 여부가 달라지는데,
       스크립트 환경에 addEventListener 가 없을 수도 있다(시험 스텁 등) — 없으면 조용히 넘어간다 */
    if(typeof addEventListener==="function"){
      let t=0;
      addEventListener("resize",()=>{clearTimeout(t);t=setTimeout(mark,150)},{passive:true});
    }
    /* ⚠**숨어 있던 패널은 폭이 0이라 판정에서 빠진다.** 이 함수는 showTabs() 앞에 도는데,
       그때 hidden 이던 탭 안의 표는 scrollWidth === clientWidth === 0 이라 「안 넘친다」로 읽힌다.
       순위 화면의 리그·지표 탭이 전부 여기 해당한다 — 탭이 바뀔 때 다시 잰다. */
    tabHooks.push(mark);
  })();
  $$(".block").forEach((el,i)=>{el.style.setProperty("--block-pad-y",pad);el.style.setProperty("--i",String(i))});
}
function renderEditor(){
  const host=$("#blockList");if(!host)return;host.textContent="";
  const rest=BLOCKS.map(b=>b.id).filter(id=>state.order.indexOf(id)<0);
  state.order.concat(rest).forEach(id=>{
    const meta=BLOCKS.filter(b=>b.id===id)[0];if(!meta)return;
    const on=state.order.indexOf(id)>=0;
    const row=doc.createElement("div");row.className="brow";
    const cb=doc.createElement("input");cb.type="checkbox";cb.checked=on;
    cb.setAttribute("aria-label",meta.name+"を表示");
    cb.addEventListener("change",()=>{
      state.order=cb.checked?state.order.concat([id]):state.order.filter(x=>x!==id);
      state.preset="";press(".rail [data-preset]","preset","");commit();
    });
    const txt=doc.createElement("div");
    const n=doc.createElement("div");n.className="bn";n.textContent=meta.name;
    const d=doc.createElement("div");d.className="bd";d.textContent=meta.desc;
    txt.appendChild(n);txt.appendChild(d);
    const up=doc.createElement("button");up.className="mv";up.type="button";up.textContent="↑";
    up.setAttribute("aria-label",meta.name+"を上へ");up.disabled=!on||state.order.indexOf(id)<=0;
    up.addEventListener("click",()=>move(id,-1));
    const dn=doc.createElement("button");dn.className="mv";dn.type="button";dn.textContent="↓";
    dn.setAttribute("aria-label",meta.name+"を下へ");dn.disabled=!on||state.order.indexOf(id)>=state.order.length-1;
    dn.addEventListener("click",()=>move(id,1));
    row.appendChild(cb);row.appendChild(txt);row.appendChild(up);row.appendChild(dn);
    host.appendChild(row);
  });
}
function move(id,d){
  const i=state.order.indexOf(id),j=i+d;
  if(i<0||j<0||j>=state.order.length)return;
  const next=state.order.slice();next.splice(j,0,next.splice(i,1)[0]);
  state.order=next;state.preset="";press(".rail [data-preset]","preset","");commit();
}
function commit(){save(state);renderBlocks();renderEditor()}

$$(".rail [data-preset]").forEach(b=>b.addEventListener("click",()=>{
  state.preset=b.dataset.preset;state.order=(PRESETS[state.preset]||[]).slice();
  press(".rail [data-preset]","preset",state.preset);commit();
}));
$$(".rail [data-density]").forEach(b=>b.addEventListener("click",()=>{
  state.density=b.dataset.density;press(".rail [data-density]","density",state.density);commit();
}));
const eb=$("#editBtn");
if(eb)eb.addEventListener("click",()=>{
  const ed=$("#editor");const open=ed.hidden;ed.hidden=!open;eb.setAttribute("aria-pressed",String(open));
});

/* ── 용어 설명 ──
   PC는 호버, 모바일은 탭, 키보드는 포커스 — **같은 요소가 셋 다 받는다.**
   ⚠호버만 붙이면 터치 단말에서 열 수 없고, 탭만 붙이면 PC에서 한 번 더 눌러야 한다. */
/* ⚠**나중에 만들어지는 요소에도 붙일 수 있어야 한다.** 비교 화면의 표는 브라우저가
   조립하므로, 최초 1회만 훑으면 그 표의 용어에는 설명이 조용히 안 뜬다. */
let bindTerms=null;
const tip=$("#tip");
/* 설명이 상단 바 밑으로 들어가지 않게 하는 한계선. 자리잡기가 매번 읽는다 */
const topbar=$(".topbar");
if(tip&&typeof GLOSSARY!=="undefined"){
  let current=null;
  const hide=()=>{
    if(current)current.setAttribute("aria-expanded","false");
    current=null;tip.hidden=true;
  };
  /* 설명 한 조각을 넣는다.
     ⚠**별표 두 개를 굵게 바꾼다** — 서버의 note() 와 **같은 규칙 한 벌**을 쓴다(M1).
     예전에는 여기가 textContent 뿐이라 별표가 글자 그대로 찍혔다: 용어집 56항목 중 15항목이
     사용자 가시 문자열에 별표를 갖고, 그중 하나 이상을 내보내는 배포물이 6,333/15,340장(41%)이었다.
     ⚠**HTML 문자열을 통째로 넣는 API 를 쓰지 않는다**(그 이름을 여기 적지도 않는다 — 시험이 글자로 센다).
     만드는 태그는 b 하나뿐이고 글자는 전부 textContent 로 들어간다 — 용어집은 우리가 쓴 문장이지만
     임의 HTML 을 넣는 자리를 만들면 그 자리는 언젠가 쓰인다. */
  const put=(tag,text)=>{
    const el=doc.createElement(tag);
    emphasisParts(text).forEach(p=>{
      if(p.bold){const b=doc.createElement("b");b.textContent=p.text;el.appendChild(b)}
      else if(p.text!=="")el.appendChild(doc.createTextNode(p.text));
    });
    tip.appendChild(el);
  };
  const show=(btn)=>{
    const t=GLOSSARY[btn.dataset.term];
    if(!t)return;
    tip.textContent="";
    /* ⚠**표제는 이름이지 문장이 아니다** — 강조를 풀지 않는다.
       라벨에 별표가 없다는 것은 glossary.test.ts 가 지킨다 */
    const b=doc.createElement("b");b.textContent=t.label;tip.appendChild(b);
    put("span",t.short);
    if(t.how)put("s",t.how);
    if(t.caveat)put("u",t.caveat);
    tip.hidden=false;
    if(current&&current!==btn)current.setAttribute("aria-expanded","false");
    current=btn;btn.setAttribute("aria-expanded","true");
    place(btn);
  };
  /* 화면 밖으로 나가지 않게 가로 위치를 접고, **세로도 클램프한다.**
     ⚠예전에는 가로만 접고 세로는 「위에 자리가 있으면 위」로만 골랐다. 그래서 긴 설명이
     아래로 흘러 화면 밖으로 나갔다 — 실측 6/6 뷰포트(火消し率 555px · 320x568 에서 358px 초과).
     들어갈 자리 자체가 없는 구간도 있다: 320x568 가용 480 · 360x640 가용 552 대 필요 555.
     → ⑴ 들어가는 쪽을 고르고(둘 다 안 되면 넓은 쪽) ⑵ 그 쪽 가용 높이를 max-height 로 얹어
       **넘치는 만큼은 툴팁 안에서 굴리게** 한다 ⑶ 위 한계는 상단 바 아래다(가리면 못 읽는다).
     ⚠**높이는 max-height 를 푼 뒤에 재야 한다** — 안 그러면 지난번에 잘린 높이를 다시 쓴다. */
  const place=(btn)=>{
    if(!btn.getBoundingClientRect||!tip.getBoundingClientRect)return;
    const keep=tip.scrollTop||0;
    tip.style.maxHeight="";
    const r=btn.getBoundingClientRect();
    const de=doc.documentElement;
    const vw=(de&&de.clientWidth)||tip.offsetWidth||260;
    const vh=(de&&de.clientHeight)||0;
    const sx=(typeof window!=="undefined"&&window.scrollX)||0;
    const sy=(typeof window!=="undefined"&&window.scrollY)||0;
    const bar=topbar&&topbar.getBoundingClientRect?topbar.getBoundingClientRect().bottom:0;
    const gap=8;
    const top0=(bar>0?bar:0)+4;
    const bot0=vh>0?vh-8:0;
    const need=tip.offsetHeight||90;
    const up=r.top-gap-top0,down=bot0-r.bottom-gap;
    /* 들어가는 쪽 우선, 둘 다 되면 위(예전 기본값), 둘 다 안 되면 넓은 쪽 */
    const above=vh<=0?r.top>need+12:(need<=up?true:(need<=down?false:up>down));
    if(vh>0)tip.style.maxHeight=Math.max(above?up:down,88)+"px";
    const w=tip.offsetWidth||260,h=tip.offsetHeight||90;
    let x=r.left;
    if(x+w>vw-8)x=vw-w-8;
    if(x<8)x=8;
    let y=above?r.top-gap-h:r.bottom+gap;
    if(vh>0){if(y+h>bot0)y=bot0-h;if(y<top0)y=top0}
    tip.style.left=(x+sx)+"px";
    tip.style.top=(y+sy)+"px";
    tip.scrollTop=keep;
  };
  /* ⚠**정렬 버튼에는 탭으로 열지 않는다.** 표 헤더를 누르는 것은 「정렬」이라는 뜻이고,
     같은 탭이 설명도 열면 어느 쪽이 일어난 건지 알 수 없다. 호버·포커스만 받는다.
     같은 용어가 위쪽 성적표에 제대로 된 버튼으로 있으므로 터치에서도 길은 남아 있다. */
  bindTerms=(root)=>{
    $$("[data-term]",root).forEach(btn=>{
      const tapToOpen=btn.className&&String(btn.className).split(" ").indexOf("term")>=0;
      if(tapToOpen)btn.setAttribute("aria-expanded","false");
      btn.addEventListener("mouseenter",()=>show(btn));
      btn.addEventListener("mouseleave",hide);
      btn.addEventListener("focus",()=>show(btn));
      btn.addEventListener("blur",hide);
      if(!tapToOpen)return;
      /* ⚠**닫을지 열지는 「누르기 시작한 순간」의 상태로 정한다.**
         터치의 한 번 탭은 브라우저가 click 앞에 mouseenter 와 focus 를 **합성**하는데,
         그 둘이 이미 설명을 열어 놓으므로 click 시점에 current===btn 을 보면
         **방금 자기가 연 것을 자기가 닫는다.** 실측(Chromium 151 · hasTouch:true · 390x844):
         탭1 false · 탭2 true · 탭3 false — 즉 **첫 탭이 아무 일도 안 한 것처럼 보였다.**
         ⚠**mouseenter 를 떼는 것만으로는 안 낫는다.** 같은 조건에서 mouseenter/mouseleave 를
         matchMedia("(hover: hover) and (pointer: fine)") 로 막고 다시 재도 **탭1 은 여전히 false** 였다
         (그때는 focus 가 대신 연다). 그래서 **여는 쪽이 아니라 토글의 기준**을 고친다.
         ⚠**하이브리드(터치+마우스 노트북)에서도 같다** — 그 기기는 matchMedia 가 「마우스」로
         분류하므로 게이트 방식이면 손가락 탭이 그대로 깨진다. 여기 방식은 기기가 아니라
         **그 순간의 상태**를 보므로 마우스·터치·하이브리드가 같은 규칙 하나로 맞는다.
         ⚠**mouseenter 를 남겨 두는 이유는 따로 있다**: 정렬 버튼에는 click 이 안 붙는데,
         구단 페이지 108장에서 obp·slg·ops·pa·gidp·src·wrcPlus·woba·wraa·whip·innings·srp·
         fip·k9·bb9·pitchesPerOut **16개 용어의 설명 경로가 정렬 버튼뿐**이다(배포물 전수).
         호버를 마우스 전용으로 좁히면 손가락에서 그 16개가 통째로 닿을 수 없게 된다 —
         §0-1(설치·계정 없이 URL 만으로) 쪽이 더 무겁다.
         ⚠포인터 없이 온 click(키보드 Enter/Space)은 downOpen 이 null 이라 지금 상태로 토글한다. */
      let downOpen=null;
      btn.addEventListener("pointerdown",()=>{downOpen=current===btn});
      btn.addEventListener("click",(e)=>{
        if(e&&e.preventDefault)e.preventDefault();
        const wasOpen=downOpen===null?current===btn:downOpen;
        downOpen=null;
        if(wasOpen)hide();else show(btn);
      });
    });
  };
  bindTerms(doc);
  doc.addEventListener("keydown",(e)=>{if(e&&e.key==="Escape")hide()});
  doc.addEventListener("click",(e)=>{
    let n=e&&e.target;
    while(n){if(n===tip||(n.getAttribute&&n.getAttribute("data-term")))return;n=n.parentNode}
    hide();
  });
  /* ⚠**스크롤에 닫지 않는다 — 자리를 다시 잡는다.**
     옛 주석이 말한 문제(「표를 가로로 밀면 설명만 제자리에 남는다」)는 **위치 문제**이지
     닫아야 할 이유가 아니었다. 닫으면 **포커스로 여는 길이 통째로 막힌다** —
     포커스가 스크롤을 유발하면 그 스크롤이 방금 연 설명을 닫기 때문이다.
     실측(2026-08-21 · 한 선수 페이지의 용어 54개 · 같은 요소로 A/B):
     최상단에서 focus() **3/54** 대 scrollIntoView 뒤 focus() **54/54**.
     즉 실패한 51건은 전부 「스크롤을 유발한 포커스」였고, 그건 곧
     **아직 못 본 용어에 처음 도달하는** 정지다.
     ⚠capture 라 가로 스크롤과 컨테이너 스크롤(표 래퍼·탭줄)까지 잡는다 — 그쪽이야말로
     자리를 다시 잡아야 하는 쪽이다.
     ⚠**툴팁 안을 굴린 것은 무시한다** — 안 그러면 긴 설명을 읽으려고 굴릴 때마다 자리가 다시 잡힌다.
     ⚠**한 프레임에 한 번만 계산한다** — 스크롤마다 재면 레이아웃을 강제로 다시 만든다.
     ⚠**「휠로 굴리면 닫힌다」는 감각은 남는다** — 페이지가 움직이면 포인터 아래에서 용어가
     빠져나가 mouseleave 가 나기 때문이다(실측: 호버로 연 뒤 휠 260px → 닫힘).
     닫히지 않게 되는 것은 **키보드·터치로 연 경우**뿐이고, 그건 원래 닫히면 안 되는 쪽이다. */
  let placing=0;
  doc.addEventListener("scroll",(e)=>{
    if(!current)return;
    let n=e&&e.target;
    while(n&&n.nodeType===1){if(n===tip)return;n=n.parentNode}
    /* ⚠window 를 떼어내 부르지 않는다 — 브라우저에서 Illegal invocation 이 난다 */
    const w=typeof window!=="undefined"?window:null;
    if(!w||!w.requestAnimationFrame){place(current);return}
    if(placing)return;
    placing=w.requestAnimationFrame(()=>{placing=0;if(current)place(current)});
  },true);
}

/* ── 成績の紋 ──
   표제의 마크를 누르면 확대판이 열리고, 꼭짓점을 누르면 그 항목이 커지며 판독부가 바뀐다.

   ⚠**글자를 여기서 만들지 않는다.** 다섯 벌의 판독부를 서버가 이미 그려 두었고
   여기서는 hidden만 옮긴다 — 설명이 용어집에서 오는 한 벌로 유지된다(M1).
   ⚠**SVG 꼭짓점에 클릭만 붙이지 않는다.** 키보드로도 고를 수 있어야 하고,
   같은 일을 하는 진짜 버튼(항목 고르기)도 함께 둔다 — 손가락에는 그쪽이 확실하다. */
(function markPanel(){
  const panel=$("#markPanel");
  if(!panel)return;
  const btn=$("#markBtn");
  const axesEls=$$(".mf-ax");
  const picks=$$("[data-markpick] [data-axis]");
  const reads=$$("[data-axisread]");
  if(reads.length===0)return;

  let cur=0;
  const select=(i)=>{
    if(i<0||i>=reads.length)return;
    cur=i;
    reads.forEach(el=>{el.hidden=el.dataset.axisread!==String(i)});
    picks.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.axis===String(i))));
    axesEls.forEach(g=>{
      const on=g.dataset.axis===String(i);
      g.setAttribute("class",on?"mf-ax on":"mf-ax");
      g.setAttribute("aria-pressed",String(on));
    });
  };

  axesEls.forEach(g=>{
    const i=Number(g.dataset.axis);
    g.addEventListener("click",()=>select(i));
    g.addEventListener("keydown",(e)=>{
      if(!e||!e.key)return;
      if(e.key==="Enter"||e.key===" "){if(e.preventDefault)e.preventDefault();select(i);return}
      /* 화살표로 옆 꼭짓점으로 옮긴다 — 다섯 개를 Tab으로만 도는 것은 느리다 */
      const step=e.key==="ArrowRight"||e.key==="ArrowDown"?1:e.key==="ArrowLeft"||e.key==="ArrowUp"?-1:0;
      if(step===0)return;
      if(e.preventDefault)e.preventDefault();
      const next=(i+step+axesEls.length)%axesEls.length;
      select(next);
      const el=axesEls.filter(g2=>g2.dataset.axis===String(next))[0];
      if(el&&el.focus)el.focus();
    });
  });
  picks.forEach(b=>b.addEventListener("click",()=>select(Number(b.dataset.axis))));

  if(btn){
    const apply=(open)=>{
      panel.hidden=!open;
      btn.setAttribute("aria-expanded",String(open));
      if(open)select(cur);
    };
    btn.addEventListener("click",()=>{
      const open=panel.hidden;
      apply(open);
      /* 열어 둔 상태를 기억한다 — 선수를 넘겨 볼 때마다 다시 여는 것은 성가시다 */
      state.mark=open;save(state);
    });
    apply(state.mark===true);
  }
})();

/* 수준 색 끄기 — 분모는 끌 수 없지만 색은 보조라 끌 수 있다 */
const gradeBtn=$("#gradeBtn");
if(gradeBtn){
  const applyGrades=()=>{
    const on=state.grades!==false;
    if(on)doc.documentElement.removeAttribute("data-grades");
    else doc.documentElement.setAttribute("data-grades","off");
    gradeBtn.setAttribute("aria-pressed",String(on));
  };
  gradeBtn.addEventListener("click",()=>{
    state.grades=state.grades===false;save(state);applyGrades();
  });
  applyGrades();
}

/* ── 정렬·좁히기가 되는 표 (한 벌) ──

   ⚠**예전에는 이 동작이 #matchupTable 하나에만 붙어 있었다.** 구단 打者/投手·순위표에도
   같은 것이 필요해졌는데, 표마다 복붙하면 「이 표는 결측을 뒤로 보내고 저 표는 안 보낸다」가
   생긴다. 마크업 쪽 한 벌은 src/table.ts 이고 여기가 그 짝이다(M1).

   ⚠**막지 않고 말한다.** 대전 표본은 대부분 한 자릿수라 율로 정렬하면 적은 타석이 위로 온다.
   정렬 자체를 막는 대신, **지금 무엇으로 정렬돼 있고 얇은 행이 몇 개 섞였는지**를 늘 낸다.

   ⚠**정렬 상태의 저장 자리가 state.matchup 에서 state.sort[id] 로 옮겨졌다.**
   예전에 저장해 둔 대전 정렬은 한 번 기본값으로 돌아간다 — 잃는 것은 없다. */
const THIN_MATCHUP_PA=10;
/* 질의문자열 vs=山本 — 「対戦を選ぶ」에서 넘어온 상대 이름 */
function vsParam(){
  const m=/[?&]vs=([^&#]*)/.exec(LOC.search||"");
  if(!m)return "";
  try{return decodeURIComponent(m[1].replace(/\\+/g," "))}catch(e){return ""}
}

if(!state.sort||typeof state.sort!=="object")state.sort={};
if(!state.only||typeof state.only!=="object")state.only={};

$$("[data-stable]").forEach(box=>{
  const id=box.dataset.stable;
  const table=$("table",box);
  if(!table)return;
  const tbody=$("tbody",table);
  if(!tbody)return;
  const all=$$("tr",tbody);
  const heads=$$("th",table);
  const buttons=$$(".sortable",table);
  if(buttons.length===0)return;

  const unit=box.dataset.unit||"件";
  const labelOf={},typeOf={},rateOf={};
  buttons.forEach(b=>{
    labelOf[b.dataset.sortkey]=b.textContent;
    typeOf[b.dataset.sortkey]=b.dataset.sorttype;
    rateOf[b.dataset.sortkey]=b.dataset.sortrate==="1";
  });

  const def=String(box.dataset.sortdefault||"").split(":");
  const fallback={key:def[0],dir:def[1]==="asc"?"asc":"desc"};
  /* 저장된 열이 지금 표에 없으면 기본으로 — 표 구성이 바뀌어도 아무 표도 안 열리는 일이 없게 */
  const cur=state.sort[id];
  if(!cur||typeof cur!=="object"||!labelOf[cur.key])state.sort[id]=fallback;

  const finder=$("[data-stable-filter]",box);
  const picker=$("[data-stable-select]",box);
  const onlyBtn=$("[data-stable-only]",box);
  const countEl=$("[data-stable-count]",box);
  const empty=$("[data-stable-empty]",box);
  const status=$("[data-stable-status]",box);

  /* 얇은 표본의 기준. 없으면 이 표에는 그런 개념이 없다 */
  const thinField=box.dataset.thinfield;
  const thinMin=Number(box.dataset.thinmin||"0");
  const thinUnit=box.dataset.thinunit||"";

  /* 임계값 버튼줄(예: 最少打席). 탭 구조를 그대로 쓰므로 상태는 state.tabs 에 있다 */
  const minGroup=box.dataset.mingroup;
  const minField=box.dataset.minfield;

  /* ⚠**값이 없는 행은 방향과 무관하게 뒤로 보낸다.** 오름차순에서 「기록 없음」이 1위가 되면
     비어 있다는 사실이 성적처럼 읽힌다(M11). */
  const compare=(a,b,key)=>{
    const av=a.dataset[key],bv=b.dataset[key];
    if(typeOf[key]==="text")return String(av||"").localeCompare(String(bv||""),"ja");
    return Number(av)-Number(bv);
  };

  const apply=()=>{
    const key=state.sort[id].key,dir=state.sort[id].dir;
    const min=minGroup?Number(state.tabs[minGroup]||"1"):1;
    const term=finder?finder.value.trim():"";
    const pick=picker?picker.value:"";
    /* ⚠**이름이 아니라 선수 ID 로 못 박는다**(M10 · 2026-08-18 감사 P2).
       「対戦を選ぶ」에서 넘어올 때 이름을 넘기면 **동명이인이 함께 걸린다** —
       이 저장소에 「小島」가 실제로 둘 있다. 이름은 화면에 보여 줄 때만 쓴다. */
    const pinId=box.dataset.pinid||"";
    const field=picker?picker.dataset.field:"";
    const only=onlyBtn?state.only[id]===true:false;
    const sign=dir==="asc"?1:-1;
    /* 같은 값이면 기본 열로 가른다 — 순서가 브라우저 정렬의 안정성에만 기대지 않게 */
    const tie=fallback.key;

    const sorted=all.slice().sort((a,b)=>{
      const miss=(a.dataset[key]===undefined?1:0)-(b.dataset[key]===undefined?1:0);
      if(miss!==0)return miss;
      return sign*compare(a,b,key)||(Number(b.dataset[tie])-Number(a.dataset[tie]))||0;
    });

    let n=0,thin=0;
    sorted.forEach(tr=>{
      tbody.appendChild(tr);
      const hit=(!minField||Number(tr.dataset[minField])>=min)
        &&(pinId===""||tr.dataset.oppid===pinId)
        &&(term===""||String(tr.dataset.name||"").indexOf(term)>=0)
        &&(pick===""||!field||tr.dataset[field]===pick)
        &&(!only||tr.dataset.qualified==="1");
      tr.hidden=!hit;
      if(hit){n++;if(thinField&&Number(tr.dataset[thinField])<thinMin)thin++}
    });

    if(countEl)countEl.textContent=n+unit;
    /* ⚠**0건을 빈 표로 두지 않는다.** 「대전이 없다」와 「고장났다」가 같은 화면이면 결함이다(M12) */
    if(empty)empty.hidden=n!==0;

    heads.forEach(th=>{
      const b=$(".sortable",th);
      const on=b&&b.dataset.sortkey===key;
      th.setAttribute("aria-sort",on?(dir==="asc"?"ascending":"descending"):"none");
    });

    if(onlyBtn)onlyBtn.setAttribute("aria-pressed",String(only));

    if(status){
      let text=typeOf[key]==="text"
        ?labelOf[key]+(dir==="asc"?" 昇順":" 降順")
        :labelOf[key]+(dir==="asc"?"の少ない順":"の多い順");
      if(pick!==""&&picker)text+=" · "+picker.options[picker.selectedIndex].textContent;
      if(min>1)text+=" · "+min+thinUnit+"以上";
      if(only&&onlyBtn)text+=" · "+onlyBtn.textContent;
      if(rateOf[key]&&thinField&&min<thinMin&&thin>0){
        text+=" · ⚠"+thinMin+thinUnit+"未満が"+thin+unit+"混ざっています（率は標本が小さいほど揺れます）";
      }
      status.textContent=text;
    }
  };

  /* 같은 열을 다시 누르면 방향이 뒤집힌다. 다른 열은 그 열에 자연스러운 방향에서 시작한다 —
     이름·구단은 오름차순, 수치는 내림차순 */
  buttons.forEach(b=>b.addEventListener("click",()=>{
    const key=b.dataset.sortkey;
    state.sort[id]=state.sort[id].key===key
      ?{key:key,dir:state.sort[id].dir==="desc"?"asc":"desc"}
      :{key:key,dir:typeOf[key]==="text"?"asc":"desc"};
    save(state);apply();
  }));
  if(finder)finder.addEventListener("input",apply);
  if(onlyBtn)onlyBtn.addEventListener("click",()=>{
    state.only[id]=state.only[id]!==true;save(state);apply();
  });
  if(picker){
    picker.addEventListener("change",()=>{
      if(!state.picked||typeof state.picked!=="object")state.picked={};
      state.picked[id]=picker.value;save(state);apply();
    });
    /* 저장된 선택지가 이 표에 없으면 「すべて」로 되돌린다 — 0건 화면이 되지 않게 */
    const saved=state.picked&&typeof state.picked==="object"?state.picked[id]:undefined;
    if(typeof saved==="string"){
      const ok=Array.prototype.some.call(picker.options,o=>o.value===saved);
      picker.value=ok?saved:"";
    }
  }
  tabHooks.push(apply);

  /* 대전 표만의 사정: 「対戦を選ぶ」에서 ?vs= 로 넘어온 **선수 ID** 로 그 한 행만 남긴다.
     ⚠**예전에는 이름을 넘겨 좁히기 칸에 넣었다**(2026-08-18 감사 P2). 그러면 동명이인이
     함께 걸리고 부분일치까지 걸려, 「이 투수와의 성적」이라며 **남의 기록이 섞인 표**를 보여 준다.
     ⚠**이름은 화면에 보여 줄 때만 쓴다** — 좁히기 칸에는 그 행의 이름을 넣어 무엇이 걸렸는지 말하되,
     실제 판정은 ID 로 한다.
     ⚠**옛 링크(이름)를 버리지 않는다** — ID 로 걸리는 행이 없으면 지금까지대로 이름 좁히기로 흘린다.
     ⚠**「ID 처럼 생겼는가」로 판정하지 않는다.** 처음에 정규식으로 숫자인지 봤는데
        (ㄱ) 이 파일은 템플릿 리터럴이라 소스에 쓴 숙자 클래스 이스케이프가
             클라이언트에서는 글자 d 로 죽어 있었다 — 판정이 조용히 뒤집혀 있었다
             (이 파일의 역따옴표 함정과 같은 부류다),
        (ㄴ) ID 의 모양은 우리가 정한 것이 아니라 소스가 정한다.
        **그냥 찾아보고 없으면 이름으로 다룬다** — 모양을 가정하지 않는 편이 짧고 안전하다. */
  if(id==="matchup"&&finder){
    const vs=vsParam();
    if(vs!==""){
      const byId=$$("tbody tr",box).filter(tr=>tr.dataset.oppid===vs)[0];
      if(byId){
        box.dataset.pinid=vs;
        finder.value=String(byId.dataset.name||"");
        /* ⚠**칸을 건드리면 못 박기를 푼다.** 안 그러면 지운 뒤에도 한 행만 남아
           「대전 기록이 하나뿐인 선수」로 보인다 */
        /* ⚠**지우고 다시 그린다.** 이미 등록된 input 핸들러가 먼저 돌아
           못 박기가 살아있는 채로 걸러진다 — 순서에 기대지 않고 여기서 다시 적용한다 */
        finder.addEventListener("input",()=>{
          if(box.dataset.pinid!==undefined){delete box.dataset.pinid;apply()}
        });
      }else{
        finder.value=vs;
      }
      /* 대전 블록이 꺼져 있으면 이번 방문에만 켠다 — 사용자의 저장된 구성은 건드리지 않는다 */
      if(state.order.indexOf("matchup")<0)state.order=state.order.concat(["matchup"]);
    }
  }
});

/* ── 찾기로 펼쳐진 패널의 탭을 맞춘다 ──

   ⚠**브라우저가 패널을 펼쳐도 탭줄은 그대로다.** 그러면 「投手 탭이 눌려 있는데
   화면은 打者」가 되어 화면이 자기 자신과 모순된다. 찾기로 열렸을 때 탭도 함께 옮긴다.
   ⚠**저장하지 않는다** — 찾다가 스친 것을 「이 사람이 고른 탭」으로 기억하면 안 된다. */
$$("[data-panelgroup]").forEach(p=>{
  p.addEventListener("beforematch",()=>{
    const g=p.dataset.panelgroup,k=p.dataset.panelkey;
    if(!g||!k)return;
    transient[g]=k;
    showTabs();
  });
});

/* ── 순위표의 「規定到達のみ / 全員」 ──

   ⚠**여기서 다시 순위를 매기지 않는다**(M1/M3). 서버가 **같은 rankBy 한 벌**로
   두 번 매겨 두 순위를 다 보냈다. 클라이언트가 매기면 동률 규칙이 갈릴 수 있고,
   순위는 규칙이 곧 값이다.

   ⚠**기본은 「규정 도달자만」이고, 미달 행은 서버가 이미 hidden 으로 보낸다.**
   스크립트가 없으면 지금까지와 똑같은 화면이 나온다 — 이 기능은 더해지는 쪽이다.

   ⚠**「全員」일 때만 최소 표본을 받는다**(2026-08-20). 「全員」은 minDenominator: 0 이라
   1타석 1안타가 打率 1위로 올라오는 세계이고, 그래서 하한을 유저가 직접 넣을 수 있어야 한다.
   規定 도달자만 보는 동안에는 규정 자체가 이미 하한이라 이 칸이 아무것도 안 자르므로,
   **칸째로 숨긴다** — 눌러도 아무 일이 없는 조작을 두지 않는 이 패널의 규칙(서버 쪽
   hasQualifier 가 같은 이유로 버튼 자체를 없앤다)과 같다.
   ⚠**거르기만 하고 다시 번호를 매기지 않는다**(위와 같은 이유 · M1/M3). 그래서 번호가
   띄엄띄엄해지는데, **그 이유는 표 아래 글이 말한다** — 안 적으면 「순위가 이상하다」로 읽힌다. */

/* 최소 표본 입력을 읽는다.
   ⚠**못 읽으면 0으로 만들지 않는다**(침묵 오류). 조용히 0이 되면 「친 값이 안 먹었다」가
   화면에서 사라져, 사용자는 거르기가 고장난 줄 안다. 못 읽었다는 사실을 돌려주고 화면이 말한다.
   ⚠**asOuts 는 분모가 아웃 카운트인 패널**(방어율·WHIP·K/9…)이다. 그 표의 母数 칸은
   138.1回 라는 **야구 표기**로 쓰여 있으므로 거기 보이는 수를 그대로 칠 수 있어야 한다 —
   138.1 은 138과 3분의 1이닝이라 415아웃이고, 소수점 아래에 3 이상은 존재하지 않는다.
   50 을 50아웃으로 읽으면 **3배로 자른다.**
   ⚠**정규식에 역슬래시를 쓰지 않았다** — 이 파일은 통째로 템플릿 리터럴이라 한 겹 벗겨진다.
   그래서 [0-9] 와 [.] 로만 적는다(이 저장소가 여러 번 데인 자리다). */
const RANK_MIN_PLAIN=/^[0-9]{1,6}$/;
const RANK_MIN_INNINGS=/^([0-9]{1,6})(?:[.]([0-9]))?$/;
function rankMinRead(text,asOuts){
  /* 빈 칸은 **「하한 없음」**이지 못 읽은 값이 아니다 — 지우고 다시 치는 도중에
     경고가 번쩍이면 정상 조작이 오류처럼 보인다. 결과(전원으로 돌아옴)가 화면에 그대로 보인다 */
  const s=String(text==null?"":text).trim();
  if(s==="")return {ok:true,value:0};
  if(!asOuts)return RANK_MIN_PLAIN.test(s)?{ok:true,value:Number(s)}:{ok:false,value:0};
  const m=RANK_MIN_INNINGS.exec(s);
  if(!m||(m[2]!==undefined&&Number(m[2])>2))return {ok:false,value:0};
  return {ok:true,value:Number(m[1])*3+(m[2]===undefined?0:Number(m[2]))};
}
/* 저장된 값을 입력칸으로 되돌린다 — **저장은 원시 분모(아웃), 보이는 것은 이닝**이다.
   ⚠format.ts 의 innings() 와 같은 규칙이다. 서버 모듈을 부를 수 없어 여기 한 벌을 두지만,
   **뜻이 갈리면 입력과 母数 칸이 다른 수를 가리키게 된다** — 바꿀 때 양쪽을 같이 본다 */
function rankMinText(value,asOuts){
  if(!asOuts)return String(value);
  const whole=Math.floor(value/3),rest=value%3;
  return rest===0?String(whole):whole+"."+rest;
}

if(!state.rankAll||typeof state.rankAll!=="object")state.rankAll={};
if(!state.rankMin||typeof state.rankMin!=="object")state.rankMin={};
/* 같은 지표가 **여러 벌로 그려지고 상태는 한 벌**이다 — data-rankonly 는 리그로 갈라져
   있지 않다(실측 2026-08-20 dist/ranking.html: avg 가 2건 · 투수 지표는 선발·구원까지 4건).
   ⚠**그러면 다시 그리는 것도 다 같이 해야 한다.** 누른 쪽만 갱신하면 반대 리그의 표가
   저장된 상태와 어긋난 채 남아, **새로고침해야 맞는 화면**이 된다. */
const rankViews={};
$$("[data-rankonly]").forEach(btn=>{
  const id=btn.dataset.rankonly;
  const box=btn.closest?btn.closest(".block"):null;
  const scope=box||doc;
  /* 같은 화면에 지표 패널이 여럿이라 **이 패널의 표만** 잡아야 한다 */
  const panel=btn.parentNode&&btn.parentNode.parentNode?btn.parentNode.parentNode:scope;
  const rows=$$("tbody tr",panel);
  if(rows.length===0)return;
  const countEl=$('[data-rankcount="'+id+'"]',panel);
  const minBox=$('[data-rankmin="'+id+'"]',panel);
  const minWrap=minBox&&minBox.parentNode?minBox.parentNode:null;
  const badEl=$('[data-rankbad="'+id+'"]',panel);
  const emptyEl=$('[data-rankempty="'+id+'"]',panel);
  const asOuts=minBox&&minBox.hasAttribute?minBox.hasAttribute("data-rankouts"):false;
  const moreBtn=$('[data-rankmore="'+id+'"]',panel);
  /* 못 읽은 입력. ⚠**저장하지 않는다** — 다음 방문에 되살릴 값이 아니다 */
  let bad=false;
  /* ⚠**펼침은 저장하지 않는다.** 다음 방문에 되살릴 상태가 아니고, 되살리면
     **처음 화면이 무거워진다** — 이 표는 이미 무게가 문제인 화면이다 */
  let expanded=false;

  /* ⚠**펼치면 「연속」이어야 한다**(2026-08-31 · 사용자 요구 「누락 순위 없게」).
     표 안에도 경계 아래 행이 몇 개 있지만(합집합으로 들어온 규정 도달자) 그것만 보이면
     **61 · 66 · 110 · 184 · 222** 처럼 다시 뛴다 — 실측으로 확인했다.
     그래서 **경계 아래 전부**를 파일에서 받아 그리고, 표 안의 그 성긴 행들은 숨긴다.
     ⚠**textContent 로만 넣는다** — 이름은 외부에서 온 글자다.
     ⚠**서식은 서버가 만든 것을 그대로 쓴다**(v·d) — 여기서 다시 포맷하면 규칙이 두 벌이 된다.
     ⚠**apply() 보다 먼저 선언한다** — apply() 가 이것을 부르기 때문이다(그 안의 주석 참조). */
  let restRows=null,restLoading=false;
  const tbody=$("tbody",panel);
  const drawRest=()=>{
    if(!tbody)return;
    $$("tr[data-restrow]",tbody).forEach(tr=>{tr.remove()});
    /* ⚠**「全員」이 아니면 하나도 안 그린다** — 규정 모드에 미달자가 남아 있던 것이
       사용자가 본 결함이다. 여기 조건이 그 판정의 전부다 */
    if(!expanded||restRows===null||state.rankAll[id]!==true)return;
    const saved=state.rankMin[id];
    const min=typeof saved==="number"&&saved>0?saved:0;
    const frag=doc.createDocumentFragment();
    restRows.forEach(r=>{
      if(min>0&&!(Number(r.den)>=min))return;
      const tr=doc.createElement("tr");
      tr.setAttribute("data-restrow","1");
      const cells=[String(r.r),r.name,r.t,r.v,r.d];
      cells.forEach((text,i)=>{
        const td=doc.createElement("td");
        if(i===1||i===2)td.className="l";
        if(i===1){
          const a=doc.createElement("a");
          a.setAttribute("href",BASE+"players/"+r.playerId+".html");
          a.textContent=text;
          td.appendChild(a);
        }else td.textContent=text;
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  };

  /* @param typing 지금 이 칸에 치고 있는 중인가. 그러면 **입력값을 덮어쓰지 않는다** */
  const apply=(typing)=>{
    const all=state.rankAll[id]===true;
    const saved=state.rankMin[id];
    /* 「規定到達のみ」 동안에는 하한을 걸지 않는다 — **숨긴 칸이 몰래 자르면 그게 최악이다** */
    const min=all&&typeof saved==="number"&&saved>0?saved:0;
    let n=0;
    rows.forEach(tr=>{
      const q=tr.dataset.qualified==="1";
      /* ⚠**분모가 안 실린 행은 하한이 걸리는 순간 빠진다**(M11) — 「0」이 아니라 「모름」이라
         「300타석 이상」에 넣을 근거가 없다. 하한이 0이면 아무도 안 뺀다 */
      const den=tr.dataset.den;
      const wide=min===0||(den!==undefined&&Number(den)>=min);
      /* ⚠**「全員」의 기본 화면은 연속이어야 한다**(2026-08-31 · 사용자 지적).
         행 집합이 **세 벌의 합집합**이라, 규정 도달자인데 전원 순위가 한참 아래인 행이 섞인다 —
         그대로 두면 순위가 **31 → 36 → 152 → 181 → 244** 로 뛴다.
         서버가 data-beyond 로 표시해 둔 그런 행은 **펼쳐야** 나온다.
         ⚠**규정 모드에서는 숨기지 않는다** — 거기서는 규정 순위로 연속이고, 그 선수들이 본체다. */
      const beyond=tr.dataset.beyond==="1";
      /* ⚠**펼쳐도 이 행은 안 보인다.** 펼침은 파일에서 받은 **연속** 행이 대신 그린다 —
         같은 선수를 두 번 그리지 않으려면 여기서 계속 숨겨야 한다.
         ⚠**규정 모드에서는 보인다** — 거기서는 이 행들이 본체다. */
      const past=all&&beyond;
      tr.hidden=(!all&&!q)||!wide||past;
      if(!tr.hidden)n++;
      /* 순위 칸을 바꿔 넣는다 — 두 값이 다 실려 있으므로 고르기만 한다 */
      const a=$("[data-rankq]",tr),b=$("[data-ranka]",tr);
      if(a)a.hidden=all;
      if(b)b.hidden=!all;
    });
    btn.setAttribute("aria-pressed",String(!all));
    if(countEl)countEl.textContent=n+"人";
    if(minWrap)minWrap.hidden=!all;
    if(minBox){
      /* ⚠**칸의 값을 되돌려 놓으면 「못 읽었다」도 같이 사라져야 한다**(2026-08-21 최종 검토 P3).
         bad 는 사본마다 따로인데 칸의 값은 **다른 사본의 조작으로도** 덮어써진다 —
         A 에 「-5」를 친 채 B 의 「規定到達のみ」를 누르면 A 의 칸은 유효한 수로 돌아가는데
         aria-invalid 와 경고문만 A 에 남아 **「값은 정상인데 오류라고 말하는 칸」**이 됐다.
         ⚠typing 인 사본(지금 치고 있는 칸)은 값을 안 건드리므로 bad 도 그대로 둔다. */
      if(!typing){minBox.value=rankMinText(min,asOuts);bad=false}
      minBox.setAttribute("aria-invalid",String(bad));
    }
    if(badEl)badEl.hidden=!bad;
    /* ⚠**0건을 빈 표로 두지 않는다**(M12). 못 읽은 입력일 때는 **거르지 않았으므로**
       이 말을 하지 않는다 — 그때 할 말은 badEl 이 한다 */
    if(emptyEl)emptyEl.hidden=!(all&&!bad&&n===0);
    /* ⚠**펼치기는 「全員」에서만 뜻이 있다** — 규정 모드에는 숨긴 행이 없다.
       ⚠**숨긴 행이 실제로 있을 때만 낸다** — 눌러도 아무 일도 안 일어나는 버튼은 고장으로 읽힌다 */
    /* ⚠**서버가 「받을 것이 있다」고 할 때만 그린다** — 버튼 자체가 그때만 나온다.
       ⚠**「全員」에서만 뜻이 있다** — 규정 모드는 이미 연속이다. */
    if(moreBtn&&!restLoading){
      moreBtn.hidden=!all;
      moreBtn.setAttribute("aria-expanded",String(expanded));
      moreBtn.textContent=expanded?"上位だけ表示":"順位をもっと見る";
    }
    /* ⚠**펼쳐 붙인 행도 여기서 같이 그린다**(2026-08-31 · 사용자 보고).
       그전에는 「規定到達のみ」 전환이 apply() 만 부르고 붙인 행은 아무도 안 지웠다 —
       그래서 **규정 모드인데 미달자가 순위를 단 채 아래에 남아 있었다.**
       ⚠**같은 지표의 다른 사본에서 눌러도 지워져야 한다** — 전환은 refresh() 로 전 사본의
       apply() 를 부르므로, 여기 두면 사본마다 자기 것을 지운다.
       → **모드 전환·하한 변경·펼치기가 전부 이 한 경로로 모인다.** */
    drawRest();
  };
  const views=(rankViews[id]=rankViews[id]||[]);
  views.push(apply);
  /* @param from 지금 조작 중인 사본. 그 하나만 입력값을 그대로 두고 나머지는 맞춘다 */
  const refresh=(from)=>views.forEach(f=>f(f===from));

  btn.addEventListener("click",()=>{
    /* ⚠**모드를 바꾸면 펼침을 되돌린다** — 규정 모드에는 숨긴 행이 없으므로
       그 상태를 들고 돌아오면 「눌러 놓은 적 없는 버튼이 눌려 있는」 화면이 된다 */
    expanded=false;
    state.rankAll[id]=state.rankAll[id]!==true;save(state);refresh(null);
  });
  /* ⚠**이 사본만 펼친다.** 같은 지표가 여러 벌 그려지지만(리그·역할), 펼침은
     「지금 보고 있는 표를 더 본다」는 뜻이라 다른 사본까지 무겁게 만들 이유가 없다 —
     저장하는 상태(모드·하한)와 성질이 다르다 */
  if(moreBtn)moreBtn.addEventListener("click",()=>{
    expanded=!expanded;
    if(expanded&&restRows===null&&!restLoading){
      restLoading=true;
      const url=moreBtn.dataset.rankrest;
      moreBtn.textContent="読み込み中…";
      fetch(url).then(r=>r.json()).then(j=>{
        restRows=j[id]||[];
        restLoading=false;apply(false);
      }).catch(()=>{
        /* ⚠**못 받았으면 그렇게 말한다** — 조용히 닫으면 「눌러도 아무 일이 없다」가 된다 */
        restLoading=false;expanded=false;
        moreBtn.textContent="読み込めませんでした";
      });
      return;
    }
    apply(false);
  });
  if(minBox)minBox.addEventListener("input",()=>{
    const got=rankMinRead(minBox.value,asOuts);
    bad=!got.ok;
    /* ⚠**펼친 행도 같은 하한을 받는다** — 표의 행만 걸러지면 「300타석 이상」인데
       그 아래 선수가 펼친 자리에 남는다. apply() 가 끝에서 다시 그리므로 여기서는 안 부른다
       (예전에는 setTimeout 으로 따로 불렀다 — 경로가 둘이면 하나만 고쳐지는 날이 온다). */
    /* 못 읽은 값이면 **직전에 먹던 하한을 그대로 둔다.** 0으로 되돌리면 표가 갑자기 넓어져
       「값이 먹었다」로 보인다 — 그것이 침묵 오류의 모양이다 */
    if(got.ok){state.rankMin[id]=got.value;save(state)}
    refresh(apply);
  });
  apply(false);
});

/* ── 검색어 접기 ──
   ⚠**이 함수는 한 벌뿐이다**(M1). 색인의 읽는 법과 질의어를 **같은 규칙으로** 접어야
   맞는데, 빌드 쪽에도 한 벌 두면 어느 날 한쪽만 고쳐지고 검색이 조용히 안 맞는다.
   그래서 색인은 원문을 싣고 접기는 여기서만 한다.

   1) 소문자로 — 외국인 선수의 라틴 표기가 (LUKE VOIT) 처럼 대문자다
   2) 카타카나 → 히라가나 — IME 로 「ぼいと」까지 친 상태에서도 「ボイト」가 잡혀야 한다.
      실측으로 읽는 법 858명 중 **121명이 카타카나**(외국인 선수)라, 접지 않으면
      그 121명은 히라가나 입력으로 영영 안 나온다.
      ⚠장음 기호 U+30FC 는 옮기지 않는다 — 히라가나 표기에서도 그대로 쓴다.
      범위를 30A1〜30F6 으로 끊는 이유가 그것이다. */
function fold(s){
  var out="",i,c;
  s=String(s).toLowerCase();
  for(i=0;i<s.length;i++){
    c=s.charCodeAt(i);
    out+=(c>=0x30a1&&c<=0x30f6)?String.fromCharCode(c-0x60):s.charAt(i);
  }
  return out;
}

/* ── 선수 색인 ── 한 번 받아서 헤더 검색과 색인 화면이 함께 쓴다 */
let INDEX=null,indexError=false,fetching=false;
const waiting=[];
function withIndex(fn){if(INDEX)fn(INDEX);else if(indexError)fn(null);else waiting.push(fn)}
function fetchIndex(){
  // ⚠**한 번만 받는다.** 검색창에 포커스할 때마다 받으면 같은 파일을 몇 번이고 내려받는다
  if(INDEX||indexError||fetching)return;
  if(typeof fetch!=="function"){indexError=true;return}
  fetching=true;
  fetch(BASE+"players.json").then(r=>r.json()).then(j=>{
    /* 접은 읽는 법을 **한 번만** 만들어 둔다 — 키 입력마다 980행을 접을 이유가 없다 */
    for(var i=0;i<j.length;i++)if(j[i].k)j[i].kf=fold(j[i].k);
    INDEX=j;fetching=false;waiting.splice(0).forEach(f=>f(j));
  }).catch(()=>{
    indexError=true;fetching=false;waiting.splice(0).forEach(f=>f(null));
  });
}

/* 드롭다운에 그리는 최대 인원.
   ⚠**여기서 자른다는 사실을 화면이 말해야 한다**(작업규칙 7 · M2). 잘라 놓고 잠자코 있으면
   「그 선수는 이 사이트에 없다」로 읽힌다 — 순위표는 「이 지표로 기록이 있는 선수 256人」까지
   말하는데 **가장 많이 쓰는 조작에만** 그 규율이 없었다(2026-08-19 감사 P1).
   실측(색인 698명): 「田」 81건 · 「中」 86건 · 「山」 48건이 전부 20건으로 보였다. */
const SEARCH_LIMIT=20;

/* 결과 수를 **소리로** 낼 때 모으는 시간(ms).
   ⚠미루는 것은 **낭독뿐**이다 — 목록은 키를 칠 때마다 즉시 다시 그린다.
   창 크기 디바운스와 같은 값을 쓴다(이 파일 위쪽 150ms). */
const SAY_DELAY=150;

/* ── 선수 고르기 ──
   헤더 검색과 「対戦を選ぶ」 화면이 **같은 구현**을 쓴다. 두 벌로 나누면 키보드 조작이
   한쪽에만 붙는 식으로 어긋난다. */
function attachPicker(input,list,onPick){
  if(!input||!list)return null;
  /* 결과 수를 **소리로** 내는 자리. 서버가 미리 그려 둔다(라이브 영역은 갱신 전에 DOM 에 있어야 읽힌다).
     ⚠**목록 자체를 라이브로 만들지 않는다** — 키를 칠 때마다 스무 명을 통째로 읽는다. */
  const status=list.parentNode?$("[data-hitstatus]",list.parentNode):null;
  /* ⚠**한 글자마다 낭독하지 않는다**(2026-08-21 최종 검토 P3).
     role=status 는 폴라이트 라이브 영역이라 **인원수가 바뀔 때마다 낭독이 쌓인다** —
     IME 로 「たなか」를 치는 구간이 그렇다(화살표 이동은 문구가 안 바뀌어 원래 조용하다).
     SAY_DELAY 만 모으고, **화면은 안 미룬다** — 미루면 조작감이 바뀐다.
     ⚠**닫을 때는 미룬 것을 버리고 즉시 지운다** — 닫힌 목록의 인원이 뒤늦게 들리면 더 나쁘다. */
  let sayTimer=null,sayWanted=null;
  const sayApply=(text)=>{sayWanted=null;if(status&&status.textContent!==text)status.textContent=text};
  const sayStop=()=>{if(sayTimer!==null){clearTimeout(sayTimer);sayTimer=null}};
  const say=(text)=>{
    if(!status)return;
    /* 이미 그 말을 하고 있거나 하려던 참이면 아무것도 하지 않는다 — 같은 문구의 재낭독을 막는다 */
    if(sayWanted===null?status.textContent===text:sayWanted===text)return;
    sayWanted=text;sayStop();
    sayTimer=setTimeout(()=>{sayTimer=null;sayApply(text)},SAY_DELAY);
  };
  /* 미룬 것을 버리고 지금 말한다 */
  const sayAtOnce=(text)=>{sayStop();sayApply(text)};
  /* hits = **자르기 전** 일치 수 · asked = 그 수를 낸 질의어(「一覧」으로 넘길 때 쓴다) */
  let rows=[],active=-1,hits=0,asked="";
  /* ⚠**닫을 때 소리도 지운다** — 닫힌 목록의 인원을 낭독기가 계속 들고 있으면
     다음에 같은 수가 나왔을 때 아무 말도 안 하게 된다 */
  const close=()=>{list.hidden=true;sayAtOnce("");active=-1};
  /* @param items 배열이면 결과, **null 이면 아직 읽는 중**이다 */
  const draw=(items,failed)=>{
    list.textContent="";
    const one=(text)=>{const li=doc.createElement("li");li.className="none";li.textContent=text;list.appendChild(li);say(text)};
    if(failed)one("選手一覧を読み込めませんでした。再読み込みしてください。");
    /* ⚠**「읽는 중」과 「없음」은 다르다**(M12의 4상태). 실패와 0건에는 문구가 있는데
       로딩만 없어서, 느린 회선에서는 목록이 안 뜨는 동안 「검색이 고장났다」로 읽힌다 */
    else if(items===null)one("読み込み中…");
    else if(!items.length)one("該当なし");
    else (items||[]).forEach((p,i)=>{
      const li=doc.createElement("li");
      /* ⚠**롤도 aria-selected 도 주지 않는다**(2026-08-20). 이 목록은 listbox 가 아니고
         (섞여 있는 안내줄에 롤을 붙였다가 그 안의 링크가 안 눌렸다 · 아래 꼬리줄 참조),
         listbox 가 아닌 곳의 option 은 낭독기에 **깨진 구조**로 들린다.
         ⚠**화살표가 고른 자리는 우리 클래스로 표시한다** — 표시까지 없애면 화면이 안 움직여
         「키보드가 안 먹는다」가 된다. aria-activedescendant 는 예전에도 없었으므로
         낭독기가 화살표를 따라오던 적은 애초에 없다(잃는 것이 없다).
         ⚠이 주석에 역따옴표를 쓰지 마라 — 이 파일은 통째로 템플릿 리터럴이라 거기서 끊긴다 */
      if(i===active)li.className="on";
      const a=doc.createElement("a");a.href=BASE+"players/"+p.i+".html";
      /* 등번호. ⚠**없으면 자리도 만들지 않는다** — 「―」를 넣으면 은퇴 선수 198명 줄이
         전부 같은 기호로 채워져 시선만 먹는다(M11) */
      if(p.u){const u=doc.createElement("span");u.className="hu";u.textContent=p.u;a.appendChild(u)}
      const n=doc.createElement("span");n.className="hn";n.textContent=p.n;
      const t=doc.createElement("span");t.className="ht";t.textContent=p.t;
      a.appendChild(n);a.appendChild(t);
      /* 성적 한 줄. **없으면 자리도 만들지 않는다** — 빈 줄은 「0」처럼 읽힌다(M11).
         선수명과 같은 이유로 textContent 로만 넣는다 */
      if(p.s){const sm=doc.createElement("span");sm.className="hs";sm.textContent=p.s;a.appendChild(sm)}
      li.appendChild(a);
      if(onPick)a.addEventListener("click",(e)=>{if(e&&e.preventDefault)e.preventDefault();onPick(p);close()});
      list.appendChild(li);
    });
    /* ⚠**자른 것을 말한다.** 20건에서 조용히 끊으면 21번째 선수는 「없는 사람」이 된다 —
       §0-1(3클릭 이내 도달)의 주 경로가 침묵으로 실패하는 것이라 이 화면에서 제일 나쁜 결함이다.
       ⚠**갈래를 나눈다**: 헤더 검색은 「이동」이라 選手一覧으로 보내도 잃는 것이 없지만,
       「対戦を選ぶ」·「比較」의 검색창은 **고르는 중**이라 페이지를 떠나면 반대쪽 선택이 날아간다.
       ⚠**role 을 주지 않는다 — 「該当なし」·「読み込み中…」과 같은 자리다.**
       처음에 role="option" aria-disabled="true" 로 만들었다가 **실기에서 잡혔다**(Playwright):
       그 안의 링크가 「disabled」로 판정돼 눌리지 않는 상태가 됐다 —
       **「여기로 가라」고 써 놓고 「이건 못 쓴다」고 말하는** 자기모순이었다.
       ⚠**여기 있던 「남는 한계」는 2026-08-20 에 해소됐다**(그래서 지웠다).
       그때는 목록이 listbox 였고, 포커스 모드의 낭독기는 listbox 안의 롤 없는 항목을 읽지 않아
       이 줄이 화면으로만 전해졌다. 지금은 **목록을 listbox 라고 부르지 않으므로**
       이 줄도 「該当なし」도 그냥 목록 항목이고 전부 읽힌다.
       ⚠rows 에는 넣지 않는다 — 화살표 이동이 마지막 선수에서 멈춘다. */
    if(items&&items.length&&hits>items.length){
      const li=doc.createElement("li");
      li.className="more";
      const text=hits+"人中"+items.length+"人を表示";
      /* ⚠**소리로도 자른 사실을 말한다** — 화면에만 적으면 낭독기 사용자에게는
         21번째 선수가 여전히 「없는 사람」이다 */
      say(text);
      if(onPick){
        const s=doc.createElement("span");
        s.textContent=text+" — 文字を足すとしぼれます";
        li.appendChild(s);
      }else{
        const a=doc.createElement("a");
        /* ⚠**JS 가 죽어 있어도 참인 문구를 쓴다**(§0-1). 選手一覧은 서버가 전원을 그려 두므로
           「すべて見る」는 어느 쪽이든 맞다 — 좁혀진 상태로 열리는 것은 JS 가 살아 있을 때의 덤이다 */
        a.href=BASE+"players.html?q="+encodeURIComponent(asked);
        a.textContent=text+" — 選手一覧ですべて見る";
        li.appendChild(a);
      }
      list.appendChild(li);
    }else if(items&&items.length)say(items.length+"人");
    list.hidden=false;
  };
  const run=()=>{
    const term=input.value.trim();
    if(term===""){close();return}
    /* 인덱스가 아직 안 왔으면 **그렇다고 말하고** 기다린다 — 잠자코 있지 않는다 */
    if(!INDEX&&!indexError)draw(null,false);
    withIndex(idx=>{
      if(input.value.trim()!==term)return;
      if(!idx){draw([],true);return}
      /* ⚠**등번호는 완전일치다.** 부분일치로 두면 「1」이 1·10〜19·100번대를 전부 끌고 와
         이름 검색 결과를 밀어낸다. 「34」로 34번을 찾는 것이 이 기능의 전부다 */
      var q=fold(term);
      var all=idx.filter(p=>p.n.indexOf(term)>=0||p.t.indexOf(term)>=0
        ||(p.kf&&p.kf.indexOf(q)>=0)||p.u===term);
      /* ⚠**자르기 전에 센다.** 자른 뒤에 세면 언제나 20이 되어 「81人中」이 「20人中」이 된다 */
      hits=all.length;asked=term;
      rows=all.slice(0,SEARCH_LIMIT);
      active=-1;draw(rows,false);
    });
  };
  input.addEventListener("input",run);
  input.addEventListener("focus",()=>{fetchIndex();if(input.value.trim()!=="")run()});
  input.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){close();return}
    if(list.hidden||!rows.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      if(e.preventDefault)e.preventDefault();
      active=e.key==="ArrowDown"?Math.min(active+1,rows.length-1):Math.max(active-1,0);
      draw(rows,false);
      /* ⚠**고른 것을 소리로도 말한다**(2026-08-22 감사 #18). 여기까지는 화살표를 눌러도
         낭독기에 아무 말도 안 갔다 — 화면만 움직이면 눈으로 보는 사람에게만 검색이 있는 것이다.
         ⚠**몇 번째인지 함께 말한다** — 이름만 읽으면 목록의 어디쯤인지 알 수 없다.
         draw 가 방금 인원수를 예약했지만 say 가 마지막 것만 남기므로 겹치지 않는다 */
      const sel=rows[active];
      if(sel)say((active+1)+"人目 "+sel.n+" "+sel.t);
    }else if(e.key==="Enter"&&active>=0){
      if(e.preventDefault)e.preventDefault();
      if(onPick)onPick(rows[active]);else go(BASE+"players/"+rows[active].i+".html");
      close();
    }
  });
  doc.addEventListener("click",(e)=>{
    let n=e&&e.target;
    while(n){if(n===input||n===list)return;n=n.parentNode}
    close();
  });
  return {run:run,close:close};
}
attachPicker($("#q"),$("#qhits"),null);

/* ── 対戦を選ぶ ──
   ⚠**라이브 데이터를 취득하지 않는다.** 경기를 보는 사람은 지금 누가 던지고 누가 치는지
   이미 알고 있다 — 그 사실을 우리가 가져올 이유가 없다.
   근거: docs/decisions/2026-08-15-live-matchup-feasibility.md */
const pickForm=$("#pickForm");
if(pickForm){
  const chosen={pitcher:null,batter:null};
  const show=(side,p)=>{
    chosen[side]=p;
    const label=$("#pick-"+side+"-chosen");
    if(label)label.textContent=p?p.n+"（"+p.t+"）":"未選択";
    const go2=$("#pickGo");
    if(go2)go2.disabled=!(chosen.pitcher&&chosen.batter);
  };
  /* 빠른 선택 버튼의 눌림 상태. **목록을 연 동안** 고른 것이 목록 안에서도 보여야 한다 —
     스크롤한 뒤 무엇을 눌렀는지 알 수 없어지기 때문이다.
     ⚠**접혀 있는 동안은 이 표시가 안 보인다**(2026-08-17 기본 접힘이 되면서).
     그때 고른 것을 말하는 것은 위의 pickbar(그리고 비교 화면의 #cmp-a-chosen)뿐이고,
     그쪽은 sticky 라 화면에서 사라지지 않는다 — 정보가 없어지는 것은 아니다. */
  const mark=(side)=>{
    const id=chosen[side]?chosen[side].i:null;
    $$('#pickToday [data-pick="'+side+'"]').forEach(b=>{
      b.setAttribute("aria-pressed",String(id!==null&&b.dataset.i===id));
    });
  };
  const setSide=(side,p)=>{
    const i=$(side==="pitcher"?"#pickPitcher":"#pickBatter");
    if(i)i.value=p.n;
    show(side,p);mark(side);
  };
  attachPicker($("#pickPitcher"),$("#pickPitcherHits"),(p)=>setSide("pitcher",p));
  attachPicker($("#pickBatter"),$("#pickBatterHits"),(p)=>setSide("batter",p));
  /* 오늘 대전하는 두 팀에서 바로 고르기. 값의 모양은 검색 색인과 같아서 이후가 하나로 이어진다 */
  $$("#pickToday [data-pick]").forEach(b=>b.addEventListener("click",()=>{
    const side=b.dataset.pick;
    /* 같은 것을 다시 누르면 해제한다 — 잘못 눌렀을 때 되돌릴 길이 없으면 안 된다 */
    if(chosen[side]&&chosen[side].i===b.dataset.i){
      const i=$(side==="pitcher"?"#pickPitcher":"#pickBatter");
      if(i)i.value="";
      show(side,null);mark(side);
      return;
    }
    setSide(side,{i:b.dataset.i,n:b.dataset.n,t:b.dataset.t});
  }));
  const go2=$("#pickGo");
  if(go2)go2.addEventListener("click",()=>{
    if(!chosen.pitcher||!chosen.batter)return;
    // 타자 페이지에서 보는 것을 기본으로 한다 — 「이 타자가 이 투수에게」가 보통 찾는 방향이다
    go(BASE+"players/"+chosen.batter.i+".html?vs="+encodeURIComponent(chosen.pitcher.i)+"#b-matchup");
  });
}

/* ── 긴 선택 목록의 키보드 이동 ──
   ⚠**버튼 100개짜리 목록을 탭으로 하나씩 지나가게 두지 않는다.**
   한 팀에 투수 30명·타자 40명이 실제로 나오므로, 그대로 두면 이 화면을 키보드로 빠져나가는 데만
   탭을 140번 눌러야 한다. 목록 하나가 탭 정지 하나가 되고 안에서는 화살표로 움직인다.
   ⚠**tabindex를 서버가 아니라 여기서 준다** — JS가 없으면 화살표도 없으니
   그때는 전부 탭으로 닿는 편이 맞다.

   ⚠**이 처리는 pickForm 블록 밖에 있어야 한다.** 안에 두면 対戦 화면에서만 돌고,
   같은 부품(pickTeam)을 쓰는 비교 화면은 **탭 정지 129개에 화살표가 안 먹는** 채로 남는다 —
   그런데 aria-label 은 「左右キーで移動」라고 읽어 준다. 라벨이 거짓말을 하게 된다.
   (2026-08-16 이중 검토에서 잡혔고, 셀렉터만 넓히는 첫 수정은 이 위치 때문에 듣지 않았다.) */
$$(".picklist").forEach(list=>{
  const items=$$("[data-pick]",list);
  if(items.length===0)return;
  const rove=(el)=>{items.forEach(b=>b.setAttribute("tabindex",b===el?"0":"-1"))};
  rove(items[0]);
  items.forEach((b,at)=>{
    b.addEventListener("click",()=>rove(b));
    b.addEventListener("keydown",(e)=>{
      const step=e.key==="ArrowRight"||e.key==="ArrowDown"?at+1
        :e.key==="ArrowLeft"||e.key==="ArrowUp"?at-1
        :e.key==="Home"?0:e.key==="End"?items.length-1:null;
      if(step===null)return;
      const to=items[(step+items.length)%items.length];
      e.preventDefault();rove(to);if(to.focus)to.focus();
    });
  });
});

/* ── 選手をくらべる ──
   ⚠**여기서 지표를 계산하지 않는다**(M1). 서버가 이미 계산·반올림·등급 판정을 끝낸
   문자열을 받아 배치만 한다. 판정 근거(dir·min·s)도 전부 서버가 실어 보낸다 —
   기준이 두 곳에 있으면 언젠가 한쪽만 고쳐진다. 규칙의 출처는 src/compare.ts. */
const cmpForm=$("#cmpForm");
if(cmpForm){
  const out=$("#cmpOut");
  const chosen={a:null,b:null};
  /* ⚠**프로토타입 없는 지도를 쓴다.** 예전에는 우리가 넘긴 id 하나만 키였는데,
     이제 **샤드 JSON 의 키를 그대로 대입**한다. 키가 __proto__ 면 own 프로퍼티가 아니라
     프로토타입 설정이 되어, 이후 조회가 카드 대신 Object.prototype(truthy)을 돌려준다.
     현재 ID 는 8자리 숫자라 0건이지만, ID 검사 정규식은 그 이름을 허용한다 */
  const cache=Object.create(null);
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;
    if(text!==undefined&&text!==null)n.textContent=text;return n};

  const label=(side)=>$("#cmp-"+side+"-chosen");
  const show=(side,p)=>{
    chosen[side]=p;
    const l=label(side);
    if(l)l.textContent=p?p.n+"（"+p.t+"）":"未選択";
    const g=$("#cmpGo"),s=$("#cmpSwap");
    const both=!!(chosen.a&&chosen.b);
    if(g)g.disabled=!both;
    if(s)s.disabled=!both;
    markCmp();
  };
  const setInput=(side,p)=>{const i=$("#cmp"+side.toUpperCase());if(i)i.value=p?p.n:""};

  /* ⚠**선택이 바뀌는 곳은 셋인데(직접 고르기·入れかえ·공유 링크 복원) 다시 그리는 곳이
     하나뿐이었다.** 그래서 화면과 동작이 반대로 읽혔다 — 버튼은 「안 눌림」인데 누르면 해제됐다.
     show 가 chosen 을 바꾸는 유일한 함수이므로 **거기서** 다시 그린다.
     함수 선언으로 두는 것은 show 보다 뒤에 있어도 되게 하기 위해서다(호이스팅) */
  function markCmp(){
    $$("#cmpToday [data-pick]").forEach(b=>{
      const id=b.dataset.i;
      const at=(chosen.a&&chosen.a.i===id)?"A":(chosen.b&&chosen.b.i===id)?"B":"";
      b.setAttribute("aria-pressed",String(at!==""));
      /* **어느 쪽에 들어갔는지**를 버튼이 말한다 — 두 자리를 채우는 화면이라 「눌렀다」만으로는 부족하다 */
      if(at==="")b.removeAttribute("data-slot");else b.setAttribute("data-slot",at);
    });
  }
  const setCmp=(side,p)=>{setInput(side,p);show(side,p)};
  attachPicker($("#cmpA"),$("#cmpAHits"),(p)=>setCmp("a",p));
  attachPicker($("#cmpB"),$("#cmpBHits"),(p)=>setCmp("b",p));
  /* 오늘 대전하는 두 팀에서 바로 고르기. **누른 순서대로 A → B에 들어간다** —
     어느 자리에 넣을지 먼저 묻는 화면으로 만들면 조작이 한 단계 늘어난다 */
  $$("#cmpToday [data-pick]").forEach(b=>b.addEventListener("click",()=>{
    const p={i:b.dataset.i,n:b.dataset.n,t:b.dataset.t};
    /* 이미 고른 사람을 다시 누르면 그 자리를 비운다 — 되돌릴 길이 없으면 안 된다 */
    if(chosen.a&&chosen.a.i===p.i){setCmp("a",null);return}
    if(chosen.b&&chosen.b.i===p.i){setCmp("b",null);return}
    setCmp(chosen.a?"b":"a",p);
  }));

  /* 값 하나를 그린다. ⚠등급 막대는 **값 뒤**에 온다 — 분모를 모르고 본 색은 근거가 없다.
     ⚠**세 번째 인자는 「이겼는가」가 아니라 「이긴 사람의 이름」이다**(2026-09-08 1차 검토).
     굵기와 삼각형은 낭독기에 안 들려서, 두 값은 들리는데 **어느 쪽이 위인지가 안 들렸다** —
     색만으로 상태를 말하지 않는다는 규칙의 같은 얼굴이다.
     ⚠**이름을 쓴다.** 「こちらが上」은 선형으로 읽히면 무엇을 가리키는지 사라진다.
     ⚠**행마다 되풀이되는 것을 감수한다** — 낭독기 사용자는 행 단위로 훑고, 행 하나로 뜻이 서야 한다.
     ⚠**동명이인이면 이름만으로는 안 갈린다**(M10) — 그건 머리의 두 이름도 마찬가지라 이 자리에서
     새로 생기는 문제가 아니다. 고칠 자리는 여기가 아니라 **카드의 이름 표기**다.
     ⚠**보이는 삼각형은 그대로 둔다** — CSS 가 그 글리프에 빈 대체텍스트를 붙인다(그쪽 주석 참조). */
  const cell=(st,cls,winner)=>{
    const d=el("div",cls+(winner?" win":""));
    d.appendChild(doc.createTextNode(st&&st.v!==null?st.v:"—"));
    if(st&&st.g){const g=el("i","g g-"+st.g);g.setAttribute("aria-hidden","true");d.appendChild(g)}
    if(st&&st.d)d.appendChild(el("span","den",st.d));
    if(winner)d.appendChild(el("span","vh",winner+"が上"));
    return d;
  };

  /* ⚠**src/compare.ts의 betterSide와 같은 규칙.** 판정에 쓰는 값은 전부 서버가 보낸 것이라
     기준 자체(등급 척도·최소 표본)는 grade.ts 한 곳에서 나온다. */
  const better=(a,b)=>{
    if(!a||!b)return"";
    if(a.dir===0||a.min===null)return"";
    if(a.n===null||b.n===null)return"";
    /* ⚠각자 **자기** 기준으로 잰다. b에게 a의 최소 표본을 대면 선발↔구원 비교에서
       「入れかえ」 한 번에 판정이 뒤집힌다 */
    if(b.min===null)return"";
    if(a.s<a.min||b.s<b.min)return"";
    if(a.n===b.n)return"";
    return (a.dir===1?a.n>b.n:a.n<b.n)?"a":"b";
  };

  /* 겹친 紋. 좌표는 서버가 계산했다 — 여기서 다시 계산하면 도형이 두 벌이 된다 */
  const figure=(A,B)=>{
    if(!A.mark||!B.mark)return null;
    if(A.mark.labels.length!==B.mark.labels.length)return null;
    const box=el("div","cmpfig");
    const NS="http://www.w3.org/2000/svg";
    const svg=doc.createElementNS(NS,"svg");
    svg.setAttribute("viewBox","0 0 "+A.mark.size+" "+A.mark.size);
    svg.setAttribute("role","img");
    svg.setAttribute("aria-label",A.name+"と"+B.name+"の成績プロフィールの重ね合わせ。"+
      A.mark.labels.map(l=>l.text+" "+A.name+" "+l.value+"、"+B.name+" "+
        (B.mark.labels.filter(x=>x.text===l.text)[0]||{value:"—"}).value).join("。"));
    /* ⚠**선 색은 여기서 얹지 않는다** — CSS 의 .cf-a / .cf-b 가 토큰으로 갖는다.
       예전에는 stroke 도 구단 색으로 칠했고, 그래서 다크에서 두 도형이 바탕에 묻혔다
       (--panel 기준 1.08 / 1.10 · 두 도형끼리 1.02). 살만 구단 색으로 남긴다. */
    const poly=(pts,cls,color)=>{
      const p=doc.createElementNS(NS,"polygon");
      p.setAttribute("points",pts);p.setAttribute("class",cls);
      if(color)p.setAttribute("fill",color);
      return p;
    };
    svg.appendChild(poly(A.mark.outline,"mf-grid"));
    svg.appendChild(poly(A.mark.shape,"cf-a",A.color.base));
    svg.appendChild(poly(B.mark.shape,"cf-b",B.color.base));
    A.mark.labels.forEach(l=>{
      const t=doc.createElementNS(NS,"text");
      t.setAttribute("x",String(l.x));t.setAttribute("y",String(l.y));
      t.setAttribute("text-anchor",l.anchor);t.setAttribute("dominant-baseline","middle");
      t.setAttribute("class","mf-lab");t.textContent=l.text;
      svg.appendChild(t);
    });
    box.appendChild(svg);
    const key=el("p","cmpkey");
    /* ⚠**범례 선도 구단 색을 안 쓴다** — 도형과 같은 토큰이어야 범례가 범례 노릇을 한다 */
    const one=(cls,name)=>{const s=el("span",cls);s.appendChild(el("i"));
      s.appendChild(doc.createTextNode(name));return s};
    key.appendChild(one("ka",A.name));
    key.appendChild(one("kb",B.name));
    box.appendChild(key);
    return box;
  };

  const warn=(text)=>{const p=el("p","cmpwarn");p.textContent=text;return p};

  const render=(A,B)=>{
    out.textContent="";
    const wrap=el("section","cmpwrap");

    /* ⚠**타자와 투수는 나란히 놓지 않는다.** 공통 지표가 없어 전부 「—」인 표가 되고,
       그건 답이 아니라 고장으로 보인다 */
    if(A.role!==B.role){
      wrap.appendChild(warn("打者と投手は共通の指標がないため並べられません。"+
        "打者どうし、または投手どうしを選んでください。（"+A.name+"＝"+
        (A.role==="batter"?"打者":"投手")+"／"+B.name+"＝"+(B.role==="batter"?"打者":"投手")+"）"));
      /* ⚠**되돌려보내면서 길을 알려준다.** 이 조합이야말로 답이 있는 조합이다 —
         투수 대 타자를 다루는 화면이 이미 있는데, 지금까지는 거절만 하고 끝났다 */
      const bat=A.role==="batter"?A:B, pit=A.role==="batter"?B:A;
      const go=doc.createElement("a");
      go.className="cmpgo";
      go.href=BASE+"players/"+bat.id+".html?vs="+encodeURIComponent(pit.id)+"#b-matchup";
      go.textContent="この二人の対戦成績を見る";
      wrap.appendChild(go);
      out.appendChild(wrap);return;
    }

    const head=el("div","cmphead");
    [A,B].forEach(p=>{
      const w=el("div","cmpwho");w.style.setProperty("--who",p.color.base);
      const nm=el("span","nm");
      const a=doc.createElement("a");a.href=BASE+"players/"+p.id+".html";a.textContent=p.name;
      nm.appendChild(a);w.appendChild(nm);
      w.appendChild(el("span","sub",p.teamName+"　"+(p.position||"")));
      w.appendChild(el("span","smp",p.sample));
      head.appendChild(w);
    });
    wrap.appendChild(head);

    /* ⚠**잣대가 다르면 먼저 말한다.** 선발 3.20은 중위권이고 구원 3.20은 하위권이다 */
    if(A.group!==B.group){
      const nm={batter:"打者",starter:"先発",reliever:"救援"};
      wrap.appendChild(warn("役割が違う二人です（"+A.name+"＝"+nm[A.group]+"、"+B.name+"＝"+nm[B.group]+
        "）。先発と救援は防御率などの分布そのものが違うため、色は「それぞれの役割の中での位置」を表します。"+
        "数字の大小をそのまま優劣として読まないでください。"));
    }

    const fig=figure(A,B);
    if(fig)wrap.appendChild(fig);

    const byKey={};B.stats.forEach(s=>{byKey[s.k]=s});
    let judged=0;
    A.stats.forEach(sa=>{
      const sb=byKey[sa.k];
      const w=better(sa,sb);
      if(w)judged++;
      const row=el("div","cmprow");
      row.appendChild(cell(sa,"va",w==="a"?A.name:null));
      const lb=el("span","lb");
      /* 용어집 툴팁을 그대로 태운다 — 설명을 여기서 새로 쓰지 않는다(M1).
         ⚠**진짜 버튼으로 만든다.** 그래야 터치로도 열리고 키보드에도 잡힌다 */
      if(GLOSSARY[sa.k]){
        const t=doc.createElement("button");t.type="button";t.className="term";
        t.setAttribute("data-term",sa.k);t.setAttribute("aria-describedby","tip");
        t.textContent=sa.l;lb.appendChild(t);
      }else lb.appendChild(doc.createTextNode(sa.l));
      row.appendChild(lb);
      row.appendChild(cell(sb,"vb",w==="b"?B.name:null));
      wrap.appendChild(row);
    });

    if(judged===0){
      wrap.appendChild(warn("どちらが上かの印はついていません。"+
        "母数が色づけの最低ラインに届いていないか、優劣を言えない指標だけが並んでいます。"));
    }
    out.appendChild(wrap);
    if(typeof bindTerms==="function")bindTerms(wrap);
  };

  /* 받아 둔 샤드의 약속. ⚠**실패한 것은 지운다** — 남겨 두면 다시 눌러도 영영 같은 오류가 난다 */
  const shards={};
  /* ⚠**샤드 규칙은 서버(compare.ts 의 compareShardOf)와 같아야 한다 — 선수 ID의 첫 글자다.**
     빌드가 파일을 놓고 여기가 찾으므로 규칙이 두 벌일 수밖에 없다(M1이 경계하는 모양).
     그래서 해시가 아니라 **틀릴 수 없을 만큼 단순한 규칙**을 쓴다.
     assets-source.test.ts 가 이 줄이 사라지지 않았는지 글자로 확인한다. */
  const shardOf=(id)=>String(id).charAt(0);
  const load=(id)=>{
    if(cache[id])return Promise.resolve(cache[id]);
    if(typeof fetch!=="function")return Promise.reject(new Error("no fetch"));
    const s=shardOf(id);
    if(!shards[s]){
      shards[s]=fetch(BASE+"compare/"+s+".json").then(r=>{
        if(!r.ok)throw new Error("http "+r.status);
        return r.json();
      }).then(j=>{
        /* 한 번 받으면 그 샤드의 선수 전부가 캐시된다 — 같은 글자끼리는 두 번째부터 요청 0 */
        for(const k in j)cache[k]=j[k];
        return j;
      }).catch(e=>{delete shards[s];throw e});
    }
    return shards[s].then(j=>{
      /* ⚠**샤드는 받았는데 그 선수가 없는 경우를 조용히 넘기지 않는다** —
         빈 카드로 그리면 「성적 0」처럼 보인다(M11).
         ⚠**「못 받았다」와 구별해서 표시한다**(M12). 이건 통신 문제가 아니라
         **화면과 데이터의 판이 어긋난 것**(배포 스큐 · 샤드 규칙 갈림)이라,
         「통신을 확인하고 다시」라고 말하면 사용자가 영영 낫지 않는 행동을 반복한다 —
         샤드는 이미 성공 캐시라 다시 눌러도 요청조차 안 나간다. */
      if(!j[id]){
        const e=new Error("no card "+id);
        e.kind="nocard";
        throw e;
      }
      return j[id];
    });
  };

  /* 비교 요청의 세대. 마지막으로 누른 것만 그린다 */
  let cmpGen=0;
  const run=()=>{
    if(!chosen.a||!chosen.b||!out)return;
    out.textContent="";
    const wait=el("section","cmpwrap");wait.appendChild(el("p","empty","読み込んでいます…"));
    out.appendChild(wait);
    /* ⚠**늦게 온 응답이 새 비교를 덮어쓰지 않게 한다.**
       샤드로 묶은 뒤로 「이미 받은 샤드는 즉시 · 새 샤드는 왕복」이라는 **지연 비대칭**이 생겼다.
       그래서 A를 누르고 곧바로 B를 누르면 B가 먼저 그려진 뒤 A가 늦게 도착해 화면을 되돌린다 —
       사용자가 마지막에 고른 것과 다른 것이 보이는 상태다. 세대 번호로 낡은 응답을 버린다. */
    const mine=++cmpGen;
    Promise.all([load(chosen.a.i),load(chosen.b.i)]).then(r=>{
      if(mine!==cmpGen)return;
      render(r[0],r[1]);
    }).catch((err)=>{
      if(mine!==cmpGen)return;
      /* ⚠**삼키지 않는다.** 배포 스큐는 화면 문구 말고는 남는 흔적이 없다 */
      if(typeof console!=="undefined"&&console.error)console.error("compare:",err);
      out.textContent="";
      const e=el("section","cmpwrap");
      /* ⚠**빈 화면으로 두지 않는다**(M12) — 「데이터 없음」과 「읽지 못함」은 다른 상태다.
         ⚠그리고 그 둘을 **같은 문구로 뭉개지 않는다** — 시키는 행동이 다르다 */
      e.appendChild(warn(err&&err.kind==="nocard"
        ? "この選手の比較データが見つかりませんでした。データの更新中かもしれません。"+
          "しばらくしてからページを再読み込みしてください。"
        : "成績を読み込めませんでした。通信を確認して、もう一度お試しください。"));
      out.appendChild(e);
    });
    /* 공유할 수 있는 주소로 바꾼다. **뒤로가기 이력을 더럽히지 않는다** — 비교는 이동이 아니다 */
    if(typeof history!=="undefined"&&history.replaceState){
      try{history.replaceState(null,"","?a="+encodeURIComponent(chosen.a.i)+"&b="+encodeURIComponent(chosen.b.i))}catch(e){}
    }
  };

  const goBtn=$("#cmpGo");
  if(goBtn)goBtn.addEventListener("click",run);
  const swap=$("#cmpSwap");
  if(swap)swap.addEventListener("click",()=>{
    const t=chosen.a;setInput("a",chosen.b);setInput("b",t);
    const bb=chosen.b;show("a",bb);show("b",t);
    if(out&&out.firstChild)run();
  });

  /* URL로 들어온 두 사람을 되살린다 — 공유한 링크가 같은 화면을 열어야 한다 */
  const qs=(name)=>{
    const m=new RegExp("[?&]"+name+"=([^&]*)").exec(LOC.search||"");
    return m?decodeURIComponent(m[1]):"";
  };
  const ia=qs("a"),ib=qs("b");
  if(ia&&ib){
    withIndex(idx=>{
      if(!idx)return;
      const find=(id)=>idx.filter(p=>p.i===id)[0]||null;
      const pa=find(ia),pb=find(ib);
      if(!pa||!pb)return;
      setInput("a",pa);show("a",pa);setInput("b",pb);show("b",pb);
      run();
    });
    fetchIndex();
  }
}

/* ── 즐겨찾기 ──
   ⚠**계정 없이 되는 것만 만든다**(§0-1). localStorage 하나뿐이고 서버는 이것을 모른다.
   ⚠**서버가 그린 목록은 건드리지 않는다.** 표시와 좁히기만 클라이언트가 얹는다 —
   스크립트가 죽어도 전 선수 목록은 그대로 남는다. */
const isFav=(id)=>state.favs.indexOf(id)>=0;
function toggleFav(id){
  /* ⚠**filter 로 지운다.** splice 는 저장값이 손상돼 같은 id 가 두 번 들어 있으면
     하나만 지워서 별이 안 꺼진다 — 두 번 눌러야 하는 상태가 된다 */
  state.favs=isFav(id)?state.favs.filter(x=>x!==id):state.favs.concat([id]);
  /* ⚠**state 전체를 쓰지 않는다.** initTabs 가 「지금 페이지에 없는 탭 키」를 메모리에서
     첫 키로 되돌려 놓은 상태라, 여기서 통째로 저장하면 **다른 화면의 탭 기본값이 덮어써진다.**
     실측: pranking 그룹의 키 집합이 타자/선발/구원에서 서로 다르다.
     ★ 하나 누른 것이 다른 화면의 설정을 바꾸면 안 된다 */
  try{
    const cur=load()||{};
    cur.favs=state.favs;
    localStorage.setItem(KEY,JSON.stringify(cur));
  }catch(e){}
}
function paintFav(){
  const b=$("#favBtn");
  if(b){
    const on=isFav(b.dataset.fav);
    b.hidden=false;
    b.setAttribute("aria-pressed",String(on));
    b.setAttribute("aria-label",on?"お気に入りから外す":"お気に入りに入れる");
  }
  /* 일람에서는 표식만 얹는다 — 순서를 바꾸면 「내 선수가 어디 갔지」가 된다.
     ⚠**별은 CSS 로 그리지만 뜻은 글자로 말한다.** content 로 그린 ★만 있으면
     스크린리더가 「별」이라고만 읽고 무엇인지 말하지 않는다 */
  $$(".roster li[data-id]").forEach(li=>{
    const on=isFav(li.dataset.id);
    li.setAttribute("data-favon",String(on));
    const a=$("a",li);
    if(!a)return;
    let tag=$(".favtag",a);
    if(on&&!tag){
      tag=doc.createElement("span");tag.className="favtag vh";tag.textContent="お気に入り";
      a.appendChild(tag);
    }else if(!on&&tag&&tag.parentNode&&tag.parentNode.removeChild){
      tag.parentNode.removeChild(tag);
    }
  });
  const only=$("#favOnly");
  if(only){
    /* ⚠**하나도 없으면 버튼을 띄우지 않는다.** 눌러도 빈 화면이 되는 조작은 고장으로 읽힌다 */
    const n=$$(".roster li[data-id]").filter(li=>isFav(li.dataset.id)).length;
    only.hidden=n===0;
    const c=$("#favCount");
    if(c)c.textContent=n>0?String(n):"";
  }
}
const favBtn=$("#favBtn");
if(favBtn)favBtn.addEventListener("click",()=>{toggleFav(favBtn.dataset.fav);paintFav()});

/* ── 최애 구단 ──
   ⚠**위의 선수 즐겨찾기와 다른 개념이다.** 최애는 **하나**뿐이다 — 내비의 첫 자리가
   하나이기 때문이고, state.favs(선수 여럿)는 여기서 건드리지 않는다.
   ⚠**서버는 어느 화면에서나 球団 을 그린다**(§0-1). 여기서 하는 일은 라벨과 링크를 바꾸는 것뿐이라
   JS 가 없어도 구단 목록으로 가는 길이 남는다.
   ⚠**경로를 손으로 짓지 않는다**(M1). teamPath() 가 「한 곳에서만 만든다 — 갈리면 어딘가는 404다」로
   선언된 함수인데 번들은 그 밖에 있다 — 그래서 버튼이 data-favpath 로 서버가 만든 값을 실어 오고,
   우리는 그 앞에 이 화면의 BASE 만 붙인다(서버가 하는 것과 같은 조립이다).
   ⚠**이름과 경로를 저장에 함께 남긴다.** 버튼은 구단 목록 화면에만 있는데 내비는 **전 페이지**에 있다 —
   코드만 남기면 다른 화면에서 라벨이 「T」로 떨어지고 링크를 만들 방법이 없다. */
const navTeamLinks=$$("[data-navteam]");
/* ⚠**서버가 그린 것을 그대로 되돌린다.** 해제했을 때 쓸 경로·라벨·현재위치를 여기서 다시 짓지 않는다 —
   경로는 M1 이 한 곳으로 못 박았고 라벨은 i18n 대상이라(§7), 두 벌이 되면 언젠가 갈린다.

   ⚠⚠**되돌릴 것이 글자만이 아니게 됐다**(2026-09-07 이중 검토 P1 · 검토자 둘이 독립으로 찾았다).
   드래프트만 굽는 시즌에서는 이 링크가 **다른 해로 간다** — 그래서 서버가 두 가지를 더 그린다:
   보이는 표식(i 요소의 →)과 어디로 가는지 말하는 aria-label.
   그런데 여기는 textContent 만 들고 있었다. 결과가 둘:
     ⑴ **최애 미설정**(기본값 · 대부분의 방문자)에서도 되돌리기가 돌아
        「球団<i>→</i>」를 평문 "球団→" 로 뭉갠다 → 그 항목만 표식의 스타일이 죽는다.
     ⑵ **최애 설정**이면 글자는 「阪神」인데 이름은 「球団（…）」로 남는다 →
        **보이는 글자가 접근성 이름 안에 없다**(WCAG 2.5.3 label-in-name).
   ⚠**표식은 최애를 걸어도 참이다** — 최애 구단 페이지도 그 해에는 없다(BASE 가 그 해를 가리킨다).
   ⚠**문장을 여기서 짓지 않는다**(M1). 서버가 「라벨＋괄호」로 지은 이름에서 **라벨만 뗀다** —
      괄호 안의 말투는 내비·시즌 띠와 한 벌이라 여기 두 번째 벌을 두면 언젠가 갈린다. */
const navTeamBack=navTeamLinks.map(a=>{
  /* 표식은 요소다 — 글자로 되돌리면 스타일이 걸리지 않는다(.tnav a i) */
  const mark=a.querySelector?a.querySelector("i"):null;
  const whole=a.textContent||"";
  const mt=mark?(mark.textContent||""):"";
  const text=mt!==""&&whole.slice(whole.length-mt.length)===mt?whole.slice(0,whole.length-mt.length):whole;
  const lab=a.getAttribute("aria-label");
  /* 라벨로 시작하지 않으면 뗄 수 없다 — 그때는 이름을 보이는 글자로만 둔다(거짓말은 안 한다) */
  const away=lab!==null&&lab.slice(0,text.length)===text?lab.slice(text.length):"";
  return {href:a.getAttribute("href")||"",text:text,mark:mark,label:lab,away:away,here:a.getAttribute("aria-current")};
});
/* 라벨을 갈아 끼우되 **표식은 남긴다.** textContent 를 쓰면 자식이 통째로 날아간다 */
function setNavLabel(a,text,mark){
  if(!mark){a.textContent=text;return}
  a.textContent="";
  a.appendChild(doc.createTextNode(text));
  a.appendChild(mark);
}
/* ⚠**「지금 여기」 표시가 화면 밖에 있으면 아무 일도 안 한다**(2026-09-05 감사 P2).
   탭줄은 좁으면 옆으로 굴리는 상자인데 **첫 위치가 언제나 왼쪽 끝**이라, 뒤쪽 항목에 있는
   화면에서는 현재 탭이 상자 밖에서 시작한다 — 실측(390px)으로 상자가 [80,330] 인데
   ドラフト 가 [343,391] 이라 **한 글자도 안 보였다.** 뒤에 있는 항목일수록 이 화면이
   「내가 어디 있는지」를 못 말한다.
   ⚠**scrollIntoView 를 쓰지 않는다** — 조상까지 굴려 **세로 위치를 건드린다**(이 상자는
   sticky 헤더 안에 있다). 상자의 scrollLeft 만 직접 옮긴다.
   ⚠**부드럽게 굴리지 않는다** — 첫 그림에서 움직이는 것은 모션이 아니라 결함으로 보이고,
   그러면 prefers-reduced-motion 을 여기서 또 물어야 한다. 즉시 옮기면 그 질문이 없다.
   ⚠**기하를 모르는 환경에서는 아무것도 하지 않는다**(시험 스텁) — 없는 정보로 판정하지 않는다.
   ⚠**JS 가 없어도 길은 남는다**(§0-1): 상자는 손으로 굴릴 수 있고, 잘린 탭 자체가 더 있다는 신호다. */
function revealInStrip(nav,cur){
  if(!nav||typeof nav.getBoundingClientRect!=="function")return;
  if(typeof nav.scrollWidth!=="number"||typeof nav.clientWidth!=="number")return;
  if(nav.scrollWidth<=nav.clientWidth+1)return;
  if(!cur||typeof cur.getBoundingClientRect!=="function")return;
  const n=nav.getBoundingClientRect(),c=cur.getBoundingClientRect();
  /* 오른쪽이 넘치면 그만큼만 민다 — 항목을 상자 가운데로 끌어오지 않는다(앞의 탭이 사라진다) */
  if(c.right>n.right)nav.scrollLeft+=c.right-n.right;
  else if(c.left<n.left)nav.scrollLeft-=n.left-c.left;
}
/* ⚠**같은 처치가 필요한 상자가 셋이다**(2026-09-07 유저 지적으로 넓혔다).
   처음에는 .tnav 에만 걸었는데, **시즌 띠(.seasons)가 같은 모양으로 잘리고 있었다** —
   실측: 2018년 화면에서 현재 연도가 **9개 중 9번째**(맨 오른쪽)이고 상자는 왼쪽 끝에서 시작한다.
   ⚠**시즌 띠는 탭이 아니라 링크다** — 누르면 **페이지가 바뀌고** 새 페이지의 스크롤은
   당연히 0에서 시작한다. 그래서 「누르면 스크롤이 처음으로 돌아간다」로 보인다.
   **JS 탭 전환의 문제가 아니었다.**
   ⚠**탭줄(.tabs.scroll)도 같다** — 선택은 localStorage 에서 되살아나는데 상자는 0에서 시작하므로,
   뒤쪽 탭을 고른 채 다시 오면 **그 탭이 안 보인다.**
   ⚠**서버가 그린 것을 기준으로 삼는다** — 탭줄은 aria-selected="true", 링크 띠는 aria-current. */
/* ⚠**선택이 바뀌는 상자는 이것뿐이다** — 그래서 showTabs 가 부르는 것도 이것 하나다.
   ⚠**내비와 시즌 띠를 여기 넣지 마라**: 그 둘의 「지금 여기」는 페이지가 사는 동안 안 바뀐다.
   탭을 누를 때마다 같이 굴리면 **사용자가 손으로 밀어 둔 내비가 제자리로 튕겨 돌아간다** —
   자기가 하지 않은 움직임이라 그건 조작이 아니라 결함으로 보인다. */
function revealSelectedTabs(){
  $$(".tabs.scroll").forEach(t=>revealInStrip(t,$('[aria-selected="true"]',t)));
}
function showCurrentTab(){
  revealInStrip($(".tnav"),$("[aria-current]",$(".tnav")));
  const band=$(".seasons");
  if(band)revealInStrip(band,$("[aria-current]",band));
  revealSelectedTabs();
}
if(typeof addEventListener==="function"){
  let tabT=0;
  addEventListener("resize",()=>{clearTimeout(tabT);tabT=setTimeout(showCurrentTab,150)},{passive:true});
}
function paintFavTeam(){
  const fav=state.favTeam;
  /* 빈 문자열은 어느 구단 코드와도 같지 않다 — 미지정이면 12개가 전부 눌리지 않은 상태가 된다 */
  press("[data-favteam]","favteam",fav===null?"":fav.code);
  navTeamLinks.forEach((a,i)=>{
    const back=navTeamBack[i];
    if(fav===null){
      a.setAttribute("href",back.href);
      setNavLabel(a,back.text,back.mark);
      if(back.label===null)a.removeAttribute("aria-label");
      else a.setAttribute("aria-label",back.label);
      if(back.here===null)a.removeAttribute("aria-current");
      else a.setAttribute("aria-current",back.here);
      return;
    }
    a.setAttribute("href",BASE+fav.path);
    setNavLabel(a,fav.name,back.mark);
    /* ⚠**보이는 글자가 바뀌면 이름도 바뀐다**(WCAG 2.5.3). 서버가 이름을 안 적은 화면
       — 같은 해 안에서 끝나는 보통 화면 **9,379장 / 9,392장**(2026-09-07 배포물 실측) —
       에서는 여기서도 안 적는다. 지금까지와 같다 */
    if(back.label!==null)a.setAttribute("aria-label",fav.name+back.away);
    /* ⚠**서버가 적은 aria-current 는 「teams.html 로 가는 링크」에 대한 말이다.**
       목적지를 우리가 바꿨으니 다시 잰다(2026-08-19 검토 ④ · 처음에는 page 만 다뤄서
       구단 상세의 true 가 그대로 남아 있었다):
         ⑴ 바뀐 목적지가 이 문서다(구단 상세 = 최애)      → page
         ⑵ 이 문서가 구단 목록이다(목록 → 그 안의 한 장)  → true (같은 구획 안이지만 이 문서는 아니다)
         ⑶ 그 밖(다른 구단의 상세 등)                     → 아무 말도 하지 않는다
       ⑶ 이 핵심이다 — 巨人 화면에서 라벨이 「阪神」인 링크에 true 가 남으면
       **현재 항목이 아닌 것을 현재라고 말하는 것**이 된다. ⑵ 를 남기는 근거는 포함관계다:
       구단 목록은 그 링크가 가리키는 문서를 **담고 있는** 화면이지만, 다른 구단의 상세는
       그 문서와 아무 관계가 없다.
       ⚠**어느 구단의 화면인가는 서버만 안다** — data-navteam 의 값이 그것이다(구단 상세만 값을 갖는다). */
    const mine=a.dataset.navteam||"";
    if(mine!==""&&mine===fav.code)a.setAttribute("aria-current","page");
    else if(back.here==="page")a.setAttribute("aria-current","true");
    else a.removeAttribute("aria-current");
  });
  /* ⚠**여기서 부른다** — 최애를 바꾸면 첫 탭의 라벨이 「球団」에서 구단 약칭으로 바뀌어
     **탭줄의 폭도 「지금 여기」의 위치도 함께 바뀐다.** 초기 1회도 이 함수가 겸한다. */
  showCurrentTab();
}
/* ⚠**저장값은 서버 데이터의 사본이다** — 그리고 그 사본은 이 브라우저에만 있어 **서버가 못 고친다.**
   약칭이 바뀌면 내비가 틀린 구단 이름을 조용히 보여주고(404 조차 안 난다), 경로 규칙이 바뀌면
   내비만 404 로 간다. ⚠**경로 규칙은 바뀔 예정이다**(Pages 파일 상한 · CLAUDE.md §2-2).
   → 정본이 눈앞에 있는 화면(구단 목록)에 서 있을 때 사본을 고친다. 그 밖의 화면에는 버튼이 없으므로
   아무 일도 일어나지 않는다.
   ⚠**코드가 화면에 없으면 손대지 않는다** — 「그 구단이 사라졌다」와 「지금 이 화면에 없다」를
   구별할 수 없어서다. 지우면 사용자 설정을 우리 추측으로 날리는 것이 된다. */
function refreshFavTeam(){
  const fav=state.favTeam;
  if(fav===null)return;
  const b=$$("[data-favteam]").filter(x=>x.dataset.favteam===fav.code)[0];
  if(!b)return;
  const fresh=readFavTeam({code:b.dataset.favteam,name:b.dataset.favname,path:b.dataset.favpath});
  if(fresh===null||(fresh.name===fav.name&&fresh.path===fav.path))return;
  state.favTeam=fresh;
  try{
    const cur=load()||{};
    cur.favTeam=fresh;
    localStorage.setItem(KEY,JSON.stringify(cur));
  }catch(e){}
}
refreshFavTeam();

$$("[data-favteam]").forEach(b=>b.addEventListener("click",()=>{
  const on=state.favTeam!==null&&state.favTeam.code===b.dataset.favteam;
  const next=readFavTeam({code:b.dataset.favteam,name:b.dataset.favname,path:b.dataset.favpath});
  /* ⚠**「모른다」로 알던 것을 지우지 않는다**(M11 · 2026-08-19 검토 ②).
     배포 전 HTML 을 캐시에 들고 있는 브라우저의 버튼에는 data-favpath 가 없어 readFavTeam 이
     null(모른다)을 낸다. 예전에는 그 null 이 그대로 들어가 **「미지정」과 같은 값**이 됐고,
     실측으로 fav=巨人 인 사람이 그런 버튼을 누르면 라벨이 球団 으로, 저장이 favTeam:null 이 됐다.
     ⚠**바로 위 refreshFavTeam 은 정반대로 짜여 있었다**(fresh===null 이면 손대지 않는다) —
     같은 상황에 두 경로가 다른 규칙을 쓰고 있었다(M1). 여기를 refresh 쪽에 맞춘다.
     ⚠**해제는 막지 않는다** — on 이면 사용자가 지금 걸려 있는 것을 끄겠다는 뜻이라 경로가 필요 없다. */
  if(!on&&next===null)return;
  state.favTeam=on?null:next;
  /* ⚠**state 전체를 쓰지 않는다** — 바로 위 toggleFav 와 같은 이유다.
     initTabs 가 「지금 화면에 없는 탭 키」를 메모리에서 첫 키로 되돌려 놓은 상태라,
     여기서 통째로 저장하면 다른 화면의 탭 기본값이 덮어써진다.
     ⚠**저장이 막혀도**(프라이빗 모드) 이번 방문 동안의 화면은 돌아야 한다 */
  try{
    const cur=load()||{};
    cur.favTeam=state.favTeam;
    localStorage.setItem(KEY,JSON.stringify(cur));
  }catch(e){}
  paintFavTeam();
}));

/* ── 색인 화면의 이름·구단 좁히기 ──
   목록은 서버가 그렸다. JS는 좁히기만 한다 — 스크립트가 죽어도 전 선수 목록은 남는다. */
const filter=$("#rosterFilter");
const chips=$$(".chip[data-team]");
const favOnly=$("#favOnly");
if(filter||chips.length){
  let team="",onlyFav=false;
  const apply=()=>{
    const term=(filter?filter.value.trim():"");
    /* ⚠**헤더 검색과 같은 규칙으로 찾는다.** 여기만 이름 부분일치로 두면
       「やまもと」나 「18」이 첫 화면에서만 0건이 된다 — 같은 기능이 화면에 따라 다르게 동작한다.
       접기는 fold() 한 벌을 그대로 쓴다(M1). */
    const q=fold(term);
    let shown=0;
    $$(".teamgroup").forEach(g=>{
      let n=0;
      $$("li",g).forEach(li=>{
        const hit=(team===""||li.dataset.team===team)
          &&(term===""
            ||li.dataset.name.indexOf(term)>=0
            ||(li.dataset.kana&&fold(li.dataset.kana).indexOf(q)>=0)
            /* 등번호는 완전일치 — 부분일치면 「1」이 100번대까지 끌고 온다 */
            ||li.dataset.uniform===term)
          &&(!onlyFav||isFav(li.dataset.id));
        li.hidden=!hit;if(hit)n++;
      });
      g.hidden=n===0;shown+=n;
    });
    const c=$("#rosterCount");
    if(c)c.textContent=shown+"人";
  };
  chips.forEach(b=>b.addEventListener("click",()=>{
    team=team===b.dataset.team?"":b.dataset.team;
    chips.forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.team===team)));
    apply();
  }));
  if(favOnly)favOnly.addEventListener("click",()=>{
    onlyFav=!onlyFav;
    favOnly.setAttribute("aria-pressed",String(onlyFav));
    apply();
  });
  if(filter)filter.addEventListener("input",apply);

  /* ?q= 로 들어오면 그 말로 좁힌 상태에서 시작한다.
     ⚠**헤더 검색이 「81人中20人を表示 — 選手一覧ですべて見る」라고 말한 뒤 보내는 곳이 여기다.**
     여기서 처음부터 다시 치게 하면 그 안내가 빈말이 된다.
     ⚠**서버는 이 값을 모른다** — 전 선수 목록은 그대로 그려져 있고 좁히기만 얹는다(§0-1).
     ⚠**질의어가 없으면 아무것도 하지 않는다.** 여기서 무조건 apply() 를 부르면
     스크립트가 있을 때만 빈 구단 구획이 사라져, 같은 화면이 JS 유무로 달라진다.
     ⚠**깨진 % 열이 와도 죽지 않는다** — decodeURIComponent 는 그때 던진다. 원문을 그대로 쓴다. */
  if(filter){
    const qm=/[?&]q=([^&#]*)/.exec(LOC.search||"");
    if(qm){
      const raw=(qm[1]||"").split("+").join(" ");
      let q0=raw;
      try{q0=decodeURIComponent(raw)}catch(e){q0=raw}
      if(q0.trim()!==""){filter.value=q0;apply()}
    }
  }
}

/* ── 이 페이지가 「과거 배포의 동결 사본」인가 ──
   ⚠**2026-08-30 에 사용자가 여기 걸렸다.** Cloudflare Pages 는 배포마다 **불변 주소**를 준다
   (hex8 여덟 글자 + 프로젝트 + pages.dev). 그것을 즐겨찾기에 넣으면
   **캐시를 지우든 헤더를 고치든 영원히 그 날짜가 보인다.**
   ⚠**고장으로도 안 읽힌다** — 그 사본은 만들어질 당시엔 신선했으므로 띠가 **초록**이고
   「まで反映」이라고 말한다. 사람이 눈으로 구별할 방법이 없다.
   ⚠**우리가 만든 함정이다** — 배포 로그가 찍는 그 주소를 보고서에 그대로 옮겨 적어 왔다.
   ⚠**서버는 이것을 못 잡는다.** 같은 파일이 두 주소로 나가므로 **보는 쪽에서만** 알 수 있다.
   ⚠**정본 주소를 코드에 박지 않는다** — 첫 라벨만 떼면 그것이 정본이다. 박으면 프로젝트명이
   바뀌는 날 조용히 틀린 곳으로 보낸다. */
const isSnapshotHost=(h)=>/^[0-9a-f]{8}\./.test(h||"")&&/\.pages\.dev$/.test(h||"");
function warnSnapshotHost(){
  const h=LOC.hostname||"";
  if(!isSnapshotHost(h))return;
  const bar=doc.createElement("div");
  /* ⚠**기존 「낡음」 띠와 같은 옷을 입힌다** — 새 CSS 를 만들면 대비 검사 밖에 놓인다 */
  bar.setAttribute("class","state stale");
  bar.setAttribute("role","status");
  const b=doc.createElement("b");
  b.textContent="このページは過去の配信スナップショットです";
  bar.appendChild(b);
  const s=doc.createElement("span");
  s.textContent=" — 内容は更新されません。";
  bar.appendChild(s);
  const a=doc.createElement("a");
  a.setAttribute("href","https://"+h.split(".").slice(1).join(".")+(LOC.pathname||"/"));
  a.textContent="最新のページへ";
  bar.appendChild(a);
  const body=doc.body;
  if(!body)return;
  const first=body.children&&body.children[0];
  if(first)body.insertBefore(bar,first);else body.appendChild(bar);
}

press(".rail [data-preset]","preset",state.preset);
press(".rail [data-density]","density",state.density);
applyTheme();renderBlocks();renderEditor();showTabs();paintFav();paintFavTeam();revealHash();warnSnapshotHost();
})();
`;

/**
 * 용어집을 클라이언트 스크립트에 심는다.
 *
 * ⚠**정의를 두 벌로 만들지 않기 위해서다**(M1). 서버가 그리는 라벨과 클라이언트가 띄우는 설명이
 * 같은 `glossary.ts`에서 나온다.
 * ⚠치환은 **함수 형태**로 한다 — 문자열 치환에서 `$&`·`$1` 같은 패턴이 해석되면
 * 설명문이 조용히 망가진다.
 * ⚠JSON에 백틱이 있으면 템플릿 리터럴이 아니라 **최종 스크립트가** 깨진다. 여기서 막는다.
 */
function embedGlossary(template: string): string {
  const json = JSON.stringify(GLOSSARY);
  if (json.includes("`")) {
    throw new Error("용어집에 백틱이 있다 — 클라이언트 스크립트가 깨진다");
  }
  if (!template.includes("__GLOSSARY__")) {
    throw new Error("__GLOSSARY__ 자리가 없다 — 치환이 조용히 일어나지 않는다");
  }
  return template.replace("__GLOSSARY__", () => json);
}

/**
 * 강조 규칙(`**…**` → `<b>`)을 클라이언트 스크립트에 심는다.
 *
 * ⚠**두 벌로 적지 않기 위해서다**(M1). 서버의 `note()`/`emphasize()` 와 클라이언트의 용어 툴팁이
 * **같은 함수의 같은 소스**를 쓴다 — 클라이언트는 서버 모듈을 import 할 수 없으므로
 * 용어집(`__GLOSSARY__`)과 **같은 방식**으로 심는다.
 * ⚠**두 벌이었을 때 실제로 어긋나 있었다**(2026-08-20 최종 검토 ①): 서버만 규칙을 알았고
 * 클라이언트는 몰라서 별표가 그대로 찍혔다 — 6,333/15,340장(41%).
 * ⚠`erasableSyntaxOnly`(tsconfig.base.json) 라서 타입은 공백으로 지워지고 **몸통은 그대로 JS** 다.
 * 그래도 모양이 바뀌면 조용히 깨지므로 아래에서 시작 글자를 확인한다.
 */
function embedEmphasis(template: string): string {
  const src = emphasisParts.toString();
  if (src.includes("`")) {
    throw new Error("강조 규칙 소스에 백틱이 있다 — 클라이언트 스크립트가 깨진다");
  }
  if (!src.startsWith("function emphasisParts(")) {
    throw new Error(`강조 규칙이 함수 선언이 아니다 — 클라이언트에 심을 수 없다: ${src.slice(0, 40)}`);
  }
  if (!template.includes("__EMPHASIS_PARTS__")) {
    throw new Error("__EMPHASIS_PARTS__ 자리가 없다 — 치환이 조용히 일어나지 않는다");
  }
  return template.replace("__EMPHASIS_PARTS__", () => src);
}

export const CLIENT_JS = embedEmphasis(embedGlossary(CLIENT_JS_TEMPLATE));
