/**
 * **선수 페이지의 판 판정** — 옛 판이 DB 의 더 새 프로필·통산을 덮지 못하게 한다
 * (감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5).
 *
 * ## 판을 무엇으로 비교하는가 — 본문 sha(동일성) + 내용 시각(순서)
 *
 * ⚠**판은 본문 sha256 이다**(019 드래프트와 같은 정의 · DB `player.profile_revision`). 사이드카의 `revision` 은 아카이브 안의
 *   카운터라 세대를 복원한 뒤 다시 세면 **다른 본문에 같은 번호**가 붙는다 — 쓰지 않는다.
 * ⚠**본문이 같으면 판이 같다 — 시각을 안 본다.** 「같은 본문 · 이른 확인」(세대 복원)을 거짓 옛 판으로 막지 않는다.
 * ⚠**본문이 다를 때만** 내용 시각(`contentTimeOf` · 부재 중이면 받은 시각)으로 순서를 가른다 — 404 가 올린 시각은 순서에 안 들어간다.
 * ⚠⚠**DB 쪽 기준선도 내용 시각이다 — `player.profile_content_at`**(2026-09-27 · 3중 검토 3차 P2). 처음에는 `profile_fetched_at` 과
 *   맞댔는데, 그 칸은 **표시·신선도용 「마지막으로 본 시각」**이라 같은 본문의 404 를 적재하면(`same` = 늦은 쪽) 404 확인 시각으로
 *   오른다. 그러면 그 사이에 받은 **실제로 더 새** 본문이 「DB 보다 이르다」로 버려졌다(종료 0 · 옛 값 남음 · 3차 재현).
 *   → 입력은 내용 시각인데 기준선은 확인 시각이던 어긋남을 없앴다: **양쪽 다 내용 시각**이다. `profile_fetched_at` 의 뜻과 쓰는
 *   규칙은 그대로다(화면의 取得 날짜 · `career-lag` · 설계 §5-7).
 * ⚠**적용 판이 NULL 이면 「처음」이다 — 시각을 비교하지 않는다.** C7 이전 DB 의 `profile_fetched_at` 은 적재 실행 시각이라
 *   사이드카보다 언제나 늦어(실측 1,644/1,644 · 980/980) 시각만 보면 첫 실행에 전원이 **영구히** 거짓 옛 판이다(G4).
 *
 * ## 시각 규칙은 `meta.ts` 한 곳이다(M1)
 *
 * `seenAtOf`(쓰는 시각) · `contentTimeOf`(순서 시각) · `isAbsentNow` · `normalizeFetchedAt` 를 가져다 쓴다. 여기서 새로 정하지 않는다.
 */
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { absentStateOf, contentTimeOf, isAbsentNow, normalizeFetchedAt, seenAtOf } from "./meta.ts";

/** 사이드카를 **한 번** 읽은 스냅샷. ⚠판정한 판과 다른 판의 시각이 들어가지 않게 파일을 다시 읽지 않는다(경기 가드 부록 D A2) */
export type MetaSnapshot = { state: "missing" } | { state: "broken"; error: string } | { state: "ok"; value: unknown };

export interface PlayerArchive {
  /** 본문(`npb/players/<id>.html.gz` 를 푼 바이트)의 sha256 hex — **늘 안다** */
  bodySha256: string;
  /** 쓰는 시각(`seenAtOf`) — 사이드카가 본문을 말할 때만 */
  seenAt: string | null;
  /** 순서 시각(`contentTimeOf`) — 같은 조건 · 부재 표시가 무효면 null */
  contentTime: string | null;
  /** 마지막 관측이 404/410 인가(`isAbsentNow`) */
  absentNow: boolean;
  /** `seenAt`·`contentTime` 이 null 인 이유(로그용) · 둘 다 알면 null */
  unknownReason: string | null;
}

/**
 * 스냅샷과 본문으로 판정 재료를 만든다(순수).
 * ⚠**사이드카가 본문을 말하지 않으면**(없음 · JSON 깨짐 · 객체 아님 · `sha256` 없음/빈 값 · `sha256` ≠ 본문 sha) 시각을 **모른다** —
 *   다른 본문의 시각을 이 본문에 붙이면 순서가 거짓이 된다(본문·사이드카 쓰기 사이에서 죽은 폴더).
 */
export function playerArchiveOf(meta: MetaSnapshot, body: Uint8Array): PlayerArchive {
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const unknown = (reason: string): PlayerArchive => ({ bodySha256, seenAt: null, contentTime: null, absentNow: false, unknownReason: reason });
  if (meta.state === "missing") return unknown("사이드카 없음");
  if (meta.state === "broken") return unknown(`사이드카 JSON 을 못 읽었다(${meta.error})`);
  const v = meta.value;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return unknown("사이드카가 객체가 아니다");
  const sha = (v as { sha256?: unknown }).sha256;
  if (typeof sha !== "string" || sha === "") return unknown("사이드카에 sha256 이 없다");
  if (sha !== bodySha256) {
    return unknown(`본문 sha256 이 사이드카와 다르다(사이드카 ${sha.slice(0, 12)}… · 본문 ${bodySha256.slice(0, 12)}…)`);
  }
  const seenAt = seenAtOf(v);
  const contentTime = contentTimeOf(v);
  const absentNow = isAbsentNow(v);
  let unknownReason: string | null = null;
  if (absentStateOf(v) === "invalid") unknownReason = "absentAt 무효";
  else if (contentTime === null) unknownReason = absentNow ? "부재 중인데 받은 시각(fetchedAt)이 무효" : "취득 시각 무효";
  return { bodySha256, seenAt, contentTime, absentNow, unknownReason };
}

export type PlayerVerdict =
  | { kind: "no-row" | "first" | "same"; time: string | null; contentAt: string | null }
  /** `noBaseline` — DB 에 순서 기준선(`profile_content_at`)이 없어 **순서를 가르지 않고** 새 판으로 받았다(§5-2 5번) */
  | { kind: "newer"; time: string | null; contentAt: string; noBaseline: boolean }
  | { kind: "stale"; absentNow: boolean; archiveTime: string; dbContentAt: string }
  | { kind: "unknown"; reason: string }
  | { kind: "invalid-db"; value: string };

/**
 * `archiveTime` 이 `dbTime` 보다 이른가 — 판정기와 선정기가 같이 쓴다(M1).
 * ⚠두 값 다 `normalizeFetchedAt` 의 결과여야 한다(아니면 호출자 결함 — `judgeVersion` 의 계약과 같다) · `Date.parse` 밀리초 비교.
 *   날것의 `Date.parse` 는 시간대 없는 값을 기계마다 9시간 다르게 읽는다(`meta.ts` 의 TIMESTAMP 주석).
 */
export function isOlder(archiveTime: string, dbTime: string): boolean {
  for (const t of [archiveTime, dbTime]) {
    if (normalizeFetchedAt(t) !== t) {
      throw new TypeError(`정규화되지 않은 시각이다: ${JSON.stringify(t)} — normalizeFetchedAt 의 결과를 넘겨라`);
    }
  }
  return Date.parse(archiveTime) < Date.parse(dbTime);
}

/** 둘 중 늦은 시각 · 한쪽이 null 이면 다른 쪽(둘 다 정규화된 값이다) */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * **§5-2 판정 표** — 위에서부터 처음 맞는 줄. 순서의 기준선은 DB `profile_content_at`(내용 시각)이다(3중 검토 3차 P2).
 *
 * | # | 조건 | 판정 | 쓰는 `profile_fetched_at`(표시) | 쓰는 `profile_content_at`(순서) |
 * |---|---|---|---|---|
 * | 1 | DB 에 그 선수 행이 없다 | `no-row` | 본 시각 | (행 없음 — 안 쓴다) |
 * | 2 | 적용 판 NULL | `first` | 본 시각(모르면 NULL — C7) | 후보 내용 시각(모르면 NULL) |
 * | 3 | 적용 판 = 본문 sha | `same` | 유효한 DB 값과 본 시각 중 **늦은 것** | 유효한 DB 값과 후보 내용 시각 중 **늦은 것** |
 * | 4 | (본문이 다르다) 후보 내용 시각 null | `unknown` | — | — |
 * | 5 | DB `profile_content_at` 이 NULL | `newer`(`noBaseline`) | 본 시각 | 후보 내용 시각 |
 * | 6 | DB `profile_content_at` 이 무효 | `invalid-db` | — | — |
 * | 7 | 후보 내용 시각 < DB `profile_content_at` | `stale` | — | — |
 * | 8 | 그 밖(같은 시각 포함) | `newer` | 본 시각 | 후보 내용 시각 |
 *
 * ⚠**3번의 순서 칸이 404 로 안 오른다** — 부재 중 사이드카의 내용 시각은 받은 시각(`fetchedAt`)이다. 표시 칸은 지금처럼 오른다.
 * ⚠**5번은 새 판으로 받는다 — 판 모름(종료 1)으로 막지 않는다**(설계 §5-2 「5번의 선택」). 이 상태는 사이드카가 본문을 말하지 않던
 *   첫 적재에서만 생기는데, DB 쪽 순서는 **다시 받아도 되살아나지 않아**(후보는 이미 최신 사본이다) 막으면 그 선수 때문에
 *   **매 실행 배포가 영구히 막힌다.** 조용히 받지 않도록 적재기가 따로 찍는다(`noBaseline`). 남는 위험은 설계 §12.
 * ⚠**`profile_fetched_at` 은 순서에 안 쓴다** — 무효여도 막지 않는다(같은 본문·새 판이 본 시각으로 덮는다).
 * ⚠**쓰기 트랜잭션 안에서만 부른다** — 트랜잭션의 첫 읽기가 SHARED 잠금을 커밋까지 쥐어, 판정과 쓰기 사이에 다른 연결이
 *   그 행을 커밋할 수 없다(끼어들면 SQLite 가 `SQLITE_BUSY` 로 한쪽을 실패시킨다 — 실패로 보인다). 밖이면 던진다.
 */
export function judgePlayerVersion(db: Db, playerId: string, a: PlayerArchive): PlayerVerdict {
  if (db.raw.isTransaction !== true) {
    throw new TypeError("judgePlayerVersion 은 쓰기 트랜잭션 안에서만 부른다 — 판정과 쓰기 사이에 다른 연결이 끼어들 수 있다");
  }
  // ⚠판정 SELECT 는 이 하나다(설계 §5-3)
  const row = db.raw
    .prepare("SELECT profile_revision, profile_fetched_at, profile_content_at FROM player WHERE player_id = ?")
    .get(playerId) as { profile_revision: string | null; profile_fetched_at: unknown; profile_content_at: unknown } | undefined;
  if (row === undefined) return { kind: "no-row", time: a.seenAt, contentAt: a.contentTime };
  if (row.profile_revision === null) return { kind: "first", time: a.seenAt, contentAt: a.contentTime };
  if (row.profile_revision === a.bodySha256) {
    // ⚠그 DB 값들은 **바로 이 본문**에 대한 것이라 값과 한 벌이다 — 사이드카를 못 읽어도 지우지 않는다(C7 과의 조정)
    return {
      kind: "same",
      time: later(normalizeFetchedAt(row.profile_fetched_at), a.seenAt),
      contentAt: later(normalizeFetchedAt(row.profile_content_at), a.contentTime),
    };
  }
  if (a.contentTime === null) return { kind: "unknown", reason: a.unknownReason ?? "내용 시각을 모른다" };
  if (row.profile_content_at === null) return { kind: "newer", time: a.seenAt, contentAt: a.contentTime, noBaseline: true };
  const dbContentAt = normalizeFetchedAt(row.profile_content_at);
  if (dbContentAt === null) return { kind: "invalid-db", value: String(row.profile_content_at) };
  if (isOlder(a.contentTime, dbContentAt)) {
    return { kind: "stale", absentNow: a.absentNow, archiveTime: a.contentTime, dbContentAt };
  }
  return { kind: "newer", time: a.seenAt, contentAt: a.contentTime, noBaseline: false };
}

export type RefetchClass = "no-identity" | "unreadable" | "same" | "stale" | "stale-absent" | "unknown" | "newer";

/**
 * **재취득 선정기용** — 사이드카만 보고 「이 선수의 아카이브가 DB 보다 옛 판인가」를 가른다(설계 §5-4 · 본문은 선정기가 따로 본다).
 * ⚠판정기(`judgePlayerVersion`)와 **같은 순서 규칙 · 같은 기준선**(DB `profile_content_at`)이다(`contentTimeOf` · `isOlder`).
 * - `no-identity` 적용 판 NULL(첫 실행 · 신규) — 이 사유는 판단하지 않는다
 * - `unreadable` 사이드카가 없음·깨짐·객체 아님·`sha256` 없음 — 뽑지 않고 센다(없는 것은 신규 단계가 이미 받는다)
 * - `same` 사이드카 sha = 적용 판
 * - `stale` 다른 본문 · 내용 시각이 DB 기준선보다 이르다 · 부재 중 아님 → **뽑는다**
 * - `stale-absent` 위와 같은데 부재 중 — 받아도 404 이고 아카이버가 7일 동안 건너뛴다. 뽑지 않고 센다
 * - `unknown` 순서를 모른다(부재 표시·내용 시각 무효 · DB 기준선 무효) — 적재기가 종료 1 로 알린다
 * - `newer` 그 밖(DB 기준선 NULL 포함 — 적재기가 새 판으로 받는다 · §5-2 5번)
 */
export function classifyForRefetch(meta: unknown, db: { revision: string | null; contentAt: string | null }): RefetchClass {
  if (db.revision === null) return "no-identity";
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return "unreadable";
  const sha = (meta as { sha256?: unknown }).sha256;
  if (typeof sha !== "string" || sha === "") return "unreadable";
  if (sha === db.revision) return "same";
  const archiveTime = contentTimeOf(meta);
  if (archiveTime === null) return "unknown";
  if (db.contentAt === null) return "newer";
  const dbContentAt = normalizeFetchedAt(db.contentAt);
  if (dbContentAt === null) return "unknown";
  if (!isOlder(archiveTime, dbContentAt)) return "newer";
  return isAbsentNow(meta) ? "stale-absent" : "stale";
}
