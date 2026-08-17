/**
 * 타석 로그 원문의 해석.
 *
 * ⚠**이 컬럼은 113,019행 전부 채워져 있는데 지금까지 아무 데서도 읽히지 않았다.**
 * 그래서 여기서 지키는 것은 「값이 맞는가」보다 **「무엇을 모르는지 정직한가」**다 —
 * 타구 종류는 27.5%가 원문에 아예 없고, 그걸 「없다」로 접으면 지표가 조용히 틀린다(M11).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInfield, readPbp, sideOf, unknownTokens } from "../src/pbp.ts";

test("방향과 타구 종류를 함께 읽는다", () => {
  assert.deepEqual(readPbp("セカンドゴロ"), {
    field: "2b", trajectory: "ground", strikeout: null, inPlay: true,
  });
  assert.deepEqual(readPbp("センターフライ"), {
    field: "cf", trajectory: "fly", strikeout: null, inPlay: true,
  });
  assert.equal(readPbp("ライトへの2ランホームラン").trajectory, "homer");
  assert.equal(readPbp("ショートライナー").trajectory, "liner");
});

/**
 * ⚠**긴 토큰부터 본다.** `レフト線` 을 `レフト` 로 읽으면 구역이 뭉개지고,
 * `ファウルフライ` 를 `フライ` 로 읽으면 파울이 뜬공에 섞인다 —
 * 그러면 뜬공 비율이 조용히 부풀어 오른다.
 */
test("⚠비슷한 토큰을 뭉개지 않는다", () => {
  assert.equal(readPbp("左中間へのタイムリー二塁打").field, "lc", "左中間을 レフト로 읽었다");
  assert.equal(readPbp("キャッチャーファウルフライ").trajectory, "foulFly", "파울플라이를 뜬공으로 읽었다");
  assert.equal(readPbp("ピッチャーへのバント").trajectory, "bunt");
});

/**
 * ⚠**「모른다」와 「없다」는 다르다**(M11).
 * 비홈런 안타에는 타구 종류 표기가 **아예 없다** — 실측 인플레이의 27.5%다.
 * 이걸 「땅볼도 뜬공도 아니다」로 접으면 뜬공 비율이 실제보다 작게 나오고,
 * 그 결손이 xFIP 를 산출하지 않는 결정의 근거이기도 하다.
 */
test("⚠타구 종류가 원문에 없으면 unknown 이다 — 없는 것으로 접지 않는다(M11)", () => {
  const hit = readPbp("センター前ヒット");
  assert.equal(hit.field, "cf", "방향은 읽힌다");
  assert.equal(hit.trajectory, "unknown", "모르는 것을 다른 값으로 접었다");
  assert.equal(hit.inPlay, true, "안타인데 인플레이가 아니라고 했다");
});

test("삼진의 내역을 구별한다 — 다만 헛스윙 유도율이 아니다", () => {
  assert.equal(readPbp("空振り三振").strikeout, "swinging");
  assert.equal(readPbp("見逃し三振").strikeout, "looking");
  assert.equal(readPbp("三振（スリーバント失敗）").strikeout, "buntFoul");
  assert.equal(readPbp("振り逃げ（ワイルドピッチ）").strikeout, "reachedOnStrikeout");
  // 삼진은 타구가 없다
  assert.equal(readPbp("空振り三振").inPlay, false);
  assert.equal(readPbp("空振り三振").field, null);
});

test("타구가 없는 사건은 방향도 종류도 없다", () => {
  for (const t of ["フォアボール", "敬遠フォアボール", "デッドボール", "打撃妨害出塁"]) {
    const f = readPbp(t);
    assert.equal(f.field, null, `${t} 에 방향이 붙었다`);
    assert.equal(f.trajectory, null, `${t} 에 타구 종류가 붙었다`);
    assert.equal(f.inPlay, false);
  }
});

test("빈 문자열에서 값을 지어내지 않는다", () => {
  assert.deepEqual(readPbp(""), { field: null, trajectory: null, strikeout: null, inPlay: false });
  assert.deepEqual(readPbp("   "), { field: null, trajectory: null, strikeout: null, inPlay: false });
});

/**
 * ⚠**2루수를 우측에 넣는 것은 우리 정의다**(수비 위치 기준).
 * 「타구가 떨어진 지점」이 아니라 **「처리한 야수 기준」**이라는 것도 함께 말해야 한다 —
 * 시프트와 호수비가 섞이기 때문이다.
 */
test("좌·중·우 구역을 수비 위치 기준으로 나눈다", () => {
  assert.equal(sideOf("lf"), "left");
  assert.equal(sideOf("ss"), "left");
  assert.equal(sideOf("3b"), "left");
  assert.equal(sideOf("cf"), "center");
  assert.equal(sideOf("rf"), "right");
  assert.equal(sideOf("2b"), "right", "2루수를 우측에 넣는 정의가 바뀌었다");
  assert.equal(sideOf("1b"), "right");
});

test("내야와 외야를 가른다 — 내야안타 판정의 입력이다", () => {
  for (const f of ["ss", "1b", "2b", "3b", "p", "c"] as const) assert.ok(isInfield(f), `${f} 가 내야가 아니다`);
  for (const f of ["lf", "cf", "rf", "lc", "rc"] as const) assert.ok(!isInfield(f), `${f} 가 내야다`);
});

/**
 * ⚠**모르는 어휘를 조용히 흘리지 않는다**(M7).
 * 실측(2026-08-16)으로 113,019행에서 미분류가 **0종**이므로 임계값 0으로 실패시킬 수 있다.
 * 소스 표기가 바뀌면 여기서 걸린다 — 안 걸리면 타구 성향이 서서히 틀려진다.
 */
test("⚠모르는 어휘를 골라낸다 — 소스 표기가 바뀌면 여기서 걸린다(M7)", () => {
  assert.deepEqual(unknownTokens(["セカンドゴロ", "空振り三振", "フォアボール", ""]), []);
  assert.deepEqual(unknownTokens(["宇宙へ消えた"]), ["宇宙へ消えた"]);
  // 같은 어휘는 한 번만
  assert.deepEqual(unknownTokens(["謎", "謎"]), ["謎"]);
});

/**
 * ⚠**방해 표기는 「가해자의 수비 위치」로 시작한다.**
 * `ピッチャー走塁妨害出塁` 를 방향 토큰으로 먼저 읽으면 **「투수 앞 타구」**가 되어
 * 방향 통계가 오염되고, 타구 종류가 `unknown` 인데 안타가 아니라서
 * `batted-ball.ts` 의 M7 불변식이 예외를 던진다 — 2024 시즌 적재에서 **실제로 터졌다**.
 *
 * 실측 안전성: 타석 로그 178,420행(고유 290종) 중 「방향으로 시작하면서 방해 어휘 포함」은
 * **2종 3행**뿐이고 둘 다 방해 플레이다. 정상 타구는 한 건도 이 분기로 새지 않는다.
 */
test("⚠방해를 방향보다 먼저 본다 — 안 그러면 가해자 위치가 타구 방향이 된다", () => {
  for (const raw of ["ピッチャー走塁妨害出塁", "キャッチャー守備妨害アウト"]) {
    const f = readPbp(raw);
    assert.equal(f.field, null, `${raw} 를 타구로 읽었다`);
    assert.equal(f.trajectory, null, `${raw} 에 타구 종류가 붙었다`);
    assert.equal(f.inPlay, false, `${raw} 를 인플레이 타구로 셌다`);
  }
  // 방해가 아닌 정상 타구는 그대로 읽는다
  const g = readPbp("ピッチャーゴロ");
  assert.equal(g.field, "p");
  assert.equal(g.trajectory, "ground");
});

/** 방해 3종 전부가 「타구 없음」으로 등록돼 있어야 미분류로 새지 않는다(M7) */
test("방해 3종을 모르는 어휘로 흘리지 않는다", () => {
  assert.deepEqual(
    unknownTokens(["打撃妨害出塁", "ピッチャー走塁妨害出塁", "キャッチャー守備妨害アウト"]),
    [],
  );
});

/**
 * ⚠**`規則違反アウト`** — 2022 아카이브에서 나왔다(`2022/0723/t-db-15` 嶺井).
 *
 * 반칙 타구 등으로 타자가 아웃된 것이다. **접촉은 있었지만 원문에 방향도 종류도 없다** —
 * 그래서 우리에게는 「타구 없음」이다(M11: 「모른다」를 「뜬공」으로 만들지 않는다).
 *
 * ⚠**이 어휘가 빠져 있으면 빌드가 통째로 멈춘다** — `battedBalls` 가 임계값 0으로 던지기 때문이다.
 * 실제로 2022를 넣자 그렇게 됐고, 그게 M7 이 의도한 동작이다(조용히 0을 넣지 않는다).
 * 그러니 **박스 셀(`違反`)만 고치면 절반**이다. 어휘표가 둘이라는 것을 이 시험이 고정한다.
 */
test("⚠`規則違反アウト`은 모르는 어휘가 아니다 — 어휘표가 둘이다", () => {
  assert.deepEqual(unknownTokens(["規則違反アウト"]), [], "타석 로그 쪽 어휘표에 없다");
  const f = readPbp("規則違反アウト");
  assert.equal(f.field, null, "방향이 없는데 방향을 만들어 냈다");
  assert.equal(f.trajectory, null, "타구 종류가 없는데 만들어 냈다");
});
