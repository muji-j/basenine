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
