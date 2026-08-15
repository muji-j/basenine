/**
 * 타석별 득점 유도.
 *
 * 한 타석에서 나간 사람은 셋 중 하나다 — **득점하거나 · 아웃되거나 · 루상에 남거나.**
 * 그래서 보존식이 성립한다:
 *
 * ```
 * 주자_전 + 1(타자) = 주자_후 + 아웃증가 + 득점
 * → 득점 = 주자_전 + 1 − 주자_후 − 아웃증가
 * ```
 *
 * 이닝의 마지막 타석은 다음 상태가 없으므로 **아웃 3 · 주자 0**으로 닫는다.
 * ⚠단 끝내기(사요나라)는 3아웃 전에 끝난다 — 그 경우만 라인스코어로 메운다.
 *
 * ⚠**유도 결과의 이닝별 합계를 라인스코어와 대조한다.** 어긋나면 유도가 틀린 것이므로
 * 조용히 쓰지 않고 격리한다.
 */
import type { LineScore, PlayEvent } from "@bb-app/parser";
import type { QuarantineRow } from "./derive.ts";

export interface RunsResult {
  /** `events`와 같은 순서·길이. 각 타석에서 난 득점 */
  runsPerEvent: number[];
  quarantine: QuarantineRow[];
}

function runnerCount(bases: string): number {
  return bases.length;
}

/**
 * @param events 성립한 타석만(미완 제외). 시간순이어야 한다.
 */
export function deriveRuns(
  gameId: string,
  events: readonly PlayEvent[],
  lineScore: LineScore,
): RunsResult {
  const runsPerEvent = new Array<number>(events.length).fill(0);
  const quarantine: QuarantineRow[] = [];

  // 하프이닝 단위로 나눈다. 보존식은 **이닝 안에서만** 성립한다.
  const halves = new Map<string, number[]>();
  for (const [i, e] of events.entries()) {
    const key = `${e.inning}|${e.half}`;
    const list = halves.get(key);
    if (list === undefined) halves.set(key, [i]);
    else list.push(i);
  }

  for (const [key, indices] of halves) {
    const [inningText, half] = key.split("|");
    const inning = Number(inningText);
    const table = half === "top" ? lineScore.away : lineScore.home;
    const expected = table[inning - 1] ?? null;

    // 이닝 내부 전이: 다음 타석의 상태를 알므로 정확하다.
    let interior = 0;
    for (let k = 0; k < indices.length - 1; k += 1) {
      const cur = events[indices[k]!]!;
      const next = events[indices[k + 1]!]!;
      const runs =
        runnerCount(cur.bases) + 1 - runnerCount(next.bases) - (next.outsBefore - cur.outsBefore);
      runsPerEvent[indices[k]!] = runs > 0 ? runs : 0;
      interior += runsPerEvent[indices[k]!]!;
    }

    // ⚠**마지막 타석은 전이로 풀 수 없다.** 이닝이 끝나면 주자는 득점도 아웃도 아닌
    // **잔루**로 사라지는데, 보존식에는 잔루 항이 없어 그만큼을 득점으로 오인한다.
    // 그래서 마지막 한 칸만 라인스코어로 닫는다.
    const lastIndex = indices.at(-1);
    if (lastIndex === undefined) continue;
    if (expected === null) {
      runsPerEvent[lastIndex] = 0;
      continue;
    }

    const remainder = expected - interior;
    const last = events[lastIndex]!;
    const maxPossible = runnerCount(last.bases) + 1;

    if (remainder < 0 || remainder > maxPossible) {
      // 닫히지 않는다 = 이닝 내부 전이 계산이 틀렸다는 뜻이다. 조용히 쓰지 않는다.
      quarantine.push({
        kind: "runsMismatch",
        gameId,
        playerId: null,
        raw: `${inning}회${half === "top" ? "표" : "리"} 라인스코어 ${expected}`,
        detail: `내부 유도 ${interior} · 마지막 타석 잔여 ${remainder} (최대 가능 ${maxPossible})`,
      });
      runsPerEvent[lastIndex] = remainder > 0 && remainder <= maxPossible ? remainder : 0;
      continue;
    }
    runsPerEvent[lastIndex] = remainder;
  }

  return { runsPerEvent, quarantine };
}
