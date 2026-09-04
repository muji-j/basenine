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
  assert.throws(() => parseDraftPicks("<html><body><p>표가 없다</p></body></html>", "g"), DraftParseError);
});

test("⚠섹션은 있는데 행이 없어도 던진다(M7)", () => {
  assert.throws(
    () => parseDraftPicks("<h4>新人選手選択会議</h4><div>표가 통째로 사라졌다</div>", "g"),
    DraftParseError,
  );
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
    roundNo: 1,
    rivals: ["東京ヤクルト", "阪神"],
    nameDisplay: "奥川恭伸",
    won: false,
  });
  // ※1巡目（第2回）： 宮川哲投手で埼玉西武と重複、抽選で外れる
  assert.deepEqual(bids[1], {
    team: "g",
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
  assert.deepEqual(bids, [{ team: "g", roundNo: 1, rivals: ["中日"], nameDisplay: null, won: true }]);
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
  // 어휘가 한쪽만 바뀐 날(`重複`→`競合`) 그냥 넘기면 **그 해 경합이 통째로 0건**이 되고,
  // 0건은 단독지명과 구별되지 않아 **아무도 결함으로 못 읽는다.**
  assert.throws(
    () => parseDraftBids("<p>※1巡目： 甲野一投手で阪神と競合、抽選で外れる</p>", "g"),
    DraftParseError,
  );
  assert.throws(() => parseDraftBids("<p>※1巡目： 阪神と重複、抽選で保留</p>", "g"), DraftParseError);
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
