/**
 * **구장 정본 표.**
 *
 * `teams.ts` 의 `TEAM_CODE_ALIASES` 가 선례다 — 소스의 표기가 불변이 아니라는 것을
 * 2018 오릭스 슬러그(`bs`)에서 배웠고, **148경기가 「모르는 코드」로 실패해서** 알았다(M7).
 * 구장은 같은 병을 **더 크게** 앓는다: 팀 코드는 9시즌에 한 번 바뀌었는데
 * 구장 이름은 **9시즌에 6번** 바뀌었다.
 *
 * ## 이 표가 없으면 무엇이 조용히 틀리는가
 *
 * ```
 * ヤフオクドーム(2018-19) → PayPayドーム(2020-24) → みずほPayPay(2024-26)   같은 건물, 이름 3개
 * メットライフ(2018-21)   → ベルーナドーム(2022-26)
 * ナゴヤドーム(2018-20)   → バンテリンドーム(2021-26)
 * 楽天生命パーク(2018-22) → 楽天モバイル(2023-26)
 * 新潟(2018-23)           → ハードオフ新潟(2024-26)
 * ```
 * 문자열로 묶으면 **소프트뱅크 홈구장이 셋으로 쪼개진다.** 파크팩터도 홈/원정 스플릿도
 * 「그 구장의 성질」이라고 말할 수 없는 수가 된다.
 *
 * ⚠**반대 방향의 사고가 더 나쁘다.** `札幌ドーム`(2018-22 · 297경기)와 `エスコンＦ`(2023-26 · 270경기)는
 * **다른 건물**이다. 「같은 팀의 홈구장」이라는 이유로 합치면 **2.3%p 가 뭉개진다**(docs/metrics/ §3.3 함정 4).
 * 이름이 갈리는 것과 건물이 갈리는 것은 **관측이 같아 보이고 뜻이 정반대**다 — 그래서 손으로 적는다.
 *
 * ## ⚠시즌 단위 매핑으로는 못 잡는다 — 그래서 키가 **문자열**이다
 *
 * **2024 소프트뱅크는 시즌 도중에 바뀌었다**: `みずほPayPay` **59경기** + `PayPayドーム` **6경기**.
 * 「2024는 みずほPayPay」로 적으면 6경기가 사라지고, 「2024는 PayPayドーム」로 적으면 59경기가 사라진다.
 * → **경기의 원문 문자열 하나로 건물이 정해진다.** 시즌은 판정에 쓰지 않고 **기록**으로만 남는다.
 *
 * ## ⚠정규화를 **적재가 아니라 조회에서** 한다 — 사유
 *
 * `TEAM_CODE_ALIASES` 는 **적재 시점**에 정규화한다. 구장은 **하지 않는다.** 셋 다 이유가 있다.
 *
 * 1. **팀 코드는 조인 키이고 구장 문자열은 아니다.** `game.home_code` 는 `TEAMS` 와 맞아야
 *    선수·성적이 붙지만, `game.venue` 에 붙는 것은 아무것도 없다. 적재를 실패시킬 무게가 아니다.
 * 2. **원문이 사실이다**(M4). 「2024-05-01 에 npb.jp 가 이 구장을 뭐라고 불렀는가」는 **데이터**이고,
 *    위 「시즌 도중 개명」은 **원문을 남겼기 때문에** 보인다. 정규화해서 넣었으면 그 사실이 사라진다.
 * 3. **건물 배정은 아직 열려 있는 판단이다** — 아래 `yamagata` / `yamagata-shi` 가 **미확인**이다.
 *    판단을 컬럼에 구우면 뒤집을 때 15,000경기를 다시 적재해야 한다.
 *
 * ⚠**그 대신 M7 의 자리가 옮겨 갈 뿐 사라지지 않는다.** `venueOf` 는 **모르는 문자열에 던지고**,
 * `packages/domain/test/venues-db.test.ts` 가 **DB 의 구장 문자열 전부**를 이 표와 대조한다.
 * 적재가 실패하는 대신 **시험이 실패한다** — 새 구장이 조용히 들어오는 경로는 없다.
 *
 * ## 근거 — 전부 실측
 *
 * `node scripts/venue-measure.ts data/bb.sqlite` (정규 · `status='played'` · 2018~2026 9시즌).
 * ⚠**인라인 프로브로 재고 지우지 마라.** 이 표를 손보는 사람은 그 스크립트를 다시 돌린다.
 */
import { canonicalTeamCode } from "./teams.ts";

/**
 * 소스가 쓰는 구장 문자열 하나.
 *
 * ⚠**`firstSeen` 은 「건물이 생긴 해」가 아니다.** 우리 보유 데이터(2018~)에서
 * 이 표기가 처음 관측된 시즌이다. 神宮은 1926년에 생겼고 여기엔 2018 이라고 적혀 있다.
 */
export interface VenueName {
  /** 원문 문자열. **이것이 정본 키다** — `normalizeVenue` 를 거친 뒤의 모양 */
  name: string;
  /**
   * 우리 보유 데이터에서 이 표기가 처음 관측된 시즌.
   *
   * ⚠**범위는 `game.venue` 전부 — 대회도 상태도 안 가린다**(+ `upcoming_game`).
   * 「정규시즌 실시경기」로 재면 틀린다: 熊本·豊橋·郡山 의 2018 은 **중지 경기**이고
   * 熊本 2018 에는 **올스타**도 있다. 처음 이 표를 채울 때 정규·실시로 재서 셋 다 2019 로 적었고,
   * **`venues-db.test.ts` 가 그 셋을 잡았다.**
   */
  firstSeen: number;
  /**
   * **개명으로 이 표기를 그만 쓴 시즌.** `null` 이면 「그만뒀다는 근거가 없다」.
   *
   * ⚠**지방개최 구장에는 채우지 마라.** 몇 시즌 걸러 한 번씩 나오므로
   * 「마지막으로 본 해」와 「그만둔 해」가 구별되지 않는다 — 채우면 다음에 그 구장이
   * 다시 열릴 때 **멀쩡한 경기가 실패한다.**
   * ⚠**2024 소프트뱅크처럼 시즌 도중에 바뀌면 후임 표기와 이 해가 겹친다.** 그게 정상이다.
   */
  supersededAfter: number | null;
}

/** 홈 귀속의 종류. ⚠**`neutral` 은 「홈구장이 아니다」이지 「데이터가 없다」가 아니다**(M11) */
export type HomeVenueKind = "primary" | "secondary" | "neutral";

/**
 * 이 건물을 홈으로 쓰는 팀.
 *
 * ⚠**「경기 수」로 판정하지 않는다.** 「20경기 이하는 지방개최」로 자르면 이것들이 전부 틀린다:
 * ```
 * 阪神 京セラD大阪    9시즌 전부 3~9경기   8월 甲子園을 고교야구에 내준다 — 제2 홈구장이다
 * オリックス ほっと神戸 9시즌 전부 3~11경기  제2 홈구장
 * 日本ハム 東京ドーム   2018:7 19:9 21:5 22:3  삿포로 시절의 상설 도쿄 시리즈
 * ```
 * 반대로 **경기 수가 많아도 홈구장이 아닌 것**이 있다 — 2021년 올림픽으로 요코하마를 못 쓴
 * DeNA 가 東京ドーム 6 · 神宮 4 를 홈으로 치렀다. 그건 **임시 대체**지 그 팀의 구장이 아니다.
 * → **표에 손으로 적고, 시험이 데이터로 대조한다.**
 */
export interface VenueHome {
  /** 팀 코드(`teams.ts`) */
  team: string;
  kind: "primary" | "secondary";
  /** 이 귀속이 시작된 시즌 */
  since: number;
  /** 이 귀속이 끝난 시즌. `null` 이면 아직 */
  until: number | null;
}

export interface Venue {
  /**
   * **건물 ID — 우리 자체 안정 ID다**(M10 의 구장판).
   * 소스 문자열이 바뀌어도 이것은 안 바뀐다. 화면·URL·집계 키는 전부 이것을 쓴다.
   */
  id: string;
  /**
   * 집계 화면용 표시명 = **가장 최근 표기**.
   *
   * ⚠**개별 경기의 구장명으로 쓰지 마라.** 2018년 경기에 「みずほPayPay」라고 적으면 거짓이다 —
   * 경기 한 건의 표시는 `game.venue` 의 **원문**이 맡는다(그래서 원문을 지우지 않는다).
   */
  display: string;
  /** 별칭 이력. **오래된 것부터** */
  names: readonly VenueName[];
  /** 팀 귀속. 지방개최 전용 구장은 빈 배열 */
  homes: readonly VenueHome[];
  /** 이 건물에 대해 **우리가 모르는 것**. 있으면 화면·판단에서 그대로 인용한다 */
  note?: string;
}

/** 지방개최 전용(홈 귀속 없음) 구장. 표기가 한 번도 안 바뀐 것들이라 한 줄로 적는다 */
const away = (id: string, name: string, firstSeen: number): Venue => ({
  id,
  display: name,
  names: [{ name, firstSeen, supersededAfter: null }],
  homes: [],
});

/**
 * **구장 정본 표.**
 *
 * ⚠**여기 없는 문자열은 예외다**(M7). 「모르면 지방개최로 친다」 같은 폭넓은 규칙을 넣지 마라 —
 * 그 순간 다음 개명이 조용히 흡수되고, 그건 **소프트뱅크 홈구장이 넷으로 쪼개져도
 * 아무도 모르는** 상태를 뜻한다.
 */
export const VENUES: readonly Venue[] = [
  /* ── 본거지가 있는 건물 ────────────────────────────────────────────── */
  {
    id: "jingu",
    display: "神宮",
    names: [{ name: "神宮", firstSeen: 2018, supersededAfter: null }],
    homes: [{ team: "s", kind: "primary", since: 2018, until: null }],
    // ⚠2021 DeNA 4경기는 **올림픽으로 요코하마를 못 쓴 임시 대체**다. 홈 귀속이 아니다
  },
  {
    id: "yokohama",
    display: "横浜",
    names: [{ name: "横浜", firstSeen: 2018, supersededAfter: null }],
    homes: [{ team: "db", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "koshien",
    display: "甲子園",
    names: [{ name: "甲子園", firstSeen: 2018, supersededAfter: null }],
    homes: [{ team: "t", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "tokyo-dome",
    display: "東京ドーム",
    names: [{ name: "東京ドーム", firstSeen: 2018, supersededAfter: null }],
    homes: [
      { team: "g", kind: "primary", since: 2018, until: null },
      /**
       * 日本ハム의 상설 도쿄 시리즈. 실측 2018:7 · 2019:9 · 2020:0(코로나) · 2021:5 · 2022:3 ·
       * **2023 이후 0** — 에스컴필드로 옮긴 해에 끊겼다.
       */
      { team: "f", kind: "secondary", since: 2018, until: 2022 },
    ],
    // ⚠2021 DeNA 6 · ヤクルト 6 은 올림픽 임시 대체. 楽天·ソフトバンク 등의 연 1경기는 지방 시리즈
  },
  {
    id: "mazda",
    display: "マツダスタジアム",
    names: [{ name: "マツダスタジアム", firstSeen: 2018, supersededAfter: null }],
    homes: [{ team: "c", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "zozo-marine",
    display: "ZOZOマリン",
    names: [{ name: "ZOZOマリン", firstSeen: 2018, supersededAfter: null }],
    homes: [{ team: "m", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "nagoya-dome",
    display: "バンテリンドーム",
    names: [
      { name: "ナゴヤドーム", firstSeen: 2018, supersededAfter: 2020 },
      { name: "バンテリンドーム", firstSeen: 2021, supersededAfter: null },
    ],
    homes: [{ team: "d", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "seibu-dome",
    display: "ベルーナドーム",
    names: [
      { name: "メットライフ", firstSeen: 2018, supersededAfter: 2021 },
      { name: "ベルーナドーム", firstSeen: 2022, supersededAfter: null },
    ],
    homes: [{ team: "l", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "rakuten-sendai",
    display: "楽天モバイル",
    names: [
      { name: "楽天生命パーク", firstSeen: 2018, supersededAfter: 2022 },
      { name: "楽天モバイル", firstSeen: 2023, supersededAfter: null },
    ],
    homes: [{ team: "e", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "fukuoka-dome",
    display: "みずほPayPay",
    /**
     * ⚠**9시즌에 세 번 바뀌었고 마지막은 시즌 도중이다.**
     * 2024: `みずほPayPay` 59 + `PayPayドーム` 6 — 그래서 판정 키가 시즌이 아니라 문자열이다.
     */
    names: [
      { name: "ヤフオクドーム", firstSeen: 2018, supersededAfter: 2019 },
      { name: "PayPayドーム", firstSeen: 2020, supersededAfter: 2024 },
      { name: "みずほPayPay", firstSeen: 2024, supersededAfter: null },
    ],
    homes: [{ team: "h", kind: "primary", since: 2018, until: null }],
  },
  {
    id: "kyocera-dome",
    display: "京セラD大阪",
    names: [{ name: "京セラD大阪", firstSeen: 2018, supersededAfter: null }],
    homes: [
      { team: "b", kind: "primary", since: 2018, until: null },
      /**
       * ⚠**阪神의 제2 홈구장이다.** 8월에 甲子園을 고교야구에 내주기 때문에 매년 열린다 —
       * 실측 9시즌 전부(2018:8 19:9 20:3 21:9 22:9 23:8 24:9 25:8 26:6).
       * **「20경기 이하는 지방개최」로 자르면 이 9시즌이 전부 사라진다.**
       */
      { team: "t", kind: "secondary", since: 2018, until: null },
    ],
  },
  {
    id: "hotto-motto-kobe",
    display: "ほっと神戸",
    names: [{ name: "ほっと神戸", firstSeen: 2018, supersededAfter: null }],
    /** ⚠**본거지가 없는 제2 홈구장.** 오릭스가 9시즌 전부 3~11경기를 여기서 치른다 */
    homes: [{ team: "b", kind: "secondary", since: 2018, until: null }],
  },
  {
    id: "sapporo-dome",
    display: "札幌ドーム",
    names: [{ name: "札幌ドーム", firstSeen: 2018, supersededAfter: null }],
    /** ⚠**`es-con-field` 와 다른 건물이다.** 합치면 2.3%p 가 뭉개진다(docs/metrics/ §3.3 함정 4) */
    homes: [{ team: "f", kind: "primary", since: 2018, until: 2022 }],
  },
  {
    id: "es-con-field",
    display: "エスコンＦ",
    /** ⚠전각 `Ｆ` 다. 반각으로 적으면 **문자열이 안 맞아 전 경기가 실패한다** */
    names: [{ name: "エスコンＦ", firstSeen: 2023, supersededAfter: null }],
    homes: [{ team: "f", kind: "primary", since: 2023, until: null }],
  },

  /* ── 지방개최 전용 ─────────────────────────────────────────────────── */
  /**
   * ⚠**개명이 있는 지방구장.** 지방구장이라고 표기가 안 바뀌는 게 아니다 —
   * `新潟` → `ハードオフ新潟`(2024~). 여기만 `away()` 를 못 쓴다.
   */
  {
    id: "niigata",
    display: "ハードオフ新潟",
    names: [
      { name: "新潟", firstSeen: 2018, supersededAfter: 2023 },
      { name: "ハードオフ新潟", firstSeen: 2024, supersededAfter: null },
    ],
    homes: [],
  },
  /**
   * ⚠⚠**`山形` 과 `山形市` 가 같은 건물인지 우리는 모른다 — 「미확인」이다.**
   *
   * 관측: `山形市` 는 楽天의 홈경기(2018·19·23·24·25·26 각 1경기) · `山形` 은 巨人의 홈경기(2022·25 각 1경기).
   * 두 표기가 **같은 시즌에 함께 나온 적이 없고**, 저장된 원문(`index.html`)에도 짧은 표기밖에 없다
   * (2025-07-08 巨人 · 2025-06-10 楽天 두 경기의 아카이브를 실제로 열어 확인 · 외부 요청 0회).
   *
   * ⚠**약한 정황은 있다**: 다른 지방구장은 홈팀이 달라도 같은 문자열을 쓴다
   * (`那覇` f/l/g/b · `岐阜` g/d · `新潟` db/g · `弘前` e/g · `盛岡` e/g …).
   * 표기가 홈팀에 따라 갈리는 것은 여기뿐이다. **하지만 정황은 판정이 아니다.**
   *
   * → **합치지 않는다.** 합치는 쪽이 되돌리기 어렵고, 틀렸을 때 두 구장의 성질이 섞인다.
   *   ⚠**「미확인」을 「다른 건물」로 읽지 마라** — 이 note 가 화면과 보고서에 그대로 따라간다.
   *   푸는 방법: npb.jp 일정 페이지 이외의 1차 출처(구단 공지 등)로 정식 구장명을 확인한다.
   */
  { ...away("yamagata", "山形", 2022), note: "⚠`yamagata-shi` 와 같은 건물인지 **미확인**. 합치지 않았다" },
  { ...away("yamagata-shi", "山形市", 2018), note: "⚠`yamagata` 와 같은 건물인지 **미확인**. 합치지 않았다" },

  /**
   * ⚠**중지 경기에만 나오는 구장이다** — 2018-07-05 `f-l-12` 한 건(`status='notPlayed'` · 中止).
   * **실시 경기 57종에는 안 들어가고, 그래서 하마터면 표에서 빠질 뻔했다.**
   * 빠졌으면 그 경기를 화면에 그리는 순간(`dayResults` 는 중지 경기도 싣는다) `venueOf` 가 던진다.
   * ⚠**분모가 다르면 답이 다르다**(작업규칙 7): 정규·실시 **57종** · 정규·전 상태 **58종**.
   *   표가 맞춰야 하는 것은 **58종** 쪽이다 — `game.venue` 는 상태를 안 가리기 때문이다.
   */
  away("hakodate", "函館", 2018),

  away("iwaki", "いわき", 2026),
  away("hitachinaka", "ひたちなか", 2018),
  away("miyoshi", "三次", 2018),
  away("kyoto", "京都", 2018),
  away("saga", "佐賀", 2023),
  away("kurashiki", "倉敷", 2018),
  away("maebashi", "前橋", 2018),
  away("kitakyushu", "北九州", 2018),
  away("kure", "呉", 2018),
  away("utsunomiya", "宇都宮", 2018),
  away("miyazaki", "宮崎", 2018),
  away("toyama", "富山", 2018),
  away("gifu", "岐阜", 2019),
  away("obihiro", "帯広", 2018),
  away("hirosaki", "弘前", 2018),
  away("asahikawa", "旭川", 2018),
  away("matsuyama", "松山", 2018),
  away("matsumoto", "松本", 2024),
  away("hamamatsu", "浜松", 2018),
  away("kumamoto", "熊本", 2018),
  away("morioka", "盛岡", 2019),
  away("omiya", "県営大宮", 2018),
  away("fukui", "福井", 2018),
  away("fukushima", "福島", 2024),
  away("akita", "秋田", 2019),
  away("toyohashi", "豊橋", 2018),
  away("naha", "那覇", 2018),
  away("koriyama", "郡山", 2018),
  away("kanazawa", "金沢", 2018),
  away("kushiro", "釧路", 2018),
  away("nagasaki", "長崎", 2019),
  away("nagano", "長野", 2018),
  away("shizuoka", "静岡", 2018),
  away("kagoshima", "鹿児島", 2018),
];

const BY_NAME = new Map<string, Venue>();
for (const v of VENUES) {
  for (const n of v.names) {
    const dup = BY_NAME.get(n.name);
    if (dup !== undefined) {
      throw new RangeError(`구장 문자열이 두 건물에 붙어 있다: ${n.name} (${dup.id} · ${v.id})`);
    }
    BY_NAME.set(n.name, v);
  }
}

const BY_ID = new Map(VENUES.map((v) => [v.id, v]));
if (BY_ID.size !== VENUES.length) throw new RangeError("건물 ID 가 중복이다");

/**
 * 구장 문자열 → 건물.
 *
 * ⚠**모르는 문자열은 던진다**(M7). 「모르면 그냥 그 이름의 건물로 친다」로 흘리면
 * 다음 개명 때 한 건물이 둘로 쪼개진 채 아무도 모르고, **파크팩터와 홈/원정 스플릿이
 * 조용히 반반씩 틀린다.** 2018 오릭스를 잡은 것이 바로 던지는 설계였다.
 *
 * @param name `normalizeVenue` 를 거친 원문 문자열(= `game.venue`)
 */
export function venueOf(name: string): Venue {
  const v = BY_NAME.get(name);
  if (v === undefined) {
    throw new RangeError(
      `모르는 구장: ${JSON.stringify(name)}. packages/domain/src/venues.ts 를 갱신하라 — ` +
        "개명이면 그 건물의 `names` 에 넣고(**새 건물을 만들지 마라**), " +
        "새 구장이면 건물을 추가하라. 근거는 `node scripts/venue-measure.ts data/bb.sqlite`",
    );
  }
  return v;
}

/** 표가 아는 구장 문자열 전부. **DB 대조에 쓴다** */
export function knownVenueNames(): ReadonlySet<string> {
  return new Set(BY_NAME.keys());
}

/** 건물 ID 로 찾는다. **모르면 던진다** */
export function venueById(id: string): Venue {
  const v = BY_ID.get(id);
  if (v === undefined) throw new RangeError(`모르는 건물 ID: ${id}`);
  return v;
}

const covers = (h: VenueHome, season: number): boolean =>
  season >= h.since && (h.until === null || season <= h.until);

/**
 * 그 시즌 그 팀에게 이 구장은 무엇인가.
 *
 * ⚠**`neutral` 은 「지방개최·임시 대체」다.** 「모른다」가 아니다 —
 * 모르는 문자열은 `venueOf` 가 이미 던졌다(M11: 0 과 null 을 섞지 않는다).
 */
export function homeVenueKind(venueName: string, teamCode: string, season: number): HomeVenueKind {
  const team = canonicalTeamCode(teamCode);
  const hit = venueOf(venueName).homes.find((h) => h.team === team && covers(h, season));
  return hit?.kind ?? "neutral";
}

/**
 * 그 팀의 홈구장인가(**본거지 + 제2 홈구장**).
 *
 * 파크팩터의 「홈팀 주구장 경기만」 필터가 이것이다.
 * ⚠**경기 수로 대신하지 마라** — 阪神 京セラ(연 3~9) · オリックス ほっと神戸(연 3~11) 가 잘려 나간다.
 */
export function isHomeVenue(venueName: string, teamCode: string, season: number): boolean {
  return homeVenueKind(venueName, teamCode, season) !== "neutral";
}

/**
 * 그 시즌 그 팀의 **본거지**.
 *
 * ⚠**모르면 던진다.** 이것이 「구단이 구장을 옮겼는데 표를 안 고쳤다」를 잡는 자리다 —
 * 조용히 `null` 을 돌려주면 그 팀 홈경기가 전부 `neutral` 이 되어 **파크팩터에서 통째로 사라진다.**
 */
export function primaryVenue(teamCode: string, season: number): Venue {
  const team = canonicalTeamCode(teamCode);
  const hits = VENUES.filter((v) =>
    v.homes.some((h) => h.team === team && h.kind === "primary" && covers(h, season)),
  );
  if (hits.length !== 1) {
    throw new RangeError(
      `${season} 시즌 ${team} 의 본거지가 ${hits.length}개다(${hits.map((v) => v.id).join(",") || "없음"}). ` +
        "packages/domain/src/venues.ts 의 `homes` 를 갱신하라 — 구단이 구장을 옮겼을 수 있다",
    );
  }
  return hits[0]!;
}
