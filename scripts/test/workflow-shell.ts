/**
 * `daily.yml` 을 **글자로 읽고**(YAML 파서 없이 · 이 저장소의 다른 워크플로 시험과 같은 방식) 안의 `run:` 조각을
 * **실제 `bash` 로 돌려 보는** 시험용 도구 — 시험 파일이 아니다(`*.test.ts` 가 아니다).
 *
 * ⚠**글자 검사만으로는 셸이 실제로 무엇을 하는지 모른다.** 이 저장소는 「배선이 있다」와 「그것이 돈다」가 갈린 사고를 여러 번 겪었다
 * (`workflow-runnable.test.ts` 머리말). 그래서 순수한 셸 조각(외부 요청 0 · git 0)은 임시 폴더에서 실제로 돌린다.
 * ⚠**경로는 상대 경로만 쓴다** — Windows 의 Git Bash · WSL · Linux 가 `/tmp`·`/dev/stdout` 을 서로 다르게 푼다(2026-10-02 실측:
 *   Git Bash 에서 `>> /dev/stdout` 은 실패한다). 조각 안의 `/tmp/correction-refetch` 는 `work` 로 바꿔 돌린다.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 줄끝을 `\n` 으로 맞춰 읽는다 — Windows 체크아웃(CRLF)에서만 떨어지는 정규식을 막는다 */
export function readLf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

export const DAILY: string = readLf("../../.github/workflows/daily.yml");

export interface Step {
  name: string;
  /** `- uses: <액션>@…` 스텝의 액션 글자(없으면 빈 문자열) */
  uses: string;
  /** `      - name: …` 줄 다음부터 다음 스텝 머리(또는 잡 끝) 앞까지 */
  body: string;
  /** 머리 줄을 포함한 시작 위치(전체 파일 기준) */
  at: number;
}

/** 잡 하나의 본문(`  <id>:` 줄부터 다음 잡 · 파일 끝 앞까지) */
export function jobBlock(yml: string, id: string): string {
  const head = new RegExp(`^  ${id}:\\n`, "m").exec(yml);
  if (head === null) throw new Error(`잡 ${id} 를 못 찾았다 — 이 시험이 공회전한다`);
  const rest = yml.slice(head.index + head[0].length);
  const next = /^  [a-z][a-z-]*:\n/m.exec(rest);
  return yml.slice(head.index, head.index + head[0].length + (next === null ? rest.length : next.index));
}

/**
 * 잡 안의 스텝을 순서대로 자른다. 머리는 `      - name:` · `      - uses:` 둘 다(6칸) — 이름 없는 스텝도 한 칸으로 센다.
 * ⚠`uses:` 만 있는 스텝의 `name` 은 빈 문자열이다.
 */
export function stepsOf(yml: string, job: string): Step[] {
  const block = jobBlock(yml, job);
  const base = yml.indexOf(block);
  const heads = [...block.matchAll(/^ {6}- (name|uses): ?(.*)$/gm)];
  return heads.map((m, i) => ({
    name: m[1] === "name" ? m[2]!.trim() : "",
    uses: m[1] === "uses" ? m[2]!.trim() : "",
    body: block.slice(m.index! + m[0].length, heads[i + 1]?.index ?? block.length),
    at: base + m.index!,
  }));
}

/** `name` 이 `prefix` 로 시작하는 스텝 — 정확히 하나여야 한다 */
export function stepNamed(yml: string, job: string, prefix: string): Step {
  const found = stepsOf(yml, job).filter((s) => s.name.startsWith(prefix));
  if (found.length !== 1) throw new Error(`「${prefix}」로 시작하는 스텝이 ${String(found.length)}개다(${job} 잡) — 1개여야 한다`);
  return found[0]!;
}

/** 스텝 본문의 `run: |` 블록(들여쓰기 10칸을 걷어 낸 셸 글자) 또는 한 줄 `run: …` */
export function runOf(step: Step): string {
  const lines = step.body.split("\n");
  const i = lines.findIndex((l) => /^ {8}run:/.test(l));
  if (i === -1) throw new Error(`「${step.name}」에 run: 이 없다`);
  const first = lines[i]!.replace(/^ {8}run:\s*/, "");
  if (first !== "|") return first;
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l === "") {
      out.push("");
      continue;
    }
    if (!l.startsWith("          ")) break; // 10칸 아래로 내려가면 블록이 끝났다
    out.push(l.slice(10));
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

export interface BashResult {
  status: number | null;
  stdout: string;
  stderr: string;
  dir: string;
}

/**
 * `script` 를 새 임시 폴더에서 `bash -c` 로 돌린다. `setup` 은 그 폴더에서 먼저 돈다(파일 준비).
 * ⚠bash 가 없으면 **시험이 실패한다**(조용히 건너뛰지 않는다) — 「안 쟀음」을 「통과」로 읽지 않기 위해서다.
 */
export function runBash(script: string, env: Record<string, string> = {}, setup?: (dir: string) => void): BashResult {
  const dir = mkdtempSync(join(tmpdir(), "bb-wf-"));
  setup?.(dir);
  const r = spawnSync("bash", ["-c", script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  if (r.error !== undefined) throw new Error(`bash 를 못 돌렸다 — ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, dir };
}
