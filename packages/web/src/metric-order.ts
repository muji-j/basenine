/**
 * **지표를 늘어놓는 순서 — 이 파일 한 벌뿐이다**(M1).
 *
 * ⚠**화면마다 순서가 달랐다**(2026-08-18 유저 요청으로 통일).
 * 순위 탭은 `wRC+ → SRC → OPS`, 구단 페이지는 `wRC+ → wOBA → wRAA → SRC`,
 * 선수 페이지는 `wOBA → wRC+ → … → SRC` 였다. 같은 지표를 화면마다 다른 자리에서 찾아야 하면
 * 읽는 사람이 **화면 수만큼 다시 배운다.**
 *
 * ⚠**무엇을 보여줄지는 화면이 정하고, 어느 순서로 놓을지는 여기가 정한다.**
 * 각 화면은 자기 지표 목록을 이 순서로 **정렬만** 한다 — 목록을 늘리거나 줄이지 않는다.
 * 그래서 화면에 없는 지표가 여기 있어도 아무 일도 일어나지 않는다.
 *
 * ## 순서의 근거
 *
 * 1. **우리가 만든 지표**(SRC · SRP) — 이 사이트가 앞세우는 것이고, 다른 데서는 볼 수 없다.
 *    ⚠**첫 지표가 그 화면의 주장이다.** 자체 지표를 뒤에 두면 화면이 「덜 중요하다」고 말한다.
 * 2. **세이버 표준**(wRC+ · wOBA · FIP …) — 널리 쓰이지만 해석이 필요한 값.
 * 3. **전통 비율**(打率 · 防御率 …) — 누구나 아는 값.
 * 4. **표본**(試合 · 打席 · 投球回) — 위의 비율들이 무엇을 나눈 것인지 말하는 수(M2).
 * 5. **누적 개수**(安打 · 本塁打 · 奪三振 …).
 *
 * ⚠**3번이 2번보다 뒤인 것이 이 사이트의 입장이다.** 打率만 보는 화면을 만들 거였으면
 * 이 사이트를 만들 이유가 없다. 다만 **빼지는 않는다** — 그것도 사실이다.
 */
const ORDER: readonly string[] = [
  // ── 1. 우리가 만든 지표 ────────────────────────────────
  "src", "srcPer600", "srp", "srpPer9",
  // ── 2. 세이버 표준 ────────────────────────────────────
  "wrcPlus", "wrcplus", "woba", "wraa",
  "fip", "whip", "iso", "babip",
  "kRate", "bbRate", "k9", "bb9", "hr9", "pitchesPerOut", "ppo",
  // ── 3. 전통 비율 ──────────────────────────────────────
  "avg", "obp", "slg", "ops", "era", "pct",
  // ── 4. 표본(분모) ─────────────────────────────────────
  "games", "pa", "ab", "outs", "innings", "bf", "role",
  // ── 5. 누적 개수 ──────────────────────────────────────
  "h", "double", "triple", "hr", "rbi", "runs", "sb", "cs",
  "bb", "ibb", "hbp", "so", "sf", "sh",
  "w", "l", "sv", "hld", "qs", "pitches", "wp", "balk",
];

const RANK = new Map(ORDER.map((k, i) => [k, i]));

/**
 * 그 지표가 몇 번째인가. **모르는 키는 맨 뒤**로 보낸다.
 *
 * ⚠**모르는 키에 예외를 던지지 않는다.** 이건 표시 순서일 뿐이고, 새 지표를 만드는 도중에
 * 화면이 통째로 죽는 것은 대가가 너무 크다. 대신 **맨 뒤에 모이므로 눈에 띈다** —
 * 새 지표가 목록 끝에 붙어 있으면 여기에 등록하라는 뜻이다.
 * ⚠**정렬은 안정적이어야 한다** — 같은 순위끼리는 원래 순서를 지킨다(`Array.sort` 가 그렇다).
 */
export function metricRank(key: string): number {
  return RANK.get(key) ?? ORDER.length;
}

/** 지표 목록을 정본 순서로. **목록을 바꾸지 않는다** — 순서만 바꾼다 */
export function byMetricOrder<T>(items: readonly T[], keyOf: (x: T) => string): T[] {
  return [...items].sort((a, b) => metricRank(keyOf(a)) - metricRank(keyOf(b)));
}

/** 이 목록이 정본 순서인가. **시험이 화면마다 이걸 묻는다** */
export function isMetricOrdered(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (metricRank(keys[i - 1]!) > metricRank(keys[i]!)) return false;
  }
  return true;
}
