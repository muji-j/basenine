/**
 * 선수 페이지 — 名鑑 한 장.
 *
 * ⚠**여기 있는 함수는 전부 순수하다.** DB를 모르고, 시계를 모르고, 파일을 모른다.
 * 데이터는 `query.ts`가 만들어 넘긴다 — 그래야 픽스처만으로 화면을 테스트할 수 있다(작업규칙 11).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { BattingLine, PitchingLine, Rate } from "@bb-app/metrics";
import { TEAMS, shortNameOf } from "@bb-app/domain";
import type { League, TeamColor } from "@bb-app/domain";
import { blocksFor, presetsFor } from "./blocks.ts";
import { gamePath } from "./game-page.ts";
import type { BlockId } from "./blocks.ts";
import {
  bars,
  block,
  buttonGroup,
  columns,
  denText,
  emphasize,
  gradeLegend,
  note,
  panel,
  rankValue,
  scroller,
  statCount,
  statRate,
  statRateOuts,
  statSigned,
  statText,
  tablist,
  term,
  termAttr,
  valueWithDen,
} from "./parts.ts";
import { stableTable } from "./table.ts";
import type { BarRow, RankDigits } from "./parts.ts";
import { NO_VALUE, avg3, dec2, gameDate, innings, throwsBats } from "./format.ts";
import { isEmptyProfile, markFigure, markLetter, markProfile } from "./marks.ts";
import type { MarkPlayer, ProfileAxis } from "./marks.ts";
import { denUnit, termOf } from "./glossary.ts";
import { page, ROSTER_PATH } from "./layout.ts";
import { teamLink, teamPath } from "./team-page.ts";
import { postseasonBrief } from "./postseason-page.ts";
import type { PostseasonBrief } from "./postseason-page.ts";
import type { Freshness, SiteMeta } from "./layout.ts";

/** 지표별 순위. 없으면 자격 미달이거나 값이 없다 — **둘 다 「순위 없음」으로 같게 다룬다** */
export type Ranks = Readonly<Record<string, number | null>>;

function rk(ranks: Ranks, key: string): number | null {
  return ranks[key] ?? null;
}

/**
 * 루별 도루 한 줄.
 *
 * ⚠**라벨을 화면이 만들지 않는다** — `base` 의 뜻이 사건 종류마다 다르기 때문이다
 * (도루는 「노린 루」, 견제사는 「있던 루」 · 마이그레이션 010). 어느 쪽인지 아는 곳에서
 * 이름을 붙여 넘긴다.
 */
export interface StealBaseRow {
  /** `二盗` · `三盗` · `本盗` */
  label: string;
  /**
   * 어느 루인가. ⚠**라벨 문자열로 판정하지 않는다** — 각주가 「本盗 행이 있을 때만」 리그 수치를
   * 낼지 정하는 데 쓰는데, 표기를 바꾼 날 그 분기가 조용히 죽는다.
   * ⚠**집계의 타입을 import 하지 않고 같은 유니온을 여기 적는다** — 렌더러는 DB 계층을 모른다.
   */
  base: "1b" | "2b" | "3b" | "home";
  sb: number;
  cs: number;
  /** 그 루의 성공률. **분모는 그 루의 기도(성공 + 盗塁刺)**이고 견제사는 들어가지 않는다 */
  rate: Rate;
}

export interface BattingBlockData {
  games: number;
  runs: number;
  rbi: number;
  sb: number;
  /**
   * 走塁 — **타석 로그에서만 나오는 값**이다. 박스스코어는 `盗塁` 만 준다.
   * ⚠`pickoff`(견제사)는 `rate` 의 분모에 들어가지 않는다 — NPB 기록에서 盗塁刺 가 아니다.
   *
   * ⚠**`null` 은 「도루자 0」이 아니라 「세지 못했다」**(M11). 타석 로그의 도루 수가
   * 박스의 `盗塁` 와 어긋나면(=못 읽은 경기가 있다) 여기로 온다.
   * **0으로 때우면 성공률이 `1.000` 이 되고, 분모까지 붙은 그럴듯한 거짓말이 된다** —
   * 분모 없는 값보다 나쁘다.
   *
   * ⚠**루별 내역도 이 안에 있다.** 밖에 두면 총계가 「未集計」인데 내역만 나오는 화면이 된다.
   */
  steal: {
    cs: number;
    pickoff: number;
    rate: Rate;
    /**
     * **노린 루**별 내역. 기도가 있는 루만 담는다 — 전부 0인 줄은 정보가 아니라 잡음이다.
     * ⚠본루는 2018〜2025 정규시즌에서 성공 44 대 도루자 142 다. 뭉치면 그 사실이 사라진다.
     *   （⚠**완결 시즌의 수만 적는다** — 진행 중 시즌을 넣으면 이 주석이 매일 낡는다）
     */
    byBase: StealBaseRow[];
    /** **있던 루**별 견제사. 위와 뜻이 다른 열이라 표를 나눈다 */
    pickoffByBase: { label: string; n: number }[];
    /** 더블스틸에 관여한 도루 수. **도루의 내수**다(따로 더하지 않는다) */
    doubleSteal: number;
    /**
     * **리그 전체의 本盗** — 각주가 「本盗는 드물다」를 말할 때 쓰는 분모다.
     *
     * ⚠**여기에 수를 문자열로 적지 마라**(2026-08-20). 예전에는 각주가 「9シーズンで成功47・
     * 盗塁刺146」을 소스에 박고 있었고, 그 문자열이 배포물 **175장**에 복제됐다(실측) —
     * **경기가 하나 늘 때마다 사람이 고쳐야 하는 화면**이었고 시즌 중에는 매일 거짓이 됐다.
     * ⚠**범위(`from`~`to`)를 반드시 같이 낸다**(M2) — 분모 없는 수는 쓰지 않는다.
     * ⚠**주자 사건을 하나도 못 읽었으면 `null`**(M11) — 「0건」이 아니라 「모름」이다.
     */
    leagueHome: { from: number; to: number; sb: number; cs: number; doubleSteal: number } | null;
  } | null;
  /**
   * 併殺打. ⚠**`null` 은 「0」이 아니라 「세지 못했다」**(M11) —
   * 그 선수의 타석 로그가 없으면 여기로 온다. 0으로 때우면 「병살 없는 타자」가 된다.
   */
  gidp: number | null;
  line: BattingLine;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  woba: Rate;
  wrcPlus: Rate;
  wraa: Rate;
  iso: Rate;
  babip: Rate;
  kRate: Rate;
  bbRate: Rate;
  /** SRC. RE 행렬이 없는 리그(올스타 등)면 null */
  src: { src: number; pa: number; skipped: number; srcPer600: number | null } | null;
  ranks: Ranks;
  qualified: boolean;
  /** 규정타석 */
  needPa: number;
  /** 타구 성향. 표본이 얇으면 그 줄을 그리지 않는다 */
  batted: BattedBallData;
}

/**
 * 한 역할에서의 성적. **선발과 구원을 나눠 보여주기 위한 것**이다.
 *
 * ⚠**혼재 투수(2026 시즌 356명 중 52명)에게는 하나의 방어율이 거짓말에 가깝다.**
 * 선발 5경기와 구원 21경기를 합친 3.40이 어느 쪽의 3.40인지 알 수 없기 때문이다.
 */
export interface RoleLine {
  games: number;
  line: PitchingLine;
  era: Rate;
  whip: Rate;
  k9: Rate;
}

/**
 * 타구 성향 — 땅볼/뜬공 · 방향 · 내야안타 · 삼진 내역.
 *
 * ⚠**이름을 정확히 붙이는 것이 절반이다.**
 * - 땅볼 비율은 **「GB%」가 아니다.** GB%는 안타를 포함한 전 타구가 분모인데
 *   비홈런 안타에는 타구 종류 표기가 없어(실측 27.5%) 우리는 그걸 모른다. **아웃만**을 분모로 한다.
 * - 삼진 내역은 **「헛스윙 유도율」이 아니다.** 그건 투구 단위 데이터가 필요하고 우리에겐 없다.
 * - 방향은 **「처리한 야수 기준」**이다. 타구가 떨어진 지점이 아니다 — 시프트·호수비가 섞인다.
 */
export interface BattedBallData {
  groundOuts: number;
  airOuts: number;
  left: number;
  center: number;
  right: number;
  infield: number;
  infieldHits: number;
  swinging: number;
  looking: number;
}

export interface PitchingBlockData {
  games: number;
  line: PitchingLine;
  /** 승·패·세이브·홀드. 박스스코어의 결정 표기에서 센다 */
  decisions: { w: number; l: number; sv: number; hld: number; reliefW: number };
  era: Rate;
  whip: Rate;
  fip: Rate;
  k9: Rate;
  bb9: Rate;
  hr9: Rate;
  ranks: Ranks;
  qualified: boolean;
  /** 이 투수의 역할에 해당하는 자격선(아웃 카운트) */
  needOuts: number;
  /**
   * 선발 등판의 내용 — QS · HQS · 완투 · 완봉승.
   * ⚠**선발이 0경기면 이 줄을 그리지 않는다** — 구원 투수에게 「QS 0」은 「못 했다」로 읽힌다(M11).
   */
  quality: { starts: number; qs: number; hqs: number; cg: number; sho: number };
  /** 타구 성향. 표본이 얇으면 그 줄을 그리지 않는다 */
  batted: BattedBallData;
  /**
   * 선발형인가 구원형인가. **아웃 카운트가 많은 쪽**이다(`@bb-app/aggregate`가 정한다).
   * 순위표의 어느 부문에 서는지와, 어떤 분포로 색을 칠하는지를 이 값이 정한다.
   */
  role: "starter" | "reliever";
  /** 선발 등판 수 */
  starts: number;
  /** 투구수. ⚠산식의 입력이 아니라 표시용이다. 없으면 null(M11) */
  pitches: number | null;
  /** 폭투·보크 */
  wp: number | null;
  balk: number | null;
  /** 아웃 1개당 투구수. **낮을수록 효율이 좋다** — 등급 방향이 다른 지표와 반대다 */
  pitchesPerOut: Rate;
  /**
   * SRP(状況失点抑制). RE 행렬이 없는 리그(올스타 등)면 null.
   * ⚠**타자의 SRC와 부호가 반대인 같은 계산**이다 — 두 벌로 만들지 않는다(M1)
   */
  srp: { srp: number; bf: number; skipped: number; srpPer9: number | null } | null;
  /** 선발 등판분. 선발이 0경기면 null */
  asStarter: RoleLine | null;
  /** 구원 등판분. 구원이 0경기면 null */
  asReliever: RoleLine | null;
}

/**
 * 연속 기록. ⚠**「지금 이어지는 중」과 「올해 최장」은 다른 값**이라 항상 둘 다 낸다.
 * 하나만 내면 어제 끊긴 기록이 오늘도 이어지는 것처럼 보인다.
 */
export interface StreakData {
  current: number;
  best: number;
  bestFrom: string | null;
  bestTo: string | null;
}

export interface StreakBlockData {
  hitting: StreakData;
  onBase: StreakData;
  hitless: StreakData;
  /** 센 경기 수. **분모다**(M2) */
  games: number;
  /**
   * 마지막으로 나온 경기일.
   * ⚠**「今」이 언제 기준인지 말하려면 이게 필요하다** — 없으면 석 달 전에 끝난 기록이
   * 지금 이어지는 것처럼 보인다(실측 21명).
   */
  lastGameDate: string | null;
}

/**
 * カウント別成績의 한 줄(2ストライク前 / 2ストライク後).
 *
 * ⚠**두 줄을 나란히 놓는 것이 이 블록의 뜻이다.** 하나만 내면 「.180 は低い」로 읽히는데,
 * 追い込まれてからの打率はリーグ全体で低い — 비교 대상이 옆에 있어야 값이 뜻을 갖는다.
 */
export interface CountSplitRow {
  label: string;
  line: BattingLine;
  avg: Rate;
  ops: Rate;
}

/**
 * カウント別 — **타석이 끝난 볼카운트**에서 나오는 값.
 *
 * ⚠**投球単位のデータではない.** 파울·헛스윙·투구 수는 여전히 모른다 —
 * 화면이 그 경계를 말한다(`countBlock` 의 각주).
 */
/** カウント別의 한 범위분. ⚠**시즌과 통산이 같은 모양을 쓴다** — 두 벌로 적으면 어긋난다(M1) */
export interface CountScope {
  /** 읽을 수 있었던 타석. ⚠**이 블록 전 비율의 분모다**(M2) */
  pa: number;
  /**
   * 읽지 못해 격리한 타석. ⚠**0이 아니면 화면이 그 수를 말한다**(M11) —
   * 분모에서 빠졌다는 사실을 숨기면 비율이 조용히 달라 보인다.
   */
  quarantined: number;
  twoStrike: Rate;
  firstPitch: Rate;
  fullCount: Rate;
  threeBall: Rate;
  rows: CountSplitRow[];
}

export interface CountBlockData extends CountScope {
  /**
   * 통산분. 보유가 한 시즌뿐이거나 통산이 시즌과 같으면 `null` — 그때 탭을 만들지 않는다.
   *
   * ⚠**왜 이 축에만 통산을 두는가**: 표본이 그렇다. 실측(2025 · 규정타석급 40명 · 칸 480)
   * 그 시즌만이면 **가장 작은 칸의 중앙 6타석 · 33.8%가 30타석 미만**이고,
   * 통산이면 **중앙 23타석 · 14.0%** 다. 볼카운트는 **9시즌 전 시즌 100% 보유**라
   * 통산이 결측을 섞지 않는다(**결측 0건** · 보유 전 시즌·전 대회 실측).
   *
   * ⚠**「通算」이라는 말만으로는 거짓이다** — `span` 이 있어야 화면이 범위를 말한다
   * (`火消し`·스플릿 통산 축과 같은 규칙).
   */
  career: (CountScope & { span: { from: number; to: number } }) | null;
}

/**
 * カウント별 블록에 그릴 것이 없는데 **그 이유가 「기록이 없다」가 아닐 때**.
 *
 * ⚠**타석은 있는데 볼카운트를 하나도 못 읽은 상태다**(M7 · 2026-08-20 최종 검토 ④).
 * 예전에는 이것이 `null` 과 같은 길로 흘러 화면이 「打席の記録がありません。」이라고 적었다 —
 * **그 문장은 그때 거짓이고, 격리한 수가 화면에 아예 나가지 않았다.**
 * ⚠**오늘은 일어나지 않는다**(실측 2026-08-20: `ball_count` NULL **0건** · 정의역 밖 **1건**,
 * 그 1건은 `2018/players/81785137.html` 에서 「カウント不明 1」로 제대로 뜬다).
 * 그런데 마이그레이션 008 이 NULL 을 허용해 뒀고 CLAUDE.md 가 소급 시즌의 품질 저하를 경고한다 —
 * **파서가 조용히 0을 흘리는 바로 그 모양**이라 상태를 미리 갈라 둔다.
 */
export interface CountUnreadable {
  /** 볼카운트를 못 읽어 격리한 타석. ⚠**1 이상이다**(0이면 이 상태가 아니다) */
  quarantinedOnly: number;
}

/** 火消し의 한 벌. 통산과 시즌이 같은 모양을 쓴다 */
export interface ReliefTotals {
  /** 이닝 도중 등판(주자 유무 불문) */
  midInning: number;
  /** 주자를 안고 한 이닝 도중 등판. ⚠**火消し率의 분모다** */
  inherited: number;
  inheritedRunners: number;
  doused: number;
}

/**
 * 火消し(継投引き継ぎ) — 투수 전용.
 *
 * ⚠**통산이 주역이다**(M3). 한 시즌으로는 1인당 4회 남짓이라 비율이 값이 아니라 소음이다.
 * 시즌 쪽은 **개수만** 낸다.
 */
export interface ReliefBlockData {
  /** 통산 범위. ⚠**화면이 「2018〜2026」이라고 말한다** — 「통산」이라는 말만으로는 거짓이다 */
  from: number;
  to: number;
  career: ReliefTotals;
  /** 보고 있는 시즌만. ⚠**비율을 내지 않는다** */
  season: ReliefTotals;
  /** 火消し率. 자격선 미만이면 null */
  dousedRate: Rate | null;
  /** 등판 시점 평균 득점기대치. RE 를 못 구했으면 분모가 줄어든다 */
  enteringRe: Rate;
  /** RE 행렬에 없어 세지 못한 등판. ⚠**0으로 때우지 않는다**(M11) */
  reMissing: number;
  /** 비율을 낼 수 있는 최소 引き継ぎ登板. **화면이 이 수를 적는다**(M3) */
  minForRate: number;
}

export type SplitAxisId =
  | "hand" | "base" | "homeAway" | "month" | "order" | "venue"
  /**
   * **상대 구단별.** ⚠**두 벌인 이유는 범위다** — `opponent` 는 그 시즌, `opponentCareer` 는
   * 보유 첫 시즌부터 **보고 있는 시즌까지**의 통산이다(`matchups` 와 같은 규칙).
   * ⚠**한 시즌 교류전은 최대 17타석**이라(2025 실측) 그 범위만으로는 비율이 성립하지 않는다.
   * 통산이면 같은 리그 중앙 30 · 교류전 중앙 9 로 올라온다.
   */
  | "opponent" | "opponentCareer";

export interface SplitRow {
  /** 원본 구분값(`2026-04` 등). **정렬은 라벨이 아니라 이걸로 한다** — 「10月」은 「4月」보다 앞에 온다 */
  key: string;
  label: string;
  line: BattingLine;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  rbi: number;
}

export interface SplitAxisData {
  id: SplitAxisId;
  label: string;
  /**
   * 투수의 스플릿인가. **값의 뜻이 반대다** — 타율이 아니라 피안타율이다.
   * 라벨을 「被~」로 바꾸는 데 쓴다.
   */
  allowed: boolean;
  rows: SplitRow[];
  /** 이 축으로 나눌 수 없었던 타석. **숨기지 않는다** */
  unclassified: number;
  /** 이 축에서 「얇다」고 볼 타석 수 */
  thinBelow: number;
  /**
   * 이 축이 **여러 시즌을 합쳐 세는** 경우 그 범위. 한 시즌만이면 `null`.
   *
   * ⚠**「통산」이라는 말만으로는 거짓이다** — 우리 통산은 **보유 범위 안**의 통산이고
   * NPB 가 공표하는 통산(선수의 실제 전 경력)과 다르다. `火消し` 가 이미 같은 규칙을 쓴다
   * (`ReliefBlockData.from`/`to` · 「화면이 2018〜2026 이라고 말한다」) — **여기서도 화면이 말한다.**
   */
  span: { from: number; to: number } | null;
  /**
   * **투수의 진짜 투구 성적**(등판·이닝·방어율·WHIP). **낼 수 있는 축에만** 붙는다.
   *
   * ⚠**축이 「경기 단위」일 때만 있다.** 자책점과 이닝은 **등판 전체에 붙은 수**라
   * 구단별·홈원정·구장별·월별처럼 **한 등판이 통째로 한 칸에 들어가는** 축에서만 합칠 수 있다.
   * 대좌우·주자상황·타순은 **한 등판이 여러 칸으로 갈리고**, 그때 이닝을 나누면 **지어낸 수**가 된다.
   *
   * ⚠**`null` 은 「0」이 아니라 「이 축에서는 낼 수 없다」**다(M11) — 화면이 그 사실을 말한다.
   * ⚠**키는 `SplitRow.key` 와 같아야 한다** — 다르면 조용히 짝이 안 맞아 빈 칸이 된다.
   */
  pitching: Map<string, PitchingSplitCell> | null;
}

/** 한 칸의 투구 성적. ⚠**이닝이 0 인 등판도 있다**(아웃 없이 강판) — 0 으로 감추지 않는다 */
export interface PitchingSplitCell {
  games: number;
  outs: number;
  er: number;
  h: number;
  hr: number;
  bb: number;
  so: number;
}

export interface ScorebookRow {
  date: string;
  /**
   * 그 경기 페이지의 슬러그. **여기서 만들지 않는다**(M1) — `gameSlug()` 한 벌이 만든다.
   * ⚠링크가 깨지면 빌드가 멈춘다(`link-check.ts`) — 조용히 404가 되는 길을 막아 둔 것이다.
   */
  gameSlug: string;
  opponent: string;
  inning: number;
  half: "top" | "bottom";
  outs: number;
  bases: string;
  outcome: string;
  rbi: number;
  /** 안타·홈런처럼 강조할 결과인가 */
  hit: boolean;
}

export interface SituationCell {
  bases: string;
  outs: number;
  /** 리그 득점기대치 */
  re: number | null;
  /** 이 선수가 그 상황에서 선 타석 수 */
  pa: number;
}

/**
 * 상대전적 한 줄. **타자 페이지에서는 상대가 투수, 투수 페이지에서는 상대가 타자**다 —
 * 같은 표를 양쪽에서 쓰므로 이름을 「상대」로 둔다.
 */
export interface MatchupRow {
  opponentId: string;
  opponentName: string;
  opponentTeam: string;
  line: BattingLine;
  avg: Rate;
  rbi: number;
  /**
   * **그 시즌 화면에 이 선수의 페이지가 없다.** 통산 대전에만 생긴다 — 은퇴하거나
   * 그해 1군 기록이 없는 상대다.
   *
   * ⚠**링크를 걸면 404 다.** 실측(2026 화면 · 통산 2018~2026):
   * 통산 대전에 나오는데 그 시즌 페이지가 없는 **투수 523명 · 타자 651명**.
   * ⚠**행을 지우지 않는다** — 그 대전은 실제로 있었다. **이름만 링크가 아니게 둔다.**
   */
  noPage?: true;
}

export interface RankingRow {
  rank: number | null;
  playerId: string;
  name: string;
  teamCode: string;
  value: Rate;
  isMe: boolean;
  /**
   * **전원 기준 순위** — 자격 기준을 걸지 않고 매긴 순위. 값이 없으면 null.
   *
   * ⚠**「規定到達のみ / 全員」 전환을 위해 두 순위를 함께 싣는다.** 클라이언트가
   * 다시 매기면 동률 규칙이 서버와 갈릴 수 있다(M3: 규칙이 곧 값이다) —
   * **같은 `rankBy` 한 벌**로 서버에서 두 번 매겨 둘 다 보낸다(M1).
   * ⚠개수 지표(홈런·탈삼진)에는 자격 기준이 없어 `rank` 와 같은 값이 된다.
   */
  rankAll: number | null;
}

export interface RankingPanel {
  id: string;
  label: string;
  digits: RankDigits;
  unit: string;
  /** 분모가 아웃 카운트면 true — 표기는 이닝으로 바꾼다 */
  denAsInnings: boolean;
  /**
   * **값 자체**가 아웃 카운트면 true(最多投球回). 표기는 이닝으로 바꾼다.
   *
   * ⚠분모와 값은 **다른 축이다.** 방어율은 분모만 아웃이고, 投球回 순위는 값도 아웃이다.
   * 하나의 깃발로 묶으면 327아웃이 「327回」로 나간다 — 분모가 3배로 부풀던 것과 같은 오류다.
   */
  valueAsInnings?: boolean;
  rows: RankingRow[];
  /**
   * **자르기 전** 규정 도달자 수. ⚠`rows.length` 로 세면 안 된다 —
   * `rows` 는 상위 N만 담고, 거기에 「전원」용 미달자까지 섞여 있다.
   * 화면의 「該当 N人」이 이 값을 쓴다(작업규칙 7: 자른 것을 말한다).
   */
  qualifiedCount: number;
  /** **자르기 전** 값이 있는 선수 수(자격 무관). 「全員」의 분모다 */
  allCount: number;
  /**
   * **어느 최소 표본을 넣어도 상위 몇 명까지 이 표에 있는가.**
   * ⚠**null 은 「0명」이 아니라 「최소 표본 입력이 없는 패널」이다**(M11) — 개수 지표
   * (홈런·세이브·도루)에는 자격 기준이 없어 입력칸 자체가 안 그려진다.
   *
   * ⚠**렌더러가 다시 판정하지 않는다**(M1 · 2026-08-20). 예전에는 화면이 **고른 뒤의 행**으로
   * 「입력칸을 붙일까」를 만들었는데, 그러면 고르기 결과에 따라 조작이 붙었다 안 붙었다 한다.
   */
  minTop: number | null;
  /**
   * **「全員」 기본 화면이 어디까지 이어지는가** — 그 마지막 행의 전원 순위.
   *
   * ⚠**순위가 뛰던 결함의 자리다**(2026-08-31 · 사용자 지적).
   * `rows` 는 **세 벌의 합집합**이라(규정 상위 N · 전원 상위 N · 최소표본 보장)
   * 「全員」으로 보면 **31 → 36 → 152 → 181 → 244** 처럼 건너뛴다 —
   * 규정 도달자인데 전원 순위가 한참 아래인 선수가 섞여 들어오기 때문이다.
   * **행은 다 맞는 행이고, 틀린 것은 「연속처럼 보인다」는 것**이었다.
   *
   * → 「全員」 기본 화면은 **여기까지만** 그린다(연속). 그 아래는 펼쳐야 나온다.
   * ⚠**동률 때문에 `<= 50` 으로 판정하면 안 된다** — 동률은 다음 순위를 건너뛰므로
   * 50명째의 순위가 50 보다 클 수 있다. **경계값 자체를 서버가 정해서 보낸다.**
   * ⚠**「규정 도달자만」 모드에는 그 아래 행도 필요하다** — 거기서는 규정 순위로 연속이다.
   * ⚠`null` 은 「값이 있는 선수가 없다」다(M11).
   */
  topAllCut: number | null;
  /**
   * **경계보다 아래의 전원 순위 행 — 전부.** 「もっと見る」가 이것을 쓴다.
   *
   * ⚠**HTML 로 그리지 마라.** 여기 담기는 것은 리그당 수백 행이고,
   * 표에 그대로 넣으면 이 화면이 **몇 배로 무거워진다** — 그래서 별도 JSON 으로 나간다
   * (`rankingRestFiles` · `site.ts`). 이 필드는 **그 파일을 만들 때만** 쓰인다.
   * ⚠**선수 페이지 블록에서는 빈 배열이다** — 거기엔 「全員」 전환이 없다.
   */
  rest: RankingRow[];
  /** 자격 기준 설명. **규칙이 곧 값이다**(M3) */
  qualifier: string;
}

/**
 * 표제 옆의 작은 꺾은선. **사진 대신 이 선수를 구별하는 표시**가 된다.
 *
 * ⚠**선수 사진은 쓰지 않는다.** 기록은 사실이라 저작물이 아니지만(CLAUDE.md §2-5 1층),
 * 사진은 촬영자의 저작물이고 선수의 초상권도 붙는다 — 「공개 정보」 논리가 닿지 않는다.
 * L5(공개된 직업활동 성적만) · L6(외부 노출은 파생값)에도 걸린다.
 * 대신 **우리가 계산한 값으로 만든 우리 그림**을 놓는다. 정보량도 사진보다 많다.
 */
export interface SparkPoint {
  label: string;
  value: number | null;
}

/**
 * 표제의 식별 마크(B안 成績の紋). **선수마다 모양이 다르고, 그 모양이 정보다.**
 * 축은 타자와 투수가 다르고, 표본이 없으면 포지션 한 글자로 대체한다.
 */
export interface MarkData {
  axes: ProfileAxis[];
  /**
   * 분모 표기. **이미 사람이 읽는 형태여야 한다**(`442打席` · `138.1回`).
   *
   * ⚠숫자와 단위를 따로 받지 않는다 — 투수 표본은 아웃 카운트라 `415アウト`가 되고,
   * 사이트의 다른 곳(이닝 표기)과 어긋난다. 어긋나는 경로를 타입에서 없앤다.
   */
  sampleText: string;
}

/**
 * 年度別成績 한 줄. **NPB 공표치**이고 우리가 경기에서 쌓은 값이 아니다(M4).
 *
 * ⚠**비율은 담지 않는다.** 우리가 다시 낸다(M1) — 그래야 사이트 안에서 계산이 한 벌이다.
 */
export interface CareerRow {
  year: number;
  /** 소속 구단 **원문**. 옛 구단명이 그대로 남는다 */
  team: string;
  /**
   * ⚠**출장 경기 수다 — 우리가 세는 「타석이 있던 경기」와 다르다.**
   * 대수비·대주자로만 나간 경기가 여기엔 들어가고 우리 쪽엔 안 들어간다.
   * 실측(2026-08-17): 끝난 시즌 1,777쌍 중 **569쌍(32.0%)이 어긋났고 전부 NPB 가 컸다**.
   * 이 열에 우리 값을 섞으면 안 된다.
   */
  games: number;
  /** 타자면 打席, 투수면 打者 */
  faced: number;
  /** 사람이 읽는 한 줄. ⚠**이미 분모를 품고 있다**(M2) */
  line: string;
  /** 정렬용 값들 */
  sort: Readonly<Record<string, number | null>>;
}

export interface CareerData {
  /** 타자표와 투수표 중 이 선수에게 있는 것 */
  batting: CareerRow[];
  pitching: CareerRow[];
  /** 뛴 시즌 수. ⚠**행 수가 아니다** — 이적하면 한 해에 여러 줄이다 */
  battingSeasons: number;
  pitchingSeasons: number;
  /** 통산 합계를 사람이 읽는 한 줄로. **우리가 더한 값**이다 */
  battingTotal: string | null;
  pitchingTotal: string | null;
  /** 첫 시즌·마지막 시즌 */
  from: number | null;
  to: number | null;
  /** M4: 어디서 왔는가 */
  source: string;
  /**
   * M4: **언제 받아온 것인가**(`YYYY-MM-DD`). 받은 적이 없으면 `null`.
   *
   * ⚠**화면에 낸다.** 이게 없어서 사고가 났다 — 선수 페이지를 한 번 받고 다시 안 받았는데
   * 화면 어디에도 그 사실이 없어서 **「NPB 가 늦다」고 오진**했고, 그 오진 위에
   * 두 출처를 이어 붙이는 코드를 얹었다(2026-08-17에 전부 되돌렸다).
   */
  asOf: string | null;
}

export interface PlayerPageData {
  /**
   * 목록·검색에 쓰는 한 줄 성적(`打率 .260（104打数）`). 값이 없으면 null.
   * ⚠**분모가 문자열 안에 들어 있다**(M2). 값만 떼어 쓰지 마라.
   */
  summary: string | null;
  playerId: string;
  name: string;
  season: number;
  /**
   * **이 시즌이 끝났는가** — 판정은 `query.ts` 의 `seasonIsOver` 한 벌이다(M1).
   *
   * ⚠**`true` 는 증명이고 `false` 는 「모른다」다**(M11). 이 페이지는 이 값을
   * **「今」을 막는 쪽으로만** 쓴다 — 끝난 시즌에 현재형으로 말하지 않기 위해서다.
   */
  seasonOver: boolean;
  teamCode: string;
  teamName: string;
  league: League;
  leagueName: string;
  color: TeamColor;
  position: string | null;
  throws: string | null;
  bats: string | null;
  /** 태어난 해. ⚠**월·일은 보관하지 않는다**(L5) — 화면이 쓰는 것이 연도뿐이다 */
  birthYear: number | null;
  physique: string | null;
  /**
   * 通算成績. 이 선수 페이지에 표가 없으면 null.
   * ⚠**출처가 다르다**(M4) — 우리가 경기에서 쌓은 다른 블록과 **같은 표에 섞지 마라**.
   */
  career: CareerData | null;
  /**
   * 드래프트 지명. `2000年ドラフト5位` **원문 그대로**(M4).
   *
   * ⚠**우리가 이미 받아 두던 선수 페이지에 있던 것**이고, 파서가 `pc_bio` 를 읽으면서도
   * 이 칸만 버리고 있었다(2026-08-17 · 아카이브 980장 중 980장에서 읽힌다).
   * ⚠**연도와 순위로 쪼개지 않는다** — `育成ドラフト` 가 섞여 있어 쪼개면 구별이 사라진다.
   */
  draft: string | null;
  /**
   * 등번호. ⚠**null은 「0번」이 아니라 「지금 등록이 없다」**(M11) — 은퇴·이적 선수다.
   * 그래서 없으면 「―」로 채우지 않고 **자리 자체를 만들지 않는다**.
   */
  uniformNumber: string | null;
  /** 어느 쪽 페이지로 만들 것인가. 투수도 타석에 서지만 주역은 하나다 */
  role: "batter" | "pitcher";
  batting: BattingBlockData | null;
  pitching: PitchingBlockData | null;
  splits: SplitAxisData[];
  scorebook: ScorebookRow[];
  /** 이 선수의 전체 타석 수. `scorebook`이 잘렸는지 말하기 위한 값 */
  scorebookTotal: number;
  situation: SituationCell[];
  /**
   * 상황별 번트의 득점기대값 변화. **리그 전체의 값**이다(이 선수의 기록이 아니다).
   * ⚠새 데이터가 0이다 — 이미 있는 득점기대값 계산기가 답한다.
   */
  bunts: BuntCell[];
  /**
   * 타순 순회별 성적. **NPB 전체의 값**이다(이 선수의 기록이 아니다).
   * ⚠개인 순위를 매기지 않는다 — 개인의 3순회 표본은 얇다.
   */
  timesThrough: TimesThroughRow[];
  matchups: MatchupRow[];
  /** 대전한 투수(또는 타자)의 총 수. `matchups`가 잘렸는지 말하기 위한 값 */
  matchupTotal: number;
  /**
   * 통산 대전(보유 첫 시즌 ~ 보고 있는 시즌)과 그 범위. 보유가 한 시즌뿐이면 `null`.
   *
   * ## ⚠왜 이 축은 붙이고 球場別은 안 붙였는가 — **지표를 두 번 골랐다**
   *
   * 처음에 다른 축과 같은 잣대(**얇은 칸의 비율**)로 재고 「통산이 못 고친다」고 판정했다:
   * 화면 임계(10타석) 미만이 **今季 91.6% → 通算 82.0%** 이고 **대전 타석 중앙값은 3으로 그대로**다.
   * 상대 투수가 매년 바뀌어, 깊어지는 만큼 얕은 새 쌍이 늘기 때문이다.
   *
   * ⚠**그 지표가 질문에 답하지 않았다.** 이 표는 **분모를 달고 얇은 행을 그대로 싣는** 표라
   * 「얇은 행의 비율」은 애초에 결함이 아니다. 물어야 할 것은
   * **「시즌 화면에 원리적으로 존재할 수 없는 행이 생기는가」**였다. 실측(2025 · 규정타석급 40명):
   *
   * | 30타석 이상인 대전 | 今季 | 通算 |
   * |---|---|---|
   * | 행 수 | **0** | **382** |
   * | 타자당 중앙 | 0 | **7** |
   * | 한 행도 없는 타자 | **40/40** | 11/40 |
   * | 한 쌍 최대 타석 | **27** | **105** |
   *
   * **今季는 한 쌍 최대가 27타석이라 30을 넘는 행이 하나도 없다.** 통산에서만 존재한다.
   *
   * ⚠**바이트 걱정은 압축 전 수였다.** 통산은 행이 **4.66배**(23,117 → 107,665)이지만,
   * 가장 큰 선수 페이지 실측이 **178.7 KB → gzip 22.0 KB(8.1배)** 다 — 반복이 많은 표라
   * 전송량은 **+30 KB 남짓**이다. Pages 상한은 **파일 수**이고 이 변경은 파일을 안 늘린다.
   */
  matchupsCareer: { rows: MatchupRow[]; span: { from: number; to: number } } | null;
  ranking: RankingPanel[];
  /** 표제의 식별 마크 */
  mark: MarkData;
  /** 월별 추이. 표제 옆의 꺾은선이 된다 */
  spark: SparkPoint[];
  /** 그 꺾은선이 무엇인지 (`月別OPS` 등) */
  sparkLabel: string;
  /** 연속 기록. 타자만. 타석이 하나도 없으면 null */
  streaks: StreakBlockData | null;
  /**
   * カウント別成績. 타석 로그가 하나도 없으면 null(M12 — 화면이 「모름」을 낸다).
   * ⚠**타자·투수 양쪽에 있다** — 같은 타석 로그를 반대편에서 읽은 값이다.
   * ⚠**「없음」과 「못 읽음」은 다른 상태다**(M7·M12) — `CountUnreadable` 을 보라.
   */
  count: CountBlockData | CountUnreadable | null;
  /**
   * 火消し. **투수만.** 이닝 도중 등판이 한 번도 없으면 null.
   * ⚠**null 은 「0회」가 아니라 「이 블록을 그릴 근거가 없다」**로 쓴다(M11) —
   *   화면은 그때 「該当なし」라고 적는다.
   */
  relief: ReliefBlockData | null;
  /** 반영 기준 경기일 */
  asOf: string | null;
  /**
   * 시즌 중에 소속이 바뀌었으면 그 내역. 안 바뀌었으면 빈 배열.
   *
   * ⚠**합계만 보여주면 거짓말이 된다.** 이 페이지의 성적은 **시즌 합계**인데,
   * 순위표는 NPB 관례대로 **리그별로 나눠** 센다 — 두 화면의 수가 다른 이유가
   * 여기 적혀 있지 않으면 「어느 쪽이 맞지?」가 된다.
   * 실측(2026): 山本는 DeNA 105타석 · ソフトバンク 97타석으로 리그를 넘어 옮겼다.
   */
  stints: PlayerStint[];
  /**
   * ポストシーズン 요약. 없으면 빈 배열.
   * ⚠**위의 시즌 성적에 포함되지 않는다**(§2-1) — 화면이 그렇게 적는다.
   */
  postseason: PostseasonBrief[];
}

/** 한 소속에서의 출장. 시즌 중 이적한 선수만 둘 이상이 된다 */
export interface PlayerStint {
  teamCode: string;
  teamName: string;
  leagueName: string;
  games: number;
  /** 타자는 타석, 투수는 아웃 카운트 */
  sample: number;
  sampleText: string;
  /** 이 소속에서의 마지막 출장일. **화면은 시간 순으로 잇는다** */
  lastDate: string;
}

// ⚠**타입은 `layout.ts` 한 벌만 둔다.** 세 곳에 두면 필드를 늘릴 때마다 세 곳을 고친다
export type { RenderContext } from "./layout.ts";
import type { RenderContext } from "./layout.ts";

const POSITION_MARK: Readonly<Record<string, string>> = {
  投手: "投",
  捕手: "捕",
  内野手: "内",
  外野手: "外",
};

/**
 * 포지션 한 글자. 표제의 마크와 색인 목록이 **같은 규칙**을 써야 한다(M1의 정신) —
 * 두 곳에 적으면 언젠가 어긋나고, 그때는 어느 쪽이 맞는지 알 수 없다.
 * @param fallback 포지션을 모를 때 낼 문자
 */
export function positionMark(position: string | null, fallback = ""): string {
  if (position === null || position === "") return fallback;
  return POSITION_MARK[position] ?? position.slice(0, 1);
}

const BASE_LABEL: Readonly<Record<string, string>> = {
  "-": "走者なし",
  "": "走者なし",
  "1": "一塁",
  "2": "二塁",
  "3": "三塁",
  "12": "一二塁",
  "13": "一三塁",
  "23": "二三塁",
  "123": "満塁",
};

const BASE_ORDER = ["-", "1", "2", "3", "12", "13", "23", "123"];

/**
 * 표본이 이보다 적은 칸은 시각적 무게를 뺀다. 값은 그대로 보인다.
 *
 * ⚠**정의서(`docs/metrics/README.md` §5-A)가 이 수를 그대로 싣는다** — 그래서 내보낸다.
 * 문서에는 「좌우 상대 **100타석**(잠정)」이라고 적혀 있었고 코드는 30/10/10 이었다
 * (2026-08-20 정정). 문서와 코드가 갈리는 것을 막는 유일한 방법은 **시험이 둘을 맞대는 것**이다
 * (`packages/web/test/thin-thresholds.test.ts`).
 */
export const THIN_SITUATION_PA = 10;
export const THIN_MATCHUP_PA = 10;
/** 선수 페이지 순위표에 싣는 상위 인원. `query.ts`와 같은 값이어야 한다 */
const RANKING_TOP = 10;

/**
 * 월별 추이 꺾은선.
 *
 * ⚠**축을 그리지 않는다.** 눈금 없는 선은 「값」이 아니라 **모양**이고, 정확한 값은
 * 스플릿 블록에 분모와 함께 있다. 여기서 읽히면 안 되는 것을 읽히게 만들지 않는다.
 */
function sparkline(points: readonly SparkPoint[], label: string): RawHtml {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length < 2) return raw("");

  const w = 108;
  const h = 26;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = w / (points.length - 1);

  const coords = points.map((p, i) => ({
    x: i * step,
    y: p.value === null ? null : h - ((p.value - lo) / span) * h,
  }));
  const line = coords
    .filter((c): c is { x: number; y: number } => c.y !== null)
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const last = [...coords].reverse().find((c) => c.y !== null);

  return html`<div class="spark">
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="${label}：${points.map((p) => `${p.label} ${p.value === null ? "なし" : p.value.toFixed(3)}`).join("、")}">
    <polyline points="${line}" fill="none" stroke="var(--team,#6b7280)" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${last === undefined ? null : html`<circle cx="${last.x.toFixed(1)}" cy="${last.y!.toFixed(1)}" r="2.4" fill="var(--team,#6b7280)"></circle>`}
  </svg>
  <span class="sl">${label}　${points[0]?.label ?? ""}→${points.at(-1)?.label ?? ""}</span>
</div>`;
}

function idLine(d: PlayerPageData, base: string): RawHtml {
  const who: MarkPlayer = {
    playerId: d.playerId,
    name: d.name,
    teamName: d.teamName,
    color: d.color,
    positionMark: positionMark(d.position, "—"),
  };
  // ⚠성적이 없는 선수를 아주 작은 도형으로 그리지 않는다 — 「나쁘다」로 읽힌다(M11)
  const empty = isEmptyProfile(d.mark.axes);
  const svg = empty
    ? markLetter(who, who.positionMark, 52)
    : markProfile(who, d.mark.axes, d.mark.sampleText, 52);
  // 성적이 없으면 열 것도 없다 — 눌리는 척하는 버튼을 만들지 않는다
  const mark = empty
    ? html`<span class="mark">${svg}</span>`
    : html`<button class="mark markbtn" type="button" id="markBtn"
        aria-expanded="false" aria-controls="markPanel">${svg}<span class="mkcap">くわしく</span></button>`;

  // ⚠**구단명만 링크로 떼 낸다.** 나머지는 지금까지처럼 「 · 」로 이은 글자다 —
  // 배번·포지션·투타는 갈 곳이 없고, 없는 사람에게는 항목째 빠진다(M11).
  const bio = [
    // ⚠**등번호는 팀명 옆이다.** 야구에서 「구단 + 배번」이 한 덩어리로 읽히고,
    // 없는 사람에게는 이 항목이 아예 빠진다(M11) — 「―」를 넣으면 은퇴가 결손처럼 보인다
    d.uniformNumber === null ? null : `背番号 ${d.uniformNumber}`,
    d.position ?? "ポジション不明",
    throwsBats(d.throws, d.bats),
    d.birthYear === null ? null : `${d.birthYear}年生`,
    d.physique,
    // ⚠**맨 뒤에 둔다.** 이 줄은 「지금 이 선수가 누구인가」를 먼저 말하는 자리이고,
    // 드래프트는 **어디서 왔는가**라 그 다음이다. 없으면 항목째 빠진다(M11)
    d.draft,
  ].filter((s): s is string => s !== null && s !== "" && s !== NO_VALUE);

  return html`<header class="idline">
  ${mark}
  <div class="idtext">
    <h1 class="nm">${d.name}<!-- ⚠**계정 없이 되는 것만 만든다.** 이 표시는 이 브라우저에만 남고
      서버로 가지 않는다. 스크립트가 없으면 버튼 자체를 띄우지 않는다 —
      눌러도 아무 일이 없는 버튼을 두는 것보다 없는 편이 정직하다 -->
      <button class="favbtn" type="button" id="favBtn" data-fav="${d.playerId}"
        aria-pressed="false" aria-label="お気に入りに入れる" hidden>★</button></h1>
    <span class="sub">${teamLink(base, d.teamCode, d.teamName)}${bio.length === 0 ? null : raw(" · ")}${bio.join(" · ")}</span>
    <span class="asof">${d.season}年${d.asOf === null ? "" : ` · ${gameDate(d.asOf)}まで`}</span>
    ${d.stints.length < 2
      ? null
      : html`<span class="stint">${d.stints
          .map((t) => `${t.teamName}${t.games}試合`)
          .join(" → ")}<em>${
            // ⚠**수가 두 종류인 이유를 여기서 말한다.** 이 줄의 존재 이유가 그것이다.
            // 아래 성적은 시즌 합계이고 順位는 소속 리그에서 낸 몫으로만 매긴다(NPBの規定) —
            // 적지 않으면 「어느 쪽이 맞지?」가 된다
            `成績は今季の合計。順位は${d.stints.at(-1)!.leagueName}での${d.stints.at(-1)!.sampleText}で計算`
          }</em></span>`}
  </div>
  ${sparkline(d.spark, d.sparkLabel)}
</header>
${empty ? raw("") : markPanel(who, d.mark.axes, d.mark.sampleText)}`;
}

/**
 * 확대한 紋과 항목별 판독부.
 *
 * ⚠**판독부를 다섯 벌 전부 그려 두고 하나만 보인다.** 클라이언트가 글자를 만들지 않는다 —
 * 설명은 용어집에서 오고(M1), 그것을 빌드 시점에 심어 두면 스크립트가 죽어도 값이 남는다.
 * ⚠**분모를 값에서 떼지 않는다**(M2). 축마다 분모가 다르므로 축이 자기 분모를 들고 온다.
 */
function markPanel(who: MarkPlayer, axes: readonly ProfileAxis[], sampleText: string): RawHtml {
  return html`<section class="markpanel" id="markPanel" hidden aria-label="成績プロフィール">
  <div class="mkfigwrap">${markFigure(who, axes, sampleText)}</div>
  <div class="mkside">
    <div class="tabs" role="group" data-markpick aria-label="項目を選ぶ">
      ${axes.map(
        (a, i) => html`<button class="tab" type="button" data-axis="${i}" aria-pressed="${i === 0 ? "true" : "false"}">${a.label}</button>`,
      )}
    </div>
    ${axes.map((a, i) => {
      const t = termOf(a.term);
      return html`<div class="mkread" data-axisread="${i}" ${raw(i === 0 ? "" : "hidden")}>
        <b>${a.label}</b>
        <em>${a.text}<span class="den">${a.sample}</span></em>
        <!-- ⚠**용어집 문장은 어디서 그리든 같은 강조 규칙을 탄다**(M1 · 2026-08-20 최종 검토 ①).
             여기만 순수 텍스트로 두면 short/how 에 별표를 쓴 날 그 별표가 글자로 찍힌다 —
             툴팁이 정확히 그 모양으로 6,333/15,340장에서 깨져 있었다 -->
        <p>${t === undefined ? "" : emphasize(t.short)}</p>
        ${a.note === "" ? null : html`<p class="mr-note">${a.note}</p>`}
        ${t?.how === undefined ? null : html`<p class="mr-how">${emphasize(t.how)}</p>`}
      </div>`;
    })}
    <p class="note">形は${sampleText}ぶんの成績です。<b>外側ほど良い</b>ように描いています。
      目盛りは引いていません — 正確な数字はこの欄と基本成績にあります。</p>
  </div>
</section>`;
}

function rail(d: PlayerPageData): RawHtml {
  const presets = presetsFor(d.role);
  return html`<div class="rail" role="group" aria-label="表示の切り替え">
  <span class="lbl">構成</span>
  ${presets.map(
    (p) => html`<button class="tab" type="button" data-preset="${p.id}" aria-pressed="${p.id === "standard" ? "true" : "false"}">${p.name}</button>`,
  )}
  <button class="tab" type="button" id="editBtn" aria-pressed="false" aria-controls="editor">組み替え</button>
  <span class="grow"></span>
  <span class="lbl">密度</span>
  <button class="tab" type="button" data-density="normal" aria-pressed="true">標準</button>
  <button class="tab" type="button" data-density="compact" aria-pressed="false">高密度</button>
</div>
${gradeLegend(
    d.role === "pitcher" ? (d.pitching?.role ?? "starter") : "batter",
  )}`;
}

function editor(): RawHtml {
  return html`<section class="editor" id="editor" hidden aria-label="ブロックの組み替え">
  <!-- ⚠**h2 다. h3 로 두면 헤딩이 h1 → h3 → h2 로 흐른다** — 이 편집 패널이 첫 콘텐츠 블록보다
       앞에 있기 때문이다. 레벨을 건너뛰면 스크린리더의 목록에서 이 패널이 페이지 제목의
       바로 아래 자식처럼 보인다(2026-08-17 이중 검토 지적) -->
  <h2>ブロックの組み替え</h2>
  <p>表示するブロックと並び順を決めます。設定はこの端末に保存されます。</p>
  <div class="blocks" id="blockList"></div>
  <div class="fixed-note">
    <b>消せない表示があります。</b>比率の横の母数（打席数・打数・出塁機会など）は設定で消せません。
    10打席の .400 を順位として見せないための決まりで、好みの問題ではないからです。
  </div>
</section>`;
}

// ─── 블록 ────────────────────────────────────────────────────────────────

/**
 * 자격 표시.
 *
 * ⚠**「順位はつきません」로 끝내면 화면과 어긋난다.** 본루타·탈삼진 같은 누계 지표에는
 * 자격 기준이 걸리지 않아 미달자에게도 순위 배지가 붙는다. 무엇에 안 붙는지 말한다.
 */
function qualifierText(qualified: boolean, have: number, need: number, unit: string): string {
  return qualified
    ? `規定到達（${have}${unit} / ${need}${unit}）`
    : `規定未満（${have}${unit} / ${need}${unit}）— 率の指標には順位がつきません`;
}

/**
 * 走塁の内訳 — **루별 도루 · 견제사 · 더블스틸**.
 *
 * ⚠**`runner_event.base` 와 `double_steal` 은 저장만 되고 읽는 코드가 0곳이었다**(2026-08-20).
 *
 * ⚠**표를 둘로 나눈다 — 열 이름이 같아도 뜻이 다르기 때문이다.**
 * 도루의 루는 **노린 루**(`二塁盗塁成功`), 견제사의 루는 **있던 루**(`一塁牽制アウト`)다.
 * 한 표에 넣으면 「一塁」 줄이 「1루를 훔치려다 잡혔다」로 읽히는데 그런 일은 일어나지 않는다.
 *
 * ⚠**뭉치면 사라지는 사실이 있다.** **2018〜2025** 정규시즌 실측(2026-08-20 ·
 * ⚠**완결 시즌만 적는다** — 진행 중 시즌을 넣으면 이 주석이 경기마다 낡는다):
 * 도루는 2루 6,877 · 3루 267 · 본루 **44** 인데 도루자는 2루 2,998 · 3루 117 · 본루 **142** 다 —
 * **본루만 실패가 성공의 3배**다. 성공률 하나로 내면 이 사실이 총계에 묻힌다.
 *
 * ⚠**기도가 있는 루만 그린다**(`battedBallRow` 와 같은 판단) — 0만 늘어선 줄은 정보가 아니다.
 *
 * ⚠**HTML 주석에 화면 낱말을 그대로 쓰지 마라.** 주석은 산출물에 남으므로,
 * 「그 낱말이 없다」를 확인하는 시험을 조용히 거짓으로 만든다 — 이 블록을 만들면서
 * 실제로 한 번 밟았다(`未集計` 를 주석에 썼더니 시험이 붉어졌다).
 * 같은 이유로 이 파일의 시험도 낱말이 아니라 `<th>` 로 좁혀서 센다.
 */
function stealDetail(s: NonNullable<BattingBlockData["steal"]>): RawHtml {
  // 도루도 견제사도 없으면 그릴 것이 없다. ⚠**빈 표를 그리면 「기록이 없다」로 읽힌다**(M12)
  if (s.byBase.length === 0 && s.pickoffByBase.length === 0) return raw("");
  const stolen = s.byBase.length === 0
    ? raw("")
    : html`${scroller(html`<table aria-label="狙った塁ごとの盗塁成績">
      <thead><tr>
        <th class="l">狙った塁</th><th>企図</th><th>盗塁</th><th>${term("盗塁刺")}</th><th>${term("盗塁成功率")}</th>
      </tr></thead>
      <tbody>${s.byBase.map(
        (r) => html`<tr>
        <td class="l">${r.label}</td>
        <td class="b">${r.rate.denominator}</td>
        <td>${r.sb}</td>
        <td>${r.cs}</td>
        <!-- ⚠**분모를 값에 붙인다**(M2). 옆의 「企図」 열과 같은 수이지만, 값만 떼어
             다른 화면에 실릴 때 분모가 따라가야 한다 -->
        <td class="wd">${valueWithDen(r.rate, denUnit("stealRate"), 3)}</td>
      </tr>`,
      )}</tbody>
    </table>`)}`;
  const pickoffs = s.pickoffByBase.length === 0
    ? raw("")
    : html`${scroller(html`<table aria-label="いた塁ごとの牽制死">
      <thead><tr><th class="l">いた塁</th><th>${term("牽制死")}</th></tr></thead>
      <tbody>${s.pickoffByBase.map(
        (r) => html`<tr><td class="l">${r.label}</td><td class="b">${r.n}</td></tr>`,
      )}</tbody>
    </table>`)}`;
  /**
   * ⚠**각주가 그 페이지에 실제로 그려진 것만 말한다**(2026-08-20 이중 검토 P1).
   *
   * 처음에는 표가 몇 개든 늘 같은 문장을 냈다. 실측: 각주가 실린 선수 페이지 **1,808장 중**
   * 두 표가 다 있는 것은 **385장**뿐이고 **1,373장은 도루 표만 · 50장은 견제사 표만**이다.
   * 그런데 「**塁の意味が2つの表で違います**」라고 썼다 — 표가 하나뿐인 1,423장(79%)에서 거짓이다.
   * 本盗 설명도 마찬가지로 **1,633장(90%)에는 本盗 행이 아예 없는데** 실리고 있었다.
   * ⚠**이번 커밋이 고친 `105試合`(수는 맞는데 낱말이 거짓)과 같은 종류다** — 화면이 자기 구조를
   * 틀리게 설명하는 것도 M2 의 정신에 어긋난다.
   */
  const both = s.byBase.length > 0 && s.pickoffByBase.length > 0;
  const hasHome = s.byBase.some((r) => r.base === "home");
  return html`${stolen}${pickoffs}
  ${columns(html`${statCount("ダブルスチール", s.doubleSteal)}`)}
  ${note(
    (both
      ? "⚠**塁の意味が2つの表で違います。** 盗塁は**狙った塁**、牽制死は**いた塁**です。"
      : s.byBase.length > 0
        ? "表の「塁」は**狙った塁**です。"
        : "表の「塁」は**いた塁**です（牽制でアウトになったときにいた塁）。") +
      (s.byBase.length > 0
        ? "**牽制死は盗塁成功率の分母に入りません**（NPBの記録で盗塁刺とは別のためです）。"
        : "**牽制死は盗塁刺とは別の記録**で、盗塁成功率の分母には入りません。") +
      "**ダブルスチールは盗塁の内数**で、1回のダブルスチールは走者2人分として数えられるため、" +
      "ここに出るのはこの選手が関わった盗塁の数です。" +
      /**
       * ⚠**리그 전체의 수치는 本盗 행이 있는 페이지에만 낸다**(2026-08-20 이중 검토 P1).
       *
       * ⚠**예전에는 이 수를 소스에 박아 뒀다** — 「9シーズンで成功47・盗塁刺146…40はダブルスチール」.
       * 그러면 **경기가 하나 늘 때마다 사람이 고쳐야** 하고, 안 고치면 배포물 **175장**이
       * 한꺼번에 거짓 숫자를 말한다(실측 · 走塁 각주 자체는 1,808장이고 그중 本盗 행이 있는 몫이다). 실제로 08-19 경기가 들어오자 시험이 붉어졌고,
       * **시즌 중에는 매일 그렇게 된다** — 지속 가능한 구조가 아니었다(2026-08-20).
       * → **DB 에서 읽는다.** 사람이 안 고쳐도 화면이 늘 참이다.
       * ⚠**「3倍」도 박지 않는다** — 비율이 바뀌면 그것도 거짓이 되므로 값에서 만든다.
       * ⚠**범위를 같이 적는다**(M2). 「9シーズン」은 몇 년인지 안 말한다 —
       *   백필하면 그 낱말만 낡고, 읽는 사람은 알아챌 방법이 없다.
       */
      (hasHome && s.leagueHome !== null && s.leagueHome.sb + s.leagueHome.cs > 0
        ? "⚠**本盗はリーグ全体でもめったに起きません** — 当サイトが持つ" +
          `${s.leagueHome.from}〜${s.leagueHome.to}年のレギュラーシーズンで` +
          `成功${s.leagueHome.sb}・盗塁刺${s.leagueHome.cs}` +
          // ⚠**성공이 0이면 「N倍」를 만들지 않는다**(M11) — 0으로 나눈 수를 화면에 내지 않는다
          (s.leagueHome.sb > 0
            ? `と、**失敗のほうが${(s.leagueHome.cs / s.leagueHome.sb).toFixed(1)}倍多い**プレーです。`
            : "で、**成功例がありません**。") +
          "1回の成否から傾向は読めません。" +
          /**
           * ⚠**성공이 0이면 이 문장을 안 낸다**(2026-08-21 최종 검토 P3).
           * 바로 앞이 「成功例がありません。」인데 뒤에 「また成功**0**のうち**0**はダブルスチール…」이
           * 그대로 붙어서 **없는 것의 내역을 말하는 문장**이 됐다.
           * ⚠**지금 데이터로는 안 밟힌다** — 그래서 더 위험하다. 밟히는 것은
           * **보유 시즌이 1개인 DB**(초기 구축 · 개막 직후)이고, 그건 이 리포가 실제로 지나온 상태다.
           */
          (s.leagueHome.sb > 0
            ? `また成功${s.leagueHome.sb}のうち${s.leagueHome.doubleSteal}はダブルスチールの一部でした。`
            : "")
        : ""),
  )}`;
}

function standardBatting(b: BattingBlockData): RawHtml {
  return block({
    id: "standard",
    title: "基本成績",
    qualifier: qualifierText(b.qualified, b.line.pa, b.needPa, "打席"),
    body: html`${columns(
      /**
       * ⚠**분모 단위를 여기서 쓰지 않는다**(M1 · 2026-08-20). 화면마다 적었더니
       * 같은 지표가 화면에 따라 다른 단위로 나갔고, 出塁率은 **아예 사실이 아닌 단위**였다:
       * `打席` 라고 썼지만 분모는 `打数+四球+死球+犠飛`(= 打席 − 犠打)라
       * **한 화면에 「打席」이 두 개** 떴다 — 실측(dist/players/41445153.html 中野拓夢)에서
       * 打席 열 **434** 옆에 出塁率 분모 **414**. 2026 정규 타자 617명 중 **205명**이 이 상태였다.
       */
      html`${statRate("打率", b.avg, denUnit("avg"), 3, rk(b.ranks, "avg"))}
        ${statRate("出塁率", b.obp, denUnit("obp"), 3, rk(b.ranks, "obp"))}
        ${statRate("長打率", b.slg, denUnit("slg"), 3, rk(b.ranks, "slg"))}
        ${statRate("OPS", b.ops, denUnit("ops"), 3, rk(b.ranks, "ops"))}`,
      html`${statCount("試合", b.games)}
        ${statCount("打席", b.line.pa)}
        ${statCount("打数", b.line.ab)}
        ${statCount("安打", b.line.h, rk(b.ranks, "h"))}`,
      html`${statCount("二塁打", b.line.double)}
        ${statCount("三塁打", b.line.triple)}
        ${statCount("本塁打", b.line.hr, rk(b.ranks, "hr"))}
        ${statCount("打点", b.rbi, rk(b.ranks, "rbi"))}`,
      html`${statCount("得点", b.runs)}
        ${statCount("盗塁", b.sb, rk(b.ranks, "sb"))}
        ${statCount("四球", b.line.bb)}
        ${statCount("死球", b.line.hbp)}`,
      /**
       * ⚠**併殺打는 §2-2 카탈로그의 항목인데 사이트 전체 출현이 0회였다**(2026-08-20 실측).
       * ⚠**`null` 은 「0」이 아니다**(M11) — `statCount` 가 `null` 을 `—` 로 낸다.
       *   0으로 때우면 「병살이 한 번도 없는 타자」라는 거짓이 된다.
       * ⚠자리는 三振 다음이다 — 「타석이 나쁘게 끝난 방식」끼리 모아 둔다.
       *   순서의 정본은 `metric-order.ts` 이고 거기서도 `so` 다음이다.
       */
      html`${statCount("三振", b.line.so)}
        ${statCount("併殺打", b.gidp)}
        ${statCount("犠飛", b.line.sf)}
        ${statCount("犠打", b.line.sh)}
        ${statCount("敬遠", b.line.ibb)}`,
      /**
       * 走塁。⚠**이 단이 존재하는 이유는 분모다**(M2) — 박스스코어는 `盗塁` 만 주므로
       * 지금까지 화면은 「30도루」라고만 말할 수 있었다. 40번 시도해 30번 성공한 것과
       * 33번 시도해 30번 성공한 것이 같은 표시가 됐다.
       * ⚠**견제사는 성공률의 분모가 아니다** — NPB 기록에서 牽制死 는 盗塁刺 가 아니다.
       *   따로 세서 따로 보여준다.
       */
      b.steal === null
        // ⚠**「—」가 아니라 「未集計」다.** 「—」는 0으로도 읽히고, 여기서 0은 거짓이다(M12)
        ? html`${statText("盗塁刺", "未集計")}
          ${statText("盗塁成功率", "未集計")}
          ${statText("牽制死", "未集計")}`
        : html`${statCount("盗塁刺", b.steal.cs)}
          ${statRate("盗塁成功率", b.steal.rate, denUnit("stealRate"), 3)}
          ${statCount("牽制死", b.steal.pickoff)}`,
    )}
    <!-- ⚠**총계를 세지 못했으면 내역도 내지 않는다** — 합이 안 맞는 화면이 된다 -->
    ${b.steal === null ? raw("") : stealDetail(b.steal)}`,
  });
}

/** 역할 이름. 화면에서 **하나의 표기만** 쓴다 — 「中継ぎ」와 「救援」이 섞이면 다른 말로 읽힌다 */
export const ROLE_LABEL: Readonly<Record<"starter" | "reliever", string>> = {
  starter: "先発",
  reliever: "救援",
};

/**
 * 자격선 설명. **선발은 NPB 공식 기준, 구원은 우리 기준**이라 문장이 달라야 한다.
 *
 * ⚠자체 기준을 공식 기준과 같은 얼굴로 내보내면 「NPB가 그렇게 정했다」는 오해가 생긴다.
 */
function pitcherQualifierText(p: PitchingBlockData): string {
  // ⚠**잘라 쓰면 두 수가 같아져 「35回 / 35回 … 未満」가 된다**(감사 실측 12건).
  // 이닝 표기는 `innings()` 한 벌이 정본이다(M1) — 위 `query.ts` 의 같은 주석 참조.
  const have = innings(p.line.outs);
  const need = innings(p.needOuts);
  const basis =
    p.role === "starter"
      ? "規定投球回（NPB公式）"
      : "当サイトの救援基準（規定投球回の3分の1）";
  return p.qualified
    ? `${basis}到達（${have}回 / ${need}回）`
    : `${basis}未満（${have}回 / ${need}回）— 率の指標には順位がつきません`;
}

function standardPitching(p: PitchingBlockData): RawHtml {
  const d = p.decisions;
  return block({
    id: "standard",
    title: "基本成績",
    qualifier: pitcherQualifierText(p),
    body: html`${columns(
      html`${statRateOuts("防御率", p.era, 2, rk(p.ranks, "era"), p.role)}
        ${statRateOuts("WHIP", p.whip, 2, rk(p.ranks, "whip"), p.role)}
        ${statText("投球回", innings(p.line.outs))}
        ${statCount("試合", p.games)}`,
      html`${statCount("勝", d.w, rk(p.ranks, "w"))}
        ${statCount("敗", d.l)}
        ${statCount("セーブ", d.sv, rk(p.ranks, "sv"))}
        ${statCount("ホールド", d.hld, rk(p.ranks, "hld"))}`,
      html`${statCount("先発", p.starts)}
        ${statCount("救援", p.games - p.starts)}
        ${statCount("HP", d.hld + d.reliefW, rk(p.ranks, "hp"))}
        ${statCount("対戦打者", p.line.bf)}`,
      html`${statCount("被安打", p.line.h)}
        ${statCount("被本塁打", p.line.hr)}
        ${statCount("与四球", p.line.bb)}
        ${statCount("与死球", p.line.hbp)}`,
      html`${statCount("奪三振", p.line.so, rk(p.ranks, "so"))}
        ${statCount("失点", p.line.r)}
        ${statCount("自責点", p.line.er)}`,
      html`${statCount("投球数", p.pitches, rk(p.ranks, "pitches"))}
        ${statRateOuts("球数/アウト", p.pitchesPerOut, 2, null, p.role)}
        ${statCount("暴投", p.wp)}
        ${statCount("ボーク", p.balk)}`,
    )}
    ${p.quality.starts === 0
      ? raw("")
      : html`${columns(
        html`${statRate("QS率", { value: p.quality.qs / p.quality.starts, denominator: p.quality.starts }, "先発", 3, null /* ⚠QS率의 순위는 만들지 않는다 — 없는 키를 넘기면 배지가 영원히 안 붙는다 */, "starter")}
          ${statCount("QS", p.quality.qs, rk(p.ranks, "qs"))}`,
        html`${statCount("HQS", p.quality.hqs)}
          ${statCount("完投", p.quality.cg)}
          ${statCount("完封勝", p.quality.sho)}`,
      )}
      ${note(
        "QS は先発して6回以上を自責点3以内、HQS は7回以上を自責点2以内です。" +
          "**完投は「その試合でその球団の投手がこの1人だけ」で数えています** — " +
          "アウト27個で数えると、ホームが勝って9回裏がなかった試合のビジター先発（8回完投）が漏れます。" +
          "完封勝は完投・無失点・勝利投手のすべてを満たしたものです。",
      )}`}
    ${note(
      `この投手は${ROLE_LABEL[p.role]}として扱っています（先発${p.starts}試合 / 救援${p.games - p.starts}試合、` +
        `投球回の多いほうを役割としています）。順位も水準の色も${ROLE_LABEL[p.role]}投手の分布と比べたものです — ` +
        `先発と救援では防御率の分布が違うためです。` +
        /**
         * ⚠**「ない」ことに理由を書く**(M11·M12 · 2026-08-20).
         * 救援投手には勝率の順位を出していないのだが、その理由がどこにも書かれていなかった —
         * 유저에게는 **「없는 것」과 「빠뜨린 것」이 구별되지 않는다.**
         * 판단 자체는 `query.ts` 의 `metricsFor` 에 적혀 있었다(자격선이 NPB 것이 아니다).
         */
        (p.role === "reliever"
          ? "⚠**救援投手には勝率の順位をつけていません**（出していないのであって、抜けているのではありません） — " +
            "最高勝率はNPBの規定投球回が資格ですが、当サイトの救援の資格線はその3分の1の**当サイト基準**で、" +
            "同じ名前で違う資格をつけると自前の基準が公式のものとして読まれてしまうためです。"
          : ""),
    )}`,
  });
}

/**
 * 선발분과 구원분을 나눠 보여준다. **양쪽에 등판이 있을 때만** 낸다.
 *
 * ⚠나누지 않으면 혼재 투수의 방어율이 어느 쪽의 값인지 알 수 없다. 그리고 ⚠**각각을
 * 자기 역할의 분포와 비교해 칠한다** — 같은 3.40이 선발로서는 보통, 구원으로서는 나쁨이다.
 */
function roleSplitBlock(p: PitchingBlockData): RawHtml {
  const sp = p.asStarter;
  const rp = p.asReliever;
  if (sp === null || rp === null) {
    return block({
      id: "rolesplit",
      title: "先発・救援別",
      body: html`<p class="empty">${
        sp === null ? "先発登板がありません。" : "救援登板がありません。"
      }上の基本成績がそのまま${ROLE_LABEL[p.role]}としての成績です。</p>`,
    });
  }
  const row = (label: string, r: RoleLine, group: "starter" | "reliever"): RawHtml =>
    html`<div class="rolecol">
      <h3 class="subhead">${label}</h3>
      <dl>
        ${statCount("試合", r.games)}
        ${statText("投球回", innings(r.line.outs))}
        ${statRateOuts("防御率", r.era, 2, null, group)}
        ${statRateOuts("WHIP", r.whip, 2, null, group)}
        ${statRateOuts("K/9", r.k9, 2, null, group)}
      </dl>
    </div>`;
  return block({
    id: "rolesplit",
    title: "先発・救援別",
    body: html`<div class="cols">${row("先発として", sp, "starter")}${row("救援として", rp, "reliever")}</div>
    ${note(
      "同じ投手でも先発と救援では成績の出方が違うので分けています。" +
        "色はそれぞれ先発投手・救援投手の分布と比べたものです — " +
        "救援の防御率3.20はリーグ下位ですが、先発の3.20は中位です。" +
        "母数が少ないほうは色がつきません。",
    )}`,
  });
}

/** 아웃 중 땅볼 비율. ⚠**분모가 아웃이라는 것을 라벨이 말한다** */
const GROUND_LABEL = "ゴロアウト率";

/**
 * 타구 성향 한 줄.
 *
 * ⚠**표본이 얇으면 그리지 않는다**(M2·M11). 20타구짜리 「좌측 70%」는 값이 아니라 소음이다.
 */
/**
 * 좌·우 라벨.
 *
 * ⚠**좌타자는 당겨치면 오른쪽이다.** 무조건 「왼쪽 = 당겨치기」로 적으면
 * **좌타자 페이지의 두 라벨이 정반대**가 된다 — 실측(2026): 우타는 좌 46.3%/우 31.2%,
 * 좌타는 좌 34.4%/우 43.3%. 당겨치는 타자를 밀어치는 타자로 읽게 만든다.
 * 이 줄이 그려지는 163장 중 **83장(50.9%)이 좌타자**였다.
 * ⚠**양타·미상은 방향으로만 말한다.** 그 타석에 어느 쪽에 섰는지 우리는 모른다 —
 * 추정해서 「당겨치기」라고 쓰면 그건 사실이 아니라 우리 짐작이다.
 */
function sideLabels(bats: string | null): { left: string; right: string } {
  if (bats === "right") return { left: "引っ張り側", right: "逆方向側" };
  if (bats === "left") return { left: "逆方向側", right: "引っ張り側" };
  return { left: "左方向", right: "右方向" };
}

function battedBallRow(d: BattedBallData, bats: string | null): RawHtml {
  const outs = d.groundOuts + d.airOuts;
  const dir = d.left + d.center + d.right;
  const so = d.swinging + d.looking;
  // ⚠**내야타구가 빠져 있었다** — 그 축만 충분한 선수 55명(1,664 중 3.3%)의 줄이 통째로 사라졌다
  if (outs < MIN_BATTED && dir < MIN_DIRECTION && so < MIN_STRIKEOUT && d.infield < MIN_INFIELD) {
    return raw("");
  }
  return html`${columns(
    outs < MIN_BATTED
      ? raw("")
      : html`${statRate(GROUND_LABEL, { value: d.groundOuts / outs, denominator: outs }, "アウト", 3)}`,
    dir < MIN_DIRECTION
      ? raw("")
      : html`${statRate(sideLabels(bats).left, { value: d.left / dir, denominator: dir }, "打球", 3)}
          ${statRate("センター", { value: d.center / dir, denominator: dir }, "打球", 3)}
          ${statRate(sideLabels(bats).right, { value: d.right / dir, denominator: dir }, "打球", 3)}`,
    d.infield < MIN_INFIELD
      ? raw("")
      : html`${statRate("内野安打率", { value: d.infieldHits / d.infield, denominator: d.infield }, "内野打球", 3)}`,
    so < MIN_STRIKEOUT
      ? raw("")
      : html`${statRate("空振り三振の割合", { value: d.swinging / so, denominator: so }, "三振", 3)}`,
  )}
  ${note(
    "打球の方向は**打球が落ちた地点ではなく、処理した野手の位置**です — シフトや好守が混ざります。" +
      "左右は守備位置で分けており、**二塁手は右側**に入れています（当サイトの定義）。" +
      "**犠打は方向に数えていません** — 作戦であって打撃の傾向ではないためです。" +
      (bats === "right" || bats === "left"
        ? ""
        : "**打席の左右がわからないため、引っ張り・逆方向ではなく方向そのもので示しています。**") +
      "**ゴロアウト率の分母はアウトだけ**です — 本塁打以外の安打には打球の種類が公表されないため、" +
      "一般的なGB%とは分母が違います。**空振り三振の割合は三振の内訳**であって、空振り率ではありません。",
  )}`;
}

function advancedBatting(b: BattingBlockData, bats: string | null): RawHtml {
  const src = b.src;
  return block({
    id: "advanced",
    title: "セイバーメトリクス",
    /**
     * ⚠**SRC 가 맨 앞이다**(2026-08-18 유저 요청: 「SRP·SRC 는 세이버 중에선 항상 최우선」).
     * 이 사이트가 **직접 만든 지표**이고, wOBA·wRC+ 는 어디서나 볼 수 있다 —
     * 앞세우는 것을 뒤에 두면 화면이 그 순서로 「덜 중요하다」고 말하게 된다.
     * ⚠**순서는 전 화면이 같아야 한다** — 구단 페이지 표와 予告先発 카드도 같이 옮겼다.
     */
    body: html`${columns(
      src === null
        ? html`${statText("SRC", NO_VALUE)}`
        : html`${statSigned("SRC", src.src, src.pa, denUnit("src"), rk(b.ranks, "src"))}
            ${statSigned("SRC/600", src.srcPer600, src.pa, denUnit("srcPer600"))}`,
      /**
       * ⚠**wOBA 의 분모도 打席이 아니다** — `打数+四球−敬遠+死球+犠飛` 다(metrics/woba.ts).
       * 실측(2026-08-20 中野拓夢): 打席 434 · wOBA 분모 **414**. 617명 중 **249명**이 어긋나 있었다.
       */
      html`${statRate("wOBA", b.woba, denUnit("woba"), 3, rk(b.ranks, "woba"))}
        ${statRate("wRC+", b.wrcPlus, denUnit("wrcPlus"), 1, rk(b.ranks, "wrcPlus"))}
        ${statSigned("wRAA", b.wraa.value, b.wraa.denominator, denUnit("wraa"), rk(b.ranks, "wraa"))}`,
      html`${statRate("ISO", b.iso, denUnit("iso"), 3)}
        ${statRate("BABIP", b.babip, denUnit("babip"), 3)}`,
      html`${statRate("K%", b.kRate, denUnit("kRate"), 3)}
        ${statRate("BB%", b.bbRate, denUnit("bbRate"), 3)}`,
    )}
    ${battedBallRow(b.batted, bats)}
    ${note(
      "SRC（状況得点貢献）は、打席ごとに得点期待値をどれだけ動かしたかを合計した自前の指標です。" +
        "打撃だけを測り、守備・走塁・ポジション補正は含みません。WARではなく、WARと比較できません。" +
        (src === null || src.skipped === 0 ? "" : ` 期待値表にない状況が${src.skipped}打席あり、計算から外しています。`),
    )}`,
  });
}

function advancedPitching(p: PitchingBlockData): RawHtml {
  const srp = p.srp;
  return block({
    id: "advanced",
    title: "セイバーメトリクス",
    /** ⚠**SRP 가 맨 앞이다** — 위 타자 블록과 같은 이유(2026-08-18) */
    body: html`${columns(
      srp === null
        ? html`${statText("SRP", NO_VALUE)}`
        : html`${statSigned("SRP", srp.srp, srp.bf, denUnit("srp"), rk(p.ranks, "srp"))}
            ${statSigned("SRP/9", srp.srpPer9, srp.bf, denUnit("srpPer9"))}`,
      html`${statRateOuts("FIP", p.fip, 2, rk(p.ranks, "fip"), p.role)}
        ${statRateOuts("WHIP", p.whip, 2, rk(p.ranks, "whip"), p.role)}`,
      html`${statRateOuts("K/9", p.k9, 2, rk(p.ranks, "k9"), p.role)}
        ${statRateOuts("BB/9", p.bb9, 2, rk(p.ranks, "bb9"), p.role)}
        ${statRateOuts("HR/9", p.hr9, 2, null, p.role)}`,
    )}
    ${battedBallRow(p.batted, null)}
    ${note(
      "FIPは本塁打・四死球・奪三振だけから防御率の目盛りに換算した値です。守備の影響を切り離す代わりに、打球の質は測っていません。",
    )}
    ${note(
      "SRP（状況失点抑制）は、投げた打席ごとに失点の期待値をどれだけ抑えたかを合計した自前の指標です。" +
        "0が平均で、プラスなら平均より抑えたことを表します。打者のSRCと同じ計算を裏返したものです。" +
        "⚠自責点とは「引き継いだ走者」の扱いが逆です — SRPは各打席をその打席を投げた投手に付けるので、" +
        "走者を残して降りた投手の責任はそこで止まり、その走者が生還した分は次の投手に付きます。" +
        "WARではなく、WARと比較できません。" +
        (srp === null || srp.skipped === 0
          ? ""
          : ` 期待値表にない状況が${srp.skipped}打席あり、計算から外しています。`),
    )}`,
  });
}

/**
 * 연속 기록.
 *
 * ⚠**「今」과 「今季最長」을 나란히 둔다.** 하나만 내면 어제 끊긴 기록이 오늘도
 * 이어지는 것처럼 보인다 — 연속 기록에서 가장 흔한 오독이다.
 * ⚠**「通算」이라고 쓰지 않는다.** 이 블록은 **그 시즌 안에서만** 센 값이다(§2-1) —
 * 통산은 아래 `通算成績`(출처 NPB)에 따로 있다.
 * ⚠예전에는 이유를 「우리는 2025년부터의 기록만 갖고 있다」고 적었는데 **낡은 거짓말**이었다
 * (실측 1,864/3,510장 · 2026-08-18 감사 P2). 보유 범위를 문장에 박지 않는다 —
 * 백필할 때마다 사람이 고쳐야 하고, 그래서 안 고쳐진다.
 */
function streakBlock(s: StreakBlockData, season: number, asOf: string | null, seasonPast: boolean): RawHtml {
  /**
   * ⚠**「今」은 두 조건이 **동시에** 참일 때만 쓴다.**
   *
   * ⑴ **그 시즌이 아직 진행 중일 것.** 2018년 화면에 「今」이라고 쓰면 8년 전에 끝난 기록이
   *    지금 이어지는 것이 된다. 실측(2026-08-21 · `dist` 전수 6,207장): 연속기록 구획이 있는
   *    3,459장 중 **아카이브 시즌 259장**이 그 상태였다(2018:50 · 2019:23 · 2020:30 · 2021:29 ·
   *    2022:29 · 2023:20 · 2024:27 · 2025:51).
   * ⑵ **그 선수가 그 시즌의 최신 경기일에 나왔을 것.** `streakOf`는 그 선수의 **자기 출장 목록**만
   *    훑으므로 5월 22일 이후 출장이 없으면 `current`는 그때 값 그대로 남는다
   *    (2026-08-16 이중 검토에서 배포물의 21명이 그 상태였다).
   *
   * ⚠**둘 중 하나만으로는 못 가른다 — 두 기준이 실제로 갈라지는 페이지가 463장이다**(같은 실측).
   * ⑵만 보면 위의 아카이브 **259장**이 현재형이 되고, ⑴만 보면 진행 중 시즌에서 5월에 끊긴
   * 기록까지 「今」이 된다 — 2026 쪽 **204장**이 그 상태다. 겹치는 **135장**만이 정말 「今」이다.
   *
   * ⚠**구단 페이지·홈과 문자열을 맞추지 않는다**(그쪽은 `streakSectionTitle(seasonOver)`).
   * 뜻이 다르기 때문이다 — 그 표들은 **선수마다 最後の出場 열을 나란히 싣고 「継続中」이라는 말을
   * 아예 쓰지 않으므로** 시즌 종료만으로 시제가 정해진다. 이 화면의 「今」은 **한 선수에 대한
   * 단정**이라 ⑵가 추가로 필요하다. 같은 문자열을 억지로 쓰면 그 차이가 사라진다(M1은
   * 「같은 사실을 다르게 쓰지 마라」이지 「다른 사실을 같게 쓰라」가 아니다).
   */
  const stillNow = !seasonPast && asOf !== null && s.lastGameDate !== null && s.lastGameDate === asOf;
  const current = stillNow
    ? "今"
    : s.lastGameDate === null
      // ⚠**언제 기준인지 모르면 「今」으로 때우지 않는다**(M11). 실측 6,207장에서 0건이지만,
      //   `StreakBlockData.lastGameDate` 가 `string | null` 인 이상 화면이 답을 갖고 있어야 한다
      ? NO_VALUE
      : `${gameDate(s.lastGameDate)}時点`;

  const row = (label: string, v: StreakData, unit = "試合"): RawHtml => {
    const span =
      v.bestFrom === null || v.bestTo === null
        ? null
        : html`<span class="den">${gameDate(v.bestFrom)}〜${gameDate(v.bestTo)}</span>`;
    return html`<dt>${term(label)}</dt><dd class="v">${v.current}${unit}<span class="den">${current}</span></dd>
      <dt class="sub2">今季最長</dt><dd class="v">${v.best}${unit}${span}</dd>`;
  };
  return block({
    id: "streak",
    title: "連続記録",
    qualifier: `${season}年 · 打席のあった${s.games}試合`,
    body: html`${columns(
      row("連続安打", s.hitting),
      row("連続出塁", s.onBase),
      row("連続無安打", s.hitless),
    )}
    ${note(
      /**
       * ⚠**네 상태를 각각 다른 말로 낸다**(M12).
       * ⚠**끝난 시즌에 「いまも続いているとは限りません」이라고 쓰지 않는다** — 「그럴지도 모른다」가
       *   아니라 **그 시즌은 이미 끝났다.** 「~とは限りません」은 진행 중 시즌에서만 참인 유보다.
       */
      (stillNow
        ? "「今」はいま続いている記録、"
        : s.lastGameDate === null
          ? "左の数字がいつの時点のものかがわかりません。"
          : seasonPast
            ? `この選手の最後の出場は${gameDate(s.lastGameDate)}で、このシーズンはすでに終わっています。左の数字はその時点で続いていた記録です。`
            : `この選手の最後の出場は${gameDate(s.lastGameDate)}です。左の数字はその時点で続いていた記録で、いまも続いているとは限りません。`) +
        "「今季最長」はこの1年でいちばん長かった記録です。" +
        "⚠打席のなかった試合（代走・守備固めだけ）は数えません — 数えると連続記録が理不尽に途切れます。" +
        // ⚠**강조는 별표 두 개다**(`emphasis.ts` 가 그 규칙의 정본 · M1). 여기에는 `<b>` 를 직접
        //   적어 뒀는데 `note()` 가 문자열을 이스케이프하므로 **화면에 `<b>` 가 글자로 찍혔다** —
        //   실측(2026-08-21 · `dist` 전수): 연속기록 구획이 있는 **3,459 / 6,207장** 전부가 그 상태였다.
        //   ⚠**소스만 읽어서는 안 보인다** — 문법이 멀쩡하고 문장만 깨진다(실기 확인이 잡았다).
        `⚠${season}年のなかだけで数えています。「通算」は下の**通算成績**（出典：NPB）にあります。`,
    )}`,
  });
}

/**
 * 스플릿 한 축의 표.
 *
 * ⚠**막대를 버리지 않았다** — 「対左 대 対右」를 **한눈에** 보는 것이 이 블록의 존재 이유다.
 * 표만 두면 두 칸을 눈이 아니라 머리로 비교하게 된다. 그래서 **막대를 한 열로 남긴다.**
 *
 * ⚠**세부 수치는 원래 데이터에 있었다.** `SplitRow.line` 은 `BattingLine` 전체(안타·2루타·
 * **홈런**·사사구·삼진)인데 **화면이 세 비율만 그리고 있었다** — 새 집계 없이 그리기만 하면 된다.
 *
 * ⚠**투수 화면은 뜻이 반대다**(`splits.ts` 머리주석) — `h` 는 피안타, `hr` 는 피홈런이다.
 * 열 이름을 「被~」로 바꾸지 않으면 **투수가 친 것으로 읽힌다.**
 *
 * ⚠**`scroller` 로 가둔다** — 모바일(390px)에서 **페이지가 옆으로 밀리면 안 된다**.
 * 표는 자기 상자 안에서 스크롤한다(저장소가 곳곳에서 쓰는 방식).
 */
/**
 * **투수의 진짜 투구 성적을 낼 수 있는 축**의 표.
 *
 * ⚠**막대가 방어율이다 — 짧을수록 좋다.** 타자 축의 OPS 와 방향이 반대이므로
 * 각주가 그것을 말한다(`被OPS` 와 같은 규칙).
 * ⚠**이닝이 0 인 칸은 방어율이 정의되지 않는다** — `0.00` 이 아니라 「—」다(M2·M11).
 *   npb.jp 도 그런 등판을 `----` 로 적는다(`crosscheck-classify.ts` 가 그 표기를 안다).
 */
function pitchingSplitTable(a: SplitAxisData, cells: Map<string, PitchingSplitCell>): RawHtml {
  const eraOf = (c: PitchingSplitCell): number | null => (c.outs === 0 ? null : (c.er * 27) / c.outs);
  const whipOf = (c: PitchingSplitCell): number | null =>
    c.outs === 0 ? null : ((c.h + c.bb) * 3) / c.outs;
  const worst = Math.max(0.01, ...a.rows.map((r) => eraOf(cells.get(r.key) ?? EMPTY_CELL) ?? 0));
  return scroller(html`<table class="spl" aria-label="${a.label}のスプリット">
  <thead><tr>
    <th class="l">${a.label.replace(/（[^）]*）/, "")}</th>
    ${/* ⚠**막대 열에 값도 넣는다** — 막대만 두면 그 열에 수가 없어 분모를 붙일 자리가 없다(M2).
           그래서 방어율은 **이 열 하나**로 하고 아래에 따로 두지 않는다(같은 수를 두 번 내지 않는다). */ ""}
    <th class="l">${term("防御率")}</th>
    <th>登板</th>
    <th>${term("投球回")}</th>
    <th>${term("WHIP")}</th>
    <th>被安打</th><th>被本塁打</th><th>与四球</th><th>奪三振</th>
  </tr></thead>
  <tbody>${a.rows.map((r) => {
    const c = cells.get(r.key);
    if (c === undefined) return raw("");
    const era = eraOf(c);
    const whip = whipOf(c);
    // ⚠**얇음의 잣대가 다르다** — 타석이 아니라 **이닝**이다. 3이닝 미만은 흐린다
    const thin = c.outs < 9;
    return html`<tr class="${thin ? "thin" : ""}">
      <td class="l">${r.label}</td>
      <td class="l"><div class="track"><i style="width:${Math.round(
        Math.max(0, Math.min(1, (era ?? 0) / worst)) * 100,
      )}%${thin ? ";opacity:.35" : ""}"></i></div>
        ${/* ⚠**분모는 이닝이다**(자책점 × 9 ÷ 投球回) — 등판 수가 아니다 */ ""}
        <span class="wd">${valueWithDen({ value: era, denominator: c.outs / 3 }, denUnit("era"), 2)}</span></td>
      <td class="b">${c.games}</td>
      <td>${innings(c.outs)}</td>
      <td class="wd">${valueWithDen({ value: whip, denominator: c.outs / 3 }, denUnit("whip"), 2)}</td>
      <td>${c.h}</td><td>${c.hr}</td><td>${c.bb}</td><td>${c.so}</td>
    </tr>`;
  })}</tbody>
</table>`);
}

const EMPTY_CELL: PitchingSplitCell = { games: 0, outs: 0, er: 0, h: 0, hr: 0, bb: 0, so: 0 };

function splitTable(a: SplitAxisData, max: number, allowed: boolean): RawHtml {
  // ⚠**투구 라인이 있으면 그쪽이 맞다** — 「타자 수치를 뒤집은 것」이 아니라 진짜 투수 지표다
  if (a.pitching !== null) return pitchingSplitTable(a, a.pitching);
  const head = allowed
    ? ["被安打", "被本塁打", "与四球", "奪三振"]
    : ["安打", "二塁打", "本塁打", "打点", "四球", "三振"];
  const paLabel = allowed ? "対戦打席" : "打席";
  return scroller(html`<table class="spl" aria-label="${a.label}のスプリット">
  <thead><tr>
    <th class="l">${a.label.replace(/（[^）]*）/, "")}</th>
    <th class="l">${allowed ? "被OPS" : "OPS"}</th>
    <th>${paLabel}</th>
    <th>${term("打数")}</th>
    ${/* ⚠**`term()` 은 키가 아니라 라벨을 받는다** — 키를 주면 그 글자가 화면에 그대로 찍힌다
           (첫 판에 `allowedAvg` 가 열 이름으로 나갔다). 용어집에 없는 라벨이면 그냥 글자가 된다. */ ""}
    <th>${term(allowed ? "被打率" : "打率")}</th>
    <th>${term(allowed ? "被出塁率" : "出塁率")}</th>
    <th>${term(allowed ? "被長打率" : "長打率")}</th>
    ${head.map((h) => html`<th>${h}</th>`)}
  </tr></thead>
  <tbody>${a.rows.map((r) => {
    const thin = r.line.pa < a.thinBelow;
    return html`<tr class="${thin ? "thin" : ""}">
      <td class="l">${r.label}</td>
      ${/* ⚠**투수는 막대가 짧을수록 좋다.** 뒤집지 않는다 — 뒤집으면 같은 길이가
             타자 화면에서는 좋고 투수 화면에서는 나쁜 것이 되어 눈이 배운 규칙이 무너진다.
             대신 「棒が短いほど良い」라고 각주가 말한다.
             ⚠**막대만 있고 수가 없었다**(2026-08-31). 열 이름이 「OPS」인데 그 칸에 수가 없으면
             읽는 사람은 OPS 를 **끝내 알 수 없고**, 분모를 붙일 자리도 없다(M2).
             → **막대와 값을 같은 칸에** 둔다. */ ""}
      ${/* ⚠**`td` 를 flex 로 만들지 않는다** — 셀이 테이블 박스에서 빠져나와 아래 경계선이
             다른 칸과 다른 자리에 그려진다(`css-tables.test.ts` 가 막는 그 결함).
             막대와 값은 **안쪽 래퍼**로 묶는다. */ ""}
      <td class="l"><div class="tv"><div class="track"><i style="width:${Math.round(
        Math.max(0, Math.min(1, (r.ops.value ?? 0) / max)) * 100,
      )}%${thin ? ";opacity:.35" : ""}"></i></div><span class="wd">${valueWithDen(
        r.ops,
        denUnit(allowed ? "allowedOps" : "ops"),
        3,
      )}</span></div></td>
      <td class="b">${r.line.pa}</td>
      ${/* ⚠**머리에만 있고 본문에 없던 칸**(2026-08-31 · 사용자 보고).
             이 한 칸이 빠져서 그 뒤 열이 **전부 왼쪽으로 밀렸고**, 화면은 `打数` 칸에 타율을,
             `長打率` 칸에 안타 수를 실은 채로 나갔다. **값은 전부 맞는 값이었다** —
             틀린 것은 어느 칸에 있는가뿐이라 아무 검사도 안 울렸다.
             ⚠**게다가 이 어긋남이 분모 가드를 껐다**(den-units 는 칸 수가 안 맞는 행을 버린다).
             지금은 `table-columns.test.ts` 가 이 부류를 통째로 막는다. */ ""}
      <td class="b">${r.line.ab}</td>
      ${/* ⚠**분모를 값에 붙인다**(M2). 打率는 打数 · 出塁率는 出塁機会 · 長打率는 打数 —
             **서로 달라서 옆의 打数 열 하나로 대신 말할 수 없다.** */ ""}
      <td class="wd">${valueWithDen(r.avg, denUnit(allowed ? "allowedAvg" : "avg"), 3)}</td>
      <td class="wd">${valueWithDen(r.obp, denUnit(allowed ? "allowedObp" : "obp"), 3)}</td>
      <td class="wd">${valueWithDen(r.slg, denUnit(allowed ? "allowedSlg" : "slg"), 3)}</td>
      ${allowed
        ? html`<td>${r.line.h}</td><td>${r.line.hr}</td><td>${r.line.bb}</td><td>${r.line.so}</td>`
        : html`<td>${r.line.h}</td><td>${r.line.double}</td><td>${r.line.hr}</td>
          <td>${r.rbi}</td><td>${r.line.bb}</td><td>${r.line.so}</td>`}
    </tr>`;
  })}</tbody>
</table>`);
}

function splitsBlock(axes: readonly SplitAxisData[]): RawHtml {
  if (axes.length === 0) {
    return block({
      id: "splits",
      title: "スプリット",
      body: html`<p class="empty">打席がありません。</p>`,
    });
  }

  const controls = tablist(
    "splits",
    axes.map((a) => ({ id: a.id, label: a.label })),
    true,
  );

  const allowed = axes[0]!.allowed;

  const panels = axes.map((a, ai) => {
    const max = Math.max(0.001, ...a.rows.map((r) => r.ops.value ?? 0));
    return panel(
      "splits",
      a.id,
      ai === 0,
      html`${a.rows.length === 0 ? html`<p class="empty">この区分の打席がありません。</p>` : splitTable(a, max, allowed)}
      ${note(
        (a.pitching !== null
          ? // ⚠**이 축의 막대는 방어율이다** — 「被OPS」라고 적으면 화면이 거짓말을 한다.
            //   임계도 타석이 아니라 **이닝**이다(3이닝 미만).
            `棒は防御率（**短いほど良い**）。この区分は**登板がまるごと1つの枠に入る**ので、`
            + `投球回と自責点をそのまま合計できます — **本物の防御率**です。`
            + `3回未満は薄く表示しています。`
          : allowed
            ? `棒は被OPS（**短いほど良い**）。安打・本塁打・四球・三振は**投手が許した数**です。`
              + `${a.thinBelow}対戦打席未満は薄く表示しています。`
              // ⚠**왜 여기엔 방어율이 없는가**를 화면이 말한다 — 없는 것을 그냥 비우면 결함으로 읽힌다
              + `⚠この区分に**防御率はありません** — 投球回と自責点は**登板全体につく数**で、`
              + `1度の登板がこの区分の複数の枠にまたがるため、枠ごとに割り振ることができません。`
            : `棒はOPS。${a.thinBelow}打席未満は薄く表示しています。`) +
          `値は小さな標本のもので、順位ではありません。` +
          // ⚠**「通算」とだけ書くと嘘になる** — 当サイトが持っている範囲の通算だからだ。
          //   火消しブロックと同じ規則で**画面が範囲を言う**（M1: 規則は一本）。
          (a.span === null
            ? ""
            : ` この区分は当サイトが保有する**${a.span.from}〜${a.span.to}年**を合算しています`
              + `（NPBが公表する通算とは範囲が違います）。`) +
          // ⚠**접은 사실을 말한다.** 지방 개최는 한 선수에게 3~4타석뿐이라 접지 않으면
          // 표의 절반이 1타석짜리 줄이 된다. 다만 **버린 것이 아니라 합친 것**이므로 그렇게 적는다
          (a.id === "venue"
            ? ` 打席の少ない球場は「その他の球場」にまとめています（捨てずに合算しているので、合計は変わりません）。`
            : "") +
          (a.unclassified === 0
            ? ""
            : ` この軸で分類できない打席が${a.unclassified}あります（${allowed ? "相手打者" : "相手投手"}の投打が不明など）。`),
      )}`,
    );
  });

  return block({
    id: "splits",
    title: allowed ? "スプリット（被成績）" : "スプリット",
    controls,
    body: html`${panels}`,
  });
}

function scorebookBlock(rows: readonly ScorebookRow[], total: number, base: string): RawHtml {
  const body =
    rows.length === 0
      ? html`<p class="empty">打席記録がありません。</p>`
      : html`${scroller(html`<table aria-label="火消しの登板一覧">
          <thead><tr>
            <th class="l">試合日</th><th class="l">相手</th><th>回</th><th class="l">状況</th>
            <th class="l">結果</th><th>打点</th>
          </tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr>
              <!-- ⚠**타석에서 그 경기로 갈 수 있어야 한다.** 「이 안타가 어떤 경기였나」는
                   이 표를 보는 사람이 가장 자주 하는 질문인데, 지금까지는 날짜만 있고
                   경기 페이지로 가는 길이 없어서 試合 화면에서 날짜를 다시 찾아야 했다 -->
              <td class="l"><a href="${base}${gamePath(r.date, r.gameSlug)}">${gameDate(r.date)}</a></td>
              <td class="l">${r.opponent}</td>
              <td>${r.inning}${r.half === "top" ? "表" : "裏"}</td>
              <td class="l">${BASE_LABEL[r.bases] ?? r.bases} ${r.outs}死</td>
              <td class="l"><span class="pa${r.hit ? " h" : ""}">${r.outcome}</span></td>
              <td>${r.rbi === 0 ? NO_VALUE : r.rbi}</td>
            </tr>`,
          )}</tbody>
        </table>`)}
        ${note(
          `新しい順。結果の表記はボックススコアの原文です。` +
            // ⚠**자른 것을 말한다.** 「전부」로 읽히면 그것도 거짓말이다
            (total > rows.length ? ` 全${total}打席のうち直近${rows.length}件を表示しています。` : ""),
        )}`;
  return block({ id: "scorebook", title: "打席記録", body });
}

/**
 * 상황별 번트의 득점기대값 변화. **리그 전체의 값**이다(이 선수의 값이 아니다).
 *
 * ⚠**「번트는 손해다」가 결론이 아니다** — 상황별로 갈리는 것이 결론이다.
 * ⚠**득점기대값은 승리기대값이 아니다.** 동점 9회말에 1점만 필요하면 RE 손해여도 옳을 수 있다.
 */
export interface BuntCell {
  bases: string;
  outs: number;
  /** 이 상황의 번트 수. **분모다**(M2) */
  n: number;
  before: number;
  delta: number;
}

/** 번트를 몇 건 이상 대야 값을 낼 것인가. 6건짜리 평균은 값이 아니라 소음이다 */
const MIN_BUNT = 30;

function buntBlock(rows: readonly BuntCell[], leagueName: string): RawHtml {
  const shown = rows.filter((r) => r.n >= MIN_BUNT);
  if (shown.length === 0) return raw("");
  return html`${scroller(html`<table aria-label="状況ごとの犠打">
    <thead><tr>
      <th class="l">状況</th><th>犠打</th><th>直前の期待値</th><th>期待値の変化</th>
    </tr></thead>
    <tbody>${shown.map(
      (r) => html`<tr>
      <td class="l">${BASE_LABEL[r.bases === "" ? "" : r.bases] ?? r.bases}　${r.outs}死</td>
      <td class="b">${r.n}</td>
      <td class="wd">${r.before.toFixed(3)}</td>
      <td class="wd">${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(3)}</td>
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    `${leagueName}全体の値です（この選手の記録ではありません）。` +
      "**「バントは損」が結論ではありません** — 状況によって変わることが結論です。" +
      "⚠**得点期待値は勝利期待値ではありません。** 同点9回裏で1点だけ必要な場面では、" +
      "得点期待値が下がる選択が正しいことがあります。当サイトは勝利期待値を信頼できる形で作れないため、" +
      "**得点期待値の話までしかしません。** " +
      `また、バントを任される打者は平均以下であることが多く、比較対象は「リーグ平均打者の強攻」ではありません。` +
      `犠打${MIN_BUNT}件未満の状況は出していません。`,
  )}`;
}

/**
 * 타순 순회(times through the order) 한 줄. **NPB 전체의 값**이다.
 *
 * ⚠**생존자 편향을 반드시 함께 말한다.** 3순회까지 가는 투수는 그날 잘 던진 투수라
 * 실제 패널티보다 성적이 **좋게** 나온다. 이 문장 없이 내면 정반대로 오독된다.
 */
export interface TimesThroughRow {
  round: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  so: number;
}

/** 순회별 표본이 이만큼은 있어야 줄로 낸다. 얇은 줄은 값이 아니라 소음이다 */
const MIN_TTO_PA = 300;

function timesThroughBlock(rows: readonly TimesThroughRow[]): RawHtml {
  const shown = rows.filter((r) => r.pa >= MIN_TTO_PA);
  /**
   * ⚠**줄이 하나뿐이면 블록을 내지 않는다.** 순회 사이의 차이를 보는 값이라
   * 한 줄만 있으면 비교할 것이 없다 — 있는 척하는 빈 화면보다 없는 것이 정직하다.
   */
  if (shown.length < 2) {
    return block({
      id: "timesthrough",
      title: "打順一巡",
      body: html`<p class="empty">巡目別に出せるだけの打席がまだありません。</p>`,
    });
  }
  return block({
    id: "timesthrough",
    title: "打順一巡",
    body: html`${scroller(html`<table aria-label="打順の巡ごとの成績">
    <thead><tr>
      <th class="l">巡</th><th>打席</th><th>${term("打率")}</th><th>本塁打</th><th>四球</th><th>三振</th>
    </tr></thead>
    <tbody>${shown.map(
      (r) => html`<tr>
      <td class="l">${r.round >= 4 ? "4巡目以降" : `${r.round}巡目`}</td>
      <td class="b">${r.pa}</td>
      <td class="wd">${r.ab === 0 ? NO_VALUE : avg3(r.h / r.ab)}<span class="den">${r.ab}打数</span></td>
      <td class="b">${r.hr}</td>
      <td class="b">${r.bb}</td>
      <td class="b">${r.so}</td>
    </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    "NPB全体の値です（この選手の記録ではありません）。同じ試合で同じ投手が同じ打者と" +
      "何度目に対戦したかで分けています。" +
      "⚠**「3巡目は打たれる」と読まないでください。** 3巡目まで投げる投手はその日good投球をしている" +
      "投手なので、**実際の不利より成績が良く出ます**（生存者バイアス）。" +
      `⚠個人の順位はつけません — 個人の3巡目は標本が薄すぎます。${MIN_TTO_PA}打席未満の巡は出していません。`,
  )}`,
  });
}

function situationBlock(
  cells: readonly SituationCell[],
  leagueName: string,
  bunts: readonly BuntCell[],
): RawHtml {
  if (cells.length === 0) {
    return block({
      id: "situation",
      title: "得点期待値",
      body: html`<p class="empty">得点期待値を計算できていません。</p>`,
    });
  }
  const byKey = new Map(cells.map((c) => [`${c.bases === "" ? "-" : c.bases}|${c.outs}`, c]));

  return block({
    id: "situation",
    title: "得点期待値",
    body: html`${scroller(html`<div class="dg">
      <div class="h"></div><div class="h">0死</div><div class="h">1死</div><div class="h">2死</div>
      ${BASE_ORDER.map(
        (b) => html`<div class="rl">${BASE_LABEL[b]}</div>
          ${[0, 1, 2].map((o) => {
            const cell = byKey.get(`${b}|${o}`);
            const thin = cell === undefined || cell.pa < THIN_SITUATION_PA;
            return html`<div class="c${thin ? " thin" : ""}">
              <u>${cell === undefined || cell.re === null ? NO_VALUE : cell.re.toFixed(2)}</u>
              <s>${cell === undefined ? 0 : cell.pa}打席</s>
            </div>`;
          })}`,
      )}
    </div>`)}
    ${note(
      `大きい数字は${leagueName}の得点期待値（その状況からイニング終了までに入る平均得点）で、リーグ全体の値です。` +
        `小さい数字はこの選手がその状況で立った打席数。${THIN_SITUATION_PA}打席未満は薄くしています。`,
    )}
    ${buntBlock(bunts, leagueName)}`,
  });
}

/**
 * 상대전적 — **검색하고 골라 보는 표**.
 *
 * ⚠**타율순 정렬은 10타석 이상으로 제한한다.** 대전 표본은 대부분 한 자릿수라
 * 그대로 타율로 정렬하면 「5타석 3안타」가 맨 위에 오고, 그건 순위가 아니라 잡음이다.
 * 제한한다는 사실을 탭 이름에 쓴다 — 숨겨진 규칙을 만들지 않는다.
 */
/**
 * 정렬 가능한 열. **키는 행의 `data-*`와 같은 이름**이어야 한다 — 어긋나면 조용히 정렬이 안 먹는다.
 * `rate`인 열은 표본이 작으면 오독되므로 클라이언트가 경고를 낸다.
 */
const MATCHUP_COLUMNS: readonly {
  key: string;
  label: string;
  align: "l" | "r";
  type: "text" | "num";
  rate?: true;
}[] = [
  { key: "name", label: "", align: "l", type: "text" },
  { key: "team", label: "球団", align: "l", type: "text" },
  { key: "pa", label: "打席", align: "r", type: "num" },
  { key: "ab", label: "打数", align: "r", type: "num" },
  { key: "h", label: "安打", align: "r", type: "num" },
  { key: "hr", label: "本塁打", align: "r", type: "num" },
  { key: "bb", label: "四球", align: "r", type: "num" },
  { key: "so", label: "三振", align: "r", type: "num" },
  { key: "rbi", label: "打点", align: "r", type: "num" },
  { key: "avg", label: "打率", align: "r", type: "num", rate: true },
];

/** 최소 타석 선택지. **10이 기본이 아니다** — 기본은 전부 보이는 것이고, 좁히는 것은 선택이다 */
const MATCHUP_MIN_PA = [1, 3, 5, 10, 20];

/**
 * 상대전적 — **검색하고 정렬해서 보는 표**.
 *
 * ⚠**타율로 정렬할 수 있게 하되, 그것이 순위가 아님을 화면이 계속 말한다.**
 * 대전 표본은 대부분 한 자릿수라 「5타석 3안타」가 맨 위에 온다. 막지는 않는다 —
 * 대신 **지금 무엇으로 정렬돼 있고 몇 타석 이상만 보고 있는지**를 상태 줄에 항상 낸다.
 * ⚠`THIN_MATCHUP_PA` 미만은 여전히 색을 낮춘다. 값은 지우지 않는다.
 */
/**
 * 대전 표 한 벌.
 *
 * ⚠**`id` 마다 DOM 이 통째로 갈린다**(`<id>Filter`·`<id>Table`·`<id>Count`…).
 * 그래서 두 범위를 한 화면에 둘 때 **id·선택 상자·버튼줄 그룹을 전부 따로** 준다 —
 * 하나라도 겹치면 한쪽의 좁히기가 다른 쪽을 조용히 움직인다.
 *
 * ⚠**시즌 쪽 id 는 `matchup` 그대로 둔다.** 그 이름으로 붙은 시험이 이미 있고
 * (`matchupTable`·`matchupFilter`·`matchupCount`…), 바꾸면 그 회귀 감시자가 사라진다.
 */
function matchupTable(o: {
  rows: readonly MatchupRow[];
  total: number;
  opponent: string;
  id: string;
  selectId: string;
  minGroup: string;
  /** 여러 시즌을 합친 표면 그 범위. ⚠**「通算」이라는 말만으로는 거짓이다** */
  span: { from: number; to: number } | null;
}): RawHtml {
  const { rows, total, opponent } = o;
  // 구단 선택지는 **실제로 대전한 구단만** 낸다 — 없는 구단을 고르게 하면 0건 화면이 된다
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.opponentTeam, (counts.get(r.opponentTeam) ?? 0) + 1);

  return stableTable({
    id: o.id,
    // ⚠**「対戦成績」만으로는 두 표를 구별 못 한다** — 같은 화면에 今季와 通算이 나란히 있다
    label: `${opponent}別の対戦成績`,
    columns: MATCHUP_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      ...(c.align === "l" ? { left: true as const } : {}),
      ...(c.type === "text" ? { text: true as const } : {}),
      ...(c.rate === true ? { rate: true as const } : {}),
      ...(c.label === "" ? { head: opponent } : {}),
    })),
    sortKey: "pa",
    findLabel: `${opponent}名でしぼる`,
    findPlaceholder: "例：山本",
    select: {
      id: o.selectId,
      field: "teamcode",
      label: "球団",
      options: [
        { value: "", label: "すべての球団" },
        ...TEAMS.filter((t) => counts.has(t.code)).map((t) => ({
          value: t.code,
          label: `${shortNameOf(t.code)}（${counts.get(t.code) ?? 0}）`,
        })),
      ],
    },
    thin: { field: "pa", min: THIN_MATCHUP_PA, unit: "打席" },
    minGroup: o.minGroup,
    minField: "pa",
    total,
    unit: "件",
    emptyText: "この条件の対戦記録はありません。",
    rows: html`${rows.map(
      (r) => html`<tr class="${r.line.pa < THIN_MATCHUP_PA ? "thin" : ""}"
      data-name="${r.opponentName}" data-team="${shortNameOf(r.opponentTeam)}" data-teamcode="${r.opponentTeam}"
      ${/* ⚠**이름이 아니라 ID 로 못 박는다**(M10 · 2026-08-18 감사 P2).
           「対戦を選ぶ」에서 이름으로 넘기면 동명이인(이 저장소에 「小島」가 둘)이 함께 걸린다 */ ""}
      data-oppid="${r.opponentId}"
      data-pa="${r.line.pa}" data-ab="${r.line.ab}" data-h="${r.line.h}" data-hr="${r.line.hr}"
      data-bb="${r.line.bb}" data-so="${r.line.so}" data-rbi="${r.rbi}"
      ${
        // ⚠**속성을 raw() 안에서 문자열로 짓지 않는다**(2026-08-18 감사 P3 · layout.ts 가 같은 말을 적어 뒀다).
        //   그 안의 값은 이스케이프를 거치지 않는다 — 따옴표 하나로 속성이 끊긴다.
        //   지금은 `toFixed(4)` 라 숫자만 나오지만, **다음 사람이 문자열 필드를 얹으면 뚫린다.**
        //   조각째 `html` 에 넘기면 그 자리가 영구히 이스케이프를 거친다.
        //   이 규칙은 `test/raw-attributes.test.ts` 가 소스에서 센다.
        // ⚠**주석은 `${…}` 안에 둔다** — 밖에 두면 한 줄 늘어난 만큼 산출물의 공백이 바뀐다.
        r.avg.value === null ? raw("") : html`data-avg="${r.avg.value.toFixed(4)}"`
      }>
      ${/* ⚠**페이지가 없는 상대는 링크를 걸지 않는다** — 걸면 404 다(통산에만 생긴다).
             행은 지우지 않는다: 그 대전은 실제로 있었다. */ ""}
      <td class="l">${r.noPage === true ? html`${r.opponentName}` : html`<a href="${r.opponentId}.html">${r.opponentName}</a>`}</td>
      <td class="l">${r.opponentTeam === "" ? NO_VALUE : shortNameOf(r.opponentTeam)}</td>
      <td>${r.line.pa}</td><td>${r.line.ab}</td><td>${r.line.h}</td><td>${r.line.hr}</td>
      <td>${r.line.bb}</td><td>${r.line.so}</td><td>${r.rbi}</td>
      <td>${avg3(r.avg.value)}</td>
    </tr>`,
    )}`,
    note: note(
      // ⚠**「通算」とだけ書くと嘘になる** — 当サイトが保有する範囲の通算だからだ(火消しと同じ規則)
      (o.span === null
        ? ""
        : `この表は当サイトが保有する**${o.span.from}〜${o.span.to}年**を合算しています`
          + `（NPBが公表する通算とは範囲が違います）。`) +
        `見出しを押すと並べ替わります（もう一度押すと逆順）。${THIN_MATCHUP_PA}打席未満は薄く表示しています — ` +
        `対戦成績は大半が一桁打席で、率で並べると少ない打席が先頭に来ます。` +
        `並び順と絞り込みは上の行に出ています。${opponent}名を押すとその選手のページに移ります。`,
    ),
  });
}

/** 최소 타석 버튼줄. ⚠**범위마다 자기 그룹을 갖는다** — 공유하면 한쪽이 다른 쪽을 움직인다 */
function matchupMinControls(group: string): RawHtml {
  return buttonGroup(
    group,
    MATCHUP_MIN_PA.map((n) => ({ id: String(n), label: n === 1 ? "すべて" : `${n}打席以上` })),
    "最少打席でしぼる",
  );
}

function matchupBlock(
  rows: readonly MatchupRow[],
  total: number,
  opponent: string,
  career: { rows: MatchupRow[]; span: { from: number; to: number } } | null,
): RawHtml {
  if (rows.length === 0) {
    return block({ id: "matchup", title: "対戦成績", body: html`<p class="empty">対戦記録がありません。</p>` });
  }

  const seasonTable = matchupTable({
    rows, total, opponent,
    id: "matchup", selectId: "matchupTeam", minGroup: "matchupMin", span: null,
  });

  /**
   * ⚠**통산이 없거나 시즌과 같으면 탭을 만들지 않는다** — 같은 표를 두 번 보여주는 것은
   * 정보가 아니라 잡음이다. 그때의 DOM 은 **이 변경 전과 한 글자도 다르지 않아야** 한다.
   */
  if (career === null || career.rows.length === 0) {
    return block({
      id: "matchup",
      title: "対戦成績",
      controls: matchupMinControls("matchupMin"),
      body: seasonTable,
    });
  }

  const careerTable = matchupTable({
    rows: career.rows, total: career.rows.length, opponent,
    id: "matchupCareer", selectId: "matchupCareerTeam", minGroup: "matchupCareerMin", span: career.span,
  });

  return block({
    id: "matchup",
    title: "対戦成績",
    controls: tablist(
      "matchupScope",
      [{ id: "season", label: "今季" }, { id: "career", label: "通算" }],
      false,
      "範囲の切り替え",
      true,
    ),
    // ⚠**버튼줄이 패널 안으로 들어간다.** 머리에 하나만 두면 두 표가 그것을 나눠 쓰게 되고,
    //   그러면 「今季에서 10타석 이상」을 고른 상태가 通算 탭에도 걸린다 — 임계의 뜻이 범위마다 다르다.
    body: html`${panel("matchupScope", "season", true, html`${matchupMinControls("matchupMin")}${seasonTable}`)}
${panel("matchupScope", "career", false, html`${matchupMinControls("matchupCareerMin")}${careerTable}`)}`,
  });
}

/**
 * 通算成績.
 *
 * ⚠**이 블록만 출처가 다르다**(M4). 다른 블록은 우리가 박스스코어·타석 로그에서 쌓은 값이고
 * 여기는 **NPB 가 선수 페이지에 공표한 연도별 수치**다. 화면이 그 사실을 적는다 —
 * 적지 않으면 「어제 본 숫자와 다른데?」에 답할 수 없다.
 *
 * ⚠**합계는 우리가 더한 값이다** — 남의 계산값을 빌리는 것이 아니다.
 * ⚠~~NPB 는 합계 행을 싣지 않는다(실측 0/980)~~ → **틀린 판정이었다.** `<tfoot>` 의
 * `通　算`(전각 공백)으로 **980/980 싣는다.** 우리는 그것을 **표시가 아니라 대조에** 쓴다
 * (`parser/career.ts`) — 어긋나면 그 선수의 취입을 멈춘다.
 *
 * ⚠**이 표를 우리 집계로 갈아끼우지 마라**(2026-08-17에 시도했다가 되돌렸다).
 * `試合` 의 정의가 다르고(출장 경기 vs 타석이 있던 경기 · 1,777쌍 중 569쌍 어긋남),
 * 갈아끼우면 그 해 盗塁刺가 사라지며, 작년까지의 통산 행이 없는 선수에게 말이 안 되는 문장이 나간다.
 *
 * ⚠**우리 보유 범위(2023~)를 넘는 해가 들어 있다.** 그래서 이 표의 연도를 눌러도
 * 그 시즌 화면으로 보내지 않는다 — 없는 곳으로 보내면 404다.
 */
function careerBlock(c: CareerData | null): RawHtml {
  if (c === null || (c.batting.length === 0 && c.pitching.length === 0)) {
    return block({ id: "career", title: "通算成績", body: html`<p class="empty">年度別成績がありません。</p>` });
  }

  const table = (rows: readonly CareerRow[], label: string, unit: string, total: string | null, seasons: number): RawHtml =>
    rows.length === 0
      ? raw("")
      : html`<h3 class="cyr">${label}<span class="qt">${seasons}シーズン</span></h3>
      ${total === null ? null : html`<p class="ctot"><b>通算</b>${total}</p>`}
      ${scroller(html`<table aria-label="年度別成績">
        <thead><tr><th>年度</th><th class="l">球団</th><th>試合</th><th>${unit}</th><th class="l">成績</th></tr></thead>
        <tbody>${rows.map(
          // ⚠**줄마다 출처를 말한다**(M4). 지난 시즌까지는 NPB 공표치이고 올해는 우리 집계다 —
          //   NPB 페이지가 며칠 늦기 때문이고, 끝난 시즌에서는 두 값이 완전히 같다(실측)
          (r) => html`<tr><td class="b">${r.year}</td>
          <td class="l">${r.team}</td>
          <td>${r.games}</td><td>${r.faced}</td><td class="l wd">${r.line}</td></tr>`,
        )}</tbody>
      </table>`)}`;

  return block({
    id: "career",
    title: "通算成績",
    ...(c.from === null ? {} : { qualifier: `${c.from}〜${c.to}` }),
    body: html`${table(c.batting, "打撃", "打席", c.battingTotal, c.battingSeasons)}
${table(c.pitching, "投球", "打者", c.pitchingTotal, c.pitchingSeasons)}
${note(
      // ⚠**출처와 기준일을 같이 적는다**(M4). 기준일이 없으면 낡은 값이 낡은 채로 조용히 있다 —
      //   실제로 그 일이 났다(2026-08-17)
      `この表だけ**出典が違います** — ${c.source}の公表値で、` +
        (c.asOf === null
          ? "取得日は記録がありません。"
          : `**${c.asOf}時点**に取得したものです。`) +
        "ほかのブロックは当サイトが試合記録から積み上げた値で、**混ぜていません**。" +
        "同じ年でも数え方が違うことがあります — たとえば**試合数**は、" +
        "NPBが「出場した試合」、当サイトが「打席のあった試合」です" +
        "（2023〜2025年の1,777件を突き合わせたところ、安打・本塁打・打点・盗塁・打席は**食い違い0件**、" +
        "試合数だけ569件ずれました）。だから**この表の数字は当サイトの集計で置き換えません**。" +
        "**通算は当サイトが足した値**です — 他サイトの計算を借りたものではありません。" +
        "NPBが載せている合計行とは**毎回突き合わせていて**、合わなければその選手の取り込みを止めます。" +
        "シーズン途中に移籍した年は球団ごとに1行になります。",
    )}`,
  });
}

function rankingBlock(panels: readonly RankingPanel[], base: string): RawHtml {
  if (panels.length === 0) {
    return block({ id: "ranking", title: "リーグ順位", body: html`<p class="empty">順位を計算できていません。</p>` });
  }
  const controls = tablist(
    "pranking",
    panels.map((p) => ({ id: p.id, label: p.label })),
    true,
  );

  const body = panels.map((p, pi) =>
    panel(
      "pranking",
      p.id,
      pi === 0,
      html`${scroller(html`<table aria-label="${p.label}のリーグ順位">
        <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${term(p.label)}</th><th>${term("母数")}</th></tr></thead>
        <tbody>${p.rows.map(
          (r) => html`<tr class="${r.isMe ? "me" : ""}">
            <td>${r.rank === null ? NO_VALUE : r.rank}</td>
            <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
            <td class="l">${r.teamCode.toUpperCase()}</td>
            <td>${rankValue(r.value.value, p.digits)}</td>
            <td>${denText(r.value.denominator, p.unit, p.denAsInnings)}</td>
          </tr>`,
        )}</tbody>
      </table>`)}
      ${note(`${p.qualifier} 上位${RANKING_TOP}人とこの選手の行だけを表示しています。`)}`,
    ),
  );

  return block({ id: "ranking", title: "リーグ順位", controls, body: html`${body}` });
}

/**
 * カウント別成績.
 *
 * ⚠**投球単位のデータではない — 각주가 그것을 먼저 말한다.** 이 블록을 보는 사람은
 * 반드시 「초구 스트라이크율은?」을 떠올리는데, 우리는 그것을 **영영 낼 수 없다**
 * (투구 단위 기록이 공개되지 않는다). 없는 것을 없다고 먼저 말하지 않으면
 * 「아직 안 만들었나 보다」로 읽힌다(M12).
 *
 * ⚠**독창인 척하지 않는다** — nf3·データパーク 등이 이미 내는 표준 지표다.
 * 이 사이트가 한 일은 **가지고 있으면서 안 읽던 값을 읽은 것**이다.
 *
 * ⚠**타자와 투수가 같은 표를 쓰되 이름이 다르다.** 追い込まれ率 ↔ 追い込み率,
 * 打率 ↔ 被打率. 같은 라벨을 쓰면 투수 화면이 타자 설명을 낸다(용어집이 그 함정을 적어 뒀다).
 */
function countBlock(c: CountBlockData, role: "batter" | "pitcher"): RawHtml {
  const forPitcher = role === "pitcher";
  /**
   * ⚠**통산이 있으면 탭으로 낸다.** 축을 늘리는 것이 아니라 **같은 표를 두 범위로** 보는 것이라
   * 스플릿처럼 축 목록에 섞지 않는다 — 섞으면 「무엇을 나누는 축인가」가 흐려진다.
   */
  const scopes: { id: string; label: string; scope: CountScope; span: { from: number; to: number } | null }[] =
    c.career === null
      ? [{ id: "season", label: "今季", scope: c, span: null }]
      : [
          { id: "season", label: "今季", scope: c, span: null },
          { id: "career", label: "通算", scope: c.career, span: c.career.span },
        ];
  /**
   * ⚠**투수 화면에 타자 이름을 쓰지 않는다.** 「打率 .358」이 투수 페이지에 있으면
   * 그건 이 투수가 친 것으로 읽힌다 — 용어집이 `avg`/`allowedAvg` 를 나눠 둔 이유와 같다.
   */
  const avgKey = forPitcher ? "allowedAvg" : "avg";
  const opsKey = forPitcher ? "allowedOps" : "ops";
  const hitLabel = forPitcher ? "被安打" : "安打";
  const soLabel = forPitcher ? "奪三振" : "三振";
  const bodyOf = (s: CountScope, span: { from: number; to: number } | null): RawHtml => {
    const rows = s.rows.filter((r) => r.line.pa > 0);
    const table = rows.length === 0
      ? raw("")
      : scroller(html`<table aria-label="カウント別成績">
      <thead><tr>
        <th class="l">カウント</th><th>${term("打席")}</th><th>${term("打数")}</th>
        <th>${hitLabel}</th><th>${soLabel}</th>
        <th>${term(termOf(avgKey)!.label)}</th><th>${term(termOf(opsKey)!.label)}</th>
      </tr></thead>
      <tbody>${rows.map(
        (r) => html`<tr>
        <td class="l">${r.label}</td>
        <td class="b">${r.line.pa}</td>
        <td>${r.line.ab}</td>
        <td>${r.line.h}</td>
        <td>${r.line.so}</td>
        <!-- ⚠**분모를 값에 붙인다**(M2). 옆의 打数 열과 같은 수이지만, 값만 떼어
             다른 화면에 실릴 때 분모가 따라가야 한다 -->
        <td class="wd">${valueWithDen(r.avg, denUnit(avgKey), 3)}</td>
        <td class="wd">${valueWithDen(r.ops, denUnit(opsKey), 3)}</td>
      </tr>`,
      )}</tbody>
    </table>`);

    return html`${columns(
      html`${statRate(forPitcher ? "追い込み率" : "追い込まれ率", s.twoStrike, denUnit(forPitcher ? "twoStrikeGained" : "twoStrikeAgainst"), 3)}
        ${statRate("初球決着率", s.firstPitch, denUnit("firstPitchDecided"), 3)}`,
      html`${statRate("フルカウント率", s.fullCount, denUnit("fullCountReached"), 3)}
        ${statRate("3ボール率", s.threeBall, denUnit("threeBallReached"), 3)}`,
      /**
       * ⚠**격리한 타석이 있으면 그 수를 낸다**(M11). 없으면 줄 자체를 만들지 않는다 —
       * 늘 `0` 이 서 있으면 아무도 안 읽고, 어느 날 1이 되어도 눈에 안 띈다.
       */
      s.quarantined === 0
        ? raw("")
        : html`${statCount("カウント不明", s.quarantined)}`,
    )}
    ${table}
    ${note(
      // ⚠**「通算」とだけ書くと嘘になる** — 当サイトが持っている範囲の通算だからだ(火消しと同じ規則)
      (span === null
        ? ""
        : `この区分は当サイトが保有する**${span.from}〜${span.to}年**を合算しています`
          + `（NPBが公表する通算とは範囲が違います）。`) +
        "⚠**投球単位のデータではありません。** 分かるのは「打席の最後の1球を投げたときのカウント」だけで、" +
        "ファウル・空振り・初球ストライク率・投げさせた球数は数えられません" +
        "（公表されている記録に1球ごとの情報がないためです）。" +
        "⚠ボールもストライクも打席の中で減らないので、終了時のカウントで**到達**は正確に言えます — " +
        "2ストライクで終わった打席は必ず途中で追い込まれています。" +
        "⚠**初球決着率から申告敬遠は除いています**（記録上は 0-0 ですが1球も投げていません）。" +
        (s.quarantined === 0
          ? ""
          : `⚠カウントを読めなかった打席が${s.quarantined}件あり、上の母数から外しています。`) +
        "⚠この指標自体は当サイト独自のものではありません — 材料が手元にあったので出しています。",
    )}`;
  };

  if (scopes.length === 1) {
    return block({ id: "count", title: "カウント別", qualifier: `${c.pa}打席`, body: bodyOf(c, null) });
  }
  /**
   * ⚠**탭이 있으면 머리에 분모를 안 적는다.**
   * 머리는 하나인데 패널은 둘이라, 「今季 141打席」을 적어 두면 通算 탭(580打席)으로 바꿔도
   * **머리가 안 따라가서 화면이 두 개의 분모를 동시에 주장**한다 — M2 가 막으려던 바로 그 상태다.
   * 분모는 각 패널이 값 옆에서 말한다.
   */
  return block({
    id: "count",
    title: "カウント別",
    controls: tablist("count", scopes.map((s) => ({ id: s.id, label: s.label })), false, "範囲の切り替え", true),
    body: html`${scopes.map((s, i) => panel("count", s.id, i === 0, bodyOf(s.scope, s.span)))}`,
  });
}

/**
 * 火消し(継投引き継ぎ) — **「この投手は他人の火を消す人か、きれいなイニングだけ受け取る人か」**.
 *
 * ⚠**MLB の IS%(引き継ぎ走者の生還率)ではない — 각주가 그것을 명시한다.**
 * `bases` 는 **점유만** 말하고 주자의 **신원**을 말하지 않으므로, 우리가 셀 수 있는 것은
 * 「그 이후 그 이닝에 들어온 점」이다. 이름을 IS% 처럼 붙이면 그 이름 자체가 거짓말이 된다.
 *
 * ⚠**시즌 쪽에는 비율을 내지 않는다**(M3). 실측으로 한 시즌 1인당 4회 남짓이다.
 */
function reliefBlock(r: ReliefBlockData): RawHtml {
  const span = r.from === r.to ? `${r.from}年` : `${r.from}〜${r.to}年`;
  return block({
    id: "relief",
    title: "火消し",
    qualifier: `通算 ${span}`,
    body: html`${columns(
      html`${statCount("引き継ぎ登板", r.career.inherited)}
        ${statCount("背負った走者", r.career.inheritedRunners)}`,
      html`${statCount("火消し成功", r.career.doused)}
        ${
          /**
           * ⚠**자격선 미만이면 비율 자리를 「—」로 채우지 않는다**(M11·M12).
           * 「まだ出せません」이라고 적어 **「0.000」과 구별**한다.
           */
          r.dousedRate === null
            ? statText("火消し率", `${r.minForRate}登板未満`)
            : statRate("火消し率", r.dousedRate, denUnit("doused"), 3)
        }`,
      html`${statRate("登板時得点期待値", r.enteringRe, denUnit("enteringRe"), 2)}
        ${statCount("イニング途中の登板", r.career.midInning)}`,
      /** 시즌 쪽. ⚠**개수만** */
      html`${statCount(`${r.to}年の引き継ぎ登板`, r.season.inherited)}
        ${statCount(`${r.to}年の火消し成功`, r.season.doused)}`,
    )}
    ${note(
      /**
       * ⚠**여기에도 「9シーズンで交代の約85%」·「8.0%、判定が変わるのは1.3%」이 있었다** —
       * `glossary.ts` 의 `inheritedAppearance`·`doused` 와 **같은 사실을 두 곳에 적은 상태**였다(M1).
       * 두 벌이면 한쪽만 고쳐지고, 실제로 그 수들은 이미 틀려 있었다(근거는 그쪽 주석).
       * → **양쪽에서 뺐다.** 여기 문장은 각주로서 필요한 성질만 말한다.
       */
      `上の数字は当サイトが保有する${span}レギュラーシーズンの**通算**です` +
        "（このページのほかのブロックはシーズン成績です）。" +
        "**イニングの途中で前の投手から代わり、そのとき塁上に走者がいた登板**を数えています — " +
        "イニングの間の交代は入りません（投手交代の多くはそちらです）。" +
        "⚠**「引き継いだ走者が何人生還したか」ではありません（MLBのIS%とは別物です）。** " +
        "記録に残っているのは「どの塁が埋まっていたか」だけで走者が誰かは分からないため、" +
        "当サイトが数えられるのは**そのイニングにその後入った点**だけで、" +
        "そこには自分が出した走者の得点も混ざります。" +
        "⚠**そのイニングが終わるまで**を見るので、同じイニングでさらに交代があった場合は" +
        "次の投手が出した点も入ります。そこまで交代が重なる登板は少なく、" +
        "それで火消しの判定が変わることはさらにまれです。" +
        `⚠**1シーズンでは1人あたり4回ほどしかない場面**なので、率は通算で${r.minForRate}登板以上のときだけ出し、` +
        "シーズン順位はつけていません。" +
        (r.reMissing === 0
          ? ""
          : `⚠得点期待値を出せなかった登板が${r.reMissing}件あり、その平均の母数から外しています。`),
    )}`,
  });
}

// ─── 페이지 ──────────────────────────────────────────────────────────────

/**
 * **이 시즌이 이미 끝났는가** — 근거는 「더 새로운 시즌의 경기가 아카이브에 있다」 하나다.
 *
 * ⚠**`true` 는 증명이고 `false` 는 「모른다」다**(M11). 시즌은 겹치지 않으므로
 * `season < heldTo` 면 그 시즌은 **반드시** 끝났다. 반대는 성립하지 않는다 —
 * `false` 는 「끝나지 않았다」가 아니라 **「이 근거로는 못 가른다」**이고,
 * 그래서 이 값은 「今」을 **막는 쪽으로만** 쓴다(막지 못한 곳에서는 ⑵가 여전히 판정한다).
 *
 * ⚠**`heldTo === 0` 은 「하나도 없다」가 아니라 「모른다」다**(`freshness()` 의 기본값 · layout.ts).
 * 모르는 값으로 시제를 뒤집지 않는다 — **0 은 어떤 실제 시즌보다도 작으므로 비교가 이미
 * 안전한 쪽(`false`)으로 떨어진다.** 그래서 `heldTo !== 0` 를 따로 쓰지 않는다:
 * 처음에는 썼는데 **뮤테이션 검사에서 그 조건을 지워도 시험이 하나도 안 떨어졌다**(2026-08-21) —
 * 어떤 입력으로도 도달하지 않는 가지였다. 뜻은 여기 적고 코드에서는 지운다(작업규칙 9).
 *
 * ⚠**남은 구멍 하나**: 가장 새로운 시즌이 끝나고 다음 시즌 첫 경기가 들어오기 전(11월~이듬해 3월)
 * 에는 `heldTo` 가 그대로라 이 함수가 `false` 를 낸다. 그 창에서는 최종전에 나온 선수의 기록이
 * 계속 「今」이 된다(2026-08-21 실측 기준 그 대상은 135장). 그것을 닫으려면
 * `query.ts` 의 `seasonIsOver(db, season)` 가 `PlayerPageData` 까지 와야 한다 —
 * **여기서 대신 날짜로 어림하지 않는다.** 어림하면 수집 지연과 시즌 종료가 같은 신호가 된다.
 */
export function seasonSurelyOver(season: number, heldTo: number): boolean {
  return season < heldTo;
}

function renderBlock(id: BlockId, d: PlayerPageData, base: string, seasonPast: boolean): RawHtml {
  switch (id) {
    case "standard":
      if (d.role === "pitcher" && d.pitching !== null) return standardPitching(d.pitching);
      if (d.batting !== null) return standardBatting(d.batting);
      return block({ id: "standard", title: "基本成績", body: html`<p class="empty">成績がありません。</p>` });
    case "advanced":
      if (d.role === "pitcher" && d.pitching !== null) return advancedPitching(d.pitching);
      if (d.batting !== null) return advancedBatting(d.batting, d.bats);
      return block({ id: "advanced", title: "セイバーメトリクス", body: html`<p class="empty">成績がありません。</p>` });
    case "rolesplit":
      if (d.pitching !== null) return roleSplitBlock(d.pitching);
      return block({ id: "rolesplit", title: "先発・救援別", body: html`<p class="empty">登板がありません。</p>` });
    case "streak":
      if (d.streaks !== null) return streakBlock(d.streaks, d.season, d.asOf, seasonPast);
      return block({ id: "streak", title: "連続記録", body: html`<p class="empty">打席がありません。</p>` });
    case "splits":
      return splitsBlock(d.splits);
    case "scorebook":
      return scorebookBlock(d.scorebook, d.scorebookTotal, base);
    case "situation":
      return situationBlock(d.situation, d.leagueName, d.bunts);
    case "timesthrough":
      return timesThroughBlock(d.timesThrough);
    case "count":
      // ⚠**「0」이 아니라 「기록이 없다」다**(M11·M12) — 이 선수의 타석 로그가 없다는 뜻이다
      if (d.count === null) {
        return block({ id: "count", title: "カウント別", body: html`<p class="empty">打席の記録がありません。</p>` });
      }
      // ⚠**「기록이 없다」와 「하나도 못 읽었다」를 가른다**(M7·M12). 앞의 문장을 뒤의 상태에 쓰면
      //   화면이 거짓말을 하고(타석은 있다), 격리한 수가 어디에도 안 나가 조용한 실패가 된다
      if ("quarantinedOnly" in d.count) {
        return block({
          id: "count",
          title: "カウント別",
          qualifier: `${d.count.quarantinedOnly}打席を隔離`,
          body: html`<p class="empty">打席はありますが、ボールカウントを1件も読み取れませんでした（${d.count.quarantinedOnly}打席）。
            数値を出す根拠がないので、この欄は空にしています。</p>`,
        });
      }
      return countBlock(d.count, d.role);
    case "relief":
      if (d.relief !== null) return reliefBlock(d.relief);
      return block({
        id: "relief",
        title: "火消し",
        // ⚠**「0回」로 쓰지 않는다** — 이 투수는 아예 이닝 도중 등판을 한 적이 없다는 사실이다
        body: html`<p class="empty">イニング途中からの登板がありません（先発だけ、または回のはじめからの登板だけです）。</p>`,
      });
    case "matchup":
      return matchupBlock(
        d.matchups,
        d.matchupTotal,
        d.role === "pitcher" ? "打者" : "投手",
        d.matchupsCareer,
      );
    case "career":
      return careerBlock(d.career);
    case "ranking":
      return rankingBlock(d.ranking, base);
  }
}

/** `block()`이 내는 첫 태그. 여기가 바뀌면 숨김 처리가 조용히 안 먹는다. */
const BLOCK_OPEN = '<section class="block"';

/**
 * 프리셋 밖의 블록을 접어 둔다.
 *
 * ⚠**조용히 실패하면 전 블록이 펼쳐진 페이지가 나간다.** 마크업이 바뀌면 던진다(M7의 정신).
 */
function hidden(rendered: RawHtml): RawHtml {
  if (!rendered.__raw.startsWith(BLOCK_OPEN)) {
    throw new Error(`블록 마크업이 바뀌었다 — 숨김 처리가 깨진다: ${rendered.__raw.slice(0, 60)}`);
  }
  return raw(`${BLOCK_OPEN} hidden${rendered.__raw.slice(BLOCK_OPEN.length)}`);
}

/**
 * 클라이언트에 실을 카탈로그. **서버가 그린 것과 같은 목록**이어야 한다.
 * @see blocks.ts — 목록은 거기 1벌만 있다
 *
 * ⚠**실행되는 스크립트가 아니라 데이터다**(2026-08-18 감사 P2 대응).
 * 예전에는 `window.__BLOCKS__=[…]` 라는 **인라인 스크립트**를 페이지마다 심었는데,
 * 그것 하나 때문에 CSP 의 `script-src` 를 닫을 수 없었다 — 내용이 페이지마다 달라
 * 해시로 허용할 수도 없고, `unsafe-inline` 을 열면 CSP 를 넣는 뜻이 사라진다.
 * → `<script type="application/json">` 은 **브라우저가 실행하지 않는 데이터 블록**이라
 *   `script-src 'self'` 아래에서도 그대로 남는다. 이제 인라인 실행 스크립트가 0개다.
 */
export function bootstrapFor(role: "batter" | "pitcher"): string {
  const blocks = blocksFor(role).map((b) => ({ id: b.id, name: b.name, desc: b.desc }));
  const presets: Record<string, string[]> = {};
  for (const p of presetsFor(role)) presets[p.id] = [...p.blocks];
  return JSON.stringify({ blocks, presets });
}

export function renderPlayerPage(d: PlayerPageData, ctx: RenderContext): string {
  const { base, root, seasons, navTo } = ctx.paths(`players/${d.playerId}.html`);
  const catalog = blocksFor(d.role);
  const initial = new Set(presetsFor(d.role).find((p) => p.id === "standard")?.blocks ?? []);
  /**
   * ⚠**연속기록의 「今」이 이것에 걸린다.** 근거는 `freshness` 하나이고 페이지 데이터가 아니다 —
   * `heldTo` 는 `SELECT MAX(season) FROM game`(query.ts `heldSeasonsOf`)이라 **시즌을 안 가린다.**
   */
  // ⚠**두 근거를 같이 쓴다.** `seasonSurelyOver` 는 「더 새 시즌이 있다」이고,
  //   `d.seasonOver` 는 거기에 **일본시리즈 결착**까지 더한 것이다(query.ts `seasonIsOver`).
  //   둘 다 `true` 만 증명이고 `false` 는 「모른다」라, **OR 가 안전한 방향**이다.
  //   ⚠앞의 것을 지우지 않는다 — `freshness.heldTo` 는 이 페이지가 보는 유일한 「사이트 전체」 신호다.
  const seasonPast = d.seasonOver || seasonSurelyOver(d.season, ctx.freshness.heldTo);

  const body = html`${idLine(d, base)}
${rail(d)}
${editor()}
${catalog.map((meta) => {
    const rendered = renderBlock(meta.id, d, base, seasonPast);
    // JS가 없어도 「標準」은 보인다. 나머지는 조립에서 켜면 나온다.
    return initial.has(meta.id) ? rendered : hidden(rendered);
  })}
<div id="blocksEnd" hidden></div>
<!-- ⚠**조립 대상 밖에 둔다.** 이 구획은 b- 접두사를 쓰지 않으므로 블록 조립이 건드리지 않고,
     기준점(#blocksEnd) 뒤에 있어 순서를 바꿔도 늘 성적 아래에 남는다.
     ⚠**위 성적에 포함되지 않는다는 것을 그 구획이 스스로 말한다**(§2-1). -->
${postseasonBrief(d.postseason, base)}
<nav class="find" aria-label="ほかの選手">
  <a href="${base}${teamPath(d.teamCode)}">${d.teamName}</a> · <a href="${base}${ROSTER_PATH}">選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `${d.name} — ${d.teamName} ${d.season}年`,
    base,
    root,
    seasons,
    navTo,
    color: d.color,
    spine: `${d.teamName}　${d.name}`,
    freshness: ctx.freshness,
    site: ctx.site,
    hasPostseason: ctx.hasPostseason,
    /**
     * ⚠**선수 페이지는 `選手一覧` 구획 안이다.**
     *
     * 예전에는 `nav: "player"` 였는데 내비에 `選手` 항목이 없어서 **어느 링크에도
     * `aria-current` 가 붙지 않았다** — 이 화면들만 「지금 어디에 있는가」가 통째로 빈 채였다.
     * 실측(2026-08-19): dist 6,207장. `topbar-consistency` 가 최상위 11장만 보고 있어서
     * 아무도 못 봤고, 재귀시키자 드러났다.
     * ⚠**`page` 가 아니라 `true` 다** — 이 화면은 選手一覧 그 자체가 아니다(navExact:false).
     */
    nav: "index",
    navExact: false,
    body,
    bootstrapJs: bootstrapFor(d.role),
  });
}

/** 임계값을 코드에만 두지 않는다 — 테스트가 이 값을 고정한다. */
/**
 * 타구 성향의 최소 표본.
 *
 * ⚠**분모가 축마다 다르므로 임계값도 축마다 다르다**(M2). 아웃·타구·내야타구·삼진은 서로 다른 표본이다.
 * 값은 「이보다 얇으면 모양이 요동친다」는 실측 감각에서 잡았고, 순위를 매기지 않으므로
 * 자격 기준(M3)이 아니라 **표시 임계값**이다.
 */
const MIN_BATTED = 100;
const MIN_DIRECTION = 150;
const MIN_INFIELD = 60;
const MIN_STRIKEOUT = 50;

export const THRESHOLDS = { situationPa: THIN_SITUATION_PA, matchupPa: THIN_MATCHUP_PA };

export { BASE_LABEL, BASE_ORDER };
