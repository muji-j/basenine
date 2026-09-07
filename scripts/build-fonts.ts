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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  stacks,
  verifyCoverage,
} from "./fonts.ts";
import type { Stack } from "./fonts.ts";
import subsetFont from "subset-font";

const require_ = createRequire(import.meta.url);
const fontverter = require_("fontverter") as {
  convert(buf: Buffer, to: "sfnt" | "woff2"): Promise<Buffer>;
};

/** ⚠`palt` 는 화면이 이미 켜고 있다(`font-feature-settings:"palt" 1`) · `tnum` 은 표의 자릿수를 잡는다 */
const FEATURES_WE_RELY_ON: readonly string[] = ["palt", "tnum"];

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

const charsetSha = createHash("sha256")
  .update([...used.chars].sort((a, b) => a - b).join(","))
  .digest("hex");

/** ⚠**먼저 다 굽고 나서 지운다** — 도중에 죽으면 옛 파일이라도 남아 있는 편이 낫다 */
const staged: { name: string; data: Buffer }[] = [];
const failures: string[] = [];
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
      byWeight.set(w, readFileSync(fromRoot(path)));
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
console.log(`\n## 산출${failures.length > 0 ? " (⚠커버리지 실패라 **쓰지 않는다**)" : ""}`);
console.log(
  `· 폰트 ${staged.length}장 ${(totalBytes / 1024).toFixed(1)} KiB · 라이선스 ${licenseFiles.size}장 · 매니페스트 1장 = **${fileCount}장**`,
);
console.log(`· 훑기 ${(scanMs / 1000).toFixed(1)}초`);
for (const t of timing) console.log(`· ${t.label} 굽기 ${(t.ms / 1000).toFixed(1)}초`);
console.log(`· 합계 ${(ms(t0) / 1000).toFixed(1)}초`);

if (failures.length > 0) {
  console.error(`\n⚠서체 커버리지 실패 ${failures.length}건 — 배포하면 그 글자만 시스템 폰트로 떨어진다.`);
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

console.log(`· 썼다: ${outDir}`);
