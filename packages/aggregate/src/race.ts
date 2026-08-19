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
   * 잔여 경기. **규정 경기수 − 소화.** 판정 불가면 `null`(M11).
   *
   * ⚠**이전 판은 `number` 였고 음수를 그대로 내보냈다**(2026-08-19 재리뷰 Important A).
   * 실측 재현: 전 팀 `{w:75, l:70, t:3, games:148}` → `basis "unknown"` · `remaining −5`.
   * 숫자라는 것은 **「안다」는 선언**이다 — 방금 「믿을 수 없다」고 판정한 입력으로 계산한 값을
   * 숫자로 내보내면 안 된다. 주석에 「화면에 그대로 쓰지 마라」라고 적는 것은 타입이 아니다.
   * 소비자가 `残り${remaining}試合` 를 쓰거나 `Math.max(0, remaining)` 로 접으면 **조용히 틀린다.**
   * ⚠이 저장소는 음수 잔여를 화면까지 내보낸 전례가 이미 있다(`home-page.ts:15` — 팀당 144~153).
   *
   * ⚠**`basis` 가 `unknown` 이라고 해서 `null` 인 것은 아니다.** 숫자가 되는 조건은
   * **그 팀의 성적만 보고 답할 수 있는 것**뿐이다 — `w + l + t === games` 이고 `0 ≤ games ≤ 규정`.
   * 교류전이 안 끝나 규정 대전수를 유도하지 못하는 5월에는 시즌이 `unknown` 이어도
   * 잔여는 정말로 안다(`143 − 56 = 87`). 그 자리까지 `null` 로 만들면 아는 것을 버리는 것이다.
   */
  remaining: number | null;
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
   *
   * ⚠**`unknown` 만으로는 「아직 모름(정상)」과 「입력이 어긋남(버그)」을 못 가른다.**
   * 어느 쪽인지는 `series` 와 `disagreed` 로 읽는다 — 아래 표를 보라.
   */
  basis: "confirmed" | "unknown";
  /**
   * 유도된 규정 대전 수. **유도 자체가 실패했을 때만 `null` 이다.**
   *
   * ⚠**어긋난 입력 때문에 `null` 로 덮어쓰지 않는다**(2026-08-19 재리뷰 Important C).
   * 이전 판은 `agrees === false` 일 때 이 값을 지워서 **유도는 성공했다는 사실까지 없앴다** —
   * 그래서 반환값만 보면 5월(정상)과 파이프라인 버그가 **완전히 같은 모양**이었다.
   * M7 의 절반(빈 값으로 흘리지 않기)은 지켰는데 나머지 절반(**알아챌 수 있게 하기**)이 없었다.
   * ⚠이 저장소는 「조용히 사라진 것을 그 시즌은 원래 그렇다로 읽는」 사고를 이미 겪었다
   * (2018 오릭스 148경기가 「모르는 팀 코드」로 실패 — 그대로 뒀으면 성적이 화면에서 사라진 채였다).
   *
   * ```
   * basis      series  disagreed   무엇인가
   * confirmed  값       []          판정이 서 있다
   * unknown    null    []          아직 유도할 수 없다(교류전 미완 등) — **정상**
   * unknown    값       [코드…]     성적과 대전표가 어긋난다 — **버그. 파이프라인을 봐라**
   * unknown    null    [코드…]     유도도 안 되고 성적도 스스로 어긋난다 — **복합 실패.
   *                                교류전 미완(정상)과 팀별 자체 모순(버그)이 겹쳤다**
   *                                (2026-08-19 3차 재리뷰 Important — 리뷰 프로브로 재현)
   * ```
   */
  series: SeriesLengths | null;
  /**
   * 성적(`w/l/t/games`)이 스스로 어긋나거나(`w+l+t≠games` **또는** `games` 가 `0..regularSeasonGames`
   * 범위를 벗어난다 — `isRecordSane` 한 벌) 대전표(`playedPairs`)와 어긋난 팀 코드.
   * **사전순으로 정렬 + 중복 제거한다**(결정적으로) — `teamCode` 중복 입력이 있어도
   * 같은 코드가 두 번 들어가지 않는다(2026-08-19 3차 재리뷰 Minor m1).
   * ⚠**이 술어는 `remaining` 을 정하는 술어와 한 벌이다**(2026-08-19 4차 재리뷰 — `isRecordSane`,
   * M1). 둘이 갈리면 유도 실패 가지(`derived === null`)에서 `games > total` 인 어긋난 입력이
   * `disagreed` 에는 안 잡히고 `remaining: null` 로만 드러나는 「형제 구멍」이 생긴다.
   *
   * ⚠**비어 있음 = 「어긋난 팀이 없다」이지 「판정이 섰다」가 아니다.** 유도 실패도 비어 있을 수 있다
   * (교류전 미완처럼 성적 자체는 멀쩡한 경우). 판정이 섰는지는 `basis` 로 읽는다.
   *
   * ⚠**유도가 실패해도(`series === null`) 이 배열이 채워질 수 있다**(2026-08-19 3차 재리뷰
   * Important — 이전 판은 `w+l+t≠games` 검사를 유도 성공 시에만 돌려서 이 조합이 항상
   * `disagreed: []` 로 숨었다). Σ 검사(대전표 대조)는 유도가 됐을 때만 돌지만,
   * `w+l+t≠games` 자체 모순 검사는 유도 여부와 무관하게 항상 돈다 — 위 조합표의 네 번째 갈래.
   */
  disagreed: readonly string[];
  teams: Map<string, TeamRace>;
}

/**
 * 그 팀의 성적(`w/l/t/games`)만 보고 「믿을 수 있다」고 답할 수 있는가.
 * 대전표(`playedPairs`)·유도(`derived`)와는 무관하다 — 그 팀 혼자만으로 답이 나온다.
 *
 * ⚠**`disagreed` 판정과 `remaining` 판정이 반드시 이 한 벌을 같이 쓴다**(M1 · 2026-08-19 4차 재리뷰).
 * 전에는 `disagreed` 쪽이 `w+l+t===games` 만 보고 `games` 의 상한(`0..total`)을 안 봤다 —
 * `derived === null`(유도 실패) 가지에서는 `Σ` 검사도 안 돌아서, `games > total` 인 어긋난 입력이
 * `disagreed` 에는 안 잡히고 `remaining: null` 로만(즉 조합표의 「유도 실패(정상)」과 같은 모양으로) 드러났다.
 */
function isRecordSane(x: { w: number; l: number; t: number; games: number }, total: number): boolean {
  return x.w + x.l + x.t === x.games && x.games >= 0 && x.games <= total;
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
 *
 * ---
 * ⚠**`eliminated === false` 는 「가능성이 있다」가 아니다.**
 * 이 판정은 **쌍별(pairwise)** 이다 — 「나를 넘을 수 있는 상대가 한 팀도 없다」만 본다.
 * 그런데 라이벌들끼리도 맞붙기 때문에 **「누구도 혼자서는 나를 못 넘지만 그들끼리의 경기에서
 * 누군가는 반드시 이겨서 결국 넘는다」**는 상태가 실재한다. 정확한 판정은 **최대유량**이 필요하다.
 * 즉 `false` 의 정확한 뜻은 **「쌍별로는 소멸이 증명되지 않았다」**이고,
 * `true` 만 단정이다(쌍별로 넘기는 상대가 하나라도 있으면 그것은 확실한 소멸이다).
 * 브리프가 이 알고리즘을 지정했으므로 결함이 아니다 — 다만 **화면은 「消滅」만 단정하고
 * 반대편은 단정하지 않는다.** SRC/SRP 를 WAR 과 다른 이름으로 부른 것과 같은 원칙이다.
 * (화면 문구 반영은 매직을 실제로 화면에 내는 태스크로 이월 — 재리뷰 Minor c.)
 *
 * ---
 * ⚠**입력 계약: `teams[].games` 와 `playedPairs` 는 같은 질의·같은 `through` 필터에서 나와야 한다.**
 * 둘은 별개 입력이고, 한쪽만 「어제까지」이고 다른 쪽이 「오늘까지」면 Σ 검사가 전 팀을 어긋난 것으로
 * 판정해 **시즌 전체가 `unknown` 이 되고 화면 패널이 통째로 빈다.**
 * 프로덕션 호출자가 아직 0건이라(2026-08-19 grep 확인: `index.ts` 의 export 와 시험뿐)
 * 배선하는 쪽이 이걸 모르고 다른 필터를 물릴 위험이 실재한다.
 * 그때 나오는 신호는 `basis: "unknown"` · `series !== null` · `disagreed` 가 **전 팀**이다.
 *
 * ⚠**입력 계약: `teams[].teamCode` 는 서로 유일해야 한다**(2026-08-19 3차 재리뷰 Minor m1).
 * 중복은 타입으로 막히지 않는다 — 위반하면 `byCode` 맵 키 충돌(나중 항목이 이전 항목을 덮어씀)처럼
 * 더 근본적인 문제가 생긴다. `disagreed` 는 `Set` 을 거쳐 중복 코드가 두 번 들어가지 않게는 하지만,
 * 그건 표시를 결정적으로 만드는 방어일 뿐 고유성 위반 자체를 고쳐 주지 않는다.
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
   * 1. `isRecordSane`(`w+l+t===games` **그리고** `0≤games≤total`) — 공짜 검산이다. `t` 는
   *    선언만 되고 안 읽혔었고, `games>total`(잔여 음수)도 예전엔 이 자리에서 안 잡혔다.
   *    ⚠**`derived` 유무와 무관하게 항상 돈다**(2026-08-19 재리뷰 Important). 이 검사는 대전표를
   *    전혀 안 쓰는데 옛 판은 유도가 됐을 때만(`if (derived !== null)` 안에서) 돌렸다 —
   *    「유도 실패(교류전 미완) + 팀별 자체 모순」이 겹치면 그 모순이 `disagreed` 에서 사라졌다.
   * 2. `Σ 상대별 잔여 === total − games` — 어긋나면 대전표와 성적이 다른 세계의 것이다.
   *    이쪽은 대전표 대조가 필요하므로 **유도가 됐을 때만** 돈다(지금대로 유지).
   *
   * ⚠**`games > total` 를 1번에서 따로 검사한다 — 「2번이 이미 잡으니 죽은 가지」는 틀린 논증이었다**
   * (2026-08-19 4차 재리뷰 「형제 구멍」). 그 논증은 `derived !== null`(2번이 도는 경로) 에서만
   * 참이다. `derived === null` 이면 2번 자체가 안 돌아서, `w+l+t===games` 만으로는 자체 모순이
   * 아닌 `games>total` 입력이 `disagreed` 를 그냥 통과했다 — 조합표의 「아직 유도할 수 없다(정상)」
   * 행과 완전히 같은 모양이 되어 `remaining: null` 로만 드러났다(그런데 그건 M11 이 막으려던
   * 「불충분한 신호」다). `total` 은 유도와 무관하게 항상 알므로 이 검사는 공짜다.
   *
   * ⚠**어긋난 팀만 `null` 로 두지 않는다.** 그 팀의 틀린 h2h·최대승수가 다른 팀 판정의 입력으로
   * 들어가기 때문에 **시즌 전체**를 `unknown` 으로 떨어뜨린다(M11 — 모르는 것을 아는 척하지 않는다).
   * 대신 **누가 어긋났는지는 남긴다**(`disagreed`) — 「아직 모름(정상)」과 구별할 수 있어야 한다(M7).
   */
  /**
   * ⚠**`Set` 경유로 dedup 한다**(2026-08-19 재리뷰 Minor m1). `teamCode` 는 입력 계약상
   * 유일해야 하지만(아래 함수 JSDoc) 타입으로는 강제되지 않는다 — 중복 입력 시 같은 코드가
   * 두 번 들어가면 `disagreed` 가 호출자마다 다른 모양이 되어 결정적이지 않다.
   */
  const disagreedSet = new Set<string>();
  for (const x of o.teams) {
    // ⚠**`derived` 유무와 무관하게 항상 돈다**(2026-08-19 재리뷰 Important). `isRecordSane` 은 `derived`
    // 를 전혀 안 쓰는데도 옛 판은 `if (derived !== null)` 안에 갇혀 있었다 — 그래서 「유도 실패(교류전
    // 미완) + 팀별 자체 모순」이 겹치면 `disagreed` 가 비어서 그 모순이 안 보였다(프로브로 재현·확인).
    // ⚠**`games>total` 도 여기서 잡는다**(2026-08-19 4차 재리뷰 「형제 구멍」) — `remaining` 이 쓰는
    // 것과 **같은 술어**(`isRecordSane`, M1)라 유도 실패 가지에서도 놓치지 않는다.
    if (!isRecordSane(x, total)) {
      disagreedSet.add(x.teamCode);
      continue;
    }
    // Σ 검사는 대전표 대조가 필요하므로 유도가 됐을 때만 돈다(지금대로 유지)
    if (derived === null) continue;
    let sum = 0;
    for (const v of h2hByTeam.get(x.teamCode)!.values()) sum += v;
    if (sum !== total - x.games) disagreedSet.add(x.teamCode);
  }
  // 팀 순서가 호출자에 따라 달라져도 같은 값이 나오게 한다(정렬은 dedup 뒤에도 유지)
  const disagreed = [...disagreedSet].sort();
  /** 판정을 내도 되는가. ⚠**`series` 와 다르다** — `series` 는 유도 결과를 그대로 들고 있다 */
  const confirmed = derived !== null && disagreed.length === 0;

  for (const me of o.teams) {
    /**
     * ⚠**그 팀의 성적만으로 답할 수 있을 때만 숫자다**(M11). 대전표·유도와는 무관하다 —
     * 교류전이 안 끝나 시즌이 `unknown` 이어도 잔여는 정말로 안다.
     * 반대로 `games` 가 규정을 넘으면 **잔여가 음수**이고, 그건 아는 값이 아니라 어긋난 입력이다.
     * ⚠**`disagreed` 판정과 같은 술어(`isRecordSane`)를 쓴다**(M1) — 갈리면 형제 구멍이 생긴다.
     */
    const remaining = isRecordSane(me, total) ? total - me.games : null;
    // ⚠유도가 안 됐거나 입력이 어긋나면 **빈 지도**다 — 틀린 잔여를 흘리는 것이 최악이다(M7)
    const h2hLeft = confirmed ? h2hByTeam.get(me.teamCode)! : new Map<string, number>();

    let selfPossible: boolean | null = null;
    let eliminated: boolean | null = null;
    const mine = remaining === null ? null : pctKey(bestPct(me.w, me.l, remaining));

    if (confirmed && mine !== null) {
      selfPossible = true;
      eliminated = false;
      for (const other of codes) {
        if (other === me.teamCode) continue;
        // ⚠**다른 리그는 우승 경쟁 상대가 아니다** — 이걸 안 걸러 센트럴 6팀이 전부 소멸로 나왔다
        if (o.leagueOf(other) !== o.leagueOf(me.teamCode)) continue;
        const b = byCode.get(other)!;
        const h = h2hLeft.get(other);
        /**
         * ⚠**없으면 `0` 으로 메우지 않는다**(M7·M11). 0 으로 흘리면 아래 `bMaxWins` 가
         * 상대의 최대 승수를 **과대평가**해서 내 자력이 조용히 죽는다 — 조용한 오답이 예외보다 나쁘다.
         * ⑴증명: `confirmed` 경로에서 `h2hByTeam` 은 `codes` 전부(자신 제외)로 채워지고
         *   이 루프도 **같은 `codes`** 를 돈다 → 지금은 도달 불가다.
         *   ⚠**그래서 어떤 픽스처로도 이 가지를 못 태운다**(2026-08-19 실측: 공개 API 로는 재현 불가).
         * ⑵막는 것: 위의 「조용히 죽는 자력」.
         * ⑶살아나는 때: h2h 의 출처가 `codes` 가 아니게 되는 순간 —
         *   예컨대 상대별 잔여를 **실제 일정에서 세도록** 바꾸면 中止 재편성으로 빠지는 쌍이 생긴다.
         */
        if (h === undefined) {
          selfPossible = null;
          eliminated = null;
          break;
        }
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
   * ---
   * ⚠**죽은 가지 규칙**(2026-08-19 확정 · 이 파일 전체에 적용).
   * > 도달 불가가 증명된 가지는, 그것이 없을 때 **「틀린 값이 나가는」** 것이면 남기고,
   * > **「이미 다른 검사가 잡는 중복」**이면 뺀다.
   * > 남긴 것에는 ⑴증명의 요지 ⑵무엇을 막는가 ⑶언제 살아나는가를 **반드시** 적는다.
   *
   * 이 규칙으로 이 파일의 가지들을 판정했다.
   * - 아래 **자력 검사**·**`others.length === 0`** → 남긴다(⑴⑵⑶ 각 자리에 적었다).
   * - 위쪽 **`h === undefined`** → 남긴다(같은 형식으로 적었다).
   * ⚠**`disagreed` 의 `games > total`(구 `agrees`)은 「Σ 검사가 잡는 중복」이 아니었다**
   *   (2026-08-19 4차 재리뷰 「형제 구멍」로 정정). `derived === null` 이면 Σ 검사 자체가
   *   안 돌아서 중복이 성립하지 않았다 — 그래서 **뺀 것이 아니라 `isRecordSane` 에 넣어 살렸다**
   *   (위쪽 disagreed 루프를 보라). 이 규칙표는 「중복이면 뺀다」가 실제로는 조건부(`derived !== null`
   *   에서만)였다는 사례로 남긴다 — 죽은 가지 판정도 전제 조건을 명시해야 한다.
   */
  if (confirmed) {
    for (const me of o.teams) {
      const mineRace = out.get(me.teamCode)!;
      /**
       * ⚠**내 자력이 살아 있는지도 본다.**
       * ⑴증명: 리그 안에서 `pctKey(bestPct)` 가 최대인 팀은 누구에게도 자력소멸당하지 않는다 —
       *   `Σ h2hLeft = remaining` 이고 각 h2h ≥ 0 이므로 상대 X 가 「나에게 전패」한 채 얻는 최선은
       *   `pctKey(bestPct(X))` 를 못 넘는다. 따라서 「다른 전원이 자력소멸」이면 남는 것은 나뿐이다.
       *   실측(2026-08-19 리뷰어 프로브): 무작위 40만 시즌에서 이 가지 발동 **0회**
       *   (반대로 「전원 자력소멸」 성립은 101,601회).
       * ⑵막는 것: 「**소멸한 팀의 매직**」 — 이 도메인에서 나올 수 있는 최악의 거짓말이다.
       * ⑶살아나는 때: 비교식이 바뀌는 순간. **NPB 협약 ① 当該球団間の対戦成績**(맞대결 성적)을
       *   타이브레이커로 넣으면 「최선승률 최대 = 아무에게도 안 죽는다」의 단조성이 깨진다 —
       *   승률이 같아도 맞대결에서 지면 아래가 되므로, 최선승률 최대인 팀도 자력이 죽을 수 있다.
       */
      if (mineRace.selfPossible !== true) continue;
      const others = codes.filter((c) => c !== me.teamCode && o.leagueOf(c) === o.leagueOf(me.teamCode));
      /**
       * ⚠**`every` 는 빈 배열에서 참이다.**
       * ⑴증명: `confirmed` ⇒ `deriveSeriesLengths` 가 12팀·리그별 6팀을 요구했다
       *   ⇒ `others.length === 5` 항상. 지금은 도달 불가다.
       * ⑵막는 것: **상대가 없는데 「우승 확정(매직 0)」이 켜지는 것** — 공허참으로 켜진 매직이다.
       *   원식의 `Math.max` 초기값이 `-Infinity` 라 클램프를 타고 정확히 `0` 이 나간다.
       * ⑶살아나는 때: 리그 구성이 6팀이 아니게 되거나(구단 확장·2군 리그 적용),
       *   `deriveSeriesLengths` 의 12팀·6:6 요구가 완화되는 순간.
       */
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

  // ⚠**`series` 는 유도 결과를 그대로 돌려준다** — 어긋난 입력 때문에 지우지 않는다(Important C).
  // 「유도도 못 했다」와 「유도는 했는데 입력이 어긋났다」가 같은 모양이면 아무도 원인을 못 찾는다.
  return { basis: confirmed ? "confirmed" : "unknown", series: derived, disagreed, teams: out };
}
