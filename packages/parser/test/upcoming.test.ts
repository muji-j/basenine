/**
 * 월간 일정 표에서 **앞으로의 경기**를 읽는다.
 *
 * ⚠**합성 픽스처를 믿지 않는다.** 이 리포는 이미 한 번 당했다 — 구형 박스 픽스처에
 * 「타석 결과 칸이 0개」여서, 파서가 항상 빈 배열을 내도 시험이 전부 초록이었다(CLAUDE.md §2-2).
 * 그래서 **실물 아카이브**(`data/archive/npb/games/2026/schedule_08.html.gz`)로 잰다.
 * ⚠**픽스처를 리포에 고정한다.** 예전에는 `data/archive/` 를 직접 읽고 **없으면 건너뛰었는데**,
 * 아카이브는 리포에 없으므로(용량) **CI 에서는 이 파일이 통째로 안 돌았다** — 그리고 종료 코드는 0이라
 * 「합격」으로 읽혔다(2026-08-18 감사 P2). 이 파일 머리말이 금지한 바로 그 패턴을 자기가 밟고 있었다.
 * → 실물 2026-07·08 월간 페이지를 **14KB·15KB 로 픽스처에 넣었다**. 이제 어디서든 돈다.
 * ⚠**합성 픽스처가 아니라 실물이다** — 위 문단의 이유가 그대로 살아 있다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseUpcoming } from "../src/upcoming.ts";

/** ⚠**이 파일 위치에서 푼다** — `packages/parser` 에서 돌리든 리포 뿌리에서 돌리든 같아야 한다 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (name: string): string =>
  gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");

const html = read("2026-08-schedule.html.gz");

test("⚠월간 페이지는 그 달 전체를 담는다 — 치러진 것과 앞으로의 것이 함께 있다", () => {
  const r = parseUpcoming(html, 2026);
  const played = r.games.filter((g) => g.played);
  const future = r.games.filter((g) => !g.played);
  // 실측(2026-08-17): 8월 = 치러진 83 + 앞으로 70
  assert.equal(played.length, 83, `치러진 경기 수가 다르다: ${played.length}`);
  assert.equal(future.length, 70, `앞으로의 경기 수가 다르다: ${future.length}`);
  assert.equal(r.unreadableRows, 0, "못 읽은 행이 있다 — 표기가 바뀌었다(M7)");
});

/**
 * ⚠**여기가 이 파서의 급소다.** `team1`/`team2` 를 뒤집으면 구장·홈어드밴티지·승패가 전부 뒤집히는데,
 * **화면에는 그럴듯하게 나온다** — 조용히 틀리는 종류다.
 * 실측으로 확정했다: 아카이브 6개월 · 점수 링크가 있는 675건을 DB 와 대조해 전부 일치.
 */
test("⚠team1 이 홈, team2 가 원정이다 — 뒤집으면 조용히 틀린다", () => {
  const r = parseUpcoming(html, 2026);
  // 실측한 한 경기로 못 박는다: 2026/0818 は DeNA(홈, 横浜) 대 巨人
  const g = r.games.find((x) => x.date === "2026-08-18" && x.homeCode === "db");
  assert.notEqual(g, undefined, "8/18 DeNA 홈 경기를 못 찾았다");
  assert.equal(g!.awayCode, "g", "원정이 巨人이 아니다 — 홈·원정이 뒤집혔다");
  assert.equal(g!.venue, "横浜", `구장이 다르다: ${g!.venue}`);
  assert.equal(g!.startTime, "17:45", `개시 시각이 다르다: ${g!.startTime}`);
});

/**
 * ⚠**구단이 아닌 행을 조용히 버리지 않는다**(M11). 올스타는 `セ・リーグ`/`パ・リーグ` 로 나온다 —
 * 세지 않으면 「경기가 몇 건 사라졌는지」를 아무도 모른다.
 */
test("⚠구단이 아닌 행은 세어서 돌려준다 — 조용히 버리지 않는다", () => {
  const r = parseUpcoming(read("2026-07-schedule.html.gz"), 2026);
  // 2026 올스타는 7/28·7/29 두 경기다(실측)
  assert.equal(r.nonTeamRows, 2, `올스타 행 수가 다르다: ${r.nonTeamRows}`);
  assert.ok(!r.games.some((g) => g.homeCode === "cl" || g.homeCode === "pl"), "올스타가 경기로 섞였다");
});

/** 경기가 없는 날(월요일 등)은 결손이 아니다 — 그 행에는 팀 칸 자체가 없다 */
test("경기 없는 날을 「못 읽음」으로 세지 않는다", () => {
  const r = parseUpcoming(html, 2026);
  assert.equal(r.unreadableRows, 0);
  // 8/17(월)·8/24(월)에는 경기가 없다
  assert.ok(!r.games.some((g) => g.date === "2026-08-17"), "경기 없는 날에 경기가 생겼다");
});

/**
 * ⚠**이름이 본문과 반대였다**(2026-08-18 감사 P2에서 정정).
 * 예전 이름은 「모르는 구단 표기가 오면 **던진다**」였는데 본문은 **던지지 않는 것**을 검증한다 —
 * 읽는 사람에게 「M7 강제가 걸려 있다」고 믿게 만드는 시험이었다.
 *
 * ⚠**던지지 않는 것이 맞다.** 이 표에는 구단이 아닌 행이 정상적으로 섞인다(올스타의
 * `セ・リーグ`/`パ・リーグ`). 던지면 7월 페이지가 통째로 실패한다.
 * M7(조용한 결손 금지)은 **`nonTeamRows` 로 세어 돌려주는 것**으로 지킨다 —
 * 그 수가 늘면 `load-upcoming` 이 멈춘다.
 */
test("모르는 구단 표기는 던지지 않고 nonTeamRows 로 센다 — 올스타와 같은 취급", () => {
  const bad = '<table><tr id="date0401"><td><div class="team1">火星</div><div class="team2">巨人</div></td></tr></table>';
  const r = parseUpcoming(bad, 2026);
  // 구단 약칭이 아니므로 nonTeamRows 로 세고 던지지 않는다 — 올스타와 같은 취급
  assert.equal(r.games.length, 0);
  assert.equal(r.nonTeamRows, 1, "모르는 표기를 세지 않았다");
});
