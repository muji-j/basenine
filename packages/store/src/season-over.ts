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
 */
export function japanSeriesDecided(src: Db | DatabaseSync, season: number): boolean {
  const rows = rawOf(src)
    .prepare(
      `SELECT away_code AS away, home_code AS home, away_runs AS ar, home_runs AS hr
       FROM game
       WHERE season = ? AND competition = 'nipponSeries' AND status = 'played'
         AND away_runs IS NOT NULL AND home_runs IS NOT NULL`,
    )
    .all(season) as unknown as { away: string; home: string; ar: number; hr: number }[];
  const wins = new Map<string, number>();
  for (const r of rows) {
    if (r.ar === r.hr) continue; // 무승부는 승이 아니다
    const w = r.ar > r.hr ? r.away : r.home;
    wins.set(w, (wins.get(w) ?? 0) + 1);
  }
  for (const n of wins.values()) if (n >= 4) return true;
  return false;
}
