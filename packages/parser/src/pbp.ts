/**
 * 타석 로그 원문(`pa_event.raw_pbp`)에서 **타구 방향 · 타구 종류 · 삼진 내역**을 읽는다.
 *
 * ⚠**이 컬럼은 113,019행 전부 채워져 있는데 지금까지 아무 데서도 읽히지 않았다**(2026-08-16 확인).
 * 기록 시점과 테스트 픽스처에만 등장했다 — **가장 싼 자리에 있는데 아무도 안 본 자산**이다.
 *
 * ⚠**파서는 한 벌만 둔다**(M1). 지금이 중복 구현이 생기기 가장 쉬운 순간이다 —
 * 읽는 곳이 하나도 없으므로, 필요할 때마다 각자 `includes("ゴロ")` 를 쓰기 시작하면
 * 어느 날 한쪽만 고쳐진다. 원문을 해석하는 규칙은 여기에만 있다.
 *
 * ⚠**모르는 어휘를 조용히 흘리지 않는다**(M7). 실측으로 미분류가 0건이므로
 * 임계값 0으로 실패시킬 수 있다 — `unknownTokens` 가 그것을 위해 있다.
 */

/** 처리한 야수 기준의 방향 구역. ⚠**타구가 떨어진 지점이 아니다** — 시프트·호수비가 섞인다 */
export type Field =
  | "lf" | "cf" | "rf"
  | "lc" | "rc"
  | "ss" | "1b" | "2b" | "3b" | "p" | "c";

/**
 * 타구 종류.
 *
 * ⚠**`unknown` 은 「모른다」이지 「없다」가 아니다**(M11).
 * 비홈런 안타(`センター前ヒット` 등)에는 **타구 종류 표기가 아예 없다** — 실측 BIP의 27.7%다.
 * 이 사실이 xFIP 를 산출하지 않는 결정의 근거이기도 하다: 안타는 뜬공 비중이 높으므로
 * 이 결손은 **뜬공을 체계적으로 과소계상**한다.
 */
export type Trajectory = "ground" | "fly" | "liner" | "foulFly" | "homer" | "bunt" | "unknown";

/** 삼진의 내역. ⚠**헛스윙 유도율이 아니다** — 그건 투구 단위 데이터가 필요하고 우리에겐 없다 */
export type StrikeoutKind = "swinging" | "looking" | "buntFoul" | "reachedOnStrikeout";

export interface PbpFacts {
  /** 처리한 야수 기준의 방향. 타구가 없으면 null */
  field: Field | null;
  /** 타구 종류. 타구가 없으면 null · 표기가 없으면 `unknown` */
  trajectory: Trajectory | null;
  /** 삼진의 내역. 삼진이 아니면 null */
  strikeout: StrikeoutKind | null;
  /** 타구가 그라운드 안으로 갔는가(볼넷·사구·삼진·타격방해가 아닌가) */
  inPlay: boolean;
}

/**
 * 방향 토큰 → 구역.
 * ⚠**긴 것부터 본다.** `レフト線` 을 `レフト` 로 읽으면 구역이 뭉개진다.
 */
const FIELDS: readonly (readonly [string, Field])[] = [
  ["左中間", "lc"],
  ["右中間", "rc"],
  ["レフト", "lf"],
  ["センター", "cf"],
  ["ライト", "rf"],
  ["ショート", "ss"],
  ["セカンド", "2b"],
  ["サード", "3b"],
  ["ファースト", "1b"],
  ["ピッチャー", "p"],
  ["キャッチャー", "c"],
];

/**
 * 타구가 아예 없는 사건. ⚠여기에 없으면서 방향도 없으면 **모르는 어휘**다.
 *
 * ⚠**방해 3종이 전부 들어 있어야 한다.** 표기가 비슷하지만 규칙상 서로 다른 사건이다 —
 * `打撃妨害`(포수가 타자를 방해 → 출루) · `走塁妨害`(수비가 주자를 방해 → 출루) ·
 * `守備妨害`(타자·주자가 수비를 방해 → **아웃**). 공통점은 **타구가 없다**는 것뿐이고,
 * 여기서 우리가 쓰는 것은 그 공통점이다.
 */
const NO_BALL = [
  "三振", "フォアボール", "デッドボール", "振り逃げ",
  "打撃妨害", "走塁妨害", "守備妨害",
];

/** 좌·중·우 세 구역. ⚠**2루수를 우측에 넣는 것은 우리 정의다**(수비 위치 기준) */
const SIDE: Readonly<Record<Field, "left" | "center" | "right">> = {
  lf: "left", lc: "left", ss: "left", "3b": "left",
  cf: "center", rc: "right", p: "center", c: "center",
  rf: "right", "1b": "right", "2b": "right",
};

/** 그 구역이 좌·중·우 어느 쪽인가 */
export function sideOf(f: Field): "left" | "center" | "right" {
  return SIDE[f];
}

/** 내야인가 — 내야안타 판정에 쓴다 */
export function isInfield(f: Field): boolean {
  return f === "ss" || f === "1b" || f === "2b" || f === "3b" || f === "p" || f === "c";
}

function trajectoryOf(t: string): Trajectory {
  // ⚠**순서가 뜻을 갖는다.** `ファウルフライ` 를 `フライ` 로 읽으면 파울이 뜬공에 섞인다
  if (t.includes("ファウルフライ")) return "foulFly";
  if (t.includes("バント")) return "bunt";
  if (t.includes("ホームラン")) return "homer";
  if (t.includes("ゴロ")) return "ground";
  if (t.includes("ライナー")) return "liner";
  if (t.includes("フライ")) return "fly";
  // 비홈런 안타에는 타구 종류 표기가 없다 — 「모른다」이지 「없다」가 아니다(M11)
  return "unknown";
}

function strikeoutOf(t: string): StrikeoutKind | null {
  if (t.includes("振り逃げ")) return "reachedOnStrikeout";
  if (t.includes("スリーバント失敗")) return "buntFoul";
  if (t.includes("空振り三振")) return "swinging";
  if (t.includes("見逃し三振")) return "looking";
  return null;
}

/**
 * 원문 한 줄을 읽는다.
 *
 * @param raw `pa_event.raw_pbp` 그대로. 빈 문자열이면 전 항목이 null 이다
 */
export function readPbp(raw: string): PbpFacts {
  const t = raw.trim();
  if (t === "") return { field: null, trajectory: null, strikeout: null, inPlay: false };

  const strikeout = strikeoutOf(t);

  /**
   * ⚠**방해를 방향 토큰보다 먼저 본다.** 방해 표기는 **가해자의 수비 위치**로 시작한다 —
   * `ピッチャー走塁妨害出塁` · `キャッチャー守備妨害アウト`. 앞을 먼저 보면 「투수 앞 타구」가 되어
   * 방향 통계가 오염되고, 타구 종류가 `unknown` 인데 안타가 아니라서
   * `batted-ball.ts` 의 M7 불변식이 예외를 던진다(2024 시즌 적재에서 실제로 터졌다).
   *
   * ⚠**이 순서 변경은 실측으로 안전을 확인했다**: 타석 로그 178,420행(고유 290종) 중
   * 「방향으로 시작하면서 방해 어휘 포함」은 **2종 3행**뿐이고 둘 다 방해 플레이다.
   * 정상 타구는 한 건도 이 분기로 새지 않는다.
   */
  if (NO_BALL.some((tok) => t.includes(tok))) {
    return { field: null, trajectory: null, strikeout, inPlay: false };
  }

  const hit = FIELDS.find(([tok]) => t.startsWith(tok));
  if (hit === undefined) {
    return { field: null, trajectory: null, strikeout, inPlay: false };
  }
  return { field: hit[1], trajectory: trajectoryOf(t), strikeout: null, inPlay: true };
}

/**
 * 어느 규칙에도 안 걸리는 원문을 골라낸다.
 *
 * ⚠**빈 배열이 아니면 소스 표기가 바뀐 것이다**(M7). 실측(2026-08-16)으로 0건이므로
 * 호출부는 **임계값 0으로 실패시킬 수 있다** — 조용히 흘리면 타구 성향이 서서히 틀려진다.
 */
export function unknownTokens(raws: Iterable<string>): string[] {
  const bad = new Set<string>();
  for (const raw of raws) {
    const t = raw.trim();
    if (t === "") continue;
    if (FIELDS.some(([tok]) => t.startsWith(tok))) continue;
    if (NO_BALL.some((tok) => t.includes(tok))) continue;
    bad.add(t);
  }
  return [...bad].sort();
}
