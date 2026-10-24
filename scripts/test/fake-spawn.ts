/**
 * **가짜 자식** — `node --import <이 파일> scripts/update.ts …` 로 띄우면 `spawnSync` 가 진짜 자식을 띄우지 않는다(시험 전용 · `*.test.ts` 가 아니다).
 *
 * ⚠**외부 요청 0 · 진짜 자식 0** — `update.ts` 가 띄우는 받기 자식(npb.jp 를 친다)도 적재 자식(DB 를 쓴다)도 전부 여기서 끝난다.
 *   그래서 `update.ts` 를 **고치지 않은 채** 그 순서 · 부모 중단 · 종료 코드 정규화 · 사유 파일 배선을 실제로 돌려 볼 수 있다
 *   (예전에는 import 하는 순간 수집이 시작돼 소스 모양만 볼 수 있었다 — `refetch-wiring.test.ts` 머리말).
 * ⚠`node:child_process` 의 CJS 내보내기를 갈아 끼우고 `syncBuiltinESMExports()` 로 ESM 이름 가져오기에 반영한다 —
 *   이 파일이 `update.ts` 보다 **먼저** 평가되므로(`--import`) 그 뒤 가져오는 모듈은 전부 가짜를 받는다.
 *
 * env:
 * - `BB_FAKE_SPAWN_PLAN` — `{ "<스크립트 경로>": { exit?: number|null, signal?: string, stdout?: string, stderr?: string, reasonsFile?: string } }`.
 *   `exit: null` 은 「신호로 죽었다」(`status: null`)다. 계획에 없는 스크립트는 종료 0 · 빈 출력.
 *   `reasonsFile` 이 있으면 `--reasons-out <경로>` 에 그 글자를 그대로 쓴다(신선도 자식 흉내).
 * - `BB_FAKE_SPAWN_LOG` — 부른 차례대로 `{ script, args }` 를 한 줄씩 덧붙인다.
 */
import cp from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

interface Planned {
  exit?: number | null;
  signal?: string;
  stdout?: string;
  stderr?: string;
  reasonsFile?: string;
}

const plan = JSON.parse(process.env["BB_FAKE_SPAWN_PLAN"] ?? "{}") as Record<string, Planned>;
const logPath = process.env["BB_FAKE_SPAWN_LOG"];

function fakeSpawnSync(_cmd: string, args: readonly string[] = [], opts: { encoding?: string } = {}) {
  const script = args[0] ?? "";
  if (logPath !== undefined) appendFileSync(logPath, `${JSON.stringify({ script, args })}\n`);
  const p = plan[script] ?? {};
  if (p.reasonsFile !== undefined) {
    const at = args.indexOf("--reasons-out");
    const path = at === -1 ? undefined : args[at + 1];
    if (path !== undefined) writeFileSync(path, p.reasonsFile);
  }
  const text = opts.encoding !== undefined;
  return {
    pid: 0,
    output: [],
    status: p.exit === undefined ? 0 : p.exit,
    signal: p.signal ?? (p.exit === null ? "SIGKILL" : null),
    stdout: text ? (p.stdout ?? "") : null,
    stderr: text ? (p.stderr ?? "") : null,
  };
}

/**
 * ⚠⚠**그 밖의 자식 실행은 전부 막는다(fail closed)** — 실행기가 언젠가 `spawnSync` 말고 다른 길(`execFileSync` 등)로 자식을 띄우게
 *   바뀌면, 이 가짜가 그것을 못 가로채 **진짜 받기 자식이 npb.jp 를 친다.** 그러면 시험이 조용히 외부 요청을 보내는 대신 여기서 던진다.
 */
const blocked = (name: string) => (): never => {
  throw new Error(`fake-spawn: ${name} 는 막았다 — update.ts 의 자식은 spawnSync(가짜)로만 띄워야 한다(외부 요청 0)`);
};
const api = cp as unknown as Record<string, unknown>;
api["spawnSync"] = fakeSpawnSync;
for (const name of ["spawn", "exec", "execSync", "execFile", "execFileSync", "fork"]) api[name] = blocked(name);
syncBuiltinESMExports();
