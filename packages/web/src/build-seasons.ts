/**
 * **빌드 시즌 목록** — 무엇을 굽고 무엇을 루트에 놓는가(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D4).
 *
 * ⚠**순수다** — DB 도 시계도 없다(M6). DB 에서 「치른 경기가 있는 시즌」을 읽는 것은 호출자(`tools/build.ts` → `query.ts` 의 `playedSeasons`)다.
 *
 * 시즌 인자는 `auto` 또는 `2026,2025,…`:
 * - **`auto`** — DB 의 치른(`played`) 시즌 전부. 0 개면 실패(굽지 않는다).
 * - **명시 목록** — 4자리 연도를 쉼표로. 정수가 아님·빈 칸·중복은 **형식 오류**(종료 2 · DB 를 열기 전).
 *   ⚠**목록 밖의 치른 시즌이 있으면 실패**(종료 1) — 예전 `droppedSeasons`(드래프트 ∩ 경기 · **굽고 나서** 막았다)를 넓혔다(설계 R8).
 *   그 시즌을 빼고 구우면 선수·경기·순위가 통째로 사라진 채 「그 해는 원래 그렇다」로 읽힌다.
 * - **어느 쪽이든 결과는 중복 없는 내림차순이고 첫째(최댓값)가 루트다** — 명시 목록의 입력 순서는 뜻이 없다(예전 `seasons[0]` 을 바꿨다).
 *
 * ⚠⚠**호출자는 이 판정을 `rmSync(outDir)` 앞에서 한다** — 실패면 굽지 않고 **기존 dist 를 건드리지 않는다**(CI 에서는 배포 단계가
 *   `success()` 라 안 돌고 지금 사이트가 남는다). 다른 게이트(선수 0명 · 링크 · 우승 판정 …)는 지금처럼 굽고 나서 막는다.
 * ⚠**`played` 로 센다** — 개막일이 전부 중지면 `notPlayed` 행만으로 새 시즌이 생겨 「선수 0명」 게이트로 배포가 멈춘다.
 * ⚠결과: 새 시즌의 첫 경기가 적재된 실행에서 루트가 그 시즌이 되고 앞 시즌은 `/{연도}/` 로 간다 — 사람이 목록을 고칠 일이 없다.
 */

export type SeasonArg = { readonly kind: "auto" } | { readonly kind: "list"; readonly seasons: readonly number[] };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** 시즌 인자를 읽는다 — 실패는 **형식 오류**(호출자가 종료 2 · DB 를 열기 전) */
export function parseSeasonArg(arg: string): Parsed<SeasonArg> {
  if (arg.trim() === "auto") return { ok: true, value: { kind: "auto" } };
  const tokens = arg.split(",").map((x) => x.trim());
  // ⚠빈 칸을 0 으로 읽지 않는다 — 예전에는 `Number("")` 가 0 이라 빈 인자가 「시즌 0」으로 구워졌다(그때 dist 는 이미 지워졌다)
  if (tokens.some((t) => !/^\d{4}$/.test(t))) return { ok: false, message: `시즌이 정수가 아니다: ${arg}` };
  const seasons = tokens.map(Number);
  if (new Set(seasons).size !== seasons.length) return { ok: false, message: `시즌이 중복됐다: ${arg}` };
  return { ok: true, value: { kind: "list", seasons } };
}

/**
 * 굽는 시즌(내림차순 · 첫째가 루트)을 정한다 — 실패는 호출자가 종료 1(굽지 않는다 · dist 불변).
 * @param played DB 에서 치른 경기가 있는 시즌(순서 무관)
 */
export function resolveBuildSeasons(arg: SeasonArg, played: readonly number[]): Parsed<number[]> {
  const desc = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => b - a);
  if (arg.kind === "auto") {
    if (played.length === 0) {
      return { ok: false, message: "⚠DB 에 치른 경기가 있는 시즌이 하나도 없다(auto) — 굽지 않는다. **기존 dist 를 건드리지 않는다**" };
    }
    return { ok: true, value: desc(played) };
  }
  const listed = new Set(arg.seasons);
  const missing = desc(played.filter((s) => !listed.has(s)));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `⚠치른 경기가 있는 시즌이 시즌 목록(${arg.seasons.join(",")})에 없다: ${missing.join("·")} — ` +
        "빼고 구우면 그 시즌의 선수·경기·순위가 통째로 사라진다(드래프트가 있으면 한 장으로만 구워진다). " +
        "목록에 넣거나 `auto` 를 써라. 굽지 않는다 · **기존 dist 를 건드리지 않는다**",
    };
  }
  return { ok: true, value: desc(arg.seasons) };
}
