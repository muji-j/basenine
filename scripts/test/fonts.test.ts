/**
 * **서체 부분집합 파이프라인 — 「누락을 빌드가 막는가」를 붙든다.**
 *
 * 정본은 `docs/superpowers/specs/2026-09-07-design-direction.md` §5-C · §7-1.
 *
 * ## ⚠이 시험의 존재 이유
 *
 * §5-C 가 요구한 것은 **검사**지 **위험 표시**가 아니다. 그리고 검사는
 * **「한 글자를 빼면 붉어지는가」로만 증명된다**(뮤테이션). 그래서 아래 뮤테이션 본을
 * **지우지 마라** — 지우는 순간 나머지 본들은 「초록인데 아무것도 안 지키는」 상태가 된다.
 *
 * ## ⚠원본이 아니라 배포되는 WOFF2 를 본다 (§7-1 P1)
 *
 * 원본 TTF 에 있는 글자가 **부분집합 산출물에서 빠질 수 있다.** 그래서 뮤테이션도
 * **산출 파일에서** 글자를 빼서 확인한다.
 *
 * ## 실측 시간
 *
 * 이 파일 전체가 **약 12초**다(2026-09-08 · Windows). 실제 원본 서체를 진짜로 부분집합하기
 * 때문이고, 가짜 폰트로 대신하면 **부분집합 과정에서 빠지는 것**을 못 잡는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  CharSink,
  FONT_OUT_DIR,
  assign,
  cmapCodePoints,
  collectUsedChars,
  digitAdvances,
  hashedName,
  layoutFeatures,
  scanBytes,
  stacks,
  stripJsComments,
  verifyCoverage,
} from "../fonts.ts";
import subsetFont from "subset-font";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const fontverter = require_("fontverter") as { convert(b: Buffer, to: "sfnt" | "woff2"): Promise<Buffer> };

/** 부분집합에 쓸 만큼만. ⚠**실제 원본**이다 — 가짜로는 이 시험이 아무것도 안 지킨다 */
const PLEX_JP = join(ROOT, "vendor/fonts/ibm-plex/IBMPlexSansJP-Regular.woff2");
const PLEX_LATIN = join(ROOT, "vendor/fonts/ibm-plex/IBMPlexSans-Regular.woff2");

async function makeDist(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-fonts-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// 글자 모으기
// ---------------------------------------------------------------------------

test("⚠전수를 훑는다 — 읽은 파일이 0장이면 「깨끗함」이 아니라 실패다", async () => {
  const dir = await makeDist({ "a.html": "<p>山田</p>", "b/c.json": '{"n":"鈴木"}' });
  try {
    const got = collectUsedChars(dir);
    assert.equal(got.filesRead, 2, "훑은 파일 수가 다르다 — 이 시험이 공회전한다");
    for (const ch of "山田鈴木") assert.ok(got.chars.has(ch.codePointAt(0)!), `${ch} 를 못 셌다`);
    // ASCII 바닥 — 파일에 없어도 항상 들어 있다(M5 고정점)
    assert.ok(got.chars.has(0x7a), "ASCII 바닥이 없다 — 해시 파일 이름이 집합을 흔들게 된다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠빈 디렉터리는 통과가 아니라 실패다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-fonts-empty-"));
  try {
    assert.throws(() => collectUsedChars(dir), /0개/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠속성값·JSON·JS 문자열까지 센다 — 정적 본문만 보면 §5-C 2 를 어긴다", async () => {
  const dir = await makeDist({
    "a.html": '<button aria-label="打席結果"></button>',
    "d.json": '{"name":"大谷"}',
    "assets/site.js": 'const t = "検索結果";\n',
  });
  try {
    const got = collectUsedChars(dir);
    for (const ch of "打席結果大谷検索") assert.ok(got.chars.has(ch.codePointAt(0)!), `${ch} 를 못 셌다`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠JS 주석의 글자는 요구하지 않는다 — 그리지 않기 때문이다. 대신 목록으로 낸다", async () => {
  const dir = await makeDist({ "assets/site.js": '// 한국어 주석이다\nconst t = "打者";\n' });
  try {
    const got = collectUsedChars(dir);
    assert.ok(got.chars.has("打".codePointAt(0)!), "문자열의 글자를 지웠다 — 이쪽이 훨씬 나쁜 실수다");
    assert.ok(!got.chars.has("한".codePointAt(0)!), "주석의 글자를 요구하고 있다");
    assert.ok(got.commentOnly.includes("한".codePointAt(0)!), "뺀 글자를 목록으로 안 낸다 — 조용한 제외다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠주석 제거가 어긋나면 던진다 — 조용히 문자열을 지우는 쪽이 더 나쁘다", () => {
  assert.throws(() => stripJsComments('const s = "안 닫힌 문자열'), /어긋났다/);
  // 정상 입력은 그대로 돈다
  assert.equal(stripJsComments('const s = "//not a comment"; // real\n').code.includes("//not a comment"), true);
});

test("⚠엔티티를 푼다 — 안 풀면 화면에 나오는 글자를 안 센다", async () => {
  const dir = await makeDist({ "a.html": "<p>&#x2015;&#8212;&nbsp;</p>" });
  try {
    const got = collectUsedChars(dir);
    assert.ok(got.chars.has(0x2015), "16진 엔티티를 안 풀었다");
    assert.ok(got.chars.has(0x2014), "10진 엔티티를 안 풀었다");
    assert.ok(got.chars.has(0x00a0), "이름 엔티티를 안 풀었다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠줄바꿈·제로폭은 요구하지 않는다 — 요구하면 첫 실행부터 전 서체가 실패한다", async () => {
  const dir = await makeDist({ "a.html": "<p>\n\t打​</p>" });
  try {
    const got = collectUsedChars(dir);
    assert.ok(!got.chars.has(0x0a), "줄바꿈을 글자로 세고 있다");
    assert.ok(!got.chars.has(0x09), "탭을 글자로 세고 있다");
    assert.ok(!got.chars.has(0x200b), "제로폭을 글자로 세고 있다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠자기 산출물은 안 훑는다 — 안 그러면 해시 이름이 스스로를 먹는다(M5)", async () => {
  const dir = await makeDist({ "a.html": "<p>打</p>", [join(FONT_OUT_DIR, "note.txt")]: "者" });
  try {
    const got = collectUsedChars(dir);
    assert.ok(got.chars.has("打".codePointAt(0)!));
    assert.ok(!got.chars.has("者".codePointAt(0)!), "산출 디렉터리를 훑고 있다 — 고정점이 깨진다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("⚠바이트로 훑은 결과가 사람이 아는 답과 같다 — 빠른 경로가 조용히 덜 세면 최악이다", () => {
  const sink = new CharSink();
  const text = "打者A①𠮷"; // 3바이트·1바이트·3바이트·**4바이트(서러게이트)** 를 섞는다
  scanBytes(Buffer.from(text, "utf8"), sink, false);
  const got = sink.toSet();
  for (const ch of text) assert.ok(got.has(ch.codePointAt(0)!), `${ch}(U+${ch.codePointAt(0)!.toString(16)}) 를 놓쳤다`);
  assert.equal(got.size, [...new Set([...text])].length, "센 글자 수가 다르다");
});

// ---------------------------------------------------------------------------
// 스택 배정 — 라틴 폰트에 한자를 요구하지 않는다 (§7-1 P2)
// ---------------------------------------------------------------------------

test("⚠배정은 스택 순서를 따른다 — 라틴 폰트에 한자를 요구하면 「Plex 는 못 쓴다」는 거짓이 나온다", () => {
  const plex = stacks().find((s) => s.key === "plex")!;
  const cmaps = new Map<string, ReadonlySet<number>>([
    ["plex-latin", new Set([0x41, 0x42])],
    ["plex-jp", new Set([0x41, 0x6253])],
  ]);
  const a = assign(new Set([0x41, 0x6253, 0x9999]), plex, cmaps);
  assert.deepEqual([...a.perFamily.get("plex-latin")!], [0x41], "라틴이 먼저 가져가야 한다");
  assert.deepEqual([...a.perFamily.get("plex-jp")!], [0x6253], "라틴에 없는 것만 JP 가 맡는다");
  assert.deepEqual(a.missing, [0x9999], "어디에도 없는 글자를 안 잡아냈다");
});

// ---------------------------------------------------------------------------
// 부분집합 · 커버리지 · 뮤테이션
// ---------------------------------------------------------------------------

test("⚠부분집합 산출물이 요구한 글자를 전부 갖는다 (배포되는 WOFF2 에서 센다)", async () => {
  const want = new Set([..."打者投手1234567890年月日"].map((c) => c.codePointAt(0)!));
  const text = [...want].map((c) => String.fromCodePoint(c)).join("");
  const woff2 = await subsetFont(readFileSync(PLEX_JP), text, { targetFormat: "woff2" });
  const missing = verifyCoverage(await fontverter.convert(woff2, "sfnt"), want);
  assert.deepEqual(missing, [], `산출물에서 ${missing.length}자가 빠졌다`);
});

/**
 * ⚠**이 본이 §5-C 4 가 요구한 뮤테이션이다.**
 * **배포 파일에서** 한 글자를 빼고, 검사가 그것을 잡는지 본다. 안 잡으면 나머지 시험이 전부 장식이다.
 */
test("⚠뮤테이션 — 배포 파일에서 한 글자를 빼면 검사가 그 글자를 집어낸다", async () => {
  const want = new Set([..."打者投手"].map((c) => c.codePointAt(0)!));
  const dropped = "者".codePointAt(0)!;
  const short = [...want].filter((c) => c !== dropped).map((c) => String.fromCodePoint(c)).join("");
  const woff2 = await subsetFont(readFileSync(PLEX_JP), short, { targetFormat: "woff2" });
  const missing = verifyCoverage(await fontverter.convert(woff2, "sfnt"), want);
  assert.deepEqual(missing, [dropped], "한 글자를 뺐는데 검사가 초록이다 — 이 검사는 아무것도 안 지킨다");
});

test("⚠`palt` 가 부분집합 뒤에도 살아 있다 — 화면이 이미 켜고 있는 기능이다", async () => {
  const woff2 = await subsetFont(readFileSync(PLEX_JP), "打者、。（）", { targetFormat: "woff2" });
  const feats = layoutFeatures(await fontverter.convert(woff2, "sfnt"));
  assert.ok(feats.has("palt"), `palt 가 사라졌다. 남은 기능: ${[...feats].sort().join(",")}`);
});

test("⚠숫자가 등폭이다 — 표가 주역이라 자릿수가 흔들리면 치명적이다(§5-A 3)", async () => {
  for (const [name, src] of [
    ["plex-jp", PLEX_JP],
    ["plex-latin", PLEX_LATIN],
  ] as const) {
    const woff2 = await subsetFont(readFileSync(src), "0123456789", { targetFormat: "woff2" });
    const { advances } = digitAdvances(await fontverter.convert(woff2, "sfnt"));
    const widths = new Set(advances.values());
    assert.equal(advances.size, 10, `${name}: 숫자 10자를 다 못 찾았다`);
    assert.equal(widths.size, 1, `${name}: 숫자 진폭이 ${[...widths].join("/")} 로 갈린다`);
  }
});

// ---------------------------------------------------------------------------
// 캐시 키 · 멱등
// ---------------------------------------------------------------------------

test("⚠내용이 바뀌면 파일 이름이 바뀐다 — 이 저장소는 캐시 불일치로 사고를 겪었다", () => {
  const a = hashedName("plex-jp", 400, Buffer.from("aaa"));
  const b = hashedName("plex-jp", 400, Buffer.from("aab"));
  assert.notEqual(a, b, "내용이 다른데 이름이 같다 — 새 HTML 이 옛 폰트를 문다");
  assert.equal(a, hashedName("plex-jp", 400, Buffer.from("aaa")), "같은 내용인데 이름이 다르다");
  assert.match(a, /^plex-jp-400\.[0-9a-f]{10}\.woff2$/);
});

test("⚠같은 글자를 두 번 구우면 바이트까지 같다 (M5 멱등)", async () => {
  const src = readFileSync(PLEX_JP);
  const one = await subsetFont(src, "打者投手", { targetFormat: "woff2" });
  const two = await subsetFont(src, "打者投手", { targetFormat: "woff2" });
  assert.equal(hashedName("x", 400, one), hashedName("x", 400, two), "두 번 구운 결과가 다르다 — URL 이 매일 바뀐다");
});

test("⚠cmap 을 못 읽으면 던진다 — 빈 집합을 돌려주면 왜 붉은지 못 읽는다", () => {
  assert.throws(() => cmapCodePoints(Buffer.alloc(4)), /짧다/);
  assert.throws(() => cmapCodePoints(Buffer.alloc(32)), /서명/);
});

/**
 * **cmap 이 `.notdef`(글리프 0)로 보내는 코드포인트는 「덮는다」가 아니다.**
 *
 * ⚠**이 본이 없으면 뮤테이션 하나가 살아남는다**(실측 · `scripts/fonts-mutation-check.ts` ②).
 * 실제 서체에 그런 항목이 흔하지 않아 **원본으로는 못 잡는다** — 그래서 **손으로 만든 cmap** 을 쓴다.
 * 놓치면 「덮는다고 셌는데 화면에는 두부(□)가 나오는」 상태가 되고, 그건 검사가 있는데
 * 아무것도 안 지키는 가장 나쁜 모양이다.
 */
function sfntWithCmap(sub: Buffer): Buffer {
  const head = Buffer.alloc(28);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(1, 4); // numTables
  head.write("cmap", 12, "latin1");
  head.writeUInt32BE(28, 20); // offset
  head.writeUInt32BE(4 + 8 + sub.length, 24); // length
  const table = Buffer.alloc(4 + 8);
  table.writeUInt16BE(0, 0); // version
  table.writeUInt16BE(1, 2); // numTables
  table.writeUInt16BE(3, 4); // platformID = Windows
  table.writeUInt16BE(1, 6); // encodingID = BMP
  table.writeUInt32BE(12, 8); // subtable offset (cmap 시작 기준)
  return Buffer.concat([head, table, sub]);
}

test("⚠글리프 0 으로 가는 코드포인트를 「덮는다」로 세지 않는다 (cmap format 4)", () => {
  // 세그먼트 하나에 'A'→글리프 5 · 'B'→**글리프 0**. `idRangeOffset` 을 써야 둘을 갈라 넣을 수 있다
  const sub = Buffer.alloc(36);
  sub.writeUInt16BE(4, 0); // format
  sub.writeUInt16BE(36, 2); // length
  sub.writeUInt16BE(4, 6); // segCountX2 = 2세그먼트
  sub.writeUInt16BE(0x0042, 14); // endCode[0]
  sub.writeUInt16BE(0xffff, 16); // endCode[1] (필수 종단 세그먼트)
  sub.writeUInt16BE(0x0041, 20); // startCode[0]
  sub.writeUInt16BE(0xffff, 22); // startCode[1]
  sub.writeInt16BE(0, 24); // idDelta[0]
  sub.writeInt16BE(1, 26); // idDelta[1]
  sub.writeUInt16BE(4, 28); // idRangeOffset[0] → glyphIdArray 로
  sub.writeUInt16BE(0, 30); // idRangeOffset[1]
  sub.writeUInt16BE(5, 32); // glyphIdArray[0] = 'A' → 5
  sub.writeUInt16BE(0, 34); // glyphIdArray[1] = 'B' → **0**
  const got = cmapCodePoints(sfntWithCmap(sub));
  assert.ok(got.has(0x41), "'A' 를 못 읽었다 — 이 픽스처가 헛돌고 있다");
  assert.ok(!got.has(0x42), "'B' 는 글리프 0 이라 못 그린다 — 그런데 「덮는다」로 셌다");
});

test("⚠글리프 0 으로 가는 코드포인트를 「덮는다」로 세지 않는다 (cmap format 12)", () => {
  // 그룹 둘: 'A' → 글리프 7 · 'B' → **글리프 0**
  const sub = Buffer.alloc(16 + 24);
  sub.writeUInt16BE(12, 0); // format
  sub.writeUInt32BE(16 + 24, 4); // length
  sub.writeUInt32BE(2, 12); // numGroups
  sub.writeUInt32BE(0x41, 16);
  sub.writeUInt32BE(0x41, 20);
  sub.writeUInt32BE(7, 24);
  sub.writeUInt32BE(0x42, 28);
  sub.writeUInt32BE(0x42, 32);
  sub.writeUInt32BE(0, 36);
  const got = cmapCodePoints(sfntWithCmap(sub));
  assert.ok(got.has(0x41), "'A' 를 못 읽었다 — 이 픽스처가 헛돌고 있다");
  assert.ok(!got.has(0x42), "'B' 는 글리프 0 이라 못 그린다 — 그런데 「덮는다」로 셌다");
});

// ---------------------------------------------------------------------------
// 배선 — 도구가 있다는 것과 도는 것은 다른 말이다
// ---------------------------------------------------------------------------

test("⚠`npm run build:web` 이 서체까지 굽는다 — 안 그러면 새 글자가 나온 날 얼굴이 바뀐다", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  assert.ok(scripts["build:fonts"] !== undefined, "build:fonts 스크립트가 없다");
  assert.match(
    scripts["build:web"] ?? "",
    /build-fonts\.ts|run build:fonts/,
    "build:web 이 서체를 안 굽는다 — 화면만 새로 굽고 부분집합은 낡은 채로 남는다",
  );
  // ⚠**정확히 고정한다** — `^` 로 두면 어느 날 다른 글리프 집합이 조용히 들어온다
  for (const dep of ["@expo-google-fonts/noto-sans", "@expo-google-fonts/noto-sans-jp", "subset-font", "fontverter"]) {
    const v = (pkg.devDependencies ?? {})[dep];
    assert.ok(v !== undefined, `${dep} 이 devDependencies 에 없다`);
    assert.match(v, /^\d+\.\d+\.\d+$/, `${dep} 이 정확히 고정돼 있지 않다: ${v}`);
  }
  // ⚠**IBM Plex 는 npm 에 두지 않는다** — `postinstall: ibmtelemetry` 때문이다
  //   (사유·대안 비교는 `vendor/fonts/ibm-plex/README.md`). 되돌리면 install-scripts 시험이 먼저 운다
  for (const dep of ["@ibm/plex-sans", "@ibm/plex-sans-jp"]) {
    assert.equal(
      (pkg.devDependencies ?? {})[dep],
      undefined,
      `${dep} 이 다시 들어왔다 — 그 패키지는 설치 때 IBM 텔레메트리를 돌린다(배포 토큰이 있는 잡에서)`,
    );
  }
});

/**
 * ⚠**벤더링한 파일이 바뀌면 알아야 한다.**
 * npm 쪽은 락파일의 `integrity` 가 이 일을 해 주지만 **저장소 안의 파일은 아무도 안 지킨다** —
 * 글리프가 다른 파일로 조용히 갈리면 부분집합이 통째로 달라지고 아무 시험도 안 운다.
 */
test("⚠벤더링한 원본이 적어 둔 sha256 과 같다 — 조용한 교체를 막는다", () => {
  let checked = 0;
  for (const stack of stacks()) {
    for (const fam of stack.order) {
      if (fam.sha256 === null) continue;
      for (const [w, want] of Object.entries(fam.sha256)) {
        const path = fam.weights[Number(w)];
        assert.ok(path !== undefined, `${fam.key} ${w}: 원본 경로가 없다`);
        const got = createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
        assert.equal(got, want, `${fam.key} ${w} (${path}) 의 내용이 적어 둔 것과 다르다`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 6, `대조한 파일이 ${checked}개다 — 6개여야 한다(이 시험이 공회전한다)`);
});

test("⚠OFL 사본을 실을 자리가 있다 — 부분집합도 배포물이다", () => {
  for (const stack of stacks()) {
    for (const fam of stack.order) {
      const text = readFileSync(join(ROOT, fam.licenseFrom), "utf8");
      assert.match(text, /SIL OPEN FONT LICENSE/i, `${fam.key}: OFL 원문이 아니다`);
      if (fam.reservedFontName !== null) {
        assert.match(
          text,
          new RegExp(`Reserved Font Name.{0,4}${fam.reservedFontName}`, "i"),
          `${fam.key}: 예약명이 ${fam.reservedFontName} 이라고 적어 뒀는데 라이선스 원문에 없다`,
        );
      }
    }
  }
});
