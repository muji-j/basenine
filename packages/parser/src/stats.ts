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

/**
 * 공표표가 **스스로 적은 기준일**을 읽는다 — `2026年9月7日 現在`.
 *
 * ⚠**이것을 여태 안 읽고 취득 시각에서 유도하고 있었다**(2026-09-09에 고침).
 * 그 규칙(JST 날짜 − 1일)은 「낮에 받는다」를 전제하는데, **자정을 넘겨 받으면 하루를 앞지른다.**
 * 실제 사고: 2026-09-08T16:14Z(= JST 09-09 01:14) 실행에서 09-08 을 유도했지만
 * npb.jp 는 09-07 까지만 공표하고 있었다 → **결함 후보 989건** →
 * `if: success()` 인 배포 단계가 통째로 막혀 그날 배포가 0건이었다.
 * ⚠**그 실행은 크론 지연이 아니라 사람이 누른 것이다**(2차 검토 F2 · `workflow_dispatch` 실측).
 * **구조적 원인은 따로 있다**: 재시도 슬롯 `0 16 * * *` = **JST 01:00** 이 애초에 그 창 안이다.
 *
 * ⚠**「받고 있는데 안 읽던 것」의 다섯 번째다**(CLAUDE.md §2-2-1) — 앞의 넷과 달리
 * **「적혀 있지 않다」고 적어 둔 주석이 눈을 가린** 형태다.
 * 실측(2026-09-09 · 아카이브 전수): 진행 중 시즌(2026) **30/30 장에 정확히 1건**이고
 * 날짜도 전부 같다. 완결 3시즌(2023·2024·2025) **90/90 장에 0건** — 낱말 `現在` 자체가 없다.
 * ⚠**「있다/없다」가 시즌 상태에 따라 갈린다.** 끝난 시즌 표는 스냅숏이 아니라 확정이라
 * 「◯◯ 現在」라고 적을 것이 없다.
 * ⚠**전이 구간은 못 봤다** — 가진 완결 시즌 3개는 전부 `現在` 가 지워진 뒤에 받은 것이다.
 * npb.jp 가 **언제** 그것을 지우는지는 **안 쟀다.**
 *
 * ⚠**없으면 null 이다. 여기서 추측하지 않는다** — 무엇을 가정할지는 부르는 쪽이 정하고,
 * 그 가정을 화면에 적게 한다. 파서가 대신 정하면 그 가정이 어디에도 안 적힌다.
 * ⚠**서로 다른 날짜가 둘 이상이면 던진다**(M7). 고르는 순간 추측이 되고, 기준일이 하루만
 * 틀려도 그날 뛴 선수가 **전부** 불일치로 잡힌다 — 그 거짓 경보가 경보를 죽인다.
 * ⚠**같은 날짜가 두 번 나오는 것은 던지지 않는다**(2026-09-09 · 1차 검토 P2).
 * 반응형 레이아웃이 같은 배너를 머리·꼬리에 넣는 것만으로 배포가 막히면 안 된다 —
 * **고를 것이 없는데 던지는 것**이라 이 검사의 뜻과 맞지 않는다.
 */
export function publishedAsOf(html: string): string | null {
  const hits = [...html.matchAll(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*現在/g)];
  if (hits.length === 0) return null;
  const dates = new Set(
    hits.map((h) => `${h[1]!}-${h[2]!.padStart(2, "0")}-${h[3]!.padStart(2, "0")}`),
  );
  if (dates.size > 1) {
    throw new StatsParseError(
      "공표표의 기준일이 서로 다른 것이 둘 이상이다 — 어느 것이 기준일지 고르면 추측이 된다",
      [...dates].join(" / "),
    );
  }
  const only = [...dates][0]!;
  // ⚠**모양만 맞고 뜻이 없는 날짜를 흘리지 않는다**(M7). 문자열 비교로 쓰는 값이라
  //   `2026-13-45` 같은 것이 들어가면 「안 자름」으로 조용히 흘러간다.
  const [, mm, dd] = /^\d{4}-(\d{2})-(\d{2})$/.exec(only)!;
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new StatsParseError("공표표의 기준일이 날짜가 아니다", only);
  }
  return only;
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

/**
 * 성적표의 행들을 **칸 배열로** 돌려준다.
 *
 * ⚠**2023~2024는 마크업이 다르다**(2026-08-17 실측). `class="tablefix2"` 가 없고,
 * 열 순서는 같지만 세 가지가 다르다:
 *   · 표 맨 위에 주석 행이 하나 있다(`* 左打 + 左右打`) — 칸이 1개뿐이다
 *   · **모든 행 앞에 빈 칸이 하나 더** 있다(좌우 마커 자리)
 *   · 헤더 글자에 공백이 섞인다(`選 手` · `試 合`) — `<br />` 를 벗긴 흔적이다
 *
 * 이 분기가 없으면 소급 시즌을 **공표값과 대조할 수 없다** — 백필의 검증 수단이 사라진다.
 * (박스 파서가 2016~2018에서 겪은 것과 같은 문제다.)
 */
function rowsOf(html: string): string[][] {
  const modern = /<table class="tablefix2">([\s\S]*?)<\/table>/.exec(html);
  // ⚠구형은 `border="0"` 뿐이라 특징이 약하다 — 그래서 **신형을 먼저** 본다
  const legacyTbl = modern === null ? /<table border="0"[^>]*>([\s\S]*?)<\/table>/.exec(html) : null;
  const tbl = modern ?? legacyTbl;
  if (tbl === null) {
    throw new StatsParseError(
      "성적표를 찾지 못했다(신형 table.tablefix2 · 구형 table[border=0] 둘 다 없다)",
      `length=${html.length}`,
    );
  }
  const legacy = modern === null;
  const rows = [...tbl[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => cellsOf(m[1]!))
    .map((c) => (legacy ? c.slice(1) : c))
    /**
     * 주석·범례 행을 버린다. ⚠**칸 수로 거른다** — 문구로 거르면 문구가 바뀌는 날 조용히 섞인다.
     * ⚠**빈 칸을 뗀 「뒤에」 거른다.** 구형 투구표의 범례 행은 칸이 2개라
     * (`ホール：ホールド` · `ＨＰ：…`) 떼기 전에 거르면 살아남아 헤더 자리를 차지한다.
     */
    .filter((c) => c.length > 1);
  return mergeSplitColumns(rows);
}

/**
 * 헤더 비교용 정규화. **값 칸에는 쓰지 않는다**(이름의 공백은 뜻이 있다).
 *
 * 구형(2023~2024)이 다른 점 셋:
 *   · `<br />` 를 벗긴 자리에 공백이 남는다 — `選 手` · `試 合`
 *   · 장음을 **세로쓰기용 전각 세로줄** `｜`(U+FF5C)로 쓴다 — `セ｜ブ` · `ホ｜ル` · `ボ｜ク`
 *   · 투수 이름 열을 `投手` 라고 부른다(신형은 `選手`)
 */
function headerKey(cell: string): string {
  return cell
    .replace(/[\s\u3000]/g, "")
    // ⚠**세로줄을 장음으로 되돌린다.** 안 하면 `セ｜ブ` 가 `セーブ` 와 안 맞아
    // 「열이 없다」로 멈춘다 — 구형 3열이 통째로 사라진다
    .replace(/\uFF5C/g, "ー")
    .replace(/^投手$/, "選手")
    // ⚠구형은 홀드를 **축약**한다(`ホ｜ル`). 위에서 장음을 되돌리면 `ホール` 이 되는데
    // 신형은 `ホールド` 다 — 한 글자 차이로 열이 통째로 안 잡힌다.
    // 실측(2026-08-17): 정규화 후 24열 중 **이 한 자리만** 다르다
    .replace(/^ホール$/, "ホールド");
}

/**
 * 헤더가 빈 열을 **앞 열에 합친다.**
 *
 * ⚠구형 투구표는 **투구회를 두 칸으로 쪼갠다** — `106` 과 `.1` 로 나뉘고
 * 헤더 쪽은 `投球回` 다음이 빈 칸이다. 합치지 않으면 **투구회의 1/3 자리가 사라진다**
 * (`106.1` → `106`). ⚠**「뒤의 열이 전부 밀린다」는 틀린 서술이었다**(2026-08-17 정정) —
 * 헤더에도 같은 빈 칸이 있고 값은 헤더 인덱스로 집으므로 다른 열은 안 밀린다.
 * 그래도 합쳐야 한다: 이닝의 1/3 자리는 이 도메인의 1급 값이고,
 * 잃으면 방어율 대조가 조용히 틀린다.
 * ⚠구형 타격표에는 빈 헤더가 없으므로(실측) 이 처리는 투구표에만 걸린다.
 */
function mergeSplitColumns(rows: string[][]): string[][] {
  const header = rows[0];
  if (header === undefined) return rows;
  const drop: number[] = [];
  for (let i = 1; i < header.length; i += 1) if (headerKey(header[i]!) === "") drop.push(i);
  if (drop.length === 0) return rows;
  return rows.map((cells) => {
    const out = [...cells];
    // 뒤에서부터 지운다 — 앞에서 지우면 남은 인덱스가 밀린다
    for (const i of [...drop].reverse()) {
      if (i < out.length) {
        out[i - 1] = `${out[i - 1] ?? ""}${out[i] ?? ""}`;
        out.splice(i, 1);
      }
    }
    return out;
  });
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
  const header = (rows[0] ?? []).map(headerKey);
  if (header.length !== BATTING_HEADER.length || header.some((h, i) => h !== BATTING_HEADER[i])) {
    throw new StatsParseError(
      "타격 성적표의 헤더가 예상과 다르다 — 컬럼이 바뀌었는지 확인하라",
      `기대 ${BATTING_HEADER.length}열 [${BATTING_HEADER.join(",")}] / 실제 ${header.length}열 [${header.join(",")}]`,
    );
  }

  const out: PublishedBatting[] = [];
  for (const c of rows.slice(1)) {
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
  const header = (rows[0] ?? []).map(headerKey);
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
  for (const c of rows.slice(1)) {
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
