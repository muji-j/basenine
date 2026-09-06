/**
 * ドラフト会議 — **경합의 서사와, 소스가 말하지 않는 것.**
 *
 * ⚠**이 화면의 주역은 표가 아니라 「1位指名の入札」이다.** 유저가 알고 싶은 것은
 * 「어느 구단이 누구를 1지망으로 적었고 · 제비를 누가 뽑았고 · **진 구단이 다음에 누구로 바꿨는가**」이고,
 * 그것은 **회차가 내려갈수록 낙첨 구단이 다시 나타나는 구조 자체**가 말한다. 표는 그것을 못 말한다.
 *
 * ⚠**wikipedia 의 격자(행=회차 × 열=12구단)를 재현하지 않는다**(L2 · §2-5 2층).
 * 우리가 그리는 단위는 **경합 그룹**이다 — 원본의 편집물 구성을 옮기지 않고 우리 구조로 다시 세운다.
 *
 * ## ⚠이 화면이 특히 조심하는 것 셋
 *
 * ⑴ **단독지명과 낙첨을 섞지 않는다**(M11). 「아무도 안 겹쳤다」(`won === null`)와
 *    「경합에서 졌다」(`won === 0`)는 다른 사실이고, 섞이는 순간 화면이 거짓말을 한다.
 *    그래서 단독은 **접어서 따로** 두고, 그 안에 「当選」·「落選」이라는 글자가 아예 없다.
 * ⑵ **비어 있음이 여섯 가지다**(`DataState`). 특히 2023~2025 의 추첨 결과는
 *    **npb.jp 가 표시를 껐다**(`unpublished`) — 「データがありません」이라고 쓰면
 *    없는 잘못을 우리가 뒤집어쓰는 게 아니라 **없는 사실을 지어내는** 쪽이 된다.
 * ⑶ **소스가 말하지 않는 것을 화면이 말한다.** 웨이버 방향(→ ←)·지명 순번은
 *    `draft_pick` 2,234행이 **전건 NULL** 이라 그릴 수 없다. **빈 화살표는 거짓**이고,
 *    조용히 빼면 「그런 것은 원래 없다」가 된다 — 그래서 **없다는 사실을 적는다.**
 *
 * ⚠**선수 링크는 지금 0건이고 그게 맞다**(M10 · `store/src/draft.ts` 머리말).
 * 이름 문자열로 선수를 잇지 않으므로 **이름만 나온다.** ⚠**행을 지우지 마라 — 그 지명은 실제로 있었다.**
 *
 * ⚠**사진·로고·엠블럼을 쓰지 않는다**(L5·L6). 구단을 구별하는 것은 **우리가 고른 색**과 이름뿐이고,
 * 우리 어휘에 없는 구단(`yb` 2005~2011 横浜)은 **중립색 + 코드 그대로**다 —
 * **`db`(DeNA)로 접으면 「YB」보다 더 그럴듯해서 더 나쁜 거짓말**이 된다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, fullDate } from "./format.ts";
import { DRAFT_PATH, page, stateNote } from "./layout.ts";
import type { DataState, RenderContext } from "./layout.ts";
import { note, panel, tablist } from "./parts.ts";
// ⚠**JST 변환은 한 벌이다**(M1 · §2-1) — 화면이 +9시간을 자기 손으로 적지 않는다
import { toJstDateString } from "@bb-app/archiver";
import { NEUTRAL_COLOR, colorOf } from "@bb-app/domain";
import type { DraftKind } from "@bb-app/parser";

/* ---- 데이터 ---------------------------------------------------------------
 *
 * ⚠**여기 있는 이유**: 다른 `*PageData` 10곳이 전부 렌더러 모듈에 있고 `query.ts` 에는 0개였다.
 *   `query.ts` 는 이것을 `import type` 으로 받는다 — **런타임 의존이 생기지 않는다.**
 * ------------------------------------------------------------------------- */

/** 그 행이 어느 소스에서 왔는가. ⚠**행마다 남긴다** — 2023 이후는 대조 상대가 없다 */
export type DraftOrigin = "npb" | "wikipedia";

/**
 * 지명·입찰에 붙는 구단.
 *
 * ⚠**코드가 연도의 함수다.** 같은 구단이 해마다 다른 슬러그로 나온다 —
 * 실측: `bs`(オリックス 2005~2018 · 지명 116) · `b`(2019~ · 80) ·
 * `yb`(横浜 2005~2011 · 53) · `db`(2012~ · 120).
 */
export interface DraftTeam {
  /** 소스 슬러그 그대로. ⚠**정규화하지 않는다** — 그 해에 실제로 쓰인 값이다 */
  code: string;
  /**
   * 짧은 표기. ⚠**모르는 코드면 `null` 이다**(M11 · M7).
   *
   * ⚠**`shortNameOf` 를 그냥 부르면 안 된다** — 그 함수는 모르는 코드에서 던지지 않고
   * `code.toUpperCase()` 로 **조용히 떨어진다.** 그러면 화면에 **「YB」라는 정체불명의 구단**이
   * 태연히 나가고, 아무 시험도 그걸 결함으로 읽지 못한다.
   * ⚠**`yb` 를 `db` 로 접지도 않는다** — 2005년의 그 구단은 **DeNA 가 아니었다.**
   *   접는 순간 화면이 시대착오적인 거짓말을 하고, 그건 「YB」보다 **더 그럴듯해서 더 나쁘다.**
   *   제대로 고치려면 **「그 시즌에 존재한 구단」 이력 마스터**가 필요하고, 그건 이 태스크 밖이다
   *   (설계 §0 이 2004 이전을 자른 이유와 같은 문제가 범위 안에서 다시 나온 것이다).
   */
  shortName: string | null;
}

/**
 * 화면에 나오는 이름 하나.
 *
 * ⚠**링크가 없어도 이름은 남는다.** 드래프트에서 이 규칙이 특히 무겁다 —
 * 지명된 선수의 상당수가 우리 `player` 표에 **영영 없다**(입단 거부 · 은퇴 · 1군 미등록).
 * **행을 지우지 마라. 그 지명은 실제로 있었다.**
 */
export interface DraftName {
  /** 소스 표기 그대로. ⚠**항상 있다** */
  display: string;
  /** 동일성 판정용 정규화형. ⚠**화면에 내지 마라** — 실측 2,234건 중 2,230건이 `display` 와 다르다 */
  canonical: string | null;
  /**
   * 우리 선수 페이지로 이을 수 있으면 그 좌표. **없으면 `null` 이고 이름만 남는다.**
   *
   * ⚠**지금은 전건 `null` 이다** — 적재가 `player_id` 를 넣지 않는다(M10 · `store/src/draft.ts`
   * 머리말: 「이름 문자열로 선수를 잇지 않는다. 연결 자체는 별도 태스크다」).
   * 실측: `draft_pick` **2,234/2,234** · `draft_bid` **374/374** 전건 NULL.
   * ⚠**그러니 여기서 이름으로 잇지 마라** — 그 금지가 M10 이고, 동명이인·개명·표기 요동이 그 이유다.
   * ⚠**`season` 은 「그 선수 페이지가 실재하는 시즌」**이다. 드래프트 연도가 아니다 —
   *   지명된 해에는 아직 1군 기록이 없으므로 그 해 페이지는 대개 존재하지 않는다.
   */
  link: { playerId: string; season: number } | null;
}

/** 1순위 입찰 한 건 — 한 구단이 적어 낸 이름. */
export interface DraftBidEntry {
  team: DraftTeam;
  /**
   * 그 구단이 적어 낸 이름.
   * ⚠**같은 그룹 안에서도 표기가 다를 수 있다** — 실측 2019: 당첨 행 `佐々木 朗希` ·
   * 낙첨 행 `佐々木朗希`(공백 없음). **표기를 하나로 접지 마라. 소스가 그렇게 적었다.**
   */
  name: DraftName;
  /**
   * 소스가 **선언한** 경합 상대(원문 표기 그대로).
   * ⚠**`null` 은 「원래 없음」이다**(M11) — 단독지명 행에는 주석 자체가 없고, 그룹에 속하는데도
   * 상대 문장이 없는 소스가 있을 수 있다. **`[]`(상대 0명)와 다른 값이다.**
   * ⚠**구단 코드로 바꾸지 않는다** — `西武`↔`埼玉西武` 처럼 표기가 연대의 함수라 매핑표가
   * 한 벌로 안 선다(020 마이그레이션 주석).
   */
  rivals: readonly string[] | null;
  /**
   * `1` 당첨 · `0` 낙첨 · **`null` 단독지명**.
   * ⚠**셋을 두 값으로 접지 마라**(M11) — 「경합에서 이겼다」와 「아무도 안 겹쳤다」는 다른 사실이다.
   * ⚠**행 자체가 이 값을 들고 다녀야 한다.** 그래야 `losers` 에 섞인 결함 행(당첨이 둘인 그룹)이
   *   화면에서 **틀린 이름표를 달고도 조용하지는 않다.**
   */
  won: 1 | 0 | null;
  origin: DraftOrigin;
}

/**
 * 경합 그룹 하나 — **당첨 1 + 낙첨 N** 이 정상이다.
 */
export interface DraftBidGroup {
  /** 소스 유래 키(`1:佐々木朗希`). ⚠**표시용이 아니다** */
  groupKey: string;
  /** 겨룬 선수. ⚠구단마다 표기가 달랐다면 **당첨 구단의 표기**를 쓴다 */
  name: DraftName;
  /**
   * 교섭권을 얻은 구단.
   * ⚠**`null` 이면 그것은 결함이다**(INV-N1). **화면에서 조용히 건너뛰지 마라** —
   * 그룹을 지우면 「그 경합은 없었다」가 되고, 우리는 그게 참인지 알 방법이 없다.
   * 같은 사실이 `DraftPageData.defects` 에도 남는다.
   */
  winner: DraftBidEntry | null;
  /**
   * **당첨으로 고른 한 행을 뺀 나머지 전부.** 소스 순서.
   *
   * ⚠**「낙첨 행만」이 아니다 — 일부러 그렇게 했다.** 「`won !== 1` 인 행」으로 정의하면
   * 당첨이 둘인 결함 그룹에서 **둘째 당첨 행이 화면에서 조용히 사라진다.**
   * 여기 정의라면 `winner` + `losers` 가 **언제나 그룹의 전부**이고
   * (`teams === (winner ? 1 : 0) + losers.length` 가 항상 성립),
   * 섞여 들어온 행은 자기 `won === 1` 로 스스로를 밝힌다.
   * ⚠**그런 그룹은 `DraftPageData.defects.groupsWithManyWinners` 에도 남는다** — 실측 0건이다.
   */
  losers: readonly DraftBidEntry[];
  /**
   * **이 그룹에 든 구단 수**(= `winner` 있으면 1 + `losers.length`).
   * ⚠**분모다**(M2). 화면이 「5球団競合」을 스스로 세면 언젠가 다른 수를 센다.
   */
  teams: number;
}

/** 1순위 입찰의 한 회차 — 1回 · 外れ1位 · 外れ外れ1位 …. */
export interface DraftBidRound {
  /**
   * ⚠**지명 회차가 아니라 「1巡目 안에서 몇 번째 추첨인가」다**(`store/src/draft.ts` 머리말 표).
   * 어느 추첨에서 이겼든 그 구단이 얻은 것은 **1巡目 지명**이다.
   */
  roundNo: number;
  groups: readonly DraftBidGroup[];
  /**
   * 그 회차의 **단독지명**(경합 그룹의 여집합 · `won IS NULL`).
   * ⚠**낙첨(`won = 0`)과 다른 사실이다**(M11) — 「경합에서 졌다」와 「아무도 안 겹쳤다」.
   * ⚠**회차마다 나온다** — 실측 2019 는 1·2·3회차 전부에 단독지명이 있다.
   */
  solo: readonly DraftBidEntry[];
}

/**
 * 1순위 입찰 블록.
 *
 * ⚠**「입찰이 0행」이 두 가지 다른 사실이다.** 그래서 `state` 가 붙는다 — `counts` 만 보면
 * 2023(=NPB 가 표시를 껐다)과 진짜 수집 실패가 같은 화면이 된다.
 */
export interface DraftBidBlock {
  state: DataState;
  rounds: readonly DraftBidRound[];
  /**
   * 분모 한 벌(M2). `bids` 는 입찰 **행** 수, `groups` 는 경합 그룹 수, `solo` 는 단독지명 수.
   * ⚠**`bids = groups 안의 구단 수 + solo` 여야 한다** — 어긋나면 어딘가를 흘린 것이다.
   */
  counts: { bids: number; groups: number; solo: number };
}

/** 확정된 지명 한 건. */
export interface DraftPick {
  team: DraftTeam;
  name: DraftName;
  /** `投手`·`捕手`·`内野手`·`外野手`. ⚠소스가 안 적으면 `null`(M11) */
  position: string | null;
  /** 출신(학교·팀). ⚠소스가 안 적으면 `null` */
  fromOrg: string | null;
  /**
   * 웨이버 방향.
   * ⚠**지금은 전건 `null` 이다** — npb.jp 명단 페이지가 이것을 **적지 않는다**(실측 2,234/2,234).
   * **「1순위라서 없다」가 아니라 「이 소스가 말하지 않아서 없다」**다(M11).
   */
  waiverDir: "→" | "←" | null;
  /** 전체 지명 순번. ⚠**지금은 전건 `null`**(실측 2,234/2,234) */
  pickSeq: number | null;
  origin: DraftOrigin;
}

/** 지명 한 회차. */
export interface DraftRound {
  roundNo: number;
  /**
   * **이 수가 소스의 회차인가.**
   * ⚠`false` 면 **적재가 매긴 순번**이다(`jiyuu_kakutoku`·`kibou_nyudanwaku` — 회차라는 개념이
   * 없는 제도). 화면이 그것을 「N巡目」이라고 쓰면 **거짓**이다.
   */
  numbered: boolean;
  /** ⚠구단 순서는 `TEAMS` 순이다. **웨이버 순서가 아니다** — 그건 이 소스에 없다 */
  picks: readonly DraftPick[];
}

/**
 * **수치가 실린 페이지 하나**(M4 · L3).
 *
 * ⚠⚠**「그 구획을 실은 페이지」가 아니다 — 그렇게 적었다가 「版」이 거짓이 됐다**
 * (2026-09-06 최종 검토 [I-1]). 초판은 이 값을 **`draft_event`(연도 톱 `/draft/{YYYY}/`)**
 * 에서만 만들었는데 **수치는 구단 페이지에서 온다.**
 * 실측: `draft_pick` **252 URL · 252 revision** 대 `draft_event` **21 · 21**.
 * 2019 支配下 만 해도 **12 페이지 · 12 판**을 화면이 **1 판**이라고 말했다.
 *
 * ⚠**그래서 무엇이 깨지는가**: npb 가 한 구단 명단의 표기를 정정하면 **그 구단의 판만** 바뀌고
 * 연도 톱은 그대로다 → 화면의 「版」이 어제와 같다 → 사용자의 **「어제 본 이름과 다른데?」**에
 * 화면이 **「같은 판이다」**라고 답한다. **버그와 정정을 가르라는 M4 의 목적이 뒤집힌다.**
 *
 * ⚠**한 층 아래에서 이미 고친 실수다**(`store/src/draft.ts` `[I3]` — 출처를 `page`/`event`
 * 두 벌로 나눈 그 작업). **같은 거짓말이 화면 층에서 다시 났다. 세 번째를 만들지 마라.**
 */
export interface DraftSectionSource {
  url: string;
  fetchedAt: string;
  /** ⚠**본문 해시다** — npb.jp 는 `ETag`·`Last-Modified` 를 주지 않는다 */
  revision: string;
  origin: DraftOrigin;
  /**
   * 그 페이지에서 온 행의 구단.
   * ⚠**npb 는 페이지 하나가 구단 하나**라 보통 1개다. wikipedia 처럼 한 장이 전 구단을 싣는
   * 소스가 붙으면 여러 개가 된다 — **그때 「1구단」을 가정한 코드가 조용히 틀리지 않도록 배열이다.**
   */
  teams: readonly DraftTeam[];
  /** 그 판이 실은 행 수(지명 + 입찰). ⚠**분모다**(M2) */
  rows: number;
}

/**
 * 그 구획의 **회의 페이지**(연도 톱).
 *
 * ⚠**수치가 여기서 오지 않았다.** 이것은 **가리키기용**이고(L3 — 원본을 대체하지 않고 가리킨다)
 * 라이선스가 붙는 자리다. ⚠**여기 `revision` 을 화면의 「版」으로 쓰지 마라** — 위 주석의 그 사고다.
 */
export interface DraftEventRef {
  url: string;
  fetchedAt: string;
  revision: string;
  /** wikipedia 유래면 `CC BY-SA 4.0`. ⚠npb 유래면 `null`(실측 47/47 전건 NULL) */
  license: string | null;
  /** 개최일. ⚠**실측 47/47 전건 NULL** — 소스가 이 페이지에 안 적는다(M11) */
  heldOn: string | null;
}

/** 구획(회의) 하나. 2005~2007 은 한 해에 3~4개, 2008~ 은 2개다. */
export interface DraftSection {
  kind: DraftKind;
  /** 화면 표기. ⚠표는 `DRAFT_KIND_LABEL` 한 벌이다(M1) */
  label: string;
  /**
   * 1순위 입찰.
   * ⚠**`null` 은 「데이터 없음」이 아니라 「제도상 추첨이 없는 구획」이다**(育成·自由獲得·希望入団枠).
   * `unpublished` 로 그리면 **없는 잘못을 NPB 에 씌우는** 거짓말이 된다.
   */
  bids: DraftBidBlock | null;
  rounds: readonly DraftRound[];
  /** 이 구획의 지명 총수. ⚠**분모다**(M2) */
  pickCount: number;
  /**
   * 이 구획의 **수치가 실린 페이지들**. ⚠**구단마다 판이 다르다** — 하나로 접으면 M4 가 거짓이 된다.
   * ⚠**행이 0건이면 빈 배열이다** — 회의 페이지를 대신 세우지 않는다.
   */
  sources: readonly DraftSectionSource[];
  /** 회의 페이지. ⚠**「版」의 근거가 아니다** — 가리키기용(L3) */
  event: DraftEventRef | null;
}

/** 사후 사실 한 건(교섭권 정정 · 입단 거부 …). */
export interface DraftNote {
  kind: DraftKind;
  team: DraftTeam;
  name: DraftName;
  /**
   * `kousyouken_teisei` | `nyudan_kyohi` | `shimei_hakudatsu` | `fugoui`.
   * ⚠**표기표를 여기서 만들지 않았다** — 실측 **0행**이라 어떤 문장이 실제로 오는지 모르고,
   * 안 본 것을 위해 어휘를 지어 두면 파서가 생긴 날 **두 벌이 된다**(M1).
   */
  noteKind: string;
  detail: string;
}

/**
 * 후일담 블록.
 * ⚠**0행과 미수집을 구별한다**(M11) — 지금은 언제나 후자다(`DRAFT_NOTES_COLLECTED`).
 */
export interface DraftNotesBlock {
  state: DataState;
  rows: readonly DraftNote[];
}

/**
 * **비어 있는 것이 정상이다.** 비어 있지 않으면 그 사실이 화면까지 가야 한다.
 *
 * ⚠**조용히 건너뛰는 것이 최악이다.** 당첨 없는 그룹을 화면에서 빼면 「그 경합은 없었다」가
 * 되고, 그건 **값도 합계도 그럴듯해서 눈으로는 못 잡는다.**
 */
export interface DraftDefects {
  /** 당첨이 0건인 경합 그룹의 키(INV-N1). 실측 **75그룹 중 0건** */
  groupsWithoutWinner: readonly string[];
  /** 당첨이 2건 이상인 경합 그룹의 키. 같은 불변식의 반대쪽 */
  groupsWithManyWinners: readonly string[];
}

/** 시즌 하나의 드래프트 화면 데이터. */
export interface DraftPageData {
  season: number;
  /**
   * 우리가 **실제로 가진** 드래프트 시즌. 화면의 시즌 전환이 여기서 나온다.
   * ⚠**화면이 목록을 박으면 소급할 때마다 사람이 고쳐야 하고, 그래서 안 고쳐진다**
   * (선수 페이지 1,864장이 「2025年から」라는 거짓말을 싣고 있던 사고와 같은 모양).
   */
  heldSeasons: readonly number[];
  /** 이 시즌 자체의 상태. ⚠`sections` 가 비면 **왜 비었는지**를 이 값이 말한다 */
  state: DataState;
  sections: readonly DraftSection[];
  notes: DraftNotesBlock;
  /** 이 화면에 섞인 출처. ⚠wikipedia 가 섞이면 **CC BY-SA 표기가 필요하다**(L3) */
  origins: readonly DraftOrigin[];
  /**
   * 선수 페이지로 이어진 이름의 수 / **이름이 있는 행의 수**.
   * ⚠**「0건」과 「안 쟀음」을 구별하려고 분모를 함께 낸다** — 지금은 `linked` 가 언제나 0 이고
   * 그 이유는 `DraftName.link` 주석에 있다. 연결 태스크가 붙는 순간 이 수가 움직인다.
   */
  links: { linked: number; total: number };
  /**
   * 우리 구단 어휘에 없는 코드.
   * ⚠**결함이 아니라 「우리 어휘가 아직 그 시대를 모른다」다** — 실측으로 `yb`(横浜 2005~2011)
   * 하나이고, 접을 상대(`db`)는 **다른 이름의 구단**이라 접으면 거짓이 된다(`DraftTeam.shortName`).
   */
  unknownTeamCodes: readonly string[];
  defects: DraftDefects;
}

/* ---- 화면 ----------------------------------------------------------------- */

/**
 * 이 화면의 경로. ⚠**한 곳에서만 짓는다**(M1) — 사이트 배선(`site.ts`)과 링크 검사가 같은 값을 써야 한다.
 *
 * ⚠**정의는 `layout.ts` 로 옮겼다**(2026-09-05 · Task 3). 내비가 이 값을 쓰는데,
 * 내비가 여기를 import 하면 **layout ↔ draft-page 순환**이 된다 —
 * `TEAMS_PATH` 가 `teams-page.ts` 에서 옮겨 간 것과 정확히 같은 사정이다.
 * **부르는 쪽의 import 경로는 그대로다** — 여기서 다시 내보낸다.
 */
export { DRAFT_PATH };

/**
 * 1巡目 **안에서 몇 번째 추첨인가**의 표기.
 *
 * ⚠**지명 회차가 아니다** — `store/src/draft.ts` 머리말의 표가 정본이고, 그 표가 어휘까지 적는다
 * (`1回 · 外れ1位 · 外れ外れ1位 …`). 어느 추첨에서 이겼든 그 구단이 얻은 것은 **1巡目 지명**이다.
 * ⚠**여기서 「N巡目」이라고 쓰면 거짓이다.**
 */
function bidRoundLabel(n: number): string {
  return n <= 1 ? "1位指名" : `${"外れ".repeat(n - 1)}1位`;
}

/**
 * 구단 표기.
 *
 * ⚠**모르는 코드를 지금 구단명으로 바꾸지 않는다.** `shortName === null` 이 그 판정이고
 * (`query.ts` 의 `draftTeam`), 여기서 `shortNameOf` 를 부르면 그 판정이 통째로 무의미해진다 —
 * 그 함수는 모르는 코드에서 던지지 않고 `code.toUpperCase()` 로 **조용히 떨어진다.**
 */
function teamName(t: DraftTeam): RawHtml {
  return t.shortName === null
    ? html`<abbr class="dunk"
        title="当サイトの球団辞書にないコードです。当時の球団名がわからないので、出典のコードのまま出しています">${t.code}</abbr>`
    : html`${t.shortName}`;
}

/** ⚠**모르는 구단은 중립색이다** — 색까지 지어내면 화면이 그 구단을 아는 척한다 */
function chipColor(t: DraftTeam): string {
  return (t.shortName === null ? NEUTRAL_COLOR : colorOf(t.code)).base;
}

/**
 * 구단 색 칩. ⚠**로고가 아니라 색이다**(L5·L6) — 그리고 **칩은 홀로 서지 않는다**(바로 뒤에 이름이 온다).
 * ⚠부품은 홈·순위표와 같은 `.hteam` 한 벌이다(M1).
 */
function teamChip(t: DraftTeam): RawHtml {
  return html`<span class="hteam" style="--chip:${chipColor(t)}"><i></i>${teamName(t)}</span>`;
}

/**
 * 입찰 한 줄.
 *
 * ⚠**행이 자기 `won` 을 들고 스스로를 밝힌다.** `losers` 는 「낙첨 행」이 아니라
 * **「당첨으로 고른 한 행을 뺀 나머지 전부」**라, 당첨이 둘인 결함 그룹에서도 행이 새지 않는다 —
 * 그때 둘째 당첨 행은 여기서 **「当選」이라고 적힌 채** 낙첨 자리에 나타나 눈에 걸린다.
 * ⚠**상태를 색만으로 말하지 않는다** — 글자(当選/落選)가 정보이고 색은 거들 뿐이다.
 */
/**
 * **두 표기가 같은 이름인가.**
 *
 * ⚠**여기서 공백을 지우는 규칙을 새로 만들지 않는다**(M1). 정규화 어휘는
 * `normalizePlayerName`(파서) 한 벌이고, 그 결과가 `canonical` 이다 — 여기서 두 번째 규칙을
 * 만들면 「같은 이름인가」의 답이 화면과 적재에서 갈린다.
 * ⚠**`canonical` 이 없으면 표기 그대로 비교한다**(M11) — 모르면 「같다」고 하지 않는다.
 */
function sameName(a: DraftName, b: DraftName): boolean {
  return a.canonical !== null && b.canonical !== null
    ? a.canonical === b.canonical
    : a.display === b.display;
}

function bidRow(e: DraftBidEntry, groupName: DraftName): RawHtml {
  const word = e.won === 1 ? "当選" : e.won === 0 ? "落選" : "単独";
  const cls = e.won === 1 ? "won" : e.won === 0 ? "lost" : "solo";
  return html`<li class="dbid ${cls}"><b class="dres">${word}</b>${teamChip(e.team)}${
    /**
     * ⚠**같은 그룹 안에서도 표기가 다를 수 있다**(실측 2019 `佐々木 朗希` ↔ `佐々木朗希`) —
     * **데이터에서 접지 마라. 소스가 그렇게 적었다.**
     *
     * ⚠**그런데 화면에 전부 내면 소음이 된다.** 실물로 확인했다(2026-09-05 · 2019 렌더):
     * npb 는 **당첨 행에만 공백을 넣어서** 낙첨 행 거의 전부에 이름이 한 번 더 찍혔다 —
     * 같은 이름을 두 번 적는 것은 정보가 아니다.
     * → **우리 정규화가 「같은 이름」이라고 말하는 동안은 안 낸다.** 정말 다른 표기일 때만 낸다.
     * ⚠**「접었다」가 아니라 「안 보였다」다** — 그 규칙을 블록 각주가 화면에 적는다.
     */
    sameName(e.name, groupName) ? null : html`<em class="dalt">${e.name.display}</em>`
  }</li>`;
}

/**
 * 경합 그룹 하나 — **당첨 1 + 낙첨 N** 이 정상이다.
 *
 * ⚠**당첨이 없으면 건너뛰지 않는다**(INV-N1). 그룹을 지우면 「그 경합은 없었다」가 되고,
 * 우리는 그게 참인지 알 방법이 없다. **화면이 그 자리에서 결함을 말한다.**
 */
function bidGroup(g: DraftBidGroup): RawHtml {
  return html`<li class="dgrp">
  <p class="dgn"><b>${g.name.display}</b><span class="qt">${g.teams}球団競合</span></p>
  <ul class="dbids">${g.winner === null
    ? html`<li class="dbid none"><b class="dres">当選なし</b><span class="dwarn">この競合は当選球団が記録にありません（${g.groupKey}）</span></li>`
    : bidRow(g.winner, g.name)}${g.losers.map((e) => bidRow(e, g.name))}</ul>
</li>`;
}

/**
 * 추첨 한 회차.
 *
 * ⚠**단독지명을 접어 둔다** — 회차마다 있고(실측 2019 는 1·2·3회차 전부), 펼쳐 두면
 * **경합의 서사가 그 목록에 묻힌다.** ⚠접힌 안쪽에 「当選」·「落選」이라는 글자를 넣지 않는다:
 * 「아무도 안 겹쳤다」가 「이겼다/졌다」로 읽히면 그 자체가 거짓이다.
 */
function bidRound(r: DraftBidRound): RawHtml {
  return html`<section class="drnd">
  <h3 class="drh">${bidRoundLabel(r.roundNo)}<span class="qt">${r.roundNo}回目の抽選 · 競合${r.groups.length}件 · 単独${r.solo.length}球団</span></h3>
  ${r.groups.length === 0
    ? html`<p class="empty">この回の競合はありません。</p>`
    : html`<ul class="dgrps">${r.groups.map(bidGroup)}</ul>`}
  ${r.solo.length === 0
    ? null
    : html`<details class="pickfold dsolo">
  <summary>単独指名<span class="qt">${r.solo.length}球団 — 誰とも重ならなかった指名です</span></summary>
  <ul class="dsolos">${r.solo.map(
        (e) => html`<li>${teamChip(e.team)}<b>${e.name.display}</b></li>`,
      )}</ul>
</details>`}
</section>`;
}

/**
 * 1순위 입찰 블록.
 *
 * ⚠**「입찰이 0행」이 두 가지 다른 사실이다.** 그래서 `counts` 가 아니라 `state` 로 먼저 가른다 —
 * 2023~2025(=npb.jp 가 표시를 껐다)와 진짜 수집 실패가 같은 화면이 되면 안 된다.
 */
function bidBlock(b: DraftBidBlock): RawHtml {
  if (b.state.kind !== "ok") return stateNote(b.state);
  if (b.rounds.length === 0) {
    return html`<p class="empty">この区分の入札は記録が0件です。</p>`;
  }
  return html`<div class="drnds">${b.rounds.map(bidRound)}</div>
${note(
    `入札は **${b.counts.bids}件**（競合 ${b.counts.groups}件 · 単独指名 ${b.counts.solo}件）です。` +
      "「N球団競合」の数は**そのグループに入った球団の実数**で、画面が数え直したものではありません。" +
      "抽選は**1位指名だけ**で行われます — 2位以降はウェーバーなので抽選がありません。" +
      "球団によって**選手の表記が違う**ときは、その球団の表記も並べます（空白の有無だけの違いは並べません）。",
  )}`;
}

/**
 * 회차 표기.
 *
 * ⚠**`numbered === false` 면 「N巡目」이라 쓰면 거짓이다** — 회차라는 개념이 없는 제도
 * (`jiyuu_kakutoku`·`kibou_nyudanwaku`)이고, 그 수는 **적재가 매긴 순번**이다.
 */
function roundLabel(r: DraftRound): { label: string; extra: string | null } {
  return r.numbered
    ? { label: `${r.roundNo}巡目`, extra: null }
    : { label: `${r.roundNo}番目`, extra: "回次のない制度です — 当サイトが並べた順です" };
}

/**
 * 지명의 전 기록.
 *
 * ⚠**1回차를 빼지 않는다.** 입찰 블록은 **서사**이고 이 표는 **기록**이라, 겹치는 것이 아니라 층이 다르다.
 * 무엇보다 2023~2025 는 입찰이 `unpublished` 라 1巡目을 여기서 빼면
 * **그 해의 1位指名 12건이 화면 어디에도 남지 않는다.**
 *
 * ⚠**구단 순서는 `TEAMS` 순이다 — 웨이버 순이 아니다.** 그 사실을 표 머리 옆에 적는다.
 *
 * ⚠**이름을 구획마다 유일하게 만든다**(2026-09-05 감사 P2). 한 화면에 支配下·育成 두 표가
 * 서고 둘 다 `aria-label="指名の全記録"` 이었다 — 실측으로 같은 이름이 **2건**이다.
 * 표 목록에서 둘을 고를 수 없으니 이름이 이름 노릇을 못 한다.
 * ⚠**ARIA 를 더하는 게 아니라 이미 쓰는 이름을 유일하게 만드는 것이다** — 속성이 늘지 않는다.
 * ⚠**보이는 글자를 이름 안에 남긴다**(WCAG 2.5.3): 화면의 「指名の全記録」이 그대로 들어간다.
 *
 * @param sectionLabel 이 표가 속한 구획 이름(支配下·育成 …)
 */
function pickTable(rounds: readonly DraftRound[], sectionLabel: string): RawHtml {
  return html`<div class="scroller">
  <table class="dpick" aria-label="${sectionLabel}の指名の全記録">
    <thead><tr><th class="l">球団</th><th class="l">選手</th><th class="l">守備</th><th class="l">出身</th></tr></thead>
    ${rounds.map((r) => {
      const { label, extra } = roundLabel(r);
      return html`<tbody class="drg">
      <tr class="drgh"><th class="l" colspan="4" scope="rowgroup">${label}<span class="qt">${
        extra === null ? `${r.picks.length}件` : `${r.picks.length}件 · ${extra}`
      }</span></th></tr>
      ${r.picks.map(
        (p) => html`<tr>
        <td class="l tm" style="--chip:${chipColor(p.team)}"><i></i>${teamName(p.team)}</td>
        <td class="l dnm">${p.name.display}</td>
        <td class="l">${p.position ?? NO_VALUE}</td>
        <td class="l dorg">${p.fromOrg ?? NO_VALUE}</td>
      </tr>`,
      )}
    </tbody>`;
    })}
  </table>
</div>`;
}

/**
 * 구획(회의) 하나.
 *
 * ⚠**`bids === null` 을 빈 상태로 그리지 않는다.** 그건 「데이터가 없다」가 아니라
 * **「제도상 추첨이 없는 구획」**이다(育成·自由獲得·希望入団枠) — `unpublished` 로 그리면
 * **없는 잘못을 NPB 에 씌우는** 거짓말이 된다.
 */
/**
 * 탭 그룹 이름. ⚠**한 문서에 한 번만 그린다** — 사본이 없으므로 `scopedGroup` 이 필요없다.
 * ⚠**`draft-kind` 가 아니다** — 구획(支配下·育成) 말고 「この画面について」도 담으므로
 * 이름이 「구획」이라고 말하면 거짓이 된다.
 */
const PICK_TABS = "draft-view";

/**
 * **입찰(추첨)은 탭에 넣지 않는다** — 이 화면의 목적이 그것이기 때문이다
 * (머리줄이 「誰が競合し、誰がくじを引いたか」라고 말한다 · 사용자 결정 2026-09-06).
 *
 * ⚠**2023~2025 에서 특히 중요하다.** 그 시즌들은 여기 들어가는 것이 「公表されていません」
 * 한 줄인데, 그걸 탭 뒤에 숨기면 **안 눌러 본 사람에게는 「경합이 없었다」로 읽힌다.**
 * 없는 것을 설명하는 문장은 **숨기면 안 된다.**
 *
 * ⚠**추첨이 없는 구획(育成 등)은 여기 오지 않는다** — `bids === null` 은
 * 「데이터가 없다」가 아니라 **「제도상 추첨이 없다」**라서, 그 설명은 그 구획의 패널에 있어야 한다.
 */
function bidsBlock(sections: readonly DraftSection[]): RawHtml | null {
  const withBids = sections.filter(
    (s): s is DraftSection & { bids: DraftBidBlock } => s.bids !== null,
  );
  if (withBids.length === 0) return null;
  return html`<section class="block" id="b-draft-bids">
  <h2>1位指名の入札<span class="qt">くじを引いた回ごとに並べています</span></h2>
  ${withBids.map((s) =>
    withBids.length === 1
      ? bidBlock(s.bids)
      : html`<p class="picklab dlab">${s.label}</p>
${bidBlock(s.bids)}`,
  )}
</section>`;
}

/**
 * 한 구획의 패널 알맹이 — 표, 그리고 그 구획에만 해당하는 설명.
 *
 * ⚠**제목을 패널이 갖는다.** 탭줄에는 「この画面について」도 들어가므로 바깥 블록에
 * `指名の全記録` 이라는 제목을 달면 그 탭에서 거짓이 된다.
 */
function pickPanel(s: DraftSection): RawHtml {
  return html`<h2>指名の全記録<span class="qt">${s.label} — 球団の並びは当サイトの球団順です · 指名順ではありません</span></h2>
  ${
    s.bids === null
      ? html`<p class="dnolot">この区分に抽選はありません — 制度上、1位指名の入札が行われない区分です。</p>`
      : null
  }
  ${s.rounds.length === 0
    ? html`<p class="empty">この区分の指名は記録が0件です。</p>`
    : pickTable(s.rounds, s.label)}`;
}

/**
 * **탭 아래에 아무것도 남기지 않는다**(사용자 결정 2026-09-06 · 2차).
 *
 * 1차에서는 긴 표 둘만 접고 注記·言えないこと·出典 을 그 아래에 두었다. 사용자 판단:
 * **「제일 피하고 싶은 건 세로로 긴 항목 하단부에 추가 정보가 있는 것」**이고,
 * **「한 항목이 길어도 그 탭으로 완결되면 필요한 사람만 내려가면 되니 문제없다」**.
 * ⚠**그 지적이 맞다** — 400줄짜리 표 밑에 둔 것은 접어 둔 것과 다르지 않다.
 * 실측(1차 결과): 처음 보이는 줄이 2019 −18% · 2018 −15% 밖에 안 줄었고,
 * 그 아래에 정직성 블록 셋이 그대로 깔려 있었다.
 *
 * → **탭이 페이지를 끝낸다.** 아래에 오는 블록이 없다.
 *
 * ⚠**`出典` 을 탭에 넣어도 L3 를 안 깬다** — 전역 푸터가 모든 화면에
 * 「出典：日本野球機構（NPB）公式サイト」와 재계산·사진/로고·삭제요청 안내를 싣는다(`layout.ts`).
 * 여기 든 것은 **구단별 URL·版·취득일**이라 **상세**다. ⚠**그 푸터를 지우면 이 판단이 무너진다.**
 *
 * ⚠**「この画面について」 탭은 항상 있다.** 그래서 탭줄도 항상 있고, 구획이 하나뿐인 해에도
 * 선택지가 둘이라 「누를 것이 없는 탭줄」이 되지 않는다.
 * ⚠**탭 부품을 새로 만들지 않는다**(M1) — `parts.ts` 의 `tablist`/`panel` 이
 * 화살표 키·로빙 tabindex·`aria-*`·해시 딥링크를 이미 갖고 있다.
 */
function pickTabs(d: DraftPageData, shownHeld: readonly number[]): RawHtml {
  const items = [
    ...d.sections.map((s) => ({ id: s.kind, label: `${s.label} ${s.pickCount}件` })),
    { id: ABOUT_TAB, label: "この画面について" },
  ];
  return html`<div class="block" id="b-draft-main">
  ${tablist(PICK_TABS, items, false, "表示の切り替え", true)}
  ${d.sections.map((s, i) => panel(PICK_TABS, s.kind, i === 0, pickPanel(s)))}
  ${panel(
    PICK_TABS,
    ABOUT_TAB,
    false,
    html`${notesBlock(d)}
${limitsBlock(d, shownHeld)}
${sourceBlock(d)}`,
  )}
</div>`;
}

/** ⚠구획 코드와 겹치면 안 된다 — `DraftKind` 에 없는 이름이어야 한다 */
const ABOUT_TAB = "about";

/**
 * 취득 시각 → **JST 날짜**.
 *
 * ⚠**실물에서 걸렸다**(2026-09-05). `fetched_at` 은 날짜가 아니라 **UTC 타임스탬프**
 * (`2026-09-05T04:16:49.435Z`)라, `fullDate` 에 그대로 넘기면 정규식이 안 맞아
 * **밀리초까지 붙은 원문이 화면에 그대로 나갔다.** 픽스처가 `YYYY-MM-DD` 였던 탓에 시험은 초록이었다.
 *
 * ⚠**앞 10글자를 자르지 마라** — 그건 **UTC 날짜**다. JST 07시 이전(=UTC 전날 22시 이후)이면
 * 하루 어긋나고, 그 어긋남은 **그럴듯해서 눈으로 못 잡는다**(§2-1 「JST 고정」).
 * ⚠**변환 어휘는 `toJstDateString` 한 벌이다**(M1) — 여기서 +9시간을 다시 적지 않는다.
 * ⚠**해석 못 하면 원문 그대로 낸다**(M7) — 「NaN年NaN月」을 내느니 소스가 적은 값을 보여준다.
 */
function fetchedOn(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return fullDate(at);
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at : fullDate(toJstDateString(new Date(ms)));
}

/**
 * 우리가 가진 드래프트 시즌.
 *
 * ⚠**화면이 목록을 박으면 소급할 때마다 사람이 고쳐야 하고, 그래서 안 고쳐진다**
 * (선수 페이지 1,864장이 「2025年から」라는 거짓말을 싣고 있던 사고와 같은 모양).
 * ⚠**연속이 아니면 연속인 척하지 않는다** — 그때는 있는 해를 그대로 늘어놓는다.
 */
function heldSpan(seasons: readonly number[]): string {
  if (seasons.length === 0) return "0年分";
  const sorted = [...seasons].sort((a, b) => a - b);
  const from = sorted[0]!;
  const to = sorted[sorted.length - 1]!;
  return to - from + 1 === sorted.length ? `${from}〜${to}年` : `${sorted.join("・")}年`;
}

/**
 * 위에 **분모(N年分)**를 붙인 형태.
 *
 * ⚠**`heldSpan` 에서 파생시킨다**(M1). 머리줄은 짧아야 해서 분모 없이 쓰고 각주는 분모까지 쓰는데,
 * 두 벌로 적으면 「연속이 아니면 연속인 척하지 않는다」는 규칙이 **한쪽에서만** 지켜지는 날이 온다.
 */
function heldRange(seasons: readonly number[]): string {
  return seasons.length === 0 ? "0年分" : `${heldSpan(seasons)}（${seasons.length}年分）`;
}

/**
 * 그 판을 실은 구단. ⚠**「어느 구단의 명단인가」가 이 줄에서 가장 먼저 읽혀야 한다** —
 * URL 만 12줄 늘어놓으면 사람이 `draftlist_g` 를 눈으로 해독하게 된다.
 * ⚠**모르는 구단 코드면 코드를 그대로 낸다**(M7) — 「YB」 같은 것을 지어내지 않는 것과 같은 규칙이다.
 */
function sourceTeams(src: DraftSectionSource): string {
  if (src.teams.length === 0) return "";
  if (src.teams.length === 1) return `${src.teams[0]!.shortName ?? src.teams[0]!.code} — `;
  return `${src.teams.length}球団 — `;
}

/**
 * 출처(L3).
 *
 * ⚠**전 화면에 출처 명기 + 원본 링크**가 이 프로젝트의 법적 안전장치다 —
 * 원본을 대체하는 게 아니라 **가리킨다**(§2-5 3층 회피).
 * ⚠**「몇 번째 판」까지 낸다**(M4) — 어제 본 숫자와 다를 때 버그와 정정을 가르는 근거가 그것이다.
 *
 * ⚠⚠**그 「版」이 거짓이었다**(2026-09-06 최종 검토 [I-1]). 초판은 **연도 톱 한 장의 판**을
 * 찍었는데 **수치는 구단 페이지 12장에서 온다.** 한 구단 명단이 정정돼도 연도 톱은 안 바뀌므로
 * **화면의 「版」이 어제와 같았다** — 사용자의 「어제 본 이름과 다른데?」에 화면이
 * 「같은 판이다」라고 답하는 모양이고, 그건 M4 가 존재하는 이유를 정확히 뒤집는다.
 */
function sourceBlock(d: DraftPageData): RawHtml {
  /**
   * ⚠**같은 페이지를 두 번 적지 않는다.** 실측(2019): 한 구단 페이지가 **支配下 와 育成 을 함께**
   * 싣고 판도 같다(12구단 전수에서 `urls=1 · revs=1`). 그대로 늘어놓으면 같은 줄이 두 번 나온다.
   * **구획 이름을 모아** 한 줄로 낸다.
   * ⚠**판이 다르면 합치지 않는다** — 그때는 정말 다른 사실이다(M4). 그래서 키에 판이 들어간다.
   * ⚠**라이선스는 키에서 뺐다** — 그건 회의 페이지(`event`)의 성질이고 이 줄의 성질이 아니다.
   */
  const byPage = new Map<string, { src: DraftSectionSource; labels: string[] }>();
  for (const s of d.sections) {
    for (const src of s.sources) {
      const key = `${src.url}\u0000${src.revision}`;
      const hit = byPage.get(key);
      if (hit === undefined) byPage.set(key, { src, labels: [s.label] });
      else if (!hit.labels.includes(s.label)) hit.labels.push(s.label);
    }
  }
  const rows = [...byPage.values()];
  /**
   * **회의 페이지**(연도 톱). ⚠**여기엔 「版」을 붙이지 않는다** —
   * **수치가 여기서 오지 않으므로 그 판은 화면의 수를 보증하지 않는다.**
   * 붙이면 위의 판들과 나란히 서서 **어느 것이 이 수의 판인지** 다시 알 수 없게 된다.
   */
  const events = new Map<string, DraftEventRef>();
  for (const s of d.sections) if (s.event !== null) events.set(s.event.url, s.event);
  const license = [...events.values()].find((e) => e.license !== null)?.license ?? null;
  return html`<section class="block" id="b-draft-src">
  <h2>出典<span class="qt">この画面の数字がどこから来たか</span></h2>
  ${rows.length === 0
    ? html`<p class="empty">この画面に出典の記録がありません。</p>`
    : html`<ul class="dsrc">${rows.map(
        ({ src, labels }) => html`<li>
    <b>${sourceTeams(src)}${labels.join(" · ")}</b>
    <a href="${src.url}" rel="noreferrer">${src.url}</a>
    <s>取得 ${fetchedOn(src.fetchedAt)} · 版 ${src.revision.slice(0, 8)} · ${src.rows}件</s>
  </li>`,
      )}</ul>`}
  ${events.size === 0
    ? null
    : html`<p class="dsrcy">この年の一覧: ${[...events.values()].map(
        (e) => html`<a href="${e.url}" rel="noreferrer">${e.url}</a> `,
      )}${license === null ? null : html`· ${license}`}</p>`}
  ${d.origins.includes("wikipedia")
    ? note(
        "この画面には **wikipedia 由来**の行が混ざっています。その部分は **CC BY-SA 4.0** です — " +
          "再配布するときは同じ条件が付きます。",
      )
    : null}
</section>`;
}

/**
 * **보유 연도 각주** — 두 자리(빈 해의 안내 · この画面が言えないこと)가 같은 문장을 쓴다.
 *
 * ⚠**한 벌로 둔다**(M1). 예전에는 두 곳에 같은 문장이 **글자 그대로 복사**돼 있었고,
 * 그 상태로 한쪽만 고치면 **같은 화면 안에서 서로 다른 말**을 하게 된다.
 *
 * ⚠**「収録」과 「見られる」는 다른 수다**(2026-09-05 · Task 3). DB 는 2005~2025 를 갖고 있지만
 * 사이트가 굽는 것은 2018~2026 이라, **가진 21년분 중 화면이 있는 것은 8년분**이다.
 * 「21年分を収録」만 적으면 **볼 수 없는 해를 보여 줄 것처럼** 말하게 된다 —
 * 이 저장소가 「通算」에서 이미 겪은 모양이다(CLAUDE.md §2-2: 화면이 「2018〜2026年」이라고 말한다).
 * ⚠**그렇다고 그 연도들을 링크로 만들지 마라** — 그 해에는 페이지가 아예 없다.
 *   시즌 전환은 **띠가 이미 하고 있고**, 여기서 또 하면 같은 조작이 두 벌이 된다.
 *
 * @param shownHeld 보유 연도 중 **이 사이트에 화면이 있는** 것. 시즌이 하나뿐이면 빈 배열이다
 */
function heldNote(d: DraftPageData, shownHeld: readonly number[]): RawHtml {
  const base =
    `当サイトが持っているドラフトは **${heldRange(d.heldSeasons)}** です。` +
    "ここに無い年は「開催されなかった」のではなく、**当サイトがまだ取り込んでいない**という意味です。";
  /**
   * ⚠**차이가 없으면 아무 말도 더하지 않는다.** 시즌 띠가 없는 문맥(시즌이 하나뿐일 때)에서는
   * `shownHeld` 가 비고, 그때 「見られるのは 0年分」이라고 쓰면 **참이 아닌 말**이 된다.
   */
  const hidden = d.heldSeasons.length - shownHeld.length;
  if (shownHeld.length === 0 || hidden <= 0) return note(base);
  return note(
    `${base}そのうち**この画面で見られるのは ${heldRange(shownHeld)}** で、` +
      `残り ${hidden}年分は**データはありますが、まだ画面がありません**。`,
  );
}

/**
 * **この画面が言えないこと。**
 *
 * ⚠**한계를 각주로 흘리지 않고 자기 자리를 준다.** 이 화면에는 「소스에 없는 것」이
 * 세 갈래로 있고(지명 순서 · 선수 링크 · 우리 어휘에 없는 구단), 셋 다
 * **조용히 빼면 「그런 것은 원래 없다」로 읽힌다.**
 */
function limitsBlock(d: DraftPageData, shownHeld: readonly number[]): RawHtml {
  return html`<section class="block" id="b-draft-limits">
  <h2>この画面が言えないこと<span class="qt">出典にない情報</span></h2>
  ${note(
    "**指名順（ウェーバー順）と全体の指名番号は、この出典に載っていません。** " +
      "表の球団の並びは当サイトの球団順で、**実際に指名した順番ではありません** — " +
      "「どちらから回ったか」を矢印で描くと、それは当サイトが作った嘘になります。",
  )}
  ${note(
    `選手ページに繋がった名前は **${d.links.linked}件 / ${d.links.total}件** です。` +
      "当サイトは**名前の文字列で選手を繋ぎません**（同姓同名・改名・表記ゆれで別人に付くため）。" +
      "繋がっていない名前も**そのまま出します** — その指名は実際にあったからです。",
  )}
  ${d.unknownTeamCodes.length === 0
    ? null
    : note(
        `当サイトの**球団辞書にないコード**が ${d.unknownTeamCodes.length}件あります` +
          `（${d.unknownTeamCodes.join("・")}）。当時の球団名がわからないので**コードのまま**出しています — ` +
          "今の球団名に置き換えると、その年の画面が**もっともらしい嘘**をつきます。",
      )}
  ${heldNote(d, shownHeld)}
</section>`;
}

/**
 * 불변식 위반.
 *
 * ⚠**비어 있는 것이 정상이고, 비어 있지 않으면 그 사실이 화면까지 가야 한다.**
 * 조용히 건너뛰면 「그 경합은 없었다」가 되고, **값도 합계도 그럴듯해서 눈으로는 못 잡는다.**
 */
function defectBlock(d: DraftPageData): RawHtml {
  const { groupsWithoutWinner: none, groupsWithManyWinners: many } = d.defects;
  if (none.length === 0 && many.length === 0) return raw("");
  return html`<section class="block" id="b-draft-defect">
  <h2>取り込みの不整合<span class="qt">${none.length + many.length}件</span></h2>
  <p class="fixed-note"><b>この画面の一部は、当サイトの取り込みが壊れています。</b>
  下の競合は当選球団の数が1件ではありません — 数字はそのまま出しますが、<b>この部分は信用しないでください</b>。</p>
  ${/* ⚠**여기서 별표 강조를 쓰지 마라** — `**…**` 를 굵게 만드는 것은 `note()`/`emphasize()` 뿐이고,
       `html` 템플릿에 그대로 적으면 **별표가 화면에 글자로 찍힌다**(실측 1,537장이 그랬다). */ ""}
  <ul class="ddef">${none.map((k) => html`<li><b>当選なし</b> ${k}</li>`)}${many.map(
    (k) => html`<li><b>当選が2件以上</b> ${k}</li>`,
  )}</ul>
</section>`;
}

/**
 * 후일담(④).
 *
 * ⚠**「0행」과 「미수집」을 가른다**(M11) — 지금은 언제나 후자이고, 그 문장은 `stateNote` 가 낸다.
 *
 * ⚠**한 가지 사실을 세 번 말하고 있었다**(2026-09-05 감사 P2). `stateNote` 의 접두사와
 * `detail` 이 한 줄 안에서 겹쳤고, 그 아래 각주가 **세 번째로** 같은 말을 했다 —
 * 9장 중 8장 전건에서 블록 높이 **184px** · 본문 **134자**에 정보량은 1비트였다.
 * → 겹치는 말은 `detail` 에서 걷어냈고(`query.ts`), **행이 없을 때는 한 줄로 끝낸다.**
 * ⚠**2026 화면에서 「없는 것에 대한 각주를 넉 장 쌓지 않는다」고 판단한 그 논리를 여기에도 쓴다.**
 *
 * ⚠**행이 있을 때도 그 각주를 되돌리지 마라 — 그때는 거짓이 된다.** 각주는
 * 「まだ取り込んでいません」이라고 적는데, 행이 있다는 것은 취급을 시작했다는 뜻이다.
 * 예전에는 **행이 있든 없든 무조건** 그렸으므로 `DRAFT_NOTES_COLLECTED` 가 켜지는 날
 * 화면이 **자기가 그리고 있는 목록을 부정**했을 것이다.
 */
function notesBlock(d: DraftPageData): RawHtml {
  const hasRows = d.notes.state.kind === "ok" && d.notes.rows.length > 0;
  return html`<section class="block" id="b-draft-notes">
  <h2>その後<span class="qt">入団拒否 · 交渉権の訂正</span></h2>
  ${hasRows
    ? html`<ul class="dnotes">${d.notes.rows.map(
        (n) => html`<li>${teamChip(n.team)}<b>${n.name.display}</b><s>${n.detail}</s></li>`,
      )}</ul>`
    : stateNote(d.notes.state)}
</section>`;
}

export function renderDraftPage(d: DraftPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths(DRAFT_PATH);

  /**
   * **보유 연도 중 이 사이트에 화면이 있는 것.**
   *
   * ⚠**시즌 띠에서 그대로 읽는다 — 새 데이터를 만들지 않는다**(2026-09-05 · Task 3).
   * `fallback` 이 `false` 라는 것은 **그 시즌에 이 경로가 실제로 있다**는 뜻이고
   * (`pathsFor` 가 `p.paths.has(selfPath)` 로 정한다), 그게 정확히 우리가 물어야 할 것이다.
   * 사이트 시즌 목록을 여기로 따로 나르면 **두 벌이 되고 어느 날 갈린다**(M1).
   * ⚠**시즌이 하나뿐인 문맥에서는 빈 배열이다** — 띠 자체가 안 그려지는 상황이라 그게 맞다.
   */
  const shown = new Set(seasons.filter((s) => !s.fallback).map((s) => s.season));
  const shownHeld = d.heldSeasons.filter((s) => shown.has(s));

  const head = html`<header class="idline">
  <div class="idtext">
    <h1 class="nm">${d.season}年 ドラフト会議</h1>
    <span class="sub">誰が競合し、誰がくじを引いたか</span>
    ${/* ⚠**머리줄이 「収録」만 말하면 볼 수 없는 해를 보여 줄 것처럼 말한다**(2026-09-05 감사 P2).
         `heldNote()` 는 이미 그 구별을 하고 있었는데 **그 정정이 화면에서 5,418px 아래**에 있었다 —
         머리에서 한 약속을 화면 끝에서 물리는 모양이라, 그 사이를 안 읽은 사람에게는 안 물린 것이다.
         → **같은 어휘를 머리에도 쓴다.** 분모(N年分)는 각주 쪽에만 두고 여기는 범위만 말한다.
         ⚠**두 함수가 아니라 한 벌에서 뽑는다**(M1 · `heldSpan`). */ ""}
    <span class="asof">${
      shownHeld.length > 0 && shownHeld.length < d.heldSeasons.length
        ? `${heldSpan(shownHeld)}を表示（収録は${heldSpan(d.heldSeasons)}）`
        : `${heldRange(d.heldSeasons)}を収録`
    }</span>
  </div>
</header>

${d.state.kind === "ok" ? null : stateNote(d.state)}`;

  /**
   * ⚠**보여 줄 것이 없는 해에 「없는 것에 대한 각주」를 넉 장 쌓지 않는다**(2026-09-05 실물 확인).
   * 2026 화면이 그랬다 — 아직 열리지도 않은 드래프트에 대해
   * 「지명순은 출전에 없습니다」(**표가 없다**) · 「선수 페이지 연결 0件 / 0件」(**행이 없다**) ·
   * 「후일담을 아직 수집하지 않았습니다」(**일어나지도 않았다**)가 나란히 섰다.
   * ⚠**마지막 것은 거짓에 가깝다** — `uncollected` 는 「출처에는 있는데 우리가 안 받았다」는 뜻인데,
   * 개최 전이라면 출처에도 없다. **그 상태값을 여기서 고치지 않는다**(데이터는 데이터다) —
   * **그 블록을 안 그린다.** 이 해에 대해 말할 수 있는 것은 `state` 한 줄과 **보유 연도**뿐이다.
   */
  const body =
    d.sections.length === 0
      ? html`${head}

<section class="block" id="b-draft-limits">
  <h2>この画面について<span class="qt">この年は、まだ出せるものがありません</span></h2>
  ${heldNote(d, shownHeld)}
</section>`
      : html`${head}
${defectBlock(d)}
${bidsBlock(d.sections)}
${pickTabs(d, shownHeld)}`;

  return page({
    title: `ドラフト会議 — ${d.season}年`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    spine: "ドラフト",
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    nav: "draft",
    body,
  });
}
