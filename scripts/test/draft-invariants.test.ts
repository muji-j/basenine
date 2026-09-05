/**
 * 드래프트 불변식 — 규칙 문서(`docs/sources/2026-09-04-draft-wikipedia-markup-rules.md` §5)의
 * **INV-4·INV-5**, 그리고 npb 단독 파이프라인에서만 생기는 **INV-N1·INV-N2·INV-N3**.
 *
 * ⚠**이 시험이 이 기능의 안전망이다.** 파싱이 조용히 틀리면 화면은 그럴듯하고
 * 합계도 맞아서 **눈으로는 못 잡는다.**
 *
 * ## ⚠「위반 0건」과 「검사 대상 0건」은 다르다
 *
 * 불변식 시험은 **데이터가 없으면 무조건 초록**이다 — 이 저장소에서 실제로
 * 「아무것도 안 재는 시험」이 나왔다(Task 6 · 판정이 전부 트랜잭션 밖이라 무조건 통과).
 * 그래서 **모든 검사가 분모(`checked`)를 함께 낸다.** `assertClean` 은
 * **분모가 0 이면 그 자체를 실패로 만든다.** 그것을 다시 시험으로 고정한 것이
 * 맨 아래 「빈 DB」 본이다.
 *
 * ## ⚠이 불변식들은 「한 시즌이 다 들어온 뒤」에 성립한다
 *
 * 적재는 **구단 단위**다(`loadDraft` 계약). 한 구단만 넣은 중간 상태에서는
 * 경합 그룹에 승자가 없는 것이 정상이다 — 이긴 구단이 아직 안 들어왔을 뿐이다.
 * **여기 있는 검사는 시즌을 다 넣은 뒤에 돌린다.** 수집기가 생기면 그 자리는
 * 「한 시즌의 마지막 구단을 넣은 직후」다.
 *
 * ## ⚠아직 실데이터에 안 돌린다
 *
 * 수집기가 없어 `data/bb.sqlite` 의 드래프트 4표가 **전부 0행**이다(2026-09-05 실측 ·
 * `draft_event`·`draft_pick`·`draft_bid`·`draft_note` 넷 다). 여기 검사는
 * 지금은 **합성 데이터에만** 걸린다. 백필이 시작되면 같은 SQL 을 실 DB 에 돌리는
 * 자리가 필요하다 — **그때 이 파일에서 검사기를 꺼내 모듈로 올려라.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftBidRow, DraftKind, DraftPickRow } from "@bb-app/parser";
import { normalizePlayerName } from "@bb-app/parser";
import type { Db } from "@bb-app/store";
import { LOTTERY_KINDS, loadDraft, openDb } from "@bb-app/store";

/** ⚠**출처는 두 벌이다** — 구단 페이지와 연도 톱은 입도가 다르다([I3] · `store/src/draft.ts`). */
const PAGE = {
  source: "https://npb.jp/draft/2019/draftlist_x.html",
  fetchedAt: "2026-09-05T01:00:00Z",
  revision: "sha256:page",
};
const EVENT = {
  source: "https://npb.jp/draft/2019/",
  fetchedAt: "2026-09-05T00:00:00Z",
  revision: "sha256:event",
};
const META = { page: PAGE, event: EVENT };

async function withDb(fn: (db: Db) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-draft-inv-"));
  const db = openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function pick(team: string, kind: DraftKind, roundNo: number | null, nameDisplay: string): DraftPickRow {
  return { team, kind, roundNo, waiverDir: null, nameDisplay, position: null, fromOrg: null };
}

function bid(team: string, roundNo: number, rivals: string[], nameDisplay: string | null, won: boolean): DraftBidRow {
  return { team, roundNo, rivals, nameDisplay, won };
}

/* ⚠**이 파일의 모든 적재가 `bids: [...]`·`bids: []` 를 쓰고 그건 주장이다**([N1]).
 * `[]` 는 「**소스가 경합을 말하고**, 이 구단은 안 겹쳤다」이지 「소스가 안 쓴다」가 아니다.
 * 여기 데이터는 2006·2019 — **npb 가 실제로 주석을 쓰던 해**라 그 주장이 참이다.
 * ⚠**2023 이후를 이 파일에 넣을 때는 `bids: null` 이어야 한다.** `[]` 로 넣으면
 * 12구단 전원이 単独指名이 되고, **아래 여섯 검사 중 어느 것도 그것을 못 잡는다**
 * (INV-N3 는 경합 그룹이 0개라 분모 0 이다). */

// =========================================================================
// 검사기 — 전부 `{ checked, violations }` 를 낸다
// =========================================================================

interface CheckResult {
  /** 불변식 이름. 실패 메시지에 그대로 실린다. */
  readonly name: string;
  /** ⚠**분모의 뜻.** 「5건 중 0건 위반」이 무엇을 센 5건인지 말하지 않으면 아무 뜻이 없다(M2). */
  readonly unit: string;
  /** 실제로 검사한 대상 수. ⚠**0 이면 그 자체가 실패다** — `assertClean` 이 막는다. */
  readonly checked: number;
  /** 위반 한 줄씩. 개수만이 아니라 **실례**를 담는다(「일부 불일치」 금지). */
  readonly violations: string[];
}

/**
 * ⚠**검사 대상이 0건이면 통과가 아니라 실패다.**
 * 빈 DB 에서 초록인 불변식은 아무것도 안 지킨다 — 그것이 이 함수의 존재 이유다.
 */
function assertClean(r: CheckResult): void {
  assert.ok(
    r.checked > 0,
    `⚠${r.name}: 검사 대상이 ${r.checked}건이다 — 「위반 0건」이 아니라 「아무것도 안 쟀다」(${r.unit})`,
  );
  assert.deepEqual(
    r.violations,
    [],
    `⚠${r.name}: ${r.unit} ${r.checked}건 중 위반 ${r.violations.length}건\n${r.violations.join("\n")}`,
  );
}

const LOTTERY = [...LOTTERY_KINDS];
const LOTTERY_PH = LOTTERY.map(() => "?").join(", ");

/**
 * **INV-4** — 추첨이 있는 구획의 1巡目 지명 슬롯마다 **확정된 획득이 정확히 1건**이고,
 * 그 획득 행의 선수가 **그 구단의 1巡目 지명과 같다.**
 *
 * ⚠**브리프의 SQL 은 이것을 재지 않는다.** 브리프안은
 * `draft_pick` 을 `(team)` 으로 묶어 `COUNT(*) = 1` 을 보는데, 그 표의 PK 가
 * `(season, kind, team, round_no)` 라 **그 값은 언제나 1 이다** — SQLite 가 이미 보장하는 것을
 * 다시 물어 **어떤 파싱 오류로도 붉어질 수 없다.** 규칙 문서 §5 가 말하는 「확정된 1순위 지명」은
 * 그리드에서 **굵게 칠해진 획득 칸**이고, npb 쪽에서 그 자리는 `draft_pick` 이 아니라
 * **`draft_bid` 의 획득 행**(`won = 1` 당첨 · `won IS NULL` 단독)이다. 그래서 그쪽을 잰다.
 *
 * 잡는 것 셋:
 * ⑴ **획득이 0건** — 「경합 주석이 있는 구단은 건너뛴다」로 단독지명을 유도하면 그 구단의
 *    1巡目 획득이 통째로 사라진다. **에러가 아니라 빈 칸이 남는다.**
 * ⑵ **획득이 2건** — `外れる`(낙첨)를 `確定`(당첨)으로 읽으면 그 구단이 1순위를 두 번 얻는다.
 * ⑶ **획득 이름이 1巡目 지명과 다르다** — 입찰 회차를 지명 회차로 읽으면 **그 구단의
 *    2순위 선수**가 당첨자로 적힌다(2019 세이부가 그 모양이다 · `draft.ts` 주석).
 *
 * ⚠**분모를 `draft_bid` 에서 뽑지 않는다.** 획득 행이 통째로 사라진 구단은 입찰 행이
 * 0건이 되어 **분모에서도 같이 사라진다** — 그러면 ⑴을 영영 못 본다.
 */
function inv4Acquisitions(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT p.season AS season, p.kind AS kind, p.team AS team,
              p.name_canonical AS pick_name,
              COUNT(b.team) AS acquisitions,
              GROUP_CONCAT(b.name_canonical) AS acq_names,
              GROUP_CONCAT(b.round_no) AS acq_rounds
         FROM draft_pick p
         LEFT JOIN draft_bid b
           ON b.season = p.season AND b.kind = p.kind AND b.team = p.team
          AND (b.won = 1 OR b.won IS NULL)
        WHERE p.round_no = 1 AND p.kind IN (${LOTTERY_PH})
        GROUP BY p.season, p.kind, p.team
        ORDER BY p.season, p.kind, p.team`,
    )
    .all(...LOTTERY) as unknown as Array<{
    season: number;
    kind: string;
    team: string;
    pick_name: string | null;
    acquisitions: number;
    acq_names: string | null;
    acq_rounds: string | null;
  }>;

  const violations: string[] = [];
  for (const r of rows) {
    const at = `${r.season} ${r.kind}/${r.team} 1巡目=${r.pick_name ?? "(name_canonical 없음)"}`;
    if (r.acquisitions !== 1) {
      violations.push(
        `${at}: 확정된 획득이 ${r.acquisitions}건이다(회차 ${r.acq_rounds ?? "없음"} · 이름 ${r.acq_names ?? "없음"})`,
      );
      continue;
    }
    if (r.acq_names !== r.pick_name) {
      violations.push(`${at}: 획득 행의 선수가 ${r.acq_names ?? "(없음)"} 이라 1巡目 지명과 다르다`);
    }
  }
  return {
    name: "INV-4 (구획×구단마다 확정된 1순위 획득이 정확히 1건)",
    unit: "추첨 구획의 1巡目 지명 슬롯",
    checked: rows.length,
    violations,
  };
}

/**
 * **INV-4′** — 입찰이 있는 `(season, kind, team)` 에는 **그 구획의 1巡目 지명이 실재한다.**
 *
 * ⚠**INV-4 의 반대 방향이다.** INV-4 는 지명에서 출발해 획득을 세고, 이쪽은 입찰에서 출발해
 * 지명을 찾는다. 지명 쪽이 사라진 입찰은 **아무 데도 안 걸리는 고아**가 된다 —
 * 화면에는 「이 구단이 경합했다」만 남고 무엇을 얻었는지가 없다.
 */
function inv4BidsPointAtPick(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT b.season AS season, b.kind AS kind, b.team AS team,
              EXISTS (SELECT 1 FROM draft_pick p
                       WHERE p.season = b.season AND p.kind = b.kind
                         AND p.team = b.team AND p.round_no = 1) AS has_pick
         FROM draft_bid b
        GROUP BY b.season, b.kind, b.team
        ORDER BY b.season, b.kind, b.team`,
    )
    .all() as unknown as Array<{ season: number; kind: string; team: string; has_pick: number }>;

  const violations = rows
    .filter((r) => r.has_pick !== 1)
    .map((r) => `${r.season} ${r.kind}/${r.team}: 입찰이 있는데 그 구획의 1巡目 지명이 없다`);

  return {
    name: "INV-4′ (입찰이 가리키는 1巡目 지명이 실재한다)",
    unit: "입찰이 있는 (구획, 구단)",
    checked: rows.length,
    violations,
  };
}

/**
 * **INV-5** — 같은 `(season, kind, round_no, team)` 에 입찰이 하나뿐이다.
 *
 * ⚠**정직하게 적는다: 오늘 이 검사는 PK 가 이미 보장한다.** `draft_bid` 의 PK 가 정확히
 * 이 네 칼럼이라 **지금 이것만으로는 아무것도 못 잡는다.** 남겨 두는 이유는 하나 —
 * **스키마에서 PK 가 느슨해지는 날의 덫**이다(`018-player-season-name.sql` 이 다루는 사고가
 * 정확히 「유일성이 안 걸려 재수집이 중복 행을 쌓는」 모양이다).
 * ⚠**INV-5 의 실질은 멱등**이고 그건 아래 INV-5 본이 `snapshot()` 두 벌을 비교해서 잰다.
 */
function inv5NoDuplicateBids(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT season, kind, round_no, team, COUNT(*) AS n
         FROM draft_bid
        GROUP BY season, kind, round_no, team
        ORDER BY season, kind, round_no, team`,
    )
    .all() as unknown as Array<{ season: number; kind: string; round_no: number; team: string; n: number }>;

  const violations = rows
    .filter((r) => r.n !== 1)
    .map((r) => `${r.season} ${r.kind}/${r.team} 추첨 ${r.round_no}회: 입찰이 ${r.n}건이다`);

  return {
    name: "INV-5 (한 추첨 회차에 한 구단의 입찰은 하나)",
    unit: "(시즌, 구획, 추첨회차, 구단)",
    checked: rows.length,
    violations,
  };
}

/** 두 표 전체를 **행 단위 문자열**로 굳힌다 — 멱등 비교의 재료. */
function snapshot(db: Db): string[] {
  const picks = db.raw
    .prepare(
      `SELECT season, kind, team, round_no, pick_seq, waiver_dir, name_display, name_canonical,
              position, from_org, origin, player_id, source, fetched_at, revision
         FROM draft_pick ORDER BY season, kind, team, round_no`,
    )
    .all() as unknown as Array<Record<string, unknown>>;
  const bids = db.raw
    .prepare(
      `SELECT season, kind, round_no, team, group_key, won, name_display, name_canonical,
              rivals, origin, player_id, source, fetched_at, revision
         FROM draft_bid ORDER BY season, kind, round_no, team`,
    )
    .all() as unknown as Array<Record<string, unknown>>;
  return [
    ...picks.map((r) => `pick ${JSON.stringify(r)}`),
    ...bids.map((r) => `bid  ${JSON.stringify(r)}`),
  ];
}

/**
 * **INV-N1** — `won = 0` 만 있고 **이긴 구단이 없는 `group_key`** 가 0건.
 *
 * ⚠**이름 정규화가 실패해 경합 그룹이 갈린 것을 잡는다.** 갈리면 단독지명 유도(여집합)까지
 * 틀린다 — 갈라진 쪽이 「경합에 없는 구단」으로 세어지지 않기 때문이다.
 * ⚠**가정이 아니라 실측된 위험이다**: 규칙 문서가 끝까지 안 붙는 이체자 **1건**을 실측했고
 * (`山﨑真彰` / `山崎真彰`), `NFC`·`NFKC`·`NFD`·`normalizePlayerName` **넷 다** 그 둘을 못 붙인다.
 *
 * ⚠**「승자만 있고 낙첨이 없는 그룹」은 안 센다.** 그건 낙첨 쪽 키가 갈린 경우인데,
 * 갈린 낙첨들은 **각자 「승자 없는 그룹」을 이루므로 이 검사에 이미 걸린다.** 두 번 세면
 * 분모만 흐려지고, `rivals` 를 DB 에 안 담으므로 「몇 명이 겹쳤는가」는 애초에 대조할 수 없다.
 *
 * ⚠**묶는 단위가 `(season, group_key)` 이고 `kind` 를 안 넣는다.** `group_key` 가 이미
 * `회차:정규화이름` 이라 경합의 신원을 담고 있고, `kind` 를 넣으면 **2005~2007 의 구획 판정이
 * 흔들릴 때 한 경합이 두 그룹으로 쪼개져 거짓 위반이 난다.**
 */
function invN1GroupsHaveWinner(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT season, group_key,
              COUNT(*) AS n,
              SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS winners,
              GROUP_CONCAT(team) AS teams,
              GROUP_CONCAT(kind) AS kinds
         FROM draft_bid
        WHERE group_key IS NOT NULL
        GROUP BY season, group_key
        ORDER BY season, group_key`,
    )
    .all() as unknown as Array<{
    season: number;
    group_key: string;
    n: number;
    winners: number;
    teams: string;
    kinds: string;
  }>;

  const violations: string[] = [];
  for (const r of rows) {
    if (r.winners === 1) continue;
    const why =
      r.winners === 0
        ? "이긴 구단이 없다 — 이름이 갈려 경합 그룹이 쪼개졌을 수 있다"
        : `이긴 구단이 ${r.winners}개다 — 낙첨을 당첨으로 읽었을 수 있다`;
    violations.push(
      `${r.season} group_key=${r.group_key} (입찰 ${r.n}건 · 구단 ${r.teams} · 구획 ${r.kinds}): ${why}`,
    );
  }
  return {
    name: "INV-N1 (경합 그룹마다 이긴 구단이 정확히 1개)",
    unit: "경합 그룹(group_key)",
    checked: rows.length,
    violations,
  };
}

/**
 * **INV-N2** — 한 `(season, team, name_canonical)` 이 **두 `kind` 에 동시에 있지 않다.**
 *
 * ⚠**`kind` 가 바뀌는 정정에서 옛 행이 고아로 남는 것을 잡는다.** 화면에는
 * **같은 선수가 두 구획에 지명된 것처럼** 보인다. ⚠**이 브랜치에서 실제로 일어난 이력이다**
 * (초판 파서가 `自由獲得選手`·`希望入団枠獲得選手` 를 `shihaika` 로 접었다가 나중에 갈랐다).
 * ⚠**Task 6 이 그 경로 하나를 막은 뒤에도 남긴다** — 고침은 아는 경로를 막고,
 * 불변식은 **아직 모르는 경로**를 막는다. 둘은 대체 관계가 아니다.
 *
 * ⚠**두 표를 합쳐서 본다.** 지명만 보면 「지명은 옮겨졌는데 입찰이 옛 구획에 남은」 모양을
 * 놓치고, 입찰만 보면 그 반대를 놓친다.
 *
 * ⚠**동명이인이면 거짓 위반이 난다**(M10 이 경고하는 그 축이다). 같은 시즌·같은 구단이
 * 같은 정규화 이름을 **다른 구획에서** 둘 뽑아야 하므로 실제로 나올 확률은 낮지만,
 * **나오면 이 검사가 틀린 것이다** — 그때는 `player_id` 로 옮겨야지 검사를 지우지 마라.
 */
function invN2OneKindPerPlayer(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT season, team, name_canonical, COUNT(*) AS kinds, GROUP_CONCAT(kind) AS ks
         FROM (SELECT season, team, name_canonical, kind FROM draft_pick WHERE name_canonical IS NOT NULL
               UNION
               SELECT season, team, name_canonical, kind FROM draft_bid  WHERE name_canonical IS NOT NULL)
        GROUP BY season, team, name_canonical
        ORDER BY season, team, name_canonical`,
    )
    .all() as unknown as Array<{
    season: number;
    team: string;
    name_canonical: string;
    kinds: number;
    ks: string;
  }>;

  const violations = rows
    .filter((r) => r.kinds > 1)
    .map(
      (r) =>
        `${r.season} ${r.team} ${r.name_canonical}: 구획 ${r.kinds}종에 동시에 있다(${r.ks.split(",").sort().join(", ")})`,
    );

  return {
    name: "INV-N2 (한 선수가 한 시즌·한 구단에서 두 구획에 있지 않다)",
    unit: "(시즌, 구단, 정규화 이름)",
    checked: rows.length,
    violations,
  };
}

/**
 * **INV-N3** — 주석이 **선언한 경합 규모**와 **실제 그룹 멤버 수**가 맞는다.
 *
 * ⚠⚠**이것이 「단독지명이라는 거짓 사실」을 잡는 유일한 검사다**(2026-09-05 최종 검토 [I1]).
 * 단독지명은 **여집합으로 유도**하므로, 경합 주석 하나가 조용히 안 읽히면 그 구단의 1巡目이
 * 「아무도 안 겹쳤다」로 둔갑한다. 그때 **다른 넷은 전부 초록**이다:
 *   · INV-4  — 그 구단은 획득 행을 정확히 1건 갖는다(단독으로 유도됐으니까)
 *   · INV-4′ — 입찰이 가리키는 1巡目 지명은 실재한다
 *   · INV-5  — 중복이 없다
 *   · INV-N1 — 남은 그룹에도 이긴 구단이 정확히 1개 있다
 * **모순이 드러나는 자리는 「몇 구단이 겹쳤어야 하는가」 하나뿐이고**, 그 답은
 * 주석이 스스로 적어 둔 상대 목록(`draft_bid.rivals`)에 있다.
 *
 * 두 가지를 본다:
 * ⑴ **선언한 규모 ≠ 실제 멤버 수** — 한 구단의 주석이 통째로 안 읽힌 모양.
 * ⑵ **멤버끼리 선언이 어긋난다** — 어느 한 장의 주석만 어휘가 바뀌어 상대가 덜 읽힌 모양.
 *
 * ⚠**`rivals` 가 `NULL` 인 행은 「안 쟀다」이지 위반이 아니다**(M11). 유도한 단독지명은
 * 애초에 `group_key` 가 없어 여기 안 들어오고, 언젠가 상대 이름을 안 적는 소스가 오면
 * 그 행은 **분모 밖**으로 빠진다. **0건을 실패로 만들지 않는다** — 경합이 정말 0건인
 * 구단(단독지명만 한 구단)이 실재하기 때문이다.
 *
 * ⚠**이름까지는 대조하지 않는다.** 주석의 구단 표기(`東京ヤクルト`)는 `TEAMS` 와도
 * `SHORT_NAME` 과도 다른 **세 번째 어휘**라, 대조하려면 매핑표를 새로 만들어야 하고
 * 그건 M1 위반이다(파서 `DraftBidRow.rivals` 주석). **규모만으로도 [I1] 은 잡힌다.**
 */
function invN3DeclaredGroupSize(db: Db): CheckResult {
  const rows = db.raw
    .prepare(
      `SELECT season, group_key, team, kind, won, rivals
         FROM draft_bid
        WHERE group_key IS NOT NULL
        ORDER BY season, group_key, team`,
    )
    .all() as unknown as Array<{
    season: number;
    group_key: string;
    team: string;
    kind: string;
    won: number | null;
    rivals: string | null;
  }>;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.season} ${r.group_key}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [r]);
    else bucket.push(r);
  }

  const violations: string[] = [];
  let checked = 0;
  for (const members of groups.values()) {
    const head = members[0]!;
    // 「그 구단 + 그 구단이 적은 상대들」이 곧 선언된 규모다.
    const declared = members
      .filter((m) => m.rivals !== null)
      .map((m) => ({ team: m.team, size: (JSON.parse(m.rivals as string) as string[]).length + 1 }));
    if (declared.length === 0) continue; // ⚠**「안 쟀다」이지 위반이 아니다**(M11)
    checked += 1;

    const sizes = [...new Set(declared.map((d) => d.size))];
    const at =
      `${head.season} group_key=${head.group_key} (멤버 ${members.length}개 · `
      + `${members.map((m) => `${m.team}${m.won === 1 ? "○" : ""}`).join(",")})`;
    const said = declared.map((d) => `${d.team}=${d.size}`).join(" ");
    if (sizes.length > 1) {
      violations.push(`${at}: 멤버끼리 선언한 규모가 어긋난다 — ${said}`);
      continue;
    }
    if (sizes[0] !== members.length) {
      violations.push(
        `${at}: 선언한 규모 ${sizes[0]}구단인데 실제 멤버는 ${members.length}개다 — ${said}`,
      );
    }
  }

  return {
    name: "INV-N3 (선언한 경합 규모 = 실제 그룹 멤버 수)",
    unit: "상대를 선언한 행이 있는 경합 그룹",
    checked,
    violations,
  };
}

const ALL_CHECKS = [
  inv4Acquisitions,
  inv4BidsPointAtPick,
  inv5NoDuplicateBids,
  invN1GroupsHaveWinner,
  invN2OneKindPerPlayer,
  invN3DeclaredGroupSize,
] as const;

// =========================================================================
// 시즌 하나를 통째로 넣는다 — **구단마다 따로**(소스가 구단당 한 장이다)
// =========================================================================

/**
 * 2019 지명회의의 1순위 경합.
 *
 * ⚠**어디까지가 실측인지 갈라 적는다.** 픽스처가 있는 것은 **요미우리와 히로시마 두 구단뿐**이고
 * (`packages/parser/test/fixtures/draft-2019-list-{g,c}.html.gz`), 그 둘의 모양은 실측이다 —
 * 요미우리는 낙첨 2건에 자기 1순위가 주석에 없고, 히로시마는 주석이 0건이다.
 * **야쿠르트·한신·세이부 세 줄은 요미우리 주석의 경합 상대 목록에서 되짚어 구성한 것**이지
 * 그 구단 페이지를 읽은 것이 아니다. **그 세 줄을 실측이라고 쓰지 마라.**
 * 여기에 필요한 것은 「실제 2019 이 이랬다」가 아니라 **「한 시즌이 다 들어온 모양」**이다.
 *
 * ```
 * 1회  奥川 恭伸  ヤクルト 획득 / 読売·阪神 낙첨
 * 2회  宮川 哲    西武 획득 / 読売 낙첨
 * 3회  堀田 賢慎  読売 단독(주석에 한 줄도 없다 — 여집합으로 유도한다)
 *      西 純矢    阪神 단독(2회)
 *      森下 暢仁  広島 단독(1회 · 경합 주석 0건)
 * ```
 *
 * ⚠⚠**세이부의 1회차 입찰을 뺐다**(2026-09-05 · INV-N3 을 넣으면서 드러났다).
 * 옛 판은 `bid("l", 1, ["東京ヤクルト"], "奥川恭伸", false)` 를 갖고 있었는데
 * **그건 실측과 어긋나는 구성이었다**: 요미우리 주석은 실물이고 거기에 적힌 상대가
 * `東京ヤクルト、阪神` **둘뿐**이라 **세이부는 그 경합에 있을 수 없다.** 그런데도 넣어 놔서
 * 그 그룹은 「선언된 규모 3(·2) 대 실제 멤버 4」라는 **내부 모순**을 갖고 있었고,
 * INV-N1 은 그것을 못 본다(이긴 구단이 정확히 1개이므로).
 * ⚠**세이부가 1회차에 무엇을 잃었는지는 이 픽스처에 없다**(실제로는 佐々木朗希 · ロッテ 획득).
 * 이 파일에 필요한 것은 「실제 2019 이 이랬다」가 아니라 **「한 시즌이 다 들어온 모양」**이다.
 * ⚠**그래서 아래 분모 셋이 줄었다**: 입찰 9→8 · 스냅샷 17→16 · (시즌,구단,이름) 12→11.
 * **줄어든 것을 「시험이 약해졌다」로 읽지 마라 — 없던 행 하나가 사라진 것이다.**
 */
function loadSeason2019(db: Db): void {
  loadDraft(db, {
    season: 2019,
    team: "s",
    picks: [pick("s", "shihaika", 1, "奥川 恭伸"), pick("s", "shihaika", 2, "吉田 大喜")],
    bids: [bid("s", 1, ["読売", "阪神"], null, true)],
    ...META,
  });
  loadDraft(db, {
    season: 2019,
    team: "g",
    picks: [
      pick("g", "shihaika", 1, "堀田 賢慎"),
      pick("g", "shihaika", 2, "太田 龍"),
      pick("g", "ikusei", 1, "平間 隼人"),
    ],
    bids: [bid("g", 1, ["東京ヤクルト", "阪神"], "奥川恭伸", false), bid("g", 2, ["埼玉西武"], "宮川哲", false)],
    ...META,
  });
  loadDraft(db, {
    season: 2019,
    team: "t",
    picks: [pick("t", "shihaika", 1, "西 純矢")],
    bids: [bid("t", 1, ["東京ヤクルト", "読売"], "奥川恭伸", false)],
    ...META,
  });
  loadDraft(db, {
    season: 2019,
    team: "l",
    picks: [pick("l", "shihaika", 1, "宮川 哲")],
    bids: [bid("l", 2, ["読売"], null, true)],
    ...META,
  });
  loadDraft(db, { season: 2019, team: "c", picks: [pick("c", "shihaika", 1, "森下 暢仁")], bids: [], ...META });
}

/**
 * 원시 INSERT — **`loadDraft` 가 만들지 않는 상태**를 일부러 만든다(아래 각 시험의 사유 참조).
 * ⚠**정규화는 `normalizePlayerName` 을 그대로 쓴다**(M1) — 여기서 흉내 내면 이름 규칙이 두 벌이 되고,
 * 시험이 **실제 적재와 다른 이름으로** 검사하게 된다.
 */
function rawPick(db: Db, season: number, kind: DraftKind, team: string, roundNo: number, name: string): void {
  db.raw
    .prepare(
      `INSERT INTO draft_pick
         (season, kind, team, round_no, pick_seq, waiver_dir, name_display, name_canonical,
          position, from_org, origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, 'npb', NULL, ?, ?, ?)`,
    )
    .run(season, kind, team, roundNo, name, normalizePlayerName(name), PAGE.source, PAGE.fetchedAt, PAGE.revision);
}

function rawBid(
  db: Db,
  season: number,
  kind: DraftKind,
  team: string,
  roundNo: number,
  name: string,
  won: 0 | 1 | null,
): void {
  db.raw
    .prepare(
      `INSERT INTO draft_bid
         (season, kind, round_no, team, group_key, won, name_display, name_canonical,
          origin, player_id, source, fetched_at, revision)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'npb', NULL, ?, ?, ?)`,
    )
    .run(season, kind, roundNo, team, won, name, normalizePlayerName(name), PAGE.source, PAGE.fetchedAt, PAGE.revision);
}

// =========================================================================
// ⚠먼저: 검사기 자체가 「아무것도 안 재는」 상태를 스스로 실패로 만드는가
// =========================================================================

test("⚠빈 DB 에서는 6종 전부 검사 대상 0건이고, 그것 자체가 실패다", async () => {
  await withDb((db) => {
    for (const check of ALL_CHECKS) {
      const r = check(db);
      assert.equal(r.checked, 0, `${r.name}: 빈 DB 인데 ${r.checked}건을 쟀다고 한다`);
      assert.deepEqual(r.violations, [], `${r.name}: 빈 DB 에 위반이 있을 수 없다`);
      // ⚠**여기가 요점이다.** 위반이 0건이어도 `assertClean` 은 통과시키지 않는다 —
      //   「위반 0건」과 「검사 대상 0건」을 같은 것으로 읽으면 이 시험 전체가 무의미해진다.
      assert.throws(
        () => assertClean(r),
        /검사 대상이 0건이다/,
        `${r.name}: 분모 0 인데 통과했다 — 이 검사는 아무것도 안 지킨다`,
      );
    }
    assert.equal(ALL_CHECKS.length, 6, "검사기 6종 중 6종을 이 시험이 돈다");
  });
});

// =========================================================================
// 정상 데이터 — 5종 전부 위반 0, **분모와 함께**
// =========================================================================

test("2019 한 시즌을 다 넣으면 불변식 5종이 전부 성립한다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    for (const check of ALL_CHECKS) assertClean(check(db));

    // ⚠**분모를 못 박는다.** 「전부 통과」가 아니라 「무엇을 몇 건 쟀는가」다(M2).
    //   이 수가 줄면 시험이 약해진 것이고, 그때 이 줄이 붉어져야 한다.
    assert.equal(inv4Acquisitions(db).checked, 5, "추첨 구획의 1巡目 슬롯 5건(s·g·t·l·c)");
    assert.equal(inv4BidsPointAtPick(db).checked, 5, "입찰이 있는 (구획, 구단) 5건");
    assert.equal(inv5NoDuplicateBids(db).checked, 8, "입찰 8건 — 낙첨 3 · 당첨 2 · 유도한 단독 3");
    assert.equal(invN1GroupsHaveWinner(db).checked, 2, "경합 그룹 2건(1:奥川恭伸 · 2:宮川哲)");
    assert.equal(invN2OneKindPerPlayer(db).checked, 11, "(시즌, 구단, 이름) 11건");
    assert.equal(invN3DeclaredGroupSize(db).checked, 2, "상대를 선언한 경합 그룹 2건");
  });
});

// =========================================================================
// INV-4 — 위반을 만들어 붉어지는 것을 본다
// =========================================================================

test("⚠INV-4: 1巡目 획득 행이 사라지면 붉어진다 — 화면에는 에러가 아니라 빈 칸이 남는다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    // 「경합 주석이 있는 구단은 건너뛴다」로 단독지명을 유도했을 때 나는 모양이다 —
    // 読売는 두 번 떨어졌으므로 주석이 있고, 그래서 자기 1巡目 획득이 통째로 빠진다.
    db.raw.prepare("DELETE FROM draft_bid WHERE season = 2019 AND team = 'g' AND won IS NULL").run();

    const r = inv4Acquisitions(db);
    assert.equal(r.checked, 5, "분모는 그대로 5건이다 — 지명 쪽에서 세기 때문이다");
    assert.equal(r.violations.length, 1, `위반 1건이어야 한다: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /shihaika\/g/);
    assert.match(r.violations[0] ?? "", /확정된 획득이 0건/);
    assert.throws(() => assertClean(r), /INV-4/);
  });
});

test("⚠INV-4: 낙첨을 당첨으로 읽으면 한 구단이 1순위를 두 번 얻는다 — INV-N1 도 같이 붉어진다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    // `外れる` 를 `確定` 으로 읽었을 때의 모양. 타입은 boolean 이지만 값은 HTML 에서 온다.
    db.raw.prepare("UPDATE draft_bid SET won = 1 WHERE season = 2019 AND team = 'g' AND round_no = 1").run();

    const four = inv4Acquisitions(db);
    assert.equal(four.violations.length, 1, `INV-4 위반 1건: ${four.violations.join(" / ")}`);
    assert.match(four.violations[0] ?? "", /확정된 획득이 2건/);

    // ⚠**한 비트가 두 불변식을 동시에 깬다** — 같은 경합에 이긴 구단이 둘이 된다.
    const n1 = invN1GroupsHaveWinner(db);
    assert.equal(n1.checked, 2, "그룹 수는 그대로 2건이다");
    assert.equal(n1.violations.length, 1, `INV-N1 위반 1건: ${n1.violations.join(" / ")}`);
    assert.match(n1.violations[0] ?? "", /이긴 구단이 2개다/);
  });
});

test("⚠INV-4: 획득 행의 선수가 1巡目 지명과 다르면 붉어진다 — 입찰 회차를 지명 회차로 읽은 모양", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    // 2019 세이부는 **2번째 추첨**에서 이겼지만 얻은 것은 **1巡目 宮川 哲**이다.
    // 입찰 회차(2)로 지명을 찾으면 그 구단의 **2순위 선수**가 당첨자로 적힌다.
    db.raw
      .prepare("UPDATE draft_bid SET name_canonical = '浜屋将太' WHERE season = 2019 AND team = 'l' AND won = 1")
      .run();

    const r = inv4Acquisitions(db);
    assert.equal(r.checked, 5, "분모 5건은 그대로다");
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /浜屋将太/);
    assert.match(r.violations[0] ?? "", /1巡目 지명과 다르다/);
  });
});

test("⚠INV-4′: 입찰이 가리키는 1巡目 지명이 없으면 붉어진다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    db.raw.prepare("DELETE FROM draft_pick WHERE season = 2019 AND team = 'c' AND round_no = 1").run();

    const r = inv4BidsPointAtPick(db);
    assert.equal(r.checked, 5, "입찰이 있는 (구획, 구단) 5건은 그대로다");
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /shihaika\/c/);
    // ⚠**지명 쪽 분모는 줄어든다** — 그래서 이 방향의 검사가 따로 필요하다.
    assert.equal(inv4Acquisitions(db).checked, 4, "1巡目 슬롯은 5 → 4 로 줄어든다");
  });
});

// =========================================================================
// INV-5 — 멱등
// =========================================================================

test("⚠INV-5: 전 구단을 다시 넣어도 두 표의 전 행이 같다(M5) — 그리고 그 비교가 실제로 차이를 본다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    const before = snapshot(db);
    assert.equal(before.length, 16, "지명 8행 + 입찰 8행 = 16행을 비교한다");

    loadSeason2019(db);
    const after = snapshot(db);
    assert.deepEqual(after, before, `재적재로 행이 바뀌었다 — ${before.length}행 중 비교`);
    assertClean(inv5NoDuplicateBids(db));
    assert.equal(inv5NoDuplicateBids(db).checked, 8, "재적재해도 입찰은 8건 그대로다");

    // ⚠**비교기가 아무것도 안 보는 것은 아닌가.** 한 칸만 흔들어 실제로 갈리는지 본다 —
    //   이 세 줄이 없으면 위 `deepEqual` 은 「언제나 같다」로도 통과할 수 있다.
    db.raw.prepare("UPDATE draft_bid SET name_display = '흔든 값' WHERE season = 2019 AND team = 'c'").run();
    assert.notDeepEqual(snapshot(db), before, "한 칸을 바꿨는데 스냅샷이 같다 — 비교기가 아무것도 안 본다");
  });
});

// =========================================================================
// INV-N1 — 경합 그룹이 이름 때문에 갈리는 것
// =========================================================================

/**
 * ⚠**글자는 실측에서 왔고 경합 모양은 구성이다.** 규칙 문서가 끝까지 안 붙는 이체자로
 * **2019 楽天 育成 `山﨑真彰` / `山崎真彰` 1건**을 실측했다 — 그 선수는 育成 지명이라
 * 추첨이 없다. 그래서 **그 두 글자만** 가져와 1순위 경합에 놓았다.
 * ⚠`山﨑` 는 U+FA11, `山崎` 는 U+5D0E 다. **NFC·NFKC·NFD 어느 것으로도 안 붙는다**(실측).
 */
const NAME_VARIANT = "山﨑真彰"; // 山﨑真彰
const NAME_STANDARD = "山崎真彰"; // 山崎真彰

test("INV-N1: 표기가 같으면 한 그룹이고 이긴 구단이 있다 — 이것이 대조군이다", async () => {
  await withDb((db) => {
    loadDraft(db, {
      season: 2019,
      team: "e",
      picks: [pick("e", "shihaika", 1, NAME_STANDARD)],
      bids: [bid("e", 1, ["読売"], null, true)],
      ...META,
    });
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "가상 낙첨선수")],
      bids: [bid("g", 1, ["東北楽天"], NAME_STANDARD, false)],
      ...META,
    });

    const r = invN1GroupsHaveWinner(db);
    assert.equal(r.checked, 1, "같은 표기면 경합 그룹은 하나다");
    assertClean(r);
    for (const check of ALL_CHECKS) assertClean(check(db));
  });
});

test("⚠INV-N1: 이체자로 경합 그룹이 갈리면 이긴 구단 없는 그룹이 생긴다 — 山﨑(U+FA11) ↔ 山崎(U+5D0E)", async () => {
  await withDb((db) => {
    // 이긴 구단의 이름은 **지명 표**에서 오고(당첨 주석은 이름을 안 쓴다),
    // 떨어진 구단의 이름은 **주석**에서 온다. 두 자리의 표기가 갈리면 그룹이 쪼개진다.
    loadDraft(db, {
      season: 2019,
      team: "e",
      picks: [pick("e", "shihaika", 1, NAME_VARIANT)],
      bids: [bid("e", 1, ["読売"], null, true)],
      ...META,
    });
    loadDraft(db, {
      season: 2019,
      team: "g",
      picks: [pick("g", "shihaika", 1, "가상 낙첨선수")],
      bids: [bid("g", 1, ["東北楽天"], NAME_STANDARD, false)],
      ...META,
    });

    const r = invN1GroupsHaveWinner(db);
    assert.equal(r.checked, 2, "⚠한 경합인데 그룹이 2개로 갈렸다 — 이것이 결함의 모양이다");
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /이긴 구단이 없다/);
    assert.throws(() => assertClean(r), /INV-N1/);

    // ⚠**INV-4 는 이 결함을 못 잡는다** — 두 구단 다 획득 행을 정확히 1건씩 갖는다.
    //   갈린 그룹은 「단독지명이었다」로 조용히 읽히고, 화면도 합계도 그럴듯하다.
    assertClean(inv4Acquisitions(db));
  });
});

// =========================================================================
// INV-N3 — 「단독지명」이라는 거짓 사실
//
// ⚠**이 절이 최종 검토 [I1] 의 end-to-end 재현이다.** 경합 주석 하나가 조용히 안 읽히면
// 그 구단의 1巡目이 「아무도 안 겹쳤다」로 둔갑하는데, **다른 다섯은 전부 초록이다.**
// =========================================================================

/**
 * ⚠⚠**검토자가 재현한 그대로.** 2019 阪神 페이지의 경합 주석이 어휘 변화로 0건이 되면
 * (예: `と重複`→`と競合`) 적재는 `西 純矢` 를 **단독지명**으로 유도한다:
 * ```
 * t | round_no=1 | group_key=NULL | won=NULL | 西 純矢   ← 「아무도 안 겹친 1巡目」 = 거짓
 * ```
 * ⚠**파서 쪽 그물은 이제 그 입력을 던진다**(`parser/src/draft.ts` 의 두 층). 여기서 재는 것은
 * **그 그물을 빠져나간 날 DB 가 스스로 모순을 드러내는가**다 — 층이 다르고, 둘 다 필요하다.
 */
function loadSeason2019MissingTigersBid(db: Db): void {
  loadDraft(db, {
    season: 2019,
    team: "s",
    picks: [pick("s", "shihaika", 1, "奥川 恭伸"), pick("s", "shihaika", 2, "吉田 大喜")],
    bids: [bid("s", 1, ["読売", "阪神"], null, true)],
    ...META,
  });
  loadDraft(db, {
    season: 2019,
    team: "g",
    picks: [pick("g", "shihaika", 1, "堀田 賢慎"), pick("g", "shihaika", 2, "太田 龍")],
    bids: [bid("g", 1, ["東京ヤクルト", "阪神"], "奥川恭伸", false), bid("g", 2, ["埼玉西武"], "宮川哲", false)],
    ...META,
  });
  // ⚠**여기가 결함이다** — 주석이 실재하는데 파서가 0건을 냈다. `bids: []` 가 그 상태다.
  loadDraft(db, { season: 2019, team: "t", picks: [pick("t", "shihaika", 1, "西 純矢")], bids: [], ...META });
  loadDraft(db, {
    season: 2019,
    team: "l",
    picks: [pick("l", "shihaika", 1, "宮川 哲")],
    bids: [bid("l", 2, ["読売"], null, true)],
    ...META,
  });
  loadDraft(db, { season: 2019, team: "c", picks: [pick("c", "shihaika", 1, "森下 暢仁")], bids: [], ...META });
}

test("⚠INV-N3: 주석 하나가 조용히 안 읽히면 「단독지명」이라는 거짓 사실이 생긴다([I1])", async () => {
  await withDb((db) => {
    loadSeason2019MissingTigersBid(db);

    // ⚠**거짓 사실이 실제로 만들어졌는지 먼저 본다** — 검사기가 무엇을 잡는지 말하려면
    //   잡을 것이 실재해야 한다.
    const nishi = db.raw
      .prepare("SELECT round_no, group_key, won FROM draft_bid WHERE season = 2019 AND team = 't'")
      .get() as unknown as { round_no: number; group_key: string | null; won: number | null };
    assert.deepEqual(
      { ...nishi },
      { round_no: 1, group_key: null, won: null },
      "⚠西 純矢 가 「아무도 안 겹친 1巡目」이 됐다 — 이것이 [I1] 이 만든 거짓 사실이다",
    );

    // ⚠⚠**다섯은 전부 초록이다.** 그래서 여섯 번째가 필요했다.
    for (const check of [
      inv4Acquisitions,
      inv4BidsPointAtPick,
      inv5NoDuplicateBids,
      invN1GroupsHaveWinner,
      invN2OneKindPerPlayer,
    ]) {
      assertClean(check(db));
    }

    const r = invN3DeclaredGroupSize(db);
    assert.equal(r.checked, 2, "상대를 선언한 그룹 2건은 그대로 잰다");
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /1:奥川恭伸/);
    assert.match(r.violations[0] ?? "", /선언한 규모 3구단인데 실제 멤버는 2개다/);
    assert.throws(() => assertClean(r), /INV-N3/);
  });
});

test("⚠INV-N3: 한 장의 주석만 상대를 덜 읽어도 붉어진다 — 멤버끼리 선언이 어긋난다", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    // 阪神 주석에서 상대 하나(`読売`)만 안 읽힌 모양. 그룹 멤버 수는 그대로 3이다.
    db.raw
      .prepare("UPDATE draft_bid SET rivals = ? WHERE season = 2019 AND team = 't' AND round_no = 1")
      .run(JSON.stringify(["東京ヤクルト"]));

    const r = invN3DeclaredGroupSize(db);
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /멤버끼리 선언한 규모가 어긋난다/);
    assert.match(r.violations[0] ?? "", /t=2/);
    // ⚠**나머지 다섯은 여기서도 초록이다** — 멤버 수가 안 변했기 때문이다.
    for (const check of [inv4Acquisitions, invN1GroupsHaveWinner]) assertClean(check(db));
  });
});

test("⚠INV-N3: 상대를 안 적는 행은 위반이 아니라 분모 밖이다 — 「0건」과 「안 쟀음」은 다르다(M11)", async () => {
  await withDb((db) => {
    loadSeason2019(db);
    assert.equal(invN3DeclaredGroupSize(db).checked, 2, "먼저 2건을 잰다");

    // 언젠가 상대 이름을 안 적는 소스(wikipedia 그리드 등)가 오면 이 모양이 된다.
    db.raw.prepare("UPDATE draft_bid SET rivals = NULL WHERE season = 2019 AND group_key = '2:宮川哲'").run();
    const r = invN3DeclaredGroupSize(db);
    assert.equal(r.checked, 1, "⚠분모가 줄어야 한다 — 「위반 0건」으로 세면 안 쟀다는 사실이 사라진다");
    assert.deepEqual(r.violations, [], "안 적은 것은 위반이 아니다");

    // ⚠**전부 NULL 이면 분모가 0 이고, 그건 통과가 아니라 실패다.**
    db.raw.prepare("UPDATE draft_bid SET rivals = NULL").run();
    const none = invN3DeclaredGroupSize(db);
    assert.equal(none.checked, 0);
    assert.throws(() => assertClean(none), /검사 대상이 0건이다/);
  });
});

// =========================================================================
// INV-N2 — kind 가 바뀌는 정정에서 옛 행이 고아로 남는 것
// =========================================================================

test("⚠INV-N2: 옛 구획의 지명이 고아로 남으면 붉어진다 — 같은 선수가 두 구획에 지명된 것이 된다", async () => {
  await withDb((db) => {
    // 2001 江尻 慎太郎 — 초판 파서가 `自由獲得選手` 를 `shihaika` 로 접었고 나중에 갈랐다.
    loadDraft(db, { season: 2001, team: "f", picks: [pick("f", "jiyuu_kakutoku", null, "江尻 慎太郎")], bids: [], ...META });
    assertClean(invN2OneKindPerPlayer(db));

    // ⚠**`loadDraft` 는 이 상태를 만들지 않는다** — Task 6 이 삭제 범위를 구단 단위로 바꿔
    //   그 경로를 막았다. 그래서 **직접 넣는다**: 불변식이 지키는 것은 「아직 모르는 경로」다.
    rawPick(db, 2001, "shihaika", "f", 1, "江尻 慎太郎");

    const r = invN2OneKindPerPlayer(db);
    assert.equal(r.checked, 1, "(시즌, 구단, 이름) 1건을 잰다");
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /江尻慎太郎/);
    assert.match(r.violations[0] ?? "", /jiyuu_kakutoku, shihaika/);
    assert.throws(() => assertClean(r), /INV-N2/);
  });
});

test("⚠INV-N2: 옛 구획의 입찰이 고아로 남아도 붉어진다 — 지명만 봐서는 못 잡는다", async () => {
  await withDb((db) => {
    // 2006 은 本ドラフト가 高校生 / 大学生・社会人 으로 갈라져 있었다. 구획 판정이 정정되면
    // **유도한 단독지명 행도 구획을 옮긴다** — 옛 행이 남으면 두 구획에서 얻은 것이 된다.
    loadDraft(db, { season: 2006, team: "g", picks: [pick("g", "daigaku_shakaijin", 1, "上野 貴久")], bids: [], ...META });
    assertClean(invN2OneKindPerPlayer(db));

    rawBid(db, 2006, "koukousei", "g", 1, "上野 貴久", null);

    const r = invN2OneKindPerPlayer(db);
    assert.equal(r.violations.length, 1, `위반 1건: ${r.violations.join(" / ")}`);
    assert.match(r.violations[0] ?? "", /daigaku_shakaijin, koukousei/);

    // ⚠**지명 표만 보면 아무 문제가 없다** — 그래서 두 표를 합쳐서 본다.
    const picksOnly = db.raw
      .prepare("SELECT COUNT(DISTINCT kind) AS n FROM draft_pick WHERE season = 2006 AND team = 'g'")
      .get() as unknown as { n: number };
    assert.equal(picksOnly.n, 1, "지명은 한 구획뿐이다 — 이 검사가 두 표를 안 합치면 초록이다");
  });
});

test("INV-N2: 한 구단이 한 시즌에 여러 구획을 가져도 위반이 아니다 — 2006 요미우리 실물 모양", async () => {
  await withDb((db) => {
    // 실측(2006 요미우리): 支配下 지명이 0건이고 구획이 4종이다. **다른 선수**들이므로
    // 이 불변식은 침묵해야 한다 — 여기서 붉어지면 정상 데이터를 막는 검사다.
    loadDraft(db, {
      season: 2006,
      team: "g",
      picks: [
        pick("g", "kibou_nyudanwaku", null, "金刃 憲人"),
        pick("g", "daigaku_shakaijin", 3, "上野 貴久"),
        pick("g", "koukousei", 1, "坂本 勇人"),
        pick("g", "ikusei", 1, "鈴木 誠"),
      ],
      bids: [bid("g", 1, ["阪神", "中日"], "堂上直倫", false)],
      ...META,
    });
    // ⚠**이긴 구단을 같이 넣어야 한다.** 낙첨만 넣은 상태에서 INV-N1 이 붉은 것은 결함이 아니라
    //   **시즌이 덜 들어온 것**이다(이 파일 머리말의 전제). 중일이 堂上直倫 을 얻었다.
    loadDraft(db, {
      season: 2006,
      team: "d",
      picks: [pick("d", "koukousei", 1, "堂上 直倫")],
      bids: [bid("d", 1, ["読売", "阪神"], null, true)],
      ...META,
    });
    // ⚠⚠**한신도 넣어야 한다 — INV-N3 을 넣고서야 드러났다**(2026-09-05).
    //   2006 요미우리 주석은 **실물**이고(`堂上直倫内野手で阪神、中日と重複`) 거기 적힌 상대가
    //   **둘**이라 그 경합은 **3구단**이다. 요미우리·중일만 넣은 옛 판은 「선언 3 대 멤버 2」라는
    //   **내부 모순**을 갖고 있었는데, INV-N1·INV-4 는 그것을 못 본다(이긴 구단이 정확히 1개다).
    //   ⚠**「덜 들어온 시즌」과 「틀린 파싱」은 이 검사에서 같은 모양이다** — 그래서 이 파일의
    //   전제(「시즌을 다 넣은 뒤에 돌린다」)가 INV-N3 에서는 **선택이 아니라 필수**다.
    loadDraft(db, {
      season: 2006,
      team: "t",
      picks: [pick("t", "koukousei", 1, "野原 将志")],
      bids: [bid("t", 1, ["読売", "中日"], "堂上直倫", false)],
      ...META,
    });

    const r = invN2OneKindPerPlayer(db);
    assert.equal(r.checked, 8, "선수 8명 — 요미우리 5(지명 4 + 낙첨 대상) + 중일 1 + 한신 2");
    assertClean(r);
    for (const check of ALL_CHECKS) assertClean(check(db));
    assert.equal(invN3DeclaredGroupSize(db).checked, 1, "경합 그룹 1건(1:堂上直倫 · 3구단)");
  });
});
