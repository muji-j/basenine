/**
 * 球団一覧.
 *
 * ⚠**여기서 지키는 것은 「길」과 「분모」와 「순서」다.**
 * - 길: JS 가 없어도 여기서 구단으로 갈 수 있어야 한다(§0-1). 최애 지정만 스크립트의 일이다.
 * - 분모: 승률에 `勝+敗` 를 붙인다(M2). 분모 없는 비율은 렌더링 금지다.
 * - 순서: **순위가 정보다.** 균질한 카드 격자는 그 순서를 지운다(§6 「AI틱함」 금지 목록).
 * ⚠**로고·엠블럼을 쓰지 않는다**(§6) — 구단 색 마크만 쓴다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS, colorOf, shortNameOf, teamOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { renderTeamsPage } from "../src/teams-page.ts";
import type { TeamsCard, TeamsPageData } from "../src/teams-page.ts";
import { teamPath } from "../src/team-page.ts";
import { context } from "./fixtures.ts";

/**
 * 한 구단의 칸.
 *
 * ⚠**기본값은 「시즌 도중 · 다음 경기가 잡혀 있음」**이다. 시즌 종료·일정 미취득은
 * 각 시험이 덮어써서 만든다 — 그 셋이 같은 화면이면 그것 자체가 결함이다(M12).
 */
function card(code: string, rank: number, over: Partial<TeamsCard> = {}): TeamsCard {
  return {
    teamCode: code,
    name: teamOf(code).name,
    shortName: shortNameOf(code),
    color: colorOf(code),
    rank,
    tiedRank: false,
    games: 105,
    // 58승 46패 1분 → 승률의 분모는 **104**(무승부는 빠진다 · NPB 규정)
    w: 58,
    l: 46,
    t: 1,
    pct: 58 / 104,
    gamesBehind: rank === 1 ? 0 : rank - 1,
    last10: { w: 6, l: 4, t: 0 },
    next: {
      date: "2026-08-18",
      opponentCode: "c",
      opponentName: "広島",
      home: true,
      venue: "甲子園",
      startTime: "18:00",
    },
    seasonOver: false,
    ...over,
  };
}

/** 그 리그의 구단 코드 — **정본 순서**(도메인 마스터). 순위 순서를 재는 기준이 된다 */
function codesOf(league: League): string[] {
  return TEAMS.filter((t) => t.league === league).map((t) => t.code);
}

function teamsData(over: Partial<TeamsPageData> = {}): TeamsPageData {
  const cards = (league: League): TeamsCard[] => codesOf(league).map((c, i) => card(c, i + 1));
  return {
    season: 2026,
    asOf: "2026-08-15",
    leagues: [
      { id: "central", name: "セントラル・リーグ", teams: cards("central") },
      { id: "pacific", name: "パシフィック・リーグ", teams: cards("pacific") },
    ],
    ...over,
  };
}

/** 최애 지정 버튼의 여는 태그만 — 속성 순서에 기대지 않는다 */
function favButtons(out: string): string[] {
  return [...out.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((s) => s.includes("data-favteam="));
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/**
 * 목록 부분만 잘라 낸다.
 *
 * ⚠**페이지 전체에서 세면 시험이 헐거워진다.** 실제로 그랬다(2026-08-19 뮤테이션 검사):
 * 「（同）」를 세는 시험이 **각주의 설명문**(「同順位として「（同）」を付けます」)에 걸려
 * 행에서 표시를 통째로 지워도 통과했다. 각주와 제목은 여기 들어오지 않는다.
 */
function listOf(out: string): string {
  const parts = [...out.matchAll(/<ol class="tlist">[\s\S]*?<\/ol>/g)].map((m) => m[0]);
  return parts.join("\n");
}

/** 각주 한 줄만. 판정 기준(M3)이 **화면에** 적혔는지는 여기서 잰다 */
function noteOf(out: string): string {
  return (/<p class="note">[\s\S]*?<\/p>/.exec(out) ?? [""])[0];
}

test("12구단이 리그별로 나온다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.equal((out.match(/class="tcard"/g) ?? []).length, 12);
  assert.match(out, /セントラル/);
  assert.match(out, /パシフィック/);
});

/** ⚠**로고를 쓰지 않는다**(§6). 색만 쓴다 */
test("⚠구단 로고·엠블럼을 쓰지 않는다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.ok(!/<img/.test(out), "이미지를 썼다 — 로고는 상표다(§6)");
});

/**
 * ⚠**JS 가 없어도 여기서 구단으로 갈 수 있어야 한다**(§0-1).
 *
 * ⚠**경로를 손으로 적지 않는다.** 브리프는 `href="teams/t.html"` 을 문자열로 박았는데,
 * `teamPath` 가 **「한 곳에서만 만든다(M1) — 갈리면 어딘가는 404다」**라고 선언된 함수다.
 * 시험이 그걸 안 쓰면 경로가 바뀔 때 **화면만 따라오고 시험은 옛 주소를 지킨다.**
 */
test("⚠각 구단 카드가 그 구단 페이지로 간다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.ok(out.includes(`href="${teamPath("t")}"`));
  const missing = TEAMS.filter((t) => !out.includes(`href="${teamPath(t.code)}"`)).map((t) => t.code);
  assert.deepEqual(missing, [], `구단 페이지로 가는 길이 없는 카드: ${missing.join(" ")}`);
});

test("최애 지정 버튼이 12개 있고 초기값은 눌리지 않은 상태다", () => {
  const out = renderTeamsPage(teamsData(), context());
  const btns = out.match(/data-favteam="[a-z]+"/g) ?? [];
  assert.equal(btns.length, 12);
  assert.equal((out.match(/aria-pressed="false"/g) ?? []).length >= 12, true);
});

/**
 * ⚠**T9 의 클라이언트가 이 속성을 읽는다 — 없으면 조용히 열화한다.**
 *
 * 클라이언트는 구단 마스터를 모른다. 최애를 지정하면 내비 첫 항목의 라벨을
 * `b.dataset.favname` 으로 바꾸는데, 없으면 `code.toUpperCase()` 로 떨어져
 * 내비에 「阪神」 대신 **「T」**가 나온다. 화면은 멀쩡히 그려지므로 눈으로는 안 잡힌다.
 * ⚠**이름은 `shortName` 이다** — 내비는 좁다(순위표가 쓰는 짧은 이름과 같은 것).
 */
test("⚠최애 버튼이 구단 이름을 들고 있다 — 12개 전부(T9 가 이걸 읽는다)", () => {
  const out = renderTeamsPage(teamsData(), context());
  const btns = favButtons(out);
  assert.equal(btns.length, 12, "최애 버튼이 12개가 아니다");
  const bad: string[] = [];
  for (const b of btns) {
    const code = attr(b, "data-favteam") ?? "";
    const name = attr(b, "data-favname");
    if (name === null || name === "") bad.push(`${code}=없음`);
    else if (name !== shortNameOf(code)) bad.push(`${code}=${name}`);
  }
  assert.deepEqual(bad, [], `내비 라벨이 코드로 떨어질 구단: ${bad.join(" ")}`);
});

/**
 * ⚠**같은 이름의 버튼 12개는 낭독기에서 구별되지 않는다.**
 * 「ひいき球団」만 열두 번 들리면 어느 구단의 버튼인지 알 수 없다 —
 * 보이는 글자는 그대로 두고 **숨은 글자로 구단을 덧붙인다**(WCAG 2.5.3 label-in-name).
 */
test("⚠최애 버튼의 이름에 구단이 들어간다 — 12개가 서로 구별된다", () => {
  const out = renderTeamsPage(teamsData(), context());
  const names = [...out.matchAll(/<button\b[^>]*data-favteam[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    m[1]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
  );
  assert.equal(names.length, 12);
  assert.equal(new Set(names).size, 12, `버튼 이름이 겹친다: ${[...new Set(names)].join(" / ")}`);
  for (const t of TEAMS) {
    assert.ok(
      names.includes(`ひいき球団 ${shortNameOf(t.code)}`),
      `${t.code} 버튼의 이름이 다르다: ${names.join(" / ")}`,
    );
  }
});

/**
 * ⚠**분모 없는 비율은 렌더링 금지다**(M2).
 * 58승 46패 1분이므로 분모는 **104**(무승부는 빠진다) — 105(경기 수)가 아니다.
 */
test("⚠승률에 분모가 붙는다(M2) — 12개 전부", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.equal(
    (out.match(/<span class="den">104試合<\/span>/g) ?? []).length,
    12,
    "승률 옆에 분모(勝+敗)가 없는 카드가 있다",
  );
});

/**
 * ⚠**순위가 정보인데 격자는 그걸 지운다**(§6 「균질한 카드 그리드」 금지).
 * 리그별로 순위 순서 그대로 세우고, **그 순서를 마크업이 말한다**(`<ol>` · `data-rank`).
 */
test("⚠카드가 리그별 순위 순서로 선다 — 격자로 흩지 않는다(§6)", () => {
  const out = renderTeamsPage(teamsData(), context());
  const order = [...out.matchAll(/data-favteam="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [...codesOf("central"), ...codesOf("pacific")]);
  const ranks = [...out.matchAll(/<li class="tcard"[^>]*data-rank="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
  // 순서가 뜻인 목록은 `ol` 이다 — 낭독기에도 순서가 남는다
  assert.equal((out.match(/<ol class="tlist"/g) ?? []).length, 2);
});

/**
 * ⚠**다음 경기가 없어도 줄을 지우지 않는다**(M12).
 * ⚠**「끝났다」와 「아직 안 받았다」는 다른 말이다** — 구단 페이지가 이미 밟은 결함이다.
 */
test("⚠다음 경기 줄은 12개 전부 남는다 — 끝난 시즌과 미취득을 가른다(M12)", () => {
  const d = teamsData();
  const central = d.leagues[0]!.teams;
  const pacific = d.leagues[1]!.teams;
  const out = renderTeamsPage(
    {
      ...d,
      leagues: [
        { ...d.leagues[0]!, teams: [{ ...central[0]!, next: null, seasonOver: true }, ...central.slice(1)] },
        { ...d.leagues[1]!, teams: [{ ...pacific[0]!, next: null, seasonOver: false }, ...pacific.slice(1)] },
      ],
    },
    context(),
  );
  assert.equal((out.match(/次の試合/g) ?? []).length, 12, "다음 경기 줄이 사라진 카드가 있다");
  assert.match(out, /このシーズンは終了しています/);
  assert.match(out, /予定はありません/);
});

/**
 * ⚠**같은 사실을 두 화면이 다른 말로 하지 않는다**(M1).
 * 다음 경기 문장은 구단 페이지의 「次の試合」과 **같은 함수**에서 나온다.
 */
test("⚠다음 경기 문장이 구단 페이지와 같은 한 벌이다(M1)", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.equal(
    (out.match(/2026年8月18日 18:00 対広島（甲子園）/g) ?? []).length,
    12,
    "다음 경기 표기가 구단 페이지와 갈렸다",
  );
});

/** ⚠**규칙이 코드에만 있으면 아무도 검증할 수 없다**(M3) */
test("⚠판정 기준을 화면에 적는다(M3) — 승률의 분모와 배열 규칙", () => {
  const n = noteOf(renderTeamsPage(teamsData(), context()));
  assert.notEqual(n, "", "각주가 없다");
  assert.match(n, /引き分けは分母に入れません/);
  assert.match(n, /順位順/);
});

/**
 * ⚠**최근10 은 여기서 다시 세지 않는다**(M1) — `teamStandings` 가 만든 값을 그대로 낸다.
 * 화면에 안 나오면 「직근이 어떤가」를 물으러 온 사람이 구단 페이지까지 한 번 더 눌러야 한다.
 */
test("최근 10경기가 카드마다 나온다", () => {
  const out = renderTeamsPage(teamsData(), context());
  assert.equal((out.match(/6-4-0/g) ?? []).length, 12);
});

/**
 * ⚠**「지금 어디에 있는가」가 어느 화면에서나 보여야 한다.**
 *
 * `topbar-consistency.test.ts` 가 **dist 로** 재는 규칙인데, 그건 빌드한 뒤에만 돈다 —
 * 여기서 먼저 잡는다. ⚠**T8 이 내비에 `球団` 을 넣으면 이 화면의 `nav` 를
 * `"team"`(navExact 기본값)으로 바꿔라** — 그때도 이 시험이 그대로 통과한다.
 */
test("⚠헤더가 「지금 여기」를 말한다 — 표시 없는 화면을 만들지 않는다", () => {
  const out = renderTeamsPage(teamsData(), context());
  const head = /<header class="topbar"[\s\S]*?<\/header>/.exec(out);
  assert.notEqual(head, null, "헤더가 없다");
  assert.match(head![0], /aria-current="/, "현재 위치 표시가 없다");
});

/**
 * ⚠**동률을 화면이 말한다**(M3). 순위표와 구단 페이지가 이미 「（同）」로 말하고 있다 —
 * 여기만 숨기면 같은 사실이 화면마다 다르게 보인다.
 *
 * ⚠**세는 자리는 목록 안이다.** 페이지 전체에서 「同」을 세면 각주의 설명문에 걸려
 * **행에서 표시를 지워도 통과했다**(2026-08-19 뮤테이션 검사에서 실제로 났다).
 */
test("동률이면 그렇다고 말한다 — 동률인 두 줄에만", () => {
  const d = teamsData();
  const central = d.leagues[0]!.teams;
  const out = renderTeamsPage(
    {
      ...d,
      leagues: [
        {
          ...d.leagues[0]!,
          teams: [
            { ...central[0]!, tiedRank: true },
            { ...central[1]!, rank: 1, tiedRank: true },
            ...central.slice(2),
          ],
        },
        d.leagues[1]!,
      ],
    },
    context(),
  );
  assert.equal((listOf(out).match(/（同）/g) ?? []).length, 2, "동률 표시가 두 줄에 붙지 않았다");
});

/**
 * ⚠**순위가 없는 시즌이 있다**(경기 0). `0位` 라고 쓰거나 칸을 비우면 둘 다 거짓말이다 —
 * 「모른다」를 「모른다」로 낸다(M11).
 */
test("⚠순위를 아직 못 매기면 「모름」을 낸다 — 0位라고 쓰지 않는다", () => {
  const d = teamsData();
  const central = d.leagues[0]!.teams;
  const out = renderTeamsPage(
    {
      ...d,
      leagues: [
        {
          ...d.leagues[0]!,
          teams: [{ ...central[0]!, rank: null, pct: null, games: 0, w: 0, l: 0, t: 0 }, ...central.slice(1)],
        },
        d.leagues[1]!,
      ],
    },
    context(),
  );
  const list = listOf(out);
  assert.ok(!/>0<\/b><s>位/.test(list), "0位라고 썼다");
  // ⚠**페이지 전체에서 찾지 않는다** — 제목이 `球団 — 2026年` 이라 「—」가 이미 있다.
  //   그대로 두면 **어떤 코드에서도 통과하는 단언**이 된다(2026-08-19 뮤테이션 검사에서 잡혔다).
  assert.ok(list.includes("<b>—</b>"), "모르는 순위를 빈칸으로 흘렸다");
});

/** 리그가 아직 없으면(경기 0인 시즌) 화면이 그렇게 말한다 — 빈 화면은 고장으로 읽힌다(M12) */
test("리그가 하나도 없으면 그렇다고 말한다", () => {
  const out = renderTeamsPage(teamsData({ leagues: [] }), context());
  assert.match(out, /まだ/);
  assert.equal((out.match(/class="tcard"/g) ?? []).length, 0);
});
