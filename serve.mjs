// Tiny static server for local development: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.argv[2] ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' ) path = '/index.html';
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(process.cwd(), safe));
    res.setHeader('Content-Type', TYPES[extname(safe)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('404');
  }
}).listen(PORT, () => console.log(`serving http://localhost:${PORT}`));
