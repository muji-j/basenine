/**
 * **상단 헤더의 실제 기하를 브라우저로 잰다.**
 *
 * ⚠**이 계측기는 눈대중을 대신하려고 있다.** 2026-08-19 감사가 잡은 결함
 * (`.topbar` 가 `height` 고정인데 `.tnav` 가 `flex-wrap:wrap` 이라 481~770px 에서 탭줄이
 * 바 **밖으로 나간다**)은 CSS 를 읽는 것만으로는 안 보였다 — 파손 구간의 **경계**도,
 * 몇 픽셀 넘치는지도 실측으로만 나온다.
 *
 * ⚠**왜 `test/` 가 아니라 `tools/` 인가**(2026-08-20 판단).
 * 이 계측에는 브라우저가 필요한데 **playwright 는 이 저장소의 의존성이 아니다.**
 * 시험으로 두면 CI 에서 **영구히 skip** 되고, 그건 이 저장소가 이미 여러 번 데인
 * 「skipped 인데 종료 코드 0 이라 합격으로 읽힌다」(작업규칙 8) 그 자리다.
 * → **CI 가 지키는 것은 `test/topbar-geometry.test.ts` 의 구조 불변식**이고,
 *   이 파일은 **사람이 수치를 확인할 때 쓰는 계측기**다. 둘은 짝이다 —
 *   불변식이 깨지면 여기서 잰 수치가 다시 나빠진다.
 *
 * 쓰는 법:
 * ```
 *   (dist 를 정적 서버로 띄운 뒤)
 *   BB_PLAYWRIGHT=<playwright/index.js 경로> \
 *     node packages/web/tools/measure-topbar.ts http://127.0.0.1:8731 index.html teams/t.html
 * ```
 * ⚠**`file://` 로 재지 마라** — 검색이 fetch 로 색인을 읽으므로 그쪽만 실패하고,
 * 그 실패는 화면 높이를 바꾸지 않지만 다른 계측과 섞이면 판단이 흐려진다.
 */

/** 재는 폭 — 감사가 쓴 것과 같은 격자(400→1000 · step 4 · 151점) */
const MIN_W = 400;
const MAX_W = 1000;
const STEP = 4;

/** 테마 버튼의 상한. 한 줄로 남으면 27px 이고, 두 줄로 접히면 40px 이 된다 */
const TBTN_MAX_H = 32;

interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

interface Shot {
  readonly width: number;
  readonly bar: Rect;
  readonly navTop: number;
  readonly navBottom: number;
  readonly tabs: number;
  readonly btnH: number;
  /** `--topbar` 토큰의 계산값(px). **바의 실제 높이와 같아야 한다** */
  readonly token: number;
}

/**
 * ⚠**playwright 를 정적 지정자로 import 하지 않는다** — 의존성이 아니라서
 * `tsc` 가 「모듈을 찾을 수 없다」로 죽는다. 경로를 **값**으로 받아 동적 import 한다.
 */
async function launchChromium(): Promise<{
  readonly newPage: (w: number) => Promise<unknown>;
  readonly close: () => Promise<void>;
  readonly browser: { newPage: (o: unknown) => Promise<unknown> };
}> {
  const raw = process.env["BB_PLAYWRIGHT"];
  if (raw === undefined || raw === "") {
    throw new Error(
      "BB_PLAYWRIGHT 가 없다 — playwright/index.js 의 경로(또는 file:// URL)를 넣어라. " +
        "이 저장소는 playwright 를 의존성으로 갖지 않는다(주석 참조)",
    );
  }
  const spec = raw.startsWith("file:") ? raw : `file:///${raw.replaceAll("\\", "/")}`;
  const mod = (await import(spec)) as { default?: { chromium?: unknown }; chromium?: unknown };
  const chromium = (mod.chromium ?? mod.default?.chromium) as
    | { launch: (o: unknown) => Promise<{ newPage: (o: unknown) => Promise<unknown>; close: () => Promise<void> }> }
    | undefined;
  if (chromium === undefined) throw new Error(`${spec} 에서 chromium 을 못 찾았다`);
  const browser = await chromium.launch({ headless: true });
  // ⚠**손가락은 `@media (pointer:coarse)` 를 켠다** — 그 안에서 `.tnav a` 패딩이 커져
  // 탭줄이 마우스일 때보다 8px 두꺼워진다. 아이패드를 재려면 이쪽이어야 한다.
  const touch = process.env["BB_TOPBAR_COARSE"] === "1";
  return {
    browser,
    newPage: (w: number) => browser.newPage({ viewport: { width: w, height: 900 }, hasTouch: touch }),
    close: () => browser.close(),
  };
}

/**
 * 브라우저 안에서 도는 계측 — 반환은 순수 수치뿐이다.
 * ⚠**문자열은 「식」으로 평가된다** — 화살표 함수를 그대로 넘기면 함수 자체가 값이 되어
 * 직렬화에 실패하고 `undefined` 가 돌아온다(첫 판이 그렇게 조용히 빈 값을 냈다). 즉시 호출한다.
 */
const PROBE = `(() => {
  const bar = document.querySelector('.topbar');
  const links = [...document.querySelectorAll('.tnav a')];
  const btn = document.getElementById('themeBtn');
  const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
  const br = r(bar);
  return {
    bar: br,
    navTop: Math.min(...links.map((a) => r(a).top)),
    navBottom: Math.max(...links.map((a) => r(a).bottom)),
    tabs: links.length,
    btnH: btn === null ? 0 : r(btn).height,
    token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')),
  };
})()`;

interface Probe {
  goto: (u: string, o: unknown) => Promise<unknown>;
  evaluate: (f: string) => Promise<Omit<Shot, "width">>;
  setViewportSize: (s: { width: number; height: number }) => Promise<void>;
  close: () => Promise<void>;
}

async function sweep(base: string, path: string): Promise<readonly Shot[]> {
  const pw = await launchChromium();
  const out: Shot[] = [];
  try {
    // ⚠**한 장을 열고 폭만 바꾼다** — 폭마다 새로 여는 것은 151회 왕복이라 몇 분이 든다
    const page = (await pw.newPage(MIN_W)) as Probe;
    await page.goto(`${base.replace(/\/$/, "")}/${path}`, { waitUntil: "load" });
    for (let w = MIN_W; w <= MAX_W; w += STEP) {
      await page.setViewportSize({ width: w, height: 900 });
      const got = await page.evaluate(PROBE);
      out.push({ width: w, ...got });
    }
    await page.close();
  } finally {
    await pw.close();
  }
  return out;
}

function report(path: string, shots: readonly Shot[]): number {
  /** 탭줄이 상단바 **안**에 있는가 — 위로 잘리지도, 아래로 새지도 않는가 */
  const overflow = shots.filter((s) => s.navTop < s.bar.top - 0.5 || s.navBottom > s.bar.bottom + 0.5);
  const tall = shots.filter((s) => s.btnH > TBTN_MAX_H);
  /**
   * ⚠**이것이 진짜 계약이다.** `.rail`·`.hjump`·`.pickbar`·`scroll-padding-top`·`.shell` 이
   * 전부 `--topbar` 를 읽는데, 바가 그 높이가 아니면 그 다섯이 한꺼번에 어긋난다.
   * 탭줄이 바 안에 들어와 있어도 이쪽이 어긋나면 **앵커가 헤더 뒤에 숨는다.**
   */
  const lying = shots.filter((s) => Math.abs(s.bar.height - s.token) > 1);
  const tabCounts = new Set(shots.map((s) => s.tabs));
  process.stdout.write(`\n== ${path} ==\n`);
  process.stdout.write(`폭 ${shots.length}점(${MIN_W}~${MAX_W} step ${STEP}) · 탭 수 ${[...tabCounts].join("/")}\n`);
  process.stdout.write(`탭줄이 바를 벗어난 폭: ${overflow.length} / ${shots.length}\n`);
  if (overflow.length > 0) {
    const ws = overflow.map((s) => s.width);
    const worst = overflow.reduce((a, b) => (b.navBottom - b.bar.bottom > a.navBottom - a.bar.bottom ? b : a));
    process.stdout.write(`  구간 ${Math.min(...ws)}…${Math.max(...ws)}\n`);
    process.stdout.write(
      `  최악 ${worst.width}px: bar ${worst.bar.top.toFixed(1)}~${worst.bar.bottom.toFixed(1)} ` +
        `· nav ${worst.navTop.toFixed(1)}~${worst.navBottom.toFixed(1)}\n`,
    );
  }
  process.stdout.write(`#themeBtn 이 ${TBTN_MAX_H}px 를 넘은 폭: ${tall.length} / ${shots.length}`);
  if (tall.length > 0) {
    const ws = tall.map((s) => s.width);
    process.stdout.write(` (구간 ${Math.min(...ws)}…${Math.max(...ws)} · 최대 ${Math.max(...tall.map((s) => s.btnH)).toFixed(1)}px)`);
  }
  process.stdout.write("\n");
  process.stdout.write(`--topbar 가 실제 높이와 다른 폭: ${lying.length} / ${shots.length}`);
  if (lying.length > 0) {
    const ws = lying.map((s) => s.width);
    const worst = lying.reduce((a, b) => (Math.abs(b.bar.height - b.token) > Math.abs(a.bar.height - a.token) ? b : a));
    process.stdout.write(
      ` (구간 ${Math.min(...ws)}…${Math.max(...ws)} · 최악 ${worst.width}px: 바 ${worst.bar.height.toFixed(1)} vs 토큰 ${worst.token})`,
    );
  }
  process.stdout.write("\n");
  // ⚠**표를 볼 수 있어야 판단이 는다** — 「몇 개 실패」만으로는 어디를 고칠지 안 나온다
  if (process.env["BB_TOPBAR_DUMP"] === "1") {
    for (const s of shots) {
      process.stdout.write(
        `  ${String(s.width).padStart(4)}px  bar ${s.bar.height.toFixed(1).padStart(5)}` +
          `  token ${String(s.token).padStart(4)}` +
          `  nav ${s.navTop.toFixed(1).padStart(6)}~${s.navBottom.toFixed(1).padStart(6)}` +
          `  btn ${s.btnH.toFixed(1).padStart(5)}\n`,
      );
    }
  }
  return overflow.length + tall.length + lying.length;
}

const [base, ...paths] = process.argv.slice(2);
if (base === undefined) {
  process.stderr.write("사용법: measure-topbar.ts <baseUrl> <path...>\n");
  process.exit(2);
}
let bad = 0;
for (const p of paths.length > 0 ? paths : ["index.html"]) {
  bad += report(p, await sweep(base, p));
}
process.stdout.write(`\n합계 결함 폭 ${bad}\n`);
process.exit(bad > 0 ? 1 : 0);
