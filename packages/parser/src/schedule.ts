/**
 * npb.jp 월간 일정 페이지에서 **구장**을 읽는다.
 *
 * ⚠**구장을 경기 페이지에서 뽑지 마라.** 경기 페이지(`index.html`)에는 그날 다른 경기들의
 * 스코어 박스가 함께 실려 있어서, 첫 번째 `（…）`를 집으면 **남의 구장**이 온다.
 * 실측(2026-08-15): 8/14 경기 페이지에서 8/15 경기의 구장이 먼저 잡혔다.
 *
 * 일정 페이지에는 경기마다 `<div class="place">…</div>`가 **구조화되어** 있고,
 * 그것이 그 경기의 것이라는 보장이 있다.
 *
 * ⚠**여기 한 벌만 둔다**(M1). 수집기(`@bb-app/archiver`)와 적재기(`@bb-app/store`)가
 * 같은 함수를 쓴다 — 두 벌로 두면 구장이 서로 다른 화면이 나온다.
 */

/** 경기 링크 경로 → 구장명. 폭 맞춤용 전각 공백은 접는다(`normalizeVenue`) */
export type VenueByPath = ReadonlyMap<string, string>;

/**
 * 구장명 정리.
 *
 * ⚠**npb.jp는 짧은 구장명을 전각 공백으로 채워 폭을 맞춘다**(`神　宮` · `横　浜` · `那　覇`).
 * 그대로 두면 구장별 집계의 **키**가 되므로, 같은 구장이 표기 흔들림으로 갈라질 위험이 있고
 * 화면에도 구멍이 뚫린 채 나온다. 파서가 소스별 1벌이라는 원칙(M7)에 맞춰 여기서 한 번만 접는다.
 *
 * ⚠**원시 아카이브는 손대지 않는다**(M4). 이 함수는 파생 값을 만들 뿐이고,
 * 「원본이 뭐라고 썼는가」는 저장된 HTML에 그대로 남는다.
 */
export function normalizeVenue(raw: string): string {
  return (
    raw
      .replace(/&nbsp;/g, " ")
      // 전각 공백은 **폭 맞춤용 패딩**이다. 구장명 안에 뜻 있는 전각 공백이 들어가는 예는 없다
      .replace(/　/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const GAME_HREF = /\/scores\/(\d{4})\/(\d{2})(\d{2})\/([a-z0-9]+(?:-[a-z0-9]+)+)\//g;

/**
 * 경기 링크 **뒤에서 가장 가까운** `place` 칸까지의 거리 상한.
 *
 * 일정 표의 한 행은 `[팀·스코어(링크)] [place·time·weather] [comment]` 순이라
 * 구장은 링크 뒤에 온다. ⚠**앞에서 찾으면 이전 경기의 구장을 집는다.**
 * ⚠창을 넓히면 다음 경기 행까지 넘어가 조용히 틀린 값이 된다 — 좁게 잡는다.
 */
const VENUE_WINDOW = 900;

export function parseScheduleVenues(html: string): VenueByPath {
  const out = new Map<string, string>();
  for (const m of html.matchAll(GAME_HREF)) {
    const [, yyyy, mm, dd, slug] = m;
    if (!yyyy || !mm || !dd || !slug) continue;
    const path = `/scores/${yyyy}/${mm}${dd}/${slug}/`;
    if (out.has(path)) continue;
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + VENUE_WINDOW);
    const v = /<div class="place">([^<]*)<\/div>/.exec(after);
    const raw = normalizeVenue(v?.[1] ?? "");
    if (raw !== "") out.set(path, raw);
  }
  return out;
}

/** `2026/0814/b-f-19` 형태의 경기 ID로 뒤집은 표. 적재기가 쓰는 모양이다 */
export function venuesByGameId(html: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [path, venue] of parseScheduleVenues(html)) {
    const m = /^\/scores\/(\d{4})\/(\d{4})\/([^/]+)\/$/.exec(path);
    if (m) out.set(`${m[1]}/${m[2]}/${m[3]}`, venue);
  }
  return out;
}
