/**
 * 타석 결과 분류 → 카운팅 스탯.
 *
 * ⚠**이 변환은 여기 한 벌만 존재한다**(M1). 경기별 성적(`derive.ts`)과 스플릿 집계가
 * 같은 규칙을 쓰는데, 두 곳에 적으면 언젠가 어긋나고 그때는 어느 쪽이 맞는지 알 수 없다.
 */
import type { Outcome } from "@bb-app/parser";
import { countsAsAtBat, countsAsHit } from "@bb-app/parser";
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
 * ⚠**희생번트 3종(犠打·犠野·犠失)은 전부 `sh`**, **낫아웃 출루는 `so`이면서 타수**,
 * **고의사구는 `bb`와 `ibb` 양쪽**에 들어간다. 전부 아카이브 대조로 확정한 규칙이다.
 */
export function foldOutcomes(tallies: Iterable<OutcomeTally>): { line: BattingLine; rbi: number } {
  const line = emptyBattingLine();
  let rbi = 0;

  for (const t of tallies) {
    const o = t.outcome as Outcome;
    line.pa += t.count;
    rbi += t.rbi;
    if (countsAsAtBat(o)) line.ab += t.count;
    if (countsAsHit(o)) line.h += t.count;
    switch (o) {
      case "double": line.double += t.count; break;
      case "triple": line.triple += t.count; break;
      case "homerun": line.hr += t.count; break;
      case "walk": line.bb += t.count; break;
      case "intentionalWalk": line.bb += t.count; line.ibb += t.count; break;
      case "hitByPitch": line.hbp += t.count; break;
      case "sacFly": line.sf += t.count; break;
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
      default: break;
    }
  }

  return { line, rbi };
}
