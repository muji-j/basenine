/**
 * **이미 받아 둔 마지막 경기일과 「덜 받은 날」** — 수집 창(따라잡기)의 기준점을 읽는다
 * (감사 C10 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md` · 2026-09-27 3중 검토 반영).
 *
 * ## 무엇을 하는가
 *
 * 1. **DB 를 먼저**(D3) — 읽기 전용 연결 하나에서 **한 트랜잭션**으로 `MAX(game_date) WHERE status='played'`(= `since`)와
 *    판정 범위(`judgeDates` — `[어제 − MAX_CATCHUP_DAYS, min(since, 어제)]`)의 경기 id 를 **상태 무관**으로 읽는다.
 * 2. **그다음 아카이브** — 범위의 날마다 그날 폴더에서 **`box.html.gz` 가 있고 잎 `gameFromBoxPath` 를 통과한** 경기만 센다
 *    (적재기와 판정 한 벌 · D2 · M1).
 * 3. 날마다 `dayStatus` 로 판정하고 **덜 받은 날 전부**를 `include` 로 돌려준다 — `targetDates` 가 창의 범위 규칙 안에서 더한다.
 *
 * ## ⚠왜 `since` 하나가 아닌가 (3중 검토 3차 P2 · 2차 F3)
 *
 * `update.ts` 는 날짜마다 따로 받고 실패도 따로 센다. 한 실행 안에서 D 의 재수집은 실패하고 D+1 은 성공하면 `since` 가
 * D+1 로 전진해, `since` 하나만 보던 판정은 **D 를 다시 보지 않았다**(그 실행은 빨갛지만 그 뒤 자동 복구가 없었다).
 *
 * ## ⚠이 모듈은 import 해도 부작용이 없다 (2차 F1)
 *
 * **시계를 안 읽고**(`now` 를 받는다 · M6) **아무것도 찍지 않는다**(알릴 것은 `notes` 로 돌려주고 `update.ts` 가 찍는다).
 * 판정 I/O 가 `update.ts` 안에 있을 때는 import 하는 순간 수집이 시작돼 소스 모양만 볼 수 있었고, 그래서 변이 5개가 전부 초록이었다.
 * 이제 `scripts/test/collected-through.test.ts` 가 임시 SQLite 와 임시 아카이브로 **실제로 돌린다.**
 * ⚠**store 는 잎 서브패스로만 가져온다**(I1) — 배럴이면 parser·domain 까지 평가돼 무관한 로드 오류가 수집을 시작 전에 죽인다.
 *
 * ## ⚠모름은 넓히지 않는다 (M11) — 날마다 가른다
 *
 * - **DB 의 경기 목록**은 범위 전체를 한 번에 읽는다 → 못 읽으면 **모든 날이 모름**이고 아무것도 더하지 않는다.
 *   `since` 는 지킨다 — 빠진 날 메우기(예전 따라잡기)는 그대로 돈다.
 * - **아카이브**는 날마다 따로 읽는다 → 못 읽은 날(`ENOTDIR`·권한 등)만 모름으로 빼고 **나머지 날은 판정한다.**
 *   ⚠근거: 날마다의 증거(그날 폴더 목록 대 그날 DB 행)는 **서로 독립인 읽기**다. 못 읽은 날은 어느 쪽으로도 추정하지 않고(M11),
 *   읽힌 날의 「폴더는 있는데 행이 없다」는 **적극적인 증거**다. 한 날을 못 읽었다고 범위 전체를 버리면
 *   읽힌 날의 덜 받은 경기를 다시 놓친다 — C10 이 막으려던 바로 그 모양이다.
 * - **그날 폴더가 없으면**(`ENOENT`) 그날은 아카이브의 경기일이 아니다 — 판정하지 않는다(완결 쪽 · 요청을 늘리지 않는다).
 *   ⚠DB 에 그날 행이 있으면 아카이브 손실이나 `--archive` 설정 오류의 신호라 **경고 한 줄**로 모아 말한다(2차 F2).
 *
 * ⚠**대가**(받아들인다): 영구히 덜 받힌 날(서스펜디드 · 적재 실패로 행이 안 생기는 경기)은 판정 범위에서 밀려날 때까지
 *   **최대 상한 + 1 일** 매 실행 다시 받는다 — `catchupNotes` 가 그 날짜와 경기 id 를 말한다.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// ⚠**잎 서브패스로 가져온다**(I1) — store 배럴 금지
import { gameFromBoxPath } from "@bb-app/store/game-slug";
import { dayStatus, isYmd, judgeDates } from "./date-window.ts";

/** 알릴 것 한 줄. `update.ts` 가 `warn` 은 표준오류로, `info` 는 표준출력으로 찍는다 */
export type Note = { level: "info" | "warn"; text: string };

/** 판정한 날 하나. `missing` 은 폴더는 있는데 행이 없는 경기 id · `reason` 은 모름의 사유 */
export interface JudgedDay {
  date: string;
  status: "complete" | "incomplete" | "unknown";
  missing: string[];
  reason: string | null;
}

export interface CollectedThrough {
  /** 마지막으로 받아 둔 경기일 — `MAX(game_date) WHERE status='played'` */
  since: string;
  /** 덜 받았다고 확인된 날(오름차순) — `targetDates` 의 `include` 로 넘긴다 */
  include: string[];
  /** 판정한 날(아카이브에 그날 폴더가 있거나 그 폴더를 못 읽은 날) */
  days: JudgedDay[];
  /** 그날 폴더가 없는데 DB 에 행이 있는 날(아카이브 손실·`--archive` 설정 오류의 신호) */
  noFolder: { date: string; rows: number }[];
}

/**
 * @param o.dbPath DB 파일(절대경로 — 부르는 쪽이 `resolve` 한다)
 * @param o.archiveRoot 아카이브 뿌리(`npb/scores/...` 의 위)
 * @param o.now 「지금」 — ⚠**진입점에서 한 번 읽은 시계**(M6). 수집 창과 같은 값을 넘겨라
 * @returns `collected` 가 `undefined` 면 기준점을 모른다(DB 없음 · 못 읽음 · 치러진 경기 없음 · 모양 틀림) — 따라잡기 없이 어제만 받는다
 */
export function readCollectedThrough(o: { dbPath: string; archiveRoot: string; now: Date }): {
  collected: CollectedThrough | undefined;
  notes: Note[];
} {
  const notes: Note[] = [];
  if (!existsSync(o.dbPath)) {
    notes.push({ level: "info", text: `· ${o.dbPath} 가 아직 없다 — 따라잡기 없이 어제만 받는다` });
    return { collected: undefined, notes };
  }

  // ① DB 먼저 — 한 트랜잭션에서 마지막 경기일과 판정 범위의 경기 id(상태 무관 — 미성립도 행이다)
  let since: string | undefined;
  let range: string[] = [];
  let loaded: Map<string, string[]> | null = null;
  let loadedError = "";
  try {
    const db = new DatabaseSync(o.dbPath, { readOnly: true });
    try {
      db.exec("BEGIN");
      const row = db.prepare("SELECT MAX(game_date) AS d FROM game WHERE status = 'played'").get() as
        | { d: string | null }
        | undefined;
      since = row?.d ?? undefined;
      if (since !== undefined && isYmd(since)) {
        range = judgeDates(o.now, since);
        if (range.length === 0) {
          loaded = new Map();
        } else {
          try {
            const rows = db
              .prepare("SELECT game_id AS id, game_date AS d FROM game WHERE game_date BETWEEN ? AND ?")
              .all(range[0]!, range[range.length - 1]!) as { id: string; d: string }[];
            loaded = new Map();
            for (const r of rows) {
              const list = loaded.get(r.d);
              if (list === undefined) loaded.set(r.d, [r.id]);
              else list.push(r.id);
            }
          } catch (e) {
            loadedError = String(e);
          }
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  } catch (e) {
    notes.push({ level: "warn", text: `⚠마지막 경기일을 못 읽었다(${String(e)}) — 따라잡기 없이 어제만 받는다` });
    return { collected: undefined, notes };
  }
  if (since === undefined) return { collected: undefined, notes };
  if (!isYmd(since)) {
    // ⚠적재기는 경로에서 `YYYY-MM-DD` 만 만든다 — 아니면 모르는 모양이다(M7). 모르는 기준점으로 범위를 만들지 않는다(M11)
    notes.push({ level: "warn", text: `⚠마지막 경기일이 YYYY-MM-DD 가 아니다(${JSON.stringify(since)}) — 따라잡기 없이 어제만 받는다` });
    return { collected: undefined, notes };
  }
  if (loaded === null) {
    notes.push({
      level: "warn",
      text:
        `⚠${range[0]}~${range[range.length - 1]} 의 DB 의 경기 목록을 못 읽었다(${loadedError}) — ` +
        "덜 받은 날을 넓히지 않는다(빠진 날 메우기는 그대로)",
    });
    return { collected: { since, include: [], days: [], noFolder: [] }, notes };
  }

  // ② 그다음 아카이브 — 판정 범위의 날마다, 적재기가 경기로 보는 폴더만(D2)
  const days: JudgedDay[] = [];
  const noFolder: { date: string; rows: number }[] = [];
  for (const date of range) {
    const dayDir = join(o.archiveRoot, "npb", "scores", date.slice(0, 4), `${date.slice(5, 7)}${date.slice(8, 10)}`);
    const rows = loaded.get(date) ?? [];
    let archived: string[] | null = [];
    let reason: string | null = null;
    try {
      for (const e of readdirSync(dayDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const box = join(dayDir, e.name, "box.html.gz");
        if (!existsSync(box)) continue;
        const g = gameFromBoxPath(box);
        if (g !== null) archived.push(g.gameId);
      }
    } catch (e) {
      if ((e as { code?: unknown }).code === "ENOENT") {
        // 그날 폴더가 없다 — 아카이브의 경기일이 아니다. DB 에 행이 있으면 손실·설정 오류의 신호(아래에서 한 줄로 모은다)
        if (rows.length > 0) noFolder.push({ date, rows: rows.length });
        continue;
      }
      archived = null;
      reason = String(e);
    }
    const s = dayStatus(archived, rows);
    days.push({ date, status: s.status, missing: s.missing, reason });
  }

  for (const d of days) {
    if (d.status !== "unknown") continue;
    notes.push({ level: "warn", text: `⚠경기일 ${d.date} 이 덜 받혔는지 모른다 — 아카이브의 그날 폴더를 못 읽었다(${d.reason}). 그날은 넓히지 않는다` });
  }
  if (noFolder.length > 0) {
    notes.push({
      level: "warn",
      text:
        `⚠아카이브에 그날 폴더가 없는데 DB 에 경기 행이 있다: ${noFolder.map((n) => `${n.date}(${n.rows}건)`).join(" · ")} — ` +
        "아카이브 손실이나 --archive 설정 오류를 의심하라(판정은 완결로 둔다)",
    });
  }
  const include = days.filter((d) => d.status === "incomplete").map((d) => d.date);
  return { collected: { since, include, days, noFolder }, notes };
}

/**
 * **덜 받아서 창에 새로 더한 날**을 말한다(C10 D5 · 3중 검토 2차 Minor).
 *
 * ⚠**원래 창에 있던 날은 말하지 않는다**(간격 0 의 어제 등) — 로그로 요청 수를 셀 때 「다시 받는다」가 요청이 는 것으로 읽힌다.
 * ⚠덜 받았는데 **창에 없는 날**은 경고한다 — `judgeDates` 의 범위가 `targetDates` 의 범위 규칙 안이라 원래 없어야 하는 모양이고,
 *   생기면 두 규칙이 어긋난 **코드 결함**이다. 조용히 넘기면 그 날은 자동으로는 영영 안 받힌다.
 *
 * @param base `include` **없이** 잡은 창(원래 창) · @param dates `include` 를 넘겨 잡은 창(실제로 받을 창)
 */
export function catchupNotes(c: CollectedThrough, base: readonly string[], dates: readonly string[]): Note[] {
  const notes: Note[] = [];
  for (const d of c.days) {
    if (d.status !== "incomplete" || base.includes(d.date)) continue;
    const what = `경기일 ${d.date} 에 아카이브 폴더는 있는데 DB 에 행이 없는 경기 ${d.missing.length}건(${d.missing.join(", ")})`;
    notes.push(
      dates.includes(d.date)
        ? { level: "info", text: `· ${what} — ${d.date} 도 다시 받는다` }
        : { level: "warn", text: `⚠${what} — 그런데 이번 창에 없다(판정 범위와 창 규칙이 어긋났다 · 코드 결함을 의심하라)` },
    );
  }
  return notes;
}
