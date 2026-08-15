/**
 * 생성된 사이트를 로컬에서 보기 위한 최소 서버.
 *
 * ```
 * npm run preview          # http://127.0.0.1:4173
 * ```
 *
 * ⚠**`dist/index.html`을 파일로 직접 열면 검색이 동작하지 않는다.** 선수 색인을 `fetch`로
 * 받는데 `file://`에서는 브라우저가 막는다. 그래서 개발용 서버가 필요하다.
 * ⚠**배포용이 아니다.** 127.0.0.1에만 바인딩하고, 인증도 캐시도 압축도 없다.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 4173);

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  // ⚠경로를 정규화한 **뒤에** 루트 안인지 확인한다. `..`를 문자열로 거르면 인코딩으로 빠져나간다.
  const path = normalize(join(root, rel === "" ? "index.html" : rel));
  if (path !== root && !path.startsWith(root + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  let target = path;
  try {
    if (statSync(target).isDirectory()) target = join(target, "index.html");
    statSync(target);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }

  res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${root} → http://127.0.0.1:${port}`);
});
