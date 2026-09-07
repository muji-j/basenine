/**
 * **서체 부분집합 — 쓰이는 글자를 배포물에서 유도하고, 빠지면 빌드를 멈춘다.**
 *
 * 정본은 `docs/superpowers/specs/2026-09-07-design-direction.md` §5-A · §5-B · §5-C · §5-E · §7-1.
 * 여기는 **그 규칙의 구현**이고 새로 정하는 것이 없다.
 *
 * ## 이 파일이 지키는 것
 *
 * ⚠**「(쓰이는 글자) ⊆ (그 서체의 cmap)」이 아니면 빌드가 실패한다**(§5-C · M7).
 * 빠진 글자를 시스템 폰트로 흘리면 **이름 한가운데서 얼굴이 바뀐다** — 웹폰트가 없는 것보다 나쁘다.
 * 그러므로 여기서 「없으면 건너뛴다」를 절대 쓰지 마라.
 *
 * ⚠**검사 대상은 배포되는 WOFF2 다**(§7-1 P1). 원본만 보면 **부분집합 과정에서 빠지는 것**을 놓친다.
 * `verifyCoverage` 는 원본이 아니라 **산출 버퍼**를 받는다.
 *
 * ⚠**커버리지 단위는 「스택에서 그 글자를 담당하는 폰트」다**(§7-1 P2) —
 * 라틴 폰트에 한자를 요구하지 않는다. `assign` 이 브라우저 규칙(앞에서부터 가진 놈이 이긴다)을 흉내낸다.
 *
 * ⚠**Plex 가 못 덮으면 실패다. 조용히 Noto 로 바꾸지 마라**(§7-1 P2 · M7).
 *
 * ## ⚠ASCII 를 바닥으로 깔아 두는 이유 — 이것이 없으면 파이프라인이 멱등이 아니다(M5)
 *
 * 파일 이름에 **내용 해시**가 들어가고(§7-1 P2 캐시 키), 그 이름은 언젠가 CSS 에 적힌다.
 * 그러면 「dist 를 훑어 글자를 모은다 → 그 글자로 파일을 만든다 → 그 파일 이름이 dist 에 들어간다」가
 * 스스로를 먹는다. 해시는 16진수라 **ASCII 를 항상 넣어 두면 그 되먹임이 집합을 못 바꾼다.**
 * 거기에 더해 `collectUsedChars` 는 **자기 산출 디렉터리를 안 훑는다.** 둘을 합쳐야 고정점이다.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 1. 쓰이는 글자를 모은다
// ---------------------------------------------------------------------------

/**
 * 훑는 확장자.
 *
 * ⚠**`.json` 이 빠지면 검색·비교 화면의 선수 이름이 통째로 빠진다**(§5-C 2 — 「클라이언트가 만드는 글자」).
 * 실측으로 `dist` 의 `.json` 은 153개이고 전부 화면이 그려 내는 데이터다.
 * ⚠**`.js` 도 마찬가지다** — 번들 안의 일본어 문자열은 HTML 본문에 안 나온다.
 */
export const TEXT_EXTENSIONS: readonly string[] = [".html", ".json", ".js", ".css", ".svg", ".txt"];

/** 훑지 않는 것. 배포 설정이지 화면에 그려지는 내용이 아니다 */
const SKIP_NAMES: ReadonlySet<string> = new Set(["_headers", "_redirects", "_routes.json"]);

/**
 * ⚠**우리가 만든 것은 안 훑는다** — 되먹임을 끊는 두 장치 중 하나다(맨 위 M5 설명).
 * `dist` 기준 상대경로가 이걸로 시작하면 건너뛴다.
 */
export const FONT_OUT_DIR = join("assets", "fonts");

/**
 * **글리프가 없는 것들** — 요구 목록에서 뺀다.
 *
 * ⚠**이건 「덮지 못해도 봐준다」가 아니다.** 줄바꿈·탭·제로폭·BOM 은 **애초에 그려지는 글자가 아니라서**
 * 어느 서체의 cmap 에도 없다. 안 빼면 **첫 실행부터 전 서체가 실패**하고, 그러면 사람이
 * 검사를 끄는 쪽으로 간다 — 그게 이 검사를 죽이는 길이다.
 * ⚠**여기에 「이 한자는 봐준다」류를 절대 더하지 마라.** 그 순간 §5-C 가 무의미해진다.
 */
export function isNonGlyph(cp: number): boolean {
  if (cp < 0x20) return true; // C0 — 줄바꿈·탭 포함
  if (cp === 0x7f) return true; // DEL
  if (cp >= 0x80 && cp <= 0x9f) return true; // C1
  if (cp >= 0x200b && cp <= 0x200f) return true; // 제로폭·방향
  if (cp === 0x2028 || cp === 0x2029) return true; // 줄·문단 구분
  if (cp >= 0x202a && cp <= 0x202e) return true; // 방향 지정
  if (cp === 0xfeff) return true; // BOM
  return false;
}

const NAMED_ENTITIES: Readonly<Record<string, number>> = {
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  nbsp: 0xa0,
};

/**
 * ⚠**모르는 이름 엔티티는 풀지 않는다** — 억지로 풀면 없는 글자를 만들어 낸다.
 * 안 풀어도 손해가 없다(그 글자들은 전부 ASCII 라 바닥에 이미 있다).
 */
export function entityCodePoint(body: string): number | undefined {
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const cp = Number.parseInt(body.slice(2), 16);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? cp : undefined;
  }
  if (body.startsWith("#")) {
    const cp = Number.parseInt(body.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? cp : undefined;
  }
  return NAMED_ENTITIES[body];
}

const ENTITY_RE = /^&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

/**
 * ⚠**JS 주석은 안 센다 — 그리지 않기 때문이다.**
 *
 * 실측(2026-09-08 · `dist/assets/site.js`): 이 번들은 **줄 주석 5줄**에 한국어를 담고 있고,
 * 그걸 요구 목록에 넣으면 **한글 76자**가 들어와 Plex·Noto 둘 다 못 덮어 **빌드가 붉어진다.**
 * 그런데 그 글자는 **화면에 한 번도 안 나온다.**
 *
 * ⚠**문자열은 절대 지우지 않는다** — 지우면 §5-C 가 막으려는 「덜 센다」가 된다.
 * 그래서 따옴표·역따옴표 상태를 좇는다.
 * ⚠**정규식 리터럴은 안 좇는다.** `/[/*]/` 같은 것이 있으면 어긋나는데, 어긋나면
 * 끝에서 상태가 안 돌아오므로 **던진다**(조용히 삼키지 않는다). 실측으로 이 번들에는 없다.
 * ⚠**떨어져 나간 글자는 부르는 쪽이 받아서 보고한다** — 「조용히 뺐다」가 되지 않게.
 */
export function stripJsComments(src: string): { code: string; comments: string } {
  let code = "";
  let comments = "";
  let i = 0;
  const n = src.length;
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code";
  while (i < n) {
    const c = src[i]!;
    if (state === "code") {
      if (c === "/" && src[i + 1] === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      code += c;
      i += 1;
      continue;
    }
    if (state === "sq" || state === "dq" || state === "tpl") {
      code += c;
      if (c === "\\") {
        if (i + 1 < n) code += src[i + 1]!;
        i += 2;
        continue;
      }
      // ⚠**여는 따옴표는 여기 안 온다** — `code` 상태에서 이미 먹었다. 그러니 이건 닫는 쪽이다
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
        state = "code";
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        code += c;
      } else comments += c;
      i += 1;
      continue;
    }
    // block
    if (c === "*" && src[i + 1] === "/") {
      state = "code";
      i += 2;
      continue;
    }
    comments += c;
    i += 1;
  }
  if (state === "sq" || state === "dq" || state === "tpl" || state === "block") {
    throw new Error(
      `JS 주석 제거가 어긋났다(끝에서 상태가 ${state}) — 이 상태로는 문자열을 지웠을 수 있다. ` +
        "정규식 리터럴이나 새 문법을 의심하라.",
    );
  }
  return { code, comments };
}

export interface Charset {
  /** 코드포인트 집합. ⚠**ASCII 바닥이 이미 들어 있다** */
  readonly chars: ReadonlySet<number>;
  /** 실제로 읽은 파일 수 — ⚠**분모다. 0 이면 「깨끗함」이 아니라 「안 쟀음」이다** */
  readonly filesRead: number;
  /** 확장자별 파일 수 */
  readonly byExtension: Readonly<Record<string, number>>;
  /** ⚠**주석에만 있어서 뺀 글자.** 「조용히 뺐다」가 안 되게 밖으로 낸다 */
  readonly commentOnly: readonly number[];
  /** 읽은 바이트(UTF-16 코드유닛 기준이 아니라 파일 크기) */
  readonly bytesRead: number;
}

/** ASCII 인쇄 가능 영역. **바닥으로 항상 깐다**(맨 위 M5 설명) */
export function asciiFloor(): number[] {
  const out: number[] = [];
  for (let cp = 0x20; cp <= 0x7e; cp += 1) out.push(cp);
  return out;
}

/** 모은 글자를 담는 그릇. BMP 는 비트맵, 그 밖(서러게이트 쌍)은 `Set` 이다 */
export class CharSink {
  /**
   * ⚠**비트맵을 밖에 그대로 내준다.** 훑는 쪽이 바이트마다 `add()` 를 부르면
   * **그 호출 자체가 병목**이 된다 — 아래 `scanBytes` 의 실측표를 봐라.
   */
  readonly bitmap = new Uint8Array(0x10000);
  private readonly astral = new Set<number>();

  add(cp: number): void {
    if (cp < 0x10000) this.bitmap[cp] = 1;
    else this.astral.add(cp);
  }

  /** ⚠**여기서 비로소 「그릴 수 없는 것」을 걸러낸다** — 훑는 도중에 거르면 그만큼 느려진다 */
  toSet(): Set<number> {
    const out = new Set<number>();
    for (let cp = 0; cp < 0x10000; cp += 1) if (this.bitmap[cp] === 1 && !isNonGlyph(cp)) out.add(cp);
    for (const cp of this.astral) if (!isNonGlyph(cp)) out.add(cp);
    return out;
  }
}

/**
 * **바이트를 그대로 훑는다** — 문자열로 풀지 않는다.
 *
 * ⚠**여기가 이 도구에서 가장 비싼 곳이다.** `dist` 는 1.49 GiB 이고 매일 3번 구워진다.
 * 실측(2026-09-08 · 같은 기계 · 같은 `dist` 9,548장 1,486.6 MiB · 결과 글자 수는 넷 다 **1,646자로 같다**):
 *
 * | 어떻게 | 훑는 시간 |
 * |---|---|
 * | `for (const ch of s)` + 전문 정규식 치환 | **122.5초** |
 * | `charCodeAt` 순회(문자열로 디코드) | **58.9초** |
 * | 위 + `Set` 대신 비트맵 | **62.6초**(⚠**느려졌다**) |
 * | 바이트 순회 + `sink.add()` 호출 | **54.5초** |
 * | **바이트 순회 + 비트맵에 직접 쓰기** | **21.3초** |
 *
 * ⚠**「`Set.add` 가 병목이겠지」가 틀렸다** — 비트맵만 넣었을 땐 오히려 느려졌다.
 * 병목은 둘이었다: ⑴**UTF-8 을 문자열로 푸는 것** ⑵**바이트마다 메서드를 부르는 것**.
 * **둘 다 없애야 떨어진다.** ⚠**「빠를 것 같다」로 고르지 말고 재라.**
 * ⚠**남은 21.3초 중 11.5초는 순수 읽기다**(같은 파일 목록을 두 번 읽어 잰 값 · 129 MiB/s) —
 * **여기서 더 짜낼 것은 별로 없다.**
 */
export function scanBytes(buf: Buffer, into: CharSink, entities: boolean): void {
  const n = buf.length;
  const bmp = into.bitmap;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i]!;
    if (b < 0x80) {
      bmp[b] = 1;
      if (entities && b === 0x26 /* & */) {
        // ⚠엔티티 본문은 전부 ASCII 다 — 그래서 바이트만 보고 끝낼 수 있다
        const end = Math.min(n, i + 36);
        for (let j = i + 1; j < end; j += 1) {
          const c = buf[j]!;
          if (c === 0x3b /* ; */) {
            const cp = entityCodePoint(buf.toString("latin1", i + 1, j));
            if (cp !== undefined) into.add(cp);
            break;
          }
          const ok =
            (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x23;
          if (!ok) break;
        }
      }
      continue;
    }
    if (b >= 0xc2 && b <= 0xdf && i + 1 < n) {
      bmp[((b & 0x1f) << 6) | (buf[i + 1]! & 0x3f)] = 1;
      i += 1;
    } else if (b >= 0xe0 && b <= 0xef && i + 2 < n) {
      bmp[((b & 0x0f) << 12) | ((buf[i + 1]! & 0x3f) << 6) | (buf[i + 2]! & 0x3f)] = 1;
      i += 2;
    } else if (b >= 0xf0 && b <= 0xf4 && i + 3 < n) {
      // ⚠4바이트는 BMP 를 넘으므로 **비트맵이 아니라 `Set` 으로** 간다
      into.add(((b & 0x07) << 18) | ((buf[i + 1]! & 0x3f) << 12) | ((buf[i + 2]! & 0x3f) << 6) | (buf[i + 3]! & 0x3f));
      i += 3;
    }
    // ⚠**깨진 바이트는 건너뛴다** — 여기서 던지면 배포물 한 곳의 잡음이 전체를 멈춘다.
    //   손해는 「덜 세는 것」인데, 애초에 UTF-8 이 아닌 바이트는 화면에도 글자로 안 나온다.
  }
}

export function scanChars(text: string, into: CharSink, entities: boolean): void {
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        into.add((c - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000);
        i += 1;
        continue;
      }
    }
    into.add(c);
    if (entities && c === 0x26 /* & */) {
      const m = ENTITY_RE.exec(text.slice(i, i + 36));
      if (m !== null) {
        const cp = entityCodePoint(m[1]!);
        if (cp !== undefined) into.add(cp);
      }
    }
  }
}

/**
 * `dist` 전수를 훑어 쓰이는 글자를 모은다.
 *
 * ⚠**표본이 아니다.** §5-A 의 1,183자는 9,392장 중 627장 표본이었고, 여기는 전수다.
 * ⚠**태그·속성 이름까지 통째로 센다**(마크업의 경우). 「본문만 고르는」 쪽이 정확해 보이지만
 * **덜 세는 방향으로 틀리고**, 덜 센 결과가 정확히 §5-C 가 막으려는 그 결함이다.
 * 더 세서 손해 보는 것은 ASCII 몇 자뿐이고 그건 어차피 바닥으로 깔린다.
 */
export function collectUsedChars(distDir: string): Charset {
  const sink = new CharSink();
  for (const cp of asciiFloor()) sink.add(cp);
  const commentSink = new CharSink();
  const byExtension: Record<string, number> = {};
  let filesRead = 0;
  let bytesRead = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const rel = relative(distDir, full);
      if (rel === FONT_OUT_DIR || rel.startsWith(FONT_OUT_DIR + sep)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      const dot = entry.name.lastIndexOf(".");
      const ext = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) continue;
      const raw = readFileSync(full);
      if (ext === ".js") {
        // ⚠주석을 가르려면 문자열이 필요하다. **번들은 한 장뿐이라**(실측) 비용이 안 든다
        const split = stripJsComments(raw.toString("utf8"));
        scanChars(split.code, sink, false);
        scanChars(split.comments, commentSink, false);
      } else {
        scanBytes(raw, sink, ext === ".html" || ext === ".svg");
      }
      filesRead += 1;
      bytesRead += raw.length;
      byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    }
  };

  const st = statSync(distDir);
  if (!st.isDirectory()) throw new Error(`dist 가 디렉터리가 아니다: ${distDir}`);
  walk(distDir);

  if (filesRead === 0) {
    // ⚠「0건 = 합격」을 만들지 않는다(루트 §1). 훑을 것이 없으면 그건 실패다.
    throw new Error(`${distDir} 에서 훑을 파일이 0개다 — 화면을 먼저 구웠는가?`);
  }
  const chars = sink.toSet();
  const commentOnly = [...commentSink.toSet()].filter((cp) => !chars.has(cp)).sort((a, b) => a - b);
  return { chars, filesRead, byExtension, commentOnly, bytesRead };
}

// ---------------------------------------------------------------------------
// 2. sfnt 를 읽는다 (cmap · 레이아웃 기능)
// ---------------------------------------------------------------------------

interface TableRecord {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

/**
 * ⚠**모르는 형식이면 던진다.** 여기서 빈 집합을 돌려주면 커버리지 검사가
 * 「전부 빠졌다」로 붉어지므로 안전한 방향이긴 하지만, **왜 붉은지 못 읽는다.**
 */
export function tableRecords(sfnt: Buffer): TableRecord[] {
  if (sfnt.length < 12) throw new Error(`sfnt 가 너무 짧다: ${sfnt.length}B`);
  const version = sfnt.readUInt32BE(0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    throw new Error(`sfnt 서명이 아니다: 0x${version.toString(16)} — woff2 를 안 풀었는가?`);
  }
  const numTables = sfnt.readUInt16BE(4);
  const out: TableRecord[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const base = 12 + i * 16;
    out.push({
      tag: sfnt.toString("latin1", base, base + 4),
      offset: sfnt.readUInt32BE(base + 8),
      length: sfnt.readUInt32BE(base + 12),
    });
  }
  return out;
}

/**
 * cmap 이 실제로 그릴 수 있는 코드포인트.
 *
 * ⚠**「글리프 번호가 0 이 아닌 것」만 센다.** 0(`.notdef`)에 매핑된 코드포인트는
 * 그 글자를 **못 그린다**는 뜻이고, 그걸 「덮는다」로 세면 이 검사가 통째로 거짓이 된다.
 */
export function cmapMap(sfnt: Buffer): Map<number, number> {
  const cmap = tableRecords(sfnt).find((t) => t.tag === "cmap");
  if (cmap === undefined) throw new Error("cmap 테이블이 없다");
  const base = cmap.offset;
  const numSubtables = sfnt.readUInt16BE(base + 2);

  // (3,10) UCS-4 → (3,1) BMP → (0,*) 순으로 고른다. 앞이 더 넓다
  let best: { rank: number; offset: number } | undefined;
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = base + 4 + i * 8;
    const platform = sfnt.readUInt16BE(rec);
    const encoding = sfnt.readUInt16BE(rec + 2);
    const offset = base + sfnt.readUInt32BE(rec + 4);
    const rank =
      platform === 3 && encoding === 10 ? 0 : platform === 3 && encoding === 1 ? 1 : platform === 0 ? 2 : 3;
    if (best === undefined || rank < best.rank) best = { rank, offset };
  }
  if (best === undefined) throw new Error("cmap 서브테이블이 0개다");

  const out = new Map<number, number>();
  const off = best.offset;
  const format = sfnt.readUInt16BE(off);
  if (format === 4) {
    const segCount = sfnt.readUInt16BE(off + 6) / 2;
    const endBase = off + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let s = 0; s < segCount; s += 1) {
      const end = sfnt.readUInt16BE(endBase + s * 2);
      const start = sfnt.readUInt16BE(startBase + s * 2);
      if (start > end) continue;
      const delta = sfnt.readInt16BE(deltaBase + s * 2);
      const rangeOffset = sfnt.readUInt16BE(rangeBase + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= sfnt.length) continue;
          const raw = sfnt.readUInt16BE(gi);
          gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (gid !== 0) out.set(c, gid);
      }
    }
  } else if (format === 12) {
    const numGroups = sfnt.readUInt32BE(off + 12);
    for (let g = 0; g < numGroups; g += 1) {
      const rec = off + 16 + g * 12;
      const start = sfnt.readUInt32BE(rec);
      const end = sfnt.readUInt32BE(rec + 4);
      const startGid = sfnt.readUInt32BE(rec + 8);
      for (let c = start; c <= end; c += 1) {
        const gid = startGid + (c - start);
        if (gid !== 0) out.set(c, gid);
      }
    }
  } else if (format === 6) {
    const first = sfnt.readUInt16BE(off + 6);
    const count = sfnt.readUInt16BE(off + 8);
    for (let i = 0; i < count; i += 1) {
      const gid = sfnt.readUInt16BE(off + 10 + i * 2);
      if (gid !== 0) out.set(first + i, gid);
    }
  } else {
    throw new Error(`cmap format ${format} 은 안 읽는다 — 읽는 법을 추가하고 나서 써라`);
  }

  if (out.size === 0) throw new Error("cmap 을 읽었는데 코드포인트가 0개다 — 읽는 방식이 헛돌고 있다");
  return out;
}

/** 그릴 수 있는 코드포인트만. ⚠**`.notdef`(0) 로 가는 것은 「덮는다」가 아니다** */
export function cmapCodePoints(sfnt: Buffer): Set<number> {
  return new Set(cmapMap(sfnt).keys());
}

/**
 * **숫자 0~9 의 진폭(advance)** — §5-A 착수 전 확인 3 이 요구한 실측이다.
 *
 * ⚠**`font-variant-numeric: tabular-nums` 는 `tnum` 기능이 있어야 도는데,
 * 그 기능이 없어도 기본 숫자가 이미 등폭이면 표는 안 흔들린다.** 둘은 다른 질문이고
 * **답해야 하는 것은 뒤쪽**이다 — 그러니 기능 목록만 보고 판정하지 마라.
 *
 * @returns 코드포인트별 진폭(폰트 단위) · `unitsPerEm`
 */
export function digitAdvances(sfnt: Buffer): { advances: Map<number, number>; unitsPerEm: number } {
  const rec = (tag: string): TableRecord => {
    const t = tableRecords(sfnt).find((x) => x.tag === tag);
    if (t === undefined) throw new Error(`${tag} 테이블이 없다`);
    return t;
  };
  const unitsPerEm = sfnt.readUInt16BE(rec("head").offset + 18);
  const numberOfHMetrics = sfnt.readUInt16BE(rec("hhea").offset + 34);
  const hmtx = rec("hmtx").offset;
  const cmap = cmapMap(sfnt);
  const advances = new Map<number, number>();
  for (let d = 0x30; d <= 0x39; d += 1) {
    const gid = cmap.get(d);
    if (gid === undefined) continue;
    // ⚠**`numberOfHMetrics` 를 넘는 글리프는 마지막 진폭을 나눠 쓴다**(스펙) — 안 그러면 범위 밖을 읽는다
    const i = Math.min(gid, numberOfHMetrics - 1);
    advances.set(d, sfnt.readUInt16BE(hmtx + i * 4));
  }
  return { advances, unitsPerEm };
}

/**
 * GSUB·GPOS 의 FeatureList 에 있는 기능 태그.
 *
 * ⚠**`palt` 가 살아 있는지 보려고 있다**(§5-A 착수 전 확인 2 — 화면이 `font-feature-settings:"palt" 1` 를 이미 켠다).
 * `tnum`(자릿수 고정)도 여기서 본다 — §5-A 3 이 등폭 코드 서체를 버리기로 했으므로 이게 없으면 표가 흔들린다.
 */
export function layoutFeatures(sfnt: Buffer): Set<string> {
  const out = new Set<string>();
  for (const tag of ["GSUB", "GPOS"] as const) {
    const rec = tableRecords(sfnt).find((t) => t.tag === tag);
    if (rec === undefined) continue;
    const featureListOffset = rec.offset + sfnt.readUInt16BE(rec.offset + 6);
    const featureCount = sfnt.readUInt16BE(featureListOffset);
    for (let i = 0; i < featureCount; i += 1) {
      out.add(sfnt.toString("latin1", featureListOffset + 2 + i * 6, featureListOffset + 6 + i * 6));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 스택 — 어느 글자를 어느 서체가 맡는가
// ---------------------------------------------------------------------------

export interface FamilySource {
  /** 산출 파일 이름의 앞부분이자 매니페스트의 키 */
  readonly key: string;
  /** `@font-face` 가 쓸 이름. ⚠**여기서 정하지 않는다 — CSS 배선이 이 값을 읽어 쓴다** */
  readonly cssFamily: string;
  /** 웨이트 → 원본 파일(저장소 루트 기준 상대경로) */
  readonly weights: Readonly<Record<number, string>>;
  /**
   * ⚠**벤더링한 파일의 sha256** — npm 이 아니라 저장소에 있는 것만 갖는다.
   * npm 쪽은 락파일의 `integrity` 가 같은 일을 하므로 `null` 이다(**「안 쟀음」이 아니다**).
   */
  readonly sha256: Readonly<Record<number, string>> | null;
  /** OFL 사본 원본 경로 */
  readonly licenseFrom: string;
  /** 배포물에 놓을 OFL 사본 이름 */
  readonly licenseAs: string;
  /** ⚠OFL 의 Reserved Font Name. **없으면 `null` 이라고 적는다** — 「안 봤음」과 구별해야 한다 */
  readonly reservedFontName: string | null;
}

export interface Stack {
  readonly key: string;
  readonly label: string;
  /**
   * ⚠**앞이 이긴다** — 브라우저의 글꼴 스택 규칙 그대로다.
   * 라틴이 앞이므로 라틴 글자는 라틴 서체가 맡고, 한자는 뒤의 일본어 서체가 맡는다.
   */
  readonly order: readonly FamilySource[];
}

/**
 * 우리가 내보내는 웨이트.
 *
 * ⚠**토큰이 셋뿐이다**(`--w-reg:400 --w-semi:600 --w-bold:700` · `assets.ts` 실측).
 * CSS 에 `font-weight:500`(표 머리)과 `800`(순위 1위)이 각 1곳 있는데, 웨이트 매칭 규칙상
 * **500 → 400 · 800 → 700** 로 붙는다. **합성 굵게가 아니라 실제 페이스 선택**이다.
 * ⚠**늘리면 값이 붙는다**: Plex JP 는 저장소가 **2.3 MB/웨이트** 늘고(벤더링이라)
 * 굽는 시간도 그만큼 는다. **재 보고 정해라.**
 */
export const WEIGHTS: readonly number[] = [400, 600, 700];

/**
 * 저장소 루트. ⚠**cwd 에 기대지 않는다** — 시험과 빌드가 다른 데서 돌아도 같은 파일을 봐야 한다.
 */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 저장소 루트 기준 경로를 실제 경로로 */
export function fromRoot(rel: string): string {
  return join(REPO_ROOT, rel);
}

/**
 * ⚠**IBM Plex 만 저장소에 있고 Noto 는 npm 이다. 층이 다르니 통일하지 마라.**
 *
 * Plex 는 `@ibm/plex-sans{,-jp}` 가 **`postinstall: ibmtelemetry` 를 달아서** 못 쓴다 —
 * 그 스크립트는 `contents: write` 와 배포 토큰이 도는 잡에서 실행되고,
 * `scripts/test/install-scripts.test.ts` 가 「**무엇을 놓는지** 적어라」를 요구한다.
 * 텔레메트리는 아무것도 안 놓는다. 사유가 성립하지 않으므로 **파일만 가져왔다**
 * (출처·해시·대안 비교는 `vendor/fonts/ibm-plex/README.md`).
 *
 * Noto(`@expo-google-fonts/*`)는 **설치 스크립트가 0개**라 npm 으로 고정한다 —
 * 저장소 바이트를 안 쓰는 쪽이 낫다.
 */
export function stacks(): Stack[] {
  const V = "vendor/fonts/ibm-plex";
  const plexWeights = (prefix: string): Record<number, string> => ({
    400: `${V}/${prefix}-Regular.woff2`,
    600: `${V}/${prefix}-SemiBold.woff2`,
    700: `${V}/${prefix}-Bold.woff2`,
  });
  const notoWeights = (pkg: string, prefix: string): Record<number, string> => ({
    400: `node_modules/@expo-google-fonts/${pkg}/400Regular/${prefix}_400Regular.ttf`,
    600: `node_modules/@expo-google-fonts/${pkg}/600SemiBold/${prefix}_600SemiBold.ttf`,
    700: `node_modules/@expo-google-fonts/${pkg}/700Bold/${prefix}_700Bold.ttf`,
  });

  return [
    {
      key: "plex",
      label: "IBM Plex",
      order: [
        {
          key: "plex-latin",
          cssFamily: "IBM Plex Sans",
          weights: plexWeights("IBMPlexSans"),
          sha256: {
            400: "ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a",
            600: "f78048030eab62e860efa39a0df79e2e5581bf122eb95b9bc42c0b8a4988d205",
            700: "fa7130d854a660b39a7fc9e6e0f2dc23dba5f1346e2adea3e1fe37b6d884133d",
          },
          licenseFrom: `${V}/OFL.txt`,
          licenseAs: "OFL-IBM-Plex.txt",
          reservedFontName: "Plex",
        },
        {
          key: "plex-jp",
          cssFamily: "IBM Plex Sans JP",
          weights: plexWeights("IBMPlexSansJP"),
          sha256: {
            400: "ec27e9b75cd90a6f7abe96ede49d00b151eb5b1c2c886bfe9b4fc845f40be1ff",
            600: "88c41ab69fd76c6211b47332d855d58ed20359b01b24e8bd2697c2c87e181f2c",
            700: "38336fbb169ae1b7b6ca2539332e1d59c9be222227659d23f8eb70ecda60337d",
          },
          licenseFrom: `${V}/OFL.txt`,
          licenseAs: "OFL-IBM-Plex.txt",
          reservedFontName: "Plex",
        },
      ],
    },
    {
      key: "noto",
      label: "Noto Sans JP",
      order: [
        {
          key: "noto-latin",
          cssFamily: "Noto Sans",
          weights: notoWeights("noto-sans", "NotoSans"),
          sha256: null,
          licenseFrom: "node_modules/@expo-google-fonts/noto-sans/LICENSE_FONT",
          licenseAs: "OFL-Noto-Sans.txt",
          reservedFontName: null,
        },
        {
          key: "noto-jp",
          cssFamily: "Noto Sans JP",
          weights: notoWeights("noto-sans-jp", "NotoSansJP"),
          sha256: null,
          licenseFrom: "node_modules/@expo-google-fonts/noto-sans-jp/LICENSE_FONT",
          licenseAs: "OFL-Noto-Sans-JP.txt",
          // ⚠Noto Sans JP 의 OFL 은 Adobe Source Han 계열이라 **예약명이 `Source` 다** — `Noto` 가 아니다
          reservedFontName: "Source",
        },
      ],
    },
  ];
}

export interface Assignment {
  /** 서체 키 → 그 서체가 맡은 코드포인트 */
  readonly perFamily: ReadonlyMap<string, Set<number>>;
  /** ⚠**스택 안 어느 서체도 못 덮는 글자.** 비어 있지 않으면 빌드가 실패한다 */
  readonly missing: number[];
}

/**
 * 브라우저 규칙대로 글자를 나눈다 — **앞에서부터, 가진 놈이 맡는다.**
 *
 * ⚠**라틴 폰트에 한자를 요구하지 않는다**(§7-1 P2). 그 요구가 「Plex 는 못 쓴다」는
 * 거짓 결론을 만든다.
 */
export function assign(chars: ReadonlySet<number>, stack: Stack, cmaps: ReadonlyMap<string, ReadonlySet<number>>): Assignment {
  const perFamily = new Map<string, Set<number>>();
  for (const fam of stack.order) perFamily.set(fam.key, new Set<number>());
  const missing: number[] = [];

  for (const cp of [...chars].sort((a, b) => a - b)) {
    let placed = false;
    for (const fam of stack.order) {
      const cmap = cmaps.get(fam.key);
      if (cmap === undefined) throw new Error(`${fam.key} 의 cmap 을 안 읽었다 — 이 검사가 공회전한다`);
      if (cmap.has(cp)) {
        perFamily.get(fam.key)!.add(cp);
        placed = true;
        break;
      }
    }
    if (!placed) missing.push(cp);
  }
  return { perFamily, missing };
}

/**
 * **산출물이 실제로 그 글자를 갖는가.**
 *
 * ⚠**원본이 아니라 배포되는 파일을 받는다**(§7-1 P1). 원본에는 있는데 부분집합에서
 * 빠지는 일이 실재하고, 그게 이 검사의 존재 이유다.
 */
export function verifyCoverage(producedSfnt: Buffer, required: ReadonlySet<number>): number[] {
  const have = cmapCodePoints(producedSfnt);
  return [...required].filter((cp) => !have.has(cp)).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 4. 이름 · 보고 형식
// ---------------------------------------------------------------------------

/**
 * 파일 이름에 **내용 해시**를 넣는다(§7-1 P2).
 *
 * ⚠**이 저장소는 캐시 불일치로 실제 사고를 겪었다**(CLAUDE.md §6 · 2026-08-30).
 * 부분집합이 바뀌면 URL 이 바뀌어야 새 HTML 이 옛 폰트를 물지 않는다.
 */
export function hashedName(familyKey: string, weight: number, bytes: Buffer): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  return `${familyKey}-${weight}.${hash}.woff2`;
}

/** 사람이 읽을 수 있게. ⚠**빠진 글자는 전부 출력한다**(§5-C 3) — 「일부」로 줄이지 마라 */
export function describeChars(cps: readonly number[]): string {
  return cps
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(String.fromCodePoint(cp))}`)
    .join("\n  ");
}

/** 글자를 갈래로 나눠 센다 — 보고용. §5-A 의 표와 같은 축이다 */
export function breakdown(chars: ReadonlySet<number>): Record<string, number> {
  let ascii = 0;
  let hira = 0;
  let kata = 0;
  let kanji = 0;
  let other = 0;
  for (const cp of chars) {
    if (cp <= 0x7f) ascii += 1;
    else if (cp >= 0x3040 && cp <= 0x309f) hira += 1;
    else if ((cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) kata += 1;
    else if (
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x20000 && cp <= 0x2fa1f)
    )
      kanji += 1;
    else other += 1;
  }
  return { ASCII: ascii, "ひらがな": hira, "カタカナ": kata, "漢字": kanji, "記号など": other };
}
