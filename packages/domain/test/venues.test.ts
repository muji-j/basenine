/**
 * **구장 정본 표 자체의 성질** — DB 없이 확인할 수 있는 것만.
 *
 * DB 대조는 `venues-db.test.ts` 가 한다. 둘을 가르는 이유는
 * 「표가 스스로 모순인가」와 「표가 낡았는가」가 **다른 사건**이기 때문이다 —
 * 앞의 것은 DB 가 없어도 항상 참이어야 하고, 뒤의 것은 백필하면 바뀐다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VENUES,
  homeVenueKind,
  isHomeVenue,
  knownVenueNames,
  primaryVenue,
  venueById,
  venueOf,
} from "../src/venues.ts";
import { TEAMS } from "../src/teams.ts";

test("모르는 구장은 던진다 — **조용히 넘기지 않는다**(M7)", () => {
  assert.throws(() => venueOf("存在しない球場"), /모르는 구장/);
  // ⚠부분 일치·정규화를 하지 않는다. 표기가 흔들리면 던져야 알아챈다
  assert.throws(() => venueOf("神宮球場"), /모르는 구장/);
  assert.throws(() => venueOf("神　宮"), /모르는 구장/, "전각 공백은 파서가 접는다 — 표가 받아 주면 안 된다");
  assert.throws(() => venueById("no-such-building"), /모르는 건물 ID/);
});

test("⚠개명은 **같은 건물 ID** 로 온다 — 이게 이 표의 존재 이유다", () => {
  for (const group of [
    ["ヤフオクドーム", "PayPayドーム", "みずほPayPay"],
    ["メットライフ", "ベルーナドーム"],
    ["ナゴヤドーム", "バンテリンドーム"],
    ["楽天生命パーク", "楽天モバイル"],
    ["新潟", "ハードオフ新潟"],
  ]) {
    const ids = new Set(group.map((n) => venueOf(n).id));
    assert.equal(ids.size, 1, `${group.join("→")} 가 ${[...ids].join(",")} 로 쪼개졌다`);
  }
});

test("⚠札幌ドーム 과 エスコンＦ 는 **다른 건물이다** — 합치면 2.3%p 가 뭉개진다", () => {
  assert.notEqual(venueOf("札幌ドーム").id, venueOf("エスコンＦ").id);
  // 둘 다 日本ハム의 본거지지만 시즌이 갈린다
  assert.equal(primaryVenue("f", 2022).id, "sapporo-dome");
  assert.equal(primaryVenue("f", 2023).id, "es-con-field");
});

test("⚠`山形` / `山形市` 는 **미확인**이라 합치지 않았다 — note 가 그 사실을 나른다", () => {
  assert.notEqual(venueOf("山形").id, venueOf("山形市").id);
  for (const n of ["山形", "山形市"]) {
    assert.match(
      venueOf(n).note ?? "",
      /미확인/,
      `${n} 의 note 가 「미확인」을 말하지 않는다 — 판정이 끝난 것처럼 읽힌다`,
    );
  }
});

test("문자열은 건물 하나에만 붙는다 · 건물 ID 는 유일하다", () => {
  const names = [...knownVenueNames()];
  assert.equal(names.length, VENUES.flatMap((v) => v.names).length, "같은 문자열이 두 번 적혀 있다");
  assert.equal(new Set(VENUES.map((v) => v.id)).size, VENUES.length);
  for (const v of VENUES) {
    assert.ok(v.names.length > 0, `${v.id} 에 문자열이 없다`);
    assert.ok(
      v.names.some((n) => n.name === v.display),
      `${v.id} 의 display(${v.display}) 가 별칭 이력에 없다 — 우리가 지어낸 이름이면 안 된다`,
    );
  }
});

test("⚠별칭 이력은 **끊기지 않는다** — 후임 표기가 없는 개명은 「구장이 사라진 것」이 된다", () => {
  for (const v of VENUES) {
    const sorted = [...v.names].sort((a, b) => a.firstSeen - b.firstSeen);
    assert.deepEqual(sorted, [...v.names], `${v.id} 의 names 가 시간순이 아니다`);
    for (const [i, n] of v.names.entries()) {
      const next = v.names[i + 1];
      if (n.supersededAfter === null) {
        assert.equal(next, undefined, `${v.id}: ${n.name} 이 아직 쓰이는데 뒤에 다른 표기가 있다`);
        continue;
      }
      assert.notEqual(next, undefined, `${v.id}: ${n.name} 이 ${n.supersededAfter} 에 끝났는데 후임이 없다`);
      assert.ok(
        next!.firstSeen <= n.supersededAfter + 1,
        `${v.id}: ${n.name}(→${n.supersededAfter}) 과 ${next!.name}(${next!.firstSeen}~) 사이에 빈 해가 있다`,
      );
    }
    // ⚠마지막 표기는 반드시 살아 있어야 한다 — 아니면 그 건물에 「지금 이름」이 없다
    assert.equal(v.names.at(-1)!.supersededAfter, null, `${v.id} 의 마지막 표기가 끝나 있다`);
  }
});

test("⚠2024 소프트뱅크는 시즌 도중에 바뀌었다 — **시즌으로 판정하면 못 잡는다**", () => {
  // 같은 2024 시즌에 두 표기가 다 살아 있다. 판정 키는 시즌이 아니라 **문자열**이다
  assert.equal(venueOf("PayPayドーム").id, venueOf("みずほPayPay").id);
  assert.equal(homeVenueKind("PayPayドーム", "h", 2024), "primary");
  assert.equal(homeVenueKind("みずほPayPay", "h", 2024), "primary");
});

test("⚠12구단 전부가 보유 9시즌에서 본거지를 하나씩 갖는다", () => {
  for (let season = 2018; season <= 2026; season += 1) {
    const ids = TEAMS.map((t) => primaryVenue(t.code, season).id);
    assert.equal(new Set(ids).size, 12, `${season}: 두 팀이 같은 건물을 본거지로 갖는다 — ${ids.join(",")}`);
  }
});

test("⚠제2 홈구장은 홈구장이다 — 「경기 수」로 자르면 여기가 사라진다", () => {
  // 阪神 京セラ(연 3~9경기) · オリックス ほっと神戸(연 3~11경기)
  assert.equal(homeVenueKind("京セラD大阪", "t", 2025), "secondary");
  assert.equal(homeVenueKind("ほっと神戸", "b", 2025), "secondary");
  assert.ok(isHomeVenue("京セラD大阪", "t", 2025));
  assert.ok(isHomeVenue("ほっと神戸", "b", 2025));
  // 같은 구장이라도 홈팀이 아니면 지방개최다
  assert.equal(homeVenueKind("京セラD大阪", "g", 2025), "neutral");
  assert.equal(homeVenueKind("ほっと神戸", "g", 2020), "neutral");
});

test("⚠2021 올림픽 대체는 **홈구장이 아니다** — 경기 수가 많다고 홈이 되지 않는다", () => {
  // DeNA 東京ドーム 6 · 神宮 4 · ヤクルト 東京ドーム 6
  assert.equal(homeVenueKind("東京ドーム", "db", 2021), "neutral");
  assert.equal(homeVenueKind("神宮", "db", 2021), "neutral");
  assert.equal(homeVenueKind("東京ドーム", "s", 2021), "neutral");
});

test("⚠日本ハム의 東京ドーム 제2 홈은 **에스컴필드로 옮긴 해에 끝난다**", () => {
  assert.equal(homeVenueKind("東京ドーム", "f", 2019), "secondary");
  assert.equal(homeVenueKind("東京ドーム", "f", 2022), "secondary");
  assert.equal(homeVenueKind("東京ドーム", "f", 2023), "neutral");
});

test("⚠옛 팀 슬러그로도 답이 같다 — 2018 오릭스는 `bs` 다", () => {
  assert.equal(homeVenueKind("京セラD大阪", "bs", 2018), homeVenueKind("京セラD大阪", "b", 2018));
  assert.equal(primaryVenue("bs", 2018).id, primaryVenue("b", 2018).id);
});

test("본거지를 모르면 던진다 — 조용히 지방개최가 되지 않는다", () => {
  // 보유 범위 밖의 시즌. **null 을 돌려주면 그 팀 홈경기가 통째로 파크팩터에서 사라진다**
  assert.throws(() => primaryVenue("f", 1990), /본거지가 0개/);
  assert.throws(() => primaryVenue("no-such-team", 2025), /본거지가 0개/);
});
