/**
 * 아카이브 저장소.
 *
 * 저장 대상은 **원시 바이트 그대로**다. 파싱하지 않고, 인코딩 변환도 하지 않는다.
 * 나중에 무엇을 뽑고 싶어질지 지금 알 수 없으므로 원본을 남기는 것이 유일하게 안전한 선택이다.
 *
 * 인터페이스를 한 겹 두는 이유: 지금은 로컬 디스크, 나중에 R2로 옮긴다(CLAUDE.md §1 미확정).
 * 저장소 교체가 수집 로직을 건드리지 않게 한다.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 저장된 블롭의 메타데이터 (CLAUDE.md M4: source · fetched_at · as_of · revision). */
export interface BlobMeta {
  /** 취득한 원본 URL */
  url: string;
  /** 취득 시각 (ISO8601) */
  fetchedAt: string;
  /** 서버가 알려준 데이터 기준시각. 없으면 null (M11: 없음과 0을 섞지 않는다) */
  lastModified: string | null;
  etag: string | null;
  status: number;
  sha256: string;
  byteLength: number;
  /** 내용이 실제로 바뀔 때만 증가한다. 재수집만으로는 오르지 않는다 */
  revision: number;
  /**
   * **마지막으로 확인한 시각**(ISO8601). 내용이 안 바뀌어도 갱신된다.
   *
   * ⚠**`fetchedAt` 과 뜻이 다르다.** `fetchedAt` 은 「내용이 마지막으로 **바뀐**」 취득 시각이고
   * 이것은 「마지막으로 **본**」 시각이다. 둘을 섞으면 두 가지가 동시에 망가진다(2026-08-17 재검토):
   * · 화면이 「N時点に取得」이라고 실제보다 낡은 날짜를 말한다
   * · 재취득 선정이 「아직 안 받았다」고 오판해 **같은 페이지를 매일 다시 친다**(L1)
   * ⚠옛 사이드카에는 이 필드가 없다 — 읽는 쪽이 `?? fetchedAt` 으로 떨어뜨린다(하위호환).
   */
  checkedAt?: string;
}

export interface Sink {
  readMeta(key: string): Promise<BlobMeta | null>;
  readBody(key: string): Promise<Uint8Array | null>;
  write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void>;
  /**
   * 메타만 갱신한다(본문은 그대로).
   *
   * ⚠**내용이 안 바뀌었을 때 「봤다」를 남기기 위한 것이다.** 본문을 다시 쓰면 낭비이고,
   * 안 남기면 「마지막으로 본 시각」을 영영 알 수 없다.
   */
  writeMeta(key: string, meta: BlobMeta): Promise<void>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 로컬 디스크 구현. 본문은 gzip, 메타는 평문 JSON(사람이 읽을 수 있게). */
export class LocalSink implements Sink {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private bodyPath(key: string): string {
    return join(this.root, `${key}.html.gz`);
  }

  private metaPath(key: string): string {
    return join(this.root, `${key}.meta.json`);
  }

  async readMeta(key: string): Promise<BlobMeta | null> {
    try {
      const raw = await readFile(this.metaPath(key), "utf8");
      return JSON.parse(raw) as BlobMeta;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readBody(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(gunzipSync(await readFile(this.bodyPath(key))));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    const bodyPath = this.bodyPath(key);
    await mkdir(dirname(bodyPath), { recursive: true });
    await writeFile(bodyPath, gzipSync(body));
    await this.writeMeta(key, meta);
  }

  async writeMeta(key: string, meta: BlobMeta): Promise<void> {
    const p = this.metaPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }
}

/** 테스트용 인메모리 구현. */
export class MemorySink implements Sink {
  readonly bodies = new Map<string, Uint8Array>();
  readonly metas = new Map<string, BlobMeta>();
  /** write가 실제로 호출된 횟수 — 멱등성 검증에 쓴다 */
  writeCount = 0;
  /** 메타만 갱신한 횟수 — 「봤지만 안 바뀌었다」를 센다 */
  metaWriteCount = 0;

  async readMeta(key: string): Promise<BlobMeta | null> {
    return this.metas.get(key) ?? null;
  }

  async readBody(key: string): Promise<Uint8Array | null> {
    return this.bodies.get(key) ?? null;
  }

  async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    this.bodies.set(key, body);
    this.metas.set(key, meta);
    this.writeCount += 1;
  }

  /** ⚠**`writeCount` 를 올리지 않는다** — 멱등성 시험이 세는 것은 「본문을 다시 썼는가」다 */
  async writeMeta(key: string, meta: BlobMeta): Promise<void> {
    this.metas.set(key, meta);
    this.metaWriteCount += 1;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
