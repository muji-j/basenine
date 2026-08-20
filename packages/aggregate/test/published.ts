/**
 * **공표치 대조에서 기준일을 맞추는 한 벌**(M4) — 시험 전용 헬퍼.
 *
 * ⚠**이 파일이 있는 이유: 로컬 DB 는 낡았고 CI 의 DB 는 오늘까지다.**
 * 2026-08-20 에 CI 에서만 시험 둘이 떨어졌다 —
 * `decisions-seasons` **22건 / 대조 3,133건** · `gidp-seasons` **9건 / 대조 4,180건**.
 * 같은 커밋이 **로컬에서는 두 시험 다 0건**이었다. 코드가 바뀐 게 아니라 **DB 가 달랐다**:
 * 로컬은 08-16 스냅샷이라 우리 집계와 공표표가 우연히 같은 시점이었고,
 * CI 는 08-19 까지 수집한 뒤 08-15~08-20 에 걸쳐 받은 공표표와 맞대고 있었다.
 *
 * ⚠**이 저장소는 같은 병으로 이미 한 번 데었다** — `1d0ae32`
 * 「외부 대조가 거짓 경보 1,253건을 내고 있었다 — 기준일이 안 맞았다」.
 * `packages/aggregate/tools/crosscheck.ts` 는 그때 **팀 성적표의 취득 시각에서 기준일을 유도**해
 * `--through` 로 우리 집계를 잘라 맞추는 방식을 넣었다. 여기서는 그 방식을 **못 쓴다**:
 * 팀 성적표는 12장이라 기준일이 하나지만, **선수 페이지는 선수마다 취득 시각이 다르다**
 * (실측 CI DB: 08-15 · 08-16 · 08-17 · 08-18 · 08-19 · 08-20 여섯 날에 걸쳐 있다).
 *
 * ## 그래서 무엇을 하는가 — **출장량으로 기준일을 판정한다**
 *
 * 취득 시각에서 기준일을 유도하는 것은 **추측**이다. 실측해 보니 그 추측이 어렵다:
 * npb.jp 의 年度別成績 은 페이지에 기준일을 안 적고(실측: `現在`·`更新` 문자열 0건),
 * **경기 종료 뒤 곧바로 반영되지도 않는다** — 08-19 01:05 JST 에 받은 페이지가
 * 08-18 경기를 아직 담고 있지 않았다(우리 데이터로 역산). 「취득일 − N일」은 N 을 손으로 맞춰야 하고,
 * 그 N 이 어긋나는 날 **양방향으로 거짓 경보**가 난다.
 *
 * → 추측을 버리고 **공표표 스스로 말하는 출장량**(투수 `試合` · 타자 `打席`)을 본다.
 *   출장량이 우리와 같다는 것은 **같은 경기를 보고 있다**는 뜻이고, 그때만 값을 맞댄다.
 *
 * ⚠**출장량은 대조 대상 값을 지배해야 한다.** 決着(勝·敗)은 등판 없이 붙지 않고
 * 併殺打는 타석 없이 생기지 않는다 — 그래서 출장량이 같으면 그 값도 같은 경기 집합에서 나온다.
 *
 * ⚠**어느 열을 출장량으로 쓸지는 실측으로 골랐다**(CI DB · 2026-08-20):
 *   · 투수 `試合` — 완결 8시즌에서 **어긋남 0건 / 3,133건**
 *   · 타자 `打席` — 완결 8시즌에서 **어긋남 0건 / 5,438건**
 *   · ⚠타자 `試合` **은 쓸 수 없다** — 공표는 **出場試合**, 우리는 **打撃記録のある試合**이라
 *     완결 시즌에서도 **1,376건**이 어긋난다(`crosscheck.ts` 가 이미 정의 차이로 분류하고 있다).
 *
 * ## 세 갈래로 가른다 — **「우리가 틀린 것」과 「기준일이 다른 것」을 섞지 않는다**
 *
 * | 관계 | 뜻 | 판정 |
 * |---|---|---|
 * | 공표 출장량 **>** 우리 | **NPB 는 아는 경기를 우리가 모른다** | **결함**(수집 누락) |
 * | 공표 출장량 **<** 우리 | 공표표가 낡았다 | 기준일 차이 — 진행 중 시즌에서만 봐준다 |
 * | 같다 | 같은 경기를 봤다 | **값을 맞댄다** |
 *
 * ⚠**완결 시즌에서는 「낡았다」가 성립하지 않는다.** 시즌이 끝났으면 공표표도 우리도 더 늘 것이 없다 —
 * 그런데도 출장량이 다르면 그건 기준일이 아니라 **우리(또는 공표) 쪽 결함**이다. 그래서 FAIL 로 낸다.
 *
 * ⚠**미대조는 「0건 통과」가 아니다**(작업규칙 7). 몇 명을 못 쟀는지 반드시 세어 내보내고,
 * 부르는 쪽이 상한을 건다 — 안 그러면 어느 날 전원이 미대조가 되어도 초록이다.
 */
import type { Db } from "@bb-app/store";
import { regularSeasonGames } from "@bb-app/domain";

/** 한 선수-시즌의 「출장량」과 「대조할 값」 */
export interface Sample {
  /** 투수는 `試合`, 타자는 `打席`. **대조 값을 지배하는 수**여야 한다 */
  volume: number;
  /** 맞댈 값. 여러 수를 한 번에 보려면 `"3勝2敗"` 처럼 하나의 표기로 묶는다 */
  value: string;
}

/** 공표표 쪽 한 줄 */
export interface PublishedSample extends Sample {
  year: number;
  playerId: string;
  /**
   * 그 줄을 **언제 받았는가**(M4 · ISO UTC). ⚠**`null` 은 「모른다」다** — 「오늘」이 아니다(M11).
   *
   * ⚠**이 값이 필요한 이유는 「완결 시즌」 판정에 함정이 있기 때문이다**(2026-08-20).
   * 시즌이 끝나면 그 시즌은 완결이 되지만, **그 시점에 우리가 들고 있는 공표표 사본은
   * 시즌 중에 받은 것일 수 있다.** 실제로 그렇게 된다:
   * `store/tools/emit-stale-player-ids.ts` 는 「취득일 ≤ 마지막 출장일」인 선수만 다시 받는데,
   * 선수 페이지는 경기 다음날에야 반영되므로(실측) **최종전을 뛴 선수는 그 경기가 빠진 사본을
   * 든 채 「최신」으로 판정되어 다시 받히지 않는다.** 시즌 최종일에 뛴 선수 전원이 그 상태다.
   * → 취득 시각이 **시즌 종료보다 뒤**일 때만 「완결이므로 같아야 한다」고 말할 수 있다.
   */
  fetchedAt: string | null;
}

/**
 * 공표표가 시즌 종료 **뒤에** 받은 것인가.
 *
 * ⚠**여유를 크게 둔다.** 선수 페이지는 기준일을 안 적고 반영도 하루쯤 늦으므로(실측),
 * 「하루 차이」를 가르려 하면 그 자체가 거짓 경보의 원인이 된다.
 * 여기서 필요한 것은 **개월 단위의 구분**(시즌 중에 받았나 · 끝난 뒤에 받았나)이므로
 * 이틀 여유면 충분하고, 실제 사본은 대부분 몇 달 뒤에 받은 것이다.
 */
function fetchedAfterSeason(fetchedAt: string | null, lastGameDate: string): boolean {
  if (fetchedAt === null) return false;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return false;
  // JST 로 옮긴 날짜(§2-1). 그 뒤 이틀을 더 준다
  const jst = new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const limit = new Date(Date.parse(`${lastGameDate}T00:00:00Z`) + 2 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  return jst > limit;
}

export interface CrossCheck {
  /** 출장량이 같아 **실제로 값을 맞댄** 선수-시즌 */
  compared: number;
  /** 시즌별 대조 수 — 한 시즌에 쏠려 있으면 「9시즌을 쟀다」가 거짓이 된다 */
  bySeason: Map<number, number>;
  /** 값이 어긋난 것 — **결함 후보** */
  mismatches: string[];
  /** 공표가 우리보다 **앞선** 것 — 우리가 경기를 놓쳤다는 뜻이라 **결함** */
  ahead: string[];
  /** 공표가 **낡은** 것 — 기준일 차이. 미대조로 센다 */
  behind: string[];
  /**
   * **시즌이 끝난 뒤에 받은 사본인데도** 공표가 낡은 것 — 기준일로 설명되지 않으므로 **결함**.
   * ⚠**「완결 시즌」만으로 판정하지 않는다** — 시즌 중에 받은 사본은 완결 시즌 것이어도 낡을 수 있다
   * (`PublishedSample.fetchedAt` 주석 참조).
   */
  behindSettled: string[];
}

/**
 * **완결 시즌 → 그 시즌의 마지막 정규시즌 경기일**. 12팀 전부가 그 시즌의 경기 수를 채운 시즌만 담는다.
 *
 * ⚠**벽시계로 판정하지 않는다**(M6). 「지금이 8월이니 2026 은 진행 중」이 아니라
 * **우리가 가진 경기 수**로 판정한다. 시즌이 끝나면 아무도 안 고쳐도 자동으로 완결이 된다.
 * ⚠**143 을 상수로 쓰지 않는다** — 2020 은 120경기다(`regularSeasonGames`).
 * ⚠**마지막 경기일까지 돌려주는 이유**는 `fetchedAfterSeason` 이 그것을 필요로 하기 때문이다.
 */
export function settledSeasons(db: Db): Map<number, string> {
  const rows = db.raw
    .prepare(
      `WITH sides AS (
         SELECT season, game_date AS d, away_code AS code FROM game WHERE status='played' AND competition='regular'
         UNION ALL
         SELECT season, game_date AS d, home_code AS code FROM game WHERE status='played' AND competition='regular'
       )
       SELECT season, code, COUNT(*) AS n, MAX(d) AS last_day FROM sides GROUP BY season, code`,
    )
    .all() as unknown as { season: number; code: string; n: number; last_day: string }[];

  const bySeason = new Map<number, { counts: number[]; last: string }>();
  for (const r of rows) {
    const cur = bySeason.get(r.season) ?? { counts: [], last: "" };
    cur.counts.push(Number(r.n));
    if (r.last_day > cur.last) cur.last = r.last_day;
    bySeason.set(r.season, cur);
  }
  const out = new Map<number, string>();
  for (const [season, v] of bySeason) {
    const need = regularSeasonGames(season);
    if (v.counts.length === 12 && v.counts.every((n) => n === need)) out.set(season, v.last);
  }
  return out;
}

/**
 * 우리 집계와 공표표를 맞댄다.
 *
 * @param ours `${season}|${playerId}` → 우리 값. **행이 없는 선수는 대조 대상이 아니다**
 *   (보유 시즌 밖 · 아카이브에 그 시즌 로그가 없음).
 * @param published 공표표 쪽. `career_batting`/`career_pitching` 은 **현재 등록 선수만** 담으므로
 *   리그 전량이 아니다 — 부르는 쪽이 그 사실을 주석에 적는다.
 */
export function crossCheck(
  ours: ReadonlyMap<string, Sample>,
  published: readonly PublishedSample[],
  settled: ReadonlyMap<number, string>,
  unit: string,
): CrossCheck {
  const out: CrossCheck = {
    compared: 0,
    bySeason: new Map(),
    mismatches: [],
    ahead: [],
    behind: [],
    behindSettled: [],
  };
  for (const p of published) {
    const got = ours.get(`${p.year}|${p.playerId}`);
    if (got === undefined) continue;
    const where = `${p.year} ${p.playerId}`;
    if (p.volume > got.volume) {
      out.ahead.push(`${where}: 公表 ${p.volume}${unit} · 当サイト ${got.volume}${unit} — 우리가 경기를 놓쳤다`);
      continue;
    }
    if (p.volume < got.volume) {
      const line = `${where}: 公表 ${p.volume}${unit} · 当サイト ${got.volume}${unit}（취득 ${p.fetchedAt ?? "모름"}）`;
      /**
       * ⚠**「완결 시즌」만으로는 부족하다 — 사본을 언제 받았는지도 봐야 한다**(2026-08-20).
       * 시즌이 끝난 그 순간 그 시즌은 완결이 되지만, 우리가 든 공표표 사본은 **시즌 중에 받은 것**일 수 있다.
       * 그 상태에서 「완결이니 같아야 한다」고 우기면 **최종전을 뛴 선수 전원이 결함으로 잡힌다** —
       * 우리 집계가 아니라 **사본이 낡은 것**인데도. 그건 그물이 아니라 소음이다.
       */
      const seasonEnd = settled.get(p.year);
      if (seasonEnd !== undefined && fetchedAfterSeason(p.fetchedAt, seasonEnd)) out.behindSettled.push(line);
      else out.behind.push(line);
      continue;
    }
    out.compared += 1;
    out.bySeason.set(p.year, (out.bySeason.get(p.year) ?? 0) + 1);
    if (got.value !== p.value) {
      out.mismatches.push(`${where}: 公表 ${p.value} · 当サイト ${got.value}（${p.volume}${unit} 시점 동일）`);
    }
  }
  return out;
}
