/**
 * 아카이브 사이드카(`*.meta.json`)에서 **언제 받았는가**를 읽는다(M4).
 *
 * ⚠**적재 시각으로 대신하면 안 된다.** 적재는 매일 돌지만 페이지는 **다시 받지 않으면 그대로**다 —
 * 적재 시각을 넣으면 8월 15일에 받은 페이지가 매일 「오늘 받은 것」이 된다.
 * 실제로 그 상태였고, 그래서 통산 기록이 낡은 줄 모르고 화면에 나갔으며
 * 그것을 **「NPB 가 늦다」고 오진**해 엉뚱한 처방(두 출처 이어 붙이기)까지 얹었다(2026-08-17).
 *
 * ⚠**읽지 못하면 `null` 이다** — 「모른다」를 「오늘」로 바꾸지 않는다(M11).
 * 파일이 없는 것, JSON 이 깨진 것, **JSON 이 객체가 아닌 것**, 값이 **날짜로 읽히지 않는 것**을 전부 같게 다룬다:
 * 어느 쪽이든 **우리는 취득 시각을 모른다.**
 *
 * ⚠**「객체가 아니다」와 「날짜가 아니다」는 2026-09-11 에 더했다**(콜드 리뷰 지적).
 * 그전에는 JSON `null` 이 `m.checkedAt` 에서 **예외**를 내 적재기 전체를 멈췄고,
 * `"not-a-date"` 는 **그대로** 취득 시각이 돼 신선도 맥박(`MAX(fetched_at)`)에 섞일 수 있었다.
 * 실물 아카이브에서는 둘 다 **0장**이었다(로컬 사이드카 32,695장 전수) — 규칙을 조여도 바뀌는 값이 없다.
 */
import { readFileSync } from "node:fs";

/**
 * 취득 시각으로 인정하는 모양. 아카이버는 `Date#toISOString()` 을 쓴다(`YYYY-MM-DDTHH:MM:SS.sssZ`).
 * ⚠**앞모양만으로는 부족하다** — `2026-13-99T00:00` 도 모양은 맞는다. `Date.parse` 가 유한해야 한다.
 */
const TIMESTAMP_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function timestamp(v: unknown): string | null {
  return typeof v === "string" && TIMESTAMP_HEAD.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}

export function fetchedAtOf(metaPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(metaPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const m = parsed as { fetchedAt?: unknown; checkedAt?: unknown };
  /**
   * ⚠**`checkedAt`(마지막으로 본 시각)이 먼저다.**
   * `fetchedAt` 은 「내용이 마지막으로 **바뀐**」 시각이라, 안 바뀐 페이지에서는 영영 안 움직인다.
   * 그것을 쓰면 ⑴ 화면이 실제보다 낡은 날짜를 말하고 ⑵ 재취득 선정이 「아직 안 받았다」로 오판해
   * **같은 페이지를 매일 다시 친다**(L1). 우리가 답해야 하는 질문은 「이 값이 언제 것인가」이고,
   * 그 답은 **마지막으로 확인한 시각**이다.
   * ⚠옛 사이드카에는 `checkedAt` 이 없다 — 그때는 `fetchedAt` 이 곧 확인 시각이었으므로 그대로 떨어뜨린다.
   * ⚠`checkedAt` 이 **있지만 무효**여도 같은 방향으로 떨어진다 — 「마지막으로 본 시각」을 모르면
   *   「마지막으로 바뀐 시각」이 그다음으로 정직한 답이다.
   */
  return timestamp(m.checkedAt) ?? timestamp(m.fetchedAt);
}
