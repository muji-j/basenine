/**
 * 정정 자동 재수집의 **요청·시간 상한을 코드의 상수로 다시 셈한다**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md`
 * D7-3 · D7-8 · D12 · 시험 T13 · 순수 산수).
 *
 * ⚠**상수는 전부 코드에서 읽는다** — `MAX_REDIRECTS`(fetcher) · `--delay` 기본값(cli-games) · `refetch-limit.ts` 의 자동 상한 ·
 *   경기 페이지 수(`GAME_PAGES`) · 잡 시간 제한(`daily.yml` 의 `collect`). 어느 하나가 바뀌면 아래 합이 다시 셈해지고,
 *   설계의 계산(한 경기 최악 32전송 · 예산 128 · 잡 최악 43.06분)과 어긋나는 순간 붉어진다.
 * ⚠**실측 입력은 상수가 아니다** — 출처와 함께 여기 적는다. 실측이 바뀌면 출처를 고치며 같이 고친다(설계 §7 「뒤집힐 조건」).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTO_REFETCH_MAX_DEFECTS,
  AUTO_REFETCH_MAX_GAMES,
  AUTO_REFETCH_MAX_HTTP,
  AUTO_REFETCH_MAX_RETRIES,
  AUTO_REFETCH_REQUEST_TIMEOUT_MS,
  AUTO_REFETCH_START_DEADLINE_MIN,
  MAX_REFETCH_DATES,
} from "@bb-app/store/refetch-limit";
import { CLI_GAMES_DEFAULT_DELAY_MS } from "../../packages/archiver/src/cli-games.ts";
import { GAME_PAGES } from "../../packages/archiver/src/discover.ts";
import { MAX_REDIRECTS } from "../../packages/archiver/src/fetcher.ts";
import { WORST_HTTP_PER_GAME } from "../../packages/archiver/src/refetch-games.ts";

/**
 * 실측 입력(분) — 설계 §3 표.
 * - `afterStep` — **M-J 최장 11.43분**: 새 단계 자리(`수집 후 재검증` 시작) → 잡 끝. 성공한 3실행(`36233588490` · `36312303843` ·
 *   `36480899578` 중 최장 · 깊은 시험 포함).
 * - `reload` — **M-L 최장 102.8초**: 전체 재적재(`load-archive.ts`) · 실행 `36965884701`(분모 2 · 다른 하나는 `36480899578` 의 87.5초).
 * - `detectReport` — **M-M 약 0.43초 + 보고·이력 파일 쓰기 → 0.05분**: 사후 감지(외부 대조 한 시즌) · 실행 `36965884701`.
 */
const MEASURED_MIN = { afterStep: 11.43, reload: 102.8 / 60, detectReport: 0.05 } as const;
/** 여유 하한(설계 T13 ⑶) — 잡 시간 제한에서 이만큼은 남아야 한다 */
const MARGIN_FLOOR_MIN = 1.5;

/** `collect` 잡의 시간 제한 — 워크플로에서 읽는다(숫자를 여기 복사하지 않는다) */
function collectJobTimeoutMin(): number {
  const yml = readFileSync(fileURLToPath(new URL("../../.github/workflows/daily.yml", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const at = yml.indexOf("\n  collect:\n");
  assert.notEqual(at, -1, "daily.yml 에 collect 잡이 없다 — 이 시험의 전제가 바뀌었다");
  // 잡 머리 = 잡 이름 줄부터 `steps:` 앞까지(잡 수준 키만 · 단계의 timeout-minutes 는 안 본다)
  const head = yml.slice(at, yml.indexOf("\n    steps:", at));
  const m = /\n {4}timeout-minutes: (\d+)(?=\n|$)/.exec(head);
  assert.ok(m, "collect 잡 머리에 timeout-minutes 가 없다");
  return Number(m[1]);
}

/** 설계 D7-8 의 한 경기 최악(초) — 전송 · 시도 · 페이지 · 경기 */
function worstGame(): { transmissionS: number; attemptS: number; backoffS: number; pageS: number; gameS: number } {
  const attempts = AUTO_REFETCH_MAX_RETRIES + 1;
  // 전송 하나 = 앞 간격 대기(≤ minDelayMs) + 전송 자체(≤ 시간 상한)
  const transmissionS = (CLI_GAMES_DEFAULT_DELAY_MS + AUTO_REFETCH_REQUEST_TIMEOUT_MS) / 1000;
  // 시도 하나 = 첫 전송 + 같은 출처 리디렉트 MAX_REDIRECTS 홉
  const attemptS = (1 + MAX_REDIRECTS) * transmissionS;
  // 백오프 = minDelayMs × 2^시도 — 마지막 시도 뒤에도 잔다(fetcher.ts · 설계 M-R)
  let backoffMs = 0;
  for (let a = 0; a < attempts; a += 1) backoffMs += CLI_GAMES_DEFAULT_DELAY_MS * 2 ** a;
  const backoffS = backoffMs / 1000;
  const pageS = attempts * attemptS + backoffS;
  return { transmissionS, attemptS, backoffS, pageS, gameS: GAME_PAGES.length * pageS };
}

test("⚠T13⑴ 한 경기 최악 전송 = 4장 × (재시도 + 1) × (1 + 리디렉트 홉) = 32 — 코드의 식과 같다", () => {
  const worst = GAME_PAGES.length * (AUTO_REFETCH_MAX_RETRIES + 1) * (1 + MAX_REDIRECTS);
  assert.equal(worst, 32, `한 경기 최악이 ${String(worst)}전송이다 — 예산·시간 계산(설계 D7-4 · D7-8)을 다시 내라`);
  assert.equal(WORST_HTTP_PER_GAME, worst, "refetch-games.ts 의 시작 전 예산 검사가 다른 식을 쓴다");
});

test("⚠T13⑵ HTTP 예산 = 정상 24경기(96) + 한 경기 최악(32) = 128", () => {
  const normal = GAME_PAGES.length * AUTO_REFETCH_MAX_GAMES;
  assert.equal(normal, 96, "정상 경로의 논리 페이지 상한(설계 D7-7)");
  assert.equal(AUTO_REFETCH_MAX_HTTP, normal + WORST_HTTP_PER_GAME);
  assert.equal(AUTO_REFETCH_MAX_HTTP, 128);
  // 정상이면 24번째 경기 앞에서 92 + 32 ≤ 128 이라 24경기가 다 돈다(설계 D7-4)
  assert.ok(GAME_PAGES.length * (AUTO_REFETCH_MAX_GAMES - 1) + WORST_HTTP_PER_GAME <= AUTO_REFETCH_MAX_HTTP);
});

test("⚠T13⑶ 잡 최악 = 마감 + 한 경기 최악 + 재적재 + 감지·보고 + 이후 단계 ≤ 잡 시간 제한 − 여유 하한 1.5분", () => {
  const w = worstGame();
  // 설계 D7-8 표가 코드와 맞는다 — 어느 상수를 키워도 여기서 붉어진다
  assert.deepEqual(
    { transmissionS: w.transmissionS, attemptS: w.attemptS, backoffS: w.backoffS, pageS: w.pageS, gameS: w.gameS },
    { transmissionS: 8, attemptS: 32, backoffS: 9, pageS: 73, gameS: 292 },
    "설계 D7-8 의 한 경기 최악(전송 8초 · 시도 32초 · 페이지 73초 · 경기 292초)과 코드가 어긋난다",
  );
  const jobLimit = collectJobTimeoutMin();
  assert.equal(jobLimit, 45, "collect 잡 시간 제한이 45분이 아니다 — 마감 25분을 다시 내라(설계 D7-8)");
  const total = AUTO_REFETCH_START_DEADLINE_MIN + w.gameS / 60 + MEASURED_MIN.reload + MEASURED_MIN.detectReport + MEASURED_MIN.afterStep;
  assert.ok(
    total <= jobLimit - MARGIN_FLOOR_MIN,
    `잡 최악 ${total.toFixed(2)}분 > ${String(jobLimit)} − ${String(MARGIN_FLOOR_MIN)} — 여유가 ${(jobLimit - total).toFixed(2)}분뿐이다`,
  );
  assert.equal(total.toFixed(2), "43.06", "설계 D7-8 의 합(43.06분)과 다르다 — 설계와 이 시험을 같이 고쳐라");
});

test("T13 나머지 상한 — 날짜 7(수동·자동이 나눠 쓴다) · 결함 20 · 시간 상한은 실측 최대 전송 시간(0.191초)의 26배", () => {
  assert.equal(MAX_REFETCH_DATES, 7);
  assert.equal(AUTO_REFETCH_MAX_DEFECTS, 20);
  // 설계 M-Q: 연속 요청 145간격에서 3초 간격 위의 전송 시간 최대 0.191초
  assert.equal(Math.floor(AUTO_REFETCH_REQUEST_TIMEOUT_MS / 191), 26);
});
