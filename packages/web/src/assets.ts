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
  --f-body:"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans JP","Meiryo",system-ui,sans-serif;
  --f-num:"SFMono-Regular","Consolas","Menlo","Yu Gothic",monospace;
  --topbar:46px;
  /* 탭줄 한 줄의 높이. 스크롤 여백 계산이 이 값을 쓰므로 .rail 이 실제로 이 높이여야 한다 */
  --rail:48px;
  --ease:cubic-bezier(.2,.6,.2,1);
  --fast:120ms; --mid:200ms;
  --pad:20px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#8f8e87;
    --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --panel-2:#23262c;
    --warn:#e08a72; --ok:#8fc09c;
  }
}
:root[data-theme="dark"] {
  --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#8f8e87;
  --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --panel-2:#23262c;
  --warn:#e08a72; --ok:#8fc09c;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--tx);font-family:var(--f-body);line-height:1.55;font-feature-settings:"palt" 1;overflow-wrap:anywhere}
a{color:inherit}
:focus-visible{outline:2px solid var(--tx);outline-offset:1px}

/* 본문으로 건너뛰기 — 키보드 사용자가 매번 헤더를 지나지 않게 */
.skip{position:absolute;left:-9999px;top:0;z-index:50;background:var(--tx);color:var(--page);padding:8px 14px}
.skip:focus{left:0}

/* ── 전역 헤더 ─────────────────────────────────────────────
   ⚠검색과 이동이 **어느 화면에서나 손에 닿아야 한다.** 최하단에만 두면
   1000행짜리 순위표 아래에 묻힌다. */
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;
  height:var(--topbar);padding:0 12px 0 var(--pad);background:var(--panel);border-bottom:1px solid var(--hair-2)}
.brand{font-size:13px;font-weight:700;letter-spacing:.14em;text-decoration:none;white-space:nowrap}
.brand b{color:var(--tx-3);font-weight:400;letter-spacing:.04em;font-size:10px;margin-left:5px}
@media (max-width:560px){.brand b{display:none}}
.qbox{position:relative;flex:1 1 auto;max-width:340px;min-width:0}
.qbox input{font:inherit;font-size:13px;width:100%;padding:5px 9px;background:var(--page);color:var(--tx);
  border:1px solid var(--hair-2);transition:border-color var(--fast) var(--ease)}
.qbox input:hover{border-color:var(--tx-3)}
.qhits{position:absolute;left:0;right:0;top:calc(100% + 3px);z-index:30;margin:0;padding:4px 0;list-style:none;
  background:var(--panel);border:1px solid var(--hair-2);max-height:min(60vh,380px);overflow:auto;
  animation:drop var(--fast) var(--ease)}
.qhits[hidden]{display:none}
.qhits li a{display:flex;gap:8px;align-items:baseline;padding:6px 11px;text-decoration:none;font-size:13px}
.qhits li a:hover,.qhits li[aria-selected="true"] a{background:var(--panel-2)}
.qhits li a{flex-wrap:wrap}
.qhits .ht{margin-left:auto;font-size:10.5px;color:var(--tx-3);white-space:nowrap}
/* 등번호. **고정폭 자리를 준다** — 한 자리와 세 자리가 섞이면 이름의 시작선이 들쭉날쭉해진다.
   ⚠없는 사람에게는 요소 자체가 없으므로 이름이 왼쪽으로 붙는다. 그게 「등록 없음」의 표시다 */
.qhits .hu{min-width:2.1em;text-align:right;font-size:11px;color:var(--tx-3);
  font-variant-numeric:tabular-nums}
/* 성적은 둘째 줄에. **분모까지 붙어 있다**(M2) — 이 줄의 존재 이유가 「이 사람이 맞나」의 판단이다 */
.qhits .hs{flex-basis:100%;font-size:10.5px;color:var(--tx-2);font-variant-numeric:tabular-nums}
.qhits .none{padding:7px 11px;font-size:12px;color:var(--tx-3)}
.tnav{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.tnav a{font-size:12px;padding:5px 9px;text-decoration:none;color:var(--tx-2);white-space:nowrap;
  transition:color var(--fast) var(--ease),background var(--fast) var(--ease)}
.tnav a:hover{color:var(--tx);background:var(--panel-2)}
.tnav a[aria-current="page"]{color:var(--tx);font-weight:700;box-shadow:inset 0 -2px 0 var(--team,#6b7280)}
.tbtn{font:inherit;font-size:13px;line-height:1;padding:6px 8px;cursor:pointer;background:transparent;
  color:var(--tx-2);border:1px solid transparent;transition:color var(--fast) var(--ease)}
.tbtn:hover{color:var(--tx);border-color:var(--hair-2)}

.shell{display:grid;grid-template-columns:44px 1fr;min-height:calc(100vh - var(--topbar))}
.spine{background:var(--team,#6b7280);display:flex;flex-direction:column;align-items:center;padding:16px 0;gap:18px}
.spine .vt{writing-mode:vertical-rl;font-size:12.5px;letter-spacing:.32em;font-weight:700;color:var(--team-ink,#fff)}
.main{min-width:0;padding:0 0 64px}

/* 상태 띠 — 4상태(M12) 중 「수집실패·낡음」을 여기서 말한다 */
.state{padding:7px var(--pad);font-size:12px;border-bottom:1px solid var(--hair)}
.state.stale{background:var(--warn);color:#fff}
.state.fresh{color:var(--tx-3)}
.state b{font-weight:700}

/* ── 선수 표제 ───────────────────────────────────────────── */
.idline{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px var(--pad) 11px;
  border-bottom:3px solid var(--team,#6b7280)}
/* 식별 마크(成績の紋). 배경은 SVG가 스스로 칠한다 */
.mark{flex:0 0 auto;display:flex;line-height:0}
.mk{display:block}
.mkline{display:inline-block;vertical-align:-3px;margin-right:6px;line-height:0}
.idtext{min-width:0;display:flex;flex-direction:column;gap:2px}
/* ⚠**표제는 h1 이다.** 크기는 원래 맞았는데 태그가 span 이라, 스크린리더의 헤딩 목록에
   페이지 제목이 없었다(3,257장 중 h1 0장). 여백은 여기서 지운다 — h1 의 기본 여백이 붙으면
   머리줄이 벌어진다 */
.idline .nm{margin:0;font-size:clamp(21px,5vw,26px);font-weight:700;letter-spacing:.08em;line-height:1.2}
.idline .sub{font-size:11.5px;color:var(--tx-2);letter-spacing:.06em}
.spark{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.spark svg{display:block;overflow:visible}
.spark .sl{font-family:var(--f-num);font-size:9.5px;color:var(--tx-3);letter-spacing:.06em}
.idline .asof{font-family:var(--f-num);font-size:11px;color:var(--tx-3)}

/* 紋을 여는 버튼 — 눌리는 것임을 글자로도 말한다. 도형만 두면 아무도 누르지 않는다 */
.markbtn{padding:0;border:0;background:transparent;cursor:pointer;flex-direction:column;gap:3px;align-items:center}
.markbtn .mkcap{font-size:9px;letter-spacing:.12em;color:var(--tx-3);line-height:1;
  border-bottom:1px dotted var(--hair-2);transition:color var(--fast) var(--ease)}
.markbtn:hover .mkcap,.markbtn[aria-expanded="true"] .mkcap{color:var(--tx)}
.markbtn .mk{transition:box-shadow var(--fast) var(--ease)}
.markbtn:hover .mk,.markbtn[aria-expanded="true"] .mk{box-shadow:0 0 0 2px var(--tx-2)}

/* ── 成績の紋（확대） ───────────────────────────────────────
   ⚠**꼭짓점을 고르는 판이다.** 표제의 52px 마크는 신원 표시라 꼭짓점이 붙어 있어 못 누른다. */
.markpanel{display:flex;flex-wrap:wrap;gap:18px 24px;align-items:flex-start;
  padding:14px var(--pad) 16px;border-bottom:1px solid var(--hair);background:var(--panel);
  animation:rise var(--mid) var(--ease) both}
.markpanel[hidden]{display:none}
.mkfigwrap{flex:0 0 auto;width:min(212px,52vw)}
.mkfig{display:block;width:100%;height:auto;overflow:visible}
.mf-grid{fill:none;stroke:var(--hair-2);stroke-width:1}
.mf-spoke{stroke:var(--hair);stroke-width:1;transition:stroke var(--fast) var(--ease)}
.mf-shape{fill-opacity:.42;stroke:var(--team,#6b7280);stroke-width:1.5;stroke-linejoin:round;
  animation:draw 420ms var(--ease)}
/* ⚠**표본이 얇으면 속을 비운다.** 꽉 찬 도형은 「이만큼이다」라는 단정인데,
   눈금을 맞춘 모집단(타자 50타석·투수 20이닝) 밖에서는 그 단정이 참이 아니다.
   등급이 같은 임계값에서 색을 보류하는 것과 같은 일을 도형에서 한다 */
.mf-shape.thin{fill-opacity:0;stroke-dasharray:4 3}
/* ⚠보이는 점은 작아도 **판정 영역은 손가락 크기**여야 한다 — mf-hit이 그 역할이다.
   손잡이는 둘레에 고르게 있고, 값 표시점(mf-dot)은 도형 위에 따로 있다 */
.mf-hit{fill:transparent}
.mf-dot{fill:var(--panel);stroke:var(--team,#6b7280);stroke-width:2;
  transform-box:fill-box;transform-origin:center;
  transition:transform var(--fast) var(--ease),fill var(--fast) var(--ease)}
.mf-lab{font-family:var(--f-body);font-size:11px;fill:var(--tx-2);letter-spacing:.06em;
  transition:fill var(--fast) var(--ease)}
.mf-ax{cursor:pointer}
.mf-ax:hover .mf-dot{transform:scale(1.4)}
.mf-ax:hover .mf-lab{fill:var(--tx)}
.mf-ax:focus-visible{outline:none}
.mf-ax:focus-visible .mf-dot{transform:scale(1.7)}
.mf-ax:focus-visible .mf-lab,.mf-ax:focus-visible .mf-spoke{fill:var(--tx);stroke:var(--tx)}
/* 고른 축 — **점이 커지고 살과 라벨이 진해진다.** 색만으로 말하지 않는다 */
.mf-ax.on .mf-dot{transform:scale(2);fill:var(--team,#6b7280)}
.mf-ax.on .mf-lab{fill:var(--tx);font-weight:700}
.mf-ax.on .mf-spoke{stroke:var(--tx-2)}

.mkside{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:9px}
.mkside [data-markpick]{gap:4px}
.mkside [data-markpick] .tab{font-size:11.5px;padding:3px 9px}
.mkread{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;align-items:baseline}
.mkread[hidden]{display:none}
.mkread b{font-size:12px;letter-spacing:.14em;color:var(--tx-2);font-weight:600}
.mkread em{font-style:normal;font-family:var(--f-num);font-variant-numeric:tabular-nums;
  font-size:21px;text-align:right}
.mkread p{grid-column:1 / -1;margin:4px 0 0;font-size:12px;color:var(--tx-2);line-height:1.6}
.mkread .mr-how{font-family:var(--f-num);font-size:10.5px;color:var(--tx-3)}
/* ⚠뒤집힌 축의 한마디는 **눈에 띄어야 한다.** 못 보면 도형을 반대로 읽는다 */
.mkread .mr-note{padding-left:8px;box-shadow:inset 2px 0 0 var(--warn);color:var(--tx)}
@media (max-width:520px){
  .markpanel{gap:12px}
  .mkfigwrap{width:min(190px,58vw);margin:0 auto}
  .mkread em{font-size:19px}
}

/* ── 조작 레일 ───────────────────────────────────────────── */
.rail{position:sticky;top:var(--topbar);z-index:10;display:flex;align-items:center;gap:6px;
  min-height:var(--rail);
  padding:9px var(--pad);border-bottom:1px solid var(--hair);background:var(--panel);
  overflow-x:auto;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{height:0}
.rail .lbl{font-size:10.5px;letter-spacing:.16em;color:var(--tx-3);white-space:nowrap}
.rail .grow{flex:1 1 auto;min-width:6px}
.tab{font:inherit;font-size:12px;padding:4px 10px;cursor:pointer;background:transparent;color:var(--tx-2);
  border:1px solid var(--hair-2);white-space:nowrap;
  transition:color var(--fast) var(--ease),background var(--fast) var(--ease),border-color var(--fast) var(--ease)}
.tab:hover{color:var(--tx);border-color:var(--tx-3)}
.tab[aria-pressed="true"],.tab[aria-selected="true"]{background:var(--team,#6b7280);color:var(--team-ink,#fff);
  border-color:var(--team,#6b7280);font-weight:700}

/* 탭 묶음 — 화면을 아래로 늘리는 대신 골라 본다 */
.tabs{display:flex;gap:5px;flex-wrap:wrap}
/* ⚠**min-width:0 이 이 줄의 핵심이다.** flex 아이템의 min-width 는 기본값이 auto 이고
   그것은 **내용의 최소폭**으로 풀린다. 버튼이 white-space:nowrap 이라 최소폭 = 버튼 폭의 합이 되고,
   그러면 이 줄은 줄어들기를 거부한다 → 부모가 밀리고 **페이지 전체가 옆으로 넓어진다.**
   overflow-x:auto 만 적어두면 아무 일도 일어나지 않는다 — 줄어들 수 있어야 넘칠 수 있다. */
.tabs.scroll{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;
  min-width:0;max-width:100%;padding-bottom:2px;scrollbar-width:thin;
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
/* 테두리를 겹쳐 한 줄로 만든다. 겹치면 고른 쪽 테두리가 덮이므로 위로 올린다 */
.tabs.seg .tab+.tab{margin-left:-1px}
.tabs.seg .tab[aria-selected="true"]{position:relative;z-index:1}
/* 레일 안에서 상위 탭을 따라 열리고 닫히는 자리(하위 탭줄).
   ⚠**[hidden] 규칙을 여기서 다시 쓴다** — 위쪽의 display:none 과 특이도가 같아
   나중에 오는 이 display:flex 가 이기기 때문이다. 안 쓰면 숨겨야 할 탭줄이 계속 보인다 */
.rail>[data-panelgroup]{display:flex;align-items:center;gap:6px;min-width:0}
.rail>[data-panelgroup][hidden]{display:none}
.rail .div{flex:none;align-self:stretch;width:1px;margin:-2px 2px;background:var(--hair-2)}

/* ── 조립 UI ─────────────────────────────────────────────── */
.editor{padding:14px var(--pad) 16px;border-bottom:1px solid var(--hair);background:var(--panel)}
.editor[hidden]{display:none}
/* ⚠**태그를 h2 로 올렸으면 선택자도 따라가야 한다.** 안 그러면 이 제목만
   브라우저 기본 h2(24px + 큰 여백)로 그려진다 — 헤딩 순서를 고치다 만든 결함이다 */
.editor h2{margin:0 0 3px;font-size:12px;letter-spacing:.14em;color:var(--tx-2);font-weight:600}
.editor p{margin:0 0 12px;font-size:11.5px;color:var(--tx-3)}
.blocks{display:flex;flex-direction:column;gap:4px;max-width:520px}
.brow{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:6px 8px;
  border:1px solid var(--hair);background:var(--page)}
.brow input[type=checkbox]{accent-color:var(--team,#6b7280);width:16px;height:16px}
.brow .bn{font-size:13px}
.brow .bd{font-size:11px;color:var(--tx-3)}
.mv{font:inherit;font-size:11px;padding:3px 8px;cursor:pointer;background:transparent;color:var(--tx-2);
  border:1px solid var(--hair-2);transition:color var(--fast) var(--ease)}
.mv:hover:not(:disabled){color:var(--tx);border-color:var(--tx-3)}
.mv:disabled{opacity:.3;cursor:default}
.fixed-note{margin-top:12px;padding:9px 11px;border-left:3px solid var(--warn);background:var(--page);
  font-size:11.5px;color:var(--tx-2);max-width:520px}
.fixed-note b{color:var(--warn)}

/* ── 블록 ────────────────────────────────────────────────── */
.block{padding:16px var(--pad);border-bottom:1px solid var(--hair);animation:rise var(--mid) var(--ease) both;
  animation-delay:calc(var(--i,0) * 26ms)}
.block[hidden]{display:none}
.block>h2{margin:0 0 9px;font-size:10.5px;letter-spacing:.19em;color:var(--tx-2);font-weight:600;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.block>h2 .sw{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.block>h2 .qt{letter-spacing:0;font-weight:400;color:var(--tx-3)}
[data-panelgroup]{animation:fade var(--fast) var(--ease)}
[data-panelgroup][hidden]{display:none}
/* ⚠**패널에만 준다.** 레일 안의 하위 탭줄도 같은 그룹에 속하는데, 탭줄이 미끄러지면 조작이 흔들린다 */
[data-panelgroup][role="tabpanel"][data-slide="next"]{animation:slideNext var(--mid) var(--ease)}
[data-panelgroup][role="tabpanel"][data-slide="prev"]{animation:slidePrev var(--mid) var(--ease)}

.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0 24px}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;align-items:baseline}
dt{font-size:10.5px;color:var(--tx-2);letter-spacing:.12em;padding:4px 10px 4px 0;border-bottom:1px solid var(--hair);white-space:nowrap}
dd{margin:0;text-align:right;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:14px;
  padding:4px 0;border-bottom:1px solid var(--hair)}
.den{font-family:var(--f-num);font-size:10px;color:var(--tx-3);margin-left:5px}

/* 보이지 않는 글자 — 색으로만 전하지 않기 위한 것이다. 지우지 마라 */
.vh{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── 용어 ──────────────────────────────────────────────────
   ⚠버튼이어야 한다. span+hover로 만들면 터치와 키보드에서 열 방법이 없다. */
.term{font:inherit;color:inherit;letter-spacing:inherit;background:transparent;border:0;padding:0;
  cursor:help;text-align:inherit;
  border-bottom:1px dotted var(--hair-2);transition:border-color var(--fast) var(--ease)}
.term:hover,.term[aria-expanded="true"]{border-bottom-color:var(--tx-2);border-bottom-style:solid}
th .term{cursor:help}
/* ⚠**손가락은 글자보다 크다.** 항목명은 10.5px라 그대로는 누르기 어렵다.
   가짜 요소로 **판정 영역만** 넓힌다 — 여백을 주면 표의 행 높이가 늘어난다.
   위아래는 5px까지만 — 항목 줄 간격이 25px 남짓이라 더 넓히면 옆 줄의 설명이 뜬다 */
@media (pointer:coarse){
  .term{position:relative}
  .term::after{content:"";position:absolute;left:-7px;right:-7px;top:-5px;bottom:-5px}
}
.term:active{border-bottom-color:var(--tx);border-bottom-style:solid}

#tip{position:absolute;z-index:40;max-width:min(30ch,86vw);padding:9px 11px;
  background:var(--tx);color:var(--page);font-size:12px;line-height:1.5;
  box-shadow:0 2px 10px rgba(0,0,0,.22);animation:drop var(--fast) var(--ease)}
#tip[hidden]{display:none}
#tip b{display:block;font-size:12.5px;letter-spacing:.06em;margin-bottom:3px}
#tip s{display:block;text-decoration:none;font-family:var(--f-num);font-size:10.5px;opacity:.72;margin-top:5px}
#tip u{display:block;text-decoration:none;font-size:11.5px;margin-top:5px;
  padding-left:7px;box-shadow:inset 2px 0 0 var(--warn)}

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
dd.v{transition:box-shadow var(--fast) var(--ease)}
dd.g-veryGood{box-shadow:inset 0 -3px 0 var(--g-vgood);background:var(--g-vgood-bg)}
dd.g-good{box-shadow:inset 0 -3px 0 var(--g-good)}
dd.g-average{box-shadow:inset 0 -3px 0 var(--g-avg)}
dd.g-bad{box-shadow:inset 0 -3px 0 var(--g-bad)}
dd.g-veryBad{box-shadow:inset 0 -3px 0 var(--g-vbad);background:var(--g-vbad-bg)}
/* 색 끄기 — 취향이다. 분모는 끌 수 없지만 색은 보조이므로 끌 수 있다 */
:root[data-grades="off"] dd.v{box-shadow:none;background:transparent}

/* 범례 — 색이 무엇을 뜻하는지 말한다. 말하지 않으면 색은 장식이다 */
.legend{display:flex;align-items:center;gap:11px;flex-wrap:wrap;
  padding:6px var(--pad);border-bottom:1px solid var(--hair);background:var(--panel-2);
  font-size:10.5px;color:var(--tx-2)}
.legend .lg{letter-spacing:.16em;color:var(--tx-3);white-space:nowrap}
.legend .tail{margin-left:auto}
.legend .sw{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.legend .sw b{font-weight:400}
.legend .sw i{width:15px;height:4px;background:var(--g-avg)}
.legend .sw.g-veryGood i{background:var(--g-vgood)}
.legend .sw.g-good i{background:var(--g-good)}
.legend .sw.g-bad i{background:var(--g-bad)}
.legend .sw.g-veryBad i{background:var(--g-vbad)}
.legend #gradeBtn{font-size:11px;padding:2px 8px}
/* 색을 끄면 범례의 견본도 함께 죽는다 — 안 쓰는 안내가 남아 있으면 그것도 거짓말이다 */
:root[data-grades="off"] .legend .sw{opacity:.3}
@media (max-width:620px){.legend .tail{display:none}}
/* 좁은 화면 — 가운데 세 칸의 글자를 접고 견본만 남긴다. 양 끝(とても悪い↔とても良い)이
   남으므로 눈금의 뜻은 그대로 읽힌다. 다섯 줄을 다 늘어놓으면 성적이 화면 밖으로 밀린다 */
@media (max-width:520px){
  .legend{gap:7px}
  .legend .sw{gap:0}
  .legend .sw.g-bad b,.legend .sw.g-average b,.legend .sw.g-good b{display:none}
  .legend .sw.g-veryBad i{margin-right:5px}
  .legend .sw.g-veryGood i{margin-right:5px}
}
.rank{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:700;padding:0 5px;font-size:10px;
  margin-left:6px;font-family:var(--f-body)}

/* 선발·구원별 — 두 단이 각자의 제목을 갖는다. 제목이 없으면 어느 쪽 숫자인지 알 수 없다 */
/* 격리 원문 — 코드가 아니라 **원본 그대로의 글자**임을 보이게 한다 */
.qs{font-family:var(--f-num);font-size:11px;background:var(--panel-2);padding:1px 5px;white-space:nowrap}
.qd{font-size:10.5px;color:var(--tx-3)}
/* ⚠**크기를 명시한다.** 원래 h5 의 기본값(0.83em)에 기대고 있었는데 h3 로 올리면서
   1.17em 이 되어 41% 커졌다 — 블록 제목(10.5px)보다 커진다. 태그에 기대지 않는다 */
.rolecol .subhead{margin:0 0 4px;font-size:11px;letter-spacing:.1em;color:var(--tx-2);font-weight:600}
.rolecol dl{margin:0}

/* ⚠좁은 화면에서 표를 옆으로 밀면 **누구의 행인지**가 먼저 사라진다.
   첫 열을 고정해서 이름이 남게 한다. 오른쪽 끝의 그늘은 「더 있다」는 신호다. */
.scroller{overflow-x:auto;-webkit-overflow-scrolling:touch;position:relative;
  background:linear-gradient(to left,var(--page),rgba(0,0,0,0) 24px) right center / 24px 100% no-repeat}
.scroller table{background:var(--page)}
.scroller th:first-child,.scroller td:first-child{position:sticky;left:0;z-index:1;background:var(--page)}
.scroller tr.me td:first-child{background:var(--team,#6b7280)}
.scroller tbody tr:hover td:first-child{background:var(--panel-2)}
/* ⚠**앵커가 고정 머리 아래로 들어가지 않게 한다.** #pc-nipponSeries 처럼 깊은 링크로
   들어오면 브라우저는 대상을 화면 맨 위에 두는데, 그 자리는 topbar 가 덮고 있다 —
   눌러서 왔는데 찾던 것이 안 보인다 */
html{scroll-padding-top:calc(var(--topbar) + 10px)}
/* 탭줄이 있는 화면은 그 높이만큼 더 비운다.
   ⚠**topbar 만 빼면 모자란다** — 順位·타대회는 topbar 아래에 탭줄이 한 겹 더 sticky 로 얹힌다.
   #pc-nipponSeries 로 들어오면 제목과 첫 줄이 그 탭줄 뒤로 가린 채 멈춘다.
   :has() 를 모르는 브라우저는 위의 기본값으로 떨어질 뿐이라 더 나빠지지 않는다 */
html:has(.rail){scroll-padding-top:calc(var(--topbar) + var(--rail) + 10px)}

table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--hair);white-space:nowrap}
th{font-size:10px;letter-spacing:.1em;color:var(--tx-2);font-weight:500}
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
tbody th{font-size:12px;letter-spacing:0;color:var(--tx);font-weight:400}
td.l,th.l{text-align:left}
tbody tr{transition:background var(--fast) var(--ease)}
tbody tr:hover{background:var(--panel-2)}
tr.me td{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:700}
tr.me:hover td{background:var(--team,#6b7280)}
/* ⚠**「얇음」을 대비 강등으로 말하지 않는다.**
   --tx-3 이 붙는 것은 분모(.den)·자격 기준과 표본 경고(.note)·규정 미달 행인데,
   실측(2026-08-16) 대비가 라이트 3.20:1 · 다크 4.20:1 이었다 —
   **M2가 요구하는 바로 그 정보가 화면에서 가장 안 읽혔다.** 구단 페이지는 표의 86%가 그 색이다.
   토큰 명도를 올리고(색상환은 그대로라 인쇄물의 질감은 남는다), 얇음은 **다른 채널**로 말한다 */
tr.thin td{color:var(--tx-2)}
tr.thin td:first-child{box-shadow:inset 2px 0 0 var(--hair-2)}
/* 구단 색 칩 — **모든 표가 같은 한 벌을 쓴다**(M1의 정신).
   ⚠**셀을 flex 컨테이너로 만들지 않는다.** td{display:flex} 는 그 칸을 테이블 셀 박스에서
   빼내어, **그 열만 아래 경계선이 다른 열과 어긋난다**(2026-08-16 실측: 순위표 球団 열).
   ⚠전에는 이 규칙이 .stand·.iscore 안에만 있어서 **ポストシーズン 표의 칩은
   아예 그려지지 않았다** — <i> 는 인라인이라 width/height 가 먹지 않는다.
   네 화면(順位·イニングスコア·ポストシーズン 타자표·투수표)이 이 한 벌을 쓴다 */
.tm i{display:inline-block;width:9px;height:9px;margin-right:6px;vertical-align:middle;
  background:var(--chip,#6b7280);box-shadow:inset 0 0 0 1px var(--tx-2)}
td a{text-decoration:none;box-shadow:inset 0 -1px 0 var(--hair-2)}
td a:hover{box-shadow:inset 0 -1px 0 currentColor}

/* 정렬 가능한 머리 — **버튼이다.** 클릭만 되고 초점이 안 가는 머리를 만들지 않는다 */
th:has(.sortable){padding:0}
.sortable{font:inherit;font-size:10px;letter-spacing:.1em;color:var(--tx-2);background:transparent;
  border:0;cursor:pointer;padding:5px 8px;width:100%;text-align:inherit;white-space:nowrap;
  display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;
  transition:color var(--fast) var(--ease)}
th.l .sortable{justify-content:flex-start}
.sortable:hover{color:var(--tx)}
.sortable i{font-style:normal;width:7px;opacity:.3}
.sortable i::before{content:"↕"}
th[aria-sort="ascending"] .sortable,th[aria-sort="descending"] .sortable{color:var(--tx);font-weight:700}
th[aria-sort="ascending"] .sortable i,th[aria-sort="descending"] .sortable i{opacity:1}
th[aria-sort="ascending"] .sortable i::before{content:"↑"}
th[aria-sort="descending"] .sortable i::before{content:"↓"}
@media (pointer:coarse){.sortable{padding:9px 8px}}

.pa{font-size:11.5px;letter-spacing:.02em}
.pa.h{color:var(--warn);font-weight:700}

.dg{display:grid;grid-template-columns:66px repeat(3,minmax(56px,1fr));gap:3px;min-width:300px}
.dg .h{font-size:10px;letter-spacing:.1em;color:var(--tx-3);text-align:center}
.dg .rl{font-size:11px;color:var(--tx-2);display:flex;align-items:center}
.dg .c{border:1px solid var(--hair);padding:5px 3px;text-align:center;font-family:var(--f-num);font-variant-numeric:tabular-nums}
.dg .c u{display:block;text-decoration:none;font-size:13px}
.dg .c s{display:block;text-decoration:none;font-size:9px;color:var(--tx-3)}
.dg .c.thin u{color:var(--tx-2)}

.bars{display:flex;flex-direction:column;gap:6px;max-width:480px}
.bar{display:grid;grid-template-columns:84px 1fr 132px;gap:10px;align-items:center}
.bar span{font-size:11.5px;color:var(--tx-2)}
.track{height:13px;background:var(--hair)}
.track i{display:block;height:100%;background:var(--team,#6b7280);transform-origin:left center;
  animation:grow 420ms var(--ease) both}
.bar em{font-style:normal;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:12px;text-align:right}
/* 상대전적 좁히기 */
.mfind{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 9px}
.mfind label{font-size:10.5px;letter-spacing:.14em;color:var(--tx-3)}
.mfind input{font:inherit;font-size:13px;padding:5px 9px;width:170px;background:var(--panel);color:var(--tx);
  border:1px solid var(--hair-2);transition:border-color var(--fast) var(--ease)}
.mfind input:hover{border-color:var(--tx-3)}
.mfind select{font:inherit;font-size:13px;padding:5px 8px;background:var(--panel);color:var(--tx);
  border:1px solid var(--hair-2);max-width:180px;transition:border-color var(--fast) var(--ease)}
.mfind select:hover{border-color:var(--tx-3)}
.mfind .count{font-family:var(--f-num);font-size:11px;color:var(--tx-3)}
@media (max-width:680px){
  .mfind input{flex:1 1 auto;width:auto;min-width:0}
  .mfind select{flex:1 1 auto;max-width:none;min-width:0}
  .mfind .count{flex-basis:100%}
}
@media (pointer:coarse){.mfind select,.mfind input{padding:8px}}

.note{font-size:11px;color:var(--tx-3);margin:9px 0 0;max-width:64ch}
.empty{font-size:12px;color:var(--tx-3);padding:6px 0}

/* ── 予告先発 ────────────────────────────────────────────── */
/* 대전 카드 버튼 — **경기 수만큼 만들어지고, 폭에 맞춰 열이 접힌다** */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:6px;
  padding:12px var(--pad);border-bottom:1px solid var(--hair);background:var(--panel)}
.card{display:flex;align-items:center;gap:9px;font:inherit;text-align:left;cursor:pointer;
  padding:8px 10px;background:transparent;color:var(--tx-2);border:1px solid var(--hair-2);
  transition:color var(--fast) var(--ease),border-color var(--fast) var(--ease),background var(--fast) var(--ease)}
.card:hover{color:var(--tx);border-color:var(--tx-3)}
.card[aria-selected="true"]{color:var(--tx);border-color:var(--tx);background:var(--page)}
.card .cbar{display:flex;flex-direction:column;gap:2px;flex:0 0 auto}
.card .cbar i{display:block;width:5px;height:13px}
.card .ctxt{min-width:0;display:flex;flex-direction:column;gap:1px}
.card .ctxt b{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .ctxt s{text-decoration:none;font-family:var(--f-num);font-size:10px;color:var(--tx-3);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.card.all .ctxt b{letter-spacing:.1em}
@media (max-width:420px){.cards{grid-template-columns:1fr 1fr;gap:5px}.card{padding:7px 8px}}

.starters{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.sside{min-width:0}
.sname{margin:0 0 6px;font-size:11px;letter-spacing:.14em;font-weight:700;display:flex;align-items:center;gap:7px}
.sname i{width:10px;height:10px;background:var(--chip,#6b7280);font-style:normal}
.spitcher{margin:0 0 9px;font-size:19px;font-weight:700;letter-spacing:.06em}
.spitcher a{text-decoration:none;box-shadow:inset 0 -2px 0 var(--chip,#6b7280)}
dl.srow{grid-template-columns:auto 1fr;margin-bottom:11px}
@media (max-width:680px){.starters{grid-template-columns:1fr;gap:18px}}

/* ── 対戦を選ぶ ──────────────────────────────────────────── */
.picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:18px;max-width:640px}
.pickside label{display:block;font-size:10.5px;letter-spacing:.16em;color:var(--tx-3);margin-bottom:6px}
.pickside .qbox{max-width:none}
.pickside .qbox input{font-size:15px;padding:8px 10px}
.chosen{margin:7px 0 0;font-size:12px;color:var(--tx-3)}
.chosen b{color:var(--tx);font-weight:700}
.go{font:inherit;font-size:13px;padding:9px 18px;cursor:pointer;background:var(--team,#6b7280);
  color:var(--team-ink,#fff);border:1px solid var(--team,#6b7280);font-weight:700;
  transition:opacity var(--fast) var(--ease)}
.go:disabled{opacity:.35;cursor:default}
.go:hover:not(:disabled){opacity:.85}
.go.alt{background:transparent;color:var(--tx-2);border-color:var(--hair-2);font-weight:400;margin-left:7px}
.go.alt:hover:not(:disabled){color:var(--tx);border-color:var(--tx-3);opacity:1}

/* ⚠**고른 것과 실행 버튼은 화면에서 사라지면 안 된다.** 아래의 선수 목록이 길어서
   스크롤하면 「골랐는데 어떻게 보지?」가 된다. 레일과 같은 sticky를 쓴다 */
.pickbar{position:sticky;top:var(--topbar);z-index:9;display:flex;align-items:center;
  flex-wrap:wrap;gap:8px 16px;margin:0 0 14px;padding:9px 0;background:var(--panel);
  border-bottom:1px solid var(--hair)}
.pickbar .chosen{margin:0;display:flex;align-items:baseline;gap:7px;min-width:0}
.pickbar .chosen span{font-size:10px;letter-spacing:.16em;color:var(--tx-3);flex:none}
.pickbar .chosen b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pickbar .go{margin-left:auto;flex:none}
.picknote{margin:0 0 8px;font-size:11.5px;color:var(--tx-3)}
.pickgames{margin:0 0 12px}
/* 두 팀을 나란히. 좁으면 위아래로 — 어느 쪽이 어느 팀인지는 색 표식과 이름이 말한다 */
.pickteams{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.pickteam{min-width:0}
.picktm{margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:7px}
.picktm i{width:10px;height:10px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠**접힌 채로도 무엇이 몇 명인지 보여야 한다.** 요약이 라벨 노릇을 그대로 한다.
   ⚠**기본 화살표를 지우고 우리 표식을 쓴다** — 브라우저마다 모양이 달라 줄이 흔들린다 */
.pickfold{margin:10px 0 0}
.pickfold>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:6px}
.pickfold>summary::-webkit-details-marker{display:none}
/* ⚠**글리프에 빈 대체텍스트를 붙인다.** details/summary 는 접힘·펼침을 이미 네이티브로 알리는데,
   그 위에 생성 콘텐츠를 얹으면 낭독기가 「검은 오른쪽 삼각형」을 덧붙여 읽는다 */
.pickfold>summary::after{content:"▸" / "";margin-left:auto;font-size:11px;color:var(--tx-3);
  transition:transform var(--fast) var(--ease)}
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
.pickfold .picklist{margin-top:5px}
.picklab{margin:10px 0 5px;font-size:10px;letter-spacing:.16em;color:var(--tx-3);
  display:flex;align-items:baseline;gap:6px}
.picklab s{text-decoration:none;letter-spacing:0;font-size:10.5px}
/* 순위표의 전환 줄. ⚠**「지금 몇 명을 보고 있는가」를 늘 낸다**(M2) —
   전환했는데 인원이 안 보이면 무엇이 늘고 줄었는지 알 수 없다 */
.rankonly{margin:0 0 8px}
/* ⚠**자르지 않고 상자 안에서 스크롤한다.** 상위 N만 내면 대타·중간계투가 사라지고,
   찾는 사람이 없는 순간 이 기능은 없는 것과 같아진다 */
.picklist{display:flex;flex-wrap:wrap;gap:4px;max-height:184px;overflow-y:auto;
  overscroll-behavior-y:contain;padding:1px}
.pk{font:inherit;font-size:12.5px;padding:4px 8px;cursor:pointer;background:transparent;
  color:var(--tx-2);border:1px solid var(--hair-2);display:inline-flex;align-items:baseline;gap:5px;
  transition:color var(--fast) var(--ease),border-color var(--fast) var(--ease)}
.pk s{text-decoration:none;font-size:10px;color:var(--tx-3);font-variant-numeric:tabular-nums}
.pk em{font-style:normal;font-size:9.5px;letter-spacing:.08em;color:var(--chip-ink,#fff);
  background:var(--chip,#6b7280);padding:0 4px}
.pk:hover{color:var(--tx);border-color:var(--tx-3)}
/* 고른 것은 **버튼 자신이** 말한다 — 위의 pickbar만 바뀌면 목록 안에서 무엇을 눌렀는지 잃는다 */
.pk[aria-pressed="true"]{background:var(--chip,#6b7280);color:var(--chip-ink,#fff);
  border-color:var(--chip,#6b7280);font-weight:700}
.pk[aria-pressed="true"] s{color:inherit;opacity:.75}
.pk[aria-pressed="true"] em{background:var(--chip-ink,#fff);color:var(--chip,#6b7280)}
/* 비교 화면에서는 **어느 자리에 들어갔는지**까지 말한다 — 채울 자리가 둘이다 */
.pk[data-slot]::after{content:attr(data-slot);font-size:9.5px;margin-left:4px;opacity:.85}
.pickfind{margin:16px 0 0;border-top:1px solid var(--hair);padding-top:12px}
.pickfind .picker{margin-top:12px}

/* ── 試合ページ ────────────────────────────────────────────
   ⚠**원본의 이닝별 표를 옮긴 화면이 아니다**(L2). 숫자는 우리가 타석 로그에서 조립했고,
   화면의 주역은 「어디서 점수가 났는가」와 「어느 타석이 경기를 움직였는가」다. */
.gbig{display:grid;grid-template-columns:1fr;gap:2px;max-width:520px}
.gbside{display:flex;align-items:center;gap:11px;padding:7px 0;border-bottom:1px solid var(--hair)}
.gbside:last-child{border-bottom:0}
.gbt{display:flex;align-items:center;gap:9px;font-size:15px;color:var(--tx-2);min-width:0}
.gbt i{width:12px;height:12px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠이긴 쪽은 **크기와 굵기**로 표시한다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.gbside.w .gbt{color:var(--tx);font-weight:700}
.gbr{margin-left:auto;font-size:34px;line-height:1;font-variant-numeric:tabular-nums;color:var(--tx-3);
  letter-spacing:-.02em}
.gbside.w .gbr{font-size:44px;color:var(--tx);font-weight:700}
.gtie2{margin:8px 0 0;font-size:12px;color:var(--tx-2)}
/* 이닝별 득점 — 득점한 칸이 먼저 보여야 한다 */
table.iscore{font-variant-numeric:tabular-nums;margin-top:13px}
table.iscore th,table.iscore td{text-align:center;padding:5px 9px;white-space:nowrap}
table.iscore th.l{text-align:left}

table.iscore td.sc{font-weight:700;color:var(--tx);background:var(--panel-2)}
/* ⚠「x」는 0이 아니다 — 공격이 없었다는 뜻이다. 흐리게 두어 숫자와 섞이지 않게 한다 */
table.iscore td.x{color:var(--tx-3)}
table.iscore .tot{font-weight:700;border-left:1px solid var(--hair-2)}
/* 타석 목록 — 훑어 읽는 자리다. 이닝 · 상황 그림 · 사람 · 결과 · 점수 · 움직임 */
.plays{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.play{display:grid;grid-template-columns:4.6em 34px minmax(0,1fr) minmax(0,1.1fr) 4.2em 5.4em;
  gap:0 10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--hair)}
.play:last-child{border-bottom:0}
.pin{font-size:11.5px;color:var(--tx-3);letter-spacing:.04em}
.pdia{display:flex;align-items:center}
.pwho{min-width:0;font-size:13.5px;display:flex;flex-direction:column;gap:1px}
.pwho a{text-decoration:none;font-weight:700;border-bottom:1px solid var(--hair-2)}
.pwho a:hover{border-bottom-color:var(--tx-3)}
.pwho s{text-decoration:none;font-size:10.5px;color:var(--tx-3)}
.pres{font-size:13px;color:var(--tx-2);min-width:0;display:flex;align-items:baseline;gap:6px}
.pres em{font-style:normal;font-size:11px;font-weight:700;color:var(--tx);
  border-left:3px solid var(--chip,#6b7280);padding-left:5px;flex:none}
/* ⚠**타점 없는 득점은 타자가 낸 점이 아니다.** 굵게 두면 그 타석의 성과로 읽힌다 */
.pres em.norbi{font-weight:400;color:var(--tx-2);border-left-color:var(--hair-2)}
.pres em.norbi s{text-decoration:none;font-size:9.5px;color:var(--tx-3);margin-left:4px}
.psc{font-size:12px;color:var(--tx-3);font-variant-numeric:tabular-nums;text-align:right}
.pswing{position:relative;text-align:right;font-variant-numeric:tabular-nums;font-size:13px;padding-bottom:6px}
.pswing.none{color:var(--tx-3)}
.pswing i{position:absolute;bottom:0;height:3px;width:calc(var(--w) * 1%);font-style:normal;opacity:.8}
.pswing i.p{right:0;background:var(--g-vgood)}
.pswing i.n{right:0;background:var(--g-vbad)}
/* 주자 다이아몬드 — **우리 데이터로 그린 우리 그림**(로고·사진 금지의 대체물) */
.dia{display:block;overflow:visible}
.dia .db{fill:none;stroke:var(--tx-3);stroke-width:1.2}
.dia .db.on{fill:var(--chip,#6b7280);stroke:var(--chip,#6b7280)}
.dia .do{fill:none;stroke:var(--tx-3);stroke-width:1}
.dia .do.on{fill:var(--tx-2);stroke:var(--tx-2)}
@media (max-width:600px){
  .play{grid-template-columns:3.9em 30px minmax(0,1fr) 4.6em;gap:2px 8px}
  /* 좁은 화면에서는 결과와 움직임을 아랫줄로 내린다 — 가로로 밀지 않는다 */
  .pres{grid-column:3 / span 2;font-size:12px}
  .psc{grid-column:1 / span 2;text-align:left;font-size:11px}
  .pswing{grid-column:4;text-align:right}
  .gbr{font-size:28px}
  .gbside.w .gbr{font-size:36px}
}

/* ── チーム順位表 ──────────────────────────────────────────
   ⚠**로고를 쓰지 않는다.** 구단 구별은 색 마크와 짧은 이름으로 한다(CLAUDE.md §6). */
.standwrap{margin-bottom:16px}
.standwrap:last-of-type{margin-bottom:0}
.standname{margin:0 0 7px;font-size:11px;letter-spacing:.14em;font-weight:700;color:var(--tx-2)}
table.stand{font-variant-numeric:tabular-nums}
table.stand td,table.stand th{white-space:nowrap}
table.stand .rk{font-weight:700}
table.stand .rk em{font-style:normal;font-size:9px;color:var(--tx-3);margin-left:2px}

table.stand td.b{font-weight:700}
/* ⚠**타율과 방어율에도 분모를 붙인다**(M2). 勝率의 분모는 옆의 勝·敗 열 자체이지만,
   打率의 분모는 打数지 試合이 아니다 — 「인접」으로 지켜지지 않으므로 값에 붙인다 */
table.stand td.wd{line-height:1.2}
table.stand td.wd .den{display:block;font-size:9.5px;color:var(--tx-3);margin-top:1px}
/* 得失点差 — **우리가 만든 그림**. 눈금은 없고, 정확한 값은 바로 옆 숫자에 있다 */
table.stand .dif{position:relative;min-width:64px}
table.stand .dif b{font-weight:400}
table.stand .dif i{position:absolute;bottom:3px;height:3px;width:calc(var(--w) * 0.5%);
  background:var(--chip,#6b7280);font-style:normal;opacity:.75}
table.stand .dif i.p{left:50%}
table.stand .dif i.n{right:50%}

/* ── シーズン切り替え ────────────────────────────────────────
   ⚠**연도 두 개만 띄우지 않는다.** 「シーズン」이라는 이름이 없으면 그게 무엇을 고르는
   조작인지 알 수 없고, 순위표의 리그 탭과 헷갈린다. */
.seasons{display:flex;align-items:center;gap:4px;padding:5px var(--pad);
  border-bottom:1px solid var(--hair);background:var(--panel-2);flex-wrap:wrap}
.slab{font-size:9.5px;letter-spacing:.16em;color:var(--tx-3);margin-right:5px}
/* 시즌 중 이적 이력. ⚠**합계와 순위가 다른 이유**가 여기 적힌다 */
.stint{display:block;font-size:10.5px;color:var(--tx-3);margin-top:2px}
/* 「합계와 순위의 수가 왜 다른가」 — 이적 이력 바로 아래에 붙는다 */
.stint em{display:block;font-style:normal;font-size:10px;color:var(--tx-3);opacity:.85}
.seasons a{font-size:12px;padding:3px 10px;text-decoration:none;color:var(--tx-2);
  border:1px solid transparent;transition:color var(--fast) var(--ease)}
.seasons a:hover{color:var(--tx);border-color:var(--hair-2)}
.seasons a[aria-current="page"]{color:var(--tx);font-weight:700;border-color:var(--tx-3);background:var(--panel)}
/* 같은 화면이 그 시즌에 없어 다른 곳으로 보낼 때. **숨기지 않고 표시한다** */
.seasons a i{font-style:normal;font-size:9px;color:var(--tx-3);margin-left:3px}

/* ── 試合（直近の結果） ──────────────────────────────────────
   ⚠**원본 표(이닝별 스코어보드)를 재현하지 않는다**(L2). 우리가 가진 것은 R·H·E뿐이고,
   화면은 그 사실에 맞춰 만든다 — 없는 칸을 흉내 내지 않는다. */
.gcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:12px}
.gcard{border:1px solid var(--hair-2);padding:11px 12px 10px;min-width:0}
.gcard.off{opacity:.62}
.gvenue{margin:0 0 8px;font-size:10.5px;letter-spacing:.12em;color:var(--tx-3);font-weight:400;
  display:flex;align-items:baseline;gap:7px}
.gtie{margin-left:auto;color:var(--tx-2);letter-spacing:.04em}
.gscore{display:flex;flex-direction:column;gap:1px}
.gside{display:flex;align-items:baseline;gap:8px;padding:3px 0}
.gside .gt{display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--tx-2)}
.gside .gt i{width:9px;height:9px;background:var(--chip,#6b7280);font-style:normal;flex:none}
/* ⚠이긴 쪽은 **굵기와 크기**로 표시한다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.gside.w .gt{color:var(--tx);font-weight:700}
.gside .gr{margin-left:auto;font-size:20px;line-height:1;font-variant-numeric:tabular-nums;color:var(--tx-2)}
.gside.w .gr{font-size:26px;font-weight:700;color:var(--tx)}
.ghe{margin:8px 0 0;display:flex;gap:13px;font-size:11px;color:var(--tx-3);
  padding-top:7px;border-top:1px solid var(--hair)}
.ghe b{color:var(--tx-2);font-weight:400;font-variant-numeric:tabular-nums}
.gdec{margin:6px 0 0;display:flex;flex-wrap:wrap;gap:4px 11px;font-size:11.5px}
.gd b{font-size:9.5px;letter-spacing:.1em;color:var(--tx-3);font-weight:400;margin-right:4px}
.gd a{text-decoration:none;border-bottom:1px solid var(--hair-2)}
.gd a:hover{border-bottom-color:var(--tx-3)}
.gnone{margin:7px 0 0;font-size:11.5px;color:var(--tx-3)}
.gstars{list-style:none;margin:9px 0 0;padding:8px 0 0;border-top:1px solid var(--hair);
  display:flex;flex-direction:column;gap:4px}
.gstars li{display:flex;align-items:baseline;gap:6px;font-size:12px;min-width:0}
.gstars li i{width:3px;align-self:stretch;background:var(--chip,#6b7280);font-style:normal;flex:none}
.gstars a{text-decoration:none;font-weight:700;white-space:nowrap}
.gstars a:hover{text-decoration:underline}
.gsl{color:var(--tx-2);font-variant-numeric:tabular-nums;font-size:11.5px}
.gsd{margin-left:auto;font-style:normal;font-size:10px;color:var(--tx-3);border:1px solid var(--hair-2);padding:0 4px;flex:none}
.gmore{margin:9px 0 0;padding-top:8px;border-top:1px solid var(--hair);font-size:11.5px}
.gmore a{text-decoration:none;border-bottom:1px solid var(--hair-2)}
.gmore a:hover{border-bottom-color:var(--tx-3)}

/* ⚠**긴 표에는 걸지 않는다.** 한때 걸었다가 뺐다 — 실측으로 순위 화면의 scroller 80개 중
   실제로 렌더되는 것은 **2개**뿐이었다(나머지는 닫힌 탭 패널 안이라 이미 display:none 이다).
   그 2개는 대개 첫 화면 안에 있어 생략할 것이 없고, contain 의 부작용만 남는다.
   근거로 들었던 「대전 146행·순위 122행」은 전부 탭 패널 안이라 이 규칙이 애초에 안 닿는다. */

/* ── 球団ページ ────────────────────────────────────────────
   ⚠**로고를 쓸 수 없는 자리에서 팀을 구별하는 것은 구단 색과 이름이다**(§6).
   월별 막대는 우리가 계산한 값으로 만든 우리 그림이다. */
.tmonths{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px}
.tmonth{display:flex;flex-direction:column;gap:3px;min-width:0}
.tmonth b{font-size:11px;color:var(--tx-2);font-weight:400}
.tmonth s{text-decoration:none;font-size:10.5px;color:var(--tx-3);
  font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:5px}
.tmonth em{font-style:normal;font-size:9.5px}
/* 이긴 만큼과 진 만큼을 위아래로 — 색만으로 말하지 않게 수를 옆에 둔다 */
.tbar{display:flex;flex-direction:column;gap:1px;height:26px;justify-content:flex-end}
.tbar i{display:block;font-style:normal}
.tbar .w{height:calc(var(--w) * 0.24px);background:var(--team,#6b7280)}
.tbar .l{height:calc(var(--l) * 0.24px);background:var(--hair-2)}
/* 최근 경기 — 결과를 글자로 낸다. 색만 쓰면 색각 특성에 따라 구별되지 않는다 */
.trecent{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0 16px}
.trecent a{display:flex;align-items:baseline;gap:8px;padding:5px 0;text-decoration:none;
  border-bottom:1px solid var(--hair)}
.trecent b{font-size:13px;width:1.2em;text-align:center;color:var(--tx-3)}
.trecent li.w b{color:var(--team,#6b7280)}
.trecent li.l b{color:var(--tx-2)}
.trecent span{font-size:11.5px;color:var(--tx-2)}
.trecent s{text-decoration:none;margin-left:auto;font-size:11.5px}
.trecent a:hover{padding-left:4px}
/* 순위표·일람의 구단명이 링크가 됐다 — 밑줄 대신 색으로만 반응한다(인쇄물의 질감) */
.stand .tm a,.teamgroup h2 a{text-decoration:none}
.stand .tm a:hover,.teamgroup h2 a:hover{text-decoration:underline}

/* 상대전적 — 이긴 비율의 띠. 눈금은 없고 정확한 수는 옆 칸에 있다 */
table.vs .vsbar{display:inline-block;width:88px;height:6px;background:var(--hair);vertical-align:middle}
table.vs .vsbar i{display:block;height:100%;width:calc(var(--w,0) * 1%);background:var(--chip,#6b7280)}

/* ── ポストシーズン ────────────────────────────────────────
   ⚠**순위가 아니라 기록이다.** 표본이 13경기·5경기라 순위를 붙이면 거짓말이 된다 */
.postrow{margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.postrow>div{display:flex;flex-direction:column;gap:2px}
.postrow dt{font-size:10.5px;letter-spacing:.12em;color:var(--tx-3)}
/* ⚠**링크는 링크처럼 보이되 UA 기본 밑줄은 쓰지 않는다** — 이 사이트의 다른 링크와 같은 처리다.
   빠뜨리면 이 한 곳만 파란 밑줄에 hover 무반응이 되어 「여기만 남의 화면」이 된다 */
.postrow dt a{text-decoration:none;border-bottom:1px solid var(--hair-2)}
/* ⚠여기도 var(--tx-1)(미정의)이었다 — 이번 검토에서 같이 드러났다(2026-08-17).
   무효 선언이라 상속으로 메워져 「대충 진해지긴」 했지만 의도한 값이 아니었다 */
.postrow dt a:hover{border-bottom-color:var(--tx-3);color:var(--tx)}
.postrow dd{margin:0;font-size:15px;font-variant-numeric:tabular-nums}

/* ── 카드 전체를 누르기 ──────────────────────────────────────
   ⚠**링크를 하나 더 겹치지 않는다.** 이미 있는 「この試合の詳細」의 클릭 영역을
   카드 전체로 넓힌다. 겹쳐 두면 같은 목적지가 링크 목록에 두 번 나오고 탭도 두 번 걸린다.
   ⚠**안쪽 링크를 위로 올려야 한다.** 안 올리면 선수 이름을 눌러도 경기 상세로 간다 —
   눌린 것과 다른 곳으로 가는 것은 조용한 오작동이다. */
.tapcard{position:relative;transition:border-color var(--fast) var(--ease)}
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
.daybar{display:flex;align-items:stretch;gap:8px;margin:0 0 4px;padding:10px var(--pad);
  border-bottom:1px solid var(--hair)}
/* 화살표는 라벨과 **같은 줄**에 있어야 방향을 말한다 — daystep 이 세로 flex라 묶어야 한다 */
.dayrow{display:flex;align-items:baseline;gap:5px;white-space:nowrap}
.daystep i{font-style:normal;color:var(--tx-3)}
.daystep,.daypick{display:flex;flex-direction:column;gap:2px;text-decoration:none;font-size:12px;
  padding:5px 10px;border:1px solid var(--hair-2);min-width:0;
  transition:border-color var(--fast) var(--ease),color var(--fast) var(--ease)}
.daystep s,.daypick s{text-decoration:none;font-size:10px;color:var(--tx-3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.daystep:hover,.daypick:hover{border-color:var(--tx-3);color:var(--tx)}
.daystep.n{margin-left:auto;text-align:right}
.daypick{margin:0 auto;text-align:center}
/* ⚠**끝에 왔으면 링크가 아니다.** href 없는 a 는 초점도 안 받고 눌러도 아무 일이 없어서,
   「더 있다」고 조용히 거짓말하지 않는다 */
.daystep.off{color:var(--tx-3);border-style:dashed;opacity:.5}
.daystep.n.off{margin-left:auto}
@media (max-width:520px){
  .daybar{flex-wrap:wrap}
  .daypick{order:3;width:100%;margin:0}
}
/* 날짜 일람 — 달마다 한 덩어리 */
.daygrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:5px}
.dayc{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 4px;
  text-decoration:none;border:1px solid var(--hair-2);
  transition:border-color var(--fast) var(--ease),background var(--fast) var(--ease)}
.dayc b{font-size:16px;font-variant-numeric:tabular-nums;color:var(--tx)}
.dayc s{text-decoration:none;font-size:9.5px;color:var(--tx-3);display:flex;gap:4px;align-items:baseline}
.dayc em{font-style:normal;color:var(--tx-2);border:1px solid var(--hair-2);padding:0 3px}
.dayc:hover{border-color:var(--tx-3);background:var(--panel-2)}
/* 지금 보고 있는 최신 경기일 */
.dayc.now{border-color:var(--tx);background:var(--panel-2)}

/* 予告先発の要約 — 상세는 予告先発 페이지가 낸다 */
.pbcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.pbcard{border:1px solid var(--hair-2);padding:10px 11px}
.pbside{display:flex;align-items:baseline;gap:7px;padding:3px 0;min-width:0}
.pbt{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--tx-3);flex:none}
.pbt i{width:8px;height:8px;background:var(--chip,#6b7280);font-style:normal}
.pbn{font-size:13.5px;text-decoration:none;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbn:hover{text-decoration:underline}
.pbn.empty{font-weight:400;color:var(--tx-3);font-size:11.5px}
.pbe{margin-left:auto;font-size:11px;color:var(--tx-2);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.pbe s{text-decoration:none;color:var(--tx-3);font-size:9.5px;margin-left:4px}

/* ── 選手をくらべる ──────────────────────────────────────────
   ⚠**두 열의 폭을 같게 고정한다.** 이름 길이에 따라 열이 움직이면 값이 세로로 안 맞고,
   그러면 비교라는 이 화면의 유일한 목적이 사라진다. */
.cmpwrap{padding:16px var(--pad);border-bottom:1px solid var(--hair)}
.cmphead{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px}
.cmpwho{padding:9px 11px;border:1px solid var(--hair-2);border-top:3px solid var(--who,#6b7280);min-width:0}
.cmpwho .nm{display:block;font-size:16px;font-weight:700;line-height:1.25}
.cmpwho .nm a{text-decoration:none}
.cmpwho .nm a:hover{text-decoration:underline}
.cmpwho .sub{display:block;font-size:11px;color:var(--tx-3);margin-top:3px}
.cmpwho .smp{display:block;font-size:11px;color:var(--tx-2);margin-top:5px;font-variant-numeric:tabular-nums}
/* 겹친 紋 — 두 선수를 같은 판에 그린다. 색만으로 구별하지 않고 범례를 붙인다 */
.cmpfig{max-width:300px;margin:14px auto 4px}
.cmpfig svg{display:block;width:100%;height:auto;overflow:visible}
.cmpfig .cf-a{fill-opacity:.30;stroke-width:1.8;stroke-linejoin:round}
.cmpfig .cf-b{fill-opacity:0;stroke-width:1.8;stroke-linejoin:round;stroke-dasharray:4 3}
.cmpkey{display:flex;gap:14px;justify-content:center;font-size:11px;color:var(--tx-2);margin:2px 0 0}
.cmpkey span{display:inline-flex;align-items:center;gap:5px}
.cmpkey i{width:16px;height:0;border-top-width:2px;font-style:normal}
.cmpkey .ka i{border-top-style:solid}
.cmpkey .kb i{border-top-style:dashed}
/* 값 표 — 라벨을 가운데 두고 값을 양쪽으로 민다. 어느 쪽 열인지 눈이 헤매지 않는다 */
.cmprow{display:grid;grid-template-columns:1fr 8.5em 1fr;align-items:baseline;gap:0 8px;
  padding:7px 0;border-bottom:1px solid var(--hair)}
.cmprow .lb{grid-column:2;text-align:center;font-size:11px;color:var(--tx-3);letter-spacing:.06em}
.cmprow .va,.cmprow .vb{font-variant-numeric:tabular-nums;font-size:17px;line-height:1.15;min-width:0}
.cmprow .va{grid-column:1;text-align:right}
.cmprow .vb{grid-column:3;text-align:left}
.cmprow .den{display:block;font-size:10px;color:var(--tx-3);margin-top:2px;font-variant-numeric:tabular-nums}
/* ⚠**이긴 쪽에만 표시를 붙인다.** 양쪽에 붙이면 아무 말도 안 한 것과 같다 */
.cmprow .win{font-weight:700}
.cmprow .win::after{content:"◂";margin-left:5px;color:var(--g-vgood);font-size:12px}
.cmprow .vb.win::after{content:none}
.cmprow .vb.win::before{content:"▸";margin-right:5px;color:var(--g-vgood);font-size:12px}
.cmprow .g{display:inline-block;width:14px;height:3px;vertical-align:2px;margin-left:5px;background:var(--g-avg)}
.cmprow .g.g-veryGood{background:var(--g-vgood)}
.cmprow .g.g-good{background:var(--g-good)}
.cmprow .g.g-bad{background:var(--g-bad)}
.cmprow .g.g-veryBad{background:var(--g-vbad)}
.cmprow .vb .g{margin-left:0;margin-right:5px}
.cmpwarn{margin:0 0 12px;padding:9px 11px;font-size:12px;line-height:1.6;color:var(--tx-2);
  border-left:3px solid var(--g-bad);background:var(--panel-2);max-width:64ch}
/* 「나란히 못 놓는다」로 끝내지 않고 갈 곳을 준다 */
.cmpgo{display:inline-block;margin-top:10px;font-size:13px;padding:6px 12px;
  border:1px solid var(--hair-2);text-decoration:none}
.cmpgo:hover{border-color:var(--tx-2);background:var(--panel-2)}
@media (max-width:560px){
  .cmprow{grid-template-columns:1fr 6.4em 1fr}
  .cmprow .va,.cmprow .vb{font-size:15px}
  .cmpwho .nm{font-size:14px}
}

/* ── 색인 ────────────────────────────────────────────────── */
.find{padding:14px var(--pad);border-bottom:1px solid var(--hair)}
.find label{display:block;font-size:10.5px;letter-spacing:.16em;color:var(--tx-3);margin-bottom:6px}
.find input{font:inherit;font-size:15px;padding:8px 10px;width:100%;max-width:420px;background:var(--panel);
  color:var(--tx);border:1px solid var(--hair-2)}
.chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:11px}
.chip{font:inherit;font-size:11.5px;padding:4px 9px;cursor:pointer;background:transparent;color:var(--tx-2);
  border:1px solid var(--hair-2);white-space:nowrap;transition:all var(--fast) var(--ease)}
.chip:hover{color:var(--tx);border-color:var(--tx-3)}
.chip[aria-pressed="true"]{background:var(--chip,#6b7280);color:var(--chip-ink,#fff);border-color:var(--chip,#6b7280);font-weight:700}
.count{font-size:11px;color:var(--tx-3);margin-top:10px}
.teamgroup{padding:14px var(--pad);border-bottom:1px solid var(--hair)}
.teamgroup[hidden]{display:none}
.teamgroup h2{margin:0 0 8px;font-size:11px;letter-spacing:.14em;font-weight:700;
  display:flex;align-items:center;gap:8px}
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
.roster{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:0 16px}
.roster li[hidden]{display:none}
.roster a{display:flex;gap:8px;align-items:baseline;padding:5px 0;text-decoration:none;border-bottom:1px solid var(--hair);
  transition:padding-left var(--fast) var(--ease)}
/* ⚠**명부의 성적 줄.** 규칙이 없으면 body 기본 16px·--tx 로 그려져 **선수 이름(13px)보다
   크고 진해진다** — 실측 1,397칸. 검색 드롭다운의 .qhits .hs 는 그쪽 전용이라 여기 안 걸린다 */
.roster .hs{flex:0 0 auto;margin-left:8px;font-size:10.5px;color:var(--tx-3);
  font-variant-numeric:tabular-nums;white-space:nowrap}
@media (max-width:520px){.roster .hs{display:none}}
.roster a:hover{padding-left:4px}
.roster .hn{font-size:13px}
.roster .hp{margin-left:auto;font-size:10px;color:var(--tx-3)}
/* 즐겨찾기 표식 — 순서를 바꾸지 않고 **표시만** 얹는다.
   순서를 바꾸면 「내 선수가 어디 갔지」가 되고, 명감의 배열이 무너진다 */
.roster li[data-favon="true"] .hn::before{content:"★";color:var(--team,#6b7280);margin-right:4px;font-size:10px}
.chip.fav i{font-style:normal;margin-right:4px}
.chip.fav s{text-decoration:none;margin-left:4px;font-size:10px;opacity:.8}
.chip.fav[hidden]{display:none}
.favbtn{font:inherit;font-size:13px;line-height:1;margin-left:8px;padding:2px 6px;cursor:pointer;
  background:transparent;border:1px solid var(--hair-2);color:var(--tx-3);vertical-align:middle;
  transition:color var(--fast) var(--ease),border-color var(--fast) var(--ease)}
.favbtn:hover{color:var(--tx-2);border-color:var(--tx-3)}
.favbtn[aria-pressed="true"]{color:var(--team,#6b7280);border-color:var(--team,#6b7280)}
.favbtn[hidden]{display:none}

.foot{padding:18px var(--pad);color:var(--tx-3);font-size:11.5px}
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

/* ── 반응형 ──────────────────────────────────────────────── */
@media (max-width:900px){
  :root{--pad:16px}
  .bar{grid-template-columns:76px 1fr 118px;gap:8px}
}
@media (max-width:680px){
  :root{--pad:13px;--topbar:44px}
  .shell{grid-template-columns:7px 1fr}
  .spine{padding:0}
  .spine .vt{display:none}
  /* 화면이 좁으면 레일까지 고정하면 본문이 사라진다 — 헤더만 남긴다 */
  .rail{position:static}
  .qbox{max-width:none}
  .tnav a{padding:5px 7px}
  .idline{gap:11px;padding-top:13px}
  .mark .mk{width:42px;height:42px}
  .spark{width:100%;margin-left:0;align-items:flex-start}
  .cols{grid-template-columns:1fr;gap:0}
  .bars{max-width:none}
  .bar{grid-template-columns:1fr;gap:2px}
  .bar em{text-align:left}
  .roster{grid-template-columns:1fr}
  th,td{padding:6px 7px}
}
@media (max-width:480px){
  /* 링크가 4개가 되면 한 줄에 브랜드·검색·내비·테마가 다 들어가지 않는다.
     검색창을 아랫줄로 내린다 — 줄이는 것보다 두 줄이 낫다 */
  .topbar{height:auto;flex-wrap:wrap;padding:6px 10px 8px;gap:6px}
  .qbox{order:3;flex-basis:100%;max-width:none}
  .tnav{margin-left:auto}
}
@media (max-width:420px){
  .brand{font-size:12px;letter-spacing:.08em}
  .tnav a{font-size:11px;padding:5px 6px}
}
/* 손가락은 마우스보다 크다 */
@media (pointer:coarse){
  .tab,.chip{padding:7px 12px}
  .mv{padding:6px 11px}
  .tnav a{padding:9px 10px}
  .roster a,.qhits li a{padding-top:8px;padding-bottom:8px}
  /* ⚠**접힘 손잡이도 여기 든다.** 글자가 10px이라 손가락으로는 높이 16px 남짓인데,
     이게 목록을 여는 유일한 자리다 — 빠뜨리면 그 화면이 휴대폰에서 안 열린다 */
  .pickfold>summary{padding:6px 0}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}
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
  .rail{position:static;overflow:visible;background:transparent;border:0;padding:8px 0 0;min-height:0}
  .block[hidden]{display:block}
  /*
     ⚠**닫힌 탭을 펼치지 않는다.** 한때 펼쳤다가 되돌렸다 — 실측으로 순위 화면이
     14행에서 **2,432행**이 됐고(패널 78개), 그 표들에는 **이름이 없었다.**
     탭줄을 조작으로 보고 함께 숨겼기 때문이다. 패널의 유일한 라벨이 그 탭줄이다.
     종이에는 여는 수단이 없지만 **고르는 것은 인쇄 전에 할 수 있다** — 보고 있는 것을 찍는다.
  */
  /* ⚠**탭줄은 조작이면서 「고른 것의 이름」이다.** 통째로 숨기면 표에서 이름이 사라진다 —
     고른 것만 글자로 남기고 버튼 모양은 지운다 */
  .tab{border:0;background:transparent!important;color:inherit!important;padding:0 8px 0 0;font-weight:700}
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
  .foot a[href^="http"]::after{content:" (" attr(href) ")";font-size:9px;color:#555}
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
const BLOCKS=window.__BLOCKS__||[];
/* 용어집. 서버와 같은 정의 한 벌을 쓴다(M1) */
const GLOSSARY=__GLOSSARY__;
const PRESETS=window.__PRESETS__||{};

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
  /* select 로 좁힌 값(구단 등) */
  picked:(saved.picked&&typeof saved.picked==="object")?saved.picked:{},
  /* 즐겨찾기한 선수 ID. **이 브라우저에만 남는다** — 서버로 가지 않는다 */
  favs:Array.isArray(saved.favs)?saved.favs.filter(x=>typeof x==="string"):[],
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
      p.hidden=cur!=="all"&&p.dataset.panelkey!==cur;
      if(!p.hidden)slide(p,dir);
    });
    $$('[data-tabgroup="'+g+'"] [data-tab]').forEach(b=>{
      b.setAttribute("aria-selected",String(b.dataset.tab===cur));
    });
  });
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
  const pad=state.density==="compact"?"9px":"16px";
  $$(".block").forEach((el,i)=>{el.style.paddingTop=pad;el.style.paddingBottom=pad;el.style.setProperty("--i",String(i))});
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
if(tip&&typeof GLOSSARY!=="undefined"){
  let current=null;
  const hide=()=>{
    if(current)current.setAttribute("aria-expanded","false");
    current=null;tip.hidden=true;
  };
  const show=(btn)=>{
    const t=GLOSSARY[btn.dataset.term];
    if(!t)return;
    tip.textContent="";
    const b=doc.createElement("b");b.textContent=t.label;tip.appendChild(b);
    const p=doc.createElement("span");p.textContent=t.short;tip.appendChild(p);
    if(t.how){const s=doc.createElement("s");s.textContent=t.how;tip.appendChild(s)}
    if(t.caveat){const u=doc.createElement("u");u.textContent=t.caveat;tip.appendChild(u)}
    tip.hidden=false;
    if(current&&current!==btn)current.setAttribute("aria-expanded","false");
    current=btn;btn.setAttribute("aria-expanded","true");
    place(btn);
  };
  /* 화면 밖으로 나가지 않게 가로 위치를 접는다. 세로는 자리가 없으면 위로 올린다 */
  const place=(btn)=>{
    if(!btn.getBoundingClientRect||!tip.getBoundingClientRect)return;
    const r=btn.getBoundingClientRect();
    const w=tip.offsetWidth||260,h=tip.offsetHeight||90;
    const vw=(doc.documentElement&&doc.documentElement.clientWidth)||w;
    const sx=(typeof window!=="undefined"&&window.scrollX)||0;
    const sy=(typeof window!=="undefined"&&window.scrollY)||0;
    let x=r.left+sx;
    if(x+w>sx+vw-8)x=sx+vw-w-8;
    if(x<sx+8)x=sx+8;
    const above=r.top>h+12;
    tip.style.left=x+"px";
    tip.style.top=(above?r.top+sy-h-8:r.bottom+sy+8)+"px";
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
      /* 터치: 같은 것을 다시 누르면 닫는다 */
      btn.addEventListener("click",(e)=>{
        if(e&&e.preventDefault)e.preventDefault();
        if(current===btn)hide();else show(btn);
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
  /* ⚠표를 가로로 밀면 설명만 제자리에 남는다 — 좌표를 문서 기준으로 잡기 때문이다. 닫는다 */
  doc.addEventListener("scroll",hide,true);
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

  /* 대전 표만의 사정: 「対戦を選ぶ」에서 ?vs= 로 넘어온 이름을 좁히기에 미리 넣는다 */
  if(id==="matchup"&&finder){
    const vs=vsParam();
    if(vs!==""){
      finder.value=vs;
      /* 대전 블록이 꺼져 있으면 이번 방문에만 켠다 — 사용자의 저장된 구성은 건드리지 않는다 */
      if(state.order.indexOf("matchup")<0)state.order=state.order.concat(["matchup"]);
    }
  }
});

/* ── 순위표의 「規定到達のみ / 全員」 ──

   ⚠**여기서 다시 순위를 매기지 않는다**(M1/M3). 서버가 **같은 rankBy 한 벌**로
   두 번 매겨 두 순위를 다 보냈다. 클라이언트가 매기면 동률 규칙이 갈릴 수 있고,
   순위는 규칙이 곧 값이다.

   ⚠**기본은 「규정 도달자만」이고, 미달 행은 서버가 이미 hidden 으로 보낸다.**
   스크립트가 없으면 지금까지와 똑같은 화면이 나온다 — 이 기능은 더해지는 쪽이다. */
$$("[data-rankonly]").forEach(btn=>{
  const id=btn.dataset.rankonly;
  const box=btn.closest?btn.closest(".block"):null;
  const scope=box||doc;
  /* 같은 화면에 지표 패널이 여럿이라 **이 패널의 표만** 잡아야 한다 */
  const panel=btn.parentNode&&btn.parentNode.parentNode?btn.parentNode.parentNode:scope;
  const rows=$$("tbody tr",panel);
  const countEl=$('[data-rankcount="'+id+'"]',panel);
  if(rows.length===0)return;
  if(!state.rankAll||typeof state.rankAll!=="object")state.rankAll={};

  const apply=()=>{
    const all=state.rankAll[id]===true;
    let n=0;
    rows.forEach(tr=>{
      const q=tr.dataset.qualified==="1";
      tr.hidden=!all&&!q;
      if(!tr.hidden)n++;
      /* 순위 칸을 바꿔 넣는다 — 두 값이 다 실려 있으므로 고르기만 한다 */
      const a=$("[data-rankq]",tr),b=$("[data-ranka]",tr);
      if(a)a.hidden=all;
      if(b)b.hidden=!all;
    });
    btn.setAttribute("aria-pressed",String(!all));
    if(countEl)countEl.textContent=n+"人";
  };
  btn.addEventListener("click",()=>{
    state.rankAll[id]=state.rankAll[id]!==true;save(state);apply();
  });
  apply();
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

/* ── 선수 고르기 ──
   헤더 검색과 「対戦を選ぶ」 화면이 **같은 구현**을 쓴다. 두 벌로 나누면 키보드 조작이
   한쪽에만 붙는 식으로 어긋난다. */
function attachPicker(input,list,onPick){
  if(!input||!list)return null;
  let rows=[],active=-1;
  const close=()=>{list.hidden=true;input.setAttribute("aria-expanded","false");active=-1};
  /* @param items 배열이면 결과, **null 이면 아직 읽는 중**이다 */
  const draw=(items,failed)=>{
    list.textContent="";
    const one=(text)=>{const li=doc.createElement("li");li.className="none";li.textContent=text;list.appendChild(li)};
    if(failed)one("選手一覧を読み込めませんでした。再読み込みしてください。");
    /* ⚠**「읽는 중」과 「없음」은 다르다**(M12의 4상태). 실패와 0건에는 문구가 있는데
       로딩만 없어서, 느린 회선에서는 목록이 안 뜨는 동안 「검색이 고장났다」로 읽힌다 */
    else if(items===null)one("読み込み中…");
    else if(!items.length)one("該当なし");
    else (items||[]).forEach((p,i)=>{
      const li=doc.createElement("li");
      // combobox의 목록 항목은 role=option이어야 aria-selected가 뜻을 갖는다
      li.setAttribute("role","option");
      li.setAttribute("aria-selected",String(i===active));
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
    list.hidden=false;input.setAttribute("aria-expanded","true");
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
      rows=idx.filter(p=>p.n.indexOf(term)>=0||p.t.indexOf(term)>=0
        ||(p.kf&&p.kf.indexOf(q)>=0)||p.u===term).slice(0,20);
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
    go(BASE+"players/"+chosen.batter.i+".html?vs="+encodeURIComponent(chosen.pitcher.n)+"#b-matchup");
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

  /* 값 하나를 그린다. ⚠등급 막대는 **값 뒤**에 온다 — 분모를 모르고 본 색은 근거가 없다 */
  const cell=(st,cls,win)=>{
    const d=el("div",cls+(win?" win":""));
    d.appendChild(doc.createTextNode(st&&st.v!==null?st.v:"—"));
    if(st&&st.g){const g=el("i","g g-"+st.g);g.setAttribute("aria-hidden","true");d.appendChild(g)}
    if(st&&st.d)d.appendChild(el("span","den",st.d));
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
    const poly=(pts,cls,color)=>{
      const p=doc.createElementNS(NS,"polygon");
      p.setAttribute("points",pts);p.setAttribute("class",cls);
      if(color){p.setAttribute("fill",color);p.setAttribute("stroke",color)}
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
    const one=(cls,c,name)=>{const s=el("span",cls);const i=el("i");i.style.borderTopColor=c;
      s.appendChild(i);s.appendChild(doc.createTextNode(name));return s};
    key.appendChild(one("ka",A.color.base,A.name));
    key.appendChild(one("kb",B.color.base,B.name));
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
      go.href=BASE+"players/"+bat.id+".html?vs="+encodeURIComponent(pit.name)+"#b-matchup";
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
      row.appendChild(cell(sa,"va",w==="a"));
      const lb=el("span","lb");
      /* 용어집 툴팁을 그대로 태운다 — 설명을 여기서 새로 쓰지 않는다(M1).
         ⚠**진짜 버튼으로 만든다.** 그래야 터치로도 열리고 키보드에도 잡힌다 */
      if(GLOSSARY[sa.k]){
        const t=doc.createElement("button");t.type="button";t.className="term";
        t.setAttribute("data-term",sa.k);t.setAttribute("aria-describedby","tip");
        t.textContent=sa.l;lb.appendChild(t);
      }else lb.appendChild(doc.createTextNode(sa.l));
      row.appendChild(lb);
      row.appendChild(cell(sb,"vb",w==="b"));
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
}

press(".rail [data-preset]","preset",state.preset);
press(".rail [data-density]","density",state.density);
applyTheme();renderBlocks();renderEditor();showTabs();paintFav();revealHash();
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
  return template.replace("__GLOSSARY__", () => json);
}

export const CLIENT_JS = embedGlossary(CLIENT_JS_TEMPLATE);
