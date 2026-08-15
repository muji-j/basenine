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
    return { key, url, outcome: "failed", status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

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
    if (opts.skipExisting === true && (await deps.sink.readMeta(playerKey(id))) !== null) {
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
