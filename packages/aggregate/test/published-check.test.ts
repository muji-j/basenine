/**
 * **공표치 대조의 판정 규칙 자체를 픽스처로 못 박는다**(`published.ts`).
 *
 * ⚠**이 규칙은 실DB 시험 두 본의 「무엇을 결함이라 부르는가」를 정한다.** 그런데 그 두 본은
 * DB 상태에 따라 어떤 갈래를 **한 번도 안 밟을 수 있다** — 실측(2026-08-20 로컬 08-16 스냅샷)에서
 * `ahead`·`behind`·`behindSettled` 가 **전부 0건**이었다. 즉 규칙이 뒤집혀 있어도 그날은 초록이다.
 * 여기서 네 갈래를 전부 손으로 밟아 그 상태를 막는다(작업규칙 8·9).
 *
 * ⚠**DB 를 읽지 않는다** — 순수 함수 시험이라 어느 머신에서나 같은 답이 나온다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossCheck } from "./published.ts";
import type { PublishedSample, Sample } from "./published.ts";

/** 2025 는 완결(마지막 경기 10-30) · 2026 은 진행 중이라 표에 없다 */
const SETTLED = new Map<number, string>([[2025, "2025-10-30"]]);

function ours(entries: readonly [string, number, string][]): Map<string, Sample> {
  return new Map(entries.map(([k, volume, value]) => [k, { volume, value }]));
}

function pub(o: Partial<PublishedSample> & { year: number; playerId: string }): PublishedSample {
  return { volume: 10, value: "x", fetchedAt: "2026-08-20T00:00:00.000Z", ...o };
}

test("출장량이 같으면 값을 맞댄다 — 같으면 통과, 다르면 결함", () => {
  const mine = ours([["2025|A", 10, "3勝2敗"], ["2025|B", 10, "3勝2敗"]]);
  const got = crossCheck(
    mine,
    [
      pub({ year: 2025, playerId: "A", volume: 10, value: "3勝2敗" }),
      pub({ year: 2025, playerId: "B", volume: 10, value: "4勝2敗" }),
    ],
    SETTLED,
    "試合",
  );
  assert.equal(got.compared, 2, "출장량이 같은 두 명을 다 재지 않았다");
  assert.equal(got.mismatches.length, 1, `값이 다른 1명을 못 잡았다: ${JSON.stringify(got)}`);
  assert.match(got.mismatches[0]!, /2025 B/);
  assert.deepEqual([got.ahead.length, got.behind.length, got.behindSettled.length], [0, 0, 0]);
});

test("⚠공표가 우리보다 앞서면 「우리가 경기를 놓쳤다」다 — 기준일로 설명되지 않는다", () => {
  const got = crossCheck(ours([["2026|A", 9, "x"]]), [pub({ year: 2026, playerId: "A", volume: 10 })], SETTLED, "試合");
  assert.equal(got.ahead.length, 1, "공표가 앞서는 것을 못 잡았다");
  assert.equal(got.compared, 0, "값을 맞대면 안 된다 — 같은 경기를 본 것이 아니다");
  assert.deepEqual([got.behind.length, got.behindSettled.length], [0, 0]);
});

test("진행 중 시즌에서 공표가 낡은 것은 미대조다 — 결함이 아니다", () => {
  const got = crossCheck(ours([["2026|A", 11, "x"]]), [pub({ year: 2026, playerId: "A", volume: 10 })], SETTLED, "試合");
  assert.equal(got.behind.length, 1, "기준일 차이를 미대조로 세지 않았다");
  assert.equal(got.behindSettled.length, 0, "진행 중 시즌을 결함으로 잡았다");
  assert.equal(got.compared, 0);
});

test("⚠시즌이 끝난 **뒤에 받은** 사본이 낡았으면 결함이다", () => {
  const got = crossCheck(
    ours([["2025|A", 11, "x"]]),
    // 2025 최종전은 10-30 이고 이 사본은 이듬해 8월에 받았다 — 더 늘 것이 없었어야 한다
    [pub({ year: 2025, playerId: "A", volume: 10, fetchedAt: "2026-08-20T00:00:00.000Z" })],
    SETTLED,
    "試合",
  );
  assert.equal(got.behindSettled.length, 1, "완결 시즌의 낡은 사본을 결함으로 잡지 않았다");
  assert.equal(got.behind.length, 0);
});

/**
 * ⚠**이 갈래가 이 파일이 생긴 이유다**(2026-08-20).
 *
 * 시즌이 끝나면 그 시즌은 완결이 되지만, **그때 우리가 든 사본은 시즌 중에 받은 것일 수 있다.**
 * 선수 페이지는 경기 다음날 새벽에도 아직 그 경기를 안 싣는다(실측: 08-19 01:05 JST 취득분이
 * 08-18 경기를 안 담았다) — 그래서 최종일에 뛴 선수는 **그 경기가 빠진 사본**으로 시즌을 마친다.
 * 취득 시각을 안 보면 **10월에 CI 가 그들 전원을 결함이라고 부르며 배포를 막는다.**
 * ⚠**선정식은 그 뒤 고쳤다**(`store/tools/emit-stale-player-ids.ts` · 2026-08-20 · 이제
 * 출장량이 모자란가로 판정한다). 그래도 이 갈래는 남는다 — 다시 받히기 **전까지의 창**과
 * 페이지가 사라져 못 고치는 선수가 있기 때문이다.
 */
test("⚠시즌 중에 받은 사본은 완결 시즌이어도 결함이 아니다 — 10월에 CI 를 멈추지 않는다", () => {
  const got = crossCheck(
    ours([["2025|A", 11, "x"]]),
    // 최종전(10-30) 다음날 아침에 받은 사본 — 그날 경기는 아직 안 실려 있다
    [pub({ year: 2025, playerId: "A", volume: 10, fetchedAt: "2025-10-30T22:00:00.000Z" })],
    SETTLED,
    "試合",
  );
  assert.equal(got.behindSettled.length, 0, "시즌 중에 받은 사본을 결함으로 잡았다 — 10월마다 배포가 막힌다");
  assert.equal(got.behind.length, 1, "미대조로도 안 셌다 — 「0건」과 「안 쟀음」이 섞인다");
});

test("⚠취득 시각을 모르면 결함이라고 말하지 않는다 — 「모름」은 「오늘」이 아니다(M11)", () => {
  const got = crossCheck(
    ours([["2025|A", 11, "x"]]),
    [pub({ year: 2025, playerId: "A", volume: 10, fetchedAt: null })],
    SETTLED,
    "試合",
  );
  assert.equal(got.behindSettled.length, 0, "취득 시각을 모르는데 결함이라고 단정했다");
  assert.equal(got.behind.length, 1);
  assert.match(got.behind[0]!, /모름/, "무엇을 몰랐는지 보고에 안 남겼다");
});

test("우리에게 없는 선수-시즌은 대조 대상이 아니다 — 보유 시즌 밖이다", () => {
  const got = crossCheck(new Map(), [pub({ year: 2017, playerId: "A" })], SETTLED, "試合");
  assert.deepEqual(
    [got.compared, got.mismatches.length, got.ahead.length, got.behind.length, got.behindSettled.length],
    [0, 0, 0, 0, 0],
  );
});

test("시즌별 대조 수를 따로 센다 — 한 시즌에 쏠린 것을 알아채기 위해서다", () => {
  const got = crossCheck(
    ours([["2025|A", 10, "x"], ["2026|B", 10, "x"], ["2026|C", 10, "x"]]),
    [
      pub({ year: 2025, playerId: "A" }),
      pub({ year: 2026, playerId: "B" }),
      pub({ year: 2026, playerId: "C" }),
    ],
    SETTLED,
    "試合",
  );
  assert.equal(got.compared, 3);
  assert.deepEqual([...got.bySeason].sort(), [[2025, 1], [2026, 2]]);
});
