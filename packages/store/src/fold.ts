/**
 * 타석 결과 분류 → 카운팅 스탯.
 *
 * ⚠**이 변환은 여기 한 벌만 존재한다**(M1). 경기별 성적(`derive.ts`)과 스플릿 집계가
 * 같은 규칙을 쓰는데, 두 곳에 적으면 언젠가 어긋나고 그때는 어느 쪽이 맞는지 알 수 없다.
 */
import type { Outcome } from "@bb-app/parser";
import { countsAsAtBat, countsAsHit, isOutcome } from "@bb-app/parser";
import type { BattingLine } from "@bb-app/metrics";

/** 결과 하나가 몇 번 나왔고 타점이 몇이었는지. */
export interface OutcomeTally {
  outcome: Outcome | string;
  count: number;
  rbi: number;
}

export function emptyBattingLine(): BattingLine {
  return {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0,
    bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
  };
}

/**
 * 결과 집계를 카운팅 스탯으로 접는다.
 *
 * ⚠**`犠打`·`犠野`·**내야**의 `犠失` 은 `sh`, **외야**의 `犠失` 은 `sf`** —
 * 번트는 외야로 가지 않으므로 외야로 간 희생타는 **플라이**다.
 * 예전에 이 셋을 전부 `sh` 로 접었고, 그 때문에 출루율의 분모(犠飛)가 하나 줄어
 * **출루율이 실제보다 높게** 나왔다(2024 ヤクルト 2명 — 우리 .234/.316 대 공표 .229/.315).
 * 외부 대조(`crosscheck.ts`)가 잡았다 — 값이 그럴듯해서 테스트로는 안 잡혔다.
 *
 * ⚠**낫아웃 출루는 `so`이면서 타수**, **고의사구는 `bb`와 `ibb` 양쪽**에 들어간다.
 * 전부 아카이브 대조로 확정한 규칙이다.
 */
/**
 * **새 `Outcome` 을 만들면 컴파일이 여기서 멈춘다.**
 * `tokens.ts` 의 같은 장치와 짝이다 — 분류를 늘릴 때 손봐야 하는 자리가 여러 곳인데,
 * 하나를 빠뜨려도 타입도 테스트도 말하지 않던 것이 이 프로젝트의 실제 실패 모드였다.
 */
function assertHandledOutcome(outcome: never, where: string): never {
  throw new RangeError(`${where}: 다루지 않은 결과 분류 ${JSON.stringify(outcome)}`);
}

export function foldOutcomes(tallies: Iterable<OutcomeTally>): { line: BattingLine; rbi: number } {
  const line = emptyBattingLine();
  let rbi = 0;

  for (const t of tallies) {
    line.pa += t.count;
    rbi += t.rbi;
    /**
     * ⚠**`as Outcome` 캐스트를 없앴다.** 그 캐스트가 있는 한 아래 `default` 의 타입 그물이
     * 아무것도 못 막는다 — 새 분류를 더하고 여기를 안 고쳐도 컴파일이 통과했다.
     *
     * ⚠**모르는 문자열은 `pa` 만 세고 넘어간다**(M11). 파서는 모르는 셀을 `unknown` 으로
     * 주므로 여기 오는 일은 없어야 하지만, DB에는 **옛 파서가 넣은 값**이 남아 있을 수 있다.
     * 「타석은 있었다」는 사실이고 「카운팅 스탯의 자리를 모른다」도 사실이다.
     */
    if (!isOutcome(t.outcome)) continue;
    const o: Outcome = t.outcome;
    if (countsAsAtBat(o)) line.ab += t.count;
    if (countsAsHit(o)) line.h += t.count;
    switch (o) {
      case "double": line.double += t.count; break;
      case "triple": line.triple += t.count; break;
      case "homerun": line.hr += t.count; break;
      case "walk": line.bb += t.count; break;
      case "intentionalWalk": line.bb += t.count; line.ibb += t.count; break;
      case "hitByPitch": line.hbp += t.count; break;
      // ⚠**외야로 간 `犠失` 은 희생플라이다** — 번트는 외야로 가지 않는다.
      // `sh` 로 세면 출루율의 분모가 하나 줄어 값이 실제보다 높게 나온다(외부 대조가 잡았다)
      case "sacFly":
      case "sacFlyError":
        line.sf += t.count;
        break;
      case "sacBunt":
      case "sacBuntFieldersChoice":
      case "sacBuntError":
        line.sh += t.count;
        break;
      case "strikeout":
      case "strikeoutReached":
        line.so += t.count;
        break;
      case "reachedOnError": line.roe += t.count; break;
      /**
       * ⚠**여기 오는 분류는 「카운팅 스탯에 자리가 없다」는 뜻이다.**
       * `default: break` 로 두면 새 분류가 조용히 `pa` 만 늘리는데, 그게 이 파일이
       * 이번에 겪은 결함의 모양이다 — 그래서 **전부 이름으로 적는다.**
       * 새 `Outcome` 을 만들면 아래에서 컴파일이 멈춘다(`tokens.ts` 의 같은 장치).
       */
      // 안타는 위의 `countsAsHit` 이 이미 `h` 에 넣었다 — 여기서 또 세면 두 배가 된다
      case "single":
      case "interference":
      case "obstruction":
      case "interferenceOut":
      case "fieldersChoice":
      case "groundedIntoDoublePlay":
      case "fieldedOut":
      case "unknown":
        break;
      default:
        assertHandledOutcome(o, "foldOutcomes");
    }
  }

  return { line, rbi };
}
