/**
 * 정정 자동 재수집의 받기 CLI(`cli-games.ts`) — 입력 검사 · 경기 ID 왕복 · 월간 일정 요청 0(설계 D7-2 · 시험 T7′).
 *
 * ⚠**외부 요청 0 — 두 겹으로 지킨다.**
 * ⑴ 진입 함수(`runCliGames`)를 **가짜 `fetchImpl`** 로 부른다 — 「요청 0」은 그 가짜가 불린 횟수로 잰다.
 * ⑵ 파일로 띄우는 본(배선 확인)은 **틀린 입력만** 주고, 연락처를 일부러 `me@example.com`(RFC 2606 예약 도메인)으로 준다 —
 *    검사가 회귀해도 `buildUserAgent` 가 **fetcher 를 만들기 전에** 거부하므로 요청이 0이다(`cli-draft-args.test.ts` 와 같은 걸쇠).
 *    ⚠**그 주소를 「실재하는 것」으로 바꾸지 마라. 여기서는 그게 걸쇠다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTO_REFETCH_MAX_GAMES, AUTO_REFETCH_REQUEST_TIMEOUT_MS } from "@bb-app/store/refetch-limit";
import { CLI_GAMES_DEFAULT_DELAY_MS, parseDeadline, parseGameIds, runCliGames } from "../src/cli-games.ts";
import { fixedClock } from "../src/clock.ts";
import { GAME_PAGES, discoverGames, gameIdOf, gameRefFromId, pageKey, pageUrl } from "../src/discover.ts";
import type { TimedFetchImpl } from "../src/metered-fetch.ts";

const CLI = fileURLToPath(new URL("../src/cli-games.ts", import.meta.url));
const NOW = "2026-09-28T20:51:00.000Z";
const DEADLINE = "2026-09-28T21:16:00.000Z";
const CONTACT = "bb-app@lunomel.jp";
const ID1 = "2026/0923/s-t-23";
const ID2 = "2026/0917/t-c-20";

/** 넉넉한 유효 ID n개(날짜·슬러그가 다 다르다) */
const manyIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `2026/08${String(i + 1).padStart(2, "0")}/s-t-${String(i + 1)}`);

interface Ran {
  code: number;
  urls: string[];
  timeouts: number[];
  stderr: string;
  dir: string;
  result: string;
}

/**
 * 임시 폴더에서 진입 함수를 가짜 fetch 로 부른다. `ids` 는 `--ids` 파일 내용(null 이면 파일을 안 만든다).
 * `args` 는 기본 인자를 갈아 끼운다(값이 null 이면 그 인자를 뺀다).
 */
async function runIn(
  o: {
    ids?: string | null;
    args?: Record<string, string | null>;
    extra?: readonly string[];
    contact?: string | null;
    status?: (url: string, n: number) => number;
    before?: (dir: string, result: string) => Promise<void>;
  } = {},
): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), "bb-cli-games-"));
  const idsPath = join(dir, "games.txt");
  const result = join(dir, "fetch-result.json");
  if (o.ids !== null) await writeFile(idsPath, o.ids ?? `${ID1}\n${ID2}\n`);
  await o.before?.(dir, result);
  const base: Record<string, string | null> = {
    "--ids": idsPath,
    "--out": join(dir, "archive"),
    "--deadline": DEADLINE,
    "--result": result,
    ...(o.args ?? {}),
  };
  const argv = [...Object.entries(base).flatMap(([k, v]) => (v === null ? [] : [k, v])), ...(o.extra ?? [])];
  const urls: string[] = [];
  const timeouts: number[] = [];
  const lines: string[] = [];
  const seen = new Map<string, number>();
  const fetchImpl: TimedFetchImpl = async (url) => {
    urls.push(url);
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const status = o.status?.(url, n) ?? 200;
    const bytes = new TextEncoder().encode(`page:${url}`);
    return {
      status,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  const env: Record<string, string | undefined> = {};
  if (o.contact !== null) env["BB_ARCHIVER_CONTACT"] = o.contact ?? CONTACT;
  const code = await runCliGames(argv, env, {
    fetchImpl,
    sleep: async () => undefined,
    clock: fixedClock(NOW),
    timeoutSignal: (ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
    log: (line) => {
      lines.push(line);
    },
  });
  return { code, urls, timeouts, stderr: lines.join("\n"), dir, result };
}

async function cleanup(r: Ran): Promise<void> {
  await rm(r.dir, { recursive: true, force: true });
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

// ---- import 는 아무것도 하지 않는다 ----------------------------------------------

test("⚠import 만으로는 아무것도 하지 않는다 — 파일로 실행될 때만 진입한다", () => {
  assert.equal(process.exitCode, undefined, "import 가 진입 함수를 돌려 종료 코드를 세웠다");
});

// ---- 요청 0으로 종료 2 ---------------------------------------------------------

for (const bad of [
  "2026/923/s-t-23",
  "2026/0923/S-T-23",
  "2026/0923/st23",
  "2026/0923/s-t-23/",
  " 2026/0923/s-t-23",
  "2026/0923/s-t-23\r",
  "2026/0230/s-t-23",
  "2026/1301/s-t-23",
  "../../etc/passwd",
]) {
  test(`⚠틀린 ID ${JSON.stringify(bad)} → 요청 0으로 종료 2`, async () => {
    // ⚠첫 줄은 틀린 ID 와 **다른 경기**(ID2)다 — 같은 경기(ID1)를 두면 「조용히 고쳐 받는」 회귀가
    //   중복 검사에 걸려 같은 종료 2 를 내고, 이 본이 그 회귀를 못 잡는다(변이 검사에서 실측)
    const r = await runIn({ ids: `${ID2}\n${bad}\n` });
    try {
      assert.equal(r.code, 2);
      assert.deepEqual(r.urls, [], "틀린 입력에 요청이 나갔다(L1 의 마지막 방어선)");
      assert.match(r.stderr, /2번째 줄의 경기 ID 가 틀렸다/);
      assert.equal(await exists(r.result), false, "종료 2 인데 결과 JSON 이 있다");
    } finally {
      await cleanup(r);
    }
  });
}

test(`⚠${String(AUTO_REFETCH_MAX_GAMES + 1)}줄 → 요청 0으로 종료 2 · ${String(AUTO_REFETCH_MAX_GAMES)}줄은 받는다`, async () => {
  const over = await runIn({ ids: `${manyIds(AUTO_REFETCH_MAX_GAMES + 1).join("\n")}\n` });
  try {
    assert.equal(over.code, 2);
    assert.deepEqual(over.urls, []);
    assert.match(over.stderr, new RegExp(String(AUTO_REFETCH_MAX_GAMES)));
  } finally {
    await cleanup(over);
  }
  const edge = await runIn({ ids: `${manyIds(AUTO_REFETCH_MAX_GAMES).join("\n")}\n` });
  try {
    assert.equal(edge.code, 0, edge.stderr);
    assert.equal(edge.urls.length, AUTO_REFETCH_MAX_GAMES * GAME_PAGES.length);
  } finally {
    await cleanup(edge);
  }
});

for (const bad of ["abc", "", "2026-09-28T21:16:00", "2026-09-28 21:16:00Z", "2026-02-30T00:00:00.000Z", "2026-09-28T21:16:00+09:00"]) {
  test(`⚠못 읽는 --deadline ${JSON.stringify(bad)} → 요청 0으로 종료 2`, async () => {
    const r = await runIn({ args: { "--deadline": bad } });
    try {
      assert.equal(r.code, 2);
      assert.deepEqual(r.urls, []);
      assert.match(r.stderr, /--deadline/);
    } finally {
      await cleanup(r);
    }
  });
}

for (const [name, o, pattern] of [
  ["--delay 500(L1 하한 미만)", { args: { "--delay": "500" } }, /--delay/],
  ["--delay abc", { args: { "--delay": "abc" } }, /--delay/],
  ["연락처 없음", { contact: null }, /연락처/],
  ["예약 도메인 연락처", { contact: "me@example.com" }, /닿지 않/],
  ["--ids 없음", { args: { "--ids": null } }, /--ids/],
  ["--ids 파일 없음", { ids: null }, /--ids/],
  ["--out 없음", { args: { "--out": null } }, /--out/],
  ["--deadline 없음", { args: { "--deadline": null } }, /--deadline/],
  ["--result 없음", { args: { "--result": null } }, /--result/],
  ["모르는 인자", { extra: ["--contact", CONTACT] }, /인자/],
  ["위치 인자", { extra: ["2026/0923/s-t-23"] }, /인자/],
  ["빈 파일", { ids: "" }, /0개/],
  ["같은 경기 두 번", { ids: `${ID1}\n${ID2}\n${ID1}\n` }, /두 번/],
] as const) {
  test(`⚠${name} → 요청 0으로 종료 2`, async () => {
    const r = await runIn(o);
    try {
      assert.equal(r.code, 2, r.stderr);
      assert.deepEqual(r.urls, []);
      assert.match(r.stderr, pattern);
    } finally {
      await cleanup(r);
    }
  });
}

test("⚠입력이 틀려 종료 2 로 끝나도 옛 결과 파일을 이 실행의 결과로 남기지 않는다", async () => {
  const r = await runIn({
    ids: "bad\n",
    before: async (_dir, result) => {
      await writeFile(result, '{"schema":1,"exit":0}\n');
    },
  });
  try {
    assert.equal(r.code, 2);
    assert.equal(await exists(r.result), false, "옛 결과가 남았다 — 부르는 쪽이 이 실행의 결과로 읽는다");
  } finally {
    await cleanup(r);
  }
});

// ---- 받는 것 — 경기 4장만 · 월간 일정 0 ------------------------------------------

test("⚠월간 일정 요청 0 — 경기 ID 가 곧 주소다 · 받는 차례는 입력 차례 · 결과 JSON(스키마 1)", async () => {
  const r = await runIn();
  try {
    assert.equal(r.code, 0, r.stderr);
    const want = [ID1, ID2].flatMap((id) => GAME_PAGES.map((p) => pageUrl(gameRefFromId(id), p)));
    assert.deepEqual(r.urls, want);
    assert.equal(r.urls.filter((u) => /schedule/.test(u)).length, 0, "월간 일정을 받았다");
    assert.deepEqual(r.timeouts, Array(want.length).fill(AUTO_REFETCH_REQUEST_TIMEOUT_MS), "전송 시간 상한이 배선되지 않았다");

    const json = JSON.parse(await readFile(r.result, "utf8")) as Record<string, unknown> & { games: { id: string; status: string }[] };
    assert.deepEqual(Object.keys(json), ["schema", "deadline", "page_fetches", "http_attempts", "by_status", "distress", "stopped", "games", "exit"]);
    assert.equal(json["schema"], 1);
    assert.equal(json["deadline"], DEADLINE);
    assert.equal(json["page_fetches"], 8);
    assert.equal(json["http_attempts"], 8);
    assert.equal(json["exit"], 0);
    assert.deepEqual(json.games.map((g) => [g.id, g.status]), [[ID1, "recorded"], [ID2, "recorded"]]);
    for (const id of [ID1, ID2]) {
      for (const p of GAME_PAGES) {
        assert.ok(await exists(join(r.dir, "archive", `${pageKey(gameRefFromId(id), p)}.html.gz`)), `${id} ${p} 를 안 썼다`);
      }
    }
  } finally {
    await cleanup(r);
  }
});

test("⚠받기 실패가 있으면 종료 1 · 결과 JSON 의 exit 도 1 · 자동 경로는 maxRetries 1(페이지당 전송 2)", async () => {
  const r = await runIn({ status: (url) => (url.includes(ID1) ? 503 : 200) });
  try {
    assert.equal(r.code, 1);
    assert.equal(r.urls.length, GAME_PAGES.length * 2, "첫 경기 4장 × 2시도 뒤 회로가 열려 둘째 경기는 안 받는다");
    const json = JSON.parse(await readFile(r.result, "utf8")) as { exit: number; games: { status: string; reason: string | null }[] };
    assert.equal(json.exit, 1);
    assert.deepEqual(json.games.map((g) => g.reason ?? g.status), ["prepare_failed", "circuit_open"]);
  } finally {
    await cleanup(r);
  }
});

// ---- 경기 ID ↔ GameRef 왕복 -----------------------------------------------------

test("⚠gameRefFromId — pageKey 의 역함수(왕복)", () => {
  for (const id of [ID1, ID2, "2018/0330/bs-f-1", "2026/1101/t-h-7"]) {
    const ref = gameRefFromId(id);
    assert.equal(gameIdOf(ref), id);
    for (const p of GAME_PAGES) {
      assert.equal(pageKey(ref, p), `npb/scores/${id}/${p === "" ? "index" : p.replace(/\.html$/, "")}`);
      assert.equal(pageUrl(ref, p), `https://npb.jp/scores/${id}/${p}`);
    }
  }
  // 월간 일정이 찾은 경기 → ID → 다시 GameRef: 구장만 모른다(ID 에 없다 · null)
  const html = `<a href="/scores/2026/0923/s-t-23/">g</a><a href="/scores/2026/0917/t-c-20/">g</a>`;
  for (const ref of discoverGames(html, "x", 2026)) {
    assert.deepEqual(gameRefFromId(gameIdOf(ref)), { ...ref, venue: null });
  }
  assert.equal(gameRefFromId(ID1).venue, null);
});

test("⚠gameRefFromId — 모양이 틀리거나 없는 날짜면 던진다", () => {
  for (const bad of ["2026/0923", "2026/0923/s", "2026/0230/s-t-1", "2026/0000/s-t-1", "x/0923/s-t-1"]) {
    assert.throws(() => gameRefFromId(bad), RangeError, bad);
  }
});

test("parseGameIds · parseDeadline — 끝 줄바꿈 하나는 허용 · 정규 UTC ISO 만", () => {
  const okIds = parseGameIds(`${ID1}\n${ID2}`);
  assert.equal(okIds.ok, true);
  assert.deepEqual(okIds.ok ? okIds.refs.map(gameIdOf) : [], [ID1, ID2]);
  assert.equal(parseGameIds(`${ID1}\n\n`).ok, false, "빈 줄은 ID 가 아니다");
  assert.equal(parseDeadline(DEADLINE), Date.parse(DEADLINE));
  assert.equal(parseDeadline(undefined), null);
  assert.equal(CLI_GAMES_DEFAULT_DELAY_MS, 3000);
});

// ---- 파일로 띄운다(배선) ------------------------------------------------------------

/**
 * ⚠**`BB_ARCHIVER_CONTACT` 를 예약 도메인으로 덮는다** — 개발자 셸의 진짜 연락처가 새면 회귀했을 때 실사이트를 친다.
 */
function spawnCli(args: readonly string[]): { status: number; stderr: string } {
  const env = { ...process.env, BB_ARCHIVER_CONTACT: "me@example.com" };
  try {
    execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stderr?: string };
    // ⚠`status` 가 null 이면 시그널로 죽은 것이다 — 0 으로 뭉개지 않는다(M11)
    return { status: typeof e.status === "number" ? e.status : -1, stderr: e.stderr ?? "" };
  }
}

test("⚠파일로 띄우면 진입한다 — 인자 없음 → 종료 2(요청 0)", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 2, `⚠0 이면 진입하지 않았다(파일 실행 판별이 깨졌다): ${r.stderr}`);
  assert.match(r.stderr, /--result/);
});

test("⚠파일로 띄워도 틀린 ID 는 종료 2 — 옛 결과 파일도 지운다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-cli-games-spawn-"));
  try {
    const ids = join(dir, "games.txt");
    const result = join(dir, "r.json");
    await writeFile(ids, "2026/0923/S-T-23\n");
    await writeFile(result, "{}\n");
    const r = spawnCli(["--ids", ids, "--out", join(dir, "a"), "--deadline", DEADLINE, "--result", result]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /경기 ID/);
    assert.equal(await exists(result), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
