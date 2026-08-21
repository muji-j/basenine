/**
 * 박스스코어의 **검증된 결과**와 playbyplay의 **문맥**을 타석 단위로 맞춘다.
 *
 * 왜 정렬이 성립하는가: 두 소스가 각자 독립적으로 타석을 나열하고, 타자별 타석 수가
 * 632경기 17,351행에서 **전건 일치**한다(`sweep-playbyplay.ts`). 둘 다 시간순이므로
 * 타자별로 순서대로 짝지으면 같은 타석이 만난다.
 *
 * ⚠**수가 어긋나면 짝짓지 않고 격리한다.** 어긋난 채로 짝지으면 결과가 엉뚱한 투수에게
 * 붙고, 그건 상대전적이 조용히 틀리는 것을 의미한다.
 */
import type { BoxScore, PlayEvent } from "@bb-app/parser";
import type { QuarantineRow } from "./derive.ts";

export interface PaEventRow {
  gameId: string;
  seq: number;
  inning: number;
  half: "top" | "bottom";
  outsBefore: number;
  bases: string;
  batterId: string;
  pitcherId: string | null;
  /** 박스스코어에서 온 분류 */
  outcome: string;
  rbi: number;
  rawBox: string;
  rawPbp: string;
  /**
   * 타석이 끝난 시점의 볼카운트 원문(`1-2より`). 표기가 없으면 null.
   *
   * ⚠**파서는 처음부터 이 값을 뽑고 있었는데 받는 자리가 없어 버려졌다**(2026-08-17).
   * ⚠**정규화하지 않고 원문 그대로 든다**(M4). 해석은 읽는 쪽에서 한다.
   * ⚠**없으면 null 이다**(M11) — `0-0` 으로 채우면 「초구에 끝났다」는 거짓이 된다.
   */
  ballCount: string | null;
  status: "final" | "live";
  /** 이 타석에서 난 득점. `runs.ts`가 유도하고 라인스코어로 검증한다 */
  runsScored: number;
}

export interface AlignResult {
  events: PaEventRow[];
  quarantine: QuarantineRow[];
  /**
   * **파서의 타석 번호 → 적재된 번호.**
   *
   * ⚠**버린 타석은 여기 없다**(미완결 · 격리된 타자). 그게 이 지도의 존재 이유다 —
   * 버린 것을 알고 있는 곳은 여기뿐이고, 그걸 안 넘기면 호출자가 다시 계산할 수가 없다.
   *
   * ⚠**이게 없어서 wSB 가 막혔다**(2026-08-21 실측). `runner_event.after_seq` 는
   * 파서 번호로 저장되는데 `pa_event.seq` 는 여기서 다시 매겨져, 둘이 **다른 계열**이 됐다.
   * 어긋난 주자 사건 **164경기 · 215건 전부**가 이것으로 설명된다(미설명 0).
   */
  seqOf: ReadonlyMap<number, number>;
}

/**
 * @param events playbyplay 이벤트 전량(미완 타석 포함 — 여기서 거른다)
 */
export function alignPaEvents(
  gameId: string,
  box: BoxScore,
  events: readonly PlayEvent[],
  /** `deriveRuns`가 낸 값. `events`(미완 포함) 중 **성립한 타석만** 순서대로 대응한다 */
  runsForCompleted: readonly number[] = [],
): AlignResult {
  const quarantine: QuarantineRow[] = [];
  if (box.status !== "played") return { events: [], quarantine, seqOf: new Map() };

  // 박스: 타자별 결과 목록(시간순)
  const boxByBatter = new Map<string, { raw: string; outcome: string; rbi: number }[]>();
  for (const team of [box.away, box.home]) {
    for (const b of team.batters) {
      if (b.isTeamTotal || b.playerId === null) continue;
      boxByBatter.set(
        b.playerId,
        b.plateAppearances.map((p) => ({ raw: p.raw, outcome: p.outcome, rbi: p.rbi })),
      );
    }
  }

  // 경과: 성립한 타석만, 타자별 시간순
  const completed = events.filter((e) => e.completed);
  const pbpByBatter = new Map<string, PlayEvent[]>();
  for (const e of completed) {
    const list = pbpByBatter.get(e.batterId);
    if (list === undefined) pbpByBatter.set(e.batterId, [e]);
    else list.push(e);
  }

  // ⚠짝짓기 전에 수를 맞춰본다. 하나라도 어긋나면 그 타자는 통째로 격리한다.
  const usable = new Set<string>();
  for (const [batterId, pbpList] of pbpByBatter) {
    const boxList = boxByBatter.get(batterId);
    if (boxList === undefined) {
      quarantine.push({
        kind: "paMismatch",
        gameId,
        playerId: batterId,
        raw: String(pbpList.length),
        detail: "경과에는 있으나 박스에 없는 타자",
      });
      continue;
    }
    if (boxList.length !== pbpList.length) {
      quarantine.push({
        kind: "paMismatch",
        gameId,
        playerId: batterId,
        raw: `박스 ${boxList.length}`,
        detail: `경과 ${pbpList.length}`,
      });
      continue;
    }
    usable.add(batterId);
  }
  for (const batterId of boxByBatter.keys()) {
    if (!pbpByBatter.has(batterId) && (boxByBatter.get(batterId)?.length ?? 0) > 0) {
      quarantine.push({
        kind: "paMismatch",
        gameId,
        playerId: batterId,
        raw: String(boxByBatter.get(batterId)?.length ?? 0),
        detail: "박스에는 있으나 경과에 없는 타자",
      });
    }
  }

  // 타자별 소비 위치를 들고 시간순으로 훑는다.
  const cursor = new Map<string, number>();
  const rows: PaEventRow[] = [];
  // ⚠**버린 타석을 기억해 둔다** — 주자 사건을 이어 붙이려면 이 대응이 필요하다
  const seqOf = new Map<number, number>();
  let seq = 0;
  for (const [completedIndex, e] of completed.entries()) {
    if (!usable.has(e.batterId)) continue;
    const i = cursor.get(e.batterId) ?? 0;
    cursor.set(e.batterId, i + 1);
    const fromBox = boxByBatter.get(e.batterId)![i]!;
    seq += 1;
    seqOf.set(e.seq, seq);
    rows.push({
      gameId,
      seq,
      inning: e.inning,
      half: e.half,
      outsBefore: e.outsBefore,
      bases: e.bases,
      batterId: e.batterId,
      pitcherId: e.pitcherId,
      outcome: fromBox.outcome,
      rbi: fromBox.rbi,
      rawBox: fromBox.raw,
      rawPbp: e.result,
      ballCount: e.count === undefined || e.count === "" ? null : e.count,
      // v1은 확정 데이터만 다룬다. 라이브는 v2에서 'live'로 들어온다(M9).
      status: "final",
      runsScored: runsForCompleted[completedIndex] ?? 0,
    });
  }

  return { events: rows, quarantine, seqOf };
}
