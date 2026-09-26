/**
 * **경기 폴더 판별 — 한 벌**(M1 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md` D2 · 감사 C10).
 *
 * 아카이브의 경기 페이지는 `…/scores/<시즌>/<MMDD>/<슬러그>/box.html.gz` 에 있고, 이 경로 모양이 곧 경기 식별이다 —
 * `game_id` 는 `<시즌>/<MMDD>/<슬러그>`(슬러그 **원문 그대로**)다.
 * 적재기(`tools/load-archive.ts`)가 어느 파일을 경기로 적재하는가와, 수집 창(`scripts/update.ts`)이 마지막 경기일의
 * 어느 폴더를 「받아 둔 경기」로 세는가가 **같은 판정**이어야 한다. 갈리면 수집 창이 적재기가 경기로 안 보는 폴더
 * (`.staging` 같은 임의 이름)를 「덜 받음」으로 읽어 **매 실행 그 날을 다시 받거나**(L1), 반대로 덜 받은 날을 놓친다.
 * ⚠**판정은 적재기의 `gameFromPath` 에서 그대로 옮겼다** — 적재 결과를 바꾸지 않는다.
 *
 * ⚠**이 파일은 import 가 0개인 잎(leaf)이어야 한다**(I1 · `refetch-limit.ts` 선례). `scripts/update.ts`(수집
 * 오케스트레이터)가 서브패스 `@bb-app/store/game-slug` 로 직접 가져오는데, 그 스크립트는 경기·予告先発 수집을
 * 각각 자식 프로세스로 격리해 **부분 실패를 전체 실패로 만들지 않는다.** 여기서 store 배럴이나 domain 을 가져오면
 * 그 사슬의 **어디서든** 로드 시점 오류가 나면 수집이 시작하기도 전에 죽는다.
 * → 그래서 **팀 코드 정규화(`canonicalTeamCode` · domain)는 여기 두지 않는다.** 슬러그 조각을 원문 그대로 돌려주고
 *   적재기가 거기에 정규화를 입힌다. `packages/store/test/game-slug.test.ts` 가 잎임을 강제한다.
 */

/** 경기 폴더 하나의 식별 정보 — 전부 **경로에서** 낸다 */
export interface GameFolder {
  /** `<시즌>/<MMDD>/<슬러그>`. ⚠슬러그 **원문 그대로** — 아카이브 경로와의 대응이 끊기면 「이 수치가 어느 파일에서 왔나」에 답할 수 없다(§0-10) */
  gameId: string;
  season: number;
  /** `<시즌>-<MM>-<DD>` — `game.game_date` 의 출처다 */
  gameDate: string;
  /**
   * 슬러그 **첫** 조각 = 홈.
   * ⚠**슬러그는 `{홈}-{원정}-{경기번호}` 순서다.** 직관과 반대라서 실제로 한 번 틀렸고, 그 결과 전 선수의 소속 구단이
   * 상대 팀으로 뒤집혔다. 실측 근거: 박스스코어의 `tablefix_t_b`(先攻=원정)에 붙은 팀명이 **슬러그 두 번째**와
   * 일치한다 — 630경기 전건 확인(2026-08-15).
   */
  homeSlug: string;
  /** 슬러그 가운데 조각들 = 원정(이어 붙인다). ⚠원문 그대로 — 옛 슬러그(2018 오릭스 `bs`)의 정규화는 적재기 몫이다 */
  awaySlug: string;
  gameNo: number;
}

/**
 * `.../npb/scores/2026/0814/s-db-17/box.html.gz` → 경기 식별 정보. 경기가 아니면 `null`.
 *
 * 경기인 것: 경로가 `scores/<4자리>/<MMDD>/<슬러그>/box.html.gz` 로 끝나고, 슬러그가 `-` 로 **3조각 이상**이며
 * **마지막 조각이 수**인 것. ⚠「수」는 `Number.isFinite(Number(조각))` 이다 — 적재기의 판정을 그대로 옮긴 것이라
 * 빈 조각(`s-db-` → `Number("") === 0`)도 통과한다. 좁히면 적재 결과가 바뀌므로 여기서 바꾸지 않는다.
 * ⚠**파일이 실제로 있는지는 보지 않는다**(잎은 I/O 를 하지 않는다) — 적재기는 순회가 찾은 파일만 넘기고,
 *   `scripts/update.ts` 는 `box.html.gz` 가 있는 폴더만 넘긴다.
 */
export function gameFromBoxPath(file: string): GameFolder | null {
  const m = /scores[\\/](\d{4})[\\/](\d{2})(\d{2})[\\/]([^\\/]+)[\\/]box\.html\.gz$/.exec(file);
  if (!m) return null;
  const [, season, mm, dd, slug] = m;
  const parts = slug!.split("-");
  const gameNo = Number(parts.at(-1));
  if (parts.length < 3 || !Number.isFinite(gameNo)) return null;
  return {
    gameId: `${season}/${mm}${dd}/${slug}`,
    season: Number(season),
    gameDate: `${season}-${mm}-${dd}`,
    homeSlug: parts[0]!,
    awaySlug: parts.slice(1, -1).join("-"),
    gameNo,
  };
}
