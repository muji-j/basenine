/**
 * 선수 페이지(`/bis/players/{id}.html`) 아카이브.
 *
 * 경기 페이지와 성질이 다르다 — **경기 결과가 아니라 선수 속성**이라 자주 바뀌지 않는다.
 * 그래서 매일 받을 필요가 없고, **새로 등장한 선수만** 받으면 된다.
 *
 * 왜 필요한가: 좌우 스플릿(좌투 상대 타율 등)은 **투타 정보**가 있어야 성립하는데,
 * 박스스코어에도 playbyplay에도 없다. 이 페이지의 `投打：右投左打`가 유일한 출처다.
 */
import type { Clock } from "./clock.ts";
import type { PoliteFetcher } from "./fetcher.ts";
import type { BlobMeta, Sink } from "./sink.ts";
import { sha256 } from "./sink.ts";
import type { PageOutcome, PageResult } from "./archive.ts";

export function playerKey(playerId: string): string {
  return `npb/players/${playerId}`;
}

export function playerUrl(playerId: string): string {
  return `https://npb.jp/bis/players/${playerId}.html`;
}

export interface ArchivePlayersDeps {
  fetcher: PoliteFetcher;
  sink: Sink;
  clock: Clock;
}

/**
 * 선수 1명의 페이지를 보존한다. 경기 페이지와 같은 멱등 규칙을 따른다(M5).
 */
export async function archivePlayer(playerId: string, deps: ArchivePlayersDeps): Promise<PageResult> {
  const key = playerKey(playerId);
  const url = playerUrl(playerId);
  const prev = await deps.sink.readMeta(key);

  try {
    const res = await deps.fetcher.get(url, prev ?? undefined);

    /**
     * ⚠**「안 바뀌었다」도 「봤다」로 남긴다**(2026-08-17 재검토 P1).
     * 안 남기면 `fetchedAt` 이 「마지막으로 바뀐 시각」에 멈추고, 재취득 선정이 그것을
     * 「아직 안 받았다」로 읽어 **같은 페이지를 매일 다시 친다**(L1). 화면의 취득일도 실제보다 낡게 나온다.
     * ⚠본문은 다시 쓰지 않는다 — 바뀐 게 없으므로 `revision` 도 올리지 않는다(M5).
     */
    const seen = async (status: number): Promise<PageResult> => {
      if (prev !== null) {
        await deps.sink.writeMeta(key, { ...prev, checkedAt: deps.clock.now().toISOString() });
      }
      return { key, url, outcome: "unchanged", status, error: null };
    };

    if (res.status === 304) return await seen(304);
    if (res.status === 404 || res.status === 410) {
      /**
       * ⚠**「없다」도 기록한다**(2026-08-18 다방면 감사 P1).
       * 예전에는 아무것도 안 남겨서, 다음 날 「아직 안 받았다」로 다시 뽑혔다 —
       * **성공할 수 없는 요청 246건을 매일 영구히** 보내고 있었다(L1 위반이 매일 누적).
       * 소급 시즌을 넣을수록 이 수가 는다.
       * ⚠**본문은 없으므로 메타만 남긴다.** `absentAt` 이 있으면 선정에서 뺄 수 있다.
       * ⚠**영구 제외가 아니다** — 1군에 올라오면 페이지가 생긴다. 선정 쪽이 기간을 정한다.
       */
      await deps.sink.writeMeta(key, {
        ...(prev ?? { url, fetchedAt: "", lastModified: null, etag: null, sha256: "", byteLength: 0, revision: 0 }),
        url,
        status: res.status,
        checkedAt: deps.clock.now().toISOString(),
        absentAt: deps.clock.now().toISOString(),
      });
      return { key, url, outcome: "absent", status: res.status, error: null };
    }
    if (res.body === null) {
      return { key, url, outcome: "failed", status: res.status, error: `본문 없는 ${res.status} 응답` };
    }

    const digest = sha256(res.body);
    if (prev && prev.sha256 === digest) {
      return await seen(res.status);
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
      // 새로 받은 것이니 「본 시각」도 같다
      checkedAt: deps.clock.now().toISOString(),
    };
    await deps.sink.write(key, res.body, meta);
    return { key, url, outcome: "stored", status: res.status, error: null };
  } catch (err) {
    return { key, url, outcome: "failed", status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 「없다」고 확인된 페이지를 다시 치기까지의 간격(일).
 *
 * ⚠**너무 길면** 1군에 올라온 선수의 페이지를 오래 못 받는다.
 * ⚠**너무 짧으면** 성공할 수 없는 요청을 계속 보낸다(L1).
 * 7일이면 등록 주기(보통 주 단위)와 맞고, 246명 기준 하루 35건으로 줄어든다.
 */
export const ABSENT_RETRY_DAYS = 7;

/**
 * 여러 선수를 순서대로 보존한다.
 *
 * ⚠**이미 받아둔 선수를 건너뛸 수 있게 한다.** 900명을 3초 간격으로 받으면 45분이다 —
 * 매번 전량을 다시 받는 것은 상대에게도 우리에게도 낭비다(L1·L7).
 */
export async function archivePlayers(
  playerIds: readonly string[],
  deps: ArchivePlayersDeps,
  opts: { skipExisting?: boolean; onEach?: (r: PageResult, index: number, total: number) => void } = {},
): Promise<PageResult[]> {
  const out: PageResult[] = [];
  for (const [index, id] of playerIds.entries()) {
    /**
     * ⚠**「없다고 확인된」 선수는 한동안 다시 치지 않는다**(2026-08-18 다방면 감사 P1).
     * 404 에 사이드카를 안 남기던 때는 **성공할 수 없는 요청 246건을 매일 영구히** 보냈다(L1).
     * ⚠**영구 제외가 아니다** — 1군에 올라오면 페이지가 생긴다. 그래서 **기간**을 둔다.
     * ⚠간격을 벽시계가 아니라 **주입된 시계**로 잰다(M6).
     */
    const prevMeta = await deps.sink.readMeta(playerKey(id));
    if (prevMeta?.absentAt !== undefined) {
      const days = (deps.clock.now().getTime() - Date.parse(prevMeta.absentAt)) / 86_400_000;
      if (days < ABSENT_RETRY_DAYS) {
        const skipped: PageResult = { key: playerKey(id), url: playerUrl(id), outcome: "unchanged", status: null, error: null };
        out.push(skipped);
        opts.onEach?.(skipped, index, playerIds.length);
        continue;
      }
    }
    if (opts.skipExisting === true && prevMeta !== null) {
      const skipped: PageResult = {
        key: playerKey(id),
        url: playerUrl(id),
        outcome: "unchanged" satisfies PageOutcome,
        status: null,
        error: null,
      };
      out.push(skipped);
      opts.onEach?.(skipped, index, playerIds.length);
      continue;
    }
    const r = await archivePlayer(id, deps);
    out.push(r);
    opts.onEach?.(r, index, playerIds.length);
  }
  return out;
}
