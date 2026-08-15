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

export const CSS = `
:root {
  --page:#fbfaf7; --tx:#17171a; --tx-2:#5d5d59; --tx-3:#8d8d87;
  --hair:#e0dfd8; --hair-2:#cfcec5; --panel:#ffffff; --panel-2:#f3f1ec;
  --warn:#a8452f; --ok:#3f6b4a;
  --f-body:"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans JP","Meiryo",system-ui,sans-serif;
  --f-num:"SFMono-Regular","Consolas","Menlo","Yu Gothic",monospace;
  --topbar:46px;
  --ease:cubic-bezier(.2,.6,.2,1);
  --fast:120ms; --mid:200ms;
  --pad:20px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#7b7a74;
    --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --panel-2:#23262c;
    --warn:#e08a72; --ok:#8fc09c;
  }
}
:root[data-theme="dark"] {
  --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#7b7a74;
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
.qhits .ht{margin-left:auto;font-size:10.5px;color:var(--tx-3);white-space:nowrap}
.qhits .none{padding:7px 11px;font-size:12px;color:var(--tx-3)}
.tnav{display:flex;gap:2px;margin-left:auto}
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
.idline .nm{font-size:clamp(21px,5vw,26px);font-weight:700;letter-spacing:.08em;line-height:1.2}
.idline .sub{font-size:11.5px;color:var(--tx-2);letter-spacing:.06em}
.spark{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.spark svg{display:block;overflow:visible}
.spark .sl{font-family:var(--f-num);font-size:9.5px;color:var(--tx-3);letter-spacing:.06em}
.idline .asof{font-family:var(--f-num);font-size:11px;color:var(--tx-3)}

/* ── 조작 레일 ───────────────────────────────────────────── */
.rail{position:sticky;top:var(--topbar);z-index:10;display:flex;align-items:center;gap:6px;
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
.rail>.tabs,.block>h4 .sw,.block>h4 .sw>.tabs{min-width:0}

/* ── 조립 UI ─────────────────────────────────────────────── */
.editor{padding:14px var(--pad) 16px;border-bottom:1px solid var(--hair);background:var(--panel)}
.editor[hidden]{display:none}
.editor h3{margin:0 0 3px;font-size:12px;letter-spacing:.14em;color:var(--tx-2);font-weight:600}
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
.block>h4{margin:0 0 9px;font-size:10.5px;letter-spacing:.19em;color:var(--tx-2);font-weight:600;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.block>h4 .sw{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.block>h4 .qt{letter-spacing:0;font-weight:400;color:var(--tx-3)}
[data-panelgroup]{animation:fade var(--fast) var(--ease)}
[data-panelgroup][hidden]{display:none}

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
.rolecol .subhead{margin:0 0 4px}
.rolecol dl{margin:0}

/* ⚠좁은 화면에서 표를 옆으로 밀면 **누구의 행인지**가 먼저 사라진다.
   첫 열을 고정해서 이름이 남게 한다. 오른쪽 끝의 그늘은 「더 있다」는 신호다. */
.scroller{overflow-x:auto;-webkit-overflow-scrolling:touch;position:relative;
  background:linear-gradient(to left,var(--page),rgba(0,0,0,0) 24px) right center / 24px 100% no-repeat}
.scroller table{background:var(--page)}
.scroller th:first-child,.scroller td:first-child{position:sticky;left:0;z-index:1;background:var(--page)}
.scroller tr.me td:first-child{background:var(--team,#6b7280)}
.scroller tbody tr:hover td:first-child{background:var(--panel-2)}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--hair);white-space:nowrap}
th{font-size:10px;letter-spacing:.1em;color:var(--tx-2);font-weight:500;position:sticky;top:0;background:var(--page)}
td.l,th.l{text-align:left}
tbody tr{transition:background var(--fast) var(--ease)}
tbody tr:hover{background:var(--panel-2)}
tr.me td{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:700}
tr.me:hover td{background:var(--team,#6b7280)}
tr.thin td{color:var(--tx-3)}
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
.dg .c.thin u{color:var(--tx-3)}

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
.teamgroup h4{margin:0 0 8px;font-size:11px;letter-spacing:.14em;font-weight:700;
  display:flex;align-items:center;gap:8px}
.teamgroup h4 i{width:11px;height:11px;background:var(--chip,#6b7280);font-style:normal}
.roster{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:0 16px}
.roster li[hidden]{display:none}
.roster a{display:flex;gap:8px;align-items:baseline;padding:5px 0;text-decoration:none;border-bottom:1px solid var(--hair);
  transition:padding-left var(--fast) var(--ease)}
.roster a:hover{padding-left:4px}
.roster .hn{font-size:13px}
.roster .hp{margin-left:auto;font-size:10px;color:var(--tx-3)}

.foot{padding:18px var(--pad);color:var(--tx-3);font-size:11.5px}
.foot a{text-decoration:underline}

@keyframes rise{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes drop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}

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
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}
}
@media print{
  .topbar,.rail,.editor,.skip{display:none}
  .block[hidden]{display:block}
  .shell{grid-template-columns:0 1fr}
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
  // 대전 표의 정렬. 저장된 열이 지금 표에 없으면 표를 그릴 때 기본으로 되돌린다
  matchup:(saved.matchup&&typeof saved.matchup==="object")?saved.matchup:null,
  matchupTeam:typeof saved.matchupTeam==="string"?saved.matchupTeam:"",
  grades:saved.grades!==false,
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
function showTabs(){
  Object.keys(tabGroups()).forEach(g=>{
    const cur=state.tabs[g];
    // "all"은 특별 취급 — 골라 보는 화면에서 「전부」를 뺏지 않는다
    $$('[data-panelgroup="'+g+'"]').forEach(p=>{p.hidden=cur!=="all"&&p.dataset.panelkey!==cur});
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
      state.tabs[g]=b.dataset.tab;save(state);showTabs();
    }));
  });
})();

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
  $$("[data-term]").forEach(btn=>{
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
  doc.addEventListener("keydown",(e)=>{if(e&&e.key==="Escape")hide()});
  doc.addEventListener("click",(e)=>{
    let n=e&&e.target;
    while(n){if(n===tip||(n.getAttribute&&n.getAttribute("data-term")))return;n=n.parentNode}
    hide();
  });
  /* ⚠표를 가로로 밀면 설명만 제자리에 남는다 — 좌표를 문서 기준으로 잡기 때문이다. 닫는다 */
  doc.addEventListener("scroll",hide,true);
}

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

/* ── 상대전적 좁히기·정렬 ──
   ⚠**막지 않고 말한다.** 대전 표본은 대부분 한 자릿수라 율로 정렬하면 적은 타석이 위로 온다.
   정렬 자체를 막는 대신, **지금 무엇으로 정렬돼 있고 얇은 행이 몇 개 섞였는지**를 늘 낸다. */
const THIN_MATCHUP_PA=10;
/* 질의문자열 vs=山本 — 「対戦を選ぶ」에서 넘어온 상대 이름 */
function vsParam(){
  const m=/[?&]vs=([^&#]*)/.exec(LOC.search||"");
  if(!m)return "";
  try{return decodeURIComponent(m[1].replace(/\\+/g," "))}catch(e){return ""}
}
const mtable=$("#matchupTable");
if(mtable){
  const tbody=$("tbody",mtable);
  const all=$$("tr",tbody);
  const mfilter=$("#matchupFilter");
  const mteam=$("#matchupTeam");
  const empty=$("#matchupEmpty");
  const status=$("#matchupStatus");
  const heads=$$("th",mtable);
  const buttons=$$(".sortable",mtable);
  const labelOf={},typeOf={},rateOf={};
  buttons.forEach(b=>{
    labelOf[b.dataset.sortkey]=b.textContent;
    typeOf[b.dataset.sortkey]=b.dataset.sorttype;
    rateOf[b.dataset.sortkey]=b.dataset.sortrate==="1";
  });

  if(!state.matchup||typeof state.matchup!=="object"||!labelOf[state.matchup.key]){
    state.matchup={key:"pa",dir:"desc"};
  }

  /* ⚠**값이 없는 행은 방향과 무관하게 뒤로 보낸다.** 오름차순에서 「기록 없음」이 1위가 되면
     비어 있다는 사실이 성적처럼 읽힌다(M11). */
  const compare=(a,b,key)=>{
    const av=a.dataset[key],bv=b.dataset[key];
    if(typeOf[key]==="text")return String(av||"").localeCompare(String(bv||""),"ja");
    return Number(av)-Number(bv);
  };

  const apply=()=>{
    const key=state.matchup.key,dir=state.matchup.dir;
    const min=Number(state.tabs.matchupMin||"1");
    const term=mfilter?mfilter.value.trim():"";
    const team=mteam?mteam.value:"";
    const sign=dir==="asc"?1:-1;

    const sorted=all.slice().sort((a,b)=>{
      const miss=(a.dataset[key]===undefined?1:0)-(b.dataset[key]===undefined?1:0);
      if(miss!==0)return miss;
      return sign*compare(a,b,key)||(Number(b.dataset.pa)-Number(a.dataset.pa));
    });

    let n=0,thin=0;
    sorted.forEach(tr=>{
      tbody.appendChild(tr);
      const hit=Number(tr.dataset.pa)>=min
        &&(term===""||tr.dataset.name.indexOf(term)>=0)
        &&(team===""||tr.dataset.teamcode===team);
      tr.hidden=!hit;
      if(hit){n++;if(Number(tr.dataset.pa)<THIN_MATCHUP_PA)thin++}
    });

    const c=$("#matchupCount");if(c)c.textContent=n+"件";
    /* ⚠**0건을 빈 표로 두지 않는다.** 「대전이 없다」와 「고장났다」가 같은 화면이면 결함이다(M12) */
    if(empty)empty.hidden=n!==0;

    heads.forEach(th=>{
      const b=$(".sortable",th);
      const on=b&&b.dataset.sortkey===key;
      th.setAttribute("aria-sort",on?(dir==="asc"?"ascending":"descending"):"none");
    });

    if(status){
      let text=typeOf[key]==="text"
        ?labelOf[key]+(dir==="asc"?" 昇順":" 降順")
        :labelOf[key]+(dir==="asc"?"の少ない順":"の多い順");
      if(team!==""&&mteam)text+=" · "+mteam.options[mteam.selectedIndex].textContent;
      if(min>1)text+=" · "+min+"打席以上";
      if(rateOf[key]&&min<THIN_MATCHUP_PA&&thin>0){
        text+=" · ⚠"+THIN_MATCHUP_PA+"打席未満が"+thin+"件混ざっています（率は標本が小さいほど揺れます）";
      }
      status.textContent=text;
    }
  };

  /* 같은 열을 다시 누르면 방향이 뒤집힌다. 다른 열은 그 열에 자연스러운 방향에서 시작한다 —
     이름·구단은 오름차순, 수치는 내림차순 */
  buttons.forEach(b=>b.addEventListener("click",()=>{
    const key=b.dataset.sortkey;
    state.matchup=state.matchup.key===key
      ?{key:key,dir:state.matchup.dir==="desc"?"asc":"desc"}
      :{key:key,dir:typeOf[key]==="text"?"asc":"desc"};
    save(state);apply();
  }));
  if(mfilter)mfilter.addEventListener("input",apply);
  if(mteam)mteam.addEventListener("change",()=>{state.matchupTeam=mteam.value;save(state);apply()});
  /* 저장된 구단이 이 선수의 선택지에 없으면 「すべて」로 되돌린다 — 0건 화면이 되지 않게 */
  if(mteam&&typeof state.matchupTeam==="string"){
    const ok=Array.prototype.some.call(mteam.options,o=>o.value===state.matchupTeam);
    mteam.value=ok?state.matchupTeam:"";
  }
  tabHooks.push(apply);

  const vs=vsParam();
  if(vs!==""&&mfilter){
    mfilter.value=vs;
    /* 대전 블록이 꺼져 있으면 이번 방문에만 켠다 — 사용자의 저장된 구성은 건드리지 않는다 */
    if(state.order.indexOf("matchup")<0)state.order=state.order.concat(["matchup"]);
  }
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
  const draw=(items,failed)=>{
    list.textContent="";
    const one=(text)=>{const li=doc.createElement("li");li.className="none";li.textContent=text;list.appendChild(li)};
    if(failed)one("選手一覧を読み込めませんでした。再読み込みしてください。");
    else if(!items.length)one("該当なし");
    else items.forEach((p,i)=>{
      const li=doc.createElement("li");
      // combobox의 목록 항목은 role=option이어야 aria-selected가 뜻을 갖는다
      li.setAttribute("role","option");
      li.setAttribute("aria-selected",String(i===active));
      const a=doc.createElement("a");a.href=BASE+"players/"+p.i+".html";
      const n=doc.createElement("span");n.className="hn";n.textContent=p.n;
      const t=doc.createElement("span");t.className="ht";t.textContent=p.t;
      a.appendChild(n);a.appendChild(t);li.appendChild(a);
      if(onPick)a.addEventListener("click",(e)=>{if(e&&e.preventDefault)e.preventDefault();onPick(p);close()});
      list.appendChild(li);
    });
    list.hidden=false;input.setAttribute("aria-expanded","true");
  };
  const run=()=>{
    const term=input.value.trim();
    if(term===""){close();return}
    withIndex(idx=>{
      if(!idx){draw([],true);return}
      rows=idx.filter(p=>p.n.indexOf(term)>=0||p.t.indexOf(term)>=0).slice(0,20);
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
  attachPicker($("#pickPitcher"),$("#pickPitcherHits"),(p)=>{
    const i=$("#pickPitcher");if(i)i.value=p.n;show("pitcher",p);
  });
  attachPicker($("#pickBatter"),$("#pickBatterHits"),(p)=>{
    const i=$("#pickBatter");if(i)i.value=p.n;show("batter",p);
  });
  const go2=$("#pickGo");
  if(go2)go2.addEventListener("click",()=>{
    if(!chosen.pitcher||!chosen.batter)return;
    // 타자 페이지에서 보는 것을 기본으로 한다 — 「이 타자가 이 투수에게」가 보통 찾는 방향이다
    go(BASE+"players/"+chosen.batter.i+".html?vs="+encodeURIComponent(chosen.pitcher.n)+"#b-matchup");
  });
}

/* ── 색인 화면의 이름·구단 좁히기 ──
   목록은 서버가 그렸다. JS는 좁히기만 한다 — 스크립트가 죽어도 전 선수 목록은 남는다. */
const filter=$("#rosterFilter");
const chips=$$(".chip[data-team]");
if(filter||chips.length){
  let team="";
  const apply=()=>{
    const term=(filter?filter.value.trim():"");
    let shown=0;
    $$(".teamgroup").forEach(g=>{
      let n=0;
      $$("li",g).forEach(li=>{
        const hit=(team===""||li.dataset.team===team)&&(term===""||li.dataset.name.indexOf(term)>=0);
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
  if(filter)filter.addEventListener("input",apply);
}

press(".rail [data-preset]","preset",state.preset);
press(".rail [data-density]","density",state.density);
applyTheme();renderBlocks();renderEditor();showTabs();
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
