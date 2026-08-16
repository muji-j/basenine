/**
 * 야구 표기 포맷터.
 *
 * ⚠**로케일 기본 포맷을 그대로 쓰면 야구 관례가 깨진다.** 타율은 `.301`(선행 0 없음)이고
 * 방어율은 소수 2자리다. `Intl.NumberFormat`은 `0.301`을 낸다.
 * 그래서 도메인 포맷터를 따로 둔다.
 *
 * ⚠**분모 없는 비율을 만들지 마라**(M2). 이 파일에 「값만 내는」 함수를 추가하지 않는다 —
 * 비율을 렌더링하는 쪽은 반드시 표본 수를 함께 받는다.
 */
import type { Rate } from "@bb-app/metrics";

/** 값이 없음. **0과 구별한다**(M11). */
export const NO_VALUE = "—";

/**
 * 야구 관례의 반올림 — **사사오입**(round half up).
 *
 * ⚠**`toFixed`를 그대로 쓰면 안 된다.** 이진 부동소수 때문에 정확히 반이 되는 값이
 * 내림된다. 실측(2026-08-16 외부 대조): 中込의 방어율이 `11×27÷40 = 7.425`인데
 * `(7.425).toFixed(2)`는 **`"7.42"`**를 낸다(저장된 double이 7.42499999…이므로).
 * npb.jp를 포함한 모든 공표는 **7.43**이다.
 *
 * 0.01 차이는 작지만, **다른 사이트와 다른 숫자를 내는 것이 곧 신뢰 문제**다.
 * 그리고 「우리가 계산한다」는 이 서비스의 근거가 반올림 하나로 흔들릴 이유가 없다.
 *
 * @param digits 소수 자릿수
 */
export function fixed(value: number, digits: number): string {
  const f = 10 ** digits;
  const scaled = value * f;
  // ⚠상대 오차로 보정한다. `Number.EPSILON`은 1.0 근처의 절대 오차라 큰 값에서는 모자란다
  const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON * 4;
  return (Math.round(nudged) / f).toFixed(digits);
}

/** 타율·출루율·장타율 — 소수 3자리, 선행 0 없음. `.317` */
export function avg3(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE;
  const s = fixed(value, 3);
  return s.startsWith("0.") ? s.slice(1) : s.startsWith("-0.") ? `-${s.slice(2)}` : s;
}

/** 방어율·WHIP — 소수 2자리. 선행 0을 **남긴다**(`0.98`은 그대로 읽는 게 관례) */
export function dec2(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : fixed(value, 2);
}

/** wRC+ 같은 지수 — 소수 1자리 */
export function dec1(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : fixed(value, 1);
}

/** 부호를 항상 붙인다. SRC·wRAA처럼 0이 기준인 값에 쓴다 */
export function signed1(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE;
  return (value >= 0 ? "+" : "") + fixed(value, 1);
}

/** 백분율 — 소수 1자리 */
export function pct1(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : `${fixed(value * 100, 1)}%`;
}

export function int(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : String(Math.round(value));
}

/** 아웃 카운트 → 이닝 표기. `20` → `6.2` */
export function innings(outs: number | null): string {
  if (outs === null || !Number.isFinite(outs)) return NO_VALUE;
  const whole = Math.floor(outs / 3);
  const rest = outs % 3;
  return rest === 0 ? String(whole) : `${whole}.${rest}`;
}

/** 분모 표기. `442打席` */
export function denominator(n: number, unit = "打席"): string {
  // ⚠**「回」의 분모는 아웃 카운트다.** 39를 그대로 쓰면 「39回」가 되어 13이닝이 39이닝이 된다.
  // 이 환산을 화면마다 다시 쓰면 언젠가 한 곳만 고쳐진다 — 그래서 여기 한 곳에 둔다
  return unit === "回" ? `${innings(n)}回` : `${n}${unit}`;
}

/** `Rate`를 표기와 분모로 나눠 돌려준다. **둘을 떼어 쓰지 마라.** */
export function rateParts(r: Rate, unit = "打席", digits: 2 | 3 = 3): { value: string; den: string } {
  return {
    value: digits === 3 ? avg3(r.value) : dec2(r.value),
    den: denominator(r.denominator, unit),
  };
}

/** 경기일 `2026-08-14` → `8月14日` */
export function gameDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** `2026-08-14` → `2026年8月14日` */
export function fullDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 투타 → 일본어 표기 */
export function throwsBats(t: string | null, b: string | null): string {
  const hand: Readonly<Record<string, string>> = { right: "右", left: "左", both: "両" };
  if (t === null || b === null) return NO_VALUE;
  return `${hand[t] ?? "?"}投${hand[b] ?? "?"}打`;
}
