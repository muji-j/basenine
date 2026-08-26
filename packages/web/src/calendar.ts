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
import { gamePath } from "./game-page.ts";
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
  /**
   * **이 시즌이 이미 끝났는가.**
   *
   * ⚠**「아직 안 받았다」와 「끝났다」는 다른 말이다**(M12 · 2026-08-18 감사 P1).
   * 이 파일 머리말이 그렇게 적어 놓고 정작 `upcoming === 0` 하나로 두 뜻을 표현하고 있었다 —
   * 실측 **48/48장**의 과거 시즌 캘린더가 「これから先の日程はまだ取り込んでいません」이라고 말했다.
   * 4년 전에 끝난 시즌에 대해 그렇게 쓰면 **수집 결함으로 읽힌다.**
   */
  seasonOver: boolean;
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

/**
 * 그 기호가 **무슨 뜻인지**.
 *
 * ⚠**기호는 눈에만 뜻이 있다**(2026-08-18 감사 P2). `○` 를 낭독기는 「まる」라고 읽는다 —
 * 범례가 표 **아래**에 있으니 소리로 듣는 사람은 뜻을 모른 채 30칸을 먼저 듣는다.
 * 특히 `中`(中止)는 **점수도 없어서** 앞뒤로 해독할 실마리가 전혀 없다.
 * → 칸마다 뜻을 글자로 붙이고, 기호 자체는 `aria-hidden` 으로 **두 번 읽히지 않게** 한다.
 */
function markLabel(r: CalendarGame["result"]): string {
  switch (r) {
    case "win": return "勝ち";
    case "loss": return "負け";
    case "draw": return "引き分け";
    case "notPlayed": return "中止";
    default: return "結果不明";
  }
}

function cell(g: CalendarGame, base: string): RawHtml {
  const vs = `${g.home ? "" : "@"}${g.opponent}`;
  const score = g.runsFor === null || g.runsAgainst === null
    ? null
    : html`<b class="cscore">${g.runsFor}-${g.runsAgainst}</b>`;
  const body = html`<span class="cvs">${vs}</span>${score}${g.upcoming
    ? html`<span class="ctime">${g.startTime ?? "時刻未定"}</span>`
    : html`<span class="cmark ${g.result ?? ""}" aria-hidden="true">${mark(g.result)}</span><span class="vh">${markLabel(g.result)}</span>`}`;
  /**
   * ⚠**지난 경기만 누를 수 있다.** 앞으로의 경기에는 상세 화면이 없다 —
   * 링크를 걸면 404 가 되고, 그건 고장으로 읽힌다(M12).
   */
  const cls = g.upcoming ? "cg cgup" : `cg cg${g.result ?? ""}`;
  return g.slug === null
    ? html`<span class="${cls}">${body}</span>`
    : html`<a class="${cls}" href="${base}${gamePath(g.slug)}">${body}</a>`;
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
    /**
     * ⚠**「오늘」이 테두리 하나뿐이었다**(2026-08-18 감사 P2). 소리로 듣는 사람에게는
     * 오늘이 어느 칸인지가 **전혀 전달되지 않았다** — 캘린더에서 가장 먼저 찾는 칸인데도.
     * `aria-current="date"` 가 그 뜻을 나르고, 눈에 보이지 않는 글자가 한 번 더 못 박는다.
     */
    cells.push(html`<td class="${today ? "ctoday" : ""}"${raw(today ? ' aria-current="date"' : "")}>
      <span class="cday">${day}</span>${today ? html`<span class="vh">（今日）</span>` : raw("")}
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
      (d.seasonOver
        ? "<b>このシーズンは終了しています</b>。"
        : d.upcoming === 0
        ? "<b>これから先の日程はまだ取り込んでいません</b>（試合が無いという意味ではありません）。"
        : `これから先の${d.upcoming}試合は<b>NPBが公表した予定</b>で、` +
          `雨天・再編成で<b>変わることがあります</b>${d.upcomingAsOf === null ? "" : `（${d.upcomingAsOf}時点）`}。`),
  )}</p>`;
}

/**
 * **정규시즌 예정만 남긴다** — 포스트시즌이 「予定」으로 새는 것을 막는 유일한 장치.
 *
 * ⚠**`upcoming_game` 에는 대회 구분이 없고, 있을 수도 없다.** 우리는 대회를
 * **박스스코어의 `【…】` 표기**로 판정하는데(`competitionFromLabel`) 안 치른 경기에는
 * 박스스코어가 없다. 월간 일정 페이지도 도와주지 않는다 —
 * **표가 하나뿐이고** CS·일본시리즈 행이 정규시즌 행과 HTML 상 완전히 같은 모양이다
 * (2025-10 페이지 실측 2026-08-18: `<table>` 1개 · 대회 표시 0개).
 *
 * ⚠**막지 않으면 조용히 섞인다**(§2-1). 그 2025-10 페이지를 그대로 파싱하면
 * **31경기 중 클라이맥스 13 · 일본시리즈 5**가 정규시즌 예정으로 들어온다.
 * 「열리지도 않은 경기」가 정규시즌 캘린더에 그려지는 것이다.
 *
 * ⚠**근거는 「팀당 그 시즌의 규정 경기수」 하나뿐이다.** 완결 8시즌(2018~2025) **× 12팀 = 96쌍이
 * 전부** `regularSeasonGames(시즌)` 과 같다(실측 2026-08-24).
 * ⚠**~~4시즌 48개가 전부 143~~ 이라고 적혀 있었다** — **2020 은 120**이다(코로나 단축).
 * 코드는 처음부터 `regularSeasonGames(season)` 라 맞았고 **틀린 것은 주석뿐**이었다(감사 P3 #54).
 * 그래서 `그 시즌의 규정 수 − 이미 치른 수` 를 넘는 예정은 정규시즌일 수 없다.
 * **팀별로 센다** — 순위가 일찍 확정된 팀이 먼저 143에 닿고 CS도 그 팀부터 붙기 때문이다.
 *
 * **2025년으로 되돌려 실측했다**(2026-08-18 · 외부 요청 0회). 9·10·11월 일정을 그대로 먹이고
 * 「오늘」을 9/25 · 10/1 · 10/5 · 10/11 넷으로 바꿔 돌린 결과:
 * **포스트시즌 40슬롯(20경기) 전부 잘렸고 정규시즌은 한 건도 잘리지 않았다.**
 * 잘린 것 중 2025-11-01·11-02 阪神@ソフトバンク 는 **일본시리즈 6·7차전**으로,
 * 시리즈가 먼저 끝나 **실제로 열리지 않은 경기**다 — 자르는 것이 맞다.
 *
 * ⚠**그래도 이건 상한이지 정답은 아니다.** 2026년을 지금 재면 5팀이 상한을 1~3 넘는다
 * (중일 = 치른 109 + 예정 37 = 146). 정체는 아직 모른다 — 예비일로 보인다.
 * 넘치는 쪽을 **뒤에서** 자르므로, 그 초과분이 시즌 중반의 예비일이었다면
 * 10월 초 경기가 대신 잘릴 수 있다. 2025년에는 그런 일이 없었다.
 * ⚠**`played` 만 센다** — 중지 행과 재편성 행이 따로 남아 행 수로 세면 팀당 144~153이 된다.
 */
export function regularSeasonUpcoming<T>(
  upcoming: readonly T[],
  playedCount: number,
  regularSeasonGames: number,
): readonly T[] {
  return upcoming.slice(0, Math.max(0, regularSeasonGames - playedCount));
}
