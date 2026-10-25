/**
 * **빌드 시즌 목록** — 무엇을 굽고 무엇을 루트에 놓는가(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D4 · §9).
 *
 * ⚠**순수다** — DB 도 시계도 없다(M6). DB 에서 「치른 경기가 있는 시즌」을 읽는 것은 호출자(`tools/build.ts` → `query.ts` 의 `playedSeasons`)다.
 *
 * 시즌 인자는 `auto` 또는 `2026,2025,…`:
 * - **`auto`** — DB 의 치른(`played`) 시즌 중 **공개 하한(`PUBLIC_SEASON_FLOOR`) 이상** 전부. 0 개면 실패(굽지 않는다).
 * - **명시 목록** — 4자리 연도를 쉼표로. 정수가 아님·빈 칸·중복은 **형식 오류**(종료 2 · DB 를 열기 전).
 *   ⚠**목록 밖의 치른 시즌(하한 이상)이 있으면 실패**(종료 1) — 예전 `droppedSeasons`(드래프트 ∩ 경기 · **굽고 나서** 막았다)를 넓혔다(설계 R8).
 *   그 시즌을 빼고 구우면 선수·경기·순위가 통째로 사라진 채 「그 해는 원래 그렇다」로 읽힌다.
 * - **어느 쪽이든 결과는 중복 없는 내림차순이고 첫째(최댓값)가 루트다** — 명시 목록의 입력 순서는 뜻이 없다(예전 `seasons[0]` 을 바꿨다).
 * - ⚠⚠**하한~최신 사이에 치른 경기가 없는 시즌(구멍)이 있으면 실패**(종료 1 · 두 모드 다) — 사라진 시즌을 조용히 빼고 굽지 않는다
 *   (옛 명시 목록의 `emptySeasons`(선수 0명) 게이트의 몫 · PR-4 3중 검토 1차 P2). 실측: 보유 2018~2026 연속 9시즌 — 오탐 0.
 *
 * ⚠⚠**호출자는 이 판정을 `rmSync(outDir)` 앞에서 한다** — 실패면 굽지 않고 **기존 dist 를 건드리지 않는다**(CI 에서는 배포 단계가
 *   `success()` 라 안 돌고 지금 사이트가 남는다). 다른 게이트(선수 0명 · 링크 · 우승 판정 …)는 지금처럼 굽고 나서 막는다.
 * ⚠**`played` 로 센다** — 개막일이 전부 중지면 `notPlayed` 행만으로 새 시즌이 생겨 「선수 0명」 게이트로 배포가 멈춘다.
 * ⚠결과: 새 시즌은 **계수 유도 표본이 서는 날**(9시즌 실측: 개막 1~3경기일째)에 루트가 되고 앞 시즌은 `/{연도}/` 로 간다 —
 *   그 전까지는 이전 시즌을 루트로 배포가 계속된다(`deferNewestSeason` · 조정자 결정 ⒜). 사람이 목록을 고칠 일이 없다.
 */

/**
 * **공개 하한** — 이 시즌부터 화면으로 굽는다(2026-10-25 · PR-4 3중 검토 반영 · 조정자 결정).
 *
 * ⚠⚠**`auto` 는 보관소에 치른 경기가 오르면 그 시즌을 굽는다** — 옛 명시 목록은 「목록에 더하는 순간 = 공개」라는 **사람의 선언**이었고,
 *   CLAUDE.md §2-2 의 「공개 전에 품질을 쟀다(2021) · 백필 전에 시즌마다 재라」가 거기 걸려 있었다. 하한이 그 선언을 대신한다:
 *   **하한 아래 시즌은 보관소에 있어도 굽지 않고**(경고 한 줄 · 실패 아님) · **소급 공개는 사람이 품질을 잰 뒤 이 값을 내리는 커밋**이 정한다.
 * ⚠**한 곳(M1)** — 빌드·워크플로가 숫자를 따로 박지 않는다(`build-gates.test.ts` 가 지킨다). 새 시즌(최신 + 1)은 하한과 무관하게 자동이다.
 * ⚠**화면만 막는다** — 하한 아래 시즌의 경기도 DB 에 있으면 통산 집계·「収録」 범위(`query.ts` 의 `heldSeasonsOf`)에는 들어간다(경고가 그 사실을 말한다).
 */
export const PUBLIC_SEASON_FLOOR = 2018;

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

/** 굽는 시즌과 함께 낼 경고(`::warning::` 로 시작 · 호출자가 표준출력에 찍는다) */
export type BuildSeasons = { readonly seasons: number[]; readonly warnings: string[] };

/**
 * 굽는 시즌(내림차순 · 첫째가 루트)을 정한다 — 실패는 호출자가 종료 1(굽지 않는다 · dist 불변).
 * ⚠실패 사유가 여럿이면 **전부** 한 메시지에 줄로 싣는다(구멍과 목록 밖이 함께 난 경우 둘 다 말한다).
 * @param played DB 에서 치른 경기가 있는 시즌(순서 무관)
 * @param floor 공개 하한 — 시험이 아니면 넘기지 않는다(`PUBLIC_SEASON_FLOOR` 한 곳)
 */
export function resolveBuildSeasons(arg: SeasonArg, played: readonly number[], floor: number = PUBLIC_SEASON_FLOOR): Parsed<BuildSeasons> {
  const desc = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => b - a);
  const playedSet = new Set(played);
  const above = desc(played.filter((s) => s >= floor));
  const keep = "굽지 않는다 · **기존 dist 를 건드리지 않는다**";
  const errors: string[] = [];

  // ⚠⚠구멍 — 하한~최신 사이에 치른 경기가 없는 시즌(사라진 시즌을 조용히 빼지 않는다)
  const latest = above[0];
  const holes: number[] = [];
  if (latest !== undefined) for (let y = floor; y <= latest; y += 1) if (!playedSet.has(y)) holes.push(y);
  if (holes.length > 0) {
    errors.push(
      `⚠공개 하한(${String(floor)})~최신(${String(latest)}) 사이에 치른 경기가 없는 시즌이 있다: ${holes.join("·")} — ` +
        `그 시즌을 빼고 구우면 화면과 링크(/{연도}/…)가 조용히 사라진다. 보관소 복원·적재를 확인하라. ${keep}`,
    );
  }

  const listed = arg.kind === "list" ? new Set(arg.seasons) : null;
  if (arg.kind === "auto") {
    if (above.length === 0) {
      errors.push(`⚠DB 에 공개 하한(${String(floor)}) 이상 치른 경기가 있는 시즌이 하나도 없다(auto). ${keep}`);
    }
  } else {
    const missing = above.filter((s) => !listed!.has(s));
    if (missing.length > 0) {
      errors.push(
        `⚠치른 경기가 있는 시즌이 시즌 목록(${arg.seasons.join(",")})에 없다: ${missing.join("·")} — ` +
          "빼고 구우면 그 시즌의 선수·경기·순위가 통째로 사라진다(드래프트가 있으면 한 장으로만 구워진다). " +
          `목록에 넣거나 \`auto\` 를 써라. ${keep}`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, message: errors.join("\n") };

  // 하한 아래 치른 시즌 — 굽지 않는다(명시 목록에 적힌 것은 사람이 고른 것이라 굽는다)
  const below = desc(played.filter((s) => s < floor && !(listed?.has(s) ?? false)));
  const warnings =
    below.length === 0
      ? []
      : [
          `::warning::공개 하한(${String(floor)}) 아래 치른 시즌 ${below.join("·")} 은 굽지 않는다 — ` +
            "공개하려면 그 시즌의 품질을 재고(CLAUDE.md §2-2 — 투수 귀속 · 12구단 경기 수 · 적재 실패 0) 하한(PUBLIC_SEASON_FLOOR)을 내리는 커밋으로 연다 · " +
            "⚠그 시즌의 경기는 DB 에 있어 통산 집계·「収録」 범위에는 이미 들어간다",
        ];
  return { ok: true, value: { seasons: arg.kind === "auto" ? above : desc(arg.seasons), warnings } };
}

/**
 * **새 시즌을 미뤄 줄 수 있는 경기일 수의 상한** — 이보다 많은 경기일을 치른 시즌의 「표본 0」은 개막 직후가 아니라 **데이터 결함**이다(M7 · 실패).
 * ⚠실측(보유 9시즌 · 그날까지 쌓인 타석으로 다시 유도): 한 리그 이상 표본 0 인 시즌이 1경기일째 7/9 · 2경기일째 3/9 · **3경기일째 이후 0/9**.
 *   7 은 그 최댓값(2)의 세 배 남짓인 여유다 — 넘으면 지금처럼 실패하고(굽기 전 · 기존 dist 그대로) 사람이 본다.
 * ⚠⚠이 상한이 없으면 **시즌 도중의 파서·적재 회귀**(한 사건이 통째로 사라짐)가 「아직 이르다」로 읽혀,
 *   현재 시즌이 사이트에서 빠지고 지난 시즌이 루트로 돌아간 채 **종료 0** 으로 배포된다(PR-4 3중 검토 반영 ① 구현 중 · 조정자 결정의 「좁게」를 날짜로 묶었다).
 */
export const DEFER_MAX_GAME_DAYS = 7;

/**
 * **새 시즌(굽는 목록의 최대)을 아직 굽지 않을 것인가** — 그 시즌을 읽다가 계수 유도가 「표본 0」으로 실패했을 때(PR-4 3중 검토 2차 F1 · 조정자 결정 ⒜).
 *
 * 조건(전부 — **좁게**): `auto` · 실패한 시즌이 **굽는 목록의 최대** · 그 시즌이 **아직 안 끝났다** · 남는 시즌이 있다 ·
 * 그 시즌이 치른 경기일이 **`DEFER_MAX_GAME_DAYS` 이하**(개막 직후).
 * 「표본 0」인지는 호출자가 **오류 형**(`RunValueSampleError`)으로 가른다 — 메시지 글자로 가르지 않는다(같은 `RangeError` 인 어휘 오류를 삼키지 않게 · M7).
 * ⚠그 밖(최대가 아닌 시즌 · 다른 오류 · 명시 목록 · 끝난 시즌 · 개막 직후가 아님)은 지금처럼 실패다 — 굽기 전이라 기존 dist 가 남는다.
 */
export function deferNewestSeason(o: {
  readonly kind: SeasonArg["kind"];
  readonly seasons: readonly number[];
  readonly failedSeason: number;
  readonly failedSeasonOver: boolean;
  /** 그 시즌이 치른(`played` · 정규시즌) 경기일 수 */
  readonly gameDays: number;
}): boolean {
  return (
    o.kind === "auto" &&
    o.seasons.length > 1 &&
    o.failedSeason === o.seasons[0] &&
    !o.failedSeasonOver &&
    o.gameDays <= DEFER_MAX_GAME_DAYS
  );
}

/** 유예한 새 시즌의 경고 한 줄(`::warning::` · 표준출력) — 사유 · 시즌 · 개막 며칠째 · 이번 루트 */
export function deferNotice(o: {
  readonly season: number;
  readonly reason: string;
  readonly gameDays: number;
  readonly firstDate: string | null;
  readonly root: number;
}): string {
  return (
    `::warning::${String(o.season)} 시즌은 아직 굽지 않는다 — 계수 유도 표본이 서지 않았다(${o.reason}) · ` +
    `개막 ${String(o.gameDays)}경기일째${o.firstDate === null ? "" : `(첫 경기 ${o.firstDate})`} · 이번 배포는 ${String(o.root)} 시즌이 루트다 ` +
    "(보유 9시즌 실측: 개막 1~3경기일째에 표본이 선다 — 서는 날 자동으로 굽힌다)"
  );
}
