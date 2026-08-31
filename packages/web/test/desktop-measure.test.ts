/**
 * **넓은 화면에서 본문이 어디서 끝나는가.**
 *
 * ⚠**2026-08-31 사용자 지적**: 「스마트폰에서는 반응형이 깔끔한데 오히려 PC 가 지저분함」.
 * 원인은 명확했다 — **미디어 쿼리가 전부 `max-width`(모바일 축소용)뿐이고 데스크톱 처리가 0건**이라,
 * 화면은 **모바일 레이아웃을 1920px 까지 늘린 것**이었다.
 *
 * ## 왜 「늘리는 것」이 나쁜가
 *
 * 표가 `width:100%` 이므로 **남는 폭은 반드시 어딘가로 간다.** 상한이 없으면 그것이
 * **숫자 열 사이의 틈**으로 흩어지고, 한 행을 눈으로 따라가는 거리가 길어진다.
 * ⚠**게다가 폭이 서로 어긋나 있었다** — 각주는 `max-width:520px` 인데 같은 블록의 표는 1900px 였다.
 *
 * ## ⚠이 시험이 재는 것과 못 재는 것
 *
 * 브라우저를 쓰지 않는다(개발 의존 3개를 유지한다 · 공급망 축). 그래서 **규칙이 있는가**만 본다 —
 * 실제 화면에서 예뻐 보이는가는 사람이 봐야 한다. 여기서 막는 것은 **규칙이 조용히 사라지는 것**이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../src/assets.ts";

/** ⚠주석 안의 글자를 규칙으로 세지 않는다 — 이 파일은 주석이 많다 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

test("⚠본문에 최대 폭이 있다 — 없으면 모바일 레이아웃이 1920px 까지 늘어난다", () => {
  const main = /(^|\})\s*\.main\{([^}]*)\}/.exec(RULES)?.[2] ?? "";
  assert.notEqual(main, "", ".main 규칙을 못 찾았다 — 이 시험이 공회전한다");
  assert.match(main, /max-width:\s*var\(--measure\)/, `.main 에 최대 폭이 없다: ${main}`);
});

test("⚠--measure 가 가장 넓은 표를 담는다 — 실측 14열", () => {
  const v = /--measure:\s*(\d+)px/.exec(RULES)?.[1];
  assert.notEqual(v, undefined, "--measure 토큰이 없다");
  const px = Number(v);
  /**
   * ⚠**아래를 근거로 고른 값이다**(2026-08-31 · dist 표 423개 실측):
   * 가장 넓은 표 **14열** · 셀은 nowrap 에 좌우 8px 여백.
   * ⚠**늘려서 「넓은 화면을 채우자」로 가지 마라** — 그러면 이 사고가 그대로 돌아온다.
   */
  assert.ok(px >= 1000, `${px}px 는 14열 표를 담기에 좁다 — 가로 스크롤이 상시 생긴다`);
  assert.ok(px <= 1400, `${px}px 는 넓다 — 남는 폭이 다시 숫자 사이 틈으로 흩어진다`);
});

/**
 * ⚠**여유는 「버리는 여백」이 아니라 정보가 되게 한다.** スプリット 표에서 남는 폭은
 * 막대가 먹는다 — 막대가 길수록 OPS 차이가 눈에 더 잘 보인다.
 */
/**
 * ⚠**이 규칙은 브라우저로 보고 두 번 바꿨다**(1920px 실측 스크린샷).
 *
 * ⑴ 처음엔 **남는 폭을 막대에 몰아줬다.** 그리는 순간 틀린 것이 보였다 — 막대가 표의 절반을
 *    먹는데 `.557` 과 `.521` 의 길이 차이는 **눈에 안 보였다.** 자리는 가장 많이 쓰고 정보는 거의 안 더한다.
 * ⑵ 다음엔 **맨 왼쪽 이름 칸**에 몰아줬다. 숫자는 모였지만 이름과 표 사이가 400px 벌어졌다.
 * ⑶ 지금은 **표를 내용 폭으로 둔다** — 남는 폭 자체를 만들지 않는다.
 *    표가 하나의 덩어리로 뭉쳐 한 행을 훑는 거리가 가장 짧다.
 *
 * ⚠**CSS 만 읽어서는 ⑴과 ⑶을 구별할 수 없었다.** 이 판단은 그려 봐야 났다.
 */
test("⚠스플릿 표는 내용 폭이다 — 남는 폭을 만들지 않는다", () => {
  assert.match(RULES, /\.spl\{width:auto\}/, "표가 폭을 가득 채운다 — 남는 폭이 숫자 사이로 흩어진다");
  assert.match(
    RULES,
    /\.spl td \.tv \.track\{flex:0 1 140px;min-width:72px\}/,
    "막대가 고정 폭이 아니다 — 늘려도 정보는 안 늘고 자리만 먹는다",
  );
});

/**
 * `overflow-wrap` 의 기본값.
 *
 * `anywhere` 는 단어를 쪼개 만든 끊을 자리를 **min-content 계산에도 반영**해서
 * **라틴 문자·긴 영숫자**가 든 칸을 한 글자 폭까지 줄일 수 있다. `break-word` 는
 * 넘칠 때만 쪼개고 최소 폭은 단어 폭을 지킨다 — 넘침 방지는 그대로다.
 *
 * ⚠⚠**이것을 「ウィットリー가 세로로 쪼개진」 결함의 수정이라고 읽지 마라 —
 * 첫 판에 그렇게 적었고 틀렸다.** **일본어는 원래 글자 사이에서 줄이 바뀐다**
 * (writing system 의 기본 줄바꿈 기회이지 `overflow-wrap` 이 만든 것이 아니다).
 * 가나·한자 줄의 min-content 는 **어느 값에서도 한 글자**다.
 * **그 결함의 실제 수정은 아래 `.roster .hn` 시험이 지킨다.**
 */
test("본문 기본이 break-word 다 — 라틴 문자 칸이 한 글자 폭까지 줄지 않게", () => {
  const body = /(^|\})\s*body\{([^}]*)\}/.exec(RULES)?.[2] ?? "";
  assert.notEqual(body, "", "body 규칙을 못 찾았다 — 이 시험이 공회전한다");
  assert.match(body, /overflow-wrap:\s*break-word/, `body 의 줄바꿈 규칙이 다르다: ${body}`);
});

/**
 * ⚠**예외는 하나뿐이고 그 이유가 있다.** 달력의 팀명은 좁은 칸에서 **줄을 바꾸는 쪽이 옳다** —
 * 말줄임이면 「@ヤ…」처럼 2글자만 남아 이 화면이 읽으라고 만든 정보가 사라진다.
 * ⚠**예외가 늘면 전역 수정이 무의미해진다.** 늘릴 때는 여기 이유를 적어라.
 */
test("⚠anywhere 를 쓰는 자리는 이유가 적힌 한 곳뿐이다", () => {
  const uses = [...RULES.matchAll(/([^{}]+)\{[^}]*overflow-wrap:\s*anywhere/g)].map((m) =>
    (m[1] ?? "").trim().replace(/\s+/g, " "),
  );
  assert.deepEqual(uses, [".cvs"], `anywhere 를 쓰는 자리가 달라졌다: ${uses.join(" / ")}`);
});

/**
 * ⚠**이것이 「ウィットリー가 ウ/ィ/ッ/ト/リ/ー 로 세로로 쪼개진」 결함의 실제 수정이다**
 * (2026-08-31 · 사용자 지적).
 *
 * 168px 칸에 아이콘 18 + 성적 약 95 + 포지션 12 + 틈 24 가 들어가 **이름 몫이 20px 도 안 남았다.**
 * 성적(`.hs`)은 `flex:0 0 auto` 라 안 양보하는데 이름(`.hn`)에는 아무 제약이 없어서
 * **혼자 다 줄어들었고**, 일본어는 글자 사이에서 줄이 바뀌므로 **한 글자 폭까지** 갔다.
 * → ⑴ 이름에 `white-space:nowrap` 으로 **쪼개기 자체를 금지**하고
 *   ⑵ 모자라면 말줄임으로 끝내고 ⑶ 칸을 넓혀 말줄임이 거의 안 일어나게 한다.
 */
test("⚠명부의 이름이 먼저 자리를 갖고, 모자라면 말줄임으로 끝난다", () => {
  const hn = /\.roster \.hn\{([^}]*)\}/.exec(RULES)?.[1] ?? "";
  assert.notEqual(hn, "", ".roster .hn 규칙을 못 찾았다");
  assert.match(hn, /flex:1 1 auto/, `이름이 여유를 안 갖는다: ${hn}`);
  assert.match(hn, /min-width:0/, `min-width:0 이 없으면 말줄임이 안 듣는다: ${hn}`);
  /** ⚠**이 한 줄이 세로 쪼개짐을 막는다** — 일본어는 글자 사이가 기본 줄바꿈 자리다 */
  assert.match(hn, /white-space:nowrap/, `쪼개기를 금지하지 않았다 — 세로로 쪼개진다: ${hn}`);
  assert.match(hn, /text-overflow:ellipsis/, `모자랄 때 잘린 채로 넘친다: ${hn}`);
  const min = /\.roster\{[^}]*minmax\((\d+)px/.exec(RULES)?.[1];
  assert.ok(Number(min) >= 210, `명부 칸이 ${min}px 로 좁다 — 이름 몫이 남지 않는다`);
});

/**
 * ⚠**같은 병이 화면마다 있었다.** 「이름이 세로로 쪼개진다」는 명부만의 사고가 아니다 —
 * **줄어들 수 있는 글자 칸이 안 줄어드는 형제 옆에 있으면** 어디서든 난다.
 *
 * 그래서 **줄어드는 쪽으로 설계된 자리**에는 반드시 셋이 함께 있어야 한다:
 * `white-space:nowrap`(쪼개기 금지) · `overflow:hidden` · `text-overflow:ellipsis`(끝내는 방법).
 * ⚠**목록을 여기 적는다** — 새로 그런 자리를 만들면 여기에 더하면서 한 번 더 생각하게 된다.
 *
 * | 자리 | 왜 줄어드는가 |
 * |---|---|
 * | `.roster .hn` | 성적(.hs)이 flex:0 0 auto 라 안 양보한다 |
 * | `.hgames .hg-t` | 점수(.hg-s)가 nowrap 이고 마지막 칸이 minmax(0,auto) 다 |
 * | `.card .ctxt b` | 카드 격자가 158px 까지 좁아진다 |
 */
const SHRINKING_TEXT = [".roster .hn", ".hgames .hg-t", ".card .ctxt b"];

test("⚠줄어드는 글자 칸은 쪼개지 말고 말줄임으로 끝난다 — 세로로 쪼개지는 것을 막는다", () => {
  const problems: string[] = [];
  for (const sel of SHRINKING_TEXT) {
    const re = new RegExp(`${sel.replace(/\./g, "\\.")}\\{([^}]*)\\}`);
    const body = re.exec(RULES)?.[1];
    if (body === undefined) {
      problems.push(`${sel}: 규칙을 못 찾았다 — 이름이 바뀌었으면 이 목록도 고쳐라`);
      continue;
    }
    for (const must of ["white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis"]) {
      if (!body.includes(must)) problems.push(`${sel}: ${must} 가 없다 — 좁아지면 쪼개진다`);
    }
  }
  assert.deepEqual(problems, [], `줄어드는 글자 칸이 보호되지 않는다\n${problems.join("\n")}`);
});

/**
 * ⚠**띠는 창 끝까지, 내용은 본문 끝까지.** `.topbar` 와 `.seasons` 는 `.shell` 의 형제라
 * 폭 상한이 안 걸린다 — 본문만 묶으면 **오른쪽 내비가 본문 끝에서 700px 떨어져 뜬다.**
 * ⚠**띠 자체를 자르지 않는다** — 배경과 밑줄이 창 중간에서 끊기면 고장으로 보인다.
 */
test("⚠전체 폭 띠의 내용이 본문과 같은 자리에서 시작하고 끝난다 — 머리와 몸이 따로 놀지 않게", () => {
  for (const sel of [".topbar", ".seasons"]) {
    const body = new RegExp(`${sel.replace(/\./g, "\\.")}\\{([^}]*)\\}`).exec(RULES)?.[1] ?? "";
    assert.notEqual(body, "", `${sel} 규칙을 못 찾았다`);
    assert.match(body, /padding-left:calc\(var\(--gut\)/, `${sel} 의 왼쪽이 본문과 안 맞는다: ${body}`);
    assert.match(body, /padding-right:calc\(var\(--gut\)/, `${sel} 의 오른쪽이 본문과 안 맞는다: ${body}`);
  }
});

/**
 * ⚠**기둥과 본문을 함께 옮긴다.** 본문만 가운데로 보내면 구단색 기둥이 화면 왼쪽 끝에 홀로 남는다.
 * ⚠**이 값은 브라우저로 보고서야 정해졌다**(1920px 실측). 왼쪽 정렬로 뒀을 때
 * **오른쪽 약 700px 가 통째로 비어** 고장처럼 보였다 — CSS 만 읽어서는 못 잡는 종류다.
 */
test("⚠넓은 화면에서 여백을 양쪽으로 가른다 — 한쪽에 몰면 고장처럼 보인다", () => {
  const shell = /(^|\})\s*\.shell\{([^}]*)\}/.exec(RULES)?.[2] ?? "";
  assert.notEqual(shell, "", ".shell 규칙을 못 찾았다");
  assert.match(shell, /padding-inline:var\(--gut\)/, `.shell 이 가운데로 안 간다: ${shell}`);
  const gut = /--gut:\s*([^;]+);/.exec(RULES)?.[1] ?? "";
  assert.match(gut, /max\(0px/, `--gut 에 바닥이 없다 — 좁은 화면에서 음수가 된다: ${gut}`);
  assert.match(gut, /\/ 2\)/, `--gut 이 반으로 안 갈린다: ${gut}`);
});

/**
 * ⚠**셀 자체를 flex 로 만들면 안 된다**(`css-tables.test.ts` 가 막는 그 결함) —
 * 셀이 테이블 박스에서 빠져나와 **아래 경계선이 다른 칸과 어긋난다.**
 * 막대와 값은 **안쪽 래퍼**로 묶었고, 그 사실을 여기서 못 박는다.
 */
test("⚠막대와 값은 안쪽 래퍼로 묶는다 — 셀을 flex 로 만들지 않는다", () => {
  assert.match(RULES, /\.spl td \.tv\{display:flex/, "래퍼가 없다");
  /**
   * ⚠**첫 판의 정규식이 래퍼(`.spl td .tv`)까지 셀로 읽었다** — 「td 뒤 아무 글자」로 썼기 때문이다.
   * 물어야 할 것은 **선택자의 마지막 조각이 셀인가**다. 자손 선택자는 셀이 아니다.
   */
  const cellFlex: string[] = [];
  for (const m of RULES.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/display:\s*flex/.test(m[2] ?? "")) continue;
    for (const sel of (m[1] ?? "").split(",")) {
      const last = sel.trim().split(/\s+/).at(-1) ?? "";
      // `td` · `th` · `td:nth-child(2)` · `td.wd` — 마지막 조각이 셀 그 자체인 것만
      if (/^(t[dh])([.:#[][^\s]*)?$/.test(last)) cellFlex.push(sel.trim());
    }
  }
  assert.deepEqual(cellFlex, [], `셀 자체에 flex 가 걸렸다 — 경계선이 어긋난다: ${cellFlex.join(" / ")}`);
});
