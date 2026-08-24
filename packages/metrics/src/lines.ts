/**
 * 타자 카운팅 스탯 1행.
 *
 * ⚠`bb`는 **고의사구를 포함한 볼넷 총수**이고, `ibb`는 그중 고의사구다.
 * wOBA는 `bb - ibb`를 쓰고 BB%는 `bb`를 쓴다 — 산식마다 관례가 다르므로 둘 다 보관한다.
 * 하나로 합치면 어느 한쪽이 반드시 틀린다.
 */
export interface BattingLine {
  /** 타석 */ pa: number;
  /** 타수 */ ab: number;
  /** 안타(총) */ h: number;
  /** 2루타 */ double: number;
  /** 3루타 */ triple: number;
  /** 홈런 */ hr: number;
  /** 볼넷(고의사구 포함) */ bb: number;
  /** 고의사구 */ ibb: number;
  /** 사구 */ hbp: number;
  /** 희생플라이 */ sf: number;
  /** 희생번트 */ sh: number;
  /** 삼진 */ so: number;
  /**
   * 실책 출루(失策出塁).
   *
   * wOBA의 공식 산식이 요구하는 항이다. 소스 조사 단계에서는 「공개 소스 없음」으로 판정했으나,
   * 박스스코어의 타석 결과 셀(`三ゴ失` 등)에 인코딩되어 있는 것을 실측으로 확인했다(2026-08-15).
   * 파서가 세어서 넣는다.
   */
  roe: number;
}

/** 투수 카운팅 스탯 1행. **이닝은 아웃 카운트로만 다룬다.** */
export interface PitchingLine {
  /** 아웃 카운트. 이닝 × 3 */ outs: number;
  /** 상대한 타자 수 */ bf: number;
  /** 피안타 */ h: number;
  /** 피홈런 */ hr: number;
  /** 볼넷(고의사구 포함) */ bb: number;
  /** 고의사구 */ ibb: number;
  /** 사구 */ hbp: number;
  /** 탈삼진 */ so: number;
  /** 자책점 */ er: number;
  /** 실점 */ r: number;
}

export function singles(line: BattingLine): number {
  return line.h - line.double - line.triple - line.hr;
}

export function totalBases(line: BattingLine): number {
  return singles(line) + 2 * line.double + 3 * line.triple + 4 * line.hr;
}

/**
 * 야구 관례의 이닝 표기(`6.2` = 6과 3분의 2).
 *
 * ⚠이건 **표시용 문자열**이다. 계산에는 절대 쓰지 마라 — 계산은 `outs`로 한다.
 * `6.2`를 수로 더하기 시작하면 이닝이 조용히 어긋난다.
 */
/**
 * 아웃 카운트 → 이닝 표기의 **규칙 한 벌**. `20` → `6.2`
 *
 * ⚠**같은 규칙이 여러 벌이었다**(2026-08-24 · 감사 P3 #52). 「정본」이라던 `inningsPitched` 는
 * **프로덕션 호출 0곳인 죽은 export** 였고, 실제로 쓰이는 것은 `web/src/format.ts` 의 `innings()` 였다.
 * ⚠**죽은 정본은 「장치가 있다」는 착각만 남긴다** — 그래서 규칙을 여기 하나로 두고
 * **양쪽이 이것을 부르게** 했다. 이제 「정본」이라는 말이 참이다.
 *
 * ⚠**표시용이다. 계산에 쓰지 마라** — `6.2` 를 수로 더하기 시작하면 이닝이 조용히 어긋난다.
 * ⚠**클라이언트(`assets.ts`)에는 한 벌이 더 있고 그건 어쩔 수 없다** — 브라우저가 서버 모듈을
 * 못 부른다. 그 자리는 그 사실이 이미 주석에 적혀 있다.
 */
export function inningsFromOuts(outs: number): string {
  const whole = Math.floor(outs / 3);
  const remainder = outs % 3;
  return remainder === 0 ? String(whole) : `${whole}.${remainder}`;
}

export function inningsPitched(line: PitchingLine): string {
  return inningsFromOuts(line.outs);
}
