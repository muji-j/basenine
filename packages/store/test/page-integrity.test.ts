/**
 * 경기 폴더의 본문·사이드카 정합(설계 D3 · 시험 6·6a 의 단위판).
 * ⚠사이드카의 `sha256` 은 **gzip 전 본문**의 것이다(아카이버 `sha256(res.body)` · 실측 31,220/31,220 일치).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { GAME_PAGE_LEAVES, checkIntegrity, checkSet, readGamePages } from "../src/page-integrity.ts";

const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

async function gameDir(set?: Partial<Record<string, string | undefined>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-pages-"));
  for (const leaf of GAME_PAGE_LEAVES) {
    const body = `<html>${leaf}</html>`;
    await writeFile(join(dir, `${leaf}.html.gz`), gzipSync(Buffer.from(body, "utf8")));
    const meta: Record<string, unknown> = { url: `https://npb.jp/x/${leaf}`, fetchedAt: "2026-08-16T12:00:00.000Z", sha256: sha(body), revision: 1 };
    const s = set?.[leaf];
    if (s !== undefined) meta["set"] = s;
    await writeFile(join(dir, `${leaf}.meta.json`), JSON.stringify(meta));
  }
  return dir;
}

test("네 페이지가 온전하면 통과", async () => {
  const dir = await gameDir();
  try {
    assert.deepEqual(checkIntegrity(await readGamePages(dir)), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const leaf of GAME_PAGE_LEAVES) {
  test(`6a ${leaf}: 본문 한 바이트가 다르면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await writeFile(join(dir, `${leaf}.html.gz`), gzipSync(Buffer.from(`<html>${leaf}!</html>`, "utf8")));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, new RegExp(`${leaf}: 본문 sha256`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 본문만 없으면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.html.gz`));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /사이드카만 있고 본문이 없다/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 사이드카만 없으면 불일치`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.meta.json`));
      const r = checkIntegrity(await readGamePages(dir));
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /본문만 있고 사이드카가 없다/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`6a ${leaf}: 둘 다 없으면 무결성은 통과(없는 페이지)`, async () => {
    const dir = await gameDir();
    try {
      await unlink(join(dir, `${leaf}.html.gz`));
      await unlink(join(dir, `${leaf}.meta.json`));
      const pages = await readGamePages(dir);
      assert.deepEqual(checkIntegrity(pages), { ok: true });
      assert.equal(pages[leaf].body, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("깨진 사이드카 JSON 은 불일치", async () => {
  const dir = await gameDir();
  try {
    await writeFile(join(dir, "roster.meta.json"), "{not json");
    const r = checkIntegrity(await readGamePages(dir));
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /roster: 사이드카 JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("6 세트: 아무 데도 없으면 통과(기존 기록) · 모두 같으면 통과", async () => {
  const a = await gameDir();
  const b = await gameDir({ index: "S1", playbyplay: "S1", box: "S1", roster: "S1" });
  try {
    assert.deepEqual(checkSet(await readGamePages(a)), { ok: true, set: null });
    assert.deepEqual(checkSet(await readGamePages(b)), { ok: true, set: "S1" });
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("6 세트: 값이 갈리거나 일부만 있으면 불일치", async () => {
  const a = await gameDir({ index: "S1", playbyplay: "S1", box: "S2", roster: "S1" });
  const b = await gameDir({ index: "S1", playbyplay: "S1", box: undefined, roster: "S1" });
  try {
    assert.equal(checkSet(await readGamePages(a)).ok, false);
    assert.equal(checkSet(await readGamePages(b)).ok, false);
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("6 세트: 없는 페이지(둘 다 없음)는 세트 대조에서 빠진다", async () => {
  const dir = await gameDir({ index: "S1", playbyplay: "S1", box: "S1", roster: "S1" });
  try {
    await unlink(join(dir, "roster.html.gz"));
    await unlink(join(dir, "roster.meta.json"));
    assert.deepEqual(checkSet(await readGamePages(dir)), { ok: true, set: "S1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
