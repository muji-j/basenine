/**
 * **연속 기록 라벨** — 이름이 남의 기록 이름이 아닌가, 그리고 **툴팁이 조용히 죽지 않는가**.
 *
 * ## 무엇이 있었나 (2026-09-07)
 *
 * 화면 라벨이 **`連続安打`** 였는데, 그것은 **공인야구규칙 9.23(a)** 의 이름이고
 * **타석 단위의 다른 기록**이다(「四球、死球、打撃または走塁妨害、および犠牲バントによって
 * 中断されない」). 우리가 세는 것은 **(b) `連続試合安打`**(경기 단위)이고, 설명문(`short`)은
 * 처음부터 「安打を打った**試合**が」라고 맞게 적혀 있었다 — **이름만 남의 기록 이름이었다.**
 * 루트 `CLAUDE.md` §6 의 「이름이 같은데 값이 다르면 거짓말」에 정면으로 걸린다.
 *
 * ## ⚠고칠 때의 함정 — 한쪽만 고치면 **툴팁이 소리 없이 사라진다**
 *
 * `term(label)` 은 **라벨 → 키 역인덱스**(`termKeyForLabel`)로 툴팁을 붙이는데,
 * 그 역인덱스는 **모르는 라벨에 `undefined` 를 돌려주고 던지지 않는다.**
 * 용어집만 고치고 화면의 하드코딩 문자열을 안 고치면 **글자는 나오고 툴팁만 없어진다** —
 * 문법도 멀쩡해서 **소스를 읽어서는 안 보인다.**
 * → 화면이 **키**를 넘기고 `termLabel()`(모르는 키에 던진다)이 라벨을 꺼내게 바꿨다.
 *   **이 파일이 그 배선을 고정한다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY, termKeyForLabel, termLabel, termOf } from "../src/glossary.ts";
import type { Term } from "../src/glossary.ts";
import { BLOCKS } from "../src/blocks.ts";
import { term } from "../src/parts.ts";

const STREAK_KEYS = ["hitStreak", "onBaseStreak", "hitlessStreak"] as const;

test("⚠連続安打 は 9.23(a) の別記録の名前だ — 私たちが数えるのは (b) 連続試合安打", () => {
  assert.equal(termOf("hitStreak")!.label, "連続試合安打");
  assert.equal(termOf("onBaseStreak")!.label, "連続試合出塁");
  assert.equal(termOf("hitlessStreak")!.label, "連続試合無安打");
  for (const key of STREAK_KEYS) {
    const label = termOf(key)!.label;
    assert.ok(
      label.startsWith("連続試合"),
      `${key} のラベルが「連続試合」で始まらない: ${label} — 9.23(a) の名前と混ざる`,
    );
  }
});

test("⚠説明文は最初から正しかった — 「試合」単位だと言っている", () => {
  assert.match(termOf("hitStreak")!.short, /試合/);
  assert.match(termOf("onBaseStreak")!.short, /試合/);
});

/**
 * ⚠**用語集の中で他のラベルと衝突していないか.** `連続試合安打` を `連続安打` に戻すと
 * ここは通ってしまうので、この test だけでは足りない — 上の test と組で意味を持つ。
 */
test("⚠3種のラベルは用語集から到達できる — 逆索引が引ける", () => {
  for (const key of STREAK_KEYS) {
    assert.equal(termKeyForLabel(termOf(key)!.label), key, `${key} が逆索引で引けない`);
  }
});

/**
 * ⚠**これが「静かに死ぬ」を捕まえる test だ.**
 * 選手ページの `row()` は用語集キーを受け取り、`termLabel()` がラベルを出す。
 * ラベルを直書きに戻すと、用語集のラベルを変えた瞬間にここが落ちる。
 */
test("⚠画面はラベルを直書きしない — キーからラベルを出し、ツールチップが付く", () => {
  for (const key of STREAK_KEYS) {
    const rendered = term(termLabel(key)).__raw;
    assert.match(
      rendered,
      new RegExp(`data-term="${key}"`),
      `${key} のラベルにツールチップが付いていない — termKeyForLabel が引けなかった`,
    );
  }
});

/**
 * ⚠**代役の用語集で「ラベルを変えたら画面が付いてくるか」を確かめる.**
 * 実の用語集を書き換えずに済むので、この test 自体が副作用を持たない。
 */
test("⚠用語集のラベルを変えたら画面がついてくる — 片方だけ直す事故を防ぐ", () => {
  const fake: Record<string, Term> = {
    hitStreak: { ...GLOSSARY["hitStreak"]!, label: "ダミー連続記録" },
  };
  assert.equal(termLabel("hitStreak", fake), "ダミー連続記録");
  assert.throws(() => termLabel("nosuchkey"), /용어집에 없는 지표/);
});

test("⚠ブロックの説明文も用語集から出る — 4か所目の直書きだった", () => {
  const streak = BLOCKS.find((b) => b.id === "streak");
  assert.ok(streak !== undefined);
  assert.equal(streak.desc, `打者のみ。${termLabel("hitStreak")}・${termLabel("onBaseStreak")}`);
  assert.match(streak.desc, /連続試合安打/);
});
