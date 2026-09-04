/**
 * 드래프트 회의 결과 파서 — npb.jp `npb.jp/draft/{YYYY}/draftlist_{team}.html`.
 *
 * ⚠**마크업이 연대별로 다르다.** 연도로 분기하지 말고 **구조로 판정**한다 —
 * 연도 하드코딩은 다음 해에 깨진다. 픽스처 4장에서 실측한 차이는 둘뿐이다:
 *   ⑴ **칸 수** — 4칸(회차·이름·포지션·소속) 또는 **5칸**(연령 `（22）` 이 3번째에 낀다).
 *   ⑵ **회차 라벨** — `1位`(2019) · `１巡目`(2006 전각) · `1巡目`(2001 반각).
 *      ⚠**2001 이 반각이다** — 「구형이면 전각」이 아니다. NFKC 가 셋을 같은 자리로 보낸다.
 *
 * ⚠**회차가 아예 없는 지명이 있다**(`<th>&nbsp;</th>`):
 * `自由獲得選手`(2001) · `希望入団枠獲得選手`(2006). 이건 결측이 아니라 **원래 없음**이라
 * `roundNo` 를 `null` 로 낸다(M11). ⚠**0 으로 메우지 마라** — 실제 회차 1·2·3 과 같은 칼럼에
 * 센티넬을 섞는 것이고, 한 구단이 自由獲得 을 둘 뽑은 해에는 두 행이 같은 키가 된다.
 * ⚠**「회차가 없으니 건너뛴다」는 더 나쁘다** — 2001 江尻慎太郎 · 2006 金刃憲人 같은
 * **실재하는 지명이 아무 소리 없이 사라진다.**
 *
 * ⚠**그 둘은 `kind` 도 다르다**(2026-09-05 결정 · 초판은 `shihaika` 로 접었다).
 * `自由獲得選手`·`希望入団枠獲得選手` 는 **섹션 머리가 다른 별도 구획**이고 회차라는 개념이
 * 없는 별개 제도다. `shihaika` 로 접으면 적재가 순번을 매기는 순간 **「1巡目 지명」과
 * 「희망입단枠 지명」이 같은 것이 된다.** `kind` 는 이미 「어느 구획/회의인가」를 뜻하므로
 * (`koukousei`·`daigaku_shakaijin` 이 그렇다) 새 칼럼이 아니라 **이 축을 늘린다.**
 * ⚠**그래도 `roundNo` 는 `null` 그대로다** — 파서는 소스가 말하는 것만 말한다.
 * 저장 키(순번)는 적재가 만든다. 파서가 `1` 을 지어내면 **소스에 있던 값과 구별할 수 없다.**
 *
 * ⚠**`（選択権なし）`·`（選択権利なし）` 는 선수가 아니다**(한 글자 다르다 · 2006 vs 2001).
 * 그대로 넣으면 그 이름의 선수가 생긴다(M11).
 * ⚠**판정은 반드시 NFKC 를 건 뒤의 형태로 한다** — NFKC 가 전각 괄호 `（）` 를 반각 `()` 로
 * 바꾸므로, 정규화한 문자열을 **전각 괄호 패턴으로 검사하면 영원히 안 맞는다.**
 *
 * ⚠**파싱 실패는 빈 값이 아니라 예외다**(M7). 칸이 한 칸 밀리면 「나이」가 포지션 칸에
 * 들어가는데, 그 화면은 그럴듯해서 눈으로는 못 잡는다.
 */
// ⚠어휘는 `positions.ts` 한 벌이다(M1). 초판은 여기에 **같은 4종을 다시 선언**했는데,
// 값이 문자 단위로 같아서 시험도 타입체크도 아무 말을 하지 않았다 — 한쪽만 고쳐지는 날
// 조용히 갈리는 모양이다. **정규화(`compact`)는 이 파일이 계속 갖는다**: 2006 의 `投　手` 는
// 이 소스만의 문제이고, 명단 파서는 정규화하지 않는 것이 맞다.
import { POSITIONS } from "./positions.ts";
import type { Position } from "./positions.ts";

export class DraftParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "DraftParseError";
    this.detail = detail;
  }
}

/**
 * 어느 구획(회의)의 지명인가.
 *
 * ⚠**`jiyuu_kakutoku`·`kibou_nyudanwaku` 는 「회차가 없는 제도」다** — 머리말 참조.
 * 이 둘을 `shihaika` 로 접으면 DB 에서 「1巡目」과 구별할 수 없게 된다.
 */
export type DraftKind =
  | "shihaika"
  | "ikusei"
  | "koukousei"
  | "daigaku_shakaijin"
  | "jiyuu_kakutoku"
  | "kibou_nyudanwaku";

export interface DraftPickRow {
  team: string;
  kind: DraftKind;
  /**
   * 회차. ⚠**`null` 은 「모른다」가 아니라 「원래 없다」**다 —
   * `自由獲得選手`·`希望入団枠獲得選手` 는 회차라는 개념이 없는 지명이다(M11).
   */
  roundNo: number | null;
  /**
   * 웨이버 방향. ⚠**npb.jp 명단 페이지는 이것을 적지 않는다** —
   * 픽스처 4장 전부에서 `→`·`←` 가 **0건**이다. 그래서 항상 `null` 이고,
   * **「1순위라서 null」이 아니라 「이 소스가 말하지 않아서 null」**이다.
   */
  waiverDir: "→" | "←" | null;
  /**
   * 페이지에 적힌 표기 그대로(태그·엔티티만 푼다).
   * ⚠**NFKC 를 걸지 않는다** — 이름의 동일성 판정은 `normalizePlayerName`(stats.ts) 한 벌이
   * 소유한다(M1). 여기서 따로 정규화하면 이름 규칙이 두 벌이 된다.
   */
  nameDisplay: string;
  /**
   * `投手`·`捕手`·`内野手`·`外野手`. ⚠2006 은 `投　手` 라 **공백을 지워야** 2019 와 같아진다.
   *
   * ⚠**어휘 밖이면 던진다**(M7 · 명단 파서와 **같은 어휘표**를 쓴다 · `positions.ts`).
   * 초판은 이 칸만 검증 없이 그대로 담았는데, 그러면 열이 밀렸을 때
   * **나이나 소속이 포지션으로 조용히 들어간다** — 이 파일 머리말이 막겠다고 선언한 바로 그 사고다.
   *
   * ⚠**빈 칸은 던지지 않고 `null` 이다**(M11 · 「원래 없음」). 근거 둘:
   * ⑴ **열이 밀려서 비는 일은 없다** — 왼쪽으로 밀리면 이름이, 오른쪽으로 밀리면 소속이
   *    들어오지 빈 칸이 되지 않는다. 즉 빈 칸은 밀림의 증상이 아니다.
   * ⑵ **소스에 실재하는 모양이다** — `（選択権なし）` 행의 포지션이 `&nbsp;` 다(2006 3행 ·
   *    2001 2행). 그 행들은 이름 쪽에서 이미 걸러지므로 여기까지 오지 않는다.
   * 실측(픽스처 4장): 지명 행 **40건 중 빈 포지션 0건 · 어휘 밖 0건**.
   */
  position: Position | null;
  fromOrg: string | null;
}

/**
 * 섹션 머리 → 구획. 실측한 머리 **7종**(픽스처 4장 전수): `新人選手選択会議` ·
 * `育成選手選択会議` · `希望入団枠獲得選手` · `大学生・社会人ほか選択会議` ·
 * `高校生選択会議` · `自由獲得選手` · `選択選手`.
 *
 * ⚠**순서에 정확성이 걸려 있지는 않다**(2026-09-05 정정 · 검수 지적). 초판 주석은
 * 「`育成` 를 먼저 봐야 한다」고 읽히게 썼는데, **실측하면 어느 순서든 충돌이 없다** —
 * `育成選手選択会議` 는 `選択選手` 를 부분문자열로 갖지 않는다(`選手選択` 은 갖지만 순서가 다르다).
 * 순서를 이렇게 둔 이유는 **읽는 사람이 글자를 세지 않아도 되게** 하려는 것이고,
 * 그건 정확성이 아니라 가독성의 이유다. **근거를 실제보다 강하게 적지 않는다.**
 * ⚠**시험이 고정하는 것은 「머리 7종이 각각 어느 kind 가 되는가」**이지 「순서를 바꿔도
 * 같다」가 아니다. 패턴을 더할 때는 **기존 7종에 걸리지 않는지 직접 확인해라.**
 */
const SECTION: ReadonlyArray<readonly [RegExp, DraftKind]> = [
  [/育成/, "ikusei"],
  [/高校生/, "koukousei"],
  [/大学生|社会人/, "daigaku_shakaijin"],
  [/自由獲得選手/, "jiyuu_kakutoku"],
  [/希望入団枠獲得選手/, "kibou_nyudanwaku"],
  [/新人選手選択会議|選択選手/, "shihaika"],
];

/** ⚠NFKC 를 건 뒤의 형태로 검사한다 — 전각 괄호는 그 시점에 반각이 되어 있다. */
const NOT_A_PLAYER = /^\(?選択権利?なし\)?$/;

/** 연령 칸(`（22）` → `(22)`). 5칸 배치를 **구조로** 확인하는 데 쓴다. */
const AGE = /^\(\d+\)$/;

/** 태그·엔티티를 풀고 공백을 한 칸으로 접는다. ⚠이 저장소의 관용(box.ts `stripTags`)과 같다. */
function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** NFKC + 공백 제거. 전각/반각·전각 공백 차이를 없앤 **판정용** 형태다. */
function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s/g, "");
}

/**
 * 푸터 위까지로 자른다. **두 파서가 같은 경계를 쓴다**(M1) — 마지막 섹션의 본문이
 * 문서 끝까지 뻗으므로, 언젠가 푸터에 표나 `※` 가 생기면 그것이 지명·경합으로 섞여 든다.
 * (실측: 지금 푸터에 `<table>` 도 `※` 도 0건이다 — 그래서 지금 막아 두는 편이 싸다.)
 */
function beforeFooter(html: string): string {
  const footer = html.indexOf("<footer");
  return footer === -1 ? html : html.slice(0, footer);
}

function kindOf(heading: string, where: string): DraftKind {
  for (const [re, kind] of SECTION) if (re.test(heading)) return kind;
  throw new DraftParseError(
    "모르는 섹션 머리 — 새 회의 종류가 생겼을 수 있다",
    `${where} / ${JSON.stringify(heading)}`,
  );
}

/** `1位` `１巡目` `1巡目` → 정수. 빈 칸이면 `null`(원래 없음). 그 밖이면 던진다. */
function roundOf(label: string, where: string): number | null {
  const t = compact(label);
  if (t === "") return null;
  const m = /^(\d+)(位|巡目)$/.exec(t);
  if (!m) throw new DraftParseError("모르는 순위 라벨", `${where} / ${JSON.stringify(label)}`);
  return Number(m[1]);
}

/**
 * 한 구단의 지명 명단을 읽는다.
 *
 * @param html `draftlist_{team}.html` 전문
 * @param team 구단 코드(URL 슬러그). ⚠페이지가 아니라 **호출자가 아는 사실**이다
 * @returns 지명 행. ⚠**빈 배열은 「전 회차를 건너뛴 구단」일 때만 나온다** —
 *   표를 못 읽은 경우는 던진다.
 * @throws {DraftParseError} 섹션이 없을 때 · 칸 수가 4도 5도 아닐 때 ·
 *   회차 라벨이나 연령 칸이 어휘 밖일 때 · **포지션이 어휘 밖일 때** · 이름 칸이 비었을 때.
 *   ⚠**삼키지 마라** — 열이 한 칸 밀리면 나이가 포지션으로 들어가고, 그 화면은 그럴듯하다.
 */
export function parseDraftPicks(html: string, team: string): DraftPickRow[] {
  // ⚠푸터 아래는 보지 않는다 — 사유는 `beforeFooter` 주석.
  const scope = beforeFooter(html);

  const sections = [...scope.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]*?)(?=<h4|$)/g)];
  if (sections.length === 0) {
    throw new DraftParseError("섹션(<h4>)이 없다 — 구조가 바뀌었거나 다른 페이지다", `team=${team}`);
  }

  const rows: DraftPickRow[] = [];
  let recognized = 0;

  for (const [, headingRaw, sectionBody] of sections) {
    const heading = decode(headingRaw ?? "");
    if (heading === "") continue;
    const where = `${team} / ${heading}`;
    const kind = kindOf(heading, where);
    recognized += 1;

    // ⚠**섹션마다 센다. 페이지 전체로 세면 안 된다.** 사유는 아래 던지는 자리 참조.
    let dataRows = 0;

    for (const table of (sectionBody ?? "").matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
      for (const tr of (table[1] ?? "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...(tr[1] ?? "").matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({
          tag: m[1] as string,
          text: decode(m[2] ?? ""),
        }));

        // 칸이 하나도 없는 `<tr>` 은 지명을 숨길 수 없다 — 여기만 조용히 넘긴다.
        if (cells.length === 0) continue;

        const shown = JSON.stringify(cells.map((c) => c.text));
        if (cells.length !== 4 && cells.length !== 5) {
          throw new DraftParseError(
            `지명 행의 칸이 ${cells.length}개다 — 4(회차·이름·포지션·소속) 도 5(+연령) 도 아니다`,
            `${where} / ${shown}`,
          );
        }
        if (cells[0]?.tag !== "th") {
          throw new DraftParseError("첫 칸이 <th>(회차)가 아니다 — 열이 밀렸다", `${where} / ${shown}`);
        }
        dataRows += 1;

        const hasAge = cells.length === 5;
        if (hasAge) {
          // ⚠빈 칸은 실재한다 — `（選択権なし）` 행의 연령은 `&nbsp;` 다.
          const age = compact(cells[2]?.text ?? "");
          if (age !== "" && !AGE.test(age)) {
            throw new DraftParseError(
              "5칸 행의 3번째가 연령(（NN）)이 아니다 — 열이 밀렸다",
              `${where} / ${shown}`,
            );
          }
        }

        const nameRaw = cells[1]?.text ?? "";
        const nameKey = compact(nameRaw);
        if (NOT_A_PLAYER.test(nameKey)) continue; // ⚠선수가 아니라 「건너뛴 회차」다
        if (nameRaw === "") {
          throw new DraftParseError("이름 칸이 비었다 — 빈 값으로 흘리지 않는다(M7)", `${where} / ${shown}`);
        }
        // ⚠**아는 두 표기만 걸러서는 부족하다.** `（選択権無し）` 처럼 한 글자만 달라진 변종이
        // 나오면 위 필터를 빠져나가 **그 이름의 선수가 조용히 생긴다** — 이 파서가 틀리는
        // 방식 그 자체다. 선수 이름은 괄호로 묶이지 않으므로, **괄호로 묶인 칸은 표기이지
        // 이름이 아니다**로 보고 던진다. 새 표기는 사람이 보고 어휘에 넣어야 한다.
        if (/^\(.*\)$/.test(nameKey) || nameKey.includes("選択権")) {
          throw new DraftParseError(
            "이름 칸이 선수 이름이 아니다 — 모르는 표기를 선수로 만들지 않는다(M7·M11)",
            `${where} / ${JSON.stringify(nameRaw)}`,
          );
        }

        const positionRaw = (hasAge ? cells[3]?.text : cells[2]?.text) ?? "";
        const fromOrgRaw = (hasAge ? cells[4]?.text : cells[3]?.text) ?? "";

        // ⚠`投　手` → `投手`. 전각 공백을 남기면 2019 의 `投手` 와 **다른 값**이 된다.
        const positionKey = compact(positionRaw);
        // ⚠**어휘 밖을 그대로 담지 않는다**(M7 · `positions.ts:POSITIONS` — 명단 파서와 **같은 표**).
        // 담으면 열이 밀렸을 때 나이·소속이 포지션이 되고 **그 화면은 그럴듯하다.**
        // 빈 칸만은 `null`(원래 없음)이다 — 사유는 `DraftPickRow.position` 주석.
        const position = positionKey === "" ? null : POSITIONS[positionKey];
        if (position === undefined) {
          throw new DraftParseError(
            "포지션이 어휘(投手·捕手·内野手·外野手) 밖이다 — 모르는 값을 그대로 담지 않는다(M7)",
            `${where} / ${JSON.stringify(positionRaw)} / ${shown}`,
          );
        }

        rows.push({
          team,
          kind,
          roundNo: roundOf(cells[0]?.text ?? "", where),
          waiverDir: null,
          nameDisplay: nameRaw,
          position,
          // ⚠`ＪＲ東日本` → `JR東日本`. 2019 는 이미 반각이라 NFKC 가 연대를 맞춘다.
          fromOrg: fromOrgRaw === "" ? null : fromOrgRaw.normalize("NFKC"),
        });
      }
    }

    // ⚠⚠**섹션마다 던진다. 페이지 전체로 세면 조용한 소실이 된다.**
    // 전역 카운터였을 때는 **한 섹션만 구조가 깨져 0행이 되어도 다른 섹션이 정상이면
    // 예외가 안 났고**, 그 섹션이 통째로 빠진 배열이 «정상»으로 반환됐다.
    // ⚠**그 배열을 적재가 받으면 실데이터가 지워진다** — 적재는 구단 단위로 지우고 다시 넣으므로
    // (`store/src/draft.ts`) 빠진 구획의 행이 **에러 없이 사라진다.** M7 이 막는 것은
    // 「조용한 오답」인데 여기서는 **「조용한 소실」**이었다.
    //
    // ⚠**세는 것은 「읽어 낸 지명 행」이지 「출력한 행」이 아니다.** 둘을 헷갈리면 오탐이 난다 —
    // `（選択権なし）` 는 **읽히지만 선수가 아니라서** 출력되지 않는다(실측: 픽스처 4장에서 **5건**).
    // 「전 회차를 건너뛴 섹션」은 0건이 정답이고, 여기서 던지면 안 된다(M11).
    //
    // ⚠**오탐 위험을 안다.** 「구획 머리는 있는데 지명 행이 0인」 섹션이 정상으로 실재하면
    // 그 구단 페이지가 통째로 실패한다. 실측(픽스처 4장 · 인식된 섹션 **10개 중 0건**)이지만
    // **「10개 중 0건」이지 「그런 경우는 없다」가 아니다** — 12구단 × 22시즌은 안 쟀다.
    // 그래도 던지는 쪽을 골랐다: **헛불은 시끄럽고 고칠 수 있지만, 지워진 행은 조용하고 영구적이다.**
    if (dataRows === 0) {
      throw new DraftParseError(
        "이 섹션에서 지명 행을 한 건도 못 읽었다 — 섹션이 통째로 빠진 배열을 정상으로 내보내지 않는다(M7)",
        `${where} / kind=${kind}`,
      );
    }
  }

  // ⚠머리가 전부 빈 `<h4>` 뿐이면 위 루프가 한 번도 안 돈다 — 그때도 빈 배열로 흘리지 않는다.
  if (recognized === 0) {
    throw new DraftParseError(
      "인식된 섹션이 하나도 없다 — 빈 배열로 흘리지 않는다(M7)",
      `team=${team} / <h4> ${sections.length}개`,
    );
  }
  return rows;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 경합(추첨) 주석 — 표 아래 `※` 한 줄짜리 산문.
 *
 * 「제비뽑기에서 누가 걸렸고 다음 1지망을 누구로 바꿨는지」가 **전부 여기서 나온다.**
 * 표는 **결과만** 싣는다 — 누구를 노렸다가 놓쳤는지는 이 문장에만 있다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 경합 1건 = 「1순위 N회차에 누구를 놓고 누구와 붙어서 이겼나/졌나」. */
export interface DraftBidRow {
  team: string;
  /** 1순위 입찰 회차. ⚠**여기는 `null` 이 없다** — 경합은 1순위에서만 일어난다. */
  roundNo: number;
  /**
   * 경합 상대 구단의 **표기 그대로**(`東京ヤクルト`·`横浜DeNA`…).
   * ⚠**코드 변환은 적재(store)의 일이다** — 파서가 약칭을 손대면 최장일치 규칙이 두 벌이 되고,
   * `横浜DeNA` 를 `横浜` 로 먼저 먹는 사고가 **두 곳에서** 날 수 있게 된다.
   */
  rivals: string[];
  /**
   * 노렸던 선수. ⚠**당첨이면 `null` 이다 — 결측이 아니라 「소스가 안 쓴다」**(M11).
   * 당첨 주석은 이름을 생략하고, **그 팀 표의 그 회차 값이 곧 그 선수**다.
   * ⚠**파서가 그것을 지어내지 않는다** — 표와 잇는 것은 적재의 일이고, 여기서 채우면
   * 「소스에 적혀 있던 이름」과 「우리가 추론한 이름」을 **구별할 수 없게 된다.**
   *
   * ⚠**NFKC 를 걸지 않는다** — `DraftPickRow.nameDisplay` 와 **같은 규칙**이다(M1).
   * 한쪽만 정규화하면 이름 규칙이 두 벌이 되고, 두 표를 나란히 놓은 사람만 그 차이를 본다.
   */
  nameDisplay: string | null;
  /** `確定`(교섭권 획득) = true · `外れる`(낙첨) = false. */
  won: boolean;
}

/**
 * 주석의 경계. ⚠**`※` 로 자르는 것만으로는 부족하다** — 마지막 주석의 덩어리가
 * **페이지 끝까지** 뻗어서, 뒤쪽 산문에 `抽選で` 가 있으면 아래 M7 그물이 헛불을 낸다.
 * 그래서 각 덩어리를 **자기 블록 안**으로 가둔다. `<a>`·`<span>` 같은 인라인 태그는
 * 경계가 아니다(그건 `decode` 가 지운다) — 언젠가 이름에 링크가 붙어도 잘리지 않는다.
 */
const BLOCK_TAG =
  /<\s*\/?\s*(?:br|p|div|td|th|tr|li|ul|ol|dl|dt|dd|table|tbody|thead|h[1-6]|section|article|footer|body|html)\b/i;

/** 포지션 어휘는 `positions.ts` 한 벌이다(M1). 길이 내림차순 — 접두 충돌을 구조적으로 막는다. */
const POSITION_ALT = Object.keys(POSITIONS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * 경합 주석 문법(규칙 문서 §2 · 실측 40건 전건이 이 하나로 파싱됐다):
 * ```
 * ※{1巡目|1位}[（第N回）]： [{선수명}{投手|内野手|外野手|捕手}で]{구단}[、{구단}…]と重複、抽選で{外れる|確定}
 * ```
 *
 * ⚠⚠**브리프의 정규식을 그대로 쓰지 않았다. 실물 3건 중 0건이 통과했기 때문이다.**
 * 브리프는 `NFKC 를 먼저 걸고` `^(?:1巡目|1位)(?:（第(\d+)回）)?[：:]` 로 매치했는데,
 * **NFKC 가 전각 괄호 `（）` 를 반각 `()` 로 바꾼다.** 그래서
 *   - 2019(`※1巡目（第1回）：`) → NFKC 후 `1巡目(第1回):` 이라 `（第…回）` 가 안 맞고,
 *     그다음 `[：:]` 가 `(` 를 만나 **전체가 실패**한다 → 그 해 경합이 **0건**이 된다.
 *   - 2006(`※１巡目：`) → NFKC 를 안 걸면 `1巡目` 이 **전각 `１`** 을 못 맞춘다.
 * **즉 NFKC 를 걸어도 안 걸어도 안 되는, 두 폭이 섞인 정규식이었다.**
 * ⚠**Task 3 의 `（選択権なし）` 사고와 같은 종류다** — 「NFKC 뒤의 형태로 검사한다」를
 * 한쪽에만 적용했다.
 *
 * → **폭 관용(width-tolerant)으로 쓰고 원문에 그대로 건다.** NFKC 를 통째로 걸지 않는 이유는
 * 그래야 `nameDisplay` 가 **원문 그대로**가 되어 `DraftPickRow.nameDisplay` 와 규칙이 같아지기
 * 때문이다(M1). 폭 차이는 **구조 토큰 넷**(선두 숫자·괄호·회차 숫자·콜론)에만 있고,
 * 그 넷을 문자 클래스로 열어 두는 것이 「이름 규칙을 두 벌로 만드는 것」보다 싸다.
 * ⚠**그래도 못 맞추는 변종이 오면 아래 M7 그물이 던진다** — 조용히 0건이 되지 않는다.
 */
const BID_RE = new RegExp(
  "^[1１](?:巡目|位)" + // ⚠1순위만이다. 2순위 이후는 웨이버라 추첨이 없다
    "(?:[（(]第([0-9０-９]+)回[）)])?" + // 그 구단 주석이 2건 이상일 때만 붙는다(§2)
    "\\s*[：:]\\s*" +
    `(?:(.+?)(?:${POSITION_ALT})で)?` + // ⚠낙첨일 때만 있다 — 당첨은 이름을 생략한다
    "(.+?)と重複[、，,]\\s*抽選で(外れる|確定)",
);

/**
 * ⚠**M7 그물.** 「경합 주석처럼 보이는데 문법에 안 맞는 것」을 실패로 만든다.
 *
 * 이 파서가 조용히 틀리는 방식은 명단 파서와 **모양이 다르다** — 명단은 열이 밀려서
 * 「그럴듯한 오답」이 나오지만, 여기는 **매치가 안 되면 그냥 0건**이고
 * **0건은 단독지명 구단의 정답이기도 하다.** 즉 실패와 정답이 같은 모양이라
 * 그물이 없으면 **어휘가 바뀐 해의 경합이 통째로 사라져도 아무도 못 읽는다.**
 *
 * ⚠**`AND` 가 아니라 `OR` 인 것이 요점이다.** `と重複` 과 `抽選で` 를 둘 다 요구하면
 * **한쪽 낱말만 바뀐 날**(`重複`→`競合`) 그물을 그냥 빠져나간다. 헛불(무관한 주석에
 * `抽選` 이 들어 있는 경우)은 **시끄럽고 고칠 수 있지만**, 놓친 경합은 조용하고 영구적이다.
 */
const LOOKS_LIKE_BID = /と重複|抽選で/;

/**
 * 한 구단의 경합(추첨) 주석을 읽는다.
 *
 * @param html `draftlist_{team}.html` 전문
 * @param team 구단 코드(URL 슬러그). ⚠페이지가 아니라 **호출자가 아는 사실**이다
 * @returns 문서 순서대로. ⚠**빈 배열은 정상이다** — 단독지명 구단에는 주석이 없다
 *   (실측: 2019 広島 · 2001 니혼햄이 각각 0건). **실패가 아니다.**
 * @throws {DraftParseError} 경합 주석처럼 보이는데 문법에 안 맞을 때 ·
 *   `（第N回）` 가 문서 순서와 어긋날 때 · 상대 구단 칸이 빌 때.
 */
export function parseDraftBids(html: string, team: string): DraftBidRow[] {
  // ⚠`<p>` 단위가 아니라 `※` 로 자른다 — `<br>` 없이 두 주석이 붙어 있는 해가 있다(2007 西武).
  // `<p>` 로 자르면 뒤엣것이 **통째로 사라진다.**
  const chunks = beforeFooter(html).split("※").slice(1);

  const rows: DraftBidRow[] = [];
  let seq = 0;

  for (const chunk of chunks) {
    const cut = chunk.search(BLOCK_TAG);
    const text = decode(cut === -1 ? chunk : chunk.slice(0, cut));
    const m = BID_RE.exec(text);

    if (!m) {
      // 드래프트와 무관한 `※` 주석은 그냥 건너뛴다 — 그건 예외가 아니다.
      if (LOOKS_LIKE_BID.test(text)) {
        throw new DraftParseError(
          "경합 주석처럼 보이는데 문법에 맞지 않는다 — 조용히 0건으로 흘리지 않는다(M7)",
          `team=${team} / ${JSON.stringify(text)}`,
        );
      }
      continue;
    }

    seq += 1;
    const [, roundRaw, nameRaw, rivalsRaw, outcome] = m;

    // ⚠`（第N回）` 가 없으면 **주석 순서가 회차**다(규칙 문서 §2 — 2건 이상일 때만 붙는다).
    let roundNo = seq;
    if (roundRaw !== undefined) {
      roundNo = Number(roundRaw.normalize("NFKC")); // ⚠전각 숫자가 섞인다(2006·2007)
      // ⚠둘이 어긋나면 둘 중 하나가 틀린 것이고, **어느 쪽인지 파서가 고를 수 없다.**
      // 말없이 한쪽을 고르면 회차가 조용히 밀린 채 상대전적까지 흘러간다.
      if (roundNo !== seq) {
        throw new DraftParseError(
          `（第${roundNo}回）가 문서 순서(${seq}번째 주석)와 어긋난다 — 어느 쪽이 맞는지 파서가 정하지 않는다(M7)`,
          `team=${team} / ${JSON.stringify(text)}`,
        );
      }
    }

    // ⚠표기 그대로 담는다. 구단 코드로 바꾸는 것은 적재의 일이다(`DraftBidRow.rivals`).
    // ⚠`length === 0` 은 검사하지 않는다 — `split` 은 빈 배열을 낸 적이 없고
    // `rivalsRaw` 는 `(.+?)` 라 비어 있을 수 없다. **닿지 않는 가지는 검사가 아니라 소음이다.**
    const rivals = (rivalsRaw ?? "").split(/[、，,]/).map((s) => s.trim());
    if (rivals.some((s) => s === "")) {
      throw new DraftParseError(
        "경합 상대 칸이 비었다 — 빈 값으로 흘리지 않는다(M7)",
        `team=${team} / ${JSON.stringify(rivalsRaw)}`,
      );
    }

    rows.push({
      team,
      roundNo,
      rivals,
      // ⚠당첨이면 소스가 이름을 안 쓴다. `null` 이고, 표와 잇는 것은 적재의 일이다(M11).
      nameDisplay: nameRaw ?? null,
      won: outcome === "確定",
    });
  }

  return rows;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 수집 진입점 — 연도 색인과 구단 슬러그 **발견**.
 *
 * ⚠**여기가 적게 내면 그만큼이 아예 수집되지 않는다.** 그리고 그 결과는 에러가 아니라
 * **빈 화면**이라, 「그 해는 원래 그렇다」로 읽힌다 — CLAUDE.md §2 의 2018 오릭스 사고
 * (`bs` 를 `b` 로 알고 적재해 148경기가 실패)와 같은 자리다. 그래서 두 함수 다
 * **0건을 정답으로 인정하지 않고**(M7), 「일부만 읽었을 가능성」에 그물을 하나씩 둔다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 슬러그를 못 읽었을 때 **무엇을 봤는가**. ⚠**판정이 아니라 관측이다.**
 *
 * ⚠**파서는 「아직 안 열렸다」를 말할 수 없다.** 그러려면 오늘이 며칠인지 읽어야 하는데
 * 시계는 주입된 `clock` 만 읽고(M6) 파서는 순수하다. 그래서 여기서 내보내는 것은
 * **본 것**뿐이고, 「개최 전인가 붕괴인가」는 **그 연도가 과거인지 아는 호출자**가 정한다.
 * ⚠**과거 연도에서 `no-team-links` 가 나오면 그건 개최 전이 아니라 붕괴다.**
 * 그래서 이름에 「개최 전」·「아직」을 넣지 않았다 — 넣는 순간 **파서가 못 하는 판정을
 * 한 것처럼 읽히고**, 호출자는 그 이름을 믿고 소급 연도의 붕괴를 조용히 넘긴다.
 */
export type DraftIndexObservation =
  /** 드래프트 페이지 표지는 있는데 `draftlist_*` 링크가 0건. */
  | "no-team-links"
  /** 그 표지조차 없다 — 드래프트 페이지가 아닌 것을 받았다(404 본문·리다이렉트 등). */
  | "no-draft-marker";

/**
 * 슬러그 0건을 **갈래와 함께** 던진다.
 *
 * ⚠**`DraftParseError` 의 하위 클래스다** — 기존 호출자(`e instanceof DraftParseError`)와
 * 기존 시험을 깨지 않는다. 새로 얻는 것은 `observed` 하나이고, 그게 있어야 호출자가
 * **한국어 메시지를 문자열 매칭하지 않고** 두 갈래를 가를 수 있다.
 */
export class DraftIndexError extends DraftParseError {
  readonly observed: DraftIndexObservation;
  constructor(message: string, detail: string, observed: DraftIndexObservation) {
    super(message, detail);
    this.name = "DraftIndexError";
    this.observed = observed;
  }
}

/**
 * npb.jp 드래프트 페이지의 표지.
 *
 * ⚠⚠**`開催要項` 을 표지로 쓰지 마라 — 그건 개최 여부를 말하지 않는다.**
 * 2026(개최 전) 톱에 그 말이 있어서 「개최 전 표지」로 삼고 싶어지는데,
 * **이미 끝난 시즌에도 그대로 남는다**: 커밋된 픽스처 실측으로 2013 에 **1건** ·
 * 2024 에 **2건**이고 **그 두 해는 슬러그가 12개씩 있다**(= 드래프트가 실제로 열렸다).
 * 거꾸로 2001·2006 톱에는 **0건인데 그 두 해도 열렸다.**
 * → `開催要項` 은 「열렸다」와도 「안 열렸다」와도 상관이 없는 **템플릿 잔존물**이다.
 * **표지가 답해야 하는 질문에 애초에 답하지 않는다.**
 *
 * ⚠**표지가 답할 질문은 「이 페이지가 드래프트 섹션의 페이지인가」**이고 `page_draft` 가
 * 정확히 그것이다 — `<body class="page_draft" id="ctop">`(연도 톱) ·
 * `<body id="draftlist" class="page_draft">`(구단별)로 **템플릿 수준**에 있다
 * (⚠속성 순서가 다르므로 body 태그 전체를 문자열로 맞추지 마라).
 * 커밋된 드래프트 픽스처 **10장 중 9장**에 있고 **없는 1장이 실물 404 본문**이다.
 * ⚠구단별 페이지도 이 표지를 갖는다 — 「드래프트 섹션의 페이지인가」를 보는 것이지
 * 「연도 톱인가」가 아니다.
 *
 * ⚠**틀렸던 사유를 남긴다**(2026-09-05 재검수에서 뒤집힘). 초판은 이렇게 적었다:
 * ~~「`開催要項` 을 표지로 쓰면 2001 의 마크업 붕괴가 「아직 안 열렸다」로 읽혀서,
 * 놓치면 안 되는 쪽을 정확히 놓친다」~~ — **방향이 반대였다.** 아래 삼항식에 대입하면
 * 2001 톱은 `開催要項` 이 **없으므로** `no-draft-marker`(엄격한 갈래)로 가고, 삼켜질
 * 위험이 있는 것은 `no-team-links` 쪽이다. 즉 그 표지는 **안전한 쪽으로 틀린다**
 * (실물 드래프트 페이지를 「드래프트 페이지가 아니다」라고 오진할 뿐 삼켜지지는 않는다).
 * ⚠**결론은 안 바뀌었고 사유만 바뀌었다** — `CLAUDE.md` §2-2 의 WAR·xFIP 판정이
 * 「결론은 한 번도 안 바뀌었고 네 번 다 사유가 틀렸다」인 것과 **같은 자리**다.
 * **결론이 맞았다고 사유를 안 고치면, 다음 사람이 그 사유를 근거로 다른 결정을 내린다.**
 */
const DRAFT_PAGE_MARKER = "page_draft";

/**
 * 연도 링크. **연도가 경로의 마지막 칸**일 때만 잡는다.
 *
 * ⚠⚠**브리프의 `/href="\.?\/?(\d{4})\/"/` 는 실물에서 0건이었다**(2026-09-05 실측).
 * `backnumber.html` 의 실제 마크업은 `href="./2001/"` 가 아니라 **`href="/draft/2001/"`** 다.
 * 그대로 갔으면 진입점이 **첫 실행에서 던지고 드래프트 수집이 통째로 안 돌았다.**
 * ⚠**Task 4 와 같은 종류의 실패다** — 합성 문자열로만 맞춘 정규식은 실물에서 0건이 된다.
 *
 * 세 형태를 받는다: `href="2001/"` · `href="./2001/"` · `href="/draft/2001/"`.
 * ⚠**`/draft/` 로 한정하는 것이 요점이다.** 같은 페이지에 **경기 결과 링크**
 * `/scores/2026/0904/b-m-21/` 가 실재하므로(실측 5건), 느슨하게 `(\d{4})\/` 로 잡으면
 * **`0904` 가 904년이 되어** 색인에 섞인다. 904 는 눈에 띄지만 **`2026` 은 진짜 연도와
 * 구별되지 않는다** — 그쪽이 더 위험하다.
 */
const YEAR_HREF = /href="(?:\.\/|\/draft\/)?(\d{4})\/"/g;

/** 위 그물용 — 형태를 가리지 않고 「드래프트 연도를 가리키는 참조」를 전부 센다. */
const DRAFT_YEAR_REF = /\/draft\/(\d{4})/g;

/**
 * `backnumber.html` 에서 연도를 뽑는다. **오름차순 · 중복 제거.**
 *
 * ⚠**이 함수는 사이트가 나열하는 그대로를 낸다 — 수집 범위를 여기서 자르지 마라.**
 * 실측(2026-09-04 표본): 색인이 **2001~2026 · 26개 · 결번 0**을 나열한다. 그런데
 * **우리가 담기로 한 범위는 2005~2026**이다(2026-09-04 사용자 결정 ·
 * `docs/sources/2026-09-04-draft-source-survey.md`) — 2005 이전으로 소급하려면
 * **「그 시즌에 존재한 구단」 이력 마스터가 선행 조건**이기 때문이다.
 * ⚠**그 둘은 다른 층이다**: 여기는 「소스가 무엇을 갖고 있는가」이고 범위는 「우리가 무엇을
 * 받는가」다. 섞으면 소스가 줄어든 것과 우리가 안 받기로 한 것을 **구별할 수 없게 된다.**
 * 그래서 아래 시험에도 **범위 밖 연도(2001)**가 그대로 나온다 — 그건 결함이 아니다.
 *
 * @param html `https://draft.npb.jp/draft/backnumber.html` 전문
 * @returns 그 색인이 나열하는 연도. ⚠**빈 배열을 내지 않는다** — 0건은 던진다.
 * @throws {DraftParseError} 연도 링크가 0건일 때 ·
 *   **`/draft/YYYY` 를 가리키는데 연도로 안 잡힌 참조가 있을 때**(아래).
 */
export function parseDraftYears(html: string): number[] {
  const years = new Set<number>();
  for (const m of html.matchAll(YEAR_HREF)) years.add(Number(m[1]));

  // ⚠**이 파서가 조용히 틀리는 방식은 「전부 실패」가 아니라 「최신 연도만 놓침」이다.**
  // 색인이 최신 한 해만 `/draft/2027/index.html` 같은 다른 형태로 걸면 나머지 26개는
  // 그대로 나오므로 **아무도 결함으로 못 읽는다** — 그런데 놓친 그 하나가 **올해**이고,
  // 올해가 곧 새로 열린 드래프트다. 전부 실패는 시끄럽지만 이건 조용하다.
  // ⚠**이미 잡은 연도를 다시 가리키는 참조는 헛불이 아니다**(`/draft/2026/schedule.html`
  // 같은 편의 링크가 언제든 생길 수 있다) — **못 잡은 연도**만 센다.
  const missed = [...html.matchAll(DRAFT_YEAR_REF)]
    .map((m) => Number(m[1]))
    .filter((y) => !years.has(y));
  if (missed.length > 0) {
    throw new DraftParseError(
      "`/draft/YYYY` 를 가리키는데 연도 링크로 안 잡힌 참조가 있다 — 일부만 읽고 넘어가지 않는다(M7)",
      `못 잡은 연도 ${JSON.stringify([...new Set(missed)].sort())} / 잡은 연도 ${years.size}개`,
    );
  }

  if (years.size === 0) {
    throw new DraftParseError(
      "연도 링크를 못 찾았다 — 빈 배열로 흘리지 않는다(M7)",
      `html ${html.length}자`,
    );
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * 구단 슬러그. ⚠**`href=` 를 요구하지 않는다** — 연도 톱이 세 형태를 섞어 쓴다:
 * `./draftlist_bs.html`(2013) · `draftlist_l.html`(2024) · `/draft/2013/draftlist_f.html`.
 */
const TEAM_SLUG = /draftlist_([a-z]+)\.html/g;

/**
 * 위 그물용. ⚠**여기만 `href=` 로 한정한다** — 구단별 페이지에는
 * `<option value="draftlist_s">`(`.html` 없음)가 12개 있어서, 한정하지 않으면
 * **그 페이지를 넣었을 때 통째로 헛불**이 난다.
 */
const SLUG_HREF = /href="[^"]*draftlist_([^"]*)"/g;

/**
 * 연도 톱(`/draft/{YYYY}/`)에서 구단 슬러그를 **발견**한다. 정렬 · 중복 제거.
 *
 * ⚠**하드코딩 금지.** 슬러그는 **연도의 함수**다.
 *
 * ⚠**아래 표의 분모는 26개 연도 중 6개다**(2026-09-05 실측: 2001·2006·2013·2024·2025·2026).
 * **나머지 20개 연도 톱은 「같다」가 아니라 「안 쟀다」**이고, 표에 없는 연대에서 다섯 번째
 * 집합이 나올 수 있다. **이 표를 「규명 완료된 목록」으로 읽지 마라** — 표의 쓸모는
 * 「집합이 실제로 갈린다」를 보이는 것이지 「이게 전부다」가 아니다.
 * ⚠**그 6개 중 픽스처로 커밋된 것은 4개다**(2001·2013·2024·2026). 2006·2025 는 무추적
 * `docs/sources/samples/` 에만 있어 **클론한 사람은 검산할 수 없다** — 분모를 적을 때
 * **저장소 안에서 셀 수 있는 수인지** 함께 봐라.
 * (실물 실측 · 2026-09-05):
 * | 연도 | 오릭스 | 요코하마 | 그 밖 |
 * | 2001 | `bw`(ブルーウェーブ) | `yb` | **`bu`(近鉄) 가 있다 · 楽天 없음** |
 * | 2006 | `bs` | `yb` | `e`(楽天) |
 * | 2013 | **`bs`** | `db` | — |
 * | 2024 | **`b`** | `db` | — |
 * `draftlist_b.html` 은 2013 에서 **nginx 404** 다(표본으로 확인). 하드코딩하면
 * 그 해 오릭스가 **통째로 빈다.** 2001 은 더 나쁘다 — 현행 12구단 표를 박으면
 * **近鉄·ブルーウェーブ 두 구단이 어느 표에도 없어서 조용히 사라진다.**
 *
 * @param html 연도 톱 전문. ⚠**연도 톱을 넣어라.** 구단별 페이지에도 같은 12개 링크가 있어
 *   값 자체는 나온다(실측 3장 전부 12/12) — 그래서 **지금은 결과가 같고, 그게 함정이다.**
 *   그 페이지는 `link_prev`/`link_next` 로 **다른 해**도 함께 가리키는데, 실측 5장에서는
 *   전부 **자기와 같은 슬러그**라 섞이지 않았다. ⚠**「그러니 안전하다」로 읽지 마라** —
 *   그 링크는 **해만 갈아 끼우는 순진한 것**이라(2025 의 `next` 가 아직 없는
 *   `/draft/2026/draftlist_b.html` 를 가리킨다) 슬러그가 바뀌는 해를 사이에 두면
 *   맞는다는 보장이 없다. **그 해의 12구단을 실제로 나열하는 것은 연도 톱뿐이다.**
 * @returns 그 해의 구단 슬러그. ⚠**빈 배열을 내지 않는다** — 0건은 던진다.
 * @throws {DraftParseError} **`href` 의 `draftlist_` 꼬리가 `{소문자}.html` 이 아닐 때**.
 * @throws {DraftIndexError} 슬러그가 **0건**일 때. ⚠**두 갈래를 `observed` 로 갈라 준다** —
 *   `"no-team-links"`(드래프트 페이지인데 구단 링크가 0건) · `"no-draft-marker"`(드래프트
 *   페이지가 아닌 것을 받았다 · 404 본문 등). **호출자는 메시지를 문자열 매칭하지 마라.**
 *
 *   ⚠**0건이 정상인 때가 실재한다.** 실측: 2026 연도 톱(개최 2개월 전)은 구단 링크가
 *   **0건**이고 `draftlist_*` 는 **개최 당일에 생긴다**(조사 문서 §7). 그건 결측이 아니라
 *   **아직 없음**이다.
 *   ⚠**그래도 던진다**: 빈 배열로 흘리면 **진짜로 무너진 날에도 똑같이 조용하다.**
 *   ⚠**그리고 파서는 어느 쪽인지 정하지 않는다** — 그 판정에는 「그 연도가 과거인가」가
 *   필요하고 그건 시계를 읽는 일이다(M6). **`observed` 를 받아 호출자가 정한다.**
 *   ⚠**호출자에게**: `"no-team-links"` 를 무조건 「아직」으로 삼키지 마라 —
 *   **과거 연도에서 그게 나오면 붕괴다.** 삼키지 말고 연도별 상태로 남겨라.
 */
export function parseDraftTeamSlugs(html: string): string[] {
  const slugs = new Set<string>();
  for (const m of html.matchAll(TEAM_SLUG)) slugs.add(m[1] as string);

  // ⚠**놓친 한 구단은 조용하고 영구적이다.** 슬러그 어휘가 한 구단만 바뀌면(`draftlist_B.html`)
  // 나머지 11개가 정상으로 나오므로 **개수를 세도 안 잡힌다.**
  // ⚠**개수 12 를 박아서 막을 수는 없다** — 개최 전(0건)과 소급 연도가 그 검사에 걸린다.
  // 그래서 「몇 개인가」가 아니라 **「읽으려다 못 읽은 것이 있는가」**를 본다.
  // ⚠`m[1]` 은 **위 `TEAM_SLUG` 과 같은 방식으로** 받는다(둘 다 필수 캡처 그룹이라
  // 매치되면 언제나 문자열이다). ⚠**`?? ""` 로 받지 않는다** — 그러면 「불가능한 undefined」와
  // 「실재하는 빈 꼬리」가 같은 값이 되어 구별이 사라진다.
  // ⚠**여기서만 빈 문자열이 정상 입력이다**(`href="…draftlist_"`): 아래 어휘 검사가
  // 그걸 걸러 던지는 것이 맞고, 그래서 이 자리에 빈 값 가드를 따로 두지 않는다.
  const odd = [...html.matchAll(SLUG_HREF)]
    .map((m) => m[1] as string)
    .filter((tail) => !/^[a-z]+\.html$/.test(tail));
  if (odd.length > 0) {
    throw new DraftParseError(
      "`draftlist_` 링크의 꼬리가 어휘(`{소문자}.html`) 밖이다 — 한 구단이 조용히 빠지지 않게 던진다(M7)",
      `${JSON.stringify([...new Set(odd)])} / 읽은 슬러그 ${slugs.size}개`,
    );
  }

  if (slugs.size === 0) {
    // ⚠**같은 「0건」인데 뜻이 정반대인 둘을 갈라서 준다.** 호출자가 메시지 문자열을
    // 매칭하지 않아도 되게 `observed` 를 붙인다. ⚠**여기서 판정하지 않는다** —
    // 「아직 안 열렸다」인지 「무너졌다」인지는 **그 연도가 과거인지 아는 쪽**만 안다.
    const observed: DraftIndexObservation = html.includes(DRAFT_PAGE_MARKER)
      ? "no-team-links"
      : "no-draft-marker";
    throw new DraftIndexError(
      "draftlist 링크를 못 찾았다 — 빈 배열로 흘리지 않는다(M7)",
      `observed=${observed} / html ${html.length}자`,
      observed,
    );
  }
  return [...slugs].sort();
}
