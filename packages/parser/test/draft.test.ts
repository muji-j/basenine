/**
 * 드래프트 지명 명단 파서 시험.
 *
 * ⚠**이 파서가 조용히 틀리는 방식이 넷이고, 넷 다 화면에서 그럴듯해 보인다.**
 *   ⑴ `（選択権なし）` 를 선수로 넣는다 → **「選択権なし」라는 선수가 생긴다**(M11).
 *   ⑵ 5칸 배치(2006)를 4칸으로 읽는다 → **나이 `（22）` 가 포지션 칸에, 포지션이 소속 칸에** 들어간다.
 *   ⑶ 회차 없는 지명(`自由獲得選手`·`希望入団枠獲得選手`)을 건너뛴다 →
 *      **江尻慎太郎·金刃憲人 이 아무 소리 없이 사라진다.**
 *   ⑷ 포지션을 **검증 없이 그대로 담는다**(2026-09-05 검수 지적) → 어휘 밖 값이 DB 로 흘러가고,
 *      열이 밀렸을 때 **소속이 포지션이 된 화면**을 아무도 결함으로 못 읽는다.
 * 아래 시험은 넷을 각각 못으로 박는다. ⚠**기대를 낮춰서 통과시키지 마라** — 코드가 실물을 따라간다.
 *
 * ⚠**`kind` 는 6종이다**(2026-09-05): `自由獲得選手`·`希望入団枠獲得選手` 를 `shihaika` 로
 * 접으면 **DB 에서 「1巡目 지명」과 구별할 수 없다.** 아래 두 시험이 그것을 고정한다.
 *
 * 분모(픽스처에서 직접 센 값 · 소스는 `packages/parser/test/fixtures/`):
 *   2019-g  표 행 8 = 지명 8 (`選択権` 0건)
 *   2019-c  표 행 9 = 지명 9 (`選択権` 0건)
 *   2006-g  표 행 19 = 지명 16 + `選択権なし` 3
 *   2001-f  표 행 9 = 지명 7 + `選択権利なし` 2
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  DraftParseError,
  DraftIndexError,
  parseDraftBids,
  parseDraftPicks,
  parseDraftTeamSlugs,
  parseDraftYears,
} from "../src/draft.ts";

const fixture = (name: string): string =>
  gunzipSync(readFileSync(fileURLToPath(new URL(`fixtures/${name}.html.gz`, import.meta.url)))).toString("utf8");

/**
 * 기대 어휘 4종. 소스(`positions.ts`)와 같아야 한다 — 다르면 조인이 조용히 빈다.
 *
 * ⚠**여기는 일부러 손으로 적는다. `POSITIONS` 를 import 해서 「한 벌로」 만들지 마라** —
 * 그러면 어휘가 어떻게 바뀌든 시험이 따라가서 **무엇과도 어긋날 수 없는 검사**가 된다.
 * 제품 코드의 중복은 결함이지만, **시험이 정답을 독립적으로 갖는 것은 그 시험의 존재 이유다.**
 */
const POSITIONS = new Set(["投手", "捕手", "内野手", "外野手"]);

test("현행 마크업(2019)에서 지명 명단을 읽는다 — 8건 중 8건", () => {
  const rows = parseDraftPicks(fixture("draft-2019-list-g"), "g");
  assert.equal(rows.length, 8, "빈 배열이거나 수가 다르면 파서가 조용히 실패한 것이다");

  const first = rows.find((r) => r.kind === "shihaika" && r.roundNo === 1);
  assert.ok(first, "1순위 지명이 있어야 한다");
  assert.deepEqual(first, {
    team: "g",
    kind: "shihaika",
    roundNo: 1,
    waiverDir: null,
    nameDisplay: "堀田 賢慎",
    position: "投手",
    fromOrg: "青森山田高",
  });
});

test("⚠育成 을 支配下 와 구별한다 — 6 + 2 = 8", () => {
  const rows = parseDraftPicks(fixture("draft-2019-list-g"), "g");
  assert.equal(rows.filter((r) => r.kind === "shihaika").length, 6);
  assert.equal(rows.filter((r) => r.kind === "ikusei").length, 2);
  for (const r of rows) {
    assert.ok(
      ["shihaika", "ikusei", "koukousei", "daigaku_shakaijin", "jiyuu_kakutoku", "kibou_nyudanwaku"].includes(r.kind),
    );
  }

  // 같은 해 다른 구단도 같은 모양이어야 한다(6 + 3 = 9).
  const c = parseDraftPicks(fixture("draft-2019-list-c"), "c");
  assert.equal(c.length, 9);
  assert.equal(c.filter((r) => r.kind === "shihaika").length, 6);
  assert.equal(c.filter((r) => r.kind === "ikusei").length, 3);
});

test("⚠회차 없는 제도는 kind 도 다르다 — shihaika 로 접으면 「1巡目」과 구별할 수 없다", () => {
  // 2006 `希望入団枠獲得選手` — 이 페이지의 shihaika 는 0건이어야 한다.
  const g2006 = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  assert.equal(g2006.filter((r) => r.kind === "kibou_nyudanwaku").length, 1);
  assert.equal(g2006.filter((r) => r.kind === "shihaika").length, 0, "접으면 1巡目 지명과 같은 것이 된다");

  // 2001 은 `自由獲得選手` 와 `選択選手` 가 **한 페이지에 둘 다** 있다 — 접으면 7건이 한 덩어리다.
  const f2001 = parseDraftPicks(fixture("draft-2001-list-f"), "f");
  assert.equal(f2001.filter((r) => r.kind === "jiyuu_kakutoku").length, 1);
  assert.equal(f2001.filter((r) => r.kind === "shihaika").length, 6);

  // ⚠**회차는 여전히 null 이다** — kind 를 갈랐다고 파서가 순번을 지어내지 않는다.
  assert.equal(f2001.find((r) => r.kind === "jiyuu_kakutoku")?.roundNo, null);
  assert.equal(g2006.find((r) => r.kind === "kibou_nyudanwaku")?.roundNo, null);
});

test("⚠섹션 머리 7종의 매핑을 고정한다 — 새 패턴이 기존 머리를 가로채면 여기서 걸린다", () => {
  const row = "<table><tr><th>1位</th><td>山田 太郎</td><td>投手</td><td>某高</td></tr></table>";
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["新人選手選択会議", "shihaika"],
    ["選択選手", "shihaika"],
    ["育成選手選択会議", "ikusei"],
    ["高校生選択会議", "koukousei"],
    ["大学生・社会人ほか選択会議", "daigaku_shakaijin"],
    ["自由獲得選手", "jiyuu_kakutoku"],
    ["希望入団枠獲得選手", "kibou_nyudanwaku"],
  ];
  for (const [heading, kind] of cases) {
    const rows = parseDraftPicks(`<h4>${heading}</h4>${row}`, "g");
    assert.equal(rows.length, 1, `${heading} 에서 행이 사라졌다`);
    assert.equal(rows[0]?.kind, kind, `${heading} 의 구획이 틀렸다`);
  }
});

test("⚠구형 마크업(2006)도 읽는다 — 전각 숫자·5칸·전각 공백 · 16건 중 16건", () => {
  const rows = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  assert.equal(rows.length, 16, "구형에서 수가 다르면 연대 차이를 못 넘은 것이다");

  // 전각 `１巡目` 이 정수로 정규화됐는가.
  for (const r of rows) {
    assert.ok(r.roundNo === null || (Number.isInteger(r.roundNo) && r.roundNo >= 1), `이상한 회차: ${r.roundNo}`);
  }
  const daigaku = rows.filter((r) => r.kind === "daigaku_shakaijin").map((r) => r.roundNo);
  assert.deepEqual(daigaku, [3, 4, 5, 6, 7], "전각 １~７巡目 이 정수가 돼야 한다(1·2는 選択権なし)");

  // 2006 은 한 페이지에 세 구획이 있다.
  assert.equal(rows.filter((r) => r.kind === "koukousei").length, 3);
  assert.equal(rows.filter((r) => r.kind === "ikusei").length, 7);
  // ⚠**`希望入団枠獲得選手` 는 `shihaika` 가 아니다** — 접으면 「1巡目」과 구별할 수 없다.
  assert.equal(rows.filter((r) => r.kind === "kibou_nyudanwaku").length, 1);
  assert.equal(3 + 7 + 5 + 1, rows.length, "16 = 高校生 3 + 育成 7 + 大学生社会人 5 + 希望入団枠 1");
});

test("⚠5칸 배치에서 나이가 포지션 칸으로 밀리지 않는다(2006)", () => {
  const rows = parseDraftPicks(fixture("draft-2006-list-g"), "g");

  // 坂本勇人 — 高校生 1巡目. 나이 `（17）` 이 끼어 있는 행이다.
  const sakamoto = rows.find((r) => r.nameDisplay === "坂本 勇人");
  assert.ok(sakamoto, "坂本 勇人 이 있어야 한다");
  assert.equal(sakamoto.kind, "koukousei");
  assert.equal(sakamoto.roundNo, 1);
  assert.equal(sakamoto.position, "内野手", "나이가 들어왔다면 「(17)」 이 됐을 자리다");
  assert.equal(sakamoto.fromOrg, "光星学院高", "포지션이 밀려 들어왔다면 「内野手」 가 됐을 자리다");

  // 어느 행에도 나이가 새지 않았는가(전건).
  for (const r of rows) {
    assert.ok(!/^\(\d+\)$/.test(r.position ?? ""), `포지션 칸에 나이가 들어왔다: ${r.nameDisplay}`);
    assert.ok(POSITIONS.has(r.position ?? ""), `모르는 포지션: ${JSON.stringify(r.position)} (${r.nameDisplay})`);
  }
});

test("⚠회차 없는 지명(自由獲得·希望入団枠)을 버리지 않는다 — null 이지 0 이 아니다(M11)", () => {
  // 2006 希望入団枠獲得選手 — `<th>&nbsp;</th>` 라 회차가 없다.
  const g2006 = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  const kanetsuna = g2006.find((r) => r.nameDisplay === "金刃 憲人");
  assert.ok(kanetsuna, "希望入団枠 지명이 통째로 사라졌다");
  assert.equal(kanetsuna.roundNo, null, "회차는 「원래 없음」이라 null 이다 — 0 으로 메우지 마라");
  assert.equal(kanetsuna.kind, "kibou_nyudanwaku");
  assert.equal(kanetsuna.position, "投手");
  assert.equal(kanetsuna.fromOrg, "立命館大");

  // 2001 自由獲得選手 — 같은 모양이다.
  const f2001 = parseDraftPicks(fixture("draft-2001-list-f"), "f");
  const ejiri = f2001.find((r) => r.nameDisplay === "江尻 慎太郎");
  assert.ok(ejiri, "自由獲得 지명이 통째로 사라졌다");
  assert.equal(ejiri.roundNo, null);
  assert.equal(ejiri.kind, "jiyuu_kakutoku");
  assert.equal(ejiri.position, "投手");
  assert.equal(ejiri.fromOrg, "早稲田大");

  // ⚠0 을 센티넬로 쓰지 않았는가(전건).
  for (const r of [...g2006, ...f2001]) assert.notEqual(r.roundNo, 0, "0 은 회차가 아니다");
});

test("⚠최구형(2001)의 「選択権利なし」를 선수로 만들지 않는다 — 9행 중 7건만 지명", () => {
  const rows = parseDraftPicks(fixture("draft-2001-list-f"), "f");
  assert.equal(rows.length, 7, "표 행 9 − 選択権利なし 2 = 7");
  for (const r of rows) {
    assert.ok(!r.nameDisplay.includes("選択権"), `「${r.nameDisplay}」는 선수가 아니다`);
  }
  assert.deepEqual(
    rows.filter((r) => r.roundNo !== null).map((r) => r.roundNo),
    [2, 4, 5, 6, 7, 8],
    "건너뛴 1·3巡目 이 빠지고 나머지가 남아야 한다",
  );
});

test("⚠`（選択権なし）`(2006) 도 같이 걸린다 — 한 글자 다르다", () => {
  const rows = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  for (const r of rows) {
    assert.ok(!r.nameDisplay.includes("選択権"), `「${r.nameDisplay}」는 선수가 아니다`);
  }
});

test("⚠아는 두 표기만 걸러서는 부족하다 — 모르는 변종은 선수로 만들지 말고 던진다(M7)", () => {
  // `（選択権無し）` — 한 글자(なし→無し)만 다른 가상의 변종. 걸러지지도 않고
  // 선수가 되지도 않아야 한다. ⚠**이 줄이 없으면 「選択権無し」라는 선수가 생긴다.**
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>（選択権無し）</td><td>&nbsp;</td><td></td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
  // 괄호로 묶인 칸은 어떤 어휘든 이름이 아니다.
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>（該当者なし）</td><td>&nbsp;</td><td></td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
});

test("⚠HTML 엔티티가 값으로 새지 않는다 — 4장 전부", () => {
  const all = [
    ...parseDraftPicks(fixture("draft-2019-list-g"), "g"),
    ...parseDraftPicks(fixture("draft-2019-list-c"), "c"),
    ...parseDraftPicks(fixture("draft-2006-list-g"), "g"),
    ...parseDraftPicks(fixture("draft-2001-list-f"), "f"),
  ];
  assert.equal(all.length, 8 + 9 + 16 + 7);
  for (const r of all) {
    for (const [k, v] of Object.entries(r)) {
      if (typeof v !== "string") continue;
      assert.ok(!/&(nbsp|amp|lt|gt|quot);/.test(v), `${k} 에 엔티티가 남았다: ${JSON.stringify(v)}`);
    }
    // 빈 문자열을 null 대신 쓰지 않는다(M11).
    assert.notEqual(r.position, "", "빈 문자열이 아니라 null 이어야 한다");
    assert.notEqual(r.fromOrg, "", "빈 문자열이 아니라 null 이어야 한다");
    assert.notEqual(r.nameDisplay, "", "이름이 비면 안 된다");
  }
});

test("⚠포지션·소속의 전각/반각이 연대를 넘어 같아진다", () => {
  const g2006 = parseDraftPicks(fixture("draft-2006-list-g"), "g");
  const g2019 = parseDraftPicks(fixture("draft-2019-list-g"), "g");

  // 2006 은 `投　手`(전각 공백), 2019 는 `投手`. 같은 값이 돼야 한다.
  assert.ok(g2006.some((r) => r.position === "投手"));
  assert.ok(g2019.some((r) => r.position === "投手"));
  for (const r of [...g2006, ...g2019]) {
    assert.ok(POSITIONS.has(r.position ?? ""), `모르는 포지션: ${JSON.stringify(r.position)}`);
  }

  // 2006 은 `ＮＴＴ東日本`(전각), 2019 는 `JR東日本`(반각). NFKC 가 자리를 맞춘다.
  assert.ok(g2006.some((r) => r.fromOrg === "NTT東日本"), "ＮＴＴ 가 반각이 돼야 한다");
  assert.ok(g2006.some((r) => r.fromOrg === "JR東日本"), "ＪＲ 가 반각이 돼야 한다");
  assert.ok(g2019.some((r) => r.fromOrg === "JR東日本"));
});

test("⚠구조가 바뀌면 빈 배열이 아니라 던진다(M7) — 섹션이 없다", () => {
  // ⚠**메시지까지 고정한다.** 아래 「인식된 섹션 0건」 그물도 같은 입력을 잡지만
  //   진단이 다르다(「<h4> 가 없다」 vs 「머리가 전부 빈 <h4> 다」). 메시지를 안 고정하면
  //   이 구체적인 진단이 사라져도 시험이 초록으로 남는다.
  assert.throws(
    () => parseDraftPicks("<html><body><p>표가 없다</p></body></html>", "g"),
    /섹션\(<h4>\)이 없다/,
  );
});

test("⚠<h4> 는 있는데 머리가 전부 비면 던진다(M7) — 루프가 한 번도 안 도는 경우", () => {
  assert.throws(
    () => parseDraftPicks("<h4></h4><h4>  </h4>", "g"),
    /인식된 섹션이 하나도 없다/,
  );
});

test("⚠섹션은 있는데 행이 없어도 던진다(M7)", () => {
  assert.throws(
    () => parseDraftPicks("<h4>新人選手選択会議</h4><div>표가 통째로 사라졌다</div>", "g"),
    DraftParseError,
  );
});

test("⚠**한 섹션만** 깨져도 던진다(M7) — 다른 섹션이 정상이면 전역 카운터로는 안 잡힌다", () => {
  // ⚠**이게 조용한 소실의 입구였다.** 지명 행 수를 페이지 전체로 세면
  // 「한 섹션이 통째로 빠졌는데 다른 섹션이 정상」인 입력이 **예외 없이 통과**한다.
  // 그 배열을 적재가 받으면(적재는 구단 단위로 지우고 다시 넣는다) **빠진 구획의
  // 실데이터가 지워진다** — 에러가 아니라 침묵이라 아무도 못 읽는다.
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>投手</td><td>某高</td></tr></table>"
          + "<h4>希望入団枠獲得選手</h4><ul><li>표가 리스트로 바뀌었다</li></ul>",
        "g",
      ),
    DraftParseError,
  );
});

test("⚠「선택권 없음」만 있는 섹션은 던지지 않는다 — 0건이 정답인 섹션이 있다(M11)", () => {
  // ⚠**위 그물을 「출력 행이 0이면 던진다」로 만들면 이게 오탐이 된다.**
  // 세는 것은 **읽어 낸 지명 행**이지 출력 행이 아니다 — 실측(픽스처 4장)에서
  // 「읽었지만 선수가 아니라 건너뛴」 행이 **5건**(2006 大学生 2 · 2006 高校生 1 · 2001 選択選手 2) 있다.
  const rows = parseDraftPicks(
    "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>投手</td><td>某高</td></tr></table>"
      + "<h4>育成選手選択会議</h4><table><tr><th>1位</th><td>（選択権なし）</td><td>&nbsp;</td><td></td></tr></table>",
    "g",
  );
  assert.equal(rows.length, 1, "「선택권 없음」만 있는 섹션은 0건이 정답이다");
});

test("⚠칸 수가 4도 5도 아니면 던진다(M7) — 열이 밀린 채 흘리지 않는다", () => {
  assert.throws(
    () => parseDraftPicks("<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td></tr></table>", "g"),
    DraftParseError,
  );
});

test("⚠5칸 행의 3번째가 연령이 아니면 던진다(M7)", () => {
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>高校生選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>投手</td><td>内野手</td><td>某高</td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
});

test("⚠포지션이 어휘 밖이면 던진다(M7) — 초판은 이 칸만 검증 없이 그대로 담았다", () => {
  // 검수자가 재현한 그대로. ⚠**이 줄이 없으면 「謎ポジション」이 그대로 DB 에 들어간다.**
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>謎ポジション</td><td>某高</td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
  // 열이 오른쪽으로 밀리면 소속이 포지션 칸에 온다 — 그 화면은 그럴듯해서 눈으로는 못 잡는다.
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>某高</td><td>投手</td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
  // ⚠**가드가 넓어서도 안 된다** — 4종은 전부 통과해야 한다(전각 공백 변종 포함).
  for (const p of ["投手", "捕手", "内野手", "外野手", "投　手"]) {
    const rows = parseDraftPicks(
      `<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>${p}</td><td>某高</td></tr></table>`,
      "g",
    );
    assert.equal(rows[0]?.position, p.replace(/\s/g, ""), `${p} 가 막혔다`);
  }
  // 빈 칸만은 「원래 없음」이라 null 이다 — 열이 밀려서 비는 일은 없다(M11).
  const blank = parseDraftPicks(
    "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>&nbsp;</td><td>某高</td></tr></table>",
    "g",
  );
  assert.equal(blank[0]?.position, null);
});

/**
 * ⚠**어휘 검사가 어휘 검사가 아니었다**(2026-09-05 최종 검토 [m1] · 실측).
 * `POSITIONS[k] === undefined` 로 거르는데 그 표가 평범한 객체 리터럴이면
 * `Object.prototype` 의 이름들이 **값을 갖고 돌아온다** — `constructor`·`toString` 은
 * 게이트를 통과했고 **`__proto__` 는 `{}` 를 포지션으로 만들었다.**
 * ⚠**실제 위험은 ≈0 이다** — npb.jp 의 포지션 칸에 ASCII 식별자가 나올 일이 없다.
 * 못으로 박는 이유는 위험이 아니라 **문서와 코드가 어긋나 있었다는 것**이다:
 * `positions.ts` 가 「모르는 값은 `undefined` 가 된다」고 선언하고 있었고 그게 거짓이었다.
 * ⚠**어휘는 `roster.ts` 와 한 벌이다**(M1) — 짝이 되는 시험이 `roster.test.ts` 에 있다.
 * **한쪽에만 가드를 넣어 고치지 마라.**
 */
test("⚠프로토타입 이름도 어휘 밖이다 — `__proto__` 가 포지션이 되지 않는다(M7)", () => {
  for (const name of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    assert.throws(
      () =>
        parseDraftPicks(
          `<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>山田 太郎</td><td>${name}</td><td>某高</td></tr></table>`,
          "g",
        ),
      DraftParseError,
      `${name} 이 어휘를 통과했다 — 어휘표에 프로토타입이 남아 있다`,
    );
  }
});

test("⚠모르는 섹션 머리는 무시하지 않고 던진다(M7)", () => {
  assert.throws(
    () => parseDraftPicks("<h4>新種目選択会議</h4><table><tr><th>1位</th><td>山田</td><td>投手</td><td>某高</td></tr></table>", "g"),
    DraftParseError,
  );
});

test("⚠모르는 회차 라벨은 던진다(M7)", () => {
  assert.throws(
    () =>
      parseDraftPicks(
        "<h4>新人選手選択会議</h4><table><tr><th>第一位</th><td>山田 太郎</td><td>投手</td><td>某高</td></tr></table>",
        "g",
      ),
    DraftParseError,
  );
});

test("team 은 페이지가 아니라 호출자가 준다", () => {
  const rows = parseDraftPicks(fixture("draft-2019-list-g"), "g");
  assert.ok(rows.every((r) => r.team === "g"));
  const same = parseDraftPicks(fixture("draft-2019-list-g"), "yg");
  assert.ok(same.every((r) => r.team === "yg"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 경합 주석(`parseDraftBids`)
//
// ⚠**이 파서가 조용히 틀리는 방식은 명단 파서와 다르다.** 명단은 「열이 밀린다」였지만
// 여기는 **「매치가 안 돼서 아무것도 안 나온다」**다 — 빈 배열이 정답인 경우(단독지명)가
// 실재하므로 **0건이 결함으로 안 읽힌다.** 그래서 시험이 **실물 문자열의 전 필드**를
// 못으로 박는다. 분모는 픽스처에서 직접 센 값이다(`grep -o "※[^<]*"`):
//   2019-g  ※ 2건 — `※1巡目（第1回）` · `※1巡目（第2回）`  (반각 숫자 · 회차 명시)
//   2019-c  ※ 0건 — 단독지명 구단
//   2006-g  ※ 1건 — `※１巡目`                              (**전각 숫자** · 회차 없음)
//   2001-f  ※ 0건
//
// ⚠**브리프의 정규식은 이 셋 중 어느 것도 못 읽었다** — 사유는 `draft.ts` 의 `BID_RE`
// 주석에 적어 뒀다. **기대를 낮춰서 통과시키지 마라.**
// ─────────────────────────────────────────────────────────────────────────────

test("경합 주석에서 상대 구단·당락·회차를 읽는다(2019 巨人 · 실물 2건)", () => {
  const bids = parseDraftBids(fixture("draft-2019-list-g"), "g");
  assert.equal(bids.length, 2, "2019 요미우리는 주석이 2건이다(실측)");

  // ※1巡目（第1回）： 奥川恭伸投手で東京ヤクルト、阪神と重複、抽選で外れる
  assert.deepEqual(bids[0], {
    team: "g",
    kind: "shihaika",
    roundNo: 1,
    rivals: ["東京ヤクルト", "阪神"],
    nameDisplay: "奥川恭伸",
    won: false,
  });
  // ※1巡目（第2回）： 宮川哲投手で埼玉西武と重複、抽選で外れる
  assert.deepEqual(bids[1], {
    team: "g",
    kind: "shihaika",
    roundNo: 2,
    rivals: ["埼玉西武"],
    nameDisplay: "宮川哲",
    won: false,
  });
});

test("⚠경합이 없는 구단은 빈 배열이다 — 그건 실패가 아니다", () => {
  assert.deepEqual(parseDraftBids(fixture("draft-2019-list-c"), "c"), [], "단독지명 구단에는 주석이 없다");
  assert.deepEqual(parseDraftBids(fixture("draft-2001-list-f"), "f"), [], "2001 니혼햄도 ※ 가 0건이다");
});

test("⚠전각 숫자(`※１巡目`)를 읽고, `（第N回）` 가 없으면 주석 순서가 회차다(2006 巨人 · 실물)", () => {
  // ※１巡目： 堂上直倫内野手で阪神、中日と重複、抽選で外れる
  // ⚠**브리프 정규식이 여기서 죽는다** — `1巡目` 을 반각으로만 썼다.
  const bids = parseDraftBids(fixture("draft-2006-list-g"), "g");
  assert.equal(bids.length, 1);
  assert.deepEqual(bids[0], {
    team: "g",
    // ⚠2006 은 本ドラフト가 둘로 갈려 있다 — 이 주석은 高校生 쪽이다.
    kind: "koukousei",
    roundNo: 1,
    rivals: ["阪神", "中日"],
    nameDisplay: "堂上直倫",
    won: false,
  });
});

test("⚠당첨 주석은 선수명을 생략한다 — null 이지 빈 문자열이 아니다(M11)", () => {
  // 규칙 문서 §2: 당첨(`確定`)이면 그 팀 표의 그 회차 값이 곧 그 선수라 이름을 안 쓴다.
  const bids = parseDraftBids("<p>※1巡目： 阪神と重複、抽選で確定</p>", "g");
  assert.equal(bids.length, 1);
  assert.equal(bids[0]?.won, true);
  assert.equal(bids[0]?.nameDisplay, null, "당첨이면 이름이 없다 — 표에서 가져와야 한다(적재의 일)");
  assert.deepEqual(bids[0]?.rivals, ["阪神"]);
});

test("⚠`<br>` 없이 붙은 두 주석을 `※` 로 자른다(2007 西武 모양)", () => {
  // `<p>` 단위로 자르면 둘이 한 덩어리가 되어 **뒤엣것이 통째로 사라진다.**
  const html =
    "<p>※1巡目（第1回）： 甲野一投手で阪神と重複、抽選で外れる※1巡目（第2回）： 阪神と重複、抽選で確定</p>";
  const bids = parseDraftBids(html, "l");
  assert.equal(bids.length, 2, "붙어 있어도 2건이다");
  assert.equal(bids[0]?.nameDisplay, "甲野一");
  assert.equal(bids[0]?.won, false);
  assert.equal(bids[1]?.roundNo, 2);
  assert.equal(bids[1]?.won, true);
  assert.equal(bids[1]?.nameDisplay, null);
});

test("⚠`1位` 라벨도 같은 문법이다", () => {
  const bids = parseDraftBids("<p>※1位： 中日と重複、抽選で確定</p>", "g");
  // ⚠`kind` 가 `null` 인 것은 **이 문자열에 `<h4>` 가 없어서**다 — 「모른다」가 아니라
  //   「소스가 이 주석을 어느 구획에도 안 넣었다」이고, 실물 220건에서는 0건이다(M11).
  assert.deepEqual(bids, [
    { team: "g", kind: null, roundNo: 1, rivals: ["中日"], nameDisplay: null, won: true },
  ]);
});

test("⚠구단 표기는 자르지 않고 그대로 담는다 — `横浜DeNA` 를 `横浜` 로 먹으면 다른 팀이 된다", () => {
  // 코드 변환은 적재(store)의 일이다. 파서가 약칭을 손대면 **최장일치 규칙이 두 벌**이 된다.
  const bids = parseDraftBids("<p>※1巡目： 乙川二投手で横浜DeNA、北海道日本ハムと重複、抽選で外れる</p>", "g");
  assert.deepEqual(bids[0]?.rivals, ["横浜DeNA", "北海道日本ハム"]);
});

test("⚠nameDisplay 에 NFKC 를 걸지 않는다 — 명단 파서와 **같은 규칙**이다(M1)", () => {
  // `parseDraftPicks.nameDisplay` 가 원문 그대로인 것과 짝을 맞춘다. 한쪽만 정규화하면
  // **이름 규칙이 두 벌**이 되고, 두 표를 나란히 놓은 사람만 그 차이를 본다.
  const bids = parseDraftBids("<p>※1巡目： ｴﾄﾞﾎﾟﾛ ｹｲﾝ外野手で阪神と重複、抽選で外れる</p>", "g");
  assert.equal(bids[0]?.nameDisplay, "ｴﾄﾞﾎﾟﾛ ｹｲﾝ", "반각 가나가 NFKC 로 접히면 안 된다");
});

test("⚠드래프트와 무관한 `※` 는 건너뛴다 — 그건 예외가 아니다", () => {
  const html = "<p>※入団交渉は後日行う</p><p>※1巡目： 阪神と重複、抽選で確定</p>";
  const bids = parseDraftBids(html, "g");
  assert.equal(bids.length, 1, "무관한 주석은 세지 않는다");
  assert.equal(bids[0]?.roundNo, 1, "⚠건너뛴 주석이 회차 순번을 밀지 않는다");
});

test("⚠경합 주석처럼 보이는데 문법이 다르면 던진다(M7) — 조용히 건너뛰지 않는다", () => {
  // 어휘가 한쪽만 바뀐 날 그냥 넘기면 **그 해 경합이 통째로 0건**이 되고,
  // 0건은 단독지명과 구별되지 않아 **아무도 결함으로 못 읽는다.**
  // ⚠**~~`重複`→`競合`~~ 을 쓰고 있었는데 그건 이제 실물 어휘다**(2005 · 224건 중 3건).
  //   실측 0건인 낱말로 바꿔 검사의 뜻을 지킨다 — 「안 본 낱말은 통과가 아니다」.
  assert.throws(
    () => parseDraftBids("<p>※1巡目： 甲野一投手で阪神と競願、抽選で外れる</p>", "g"),
    DraftParseError,
  );
  assert.throws(() => parseDraftBids("<p>※1巡目： 阪神と重複、抽選で保留</p>", "g"), DraftParseError);
});

/**
 * ⚠⚠**그물이 토크나이저 **하류**에 있으면 토크나이저가 바뀐 날 그물 자체가 안 뜬다.**
 * (2026-09-05 최종 검토 [I1] · **검토자가 구성한 5변종을 그대로 옮겼다**.)
 *
 * 옛 그물은 `※` 로 자른 **덩어리에만** 걸렸다. 실측(고치기 전):
 * ```
 * 현행(정답)                                        -> 1건
 * 「…3球団が競合し、抽選の結果、交渉権を得られず」  -> 0건  조용히
 * 「…と競合、抽選の結果外れる」                     -> 0건  조용히
 * ※ 를 * 로                                        -> 0건  조용히
 * ※ 를 &#8251; 로                                   -> 0건  조용히
 * ```
 * ⚠**그 0건이 적재까지 가면 「단독지명」이라는 거짓 사실이 된다** — 겹친 구단의 주석이
 * 사라지면 그 구단의 1巡目이 `won = NULL`(아무도 안 겹쳤다)로 유도되고,
 * **불변식 5종도 백필 게이트도 그것을 못 잡는다**(검토자 end-to-end 재현).
 *
 * ⚠**5변종은 검토자가 구성한 것이지 실물이 아니다.** 저장소에서 셀 수 있는 실물 경합 주석은
 * **3건뿐**이다(2019-g 2건 · 2006-g 1건). 못으로 박는 것은 「이 5개가 온다」가 아니라
 * **「그물이 토크나이저 위에 있다」**는 구조다.
 */
test("⚠어휘가 바뀐 경합 주석을 던진다 — 그물이 `※` 자르기 **위**에 있다(M7)", () => {
  for (const text of [
    "※1巡目： 奥川恭伸投手で東京ヤクルト、阪神、読売の3球団が競合し、抽選の結果、交渉権を得られず",
    "※1巡目： 奥川恭伸投手で東京ヤクルトと競合、抽選の結果外れる",
  ]) {
    assert.throws(() => parseDraftBids(`<p>${text}</p>`, "g"), DraftParseError, text);
  }
});

/**
 * ⚠**층 ⑵(덩어리 그물)만이 잡는 모양.** 문서 그물은 **「겹침 + 추첨」의 AND** 라
 * 헛불을 안 내는 대신 **한쪽 낱말만 남은 주석**을 못 본다. 그건 `※` 안에 있으므로
 * prior 가 높고, 거기서는 **OR** 로 잡는 것이 맞다.
 * ⚠**두 층 중 어느 쪽을 지워도 이 파일이 붉어지게** 하려고 이 본을 따로 둔다 —
 * 한 층이 다른 층을 가리면 나머지 한 층은 **지워져도 아무도 모른다.**
 */
test("⚠`※` 안에서는 낱말 하나만 남아도 던진다 — 문서 그물(AND)은 이걸 못 본다", () => {
  assert.throws(
    () => parseDraftBids("<p>※1巡目： 甲野一投手で阪神と重複、交渉権を得られず</p>", "g"),
    DraftParseError,
    "`抽選` 이 빠진 변종",
  );
  assert.throws(
    () => parseDraftBids("<p>※1巡目： 甲野一投手で阪神にくじ引きで敗れる</p>", "g"),
    DraftParseError,
    "`重複`·`競合` 이 빠진 변종",
  );
});

test("⚠`※` 자체가 바뀌어도 던진다 — 덩어리가 0개면 옛 그물은 아예 안 떴다(M7)", () => {
  const body = "1巡目： 奥川恭伸投手で東京ヤクルト、阪神と重複、抽選で外れる";
  // ⚠`&#8251;` 는 `※` 의 수치 참조다. `decode` 가 그것을 풀지 않으므로 **덩어리가 0개**가 된다.
  for (const marker of ["*", "&#8251;", "&#x203B;", "＊", "■"]) {
    assert.throws(
      () => parseDraftBids(`<p>${marker}${body}</p>`, "g"),
      DraftParseError,
      `${marker} 로 바뀌었을 때 조용히 0건이 됐다`,
    );
  }
});

test("⚠문서 그물이 헛불지 않는다 — 실물 픽스처 14장 중 14장", () => {
  // ⚠**헛불 위험이 가설이 아니라 실측이다**: 2006 구단 페이지의 사이드메뉴에
  //   `入札抽選参加、希望入団枠使用等の公示` 라는 링크가 있어 `抽選` 이 **본문 밖에 1건** 있다.
  //   그래서 문서 그물은 낱말 하나가 아니라 **「겹침 + 추첨」의 모양**을 본다.
  const counts: Record<string, number> = {};
  for (const name of DRAFT_FIXTURES) {
    counts[name] = parseDraftBids(fixture(name), "g").length;
  }
  assert.deepEqual(counts, {
    "draft-2019-list-g": 2,
    "draft-2019-list-c": 0,
    "draft-2006-list-g": 1,
    "draft-2001-list-f": 0,
    "draft-2005-list-e": 1,
    "draft-2006-list-d": 1,
    "draft-2007-list-d": 3,
    "draft-2007-list-l": 2,
    "draft-2001-index": 0,
    "draft-2013-index": 0,
    "draft-2024-index": 0,
    "draft-2026-index": 0,
    "draft-backnumber": 0,
    "draft-2013-list-b-404": 0,
  });
});

test("⚠`（第N回）` 가 문서 순서와 어긋나면 던진다(M7)", () => {
  assert.throws(
    () =>
      parseDraftBids(
        "<p>※1巡目（第2回）： 甲野一投手で阪神と重複、抽選で外れる<br>※1巡目（第1回）： 阪神と重複、抽選で確定</p>",
        "g",
      ),
    DraftParseError,
  );
});

test("⚠무관한 주석 **뒤에 이어지는 산문**이 M7 그물을 헛불게 하지 않는다", () => {
  // ⚠**뮤테이션이 잡아낸 구멍이다**(블록 경계를 없애도 시험이 전부 초록이었다).
  // 마지막 `※` 덩어리는 페이지 끝까지 뻗으므로, 뒤쪽 산문에 `抽選で` 가 있으면
  // 경계 없이는 **무관한 주석이 「문법 위반」으로 던져진다.** 각 주석은 자기 블록 안이다.
  const html = "<p>※注意事項</p><div>入団交渉は抽選で決まった順に行う</div>";
  assert.deepEqual(parseDraftBids(html, "g"), [], "던지지 않고 0건이다");
});

test("⚠상대 구단 칸이 비면 던진다(M7) — 빈 문자열을 구단으로 만들지 않는다", () => {
  // ⚠**이것도 뮤테이션이 잡아낸 구멍이다** — 검사를 지워도 시험이 전부 초록이었다.
  assert.throws(() => parseDraftBids("<p>※1巡目： 阪神、と重複、抽選で確定</p>", "g"), DraftParseError);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 분리 드래프트기(2005~2007) — ⚠**어휘 둘 + 구조 하나**다.
 *
 * 실물 아카이브 전수 실측(2026-09-05 · 2005~2026 · `※` 덩어리 **224건**):
 * ```
 * 경합 주석            220건   (나머지 4건 = 빈 덩어리 2 + 한자 설명 2)
 *   겹침   重複 217 · 競合 3            ← 競合 은 2005 뿐
 *   추첨   抽選 220                     ← 다른 낱말 0건
 *   결과   外れる 145 · 確定 74 · 獲得 1 ← 獲得 은 2006 中日 뿐
 *   （第N回）있음 118 · 없음 102
 *   선수명 있음 145 · 없음 75           ← **이름있음 = 外れる 로 220/220 일치**
 * ```
 * ⚠**셋째는 어휘가 아니라 구조다.** `（第N回）` 를 **페이지 순서**로 검증하면 118건 중
 * **110건만** 맞고 8건이 어긋나는데(전부 2007 의 `高校生選択会議`), **구획(`<h4>`) 안의
 * 순서**로 보면 **118/118** 이 맞는다. 2005~2007 은 本ドラフト가 高校生 · 大学生・社会人
 * 둘로 갈려 있어서 **한 페이지에 1巡目 입찰이 두 벌** 있기 때문이다.
 * ⚠**「몇 개를 더하면 되는가」로 접근하면 이걸 놓친다** — 어휘를 아무리 넓혀도 안 고쳐진다.
 * ──────────────────────────────────────────────────────────────────────────── */

test("⚠2005 는 겹침을 「競合」으로 쓴다 — 실물 楽天(224건 중 3건이 이 낱말)", () => {
  const bids = parseDraftBids(fixture("draft-2005-list-e"), "e");
  assert.deepEqual(bids, [
    {
      team: "e",
      kind: "koukousei",
      roundNo: 1,
      rivals: ["広島東洋"],
      nameDisplay: null,
      won: true,
    },
  ]);
});

test("⚠2005 楽天 페이지의 나머지 두 `※` 는 경합이 아니다 — 빈 덩어리와 한자 설명", () => {
  // `<td class="name">片山　博視 ※</td>` 의 각주 표시가 덩어리 하나를 만들고(빈 문자열),
  // `※「視」の漢字は「示」に「見」` 가 또 하나를 만든다. **둘 다 던지지 않고 세지도 않는다.**
  const scope = fixture("draft-2005-list-e").replace(/<!--[\s\S]*?-->/g, "").split("<footer")[0] ?? "";
  assert.equal(scope.split("※").length - 1, 3, "이 페이지의 `※` 는 3개다(실측)");
  assert.equal(parseDraftBids(fixture("draft-2005-list-e"), "e").length, 1, "그중 경합은 1건");
});

test("⚠2006 中日은 결과를 「獲得」으로 쓴다 — 224건 중 1건", () => {
  const bids = parseDraftBids(fixture("draft-2006-list-d"), "d");
  assert.deepEqual(bids, [
    {
      team: "d",
      kind: "koukousei",
      roundNo: 1,
      rivals: ["読売", "阪神"],
      // ⚠**`獲得` 은 이름을 생략한다** — 실측 220건에서 「이름있음 ⇔ 外れる」가 전건 성립한다.
      nameDisplay: null,
      won: true,
    },
  ]);
});

test("⚠（第N回）는 **구획 안**의 순서다 — 페이지 순서로 세면 2007 中日에서 어긋난다", () => {
  // 실물: 大学生 구획에 회차 없는 주석 1건이 **먼저** 오고, 그다음 高校生 구획에
  // `（第1回）`·`（第2回）` 가 온다. 페이지 순서로 세면 2·3 이 되어 어긋난다(실측 8건).
  const bids = parseDraftBids(fixture("draft-2007-list-d"), "d");
  assert.deepEqual(
    bids.map((b) => [b.kind, b.roundNo, b.nameDisplay, b.won]),
    [
      ["daigaku_shakaijin", 1, "長谷部康平", false],
      ["koukousei", 1, "佐藤由規", false],
      ["koukousei", 2, "岩嵜翔", false],
    ],
  );
});

test("⚠구획이 다르면 같은 회차가 두 번 나온다 — 그건 중복이 아니다", () => {
  // ⚠`draft_bid` 의 PK 는 `(season, kind, round_no, team)` 이라 **`kind` 가 이 둘을 가른다.**
  //   `kind` 를 안 실으면 적재가 「같은 구단·같은 회차」로 읽어 한쪽을 덮어쓴다.
  const bids = parseDraftBids(fixture("draft-2007-list-d"), "d");
  const first = bids.filter((b) => b.roundNo === 1);
  assert.equal(first.length, 2, "1회차 입찰이 두 구획에 있다");
  assert.deepEqual(new Set(first.map((b) => b.kind)), new Set(["daigaku_shakaijin", "koukousei"]));
});

test("⚠2007 西武: `</br>` 로 붙은 두 주석을 둘로 읽는다 — 실물(G1)", () => {
  // ⚠**합성 문자열로만 검증되던 자리다.** 실물의 구분자는 `<br>` 이 아니라 **`</br>`**(닫는 꼴)이고,
  //   `BLOCK_TAG` 의 `\/?` 가 그것을 경계로 인정하기 때문에 둘로 갈린다.
  //   ⚠**진짜로 아무 태그 없이 붙은 `※` 쌍은 아카이브 전수(2005~2026)에서 0건**이다 —
  //   그 경우는 여전히 합성 문자열로만 검증된다(위 「`<br>` 없이 붙은 두 주석」 본).
  const bids = parseDraftBids(fixture("draft-2007-list-l"), "l");
  assert.deepEqual(
    bids.map((b) => [b.kind, b.roundNo, b.nameDisplay, b.won]),
    [
      ["daigaku_shakaijin", 1, "長谷部康平", false],
      ["daigaku_shakaijin", 2, "服部泰卓", false],
    ],
  );
});

test("⚠받는 어휘는 **그물의 어휘보다 좁다** — 안 본 낱말은 통과가 아니라 예외다(M7)", () => {
  // ⚠**둘이 같은 집합이면 그물은 어휘 변화에 영원히 안 뜬다.** `競願` 은 「경합처럼 보인다」에는
  //   들어 있지만 **문법이 받지는 않는다** — 실물에서 한 번도 안 봤기 때문이다(224건 중 0건).
  assert.throws(
    () => parseDraftBids("<p>※1巡目： 甲野一投手で阪神と競願、抽選で外れる</p>", "g"),
    DraftParseError,
    "실측 0건인 낱말을 조용히 받아들이지 않는다",
  );
});

test("⚠`獲得` 을 넓힌 대가를 막는다 — 부정형이 「당첨」이 되지 않는다(M7)", () => {
  // ⚠**넓히면 무언가는 통과한다.** `抽選で獲得` 를 받으면 `抽選で獲得できず`(= 낙첨)도
  //   `won=true` 로 읽힐 수 있다 — 그게 이 확장의 정확한 대가다.
  //   막는 것은 **끝 고정**이다: 실측 220건이 **전건 결과 낱말에서 끝난다.**
  for (const tail of ["獲得できず", "獲得ならず", "確定せず", "外れるも再抽選"]) {
    assert.throws(
      () => parseDraftBids(`<p>※1巡目： 阪神と重複、抽選で${tail}</p>`, "g"),
      DraftParseError,
      tail,
    );
  }
});

test("⚠（辞退）는 선수가 아니다 — 2007 西武 실물 2건(이름 칸 2,327개 중 2건)", () => {
  // 2007 세이부는 高校生 1巡目·3巡目 을 **辞退**했다. 그대로 담으면 「辞退」라는 선수가 생기고,
  // 던지고 끝내면 **그 해 그 구단이 통째로 안 들어온다.**
  const rows = parseDraftPicks(fixture("draft-2007-list-l"), "l");
  assert.equal(rows.length, 6, "大学生 2 + 高校生 4");
  assert.ok(!rows.some((r) => r.nameDisplay.includes("辞退")), "「辞退」라는 선수를 만들지 않는다");
  assert.deepEqual(
    rows.filter((r) => r.kind === "koukousei").map((r) => r.roundNo),
    [4, 5, 6, 7],
    "⚠비워진 회차를 앞으로 당기지 않는다 — 소스가 말한 회차 그대로다",
  );
});

test("⚠이름 칸의 각주 `※` 는 이름이 아니다 — 2005 楽天 실물", () => {
  // ⚠**M10 이 걸린 자리다.** 그대로 두면 표의 `片山 博視 ※` 와 주석의 `片山博視` 가
  //   **다른 사람이 되어** 경합 그룹이 둘로 갈린다(2005 広島 낙첨 · 楽天 당첨이 정확히 이 쌍이다).
  const rows = parseDraftPicks(fixture("draft-2005-list-e"), "e");
  const first = rows.find((r) => r.kind === "koukousei" && r.roundNo === 1);
  assert.equal(first?.nameDisplay, "片山 博視", "각주 표시를 이름에 남기지 않는다");
  assert.equal(rows.length, 11, "大学生 8 + 高校生 3(選択権なし 2 제외)");
});

/* ────────────────────────────────────────────────────────────────────────────
 * HTML 주석 — ⚠**보이지 않는 것을 읽지 않는다**(2026-09-05 최종 재검토 [N2]).
 *
 * `decode` 의 `/<[^>]+>/g` 가 `<!-- <p>` 를 **태그로 먹고 본문을 남긴다.** 그래서
 * 브라우저가 안 보여 주는 것을 파서가 사실로 읽었다.
 * ⚠**실물이다**: 2023 야쿠르트 페이지에 주석 처리된 경합 문장이 남아 있고
 * (`docs/sources/2026-09-04-draft-wikipedia-markup-rules.md` §1 이 인용한다),
 * **2023 12구단 중 렌더링된 주석은 0건**이다.
 * ⚠⚠**방향이 [N1] 과 반대라 더 나쁘다** — 이 잔해 덕분에 2023 이 불변식에서 붉어지는데,
 * 그 붉음이 **우연히 남은 주석 한 줄에 의존**한다. npb 가 그 줄을 지우면 조용해진다.
 * **loudness 가 설계가 아니라 사고였다.**
 *
 * ⚠실측(커밋된 드래프트 픽스처 **14장** · 2026-09-05 에 4장을 더하고 다시 셌다): **전문에**
 * `<!-- 156 / --> 156` 로 짝이 전부 맞는다(**파일당 12개 × 13장** · 404 본문 1장만 0개).
 * ⚠**「푸터 위 11개」로 적었던 것은 이 경계가 세는 수가 아니다** — 주석 제거는 **푸터 컷보다
 * 먼저 전문에** 걸리고, 파일당 1개가 푸터 아래에 있다.
 * 그리고 전문에서 지워도 `<table>`·`<h4>`·`draftlist_`·`/draft/YYYY`·`page_draft`·`※`
 * **여섯 지표가 14장 중 14장에서 하나도 안 바뀐다** — 오늘 아무것도 잃지 않고,
 * 잃을 뻔한 것만 막는다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 커밋된 드래프트 픽스처 **전량**. ⚠**두 곳이 각자 목록을 적으면 한쪽만 늘어난다**(M1). */
const DRAFT_FIXTURES = [
  "draft-2019-list-g", "draft-2019-list-c", "draft-2006-list-g", "draft-2001-list-f",
  "draft-2005-list-e", "draft-2006-list-d", "draft-2007-list-d", "draft-2007-list-l",
  "draft-2001-index", "draft-2013-index", "draft-2024-index", "draft-2026-index",
  "draft-backnumber", "draft-2013-list-b-404",
] as const;

/**
 * ⚠**주석 분모를 시험이 다시 센다 — 손으로 고치지 마라.**
 *
 * [F5] 는 **「무엇을 센 수인가」가 코드와 문서에서 갈린** 결함이었다: 산문이 「푸터 위 11개」라고
 * 적었는데 `stripComments` 는 **푸터 컷보다 먼저 전문에** 걸리므로 실제로 다루는 것은 **12개**다.
 * ⚠**산문은 낡지만 이 본은 낡지 않는다** — 픽스처를 갱신하면 **그날 바로** 붉어진다.
 * (이 저장소의 `scripts/test/doc-figures.test.ts` 가 같은 일을 DB 로 한다.)
 */
test("⚠주석 분모: 픽스처 전문에 156/156 · 파일당 12개(404 본문만 0개)", () => {
  let opens = 0;
  let closes = 0;
  const per: Record<string, number> = {};
  for (const name of DRAFT_FIXTURES) {
    const html = fixture(name);
    const o = (html.match(/<!--/g) ?? []).length;
    const c = (html.match(/-->/g) ?? []).length;
    assert.equal(o, c, `${name}: 짝이 안 맞는다 — 그러면 파서가 던진다`);
    opens += o;
    closes += c;
    per[name] = o;
  }
  assert.equal(DRAFT_FIXTURES.length, 14, "픽스처 14장을 센다");
  assert.deepEqual([opens, closes], [156, 156], "전문 합계");
  assert.deepEqual(
    Object.entries(per).filter(([, n]) => n !== 12).map(([k, n]) => `${k}=${n}`),
    ["draft-2013-list-b-404=0"],
    "⚠12개가 아닌 것은 404 본문 한 장뿐이다",
  );
});

/** 규칙 문서 §1 이 인용한 실물 잔해. */
const COMMENTED_BID =
  '<p id="comment"></p>\n'
  + "<!-- <p>※1巡目： 武内夏暉投手で埼玉西武、福岡ソフトバンクと重複、抽選で外れる<br></p> -->";

test("⚠주석 안의 경합 문장을 읽지 않는다 — 2023 야쿠르트 실물 잔해(N2)", () => {
  assert.deepEqual(
    parseDraftBids(COMMENTED_BID, "s"),
    [],
    "⚠보이지 않는 문장을 사실로 읽으면 그 해가 「경합이 있었다」가 된다",
  );
});

test("⚠주석 밖에 같은 문장이 있으면 읽는다 — 가드가 넓어지면 안 된다", () => {
  const shown = COMMENTED_BID.replace("<!-- ", "").replace(" -->", "");
  const bids = parseDraftBids(shown, "s");
  assert.equal(bids.length, 1, "주석을 벗기면 읽혀야 한다");
  assert.deepEqual(bids[0]?.rivals, ["埼玉西武", "福岡ソフトバンク"]);
});

test("⚠주석 안의 지명 표를 읽지 않는다(N2) — 같은 구멍이 명단 쪽에도 있었다", () => {
  const html =
    "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>甲野 一</td><td>投手</td><td>某高</td></tr></table>"
    + "<!--<h4>育成選手選択会議</h4><table><tr><th>1位</th><td>없는 선수</td><td>捕手</td><td>某高</td></tr></table>-->";
  const rows = parseDraftPicks(html, "g");
  assert.equal(rows.length, 1, "주석 안의 지명이 섞이면 안 된다");
  assert.equal(rows[0]?.nameDisplay, "甲野 一");
});

test("⚠주석 안의 슬러그·연도를 줍지 않는다(N2) — 수집 진입점도 같은 경계다", () => {
  assert.deepEqual(
    parseDraftTeamSlugs('<body class="page_draft"><a href="draftlist_g.html">G</a><!--<a href="draftlist_zz.html">Z</a>--></body>'),
    ["g"],
    "⚠주석 안의 슬러그를 주우면 있지도 않은 페이지를 받으러 간다(M8)",
  );
  assert.deepEqual(
    parseDraftYears('<a href="/draft/2019/">2019</a><!--<a href="/draft/2027/">2027</a>-->'),
    [2019],
  );
});

/**
 * ⚠**두 경계의 근거가 다르다** — 주석 제거는 네 파서 전부, **푸터 컷은 지명·경합만**이다.
 * 진입점까지 자르면 **푸터에 있는 연도·슬러그를 조용히 잃는다.**
 * ⚠**내가 실제로 그렇게 만들 뻔했다**(자기 수정 재독에서 잡음) — 경계 하나를 재사용하면서
 * 근거를 함께 옮기지 않았다. 실측으로는 픽스처 14장 전부 푸터 아래가 비어 있어
 * **시험이 없었으면 아무도 몰랐다.**
 */
test("⚠수집 진입점은 푸터 아래도 본다 — 지명·경합과 경계가 다르다", () => {
  assert.deepEqual(
    parseDraftTeamSlugs('<body class="page_draft"><a href="draftlist_g.html">G</a><footer><a href="draftlist_c.html">C</a></footer></body>'),
    ["c", "g"],
    "⚠푸터의 슬러그를 버리면 그 구단이 아예 수집되지 않는다",
  );
  assert.deepEqual(
    parseDraftYears('<a href="/draft/2019/">2019</a><footer><a href="/draft/2026/">2026</a></footer>'),
    [2019, 2026],
    "⚠놓친 그 하나가 올해일 수 있다(그 함수의 M7 그물이 지키는 것)",
  );
});

test("⚠닫히지 않은 주석은 던진다(N2·M7) — 브라우저는 그 뒤를 통째로 숨긴다", () => {
  // 실측: 픽스처 14장 전문에서 `<!--` 와 `-->` 가 짝이 맞는다(**파일당 12개** · 404 본문만 0개 · 합 156/156).
  // 짝이 안 맞는 날 「그 뒤를 계속 읽는」 쪽을 고르면 **숨겨진 것을 사실로 읽는다.**
  const html = "<h4>新人選手選択会議</h4><table><tr><th>1位</th><td>甲野 一</td><td>投手</td><td>某高</td></tr></table><!-- 닫히지 않았다";
  assert.throws(() => parseDraftPicks(html, "g"), DraftParseError);
  assert.throws(() => parseDraftBids(html, "g"), DraftParseError);
});

test("⚠푸터 아래의 `※` 는 보지 않는다 — 명단 파서와 같은 경계다", () => {
  const html = "<p>※1巡目： 阪神と重複、抽選で確定</p><footer><p>※1巡目： 中日と重複、抽選で外れる</p></footer>";
  const bids = parseDraftBids(html, "g");
  assert.equal(bids.length, 1);
  assert.deepEqual(bids[0]?.rivals, ["阪神"]);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 연도 색인(`backnumber.html`)과 구단 슬러그 발견.
 *
 * ⚠**이 두 함수는 「수집 진입점」이다** — 여기가 조용히 적게 내면 그만큼의 연도·구단이
 * **아예 수집되지 않고**, 화면에서는 「원래 그 해는 그렇다」로 읽힌다. CLAUDE.md §2 의
 * 2018 오릭스 사고(`bs` 를 `b` 로 알고 적재해 148경기가 실패)와 **같은 자리**다.
 *
 * ⚠**아래 시험의 절반은 실물 픽스처다.** 이 저장소는 「합성 픽스처로는 검증되지 않는다」를
 * 실제 사고로 기록해 뒀다(2016 박스 · fixtures/README.md). 합성만으로 얻은 초록은 근거가 아니다.
 * ──────────────────────────────────────────────────────────────────────────── */

test("연도 색인에서 연도를 뽑는다", () => {
  const html = `<a href="./2025/">2025年</a><a href="./2024/">2024年</a><a href="./2001/">2001年</a>`;
  assert.deepEqual(parseDraftYears(html), [2001, 2024, 2025], "오름차순 · 중복 없음");
});

test("⚠실물 `backnumber.html` 에서 26개 연도를 빠짐없이 뽑는다", () => {
  // ⚠⚠**브리프의 정규식은 이 실물에서 0건이었다.** 실제 마크업은 `href="./2001/"` 가
  // 아니라 **`href="/draft/2001/"`** 다. 그대로 갔으면 진입점이 **첫 실행에서 던지고
  // 드래프트 수집이 통째로 안 돌았다.** Task 4 의 「실물 3건 중 0건 통과」와 같은 종류다.
  const years = parseDraftYears(fixture("draft-backnumber"));
  assert.equal(years.length, 26, "조사 문서의 실측(2001~2026 · 26건)과 같다");
  assert.equal(years[0], 2001);
  assert.equal(years.at(-1), 2026);
  // ⚠**결번 0** — 26개가 연속인가. 하나가 빠져도 그 해가 통째로 사라진다.
  assert.deepEqual(
    years,
    Array.from({ length: 26 }, (_, i) => 2001 + i),
    "2001..2026 연속 · 결번 0",
  );
});

test("⚠경기 결과 링크(`/scores/2026/0904/`)를 연도로 읽지 않는다", () => {
  // ⚠**실물 `backnumber.html` 에 이 모양이 실재한다**(그날 경기 5건). 느슨한 정규식이면
  // `0904` 가 **904년**이 되어 색인에 섞인다 — 904 는 그럴듯하지 않아 눈에 띄지만,
  // `2026` 쪽은 **진짜 연도와 구별되지 않는다.**
  const html = `<a href="/draft/2001/">2001年</a><a href="/scores/2026/0904/b-m-21/">試合</a>`;
  assert.deepEqual(parseDraftYears(html), [2001], "드래프트 연도만 — 904 도 2026 도 아니다");
});

test("⚠연도 링크를 한 건도 못 찾으면 던진다(M7)", () => {
  assert.throws(() => parseDraftYears("<html><body>お知らせ</body></html>"), DraftParseError);
});

test("⚠새 형태의 `/draft/YYYY/` 링크를 조용히 흘리지 않는다(M7 그물)", () => {
  // ⚠**이 파서가 조용히 틀리는 방식은 「전부 실패」가 아니라 「최신 연도만 놓침」이다.**
  // 색인이 최신 연도만 다른 형태로 걸면 나머지는 그대로 나오므로 **아무도 결함으로
  // 못 읽는다** — 그런데 놓친 그 한 개가 **올해**다.
  const html = `<a href="/draft/2026/">2026年</a><a href="/draft/2027/index.html">2027年</a>`;
  assert.throws(() => parseDraftYears(html), DraftParseError);
});

test("⚠구단 슬러그를 하드코딩하지 않고 페이지에서 발견한다", () => {
  const html = `<a href="draftlist_g.html">読売</a><a href="draftlist_bs.html">オリックス</a>`;
  assert.deepEqual(parseDraftTeamSlugs(html), ["bs", "g"], "정렬 · 2013 오릭스는 bs 다");
});

test("⚠슬러그를 한 건도 못 찾으면 던진다", () => {
  assert.throws(() => parseDraftTeamSlugs("<html></html>"), DraftParseError);
});

test("⚠실물 2013 연도 톱: 오릭스가 `bs` 이고 `b` 는 없다", () => {
  // ⚠**하드코딩했으면 여기서 죽는다.** 실측으로 `draftlist_b.html` 은 2013 에서
  // **nginx 404** 를 낸다(표본 `draft-2013-list-b-HTTP404.html`). 그 404 를 파서에 넣으면
  // 던지긴 하지만, **애초에 `bs` 를 시도하지 않으므로** 2013 오릭스 지명이 통째로 비고
  // 화면은 「그 해는 원래 그렇다」로 읽힌다.
  const slugs = parseDraftTeamSlugs(fixture("draft-2013-index"));
  assert.equal(slugs.length, 12);
  assert.ok(slugs.includes("bs"), "2013 오릭스 = bs");
  assert.ok(!slugs.includes("b"), "2013 에 b 는 없다 — 실측 404");
});

test("⚠실물 2024 연도 톱: 같은 구단이 `b` 다 — 슬러그는 연도의 함수다", () => {
  const slugs = parseDraftTeamSlugs(fixture("draft-2024-index"));
  assert.equal(slugs.length, 12);
  assert.ok(slugs.includes("b"), "2024 오릭스 = b");
  assert.ok(!slugs.includes("bs"), "2024 에 bs 는 없다");
});

test("⚠실물 2001 연도 톱: 지금 없는 구단이 나온다(近鉄 `bu` · ブルーウェーブ `bw`)", () => {
  // ⚠**현행 12구단 코드를 상수로 박으면 이 해는 2구단이 조용히 빈다.**
  // 2004 시즌 뒤 近鉄 와 オリックス 가 합병했으므로 `bu`·`bw` 는 어느 현행 표에도 없다.
  const slugs = parseDraftTeamSlugs(fixture("draft-2001-index"));
  assert.equal(slugs.length, 12);
  for (const gone of ["bu", "bw", "yb"]) {
    assert.ok(slugs.includes(gone), `2001 에 ${gone} 가 있다`);
  }
});

test("⚠세 연도의 슬러그 집합이 서로 다르다 — 그래서 하드코딩이 원리적으로 불가능하다", () => {
  const y2001 = parseDraftTeamSlugs(fixture("draft-2001-index"));
  const y2013 = parseDraftTeamSlugs(fixture("draft-2013-index"));
  const y2024 = parseDraftTeamSlugs(fixture("draft-2024-index"));
  assert.notDeepEqual(y2001, y2013);
  assert.notDeepEqual(y2013, y2024);
  // 셋 다 12구단이지만 **구성이 다르다** — 개수만 세는 검사는 이것을 못 잡는다.
  for (const s of [y2001, y2013, y2024]) assert.equal(s.length, 12);
});

test("⚠실물 2026 연도 톱은 슬러그가 0건이라 던진다", () => {
  // ⚠**우리가 바깥에서 아는 것**: 이 표본은 2026-09-04 취득이고 그해 드래프트는 10월이라
  // 아직 안 열렸다 — `draftlist_*` 는 **개최 당일에 생긴다**(조사 문서 §7).
  // ⚠**그건 파서가 아는 것이 아니다.** 그걸 알려면 오늘이 며칠인지 읽어야 하고(M6),
  // 파서는 시계를 안 읽는다. 파서가 하는 일은 둘이다: **빈 배열로 흘리지 않는 것**
  // (흘리면 진짜 붕괴도 똑같이 조용하다)과 **무엇을 봤는지 남기는 것**(`observed`).
  // ⚠~~「파서는 둘을 구별할 수 없다」~~ 고 적혀 있었는데 **이제 거짓이다** — 판정은 안 하지만
  // **관측은 가른다**(바로 아래 세 본). 판정에 필요한 「그 연도가 과거인가」만 호출자 몫이다.
  assert.throws(() => parseDraftTeamSlugs(fixture("draft-2026-index")), DraftParseError);
});

test("⚠슬러그가 어휘 밖 형태면 던진다(M7 그물) — 한 구단이 조용히 빠지지 않게", () => {
  // ⚠**놓친 한 구단은 조용하고 영구적이다.** 11개가 정상으로 나오므로 개수를 세도 안 잡힌다
  // (그리고 개수 12 를 박으면 위 2026 케이스와 합성 시험이 죽는다).
  const html = `<a href="draftlist_g.html">読売</a><a href="draftlist_B.html">オリックス</a>`;
  assert.throws(() => parseDraftTeamSlugs(html), DraftParseError);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 슬러그 0건의 **두 갈래** — ⚠호출자가 한국어 메시지를 문자열 매칭하지 않아도 되게.
 *
 * ⚠**파서는 「아직 안 열렸다」를 알 수 없다.** 그걸 알려면 **오늘이 며칠인지**를 읽어야 하는데
 * 파서는 시계를 안 읽는다(M6). 그러니 노출하는 것은 **판정이 아니라 관측**이다 —
 * 「그 해가 아직인가 / 마크업이 무너졌나」는 **그 연도가 과거인지 아는 호출자**만 정할 수 있다.
 * ⚠과거 연도에서 `no-team-links` 가 나오면 그건 개최 전이 아니라 **붕괴**다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 던진 예외를 **받아서 돌려준다.**
 * ⚠**`assert.throws` 는 예외를 돌려주지 않는다**(반환이 `void` 다). 초판에서 그 반환을
 * 캐스트해 `.observed` 를 읽었고, 세 본이 전부 `Cannot read properties of undefined` 로
 * 죽었다 — **읽어서가 아니라 돌려서 잡혔다.**
 */
function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("던질 줄 알았는데 안 던졌다");
}

test("⚠2026 실물(구단 링크 0건)은 `no-team-links` 로 관측된다", () => {
  const err = caught(() => parseDraftTeamSlugs(fixture("draft-2026-index")));
  assert.ok(err instanceof DraftIndexError);
  assert.equal(err.observed, "no-team-links");
  // ⚠**기존 호출자를 깨지 않는다** — 하위 클래스라 `DraftParseError` 로도 잡힌다.
  assert.ok(err instanceof DraftParseError);
});

test("⚠실물 404 본문은 `no-draft-marker` 로 관측된다 — 같은 0건이지만 뜻이 다르다", () => {
  // ⚠**수집기가 실제로 받는 모양이다**: 2013 에 `draftlist_b.html` 을 치면 이게 온다
  // (nginx 404 · 162바이트). 2026 톱과 **똑같이 슬러그 0건**인데 원인이 정반대다.
  const err = caught(() => parseDraftTeamSlugs(fixture("draft-2013-list-b-404")));
  assert.ok(err instanceof DraftIndexError);
  assert.equal(err.observed, "no-draft-marker");
});

test("⚠`開催要項` 을 표지로 쓰지 마라 — 끝난 시즌에도 남는 템플릿 잔존물이다", () => {
  // ⚠⚠**이 시험이 막는 것은 「그럴듯한 대안」이다.** 2026(개최 전) 톱에 `開催要項` 이 있어서
  // 「개최 전 표지」로 삼고 싶어진다. **아래 두 묶음이 그게 왜 안 되는지를 못으로 박는다.**
  // ⚠**사유가 한 번 뒤집혔다**(2026-09-05 재검수): ~~「그걸 쓰면 2001 붕괴가 「아직」으로
  // 읽힌다」~~ 는 **방향이 반대**였다(2001 은 그 말이 없어서 오히려 엄격한 갈래로 간다).
  // **진짜 사유는 「개최 여부와 아무 상관이 없다」**이고, 그건 아래처럼 실물로 셀 수 있다.

  // ⑴ 끝난 시즌에도 **남는다** — 그러니 「아직」의 표지가 아니다.
  for (const year of ["draft-2013-index", "draft-2024-index"]) {
    assert.ok(fixture(year).includes("開催要項"), `${year}: 끝난 시즌인데 開催要項 이 남아 있다`);
    assert.equal(parseDraftTeamSlugs(fixture(year)).length, 12, `${year}: 그해 드래프트는 실제로 열렸다`);
  }
  // ⑵ 열린 시즌인데 **없기도 하다** — 그러니 「열렸다」의 표지도 아니다.
  assert.ok(!fixture("draft-2001-index").includes("開催要項"));
  assert.equal(parseDraftTeamSlugs(fixture("draft-2001-index")).length, 12);

  // → 표지가 답할 질문은 「드래프트 섹션의 페이지인가」이고 `page_draft` 가 그것이다.
  //   `page_draft` 가 있고 팀 링크가 0건이면 **`開催要項` 이 없어도** `no-team-links` 다.
  const html = `<body class="page_draft" id="ctop"><p>ニュース</p></body>`;
  const err = caught(() => parseDraftTeamSlugs(html));
  assert.ok(err instanceof DraftIndexError);
  assert.equal(err.observed, "no-team-links", "開催要項 이 없어도 드래프트 페이지다");
});
