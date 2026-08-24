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
  /**
   * ⚠**격리 종류를 늘릴 때는 화면(`log-page.ts`)도 함께 본다.** 종류가 늘었는데
   * 화면이 모르면, 격리는 쌓이는데 아무도 안 보는 상태가 된다.
   */
  kind:
    | "unknownToken"
    | "paMismatch"
    | "hitMismatch"
    | "abMismatch"
    | "runsMismatch"
    /**
     * 박스스코어의 `盗塁` 합계와 타석 로그에서 센 도루 수가 다르다.
     * ⚠**둘이 어긋나면 화면이 자기모순을 낸다** — 같은 블록에 「盗塁 30」과
     * 「28을 함축하는 성공률」이 나란히 뜬다. 어느 쪽이 맞는지는 사람이 판단한다.
     * 실측(2026-08-17): 2,395경기 중 어긋남 **0건**이라 임계값 0으로 걸 수 있다.
     */
    | "stealMismatch"
    /**
     * 주자 행(도루·도루자·견제사)의 원문을 읽지 못했다.
     * ⚠**파서가 던지지 않는 이유는 blast radius다** — 던지면 그 경기의 **타석 로그 전량**이
     * 사라진다. 대신 여기 쌓이고, 쌓이면 収集ログ가 말한다.
     * 실측(2026-08-17): 아카이브 2,761장에서 **0건**이라 임계값 0으로 볼 수 있다.
     */
    | "unreadRunner"
    /** 투구회를 읽지 못했다. **0으로 때우면 그 등판이 사라진 채 방어율만 부풀어 오른다** */
    | "unreadableInnings"
    /**
     * 투수 기록 7열(피안타·피홈런·사구·사구체·탈삼진·실점·자책) 중 하나를 읽지 못했다.
     *
     * ⚠**여기는 `?? 0` 이었다**(2026-08-21 감사 [2] · 2026-08-24 수정).
     * 「모른다」와 「0」은 다르다(M11) — 피안타를 못 읽었는데 0 을 넣으면
     * **그 투수가 무피안타로 던진 것**이 되고, 아무도 그것을 의심하지 않는다.
     * ⚠**`unreadableInnings` 와 같은 이유, 같은 처방**이다. 그쪽만 하고 이쪽을 안 했다.
     * ⚠**지금 걸리는 것은 0건**이다(감사 실측) — 이건 **잠재 결함**을 막는 장치다.
     */
    | "unreadablePitchingStat";
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

/**
 * 투수 1행을 센다.
 *
 * ⚠**투구회를 못 읽었으면 0으로 때우지 않는다**(M7·M11). 0은 「던지지 않았다」는 뜻이고,
 * 그 등판이 통째로 사라진 채 방어율만 부풀어 오른다 — 값이 그럴듯해서 눈으로는 안 잡힌다.
 *
 * 실측(2026-08-16 외부 대조): `5+` 표기를 못 읽어 **투수 39명의 시즌 투구회가 모자랐고**
 * 방어율이 전부 부풀어 있었다(篠木 5.37 vs 공표 4.57). 파싱은 고쳤지만,
 * **다음에 또 읽지 못하는 표기가 나와도 조용히 0이 되지 않도록** 이 경로를 격리로 바꾼다.
 */
export function derivePitching(
  gameId: string,
  side: "away" | "home",
  row: PitcherRow,
): { row: PitchingRow | null; quarantine: QuarantineRow[] } | null {
  if (row.isTeamTotal) return null;
  if (row.playerId === null) return null;

  if (row.outs === null) {
    // ⚠**이 등판은 적재하지 않는다.** 0으로 넣으면 시즌 합계가 조용히 틀리고,
    // 격리에 남기면 수집 로그 화면이 「판단이 필요하다」고 말해 준다
    return {
      row: null,
      quarantine: [
        {
          kind: "unreadableInnings",
          gameId,
          playerId: row.playerId,
          raw: row.name,
          detail: `打者${row.battersFaced ?? "?"}人を相手にしたが投球回を読めなかった`,
        },
      ],
    };
  }

  /**
   * ⚠**「모른다」를 0 으로 바꾸지 않는다**(M11 · 감사 [2] · 2026-08-24).
   *
   * 이 일곱은 `?? 0` 이었다. 파서가 하나라도 못 읽으면 **그 투수가 「무피안타·무실점」으로
   * 기록되고**, 화면은 그것을 정상값으로 그린다 — 조용히 틀린 숫자의 교과서적인 모양이다.
   * ⚠**위 `unreadableInnings` 가 이미 같은 판단을 했다.** 그쪽만 하고 이쪽을 안 했을 뿐이다.
   * ⚠**지금 걸리는 것은 0건**이다 — 잠재 결함을 막는 장치이지 지금 값을 바꾸는 수정이 아니다.
   */
  const { hits, homeRuns, walks, hitByPitch, strikeouts, runs: rns, earnedRuns } = row;
  // ⚠**한 줄로 묶어 검사한다** — 이래야 타입이 좁혀진다. 모아 세는 방식으로 쓰면
  //   TS 가 아래에서 여전히 `number | null` 로 본다(실제로 그렇게 썼다가 4곳이 났다)
  if (
    hits === null || hits === undefined || homeRuns === null || homeRuns === undefined ||
    walks === null || walks === undefined || hitByPitch === null || hitByPitch === undefined ||
    strikeouts === null || strikeouts === undefined || rns === null || rns === undefined ||
    earnedRuns === null || earnedRuns === undefined
  ) {
    /**
     * ⚠**화면에 그대로 나가는 문자열이라 열 이름도 일본어다**(§7 · `log-page.ts` 가 `detail` 을 그린다).
     * 바로 위 `unreadableInnings` 의 detail 과 같은 어법이다 — 한 화면에 두 언어가 섞이면 안 된다.
     */
    const missing = (
      [
        ["被安打", hits], ["被本塁打", homeRuns], ["与四球", walks], ["与死球", hitByPitch],
        ["奪三振", strikeouts], ["失点", rns], ["自責点", earnedRuns],
      ] as const
    ).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
    // ⚠**이 등판은 적재하지 않는다** — `unreadableInnings` 와 같다
    return {
      row: null,
      quarantine: [
        {
          kind: "unreadablePitchingStat",
          gameId,
          playerId: row.playerId,
          raw: row.name,
          detail: `投手成績を読めなかった: ${missing.join("・")}`,
        },
      ],
    };
  }

  const out: PitchingRow = {
    gameId,
    playerId: row.playerId,
    side,
    decision: row.decision === "" ? null : row.decision,
    outs: row.outs,
    bf: row.battersFaced,
    pitches: row.pitches,
    h: hits,
    hr: homeRuns,
    bb: walks,
    hbp: hitByPitch,
    so: strikeouts,
    runs: rns,
    er: earnedRuns,
    // ⚠여기서는 `?? 0`을 쓰지 않는다. 다른 필드와 달리 이 둘은 「없음」이 실재한다
    wp: row.wildPitches,
    balk: row.balks,
  };

  return { row: out, quarantine: [] };
}
