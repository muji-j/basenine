/**
 * 아카이브 사이드카(`*.meta.json`)에서 **언제 받았는가**를 읽는다(M4).
 *
 * ⚠**적재 시각으로 대신하면 안 된다.** 적재는 매일 돌지만 페이지는 **다시 받지 않으면 그대로**다 —
 * 적재 시각을 넣으면 8월 15일에 받은 페이지가 매일 「오늘 받은 것」이 된다.
 * 실제로 그 상태였고, 그래서 통산 기록이 낡은 줄 모르고 화면에 나갔으며
 * 그것을 **「NPB 가 늦다」고 오진**해 엉뚱한 처방(두 출처 이어 붙이기)까지 얹었다(2026-08-17).
 *
 * ⚠**읽지 못하면 `null` 이다** — 「모른다」를 「오늘」로 바꾸지 않는다(M11).
 * 파일이 없는 것, JSON 이 깨진 것, `fetchedAt` 이 문자열이 아닌 것을 전부 같게 다룬다:
 * 어느 쪽이든 **우리는 취득 시각을 모른다.**
 */
import { readFileSync } from "node:fs";

export function fetchedAtOf(metaPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(metaPath, "utf8");
  } catch {
    return null;
  }
  let m: { fetchedAt?: unknown; checkedAt?: unknown };
  try {
    m = JSON.parse(raw) as { fetchedAt?: unknown; checkedAt?: unknown };
  } catch {
    return null;
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  /**
   * ⚠**`checkedAt`(마지막으로 본 시각)이 먼저다.**
   * `fetchedAt` 은 「내용이 마지막으로 **바뀐**」 시각이라, 안 바뀐 페이지에서는 영영 안 움직인다.
   * 그것을 쓰면 ⑴ 화면이 실제보다 낡은 날짜를 말하고 ⑵ 재취득 선정이 「아직 안 받았다」로 오판해
   * **같은 페이지를 매일 다시 친다**(L1). 우리가 답해야 하는 질문은 「이 값이 언제 것인가」이고,
   * 그 답은 **마지막으로 확인한 시각**이다.
   * ⚠옛 사이드카에는 `checkedAt` 이 없다 — 그때는 `fetchedAt` 이 곧 확인 시각이었으므로 그대로 떨어뜨린다.
   */
  return str(m.checkedAt) ?? str(m.fetchedAt);
}
