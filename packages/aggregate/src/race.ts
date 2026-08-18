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
 * `Σ_B 잔여(A,B) = regularSeasonGames − 소화` 는 **자동으로 성립하지 않는다 — 검사해서 확인한다.**
 * ⚠예전 주석은 「자동으로 성립한다」였는데 **거짓이다.** 그 등식은 `games` 와 `playedPairs` 가
 * 같은 질의에서 나올 때만 성립하고 둘은 별개 입력이다. 이 태스크의 첫 판이 정확히 그 반례로 반려됐다
 * (대전표는 118 인데 `games` 는 120 → 합 25 대 잔여 23, 실측 2026-08-19).
 * 어긋난 채로 흘리면 그 팀의 틀린 h2h·최대승수가 **다른 팀 판정에도 섞여 들어간다** —
 * 그래서 팀 하나가 아니라 **시즌 전체를 `basis: "unknown"`** 으로 떨어뜨린다(M7·M11).
 */
import { regularSeasonGames } from "@bb-app/domain";
import { bestPct, pctKey, winPct, worstPct } from "./standings.ts";

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
  /**
   * 잔여 경기. **규정 경기수 − 소화** — 유도가 안 돼도 이건 안다.
   * ⚠**`basis` 가 `unknown` 이면 음수일 수 있다**(소화가 규정을 넘게 세어진 입력).
   * 그 자체가 신호다 — `unknown` 인 시즌의 이 값을 화면에 그대로 쓰지 마라.
   */
  remaining: number;
  /** 상대별 잔여. **리그를 가르지 않는다**(교류전 잔여도 잔여다). 유도가 안 되면 빈 지도 */
  h2hLeft: Map<string, number>;
  /** 자력우승 가능. 판정 불가면 `null`(M11) */
  selfPossible: boolean | null;
  /** 매직 넘버. **점등 조건을 못 채우면 `null`** */
  magic: number | null;
  /** 우승 가능성 소멸. 판정 불가면 `null` */
  eliminated: boolean | null;
}

export interface SeasonRace {
  /**
   * `confirmed` 면 판정이 서 있다.
   * `unknown` 이면 **규정 대전수를 모르거나 입력이 스스로 어긋난다** — 그때는 판정을 내지 않는다.
   */
  basis: "confirmed" | "unknown";
  series: SeriesLengths | null;
  teams: Map<string, TeamRace>;
}

/**
 * 우승 경쟁을 판정한다.
 *
 * ⚠**승률로 판정하고 매직만 승수식을 쓴다.** NPB 순위는 승률(`勝/(勝+敗)`)로 정하는데
 * 매직 넘버는 관례가 승수식이다. 그 차이를 **화면이 말해야 한다**(M3).
 *
 * ⚠**리그 안에서만 겨룬다.** 페넌트는 센트럴·퍼시픽이 따로 간다 —
 * 12팀 전체로 비교하면 **한 리그의 독주팀이 다른 리그 전체를 소멸시킨다.**
 * 실측(2026-08-19, 이 결함이 있던 판): 퍼시픽 `h` 85승50패 독주 + 센트럴 접전(`g` 72-63 선두)에서
 * **센트럴 6팀 전부가 `self false · elim true · magic null`** 로 나왔다.
 * 선두 팀 옆에 「消滅」이라고 쓰는 화면이 나올 뻔했다.
 * ⚠**`h2hLeft` 는 리그를 안 가른다** — 교류전 잔여가 들어가야 `Σ 잔여 = 잔여` 가 성립한다.
 * 가르는 것은 **비교 두 곳뿐**이고 돌려주는 지도는 12팀 전부를 담는다.
 *
 * ⚠**동률은 「가능성 있음」이다.** 비교는 전부 `pctKey`(표시 자릿수 = 소수 3자리)에서 한다 —
 * 배정밀도로 가르면 순위표는 「同」이라고 쓰는데 옆 배지는 「消滅」이라고 쓰는 상태가 된다.
 * 실측: `g` 최선 `80/138 = .57971` · `t` 최악 `83/143 = .58042` → **둘 다 `.580` 인데
 * 원값 비교에서는 `g.eliminated = true`** 가 나왔다. 규칙은 `standings.ts` 의 `pctKey` 한 벌이다(M1).
 */
export function seasonRace(o: {
  season: number;
  teams: readonly TeamRaceInput[];
  leagueOf: (code: string) => string;
  playedPairs: ReadonlyMap<string, number>;
}): SeasonRace {
  const total = regularSeasonGames(o.season);
  const codes = o.teams.map((x) => x.teamCode);
  const derived = deriveSeriesLengths({
    season: o.season,
    teams: codes,
    leagueOf: o.leagueOf,
    playedPairs: o.playedPairs,
  });

  const byCode = new Map(o.teams.map((x) => [x.teamCode, x]));
  const out = new Map<string, TeamRace>();

  /** 팀별 상대 잔여. 유도가 됐을 때만 채운다 — 리그를 가르지 않는다(교류전 잔여도 잔여다) */
  const h2hByTeam = new Map<string, Map<string, number>>();
  if (derived !== null) {
    for (const me of o.teams) {
      const m = new Map<string, number>();
      for (const other of codes) {
        if (other === me.teamCode) continue;
        const full = o.leagueOf(other) === o.leagueOf(me.teamCode) ? derived.intra : derived.inter;
        m.set(other, full - (o.playedPairs.get(pairKey(me.teamCode, other)) ?? 0));
      }
      h2hByTeam.set(me.teamCode, m);
    }
  }

  /**
   * ⚠**입력이 스스로 앞뒤가 맞는지 검사한다.** 성적(`w/l/t/games`)과 대전표(`playedPairs`)는
   * **별개 입력**이라 어긋날 수 있다 — 中止 재편성으로 실측 어긋남이 이미 관측돼 있다
   * (2026-08-18: 中日 +3 · 阪神 +1 · 広島 −1).
   *
   * 둘을 본다.
   * 1. `w + l + t === games` — 공짜 검산이다. 지금까지 `t` 는 선언만 되고 아무 데서도 안 읽혔다.
   * 2. `Σ 상대별 잔여 === total − games` — 어긋나면 대전표와 성적이 다른 세계의 것이다.
   *
   * ⚠**`games > total`(잔여 음수)을 따로 검사하지 않는다.** 2번이 이미 잡기 때문이다 —
   * 상대별 잔여는 음수가 될 수 없고(`deriveSeriesLengths` 가 「유도 상수를 넘긴 쌍」을 거른다)
   * 각 쌍의 잔여가 규정을 못 넘으므로 `0 ≤ Σ ≤ total` 이다. 따라서 2번이 성립하면
   * `0 ≤ games ≤ total` 도 성립한다. 검사를 하나 더 두면 **어떤 시험으로도 단독으로 잴 수 없는
   * 죽은 가지**가 된다 — 이 라운드가 정확히 「아무것도 안 재는 코드」를 걷어내는 라운드다.
   *
   * ⚠**어긋난 팀만 `null` 로 두지 않는다.** 그 팀의 틀린 h2h·최대승수가 다른 팀 판정의 입력으로
   * 들어가기 때문에 **시즌 전체**를 `unknown` 으로 떨어뜨린다(M11 — 모르는 것을 아는 척하지 않는다).
   */
  const agrees =
    derived !== null &&
    o.teams.every((x) => {
      if (x.w + x.l + x.t !== x.games) return false;
      let sum = 0;
      for (const v of h2hByTeam.get(x.teamCode)!.values()) sum += v;
      return sum === total - x.games;
    });
  const series = agrees ? derived : null;

  for (const me of o.teams) {
    const remaining = total - me.games;
    // ⚠유도가 안 됐거나 입력이 어긋나면 **빈 지도**다 — 틀린 잔여를 흘리는 것이 최악이다(M7)
    const h2hLeft = series !== null ? h2hByTeam.get(me.teamCode)! : new Map<string, number>();

    let selfPossible: boolean | null = null;
    let eliminated: boolean | null = null;
    const mine = pctKey(bestPct(me.w, me.l, remaining));

    if (series !== null && mine !== null) {
      selfPossible = true;
      eliminated = false;
      for (const other of codes) {
        if (other === me.teamCode) continue;
        // ⚠**다른 리그는 우승 경쟁 상대가 아니다** — 이걸 안 걸러 센트럴 6팀이 전부 소멸로 나왔다
        if (o.leagueOf(other) !== o.leagueOf(me.teamCode)) continue;
        const b = byCode.get(other)!;
        const h = h2hLeft.get(other) ?? 0;
        /**
         * ⚠**내가 전승하면 상대는 나와의 잔여를 전패한다.** 그걸 빼지 않으면
         * 상대의 최대 승수를 실제보다 크게 잡아 자력을 과소평가한다.
         * ⚠여기는 `bestPct` 를 쓰지 않는다 — 잔여에서 **나와의 맞대결을 뺀 수**로 승패를 나눠야 한다.
         * `Σ 잔여 = 잔여` 를 검사했으므로 `h ≤ 상대 잔여` 이고 승수가 음수로 내려가지 않는다.
         */
        const bMaxWins = b.w + (total - b.games) - h;
        const bBest = pctKey(winPct(bMaxWins, b.l + h));
        if (bBest !== null && bBest > mine) selfPossible = false;
        // 상대가 **전패해도** 내 최선을 넘으면 소멸이다
        const bWorst = pctKey(worstPct(b.w, b.l, total - b.games));
        if (bWorst !== null && bWorst > mine) eliminated = true;
      }
    }

    out.set(me.teamCode, { teamCode: me.teamCode, remaining, h2hLeft, selfPossible, magic: null, eliminated });
  }

  /**
   * 매직 넘버.
   *
   * ⚠**점등 조건은 「같은 리그 다른 모든 팀의 자력우승 소멸」이다.** 그것이 매직의 정의다 —
   * 조건을 안 지킨 수를 「マジック」라고 부르면 그건 다른 것이고, 이 저장소는
   * 자체 지표에 공식과 다른 이름을 쓰기로 이미 정해 뒀다(SRC·SRP).
   *
   * ⚠**내 자력이 살아 있는지도 본다.** 리그 안에서 「다른 전원이 자력소멸이면 나는 자력이 산다」가
   * 성립하기는 한다 — 최선승률이 가장 높은 팀은 다른 팀에게 자력소멸당할 수 없고,
   * 그 팀을 소멸시킬 수 있는 것은 나뿐이므로 내 최선이 그 팀보다 높아지기 때문이다.
   * 그래도 **명시적으로 검사한다**: 이 성질은 비교식(동률 규칙·향후 타이브레이커)에 의존하고,
   * 깨졌을 때 나오는 것이 「소멸한 팀의 매직」이라는 최악의 거짓말이기 때문이다.
   */
  if (series !== null) {
    for (const me of o.teams) {
      const mineRace = out.get(me.teamCode)!;
      if (mineRace.selfPossible !== true) continue;
      const others = codes.filter((c) => c !== me.teamCode && o.leagueOf(c) === o.leagueOf(me.teamCode));
      // ⚠`every` 는 빈 배열에서 참이다 — 상대가 없는데 「우승 확정(매직 0)」이 나가면 안 된다
      if (others.length === 0) continue;
      if (!others.every((c) => out.get(c)!.selfPossible === false)) continue;
      /**
       * ⚠**초기값이 `0` 이면 아래 클램프가 죽은 코드가 된다.** 그 죽은 클램프 때문에
       * 「`magic >= 0`」이 **어떤 식을 넣어도 참인 단언**이 되어 시험이 뮤테이션을 하나도 못 잡았다
       * (실측 2026-08-19: 그 픽스처의 원식은 `20 + 8 − 130 + 1 = −101` 이고 값은 0 이었다).
       * 초기값을 `-Infinity` 로 두면 클램프가 **실제로 일하는 코드**가 된다.
       */
      let magic = -Infinity;
      for (const c of others) {
        const b = byCode.get(c)!;
        magic = Math.max(magic, b.w + (total - b.games) - me.w + 1);
      }
      // 0 = **이미 우승 확정**. 음수를 그대로 내보내면 「マジック −29」가 화면에 나간다
      mineRace.magic = Math.max(0, magic);
    }
  }

  return { basis: series === null ? "unknown" : "confirmed", series, teams: out };
}
