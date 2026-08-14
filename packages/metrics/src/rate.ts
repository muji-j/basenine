/**
 * 비율 지표의 결과.
 *
 * ⚠**분모를 항상 함께 나른다**(CLAUDE.md M2). 10타석 .400을 「리그 1위」로 보여주는 것이
 * 이 도메인의 1급 함정이고, 분모를 버리는 시그니처를 허용하면 그 함정을 막을 방법이 없다.
 * 규율이 아니라 타입으로 강제하는 것이 이 파일의 존재 이유다.
 */
export interface Rate {
  /** 분모가 0이면 null. **0으로 대체하지 않는다** — 「0」과 「없음」은 다르다(M11) */
  value: number | null;
  /** 이 값이 몇 개의 표본에서 나왔는가 */
  denominator: number;
}

export function rate(numerator: number, denominator: number): Rate {
  if (denominator < 0) throw new RangeError(`분모는 음수일 수 없다: ${denominator}`);
  return { value: denominator === 0 ? null : numerator / denominator, denominator };
}
