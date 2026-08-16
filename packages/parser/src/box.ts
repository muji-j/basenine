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
  /**
   * 폭투·보크. ⚠**표에 열이 있는데 지금까지 건너뛰고 있었다**(2026-08-15 발견).
   * 제구를 말할 때 BB/9과 함께 보면 그림이 완성된다.
   */
  wildPitches: number | null;
  balks: number | null;
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
/**
 * 2016~2018년경의 구형 마크업.
 *
 * ⚠**id 가 없다.** 표를 `<div class="scroll_wrapper table_score table_batter">` 로 감싸고
 * 순서(원정 타자 → 원정 투수 → 홈 타자 → 홈 투수)로만 구별한다.
 * ⚠**이 분기가 없으면 그 시즌들이 「타격표가 없다」로 예외를 던진다** — 실측 확인(2026-08-17).
 * 백필에서 예외를 삼키는 코드가 하나라도 있으면 **3시즌이 조용히 0건**으로 들어간다.
 */
const LEGACY_ORDER = ["awayBatting", "awayPitching", "homeBatting", "homePitching"] as const;

/** 구형 페이지인가 — 신형 id 가 없고 구형 클래스가 있으면 */
function isLegacy(html: string): boolean {
  return !html.includes(`<table id="${TABLE_IDS.awayBatting}"`) && html.includes("table_batter");
}

/**
 * 구형에서 n번째 표의 본문을 꺼낸다.
 * ⚠**순서로 구별하므로 개수를 확인한다.** 4개가 아니면 우리가 아는 구조가 아니다 —
 * 조용히 3개만 읽으면 한 팀의 투수 성적이 통째로 사라진다.
 */
function legacyTable(html: string, which: (typeof LEGACY_ORDER)[number]): string {
  const blocks = [...html.matchAll(/<div class="[^"]*table_(batter|pitcher)[^"]*">([\s\S]*?)<\/table>/g)];
  if (blocks.length !== LEGACY_ORDER.length) {
    throw new BoxParseError(
      `구형 표가 ${LEGACY_ORDER.length}개가 아니다 — 구조를 다시 봐야 한다`,
      `found=${blocks.length} length=${html.length}`,
    );
  }
  const at = LEGACY_ORDER.indexOf(which);
  const kind = at % 2 === 0 ? "batter" : "pitcher";
  const got = blocks[at]!;
  // ⚠**순서만 믿지 않는다.** 타자 자리에 투수표가 있으면 값이 통째로 어긋난다
  if (got[1] !== kind) {
    throw new BoxParseError(`구형 표의 순서가 다르다 — ${which} 자리에 ${got[1]} 표가 있다`, `at=${at}`);
  }
  return got[2] ?? "";
}

function tableRows(flatHtml: string, id: string): string[][] {
  const legacy = isLegacy(flatHtml);
  const body = legacy
    ? legacyTable(flatHtml, (Object.keys(TABLE_IDS) as (keyof typeof TABLE_IDS)[])
      .find((k) => TABLE_IDS[k] === id)!)
    : null;
  const table = legacy
    ? ([null, body] as unknown as RegExpExecArray)
    : new RegExp(`<table id="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(flatHtml);
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

/**
 * `6.2`(6과 3분의 2이닝) → 아웃 20. 부동소수로 다루지 않는다.
 *
 * ⚠**`5+`는 「5이닝을 던지고 다음 이닝에서 아웃 없이 강판」이다.** NPB 박스스코어의 표기이고,
 * 아웃 수로는 **15**다(다음 이닝의 기여가 0이므로). 이걸 못 읽으면 그 등판이 통째로 0이 된다.
 *
 * 실측(2026-08-16 외부 대조): 이 표기를 못 읽어 **투수 39명의 시즌 투구회가 모자랐다.**
 * 篠木는 67이닝이어야 하는데 57이닝이었고(두 등판이 5+였다), 방어율이 4.57 대신 5.37로 나왔다.
 * 검산: 그 경기의 팀 합계가 27아웃인데 다른 투수들이 12아웃이므로 篠木는 15아웃이다.
 *
 * ⚠**「읽지 못했다」를 0으로 바꾸지 마라**(M7). 이 함수가 null을 돌려주면 호출자는
 * 그것을 **실패로** 다뤄야 한다 — 0으로 때우면 「던지지 않았다」가 되어 조용히 틀린다.
 */
export function inningsToOuts(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "-") return null;
  // `5+` · `5.1+` — 뒤의 `+`는 「다음 이닝에서 아웃 없이 내려갔다」는 뜻이라 아웃 수를 더하지 않는다
  const m = /^(\d+)(?:\.(\d))?\+?$/.exec(t);
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
    // ⚠**구형(2016~2018)은 「打者」다.** 이름 하나를 못 맞히면 그 시즌이 통째로 예외가 된다
    name: header.findIndex((h) => h.includes("選手") || h.includes("打者")),
    ab: header.findIndex((h) => h.includes("打数")),
    runs: header.findIndex((h) => h.includes("得点")),
    hits: header.findIndex((h) => h.includes("安打")),
    rbi: header.findIndex((h) => h.includes("打点")),
  };
  for (const [key, at] of Object.entries(col)) {
    if (at < 0) throw new BoxParseError(`타격표 헤더에서 ${key} 열을 찾지 못했다`, `id=${id} header=${header.join("|")}`);
  }

  /**
   * ⚠**빈 타순 칸은 「없음」이 아니라 「위와 같음」이다.**
   *
   * 박스스코어는 선발 9명에게만 번호를 찍고, 교대로 들어간 선수는 칸을 비운 채
   * **바로 위 선수의 타순을 잇는다**(대타·대주자·수비 교대 전부). 실측(2026-08-15):
   * 17,351행 중 5,975행(34%)이 교대 선수이고, 이어받지 않으면 그 34%가 통째로
   * 「타순 불명」이 되어 타순별 집계에서 사라진다.
   *
   * ⚠팀 합계 행에서는 잇지 않는다 — 팀에는 타순이 없다.
   */
  let carried: string | null = null;

  return rows.slice(1).map((cells) => {
    const order = text(cells[0]);
    const name = text(cells[col.name]);
    const isTeamTotal = name === TEAM_TOTAL_LABEL;
    if (order !== "") carried = order;
    else if (isTeamTotal) carried = null;
    return {
      order: isTeamTotal ? null : carried,
      position: text(cells[col.position]),
      name,
      playerId: extractPlayerId(cells[col.name]),
      isTeamTotal,
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
    wp: at("暴投"),
    balk: at("ボーク"),
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
    wildPitches: num(cells[col.wp]),
    balks: num(cells[col.balk]),
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
 * **이 경기 자신의** 안내문(`【雨天のためノーゲーム】` 등).
 *
 * ⚠**페이지 전체에서 찾으면 안 된다.** 경기 페이지에는 그날 다른 경기들의 스코어 박스가
 * 함께 실려 있어서, 남의 경기가 중지면 이 경기까지 중지로 판정된다.
 * `game_info`는 `#game_stats` 안에 있고 그 경기 하나만 설명한다.
 */
function ownGameInfo(html: string): string {
  return /<p class="game_info">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
}

/**
 * **이 경기의 대회 표기**(`JERA セ・リーグ公式戦` · `CS ファーストステージ` · `SMBC日本シリーズ` …).
 *
 * ⚠**이것이 없으면 포스트시즌이 정규시즌에 섞인다.** 구단 코드로는 구별할 수 없다 —
 * CS도 일본시리즈도 같은 구단 코드를 쓰기 때문이다. 실측(2026-08-16): 2025년 아카이브를
 * 채운 직후 「정규시즌」이 904경기가 됐고, 그 안에 **CS 13경기와 일본시리즈 5경기**가 들어 있었다.
 * 빼고 나면 실시 858경기 = NPB 정규시즌 경기 수(143×12÷2)와 정확히 일치한다.
 *
 * ⚠**표기는 후원사 이름이 붙어 해마다 달라진다**(`JERA` · `パーソル` · `日本生命` · `SMBC`).
 * 그래서 전체 일치로 판정하지 않는다 — 판정은 `@bb-app/domain`의 `competitionFromLabel`이 한다.
 *
 * 위치: `#game_stats > .game_tit > h3`의 맨 앞 `【…】`. **그 경기 하나만** 설명하는 자리다.
 *
 * @returns 표기 원문. 없으면 null(**구조 변경 신호다 — 조용히 넘기지 마라**)
 */
export function parseCompetitionLabel(html: string): string | null {
  const tit = /<div class="game_tit">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(tit)?.[1] ?? "";
  const label = /【([^】]+)】/.exec(stripTags(h3))?.[1];
  return label === undefined ? null : label.trim();
}

/**
 * ⚠**ノーゲーム은 표가 있어도 성립하지 않은 경기다.**
 *
 * 우천으로 도중에 끝난 경기는 npb.jp가 **그때까지의 부분 표를 그대로 남긴다.**
 * 「타격표가 있으면 실시」로 판정하면 이 경기가 실시로 들어오고,
 * 무효인 기록이 시즌 성적에 섞인다 — 실측(2026-08-16)에서 `2026/0426/h-m-05`가
 * **타격 18행·투구 2행·타석 10건**을 시즌에 흘려 넣고 있었다.
 * 발견 경위: 라인스코어로 센 무승부(11)와 투수 승패로 센 무승부(12)가 1건 어긋났고,
 * 그 1건이 「1-0인데 승리투수가 없는 경기」였다.
 *
 * ⚠NPB에서 ノーゲーム은 **처음부터 다시 하는 경기**이고 기록은 남지 않는다.
 * 반면 サスペンデッド는 이어서 하는 경기라 기록이 살아남는다 — 같이 묶지 않는다.
 */
const VOID_MARKERS = ["ノーゲーム"] as const;

function voidedReason(html: string): string | null {
  const info = ownGameInfo(html);
  for (const marker of VOID_MARKERS) {
    if (info.includes(marker)) return marker;
  }
  return null;
}

/**
 * @throws {BoxParseError} 경기가 열렸는데 표를 읽지 못했을 때.
 * ⚠이 예외를 삼켜 빈 결과로 만들지 마라 — 그러면 구조 변경이 「그날 아무도 안 쳤다」가 된다.
 */
export function parseBoxScore(rawHtml: string): BoxScore {
  const html = flattenInningTables(rawHtml);
  // ⚠**구형(2016~2018)도 「표가 있다」로 본다.** 안 그러면 그 시즌이 「중지」로 읽힌다
  const hasBattingTable = html.includes(`<table id="${TABLE_IDS.awayBatting}"`) || isLegacy(html);
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

  // ⚠표가 있어도 성립하지 않은 경기가 있다. **표의 유무로만 판정하지 않는다**
  const voided = voidedReason(html);
  if (voided !== null) return { status: "notPlayed", reason: voided };

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
