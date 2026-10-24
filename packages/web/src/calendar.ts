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
    : html`<a class="${cls}" href="${base}${gamePath(g.date, g.slug)}">${body}</a>`;
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
 * **이미 적재된 경기를 예정에서 뺀다** — 같은 (날짜·홈·원정)의 경기 행 수만큼, **앞에서부터**(안정 순서 · `seq`).
 *
 * ⚠**왜**(2026-10-25 · PR-3 검토 GPT P2): 받기 실패만이면 배포한다(2026-10-24 운영 결정) — 경기는 받고 일정 사본은 못 받은 실행에서
 *   **같은 경기가 경기 행과 예정에 한 번씩** 남는다(`assertOneGamePerTeam` 이 이 상태를 정상으로 받는다). 그대로 두면 그 날 저녁 빌드에서
 *   구단의 「次の試合」가 **끝난 경기**를 가리키고(日本シリーズ 1차전에서 재현), 아래 정규 컷(`splitUpcoming`)의 자리도 하나 잡아먹는다.
 * ⚠**다중집합으로 뺀다** — 단순 `NOT EXISTS` 가 아니다. 진짜 더블헤더에서 1경기만 적재됐으면 **남은 경기는 남는다.**
 * ⚠**경기 행의 상태를 가리지 않는다** — 중지(`notPlayed`)도 「그 경기는 이미 지나갔다」다(재편성은 새 날짜의 새 예정 행으로 온다).
 * @param upcoming 예정 — **안정 순서**(`game_date, seq, home_code, away_code`)로 들어와야 한다(같은 열쇠는 앞의 것부터 뺀다)
 * @param loaded `loadedKey(날짜, 홈, 원정)` → 그 경기 행 수
 */
export function withoutLoaded<T extends { date: string; home: string; away: string }>(
  upcoming: readonly T[],
  loaded: ReadonlyMap<string, number>,
): T[] {
  const left = new Map(loaded);
  return upcoming.filter((u) => {
    const key = loadedKey(u.date, u.home, u.away);
    const n = left.get(key) ?? 0;
    if (n <= 0) return true;
    left.set(key, n - 1);
    return false;
  });
}

/** `withoutLoaded` 의 열쇠 — 질의와 함수가 같은 모양을 쓴다(M1) */
export function loadedKey(date: string, home: string, away: string): string {
  return `${date}|${home}|${away}`;
}

/**
 * 컷의 **양쪽** — 정규시즌일 수 있는 앞쪽(`regular`)과 그 밖(`beyond`).
 * **정규시즌 예정만 남기는 것**(`regular`)이 포스트시즌이 「予定」으로 새는 것을 막는 유일한 장치다.
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
 * ⚠**자르기 전에 순서가 정해져 있어야 한다**(2026-10-24 · 설계 D7 지적 6) — 같은 날 두 행이면 「어느 쪽이 컷 안인가」를
 *   SQLite 의 반환 순서에 맡기게 된다(삽입 순서를 뒤집은 DB 둘이 다른 컷을 냈다 · `postseason-timeline.test.ts` T9⑹).
 *   그래서 호출자의 질의가 `game_date, seq, home_code, away_code` 로 정렬한다.
 * ⚠**자르기 전에 이미 적재된 경기를 뺀다**(`withoutLoaded` · 2026-10-25) — 낡은 사본에 남은 끝난 경기가 컷 자리를 잡아먹지 않게.
 *
 * ⚠**`beyond` 를 「포스트시즌」이라고 부르지 않는다.** 정규 규정 수를 넘는 예정일 뿐이다 —
 * 교류전 재편성·예비일·정체 불명의 초과분(위의 2026 중일 146)이 섞일 수 있다.
 * 그중 무엇을 日本シリーズ 로 부를 수 있는지는 `nipponSeriesSlot` 이 따로 정한다(설계 D7-3).
 * ⚠~~`regularSeasonUpcoming`(이 함수의 `regular` 만 돌려주는 껍데기)~~ 은 지웠다(2026-10-25 · PR-3 검토 RS P3) — 제품 코드는 이 함수만
 *   부르고 껍데기는 시험만 불러서 **같은 컷 규칙의 입구가 둘**이었다. 시험은 이제 이 함수의 `regular` 를 직접 잰다.
 */
export function splitUpcoming<T>(
  upcoming: readonly T[],
  playedCount: number,
  regularSeasonGames: number,
): { regular: readonly T[]; beyond: readonly T[] } {
  const keep = Math.max(0, regularSeasonGames - playedCount);
  return { regular: upcoming.slice(0, keep), beyond: upcoming.slice(keep) };
}

/**
 * 컷 밖 슬롯 중 **日本シリーズ로 부를 수 있는 첫 행** — 없으면 null(설계 D7-3).
 *
 * 일정 표에는 대회 구분이 없다(위 `splitUpcoming` 주석). 그래서 **조건으로 닫는다** — 셋 다 참일 때만:
 * ⑴ **12구단 전부** 정규를 규정 수만큼 치렀다 — 어느 팀에도 정규 경기가 남아 있을 수 없다
 * ⑵ 그 슬롯의 날짜가 **그 시즌 정규 마지막 경기일보다 뒤**다 — 정규의 날짜 범위 밖이다
 * ⑶ 상대가 **다른 리그**다 — 그 뒤에 다른 리그끼리 맞붙는 1군 경기는 日本シリーズ뿐이다(CS 는 같은 리그 104/104 실측)
 *
 * ⚠**하나라도 아니면 표기하지 않는다** — 그때 호출자는 「全日程を終えました」·「予定はありません」으로 떨어진다.
 * ⚠**특이도는 2026 의 7행으로만 쟀다**(지난 일정 사본은 DB 에 안 남는다) — 그래서 측정이 아니라 조건으로 닫는다.
 * ⚠**CS 슬롯은 내지 않는다**(같은 리그면 ⑶ 에서 떨어진다) — 탈락을 판정할 수 없어 열리지 않을 「필요 시 경기」를
 *   「次」로 부를 수 있다(설계 D4 · §10).
 * ⚠`beyond` 는 **이미 안정 순서로** 들어온다(`game_date, seq, home_code, away_code`) — 첫 행이 곧 「次」다.
 */
export function nipponSeriesSlot<T extends { date: string; opponentCode: string }>(
  beyond: readonly T[],
  o: {
    /** ⑴ 12구단 전부 played = 규정 수 */
    allTeamsDone: boolean;
    /** ⑵ 그 시즌 정규 마지막 경기일(상태 무관). 모르면 null — 그러면 표기하지 않는다 */
    regularLastDate: string | null;
    /** ⑶ 이 구단과 상대가 다른 리그인가 */
    otherLeague: (opponentCode: string) => boolean;
  },
): T | null {
  if (!o.allTeamsDone || o.regularLastDate === null) return null;
  const last = o.regularLastDate;
  return beyond.find((s) => s.date > last && o.otherLeague(s.opponentCode)) ?? null;
}
