/**
 * **그 시즌의 표시명** — SQL 조각을 만드는 곳. ⚠**여기 한 벌뿐이다**(M1).
 *
 * ## 왜 시즌별인가
 *
 * ⚠**표시명이 「아카이브 최초 등장 경기」의 이름으로 영구 고정돼 있었다**(2026-08-21 감사 확정 P1).
 * `load-archive.ts` 가 첫 접촉에만 `upsertPlayer` 를 부르는데 순회가 **날짜 오름차순**이라
 * 첫 접촉 = 가장 오래된 경기다. 실측(box 7,805장 전수 재파싱): 드리프트 **109명 전원이 옛 이름** ·
 * 배포물 **12,862/15,439장(83.3%)** 이 그중 최소 한 명을 옛 이름으로 그렸다.
 * 실제 피해: 2026 화면에 `石川` 이 **두 사람** 나온다(NPB 는 그 해 `石川慎`/`石川柊` 로 구별한다) —
 * **충돌은 우리가 만든 것**이다.
 *
 * ⚠**「최신이 이긴다」로 고치면 오히려 나빠진다.** NPB 박스 표기는 「신·구 등록명」이 아니라
 * **그 시점의 로스터 식별 표기**라 방향이 양쪽이다(`松井雅→松井` · `山田哲→山田`).
 * 실측(분모 6,207쌍): 최초 고정 **390 틀림** → **최종 고정 409 틀림**.
 * 옳은 것은 **그 시즌 화면에는 그 시즌의 이름**이다.
 *
 * ## 왜 조각으로 두는가
 *
 * 이름을 내는 자리가 **15곳**이다(`season` 2 · `splits` 4 · `situational` 2 · `batted-ball` ·
 * `count` · `gidp` · `relief` · `steal` · 그리고 `web/query.ts` 의 통산표 2곳).
 * ⚠**일부만 바꾸면 같은 사이트 안에서 이름이 갈린다** — M1 이 막으려는 바로 그 병이다.
 * 그래서 SQL 을 손으로 적지 않고 여기서 만든다.
 *
 * ⚠**`LEFT JOIN` 이다.** 그 시즌 행이 없으면(적재를 아직 안 돌린 DB 등) `player.display_name` 으로
 * 떨어져야 한다 — `JOIN` 으로 두면 **선수가 통째로 사라진다.**
 */

import type { Db } from "@bb-app/store";

/** 시즌별 표시명 표에 붙이는 `LEFT JOIN` 한 줄 */
export function seasonNameJoin(idExpr: string, seasonExpr: string, alias = "psn"): string {
  return `LEFT JOIN player_season_name ${alias} ON ${alias}.player_id = ${idExpr} AND ${alias}.season = ${seasonExpr}`;
}

/**
 * 화면에 낼 이름.
 *
 * @param playerAlias `player` 표의 별칭. **폴백이다** — 그 시즌 행이 없을 때만 쓰인다
 */
export function seasonNameExpr(playerAlias: string, alias = "psn"): string {
  return `COALESCE(${alias}.display_name, ${playerAlias}.display_name)`;
}

/**
 * **통산(여러 시즌) 표에 쓸 이름** — 「범위 안에서 **가장 나중 시즌**의 이름」.
 *
 * ⚠**시즌 표와 규칙이 다르다. 다를 수밖에 없다.** 통산 행 하나는 여러 시즌을 묶은 것이라
 * 「그 시즌의 이름」이 애초에 하나로 정해지지 않는다. `seasonNameJoin` 을 그대로 쓰면
 * SQL 이 그룹 안의 **아무 행**이나 고르고(비결정적), JS 로 접으면 **가장 오래된 것**이 이긴다 -
 * 그건 지금 고치고 있는 결함 그 자체다.
 *
 * ⚠**「보고 있는 시즌의 이름」으로 두지 않은 이유**: 통산표에는 **그 시즌에 안 뛴 선수**가 들어온다
 * (은퇴·이적·2군). 그러면 시즌 행이 없어 `player.display_name` 으로 떨어지는데 그 값은
 * **아카이브에서 가장 오래된 이름**이라 결국 옛 이름이 나간다. 「범위 안 최신」이면
 * 그 선수의 **마지막 등록명**이 나가고, 그 시즌에 뛴 선수는 어차피 시즌 이름과 같아진다 -
 * **같은 페이지 안에서 이름이 갈리지 않는다**(M1).
 *
 * ⚠**`MAX(season)` 과 나란한 맨 컬럼은 그 최대 행의 값이다** - SQLite 가 문서로 보증하는 동작이다
 * (min/max 집계가 정확히 하나일 때). 다른 DB 로 옮기면 이 줄부터 깨진다.
 *
 * @param seasonExpr 범위의 끝(포함). 보통 **보고 있는 시즌**이다
 */
export function careerNameJoin(idExpr: string, seasonExpr: string, alias = "psn"): string {
  return `LEFT JOIN (SELECT player_id, display_name, MAX(season) AS season
                       FROM player_season_name WHERE season <= ${seasonExpr}
                      GROUP BY player_id) ${alias} ON ${alias}.player_id = ${idExpr}`;
}

/**
 * `careerNameJoin` 의 **JS 쌍둥이** — 같은 규칙을 SQL 로 못 거는 자리에서 쓴다.
 *
 * ⚠**두 벌이 되는 것이 M1 위반처럼 보이지만, 규칙은 한 곳(이 파일)에 있고 표현만 둘이다.**
 * 조인을 못 쓰는 자리가 실재한다 — 火消し 표는 **여러 시즌을 한 번 조회해 두고 시즌마다 잘라 쓰므로**
 * 이름을 조회 시점에 박으면 다른 시즌 화면이 틀린다. 그래서 **접는 시점에** 푼다.
 * ⚠**둘이 같은 답을 내는지는 시험이 못 박는다**(`season-name-seasons.test.ts`).
 *
 * @param season 범위의 끝(포함) — 보고 있는 시즌
 */
export function careerNames(db: Db, season: number): ReadonlyMap<string, string> {
  const rows = db.raw
    .prepare(
      `SELECT player_id AS id, display_name AS n, MAX(season) AS s
         FROM player_season_name WHERE season <= ? GROUP BY player_id`,
    )
    .all(season) as unknown as { id: string; n: string; s: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}
