/**
 * 드래프트 그리드 파서 — **ja.wikipedia** `{YYYY}年度新人選手選択会議_(日本プロ野球)`.
 *
 * ⚠**규칙을 여기서 새로 만들지 않았다.** 정본은
 * `docs/sources/2026-09-04-draft-wikipedia-markup-rules.md` 의 `S0~S9`·`INV-1~7`·§3 예외 3건이고,
 * 이 파일은 그것을 옮긴 것이다. **판정을 바꾸려면 그 문서를 먼저 고쳐라.**
 *
 * ⚠**npb 파서(`draft.ts`)와 무엇이 다른가**: npb 는 **한 장이 한 구단**이고 경합을 **문장**으로 적는다.
 * 위키는 **한 장이 전 구단**이고 경합을 **색과 굵기**로 적는다. 그래서 이 파일이 읽는 것은 표가
 * 아니라 **격자**다 — `rowspan`/`colspan` 을 펼치지 않으면 열이 밀리고, **밀린 값도 실재 선수명**이라
 * 합계로도 눈으로도 안 잡힌다(규칙표 §6-1 · 2007 에서 실측으로 재현됐다).
 *
 * ⚠**이 소스가 답하는 것은 오직 「경합」이다.** 지명 명단은 npb 가 정본이고(§2-4 신뢰 등급),
 * 여기서 나오는 지명은 **대조용**이다. 어느 쪽이 이기는지는 적재(`store/src/draft-wiki.ts`)가 적는다.
 *
 * ⚠**HTML 주석을 읽지 않는다.** 아래 태그 스캐너가 `<!-- … -->` 를 **태그가 아닌 것으로** 건너뛰므로
 * 브라우저가 감춘 것이 사실로 읽히지 않는다(npb 파서 `stripComments` 와 같은 취지 · 그쪽은 정규식으로
 * 지우고 여기는 스캐너가 원래 안 본다 — **규칙이 두 벌인 게 아니라 층이 다르다**).
 * ⚠**닫히지 않은 주석은 실패다** — 브라우저는 그 뒤를 통째로 숨기므로, 계속 읽으면 숨겨진 것을 읽는다.
 */
import type { DraftKind } from "./draft.ts";
/**
 * ⚠**이름 정규화 규칙은 한 벌이다**(M1) — `stats.ts` 의 것을 그대로 쓴다. 여기서 새로 만들면
 * 경합 그룹의 이름 묶기가 npb 쪽과 **미묘하게 다른 규칙**으로 갈리고, 두 표를 나란히 놓은
 * 사람만 그 차이를 본다.
 */
import { normalizePlayerName } from "./stats.ts";

export class DraftWikiParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "DraftWikiParseError";
    this.detail = detail;
  }
}

/** `S0` — 기사 URL. ⚠**`/wiki/` 만 쓴다**(`/w/`·`/api/` 는 robots Disallow) */
export function draftWikiUrl(year: number): string {
  return `https://ja.wikipedia.org/wiki/${year}年度新人選手選択会議_(日本プロ野球)`;
}

/**
 * `S1` — 그리드가 앉아 있는 절의 `h2 id`. **실측 3종**(21개 연도 전수).
 *
 * ⚠**완전일치로 찾는다.** 부분일치로 찾으면 **`球団別指名選手一覧`**(2023~2025)이
 * `指名選手一覧` 에 걸려 **구단별 표를 그리드로 읽는다** — 그쪽은 폭이 13이 아니라 조용히 실패하겠지만,
 * 「왜 실패했는가」가 완전히 엉뚱한 자리를 가리키게 된다.
 */
export const DRAFT_WIKI_SECTION_IDS = [
  "指名選手一覧",
  "選択希望選手一覧",
  "指名選手一覧（指名順表記）",
] as const;

/**
 * `S5` — 배너 어휘 **전량**(21개 연도 전수 · 그 밖 0건).
 *
 * ⚠**`育成` 를 `支配下` 로 접지 마라** — 육성에는 추첨이 없다(INV-6). 접으면 육성 지명자가
 * 「단독 당첨」이 되고, 그건 일어난 적 없는 사건이다.
 */
const BANNERS: ReadonlyArray<readonly [string, DraftKind]> = [
  ["支配下選手", "shihaika"],
  ["育成選手", "ikusei"],
  ["高校生", "koukousei"],
  ["大学生・社会人", "daigaku_shakaijin"],
];

/** `S4` — 머리행의 첫 칸. ⚠**위치로 찍지 마라**(2024 부터 배너가 머리행 **위**다 · 규칙표 §3) */
const HEADER_LABELS = ["チーム", "指名順"] as const;

/**
 * `S8` — 추첨 팔레트 **6색**. 4,760칸 전수에서 이 밖의 배경색은 **0건**이다.
 *
 * ⚠**`#ccc` 는 여기 없다.** 그것은 추첨이 아니라 **별도 축**(입단 거부·계약 불성립)이고,
 * 추첨색으로 읽으면 육성 지명자가 「단독 당첨」이 되거나 한 행에 회색이 둘일 때 **가짜 경합**이 생긴다.
 */
const LOTTERY_COLORS = new Set(["#fcc", "#ccf", "#cfc", "#ffc", "#cff", "#fcf"]);

/** 추첨이 아닌 회색. 실측 10칸 — 전부 **웨이버 행**이고 전부 실재 선수다(입단 거부 등) */
const NON_LOTTERY_COLOR = "#ccc";

/** `S7` — 미지명. ⚠**미수집이 아니다**(M11). 실측 2,354칸 */
const UNNOMINATED = "---";

/**
 * **선수가 아닌 칸**(규칙표 §3 예외 2건 · 4,760칸 전수에서 이 둘뿐).
 *
 * ⚠**닫힌 어휘다.** 여기 없는 문자열은 전부 선수명으로 읽는데, 그것만으로는 새 표기가 생긴 날
 * **조용히 그 이름의 선수가 생긴다.** 그래서 아래 `classifyCell` 이 **모양으로도** 막는다 —
 * 「`font-weight` 가 지정됐는데 배경색이 없다」는 이 둘의 공통 모양이고(실측 2/2),
 * 그 모양인데 어휘에 없으면 **던진다.**
 */
const MARKERS = new Set(["指名権剥奪", "不合意"]);

export type DraftWikiMarker = "指名権剥奪" | "不合意";

/** 웨이버 방향. ⚠**소스가 적는 것**이지 우리가 유도하는 것이 아니다 */
export type WaiverDir = "→" | "←";

/**
 * 행 라벨의 뜻(`S6`).
 *
 * ⚠⚠**`lottery` 와 `waiver` 를 가르는 것은 「1巡目 뒤에 숫자가 있는가」 하나다.**
 * `1巡目→` 는 **育成 1라운드**이고 `1巡目1` 은 **支配下 1순위 입찰**이다 —
 * 「`1巡目` 로 시작하면 1순위」로 짜면 **육성 선수가 드래프트 1위가 된다**(규칙표 §3·§6-4).
 */
export type DraftWikiRowLabel =
  /** 1순위 입찰 `bidRound` 회차. ⚠2005·2006 은 **웨이버 방향까지 붙는다**(`1巡目2→`) */
  | { readonly kind: "lottery"; readonly bidRound: number; readonly waiverDir: WaiverDir | null }
  /** N순위 웨이버 지명 */
  | { readonly kind: "waiver"; readonly roundNo: number; readonly waiverDir: WaiverDir }
  /** 希望入団枠 — **추첨이 아니다**. 회차라는 개념도 없다(M11 · npb 파서의 `kibou_nyudanwaku` 와 같은 자리) */
  | { readonly kind: "kibou" };

export type DraftWikiCellKind = "player" | "unnominated" | "marker";

export interface DraftWikiCell {
  /** 0-based 구단 열(머리행의 2~13번째와 같은 순서) */
  readonly columnIndex: number;
  readonly cellKind: DraftWikiCellKind;
  /** 셀 텍스트. ⚠`<br>` 는 **빈 문자열로** 잇는다(§6-6) */
  readonly display: string | null;
  /** `<a title>` 에서 ` (存在しないページ)` 를 뗀 것. ⚠**링크가 없으면 `null`**(M11 · 「소스가 안 말한다」) */
  readonly canonical: string | null;
  readonly marker: DraftWikiMarker | null;
  /** 소문자 정규화한 `background-color`. 없으면 `null` */
  readonly background: string | null;
  /**
   * ⚠**굵기의 출처는 표 자신이다** — 표 스타일이 `font-weight:bold` 라
   * **셀에 `font-weight` 가 없으면 굵고 `normal` 이면 안 굵다.**
   */
  readonly bold: boolean;
}

export interface DraftWikiRow {
  readonly rowIndex: number;
  /** 원문 라벨(정규화 전). 실패 메시지가 사람 눈에 보이게 하려고 남긴다 */
  readonly labelRaw: string;
  readonly label: DraftWikiRowLabel;
  /** 이 행이 속한 구획. **배너가 정한다**(`S5`) */
  readonly kind: DraftKind;
  /** 반드시 12칸(INV-5: 폭 13 = 라벨 1 + 구단 12) */
  readonly cells: readonly DraftWikiCell[];
}

export interface DraftWikiGrid {
  readonly sectionId: string;
  readonly headerLabel: string;
  /** 구단 열 머리(**원문 표기 그대로** · `ヤクルト`·`横浜`·`DeNA`…). ⚠**여기서 팀 코드로 바꾸지 않는다** */
  readonly columns: readonly string[];
  readonly banners: readonly string[];
  readonly rows: readonly DraftWikiRow[];
  /** 배너가 나오기 전의 데이터 행 수. ⚠2008·2009 는 支配下 배너가 **없다** — 그 행들이 여기 세어진다 */
  readonly rowsBeforeFirstBanner: number;
}

/** 그리드에서 유도한 지명 1건. ⚠**낙첨은 지명이 아니다** — 그 선수는 다른 구단에 갔다 */
export interface DraftWikiPick {
  readonly columnIndex: number;
  readonly kind: DraftKind;
  /** ⚠`kibou` 행은 **회차가 없다**(`null`) — npb 파서의 `kibou_nyudanwaku` 와 같은 규칙(M11) */
  readonly roundNo: number | null;
  readonly waiverDir: WaiverDir | null;
  readonly nameDisplay: string;
  readonly nameCanonical: string | null;
}

/** 1순위 입찰 1건. ⚠`won === null` 은 **단독지명**이다(「이겼다」가 아니다 · M11) */
export interface DraftWikiBid {
  readonly columnIndex: number;
  readonly kind: DraftKind;
  /** 1巡目 **안에서 몇 번째 추첨인가**. ⚠지명 회차가 아니다 */
  readonly bidRound: number;
  /** 같은 행·같은 배경색. ⚠**단독지명이면 `null`** */
  readonly groupKey: string | null;
  readonly won: boolean | null;
  readonly nameDisplay: string;
  readonly nameCanonical: string | null;
}

/** 선수도 미지명도 아닌 칸. ⚠**버리지 않는다** — 2007 西武의 `指名権剥奪` 이 사라지면 그 해가 설명되지 않는다 */
export interface DraftWikiMarkerCell {
  readonly columnIndex: number;
  readonly kind: DraftKind;
  readonly labelRaw: string;
  readonly marker: DraftWikiMarker;
}

export interface DraftWikiInvariantReport {
  /** 불변식마다 **분모**. ⚠「위반 0건」과 「안 쟀음」을 구별하기 위한 것이다 */
  readonly checked: Readonly<Record<string, number>>;
  readonly violations: readonly { readonly id: string; readonly detail: string }[];
}

export type DraftWikiParse =
  | {
      readonly kind: "grid";
      readonly year: number;
      readonly grid: DraftWikiGrid;
      readonly picks: readonly DraftWikiPick[];
      readonly bids: readonly DraftWikiBid[];
      readonly markers: readonly DraftWikiMarkerCell[];
    }
  /**
   * ⚠**실패가 아니다**(M11). 2026 이 이 상태다 — 절은 있는데 그리드가 없다(미개최·미기재).
   * `class="box-節スタブ"` 안내가 있다고 데이터가 없는 것도 아니다(2019 는 스텁과 표가 **같이** 있다) —
   * 판정은 **wikitable 유무**로 한다.
   */
  | { readonly kind: "no-grid"; readonly year: number; readonly sectionId: string };

// ──────────────────────────────────────────────────────────────────────────
// 태그 스캐너 — ⚠**정규식으로 태그를 자르지 않는다**
// ──────────────────────────────────────────────────────────────────────────

/**
 * ⚠**`/<[^>]+>/` 로 태그를 자르면 속성값 안의 `>` 에서 경계가 깨진다**(규칙표 §6-9).
 * Parsoid 는 `data-mw='{"…"}'` 같은 JSON 속성을 붙이고, 그 안에 `>` 가 들어갈 수 있다.
 * 실측으로는 **지금 0건**이지만, 0건인 것과 **일어나면 조용히 틀리는 것**은 다른 얘기다.
 *
 * ⚠**주석은 태그가 아니다.** 여기서 건너뛰므로 **브라우저가 감춘 것을 사실로 읽지 않는다.**
 * 닫히지 않은 주석은 던진다 — 브라우저는 그 뒤를 통째로 숨기기 때문이다.
 */
interface Tag {
  /**
   * 소문자 태그명. ⚠**주석은 `#comment` 라는 이름으로 함께 나온다** — 아래 참조.
   */
  readonly name: string;
  readonly closing: boolean;
  readonly attrs: string;
  /** `<` 의 위치 */
  readonly start: number;
  /** `>` 다음 위치(주석이면 `-->` 다음) */
  readonly end: number;
}

/**
 * ⚠⚠**주석을 「없는 것」으로 건너뛰면 그 글자가 본문에 남는다** — 2026-09-06 에 실제로 그랬다.
 *
 * 초판은 스캐너가 `<!-- … -->` 를 **아무것도 안 내고 지나가게** 했다. 구조(행·칸 찾기)에는 옳았지만
 * **텍스트를 다시 이어 붙일 때** 그 구간이 태그가 아니라서 안 지워졌고,
 * **2010 의 열 표식(`<!--横-->`)이 선수명에 그대로 붙었다**:
 * ```
 * 加賀美希昇<!--横-->   ← 이것이 `name_display` 로 들어갈 뻔했다
 * ```
 * ⚠**실측 110건 / 152 비교자리**(2010 한 해). **X-3 대조가 아니었으면 못 봤다** —
 * 화면에는 그럴듯한 이름이 나오고 합계도 맞기 때문이다(규칙표 §6 이 말하는 그 모양).
 *
 * → **주석도 「글자가 아닌 구간」으로 내보낸다.** 구조를 보는 쪽은 이름으로 거르므로 영향이 없고,
 *   텍스트를 잇는 쪽은 태그와 **같은 규칙으로** 지운다.
 */
const COMMENT = "#comment";

/**
 * 키 안에서 칸을 가르는 문자. ⚠**구단 코드·`kind`·이름에 절대 안 나오는 것**이어야 한다 —
 * 구분자가 값 안에 나올 수 있으면 서로 다른 두 쌍이 같은 키가 된다.
 * (`store/src/draft.ts` 의 `SEP` 과 같은 이유 · 그쪽과 층이 달라 값만 나란히 둔다.)
 */
const SEP = " ";

function scanTags(html: string, where: string, from = 0, to = html.length): Tag[] {
  const out: Tag[] = [];
  let i = from;
  while (i < to) {
    const lt = html.indexOf("<", i);
    if (lt === -1 || lt >= to) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      if (close === -1) {
        throw new DraftWikiParseError(
          "닫히지 않은 HTML 주석이 있다 — 브라우저가 숨기는 것을 사실로 읽지 않는다(M7)",
          `${where} / ${JSON.stringify(html.slice(lt, lt + 80))}`,
        );
      }
      // ⚠**건너뛰지 않고 구간으로 낸다** — 위 `COMMENT` 주석의 그 사고다.
      out.push({ name: COMMENT, closing: false, attrs: "", start: lt, end: close + 3 });
      i = close + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const close = html.indexOf(">", lt);
      i = close === -1 ? to : close + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, Math.min(lt + 32, to)));
    if (!m) {
      i = lt + 1;
      continue;
    }
    // 속성 구간을 인용부호를 존중하며 훑어 `>` 를 찾는다.
    let j = lt + m[0].length;
    let quote = "";
    while (j < to) {
      const ch = html[j]!;
      if (quote !== "") {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j += 1;
    }
    if (j >= to) {
      throw new DraftWikiParseError("닫히지 않은 태그가 있다(M7)", `${where} / ${JSON.stringify(html.slice(lt, lt + 80))}`);
    }
    out.push({
      name: m[2]!.toLowerCase(),
      closing: m[1] === "/",
      attrs: html.slice(lt + m[0].length, j),
      start: lt,
      end: j + 1,
    });
    i = j + 1;
  }
  return out;
}

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? "");
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * CSS 를 **프로퍼티 단위로** 읽는다.
 *
 * ⚠⚠**문자열 매칭 금지**(규칙표 §6-5). 같은 표 안에서 `…normal;` 와 `…normal` 이 **공존한다**(2019).
 * 색도 마찬가지로 `#ccf;` 와 `#ccf` 가 섞인다(2019·2024·2025 실측).
 * **세미콜론 하나로 낙첨이 당첨이 된다.**
 */
function cssProps(style: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (style === null) return out;
  for (const decl of style.split(";")) {
    const at = decl.indexOf(":");
    if (at === -1) {
      if (decl.trim() !== "") out.set(decl.trim().toLowerCase(), "");
      continue;
    }
    out.set(decl.slice(0, at).trim().toLowerCase(), decl.slice(at + 1).trim().toLowerCase());
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 셀 텍스트
// ──────────────────────────────────────────────────────────────────────────

/**
 * 셀의 표시 문자열과 `<a title>`.
 *
 * ⚠**`<sup class="mw-ref">` 를 먼저 뗀다** — 안 떼면 `不合意[1]` 이 **선수명이 된다**(§6-8).
 *   그 각주 안에도 `<a>` 가 있으므로 **떼기 전에 title 을 찾으면 각주 링크를 이름으로 읽는다.**
 * ⚠**`<br>` 는 빈 문자열로 잇는다** — 공백으로 이으면 `エドポロ ケイン` 이 되어 표제 `エドポロケイン` 과
 *   갈린다(§6-6). ⚠**그렇다고 표시명이 정답인 것도 아니다** — 그래서 두 벌을 다 남긴다(§6-7 · M10).
 */
function readCellText(inner: string, where: string): { display: string; canonical: string | null } {
  const tags = scanTags(inner, where);
  // ── `<sup class="mw-ref…">` 구간을 지운다(중첩 없음 · 실측 2건) ──
  const drop: Array<[number, number]> = [];
  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i]!;
    if (t.closing || t.name !== "sup") continue;
    if (!/\bmw-ref\b/.test(attrOf(t.attrs, "class") ?? "")) continue;
    let depth = 1;
    let end = inner.length;
    for (let j = i + 1; j < tags.length; j += 1) {
      const u = tags[j]!;
      if (u.name !== "sup") continue;
      depth += u.closing ? -1 : 1;
      if (depth === 0) {
        end = u.end;
        break;
      }
    }
    drop.push([t.start, end]);
  }
  let kept = "";
  let cursor = 0;
  for (const [a, b] of drop.sort((x, y) => x[0] - y[0])) {
    if (a < cursor) continue;
    kept += inner.slice(cursor, a);
    cursor = b;
  }
  kept += inner.slice(cursor);

  // ── 남은 태그에서 title 을 찾고, 텍스트만 남긴다 ──
  const rest = scanTags(kept, where);
  let canonical: string | null = null;
  for (const t of rest) {
    if (t.closing || t.name !== "a") continue;
    const title = attrOf(t.attrs, "title");
    if (title !== null) {
      canonical = title.replace(/\s*\(存在しないページ\)\s*$/u, "").trim();
      break;
    }
  }
  let text = "";
  cursor = 0;
  for (const t of rest) {
    text += kept.slice(cursor, t.start);
    // ⚠`<br>` 는 **빈 문자열**이다. 다른 태그도 텍스트를 만들지 않는다.
    cursor = t.end;
  }
  text += kept.slice(cursor);
  const display = decodeEntities(text).replace(/\s+/gu, " ").trim();
  return { display, canonical: canonical === "" ? null : canonical };
}

// ──────────────────────────────────────────────────────────────────────────
// 행 라벨
// ──────────────────────────────────────────────────────────────────────────

/**
 * ⚠**NFKC 를 먼저 건다.** 원문자 `①`~`④`(2013~2018)와 반각 숫자(2019~)가 **같은 자리**로 가고,
 * 전각 숫자도 흡수된다. ⚠**화살표는 NFKC 가 건드리지 않는다** — 그래서 `1巡目→`(育成)과
 * `1巡目1`(支配下)의 구별이 살아 있다.
 */
function normalizeLabel(raw: string): string {
  return raw.normalize("NFKC").replace(/\s/gu, "");
}

const LOTTERY_LABEL = /^1(?:巡目|位)([1-9])(→|←)?$/u;
const WAIVER_LABEL = /^(\d+)(?:巡目|位)(→|←)$/u;

function parseRowLabel(raw: string, where: string): DraftWikiRowLabel {
  const t = normalizeLabel(raw);
  if (t === "希望枠") return { kind: "kibou" };
  const lot = LOTTERY_LABEL.exec(t);
  if (lot) return { kind: "lottery", bidRound: Number(lot[1]), waiverDir: (lot[2] as WaiverDir) ?? null };
  const wav = WAIVER_LABEL.exec(t);
  if (wav) return { kind: "waiver", roundNo: Number(wav[1]), waiverDir: wav[2] as WaiverDir };
  throw new DraftWikiParseError(
    "모르는 행 라벨 — 어휘 4종(1순위입찰 · N순위웨이버 · 1순위입찰+방향 · 希望枠) 어디에도 안 맞는다(M7)",
    `${where} / ${JSON.stringify(raw)}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 격자
// ──────────────────────────────────────────────────────────────────────────

interface RawCell {
  readonly tag: "th" | "td";
  readonly attrs: string;
  readonly inner: string;
}

/** 한 행의 원본 칸들. ⚠`<td>` 안에 `<td>` 는 없다(실측) — 그래도 **닫는 태그로만** 끊는다 */
function rowCells(rowHtml: string, where: string): RawCell[] {
  const tags = scanTags(rowHtml, where);
  const out: RawCell[] = [];
  let open: Tag | null = null;
  for (const t of tags) {
    if (t.name !== "td" && t.name !== "th") continue;
    if (!t.closing) {
      if (open !== null) {
        throw new DraftWikiParseError("칸이 닫히기 전에 새 칸이 열렸다(M7)", `${where} / ${JSON.stringify(rowHtml.slice(t.start, t.start + 80))}`);
      }
      open = t;
      continue;
    }
    if (open === null) {
      throw new DraftWikiParseError("열리지 않은 칸이 닫혔다(M7)", `${where} / ${JSON.stringify(rowHtml.slice(t.start, t.start + 80))}`);
    }
    out.push({ tag: open.name as "th" | "td", attrs: open.attrs, inner: rowHtml.slice(open.end, t.start) });
    open = null;
  }
  if (open !== null) {
    throw new DraftWikiParseError("닫히지 않은 칸이 있다(M7)", `${where} / ${JSON.stringify(rowHtml.slice(open.start, open.start + 80))}`);
  }
  return out;
}

function spanOf(attrs: string, name: string, where: string): number {
  const raw = attrOf(attrs, name);
  if (raw === null) return 1;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > 40) {
    throw new DraftWikiParseError(`${name} 이 정수가 아니다(M7)`, `${where} / ${JSON.stringify(raw)}`);
  }
  return n;
}

/** 펼친 격자의 한 칸. `source` 가 같으면 **같은 원본 칸**이다(`rowspan` 으로 여러 행에 걸친 것) */
interface GridCell {
  readonly cell: RawCell;
  /** 그 원본 칸이 처음 나온 행 */
  readonly originRow: number;
}

/**
 * `S3` — **`rowspan`/`colspan` 을 펼쳐 2차원 격자로.**
 *
 * ⚠⚠**생략하면 2007 이 조용히 어긋난다**(규칙표 §6-1 · 실측). 西武 열의 `rowspan="5"` `指名権剥奪` 때문에
 * 뒤따르는 4행이 12칸이 되고, **오른쪽 6개 팀이 한 칸씩 밀린다.** 밀린 값도 실재 선수명이라
 * 합계로도 눈으로도 안 잡힌다 — 실제로 髙濱卓也(阪神)의 당첨이 **西武**로 읽힌다.
 */
function expandGrid(rows: readonly RawCell[][], where: string): GridCell[][] {
  const out: GridCell[][] = [];
  /** 아래 행으로 이어지는 칸: 열 → { cell, 남은 행 수 } */
  const pending = new Map<number, { cell: GridCell; left: number }>();

  rows.forEach((cells, r) => {
    const line: GridCell[] = [];
    let col = 0;
    const placePending = (): void => {
      for (;;) {
        const p = pending.get(col);
        if (p === undefined || p.left <= 0) break;
        line[col] = p.cell;
        p.left -= 1;
        if (p.left <= 0) pending.delete(col);
        col += 1;
      }
    };
    for (const c of cells) {
      placePending();
      const cs = spanOf(c.attrs, "colspan", where);
      const rs = spanOf(c.attrs, "rowspan", where);
      const gc: GridCell = { cell: c, originRow: r };
      for (let k = 0; k < cs; k += 1) {
        if (line[col] !== undefined) {
          throw new DraftWikiParseError("격자가 겹친다 — rowspan/colspan 이 서로를 덮는다(M7)", `${where} / row=${r} col=${col}`);
        }
        line[col] = gc;
        if (rs > 1) pending.set(col, { cell: gc, left: rs - 1 });
        col += 1;
      }
    }
    placePending();
    // ⚠**구멍을 0으로 메우지 않는다**(M11) — 뚫린 격자는 우리가 잘못 읽고 있다는 뜻이다.
    for (let k = 0; k < line.length; k += 1) {
      if (line[k] === undefined) {
        throw new DraftWikiParseError("격자에 구멍이 있다 — 칸을 지어내지 않는다(M7)", `${where} / row=${r} col=${k}`);
      }
    }
    out.push(line);
  });

  if (pending.size > 0) {
    throw new DraftWikiParseError("표가 끝났는데 rowspan 이 남았다(M7)", `${where} / 남은 열=${[...pending.keys()].join(",")}`);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 셀 판정
// ──────────────────────────────────────────────────────────────────────────

function classifyCell(
  raw: RawCell,
  columnIndex: number,
  where: string,
): DraftWikiCell {
  const props = cssProps(attrOf(raw.attrs, "style"));
  const bgRaw = props.get("background-color") ?? null;
  const fw = props.get("font-weight") ?? null;

  if (bgRaw !== null && !LOTTERY_COLORS.has(bgRaw) && bgRaw !== NON_LOTTERY_COLOR) {
    throw new DraftWikiParseError(
      "모르는 배경색 — 팔레트가 바뀌면 경합의 뜻이 바뀐다(M7)",
      `${where} / col=${columnIndex} background-color=${JSON.stringify(bgRaw)}`,
    );
  }
  if (fw !== null && fw !== "normal") {
    throw new DraftWikiParseError(
      "모르는 font-weight — 굵기가 곧 당첨이라 값이 늘면 판정이 바뀐다(M7)",
      `${where} / col=${columnIndex} font-weight=${JSON.stringify(fw)}`,
    );
  }
  for (const key of props.keys()) {
    if (key !== "background-color" && key !== "font-weight" && key !== "") {
      throw new DraftWikiParseError(
        "칸 스타일에 모르는 프로퍼티가 있다 — 어휘가 닫혀 있다는 전제가 깨졌다(M7)",
        `${where} / col=${columnIndex} prop=${JSON.stringify(key)}`,
      );
    }
  }

  const { display, canonical } = readCellText(raw.inner, `${where} col=${columnIndex}`);
  const bold = fw === null;

  if (display === UNNOMINATED) {
    // ⚠**미지명 칸에 추첨색이 있으면 우리가 색을 잘못 읽고 있다.** 조용히 넘기면 가짜 경합이 생긴다.
    if (bgRaw !== null || fw !== null) {
      throw new DraftWikiParseError(
        "미지명(`---`) 칸에 색·굵기가 붙어 있다 — 미지명은 경합에 참여할 수 없다(M7)",
        `${where} / col=${columnIndex} style=${JSON.stringify(attrOf(raw.attrs, "style"))}`,
      );
    }
    return { columnIndex, cellKind: "unnominated", display: null, canonical: null, marker: null, background: null, bold };
  }

  if (MARKERS.has(display)) {
    return {
      columnIndex,
      cellKind: "marker",
      display,
      canonical,
      marker: display as DraftWikiMarker,
      background: bgRaw,
      bold,
    };
  }

  // ⚠**모양으로 한 번 더 막는다.** `指名権剥奪`·`不合意` 는 둘 다 「굵기는 지정됐는데 배경색이 없다」였다
  //   (4,760칸 전수에서 그 모양은 이 둘뿐). 그 모양인데 어휘에 없으면 **새 표기**이므로 던진다 —
  //   안 던지면 그 문자열이 **그 이름의 선수**가 되어 조용히 지명 한 건이 생긴다.
  if (fw !== null && bgRaw === null) {
    throw new DraftWikiParseError(
      "선수가 아닌 것으로 보이는 칸인데 어휘에 없다 — 새 표기가 생겼다(M7)",
      `${where} / col=${columnIndex} text=${JSON.stringify(display)}`,
    );
  }
  if (display === "") {
    throw new DraftWikiParseError("빈 칸 — 미지명(`---`)과 다르다. 빈 값으로 흘리지 않는다(M7)", `${where} / col=${columnIndex}`);
  }
  return { columnIndex, cellKind: "player", display, canonical, marker: null, background: bgRaw, bold };
}

// ──────────────────────────────────────────────────────────────────────────
// 진입점
// ──────────────────────────────────────────────────────────────────────────

function textOf(inner: string, where: string): string {
  return readCellText(inner, where).display;
}

/**
 * 기사 HTML 에서 그리드를 읽는다(`S1`~`S8`).
 *
 * @param html Parsoid 렌더링 HTML 전문. ⚠**`action=raw` 위키텍스트나 구판 HTML 은 구조가 다르다** —
 *   규칙표 §10-5 가 「이 규칙은 이 렌더링에 한정」이라고 적어 둔 그 한계다.
 * @param year 연도. ⚠**페이지가 아니라 호출자가 아는 사실**이다(npb 파서의 `team` 과 같은 자리).
 * @throws {DraftWikiParseError} 절이 없을 때 · 표 스타일에 `font-weight:bold` 가 없을 때 ·
 *   폭이 13이 아닐 때 · 배너·행라벨·배경색·굵기·셀 어휘가 밖일 때. **빈 값으로 흘리지 않는다**(M7).
 */
export function parseDraftWiki(html: string, year: number): DraftWikiParse {
  const where = `wikipedia/${year}`;

  // ── S1: 절 ───────────────────────────────────────────────────────────
  const docTags = scanTags(html, where);
  const heads = docTags.filter((t) => !t.closing && t.name === "h2");
  const hit = heads
    .map((t) => ({ tag: t, id: attrOf(t.attrs, "id") }))
    .filter((x) => x.id !== null && (DRAFT_WIKI_SECTION_IDS as readonly string[]).includes(x.id));
  if (hit.length !== 1) {
    throw new DraftWikiParseError(
      `그리드 절을 ${hit.length}개 찾았다 — 1개여야 한다(M7)`,
      `${where} / h2 id 목록=${JSON.stringify(heads.map((t) => attrOf(t.attrs, "id")))}`,
    );
  }
  const section = hit[0]!;
  const sectionId = section.id!;
  const nextHead = heads.find((t) => t.start > section.tag.start);
  const scopeFrom = section.tag.end;
  const scopeTo = nextHead === undefined ? html.length : nextHead.start;

  // ── S2: 표 ───────────────────────────────────────────────────────────
  const scopeTags = scanTags(html, where, scopeFrom, scopeTo);
  const tableOpen = scopeTags.find(
    (t) => !t.closing && t.name === "table" && /\bwikitable\b/.test(attrOf(t.attrs, "class") ?? ""),
  );
  // ⚠**「표가 없다」는 실패가 아니다**(M11) — 2026 이 이 상태다.
  if (tableOpen === undefined) return { kind: "no-grid", year, sectionId };

  if (!/font-weight\s*:\s*bold/.test(attrOf(tableOpen.attrs, "style") ?? "")) {
    throw new DraftWikiParseError(
      "그리드 표에 `font-weight:bold` 가 없다 — **굵기 규칙의 전제**가 사라졌다(M7)",
      `${where} / style=${JSON.stringify(attrOf(tableOpen.attrs, "style"))}`,
    );
  }
  const tableClose = scopeTags.find((t) => t.closing && t.name === "table" && t.start > tableOpen.start);
  if (tableClose === undefined) {
    throw new DraftWikiParseError("그리드 표가 닫히지 않았다(M7)", where);
  }
  const inner = html.slice(tableOpen.end, tableClose.start);
  // ⚠**중첩 표가 있으면 위 `</table>` 이 남의 것이다.** 실측 0건이지만 조용히 잘리는 쪽으로 틀리게 두지 않는다.
  if (scanTags(inner, where).some((t) => !t.closing && t.name === "table")) {
    throw new DraftWikiParseError("그리드 안에 중첩 표가 있다 — 표 경계를 신뢰할 수 없다(M7)", where);
  }

  // ── 행 자르기 ─────────────────────────────────────────────────────────
  const innerTags = scanTags(inner, where);
  const rawRows: RawCell[][] = [];
  let trOpen: Tag | null = null;
  for (const t of innerTags) {
    if (t.name !== "tr") continue;
    if (!t.closing) {
      trOpen = t;
      continue;
    }
    if (trOpen === null) throw new DraftWikiParseError("열리지 않은 행이 닫혔다(M7)", where);
    const body = inner.slice(trOpen.end, t.start);
    const cells = rowCells(body, where);
    // ⚠**빈 행은 실재한다**(`<tr class="mw-empty-elt">` · 5개 연도). **정말 비었을 때만** 건너뛴다 —
    //   내용이 있는데 칸이 0개면 그건 우리가 못 읽은 것이다.
    if (cells.length === 0) {
      if (body.trim() !== "") {
        throw new DraftWikiParseError("칸이 0개인데 내용이 있는 행이 있다(M7)", `${where} / ${JSON.stringify(body.slice(0, 120))}`);
      }
      trOpen = null;
      continue;
    }
    rawRows.push(cells);
    trOpen = null;
  }
  if (rawRows.length === 0) {
    throw new DraftWikiParseError("그리드 표에 행이 0개다(M7)", where);
  }

  const grid = expandGrid(rawRows, where);

  // ── S4·S5·S6: 머리행 · 배너 · 데이터 행 ───────────────────────────────
  const WIDTH = 13;
  let headerLabel: string | null = null;
  let columns: readonly string[] = [];
  const banners: string[] = [];
  const rows: DraftWikiRow[] = [];
  let kind: DraftKind = "shihaika";
  let sawBanner = false;
  let rowsBeforeFirstBanner = 0;

  grid.forEach((line, r) => {
    if (line.length !== WIDTH) {
      throw new DraftWikiParseError(
        `데이터 행의 폭이 ${line.length} 다 — 반드시 ${WIDTH}(라벨 1 + 구단 12)여야 한다(INV-5 · M7)`,
        `${where} / row=${r}`,
      );
    }
    const first = line[0]!;
    // 배너: 한 칸이 13열을 덮는 행
    const isBanner = line.every((c) => c === first) && first.originRow === r;
    if (isBanner) {
      const text = textOf(first.cell.inner, `${where} row=${r}`);
      const found = BANNERS.find(([label]) => label === text);
      if (found === undefined) {
        throw new DraftWikiParseError(
          "모르는 배너 — 구획 어휘 4종 밖이다(M7)",
          `${where} / row=${r} ${JSON.stringify(text)}`,
        );
      }
      banners.push(text);
      kind = found[1];
      sawBanner = true;
      return;
    }

    const firstText = textOf(first.cell.inner, `${where} row=${r}`);
    if ((HEADER_LABELS as readonly string[]).includes(firstText)) {
      if (headerLabel !== null) {
        throw new DraftWikiParseError("머리행이 둘 이상이다 — 정확히 1개여야 한다(INV-5 · M7)", `${where} / row=${r}`);
      }
      headerLabel = firstText;
      columns = line.slice(1).map((c, i) => {
        const name = textOf(c.cell.inner, `${where} header col=${i}`);
        if (name === "") {
          throw new DraftWikiParseError("구단 열 머리가 비었다(M7)", `${where} / col=${i}`);
        }
        return name;
      });
      return;
    }

    if (headerLabel === null) {
      throw new DraftWikiParseError("머리행보다 먼저 데이터 행이 나왔다(M7)", `${where} / row=${r} ${JSON.stringify(firstText)}`);
    }
    // ⚠**배너 전의 데이터 행은 支配下 다**(2008·2009 는 支配下 배너가 없다). 세어서 보고에 남긴다 —
    //   기본값이 조용히 쓰이면 다음 사람은 그것이 규칙인지 사고인지 알 수 없다.
    if (!sawBanner) rowsBeforeFirstBanner += 1;

    const label = parseRowLabel(firstText, `${where} row=${r}`);
    const cells = line.slice(1).map((c, i) => classifyCell(c.cell, i, `${where} row=${r} ${firstText}`));
    rows.push({ rowIndex: r, labelRaw: firstText, label, kind, cells });
  });

  if (headerLabel === null) {
    throw new DraftWikiParseError("머리행이 없다 — 첫 칸이 `チーム`/`指名順` 인 행을 못 찾았다(M7)", where);
  }
  if (columns.length !== WIDTH - 1) {
    throw new DraftWikiParseError(`구단 열이 ${columns.length} 개다 — 12개여야 한다(M7)`, where);
  }
  if (new Set(columns).size !== columns.length) {
    throw new DraftWikiParseError("구단 열 머리에 중복이 있다(M7)", `${where} / ${JSON.stringify(columns)}`);
  }
  if (banners.length === 0) {
    throw new DraftWikiParseError(
      "배너가 하나도 없다 — 구획을 支配下 로 가정하게 되는데 그건 추측이다(M7)",
      where,
    );
  }
  if (rows.length === 0) {
    throw new DraftWikiParseError("데이터 행이 0개다(M7)", where);
  }

  const g: DraftWikiGrid = { sectionId, headerLabel, columns, banners, rows, rowsBeforeFirstBanner };
  const { picks, bids, markers } = derive(g, where);
  return { kind: "grid", year, grid: g, picks, bids, markers };
}

// ──────────────────────────────────────────────────────────────────────────
// 유도 — 지명 · 입찰 · 표식
// ──────────────────────────────────────────────────────────────────────────

/**
 * `S8` — 경합 그룹은 **(행, 배경색)** 이다.
 *
 * ⚠⚠**표 전체를 색으로 묶지 마라**(규칙표 §6-2). 색은 **다른 행에서 재사용된다** —
 * 2013 `#fcc`(1巡目① 松井裕樹 / 1巡目③ 岩貞祐太) · 2017 `#fcc`(清宮 / 馬場) · 2023 `#ccf`(武内 / 細野).
 * 표 전체로 묶으면 **다른 회차의 다른 선수가 한 그룹**이 되고, 그 위에 「이긴 구단이 둘」이 얹힌다.
 */
function derive(
  grid: DraftWikiGrid,
  where: string,
): { picks: DraftWikiPick[]; bids: DraftWikiBid[]; markers: DraftWikiMarkerCell[] } {
  const picks: DraftWikiPick[] = [];
  const bids: DraftWikiBid[] = [];
  const markers: DraftWikiMarkerCell[] = [];
  /** ⚠**같은 원본 칸이 rowspan 으로 여러 행에 나온다**(2007) — 표식을 5번 세지 않는다 */
  const seenMarker = new Set<string>();

  for (const row of grid.rows) {
    for (const cell of row.cells) {
      if (cell.cellKind === "marker") {
        const key = `${cell.columnIndex}${SEP}${cell.marker}`;
        if (!seenMarker.has(key)) {
          seenMarker.add(key);
          markers.push({ columnIndex: cell.columnIndex, kind: row.kind, labelRaw: row.labelRaw, marker: cell.marker! });
        }
        continue;
      }
      if (cell.cellKind !== "player") continue;

      if (row.label.kind === "kibou") {
        // ⚠**希望入団枠 은 회차가 없는 제도다**(M11) — 순번은 적재가 매긴다(npb 쪽과 같은 계약).
        picks.push({
          columnIndex: cell.columnIndex,
          kind: "kibou_nyudanwaku",
          roundNo: null,
          waiverDir: null,
          nameDisplay: cell.display!,
          nameCanonical: cell.canonical,
        });
        continue;
      }
      if (row.label.kind === "waiver") {
        picks.push({
          columnIndex: cell.columnIndex,
          kind: row.kind,
          roundNo: row.label.roundNo,
          waiverDir: row.label.waiverDir,
          nameDisplay: cell.display!,
          nameCanonical: cell.canonical,
        });
      }
    }

    if (row.label.kind !== "lottery") continue;

    // ── 이 행의 (배경색) 그룹 ──
    const byColor = new Map<string, DraftWikiCell[]>();
    const solo: DraftWikiCell[] = [];
    for (const cell of row.cells) {
      if (cell.cellKind !== "player") continue;
      if (cell.background === null) {
        solo.push(cell);
        continue;
      }
      if (cell.background === NON_LOTTERY_COLOR) {
        // ⚠**회색은 추첨이 아니다.** 1순위 입찰 행에 나오면 우리가 색의 뜻을 잘못 읽고 있는 것이다.
        throw new DraftWikiParseError(
          "1순위 입찰 행에 비추첨색(#ccc)이 있다 — 회색을 추첨으로 읽으면 가짜 경합이 생긴다(M7)",
          `${where} / ${row.labelRaw} col=${cell.columnIndex}`,
        );
      }
      const bucket = byColor.get(cell.background);
      if (bucket === undefined) byColor.set(cell.background, [cell]);
      else bucket.push(cell);
    }

    for (const [color, members] of byColor) {
      const names = new Set(members.map((m) => normalizePlayerName(m.display!)));
      const winners = members.filter((m) => m.bold);
      // ⚠**INV-1 은 「색의 뜻」 그 자체다.** 여기서 넘어가면 그 뒤 전부가 조용히 틀린다.
      if (winners.length !== 1 || names.size !== 1) {
        throw new DraftWikiParseError(
          "경합 그룹이 「굵은 칸 1개 · 선수명 1종」이 아니다 — 색·굵기를 잘못 읽고 있다(INV-1 · M7)",
          `${where} / ${row.labelRaw} color=${color} 굵은칸=${winners.length} 이름=${JSON.stringify([...names])}`,
        );
      }
      const groupKey = `${row.label.bidRound}:${[...names][0]!}`;
      for (const m of members) {
        bids.push({
          columnIndex: m.columnIndex,
          kind: row.kind,
          bidRound: row.label.bidRound,
          groupKey,
          won: m.bold,
          nameDisplay: m.display!,
          nameCanonical: m.canonical,
        });
      }
      const win = winners[0]!;
      picks.push({
        columnIndex: win.columnIndex,
        kind: row.kind,
        roundNo: 1,
        waiverDir: row.label.waiverDir,
        nameDisplay: win.display!,
        nameCanonical: win.canonical,
      });
    }

    for (const cell of solo) {
      // ⚠**단독지명은 「이겼다」가 아니다**(M11) — `won`·`groupKey` 가 `null` 인 것이 그 사실이다.
      bids.push({
        columnIndex: cell.columnIndex,
        kind: row.kind,
        bidRound: row.label.bidRound,
        groupKey: null,
        won: null,
        nameDisplay: cell.display!,
        nameCanonical: cell.canonical,
      });
      picks.push({
        columnIndex: cell.columnIndex,
        kind: row.kind,
        roundNo: 1,
        waiverDir: row.label.waiverDir,
        nameDisplay: cell.display!,
        nameCanonical: cell.canonical,
      });
    }
  }
  return { picks, bids, markers };
}

// ──────────────────────────────────────────────────────────────────────────
// 불변식 — ⚠**INV-1~6 은 내부 정합성이다.** 색을 통째로 잘못 읽어도 같이 통과한다
// ──────────────────────────────────────────────────────────────────────────

/**
 * `INV-2`~`INV-6` 을 잰다(⚠**`INV-1`·`INV-5` 는 파서가 이미 던진다** — 그것들이 깨진 채로는
 * 격자를 만들 수조차 없기 때문이다. 여기 `checked` 에 그 분모를 다시 싣는다).
 *
 * ⚠⚠**이것이 「그러므로 파싱이 맞다」를 뜻하지 않는다**(규칙표 §5 의 경고). 색을 통째로 잘못 읽어도
 * INV-1·INV-2 는 **같이 통과한다.** 색의 의미를 지탱하는 것은 **X-1**(npb 문장과의 대조) 하나뿐이다.
 *
 * ⚠**던지지 않는다** — 분모와 위반을 함께 돌려준다. 쓰는 쪽이 「무엇을 얼마나 쟀는가」를
 * 말할 수 있어야 하고, 「0건」과 「안 쟀음」이 구별돼야 한다.
 */
export function checkDraftWikiInvariants(parsed: DraftWikiParse): DraftWikiInvariantReport {
  const violations: { id: string; detail: string }[] = [];
  /**
   * ⚠**`Record<string, number>` 로 두지 않는다** — 오타 난 키가 조용히 새 칸을 만들고,
   * 그러면 **분모가 사라진 것과 0인 것을 구별할 수 없다.** 여섯이 못으로 박혀 있어야 한다.
   */
  const checked = { "INV-1": 0, "INV-2": 0, "INV-3": 0, "INV-4": 0, "INV-5": 0, "INV-6": 0 };
  if (parsed.kind !== "grid") return { checked, violations };
  const { grid, picks, bids } = parsed;
  const y = parsed.year;

  checked["INV-5"] = grid.rows.length;

  // INV-1 — 그룹마다 굵은 칸 1개 · 선수명 1종 (파서가 던지므로 여기서는 **분모만** 센다)
  checked["INV-1"] = new Set(bids.filter((b) => b.groupKey !== null).map((b) => `${b.kind}${SEP}${b.groupKey}`)).size;

  // INV-6 — 育成 구획에 추첨 색이 없다
  for (const row of grid.rows) {
    if (row.kind !== "ikusei") continue;
    checked["INV-6"] += 1;
    for (const c of row.cells) {
      if (c.background !== null && c.background !== NON_LOTTERY_COLOR) {
        violations.push({ id: "INV-6", detail: `${y} ${row.labelRaw} col=${c.columnIndex} ${c.background}` });
      }
    }
  }

  // ── 구획별 1순위 입찰 행 ──
  const sections = new Set(grid.rows.filter((r) => r.label.kind === "lottery").map((r) => r.kind));

  for (const kind of sections) {
    const lots = grid.rows.filter((r) => r.kind === kind && r.label.kind === "lottery");
    const byRound = new Map<number, DraftWikiRow>();
    for (const r of lots) {
      const bidRound = (r.label as { bidRound: number }).bidRound;
      if (byRound.has(bidRound)) {
        violations.push({ id: "INV-5", detail: `${y} ${kind} 1순위 입찰 회차 ${bidRound} 이 두 행이다` });
      }
      byRound.set(bidRound, r);
    }
    const ordered = [...byRound.keys()].sort((a, b) => a - b);

    // INV-2 — `1巡目k` 의 낙첨 구단 집합 = `1巡目k+1` 에서 이름이 있는 구단 집합
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      checked["INV-2"] += 1;
      const cur = byRound.get(ordered[i]!)!;
      const nxt = byRound.get(ordered[i + 1]!)!;
      const losers = new Set(
        cur.cells.filter((c) => c.cellKind === "player" && c.background !== null && !c.bold).map((c) => c.columnIndex),
      );
      const named = new Set(nxt.cells.filter((c) => c.cellKind === "player").map((c) => c.columnIndex));
      const only = (a: Set<number>, b: Set<number>): number[] => [...a].filter((x) => !b.has(x)).sort((p, q) => p - q);
      if (only(losers, named).length > 0 || only(named, losers).length > 0) {
        violations.push({
          id: "INV-2",
          detail:
            `${y} ${kind} ${cur.labelRaw}→${nxt.labelRaw} `
            + `낙첨만=${JSON.stringify(only(losers, named).map((i2) => grid.columns[i2]))} `
            + `다음행만=${JSON.stringify(only(named, losers).map((i2) => grid.columns[i2]))}`,
        });
      }
    }

    // INV-3 — 마지막 1순위 회차 행에 색칠된 칸이 없다
    const last = byRound.get(ordered[ordered.length - 1]!);
    if (last !== undefined) {
      checked["INV-3"] += 1;
      const colored = last.cells.filter((c) => c.background !== null);
      if (colored.length > 0) {
        violations.push({
          id: "INV-3",
          detail: `${y} ${kind} ${last.labelRaw} 에 색칠된 칸 ${colored.length}개 — 추첨이 안 끝났다는 뜻이다`,
        });
      }
    }

    // INV-4 — 구획×구단마다 **확정된 1순위 지명이 정확히 1건**
    // ⚠**표식(指名権剥奪)이 있는 구단은 분모에서 뺀다** — 2007 西武는 지명권 자체가 없었다.
    //   ⚠**「없는데 있다고」도 「있는데 없다고」도 하지 않는다**: 뺀 수를 `checked` 가 말한다.
    const revoked = new Set(
      parsed.markers.filter((m) => m.kind === kind && m.marker === "指名権剥奪").map((m) => m.columnIndex),
    );
    for (let col = 0; col < grid.columns.length; col += 1) {
      if (revoked.has(col)) continue;
      checked["INV-4"] += 1;
      const n = picks.filter((p) => p.kind === kind && p.columnIndex === col && p.roundNo === 1).length;
      if (n !== 1) {
        violations.push({ id: "INV-4", detail: `${y} ${kind} ${grid.columns[col]} 의 1순위 지명이 ${n}건이다` });
      }
    }
  }

  return { checked, violations };
}
