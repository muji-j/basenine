/**
 * 받기 자식 셋(`cli.ts` · `cli-players.ts` · `cli-starters.ts`)의 종료 코드 — 0 / 75 / 69 / 1 / 70 · 다음 달 일정 · 회로 env
 * (설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D1 · D4 · 시험 T8).
 *
 * ⚠**외부 요청 0** — 진입 함수를 **가짜 `fetchImpl`** 로 부른다(「요청 0」은 그 가짜의 호출 수로 잰다). 저장은 임시 폴더의 `LocalSink`,
 *   쓰기 실패는 주입한 `sink` 로 낸다. 파일로 띄우는 본은 **틀린 입력만** 준다(연락처는 RFC 2606 예약 도메인 — 마지막 걸쇠).
 * ⚠**75·69·70 계약은 이 셋뿐이다** — 정정·공표표·드래프트 도구는 0/1 그대로다(설계 D1).
 * ⚠**회로가 열렸는가로 가른다**(3중 검토 반영 · 설계 D4): 상류만 75(닫힘 — 부모 계속) / 69(열림 — 부모 멈춤) ·
 *   로컬 있음 1(닫힘 — 계속) / 70(열림 — 멈춤).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { errors as undiciErrors } from "undici";
import { runArchiveCli } from "../src/cli.ts";
import { runPlayersCli } from "../src/cli-players.ts";
import { runStartersCli } from "../src/cli-starters.ts";
import { fixedClock } from "../src/clock.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import { MemorySink } from "../src/sink.ts";
import type { BlobMeta } from "../src/sink.ts";
import { EXIT_LOCAL_CIRCUIT_OPEN, EXIT_UPSTREAM_CIRCUIT_OPEN, EXIT_UPSTREAM_ONLY } from "../src/upstream.ts";

const NOW = "2026-10-24T00:26:00.000Z";
const CONTACT = "bb-app@lunomel.jp";
const MONTH10 = `<a href="/scores/2026/1020/s-db-17/">g1</a>`;
/** 네트워크 오류는 `cause` 의 코드로 온다(undici 모양) — cause 없는 TypeError 는 로컬 오류다(3중 검토 반영 · 설계 D1 ⑶) */
const refused = (): Error => new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 203.0.113.7:443"), { code: "ECONNREFUSED" }) });

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

async function archiveCli(o: { date?: string; route?: (url: string) => number | Error; env?: Record<string, string | undefined>; sink?: MemorySink }): Promise<Ran> {
  return withDir(async (dir) => {
    const t = transport(o.route);
    const lines: string[] = [];
    const code = await runArchiveCli(["--date", o.date ?? "2026-10-20", "--out", join(dir, "archive")], { BB_ARCHIVER_CONTACT: CONTACT, ...(o.env ?? {}) }, {
      fetchImpl: t.fetchImpl,
      sleep: async () => undefined,
      clock: fixedClock(NOW),
      log: (l) => lines.push(l),
      ...(o.sink === undefined ? {} : { sink: o.sink }),
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

/**
 * ⚠⚠**다음 달 일정의 로컬 고장도 로컬 실패다**(반영분 재검토 P2) — 상류 실패(75)도 404·410(꼬리표만)도 아니다.
 * 예전 갈래는 `UpstreamError` 만 실패로 세고 나머지를 경고로 남겨, 3중 검토 반영으로 새로 생긴 `FetchLocalError`(헤더 검증 · 인증서 등)가
 * **경고 한 줄과 종료 0** 이 됐다 — 다른 단계가 초록이면 그 실행은 초록으로 배포된다. 같은 오류가 현재 달이면 1 이었다.
 */
test("⚠⚠T8 다음 달 일정의 로컬 고장(FetchLocalError — UND_ERR_INVALID_ARG · CERT_HAS_EXPIRED)은 1 · 요청 1 · 재시도 0", async () => {
  const local = [
    (): Error => new TypeError("fetch failed", { cause: Object.assign(new Error("invalid user-agent header"), { code: "UND_ERR_INVALID_ARG" }) }),
    (): Error => new TypeError("fetch failed", { cause: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) }),
  ];
  for (const make of local) {
    const r = await archiveCli({ route: (u) => (isNext(u) ? make() : 200) });
    assert.equal(r.code, 1, `다음 달 일정의 로컬 고장이 막지 않았다: ${r.log}`);
    assert.equal(r.calls.filter(isNext).length, 1, "로컬 고장을 재시도했다");
    assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 로컬 오류 \(재시도 없음 · 상류 실패 아님\)/);
    assert.doesNotMatch(r.log, /오프시즌이면 정상/);
  }
  // 대조군 — 네트워크 코드면 지금처럼 상류(재시도 4 → 75)
  const up = await archiveCli({ route: (u) => (isNext(u) ? refused() : 200) });
  assert.equal(up.code, EXIT_UPSTREAM_ONLY, up.log);
  assert.equal(up.calls.filter(isNext).length, 4);
});

test("⚠T8 현재 달 일정 404 → 1(우리가 모르는 상태 — 받기 실패가 아니다)", async () => {
  const r = await archiveCli({ route: (u) => (isCurrent(u) ? 404 : 200) });
  assert.equal(r.code, 1, r.log);
  assert.match(r.log, /2026-10-20 {2}ERROR — 월간 일정을 받지 못했다 \(HTTP 404\)/);
});

/**
 * ⚠⚠**3중 검토 3차 ①의 재현 모양** — 경기 index 의 사이드카 읽기가 실패하고(local) 나머지 세 장이 503 으로 소진되면 회로가 열린다.
 * 예전에는 혼합 실패라 1 이 되어 부모가 다음 날짜 자식을 새 회로로 또 띄웠다(날짜 셋에 소진 9 · 시도 36). 이제 70 — 부모가 멈춘다.
 */
test("⚠⚠T8 index 사이드카 읽기 실패(local) + 나머지 세 장 503 소진(회로 열림) → 70", async () => {
  const r = await archiveCli({ sink: new ReadMetaThrowsAt("s-db-17/index"), route: (u) => (u.includes("/scores/2026/1020/s-db-17/") ? 503 : 200) });
  assert.equal(r.code, EXIT_LOCAL_CIRCUIT_OPEN, r.log);
  assert.equal(r.calls.filter((u) => u.includes("/s-db-17/")).length, 3 * 4, "세 장 × 4시도 뒤에 요청이 나갔다");
});

test("⚠T8 다음 달 일정의 구조 변경은 지금처럼 경고만 — 종료 코드 무영향 · 꼬리표 없음", async () => {
  // 가짜 전송의 다음 달 본문은 경기 링크도 날짜 행도 없다 → NoGamesFoundError(구조 변경 의심)
  const r = await archiveCli({});
  assert.equal(r.code, 0, r.log);
  assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 경기 링크를 1건도 찾지 못했다/);
  assert.doesNotMatch(r.log, /오프시즌이면 정상/);
});

test("⚠T8 경기 페이지가 상류 실패만이고 회로가 열렸으면 69 · 그날 일정만 상류 실패(회로 닫힘)면 75 · 전부 성공이면 0", async () => {
  // 경기 4장이 전부 503 — 셋째 소진에서 회로가 열려(연속 3) 넷째 장과 다음 달 일정은 요청 0 → 상류만 · 열림
  const pages = await archiveCli({ route: (u) => (u.includes("/scores/2026/1020/") ? 503 : 200) });
  assert.equal(pages.code, EXIT_UPSTREAM_CIRCUIT_OPEN, pages.log);
  assert.match(pages.log, /회로 열림\(consecutive\)/);
  const day = await archiveCli({ route: (u) => (isCurrent(u) ? refused() : 200) });
  assert.equal(day.code, EXIT_UPSTREAM_ONLY, day.log);
  assert.match(day.log, /network\[ECONNREFUSED\]/, "원인 코드가 메시지에 없다");
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

test("⚠BB_NPB_CIRCUIT_N=1(재시도 슬롯) — 첫 소진에서 열려 다음 달 일정은 요청 0 · 회로가 열렸으니 69(부모가 뒤 받기를 멈춘다)", async () => {
  const r = await archiveCli({ route: () => 503, env: { BB_NPB_CIRCUIT_N: "1" } });
  assert.equal(r.code, EXIT_UPSTREAM_CIRCUIT_OPEN, r.log);
  assert.equal(r.calls.length, 4, "현재 달 일정 4시도 뒤에 회로가 열려야 한다");
  assert.match(r.log, /다음 달 일정\(2026-11\) 은 못 받았다 — 취득 실패 \(회로 열림 · 요청 0\)/);
});

test("BB_NPB_CIRCUIT_N 이 없으면 연속 3 — 현재 달 소진 1 · 다음 달 소진 1 이면 아직 안 열린다(75 · 부모 계속)", async () => {
  const r = await archiveCli({ route: () => 503 });
  assert.equal(r.code, EXIT_UPSTREAM_ONLY);
  assert.equal(r.calls.length, 8);
  assert.match(r.log, /회로 닫힘 · 소진 2/);
});

// ---- cli-players.ts ---------------------------------------------------------------

/** 쓰기가 실패하는 Sink(주입) */
class WriteFails extends MemorySink {
  override async write(_key: string, _body: Uint8Array, _meta: BlobMeta): Promise<void> {
    throw new Error("디스크 오류(주입)");
  }
}

/** 사이드카 읽기가 특정 선수에서 던지는 Sink(주입) — `cli-players` 는 그 예외로 「던져서 끝난다」 */
class ReadMetaThrowsAt extends MemorySink {
  private readonly bad: string;
  constructor(id: string) {
    super();
    this.bad = id;
  }
  override async readMeta(key: string): Promise<BlobMeta | null> {
    if (key.includes(this.bad)) throw new Error("사이드카가 깨졌다(주입)");
    return super.readMeta(key);
  }
}

const pid = (n: number): string => String(n).padStart(8, "0");
const isPlayer = (n: number) => (url: string): boolean => url.includes(`/${pid(n)}.html`);

async function playersCli(o: { route?: (url: string) => number | Error; sink?: MemorySink; env?: Record<string, string | undefined>; ids?: readonly string[] }): Promise<Ran> {
  return withDir(async (dir) => {
    const ids = join(dir, "ids.txt");
    await writeFile(ids, `${(o.ids ?? [pid(1), pid(2)]).join("\n")}\n`);
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

/**
 * ⚠⚠**한 페이지만의 403 은 형제 받기를 막지 않는다**(3중 검토 2차 F1 · 즉시 열림 폐지). 예전에는 401·403·451 한 번에 회로가 열려
 *   나머지 선수가 전부 요청 0 이었다 — 자원 단위의 거절(그 페이지만)과 의도적 차단(모든 페이지)을 못 갈랐다.
 */
test("⚠cli-players — 한 선수만 403 이면 나머지는 받는다(75 · 회로 닫힘) · 전부 403 이면 셋째에서 열린다(69)", async () => {
  const ids = [pid(1), pid(2), pid(3), pid(4)];
  const one = await playersCli({ ids, route: (u) => (isPlayer(1)(u) ? 403 : 200) });
  assert.equal(one.code, EXIT_UPSTREAM_ONLY, one.log);
  assert.equal(one.calls.length, 4, "403 한 번 뒤에 형제 선수를 안 받았다");
  const all = await playersCli({ ids, route: () => 403 });
  assert.equal(all.code, EXIT_UPSTREAM_CIRCUIT_OPEN, all.log);
  assert.equal(all.calls.length, 3, "회로가 열린 뒤에 요청이 나갔다");
});

test("⚠⚠cli-players — 로컬 실패에 회로 열림이 겹치면 70(부모가 뒤 받기를 멈춘다) · 회로가 닫혀 있으면 1", async () => {
  const ids = [pid(1), pid(2), pid(3), pid(4)];
  // 선수 1 은 받았는데 쓰기 실패(local) · 2~4 는 503 소진 → 연속 3 에서 열림
  const open = await playersCli({ ids, sink: new WriteFails(), route: (u) => (isPlayer(1)(u) ? 200 : 503) });
  assert.equal(open.code, EXIT_LOCAL_CIRCUIT_OPEN, open.log);
  assert.equal(open.calls.length, 1 + 3 * 4);
  // 같은 모양에서 상류 소진이 둘뿐이면 회로는 닫혀 있다 → 1(부모 계속)
  const closed = await playersCli({ ids: ids.slice(0, 3), sink: new WriteFails(), route: (u) => (isPlayer(1)(u) ? 200 : 503) });
  assert.equal(closed.code, 1, closed.log);
});

test("⚠⚠cli-players — 던져서 끝나는 local(사이드카를 못 읽음)도 회로 상태로 가른다: 열렸으면 70 · 닫혔으면 1", async () => {
  // 선수 1~3 이 503 소진(연속 3 → 열림) · 선수 4 의 사이드카 읽기가 던진다
  const open = await playersCli({ ids: [pid(1), pid(2), pid(3), pid(4)], sink: new ReadMetaThrowsAt(pid(4)), route: () => 503 });
  assert.equal(open.code, EXIT_LOCAL_CIRCUIT_OPEN, open.log);
  assert.match(open.log, /사이드카가 깨졌다/);
  // 첫 선수에서 던진다 — 요청 0 · 회로 닫힘
  const closed = await playersCli({ ids: [pid(1), pid(2)], sink: new ReadMetaThrowsAt(pid(1)) });
  assert.equal(closed.code, 1, closed.log);
  assert.equal(closed.calls.length, 0);
});

// ---- cli-starters.ts --------------------------------------------------------------

async function startersCli(o: {
  route?: (url: string) => number | Error;
  sink?: MemorySink;
  env?: Record<string, string | undefined>;
  /** 가짜 전송을 통째로 갈아 끼운다(UA 를 보고 던지는 흉내 등) */
  fetchImpl?: FetchImpl;
}): Promise<Ran> {
  return withDir(async (dir) => {
    const t = transport(o.route);
    const lines: string[] = [];
    const code = await runStartersCli(["--out", join(dir, "archive"), "--date", "2026-10-24"], { BB_ARCHIVER_CONTACT: CONTACT, ...(o.env ?? {}) }, {
      fetchImpl: o.fetchImpl ?? t.fetchImpl,
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
  const up = await startersCli({ route: () => refused() });
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
  // 연속 한도 1(재시도 슬롯 · 앞선 받기 실패 뒤의 자식)이면 한 번의 소진으로 열린다 → 69(부모가 뒤 받기를 멈춘다)
  const open = await startersCli({ route: () => 503, env: { BB_NPB_CIRCUIT_N: "1" } });
  assert.equal(open.code, EXIT_UPSTREAM_CIRCUIT_OPEN, open.log);
});

/**
 * ⚠⚠**User-Agent 로 못 쓰는 문자가 든 연락처는 요청 0 · 종료 2 · 로그에 연락처 없음**(3중 검토 ③ · 설계 D1 ⑶).
 * 예전에는 내부 CR/LF 가 든 연락처가 undici 의 헤더 검증에서 `TypeError` 가 됐고, 그것이 「네트워크」로 분류돼 4번 재시도한 뒤
 * **75(배포)** 가 됐다 — 그 오류 메시지는 UA(= 연락처)를 그대로 로그에 실었다.
 */
/**
 * ⚠**예약 도메인 연락처의 거부 메시지도 입력값을 되찍지 않는다**(반영분 재검토 P3) — 예전에는 `…(CLAUDE.md L1): <연락처>` 로 원문을 실었다.
 * 빈 값(공백뿐)도 같이 본다 — 연락처 검증 메시지 셋(빈 값 · 예약 도메인 · 쓸 수 없는 문자)이 전부 원문을 싣지 않는다.
 */
test("⚠cli-starters — 예약 도메인 연락처(메일·URL)·공백뿐인 연락처는 요청 0 · 종료 2 · 로그에 입력값 없음", async () => {
  for (const contact of ["audit-canary@example.com", "https://example.com/audit-canary-path", "audit-canary@foo.test", "   "]) {
    const r = await startersCli({ env: { BB_ARCHIVER_CONTACT: contact } });
    assert.equal(r.code, 2, `${JSON.stringify(contact)}: ${r.log}`);
    assert.equal(r.calls.length, 0, "요청이 나갔다");
    assert.equal(r.log.includes("audit-canary"), false, `로그에 연락처가 남았다: ${r.log}`);
  }
});

test("⚠⚠cli-starters — CR/LF·비 latin1 연락처는 요청 0 · 종료 2 · 로그에 연락처 없음", async () => {
  for (const contact of ["canary-contact@lunomel.jp\r\nX-Injected: 1", "canary-contact@lunomel.jp\nX-Injected: 1", "canary-연락처@lunomel.jp"]) {
    const r = await startersCli({ env: { BB_ARCHIVER_CONTACT: contact } });
    assert.equal(r.code, 2, `${JSON.stringify(contact)}: ${r.log}`);
    assert.equal(r.calls.length, 0, "요청이 나갔다");
    assert.equal(r.log.includes("canary"), false, `로그에 연락처가 남았다: ${r.log}`);
    assert.equal(r.log.includes("X-Injected"), false);
  }
});

test("⚠⚠cli-starters — 전송이 cause 없는 TypeError(로컬 고장)를 던지면 요청 1 · 재시도 0 · 종료 1(75 아님) · 로그에 UA·연락처 없음 / ECONNREFUSED·연결 시간 초과는 그대로 상류(75)", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push(url);
    // undici 헤더 검증 오류의 모양 — 메시지에 헤더 값(= UA = 연락처)을 싣는다
    throw new TypeError(`Headers.append: "${init.headers["User-Agent"] ?? ""}" is an invalid header value.`);
  };
  const local = await startersCli({ fetchImpl });
  assert.equal(local.code, 1, local.log);
  assert.equal(calls.length, 1, "로컬 고장을 재시도했다");
  assert.equal(local.log.includes(CONTACT), false, `로그에 연락처가 남았다: ${local.log}`);
  assert.match(local.log, /로컬 오류/);

  const timeout = await startersCli({
    route: () => new TypeError("fetch failed", { cause: new undiciErrors.ConnectTimeoutError("Connect Timeout Error (attempted address: npb.jp:443, timeout: 30000ms)") }),
  });
  assert.equal(timeout.code, EXIT_UPSTREAM_ONLY, timeout.log);
  assert.equal(timeout.calls.length, 4, "연결 시간 초과는 재시도 대상이다");
  const conn = await startersCli({ route: () => refused() });
  assert.equal(conn.code, EXIT_UPSTREAM_ONLY, conn.log);
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
