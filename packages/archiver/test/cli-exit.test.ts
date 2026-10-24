/**
 * 받기 자식 셋(`cli.ts` · `cli-players.ts` · `cli-starters.ts`)의 종료 코드 — 0 / 75 / 1 · 다음 달 일정 · 회로 env
 * (설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D4 · 시험 T8).
 *
 * ⚠**외부 요청 0** — 진입 함수를 **가짜 `fetchImpl`** 로 부른다(「요청 0」은 그 가짜의 호출 수로 잰다). 저장은 임시 폴더의 `LocalSink`,
 *   쓰기 실패는 주입한 `sink` 로 낸다. 파일로 띄우는 본은 **틀린 입력만** 준다(연락처는 RFC 2606 예약 도메인 — 마지막 걸쇠).
 * ⚠**75 계약은 이 셋뿐이다** — 정정·공표표·드래프트 도구는 0/1 그대로다(설계 D1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runArchiveCli } from "../src/cli.ts";
import { runPlayersCli } from "../src/cli-players.ts";
import { runStartersCli } from "../src/cli-starters.ts";
import { fixedClock } from "../src/clock.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import { MemorySink } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import { EXIT_UPSTREAM_ONLY } from "../src/upstream.ts";

const NOW = "2026-10-24T00:26:00.000Z";
const CONTACT = "bb-app@lunomel.jp";
const MONTH10 = `<a href="/scores/2026/1020/s-db-17/">g1</a>`;

/** 가짜 전송 — `route` 가 URL 별 상태(또는 던질 오류)를 정한다. 기본은 200 */
function transport(route: (url: string) => number | Error = () => 200) {
  const calls: string[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    calls.push(url);
    const r = route(url);
    if (r instanceof Error) throw r;
    const body = new TextEncoder().encode(url.includes("schedule_10_detail") ? MONTH10 : `<html>${url}</html>`);
    return {
      status: r,
      headers: { get: () => null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  };
  return { fetchImpl, calls };
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bb-cli-exit-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface Ran {
  code: number;
  calls: string[];
  log: string;
}

async function archiveCli(o: { date?: string; route?: (url: string) => number | Error; env?: Record<string, string | undefined> }): Promise<Ran> {
  return withDir(async (dir) => {
    const t = transport(o.route);
    const lines: string[] = [];
    const code = await runArchiveCli(["--date", o.date ?? "2026-10-20", "--out", join(dir, "archive")], { BB_ARCHIVER_CONTACT: CONTACT, ...(o.env ?? {}) }, {
      fetchImpl: t.fetchImpl,
      sleep: async () => undefined,
      clock: fixedClock(NOW),
      log: (l) => lines.push(l),
    });
    return { code, calls: t.calls, log: lines.join("\n") };
  });
}

const isNext = (url: string): boolean => url.includes("schedule_11_detail");
const isCurrent = (url: string): boolean => url.includes("schedule_10_detail");

// ---- T8 · cli.ts 다음 달 일정 ------------------------------------------------------

test("⚠T8 현재 달 성공 + 다음 달 503 소진(회로 미달) → cli.ts 75 · 꼬리표 없음", async () => {
  const r = await archiveCli({ route: (u) => (isNext(u) ? 503 : 200) });
  assert.equal(r.code, EXIT_UPSTREAM_ONLY, r.log);
  assert.equal(r.calls.filter(isNext).length, 4, "다음 달을 4시도 하지 않았다");
  assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 취득 실패 \(재시도 3회 소진\)/);
  assert.doesNotMatch(r.log, /오프시즌이면 정상/, "네트워크·서버 실패에 「오프시즌이면 정상」을 붙였다(P3)");
});

test("⚠T8 다음 달 404 · 410 → 0 + 꼬리표 「（오프시즌이면 정상）」", async () => {
  for (const status of [404, 410]) {
    const r = await archiveCli({ route: (u) => (isNext(u) ? status : 200) });
    assert.equal(r.code, 0, `${String(status)}: ${r.log}`);
    assert.match(r.log, new RegExp(`다음 달 일정\\(2026-11\\) 은 못 받았다 — 월간 일정을 받지 못했다 \\(HTTP ${String(status)}\\).*（오프시즌이면 정상）`));
  }
});

test("⚠T8 현재 달 일정 404 → 1(우리가 모르는 상태 — 받기 실패가 아니다)", async () => {
  const r = await archiveCli({ route: (u) => (isCurrent(u) ? 404 : 200) });
  assert.equal(r.code, 1, r.log);
  assert.match(r.log, /2026-10-20 {2}ERROR — 월간 일정을 받지 못했다 \(HTTP 404\)/);
});

test("⚠T8 다음 달 일정의 구조 변경은 지금처럼 경고만 — 종료 코드 무영향 · 꼬리표 없음", async () => {
  // 가짜 전송의 다음 달 본문은 경기 링크도 날짜 행도 없다 → NoGamesFoundError(구조 변경 의심)
  const r = await archiveCli({});
  assert.equal(r.code, 0, r.log);
  assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 경기 링크를 1건도 찾지 못했다/);
  assert.doesNotMatch(r.log, /오프시즌이면 정상/);
});

test("⚠T8 경기 페이지가 상류 실패만이면 75 · 그날 일정이 상류 실패면 75 · 전부 성공이면 0", async () => {
  const pages = await archiveCli({ route: (u) => (u.includes("/scores/2026/1020/") ? 503 : 200) });
  assert.equal(pages.code, EXIT_UPSTREAM_ONLY, pages.log);
  const day = await archiveCli({ route: (u) => (isCurrent(u) ? new TypeError("fetch failed") : 200) });
  assert.equal(day.code, EXIT_UPSTREAM_ONLY, day.log);
  const ok = await archiveCli({});
  assert.equal(ok.code, 0, ok.log);
  assert.match(ok.log, /첫 성공 응답 헤더까지 \d+ms/, "합계 줄에 첫 성공 응답의 시간을 안 적었다(설계 D3)");
});

// ---- 회로 env(BB_NPB_CIRCUIT_N) ------------------------------------------------------

test("⚠BB_NPB_CIRCUIT_N 이 틀리면 요청 0 으로 종료 2 — 기본값으로 메우지 않는다", async () => {
  for (const bad of ["", "0", "7", "abc", "1.5"]) {
    const r = await archiveCli({ env: { BB_NPB_CIRCUIT_N: bad } });
    assert.equal(r.code, 2, `${JSON.stringify(bad)}: ${r.log}`);
    assert.equal(r.calls.length, 0, `${JSON.stringify(bad)}: 요청이 나갔다`);
    assert.match(r.log, /BB_NPB_CIRCUIT_N/);
  }
});

test("⚠BB_NPB_CIRCUIT_N=1(재시도 슬롯) — 첫 소진에서 열려 다음 달 일정은 요청 0", async () => {
  const r = await archiveCli({ route: () => 503, env: { BB_NPB_CIRCUIT_N: "1" } });
  assert.equal(r.code, EXIT_UPSTREAM_ONLY, r.log);
  assert.equal(r.calls.length, 4, "현재 달 일정 4시도 뒤에 회로가 열려야 한다");
  assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 취득 실패 \(회로 열림 · 요청 0\)/);
});

test("BB_NPB_CIRCUIT_N 이 없으면 연속 3 — 현재 달 소진 1 · 다음 달 소진 1 이면 아직 안 열린다", async () => {
  const r = await archiveCli({ route: () => 503 });
  assert.equal(r.code, EXIT_UPSTREAM_ONLY);
  assert.equal(r.calls.length, 8);
});

// ---- cli-players.ts ---------------------------------------------------------------

/** 쓰기가 실패하는 Sink(주입) */
class WriteFails extends MemorySink {
  override async write(_key: string, _body: Uint8Array, _meta: BlobMeta): Promise<void> {
    throw new Error("디스크 오류(주입)");
  }
}

async function playersCli(o: { route?: (url: string) => number | Error; sink?: MemorySink; env?: Record<string, string | undefined> }): Promise<Ran> {
  return withDir(async (dir) => {
    const ids = join(dir, "ids.txt");
    await writeFile(ids, "00000001\n00000002\n");
    const t = transport(o.route);
    const lines: string[] = [];
    const code = await runPlayersCli(["--ids", ids, "--out", join(dir, "archive"), "--refresh"], { BB_ARCHIVER_CONTACT: CONTACT, ...(o.env ?? {}) }, {
      fetchImpl: t.fetchImpl,
      sleep: async () => undefined,
      clock: fixedClock(NOW),
      log: (l) => lines.push(l),
      ...(o.sink === undefined ? {} : { sink: o.sink }),
    });
    return { code, calls: t.calls, log: lines.join("\n") };
  });
}

test("⚠cli-players — 받기 실패만이면 75 · 쓰기 실패가 끼면 1 · 전부 성공이면 0 · 회로 env 가 틀리면 2(요청 0)", async () => {
  const up = await playersCli({ route: () => 503 });
  assert.equal(up.code, EXIT_UPSTREAM_ONLY, up.log);
  const local = await playersCli({ sink: new WriteFails() });
  assert.equal(local.code, 1, local.log);
  const ok = await playersCli({});
  assert.equal(ok.code, 0, ok.log);
  assert.match(ok.log, /첫 성공 응답 헤더까지 \d+ms/);
  const bad = await playersCli({ env: { BB_NPB_CIRCUIT_N: "x" } });
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});

test("⚠cli-players — 403 한 번이면 회로가 열려 나머지 선수는 요청 0(75)", async () => {
  const r = await playersCli({ route: () => 403 });
  assert.equal(r.code, EXIT_UPSTREAM_ONLY, r.log);
  assert.equal(r.calls.length, 1, "403 뒤에 요청이 나갔다");
});

// ---- cli-starters.ts --------------------------------------------------------------

async function startersCli(o: { route?: (url: string) => number | Error; sink?: MemorySink; env?: Record<string, string | undefined> }): Promise<Ran> {
  return withDir(async (dir) => {
    const t = transport(o.route);
    const lines: string[] = [];
    const code = await runStartersCli(["--out", join(dir, "archive"), "--date", "2026-10-24"], { BB_ARCHIVER_CONTACT: CONTACT, ...(o.env ?? {}) }, {
      fetchImpl: t.fetchImpl,
      sleep: async () => undefined,
      clock: fixedClock(NOW),
      log: (l) => lines.push(l),
      out: (l) => lines.push(l),
      ...(o.sink === undefined ? {} : { sink: o.sink }),
    });
    return { code, calls: t.calls, log: lines.join("\n") };
  });
}

test("⚠cli-starters — 받기 실패면 75 · 쓰기 실패면 1 · 성공이면 0 · 회로 env 가 틀리면 2(요청 0)", async () => {
  const up = await startersCli({ route: () => new TypeError("fetch failed") });
  assert.equal(up.code, EXIT_UPSTREAM_ONLY, up.log);
  assert.match(up.log, /予告先発 2026-10-24: failed/);
  const local = await startersCli({ sink: new WriteFails() });
  assert.equal(local.code, 1, local.log);
  const ok = await startersCli({});
  assert.equal(ok.code, 0, ok.log);
  assert.match(ok.log, /予告先発 2026-10-24: stored \(200\)/);
  const bad = await startersCli({ env: { BB_NPB_CIRCUIT_N: "9" } });
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});

// ---- 파일로 띄운다 — 틀린 입력만(요청 0) ------------------------------------------------

const SRC = (name: string): string => fileURLToPath(new URL(`../src/${name}`, import.meta.url));

function runFile(name: string, args: string[], env: Record<string, string>): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [SRC(name), ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { status: err.status, stderr: err.stderr };
  }
}

test("⚠import 만으로는 아무것도 하지 않는다 · 파일로 띄우면 진입한다(틀린 회로 env → 종료 2 · 요청 0)", () => {
  // ⚠연락처는 RFC 2606 예약 도메인 — 검사가 회귀해도 buildUserAgent 가 fetcher 를 만들기 전에 거부한다(요청 0 의 마지막 걸쇠)
  const env = { BB_ARCHIVER_CONTACT: "me@example.com", BB_NPB_CIRCUIT_N: "bad" };
  for (const [name, args] of [
    ["cli.ts", ["--date", "2026-10-20", "--out", tmpdir()]],
    ["cli-starters.ts", ["--out", tmpdir()]],
  ] as const) {
    const r = runFile(name, [...args], env);
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /BB_NPB_CIRCUIT_N/, `${name}: 회로 env 를 먼저 거부하지 않았다`);
  }
});
