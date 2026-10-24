/**
 * **문서와 고정 수치 시험이 「완결 시즌」이라고 부르는 범위** — 손으로 고정한다(2026-10-24).
 *
 * ## 왜 데이터로 판정하지 않고 고정하는가
 *
 * 예전에는 시험마다 「12구단 전부가 `regularSeasonGames(시즌)` 을 치렀는가」로 완결 시즌을 **그때그때** 쟀다.
 * 그 판정이 **시험 쪽에만 다섯 벌**(문서 수치 · 走塁 · 우승 경쟁 · 파크팩터 · 주자 순서)이었고
 * 제품의 `seasonIsOver` 까지 여섯 벌이었다(M1) — 그리고 다섯 벌 모두 **정규시즌이 끝나는 날 2026 을 범위에 넣었다.**
 * 그날(2026-10-08) 문서에 박힌 2018〜2025 수치와 시험이 같이 갈려 **13본이 붉어졌고 배포가 그대로 막혔다.**
 * 게다가 그 수치 중 일부는 **전 대회** 수(타석 등)라 포스트시즌 동안 **매일** 다시 낡는다.
 * → 「문서가 어느 시즌의 수를 말하는가」는 **사람이 정하는 사실**이므로 한 곳에 적는다.
 *
 * ## ⚠「최근 시즌을 뺀다」가 아니다 — 원저자 경고를 이 장치가 지킨다
 *
 * `scripts/test/doc-figures.test.ts` 의 원저자가 「최근 시즌을 뺀다로 쓰지 마라 — 영원히 빠진다」고 경고했다.
 * 손으로 적은 목록도 **잊으면 영원히 낡는다** — 이 저장소는 「2023~2026 4시즌」 같은 낡은 서술이 판정 기준 노릇을 하던 사고를 이미 겪었다.
 * → 그래서 **끝난 시즌이 이 범위 밖에 있으면 수집이 매 실행 `::warning::` 으로 알린다**(`docSeasonsToAdd` · `scripts/freshness.ts`).
 *   ⚠**배포는 막지 않는다** — 막으면 그것이 바로 2026-10-08 의 사고다. 범위를 올리는 절차는 `docs/operations.md` 「해마다 하는 일」.
 * ⚠**「끝났다」는 `seasonIsOver`(일본시리즈 결착 · 또는 더 나중 시즌의 경기)다 — 정규시즌 종료가 아니다.**
 *   고정 수치 일부가 전 대회 수라 그때까지 자란다. 너무 일찍 올리면 `doc-figures.test.ts` 의 가드가 막는다.
 *
 * ## 왜 제품 코드(`@bb-app/domain`)에 두는가
 *
 * ⑴ **알림이 제품 파이프라인에서 돈다**(`scripts/freshness.ts`) — 제품 코드가 시험 파일을 import 할 수는 없다.
 * ⑵ 이 범위로 세는 시험이 **세 패키지·두 층**에 흩어져 있다(`packages/aggregate/test` · `packages/metrics/test` · `scripts/test`) —
 *    시험 폴더끼리 상대 경로로 엮으면 패키지 경계를 넘는다.
 * ⑶ `@bb-app/domain` 은 의존성이 없고, 같은 성질의 **손으로 유지하는 시즌 표**(`regularSeasonGames`)가 이미 여기 있다.
 * ⚠**화면·집계는 이 값을 쓰지 않는다** — 화면이 「완결」을 물을 때는 `seasonIsOver` 한 벌이다. 이것은 「문서가 말하는 범위」다.
 */

/**
 * 문서와 고정 수치 시험이 인용하는 완결 시즌(오름차순). ⚠**얼려 둔다** — 한 시험이 고치면 다른 시험이 다른 범위로 센다.
 * ⚠**올리는 날 할 일**은 `docs/operations.md` 「해마다 하는 일」(수치·문서 갱신 · `PENNANT` 은 npb.jp 공식 순위로 대조).
 */
export const DOC_SEASONS: readonly number[] = Object.freeze([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);

/**
 * **끝났는데 범위 밖인 시즌** — 범위를 올릴 때가 됐다는 알림의 재료(오름차순 · 중복 없음).
 *
 * ⚠**순수 함수다** — 「끝났다」는 부르는 쪽이 `seasonIsOver` 로 재서 넘긴다(시계도 DB 도 없다 · M6).
 * ⚠**범위 안인데 아직 안 끝난 시즌은 말하지 않는다** — 그건 「너무 일찍 올렸다」이고 시험의 가드가 막는다.
 * @param overSeasons 보유 시즌 중 `seasonIsOver` 가 참인 것
 * @param docSeasons 기본은 `DOC_SEASONS`(시험이 규칙만 따로 잴 때 넘긴다)
 */
export function docSeasonsToAdd(overSeasons: Iterable<number>, docSeasons: readonly number[] = DOC_SEASONS): number[] {
  const inDoc = new Set(docSeasons);
  return [...new Set(overSeasons)].filter((s) => !inDoc.has(s)).sort((a, b) => a - b);
}
