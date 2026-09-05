/**
 * 페이지 셸 — 배면(背表紙)·신선도 띠·꼬리말.
 *
 * ⚠**꼬리말은 장식이 아니라 법적 안전장치다**(L3·L4). 출처 명기와 삭제·정정 요청 창구는
 * 전 화면에 있어야 한다. 지우지 마라.
 */
import { html, raw, toString } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { TeamColor } from "@bb-app/domain";
import { fullDate } from "./format.ts";

/**
 * 화면의 빈 상태(M12).
 * ⚠**「데이터 없음」과 「수집 실패」를 같은 화면으로 만들지 마라.** 그 자체가 결함이다.
 *
 * ⚠⚠**넷이 아니라 여섯이다**(2026-09-05 · 드래프트 화면에서 늘었다). **넷으로는 말할 수 없는
 * 사실이 둘 있었고, 둘 다 `empty` 로 접으면 거짓이 된다:**
 *
 * | 새 상태 | 무엇이 참인가 | `empty` 로 접으면 |
 * |---|---|---|
 * | `unpublished` | **출처가 그 값을 공표하지 않는다.** 사실은 실재했다 | 「그 해엔 그런 일이 없었다」로 읽힌다 |
 * | `uncollected` | **출처에는 있는데 우리가 아직 안 받았다** | **미수집을 0 으로 메우는 쪽**이다(M11) |
 *
 * ⚠**둘을 하나로 합치지 마라 — 고칠 수 있는 사람이 다르다.** `unpublished` 는 우리가
 * 아무리 해도 안 열리고(출처가 표시를 껐다), `uncollected` 는 **우리 몫의 남은 일**이다.
 * 화면에 같은 문장이 나가면 「언젠가 채워지겠지」와 「영영 안 채워진다」가 구별되지 않는다.
 *
 * ⚠**실측 사례**(드래프트): 2023~2025 의 추첨 결과는 npb.jp 가 **표시를 껐다**
 * (2023 야쿠르트 페이지엔 그 문장이 HTML 주석 안에 남아 있다) → `unpublished`.
 * 후일담(입단 거부·교섭권 정정)은 소스에 있는데 **파서가 없다** → `uncollected`.
 */
export type DataState =
  | { kind: "ok" }
  | { kind: "empty"; detail: string }
  | { kind: "failed"; detail: string }
  | { kind: "offseason"; detail: string }
  /** ⚠**출처가 공표하지 않는다.** 우리가 못 얻은 게 아니다 — 탓을 우리에게 돌리지 마라 */
  | { kind: "unpublished"; detail: string }
  /** ⚠**우리가 아직 수집하지 않는다.** 출처에는 있다 — 「없었다」로 그리면 거짓이다 */
  | { kind: "uncollected"; detail: string };

/** 정적 생성이므로 「로딩」은 페이지 단위로는 존재하지 않는다 — 클라이언트가 가져오는 검색 색인에만 있다. */
export function stateNote(state: DataState): RawHtml {
  switch (state.kind) {
    case "ok":
      return raw("");
    case "empty":
      return html`<p class="empty">${state.detail}</p>`;
    case "failed":
      return html`<p class="empty" role="status">取得できていません — ${state.detail}</p>`;
    case "offseason":
      return html`<p class="empty">シーズン外 — ${state.detail}</p>`;
    case "unpublished":
      return html`<p class="empty">公表されていません — ${state.detail}</p>`;
    case "uncollected":
      return html`<p class="empty">まだ収集していません — ${state.detail}</p>`;
  }
}

export interface Freshness {
  /** 아카이브에 들어온 가장 최근 경기일 `YYYY-MM-DD` */
  latestGameDate: string | null;
  /** 이 사이트를 만든 날 `YYYY-MM-DD`. **주입된 시계에서 온다**(M6) */
  builtOn: string;
  /**
   * **우리가 실제로 보유한 시즌 범위.**
   *
   * ⚠**화면이 이것을 하드코딩하고 있었다.** 「当サイトは2025年からの記録しか持っていない」이
   * 코드 4곳·주석 5곳에 박혀 있었는데 실제로는 **2022~2026 5시즌**이다 —
   * 실측 **1,864/3,510장**의 선수 페이지가 그 거짓말을 싣고 있었다(2026-08-18 다방면 감사 P2).
   * 백필할 때마다 사람이 문구를 고쳐야 하는 구조였고, 그래서 안 고쳐졌다.
   * ⚠**데이터에서 받는다** — 다음 백필에는 저절로 맞는다.
   */
  heldFrom: number;
  heldTo: number;
  /**
   * **이 시즌이 끝났는가.** 판정은 `query.ts` 의 `seasonIsOver` 한 벌이다(M1).
   *
   * ⚠**신선도 판정이 이걸 몰라서 오프시즌에 매일 거짓말을 했다**(2026-08-21 반증 라운드 P1).
   * 그전까지 근거는 `pastSeasonOf(seasons)` 하나였는데, 그건 **「그리는 시즌 번호가
   * 최신이 아닌가」라는 순수 구조 판정**이라, 최신 시즌이 끝나고 다음 시즌 첫 경기가
   * 들어오기 전(11월~3월)에는 `false` 다. 그 창에서 화면은 수집이 멀지 않았는데도
   * 「取得に失敗している可能性があります」를 매일 냈다.
   *
   * ⚠**여기 둔 이유**: 화면은 전부 `ctx.freshness` 를 그대로 넘기므로,
   * 이 한 필드가 **호출부 15곳을 안 건드리고** 전 화면에 닿는다.
   * ⚠**`true` 는 증명이고 `false` 는 「모른다」다**(M11) — 경고를 **끄는 쪽으로만** 쓴다.
   */
  seasonOver: boolean;
  /** 경기일과 생성일의 간격(일). null이면 경기가 하나도 없다 */
  lagDays: number | null;
  /**
   * **정규시즌**의 가장 최근 경기일. `latestGameDate`와 다를 수 있다.
   *
   * ⚠**띠는 사이트 공통인데 화면 대부분은 정규시즌만 싣는다.** 둘이 갈리는 시기
   * (포스트시즌·올스타 휴식기)에 「最新の試合 10月19日 まで反映」이라고만 쓰면,
   * 10월 5일까지밖에 안 담긴 순위표 위에서 그 문장이 거짓이 된다.
   * 다르면 **둘 다 적는다** — 어느 쪽도 숨기지 않는 것이 답이다.
   */
  regularGameDate: string | null;
}

/** 며칠까지를 「최신」으로 볼 것인가. 하루 1회 배치라 전날 경기까지가 정상이다. */
export const STALE_AFTER_DAYS = 3;

export function isStale(f: Freshness): boolean {
  return f.lagDays === null || f.lagDays > STALE_AFTER_DAYS;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function freshness(
  latestGameDate: string | null,
  builtOn: string,
  regularGameDate: string | null = latestGameDate,
  /**
   * 보유 시즌 범위. ⚠**기본값을 두지 않는다면 좋겠지만** 호출자가 여럿이라 뒀다 —
   * 대신 **0이 아니라 「모른다」로 읽히는 값**을 쓴다(M11). 화면은 0이면 범위를 말하지 않는다.
   */
  held: { from: number; to: number } = { from: 0, to: 0 },
  /**
   * 이 시즌이 끝났는가. ⚠**기본값이 `false` 인 것이 안전 방향**이다 —
   * 모르면 경고하는 쪽으로 남는다(M11).
   */
  seasonOver = false,
): Freshness {
  return {
    latestGameDate,
    builtOn,
    lagDays: latestGameDate === null ? null : daysBetween(latestGameDate, builtOn),
    regularGameDate,
    heldFrom: held.from,
    heldTo: held.to,
    seasonOver,
  };
}

/**
 * 보유 범위를 사람이 읽는 한 줄로. 모르면 빈 문자열이다(M11 — 0을 「0년」이라 쓰지 않는다).
 *
 * ⚠**이 문장을 하드코딩하지 마라.** 백필할 때마다 사람이 고쳐야 하는 구조였고, 그래서 안 고쳐졌다 —
 * 실측 1,864장이 「2025年から」라는 낡은 거짓말을 싣고 있었다(2026-08-18 감사 P2).
 */
export function heldRange(f: Freshness): string {
  if (f.heldFrom === 0 || f.heldTo === 0) return "";
  return f.heldFrom === f.heldTo ? `${f.heldFrom}年` : `${f.heldFrom}〜${f.heldTo}年`;
}

/**
 * 신선도 띠. **낡았을 때만 눈에 띄게** 한다 — 정상일 때 경고색을 쓰면 경고가 소음이 된다.
 *
 * @param pastSeason 지난 시즌의 화면인가.
 *   ⚠**끝난 시즌에 「更新が止まっています」라고 쓰지 마라.** 수집이 죽은 것이 아니라
 *   시즌이 끝난 것이고, 경고를 남발하면 진짜 경고가 안 보이게 된다.
 *   실측(2026-08-16): 2025년 화면 2,307장 전부가 「315일 전」이라는 빨간 띠를 달고 있었다.
 */
export function freshnessBar(f: Freshness, pastSeason = false): RawHtml {
  // ⚠**두 근거를 합친다.** `pastSeason` 은 「시즌 번호가 최신이 아니다」이고
  // `f.seasonOver` 는 「그 시즌이 실제로 끝났다」이다 — 둘 다 `true` 만 증명이라
  // **OR 가 안전한 방향**이다. 오프시즌의 현행 시즌은 뒤쪽만 참이다.
  if (pastSeason || f.seasonOver) {
    return f.latestGameDate === null
      ? html`<div class="state fresh">このシーズンの試合はありません</div>`
      : html`<div class="state fresh">終了したシーズンです — 最後の試合は ${fullDate(f.latestGameDate)}</div>`;
  }
  if (f.latestGameDate === null) {
    return html`<div class="state stale" role="status">
      <b>データがありません</b> — まだ試合を取り込んでいません
    </div>`;
  }
  const latest = fullDate(f.latestGameDate);
  // ⚠정규시즌이 다른 날에서 멈춰 있으면 **그것도 적는다** — 화면 대부분이 싣는 것은 그쪽이다
  const regular =
    f.regularGameDate === null || f.regularGameDate === f.latestGameDate
      ? raw("")
      : html`（レギュラーシーズンは ${fullDate(f.regularGameDate)} まで）`;
  if (isStale(f)) {
    return html`<div class="state stale" role="status">
      <b>更新が止まっています</b> — 最新の試合は ${latest}（${f.lagDays}日前）。取得に失敗している可能性があります
    </div>`;
  }
  return html`<div class="state fresh">最新の試合 ${latest} まで反映${regular}</div>`;
}

export interface SiteMeta {
  /** 제품명 미확정 — 확정 전에는 `bb-app`(CLAUDE.md §7) */
  name: string;
  /** 삭제·정정 요청 창구(L4). **비어 있으면 화면이 그 사실을 말한다** */
  contact: string;
}

/** `contactGate` 의 판정. `fatal` 이면 호출자가 종료 코드를 세운다 */
export interface ContactGate {
  /** 창구가 비어 화면에 **개발자 지시문**이 나가는 상태인가 */
  missing: boolean;
  /** 빌드를 실패로 만들 것인가 */
  fatal: boolean;
  /** 로그에 낼 문장. `missing` 이 false 면 빈 문자열 */
  message: string;
}

/**
 * **연락처가 없는 채로 배포되는 것을 막는다**(L4 · 2026-08-20).
 *
 * ⚠**빈 값일 때 화면이 조용하지 않다** — 꼬리말이
 * 「連絡先が未設定です（公開前に設定してください）」라고 **개발자에게 하는 말**을 방문자에게 낸다.
 * 그 꼬리말은 15,340장 전부에 있으므로, 시크릿이 비는 날 **제품 문면이 통째로 그렇게 나간다.**
 * 그런데 신호는 `console.warn` 하나뿐이라 종료 코드가 0이었다 — `emptySeasons`·`stale`·
 * `raceDisagreed` 와 같은 등급이어야 하는데 혼자 경고였다(M7 의 「알아챌 수 있게」에 반만 닿음).
 *
 * ⚠**로컬 빌드를 막지 않는다.** 연락처는 시크릿 스토어에만 있어(코드·리포에 두지 않는다 · §6)
 * 개발자 머신에서는 **항상 비어 있는 것이 정상**이다. 여기서 무조건 세우면 로컬 빌드가
 * 매번 실패하고, 그러면 **진짜 신호가 소음에 묻힌다**(daily.yml 이 이미 적어 둔 함정).
 *
 * ⚠**그래서 「배포하는 쪽만」 켠다** — `BB_REQUIRE_CONTACT=1`.
 * `BB_REQUIRE_DIST`·`BB_REQUIRE_DB` 와 **같은 형식**이다: 기본은 조용하고, CI 가 켠다.
 * 켜는 자리는 `.github/workflows/daily.yml` 의 「화면 생성」 단계이고, 그 단계가
 * `secrets.BB_CONTACT` 를 넘기는 바로 그 자리다 — 시크릿이 사라지면 같은 줄에서 걸린다.
 *
 * @param contact `BB_CONTACT` 를 거친 뒤의 값(미설정이면 빈 문자열)
 * @param requireContact `process.env["BB_REQUIRE_CONTACT"]`
 */
export function contactGate(contact: string, requireContact: string | undefined): ContactGate {
  if (contact !== "") return { missing: false, fatal: false, message: "" };
  const fatal = requireContact === "1";
  return {
    missing: true,
    fatal,
    message: fatal
      ? "⚠ BB_CONTACT 미설정 — 꼬리말에 「連絡先が未設定です（公開前に設定してください）」가 " +
        "전 화면에 그대로 나간다(L4). BB_REQUIRE_CONTACT=1 이므로 배포하지 않는다"
      : "⚠ BB_CONTACT 미설정 — 삭제·정정 요청 창구가 화면에 나오지 않는다(공개 전 필수). " +
        "로컬 빌드라 실패로 만들지 않는다 — CI 는 BB_REQUIRE_CONTACT=1 로 막는다",
  };
}

/**
 * 選手一覧의 경로. **한 곳에서만 만든다**(M1) — 갈리면 어딘가는 404다.
 *
 * ⚠**사이트 루트(`index.html`)는 2026-08-17부터 대시보드다.** 그전에는 여기가 선수 일람이었고,
 * 12곳이 `index.html` 을 「선수 일람」이라는 뜻으로 가리키고 있었다. 상수로 모아 두지 않으면
 * 다음에 또 옮길 때 몇 군데가 조용히 남는다 — `teamPath` 와 같은 이유다.
 */
export const ROSTER_PATH = "players.html";

/**
 * 球団一覧의 경로. **한 곳에서만 만든다**(M1) — 갈리면 어딘가는 404다.
 *
 * ⚠**여기 있는 이유는 내비가 이 값을 쓰기 때문이다**(`ROSTER_PATH`와 같은 사정).
 * 원래는 `teams-page.ts`에 있었는데, 내비가 그쪽을 import 하면 **layout ↔ teams-page 순환**이 된다.
 * ⚠`site.ts`의 파일 목록과 `seasonPaths`가 **같은 이 값을 봐야 한다.**
 * 갈리면 시즌 전환이 없는 페이지를 가리키고, 그건 404이며 조용하다.
 */
export const TEAMS_PATH = "teams.html";

/**
 * 전역 헤더에서 지금 어디에 있는지. `aria-current`로 나간다.
 *
 * ⚠**내비에 자리가 없는 키를 만들지 마라.** 그 키를 쓴 화면은 헤더에 「지금 여기」가
 * 하나도 없는 채로 나간다 — `"player"` 가 정확히 그랬고, 그 상태로 dist 6,207장이
 * 배포돼 있었다(2026-08-19). 선수 페이지는 `選手一覧` 구획(`"index"` + navExact:false)에 속한다.
 * ⚠**여기서 지운 이유는 컴파일이 막아 주기 때문이다** — 시험보다 이르고 확실하다.
 * (`"home"` 은 예외다: 탭줄이 아니라 **브랜드 링크**가 그 표시를 받는다.)
 */
/**
 * 상단 내비의 항목 키.
 *
 * ⚠**내비에 없는 화면은 「지금 여기」 표시가 통째로 사라진다.**
 * 선수 페이지가 그랬다(예전 `nav:"player"` · 그 이름의 항목이 없었다).
 * 용어집도 처음엔 푸터 링크만 두었다가 같은 자리에 걸렸다 —
 * `topbar-consistency.test.ts` 가 **전수 중 한 장**을 잡았다.
 * ⚠**「내비가 좁아서 못 넣는다」는 근거를 쓰지 마라** — `.tnav` 는 `flex-wrap` 이 꺼진
 * **가로 스크롤** 줄이다(2026-08-19 수정). 항목이 하나 늘어도 바가 깨지지 않는다.
 * ⚠**용어집·수집로그는 시즌별이 아니라 사이트에 한 장이다** — 링크는 `o.root` 로 간다.
 *   `o.base` 로 두면 과거 시즌 화면이 전부 404 가 된다.
 */
export type NavKey =
  | "today"
  | "home"
  | "index"
  | "ranking"
  | "matchup"
  | "compare"
  | "log"
  | "glossary"
  | "postseason"
  | "team";

/**
 * 시즌 전환의 한 칸.
 *
 * ⚠**같은 화면의 다른 시즌으로 보낸다.** 2026 순위표를 보다가 2025를 누르면 2025 순위표여야지
 * 첫 화면으로 튕기면 안 된다.
 * ⚠**없는 화면으로 링크하지 않는다.** 2026에만 있는 선수의 2025 페이지는 존재하지 않는다 —
 * 그때는 그 시즌의 선수 일람으로 보내고, 읽어 주는 화면이 그 사실을 말한다.
 */
export interface SeasonLink {
  season: number;
  /** 이 페이지에서 본 상대 경로 */
  href: string;
  current: boolean;
  /** 같은 화면이 없어서 다른 곳으로 보내는가 */
  fallback: boolean;
  /** 보내는 곳의 이름. ⚠**어디로 가는지 말하지 않는 링크는 눌러 보기 전에는 알 수 없다** */
  fallbackTo: string;
}

export interface PageOptions {
  title: string;
  /**
   * **그 시즌의 루트**까지의 상대 경로. 시즌 안의 링크는 전부 이걸 쓴다.
   * 현재 시즌의 최상위는 `""`, `players/` 아래는 `"../"`.
   */
  base: string;
  /**
   * **사이트 루트**까지의 상대 경로. 자산(CSS·JS)과 시즌 전환이 쓴다.
   *
   * ⚠현재 시즌은 `base`와 같지만, 과거 시즌은 한 단계 더 위다(`2025/players/x.html` → `../../`).
   * 둘을 하나로 합치면 과거 시즌에서 CSS가 조용히 404가 된다.
   */
  root: string;
  /** 시즌 전환. 시즌이 하나뿐이면 빈 배열 — 그때는 띠를 그리지 않는다 */
  seasons: readonly SeasonLink[];
  color: TeamColor;
  /** 배면에 세로로 넣을 문자열. 없으면 배면은 색만 낸다 */
  spine?: string;
  freshness: Freshness;
  site: SiteMeta;
  nav: NavKey;
  /**
   * 이 화면이 그 내비 항목의 **바로 그 페이지**인가.
   *
   * ⚠**`aria-current="page"`는 「이 링크가 지금 문서다」라는 뜻이다.** 試合 구획에 속하지만
   * `today.html`이 아닌 화면(경기 상세·날짜별·予告先発)에서 그 링크에 `page`를 붙이면
   * **다른 문서를 가리키는 링크를 「지금 여기」라고 말하는 것**이 된다.
   * 그런 화면은 `false`로 두고 `aria-current="true"`(구획 안에 있다)만 낸다.
   */
  navExact?: boolean;
  /**
   * 이 화면이 **어느 구단의 상세**인가. 구단 상세가 아니면 넘기지 않는다.
   *
   * ⚠**클라이언트가 `aria-current` 를 다시 재는 유일한 근거다**(2026-08-19 T9 검토 ④).
   * 최애를 지정하면 클라이언트가 내비 첫 항목의 목적지를 `teams.html` → `teams/{최애}.html` 로
   * 바꾼다. 그러면 서버가 적어 둔 말이 그 링크에 대해 더는 참이 아닐 수 있는데,
   * **「지금 이 화면이 바로 그 구단의 문서인가」는 서버만 안다.**
   * 이 값이 없으면 巨人 화면에서 「阪神」이라고 적힌 링크가 `aria-current="true"` 를 달고 남는다 —
   * 현재 항목이 아닌 것을 현재라고 말하는 것이다.
   * ⚠**전 페이지에 실리는 헤더다** — 그래서 구단 상세가 아니면 `data-navteam` 을 값 없이 둔다.
   * 실측 분모: 구단 상세는 **108장**(12구단 × 9시즌)이고 나머지 **15,232장**은 값이 없다 —
   * 거기에 `=""` 를 적으면 3B × 15,232 를 매 배포마다 더 나른다.
   */
  navTeam?: string;
  /** 이 시즌에 ポストシーズン 기록이 있는가. 없으면 내비에 항목을 내지 않는다 */
  hasPostseason?: boolean;
  /** 본문. 블록들이 여기 들어간다 */
  body: RawHtml;
  /**
   * 클라이언트에 실어 보낼 **데이터**(블록 카탈로그 등). JSON 문자열이다.
   * ⚠**이름은 `bootstrapJs` 지만 이제 JS 가 아니다** — `type="application/json"` 데이터 블록으로 나간다.
   */
  bootstrapJs?: string;
}

/**
 * 전역 헤더.
 *
 * ⚠**검색과 이동은 어느 화면에서나 손에 닿아야 한다.** 최하단 링크 하나로 두면
 * 1000행짜리 순위표 아래에 묻히고, 모바일에서는 사실상 없는 기능이 된다.
 */
function topbar(o: PageOptions): RawHtml {
  const here = (key: NavKey): RawHtml =>
    o.nav === key ? raw(o.navExact === false ? ' aria-current="true"' : ' aria-current="page"') : raw("");
  /**
   * 구단 항목의 표식. 값은 **이 화면이 어느 구단의 상세인가**이고, 구단 상세가 아니면 값이 없다.
   *
   * ⚠**속성을 `raw()` 안에서 문자열로 짓지 않는다**(2026-08-18 감사 P3 · teams-page.ts 가 같은 말을
   * 적어 뒀다). 그 안의 값은 이스케이프를 거치지 않아 따옴표 하나로 속성이 끊긴다 —
   * 조각째 `html` 에 넘기면 그 자리가 영구히 이스케이프를 거친다.
   */
  const teamMark = o.navTeam === undefined ? raw(" data-navteam") : html` data-navteam="${o.navTeam}"`;
  /**
   * ⚠**검색 드롭다운을 `listbox`/`combobox` 라고 부르지 않는다**(2026-08-20 유저 결정).
   *
   * 이 목록에는 **결과가 아닌 줄**이 섞인다 — 「該当なし」·「読み込み中…」과 끝의 안내줄이다.
   * 거기에 `role="option"` 을 붙였다가 **그 안의 링크가 눌리지 않는 것이 실기에서 잡혔고**
   * (2026-08-19 Playwright), 롤을 빼면 이번에는 포커스 모드의 낭독기가 그 줄을 못 읽었다.
   * → **listbox 라고 부르는 것 자체를 그만둔다.** 그러면 전부 그냥 링크가 된다.
   *
   * ⚠**`role="list"` 는 남긴다** — `.qhits` 가 `list-style:none` 이고 Safari 는 그 스타일이 붙은
   * `<ul>` 에서 목록 시맨틱을 떼어 간다. 롤이 사라지면 계산된 롤이 generic 이 되어
   * `aria-label` 이 조용히 안 읽힌다. `list` 는 `listbox` 와 달리 조작을 약속하지 않는다.
   * ⚠**`role="status"` 한 줄이 필요하다** — combobox 를 그만두면 「목록이 열렸다」를 말해 주던 것이
   * 통째로 사라진다. **서버가 미리 그려 둔다**: 라이브 영역은 갱신 **전에** DOM 에 있어야 읽힌다.
   * ⚠**세 곳이 같은 구조다**(여기 · `pages.ts` 의 対戦を選ぶ · `compare.ts`). 한 곳만 고치면
   * 화면마다 갈리므로 `layout.test.ts` 가 소스 전체에서 그 롤들을 센다.
   */
  return html`<header class="topbar">
  <!-- ⚠**브랜드는 홈으로 간다.** 2026-08-17부터 홈은 대시보드이고, 선수 일람은 위 ROSTER_PATH 다 -->
  <a class="brand" href="${o.base}index.html"${here("home")}>${o.site.name}<b>by Lunomel</b></a>
  <div class="qbox">
    <input id="q" type="search" autocomplete="off" placeholder="選手を検索" aria-label="選手を検索">
    <ul class="qhits" id="qhits" role="list" aria-label="検索結果" hidden></ul>
    <p class="vh" data-hitstatus role="status"></p>
  </div>
  <nav class="tnav" aria-label="主要ページ">
    ${/* ⚠**첫 자리다**(2026-08-18 유저 요청). 최애를 지정하면 클라이언트가 라벨과 링크를
         그 구단으로 바꾼다(data-navteam 이 그 표식이다). **서버는 항상 「球団」을 그린다** —
         JS 가 없어도 구단으로 가는 길이 있어야 하고(§0-1), 지금까지는 그 길이 아예 없었다
         (순위표에서 팀명을 눌러야만 닿았다).
         ⚠**HTML 주석으로 쓰지 않는다.** 이 헤더는 전 페이지에 실린다 — 실측으로 이 주석 하나가
            424B 이고 15,340장이면 약 6.5MB 를 매 배포마다 나른다. teams-page.ts 가 같은 이유로
            정한 규칙이 있다: 왜는 소스에 남기고 나가는 것은 마크업만 남긴다.
         ⚠**아래 세 개는 아직 HTML 주석이다**(합계 733B/장 ≈ 11MB). 같이 옮길지는 별건이다. */ ""}
    <a href="${o.base}${TEAMS_PATH}"${teamMark}${here("team")}>球団</a>
    <a href="${o.base}today.html"${here("today")}>試合</a>
    <a href="${o.base}${ROSTER_PATH}"${here("index")}>一覧</a>
    <a href="${o.base}ranking.html"${here("ranking")}>順位</a>
    <a href="${o.base}matchup.html"${here("matchup")}>対戦</a>
    <a href="${o.base}compare.html"${here("compare")}>比較</a>
    <!-- ⚠**기록이 있는 시즌에만 낸다.** 2026년은 아직 포스트시즌이 없다 —
         눌러도 빈 화면이 나오는 항목은 고장으로 읽힌다 -->
    <!-- ⚠**이름을 「PS」로 두지 않는다.** 올스타뿐인 시즌도 여기로 오므로
         포스트시즌이라고 부르면 틀린다. 「레귤러 시즌 밖의 경기」가 이 항목이 담는 것이다 -->
    ${o.hasPostseason ? html`<a href="${o.base}postseason.html"${here("postseason")}>他大会</a>` : raw("")}
    <!-- ⚠수집 로그는 시즌별이 아니라 사이트 전체다(「언제 어디서 데이터가 들어왔나」).
         과거 시즌에는 만들지 않으므로 링크는 root로 현재 시즌의 것을 가리킨다.
         base로 두면 2025 화면 2,307장이 전부 404가 된다(2026-08-16 실측 1,585종). -->
    <a href="${o.root}glossary.html"${here("glossary")}>用語</a>
    <a href="${o.root}log.html"${here("log")}>記録</a>
  </nav>
  <!-- ⚠**보이는 글자가 이름 안에 있어야 한다**(WCAG 2.5.3 label-in-name · 2026-08-18 감사 P3).
       예전 초기값은 이름이 「表示テーマ」인데 보이는 글자는 「自動」이라, 음성으로
       「自動」이라고 말해도 눌리지 않았다. JS 가 뜨면 스스로 고쳤지만 **그 전까지가 틀렸다.**
       서버가 처음부터 JS 와 같은 문장을 쓴다(assets.ts applyTheme 과 같은 형식). -->
  <button class="tbtn" type="button" id="themeBtn" aria-label="表示テーマ：自動（切り替え）">自動</button>
</header>`;
}

/**
 * 시즌 전환 띠.
 *
 * ⚠**시즌이 하나뿐이면 그리지 않는다.** 고를 것이 없는 조작은 화면을 무겁게 할 뿐이다.
 * ⚠**「シーズン」이라고 이름을 붙인다.** 연도 두 개만 떠 있으면 그게 무엇을 고르는 것인지
 *   알 수 없다 — 순위표의 리그 탭과 헷갈린다.
 * ⚠**같은 화면의 다른 시즌으로 간다.** 그 시즌에 같은 화면이 없으면(2026에만 있는 선수 등)
 *   그 시즌의 선수 일람으로 보내고, `aria-label`이 그렇게 말한다.
 */
/**
 * 이 페이지가 **지난 시즌**의 것인가.
 *
 * `seasons`는 새 시즌이 앞이므로, 첫 칸이 현재 페이지가 아니면 지난 시즌이다.
 */
/**
 * 푸터의 날짜 도장.
 *
 * ⚠**끝난 시즌에 「오늘 생성」을 찍지 않는다.** 정보가 아닐 뿐 아니라
 * **그 한 글자 때문에 매일 전 페이지가 새 파일이 된다** — 내용이 하나도 안 바뀐
 * 과거 시즌 6,800여 장(약 410MB)을 매일 다시 업로드하고 있었다(2026-08-18 다방면 감사 P1).
 * `wrangler pages deploy` 는 내용 해시로 건너뛸 수 있는데, 그 여지를 우리가 없앤 것이다.
 * ⚠**대신 데이터 기준일을 찍는다** — M4 가 요구하는 것도 「언제까지의 데이터인가」다.
 * ⚠**현재 시즌은 그대로 생성일이다.** 매일 바뀌는 것이 맞고, 사람이 그것을 본다.
 */
function footStamp(o: PageOptions): string {
  if (!isPastSeason(o)) return `${fullDate(o.freshness.builtOn)} 生成`;
  const asOf = o.freshness.regularGameDate ?? o.freshness.latestGameDate;
  return asOf === null ? "終了したシーズン" : `${fullDate(asOf)}までのデータ`;
}

function isPastSeason(o: PageOptions): boolean {
  return pastSeasonOf(o.seasons);
}

/**
 * 지난 시즌의 화면인가 — **본문을 짓는 쪽에서도 알아야 한다.**
 *
 * ⚠신선도 띠만 고치는 것으로는 부족했다. 끝난 시즌의 予告先発 화면이
 * 「発表待ち · 発表は前日〜当日です」라고, 対戦 화면이 「いま投げている投手を選ぶと」라고
 * **현재형으로** 말하고 있었다(2026-08-16 이중 검토 P2).
 */
export function pastSeasonOf(seasons: readonly SeasonLink[]): boolean {
  return seasons.length > 1 && seasons[0]?.current === false;
}

function seasonBar(o: PageOptions): RawHtml {
  if (o.seasons.length < 2) return raw("");
  return html`<nav class="seasons" aria-label="シーズン">
  <span class="slab">シーズン</span>
  ${o.seasons.map(
    (s) =>
      html`<a href="${s.href}"${s.current ? raw(' aria-current="page"') : raw("")}
      ${/* ⚠**속성을 raw() 안에서 문자열로 짓지 않는다**(2026-08-18 감사 P3).
           그 안의 값은 이스케이프를 거치지 않는다 — 따옴표 하나로 속성이 끊긴다.
           table.ts 에서 같은 형태를 없앤 뒤 여기 한 곳이 남아 있었다. */ ""}
      ${s.fallback
        ? html` aria-label="${`${s.season}年（このページの${s.season}年版はありません。${s.fallbackTo}へ移動します）`}"`
        : raw("")}>${s.season}年${s.fallback ? html`<i aria-hidden="true">→</i>` : null}</a>`,
  )}
</nav>`;
}


/**
 * 한 페이지의 경로 정보.
 *
 * ⚠**렌더러가 `base`를 손으로 적지 않는다.** 예전에는 각 렌더러가 `const base = "../"`처럼
 * 깊이를 직접 썼는데, 시즌 접두사가 붙는 순간 그 상수들이 전부 조용히 어긋난다.
 * **자기 경로만 말하면 깊이는 여기서 센다.**
 */
/**
 * 그 시즌에 같은 화면이 없을 때 보낼 곳.
 *
 * ⚠**날짜 화면을 選手一覧으로 보내지 않는다.** 2026-08-13은 2025년에 없지만
 * 「그 시즌의 날짜 일람」은 있다 — 가장 가까운 곳으로 보내는 편이 덜 놀랍다.
 */
export interface Fallback {
  path: string;
  label: string;
}

const DEFAULT_FALLBACK: Fallback = { path: ROSTER_PATH, label: "選手一覧" };

export interface PagePaths {
  base: string;
  root: string;
  seasons: SeasonLink[];
}

/** 한 시즌의 배치 */
export interface SeasonPlan {
  season: number;
  /** 사이트 루트에서 이 시즌까지의 접두사. 현재 시즌은 `""`, 과거는 `"2025/"` */
  prefix: string;
  /** 이 시즌이 실제로 만드는 화면 경로(시즌 안 기준) */
  paths: ReadonlySet<string>;
}

/**
 * 시즌 배치에서 경로 계산기를 만든다.
 *
 * @param plans 전 시즌. **새 시즌이 앞**
 * @param current 지금 그리는 시즌
 */
export function pathsFor(
  plans: readonly SeasonPlan[],
  current: number,
): (selfPath: string, fallback?: Fallback) => PagePaths {
  const me = plans.find((p) => p.season === current);
  const prefixDepth = me === undefined || me.prefix === "" ? 0 : me.prefix.split("/").filter(Boolean).length;

  return (selfPath: string, fallback: Fallback = DEFAULT_FALLBACK): PagePaths => {
    const depth = selfPath.split("/").length - 1;
    const base = "../".repeat(depth);
    const root = "../".repeat(depth + prefixDepth);
    return {
      base,
      root,
      seasons: plans.map((p) => {
        if (p.season === current) {
          return {
            season: p.season, href: `${base}${selfPath}`, current: true,
            fallback: false, fallbackTo: fallback.label,
          };
        }
        // ⚠**없는 화면으로 링크하지 않는다.** 2026에만 있는 선수의 2025 페이지는 없다
        const has = p.paths.has(selfPath);
        return {
          season: p.season,
          href: `${root}${p.prefix}${has ? selfPath : fallback.path}`,
          current: false,
          fallback: !has,
          fallbackTo: fallback.label,
        };
      }),
    };
  };
}

/**
 * 화면이 공통으로 받는 것.
 *
 * ⚠**한 벌만 둔다**(M1의 정신). 예전에는 `pages.ts`·`player-page.ts`·`log-page.ts`에
 * 같은 이름의 타입이 각각 있었고, 필드를 늘릴 때마다 세 곳을 고쳐야 했다.
 */
export interface RenderContext {
  site: SiteMeta;
  freshness: Freshness;
  /** 이 페이지의 경로. **자기 경로만 말하면 나머지는 계산된다** */
  paths: (selfPath: string, fallback?: Fallback) => PagePaths;
  /**
   * 이 시즌에 レギュラーシーズン外の試合 기록이 있는가.
   *
   * ⚠**필수다.** 선택 인자로 두면 새 화면을 만들며 한 줄을 빠뜨렸을 때
   * **그 화면에서만 내비 항목이 조용히 사라진다** — 타입도 시험도 못 잡는다.
   * 필수로 두면 컴파일이 멈춘다.
   */
  hasPostseason: boolean;
}

const LT = String.fromCharCode(0x3c);
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/**
 * 인라인 `<script>`에 넣기 전에 문서를 끊을 수 있는 문자를 죽인다.
 *
 * ⚠**`</script>`가 문자열 안에 있으면 브라우저가 거기서 스크립트를 끝낸다.** 선수명·팀명은
 * 우리가 만든 값이 아니므로 반드시 막는다. U+2028·U+2029는 JS 문법상 줄바꿈이라 같은 이유로 막는다.
 */
export function safeScript(js: string): string {
  return js
    .split(LT)
    .join("\\u003c")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

export function page(o: PageOptions): string {
  const style = `--team:${o.color.base};--team-ink:${o.color.ink}`;
  /**
   * ⚠**실행 스크립트가 아니다**(2026-08-18 감사 P2). `type="application/json"` 은 브라우저가
   * 실행하지 않으므로 CSP 의 `script-src 'self'` 에 걸리지 않는다 — 그 덕에 이 사이트는
   * **인라인 실행 스크립트 0개**가 되어 CSP 를 `unsafe-inline` 없이 닫을 수 있다(`site.ts` HEADERS).
   * ⚠`safeScript` 는 그대로 쓴다 — `<` 를 `\u003c` 로 바꾸는 것은 **JSON 문자열 안에서도 유효**하고,
   * 데이터 안의 `</script>` 가 태그를 끊는 것을 막는다.
   */
  const boot =
    o.bootstrapJs === undefined
      ? raw("")
      : html`<script type="application/json" id="bb-boot">${raw(safeScript(o.bootstrapJs))}</script>`;

  const doc = html`<!doctype html>
<html lang="ja" data-base="${o.base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<!-- 탭 아이콘·주소창 색. **우리가 그린 도형**이고 구단 로고가 아니다(§6) -->
<link rel="icon" href="${o.root}assets/icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15161a" media="(prefers-color-scheme: dark)">
<!-- ⚠**지금은 이 카드가 보이지 않는다.** 사이트가 Cloudflare Access 뒤에 있어
     링크를 펼치는 쪽은 로그인 화면을 받는다. 공개 전환(S2) 시점에 비로소 효과가 생긴다 -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${o.site.name}">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${o.title}">
<!-- ⚠**화면별 설명을 받는 자리를 만들었다가 뺐다.** 부르는 곳이 하나도 없어서
     「나중에 쓰겠지」로 남는 죽은 선택지가 됐다 — 필요해지면 그때 만든다 -->
<meta property="og:description" content="NPBの公表記録から再計算した選手成績・順位・対戦成績。">
<link rel="stylesheet" href="${o.root}assets/site.css">
<!-- ⚠**스크립트가 없으면 탭은 조작이 아니라 벽이다.**
     탭 패널은 첫 장만 열어 두고 나머지를 hidden으로 내보내는데, 스크립트가 없으면
     여는 수단이 사라져 그 내용에 **도달할 방법이 아예 없다.**
     2026-08-16 이중 검토에서 실제로 걸렸다 — 順位를 チーム/個人으로 나눈 순간
     개인 타이틀 전체(2리그 × 3부문 × 8지표)가 JS 없이는 닿을 수 없게 됐다.
     스크립트가 없으면 **전부 펼친다.** 길어지는 것이 닿지 못하는 것보다 낫다.

     ⚠**주석이 「전부」라고 적어 놓고 규칙은 탭 패널만 폈다**(2026-08-20 최종 검토 ⑤).
     선수 페이지는 프리셋 밖의 구획을 section.block[hidden] 으로 내보내는데
     그 선택자에 걸리지 않아서, 실브라우저(JS 끔)에서 b-count·b-relief 의 높이가 **0** 이었고
     "#b-count" 앵커로 들어가도 0이었다 — 기존 구획 6개가 이미 같은 상태였다.
     ⚠**두 선택자를 한 규칙으로 묶지 않는다** — assets.ts 의 .block[hidden] 이 display:none 이라
     이기려면 !important 가 필요하고, 규칙을 나눠 두면 어느 쪽이 왜 있는지 읽힌다.
     ⚠인쇄에도 같은 규칙이 이미 있다(@media print 의 .block[hidden]) — 종이에도 여는 수단이 없다는
     같은 이유다.
     ⚠**이 주석에 역따옴표를 쓰지 마라** — 이 파일은 통째로 템플릿 리터럴이라 거기서 끊긴다. -->
<noscript><style>[data-panelgroup][hidden]{display:block!important}
.block[hidden]{display:block!important}</style></noscript>
</head>
<body style="${style}">
<a class="skip" href="#main">本文へ</a>
${topbar(o)}
${seasonBar(o)}
<div class="shell">
  <div class="spine">${o.spine === undefined ? null : html`<span class="vt">${o.spine}</span>`}</div>
  <main class="main" id="main">
    ${freshnessBar(o.freshness, isPastSeason(o))}
    ${o.body}
    <footer class="foot">
      出典：日本野球機構（NPB）公式サイト <a href="https://npb.jp/" rel="noreferrer noopener">npb.jp</a>。
      本ページの数値は公表記録をもとに<b>当サイトが独自に再計算</b>したものです。原本の表を再現するものではありません。<br>
      選手の写真・球団ロゴは<b>使用していません</b>（記録は事実ですが、写真とロゴは別の権利です）。<br>
      掲載内容の削除・訂正のご依頼は ${o.site.contact === "" ? html`<b>連絡先が未設定です（公開前に設定してください）</b>` : o.site.contact} まで。<br>
      ${o.site.name} by Lunomel · ${raw(footStamp(o))}
    </footer>
  </main>
</div>
<!-- 용어 설명. ⚠**모든 페이지에 있어야 한다** — 용어는 순위표에도 대전표에도 나온다 -->
<div id="tip" role="tooltip" hidden></div>
${boot}
<script src="${o.root}assets/site.js" defer></script>
</body>
</html>`;

  return toString(doc);
}
