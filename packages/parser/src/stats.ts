/**
 * npb.jp **공표 성적표** 파서 — 외부 대조 전용.
 *
 * ⚠**이 값들은 화면에 나가지 않는다**(L6). 우리가 계산한 값이 맞는지 확인하기 위해서만 읽는다.
 * 여기서 읽은 수치를 그대로 렌더링하면 그 순간 이 서비스는 재배포가 된다.
 *
 * ⚠**구조가 바뀌면 빈 값이 아니라 실패다**(M7). 성적표는 컬럼이 23개(타격)·22개(투구)로
 * 고정돼 있고, 컬럼이 하나 밀리면 「打率 자리에 出塁率이 들어온」 대조표가 나온다 —
 * 그러면 우리 값이 틀린 것처럼 보여서 멀쩡한 코드를 고치게 된다. 헤더를 검사하고 던진다.
 *
 * ⚠**선수 ID가 없다**(2026-08-16 실측). 성적표에는 이름만 있고 `/bis/players/{id}` 링크가 없다.
 * 그래서 대조는 **이름으로 짝지을 수밖에 없다** — M10이 금지하는 것은 제품의 조인이고,
 * 이건 검증 도구다. 다만 같은 팀에 같은 성이 둘이면 **짝짓지 않고 보고한다**(§동명이인).
 */

export class StatsParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "StatsParseError";
    this.detail = detail;
  }
}

/** 공표 성적표 한 줄(타격). **컬럼 이름은 원문 그대로 두지 않고 우리 어휘로 옮긴다** */
export interface PublishedBatting {
  /** 등록명 원문(`*佐藤 輝明`). 마커와 공백을 남긴 채로 든다 — 대조 리포트가 원문을 보여야 한다 */
  rawName: string;
  /** 마커·공백을 벗긴 이름(`佐藤輝明`) */
  name: string;
  games: number;
  pa: number;
  ab: number;
  runs: number;
  h: number;
  double: number;
  triple: number;
  hr: number;
  tb: number;
  rbi: number;
  sb: number;
  cs: number;
  sh: number;
  sf: number;
  bb: number;
  ibb: number;
  hbp: number;
  so: number;
  gidp: number;
  /** `.317` 같은 원문 표기 그대로. **수로 바꾸지 않는다** — 반올림 규칙이 우리와 다를 수 있다 */
  avg: string;
  slg: string;
  obp: string;
}

export interface PublishedPitching {
  rawName: string;
  name: string;
  games: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  /** 상대한 타자 수(打者). 우리 `bf`와 맞춰 볼 수 있다 */
  bf: number;
  /** 완투·완봉 등은 읽지 않는다 — 대조 대상이 아니다 */
  innings: string;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  wp: number;
  balk: number;
  runs: number;
  er: number;
  era: string;
}

/** 타격 성적표의 헤더. **이 순서가 곧 컬럼 의미다** */
const BATTING_HEADER = [
  "選手", "試合", "打席", "打数", "得点", "安打", "二塁打", "三塁打", "本塁打", "塁打",
  "打点", "盗塁", "盗塁刺", "犠打", "犠飛", "四球", "故意四", "死球", "三振", "併殺打",
  "打率", "長打率", "出塁率",
] as const;

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
    (c[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function rowsOf(html: string): string[] {
  const tbl = /<table class="tablefix2">([\s\S]*?)<\/table>/.exec(html);
  if (tbl === null) {
    throw new StatsParseError(
      "성적표(table.tablefix2)를 찾지 못했다 — 페이지 구조 변경을 의심하라",
      `length=${html.length}`,
    );
  }
  return [...tbl[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
}

/**
 * 좌우 마커와 공백을 벗긴 이름.
 *
 * ⚠**`*`(좌타)·`+`(양타) 마커가 이름 앞에 붙는다.** 안 벗기면 어떤 이름과도 안 맞는다 —
 * 실측(2026-08-16)에서 58명 중 28명이 이것 때문에 매칭에 실패했다.
 */
export function normalizePlayerName(raw: string): string {
  return raw.replace(/^[*+＊＋]+/, "").replace(/[\s　]/g, "");
}

function num(cell: string | undefined, label: string, rawName: string): number {
  const t = (cell ?? "").replace(/,/g, "").trim();
  // ⚠**「-」는 0이 아니다.** 규정 미달 등으로 값이 없는 칸이 실제로 있다(M11)
  if (t === "" || t === "-" || t === "－") return Number.NaN;
  const n = Number(t);
  if (!Number.isFinite(n)) {
    throw new StatsParseError(`수로 읽을 수 없는 칸: ${label}`, `${rawName} / ${JSON.stringify(cell)}`);
  }
  return n;
}

/**
 * 팀별 개인 타격 성적(`idb1_{팀}.html`).
 *
 * @throws {StatsParseError} 헤더가 다르거나 컬럼 수가 어긋날 때.
 *   ⚠**삼키지 마라** — 컬럼이 밀리면 우리 값이 틀린 것처럼 보이는 대조표가 나온다.
 */
export function parseTeamBatting(html: string): PublishedBatting[] {
  const rows = rowsOf(html);
  const header = cellsOf(rows[0] ?? "");
  if (header.length !== BATTING_HEADER.length || header.some((h, i) => h !== BATTING_HEADER[i])) {
    throw new StatsParseError(
      "타격 성적표의 헤더가 예상과 다르다 — 컬럼이 바뀌었는지 확인하라",
      `기대 ${BATTING_HEADER.length}열 [${BATTING_HEADER.join(",")}] / 실제 ${header.length}열 [${header.join(",")}]`,
    );
  }

  const out: PublishedBatting[] = [];
  for (const row of rows.slice(1)) {
    const c = cellsOf(row);
    if (c.length === 0) continue;
    if (c.length !== BATTING_HEADER.length) {
      throw new StatsParseError(
        "타격 성적표의 행 컬럼 수가 헤더와 다르다",
        `${c[0] ?? "(이름 없음)"} — ${c.length}열 (기대 ${BATTING_HEADER.length})`,
      );
    }
    const rawName = c[0]!;
    out.push({
      rawName,
      name: normalizePlayerName(rawName),
      games: num(c[1], "試合", rawName),
      pa: num(c[2], "打席", rawName),
      ab: num(c[3], "打数", rawName),
      runs: num(c[4], "得点", rawName),
      h: num(c[5], "安打", rawName),
      double: num(c[6], "二塁打", rawName),
      triple: num(c[7], "三塁打", rawName),
      hr: num(c[8], "本塁打", rawName),
      tb: num(c[9], "塁打", rawName),
      rbi: num(c[10], "打点", rawName),
      sb: num(c[11], "盗塁", rawName),
      cs: num(c[12], "盗塁刺", rawName),
      sh: num(c[13], "犠打", rawName),
      sf: num(c[14], "犠飛", rawName),
      bb: num(c[15], "四球", rawName),
      ibb: num(c[16], "故意四", rawName),
      hbp: num(c[17], "死球", rawName),
      so: num(c[18], "三振", rawName),
      gidp: num(c[19], "併殺打", rawName),
      avg: c[20]!,
      slg: c[21]!,
      obp: c[22]!,
    });
  }
  return out;
}

/**
 * 팀별 개인 투구 성적(`idp1_{팀}.html`).
 *
 * ⚠**헤더를 읽어 열 위치를 찾는다.** 투구 성적표는 완투·완封 등 우리가 안 쓰는 열이 섞여 있고,
 * 위치로 집으면 그 열이 하나 늘거나 줄 때 조용히 밀린다.
 */
export function parseTeamPitching(html: string): PublishedPitching[] {
  const rows = rowsOf(html);
  const header = cellsOf(rows[0] ?? "");
  const at = (label: string): number => {
    const i = header.indexOf(label);
    if (i < 0) {
      throw new StatsParseError(
        `투구 성적표에 「${label}」 열이 없다 — 컬럼이 바뀌었는지 확인하라`,
        `실제 ${header.length}열 [${header.join(",")}]`,
      );
    }
    return i;
  };
  /**
   * ⚠**투구 성적표의 열 이름은 「투수 시점」이다.** 被安打가 아니라 `安打`,
   * 与四球가 아니라 `四球`다 — 타격표와 같은 글자가 **반대 뜻**으로 쓰인다.
   * 실측 헤더(2026-08-16, 24열):
   * `選手 登板 勝利 敗北 セーブ ホールド ＨＰ 完投 完封勝 無四球 勝率 打者 投球回
   *  安打 本塁打 四球 故意四 死球 三振 暴投 ボーク 失点 自責点 防御率`
   */
  const cols = { name: at("選手"), games: at("登板"), w: at("勝利"), l: at("敗北") };
  const iSv = at("セーブ");
  const iHld = at("ホールド");
  const iBf = at("打者");
  const iIp = at("投球回");
  const iH = at("安打");
  const iHr = at("本塁打");
  const iBb = at("四球");
  const iHbp = at("死球");
  const iSo = at("三振");
  const iWp = at("暴投");
  const iBalk = at("ボーク");
  const iRuns = at("失点");
  const iEr = at("自責点");
  const iEra = at("防御率");

  const out: PublishedPitching[] = [];
  for (const row of rows.slice(1)) {
    const c = cellsOf(row);
    if (c.length === 0) continue;
    if (c.length !== header.length) {
      throw new StatsParseError(
        "투구 성적표의 행 컬럼 수가 헤더와 다르다",
        `${c[0] ?? "(이름 없음)"} — ${c.length}열 (기대 ${header.length})`,
      );
    }
    const rawName = c[cols.name]!;
    out.push({
      rawName,
      name: normalizePlayerName(rawName),
      games: num(c[cols.games], "試合", rawName),
      w: num(c[cols.w], "勝利", rawName),
      l: num(c[cols.l], "敗戦", rawName),
      sv: num(c[iSv], "セーブ", rawName),
      hld: num(c[iHld], "ホールド", rawName),
      bf: num(c[iBf], "打者", rawName),
      innings: c[iIp]!,
      h: num(c[iH], "被安打", rawName),
      hr: num(c[iHr], "被本塁打", rawName),
      bb: num(c[iBb], "与四球", rawName),
      hbp: num(c[iHbp], "与死球", rawName),
      so: num(c[iSo], "奪三振", rawName),
      wp: num(c[iWp], "暴投", rawName),
      balk: num(c[iBalk], "ボーク", rawName),
      runs: num(c[iRuns], "失点", rawName),
      er: num(c[iEr], "自責点", rawName),
      era: c[iEra]!,
    });
  }
  return out;
}
