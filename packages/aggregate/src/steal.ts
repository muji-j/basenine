/**
 * 도루 성적.
 *
 * ⚠**이 값의 존재 이유는 분모다**(M2). 박스스코어는 `盗塁` 만 주므로 지금까지 화면은
 * 「30도루」라고만 말할 수 있었다 — 40번 시도해서 30번 성공한 것과 33번 시도해서
 * 30번 성공한 것이 같은 표시가 된다. 도루자(盗塁刺)는 §2-2 카탈로그 항목이면서
 * **타석 로그가 유일한 출처**다.
 *
 * ## 대조 실측 (2026-08-17)
 *   · 경기별 도루 수 대 박스스코어 `盗塁` 열: **2,395경기 중 어긋남 0건**(2024〜2026)
 *   · 2026 정규시즌 합계: 도루 611 = 공표 611 · 도루자 254 = 공표 `盗塁刺` 254
 */
import type { Db } from "@bb-app/store";

/**
 * 루. ⚠**뜻이 사건 종류마다 다르다**(마이그레이션 010 주석):
 * 도루·도루자는 **노린 루**(`二塁盗塁成功` = 2루를 훔쳤다),
 * 견제사는 **있던 루**(`一塁牽制アウト` = 1루에서 잡혔다).
 * **하나의 표로 그리면 뜻이 섞인다** — 화면도 여기서도 나눠서 든다.
 */
export type StealBase = "1b" | "2b" | "3b" | "home";

/** ⚠**표시 순서의 정본**. 화면이 목록을 따로 적으면 어느 날 한쪽만 바뀐다(M1) */
export const STEAL_BASES: readonly StealBase[] = ["1b", "2b", "3b", "home"];

function emptyByBase(): Record<StealBase, number> {
  return { "1b": 0, "2b": 0, "3b": 0, home: 0 };
}

function isStealBase(v: string): v is StealBase {
  return (STEAL_BASES as readonly string[]).includes(v);
}

export interface StealLine {
  playerId: string;
  displayName: string;
  teamCode: string;
  /** 도루 성공 */
  sb: number;
  /** 도루자(盗塁刺) */
  cs: number;
  /**
   * 견제사. ⚠**도루 기도에 넣지 않는다** — NPB 기록에서 견제사는 盗塁刺가 아니다.
   * 넣으면 성공률의 분모가 부풀어 전 선수의 성공률이 실제보다 낮게 나온다.
   */
  pickoff: number;
  /**
   * **노린 루**별 도루 성공. ⚠`sb` 의 합과 같아야 한다.
   *
   * 9시즌 정규시즌 실측(2026-08-20): 2루 7,471 · 3루 288 · 본루 47.
   */
  sbByBase: Readonly<Record<StealBase, number>>;
  /**
   * **노린 루**별 도루자. 9시즌 정규시즌 실측: 2루 3,238 · 3루 128 · **본루 146**.
   *
   * ⚠**본루만 성공(47)보다 도루자(146)가 3배 많다** — 이 한 줄이 루별로 나눈 이유다.
   * 뭉쳐서 성공률 하나로 내면 이 사실이 사라진다.
   */
  csByBase: Readonly<Record<StealBase, number>>;
  /**
   * **있던 루**별 견제사. 9시즌 정규시즌 실측: 1루 392 · 2루 131 · 3루 21.
   * ⚠위 둘과 **뜻이 다른 열**이다(노린 루가 아니다).
   */
  pickoffByBase: Readonly<Record<StealBase, number>>;
  /**
   * 더블스틸의 일부였던 **도루 성공** 수(원문에 `（ダブルスチール）`가 붙는다).
   *
   * ⚠**「더블스틸 횟수」가 아니라 「그 선수가 관여한 도루 수」다.** 한 번의 더블스틸이
   * 주자 2명분으로 2행 남는다(실측 108조 중 108조가 2행 · 1조만 4행).
   * ⚠실측상 실패 쪽(`盗塁失敗`·`牽制アウト`)에는 이 표기가 **한 번도 붙지 않았다**(0/4,056) —
   * 그러니 이 수는 성공에만 붙는다. 성공률의 분모와는 무관하다.
   * ⚠본루 도루 47건 중 **40건이 더블스틸의 일부**다 — 본루 도루는 대개 단독 기도가 아니다.
   */
  doubleSteal: number;
}

/**
 * ⚠**대회를 섞지 않는다**(§2-1). 실측으로 이 경계가 값을 갈랐다 — 올스타를 넣으면
 * 2026 도루가 611이 아니라 620이 되어 공표값과 9 어긋난다.
 * ⚠**주자의 소속은 공격 측이다** — 표(top)면 원정, 리(bottom)면 홈.
 */
const SQL = `
SELECT r.runner_id AS playerId, p.display_name AS displayName,
       CASE r.half WHEN 'top' THEN g.away_code ELSE g.home_code END AS teamCode,
       r.kind AS kind, r.base AS base, r.double_steal AS doubleSteal
FROM runner_event r
JOIN game g ON g.game_id = r.game_id
JOIN player p ON p.player_id = r.runner_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
`;

/** 도루 기도 = 성공 + 도루자. **견제사는 들어가지 않는다** */
export function attempts(l: Pick<StealLine, "sb" | "cs">): number {
  return l.sb + l.cs;
}

/**
 * 도루 성공률. ⚠**기도가 0이면 null이다** — 0/0을 `.000`으로 내면
 * 「한 번도 안 뛴 선수」가 「뛰었지만 다 실패한 선수」와 같아진다(M11).
 */
export function successRate(l: Pick<StealLine, "sb" | "cs">): number | null {
  const n = attempts(l);
  return n === 0 ? null : l.sb / n;
}

/**
 * 쌓는 동안만 쓰는 가변형.
 * ⚠**밖으로 나가는 타입은 `Readonly` 다** — 부르는 쪽이 루별 표를 고치면
 * 총계와 내역이 갈린다. 여기서만 열어 두고 반환할 때 좁힌다(캐스트를 흩뿌리지 않는다).
 */
type Accum = Omit<StealLine, "sbByBase" | "csByBase" | "pickoffByBase"> & {
  sbByBase: Record<StealBase, number>;
  csByBase: Record<StealBase, number>;
  pickoffByBase: Record<StealBase, number>;
};

/** 한 시즌의 선수별 도루 성적 */
export function steals(db: Db, season: number, competition: string, through: string): StealLine[] {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    playerId: string; displayName: string; teamCode: string; kind: string; base: string; doubleSteal: number;
  }[];

  const out = new Map<string, Accum>();
  for (const r of rows) {
    /**
     * ⚠**선수당 한 벌이다**(팀을 키에 넣으면 이적 선수가 반씩 나뉜다).
     *
     * 팀 코드는 **처음 본 것**이 그대로 남는다 — 엔트리를 만들 때 한 번만 넣고 갱신하지 않는다.
     * ⚠**「마지막에 본 것을 쓴다」고 적혀 있었는데 그건 사실이 아니었다**(2026-08-20).
     * 코드가 그렇게 동작한 적이 없고(아래 `if (e === undefined)` 안에서만 넣는다),
     * `SQL` 에 `ORDER BY` 도 없어서 **애초에 「마지막」이라는 것이 정의되지 않는다.**
     * 지금은 무해하다 — 웹 계층이 `playerId` 로만 다시 묶어 쓰기 때문이다.
     * ⚠**다음 사람이 이 주석을 믿고 「이적 후 팀이 나온다」고 가정하면 틀린다.**
     * 시즌 중 이적한 선수의 표시 팀을 이 값으로 정하려면 `ORDER BY` 부터 넣어야 한다.
     */
    let e = out.get(r.playerId);
    if (e === undefined) {
      e = {
        playerId: r.playerId, displayName: r.displayName, teamCode: r.teamCode, sb: 0, cs: 0, pickoff: 0,
        sbByBase: emptyByBase(), csByBase: emptyByBase(), pickoffByBase: emptyByBase(), doubleSteal: 0,
      };
      out.set(r.playerId, e);
    }
    /**
     * ⚠**모르는 루가 오면 멈춘다**(M7 · 종류와 같은 이유). DB 의 CHECK 가 네 값으로 막고 있지만,
     * 그건 저 표의 성질이지 이 함수의 전제가 아니다 — 조용히 흘리면 루별 합이 전체와 어긋나고
     * 화면은 그걸 「그 선수는 3루를 안 훔쳤다」로 읽는다.
     */
    if (!isStealBase(r.base)) throw new RangeError(`모르는 루 ${r.base}（${r.kind}）`);
    // ⚠**루별 표를 종류마다 나눠 든다** — `base` 의 뜻이 종류에 따라 다르기 때문이다
    if (r.kind === "steal") {
      e.sb += 1;
      e.sbByBase[r.base] += 1;
      if (r.doubleSteal === 1) e.doubleSteal += 1;
    } else if (r.kind === "caughtStealing") {
      e.cs += 1;
      e.csByBase[r.base] += 1;
    } else if (r.kind === "pickoff") {
      e.pickoff += 1;
      e.pickoffByBase[r.base] += 1;
    } else {
      // ⚠**모르는 종류가 오면 멈춘다**(M7). 조용히 흘리면 성공률이 서서히 틀려진다
      throw new RangeError(`모르는 주자 사건 종류 ${r.kind}`);
    }
  }
  return [...out.values()];
}
