/**
 * **시험용 시계 고정 — 자식 프로세스 전용 `--import` 미리 읽기.**
 *
 * CLI(`tools/*.ts`)는 진입점에서 **진짜 시계를 한 번** 읽는다(M6 · `scripts/test/clock-injection.test.ts` 의 허용 목록).
 * 그 배선 자체를 시험하려면 그 한 번을 바깥에서 정해야 하는데, **제품 코드에 시험용 구멍(환경변수로 「오늘」을 덮는 것)을
 * 내지 않으려고** 여기서 자식 프로세스의 `Date` 를 바꾼다:
 *
 *     node --import <이 파일> packages/store/tools/load-draft-archive.ts …   (환경변수 BB_TEST_NOW=ISO 시각)
 *
 * ⚠**인자 없는 생성과 `Date.now()` 만 고정한다** — `new Date("2026-10-22")`·`Date.UTC(…)` 처럼 주어진 값을 해석하는
 *   호출은 그대로 둔다(시계를 읽는 것이 아니다 · M6 의 그 구분이다).
 * ⚠**이 파일은 시험 러너가 직접 돌리지 않는다**(`*.test.ts` 가 아니다). 시험이 자식 프로세스에 넘길 때만 쓴다.
 */
const raw = process.env["BB_TEST_NOW"];
const at = raw === undefined ? Number.NaN : Date.parse(raw);
if (!Number.isFinite(at)) {
  throw new Error(`BB_TEST_NOW 가 ISO 시각이 아니다: ${JSON.stringify(raw)}`);
}

const RealDate = globalThis.Date;
globalThis.Date = new Proxy(RealDate, {
  construct(target, args: unknown[], newTarget) {
    return Reflect.construct(target, args.length === 0 ? [at] : args, newTarget) as object;
  },
  // `Date()`(new 없이) 도 「지금」의 문자열을 낸다 — 같이 고정한다
  apply() {
    return Reflect.construct(RealDate, [at]).toString();
  },
  get(target, prop, receiver) {
    if (prop === "now") return () => at;
    return Reflect.get(target, prop, receiver) as unknown;
  },
});
