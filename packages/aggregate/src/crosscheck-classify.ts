/**
 * **우리 값과 npb.jp 공표값이 다를 때, 그것이 「결함」인가 「정의·표기 차이」인가.**
 *
 * ⚠**도구 안에 두지 않고 여기로 뺐다**(2026-08-28). 이 판정이 **대조의 전부**다 —
 * 여기서 잘못 「정의 차이」로 접으면 **진짜 결함이 조용히 지나가고**, 반대로 접지 않으면
 * **도구가 늘 붉어져 아무도 안 보게 된다.** 그런 규칙은 **시험이 직접 부를 수 있어야 한다.**
 *
 * ⚠**「알려진 불일치를 이름으로 면제」하는 것이 아니다.** 여기 있는 것은 **표기의 뜻**이라
 * 다음에 다른 선수가 같은 상황을 만들어도 그대로 성립한다. 이름으로 면제했다면
 * **그 사람만** 넘어가고 다음 사람에서 또 붉어졌을 것이다.
 */

export interface CrosscheckDiff {
  team: string;
  kind: "batting" | "pitching";
  /**
   * 우리 선수 ID(`player.player_id`).
   *
   * ⚠**공표 쪽과 짝짓는 것은 이름이지만 그 뒤는 ID 로만 간다**(M10 · 설계
   * `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D2) — 감지 모드(`--emit`)가 이것을 `player_id` 로 내보내고,
   * 공표 정정 자동 재수집이 이것으로 그 선수의 경기를 찾는다. 이름으로 다시 찾으면 동명이인·등록명 변경에서 엉뚱한 경기를 받는다.
   * 판정(`classifyDiff`)은 이 값을 보지 않는다 — 표기의 뜻은 사람이 누구든 같다.
   */
  playerId: string;
  name: string;
  field: string;
  /** 우리가 계산한 값(화면과 같은 반올림) */
  ours: string;
  /** npb.jp 공표표의 값 */
  published: string;
}

/**
 * @returns 정의·표기 차이면 **그 사유**, 결함 후보면 `null`.
 *
 * ⚠**사유를 문장으로 돌려준다** — 「알려진 것 N건」만 세면 무엇이 접혔는지 아무도 모른다.
 */
export function classifyDiff(d: CrosscheckDiff): string | null {
  /**
   * ⚠**0타수에 「.000」이라고 쓰지 않는 것은 우리 선택이고 우리 쪽이 맞다**(M11·M2).
   * 「0안타를 쳤다」와 「타석에 서지 않았다」는 다르다.
   */
  if (d.ours === "-" && (d.published === ".000" || d.published === "0.00")) {
    return "0타수·0이닝에 우리는 「—」, 공표는 .000 — 우리 쪽이 M11에 맞다";
  }
  /**
   * ⚠공표 타격표의 「試合」은 **出場試合**(타석이 없어도 센다)이고, 우리는
   * **타격 기록이 있는 경기**를 센다. 투수에게서 크게 갈린다.
   * 우리 화면은 투수의 「試合」을 투구 기록에서 내므로 표시에는 영향이 없다.
   */
  if (d.kind === "batting" && d.field === "試合") {
    return "공표는 出場試合, 우리는 打撃記録のある試合 — 투수 화면에는 쓰지 않는 값";
  }
  /**
   * ⚠**아웃을 하나도 못 잡은 등판을 npb.jp 는 投球回 `+` 로 적는다.**
   *
   * 실측(2026-08-28 · **CI 가 배선 첫날에 잡았다** · 日本ハム 清宮 虎多朗):
   * `登板 1 · 打者 3 · 投球回 + · 安打 2 · 四球 1 · 失点 1 · 自責点 1 · 防御率 ----`
   * — **3타자에게 안타 2 + 사사구 1 이라 아웃이 0** 이다. **우리 `0` 이 맞고 `+` 는 표기다.**
   *
   * ⚠**「`+` 면 무조건 넘긴다」로 쓰지 마라.** 그러면 **우리가 3이닝인데 공표가 `+`** 인
   * 진짜 결함까지 조용히 지나간다. **우리 쪽이 `0` 일 때만** 같은 뜻으로 본다.
   */
  if (d.kind === "pitching" && d.field === "投球回" && d.published === "+" && d.ours === "0") {
    return "아웃 0 인 등판을 공표는 「+」로 적는다 — 우리 「0」과 같은 뜻";
  }
  /**
   * ⚠**이닝이 0 이면 방어율은 정의되지 않는다.** 공표는 `----`, 우리는 `-` 로 적는다.
   * ⚠**우리 쪽이 「-」일 때만**이다 — 우리가 수를 냈는데 공표가 `----` 면 그건 결함이다
   * (분모가 0 인데 값을 냈다는 뜻이라 M2 위반이다).
   */
  if (d.kind === "pitching" && d.field === "防御率" && d.published === "----" && d.ours === "-") {
    return "이닝 0 이라 방어율이 정의되지 않는다 — 공표 「----」와 우리 「—」가 같은 뜻";
  }
  return null;
}

// ── 감지 모드(`--emit`)의 상태 ──────────────────────────────────────────────
/**
 * **감지 모드의 판정 — 「잴 수 있었는가」와 「결함이 있는가」를 가른다**(설계
 * `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D2).
 *
 * 관문(`--emit` 없이)의 종료 1 은 「결함 발견 · 기준일 불일치 · 비교 0명」을 **한 코드로 겸한다**. 그 코드를 읽는 자동 재수집은
 * 「받을 경기가 있다」와 「잴 수 없었다」를 못 가른다 — 그래서 감지 모드는 `status` 3값과 종료코드를 따로 낸다.
 * ⚠**관문의 판정과 종료코드는 바꾸지 않는다**(사용자 결정 · `test/crosscheck-gate-unchanged.test.ts`).
 */
export type CrosscheckEmitStatus = "no_defects" | "defects" | "unmeasured";

/**
 * **측정 실패의 닫힌 목록 — 이 차례가 우선순위다.** 둘 이상 걸리면 첫 것 하나가 `reason` 이고 나머지는 `reason_detail` 에 글로 붙는다.
 * - `asof_split` — 공표표 기준일(`現在`)이 장마다 다르다. 고르면 그쪽이 아닌 팀 전원이 불일치로 잡힌다
 * - `table_parse_error` — 공표표 해석이 던졌다(`StatsParseError` · 구조가 바뀌었다)
 * - `tables_missing` — 기대한 장(12구단 × 타격·투구 = 24) 중 못 읽은 장이 있다.
 *   ⚠**관문보다 엄격하다** — 관문은 경고만 하고 넘어가지만(기존 한계 · 설계 §7) 빠진 장의 선수는 대조되지 않았다
 * - `compared_zero` — 대조한 선수가 0명이다(「0건」이 아니라 「안 쟀다」)
 */
export const CROSSCHECK_UNMEASURED_REASONS = ["asof_split", "table_parse_error", "tables_missing", "compared_zero"] as const;
export type CrosscheckUnmeasuredReason = (typeof CROSSCHECK_UNMEASURED_REASONS)[number];

export interface CrosscheckEmitInput {
  /** 읽은 공표표에서 본 기준일(`YYYY-MM-DD`). 같은 날짜가 여러 번 있어도 된다. `--through` 로 덮었으면 빈 배열(읽지 않았다) */
  readonly asOfDates: readonly string[];
  /** 읽은 공표표 장 수(해석이 던진 장도 「읽은 장」이다) */
  readonly tablesRead: number;
  /** 기대한 장 수(12구단 × 타격·투구 = 24) */
  readonly tablesExpected: number;
  /** 공표표 해석이 한 번이라도 던졌다 */
  readonly parseError: boolean;
  readonly comparedPlayers: number;
  /** 결함 후보(`classifyDiff` 가 `null` 인 것) 수 */
  readonly defects: number;
}

/** 셈이어야 하는 칸 — 아니면 던진다. 틀린 판정을 조용히 내느니 감지기가 죽는 쪽이 낫다(M7 · 그때 부르는 쪽은 `detector_error`) */
function countOf(name: string, v: number, min: number): number {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${name} 가 ${String(min)} 이상의 정수가 아니다: ${String(v)}`);
  return v;
}

/** 걸린 측정 실패 사유를 **닫힌 목록의 차례대로** 전부 — 첫 것이 `reason`, 나머지는 `reason_detail` 의 글감이다 */
export function crosscheckUnmeasuredReasons(i: CrosscheckEmitInput): CrosscheckUnmeasuredReason[] {
  const expected = countOf("tablesExpected", i.tablesExpected, 1);
  const read = countOf("tablesRead", i.tablesRead, 0);
  if (read > expected) throw new RangeError(`tablesRead(${String(read)}) 가 tablesExpected(${String(expected)}) 보다 크다`);
  const compared = countOf("comparedPlayers", i.comparedPlayers, 0);
  countOf("defects", i.defects, 0);

  const out: CrosscheckUnmeasuredReason[] = [];
  if (new Set(i.asOfDates).size > 1) out.push("asof_split");
  if (i.parseError) out.push("table_parse_error");
  if (read < expected) out.push("tables_missing");
  if (compared === 0) out.push("compared_zero");
  return out;
}

/**
 * @returns 측정에 실패했으면 `unmeasured` 와 **첫** 사유, 성공했으면 결함 수에 따라 `defects`·`no_defects`(사유 `null`).
 * ⚠「잴 수 없었다」가 「결함이 있다」를 이긴다 — 반쯤 잰 결함으로 경기를 받으면 엉뚱한 것을 받는다.
 */
export function crosscheckEmitStatus(i: CrosscheckEmitInput): {
  status: CrosscheckEmitStatus;
  reason: CrosscheckUnmeasuredReason | null;
} {
  const reasons = crosscheckUnmeasuredReasons(i);
  const first = reasons[0];
  if (first !== undefined) return { status: "unmeasured", reason: first };
  return { status: i.defects > 0 ? "defects" : "no_defects", reason: null };
}

/**
 * 감지 모드의 종료코드 — **측정에 성공하면 결함 수와 무관하게 0**, 실패하면 **2**.
 * 예상 밖 예외(버그)는 이 함수에 오지 않는다 — 0·2 가 아닌 종료이고 결과 JSON 을 약속하지 않는다.
 */
export function crosscheckEmitExitCode(status: CrosscheckEmitStatus): 0 | 2 {
  return status === "unmeasured" ? 2 : 0;
}
