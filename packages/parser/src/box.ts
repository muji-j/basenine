/**
 * npb.jp 박스스코어(`box.html`) 파서.
 *
 * ⚠**컬럼 인덱스를 고정하지 않는다.** 실측(2026-08-15, 297경기)에서 타격표 헤더가 **23종**
 * 나왔다 — 연장전이면 이닝 컬럼이 늘고, 중간에 빈 스페이서 컬럼이 끼는 변형도 있다.
 * 인덱스를 상수로 박으면 연장전에서 조용히 어긋난다. **헤더를 읽어서 위치를 찾는다.**
 *
 * ⚠구조가 바뀌어 필수 요소를 못 찾으면 **빈 값이 아니라 예외**다(M7).
 */
import { parsePaCell } from "./tokens.ts";
import type { PaResult } from "./tokens.ts";

export class BoxParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "BoxParseError";
    this.detail = detail;
  }
}

export interface BatterRow {
  /** 타순. 교체 선수는 앞 선수와 같은 타순이며 원문이 비어 있으면 null */
  order: string | null;
  /** `(遊)` 같은 수비 위치 표기 */
  position: string;
  /** 표시명. **조인 키로 쓰지 마라**(M10) — 동명이인·등록명 변경이 실재한다 */
  name: string;
  /**
   * NPB 공식 선수 ID(`/bis/players/41845132.html` → `41845132`).
   * **이것이 조인 키다.** 합계 행 등 링크가 없는 행은 null.
   */
  playerId: string | null;
  ab: number;
  runs: number;
  hits: number;
  rbi: number;
  steals: number;
  /** 타석별 결과. 빈 칸은 제외된다 */
  plateAppearances: PaResult[];
  /**
   * `チーム計` 행인가. 표의 마지막에 팀 합계가 선수와 같은 모양으로 들어 있다.
   * ⚠**버리지 않고 표시만 한다** — 우리가 도출한 합계와 대조하는 데 쓸 수 있다.
   */
  isTeamTotal: boolean;
}

/** 팀 합계 행의 이름 표기. */
const TEAM_TOTAL_LABEL = "チーム計";

export interface PitcherRow {
  /** `○` `●` `S` `H` 등. 없으면 빈 문자열 */
  decision: string;
  /** 표시명. **조인 키로 쓰지 마라**(M10) */
  name: string;
  /** NPB 공식 선수 ID. **이것이 조인 키다** */
  playerId: string | null;
  /** `チーム計` 행인가. **투수표에도 합계 행이 있다** — 함께 더하면 정확히 2배가 된다 */
  isTeamTotal: boolean;
  pitches: number | null;
  battersFaced: number | null;
  /** 투구회를 아웃 카운트로 환산한 값. `6.2` → 20 */
  outs: number | null;
  hits: number | null;
  homeRuns: number | null;
  walks: number | null;
  hitByPitch: number | null;
  strikeouts: number | null;
  runs: number | null;
  earnedRuns: number | null;
}

/**
 * 박스스코어 파싱 결과.
 *
 * ⚠**「경기가 없어서 성적이 없다」와 「구조가 바뀌어 못 읽는다」를 구별한다**(M7·M11).
 * 중지 경기는 정상적으로 타격표가 없다 — 이걸 오류로 세면 매년 우천 시즌마다 거짓 경보가 울리고,
 * 반대로 오류를 중지로 뭉개면 구조 변경을 놓친다.
 */
export type BoxScore =
  | {
      status: "played";
      /** 선공(원정) */
      away: { batters: BatterRow[]; pitchers: PitcherRow[] };
      /** 후공(홈) */
      home: { batters: BatterRow[]; pitchers: PitcherRow[] };
    }
  | {
      status: "notPlayed";
      /** 페이지가 표시한 사유 원문(`中止` 등) */
      reason: string;
    };

const TABLE_IDS = {
  awayBatting: "tablefix_t_b",
  awayPitching: "tablefix_t_p",
  homeBatting: "tablefix_b_b",
  homePitching: "tablefix_b_p",
} as const;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 셀을 **원본 HTML 그대로** 돌려준다.
 * ⚠태그를 여기서 벗기면 선수 링크의 ID가 사라진다 — M10(이름 문자열 조인 금지)을
 * 지키려면 `/bis/players/{id}.html` 의 공식 ID가 필요하다.
 */
/**
 * ⚠`投球回` 셀 안에는 **중첩 테이블**이 들어 있다.
 *
 * ```html
 * <td><table class="table_inning"><tbody><tr><th>1</th><td>.2</td></tr></tbody></table></td>
 * ```
 *
 * 정수 이닝과 분수를 나눠 조판하기 위한 것인데, 셀 추출 정규식이 **안쪽 셀을 먼저 잡아
 * 바깥 행이 통째로 어긋난다.** 실제로 투수 성적이 전부 한 칸씩 밀려 null이 됐다.
 * → 셀을 나누기 **전에** 중첩 테이블을 그 텍스트(`1.2`)로 평탄화한다.
 */
function flattenInningTables(html: string): string {
  return html.replace(/<table class="table_inning">[\s\S]*?<\/table>/g, (m) =>
    stripTags(m).replace(/\s+/g, ""),
  );
}

/**
 * ⚠**평탄화는 문서 전체에 먼저 적용해야 한다.** 중첩 테이블의 `</table>`이
 * 바깥 표의 비탐욕 매칭을 먼저 끊어버리기 때문이다 — 그래서 투수표가 5번째 셀에서 잘렸다.
 */
function tableRows(flatHtml: string, id: string): string[][] {
  const table = new RegExp(`<table id="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(flatHtml);
  if (!table) throw new BoxParseError("표를 찾지 못했다", `id=${id}`);
  const rows = [...table[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]!),
  );
  if (rows.length === 0) throw new BoxParseError("표에 행이 없다", `id=${id}`);
  return rows;
}

/** 셀 원본 HTML → 표시 문자열. */
function text(cell: string | undefined): string {
  return cell === undefined ? "" : stripTags(cell);
}

/**
 * 선수 셀에서 NPB 공식 선수 ID를 뽑는다.
 * 없으면 null — 합계 행이나 링크 없는 표기가 실재하므로 예외로 만들지 않는다(M11).
 */
export function extractPlayerId(cellHtml: string | undefined): string | null {
  if (cellHtml === undefined) return null;
  const m = /\/bis\/players\/(\d+)\.html/.exec(cellHtml);
  return m ? m[1]! : null;
}

/** 숫자 셀. 빈 칸·기호는 null(M11 — 0으로 메우지 않는다). */
function num(cell: string | undefined): number | null {
  const t = text(cell);
  if (t === "" || t === "-" || t === "−") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function requireNum(cell: string | undefined, what: string, id: string): number {
  const n = num(cell);
  if (n === null) {
    throw new BoxParseError(`${what}를 수로 읽지 못했다`, `id=${id} value=${JSON.stringify(text(cell))}`);
  }
  return n;
}

/** `6.2`(6과 3분의 2이닝) → 아웃 20. 부동소수로 다루지 않는다. */
export function inningsToOuts(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "-") return null;
  const m = /^(\d+)(?:\.(\d))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]);
  const thirds = m[2] === undefined ? 0 : Number(m[2]);
  if (thirds > 2) return null;
  return whole * 3 + thirds;
}

function parseBatting(html: string, id: string): BatterRow[] {
  const rows = tableRows(html, id);
  const header = rows[0]!.map(text);

  const stealsAt = header.findIndex((h) => h.includes("盗塁"));
  if (stealsAt < 0) {
    throw new BoxParseError("타격표 헤더에서 盗塁 열을 찾지 못했다", `id=${id} header=${header.join("|")}`);
  }
  const col = {
    position: header.findIndex((h) => h.includes("守備")),
    name: header.findIndex((h) => h.includes("選手")),
    ab: header.findIndex((h) => h.includes("打数")),
    runs: header.findIndex((h) => h.includes("得点")),
    hits: header.findIndex((h) => h.includes("安打")),
    rbi: header.findIndex((h) => h.includes("打点")),
  };
  for (const [key, at] of Object.entries(col)) {
    if (at < 0) throw new BoxParseError(`타격표 헤더에서 ${key} 열을 찾지 못했다`, `id=${id} header=${header.join("|")}`);
  }

  return rows.slice(1).map((cells) => {
    const order = text(cells[0]);
    const name = text(cells[col.name]);
    return {
      order: order === "" ? null : order,
      position: text(cells[col.position]),
      name,
      playerId: extractPlayerId(cells[col.name]),
      isTeamTotal: name === TEAM_TOTAL_LABEL,
      ab: requireNum(cells[col.ab], "打数", id),
      runs: requireNum(cells[col.runs], "得点", id),
      hits: requireNum(cells[col.hits], "安打", id),
      rbi: requireNum(cells[col.rbi], "打点", id),
      steals: requireNum(cells[stealsAt], "盗塁", id),
      plateAppearances: cells
        .slice(stealsAt + 1)
        .map((c) => parsePaCell(text(c)))
        .filter((p): p is PaResult => p !== null),
    };
  });
}

function parsePitching(html: string, id: string): PitcherRow[] {
  const rows = tableRows(html, id);
  const header = rows[0]!.map(text);
  const at = (label: string): number => {
    const i = header.findIndex((h) => h.includes(label));
    if (i < 0) throw new BoxParseError(`투수표 헤더에서 ${label} 열을 찾지 못했다`, `id=${id} header=${header.join("|")}`);
    return i;
  };
  const col = {
    name: at("投手"),
    pitches: at("投球数"),
    bf: at("打者"),
    innings: at("投球回"),
    hits: at("安打"),
    hr: at("本塁打"),
    bb: at("四球"),
    hbp: at("死球"),
    so: at("三振"),
    runs: at("失点"),
    er: at("自責点"),
  };

  return rows.slice(1).map((cells) => ({
    decision: text(cells[0]),
    name: text(cells[col.name]),
    playerId: extractPlayerId(cells[col.name]),
    isTeamTotal: text(cells[col.name]) === TEAM_TOTAL_LABEL,
    pitches: num(cells[col.pitches]),
    battersFaced: num(cells[col.bf]),
    outs: inningsToOuts(text(cells[col.innings])),
    hits: num(cells[col.hits]),
    homeRuns: num(cells[col.hr]),
    walks: num(cells[col.bb]),
    hitByPitch: num(cells[col.hbp]),
    strikeouts: num(cells[col.so]),
    runs: num(cells[col.runs]),
    earnedRuns: num(cells[col.er]),
  }));
}

/** 경기가 성립하지 않았음을 나타내는 표기. */
const NOT_PLAYED_MARKERS = ["中止", "ノーゲーム", "サスペンデッド"] as const;

function notPlayedReason(html: string): string | null {
  for (const marker of NOT_PLAYED_MARKERS) {
    if (html.includes(marker)) return marker;
  }
  return null;
}

/**
 * @throws {BoxParseError} 경기가 열렸는데 표를 읽지 못했을 때.
 * ⚠이 예외를 삼켜 빈 결과로 만들지 마라 — 그러면 구조 변경이 「그날 아무도 안 쳤다」가 된다.
 */
export function parseBoxScore(rawHtml: string): BoxScore {
  const html = flattenInningTables(rawHtml);
  const hasBattingTable = html.includes(`<table id="${TABLE_IDS.awayBatting}"`);
  if (!hasBattingTable) {
    const reason = notPlayedReason(html);
    // 표가 없는데 중지 표기도 없다 → 구조 변경을 의심해야 한다. 조용히 넘기지 않는다.
    if (reason === null) {
      throw new BoxParseError(
        "타격표가 없는데 중지 표기도 없다 — 페이지 구조 변경을 의심하라",
        `id=${TABLE_IDS.awayBatting} length=${html.length}`,
      );
    }
    return { status: "notPlayed", reason };
  }

  return {
    status: "played",
    away: {
      batters: parseBatting(html, TABLE_IDS.awayBatting),
      pitchers: parsePitching(html, TABLE_IDS.awayPitching),
    },
    home: {
      batters: parseBatting(html, TABLE_IDS.homeBatting),
      pitchers: parsePitching(html, TABLE_IDS.homePitching),
    },
  };
}
