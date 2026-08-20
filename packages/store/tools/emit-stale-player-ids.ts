/**
 * **다시 받아야 할 선수**만 내보낸다. 선수 페이지 아카이버의 입력이 된다.
 *
 *   node packages/store/tools/emit-stale-player-ids.ts data/bb.sqlite > data/stale-ids.txt
 *
 * ⚠**이것이 없어서 통산 기록이 조용히 낡았다**(2026-08-17).
 * 선수 페이지 아카이버는 `skipExisting` 이 기본이라 **한 번 받은 페이지를 다시 받지 않는다.**
 * 그래서 `career_batting` 의 올해 행이 최초 취득 시점에 얼어 있었다 —
 * 실측 당시 698장이 8/15, 3장이 8/16, 그 뒤로 0장이었고, 이미 안타 213·홈런 25가 밀려 있었다.
 * 더 나쁜 것은 **시즌이 바뀌는 순간** 그 얼어붙은 행이 그대로 「확정된 작년 성적」이 되어
 * 전 선수의 통산이 **한 번에 줄어든다**는 것이다.
 *
 * ## ⚠그 처방이 절반만 들었다 — **날짜로 「낡음」을 판정할 수 없다**(2026-08-20)
 *
 * 처음 처방은 「마지막 출장일 ≥ 페이지를 받은 날」이었다. 그 판정은 **npb.jp 가 경기 직후
 * 선수 페이지를 갱신한다**는 것을 전제로 하는데, **그렇지 않다.**
 * ⚠실측: **08-19 01:05 JST 에 받은 페이지가 08-18 경기를 아직 담고 있지 않았다.**
 * 크론이 도는 시각(02:00 JST)에는 전날 경기가 아직 안 실린다.
 *
 * 그러면 이렇게 된다 — 08-18 에 뛴 선수를 08-19 에 받는다 → 받은 날(08-19)이 마지막 출장일(08-18)
 * **보다 뒤**이므로 그 선수는 「최신」으로 판정된다 → **그 경기는 영영 안 실린다.**
 * ⚠**이건 그날 하루의 문제가 아니다.** 그 선수가 다음에 뛰면 다시 후보가 되지만,
 * **그 뒤로 안 뛰면 그 사본이 영구히 남는다** — 시즌 최종전 출장자 전원과 은퇴 선수가 그렇다.
 * 화면의 `通算成績` 과 `記録に近づいている`(마디까지 남은 수)가 **실제보다 큰 수**로 나간다.
 *
 * ⚠**피해 실측(CI DB · 최신 경기 08-19 · 2026-08-20)**:
 * 통산행을 가진 **1,643명 중 264명**이 「내용이 모자란 사본」을 들고 있었고,
 * **그 264명 전원을 옛 판정식은 한 명도 다시 뽑지 않았다**(옛 판정식이 그날 뽑은 인원 = **0명**).
 * 즉 신선도 장치가 **매일 「할 일 없음」이라고 보고하면서 264명분을 밀어 두고** 있었다.
 *
 * ## 그래서 무엇으로 판정하는가 — **날짜가 아니라 「내용이 모자란가」**
 *
 * 「며칠 지났나」를 재는 대신 **사본 스스로 말하는 출장량**을 우리 집계와 맞댄다.
 * 공표 출장량이 우리보다 **적으면** 그 사본에는 우리가 아는 경기가 안 실려 있다 — 그게 낡음이다.
 * ⚠**여유 N일을 손으로 정하지 않는다.** 그 N 은 npb.jp 의 갱신 시각이 바뀌는 순간 낡고,
 * 낡았다는 사실이 **아무 데도 안 나타난다.**
 *
 * | 무엇 | 우리 쪽 | 공표 쪽 | 근거 |
 * |---|---|---|---|
 * | 타자 打席 | `batting_line.pa` 합 | `career_batting.pa` 합 | 완결 8시즌 **5,509 선수-시즌 전건 일치** |
 * | 타자 試合 | `batting_line` 의 경기 수 | `career_batting.games` 합 | 정의가 다르지만 **한 방향으로만** 다르다(아래) |
 * | 투수 試合 | `pitching_line` 의 경기 수 | `career_pitching.games` 합 | 완결 8시즌 **2,773 선수-시즌 전건 일치** |
 *
 * ⚠**타자 試合 는 「같다」를 요구하지 않는다 — 「공표가 더 적을 수 없다」만 요구한다.**
 * 공표는 **出場試合**이고 우리는 **打撃記録のある試合**이라 공표가 항상 크거나 같다.
 * 실측(완결 8시즌 5,509건): 공표가 **더 적은 경우 0건** · 더 많은 경우 2,066건(정의 차이).
 * → 그래서 「공표 < 우리」는 정의 차이로 설명되지 않고 **낡음으로만 설명된다.**
 * ⚠**이 열이 打席 의 사각지대를 메운다**: 대주자·守備固め는 打席 를 안 늘린다.
 * 실측 2026 정규시즌에 `pa=0` 인 출장 기록이 **3,431행** 있고, 打席 만 보면 171명인 것이
 * 試合 를 같이 보면 **179명**이다.
 *
 * ⚠**「그 해 행이 아예 없다」도 낡음이다.** 사본이 그 시즌보다 오래되면 조인할 상대가 없어
 * 위 비교가 **한 번도 안 돌아간다**(조용한 통과 · M7). 실측으로 3명이 여기에 걸렸고,
 * 셋 다 2026 출장이 08-18·08-19 하루뿐인 선수였다 — 정확히 반영 지연이다.
 *
 * ⚠**「우리가 더 적은」 쪽은 여기서 다루지 않는다.** 공표 > 우리는 **우리 수집 누락**이고,
 * 그건 재취득으로 안 고쳐진다. `packages/aggregate/test/published-check.test.ts` 가 그쪽을 본다.
 *
 * ⚠**이 판정이 영구 루프가 되지 않는다는 근거**(L1): 공표가 우리보다 적은 상태가 **영원히**
 * 남으면 그 선수를 매일 다시 친다. 완결 8시즌 실측에서 그런 선수-시즌은 **0건**이다
 * (타자 打席 0/5,509 · 타자 試合 0/5,509 · 투수 試合 0/2,773). 낡음은 전부 **진행 중 시즌**에서만 났고,
 * 실측한 264명의 마지막 출장일은 전원 **08-18(73명)·08-19(191명)** — 즉 최근 이틀이다.
 * ⚠**그래도 감시는 필요하다** — 우리 파싱이 과다 계상하면 그 선수가 영구 후보가 된다.
 * 그래서 아래 보고가 **선정 사유별 인원**을 낸다. 「출장량 부족」이 줄지 않으면 그건 반영 지연이 아니다.
 *
 * ⚠**날짜 판정을 지우지 않고 남긴다.** 「받은 날 ≤ 마지막 출장일」은 출장량 판정이 못 보는
 * 경우(그 경기에서 打席·登板·出場 어느 것도 안 늘어난 경우)의 그물이고, 실측상 요청을
 * 늘리지 않는다 — 옛 판정식이 뽑는 인원이 이미 0명이라 합집합이 그대로 264명이다.
 *
 * ⚠**전원 재취득은 하지 않는다**(L1). 980명을 매일 받으면 3초 간격으로 약 50분이고,
 * 그중 대부분은 **어차피 안 바뀐 페이지**다.
 * ⚠`lastModified`·`etag` 가 둘 다 `null` 이라 조건부 요청(L7)으로는 줄일 수 없다 —
 * 실측으로 확인했다(아카이브 meta.json **980/980 이 둘 다 null**). 줄일 수 있는 지렛대는 **대상 선정**뿐이다.
 *
 * ⚠**취득 시각을 모르는 선수(`fetched_at` 결손)는 대상에 넣는다.** 「모른다」를 「최신」으로
 * 취급하면 영영 안 받는다(M11).
 */
import { openDb } from "../src/db.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node tools/emit-stale-player-ids.ts <db-path> [--limit N]");
  process.exit(2);
}
const limitArg = process.argv.indexOf("--limit");
/**
 * 하루치 상한. ⚠**있어야 한다** — 백필 직후처럼 「전원이 낡은」 날이 실재하고,
 * 그날 980요청을 한 번에 보내면 L1 의 정신(하루 1회 배치 · 저빈도)에서 벗어난다.
 * ⚠**넘친 몫은 반드시 보고한다**(§3-7: 조용한 절단은 「전부 했음」으로 읽힌다).
 */
const limit = limitArg === -1 ? 400 : Number(process.argv[limitArg + 1]);
if (!Number.isInteger(limit) || limit <= 0) {
  console.error(`--limit 이 양의 정수가 아니다: ${process.argv[limitArg + 1]}`);
  process.exit(2);
}

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

/**
 * 판정에 쓰는 공통 조각.
 *
 * ⚠**「마지막 출장일」은 대회를 가리지 않는다** — 올스타·포스트시즌에 나와도 선수 페이지는
 * 갱신될 수 있고, 여기서 고르는 것은 「집계 대상」이 아니라 「다시 받을 대상」이다.
 * ⚠**출장량 대조는 반대로 `competition='regular'` 만 본다** — 年度別成績 표가 정규시즌이기 때문이다.
 * 실측: 이 경계를 지키면 완결 8시즌이 전건 일치하고, 안 지키면 올스타·CS 만큼 우리가 더 커져서
 * **전 선수가 영구 후보가 된다.**
 */
const COMMON = `
  WITH appearance AS (
    SELECT b.player_id AS id, MAX(g.game_date) AS last
      FROM batting_line b JOIN game g ON g.game_id = b.game_id
     WHERE g.status = 'played'
     GROUP BY b.player_id
    UNION ALL
    SELECT t.player_id AS id, MAX(g.game_date) AS last
      FROM pitching_line t JOIN game g ON g.game_id = t.game_id
     WHERE g.status = 'played'
     GROUP BY t.player_id
  ),
  last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id),
  fetched AS (
    /**
     * JST 로 맞춘다(§2-1). fetched_at 은 ISO UTC 이고 game_date 는 JST 경기일이다.
     * 그냥 앞 10글자를 자르면 JST 00:00~08:59 에 받은 페이지가 하루 이르게 기록된다.
     * 지금 크론은 17:00 UTC(=02:00 JST)라 우연히 안전한 쪽으로만 어긋나지만,
     * 손으로 다른 시각에 돌리면 그 우연이 깨진다 — 우연에 기대지 않는다.
     * fetched_at 이 NULL 이면 datetime() 도 NULL 이다 — 「모른다」가 그대로 흐른다(M11).
     */
    SELECT player_id AS id, MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS day
      FROM (SELECT player_id, fetched_at FROM career_batting
            UNION ALL
            SELECT player_id, fetched_at FROM career_pitching)
     GROUP BY player_id
  ),
  ours_bat AS (
    SELECT g.season AS y, b.player_id AS id,
           SUM(b.pa) AS pa, COUNT(DISTINCT b.game_id) AS gm
      FROM batting_line b JOIN game g ON g.game_id = b.game_id
     WHERE g.status = 'played' AND g.competition = 'regular'
     GROUP BY g.season, b.player_id
  ),
  ours_pit AS (
    SELECT g.season AS y, t.player_id AS id, COUNT(DISTINCT t.game_id) AS gm
      FROM pitching_line t JOIN game g ON g.game_id = t.game_id
     WHERE g.status = 'played' AND g.competition = 'regular'
     GROUP BY g.season, t.player_id
  ),
  /** ⚠**연도로 접는다** — 시즌 도중 이적하면 공표표에 그 해 행이 둘이다(키가 선수·연도·구단) */
  pub_bat AS (
    SELECT year AS y, player_id AS id, SUM(pa) AS pa, SUM(games) AS gm
      FROM career_batting GROUP BY year, player_id
  ),
  pub_pit AS (
    SELECT year AS y, player_id AS id, SUM(games) AS gm
      FROM career_pitching GROUP BY year, player_id
  ),
  /**
   * **사본에 우리가 아는 경기가 빠져 있는 선수.**
   * ⚠네 갈래 전부 「공표 < 우리」 방향뿐이다. 반대 방향(공표 > 우리)은 우리 수집 누락이고
   * 재취득으로 안 고쳐진다 — 여기서 뽑으면 **영구 루프**가 된다(보유 시즌 밖 = 2017 이전이 전부 그렇다).
   */
  lagging AS (
    SELECT o.id AS id FROM ours_bat o JOIN pub_bat p ON p.id = o.id AND p.y = o.y
     WHERE p.pa < o.pa OR p.gm < o.gm
    UNION
    SELECT o.id AS id FROM ours_pit o JOIN pub_pit p ON p.id = o.id AND p.y = o.y
     WHERE p.gm < o.gm
    UNION
    /** 사본이 그 시즌보다 오래됐다 — 조인할 상대가 없어 위 비교가 한 번도 안 돈다(M7) */
    SELECT o.id AS id FROM ours_bat o
     WHERE EXISTS (SELECT 1 FROM career_batting c WHERE c.player_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM pub_bat p WHERE p.id = o.id AND p.y = o.y)
    UNION
    SELECT o.id AS id FROM ours_pit o
     WHERE EXISTS (SELECT 1 FROM career_pitching c WHERE c.player_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM pub_pit p WHERE p.id = o.id AND p.y = o.y)
  ),
  /**
   * 「받을 수 없는 선수」를 가르는 선.
   *
   * ⚠**이 조건이 없으면 그들이 매일 몫의 앞자리를 먹는다**(2026-08-17 재검토 P1).
   * 선수 페이지는 **현재 등록 선수만** 확실히 받을 수 있으므로 NPB 를 떠난 선수는 받아도 안 온다.
   * 소급 시즌을 넣을수록 이 무리가 시즌당 100~160명씩 늘어 상한을 통째로 잠식한다
   * (실측 CI DB: **810명** · 마지막 출장 2018:101 · 2019:113 · 2020:96 · 2021:104 · 2022:132 ·
   *  2023:113 · 2024:121 · 2025:30).
   * ⚠**그건 백필의 일이지 「신선도 유지」의 일이 아니다.** 여기서는 빼고, 몇 명 뺐는지 보고에 낸다.
   * ⚠**벽시계가 아니라 데이터 기준이다**(M6) — 우리가 가진 마지막 경기일에서 센다.
   */
  cutoff AS (SELECT DATE(MAX(game_date), '-400 days') AS d FROM game WHERE status = 'played')
`;

const rows = db.raw
  .prepare(
    `${COMMON}
     SELECT p.player_id AS id, l.last AS last, f.day AS day,
            CASE WHEN g.id IS NULL THEN 0 ELSE 1 END AS lagging
       FROM player p
       JOIN last_seen l ON l.id = p.player_id
       LEFT JOIN fetched f ON f.id = p.player_id
       LEFT JOIN lagging g ON g.id = p.player_id
      WHERE (f.day IS NULL OR f.day <= l.last OR g.id IS NOT NULL)
        AND l.last >= (SELECT d FROM cutoff)
      ORDER BY l.last DESC, p.player_id`,
  )
  .all() as unknown as { id: string; last: string; day: string | null; lagging: number }[];

/**
 * ⚠**두 무리를 「최근에 뛴 순」 하나로 줄 세운다.**
 *
 * 처음에는 「한 번도 못 받은 선수」에게 **절대 우선**을 줬는데(`ORDER BY (day IS NULL) DESC`),
 * 그 무리가 상한을 넘는 날에는 「받았지만 낡은」 선수가 그날 **한 명도 못 들어간다**
 * (2026-08-17 재검토 P2). 개막 직후처럼 신인이 대거 등록되는 날이 그렇다.
 * ⚠`l.last DESC` 하나로 세우면 두 무리가 **섞여서** 들어가므로 어느 쪽도 굶지 않는다 —
 * 그리고 「가장 최근에 뛴 선수부터」가 곧 「화면에서 가장 눈에 띌 선수부터」다.
 */
for (const r of rows.slice(0, limit)) console.log(r.id);

const sent = rows.slice(0, limit);
/**
 * ⚠**사유별로 센다**(M7·§3-7). 합계만 내면 **어느 갈래가 죽어도 안 보인다** —
 * 실제로 옛 판정식은 매일 「0명」을 보고하면서 264명분을 밀어 두고 있었고,
 * 그 0 이 「할 일이 없다」인지 「판정이 고장났다」인지 로그로 구별할 수 없었다.
 * ⚠경기가 도는 동안 「출장량 부족」이 계속 0이면 그건 신선한 것이 아니라 **판정이 안 도는 것**이다.
 */
const never = rows.filter((r) => r.day === null).length;
const sentNever = sent.filter((r) => r.day === null).length;
const behind = rows.filter((r) => r.lagging === 1).length;
const dateOnly = rows.filter((r) => r.day !== null && r.lagging === 0).length;

/**
 * ⚠**제외한 수도 낸다**(§3-7: 「0건」과 「안 쟀음」을 구별한다).
 * 그리고 **그중 낡은 사본을 든 사람을 따로 센다** — 이쪽은 「고칠 수 있는데 안 고쳐지는 것」이
 * 아니라 **「받을 수 없어 못 고치는 것」**이라 성질이 다르다(M11).
 * 지금은 0명이지만 **시즌이 끝나면 반드시 생긴다** — 최종전을 뛰고 그대로 NPB 를 떠나는 선수다.
 * 실측(CI DB · 2026-08-20): 제외 810명 · 그중 낡은 사본 **0명**.
 */
const excludedRow = db.raw
  .prepare(
    `${COMMON}
     SELECT COUNT(*) AS n,
            SUM(CASE WHEN g.id IS NULL THEN 0 ELSE 1 END) AS stale
       FROM player p
       JOIN last_seen l ON l.id = p.player_id
       LEFT JOIN lagging g ON g.id = p.player_id
      WHERE l.last < (SELECT d FROM cutoff)`,
  )
  .get() as unknown as { n: number; stale: number | null };
const excluded = excludedRow.n;
const excludedStale = excludedRow.stale ?? 0;

console.error(
  `다시 받을 선수 ${rows.length}명 중 ${sent.length}명 출력 — ` +
    `사유별: 출장량 부족 ${behind}명 · 취득기록 없음 ${never}명 · 취득일 ≤ 마지막 출장일 ${dateOnly}명` +
    `（출력분 중 취득기록 없음 ${sentNever}명）` +
    ` · 최근 400일 미출장이라 제외 ${excluded}명` +
    // ⚠**받을 수 없는데 낡은 사본**은 재취득으로 안 고쳐진다 — 「0건」과 구별해서 낸다(M11)
    (excludedStale > 0
      ? ` — ⚠**그중 ${excludedStale}명은 낡은 사본을 든 채다**(페이지를 받을 수 없어 못 고친다)`
      : "（그중 낡은 사본 0명）") +
    // ⚠**밀린 수를 반드시 낸다** — 조용히 자르면 「전부 했음」으로 읽힌다(§3-7)
    (rows.length > limit
      ? ` — ⚠**${rows.length - limit}명이 오늘 몫에서 밀렸다**` +
        `(취득기록 없음 ${never - sentNever}명 포함 · 다음 실행에서 받는다)`
      : ""),
);
db.close();
