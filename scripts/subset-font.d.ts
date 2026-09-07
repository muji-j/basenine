/**
 * `subset-font` 는 타입 선언을 안 싣는다(CommonJS · `.d.ts` 0개 · 실측).
 * **쓰는 만큼만** 적는다 — 안 쓰는 옵션을 적으면 「있다고 적혀 있는데 안 도는」 상태가 된다.
 */
declare module "subset-font" {
  /**
   * @param originalFont TTF/WOFF/WOFF2 중 아무거나(`fontverter` 가 판별한다)
   * @param text 남길 글자. **문자열이어야 한다** — 배열을 주면 던진다
   */
  export default function subsetFont(
    originalFont: Buffer,
    text: string,
    options?: {
      targetFormat?: "truetype" | "woff" | "woff2";
      /** ⚠**주지 않으면 `--layout-features=*`** — 전 기능을 남긴다(`palt` 포함) */
      keepFeatures?: readonly string[];
      preserveNameIds?: readonly number[];
      noHinting?: boolean;
    },
  ): Promise<Buffer>;
}
