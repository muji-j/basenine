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
  try {
    const m = JSON.parse(raw) as { fetchedAt?: unknown };
    return typeof m.fetchedAt === "string" && m.fetchedAt !== "" ? m.fetchedAt : null;
  } catch {
    return null;
  }
}
