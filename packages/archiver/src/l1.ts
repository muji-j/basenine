/**
 * **요청 간격의 하한(CLAUDE.md L1) — 술어 한 벌.** `PoliteFetcher` 생성자 · 받기 CLI 들의 `--delay` · `scripts/update.ts` 의
 * 받기 자식 사이 간격(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D4 · 2026-10-24 3중 검토 반영)이
 * 전부 이것을 쓴다(M1). `fetcher.ts` 가 다시 내보내므로 기존 import 는 그대로다.
 *
 * ⚠**import 0개인 잎이다** — `scripts/update.ts` 가 가져온다. `fetcher.ts` 를 가져오면 undici 까지 끌려와, 그 로드 실패가
 *   자식을 하나도 못 띄운 채 부모를 죽인다(`run-verdict.ts` 가 잎만 가져오는 것과 같은 이유 · I1).
 */

/**
 * L1 의 하한 — 「1req / 2~5초」의 아래쪽. **이 아래로는 만들 수 없다.**
 *
 * ⚠**초판은 이것을 「경고에만 쓴다」고 적었고 그 근거가 틀렸다**(2026-09-05 정정).
 * 근거는 「픽스처 시험이 `minDelayMs: 0` 을 쓴다」였는데, **실측하니 그 시험은 값이 몇이든
 * 결과가 같다** — `sleep` 을 즉시 반환하는 목으로 주입하기 때문이다(`mark-seen.test.ts` 의
 * `0` 을 `999999` 로 바꿔도 4본이 그대로 통과한다). **시험을 빠르게 만드는 것은 `sleep` 목이지
 * 작은 `minDelayMs` 가 아니었다.** 실제로 요청을 보내는 시험 13곳이 **전부** `fetchImpl` 과
 * `sleep` 을 함께 주입한다 — **예외를 둘 이유가 애초에 없었다.**
 */
export const L1_MIN_DELAY_MS = 2000;

/**
 * 유효한 요청 간격인가. ⚠**생성자와 진입점이 같은 술어를 쓴다**(M1) —
 * 두 벌로 두면 한쪽만 고쳐진 채로 남고, 그 한쪽이 실제로 나가는 요청을 정한다.
 *
 * ⚠**`NaN` 만 막는 것으로는 부족했다.** `500` 은 수이고 음수도 아니라 통과했고, 진입점은
 * **경고 한 줄만 찍고 그대로 실사이트를 쳤다.** 오타로 인한 조용한 위반과 **결이 다를 뿐
 * 정도만 다른 같은 범주의 구멍**이다.
 * ⚠**이걸 「실측」으로 배웠다**: 이 하한을 넣기 전에 `--delay 500` 을 스폰하는 시험을 쓰자
 * **222페이지를 0.583초 간격으로 실제로 받아 버렸다**(우리 사이드카의 `fetchedAt` 실측).
 *
 * ⚠**「시험이면 봐 준다」를 만들지 않았다.** `fetchImpl` 주입 여부로 가르는 안이 있었는데,
 * 그러면 **예의의 보장이 「전송 수단을 갈아 끼웠는가」에 딸려 간다** — 제품 코드가 계측이나
 * 프록시로 `fetchImpl` 을 감싸는 순간 하한이 조용히 사라진다. **방금 고친 결함의 잠복형이다.**
 * → **예외 없는 한 줄 규칙**이고 우회할 것이 없다.
 * ⚠**`PoliteFetcher` 가 무례하게 설정될 수 있으면 이름이 거짓이다.**
 */
export function isValidDelayMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= L1_MIN_DELAY_MS;
}

/**
 * 진입점의 `--delay` 문자열을 간격으로. **못 읽으면 `null`.**
 *
 * ⚠**`Number()` 를 그대로 쓰지 마라** — `Number("abc")` 는 `NaN` 인데 **`NaN` 은 nullish 가
 * 아니라서** `minDelayMs ?? 3000` 을 통과하고, `elapsed < NaN` 이 항상 false 라 **간격이
 * 0이 된다.** 던지지도 로그를 남기지도 않는다(실측: 연속 3요청에 sleep 0회).
 * ⚠**「안 줬다」와 「못 읽었다」를 여기서 구별하지 않는다** — 둘 다 `null` 이고,
 * 기본값을 고르는 것은 진입점의 일이다(`parseArgs` 의 `default`).
 */
export function parseDelayMs(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const ms = Number(raw);
  return isValidDelayMs(ms) ? ms : null;
}
