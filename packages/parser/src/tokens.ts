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
  /**
   * **희생플라이** 중 실책이 나온 것(외야로 간 `犠失`). 타수 아님.
   *
   * ⚠**`犠失` 을 전부 번트로 읽으면 안 된다.** 번트는 외야로 가지 않는다 —
   * 외야 위치가 앞에 붙은 `犠失` 은 희생플라이다. 이 구별이 없으면 그 타석이
   * **犠飛가 아니라 犠打로 세어져 출루율의 분모가 하나 줄고**, 출루율이 실제보다 높게 나온다.
   *
   * 외부 대조가 잡았다 — 2024 ヤクルト **두 선수의 출루율**이 이렇게 갈렸다:
   * 北村拓 **.234 → .229** · 中村 **.316 → .315**(둘 다 고친 뒤 공표값과 일치).
   * ⚠**타율은 움직이지 않는다** — 두 분류 다 타수가 아니라 `AB`·`H` 가 그대로다.
   *   「.234/.316」을 한 선수의 타율/출루율로 읽으면 없는 결함을 쫓게 된다.
   */
  | "sacFlyError"
  /** 타격방해 출루(打妨出). 타수에 들어가지 않는다 */
  | "interference"
  /**
   * 주루방해 출루(走妨出). **타격방해와 다른 사건이다** — 수비가 주자의 진루를 방해한 것이고,
   * 타자에게는 타석이 기록되지만 타수에 들어가지 않는다.
   * ⚠2024년 아카이브에서 실제로 나왔고 격리에 잡혔다(2026-08-17) — 소급 시즌에는
   * 지금 어휘에 없는 표기가 더 있을 수 있다.
   */
  | "obstruction"
  /**
   * 수비방해 아웃(捕守妨). **위 둘과 방향이 반대다** — 타자·주자가 수비를 방해해서
   * **타자가 아웃**된 것이고, 아웃이므로 **타수에 들어간다**.
   *
   * ⚠**`interference` 로 묶으면 타수가 1 줄어든다.** 2024/0809 t-c-17 堂林의 박스가
   * 결과 셀 3개(`三ゴロ`·`捕守妨`·`右飛`)에 打数 **3** 이라고 적고 있다 — 실측으로 확정했다.
   * 이름을 같게 하면 「방해」라는 낱말 하나 때문에 정반대 규칙이 한 칸에 들어간다.
   */
  | "interferenceOut"
  /**
   * 규칙 위반 아웃(`違反`). 반칙 타구 등으로 **타자가 아웃**된 것이고, **타수에 들어간다**.
   *
   * ⚠**2022 아카이브에서 나왔다.** `2022/0723/t-db-15` 의 嶺井 —
   * 타석 로그가 `規則違反アウト` 이고 박스 결과 셀은 `違反` 한 단어다.
   * 어휘에 없어서 `unknown` 으로 격리됐고 **도출 타수 2 대 박스 3** 으로 어긋났다.
   * ⚠**근거의 분모는 1건이다.** 박스가 打数 3 이라고 적은 것이 유일한 관측이다 —
   *   「실측으로 확정」이라는 말이 표본 1을 가리지 않게 적어 둔다.
   * ⚠**`interferenceOut`(수비방해 아웃)과 묶지 않는다.** 결과는 같아도 규칙이 다르다.
   *   이름을 같게 하면 나중에 「방해였나 반칙이었나」를 물을 수 없다.
   * ⚠**소급 시즌에는 지금 어휘에 없는 표기가 더 있다** — 격리가 그것을 잡는 장치이므로
   *   격리 0건을 목표로 어휘를 넓히되, **모르는 것을 아는 것으로 바꾸지는 않는다.**
   */
  | "ruleViolationOut"
  | "reachedOnError"
  | "fieldersChoice"
  | "groundedIntoDoublePlay"
  | "fieldedOut"
  | "unknown";

/**
 * `Outcome` 전량. **유니온과 이 목록이 갈리면 컴파일이 멈춘다**(바로 아래 검사).
 *
 * ⚠**왜 유니온을 이 배열에서 파생시키지 않는가**: 유니온 쪽의 항목별 주석이
 * 이 프로젝트의 자산이다(「捕守妨는 왜 타수인가」·「走妨出은 왜 다른 사건인가」).
 * 배열로 옮기면 그 지식이 흩어진다. 그래서 **둘을 두고, 갈리는 것을 타입이 막는다.**
 */
export const OUTCOMES = [
  "single", "double", "triple", "homerun",
  "walk", "intentionalWalk", "hitByPitch",
  "strikeout", "strikeoutReached",
  "sacFly", "sacFlyError", "sacBunt", "sacBuntFieldersChoice", "sacBuntError",
  "interference", "obstruction", "interferenceOut", "ruleViolationOut",
  "reachedOnError", "fieldersChoice", "groundedIntoDoublePlay", "fieldedOut",
  "unknown",
] as const satisfies readonly Outcome[];

// ⚠**양쪽으로 검사한다.** 유니온에만 있는 것도, 배열에만 있는 것도 여기서 멈춘다
type _MissingFromList = Exclude<Outcome, (typeof OUTCOMES)[number]>;
const _listCoversUnion: _MissingFromList extends never ? true : never = true;
void _listCoversUnion;

/** DB·외부에서 온 문자열이 우리가 아는 분류인가. **모르면 좁히지 않는다**(M11) */
export function isOutcome(value: string): value is Outcome {
  return (OUTCOMES as readonly string[]).includes(value);
}

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
  // ⚠**수비방해는 방향이 반대다** — 위 둘은 출루(타수 제외), 이것은 **아웃(타수 산입)**이다.
  // ⚠**근거의 분모를 적는다.** 아카이브 box 전수에서 `妨` 을 포함한 셀은 **6건 3종**뿐이고
  //   (`打妨出`×3 · `走妨出`×2 · `捕守妨`×1), 6건 전부 박스 `打数` 열과 대조해 일치했다.
  //   즉 **이 규칙의 근거는 표본 1건**이다. 접두어를 연 것은 규칙상의 추론이지 관측이 아니다
  //   (테스트의 `一守妨`·`二守妨`는 우리가 만든 문자열이다). 다른 위치가 나와도 타자 아웃이라
  //   위험은 낮지만, 「실측으로 확정」이라는 말이 표본 1을 가리지 않게 적어 둔다.
  [/守妨$/, "interferenceOut"],
  // ⚠**규칙 위반 아웃.** 방해와 나란히 두되 **다른 분류**다(위 유니온 주석 참조).
  //   접미어가 겹치는 다른 어휘가 없어 순서에 민감하지 않다.
  [/違反$/, "ruleViolationOut"],
  // ⚠**희생(犠) 계열을 가장 먼저 본다.** 뒤에 失·野選이 붙어도 **희생타로 기록되어
  // 타수에 들어가지 않는다.** `投犠失`를 `失$` 규칙으로 먼저 잡으면 타수가 1 늘어난다
  // (아카이브 대조에서 실제로 19건이 이 원인이었다).
  [/犠飛$/, "sacFly"],
  [/犠打$/, "sacBunt"],
  [/犠野$/, "sacBuntFieldersChoice"],
  /**
   * ⚠**`犠失` 은 위치로 갈린다.** 외야로 간 희생타는 **플라이**이고,
   * 내야(投·捕·一·二·三·遊)로 간 것은 **번트**다 — 번트는 외야로 가지 않는다.
   *
   * 실측(2026-08-17, 2023~2026): 이 규칙이 타석 로그 원문(`犠牲フライ` / `犠牲バント`)과
   * **5,860건 전부 일치 · 예외 0건**. `犠失` 134건 중 외야는 2건이었고 둘 다 플라이였다.
   * ⚠**순서가 뜻을 갖는다** — 외야 규칙을 먼저 둔다.
   *
   * ⚠**박스는 중간 방향을 `左中`·`右中` 으로 쓴다**(2026-08-17 이중 검토 지적).
   * 처음에 `左中間`·`右中間` 이라고 썼는데 그건 **타석 로그 쪽 표기**이고,
   * 박스 178,420행에서 `左中間`·`右中間` 은 **0건**이다(실제 접두어는 `左中`·`右中` 4,740건).
   * 죽은 분기였을 뿐 아니라 **재발 경로**였다 — `左中犠失` 이 나오면 아래 `犠失$` 로 떨어져
   * 이 커밋이 고치려던 바로 그 오분류(희생번트)가 된다.
   * ⚠**두 글자 대안을 한 글자보다 먼저** 둔다. 뒤에 두면 `左` 가 먼저 먹고 안 맞는다.
   * (실측상 `犠` 계열의 접두어는 投·一·捕·中·三·左·右 한 글자뿐이라 지금 이 분기는 안 밟힌다.)
   */
  [/^(左中|右中|[左中右])犠失$/, "sacFlyError"],
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
    case "sacFlyError":
    case "interference":
    case "obstruction":
    case "unknown":
      return false;
    // 振逃·失·野選은 타수에 들어간다.
    // ⚠**수비방해 아웃(`interferenceOut`)도 여기다** — 아웃이므로 타수다.
    // 이름이 비슷한 `interference`·`obstruction` 은 위에서 false 로 갈린다.
    case "single":
    case "double":
    case "triple":
    case "homerun":
    case "strikeout":
    case "strikeoutReached":
    case "interferenceOut":
    // ⚠**규칙 위반 아웃도 타수다.** 근거는 표본 1건(2022/0723 t-db-15 박스 打数 3)
    case "ruleViolationOut":
    case "reachedOnError":
    case "fieldersChoice":
    case "groundedIntoDoublePlay":
    case "fieldedOut":
      return true;
    default:
      return assertHandled(outcome, "countsAsAtBat");
  }
}

/**
 * **새 `Outcome` 을 만들면 컴파일이 여기서 멈춘다.**
 *
 * ⚠예전에는 이 자리가 `default: return true` 였다. 그래서 새 분류를 더할 때
 * **손으로 세 곳(`countsAsAtBat`·`fold.ts`·`bunt.ts`)을 다 고쳐야 하는데,
 * 하나를 빠뜨려도 타입도 테스트도 아무 말을 하지 않았다** — 조용히 타수에 들어가거나
 * 조용히 `pa` 만 늘었다. 실제로 하루에 새 분류를 셋(`obstruction`·`interferenceOut`·
 * `sacFlyError`) 더했고, 맞춘 것은 검증이 아니라 결과였다(2026-08-17 이중 검토 지적).
 *
 * ⚠**런타임 분기가 아니라 타입 그물이다.** 실행 중에 여기 오는 일은 없어야 하지만,
 * 소스가 새 어휘를 내면(파서는 그것을 `unknown` 으로 돌린다) 안전하게 던진다.
 */
function assertHandled(outcome: never, where: string): never {
  throw new RangeError(`${where}: 다루지 않은 결과 분류 ${JSON.stringify(outcome)}`);
}

/** 이 결과가 안타(安打)인가. */
export function countsAsHit(outcome: Outcome): boolean {
  return (
    outcome === "single" || outcome === "double" || outcome === "triple" || outcome === "homerun"
  );
}
