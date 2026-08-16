/**
 * 팀 순위표.
 *
 * ## ⚠이 표에서 조용히 틀리기 쉬운 것 넷
 *
 * 1. **勝率의 분모에서 무승부를 뺀다.** NPB의 규칙이다 — `勝 ÷ (勝 + 敗)`.
 *    무승부를 분모에 넣으면(MLB식) 무승부가 많은 팀만 순위가 내려간다.
 *    2026 시즌에 서 팀 중 무승부가 4경기인 팀과 0경기인 팀이 같이 있으므로 실제로 순위가 바뀐다.
 * 2. **팀 승패를 투수의 승패 표기로 세지 않는다.** 무승부에는 승리투수가 없어
 *    그렇게 세면 무승부가 통째로 사라진다. **득점 비교로만** 판정한다.
 *    (2026-08-15에 실제로 이 방식으로 대조해 ノーゲーム 3경기의 오염을 찾아냈다.)
 * 3. **交流戦도 리그 순위에 들어간다.** 정규 시즌 경기는 상대 리그전이라도 전부 센다 —
 *    빼면 어느 사이트와도 맞지 않는다.
 * 4. **동률 처리 규칙을 명시한다**(M3). 규칙이 코드에만 있으면 아무도 검증할 수 없다.
 *
 * ## 동률 처리
 *
 * NPB 협약의 순서는 ①当該球団間の対戦成績 ②前年度順位다.
 * ⚠**우리는 ①까지만 적용하고, 그래도 같으면 「同順位」로 두고 그 사실을 화면에 적는다.**
 * ②를 쓸 수 없는 이유는 소급 범위가 2시즌뿐이라(2025~) **2025년의 전년도 순위가 존재하지 않기** 때문이다.
 * 없는 근거로 순위를 가르는 것보다, 가르지 못한다고 말하는 편이 정직하다.
 */
import type { Db } from "@bb-app/store";
import type { BattingLine, PitchingLine } from "@bb-app/metrics";

export interface TeamRecord {
  teamCode: string;
  league: string;
  games: number;
  w: number;
  l: number;
  t: number;
  /** 勝率. **분모는 `w + l`**(무승부 제외). 경기가 없으면 null */
  pct: number | null;
  /** 1위와의 게임 차. 1위는 0 */
  gamesBehind: number;
  /** 得点·失点 */
  rf: number;
  ra: number;
  /** ホーム/ビジター */
  home: { w: number; l: number; t: number };
  away: { w: number; l: number; t: number };
  /** 直近10試合. 경기가 10개 미만이면 있는 만큼 */
  last10: { w: number; l: number; t: number };
  /** 팀 타격·투구 합계. **지표는 호출자가 `@bb-app/metrics`로 만든다**(M1) */
  batting: BattingLine;
  pitching: PitchingLine;
  /** 순위. **동률이면 같은 수가 붙는다** */
  rank: number;
  /**
   * 이 팀이 동률 상태인가. ⚠**동률을 조용히 순서로 가르지 않는다** —
   * 화면이 「同」이라고 말할 수 있어야 한다
   */
  tiedRank: boolean;
}

interface SideRow {
  teamCode: string;
  gameDate: string;
  isHome: number;
  rf: number;
  ra: number;
}

/**
 * ⚠**한 경기를 두 행으로 편다.** 팀 관점의 표를 만들려면 원정/홈을 각각 한 줄로 봐야 하고,
 * 그래야 홈/원정 성적과 직전 10경기를 같은 코드로 셀 수 있다.
 */
const SIDES_SQL = `
SELECT away_code AS teamCode, game_date AS gameDate, 0 AS isHome,
       away_runs AS rf, home_runs AS ra
FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
  AND away_runs IS NOT NULL AND home_runs IS NOT NULL
UNION ALL
SELECT home_code, game_date, 1, home_runs, away_runs
FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
  AND away_runs IS NOT NULL AND home_runs IS NOT NULL
`;

/** 팀 사이 맞대결 — 동률일 때만 쓴다 */
const HEAD_SQL = `
SELECT away_code AS a, home_code AS b, away_runs AS ar, home_runs AS br
FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
  AND away_runs IS NOT NULL AND home_runs IS NOT NULL
`;

const TEAM_BATTING_SQL = `
SELECT CASE WHEN b.side = 'away' THEN g.away_code ELSE g.home_code END AS teamCode,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.h) AS h, SUM(b.d2) AS "double",
       SUM(b.d3) AS triple, SUM(b.hr) AS hr, SUM(b.bb) AS bb, SUM(b.ibb) AS ibb,
       SUM(b.hbp) AS hbp, SUM(b.sf) AS sf, SUM(b.sh) AS sh, SUM(b.so) AS so, SUM(b.roe) AS roe
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY teamCode
`;

const TEAM_PITCHING_SQL = `
SELECT CASE WHEN p.side = 'away' THEN g.away_code ELSE g.home_code END AS teamCode,
       SUM(p.outs) AS outs, SUM(p.bf) AS bf, SUM(p.h) AS h, SUM(p.hr) AS hr,
       -- ⚠박스스코어에 투수의 고의사구 열이 없다. **0을 넣는 것이 아니라 「없음」을 0으로 접는 것**이고,
       -- 집계(season.ts)도 같은 선택을 한다 — 두 곳이 다르면 팀 합계와 선수 합계가 어긋난다
       SUM(p.bb) AS bb, 0 AS ibb, SUM(p.hbp) AS hbp, SUM(p.so) AS so,
       SUM(p.er) AS er, SUM(p.runs) AS r
FROM pitching_line p
JOIN game g ON g.game_id = p.game_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY teamCode
`;

/** 直近何試合を「直近」とみなすか */
export const RECENT_GAMES = 10;

interface Tally {
  w: number;
  l: number;
  t: number;
}

function empty(): Tally {
  return { w: 0, l: 0, t: 0 };
}

function add(t: Tally, rf: number, ra: number): void {
  if (rf > ra) t.w += 1;
  else if (rf < ra) t.l += 1;
  else t.t += 1;
}

/**
 * 勝率 — **분모에서 무승부를 뺀다**(NPB 규칙).
 *
 * ⚠`w + l`이 0이면 null이다. **0을 돌려주면 「승률 0할」이 되어 최하위로 정렬된다** —
 * 「아직 결판난 경기가 없다」와 「전패」는 다르다(M11).
 */
export function winPct(w: number, l: number): number | null {
  return w + l === 0 ? null : w / (w + l);
}

/**
 * 순위 비교에 쓰는 **표시 자릿수의 승률**.
 *
 * ⚠**배정밀도로 비교하면 화면에 같은 `.563`인 두 팀이 코드에서는 다른 값이 된다.**
 * 그러면 「同」 표시 없이 순서가 갈리고, 독자는 같은 승률인데 왜 위아래인지 알 수 없다.
 * NPB의 표시·판정 단위는 소수 3자리이므로 **그 자리에서 비교한다.**
 *
 * ⚠**협약이 반올림 후 비교인지 원값 비교인지는 확인하지 못했다**(2026-08-16 미결).
 * 확인 전까지는 「화면과 같은 기준으로 가른다」를 규칙으로 삼는다 — 적어도 화면이 모순되지 않는다.
 * 실측: 2025·2026 × 2리그에서 이 차이로 순위가 갈린 사례 **0건**.
 */
export function pctKey(pct: number | null): number | null {
  return pct === null ? null : Math.round(pct * 1000) / 1000;
}

/** ゲーム差 = ((1위 승 − 승) + (패 − 1위 패)) ÷ 2 */
export function gamesBehind(top: Tally, me: Tally): number {
  return (top.w - me.w + (me.l - top.l)) / 2;
}

/**
 * 팀 사이 맞대결 승률. 동률 처리의 1단계.
 *
 * @returns `a`가 앞서면 양수, `b`가 앞서면 음수, 같거나 대전이 없으면 0
 */
function headToHead(games: readonly { a: string; b: string; ar: number; br: number }[], a: string, b: string): number {
  const t = empty();
  for (const g of games) {
    if (g.a === a && g.b === b) add(t, g.ar, g.br);
    else if (g.a === b && g.b === a) add(t, g.br, g.ar);
  }
  const p = winPct(t.w, t.l);
  if (p === null) return 0;
  return p > 0.5 ? 1 : p < 0.5 ? -1 : 0;
}

export function teamStandings(
  db: Db,
  season: number,
  leagueOf: (teamCode: string) => string,
  competition = "regular",
  through = "9999-12-31",
): TeamRecord[] {
  const sides = db.raw
    .prepare(SIDES_SQL)
    .all(season, competition, through, season, competition, through) as unknown as SideRow[];
  if (sides.length === 0) return [];

  const bat = db.raw.prepare(TEAM_BATTING_SQL).all(season, competition, through) as unknown as ({
    teamCode: string;
  } & BattingLine)[];
  const pit = db.raw.prepare(TEAM_PITCHING_SQL).all(season, competition, through) as unknown as ({
    teamCode: string;
  } & PitchingLine)[];
  const batOf = new Map(bat.map((b) => [b.teamCode, b]));
  const pitOf = new Map(pit.map((p) => [p.teamCode, p]));

  const head = db.raw.prepare(HEAD_SQL).all(season, competition, through) as unknown as {
    a: string;
    b: string;
    ar: number;
    br: number;
  }[];

  const byTeam = new Map<string, SideRow[]>();
  for (const s of sides) {
    const list = byTeam.get(s.teamCode);
    if (list === undefined) byTeam.set(s.teamCode, [s]);
    else list.push(s);
  }

  const rows: TeamRecord[] = [];
  for (const [teamCode, list] of byTeam) {
    // ⚠**날짜순으로 정렬해 두고 뒤에서 센다.** SQL의 UNION ALL은 순서를 보장하지 않으므로,
    // 정렬하지 않으면 「直近10試合」이 아무 10경기가 된다
    list.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
    const total = empty();
    const home = empty();
    const away = empty();
    let rf = 0;
    let ra = 0;
    for (const s of list) {
      add(total, s.rf, s.ra);
      add(s.isHome === 1 ? home : away, s.rf, s.ra);
      rf += s.rf;
      ra += s.ra;
    }
    const last10 = empty();
    for (const s of list.slice(-RECENT_GAMES)) add(last10, s.rf, s.ra);

    const b = batOf.get(teamCode);
    const p = pitOf.get(teamCode);
    rows.push({
      teamCode,
      league: leagueOf(teamCode),
      games: list.length,
      w: total.w,
      l: total.l,
      t: total.t,
      pct: winPct(total.w, total.l),
      gamesBehind: 0,
      rf,
      ra,
      home,
      away,
      last10,
      batting: b ?? emptyBatting(),
      pitching: p ?? emptyPitching(),
      rank: 0,
      tiedRank: false,
    });
  }

  // 리그별로 순위를 매긴다 — 센트럴과 퍼시픽은 다른 표다
  const out: TeamRecord[] = [];
  for (const league of [...new Set(rows.map((r) => r.league))]) {
    const group = rows.filter((r) => r.league === league);
    group.sort((a, b) => {
      // ⚠**표시 자릿수로 비교한다.** 배정밀도로 가르면 화면에 같은 .563인 두 팀의
      // 순서가 보이지 않는 소수점 뒤에서 갈린다
      const pa = pctKey(a.pct) ?? -1;
      const pb = pctKey(b.pct) ?? -1;
      if (pa !== pb) return pb - pa;
      // ⚠동률의 1단계는 **당사자 간 대전 성적**이다(NPB 협약)
      const h = headToHead(head, a.teamCode, b.teamCode);
      if (h !== 0) return -h;
      // ⚠여기서 멈춘다. ②前年度順位는 소급 범위가 없어 쓸 수 없다 —
      // 표시 순서는 팀 코드로 고정해 **매번 같은 순서**가 나오게만 한다
      return a.teamCode.localeCompare(b.teamCode);
    });

    const top = group[0];
    for (const [i, r] of group.entries()) {
      r.gamesBehind = top === undefined ? 0 : gamesBehind({ w: top.w, l: top.l, t: top.t }, { w: r.w, l: r.l, t: r.t });
      // 동률이면 같은 순위를 준다
      const prev = group[i - 1];
      r.rank =
        prev !== undefined &&
        pctKey(prev.pct) === pctKey(r.pct) &&
        headToHead(head, prev.teamCode, r.teamCode) === 0
          ? prev.rank
          : i + 1;
      r.tiedRank = false;
    }
    // ⚠**같은 순위가 둘 이상일 때만 「同」이라고 말한다.** 한 팀에만 붙이면 뜻이 없다
    const counts = new Map<number, number>();
    for (const r of group) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
    for (const r of group) r.tiedRank = (counts.get(r.rank) ?? 0) > 1;
    out.push(...group);
  }
  return out;
}

function emptyBatting(): BattingLine {
  return { pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0 };
}

function emptyPitching(): PitchingLine {
  return { outs: 0, bf: 0, h: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, er: 0, r: 0 };
}
