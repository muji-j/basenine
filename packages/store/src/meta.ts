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
 * ⚠**시간대 표기(`Z` · `±HH:MM`)로 끝나야 한다**(2026-09-11 · 3중 검토 2차 N3 · 실측). 없으면 `Date.parse` 가
 *   **실행 기계의 현지 시간**으로 읽어 이 기계(JST)와 CI(UTC)에서 9시간이 갈리고, SQLite `datetime()`(UTC 로 읽는다)과도 갈린다.
 * ⚠⚠**정리 마이그레이션 `022-invalid-fetched-at.sql` 은 조건을 따로 적지 않고 이 함수를 부른다**(`db.ts` 가 `bb_fetched_at` 으로 등록).
 *   조건을 SQL 로 흉내 냈을 때 SQLite `datetime()` 과 경계값에서 갈렸다(`24:01` · `+15:00` · 수정분 재검토 2·3차) — **여기가 유일한 정의다.**
 */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 인정한 값은 **UTC `toISOString` 한 모양으로** 돌려준다.
 * ⚠**신선도 판정이 취득 시각을 문자열로 비교한다**(`MAX(fetched_at)` · 「예고보다 늦은 휴식 공표」) —
 * `09:00+09:00` 과 `00:00Z` 는 같은 시각인데 문자열로는 다르고, 앞의 것이 `01:00Z` 보다 크다고 나온다(2026-09-11 · 콜드 리뷰 지적).
 * 실물 사이드카는 전부 이미 이 모양이라(CI DB 5개 표에서 `Z` 로 안 끝나는 값 0) **정규화로 바뀌는 값이 없다.**
 * ⚠`new Date(ms)` 는 주어진 값을 해석할 뿐 시계를 읽지 않는다(M6).
 */
export function normalizeFetchedAt(v: unknown): string | null {
  if (typeof v !== "string" || !TIMESTAMP.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  // ⚠출력도 자기 모양이어야 한다 — `0000-01-01T00:00+00:01` 은 UTC 로 `-000001-…` 이 되어 다시 넣으면 NULL 이 된다(022 멱등성 · 3라운드 재검토 2차)
  return TIMESTAMP.test(iso) ? iso : null;
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
  return seenAtOf(parsed);
}

/**
 * **이미 읽어 둔** 사이드카 값에서 본 시각을 낸다 — `fetchedAtOf` 와 **같은 규칙 한 벌**(M1).
 * ⚠경기 적재기는 네 장을 한 번 읽은 스냅샷(`readGamePages`)으로 무결성·세트를 대조한다. 본 시각만 파일을 **다시** 읽으면
 *   그 사이에 아카이버가 사이드카를 바꿨을 때 **대조한 판과 다른 판의 시각**이 판 가드에 들어간다(TOCTOU ·
 *   2026-09-26 3중 검토 3차 P2 · 설계 부록 D). 그래서 적재기는 스냅샷의 값을 이 함수에 넘긴다.
 */
export function seenAtOf(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as { fetchedAt?: unknown; checkedAt?: unknown };
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
  return normalizeFetchedAt(m.checkedAt) ?? normalizeFetchedAt(m.fetchedAt);
}

/**
 * 사이드카 `absentAt`(404/410 을 본 시각)의 세 상태 — **없음** · **유효** · **무효**
 * (감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §3).
 *
 * ⚠**무효는 「부재 아님」이 아니다** — 손상된 사이드카다(키가 있는데 문자열이 아니거나 시각으로 안 읽힌다).
 *   「부재 아님」으로 읽으면 최근 `checkedAt` 으로 순서가 매겨져 **옛 본문이 새 판을 덮는다**(2026-09-27 콜드 리뷰 P2).
 *   그래서 `contentTimeOf` 는 무효면 순서를 **모른다**(null · fail-closed).
 * ⚠정상 아카이버는 두 값을 늘 유효한 ISO 로 쓴다(`archiver/src/players.ts` 의 404 경로) — 무효는 손상·변조에서만 열린다.
 * 객체가 아니면 `"none"` 이다(그 사이드카가 본문을 말하는지는 호출자가 따로 가른다).
 */
export function absentStateOf(meta: unknown): "none" | "valid" | "invalid" {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return "none";
  const m = meta as { absentAt?: unknown };
  if (!("absentAt" in m) || m.absentAt === undefined) return "none";
  return normalizeFetchedAt(m.absentAt) === null ? "invalid" : "valid";
}

/**
 * **마지막 관측이 404/410 이었나** — 부재 표시가 유효하고, `checkedAt` 이 없거나 무효이거나 `absentAt ≥ checkedAt`.
 * ⚠404 경로는 두 값을 같은 실행에서 연달아 써서 `absentAt ≥ checkedAt` 이고, 그 뒤 **같은 본문으로 다시 확인되면**
 *   `markSeen` 이 `checkedAt` 만 올려 `absentAt < checkedAt` 이 된다(부재가 풀렸다). 객체가 아니면 false.
 */
export function isAbsentNow(meta: unknown): boolean {
  if (absentStateOf(meta) !== "valid") return false;
  const m = meta as { absentAt: unknown; checkedAt?: unknown };
  const absent = normalizeFetchedAt(m.absentAt)!;
  const checked = normalizeFetchedAt(m.checkedAt);
  return checked === null || Date.parse(absent) >= Date.parse(checked);
}

/**
 * **이 내용이 언제 것인가** — 판의 **순서**를 가를 때만 쓴다(선수 판정기 · 재취득 선정기). `seenAtOf` 와 질문이 다르다:
 * `seenAtOf` 는 「이 사본을 언제까지 믿을 수 있다고 봤나」(표시·신선도 감시가 쓴다 · **뜻을 바꾸지 않는다**)이고,
 * 이것은 「이 **내용**이 언제 것인가」다.
 * ⚠**부재 중이면 `fetchedAt`(그 본문을 받은 시각)** — 404 가 `checkedAt` 을 덮어 마지막 확인을 잃었으므로 알 수 있는 하한이다.
 *   `seenAtOf` 로 가르면 **없어진 페이지의 옛 본문이 가장 새 판처럼 보이고**, 옛 사본을 다시 받게 하는 재취득이 그 시각을 올려
 *   옛 판이 새 판을 덮는다(설계 §1-1 사실 3 · §5-1).
 * ⚠**부재 표시가 무효면 null**(순서를 모른다 · fail-closed) — 본 시각이 유효해도 그렇다.
 * ⚠쓰는 시각(`profile_fetched_at` · 통산 `fetched_at`)은 여전히 `seenAtOf` 다 — 바꾸면 `career-lag` 이 받을 수 없는 선수로
 *   수집 잡을 최대 400일 빨갛게 만든다(설계 §5-7 · 미룬 결정 §10-2).
 */
export function contentTimeOf(meta: unknown): string | null {
  if (absentStateOf(meta) === "invalid") return null;
  if (isAbsentNow(meta)) return normalizeFetchedAt((meta as { fetchedAt?: unknown }).fetchedAt);
  return seenAtOf(meta);
}
