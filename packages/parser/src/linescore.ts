/**
 * 라인스코어(`tablefix_ls`) 파서 — 이닝별 득점.
 *
 * 타석별 득점 유도의 **검증 기준**이다. 주자·아웃 변화에서 계산한 득점의 합이
 * 여기와 어긋나면 유도가 틀린 것이다.
 *
 * ```
 * |    | 1 | 2 | … | 計 | H | E |
 * | 楽天 | 2 | 6 | … | 10 | 16 | 0 |   ← 先攻(원정) = 표
 * | オリ | 0 | 0 | … |  0 |  4 | 1 |   ← 後攻(홈)   = 리
 * ```
 */

export interface LineScore {
  /** 원정(先攻)의 이닝별 득점. 치지 않은 이닝은 null */
  away: (number | null)[];
  /** 홈(後攻)의 이닝별 득점 */
  home: (number | null)[];
  awayTotal: number;
  homeTotal: number;
}

export class LineScoreParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "LineScoreParseError";
    this.detail = detail;
  }
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 이닝 득점 셀.
 *
 * ⚠**`X` 단독과 `2x`는 다르다.**
 *   · `X` — 홈 팀이 그 회를 치지 않았다. **0이 아니라 「없음」**이다(M11)
 *   · `2x` — 끝내기(사요나라). **2점을 내고 경기가 끝났다**
 *
 * 이걸 뭉뚱그려 null로 만들면 끝내기 경기의 득점이 통째로 사라진다 —
 * 실제로 48경기에서 62점이 없어졌다.
 */
export function inningRuns(cell: string): number | null {
  const t = cell.trim();
  if (t === "" || t === "－" || t === "-") return null;
  // 앞에 숫자가 있으면 득점이다. 뒤의 x는 끝내기 표시일 뿐이다.
  const m = /^(\d+)/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/**
 * @throws {LineScoreParseError} 표를 찾지 못하거나 「計」 열이 없을 때.
 */
export function parseLineScore(html: string): LineScore {
  const table = /<table id="tablefix_ls"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!table) throw new LineScoreParseError("라인스코어 표를 찾지 못했다", `length=${html.length}`);

  const rows = [...table[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => strip(c[1]!)),
  );
  if (rows.length < 3) {
    throw new LineScoreParseError("라인스코어에 팀 행이 부족하다", `rows=${rows.length}`);
  }

  const header = rows[0]!;
  const totalAt = header.findIndex((h) => h.includes("計"));
  if (totalAt < 1) {
    throw new LineScoreParseError("라인스코어에서 「計」 열을 찾지 못했다", `header=${header.join("|")}`);
  }

  // 0번은 팀명 열. 1번부터 (計 앞까지)가 이닝이다.
  const read = (row: string[]): { runs: (number | null)[]; total: number } => {
    const runs = row.slice(1, totalAt).map(inningRuns);
    const total = inningRuns(row[totalAt] ?? "");
    if (total === null) {
      throw new LineScoreParseError("합계를 수로 읽지 못했다", `value=${JSON.stringify(row[totalAt])}`);
    }
    return { runs, total };
  };

  const away = read(rows[1]!);
  const home = read(rows[2]!);
  return { away: away.runs, home: home.runs, awayTotal: away.total, homeTotal: home.total };
}
