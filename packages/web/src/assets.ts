/**
 * 디자인 토큰과 클라이언트 스크립트.
 *
 * 名鑑(선수 명감)의 시각 언어 — 촘촘한 본문, 머리카락 굵기 괘선, 구단 색 배면.
 * 카드·그림자·둥근 모서리를 쓰지 않는다(인쇄물의 질감).
 *
 * ⚠**색은 전부 토큰으로 정의하고 라이트/다크 양쪽을 만든다.** 뷰어의 테마는 세 가지 상태가 있고
 * (명시적 light · 명시적 dark · 미지정), 미지정이 기본이다.
 */

export const CSS = `
:root {
  --page:#fbfaf7; --tx:#17171a; --tx-2:#5d5d59; --tx-3:#8d8d87;
  --hair:#e0dfd8; --hair-2:#cfcec5; --panel:#ffffff; --warn:#a8452f; --ok:#3f6b4a;
  --f-body:"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans JP","Meiryo",system-ui,sans-serif;
  --f-num:"SFMono-Regular","Consolas","Menlo","Yu Gothic",monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#7b7a74;
    --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --warn:#e08a72; --ok:#8fc09c;
  }
}
:root[data-theme="dark"] {
  --page:#15161a; --tx:#e9e8e3; --tx-2:#a5a49d; --tx-3:#7b7a74;
  --hair:#2b2d33; --hair-2:#3b3e45; --panel:#1c1e23; --warn:#e08a72; --ok:#8fc09c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--tx);font-family:var(--f-body);line-height:1.55;font-feature-settings:"palt" 1}
a{color:inherit}
.shell{display:grid;grid-template-columns:44px 1fr;min-height:100vh}
@media (max-width:680px){.shell{grid-template-columns:16px 1fr}}
.spine{background:var(--team,#6b7280);display:flex;flex-direction:column;align-items:center;padding:16px 0;gap:18px}
.spine .vt{writing-mode:vertical-rl;font-size:12.5px;letter-spacing:.32em;font-weight:700;color:var(--team-ink,#fff);text-decoration:none}
@media (max-width:680px){.spine .vt{display:none}}
.main{min-width:0;padding:0 0 60px}

/* 상태 띠 — 4상태(M12) 중 「수집실패·낡음」을 여기서 말한다 */
.state{padding:7px 20px;font-size:12px;border-bottom:1px solid var(--hair)}
.state.stale{background:var(--warn);color:#fff}
.state.fresh{color:var(--tx-3)}
.state b{font-weight:700}

.idline{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:16px 20px 9px;border-bottom:3px solid var(--team,#6b7280)}
.idline .no{font-family:var(--f-num);font-size:30px;font-weight:700;letter-spacing:-.02em}
.idline .nm{font-size:25px;font-weight:700;letter-spacing:.08em}
.idline .sub{font-size:11.5px;color:var(--tx-2);letter-spacing:.09em}
.idline .asof{margin-left:auto;font-family:var(--f-num);font-size:11px;color:var(--tx-3)}

.rail{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 20px;border-bottom:1px solid var(--hair);background:var(--panel);position:sticky;top:0;z-index:5}
.rail .lbl{font-size:10.5px;letter-spacing:.16em;color:var(--tx-3)}
.rail .grow{flex:1 1 auto}
.tab{font:inherit;font-size:12px;padding:3px 10px;cursor:pointer;background:transparent;color:var(--tx-2);border:1px solid var(--hair-2)}
.tab:hover{color:var(--tx);border-color:var(--tx-3)}
.tab[aria-pressed="true"]{background:var(--team,#6b7280);color:var(--team-ink,#fff);border-color:var(--team,#6b7280);font-weight:700}
.tab:focus-visible,a:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--tx);outline-offset:1px}

.editor{padding:14px 20px 16px;border-bottom:1px solid var(--hair);background:var(--panel)}
.editor[hidden]{display:none}
.editor h3{margin:0 0 3px;font-size:12px;letter-spacing:.14em;color:var(--tx-2);font-weight:600}
.editor p{margin:0 0 12px;font-size:11.5px;color:var(--tx-3)}
.blocks{display:flex;flex-direction:column;gap:4px;max-width:520px}
.brow{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:6px 8px;border:1px solid var(--hair);background:var(--page)}
.brow input[type=checkbox]{accent-color:var(--team,#6b7280);width:15px;height:15px}
.brow .bn{font-size:13px}
.brow .bd{font-size:11px;color:var(--tx-3)}
.mv{font:inherit;font-size:11px;padding:1px 7px;cursor:pointer;background:transparent;color:var(--tx-2);border:1px solid var(--hair-2)}
.mv:hover:not(:disabled){color:var(--tx);border-color:var(--tx-3)}
.mv:disabled{opacity:.3;cursor:default}
.fixed-note{margin-top:12px;padding:9px 11px;border-left:3px solid var(--warn);background:var(--page);font-size:11.5px;color:var(--tx-2);max-width:520px}
.fixed-note b{color:var(--warn)}

.block{padding:16px 20px;border-bottom:1px solid var(--hair)}
.block[hidden]{display:none}
.block>h4{margin:0 0 9px;font-size:10.5px;letter-spacing:.19em;color:var(--tx-2);font-weight:600;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.block>h4 .sw{display:flex;gap:4px;margin-left:auto}
.block>h4 .qt{letter-spacing:0;font-weight:400;color:var(--tx-3)}

.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:0 24px}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;align-items:baseline}
dt{font-size:10.5px;color:var(--tx-2);letter-spacing:.12em;padding:4px 10px 4px 0;border-bottom:1px solid var(--hair);white-space:nowrap}
dd{margin:0;text-align:right;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:14px;padding:4px 0;border-bottom:1px solid var(--hair)}
.den{font-family:var(--f-num);font-size:10px;color:var(--tx-3);margin-left:5px}
.rank{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:700;padding:0 5px;font-size:10px;margin-left:6px;font-family:var(--f-body)}

.scroller{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--hair);white-space:nowrap}
th{font-size:10px;letter-spacing:.1em;color:var(--tx-2);font-weight:500}
td.l,th.l{text-align:left}
tr.me td{background:var(--team,#6b7280);color:var(--team-ink,#fff);font-weight:700}
tr.thin td{color:var(--tx-3)}

.pa{font-size:11.5px;letter-spacing:.02em}
.pa.h{color:var(--warn);font-weight:700}

.dg{display:grid;grid-template-columns:68px repeat(3,minmax(58px,1fr));gap:3px;min-width:300px}
.dg .h{font-size:10px;letter-spacing:.1em;color:var(--tx-3);text-align:center}
.dg .rl{font-size:11px;color:var(--tx-2);display:flex;align-items:center}
.dg .c{border:1px solid var(--hair);padding:5px 3px;text-align:center;font-family:var(--f-num);font-variant-numeric:tabular-nums}
.dg .c u{display:block;text-decoration:none;font-size:13px}
.dg .c s{display:block;text-decoration:none;font-size:9px;color:var(--tx-3)}
.dg .c.thin u{color:var(--tx-3)}

.bars{display:flex;flex-direction:column;gap:5px;max-width:470px}
.bar{display:grid;grid-template-columns:82px 1fr 128px;gap:10px;align-items:center}
.bar span{font-size:11.5px;color:var(--tx-2)}
.track{height:13px;background:var(--hair)}
.track i{display:block;height:100%;background:var(--team,#6b7280)}
.bar em{font-style:normal;font-family:var(--f-num);font-variant-numeric:tabular-nums;font-size:12px;text-align:right}
.note{font-size:11px;color:var(--tx-3);margin:9px 0 0;max-width:62ch}
.empty{font-size:12px;color:var(--tx-3);padding:6px 0}

/* 색인·검색 */
.find{padding:16px 20px;border-bottom:1px solid var(--hair)}
.find label{display:block;font-size:10.5px;letter-spacing:.16em;color:var(--tx-3);margin-bottom:6px}
.find input{font:inherit;font-size:15px;padding:7px 10px;width:100%;max-width:420px;background:var(--panel);color:var(--tx);border:1px solid var(--hair-2)}
.subhead{margin:14px 0 4px;font-size:10.5px;letter-spacing:.16em;color:var(--tx-2);font-weight:600}
.hits{list-style:none;margin:12px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:0 18px;max-height:60vh;overflow:auto}
.hits li{border-bottom:1px solid var(--hair)}
.hits a{display:flex;gap:8px;align-items:baseline;padding:5px 0;text-decoration:none}
.hits .hn{font-size:13px}
.hits .ht{font-size:10.5px;color:var(--tx-3);margin-left:auto}
.foot{padding:18px 20px;color:var(--tx-3);font-size:11.5px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/**
 * 클라이언트 스크립트 — 블록 조립·스플릿 축·순위 지표·검색.
 *
 * ⚠**저장에 실패해도 화면은 동작해야 한다.** localStorage가 막힌 환경이 있다.
 * ⚠**서버가 없다.** 정적 파일만으로 도는 것이 이 설계의 전제다.
 */
export const CLIENT_JS = `
(()=>{"use strict";
const $=(s,r)=>(r||document).querySelector(s);
const $$=(s,r)=>Array.from((r||document).querySelectorAll(s));
const BASE=document.documentElement.dataset.base||"";
const KEY="npb-meikan-layout";
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){return null}};
const save=(s)=>{try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}};
const BLOCKS=window.__BLOCKS__||[];
const PRESETS=window.__PRESETS__||{};
let state=load()||{order:(PRESETS.standard||[]).slice(),preset:"standard",density:"normal",split:"hand",sort:"wrcPlus"};
if(!Array.isArray(state.order)||!state.order.length)state.order=(PRESETS.standard||[]).slice();

function press(sel,attr,val){$$(sel).forEach(b=>b.setAttribute("aria-pressed",String(b.dataset[attr]===val)))}

function renderBlocks(){
  const foot=$(".foot");
  state.order.forEach(id=>{const el=document.getElementById("b-"+id);if(el&&foot)foot.parentNode.insertBefore(el,foot)});
  BLOCKS.forEach(b=>{const el=document.getElementById("b-"+b.id);if(el)el.hidden=state.order.indexOf(b.id)<0});
  const pad=state.density==="compact"?"10px":"16px";
  $$(".block").forEach(el=>{el.style.paddingTop=pad;el.style.paddingBottom=pad});
}
function renderEditor(){
  const host=$("#blockList");if(!host)return;host.textContent="";
  const rest=BLOCKS.map(b=>b.id).filter(id=>state.order.indexOf(id)<0);
  state.order.concat(rest).forEach(id=>{
    const meta=BLOCKS.filter(b=>b.id===id)[0];if(!meta)return;
    const on=state.order.indexOf(id)>=0;
    const row=document.createElement("div");row.className="brow";
    const cb=document.createElement("input");cb.type="checkbox";cb.checked=on;
    cb.setAttribute("aria-label",meta.name+"を表示");
    cb.addEventListener("change",()=>{
      state.order=cb.checked?state.order.concat([id]):state.order.filter(x=>x!==id);
      state.preset="";press(".rail [data-preset]","preset","");commit();
    });
    const txt=document.createElement("div");
    const n=document.createElement("div");n.className="bn";n.textContent=meta.name;
    const d=document.createElement("div");d.className="bd";d.textContent=meta.desc;
    txt.appendChild(n);txt.appendChild(d);
    const up=document.createElement("button");up.className="mv";up.type="button";up.textContent="↑";
    up.setAttribute("aria-label",meta.name+"を上へ");up.disabled=!on||state.order.indexOf(id)<=0;
    up.addEventListener("click",()=>move(id,-1));
    const dn=document.createElement("button");dn.className="mv";dn.type="button";dn.textContent="↓";
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

function showSplit(){
  $$("[data-split-panel]").forEach(p=>{p.hidden=p.dataset.splitPanel!==state.split});
  press("#b-splits [data-split]","split",state.split);
}
function showSort(){
  $$("[data-sort-panel]").forEach(p=>{p.hidden=p.dataset.sortPanel!==state.sort});
  press("#b-ranking [data-sort]","sort",state.sort);
}

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
$$("#b-splits [data-split]").forEach(b=>b.addEventListener("click",()=>{state.split=b.dataset.split;save(state);showSplit()}));
$$("#b-ranking [data-sort]").forEach(b=>b.addEventListener("click",()=>{state.sort=b.dataset.sort;save(state);showSort()}));

// 검색 — 선수 색인은 별도 JSON. 서버 없이 도는 것이 전제다.
const box=$("#find");
if(box){
  const list=$("#hits");
  let index=null;
  const draw=(rows)=>{
    list.textContent="";
    if(!rows.length){const li=document.createElement("li");li.textContent="該当なし";list.appendChild(li);return}
    rows.slice(0,120).forEach(p=>{
      const li=document.createElement("li");
      const a=document.createElement("a");a.href=BASE+"players/"+p.i+".html";
      const n=document.createElement("span");n.className="hn";n.textContent=p.n;
      const t=document.createElement("span");t.className="ht";t.textContent=p.t;
      a.appendChild(n);a.appendChild(t);li.appendChild(a);list.appendChild(li);
    });
  };
  const run=()=>{
    if(!index)return;
    const q=box.value.trim();
    draw(q===""?index:index.filter(p=>p.n.indexOf(q)>=0||p.t.indexOf(q)>=0));
  };
  fetch(BASE+"players.json").then(r=>r.json()).then(j=>{index=j;run()}).catch(()=>{
    list.textContent="";const li=document.createElement("li");
    li.textContent="選手一覧を読み込めませんでした。再読み込みしてください。";list.appendChild(li);
  });
  box.addEventListener("input",run);
}

press(".rail [data-preset]","preset",state.preset);
press(".rail [data-density]","density",state.density);
renderBlocks();renderEditor();showSplit();showSort();
})();
`;
