/**
 * **정정 자동 재수집의 판단 — 순수 모듈**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md`
 * D5 · D6 · D8 · D9 · §0 의 3차 결정 R3-2 · R3-4).
 *
 * 외부 대조가 찾을 결함 후보(감지 `crosscheck.ts --emit`)를 **그 차이를 만들 수 있는 경기**로 바꾸고(계획), 받기 도구
 * (`cli-games.ts`)의 결과로 시도 이력을 갈고(③④⑤), 보고와 종료 코드를 낸다. 진입점(`scripts/correction-refetch.ts`)이
 * 자식 실행·파일·git·DB 를 맡고 **판단은 전부 여기에 있다** — 시험이 그대로 부를 수 있어야 하기 때문이다.
 *
 * ⚠**시계를 안 읽는다**(M6) — 「지금」은 진입점이 한 번 읽어 문자열로 넘긴다. **I/O 도 없다** — DB 는 넘겨받은 읽기 함수
 *   (`CandidateReader`)로만 본다(그 함수가 던지면 그대로 위로 간다 · `settleHistory` 의 ⑤ 만 잡아 `judgeError` 로 돌려준다).
 * ⚠**문자열 비교는 전부 UTF-16 코드 단위**(`cmp` · JS 기본 비교)다. `localeCompare` 를 쓰지 않는다 — 로캘에 따라 갈리고,
 *   키에 일본어(`暴投`)가 들어 있다(설계 R2-4 · 실측: ja-JP 에서 `2026|d|` 와 `2026|db|` 의 차례가 코드 단위와 반대다).
 * ⚠**선수는 ID 로만 잇는다**(M10) — 키가 `시즌|팀|역할|player_id|항목` 이고 이름은 보고에만 나온다.
 * ⚠**모르면 넓히지 않는다 · 기본값으로 메우지 않는다**(M7 · M11) — 감지 결과의 모양이 틀리면 `detector_error`, 이력이 틀리면
 *   `history_invalid`, 받기 결과가 틀리면 「결과 없음」이다. 취득 시각을 못 읽으면 **빼지 않는다**(받는 쪽 · D5 의 E2).
 * ⚠**잎만 가져온다** — `@bb-app/store/refetch-limit` · `@bb-app/aggregate/crosscheck-fields`(둘 다 import 0) ·
 *   `crosscheck-classify.ts`(import 0) · `./date-window.ts`(그 잎만 가져온다).
 */
import {
  AUTO_REFETCH_MAX_DEFECTS,
  AUTO_REFETCH_MAX_GAMES,
  AUTO_REFETCH_START_DEADLINE_MIN,
  MAX_REFETCH_DATES,
} from "@bb-app/store/refetch-limit";
import { CROSSCHECK_FIELDS, parseFieldValue } from "@bb-app/aggregate/crosscheck-fields";
import type { CrosscheckKind, CrosscheckTargetField } from "@bb-app/aggregate/crosscheck-fields";
// ⚠측정 실패 사유의 닫힌 목록은 감지기 쪽 한 벌이다(M1) — 이 파일은 import 가 0개인 잎이다
import { CROSSCHECK_UNMEASURED_REASONS } from "../packages/aggregate/src/crosscheck-classify.ts";
import { isYmd } from "./date-window.ts";

// ── 상수 ──────────────────────────────────────────────────────────────────────

/** 시도 이력 — 워크플로가 실행 ref 에 커밋하는 `ops/` 의 넷째 파일(설계 D8 · 공개 저장소라 수치를 넣지 않는다) */
export const HISTORY_PATH = "ops/correction-refetch.json";
/**
 * 이력 파일 크기 상한. ⚠**설계에 없는 걸쇠다** — 임포트는 크기 상한을 둔다(`_common/docs/security-checklist.md`).
 * 키 하나는 수백 바이트이고 키는 결함 상한(20)을 넘게 늘지 않으므로 1 MiB 는 정상 판의 수천 배다.
 */
export const HISTORY_MAX_BYTES = 1_048_576;
/** 경기 하나의 논리 페이지(`GAME_PAGES` = index·playbyplay·box·roster) — 계획만 보고의 「논리 페이지(예정)」. 시험이 아카이버 값과 맞댄다 */
export const PAGES_PER_GAME = 4;
/** 받기 도구에 넘기는 `--delay`(ms) — ⚠아카이버의 `CLI_GAMES_DEFAULT_DELAY_MS` 와 같아야 한다(T13 의 시간 계산이 그 값에 기댄다 · 시험이 맞댄다) */
export const FETCH_DELAY_MS = 3000;
/**
 * 한 경기 최악(ms) = 4장 × (2시도 × (1 + 3홉) × (3초 간격 + 5초 상한) + 백오프 3 + 6초) = 292초(설계 D7-8).
 * ⚠아카이버 상수로 다시 셈한 값과 같다는 것을 시험이 지킨다(`correction-refetch-wiring.test.ts` · T13 과 한 벌).
 */
export const FETCH_WORST_GAME_MS = 292_000;
/** 받기 자식 시간 제한의 여유(설계 D7-9 의 「+ 60초」) */
export const FETCH_CHILD_MARGIN_MS = 60_000;
/** 자식 시간 제한(설계 D7-9) — git fetch 60초 · 감지 각 120초(실측 0.43초) · 다시 적재 600초(실측 최장 102.8초) */
export const CHILD_TIMEOUT_MS = { git: 60_000, detect: 120_000, reload: 600_000 } as const;
/** 다시 적재의 쓰기 상한 — ⚠빠뜨리면 기본 100,000행에서 멈춘다(한 번 적재가 889,666행 · 설계 D7-10) */
export const RELOAD_MAX_WRITES = "5000000";
/** 작업 폴더(`--work-dir`)의 산출 이름(설계 D9 「보고 — 경로」) */
export const WORK_FILES = {
  detectBefore: "detect-before.json",
  detectAfter: "detect-after.json",
  games: "games.txt",
  fetchResult: "fetch-result.json",
  reportJson: "report.json",
  reportText: "report.txt",
  historyBase: "history.base",
  historyNext: "history.next.json",
} as const;

const START_DEADLINE_MS = AUTO_REFETCH_START_DEADLINE_MIN * 60_000;
const STARTED_AT_MAX_MS = 6 * 3_600_000;

// ── 공통 ──────────────────────────────────────────────────────────────────────

/** **UTF-16 코드 단위 비교**(설계 R2-4) — `localeCompare` 를 쓰지 마라 */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const UTC_ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{3})?Z$/;

/**
 * UTC ISO 시각(`2026-09-28T20:40:57Z` · `toISOString()` 모양)인가. ⚠**시간대가 없는 값은 받지 않는다** — `Date.parse` 가
 * 실행 기계의 현지 시간으로 읽어 JST 기계와 UTC CI 에서 9시간 갈린다. 넘친 날짜(2/30 → 3/2)도 되돌려 비교해 거른다.
 * ⚠`new Date(ms)` 는 주어진 값을 해석할 뿐 시계를 읽지 않는다(M6).
 */
export function isUtcIso(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = UTC_ISO.exec(s);
  if (m === null) return false;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === m[1];
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 고유한 날짜를 **내림차순**(최근부터)으로 */
function datesDesc(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort((a, b) => cmp(b, a));
}

// ── 자식 프로세스의 끝 ─────────────────────────────────────────────────────────

/** 자식의 끝(진입점의 `spawnSync` 를 옮긴 것) */
export interface ChildExit {
  /** 종료 코드 — 신호로 죽었거나 띄우지 못했으면 null */
  readonly code: number | null;
  readonly signal: string | null;
  /** 자식 시간 제한(설계 D7-9)에 걸렸다 */
  readonly timedOut: boolean;
  /** 띄우기 실패 등 오류 문장 */
  readonly error: string | null;
}

export function describeExit(c: ChildExit): string {
  if (c.timedOut) return "시간 제한";
  if (c.code !== null) return `종료 ${String(c.code)}`;
  if (c.signal !== null) return `신호 ${c.signal}`;
  return c.error !== null ? `띄우지 못함(${c.error})` : "종료 코드 없음";
}

const childOk = (c: ChildExit): boolean => !c.timedOut && c.code === 0;

// ── 결함 키 ───────────────────────────────────────────────────────────────────

export type Kind = CrosscheckKind;
export type Direction = "ours_more" | "ours_less";

/** 결함 키 = `시즌|팀|역할|player_id|항목`(설계 D5) */
export function defectKey(season: number, team: string, kind: Kind, playerId: string, field: string): string {
  return `${String(season)}|${team}|${kind}|${playerId}|${field}`;
}

const KEY = /^(\d{4})\|([a-z]+)\|(batting|pitching)\|([^|]+)\|([^|]+)$/;

/** 닫힌 표(D4)의 **재수집 대상** 행 — 대상이 아니거나 표에 없으면 null */
export function targetField(kind: Kind, field: string): CrosscheckTargetField | null {
  const row = CROSSCHECK_FIELDS.find((f) => f.kind === kind && f.field === field);
  return row !== undefined && row.refetch ? row : null;
}

export interface ParsedKey {
  readonly season: number;
  readonly team: string;
  readonly kind: Kind;
  readonly playerId: string;
  readonly field: string;
}

/** 키를 가른다 — 모양이 틀렸거나 그 항목이 재수집 대상이 아니면 null(이력의 키 규칙 · 설계 D8) */
export function parseKey(key: string): ParsedKey | null {
  const m = KEY.exec(key);
  if (m === null) return null;
  const kind = m[3] as Kind;
  if (targetField(kind, m[5]!) === null) return null;
  return { season: Number(m[1]), team: m[2]!, kind, playerId: m[4]!, field: m[5]! };
}

// ── 시도 이력(설계 D8) ────────────────────────────────────────────────────────

export interface Attempt {
  readonly date: string;
  readonly at: string;
  readonly run: string;
}

export interface HistoryEntry {
  readonly direction: Direction;
  /** 일화 시작 — 판정(E2)의 기준선 */
  readonly first_seen_at: string;
  readonly first_seen_run: string;
  readonly last_seen_at: string;
  /** 기록이지 판정 근거가 아니다(D8) */
  readonly attempts: readonly Attempt[];
  /** 처음 소진된 시각(없으면 null — 파일에서는 칸을 뺀다) */
  readonly exhausted_at: string | null;
}

export interface History {
  readonly keys: ReadonlyMap<string, HistoryEntry>;
}

export const EMPTY_HISTORY: History = { keys: new Map() };

export type HistoryParse = { readonly ok: true; readonly history: History } | { readonly ok: false; readonly violation: string };

/** 시도의 전순서 — 날짜 내림차순 → 시각 오름차순 → 실행 오름차순(설계 D8 · R2-4) */
function sortAttempts(a: readonly Attempt[]): Attempt[] {
  return [...a].sort((x, y) => cmp(y.date, x.date) || cmp(x.at, y.at) || cmp(x.run, y.run));
}

const ENTRY_FIELDS = new Set(["direction", "first_seen_at", "first_seen_run", "last_seen_at", "attempts", "exhausted_at"]);
const ATTEMPT_FIELDS = new Set(["date", "at", "run"]);

/** 항목 하나를 검증한다 — 위반이면 그 문장 */
function entryOf(key: string, raw: unknown): HistoryEntry | string {
  if (parseKey(key) === null) return `키 모양이 틀렸거나 재수집 대상 항목이 아니다: ${JSON.stringify(key)}`;
  if (!isRecord(raw)) return `${key}: 항목이 객체가 아니다`;
  const extra = Object.keys(raw).filter((k) => !ENTRY_FIELDS.has(k));
  if (extra.length > 0) return `${key}: 모르는 칸 ${extra.join(", ")}`;
  const { direction, first_seen_at, first_seen_run, last_seen_at, attempts } = raw;
  if (direction !== "ours_more" && direction !== "ours_less") return `${key}: direction 이 ours_more·ours_less 가 아니다(${JSON.stringify(direction)})`;
  if (!isUtcIso(first_seen_at)) return `${key}: first_seen_at 이 UTC ISO 시각이 아니다(${JSON.stringify(first_seen_at)})`;
  if (!isUtcIso(last_seen_at)) return `${key}: last_seen_at 이 UTC ISO 시각이 아니다(${JSON.stringify(last_seen_at)})`;
  if (typeof first_seen_run !== "string") return `${key}: first_seen_run 이 문자열이 아니다`;
  let exhausted: string | null = null;
  if ("exhausted_at" in raw) {
    if (!isUtcIso(raw["exhausted_at"])) return `${key}: exhausted_at 이 UTC ISO 시각이 아니다(${JSON.stringify(raw["exhausted_at"])})`;
    exhausted = raw["exhausted_at"];
  }
  if (!Array.isArray(attempts)) return `${key}: attempts 가 배열이 아니다`;
  const seen = new Set<string>();
  const list: Attempt[] = [];
  for (const [i, a] of attempts.entries()) {
    if (!isRecord(a)) return `${key}: attempts[${String(i)}] 가 객체가 아니다`;
    const more = Object.keys(a).filter((k) => !ATTEMPT_FIELDS.has(k));
    if (more.length > 0) return `${key}: attempts[${String(i)}] 에 모르는 칸 ${more.join(", ")}`;
    const { date, at, run } = a;
    if (typeof date !== "string" || !isYmd(date)) return `${key}: attempts[${String(i)}].date 가 YYYY-MM-DD 가 아니다(${JSON.stringify(date)})`;
    if (!isUtcIso(at)) return `${key}: attempts[${String(i)}].at 이 UTC ISO 시각이 아니다(${JSON.stringify(at)})`;
    if (typeof run !== "string") return `${key}: attempts[${String(i)}].run 이 문자열이 아니다`;
    const pair = JSON.stringify([date, at]);
    if (seen.has(pair)) return `${key}: attempts 에 같은 date+at 이 두 번 있다(${date} · ${at})`;
    seen.add(pair);
    list.push({ date, at, run });
  }
  return { direction, first_seen_at, first_seen_run, last_seen_at, attempts: list, exhausted_at: exhausted };
}

/**
 * 이력 파일을 **엄격하게** 읽는다(설계 D8 · 3차 리뷰 R3-4).
 *
 * ⚠**「파일 없음」(`null`)만 빈 이력이다.** 파일이 **있는데** 아래 중 하나라도 어기면 손상이고, 손상을 빈 이력으로 받지 않는다 —
 *   그러면 이미 받은 경기를 다시 받는다(L1). 손상이면 부르는 쪽은 받지 않고(`history_invalid`) 원격 파일을 보존한다.
 * - UTF-8 · JSON · 최상위 객체(칸은 `schema`·`keys` 뿐) · `schema === 1` · `keys` 가 객체
 * - 키가 `^\d{4}\|[a-z]+\|(batting|pitching)\|[^|]+\|[^|]+$` 이고 그 항목이 D4 의 「대상」 행
 * - `direction` · 시각 칸(UTC ISO) · `first_seen_run`·`attempts[].run` 문자열 · `attempts[].date` 가 있는 날짜 · `date+at` 중복 없음
 * - ⚠**모르는 칸은 위반이다**(스키마 1 은 칸이 닫혀 있다) · ⚠크기 상한(`HISTORY_MAX_BYTES`)도 위반이다(설계 밖 걸쇠)
 * ⚠키를 일반 객체가 아니라 `Map` 에 담는다 — `__proto__` 같은 키는 위 키 규칙에서 이미 떨어진다.
 */
export function parseHistory(bytes: Uint8Array | null): HistoryParse {
  if (bytes === null) return { ok: true, history: EMPTY_HISTORY };
  const bad = (violation: string): HistoryParse => ({ ok: false, violation });
  if (bytes.byteLength > HISTORY_MAX_BYTES) return bad(`파일이 ${String(HISTORY_MAX_BYTES)}바이트를 넘는다(${String(bytes.byteLength)})`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bad("UTF-8 로 안 읽힌다");
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return bad(`JSON 으로 안 읽힌다(${errorText(e)})`);
  }
  if (!isRecord(doc)) return bad("최상위가 객체가 아니다");
  const extra = Object.keys(doc).filter((k) => k !== "schema" && k !== "keys");
  if (extra.length > 0) return bad(`모르는 최상위 칸: ${extra.join(", ")}`);
  if (doc["schema"] !== 1) return bad(`schema 가 1 이 아니다(${JSON.stringify(doc["schema"]) ?? "없음"})`);
  const keys = doc["keys"];
  if (!isRecord(keys)) return bad("keys 가 객체가 아니다");
  const out = new Map<string, HistoryEntry>();
  for (const [key, raw] of Object.entries(keys)) {
    const e = entryOf(key, raw);
    if (typeof e === "string") return bad(e);
    out.set(key, e);
  }
  return { ok: true, history: { keys: out } };
}

/**
 * 결정론적 바이트로 쓴다(설계 D8 · R2-4) — 키는 코드 단위 오름차순, `attempts` 는 날짜 내림차순 → 시각 오름차순,
 * 2칸 들여쓰기에 끝 줄바꿈. `exhausted_at` 이 없으면 칸을 뺀다.
 */
export function serializeHistory(h: History): string {
  const keys: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of [...h.keys.keys()].sort(cmp)) {
    const e = h.keys.get(k)!;
    keys[k] = {
      direction: e.direction,
      first_seen_at: e.first_seen_at,
      first_seen_run: e.first_seen_run,
      last_seen_at: e.last_seen_at,
      attempts: sortAttempts(e.attempts).map((a) => ({ date: a.date, at: a.at, run: a.run })),
      ...(e.exhausted_at !== null ? { exhausted_at: e.exhausted_at } : {}),
    };
  }
  return `${JSON.stringify({ schema: 1, keys }, null, 2)}\n`;
}

// ── 감지 결과(설계 D2 · 작업 A 의 실제 계약) ───────────────────────────────────

export type DetectStatus = "no_defects" | "defects" | "unmeasured";
export type AsOfSource = "genzai" | "partial" | "absent" | "override";

export interface DetectDefect {
  readonly team: string;
  readonly kind: Kind;
  readonly player_id: string;
  readonly name: string;
  readonly field: string;
  readonly ours: string;
  readonly published: string;
}

export interface DetectResult {
  readonly season: number;
  readonly competition: string;
  readonly status: DetectStatus;
  readonly reason: string | null;
  readonly reason_detail: string | null;
  readonly as_of: { readonly date: string | null; readonly source: AsOfSource };
  readonly defects: readonly DetectDefect[];
}

export type DetectRead =
  | { readonly ok: true; readonly exit: ChildExit; readonly result: DetectResult }
  | { readonly ok: false; readonly exit: ChildExit; readonly error: string };

const AS_OF_SOURCES: readonly string[] = ["genzai", "partial", "absent", "override"];
const DEFECT_FIELDS = ["team", "kind", "player_id", "name", "field", "ours", "published"] as const;

/**
 * 감지기(`crosscheck.ts --emit`)의 끝과 결과 JSON 을 읽는다(설계 D2 · D6 의 관문 1).
 *
 * ⚠**`status` 를 먼저 본다** — `unmeasured` 여도 `defects` 가 실릴 수 있다(부분 측정 · 작업 A 보고 §3-3). 부르는 쪽은
 *   `status` 로 가르고 그 결함으로 경기를 받지 않는다.
 * ⚠**모양이 틀리면 오류다**(M7) — 종료 0·2 밖 · 결과 없음 · 시간 제한 · 종료와 `status` 의 불일치(0 ↔ 측정 성공 · 2 ↔ unmeasured) ·
 *   다른 시즌 · `genzai` 인데 기준일 없음 · `defects`/`no_defects` 와 결함 수의 불일치 · 결함 한 줄의 칸 모양.
 */
export function readDetect(exit: ChildExit, text: string | null, season: number): DetectRead {
  const bad = (error: string): DetectRead => ({ ok: false, exit, error });
  if (exit.timedOut) return bad(`감지기가 시간 제한(${String(CHILD_TIMEOUT_MS.detect / 1000)}초)에 걸렸다`);
  if (exit.code !== 0 && exit.code !== 2) return bad(`감지기가 ${describeExit(exit)}로 끝났다 — 0·2 가 아니다`);
  if (text === null) return bad(`감지 결과 파일이 없다(${describeExit(exit)})`);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return bad(`감지 결과가 JSON 이 아니다(${errorText(e)})`);
  }
  if (!isRecord(doc)) return bad("감지 결과의 최상위가 객체가 아니다");
  if (doc["schema"] !== 1) return bad(`감지 결과 schema 가 1 이 아니다(${JSON.stringify(doc["schema"]) ?? "없음"})`);
  if (doc["season"] !== season) return bad(`감지 결과의 시즌이 ${JSON.stringify(doc["season"]) ?? "없음"} 이다(물은 시즌 ${String(season)})`);
  const competition = doc["competition"];
  if (typeof competition !== "string" || competition === "") return bad("감지 결과에 competition 이 없다");
  const status = doc["status"];
  if (status !== "no_defects" && status !== "defects" && status !== "unmeasured") return bad(`모르는 status: ${JSON.stringify(status) ?? "없음"}`);
  if ((exit.code === 2) !== (status === "unmeasured")) return bad(`종료 ${String(exit.code)} 와 status ${status} 가 안 맞는다`);
  const reason = doc["reason"];
  if (status === "unmeasured") {
    if (typeof reason !== "string" || !(CROSSCHECK_UNMEASURED_REASONS as readonly string[]).includes(reason)) {
      return bad(`unmeasured 의 reason 이 닫힌 목록에 없다(${JSON.stringify(reason) ?? "없음"})`);
    }
  } else if (reason !== null) return bad(`측정 성공인데 reason 이 있다(${JSON.stringify(reason)})`);
  const detail = doc["reason_detail"];
  if (detail !== null && typeof detail !== "string") return bad("reason_detail 이 문자열·null 이 아니다");
  const asOf = doc["as_of"];
  if (!isRecord(asOf)) return bad("as_of 가 객체가 아니다");
  const asOfDate = asOf["date"];
  const source = asOf["source"];
  if (typeof source !== "string" || !AS_OF_SOURCES.includes(source)) return bad(`모르는 as_of.source: ${JSON.stringify(source) ?? "없음"}`);
  if (asOfDate !== null && (typeof asOfDate !== "string" || !isYmd(asOfDate))) return bad(`as_of.date 가 YYYY-MM-DD·null 이 아니다(${JSON.stringify(asOfDate)})`);
  if (source === "genzai" && asOfDate === null) return bad("as_of 가 genzai 인데 기준일이 없다");
  const raw = doc["defects"];
  if (!Array.isArray(raw)) return bad("defects 가 배열이 아니다");
  const defects: DetectDefect[] = [];
  for (const [i, d] of raw.entries()) {
    if (!isRecord(d)) return bad(`defects[${String(i)}] 가 객체가 아니다`);
    for (const f of DEFECT_FIELDS) if (typeof d[f] !== "string") return bad(`defects[${String(i)}].${f} 가 문자열이 아니다`);
    if (d["kind"] !== "batting" && d["kind"] !== "pitching") return bad(`defects[${String(i)}].kind 가 batting·pitching 이 아니다`);
    for (const f of ["team", "player_id", "field"] as const) if (d[f] === "") return bad(`defects[${String(i)}].${f} 가 비었다`);
    defects.push({
      team: d["team"] as string,
      kind: d["kind"],
      player_id: d["player_id"] as string,
      name: d["name"] as string,
      field: d["field"] as string,
      ours: d["ours"] as string,
      published: d["published"] as string,
    });
  }
  if (status === "defects" && defects.length === 0) return bad("status 가 defects 인데 결함이 0건이다");
  if (status === "no_defects" && defects.length > 0) return bad("status 가 no_defects 인데 결함이 있다");
  return {
    ok: true,
    exit,
    result: {
      season,
      competition,
      status,
      reason: status === "unmeasured" ? (reason as string) : null,
      reason_detail: detail,
      as_of: { date: asOfDate, source: source as AsOfSource },
      defects,
    },
  };
}

// ── 대상 판정(설계 D4 · D5) ───────────────────────────────────────────────────

export interface KeyInfo {
  readonly key: string;
  readonly team: string;
  readonly kind: Kind;
  readonly playerId: string;
  /** 보고에만 쓴다(M10 — 잇지 않는다) */
  readonly name: string;
  readonly field: string;
  readonly ours: string;
  readonly published: string;
  /** 대상이면 방향, 아니면 null */
  readonly direction: Direction | null;
  /** 대상이 아닌 사유(대상이면 null) */
  readonly why: string | null;
}

/** 결함 한 줄의 전순서(같은 키 안에서 대표 줄을 정한다 — 입력 순서와 무관하게) */
function defectCmp(a: DetectDefect, b: DetectDefect): number {
  return cmp(a.name, b.name) || cmp(a.ours, b.ours) || cmp(a.published, b.published);
}

function whyNot(d: DetectDefect, group: readonly DetectDefect[]): string | null {
  if (!/^[a-z]+$/.test(d.team) || d.player_id.includes("|") || d.field.includes("|")) {
    return "키 모양이 이력 규칙에 맞지 않는다(팀은 [a-z]+ · ID·항목에 「|」 없음)";
  }
  const row = CROSSCHECK_FIELDS.find((f) => f.kind === d.kind && f.field === d.field);
  if (row === undefined) return `닫힌 표에 없는 항목(${d.kind}/${d.field})`;
  if (!row.refetch) return row.why;
  if (new Set(group.map((g) => JSON.stringify([g.ours, g.published]))).size > 1) return "같은 키가 값이 다르게 두 번 이상 나왔다";
  const o = parseFieldValue(d.field, d.ours);
  const p = parseFieldValue(d.field, d.published);
  if (o === null || p === null) return `값을 수로 못 읽었다(우리 ${d.ours} · 공표 ${d.published})`;
  if (o === p) return `수로는 같다(우리 ${d.ours} · 공표 ${d.published}) — 표기 차이`;
  return null;
}

/**
 * 감지 결과의 결함을 **키로 모아** 대상인지 가른다(설계 D4 「값 해석」 · D5 「결함 키」).
 * - 대상 = 닫힌 표의 대상 행 · 두 값이 수로 읽히고 다르다 → 방향(`우리 > 공표` 면 `ours_more`)
 * - 같은 키가 두 번이면 하나로 · 값이 다르면 대상 아님(어느 쪽인지 모른다)
 * @returns 키 코드 단위 오름차순(입력 순서와 무관 · R2-4)
 */
export function classifyDefects(r: DetectResult): KeyInfo[] {
  const groups = new Map<string, DetectDefect[]>();
  for (const d of r.defects) {
    const k = defectKey(r.season, d.team, d.kind, d.player_id, d.field);
    const g = groups.get(k);
    if (g === undefined) groups.set(k, [d]);
    else g.push(d);
  }
  const out: KeyInfo[] = [];
  for (const key of [...groups.keys()].sort(cmp)) {
    const group = [...groups.get(key)!].sort(defectCmp);
    const d = group[0]!;
    const why = whyNot(d, group);
    let direction: Direction | null = null;
    if (why === null) direction = parseFieldValue(d.field, d.ours)! > parseFieldValue(d.field, d.published)! ? "ours_more" : "ours_less";
    out.push({ key, team: d.team, kind: d.kind, playerId: d.player_id, name: d.name, field: d.field, ours: d.ours, published: d.published, direction, why });
  }
  return out;
}

// ── 시간 예산(설계 D6 의 8 · R2-6) ──────────────────────────────────────────

export type TimeBudget =
  | { readonly kind: "ok" | "time_budget"; readonly elapsedMs: number; readonly deadline: string }
  | { readonly kind: "started_at_unknown"; readonly elapsedMs: number | null };

/**
 * **이 문서의 모든 「25분」은 이 식이다**(설계 D6 의 8):
 * `elapsedMs = Date.parse(now) − Date.parse(BB_COLLECT_STARTED_AT)` ·
 * `started_at_unknown ⇔ 못 읽음 ∨ < 0 ∨ > 6시간` · `time_budget ⇔ elapsedMs >= 25 × 60_000`.
 * 경기마다의 마감(받기 도구 `--deadline`)도 같은 시각이다: `잡 시작 + 1_500_000ms`.
 * ⚠잡 시작은 UTC ISO 만 읽는다(`isUtcIso`) — 시간대 없는 값은 모름이다.
 */
export function timeBudget(collectStartedAt: string | undefined, now: string): TimeBudget {
  if (!isUtcIso(collectStartedAt)) return { kind: "started_at_unknown", elapsedMs: null };
  const startMs = Date.parse(collectStartedAt);
  const elapsedMs = Date.parse(now) - startMs;
  if (Number.isNaN(elapsedMs)) return { kind: "started_at_unknown", elapsedMs: null };
  if (elapsedMs < 0 || elapsedMs > STARTED_AT_MAX_MS) return { kind: "started_at_unknown", elapsedMs };
  return {
    kind: elapsedMs >= START_DEADLINE_MS ? "time_budget" : "ok",
    elapsedMs,
    deadline: new Date(startMs + START_DEADLINE_MS).toISOString(),
  };
}

/** `90_606` → `1분 30초` */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60))}분 ${String(s % 60)}초`;
}

// ── ①④ 이력 갱신(설계 D8 의 표) ──────────────────────────────────────────────

/**
 * 감지 결과로 이력을 간다(설계 D8 의 갱신 표).
 *
 * | 감지 결과 | 결함 목록에 있는 키(대상 · 해석됨) | 목록에 없는 키 | 다른 시즌의 키 |
 * |---|---|---|---|
 * | `unmeasured` · 감지기 오류 | 그대로 | 그대로 | 그대로 |
 * | 측정 성공 · `genzai` · 결함 ≤ 20 | 없으면 새 일화(일화 시작 = 잡 시작) · 있으면 `last_seen_at` · 방향이 다르면 새 일화로 갈아 끼운다 | 지운다(풀렸다) | 지운다 |
 * | 측정 성공 · 그 밖 | 있으면 `last_seen_at` · 새로 만들지 않는다 | 지운다 | 지운다 |
 *
 * ⚠**「그 밖」에서 방향이 바뀐 키는 지운다**(설계가 정하지 않은 칸 — 이렇게 닫았다). 방향이 바뀐 결함은 다른 일화이고,
 *   그 실행은 새 일화를 열 수 없으므로 옛 일화만 닫는다. 다음 `genzai` 실행이 새 일화를 연다(어느 쪽이든 같은 결과다).
 * ⚠잡 시작을 모르면(`started_at_unknown`) 새 일화의 시작은 `now` 다 — 후보가 넓어지는 쪽이고 그 실행은 받지 않는다.
 */
export function updateHistory(h: History, detect: DetectRead, collectStartedAt: string | undefined, now: string, run: string): History {
  if (!detect.ok || detect.result.status === "unmeasured") return h;
  const r = detect.result;
  const canCreate = r.as_of.source === "genzai" && r.defects.length <= AUTO_REFETCH_MAX_DEFECTS;
  const current = new Map<string, Direction>();
  for (const i of classifyDefects(r)) if (i.direction !== null) current.set(i.key, i.direction);
  const start = timeBudget(collectStartedAt, now).kind === "started_at_unknown" ? now : (collectStartedAt as string);
  const out = new Map<string, HistoryEntry>();
  for (const k of [...new Set([...h.keys.keys(), ...current.keys()])].sort(cmp)) {
    const dir = current.get(k);
    if (dir === undefined) continue; // 풀렸다 · 다른 시즌 · 대상이 아니게 됐다
    const old = h.keys.get(k);
    if (old !== undefined && old.direction === dir) {
      out.set(k, { ...old, last_seen_at: now });
      continue;
    }
    if (!canCreate) continue; // 새 일화를 열 수 없다(방향이 바뀌었으면 옛 일화를 닫는다)
    out.set(k, { direction: dir, first_seen_at: start, first_seen_run: run, last_seen_at: now, attempts: [], exhausted_at: null });
  }
  return { keys: out };
}

// ── 후보 · 계획(설계 D5 · D6) ─────────────────────────────────────────────────

export interface CandidateQuery {
  readonly season: number;
  readonly competition: string;
  /** 기준일(`as_of.date`) — 범위 조각이 `game_date ≤ 기준일` 로 자른다(E1) */
  readonly through: string;
  readonly team: string;
  readonly kind: Kind;
  readonly playerId: string;
  readonly field: string;
  readonly direction: Direction;
}

/** 후보 경기 한 줄(`scripts/correction-candidates.ts` 의 SELECT) */
export interface CandidateRow {
  readonly game_id: string;
  readonly game_date: string;
  /** box 사이드카의 「마지막으로 본 시각」 — E2 의 근거 */
  readonly fetched_at: string | null;
  /** 그 경기의 항목 값(보고의 「전 값」) */
  readonly value: number | string | null;
}

export type CandidateReader = (q: CandidateQuery) => readonly CandidateRow[];

/** 다시 적재 뒤의 그 경기·선수의 값 — 행이 없으면 `found: false`(M11 — 「행 없음」과 값 NULL 을 가른다) */
export type AfterValue = { readonly found: true; readonly value: number | string | null } | { readonly found: false };

export interface ValueQuery {
  readonly kind: Kind;
  readonly field: string;
  readonly gameId: string;
  readonly playerId: string;
}

/** 계획·소진 판정에서 던지는 오류 — 진입점이 「계획 실패」(종료 1)로 센다(설계 D9 의 4) */
export class PlanError extends Error {
  override name = "PlanError";
}

const GAME_ID = /^(\d{4})\/(\d{2})(\d{2})\/[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * 경기 ID(`<시즌>/<MMDD>/<슬러그>` · DB `game.game_id`)의 경기일 — 모양이 틀렸거나 **없는 날짜**(`2026/0230/…`)면 null.
 * ⚠**받기 도구의 `gameRefFromId`(`packages/archiver/src/discover.ts`)와 판정이 같아야 한다**(3중 검토 1차 P3-2 · M1) — 계획이 통과시킨
 *   ID 를 받기 도구가 거부하면 요청 0 · 결과 없음 · 단계 종료 1 이고, 반대면 계획 실패(종료 1)다. 이 파일은 잎만 가져오므로(머리말)
 *   두 벌이고, 같은 코퍼스로 둘을 맞대는 시험이 지킨다(`scripts/test/correction-refetch-wiring.test.ts`).
 * ⚠**1000년 미만 시즌(`0000`~`0999`)에서는 두 벌이 같지 않다** — 달력 검사가 0~99년에서 갈리고(`isYmd` 는 `Date.UTC` 라 그 해를
 *   1900년대로 읽는다), 받기 도구는 그 범위에서 **자기 왕복이 깨진다**(`gameIdOf` 가 시즌을 `Number` 로 바꿔 앞 0 을 버린다 — 실측).
 *   NPB 시즌은 1936~ 이고 DB 의 ID 는 같은 `\d{4}` 일정 링크에서 오므로 나올 수 없는 값이라 여기서 맞추지 않는다 — 막아야 하면 두 벌을 함께 고친다.
 */
export function gameIdDate(id: string): string | null {
  const m = GAME_ID.exec(id);
  if (m === null) return null;
  const date = `${m[1]!}-${m[2]!}-${m[3]!}`;
  return isYmd(date) ? date : null;
}

/** DB 가 준 행을 그대로 믿지 않는다 — 모양·기준일·ID 와 날짜의 짝이 틀리면 던진다(M7). 정렬해 돌려준다 */
function checkRows(rows: readonly CandidateRow[], through: string): CandidateRow[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const date = gameIdDate(r.game_id);
    if (date === null) throw new PlanError(`후보 행의 경기 ID 모양이 틀렸거나 없는 날짜다: ${JSON.stringify(r.game_id)}`);
    if (r.game_date !== date) {
      throw new PlanError(`후보 행의 경기일이 경기 ID 와 안 맞는다: ${r.game_id} · ${JSON.stringify(r.game_date)}`);
    }
    if (r.game_date > through) throw new PlanError(`후보 행이 기준일(${through}) 뒤다 — 범위 조각이 안 걸렸다: ${r.game_id}`);
    if (seen.has(r.game_id)) throw new PlanError(`후보 행에 같은 경기가 두 번 있다: ${r.game_id}`);
    seen.add(r.game_id);
  }
  return [...rows].sort((a, b) => cmp(b.game_date, a.game_date) || cmp(a.game_id, b.game_id));
}

/** 키 하나의 후보와 제외(설계 D5 의 E2 · E3 · 복원 되돌려짐) */
export interface Exclusions {
  /** 후보 전부(경기일 내림차순 → game_id 오름차순) */
  readonly rows: readonly CandidateRow[];
  /** E2 — 일화 시작과 같거나 뒤에 본 사본(game_id) */
  readonly e2: readonly string[];
  /** E3 — 이 실행의 수동 날짜(game_id) */
  readonly e3: readonly string[];
  readonly remaining: readonly CandidateRow[];
  /** 남은 날짜(내림차순) */
  readonly remainingDates: readonly string[];
  /** 남은 날짜 가운데 이미 시도한 날짜 — 세대 복원으로 옛 사본이 돌아왔다(「되돌려짐(복원) — 다시 후보」) */
  readonly reverted: readonly string[];
  /** 후보 날짜(내림차순) */
  readonly candidateDates: readonly string[];
}

/**
 * E2 · E3 를 가른다(설계 D5). E1(기준일 뒤)은 범위 조각이 이미 뺐고 여기서는 **어겼으면 던진다**.
 * - E2: `game.fetched_at ≥ 일화 시작` 이면 뺀다. ⚠**취득 시각을 못 읽으면 빼지 않는다**(M11 — 모르면 받는 쪽).
 * - E3: 이 실행의 수동 날짜(몇 분 전에 받았다).
 * 한 행은 앞의 것 하나로만 센다(E2 → E3).
 */
export function exclusions(rowsIn: readonly CandidateRow[], entry: HistoryEntry, manualDates: readonly string[], through: string): Exclusions {
  const rows = checkRows(rowsIn, through);
  const since = Date.parse(entry.first_seen_at);
  const manual = new Set(manualDates);
  const e2: string[] = [];
  const e3: string[] = [];
  const remaining: CandidateRow[] = [];
  for (const r of rows) {
    const seen = isUtcIso(r.fetched_at) ? Date.parse(r.fetched_at) : Number.NaN;
    if (Number.isFinite(seen) && Number.isFinite(since) && seen >= since) e2.push(r.game_id);
    else if (manual.has(r.game_date)) e3.push(r.game_id);
    else remaining.push(r);
  }
  const remainingDates = datesDesc(remaining.map((r) => r.game_date));
  const tried = new Set(entry.attempts.map((a) => a.date));
  return {
    rows,
    e2,
    e3,
    remaining,
    remainingDates,
    reverted: remainingDates.filter((d) => tried.has(d)),
    candidateDates: datesDesc(rows.map((r) => r.game_date)),
  };
}

export interface KeyCandidates extends Exclusions {
  readonly key: string;
  readonly info: KeyInfo;
  /** ① 뒤의 이력 항목 */
  readonly entry: HistoryEntry;
}

export interface PlannedGame {
  readonly id: string;
  readonly date: string;
}

interface PlanBase {
  /** 사전 결함의 키 전부(대상·아님 · 코드 단위 정렬) — 측정 못 했으면 빈 배열 */
  readonly keys: readonly KeyInfo[];
  readonly budget: TimeBudget | null;
  readonly dateSlots: number | null;
  /** 대상 키의 후보 — **계획 차례**(남은 날짜 수 오름차순 → 키 코드 단위 오름차순). DB 를 안 읽었으면 null */
  readonly candidates: readonly KeyCandidates[] | null;
}

export interface PlanSkip extends PlanBase {
  readonly kind: "skip";
  /** 「해 보지 않았다」의 사유 코드(설계 D6 의 표) */
  readonly reason: string;
  readonly detail: string;
}

export interface PlanFetch extends PlanBase {
  readonly kind: "fetch";
  /** 고른 날짜 — **고른 차례** */
  readonly dates: readonly string[];
  /** 받는 차례 = 고른 차례(날짜 안에서는 game_id 오름차순) */
  readonly games: readonly PlannedGame[];
  /** 경기마다의 마감 = 잡 시작 + 25분(`--deadline`) */
  readonly deadline: string;
  /** 상한으로 멈췄으면 그 상한(남은 날짜가 있는데 안 고른 것) */
  readonly capped: "date_slots" | "max_games" | null;
  readonly dateSlots: number;
}

export type Plan = PlanSkip | PlanFetch;

export interface PlanInput {
  readonly detect: DetectRead;
  /** 이력 검증의 첫 위반(정상이면 null · 설계 R3-4) */
  readonly historyViolation: string | null;
  /** ① 뒤의 이력 */
  readonly history: History;
  /** `BB_RUN_SLOT`(`scheduled` · `retry` · `manual`) */
  readonly slot: string | undefined;
  /** `parseRefetchDates(BB_REFETCH_DATES)` 그대로 */
  readonly manual: { readonly ok: true; readonly dates: readonly string[] | null } | { readonly ok: false; readonly error: string };
  /** `BB_COLLECT_STARTED_AT`(잡 시작) */
  readonly collectStartedAt: string | undefined;
  /** 진입점이 한 번 읽은 「지금」 */
  readonly now: string;
}

const AS_OF_TEXT: Readonly<Record<string, string>> = {
  absent: "24장 어디에도 기준일(現在)이 없다 — 완결 시즌이거나 문구가 바뀌었다(못 가른다) · 자동 재수집 안 함 · 관문이 판정한다",
  partial: "일부 장에만 기준일이 있다 · 자동 재수집 안 함",
  override: "`--through` 로 사람이 정한 기준일이다 · 자동 재수집 안 함",
};

/**
 * **고르기**(설계 D6). 관문 1~10 을 위에서부터 묻고 처음 걸린 것이 「해 보지 않았다」의 사유다.
 * 1 `detector_error` · 1′ `history_invalid` · 2 `unmeasured:<reason>` · 3 `no_defects` · 4 `retry_slot`·`slot_unknown` ·
 * 5 `as_of:<source>` · 6 `too_many_defects` · 7 `no_eligible` · 8 `started_at_unknown`·`time_budget` · 9 `no_date_slots` ·
 * 10 `all_exhausted`. ⚠**1~9 는 DB 를 읽지 않는다** — 후보 조회는 그 뒤에만 한다.
 *
 * 고르는 순서(전순서 · R2-4): 남은 날짜가 있는 대상 키를 (남은 날짜 수 오름차순, 키 코드 단위 오름차순)으로 세우고, 키마다
 * 남은 날짜를 최근부터 본다. 그날 경기 = **모든 대상 키**의 그 날짜 남은 후보의 합집합(game_id 오름차순). 날짜 자리
 * (`7 − 수동 날짜 수`)나 경기 상한(24)을 넘으면 **그 자리에서 전부 멈춘다** — 건너뛰고 작은 날짜를 찾지 않는다.
 *
 * @throws PlanError 수동 날짜 입력이 틀려 날짜 자리를 셀 수 없을 때(관문 9 자리) · 후보 행이 계약을 어겼을 때 · `read` 가 던질 때(그대로)
 */
export function planRefetch(input: PlanInput, read: CandidateReader): Plan {
  const empty: PlanBase = { keys: [], budget: null, dateSlots: null, candidates: null };
  const skip = (reason: string, detail: string, more: Partial<PlanBase> = {}): PlanSkip => ({ kind: "skip", reason, detail, ...empty, ...more });
  const { detect } = input;
  // 1
  if (!detect.ok) return skip("detector_error", `감지기가 결과를 못 냈다(${detect.error}) · 관문이 판정한다`);
  // 1′
  if (input.historyViolation !== null) return skip("history_invalid", `\`${HISTORY_PATH}\` 이 손상됐다(${input.historyViolation}) · 런북 §7-I`);
  const r = detect.result;
  // 2
  if (r.status === "unmeasured") {
    return skip(`unmeasured:${String(r.reason)}`, `감지기가 재지 못했다(${r.reason_detail ?? String(r.reason)}) · 자동 재수집 안 함 · 관문이 판정한다`);
  }
  const keys = classifyDefects(r);
  // 3
  if (r.status === "no_defects") return skip("no_defects", "외부 대조 결함 후보 0건 — 받을 것이 없다", { keys });
  // 4
  if (input.slot !== "scheduled" && input.slot !== "manual") {
    return input.slot === "retry"
      ? skip("retry_slot", "재시도 슬롯은 받지 않는다(L1 — 하루 6회가 되지 않게) · 다음 정시 실행이 받는다", { keys })
      : skip("slot_unknown", `실행 슬롯을 모른다(BB_RUN_SLOT=${JSON.stringify(input.slot ?? null)}) · 받지 않는다`, { keys });
  }
  // 5
  if (r.as_of.source !== "genzai") return skip(`as_of:${r.as_of.source}`, AS_OF_TEXT[r.as_of.source] ?? r.as_of.source, { keys });
  // 6
  if (r.defects.length > AUTO_REFETCH_MAX_DEFECTS) {
    return skip(
      "too_many_defects",
      `결함 후보 ${String(r.defects.length)}건 > ${String(AUTO_REFETCH_MAX_DEFECTS)} — 정정 하나의 발자국이 아니다(체계적 원인일 가능성이 크다) · 관문이 판정한다`,
      { keys },
    );
  }
  // 7
  const eligible = keys.filter((k) => k.direction !== null);
  if (eligible.length === 0) return skip("no_eligible", "재수집 대상 키가 0개다(비율·행 수 항목이거나 값을 수로 못 읽었다) · 관문이 판정한다", { keys });
  // 8
  const budget = timeBudget(input.collectStartedAt, input.now);
  if (budget.kind === "started_at_unknown") {
    return skip(
      "started_at_unknown",
      `잡 시작 시각을 못 읽었다(BB_COLLECT_STARTED_AT=${JSON.stringify(input.collectStartedAt ?? null)}) — 시간 예산을 셀 수 없어 받지 않는다`,
      { keys, budget },
    );
  }
  if (budget.kind === "time_budget") {
    return skip("time_budget", `잡 시작 뒤 ${fmtElapsed(budget.elapsedMs)}가 지났다(≥ ${String(AUTO_REFETCH_START_DEADLINE_MIN)}분) — 받지 않는다`, { keys, budget });
  }
  // 9
  if (!input.manual.ok) throw new PlanError(`BB_REFETCH_DATES 가 틀려 날짜 자리를 셀 수 없다 — ${input.manual.error}`);
  const manual = input.manual.dates ?? [];
  const dateSlots = MAX_REFETCH_DATES - manual.length;
  if (dateSlots <= 0) {
    return skip("no_date_slots", `수동 재수집 날짜 ${String(manual.length)}일이 날짜 자리 ${String(MAX_REFETCH_DATES)}을 다 썼다`, { keys, budget, dateSlots });
  }
  // 후보 조회(키당 한 번 · ID 로만)
  const through = r.as_of.date as string; // genzai 면 있다(readDetect 가 지킨다)
  const candidates: KeyCandidates[] = eligible.map((info) => {
    const entry = input.history.keys.get(info.key);
    if (entry === undefined) throw new PlanError(`① 뒤 이력에 대상 키가 없다: ${info.key}`);
    const rows = read({
      season: r.season,
      competition: r.competition,
      through,
      team: info.team,
      kind: info.kind,
      playerId: info.playerId,
      field: info.field,
      direction: info.direction as Direction,
    });
    return { key: info.key, info, entry, ...exclusions(rows, entry, manual, through) };
  });
  candidates.sort((a, b) => a.remainingDates.length - b.remainingDates.length || cmp(a.key, b.key));
  // 10
  if (candidates.every((c) => c.remainingDates.length === 0)) {
    return skip("all_exhausted", "대상 키 전부의 남은 날짜가 0 — 후보를 다 다시 받았는데 남았다(소진) · 런북 §7-I", { keys, budget, dateSlots, candidates });
  }
  // 고르기
  const dayGames = new Map<string, Set<string>>();
  for (const c of candidates) {
    for (const row of c.remaining) {
      const s = dayGames.get(row.game_date);
      if (s === undefined) dayGames.set(row.game_date, new Set([row.game_id]));
      else s.add(row.game_id);
    }
  }
  const dates: string[] = [];
  const games: PlannedGame[] = [];
  const chosen = new Set<string>();
  let capped: PlanFetch["capped"] = null;
  outer: for (const c of candidates) {
    for (const d of c.remainingDates) {
      if (dates.includes(d)) continue;
      const fresh = [...(dayGames.get(d) ?? [])].filter((id) => !chosen.has(id)).sort(cmp);
      if (dates.length + 1 > dateSlots) {
        capped = "date_slots";
        break outer;
      }
      if (chosen.size + fresh.length > AUTO_REFETCH_MAX_GAMES) {
        capped = "max_games";
        break outer;
      }
      dates.push(d);
      for (const id of fresh) {
        chosen.add(id);
        games.push({ id, date: d });
      }
    }
  }
  if (games.length === 0) throw new PlanError("고를 수 있는 날짜가 없다 — 하루 경기가 경기 상한을 넘는다");
  return { kind: "fetch", keys, budget, dateSlots, candidates, dates, games, deadline: budget.deadline, capped };
}

/** 받기 도구의 `--ids` 내용 — **LF** · 끝 줄바꿈 하나(작업 B 의 계약 · CR 이면 받기 도구가 종료 2) */
export function gamesTxt(plan: PlanFetch): string {
  return `${plan.games.map((g) => g.id).join("\n")}\n`;
}

/** 받기 자식의 시간 제한 = `max(0, 마감 − 지금) + 292초 + 60초`(설계 D7-9) */
export function fetchChildTimeoutMs(deadline: string, now: string): number {
  return Math.max(0, Date.parse(deadline) - Date.parse(now)) + FETCH_WORST_GAME_MS + FETCH_CHILD_MARGIN_MS;
}

// ── 받기 결과(설계 D7-6 · 작업 B 의 실제 계약) ─────────────────────────────────

export type FetchGameStatus = "recorded" | "prepare_failed" | "commit_failed" | "skipped";

export interface FetchGame {
  readonly id: string;
  readonly status: FetchGameStatus;
  /** `skipped` 일 때만 — `circuit_open` · `deadline` · `http_budget` · `snapshot_failed` */
  readonly reason: string | null;
  /** `commit_failed` 일 때만 — `ok` · `failed` */
  readonly rollback: "ok" | "failed" | null;
  readonly page_fetches: number;
  readonly http_attempts: number;
}

export interface FetchResult {
  readonly page_fetches: number;
  readonly http_attempts: number;
  readonly by_status: Readonly<Record<string, number>>;
  readonly distress: boolean;
  readonly stopped: string | null;
  readonly games: readonly FetchGame[];
  readonly exit: 0 | 1;
}

export type FetchRead =
  | { readonly kind: "result"; readonly exit: ChildExit; readonly result: FetchResult }
  | { readonly kind: "no_result"; readonly exit: ChildExit; readonly error: string };

const SKIP_REASONS: readonly string[] = ["circuit_open", "deadline", "http_budget", "snapshot_failed"];
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * 받기 도구의 끝과 결과 JSON 을 읽는다(작업 B 보고 §5).
 * ⚠**JSON 은 종료 0·1 이고 쓰기에 성공했을 때만 있다** — 종료 2(입력 거부 · 요청 0)·시간 제한·「종료 1 인데 JSON 없음」(쓰기 실패)은
 *   전부 「결과 없음」이다. ⚠**계획과 경기 목록·차례가 다르거나 `exit` 칸이 종료 코드와 다르면 계약 위반이라 결과 없음**이다(M7).
 */
export function readFetchResult(exit: ChildExit, text: string | null, planned: readonly PlannedGame[]): FetchRead {
  const none = (error: string): FetchRead => ({ kind: "no_result", exit, error });
  if (exit.timedOut) return none("자식 시간 제한에 걸렸다");
  if (exit.code === 2) return none("입력을 거부했다(종료 2 · 요청 0)");
  if (exit.code !== 0 && exit.code !== 1) return none(describeExit(exit));
  if (text === null) return none(`결과 JSON 이 없다(${describeExit(exit)})`);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return none(`결과가 JSON 이 아니다(${errorText(e)})`);
  }
  if (!isRecord(doc) || doc["schema"] !== 1) return none("결과 schema 가 1 이 아니다");
  if (doc["exit"] !== exit.code) return none(`결과의 exit(${JSON.stringify(doc["exit"]) ?? "없음"})가 종료 코드(${String(exit.code)})와 다르다`);
  if (!isCount(doc["page_fetches"]) || !isCount(doc["http_attempts"])) return none("page_fetches·http_attempts 가 셈이 아니다");
  const byStatus = doc["by_status"];
  if (!isRecord(byStatus) || !Object.values(byStatus).every(isCount)) return none("by_status 가 셈의 표가 아니다");
  if (typeof doc["distress"] !== "boolean") return none("distress 가 참·거짓이 아니다");
  const stopped = doc["stopped"];
  if (stopped !== null && (typeof stopped !== "string" || !SKIP_REASONS.includes(stopped))) return none(`모르는 stopped: ${JSON.stringify(stopped)}`);
  const raw = doc["games"];
  if (!Array.isArray(raw) || raw.length !== planned.length) return none("경기 수가 계획과 다르다");
  const games: FetchGame[] = [];
  for (const [i, g] of raw.entries()) {
    if (!isRecord(g) || g["id"] !== planned[i]!.id) return none(`${String(i + 1)}번째 경기가 계획(${planned[i]!.id})과 다르다`);
    const status = g["status"];
    if (status !== "recorded" && status !== "prepare_failed" && status !== "commit_failed" && status !== "skipped") return none(`모르는 경기 status: ${JSON.stringify(status)}`);
    const reason = g["reason"];
    if (status === "skipped" ? typeof reason !== "string" || !SKIP_REASONS.includes(reason) : reason !== null) return none(`${planned[i]!.id}: reason 이 status 와 안 맞는다`);
    const rollback = g["rollback"];
    if (status === "commit_failed" ? rollback !== "ok" && rollback !== "failed" : rollback !== null) return none(`${planned[i]!.id}: rollback 이 status 와 안 맞는다`);
    if (!isCount(g["page_fetches"]) || !isCount(g["http_attempts"])) return none(`${planned[i]!.id}: 셈 칸이 셈이 아니다`);
    games.push({
      id: planned[i]!.id,
      status,
      reason: status === "skipped" ? (reason as string) : null,
      rollback: status === "commit_failed" ? (rollback as "ok" | "failed") : null,
      page_fetches: g["page_fetches"],
      http_attempts: g["http_attempts"],
    });
  }
  return {
    kind: "result",
    exit,
    result: {
      page_fetches: doc["page_fetches"],
      http_attempts: doc["http_attempts"],
      by_status: { ...byStatus } as Record<string, number>,
      distress: doc["distress"],
      stopped,
      games,
      exit: exit.code as 0 | 1,
    },
  };
}

export interface FetchCounts {
  readonly recorded: number;
  readonly prepareFailed: number;
  readonly commitFailed: number;
  readonly rollbackOk: number;
  readonly rollbackFailed: number;
  readonly snapshotFailed: number;
  readonly skipped: number;
}

export function fetchCounts(f: FetchRead): FetchCounts {
  const games = f.kind === "result" ? f.result.games : [];
  const n = (p: (g: FetchGame) => boolean): number => games.filter(p).length;
  return {
    recorded: n((g) => g.status === "recorded"),
    prepareFailed: n((g) => g.status === "prepare_failed"),
    commitFailed: n((g) => g.status === "commit_failed"),
    rollbackOk: n((g) => g.status === "commit_failed" && g.rollback === "ok"),
    rollbackFailed: n((g) => g.status === "commit_failed" && g.rollback === "failed"),
    snapshotFailed: n((g) => g.status === "skipped" && g.reason === "snapshot_failed"),
    skipped: n((g) => g.status === "skipped"),
  };
}

/** 받기가 실패했는가(설계 D9 의 종료 1) — 결과 없음 · 종료 ≠ 0 · 받기·기록·사본 실패 */
export function fetchFailed(f: FetchRead): boolean {
  if (f.kind === "no_result" || f.exit.code !== 0) return true;
  const c = fetchCounts(f);
  return c.prepareFailed + c.commitFailed + c.snapshotFailed > 0;
}

/**
 * **다시 적재 조건**(설계 D7-10 · 3차 리뷰 R3-2) — 기록된 경기(`recorded`)가 1개 이상이거나, 되돌리기가 실패한 경기
 * (`commit_failed` · `rollback: "failed"`)가 1개 이상일 때**만**.
 * ⚠되돌리기 실패를 넣는 이유: 섞인 세트가 남았으면 **같은 실행 안에서** 적재기의 G4 가 그 경기를 건너뛰고 실패로 세는 것을
 *   보고에 남기려고. ⚠결과가 없으면(recorded 를 모른다) 하지 않는다 — 다음 실행의 `수집·적재` 가 아카이브 전체를 다시 적재한다.
 */
export function shouldReload(f: FetchRead | null): boolean {
  if (f === null || f.kind !== "result") return false;
  const c = fetchCounts(f);
  return c.recorded >= 1 || c.rollbackFailed >= 1;
}

// ── ③⑤ 시도 기록 · 소진(설계 D8 의 상태 전이) ─────────────────────────────────

/**
 * **③ 시도 기록** — ①의 결과 이력의 키에, 그 키의 남은 후보 가운데 **`recorded` 된 경기가 있는 날짜**를 붙인다
 * (`at` = 진입점의 `now` · `run`). 다시 적재의 성패와 무관하다 — 아카이브에는 새 사본이 있다.
 * ⚠받기 결과의 경기 순서와 무관하다(R2-4).
 */
export function attachAttempts(h: History, plan: PlanFetch, fetch: FetchRead, now: string, run: string): History {
  if (fetch.kind !== "result" || plan.candidates === null) return h;
  const recorded = new Set(fetch.result.games.filter((g) => g.status === "recorded").map((g) => g.id));
  const out = new Map(h.keys);
  for (const c of plan.candidates) {
    const e = out.get(c.key);
    if (e === undefined) continue;
    const dates = datesDesc(c.remaining.filter((r) => recorded.has(r.game_id)).map((r) => r.game_date));
    if (dates.length === 0) continue;
    const have = new Set(e.attempts.map((a) => JSON.stringify([a.date, a.at])));
    const add = dates.filter((d) => !have.has(JSON.stringify([d, now]))).map((d) => ({ date: d, at: now, run }));
    out.set(c.key, { ...e, attempts: sortAttempts([...e.attempts, ...add]) });
  }
  return { keys: out };
}

export interface RemainingInfo {
  readonly candidateDates: readonly string[];
  readonly remainingDates: readonly string[];
}

/**
 * **⑤ 소진** — 남은 날짜가 0 인 키에 `exhausted_at` 을 **처음 한 번** 찍는다(이미 찍혔으면 시각을 안 바꾼다).
 * @returns 이번에 처음 소진된 키(코드 단위 오름차순)
 */
export function judgeExhausted(h: History, remaining: ReadonlyMap<string, RemainingInfo>, now: string): { history: History; newly: string[] } {
  const out = new Map(h.keys);
  const newly: string[] = [];
  for (const k of [...h.keys.keys()].sort(cmp)) {
    const e = h.keys.get(k)!;
    const info = remaining.get(k);
    if (info === undefined || info.remainingDates.length > 0 || e.exhausted_at !== null) continue;
    out.set(k, { ...e, exhausted_at: now });
    newly.push(k);
  }
  return { history: { keys: out }, newly };
}

export interface SettleInput {
  /** ① 뒤의 이력 */
  readonly history: History;
  readonly plan: Plan;
  /** 받기 결과 — 띄우지 않았으면 null */
  readonly fetch: FetchRead | null;
  /**
   * 사후 감지 — **다시 적재를 안 했으면 사전 결과를 넘긴다**(DB 가 그대로다) · 다시 적재가 실패해 건너뛰었으면 null
   */
  readonly post: DetectRead | null;
  readonly manualDates: readonly string[];
  readonly collectStartedAt: string | undefined;
  readonly now: string;
  readonly run: string;
}

export interface SettleOutput {
  readonly history: History;
  /** ③ 을 했는가 */
  readonly attempted: boolean;
  /** ④ 를 했는가 */
  readonly updated: boolean;
  /** ⑤ 를 했는가 */
  readonly judged: boolean;
  readonly newlyExhausted: readonly string[];
  /** ⑤ 에서 잰 키별 후보·남은 날짜(다시 적재 뒤의 DB) */
  readonly remaining: ReadonlyMap<string, RemainingInfo>;
  /** ⑤ 의 DB 읽기가 던졌으면 그 문장 — 그때 이력은 ④ 까지다 */
  readonly judgeError: string | null;
}

/**
 * **한 실행 안의 상태 전이를 이 차례로 고정한다**(설계 D8 · R2-5): ③ 시도 기록 → ④ 사후 갱신 → ⑤ 소진.
 * - ③ 받았으면(결과가 있으면) 한다.
 * - ④ 사후가 `unmeasured`·오류·null(다시 적재 실패)이면 하지 않는다 — ③ 까지의 이력을 쓴다.
 * - ⑤ ④ 뒤에 남은 키에 대해서만 · 자동이 허용된 실행(받는 계획 또는 관문 10 `all_exhausted`)에서만 ·
 *   남은 날짜는 **다시 적재 뒤의 DB** 로 다시 잰다(`read`).
 * ⚠해결된 키의 시도 기록은 남기지 않는다 — ④ 가 키째 지운다.
 */
export function settleHistory(i: SettleInput, read: CandidateReader): SettleOutput {
  let h = i.history;
  const attempted = i.plan.kind === "fetch" && i.fetch !== null && i.fetch.kind === "result";
  if (attempted && i.plan.kind === "fetch" && i.fetch !== null) h = attachAttempts(h, i.plan, i.fetch, i.now, i.run);
  const stop = (updated: boolean, judgeError: string | null = null): SettleOutput => ({
    history: h,
    attempted,
    updated,
    judged: false,
    newlyExhausted: [],
    remaining: new Map(),
    judgeError,
  });
  const post = i.post;
  if (post === null || !post.ok || post.result.status === "unmeasured") return stop(false);
  h = updateHistory(h, post, i.collectStartedAt, i.now, i.run);
  const auto = i.plan.kind === "fetch" || i.plan.reason === "all_exhausted";
  const through = post.result.as_of.date;
  if (!auto || through === null) return stop(true);
  try {
    const remaining = new Map<string, RemainingInfo>();
    for (const [k, e] of [...h.keys].sort((a, b) => cmp(a[0], b[0]))) {
      const p = parseKey(k);
      if (p === null) throw new PlanError(`이력의 키 모양이 틀렸다: ${k}`);
      const rows = read({
        season: p.season,
        competition: post.result.competition,
        through,
        team: p.team,
        kind: p.kind,
        playerId: p.playerId,
        field: p.field,
        direction: e.direction,
      });
      const x = exclusions(rows, e, i.manualDates, through);
      remaining.set(k, { candidateDates: x.candidateDates, remainingDates: x.remainingDates });
    }
    const j = judgeExhausted(h, remaining, i.now);
    return { history: j.history, attempted, updated: true, judged: true, newlyExhausted: j.newly, remaining, judgeError: null };
  } catch (e) {
    return stop(true, errorText(e));
  }
}

/** 받은 경기의 「후 값」 키 */
export function afterKey(key: string, gameId: string): string {
  return JSON.stringify([key, gameId]);
}

/** 다시 적재 뒤에 고른 경기의 값을 읽는다(보고의 「전 값 → 후 값」) */
export function afterValues(plan: PlanFetch, read: (q: ValueQuery) => AfterValue): Map<string, AfterValue> {
  const chosen = new Set(plan.games.map((g) => g.id));
  const out = new Map<string, AfterValue>();
  for (const c of plan.candidates ?? []) {
    for (const r of c.remaining) {
      if (!chosen.has(r.game_id)) continue;
      out.set(afterKey(c.key, r.game_id), read({ kind: c.info.kind, field: c.info.field, gameId: r.game_id, playerId: c.info.playerId }));
    }
  }
  return out;
}

// ── 종료 코드(설계 D9) ────────────────────────────────────────────────────────

export interface StepOutcome {
  /** 계획기·DB 읽기(사전)가 던졌다 */
  readonly planError: string | null;
  /** 연락처가 비어 받기 도구를 띄우지 않았다 */
  readonly noContact: boolean;
  readonly fetch: FetchRead | null;
  /** 다시 적재의 끝(안 했으면 null) */
  readonly reload: ChildExit | null;
  /** 사후 DB 읽기(소진 판정 · 후 값)가 던졌다 */
  readonly postError: string | null;
  /** 산출 파일을 못 썼다 */
  readonly writeError: string | null;
  /** 예상 밖 예외 */
  readonly unexpected: string | null;
}

/**
 * **1** — 받기·기록·사본 실패 · 결과 JSON 없음 · 자식 시간 제한 · 다시 적재 실패 · 계획기·DB 읽기 실패 · 연락처 없음 · 산출 실패 ·
 * 예상 밖 예외. **0** — 그 밖 전부(할 일 없음 · 건너뜀 · 받았는데 결함이 남음 · 마감·예산·고통 신호로 일부만 받음).
 * ⚠**남은 결함의 판정은 관문의 몫이다** — 결함이 남았다고 1 이 아니다.
 */
export function stepExitCode(o: StepOutcome): 0 | 1 {
  if (o.planError !== null || o.noContact || o.postError !== null || o.writeError !== null || o.unexpected !== null) return 1;
  if (o.fetch !== null && fetchFailed(o.fetch)) return 1;
  if (o.reload !== null && !childOk(o.reload)) return 1;
  return 0;
}

// ── 보고(설계 D9) ─────────────────────────────────────────────────────────────

export interface RunRecord {
  readonly run: string;
  readonly slot: string | undefined;
  readonly planOnly: boolean;
  /** 진입점이 한 번 읽은 「지금」 */
  readonly now: string;
  readonly collectStartedAt: string | undefined;
  readonly season: number;
  readonly history: {
    readonly source: "remote" | "worktree" | "none";
    readonly ref: string | null;
    /** `history.base` 에 쓴 값(계획만이면 null) */
    readonly base: string | null;
    readonly violation: string | null;
    /** 다음 이력을 썼는가 */
    readonly written: boolean;
  };
  readonly manual: PlanInput["manual"];
  readonly pre: DetectRead | null;
  readonly plan: Plan | null;
  readonly planError: string | null;
  readonly noContact: boolean;
  readonly fetch: FetchRead | null;
  readonly reload: ChildExit | null;
  /** 사후 감지 — `reused_pre` 면 사전 결과(DB 가 그대로다) · `skipped` 면 다시 적재 실패로 안 했다 */
  readonly post: DetectRead | null;
  readonly postSource: "detected" | "reused_pre" | "skipped" | "none";
  readonly after: ReadonlyMap<string, AfterValue> | null;
  readonly settle: SettleOutput | null;
  readonly postError: string | null;
  /** 최종 이력(손상·계획만이면 null) */
  readonly finalHistory: History | null;
  readonly unexpected: string | null;
  readonly exit: 0 | 1;
}

const PREFIX = "정정 자동 재수집 — ";

function detectCode(d: DetectRead): string {
  return d.ok ? (d.result.status === "unmeasured" ? `unmeasured:${String(d.result.reason)}` : d.result.status) : "detector_error";
}

/** 실패 절(「해 봤으나 실패: …」) — 비면 실패가 아니다. `fetchSide` 면 런북 §7-E */
function failures(rec: RunRecord): { parts: string[]; fetchSide: boolean } {
  const parts: string[] = [];
  let fetchSide = false;
  if (rec.unexpected !== null) parts.push(`예상 밖 오류 — ${rec.unexpected}`);
  if (rec.planError !== null) parts.push(`계획 실패 — ${rec.planError}`);
  if (rec.noContact) parts.push("연락처 없음 — BB_ARCHIVER_CONTACT 가 비어 받기 도구를 띄우지 않았다");
  if (rec.fetch !== null) {
    if (rec.fetch.kind === "no_result") {
      parts.push(`받기 도구가 결과 없이 끝났다(${rec.fetch.error})`);
      fetchSide = true;
    } else {
      const c = fetchCounts(rec.fetch);
      if (c.prepareFailed > 0) parts.push(`받기 실패 ${String(c.prepareFailed)}경기`);
      if (c.rollbackOk > 0) parts.push(`기록 실패 ${String(c.rollbackOk)}경기(되돌림 ok)`);
      // ⚠첫 줄은 「섞인 세트 남음」 갈래가 따로 말한다(headline) — 여기는 report.json 의 failures 를 빠짐없이 하려고 둔다
      if (c.rollbackFailed > 0) parts.push(`기록 실패 ${String(c.rollbackFailed)}경기(되돌림 실패 — 섞인 세트)`);
      if (c.snapshotFailed > 0) parts.push(`사본 실패 ${String(c.snapshotFailed)}경기`);
      if (c.prepareFailed + c.commitFailed + c.snapshotFailed > 0) fetchSide = true;
      else if (rec.fetch.exit.code !== 0) {
        parts.push(`받기 도구 ${describeExit(rec.fetch.exit)}`);
        fetchSide = true;
      }
    }
  }
  if (rec.reload !== null && !childOk(rec.reload)) {
    parts.push(`다시 적재 실패(${describeExit(rec.reload)})`);
    fetchSide = true;
  }
  if (rec.postError !== null) parts.push(`사후 조회 실패 — ${rec.postError}`);
  return { parts, fetchSide };
}

/** 보고 첫 줄 — **갈래를 말한다**(설계 D9) */
export function headline(rec: RunRecord): string {
  const mixed = rec.fetch?.kind === "result" ? rec.fetch.result.games.filter((g) => g.status === "commit_failed" && g.rollback === "failed") : [];
  if (mixed.length > 0) return `${PREFIX}해 봤으나 실패 — 섞인 세트 남음: ${mixed.map((g) => g.id).join(", ")} — 런북 §7-E`;
  const f = failures(rec);
  if (f.parts.length > 0) return `${PREFIX}해 봤으나 실패: ${f.parts.join(" · ")} — 런북 ${f.fetchSide ? "§7-E" : "§7-I"}`;
  const plan = rec.plan;
  if (plan === null) return `${PREFIX}해 보지 않았다: 계획 없음`;
  if (plan.kind === "skip") return `${PREFIX}${rec.planOnly ? "계획만(--plan-only) — " : ""}해 보지 않았다: ${plan.reason} — ${plan.detail}`;
  if (rec.planOnly) {
    return `${PREFIX}계획만(--plan-only): ${String(plan.games.length)}경기(${String(plan.dates.length)}일) · 논리 페이지(예정) ${String(plan.games.length * PAGES_PER_GAME)} · 고른 날짜 ${plan.dates.join(", ")}`;
  }
  const res = rec.fetch?.kind === "result" ? rec.fetch.result : null;
  const recorded = res === null ? [] : res.games.filter((g) => g.status === "recorded");
  const recordedDates = new Set(recorded.map((g) => plan.games.find((p) => p.id === g.id)?.date ?? g.id));
  let tail: string;
  const post = rec.post;
  if (post !== null && post.ok && post.result.status !== "unmeasured") {
    const eligible = classifyDefects(post.result).filter((k) => k.direction !== null).length;
    const exhausted = rec.finalHistory === null ? 0 : [...rec.finalHistory.keys.values()].filter((e) => e.exhausted_at !== null).length;
    tail = `남은 결함 후보 ${String(post.result.defects.length)}건(대상 키 ${String(eligible)} · 소진 ${String(exhausted)})`;
  } else {
    tail = `사후 측정 못 함(${post === null ? "다시 적재 실패" : detectCode(post)})`;
  }
  const skipped = res === null ? 0 : res.games.filter((g) => g.status === "skipped").length;
  const stop = res !== null && res.stopped !== null ? ` · 멈춤: ${res.stopped}(남은 ${String(skipped)}경기는 다음 정시 실행)` : "";
  return (
    `${PREFIX}해 봤다: ${String(recorded.length)}경기(${String(recordedDates.size)}일) · ` +
    `논리 페이지 ${String(res?.page_fetches ?? 0)} · HTTP 전송 ${String(res?.http_attempts ?? 0)} · ${tail}${stop}`
  );
}

function verdictOf(rec: RunRecord): "refetched" | "skipped" | "failed" | "planned" {
  const mixed = rec.fetch?.kind === "result" && fetchCounts(rec.fetch).rollbackFailed > 0;
  if (mixed || failures(rec).parts.length > 0) return "failed";
  if (rec.plan === null || rec.plan.kind === "skip") return "skipped";
  return rec.planOnly ? "planned" : "refetched";
}

function fmtValue(v: number | string | null): string {
  return v === null ? "NULL" : String(v);
}

function summarizeDetect(d: DetectRead | null): Record<string, unknown> | null {
  if (d === null) return null;
  if (!d.ok) return { ok: false, exit: d.exit.code, timed_out: d.exit.timedOut, error: d.error };
  return {
    ok: true,
    exit: d.exit.code,
    status: d.result.status,
    reason: d.result.reason,
    as_of: d.result.as_of,
    defects: d.result.defects.length,
  };
}

/** 키의 보고 차례 — 대상 키는 계획 차례(남은 날짜 수 → 키), 그다음 대상 아닌 키(키 순서) */
function reportKeys(rec: RunRecord): { info: KeyInfo; cand: KeyCandidates | null; postOnly: boolean }[] {
  const plan = rec.plan;
  const infos = plan?.keys ?? [];
  const cands = plan?.candidates ?? null;
  const byKey = new Map((cands ?? []).map((c) => [c.key, c]));
  const eligible = infos.filter((i) => i.direction !== null);
  const ordered =
    cands === null
      ? eligible
      : [...eligible].sort((a, b) => {
          const ia = cands.findIndex((c) => c.key === a.key);
          const ib = cands.findIndex((c) => c.key === b.key);
          return ia - ib || cmp(a.key, b.key);
        });
  const out = [
    ...ordered.map((info) => ({ info, cand: byKey.get(info.key) ?? null, postOnly: false })),
    ...infos.filter((i) => i.direction === null).map((info) => ({ info, cand: null, postOnly: false })),
  ];
  const seen = new Set(infos.map((i) => i.key));
  if (rec.postSource === "detected" && rec.post?.ok === true && rec.post.result.status !== "unmeasured") {
    for (const info of classifyDefects(rec.post.result)) if (!seen.has(info.key)) out.push({ info, cand: null, postOnly: true });
  }
  return out;
}

function keyState(rec: RunRecord, key: string, eligible: boolean): string {
  if (!eligible) return "대상 아님";
  const s = rec.settle;
  if (s === null || !s.updated) return "이번 실행에서 판정 안 함";
  const e = rec.finalHistory?.keys.get(key);
  if (e === undefined) return "풀렸다(사후 목록에 없다)";
  if (s.newlyExhausted.includes(key)) return "새로 소진 — 런북 §7-I";
  if (e.exhausted_at !== null) return `소진(${e.exhausted_at}) — 런북 §7-I`;
  return "남음";
}

/** 보고 — 사람용 글(`report.txt` · 표준출력)과 `report.json`(스키마 1). 나열 순서는 R2-4 를 따른다 */
export function renderReport(rec: RunRecord): { text: string; json: Record<string, unknown> } {
  const lines: string[] = [headline(rec)];
  const budget = timeBudget(rec.collectStartedAt, rec.now);
  const elapsed = budget.kind === "started_at_unknown" ? null : budget.elapsedMs;
  lines.push(
    `  실행 ${rec.run} · 슬롯 ${rec.slot ?? "(없음)"} · 잡 시작 ${rec.collectStartedAt ?? "(없음)"} · 경과 ${elapsed === null ? "모름" : fmtElapsed(elapsed)} · ` +
      `시즌 ${String(rec.season)} · 지금 ${rec.now}${rec.planOnly ? " · 계획만" : ""}`,
  );
  const hs = rec.history;
  lines.push(
    `  이력: ${hs.source === "remote" ? `원격 origin/${String(hs.ref)}` : hs.source === "worktree" ? "작업 트리 사본" : "읽지 않음"}` +
      `${hs.base === null ? "" : ` · base ${hs.base === "absent" ? "absent" : `${hs.base.slice(0, 12)}…`}`}` +
      `${hs.violation === null ? "" : ` · 손상: ${hs.violation}`}${hs.written ? " · 다음 이력을 썼다" : ""}`,
  );
  /** 감지 한 줄 — `missing` 은 감지를 안 했을 때의 글 */
  const det = (label: string, d: DetectRead | null, missing: string): void => {
    if (d === null) {
      lines.push(`  ${label}: ${missing}`);
      return;
    }
    if (!d.ok) {
      lines.push(`  ${label}: 감지기 오류 — ${d.error}`);
      return;
    }
    const r = d.result;
    lines.push(
      `  ${label}: ${detectCode(d)} · 결함 후보 ${String(r.defects.length)}건 · 기준일 ${r.as_of.date ?? "없음"}(${r.as_of.source})` +
        `${r.reason_detail === null ? "" : ` · ${r.reason_detail}`}`,
    );
  };
  det("사전 감지", rec.pre, "안 함(그 앞에서 멈췄다)");
  if (rec.postSource === "detected") det("사후 감지", rec.post, "안 함");
  else if (rec.postSource === "reused_pre" && rec.plan?.kind === "fetch") lines.push("  사후 감지: 다시 적재가 없어 사전 결과를 그대로 쓴다(DB 가 그대로다)");
  else if (rec.postSource === "skipped") lines.push("  사후 감지: 다시 적재가 실패해 건너뛰었다(DB 를 믿을 수 없다)");
  const m = rec.manual;
  const plan = rec.plan;
  lines.push(
    `  수동 날짜: ${m.ok ? (m.dates === null || m.dates.length === 0 ? "없음" : m.dates.join(", ")) : `틀림 — ${m.error}`} · ` +
      `날짜 자리 ${plan?.dateSlots === null || plan === null ? "—" : String(plan.dateSlots)}`,
  );
  if (plan?.kind === "fetch") {
    lines.push(
      `  고른 날짜: ${plan.dates.join(", ")} · 경기 ${String(plan.games.length)}${plan.capped === null ? "" : ` · 상한으로 멈춤(${plan.capped})`} · 마감 ${plan.deadline}`,
    );
  }

  // 키
  const keys = reportKeys(rec);
  if (keys.length > 0) lines.push("── 키 ──");
  const gameStatus = new Map((rec.fetch?.kind === "result" ? rec.fetch.result.games : []).map((g) => [g.id, g]));
  const chosen = new Set(plan?.kind === "fetch" ? plan.games.map((g) => g.id) : []);
  const jsonKeys: Record<string, unknown>[] = [];
  for (const { info, cand, postOnly } of keys) {
    const eligible = info.direction !== null;
    lines.push(
      `  ${info.key} · ${info.name} · 우리 ${info.ours} → 공표 ${info.published} · ${info.direction ?? "방향 없음"} · ` +
        `${eligible ? "대상" : `대상 아님(${String(info.why)})`}${postOnly ? " · 사후에 처음 보임" : ""}`,
    );
    const jsonGames: Record<string, unknown>[] = [];
    if (cand !== null) {
      const picked = cand.remainingDates.filter((d) => plan?.kind === "fetch" && plan.dates.includes(d));
      lines.push(
        `    후보 ${String(cand.candidateDates.length)}일 · E2 로 뺀 ${String(new Set(cand.rows.filter((r) => cand.e2.includes(r.game_id)).map((r) => r.game_date)).size)}일 · ` +
          `수동(E3) ${String(new Set(cand.rows.filter((r) => cand.e3.includes(r.game_id)).map((r) => r.game_date)).size)}일 · ` +
          `남은 ${String(cand.remainingDates.length)}일 · 고른 날짜 ${picked.length === 0 ? "없음" : picked.join(", ")}`,
      );
      if (cand.reverted.length > 0) lines.push(`    되돌려짐(복원) — 다시 후보: ${cand.reverted.join(", ")}`);
      for (const r of cand.remaining) {
        if (!chosen.has(r.game_id)) continue;
        const g = gameStatus.get(r.game_id);
        if (rec.planOnly) {
          lines.push(`    ${r.game_date} ${r.game_id} ${info.field} ${fmtValue(r.value)} · 계획`);
          jsonGames.push({ id: r.game_id, date: r.game_date, before: r.value, after: null, status: null, rollback: null });
          continue;
        }
        let after: string;
        if (rec.after !== null) {
          const a = rec.after.get(afterKey(info.key, r.game_id));
          after = a === undefined ? "모름" : a.found ? fmtValue(a.value) : "행 없음";
        } else if (rec.reload !== null && !childOk(rec.reload)) after = "(다시 적재 실패 — 모름)";
        else after = "(다시 적재 안 함)";
        const status = g === undefined ? "안 받음" : `${g.status}${g.reason === null ? "" : `:${g.reason}`}${g.rollback === null ? "" : ` · 되돌림 ${g.rollback}`}`;
        lines.push(`    ${r.game_date} ${r.game_id} ${info.field} ${fmtValue(r.value)} → ${after} · ${status}`);
        jsonGames.push({ id: r.game_id, date: r.game_date, before: r.value, after: rec.after === null ? null : (rec.after.get(afterKey(info.key, r.game_id)) ?? null), status: g?.status ?? null, rollback: g?.rollback ?? null });
      }
    }
    const state = keyState(rec, info.key, eligible);
    if (eligible) lines.push(`    상태: ${state}`);
    const entry = rec.finalHistory?.keys.get(info.key);
    jsonKeys.push({
      key: info.key,
      team: info.team,
      kind: info.kind,
      player_id: info.playerId,
      name: info.name,
      field: info.field,
      ours: info.ours,
      published: info.published,
      eligible,
      direction: info.direction,
      why: info.why,
      post_only: postOnly,
      candidates:
        cand === null
          ? null
          : {
              dates: cand.candidateDates,
              e2: cand.e2,
              e3: cand.e3,
              remaining_dates: cand.remainingDates,
              reverted_dates: cand.reverted,
            },
      games: jsonGames,
      state,
      exhausted_at: entry?.exhausted_at ?? null,
    });
  }

  // 받기 · 다시 적재
  if (rec.fetch !== null) {
    lines.push("── 받기 ──");
    if (rec.fetch.kind === "no_result") lines.push(`  결과 없음 — ${rec.fetch.error}`);
    else {
      const r = rec.fetch.result;
      lines.push(
        `  ${describeExit(rec.fetch.exit)} · 논리 페이지 ${String(r.page_fetches)} · HTTP 전송 ${String(r.http_attempts)} · 상태별 ${JSON.stringify(r.by_status)} · ` +
          `고통 신호 ${r.distress ? "있음" : "없음"} · 멈춤 ${r.stopped ?? "없음"}`,
      );
    }
  }
  if (rec.reload !== null) {
    lines.push("── 다시 적재 ──");
    lines.push(`  ${describeExit(rec.reload)}`);
  }

  const verdict = verdictOf(rec);
  const json: Record<string, unknown> = {
    schema: 1,
    run: rec.run,
    slot: rec.slot ?? null,
    plan_only: rec.planOnly,
    started_at: rec.now,
    collect_started_at: rec.collectStartedAt ?? null,
    elapsed_ms: elapsed,
    season: rec.season,
    verdict,
    skip_reason: plan?.kind === "skip" ? plan.reason : null,
    skip_detail: plan?.kind === "skip" ? plan.detail : null,
    failures: failures(rec).parts,
    history: { source: hs.source, ref: hs.ref, base: hs.base, violation: hs.violation, written: hs.written },
    detect_before: summarizeDetect(rec.pre),
    detect_after: rec.postSource === "detected" ? summarizeDetect(rec.post) : null,
    post_source: rec.postSource,
    manual_dates: m.ok ? (m.dates ?? []) : null,
    date_slots: plan?.dateSlots ?? null,
    keys: jsonKeys,
    selected: {
      dates: plan?.kind === "fetch" ? plan.dates : [],
      games: plan?.kind === "fetch" ? plan.games.map((g) => g.id) : [],
    },
    fetch:
      rec.fetch === null
        ? null
        : rec.fetch.kind === "no_result"
          ? { exit: rec.fetch.exit.code, timed_out: rec.fetch.exit.timedOut, error: rec.fetch.error }
          : {
              exit: rec.fetch.exit.code,
              page_fetches: rec.fetch.result.page_fetches,
              http_attempts: rec.fetch.result.http_attempts,
              by_status: rec.fetch.result.by_status,
              distress: rec.fetch.result.distress,
              stopped: rec.fetch.result.stopped,
              games: rec.fetch.result.games.map((g) => ({ id: g.id, status: g.status, reason: g.reason, rollback: g.rollback })),
            },
    reload: rec.reload === null ? null : { exit: rec.reload.code, timed_out: rec.reload.timedOut },
    exit: rec.exit,
  };
  return { text: lines.join("\n"), json };
}
