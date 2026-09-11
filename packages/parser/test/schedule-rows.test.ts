/**
 * 월간 일정 표의 **행 분류** — 공백 · 예정 표기 · 경기 · 구단 아님 · 못 읽음.
 *
 * ⚠**「날짜 행이 있다」만으로 「경기가 없는 달」을 인정하면 구조 변경을 못 막는다**(2026-09-11 · 콜드 리뷰 지적).
 * 경기 칸의 클래스만 바뀐 페이지도 날짜 행은 그대로라, 적재기가 그 달을 정상 휴식으로 받고 **기존 일정을 지운다.**
 * 그래서 「공백」을 **실물 마크업으로** 정의한다 — 날짜 머리칸을 뺀 모든 칸이 공백·`&nbsp;` 뿐인 행
 * (실물: `<th>11/3（月）</th><td>&nbsp;</td><td>&nbsp;</td>` · 2025년 11월 페이지).
 *
 * ⚠**합성 HTML 이지만 모양은 실물에서 옮겼다** — 치러진 경기는 `<a href="/scores/…/">` 가 점수 칸을 감싼다
 * (2025-10-30 행 실측). 설계: `docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md` §3-1 · D6.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScheduleRows, parseUpcoming } from "../src/upcoming.ts";

/** 실물 모양의 경기 행. `score` 를 주면 점수 숫자가, `link` 를 주면 점수 링크가 붙는다 */
function gameRow(
  mmdd: string,
  home: string,
  away: string,
  o: { score?: [number, number]; link?: string; quote?: '"' | "'"; teamClass?: string } = {},
): string {
  const q = o.quote ?? '"';
  const cls = o.teamClass ?? "team";
  const s1 = o.score === undefined ? "&nbsp;" : String(o.score[0]);
  const s2 = o.score === undefined ? "&nbsp;" : String(o.score[1]);
  const scores = `<div class="score1">${s1}</div><div class="state">-</div><div class="score2">${s2}</div>`;
  return `<tr id=${q}date${mmdd}${q} class="">
    <th class="" rowspan="1">${Number(mmdd.slice(0, 2))}/${Number(mmdd.slice(2))}（土）</th>
    <td>
      <div class="${cls}1">${home}</div>
      ${o.link === undefined ? scores : `<a href="${o.link}">${scores}</a>`}
      <div class="${cls}2">${away}</div>
    </td>
    <td><div class="place">甲子園</div><div class="time">18:00</div><div class="weather">&nbsp;</div></td>
  </tr>`;
}

/** 실물 모양의 공백 행 — 경기가 없는 날 */
function blankRow(mmdd: string): string {
  return `<tr id="date${mmdd}" class=" last">
    <th class="holiday" rowspan="1">${Number(mmdd.slice(0, 2))}/${Number(mmdd.slice(2))}（月）</th>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
  </tr>`;
}

/**
 * 실물 모양의 **예정 표기** 행 — 대진이 안 정해진 포스트시즌 자리(2026년 10월 페이지 실측 30행:
 * `セ・CSファーストS` · `パ・CSファイナルS` · `(予備日)` · `日本シリーズ セ本拠地球場` …).
 * ⚠**팀 칸이 없고 글자가 있다** — 「공백」도 「경기」도 아니다. 이걸 「못 읽음」으로 두면 **10월 일정을 받는 날 적재기가 멈춘다.**
 */
function placeholderRow(mmdd: string, label: string, withTh = true, place = ""): string {
  return `<tr id="date${mmdd}" class="">
    ${withTh ? `<th class="saturday" rowspan="2">${Number(mmdd.slice(0, 2))}/${Number(mmdd.slice(2))}（土）</th>` : ""}
    <td> <div class="commentLong">${label}</div> </td>
    <td> <div class="place">${place}</div> <div class="time"></div> <div class="weather"> &nbsp; </div> </td>
    <td> <div class="comment"></div> </td>
    <td>&nbsp;</td>
  </tr>`;
}

const page = (...rows: string[]): string => `<table>${rows.join("\n")}</table>`;

test("공백 행은 「경기가 없는 날」이다 — 못 읽음이 아니다", () => {
  const r = classifyScheduleRows(page(blankRow("1103"), blankRow("1104")), 2025);
  assert.equal(r.dateRows, 2);
  assert.equal(r.blank, 2);
  assert.equal(r.games.length, 0);
  assert.equal(r.nonTeam, 0);
  assert.equal(r.unreadable, 0);
});

test("점수 링크가 있으면 치러진 경기 · 없으면 앞으로의 경기다", () => {
  const r = classifyScheduleRows(page(
    gameRow("1030", "阪神", "ソフトバンク", { score: [2, 3], link: "/scores/2025/1030/t-h-05/" }),
    gameRow("1101", "ソフトバンク", "阪神"),
  ), 2025);
  assert.equal(r.dateRows, 2);
  assert.equal(r.unreadable, 0);
  assert.deepEqual(
    r.games.map((g) => [g.date, g.homeCode, g.awayCode, g.played]),
    [["2025-10-30", "t", "h", true], ["2025-11-01", "h", "t", false]],
  );
});

test("구단이 아닌 두 칸(올스타)은 따로 센다", () => {
  const r = classifyScheduleRows(page(gameRow("0723", "セ・リーグ", "パ・リーグ", { score: [4, 1], link: "/scores/2025/0723/c-p-01/" })), 2025);
  assert.equal(r.nonTeam, 1);
  assert.equal(r.games.length, 0);
  assert.equal(r.unreadable, 0);
});

/**
 * ⚠**모르는 약칭을 전부 「구단 아님」으로 빼면 약칭이 바뀌는 날 그 구단 경기가 조용히 빠진다**(2026-09-11 · 콜드 리뷰 지적).
 * 실물에서 「구단 아님」은 **올스타 두 표기뿐**이다(월간 일정 75장 · 16행 · `セ・リーグ`·`パ・リーグ`).
 */
test("⚠「구단 아님」은 올스타 표기만이다 — 모르는 약칭은 못 읽음이다", () => {
  const unknown = classifyScheduleRows(page(gameRow("0910", "巨人", "ジャイアンツ", { score: [3, 2], link: "/scores/2026/0910/g-x-01/" })), 2026);
  assert.equal(unknown.nonTeam, 0, "모르는 구단 약칭을 올스타처럼 조용히 뺐다");
  assert.equal(unknown.unreadable, 1);
  const bothUnknown = classifyScheduleRows(page(gameRow("0910", "ホークス", "タイガース")), 2026);
  assert.equal(bothUnknown.unreadable, 1);
  const mixed = classifyScheduleRows(page(gameRow("0723", "セ・リーグ", "阪神")), 2026);
  assert.equal(mixed.unreadable, 1, "올스타 표기와 구단이 섞인 행을 구단 아님으로 받았다");
});

test("⚠경기 칸의 클래스가 바뀌면 못 읽음이다 — 공백으로 받지 않는다", () => {
  const r = classifyScheduleRows(page(gameRow("1030", "阪神", "ソフトバンク", { teamClass: "club" })), 2025);
  assert.equal(r.dateRows, 1);
  assert.equal(r.blank, 0, "구단명이 든 칸을 공백으로 받았다 — 구조 변경이 「경기가 없는 달」로 통과한다");
  assert.equal(r.unreadable, 1);
});

test("⚠점수 숫자가 있는데 점수 링크가 없으면 못 읽음이다 — 링크 모양이 바뀐 것이다", () => {
  const r = classifyScheduleRows(page(gameRow("1030", "阪神", "ソフトバンク", { score: [2, 3] })), 2025);
  assert.equal(r.unreadable, 1, "치러진 경기를 「앞으로의 경기」로 받았다 — 치러짐 표시가 조용히 사라진다");
  assert.equal(r.games.length, 0);
});

test("링크만 있고 숫자가 없는 칸(중지 등)은 치러진 경기로 받는다", () => {
  const r = classifyScheduleRows(page(gameRow("0906", "ヤクルト", "中日", { link: "/scores/2026/0906/s-d-20/" })), 2026);
  assert.equal(r.unreadable, 0);
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0]!.played, true);
});

test("한 날짜에 경기가 여럿이면 같은 id 행이 반복된다 — 행마다 센다", () => {
  const r = classifyScheduleRows(page(
    gameRow("0902", "巨人", "DeNA"),
    gameRow("0902", "ヤクルト", "阪神"),
  ), 2026);
  assert.equal(r.dateRows, 2);
  assert.deepEqual(r.games.map((g) => g.date), ["2026-09-02", "2026-09-02"]);
});

test("⚠홑따옴표 id 도 날짜 행이다 — 좁게 잡으면 멀쩡한 페이지가 「날짜 행 0」이 된다", () => {
  const r = classifyScheduleRows(page(gameRow("0902", "巨人", "DeNA", { quote: "'" }), blankRow("0903")), 2026);
  assert.equal(r.dateRows, 2);
  assert.equal(r.games.length, 1);
  assert.equal(r.blank, 1);
});

test("⚠연도는 호출자가 준다 — 페이지에 없다", () => {
  const html = page(gameRow("0910", "巨人", "DeNA"));
  assert.equal(classifyScheduleRows(html, 2025).games[0]!.date, "2025-09-10");
  assert.equal(classifyScheduleRows(html, 2026).games[0]!.date, "2026-09-10");
});

test("⚠대진 미정 포스트시즌 자리(commentLong)는 「예정 표기」다 — 못 읽음도 공백도 아니다", () => {
  const r = classifyScheduleRows(page(
    placeholderRow("1010", "セ・CSファーストS"),
    placeholderRow("1010", "パ・CSファーストS", false),
    placeholderRow("1013", "(予備日)"),
    // ⚠일본시리즈 자리는 **장소 칸에도 임시 표기**가 있다(2026-10-24 행 실측) — 그래도 예정 표기다
    placeholderRow("1024", "日本シリーズ", true, "セ本拠地球場"),
  ), 2026);
  assert.equal(r.dateRows, 4);
  assert.equal(r.placeholder, 4);
  assert.equal(r.unreadable, 0, "실물 예정 표기를 구조 변경으로 받았다 — 10월 일정을 받는 날 적재가 멈춘다");
  assert.equal(r.blank, 0, "예정 표기를 「경기가 없는 날」로 받았다");
  assert.equal(r.games.length, 0);
});

test("⚠알려진 칸 밖에 글자가 있거나 표기 없이 장소만 있으면 못 읽음이다", () => {
  const empty = classifyScheduleRows(page(placeholderRow("1010", "")), 2026);
  assert.equal(empty.placeholder, 0);
  assert.equal(empty.blank, 1, "빈 commentLong 만 있는 행은 공백과 같다");
  // 팀명이 모르는 칸(클래스 변경)에 남은 행 — 예정 표기로 받으면 구조 변경이 가려진다
  const renamed = classifyScheduleRows(page(placeholderRow("1010", "セ・CSファーストS").replace("<td> <div class=\"commentLong\">", "<td> <div class=\"club1\">阪神</div> <div class=\"commentLong\">")), 2026);
  assert.equal(renamed.unreadable, 1, "모르는 칸에 글자가 있는데 예정 표기로 받았다");
  // 표기 없이 장소만 — 공백도 예정 표기도 아니다
  const placeOnly = classifyScheduleRows(page(placeholderRow("1010", "", true, "甲子園")), 2026);
  assert.equal(placeOnly.unreadable, 1, "표기 없이 장소만 있는 행을 공백이나 예정 표기로 받았다");
});

test("팀 칸이 있는데 비어 있으면 못 읽음이다(기존 규칙 유지)", () => {
  const r = classifyScheduleRows(page(gameRow("0910", "", "")), 2026);
  assert.equal(r.unreadable, 1);
  assert.equal(r.blank, 0);
});

test("parseUpcoming 은 같은 분류 위에 선다 — 기존 필드 호환 · 날짜 행과 공백 행이 늘어난다", () => {
  const html = page(
    gameRow("1030", "阪神", "ソフトバンク", { score: [2, 3], link: "/scores/2025/1030/t-h-05/" }),
    blankRow("1103"),
    gameRow("1104", "阪神", "ソフトバンク", { teamClass: "club" }),
    placeholderRow("1105", "(予備日)"),
  );
  const u = parseUpcoming(html, 2025);
  const c = classifyScheduleRows(html, 2025);
  assert.deepEqual(u.games, c.games);
  assert.equal(u.nonTeamRows, c.nonTeam);
  assert.equal(u.unreadableRows, c.unreadable);
  assert.equal(u.dateRows, 4);
  assert.equal(u.blankRows, 1);
  assert.equal(u.placeholderRows, 1);
});

test("다섯 분류가 날짜 행 수를 빠짐없이 나눈다", () => {
  const c = classifyScheduleRows(page(
    gameRow("1030", "阪神", "ソフトバンク", { score: [2, 3], link: "/scores/2025/1030/t-h-05/" }),
    gameRow("0723", "セ・リーグ", "パ・リーグ"),
    blankRow("1103"),
    gameRow("1104", "阪神", "ソフトバンク", { teamClass: "club" }),
    placeholderRow("1105", "(予備日)"),
  ), 2025);
  assert.equal(c.dateRows, c.games.length + c.nonTeam + c.blank + c.placeholder + c.unreadable);
});
