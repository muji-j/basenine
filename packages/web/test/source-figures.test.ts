/**
 * **화면 문자열에 박힌 실측 수치** — 소스를 글자로 읽어 잡는다.
 *
 * ⚠**이 저장소는 같은 실수를 한 라운드에 세 번 했다**(2026-08-20):
 * ⑴ 리그 실측치를 배포물 1,808장에 하드코딩 · ⑵ 루별 도루 수치를 각주 문자열에 ·
 * ⑶ 용어집에 「申告敬遠2,319件」「9シーズン」「約85%」「8.0%/1.3%」「トリプルスチール3件」.
 * 셋 다 **타입도 린트도 못 잡는다** — 문법은 완벽하고 문장만 거짓이기 때문이다.
 * 그리고 셋 다 **사람이 손으로 고치기 전까지 조용히 틀린 채로 배포된다**(M7 이 막으려는 모양).
 *
 * ⑶ 은 실제로 배포 직전에 이미 거짓이었다: 소스가 `申告敬遠2,319件` 이라고 썼는데
 * **CI DB(08-19)는 2,325건**이었다(로컬 08-16 스냅샷에서만 2,319).
 *
 * ## 이 시험이 요구하는 것
 *
 * 화면에 수를 적으려면 **셋 중 하나**여야 한다.
 *   ① **DB 에서 읽는다** — `leagueStealTotals` 방식. 사람이 안 고쳐도 늘 참이다(가장 좋다)
 *   ② **완결 시즌만 인용한다** — 그 수는 안 바뀐다. **범위를 문장 안에 적고 시험으로 고정**한다
 *   ③ **수를 빼고 성질만 말한다** — 정확한 수가 뜻을 나르지 않는 자리라면 이게 정직하다
 * ②·③ 로 남긴 수는 **여기 허용목록에 이유와 함께 적는다.** 이유를 적게 만드는 것이 이 시험의 본체다.
 *
 * ⚠**주석은 대상이 아니다** — 사람이 읽는 기록이고, 낡아도 화면이 거짓말하지 않는다.
 * 그래서 소스를 정규식으로 훑지 않고 **문자열 리터럴만 뽑아** 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { seasonDraws } from "@bb-app/aggregate";
import { GLOSSARY } from "../src/glossary.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "src");
/** ⚠**화면 문구는 `tools/` 에도 있다** — 실측으로 거기 박힌 수가 안 걸리고 있었다 */
const TOOLS_DIR = join(HERE, "..", "tools");
const DB = join(HERE, "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

// ─── 문자열만 뽑아내기 ────────────────────────────────────────────────────

/**
 * 템플릿 리터럴 안에서 `${…}` 가 열리면 그 안은 **코드**다. 어느 `}` 가 그것을 닫는지
 * 알아야 하므로 중괄호 깊이를 들고 다닌다.
 */
type Frame = { kind: "tpl" } | { kind: "interp"; depth: number };

export interface Literal {
  /** 리터럴의 내용(따옴표 제외). 템플릿은 `${…}` 로 잘린 조각마다 하나 */
  text: string;
  /** 그 조각이 시작한 줄 */
  line: number;
}

/** 정규식 리터럴이 올 수 있는 자리인가 — 바로 앞의 **뜻 있는 글자**로 판정한다 */
function regexCanStart(prev: string): boolean {
  return prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev);
}

/** `/` 에서 시작해 정규식 리터럴을 건너뛴다. ⚠**문자 클래스 안의 `/` 는 끝이 아니다** */
function skipRegex(src: string, from: number): number {
  let i = from + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return from + 1; // 줄을 넘는 정규식은 없다 — 나눗셈이었다
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) { i += 1; break; }
    i += 1;
  }
  while (i < src.length && /[a-z]/.test(src[i]!)) i += 1; // 플래그
  return i;
}

/**
 * TypeScript 소스에서 **문자열 리터럴의 내용만** 뽑는다.
 *
 * ⚠**주석·정규식은 버리고, 템플릿 보간식은 코드로 되돌아가 계속 읽는다** —
 * `${cond ? "文字" : ""}` 안쪽 문자열도 화면에 나가는 글자이기 때문이다.
 * ⚠**정확성을 눈으로 믿지 않는다** — 아래에 고정 입력으로 이 함수 자체를 시험한다(작업규칙 9).
 */
export function stringLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  const stack: Frame[] = [];
  let mode: "code" | "tpl" = "code";
  let i = 0;
  let line = 1;
  let prev = "";
  let chunk = "";
  let chunkLine = 1;
  const emit = (): void => { out.push({ text: chunk, line: chunkLine }); chunk = ""; };

  while (i < src.length) {
    if (mode === "tpl") {
      const c = src[i]!;
      if (c === "\\") { chunk += src[i + 1] ?? ""; if (src[i + 1] === "\n") line += 1; i += 2; continue; }
      if (c === "`") { emit(); stack.pop(); mode = "code"; prev = "`"; i += 1; continue; }
      if (c === "$" && src[i + 1] === "{") {
        emit();
        stack.push({ kind: "interp", depth: 0 });
        mode = "code"; prev = "{"; i += 2; continue;
      }
      if (c === "\n") line += 1;
      chunk += c; i += 1; continue;
    }

    const c = src[i]!;
    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }

    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line += 1; i += 1; }
      i += 2; continue;
    }
    if (c === "/" && regexCanStart(prev)) { i = skipRegex(src, i); prev = "/"; continue; }

    if (c === '"' || c === "'") {
      const quote = c;
      chunkLine = line;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { chunk += src[i + 1] ?? ""; i += 2; continue; }
        chunk += src[i]!; i += 1;
      }
      i += 1;
      emit(); prev = quote; continue;
    }
    if (c === "`") { stack.push({ kind: "tpl" }); mode = "tpl"; chunkLine = line; i += 1; continue; }

    const top = stack[stack.length - 1];
    if (c === "{" && top?.kind === "interp") top.depth += 1;
    else if (c === "}" && top?.kind === "interp") {
      if (top.depth === 0) { stack.pop(); mode = "tpl"; chunkLine = line; i += 1; prev = "}"; continue; }
      top.depth -= 1;
    }
    prev = c; i += 1;
  }
  return out;
}

// ─── 무엇을 「실측치처럼 생긴 수」로 볼 것인가 ──────────────────────────────

/**
 * ⚠**규칙은 좁게 짠다.** 화면 문구에는 임계값(`100打席以上`)·정의(`2ストライク`)·
 * 기준선(`.320 前後`)처럼 **바뀌지 않는 수**가 많다. 그것까지 잡으면 허용목록이 부풀고,
 * 부푼 허용목록은 아무도 안 읽는다 — 그러면 이 시험은 있으나 마나가 된다.
 *
 * 아래 넷은 **「세어서 나온 수」에만** 붙는 모양이다.
 */
const RULES: readonly { name: string; re: RegExp; why: string }[] = [
  { name: "천단위", re: /\d{1,3},\d{3}/g, why: "세 자리 구분이 붙는 큰 수는 집계 결과다" },
  { name: "시즌수", re: /(?:[2-9]|\d{2,})シーズン/g, why: "보유 시즌이 늘면 거짓이 된다 — 범위를 값에서 만들어라" },
  { name: "퍼센트", re: /\d+(?:\.\d+)?%/g, why: "비율을 글자로 적으면 다음 수집에서 낡는다" },
  /**
   * ⚠**`試合` 을 일부러 넣지 않았다.** 화면의 경기 수는 집계값보다 **규칙**인 쪽이 많고
   * (`直近10試合` · `2020년은 120試合制`), 넣으면 허용목록이 잡음으로 부푼다.
   * 부푼 허용목록은 아무도 안 읽어서 시험이 있으나 마나가 된다.
   * 정말 센 경기 수는 대개 네 자리라 「천단위」가 잡는다.
   */
  { name: "집계수", re: /(?<![\d,])\d{2,}(?:人|名|件)/g, why: "인원·건수는 세어서 나온 수다" },
  /**
   * ⚠**이 규칙이 없으면 실제로 있던 결함 하나를 놓친다** — `盗塁611・盗塁刺254` 처럼
   * **단위가 안 붙은 맨 수**다(2026-08-20 에 찾아낸 여섯 자리 중 하나이고,
   * 그 문장은 진행 중 시즌의 수라 매일 낡았다).
   *
   * 맨 수를 전부 잡으면 잡음이 감당이 안 된다(`2026年`·`直近10`·`3分の1` 이 전부 걸린다).
   * 그래서 **일본어 수사의 모양**으로 좁힌다: 한자 명사에 **바로 붙은 세 자리 이상 수**는
   * 「그 항목이 몇이었다」는 집계 진술이다. 뒤에 단위(`年`·`回`·`球`·`人`…)가 붙으면 뺀다 —
   * 그건 기준일이거나 규칙이고, 세는 쪽은 위 규칙들이 이미 본다.
   *
   * 실측(2026-08-20 · 고친 뒤 소스 전량): 잡음 **1건**(`リーグ平均100` · wRC+ 의 정의)뿐이다.
   */
  {
    name: "붙은수",
    re: /[一-鿿]{2,}\d{3,}(?![年月日時分回球人名件試])/g,
    why: "한자 항목명에 바로 붙은 세 자리 수는 「그 항목이 몇이었다」는 집계 진술이다",
  },
];

/** 화면에 나가는 글자인가 — **일본어가 들어 있는 문자열만** 본다(CSS 값·식별자 제외) */
function isProse(s: string): boolean {
  return /[぀-ヿ一-鿿]/.test(s);
}

interface Hit { file: string; rule: string; match: string; line: number; at: number; text: string }

/**
 * ⚠**`assets.ts` 는 통째로 템플릿 리터럴이다** — 그 안이 CSS 와 클라이언트 JS 이고,
 * 그 JS 안의 `/* … *\/` 는 **문자열의 일부**라 이 렉서로는 주석과 문구를 가를 수 없다.
 * 그래서 대상에서 뺀다. 그 파일은 `assets-source.test.ts` 와 `template-literals.test.ts` 가 따로 본다.
 * ⚠**여기가 이 시험의 사각지대다** — 클라이언트 문구에 수를 박으면 안 걸린다.
 */
const SKIP = new Set(["assets.ts"]);

/**
 * 검사할 `.ts` 를 모은다. ⚠**재귀다**(2026-08-24 · 감사 P3 #58).
 *
 * ⚠**전에는 `packages/web/src` 한 겹만 읽었다** — `tools/` 와 다른 패키지가 통째로 검사 밖이었고,
 * 실제로 `web/tools/marks.ts` 의 화면 문구에 박힌 수가 **안 걸리고 있었다.**
 * **자기 주장만큼 안 덮는 가드**는 「장치가 있다」는 착각만 남긴다.
 */
function tsFilesUnder(dir: string, out: { path: string; label: string }[] = [], base = dir): { path: string; label: string }[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFilesUnder(p, out, base);
    else if (e.name.endsWith(".ts")) out.push({ path: p, label: p.slice(base.length + 1).split(sep).join("/") });
  }
  return out;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  const files = [...tsFilesUnder(SRC_DIR), ...tsFilesUnder(TOOLS_DIR)].sort((x, y) => (x.label < y.label ? -1 : 1));
  assert.ok(files.length > 20, `소스가 ${files.length}개뿐이다 — 이 시험이 공회전한다`);
  for (const { path: full, label: file } of files) {
    if (SKIP.has(file)) continue;
    const src = readFileSync(full, "utf8");
    for (const lit of stringLiterals(src)) {
      if (!isProse(lit.text)) continue;
      /**
       * ⚠**같은 자리를 두 규칙이 잡으면 한 번만 센다**(`102試合` 은 「집계수」와 「주장수」에
       * 동시에 걸린다). 규칙 순서가 곧 우선순위라 **더 구체적인 이름이 남는다** —
       * 허용목록에 같은 수가 두 줄로 늘어나는 것을 막는다.
       */
      const taken = new Set<number>();
      for (const rule of RULES) {
        for (const m of lit.text.matchAll(rule.re)) {
          if (taken.has(m.index)) continue;
          taken.add(m.index);
          hits.push({ file, rule: rule.name, match: m[0], line: lit.line, at: m.index, text: lit.text });
        }
      }
    }
  }
  return hits;
}

// ─── 허용목록 ────────────────────────────────────────────────────────────

/**
 * ⚠**이유 없이 여기 넣지 마라.** 「지금 맞으니까」는 이유가 아니다 —
 * 위 세 사고가 전부 「넣을 때는 맞았다」였다. 적어야 하는 것은
 * **「경기가 더 들어와도 왜 이 문장이 참으로 남는가」**다.
 */
const ALLOWED: readonly { file: string; match: string; why: string }[] = [
  {
    file: "grade.ts",
    match: "157人",
    why: "색 임계값은 2026-08-15 에 뽑아 **의도적으로 고정**한 산출물이다(매일 다시 뽑으면 성적이 " +
      "그대로인데 색이 바뀐다 — grade.ts 표제부). 그래서 고칠 것은 수가 아니라 문장이고, " +
      "**기준일을 문자열에 적어** 현재형 진술이 아니게 만들었다. 임계값을 다시 뽑을 때 같이 고친다",
  },
  {
    file: "grade.ts",
    match: "85人",
    why: "위와 같다 — 선발 기준 모집단. 기준일이 문장 안에 있다",
  },
  {
    file: "grade.ts",
    match: "90人",
    why: "위와 같다 — 구원 기준 모집단. 기준일이 문장 안에 있다",
  },
  {
    file: "player-page.ts",
    match: "1,777",
    why: "**완결 시즌 2023〜2025 에 대한 과거 대조 결과**이고 그 범위가 문장 안에 있다. " +
      "그 시즌의 경기는 늘지 않으므로 이 수는 자라지 않는다(선택 ②)",
  },
  {
    file: "player-page.ts",
    match: "569件",
    why: "위와 같은 문장의 짝. 「試合数だけ569件ずれました」 — 범위가 명시된 과거 대조 결과다",
  },
  {
    file: "glossary.ts",
    match: "平均100",
    why: "**wRC+ 의 정의**다(「리그 평균을 100 으로 두고 지수화한다」). 세어서 나온 수가 아니라 " +
      "눈금을 정하는 상수라 경기가 늘어도 바뀌지 않는다 — 바뀐다면 그건 지표를 바꾼 것이다",
  },
];

test("⚠화면 문자열에 실측 수치가 박혀 있지 않다 — 박으려면 이유를 적어라", () => {
  const hits = scan();
  const allowed = new Set(ALLOWED.map((a) => `${a.file}|${a.match}`));
  const unknown = hits.filter((h) => !allowed.has(`${h.file}|${h.match}`));
  assert.deepEqual(
    unknown.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.match} — ${h.text.slice(0, 60)}`),
    [],
    "화면에 나가는 문자열에 세어서 나온 수가 박혀 있다. 셋 중 하나를 골라라 — " +
      "① DB 에서 읽는다(leagueStealTotals 방식) · ② 완결 시즌만 인용하고 범위를 문장에 적는다 · " +
      "③ 수를 빼고 성질만 말한다. ②·③ 로 남기면 ALLOWED 에 **왜 참으로 남는가**를 적어라",
  );
});

test("⚠허용목록에 죽은 항목이 없다 — 문장이 바뀌면 이유도 다시 봐야 한다", () => {
  const hits = scan();
  const seen = new Set(hits.map((h) => `${h.file}|${h.match}`));
  const dead = ALLOWED.filter((a) => !seen.has(`${a.file}|${a.match}`)).map((a) => `${a.file}|${a.match}`);
  assert.deepEqual(dead, [], "허용목록에 있는데 소스에 없다 — 지워라(남겨 두면 다음 사람이 이유를 믿는다)");
});

test("⚠허용목록의 모든 항목에 이유가 적혀 있다 — 이유를 적게 만드는 것이 이 시험의 본체다", () => {
  for (const a of ALLOWED) {
    assert.ok(a.why.length >= 30, `${a.file}|${a.match}: 이유가 너무 짧다 — ${a.why}`);
  }
});

// ─── 렉서 자체의 시험 ────────────────────────────────────────────────────

/**
 * ⚠**렉서가 조용히 망가지면 위 세 시험이 전부 「0건」으로 통과한다** — 작업규칙 8 이 경고하는 모양이다.
 * 그래서 **고정 입력**으로 함수 자체를 못 박는다. 여기 넣은 것은 전부 실제 소스에 있는 모양이다:
 * 따옴표를 품은 정규식(`html.ts`) · 중첩 보간(`player-page.ts`) · `//` 를 품은 문자열(`assets.ts`).
 */
test("⚠문자열 추출기가 주석·정규식·보간식을 가른다 — 여기가 무너지면 위 시험이 공회전한다", () => {
  const NL = String.fromCharCode(10);
  const src = [
    '/** 주석 안의 "9シーズン" 은 대상이 아니다 */',
    'const a = "打率9シーズン";',
    '// 줄 주석의 "1,234件"',
    'const b = s.replace(/[&<>"\']/g, "置換");',
    'const c = `外${cond ? "内" : ""}後`;',
    'const d = "http://例/x";',
    "const e = 10 / 2;",
  ].join(NL);
  const got = stringLiterals(src).map((l) => l.text);
  assert.deepEqual(
    got,
    ["打率9シーズン", "置換", "外", "内", "", "後", "http://例/x"],
    "추출기가 주석·정규식·보간식 중 하나를 잘못 다룬다",
  );
  // 줄 번호도 맞아야 실패 메시지가 쓸모 있다
  assert.equal(stringLiterals(src)[0]!.line, 2);
});

test("⚠실제 소스에서도 문자열이 나온다 — 파일을 통째로 못 읽으면 공회전이다", () => {
  const lits = stringLiterals(readFileSync(join(SRC_DIR, "glossary.ts"), "utf8"));
  const prose = lits.filter((l) => isProse(l.text));
  assert.ok(prose.length > 100, `용어집에서 일본어 문자열을 ${prose.length}개밖에 못 읽었다`);
  // ⚠**파일 끝까지 읽었는가** — 마지막 용어의 문장이 나와야 한다
  assert.ok(
    prose.some((l) => l.text.includes("打者のOPSと同じ色で読まないでください")),
    "파일 끝의 문장을 못 읽었다 — 도중에 어긋났다",
  );
});

// ─── 남긴 수는 DB 로 다시 센다 ────────────────────────────────────────────

/**
 * `drawRate` 의 caveat 은 **선택 ②**다 — 완결 시즌(2021·2022)의 수를 그대로 인용한다.
 * 「102 대 16 의 6배 차이」가 「연장 규정이 거의 다 정한다」는 주장 자체라 수를 뺄 수 없었다.
 *
 * ⚠**기대값을 손으로 적지 않는다.** 화면 문장에서 뽑아 **DB 에서 다시 세어** 맞댄다 —
 * 손으로 적으면 화면과 시험이 같이 낡고, 그건 검사가 아니라 복사다(`draws-dist.test.ts` 선례).
 */
test("⚠용어집이 인용한 引き分け 수가 DB 와 같다 — 완결 시즌이라 바뀌면 그것이 사건이다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const caveat = GLOSSARY["drawRate"]!.caveat ?? "";
  const cited = [...caveat.matchAll(/(\d{4})年は(\d+)試合/g)].map((m) => ({
    season: Number(m[1]),
    draws: Number(m[2]),
  }));
  assert.ok(cited.length >= 2, `caveat 에서 인용한 시즌을 ${cited.length}개밖에 못 읽었다 — 문장이 바뀌었다`);

  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const rows = seasonDraws(db, "regular", "9999-12-31", 0, 9999);
    assert.ok(rows.length >= 8, `시즌이 ${rows.length}개뿐이다 — 이 시험이 공회전한다`);
    for (const c of cited) {
      const row = rows.find((r) => r.season === c.season);
      assert.notEqual(row, undefined, `${c.season}년이 DB 에 없다 — 용어집이 없는 시즌을 인용한다`);
      assert.equal(
        row!.draws,
        c.draws,
        `${c.season}년 引き分け: 용어집 ${c.draws} · DB ${row!.draws} — glossary.ts 의 drawRate 를 고쳐라`,
      );
    }
    // ⚠**주장 자체를 지킨다**: 「연장이 없던 해가 압도적으로 많다」가 뒤집히면 문장이 거짓이 된다
    const [a, b] = cited;
    assert.ok(a!.draws > b!.draws * 3, `${a!.season}년 ${a!.draws} 대 ${b!.season}년 ${b!.draws} — 문장의 주장이 성립하지 않는다`);
  } finally {
    db.close();
  }
});
