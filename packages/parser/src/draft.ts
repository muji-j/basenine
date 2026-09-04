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
 * ⚠**`（選択権なし）`·`（選択権利なし）` 는 선수가 아니다**(한 글자 다르다 · 2006 vs 2001).
 * 그대로 넣으면 그 이름의 선수가 생긴다(M11).
 * ⚠**판정은 반드시 NFKC 를 건 뒤의 형태로 한다** — NFKC 가 전각 괄호 `（）` 를 반각 `()` 로
 * 바꾸므로, 정규화한 문자열을 **전각 괄호 패턴으로 검사하면 영원히 안 맞는다.**
 *
 * ⚠**파싱 실패는 빈 값이 아니라 예외다**(M7). 칸이 한 칸 밀리면 「나이」가 포지션 칸에
 * 들어가는데, 그 화면은 그럴듯해서 눈으로는 못 잡는다.
 */

export class DraftParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "DraftParseError";
    this.detail = detail;
  }
}

export type DraftKind = "shihaika" | "ikusei" | "koukousei" | "daigaku_shakaijin";

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
  /** `投手`·`捕手`·`内野手`·`外野手`. ⚠2006 은 `投　手` 라 **공백을 지워야** 2019 와 같아진다. */
  position: string | null;
  fromOrg: string | null;
}

/**
 * 섹션 머리 → 구획.
 * ⚠**순서가 의미를 갖는다.** `育成` 를 먼저 본다 — 「`育成選手選択会議` 가 아래쪽 支配下
 * 패턴 `選択選手` 에 걸리지 않는다」는 **글자를 세어야만** 확인되는 성질이라,
 * 그것에 기대는 순서는 다음 사람이 못 지킨다. 구별되는 낱말을 먼저 둔다.
 */
const SECTION: ReadonlyArray<readonly [RegExp, DraftKind]> = [
  [/育成/, "ikusei"],
  [/高校生/, "koukousei"],
  [/大学生|社会人/, "daigaku_shakaijin"],
  [/新人選手選択会議|選択選手|自由獲得選手|希望入団枠獲得選手/, "shihaika"],
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
 *   회차 라벨이나 연령 칸이 어휘 밖일 때 · 이름 칸이 비었을 때.
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

        rows.push({
          team,
          kind,
          roundNo: roundOf(cells[0]?.text ?? "", where),
          waiverDir: null,
          nameDisplay: nameRaw,
          // ⚠`投　手` → `投手`. 전각 공백을 남기면 2019 의 `投手` 와 **다른 값**이 된다.
          position: positionRaw === "" ? null : compact(positionRaw),
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
