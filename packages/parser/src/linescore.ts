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
  /**
   * 안타·실책 합계(`H`·`E` 열). ⚠**읽지 못하면 0이 아니라 null**이다(M11).
   *
   * 이 값들이 있어야 팀 승패(=`計` 비교)와 실책을 말할 수 있다.
   * 개인 기록에서 합산해 만들지 **않는다** — 원본이 낸 팀 합계를 그대로 쓰고,
   * 어긋나면 그 사실이 대조 지점이 된다.
   */
  awayHits: number | null;
  homeHits: number | null;
  awayErrors: number | null;
  homeErrors: number | null;
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

  /**
   * `計` 뒤의 `H`(안타)·`E`(실책) 열.
   *
   * ⚠**헤더가 `1 2 … 9 計 H E`다**(2026-08-15 실측). 「失策」이라는 낱말은 페이지 어디에도 없고
   * 열 머리 한 글자로만 나온다 — 낱말로 찾으면 영원히 못 찾는다.
   * ⚠**없으면 0이 아니라 null이다**(M11). 연장전이면 이닝 열이 늘어 위치가 밀리므로
   * 자리로 세지 않고 **헤더에서 찾는다.**
   */
  const hitsAt = header.findIndex((h, i) => i > totalAt && h.trim() === "H");
  const errorsAt = header.findIndex((h, i) => i > totalAt && h.trim() === "E");

  // 0번은 팀명 열. 1번부터 (計 앞까지)가 이닝이다.
  const read = (row: string[]): { runs: (number | null)[]; total: number; hits: number | null; errors: number | null } => {
    const runs = row.slice(1, totalAt).map(inningRuns);
    const total = inningRuns(row[totalAt] ?? "");
    if (total === null) {
      throw new LineScoreParseError("합계를 수로 읽지 못했다", `value=${JSON.stringify(row[totalAt])}`);
    }
    const at = (i: number): number | null => {
      if (i < 0) return null;
      const t = (row[i] ?? "").trim();
      return /^\d+$/.test(t) ? Number(t) : null;
    };
    return { runs, total, hits: at(hitsAt), errors: at(errorsAt) };
  };

  const away = read(rows[1]!);
  const home = read(rows[2]!);
  return {
    away: away.runs,
    home: home.runs,
    awayTotal: away.total,
    homeTotal: home.total,
    awayHits: away.hits,
    homeHits: home.hits,
    awayErrors: away.errors,
    homeErrors: home.errors,
  };
}
