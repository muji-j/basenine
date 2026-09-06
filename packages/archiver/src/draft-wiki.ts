/**
 * 드래프트 — **ja.wikipedia** 취득. **연 1회 배치**(npb 쪽과 같은 층).
 *
 * ⚠**일일 배치(`scripts/update.ts`)에 붙이지 않는다** — 그쪽은 날짜 창 기반이라 층이 다르다.
 *
 * ⚠**예의도 멱등도 기존 취득기와 같은 한 벌을 쓴다**(L1·L7·M5·M8) — `PoliteFetcher` 와 `archiveUrl`.
 * **여기서 `fetch` 를 직접 부르거나 revision 규칙을 새로 쓰지 않는다.**
 *
 * ⚠⚠**npb 와 두 가지가 다르다. 둘 다 「같은 코드니까 같겠지」로 넘기면 틀린다:**
 *   ⑴ **`Last-Modified` 가 온다**(**사이드카 22/22 실측** · `ETag` 는 0/22). npb.jp 는 **둘 다 0/275** 라
 *      조건부 요청이 아무것도 절약하지 못하는데, **여기서는 실제로 절약한다** — 두 번째 실행부터
 *      **304 로 돌아온다.** 그래서 **`unchanged` 경로가 정상**이고, 그 경로에도 라이선스를 남긴다.
 *   ⑵ **한 장이 한 해 전부**다. npb 는 한 해에 13장(연도 톱 + 12구단)인데 여기는 **1장**이다.
 *
 * ⚠**robots — `/wiki/` 만 친다.** `/w/`·`/api/` 는 ja.wikipedia 의 robots.txt 가 **Disallow** 한다.
 * 편해 보인다고 `action=raw` 나 REST API 로 갈아타지 마라(규칙표 §9).
 * ⚠**게다가 그건 다른 물건이다** — 우리 파서는 **Parsoid 렌더링 HTML** 에 한정된 규칙이고
 * 위키텍스트는 구조가 다르다(규칙표 §10-5).
 *
 * ⚠**아카이브 키는 `wikipedia/draft/{year}` 다 — `npb/` 아래에 두지 마라.** 출처가 다르고,
 * 배포에 실리는 tar 도 다르며, **라이선스가 다르다**(L6·L3).
 */
import { draftWikiUrl } from "@bb-app/parser";
import { archiveUrl } from "./archive.ts";
import type { ArchiveDeps, PageResult } from "./archive.ts";

/** 아카이브 키 접두. ⚠**`npb/draft` 와 나란히 두지 않는다** — 위 머리말 참조 */
const KEY_ROOT = "wikipedia/draft";

/**
 * **CC BY-SA 4.0.** ⚠이 문자열은 `store/src/draft-wiki.ts` 에도 있다 —
 * 하나는 **아카이브 사이드카**에, 하나는 **DB `draft_event.license`** 에 들어간다.
 * 두 층이 서로를 import 하지 않으므로 값을 나란히 두고, **시험이 둘이 같은지 본다.**
 */
export const DRAFT_WIKI_LICENSE = "CC BY-SA 4.0";

export function draftWikiKey(year: number): string {
  return `${KEY_ROOT}/${year}`;
}

export { draftWikiUrl };

export interface DraftWikiCollectOptions {
  readonly from: number;
  readonly to: number;
  /** 범위 안에서 한 해만. ⚠**범위 밖이면 호출자가 먼저 걸러라** — 조용한 0건이 된다 */
  readonly only?: number | undefined;
}

export interface DraftWikiCollectResult {
  /** 받으려 한 해. **분모다** */
  readonly yearsAttempted: readonly number[];
  readonly pages: readonly PageResult[];
}

/**
 * 연도 범위를 받는다.
 *
 * ⚠**연도 색인이 없다** — npb 는 `backnumber.html` 이 「어느 해가 있는가」를 말해 주지만
 * wikipedia 는 **연도마다 기사가 따로 있고 목록 페이지는 카테고리**다. 그래서 **호출자가 범위를 준다.**
 * ⚠**그 결과 「없는 해」와 「아직 없는 해」를 여기서 구별하지 못한다** — 404 는 `absent` 로 남고,
 * 그것이 개최 전인지 표기 변경인지는 **사람이 본다**(npb 쪽 `DraftYearSkip` 과 같은 사고방식).
 *
 * ⚠**한 해가 실패해도 다음 해를 계속 받는다** — `archiveDates` 와 같은 방침이다.
 */
export async function collectDraftWiki(
  opts: DraftWikiCollectOptions,
  deps: ArchiveDeps,
  onPage?: (r: PageResult) => void,
): Promise<DraftWikiCollectResult> {
  const years: number[] = [];
  for (let y = opts.from; y <= opts.to; y += 1) {
    if (opts.only !== undefined && y !== opts.only) continue;
    years.push(y);
  }

  const pages: PageResult[] = [];
  for (const year of years) {
    // ⚠**라이선스를 `stored` 에만 붙이면 안 된다.** 이 소스는 두 번째 실행부터 `unchanged` 라
    //   그때 안 붙이면 **첫 실행에서 빠뜨린 값이 영영 안 들어간다**(`archiveUrl` 의 `extra` 주석).
    const r = await archiveUrl(draftWikiKey(year), draftWikiUrl(year), deps, { license: DRAFT_WIKI_LICENSE });
    pages.push(r);
    onPage?.(r);
  }
  return { yearsAttempted: years, pages };
}
