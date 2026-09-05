/**
 * ドラフト会議 화면.
 *
 * ⚠**이 화면이 지키는 것은 「없는 것을 없다고 말하는 방식」이다.**
 * 같은 「비어 있음」이 여섯 가지 다른 사실이고(`DataState`), 그중 둘은
 * **우리가 아무리 해도 안 열리는 것**과 **우리 몫의 남은 일**이라 문장이 달라야 한다.
 *
 * ⚠**단독지명과 낙첨을 섞으면 그 자체가 거짓말이다** — 「아무도 안 겹쳤다」와 「졌다」는 다르다.
 * 그래서 이 시험의 절반은 값이 아니라 **구별**을 잰다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_PATH, renderDraftPage } from "../src/draft-page.ts";
import { pathsFor } from "../src/layout.ts";
import type {
  DraftBidBlock,
  DraftBidEntry,
  DraftBidGroup,
  DraftName,
  DraftPageData,
  DraftPick,
  DraftRound,
  DraftSection,
  DraftSectionSource,
  DraftTeam,
} from "../src/draft-page.ts";
import { context } from "./fixtures.ts";

/* ---- 픽스처 --------------------------------------------------------------- */

function nm(display: string, link: DraftName["link"] = null): DraftName {
  return { display, canonical: display.replace(/\s/g, ""), link };
}

function tm(code: string, shortName: string | null): DraftTeam {
  return { code, shortName };
}

function entry(
  code: string,
  short: string | null,
  player: string,
  won: 1 | 0 | null,
  over: Partial<DraftBidEntry> = {},
): DraftBidEntry {
  return { team: tm(code, short), name: nm(player), rivals: null, won, origin: "npb", ...over };
}

function grp(key: string, player: string, winner: DraftBidEntry | null, losers: DraftBidEntry[]): DraftBidGroup {
  // ⚠**`teams` 를 손으로 적지 않는다** — 픽스처가 불변식을 어기면 시험이 거짓을 고정한다
  return { groupKey: key, name: nm(player), winner, losers, teams: (winner === null ? 0 : 1) + losers.length };
}

/** 2024년 실물을 줄인 모양 — 1회차에 경합 2건 + 단독 1건, 2회차에 **낙첨 구단이 다시 나온다** */
function bids(over: Partial<DraftBidBlock> = {}): DraftBidBlock {
  return {
    state: { kind: "ok" },
    rounds: [
      {
        roundNo: 1,
        groups: [
          grp("1:宗山塁", "宗山塁", entry("e", "楽天", "宗山塁", 1), [
            entry("l", "西武", "宗山塁", 0),
            entry("d", "中日", "宗山塁", 0),
          ]),
          // ⚠**표기가 그룹 이름과 다른 행**(실측 2019 佐々木朗希). 소스가 그렇게 적었다
          grp("1:佐々木麟太郎", "佐々木 麟太郎", entry("h", "ソフトバンク", "佐々木 麟太郎", 1), [
            entry("f", "日本ハム", "佐々木麟太郎", 0),
          ]),
        ],
        solo: [entry("t", "阪神", "中村優斗", null)],
      },
      {
        roundNo: 2,
        groups: [
          grp("2:金丸夢斗", "金丸夢斗", entry("d", "中日", "金丸夢斗", 1), [entry("l", "西武", "金丸夢斗", 0)]),
        ],
        solo: [],
      },
    ],
    counts: { bids: 8, groups: 3, solo: 1 },
    ...over,
  };
}

function pick(code: string, short: string | null, player: string, over: Partial<DraftPick> = {}): DraftPick {
  return {
    team: tm(code, short),
    name: nm(player),
    position: "内野手",
    fromOrg: "明治大",
    waiverDir: null,
    pickSeq: null,
    origin: "npb",
    ...over,
  };
}

function round(roundNo: number, picks: DraftPick[], numbered = true): DraftRound {
  return { roundNo, numbered, picks };
}

/**
 * **수치가 실린 페이지 하나.** ⚠구단 페이지이고 **판이 구단마다 다르다** —
 * 실측: `draft_pick` 은 **252 URL · 252 revision**, `draft_event` 는 **21 · 21**.
 */
function srcOf(code: string, short: string | null, revision: string, rows = 1): DraftSectionSource {
  return {
    url: `https://npb.jp/draft/2024/draftlist_${code}.html`,
    fetchedAt: "2026-09-05T04:16:49.435Z",
    revision,
    origin: "npb",
    teams: [tm(code, short)],
    rows,
  };
}

function section(over: Partial<DraftSection> = {}): DraftSection {
  return {
    kind: "shihaika",
    label: "支配下",
    bids: bids(),
    rounds: [round(1, [pick("e", "楽天", "宗山塁"), pick("h", "ソフトバンク", "佐々木 麟太郎")])],
    pickCount: 2,
    /**
     * ⚠**수치가 실린 페이지는 구단마다 다르다**(실물: `draftlist_{team}.html` · 2019 支配下 은 **12장**).
     * 초판 픽스처는 여기에 **연도 톱 한 장**을 넣고 있었고, 그래서 화면이 「版」을 하나만 찍는 것을
     * 시험이 **정상으로 고정**하고 있었다([I-1]).
     */
    sources: [srcOf("g", "巨人", "9f2a1c4d5e6b7a8c"), srcOf("t", "阪神", "aa11bb22cc33dd44")],
    event: {
      url: "https://npb.jp/draft/2024/",
      /**
       * ⚠**실물과 같은 모양이어야 한다** — 실제 `fetched_at` 은 날짜가 아니라 **UTC 타임스탬프**다.
       * 처음에 `2026-09-05` 로 적었더니 시험이 초록인 채로 화면에는
       * **밀리초까지 붙은 원문**이 나갔다(2026-09-05 실물 확인).
       */
      fetchedAt: "2026-09-05T04:16:49.435Z",
      revision: "ffffffffffffffff",
      license: null,
      heldOn: null,
    },
    ...over,
  };
}

function data(over: Partial<DraftPageData> = {}): DraftPageData {
  return {
    season: 2024,
    heldSeasons: [2024, 2023, 2022],
    state: { kind: "ok" },
    sections: [section()],
    notes: { state: { kind: "uncollected", detail: "入団拒否・交渉権訂正はまだ取り込んでいません" }, rows: [] },
    origins: ["npb"],
    links: { linked: 0, total: 5 },
    unknownTeamCodes: [],
    defects: { groupsWithoutWinner: [], groupsWithManyWinners: [] },
    ...over,
  };
}

const render = (d: DraftPageData = data()): string => renderDraftPage(d, context());

/* ---- ① 1순위 입찰 --------------------------------------------------------- */

test("경합 그룹이 「当選 / 落選」과 분모(N球団競合)로 렌더된다", () => {
  const html = render();
  assert.match(html, /宗山塁/);
  assert.match(html, /当選/);
  assert.match(html, /落選/);
  // ⚠**분모를 화면이 스스로 세지 않는다**(M2) — `teams` 가 그 수다
  assert.match(html, /3球団競合/);
  assert.match(html, /2球団競合/);
});

test("⚠단독지명이 경합과 섞이지 않는다 — 「아무도 안 겹쳤다」가 「졌다」로 읽히면 거짓이다", () => {
  const html = render();
  const fold = /<details[^>]*class="[^"]*dsolo[^"]*"[\s\S]*?<\/details>/.exec(html);
  assert.notEqual(fold, null, "단독지명을 접어 두는 자리가 없다");
  const solo = fold![0];
  assert.match(solo, /単独指名/);
  assert.match(solo, /中村優斗/);
  // ⚠**단독 구획 안에 「落選」이라는 글자가 있으면 안 된다**
  assert.doesNotMatch(solo, /落選/);
  assert.doesNotMatch(solo, /当選/);
  /**
   * ⚠**「접힌 곳에 있다」만으로는 부족하다** — 뮤테이션 검사에서 실제로 걸렸다:
   * 단독 행을 **경합 목록에도 함께** 그리면 위 검사가 전부 통과한다.
   * **한 번만 나오는 것**까지 재야 「섞이지 않았다」가 참이 된다.
   */
  assert.equal(
    html.split("中村優斗").length - 1,
    1,
    "단독지명이 화면에 두 번 나온다 — 경합 목록에도 섞였다",
  );
});

test("⚠회차가 내려갈수록 낙첨 구단이 다시 나온다 — 그 구조 자체가 이 화면의 서사다", () => {
  const html = render();
  const first = html.indexOf("1位指名");
  const second = html.indexOf("外れ1位");
  assert.notEqual(first, -1, "1회차 머리가 없다");
  assert.notEqual(second, -1, "2회차 머리가 없다");
  assert.ok(first < second, "회차가 순서대로 나오지 않는다");
  // 西武는 1회차에서 지고 2회차에 다시 나온다 — 두 번 나와야 한다
  const seibu = html.split("西武").length - 1;
  assert.ok(seibu >= 2, `西武가 ${seibu}번밖에 안 나온다 — 재입찰이 화면에서 사라졌다`);
});

test("⚠구단마다 표기가 정말 다르면 그 표기를 지우지 않는다 — 소스가 그렇게 적었다", () => {
  const html = render(
    data({
      sections: [
        section({
          bids: bids({
            rounds: [
              {
                roundNo: 1,
                groups: [
                  grp(
                    "1:高橋宏斗",
                    "髙橋宏斗",
                    { ...entry("d", "中日", "髙橋宏斗", 1), name: nm("髙橋宏斗") },
                    // ⚠**梯子高와 高가 다른 글자다** — 정규화가 달라지므로 「같은 이름」이 아니다
                    [{ ...entry("t", "阪神", "高橋宏斗", 0), name: nm("高橋宏斗") }],
                  ),
                ],
                solo: [],
              },
            ],
            counts: { bids: 2, groups: 1, solo: 0 },
          }),
        }),
      ],
    }),
  );
  assert.match(html, /髙橋宏斗/);
  assert.match(html, /高橋宏斗/);
});

/**
 * ⚠**실물에서 걸렸다**(2026-09-05 · 2019 렌더): npb 는 **당첨 행에만 공백을 넣어서**
 * 낙첨 행 거의 전부에 같은 이름이 한 번 더 찍혔다. 같은 이름을 두 번 적는 것은 정보가 아니다.
 * ⚠**판정은 우리 정규화(`canonical`) 한 벌이 한다**(M1) — 화면이 공백 규칙을 새로 만들지 않는다.
 */
test("⚠공백만 다른 표기를 두 번 적지 않는다 — 그건 정보가 아니라 소음이다", () => {
  const html = render();
  assert.match(html, /佐々木 麟太郎/, "그룹의 표기가 사라졌다");
  assert.equal(
    html.split("佐々木麟太郎").length - 1,
    0,
    "공백만 다른 표기가 화면에 한 번 더 찍혔다",
  );
});

/* ---- 빈 상태 6종을 뭉뚱그리지 않는다 --------------------------------------- */

/**
 * ⚠**접두사를 「公表されていません」에서 「出典に載っていません」으로 좁혔다**(2026-09-06 [I-2]).
 * 앞의 것은 **출처에 대한 단정**이라 나중에 공표되면 그날 거짓이 되고, 원인이 **우리 쪽**
 * (스냅샷을 출처가 쓰기 전에 떴다)일 때도 남을 가리킨다.
 * ⚠**시험의 목적은 그대로다** — 「データがありません」로 뭉뚱그리지 않는 것.
 */
test("⚠2023 은 「出典に載っていません」이다 — 「データがありません」가 아니다", () => {
  const html = render(
    data({
      season: 2023,
      sections: [
        section({
          bids: {
            state: {
              kind: "unpublished",
              detail: "もともと書かれていないのか、開催直後に取得したのかは区別できません",
            },
            rounds: [],
            counts: { bids: 0, groups: 0, solo: 0 },
          },
        }),
      ],
    }),
  );
  assert.match(html, /出典に載っていません/);
  // ⚠**NPB 탓으로 단정하지 않는다** — 원인이 우리일 수 있다
  assert.doesNotMatch(html, /公表されていません/);
  assert.doesNotMatch(html, /データがありません/);
  assert.doesNotMatch(html, /記録がありません/);
});

test("⚠`bids === null` 은 「제도상 추첨이 없다」이지 미공표가 아니다(育成)", () => {
  const html = render(
    data({
      sections: [
        section({ kind: "ikusei", label: "育成", bids: null, rounds: [round(1, [pick("t", "阪神", "石黒佑弥")])] }),
      ],
    }),
  );
  // ⚠**구획 안만 본다** — 후일담 블록은 별개의 사실(`uncollected`)이라 같은 화면에 함께 산다
  const block = /<section[^>]*id="b-draft-ikusei"[\s\S]*?<\/section>/.exec(html);
  assert.notEqual(block, null, "育成 구획이 없다");
  assert.match(block![0], /育成/);
  assert.match(block![0], /抽選/);
  assert.doesNotMatch(block![0], /公表されていません/);
  assert.doesNotMatch(block![0], /まだ収集していません/);
});

test("후일담은 「まだ収集していません」이다 — 「그런 일이 없었다」가 아니다", () => {
  const html = render();
  assert.match(html, /まだ収集していません/);
});

/**
 * ⚠**한 가지 사실을 세 번 말하고 있었다**(2026-09-05 감사 P2).
 * `stateNote` 의 접두사와 `detail` 이 한 줄 안에서 겹치고, 그 아래 각주가 세 번째로
 * 같은 말을 했다 — 실측 블록 높이 **184px** · 본문 **134자**에 정보량은 1비트였다.
 */
test("⚠その後가 같은 말을 두 번 하지 않는다 — 접두사가 이미 「まだ収集していません」이다", () => {
  const html = render();
  const block = /<section[^>]*id="b-draft-notes"[\s\S]*?<\/section>/.exec(html);
  assert.notEqual(block, null, "その後 구획이 없다");
  assert.equal(
    block![0].split("まだ収集していません").length - 1,
    1,
    "같은 문장이 블록 안에서 두 번 이상 나온다",
  );
  assert.doesNotMatch(block![0], /class="note"/, "행이 0건인데 각주까지 쌓았다");
});

/**
 * ⚠**행이 있는데 「아직 취급하지 않는다」고 적으면 화면이 자기가 그리는 목록을 부정한다.**
 * 예전에는 그 각주를 **행이 있든 없든 무조건** 그렸다 — `DRAFT_NOTES_COLLECTED` 가 켜지는 날
 * 조용히 거짓이 될 자리였다.
 */
test("⚠후일담 행이 있으면 「まだ取り込んでいません」이라고 말하지 않는다", () => {
  const html = render(
    data({
      notes: {
        state: { kind: "ok" },
        rows: [
          {
            kind: "shihaika",
            team: tm("g", "巨人"),
            name: nm("元木大介"),
            noteKind: "nyudan_kyohi",
            detail: "入団拒否",
          },
        ],
      },
    }),
  );
  const block = /<section[^>]*id="b-draft-notes"[\s\S]*?<\/section>/.exec(html)![0];
  assert.match(block, /元木大介/);
  assert.doesNotMatch(block, /取り込んでいません/, "행을 그려 놓고 아직 안 받았다고 말한다");
  assert.doesNotMatch(block, /まだ収集していません/);
});

/**
 * ⚠**한 화면에 같은 이름의 표가 둘이었다**(2026-09-05 감사 P2 · 실측 `2 aria-label="指名の全記録"`).
 * 표 목록에서 둘을 고를 수 없으니 이름이 이름 노릇을 못 한다.
 * ⚠**ARIA 를 더하는 게 아니라 이미 쓰는 이름을 유일하게 만드는 것이다** — 속성 수는 그대로다.
 */
test("⚠구획마다 표 이름이 유일하다 — 같은 이름이 둘이면 이름이 아니다", () => {
  const html = render(
    data({
      sections: [
        section({ kind: "shihaika", label: "支配下" }),
        section({ kind: "ikusei", label: "育成", bids: null }),
      ],
    }),
  );
  const names = [...html.matchAll(/aria-label="([^"]*指名の全記録[^"]*)"/g)].map((m) => m[1]!);
  assert.equal(names.length, 2, `표가 2개가 아니다: ${names.length}개`);
  assert.equal(new Set(names).size, names.length, `이름이 겹친다: ${names.join(" / ")}`);
  // ⚠보이는 글자가 이름 안에 남아 있어야 한다(WCAG 2.5.3 label-in-name)
  for (const n of names) assert.match(n, /指名の全記録$/);
});

/**
 * ⚠**머리에서 한 약속을 화면 끝에서 물리고 있었다**(2026-09-05 감사 P2).
 * 「21年分を収録」과 그 정정(`heldNote`)이 **5,418px** 떨어져 있어서, 그 사이를 안 읽은
 * 사람에게는 안 물린 것과 같았다. → 같은 어휘를 머리에도 쓴다.
 */
test("⚠머리줄이 「볼 수 있는 범위」부터 말한다 — 収録만 적으면 없는 해를 안내한다", () => {
  const ctx = context({
    paths: pathsFor(
      [
        { season: 2024, prefix: "", paths: new Set([DRAFT_PATH]) },
        { season: 2023, prefix: "2023/", paths: new Set([DRAFT_PATH]) },
      ],
      2024,
    ),
  });
  const html = renderDraftPage(data({ season: 2024, heldSeasons: [2022, 2023, 2024] }), ctx);
  const asof = /<span class="asof">([^<]*)<\/span>/.exec(html)?.[1] ?? "";
  assert.match(asof, /2023〜2024年を表示/, `머리줄이 볼 수 있는 범위를 안 말한다: ${asof}`);
  assert.match(asof, /収録は2022〜2024年/, `머리줄이 보유 범위를 안 말한다: ${asof}`);
});

test("차이가 없으면 머리줄이 「収録」만 말한다 — 없는 구별을 만들지 않는다", () => {
  // 시즌 띠가 없는 문맥(시즌 하나)에서는 잴 재료가 없다 — 그때는 아무 말도 더하지 않는다
  const asof = /<span class="asof">([^<]*)<\/span>/.exec(render())?.[1] ?? "";
  assert.match(asof, /を収録$/, `쓸 수 없는 구별을 적었다: ${asof}`);
  assert.doesNotMatch(asof, /を表示/);
});

/* ---- 소스의 한계를 화면이 말한다 ------------------------------------------- */

test("⚠웨이버 방향을 그리지 않는다 — 데이터가 전건 NULL 이고, 화면이 그 한계를 말한다", () => {
  const html = render();
  assert.doesNotMatch(html, /→/, "빈 화살표를 그렸다 — 이 소스에 지명 방향이 없다");
  assert.doesNotMatch(html, /←/);
  assert.match(html, /指名順/, "지명 순서가 없다는 사실을 화면이 말하지 않는다");
});

test("⚠회차가 없는 제도에 「N巡目」이라고 쓰지 않는다", () => {
  const html = render(
    data({
      sections: [
        section({
          kind: "kibou_nyudanwaku",
          label: "希望入団枠",
          bids: null,
          rounds: [round(1, [pick("g", "巨人", "内海哲也")], false)],
        }),
      ],
    }),
  );
  assert.doesNotMatch(html, /巡目/);
});

test("⚠`shortName: null` 인 구단을 `db`(DeNA)로 접지 않는다", () => {
  const html = render(
    data({
      sections: [
        section({
          bids: null,
          rounds: [round(1, [pick("yb", null, "筒香嘉智")])],
        }),
      ],
      unknownTeamCodes: ["yb"],
    }),
  );
  /**
   * ⚠**「화면 어딘가에 yb 가 있다」로는 못 잰다** — 뮤테이션 검사에서 걸렸다:
   * 구단 칸을 **빈 칸으로** 만들어도 아래쪽 각주에 `yb` 가 있어서 통과한다.
   * **그 칸 자체**를 봐야 한다.
   */
  const cell = /<td class="l tm"[^>]*>[\s\S]*?<\/td>/.exec(html);
  assert.notEqual(cell, null, "지명 표에 구단 칸이 없다");
  assert.match(cell![0], /yb/, "구단 칸이 코드조차 못 낸다 — 누구의 지명인지 알 수 없다");
  assert.doesNotMatch(html, /DeNA/, "모르는 구단을 지금 이름으로 접었다 — 그건 더 그럴듯한 거짓말이다");
  assert.match(html, /球団辞書/, "모르는 코드가 있다는 사실을 화면이 말하지 않는다");
});

test("⚠`defects` 를 조용히 버리지 않는다 — 당첨 없는 그룹이 화면에 남는다", () => {
  const html = render(
    data({
      sections: [
        section({
          bids: bids({
            rounds: [{ roundNo: 1, groups: [grp("1:X", "X選手", null, [entry("t", "阪神", "X選手", 0)])], solo: [] }],
            counts: { bids: 1, groups: 1, solo: 0 },
          }),
        }),
      ],
      defects: { groupsWithoutWinner: ["1:X"], groupsWithManyWinners: [] },
    }),
  );
  assert.match(html, /1:X/, "결함 그룹의 키가 화면에 없다");
  assert.match(html, /X選手/, "결함 그룹을 화면에서 건너뛰었다 — 「그 경합은 없었다」가 된다");
});

/* ---- 이름·링크·출처 -------------------------------------------------------- */

test("⚠링크 없는 선수도 이름이 남는다 — 그 지명은 실제로 있었다", () => {
  const html = render();
  assert.match(html, /宗山塁/);
  assert.doesNotMatch(html, /players\//, "링크가 전건 NULL 인데 선수 링크를 만들었다");
});

test("선수 페이지로 이어진 이름의 수를 분모와 함께 낸다(M2)", () => {
  const html = render();
  assert.match(html, /0件 \/ 5件/);
});

test("⚠출처가 화면에 있다(L3) — URL·취득일·판", () => {
  const html = render();
  assert.match(html, /npb\.jp\/draft\/2024\//);
  assert.match(html, /2026年9月5日/);
  assert.match(html, /9f2a1c4d/);
  assert.doesNotMatch(html, /04:16:49/, "타임스탬프 원문이 그대로 나갔다");
});

/**
 * ⚠**앞 10글자를 자르면 UTC 날짜다.** JST 07시 이전이면 하루 어긋나고,
 * 그 어긋남은 **그럴듯해서 눈으로 못 잡는다**(§2-1 「JST 고정」).
 */
test("⚠취득일을 JST 로 말한다 — UTC 날짜를 그대로 쓰지 않는다", () => {
  const html = render(
    data({
      sections: [
        section({
          // UTC 2026-09-05 22:00 = JST 2026-09-06 07:00
          sources: [{ ...srcOf("g", "巨人", "9f2a1c4d5e6b7a8c"), fetchedAt: "2026-09-05T22:00:00.000Z" }],
        }),
      ],
    }),
  );
  assert.match(html, /2026年9月6日/);
  assert.doesNotMatch(html, /2026年9月5日/);
});

test("같은 페이지에서 온 구획을 두 줄로 적지 않는다 — 판이 같으면 한 줄이다(M4)", () => {
  // ⚠**실측이 그렇다**: 한 구단 페이지가 支配下 와 育成 을 함께 싣고 **판도 같다**(2019 12구단 전수)
  const src = srcOf("g", "巨人", "9f2a1c4d5e6b7a8c");
  const html = render(
    data({
      sections: [
        section({ sources: [src] }),
        section({ kind: "ikusei", label: "育成", bids: null, sources: [src] }),
      ],
    }),
  );
  // ⚠**URL 문자열로 세지 마라** — 한 줄에 `href` 와 링크 글자로 **두 번** 나온다(처음에 그렇게 세서 틀렸다)
  assert.equal(
    html.split('href="https://npb.jp/draft/2024/draftlist_g.html"').length - 1,
    1,
    "같은 페이지가 출처 목록에 두 번 나온다",
  );
  assert.match(html, /支配下 · 育成/, "어느 구획이 그 페이지에서 왔는지 사라졌다");
});

/**
 * ⚠⚠**화면의 「版」이 거짓이었다**(2026-09-06 최종 검토 [I-1]).
 *
 * 초판은 **연도 톱 한 장의 판**을 찍었는데 **수치는 구단 페이지에서 온다.**
 * 실측: `draft_pick` **252 URL · 252 revision** 대 `draft_event` **21 · 21**.
 * 한 구단 명단이 정정되면 **그 구단의 판만** 바뀌므로, 연도 톱의 판을 찍는 화면은
 * **어제와 같은 「版」을 보여 준다** — 사용자의 「어제 본 이름과 다른데?」에
 * 「같은 판이다」라고 답하는 모양이고, **M4 가 존재하는 이유를 정확히 뒤집는다.**
 */
test("⚠⚠「版」은 수치가 실린 페이지마다 나온다 — 연도 톱의 판을 찍지 않는다(M4)", () => {
  const html = render();
  // 구단마다 한 줄씩, 자기 판으로
  assert.match(html, /9f2a1c4d/u);
  assert.match(html, /aa11bb22/u);
  // ⚠**연도 톱의 판은 「版」으로 나오면 안 된다** — 그건 수치를 싣지 않은 페이지다
  assert.doesNotMatch(html, /版 ffffffff/u);
  // 그래도 **가리키기용 링크는 남는다**(L3)
  assert.match(html, /href="https:\/\/npb\.jp\/draft\/2024\/"/u);
  // 어느 구단의 명단인지 사람이 URL 을 해독하지 않아도 되게
  assert.match(html, /巨人/u);
  assert.match(html, /阪神/u);
});

test("wikipedia 가 섞이면 CC BY-SA 를 표기한다(L3)", () => {
  const html = render(data({ origins: ["npb", "wikipedia"] }));
  assert.match(html, /CC BY-SA/);
});

/**
 * ⚠**실물에서 걸렸다**(2026-09-05 · 2026 렌더). 아직 열리지도 않은 드래프트 화면에
 * 「지명순은 출전에 없습니다」·「선수 페이지 연결 0件 / 0件」·「후일담을 아직 수집하지 않았습니다」가
 * 나란히 섰다 — 마지막 것은 **개최 전이면 출처에도 없으므로 거짓에 가깝다.**
 */
test("⚠보여 줄 것이 없는 해에 「없는 것에 대한 각주」를 쌓지 않는다", () => {
  const html = render(
    data({
      season: 2026,
      sections: [],
      state: { kind: "offseason", detail: "2026年のドラフト会議はまだ開催されていません（例年10月）" },
    }),
  );
  assert.match(html, /まだ開催されていません/);
  assert.match(html, /2022/, "보유 연도를 말하지 않는다 — 이 화면에서 유일하게 쓸모 있는 사실이다");
  assert.doesNotMatch(html, /指名順/, "표가 없는데 표에 대한 각주를 냈다");
  assert.doesNotMatch(html, /0件 \/ 0件/, "행이 없는데 분모 0을 냈다");
  assert.doesNotMatch(html, /まだ収集していません/, "개최 전인데 「출처에는 있다」고 말했다");
});

test("보유 시즌을 데이터에서 말한다 — 화면이 목록을 박지 않는다", () => {
  const html = render(data({ heldSeasons: [2025, 2024, 2023] }));
  assert.match(html, /2023/);
  assert.match(html, /2025/);
});

/**
 * ⚠**「収録」과 「見られる」가 다른 수다**(2026-09-05 · Task 3 판단).
 *
 * DB 는 2005~2025 21년분을 갖고 있는데 사이트가 굽는 것은 2018~2026 이다.
 * 「21年分を収録」만 적으면 **볼 수 없는 해를 보여 줄 것처럼** 말하게 된다 —
 * 이 저장소가 「通算」에서 이미 겪은 모양이고, 그때의 답은 **화면이 자기 범위를 말하는 것**이었다.
 * ⚠**그 연도들을 링크로 만들지 않는 것이 이 문장의 짝이다** — 그 해에는 페이지가 아예 없다.
 */
test("⚠가진 연도와 볼 수 있는 연도를 구별해 말한다 — 없는 해로 안내하지 않는다", () => {
  // 사이트는 2024·2023 두 시즌만 굽는데 보유는 2022 까지다 — 2022 는 화면이 없다
  const ctx = context({
    paths: pathsFor(
      [
        { season: 2024, prefix: "", paths: new Set([DRAFT_PATH]) },
        { season: 2023, prefix: "2023/", paths: new Set([DRAFT_PATH]) },
      ],
      2024,
    ),
  });
  const html = renderDraftPage(data({ season: 2024, heldSeasons: [2022, 2023, 2024] }), ctx);
  assert.match(html, /2022/, "보유 연도를 말하지 않는다");
  assert.match(html, /この画面で見られるのは/, "볼 수 있는 범위를 말하지 않는다");
  assert.match(html, /残り 1年分/, "못 보는 연도의 수(분모)를 말하지 않는다");
});

/**
 * ⚠**시즌 띠가 없는 문맥에서 「見られるのは 0年分」이라고 쓰면 거짓이다.**
 * 시즌이 하나뿐이면 띠 자체를 안 그리므로(`layout.ts`) 이 계산의 재료가 없다 —
 * 그때는 **아무 말도 더하지 않는 것**이 맞다.
 */
test("⚠시즌이 하나뿐이면 「볼 수 있는 범위」를 말하지 않는다 — 잴 재료가 없다", () => {
  const html = render();
  assert.doesNotMatch(html, /この画面で見られる/, "재료가 없는데 범위를 단정했다");
});

/* ---- 위생 ----------------------------------------------------------------- */

test("⚠선수명·구단명이 태그가 되지 않는다 — 우리가 만든 문자열이 아니다", () => {
  const html = render(
    data({
      sections: [section({ bids: null, rounds: [round(1, [pick("t", "阪神", "<b>斬られ</b>")])] })],
    }),
  );
  assert.match(html, /&lt;b&gt;斬られ&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>斬られ/);
});

test("문서가 한 장으로 닫힌다 — 셸·꼬리말이 붙는다", () => {
  const html = render();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /2024年/);
  assert.match(html, /<\/html>/);
});
