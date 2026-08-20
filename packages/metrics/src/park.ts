/**
 * **득점 환경** — 파크팩터와 RPW(1승의 값).
 *
 * ⚠**둘 다 값만 낸다. 어느 지표에도 배선하지 않는다**(2026-08-21 시점).
 * 특히 **`wRC+` 에 파크팩터를 넣지 않는다** — 지금 화면이 「球場補正は入れていません」이라고
 * 쓰고 있고, 넣는 순간 **전 선수의 wRC+ 가 움직여** 수준 등급의 색 임계값(옛 분포로 뽑은 것)이
 * 통째로 낡는다. **배선은 별개 결정이다**(docs/metrics/ §3.3).
 *
 * ⚠**M1**: 산식은 여기 한 벌이다. DB 를 훑는 것은 `scripts/venue-measure.ts --pf` ·
 * `scripts/rpw-measure.ts` 이고, 그것들도 이 함수를 부른다 — 계측이 자기 산식을 따로 가지면
 * 「계측과 코드가 갈렸다」를 아무도 못 본다.
 */
import { rate } from "./rate.ts";
import type { Rate } from "./rate.ts";

/**
 * 한 덩어리의 득점 환경. **양팀 합계 득점**과 그 경기 수.
 *
 * ⚠**「양팀 합계」다.** 홈팀 득점만 세면 그건 구장이 아니라 그 팀의 타선을 재는 것이 된다.
 * ⚠**득점을 모르는 경기는 `games` 에도 넣지 마라**(M11) — 0점으로 때우면 그 구장이 투수 친화로 보인다.
 */
export interface RunEnvironment {
  /** 양팀 합계 득점의 합 */
  runs: number;
  /** 그 득점이 나온 경기 수. **분모다** */
  games: number;
}

/** 경기당 양팀 합계 득점. ⚠경기가 0이면 값이 없다(M11) */
export function runsPerGame(e: RunEnvironment): Rate {
  return rate(e.runs, e.games);
}

/**
 * 파크팩터의 결과.
 *
 * ⚠**`value` 만 떼어 인용하지 마라.** PF 는 **기준선에 대한 비**라서 기준선이 바뀌면 값이 바뀐다 —
 * 실측으로 기준 표본을 조금만 다르게 자르면 전 구장이 0.001~0.002 움직인다(docs/metrics/ §3.3).
 * 그래서 이 타입이 표본과 기준선을 **같이** 나른다.
 */
export interface ParkFactor {
  /** 파크팩터. ⚠**표본이 0이거나 기준선이 0이면 `null`**(M11 — 1.000 으로 때우지 않는다) */
  value: number | null;
  /** 이 구장의 표본(경기). ⚠**분모 없이 렌더링 금지**(M2) */
  games: number;
  /** 이 구장의 경기당 득점 */
  runsPerGame: number | null;
  /** 기준선의 경기당 득점 */
  baselineRunsPerGame: number | null;
  /** 기준선의 표본(경기) */
  baselineGames: number;
}

/**
 * **파크팩터 = (그 구장의 경기당 득점) ÷ (기준선의 경기당 득점).**
 *
 * ⚠**이것은 「원시(raw) 파크팩터」다.** 상대 팀 보정도, 홈/원정 반반 보정도, 다년 회귀도 하지 않는다.
 * 그래서 **팀 성질이 섞여 있다** — 실측: 같은 京セラドーム 인데
 * 오릭스 홈경기 **0.924**(499경기) · 阪神 홈경기 **1.022**(63경기)다(2018~2025 완결 8시즌).
 * 구장이 둘로 갈린 게 아니라 **누가 치고 누가 던졌는가**가 그만큼 들어 있다는 뜻이다.
 * ⚠**이 사실을 적지 않고 값을 내보내면 그 값이 거짓말을 한다.**
 *
 * @param park 그 구장(=건물)의 홈경기. **「홈팀의 홈구장」만 넣는다** — 지방개최를 섞으면
 *   그 경기의 홈팀이 그 구장에 익숙하지 않다는 성질이 들어온다. 판정은 `@bb-app/domain` 의
 *   `isHomeVenue` 가 한다(**경기 수로 자르지 마라** — 阪神 京セラ·オリックス ほっと神戸가 사라진다).
 * @param baseline 같은 잣대로 모은 전체. **`park` 를 포함한다**(리그 평균이므로).
 */
export function parkFactor(park: RunEnvironment, baseline: RunEnvironment): ParkFactor {
  const p = runsPerGame(park);
  const b = runsPerGame(baseline);
  return {
    value: p.value === null || b.value === null || b.value === 0 ? null : p.value / b.value,
    games: park.games,
    runsPerGame: p.value,
    baselineRunsPerGame: b.value,
    baselineGames: baseline.games,
  };
}

/**
 * RPW 산식이 쓰는 **경기당 이닝**.
 *
 * ⚠**「실제 평균 이닝」이 아니다.** 실제로는 연장도 있고 홈팀이 9회말을 안 치는 경기도 있다.
 * 이것은 산식이 「이닝당 득점」을 정의할 때 쓰는 **약속된 상수**이고, 바꾸면 다른 수가 된다.
 * 우리 값(2025 센트럴 8.485 · 퍼시픽 8.667)은 이 9를 전제로 나온 것이다.
 */
export const INNINGS_PER_GAME = 9;

/** RPW 의 결과. ⚠**표본을 같이 나른다**(M2) */
export interface RunsPerWin {
  /** 1승의 값(득점). ⚠**경기가 0이면 `null`**(M11) */
  value: number | null;
  /** 표본(경기). ⚠**리그내 경기만**이어야 한다 */
  games: number;
  /** 경기당 양팀 합계 득점 — RPW 를 되짚을 수 있게 같이 낸다 */
  runsPerGame: number | null;
}

/**
 * **RPW = 10 × √(리그 이닝당 (득점+실점)).**
 *
 * 「1승이 몇 점인가」. 투수 WAR 계열이 득점을 승수로 옮길 때 쓰는 환산율이다.
 * ⚠**여기서도 값만 낸다** — WAR 을 내지 않는 사유는 데이터가 아니라 **이름과 대체수준**이다
 * (CLAUDE.md §2-2 · docs/metrics/ §6).
 *
 * ⚠**「리그내 경기만」이 조건이다.** 교류전을 넣으면 두 리그가 서로를 오염시켜
 * **「그 리그의 득점 환경」이라는 말 자체가 성립하지 않는다.** 실측(2025): 리그내는 각 375경기이고
 * `375 = 6팀 × 143 ÷ 2 − 교류전 54`. 이 선택은 산식이 아니라 **표본을 고르는 쪽**의 일이라
 * 부르는 쪽이 지킨다(`scripts/rpw-measure.ts` · `packages/metrics/test/park-db.test.ts`).
 *
 * @param e **양팀 합계 득점**과 리그내 경기 수. 한 경기는 **한 번만** 센다
 *   (홈·원정 양쪽에서 세면 경기 수가 두 배가 되고 RPW 는 √2 배 작아진다).
 */
export function runsPerWin(e: RunEnvironment): RunsPerWin {
  const rpg = runsPerGame(e);
  return {
    value: rpg.value === null ? null : 10 * Math.sqrt(rpg.value / INNINGS_PER_GAME),
    games: e.games,
    runsPerGame: rpg.value,
  };
}

/** 여러 덩어리를 합친다. ⚠**비율을 평균 내지 마라** — 원시 수를 더해야 분모가 맞는다 */
export function sumRunEnvironments(parts: readonly RunEnvironment[]): RunEnvironment {
  return parts.reduce<RunEnvironment>((a, b) => ({ runs: a.runs + b.runs, games: a.games + b.games }), {
    runs: 0,
    games: 0,
  });
}
