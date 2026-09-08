/**
 * 공표 성적표 파서 — **외부 대조 전용**.
 *
 * ⚠**이 파서가 조용히 틀리면 대조가 거짓말을 한다.** 컬럼이 하나 밀리면
 * 「打率 자리에 長打率이 들어온」 대조표가 나오고, 그러면 **멀쩡한 우리 코드를 고치게 된다** —
 * 대조 도구의 오류는 대조를 안 한 것보다 나쁘다. 그래서 헤더를 검사하고 던진다(M7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  StatsParseError,
  normalizePlayerName,
  parseTeamBatting,
  parseTeamPitching,
  publishedAsOf,
} from "../src/stats.ts";

/** 실측 헤더(2026-08-16) 그대로 */
const BAT_HEADER =
  "選手,試合,打席,打数,得点,安打,二塁打,三塁打,本塁打,塁打,打点,盗塁,盗塁刺,犠打,犠飛,四球,故意四,死球,三振,併殺打,打率,長打率,出塁率";
/** ⚠투수표는 「투수 시점」이라 `安打`가 피안타다. 타격표와 같은 글자가 반대 뜻이다 */
const PIT_HEADER =
  "選手,登板,勝利,敗北,セーブ,ホールド,ＨＰ,完投,完封勝,無四球,勝率,打者,投球回,安打,本塁打,四球,故意四,死球,三振,暴投,ボーク,失点,自責点,防御率";

function table(header: string, ...rows: string[]): string {
  const tr = (cells: string, tag: string): string =>
    `<tr>${cells.split(",").map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return `<table class="tablefix2">${tr(header, "th")}${rows.map((r) => tr(r, "td")).join("")}</table>`;
}

test("타격 성적표를 읽는다", () => {
  const html = table(
    BAT_HEADER,
    "<sup>*</sup>佐藤 輝明,104,442,382,76,121,29,3,27,237,76,5,1,0,3,56,6,1,117,4,.317,.620,.403",
  );
  const [r] = parseTeamBatting(html);
  assert.equal(r!.rawName, "*佐藤 輝明");
  assert.equal(r!.name, "佐藤輝明");
  assert.equal(r!.games, 104);
  assert.equal(r!.pa, 442);
  assert.equal(r!.ab, 382);
  assert.equal(r!.h, 121);
  assert.equal(r!.hr, 27);
  assert.equal(r!.bb, 56);
  assert.equal(r!.hbp, 1);
  // ⚠비율은 **문자열 그대로** 든다. 수로 바꾸면 반올림 규칙 차이가 사라진다
  assert.equal(r!.avg, ".317");
  assert.equal(r!.slg, ".620");
  assert.equal(r!.obp, ".403");
});

test("⚠좌우 마커를 벗긴다 — 안 벗기면 어떤 이름과도 안 맞는다", () => {
  // 실측: 58명 중 28명이 이 마커 때문에 매칭에 실패했다
  assert.equal(normalizePlayerName("*佐藤 輝明"), "佐藤輝明");
  assert.equal(normalizePlayerName("+植田 海"), "植田海");
  assert.equal(normalizePlayerName("石黒 佑弥"), "石黒佑弥");
  assert.equal(normalizePlayerName("ガルシア"), "ガルシア");
  // 전각 공백도 접는다
  assert.equal(normalizePlayerName("佐藤　輝明"), "佐藤輝明");
});

test("⚠타격표의 헤더가 다르면 던진다 — 조용히 밀린 컬럼이 우리 값을 틀린 것처럼 보이게 한다(M7)", () => {
  const shifted = BAT_HEADER.replace("打席,打数", "打数,打席");
  assert.throws(
    () => parseTeamBatting(table(shifted, "選手A," + Array(22).fill("0").join(","))),
    (e: unknown) => e instanceof StatsParseError && /헤더가 예상과 다르다/.test(e.message),
  );
});

test("⚠컬럼 수가 헤더와 다른 행이 있으면 던진다 — 한 줄만 밀려도 그 선수가 통째로 틀린다", () => {
  assert.throws(
    () => parseTeamBatting(table(BAT_HEADER, "選手A,1,2,3")),
    (e: unknown) => e instanceof StatsParseError && /행 컬럼 수가 헤더와 다르다/.test(e.message),
  );
});

test("표 자체가 없으면 던진다 — 빈 배열을 돌려주면 「전원 일치」로 읽힌다", () => {
  assert.throws(
    () => parseTeamBatting("<html><body>표가 없는 문서</body></html>"),
    (e: unknown) => e instanceof StatsParseError && /찾지 못했다/.test(e.message),
  );
});

test("투구 성적표를 읽는다 — ⚠열 이름이 「투수 시점」이다(安打 = 피안타)", () => {
  const html = table(
    PIT_HEADER,
    "村上 頌樹,20,10,4,0,0,10,3,1,0,.714,540,138.1,110,8,25,1,3,120,2,0,32,28,1.82",
  );
  const [r] = parseTeamPitching(html);
  assert.equal(r!.name, "村上頌樹");
  assert.equal(r!.games, 20, "登板을 試合으로 읽어야 한다");
  assert.equal(r!.w, 10);
  assert.equal(r!.l, 4, "敗北를 읽어야 한다");
  assert.equal(r!.bf, 540);
  assert.equal(r!.innings, "138.1");
  assert.equal(r!.h, 110, "安打는 피안타다");
  assert.equal(r!.bb, 25, "四球는 여사구다");
  assert.equal(r!.so, 120, "三振은 탈삼진이다");
  assert.equal(r!.wp, 2);
  assert.equal(r!.balk, 0);
  assert.equal(r!.er, 28);
  assert.equal(r!.era, "1.82");
});

test("⚠투구표는 위치가 아니라 이름으로 열을 찾는다 — 안 쓰는 열이 하나 늘어도 밀리지 않는다", () => {
  // 실제로 완투·완봉·무사사구·HP 같은 우리가 안 쓰는 열이 사이에 끼어 있다
  const withExtra = PIT_HEADER.replace("完投,", "完投,新しい列,");
  const row = "村上 頌樹,20,10,4,0,0,10,3,9,1,0,.714,540,138.1,110,8,25,1,3,120,2,0,32,28,1.82";
  const [r] = parseTeamPitching(table(withExtra, row));
  assert.equal(r!.h, 110, "새 열이 끼자 피안타가 밀렸다");
  assert.equal(r!.era, "1.82");
});

test("⚠투구표에 필요한 열이 없으면 던진다", () => {
  const missing = PIT_HEADER.replace(",防御率", "");
  assert.throws(
    () => parseTeamPitching(table(missing, "選手A," + Array(22).fill("0").join(","))),
    (e: unknown) => e instanceof StatsParseError && /防御率/.test(e.message),
  );
});

test("⚠「-」는 0이 아니다 — 값이 없는 칸을 0으로 세면 규정 미달자가 최하위가 된다(M11)", () => {
  const html = table(
    BAT_HEADER,
    "選手A,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-,.000,.000,.000",
  );
  const [r] = parseTeamBatting(html);
  assert.ok(Number.isNaN(r!.gidp), "「-」를 0으로 읽었다");
});

test("수로 읽을 수 없는 칸이 있으면 던진다 — 조용히 NaN을 흘리지 않는다", () => {
  const html = table(BAT_HEADER, "選手A,あ,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,.000,.000,.000");
  assert.throws(
    () => parseTeamBatting(html),
    (e: unknown) => e instanceof StatsParseError && /수로 읽을 수 없는 칸/.test(e.message),
  );
});

/**
 * 구형(2023~2024) 공표 성적표 — **실물로 검증한다.**
 *
 * ⚠**이 분기가 없으면 소급 시즌을 공표값과 대조할 수 없다** — 백필의 검증 수단이 사라진다.
 * 실제로 2024를 대조하자 **결함 후보 6건**이 나왔고, 그것이 `犠失` 오분류였다
 * (외야로 간 희생타를 번트로 읽어 출루율이 높게 나왔다).
 *
 * 구형이 다른 점(실측 2026-08-17):
 *   · `class="tablefix2"` 가 없다
 *   · 표 맨 위에 주석 행, **모든 행 앞에 빈 칸이 하나 더**
 *   · 헤더에 공백(`選 手`) · 장음이 전각 세로줄(`セ｜ブ`) · 홀드가 축약형(`ホ｜ル`)
 *   · **투구회가 두 칸으로 쪼개진다**(`106` + `.1`)
 *
 * ⚠**「합치지 않으면 뒤의 열이 전부 밀린다」는 틀린 서술이었다**(2026-08-17 정정).
 * 헤더에도 같은 빈 칸이 있고 값은 헤더 인덱스로 집으므로 **다른 열은 안 밀린다** —
 * 합치지 않으면 **투구회의 1/3 자리만 사라진다**(`106.1` → `106`). 그 오해 때문에
 * 처음 단언이 약했다(모양만 보는 정규식이라 `106` 도 통과했다).
 */
const LEGACY_BATTING = gunzipSync(
  readFileSync(new URL("./fixtures/2024-stats-batting.html.gz", import.meta.url)),
).toString("utf8");
const LEGACY_PITCHING = gunzipSync(
  readFileSync(new URL("./fixtures/2024-stats-pitching.html.gz", import.meta.url)),
).toString("utf8");

test("⚠구형 공표 타격 성적표를 읽는다 — 없으면 백필을 대조할 수 없다", () => {
  const rows = parseTeamBatting(LEGACY_BATTING);
  assert.ok(rows.length > 20, `행이 너무 적다: ${rows.length}`);
  const first = rows[0]!;
  // ⚠**빈 칸을 떼지 않으면 여기서 이름이 비고 열이 전부 하나씩 밀린다**
  assert.ok(first.name.length > 0, "선수명 자리가 비었다 — 앞의 빈 칸을 떼지 않았다");
  assert.ok(Number.isFinite(first.games), "試合를 수로 읽지 못했다");
  assert.ok(Number.isFinite(first.gidp), "併殺打를 수로 읽지 못했다(열이 밀렸다)");
  // 합계가 말이 되는가 — 타수는 타석 이하다
  for (const r of rows) {
    if (Number.isFinite(r.ab) && Number.isFinite(r.pa)) {
      assert.ok(r.ab <= r.pa, `${r.name}: 타수 ${r.ab} > 타석 ${r.pa} — 열이 밀렸다`);
    }
  }
});

test("⚠구형 공표 투구 성적표를 읽는다 — 투구회가 두 칸으로 쪼개져 있다", () => {
  const rows = parseTeamPitching(LEGACY_PITCHING);
  assert.ok(rows.length > 10, `행이 너무 적다: ${rows.length}`);
  const first = rows[0]!;
  assert.ok(first.name.length > 0, "선수명 자리가 비었다");
  /**
   * ⚠**값을 고정한다.** 처음에는 `/^\d+(\.\d)?$/` 로 「모양만」 봤는데,
   * 합치기를 지운 결과인 `"106"` 도 그 정규식을 통과한다 — **뮤테이션이 살아남았다**
   * (2026-08-17 이중 검토가 6종 중 이 하나만 생존한다고 지적).
   * 이닝의 1/3 자리는 이 도메인의 1급 값이고, 잃으면 방어율 대조가 조용히 틀린다.
   */
  assert.equal(first.innings, "106.1", "투구회의 1/3 자리를 잃었다(두 칸을 합치지 않았다)");
  // 한 장 전체에서도 소수 자리가 살아 있는가 — 한 행만 우연히 맞는 것을 막는다
  assert.ok(
    rows.some((r) => /\.\d$/.test(r.innings)),
    "한 장 전부가 정수 이닝이다 — 합치기가 안 돌았다",
  );
  assert.ok(Number.isFinite(first.era ? Number(first.era) : Number.NaN), "방어율 자리가 수가 아니다 — 열이 밀렸다");
  // 홀드 열이 잡혔는가(구형은 `ホ｜ル` 로 축약된다)
  assert.ok(rows.every((r) => Number.isFinite(r.hld)), "홀드 열을 못 찾았다");
});

/**
 * ⚠**공표표는 자기 기준일을 스스로 적는다 — 우리가 추측할 일이 아니었다**(2026-09-09).
 *
 * 대조 도구는 그동안 **취득 시각**에서 기준일을 유도했다(JST 날짜 − 1일).
 * 그 규칙은 「낮에 받는다」를 전제하는데, **자정을 넘겨 받으면 하루를 앞질러 잡는다.**
 * 2026-09-08T16:14Z(= JST 09-09 01:14)에 받은 표에서 09-08 을 유도했고,
 * 그 시각 npb.jp 는 아직 09-07 까지만 공표하고 있었다 —
 * **결함 후보 989건**이 났고 전부 정확히 한 경기치였다(우리가 앞서 있었다).
 * 그 거짓 경보가 `if: success()` 인 배포 단계를 통째로 막았다.
 *
 * ⚠**받고 있는데 안 읽던 것의 다섯 번째다**(CLAUDE.md §2-2-1).
 * `YYYY年M月D日 現在` 가 **std_* · idb1_* · idp1_* · tmb_* 전부에 정확히 한 번** 있다(실측).
 */
test("⚠공표표가 스스로 적은 기준일을 읽는다 — 취득 시각으로 추측하지 않는다", () => {
  const html = '<div class="date">2026年9月7日 現在</div>' + table(BAT_HEADER);
  assert.equal(publishedAsOf(html), "2026-09-07");
});

test("⚠한 자리 월·일도 0 을 채운다 — 문자열 비교로 날짜를 다루기 때문이다", () => {
  assert.equal(publishedAsOf("<p>2026年1月2日 現在</p>"), "2026-01-02");
});

test("⚠적혀 있지 않으면 추측하지 않고 null 을 준다 — 부르는 쪽이 무엇을 가정할지 정한다", () => {
  assert.equal(publishedAsOf("<p>기준일이 없는 페이지</p>"), null);
});

/**
 * ⚠**둘 이상이면 못 믿는다.** 이 파서의 전제는 「페이지에 기준일이 하나뿐」이고,
 * 실측(2026 · std_c·std_p·idb1_c·idp1_c·tmb_c 5장)에서 전부 **정확히 1건**이었다.
 * 마크업이 바뀌어 여러 개가 되면 **어느 것이 기준일인지 우리가 고르게 된다** —
 * 그건 추측이므로 빈 값이 아니라 실패로 만든다(M7).
 */
test("⚠기준일이 둘 이상이면 던진다 — 고르는 순간 추측이 된다", () => {
  const html = "<p>2026年9月7日 現在</p><p>2026年9月8日 現在</p>";
  assert.throws(() => publishedAsOf(html), StatsParseError);
});

/**
 * ⚠**완결 시즌 페이지에는 기준일이 없다 — 그리고 그게 맞다**(2026-09-09 실측).
 * 끝난 시즌은 스냅숏이 아니라 확정이므로 「◯◯ 現在」라고 적을 것이 없다.
 * 실측: 2024 공표표(이 픽스처)에 `現在` **0건** · 반대로 진행 중인 2026 공표표는
 * std_c·std_p·idb1_c·idp1_c·tmb_c **5장 전부에 정확히 1건**이다.
 * ⚠**그래서 null 은 실패가 아니라 「자를 것이 없다」는 뜻이다** — 부르는 쪽이 그렇게 읽는다.
 */
test("⚠완결 시즌 공표표에는 기준일이 없다 — 자를 것이 없다는 뜻이다", () => {
  assert.equal(publishedAsOf(LEGACY_BATTING), null);
  assert.equal(publishedAsOf(LEGACY_PITCHING), null);
});
