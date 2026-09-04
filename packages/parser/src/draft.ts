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
  // ⚠푸터 아래는 보지 않는다. 마지막 섹션의 본문이 `(?=<h4|$)` 로 **문서 끝까지** 뻗으므로,
  // 언젠가 푸터에 표가 생기면 그 행이 마지막 구획의 지명으로 섞여 들어온다.
  // (실측: 지금은 푸터에 `<table>` 이 0개다 — 그래서 지금 고쳐 두는 편이 싸다.)
  const footer = html.indexOf("<footer");
  const scope = footer === -1 ? html : html.slice(0, footer);

  const sections = [...scope.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]*?)(?=<h4|$)/g)];
  if (sections.length === 0) {
    throw new DraftParseError("섹션(<h4>)이 없다 — 구조가 바뀌었거나 다른 페이지다", `team=${team}`);
  }

  const rows: DraftPickRow[] = [];
  let dataRows = 0;

  for (const [, headingRaw, sectionBody] of sections) {
    const heading = decode(headingRaw ?? "");
    if (heading === "") continue;
    const where = `${team} / ${heading}`;
    const kind = kindOf(heading, where);

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
  }

  // ⚠**「지명이 0건」과 「표를 못 읽었다」는 다르다**(M11). 전 회차를 건너뛴 구단은
  // 실제로 0건이라 빈 배열이 정답이고, 표 자체를 못 읽은 것은 실패다.
  if (dataRows === 0) {
    throw new DraftParseError(
      "표에서 지명 행을 한 건도 못 읽었다 — 빈 배열로 흘리지 않는다(M7)",
      `team=${team} / 섹션 ${sections.length}개`,
    );
  }
  return rows;
}
