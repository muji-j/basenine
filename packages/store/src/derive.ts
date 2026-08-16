/**
 * 파서 산출물 → 적재용 행.
 *
 * 박스스코어의 타격표는 볼넷·삼진·장타를 컬럼으로 주지 않으므로, 타석 결과 셀의
 * 분류를 **여기서 센다**. 이 파일이 지표 입력을 만드는 마지막 단계다.
 */
import type { BatterRow, PitcherRow } from "@bb-app/parser";
import { foldOutcomes } from "./fold.ts";

export interface BattingRow {
  gameId: string;
  playerId: string;
  side: "away" | "home";
  battingOrder: string | null;
  position: string;
  pa: number;
  ab: number;
  h: number;
  d2: number;
  d3: number;
  hr: number;
  bb: number;
  ibb: number;
  hbp: number;
  sf: number;
  sh: number;
  so: number;
  roe: number;
  runs: number;
  rbi: number;
  sb: number;
}

export interface PitchingRow {
  gameId: string;
  playerId: string;
  side: "away" | "home";
  decision: string | null;
  outs: number;
  bf: number | null;
  pitches: number | null;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  runs: number;
  er: number;
  /**
   * 폭투·보크. ⚠**읽지 못하면 0이 아니라 null**이다(M11) —
   * 「폭투 0개」와 「폭투 열을 못 읽었다」는 다르다.
   */
  wp: number | null;
  balk: number | null;
}

/** 격리 대상. **버리지 않는다.** */
export interface QuarantineRow {
  kind: "unknownToken" | "paMismatch" | "hitMismatch" | "abMismatch" | "runsMismatch";
  gameId: string;
  playerId: string | null;
  raw: string;
  detail: string | null;
}

export interface DeriveResult {
  batting: BattingRow[];
  pitching: PitchingRow[];
  quarantine: QuarantineRow[];
}

/**
 * 타자 1행을 센다.
 *
 * ⚠**희생번트 계열 3종(犠打·犠野·犠失)은 전부 `sh`로 센다.** 어느 쪽이든 희생타로
 * 기록되어 타수에 들어가지 않는다 — 아카이브 대조로 확정한 사실이다.
 * ⚠**`振逃`(낫아웃 출루)는 삼진으로 센다.** 타자는 살아나가지만 삼진은 삼진이다.
 */
export function deriveBatting(
  gameId: string,
  side: "away" | "home",
  row: BatterRow,
): { row: BattingRow; quarantine: QuarantineRow[] } | null {
  if (row.isTeamTotal) return null;
  if (row.playerId === null) return null;

  const q: QuarantineRow[] = [];

  // ⚠분류 → 카운팅 스탯 변환은 `fold.ts` 한 벌만 쓴다(M1). 스플릿 집계도 같은 함수를 쓴다.
  const { line } = foldOutcomes(
    row.plateAppearances.map((p) => ({ outcome: p.outcome, count: 1, rbi: p.rbi })),
  );

  for (const pa of row.plateAppearances) {
    if (pa.outcome === "unknown") {
      q.push({ kind: "unknownToken", gameId, playerId: row.playerId, raw: pa.raw, detail: null });
    }
  }

  const out: BattingRow = {
    gameId,
    playerId: row.playerId,
    side,
    battingOrder: row.order,
    position: row.position,
    pa: line.pa,
    ab: line.ab, h: line.h, d2: line.double, d3: line.triple, hr: line.hr,
    bb: line.bb, ibb: line.ibb, hbp: line.hbp, sf: line.sf, sh: line.sh,
    so: line.so, roe: line.roe,
    // 득점·타점·도루는 박스스코어가 컬럼으로 주므로 그 값을 쓴다(결과 셀에서 도출하지 않는다).
    runs: row.runs, rbi: row.rbi, sb: row.steals,
  };

  // ⚠npb.jp가 낸 합계와 대조한다. 어긋나면 **조용히 넘기지 않고 격리한다.**
  if (out.ab !== row.ab) {
    q.push({ kind: "abMismatch", gameId, playerId: row.playerId, raw: String(row.ab), detail: `도출 ${out.ab}` });
  }
  if (out.h !== row.hits) {
    q.push({ kind: "hitMismatch", gameId, playerId: row.playerId, raw: String(row.hits), detail: `도출 ${out.h}` });
  }
  // 타석 = 타수 + 사사구 + 희생 + 타격방해. 어긋나면 분류 규칙이 빠진 것이다.
  const accounted = out.ab + out.bb + out.hbp + out.sf + out.sh;
  if (accounted > out.pa) {
    q.push({
      kind: "paMismatch",
      gameId,
      playerId: row.playerId,
      raw: String(out.pa),
      detail: `분류 합계 ${accounted}`,
    });
  }

  return { row: out, quarantine: q };
}

export function derivePitching(
  gameId: string,
  side: "away" | "home",
  row: PitcherRow,
): PitchingRow | null {
  if (row.isTeamTotal) return null;
  if (row.playerId === null) return null;
  return {
    gameId,
    playerId: row.playerId,
    side,
    decision: row.decision === "" ? null : row.decision,
    outs: row.outs ?? 0,
    bf: row.battersFaced,
    pitches: row.pitches,
    h: row.hits ?? 0,
    hr: row.homeRuns ?? 0,
    bb: row.walks ?? 0,
    hbp: row.hitByPitch ?? 0,
    so: row.strikeouts ?? 0,
    runs: row.runs ?? 0,
    er: row.earnedRuns ?? 0,
    // ⚠여기서는 `?? 0`을 쓰지 않는다. 다른 필드와 달리 이 둘은 「없음」이 실재한다
    wp: row.wildPitches,
    balk: row.balks,
  };
}
