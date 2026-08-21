/**
 * **SRC — 状況得点貢献 (Situational Run Contribution)**
 *
 * 타석마다 그 팀의 **득점기대치를 얼마나 바꿨는가**를 재서 합산한다.
 * 단위는 **평균 대비 득점**이며, 승리(wins)로 환산하지 않는다.
 *
 * ```
 * SRC = Σ (RE(타석 후 상태) − RE(타석 전 상태) + 그 타석에서 난 득점)
 * ```
 *
 * ## 무엇을 재고 무엇을 안 재는가 — **각주가 아니라 정의의 일부다**
 *
 * | 잰다 | 안 잰다 |
 * |---|---|
 * | 타석 사이의 득점기대치 변화 **전부** | **수비** — 타구 좌표·존·타구속도는 실재하지만 우리가 정당하게 접근할 수 없다 |
 * | 상황(주자·아웃)의 가중 | **포지션 보정·대체수준** — 그래서 WAR이 아니다 |
 *
 * ⚠**정정 2**(2026-08-20). 이 표는 「**수비** — 타구 좌표·존·타구속도가 **공개되지 않아**」라고
 * 적고 있었다. **그것도 사실이 아니다.** Data Stadium 이 `hc_x`/`hc_y`·`plate_x`/`plate_y`·구속을
 * 실제로 보유한다(2026-08-17 실측). 정확한 사유는 **정당한 접근 경로가 없다**는 것이다.
 *
 * ⚠**정정 3**(2026-08-20 · 같은 날 4차 조사). 정정 2 가 적은 근거
 * 「문서화된 클린 경로는 NPB BIP 하나뿐이고 월 3만엔~ · 우리 상한의 30배」는 **틀렸다** —
 * **BIP 카탈로그에 타구·좌표가 한 글자도 없고**(5개 어휘 grep 0건) 서비스 페이지가 **404** 다.
 * 「월 3만엔~」은 **좌표가 안 들어간 다른 상품의 값**이었다.
 * 정본 판매 주체는 **JBD** 이고 **가격을 물어본 적이 없다** — 그러니 지금 정직한 서술은
 * 「비싸다」가 아니라 **「안 물어봤다」**다(작업규칙 7). 자세한 것은 `docs/metrics/README.md` §6.
 * ⚠**여기 「월 3만엔」을 다시 적지 마라.**
 *
 * ⚠**정정 1**(문서 2026-08-16 · 여기 2026-08-20). 이 표는 「**주루**는 안 잰다 —
 * 도루·진루의 기여는 별도 지표로 다룬다」고도 적고 있었는데 **그것도 사실이 아니었다.**
 * 그 타석 **중에** 일어난 주루(폭투·도루·보크·패스트볼)로 들어온 점은 **그 타석의 값에 들어간다.**
 * 뺄 수 없기 때문이다 — npb.jp 의 타석별 기록에는 주자 사건이 별도 행으로 없어서,
 * 「타석 A 시작 상태」와 「타석 B 시작 상태」 사이의 변화에서 타격분과 주루분을 나눌 방법이 없다.
 * 실측(2025~2026 정규): 득점이 난 타석 8,009건 중 **타점 없이 점이 들어온 타석 355건(4.4%)**.
 * ⚠**문서(`docs/metrics/README.md` §3.5)가 먼저 고쳐졌고 이 주석만 낡은 채로 남아 있었다** —
 * 화면의 각주(`glossary.ts` 의 `src.caveat`)는 정정된 쪽을 이미 말하고 있었다.
 *
 * ⚠**WAR이 아니며 WAR과 비교할 수 없다.** 이름을 다르게 쓰는 이유가 그것이다 —
 * 같은 이름에 다른 값이면 그건 거짓말이 된다.
 *
 * ⚠**RE 행렬은 리그·시즌마다 다르다.** 센트럴 타자의 SRC를 퍼시픽 RE로 계산하지 마라.
 */
import type { Db } from "@bb-app/store";
import { seasonNameExpr, seasonNameJoin } from "./season-name.ts";
import type { RunExpectancy } from "./run-expectancy.ts";
import { afterStateOf, paValue, stateKey } from "./run-expectancy.ts";

export interface SrcEntry {
  playerId: string;
  displayName: string;
  /**
   * 그 기록을 낸 **구단**.
   *
   * ⚠**시즌 도중 이적하면 선수 하나가 여러 줄이 된다** — 구단 페이지가 「이 구단에서 낸 몫」만
   * 실으려면 이 갈래가 있어야 한다. 처음에는 선수 ID 하나로만 묶었는데, 그러면
   * **같은 SRC 가 두 구단 페이지에 그대로 실렸다**(실측 2026: 선수 23125136 이 DeNA 105타석
   * 페이지와 ソフトバンク 101타석 페이지에 **둘 다 13.31**). 같은 행 안에서 打席 는 팀 몫이고
   * SRC 는 시즌 합계라 **분모가 두 종류**가 됐다(2026-08-17 2차 검토 지적).
   * ⚠**순위는 시즌 합계를 써야 한다** — 부르는 쪽이 선수 단위로 더한다(M1: 여기서 두 벌 만들지 않는다).
   */
  teamCode: string;
  /** 상황득점공헌 합계. 평균 대비 득점 */
  src: number;
  /** 계산에 쓰인 타석 수. **분모다**(M2) */
  pa: number;
  /** RE에 없는 상태라 계산하지 못한 타석 수. **숨기지 않는다** */
  skipped: number;
  /** 600타석 환산. 표본이 다른 선수를 나란히 볼 때 쓴다 */
  srcPer600: number | null;
}

const SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,
       e.batter_id AS batterId, ${seasonNameExpr("b", "psnb")} AS batterName,
       (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) AS teamCode
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player b ON b.player_id = e.batter_id
${seasonNameJoin("e.batter_id", "g.season", "psnb")}
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ? AND g.game_date >= ?
  AND e.status = 'final'
  AND (CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
-- ⚠**시간 순은 seq 다.** half 열로 정렬하면 문자열이라 **bottom 이 top 보다 먼저** 온다 —
-- 한 이닝 안에서 말이 먼저 오는 순서가 되고, 「다음 행」이 시간상 다음 타석이 아니게 된다.
-- (하프 경계를 넘는 값을 쓰지는 않았으므로 지금까지 값은 맞았지만, seq 연속성으로 판정하려면
--  정렬 자체가 시간 순이어야 한다 — 2026-08-18)
ORDER BY e.game_id, e.seq
`;

function withLeagueTeams<T>(db: Db, codes: readonly string[], fn: () => T): T {
  db.raw.exec("CREATE TEMP TABLE IF NOT EXISTS league_team (code TEXT PRIMARY KEY)");
  db.raw.exec("DELETE FROM league_team");
  const stmt = db.raw.prepare("INSERT INTO league_team (code) VALUES (?)");
  for (const c of codes) stmt.run(c);
  try {
    return fn();
  } finally {
    db.raw.exec("DELETE FROM league_team");
  }
}

/**
 * 리그 1개의 타자별 SRC를 계산한다.
 *
 * @param re 같은 리그·시즌의 RE 행렬. **다른 리그의 행렬을 넣지 마라**
 */
export function computeSrc(
  db: Db,
  re: RunExpectancy,
  teamCodes: readonly string[],
  competition = "regular",
  /** ⚠**RE 행렬과 같은 기준일을 써야 한다.** 어긋나면 SRC의 기준이 화면과 달라진다 */
  through = "9999-12-31",
  /**
   * ⚠**기간의 시작일**(포함). 기본은 시즌 전체다.
   * 「지난주」처럼 **구간**을 재려고 더했다(2026-08-17) — 뺄셈으로 흉내 내면
   * 같은 계산을 두 번 돌리게 되고, 어느 쪽 기준일이 무엇인지 읽는 사람이 알 수 없다.
   */
  from = "0000-01-01",
): SrcEntry[] {
  const rows = withLeagueTeams(db, teamCodes, () =>
    db.raw.prepare(SQL).all(re.season, competition, through, from),
  ) as {
    gameId: string;
    inning: number;
    half: string;
    seq: number;
    bases: string;
    outs: number;
    runs: number;
    batterId: string;
    batterName: string;
    teamCode: string;
  }[];

  // ⚠**키가 「선수」가 아니라 「선수 × 구단」이다.** 이적 선수를 한 줄로 묶으면
  //   구단 페이지가 남의 팀 몫까지 싣는다(2026-08-17 2차 검토 지적)
  const acc = new Map<string, SrcEntry>();

  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    /**
     * ⚠**「같은 하프이닝」만으로는 부족하다**(2026-08-18 감사 P2 · `afterStateOf` 주석 참조).
     * 이 SQL 은 선수 이너조인·`status='final'` 로 행을 걸러낸 뒤 정렬하므로,
     * 중간 타석 하나가 빠지면 다음 행이 **그 다음다음 타석**이 된다.
     */
    const after = afterStateOf(cur, next);
    const value = after === null
      ? null
      : paValue(
        re,
        { bases: cur.bases, outs: cur.outs },
        after.use === "next" ? { bases: next!.bases, outs: next!.outs } : null,
        cur.runs,
      );

    const key = `${cur.batterId}|${cur.teamCode}`;
    let entry = acc.get(key);
    if (entry === undefined) {
      entry = {
        playerId: cur.batterId,
        displayName: cur.batterName,
        teamCode: cur.teamCode,
        src: 0,
        pa: 0,
        skipped: 0,
        srcPer600: null,
      };
      acc.set(key, entry);
    }

    if (value === null) {
      // RE에 없는 상태. **0으로 때우지 않는다** — 때우면 그 타석이 조용히 마이너스가 된다.
      entry.skipped += 1;
      continue;
    }
    entry.src += value;
    entry.pa += 1;
  }

  for (const e of acc.values()) {
    e.srcPer600 = srcPer600Of(e.src, e.pa);
  }
  return [...acc.values()];
}

/**
 * **SRP — 状況失点抑制 (Situational Run Prevention)** · 투수판 자체 지표
 *
 * 던진 타석마다 상대의 **득점기대치를 얼마나 억눌렀는가**를 재서 합산한다.
 * 타자의 SRC와 **정확히 같은 커널**을 쓰고 부호만 뒤집는다 —
 * 한 타석에서 타자가 얻은 것이 곧 투수가 내준 것이기 때문이다(M1).
 *
 * ```
 * SRP = −Σ (RE(타석 후) − RE(타석 전) + 그 타석의 실점)
 * ```
 *
 * 양수면 평균적인 상황 대비 **실점을 줄였다**는 뜻이고, 0이 평균이다.
 *
 * ## 무엇을 재고 무엇을 안 재는가 — **각주가 아니라 정의의 일부다**
 *
 * | 잰다 | 안 잰다 |
 * |---|---|
 * | 투구가 만든 득점기대치 변화 | **수비** — 타구 좌표에 정당하게 접근할 수 없다(위 「정정 2·3」). 실책성 안타도 투수에게 붙는다 |
 * | 상황(주자·아웃)의 가중 | **구종·구속** — 무료·약관 클린 소스가 없다 |
 * | | **포지션 보정·대체수준** — 그래서 WAR이 아니다 |
 *
 * ⚠**자책점과 「물려받은 주자」의 취급이 다르다.** 이 지표는 각 타석의 변화를
 * **그 타석을 던진 투수**에게만 붙인다. 주자를 남기고 내려간 투수는 「남겼다」는 상태까지만
 * 책임지고, 그 주자가 생환해도 그 실점은 **다음 투수의 기록**이 된다.
 * 자책점은 반대로 앞 투수에게 붙는다 — 어느 쪽이 옳다기보다 **다른 질문**이고,
 * 그래서 두 값이 어긋나는 것은 버그가 아니다.
 *
 * ⚠**RE 행렬은 리그·시즌마다 다르다.** 다른 리그의 행렬을 넣지 마라.
 */
export interface SrpEntry {
  playerId: string;
  displayName: string;
  /**
   * 그 기록을 낸 **구단**.
   *
   * ⚠**시즌 도중 이적하면 선수 하나가 여러 줄이 된다** — 구단 페이지가 「이 구단에서 낸 몫」만
   * 실으려면 이 갈래가 있어야 한다. 처음에는 선수 ID 하나로만 묶었는데, 그러면
   * **같은 SRC 가 두 구단 페이지에 그대로 실렸다**(실측 2026: 선수 23125136 이 DeNA 105타석
   * 페이지와 ソフトバンク 101타석 페이지에 **둘 다 13.31**). 같은 행 안에서 打席 는 팀 몫이고
   * SRC 는 시즌 합계라 **분모가 두 종류**가 됐다(2026-08-17 2차 검토 지적).
   * ⚠**순위는 시즌 합계를 써야 한다** — 부르는 쪽이 선수 단위로 더한다(M1: 여기서 두 벌 만들지 않는다).
   */
  teamCode: string;
  /** 상황실점억제 합계. 평균 대비 **막아낸** 득점 */
  srp: number;
  /** 계산에 쓰인 상대 타자 수. **분모다**(M2) */
  bf: number;
  /** RE에 없는 상태라 계산하지 못한 타석 수. **숨기지 않는다** */
  skipped: number;
  /** 이 투수가 잡은 아웃 카운트. 9이닝 환산의 분모 */
  outs: number;
  /** 9이닝 환산. 아웃이 0이면 null */
  srpPer9: number | null;
}

const SRP_SQL = `
SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,
       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,
       e.pitcher_id AS pitcherId, ${seasonNameExpr("p", "psnp")} AS pitcherName,
       (CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END) AS teamCode
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = e.pitcher_id
${seasonNameJoin("e.pitcher_id", "g.season", "psnp")}
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ? AND g.game_date >= ?
  AND e.status = 'final' AND e.pitcher_id IS NOT NULL
  AND (CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END) IN (SELECT code FROM league_team)
-- ⚠**시간 순은 seq 다.** half 열로 정렬하면 문자열이라 **bottom 이 top 보다 먼저** 온다 —
-- 한 이닝 안에서 말이 먼저 오는 순서가 되고, 「다음 행」이 시간상 다음 타석이 아니게 된다.
-- (하프 경계를 넘는 값을 쓰지는 않았으므로 지금까지 값은 맞았지만, seq 연속성으로 판정하려면
--  정렬 자체가 시간 순이어야 한다 — 2026-08-18)
ORDER BY e.game_id, e.seq
`;

/** 9이닝 환산에 쓸 아웃 수. **타석 로그에서 세지 않는다** — 투수표가 이미 정확히 갖고 있다 */
const SRP_OUTS_SQL = `
SELECT t.player_id AS pitcherId,
       (CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END) AS teamCode,
       SUM(t.outs) AS outs
FROM pitching_line t
JOIN game g ON g.game_id = t.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ? AND g.game_date >= ?
  AND (CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END) IN (SELECT code FROM league_team)
GROUP BY t.player_id, teamCode
`;

/**
 * 리그 1개의 투수별 SRP를 계산한다.
 *
 * ⚠**투수의 소속은 타격 쪽과 반대다.** `half='top'`은 원정팀이 치는 이닝이므로
 * 그때 던지는 투수는 **홈팀** 소속이다. 타자 SQL을 그대로 베끼면 리그가 뒤집힌다.
 */
export function computeSrp(
  db: Db,
  re: RunExpectancy,
  teamCodes: readonly string[],
  competition = "regular",
  /** ⚠**RE 행렬과 같은 기준일을 써야 한다** */
  through = "9999-12-31",
  /** ⚠**기간의 시작일**(포함). SRC 와 같은 이유로 더했다(2026-08-17) */
  from = "0000-01-01",
): SrpEntry[] {
  const { rows, outsRows } = withLeagueTeams(db, teamCodes, () => ({
    rows: db.raw.prepare(SRP_SQL).all(re.season, competition, through, from) as {
      gameId: string;
      inning: number;
      half: string;
      seq: number;
      bases: string;
      outs: number;
      runs: number;
      pitcherId: string;
      pitcherName: string;
      teamCode: string;
    }[],
    /* ⚠**아웃도 같은 기간이어야 한다.** 처음에 여기만 from 을 안 넘겼는데,
         그러면 srp/bf 는 그 주 것이고 outs 는 시즌 누적이라 srpPer9 가
         「한 주의 SRP ÷ 시즌 아웃」이 된다 — 화면에는 안 나오지만 공개 함수라
         다음 호출자가 조용히 틀린 수를 쓴다(2026-08-17 1차 검토 지적) */
    outsRows: db.raw.prepare(SRP_OUTS_SQL).all(re.season, competition, through, from) as {
      pitcherId: string;
      teamCode: string;
      outs: number;
    }[],
  }));

  // ⚠**아웃도 「선수 × 구단」이다** — 이적 투수의 아웃을 한 팀에 몰아 주면
  //   그 팀 페이지의 9이닝 환산이 부풀거나 줄어든다
  const outsBy = new Map(outsRows.map((r) => [`${r.pitcherId}|${r.teamCode}`, r.outs]));
  const acc = new Map<string, SrpEntry>();

  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    /**
     * ⚠**여기가 가장 밟기 쉬운 자리다**(2026-08-18 감사 P2). 이 SQL 은
     * `pitcher_id IS NOT NULL` 로 행을 걸러낸 뒤 정렬하는데, **소급 시즌은 투수 귀속이 얇다**
     * (CLAUDE.md §2-2: 2016년 표본 34/88 = 39%). 귀속 없는 타석이 하나 끼면
     * 다음 행이 그 다음다음 타석이 되어 **두 타석분의 RE 변화가 한 타석 값이 된다.**
     */
    const after = afterStateOf(cur, next);
    // ⚠**타자와 같은 커널을 쓴다.** 여기서 식을 새로 쓰면 두 지표가 서로 어긋난다(M1)
    const value = after === null
      ? null
      : paValue(
        re,
        { bases: cur.bases, outs: cur.outs },
        after.use === "next" ? { bases: next!.bases, outs: next!.outs } : null,
        cur.runs,
      );

    const key = cur.pitcherId + "|" + cur.teamCode;
    let entry = acc.get(key);
    if (entry === undefined) {
      entry = {
        playerId: cur.pitcherId,
        displayName: cur.pitcherName,
        teamCode: cur.teamCode,
        srp: 0,
        bf: 0,
        skipped: 0,
        outs: outsBy.get(key) ?? 0,
        srpPer9: null,
      };
      acc.set(key, entry);
    }

    if (value === null) {
      // RE에 없는 상태. **0으로 때우지 않는다** — 때우면 그 타석이 조용히 플러스가 된다
      entry.skipped += 1;
      continue;
    }
    // ⚠부호를 뒤집는다. 타자가 얻은 것이 투수가 내준 것이다
    entry.srp -= value;
    entry.bf += 1;
  }

  for (const e of acc.values()) {
    e.srpPer9 = srpPer9Of(e.srp, e.outs);
  }
  return [...acc.values()];
}

/** RE 행렬에 없는 상태를 미리 세어본다. 계산 전 건전성 확인용. */
export function missingStates(re: RunExpectancy, states: Iterable<{ bases: string; outs: number }>): number {
  let n = 0;
  for (const s of states) if (!re.matrix.has(stateKey(s.bases, s.outs))) n += 1;
  return n;
}

/**
 * 600타석 환산 SRC. ⚠**여기가 유일한 정의다**(M1).
 *
 * 리그를 넘어 이적한 선수는 리그별로 잰 SRC를 **더한 뒤** 이 함수를 다시 통과시킨다 —
 * 리그별로 낸 환산값을 더하면 분모가 두 번 세어진다.
 */
export function srcPer600Of(src: number, pa: number): number | null {
  return pa === 0 ? null : (src / pa) * 600;
}

/** 9이닝 환산 SRP. 분모는 **아웃**이지 상대 타자 수가 아니다 */
export function srpPer9Of(srp: number, outs: number): number | null {
  return outs === 0 ? null : (srp * 27) / outs;
}

/** 리그별로 잰 SRC의 합계. 환산값(`srcPer600`)은 합친 **뒤에** 낸다 */
export interface SrcTotals {
  src: number;
  pa: number;
  skipped: number;
}

/** 리그별로 잰 SRP의 합계. 9이닝 환산의 분모는 아웃이므로 함께 든다 */
export interface SrpTotals {
  srp: number;
  bf: number;
  skipped: number;
  outs: number;
}

/**
 * ⚠**리그를 넘어도 더한다. 덮어쓰지 않는다.**
 *
 * SRC는 그 리그의 득점기대 행렬로 잰 **런 수**라, 리그가 달라도 단위가 같고 더하는 것이 맞다.
 * 덮어쓰면 리그를 넘어 이적한 선수의 **절반이 조용히 사라진다**(2026-08-16 이중 검토 P0).
 */
export function addSrc(a: SrcTotals | undefined, b: SrcTotals): SrcTotals {
  return a === undefined
    ? { src: b.src, pa: b.pa, skipped: b.skipped }
    : { src: a.src + b.src, pa: a.pa + b.pa, skipped: a.skipped + b.skipped };
}

export function addSrp(a: SrpTotals | undefined, b: SrpTotals): SrpTotals {
  return a === undefined
    ? { srp: b.srp, bf: b.bf, skipped: b.skipped, outs: b.outs }
    : { srp: a.srp + b.srp, bf: a.bf + b.bf, skipped: a.skipped + b.skipped, outs: a.outs + b.outs };
}
