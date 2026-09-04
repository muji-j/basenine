/**
 * 드래프트 적재 — npb.jp 경로.
 *
 * ⚠**단독지명은 소스가 말하지 않는다.** npb 주석은 **경합만** 적고, wikipedia 는 **경합만** 칠한다.
 * 그래서 **1순위 지명 중 경합 그룹에 없는 것**을 단독으로 유도한다(`won = NULL`).
 * ⚠**`0`(낙첨)과 `NULL`(단독)을 섞지 마라**(M11) — 「경합에서 이겼다」와 「아무도 안 겹쳤다」는 다른 사실이다.
 *
 * ⚠⚠**`round_no` 의 뜻이 표마다 다르고, 같은 표 안에서도 `kind` 마다 다르다.**
 * 이 파일이 그 셋을 만드는 자리이므로 여기 적어 둔다 — **화면이 이 값을 그냥 「N巡目」로 읽으면 거짓이 된다.**
 *
 * | 어디 | `round_no` 가 뜻하는 것 | 누가 정했나 |
 * |---|---|---|
 * | `draft_pick` · `shihaika`/`koukousei`/`daigaku_shakaijin`/`ikusei` | **지명 회차**(1巡目·2巡目…) | **소스** |
 * | `draft_pick` · `jiyuu_kakutoku`/`kibou_nyudanwaku` | **그냥 순번**. 회차라는 개념이 없는 제도다 | **적재(이 파일)** |
 * | `draft_bid` | **1巡目 안에서 몇 번째 추첨인가**(1回·外れ1位·外れ外れ1位…) | 소스(주석 순서) |
 *
 * ⚠**`draft_pick` 의 두 뜻을 가르는 것은 `kind` 하나뿐이다.** 019 마이그레이션 주석이 경고한 그대로다 —
 * 「`round_no` 가 없는 제도라 **적재가 순번을 매기는 순간 구별할 근거가 사라진다**」.
 * 파서가 `roundNo: null` 을 내는 것이 옳다(M11 · 「원래 없음」). **파서가 0 이나 1 을 채우면
 * 소스에 있던 값과 우리가 매긴 값을 영영 구별할 수 없다.**
 *
 * ⚠**`draft_bid.round_no` 를 지명 회차로 읽지 마라.** 경합은 1巡目에서만 일어나므로
 * (2순위 이후는 웨이버라 추첨이 없다) **어느 추첨에서 이겼든 그 구단이 얻은 것은 1巡目 지명**이다.
 *
 * ⚠**`player_id` 는 넣지 않는다**(M10) — 이름 문자열로 선수를 잇지 않는다. `name_canonical` 이
 * 그 연결의 재료이고, 연결 자체는 별도 태스크다.
 * ⚠**`origin` 은 `'npb'` 고정이다.** wikipedia 를 넣게 되면 **두 번째 적재기를 만들지 말고**
 * `origin`·`license` 를 입력으로 올려라(M1).
 */
import { normalizePlayerName } from "@bb-app/parser";
import type { DraftBidRow, DraftKind, DraftPickRow } from "@bb-app/parser";
import type { Db } from "./db.ts";

export class DraftLoadError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "DraftLoadError";
    this.detail = detail;
  }
}

export interface DraftLoadInput {
  season: number;
  picks: DraftPickRow[];
  bids: DraftBidRow[];
  source: string;
  fetchedAt: string;
  revision: string;
}

export interface DraftLoadResult {
  readonly events: number;
  readonly picks: number;
  readonly bids: number;
  /**
   * 그중 **여집합으로 유도한** 단독지명 행. ⚠**소스가 적어서가 아니라 우리가 유도한 수다** —
   * 로그에 적을 때 「0건」과 「안 유도했음」을 구별할 수 있게 따로 센다.
   */
  readonly soleNominations: number;
}

/**
 * 추첨(경합)이 성립하는 구획.
 *
 * ⚠**목록이지 취향이 아니다.** 근거 셋:
 * ⑴ `jiyuu_kakutoku`·`kibou_nyudanwaku` 는 **회차 자체가 없는 제도**라 1巡目이 존재하지 않는다
 *    (019 마이그레이션 · 파서 머리말).
 * ⑵ `ikusei`(育成)는 회차는 있지만 **추첨이 없다** — 파서의 경합 정규식이 `^[1１](?:巡目|位)` 로
 *    시작해 育成 주석을 아예 안 받는다. 여기에 단독지명 행을 만들면 **일어난 적 없는 추첨에서
 *    「아무도 안 겹쳤다」고 주장**하게 되고, 시즌마다 24행의 비사건이 쌓인다.
 * ⑶ 남는 셋이 곧 「本ドラフト」 구획이다. 2005~2007 은 그게 `koukousei`·`daigaku_shakaijin` 으로
 *    갈라져 있었고 **둘 다 추첨이 있었다**(2006 요미우리 堂上直倫 경합이 高校生 쪽이다 · 픽스처 실측).
 *
 * ⚠**내보내는 이유**: 불변식 시험(`scripts/test/draft-invariants.test.ts`)의 **분모가 이 목록이다**.
 * 시험이 따로 적으면 어휘가 두 벌이 되고, 여기를 고친 날 시험은 **옛 목록으로 조용히 계속 초록**이 된다(M1).
 */
export const LOTTERY_KINDS: ReadonlySet<DraftKind> = new Set<DraftKind>([
  "shihaika",
  "koukousei",
  "daigaku_shakaijin",
]);

/**
 * 키 안에서 칸을 가르는 문자. ⚠**팀 코드·`kind` 에 절대 안 나오는 것**이어야 한다 —
 * 구분자가 값 안에 나올 수 있으면 서로 다른 두 쌍이 같은 키가 된다.
 */
const SEP = "\u0000";

/**
 * 「어느 구획의 어느 구단인가」. ⚠**메모리 안에서 묶을 때만 쓴다** —
 * DB 를 지우는 범위는 이것이 **아니라 구단**이다(`loadDraft` 주석).
 */
function sectionKey(kind: DraftKind, team: string): string {
  return `${kind}${SEP}${team}`;
}

/** 회차가 정해진 지명 한 건. */
interface NumberedPick {
  readonly row: DraftPickRow;
  readonly roundNo: number;
}

/**
 * 회차가 없는 제도(`jiyuu_kakutoku`·`kibou_nyudanwaku`)에 **적재가 1부터 순번을 매긴다.**
 * `round_no` 가 `NOT NULL` PK 라 비워 둘 수 없고, **회차가 없다고 버리면 실재하는 지명이
 * 아무 소리 없이 사라진다**(2001 江尻慎太郎 · 2006 金刃憲人).
 *
 * ⚠**0 이 아니라 1 부터다.** 0 은 「없음」의 센티넬처럼 읽히는데, 여기 들어가는 값은
 * 「없음」이 아니라 **우리가 부여한 순번**이다.
 * ⚠**그 순번이 회차인지 순번인지는 `kind` 만이 안다**(파일 머리말 표).
 *
 * @throws {DraftLoadError} 한 구획 안에 회차 있는 지명과 없는 지명이 섞였을 때 —
 *   그대로 매기면 **우리가 만든 `1` 이 소스의 `1` 과 같은 칼럼에서 부딪쳐** 진짜 1巡目을 덮어쓴다.
 * @throws {DraftLoadError} 추첨이 있는 구획의 회차가 비었을 때 — 순번을 매기면
 *   **일어난 적 없는 1巡目이 생기고**, 그 위에 단독지명까지 유도된다.
 */
function numberRounds(season: number, picks: readonly DraftPickRow[]): NumberedPick[] {
  const sections = new Map<string, number[]>();
  picks.forEach((p, i) => {
    const key = sectionKey(p.kind, p.team);
    const bucket = sections.get(key);
    if (bucket === undefined) sections.set(key, [i]);
    else bucket.push(i);
  });

  const assigned: Array<number | undefined> = new Array<number | undefined>(picks.length);
  for (const idxs of sections.values()) {
    const rows = idxs.map((i) => picks[i]!);
    const head = rows[0]!;
    const withRound = rows.filter((r) => r.roundNo !== null).length;

    if (withRound !== 0 && withRound !== rows.length) {
      throw new DraftLoadError(
        "한 구획에 회차가 있는 지명과 없는 지명이 섞여 있다 — 순번을 매기면 소스의 회차와 부딪친다(M7)",
        `season=${season} kind=${head.kind} team=${head.team} 회차있음=${withRound}/${rows.length}`,
      );
    }

    if (withRound === rows.length) {
      idxs.forEach((i) => {
        assigned[i] = picks[i]!.roundNo!;
      });
      continue;
    }

    if (LOTTERY_KINDS.has(head.kind)) {
      throw new DraftLoadError(
        "추첨이 있는 구획인데 회차가 비어 있다 — 순번을 매기면 없던 1巡目이 생긴다(M7)",
        `season=${season} kind=${head.kind} team=${head.team} 건수=${rows.length}`,
      );
    }

    idxs.forEach((i, n) => {
      assigned[i] = n + 1;
    });
  }

  const numbered = picks.map((row, i) => ({ row, roundNo: assigned[i]! }));

  const seen = new Set<string>();
  for (const p of numbered) {
    const key = `${sectionKey(p.row.kind, p.row.team)}${SEP}${p.roundNo}`;
    if (seen.has(key)) {
      throw new DraftLoadError(
        "같은 구획·구단·회차에 지명이 중복이다 — 조용히 덮어쓰지 않는다(M7)",
        `season=${season} kind=${p.row.kind} team=${p.row.team} round=${p.roundNo} name=${p.row.nameDisplay}`,
      );
    }
    seen.add(key);
  }
  return numbered;
}

/**
 * 그 구단의 **1巡目 지명**. 경합 주석이 가리키는 구획과 (당첨일 때의) 선수 이름이 둘 다 여기서 나온다.
 *
 * ⚠⚠**입찰 회차(`DraftBidRow.roundNo`)로 지명을 찾지 마라.** 그건 「1巡目 안에서 몇 번째
 * 추첨인가」이지 「몇 순위 지명인가」가 아니다. 2019 세이부는 **2번째 추첨**에서 이겼지만
 * 얻은 것은 **1巡目 宮川 哲**이다 — 입찰 회차로 찾으면 그 구단의 **2순위 선수**를 당첨자로 적는다.
 * 값도 합계도 그럴듯해서 눈으로는 못 잡는다.
 *
 * ⚠**구획을 `shihaika` 로 박지 마라.** 2005~2007 은 本ドラフト가 `koukousei` 와
 * `daigaku_shakaijin` 으로 갈라져 있었다 — 2006 요미우리는 `shihaika` 지명이 **0건**이고
 * 堂上直倫 경합은 **高校生 1巡目**이다(픽스처 실측).
 *
 * @throws {DraftLoadError} 후보가 0개이거나 2개 이상일 때. ⚠**말없이 한쪽을 고르면 경합이
 *   조용히 다른 드래프트에 붙는다.** 2005~2007 에 希望入団枠 을 안 쓴 구단은 두 구획 모두
 *   1巡目을 가질 수 있고, 그때 주석 어느 쪽이 어느 구획인지는 **파서가 지금 말해 주지 않는다**
 *   (`※` 만으로 잘라 섹션 정보를 잃는다). **그 해가 들어오면 이 예외가 먼저 터진다 —
 *   그게 조용히 틀린 값보다 낫다.**
 */
function firstRoundPick(season: number, team: string, numbered: readonly NumberedPick[]): NumberedPick {
  const found = numbered.filter(
    (p) => p.row.team === team && p.roundNo === 1 && LOTTERY_KINDS.has(p.row.kind),
  );
  const kinds = new Set(found.map((p) => p.row.kind));
  const only = found[0];
  if (kinds.size === 1 && only !== undefined) return only;

  throw new DraftLoadError(
    kinds.size === 0
      ? "1순위 경합 주석이 있는데 추첨이 있는 구획의 1巡目 지명이 없다 — 어느 구획의 경합인지 정할 근거가 없다(M7)"
      : "이 구단의 1巡目 지명이 둘 이상의 구획에 있다 — 어느 구획의 경합인지 적재가 정하지 않는다(M7)",
    `season=${season} team=${team} 후보구획=${kinds.size === 0 ? "없음" : [...kinds].join(",")}`,
  );
}

/**
 * `won` 을 DB 의 3값으로 옮긴다.
 *
 * ⚠**`won ? 1 : 0` 으로 접지 마라.** 이 칼럼은 **당첨 1 · 낙첨 0 · 단독 NULL 의 3값**인데
 * truthy 연산자는 그것을 2값으로 접는다 — `"確定"` 도 `"外れる"` 도 둘 다 truthy 라
 * **조용히 전원 당첨**이 되고, 빈 문자열·`undefined` 는 **조용히 낙첨**이 된다.
 * 타입은 `boolean` 이지만 타입이 지키는 것은 컴파일 시점뿐이고, 이 값은 **HTML 에서 온다.**
 */
function wonToInt(won: boolean, season: number, team: string, roundNo: number): 0 | 1 {
  if (won !== true && won !== false) {
    throw new DraftLoadError(
      "won 이 boolean 이 아니다 — truthy 로 접으면 3값(당첨1·낙첨0·단독NULL)이 2값이 된다(M11)",
      `season=${season} team=${team} round=${roundNo} won=${JSON.stringify(won as unknown)}`,
    );
  }
  return won ? 1 : 0;
}

/** DB 에 넣을 입찰 한 행. */
interface ResolvedBid {
  readonly kind: DraftKind;
  readonly team: string;
  readonly roundNo: number;
  readonly groupKey: string | null;
  readonly won: 0 | 1 | null;
  readonly nameDisplay: string;
  readonly nameCanonical: string;
}

/**
 * 주석에서 온 입찰.
 *
 * ⚠**`group_key` 는 표시 이름이 아니라 정규화한 이름으로 만든다**(M10).
 * **가정이 아니라 실측이다**(2026-09-05 · 픽스처 4장): 지명 표의 이름은 **40건 중 40건이
 * 공백을 갖고**(`堀田 賢慎`), 경합 주석의 이름은 **3건 중 0건이 갖는다**(`奥川恭伸`).
 * 당첨 쪽 이름은 표에서, 낙첨 쪽 이름은 주석에서 오므로 **표시 이름으로 묶으면 같은 경합이
 * 반드시 두 그룹으로 갈린다.** 갈리면 단독 유도(여집합)까지 틀린다 — 갈라진 쪽이
 * 「경합에 없는 구단」으로 세어지지 않기 때문이다.
 * ⚠**주석 쪽 분모가 3건뿐이다**(픽스처 4장에 경합이 그만큼 있다). 방향은 명확하지만
 * **「전 시즌에서 그렇다」는 안 쟀다.**
 * ⚠**정규화 규칙은 `normalizePlayerName` 한 벌이다**(M1 · `parser/src/stats.ts`).
 * 여기서 새로 만들면 이름 규칙이 두 벌이 되고, 두 표를 나란히 놓은 사람만 그 차이를 본다.
 * ⚠**그것이 다 흡수한다고 쓰지 마라** — 흡수하는 것은 **공백과 좌우 마커**뿐이다.
 * `山﨑`(U+FA11)와 `山崎`(U+5D0E) 는 NFC·NFKC·NFD·이 함수 **넷 다 못 붙인다**(실측) —
 * 규칙 문서가 실측해 둔 이체자 불일치 1건이 정확히 그 모양이다. **소스 간 이체자는 여기서 안 풀린다.**
 * ⚠**남은 것을 조용히 합치지 마라** — 갈린 그룹은 「won=0 만 있고 이긴 구단이 없는 group_key」로
 * **드러난다.** 그걸 붉게 만드는 것은 불변식 시험(INV)의 몫이다.
 */
function resolveBids(
  season: number,
  bids: readonly DraftBidRow[],
  numbered: readonly NumberedPick[],
): ResolvedBid[] {
  const out = bids.map((b) => {
    const first = firstRoundPick(season, b.team, numbered);
    // ⚠당첨 주석은 이름을 생략한다 — 결측이 아니라 「소스가 안 쓴다」(M11).
    //   그 자리를 채우는 것은 **입찰 회차의 지명이 아니라 1巡目 지명**이다(위 함수 주석).
    const nameDisplay = b.nameDisplay ?? first.row.nameDisplay;
    const nameCanonical = normalizePlayerName(nameDisplay);
    return {
      kind: first.row.kind,
      team: b.team,
      roundNo: b.roundNo,
      groupKey: `${b.roundNo}:${nameCanonical}`,
      won: wonToInt(b.won, season, b.team, b.roundNo),
      nameDisplay,
      nameCanonical,
    } satisfies ResolvedBid;
  });

  const seen = new Set<string>();
  for (const b of out) {
    const key = `${sectionKey(b.kind, b.team)}${SEP}${b.roundNo}`;
    if (seen.has(key)) {
      throw new DraftLoadError(
        "같은 구획·구단·추첨회차에 입찰이 중복이다 — 조용히 덮어쓰지 않는다(M7)",
        `season=${season} kind=${b.kind} team=${b.team} round=${b.roundNo}`,
      );
    }
    seen.add(key);
  }
  return out;
}

/**
 * **단독지명을 여집합으로 유도한다.**
 *
 * ⚠**「경합 주석이 있는 구단은 건너뛴다」로 유도하면 틀린다.** 2019 요미우리 실물이 그 반례다 —
 * 주석은 **낙첨 2건뿐**이고(奥川·宮川), 실제로 얻은 **堀田 賢慎 은 어디에도 안 적힌다.**
 * 겹친 적이 없으니 주석이 없는 것이고, 그게 바로 **단독지명의 정의**다.
 * 건너뛰면 그 구단의 1巡目 획득이 통째로 사라지고, 화면에는 **에러가 아니라 빈 칸**이 남는다.
 *
 * → 기준은 **「그 구단이 이긴 입찰이 있는가」**다. 없으면 마지막 낙첨 **다음 회차**에서
 * 단독으로 얻은 것이다(주석이 0건이면 첫 회차). 그래서 `round_no = max(낙첨 회차) + 1` 이고,
 * 이 값은 **실제로 그 추첨 회차**다 — 요미우리 2019 는 3(外れ外れ1位).
 * ⚠**기존 행과 부딪히지 않는다** — 언제나 그 구단의 최대 회차보다 크다.
 */
function deriveSoleNominations(
  numbered: readonly NumberedPick[],
  resolved: readonly ResolvedBid[],
): ResolvedBid[] {
  const wonSection = new Set<string>();
  const maxRound = new Map<string, number>();
  for (const b of resolved) {
    const key = sectionKey(b.kind, b.team);
    if (b.won === 1) wonSection.add(key);
    maxRound.set(key, Math.max(maxRound.get(key) ?? 0, b.roundNo));
  }

  const out: ResolvedBid[] = [];
  for (const p of numbered) {
    if (!LOTTERY_KINDS.has(p.row.kind)) continue;
    if (p.roundNo !== 1) continue;
    const key = sectionKey(p.row.kind, p.row.team);
    if (wonSection.has(key)) continue;
    out.push({
      kind: p.row.kind,
      team: p.row.team,
      roundNo: (maxRound.get(key) ?? 0) + 1,
      // ⚠어느 경합 그룹에도 안 속한다. 그것이 곧 「단독」의 뜻이다.
      groupKey: null,
      won: null,
      nameDisplay: p.row.nameDisplay,
      nameCanonical: normalizePlayerName(p.row.nameDisplay),
    });
  }
  return out;
}

/** 지우고 다시 넣을 대상 구단. ⚠**구획이 아니라 구단이다** — `loadDraft` 주석의 근거를 봐라. */
function teamsOf(items: ReadonlyArray<{ team: string }>): string[] {
  return [...new Set(items.map((it) => it.team))];
}

/**
 * 한 시즌(또는 한 구단)의 드래프트를 넣는다.
 *
 * ⚠⚠**입력 단위 계약: 한 호출은 「한 구단의 전부」를 담아야 한다.**
 * 구단 여럿을 한 번에 넣는 것은 괜찮다. **한 구단을 여러 번에 나눠 넣으면 안 된다** —
 * 아래 삭제가 구단 단위라 **먼저 넣은 구획을 뒤 호출이 지운다.**
 * 이 계약은 소스의 생김새와 일치한다(실측 · 픽스처 4장): `draftlist_{team}.html` 한 장이
 * **한 구단**을 내고(4장 중 4장) 그 한 장이 **그 구단의 모든 구획**을 담는다
 * (4장 중 4장이 2종 이상 · 2006 요미우리는 **4종**). 파서에 구획 단위 입구가 아예 없다.
 *
 * ⚠**멱등하다**(M5). 「덮어쓰기」가 아니라 **구단 단위로 지우고 다시 넣는다** — 그래야
 * **정정으로 줄어든 판**도 반영된다. `ON CONFLICT DO UPDATE` 만 쓰면 사라진 지명이 그대로 남고,
 * 행 수만 세는 검사는 **초록인 채로** 지나간다.
 *
 * ⚠⚠**삭제 범위가 「구획·구단」이 아니라 「구단」인 것이 요점이다.** 처음엔 구획·구단으로 잡았는데
 * **그러면 이번 입력에 없는 구획은 손도 안 댄다** — `kind` 가 바뀌는 정정에서 **옛 구획의 행이
 * 영구 고아로 남고, 화면에는 같은 선수가 두 구획에 동시에 지명된 것처럼 보인다.**
 * ⚠**가상 시나리오가 아니라 이 브랜치의 이력이다**: 019 주석이 적듯 초판 파서는
 * `自由獲得選手`·`希望入団枠獲得選手` 를 `shihaika` 로 접었고 나중에 별도 구획으로 갈랐다.
 * ⚠**뮤테이션으로는 안 잡히는 종류다 — 「코드에 있는 조건」이 아니라 「없는 조건」이었다.**
 * 지금은 시험 2본(지명·입찰)이 각각 고정한다.
 *
 * ⚠**입력에 없는 구단은 건드리지 않는다** — 그 구단은 이번에 안 온 것이지 사라진 것이 아니다.
 *
 * ⚠⚠**구단 단위 삭제는 「입력이 그 구단의 전부」를 전제로 서 있다. 그 전제를 지키는 것은
 * 여기가 아니라 파서다.** 부분 파싱 실패(한 구획만 구조가 깨져 조용히 빠지는 것)가 여기까지
 * 오면 **그 구획의 실데이터가 지워진다** — 조용한 오답이 아니라 **조용한 소실**이다.
 * 그래서 `parser/src/draft.ts` 가 **섹션마다** 「지명 행 0건」을 던진다(전역 카운터가 아니다).
 * ⚠**이쪽에서 막으려 하지 마라** — 「DB 에 있던 구획이 사라지면 던진다」로 하면 **정당한
 * 구획 재분류 정정까지 막힌다**(바로 위 문단이 고친 그것이다). 두 문제는 뿌리가 달라
 * 같은 자리에서 못 푼다.
 *
 * ⚠**`draft_event` 는 지우지 않고 upsert 한다.** 그 표의 키는 `(season, kind)` 라 구단이 없어서
 * 구단 단위 호출로는 「이 구획이 시즌에서 사라졌는가」를 알 수 없다. **어느 지명도 가리키지 않는
 * 구획 행이 남을 수 있고, 그건 알면서 남긴 것이다**(출처만 든 빈 행이라 값을 왜곡하지 않는다).
 *
 * ⚠**부분 실패는 없다.** 판정은 트랜잭션 **밖**에서 끝내고(걸리면 SQL 을 안 만진다) 쓰기는
 * 한 트랜잭션이라 도중에 던지면 **아무것도 남지 않는다** — 반쯤 적재된 시즌이 「원래 그렇다」로
 * 읽히는 것이 이 도메인에서 가장 비싼 실패다.
 */
export function loadDraft(db: Db, input: DraftLoadInput): DraftLoadResult {
  const { season, source, fetchedAt, revision } = input;

  // ⚠SQL 을 만지기 전에 전부 판정한다 — 던질 것은 트랜잭션 밖에서 던지는 편이 읽기 쉽다.
  const numbered = numberRounds(season, input.picks);
  const resolved = resolveBids(season, input.bids, numbered);
  const soles = deriveSoleNominations(numbered, resolved);
  const allBids = [...resolved, ...soles];

  // ⚠**구단 단위다**(위 주석). `allBids` 를 합치는 것은 형식뿐이다 — 입찰이 있는 구단은
  //   반드시 1巡目 지명이 있어서(`firstRoundPick` 이 없으면 던진다) 이미 `numbered` 에 있다.
  const teams = teamsOf([...numbered.map((p) => p.row), ...allBids]);
  const kinds = new Set(numbered.map((p) => p.row.kind));

  db.transaction(() => {
    const ev = db.raw.prepare(
      `INSERT INTO draft_event (season, kind, held_on, source, fetched_at, revision)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(season, kind) DO UPDATE SET
         source = excluded.source, fetched_at = excluded.fetched_at, revision = excluded.revision`,
    );
    for (const kind of kinds) ev.run(season, kind, source, fetchedAt, revision);

    const delPick = db.raw.prepare("DELETE FROM draft_pick WHERE season = ? AND team = ?");
    for (const team of teams) delPick.run(season, team);

    const insPick = db.raw.prepare(
      `INSERT INTO draft_pick
         (season, kind, team, round_no, pick_seq, waiver_dir, name_display, name_canonical,
          position, from_org, origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'npb', NULL, ?, ?, ?)`,
    );
    for (const p of numbered) {
      insPick.run(
        season,
        p.row.kind,
        p.row.team,
        p.roundNo,
        p.row.waiverDir,
        p.row.nameDisplay,
        normalizePlayerName(p.row.nameDisplay),
        p.row.position,
        p.row.fromOrg,
        source,
        fetchedAt,
        revision,
      );
    }

    const delBid = db.raw.prepare("DELETE FROM draft_bid WHERE season = ? AND team = ?");
    for (const team of teams) delBid.run(season, team);

    const insBid = db.raw.prepare(
      `INSERT INTO draft_bid
         (season, kind, round_no, team, group_key, won, name_display, name_canonical,
          origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'npb', NULL, ?, ?, ?)`,
    );
    for (const b of allBids) {
      insBid.run(
        season,
        b.kind,
        b.roundNo,
        b.team,
        b.groupKey,
        b.won,
        b.nameDisplay,
        b.nameCanonical,
        source,
        fetchedAt,
        revision,
      );
    }
  });

  return {
    events: kinds.size,
    picks: numbered.length,
    bids: allBids.length,
    soleNominations: soles.length,
  };
}
