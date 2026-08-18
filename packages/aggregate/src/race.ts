/**
 * **우승 경쟁** — 자력우승·매직 넘버·소멸 판정.
 *
 * ⚠**한 벌이다**(M1). 구단 페이지의 요약 띠와 순위 화면이 **같은 함수**를 부른다.
 * 이 저장소는 「같은 값이 화면마다 다르다」를 여러 번 밟았다 — 2026-08-18 감사에서만
 * 규정 판정이 그 형태로 두 번 나왔다(순위표는 「打率21位」, 그 선수 페이지는 「順位がつきません」).
 *
 * ⚠**직접대결 잔여를 예정 일정에서 세지 않는다.** 공표된 일정은 `치름 + 중지 + 미실시` 라
 * 中止 재편성 상태에 따라 실제 잔여와 어긋난다(실측 2026-08-18: 中日 +3 · 阪神 +1 · 広島 −1).
 * 대신 **규칙**에서 낸다 — NPB 는 대전 수가 고정이고, 실측(아카이브 전수)으로
 * 완결 7시즌 리그내 30쌍 전부 25 · 교류전 36쌍 전부 3, 2020 은 24 / 0 이었다(예외 0건).
 *
 * ```
 * 직접대결 잔여(A,B) = 규정 대전수(A,B) − 이미 치른 A:B 경기 수
 * ```
 *
 * 덤으로 `Σ_B 잔여(A,B) = regularSeasonGames − 소화` 가 **자동으로 성립**한다.
 */
import { regularSeasonGames } from "@bb-app/domain";

/** 대전 쌍의 키. ⚠**사전순으로 고정한다** — 순서를 안 맞추면 같은 쌍이 두 키가 되어 수가 반토막 난다 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface SeriesLengths {
  /** 같은 리그끼리의 대전 수 */
  intra: number;
  /** 교류전 대전 수 */
  inter: number;
}

/**
 * 그 시즌의 규정 대전 수를 **유도한다**. 하드코딩하지 않는다 — 2020 이 그 이유다.
 *
 * ```
 * 교류전 = 교류전 쌍의 최대 관측값
 * 리그내 = (regularSeasonGames − 교류전 × 6) / 5
 * ```
 *
 * ⚠**양의 정수가 아니면 `null` 이다.** 교류전이 진행 중인 5~6월에는 관측값이 1~2 라
 * `(143 − 6) / 5 = 27.4` 처럼 정수가 안 나온다 — 그게 **「아직 모른다」의 신호**가 된다.
 * 143 시즌에서 정수가 나오는 것은 교류전이 3 일 때뿐이고, 120 시즌에서는 0 일 때뿐이다.
 * **검산이 공짜로 붙는다.**
 * ⚠**유도한 상수를 이미 넘긴 쌍이 있으면 유도가 틀린 것**이므로 역시 `null` 이다.
 */
export function deriveSeriesLengths(o: {
  season: number;
  teams: readonly string[];
  leagueOf: (code: string) => string;
  playedPairs: ReadonlyMap<string, number>;
}): SeriesLengths | null {
  if (o.teams.length !== 12) return null;
  const byLeague = new Map<string, number>();
  for (const c of o.teams) byLeague.set(o.leagueOf(c), (byLeague.get(o.leagueOf(c)) ?? 0) + 1);
  if (byLeague.size !== 2 || [...byLeague.values()].some((n) => n !== 6)) return null;

  let maxIntra = 0;
  let maxInter = 0;
  for (let i = 0; i < o.teams.length; i += 1) {
    for (let j = i + 1; j < o.teams.length; j += 1) {
      const a = o.teams[i]!;
      const b = o.teams[j]!;
      const n = o.playedPairs.get(pairKey(a, b)) ?? 0;
      if (o.leagueOf(a) === o.leagueOf(b)) maxIntra = Math.max(maxIntra, n);
      else maxInter = Math.max(maxInter, n);
    }
  }

  const inter = maxInter;
  const intra = (regularSeasonGames(o.season) - inter * 6) / 5;
  if (!Number.isInteger(intra) || intra <= 0) return null;
  if (maxIntra > intra) return null;
  return { intra, inter };
}

export interface TeamRaceInput {
  teamCode: string;
  w: number;
  l: number;
  t: number;
  /** 소화 경기 수 */
  games: number;
}

export interface TeamRace {
  teamCode: string;
  /** 잔여 경기. **규정 경기수 − 소화** — 유도가 안 돼도 이건 안다 */
  remaining: number;
  /** 상대별 잔여. 유도가 안 되면 빈 지도 */
  h2hLeft: Map<string, number>;
  /** 자력우승 가능. 판정 불가면 `null`(M11) */
  selfPossible: boolean | null;
  /** 매직 넘버. **점등 조건을 못 채우면 `null`** */
  magic: number | null;
  /** 우승 가능성 소멸. 판정 불가면 `null` */
  eliminated: boolean | null;
}

export interface SeasonRace {
  /** `confirmed` 면 판정이 서 있다. `unknown` 이면 규정 대전수를 아직 모른다 */
  basis: "confirmed" | "unknown";
  series: SeriesLengths | null;
  teams: Map<string, TeamRace>;
}

/**
 * 勝率. ⚠**분모는 `勝 + 敗`** 다 — NPB 는 무승부를 뺀다.
 * 결정된 경기가 없으면 `null`(M11) — 0 으로 두면 「전패」로 읽힌다.
 */
function pct(w: number, l: number): number | null {
  return w + l === 0 ? null : w / (w + l);
}

/**
 * 우승 경쟁을 판정한다.
 *
 * ⚠**승률로 판정하고 매직만 승수식을 쓴다.** NPB 순위는 승률(`勝/(勝+敗)`)로 정하는데
 * 매직 넘버는 관례가 승수식이다. 그 차이를 **화면이 말해야 한다**(M3).
 */
export function seasonRace(o: {
  season: number;
  teams: readonly TeamRaceInput[];
  leagueOf: (code: string) => string;
  playedPairs: ReadonlyMap<string, number>;
}): SeasonRace {
  const total = regularSeasonGames(o.season);
  const codes = o.teams.map((x) => x.teamCode);
  const series = deriveSeriesLengths({
    season: o.season,
    teams: codes,
    leagueOf: o.leagueOf,
    playedPairs: o.playedPairs,
  });

  const byCode = new Map(o.teams.map((x) => [x.teamCode, x]));
  const out = new Map<string, TeamRace>();

  /** 그 팀이 잔여를 전승했을 때의 최종 승률 */
  const bestPct = (x: TeamRaceInput): number | null => pct(x.w + (total - x.games), x.l);
  /** 그 팀이 잔여를 전패했을 때의 최종 승률 */
  const worstPct = (x: TeamRaceInput): number | null => pct(x.w, x.l + (total - x.games));

  for (const me of o.teams) {
    const remaining = total - me.games;
    const h2hLeft = new Map<string, number>();
    if (series !== null) {
      for (const other of codes) {
        if (other === me.teamCode) continue;
        const full = o.leagueOf(other) === o.leagueOf(me.teamCode) ? series.intra : series.inter;
        h2hLeft.set(other, full - (o.playedPairs.get(pairKey(me.teamCode, other)) ?? 0));
      }
    }

    let selfPossible: boolean | null = null;
    let eliminated: boolean | null = null;
    const mine = bestPct(me);

    if (series !== null && mine !== null) {
      selfPossible = true;
      eliminated = false;
      for (const other of codes) {
        if (other === me.teamCode) continue;
        const b = byCode.get(other)!;
        const h = h2hLeft.get(other) ?? 0;
        /**
         * ⚠**내가 전승하면 상대는 나와의 잔여를 전패한다.** 그걸 빼지 않으면
         * 상대의 최대 승수를 실제보다 크게 잡아 자력을 과소평가한다.
         */
        const bMaxWins = b.w + (total - b.games) - h;
        const bBest = pct(bMaxWins, b.l + h);
        if (bBest !== null && bBest > mine) selfPossible = false;
        // 상대가 **전패해도** 내 최선을 넘으면 소멸이다
        const bWorst = worstPct(b);
        if (bWorst !== null && bWorst > mine) eliminated = true;
      }
    }

    out.set(me.teamCode, { teamCode: me.teamCode, remaining, h2hLeft, selfPossible, magic: null, eliminated });
  }

  /**
   * 매직 넘버.
   *
   * ⚠**점등 조건은 「다른 모든 팀의 자력우승 소멸」이다.** 그것이 매직의 정의다 —
   * 조건을 안 지킨 수를 「マジック」라고 부르면 그건 다른 것이고, 이 저장소는
   * 자체 지표에 공식과 다른 이름을 쓰기로 이미 정해 뒀다(SRC·SRP).
   */
  if (series !== null) {
    for (const me of o.teams) {
      const others = codes.filter((c) => c !== me.teamCode);
      const allGone = others.every((c) => out.get(c)!.selfPossible === false);
      if (!allGone) continue;
      let magic = 0;
      for (const c of others) {
        const b = byCode.get(c)!;
        magic = Math.max(magic, b.w + (total - b.games) - me.w + 1);
      }
      out.get(me.teamCode)!.magic = Math.max(0, magic);
    }
  }

  return { basis: series === null ? "unknown" : "confirmed", series, teams: out };
}
