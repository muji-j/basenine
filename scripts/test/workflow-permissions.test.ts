/**
 * **어느 잡이 쓰기 토큰을 들고 도는가** — 목록을 못 박는다.
 *
 * ⚠예전에는 `daily.yml` 이 워크플로 수준 `contents: write` 하나뿐이었고,
 * 그래서 **체크아웃조차 안 하는 `decide` 까지** 저장소 쓰기 토큰을 들고 돌았다
 * (2026-08-25 · 감사 P3 #15). 같은 파일 머리말이 「액션을 커밋 SHA 로 고정하는」 이유로
 * **바로 그 토큰**을 든다 — 범위를 좁히는 것이 그 걱정을 실제로 줄이는 방법이다.
 *
 * ## ⚠YAML 파서를 들이지 않는다
 *
 * 시험 하나 때문에 의존성을 늘리는 것은 그 자체가 공급망 비용이다(§0-9).
 * 대신 **이 저장소의 워크플로가 실제로 쓰는 모양만** 좁게 읽는다:
 * 최상위 키는 0칸 · 잡은 2칸 · 잡의 키는 4칸 · 권한 항목은 그 아래 2칸 더.
 * ⚠**좁게 읽는 대신 조용히 넘어가지 않는다**(M7) — 잡을 하나도 못 찾거나
 * 권한 블록을 못 찾으면 **실패한다.** 모양이 바뀌면 이 시험이 먼저 붉어져야 한다.
 *
 * ## 무엇을 지키는가
 *
 * 「잡마다 `permissions:` 를 적어라」가 아니라 **「쓰기를 가진 잡의 목록이 이것뿐이다」**를 지킨다.
 * 물려받아서 읽기만 하는 잡(`access-config.yml` 의 `run`)까지 다시 적게 하면
 * 지켜야 할 것이 아니라 **형식**을 지키게 된다.
 *
 * ⚠**잡 수준 `permissions:` 는 합치는 게 아니라 통째로 갈아치운다** — 그래서 유효 권한은
 * 「잡에 있으면 그것, 없으면 워크플로 기본」이다. 이 시험도 그렇게 계산한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");

interface Job {
  file: string;
  name: string;
  /** 유효 권한 — 잡에 있으면 그것, 없으면 워크플로 기본 */
  perms: ReadonlyMap<string, string>;
  /** 잡이 스스로 적었는가(물려받았는가) */
  own: boolean;
}

/** `  key: value` 꼴에서 (들여쓰기, 키, 값). 주석·빈 줄은 null */
function parseLine(line: string): { indent: number; key: string; value: string } | null {
  if (/^\s*(#|$)/.test(line)) return null;
  const m = /^(\s*)([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
  if (m === null) return null;
  return { indent: m[1]!.length, key: m[2]!, value: m[3]! };
}

/** 들여쓰기 `indent + 2` 인 `k: v` 를 연속으로 걷어 온다 */
function block(lines: readonly string[], from: number, indent: number): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = from; i < lines.length; i += 1) {
    const p = parseLine(lines[i]!);
    if (p === null) continue;
    if (p.indent <= indent) break;
    if (p.indent === indent + 2 && p.value !== "") out.set(p.key, p.value);
  }
  return out;
}

function jobsOf(file: string): Job[] {
  const lines = readFileSync(join(DIR, file), "utf8").split(/\r?\n/);
  let wf = new Map<string, string>();
  let inJobs = false;
  const out: Job[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const p = parseLine(lines[i]!);
    if (p === null) continue;
    if (p.indent === 0 && p.key === "permissions" && !inJobs) { wf = block(lines, i + 1, 0); continue; }
    if (p.indent === 0) { inJobs = p.key === "jobs"; continue; }
    if (!inJobs || p.indent !== 2 || p.value !== "") continue;
    const own = block(lines, i + 1, 2);
    // 잡 본문에서 `permissions:` 를 찾는다(4칸)
    let perms: Map<string, string> | null = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const q = parseLine(lines[j]!);
      if (q === null) continue;
      if (q.indent <= 2) break;
      if (q.indent === 4 && q.key === "permissions") { perms = block(lines, j + 1, 4); break; }
    }
    void own;
    out.push({ file, name: p.key, perms: perms ?? wf, own: perms !== null });
  }
  return out;
}

/** ⚠**쓰기를 가져도 되는 잡** — 늘리려면 여기에 적고, 왜 필요한지 함께 적어라 */
const ALLOWED_WRITE: readonly string[] = [
  // `ops/` 수집 로그 커밋(60일 무활동 자동 비활성화를 막는 유일한 장치) + 릴리스 자산 업로드
  "daily.yml:collect",
];

const all = readdirSync(DIR).filter((f) => f.endsWith(".yml")).flatMap(jobsOf);

test("⚠잡을 읽는 방식이 헛돌지 않는다 — 아래 시험이 여기에 얹혀 있다", () => {
  assert.ok(all.length >= 3, `워크플로 잡을 ${all.length}개밖에 못 찾았다 — 스캐너가 헛돈다`);
  for (const j of all) {
    assert.ok(j.perms.size > 0, `${j.file}:${j.name} 의 권한을 한 줄도 못 읽었다 — 모양이 바뀌었다`);
  }
  console.log(`  · 잡 ${all.length}개: ${all.map((j) => `${j.file}:${j.name}${j.own ? "" : "(물려받음)"}`).join(" ")}`);
});

test("⚠쓰기 권한을 가진 잡은 허용 목록뿐이다", () => {
  const write = all
    .filter((j) => [...j.perms.values()].some((v) => v === "write"))
    .map((j) => `${j.file}:${j.name}`)
    .sort();
  assert.deepEqual(
    write,
    [...ALLOWED_WRITE].sort(),
    "쓰기 토큰을 든 잡이 달라졌다.\n" +
      "⚠**늘렸다면**: 정말 그 잡이 써야 하는지 보고, 맞으면 ALLOWED_WRITE 에 **사유와 함께** 적어라.\n" +
      "⚠**줄었다면**: `git push` 나 `gh release upload` 가 조용히 실패할 수 있다 — 배포 로그를 확인해라.",
  );
  console.log(`  · 쓰기를 가진 잡 ${write.length}개 / 전체 ${all.length}개`);
});

test("⚠워크플로 기본값에는 쓰기가 없다 — 잡을 새로 만들면 읽기로 시작해야 한다", () => {
  const bad = all
    .filter((j) => !j.own && [...j.perms.values()].some((v) => v === "write"))
    .map((j) => `${j.file}:${j.name}`);
  assert.deepEqual(bad, [], "이 잡들이 **워크플로 기본값에서** 쓰기를 물려받는다 — 잡 수준으로 내려라");
});
