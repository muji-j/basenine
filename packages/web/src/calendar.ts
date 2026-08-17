/**
 * 구단 일정 캘린더 — **지난 경기와 앞으로의 경기를 한 장에**.
 *
 * ⚠**두 출처를 한 격자에 놓지만 뜻은 구별한다**(M9의 정신).
 * 지난 경기는 우리가 수집한 확정 기록이고, 앞으로의 경기는 npb.jp 가 공표한 예정이다 —
 * 예정은 우천·재편성으로 **바뀐다.** 같게 그리면 「확정된 미래」로 읽힌다.
 *
 * ⚠**결과를 색으로만 말하지 않는다.** 승패는 글자(`○`·`●`·`△`)로 먼저 나가고 색은 보조다
 * (§6 · 이 리포가 여러 곳에서 세워 둔 규칙).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { TeamColor } from "@bb-app/domain";

/** 한 경기. 지난 것이면 `result` 가 있고, 앞으로의 것이면 `startTime` 이 있다 */
export interface CalendarGame {
  /** `YYYY-MM-DD`(JST) */
  date: string;
  /** 지난 경기만. 경기 상세로 가는 파일명(`2026-0327-b-e-01`) */
  slug: string | null;
  /** 이 캘린더의 주인 팀에서 본 상대 */
  opponent: string;
  opponentCode: string;
  /** 이 팀이 홈인가 */
  home: boolean;
  /**
   * 이 팀에서 본 결과. 지난 경기만.
   * `win` · `loss` · `draw` · `notPlayed`(중지) · `null`(앞으로의 경기)
   */
  result: "win" | "loss" | "draw" | "notPlayed" | null;
  /** 이 팀 득점 · 상대 득점. 못 읽었으면 `null`(M11 — 0이 아니다) */
  runsFor: number | null;
  runsAgainst: number | null;
  /** 앞으로의 경기만. 미정이면 `null` */
  startTime: string | null;
  venue: string;
  /**
   * **아직 치러지지 않은 경기인가.**
   *
   * ⚠**`result === null` 로 판단하면 안 된다.** 지난 경기인데 득점을 못 읽은 경우도
   * `result` 가 `null` 이다(M11) — 그걸 「예정」으로 그리면 **끝난 경기가 미래로 보인다.**
   * 실제로 그렇게 만들었다가 **중지 경기 12건이 예정으로 그려졌다**(2026-08-17).
   * 중지는 확정된 사실이지 예정이 아니다.
   */
  upcoming: boolean;
}

export interface CalendarMonth {
  /** `2026-08` */
  key: string;
  year: number;
  month: number;
  /** 그 달 1일의 요일(0=일). 격자의 앞 빈칸 수 */
  firstWeekday: number;
  /** 그 달의 날 수 */
  days: number;
  /** 날짜(1~31) → 그 날의 경기들 */
  byDay: ReadonlyMap<number, CalendarGame[]>;
}

export interface CalendarData {
  teamCode: string;
  shortName: string;
  color: TeamColor;
  months: CalendarMonth[];
  /** 오늘(JST). **주입한다**(M6) */
  today: string;
  /** 앞으로의 경기가 몇 건 들어 있나. 0이면 「일정을 아직 안 받았다」를 화면이 말한다 */
  upcoming: number;
  /** 앞으로의 일정을 언제 받았나(`YYYY-MM-DD`). 모르면 null(M4) */
  upcomingAsOf: string | null;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** `○`·`●`·`△`. ⚠**색이 아니라 글자가 먼저다** */
function mark(r: CalendarGame["result"]): string {
  switch (r) {
    case "win": return "○";
    case "loss": return "●";
    case "draw": return "△";
    case "notPlayed": return "中";
    default: return "";
  }
}

function cell(g: CalendarGame, base: string): RawHtml {
  const vs = `${g.home ? "" : "@"}${g.opponent}`;
  const score = g.runsFor === null || g.runsAgainst === null
    ? null
    : html`<b class="cscore">${g.runsFor}-${g.runsAgainst}</b>`;
  const body = html`<span class="cvs">${vs}</span>${score}${g.upcoming
    ? html`<span class="ctime">${g.startTime ?? "時刻未定"}</span>`
    : html`<span class="cmark ${g.result ?? ""}">${mark(g.result)}</span>`}`;
  /**
   * ⚠**지난 경기만 누를 수 있다.** 앞으로의 경기에는 상세 화면이 없다 —
   * 링크를 걸면 404 가 되고, 그건 고장으로 읽힌다(M12).
   */
  const cls = g.upcoming ? "cg cgup" : `cg cg${g.result ?? ""}`;
  return g.slug === null
    ? html`<span class="${cls}">${body}</span>`
    : html`<a class="${cls}" href="${base}games/${g.slug}.html">${body}</a>`;
}

/**
 * 한 달의 격자.
 *
 * ⚠**표(`<table>`)로 짓는다.** 캘린더는 2차원 자료다 — `div` 격자로 만들면
 * 낭독기가 「무엇의 몇째 줄인지」를 말하지 못한다.
 * ⚠**빈칸에도 `<td>` 를 둔다** — 칸을 빼면 요일이 밀린다.
 */
function monthGrid(m: CalendarMonth, d: CalendarData, base: string): RawHtml {
  const cells: RawHtml[] = [];
  for (let i = 0; i < m.firstWeekday; i++) cells.push(html`<td class="cpad"></td>`);
  for (let day = 1; day <= m.days; day++) {
    const iso = `${m.key}-${String(day).padStart(2, "0")}`;
    const games = m.byDay.get(day) ?? [];
    const today = iso === d.today;
    cells.push(html`<td class="${today ? "ctoday" : ""}">
      <span class="cday">${day}</span>
      ${games.length === 0 ? raw("") : games.map((g) => cell(g, base))}
    </td>`);
  }
  // 남은 칸을 채워 마지막 줄이 이지러지지 않게 한다
  while (cells.length % 7 !== 0) cells.push(html`<td class="cpad"></td>`);

  const rows: RawHtml[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(html`<tr>${cells.slice(i, i + 7)}</tr>`);
  }
  return html`<table class="cal" aria-label="${m.year}年${m.month}月の日程">
  <caption>${m.year}年${m.month}月</caption>
  <thead><tr>${WEEKDAYS.map((w, i) => html`<th class="cw${i}" scope="col"><abbr title="${w}曜日">${w}</abbr></th>`)}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/**
 * 캘린더 본체.
 *
 * ⚠**앞으로의 일정이 0건이면 그렇게 말한다**(M12의 4상태). 빈 칸만 늘어놓으면
 * 「시즌이 끝났다」인지 「일정을 아직 안 받았다」인지 구별되지 않는다.
 */
export function calendarBlock(d: CalendarData, base: string): RawHtml {
  if (d.months.length === 0) {
    return html`<p class="empty">日程がありません。</p>`;
  }
  return html`<div class="calwrap">${d.months.map((m) => monthGrid(m, d, base))}</div>
<p class="note">${raw(
    "<b>○</b>勝ち <b>●</b>負け <b>△</b>引き分け <b>中</b>中止。" +
      "<b>@</b>はビジターです。過去の試合は<b>押すと詳細</b>に移動します。" +
      (d.upcoming === 0
        ? "<b>これから先の日程はまだ取り込んでいません</b>（試合が無いという意味ではありません）。"
        : `これから先の${d.upcoming}試合は<b>NPBが公表した予定</b>で、` +
          `雨天・再編成で<b>変わることがあります</b>${d.upcomingAsOf === null ? "" : `（${d.upcomingAsOf}時点）`}。`),
  )}</p>`;
}
