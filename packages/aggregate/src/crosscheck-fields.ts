/**
 * **외부 대조(`tools/crosscheck.ts`)의 비교 항목 — 닫힌 표 · 범위 조각 · 값 해석**
 * (설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D4·D5).
 *
 * 공표 정정 자동 재수집은 외부 대조가 찾은 결함 후보 「(팀, 역할, 선수, 항목, 우리 값, 공표 값)」을
 * **그 차이를 만들 수 있는 경기**로 바꿔 다시 받는다. 그 다리가 이 파일이다.
 *
 * - `CROSSCHECK_FIELDS` — 도구가 맞대는 항목 **35개 전부**(재수집 대상 29 · 아님 6). 도구의 비교 라벨 집합과
 *   **정확히 같다**는 것을 시험이 지킨다(`test/crosscheck-fields.test.ts`) — 도구에 항목이 늘었는데 여기 없으면
 *   그 결함은 「어느 경기를 받을지 모르는」 채로 남는다.
 * - `crosscheckScope(alias)` — 도구의 두 SQL 과 후보 조회가 **함께 쓰는 범위 조각**(M1). 범위가 두 벌이면
 *   한쪽만 고쳐진 날 「도구가 센 경기」와 「다시 받는 경기」가 갈린다.
 * - `parseFieldValue(field, s)` — 결함의 `ours`·`published` 문자열을 수로 읽는다. **못 읽으면 `null`** 이고
 *   그 결함은 「대상 아님」이다(M7·M11 — 기본값으로 메우지 않는다).
 *
 * ⚠**이 파일은 import 가 0개인 잎(leaf)이어야 한다**(I1 · `packages/store/src/refetch-limit.ts` 선례).
 *   공표 정정 자동 재수집의 진입점이 서브패스 `@bb-app/aggregate/crosscheck-fields` 로 이 표만 가져온다 —
 *   여기서 무엇이든 import 하면 그 사슬(도구·파서·DB)의 로드 오류가 재수집을 시작 전에 죽인다.
 *   그래서 타입도 여기서 스스로 적는다.
 *
 * ⚠**SQL 조각의 별칭 규약** — 행 테이블(`batting_line`·`pitching_line`)의 별칭을 인자로 받고,
 *   경기 표는 **`g`** 로 JOIN 해 둔다(`JOIN game g ON g.game_id = <별칭>.game_id`). 도구의 두 SQL 이 그렇게 쓴다.
 */

export type CrosscheckKind = "batting" | "pitching";

/**
 * 값의 모양 — `parseFieldValue` 가 이것으로 읽는다.
 * - `count`: 셈(결정 항목 포함) — `^\d+$`
 * - `outs`: 投球回 — `100.1` 을 아웃 301 로 · 공표의 `+` 는 아웃 0
 * - `ratio`: 비율·유도(打率 · 長打率 · 出塁率 · 防御率) — **수로 읽지 않는다**(관문에만 쓰인다)
 */
export type CrosscheckValueShape = "count" | "outs" | "ratio";

interface FieldBase {
  /** 설계 D4 표의 `#`(1~35) — 표와 코드를 맞대는 손잡이다 */
  readonly no: number;
  readonly kind: CrosscheckKind;
  /** 도구가 결함의 `field` 에 적는 라벨 그대로 */
  readonly field: string;
  readonly shape: CrosscheckValueShape;
}

/** 재수집 대상 — 경기 값 식과 후보 술어를 든다(설계 D4 의 세 칸) */
export interface CrosscheckTargetField extends FieldBase {
  readonly refetch: true;
  /** 경기 값 식(보고의 「전 값 → 후 값」) — 예: `x.wp` · `x.decision` */
  readonly gameValue: (alias: string) => string;
  /** o>p(우리가 많다) 후보 술어 — 그 경기에서 이 항목이 우리 합에 무언가를 더했다(NULL 은 > 0 이 아니다) */
  readonly oursMore: (alias: string) => string;
  /** o<p(우리가 적다) 후보 술어 — 「출장」= 범위 안에 그 선수의 행이 있는 경기 전부 */
  readonly oursLess: (alias: string) => string;
}

/** 재수집 대상 아님 — 왜 아닌지를 든다 */
export interface CrosscheckOtherField extends FieldBase {
  readonly refetch: false;
  readonly why: string;
}

export type CrosscheckField = CrosscheckTargetField | CrosscheckOtherField;

/** SQL 에 그대로 박히는 별칭이라 **식별자만** 받는다. 틀리면 던진다(조각이 조용히 다른 뜻이 되지 않게) */
function sqlAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`SQL 별칭이 식별자가 아니다: ${JSON.stringify(alias)}`);
  }
  return alias;
}

/** 「출장」— 범위 조각이 이미 「그 선수의 행이 있는 경기」로 좁혔으므로 더 거를 것이 없다 */
function appeared(alias: string): string {
  sqlAlias(alias);
  return "1 = 1";
}

/** 셈 항목 — 경기 값은 그 칼럼, o>p 는 「그 경기에 0 보다 컸다」 */
function count(
  no: number,
  kind: CrosscheckKind,
  field: string,
  column: string,
  shape: "count" | "outs" = "count",
): CrosscheckTargetField {
  return {
    no,
    kind,
    field,
    shape,
    refetch: true,
    gameValue: (a) => `${sqlAlias(a)}.${column}`,
    oursMore: (a) => `${sqlAlias(a)}.${column} > 0`,
    oursLess: appeared,
  };
}

/** 결정 항목(勝利·敗戦·セーブ·ホールド) — 경기 값은 결정 표기, o>p 는 「그 표기가 붙은 경기」 */
function decision(no: number, field: string, mark: string): CrosscheckTargetField {
  return {
    no,
    kind: "pitching",
    field,
    shape: "count",
    refetch: true,
    gameValue: (a) => `${sqlAlias(a)}.decision`,
    oursMore: (a) => `${sqlAlias(a)}.decision = '${mark}'`,
    oursLess: appeared,
  };
}

function other(no: number, kind: CrosscheckKind, field: string, shape: CrosscheckValueShape, why: string): CrosscheckOtherField {
  return { no, kind, field, shape, refetch: false, why };
}

const RATIO = "비율·유도(관문에만) — 셈에서 계산되는 값이라 후보 경기를 고를 술어가 없다. 셈이 틀렸으면 그 셈이 따로 결함으로 잡힌다";

/**
 * **닫힌 표** — 설계 D4 의 35행 그대로(차례도 같다 · 도구가 맞대는 차례이기도 하다).
 *
 * ⚠**「우리 값(crosscheck)」 칸은 여기 적지 않는다** — 도구의 SQL 이 정본이고, 시험이 도구 소스에서 그 합계 식을 읽어
 *   경기 값 식과 **같은 칼럼인지** 맞댄다(`test/crosscheck-fields.test.ts`). 두 곳에 적으면 한쪽만 고쳐진다.
 */
export const CROSSCHECK_FIELDS: readonly CrosscheckField[] = [
  other(1, "batting", "試合", "count", "classifyDiff 가 늘 정의 차이로 접으므로(出場試合 대 打撃記録のある試合) 결함이 되지 않는다 · 행 수 항목"),
  count(2, "batting", "打席", "pa"),
  count(3, "batting", "打数", "ab"),
  count(4, "batting", "得点", "runs"),
  count(5, "batting", "安打", "h"),
  count(6, "batting", "二塁打", "d2"),
  count(7, "batting", "三塁打", "d3"),
  count(8, "batting", "本塁打", "hr"),
  count(9, "batting", "打点", "rbi"),
  count(10, "batting", "盗塁", "sb"),
  count(11, "batting", "犠打", "sh"),
  count(12, "batting", "犠飛", "sf"),
  count(13, "batting", "四球", "bb"),
  count(14, "batting", "故意四", "ibb"),
  count(15, "batting", "死球", "hbp"),
  count(16, "batting", "三振", "so"),
  other(17, "batting", "打率", "ratio", RATIO),
  other(18, "batting", "長打率", "ratio", RATIO),
  other(19, "batting", "出塁率", "ratio", RATIO),
  other(20, "pitching", "試合", "count", "행 수 항목이다. o<p 는 우리에게 행이 없는 경기라 찾을 수 없다"),
  decision(21, "勝利", "○"),
  decision(22, "敗戦", "●"),
  decision(23, "セーブ", "S"),
  decision(24, "ホールド", "H"),
  count(25, "pitching", "被安打", "h"),
  count(26, "pitching", "被本塁打", "hr"),
  count(27, "pitching", "与四球", "bb"),
  count(28, "pitching", "与死球", "hbp"),
  count(29, "pitching", "奪三振", "so"),
  count(30, "pitching", "失点", "runs"),
  count(31, "pitching", "自責点", "er"),
  count(32, "pitching", "暴投", "wp"),
  count(33, "pitching", "ボーク", "balk"),
  // ⚠投球回 은 아웃 수로 맞댄다 — `6.2` 를 부동소수로 다루지 않는다
  count(34, "pitching", "投球回", "outs", "outs"),
  other(35, "pitching", "防御率", "ratio", RATIO),
];

/**
 * **범위 조각** — 시즌 · `played` · 대회 · `game_date ≤ 기준일` · **그 팀 쪽**(설계 D4·D5).
 *
 * 도구의 두 SQL 과 공표 정정 자동 재수집의 후보 조회가 **이 조각 한 벌**을 쓴다(M1). `WHERE` 뒤에 그대로 붙인다.
 * 자리표시자 `?` 가 **다섯** 개이고 값은 `crosscheckScopeParams` 가 그 차례로 낸다 — 조각 뒤에 붙이는 조건의 `?` 는 그 뒤에 온다.
 *
 * ⚠**「그 팀 쪽」이 이적을 처리한다**(설계 M-D) — 한 시즌에 두 팀의 행을 가진 선수는 팀마다 따로 센다.
 *   공표표가 팀별이기 때문이다.
 *
 * @param alias 행 테이블(`batting_line`·`pitching_line`)의 별칭. 경기 표는 `g` 로 JOIN 해 둔다.
 */
export function crosscheckScope(alias: string): string {
  const a = sqlAlias(alias);
  return `g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND ((${a}.side = 'away' AND g.away_code = ?) OR (${a}.side = 'home' AND g.home_code = ?))`;
}

export interface CrosscheckScopeInput {
  readonly season: number;
  /** 도구의 `--competition`(기본 `regular`) — 감지 결과 JSON 의 `competition` 이 이것이다 */
  readonly competition: string;
  /** 기준일(`YYYY-MM-DD` · 포함) — 감지 결과 JSON 의 `as_of.date` */
  readonly through: string;
  /** 팀 코드(`t`) — 그 팀 쪽 행만 */
  readonly team: string;
}

/** `crosscheckScope` 의 `?` 다섯 개에 들어갈 값 — **차례가 조각과 한 벌**이다 */
export function crosscheckScopeParams(s: CrosscheckScopeInput): [number, string, string, string, string] {
  return [s.season, s.competition, s.through, s.team, s.team];
}

/**
 * 결함의 `ours`·`published` 문자열을 **그 항목의 수**로 읽는다(설계 D4 「값 해석」).
 *
 * - 셈·결정: `^\d+$` 만. 공표 칸 `-` 는 파서가 `NaN` 으로 넘기고(문자열 `"NaN"`), 우리 `SUM` 이 전부 NULL 이면 `"null"` 이다 —
 *   **둘 다 해석 불가**다(M11 — 「없음」을 0 으로 메우지 않는다).
 * - 投球回: `^(\d+)(?:\.([12]))?$` 를 아웃 수로. 공표의 `+`(아웃 0 인 등판)는 아웃 0 이다. 그 밖의 모양은 해석 불가.
 * - 비율과 표에 없는 항목: 해석 불가.
 *
 * @returns 그 항목의 수(投球回 은 아웃 수), 못 읽으면 `null` — **`null` 인 결함은 재수집 대상이 아니다**
 */
export function parseFieldValue(field: string, s: string): number | null {
  // ⚠라벨은 역할을 넘어 겹치는 것이 試合 하나뿐이고 둘 다 셈이다 — 라벨만으로 모양이 정해진다(시험이 지킨다)
  const row = CROSSCHECK_FIELDS.find((f) => f.field === field);
  if (row === undefined) return null;
  switch (row.shape) {
    case "count": {
      if (!/^\d+$/.test(s)) return null;
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : null;
    }
    case "outs": {
      if (s === "+") return 0;
      const m = /^(\d+)(?:\.([12]))?$/.exec(s);
      if (m === null) return null;
      const outs = Number(m[1]) * 3 + Number(m[2] ?? "0");
      return Number.isSafeInteger(outs) ? outs : null;
    }
    case "ratio":
      return null;
  }
}
