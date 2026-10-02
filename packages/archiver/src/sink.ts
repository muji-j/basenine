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
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  /**
   * **없다고 확인한 시각**(404/410). 있으면 그 URL 은 그때 존재하지 않았다.
   *
   * ⚠**「아직 안 받았다」와 「받으려 했는데 없다」는 다른 말이다**(M11).
   * 구별하지 않으면 **성공할 수 없는 요청을 매일 영구히** 보낸다 —
   * 실측 246명이 그 상태였다(2026-08-18 감사 P1).
   * ⚠**영구 제외의 근거가 아니다** — 1군에 올라오면 페이지가 생긴다. 기간은 선정 쪽이 정한다.
   */
  absentAt?: string;
  /**
   * **그 원본에 붙은 라이선스**(예: `CC BY-SA 4.0`).
   *
   * ⚠**소스마다 다르다.** npb.jp 는 「二次利用および無断転載を固く禁じます」라 우리가 붙일 라이선스가
   * 없고(`undefined`), ja.wikipedia 는 **CC BY-SA 4.0** 이라 **재배포에 같은 조건이 따라붙는다**(L3).
   * ⚠**「없음」과 「모름」을 섞지 마라**(M11) — 안 적은 것은 「이 소스에 대해 우리가 정한 라이선스가
   * 없다」는 뜻이지 「퍼블릭 도메인」이 아니다.
   * ⚠**우리가 지어내는 값이 아니라 수집기가 그 소스에 대해 아는 사실**이다. 그래서 사이드카에 남긴다 —
   * 아카이브만 보고도 「이 바이트를 어떤 조건으로 다룰 수 있는가」에 답할 수 있어야 한다(M4).
   */
  license?: string;
  /**
   * **세트 표식**(설계 `2026-09-25-archive-load-version-guard-design.md` D2). 경기 페이지 4장을 **한 번에** 기록할 때 같은 값을 적는다.
   * ⚠없는 사이드카(기능 이전 기록 전부)는 깨진 것이 아니다 — 적재기가 「기존 기록」으로 통과시킨다.
   */
  set?: string;
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

/**
 * 한 키의 **저장 바이트** 사본(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7-5).
 *
 * `parts` 는 「저장 단위 이름 → 그 바이트(없으면 `null` = 「없음」)」이고 **차례가 정해져 있다** — 같은 sink 의 같은 키면
 * 이름 열이 같으므로 두 사본을 바이트로 맞댈 수 있다(`sameSnapshot`).
 * ⚠「없음」과 「빈 파일」을 섞지 않는다(M11) — 빈 파일은 길이 0 인 바이트다.
 */
export interface PageSnapshot {
  readonly key: string;
  readonly parts: readonly (readonly [name: string, bytes: Uint8Array | null])[];
}

/**
 * 받기 전에 뜨고, 기록이 반쯤 실패하면 **그 바이트 그대로 되돌릴 수 있는** 저장소(정정 자동 재수집 전용 · 설계 D7-5).
 * ⚠기존 `Sink` 사용처는 바뀌지 않는다 — 평소 수집 경로(`archiveGame`)는 되돌리지 않는다(선례 설계가 G3b 를 적재기의 G4 로 받기로 했다).
 */
export interface RestorableSink extends Sink {
  /**
   * 그 키의 저장 바이트를 뜬다. 없는 것은 `null`.
   * ⚠**「없음」(ENOENT) 말고 읽기 오류는 던진다** — 못 뜬 사본으로는 되돌릴 수 없으므로 부르는 쪽이 그 경기를 받지 않는다(`snapshot_failed`).
   */
  snapshot(key: string): Promise<PageSnapshot>;
  /**
   * 사본의 바이트로 되돌린다 — 있던 것은 그 바이트로 다시 쓰고, 없던 것은 지운다(없어서 못 지우는 것은 성공).
   * ⚠**스스로 확인하지 않는다** — 부르는 쪽이 다시 떠서 사전과 맞댄다(`sameSnapshot`). 반환을 「되돌렸다」의 증거로 쓰지 마라.
   */
  restore(key: string, snap: PageSnapshot): Promise<void>;
}

/** 두 사본이 **바이트로** 같은가 — 이름 열과 각 바이트(또는 「없음」)가 전부 같아야 한다 */
export function sameSnapshot(a: PageSnapshot, b: PageSnapshot): boolean {
  if (a.key !== b.key || a.parts.length !== b.parts.length) return false;
  return a.parts.every(([name, bytes], i) => {
    const other = b.parts[i];
    if (other === undefined || other[0] !== name) return false;
    if (bytes === null || other[1] === null) return bytes === other[1];
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(Buffer.from(other[1].buffer, other[1].byteOffset, other[1].byteLength));
  });
}

/**
 * **이 프로세스의** 임시 파일 경로 — `writeAtomic` 과 사본(`LocalSink.snapshot`)이 같은 규칙을 쓴다(M1).
 * ⚠pid 를 넣는 이유는 `writeAtomic` 의 주석 — 같은 키를 두 프로세스가 동시에 쓰면 서로의 임시 파일을 깬다.
 */
export function tmpPathOf(path: string): string {
  return `${path}.${String(process.pid)}.tmp`;
}

/** 이름 열이 기대와 같은가 — 다른 키·다른 프로세스의 사본으로 덮어쓰는 사고를 막는다 */
function assertSnapshotOf(key: string, snap: PageSnapshot, names: readonly string[]): void {
  const got = snap.parts.map(([name]) => name);
  if (snap.key !== key || got.length !== names.length || got.some((n, i) => n !== names[i])) {
    throw new Error(`다른 저장 단위의 사본이다 — 되돌리지 않는다: 키 ${key} ← 사본 ${snap.key} (${got.join(", ")})`);
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 로컬 디스크 구현. 본문은 gzip, 메타는 평문 JSON(사람이 읽을 수 있게). */
export class LocalSink implements RestorableSink {
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

  /**
   * ⚠**본문을 먼저 쓰고 사이드카를 나중에 쓴다** — 그 순서가 뜻을 갖는다.
   * 사이드카가 먼저 있으면 「받아 뒀다」고 믿고 **본문 없이 건너뛰게** 된다.
   * 반대 순서(본문만 남고 사이드카 없음)는 다음 실행이 그냥 다시 받는다 — 회복 가능한 쪽이다.
   */
  async write(key: string, body: Uint8Array, meta: BlobMeta): Promise<void> {
    const bodyPath = this.bodyPath(key);
    await mkdir(dirname(bodyPath), { recursive: true });
    await writeAtomic(bodyPath, gzipSync(body));
    await this.writeMeta(key, meta);
  }

  async writeMeta(key: string, meta: BlobMeta): Promise<void> {
    const p = this.metaPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeAtomic(p, Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, "utf8"));
  }

  /**
   * 사본에 넣는 파일 — 본문 · 사이드카 · **이 프로세스가 남겼을 수 있는 두 임시 파일**(설계 D7-5).
   * ⚠임시 파일까지 뜨는 이유: 기록 단계의 첫 쓰기가 `writeFile(임시)` 뒤 `rename` 전에 실패하면 최종 경로는 그대로인데
   *   임시 파일만 남는다 — 그것도 「이 프로세스가 무언가를 썼다」의 증거다(G3b · 되돌릴 때 지운다).
   */
  private snapshotPaths(key: string): string[] {
    const body = this.bodyPath(key);
    const meta = this.metaPath(key);
    return [body, meta, tmpPathOf(body), tmpPathOf(meta)];
  }

  /** ⚠본문은 **gzip 된 저장 바이트 그대로**다(풀지 않는다) — 되돌릴 때 같은 바이트를 써야 하므로 */
  async snapshot(key: string): Promise<PageSnapshot> {
    const parts: (readonly [string, Uint8Array | null])[] = [];
    for (const path of this.snapshotPaths(key)) parts.push([path, await readBytesOrNull(path)]);
    return { key, parts };
  }

  /**
   * 본문 → 사이드카(`write` 와 같은 차례) → 임시 파일 차례로 되돌린다.
   * - 있던 본문·사이드카는 원래 바이트를 **같은 디렉터리의 임시 파일 + rename** 으로 다시 쓴다(`writeAtomic` — 되돌리기 도중 죽어도 잘린 파일이 안 남는다).
   * - 없던 것은 지운다(ENOENT 는 성공 · `force`).
   * - 임시 파일은 본문·사이드카를 되돌린 **뒤에** 사전 상태로 맞춘다 — `writeAtomic` 이 같은 임시 이름을 거쳐 가기 때문이다.
   *   사전에 없던 임시 파일(= 이 프로세스가 이번에 남긴 것)은 지운다.
   * ⚠한 파일이 실패하면 던진다 — 나머지를 되돌렸는지는 부르는 쪽이 **다시 떠서** 판정한다.
   */
  async restore(key: string, snap: PageSnapshot): Promise<void> {
    const paths = this.snapshotPaths(key);
    assertSnapshotOf(key, snap, paths);
    for (const [i, [path, bytes]] of snap.parts.entries()) {
      if (bytes === null) {
        await rm(path, { force: true });
      } else if (i < 2) {
        await mkdir(dirname(path), { recursive: true });
        await writeAtomic(path, bytes);
      } else {
        await writeFile(path, bytes);
      }
    }
  }
}

/** 파일의 바이트 그대로. **없으면 `null`**(「없음」) — 그 밖의 읽기 오류는 던진다 */
async function readBytesOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * **임시 파일에 쓰고 옮긴다.**
 *
 * ⚠**본문 쓰기가 비원자적이었다**(2026-08-18 감사 P2). `writeFile` 은 대상 파일을 먼저 비우고
 * 조금씩 채우므로, 그 사이에 죽으면 **잘린 `.gz`** 가 남는다.
 * 그리고 다음 실행은 그 파일을 **「있다」로 보고 건너뛰거나**, 사이드카의 sha256/ETag 로
 * 304 를 받아 **영구히 고착**한다 — 로그에는 「변경없음」이라고 남는다.
 * ⚠**아카이브는 소급 불가 자산이다** — 조용히 깨진 채 남는 것이 가장 나쁜 결과다.
 *
 * ⚠**`rename` 은 같은 파일시스템 안에서 원자적이다.** 그래서 임시 파일을 **같은 디렉터리**에 만든다
 * (`/tmp` 에 만들면 다른 마운트일 수 있고 그때는 복사 + 삭제라 원자성이 사라진다).
 * ⚠**임시 이름에 pid 를 넣는다** — 같은 키를 두 프로세스가 동시에 쓰면 서로의 임시 파일을 깬다.
 *   (동시 실행은 워크플로 `concurrency` 로 막지만, 손으로 돌리는 백필이 겹칠 수 있다.)
 */
async function writeAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = tmpPathOf(path);
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** 테스트용 인메모리 구현. */
export class MemorySink implements RestorableSink {
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

  /** 본문은 바이트 복사본, 사이드카는 `LocalSink` 처럼 JSON 바이트로 뜬다(같은 객체를 쥐면 뒤의 변경이 사본에 샌다) */
  async snapshot(key: string): Promise<PageSnapshot> {
    const body = this.bodies.get(key);
    const meta = this.metas.get(key);
    return {
      key,
      parts: [
        ["body", body === undefined ? null : body.slice()],
        ["meta", meta === undefined ? null : new TextEncoder().encode(JSON.stringify(meta))],
      ],
    };
  }

  /** ⚠`writeCount`·`metaWriteCount` 를 올리지 않는다 — 되돌리기는 아카이브의 「쓰기」가 아니다 */
  async restore(key: string, snap: PageSnapshot): Promise<void> {
    assertSnapshotOf(key, snap, ["body", "meta"]);
    const body = snap.parts[0]?.[1] ?? null;
    const meta = snap.parts[1]?.[1] ?? null;
    if (body === null) this.bodies.delete(key);
    else this.bodies.set(key, body.slice());
    if (meta === null) this.metas.delete(key);
    else this.metas.set(key, JSON.parse(new TextDecoder().decode(meta)) as BlobMeta);
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
