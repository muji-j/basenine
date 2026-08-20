#!/usr/bin/env node
/**
 * **2026-08-21 디자인 감사 수정이 「고치기 전 코드」에서 실제로 붉어지는가**(작업규칙 9).
 *
 * 쓰는 법:  node scripts/tip-marks-mutation-check.ts
 *
 * ⚠**초록은 그 자체로는 아무 말도 안 한다.** 여기 다섯 건은 전부 **실제로 났던 결함**이고,
 * 되돌렸을 때 시험이 안 떨어지면 그 시험은 그 사고를 못 잡는다는 뜻이다.
 * ⚠**자리·크기(③)는 여기 없다** — 스텁에는 레이아웃이 없어서 잴 수 없다. 그쪽은 실기로만 잰다.
 */
import { fileURLToPath } from "node:url";
import { runMutations } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ASSETS = `${ROOT}packages/web/src/assets.ts`;
const LOGPAGE = `${ROOT}packages/web/src/log-page.ts`;
const CONTRAST = `${ROOT}packages/web/test/css-contrast.test.ts`;
const TIP = `${ROOT}packages/web/test/term-tip.test.ts`;
/** ②는 여기서도 걸려야 한다 — 예전 시험이 `scroll,hide` 를 **글자로 못 박고 있었다** */
const ASSETS_TEST = `${ROOT}packages/web/test/assets.test.ts`;
const NOTE = `${ROOT}packages/web/test/note-markup.test.ts`;

const ASSET_MUTATIONS: readonly Mutation[] = [
  {
    what: "① 터치의 첫 탭 — 토글 기준을 click 시점으로 되돌린다(**고치기 전 코드**)",
    from: `        const wasOpen=downOpen===null?current===btn:downOpen;
        downOpen=null;
        if(wasOpen)hide();else show(btn);`,
    to: `        if(current===btn)hide();else show(btn);`,
  },
  {
    what: "② 스크롤에 닫는다 — 포커스로 여는 길이 막힌다(**고치기 전 코드**)",
    from: `  let placing=0;
  doc.addEventListener("scroll",(e)=>{`,
    to: `  let placing=0;
  doc.addEventListener("scroll",hide,true);
  doc.addEventListener("scrollNEVER",(e)=>{`,
  },
  {
    what: "④ 꼭짓점의 링을 구단 색으로 되돌린다 — 다크 オリックス 1.08 · ロッテ 1.10",
    from: `.mf-dot{fill:var(--panel);stroke:var(--tx-2);stroke-width:2;`,
    to: `.mf-dot{fill:var(--panel);stroke:var(--team,#6b7280);stroke-width:2;`,
  },
  {
    what: "⑤ 도형의 윤곽을 구단 색으로 되돌린다 — 24조합 중 12 미달",
    from: `.mf-shape{fill-opacity:.42;stroke:var(--tx-2);stroke-width:1.5;`,
    to: `.mf-shape{fill-opacity:.42;stroke:var(--team,#6b7280);stroke-width:1.5;`,
  },
  {
    what: "⑥ 비교 화면의 선 색을 다시 스크립트가 얹는다 — CSS 검사가 못 보는 자리",
    from: `      if(color)p.setAttribute("fill",color);`,
    to: `      if(color){p.setAttribute("fill",color);p.setAttribute("stroke",color)}`,
  },
];

const LOG_MUTATIONS: readonly Mutation[] = [
  {
    what: "⑦ 각주에 생 <b> 를 되돌린다 — 화면에 태그가 글자로 찍힌다",
    from: `"⚠これは不具合の一覧ではなく**判断待ちの一覧**です。規則にない書き方が出てきたとき、"`,
    to: `"⚠これは不具合の一覧ではなく<b>判断待ちの一覧</b>です。規則にない書き方が出てきたとき、"`,
  },
];

let survived = runMutations({ src: ASSETS, tests: [CONTRAST, TIP, ASSETS_TEST], mutations: ASSET_MUTATIONS });
survived += runMutations({ src: LOGPAGE, tests: [NOTE], mutations: LOG_MUTATIONS });

console.log("");
console.log(`합계 살아남음 **${survived}건**`);
process.exit(survived === 0 ? 0 : 1);
