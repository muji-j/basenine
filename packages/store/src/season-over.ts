/**
 * **이 시즌이 이미 끝났는가** — 판정은 이 파일 한 벌이다(M1).
 *
 * ⚠**`packages/web/src/query.ts` 에서 옮겨 왔다**(2026-09-11 · 오프시즌·휴식기 설계 D10). 화면(시즌 종료 띠 · 구단 캘린더 ·
 * 연속기록 제목)과 **수집 감시**(`scripts/freshness.ts` 의 백스톱 · `starters-behind` 가드)가 같은 판정을 써야 해서다 —
 * 두 벌로 두면 「화면은 끝났다는데 감시는 시즌 중이라고 한다」가 언젠가 난다.
 * ⚠**`Db` 도 `DatabaseSync` 도 받는다** — 감시 스크립트는 `node:sqlite` 를 직접 연다.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./db.ts";

function rawOf(src: Db | DatabaseSync): DatabaseSync {
  return "raw" in src ? src.raw : src;
}

/**
 * **이 시즌이 이미 끝났는가.**
 *
 * ⚠**「끝났다」와 「아직 안 받았다」는 다른 말이다**(M12). 둘 다 화면에서는
 * 「앞으로의 경기가 0건」으로 보이므로, 구별하지 않으면 4년 전 시즌에 대고
 * 「まだ取り込んでいません」이라고 말하게 된다 — 실측 48/48장이 그랬다(2026-08-18 감사 P1).
 *
 * ⚠**배선을 늘리지 않고 데이터로 답한다**: **더 나중 시즌의 경기가 있으면** 그 시즌은 끝났다.
 * 정의상 참이고 인자를 하나도 더 받지 않는다.
 * ⚠**오프시즌의 현재 시즌은 「끝났다」로 잡히지 않는다** — 그때는 「다음 시즌 일정을 아직 안 받았다」가
 *   사실이므로 그 문구가 맞다.
 */
export function seasonIsOver(src: Db | DatabaseSync, season: number): boolean {
  const later = ((rawOf(src)
    .prepare("SELECT COUNT(*) AS n FROM game WHERE season > ?")
    .get(season)) as unknown as { n: number }).n > 0;
  if (later) return true;
  return japanSeriesDecided(src, season);
}

/**
 * **그 시즌의 일본시리즈가 결착났는가** — 오프시즌을 메우는 둘째 근거.
 *
 * 일본시리즈는 NPB 시즌의 **마지막 행사**다. 한 팀이 4승에 닿으면 시리즈가 끝나고
 * 그것으로 시즌도 끝난다 — **정의상 참**이고 날짜를 읽지 않는다(M6).
 *
 * ⚠**「4경기」가 아니라 「4승」이다.** 일본시리즈에는 무승부가 있다 —
 * 2018년은 **6경기에 4승 1패 1무**였다(실측). 경기 수로 세면 그 해가 틀린다.
 * ⚠**득점을 못 읽은 경기는 승패를 모른다**(M11) — NULL 은 세지 않는다.
 * ⚠**클라이맥스 시리즈는 근거가 아니다** — 그 뒤에 일본시리즈가 남아 있다.
 *
 * 실측(2026-08-21 · 보유 완결 8시즌): **8/8 전부** 한 팀이 정확히 4승에 도달한다.
 * ⚠**그래도 `false` 는 여전히 「모른다」다**(M11) — 일본시리즈를 아직 안 받았을 수 있다.
 * ⚠**`nipponSeriesRecord` 의 「알려진 4승이 있는가」만 본다**(2026-10-24 · 설계 D4) — 화면의 시리즈 성적과 한 벌이다(M1).
 *   득점을 못 읽은 경기가 있어도 알려진 4승은 결착이다(그 경기를 모른다고 이미 이긴 4승이 없어지지 않는다).
 */
export function japanSeriesDecided(src: Db | DatabaseSync, season: number): boolean {
  for (const r of nipponSeriesRecord(src, season).byTeam.values()) if (r.w >= 4) return true;
  return false;
}

/** 日本シリーズ 한 구단의 승·패·분 */
export interface SeriesLine {
  w: number;
  l: number;
  t: number;
}

/**
 * 日本シリーズ 성적 — 결착 판정(`japanSeriesDecided`)과 試合·홈 카드의 「対戦成績」이 쓰는 **한 벌**(설계 D4).
 */
export interface NipponSeriesRecord {
  /** 구단 → 그 날짜까지의 승·패·분. **득점을 읽은 경기만** 센다 */
  byTeam: Map<string, SeriesLine>;
  /**
   * 치렀는데(`played`) 득점을 못 읽은 경기 수 — 결과를 모른다(M11).
   * ⚠**0 이 아니면 화면은 성적을 말하지 않는다** — 「2勝1敗」라고 쓰면 모르는 경기를 없는 것으로 친 것이 된다.
   * ⚠**중지(`notPlayed`)는 여기에도 성적에도 안 든다** — 경기가 없었던 것이지 모르는 것이 아니다.
   */
  unknownGames: number;
}

/**
 * 그 시즌 日本シリーズ의 **`through` 까지(그날 포함)** 성적.
 *
 * ⚠**「4경기」가 아니라 「4승」이다** — 무승부가 있다(2018 은 4勝1敗1分 · 실측). 무승부는 양쪽 `t` 에 든다.
 * ⚠**날짜로 자른다** — 日本シリーズ는 하루 한 경기라 「그 경기까지」가 「그날까지」와 같다(같은 팀 같은 날 2경기 0/16,086 팀-일 실측).
 * ⚠**시계를 읽지 않는다**(M6) — `through` 는 호출자가 준다.
 */
export function nipponSeriesRecord(src: Db | DatabaseSync, season: number, through = "9999-12-31"): NipponSeriesRecord {
  const rows = rawOf(src)
    .prepare(
      `SELECT away_code AS away, home_code AS home, away_runs AS ar, home_runs AS hr
       FROM game
       WHERE season = ? AND competition = 'nipponSeries' AND status = 'played' AND game_date <= ?
       ORDER BY game_date, game_id`,
    )
    .all(season, through) as unknown as { away: string; home: string; ar: number | null; hr: number | null }[];
  const byTeam = new Map<string, SeriesLine>();
  const line = (code: string): SeriesLine => {
    const cur = byTeam.get(code);
    if (cur !== undefined) return cur;
    const fresh = { w: 0, l: 0, t: 0 };
    byTeam.set(code, fresh);
    return fresh;
  };
  let unknownGames = 0;
  for (const r of rows) {
    if (r.ar === null || r.hr === null) {
      unknownGames += 1;
      continue;
    }
    const away = line(r.away);
    const home = line(r.home);
    if (r.ar === r.hr) {
      away.t += 1;
      home.t += 1;
    } else if (r.ar > r.hr) {
      away.w += 1;
      home.l += 1;
    } else {
      home.w += 1;
      away.l += 1;
    }
  }
  return { byTeam, unknownGames };
}
