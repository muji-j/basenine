/**
 * 경기 폴더의 **본문·사이드카 정합**과 **세트 표식** 대조(설계 D3).
 *
 * ⚠순서가 뜻을 갖는다: 무결성(`checkIntegrity`)을 **먼저** 본다 — 본문이 사이드카와 안 맞으면 그 사이드카의 `set` 은 믿을 근거가 없다.
 * ⚠아카이버는 본문 `rename` 다음 사이드카 `rename` 을 한다(`packages/archiver/src/sink.ts`). 그 사이에서 죽으면
 *   **본문은 새 판 · 사이드카는 옛 판**이 되고, `set` 비교로는 못 잡는다 — 그래서 sha 를 대조한다.
 * ⚠`set` 이 아무 데도 없는 경기는 **이 기능 이전의 기록**으로 보고 통과시킨다(실측 근거의 수용 위험 · 설계 §6).
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const GAME_PAGE_LEAVES = ["index", "playbyplay", "box", "roster"] as const;
export type GamePageLeaf = (typeof GAME_PAGE_LEAVES)[number];

export interface PageFile {
  bodyPresent: boolean;
  metaPresent: boolean;
  /** gunzip 한 본문. 파일이 없거나 풀지 못했으면 null */
  body: Buffer | null;
  bodyError: string | null;
  /** 사이드카 JSON. 파일이 없거나 못 읽었으면 null */
  meta: Record<string, unknown> | null;
  metaError: string | null;
}

export type GamePages = Record<GamePageLeaf, PageFile>;

export type PageCheck = { ok: true } | { ok: false; reason: string };

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function readGamePages(dir: string): Promise<GamePages> {
  const out = {} as GamePages;
  for (const leaf of GAME_PAGE_LEAVES) {
    const gz = await readOptional(join(dir, `${leaf}.html.gz`));
    let body: Buffer | null = null;
    let bodyError: string | null = null;
    if (gz !== null) {
      try {
        body = gunzipSync(gz);
      } catch (err) {
        bodyError = message(err);
      }
    }
    const raw = await readOptional(join(dir, `${leaf}.meta.json`));
    let meta: Record<string, unknown> | null = null;
    let metaError: string | null = null;
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) metaError = "사이드카가 객체가 아니다";
        else meta = parsed as Record<string, unknown>;
      } catch (err) {
        metaError = `사이드카 JSON 을 못 읽었다 — ${message(err)}`;
      }
    }
    out[leaf] = { bodyPresent: gz !== null, metaPresent: raw !== null, body, bodyError, meta, metaError };
  }
  return out;
}

export function checkIntegrity(pages: GamePages): PageCheck {
  for (const leaf of GAME_PAGE_LEAVES) {
    const p = pages[leaf];
    if (!p.bodyPresent && !p.metaPresent) continue; // 없는 페이지 — 불일치가 아니다
    if (p.bodyPresent && !p.metaPresent) return { ok: false, reason: `${leaf}: 본문만 있고 사이드카가 없다` };
    if (!p.bodyPresent && p.metaPresent) return { ok: false, reason: `${leaf}: 사이드카만 있고 본문이 없다` };
    if (p.bodyError !== null) return { ok: false, reason: `${leaf}: 본문을 못 풀었다 — ${p.bodyError}` };
    if (p.metaError !== null) return { ok: false, reason: `${leaf}: ${p.metaError}` };
    const want = p.meta?.["sha256"];
    if (typeof want !== "string") return { ok: false, reason: `${leaf}: 사이드카에 sha256 이 없다` };
    const got = createHash("sha256").update(p.body!).digest("hex");
    if (got !== want) return { ok: false, reason: `${leaf}: 본문 sha256 이 사이드카와 다르다` };
  }
  return { ok: true };
}

export function checkSet(pages: GamePages): { ok: true; set: string | null } | { ok: false; reason: string } {
  const leaves = GAME_PAGE_LEAVES.filter((l) => pages[l].meta !== null);
  const sets = leaves.map((l) => {
    const s = pages[l].meta?.["set"];
    return typeof s === "string" ? s : null;
  });
  if (sets.every((s) => s === null)) return { ok: true, set: null };
  if (new Set(sets).size === 1) return { ok: true, set: sets[0]! };
  return {
    ok: false,
    reason: `세트 표식이 갈린다: ${leaves.map((l, i) => `${l}=${sets[i] ?? "없음"}`).join(" · ")}`,
  };
}
