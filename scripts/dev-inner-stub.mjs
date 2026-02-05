import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const idx = args.indexOf(flag);
  if (idx === -1) {
    return null;
  }
  const v = args[idx + 1];
  return typeof v === 'string' ? v : null;
};

const portRaw = getArgValue('--port') ?? getArgValue('-p') ?? '3000';
const hostname = getArgValue('--hostname') ?? getArgValue('-H') ?? '127.0.0.1';

const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid --port: ${portRaw}`);
}

const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, 'content', 'docs');

const hasDoc = (slug) => {
  const dir = path.join(docsRoot, slug);
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  for (const name of ['index.mdx', 'index.md']) {
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${hostname}:${port}`);
  const pathname = url.pathname;

  if (pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('course-docs-site-stub');
    return;
  }

  // Mimic Next.js `trailingSlash: true` behavior (directories end with `/`).
  const match = pathname.match(/^\/docs\/([^/]+)\/$/);
  if (match) {
    const slug = match[1];
    if (hasDoc(slug)) {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`ok:${slug}`);
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('not found');
});

server.listen(port, hostname, () => {
  // eslint-disable-next-line no-console
  console.log(`[dev-inner-stub] listening on http://${hostname}:${port}`);
});
