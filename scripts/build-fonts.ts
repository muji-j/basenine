/**
 * **배포물의 실제 글자에서 서체 부분집합을 굽고, 하나라도 빠지면 멈춘다.**
 *
 * ```
 * node scripts/build-fonts.ts dist
 * ```
 *
 * 규칙의 정본은 `docs/superpowers/specs/2026-09-07-design-direction.md` §5-A · §5-C · §5-E · §7-1.
 * 판정 로직은 `scripts/fonts.ts` 한 벌이다(M1) — 여기서 다시 구현하지 않는다.
 *
 * ## ⚠이 명령은 화면을 안 바꾼다
 *
 * `@font-face` 선언도 전환 UI 도 **여기서 만들지 않는다.** 이 명령이 내놓는 것은
 * **파일과 `manifest.json`** 뿐이고, CSS 배선이 그 매니페스트를 읽어 쓴다.
 * 지금 이 파일들을 받는 화면은 **하나도 없다** — 그래서 안전하게 먼저 깔 수 있다.
 *
 * ## ⚠실패는 실패로 낸다 (M7)
 *
 * 「Plex 가 못 덮으니 Noto 로」 같은 조용한 대체를 하지 않는다. 못 덮으면 **종료코드 1** 이고
 * **빠진 글자를 전부 찍는다.** 그것이 §5-C 가 요구한 것이다.
 *
 * ⚠**여기서 세우는 것이 커버리지만이 아니다**(2026-09-08 3차 검토):
 *   · **벤더링한 원본의 sha256** — 바이트를 읽는 그 자리에서 대조한다(`readVerified`).
 *     ⚠**시험에만 두면 소용이 없다** — `npm test` 와 이 명령은 별개 실행이라
 *     **시험을 건너뛰고 빌드만 돌리면** 갈린 바이트가 그대로 배포물에 들어간다.
 *   · **풀지 못한 이름 개체** — 조용히 무시하면 그 글자가 요구 목록에서 빠진다(M7).
 *
 * ## ⚠어디서 도는가 — 아직 CI 에서는 안 돈다
 *
 * `npm run build:web` 이 화면을 구운 **뒤에** 이것을 부른다(`&&`).
 * ⚠**로컬에서는 그 `&&` 가 안 넘어간다** — 로컬 DB 가 08-16 스냅샷이라 `build.ts` 가 마지막에
 * `⚠ 데이터가 낡았다` 로 **exit 1** 을 내기 때문이다(`dist` 는 다 만들어진 뒤다).
 * → **로컬에서는 `npm run build:fonts` 를 따로 돌려라.**
 *
 * ⚠**`.github/workflows/daily.yml` 은 `npm run build:web` 이 아니라 `build.ts` 를 직접 부른다.**
 * 그래서 **지금 CI 에서는 이 단계가 안 돈다.** 일부러 그렇게 뒀다 —
 * 아직 이 파일들을 받는 화면이 없고, CI 무료 분이 스케줄만으로 88% 차 있기 때문이다(CLAUDE.md §6).
 * **CSS 배선이 들어가는 그 변경에서 워크플로에 한 줄을 더해라**(실측 비용은 그 단계의 보고에 있다).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  FONT_OUT_DIR,
  WEIGHTS,
  assign,
  breakdown,
  cmapCodePoints,
  collectUsedChars,
  describeChars,
  digitAdvances,
  fromRoot,
  hashedName,
  layoutFeatures,
  readVerified,
  stacks,
  verifyCoverage,
} from "./fonts.ts";
import type { Stack } from "./fonts.ts";
// ⚠**대체 글꼴 목록의 정본은 화면 쪽이다**(M1 · 검토 P2). 여기서 다시 적지 않는다.
import { FONT_FALLBACK } from "../packages/web/src/assets.ts";
import subsetFont from "subset-font";

const require_ = createRequire(import.meta.url);
const fontverter = require_("fontverter") as {
  convert(buf: Buffer, to: "sfnt" | "woff2"): Promise<Buffer>;
};

/** ⚠`palt` 는 화면이 이미 켜고 있다(`font-feature-settings:"palt" 1`) · `tnum` 은 표의 자릿수를 잡는다 */
const FEATURES_WE_RELY_ON: readonly string[] = ["palt", "tnum"];

/**
 * ⚠**분모다** — 「0장 대조하고 통과」를 「깨끗함」으로 읽지 않기 위해 찍는다.
 * 판정 자체는 `scripts/fonts.ts` 의 `readVerified` 한 벌이다(M1).
 */
let shaChecked = 0;
let shaSkipped = 0;

const distArg = process.argv[2] ?? "dist";
const distDir = resolve(distArg);
const outDir = join(distDir, FONT_OUT_DIR);

interface FaceOut {
  readonly weight: number;
  readonly file: string;
  readonly bytes: number;
  readonly glyphChars: number;
}
interface FamilyOut {
  readonly key: string;
  readonly cssFamily: string;
  readonly reservedFontName: string | null;
  readonly license: string;
  readonly chars: number;
  readonly features: string[];
  /**
   * ⚠**§5-A 3 이 요구한 실측** — 숫자 0~9 의 진폭이 전부 같은가.
   * `tnum` 이 없어도 기본이 등폭이면 표는 안 흔들린다. **기능 목록이 아니라 이 값이 답이다.**
   */
  readonly tabularByDefault: boolean;
  readonly digitAdvances: number[];
  readonly faces: FaceOut[];
}

const t0 = process.hrtime.bigint();
const ms = (from: bigint): number => Number(process.hrtime.bigint() - from) / 1e6;

const used = collectUsedChars(distDir);
const scanMs = ms(t0);
const parts = breakdown(used.chars);

console.log(`# 서체 부분집합 — ${distDir}`);
console.log(
  `· 훑은 파일 ${used.filesRead}장 ${(used.bytesRead / 1024 / 1024).toFixed(1)} MiB ` +
    `(${Object.entries(used.byExtension).map(([e, n]) => `${e} ${n}`).join(" · ")})`,
);
console.log(`· 쓰이는 글자 ${used.chars.size}자 — ${Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
// ⚠**「조용히 뺐다」가 되지 않게 매번 찍는다**(M11 — 미수집·0·없음을 구별한다)
console.log(
  `· 주석에만 있어서 뺀 글자 ${used.commentOnly.length}자` +
    (used.commentOnly.length === 0
      ? ""
      : ` — ${used.commentOnly.slice(0, 12).map((cp) => String.fromCodePoint(cp)).join("")}${used.commentOnly.length > 12 ? "…" : ""}`),
);
console.log(`· 훑는 데 ${scanMs.toFixed(0)}ms`);

/** ⚠**먼저 다 굽고 나서 지운다** — 도중에 죽으면 옛 파일이라도 남아 있는 편이 낫다 */
const staged: { name: string; data: Buffer }[] = [];
const failures: string[] = [];

/**
 * ⚠**풀지 못한 이름 개체는 실패다**(M7 · 2026-09-08 3차 검토 P3).
 *
 * `&copy;` 처럼 표에 없는 이름은 **조용히 무시**되고, 그러면 그 글자가 요구 목록에서 빠져
 * **화면에서만 시스템 폰트로 떨어진다** — 이 게이트가 막으려는 그 상태다.
 * ⚠**「빈 값이 아니라 실패」**로 낸다. 실측(2026-09-08 · dist 전수)으로 `.html`/`.svg` 의
 * 이름 개체는 `&amp;` 1건이 전부라 **오늘 이 줄은 0건**이다.
 */
console.log(`· 풀지 못한 이름 개체 ${used.unknownEntities.length}종`);
if (used.unknownEntities.length > 0) {
  failures.push(
    `[이름 개체] 풀지 못한 이름 ${used.unknownEntities.length}종 — 그 글자가 요구 목록에서 빠진다:\n  ` +
      used.unknownEntities.map((e) => `&${e.name}; ×${e.count} (예: ${e.where})`).join("\n  ") +
      "\n  → scripts/fonts.ts 의 NAMED_ENTITIES 에 그 이름을 더하거나, 화면에서 글자를 그대로 써라.",
  );
}

const charsetSha = createHash("sha256")
  .update([...used.chars].sort((a, b) => a - b).join(","))
  .digest("hex");

const stackOut: { key: string; label: string; families: FamilyOut[] }[] = [];
const licenseFiles = new Map<string, string>();
const timing: { label: string; ms: number }[] = [];

for (const stack of stacks() as Stack[]) {
  const st = process.hrtime.bigint();

  // ── 원본을 읽고 cmap 을 만든다 ──────────────────────────────────────────
  const sources = new Map<string, Map<number, Buffer>>();
  const cmaps = new Map<string, Set<number>>();
  const features = new Map<string, Set<string>>();
  const digits = new Map<string, { list: number[]; equal: boolean }>();
  for (const fam of stack.order) {
    const byWeight = new Map<number, Buffer>();
    for (const w of WEIGHTS) {
      const path = fam.weights[w];
      if (path === undefined) throw new Error(`${fam.key} 에 웨이트 ${w} 원본이 없다`);
      // ⚠**바이트를 읽는 그 자리에서 대조한다** — 시험이 아니라 여기가 게이트다
      const want = fam.sha256?.[w];
      if (want === undefined) shaSkipped += 1;
      else shaChecked += 1;
      byWeight.set(w, readVerified(path, want, `${fam.key} ${w}`));
    }
    sources.set(fam.key, byWeight);
    // cmap·기능은 **400 원본** 기준으로 본다. 웨이트가 달라도 커버리지는 같아야 하고,
    // ⚠**다르면 아래 산출물 검사가 그 웨이트에서 붉어진다** — 여기서 가정만 하고 넘기지 않는다.
    const sfnt = await fontverter.convert(byWeight.get(400)!, "sfnt");
    cmaps.set(fam.key, cmapCodePoints(sfnt));
    features.set(fam.key, layoutFeatures(sfnt));
    const da = digitAdvances(sfnt);
    const list = [...da.advances.values()];
    digits.set(fam.key, { list, equal: list.length === 10 && new Set(list).size === 1 });
  }

  const a = assign(used.chars, stack, cmaps);
  console.log(`\n## ${stack.label} (${stack.key})`);
  for (const fam of stack.order) {
    const n = a.perFamily.get(fam.key)!.size;
    const f = features.get(fam.key)!;
    const d = digits.get(fam.key)!;
    console.log(
      `· ${fam.key} 원본 cmap ${cmaps.get(fam.key)!.size}자 → 맡은 글자 ${n}자` +
        ` · 기능 ${FEATURES_WE_RELY_ON.map((x) => `${x}=${f.has(x) ? "있음" : "없음"}`).join(" ")}` +
        ` · 숫자 기본 등폭 ${d.equal ? "예" : `⚠아니오(${[...new Set(d.list)].sort((x, y) => x - y).join("/")})`}`,
    );
  }

  if (a.missing.length > 0) {
    // ⚠**여기가 §5-C 의 본체다.** 줄이지 말고 전부 찍는다
    failures.push(
      `[${stack.label}] 스택 어느 서체도 못 덮는 글자 ${a.missing.length}자:\n  ${describeChars(a.missing)}`,
    );
  }

  // ── 부분집합을 굽고, 산출물에서 다시 센다 ──────────────────────────────
  const families: FamilyOut[] = [];
  for (const fam of stack.order) {
    const mine = a.perFamily.get(fam.key)!;
    const text = [...mine].sort((x, y) => x - y).map((cp) => String.fromCodePoint(cp)).join("");
    const faces: FaceOut[] = [];
    for (const w of WEIGHTS) {
      const woff2 = await subsetFont(sources.get(fam.key)!.get(w)!, text, { targetFormat: "woff2" });
      // ⚠**배포되는 파일에서 센다**(§7-1 P1). 원본이 아니라 이것이 검사 대상이다
      const back = await fontverter.convert(woff2, "sfnt");
      const gone = verifyCoverage(back, mine);
      if (gone.length > 0) {
        failures.push(
          `[${stack.label} · ${fam.key} ${w}] 부분집합 산출물에서 ${gone.length}자가 빠졌다:\n  ${describeChars(gone)}`,
        );
      }
      const name = hashedName(fam.key, w, woff2);
      staged.push({ name, data: woff2 });
      faces.push({ weight: w, file: name, bytes: woff2.length, glyphChars: mine.size });
    }
    licenseFiles.set(fam.licenseAs, fam.licenseFrom);
    families.push({
      key: fam.key,
      cssFamily: fam.cssFamily,
      reservedFontName: fam.reservedFontName,
      license: fam.licenseAs,
      chars: mine.size,
      features: [...features.get(fam.key)!].sort(),
      tabularByDefault: digits.get(fam.key)!.equal,
      digitAdvances: digits.get(fam.key)!.list,
      faces,
    });
  }
  stackOut.push({ key: stack.key, label: stack.label, families });
  timing.push({ label: stack.label, ms: ms(st) });
  for (const fam of families) {
    for (const f of fam.faces) {
      console.log(`  · ${f.file} ${(f.bytes / 1024).toFixed(1)} KiB (${f.glyphChars}자)`);
    }
  }
}

// ⚠**시간과 크기는 실패해도 찍는다** — 실패 때 못 재면 「예산 안에 드는가」를 영영 못 묻는다(§7-5)
const totalBytes = staged.reduce((n, s) => n + s.data.length, 0);
const fileCount = staged.length + licenseFiles.size + 1;
console.log(`\n## 산출${failures.length > 0 ? " (⚠게이트 실패라 **쓰지 않는다**)" : ""}`);
console.log(
  `· 폰트 ${staged.length}장 ${(totalBytes / 1024).toFixed(1)} KiB · 라이선스 ${licenseFiles.size}장 · 매니페스트 1장 = **${fileCount}장**`,
);
console.log(
  `· 원본 sha256 대조 ${shaChecked}장 일치 · 대조 안 함 ${shaSkipped}장` +
    " (npm 쪽 — 락파일의 integrity 가 같은 일을 한다)",
);
console.log(`· 훑기 ${(scanMs / 1000).toFixed(1)}초`);
for (const t of timing) console.log(`· ${t.label} 굽기 ${(t.ms / 1000).toFixed(1)}초`);
console.log(`· 합계 ${(ms(t0) / 1000).toFixed(1)}초`);

if (failures.length > 0) {
  // ⚠**「커버리지 실패」로만 적지 마라** — 이 목록에는 풀지 못한 이름 개체도 들어온다
  console.error(
    `\n⚠서체 게이트 실패 ${failures.length}건 — 배포하면 그 글자만 시스템 폰트로 떨어진다.` +
      "\n  (커버리지인지 이름 개체인지는 아래 각 항목의 머리가 말한다)",
  );
  for (const f of failures) console.error(`\n${f}`);
  console.error(
    "\n⚠**조용히 다른 서체로 바꾸지 마라**(§7-1 P2). 고르는 길은 둘뿐이다:\n" +
      "  ⑴ 그 글자를 화면에서 안 쓰거나, ⑵ 그 글자를 덮는 서체로 바꾸는 결정을 사람이 한다.",
  );
  process.exit(1);
}

// ── 다 됐을 때만 쓴다 ────────────────────────────────────────────────────
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const s of staged) writeFileSync(join(outDir, s.name), s.data);
for (const [as_, from] of licenseFiles) writeFileSync(join(outDir, as_), readFileSync(fromRoot(from)));

const manifest = {
  /** ⚠**이 값이 그대로면 부분집합도 그대로다** — CSS 배선이 재생성 여부를 이걸로 판단할 수 있다 */
  charsetSha256: charsetSha,
  scanned: { files: used.filesRead, bytes: used.bytesRead, byExtension: used.byExtension },
  chars: { total: used.chars.size, ...parts },
  /** ⚠**주석에만 있어서 요구하지 않은 글자.** 비어 있지 않다면 그것이 정말 안 그려지는지 확인하라 */
  commentOnly: used.commentOnly.map((cp) => String.fromCodePoint(cp)).join(""),
  stacks: stackOut,
  licenses: [...licenseFiles.keys()].sort(),
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ── CSS 배선 (3단계 · 2026-09-08) ────────────────────────────────────────
/**
 * ⚠**여기서 CSS 를 쓰는 이유는 하나다: 파일명이 해시라 `assets.ts` 가 미리 못 적는다.**
 * 그래서 매니페스트를 **방금 만든 이 자리**에서 읽어 `site.css` 뒤에 붙인다.
 *
 * ⚠**같은 자리에 두 번 붙지 않는다** — 표식 사이를 통째로 갈아 끼운다(멱등 · M5 의 정신).
 * ⚠**`--f-body` 는 이미 토큰이다**(1단계가 만들었다) — 그래서 배선이 **그 값 하나만** 바꾼다.
 *
 * ## ⚠서체 이름을 원래 이름으로 쓰지 않는 이유 — 둘이고 서로 다르다
 *
 * · **IBM Plex** — OFL 의 **예약 서체명이 "Plex"** 이고 §1 이 **글리프 삭제도 개변**으로 본다.
 *   즉 이 부분집합은 개변판이라 그 이름을 쓰면 안 된다. ⚠**안전한 쪽으로 고른 것이지
 *   법률 판단이 아니다**(Google Fonts 는 같은 서체의 부분집합을 원래 이름으로 서빙한다).
 * · **Noto** — 예약명은 "Source" 라 OFL 은 안 걸린다. 그런데 **`--f-body` 의 대체 목록에
 *   "Noto Sans JP" 가 들어 있다** — 같은 이름으로 선언하면 **사용자 기기에 깔린 그 서체를
 *   우리 부분집합이 덮어쓴다.** 이름 충돌이라 바꾼다.
 *
 * **두 사유가 다르므로 뭉뚱그리지 마라.** 한쪽이 풀려도 다른 쪽은 남는다.
 */
/**
 * ⚠**표식은 ASCII 여야 한다 — 한글로 썼다가 커버리지 게이트에 잡혔다**(2026-09-08).
 *
 * 이 표식은 **배포물(site.css)에 그대로 실린다.** 처음에 한국어로 적었더니
 * 다음 훑기가 그 한글을 「쓰이는 글자」로 세어 **서체가 못 덮는다고 멈췄다**
 * (다·라·로·마·손·쓴·으·지·치 — 서체에 한글이 없다).
 * ⚠**두 가지가 동시에 잘못이었다**: ⑴ 내부 주석이 배포물에 샜고 ⑵ 두 번째 실행이 실패했다(멱등 아님).
 * ⚠**assets.ts 의 한국어 주석은 안 새는데** 그건 stripJsComments 가 걷어내기 때문이다 —
 * **여기서 붙이는 것은 그 경로를 안 지난다.** 그러니 여기 나가는 글자는 전부 ASCII 로 적어라.
 * ⚠**게이트가 잡았다는 것이 이 설계의 값이다** — 안 세웠으면 한글이 배포물에 조용히 남았다.
 */
const MARK_A = "/* bb-fonts:begin (written by build-fonts.ts) */";
const MARK_B = "/* bb-fonts:end */";
/**
 * 대체 목록 — 웹폰트가 못 오면 여기로 떨어진다.
 * ⚠**여기 적지 않는다 — 적었다가 검토에 잡혔다**(P2 · 2026-09-08).
 * 같은 목록이 `assets.ts` 에도 있었는데, **여기서 붙이는 규칙이 그쪽을 항상 이겨서**
 * 그 값이 **죽은 선언**이 돼 있었다. 정본은 `assets.ts` 의 `FONT_FALLBACK` 하나다(M1).
 */
const FALLBACK = FONT_FALLBACK;
const SYSTEM = FALLBACK;

const cssFamilyOf = (stackKey: string, famKey: string): string =>
  `BN ${stackKey === "plex" ? "Sans" : "Noto"}${famKey.endsWith("-jp") ? " JP" : ""}`;

const faceRules: string[] = [];
const stackFamilies = new Map<string, string[]>();
for (const st of stackOut) {
  const names: string[] = [];
  for (const fam of st.families) {
    const name = cssFamilyOf(st.key, fam.key);
    if (!names.includes(name)) names.push(name);
    for (const face of fam.faces) {
      faceRules.push(
        `@font-face{font-family:"${name}";font-weight:${face.weight};font-style:normal;` +
          // ⚠**swap 이 안전한 근거가 있다**(§5-D 실측): 서체가 바뀌어도 **행이 두 줄 되는 곳이 0** 이다.
          //   optional 은 느린 회선에서 서체를 아예 건너뛰어 「고른 이유」가 사라지므로 안 쓴다.
          `font-display:swap;src:url("fonts/${face.file}") format("woff2")}`,
      );
    }
  }
  // ⚠**JP 를 먼저 둔다** — 라틴 부분집합에는 한자가 없어서, 라틴이 앞에 오면 브라우저가
  //   글자마다 두 번 찾는다. 어차피 unicode-range 를 안 쓰므로 순서가 곧 우선순위다.
  stackFamilies.set(st.key, names.sort((a, b) => (b.endsWith(" JP") ? 1 : 0) - (a.endsWith(" JP") ? 1 : 0)));
}
const quoted = (k: string) => stackFamilies.get(k)!.map((n) => `"${n}"`).join(",");
const cssBlock = [
  MARK_A,
  ...faceRules,
  // ⚠⚠**CSS 의 기본은 시스템이다 — 초기값이 Plex 인 것과 다른 말이고, 그 차이가 중요하다.**
  //   처음에는 data-font 가 없을 때도 plex 로 뒀는데, **실측이 그게 나쁘다는 것을 보여줬다**
  //   (2026-09-08 · 저장된 선택으로 화면을 열었을 때의 woff2 요청 수):
  //     저장 plex 4개 · 저장 **noto 8개**(Plex 4장을 버리고 Noto 를 또 받는다) ·
  //     저장 **system 4개**(전부 버려진다 · 계획서의 「0건」 게이트 실패).
  //   **기본이 아닌 것을 고른 사람이 오히려 손해를 본다.** 원인은 이 사이트에
  //   **인라인 실행 스크립트가 0개**라 저장된 선택을 첫 페인트 전에 못 심는 것이다.
  //   → **뒤집는다.** CSS 기본은 시스템이고, 스크립트가 뜨면 초기값(plex)을 켠다.
  //   ⚠**보이는 순서는 안 바뀐다** — font-display:swap 이라 **어차피 첫 페인트는 대체 글꼴**이다.
  //     바뀌는 것은 요청이 약 100ms 늦게 나간다는 것뿐이고(defer 실행 시점),
  //     그 대가로 **고른 대로만 받는다.**
  //   ⚠**스크립트가 없으면 시스템 글꼴로 남는다** — 화면은 정상이고(§0-1) 웹폰트는 덤이다.
  `html:not([data-font]),html[data-font="system"]{--f-body:${SYSTEM}}`,
  `html[data-font="plex"]{--f-body:${quoted("plex")},${FALLBACK}}`,
  `html[data-font="noto"]{--f-body:${quoted("noto")},${FALLBACK}}`,
  MARK_B,
].join("\n");

const siteCssPath = join(outDir, "..", "site.css");
if (existsSync(siteCssPath)) {
  const cur = readFileSync(siteCssPath, "utf8");
  const cut = cur.includes(MARK_A)
    ? cur.slice(0, cur.indexOf(MARK_A)) + cur.slice(cur.indexOf(MARK_B) + MARK_B.length)
    : cur;
  writeFileSync(siteCssPath, cut.trimEnd() + "\n" + cssBlock + "\n");
  console.log(
    `· CSS 배선: site.css 에 @font-face ${faceRules.length}개 + 전환 규칙 3개를 붙였다` +
      ` (${(Buffer.byteLength(cssBlock) / 1024).toFixed(1)} KiB)`,
  );
} else {
  // ⚠**여기서 바로 끝낸다 — 안 끝냈다가 검토에 잡혔다**(P3 · 2026-09-08).
  //   exitCode 만 세우고 흘려보내면 바로 아래 「썼다」가 그대로 찍혀
  //   **실패한 실행이 성공처럼 읽힌다.** 종료코드는 맞았지만 로그가 거짓말을 했다.
  console.error(`⚠ ${siteCssPath} 가 없다 — 화면을 먼저 구워야 한다. **CSS 배선을 못 했다.**`);
  process.exit(1);
}

console.log(`· 썼다: ${outDir}`);
