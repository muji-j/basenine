/**
 * 호스트 회로 차단(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · 시험 T5).
 *
 * ⚠**가짜 `fetchImpl`·`sleep`·시계만 쓴다 — 외부 요청 0.**
 * ⚠**「열린 뒤 요청 0」은 가짜 `fetchImpl` 의 호출 수로 잰다** — 메시지만 보면 요청을 보내고도 circuit-open 을 던지는 변이가 산다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as circuitModule from "../src/circuit.ts";
import { CIRCUIT_CONSECUTIVE_DEFAULT, CIRCUIT_ENV, CIRCUIT_TOTAL_LIMIT, HostCircuit, parseCircuitN } from "../src/circuit.ts";
import { PoliteFetcher } from "../src/fetcher.ts";
import type { FetchImpl } from "../src/fetcher.ts";
import { UpstreamError } from "../src/upstream.ts";

const T0 = "2026-10-24T00:26:00.000Z";
const fixed = { now: () => new Date(T0) };

function respond(status: number, location?: string) {
  return {
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? (location ?? null) : null) },
    arrayBuffer: async () => new ArrayBuffer(2),
  };
}

/** `plan` 은 URL 별 상태(또는 오류). 호출 수를 센다 */
function rig(plan: (url: string) => number | Error, circuit?: HostCircuit) {
  const calls: string[] = [];
  const impl: FetchImpl = async (url) => {
    calls.push(url);
    const p = plan(url);
    if (p instanceof Error) throw p;
    return respond(p, p >= 300 && p < 400 ? "https://elsewhere.example.net/" : undefined);
  };
  const fetcher = new PoliteFetcher({
    userAgent: "bb-test",
    clock: fixed,
    fetchImpl: impl,
    sleep: async () => undefined,
    ...(circuit === undefined ? {} : { circuit }),
  });
  return { fetcher, calls };
}

const u = (n: number): string => `https://npb.jp/p/${String(n)}.html`;

async function settle(fetcher: PoliteFetcher, url: string): Promise<string> {
  try {
    const r = await fetcher.get(url);
    return String(r.status);
  } catch (e) {
    assert.ok(e instanceof UpstreamError, `UpstreamError 가 아니다: ${String(e)}`);
    return e.kind;
  }
}

// ---- 상수 · 입력 -----------------------------------------------------------

test("T5 상수 — 연속 기본 3 · 합계 6 · env 이름 · 즉시 열림 집합은 없다(3중 검토 반영)", () => {
  assert.equal(CIRCUIT_CONSECUTIVE_DEFAULT, 3);
  assert.equal(CIRCUIT_TOTAL_LIMIT, 6);
  assert.equal(CIRCUIT_ENV, "BB_NPB_CIRCUIT_N");
  assert.equal("CIRCUIT_IMMEDIATE_STATUSES" in circuitModule, false, "즉시 열림 집합이 되살아났다 — 한 페이지의 403 이 형제 받기를 막는다");
});

test("⚠T5 parseCircuitN — 안 주면 3 · 1~6 정수만 · 못 읽으면 null(호출자가 요청 0 으로 멈춘다)", () => {
  assert.equal(parseCircuitN(undefined), 3, "안 줬으면 기본값");
  assert.equal(parseCircuitN("1"), 1);
  assert.equal(parseCircuitN("3"), 3);
  assert.equal(parseCircuitN("6"), 6);
  for (const bad of ["", " ", "0", "7", "-1", "1.5", "3 ", "abc", "Infinity", "NaN", "01", "1e0"]) {
    assert.equal(parseCircuitN(bad), null, `${JSON.stringify(bad)} 를 받았다`);
  }
});

test("T5 HostCircuit 생성 — 범위 밖의 N 은 던진다", () => {
  for (const n of [0, 7, 1.5, Number.NaN]) assert.throws(() => new HostCircuit({ clock: fixed, consecutive: n }), RangeError, String(n));
});

// ---- HostCircuit 단위 --------------------------------------------------------

test("⚠T5 연속 3 이면 열린다 — 성공은 연속만 리셋하고 합계는 그대로다", () => {
  const c = new HostCircuit({ clock: fixed });
  c.failure();
  c.failure();
  assert.equal(c.isOpen, false);
  c.success();
  assert.deepEqual([c.snapshot().consecutive, c.snapshot().total], [0, 2], "성공이 연속을 리셋하지 않았다(또는 합계를 지웠다)");
  c.failure();
  c.failure();
  assert.equal(c.isOpen, false);
  c.failure();
  assert.equal(c.isOpen, true, "연속 3 에서 안 열렸다");
  assert.equal(c.snapshot().reason, "consecutive");
  assert.equal(c.snapshot().openedAt, T0, "열린 시각은 주입한 시계다(M6)");
});

test("⚠T5 간헐 장애 — 연속이 매번 끊겨도 합계 6 에서 열린다", () => {
  const c = new HostCircuit({ clock: fixed });
  for (let i = 0; i < 5; i += 1) {
    c.failure();
    c.success();
  }
  assert.equal(c.isOpen, false, "합계 5 에서 열렸다");
  c.failure();
  assert.equal(c.isOpen, true, "합계 6 에서 안 열렸다");
  assert.equal(c.snapshot().reason, "total");
});

test("⚠T5 N=1(재시도 슬롯) — 첫 소진에서 열린다", () => {
  const c = new HostCircuit({ clock: fixed, consecutive: 1 });
  c.failure();
  assert.equal(c.isOpen, true);
});

/**
 * ⚠⚠**즉시 열림을 없앴다**(2026-10-24 · 3중 검토 2차 F1). 401·403·451 도 소진과 같이 연속 +1 · 합계 +1 이다 —
 * 의도적 차단이면 모든 페이지가 같은 응답이라 연속 3(재시도 슬롯 1)에서 곧 열리고, **한 페이지만의 403(자원 단위)은 회로를 안 연다.**
 */
test("⚠T5 401·403·451 도 한 번으로는 안 열린다 — 연속 3 이면 연다", () => {
  for (const s of [401, 403, 451]) {
    const c = new HostCircuit({ clock: fixed });
    c.failure();
    assert.equal(c.isOpen, false, `${String(s)} 한 번에 열렸다`);
    c.failure();
    c.failure();
    assert.equal(c.isOpen, true);
    assert.equal(c.snapshot().reason, "consecutive");
  }
});

// ---- fetcher 안에서 — 요청 수로 잰다 ------------------------------------------

test("⚠T5 fetcher — 연속 3 소진 뒤의 get 은 요청 0 으로 circuit-open · 가짜 fetchImpl 호출 0", async () => {
  const { fetcher, calls } = rig(() => 503);
  for (let i = 1; i <= 3; i += 1) assert.equal(await settle(fetcher, u(i)), "http-503");
  assert.equal(calls.length, 12, "3 URL × 4시도");
  for (let i = 4; i <= 6; i += 1) assert.equal(await settle(fetcher, u(i)), "circuit-open");
  assert.equal(calls.length, 12, "열린 뒤에 요청이 나갔다");
});

test("⚠T5 fetcher — 404·410 은 성공으로 센다(연속 리셋) · 그래서 사이에 끼면 안 열린다", async () => {
  const statuses = [503, 503, 404, 503, 503, 410, 503];
  let i = 0;
  const { fetcher, calls } = rig(() => statuses[Math.min(i, statuses.length - 1)]!);
  const seen: string[] = [];
  for (let k = 0; k < statuses.length; k += 1) {
    const before = calls.length;
    seen.push(await settle(fetcher, u(k)));
    i += 1;
    assert.ok(calls.length > before, `${String(k)}번째 get 이 요청 없이 끝났다 — 회로가 열렸다`);
  }
  assert.deepEqual(seen, ["http-503", "http-503", "404", "http-503", "http-503", "410", "http-503"]);
});

test("⚠T5 fetcher — 간헐 장애도 합계 6 에서 열린다(요청 수 상한)", async () => {
  let n = 0;
  const { fetcher, calls } = rig(() => {
    n += 1;
    return n % 5 === 0 ? 200 : 503; // 503 4회(소진 1건) 뒤 200 한 번 — 연속은 매번 1 에서 끊긴다
  });
  const seen: string[] = [];
  for (let k = 0; k < 20; k += 1) seen.push(await settle(fetcher, u(k)));
  const exhausted = seen.filter((s) => s === "http-503").length;
  assert.equal(exhausted, 6, `합계 소진이 ${String(exhausted)}건이다 — 6 에서 열려야 한다: ${seen.join(",")}`);
  assert.equal(seen.at(-1), "circuit-open");
  const afterOpen = seen.indexOf("circuit-open");
  const callsAtOpen = calls.length;
  for (let k = 0; k < 3; k += 1) await settle(fetcher, u(100 + k));
  assert.equal(calls.length, callsAtOpen, "열린 뒤에 요청이 나갔다");
  assert.ok(afterOpen > 0);
});

test("⚠T5 fetcher — N=1 이면 첫 소진 뒤 요청 0", async () => {
  // ⚠네트워크 오류는 `cause` 의 코드로 온다 — cause 없는 TypeError 는 이제 로컬 오류다(3중 검토 반영)
  const refused = (): Error => new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  const { fetcher, calls } = rig(() => refused(), new HostCircuit({ clock: fixed, consecutive: 1 }));
  assert.equal(await settle(fetcher, u(1)), "network");
  assert.equal(calls.length, 4);
  assert.equal(await settle(fetcher, u(2)), "circuit-open");
  assert.equal(calls.length, 4);
});

test("⚠T5 fetcher — 비재시도 4xx 와 3xx 종결도 +1 로 센다 — 셋이면 열린다", async () => {
  const plan = [400, 302, 405];
  let i = 0;
  const { fetcher, calls } = rig(() => plan[i++] ?? 200);
  assert.deepEqual([await settle(fetcher, u(1)), await settle(fetcher, u(2)), await settle(fetcher, u(3))], ["http-400", "http-302", "http-405"]);
  assert.equal(calls.length, 3, "재시도하지 않는다");
  assert.equal(await settle(fetcher, u(4)), "circuit-open");
  assert.equal(calls.length, 3);
});

test("⚠T5 fetcher — 403 한 번으로는 안 열린다(그 페이지만의 거절) · 모든 페이지가 403 이면 셋째에서 연다", async () => {
  // 한 페이지만 403 — 형제 페이지는 그대로 받는다(2차 F1 의 예고 단독 403 시나리오)
  const one = rig((url) => (url === u(1) ? 403 : 200));
  assert.deepEqual([await settle(one.fetcher, u(1)), await settle(one.fetcher, u(2)), await settle(one.fetcher, u(3))], ["http-403", "200", "200"]);
  assert.equal(one.fetcher.circuit.isOpen, false);
  // 의도적 차단 — 전부 403
  const all = rig(() => 403);
  for (let i = 1; i <= 3; i += 1) assert.equal(await settle(all.fetcher, u(i)), "http-403");
  assert.equal(await settle(all.fetcher, u(4)), "circuit-open");
  assert.equal(all.calls.length, 3);
});

test("⚠T5 기본값 — circuit 을 안 줘도 연속 3 에서 열린다(정정 경로·연 1회 도구도 같은 회로를 받는다 · 설계 D1)", async () => {
  const { fetcher, calls } = rig(() => 500);
  for (let i = 1; i <= 3; i += 1) await settle(fetcher, u(i));
  assert.equal(await settle(fetcher, u(4)), "circuit-open");
  assert.equal(calls.length, 12);
});
