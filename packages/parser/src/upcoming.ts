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
  /** 팀 이름을 못 읽은 행. 0이 아니면 표기가 바뀐 것이다(M7) */
  unreadableRows: number;
}

/** `<tr id="dateMMDD">` 로 행을 가른다. ⚠날짜는 첫 경기에만 붙는 `<th>` 가 아니라 이 id 에서 온다 */
const ROW = /<tr[^>]*id="date(\d{4})"[\s\S]*?(?=<tr[^>]*id="date|<\/table>)/g;

/**
 * @param season 연도. **페이지에 없다** — 표는 `8/18（火）` 라고만 쓴다. 호출자가 안다.
 */
export function parseUpcoming(html: string, season: number): UpcomingResult {
  const games: UpcomingGame[] = [];
  let nonTeamRows = 0;
  let unreadableRows = 0;

  for (const m of html.matchAll(ROW)) {
    const mmdd = m[1]!;
    const row = m[0];
    const home = /<div class="team1">([^<]*)<\/div>/.exec(row)?.[1]?.trim() ?? "";
    const away = /<div class="team2">([^<]*)<\/div>/.exec(row)?.[1]?.trim() ?? "";
    if (home === "" || away === "") {
      // ⚠**경기가 없는 날**(월요일 등)은 팀 칸 자체가 없다. 그건 결손이 아니라 정상이다
      if (/<div class="team1">/.test(row)) unreadableRows += 1;
      continue;
    }
    if (!isTeamShortName(home) || !isTeamShortName(away)) {
      nonTeamRows += 1;
      continue;
    }
    const venue = normalizeVenue(/<div class="place">([^<]*)<\/div>/.exec(row)?.[1] ?? "");
    const t = /<div class="time">\s*(\d{1,2}:\d{2})\s*<\/div>/.exec(row)?.[1] ?? null;
    games.push({
      date: `${season}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`,
      homeCode: teamCodeByShortName(home),
      awayCode: teamCodeByShortName(away),
      venue,
      startTime: t,
      played: /\/scores\/\d{4}\/\d{4}\/[^/]+\//.test(row),
    });
  }
  return { games, nonTeamRows, unreadableRows };
}
