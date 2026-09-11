/**
 * 월간 일정 표에서 **앞으로의 경기**를 읽는다.
 *
 * ⚠**이 파일이 없어서 미래 일정이 DB에 한 건도 없었다**(2026-08-17).
 * 일정 페이지는 **월 단위로 통째**를 담는데(실측: 8월 페이지에 31일 · 치러진 83 + 앞으로 70),
 * 기존 파서가 **점수 링크가 붙은 경기만** 뽑아서 앞으로의 경기를 통째로 버렸다 —
 * CLAUDE.md §2-2-1 「받고 있는데 안 읽던 것」의 네 번째 사례다. 외부 요청은 0회로 해결된다.
 *
 * ⚠**`team1` 이 홈, `team2` 가 원정이다.** 추측이 아니라 실측이다 —
 * 아카이브 6개월치에서 점수 링크가 있는 경기 **675건**을 DB의 `home_code`/`away_code` 와
 * 대조해 전부 일치했다(어긋난 2건은 올스타의 `セ・リーグ` 표기 차이일 뿐 방향은 같다).
 * 이걸 뒤집으면 구장·홈어드밴티지·승패가 전부 뒤집힌다.
 *
 * ⚠**구단이 아닌 행이 섞인다** — 올스타는 `セ・リーグ`/`パ・リーグ` 다. 조용히 버리지 않고
 * **세어서 돌려준다**(M11: 「없음」과 「못 읽음」을 구별한다).
 */
import { isTeamShortName, teamCodeByShortName } from "@bb-app/domain";
import { normalizeVenue } from "./schedule.ts";

export interface UpcomingGame {
  /** `YYYY-MM-DD`(JST). 일정 표의 행 id(`date0818`)와 시즌에서 만든다 */
  date: string;
  homeCode: string;
  awayCode: string;
  /** `横浜` 등. 미정이면 빈 문자열 */
  venue: string;
  /** `18:00`. 미정이면 `null`(M11 — 「0시」가 아니다) */
  startTime: string | null;
  /**
   * 이 행에 점수 링크가 있었는가 = **이미 치러진 경기**인가.
   * ⚠호출자가 이걸로 거른다. 파서가 미리 버리면 「몇 건을 봤는지」를 셀 수 없다.
   */
  played: boolean;
}

export interface UpcomingResult {
  games: UpcomingGame[];
  /** 구단이 아닌 행(올스타 등). **버린 수를 센다** */
  nonTeamRows: number;
  /** 못 읽은 행. 0이 아니면 표기가 바뀐 것이다(M7) — 분류 규칙은 `classifyScheduleRows` */
  unreadableRows: number;
  /** `<tr id="dateMMDD">` 행 수. ⚠**날짜 수가 아니다** — 한 날짜에 경기가 여럿이면 행이 반복된다 */
  dateRows: number;
  /** 경기가 없는 날의 공백 행 수 */
  blankRows: number;
  /** 대진이 안 정해진 행사 자리(`セ・CSファーストS` · `(予備日)` …) 행 수 */
  placeholderRows: number;
  /** 날짜 행의 `MMDD` — 중복 없이 나온 순서대로. 적재기의 날짜 완결성 판정 재료 */
  dateKeys: string[];
}

/**
 * 월간 일정 표를 **행 단위로 다섯 중 하나로** 가른 결과.
 *
 * | 분류 | 조건 |
 * |---|---|
 * | 공백 | 날짜 머리칸(`<th>`)을 뺀 나머지가 태그·공백·`&nbsp;` 뿐 — 그 날 경기가 없다 |
 * | 예정 표기 | 팀 칸이 없고, `div.commentLong` 에 글자가 있고, 그것을 빼면 나머지가 공백뿐 — 대진 미정 행사 자리 |
 * | 경기 | `div.team1`·`div.team2` 가 둘 다 비지 않았고 둘 다 NPB 구단 약칭 |
 * | 구단 아님 | 두 칸이 `セ・リーグ`·`パ・リーグ` 의 조합(올스타 · 허용 목록 `NON_TEAM_LABELS`) |
 * | 못 읽음 | 그 밖 — **칸에 글자가 있는데 경기로 못 읽었다**, **팀 칸이 비었다**, **점수 숫자가 있는데 점수 링크가 없다**, **허용 목록 밖 구단 표기** |
 *
 * ⚠**「예정 표기」는 실물에서 찾았다**(2026-09-11). 설계 초안에는 넷뿐이었는데, 실물 월간 일정 75장 전수에
 * 돌리자 **2026년 10월 페이지 1장에서 30행**이 「못 읽음」으로 떨어졌다 — `セ・CSファーストS` · `パ・CSファイナルS` ·
 * `(予備日)` · `日本シリーズ セ本拠地球場` 이다. 그대로 뒀으면 **10월 일정을 받는 날부터 적재기가 구조 변경으로 멈췄다.**
 * 나머지 74장은 옛 파서와 경기 목록이 **전부 같다**.
 *
 * ⚠**「날짜 행만 있으면 경기가 없는 달」로 받던 것이 구조 변경을 가렸다**(2026-09-11 · 콜드 리뷰 지적) —
 * 경기 칸의 클래스만 바뀐 페이지도 날짜 행은 그대로라 「경기 0 · 못 읽음 0」이 됐다.
 * ⚠**「숫자 ⇒ 링크」는 실측이다** — 로컬 아카이브 월간 일정 75장 · 경기 칸 8,027개에서 **숫자가 있는데 링크가 없는 칸 0개**
 * (링크만 있고 숫자가 없는 287칸은 중지 등이다). 링크 모양이 바뀌면 치러진 경기가 조용히 「앞으로의 경기」가 되므로 막는다.
 */
export interface ScheduleRows {
  /** `<tr id="dateMMDD">` 행 수 */
  dateRows: number;
  /**
   * 날짜 행의 `MMDD` — **중복 없이 나온 순서대로**.
   * ⚠적재기가 **날짜 완결성**(그 달 날짜가 말일까지 이어지는가)을 판정하는 재료다 — 일부 날짜만 담긴 응답을
   * 「파싱이 됐다」로 받으면 달 교체가 사라진 날의 치러짐 표시를 지운다(설계 D5 · 콜드 리뷰 지적).
   */
  dateKeys: string[];
  blank: number;
  placeholder: number;
  games: UpcomingGame[];
  nonTeam: number;
  unreadable: number;
}

/**
 * 날짜 행의 앵커. ⚠**홑·곁따옴표를 다 받는다** — 한쪽만 받으면 따옴표만 바뀐 멀쩡한 페이지가
 * 「날짜 행 0」이 되어 구조 변경으로 멈춘다. `\s` 로 `data-id="date…"` 같은 다른 속성을 걸러낸다.
 * ⚠**수집기(`archiver/src/discover.ts`)도 이 함수를 쓴다**(M1) — 앵커를 두 벌 두면 두 가드의 전제가 갈린다.
 */
const ROW = /<tr[^>]*\sid=(["'])date(\d{4})\1[\s\S]*?(?=<tr[^>]*\sid=["']date\d{4}["']|<\/table>)/g;

/** 점수 링크 — 이것이 있으면 NPB 가 「치렀다」고 표시한 경기다 */
const SCORE_LINK = /\/scores\/\d{4}\/\d{4}\/[^/"']+\//;

/**
 * **「구단 아님」으로 인정하는 표기** — 올스타뿐이다.
 * ⚠**모르는 약칭을 전부 여기로 빼면 구단 약칭이 바뀌는 날 그 구단 경기가 조용히 치러짐 표시에서 빠진다**(2026-09-11 · 콜드 리뷰 지적).
 * 실측: 월간 일정 75장에서 「구단 아님」은 **16행 · 두 표기**(`セ・リーグ - パ・リーグ` 9 · `パ・リーグ - セ・リーグ` 7)뿐이다.
 * 새 표기가 실물에 나타나면 「못 읽음」으로 멈추고, 사람이 여기에 더한다.
 */
const NON_TEAM_LABELS: ReadonlySet<string> = new Set(["セ・リーグ", "パ・リーグ"]);

/**
 * **대진이 정해지는 도중일 수 있는 달** — 포스트시즌(CS · 일본시리즈)이 치러지는 10·11월(2020 은 11월).
 *
 * ⚠⚠**이 달의 점수 링크·숫자 없는 행만** 모르는 구단 표기를 「예정 표기」로 받는다(2026-09-11 · 3중 검토 2차 N1).
 * 리그 우승이 정해진 뒤 `阪神 − CS勝者` 처럼 한쪽만 구단인 행이 나올 수 있는데 그 모양은 **실물로 안 쟀다** —
 * 못 읽음으로 두면 이 설계가 겨냥한 10월에 적재기가 멈춘다.
 * ⚠**링크·숫자가 있으면 못 읽음이다** — 허용 목록의 사유(치러진 경기가 조용히 빠진다)는 거기서 성립한다.
 * ⚠**3~9월은 풀지 않는다** — 오프시즌에 약칭이 바뀌면 새 시즌 일정이 공표되는 날 정규시즌 달에서 멈춘다.
 *   미래 행 전부를 풀면 그 구단 경기가 개막까지 몇 달 동안 「예정 표기」로 숨는다(M7).
 */
const PENDING_MATCHUP_MONTHS: ReadonlySet<string> = new Set(["10", "11"]);

/**
 * 월간 일정 표를 행 단위로 분류한다.
 *
 * @param season 연도. **페이지에 없다** — 표는 `8/18（火）` 라고만 쓴다. 호출자가 안다. 파서는 시계를 읽지 않는다(M6).
 */
export function classifyScheduleRows(html: string, season: number): ScheduleRows {
  const out: ScheduleRows = { dateRows: 0, dateKeys: [], blank: 0, placeholder: 0, games: [], nonTeam: 0, unreadable: 0 };
  const seenKeys = new Set<string>();

  for (const m of html.matchAll(ROW)) {
    out.dateRows += 1;
    const mmdd = m[2]!;
    if (!seenKeys.has(mmdd)) {
      seenKeys.add(mmdd);
      out.dateKeys.push(mmdd);
    }
    const row = m[0];
    const home = /<div class="team1">([^<]*)<\/div>/.exec(row)?.[1]?.trim() ?? "";
    const away = /<div class="team2">([^<]*)<\/div>/.exec(row)?.[1]?.trim() ?? "";
    if (home === "" || away === "") {
      // ⚠**경기가 없는 날은 팀 칸 자체가 없고 칸이 `&nbsp;` 뿐이다**(실측). 그것만 공백이다.
      //   **대진 미정 행사 자리는 팀 칸 없이 `commentLong` 에만 글자가 있다**(실측) — 예정 표기다.
      //   팀 칸이 있는데 비었거나, 팀 칸이 없는데 **그 밖의 글자가 남아 있으면** 못 읽은 것이다.
      const body = row.replace(/<th[\s\S]*?<\/th>/g, "");
      const text = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim();
      const label = [...body.matchAll(/<div class="commentLong">([^<]*)<\/div>/g)].map((x) => text(x[1]!)).join("");
      // ⚠**일본시리즈 자리는 장소 칸에도 임시 표기가 있다**(`セ本拠地球場` · 2026-10-24 실측) —
      //   그래서 예정 표기는 「알려진 칸 밖에 글자가 없다」로 본다. 공백은 「머리칸 밖에 글자가 전혀 없다」로 더 엄격하다.
      const outsideKnown = text(body.replace(/<div class="(?:commentLong|place|time|weather|comment)">[^<]*<\/div>/g, ""));
      if (/<div class="team1">/.test(row)) out.unreadable += 1;
      else if (text(body) === "") out.blank += 1;
      else if (label !== "" && outsideKnown === "") out.placeholder += 1;
      else out.unreadable += 1;
      continue;
    }
    const played = SCORE_LINK.test(row);
    const scored = /<div class="score[12]">\s*\d+\s*<\/div>/.test(row);
    if (!isTeamShortName(home) || !isTeamShortName(away)) {
      if (NON_TEAM_LABELS.has(home) && NON_TEAM_LABELS.has(away)) out.nonTeam += 1;
      else if (!played && !scored && PENDING_MATCHUP_MONTHS.has(mmdd.slice(0, 2))) out.placeholder += 1;
      else out.unreadable += 1;
      continue;
    }
    if (scored && !played) {
      out.unreadable += 1;
      continue;
    }
    const venue = normalizeVenue(/<div class="place">([^<]*)<\/div>/.exec(row)?.[1] ?? "");
    const t = /<div class="time">\s*(\d{1,2}:\d{2})\s*<\/div>/.exec(row)?.[1] ?? null;
    out.games.push({
      date: `${season}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`,
      homeCode: teamCodeByShortName(home),
      awayCode: teamCodeByShortName(away),
      venue,
      startTime: t,
      played,
    });
  }
  return out;
}

/**
 * @param season 연도. **페이지에 없다** — 표는 `8/18（火）` 라고만 쓴다. 호출자가 안다.
 * ⚠**분류는 `classifyScheduleRows` 한 벌이다**(M1) — 여기서 다시 판정하지 않는다.
 */
export function parseUpcoming(html: string, season: number): UpcomingResult {
  const r = classifyScheduleRows(html, season);
  return {
    games: r.games,
    nonTeamRows: r.nonTeam,
    unreadableRows: r.unreadable,
    dateRows: r.dateRows,
    blankRows: r.blank,
    placeholderRows: r.placeholder,
    dateKeys: r.dateKeys,
  };
}
