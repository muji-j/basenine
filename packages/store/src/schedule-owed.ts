/**
 * **받았어야 할 날(owed)과 확인된 휴식일** — 따라잡기 기준점의 일정 증거
 * (설계 `docs/superpowers/specs/2026-10-24-catchup-owed-days-design.md` D1 · D2 · PR-2b).
 *
 * ## 왜 있는가
 *
 * 수집 창의 기준점은 `since = MAX(game_date) WHERE status = 'played'` 이고 따라잡기 상한이 7일이다(`scripts/date-window.ts`).
 * 휴식·장애가 길면 창이 **다음 경기일을 놓친다** — CS→일본시리즈 휴식이 창을 다 써서 JST 10/26 00시 이후 첫 실행은
 * 10/24(일본시리즈 1차전)를 영영 안 받는다(설계 §1 · 8시각 중 6시각). 여기는 그 날을 **일정표의 증거로** 짚는다:
 *
 * - **⒜ 증거 후보**(`owedDays`) — 날 D 가 후보 ⇔ 전부 참:
 *   1. 예정(`upcoming_game`) 또는 치러짐 표시(`schedule_played`)에 D 의 카드(홈 · 원정 · `seq`)가 있다.
 *   2. `오늘 − OWED_LOOKBACK_DAYS ≤ D < 오늘`(JST).
 *   3. 그 카드의 경기 행이 없다 — `COUNT(game) ≤ seq`(수집 판정 증거 A 와 같은 식 · **상태 무관**: 중지도 받은 것이다).
 *   4. (예정 카드만) 그 달 사본을 **D 다음 날 이후에 본 적이 없다** — 본 날(JST) ≤ D 이거나 모름. 사본이 D 뒤에도 그 경기를
 *      링크 없이 적고 있으면 NPB 가 안 치렀다고 한 것이라 다시 받지 않는다(2025 일본시리즈 6·7차전 행이 끝난 뒤에도 남았다 · 설계 D5).
 * - **⒝ 월말 뒤 못 본 사본**(같은 함수) — 대진 미정 표기(`日本シリーズ セ本拠地球場` · `(予備日)` · `CS勝者`)는 `upcoming_game` 에
 *   안 들어가서 ⒜ 가 그 날을 지정하지 못한다(콜드 리뷰 1 P1). 그래서 날이 아니라 **사본**을 본다: 달 M(말일 L)이 끝났고
 *   (`L < 오늘 ≤ L + 30`) 그 사본을 **L 뒤에 본 적이 없으면**(본 날 ≤ L 또는 모름) L 을 더한다 — L 의 날짜 자식이 그 달 일정을 새로 받고,
 *   그 사본이 치러졌다고 적은 경기는 **다음 실행의 ⒜**(치러짐 표시에 경기 행 없음)가 잡는다.
 *   ⚠그 달 사본 행이 **없으면** 발동하지 않는다 — 새로 받게 할 사본이 없다(비시즌에 받은 적 없는 달로 헛요청하지 않는다).
 *   ⚠⚠**내용이 없던 사본(`first_content` NULL)도 발동하지 않는다**(구현 중 발견 · 설계보다 좁다) — 12월→1월 경계에서는 말일의 날짜 자식이
 *   2026/12 사본을 새로 받아도 `update.ts` 의 앞으로의 일정 적재가 **마지막 대상일의 시즌만** 읽어서 그 행이 갱신되지 않는다. 1/1 실행이 전부
 *   실패한 해에는 ⒝ 가 12/31 을 30일 동안 매 실행 더했다(설계 D4 의 「비시즌 ⒝ = ∅」 · 「한 달에 한 번 2요청」이 깨진다).
 *   대진 미정 표기도 내용이라(`load-upcoming` 의 첫 내용일 = 경기 · 예정 표기 · 구단 아님) ⒝ 의 목적은 그대로다.
 * - **확인된 휴식일**(`confirmedRestThrough` · D2) — `since` 다음 날부터 하루씩: 그 달 사본을 **그 날 뒤에** 봤고 세 표(예정 · 치러짐 표시 ·
 *   경기)에 그 날 행이 0 이면 휴식이다. 이어진 끝을 따라잡기 간격의 기준으로 넘긴다 — 휴식이 7일 상한을 갉아먹지 않게.
 *   ⚠본 날이 그 날 **이전·당일**이면 확인하지 않는다 — 대진 미정 날(행이 예정 표기라 표에 없다)이 휴식으로 오인되지 않는다.
 *   ⚠경기 행(`game`)까지 보는 것은 설계(두 증거 표)보다 한 표 더 보수적이다 — 일관된 상태에서는 결과가 같고, 어긋난 상태에서는 확인을 멈춘다.
 *
 * ## ⚠새 상태를 만들지 않는다
 *
 * 이미 있는 `schedule_month.fetched_at`(본 시각 — 사이드카의 `checkedAt ?? fetchedAt` · 안 바뀐 재취득도 오른다) · `upcoming_game` ·
 * `schedule_played`(마이그레이션 021)만 읽는다. 사본 본 시각은 **JST 달력 날짜**로 비교한다(`datetime(…, '+9 hours')` — 수집 판정 증거 B 와 같은 식).
 * 시각을 못 읽으면(NULL · 모양 틀림) ⒜-4 · ⒝ 에서는 「본 적 없음」(후보 · 실행당 5일 상한이 묶는다), 휴식일 확인에서는 「확인 못 함」이다(M11 —
 * 모르는 것으로 창을 **좁히지** 않는다).
 *
 * ## ⚠이 파일은 import 가 0개인 잎이다 (I1)
 *
 * `scripts/collected-through.ts`(→ `scripts/update.ts` · 수집 오케스트레이터)와 `scripts/date-window.ts` 가 서브패스 `@bb-app/store/schedule-owed` 로
 * 직접 가져온다. 무엇이든 import 하면 그 사슬의 로드 오류가 **수집을 시작 전에** 죽인다(`refetch-limit.ts` · `game-slug.ts` 선례).
 * 그래서 DB 는 구조적 타입(`SqlReader`)으로 받는다 — `node:sqlite` 의 `DatabaseSync` 가 그대로 맞는다.
 * ⚠**시계를 안 읽는다**(M6) — 오늘(JST `YYYY-MM-DD`)은 부르는 쪽이 준다.
 */

/**
 * owed 를 찾는 창의 길이(일) — `[오늘 − 30, 어제]`.
 * ⚠**수집 판정(`@bb-app/domain` 의 `LOOKBACK_DAYS`)과 같은 값이어야 한다** — 감시가 「받았어야 할 경기」로 우는 창과 그 날을 이어 받는 창이 같은 길이다.
 *   잎이라 가져올 수 없어 값을 적고, `packages/store/test/schedule-owed.test.ts` 가 둘을 대조한다.
 */
export const OWED_LOOKBACK_DAYS = 30;

/** `node:sqlite` 의 `DatabaseSync` 에서 쓰는 만큼만 — 잎이라 타입도 가져오지 않는다 */
export interface SqlReader {
  prepare(sql: string): { all(...params: (string | number)[]): unknown[] };
}

/** 그 날을 받았어야 하는 사유 하나 */
export type OwedReason =
  /** ⒜ 월간 일정이 「치렀다」(점수 링크)고 표시했는데 그 카드의 경기 행이 없다 */
  | { readonly kind: "played"; readonly homeCode: string; readonly awayCode: string; readonly seq: number }
  /** ⒜ 월간 일정이 예정이라 했고 그 달 사본을 그 날 뒤에 본 적이 없는데 경기 행이 없다 · `seenOn` = 사본을 마지막으로 본 날(JST · 모르면 null) */
  | { readonly kind: "scheduled"; readonly homeCode: string; readonly awayCode: string; readonly seq: number; readonly seenOn: string | null }
  /** ⒝ 달(`YYYY-MM`)이 끝났는데 그 사본을 월말 뒤에 본 적이 없다 — 날은 그 달 말일 */
  | { readonly kind: "month-end"; readonly month: string; readonly seenOn: string | null };

/** 받았어야 할 날 하나 — 사유는 **치러짐 표시 → 예정 → 월말** 순, 같은 종류는 홈 · 원정 · seq 순 */
export interface OwedDay {
  readonly date: string;
  readonly reasons: readonly OwedReason[];
}

/** `YYYY-MM-DD` 모양이고 실제로 있는 날짜인가 — ⚠시계를 안 읽는다(주어진 글자를 해석할 뿐 · M6) */
function isYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `YYYY-MM-DD` 에서 `n` 일 뒤(음수면 앞) — ⚠시계를 안 읽는다(M6) */
function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 사본 본 시각(UTC ISO) → JST 달력 날짜. 못 읽으면 NULL — 수집 판정 증거 B 와 같은 식 */
const JST_SEEN = (col: string): string => `substr(datetime(${col}, '+9 hours'), 1, 10)`;

/** 그 날의 달 사본 — 시즌 = 해 · 달 = 월(NPB 시즌은 달력 해와 같다) */
const MONTH_OF = (col: string): string =>
  `m.season = CAST(substr(${col}, 1, 4) AS INTEGER) AND m.month = CAST(substr(${col}, 6, 2) AS INTEGER)`;

/** 그 카드의 경기 행 수가 `seq` 이하 — 그 번째 경기가 없다(수집 판정 증거 A 와 같은 식 · 상태 무관) */
const NO_GAME_ROW = (t: string): string =>
  `(SELECT COUNT(*) FROM game g WHERE g.game_date = ${t}.game_date AND g.home_code = ${t}.home_code AND g.away_code = ${t}.away_code) <= ${t}.seq`;

const OWED_SQL = `
  WITH b(lo, hi) AS (SELECT DATE(?1, ?2), DATE(?1, '-1 day'))
  SELECT p.game_date AS date, 'played' AS kind, p.home_code AS homeCode, p.away_code AS awayCode, p.seq AS seq,
         NULL AS seenOn, NULL AS month
    FROM schedule_played p, b
   WHERE p.game_date BETWEEN b.lo AND b.hi
     AND ${NO_GAME_ROW("p")}
  UNION ALL
  SELECT u.game_date, 'scheduled', u.home_code, u.away_code, u.seq,
         (SELECT ${JST_SEEN("m.fetched_at")} FROM schedule_month m WHERE ${MONTH_OF("u.game_date")}), NULL
    FROM upcoming_game u, b
   WHERE u.game_date BETWEEN b.lo AND b.hi
     AND ${NO_GAME_ROW("u")}
     AND NOT EXISTS (SELECT 1 FROM schedule_month m
                      WHERE ${MONTH_OF("u.game_date")}
                        AND m.fetched_at IS NOT NULL
                        AND ${JST_SEEN("m.fetched_at")} > u.game_date)
  UNION ALL
  SELECT x.last, 'month-end', NULL, NULL, NULL, x.seenOn, x.ym
    FROM (SELECT DATE(printf('%04d-%02d-01', m.season, m.month), '+1 month', '-1 day') AS last,
                 ${JST_SEEN("m.fetched_at")} AS seenOn,
                 printf('%04d-%02d', m.season, m.month) AS ym
            FROM schedule_month m
           WHERE m.first_content IS NOT NULL) x, b
   WHERE x.last BETWEEN b.lo AND b.hi
     AND (x.seenOn IS NULL OR x.seenOn <= x.last)
`;

interface OwedRow {
  date: string;
  kind: "played" | "scheduled" | "month-end";
  homeCode: string | null;
  awayCode: string | null;
  seq: number | null;
  seenOn: string | null;
  month: string | null;
}

const KIND_ORDER: Readonly<Record<OwedRow["kind"], number>> = { played: 0, scheduled: 1, "month-end": 2 };

/** 부호 비교 — ⚠`localeCompare` 를 쓰지 않는다(로케일에 따라 순서가 달라질 수 있다 · 로그 순서는 결정적이어야 한다) */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * **받았어야 할 날**(⒜ + ⒝) — 날짜 오름차순 · 날마다 한 항목.
 * `[오늘 − OWED_LOOKBACK_DAYS, 어제]` 밖은 없다(⒝ 의 「`L < 오늘 ≤ L + 30`」도 같은 범위다).
 * ⚠**표 모양이 다르면 던진다**(021 미적용 · 칸 없음) — 부르는 쪽이 「일정 증거를 못 읽었다」로 받아 예전 규칙으로 돈다(설계 D3 표 3행).
 * @param today 오늘(JST `YYYY-MM-DD`) — 틀린 모양이면 `RangeError`(모르는 기준으로 범위를 만들지 않는다)
 */
export function owedDays(db: SqlReader, today: string): OwedDay[] {
  if (!isYmd(today)) throw new RangeError(`오늘이 YYYY-MM-DD 가 아니다: ${JSON.stringify(today)}`);
  const rows = db.prepare(OWED_SQL).all(today, `-${String(OWED_LOOKBACK_DAYS)} days`) as OwedRow[];
  const byDate = new Map<string, OwedRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list === undefined) byDate.set(r.date, [r]);
    else list.push(r);
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    reasons: byDate
      .get(date)!
      .sort((a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        cmp(a.homeCode ?? "", b.homeCode ?? "") ||
        cmp(a.awayCode ?? "", b.awayCode ?? "") ||
        (a.seq ?? 0) - (b.seq ?? 0))
      .map((r): OwedReason =>
        r.kind === "month-end"
          ? { kind: "month-end", month: r.month!, seenOn: r.seenOn }
          : r.kind === "scheduled"
            ? { kind: "scheduled", homeCode: r.homeCode!, awayCode: r.awayCode!, seq: r.seq!, seenOn: r.seenOn }
            : { kind: "played", homeCode: r.homeCode!, awayCode: r.awayCode!, seq: r.seq! }),
  }));
}

/**
 * **확인된 휴식일의 끝**(D2) — `since` 다음 날부터 어제까지 하루씩, 확인된 휴식일이 이어지는 동안 나아간 마지막 날(없으면 `since`).
 * 결과는 언제나 `since` 이상이다. 따라잡기 창(`targetDates`)의 `collectedThrough` 로 넘긴다 — C10(`judgeDates`·`include`)은 `since` 그대로다.
 * ⚠**그 날 뒤에 본 사본**이어야 확인이다 — 본 날(JST) > 그 날. 같은 날이면 그 뒤에 경기가 생겼을 수 있다.
 * ⚠어제까지만 본다 — 오늘 이후는 사본이 아직 말할 수 없다.
 * @param since 마지막 경기일(`MAX(played)`) · @param today 오늘(JST) — 둘 중 하나라도 틀린 모양이면 `RangeError`
 */
export function confirmedRestThrough(db: SqlReader, since: string, today: string): string {
  if (!isYmd(since)) throw new RangeError(`마지막 경기일이 YYYY-MM-DD 가 아니다: ${JSON.stringify(since)}`);
  if (!isYmd(today)) throw new RangeError(`오늘이 YYYY-MM-DD 가 아니다: ${JSON.stringify(today)}`);
  const seenOf = db.prepare(`SELECT ${JST_SEEN("m.fetched_at")} AS seenOn FROM schedule_month m WHERE m.season = ?1 AND m.month = ?2`);
  const rowsOn = db.prepare(
    `SELECT (SELECT COUNT(*) FROM upcoming_game WHERE game_date = ?1)
          + (SELECT COUNT(*) FROM schedule_played WHERE game_date = ?1)
          + (SELECT COUNT(*) FROM game WHERE game_date = ?1) AS n`,
  );
  const yesterday = addDays(today, -1);
  let through = since;
  for (let d = addDays(since, 1); d <= yesterday; d = addDays(d, 1)) {
    const seen = (seenOf.all(Number(d.slice(0, 4)), Number(d.slice(5, 7)))[0] as { seenOn: string | null } | undefined)?.seenOn ?? null;
    if (seen === null || !(seen > d)) break;
    const n = (rowsOn.all(d)[0] as { n: number } | undefined)?.n;
    if (n !== 0) break;
    through = d;
  }
  return through;
}
