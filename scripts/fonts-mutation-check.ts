#!/usr/bin/env node
/**
 * **서체 시험이 「고치기 전 코드」에서 실제로 떨어지는가**(작업규칙 9 · 설계 §5-C 4).
 *
 * 쓰는 법:  node scripts/fonts-mutation-check.ts
 *
 * ⚠**§5-C 가 요구한 것은 검사이지 위험 표시가 아니고, 검사는 「한 글자를 빼면 붉어지는가」로만
 * 증명된다.** 그래서 여기서 재현하는 사고는 전부 **이 파이프라인이 실제로 낼 수 있는 침묵 실패**다:
 * 커버리지를 안 보는 것 · 주석을 지우다 문자열까지 지우는 것 · 자기 산출물을 훑어 고정점을 깨는 것 ·
 * 라틴 폰트에 한자를 요구하는 것 · 해시를 이름에 안 넣는 것.
 *
 * ⚠**문법 오류를 넣는 것은 뮤테이션이 아니다** — 그건 타입체커가 잡는다.
 * 묻는 것은 **문법이 완벽하고 사실만 틀린 상태**다.
 *
 * ⚠**DB 도 `dist` 도 필요 없다** — 이 시험들은 임시 디렉터리와 벤더링한 원본만 쓴다.
 */
import { fileURLToPath } from "node:url";
import { runMutations } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}scripts/fonts.ts`;
const TESTS = [`${ROOT}scripts/test/fonts.test.ts`];

const MUTATIONS: readonly Mutation[] = [
  {
    what: "① 커버리지 검사가 늘 통과한다 — 부분집합에서 글자가 빠져도 초록",
    from: `  const have = cmapCodePoints(producedSfnt);
  return [...required].filter((cp) => !have.has(cp)).sort((a, b) => a - b);`,
    to: `  cmapCodePoints(producedSfnt);
  return [];`,
  },
  {
    what: "② cmap 이 `.notdef`(글리프 0)로 가는 코드포인트도 「덮는다」로 센다 — 못 그리는 글자를 통과시킨다",
    from: `        if (gid !== 0) out.set(c, gid);
      }
    }
  } else if (format === 12) {`,
    to: `        out.set(c, gid);
      }
    }
  } else if (format === 12) {`,
  },
  {
    what: "②′ 같은 사고를 format 12 쪽에서 — CJK 서체가 실제로 쓰는 형식이다",
    from: `        const gid = startGid + (c - start);
        if (gid !== 0) out.set(c, gid);`,
    to: `        const gid = startGid + (c - start);
        out.set(c, gid);`,
  },
  {
    what: "③ JS 주석을 지우면서 문자열까지 지운다 — 화면에 나오는 글자를 안 세게 된다",
    from: `      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "\`") state = "tpl";`,
    to: `      if (c === "'") state = "line";
      else if (c === '"') state = "line";
      else if (c === "\`") state = "line";`,
  },
  {
    what: "④ 주석의 글자를 그냥 요구 목록에 넣는다 — 한글 76자가 들어와 전 서체가 실패한다",
    from: `        scanChars(split.comments, commentSink, false);`,
    to: `        scanChars(split.comments, sink, false);`,
  },
  {
    what: "⑤ 자기 산출 디렉터리를 훑는다 — 해시 이름이 스스로를 먹어 고정점이 깨진다(M5)",
    from: `      if (rel === FONT_OUT_DIR || rel.startsWith(FONT_OUT_DIR + sep)) continue;`,
    to: `      if (rel === "___never___") continue;`,
  },
  {
    what: "⑥ 배정이 스택 순서를 무시하고 전부 첫 서체에 몰아준다 — 라틴 폰트에 한자를 요구하게 된다",
    from: `      if (cmap.has(cp)) {
        perFamily.get(fam.key)!.add(cp);
        placed = true;
        break;
      }`,
    to: `      perFamily.get(stack.order[0]!.key)!.add(cp);
      placed = true;
      break;`,
  },
  {
    what: "⑦ 파일 이름에서 내용 해시를 뺀다 — 새 HTML 이 옛 부분집합을 문다(2026-08-30 사고의 모양)",
    from: `  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  return \`\${familyKey}-\${weight}.\${hash}.woff2\`;`,
    to: `  return \`\${familyKey}-\${weight}.0000000000.woff2\`;`,
  },
  {
    what: "⑧ 빈 `dist` 를 통과로 만든다 — 「안 쟀음」이 「깨끗함」이 된다",
    from: `    throw new Error(\`\${distDir} 에서 훑을 파일이 0개다 — 화면을 먼저 구웠는가?\`);`,
    to: `    return { chars: new Set(), filesRead: 0, byExtension: {}, commentOnly: [], unknownEntities: [], bytesRead: 0 };`,
  },
  {
    what: "⑨ 줄바꿈·제로폭도 글리프로 요구한다 — 첫 실행부터 전 서체가 실패해 사람이 검사를 끄게 된다",
    from: `export function isNonGlyph(cp: number): boolean {
  if (cp < 0x20) return true; // C0 — 줄바꿈·탭 포함`,
    to: `export function isNonGlyph(cp: number): boolean {
  if (cp < 0x00) return true; // C0 — 줄바꿈·탭 포함`,
  },
  {
    what: "⑩ 바이트 순회가 3바이트 문자를 놓친다 — 빠른 경로가 조용히 덜 센다",
    from: `    } else if (b >= 0xe0 && b <= 0xef && i + 2 < n) {
      bmp[((b & 0x0f) << 12) | ((buf[i + 1]! & 0x3f) << 6) | (buf[i + 2]! & 0x3f)] = 1;
      i += 2;`,
    to: `    } else if (b >= 0xe0 && b <= 0xef && i + 2 < n) {
      i += 2;`,
  },
  {
    what: "⑪ 정규식 리터럴을 안 좇는다 — 고치기 전 그대로. `/\\//` 뒤의 코드가 통째로 주석이 된다",
    from: `      if (c === "/" && regexAllowed(lastSig, prevSig, lastWord)) {`,
    to: `      if (false && c === "/" && regexAllowed(lastSig, prevSig, lastWord)) {`,
  },
  {
    what: "⑪′ 정규식 판정을 늘 참으로 — 흔한 나눗셈이 정규식이 되어 그 줄의 주석을 코드로 센다",
    from: `function regexAllowed(lastSig: string, prevSig: string, lastWord: string): boolean {
  if (lastSig === "") return true; // 파일의 첫 토큰`,
    to: `function regexAllowed(lastSig: string, prevSig: string, lastWord: string): boolean {
  if (lastSig !== "\\u0000") return true; // 파일의 첫 토큰`,
  },
  {
    what: "⑫ 보간(${…})을 안 좇는다 — 안쪽 역따옴표가 바깥을 닫아 그 뒤가 통째로 밀린다",
    from: `      if (state === "tpl" && c === "$" && src[i + 1] === "{") {`,
    to: `      if (false && state === "tpl" && c === "$" && src[i + 1] === "{") {`,
  },
  {
    what: "⑬ 바이트 경로가 이스케이프를 안 푼다 — `\\uXXXX` 로만 있는 글자가 조용히 빠진다",
    from: `        const cp = escapeCodePoint(buf.toString("latin1", i, Math.min(n, i + ESCAPE_WINDOW)));
        if (cp !== undefined) into.add(cp);`,
    to: `        escapeCodePoint(buf.toString("latin1", i, Math.min(n, i + ESCAPE_WINDOW)));`,
  },
  {
    what: "⑬′ 문자 경로가 이스케이프를 안 푼다 — `.js` 만 갈린다(M1 이 경계하는 모양)",
    from: `      const cp = escapeCodePoint(text.slice(i, i + ESCAPE_WINDOW));
      if (cp !== undefined) into.add(cp);`,
    to: `      escapeCodePoint(text.slice(i, i + ESCAPE_WINDOW));`,
  },
  {
    what: "⑬″ 서러게이트 쌍을 반쪽씩 센다 — 어느 서체도 못 덮어 빌드가 거짓으로 붉어진다",
    from: `  const pair = ESCAPE_PAIR_RE.exec(text);
  if (pair !== null) {`,
    to: `  const pair = null as RegExpExecArray | null;
  if (pair !== null) {`,
  },
  {
    what: "⑭ 못 푼 이름 개체를 조용히 흘린다 — 그 글자가 화면에서만 살아남는다",
    from: `            if (cp === undefined) (unknown ??= []).push(body);
            else into.add(cp);`,
    to: `            if (cp !== undefined) into.add(cp);`,
  },
  {
    what: "⑮ 원본 sha256 대조를 늘 통과시킨다 — 조용한 폰트 교체가 빌드로 그대로 들어간다",
    from: `  if (got !== want) {`,
    to: `  if (got !== want && want !== want) {`,
  },
];

process.exitCode = runMutations({ src: SRC, tests: TESTS, mutations: MUTATIONS }) === 0 ? 0 : 1;
