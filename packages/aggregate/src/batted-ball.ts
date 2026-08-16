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
 * - 삼진 내역은 **「헛스윙 유도율(SwStr%)」이 아니다.** 그건 투구 단위 데이터가 필요하고 우리에겐 없다.
 * - 방향은 **「타구가 떨어진 지점」이 아니라 「처리한 야수 기준」**이다. 시프트와 호수비가 섞인다.
 */
import { isInfield, readPbp, sideOf, unknownTokens } from "@bb-app/parser";
import type { Db } from "@bb-app/store";

export interface BattedBall {
  playerId: string;
  displayName: string;
  teamCode: string;
  /** 땅볼 아웃. ⚠**아웃만이다** — 안타는 타구 종류를 모른다 */
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
SELECT e.batter_id AS playerId, p.display_name AS displayName,
       CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END AS teamCode,
       e.raw_pbp AS raw, e.outcome AS outcome
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = e.batter_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final'
`;

/** 투수 쪽은 같은 로그를 투수 기준으로 센다 */
const SQL_PITCHER = SQL
  .replace("e.batter_id AS playerId", "e.pitcher_id AS playerId")
  .replace("JOIN player p ON p.player_id = e.batter_id", "JOIN player p ON p.player_id = e.pitcher_id")
  .replace("CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END",
    "CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END")
  + " AND e.pitcher_id IS NOT NULL";

/** 안타인 결과. ⚠홈런은 내야안타가 될 수 없다 */
const HIT = new Set(["single", "double", "triple", "homeRun"]);

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

    const side = sideOf(f.field);
    if (side === "left") e.left += 1;
    else if (side === "center") e.center += 1;
    else e.right += 1;

    const isHit = HIT.has(r.outcome);
    // ⚠**아웃만 센다.** 안타는 타구 종류를 모르므로 분모에 넣으면 분자만 빠진 비율이 된다
    if (!isHit) {
      if (f.trajectory === "ground") e.groundOuts += 1;
      else if (f.trajectory === "fly" || f.trajectory === "liner" || f.trajectory === "foulFly") e.airOuts += 1;
    }
    // ⚠내야안타의 분모는 **내야 타구**다. 「타수」로 하면 외야로 친 타구까지 분모에 들어간다
    if (isInfield(f.field)) {
      e.infield += 1;
      if (isHit && r.outcome !== "homeRun") e.infieldHits += 1;
    }
  }
  return [...out.values()];
}
