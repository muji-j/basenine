/**
 * 선수 페이지의 **年度別成績**.
 *
 * ⚠**받고 있는데 안 읽던 것 — 네 번째**(2026-08-17). 선수 페이지는 이미 아카이브에 있었고
 * 파서가 `pc_bio` 를 읽으면서 **`pc_stats` 는 통째로 지나쳤다.** 실측: 아카이브 980장 중
 * 打撃成績 표 **980장** · 投手成績 표 **514장** · 시즌 행 합계 **8,127행** · 수록 연도 **2002~2026**.
 *
 * ⚠**「通算」 합계 행은 있다** — 처음에 「없다(실측 0/980)」고 적었는데 **틀린 판정이었다**.
 * `<td>通算</td>` 를 찾았지만 실제로는 `<tfoot>` 안의 `<th class="team">通　算</th>` 이고
 * 사이에 **전각 공백**이 있다. 다시 재니 **980/980** 이다(2026-08-17 이중 검토 지적).
 *
 * ⚠**그래도 통산은 우리가 더한다.** 남의 계산값을 그대로 싣지 않는다는 원칙은 그대로다.
 * 대신 그 합계 행을 **검산에 쓴다** — 우리 합과 어긋나면 던진다.
 * 이것이 이 파서에서 가장 싼 안전장치다: 열 이름이 바뀌어 한 지표가 0이 되든,
 * 행이 잘려 몇 해가 사라지든 **그 자리에서 걸린다.**
 *
 * ⚠**이 값의 출처는 우리 타석 로그가 아니라 NPB 공표치다**(M4). 우리가 경기에서 쌓은 값과
 * **같은 열에 섞지 마라** — 「어디서 온 숫자인가」에 답할 수 없게 된다.
 *
 * ⚠**한 해에 여러 줄이 될 수 있다.** 시즌 도중 이적하면 구단마다 한 줄이다.
 * 통산을 낼 때는 그대로 더하면 되지만, 「몇 시즌 뛰었나」를 셀 때는 **연도로 묶어야** 한다.
 *
 * ⚠**投球回는 칸이 둘로 쪼개져 있다** — `<th>28</th><td>.2</td>` 가 28⅔이닝이다.
 * 공표 성적 표(`stats.ts`)가 같은 함정을 이미 밟았다(`mergeSplitColumns`).
 */

/** 한 해 한 구단의 타격 성적. **원문 그대로의 개수**만 담는다 — 비율은 우리가 다시 낸다(M1) */
export interface CareerBattingSeason {
  year: number;
  /** 소속 구단 **원문**(`福岡ソフトバンク`). ⚠구단 코드로 바꾸지 않는다 — 옛 구단명이 실재한다 */
  team: string;
  games: number;
  pa: number;
  ab: number;
  runs: number;
  h: number;
  d2: number;
  d3: number;
  hr: number;
  tb: number;
  rbi: number;
  sb: number;
  /** 도루자. ⚠**박스스코어에는 없는 값**이라 이 표가 유일한 공표 출처다 */
  cs: number;
  sh: number;
  sf: number;
  bb: number;
  hbp: number;
  so: number;
  gidp: number;
}

/** 한 해 한 구단의 투구 성적 */
export interface CareerPitchingSeason {
  year: number;
  team: string;
  games: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  hp: number;
  cg: number;
  sho: number;
  /** 무사사구 경기 */
  nbb: number;
  bf: number;
  /** 아웃 카운트. ⚠**이닝이 아니다** — `28.2` 는 86아웃이다 */
  outs: number;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  wp: number;
  balk: number;
  runs: number;
  er: number;
}

export interface Career {
  batting: CareerBattingSeason[];
  pitching: CareerPitchingSeason[];
}

export class CareerParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "CareerParseError";
    this.detail = detail;
  }
}

/**
 * 머리 칸의 순서. ⚠**위치로 읽지 않고 이름으로 읽는다** —
 * 열이 하나 늘어나는 것만으로 전 선수의 홈런이 타점이 되는 사고를 막는다(M7).
 */
const BAT_KEYS: Readonly<Record<string, keyof CareerBattingSeason>> = {
  試合: "games", 打席: "pa", 打数: "ab", 得点: "runs", 安打: "h",
  二塁打: "d2", 三塁打: "d3", 本塁打: "hr", 塁打: "tb", 打点: "rbi",
  盗塁: "sb", 盗塁刺: "cs", 犠打: "sh", 犠飛: "sf", 四球: "bb",
  死球: "hbp", 三振: "so", 併殺打: "gidp",
};

const PIT_KEYS: Readonly<Record<string, keyof CareerPitchingSeason>> = {
  登板: "games", 勝利: "w", 敗北: "l", セーブ: "sv", H: "hld", HP: "hp",
  完投: "cg", 完封勝: "sho", 無四球: "nbb", 打者: "bf",
  安打: "h", 本塁打: "hr", 四球: "bb", 死球: "hbp", 三振: "so",
  暴投: "wp", ボーク: "balk", 失点: "runs", 自責点: "er",
};

const strip = (s: string): string =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** 숫자로. `-` 나 빈 칸은 0이 아니라 **null** 이다(M11) — 부르는 쪽이 정한다 */
function num(cell: string): number | null {
  const t = strip(cell).replace(/,/g, "");
  if (t === "" || t === "-" || t === "－" || t === "―") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * 이닝 칸 → 아웃.
 *
 * ⚠**두 칸으로 쪼개져 있다.** `<th>28</th><td>.2</td>` 가 28⅔이닝 = 86아웃이다.
 * 쪼개진 것을 모르고 첫 칸만 읽으면 **모든 투수의 이닝이 조용히 줄어든다.**
 */
function outsOf(cell: string): number | null {
  const inner = /<table class="table_inning">([\s\S]*?)<\/table>/.exec(cell);
  const text = inner === null ? strip(cell) : strip(inner[1] ?? "").replace(/\s+/g, "");
  if (text === "") return null;
  const m = /^(\d+)(?:\.([012]))?$/.exec(text);
  if (m === null) return null;
  return Number(m[1]) * 3 + Number(m[2] ?? 0);
}

/**
 * 행 하나에서 **바깥층 칸만** 꺼낸다.
 *
 * ⚠**중첩 표가 실재한다.** 투수표의 投球回 칸이 안에 표를 품는다:
 * `<td><table class="table_inning"><tr><th>28</th><td>.2</td></tr></table></td>`.
 * 처음에는 `<t[dh]>…</t[dh]>` 를 비탐욕으로 훑었는데, 그러면 **안쪽 `</th>` 에서 먼저 닫혀**
 * 칸 수가 어긋나고 **투수 행이 전부 버려졌다** — 실측으로 514명분이 통째로 0이었다(2026-08-17).
 * 오류도 안 났다: 칸 수가 안 맞는 행을 조용히 건너뛰는 코드였기 때문이다.
 * 그래서 표 깊이를 세면서 **깊이 0의 칸만** 담는다.
 */
function topCells(rowHtml: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (const m of rowHtml.matchAll(/<(\/?)(table|td|th)\b[^>]*>/g)) {
    const closing = m[1] === "/";
    if (m[2] === "table") {
      depth += closing ? -1 : 1;
      continue;
    }
    if (depth > 0) continue;
    if (!closing) {
      if (start < 0) start = m.index + m[0].length;
    } else if (start >= 0) {
      out.push(rowHtml.slice(start, m.index));
      start = -1;
    }
  }
  return out;
}

/**
 * 바깥층 `<tr>` 들.
 *
 * ⚠**행을 자르는 것도 깊이를 세야 한다 — 여기서 같은 실수를 한 층 위에서 또 했다.**
 * `<tr…>([\s\S]*?)</tr>` 는 **중첩 표 안의 `</tr>` 에서 먼저 닫힌다.** 투수표의 投球回 칸이
 * 안에 표를 품으므로, 행이 **그 칸 직전에서 잘려** 13칸만 남았다(머리는 24칸).
 * 칸 수가 안 맞는 행은 조용히 건너뛰는 코드라 **오류 0으로 514명분이 통째로 사라졌다**(2026-08-17).
 */
function topRows(bodyHtml: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (const m of bodyHtml.matchAll(/<(\/?)(table|tr)\b[^>]*>/g)) {
    const closing = m[1] === "/";
    if (m[2] === "table") {
      depth += closing ? -1 : 1;
      continue;
    }
    if (depth > 0) continue;
    if (!closing) {
      if (start < 0 && /class="[^"]*registerStats/.test(m[0])) start = m.index + m[0].length;
    } else if (start >= 0) {
      out.push(bodyHtml.slice(start, m.index));
      start = -1;
    }
  }
  return out;
}

function rowsOf(tableHtml: string): { head: string[]; body: string[][] } {
  const head = [...(/<thead>([\s\S]*?)<\/thead>/.exec(tableHtml)?.[1] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => strip(m[1] ?? ""));
  const bodyHtml = /<tbody>([\s\S]*)<\/tbody>/.exec(tableHtml)?.[1] ?? "";
  const body: string[][] = [];
  for (const row of topRows(bodyHtml)) {
    const cells = topCells(row);
    if (cells.length > 0) body.push(cells);
  }
  return { head, body };
}

/**
 * 표 하나를 읽는다.
 *
 * ⚠**머리를 못 읽으면 던진다**(M7). 조용히 빈 배열을 돌려주면 「기록이 없는 선수」가 되어
 * 통산이 0으로 표시된다 — 그것이 이 도메인에서 가장 나쁜 실패다.
 */
function parseTable<T>(
  html: string,
  id: string,
  keys: Readonly<Record<string, string>>,
  make: (year: number, team: string, get: (label: string) => number | null, cellOf: (label: string) => string) => T,
): { rows: T[]; head: string[]; foot: Map<string, number> | null } {
  const table = new RegExp(`<table id="${id}">([\\s\\S]*?)</table>\\s*(?:</div>|<div)`).exec(html)
    ?? new RegExp(`<table id="${id}">([\\s\\S]*)`).exec(html);
  if (table === null) return { rows: [], head: [], foot: null };
  const { head, body } = rowsOf(table[0]);
  if (head.length === 0) {
    throw new CareerParseError(`${id} 의 머리를 읽지 못했다`, `head=0 body=${body.length}`);
  }
  /**
   * ⚠**하나라도 없으면 던진다.**
   *
   * 처음에는 「아는 열이 절반 미만이면」이었다. 실제 마크업 변경은 **한두 칸**이므로
   * 그 가드는 아무것도 못 물었다 — 실측(2026-08-17 이중 검토):
   * `年度` 한 낱말만 바꾸면 **행 0건**, `本塁打` 한 낱말만 바꾸면 **통산 홈런 0**,
   * `盗塁刺` 한 낱말만 바꾸면 **도루자 51 → 0**. **셋 다 오류 없이** 그렇게 됐다.
   * 파일 머리에 「조용히 0으로 나가는 것이 이 도메인에서 가장 나쁜 실패」라고 적어 두고
   * 가드가 그 실패를 막지 못했다.
   */
  const need = ["年度", "所属球団", ...Object.keys(keys)];
  const missing = need.filter((x) => !head.includes(x));
  if (missing.length > 0) {
    throw new CareerParseError(
      `${id} 에 있어야 할 열이 없다 — 페이지 구조 변경을 의심하라`,
      `missing=${missing.join(",")} head=${head.join(",")}`,
    );
  }

  const out: T[] = [];
  for (const cells of body) {
    if (cells.length !== head.length) continue;
    const at = (label: string): number => head.indexOf(label);
    const year = num(cells[at("年度")] ?? "");
    const team = strip(cells[at("所属球団")] ?? "");
    if (year === null || team === "") continue;
    const cellOf = (label: string): string => {
      const i = at(label);
      return i < 0 ? "" : cells[i] ?? "";
    };
    out.push(make(year, team, (label) => num(cellOf(label)), cellOf));
  }
  return { rows: out, head, foot: footTotals(table[0], head) };
}

/**
 * 표의 **`<tfoot>` 합계 행**.
 *
 * ⚠**모양이 본문 행과 다르다** — `<td>` 가 아니라 `<th>` 이고, 첫 칸(年度)이 비어 있으며
 * 구단 칸에 `通　算`(전각 공백)이 들어간다. 그래서 `<td>通算</td>` 로 찾으면 0건이 나온다.
 */
function footTotals(tableHtml: string, head: readonly string[]): Map<string, number> | null {
  const foot = /<tfoot>([\s\S]*?)<\/tfoot>/.exec(tableHtml)?.[1];
  if (foot === undefined) return null;
  const cells = topCells(foot);
  if (cells.length !== head.length) return null;
  const out = new Map<string, number>();
  for (let i = 0; i < head.length; i += 1) {
    const label = head[i] ?? "";
    const v = num(cells[i] ?? "");
    if (v !== null) out.set(label, v);
  }
  return out;
}

/**
 * 우리 합과 NPB 합계 행을 맞대 본다.
 *
 * ⚠**표시에는 쓰지 않는다.** 남의 계산값을 그대로 싣지 않는다는 원칙은 그대로다 —
 * 여기서 하는 일은 **검산**뿐이고, 화면에 나가는 통산은 우리가 더한 값이다.
 * ⚠**어긋나면 던진다.** 조용히 넘기면 이 검산이 있으나 마나다(M7).
 */
function checkAgainstFoot(
  id: string,
  head: readonly string[],
  foot: Map<string, number> | null,
  keys: Readonly<Record<string, string>>,
  rows: readonly Record<string, unknown>[],
  extra: Readonly<Record<string, number>> = {},
): void {
  if (foot === null) return;
  const bad: string[] = [];
  for (const [label, key] of Object.entries(keys)) {
    const want = foot.get(label);
    if (want === undefined) continue;
    const got = rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);
    if (got !== want) bad.push(`${label} 우리 ${got} vs 공표 ${want}`);
  }
  for (const [label, got] of Object.entries(extra)) {
    const want = foot.get(label);
    if (want !== undefined && got !== want) bad.push(`${label} 우리 ${got} vs 공표 ${want}`);
  }
  if (bad.length > 0) {
    throw new CareerParseError(
      `${id} 의 합계가 NPB 공표 합계와 어긋난다 — 행이나 칸을 놓쳤을 수 있다`,
      `${bad.slice(0, 4).join(" / ")} (열 ${head.length}개)`,
    );
  }
}

export function parseCareer(html: string): Career {
  const bat = parseTable<CareerBattingSeason>(html, "tablefix_b", BAT_KEYS, (year, team, get) => {
    const row = { year, team } as CareerBattingSeason;
    for (const [label, key] of Object.entries(BAT_KEYS)) {
      // ⚠**못 읽은 칸은 0으로 둔다** — 이 표에서 빈 칸은 「그 항목이 그 해에 없었다」가 아니라
      //   「0이었다」이고(실측: 전 칸이 채워져 있다), 통산 합계를 내려면 수가 필요하다.
      //   진짜 결측은 위의 열 이름 검사에서 이미 걸린다(M7).
      (row as unknown as Record<string, number>)[key] = get(label) ?? 0;
    }
    return row;
  });

  const pit = parseTable<CareerPitchingSeason>(html, "tablefix_p", PIT_KEYS, (year, team, get, cellOf) => {
    const row = { year, team } as CareerPitchingSeason;
    for (const [label, key] of Object.entries(PIT_KEYS)) {
      (row as unknown as Record<string, number>)[key] = get(label) ?? 0;
    }
    row.outs = outsOf(cellOf("投球回")) ?? 0;
    return row;
  });

  /**
   * ⚠**여기서 검산한다.** 우리가 더한 합이 NPB 공표 합계와 어긋나면 던진다 —
   * 열 이름이 바뀌어 한 지표가 0이 되든, 행이 잘려 몇 해가 사라지든 그 자리에서 걸린다.
   * ⚠**投球回는 별도로 잰다** — 이닝 칸이 중첩 표라 키 맵에 없다.
   */
  checkAgainstFoot("tablefix_b", bat.head, bat.foot, BAT_KEYS, bat.rows as unknown as Record<string, unknown>[]);
  const footOuts = pit.foot === null ? undefined : pit.foot.get("投球回");
  checkAgainstFoot(
    "tablefix_p", pit.head, pit.foot, PIT_KEYS, pit.rows as unknown as Record<string, unknown>[],
    // ⚠**공표 합계는 이닝(`1043.2`)이고 우리는 아웃이다** — 아웃을 이닝 표기로 되돌려 견준다
    footOuts === undefined ? {} : { 投球回: outsToInningsNumber(pit.rows.reduce((a, r) => a + r.outs, 0)) },
  );

  return { batting: bat.rows, pitching: pit.rows };
}

/**
 * 아웃 → 이닝 **수치**(`86` → `28.2`).
 *
 * ⚠**소수가 아니다.** `.1`·`.2` 는 ⅓·⅔이고, 그래서 `86/3 = 28.67` 이 아니라 `28.2` 다.
 * 공표 합계와 견주려면 그쪽 표기로 되돌려야 한다.
 */
function outsToInningsNumber(outs: number): number {
  return Number(`${Math.floor(outs / 3)}.${outs % 3}`);
}

/** 통산 합계. ⚠**우리가 더한다** — NPB 도 싣지만(980/980) 그건 대조용으로만 쓴다 */
export function careerTotal<T>(
  rows: readonly T[],
  numeric: readonly (keyof T)[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of numeric) out[String(k)] = 0;
  for (const r of rows) {
    for (const k of numeric) out[String(k)] = (out[String(k)] ?? 0) + Number(r[k] ?? 0);
  }
  return out;
}

/** 뛴 시즌 수. ⚠**행 수가 아니다** — 시즌 도중 이적하면 한 해에 여러 줄이 된다 */
export function seasonsPlayed(rows: readonly { year: number }[]): number {
  return new Set(rows.map((r) => r.year)).size;
}
