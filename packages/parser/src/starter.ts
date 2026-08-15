/**
 * 予告先発 페이지(`/announcement/starter/`) 파서.
 *
 * 경기 블록 하나는 이렇게 생겼다:
 *
 * ```html
 * <div class="unit cl_2">
 *   <a href="/bis/players/63165134.html"><img class="photo_left" /></a>
 *   <div class="team_left">
 *     <img src="/img/common/logo/2026/logo_d_m.gif" alt="中日ドラゴンズ" />
 *     <a href="/bis/players/63165134.html"><span>柳　裕也</span></a>
 *   </div>
 *   ... team_right ...
 *   <div class="info">（バンテリンドーム）13:30</div>
 * </div>
 * ```
 *
 * ⚠**미발표 경기는 `<a>`가 없다.** 그래서 「이름이 몇 개인가」로 짝을 지으면 안 된다 —
 * 6경기 중 2경기만 발표된 상태가 실제로 있었고(2026-08-15 실측), 순서로 맞추면
 * 조용히 다른 경기의 투수가 붙는다. **팀 블록 단위로 판정한다**(M7).
 *
 * ⚠**선수 사진 URL(`photo_left`)이 함께 오지만 쓰지 않는다**(CLAUDE.md §6).
 * 기록은 사실이지만 사진은 저작물이고 초상권이 붙는다.
 *
 * ⚠**날짜에 연도가 없다**(`8月16日の予告先発投手`). 연도는 호출자가 주입한다 —
 * 여기서 시계를 읽으면 연말 경계에서 조용히 어긋난다(M6).
 */

export class StarterParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "StarterParseError";
    this.detail = detail;
  }
}

export interface StarterSide {
  /** 로고 `alt`의 정식 구단 표기. 구단 코드로의 변환은 도메인이 한다 */
  teamName: string;
  /** 로고 파일명에서 읽은 코드. **`teamName`과 대조하는 용도**이지 단독 근거가 아니다 */
  teamCodeHint: string;
  /** 미발표면 null. **0이나 빈 문자열로 만들지 않는다**(M11) */
  playerId: string | null;
  displayName: string | null;
}

export interface StarterGame {
  /** `（バンテリンドーム）13:30` 원문 */
  info: string;
  venue: string | null;
  /** `HH:MM` */
  startTime: string | null;
  /** `cl` | `pl` — 페이지의 섹션 구분 */
  league: string;
  sides: [StarterSide, StarterSide];
}

export interface AnnouncedStarters {
  /** `MM-DD`. **연도는 붙이지 않는다** — 페이지에 없다 */
  monthDay: string;
  games: StarterGame[];
}

/**
 * ⚠**전각 공백(U+3000)을 반각으로 바꾸지 않는다.** `柳　裕也`의 가운데 공백은 표기의 일부이고,
 * `\s`나 `trim()`은 그것까지 건드린다. 정리 대상은 마크업이 만든 **ASCII 공백뿐**이다.
 */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
}

/** `<div class="team_left"> … </div>` 한 덩어리에서 한 쪽을 읽는다. */
function parseSide(block: string, which: string): StarterSide {
  const logo = /<img[^>]+src="([^"]*logo_([a-z]+)_[a-z]\.gif)"[^>]*alt="([^"]*)"/i.exec(block);
  if (logo === null) {
    throw new StarterParseError(`${which}의 구단 로고를 찾지 못했다`, block.slice(0, 200));
  }
  const teamCodeHint = logo[2]!;
  const teamName = logo[3]!.trim();

  // 선수 링크는 로고 뒤에 온다. 사진 링크(`photo_left`)는 이 블록 밖에 있다
  const link = /<a[^>]+href="\/bis\/players\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/.exec(block);
  if (link === null) {
    // 미발표. 이것은 실패가 아니라 상태다(M11)
    return { teamName, teamCodeHint, playerId: null, displayName: null };
  }
  const displayName = text(link[2]!);
  if (displayName === "") {
    throw new StarterParseError(`${which}의 선수명이 비어 있다`, block.slice(0, 200));
  }
  return { teamName, teamCodeHint, playerId: link[1]!, displayName };
}

const UNIT = /<div class="unit (cl|pl)_\d+">([\s\S]*?)<div class="info">([\s\S]*?)<\/div>/g;

/**
 * @param html 予告先発 페이지 원문
 * @throws {StarterParseError} 날짜 제목이나 경기 블록을 찾지 못했을 때.
 *   **빈 목록을 조용히 돌려주지 않는다** — 구조가 바뀌면 화면이 매일 「未発表」가 된다.
 */
export function parseAnnouncedStarters(html: string): AnnouncedStarters {
  const heading = /<h4>\s*(\d{1,2})月(\d{1,2})日の予告先発投手\s*<\/h4>/.exec(html);
  if (heading === null) {
    throw new StarterParseError("날짜 제목(◯月◯日の予告先発投手)을 찾지 못했다", `length=${html.length}`);
  }
  const monthDay = `${heading[1]!.padStart(2, "0")}-${heading[2]!.padStart(2, "0")}`;

  const games: StarterGame[] = [];
  for (const unit of html.matchAll(UNIT)) {
    const league = unit[1]!;
    const body = unit[2]!;
    const info = text(unit[3]!);

    const sides: StarterSide[] = [];
    for (const which of ["left", "right"] as const) {
      const at = body.indexOf(`<div class="team_${which}">`);
      if (at < 0) {
        throw new StarterParseError(`team_${which} 블록이 없다`, body.slice(0, 200));
      }
      // 다음 team_ 블록(또는 끝)까지를 이 쪽의 범위로 본다
      const rest = body.slice(at);
      const nextAt = rest.indexOf(`<div class="team_`, 1);
      sides.push(parseSide(nextAt < 0 ? rest : rest.slice(0, nextAt), `team_${which}`));
    }

    const venue = /（([^）]*)）/.exec(info);
    const time = /(\d{1,2}:\d{2})/.exec(info);
    games.push({
      info,
      venue: venue === null ? null : venue[1]!.replace(/\s+/g, ""),
      startTime: time === null ? null : time[1]!,
      league,
      sides: [sides[0]!, sides[1]!],
    });
  }

  if (games.length === 0) {
    throw new StarterParseError("경기 블록(div.unit)을 하나도 찾지 못했다", `length=${html.length}`);
  }
  return { monthDay, games };
}
