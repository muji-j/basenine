/**
 * 予告先発(선발 예고) 페이지 아카이브.
 *
 * `https://npb.jp/announcement/starter/` 하나뿐이고, **하루 1요청**이면 된다.
 * 경기 전에 공표되는 유일한 라인업 정보라 「오늘의 매치업」 화면의 근거가 된다.
 *
 * ⚠**라이브 취득이 아니다.** 이 페이지는 전날~당일에 갱신되고 경기 중에는 움직이지 않는다.
 * 진행 중 정보를 받지 않는 이유는 `docs/decisions/2026-08-15-live-matchup-feasibility.md`.
 *
 * ⚠**페이지는 「다음에 발표된 하루」만 보여준다.** 어제분을 되받을 수 없으므로
 * 하루라도 거르면 그날 예고는 영영 못 받는다 — 그래서 매일 배치에 넣는다.
 */
import type { Clock } from "./clock.ts";
import type { PoliteFetcher } from "./fetcher.ts";
import type { BlobMeta, Sink } from "./sink.ts";
import { sha256 } from "./sink.ts";
import type { PageResult } from "./archive.ts";

export const STARTERS_URL = "https://npb.jp/announcement/starter/";

/**
 * 아카이브 키.
 *
 * ⚠**날짜를 키에 넣는다.** 하나의 키에 덮어쓰면 「어제 무엇이 예고돼 있었는가」가 사라지고,
 * 예고가 바뀐 사실을 나중에 확인할 수 없다(M4).
 * @param jstDate 받은 날(`YYYY-MM-DD`, JST). 페이지가 가리키는 경기일이 아니라 **취득일**이다
 */
export function startersKey(jstDate: string): string {
  return `npb/starters/${jstDate}`;
}

export interface ArchiveStartersDeps {
  fetcher: PoliteFetcher;
  sink: Sink;
  clock: Clock;
}

export async function archiveStarters(jstDate: string, deps: ArchiveStartersDeps): Promise<PageResult> {
  const key = startersKey(jstDate);
  const url = STARTERS_URL;
  const prev = await deps.sink.readMeta(key);

  try {
    const res = await deps.fetcher.get(url, prev ?? undefined);

    if (res.status === 304) return { key, url, outcome: "unchanged", status: 304, error: null };
    if (res.status === 404 || res.status === 410) {
      return { key, url, outcome: "absent", status: res.status, error: null };
    }
    if (res.body === null) {
      return { key, url, outcome: "failed", status: res.status, error: `본문 없는 ${res.status} 응답` };
    }

    const digest = sha256(res.body);
    if (prev && prev.sha256 === digest) {
      return { key, url, outcome: "unchanged", status: res.status, error: null };
    }

    const meta: BlobMeta = {
      url,
      fetchedAt: deps.clock.now().toISOString(),
      lastModified: res.lastModified,
      etag: res.etag,
      status: res.status,
      sha256: digest,
      byteLength: res.body.byteLength,
      revision: (prev?.revision ?? 0) + 1,
    };
    await deps.sink.write(key, res.body, meta);
    return { key, url, outcome: "stored", status: res.status, error: null };
  } catch (err) {
    return {
      key,
      url,
      outcome: "failed",
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
