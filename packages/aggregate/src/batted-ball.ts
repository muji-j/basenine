/**
 * 타구 성향 — **땅볼/뜬공 · 방향 · 삼진 내역 · 내야안타**.
 *
 * ⚠**재료는 계속 있었다.** `pa_event.raw_pbp` 113,019행이 전부 채워져 있는데
 * 지금까지 아무 분석 코드도 읽지 않았다(2026-08-16 확인).
 *
 * ⚠**이름을 정확히 붙이는 것이 이 파일의 절반이다.**
 * - 땅볼 비율을 **「GB%」라고 부르면 거짓말**이 된다. GB%는 안타를 포함한 전 타구가 분모인데
 *   우리는 그 27.5%의 타구 종류를 **모른다**(비홈런 안타에 표기가 없다). 그래서 **아웃만**을 분모로 하고
 *   그 사실을 이름과 화면에 적는다.
 *   ⚠**「아웃」은 결과 분류가 아웃 계열인 타석만이다**(2026-09-25 감사 C13) — 실책 출루 · 野選 ·
 *   犠飛失策은 타자가 산 타구라 아웃이 아니다(`countsAsOut` · 정의서 §3.1).
 * - 삼진 내역은 **「헛스윙 유도율(SwStr%)」이 아니다.** 그건 투구 단위 데이터가 필요하고 우리에겐 없다.
 * - 방향은 **「타구가 떨어진 지점」이 아니라 「처리한 야수 기준」**이다. 시프트와 호수비가 섞인다.
 */
import { isInfield, readPbp, sideOf, unknownTokens } from "@bb-app/parser";
import { seasonNameExpr, seasonNameJoin } from "./season-name.ts";
import type { Db } from "@bb-app/store";
import { countsAsOut, isOutcome } from "@bb-app/parser";
import type { Outcome } from "@bb-app/parser";

export interface BattedBall {
  playerId: string;
  displayName: string;
  teamCode: string;
  /**
   * 땅볼 아웃. ⚠**아웃만이다** — 안타는 타구 종류를 모른다.
   * ⚠실책 출루 · 野選 · 犠飛失策은 **아웃이 아니다**(타자가 산다 · `countsAsOut`).
   */
  groundOuts: number;
  /** 공중 아웃(뜬공 + 직선타 + 파울플라이) */
  airOuts: number;
  /** 좌·중·우 (처리한 야수 기준). 분모는 셋의 합이다 */
  left: number;
  center: number;
  right: number;
  /** 내야 방향 타구와 그중 안타. **내야안타율의 분모는 「타수」가 아니라 내야 타구다** */
  infield: number;
  infieldHits: number;
  /** 삼진의 내역. 분모는 헛스윙+루킹이다(스리번트·낫아웃은 스윙 여부를 말하지 않는다) */
  swinging: number;
  looking: number;
}

const SQL = `
SELECT e.batter_id AS playerId, ${seasonNameExpr("p")} AS displayName,
       CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END AS teamCode,
       e.raw_pbp AS raw, e.outcome AS outcome
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = e.batter_id
${seasonNameJoin("e.batter_id", "g.season")}
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final'
`;

/**
 * 투수 쪽은 같은 로그를 투수 기준으로 센다.
 *
 * ⚠**치환을 빼먹으면 조용히 틀린 이름이 나간다.** 시즌명 조인을 `batter_id` 로 둔 채 두면
 * 투수 행에 그 타석 **타자의 이름**이 실리고, 값이 존재하므로 `COALESCE` 가 그걸 고른다 —
 * 빈 칸이 아니라 **다른 사람 이름**이라 화면만 보고는 모른다(2026-08-21 배선 중 실측).
 * 그래서 문자열을 손으로 적지 않고 **헬퍼가 만든 것을 그대로 치환**한다 — 헬퍼가 바뀌어도 안 깨진다.
 */
const SQL_PITCHER = SQL
  .replace("e.batter_id AS playerId", "e.pitcher_id AS playerId")
  .replace("JOIN player p ON p.player_id = e.batter_id", "JOIN player p ON p.player_id = e.pitcher_id")
  .replace(seasonNameJoin("e.batter_id", "g.season"), seasonNameJoin("e.pitcher_id", "g.season"))
  .replace("CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END",
    "CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END")
  + " AND e.pitcher_id IS NOT NULL";

/**
 * 안타인 결과. ⚠홈런은 내야안타가 될 수 없다.
 * ⚠**어휘를 추측하지 않는다.** `homerun` 은 소문자 r 이다(실측) —
 * `homeRun` 으로 쓰면 그 분기가 죽은 코드가 되고, 나중에 재사용할 때 조용히 틀린다.
 * 같은 실수를 `bunt.ts` 가 먼저 겪었다(피타율 .216 대 .237).
 */
const HIT: ReadonlySet<Outcome> = new Set<Outcome>(["single", "double", "triple", "homerun"]);

/**
 * 한 시즌의 타구 성향을 센다.
 *
 * @param forPitcher 투수 기준으로 셀 것인가
 * @throws 원문에 모르는 어휘가 있으면(M7). ⚠**실측 0건이므로 임계값 0으로 건다** —
 *   조용히 흘리면 타구 성향이 서서히 틀려지고 아무도 눈치채지 못한다
 */
export function battedBalls(
  db: Db,
  season: number,
  competition: string,
  through: string,
  forPitcher = false,
): BattedBall[] {
  const rows = db.raw.prepare(forPitcher ? SQL_PITCHER : SQL).all(season, competition, through) as unknown as {
    playerId: string; displayName: string; teamCode: string; raw: string; outcome: string;
  }[];

  const bad = unknownTokens(rows.map((r) => r.raw));
  if (bad.length > 0) {
    throw new RangeError(
      `타석 로그에 모르는 표기가 ${bad.length}종 있다 — 소스 표기가 바뀌었다: ${bad.slice(0, 5).join(" / ")}`,
    );
  }

  const out = new Map<string, BattedBall>();
  for (const r of rows) {
    const key = `${r.playerId}|${r.teamCode}`;
    let e = out.get(key);
    if (e === undefined) {
      e = {
        playerId: r.playerId, displayName: r.displayName, teamCode: r.teamCode,
        groundOuts: 0, airOuts: 0, left: 0, center: 0, right: 0,
        infield: 0, infieldHits: 0, swinging: 0, looking: 0,
      };
      out.set(key, e);
    }
    const f = readPbp(r.raw);
    if (f.strikeout === "swinging") e.swinging += 1;
    if (f.strikeout === "looking") e.looking += 1;
    if (f.field === null) continue;

    /**
     * ⚠**결과 분류를 모르는 타구는 멈춘다**(M7 · 2026-09-27 감사 C13).
     * 아웃을 「안타가 아니면」으로 가르던 시절에는 **모르는 결과가 조용히 아웃**이 됐다.
     * 목록(`countsAsOut`)으로 가르면 이번엔 **조용히 빠진다** — 어느 쪽이든 분모가 소리 없이 틀린다.
     * ⚠새 실패 모드가 아니다 — `bunt.ts` 의 타순 순회가 모르는 결과에서 이미 멈춘다.
     * 실측: 보유 전 시즌 `pa_event` 의 `unknown` **0건**.
     */
    if (!isOutcome(r.outcome) || r.outcome === "unknown") {
      throw new RangeError(
        `결과 분류를 모른다 — 타구가 아웃인지 알 수 없어 땅볼·공중 아웃에 넣지도 빼지도 못한다: ${r.raw}（${r.outcome}）`,
      );
    }
    const outcome: Outcome = r.outcome;

    /**
     * ⚠**번트는 방향 통계에서 뺀다.** 「어디로 치는가」를 말하는 값인데,
     * 희생번트는 작전이지 타격 성향이 아니다. 실측 1,672건 중 919건이 투수 앞이라
     * 번트를 많이 대는 타자의 「중앙」이 통째로 부풀어 오른다.
     */
    if (f.trajectory !== "bunt") {
      const side = sideOf(f.field);
      if (side === "left") e.left += 1;
      else if (side === "center") e.center += 1;
      else e.right += 1;
    }

    const isHit = HIT.has(outcome);
    /**
     * ⚠**「방향 토큰으로 시작한다」만으로는 M7이 안 지켜진다.**
     * `unknownTokens` 는 접두어만 보므로 `センター大飛球` 처럼 **종류 어휘만 바뀌면 통과**한다.
     * 그러면 실측 22,901건의 공중 아웃이 조용히 0이 되고 땅볼 비율이 1.000으로 튄다.
     *
     * 실측 불변식이 그 자리를 막는다: **종류를 모르는 인플레이 타구는 22,271/22,271이 전부 안타**다
     * (비홈런 안타에는 표기가 없다). 안타가 아닌데 종류를 모르면 어휘가 바뀐 것이다.
     */
    if (f.trajectory === "unknown" && !isHit) {
      throw new RangeError(
        `타구 종류를 못 읽었는데 안타도 아니다 — 소스 표기가 바뀌었다: ${r.raw}（${r.outcome}）`,
      );
    }
    /**
     * ⚠**아웃만 센다 — 「안타가 아니면 아웃」이 아니다**(2026-09-25 감사 C13 · 2026-09-27 수정).
     * 그 규칙은 **타자가 산 타구**까지 아웃에 넣었다 — 보유 타석 로그 전건(전 대회)에서 실책 출루 4,694
     * (땅볼 4,334 · 뜬공 322 · 직선 38) · 野選 309(전부 땅볼) · 犠飛失策 7(뜬공). 화면은 「ゴロアウト率の分母は
     * アウトだけ」라고 말하는데 분모가 그 말과 달랐고, 실책이 땅볼에 몰려 **땅볼 쪽으로 한 방향** 부풀었다.
     * 가르는 것은 `countsAsOut`(tokens.ts)이다 — **결과 분류 전량의 명시 목록**이라 새 분류가 생기면 컴파일이 멈춘다.
     * ⚠**併殺打 · 犠飛(잡힌 것)는 넣는다** — 타자가 아웃이다(로그상 그 타석의 아웃이 전건 1 이상 · tokens.ts).
     *   정의서 §3.1 은 0점 사건(삼진·범타·병살·野選·振逃·犠飛) 가운데 **野選·振逃 를 「타자가 살아 있다」로 따로 짚고**,
     *   실책 출루는 「타자가 아웃이 아니고」로 적는다. 犠打와 그 변형은 타구 종류가 번트라 어느 쪽에도 안 든다.
     * ⚠안타는 여전히 뺀다 — 타구 종류를 모르므로 분모에 넣으면 분자만 빠진 비율이 된다.
     */
    if (countsAsOut(outcome)) {
      if (f.trajectory === "ground") e.groundOuts += 1;
      else if (f.trajectory === "fly" || f.trajectory === "liner" || f.trajectory === "foulFly") e.airOuts += 1;
    }
    // ⚠내야안타의 분모는 **내야 타구**다. 「타수」로 하면 외야로 친 타구까지 분모에 들어간다
    if (isInfield(f.field)) {
      e.infield += 1;
      if (isHit && outcome !== "homerun") e.infieldHits += 1;
    }
  }
  return [...out.values()];
}
