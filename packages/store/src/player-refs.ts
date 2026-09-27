/**
 * 경과(`playbyplay`)가 가리키는 선수가 **선수 표에 있는가** — 외래키 오류 **전에** 원인 선수의 ID·역할·행 수를 말하게 한다.
 * (감사 N1 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §6-3)
 *
 * ⚠**외래키 오류는 원인을 말하지 않는다** — `FOREIGN KEY constraint failed` 뿐이다. 박스에서 링크를 못 읽은 선수는 격리만 남고
 *   (`unlinkedPlayer` · 감사 C9) 선수 행이 안 생기는데, 경과의 링크는 살아 있으면 정렬이 그 ID 를 `pitcher_id` 로 옮긴다.
 *   그 선수가 **신규**면 타석을 쓰는 순간 외래키로 던졌다(예전에는 프로세스까지 죽었다).
 * ⚠**정렬 뒤 행을 넘겨라** — 파서 이벤트 전량이 아니다. 투수의 **유일한 타석이 미완결**(`（途中終了）`·`（途中交代）`)이면
 *   박스에 줄이 없고 정렬이 그 타석을 버린다 — 전량을 보면 그 투수를 헛실패로 잡는다(설계 §4-4 실측 4건).
 * ⚠**같은 트랜잭션 안에서 부른다** — 방금 넣은 박스 선수가 보여야 외래키 조건과 정확히 같다.
 * ⚠격리가 아니라 **실패**다(설계 §6-6) — 투수를 NULL 로 넣으면 경과가 알려 준 귀속을 버리고, 경과로 선수 행을 만들면 출처가 둘이 된다(M1).
 */
import type { Db } from "./db.ts";

export type PlayerRefRole = "打者" | "投手" | "走者";

export interface MissingPlayerRef {
  role: PlayerRefRole;
  playerId: string;
  /** 그 선수를 그 역할로 가리킨 행 수(타석 · 주자 사건) */
  count: number;
}

export interface PlayerRefSources {
  /** ⚠**정렬 뒤** 타석 행(`alignPaEvents(...).events`) */
  events: readonly { batterId: string; pitcherId: string | null }[];
  /** 주자 사건(도루·도루자·견제사) */
  runners: readonly { runnerId: string }[];
}

/**
 * 선수 표에 **없는** 참조를 처음 나온 순서대로 돌려준다. 전부 있으면 빈 배열이다.
 * ⚠투수 미상(null) 타석은 가리키는 선수가 없다 — 외래키도 NULL 은 검사하지 않는다.
 */
export function missingPlayerRefs(db: Db, refs: PlayerRefSources): MissingPlayerRef[] {
  const tally = new Map<string, MissingPlayerRef>();
  const note = (role: PlayerRefRole, playerId: string): void => {
    const key = `${role}|${playerId}`;
    const prev = tally.get(key);
    if (prev === undefined) tally.set(key, { role, playerId, count: 1 });
    else prev.count += 1;
  };
  for (const e of refs.events) {
    note("打者", e.batterId);
    if (e.pitcherId !== null) note("投手", e.pitcherId);
  }
  for (const r of refs.runners) note("走者", r.runnerId);

  const exists = db.raw.prepare("SELECT 1 AS x FROM player WHERE player_id = ?");
  const known = new Map<string, boolean>();
  const out: MissingPlayerRef[] = [];
  for (const ref of tally.values()) {
    let has = known.get(ref.playerId);
    if (has === undefined) {
      has = exists.get(ref.playerId) !== undefined;
      known.set(ref.playerId, has);
    }
    if (!has) out.push({ ...ref });
  }
  return out;
}

const UNIT: Readonly<Record<PlayerRefRole, string>> = { 打者: "타석", 投手: "타석", 走者: "주자 사건" };

/** 선수 표에 없는 선수를 가리킨 경기. 적재기가 **그 경기만** 되돌리고 실패로 센다(`WRITE ERROR`) */
export class MissingPlayerRefError extends Error {
  readonly missing: readonly MissingPlayerRef[];
  constructor(missing: readonly MissingPlayerRef[]) {
    super(`선수 표에 없는 선수를 가리킨다 — ${missing.map((m) => `${m.role} ${m.playerId}(${UNIT[m.role]} ${m.count})`).join(" · ")}`);
    this.name = "MissingPlayerRefError";
    this.missing = missing;
  }
}
