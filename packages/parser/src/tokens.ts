/**
 * 타석 결과 셀의 해석.
 *
 * npb.jp 박스스코어의 타격표는 **볼넷·삼진·2루타·홈런을 컬럼으로 주지 않는다.**
 * `打数 得点 安打 打点 盗塁` 다섯 개뿐이고, 나머지는 전부 타석별 결과 셀에
 * `左越本①` · `敬遠四` · `三ゴ失` 같은 문자열로 들어 있다.
 * 따라서 **이 파일이 지표 입력의 원천**이며, 이 프로젝트에서 가장 깨지기 쉬운 지점이다.
 *
 * 실측(2026-08-15, 297경기 21,155셀): 고유 토큰 **208종**. 롱테일의 끝은 1건짜리다.
 * → **모르는 토큰을 버리지 않는다.** 격리해서 세고, 나중에 사람이 판단한다(CLAUDE.md M7·M14).
 */

/** 타석 결과의 분류. 지표 계산이 필요로 하는 입도로만 나눈다. */
export type Outcome =
  | "single"
  | "double"
  | "triple"
  | "homerun"
  | "walk"
  | "intentionalWalk"
  | "hitByPitch"
  | "strikeout"
  /** 낫아웃 출루(振逃). 삼진이면서 타자는 살아나간다 — 둘 다 사실이므로 분류를 따로 둔다 */
  | "strikeoutReached"
  | "sacFly"
  | "sacBunt"
  /** 희생번트를 시도했으나 야수선택이 된 것(犠野). 희생타로 기록되므로 타수 아님 */
  | "sacBuntFieldersChoice"
  /** 희생번트 중 실책이 나온 것(犠失). 희생타로 기록되므로 타수 아님 */
  | "sacBuntError"
  /** 타격방해 출루(打妨出). 타수에 들어가지 않는다 */
  | "interference"
  /**
   * 주루방해 출루(走妨出). **타격방해와 다른 사건이다** — 수비가 주자의 진루를 방해한 것이고,
   * 타자에게는 타석이 기록되지만 타수에 들어가지 않는다.
   * ⚠2024년 아카이브에서 실제로 나왔고 격리에 잡혔다(2026-08-17) — 소급 시즌에는
   * 지금 어휘에 없는 표기가 더 있을 수 있다.
   */
  | "obstruction"
  | "reachedOnError"
  | "fieldersChoice"
  | "groundedIntoDoublePlay"
  | "fieldedOut"
  | "unknown";

export interface PaResult {
  /** 정규화한 원문(공백 제거). 격리·감사에 쓴다 */
  raw: string;
  outcome: Outcome;
  /** 타점. 丸数字가 없으면 0 */
  rbi: number;
}

/** 丸数字 → 수. `①`=1 … `⑳`=20 */
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/**
 * 접미사 기반 분류표. **순서가 의미를 가진다** — 위에서부터 먼저 맞는 것을 채택한다.
 *
 * ⚠`三振`(삼진)과 `三ゴロ`(3루수 땅볼)는 둘 다 `三`으로 시작한다.
 * 수비 위치로 앞을 자르면 반드시 틀린다 — **결과어를 접미사로 본다.**
 * ⚠`三ゴ失`는 `ゴロ`가 아니라 `失`로 끝난다. 실책 출루이지 아웃이 아니다.
 */
const RULES: readonly (readonly [RegExp, Outcome])[] = [
  [/敬遠四$/, "intentionalWalk"],
  [/四球$/, "walk"],
  [/死球$/, "hitByPitch"],
  // 振逃는 三振보다 먼저 본다. 삼진이면서 출루라 별도 분류다.
  [/振逃$/, "strikeoutReached"],
  [/三振$/, "strikeout"],
  [/打妨出$/, "interference"],
  // ⚠**주루방해는 타격방해와 다른 사건이다.** 접미어가 한 글자만 달라 묶기 쉽지만,
  // 방해한 대상이 타자가 아니라 주자다. 이름을 같게 하면 나중에 구별할 수 없다
  [/走妨出$/, "obstruction"],
  // ⚠**희생(犠) 계열을 가장 먼저 본다.** 뒤에 失·野選이 붙어도 **희생타로 기록되어
  // 타수에 들어가지 않는다.** `投犠失`를 `失$` 규칙으로 먼저 잡으면 타수가 1 늘어난다
  // (아카이브 대조에서 실제로 19건이 이 원인이었다).
  [/犠飛$/, "sacFly"],
  [/犠打$/, "sacBunt"],
  [/犠野$/, "sacBuntFieldersChoice"],
  [/犠失$/, "sacBuntError"],
  // 실책·야수선택은 아웃 계열보다 먼저 본다. `三ゴ失`가 `ゴロ`로 잡히면 안 된다.
  [/失$/, "reachedOnError"],
  [/野選$/, "fieldersChoice"],
  [/併打$/, "groundedIntoDoublePlay"],
  [/本$/, "homerun"],
  [/３$/, "triple"],
  [/２$/, "double"],
  [/安$/, "single"],
  [/(ゴロ|邪飛|飛|直|ライナー|併殺)$/, "fieldedOut"],
];

/**
 * 결과 셀 1개를 해석한다.
 *
 * 모르는 형태는 **예외를 던지지 않고** `outcome: "unknown"`으로 돌려준다 —
 * 한 셀 때문에 경기 전체 파싱이 죽으면 그날이 통째로 비기 때문이다.
 * 대신 호출자가 `unknown`을 **반드시 세어서 보고**해야 한다(조용히 넘기면 M7 위반).
 */
export function parsePaCell(cell: string): PaResult | null {
  const raw = cell.replace(/[\s　]/g, "");
  if (raw === "" || raw === "-" || raw === "−") return null;

  let body = raw;
  let rbi = 0;
  const last = body.at(-1);
  if (last !== undefined) {
    const idx = CIRCLED.indexOf(last);
    if (idx >= 0) {
      rbi = idx + 1;
      body = body.slice(0, -1);
    }
  }

  for (const [pattern, outcome] of RULES) {
    if (pattern.test(body)) return { raw, outcome, rbi };
  }
  return { raw, outcome: "unknown", rbi };
}

/**
 * 이 결과가 타수(打数)에 들어가는가.
 *
 * ⚠이 표는 추측이 아니라 **아카이브 전량 대조로 확정했다** — 도출한 타수가
 * npb.jp의 `打数` 컬럼과 전 타자 행에서 일치하는지 확인했다(`tools/sweep-archive.ts`).
 */
export function countsAsAtBat(outcome: Outcome): boolean {
  switch (outcome) {
    case "walk":
    case "intentionalWalk":
    case "hitByPitch":
    case "sacFly":
    case "sacBunt":
    case "sacBuntFieldersChoice":
    case "sacBuntError":
    case "interference":
    case "obstruction":
    case "unknown":
      return false;
    default:
      // 振逃·失·野選은 타수에 들어간다.
      return true;
  }
}

/** 이 결과가 안타(安打)인가. */
export function countsAsHit(outcome: Outcome): boolean {
  return (
    outcome === "single" || outcome === "double" || outcome === "triple" || outcome === "homerun"
  );
}
